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
// DEXIE DEBUG MODE - Enable verbose logging to catch mobile IndexedDB errors
// ============================================================================
Dexie.debug = true;

// Global error handlers to catch unhandled IndexedDB errors on mobile
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    console.error('[CaspioDB] Unhandled rejection:', e.reason);
    // Show alert on mobile for debugging
    if (e.reason?.name === 'UnknownError' || e.reason?.message?.includes('IndexedDB')) {
      alert(`[DEXIE ERROR] Unhandled rejection:\n${e.reason?.message || e.reason}`);
    }
  });

  window.addEventListener('error', (e: ErrorEvent) => {
    console.error('[CaspioDB] Window error:', e.error || e.message);
    if (e.message?.includes('IndexedDB')) {
      alert(`[DEXIE ERROR] Window error:\n${e.message}`);
    }
  });

  console.log('[CaspioDB] Dexie debug mode ENABLED, global error handlers installed');
}

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

/**
 * EfeField - Normalized field-level storage for EFE (Elevation Field Equipment) rooms
 * Each room gets one row per service, with elevation points stored as JSON
 * Enables reactive updates for elevation-plot-hub and room-elevation pages
 */
export interface EfeField {
  id?: number;                    // Auto-increment primary key
  key: string;                    // Deterministic: ${serviceId}:${roomName}
  serviceId: string;
  roomName: string;
  templateId: number | string;    // Room template ID
  efeId: string | null;           // Real EFE ID after sync (null if pending)
  tempEfeId: string | null;       // Temp ID while pending sync
  isSelected: boolean;            // Room is selected/created
  organization: number;           // Sort order
  pointCount: number;             // Number of elevation points
  notes: string;                  // Room notes
  fdf: string;                    // FDF value
  location: string;               // Location value
  elevationPoints: EfePoint[];    // Elevation points with values/photos
  fdfPhotos: { [key: string]: EfeFdfPhoto }; // FDF photos (top, bottom, etc.)
  rev: number;                    // Increment on every local write
  updatedAt: number;              // Date.now() on update
  dirty: boolean;                 // true until backend sync acknowledges
}

/**
 * EfePoint - Individual elevation point within a room
 */
export interface EfePoint {
  pointNumber: number;
  pointId: string | null;         // Real point ID (PointID from Services_EFE_Points)
  tempPointId: string | null;     // Temp ID while pending sync
  name: string;                   // Point name from template
  value: string;                  // User-entered value
  photoCount: number;             // Number of photos attached
}

/**
 * EfeFdfPhoto - FDF photo metadata
 */
export interface EfeFdfPhoto {
  attachId: string | null;
  tempAttachId: string | null;
  hasPhoto: boolean;
  hasAnnotations: boolean;
}

/**
 * VisualField - Normalized field-level storage for visual items
 * Each template item gets one row per service
 * Enables reactive updates and eliminates loading screens
 */
export interface VisualField {
  id?: number;                    // Auto-increment primary key
  key: string;                    // Deterministic: ${serviceId}:${category}:${templateId}
  serviceId: string;
  category: string;
  templateId: number;
  templateName: string;           // Name from template for display
  templateText: string;           // Text/description from template
  kind: 'Comment' | 'Limitation' | 'Deficiency';
  answerType: number;             // 0=none, 1=text, 2=dropdown
  dropdownOptions?: string[];     // Parsed dropdown options if answerType=2
  isSelected: boolean;            // User selected this item
  answer: string;                 // User's answer/notes
  otherValue: string;             // "Other" field value
  visualId: string | null;        // Real visual ID after sync (null if pending)
  tempVisualId: string | null;    // Temp ID while pending sync
  photoCount: number;             // Number of photos attached
  rev: number;                    // Increment on every local write
  updatedAt: number;              // Date.now() on update
  dirty: boolean;                 // true until backend sync acknowledges
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
  visualFields!: Table<VisualField, number>;
  efeFields!: Table<EfeField, number>;

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

    // Version 8: Add visualFields table for Dexie-first reactive architecture
    // This table stores field-level visual data for instant page rendering
    this.version(8).stores({
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

      // Operations queue
      operationsQueue: 'id, type, status, createdAt, dedupeKey',

      // Visual fields (v8) - normalized field-level storage for reactive UI
      // Compound indexes enable fast queries by [serviceId+category] for page rendering
      visualFields: '++id, key, [serviceId+category], [serviceId+category+templateId], serviceId, dirty, updatedAt'
    });

    // Version 9: Add efeFields table for Dexie-first elevation plot architecture
    // This table stores room-level EFE data for instant page rendering
    this.version(9).stores({
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

      // Operations queue
      operationsQueue: 'id, type, status, createdAt, dedupeKey',

      // Visual fields - normalized field-level storage for reactive UI
      visualFields: '++id, key, [serviceId+category], [serviceId+category+templateId], serviceId, dirty, updatedAt',

      // EFE fields (v9) - normalized room-level storage for elevation plot
      // Compound indexes enable fast queries by serviceId for page rendering
      efeFields: '++id, key, serviceId, roomName, [serviceId+roomName], efeId, tempEfeId, dirty, updatedAt'
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
    const query = liveQuery(() => this.pendingRequests.toArray());
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
   * Live query for ALL sync modal data in a single query
   * This avoids combineLatest issues where separate liveQueries can return inconsistent data
   */
  liveSyncModalData$(): Observable<{
    requests: PendingRequest[];
    captions: PendingCaptionUpdate[];
    outboxItems: UploadOutboxItem[];
    failedImages: LocalImage[];
  }> {
    const query = liveQuery(async () => {
      const [requests, captions, outboxItems, failedImages] = await Promise.all([
        this.pendingRequests.toArray(),
        this.pendingCaptions.toArray(),
        this.uploadOutbox.toArray(),
        this.localImages.where('status').equals('failed').toArray()
      ]);
      return { requests, captions, outboxItems, failedImages };
    });
    return this.toRxObservable<{
      requests: PendingRequest[];
      captions: PendingCaptionUpdate[];
      outboxItems: UploadOutboxItem[];
      failedImages: LocalImage[];
    }>(query);
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

  // ============================================================================
  // VISUAL FIELDS - REACTIVE QUERIES FOR DEXIE-FIRST ARCHITECTURE
  // ============================================================================

  /**
   * Live query for visual fields by service and category
   * This is the primary query for rendering category detail pages
   * Auto-updates when ANY field in the category changes
   */
  liveVisualFields$(serviceId: string, category: string): Observable<VisualField[]> {
    const query = liveQuery(() =>
      this.visualFields
        .where('[serviceId+category]')
        .equals([serviceId, category])
        .toArray()
    );
    return this.toRxObservable<VisualField[]>(query);
  }

  /**
   * Live query for a single visual field by key
   */
  liveVisualField$(key: string): Observable<VisualField | undefined> {
    const query = liveQuery(() =>
      this.visualFields.where('key').equals(key).first()
    );
    return this.toRxObservable<VisualField | undefined>(query);
  }

  /**
   * Live query for dirty visual fields (pending sync)
   */
  liveDirtyVisualFields$(): Observable<VisualField[]> {
    const query = liveQuery(() =>
      this.visualFields.where('dirty').equals(1).toArray()
    );
    return this.toRxObservable<VisualField[]>(query);
  }

  /**
   * Live query for all visual fields for a service (all categories)
   */
  liveAllVisualFieldsForService$(serviceId: string): Observable<VisualField[]> {
    const query = liveQuery(() =>
      this.visualFields.where('serviceId').equals(serviceId).toArray()
    );
    return this.toRxObservable<VisualField[]>(query);
  }

  // ============================================================================
  // EFE FIELDS - REACTIVE QUERIES FOR DEXIE-FIRST ARCHITECTURE
  // ============================================================================

  /**
   * Live query for all EFE fields (rooms) for a service
   * This is the primary query for rendering elevation-plot-hub page
   * Auto-updates when ANY room in the service changes
   */
  liveEfeFields$(serviceId: string): Observable<EfeField[]> {
    const query = liveQuery(() =>
      this.efeFields.where('serviceId').equals(serviceId).toArray()
    );
    return this.toRxObservable<EfeField[]>(query);
  }

  /**
   * Live query for a single EFE field (room) by key
   * Key format: ${serviceId}:${roomName}
   */
  liveEfeField$(key: string): Observable<EfeField | undefined> {
    const query = liveQuery(() =>
      this.efeFields.where('key').equals(key).first()
    );
    return this.toRxObservable<EfeField | undefined>(query);
  }

  /**
   * Live query for a single EFE field by service and room name
   * NOTE: Using simple 'key' index instead of compound index [serviceId+roomName]
   * because compound index was causing IndexedDB internal errors on mobile WebView
   */
  liveEfeFieldByRoom$(serviceId: string, roomName: string): Observable<EfeField | undefined> {
    console.log(`[CaspioDB] liveEfeFieldByRoom$ called: serviceId=${serviceId}, roomName=${roomName}`);
    // Use the simple 'key' index (format: serviceId:roomName) instead of compound index
    // This matches the pattern used by liveVisualFields$ which works on mobile
    const key = `${serviceId}:${roomName}`;
    const query = liveQuery(() =>
      this.efeFields.where('key').equals(key).first()
    );
    return this.toRxObservable<EfeField | undefined>(query);
  }

  /**
   * Live query for dirty EFE fields (pending sync)
   */
  liveDirtyEfeFields$(): Observable<EfeField[]> {
    const query = liveQuery(() =>
      this.efeFields.where('dirty').equals(1).toArray()
    );
    return this.toRxObservable<EfeField[]>(query);
  }
}

// ============================================================================
// SINGLETON DATABASE INSTANCE
// ============================================================================

export const db = new CaspioDB();
