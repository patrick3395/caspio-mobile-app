import Dexie, { Table, liveQuery } from 'dexie';
import { Observable } from 'rxjs';
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

    // Log successful database open
    this.on('ready', () => {
      console.log('[CaspioDB] Database initialized successfully with Dexie');
    });
  }

  // ============================================================================
  // LIVE QUERY OBSERVABLES FOR REACTIVE UI BINDING
  // ============================================================================

  /**
   * Live query for local images by service and optional entity type
   * Auto-updates when data changes
   */
  liveLocalImages$(serviceId: string, entityType?: ImageEntityType): Observable<LocalImage[]> {
    return liveQuery(() => {
      if (entityType) {
        return this.localImages
          .where('[serviceId+entityType]')
          .equals([serviceId, entityType])
          .toArray();
      }
      return this.localImages.where('serviceId').equals(serviceId).toArray();
    }) as unknown as Observable<LocalImage[]>;
  }

  /**
   * Live query for local images by entity
   */
  liveLocalImagesByEntity$(entityType: ImageEntityType, entityId: string): Observable<LocalImage[]> {
    return liveQuery(() =>
      this.localImages
        .where('[entityType+entityId]')
        .equals([entityType, entityId])
        .toArray()
    ) as unknown as Observable<LocalImage[]>;
  }

  /**
   * Live query for pending requests
   */
  livePendingRequests$(): Observable<PendingRequest[]> {
    return liveQuery(() =>
      this.pendingRequests.where('status').equals('pending').toArray()
    ) as unknown as Observable<PendingRequest[]>;
  }

  /**
   * Live query for all pending requests (any status)
   */
  liveAllPendingRequests$(): Observable<PendingRequest[]> {
    return liveQuery(() =>
      this.pendingRequests.toArray()
    ) as unknown as Observable<PendingRequest[]>;
  }

  /**
   * Live query for upload outbox items
   */
  liveUploadOutbox$(): Observable<UploadOutboxItem[]> {
    return liveQuery(() => this.uploadOutbox.toArray()) as unknown as Observable<UploadOutboxItem[]>;
  }

  /**
   * Live query for pending captions
   */
  livePendingCaptions$(): Observable<PendingCaptionUpdate[]> {
    return liveQuery(() =>
      this.pendingCaptions
        .where('status')
        .anyOf(['pending', 'syncing'])
        .toArray()
    ) as unknown as Observable<PendingCaptionUpdate[]>;
  }

  /**
   * Live query for all pending captions (any status)
   */
  liveAllPendingCaptions$(): Observable<PendingCaptionUpdate[]> {
    return liveQuery(() =>
      this.pendingCaptions.toArray()
    ) as unknown as Observable<PendingCaptionUpdate[]>;
  }

  /**
   * Live query for pending images (legacy system)
   */
  livePendingImages$(): Observable<PendingImage[]> {
    return liveQuery(() =>
      this.pendingImages
        .filter(img => img.status === 'pending' || img.status === 'uploading')
        .toArray()
    ) as unknown as Observable<PendingImage[]>;
  }

  /**
   * Live query for pending EFE data by service
   */
  livePendingEFEData$(serviceId: string): Observable<PendingEFEData[]> {
    return liveQuery(() =>
      this.pendingEFEData.where('serviceId').equals(serviceId).toArray()
    ) as unknown as Observable<PendingEFEData[]>;
  }

  /**
   * Live query for sync stats (combined counts)
   */
  liveSyncStats$(): Observable<{ pending: number; uploading: number; total: number }> {
    return liveQuery(async () => {
      const [pendingRequests, uploadOutbox, pendingCaptions] = await Promise.all([
        this.pendingRequests.where('status').equals('pending').count(),
        this.uploadOutbox.count(),
        this.pendingCaptions.where('status').anyOf(['pending', 'syncing']).count()
      ]);

      return {
        pending: pendingRequests + pendingCaptions,
        uploading: uploadOutbox,
        total: pendingRequests + uploadOutbox + pendingCaptions
      };
    }) as unknown as Observable<{ pending: number; uploading: number; total: number }>;
  }

  /**
   * Live query for cached service data by service ID and data type
   */
  liveCachedServiceData$(serviceId: string, dataType: string): Observable<any[] | null> {
    return liveQuery(async () => {
      const cached = await this.cachedServiceData.get(`${dataType}_${serviceId}`);
      return cached?.data || null;
    }) as unknown as Observable<any[] | null>;
  }
}

// ============================================================================
// SINGLETON DATABASE INSTANCE
// ============================================================================

export const db = new CaspioDB();
