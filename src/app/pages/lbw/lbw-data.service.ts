import { Injectable } from '@angular/core';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { CaspioService } from '../../services/caspio.service';
import { IndexedDbService, LocalImage } from '../../services/indexed-db.service';
import { TempIdService } from '../../services/temp-id.service';
import { BackgroundSyncService } from '../../services/background-sync.service';
import { OfflineTemplateService } from '../../services/offline-template.service';
import { OfflineService } from '../../services/offline.service';
import { LocalImageService } from '../../services/local-image.service';
import { VisualFieldRepoService } from '../../services/visual-field-repo.service';
import { db } from '../../services/caspio-db';
import { environment } from '../../../environments/environment';

interface CacheEntry<T> {
  value: Promise<T>;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class LbwDataService {
  private readonly cacheTtlMs = 5 * 60 * 1000;

  private projectCache = new Map<string, CacheEntry<any>>();
  private serviceCache = new Map<string, CacheEntry<any>>();
  private typeCache = new Map<string, CacheEntry<any>>();
  private imageCache = new Map<string, CacheEntry<string>>();
  private lbwCache = new Map<string, CacheEntry<any[]>>();
  private lbwAttachmentsCache = new Map<string, CacheEntry<any[]>>();

  // Event emitted when caches are invalidated - pages should reload their data
  public cacheInvalidated$ = new Subject<{ serviceId?: string; reason: string }>();

  private syncSubscriptions: Subscription[] = [];

  // Debounce timer for cache invalidation to batch multiple sync events into one UI refresh
  private cacheInvalidationTimer: any = null;
  private pendingInvalidationServiceId: string | undefined = undefined;

  constructor(
    private readonly caspioService: CaspioService,
    private readonly indexedDb: IndexedDbService,
    private readonly tempId: TempIdService,
    private readonly backgroundSync: BackgroundSyncService,
    private readonly offlineTemplate: OfflineTemplateService,
    private readonly offlineService: OfflineService,
    private readonly localImageService: LocalImageService,
    private readonly visualFieldRepo: VisualFieldRepoService
  ) {
    this.subscribeToSyncEvents();
  }

  /**
   * Subscribe to BackgroundSyncService events and auto-invalidate caches
   * This ensures in-memory caches are cleared when IndexedDB is updated
   */
  private subscribeToSyncEvents(): void {
    // When a visual syncs, clear visual caches
    this.syncSubscriptions.push(
      this.backgroundSync.visualSyncComplete$.subscribe(event => {
        this.invalidateCachesForService(event.serviceId, 'visual_sync');
      })
    );

    // When a LBW photo syncs, clear attachment caches
    // CRITICAL FIX: Do NOT emit cacheInvalidated$ here - it causes a race condition
    this.syncSubscriptions.push(
      this.backgroundSync.lbwPhotoUploadComplete$.subscribe(event => {
        this.lbwAttachmentsCache.clear();
        this.imageCache.clear();
        // DO NOT call: this.cacheInvalidated$.next({ reason: 'photo_sync' });
      })
    );

    // When service data syncs, clear service/project caches
    this.syncSubscriptions.push(
      this.backgroundSync.serviceDataSyncComplete$.subscribe(event => {
        if (event.serviceId) {
          this.serviceCache.delete(event.serviceId);
        }
        if (event.projectId) {
          this.projectCache.delete(event.projectId);
        }
        this.debouncedCacheInvalidation(event.serviceId, 'service_data_sync');
      })
    );

    // CRITICAL: When background refresh completes, clear in-memory caches and notify pages
    this.syncSubscriptions.push(
      this.offlineTemplate.backgroundRefreshComplete$.subscribe(event => {

        if (event.dataType === 'lbw_records') {
          this.lbwCache.delete(event.serviceId);
        }

        // Emit cache invalidated event so pages reload with fresh data (debounced)
        this.debouncedCacheInvalidation(event.serviceId, `background_refresh_${event.dataType}`);
      })
    );

    // REACTIVE SUBSCRIPTION: Subscribe to IndexedDB image changes
    this.syncSubscriptions.push(
      this.indexedDb.imageChange$.subscribe(event => {

        if (event.entityType === 'lbw') {
          this.lbwAttachmentsCache.clear();
        }

        this.debouncedCacheInvalidation(event.serviceId, `indexeddb_${event.action}_${event.entityType}`);
      })
    );
  }

  /**
   * Debounced cache invalidation to batch multiple sync events into one UI refresh
   */
  private debouncedCacheInvalidation(serviceId?: string, reason: string = 'batch_sync'): void {
    if (serviceId) {
      this.pendingInvalidationServiceId = serviceId;
    }

    if (this.cacheInvalidationTimer) {
      clearTimeout(this.cacheInvalidationTimer);
    }

    this.cacheInvalidationTimer = setTimeout(() => {
      this.cacheInvalidated$.next({
        serviceId: this.pendingInvalidationServiceId,
        reason: reason
      });
      this.cacheInvalidationTimer = null;
      this.pendingInvalidationServiceId = undefined;
    }, 1000);
  }

  /**
   * Invalidate all caches for a specific service
   */
  invalidateCachesForService(serviceId: string, reason: string = 'manual'): void {

    this.lbwCache.delete(serviceId);
    this.serviceCache.delete(serviceId);
    this.lbwAttachmentsCache.clear();
    this.imageCache.clear();

    this.debouncedCacheInvalidation(serviceId, reason);
  }

  async getProject(projectId: string | null | undefined): Promise<any> {
    if (!projectId) {
      return null;
    }
    return this.resolveWithCache(this.projectCache, projectId, () =>
      firstValueFrom(this.caspioService.getProject(projectId))
    );
  }

  async getService(serviceId: string | null | undefined): Promise<any> {
    if (!serviceId) {
      return null;
    }
    return this.resolveWithCache(this.serviceCache, serviceId, () =>
      firstValueFrom(this.caspioService.getService(serviceId))
    );
  }

  async getType(typeId: string | null | undefined): Promise<any> {
    if (!typeId) {
      return null;
    }
    return this.resolveWithCache(this.typeCache, typeId, () =>
      firstValueFrom(this.caspioService.getType(typeId))
    );
  }

  async getImage(filePath: string): Promise<string> {
    if (!filePath) {
      return '';
    }
    return this.resolveWithCache(this.imageCache, filePath, () =>
      firstValueFrom(this.caspioService.getImageFromFilesAPI(filePath))
    );
  }

  /**
   * Get LBW records for a service - delegates to OfflineTemplateService
   * Queries LPS_Services_LBW table (DEXIE-FIRST pattern)
   */
  async getVisualsByService(serviceId: string, bypassCache: boolean = false): Promise<any[]> {
    if (!serviceId) {
      console.warn('[LBW Data] getVisualsByService called with empty serviceId');
      return [];
    }

    // CRITICAL: If bypassCache is true, clear the cache first
    if (bypassCache) {
      this.lbwCache.delete(serviceId);
    }

    // OFFLINE-FIRST: Use OfflineTemplateService which reads from IndexedDB
    const lbwRecords = await this.offlineTemplate.getLbwByService(serviceId);

    if (lbwRecords.length > 0) {
    }
    return lbwRecords;
  }

  /**
   * Get attachments for a LBW record from LPS_Services_LBW_Attach table
   * Uses LBWID as the foreign key
   */
  async getVisualAttachments(lbwId: string | number): Promise<any[]> {
    if (!lbwId) {
      return [];
    }
    const lbwIdStr = String(lbwId);

    // WEBAPP MODE: Return only server data (no local images)
    if (environment.isWeb) {
      try {
        // WEBAPP FIX: Bypass cache to ensure we get fresh attachment data from server
        const serverAttachments = await firstValueFrom(this.caspioService.getServiceLBWAttachByLBWId(lbwIdStr, true));
        return serverAttachments || [];
      } catch (error) {
        console.error('[LBW Data] Error loading LBW attachments:', error);
        return [];
      }
    }

    // MOBILE MODE: OFFLINE-FIRST pattern
    // Get local images for this LBW record from LocalImageService
    const localImages = await this.localImageService.getImagesForEntity('lbw', lbwIdStr);

    // Convert local images to attachment format for UI compatibility
    const localAttachments = await Promise.all(localImages.map(async (img) => {
      const displayUrl = await this.localImageService.getDisplayUrl(img);
      return {
        // Stable identifiers
        imageId: img.imageId,
        AttachID: img.attachId || img.imageId,
        attachId: img.attachId || img.imageId,
        _tempId: img.imageId,
        _pendingFileId: img.imageId,

        // Entity references
        LBWID: img.entityId,
        entityId: img.entityId,
        entityType: img.entityType,
        serviceId: img.serviceId,

        // Content
        Annotation: img.caption,
        caption: img.caption,
        drawings: img.drawings,
        fileName: img.fileName,

        // Display URLs
        Photo: displayUrl,
        url: displayUrl,
        thumbnailUrl: displayUrl,
        displayUrl: displayUrl,
        _thumbnailUrl: displayUrl,

        // Status flags
        status: img.status,
        isPending: img.status === 'queued' || img.status === 'uploading' || img.status === 'local_only',
        isLocal: true
      };
    }));

    // Get legacy attachments from server (for pre-existing data)
    let legacyAttachments: any[] = [];
    if (this.offlineService.isOnline() && !lbwIdStr.startsWith('temp_')) {
      try {
        legacyAttachments = await firstValueFrom(this.caspioService.getServiceLBWAttachByLBWId(lbwIdStr));
      } catch (error) {
        console.warn('[LBW Data] Failed to load legacy attachments:', error);
      }
    }

    // Filter legacy attachments to exclude any that have been migrated to new system
    const filteredLegacy = legacyAttachments.filter((att: any) => {
      const attId = String(att.AttachID || att.attachId || '');
      return !localImages.some(img => img.attachId === attId);
    });

    // Merge: local-first images first, then legacy
    const merged = [...localAttachments, ...filteredLegacy];

    return merged;
  }

  private async resolveWithCache<T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
    loader: () => Promise<T>
  ): Promise<T> {
    const existing = cache.get(key);
    if (existing && !this.isExpired(existing.timestamp)) {
      return existing.value;
    }
    const valuePromise = loader();
    cache.set(key, { value: valuePromise, timestamp: Date.now() });
    return valuePromise;
  }

  private isExpired(timestamp: number): boolean {
    return Date.now() - timestamp > this.cacheTtlMs;
  }

  // Clear all caches - use when returning to page to force fresh data load
  clearAllCaches(): void {

    this.projectCache.clear();
    this.serviceCache.clear();
    this.typeCache.clear();
    this.imageCache.clear();
    this.lbwCache.clear();
    this.lbwAttachmentsCache.clear();

    this.caspioService.clearServicesCache();
  }

  // Clear specific caches for a service - use when service data changes
  clearServiceCaches(serviceId: string): void {
    this.lbwCache.delete(serviceId);
  }

  // Clear attachment cache for a specific lbwId - use after WEBAPP photo uploads
  clearAttachmentCache(lbwId: string | number): void {
    const key = String(lbwId);
    this.lbwAttachmentsCache.delete(key);
  }

  // ============================================
  // LBW VISUAL MANAGEMENT METHODS
  // ============================================

  /**
   * Create LBW record - OFFLINE-FIRST with background sync
   */
  async createVisual(lbwData: any): Promise<any> {
    // DEBUG: Log which mode we're in

    // WEBAPP MODE: Create directly via API (no local storage)
    if (environment.isWeb) {

      try {
        const response = await fetch(`${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_LBW/records?response=rows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lbwData)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to create LBW record: ${errorText}`);
        }

        const result = await response.json();
        const createdRecord = result.Result?.[0] || result;

        const lbwId = createdRecord.LBWID || createdRecord.PK_ID;

        // Clear cache
        if (lbwData.ServiceID) {
          this.lbwCache.delete(String(lbwData.ServiceID));
        }

        return {
          ...lbwData,
          LBWID: lbwId,
          PK_ID: lbwId,
          ...createdRecord
        };
      } catch (error: any) {
        console.error('[LBW Data] WEBAPP: ❌ Error creating LBW record:', error?.message || error);
        throw error;
      }
    }

    // MOBILE MODE: Offline-first with background sync

    // Generate temporary ID (using 'lbw' prefix for LBW records)
    const tempId = this.tempId.generateTempId('lbw');

    // Create placeholder for immediate UI
    const placeholder = {
      ...lbwData,
      LBWID: tempId,
      PK_ID: tempId,
      _tempId: tempId,
      _localOnly: true,
      _syncing: true,
      _createdAt: Date.now(),
    };

    // Store in IndexedDB for background sync
    await this.indexedDb.addPendingRequest({
      type: 'CREATE',
      tempId: tempId,
      endpoint: '/api/caspio-proxy/tables/LPS_Services_LBW/records?response=rows',
      method: 'POST',
      data: lbwData,
      dependencies: [],
      status: 'pending',
      priority: 'high',
    });

    // CRITICAL: Cache placeholder to 'lbw_records' cache for Dexie-first pattern
    const serviceIdStr = String(lbwData.ServiceID);
    const existingLbwRecords = await this.indexedDb.getCachedServiceData(serviceIdStr, 'lbw_records') || [];
    await this.indexedDb.cacheServiceData(serviceIdStr, 'lbw_records', [...existingLbwRecords, placeholder]);

    // Clear in-memory cache
    if (lbwData.ServiceID) {
      this.lbwCache.delete(String(lbwData.ServiceID));
    }

    // Trigger sync on 60-second interval (batched sync)

    return placeholder;
  }

  /**
   * Update LBW record - OFFLINE-FIRST with background sync
   */
  async updateVisual(lbwId: string, updateData: any, serviceId?: string): Promise<any> {
    // WEBAPP MODE: Update directly via API
    if (environment.isWeb) {

      try {
        const response = await fetch(`${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_LBW/records?q.where=LBWID=${lbwId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to update LBW record: ${errorText}`);
        }


        // Clear in-memory cache
        this.lbwCache.clear();

        return { success: true, lbwId, ...updateData };
      } catch (error: any) {
        console.error('[LBW Data] WEBAPP: Error updating LBW record:', error?.message || error);
        throw error;
      }
    }

    // MOBILE MODE: Offline-first

    const isTempId = String(lbwId).startsWith('temp_');

    // OFFLINE-FIRST: Update 'lbw_records' cache immediately, queue for sync
    if (serviceId) {
      if (isTempId) {
        // Update pending request data
        await this.indexedDb.updatePendingRequestData(lbwId, updateData);
      } else {
        // Queue update for sync
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_LBW/records?q.where=LBWID=${lbwId}`,
          method: 'PUT',
          data: updateData,
          dependencies: [],
          status: 'pending',
          priority: 'normal',
        });
      }

      // Update 'lbw_records' cache with _localUpdate flag to preserve during background refresh
      const existingLbwRecords = await this.indexedDb.getCachedServiceData(serviceId, 'lbw_records') || [];
      let matchFound = false;
      const updatedRecords = existingLbwRecords.map((v: any) => {
        // Check BOTH PK_ID, LBWID, and _tempId since API may return any of these
        const vId = String(v.LBWID || v.PK_ID || v._tempId || '');
        if (vId === lbwId) {
          matchFound = true;
          return { ...v, ...updateData, _localUpdate: true };
        }
        return v;
      });

      if (!matchFound && isTempId) {
        // For temp IDs not in cache, add a new record
        updatedRecords.push({ ...updateData, _tempId: lbwId, PK_ID: lbwId, LBWID: lbwId, _localUpdate: true });
      }

      await this.indexedDb.cacheServiceData(serviceId, 'lbw_records', updatedRecords);
    } else {
      // If no serviceId, still queue for sync but skip cache update
      if (!isTempId) {
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_LBW/records?q.where=LBWID=${lbwId}`,
          method: 'PUT',
          data: updateData,
          dependencies: [],
          status: 'pending',
          priority: 'normal',
        });
      }
    }

    // Clear in-memory cache
    this.lbwCache.clear();

    // Sync will happen on next 60-second interval (batched sync)

    // Return immediately with the updated data
    return { success: true, lbwId, ...updateData };
  }

  // ============================================
  // LBW PHOTO METHODS - LOCAL-FIRST PATTERN
  // ============================================

  /**
   * Upload a photo for a LBW record - LOCAL-FIRST approach using LocalImageService
   * Uses stable UUIDs that never change, preventing image disappearance during sync.
   */
  async uploadVisualPhoto(lbwId: number | string, file: File, caption: string = '', drawings?: string, originalFile?: File, serviceId?: string): Promise<any> {

    const lbwIdStr = String(lbwId);
    const effectiveServiceId = serviceId || '';

    // Use LocalImageService for proper local-first handling with stable UUIDs
    const localImage = await this.localImageService.captureImage(
      file,
      'lbw',
      lbwIdStr,
      effectiveServiceId,
      caption || '',
      drawings || ''
    );

    // Get display URL (will be local blob URL)
    let displayUrl = await this.localImageService.getDisplayUrl(localImage);

    // US-001 FIX: If getDisplayUrl returns placeholder, create blob URL directly from file
    // This handles timing issues where the Dexie transaction may not have fully committed
    if (!displayUrl || displayUrl === 'assets/img/photo-placeholder.svg') {
      console.warn('[LBW Photo] US-001 FIX: getDisplayUrl returned placeholder, creating direct blob URL');
      displayUrl = URL.createObjectURL(file);
    }


    // Return immediately with stable imageId - NEVER WAIT FOR NETWORK
    return {
      // Stable identifiers (use imageId for trackBy)
      imageId: localImage.imageId,
      AttachID: localImage.imageId,
      attachId: localImage.imageId,
      _tempId: localImage.imageId,
      _pendingFileId: localImage.imageId,

      // Entity references
      LBWID: lbwIdStr,
      entityId: lbwIdStr,
      entityType: 'lbw',
      serviceId: effectiveServiceId,

      // Content
      Annotation: caption,
      caption: caption || '',
      drawings: drawings || '',
      fileName: localImage.fileName,
      fileSize: localImage.fileSize,

      // Display URLs (local blob - stable during sync)
      Photo: displayUrl,
      url: displayUrl,
      thumbnailUrl: displayUrl,
      displayUrl: displayUrl,
      _thumbnailUrl: displayUrl,

      // Status flags - SILENT SYNC: Don't show uploading/queued indicators
      status: localImage.status,
      _syncing: false,
      uploading: false,
      queued: false,
      isPending: localImage.status !== 'verified',
      isObjectUrl: true,
      isLocalFirst: true,
      localBlobId: localImage.localBlobId,
    };
  }

  async deleteVisualPhoto(attachId: string): Promise<any> {

    // Clear all attachment caches first (optimistic update)
    this.lbwAttachmentsCache.clear();

    // WEBAPP MODE: Delete immediately via direct API call
    if (environment.isWeb) {
      try {
        await firstValueFrom(this.caspioService.deleteServicesLBWAttach(String(attachId)));
        return { success: true, deleted: true };
      } catch (error) {
        console.error('[LBW Photo] WEBAPP: Failed to delete photo:', error);
        throw error;
      }
    }

    // MOBILE MODE: Queue delete for background sync
    await this.indexedDb.addPendingRequest({
      type: 'DELETE',
      endpoint: `/api/caspio-proxy/tables/LPS_Services_LBW_Attach/records?q.where=AttachID=${attachId}`,
      method: 'DELETE',
      data: { attachId },
      dependencies: [],
      status: 'pending',
      priority: 'normal',
    });

    return { success: true, queued: true };
  }

  /**
   * Queue caption update for background sync
   * ALWAYS queues to pendingCaptions store, regardless of online status or photo sync state
   * This ensures caption changes are NEVER lost due to race conditions
   *
   * @param attachId - The attachment ID (can be temp_xxx, img_xxx, or real ID)
   * @param caption - The new caption text
   * @param drawings - Optional annotation JSON data
   * @param metadata - Additional context (serviceId, lbwId)
   */
  async queueCaptionUpdate(
    attachId: string,
    caption: string,
    drawings?: string,
    metadata: { serviceId?: string; lbwId?: string } = {}
  ): Promise<string> {

    // 1. Update local cache immediately with _localUpdate flag
    await this.updateLocalCacheWithCaption(attachId, caption, drawings, metadata);

    // WEBAPP MODE: Call API directly for immediate persistence (if not a temp ID)
    const isTempId = String(attachId).startsWith('temp_') || String(attachId).startsWith('img_');
    if (environment.isWeb && !isTempId) {
      try {
        const updateData: any = { Annotation: caption };
        if (drawings !== undefined) {
          updateData.Drawings = drawings;
        }

        const response = await fetch(
          `${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_LBW_Attach/records?q.where=AttachID=${attachId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
          }
        );

        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }

        return `webapp_direct_${Date.now()}`;
      } catch (apiError: any) {
        console.error('[LBW Caption Queue] WEBAPP: API call failed, falling back to queue:', apiError?.message || apiError);
        // Fall through to queue-based approach
      }
    }

    // MOBILE MODE (or webapp fallback): Queue the caption update for background sync
    // ALWAYS queue - this is the authoritative source for caption data
    const captionId = await this.indexedDb.queueCaptionUpdate({
      attachId,
      attachType: 'lbw',
      caption,
      drawings,
      serviceId: metadata.serviceId,
      visualId: metadata.lbwId
    });


    // Sync will happen on next 60-second interval (batched sync)

    return captionId;
  }

  /**
   * Update photo caption (direct API call for WEBAPP, queued for MOBILE)
   * Used by lbw-category-detail for inline caption editing
   */
  async updateVisualPhotoCaption(attachId: string, caption: string): Promise<void> {
    await this.queueCaptionUpdate(attachId, caption);
  }

  /**
   * Update local IndexedDB cache with caption/drawings changes
   * Sets _localUpdate flag to prevent background refresh from overwriting
   * ROBUST: Updates multiple stores for redundancy - pendingCaptions is authoritative
   */
  private async updateLocalCacheWithCaption(
    attachId: string,
    caption: string,
    drawings?: string,
    metadata: { serviceId?: string; lbwId?: string } = {}
  ): Promise<void> {
    try {
      const attachIdStr = String(attachId);
      const isTempId = attachIdStr.startsWith('temp_') || attachIdStr.startsWith('img_');

      // For temp IDs, TRY to update the pending photo data in pendingImages store
      // This is a BEST-EFFORT update - pendingCaptions store is authoritative
      if (isTempId) {
        const updated = await this.indexedDb.updatePendingPhotoData(attachIdStr, {
          caption: caption,
          drawings: drawings
        });
        if (updated) {
        } else {
          // Photo might not be in pendingImages store yet or was already synced
          // This is OK - pendingCaptions store will handle it as the authoritative source
          console.warn(`[LBW Caption Cache] Photo ${attachIdStr} not found in pendingImages - relying on pendingCaptions as authoritative source`);
        }
        // DON'T return early - also try to update synced cache if it exists
        // This handles the edge case where photo synced but temp ID is still being used
      }

      // Update LocalImages table (works for both img_ IDs and temp_ IDs)
      try {
        const localImage = await db.localImages.get(attachIdStr);
        if (localImage) {
          const updateData: any = { caption, updatedAt: Date.now() };
          if (drawings !== undefined) {
            updateData.drawings = drawings;
          }
          await db.localImages.update(attachIdStr, updateData);
        }
      } catch (err) {
        console.warn('[LBW Caption Cache] Failed to update LocalImages:', err);
      }

      // For real IDs (or temp IDs that might have synced), update the lbw_attachments cache
      if (metadata.lbwId) {
        const cached = await this.indexedDb.getCachedServiceData(metadata.lbwId, 'lbw_attachments') || [];
        let foundInCache = false;
        const updatedCache = cached.map((att: any) => {
          if (String(att.AttachID) === attachIdStr || String(att.attachId) === attachIdStr || String(att.imageId) === attachIdStr) {
            foundInCache = true;
            const updated: any = { ...att, _localUpdate: true, _updatedAt: Date.now() };
            if (caption !== undefined) {
              updated.Annotation = caption;
              updated.caption = caption;
            }
            if (drawings !== undefined) {
              updated.Drawings = drawings;
              updated.drawings = drawings;
            }
            return updated;
          }
          return att;
        });
        if (foundInCache) {
          await this.indexedDb.cacheServiceData(metadata.lbwId, 'lbw_attachments', updatedCache);
          this.lbwAttachmentsCache.clear();
        } else if (!isTempId) {
          console.warn(`[LBW Caption Cache] Attachment ${attachIdStr} not found in LBW cache - pendingCaptions will handle it`);
        }
      }
    } catch (error) {
      console.warn('[LBW Caption Cache] Failed to update local cache:', error);
      // Continue anyway - pendingCaptions store is authoritative and will sync correctly
    }
  }

  /**
   * Get count of pending caption updates for sync status display
   */
  async getPendingCaptionCount(): Promise<number> {
    return this.indexedDb.getPendingCaptionCount();
  }

  /**
   * Clear cache for a specific LBW's attachments
   */
  clearLbwAttachmentsCache(lbwId?: string | number): void {
    if (lbwId) {
      const key = String(lbwId);
      this.lbwAttachmentsCache.delete(key);
    } else {
      this.lbwAttachmentsCache.clear();
    }
  }
}
