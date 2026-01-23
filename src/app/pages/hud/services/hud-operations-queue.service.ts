import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { OperationsQueueService } from '../../../services/operations-queue.service';
import { CaspioService } from '../../../services/caspio.service';
import { PlatformDetectionService } from '../../../services/platform-detection.service';
import { HudFieldRepoService } from './hud-field-repo.service';
import { ImageCompressionService } from '../../../services/image-compression.service';
import { LocalImageService } from '../../../services/local-image.service';
import { IndexedDbService, ImageEntityType } from '../../../services/indexed-db.service';
import { compressAnnotationData, EMPTY_COMPRESSED_ANNOTATIONS } from '../../../utils/annotation-utils';

/**
 * Event emitted when a HUD operation completes
 * Used by BackgroundSyncService to notify UI components
 */
export interface HudSyncEvent {
  serviceId: string;
  fieldKey: string;
  hudId: string;
  operation: 'create' | 'update' | 'delete';
}

/**
 * HudOperationsQueueService - Operations queue integration for HUD (mobile only)
 *
 * CRITICAL: Operations queue is MOBILE ONLY - webapp does NOT use operations queue
 *
 * This service:
 * - Registers HUD-specific executors (CREATE_HUD_VISUAL, UPDATE_HUD_VISUAL, DELETE_HUD_VISUAL, UPLOAD_HUD_PHOTO)
 * - Provides methods to enqueue HUD operations with proper deduplication keys
 * - Implements dependency resolution for photo uploads (wait for visual creation)
 * - Integrates with HudFieldRepoService for Dexie-first architecture
 *
 * Operation Flow:
 * 1. User makes changes -> HudFieldRepoService marks field dirty
 * 2. Sync service detects dirty fields -> calls this service to enqueue operations
 * 3. Operations queue processes operations with retry logic
 * 4. On success -> HudFieldRepoService marks field synced
 */
@Injectable({
  providedIn: 'root'
})
export class HudOperationsQueueService {
  private executorsRegistered = false;

  // Event emitted when a HUD operation completes (create/update/delete)
  // BackgroundSyncService subscribes to this to forward events to hudSyncComplete$
  public syncComplete$ = new Subject<HudSyncEvent>();

  constructor(
    private operationsQueue: OperationsQueueService,
    private caspioService: CaspioService,
    private platform: PlatformDetectionService,
    private hudFieldRepo: HudFieldRepoService,
    private imageCompression: ImageCompressionService,
    private localImageService: LocalImageService,
    private indexedDb: IndexedDbService
  ) {}

  // ============================================================================
  // PLATFORM CHECK - Operations queue is MOBILE ONLY
  // ============================================================================

  /**
   * Check if operations queue should be used
   * CRITICAL: Only enabled on mobile (Capacitor native platform)
   * WEBAPP uses direct API calls without operations queue
   */
  isQueueEnabled(): boolean {
    return this.platform.isMobile();
  }

  // ============================================================================
  // EXECUTOR REGISTRATION - Called once on mobile app initialization
  // ============================================================================

  /**
   * Register HUD-specific executors with the operations queue
   * Should be called once during app initialization on mobile
   */
  registerExecutors(): void {
    // CRITICAL: Only register on mobile
    if (!this.isQueueEnabled()) {
      console.log('[HudOperationsQueue] Skipping executor registration - WEBAPP mode');
      return;
    }

    if (this.executorsRegistered) {
      console.log('[HudOperationsQueue] Executors already registered');
      return;
    }

    console.log('[HudOperationsQueue] Registering HUD executors...');

    // Register CREATE_HUD_VISUAL executor
    this.operationsQueue.setExecutor('CREATE_HUD_VISUAL', async (data: any) => {
      console.log('[HudOperationsQueue] Executing CREATE_HUD_VISUAL:', data.Name);

      const response = await this.caspioService.createServicesHUD(data).toPromise();

      if (!response) {
        throw new Error('No response from createServicesHUD');
      }

      const hudId = response.HUDID || response.PK_ID || response.id;
      if (!hudId) {
        console.error('[HudOperationsQueue] No HUDID in response:', response);
        throw new Error('HUDID not found in response');
      }

      console.log('[HudOperationsQueue] HUD visual created successfully:', hudId);
      return { hudId, response };
    });

    // Register UPDATE_HUD_VISUAL executor
    this.operationsQueue.setExecutor('UPDATE_HUD_VISUAL', async (data: any) => {
      console.log('[HudOperationsQueue] Executing UPDATE_HUD_VISUAL:', data.hudId);

      const { hudId, updateData } = data;
      const response = await this.caspioService.updateServicesHUD(hudId, updateData).toPromise();

      console.log('[HudOperationsQueue] HUD visual updated successfully');
      return { response };
    });

    // Register DELETE_HUD_VISUAL executor
    this.operationsQueue.setExecutor('DELETE_HUD_VISUAL', async (data: any) => {
      console.log('[HudOperationsQueue] Executing DELETE_HUD_VISUAL:', data.hudId);

      await this.caspioService.deleteServicesHUD(data.hudId).toPromise();

      console.log('[HudOperationsQueue] HUD visual deleted successfully');
      return { success: true };
    });

    // Register UPLOAD_HUD_PHOTO executor
    // This executor handles the upload when file is provided directly (legacy path)
    // For new local-first uploads, use HudS3UploadService which uses 3-step queue process
    this.operationsQueue.setExecutor('UPLOAD_HUD_PHOTO', async (data: any, onProgress?: (p: number) => void) => {
      console.log('[HudOperationsQueue] Executing UPLOAD_HUD_PHOTO for HUD:', data.hudId);

      // HUD-018: Resolve temp HUD ID to real ID if the parent HUD has been created
      // This handles the dependency chain: visual creation → photo upload
      let resolvedHudId = data.hudId;
      if (this.isTempHudId(data.hudId)) {
        const realId = await this.indexedDb.getRealId(data.hudId);
        if (realId) {
          console.log(`[HudOperationsQueue] Resolved temp HUD ID ${data.hudId} to ${realId}`);
          resolvedHudId = realId;
        } else {
          // HUD not yet created - this operation will fail, but retry will resolve it
          console.log(`[HudOperationsQueue] Temp HUD ID ${data.hudId} not yet resolved, will retry`);
          throw new Error(`HUD ${data.hudId} not yet created - waiting for sync`);
        }
      }

      // Check if this is a LocalImage-based upload (has imageId)
      if (data.imageId) {
        // Mark the LocalImage as uploading
        await this.localImageService.updateStatus(data.imageId, 'uploading');
      }

      // Compress the file first
      const compressedFile = await this.imageCompression.compressImage(data.file, {
        maxSizeMB: 0.8,
        maxWidthOrHeight: 1280,
        useWebWorker: true
      }) as File;

      if (onProgress) onProgress(0.3); // 30% after compression

      // Process annotation data
      let drawingsData = '';
      if (data.annotationData && data.annotationData !== null) {
        if (typeof data.annotationData === 'string') {
          drawingsData = data.annotationData;
        } else if (typeof data.annotationData === 'object') {
          drawingsData = JSON.stringify(data.annotationData);
        }
        if (drawingsData && drawingsData.length > 0) {
          drawingsData = compressAnnotationData(drawingsData, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });
        }
      }
      if (!drawingsData) {
        drawingsData = EMPTY_COMPRESSED_ANNOTATIONS;
      }

      if (onProgress) onProgress(0.5); // 50% before upload

      // Upload the photo using the resolved HUD ID
      const response = await this.caspioService.createServicesHUDAttachWithFile(
        parseInt(resolvedHudId, 10),
        data.caption || '',
        compressedFile,
        drawingsData
      ).toPromise();

      if (onProgress) onProgress(1.0); // 100% complete

      const attachId = response?.AttachID || response?.Result?.[0]?.AttachID || response?.PK_ID;
      const s3Key = response?.Attachment || response?.Result?.[0]?.Attachment;

      console.log('[HudOperationsQueue] HUD photo uploaded successfully:', attachId);

      // If this is a LocalImage-based upload, update the LocalImage status
      if (data.imageId && attachId) {
        await this.localImageService.markUploaded(data.imageId, s3Key || '', String(attachId));
      }

      return { attachId, s3Key, response };
    });

    this.executorsRegistered = true;
    console.log('[HudOperationsQueue] HUD executors registered successfully');
  }

  // ============================================================================
  // ENQUEUE OPERATIONS - With deduplication and dependency resolution
  // ============================================================================

  /**
   * Enqueue a CREATE_HUD_VISUAL operation
   *
   * @param serviceId - Service ID
   * @param category - Category name
   * @param templateId - Template ID
   * @param hudData - HUD data to create
   * @param fieldKey - HudField key for sync tracking
   * @param callbacks - Optional success/error/progress callbacks
   * @returns Operation ID for dependency tracking
   */
  async enqueueCreateHudVisual(
    serviceId: string,
    category: string,
    templateId: number,
    hudData: any,
    fieldKey: string,
    callbacks?: {
      onSuccess?: (result: any) => void;
      onError?: (error: any) => void;
    }
  ): Promise<string> {
    // CRITICAL: Only queue on mobile
    if (!this.isQueueEnabled()) {
      console.log('[HudOperationsQueue] Skipping enqueue - WEBAPP mode');
      throw new Error('Operations queue is only available on mobile');
    }

    // Deduplication key prevents duplicate create operations for same field
    const dedupeKey = `hud_create_${serviceId}_${category}_${templateId}`;

    const opId = await this.operationsQueue.enqueue({
      type: 'CREATE_HUD_VISUAL',
      data: {
        ...hudData,
        _meta: {
          serviceId,
          category,
          templateId,
          fieldKey
        }
      },
      dedupeKey,
      maxRetries: 3,
      onSuccess: async (result: any) => {
        console.log(`[HudOperationsQueue] CREATE_HUD_VISUAL success for ${fieldKey}:`, result.hudId);

        const realHudId = String(result.hudId);

        // HUD-018: Store temp ID → real ID mapping for reference resolution
        // This allows photos/attachments created with temp ID to be resolved later
        await this.indexedDb.mapTempId(opId, realHudId, 'hud');

        // HUD-018: Update LocalImages that reference this temp HUD ID
        await this.updateLocalImagesWithRealId(opId, realHudId);

        // Mark field as synced in HudFieldRepo (clears dirty flag)
        await this.hudFieldRepo.markSynced(fieldKey, realHudId);

        // Emit sync complete event for UI refresh
        this.syncComplete$.next({
          serviceId,
          fieldKey,
          hudId: realHudId,
          operation: 'create'
        });

        // Call user callback
        if (callbacks?.onSuccess) {
          callbacks.onSuccess(result);
        }
      },
      onError: (error: any) => {
        console.error(`[HudOperationsQueue] CREATE_HUD_VISUAL failed for ${fieldKey}:`, error);

        if (callbacks?.onError) {
          callbacks.onError(error);
        }
      }
    });

    // Set temp HUD ID for tracking while operation is pending
    await this.hudFieldRepo.setTempHudId(fieldKey, opId);

    console.log(`[HudOperationsQueue] Enqueued CREATE_HUD_VISUAL: ${opId} for ${fieldKey}`);
    return opId;
  }

  /**
   * Enqueue an UPDATE_HUD_VISUAL operation
   *
   * @param hudId - Existing HUD ID to update
   * @param updateData - Data to update
   * @param fieldKey - HudField key for sync tracking
   * @param callbacks - Optional success/error callbacks
   * @returns Operation ID
   */
  async enqueueUpdateHudVisual(
    hudId: string,
    updateData: any,
    fieldKey: string,
    callbacks?: {
      onSuccess?: (result: any) => void;
      onError?: (error: any) => void;
    }
  ): Promise<string> {
    if (!this.isQueueEnabled()) {
      throw new Error('Operations queue is only available on mobile');
    }

    // Extract serviceId from fieldKey (format: serviceId:category:templateId)
    const serviceId = fieldKey.split(':')[0];

    // Deduplication key: allow multiple updates but dedupe rapid-fire same-field updates
    const dedupeKey = `hud_update_${hudId}_${Date.now()}`;

    const opId = await this.operationsQueue.enqueue({
      type: 'UPDATE_HUD_VISUAL',
      data: {
        hudId,
        updateData,
        _meta: { fieldKey }
      },
      dedupeKey,
      maxRetries: 3,
      onSuccess: async (result: any) => {
        console.log(`[HudOperationsQueue] UPDATE_HUD_VISUAL success for ${fieldKey}`);

        // Mark field as synced (clears dirty flag)
        await this.hudFieldRepo.markSynced(fieldKey, hudId);

        // Emit sync complete event for UI refresh
        this.syncComplete$.next({
          serviceId,
          fieldKey,
          hudId,
          operation: 'update'
        });

        if (callbacks?.onSuccess) {
          callbacks.onSuccess(result);
        }
      },
      onError: (error: any) => {
        console.error(`[HudOperationsQueue] UPDATE_HUD_VISUAL failed for ${fieldKey}:`, error);

        if (callbacks?.onError) {
          callbacks.onError(error);
        }
      }
    });

    console.log(`[HudOperationsQueue] Enqueued UPDATE_HUD_VISUAL: ${opId} for hudId: ${hudId}`);
    return opId;
  }

  /**
   * Enqueue a DELETE_HUD_VISUAL operation
   *
   * @param hudId - HUD ID to delete
   * @param fieldKey - HudField key for cleanup
   * @param callbacks - Optional success/error callbacks
   * @returns Operation ID
   */
  async enqueueDeleteHudVisual(
    hudId: string,
    fieldKey: string,
    callbacks?: {
      onSuccess?: (result: any) => void;
      onError?: (error: any) => void;
    }
  ): Promise<string> {
    if (!this.isQueueEnabled()) {
      throw new Error('Operations queue is only available on mobile');
    }

    // Extract serviceId from fieldKey (format: serviceId:category:templateId)
    const serviceId = fieldKey.split(':')[0];

    // Deduplication: only one delete per hudId
    const dedupeKey = `hud_delete_${hudId}`;

    const opId = await this.operationsQueue.enqueue({
      type: 'DELETE_HUD_VISUAL',
      data: {
        hudId,
        _meta: { fieldKey }
      },
      dedupeKey,
      maxRetries: 3,
      onSuccess: (result: any) => {
        console.log(`[HudOperationsQueue] DELETE_HUD_VISUAL success for ${fieldKey}`);

        // Emit sync complete event for UI refresh
        this.syncComplete$.next({
          serviceId,
          fieldKey,
          hudId,
          operation: 'delete'
        });

        if (callbacks?.onSuccess) {
          callbacks.onSuccess(result);
        }
      },
      onError: (error: any) => {
        console.error(`[HudOperationsQueue] DELETE_HUD_VISUAL failed for ${fieldKey}:`, error);

        if (callbacks?.onError) {
          callbacks.onError(error);
        }
      }
    });

    console.log(`[HudOperationsQueue] Enqueued DELETE_HUD_VISUAL: ${opId} for hudId: ${hudId}`);
    return opId;
  }

  /**
   * Enqueue an UPLOAD_HUD_PHOTO operation with dependency on visual creation
   *
   * RECOMMENDED: For new implementations, use HudS3UploadService.captureHudPhoto()
   * which stores photos in LocalImages table first and uses the 3-step queue process.
   *
   * @param hudId - HUD ID (or temp ID if visual not yet created)
   * @param file - Photo file to upload
   * @param caption - Photo caption/annotation
   * @param annotationData - Drawing annotations (optional)
   * @param fieldKey - HudField key for tracking
   * @param dependsOnOpId - Operation ID to wait for (visual creation)
   * @param callbacks - Optional success/error/progress callbacks
   * @param imageId - Optional LocalImage ID for local-first uploads
   * @returns Operation ID
   */
  async enqueueUploadHudPhoto(
    hudId: string,
    file: File,
    caption: string,
    annotationData: any,
    fieldKey: string,
    dependsOnOpId?: string,
    callbacks?: {
      onSuccess?: (result: any) => void;
      onError?: (error: any) => void;
      onProgress?: (percent: number) => void;
    },
    imageId?: string  // LocalImage ID for local-first uploads
  ): Promise<string> {
    if (!this.isQueueEnabled()) {
      throw new Error('Operations queue is only available on mobile');
    }

    // Deduplication: prevent duplicate uploads of same photo
    // Use imageId if available (more stable), otherwise file name + size + field key
    const dedupeKey = imageId
      ? `hud_photo_${imageId}`
      : `hud_photo_${fieldKey}_${file.name}_${file.size}`;

    // Build dependencies array
    const dependencies: string[] = [];
    if (dependsOnOpId) {
      dependencies.push(dependsOnOpId);
    }

    const opId = await this.operationsQueue.enqueue({
      type: 'UPLOAD_HUD_PHOTO',
      data: {
        hudId,
        file,
        caption,
        annotationData,
        imageId,  // Pass imageId for LocalImage integration
        _meta: { fieldKey, imageId }
      },
      dedupeKey,
      dependencies,
      maxRetries: 3,
      onSuccess: async (result: any) => {
        console.log(`[HudOperationsQueue] UPLOAD_HUD_PHOTO success for ${fieldKey}:`, result.attachId);

        // Update photo count in HudFieldRepo
        const field = await this.hudFieldRepo.getField(fieldKey);
        if (field) {
          await this.hudFieldRepo.updatePhotoCount(fieldKey, (field.photoCount || 0) + 1);
        }

        if (callbacks?.onSuccess) {
          callbacks.onSuccess(result);
        }
      },
      onError: async (error: any) => {
        console.error(`[HudOperationsQueue] UPLOAD_HUD_PHOTO failed for ${fieldKey}:`, error);

        // If LocalImage-based upload, mark as failed
        if (imageId) {
          await this.localImageService.markFailed(imageId, error?.message || 'Upload failed');
        }

        if (callbacks?.onError) {
          callbacks.onError(error);
        }
      },
      onProgress: callbacks?.onProgress
    });

    console.log(`[HudOperationsQueue] Enqueued UPLOAD_HUD_PHOTO: ${opId} for hudId: ${hudId}${dependsOnOpId ? ` (depends on ${dependsOnOpId})` : ''}`);
    return opId;
  }

  // ============================================================================
  // SYNC HELPERS - For background sync service integration
  // ============================================================================

  /**
   * Process dirty HUD fields and enqueue appropriate operations
   * Called by background sync service when network is available
   *
   * @param serviceId - Service ID to sync
   * @returns Number of operations enqueued
   */
  async syncDirtyFields(serviceId: string): Promise<number> {
    if (!this.isQueueEnabled()) {
      return 0;
    }

    // Ensure executors are registered
    this.registerExecutors();

    const dirtyFields = await this.hudFieldRepo.getDirtyFields();
    const serviceFields = dirtyFields.filter(f => f.serviceId === serviceId);

    if (serviceFields.length === 0) {
      console.log(`[HudOperationsQueue] No dirty fields for service: ${serviceId}`);
      return 0;
    }

    console.log(`[HudOperationsQueue] Syncing ${serviceFields.length} dirty fields for service: ${serviceId}`);

    let enqueuedCount = 0;

    for (const field of serviceFields) {
      try {
        if (field.isSelected && !field.hudId && !field.tempHudId) {
          // New HUD visual needs to be created
          const hudData = {
            ServiceID: parseInt(serviceId, 10),
            Category: field.category,
            Name: field.templateName,
            Text: field.answer || field.templateText,
            Kind: field.kind,
            Answers: field.answer || ''
          };

          await this.enqueueCreateHudVisual(
            serviceId,
            field.category,
            field.templateId,
            hudData,
            field.key
          );
          enqueuedCount++;

        } else if (field.isSelected && field.hudId) {
          // Existing HUD visual needs to be updated
          const updateData = {
            Text: field.answer || field.templateText,
            Answers: field.answer || ''
          };

          await this.enqueueUpdateHudVisual(
            field.hudId,
            updateData,
            field.key
          );
          enqueuedCount++;

        } else if (!field.isSelected && field.hudId) {
          // HUD visual needs to be deleted (unchecked)
          await this.enqueueDeleteHudVisual(
            field.hudId,
            field.key
          );
          enqueuedCount++;
        }
      } catch (error) {
        console.error(`[HudOperationsQueue] Failed to enqueue operation for field ${field.key}:`, error);
      }
    }

    console.log(`[HudOperationsQueue] Enqueued ${enqueuedCount} operations for service: ${serviceId}`);
    return enqueuedCount;
  }

  // ============================================================================
  // HUD-018: TEMP ID RESOLUTION - Update references when temp ID resolves
  // ============================================================================

  /**
   * HUD-018: Update LocalImages that reference a temp HUD ID with the real ID
   * Called when CREATE_HUD_VISUAL completes successfully
   *
   * This handles the dependency chain: HUD visual → photos → annotations
   * Photos are stored in LocalImages with entityType='hud' and entityId=tempHudId
   * When the HUD visual gets a real ID, we update all associated photos
   *
   * @param tempHudId - The temporary HUD ID (operation ID)
   * @param realHudId - The real HUD ID from server
   */
  private async updateLocalImagesWithRealId(tempHudId: string, realHudId: string): Promise<void> {
    try {
      // Use IndexedDbService's updateEntityIdForImages which handles:
      // 1. Finding all LocalImages with the temp entityId
      // 2. Updating them to use the real ID
      // 3. Resetting upload outbox items so they process immediately
      const updatedCount = await this.indexedDb.updateEntityIdForImages(tempHudId, realHudId);

      if (updatedCount === 0) {
        console.log(`[HudOperationsQueue] No LocalImages to update for temp ID: ${tempHudId}`);
      } else {
        console.log(`[HudOperationsQueue] Updated ${updatedCount} LocalImages from tempId ${tempHudId} to realId ${realHudId}`);
      }
    } catch (error) {
      console.error(`[HudOperationsQueue] Failed to update LocalImages for temp ID ${tempHudId}:`, error);
      // Don't throw - photo entity updates are not critical for HUD creation
    }
  }

  /**
   * HUD-018: Resolve a temp HUD ID to its real ID
   * Used by photo upload operations that depend on HUD creation
   *
   * @param tempOrRealId - Either a temp ID (operation ID) or real HUD ID
   * @returns The real HUD ID, or the input if it's already a real ID
   */
  async resolveHudId(tempOrRealId: string): Promise<string> {
    // If it's not a temp ID pattern, return as-is (it's likely a real ID)
    if (!this.isTempId(tempOrRealId)) {
      return tempOrRealId;
    }

    // Try to get the real ID from mapping
    const realId = await this.indexedDb.getRealId(tempOrRealId);
    if (realId) {
      console.log(`[HudOperationsQueue] Resolved temp ID ${tempOrRealId} to real ID ${realId}`);
      return realId;
    }

    // Mapping not found yet - HUD might still be pending creation
    console.log(`[HudOperationsQueue] No mapping found for temp ID ${tempOrRealId}, returning as-is`);
    return tempOrRealId;
  }

  /**
   * HUD-018: Check if an ID is a temporary ID
   * Temp IDs are operation IDs or follow the temp_hud_timestamp_random pattern
   */
  private isTempId(id: string): boolean {
    return this.isTempHudId(id);
  }

  /**
   * HUD-018: Check if an ID is a temporary HUD ID
   * Temp HUD IDs can be:
   * 1. Operation IDs from the queue (UUID format with dashes)
   * 2. Format: temp_hud_{timestamp}_{random} from TempIdService
   * Real HUD IDs are numeric strings
   */
  private isTempHudId(id: string): boolean {
    if (!id || typeof id !== 'string') {
      return false;
    }
    // Real HUD IDs are purely numeric
    if (/^\d+$/.test(id)) {
      return false;
    }
    // Operation IDs contain dashes (UUID format) or start with temp_
    return id.startsWith('temp_') || id.includes('-');
  }

  /**
   * Get queue statistics for HUD operations
   */
  getQueueStats() {
    return this.operationsQueue.getStats();
  }

  /**
   * Check if queue has pending HUD operations
   */
  hasPendingOperations(): boolean {
    return this.operationsQueue.hasPending();
  }

  /**
   * Get all operations in queue
   */
  getAllOperations() {
    return this.operationsQueue.getAllOperations();
  }

  /**
   * Observable for queue state changes
   */
  get queue$() {
    return this.operationsQueue.queue$;
  }
}
