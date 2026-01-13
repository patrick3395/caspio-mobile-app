import Dexie, { Table, liveQuery } from 'dexie';
import { Observable, from } from 'rxjs';
import { switchMap, shareReplay } from 'rxjs/operators';
import {
  LocalImage,
  LocalBlob,
  UploadOutboxItem,
  PendingRequest,
  TempIdMapping,
  CachedServiceData,
  CachedTemplate,
  PendingCaptionUpdate,
  PendingEFEData,
  ImageEntityType
} from './indexed-db.service';

// ============================================================================
// ADDITIONAL INTERFACES FOR CASPIO DB
// ============================================================================

export interface CachedPhoto {
  photoKey: string;
  attachId: string;
  serviceId: string;
  imageData: string;
  s3Key?: string;
  cachedAt: number;
  isAnnotated?: boolean;
}

export type OperationType = 'CREATE_ROOM' | 'CREATE_POINT' | 'UPLOAD_PHOTO' | 'UPDATE_ROOM' | 'DELETE_ROOM' |
                            'CREATE_VISUAL' | 'UPDATE_VISUAL' | 'DELETE_VISUAL' | 'UPLOAD_VISUAL_PHOTO' |
                            'UPLOAD_VISUAL_PHOTO_UPDATE' | 'UPLOAD_ROOM_POINT_PHOTO_UPDATE' | 'UPLOAD_FDF_PHOTO';
export type OperationStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'cancelled';

export interface QueuedOperation {
  id: string;
  type: OperationType;
  status: OperationStatus;
  retryCount: number;
  maxRetries: number;
  data: any;
  dependencies: string[];
  createdAt: number;
  lastAttempt: number;
  error?: string;
  dedupeKey?: string;
}

export interface PendingImage {
  imageId: string;
  fileData: ArrayBuffer;
  fileName: string;
  fileSize: number;
  fileType: string;
  visualId?: string;
  pointId?: string;
  serviceId: string;
  caption: string;
  drawings: string;
  photoType?: string;
  status: 'pending' | 'uploading' | 'synced';
  isEFE?: boolean;
  createdAt: number;
  updatedAt?: number;
}

// ============================================================================
// DEXIE DATABASE CLASS
// ============================================================================

export class CaspioDB extends Dexie {
  // Table declarations with proper types
  localImages!: Table<LocalImage, string>;
  localBlobs!: Table<LocalBlob, string>;
  uploadOutbox!: Table<UploadOutboxItem, string>;
  pendingRequests!: Table<PendingRequest, string>;
  tempIdMappings!: Table<TempIdMapping, string>;
  cachedServiceData!: Table<CachedServiceData, string>;
  cachedTemplates!: Table<CachedTemplate, string>;
  cachedPhotos!: Table<CachedPhoto, string>;
  pendingCaptions!: Table<PendingCaptionUpdate, string>;
  pendingEFEData!: Table<PendingEFEData, string>;
  pendingImages!: Table<PendingImage, string>;
  operationsQueue!: Table<QueuedOperation, string>;

  constructor() {
    super('CaspioOfflineDB');

    // Version 6 schema - matches existing native IndexedDB schema
    this.version(6).stores({
      // Local-first image system (v6)
      localImages: 'imageId, entityType, entityId, serviceId, status, attachId, createdAt, [entityType+entityId], [serviceId+entityType]',
      localBlobs: 'blobId, createdAt',
      uploadOutbox: 'opId, imageId, nextRetryAt, createdAt',

      // Core sync system
      pendingRequests: 'requestId, timestamp, status, priority, tempId',
      tempIdMappings: 'tempId, realId, type',

      // Caching
      cachedServiceData: 'cacheKey, serviceId, dataType, lastUpdated',
      cachedTemplates: 'cacheKey, type, lastUpdated',
      cachedPhotos: 'photoKey, attachId, serviceId, cachedAt',

      // Pending data
      pendingCaptions: 'captionId, attachId, attachType, status, serviceId, createdAt',
      pendingEFEData: 'tempId, serviceId, type, parentId',
      pendingImages: 'imageId, requestId, status, serviceId, visualId'
    });

    // Version 7: Add operations queue table for persistent queue storage
    this.version(7).stores({
      // Local-first image system
      localImages: 'imageId, entityType, entityId, serviceId, status, attachId, createdAt, [entityType+entityId], [serviceId+entityType]',
      localBlobs: 'blobId, createdAt',
      uploadOutbox: 'opId, imageId, nextRetryAt, createdAt',

      // Core sync system
      pendingRequests: 'requestId, timestamp, status, priority, tempId',
      tempIdMappings: 'tempId, realId, type',

      // Caching
      cachedServiceData: 'cacheKey, serviceId, dataType, lastUpdated',
      cachedTemplates: 'cacheKey, type, lastUpdated',
      cachedPhotos: 'photoKey, attachId, serviceId, cachedAt',

      // Pending data
      pendingCaptions: 'captionId, attachId, attachType, status, serviceId, createdAt',
      pendingEFEData: 'tempId, serviceId, type, parentId',
      pendingImages: 'imageId, requestId, status, serviceId, visualId',

      // Operations queue (v7) - replaces localStorage-based persistence
      operationsQueue: 'id, type, status, createdAt, dedupeKey'
    });

    // Log successful database open
    this.on('ready', () => {
      console.log('[CaspioDB] Database initialized successfully with Dexie');
    });
  }

  // ============================================================================
  // LIVE QUERY OBSERVABLES FOR REACTIVE UI BINDING
  // These methods convert Dexie's liveQuery to proper RxJS Observables
  // that work correctly with Angular's change detection
  // ============================================================================

  /**
   * Helper to convert Dexie liveQuery to RxJS Observable
   * Dexie's liveQuery returns a Dexie-specific observable, this ensures compatibility with RxJS
   */
  private toRxObservable<T>(dexieObservable: any): Observable<T> {
    return new Observable<T>(subscriber => {
      const subscription = dexieObservable.subscribe(
        (value: T) => subscriber.next(value),
        (error: any) => subscriber.error(error),
        () => subscriber.complete()
      );
      return () => subscription.unsubscribe();
    });
  }

  /**
   * Live query for local images by service and optional entity type
   * Auto-updates when data changes
   */
  liveLocalImages$(serviceId: string, entityType?: ImageEntityType): Observable<LocalImage[]> {
    const query = liveQuery(() => {
      if (entityType) {
        return this.localImages
          .where('[serviceId+entityType]')
          .equals([serviceId, entityType])
          .toArray();
      }
      return this.localImages.where('serviceId').equals(serviceId).toArray();
    });
    return this.toRxObservable<LocalImage[]>(query);
  }

  /**
   * Live query for local images by entity
   */
  liveLocalImagesByEntity$(entityType: ImageEntityType, entityId: string): Observable<LocalImage[]> {
    const query = liveQuery(() =>
      this.localImages
        .where('[entityType+entityId]')
        .equals([entityType, entityId])
        .toArray()
    );
    return this.toRxObservable<LocalImage[]>(query);
  }

  /**
   * Live query for pending requests
   */
  livePendingRequests$(): Observable<PendingRequest[]> {
    const query = liveQuery(() =>
      this.pendingRequests.where('status').equals('pending').toArray()
    );
    return this.toRxObservable<PendingRequest[]>(query);
  }

  /**
   * Live query for all pending requests (any status)
   */
  liveAllPendingRequests$(): Observable<PendingRequest[]> {
    const query = liveQuery(() =>
      this.pendingRequests.toArray()
    );
    return this.toRxObservable<PendingRequest[]>(query);
  }

  /**
   * Live query for upload outbox items
   */
  liveUploadOutbox$(): Observable<UploadOutboxItem[]> {
    const query = liveQuery(() => this.uploadOutbox.toArray());
    return this.toRxObservable<UploadOutboxItem[]>(query);
  }

  /**
   * Live query for failed local images (photos that failed to upload)
   */
  liveFailedLocalImages$(): Observable<LocalImage[]> {
    const query = liveQuery(() =>
      this.localImages.where('status').equals('failed').toArray()
    );
    return this.toRxObservable<LocalImage[]>(query);
  }

  /**
   * Live query for pending captions
   */
  livePendingCaptions$(): Observable<PendingCaptionUpdate[]> {
    const query = liveQuery(() =>
      this.pendingCaptions
        .where('status')
        .anyOf(['pending', 'syncing'])
        .toArray()
    );
    return this.toRxObservable<PendingCaptionUpdate[]>(query);
  }

  /**
   * Live query for all pending captions (any status)
   */
  liveAllPendingCaptions$(): Observable<PendingCaptionUpdate[]> {
    const query = liveQuery(() =>
      this.pendingCaptions.toArray()
    );
    return this.toRxObservable<PendingCaptionUpdate[]>(query);
  }

  /**
   * Live query for pending images (legacy system)
   */
  livePendingImages$(): Observable<PendingImage[]> {
    const query = liveQuery(() =>
      this.pendingImages
        .filter(img => img.status === 'pending' || img.status === 'uploading')
        .toArray()
    );
    return this.toRxObservable<PendingImage[]>(query);
  }

  /**
   * Live query for pending EFE data by service
   */
  livePendingEFEData$(serviceId: string): Observable<PendingEFEData[]> {
    const query = liveQuery(() =>
      this.pendingEFEData.where('serviceId').equals(serviceId).toArray()
    );
    return this.toRxObservable<PendingEFEData[]>(query);
  }

  /**
   * Live query for sync stats (combined counts)
   * Returns counts matching the SyncStatus interface: pending, synced, failed
   */
  liveSyncStats$(): Observable<{ pending: number; synced: number; failed: number; uploading: number; total: number }> {
    const query = liveQuery(async () => {
      const [
        pendingRequests,
        syncedRequests,
        failedRequests,
        uploadOutbox,
        pendingCaptions,
        failedCaptions
      ] = await Promise.all([
        this.pendingRequests.where('status').equals('pending').count(),
        this.pendingRequests.where('status').equals('synced').count(),
        this.pendingRequests.where('status').equals('failed').count(),
        this.uploadOutbox.count(),
        this.pendingCaptions.where('status').anyOf(['pending', 'syncing']).count(),
        this.pendingCaptions.where('status').equals('failed').count()
      ]);

      return {
        pending: pendingRequests + pendingCaptions + uploadOutbox,
        synced: syncedRequests,
        failed: failedRequests + failedCaptions,
        uploading: uploadOutbox,
        total: pendingRequests + uploadOutbox + pendingCaptions + failedRequests + failedCaptions
      };
    });
    return this.toRxObservable<{ pending: number; synced: number; failed: number; uploading: number; total: number }>(query);
  }

  /**
   * TASK 3: Non-reactive sync stats getter for immediate feedback
   * Used by sync widget to get immediate counts when pendingChanges$ fires
   */
  async getSyncStats(): Promise<{ pending: number; synced: number; failed: number; uploading: number; total: number }> {
    const [
      pendingRequests,
      syncedRequests,
      failedRequests,
      uploadOutbox,
      pendingCaptions,
      failedCaptions
    ] = await Promise.all([
      this.pendingRequests.where('status').equals('pending').count(),
      this.pendingRequests.where('status').equals('synced').count(),
      this.pendingRequests.where('status').equals('failed').count(),
      this.uploadOutbox.count(),
      this.pendingCaptions.where('status').anyOf(['pending', 'syncing']).count(),
      this.pendingCaptions.where('status').equals('failed').count()
    ]);

    return {
      pending: pendingRequests + pendingCaptions + uploadOutbox,
      synced: syncedRequests,
      failed: failedRequests + failedCaptions,
      uploading: uploadOutbox,
      total: pendingRequests + uploadOutbox + pendingCaptions + failedRequests + failedCaptions
    };
  }

  /**
   * Live query for cached service data by service ID and data type
   */
  liveCachedServiceData$(serviceId: string, dataType: string): Observable<any[] | null> {
    const query = liveQuery(async () => {
      const cached = await this.cachedServiceData.get(`${dataType}_${serviceId}`);
      return cached?.data || null;
    });
    return this.toRxObservable<any[] | null>(query);
  }
}

// ============================================================================
// SINGLETON DATABASE INSTANCE
// ============================================================================

export const db = new CaspioDB();
