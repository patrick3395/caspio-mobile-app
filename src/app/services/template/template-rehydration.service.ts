/**
 * TemplateRehydrationService - Unified rehydration for all template types
 *
 * When clearAllSyncedData() clears IndexedDB storage, affected services are
 * marked as PURGED. When the user reopens any template (EFE, HUD, LBW, DTE),
 * this service restores all data from the server.
 *
 * Flow:
 * 1. clearAllSyncedData() deletes verified blobs and marks services as PURGED
 * 2. User opens a template page
 * 3. Page calls needsRehydration(serviceId) - returns true if PURGED
 * 4. Page calls rehydrateServiceForTemplate(config, serviceId)
 * 5. Service fetches templates, records, and attachments from API
 * 6. Service seeds Dexie field tables and creates LocalImage records
 * 7. Service sets purgeState to ACTIVE
 */

import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { db } from '../caspio-db';
import { CaspioService } from '../caspio.service';
import { GenericFieldRepoService } from './generic-field-repo.service';
import { OfflineTemplateService } from '../offline-template.service';
import { ServiceMetadataService } from '../service-metadata.service';
import { IndexedDbService, ImageEntityType } from '../indexed-db.service';
import { TemplateConfig } from './template-config.interface';
import { environment } from '../../../environments/environment';
import { renderAnnotationsOnPhoto } from '../../utils/annotation-utils';

export interface RehydrationResult {
  success: boolean;
  recordsRestored: number;
  imagesRestored: number;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class TemplateRehydrationService {
  // Track in-flight rehydrations to prevent duplicate operations
  private rehydrationInProgress = new Map<string, Promise<RehydrationResult>>();

  constructor(
    private genericFieldRepo: GenericFieldRepoService,
    private offlineTemplate: OfflineTemplateService,
    private serviceMetadata: ServiceMetadataService,
    private indexedDb: IndexedDbService,
    private caspioService: CaspioService
  ) {
  }

  /**
   * Check if a service needs rehydration
   * Returns true if purgeState is PURGED or ARCHIVED
   */
  async needsRehydration(serviceId: string): Promise<boolean> {
    // Webapp doesn't use local storage, so never needs rehydration
    if (environment.isWeb) {
      return false;
    }

    const metadata = await this.serviceMetadata.getServiceMetadata(serviceId);
    if (!metadata) {
      // No metadata means service was never initialized - doesn't need rehydration
      return false;
    }

    const needsIt = metadata.purgeState === 'PURGED' || metadata.purgeState === 'ARCHIVED';
    if (needsIt) {
    }
    return needsIt;
  }

  /**
   * Rehydrate a service for a specific template type
   * Restores all data from the server after storage was cleared
   *
   * @param config - Template configuration (determines which APIs to call)
   * @param serviceId - The service ID to rehydrate
   * @returns RehydrationResult with success status and counts
   */
  async rehydrateServiceForTemplate(
    config: TemplateConfig,
    serviceId: string
  ): Promise<RehydrationResult> {
    const rehydrationKey = `${config.id}:${serviceId}`;

    // Check if rehydration is already in progress
    const existingRehydration = this.rehydrationInProgress.get(rehydrationKey);
    if (existingRehydration) {
      return existingRehydration;
    }

    // Start rehydration

    const rehydrationPromise = this.performRehydration(config, serviceId);
    this.rehydrationInProgress.set(rehydrationKey, rehydrationPromise);

    try {
      const result = await rehydrationPromise;
      return result;
    } finally {
      this.rehydrationInProgress.delete(rehydrationKey);
    }
  }

  /**
   * Perform the actual rehydration
   */
  private async performRehydration(
    config: TemplateConfig,
    serviceId: string
  ): Promise<RehydrationResult> {
    let recordsRestored = 0;
    let imagesRestored = 0;

    try {
      // Step 1: Check purgeState - skip if already ACTIVE
      const metadata = await this.serviceMetadata.getServiceMetadata(serviceId);
      if (metadata?.purgeState === 'ACTIVE') {
        return { success: true, recordsRestored: 0, imagesRestored: 0 };
      }

      // Step 2: Invalidate any in-memory caches by clearing cached service data
      await this.indexedDb.clearCachedServiceData(serviceId, 'visuals');

      // Step 3: Get templates from offline cache (or fetch if needed)
      const templates = await this.getTemplatesForConfig(config);
      const dropdownData = await this.getDropdownDataForConfig(config);

      // Step 4: Fetch server records
      const serverRecords = await this.fetchServerRecords(config, serviceId);

      // Step 5: Seed templates into Dexie field tables for each category

      // Get unique categories from both templates and records
      const categoriesFromTemplates = new Set(templates.map((t: any) => t.Category).filter(Boolean));
      const categoriesFromRecords = new Set(serverRecords.map((r: any) => r.Category).filter(Boolean));
      const allCategories = new Set([...categoriesFromTemplates, ...categoriesFromRecords]);

      // For HUD (no categories hub), use a single category
      if (config.id === 'hud' && !config.features.hasCategoriesHub) {
        allCategories.clear();
        allCategories.add('HUD'); // HUD uses a single category
      }

      for (const category of allCategories) {
        // Seed templates
        await this.genericFieldRepo.seedFromTemplates(
          config,
          serviceId,
          category,
          templates,
          dropdownData
        );

        // Merge existing records
        await this.genericFieldRepo.mergeExistingRecords(
          config,
          serviceId,
          category,
          serverRecords
        );
      }

      recordsRestored = serverRecords.length;

      // Step 6: Create LocalImage records for attachments
      imagesRestored = await this.restoreImageReferences(config, serviceId, serverRecords);

      // Step 7: Pre-cache image data from S3 for offline access
      // Without this, images show broken links when the user goes offline after rehydration
      await this.preCacheImages(serviceId, config.entityType);

      // Step 8: Set purgeState to ACTIVE
      await this.serviceMetadata.setPurgeState(serviceId, 'ACTIVE');


      return {
        success: true,
        recordsRestored,
        imagesRestored
      };

    } catch (error: any) {
      console.error(`[TemplateRehydration] ❌ Rehydration failed:`, error);
      return {
        success: false,
        recordsRestored,
        imagesRestored,
        error: error?.message || 'Unknown error'
      };
    }
  }

  /**
   * Get templates from offline cache based on template config
   * Uses existing OfflineTemplateService methods with their actual names
   */
  private async getTemplatesForConfig(config: TemplateConfig): Promise<any[]> {
    switch (config.id) {
      case 'efe':
        return this.offlineTemplate.ensureVisualTemplatesReady();
      case 'hud':
        return this.offlineTemplate.ensureHudTemplatesReady();
      case 'lbw':
        // LBW uses getLbwTemplates() - returns cached or fetches
        return this.offlineTemplate.getLbwTemplates();
      case 'dte':
        // DTE uses getDteTemplates() - returns cached or fetches
        return this.offlineTemplate.getDteTemplates();
      default:
        console.warn(`[TemplateRehydration] Unknown template type: ${config.id}`);
        return [];
    }
  }

  /**
   * Get dropdown data from offline cache based on template config
   * Uses existing OfflineTemplateService methods with their actual names
   */
  private async getDropdownDataForConfig(config: TemplateConfig): Promise<any[]> {
    switch (config.id) {
      case 'efe':
        // EFE uses visual dropdown options from indexedDb directly
        return (await this.indexedDb.getCachedTemplates('visual_dropdown')) || [];
      case 'hud':
        return this.offlineTemplate.ensureHudDropdownReady();
      case 'lbw':
        // LBW uses getLbwDropdownOptions()
        return this.offlineTemplate.getLbwDropdownOptions();
      case 'dte':
        // DTE uses getDteDropdownOptions()
        return this.offlineTemplate.getDteDropdownOptions();
      default:
        return [];
    }
  }

  /**
   * Fetch server records using config-driven API routing
   */
  private async fetchServerRecords(config: TemplateConfig, serviceId: string): Promise<any[]> {
    try {
      switch (config.id) {
        case 'efe':
          return await firstValueFrom(this.caspioService.getServicesVisualsByServiceId(serviceId));
        case 'hud':
          return await firstValueFrom(this.caspioService.getServicesHUDByServiceId(serviceId, true));
        case 'lbw':
          return await firstValueFrom(this.caspioService.getServicesLBWByServiceId(serviceId, true));
        case 'dte':
          return await firstValueFrom(this.caspioService.getServicesDTEByServiceId(serviceId, true));
        default:
          console.warn(`[TemplateRehydration] Unknown template type: ${config.id}`);
          return [];
      }
    } catch (error) {
      console.error(`[TemplateRehydration] Failed to fetch server records:`, error);
      return [];
    }
  }

  /**
   * Restore LocalImage records for attachments
   * Creates LocalImage records with localBlobId: null and remoteS3Key: <key>
   * This allows getDisplayUrl() to fall back to S3 URLs
   */
  private async restoreImageReferences(
    config: TemplateConfig,
    serviceId: string,
    serverRecords: any[]
  ): Promise<number> {
    let imagesRestored = 0;

    // Get all record IDs that might have attachments
    const recordIds = serverRecords
      .map(r => r[config.idFieldName] || r.PK_ID)
      .filter(Boolean)
      .map(String);

    if (recordIds.length === 0) {
      return 0;
    }

    // Fetch attachments from server
    const attachments = await this.fetchAttachments(config, recordIds);

    // Create LocalImage records for each attachment
    for (const attachment of attachments) {
      try {
        const s3Key = attachment.Attachment;
        if (!s3Key) continue;

        // Get the entity ID (VisualID, HUDID, LBWID, DTEID)
        const entityId = attachment[config.idFieldName] ||
                        attachment.VisualID ||
                        attachment.HUDID ||
                        attachment.LBWID ||
                        attachment.DTEID;

        if (!entityId) continue;

        // Check if LocalImage already exists for this attachment
        const serverAttachId = attachment.PK_ID || attachment[`${config.idFieldName}AttachID`];
        const existingImage = await db.localImages
          .filter(img => img.attachId === String(serverAttachId))
          .first();

        if (existingImage) {
          // Already exists, just ensure blob references are cleared
          await db.localImages.update(existingImage.imageId, {
            localBlobId: null,
            thumbBlobId: null
          });
          imagesRestored++;
          continue;
        }

        // Create new LocalImage record with S3 key (no local blob)
        const imageId = crypto.randomUUID();
        const now = Date.now();

        await db.localImages.add({
          imageId,
          entityType: config.entityType,
          entityId: String(entityId),
          serviceId,
          localBlobId: null,    // No local blob - will use S3
          thumbBlobId: null,    // No thumbnail - will use S3
          remoteS3Key: s3Key,
          attachId: String(serverAttachId),  // Real AttachID from Caspio
          status: 'verified',   // Already synced to server
          isSynced: true,       // Already synced
          remoteUrl: null,      // Will be generated at runtime from S3 key
          fileName: attachment.Attachment || '',
          fileSize: 0,
          contentType: 'image/jpeg',
          caption: attachment.Annotation || '',
          drawings: attachment.Drawings || '',
          photoType: null,
          createdAt: now,
          updatedAt: now,
          lastError: null,
          localVersion: 1,
          remoteVerifiedAt: now,  // Assume verified since it came from server
          remoteLoadedInUI: false // Will be set to true when UI loads it
        });

        imagesRestored++;
      } catch (err) {
        console.warn(`[TemplateRehydration] Failed to restore image:`, err);
      }
    }

    return imagesRestored;
  }

  /**
   * Pre-cache image data from S3 for offline access
   * Fetches actual image bytes and stores them in localBlobs + cachedPhotos
   * so getDisplayUrl() can serve them without network.
   * Also renders and caches annotated thumbnails.
   */
  private async preCacheImages(serviceId: string, entityType: string): Promise<void> {
    const localImages = await db.localImages
      .where('serviceId')
      .equals(serviceId)
      .toArray();

    // Filter images that need caching: no blob OR stale blob reference (deleted during purge)
    const imagesToCache: typeof localImages = [];
    for (const img of localImages) {
      if (!img.remoteS3Key || img.status !== 'verified') continue;
      if (!img.localBlobId) {
        imagesToCache.push(img);
        continue;
      }
      // Verify the referenced blob actually exists (may have been deleted by clearAllSyncedData)
      const blobExists = await db.localBlobs.get(img.localBlobId);
      if (!blobExists) {
        // Clear stale reference so getDisplayUrl doesn't waste time on it
        await db.localImages.update(img.imageId, { localBlobId: null });
        imagesToCache.push(img);
      }
    }

    if (imagesToCache.length === 0) return;

    // Process in parallel batches of 3 to avoid overwhelming the network
    const BATCH_SIZE = 3;
    let cached = 0;

    for (let i = 0; i < imagesToCache.length; i += BATCH_SIZE) {
      const batch = imagesToCache.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (img) => {
        try {
          // Get signed S3 URL
          const signedUrl = await this.caspioService.getS3FileUrl(img.remoteS3Key!);

          // Fetch actual image data
          const response = await fetch(signedUrl);
          if (!response.ok) return;

          const blob = await response.blob();
          if (!blob || blob.size === 0) return;

          // Store in localBlobs
          const arrayBuffer = await blob.arrayBuffer();
          const blobId = crypto.randomUUID();
          await db.localBlobs.add({
            blobId,
            data: arrayBuffer,
            sizeBytes: arrayBuffer.byteLength,
            contentType: blob.type || 'image/jpeg',
            createdAt: Date.now()
          });

          // Update LocalImage to point to the new blob
          await db.localImages.update(img.imageId, { localBlobId: blobId });

          // Create a single blob URL from the original fetch blob (NOT from arrayBuffer,
          // which may be neutered/detached after IndexedDB structured clone).
          // This URL is used for both annotation rendering and base64 conversion.
          const contentType = blob.type || 'image/jpeg';
          const reusableBlobUrl = URL.createObjectURL(blob);

          // If image has annotations, render and cache annotated thumbnail FIRST.
          // Must happen before base64 conversion to ensure blob URL is still valid.
          if (img.drawings && img.drawings.length > 10) {
            try {
              const annotatedDataUrl = await renderAnnotationsOnPhoto(reusableBlobUrl, img.drawings);

              if (annotatedDataUrl && annotatedDataUrl !== reusableBlobUrl) {
                // Convert annotated data URL to blob and store
                const annotatedResponse = await fetch(annotatedDataUrl);
                const annotatedBlob = await annotatedResponse.blob();
                const cacheKey = img.attachId || img.imageId;
                await this.indexedDb.cacheAnnotatedImage(cacheKey, annotatedBlob);
              }
            } catch (annotErr) {
              // Annotation rendering is non-critical — original photo is still cached
              console.warn(`[TemplateRehydration] Annotation render failed for ${img.imageId}:`, annotErr);
            }
          }

          // Store base64 directly in cachedPhotos for reliable offline access (non-annotated).
          // Using imageData (not blobKey pointer) matches the pattern that works for
          // annotated images via cacheAnnotatedImage. Done AFTER annotation rendering
          // to avoid consuming the blob before annotations can use it.
          if (img.attachId) {
            try {
              const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(blob);
              });
              await db.cachedPhotos.put({
                photoKey: `photo_${img.attachId}`,
                attachId: String(img.attachId),
                serviceId: serviceId,
                imageData: base64,
                s3Key: img.remoteS3Key || '',
                cachedAt: Date.now()
              });
            } catch (cacheErr) {
              // Non-critical — local blob is already stored for Rule 1 fallback
              console.warn(`[TemplateRehydration] Failed to cache base64 for ${img.imageId}:`, cacheErr);
            }
          }

          // Clean up the reusable blob URL
          URL.revokeObjectURL(reusableBlobUrl);

          cached++;
        } catch (err) {
          console.warn(`[TemplateRehydration] Failed to pre-cache image ${img.imageId}:`, err);
        }
      }));
    }

    if (cached > 0) {
    }
  }

  /**
   * Fetch attachments from server using config-driven API routing
   */
  private async fetchAttachments(config: TemplateConfig, recordIds: string[]): Promise<any[]> {
    if (recordIds.length === 0) return [];

    const allAttachments: any[] = [];

    // Fetch attachments for each record ID
    // Per-record try/catch so one failure doesn't abort all remaining records
    for (const recordId of recordIds) {
      try {
        let attachments: any[] = [];

        switch (config.id) {
          case 'efe':
            attachments = await firstValueFrom(
              this.caspioService.getServiceVisualsAttachByVisualId(recordId)
            );
            break;
          case 'hud':
            attachments = await firstValueFrom(
              this.caspioService.getServiceHUDAttachByHUDId(recordId)
            );
            break;
          case 'lbw':
            attachments = await firstValueFrom(
              this.caspioService.getServiceLBWAttachByLBWId(recordId)
            );
            break;
          case 'dte':
            attachments = await firstValueFrom(
              this.caspioService.getServiceDTEAttachByDTEId(recordId)
            );
            break;
        }

        if (attachments && attachments.length > 0) {
          allAttachments.push(...attachments);
        }
      } catch (error) {
        console.warn(`[TemplateRehydration] Failed to fetch attachments for record ${recordId}:`, error);
      }
    }

    return allAttachments;
  }

  /**
   * Force rehydration for a service (clears data and re-fetches)
   * Use this when user explicitly wants to sync from server
   */
  async forceRehydrate(config: TemplateConfig, serviceId: string): Promise<RehydrationResult> {

    // Mark as PURGED to force rehydration
    await this.serviceMetadata.setPurgeState(serviceId, 'PURGED');

    // Clear existing field data for this service
    await this.clearFieldDataForService(config, serviceId);

    // Perform rehydration
    return this.rehydrateServiceForTemplate(config, serviceId);
  }

  /**
   * Clear field data for a service from the appropriate Dexie table
   */
  private async clearFieldDataForService(config: TemplateConfig, serviceId: string): Promise<void> {
    switch (config.id) {
      case 'efe':
        await db.visualFields.where('serviceId').equals(serviceId).delete();
        break;
      case 'hud':
        await db.hudFields.where('serviceId').equals(serviceId).delete();
        break;
      case 'lbw':
        await db.lbwFields.where('serviceId').equals(serviceId).delete();
        break;
      case 'dte':
        await db.dteFields.where('serviceId').equals(serviceId).delete();
        break;
    }
  }
}
