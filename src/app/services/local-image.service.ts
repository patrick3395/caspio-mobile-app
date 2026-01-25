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

  // Cache of display URLs (keyed by imageId) to avoid repeated async lookups
  // This memoizes getDisplayUrl() results for faster repeat calls
  private displayUrlCache = new Map<string, { url: string; cachedAt: number }>();
  private readonly DISPLAY_URL_CACHE_MS = 30 * 1000; // 30 seconds - short-lived for freshness

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
    drawings: string = '',
    photoType: string | null = null  // 'Measurement' | 'Location' for EFE, 'Top' | 'Bottom' | 'Threshold' for FDF
  ): Promise<LocalImage> {
    console.log('[LocalImage] Capturing image for', entityType, entityId, 'photoType:', photoType);
    
    const image = await this.indexedDb.createLocalImage(
      file,
      entityType,
      entityId,
      serviceId,
      caption,
      drawings,
      photoType
    );
    
    // Update pending count
    await this.updatePendingCount();
    
    console.log('[LocalImage] ✅ Image captured:', image.imageId, 'status:', image.status, 'photoType:', photoType);
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
   * Uses memoization cache for faster repeat calls (30 second TTL)
   */
  async getDisplayUrl(image: LocalImage): Promise<string> {
    // Fast path: Check memoization cache first (avoids repeated async operations)
    const now = Date.now();
    const cached = this.displayUrlCache.get(image.imageId);
    if (cached && (now - cached.cachedAt) < this.DISPLAY_URL_CACHE_MS) {
      return cached.url;
    }

    // TASK 4 FIX: Check for cached ANNOTATED image FIRST (before local blob)
    // This ensures annotated thumbnails persist after page reload
    // Must check BOTH imageId and attachId since annotations can be cached with either
    const hasAnnotations = image.drawings && image.drawings.length > 10;
    // Helper to cache and return result
    const cacheAndReturn = (url: string): string => {
      // Don't cache placeholders - they should be re-evaluated
      if (url !== 'assets/img/photo-placeholder.png') {
        this.displayUrlCache.set(image.imageId, { url, cachedAt: now });
      }
      return url;
    };

    if (hasAnnotations) {
      // Try imageId first (for local-first images before sync)
      const annotatedByImageId = await this.indexedDb.getCachedAnnotatedImage(image.imageId);
      if (annotatedByImageId) {
        console.log('[LocalImage] ✅ Using cached ANNOTATED image (by imageId) for:', image.imageId);
        return cacheAndReturn(annotatedByImageId);
      }
      // Try attachId (for synced images)
      if (image.attachId) {
        const annotatedByAttachId = await this.indexedDb.getCachedAnnotatedImage(String(image.attachId));
        if (annotatedByAttachId) {
          console.log('[LocalImage] ✅ Using cached ANNOTATED image (by attachId) for:', image.imageId, 'attachId:', image.attachId);
          return cacheAndReturn(annotatedByAttachId);
        }
      }
      console.log('[LocalImage] Image has annotations but no cached annotated image found:', image.imageId);
    }

    // Rule 1: ALWAYS prefer local blob if it exists
    // This is the key to preventing disappearing photos
    if (image.localBlobId) {
      const blobUrl = await this.getBlobUrl(image.localBlobId);
      if (blobUrl) {
        return cacheAndReturn(blobUrl);
      }
      // Blob was referenced but not found - this is expected after pruning
      // Clear the stale reference in memory to avoid repeated lookups
      console.log('[LocalImage] Blob pruned, falling back for:', image.imageId, 'blobId:', image.localBlobId);
    }

    // Rule 1.5: Try thumbnail blob if full-res was soft-purged (Phase 2 storage bloat prevention)
    // Thumbnail survives soft purge and provides fast local fallback before hitting S3
    if (image.thumbBlobId) {
      const thumbUrl = await this.getBlobUrl(image.thumbBlobId);
      if (thumbUrl) {
        console.log('[LocalImage] ✅ Using thumbnail fallback for:', image.imageId, 'thumbBlobId:', image.thumbBlobId);
        return cacheAndReturn(thumbUrl);
      }
    }

    // US-003 FIX: ALWAYS check for cached annotated image by imageId first
    // This is critical for local-first photos where annotations are cached by imageId (not attachId)
    // even if hasAnnotations flag was false (drawings field may not be persisted yet)
    try {
      const annotatedByImageIdFallback = await this.indexedDb.getCachedAnnotatedImage(image.imageId);
      if (annotatedByImageIdFallback) {
        console.log('[LocalImage] ✅ US-003 FIX: Using cached ANNOTATED image (fallback by imageId) for:', image.imageId);
        return cacheAndReturn(annotatedByImageIdFallback);
      }
    } catch (err) {
      // Continue to next fallback
    }

    // Rule 2: Try cached base64 from IndexedDB (synced photos)
    // CRITICAL: This is the primary fallback after local blob is pruned
    if (image.attachId) {
      try {
        // TASK 4: Also try annotated image cache even if no drawings field set
        // (in case annotations were added before drawings was persisted)
        const cachedAnnotated = await this.indexedDb.getCachedAnnotatedImage(String(image.attachId));
        if (cachedAnnotated) {
          console.log('[LocalImage] ✅ Using cached ANNOTATED image (fallback) for:', image.imageId, 'attachId:', image.attachId);
          return cacheAndReturn(cachedAnnotated);
        }

        const cachedPhoto = await this.indexedDb.getCachedPhoto(String(image.attachId));
        if (cachedPhoto) {
          console.log('[LocalImage] ✅ Using cached base64 for:', image.imageId, 'attachId:', image.attachId);
          return cacheAndReturn(cachedPhoto);
        } else {
          console.log('[LocalImage] No cached photo found for attachId:', image.attachId);
        }
      } catch (err) {
        console.warn('[LocalImage] Failed to get cached photo:', err);
      }
    }

    // Rule 3: Only use remote if BOTH verified AND already loaded in UI
    // This prevents switching to a broken remote URL
    if (image.remoteS3Key && image.status === 'verified' && image.remoteLoadedInUI) {
      try {
        const signedUrl = await this.getSignedUrl(image.remoteS3Key);
        return cacheAndReturn(signedUrl);
      } catch (err) {
        console.warn('[LocalImage] Failed to get signed URL:', err);
        // Fall through to next fallback
      }
    }

    // Rule 4: Try remote S3 for verified or uploaded images
    // CRITICAL FIX: Also try for 'uploaded' status (after sync but before verification)
    if (image.remoteS3Key && (image.status === 'verified' || image.status === 'uploaded')) {
      try {
        console.log('[LocalImage] Trying remote S3 URL for:', image.imageId, 'status:', image.status);
        const signedUrl = await this.getSignedUrl(image.remoteS3Key);

        // Mark that we successfully used remote URL
        if (image.status === 'verified' && !image.remoteLoadedInUI) {
          this.markRemoteLoadedInUI(image.imageId).catch(() => {});
        }

        return cacheAndReturn(signedUrl);
      } catch (err) {
        console.warn('[LocalImage] S3 URL failed:', err);
        // Fall through to next fallback
      }
    }

    // Rule 5: For images still uploading, trigger verification if we have S3 key
    if (image.remoteS3Key && image.status === 'uploading') {
      // Trigger verification in background (non-blocking)
      this.verifyRemoteImage(image.imageId).catch(() => {});
    }

    // Rule 6: Placeholder (should be rare if local-first is working correctly)
    console.warn('[LocalImage] ⚠️ No display URL available for:', image.imageId,
      'status:', image.status,
      'localBlobId:', image.localBlobId,
      'attachId:', image.attachId,
      'remoteS3Key:', image.remoteS3Key ? 'present' : 'none');
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

  /**
   * Invalidate display URL cache for an image
   * Call this when image status changes (sync completes, annotations added, etc.)
   */
  invalidateDisplayUrlCache(imageId: string): void {
    this.displayUrlCache.delete(imageId);
  }

  /**
   * Clear all display URL caches
   * Useful when navigating away from a page or after major state changes
   */
  clearDisplayUrlCache(): void {
    this.displayUrlCache.clear();
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
    // Generate and store the remote URL for finalization
    let remoteUrl: string | null = null;
    try {
      remoteUrl = await this.caspioService.getS3FileUrl(remoteS3Key);
    } catch (err) {
      console.warn('[LocalImage] Failed to generate remoteUrl:', err);
    }

    await this.updateStatus(imageId, 'uploaded', {
      remoteS3Key,
      attachId,
      isSynced: true,
      remoteUrl
    });

    // CRITICAL FIX: Transfer annotated image cache from imageId to attachId
    // This ensures annotations persist in thumbnails after local-first photo syncs
    // STORAGE OPTIMIZED: Use pointer instead of duplicating full image data
    if (attachId && attachId !== imageId) {
      try {
        // Get the LocalImage to find the blobId
        const image = await this.indexedDb.getLocalImage(imageId);
        if (image?.localBlobId) {
          // DEXIE-FIRST: Create pointer for attachId pointing to same blob
          await this.indexedDb.cacheAnnotatedPointer(attachId, image.localBlobId);
          console.log('[LocalImage] ✅ Transferred annotated pointer:', imageId, '->', attachId, '(same blobId:', image.localBlobId, ')');
        } else {
          // FALLBACK: Legacy path - copy the full data if no local blob
          const cachedAnnotatedImage = await this.indexedDb.getCachedAnnotatedImage(imageId);
          if (cachedAnnotatedImage) {
            const response = await fetch(cachedAnnotatedImage);
            const blob = await response.blob();
            await this.indexedDb.cacheAnnotatedImage(attachId, blob);
            console.log('[LocalImage] ✅ Transferred annotated image (legacy):', imageId, '->', attachId);
          }
        }
      } catch (err) {
        console.warn('[LocalImage] Failed to transfer annotated image cache:', err);
      }
    }
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

    // US-002 FIX: Invalidate displayUrlCache so stale blob URL is not returned
    // This prevents the cached (now revoked) blob URL from being returned
    this.displayUrlCache.delete(imageId);

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
   * US-001 FIX: Also track upload start time to detect stuck uploads on mobile
   */
  async markUploadStarted(opId: string, imageId: string): Promise<void> {
    const item = await this.indexedDb.getOutboxItemForImage(imageId);
    await this.indexedDb.updateOutboxItem(opId, {
      attempts: (item?.attempts ?? 0) + 1
    });
    // US-001 FIX: Update updatedAt to track when upload started
    // This allows detection of uploads that have been 'uploading' for too long
    await this.updateStatus(imageId, 'uploading', { updatedAt: Date.now() });
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
   * US-001 FIX: Don't increment attempts here since markUploadStarted already did
   * US-001 FIX: Always update LocalImage status even if outbox item is missing
   */
  async handleUploadFailure(opId: string, imageId: string, error: string): Promise<void> {
    const item = await this.indexedDb.getOutboxItemForImage(imageId);

    // US-001 FIX: Even if outbox item not found, still update the LocalImage status with error
    // This ensures the error is visible in the UI for debugging mobile issues
    if (!item) {
      console.warn('[LocalImage] Outbox item not found, but still updating image status:', imageId, 'error:', error);
      await this.updateStatus(imageId, 'queued', { lastError: error || 'Upload failed (no outbox item)' });
      return;
    }

    // US-001 FIX: Use current attempts count (already incremented by markUploadStarted)
    // Previously this was incrementing again, causing double-counting and faster backoff
    const attempts = item.attempts;
    const backoffMs = this.calculateBackoff(attempts);

    await this.indexedDb.updateOutboxItem(opId, {
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

  // ============================================================================
  // FINALIZATION - FORCE SYNC AND POINTER UPDATE
  // ============================================================================

  /**
   * Get sync status for all images in a service
   * Returns counts of synced, pending, and failed images
   */
  async getServiceImageSyncStatus(serviceId: string): Promise<{
    total: number;
    synced: number;
    pending: number;
    failed: number;
    unsyncedImages: LocalImage[];
  }> {
    const images = await this.getImagesForService(serviceId);
    const synced = images.filter(img => img.isSynced && img.status !== 'failed');
    const failed = images.filter(img => img.status === 'failed');
    const pending = images.filter(img => !img.isSynced && img.status !== 'failed');

    return {
      total: images.length,
      synced: synced.length,
      pending: pending.length,
      failed: failed.length,
      unsyncedImages: pending
    };
  }

  /**
   * Force sync all unsynced images for a service
   * Used during report finalization to ensure all images are uploaded
   * Returns progress updates via callback
   */
  async forceSyncServiceImages(
    serviceId: string,
    onProgress?: (current: number, total: number, status: string) => void
  ): Promise<{
    success: boolean;
    syncedCount: number;
    failedCount: number;
    failedImages: { imageId: string; error: string }[];
  }> {
    console.log('[LocalImage] Force syncing images for service:', serviceId);

    const status = await this.getServiceImageSyncStatus(serviceId);

    if (status.pending === 0) {
      console.log('[LocalImage] All images already synced');
      return {
        success: status.failed === 0,
        syncedCount: status.synced,
        failedCount: status.failed,
        failedImages: status.failed > 0
          ? (await this.getImagesForService(serviceId))
              .filter(img => img.status === 'failed')
              .map(img => ({ imageId: img.imageId, error: img.lastError || 'Unknown error' }))
          : []
      };
    }

    onProgress?.(0, status.pending, 'Starting image sync...');

    // Get outbox items for pending images
    const outboxItems = await this.indexedDb.getAllUploadOutboxItems();
    const pendingImageIds = new Set(status.unsyncedImages.map(img => img.imageId));
    const relevantOutboxItems = outboxItems.filter(item => pendingImageIds.has(item.imageId));

    // Reset retry timers to make them ready immediately
    for (const item of relevantOutboxItems) {
      await this.indexedDb.updateOutboxItem(item.opId, {
        nextRetryAt: Date.now(),
        attempts: 0
      });
    }

    // Wait for uploads to complete with timeout
    const maxWaitTime = 60000; // 60 seconds max wait
    const pollInterval = 1000; // Check every second
    const startTime = Date.now();
    let lastSyncedCount = 0;

    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const currentStatus = await this.getServiceImageSyncStatus(serviceId);
      const syncedCount = currentStatus.synced;
      const stillPending = currentStatus.pending;

      // Update progress
      onProgress?.(
        syncedCount - (status.synced - status.pending),
        status.pending,
        `Syncing images... (${syncedCount}/${status.total})`
      );

      // Check if all done
      if (stillPending === 0) {
        console.log('[LocalImage] All images synced successfully');
        return {
          success: currentStatus.failed === 0,
          syncedCount: currentStatus.synced,
          failedCount: currentStatus.failed,
          failedImages: currentStatus.failed > 0
            ? (await this.getImagesForService(serviceId))
                .filter(img => img.status === 'failed')
                .map(img => ({ imageId: img.imageId, error: img.lastError || 'Unknown error' }))
            : []
        };
      }

      // Check if progress is being made
      if (syncedCount > lastSyncedCount) {
        lastSyncedCount = syncedCount;
      }
    }

    // Timeout - return current status
    const finalStatus = await this.getServiceImageSyncStatus(serviceId);
    console.warn('[LocalImage] Force sync timed out. Synced:', finalStatus.synced, 'Pending:', finalStatus.pending);

    const failedImages = (await this.getImagesForService(serviceId))
      .filter(img => img.status === 'failed' || !img.isSynced)
      .map(img => ({
        imageId: img.imageId,
        error: img.lastError || 'Sync timeout'
      }));

    return {
      success: false,
      syncedCount: finalStatus.synced,
      failedCount: finalStatus.pending + finalStatus.failed,
      failedImages
    };
  }

  /**
   * Update image display pointers to remote URLs after finalization
   * This updates all synced LocalImage records to use remoteUrl for display
   * Called after confirming report is finalized
   */
  async updateImagePointersToRemote(serviceId: string): Promise<void> {
    console.log('[LocalImage] Updating image pointers to remote for service:', serviceId);

    const images = await this.getImagesForService(serviceId);

    for (const image of images) {
      if (image.isSynced && image.remoteUrl) {
        // The image is synced - the remoteUrl is already stored
        // The UI will use remoteUrl when the report is finalized
        console.log('[LocalImage] Image pointer ready for remote:', image.imageId, image.remoteUrl?.substring(0, 50) + '...');
      }
    }

    // Note: The actual swap from local to remote display happens in the UI layer
    // when loading images for a finalized report. This method confirms all
    // synced images have their remoteUrl populated.
  }

  /**
   * Delete a local image and its associated data
   * Used when user deletes a photo from UI
   */
  async deleteLocalImage(imageId: string): Promise<void> {
    console.log('[LocalImageService] Deleting local image:', imageId);
    
    try {
      // Get the image to find associated blob
      const localImage = await this.indexedDb.getLocalImage(imageId);
      
      if (localImage) {
        // Delete the blob if it exists
        if (localImage.localBlobId) {
          await this.indexedDb.deleteLocalBlob(localImage.localBlobId);
          console.log('[LocalImageService] Deleted blob:', localImage.localBlobId);
        }
        
        // Remove from upload outbox if pending
        await this.indexedDb.removeFromUploadOutbox(imageId);
        console.log('[LocalImageService] Removed from upload outbox:', imageId);
        
        // Delete the LocalImage record
        await this.indexedDb.deleteLocalImage(imageId);
        console.log('[LocalImageService] Deleted LocalImage record:', imageId);
      }
      
      // Revoke any cached blob URL
      const cachedUrl = this.blobUrlCache.get(imageId);
      if (cachedUrl) {
        URL.revokeObjectURL(cachedUrl);
        this.blobUrlCache.delete(imageId);
      }
      
      // Clear from signed URL cache
      this.signedUrlCache.delete(imageId);
      
      // Update pending count
      await this.updatePendingCount();
      
    } catch (error) {
      console.error('[LocalImageService] Error deleting local image:', error);
      throw error;
    }
  }

  // ============================================================================
  // POST-FINALIZATION CLEANUP
  // ============================================================================

  /**
   * Clean up local blob data after successful finalization
   * Deletes binary blob data from IndexedDB while preserving metadata (captions, annotations, remoteUrl)
   * Only cleans up images that have been successfully synced
   *
   * @param serviceId - The service ID to clean up blobs for
   * @returns Object with cleanup statistics
   */
  async cleanupBlobDataAfterFinalization(serviceId: string): Promise<{
    cleaned: number;
    skipped: number;
    errors: number;
    freedBytes: number;
  }> {
    console.log('[LocalImage] Starting post-finalization blob cleanup for service:', serviceId);

    const images = await this.getImagesForService(serviceId);
    let cleaned = 0;
    let skipped = 0;
    let errors = 0;
    let freedBytes = 0;

    for (const image of images) {
      // Only clean up images that:
      // 1. Have been synced (isSynced = true)
      // 2. Have a remote URL available for viewing
      // 3. Still have local blob data to clean
      if (!image.isSynced || !image.remoteUrl) {
        console.log('[LocalImage] Skipping cleanup for unsynced image:', image.imageId);
        skipped++;
        continue;
      }

      if (!image.localBlobId) {
        // Already cleaned up
        skipped++;
        continue;
      }

      try {
        // Get blob size before deleting for stats
        const blob = await this.indexedDb.getLocalBlob(image.localBlobId);
        const blobSize = blob?.sizeBytes || 0;

        // Revoke cached blob URL if exists
        const cachedUrl = this.blobUrlCache.get(image.localBlobId);
        if (cachedUrl) {
          URL.revokeObjectURL(cachedUrl);
          this.blobUrlCache.delete(image.localBlobId);
        }

        // Delete the blob data
        await this.indexedDb.deleteLocalBlob(image.localBlobId);

        // Update the LocalImage record to clear the blob reference
        // but preserve all metadata (caption, drawings, remoteUrl, etc.)
        await this.indexedDb.updateLocalImage(image.imageId, {
          localBlobId: null
        });

        freedBytes += blobSize;
        cleaned++;
        console.log('[LocalImage] Cleaned up blob for image:', image.imageId, 'freed:', blobSize, 'bytes');

      } catch (err) {
        console.error('[LocalImage] Error cleaning up blob for image:', image.imageId, err);
        errors++;
      }
    }

    console.log(`[LocalImage] Blob cleanup complete. Cleaned: ${cleaned}, Skipped: ${skipped}, Errors: ${errors}, Freed: ${(freedBytes / 1024 / 1024).toFixed(2)} MB`);

    return {
      cleaned,
      skipped,
      errors,
      freedBytes
    };
  }

  // ============================================================================
  // WEBAPP MODE: DIRECT S3 UPLOAD (No Local Storage)
  // ============================================================================

  /**
   * Upload image directly to S3 (WEBAPP MODE ONLY)
   * Bypasses local blob storage - uploads directly to S3 and creates Caspio record
   * Returns real AttachID and S3 URL immediately
   *
   * @param file - The image file to upload
   * @param entityType - Type of entity ('visual' | 'efe_point' | 'fdf')
   * @param entityId - The entity ID (VisualID, PointID, etc.)
   * @param serviceId - The service ID
   * @param caption - Optional caption/annotation text
   * @param drawings - Optional compressed annotation data
   * @param photoType - Optional photo type ('Measurement' | 'Location' for EFE, 'Top' | 'Bottom' | 'Threshold' for FDF)
   * @returns Object with attachId, s3Key, and s3Url
   */
  async uploadImageDirectToS3(
    file: File,
    entityType: ImageEntityType,
    entityId: string,
    serviceId: string,
    caption: string = '',
    drawings: string = '',
    photoType: string | null = null
  ): Promise<{ attachId: string; s3Key: string; s3Url: string }> {
    console.log('[LocalImage] WEBAPP: uploadImageDirectToS3 starting...');
    console.log('[LocalImage] WEBAPP: entityType:', entityType, 'entityId:', entityId, 'fileSize:', file.size);

    // Validate file
    if (!file || file.size === 0) {
      throw new Error('Cannot upload empty file');
    }

    try {
      let result: any;

      // Route to appropriate upload method based on entity type
      if (entityType === 'visual') {
        // Upload visual attachment
        result = await this.caspioService.uploadVisualsAttachWithS3(
          parseInt(entityId),
          drawings,
          file,
          caption
        );
      } else if (entityType === 'efe_point') {
        // Upload EFE point attachment
        result = await this.caspioService.uploadEFEPointsAttachWithS3(
          parseInt(entityId),
          drawings,
          file,
          photoType || undefined,
          caption
        );
      } else if (entityType === 'fdf') {
        // FDF photos use EFE point attachment with photo type
        result = await this.caspioService.uploadEFEPointsAttachWithS3(
          parseInt(entityId),
          drawings,
          file,
          photoType || undefined,
          caption
        );
      } else if (entityType === 'hud') {
        // Upload HUD attachment to LPS_Services_HUD_Attach
        result = await this.caspioService.createServicesHUDAttachWithFile(
          parseInt(entityId),
          caption,
          file,
          drawings
        ).toPromise();
      } else {
        throw new Error(`Unsupported entity type for web upload: ${entityType}`);
      }

      // Extract AttachID and S3 key from result
      const attachId = result.AttachID || result.Result?.[0]?.AttachID;
      const s3Key = result.Attachment || result.Result?.[0]?.Attachment;

      if (!attachId || !s3Key) {
        throw new Error('Upload succeeded but missing AttachID or S3 key');
      }

      // Get signed URL for the uploaded file
      const s3Url = await this.caspioService.getS3FileUrl(s3Key);

      console.log('[LocalImage] WEBAPP: ✅ Direct upload complete');
      console.log('[LocalImage] WEBAPP: AttachID:', attachId, 'S3Key:', s3Key);

      return {
        attachId: String(attachId),
        s3Key,
        s3Url
      };
    } catch (error: any) {
      console.error('[LocalImage] WEBAPP: ❌ Direct upload failed:', error?.message || error);
      throw error;
    }
  }

  /**
   * Get signed S3 URL for display (WEBAPP MODE)
   * Used when displaying images loaded from server
   */
  async getSignedS3Url(s3Key: string): Promise<string> {
    return this.getSignedUrl(s3Key);
  }
}

