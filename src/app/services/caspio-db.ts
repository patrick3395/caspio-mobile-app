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

// Global error handlers to catch unhandled IndexedDB errors
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    console.error('[CaspioDB] Unhandled rejection:', e.reason);
  });

  window.addEventListener('error', (e: ErrorEvent) => {
    console.error('[CaspioDB] Window error:', e.error || e.message);
  });
}

// ============================================================================
// ADDITIONAL INTERFACES FOR CASPIO DB
// ============================================================================

export interface CachedPhoto {
  photoKey: string;
  attachId: string;
  serviceId: string;
  // STORAGE OPTIMIZATION: imageData is now optional
  // New entries use blobKey pointer instead of storing full base64
  imageData?: string;           // Legacy: full base64 data (~930KB)
  blobKey?: string;             // New: pointer to localBlobs.blobId (~50 bytes)
  variant?: 'original' | 'annotated';  // Which version this points to
  s3Key?: string;
  cachedAt: number;
  isAnnotated?: boolean;
}

/**
 * ServiceMetadata - Service-level tracking for storage bloat prevention
 * Tracks activity, sync state, and purge eligibility per inspection service
 * Used by two-stage purge system to safely clean up inactive service data
 */
export type PurgeState = 'ACTIVE' | 'ARCHIVED' | 'PURGED';

export interface ServiceMetadata {
  serviceId: string;              // Primary key - the inspection service ID
  templateVersion: number;        // Version of templates used for seeding
  isOpen: boolean;                // Currently being viewed/edited by user
  lastTouchedAt: number;          // Epoch ms when user last interacted
  lastLocalRevision: number;      // Monotonic counter incremented on local changes
  lastServerAckRevision: number;  // Last revision server confirmed synced
  purgeState: PurgeState;         // Current purge state
  estimatedLocalBytes?: number;   // Approximate storage used (for debugging)
  createdAt: number;              // When service was first accessed
  updatedAt: number;              // Last metadata update
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
  caption?: string;
  imageId?: string;
  localBlobId?: string;
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

/**
 * HudField - Normalized field-level storage for HUD (Heating/Utilities/etc.) items
 * Each template item gets one row per service/category
 * Follows VisualField pattern for Dexie-first architecture
 * MOBILE ONLY: Dexie-first is only enabled on Capacitor.isNativePlatform()
 */
export interface HudField {
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
  hudId: string | null;           // Real HUD ID after sync (null if pending)
  tempHudId: string | null;       // Temp ID while pending sync
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
  hudFields!: Table<HudField, number>;
  serviceMetadata!: Table<ServiceMetadata, string>;

  // MOBILE FIX: Cache last known good results for liveQueries
  // When IndexedDB has temporary connection issues during photo transactions,
  // return cached data instead of empty arrays to prevent UI from clearing/hanging
  private _lastSyncModalData: {
    requests: PendingRequest[];
    captions: PendingCaptionUpdate[];
    outboxItems: UploadOutboxItem[];
    failedImages: LocalImage[];
  } | null = null;

  // Cache for EFE fields by service ID
  private _lastEfeFieldsCache: Map<string, EfeField[]> = new Map();

  // Cache for single EFE fields by key (serviceId:roomName)
  private _lastEfeFieldCache: Map<string, EfeField | undefined> = new Map();

  // Cache for HUD fields by service ID + category
  private _lastHudFieldsCache: Map<string, HudField[]> = new Map();

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

    // Version 10: Add serviceMetadata table for storage bloat prevention
    // Tracks service activity, sync state, and purge eligibility
    // Also adds thumbBlobId to existing localImages for thumbnail fallback after soft purge
    this.version(10).stores({
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

      // EFE fields - normalized room-level storage for elevation plot
      efeFields: '++id, key, serviceId, roomName, [serviceId+roomName], efeId, tempEfeId, dirty, updatedAt',

      // Service metadata (v10) - tracks service activity for storage bloat prevention
      // Compound index [purgeState+lastTouchedAt] enables efficient queries for inactive services
      serviceMetadata: 'serviceId, lastTouchedAt, purgeState, [purgeState+lastTouchedAt]'
    }).upgrade(tx => {
      // Migrate existing localImages to have thumbBlobId: null
      // This ensures the field exists for all images, new ones will get thumbnails on capture
      console.log('[CaspioDB] v10 migration: Adding thumbBlobId to existing localImages');
      return tx.table('localImages').toCollection().modify(img => {
        if (img.thumbBlobId === undefined) {
          img.thumbBlobId = null;
        }
      });
    });

    // Version 11: Add hudFields table for HUD Dexie-first architecture (MOBILE ONLY)
    // This table stores field-level HUD data for instant page rendering on mobile
    this.version(11).stores({
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

      // EFE fields - normalized room-level storage for elevation plot
      efeFields: '++id, key, serviceId, roomName, [serviceId+roomName], efeId, tempEfeId, dirty, updatedAt',

      // Service metadata - tracks service activity for storage bloat prevention
      serviceMetadata: 'serviceId, lastTouchedAt, purgeState, [purgeState+lastTouchedAt]',

      // HUD fields (v11) - normalized field-level storage for HUD reactive UI (MOBILE ONLY)
      // Compound indexes enable fast queries by [serviceId+category] for page rendering
      hudFields: '++id, key, [serviceId+category], [serviceId+category+templateId], serviceId, dirty, updatedAt'
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
   *
   * MOBILE FIX: Caches last known good result and returns it on error
   * This prevents the UI from clearing when IndexedDB has temporary connection issues
   * during photo upload transactions (common on mobile WebView)
   */
  liveSyncModalData$(): Observable<{
    requests: PendingRequest[];
    captions: PendingCaptionUpdate[];
    outboxItems: UploadOutboxItem[];
    failedImages: LocalImage[];
  }> {
    const query = liveQuery(async () => {
      try {
        // MOBILE FIX: Check if database connection is open, reopen if needed
        if (!this.isOpen()) {
          console.log('[LIVEQUERY] Database not open, reopening...');
          await this.open();
        }

        const [requests, captions, outboxItems, failedImages] = await Promise.all([
          this.pendingRequests.toArray(),
          this.pendingCaptions.toArray(),
          this.uploadOutbox.toArray(),
          this.localImages.where('status').equals('failed').toArray()
        ]);

        // DEBUG: Log what we got from the database
        console.log(`[LIVEQUERY] liveSyncModalData: requests=${requests.length}, outbox=${outboxItems.length}`);

        // DEBUG: If outbox has items, log their imageIds for debugging
        if (outboxItems.length > 0) {
          console.log('[LIVEQUERY] Outbox imageIds:', outboxItems.map(i => i.imageId));
        }

        // Cache the successful result
        const result = { requests, captions, outboxItems, failedImages };
        this._lastSyncModalData = result;

        return result;
      } catch (err: any) {
        console.error('[LIVEQUERY ERROR]', err?.message || err);

        // MOBILE FIX: On connection lost, try to reopen database
        if (err?.message?.includes('Connection') || err?.name === 'UnknownError') {
          console.log('[LIVEQUERY] Connection lost, attempting to reopen database...');
          try {
            await this.close();
            await this.open();
            // Retry the query after reopening
            const [requests, captions, outboxItems, failedImages] = await Promise.all([
              this.pendingRequests.toArray(),
              this.pendingCaptions.toArray(),
              this.uploadOutbox.toArray(),
              this.localImages.where('status').equals('failed').toArray()
            ]);
            console.log('[LIVEQUERY] Reconnected successfully');
            const result = { requests, captions, outboxItems, failedImages };
            this._lastSyncModalData = result;
            return result;
          } catch (retryErr) {
            console.error('[LIVEQUERY] Retry failed:', retryErr);
          }
        }

        // CRITICAL FIX: Return cached data instead of empty arrays on error
        // This prevents the sync modal from clearing when IndexedDB has temporary issues
        // during photo upload transactions (common issue on mobile WebView)
        if (this._lastSyncModalData) {
          console.log('[LIVEQUERY] Returning cached data to prevent UI clear');
          return this._lastSyncModalData;
        }

        // Only return empty data if we have no cached data (first run)
        return { requests: [], captions: [], outboxItems: [], failedImages: [] };
      }
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
   *
   * MOBILE FIX: Caches last known good result and returns it on error
   * This prevents the hub from hanging when IndexedDB has temporary connection issues
   * during photo upload transactions (common on mobile WebView)
   */
  liveEfeFields$(serviceId: string): Observable<EfeField[]> {
    const query = liveQuery(async () => {
      try {
        // MOBILE FIX: Check if database connection is open, reopen if needed
        if (!this.isOpen()) {
          console.log('[LIVEQUERY] liveEfeFields$ - Database not open, reopening...');
          await this.open();
        }

        const fields = await this.efeFields.where('serviceId').equals(serviceId).toArray();
        console.log(`[LIVEQUERY] liveEfeFields$: serviceId=${serviceId}, fields=${fields.length}`);

        // Cache the successful result
        this._lastEfeFieldsCache.set(serviceId, fields);

        return fields;
      } catch (err: any) {
        console.error('[LIVEQUERY ERROR] liveEfeFields$:', err?.message || err);

        // MOBILE FIX: On connection lost, try to reopen database
        if (err?.message?.includes('Connection') || err?.name === 'UnknownError') {
          console.log('[LIVEQUERY] liveEfeFields$ - Connection lost, attempting to reopen database...');
          try {
            await this.close();
            await this.open();
            // Retry the query after reopening
            const fields = await this.efeFields.where('serviceId').equals(serviceId).toArray();
            console.log('[LIVEQUERY] liveEfeFields$ - Reconnected successfully');
            this._lastEfeFieldsCache.set(serviceId, fields);
            return fields;
          } catch (retryErr) {
            console.error('[LIVEQUERY] liveEfeFields$ - Retry failed:', retryErr);
          }
        }

        // CRITICAL FIX: Return cached data instead of empty array on error
        // This prevents the hub from hanging when IndexedDB has temporary issues
        const cached = this._lastEfeFieldsCache.get(serviceId);
        if (cached) {
          console.log('[LIVEQUERY] liveEfeFields$ - Returning cached data to prevent hang');
          return cached;
        }

        // Only return empty array if we have no cached data (first run)
        return [];
      }
    });
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
   *
   * MOBILE FIX: Caches last known good result and returns it on error
   * This prevents room-elevation from hanging when IndexedDB has temporary connection issues
   */
  liveEfeFieldByRoom$(serviceId: string, roomName: string): Observable<EfeField | undefined> {
    console.log(`[CaspioDB] liveEfeFieldByRoom$ called: serviceId=${serviceId}, roomName=${roomName}`);
    // Use the simple 'key' index (format: serviceId:roomName) instead of compound index
    // This matches the pattern used by liveVisualFields$ which works on mobile
    const key = `${serviceId}:${roomName}`;

    const query = liveQuery(async () => {
      try {
        // MOBILE FIX: Check if database connection is open
        if (!this.isOpen()) {
          console.log('[LIVEQUERY] liveEfeFieldByRoom$ - Database not open, reopening...');
          await this.open();
        }

        const field = await this.efeFields.where('key').equals(key).first();

        // Cache the successful result
        this._lastEfeFieldCache.set(key, field);

        return field;
      } catch (err: any) {
        console.error('[LIVEQUERY ERROR] liveEfeFieldByRoom$:', err?.message || err);

        // MOBILE FIX: On connection lost, try to reopen database
        if (err?.message?.includes('Connection') || err?.name === 'UnknownError') {
          console.log('[LIVEQUERY] liveEfeFieldByRoom$ - Connection lost, attempting to reopen database...');
          try {
            await this.close();
            await this.open();
            const field = await this.efeFields.where('key').equals(key).first();
            console.log('[LIVEQUERY] liveEfeFieldByRoom$ - Reconnected successfully');
            this._lastEfeFieldCache.set(key, field);
            return field;
          } catch (retryErr) {
            console.error('[LIVEQUERY] liveEfeFieldByRoom$ - Retry failed:', retryErr);
          }
        }

        // CRITICAL FIX: Return cached data instead of undefined on error
        const cached = this._lastEfeFieldCache.get(key);
        if (cached !== undefined) {
          console.log('[LIVEQUERY] liveEfeFieldByRoom$ - Returning cached data to prevent hang');
          return cached;
        }

        return undefined;
      }
    });
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

  // ============================================================================
  // HUD FIELDS - REACTIVE QUERIES FOR DEXIE-FIRST ARCHITECTURE (MOBILE ONLY)
  // ============================================================================

  /**
   * Live query for HUD fields by service and category
   * This is the primary query for rendering HUD category detail pages on mobile
   * Auto-updates when ANY field in the category changes
   *
   * MOBILE FIX: Caches last known good result and returns it on error
   * This prevents the page from hanging when IndexedDB has temporary connection issues
   * during photo upload transactions (common on mobile WebView)
   */
  liveHudFields$(serviceId: string, category: string): Observable<HudField[]> {
    const cacheKey = `${serviceId}:${category}`;
    const query = liveQuery(async () => {
      try {
        // MOBILE FIX: Check if database connection is open, reopen if needed
        if (!this.isOpen()) {
          console.log('[LIVEQUERY] liveHudFields$ - Database not open, reopening...');
          await this.open();
        }

        const fields = await this.hudFields
          .where('[serviceId+category]')
          .equals([serviceId, category])
          .toArray();
        console.log(`[LIVEQUERY] liveHudFields$: serviceId=${serviceId}, category=${category}, fields=${fields.length}`);

        // Cache the successful result
        this._lastHudFieldsCache.set(cacheKey, fields);

        return fields;
      } catch (err: any) {
        console.error('[LIVEQUERY ERROR] liveHudFields$:', err?.message || err);

        // MOBILE FIX: On connection lost, try to reopen database
        if (err?.message?.includes('Connection') || err?.name === 'UnknownError') {
          console.log('[LIVEQUERY] liveHudFields$ - Connection lost, attempting to reopen database...');
          try {
            await this.close();
            await this.open();
            // Retry the query after reopening
            const fields = await this.hudFields
              .where('[serviceId+category]')
              .equals([serviceId, category])
              .toArray();
            console.log('[LIVEQUERY] liveHudFields$ - Reconnected successfully');
            this._lastHudFieldsCache.set(cacheKey, fields);
            return fields;
          } catch (retryErr) {
            console.error('[LIVEQUERY] liveHudFields$ - Retry failed:', retryErr);
          }
        }

        // CRITICAL FIX: Return cached data instead of empty array on error
        // This prevents the page from hanging when IndexedDB has temporary issues
        const cached = this._lastHudFieldsCache.get(cacheKey);
        if (cached) {
          console.log('[LIVEQUERY] liveHudFields$ - Returning cached data to prevent hang');
          return cached;
        }

        // Only return empty array if we have no cached data (first run)
        return [];
      }
    });
    return this.toRxObservable<HudField[]>(query);
  }

  /**
   * Live query for a single HUD field by key
   */
  liveHudField$(key: string): Observable<HudField | undefined> {
    const query = liveQuery(() =>
      this.hudFields.where('key').equals(key).first()
    );
    return this.toRxObservable<HudField | undefined>(query);
  }

  /**
   * Live query for dirty HUD fields (pending sync)
   */
  liveDirtyHudFields$(): Observable<HudField[]> {
    const query = liveQuery(() =>
      this.hudFields.where('dirty').equals(1).toArray()
    );
    return this.toRxObservable<HudField[]>(query);
  }

  /**
   * Live query for all HUD fields for a service (all categories)
   */
  liveAllHudFieldsForService$(serviceId: string): Observable<HudField[]> {
    const query = liveQuery(() =>
      this.hudFields.where('serviceId').equals(serviceId).toArray()
    );
    return this.toRxObservable<HudField[]>(query);
  }

  // ============================================================================
  // STORAGE DEBUG - Track where storage is expanding
  // ============================================================================

  /**
   * Get detailed storage breakdown by table
   * Shows size in bytes and MB for each table storing binary/large data
   */
  async getStorageBreakdown(): Promise<{
    localBlobs: { count: number; totalBytes: number; totalMB: string };
    cachedPhotos: { count: number; totalBytes: number; totalMB: string; annotatedCount: number; regularCount: number };
    localImages: { count: number };
    uploadOutbox: { count: number };
    pendingImages: { count: number; totalBytes: number; totalMB: string };
    total: { totalBytes: number; totalMB: string };
  }> {
    console.log('[StorageDebug] ========== STORAGE BREAKDOWN ==========');

    // localBlobs - binary image data
    const blobs = await this.localBlobs.toArray();
    const blobsTotal = blobs.reduce((sum, b) => sum + (b.sizeBytes || 0), 0);
    console.log(`[StorageDebug] localBlobs: ${blobs.length} items, ${(blobsTotal / 1024 / 1024).toFixed(2)} MB`);
    for (const blob of blobs.slice(0, 5)) {
      console.log(`  - ${blob.blobId}: ${(blob.sizeBytes / 1024).toFixed(1)} KB`);
    }
    if (blobs.length > 5) console.log(`  ... and ${blobs.length - 5} more`);

    // cachedPhotos - base64 images (regular + annotated)
    const photos = await this.cachedPhotos.toArray();
    let photosTotal = 0;
    let annotatedCount = 0;
    let regularCount = 0;
    for (const photo of photos) {
      const size = photo.imageData?.length || 0;
      photosTotal += size;
      if (photo.isAnnotated || photo.photoKey.startsWith('annotated_')) {
        annotatedCount++;
      } else {
        regularCount++;
      }
    }
    console.log(`[StorageDebug] cachedPhotos: ${photos.length} items, ${(photosTotal / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  - Annotated: ${annotatedCount}, Regular: ${regularCount}`);
    for (const photo of photos.slice(0, 5)) {
      const size = photo.imageData?.length || 0;
      console.log(`  - ${photo.photoKey}: ${(size / 1024).toFixed(1)} KB ${photo.isAnnotated ? '(ANNOTATED)' : ''}`);
    }
    if (photos.length > 5) console.log(`  ... and ${photos.length - 5} more`);

    // localImages - metadata only
    const images = await this.localImages.toArray();
    console.log(`[StorageDebug] localImages: ${images.length} metadata records`);

    // uploadOutbox
    const outbox = await this.uploadOutbox.toArray();
    console.log(`[StorageDebug] uploadOutbox: ${outbox.length} pending uploads`);

    // pendingImages - legacy binary storage
    const pendingImages = await this.pendingImages.toArray();
    let pendingTotal = 0;
    for (const img of pendingImages) {
      pendingTotal += img.fileSize || 0;
    }
    console.log(`[StorageDebug] pendingImages: ${pendingImages.length} items, ${(pendingTotal / 1024 / 1024).toFixed(2)} MB`);

    const grandTotal = blobsTotal + photosTotal + pendingTotal;
    console.log(`[StorageDebug] ========== TOTAL: ${(grandTotal / 1024 / 1024).toFixed(2)} MB ==========`);

    return {
      localBlobs: { count: blobs.length, totalBytes: blobsTotal, totalMB: (blobsTotal / 1024 / 1024).toFixed(2) },
      cachedPhotos: { count: photos.length, totalBytes: photosTotal, totalMB: (photosTotal / 1024 / 1024).toFixed(2), annotatedCount, regularCount },
      localImages: { count: images.length },
      uploadOutbox: { count: outbox.length },
      pendingImages: { count: pendingImages.length, totalBytes: pendingTotal, totalMB: (pendingTotal / 1024 / 1024).toFixed(2) },
      total: { totalBytes: grandTotal, totalMB: (grandTotal / 1024 / 1024).toFixed(2) }
    };
  }

  /**
   * Log storage delta - call before and after an operation to see change
   */
  async logStorageDelta(label: string, beforeSnapshot?: any): Promise<any> {
    const current = await this.getStorageBreakdown();

    if (beforeSnapshot) {
      const deltaBlobs = current.localBlobs.totalBytes - beforeSnapshot.localBlobs.totalBytes;
      const deltaPhotos = current.cachedPhotos.totalBytes - beforeSnapshot.cachedPhotos.totalBytes;
      const deltaTotal = current.total.totalBytes - beforeSnapshot.total.totalBytes;

      console.log(`[StorageDebug] DELTA after "${label}":`);
      console.log(`  localBlobs: ${deltaBlobs >= 0 ? '+' : ''}${(deltaBlobs / 1024).toFixed(1)} KB`);
      console.log(`  cachedPhotos: ${deltaPhotos >= 0 ? '+' : ''}${(deltaPhotos / 1024).toFixed(1)} KB`);
      console.log(`  TOTAL: ${deltaTotal >= 0 ? '+' : ''}${(deltaTotal / 1024).toFixed(1)} KB (${(deltaTotal / 1024 / 1024).toFixed(2)} MB)`);
    }

    return current;
  }
}

// ============================================================================
// SINGLETON DATABASE INSTANCE
// ============================================================================

export const db = new CaspioDB();
