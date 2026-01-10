import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { 
  IndexedDbService, 
  LocalImage, 
  LocalBlob, 
  UploadOutboxItem,
  ImageStatus,
  ImageEntityType 
} from './indexed-db.service';
import { CaspioService } from './caspio.service';

/**
 * Image display info for UI rendering
 * Contains resolved URL and current state
 */
export interface ImageDisplayInfo {
  imageId: string;
  displayUrl: string;          // Ready-to-use URL (blob URL or signed S3 URL)
  isLocal: boolean;            // True if showing local blob
  isLoading: boolean;          // True if loading remote
  status: ImageStatus;
  hasError: boolean;
  errorMessage: string | null;
}

/**
 * Event emitted when an image's status changes
 */
export interface ImageStatusChange {
  imageId: string;
  oldStatus: ImageStatus;
  newStatus: ImageStatus;
  attachId?: string;           // Real AttachID after sync
  remoteS3Key?: string;        // S3 key after upload
}

/**
 * LocalImageService - Unified service for local-first image management
 * 
 * Key features:
 * - Stable UUIDs that never change (safe for UI keys)
 * - Status state machine: local_only -> queued -> uploading -> uploaded -> verified
 * - Always shows local blob until remote is verified
 * - Generates signed URLs at runtime (never stores them)
 */
@Injectable({
  providedIn: 'root'
})
export class LocalImageService {
  // Cache of blob URLs to avoid creating duplicates
  private blobUrlCache = new Map<string, string>();
  
  // Cache of signed S3 URLs with expiration
  private signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
  private readonly SIGNED_URL_CACHE_MS = 50 * 60 * 1000; // 50 minutes (S3 URLs last 60 min)
  
  // Status change events for UI updates
  public statusChange$ = new Subject<ImageStatusChange>();
  
  // Pending upload count for UI badges
  public pendingUploadCount$ = new BehaviorSubject<number>(0);

  constructor(
    private indexedDb: IndexedDbService,
    private caspioService: CaspioService
  ) {
    // Update pending count on init
    this.updatePendingCount();
  }

  // ============================================================================
  // IMAGE CAPTURE (Local-First Entry Point)
  // ============================================================================

  /**
   * Capture a new image - fully local-first
   * Immediately stores locally and queues for upload
   * Returns stable imageId that can be used as UI key
   */
  async captureImage(
    file: File,
    entityType: ImageEntityType,
    entityId: string,
    serviceId: string,
    caption: string = '',
    drawings: string = ''
  ): Promise<LocalImage> {
    console.log('[LocalImage] Capturing image for', entityType, entityId);
    
    const image = await this.indexedDb.createLocalImage(
      file,
      entityType,
      entityId,
      serviceId,
      caption,
      drawings
    );
    
    // Update pending count
    await this.updatePendingCount();
    
    console.log('[LocalImage] ✅ Image captured:', image.imageId, 'status:', image.status);
    return image;
  }

  // ============================================================================
  // DISPLAY URL RESOLUTION (Deterministic, Never Breaks)
  // ============================================================================

  /**
   * Get display URL for an image - BULLETPROOF
   * Follows deterministic decision tree:
   * 1. If local blob exists -> use local (ALWAYS)
   * 2. If remote verified AND loaded in UI -> use signed S3 URL
   * 3. Otherwise -> placeholder
   * 
   * NEVER causes broken images or disappearing photos
   */
  async getDisplayUrl(image: LocalImage): Promise<string> {
    // Rule 1: ALWAYS prefer local blob if it exists
    // This is the key to preventing disappearing photos
    if (image.localBlobId) {
      const blobUrl = await this.getBlobUrl(image.localBlobId);
      if (blobUrl) {
        return blobUrl;
      }
    }
    
    // Rule 2: Only use remote if BOTH verified AND already loaded in UI
    // This prevents switching to a broken remote URL
    if (image.remoteS3Key && image.status === 'verified' && image.remoteLoadedInUI) {
      try {
        const signedUrl = await this.getSignedUrl(image.remoteS3Key);
        return signedUrl;
      } catch (err) {
        console.warn('[LocalImage] Failed to get signed URL:', err);
        // Fall through to placeholder
      }
    }
    
    // Rule 3: If we have a remote key but haven't verified it yet, try to load
    // But DON'T use it for display - just return placeholder
    // The UI will switch once remote is verified and loaded
    if (image.remoteS3Key && image.status === 'uploaded') {
      // Trigger verification in background (non-blocking)
      this.verifyRemoteImage(image.imageId).catch(() => {});
    }
    
    // Rule 4: Placeholder (should be rare if local-first is working)
    return 'assets/img/photo-placeholder.png';
  }

  /**
   * Get full display info for an image (for UI rendering)
   */
  async getDisplayInfo(image: LocalImage): Promise<ImageDisplayInfo> {
    const displayUrl = await this.getDisplayUrl(image);
    const isLocal = !!image.localBlobId && displayUrl.startsWith('blob:');
    const isLoading = image.status === 'uploading' || image.status === 'queued';
    
    return {
      imageId: image.imageId,
      displayUrl,
      isLocal,
      isLoading,
      status: image.status,
      hasError: image.status === 'failed',
      errorMessage: image.lastError
    };
  }

  /**
   * Get blob URL with caching (avoids duplicate URL creation)
   */
  private async getBlobUrl(blobId: string): Promise<string | null> {
    // Check cache first
    if (this.blobUrlCache.has(blobId)) {
      return this.blobUrlCache.get(blobId)!;
    }
    
    // Get from IndexedDB
    const url = await this.indexedDb.getLocalBlobUrl(blobId);
    if (url) {
      this.blobUrlCache.set(blobId, url);
    }
    return url;
  }

  /**
   * Get signed S3 URL with caching
   * Generates at runtime, caches for 50 minutes
   */
  private async getSignedUrl(s3Key: string): Promise<string> {
    const now = Date.now();
    
    // Check cache
    const cached = this.signedUrlCache.get(s3Key);
    if (cached && cached.expiresAt > now) {
      return cached.url;
    }
    
    // Generate new signed URL
    const url = await this.caspioService.getS3FileUrl(s3Key);
    
    // Cache it
    this.signedUrlCache.set(s3Key, {
      url,
      expiresAt: now + this.SIGNED_URL_CACHE_MS
    });
    
    return url;
  }

  // ============================================================================
  // IMAGE RETRIEVAL
  // ============================================================================

  /**
   * Get an image by ID
   */
  async getImage(imageId: string): Promise<LocalImage | null> {
    return this.indexedDb.getLocalImage(imageId);
  }

  /**
   * Get all images for an entity (visual, point, etc.)
   */
  async getImagesForEntity(entityType: ImageEntityType, entityId: string): Promise<LocalImage[]> {
    return this.indexedDb.getLocalImagesForEntity(entityType, entityId);
  }

  /**
   * Get all images for a service
   */
  async getImagesForService(serviceId: string, entityType?: ImageEntityType): Promise<LocalImage[]> {
    return this.indexedDb.getLocalImagesForService(serviceId, entityType);
  }

  /**
   * Get image by Caspio AttachID (for sync lookups)
   */
  async getImageByAttachId(attachId: string): Promise<LocalImage | null> {
    return this.indexedDb.getLocalImageByAttachId(attachId);
  }

  /**
   * Regenerate blob URLs for images (called on page return)
   * This is critical for local-first persistence - when navigating back to a page,
   * we need fresh blob URLs since any previous ones may have been revoked.
   * Returns map of imageId -> fresh blob URL
   */
  async refreshBlobUrlsForImages(images: LocalImage[]): Promise<Map<string, string>> {
    const urlMap = new Map<string, string>();
    for (const image of images) {
      if (image.localBlobId) {
        // Force regenerate from IndexedDB (bypass stale cache)
        const url = await this.indexedDb.getLocalBlobUrl(image.localBlobId);
        if (url) {
          this.blobUrlCache.set(image.localBlobId, url);
          urlMap.set(image.imageId, url);
        }
      }
    }
    return urlMap;
  }

  // ============================================================================
  // STATUS MANAGEMENT
  // ============================================================================

  /**
   * Update image status
   */
  async updateStatus(
    imageId: string, 
    status: ImageStatus, 
    additionalUpdates?: Partial<LocalImage>
  ): Promise<void> {
    const existing = await this.indexedDb.getLocalImage(imageId);
    if (!existing) {
      console.warn('[LocalImage] Image not found for status update:', imageId);
      return;
    }
    
    const oldStatus = existing.status;
    
    await this.indexedDb.updateLocalImage(imageId, {
      status,
      ...additionalUpdates
    });
    
    // Emit status change event
    this.statusChange$.next({
      imageId,
      oldStatus,
      newStatus: status,
      attachId: additionalUpdates?.attachId || existing.attachId || undefined,
      remoteS3Key: additionalUpdates?.remoteS3Key || existing.remoteS3Key || undefined
    });
    
    console.log('[LocalImage] Status updated:', imageId, oldStatus, '->', status);
    
    // Update pending count if status changed to/from upload states
    if (oldStatus !== status) {
      await this.updatePendingCount();
    }
  }

  /**
   * Mark image as uploaded (after S3 success)
   */
  async markUploaded(imageId: string, remoteS3Key: string, attachId: string): Promise<void> {
    await this.updateStatus(imageId, 'uploaded', {
      remoteS3Key,
      attachId
    });
  }

  /**
   * Mark image as verified (after confirming remote is loadable)
   */
  async markVerified(imageId: string): Promise<void> {
    await this.indexedDb.updateLocalImage(imageId, {
      status: 'verified',
      remoteVerifiedAt: Date.now()
    });
    
    console.log('[LocalImage] ✅ Image verified:', imageId);
    
    // Emit status change
    const image = await this.getImage(imageId);
    if (image) {
      this.statusChange$.next({
        imageId,
        oldStatus: 'uploaded',
        newStatus: 'verified',
        attachId: image.attachId || undefined,
        remoteS3Key: image.remoteS3Key || undefined
      });
    }
  }

  /**
   * Mark image as loaded in UI (remote image successfully rendered)
   * ONLY after this can we safely prune the local blob
   */
  async markRemoteLoadedInUI(imageId: string): Promise<void> {
    await this.indexedDb.updateLocalImage(imageId, {
      remoteLoadedInUI: true
    });
    console.log('[LocalImage] ✅ Remote image loaded in UI:', imageId);
  }

  /**
   * Verify that a remote image is actually loadable
   * Uses HEAD request or Image element to confirm S3 image works
   */
  async verifyRemoteImage(imageId: string): Promise<boolean> {
    const image = await this.getImage(imageId);
    if (!image || !image.remoteS3Key) {
      return false;
    }

    // Skip if already verified
    if (image.status === 'verified') {
      return true;
    }

    try {
      // Get signed URL
      const signedUrl = await this.getSignedUrl(image.remoteS3Key);
      
      // Verify by loading as image
      const isLoadable = await new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = signedUrl;
        // Timeout after 10 seconds
        setTimeout(() => resolve(false), 10000);
      });

      if (isLoadable) {
        await this.markVerified(imageId);
        return true;
      } else {
        console.warn('[LocalImage] Remote image not loadable:', imageId);
        return false;
      }
    } catch (err) {
      console.error('[LocalImage] Verification failed:', imageId, err);
      return false;
    }
  }

  /**
   * Mark image as failed
   */
  async markFailed(imageId: string, error: string): Promise<void> {
    await this.updateStatus(imageId, 'failed', {
      lastError: error
    });
  }

  // ============================================================================
  // CAPTION/DRAWINGS UPDATE
  // ============================================================================

  /**
   * Update caption and/or drawings for an image
   */
  async updateCaptionAndDrawings(
    imageId: string,
    caption?: string,
    drawings?: string
  ): Promise<void> {
    const updates: Partial<LocalImage> = {};
    if (caption !== undefined) updates.caption = caption;
    if (drawings !== undefined) updates.drawings = drawings;
    
    await this.indexedDb.updateLocalImage(imageId, updates);
    console.log('[LocalImage] Caption/drawings updated:', imageId);
  }

  // ============================================================================
  // BLOB PRUNING
  // ============================================================================

  /**
   * Prune local blob for a verified image
   * Only prunes if:
   * - Status is 'verified'
   * - Remote has been successfully loaded in UI
   */
  async pruneLocalBlob(imageId: string): Promise<boolean> {
    const image = await this.getImage(imageId);
    if (!image) {
      console.warn('[LocalImage] Image not found for pruning:', imageId);
      return false;
    }
    
    // Safety checks
    if (image.status !== 'verified') {
      console.warn('[LocalImage] Cannot prune unverified image:', imageId);
      return false;
    }
    
    if (!image.remoteLoadedInUI) {
      console.warn('[LocalImage] Cannot prune - remote not loaded in UI yet:', imageId);
      return false;
    }
    
    if (!image.localBlobId) {
      console.log('[LocalImage] Image already pruned:', imageId);
      return true;
    }
    
    // Revoke cached blob URL if exists
    const cachedUrl = this.blobUrlCache.get(image.localBlobId);
    if (cachedUrl) {
      URL.revokeObjectURL(cachedUrl);
      this.blobUrlCache.delete(image.localBlobId);
    }
    
    // Prune via IndexedDB
    await this.indexedDb.pruneLocalBlob(imageId);
    
    console.log('[LocalImage] ✅ Blob pruned:', imageId);
    return true;
  }

  /**
   * Prune all eligible blobs for a service
   * Called periodically to free storage
   */
  async pruneEligibleBlobs(serviceId: string): Promise<number> {
    const images = await this.getImagesForService(serviceId);
    let prunedCount = 0;
    
    for (const image of images) {
      if (image.status === 'verified' && image.remoteLoadedInUI && image.localBlobId) {
        const pruned = await this.pruneLocalBlob(image.imageId);
        if (pruned) prunedCount++;
      }
    }
    
    if (prunedCount > 0) {
      console.log('[LocalImage] Pruned', prunedCount, 'blobs for service', serviceId);
    }
    
    return prunedCount;
  }

  // ============================================================================
  // UPLOAD OUTBOX
  // ============================================================================

  /**
   * Get pending upload items ready to process
   */
  async getReadyUploads(): Promise<UploadOutboxItem[]> {
    return this.indexedDb.getReadyUploadOutboxItems();
  }

  /**
   * Mark upload as in progress
   */
  async markUploadStarted(opId: string, imageId: string): Promise<void> {
    await this.indexedDb.updateOutboxItem(opId, {
      attempts: (await this.indexedDb.getOutboxItemForImage(imageId))?.attempts ?? 0 + 1
    });
    await this.updateStatus(imageId, 'uploading');
  }

  /**
   * Handle upload success
   */
  async handleUploadSuccess(opId: string, imageId: string, remoteS3Key: string, attachId: string): Promise<void> {
    // Update image with remote info
    await this.markUploaded(imageId, remoteS3Key, attachId);
    
    // Remove from outbox
    await this.indexedDb.removeOutboxItem(opId);
    
    await this.updatePendingCount();
  }

  /**
   * Handle upload failure - schedule retry
   */
  async handleUploadFailure(opId: string, imageId: string, error: string): Promise<void> {
    const item = await this.indexedDb.getOutboxItemForImage(imageId);
    if (!item) return;
    
    const attempts = item.attempts + 1;
    const backoffMs = this.calculateBackoff(attempts);
    
    await this.indexedDb.updateOutboxItem(opId, {
      attempts,
      nextRetryAt: Date.now() + backoffMs,
      lastError: error
    });
    
    // Only mark as failed after many retries
    if (attempts >= 10) {
      await this.markFailed(imageId, `Upload failed after ${attempts} attempts: ${error}`);
    } else {
      // Keep as queued for retry
      await this.updateStatus(imageId, 'queued', { lastError: error });
    }
  }

  /**
   * Calculate exponential backoff for retries
   */
  private calculateBackoff(attempts: number): number {
    // 30s, 1m, 2m, 5m, 10m, 10m, 10m, 10m, 10m, 10m
    const delays = [30000, 60000, 120000, 300000, 600000];
    const index = Math.min(attempts - 1, delays.length - 1);
    return delays[index];
  }

  /**
   * Update pending upload count
   */
  private async updatePendingCount(): Promise<void> {
    const count = await this.indexedDb.getUploadOutboxCount();
    this.pendingUploadCount$.next(count);
  }

  /**
   * Test if an image URL is loadable
   */
  private testImageLoad(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const img = new Image();
      const timeout = setTimeout(() => {
        img.onload = null;
        img.onerror = null;
        resolve(false);
      }, 15000); // 15 second timeout
      
      img.onload = () => {
        clearTimeout(timeout);
        resolve(true);
      };
      
      img.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
      
      img.src = url;
    });
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Revoke all cached blob URLs (call on page destroy)
   */
  revokeAllBlobUrls(): void {
    for (const url of this.blobUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobUrlCache.clear();
  }

  /**
   * Clear signed URL cache
   */
  clearSignedUrlCache(): void {
    this.signedUrlCache.clear();
  }
}

