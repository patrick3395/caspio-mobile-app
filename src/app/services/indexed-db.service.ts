import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

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
  private dbName = 'CaspioOfflineDB';
  private version = 6;  // Bumped for localImages/localBlobs/uploadOutbox stores
  private db: IDBDatabase | null = null;

  // ============================================================================
  // REACTIVE DATABASE CHANGE EVENTS (Requirement E)
  // Components subscribe to this to refresh UI when IndexedDB changes
  // ============================================================================
  public dbChange$ = new Subject<DbChangeEvent>();
  
  // Convenience subjects for specific store changes
  public imageChange$ = new Subject<DbChangeEvent>();

  constructor() {
    this.initDatabase();
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
   * Initialize IndexedDB database
   */
  private async initDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        console.error('IndexedDB failed to open:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[IndexedDB] Database initialized successfully');
        resolve();
      };

      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        const oldVersion = event.oldVersion;
        const newVersion = event.newVersion;
        console.log(`[IndexedDB] Database upgrade: v${oldVersion} -> v${newVersion}`);
        console.log(`[IndexedDB] Existing stores:`, Array.from(db.objectStoreNames || []));

        // Pending requests store
        if (!db.objectStoreNames.contains('pendingRequests')) {
          const store = db.createObjectStore('pendingRequests', { keyPath: 'requestId' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('priority', 'priority', { unique: false });
          store.createIndex('tempId', 'tempId', { unique: false });
        }

        // Temp ID mappings store
        if (!db.objectStoreNames.contains('tempIdMappings')) {
          const mappingStore = db.createObjectStore('tempIdMappings', { keyPath: 'tempId' });
          mappingStore.createIndex('realId', 'realId', { unique: false });
          mappingStore.createIndex('type', 'type', { unique: false });
        }

        // Pending images store (for large files)
        if (!db.objectStoreNames.contains('pendingImages')) {
          const imageStore = db.createObjectStore('pendingImages', { keyPath: 'imageId' });
          imageStore.createIndex('requestId', 'requestId', { unique: false });
          imageStore.createIndex('status', 'status', { unique: false });
          imageStore.createIndex('serviceId', 'serviceId', { unique: false });
          imageStore.createIndex('visualId', 'visualId', { unique: false });
        } else if (oldVersion < 4) {
          // Migration for v4: Add serviceId and visualId indexes to existing pendingImages store
          try {
            const imageStore = (event.target as IDBOpenDBRequest).transaction!.objectStore('pendingImages');
            if (!imageStore.indexNames.contains('serviceId')) {
              imageStore.createIndex('serviceId', 'serviceId', { unique: false });
              console.log('[IndexedDB] Added serviceId index to pendingImages');
            }
            if (!imageStore.indexNames.contains('visualId')) {
              imageStore.createIndex('visualId', 'visualId', { unique: false });
              console.log('[IndexedDB] Added visualId index to pendingImages');
            }
          } catch (e) {
            console.warn('[IndexedDB] Could not add indexes to pendingImages:', e);
          }
        }

        // Cached templates store (for visual/EFE templates - rarely change)
        if (!db.objectStoreNames.contains('cachedTemplates')) {
          const templateStore = db.createObjectStore('cachedTemplates', { keyPath: 'cacheKey' });
          templateStore.createIndex('type', 'type', { unique: false });
          templateStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }

        // Cached service data store (for visuals, EFE rooms per service)
        if (!db.objectStoreNames.contains('cachedServiceData')) {
          const serviceDataStore = db.createObjectStore('cachedServiceData', { keyPath: 'cacheKey' });
          serviceDataStore.createIndex('serviceId', 'serviceId', { unique: false });
          serviceDataStore.createIndex('dataType', 'dataType', { unique: false });
          serviceDataStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }

        // Pending EFE data store (for offline-created rooms/points)
        if (!db.objectStoreNames.contains('pendingEFEData')) {
          const efeStore = db.createObjectStore('pendingEFEData', { keyPath: 'tempId' });
          efeStore.createIndex('serviceId', 'serviceId', { unique: false });
          efeStore.createIndex('type', 'type', { unique: false });
          efeStore.createIndex('parentId', 'parentId', { unique: false });
        }

        // Cached photos store (for offline viewing of synced photos)
        if (!db.objectStoreNames.contains('cachedPhotos')) {
          console.log('[IndexedDB] Creating cachedPhotos store...');
          const photoStore = db.createObjectStore('cachedPhotos', { keyPath: 'photoKey' });
          photoStore.createIndex('attachId', 'attachId', { unique: false });
          photoStore.createIndex('serviceId', 'serviceId', { unique: false });
          photoStore.createIndex('cachedAt', 'cachedAt', { unique: false });
          console.log('[IndexedDB] cachedPhotos store created successfully');
        } else {
          console.log('[IndexedDB] cachedPhotos store already exists');
        }

        // Pending captions store (for independent caption/annotation syncing)
        if (!db.objectStoreNames.contains('pendingCaptions')) {
          console.log('[IndexedDB] Creating pendingCaptions store...');
          const captionStore = db.createObjectStore('pendingCaptions', { keyPath: 'captionId' });
          captionStore.createIndex('attachId', 'attachId', { unique: false });
          captionStore.createIndex('attachType', 'attachType', { unique: false });
          captionStore.createIndex('status', 'status', { unique: false });
          captionStore.createIndex('serviceId', 'serviceId', { unique: false });
          captionStore.createIndex('createdAt', 'createdAt', { unique: false });
          console.log('[IndexedDB] pendingCaptions store created successfully');
        }

        // ====================================================================
        // NEW LOCAL-FIRST IMAGE SYSTEM STORES (v6)
        // ====================================================================

        // localImages store - Single source of truth for all images
        if (!db.objectStoreNames.contains('localImages')) {
          console.log('[IndexedDB] Creating localImages store...');
          const localImagesStore = db.createObjectStore('localImages', { keyPath: 'imageId' });
          localImagesStore.createIndex('entityType', 'entityType', { unique: false });
          localImagesStore.createIndex('entityId', 'entityId', { unique: false });
          localImagesStore.createIndex('serviceId', 'serviceId', { unique: false });
          localImagesStore.createIndex('status', 'status', { unique: false });
          localImagesStore.createIndex('attachId', 'attachId', { unique: false });
          localImagesStore.createIndex('createdAt', 'createdAt', { unique: false });
          // Compound index for entity lookups
          localImagesStore.createIndex('entityType_entityId', ['entityType', 'entityId'], { unique: false });
          localImagesStore.createIndex('serviceId_entityType', ['serviceId', 'entityType'], { unique: false });
          console.log('[IndexedDB] localImages store created successfully');
        }

        // localBlobs store - Binary blob storage (separated for efficient pruning)
        if (!db.objectStoreNames.contains('localBlobs')) {
          console.log('[IndexedDB] Creating localBlobs store...');
          const localBlobsStore = db.createObjectStore('localBlobs', { keyPath: 'blobId' });
          localBlobsStore.createIndex('createdAt', 'createdAt', { unique: false });
          console.log('[IndexedDB] localBlobs store created successfully');
        }

        // uploadOutbox store - Upload queue with retry logic
        if (!db.objectStoreNames.contains('uploadOutbox')) {
          console.log('[IndexedDB] Creating uploadOutbox store...');
          const outboxStore = db.createObjectStore('uploadOutbox', { keyPath: 'opId' });
          outboxStore.createIndex('imageId', 'imageId', { unique: false });
          outboxStore.createIndex('nextRetryAt', 'nextRetryAt', { unique: false });
          outboxStore.createIndex('createdAt', 'createdAt', { unique: false });
          console.log('[IndexedDB] uploadOutbox store created successfully');
        }

        console.log('[IndexedDB] Database schema created/updated. Final stores:', Array.from(db.objectStoreNames || []));
      };
    });
  }

  /**
   * Ensure database is initialized
   */
  private async ensureDb(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.initDatabase();
    }
    return this.db!;
  }

  /**
   * Add a pending request to the queue
   */
  async addPendingRequest(request: Omit<PendingRequest, 'requestId' | 'retryCount' | 'createdAt'>): Promise<string> {
    const db = await this.ensureDb();
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

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingRequests'], 'readwrite');
      const store = transaction.objectStore('pendingRequests');
      const addRequest = store.add(fullRequest);

      addRequest.onsuccess = () => {
        console.log('[IndexedDB] Request added:', requestId);
        resolve(requestId);
      };

      addRequest.onerror = () => {
        console.error('[IndexedDB] Failed to add request:', addRequest.error);
        reject(addRequest.error);
      };
    });
  }

  /**
   * Get all pending requests (ordered by priority and timestamp)
   */
  async getPendingRequests(): Promise<PendingRequest[]> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingRequests'], 'readonly');
      const store = transaction.objectStore('pendingRequests');
      const index = store.index('status');
      const getRequest = index.getAll('pending');

      getRequest.onsuccess = () => {
        const requests = getRequest.result as PendingRequest[];

        // Sort by priority (high first) then timestamp (oldest first)
        requests.sort((a, b) => {
          const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
          const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
          return priorityDiff !== 0 ? priorityDiff : a.createdAt - b.createdAt;
        });

        resolve(requests);
      };

      getRequest.onerror = () => {
        console.error('[IndexedDB] Failed to get pending requests:', getRequest.error);
        reject(getRequest.error);
      };
    });
  }

  /**
   * Update request status
   */
  async updateRequestStatus(requestId: string, status: PendingRequest['status'], error?: string): Promise<void> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingRequests'], 'readwrite');
      const store = transaction.objectStore('pendingRequests');
      const getRequest = store.get(requestId);

      getRequest.onsuccess = () => {
        const request = getRequest.result as PendingRequest;
        if (!request) {
          reject(new Error('Request not found'));
          return;
        }

        request.status = status;
        request.lastAttempt = Date.now();
        if (error) {
          request.error = error;
        }
        if (status === 'synced') {
          request.syncedAt = Date.now();
        }

        const putRequest = store.put(request);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Increment retry count
   */
  async incrementRetryCount(requestId: string): Promise<void> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingRequests'], 'readwrite');
      const store = transaction.objectStore('pendingRequests');
      const getRequest = store.get(requestId);

      getRequest.onsuccess = () => {
        const request = getRequest.result as PendingRequest;
        if (request) {
          request.retryCount++;
          request.lastAttempt = Date.now();
          store.put(request);
        }
        resolve();
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Check if dependencies are completed
   * Dependencies are considered completed if:
   * 1. The request has status 'synced', OR
   * 2. The request no longer exists in IndexedDB (it was deleted after successful sync), OR
   * 3. A temp ID mapping exists for the dependency (meaning it was synced and got a real ID)
   */
  async areDependenciesCompleted(dependencyIds: string[]): Promise<boolean> {
    if (!dependencyIds || dependencyIds.length === 0) {
      return true;
    }

    const db = await this.ensureDb();

    for (const depId of dependencyIds) {
      // First check if this is a temp ID that has been mapped to a real ID
      // This is the most reliable way to know if a CREATE request completed
      if (depId.startsWith('temp_')) {
        const realId = await this.getRealId(depId);
        if (realId) {
          // Temp ID has been mapped to real ID - dependency is met
          console.log(`[IndexedDB] Dependency ${depId} met: mapped to real ID ${realId}`);
          continue;
        }
      }

      // Check if request still exists and its status
      const request = await new Promise<PendingRequest | undefined>((resolve) => {
        const transaction = db.transaction(['pendingRequests'], 'readonly');
        const store = transaction.objectStore('pendingRequests');
        const getRequest = store.get(depId);
        getRequest.onsuccess = () => resolve(getRequest.result);
        getRequest.onerror = () => resolve(undefined);
      });

      if (!request) {
        // Request not found - it was already synced and deleted
        console.log(`[IndexedDB] Dependency ${depId} met: request already deleted (synced)`);
        continue;
      }

      if (request.status === 'synced') {
        // Request marked as synced
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
    const db = await this.ensureDb();

    const mapping: TempIdMapping = {
      tempId,
      realId,
      type,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tempIdMappings'], 'readwrite');
      const store = transaction.objectStore('tempIdMappings');
      const putRequest = store.put(mapping);

      putRequest.onsuccess = () => {
        console.log(`[IndexedDB] Mapped ${tempId} → ${realId}`);
        resolve();
      };

      putRequest.onerror = () => reject(putRequest.error);
    });
  }

  /**
   * Get real ID from temp ID
   */
  async getRealId(tempId: string): Promise<string | null> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['tempIdMappings'], 'readonly');
      const store = transaction.objectStore('tempIdMappings');
      const getRequest = store.get(tempId);

      getRequest.onsuccess = () => {
        const mapping = getRequest.result as TempIdMapping;
        resolve(mapping ? mapping.realId : null);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Delete synced requests (cleanup)
   */
  async cleanupSyncedRequests(olderThanDays: number = 7): Promise<number> {
    const db = await this.ensureDb();
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    let deletedCount = 0;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingRequests'], 'readwrite');
      const store = transaction.objectStore('pendingRequests');
      const index = store.index('status');
      const getRequest = index.getAll('synced');

      getRequest.onsuccess = () => {
        const requests = getRequest.result as PendingRequest[];

        requests.forEach(request => {
          if (request.syncedAt && request.syncedAt < cutoffTime) {
            store.delete(request.requestId);
            deletedCount++;
          }
        });

        console.log(`[IndexedDB] Cleaned up ${deletedCount} old synced requests`);
        resolve(deletedCount);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Remove a pending request by requestId or tempId
   */
  async removePendingRequest(idOrTempId: string): Promise<void> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingRequests'], 'readwrite');
      const store = transaction.objectStore('pendingRequests');

      // First try to delete by requestId directly
      const deleteRequest = store.delete(idOrTempId);

      deleteRequest.onsuccess = () => {
        // Also try to find by tempId and delete
        const index = store.index('tempId');
        const getByTempId = index.get(idOrTempId);

        getByTempId.onsuccess = () => {
          const request = getByTempId.result as PendingRequest;
          if (request) {
            store.delete(request.requestId);
            console.log('[IndexedDB] Removed pending request by tempId:', idOrTempId);
          } else {
            console.log('[IndexedDB] Removed pending request by id:', idOrTempId);
          }
          resolve();
        };

        getByTempId.onerror = () => {
          // Still resolve - the first delete may have worked
          resolve();
        };
      };

      deleteRequest.onerror = () => reject(deleteRequest.error);
    });
  }

  /**
   * Get sync statistics (includes both old pendingRequests and new uploadOutbox)
   */
  async getSyncStats(): Promise<{
    pending: number;
    syncing: number;
    synced: number;
    failed: number;
  }> {
    const db = await this.ensureDb();

    // Get counts from pendingRequests (old system)
    const pendingRequestsStats = await new Promise<{pending: number; syncing: number; synced: number; failed: number}>((resolve, reject) => {
      const transaction = db.transaction(['pendingRequests'], 'readonly');
      const store = transaction.objectStore('pendingRequests');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const all = getAllRequest.result as PendingRequest[];
        resolve({
          pending: all.filter(r => r.status === 'pending').length,
          syncing: all.filter(r => r.status === 'syncing').length,
          synced: all.filter(r => r.status === 'synced').length,
          failed: all.filter(r => r.status === 'failed').length,
        });
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
    });

    // Get count from uploadOutbox (new LocalImage system)
    let uploadOutboxCount = 0;
    if (db.objectStoreNames.contains('uploadOutbox')) {
      uploadOutboxCount = await new Promise<number>((resolve, reject) => {
        const transaction = db.transaction(['uploadOutbox'], 'readonly');
        const store = transaction.objectStore('uploadOutbox');
        const countRequest = store.count();
        countRequest.onsuccess = () => resolve(countRequest.result);
        countRequest.onerror = () => reject(countRequest.error);
      });
    }

    // Combine counts - uploadOutbox items are pending uploads
    return {
      pending: pendingRequestsStats.pending + uploadOutboxCount,
      syncing: pendingRequestsStats.syncing,
      synced: pendingRequestsStats.synced,
      failed: pendingRequestsStats.failed,
    };
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
   * Stores as Blob (File objects don't persist reliably in IndexedDB)
   * Now also stores drawings/annotations for offline support
   * ENHANCED: Now includes serviceId for filtering by service
   */
  async storePhotoFile(tempId: string, file: File, visualId: string, caption?: string, drawings?: string, serviceId?: string): Promise<void> {
    const db = await this.ensureDb();

    // Read file as ArrayBuffer (more reliable than storing File object)
    const arrayBuffer = await file.arrayBuffer();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingImages'], 'readwrite');
      const store = transaction.objectStore('pendingImages');

      const imageData = {
        imageId: tempId,
        fileData: arrayBuffer,  // Store as ArrayBuffer
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        visualId: visualId,
        serviceId: serviceId || '',  // ENHANCED: Store serviceId for filtering
        caption: caption || '',
        drawings: drawings || '',  // Store drawings/annotations data
        status: 'pending',
        createdAt: Date.now(),
      };

      const addRequest = store.put(imageData);

      addRequest.onsuccess = () => {
        console.log('[IndexedDB] Photo file stored as ArrayBuffer:', tempId, file.size, 'bytes', 'drawings:', (drawings || '').length, 'chars');
        resolve();
      };

      addRequest.onerror = () => {
        console.error('[IndexedDB] Failed to store photo:', addRequest.error);
        reject(addRequest.error);
      };
    });
  }

  /**
   * Store photo blob with full metadata for offline-first workflow
   * This is the primary method for storing photos that need to persist across app restarts
   * @param photoId - Unique ID for the photo (temp_photo_xxx)
   * @param file - The photo file/blob
   * @param metadata - Photo metadata including visualId, serviceId, caption, drawings, status
   */
  async storePhotoBlob(photoId: string, file: File | Blob, metadata: {
    visualId: string;
    serviceId: string;
    caption?: string;
    drawings?: string;
    status?: 'pending' | 'uploading' | 'synced';
  }): Promise<void> {
    const db = await this.ensureDb();

    // Read file as ArrayBuffer (more reliable than storing File object)
    const arrayBuffer = await file.arrayBuffer();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingImages'], 'readwrite');
      const store = transaction.objectStore('pendingImages');

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
        status: metadata.status || 'pending',
        createdAt: Date.now(),
      };

      const putRequest = store.put(imageData);

      putRequest.onsuccess = () => {
        console.log('[IndexedDB] Photo blob stored:', photoId, imageData.fileSize, 'bytes, service:', metadata.serviceId);
        resolve();
      };

      putRequest.onerror = () => {
        console.error('[IndexedDB] Failed to store photo blob:', putRequest.error);
        reject(putRequest.error);
      };
    });
  }

  /**
   * Get a fresh blob URL for a stored photo
   * Creates a new blob URL from the stored ArrayBuffer
   * CRITICAL: Blob URLs are regenerated each time to work across app restarts
   * @param photoId - The photo ID to get URL for
   * @returns Fresh blob URL or null if photo not found
   */
  async getPhotoBlobUrl(photoId: string): Promise<string | null> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingImages'], 'readonly');
      const store = transaction.objectStore('pendingImages');
      const getRequest = store.get(photoId);

      getRequest.onsuccess = () => {
        const imageData = getRequest.result;

        if (!imageData || !imageData.fileData) {
          console.warn('[IndexedDB] No photo data found for blob URL:', photoId);
          resolve(null);
          return;
        }

        // Create a fresh blob and URL from the stored ArrayBuffer
        const blob = new Blob([imageData.fileData], { type: imageData.fileType || 'image/jpeg' });
        const blobUrl = URL.createObjectURL(blob);

        console.log('[IndexedDB] Generated blob URL for:', photoId);
        resolve(blobUrl);
      };

      getRequest.onerror = () => {
        console.error('[IndexedDB] Failed to get photo blob URL:', getRequest.error);
        reject(getRequest.error);
      };
    });
  }

  /**
   * Update the status of a stored photo
   * Used to track photo lifecycle: pending -> uploading -> synced
   * @param photoId - The photo ID to update
   * @param status - New status
   */
  async updatePhotoStatus(photoId: string, status: 'pending' | 'uploading' | 'synced'): Promise<void> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingImages'], 'readwrite');
      const store = transaction.objectStore('pendingImages');
      const getRequest = store.get(photoId);

      getRequest.onsuccess = () => {
        const imageData = getRequest.result;
        if (imageData) {
          imageData.status = status;
          imageData.updatedAt = Date.now();
          
          const putRequest = store.put(imageData);
          putRequest.onsuccess = () => {
            console.log('[IndexedDB] Updated photo status:', photoId, '->', status);
            resolve();
          };
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          console.warn('[IndexedDB] Photo not found for status update:', photoId);
          resolve();
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Update caption and/or drawings for a pending photo in IndexedDB
   * This is the reliable method for updating photo metadata before sync
   * CRITICAL: Use this instead of re-reading and re-storing the entire file
   * @param photoId - The photo ID (temp_photo_xxx or temp_efe_photo_xxx)
   * @param updates - Object containing caption and/or drawings to update
   * @returns true if updated, false if photo not found
   */
  async updatePendingPhotoData(photoId: string, updates: {
    caption?: string;
    drawings?: string;
  }): Promise<boolean> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingImages'], 'readwrite');
      const store = transaction.objectStore('pendingImages');
      const getRequest = store.get(photoId);

      getRequest.onsuccess = () => {
        const imageData = getRequest.result;
        if (imageData) {
          // Update only the specified fields
          if (updates.caption !== undefined) {
            imageData.caption = updates.caption;
          }
          if (updates.drawings !== undefined) {
            imageData.drawings = updates.drawings;
          }
          imageData.updatedAt = Date.now();
          
          const putRequest = store.put(imageData);
          putRequest.onsuccess = () => {
            console.log('[IndexedDB] ✅ Updated pending photo data:', photoId, 
              'caption:', (updates.caption || '').substring(0, 30),
              'drawings:', (updates.drawings || '').length, 'chars');
            resolve(true);
          };
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          console.warn('[IndexedDB] Photo not found for data update:', photoId);
          resolve(false);
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Get all pending photos for a specific service
   * Returns photos with regenerated blob URLs for display
   * @param serviceId - The service ID to filter by
   * @returns Array of photos with blob URLs
   */
  async getAllPendingPhotosForService(serviceId: string): Promise<any[]> {
    const allPhotos = await this.getAllPendingPhotos();

    // Filter by service ID
    const servicePhotos = allPhotos.filter(p => 
      String(p.serviceId) === String(serviceId) && 
      (p.status === 'pending' || p.status === 'uploading' || !p.status)
    );

    // Convert to displayable format with fresh blob URLs
    return servicePhotos.map(photo => {
      const blob = new Blob([photo.fileData], { type: photo.fileType || 'image/jpeg' });
      const blobUrl = URL.createObjectURL(blob);

      return {
        AttachID: photo.imageId,
        attachId: photo.imageId,  // CRITICAL: lowercase version for caption/annotation lookups
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
   * Reconstructs File from ArrayBuffer
   */
  async getStoredFile(fileId: string): Promise<File | null> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingImages'], 'readonly');
      const store = transaction.objectStore('pendingImages');
      const getRequest = store.get(fileId);

      getRequest.onsuccess = () => {
        const imageData = getRequest.result;

        if (!imageData || !imageData.fileData) {
          console.warn('[IndexedDB] No file data found for:', fileId);
          resolve(null);
          return;
        }

        // Reconstruct File from ArrayBuffer
        const blob = new Blob([imageData.fileData], { type: imageData.fileType });
        const file = new File([blob], imageData.fileName, { type: imageData.fileType });

        console.log('[IndexedDB] File reconstructed:', file.name, file.size, 'bytes');
        resolve(file);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Get stored photo data including file, caption, drawings, and serviceId
   * Returns full photo data for offline sync with annotations
   */
  async getStoredPhotoData(fileId: string): Promise<{ file: File; caption: string; drawings: string; visualId: string; serviceId: string } | null> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingImages'], 'readonly');
      const store = transaction.objectStore('pendingImages');
      const getRequest = store.get(fileId);

      getRequest.onsuccess = () => {
        const imageData = getRequest.result;

        if (!imageData || !imageData.fileData) {
          console.warn('[IndexedDB] No photo data found for:', fileId);
          resolve(null);
          return;
        }

        // Reconstruct File from ArrayBuffer
        const blob = new Blob([imageData.fileData], { type: imageData.fileType });
        const file = new File([blob], imageData.fileName, { type: imageData.fileType });

        console.log('[IndexedDB] Photo data retrieved:', file.name, file.size, 'bytes', 'drawings:', (imageData.drawings || '').length, 'chars');

        resolve({
          file,
          caption: imageData.caption || '',
          drawings: imageData.drawings || '',
          visualId: imageData.visualId || '',
          serviceId: imageData.serviceId || ''
        });
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Delete stored photo file after successful upload
   */
  async deleteStoredFile(fileId: string): Promise<void> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingImages'], 'readwrite');
      const store = transaction.objectStore('pendingImages');
      const deleteRequest = store.delete(fileId);

      deleteRequest.onsuccess = () => {
        console.log('[IndexedDB] Photo file deleted:', fileId);
        resolve();
      };

      deleteRequest.onerror = () => reject(deleteRequest.error);
    });
  }

  /**
   * Get all pending photo files
   * Includes both 'pending' and 'uploading' photos - only excludes 'synced'
   * This ensures photos don't disappear during page reload while uploading
   */
  async getAllPendingPhotos(): Promise<any[]> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingImages'], 'readonly');
      const store = transaction.objectStore('pendingImages');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        // Include both 'pending' and 'uploading' photos - only filter out 'synced'
        // This ensures photos don't disappear during page reload while uploading
        const allPhotos = getAllRequest.result || [];
        const pendingOrUploading = allPhotos.filter(p => 
          p.status === 'pending' || p.status === 'uploading' || !p.status
        );
        console.log(`[IndexedDB] getAllPendingPhotos: ${allPhotos.length} total, ${pendingOrUploading.length} pending/uploading`);
        resolve(pendingOrUploading);
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  }
  
  /**
   * Mark a pending photo as being uploaded (prevents re-display during sync)
   */
  async markPhotoUploading(imageId: string): Promise<void> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingImages'], 'readwrite');
      const store = transaction.objectStore('pendingImages');
      const getRequest = store.get(imageId);

      getRequest.onsuccess = () => {
        const imageData = getRequest.result;
        if (imageData) {
          imageData.status = 'uploading';
          const putRequest = store.put(imageData);
          putRequest.onsuccess = () => {
            console.log('[IndexedDB] Marked photo as uploading:', imageId);
            resolve();
          };
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve();
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }
  
  /**
   * Reset a photo back to pending status (called when upload fails)
   */
  async markPhotoPending(imageId: string): Promise<void> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingImages'], 'readwrite');
      const store = transaction.objectStore('pendingImages');
      const getRequest = store.get(imageId);

      getRequest.onsuccess = () => {
        const imageData = getRequest.result;
        if (imageData) {
          imageData.status = 'pending';
          const putRequest = store.put(imageData);
          putRequest.onsuccess = () => {
            console.log('[IndexedDB] Reset photo to pending:', imageId);
            resolve();
          };
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve();
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Get pending photos for a specific visual ID
   * Returns photos with blob URLs for display
   */
  async getPendingPhotosForVisual(visualId: string): Promise<any[]> {
    const allPhotos = await this.getAllPendingPhotos();

    // Filter by visual ID (compare as strings)
    const visualPhotos = allPhotos.filter(p => String(p.visualId) === String(visualId));

    // Convert to displayable format with blob URLs
    return visualPhotos.map(photo => {
      // Create blob URL from stored ArrayBuffer
      const blob = new Blob([photo.fileData], { type: photo.fileType || 'image/jpeg' });
      const blobUrl = URL.createObjectURL(blob);

      return {
        AttachID: photo.imageId,
        attachId: photo.imageId,  // CRITICAL: lowercase version for caption/annotation lookups
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
   * Returns a map of visualId -> photos array
   */
  async getAllPendingPhotosGroupedByVisual(): Promise<Map<string, any[]>> {
    const allPhotos = await this.getAllPendingPhotos();
    const grouped = new Map<string, any[]>();

    for (const photo of allPhotos) {
      const visualId = String(photo.visualId);

      // Create blob URL from stored ArrayBuffer
      const blob = new Blob([photo.fileData], { type: photo.fileType || 'image/jpeg' });
      const blobUrl = URL.createObjectURL(blob);

      const displayPhoto = {
        AttachID: photo.imageId,
        attachId: photo.imageId,  // CRITICAL: lowercase version for caption/annotation lookups
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
   * Stores the image data as base64 for reliable retrieval
   */
  async cachePhoto(attachId: string, serviceId: string, imageDataUrl: string, s3Key?: string): Promise<void> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedPhotos')) {
      console.warn('[IndexedDB] cachedPhotos store not available - skipping cache');
      return;
    }

    const photoKey = `photo_${attachId}`;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedPhotos'], 'readwrite');
      const store = transaction.objectStore('cachedPhotos');

      const photoData = {
        photoKey: photoKey,
        attachId: attachId,
        serviceId: serviceId,
        imageData: imageDataUrl,  // base64 data URL
        s3Key: s3Key || '',
        cachedAt: Date.now()
      };

      const putRequest = store.put(photoData);

      putRequest.onsuccess = () => {
        console.log('[IndexedDB] Photo cached:', attachId);
        resolve();
      };

      putRequest.onerror = () => {
        console.error('[IndexedDB] Failed to cache photo:', putRequest.error);
        reject(putRequest.error);
      };
    });
  }

  /**
   * Get cached photo image
   * Returns the base64 data URL or null if not cached
   */
  async getCachedPhoto(attachId: string): Promise<string | null> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedPhotos')) {
      console.warn('[IndexedDB] getCachedPhoto: cachedPhotos store does not exist! DB version:', db.version, 'Stores:', Array.from(db.objectStoreNames));
      return null;
    }

    const photoKey = `photo_${attachId}`;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedPhotos'], 'readonly');
      const store = transaction.objectStore('cachedPhotos');
      const getRequest = store.get(photoKey);

      getRequest.onsuccess = () => {
        const result = getRequest.result;
        if (result && result.imageData) {
          console.log('[IndexedDB] Cached photo found:', attachId, '(data length:', result.imageData.length, ')');
          resolve(result.imageData);
        } else {
          console.log('[IndexedDB] No cached photo found for:', attachId);
          resolve(null);
        }
      };

      getRequest.onerror = () => {
        console.error('[IndexedDB] Error getting cached photo:', getRequest.error);
        resolve(null);
      };
    });
  }

  /**
   * OPTIMIZATION: Get all cached photo IDs in a single read
   * Used to batch-check which photos are already cached before downloading
   * Returns a Set of attachment IDs that are already cached
   */
  async getAllCachedPhotoIds(): Promise<Set<string>> {
    const db = await this.ensureDb();
    const cachedIds = new Set<string>();

    if (!db.objectStoreNames.contains('cachedPhotos')) {
      console.warn('[IndexedDB] getAllCachedPhotoIds: cachedPhotos store does not exist');
      return cachedIds;
    }

    return new Promise((resolve) => {
      const transaction = db.transaction(['cachedPhotos'], 'readonly');
      const store = transaction.objectStore('cachedPhotos');
      const cursorRequest = store.openCursor();

      cursorRequest.onsuccess = (event: any) => {
        const cursor = event.target.result;
        if (cursor) {
          // Extract attachId from the record (skip annotated images)
          const record = cursor.value;
          if (record.attachId && record.serviceId !== 'annotated') {
            cachedIds.add(String(record.attachId));
          }
          cursor.continue();
        } else {
          // Cursor exhausted - return all collected IDs
          console.log(`[IndexedDB] getAllCachedPhotoIds: Found ${cachedIds.size} cached photos`);
          resolve(cachedIds);
        }
      };

      cursorRequest.onerror = () => {
        console.error('[IndexedDB] Error getting cached photo IDs:', cursorRequest.error);
        resolve(cachedIds); // Return what we have
      };
    });
  }

  /**
   * Cache an annotated image (with drawings overlay) for offline viewing
   * Uses a separate key prefix to distinguish from base images
   * @param attachId The attachment ID
   * @param blob The annotated image blob
   * @returns The base64 data URL of the cached image (for in-memory cache updates)
   */
  async cacheAnnotatedImage(attachId: string, blob: Blob): Promise<string | null> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedPhotos')) {
      console.warn('[IndexedDB] cachedPhotos store not available - skipping annotated image cache');
      return null;
    }

    // Convert blob to base64 data URL
    const imageDataUrl = await this.blobToBase64(blob);

    // Use a different key prefix for annotated images
    const photoKey = `annotated_${attachId}`;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedPhotos'], 'readwrite');
      const store = transaction.objectStore('cachedPhotos');

      const photoData = {
        photoKey: photoKey,
        attachId: attachId,
        serviceId: 'annotated',  // Special marker for annotated images
        imageData: imageDataUrl,  // base64 data URL
        s3Key: '',
        cachedAt: Date.now(),
        isAnnotated: true  // Flag to identify annotated versions
      };

      const putRequest = store.put(photoData);

      putRequest.onsuccess = () => {
        console.log('[IndexedDB] Annotated image cached:', attachId, 'size:', imageDataUrl.length);
        resolve(imageDataUrl);  // Return base64 for in-memory cache update
      };

      putRequest.onerror = () => {
        console.error('[IndexedDB] Failed to cache annotated image:', putRequest.error);
        reject(putRequest.error);
      };
    });
  }

  /**
   * Get cached annotated image
   * Returns the base64 data URL or null if not cached
   * @param attachId The attachment ID
   */
  async getCachedAnnotatedImage(attachId: string): Promise<string | null> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedPhotos')) {
      console.warn('[IndexedDB] getCachedAnnotatedImage: cachedPhotos store does not exist!');
      return null;
    }

    const photoKey = `annotated_${attachId}`;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedPhotos'], 'readonly');
      const store = transaction.objectStore('cachedPhotos');
      const getRequest = store.get(photoKey);

      getRequest.onsuccess = () => {
        const result = getRequest.result;
        if (result && result.imageData) {
          console.log('[IndexedDB] Cached annotated image found:', attachId, '(data length:', result.imageData.length, ')');
          resolve(result.imageData);
        } else {
          resolve(null);  // No cached annotated image - this is normal
        }
      };

      getRequest.onerror = () => {
        console.error('[IndexedDB] Error getting cached annotated image:', getRequest.error);
        resolve(null);
      };
    });
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
   * Delete a single cached photo by attachId
   * CRITICAL: Must be called when deleting photos to prevent stale cache
   */
  async deleteCachedPhoto(attachId: string): Promise<void> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedPhotos')) {
      return;
    }

    const photoKey = `photo_${attachId}`;
    const annotatedKey = `annotated_${attachId}`;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedPhotos'], 'readwrite');
      const store = transaction.objectStore('cachedPhotos');
      
      // Delete both the base photo and any annotated version
      store.delete(photoKey);
      store.delete(annotatedKey);

      transaction.oncomplete = () => {
        console.log('[IndexedDB] Deleted cached photo:', attachId);
        resolve();
      };

      transaction.onerror = () => {
        console.error('[IndexedDB] Failed to delete cached photo:', attachId);
        reject(transaction.error);
      };
    });
  }

  /**
   * Remove a specific attachment from the cached service data
   * CRITICAL: Must be called when deleting photos to prevent stale cache from IndexedDB
   */
  async removeAttachmentFromCache(attachId: string, dataType: 'visual_attachments' | 'efe_point_attachments'): Promise<void> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedServiceData')) {
      return;
    }

    const attachIdStr = String(attachId);
    console.log(`[IndexedDB] Removing attachment ${attachIdStr} from ${dataType} cache`);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readwrite');
      const store = transaction.objectStore('cachedServiceData');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const allCached = getAllRequest.result || [];
        let updatedCount = 0;

        for (const cached of allCached) {
          if (cached.dataType === dataType && Array.isArray(cached.data)) {
            const originalLength = cached.data.length;
            // Filter out the deleted attachment
            cached.data = cached.data.filter((att: any) => 
              String(att.AttachID) !== attachIdStr && 
              String(att.attachId) !== attachIdStr
            );
            
            if (cached.data.length < originalLength) {
              // Update the cache entry
              store.put(cached);
              updatedCount++;
              console.log(`[IndexedDB] Removed attachment from ${cached.cacheKey}, was ${originalLength} now ${cached.data.length}`);
            }
          }
        }

        transaction.oncomplete = () => {
          console.log(`[IndexedDB] Updated ${updatedCount} cache entries after removing attachment ${attachIdStr}`);
          resolve();
        };
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Clear all cached attachments data for a specific data type
   * CRITICAL: Use when attachment list needs full refresh
   */
  async clearCachedAttachments(dataType: 'visual_attachments' | 'efe_point_attachments'): Promise<void> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedServiceData')) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readwrite');
      const store = transaction.objectStore('cachedServiceData');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const allCached = getAllRequest.result || [];
        let deletedCount = 0;

        for (const cached of allCached) {
          if (cached.dataType === dataType) {
            store.delete(cached.cacheKey);
            deletedCount++;
          }
        }

        transaction.oncomplete = () => {
          console.log(`[IndexedDB] Cleared ${deletedCount} ${dataType} cache entries`);
          resolve();
        };
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Clear all cached photos for a service
   */
  async clearCachedPhotosForService(serviceId: string): Promise<void> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedPhotos')) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedPhotos'], 'readwrite');
      const store = transaction.objectStore('cachedPhotos');
      const index = store.index('serviceId');
      const request = index.openCursor(IDBKeyRange.only(serviceId));

      request.onsuccess = (event: any) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          console.log('[IndexedDB] Cleared cached photos for service:', serviceId);
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all data (for testing/debugging)
   */
  async clearAll(): Promise<void> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      // CRITICAL: Include ALL object stores to ensure complete data clear
      const storeNames = [
        'pendingRequests', 
        'tempIdMappings', 
        'pendingImages', 
        'cachedTemplates', 
        'cachedServiceData', 
        'pendingEFEData', 
        'cachedPhotos',
        'pendingCaptions'  // Added - was missing, causing stale sync items
      ];
      const existingStores = storeNames.filter(name => db.objectStoreNames.contains(name));

      const transaction = db.transaction(existingStores, 'readwrite');

      existingStores.forEach(storeName => {
        transaction.objectStore(storeName).clear();
      });

      transaction.oncomplete = () => {
        console.log('[IndexedDB] All data cleared:', existingStores);
        resolve();
      };

      transaction.onerror = () => reject(transaction.error);
    });
  }

  /**
   * Get database diagnostics for debugging
   * Useful for troubleshooting mobile vs web differences
   */
  async getDatabaseDiagnostics(): Promise<{
    version: number;
    objectStores: string[];
    cachedPhotosCount: number;
    hasCachedPhotosStore: boolean;
  }> {
    const db = await this.ensureDb();

    const hasCachedPhotosStore = db.objectStoreNames.contains('cachedPhotos');
    let cachedPhotosCount = 0;

    if (hasCachedPhotosStore) {
      cachedPhotosCount = await new Promise((resolve) => {
        const transaction = db.transaction(['cachedPhotos'], 'readonly');
        const store = transaction.objectStore('cachedPhotos');
        const countRequest = store.count();
        countRequest.onsuccess = () => resolve(countRequest.result);
        countRequest.onerror = () => resolve(0);
      });
    }

    const diagnostics = {
      version: db.version,
      objectStores: Array.from(db.objectStoreNames),
      cachedPhotosCount,
      hasCachedPhotosStore
    };

    console.log('[IndexedDB] Database diagnostics:', diagnostics);
    return diagnostics;
  }

  // ============================================
  // TEMPLATE CACHING METHODS
  // ============================================

  /**
   * Cache templates (visual or EFE) in IndexedDB
   */
  async cacheTemplates(type: 'visual' | 'efe' | 'lbw' | 'lbw_dropdown', templates: any[]): Promise<void> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedTemplates')) {
      console.warn('[IndexedDB] cachedTemplates store not available');
      return;
    }

    const cacheEntry: CachedTemplate = {
      cacheKey: `templates_${type}`,
      type,
      templates,
      lastUpdated: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedTemplates'], 'readwrite');
      const store = transaction.objectStore('cachedTemplates');
      const putRequest = store.put(cacheEntry);

      putRequest.onsuccess = () => {
        console.log(`[IndexedDB] Cached ${templates.length} ${type} templates`);
        resolve();
      };

      putRequest.onerror = () => reject(putRequest.error);
    });
  }

  /**
   * Get cached templates from IndexedDB
   */
  async getCachedTemplates(type: 'visual' | 'efe' | 'lbw' | 'lbw_dropdown'): Promise<any[] | null> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedTemplates')) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedTemplates'], 'readonly');
      const store = transaction.objectStore('cachedTemplates');
      const getRequest = store.get(`templates_${type}`);

      getRequest.onsuccess = () => {
        const cached = getRequest.result as CachedTemplate;
        if (cached) {
          console.log(`[IndexedDB] Retrieved ${cached.templates.length} cached ${type} templates`);
          resolve(cached.templates);
        } else {
          resolve(null);
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Check if template cache is still valid
   */
  async isTemplateCacheValid(type: 'visual' | 'efe' | 'lbw' | 'lbw_dropdown', maxAgeMs: number): Promise<boolean> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedTemplates')) {
      return false;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedTemplates'], 'readonly');
      const store = transaction.objectStore('cachedTemplates');
      const getRequest = store.get(`templates_${type}`);

      getRequest.onsuccess = () => {
        const cached = getRequest.result as CachedTemplate;
        if (cached && (Date.now() - cached.lastUpdated) < maxAgeMs) {
          resolve(true);
        } else {
          resolve(false);
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  // ============================================
  // GLOBAL DATA CACHING (Dropdowns, Status, etc.)
  // ============================================

  /**
   * Cache global dropdown data (Services_Drop, Projects_Drop, Status, etc.)
   * These are shared across all services and don't change often.
   */
  async cacheGlobalData(dataType: 'services_drop' | 'projects_drop' | 'status' | 'types' | 'efe_drop', data: any[]): Promise<void> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedServiceData')) {
      console.warn('[IndexedDB] cachedServiceData store not available');
      return;
    }

    const cacheEntry = {
      cacheKey: `global_${dataType}`,
      serviceId: 'global',
      dataType: dataType,
      data,
      lastUpdated: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readwrite');
      const store = transaction.objectStore('cachedServiceData');
      const putRequest = store.put(cacheEntry);

      putRequest.onsuccess = () => {
        console.log(`[IndexedDB] Cached ${data.length} global ${dataType} records`);
        resolve();
      };

      putRequest.onerror = () => reject(putRequest.error);
    });
  }

  /**
   * Get cached global data from IndexedDB
   */
  async getCachedGlobalData(dataType: 'services_drop' | 'projects_drop' | 'status' | 'types' | 'efe_drop'): Promise<any[] | null> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedServiceData')) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readonly');
      const store = transaction.objectStore('cachedServiceData');
      const getRequest = store.get(`global_${dataType}`);

      getRequest.onsuccess = () => {
        const cached = getRequest.result;
        if (cached && cached.data) {
          console.log(`[IndexedDB] Retrieved ${cached.data.length} cached global ${dataType} records`);
          resolve(cached.data);
        } else {
          resolve(null);
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  // ============================================
  // SERVICE DATA CACHING METHODS
  // ============================================

  /**
   * Safe cache update with validation
   * 
   * DEFENSIVE CACHING: Validates new data before overwriting to prevent cache corruption.
   * - Never overwrites valid cache with empty data
   * - Warns if new data is significantly smaller than existing cache
   * - Logs all cache operations for debugging
   * - Optionally merges data instead of replacing
   * 
   * @param serviceId - The service/entity ID
   * @param dataType - Type of data being cached
   * @param newData - New data to cache
   * @param options - Optional settings for the cache update
   * @returns Promise<boolean> - True if cache was updated, false if rejected
   */
  async safeUpdateCache(
    serviceId: string,
    dataType: 'visuals' | 'efe_rooms' | 'efe_points' | 'visual_attachments' | 'efe_point_attachments' | 'lbw_records' | 'lbw_attachments',
    newData: any[],
    options: {
      allowEmpty?: boolean;           // Allow overwriting with empty data (default: false)
      mergeLocalUpdates?: boolean;    // Preserve items with _localUpdate flag (default: true)
      preserveTempItems?: boolean;    // Preserve items with _tempId (default: true)
      warnThreshold?: number;         // Warn if new data is less than X% of old (default: 0.5)
    } = {}
  ): Promise<boolean> {
    const {
      allowEmpty = false,
      mergeLocalUpdates = true,
      preserveTempItems = true,
      warnThreshold = 0.5
    } = options;
    
    const db = await this.ensureDb();
    const cacheKey = `${dataType}_${serviceId}`;
    
    if (!db.objectStoreNames.contains('cachedServiceData')) {
      console.warn('[IndexedDB] safeUpdateCache: cachedServiceData store not available');
      return false;
    }
    
    // Get existing cache first
    const existingData = await this.getCachedServiceData(serviceId, dataType) || [];
    
    // VALIDATION 1: Don't overwrite valid cache with empty data
    if ((!newData || newData.length === 0) && existingData.length > 0 && !allowEmpty) {
      console.warn(`[IndexedDB] ⚠️ safeUpdateCache REJECTED: Attempted to overwrite ${existingData.length} ${dataType} with empty data`);
      return false;
    }
    
    // VALIDATION 2: Warn if significantly smaller
    if (newData && existingData.length > 0 && newData.length < existingData.length * warnThreshold) {
      console.warn(`[IndexedDB] ⚠️ safeUpdateCache WARNING: New data (${newData.length}) is much smaller than existing (${existingData.length}) for ${cacheKey}`);
      // Still allow, but log for debugging
    }
    
    let finalData = newData || [];
    
    // MERGE: Preserve local updates if requested
    if (mergeLocalUpdates && existingData.length > 0) {
      const localUpdates = existingData.filter((item: any) => item._localUpdate);
      if (localUpdates.length > 0) {
        console.log(`[IndexedDB] safeUpdateCache: Preserving ${localUpdates.length} items with _localUpdate flag`);
        
        // Build ID map for quick lookup
        const newDataIds = new Set(finalData.map((item: any) => 
          String(item.PK_ID || item.EFEID || item.VisualID || item.PointID || item.AttachID || item._tempId || '')
        ));
        
        // Add local updates that aren't in new data
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
        
        // Build ID map for quick lookup
        const finalDataIds = new Set(finalData.map((item: any) => 
          String(item._tempId || item.PK_ID || item.EFEID || item.VisualID || item.PointID || item.AttachID || '')
        ));
        
        // Add temp items that aren't in final data
        for (const tempItem of tempItems) {
          const tempId = String(tempItem._tempId || '');
          if (!finalDataIds.has(tempId)) {
            finalData.push(tempItem);
          }
        }
      }
    }
    
    // Perform the actual cache update
    await this.cacheServiceData(serviceId, dataType, finalData);
    console.log(`[IndexedDB] ✅ safeUpdateCache: Updated ${cacheKey} with ${finalData.length} items (was ${existingData.length})`);
    
    return true;
  }

  /**
   * Cache service-specific data (visuals, EFE rooms, visual attachments, etc.)
   */
  async cacheServiceData(serviceId: string, dataType: 'visuals' | 'efe_rooms' | 'efe_points' | 'visual_attachments' | 'efe_point_attachments' | 'lbw_records' | 'lbw_attachments', data: any[]): Promise<void> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedServiceData')) {
      console.warn('[IndexedDB] cachedServiceData store not available');
      return;
    }

    const cacheEntry: CachedServiceData = {
      cacheKey: `${dataType}_${serviceId}`,
      serviceId,
      dataType,
      data,
      lastUpdated: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readwrite');
      const store = transaction.objectStore('cachedServiceData');
      const putRequest = store.put(cacheEntry);

      putRequest.onsuccess = () => {
        console.log(`[IndexedDB] Cached ${data.length} ${dataType} for service ${serviceId}`);
        resolve();
      };

      putRequest.onerror = () => reject(putRequest.error);
    });
  }

  /**
   * Get cached service data from IndexedDB
   */
  async getCachedServiceData(serviceId: string, dataType: 'visuals' | 'efe_rooms' | 'efe_points' | 'visual_attachments' | 'efe_point_attachments' | 'lbw_records' | 'lbw_attachments'): Promise<any[] | null> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedServiceData')) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readonly');
      const store = transaction.objectStore('cachedServiceData');
      const getRequest = store.get(`${dataType}_${serviceId}`);

      getRequest.onsuccess = () => {
        const cached = getRequest.result as CachedServiceData;
        if (cached) {
          console.log(`[IndexedDB] Retrieved ${cached.data.length} cached ${dataType} for service ${serviceId}`);
          resolve(cached.data);
        } else {
          resolve(null);
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Get ALL cached service data entries of a specific type
   * Used to find which serviceId/visualId contains a specific attachment
   */
  async getAllCachedServiceData(dataType: 'visuals' | 'visual_attachments' | 'efe_point_attachments' | 'efe_rooms' | 'efe_points'): Promise<{ serviceId: string; data: any[] }[]> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedServiceData')) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readonly');
      const store = transaction.objectStore('cachedServiceData');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const results: { serviceId: string; data: any[] }[] = [];
        const allCached = getAllRequest.result as CachedServiceData[];

        for (const cached of allCached) {
          if (cached.dataType === dataType) {
            results.push({
              serviceId: cached.serviceId,
              data: cached.data || []
            });
          }
        }

        resolve(results);
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  }

  /**
   * BULK READ: Get ALL visual attachments for multiple visualIds in ONE IndexedDB operation
   * This eliminates N+1 reads when loading photos for a section
   * @param visualIds Array of visual IDs to fetch attachments for
   * @returns Map of visualId -> attachments array
   */
  async getAllVisualAttachmentsForVisuals(visualIds: string[]): Promise<Map<string, any[]>> {
    const db = await this.ensureDb();
    const result = new Map<string, any[]>();

    if (!db.objectStoreNames.contains('cachedServiceData') || visualIds.length === 0) {
      return result;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readonly');
      const store = transaction.objectStore('cachedServiceData');
      
      // Build set of keys to fetch
      const keysToFetch = new Set(visualIds.map(id => `visual_attachments_${id}`));
      
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const allCached = getAllRequest.result as CachedServiceData[];

        for (const cached of allCached) {
          // Check if this is a visual_attachments entry we care about
          if (cached.dataType === 'visual_attachments' && keysToFetch.has(`visual_attachments_${cached.serviceId}`)) {
            result.set(cached.serviceId, cached.data || []);
          }
        }

        console.log(`[IndexedDB] Bulk loaded ${result.size} visual attachments in ONE read`);
        resolve(result);
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  }

  /**
   * BULK READ: Get ALL cached photos for a service in ONE IndexedDB operation
   * Returns a Map for O(1) lookup instead of N individual reads
   * @param serviceId The service ID to filter photos by
   * @returns Map of attachId -> base64 data URL
   */
  async getAllCachedPhotosForService(serviceId: string): Promise<Map<string, string>> {
    const db = await this.ensureDb();
    const result = new Map<string, string>();

    if (!db.objectStoreNames.contains('cachedPhotos')) {
      return result;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedPhotos'], 'readonly');
      const store = transaction.objectStore('cachedPhotos');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const allPhotos = getAllRequest.result || [];

        for (const photo of allPhotos) {
          // Filter by serviceId if stored, otherwise include all
          if (!serviceId || photo.serviceId === serviceId || !photo.serviceId) {
            if (photo.attachId && photo.imageData) {
              result.set(String(photo.attachId), photo.imageData);
            }
          }
        }

        console.log(`[IndexedDB] Bulk loaded ${result.size} cached photos for service ${serviceId} in ONE read`);
        resolve(result);
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  }

  /**
   * BULK READ: Get ALL cached annotated images for a service in ONE IndexedDB operation
   * Returns a Map for O(1) lookup instead of N individual reads
   * @param serviceId The service ID (optional, gets all if not provided)
   * @returns Map of attachId -> base64 annotated image data URL
   */
  async getAllCachedAnnotatedImagesForService(serviceId?: string): Promise<Map<string, string>> {
    const db = await this.ensureDb();
    const result = new Map<string, string>();

    // FIX: Read from cachedPhotos store (where cacheAnnotatedImage writes)
    // not the non-existent 'annotatedImages' store
    if (!db.objectStoreNames.contains('cachedPhotos')) {
      return result;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedPhotos'], 'readonly');
      const store = transaction.objectStore('cachedPhotos');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const allPhotos = getAllRequest.result || [];

        // Filter for annotated images only (isAnnotated: true flag set by cacheAnnotatedImage)
        for (const photo of allPhotos) {
          if (photo.isAnnotated && photo.attachId && photo.imageData) {
            result.set(String(photo.attachId), photo.imageData);
          }
        }

        console.log(`[IndexedDB] Bulk loaded ${result.size} annotated images from cachedPhotos in ONE read`);
        resolve(result);
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  }

  /**
   * Check if service data cache is still valid
   */
  async isServiceDataCacheValid(serviceId: string, dataType: 'visuals' | 'efe_rooms' | 'efe_points', maxAgeMs: number): Promise<boolean> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedServiceData')) {
      return false;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readonly');
      const store = transaction.objectStore('cachedServiceData');
      const getRequest = store.get(`${dataType}_${serviceId}`);

      getRequest.onsuccess = () => {
        const cached = getRequest.result as CachedServiceData;
        if (cached && (Date.now() - cached.lastUpdated) < maxAgeMs) {
          resolve(true);
        } else {
          resolve(false);
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Invalidate all cached data for a specific service
   */
  async invalidateServiceCache(serviceId: string): Promise<void> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedServiceData')) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readwrite');
      const store = transaction.objectStore('cachedServiceData');
      const index = store.index('serviceId');
      const getRequest = index.getAllKeys(serviceId);

      getRequest.onsuccess = () => {
        const keys = getRequest.result;
        keys.forEach(key => store.delete(key));
        console.log(`[IndexedDB] Invalidated ${keys.length} cache entries for service ${serviceId}`);
        resolve();
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Clear cached service data of a specific type
   */
  async clearCachedServiceData(serviceId: string, dataType: 'visuals' | 'efe_rooms' | 'efe_points' | 'visual_attachments' | 'efe_point_attachments'): Promise<void> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedServiceData')) {
      return;
    }

    const cacheKey = `${dataType}_${serviceId}`;
    console.log(`[IndexedDB] Clearing cached data: ${cacheKey}`);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readwrite');
      const store = transaction.objectStore('cachedServiceData');
      const deleteRequest = store.delete(cacheKey);

      deleteRequest.onsuccess = () => {
        console.log(`[IndexedDB] Cleared: ${cacheKey}`);
        resolve();
      };

      deleteRequest.onerror = () => reject(deleteRequest.error);
    });
  }

  /**
   * Remove template download status to allow re-download
   */
  async removeTemplateDownloadStatus(serviceId: string, templateType: string): Promise<void> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedServiceData')) {
      return;
    }

    const cacheKey = `template_downloaded_${templateType}_${serviceId}`;
    console.log(`[IndexedDB] Removing download status: ${cacheKey}`);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readwrite');
      const store = transaction.objectStore('cachedServiceData');
      const deleteRequest = store.delete(cacheKey);

      deleteRequest.onsuccess = () => {
        console.log(`[IndexedDB] Download status removed: ${cacheKey}`);
        resolve();
      };

      deleteRequest.onerror = () => reject(deleteRequest.error);
    });
  }

  // ============================================
  // PENDING EFE DATA METHODS
  // ============================================

  /**
   * Add pending EFE data (offline-created room or point)
   */
  async addPendingEFE(data: Omit<PendingEFEData, 'createdAt'>): Promise<void> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('pendingEFEData')) {
      console.warn('[IndexedDB] pendingEFEData store not available');
      return;
    }

    const fullData: PendingEFEData = {
      ...data,
      createdAt: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingEFEData'], 'readwrite');
      const store = transaction.objectStore('pendingEFEData');
      const addRequest = store.put(fullData);

      addRequest.onsuccess = () => {
        console.log(`[IndexedDB] Added pending EFE ${data.type}:`, data.tempId);
        resolve();
      };

      addRequest.onerror = () => reject(addRequest.error);
    });
  }

  /**
   * Get all pending EFE data for a service
   */
  async getPendingEFEByService(serviceId: string): Promise<PendingEFEData[]> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('pendingEFEData')) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingEFEData'], 'readonly');
      const store = transaction.objectStore('pendingEFEData');
      const index = store.index('serviceId');
      const getRequest = index.getAll(serviceId);

      getRequest.onsuccess = () => {
        const results = getRequest.result as PendingEFEData[];
        console.log(`[IndexedDB] Found ${results.length} pending EFE items for service ${serviceId}`);
        resolve(results);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Get pending EFE points for a specific room
   */
  async getPendingEFEPoints(roomTempId: string): Promise<PendingEFEData[]> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('pendingEFEData')) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingEFEData'], 'readonly');
      const store = transaction.objectStore('pendingEFEData');
      const index = store.index('parentId');
      const getRequest = index.getAll(roomTempId);

      getRequest.onsuccess = () => {
        const results = (getRequest.result as PendingEFEData[]).filter(r => r.type === 'point');
        console.log(`[IndexedDB] Found ${results.length} pending points for room ${roomTempId}`);
        resolve(results);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Update pending EFE data (for offline rooms that need field updates like FDF)
   */
  async updatePendingEFE(tempId: string, updates: any): Promise<boolean> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('pendingEFEData')) {
      return false;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingEFEData'], 'readwrite');
      const store = transaction.objectStore('pendingEFEData');
      const getRequest = store.get(tempId);

      getRequest.onsuccess = () => {
        const existing = getRequest.result as PendingEFEData;
        if (existing) {
          // Merge updates into the data field
          existing.data = {
            ...existing.data,
            ...updates,
            _localUpdate: true
          };
          
          const putRequest = store.put(existing);
          putRequest.onsuccess = () => {
            console.log(`[IndexedDB] ✅ Updated pending EFE ${tempId} with:`, updates);
            resolve(true);
          };
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          console.log(`[IndexedDB] Pending EFE ${tempId} not found`);
          resolve(false);
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Remove pending EFE data after sync
   */
  async removePendingEFE(tempId: string): Promise<void> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('pendingEFEData')) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingEFEData'], 'readwrite');
      const store = transaction.objectStore('pendingEFEData');
      const deleteRequest = store.delete(tempId);

      deleteRequest.onsuccess = () => {
        console.log(`[IndexedDB] Removed pending EFE:`, tempId);
        resolve();
      };

      deleteRequest.onerror = () => reject(deleteRequest.error);
    });
  }

  /**
   * Get all pending EFE rooms (for restore on app start)
   */
  async getAllPendingEFERooms(): Promise<PendingEFEData[]> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('pendingEFEData')) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingEFEData'], 'readonly');
      const store = transaction.objectStore('pendingEFEData');
      const index = store.index('type');
      const getRequest = index.getAll('room');

      getRequest.onsuccess = () => {
        resolve(getRequest.result as PendingEFEData[]);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  // ============================================
  // EFE PHOTO STORAGE METHODS
  // ============================================

  /**
   * Store EFE photo file for offline upload
   * ENHANCED: Now includes serviceId for filtering by service
   */
  async storeEFEPhotoFile(tempId: string, file: File, pointId: string, photoType: string, drawings?: string, caption?: string, serviceId?: string): Promise<void> {
    const db = await this.ensureDb();

    const arrayBuffer = await file.arrayBuffer();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingImages'], 'readwrite');
      const store = transaction.objectStore('pendingImages');

      const imageData = {
        imageId: tempId,
        fileData: arrayBuffer,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        pointId: pointId,  // EFE point ID (temp or real)
        serviceId: serviceId || '',  // ENHANCED: Store serviceId for filtering
        photoType: photoType || 'Measurement',
        drawings: drawings || '',
        caption: caption || '',  // CRITICAL: Store caption for syncing
        isEFE: true,  // Flag to distinguish from visual photos
        status: 'pending',
        createdAt: Date.now(),
      };

      const addRequest = store.put(imageData);

      addRequest.onsuccess = () => {
        console.log('[IndexedDB] EFE photo file stored:', tempId, file.size, 'bytes, service:', serviceId);
        resolve();
      };

      addRequest.onerror = () => reject(addRequest.error);
    });
  }

  /**
   * Get stored EFE photo data for sync
   */
  async getStoredEFEPhotoData(fileId: string): Promise<{ file: File; drawings: string; photoType: string; pointId: string; caption: string } | null> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingImages'], 'readonly');
      const store = transaction.objectStore('pendingImages');
      const getRequest = store.get(fileId);

      getRequest.onsuccess = () => {
        const imageData = getRequest.result;

        if (!imageData || !imageData.fileData) {
          console.warn('[IndexedDB] No EFE photo data found for:', fileId);
          resolve(null);
          return;
        }

        const blob = new Blob([imageData.fileData], { type: imageData.fileType });
        const file = new File([blob], imageData.fileName, { type: imageData.fileType });

        console.log('[IndexedDB] EFE photo data retrieved:', file.name, file.size, 'bytes');

        resolve({
          file,
          drawings: imageData.drawings || '',
          photoType: imageData.photoType || 'Measurement',
          pointId: imageData.pointId || '',
          caption: imageData.caption || ''
        });
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Get pending photos for a specific EFE point
   */
  async getPendingPhotosForPoint(pointId: string): Promise<any[]> {
    const allPhotos = await this.getAllPendingPhotos();

    // Filter by point ID (EFE photos)
    const pointPhotos = allPhotos.filter(p => p.isEFE && String(p.pointId) === String(pointId));

    return pointPhotos.map(photo => {
      const blob = new Blob([photo.fileData], { type: photo.fileType || 'image/jpeg' });
      const blobUrl = URL.createObjectURL(blob);

      return {
        AttachID: photo.imageId,
        attachId: photo.imageId,  // CRITICAL: lowercase version for caption/annotation lookups
        id: photo.imageId,
        _pendingFileId: photo.imageId,
        PointID: pointId, // CRITICAL: Include PointID for filtering in room-elevation page
        url: blobUrl,
        originalUrl: blobUrl,
        thumbnailUrl: blobUrl,
        displayUrl: blobUrl,
        Type: photo.photoType || 'Measurement',
        photoType: photo.photoType || 'Measurement', // Include both formats
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
   * Returns a map of pointId -> photos array
   * CRITICAL: Call this ONCE and reuse the map to avoid N+1 IndexedDB reads
   */
  async getAllPendingPhotosGroupedByPoint(): Promise<Map<string, any[]>> {
    const allPhotos = await this.getAllPendingPhotos();
    const grouped = new Map<string, any[]>();

    // Only process EFE photos
    const efePhotos = allPhotos.filter(p => p.isEFE);

    for (const photo of efePhotos) {
      const pointId = String(photo.pointId);

      // Create blob URL from stored ArrayBuffer
      const blob = new Blob([photo.fileData], { type: photo.fileType || 'image/jpeg' });
      const blobUrl = URL.createObjectURL(blob);

      const displayPhoto = {
        AttachID: photo.imageId,
        attachId: photo.imageId,  // CRITICAL: lowercase version for caption/annotation lookups
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
   * Cache a project record for offline access
   */
  async cacheProjectRecord(projectId: string, project: any): Promise<void> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedServiceData')) {
      console.warn('[IndexedDB] cachedServiceData store not available');
      return;
    }

    const cacheEntry = {
      cacheKey: `project_record_${projectId}`,
      serviceId: projectId, // Using serviceId field for consistency
      dataType: 'project_record',
      data: [project],
      lastUpdated: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readwrite');
      const store = transaction.objectStore('cachedServiceData');
      const putRequest = store.put(cacheEntry);

      putRequest.onsuccess = () => {
        console.log(`[IndexedDB] Cached project record for ${projectId}`);
        resolve();
      };

      putRequest.onerror = () => reject(putRequest.error);
    });
  }

  /**
   * Get cached project record
   */
  async getCachedProjectRecord(projectId: string): Promise<any | null> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedServiceData')) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readonly');
      const store = transaction.objectStore('cachedServiceData');
      const getRequest = store.get(`project_record_${projectId}`);

      getRequest.onsuccess = () => {
        const cached = getRequest.result;
        if (cached && cached.data && cached.data.length > 0) {
          resolve(cached.data[0]);
        } else {
          resolve(null);
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  // ============================================
  // SERVICE RECORD CACHING
  // ============================================

  /**
   * Cache a service record for offline access
   */
  async cacheServiceRecord(serviceId: string, service: any): Promise<void> {
    const db = await this.ensureDb();

    console.log(`[IndexedDB] cacheServiceRecord(${serviceId}): input service =`, JSON.stringify(service).substring(0, 300));

    if (!db.objectStoreNames.contains('cachedServiceData')) {
      console.warn('[IndexedDB] cachedServiceData store not available');
      return;
    }

    const cacheEntry = {
      cacheKey: `service_record_${serviceId}`,
      serviceId,
      dataType: 'service_record',
      data: [service], // Wrap in array for consistency
      lastUpdated: Date.now(),
    };

    console.log(`[IndexedDB] cacheServiceRecord(${serviceId}): cacheEntry.data =`, JSON.stringify(cacheEntry.data).substring(0, 300));

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readwrite');
      const store = transaction.objectStore('cachedServiceData');
      const putRequest = store.put(cacheEntry);

      putRequest.onsuccess = () => {
        console.log(`[IndexedDB] cacheServiceRecord(${serviceId}): SUCCESS - cached service record`);
        resolve();
      };

      putRequest.onerror = () => {
        console.error(`[IndexedDB] cacheServiceRecord(${serviceId}): FAILED`, putRequest.error);
        reject(putRequest.error);
      };
    });
  }

  /**
   * Get cached service record
   */
  async getCachedServiceRecord(serviceId: string): Promise<any | null> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedServiceData')) {
      console.log(`[IndexedDB] getCachedServiceRecord(${serviceId}): store not found`);
      return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readonly');
      const store = transaction.objectStore('cachedServiceData');
      const getRequest = store.get(`service_record_${serviceId}`);

      getRequest.onsuccess = () => {
        const cached = getRequest.result;
        console.log(`[IndexedDB] getCachedServiceRecord(${serviceId}): raw cached =`, cached);
        if (cached && cached.data && cached.data.length > 0) {
          console.log(`[IndexedDB] getCachedServiceRecord(${serviceId}): returning data[0] =`, JSON.stringify(cached.data[0]).substring(0, 200));
          resolve(cached.data[0]);
        } else {
          console.log(`[IndexedDB] getCachedServiceRecord(${serviceId}): no data found, returning null`);
          resolve(null);
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  // ============================================
  // TEMPLATE DOWNLOAD TRACKING
  // ============================================

  /**
   * Mark a template as fully downloaded for offline use
   */
  async markTemplateDownloaded(serviceId: string, templateType: string): Promise<void> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedServiceData')) {
      return;
    }

    const cacheEntry = {
      cacheKey: `download_status_${templateType}_${serviceId}`,
      serviceId,
      dataType: 'download_status',
      data: [{ downloaded: true, timestamp: Date.now(), templateType }],
      lastUpdated: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readwrite');
      const store = transaction.objectStore('cachedServiceData');
      const putRequest = store.put(cacheEntry);

      putRequest.onsuccess = () => {
        console.log(`[IndexedDB] Marked ${templateType} template as downloaded for service ${serviceId}`);
        resolve();
      };

      putRequest.onerror = () => reject(putRequest.error);
    });
  }

  /**
   * Check if a template has been downloaded
   */
  async isTemplateDownloaded(serviceId: string, templateType: string): Promise<boolean> {
    const db = await this.ensureDb();
    const cacheKey = `download_status_${templateType}_${serviceId}`;
    console.log(`[IndexedDB] isTemplateDownloaded(${serviceId}, ${templateType}): checking key ${cacheKey}`);

    if (!db.objectStoreNames.contains('cachedServiceData')) {
      console.log(`[IndexedDB] isTemplateDownloaded: cachedServiceData store not found`);
      return false;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedServiceData'], 'readonly');
      const store = transaction.objectStore('cachedServiceData');
      const getRequest = store.get(cacheKey);

      getRequest.onsuccess = () => {
        const cached = getRequest.result;
        console.log(`[IndexedDB] isTemplateDownloaded(${serviceId}, ${templateType}): cached =`, cached);
        if (cached && cached.data && cached.data.length > 0 && cached.data[0].downloaded) {
          // Check if download is recent (within 7 days)
          const downloadAge = Date.now() - cached.data[0].timestamp;
          const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
          const isRecent = downloadAge < maxAge;
          console.log(`[IndexedDB] isTemplateDownloaded(${serviceId}, ${templateType}): downloadAge=${downloadAge}ms, maxAge=${maxAge}ms, isRecent=${isRecent}`);
          resolve(isRecent);
        } else {
          console.log(`[IndexedDB] isTemplateDownloaded(${serviceId}, ${templateType}): no download status found, returning false`);
          resolve(false);
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  // ============================================
  // PENDING REQUEST DATA UPDATES
  // ============================================

  /**
   * Update data in a pending request (for editing before sync)
   */
  async updatePendingRequestData(tempId: string, updates: any): Promise<void> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingRequests'], 'readwrite');
      const store = transaction.objectStore('pendingRequests');
      const index = store.index('tempId');
      const getRequest = index.get(tempId);

      getRequest.onsuccess = () => {
        const request = getRequest.result as PendingRequest;
        if (request) {
          // Merge updates into existing data
          request.data = { ...request.data, ...updates };

          const putRequest = store.put(request);
          putRequest.onsuccess = () => {
            console.log(`[IndexedDB] Updated pending request data for ${tempId}`);
            resolve();
          };
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          console.warn(`[IndexedDB] No pending request found with tempId ${tempId}`);
          resolve();
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Get all pending requests (including non-pending statuses)
   */
  async getAllRequests(): Promise<PendingRequest[]> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingRequests'], 'readonly');
      const store = transaction.objectStore('pendingRequests');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        resolve(getAllRequest.result as PendingRequest[]);
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  }

  /**
   * Clear/delete old pending requests that are stuck or broken
   * Use this to remove requests that should not be syncing
   * 
   * @param olderThanMinutes - Clear requests older than this many minutes (default: 5)
   * @returns Number of requests cleared
   */
  async clearOldPendingRequests(olderThanMinutes: number = 5): Promise<number> {
    const db = await this.ensureDb();
    const cutoffTime = Date.now() - (olderThanMinutes * 60 * 1000);
    let clearedCount = 0;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingRequests'], 'readwrite');
      const store = transaction.objectStore('pendingRequests');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const requests = getAllRequest.result as PendingRequest[];
        
        for (const request of requests) {
          // Clear pending or failed requests that are old
          if ((request.status === 'pending' || request.status === 'failed') && 
              request.createdAt < cutoffTime) {
            store.delete(request.requestId);
            clearedCount++;
            console.log(`[IndexedDB] Cleared stuck request: ${request.requestId} (type: ${request.type}, created: ${new Date(request.createdAt).toISOString()})`);
          }
        }

        console.log(`[IndexedDB] Cleared ${clearedCount} stuck pending requests`);
        resolve(clearedCount);
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  }

  /**
   * Clear ALL pending requests and related data (for complete reset)
   * Use when data has been deleted and sync queue needs to be emptied
   * @returns Number of items cleared
   */
  async clearAllPendingSync(): Promise<{ requests: number; captions: number; images: number }> {
    const db = await this.ensureDb();
    const result = { requests: 0, captions: 0, images: 0 };

    // Clear pending requests
    if (db.objectStoreNames.contains('pendingRequests')) {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['pendingRequests'], 'readwrite');
        const store = transaction.objectStore('pendingRequests');
        const countRequest = store.count();
        countRequest.onsuccess = () => {
          result.requests = countRequest.result;
          store.clear();
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }

    // Clear pending captions
    if (db.objectStoreNames.contains('pendingCaptions')) {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['pendingCaptions'], 'readwrite');
        const store = transaction.objectStore('pendingCaptions');
        const countRequest = store.count();
        countRequest.onsuccess = () => {
          result.captions = countRequest.result;
          store.clear();
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }

    // Clear pending images
    if (db.objectStoreNames.contains('pendingImages')) {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['pendingImages'], 'readwrite');
        const store = transaction.objectStore('pendingImages');
        const countRequest = store.count();
        countRequest.onsuccess = () => {
          result.images = countRequest.result;
          store.clear();
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }

    console.log(`[IndexedDB] Cleared all pending sync: ${result.requests} requests, ${result.captions} captions, ${result.images} images`);
    return result;
  }

  /**
   * Force retry all old pending requests
   * Resets retry count and lastAttempt to make them eligible for immediate sync
   * 
   * @param olderThanMinutes - Reset requests older than this many minutes (default: 5)
   * @returns Number of requests reset
   */
  async forceRetryOldRequests(olderThanMinutes: number = 5): Promise<number> {
    const db = await this.ensureDb();
    const cutoffTime = Date.now() - (olderThanMinutes * 60 * 1000);
    let resetCount = 0;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingRequests'], 'readwrite');
      const store = transaction.objectStore('pendingRequests');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const requests = getAllRequest.result as PendingRequest[];
        
        for (const request of requests) {
          // Reset pending or failed status requests that are old
          if ((request.status === 'pending' || request.status === 'failed') && 
              request.createdAt < cutoffTime) {
            request.retryCount = 0;
            request.lastAttempt = 0;
            request.status = 'pending';
            request.error = undefined;
            store.put(request);
            resetCount++;
            console.log(`[IndexedDB] Reset old request: ${request.requestId} (was ${request.retryCount} retries)`);
          }
        }

        console.log(`[IndexedDB] Force reset ${resetCount} old pending requests`);
        resolve(resetCount);
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  }

  /**
   * Clear all stale/abandoned requests
   * Removes requests that have been pending for too long without syncing
   * 
   * @param olderThanHours - Clear requests older than this many hours (default: 24)
   * @returns Number of requests cleared
   */
  async clearStaleRequests(olderThanHours: number = 24): Promise<number> {
    const db = await this.ensureDb();
    const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
    let clearedCount = 0;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingRequests'], 'readwrite');
      const store = transaction.objectStore('pendingRequests');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const requests = getAllRequest.result as PendingRequest[];
        
        for (const request of requests) {
          // Clear requests that have been pending for too long
          if (request.createdAt < cutoffTime) {
            store.delete(request.requestId);
            clearedCount++;
            console.log(`[IndexedDB] Cleared stale request: ${request.requestId} (created ${new Date(request.createdAt).toISOString()})`);
          }
        }

        console.log(`[IndexedDB] Cleared ${clearedCount} stale requests older than ${olderThanHours} hours`);
        resolve(clearedCount);
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  }

  /**
   * Get sync diagnostic info
   * Returns summary of pending requests grouped by status and age
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
      // Count by status
      byStatus[request.status] = (byStatus[request.status] || 0) + 1;
      
      // Count by type
      byType[request.type] = (byType[request.type] || 0) + 1;
      
      // Track oldest pending
      if (request.status === 'pending') {
        if (oldestPending === null || request.createdAt < oldestPending) {
          oldestPending = request.createdAt;
        }
        
        // Count stuck (pending for over an hour)
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
  // PENDING CAPTIONS - Independent Caption/Annotation Sync
  // ============================================

  /**
   * Queue a caption update for background sync
   * This is the primary method for caption changes - ALWAYS queues regardless of online state
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
    const db = await this.ensureDb();
    const captionId = `caption_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = Date.now();

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

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingCaptions'], 'readwrite');
      const store = transaction.objectStore('pendingCaptions');
      
      // Check if we already have a pending update for this attachment
      // If so, update it instead of creating a new one
      const index = store.index('attachId');
      const getRequest = index.getAll(data.attachId);
      
      getRequest.onsuccess = () => {
        const existing = (getRequest.result as PendingCaptionUpdate[])
          .filter(c => c.status === 'pending' || c.status === 'failed');
        
        if (existing.length > 0) {
          // Update the most recent pending one
          const toUpdate = existing[existing.length - 1];
          if (data.caption !== undefined) toUpdate.caption = data.caption;
          if (data.drawings !== undefined) toUpdate.drawings = data.drawings;
          toUpdate.updatedAt = now;
          
          const putRequest = store.put(toUpdate);
          putRequest.onsuccess = () => {
            console.log('[IndexedDB] ✅ Updated pending caption:', toUpdate.captionId, 'for attach:', data.attachId);
            resolve(toUpdate.captionId);
          };
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          // Create new pending caption
          const addRequest = store.add(pendingCaption);
          addRequest.onsuccess = () => {
            console.log('[IndexedDB] ✅ Queued new caption update:', captionId, 'for attach:', data.attachId);
            resolve(captionId);
          };
          addRequest.onerror = () => reject(addRequest.error);
        }
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Get all pending caption updates ready for sync
   * Includes: pending captions, stuck syncing captions, and failed captions ready for retry
   */
  async getPendingCaptions(): Promise<PendingCaptionUpdate[]> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingCaptions'], 'readonly');
      const store = transaction.objectStore('pendingCaptions');
      const getRequest = store.getAll();

      getRequest.onsuccess = () => {
        const allCaptions = getRequest.result as PendingCaptionUpdate[];
        const now = Date.now();
        const stuckThreshold = 2 * 60 * 1000; // 2 minutes - consider syncing stuck after this
        
        const readyForSync = allCaptions.filter(caption => {
          // Include pending with backoff check (prevents rapid retry loops on mobile)
          if (caption.status === 'pending') {
            // If never attempted, include immediately
            if (!caption.lastAttempt || caption.retryCount === 0) {
              return true;
            }
            // Apply exponential backoff for retried items
            const retryCount = caption.retryCount || 0;
            const retryDelay = Math.min(30000 * Math.pow(2, retryCount - 1), 300000); // 30s, 60s, 120s, max 5min
            const timeSinceAttempt = now - caption.lastAttempt;
            if (timeSinceAttempt >= retryDelay) {
              return true;
            }
            return false; // Not ready for retry yet
          }
          
          // Include stuck 'syncing' captions (stuck for more than 2 minutes)
          if (caption.status === 'syncing') {
            const timeSinceUpdate = now - (caption.updatedAt || caption.createdAt);
            if (timeSinceUpdate > stuckThreshold) {
              console.log(`[IndexedDB] Caption ${caption.captionId} stuck in syncing for ${Math.round(timeSinceUpdate/1000)}s, including for retry`);
              return true;
            }
            return false; // Still actively syncing
          }
          
          // Include failed captions ready for retry (with exponential backoff)
          if (caption.status === 'failed') {
            const retryCount = caption.retryCount || 0;
            if (retryCount >= 10) {
              return false; // Max retries reached (increased from 5)
            }
            const retryDelay = Math.min(30000 * Math.pow(2, retryCount), 300000); // 30s, 60s, 120s, 240s, max 5min
            const timeSinceUpdate = now - (caption.lastAttempt || caption.updatedAt || caption.createdAt);
            if (timeSinceUpdate >= retryDelay) {
              console.log(`[IndexedDB] Failed caption ${caption.captionId} ready for retry (attempt ${retryCount + 1})`);
              return true;
            }
            return false; // Not ready for retry yet
          }
          
          return false; // synced or other status
        });
        
        // Sort by creation time (oldest first)
        readyForSync.sort((a, b) => a.createdAt - b.createdAt);
        resolve(readyForSync);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Get all pending caption updates (all statuses)
   */
  async getAllPendingCaptions(): Promise<PendingCaptionUpdate[]> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingCaptions'], 'readonly');
      const store = transaction.objectStore('pendingCaptions');
      const getRequest = store.getAll();

      getRequest.onsuccess = () => {
        resolve(getRequest.result as PendingCaptionUpdate[]);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Get pending caption updates for a list of attachment IDs
   * Used by pages to merge pending captions with loaded photos
   * Returns captions that are pending or syncing (not yet applied to server)
   */
  async getPendingCaptionsForAttachments(attachIds: string[]): Promise<PendingCaptionUpdate[]> {
    const db = await this.ensureDb();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingCaptions'], 'readonly');
      const store = transaction.objectStore('pendingCaptions');
      const getAllRequest = store.getAll();
      
      getAllRequest.onsuccess = () => {
        const allCaptions = getAllRequest.result as PendingCaptionUpdate[] || [];
        // CRITICAL FIX: Include ALL non-failed captions (pending, syncing, AND synced)
        // Synced captions might not be in cache yet if page reloaded quickly after sync
        // This was causing captions to disappear on reload
        const matching = allCaptions.filter(c =>
          attachIds.includes(c.attachId) &&
          c.status !== 'failed'
        );
        console.log(`[IndexedDB] getPendingCaptionsForAttachments: Found ${matching.length} captions for ${attachIds.length} attachIds (including synced)`);
        resolve(matching);
      };
      
      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  }

  /**
   * Update caption status
   * @param incrementRetry If true, increments retry count for exponential backoff
   */
  async updateCaptionStatus(
    captionId: string, 
    status: 'pending' | 'syncing' | 'synced' | 'failed', 
    error?: string,
    incrementRetry: boolean = false
  ): Promise<void> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingCaptions'], 'readwrite');
      const store = transaction.objectStore('pendingCaptions');
      const getRequest = store.get(captionId);

      getRequest.onsuccess = () => {
        const caption = getRequest.result as PendingCaptionUpdate;
        if (caption) {
          caption.status = status;
          caption.updatedAt = Date.now();
          caption.lastAttempt = Date.now();  // Track last attempt for backoff
          if (error) caption.error = error;
          // Increment retry for 'failed' status OR when explicitly requested
          if (status === 'failed' || incrementRetry) {
            caption.retryCount = (caption.retryCount || 0) + 1;
          }

          const putRequest = store.put(caption);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve(); // Caption not found, already processed
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Delete a caption update after successful sync
   */
  async deletePendingCaption(captionId: string): Promise<void> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingCaptions'], 'readwrite');
      const store = transaction.objectStore('pendingCaptions');
      const deleteRequest = store.delete(captionId);

      deleteRequest.onsuccess = () => {
        console.log('[IndexedDB] ✅ Deleted synced caption:', captionId);
        resolve();
      };

      deleteRequest.onerror = () => reject(deleteRequest.error);
    });
  }

  /**
   * Clean up orphaned captions - captions with temp IDs whose photos no longer exist
   * An orphaned caption has a temp attachId but:
   * 1. No corresponding pending image exists
   * 2. No real ID mapping exists (photo never synced)
   * This typically happens when a photo is deleted before syncing
   */
  async cleanupOrphanedCaptions(): Promise<number> {
    const db = await this.ensureDb();
    let deletedCount = 0;

    try {
      // Get all captions with temp IDs
      const allCaptions = await this.getAllPendingCaptions();
      const tempIdCaptions = allCaptions.filter(c => 
        String(c.attachId || '').startsWith('temp_')
      );

      if (tempIdCaptions.length === 0) {
        return 0;
      }

      console.log(`[IndexedDB] Checking ${tempIdCaptions.length} captions with temp IDs for orphans...`);

      // Get all pending images to check which temp IDs still have photos
      const pendingImagesMap = new Set<string>();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['pendingImages'], 'readonly');
        const store = tx.objectStore('pendingImages');
        const getAllRequest = store.getAll();
        
        getAllRequest.onsuccess = () => {
          const images = getAllRequest.result || [];
          images.forEach((img: any) => {
            if (img.imageId) {
              pendingImagesMap.add(String(img.imageId));
            }
          });
          resolve();
        };
        getAllRequest.onerror = () => reject(getAllRequest.error);
      });

      // Check each temp ID caption
      for (const caption of tempIdCaptions) {
        const tempId = String(caption.attachId);
        
        // Check if pending image exists
        if (pendingImagesMap.has(tempId)) {
          continue; // Photo still pending, not orphaned
        }

        // Check if real ID mapping exists
        const realId = await this.getRealId(tempId);
        if (realId) {
          // Update the caption's attachId to the real ID instead of deleting
          caption.attachId = realId;
          caption.updatedAt = Date.now();
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(['pendingCaptions'], 'readwrite');
            const store = tx.objectStore('pendingCaptions');
            const putRequest = store.put(caption);
            putRequest.onsuccess = () => resolve();
            putRequest.onerror = () => reject(putRequest.error);
          });
          console.log(`[IndexedDB] Updated orphaned caption ${caption.captionId} with real ID: ${tempId} → ${realId}`);
          continue;
        }

        // No pending image AND no real ID mapping - this caption is orphaned
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
   * Update attachId for pending captions when a temp ID is resolved to a real ID
   * This is called after photo sync completes to update any pending caption updates
   */
  async updateCaptionAttachId(tempAttachId: string, realAttachId: string): Promise<number> {
    const db = await this.ensureDb();
    let updatedCount = 0;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingCaptions'], 'readwrite');
      const store = transaction.objectStore('pendingCaptions');
      const index = store.index('attachId');
      const getRequest = index.getAll(tempAttachId);

      getRequest.onsuccess = () => {
        const captions = getRequest.result as PendingCaptionUpdate[];
        
        for (const caption of captions) {
          caption.attachId = realAttachId;
          caption.updatedAt = Date.now();
          store.put(caption);
          updatedCount++;
          console.log(`[IndexedDB] Updated caption ${caption.captionId} attachId: ${tempAttachId} → ${realAttachId}`);
        }

        resolve(updatedCount);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Get pending caption count for sync status display
   */
  async getPendingCaptionCount(): Promise<number> {
    const pending = await this.getPendingCaptions();
    return pending.length;
  }

  /**
   * Clear old synced/failed captions (cleanup)
   */
  async clearOldCaptions(olderThanHours: number = 24): Promise<number> {
    const db = await this.ensureDb();
    const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000);
    let clearedCount = 0;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingCaptions'], 'readwrite');
      const store = transaction.objectStore('pendingCaptions');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const captions = getAllRequest.result as PendingCaptionUpdate[];
        
        for (const caption of captions) {
          // Clear synced captions or old failed ones
          if (caption.status === 'synced' || 
              (caption.status === 'failed' && caption.createdAt < cutoffTime)) {
            store.delete(caption.captionId);
            clearedCount++;
          }
        }

        console.log(`[IndexedDB] Cleared ${clearedCount} old caption updates`);
        resolve(clearedCount);
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  }

  /**
   * Clear stale pending captions (stuck for more than X minutes)
   * Use this to clean up captions that never synced due to temp ID issues
   */
  async clearStalePendingCaptions(olderThanMinutes: number = 30): Promise<number> {
    const db = await this.ensureDb();
    const cutoffTime = Date.now() - (olderThanMinutes * 60 * 1000);
    let clearedCount = 0;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingCaptions'], 'readwrite');
      const store = transaction.objectStore('pendingCaptions');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const captions = getAllRequest.result as PendingCaptionUpdate[];
        
        for (const caption of captions) {
          // Clear stale pending captions (stuck for too long)
          const isStale = caption.createdAt < cutoffTime;
          const hasUnresolvedTempId = caption.attachId && caption.attachId.startsWith('temp_');
          const hasHighRetries = (caption.retryCount || 0) >= 3;
          
          if ((caption.status === 'pending' || caption.status === 'syncing') && 
              isStale && (hasUnresolvedTempId || hasHighRetries)) {
            console.log(`[IndexedDB] Clearing stale caption: ${caption.captionId}, attachId: ${caption.attachId}, age: ${(Date.now() - caption.createdAt) / 60000}min`);
            store.delete(caption.captionId);
            clearedCount++;
          }
        }

        console.log(`[IndexedDB] Cleared ${clearedCount} stale pending caption updates`);
        resolve(clearedCount);
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  }

  /**
   * Get count of stale pending captions (for UI display)
   */
  async getStaleCaptionCount(olderThanMinutes: number = 30): Promise<number> {
    const db = await this.ensureDb();
    const cutoffTime = Date.now() - (olderThanMinutes * 60 * 1000);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingCaptions'], 'readonly');
      const store = transaction.objectStore('pendingCaptions');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const captions = getAllRequest.result as PendingCaptionUpdate[];
        let count = 0;
        
        for (const caption of captions) {
          const isStale = caption.createdAt < cutoffTime;
          const isPendingOrSyncing = caption.status === 'pending' || caption.status === 'syncing';
          
          if (isPendingOrSyncing && isStale) {
            count++;
          }
        }

        resolve(count);
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  }

  // ============================================================================
  // STORAGE QUOTA MANAGEMENT
  // ============================================================================

  /**
   * Get storage usage statistics
   * Uses navigator.storage.estimate() when available
   * Returns usage, quota, and percentage used
   */
  async getStorageStats(): Promise<{usage: number, quota: number, percent: number}> {
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
    
    // Fallback: return zeros if API not available
    return { usage: 0, quota: 0, percent: 0 };
  }

  /**
   * Request persistent storage to prevent browser eviction
   * Important for iOS/Safari where storage may be evicted under pressure
   * Returns true if persistent storage was granted
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
   * Clean up old cached photos to free storage space
   * Deletes photos older than maxAgeDays that aren't in keepServiceIds
   * @param keepServiceIds - Service IDs to preserve (active/recent projects)
   * @param maxAgeDays - Maximum age in days for photos not in keepServiceIds
   * @returns Number of deleted photos
   */
  async cleanupOldCachedPhotos(keepServiceIds: string[], maxAgeDays: number = 30): Promise<number> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('cachedPhotos')) {
      console.warn('[IndexedDB] cleanupOldCachedPhotos: cachedPhotos store does not exist');
      return 0;
    }

    const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    let deletedCount = 0;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedPhotos'], 'readwrite');
      const store = transaction.objectStore('cachedPhotos');
      const cursorRequest = store.openCursor();

      cursorRequest.onsuccess = (event: any) => {
        const cursor = event.target.result;
        
        if (cursor) {
          const record = cursor.value;
          const cachedAt = record.cachedAt || 0;
          const serviceId = record.serviceId;
          
          // Skip annotated images (special marker)
          if (serviceId === 'annotated') {
            cursor.continue();
            return;
          }
          
          // Check if this photo should be deleted
          const isOld = cachedAt < cutoffTime;
          const isInActiveService = keepServiceIds.includes(String(serviceId));
          
          if (isOld && !isInActiveService) {
            console.log(`[IndexedDB] Deleting old cached photo: ${record.attachId}, age: ${((Date.now() - cachedAt) / 86400000).toFixed(1)} days`);
            cursor.delete();
            deletedCount++;
          }
          
          cursor.continue();
        } else {
          // Cursor exhausted
          console.log(`[IndexedDB] Cleanup complete: deleted ${deletedCount} old cached photos`);
          resolve(deletedCount);
        }
      };

      cursorRequest.onerror = () => {
        console.error('[IndexedDB] Error during cached photo cleanup:', cursorRequest.error);
        reject(cursorRequest.error);
      };
    });
  }

  /**
   * Get total size of cached photos in bytes
   * Useful for debugging and monitoring storage usage
   */
  async getCachedPhotosSize(): Promise<number> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('cachedPhotos')) {
      return 0;
    }

    return new Promise((resolve) => {
      const transaction = db.transaction(['cachedPhotos'], 'readonly');
      const store = transaction.objectStore('cachedPhotos');
      const cursorRequest = store.openCursor();
      let totalSize = 0;

      cursorRequest.onsuccess = (event: any) => {
        const cursor = event.target.result;
        
        if (cursor) {
          const record = cursor.value;
          // Estimate size from base64 string length
          if (record.imageData) {
            totalSize += record.imageData.length;
          }
          cursor.continue();
        } else {
          console.log(`[IndexedDB] Cached photos size: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
          resolve(totalSize);
        }
      };

      cursorRequest.onerror = () => {
        resolve(0);
      };
    });
  }

  /**
   * Get total size of pending images in bytes
   * These are photos waiting to be uploaded
   */
  async getPendingImagesSize(): Promise<number> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('pendingImages')) {
      return 0;
    }

    return new Promise((resolve) => {
      const transaction = db.transaction(['pendingImages'], 'readonly');
      const store = transaction.objectStore('pendingImages');
      const cursorRequest = store.openCursor();
      let totalSize = 0;

      cursorRequest.onsuccess = (event: any) => {
        const cursor = event.target.result;
        
        if (cursor) {
          const record = cursor.value;
          // Size from ArrayBuffer
          if (record.fileData) {
            totalSize += record.fileData.byteLength || 0;
          }
          cursor.continue();
        } else {
          console.log(`[IndexedDB] Pending images size: ${(totalSize / 1024 / 1024).toFixed(2)}MB`);
          resolve(totalSize);
        }
      };

      cursorRequest.onerror = () => {
        resolve(0);
      };
    });
  }

  /**
   * Clear all cached photos (emergency cleanup)
   * Use with caution - will require re-downloading all photos
   */
  async clearAllCachedPhotos(): Promise<number> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('cachedPhotos')) {
      return 0;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedPhotos'], 'readwrite');
      const store = transaction.objectStore('cachedPhotos');
      
      // Count before clearing
      const countRequest = store.count();
      
      countRequest.onsuccess = () => {
        const count = countRequest.result;
        
        const clearRequest = store.clear();
        
        clearRequest.onsuccess = () => {
          console.log(`[IndexedDB] Cleared all ${count} cached photos`);
          resolve(count);
        };
        
        clearRequest.onerror = () => reject(clearRequest.error);
      };
      
      countRequest.onerror = () => reject(countRequest.error);
    });
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
   * This is the entry point for capturing photos - fully local-first
   */
  async createLocalImage(
    file: File,
    entityType: ImageEntityType,
    entityId: string,
    serviceId: string,
    caption: string = '',
    drawings: string = '',
    photoType: string | null = null  // 'Measurement' | 'Location' for EFE, 'Top' | 'Bottom' | 'Threshold' for FDF
  ): Promise<LocalImage> {
    const db = await this.ensureDb();
    
    const imageId = this.generateImageId();
    const blobId = `blob_${this.generateUUID()}`;
    const now = Date.now();

    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // Create blob record
    const localBlob: LocalBlob = {
      blobId,
      data: arrayBuffer,
      sizeBytes: file.size,
      contentType: file.type || 'image/jpeg',
      createdAt: now
    };

    // Create image record
    const localImage: LocalImage = {
      imageId,
      entityType,
      entityId,
      serviceId,
      localBlobId: blobId,
      remoteS3Key: null,
      status: 'local_only',
      attachId: null,
      fileName: file.name || `photo_${now}.jpg`,
      fileSize: file.size,
      contentType: file.type || 'image/jpeg',
      caption,
      drawings,
      photoType,  // Store the photo type (Measurement/Location/Top/Bottom/Threshold)
      createdAt: now,
      updatedAt: now,
      lastError: null,
      localVersion: 1,           // Initial version for cache freshness tracking
      remoteVerifiedAt: null,
      remoteLoadedInUI: false
    };

    // Create outbox item - delay processing by 5 seconds to batch multiple captures
    const outboxItem: UploadOutboxItem = {
      opId: `op_${this.generateUUID()}`,
      type: 'UPLOAD_IMAGE',
      imageId,
      attempts: 0,
      nextRetryAt: now + 5000, // Delay by 5 seconds to allow batching
      createdAt: now,
      lastError: null
    };

    return new Promise((resolve, reject) => {
      // Single transaction for atomicity
      const transaction = db.transaction(['localBlobs', 'localImages', 'uploadOutbox'], 'readwrite');
      
      transaction.onerror = () => {
        console.error('[IndexedDB] Failed to create local image:', transaction.error);
        reject(transaction.error);
      };

      transaction.oncomplete = () => {
        console.log('[IndexedDB] ✅ Local image created:', imageId, 'blob:', blobId);
        
        // Emit change event for reactive UI updates (Requirement E)
        this.emitChange({
          store: 'localImages',
          action: 'create',
          key: imageId,
          entityType: entityType,
          entityId: entityId,
          serviceId: serviceId
        });
        
        resolve(localImage);
      };

      // Store blob
      const blobStore = transaction.objectStore('localBlobs');
      blobStore.add(localBlob);

      // Store image
      const imageStore = transaction.objectStore('localImages');
      imageStore.add(localImage);

      // Store outbox item (queues for upload)
      const outboxStore = transaction.objectStore('uploadOutbox');
      outboxItem.attempts = 0; // Ensure it's queued
      outboxStore.add(outboxItem);
    });
  }

  /**
   * Get a local image by ID
   */
  async getLocalImage(imageId: string): Promise<LocalImage | null> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('localImages')) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['localImages'], 'readonly');
      const store = transaction.objectStore('localImages');
      const request = store.get(imageId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all local images for an entity (visual, point, etc.)
   */
  async getLocalImagesForEntity(entityType: ImageEntityType, entityId: string): Promise<LocalImage[]> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('localImages')) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['localImages'], 'readonly');
      const store = transaction.objectStore('localImages');
      const index = store.index('entityType_entityId');
      const request = index.getAll([entityType, entityId]);

      request.onsuccess = () => {
        const images = request.result || [];
        // Sort by createdAt descending (newest first)
        images.sort((a, b) => b.createdAt - a.createdAt);
        resolve(images);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all local images for a service
   */
  async getLocalImagesForService(serviceId: string, entityType?: ImageEntityType): Promise<LocalImage[]> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('localImages')) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['localImages'], 'readonly');
      const store = transaction.objectStore('localImages');
      
      let request: IDBRequest;
      if (entityType) {
        const index = store.index('serviceId_entityType');
        request = index.getAll([serviceId, entityType]);
      } else {
        const index = store.index('serviceId');
        request = index.getAll(serviceId);
      }

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all verified images ordered by updatedAt (oldest first) for LRU pruning
   * Used for storage pressure cleanup (Requirement F)
   */
  async getVerifiedImagesOrderedByAge(): Promise<LocalImage[]> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('localImages')) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['localImages'], 'readonly');
      const store = transaction.objectStore('localImages');
      const request = store.getAll();

      request.onsuccess = () => {
        const allImages = request.result || [];
        
        // Filter to verified images with local blobs and that have been loaded in UI
        const verifiedWithBlobs = allImages.filter((img: LocalImage) => 
          img.status === 'verified' && 
          img.localBlobId && 
          img.remoteLoadedInUI
        );
        
        // Sort by updatedAt ascending (oldest first for LRU)
        verifiedWithBlobs.sort((a: LocalImage, b: LocalImage) => a.updatedAt - b.updatedAt);
        
        resolve(verifiedWithBlobs);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get local image by attachId (for looking up after sync)
   */
  async getLocalImageByAttachId(attachId: string): Promise<LocalImage | null> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('localImages')) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['localImages'], 'readonly');
      const store = transaction.objectStore('localImages');
      const index = store.index('attachId');
      const request = index.get(attachId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update local image status and fields
   */
  async updateLocalImage(imageId: string, updates: Partial<LocalImage>): Promise<void> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('localImages')) {
      throw new Error('localImages store not available');
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['localImages'], 'readwrite');
      const store = transaction.objectStore('localImages');
      const getRequest = store.get(imageId);

      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        if (!existing) {
          console.warn('[IndexedDB] Local image not found for update:', imageId);
          resolve();
          return;
        }

        // Increment localVersion on every write for cache freshness (Requirement E)
        const updated: LocalImage = {
          ...existing,
          ...updates,
          updatedAt: Date.now(),
          localVersion: (existing.localVersion || 0) + 1
        };

        const putRequest = store.put(updated);
        putRequest.onsuccess = () => {
          console.log('[IndexedDB] Local image updated:', imageId, 'status:', updated.status, 'version:', updated.localVersion);
          
          // Emit change event for reactive UI updates (Requirement E)
          this.emitChange({
            store: 'localImages',
            action: 'update',
            key: imageId,
            entityType: updated.entityType,
            entityId: updated.entityId,
            serviceId: updated.serviceId
          });
          
          resolve();
        };
        putRequest.onerror = () => reject(putRequest.error);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
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
   * Get a local blob by ID
   */
  async getLocalBlob(blobId: string): Promise<LocalBlob | null> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('localBlobs')) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['localBlobs'], 'readonly');
      const store = transaction.objectStore('localBlobs');
      const request = store.get(blobId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get blob URL for a local image
   * Returns null if blob doesn't exist (pruned or not found)
   */
  async getLocalBlobUrl(blobId: string): Promise<string | null> {
    if (!blobId) return null;
    
    const blob = await this.getLocalBlob(blobId);
    if (!blob || !blob.data) return null;

    // Create object URL from ArrayBuffer
    const blobObject = new Blob([blob.data], { type: blob.contentType || 'image/jpeg' });
    return URL.createObjectURL(blobObject);
  }

  /**
   * Delete a local blob (prune after verification)
   */
  async deleteLocalBlob(blobId: string): Promise<void> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('localBlobs')) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['localBlobs'], 'readwrite');
      const store = transaction.objectStore('localBlobs');
      const request = store.delete(blobId);

      request.onsuccess = () => {
        console.log('[IndexedDB] Local blob deleted:', blobId);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Prune local blob from image (after verification)
   * Keeps image record but removes blob reference and actual blob data
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

    // Delete the blob
    await this.deleteLocalBlob(image.localBlobId);

    // Update image to remove blob reference
    await this.updateLocalImage(imageId, {
      localBlobId: null
    });

    console.log('[IndexedDB] ✅ Pruned local blob for image:', imageId);
  }

  // ============================================================================
  // UPLOAD OUTBOX METHODS
  // ============================================================================

  /**
   * Get pending upload items that are ready to process
   */
  async getReadyUploadOutboxItems(): Promise<UploadOutboxItem[]> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('uploadOutbox')) {
      return [];
    }

    const now = Date.now();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['uploadOutbox'], 'readonly');
      const store = transaction.objectStore('uploadOutbox');
      const index = store.index('nextRetryAt');
      
      // Get all items where nextRetryAt <= now
      const range = IDBKeyRange.upperBound(now);
      const request = index.getAll(range);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get ALL upload outbox items (for display in sync modal)
   */
  async getAllUploadOutboxItems(): Promise<UploadOutboxItem[]> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('uploadOutbox')) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['uploadOutbox'], 'readonly');
      const store = transaction.objectStore('uploadOutbox');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update outbox item (for retry tracking)
   */
  async updateOutboxItem(opId: string, updates: Partial<UploadOutboxItem>): Promise<void> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('uploadOutbox')) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['uploadOutbox'], 'readwrite');
      const store = transaction.objectStore('uploadOutbox');
      const getRequest = store.get(opId);

      getRequest.onsuccess = () => {
        const existing = getRequest.result;
        if (!existing) {
          resolve();
          return;
        }

        const updated = { ...existing, ...updates };
        const putRequest = store.put(updated);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Remove item from outbox (after successful upload)
   */
  async removeOutboxItem(opId: string): Promise<void> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('uploadOutbox')) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['uploadOutbox'], 'readwrite');
      const store = transaction.objectStore('uploadOutbox');
      const request = store.delete(opId);

      request.onsuccess = () => {
        console.log('[IndexedDB] Outbox item removed:', opId);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get outbox item by imageId
   */
  async getOutboxItemForImage(imageId: string): Promise<UploadOutboxItem | null> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('uploadOutbox')) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['uploadOutbox'], 'readonly');
      const store = transaction.objectStore('uploadOutbox');
      const index = store.index('imageId');
      const request = index.get(imageId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get count of pending uploads
   */
  async getUploadOutboxCount(): Promise<number> {
    const db = await this.ensureDb();
    
    if (!db.objectStoreNames.contains('uploadOutbox')) {
      return 0;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['uploadOutbox'], 'readonly');
      const store = transaction.objectStore('uploadOutbox');
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ============================================================================
  // MIGRATION HELPERS
  // ============================================================================

  /**
   * Check if new image system is available
   */
  hasNewImageSystem(): boolean {
    return this.db?.objectStoreNames.contains('localImages') || false;
  }
}

