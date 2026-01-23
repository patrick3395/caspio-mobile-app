import { Injectable } from '@angular/core';
import { PlatformDetectionService } from '../../../services/platform-detection.service';
import { LocalImageService, ImageDisplayInfo } from '../../../services/local-image.service';
import { IndexedDbService, LocalImage, ImageEntityType } from '../../../services/indexed-db.service';
import { CaspioService } from '../../../services/caspio.service';
import { ImageCompressionService } from '../../../services/image-compression.service';
import { HudFieldRepoService } from './hud-field-repo.service';
import { compressAnnotationData, EMPTY_COMPRESSED_ANNOTATIONS } from '../../../utils/annotation-utils';
import { BehaviorSubject, Subject } from 'rxjs';

/**
 * HUD photo capture result for UI
 * Contains stable UUID and instant display URL
 */
export interface HudPhotoCaptureResult {
  imageId: string;              // Stable UUID that never changes (safe for UI key)
  displayUrl: string;           // Object URL for instant thumbnail display (ALWAYS local blob)
  status: 'local_only' | 'queued' | 'uploading' | 'uploaded' | 'verified' | 'failed';
  isLocal: boolean;             // Always true until verified
}

/**
 * HUD photo upload result after sync
 */
export interface HudPhotoUploadResult {
  imageId: string;
  attachId: string;
  s3Key: string;
  hudId: string;
}

/**
 * HudS3UploadService - HUD photo uploads with mobile-first offline support
 *
 * KEY DESIGN PRINCIPLES:
 * 1. Photos stored in LocalImages table IMMEDIATELY on capture
 * 2. Stable UUID generated once and NEVER changes (safe for UI key/trackBy)
 * 3. Object URL created for INSTANT thumbnail display
 * 4. displayUrl ALWAYS points to local blob - NEVER swapped to server URL
 * 5. MOBILE: Queue 3-step S3 upload process with dependency resolution
 * 6. WEBAPP: Direct upload without local storage
 *
 * 3-Step S3 Upload Process (Mobile):
 * 1. Create Caspio LPS_Services_HUD_Attach record -> returns AttachID
 * 2. Upload to S3 (uses {{req1.AttachID}} placeholder) -> returns s3Key
 * 3. Update Caspio record with S3 key (uses placeholders from req1 & req2)
 *
 * S3 Path Format: uploads/Services_HUD_Attach/{attachId}/{filename}
 */
@Injectable({
  providedIn: 'root'
})
export class HudS3UploadService {
  // Event emitted when a photo upload completes
  public uploadComplete$ = new Subject<HudPhotoUploadResult>();

  // Track pending uploads count for UI badge
  public pendingUploadCount$ = new BehaviorSubject<number>(0);

  constructor(
    private platform: PlatformDetectionService,
    private localImageService: LocalImageService,
    private indexedDb: IndexedDbService,
    private caspioService: CaspioService,
    private imageCompression: ImageCompressionService,
    private hudFieldRepo: HudFieldRepoService
  ) {
    // Subscribe to status changes to track upload completions
    this.localImageService.statusChange$.subscribe(async (change) => {
      if (change.newStatus === 'uploaded' || change.newStatus === 'verified') {
        // Get the image to check if it's a HUD image
        const image = await this.localImageService.getImage(change.imageId);
        if (image && image.entityType === 'hud') {
          this.uploadComplete$.next({
            imageId: change.imageId,
            attachId: change.attachId || '',
            s3Key: change.remoteS3Key || '',
            hudId: image.entityId
          });
        }
      }
    });

    // Update pending count on init
    this.updatePendingCount();
  }

  // ============================================================================
  // PLATFORM CHECK - Queue is MOBILE ONLY
  // ============================================================================

  /**
   * Check if queue-based uploads should be used
   * MOBILE: Uses local storage + queue for offline support
   * WEBAPP: Direct upload without local storage
   */
  isQueueEnabled(): boolean {
    return this.platform.isMobile();
  }

  // ============================================================================
  // PHOTO CAPTURE - Local-First Entry Point
  // ============================================================================

  /**
   * Capture a HUD photo - local-first with instant thumbnail
   *
   * MOBILE:
   * - Stores photo in LocalImages table immediately
   * - Generates stable UUID that NEVER changes
   * - Creates object URL for instant thumbnail display
   * - Queues for background S3 upload
   *
   * WEBAPP:
   * - Uploads directly to S3 without local storage
   * - Returns result with server AttachID
   *
   * @param file - The photo file to capture
   * @param hudId - The HUD ID (or temp HUD ID if visual not yet created)
   * @param serviceId - The service ID
   * @param caption - Optional photo caption
   * @param drawings - Optional annotation data
   * @param fieldKey - Optional HudField key for photo count tracking
   * @returns Capture result with stable imageId and instant displayUrl
   */
  async captureHudPhoto(
    file: File,
    hudId: string,
    serviceId: string,
    caption: string = '',
    drawings: string = '',
    fieldKey?: string
  ): Promise<HudPhotoCaptureResult> {
    console.log('[HudS3Upload] Capturing HUD photo for HUDID:', hudId, 'isMobile:', this.isQueueEnabled());

    // Validate file
    if (!file || file.size === 0) {
      throw new Error('Cannot capture empty photo - please try again');
    }

    if (this.isQueueEnabled()) {
      // MOBILE: Local-first capture with queue
      return this.capturePhotoMobile(file, hudId, serviceId, caption, drawings, fieldKey);
    } else {
      // WEBAPP: Direct upload without local storage
      return this.capturePhotoWebapp(file, hudId, serviceId, caption, drawings, fieldKey);
    }
  }

  /**
   * MOBILE: Capture photo with local storage and queue
   */
  private async capturePhotoMobile(
    file: File,
    hudId: string,
    serviceId: string,
    caption: string,
    drawings: string,
    fieldKey?: string
  ): Promise<HudPhotoCaptureResult> {
    console.log('[HudS3Upload] MOBILE: Storing photo locally first');

    // Compress the image for efficient storage
    let processedFile = file;
    try {
      processedFile = await this.imageCompression.compressImage(file, {
        maxSizeMB: 0.8,
        maxWidthOrHeight: 1280,
        useWebWorker: true
      }) as File;
      console.log('[HudS3Upload] Compressed:', file.size, '->', processedFile.size, 'bytes');
    } catch (err) {
      console.warn('[HudS3Upload] Compression failed, using original:', err);
    }

    // Process annotation data
    let processedDrawings = '';
    if (drawings && drawings.length > 0) {
      processedDrawings = compressAnnotationData(drawings, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });
    }

    // Store in LocalImages table - generates stable UUID
    const localImage = await this.localImageService.captureImage(
      processedFile,
      'hud',
      hudId,
      serviceId,
      caption,
      processedDrawings,
      null  // photoType not used for HUD
    );

    console.log('[HudS3Upload] MOBILE: ✅ Photo stored locally:', localImage.imageId);

    // Create object URL for instant display
    const displayUrl = await this.localImageService.getDisplayUrl(localImage);

    // Update photo count in HudFieldRepo if field key provided
    if (fieldKey) {
      const field = await this.hudFieldRepo.getField(fieldKey);
      if (field) {
        await this.hudFieldRepo.updatePhotoCount(fieldKey, (field.photoCount || 0) + 1);
      }
    }

    // Queue the 3-step S3 upload
    await this.queueHudPhotoUpload(localImage, hudId, processedFile, caption, processedDrawings, fieldKey);

    // Update pending count
    await this.updatePendingCount();

    return {
      imageId: localImage.imageId,
      displayUrl,
      status: localImage.status,
      isLocal: true
    };
  }

  /**
   * WEBAPP: Direct upload without local storage
   */
  private async capturePhotoWebapp(
    file: File,
    hudId: string,
    serviceId: string,
    caption: string,
    drawings: string,
    fieldKey?: string
  ): Promise<HudPhotoCaptureResult> {
    console.log('[HudS3Upload] WEBAPP: Uploading directly to S3');

    // Compress the image
    let processedFile = file;
    try {
      processedFile = await this.imageCompression.compressImage(file, {
        maxSizeMB: 0.8,
        maxWidthOrHeight: 1280,
        useWebWorker: true
      }) as File;
    } catch (err) {
      console.warn('[HudS3Upload] Compression failed, using original:', err);
    }

    // Process annotation data
    let processedDrawings = '';
    if (drawings && drawings.length > 0) {
      processedDrawings = compressAnnotationData(drawings, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });
    }

    // Create temporary blob URL for immediate display while uploading
    const tempDisplayUrl = URL.createObjectURL(processedFile);
    const tempImageId = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    try {
      // Upload directly using CaspioService
      const result = await this.caspioService.createServicesHUDAttachWithFile(
        parseInt(hudId, 10),
        caption,
        processedFile,
        processedDrawings
      ).toPromise();

      const attachId = result?.AttachID || result?.Result?.[0]?.AttachID;
      const s3Key = result?.Attachment || result?.Result?.[0]?.Attachment;

      console.log('[HudS3Upload] WEBAPP: ✅ Upload complete, AttachID:', attachId);

      // Emit upload complete event
      this.uploadComplete$.next({
        imageId: tempImageId,
        attachId: String(attachId),
        s3Key: s3Key || '',
        hudId
      });

      // CRITICAL: Keep displaying the local blob URL
      // The webapp doesn't need to swap to server URL since page will reload with server data
      return {
        imageId: tempImageId,
        displayUrl: tempDisplayUrl,  // Keep local blob for immediate display
        status: 'uploaded',
        isLocal: true
      };

    } catch (error: any) {
      console.error('[HudS3Upload] WEBAPP: ❌ Upload failed:', error);
      URL.revokeObjectURL(tempDisplayUrl);
      throw error;
    }
  }

  // ============================================================================
  // 3-STEP QUEUE PROCESS (Mobile Only)
  // ============================================================================

  /**
   * Queue the 3-step S3 upload process for a HUD photo
   *
   * Step 1: Create Caspio record -> returns AttachID
   * Step 2: Upload to S3 (uses {{req1.AttachID}}) -> returns s3Key
   * Step 3: Update record with S3 key (uses {{req1.AttachID}} and {{req2.s3Key}})
   */
  private async queueHudPhotoUpload(
    localImage: LocalImage,
    hudId: string,
    file: File,
    caption: string,
    drawings: string,
    fieldKey?: string
  ): Promise<void> {
    console.log('[HudS3Upload] Queuing 3-step upload for image:', localImage.imageId);

    // Convert file to base64 for queue storage
    const fileBase64 = await this.fileToBase64(file);

    // Check if HUD ID is temporary (HUD visual not created yet)
    const isHudTemp = hudId.startsWith('temp_') || hudId.startsWith('op_');
    let dependencies: string[] = [];

    if (isHudTemp) {
      // Find the HUD creation request to depend on
      const pending = await this.indexedDb.getPendingRequests();
      const hudRequest = pending.find(r => r.tempId === hudId);
      if (hudRequest) {
        dependencies.push(hudRequest.requestId);
        console.log('[HudS3Upload] Photo depends on HUD creation:', hudRequest.requestId);
      }
    }

    // Step 1: Create Caspio Attachment Record
    const req1Id = await this.indexedDb.addPendingRequest({
      type: 'CREATE',
      tempId: localImage.imageId,
      endpoint: '/api/caspio-proxy/tables/LPS_Services_HUD_Attach/records?response=rows',
      method: 'POST',
      data: {
        HUDID: isHudTemp ? `{{${dependencies[0]}.HUDID}}` : parseInt(hudId, 10),
        Annotation: caption || '',
        Drawings: drawings.length <= 64000 ? drawings : EMPTY_COMPRESSED_ANNOTATIONS,
        // Store metadata for LocalImage update on success (inside data object)
        _meta: {
          imageId: localImage.imageId,
          fieldKey
        }
      },
      dependencies: dependencies,
      status: 'pending',
      priority: 'high'
    });

    console.log('[HudS3Upload] Queued Step 1 (Create Record):', req1Id);

    // Step 2: Upload to S3 (depends on Step 1)
    const req2Id = await this.indexedDb.addPendingRequest({
      type: 'UPLOAD_FILE',
      endpoint: '/api/s3/upload',
      method: 'POST',
      data: {
        file: fileBase64,
        fileName: file.name || `hud_photo_${Date.now()}.jpg`,
        tableName: 'LPS_Services_HUD_Attach',
        attachId: `{{${req1Id}.AttachID}}`,  // Placeholder - resolved from req1 result
        hudId: isHudTemp ? `{{${dependencies[0]}.HUDID}}` : hudId,
        _meta: {
          imageId: localImage.imageId
        }
      },
      dependencies: [req1Id],
      status: 'pending',
      priority: 'high'
    });

    console.log('[HudS3Upload] Queued Step 2 (S3 Upload):', req2Id);

    // Step 3: Update Caspio with S3 Key (depends on Step 1 & 2)
    await this.indexedDb.addPendingRequest({
      type: 'UPDATE',
      endpoint: '/api/caspio-proxy/tables/LPS_Services_HUD_Attach/records',
      method: 'PUT',
      data: {
        attachId: `{{${req1Id}.AttachID}}`,  // From req1
        s3Key: `{{${req2Id}.s3Key}}`,        // From req2
        _meta: {
          imageId: localImage.imageId,
          fieldKey,
          isFinalStep: true  // Marker for sync service to update LocalImage
        }
      },
      dependencies: [req1Id, req2Id],
      status: 'pending',
      priority: 'normal'
    });

    console.log('[HudS3Upload] Queued Step 3 (Update S3 Key)');

    // Mark image as queued
    await this.localImageService.updateStatus(localImage.imageId, 'queued');

    console.log('[HudS3Upload] ✅ 3-step upload queued for image:', localImage.imageId);
  }

  // ============================================================================
  // DISPLAY URL MANAGEMENT
  // ============================================================================

  /**
   * Get display URL for a HUD photo
   * CRITICAL: Always returns local blob URL if available - NEVER swaps to server URL
   */
  async getDisplayUrl(imageId: string): Promise<string> {
    const image = await this.localImageService.getImage(imageId);
    if (!image) {
      return 'assets/img/photo-placeholder.png';
    }
    return this.localImageService.getDisplayUrl(image);
  }

  /**
   * Get full display info for a HUD photo
   */
  async getDisplayInfo(imageId: string): Promise<ImageDisplayInfo | null> {
    const image = await this.localImageService.getImage(imageId);
    if (!image) {
      return null;
    }
    return this.localImageService.getDisplayInfo(image);
  }

  /**
   * Get all HUD photos for a specific HUD record
   */
  async getPhotosForHud(hudId: string): Promise<LocalImage[]> {
    return this.localImageService.getImagesForEntity('hud', hudId);
  }

  /**
   * Get all HUD photos for a service
   */
  async getPhotosForService(serviceId: string): Promise<LocalImage[]> {
    return this.localImageService.getImagesForService(serviceId, 'hud');
  }

  // ============================================================================
  // SYNC HANDLERS - Called by BackgroundSyncService
  // ============================================================================

  /**
   * Handle successful upload completion
   * Called by BackgroundSyncService when 3-step process completes
   */
  async handleUploadSuccess(
    imageId: string,
    attachId: string,
    s3Key: string,
    hudId: string
  ): Promise<void> {
    console.log('[HudS3Upload] Upload success for image:', imageId, 'attachId:', attachId);

    // Update LocalImage with remote info
    await this.localImageService.markUploaded(imageId, s3Key, attachId);

    // Emit completion event
    this.uploadComplete$.next({
      imageId,
      attachId,
      s3Key,
      hudId
    });

    // Update pending count
    await this.updatePendingCount();
  }

  /**
   * Handle upload failure
   */
  async handleUploadFailure(imageId: string, error: string): Promise<void> {
    console.error('[HudS3Upload] Upload failed for image:', imageId, error);

    await this.localImageService.markFailed(imageId, error);
    await this.updatePendingCount();
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Convert File to base64 for queue storage
   */
  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Update pending upload count
   */
  private async updatePendingCount(): Promise<void> {
    if (!this.isQueueEnabled()) {
      this.pendingUploadCount$.next(0);
      return;
    }

    try {
      const images = await this.indexedDb.getLocalImagesForService('*', 'hud');
      const pending = images.filter(img =>
        img.status === 'local_only' || img.status === 'queued' || img.status === 'uploading'
      );
      this.pendingUploadCount$.next(pending.length);
    } catch (err) {
      console.warn('[HudS3Upload] Failed to update pending count:', err);
    }
  }

  /**
   * Delete a HUD photo
   */
  async deletePhoto(imageId: string): Promise<void> {
    console.log('[HudS3Upload] Deleting photo:', imageId);
    await this.localImageService.deleteLocalImage(imageId);
    await this.updatePendingCount();
  }

  /**
   * Get sync status for HUD photos in a service
   */
  async getSyncStatus(serviceId: string): Promise<{
    total: number;
    synced: number;
    pending: number;
    failed: number;
  }> {
    return this.localImageService.getServiceImageSyncStatus(serviceId);
  }
}
