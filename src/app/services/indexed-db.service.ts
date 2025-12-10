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

@Injectable({
  providedIn: 'root'
})
export class IndexedDbService {
  private dbName = 'CaspioOfflineDB';
  private version = 1;
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
   */
  async storePhotoFile(tempId: string, file: File, visualId: string, caption?: string): Promise<void> {
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
        status: 'pending',
        createdAt: Date.now(),
      };

      const addRequest = store.put(imageData);

      addRequest.onsuccess = () => {
        console.log('[IndexedDB] Photo file stored as ArrayBuffer:', tempId, file.size, 'bytes');
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
   * Clear all data (for testing/debugging)
   */
  async clearAll(): Promise<void> {
    const db = await this.ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingRequests', 'tempIdMappings', 'pendingImages'], 'readwrite');
      
      transaction.objectStore('pendingRequests').clear();
      transaction.objectStore('tempIdMappings').clear();
      transaction.objectStore('pendingImages').clear();

      transaction.oncomplete = () => {
        console.log('[IndexedDB] All data cleared');
        resolve();
      };

      transaction.onerror = () => reject(transaction.error);
    });
  }
}

