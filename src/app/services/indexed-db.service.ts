import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { db } from './caspio-db';

// ============================================================================
// REACTIVE DATABASE CHANGE EVENTS (Requirement E)
// ============================================================================

export interface DbChangeEvent {
  store: 'localImages' | 'localBlobs' | 'uploadOutbox' | 'pendingRequests' | 'cachedServiceData';
  action: 'create' | 'update' | 'delete';
  key: string;
  entityType?: string;
  entityId?: string;
  serviceId?: string;
}

export interface PendingRequest {
  requestId: string;
  type: 'CREATE' | 'UPDATE' | 'DELETE' | 'UPLOAD_FILE';
  tempId?: string;  // Temporary ID for newly created items
  realId?: string;  // Real ID from server after sync
  endpoint: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data: any;
  dependencies: string[];  // Request IDs that must complete first
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  priority: 'low' | 'normal' | 'high' | 'critical';
  retryCount: number;
  lastAttempt?: number;
  createdAt: number;
  syncedAt?: number;
  error?: string;
  serviceId?: string;
}

export interface TempIdMapping {
  tempId: string;
  realId: string;
  type: string;  // 'visual', 'efe', 'project', etc.
  timestamp: number;
}

export interface CachedTemplate {
  cacheKey: string;
  type: 'visual' | 'efe' | 'lbw' | 'lbw_dropdown';
  templates: any[];
  lastUpdated: number;
}

export interface CachedServiceData {
  cacheKey: string;
  serviceId: string;
  dataType: 'visuals' | 'efe_rooms' | 'efe_points' | 'visual_attachments' | 'efe_point_attachments' | 'lbw_records' | 'lbw_attachments' | 'lbw_dropdown';
  data: any[];
  lastUpdated: number;
}

export interface PendingEFEData {
  tempId: string;
  serviceId: string;
  type: 'room' | 'point';
  parentId?: string;  // For points, this is the room's tempId or realId
  data: any;
  createdAt: number;
}

export interface PendingCaptionUpdate {
  captionId: string;           // Unique ID for this caption update
  attachId: string;            // Attachment ID (can be temp_xxx or real ID)
  attachType: 'visual' | 'efe_point' | 'fdf';  // Type of attachment
  caption?: string;            // New caption text
  drawings?: string;           // New drawings data
  serviceId?: string;          // Service ID for cache lookup
  pointId?: string;            // Point ID (for EFE attachments)
  visualId?: string;           // Visual ID (for visual attachments)
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  createdAt: number;
  updatedAt: number;
  lastAttempt?: number;        // Timestamp of last sync attempt (for backoff)
  retryCount: number;
  error?: string;
}

// ============================================================================
// NEW LOCAL-FIRST IMAGE SYSTEM
// Stable UUIDs, proper status state machine, guaranteed UI stability
// ============================================================================

export type ImageStatus = 'local_only' | 'queued' | 'uploading' | 'uploaded' | 'verified' | 'failed';
export type ImageEntityType = 'visual' | 'efe_point' | 'fdf' | 'hud' | 'lbw' | 'dte';

/**
 * LocalImage - Single source of truth for all images
 * Uses stable UUID that NEVER changes (safe for UI keys)
 */
export interface LocalImage {
  imageId: string;              // UUID generated locally, NEVER changes (UI list key)
  entityType: ImageEntityType;  // Type of parent entity
  entityId: string;             // VisualID, PointID, etc. (can be temp_xxx initially)
  serviceId: string;

  // Local blob reference
  localBlobId: string | null;   // FK to localBlobs table (null after pruning)

  // Remote reference (S3)
  remoteS3Key: string | null;   // S3 key (NOT signed URL - generate at runtime)

  // Status state machine
  status: ImageStatus;

  // Caspio sync
  attachId: string | null;      // Real AttachID from Caspio (null until synced)

  // Sync status tracking (independent from display URL)
  isSynced: boolean;            // True when image has been successfully uploaded to remote
  remoteUrl: string | null;     // Full remote URL (stored but not displayed until finalization)

  // Metadata
  fileName: string;
  fileSize: number;
  contentType: string;
  caption: string;
  drawings: string;
  photoType: string | null;     // 'Measurement' | 'Location' for EFE photos, 'Top' | 'Bottom' | 'Threshold' for FDF
  createdAt: number;
  updatedAt: number;            // Alias for updatedAtLocal - epoch ms of last local change
  lastError: string | null;

  // Version tracking for cache freshness (Requirement E)
  localVersion: number;         // Incremented on every local write

  // Verification tracking
  remoteVerifiedAt: number | null;  // When remote was confirmed loadable
  remoteLoadedInUI: boolean;        // Whether UI has successfully loaded remote
}

/**
 * LocalBlob - Binary storage separated from metadata
 * Allows pruning blobs while keeping image records
 */
export interface LocalBlob {
  blobId: string;               // UUID
  data: ArrayBuffer;            // Actual blob data
  sizeBytes: number;
  contentType: string;
  createdAt: number;
}

/**
 * UploadOutboxItem - Upload queue with retry logic
 */
export interface UploadOutboxItem {
  opId: string;                 // UUID
  type: 'UPLOAD_IMAGE';
  imageId: string;              // FK to localImages
  attempts: number;
  nextRetryAt: number;
  createdAt: number;
  lastError: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class IndexedDbService {
  // ============================================================================
  // REACTIVE DATABASE CHANGE EVENTS (Requirement E)
  // Components subscribe to this to refresh UI when IndexedDB changes
  // ============================================================================
  public dbChange$ = new Subject<DbChangeEvent>();

  // Convenience subjects for specific store changes
  public imageChange$ = new Subject<DbChangeEvent>();

  // ==========================================================================
  // SYNC QUEUE CHANGE EVENT
  // Emitted when changes are queued that should trigger rolling sync window
  // BackgroundSyncService subscribes to this to reset the 60-second timer
  // ==========================================================================
  public syncQueueChange$ = new Subject<{ reason: string; count?: number }>();

  constructor() {
    // Database is initialized automatically by Dexie when first accessed
    console.log('[IndexedDB] Service initialized with Dexie wrapper');
  }

  /**
   * Emit a sync queue change event
   * This notifies BackgroundSyncService to reset the rolling sync window
   */
  private emitSyncQueueChange(reason: string, count?: number): void {
    this.syncQueueChange$.next({ reason, count });
  }

  /**
   * Emit a database change event for reactive UI updates
   */
  private emitChange(event: DbChangeEvent): void {
    this.dbChange$.next(event);

    // Also emit to specific subjects for convenience
    if (event.store === 'localImages') {
      this.imageChange$.next(event);
    }
  }

  /**
   * Add a pending request to the queue
   * MODIFIED: Emits syncQueueChange$ to trigger rolling sync window reset
   */
  async addPendingRequest(request: Omit<PendingRequest, 'requestId' | 'retryCount' | 'createdAt'>): Promise<string> {
    const requestId = this.generateUUID();

    const fullRequest: PendingRequest = {
      ...request,
      requestId,
      retryCount: 0,
      createdAt: Date.now(),
      status: request.status || 'pending',
      priority: request.priority || 'normal',
      dependencies: request.dependencies || [],
    };

    await db.pendingRequests.add(fullRequest);
    console.log('[IndexedDB] Request added:', requestId);

    // Emit sync queue change to reset rolling sync window
    this.emitSyncQueueChange(`pending_request:${request.type}`);

    return requestId;
  }

  /**
   * Get all pending requests (ordered by priority and timestamp)
   */
  async getPendingRequests(): Promise<PendingRequest[]> {
    const requests = await db.pendingRequests
      .where('status')
      .equals('pending')
      .toArray();

    // Sort by priority (high first) then timestamp (oldest first)
    requests.sort((a, b) => {
      const priorityOrder: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      return priorityDiff !== 0 ? priorityDiff : a.createdAt - b.createdAt;
    });

    return requests;
  }

  /**
   * Update request status
   * @param skipLastAttempt - If true, don't update lastAttempt (for dependency errors that should retry immediately)
   */
  async updateRequestStatus(requestId: string, status: PendingRequest['status'], error?: string, skipLastAttempt = false): Promise<void> {
    const request = await db.pendingRequests.get(requestId);
    if (!request) {
      throw new Error('Request not found');
    }

    const updates: Partial<PendingRequest> = {
      status
    };

    // TASK 2 FIX: Only update lastAttempt if not skipped
    // Dependency errors should NOT update lastAttempt so they retry immediately
    if (!skipLastAttempt) {
      updates.lastAttempt = Date.now();
    }

    if (error) {
      updates.error = error;
    }
    if (status === 'synced') {
      updates.syncedAt = Date.now();
    }

    await db.pendingRequests.update(requestId, updates);
  }

  /**
   * Increment retry count
   */
  async incrementRetryCount(requestId: string): Promise<number> {
    const request = await db.pendingRequests.get(requestId);
    if (request) {
      const newCount = (request.retryCount || 0) + 1;
      await db.pendingRequests.update(requestId, {
        retryCount: newCount,
        lastAttempt: Date.now()
      });
      return newCount;
    }
    return 0;
  }

  /**
   * Retry a single failed request - resets status to pending and clears error
   * Returns true if request was found and reset, false otherwise
   */
  async retryRequest(requestId: string): Promise<boolean> {
    const request = await db.pendingRequests.get(requestId);
    if (!request) {
      console.warn(`[IndexedDB] Cannot retry - request not found: ${requestId}`);
      return false;
    }

    await db.pendingRequests.update(requestId, {
      status: 'pending',
      retryCount: 0,
      lastAttempt: 0,
      error: undefined
    });
    console.log(`[IndexedDB] Request reset for retry: ${requestId}`);
    return true;
  }

  /**
   * Retry a single failed caption update - resets status to pending
   */
  async retryCaption(captionId: string): Promise<boolean> {
    const caption = await db.pendingCaptions.get(captionId);
    if (!caption) {
      console.warn(`[IndexedDB] Cannot retry - caption not found: ${captionId}`);
      return false;
    }

    await db.pendingCaptions.update(captionId, {
      status: 'pending',
      retryCount: 0,
      lastAttempt: 0,
      error: undefined
    });
    console.log(`[IndexedDB] Caption reset for retry: ${captionId}`);
    return true;
  }

  /**
   * Retry a single failed photo upload - resets status to queued and re-adds to outbox
   */
  async retryFailedPhoto(imageId: string): Promise<boolean> {
    const image = await db.localImages.get(imageId);
    if (!image) {
      console.warn(`[IndexedDB] Cannot retry - image not found: ${imageId}`);
      return false;
    }

    // Reset image status to queued
    await db.localImages.update(imageId, {
      status: 'queued',
      lastError: undefined
    });

    // Re-add to upload outbox if not already there
    const existingOutbox = await db.uploadOutbox.where('imageId').equals(imageId).first();
    if (!existingOutbox) {
      await db.uploadOutbox.add({
        opId: `retry_${imageId}_${Date.now()}`,
        type: 'UPLOAD_IMAGE',
        imageId: imageId,
        attempts: 0,
        createdAt: Date.now(),
        nextRetryAt: Date.now(),
        lastError: null
      });
    } else {
      // Reset the existing outbox entry
      await db.uploadOutbox.update(existingOutbox.opId, {
        attempts: 0,
        nextRetryAt: Date.now(),
        lastError: undefined
      });
    }

    console.log(`[IndexedDB] Photo reset for retry: ${imageId}`);
    return true;
  }

  /**
   * Check if dependencies are completed
   */
  async areDependenciesCompleted(dependencyIds: string[]): Promise<boolean> {
    if (!dependencyIds || dependencyIds.length === 0) {
      return true;
    }

    for (const depId of dependencyIds) {
      // First check if this is a temp ID that has been mapped to a real ID
      if (depId.startsWith('temp_')) {
        const realId = await this.getRealId(depId);
        if (realId) {
          console.log(`[IndexedDB] Dependency ${depId} met: mapped to real ID ${realId}`);
          continue;
        }
      }

      // Check if request still exists and its status
      const request = await db.pendingRequests.get(depId);

      if (!request) {
        // Request not found - it was already synced and deleted
        console.log(`[IndexedDB] Dependency ${depId} met: request already deleted (synced)`);
        continue;
      }

      if (request.status === 'synced') {
        console.log(`[IndexedDB] Dependency ${depId} met: status is synced`);
        continue;
      }

      // Request exists but not synced yet
      console.log(`[IndexedDB] Dependency ${depId} NOT met: status is ${request.status}`);
      return false;
    }

    return true;
  }

  /**
   * Store temp ID to real ID mapping
   */
  async mapTempId(tempId: string, realId: string, type: string): Promise<void> {
    const mapping: TempIdMapping = {
      tempId,
      realId,
      type,
      timestamp: Date.now(),
    };

    await db.tempIdMappings.put(mapping);
    console.log(`[IndexedDB] Mapped ${tempId} → ${realId}`);
  }

  /**
   * Get real ID from temp ID
   */
  async getRealId(tempId: string): Promise<string | null> {
    const mapping = await db.tempIdMappings.get(tempId);
    return mapping ? mapping.realId : null;
  }

  /**
   * Delete synced requests (cleanup)
   */
  async cleanupSyncedRequests(olderThanDays: number = 7): Promise<number> {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);

    const syncedRequests = await db.pendingRequests
      .where('status')
      .equals('synced')
      .toArray();

    const toDelete = syncedRequests.filter(r => r.syncedAt && r.syncedAt < cutoffTime);
    const deletedCount = toDelete.length;

    await db.pendingRequests.bulkDelete(toDelete.map(r => r.requestId));

    console.log(`[IndexedDB] Cleaned up ${deletedCount} old synced requests`);
    return deletedCount;
  }

  /**
   * Remove a pending request by requestId or tempId
   */
  async removePendingRequest(idOrTempId: string): Promise<void> {
    // First try to delete by requestId directly
    await db.pendingRequests.delete(idOrTempId);

    // Also try to find by tempId and delete
    const byTempId = await db.pendingRequests
      .where('tempId')
      .equals(idOrTempId)
      .first();

    if (byTempId) {
      await db.pendingRequests.delete(byTempId.requestId);
      console.log('[IndexedDB] Removed pending request by tempId:', idOrTempId);
    } else {
      console.log('[IndexedDB] Removed pending request by id:', idOrTempId);
    }
  }

  /**
   * Get sync statistics (includes pendingRequests, uploadOutbox, and pendingCaptions)
   */
  async getSyncStats(): Promise<{
    pending: number;
    syncing: number;
    synced: number;
    failed: number;
  }> {
    const allRequests = await db.pendingRequests.toArray();

    const stats = {
      pending: allRequests.filter(r => r.status === 'pending').length,
      syncing: allRequests.filter(r => r.status === 'syncing').length,
      synced: allRequests.filter(r => r.status === 'synced').length,
      failed: allRequests.filter(r => r.status === 'failed').length,
    };

    // Add uploadOutbox count to pending
    const uploadOutboxCount = await db.uploadOutbox.count();
    stats.pending += uploadOutboxCount;

    // CRITICAL FIX: Include pending captions/annotations in the count
    // This ensures the queue icon shows the correct number for captions and annotations
    const pendingCaptions = await db.pendingCaptions.toArray();
    const pendingCaptionCount = pendingCaptions.filter(c => c.status === 'pending' || c.status === 'syncing').length;
    const failedCaptionCount = pendingCaptions.filter(c => c.status === 'failed').length;
    stats.pending += pendingCaptionCount;
    stats.failed += failedCaptionCount;

    return stats;
  }

  /**
   * Generate UUID v4
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Store photo file for offline upload
   */
  async storePhotoFile(tempId: string, file: File, visualId: string, caption?: string, drawings?: string, serviceId?: string): Promise<void> {
    const arrayBuffer = await file.arrayBuffer();

    const imageData = {
      imageId: tempId,
      fileData: arrayBuffer,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      visualId: visualId,
      serviceId: serviceId || '',
      caption: caption || '',
      drawings: drawings || '',
      status: 'pending' as const,
      createdAt: Date.now(),
    };

    await db.pendingImages.put(imageData);
    console.log('[IndexedDB] Photo file stored as ArrayBuffer:', tempId, file.size, 'bytes', 'drawings:', (drawings || '').length, 'chars');
  }

  /**
   * Store photo blob with full metadata for offline-first workflow
   */
  async storePhotoBlob(photoId: string, file: File | Blob, metadata: {
    visualId: string;
    serviceId: string;
    caption?: string;
    drawings?: string;
    status?: 'pending' | 'uploading' | 'synced';
  }): Promise<void> {
    const arrayBuffer = await file.arrayBuffer();

    const imageData = {
      imageId: photoId,
      fileData: arrayBuffer,
      fileName: file instanceof File ? file.name : `photo_${Date.now()}.jpg`,
      fileSize: file.size,
      fileType: file.type || 'image/jpeg',
      visualId: metadata.visualId,
      serviceId: metadata.serviceId,
      caption: metadata.caption || '',
      drawings: metadata.drawings || '',
      status: metadata.status || 'pending' as const,
      createdAt: Date.now(),
    };

    await db.pendingImages.put(imageData);
    console.log('[IndexedDB] Photo blob stored:', photoId, imageData.fileSize, 'bytes, service:', metadata.serviceId);
  }

  /**
   * Get a fresh blob URL for a stored photo
   */
  async getPhotoBlobUrl(photoId: string): Promise<string | null> {
    const imageData = await db.pendingImages.get(photoId);

    if (!imageData || !imageData.fileData) {
      console.warn('[IndexedDB] No photo data found for blob URL:', photoId);
      return null;
    }

    const blob = new Blob([imageData.fileData], { type: imageData.fileType || 'image/jpeg' });
    const blobUrl = URL.createObjectURL(blob);

    console.log('[IndexedDB] Generated blob URL for:', photoId);
    return blobUrl;
  }

  /**
   * Update the status of a stored photo
   */
  async updatePhotoStatus(photoId: string, status: 'pending' | 'uploading' | 'synced'): Promise<void> {
    const imageData = await db.pendingImages.get(photoId);
    if (imageData) {
      await db.pendingImages.update(photoId, {
        status,
        updatedAt: Date.now()
      });
      console.log('[IndexedDB] Updated photo status:', photoId, '->', status);
    } else {
      console.warn('[IndexedDB] Photo not found for status update:', photoId);
    }
  }

  /**
   * Update caption and/or drawings for a pending photo
   */
  async updatePendingPhotoData(photoId: string, updates: {
    caption?: string;
    drawings?: string;
  }): Promise<boolean> {
    const imageData = await db.pendingImages.get(photoId);
    if (imageData) {
      const updateObj: any = { updatedAt: Date.now() };
      if (updates.caption !== undefined) updateObj.caption = updates.caption;
      if (updates.drawings !== undefined) updateObj.drawings = updates.drawings;

      await db.pendingImages.update(photoId, updateObj);
      console.log('[IndexedDB] ✅ Updated pending photo data:', photoId,
        'caption:', (updates.caption || '').substring(0, 30),
        'drawings:', (updates.drawings || '').length, 'chars');
      return true;
    } else {
      console.warn('[IndexedDB] Photo not found for data update:', photoId);
      return false;
    }
  }

  /**
   * Get all pending photos for a specific service
   */
  async getAllPendingPhotosForService(serviceId: string): Promise<any[]> {
    const allPhotos = await this.getAllPendingPhotos();

    const servicePhotos = allPhotos.filter(p =>
      String(p.serviceId) === String(serviceId) &&
      (p.status === 'pending' || p.status === 'uploading' || !p.status)
    );

    return servicePhotos.map(photo => {
      const blob = new Blob([photo.fileData], { type: photo.fileType || 'image/jpeg' });
      const blobUrl = URL.createObjectURL(blob);

      return {
        AttachID: photo.imageId,
        attachId: photo.imageId,
        id: photo.imageId,
        photoId: photo.imageId,
        _pendingFileId: photo.imageId,
        visualId: photo.visualId,
        VisualID: photo.visualId,
        serviceId: photo.serviceId,
        url: blobUrl,
        originalUrl: blobUrl,
        thumbnailUrl: blobUrl,
        displayUrl: blobUrl,
        caption: photo.caption || '',
        annotation: photo.caption || '',
        Annotation: photo.caption || '',
        drawings: photo.drawings || '',
        Drawings: photo.drawings || '',
        hasAnnotations: !!(photo.drawings && photo.drawings.length > 100),
        status: photo.status || 'pending',
        queued: photo.status === 'pending',
        uploading: photo.status === 'uploading',
        isPending: true,
        createdAt: photo.createdAt
      };
    });
  }

  /**
   * Get stored photo file
   */
  async getStoredFile(fileId: string): Promise<File | null> {
    const imageData = await db.pendingImages.get(fileId);

    if (!imageData || !imageData.fileData) {
      console.warn('[IndexedDB] No file data found for:', fileId);
      return null;
    }

    const blob = new Blob([imageData.fileData], { type: imageData.fileType });
    const file = new File([blob], imageData.fileName, { type: imageData.fileType });

    console.log('[IndexedDB] File reconstructed:', file.name, file.size, 'bytes');
    return file;
  }

  /**
   * Get stored photo data including file, caption, drawings, and serviceId
   */
  async getStoredPhotoData(fileId: string): Promise<{ file: File; caption: string; drawings: string; visualId: string; serviceId: string } | null> {
    const imageData = await db.pendingImages.get(fileId);

    if (!imageData || !imageData.fileData) {
      console.warn('[IndexedDB] No photo data found for:', fileId);
      return null;
    }

    const blob = new Blob([imageData.fileData], { type: imageData.fileType });
    const file = new File([blob], imageData.fileName, { type: imageData.fileType });

    console.log('[IndexedDB] Photo data retrieved:', file.name, file.size, 'bytes', 'drawings:', (imageData.drawings || '').length, 'chars');

    return {
      file,
      caption: imageData.caption || '',
      drawings: imageData.drawings || '',
      visualId: imageData.visualId || '',
      serviceId: imageData.serviceId || ''
    };
  }

  /**
   * Delete stored photo file after successful upload
   */
  async deleteStoredFile(fileId: string): Promise<void> {
    await db.pendingImages.delete(fileId);
    console.log('[IndexedDB] Photo file deleted:', fileId);
  }

  /**
   * Get all pending photo files
   */
  async getAllPendingPhotos(): Promise<any[]> {
    const allPhotos = await db.pendingImages.toArray();
    const pendingOrUploading = allPhotos.filter(p =>
      p.status === 'pending' || p.status === 'uploading' || !p.status
    );
    console.log(`[IndexedDB] getAllPendingPhotos: ${allPhotos.length} total, ${pendingOrUploading.length} pending/uploading`);
    return pendingOrUploading;
  }

  /**
   * Mark a pending photo as being uploaded
   */
  async markPhotoUploading(imageId: string): Promise<void> {
    const imageData = await db.pendingImages.get(imageId);
    if (imageData) {
      await db.pendingImages.update(imageId, { status: 'uploading' });
      console.log('[IndexedDB] Marked photo as uploading:', imageId);
    }
  }

  /**
   * Reset a photo back to pending status
   */
  async markPhotoPending(imageId: string): Promise<void> {
    const imageData = await db.pendingImages.get(imageId);
    if (imageData) {
      await db.pendingImages.update(imageId, { status: 'pending' });
      console.log('[IndexedDB] Reset photo to pending:', imageId);
    }
  }

  /**
   * Get pending photos for a specific visual ID
   */
  async getPendingPhotosForVisual(visualId: string): Promise<any[]> {
    const allPhotos = await this.getAllPendingPhotos();
    const visualPhotos = allPhotos.filter(p => String(p.visualId) === String(visualId));

    return visualPhotos.map(photo => {
      const blob = new Blob([photo.fileData], { type: photo.fileType || 'image/jpeg' });
      const blobUrl = URL.createObjectURL(blob);

      return {
        AttachID: photo.imageId,
        attachId: photo.imageId,
        id: photo.imageId,
        _pendingFileId: photo.imageId,
        url: blobUrl,
        originalUrl: blobUrl,
        thumbnailUrl: blobUrl,
        displayUrl: blobUrl,
        caption: photo.caption || '',
        annotation: photo.caption || '',
        Annotation: photo.caption || '',
        drawings: photo.drawings || '',
        Drawings: photo.drawings || '',
        hasAnnotations: !!(photo.drawings && photo.drawings.length > 100),
        queued: true,
        uploading: false,
        isPending: true,
        createdAt: photo.createdAt
      };
    });
  }

  /**
   * Get all pending photos grouped by visual ID
   */
  async getAllPendingPhotosGroupedByVisual(): Promise<Map<string, any[]>> {
    const allPhotos = await this.getAllPendingPhotos();
    const grouped = new Map<string, any[]>();

    for (const photo of allPhotos) {
      const visualId = String(photo.visualId);

      const blob = new Blob([photo.fileData], { type: photo.fileType || 'image/jpeg' });
      const blobUrl = URL.createObjectURL(blob);

      const displayPhoto = {
        AttachID: photo.imageId,
        attachId: photo.imageId,
        id: photo.imageId,
        _pendingFileId: photo.imageId,
        url: blobUrl,
        originalUrl: blobUrl,
        thumbnailUrl: blobUrl,
        displayUrl: blobUrl,
        caption: photo.caption || '',
        annotation: photo.caption || '',
        Annotation: photo.caption || '',
        drawings: photo.drawings || '',
        Drawings: photo.drawings || '',
        hasAnnotations: !!(photo.drawings && photo.drawings.length > 100),
        queued: true,
        uploading: false,
        isPending: true,
        createdAt: photo.createdAt
      };

      if (!grouped.has(visualId)) {
        grouped.set(visualId, []);
      }
      grouped.get(visualId)!.push(displayPhoto);
    }

    return grouped;
  }

  // ============================================
  // CACHED PHOTOS (for offline viewing of synced photos)
  // ============================================

  /**
   * Cache a photo image for offline viewing
   */
  async cachePhoto(attachId: string, serviceId: string, imageDataUrl: string, s3Key?: string): Promise<void> {
    const photoKey = `photo_${attachId}`;
    const sizeKB = (imageDataUrl?.length || 0) / 1024;

    // DEBUG: Show what's being cached and from where
    const stack = new Error().stack || '';
    const caller = stack.split('\n')[2]?.trim() || 'unknown';
    alert(`[CACHE PHOTO]\nattachId: ${attachId}\nsize: ${sizeKB.toFixed(1)} KB\ncaller: ${caller.substring(0, 80)}`);

    // Validate input
    if (!imageDataUrl || imageDataUrl.length < 100) {
      console.error('[IndexedDB] ❌ Invalid photo data - too short or empty:', attachId, 'length:', imageDataUrl?.length);
      throw new Error('Invalid photo data - cannot cache empty or too-short image');
    }

    const photoData = {
      photoKey: photoKey,
      attachId: attachId,
      serviceId: serviceId,
      imageData: imageDataUrl,
      s3Key: s3Key || '',
      cachedAt: Date.now()
    };

    await db.cachedPhotos.put(photoData);
    console.log('[IndexedDB] ✅ Photo cached:', attachId, 'size:', sizeKB.toFixed(1), 'KB', 'caller:', caller);
  }

  /**
   * Get cached photo image
   */
  async getCachedPhoto(attachId: string): Promise<string | null> {
    const photoKey = `photo_${attachId}`;
    const result = await db.cachedPhotos.get(photoKey);

    if (result && result.imageData) {
      console.log('[IndexedDB] Cached photo found:', attachId, '(data length:', result.imageData.length, ')');
      return result.imageData;
    } else {
      console.log('[IndexedDB] No cached photo found for:', attachId);
      return null;
    }
  }

  /**
   * Get all cached photo IDs in a single read
   */
  async getAllCachedPhotoIds(): Promise<Set<string>> {
    const cachedIds = new Set<string>();
    const allPhotos = await db.cachedPhotos.toArray();

    for (const record of allPhotos) {
      if (record.attachId && record.serviceId !== 'annotated') {
        cachedIds.add(String(record.attachId));
      }
    }

    console.log(`[IndexedDB] getAllCachedPhotoIds: Found ${cachedIds.size} cached photos`);
    return cachedIds;
  }

  /**
   * Verify image cache integrity for debugging
   * Returns a report of LocalImages and their cache status
   */
  async verifyCacheIntegrity(serviceId: string): Promise<{
    localImages: number;
    withBlobs: number;
    withCachedPhotos: number;
    missingFallback: number;
    details: string[];
  }> {
    const details: string[] = [];
    let withBlobs = 0;
    let withCachedPhotos = 0;
    let missingFallback = 0;

    const localImages = await this.getLocalImagesForService(serviceId);
    
    for (const image of localImages) {
      const hasBlob = image.localBlobId ? await this.getLocalBlob(image.localBlobId) !== null : false;
      const hasCached = image.attachId ? await this.getCachedPhoto(String(image.attachId)) !== null : false;
      
      if (hasBlob) withBlobs++;
      if (hasCached) withCachedPhotos++;
      
      if (!hasBlob && !hasCached && image.status !== 'local_only') {
        missingFallback++;
        details.push(`⚠️ ${image.imageId}: no blob, no cache, status=${image.status}, attachId=${image.attachId}`);
      } else {
        details.push(`✅ ${image.imageId}: blob=${hasBlob}, cached=${hasCached}, status=${image.status}`);
      }
    }

    console.log(`[IndexedDB] Cache integrity for ${serviceId}: ${localImages.length} images, ${withBlobs} with blobs, ${withCachedPhotos} with cache, ${missingFallback} missing fallback`);
    
    return {
      localImages: localImages.length,
      withBlobs,
      withCachedPhotos,
      missingFallback,
      details
    };
  }

  /**
   * Cache an annotated image
   */
  async cacheAnnotatedImage(attachId: string, blob: Blob): Promise<string | null> {
    const imageDataUrl = await this.blobToBase64(blob);
    const photoKey = `annotated_${attachId}`;

    const photoData = {
      photoKey: photoKey,
      attachId: attachId,
      serviceId: 'annotated',
      imageData: imageDataUrl,
      s3Key: '',
      cachedAt: Date.now(),
      isAnnotated: true
    };

    await db.cachedPhotos.put(photoData);
    console.log('[IndexedDB] Annotated image cached:', attachId, 'size:', imageDataUrl.length);
    return imageDataUrl;
  }

  /**
   * Get cached annotated image
   */
  async getCachedAnnotatedImage(attachId: string): Promise<string | null> {
    const photoKey = `annotated_${attachId}`;
    const result = await db.cachedPhotos.get(photoKey);

    if (result && result.imageData) {
      console.log('[IndexedDB] Cached annotated image found:', attachId, '(data length:', result.imageData.length, ')');
      return result.imageData;
    }
    return null;
  }

  /**
   * Convert blob to base64 data URL
   */
  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to convert blob to base64'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Delete a single cached photo
   */
  async deleteCachedPhoto(attachId: string): Promise<void> {
    const photoKey = `photo_${attachId}`;
    const annotatedKey = `annotated_${attachId}`;

    await db.cachedPhotos.bulkDelete([photoKey, annotatedKey]);
    console.log('[IndexedDB] Deleted cached photo:', attachId);
  }

  /**
   * Remove attachment from cached service data
   */
  async removeAttachmentFromCache(attachId: string, dataType: 'visual_attachments' | 'efe_point_attachments'): Promise<void> {
    const attachIdStr = String(attachId);
    console.log(`[IndexedDB] Removing attachment ${attachIdStr} from ${dataType} cache`);

    const allCached = await db.cachedServiceData.toArray();
    let updatedCount = 0;

    for (const cached of allCached) {
      if (cached.dataType === dataType && Array.isArray(cached.data)) {
        const originalLength = cached.data.length;
        cached.data = cached.data.filter((att: any) =>
          String(att.AttachID) !== attachIdStr &&
          String(att.attachId) !== attachIdStr
        );

        if (cached.data.length < originalLength) {
          await db.cachedServiceData.put(cached);
          updatedCount++;
          console.log(`[IndexedDB] Removed attachment from ${cached.cacheKey}, was ${originalLength} now ${cached.data.length}`);
        }
      }
    }

    console.log(`[IndexedDB] Updated ${updatedCount} cache entries after removing attachment ${attachIdStr}`);
  }

  /**
   * Clear all cached attachments data
   */
  async clearCachedAttachments(dataType: 'visual_attachments' | 'efe_point_attachments'): Promise<void> {
    const allCached = await db.cachedServiceData.toArray();
    const toDelete = allCached.filter(c => c.dataType === dataType).map(c => c.cacheKey);
    await db.cachedServiceData.bulkDelete(toDelete);
    console.log(`[IndexedDB] Cleared ${toDelete.length} ${dataType} cache entries`);
  }

  /**
   * Clear all cached photos for a service
   */
  async clearCachedPhotosForService(serviceId: string): Promise<void> {
    const photos = await db.cachedPhotos
      .where('serviceId')
      .equals(serviceId)
      .toArray();

    await db.cachedPhotos.bulkDelete(photos.map(p => p.photoKey));
    console.log('[IndexedDB] Cleared cached photos for service:', serviceId);
  }

  /**
   * Clear all data (for testing/debugging)
   */
  async clearAll(): Promise<void> {
    await db.transaction('rw', [
      db.pendingRequests,
      db.tempIdMappings,
      db.pendingImages,
      db.cachedTemplates,
      db.cachedServiceData,
      db.pendingEFEData,
      db.cachedPhotos,
      db.pendingCaptions
    ], async () => {
      await db.pendingRequests.clear();
      await db.tempIdMappings.clear();
      await db.pendingImages.clear();
      await db.cachedTemplates.clear();
      await db.cachedServiceData.clear();
      await db.pendingEFEData.clear();
      await db.cachedPhotos.clear();
      await db.pendingCaptions.clear();
    });
    console.log('[IndexedDB] All data cleared');
  }

  /**
   * Get database diagnostics
   */
  async getDatabaseDiagnostics(): Promise<{
    version: number;
    objectStores: string[];
    cachedPhotosCount: number;
    hasCachedPhotosStore: boolean;
  }> {
    const cachedPhotosCount = await db.cachedPhotos.count();

    const diagnostics = {
      version: db.verno,
      objectStores: db.tables.map(t => t.name),
      cachedPhotosCount,
      hasCachedPhotosStore: true
    };

    console.log('[IndexedDB] Database diagnostics:', diagnostics);
    return diagnostics;
  }

  // ============================================
  // TEMPLATE CACHING METHODS
  // ============================================

  /**
   * Cache templates
   */
  async cacheTemplates(type: 'visual' | 'efe' | 'lbw' | 'lbw_dropdown', templates: any[]): Promise<void> {
    const cacheEntry: CachedTemplate = {
      cacheKey: `templates_${type}`,
      type,
      templates,
      lastUpdated: Date.now(),
    };

    await db.cachedTemplates.put(cacheEntry);
    console.log(`[IndexedDB] Cached ${templates.length} ${type} templates`);
  }

  /**
   * Get cached templates
   */
  async getCachedTemplates(type: 'visual' | 'efe' | 'lbw' | 'lbw_dropdown'): Promise<any[] | null> {
    const cached = await db.cachedTemplates.get(`templates_${type}`);
    if (cached) {
      console.log(`[IndexedDB] Retrieved ${cached.templates.length} cached ${type} templates`);
      return cached.templates;
    }
    return null;
  }

  /**
   * Check if template cache is valid
   */
  async isTemplateCacheValid(type: 'visual' | 'efe' | 'lbw' | 'lbw_dropdown', maxAgeMs: number): Promise<boolean> {
    const cached = await db.cachedTemplates.get(`templates_${type}`);
    if (cached && (Date.now() - cached.lastUpdated) < maxAgeMs) {
      return true;
    }
    return false;
  }

  // ============================================
  // GLOBAL DATA CACHING
  // ============================================

  /**
   * Cache global dropdown data
   */
  async cacheGlobalData(dataType: 'services_drop' | 'projects_drop' | 'status' | 'types' | 'efe_drop', data: any[]): Promise<void> {
    const cacheEntry = {
      cacheKey: `global_${dataType}`,
      serviceId: 'global',
      dataType: dataType as any,
      data,
      lastUpdated: Date.now(),
    };

    await db.cachedServiceData.put(cacheEntry);
    console.log(`[IndexedDB] Cached ${data.length} global ${dataType} records`);
  }

  /**
   * Get cached global data
   */
  async getCachedGlobalData(dataType: 'services_drop' | 'projects_drop' | 'status' | 'types' | 'efe_drop'): Promise<any[] | null> {
    const cached = await db.cachedServiceData.get(`global_${dataType}`);
    if (cached && cached.data) {
      console.log(`[IndexedDB] Retrieved ${cached.data.length} cached global ${dataType} records`);
      return cached.data;
    }
    return null;
  }

  // ============================================
  // SERVICE DATA CACHING METHODS
  // ============================================

  /**
   * Safe cache update with validation
   */
  async safeUpdateCache(
    serviceId: string,
    dataType: 'visuals' | 'efe_rooms' | 'efe_points' | 'visual_attachments' | 'efe_point_attachments' | 'lbw_records' | 'lbw_attachments',
    newData: any[],
    options: {
      allowEmpty?: boolean;
      mergeLocalUpdates?: boolean;
      preserveTempItems?: boolean;
      warnThreshold?: number;
    } = {}
  ): Promise<boolean> {
    const {
      allowEmpty = false,
      mergeLocalUpdates = true,
      preserveTempItems = true,
      warnThreshold = 0.5
    } = options;

    const cacheKey = `${dataType}_${serviceId}`;
    const existingData = await this.getCachedServiceData(serviceId, dataType) || [];

    // VALIDATION 1: Don't overwrite valid cache with empty data
    if ((!newData || newData.length === 0) && existingData.length > 0 && !allowEmpty) {
      console.warn(`[IndexedDB] ⚠️ safeUpdateCache REJECTED: Attempted to overwrite ${existingData.length} ${dataType} with empty data`);
      return false;
    }

    // VALIDATION 2: Warn if significantly smaller
    if (newData && existingData.length > 0 && newData.length < existingData.length * warnThreshold) {
      console.warn(`[IndexedDB] ⚠️ safeUpdateCache WARNING: New data (${newData.length}) is much smaller than existing (${existingData.length}) for ${cacheKey}`);
    }

    let finalData = newData || [];

    // MERGE: Preserve local updates if requested
    if (mergeLocalUpdates && existingData.length > 0) {
      const localUpdates = existingData.filter((item: any) => item._localUpdate);
      if (localUpdates.length > 0) {
        console.log(`[IndexedDB] safeUpdateCache: Preserving ${localUpdates.length} items with _localUpdate flag`);

        const newDataIds = new Set(finalData.map((item: any) =>
          String(item.PK_ID || item.EFEID || item.VisualID || item.PointID || item.AttachID || item._tempId || '')
        ));

        for (const localItem of localUpdates) {
          const localId = String(localItem.PK_ID || localItem.EFEID || localItem.VisualID || localItem.PointID || localItem.AttachID || localItem._tempId || '');
          if (!newDataIds.has(localId)) {
            finalData.push(localItem);
          }
        }
      }
    }

    // MERGE: Preserve temp items if requested
    if (preserveTempItems && existingData.length > 0) {
      const tempItems = existingData.filter((item: any) =>
        item._tempId && String(item._tempId).startsWith('temp_')
      );
      if (tempItems.length > 0) {
        console.log(`[IndexedDB] safeUpdateCache: Preserving ${tempItems.length} temp items`);

        const finalDataIds = new Set(finalData.map((item: any) =>
          String(item._tempId || item.PK_ID || item.EFEID || item.VisualID || item.PointID || item.AttachID || '')
        ));

        for (const tempItem of tempItems) {
          const tempId = String(tempItem._tempId || '');
          if (!finalDataIds.has(tempId)) {
            finalData.push(tempItem);
          }
        }
      }
    }

    await this.cacheServiceData(serviceId, dataType, finalData);
    console.log(`[IndexedDB] ✅ safeUpdateCache: Updated ${cacheKey} with ${finalData.length} items (was ${existingData.length})`);

    return true;
  }

  /**
   * Cache service-specific data
   */
  async cacheServiceData(serviceId: string, dataType: 'visuals' | 'efe_rooms' | 'efe_points' | 'visual_attachments' | 'efe_point_attachments' | 'lbw_records' | 'lbw_attachments', data: any[]): Promise<void> {
    const cacheEntry: CachedServiceData = {
      cacheKey: `${dataType}_${serviceId}`,
      serviceId,
      dataType,
      data,
      lastUpdated: Date.now(),
    };

    await db.cachedServiceData.put(cacheEntry);
    console.log(`[IndexedDB] Cached ${data.length} ${dataType} for service ${serviceId}`);
  }

  /**
   * Get cached service data
   */
  async getCachedServiceData(serviceId: string, dataType: 'visuals' | 'efe_rooms' | 'efe_points' | 'visual_attachments' | 'efe_point_attachments' | 'lbw_records' | 'lbw_attachments'): Promise<any[] | null> {
    const cached = await db.cachedServiceData.get(`${dataType}_${serviceId}`);
    if (cached) {
      console.log(`[IndexedDB] Retrieved ${cached.data.length} cached ${dataType} for service ${serviceId}`);
      return cached.data;
    }
    return null;
  }

  /**
   * Get ALL cached service data entries of a specific type
   */
  async getAllCachedServiceData(dataType: 'visuals' | 'visual_attachments' | 'efe_point_attachments' | 'efe_rooms' | 'efe_points'): Promise<{ serviceId: string; data: any[] }[]> {
    const allCached = await db.cachedServiceData.toArray();
    const results: { serviceId: string; data: any[] }[] = [];

    for (const cached of allCached) {
      if (cached.dataType === dataType) {
        results.push({
          serviceId: cached.serviceId,
          data: cached.data || []
        });
      }
    }

    return results;
  }

  /**
   * Bulk get visual attachments for multiple visuals
   */
  async getAllVisualAttachmentsForVisuals(visualIds: string[]): Promise<Map<string, any[]>> {
    const result = new Map<string, any[]>();
    if (visualIds.length === 0) return result;

    const keysToFetch = new Set(visualIds.map(id => `visual_attachments_${id}`));
    const allCached = await db.cachedServiceData.toArray();

    for (const cached of allCached) {
      if (cached.dataType === 'visual_attachments' && keysToFetch.has(`visual_attachments_${cached.serviceId}`)) {
        result.set(cached.serviceId, cached.data || []);
      }
    }

    console.log(`[IndexedDB] Bulk loaded ${result.size} visual attachments in ONE read`);
    return result;
  }

  /**
   * Bulk get cached photos for a service
   */
  async getAllCachedPhotosForService(serviceId: string): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const allPhotos = await db.cachedPhotos.toArray();

    for (const photo of allPhotos) {
      if (!serviceId || photo.serviceId === serviceId || !photo.serviceId) {
        if (photo.attachId && photo.imageData) {
          result.set(String(photo.attachId), photo.imageData);
        }
      }
    }

    console.log(`[IndexedDB] Bulk loaded ${result.size} cached photos for service ${serviceId} in ONE read`);
    return result;
  }

  /**
   * Bulk get annotated images
   */
  async getAllCachedAnnotatedImagesForService(serviceId?: string): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const allPhotos = await db.cachedPhotos.toArray();

    for (const photo of allPhotos) {
      if (photo.isAnnotated && photo.attachId && photo.imageData) {
        result.set(String(photo.attachId), photo.imageData);
      }
    }

    console.log(`[IndexedDB] Bulk loaded ${result.size} annotated images from cachedPhotos in ONE read`);
    return result;
  }

  /**
   * Check if service data cache is valid
   */
  async isServiceDataCacheValid(serviceId: string, dataType: 'visuals' | 'efe_rooms' | 'efe_points', maxAgeMs: number): Promise<boolean> {
    const cached = await db.cachedServiceData.get(`${dataType}_${serviceId}`);
    if (cached && (Date.now() - cached.lastUpdated) < maxAgeMs) {
      return true;
    }
    return false;
  }

  /**
   * Invalidate all cached data for a service
   */
  async invalidateServiceCache(serviceId: string): Promise<void> {
    const allCached = await db.cachedServiceData
      .where('serviceId')
      .equals(serviceId)
      .toArray();

    await db.cachedServiceData.bulkDelete(allCached.map(c => c.cacheKey));
    console.log(`[IndexedDB] Invalidated ${allCached.length} cache entries for service ${serviceId}`);
  }

  /**
   * Clear cached service data of a specific type
   */
  async clearCachedServiceData(serviceId: string, dataType: 'visuals' | 'efe_rooms' | 'efe_points' | 'visual_attachments' | 'efe_point_attachments'): Promise<void> {
    const cacheKey = `${dataType}_${serviceId}`;
    console.log(`[IndexedDB] Clearing cached data: ${cacheKey}`);
    await db.cachedServiceData.delete(cacheKey);
    console.log(`[IndexedDB] Cleared: ${cacheKey}`);
  }

  /**
   * Remove template download status
   */
  async removeTemplateDownloadStatus(serviceId: string, templateType: string): Promise<void> {
    const cacheKey = `template_downloaded_${templateType}_${serviceId}`;
    console.log(`[IndexedDB] Removing download status: ${cacheKey}`);
    await db.cachedServiceData.delete(cacheKey);
    console.log(`[IndexedDB] Download status removed: ${cacheKey}`);
  }

  // ============================================
  // PENDING EFE DATA METHODS
  // ============================================

  /**
   * Add pending EFE data
   */
  async addPendingEFE(data: Omit<PendingEFEData, 'createdAt'>): Promise<void> {
    const fullData: PendingEFEData = {
      ...data,
      createdAt: Date.now(),
    };

    await db.pendingEFEData.put(fullData);
    console.log(`[IndexedDB] Added pending EFE ${data.type}:`, data.tempId);
  }

  /**
   * Get all pending EFE data for a service
   */
  async getPendingEFEByService(serviceId: string): Promise<PendingEFEData[]> {
    const results = await db.pendingEFEData
      .where('serviceId')
      .equals(serviceId)
      .toArray();

    console.log(`[IndexedDB] Found ${results.length} pending EFE items for service ${serviceId}`);
    return results;
  }

  /**
   * Get pending EFE points for a room
   */
  async getPendingEFEPoints(roomTempId: string): Promise<PendingEFEData[]> {
    const results = await db.pendingEFEData
      .where('parentId')
      .equals(roomTempId)
      .filter(r => r.type === 'point')
      .toArray();

    console.log(`[IndexedDB] Found ${results.length} pending points for room ${roomTempId}`);
    return results;
  }

  /**
   * Update pending EFE data
   */
  async updatePendingEFE(tempId: string, updates: any): Promise<boolean> {
    const existing = await db.pendingEFEData.get(tempId);
    if (existing) {
      existing.data = {
        ...existing.data,
        ...updates,
        _localUpdate: true
      };

      await db.pendingEFEData.put(existing);
      console.log(`[IndexedDB] ✅ Updated pending EFE ${tempId} with:`, updates);
      return true;
    } else {
      console.log(`[IndexedDB] Pending EFE ${tempId} not found`);
      return false;
    }
  }

  /**
   * Remove pending EFE data after sync
   */
  async removePendingEFE(tempId: string): Promise<void> {
    await db.pendingEFEData.delete(tempId);
    console.log(`[IndexedDB] Removed pending EFE:`, tempId);
  }

  /**
   * Get all pending EFE rooms
   */
  async getAllPendingEFERooms(): Promise<PendingEFEData[]> {
    return await db.pendingEFEData
      .where('type')
      .equals('room')
      .toArray();
  }

  // ============================================
  // EFE PHOTO STORAGE METHODS
  // ============================================

  /**
   * Store EFE photo file
   */
  async storeEFEPhotoFile(tempId: string, file: File, pointId: string, photoType: string, drawings?: string, caption?: string, serviceId?: string): Promise<void> {
    const arrayBuffer = await file.arrayBuffer();

    const imageData = {
      imageId: tempId,
      fileData: arrayBuffer,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      pointId: pointId,
      serviceId: serviceId || '',
      photoType: photoType || 'Measurement',
      drawings: drawings || '',
      caption: caption || '',
      isEFE: true,
      status: 'pending' as const,
      createdAt: Date.now(),
    };

    await db.pendingImages.put(imageData);
    console.log('[IndexedDB] EFE photo file stored:', tempId, file.size, 'bytes, service:', serviceId);
  }

  /**
   * Get stored EFE photo data
   */
  async getStoredEFEPhotoData(fileId: string): Promise<{ file: File; drawings: string; photoType: string; pointId: string; caption: string } | null> {
    const imageData = await db.pendingImages.get(fileId);

    if (!imageData || !imageData.fileData) {
      console.warn('[IndexedDB] No EFE photo data found for:', fileId);
      return null;
    }

    const blob = new Blob([imageData.fileData], { type: imageData.fileType });
    const file = new File([blob], imageData.fileName, { type: imageData.fileType });

    console.log('[IndexedDB] EFE photo data retrieved:', file.name, file.size, 'bytes');

    return {
      file,
      drawings: imageData.drawings || '',
      photoType: imageData.photoType || 'Measurement',
      pointId: imageData.pointId || '',
      caption: imageData.caption || ''
    };
  }

  /**
   * Get pending photos for a point
   */
  async getPendingPhotosForPoint(pointId: string): Promise<any[]> {
    const allPhotos = await this.getAllPendingPhotos();
    const pointPhotos = allPhotos.filter(p => p.isEFE && String(p.pointId) === String(pointId));

    return pointPhotos.map(photo => {
      const blob = new Blob([photo.fileData], { type: photo.fileType || 'image/jpeg' });
      const blobUrl = URL.createObjectURL(blob);

      return {
        AttachID: photo.imageId,
        attachId: photo.imageId,
        id: photo.imageId,
        _pendingFileId: photo.imageId,
        PointID: pointId,
        url: blobUrl,
        originalUrl: blobUrl,
        thumbnailUrl: blobUrl,
        displayUrl: blobUrl,
        Type: photo.photoType || 'Measurement',
        photoType: photo.photoType || 'Measurement',
        caption: photo.caption || '',
        annotation: photo.caption || '',
        Annotation: photo.caption || '',
        drawings: photo.drawings || '',
        Drawings: photo.drawings || '',
        hasAnnotations: !!(photo.drawings && photo.drawings.length > 100),
        queued: true,
        uploading: false,
        isPending: true,
        isEFE: true,
        createdAt: photo.createdAt
      };
    });
  }

  /**
   * Get all pending EFE photos grouped by point ID
   */
  async getAllPendingPhotosGroupedByPoint(): Promise<Map<string, any[]>> {
    const allPhotos = await this.getAllPendingPhotos();
    const grouped = new Map<string, any[]>();

    const efePhotos = allPhotos.filter(p => p.isEFE);

    for (const photo of efePhotos) {
      const pointId = String(photo.pointId);

      const blob = new Blob([photo.fileData], { type: photo.fileType || 'image/jpeg' });
      const blobUrl = URL.createObjectURL(blob);

      const displayPhoto = {
        AttachID: photo.imageId,
        attachId: photo.imageId,
        id: photo.imageId,
        _pendingFileId: photo.imageId,
        PointID: pointId,
        url: blobUrl,
        originalUrl: blobUrl,
        thumbnailUrl: blobUrl,
        displayUrl: blobUrl,
        Type: photo.photoType || 'Measurement',
        photoType: photo.photoType || 'Measurement',
        caption: photo.caption || '',
        annotation: photo.caption || '',
        Annotation: photo.caption || '',
        drawings: photo.drawings || '',
        Drawings: photo.drawings || '',
        hasAnnotations: !!(photo.drawings && photo.drawings.length > 100),
        queued: true,
        uploading: false,
        isPending: true,
        isEFE: true,
        createdAt: photo.createdAt
      };

      if (!grouped.has(pointId)) {
        grouped.set(pointId, []);
      }
      grouped.get(pointId)!.push(displayPhoto);
    }

    return grouped;
  }

  // ============================================
  // PROJECT RECORD CACHING
  // ============================================

  /**
   * Cache a project record
   */
  async cacheProjectRecord(projectId: string, project: any): Promise<void> {
    const cacheEntry = {
      cacheKey: `project_record_${projectId}`,
      serviceId: projectId,
      dataType: 'project_record' as any,
      data: [project],
      lastUpdated: Date.now(),
    };

    await db.cachedServiceData.put(cacheEntry);
    console.log(`[IndexedDB] Cached project record for ${projectId}`);
  }

  /**
   * Get cached project record
   */
  async getCachedProjectRecord(projectId: string): Promise<any | null> {
    const cached = await db.cachedServiceData.get(`project_record_${projectId}`);
    if (cached && cached.data && cached.data.length > 0) {
      return cached.data[0];
    }
    return null;
  }

  // ============================================
  // SERVICE RECORD CACHING
  // ============================================

  /**
   * Cache a service record
   */
  async cacheServiceRecord(serviceId: string, service: any): Promise<void> {
    console.log(`[IndexedDB] cacheServiceRecord(${serviceId}): input service =`, JSON.stringify(service).substring(0, 300));

    const cacheEntry = {
      cacheKey: `service_record_${serviceId}`,
      serviceId,
      dataType: 'service_record' as any,
      data: [service],
      lastUpdated: Date.now(),
    };

    console.log(`[IndexedDB] cacheServiceRecord(${serviceId}): cacheEntry.data =`, JSON.stringify(cacheEntry.data).substring(0, 300));

    await db.cachedServiceData.put(cacheEntry);
    console.log(`[IndexedDB] cacheServiceRecord(${serviceId}): SUCCESS - cached service record`);
  }

  /**
   * Get cached service record
   */
  async getCachedServiceRecord(serviceId: string): Promise<any | null> {
    const cached = await db.cachedServiceData.get(`service_record_${serviceId}`);
    console.log(`[IndexedDB] getCachedServiceRecord(${serviceId}): raw cached =`, cached);
    if (cached && cached.data && cached.data.length > 0) {
      console.log(`[IndexedDB] getCachedServiceRecord(${serviceId}): returning data[0] =`, JSON.stringify(cached.data[0]).substring(0, 200));
      return cached.data[0];
    } else {
      console.log(`[IndexedDB] getCachedServiceRecord(${serviceId}): no data found, returning null`);
      return null;
    }
  }

  // ============================================
  // TEMPLATE DOWNLOAD TRACKING
  // ============================================

  /**
   * Mark template as downloaded
   */
  async markTemplateDownloaded(serviceId: string, templateType: string): Promise<void> {
    const cacheEntry = {
      cacheKey: `download_status_${templateType}_${serviceId}`,
      serviceId,
      dataType: 'download_status' as any,
      data: [{ downloaded: true, timestamp: Date.now(), templateType }],
      lastUpdated: Date.now(),
    };

    await db.cachedServiceData.put(cacheEntry);
    console.log(`[IndexedDB] Marked ${templateType} template as downloaded for service ${serviceId}`);
  }

  /**
   * Check if template has been downloaded
   */
  async isTemplateDownloaded(serviceId: string, templateType: string): Promise<boolean> {
    const cacheKey = `download_status_${templateType}_${serviceId}`;
    console.log(`[IndexedDB] isTemplateDownloaded(${serviceId}, ${templateType}): checking key ${cacheKey}`);

    const cached = await db.cachedServiceData.get(cacheKey);
    console.log(`[IndexedDB] isTemplateDownloaded(${serviceId}, ${templateType}): cached =`, cached);

    if (cached && cached.data && cached.data.length > 0 && cached.data[0].downloaded) {
      const downloadAge = Date.now() - cached.data[0].timestamp;
      const maxAge = 7 * 24 * 60 * 60 * 1000;
      const isRecent = downloadAge < maxAge;
      console.log(`[IndexedDB] isTemplateDownloaded(${serviceId}, ${templateType}): downloadAge=${downloadAge}ms, maxAge=${maxAge}ms, isRecent=${isRecent}`);
      return isRecent;
    } else {
      console.log(`[IndexedDB] isTemplateDownloaded(${serviceId}, ${templateType}): no download status found, returning false`);
      return false;
    }
  }

  // ============================================
  // PENDING REQUEST DATA UPDATES
  // ============================================

  /**
   * Update data in a pending request
   */
  async updatePendingRequestData(tempId: string, updates: any): Promise<void> {
    const request = await db.pendingRequests
      .where('tempId')
      .equals(tempId)
      .first();

    if (request) {
      request.data = { ...request.data, ...updates };
      await db.pendingRequests.put(request);
      console.log(`[IndexedDB] Updated pending request data for ${tempId}`);
    } else {
      console.warn(`[IndexedDB] No pending request found with tempId ${tempId}`);
    }
  }

  /**
   * Update any fields on a pending request by requestId
   * Used for resetting retry counts, clearing errors, etc.
   */
  async updatePendingRequest(requestId: string, updates: Partial<PendingRequest>): Promise<void> {
    const request = await db.pendingRequests.get(requestId);

    if (request) {
      const updated = { ...request, ...updates };
      await db.pendingRequests.put(updated);
      console.log(`[IndexedDB] Updated pending request ${requestId}:`, updates);
    } else {
      console.warn(`[IndexedDB] No pending request found with id ${requestId}`);
    }
  }

  /**
   * Get all pending requests (including non-pending statuses)
   */
  async getAllRequests(): Promise<PendingRequest[]> {
    return await db.pendingRequests.toArray();
  }

  /**
   * Clear old pending requests
   */
  async clearOldPendingRequests(olderThanMinutes: number = 5): Promise<number> {
    const cutoffTime = Date.now() - (olderThanMinutes * 60 * 1000);
    const requests = await db.pendingRequests.toArray();

    const toDelete = requests.filter(request =>
      (request.status === 'pending' || request.status === 'failed') &&
      request.createdAt < cutoffTime
    );

    for (const request of toDelete) {
      console.log(`[IndexedDB] Cleared stuck request: ${request.requestId} (type: ${request.type}, created: ${new Date(request.createdAt).toISOString()})`);
    }

    await db.pendingRequests.bulkDelete(toDelete.map(r => r.requestId));
    console.log(`[IndexedDB] Cleared ${toDelete.length} stuck pending requests`);
    return toDelete.length;
  }

  /**
   * Clear ALL pending requests and related data
   * TASK 1 FIX: Also clears uploadOutbox and resets localImages stuck in syncing state
   * US-001 FIX: Also clears failed items to prevent stale failure data persisting
   */
  async clearAllPendingSync(): Promise<{ requests: number; captions: number; images: number; outbox: number; localImages: number; failedCleared: number }> {
    const result = { requests: 0, captions: 0, images: 0, outbox: 0, localImages: 0, failedCleared: 0 };

    result.requests = await db.pendingRequests.count();
    await db.pendingRequests.clear();

    result.captions = await db.pendingCaptions.count();
    await db.pendingCaptions.clear();

    result.images = await db.pendingImages.count();
    await db.pendingImages.clear();

    // TASK 1 FIX: Also clear uploadOutbox - this was missing and caused stuck syncing on reload
    result.outbox = await db.uploadOutbox.count();
    await db.uploadOutbox.clear();

    // US-001 FIX: Delete localImages stuck in 'uploading', 'queued', or 'failed' status
    // This prevents stale failure data from persisting after clearing
    const stuckOrFailedImages = await db.localImages
      .filter(img => img.status === 'uploading' || img.status === 'queued' || img.status === 'failed')
      .toArray();

    for (const img of stuckOrFailedImages) {
      await db.localImages.delete(img.imageId);
      result.localImages++;
    }

    // Also delete any blobs associated with deleted images
    for (const img of stuckOrFailedImages) {
      try {
        await db.localBlobs.delete(img.imageId);
        result.failedCleared++;
      } catch (e) {
        // Blob may not exist, ignore
      }
    }

    console.log(`[IndexedDB] Cleared all pending sync: ${result.requests} requests, ${result.captions} captions, ${result.images} images, ${result.outbox} outbox, ${result.localImages} stuck/failed localImages`);
    return result;
  }

  /**
   * Clear ALL failed items (requests, captions, and photos)
   * This removes stale failure data that persists after successful uploads or clearing
   */
  async clearAllFailed(): Promise<{ requests: number; captions: number; photos: number }> {
    const result = { requests: 0, captions: 0, photos: 0 };

    // Clear failed requests
    const failedRequests = await db.pendingRequests.where('status').equals('failed').toArray();
    result.requests = failedRequests.length;
    await db.pendingRequests.bulkDelete(failedRequests.map(r => r.requestId));

    // Clear failed captions
    const failedCaptions = await db.pendingCaptions.where('status').equals('failed').toArray();
    result.captions = failedCaptions.length;
    await db.pendingCaptions.bulkDelete(failedCaptions.map(c => c.captionId));

    // Clear failed local images
    const failedImages = await db.localImages.where('status').equals('failed').toArray();
    result.photos = failedImages.length;
    await db.localImages.bulkDelete(failedImages.map(i => i.imageId));

    console.log(`[IndexedDB] Cleared all failed: ${result.requests} requests, ${result.captions} captions, ${result.photos} photos`);
    return result;
  }

  /**
   * Force retry old requests
   */
  async forceRetryOldRequests(olderThanMinutes: number = 5): Promise<number> {
    const cutoffTime = Date.now() - (olderThanMinutes * 60 * 1000);
    const requests = await db.pendingRequests.toArray();
    let resetCount = 0;

    for (const request of requests) {
      if ((request.status === 'pending' || request.status === 'failed') &&
        request.createdAt < cutoffTime) {
        await db.pendingRequests.update(request.requestId, {
          retryCount: 0,
          lastAttempt: 0,
          status: 'pending',
          error: undefined
        });
        resetCount++;
        console.log(`[IndexedDB] Reset old request: ${request.requestId} (was ${request.retryCount} retries)`);
      }
    }

    console.log(`[IndexedDB] Force reset ${resetCount} old pending requests`);
    return resetCount;
  }

  /**
   * Clear stale requests
   */
  async clearStaleRequests(olderThanHours: number = 24): Promise<number> {
    const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
    const requests = await db.pendingRequests.toArray();

    const toDelete = requests.filter(r => r.createdAt < cutoffTime);

    for (const request of toDelete) {
      console.log(`[IndexedDB] Cleared stale request: ${request.requestId} (created ${new Date(request.createdAt).toISOString()})`);
    }

    await db.pendingRequests.bulkDelete(toDelete.map(r => r.requestId));
    console.log(`[IndexedDB] Cleared ${toDelete.length} stale requests older than ${olderThanHours} hours`);
    return toDelete.length;
  }

  /**
   * Get sync diagnostic info
   */
  async getSyncDiagnostics(): Promise<{
    total: number;
    byStatus: { [status: string]: number };
    byType: { [type: string]: number };
    oldestPending: number | null;
    avgRetryCount: number;
    stuckCount: number;
  }> {
    const requests = await this.getAllRequests();
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    const byStatus: { [status: string]: number } = {};
    const byType: { [type: string]: number } = {};
    let totalRetries = 0;
    let oldestPending: number | null = null;
    let stuckCount = 0;

    for (const request of requests) {
      byStatus[request.status] = (byStatus[request.status] || 0) + 1;
      byType[request.type] = (byType[request.type] || 0) + 1;

      if (request.status === 'pending') {
        if (oldestPending === null || request.createdAt < oldestPending) {
          oldestPending = request.createdAt;
        }

        if (request.createdAt < oneHourAgo) {
          stuckCount++;
        }
      }

      totalRetries += request.retryCount || 0;
    }

    return {
      total: requests.length,
      byStatus,
      byType,
      oldestPending,
      avgRetryCount: requests.length > 0 ? totalRetries / requests.length : 0,
      stuckCount
    };
  }

  // ============================================
  // PENDING CAPTIONS
  // ============================================

  /**
   * Queue a caption update
   */
  async queueCaptionUpdate(data: {
    attachId: string;
    attachType: 'visual' | 'efe_point' | 'fdf';
    caption?: string;
    drawings?: string;
    serviceId?: string;
    pointId?: string;
    visualId?: string;
  }): Promise<string> {
    const captionId = `caption_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = Date.now();

    // Check for existing pending update for this attachment
    const existing = await db.pendingCaptions
      .where('attachId')
      .equals(data.attachId)
      .filter(c => c.status === 'pending' || c.status === 'failed')
      .toArray();

    if (existing.length > 0) {
      // Update the most recent pending one
      const toUpdate = existing[existing.length - 1];
      if (data.caption !== undefined) toUpdate.caption = data.caption;
      if (data.drawings !== undefined) toUpdate.drawings = data.drawings;
      toUpdate.updatedAt = now;

      await db.pendingCaptions.put(toUpdate);
      console.log('[IndexedDB] ✅ Updated pending caption:', toUpdate.captionId, 'for attach:', data.attachId);

      // Emit sync queue change to reset rolling sync window
      this.emitSyncQueueChange('caption_update');

      return toUpdate.captionId;
    } else {
      // Create new pending caption
      const pendingCaption: PendingCaptionUpdate = {
        captionId,
        attachId: data.attachId,
        attachType: data.attachType,
        caption: data.caption,
        drawings: data.drawings,
        serviceId: data.serviceId,
        pointId: data.pointId,
        visualId: data.visualId,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        retryCount: 0
      };

      await db.pendingCaptions.add(pendingCaption);
      console.log('[IndexedDB] ✅ Queued new caption update:', captionId, 'for attach:', data.attachId);

      // Emit sync queue change to reset rolling sync window
      this.emitSyncQueueChange('caption_create');

      return captionId;
    }
  }

  /**
   * Get pending captions ready for sync
   */
  async getPendingCaptions(): Promise<PendingCaptionUpdate[]> {
    const allCaptions = await db.pendingCaptions.toArray();
    const now = Date.now();
    const stuckThreshold = 2 * 60 * 1000;

    const readyForSync = allCaptions.filter(caption => {
      if (caption.status === 'pending') {
        if (!caption.lastAttempt || caption.retryCount === 0) {
          return true;
        }
        const retryCount = caption.retryCount || 0;
        const retryDelay = Math.min(30000 * Math.pow(2, retryCount - 1), 300000);
        const timeSinceAttempt = now - caption.lastAttempt;
        return timeSinceAttempt >= retryDelay;
      }

      if (caption.status === 'syncing') {
        const timeSinceUpdate = now - (caption.updatedAt || caption.createdAt);
        if (timeSinceUpdate > stuckThreshold) {
          console.log(`[IndexedDB] Caption ${caption.captionId} stuck in syncing for ${Math.round(timeSinceUpdate / 1000)}s, including for retry`);
          return true;
        }
        return false;
      }

      if (caption.status === 'failed') {
        const retryCount = caption.retryCount || 0;
        if (retryCount >= 10) {
          return false;
        }
        const retryDelay = Math.min(30000 * Math.pow(2, retryCount), 300000);
        const timeSinceUpdate = now - (caption.lastAttempt || caption.updatedAt || caption.createdAt);
        if (timeSinceUpdate >= retryDelay) {
          console.log(`[IndexedDB] Failed caption ${caption.captionId} ready for retry (attempt ${retryCount + 1})`);
          return true;
        }
        return false;
      }

      return false;
    });

    readyForSync.sort((a, b) => a.createdAt - b.createdAt);
    return readyForSync;
  }

  /**
   * Get all pending caption updates (all statuses)
   */
  async getAllPendingCaptions(): Promise<PendingCaptionUpdate[]> {
    return await db.pendingCaptions.toArray();
  }

  /**
   * Get pending caption updates for specific attachments
   */
  async getPendingCaptionsForAttachments(attachIds: string[]): Promise<PendingCaptionUpdate[]> {
    const allCaptions = await db.pendingCaptions.toArray();
    const matching = allCaptions.filter(c =>
      attachIds.includes(c.attachId) &&
      c.status !== 'failed'
    );
    console.log(`[IndexedDB] getPendingCaptionsForAttachments: Found ${matching.length} captions for ${attachIds.length} attachIds (including synced)`);
    return matching;
  }

  /**
   * Update caption status
   * @param additionalUpdates - Optional additional fields to update (e.g., retryCount, lastAttempt for reset)
   */
  async updateCaptionStatus(
    captionId: string,
    status: 'pending' | 'syncing' | 'synced' | 'failed',
    errorOrUpdates?: string | Partial<PendingCaptionUpdate>,
    incrementRetry: boolean = false
  ): Promise<void> {
    const caption = await db.pendingCaptions.get(captionId);
    if (caption) {
      const updates: Partial<PendingCaptionUpdate> = {
        status,
        updatedAt: Date.now(),
        lastAttempt: Date.now()
      };
      
      // Handle error string or additional updates object
      if (typeof errorOrUpdates === 'string') {
        updates.error = errorOrUpdates;
      } else if (errorOrUpdates) {
        Object.assign(updates, errorOrUpdates);
      }
      
      if (status === 'failed' || incrementRetry) {
        updates.retryCount = (caption.retryCount || 0) + 1;
      }

      await db.pendingCaptions.update(captionId, updates);
    }
  }

  /**
   * Delete a caption update after successful sync
   */
  async deletePendingCaption(captionId: string): Promise<void> {
    await db.pendingCaptions.delete(captionId);
    console.log('[IndexedDB] ✅ Deleted synced caption:', captionId);
  }

  /**
   * Clean up orphaned captions
   */
  async cleanupOrphanedCaptions(): Promise<number> {
    let deletedCount = 0;

    try {
      const allCaptions = await this.getAllPendingCaptions();
      const tempIdCaptions = allCaptions.filter(c =>
        String(c.attachId || '').startsWith('temp_')
      );

      if (tempIdCaptions.length === 0) {
        return 0;
      }

      console.log(`[IndexedDB] Checking ${tempIdCaptions.length} captions with temp IDs for orphans...`);

      const pendingImages = await db.pendingImages.toArray();
      const pendingImagesMap = new Set(pendingImages.map(img => img.imageId));

      for (const caption of tempIdCaptions) {
        const tempId = String(caption.attachId);

        if (pendingImagesMap.has(tempId)) {
          continue;
        }

        const realId = await this.getRealId(tempId);
        if (realId) {
          caption.attachId = realId;
          caption.updatedAt = Date.now();
          await db.pendingCaptions.put(caption);
          console.log(`[IndexedDB] Updated orphaned caption ${caption.captionId} with real ID: ${tempId} → ${realId}`);
          continue;
        }

        console.log(`[IndexedDB] Deleting orphaned caption ${caption.captionId} (temp ID: ${tempId} has no photo)`);
        await this.deletePendingCaption(caption.captionId);
        deletedCount++;
      }

      if (deletedCount > 0) {
        console.log(`[IndexedDB] ✅ Cleaned up ${deletedCount} orphaned captions`);
      }

      return deletedCount;
    } catch (error) {
      console.error('[IndexedDB] Error cleaning up orphaned captions:', error);
      return deletedCount;
    }
  }

  /**
   * Update attachId for pending captions
   */
  async updateCaptionAttachId(tempAttachId: string, realAttachId: string): Promise<number> {
    const captions = await db.pendingCaptions
      .where('attachId')
      .equals(tempAttachId)
      .toArray();

    let updatedCount = 0;

    for (const caption of captions) {
      caption.attachId = realAttachId;
      caption.updatedAt = Date.now();
      await db.pendingCaptions.put(caption);
      updatedCount++;
      console.log(`[IndexedDB] Updated caption ${caption.captionId} attachId: ${tempAttachId} → ${realAttachId}`);
    }

    return updatedCount;
  }

  /**
   * Get pending caption count
   */
  async getPendingCaptionCount(): Promise<number> {
    const pending = await this.getPendingCaptions();
    return pending.length;
  }

  /**
   * Clear old synced/failed captions
   */
  async clearOldCaptions(olderThanHours: number = 24): Promise<number> {
    const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
    const captions = await db.pendingCaptions.toArray();

    const toDelete = captions.filter(caption =>
      caption.status === 'synced' ||
      (caption.status === 'failed' && caption.createdAt < cutoffTime)
    );

    await db.pendingCaptions.bulkDelete(toDelete.map(c => c.captionId));
    console.log(`[IndexedDB] Cleared ${toDelete.length} old caption updates`);
    return toDelete.length;
  }

  /**
   * Clear stale pending captions - marks them as failed so users can see the reason
   * instead of silently deleting them
   */
  async clearStalePendingCaptions(olderThanMinutes: number = 30): Promise<number> {
    const cutoffTime = Date.now() - (olderThanMinutes * 60 * 1000);
    const captions = await db.pendingCaptions.toArray();

    const toMark = captions.filter(caption => {
      const isStale = caption.createdAt < cutoffTime;
      const hasUnresolvedTempId = caption.attachId && String(caption.attachId).startsWith('temp_');
      const hasLocalFirstId = caption.attachId && (String(caption.attachId).startsWith('img_') || String(caption.attachId).includes('-'));
      const hasHighRetries = (caption.retryCount || 0) >= 3;

      return (caption.status === 'pending' || caption.status === 'syncing') &&
        isStale && (hasUnresolvedTempId || hasLocalFirstId || hasHighRetries);
    });

    // Mark each caption as failed with appropriate error message instead of deleting
    for (const caption of toMark) {
      const ageMinutes = Math.round((Date.now() - caption.createdAt) / 60000);
      let errorReason = '';

      if (String(caption.attachId).startsWith('temp_')) {
        errorReason = `Photo never synced (temp ID unresolved after ${ageMinutes} minutes)`;
      } else if (String(caption.attachId).startsWith('img_') || String(caption.attachId).includes('-')) {
        errorReason = `Photo upload pending (local-first ID not yet synced after ${ageMinutes} minutes)`;
      } else if ((caption.retryCount || 0) >= 3) {
        errorReason = `Failed after ${caption.retryCount} retries over ${ageMinutes} minutes`;
      } else {
        errorReason = `Sync timed out after ${ageMinutes} minutes`;
      }

      console.log(`[IndexedDB] Marking stale caption as failed: ${caption.captionId}, attachId: ${caption.attachId}, reason: ${errorReason}`);

      await db.pendingCaptions.update(caption.captionId, {
        status: 'failed',
        error: errorReason,
        lastAttempt: Date.now()
      });
    }

    console.log(`[IndexedDB] Marked ${toMark.length} stale pending captions as failed`);
    return toMark.length;
  }

  /**
   * Get stale caption count
   */
  async getStaleCaptionCount(olderThanMinutes: number = 30): Promise<number> {
    const cutoffTime = Date.now() - (olderThanMinutes * 60 * 1000);
    const captions = await db.pendingCaptions.toArray();

    return captions.filter(caption => {
      const isStale = caption.createdAt < cutoffTime;
      const isPendingOrSyncing = caption.status === 'pending' || caption.status === 'syncing';
      return isPendingOrSyncing && isStale;
    }).length;
  }

  // ============================================================================
  // STORAGE QUOTA MANAGEMENT
  // ============================================================================

  /**
   * Get storage usage statistics
   */
  async getStorageStats(): Promise<{ usage: number, quota: number, percent: number }> {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage || 0;
        const quota = estimate.quota || 1;
        const percent = (usage / quota) * 100;

        console.log(`[IndexedDB] Storage stats: ${(usage / 1024 / 1024).toFixed(2)}MB / ${(quota / 1024 / 1024).toFixed(2)}MB (${percent.toFixed(1)}%)`);

        return { usage, quota, percent };
      }
    } catch (err) {
      console.warn('[IndexedDB] Failed to get storage estimate:', err);
    }

    return { usage: 0, quota: 0, percent: 0 };
  }

  /**
   * Request persistent storage
   */
  async requestPersistentStorage(): Promise<boolean> {
    try {
      if (navigator.storage && navigator.storage.persist) {
        const isPersisted = await navigator.storage.persisted();

        if (isPersisted) {
          console.log('[IndexedDB] Storage is already persistent');
          return true;
        }

        const granted = await navigator.storage.persist();
        console.log(`[IndexedDB] Persistent storage ${granted ? 'granted' : 'denied'}`);
        return granted;
      }
    } catch (err) {
      console.warn('[IndexedDB] Failed to request persistent storage:', err);
    }

    return false;
  }

  /**
   * Clean up old cached photos
   */
  async cleanupOldCachedPhotos(keepServiceIds: string[], maxAgeDays: number = 30): Promise<number> {
    const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    const allPhotos = await db.cachedPhotos.toArray();
    let deletedCount = 0;

    const toDelete: string[] = [];

    for (const record of allPhotos) {
      const cachedAt = record.cachedAt || 0;
      const serviceId = record.serviceId;

      if (serviceId === 'annotated') {
        continue;
      }

      const isOld = cachedAt < cutoffTime;
      const isInActiveService = keepServiceIds.includes(String(serviceId));

      if (isOld && !isInActiveService) {
        console.log(`[IndexedDB] Deleting old cached photo: ${record.attachId}, age: ${((Date.now() - cachedAt) / 86400000).toFixed(1)} days`);
        toDelete.push(record.photoKey);
        deletedCount++;
      }
    }

    await db.cachedPhotos.bulkDelete(toDelete);
    console.log(`[IndexedDB] Cleanup complete: deleted ${deletedCount} old cached photos`);
    return deletedCount;
  }

  /**
   * Get total size of cached photos
   */
  async getCachedPhotosSize(): Promise<number> {
    const allPhotos = await db.cachedPhotos.toArray();
    let totalSize = 0;

    for (const record of allPhotos) {
      if (record.imageData) {
        totalSize += record.imageData.length;
      }
    }

    console.log(`[IndexedDB] Cached photos size: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
    return totalSize;
  }

  /**
   * Get total size of pending images
   */
  async getPendingImagesSize(): Promise<number> {
    const allImages = await db.pendingImages.toArray();
    let totalSize = 0;

    for (const record of allImages) {
      if (record.fileData) {
        totalSize += record.fileData.byteLength || 0;
      }
    }

    console.log(`[IndexedDB] Pending images size: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
    return totalSize;
  }

  /**
   * Clear all cached photos
   */
  async clearAllCachedPhotos(): Promise<number> {
    const count = await db.cachedPhotos.count();
    await db.cachedPhotos.clear();
    console.log(`[IndexedDB] Cleared all ${count} cached photos`);
    return count;
  }

  // ============================================================================
  // LOCAL-FIRST IMAGE SYSTEM METHODS
  // ============================================================================

  /**
   * Generate a stable UUID for images
   */
  generateImageId(): string {
    return `img_${this.generateUUID()}`;
  }

  /**
   * Create a new local image with its blob
   */
  async createLocalImage(
    file: File,
    entityType: ImageEntityType,
    entityId: string,
    serviceId: string,
    caption: string = '',
    drawings: string = '',
    photoType: string | null = null
  ): Promise<LocalImage> {
    const imageId = this.generateImageId();
    const blobId = `blob_${this.generateUUID()}`;
    const now = Date.now();

    // US-001 FIX: Validate file before processing
    // On mobile, gallery-selected images can have empty/corrupt file data
    if (!file || file.size === 0) {
      console.error('[IndexedDB] US-001: Cannot create LocalImage - file is empty or missing');
      throw new Error('Cannot add empty image - please select the photo again');
    }

    const arrayBuffer = await file.arrayBuffer();

    // US-001 FIX: Validate arrayBuffer has content after conversion
    // This catches cases where file.size > 0 but arrayBuffer conversion fails
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      console.error('[IndexedDB] US-001: ArrayBuffer is empty after conversion. File size was:', file.size);
      throw new Error('Image data could not be read - please try again');
    }

    const localBlob: LocalBlob = {
      blobId,
      data: arrayBuffer,
      sizeBytes: file.size,
      contentType: file.type || 'image/jpeg',
      createdAt: now
    };

    const localImage: LocalImage = {
      imageId,
      entityType,
      entityId,
      serviceId,
      localBlobId: blobId,
      remoteS3Key: null,
      status: 'local_only',
      attachId: null,
      isSynced: false,
      remoteUrl: null,
      fileName: file.name || `photo_${now}.jpg`,
      fileSize: file.size,
      contentType: file.type || 'image/jpeg',
      caption,
      drawings,
      photoType,
      createdAt: now,
      updatedAt: now,
      lastError: null,
      localVersion: 1,
      remoteVerifiedAt: null,
      remoteLoadedInUI: false
    };

    const outboxItem: UploadOutboxItem = {
      opId: `op_${this.generateUUID()}`,
      type: 'UPLOAD_IMAGE',
      imageId,
      attempts: 0,
      nextRetryAt: now,  // Ready immediately - no artificial delay
      createdAt: now,
      lastError: null
    };

    await db.transaction('rw', [db.localBlobs, db.localImages, db.uploadOutbox], async () => {
      await db.localBlobs.add(localBlob);
      await db.localImages.add(localImage);
      await db.uploadOutbox.add(outboxItem);
    });

    console.log('[IndexedDB] ✅ Local image created:', imageId, 'blob:', blobId);

    this.emitChange({
      store: 'localImages',
      action: 'create',
      key: imageId,
      entityType: entityType,
      entityId: entityId,
      serviceId: serviceId
    });

    // Emit sync queue change to reset rolling sync window
    this.emitSyncQueueChange(`image_upload:${entityType}`);

    return localImage;
  }

  /**
   * Get a local image by ID
   */
  async getLocalImage(imageId: string): Promise<LocalImage | null> {
    return await db.localImages.get(imageId) || null;
  }

  /**
   * Get all local images for an entity
   */
  async getLocalImagesForEntity(entityType: ImageEntityType, entityId: string): Promise<LocalImage[]> {
    const images = await db.localImages
      .where('[entityType+entityId]')
      .equals([entityType, entityId])
      .toArray();

    images.sort((a, b) => b.createdAt - a.createdAt);
    return images;
  }

  /**
   * Get all local images for a service
   */
  async getLocalImagesForService(serviceId: string, entityType?: ImageEntityType): Promise<LocalImage[]> {
    if (entityType) {
      return await db.localImages
        .where('[serviceId+entityType]')
        .equals([serviceId, entityType])
        .toArray();
    }
    return await db.localImages
      .where('serviceId')
      .equals(serviceId)
      .toArray();
  }

  /**
   * Get verified images ordered by age for LRU pruning
   */
  async getVerifiedImagesOrderedByAge(): Promise<LocalImage[]> {
    const allImages = await db.localImages.toArray();

    const verifiedWithBlobs = allImages.filter(img =>
      img.status === 'verified' &&
      img.localBlobId &&
      img.remoteLoadedInUI
    );

    verifiedWithBlobs.sort((a, b) => a.updatedAt - b.updatedAt);

    return verifiedWithBlobs;
  }

  /**
   * Get local image by attachId
   */
  async getLocalImageByAttachId(attachId: string): Promise<LocalImage | null> {
    return await db.localImages
      .where('attachId')
      .equals(attachId)
      .first() || null;
  }

  /**
   * Update local image
   */
  async updateLocalImage(imageId: string, updates: Partial<LocalImage>): Promise<void> {
    const existing = await db.localImages.get(imageId);
    if (!existing) {
      console.warn('[IndexedDB] Local image not found for update:', imageId);
      return;
    }

    const updated: LocalImage = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
      localVersion: (existing.localVersion || 0) + 1
    };

    await db.localImages.put(updated);
    console.log('[IndexedDB] Local image updated:', imageId, 'status:', updated.status, 'version:', updated.localVersion);

    this.emitChange({
      store: 'localImages',
      action: 'update',
      key: imageId,
      entityType: updated.entityType,
      entityId: updated.entityId,
      serviceId: updated.serviceId
    });

    // CRITICAL FIX: Emit sync queue change if caption or drawings were updated
    // This ensures the sync icon shows pending count when annotations are saved on local-first photos
    if (updates.caption !== undefined || updates.drawings !== undefined) {
      this.emitSyncQueueChange('localimage_annotation_update');
      console.log('[IndexedDB] ✅ Sync queue change emitted for annotation update:', imageId);
    }
  }

  /**
   * Update local image status (convenience method)
   */
  async updateLocalImageStatus(imageId: string, status: ImageStatus, error?: string): Promise<void> {
    return this.updateLocalImage(imageId, {
      status,
      lastError: error || null
    });
  }

  /**
   * US-001 FIX: Update entityId for all LocalImages with a given old entityId
   * Used when a temp_ID visual syncs and gets a real ID - updates all photos to use the real ID
   * @param oldEntityId The temp entity ID to replace (e.g., "temp_1234567890")
   * @param newEntityId The real entity ID from server (e.g., "12345")
   * @returns Number of images updated
   */
  async updateEntityIdForImages(oldEntityId: string, newEntityId: string): Promise<number> {
    const images = await db.localImages.where('entityId').equals(oldEntityId).toArray();

    if (images.length === 0) {
      console.log(`[IndexedDB] No LocalImages found with entityId=${oldEntityId}`);
      return 0;
    }

    console.log(`[IndexedDB] US-001 FIX: Updating ${images.length} LocalImages from entityId=${oldEntityId} to ${newEntityId}`);

    // Update all images in a single transaction for atomicity
    await db.transaction('rw', db.localImages, async () => {
      for (const img of images) {
        await db.localImages.update(img.imageId, {
          entityId: newEntityId,
          updatedAt: Date.now()
        });
      }
    });

    // US-001 FIX: Also reset upload outbox items for these images
    // This fixes the race condition where photos were deferred waiting for entity sync,
    // but now that entityId is resolved, they should be processed immediately
    const imageIds = images.map(img => img.imageId);
    const now = Date.now();
    const outboxItems = await db.uploadOutbox.toArray();
    let resetCount = 0;

    for (const outboxItem of outboxItems) {
      if (imageIds.includes(outboxItem.imageId) && outboxItem.nextRetryAt > now) {
        await db.uploadOutbox.update(outboxItem.opId, {
          nextRetryAt: now,
          lastError: null  // Clear any "waiting for parent entity" error
        });
        console.log(`[IndexedDB] US-001 FIX: Reset outbox item for imageId=${outboxItem.imageId} to process immediately`);
        resetCount++;
      }
    }

    if (resetCount > 0) {
      console.log(`[IndexedDB] US-001 FIX: Reset ${resetCount} outbox items for immediate processing`);
    }

    // Emit change event to trigger liveQuery update
    this.emitChange({
      store: 'localImages',
      action: 'update',
      key: `entityId_${oldEntityId}_to_${newEntityId}`,
      entityType: images[0]?.entityType || 'visual',
      entityId: newEntityId,
      serviceId: images[0]?.serviceId || ''
    });

    console.log(`[IndexedDB] US-001 FIX: Successfully updated ${images.length} LocalImages entityId`);
    return images.length;
  }

  /**
   * Get a local blob by ID
   */
  async getLocalBlob(blobId: string): Promise<LocalBlob | null> {
    return await db.localBlobs.get(blobId) || null;
  }

  /**
   * Get blob URL for a local image
   */
  async getLocalBlobUrl(blobId: string): Promise<string | null> {
    if (!blobId) return null;

    const blob = await this.getLocalBlob(blobId);
    if (!blob || !blob.data) return null;

    const blobObject = new Blob([blob.data], { type: blob.contentType || 'image/jpeg' });
    return URL.createObjectURL(blobObject);
  }

  /**
   * Delete a local blob
   */
  async deleteLocalBlob(blobId: string): Promise<void> {
    await db.localBlobs.delete(blobId);
    console.log('[IndexedDB] Local blob deleted:', blobId);
  }

  /**
   * Prune local blob from image (after verification)
   */
  async pruneLocalBlob(imageId: string): Promise<void> {
    const image = await this.getLocalImage(imageId);
    if (!image) {
      console.warn('[IndexedDB] Image not found for pruning:', imageId);
      return;
    }

    if (!image.localBlobId) {
      console.log('[IndexedDB] Image already pruned:', imageId);
      return;
    }

    if (image.status !== 'verified') {
      console.warn('[IndexedDB] Cannot prune unverified image:', imageId, 'status:', image.status);
      return;
    }

    await this.deleteLocalBlob(image.localBlobId);

    await this.updateLocalImage(imageId, {
      localBlobId: null
    });

    console.log('[IndexedDB] ✅ Pruned local blob for image:', imageId);
  }

  // ============================================================================
  // UPLOAD OUTBOX METHODS
  // ============================================================================

  /**
   * Get pending upload items ready to process
   */
  async getReadyUploadOutboxItems(): Promise<UploadOutboxItem[]> {
    const now = Date.now();
    return await db.uploadOutbox
      .where('nextRetryAt')
      .belowOrEqual(now)
      .toArray();
  }

  /**
   * Get ALL upload outbox items
   */
  async getAllUploadOutboxItems(): Promise<UploadOutboxItem[]> {
    return await db.uploadOutbox.toArray();
  }

  /**
   * Update outbox item
   */
  async updateOutboxItem(opId: string, updates: Partial<UploadOutboxItem>): Promise<void> {
    const existing = await db.uploadOutbox.get(opId);
    if (existing) {
      await db.uploadOutbox.update(opId, updates);
    }
  }

  /**
   * Remove item from outbox
   */
  async removeOutboxItem(opId: string): Promise<void> {
    await db.uploadOutbox.delete(opId);
    console.log('[IndexedDB] Outbox item removed:', opId);
  }

  /**
   * Get outbox item by imageId
   */
  async getOutboxItemForImage(imageId: string): Promise<UploadOutboxItem | null> {
    return await db.uploadOutbox
      .where('imageId')
      .equals(imageId)
      .first() || null;
  }

  /**
   * Get count of pending uploads
   */
  async getUploadOutboxCount(): Promise<number> {
    return await db.uploadOutbox.count();
  }

  /**
   * Clean up stuck upload outbox items older than specified time with many failed attempts
   * These items are truly hopeless and should be removed to clear the sync queue
   * @returns Number of items deleted
   */
  async cleanupStuckUploadOutboxItems(olderThanMinutes: number = 60): Promise<number> {
    const cutoffTime = Date.now() - (olderThanMinutes * 60 * 1000);
    const allItems = await db.uploadOutbox.toArray();
    
    // Find truly stuck items - old with many attempts
    const stuckItems = allItems.filter(item => 
      item.createdAt < cutoffTime && item.attempts >= 5
    );
    
    if (stuckItems.length > 0) {
      console.log(`[IndexedDB] Cleaning up ${stuckItems.length} stuck upload outbox items`);
      for (const item of stuckItems) {
        console.log(`[IndexedDB]   Removing: ${item.opId} (${item.attempts} attempts, age: ${Math.round((Date.now() - item.createdAt) / 60000)}min, error: ${item.lastError || 'none'})`);
        
        // Also mark the corresponding LocalImage as failed so user knows
        const image = await db.localImages.get(item.imageId);
        if (image) {
          await db.localImages.update(item.imageId, {
            status: 'failed',
            lastError: `Upload failed after ${item.attempts} attempts: ${item.lastError || 'Unknown error'}`
          });
        }
        
        await db.uploadOutbox.delete(item.opId);
      }
    }
    
    return stuckItems.length;
  }

  /**
   * Remove an item from upload outbox by imageId
   */
  async removeFromUploadOutbox(imageId: string): Promise<void> {
    const item = await this.getOutboxItemForImage(imageId);
    if (item) {
      await db.uploadOutbox.delete(item.opId);
      console.log('[IndexedDB] Removed from upload outbox by imageId:', imageId);
    }
  }

  /**
   * Delete a LocalImage record
   */
  async deleteLocalImage(imageId: string): Promise<void> {
    await db.localImages.delete(imageId);
    console.log('[IndexedDB] LocalImage deleted:', imageId);
    
    // Emit change event for reactive subscriptions
    this.imageChange$.next({
      store: 'localImages',
      action: 'delete',
      key: imageId
    });
  }

  // ============================================================================
  // MIGRATION HELPERS
  // ============================================================================

  /**
   * Check if new image system is available
   */
  hasNewImageSystem(): boolean {
    return db.tables.some(t => t.name === 'localImages');
  }
}
