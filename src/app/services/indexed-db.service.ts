import { Injectable } from '@angular/core';

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
  type: 'visual' | 'efe';
  templates: any[];
  lastUpdated: number;
}

export interface CachedServiceData {
  cacheKey: string;
  serviceId: string;
  dataType: 'visuals' | 'efe_rooms' | 'efe_points' | 'visual_attachments' | 'efe_point_attachments';
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

@Injectable({
  providedIn: 'root'
})
export class IndexedDbService {
  private dbName = 'CaspioOfflineDB';
  private version = 3;  // Bumped for cachedPhotos store
  private db: IDBDatabase | null = null;

  constructor() {
    this.initDatabase();
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
          const photoStore = db.createObjectStore('cachedPhotos', { keyPath: 'photoKey' });
          photoStore.createIndex('attachId', 'attachId', { unique: false });
          photoStore.createIndex('serviceId', 'serviceId', { unique: false });
          photoStore.createIndex('cachedAt', 'cachedAt', { unique: false });
        }

        console.log('[IndexedDB] Database schema created');
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
   */
  async areDependenciesCompleted(dependencyIds: string[]): Promise<boolean> {
    if (!dependencyIds || dependencyIds.length === 0) {
      return true;
    }

    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingRequests'], 'readonly');
      const store = transaction.objectStore('pendingRequests');
      let allCompleted = true;

      const checkNext = (index: number) => {
        if (index >= dependencyIds.length) {
          resolve(allCompleted);
          return;
        }

        const getRequest = store.get(dependencyIds[index]);
        getRequest.onsuccess = () => {
          const request = getRequest.result as PendingRequest;
          if (!request || request.status !== 'synced') {
            allCompleted = false;
          }
          checkNext(index + 1);
        };
        getRequest.onerror = () => {
          allCompleted = false;
          checkNext(index + 1);
        };
      };

      checkNext(0);
    });
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
   * Get sync statistics
   */
  async getSyncStats(): Promise<{
    pending: number;
    syncing: number;
    synced: number;
    failed: number;
  }> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingRequests'], 'readonly');
      const store = transaction.objectStore('pendingRequests');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        const all = getAllRequest.result as PendingRequest[];
        const stats = {
          pending: all.filter(r => r.status === 'pending').length,
          syncing: all.filter(r => r.status === 'syncing').length,
          synced: all.filter(r => r.status === 'synced').length,
          failed: all.filter(r => r.status === 'failed').length,
        };
        resolve(stats);
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
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
   */
  async storePhotoFile(tempId: string, file: File, visualId: string, caption?: string, drawings?: string): Promise<void> {
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
   * Get stored photo data including file, caption, and drawings
   * Returns full photo data for offline sync with annotations
   */
  async getStoredPhotoData(fileId: string): Promise<{ file: File; caption: string; drawings: string; visualId: string } | null> {
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
          visualId: imageData.visualId || ''
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
   */
  async getAllPendingPhotos(): Promise<any[]> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingImages'], 'readonly');
      const store = transaction.objectStore('pendingImages');
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => {
        resolve(getAllRequest.result || []);
      };

      getAllRequest.onerror = () => reject(getAllRequest.error);
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
          console.log('[IndexedDB] Cached photo found:', attachId);
          resolve(result.imageData);
        } else {
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
   * Clear all cached photos (for fresh refresh)
   */
  async clearAllCachedPhotos(): Promise<void> {
    const db = await this.ensureDb();

    if (!db.objectStoreNames.contains('cachedPhotos')) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['cachedPhotos'], 'readwrite');
      const store = transaction.objectStore('cachedPhotos');
      const clearRequest = store.clear();

      clearRequest.onsuccess = () => {
        console.log('[IndexedDB] All cached photos cleared');
        resolve();
      };

      clearRequest.onerror = () => reject(clearRequest.error);
    });
  }

  /**
   * Clear all data (for testing/debugging)
   */
  async clearAll(): Promise<void> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const storeNames = ['pendingRequests', 'tempIdMappings', 'pendingImages', 'cachedTemplates', 'cachedServiceData', 'pendingEFEData', 'cachedPhotos'];
      const existingStores = storeNames.filter(name => db.objectStoreNames.contains(name));

      const transaction = db.transaction(existingStores, 'readwrite');

      existingStores.forEach(storeName => {
        transaction.objectStore(storeName).clear();
      });

      transaction.oncomplete = () => {
        console.log('[IndexedDB] All data cleared');
        resolve();
      };

      transaction.onerror = () => reject(transaction.error);
    });
  }

  // ============================================
  // TEMPLATE CACHING METHODS
  // ============================================

  /**
   * Cache templates (visual or EFE) in IndexedDB
   */
  async cacheTemplates(type: 'visual' | 'efe', templates: any[]): Promise<void> {
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
  async getCachedTemplates(type: 'visual' | 'efe'): Promise<any[] | null> {
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
  async isTemplateCacheValid(type: 'visual' | 'efe', maxAgeMs: number): Promise<boolean> {
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
   * Cache service-specific data (visuals, EFE rooms, visual attachments, etc.)
   */
  async cacheServiceData(serviceId: string, dataType: 'visuals' | 'efe_rooms' | 'efe_points' | 'visual_attachments' | 'efe_point_attachments', data: any[]): Promise<void> {
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
  async getCachedServiceData(serviceId: string, dataType: 'visuals' | 'efe_rooms' | 'efe_points' | 'visual_attachments' | 'efe_point_attachments'): Promise<any[] | null> {
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
   */
  async storeEFEPhotoFile(tempId: string, file: File, pointId: string, photoType: string, drawings?: string): Promise<void> {
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
        photoType: photoType || 'Measurement',
        drawings: drawings || '',
        isEFE: true,  // Flag to distinguish from visual photos
        status: 'pending',
        createdAt: Date.now(),
      };

      const addRequest = store.put(imageData);

      addRequest.onsuccess = () => {
        console.log('[IndexedDB] EFE photo file stored:', tempId, file.size, 'bytes');
        resolve();
      };

      addRequest.onerror = () => reject(addRequest.error);
    });
  }

  /**
   * Get stored EFE photo data for sync
   */
  async getStoredEFEPhotoData(fileId: string): Promise<{ file: File; drawings: string; photoType: string; pointId: string } | null> {
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
          pointId: imageData.pointId || ''
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
        id: photo.imageId,
        _pendingFileId: photo.imageId,
        url: blobUrl,
        originalUrl: blobUrl,
        thumbnailUrl: blobUrl,
        displayUrl: blobUrl,
        Type: photo.photoType || 'Measurement',
        drawings: photo.drawings || '',
        Drawings: photo.drawings || '',
        queued: true,
        uploading: false,
        isPending: true,
        isEFE: true,
        createdAt: photo.createdAt
      };
    });
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
}

