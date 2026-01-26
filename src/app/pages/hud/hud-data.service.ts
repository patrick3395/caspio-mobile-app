import { Injectable } from '@angular/core';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { CaspioService } from '../../services/caspio.service';
import { IndexedDbService, LocalImage } from '../../services/indexed-db.service';
import { TempIdService } from '../../services/temp-id.service';
import { BackgroundSyncService } from '../../services/background-sync.service';
import { OfflineDataCacheService } from '../../services/offline-data-cache.service';
import { OfflineTemplateService } from '../../services/offline-template.service';
import { OfflineService } from '../../services/offline.service';
import { LocalImageService } from '../../services/local-image.service';
import { ServiceMetadataService } from '../../services/service-metadata.service';
import { EfeFieldRepoService } from '../../services/efe-field-repo.service';
import { VisualFieldRepoService } from '../../services/visual-field-repo.service';
import { db } from '../../services/caspio-db';
import { environment } from '../../../environments/environment';

interface CacheEntry<T> {
  value: Promise<T>;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class HudDataService {
  private readonly cacheTtlMs = 5 * 60 * 1000;

  private projectCache = new Map<string, CacheEntry<any>>();
  private serviceCache = new Map<string, CacheEntry<any>>();
  private typeCache = new Map<string, CacheEntry<any>>();
  private imageCache = new Map<string, CacheEntry<string>>();
  private efeTemplatesCache: CacheEntry<any[]> | null = null;
  private visualsCache = new Map<string, CacheEntry<any[]>>();
  private visualAttachmentsCache = new Map<string, CacheEntry<any[]>>();
  private efePointsCache = new Map<string, CacheEntry<any[]>>();
  private efeAttachmentsCache = new Map<string, CacheEntry<any[]>>();

  // Event emitted when caches are invalidated - pages should reload their data
  public cacheInvalidated$ = new Subject<{ serviceId?: string; reason: string }>();
  
  private syncSubscriptions: Subscription[] = [];
  
  // Debounce timer for cache invalidation to batch multiple sync events into one UI refresh
  private cacheInvalidationTimer: any = null;
  private pendingInvalidationServiceId: string | undefined = undefined;

  constructor(
    private readonly caspioService: CaspioService,
    private readonly indexedDb: IndexedDbService,
    private readonly tempId: TempIdService,
    private readonly backgroundSync: BackgroundSyncService,
    private readonly offlineCache: OfflineDataCacheService,
    private readonly offlineTemplate: OfflineTemplateService,
    private readonly offlineService: OfflineService,
    private readonly localImageService: LocalImageService,
    private readonly serviceMetadata: ServiceMetadataService,
    private readonly efeFieldRepo: EfeFieldRepoService,
    private readonly visualFieldRepo: VisualFieldRepoService
  ) {
    this.subscribeToSyncEvents();
  }

  /**
   * Subscribe to BackgroundSyncService events and auto-invalidate caches
   * This ensures in-memory caches are cleared when IndexedDB is updated
   */
  private subscribeToSyncEvents(): void {
    // When a visual syncs, clear visual caches
    this.syncSubscriptions.push(
      this.backgroundSync.visualSyncComplete$.subscribe(event => {
        console.log('[DataService] Visual synced, invalidating caches for service:', event.serviceId);
        this.invalidateCachesForService(event.serviceId, 'visual_sync');
      })
    );

    // When a photo syncs, clear attachment caches
    // CRITICAL FIX: Do NOT emit cacheInvalidated$ here - it causes a race condition
    // The page's direct photoUploadComplete$ subscription handles the UI update
    // Emitting cacheInvalidated$ triggers reloadVisualsAfterSync() BEFORE the page
    // has updated the photo's AttachID from temp to real, causing duplicate photos
    // or loss of local updates like captions
    this.syncSubscriptions.push(
      this.backgroundSync.photoUploadComplete$.subscribe(event => {
        console.log('[DataService] Photo synced, clearing in-memory caches only (no reload trigger)');
        this.visualAttachmentsCache.clear();
        this.efeAttachmentsCache.clear();
        this.imageCache.clear();
        // DO NOT call: this.cacheInvalidated$.next({ reason: 'photo_sync' });
        // The page handles photoUploadComplete$ directly for seamless UI updates
      })
    );

    // When service data syncs, clear service/project caches
    this.syncSubscriptions.push(
      this.backgroundSync.serviceDataSyncComplete$.subscribe(event => {
        console.log('[DataService] Service data synced, invalidating caches');
        if (event.serviceId) {
          this.serviceCache.delete(event.serviceId);
        }
        if (event.projectId) {
          this.projectCache.delete(event.projectId);
        }
        this.debouncedCacheInvalidation(event.serviceId, 'service_data_sync');
      })
    );

    // When EFE room syncs, clear EFE caches
    this.syncSubscriptions.push(
      this.backgroundSync.efeRoomSyncComplete$.subscribe(event => {
        console.log('[DataService] EFE room synced, invalidating EFE caches');
        this.efePointsCache.clear();
        this.efeAttachmentsCache.clear();
        this.debouncedCacheInvalidation(undefined, 'efe_room_sync');
      })
    );

    // When EFE point syncs, clear point caches
    this.syncSubscriptions.push(
      this.backgroundSync.efePointSyncComplete$.subscribe(event => {
        console.log('[DataService] EFE point synced, invalidating point caches');
        this.efePointsCache.clear();
        this.efeAttachmentsCache.clear();
        this.debouncedCacheInvalidation(undefined, 'efe_point_sync');
      })
    );

    // CRITICAL: When background refresh completes, clear in-memory caches and notify pages
    // This ensures that stale in-memory data doesn't override fresh IndexedDB data
    this.syncSubscriptions.push(
      this.offlineTemplate.backgroundRefreshComplete$.subscribe(event => {
        console.log('[DataService] Background refresh complete:', event.dataType, 'for', event.serviceId);
        
        // Clear the corresponding in-memory cache
        switch (event.dataType) {
          case 'visuals':
            this.visualsCache.delete(event.serviceId);
            console.log('[DataService] Cleared visualsCache for', event.serviceId);
            break;
          case 'visual_attachments':
            this.visualAttachmentsCache.delete(event.serviceId);
            console.log('[DataService] Cleared visualAttachmentsCache for', event.serviceId);
            break;
          case 'efe_rooms':
            // No specific room cache - just notify
            break;
          case 'efe_points':
            this.efePointsCache.delete(event.serviceId);
            console.log('[DataService] Cleared efePointsCache for', event.serviceId);
            break;
          case 'efe_point_attachments':
            this.efeAttachmentsCache.delete(event.serviceId);
            console.log('[DataService] Cleared efeAttachmentsCache for', event.serviceId);
            break;
        }
        
        // Emit cache invalidated event so pages reload with fresh data (debounced)
        this.debouncedCacheInvalidation(event.serviceId, `background_refresh_${event.dataType}`);
      })
    );
    
    // REACTIVE SUBSCRIPTION: Subscribe to IndexedDB image changes (Requirement E)
    // This provides real-time UI updates when images are created/updated in IndexedDB
    this.syncSubscriptions.push(
      this.indexedDb.imageChange$.subscribe(event => {
        console.log('[DataService] IndexedDB image change:', event.action, event.key, 'entity:', event.entityType, event.entityId);
        
        // Clear attachment caches for the affected entity type
        if (event.entityType === 'visual') {
          this.visualAttachmentsCache.clear();
        } else if (event.entityType === 'efe_point') {
          this.efeAttachmentsCache.clear();
        }
        
        // Emit cache invalidated event so pages reload with fresh data
        // Use debounced version to batch rapid changes (e.g., multiple photo captures)
        this.debouncedCacheInvalidation(event.serviceId, `indexeddb_${event.action}_${event.entityType}`);
      })
    );
  }

  /**
   * Debounced cache invalidation to batch multiple sync events into one UI refresh
   * This prevents rapid UI flickering when multiple items sync in quick succession
   */
  private debouncedCacheInvalidation(serviceId?: string, reason: string = 'batch_sync'): void {
    // Track the service ID (use most recent if multiple)
    if (serviceId) {
      this.pendingInvalidationServiceId = serviceId;
    }

    // Clear any existing timer
    if (this.cacheInvalidationTimer) {
      clearTimeout(this.cacheInvalidationTimer);
    }

    // Set a new timer - emit after 1 second of no new sync events
    this.cacheInvalidationTimer = setTimeout(() => {
      console.log(`[DataService] Debounced cache invalidation fired (reason: ${reason})`);
      this.cacheInvalidated$.next({ 
        serviceId: this.pendingInvalidationServiceId, 
        reason: reason 
      });
      this.cacheInvalidationTimer = null;
      this.pendingInvalidationServiceId = undefined;
    }, 1000); // 1 second debounce
  }

  /**
   * Invalidate all caches for a specific service
   * Called after sync to ensure fresh data is loaded from IndexedDB
   */
  invalidateCachesForService(serviceId: string, reason: string = 'manual'): void {
    console.log(`[DataService] Invalidating all caches for service ${serviceId} (reason: ${reason})`);
    
    // Clear service-specific caches
    this.visualsCache.delete(serviceId);
    this.serviceCache.delete(serviceId);
    
    // Clear all attachment caches (we don't track by service)
    this.visualAttachmentsCache.clear();
    this.efePointsCache.clear();
    this.efeAttachmentsCache.clear();
    this.imageCache.clear();
    
    // Use debounced invalidation to batch rapid sync events
    this.debouncedCacheInvalidation(serviceId, reason);
  }

  /**
   * STANDARDIZED: Verify that all required data is cached in IndexedDB
   * Use this to check cache health before rendering UI
   * 
   * @param serviceId - The service ID to verify
   * @returns Object with cache status for each data type
   */
  async verifyCacheHealth(serviceId: string): Promise<{
    visualTemplates: boolean;
    efeTemplates: boolean;
    serviceRecord: boolean;
    visuals: boolean;
    efeRooms: boolean;
    isComplete: boolean;
  }> {
    const status = {
      visualTemplates: false,
      efeTemplates: false,
      serviceRecord: false,
      visuals: false,
      efeRooms: false,
      isComplete: false
    };

    try {
      // Check visual templates
      const visualTemplates = await this.indexedDb.getCachedTemplates('visual');
      status.visualTemplates = !!(visualTemplates && visualTemplates.length > 0);

      // Check EFE templates
      const efeTemplates = await this.indexedDb.getCachedTemplates('efe');
      status.efeTemplates = !!(efeTemplates && efeTemplates.length > 0);

      // Check service record
      const serviceRecord = await this.indexedDb.getCachedServiceRecord(serviceId);
      status.serviceRecord = !!serviceRecord;

      // Check visuals (can be empty for new services)
      const visuals = await this.indexedDb.getCachedServiceData(serviceId, 'visuals');
      status.visuals = visuals !== null && visuals !== undefined;

      // Check EFE rooms (can be empty for new services)
      const efeRooms = await this.indexedDb.getCachedServiceData(serviceId, 'efe_rooms');
      status.efeRooms = efeRooms !== null && efeRooms !== undefined;

      // Complete if all critical data is present
      status.isComplete = status.visualTemplates && status.efeTemplates && status.serviceRecord;

      console.log('[DataService] Cache health check:', status);
      return status;
    } catch (error) {
      console.error('[DataService] Error checking cache health:', error);
      return status;
    }
  }

  /**
   * STANDARDIZED: Ensure specific data type is cached
   * If not in cache and online, fetches from API and caches
   * 
   * @param serviceId - The service ID
   * @param dataType - The type of data to ensure
   * @param fetcher - Optional function to fetch data if not cached
   */
  async ensureDataCached(
    serviceId: string,
    dataType: 'visuals' | 'efe_rooms' | 'efe_points',
    fetcher?: () => Promise<any[]>
  ): Promise<boolean> {
    const cached = await this.indexedDb.getCachedServiceData(serviceId, dataType);
    
    if (cached && cached.length > 0) {
      console.log(`[DataService] ✅ ${dataType} already cached: ${cached.length} items`);
      return true;
    }

    // Not cached - try to fetch if online and fetcher provided
    if (this.offlineService.isOnline() && fetcher) {
      try {
        console.log(`[DataService] Fetching ${dataType} from API...`);
        const freshData = await fetcher();
        await this.indexedDb.cacheServiceData(serviceId, dataType, freshData || []);
        console.log(`[DataService] ✅ ${dataType} fetched and cached: ${freshData?.length || 0} items`);
        return freshData && freshData.length > 0;
      } catch (error) {
        console.error(`[DataService] Failed to fetch ${dataType}:`, error);
        return false;
      }
    }

    return false;
  }

  async getProject(projectId: string | null | undefined): Promise<any> {
    if (!projectId) {
      return null;
    }
    return this.resolveWithCache(this.projectCache, projectId, () =>
      firstValueFrom(this.caspioService.getProject(projectId))
    );
  }

  async getService(serviceId: string | null | undefined): Promise<any> {
    if (!serviceId) {
      return null;
    }

    // OFFLINE-FIRST: Try IndexedDB first
    const cachedService = await this.offlineTemplate.getService(serviceId);
    if (cachedService) {
      console.log('[Service Data] Loaded service from IndexedDB cache');
      return cachedService;
    }

    // Fallback to API (and cache the result)
    return this.resolveWithCache(this.serviceCache, serviceId, () =>
      firstValueFrom(this.caspioService.getService(serviceId))
    );
  }

  async getType(typeId: string | null | undefined): Promise<any> {
    if (!typeId) {
      return null;
    }
    return this.resolveWithCache(this.typeCache, typeId, () =>
      firstValueFrom(this.caspioService.getType(typeId))
    );
  }

  async getEFETemplates(forceRefresh = false): Promise<any[]> {
    console.log('[EFE Data] Loading EFE templates');

    // OFFLINE-FIRST: Use OfflineTemplateService which reads from IndexedDB
    const templates = await this.offlineTemplate.getEFETemplates();
    console.log('[EFE Data] Loaded templates:', templates.length, '(from IndexedDB)');

    return templates;
  }

  /**
   * Get visual templates with offline support
   */
  async getVisualsTemplates(forceRefresh = false): Promise<any[]> {
    console.log('[Visual Data] Loading visual templates');

    // OFFLINE-FIRST: Use OfflineTemplateService which reads from IndexedDB
    const templates = await this.offlineTemplate.getVisualTemplates();
    console.log('[Visual Data] Loaded templates:', templates.length, '(from IndexedDB)');

    return templates;
  }

  async getEFEByService(serviceId: string, forceRefresh = true): Promise<any[]> {
    if (!serviceId) {
      console.warn('[EFE Data] getEFEByService called with empty serviceId');
      return [];
    }

    console.log('[EFE Data] Loading EFE rooms for ServiceID:', serviceId);

    // OFFLINE-FIRST: Use OfflineTemplateService which reads from IndexedDB
    const rooms = await this.offlineTemplate.getEFERooms(serviceId);
    console.log('[EFE Data] Loaded rooms:', rooms.length, '(from IndexedDB + pending)');

    return rooms;
  }

  async getImage(filePath: string): Promise<string> {
    if (!filePath) {
      return '';
    }
    return this.resolveWithCache(this.imageCache, filePath, () =>
      firstValueFrom(this.caspioService.getImageFromFilesAPI(filePath))
    );
  }

  async getVisualsByService(serviceId: string): Promise<any[]> {
    if (!serviceId) {
      console.warn('[Visual Data] getVisualsByService called with empty serviceId');
      return [];
    }
    console.log('[Visual Data] Loading visuals for ServiceID:', serviceId);

    // OFFLINE-FIRST: Use OfflineTemplateService which reads from IndexedDB
    const visuals = await this.offlineTemplate.getVisualsByService(serviceId);
    console.log('[Visual Data] Loaded visuals:', visuals.length, '(from IndexedDB + pending)');

    if (visuals.length > 0) {
      console.log('[Visual Data] Sample visual:', visuals[0]);
    }
    return visuals;
  }

  /**
   * Get HUD records for a service - delegates to OfflineTemplateService
   * Queries LPS_Services_HUD table (not LPS_Services_Visuals)
   */
  async getHudByService(serviceId: string): Promise<any[]> {
    if (!serviceId) {
      console.warn('[HUD Data] getHudByService called with empty serviceId');
      return [];
    }
    console.log('[HUD Data] Loading HUD records for ServiceID:', serviceId);

    // OFFLINE-FIRST: Use OfflineTemplateService which reads from IndexedDB
    const hudRecords = await this.offlineTemplate.getHudByService(serviceId);
    console.log('[HUD Data] Loaded HUD records:', hudRecords.length, '(from IndexedDB + pending)');

    if (hudRecords.length > 0) {
      console.log('[HUD Data] Sample HUD record:', hudRecords[0]);
    }
    return hudRecords;
  }

  /**
   * Get attachments for a HUD record from LPS_Services_HUD_Attach table
   * Uses HUDID as the foreign key (NOT VisualID)
   */
  async getHudAttachments(hudId: string | number): Promise<any[]> {
    if (!hudId) {
      return [];
    }
    const hudIdStr = String(hudId);
    console.log('[HUD Data] Loading attachments for HUDID:', hudIdStr);

    // WEBAPP MODE: Return only server data (no local images)
    if (environment.isWeb) {
      console.log('[HUD Data] WEBAPP MODE: Loading HUD attachments from server only');
      try {
        const serverAttachments = await firstValueFrom(this.caspioService.getServiceHUDAttachByHUDId(hudIdStr));
        console.log(`[HUD Data] WEBAPP: Loaded ${serverAttachments?.length || 0} HUD attachments from server`);
        return serverAttachments || [];
      } catch (error) {
        console.error('[HUD Data] Error loading HUD attachments:', error);
        return [];
      }
    }

    // MOBILE MODE: OFFLINE-FIRST pattern
    // Get local images for this HUD record from LocalImageService
    const localImages = await this.localImageService.getImagesForEntity('hud', hudIdStr);

    // Convert local images to attachment format for UI compatibility
    const localAttachments = await Promise.all(localImages.map(async (img) => {
      const displayUrl = await this.localImageService.getDisplayUrl(img);
      return {
        // Stable identifiers
        imageId: img.imageId,
        AttachID: img.attachId || img.imageId,
        attachId: img.attachId || img.imageId,
        _tempId: img.imageId,
        _pendingFileId: img.imageId,

        // Entity references
        HUDID: img.entityId,
        entityId: img.entityId,
        entityType: img.entityType,
        serviceId: img.serviceId,

        // Content
        Annotation: img.caption,
        caption: img.caption,
        drawings: img.drawings,
        fileName: img.fileName,

        // Display URLs
        Photo: displayUrl,
        url: displayUrl,
        thumbnailUrl: displayUrl,
        displayUrl: displayUrl,
        _thumbnailUrl: displayUrl,

        // Status flags
        status: img.status,
        isPending: img.status === 'queued' || img.status === 'uploading' || img.status === 'local_only',
        isLocal: true
      };
    }));

    console.log(`[HUD Data] MOBILE: Loaded ${localAttachments.length} HUD attachments from LocalImageService`);
    return localAttachments;
  }

  async getVisualAttachments(visualId: string | number): Promise<any[]> {
    if (!visualId) {
      return [];
    }
    const visualIdStr = String(visualId);
    console.log('[Visual Data] Loading attachments for VisualID:', visualIdStr);

    // WEBAPP MODE: Return only server data (no local images)
    if (environment.isWeb) {
      console.log('[Visual Data] WEBAPP MODE: Loading attachments from server only');
      const serverAttachments = await this.offlineTemplate.getVisualAttachments(visualId);
      console.log(`[Visual Data] WEBAPP: Loaded ${serverAttachments?.length || 0} attachments from server`);
      return serverAttachments || [];
    }

    // MOBILE MODE: OFFLINE-FIRST pattern
    // Get legacy attachments from OfflineTemplateService (cached/synced photos)
    const legacyAttachments = await this.offlineTemplate.getVisualAttachments(visualId);

    // NEW LOCAL-FIRST: Get local images for this visual from LocalImageService
    const localImages = await this.localImageService.getImagesForEntity('visual', visualIdStr);

    // Build a set of imageIds we already have from the new system
    const localImageIds = new Set(localImages.map(img => img.imageId));

    // Convert local images to attachment format for UI compatibility
    const localAttachments = await Promise.all(localImages.map(async (img) => {
      const displayUrl = await this.localImageService.getDisplayUrl(img);
      return {
        // Stable identifiers
        imageId: img.imageId,              // STABLE UUID for trackBy
        AttachID: img.attachId || img.imageId,  // Real AttachID after sync, else imageId
        attachId: img.attachId || img.imageId,
        _tempId: img.imageId,
        _pendingFileId: img.imageId,

        // Entity references
        VisualID: img.entityId,
        entityId: img.entityId,
        entityType: img.entityType,
        serviceId: img.serviceId,

        // Content
        Annotation: img.caption,
        caption: img.caption,
        drawings: img.drawings,
        fileName: img.fileName,

        // Display URLs
        Photo: displayUrl,
        url: displayUrl,
        thumbnailUrl: displayUrl,
        displayUrl: displayUrl,
        _thumbnailUrl: displayUrl,

        // Status flags - SILENT SYNC: No uploading/queued indicators
        status: img.status,
        localVersion: img.localVersion,
        _syncing: false,              // SILENT SYNC
        uploading: false,             // SILENT SYNC: No spinner
        queued: false,                // SILENT SYNC: No indicator
        isPending: img.status !== 'verified',
        isLocalFirst: true,
        isLocalImage: true,
        localBlobId: img.localBlobId,
      };
    }));

    // Filter legacy attachments to exclude any that have been migrated to new system
    // (match by AttachID to imageId or attachId)
    const filteredLegacy = legacyAttachments.filter((att: any) => {
      const attId = String(att.AttachID || att.attachId || '');
      // Keep if not in local images (by attachId match)
      return !localImages.some(img => img.attachId === attId);
    });

    // Merge: local-first images first (most recent), then legacy
    const merged = [...localAttachments, ...filteredLegacy];

    console.log('[Visual Data] Loaded attachments (silent sync):', merged.length,
      `(${localAttachments.length} local-first + ${filteredLegacy.length} legacy)`);

    return merged;
  }

  async getEFEPoints(roomId: string | number): Promise<any[]> {
    if (!roomId) {
      return [];
    }
    const key = String(roomId);
    console.log('[EFE Data] Loading EFE points for RoomID:', key);

    // OFFLINE-FIRST: Use OfflineTemplateService which reads from IndexedDB
    const points = await this.offlineTemplate.getEFEPoints(key);
    console.log('[EFE Data] Loaded points:', points.length, '(from IndexedDB + pending)');

    return points;
  }

  async getEFEAttachments(pointIds: string | string[]): Promise<any[]> {
    if (!pointIds || (Array.isArray(pointIds) && pointIds.length === 0)) {
      return [];
    }

    const ids = Array.isArray(pointIds) ? pointIds : [pointIds];

    // WEBAPP MODE: Return only server data (no local images)
    if (environment.isWeb) {
      console.log('[EFE Data] WEBAPP MODE: Loading attachments from server only for', ids.length, 'points');
      const serverAttachments: any[] = [];
      for (const pointId of ids) {
        const attachments = await this.offlineTemplate.getEFEPointAttachments(pointId);
        serverAttachments.push(...attachments);
      }
      console.log(`[EFE Data] WEBAPP: Loaded ${serverAttachments.length} attachments from server`);
      return serverAttachments;
    }

    // MOBILE MODE: OFFLINE-FIRST pattern
    // Get legacy attachments from OfflineTemplateService
    const legacyAttachments: any[] = [];
    for (const pointId of ids) {
      const attachments = await this.offlineTemplate.getEFEPointAttachments(pointId);
      legacyAttachments.push(...attachments);
    }

    // NEW LOCAL-FIRST: Get local images for all points from LocalImageService
    const localImages: any[] = [];
    for (const pointId of ids) {
      const images = await this.localImageService.getImagesForEntity('efe_point', pointId);
      localImages.push(...images);
    }

    // Convert local images to attachment format for UI compatibility
    const localAttachments = await Promise.all(localImages.map(async (img) => {
      const displayUrl = await this.localImageService.getDisplayUrl(img);
      return {
        // Stable identifiers
        imageId: img.imageId,              // STABLE UUID for trackBy
        AttachID: img.attachId || img.imageId,  // Real AttachID after sync, else imageId
        attachId: img.attachId || img.imageId,
        _tempId: img.imageId,
        _pendingFileId: img.imageId,

        // Entity references
        PointID: img.entityId,
        entityId: img.entityId,
        entityType: img.entityType,
        serviceId: img.serviceId,

        // Content
        Type: img.photoType || 'Measurement',  // Use stored photoType (Measurement/Location)
        photoType: img.photoType || 'Measurement',  // Also include lowercase for consistency
        drawings: img.drawings,
        fileName: img.fileName,

        // Display URLs
        Photo: displayUrl,
        url: displayUrl,
        thumbnailUrl: displayUrl,
        displayUrl: displayUrl,
        _thumbnailUrl: displayUrl,

        // Status flags - SILENT SYNC: No uploading/queued indicators
        status: img.status,
        localVersion: img.localVersion,
        _syncing: false,              // SILENT SYNC
        uploading: false,             // SILENT SYNC: No spinner
        queued: false,                // SILENT SYNC: No indicator
        isPending: img.status !== 'verified',
        isLocalFirst: true,
        isLocalImage: true,
        isEFE: true,
        localBlobId: img.localBlobId,
      };
    }));

    // Filter legacy attachments to exclude any that have been migrated to new system
    const filteredLegacy = legacyAttachments.filter((att: any) => {
      const attId = String(att.AttachID || att.attachId || '');
      return !localImages.some(img => img.attachId === attId);
    });

    // Merge: local-first images first, then legacy
    const merged = [...localAttachments, ...filteredLegacy];

    console.log('[EFE Data] Loaded attachments for', ids.length, 'points:', merged.length,
      `(${localAttachments.length} local-first + ${filteredLegacy.length} legacy)`);
    return merged;
  }

  private async resolveWithCache<T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
    loader: () => Promise<T>
  ): Promise<T> {
    const existing = cache.get(key);
    if (existing && !this.isExpired(existing.timestamp)) {
      return existing.value;
    }
    const valuePromise = loader();
    cache.set(key, { value: valuePromise, timestamp: Date.now() });
    return valuePromise;
  }

  private isExpired(timestamp: number): boolean {
    return Date.now() - timestamp > this.cacheTtlMs;
  }

  // Clear all caches - use when returning to page to force fresh data load
  clearAllCaches(): void {
    console.log('[Data Service] Clearing ALL caches to force fresh data load');

    // Clear in-memory caches in this service
    this.projectCache.clear();
    this.serviceCache.clear();
    this.typeCache.clear();
    this.imageCache.clear();
    this.efeTemplatesCache = null;
    this.visualsCache.clear();
    this.visualAttachmentsCache.clear();
    this.efePointsCache.clear();
    this.efeAttachmentsCache.clear();

    // CRITICAL: Also clear the CaspioService's localStorage cache
    // This prevents returning stale cached data from previous page visits
    this.caspioService.clearServicesCache();
  }

  // Clear specific caches for a service - use when service data changes
  clearServiceCaches(serviceId: string): void {
    console.log('[Data Service] Clearing caches for ServiceID:', serviceId);
    this.visualsCache.delete(serviceId);
    // Note: Can't easily clear EFE points/attachments without knowing all room IDs
    // Better to use clearAllCaches() when returning to page
  }

  // ============================================
  // VISUAL MANAGEMENT METHODS
  // ============================================

  async createVisual(visualData: any): Promise<any> {
    // WEBAPP MODE: Create directly via API (no local storage)
    if (environment.isWeb) {
      console.log('[Visual Data] WEBAPP: Creating visual directly via API:', visualData);

      try {
        const response = await fetch(`${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_HUD/records?response=rows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(visualData)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to create visual: ${errorText}`);
        }

        const result = await response.json();
        const createdRecord = result.Result?.[0] || result;

        // HUD table uses HUDID as primary key (not VisualID)
        const hudId = createdRecord.HUDID || createdRecord.PK_ID;
        console.log('[Visual Data] WEBAPP: ✅ HUD record created with HUDID:', hudId);

        // Clear cache
        if (visualData.ServiceID) {
          this.visualsCache.delete(String(visualData.ServiceID));
        }

        return {
          ...visualData,
          HUDID: hudId,
          VisualID: hudId,  // For compatibility with code expecting VisualID
          PK_ID: hudId,
          ...createdRecord
        };
      } catch (error: any) {
        console.error('[Visual Data] WEBAPP: ❌ Error creating visual:', error?.message || error);
        throw error;
      }
    }

    // MOBILE MODE: Offline-first with background sync
    console.log('[Visual Data] Creating new visual (OFFLINE-FIRST):', visualData);

    // Generate temporary ID (using 'hud' prefix for HUD records)
    const tempId = this.tempId.generateTempId('hud');

    // Create placeholder for immediate UI
    const placeholder = {
      ...visualData,
      HUDID: tempId,       // HUD table uses HUDID as primary key
      VisualID: tempId,    // For compatibility with code expecting VisualID
      PK_ID: tempId,
      _tempId: tempId,
      _localOnly: true,
      _syncing: true,
      _createdAt: Date.now(),
    };

    // Store in IndexedDB for background sync
    await this.indexedDb.addPendingRequest({
      type: 'CREATE',
      tempId: tempId,
      endpoint: '/api/caspio-proxy/tables/LPS_Services_HUD/records?response=rows',
      method: 'POST',
      data: visualData,
      dependencies: [],
      status: 'pending',
      priority: 'high',
    });

    // CRITICAL: Cache placeholder to 'hud' cache for Dexie-first pattern
    // This ensures loadDataFromCache() can find the record before sync
    const serviceIdStr = String(visualData.ServiceID);
    const existingHudRecords = await this.indexedDb.getCachedServiceData(serviceIdStr, 'hud') || [];
    await this.indexedDb.cacheServiceData(serviceIdStr, 'hud', [...existingHudRecords, placeholder]);
    console.log('[Visual Data] ✅ Cached HUD placeholder to Dexie:', tempId);

    // Clear in-memory cache
    if (visualData.ServiceID) {
      this.visualsCache.delete(serviceIdStr);
    }

    // Sync will happen on next 60-second interval (batched sync)

    console.log('[Visual Data] Visual saved with temp ID:', tempId);

    // Return placeholder immediately
    return placeholder;
  }

  async updateVisual(visualId: string, visualData: any, serviceId?: string): Promise<any> {
    // WEBAPP MODE: Update directly via API
    if (environment.isWeb) {
      console.log('[Visual Data] WEBAPP: Updating visual directly via API:', visualId, visualData);

      try {
        const response = await fetch(`${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_HUD/records?q.where=HUDID=${visualId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(visualData)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to update visual: ${errorText}`);
        }

        console.log('[Visual Data] WEBAPP: ✅ Visual updated:', visualId);

        // Clear in-memory cache
        this.visualsCache.clear();

        return { success: true, visualId, ...visualData };
      } catch (error: any) {
        console.error('[Visual Data] WEBAPP: ❌ Error updating visual:', error?.message || error);
        throw error;
      }
    }

    // MOBILE MODE: Offline-first
    console.log('[Visual Data] Updating visual (OFFLINE-FIRST):', visualId, visualData);

    const isTempId = String(visualId).startsWith('temp_');

    // OFFLINE-FIRST: Update 'hud' cache immediately, queue for sync
    // CRITICAL: Use 'hud' cache directly (not offlineTemplate which uses 'visuals')
    if (serviceId) {
      if (isTempId) {
        // Update pending request data
        await this.indexedDb.updatePendingRequestData(visualId, visualData);
        console.log('[Visual Data] Updated pending request:', visualId);
      } else {
        // Queue update for sync
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_HUD/records?q.where=HUDID=${visualId}`,
          method: 'PUT',
          data: visualData,
          dependencies: [],
          status: 'pending',
          priority: 'normal',
        });
        console.log('[Visual Data] Queued update for sync:', visualId);
      }

      // Update 'hud' cache with _localUpdate flag to preserve during background refresh
      const existingHudRecords = await this.indexedDb.getCachedServiceData(serviceId, 'hud') || [];
      let matchFound = false;
      const updatedRecords = existingHudRecords.map((v: any) => {
        // Check BOTH PK_ID, VisualID, and HUDID since API may return any of these
        const vId = String(v.HUDID || v.VisualID || v.PK_ID || v._tempId || '');
        if (vId === visualId) {
          matchFound = true;
          return { ...v, ...visualData, _localUpdate: true };
        }
        return v;
      });

      if (!matchFound && isTempId) {
        // For temp IDs not in cache, add a new record
        updatedRecords.push({ ...visualData, _tempId: visualId, PK_ID: visualId, _localUpdate: true });
        console.log('[Visual Data] Added temp record to hud cache:', visualId);
      }

      await this.indexedDb.cacheServiceData(serviceId, 'hud', updatedRecords);
      console.log(`[Visual Data] ✅ Updated 'hud' cache, matchFound=${matchFound}:`, visualId);
    } else {
      // If no serviceId, still queue for sync but skip cache update
      if (!isTempId) {
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_HUD/records?q.where=HUDID=${visualId}`,
          method: 'PUT',
          data: visualData,
          dependencies: [],
          status: 'pending',
          priority: 'normal',
        });
        console.log('[Visual Data] Queued update for sync (no serviceId):', visualId);
      }
    }

    // Clear in-memory cache
    this.visualsCache.clear();

    // Sync will happen on next 60-second interval (batched sync)

    // Return immediately with the updated data
    return { success: true, visualId, ...visualData };
  }

  async deleteVisual(visualId: string, serviceId?: string): Promise<any> {
    console.log('[Visual Data] Deleting visual (OFFLINE-FIRST):', visualId);
    
    const isTempId = String(visualId).startsWith('temp_');
    
    // OFFLINE-FIRST: Remove from IndexedDB cache, queue delete for sync
    if (isTempId) {
      // For temp IDs, just remove the pending request
      await this.indexedDb.removePendingRequest(visualId);
      console.log('[Visual Data] Removed pending visual:', visualId);
    } else {
      // Queue delete for background sync
      // CRITICAL: Use the correct API endpoint format with q.where clause
      await this.indexedDb.addPendingRequest({
        type: 'DELETE',
        endpoint: `/api/caspio-proxy/tables/LPS_Services_HUD/records?q.where=HUDID=${visualId}`,
        method: 'DELETE',
        data: { visualId },
        dependencies: [],
        status: 'pending',
        priority: 'normal',
      });
      console.log('[Visual Data] Queued delete for sync:', visualId);
      
      // Remove from IndexedDB cache if we have serviceId
      if (serviceId) {
        const existingHuds = await this.indexedDb.getCachedServiceData(serviceId, 'hud') || [];
        const filteredHuds = existingHuds.filter((v: any) =>
          String(v.HUDID) !== String(visualId) && String(v.PK_ID) !== String(visualId) && String(v.VisualID) !== String(visualId)
        );
        await this.indexedDb.cacheServiceData(serviceId, 'hud', filteredHuds);
      }
    }

    // Clear in-memory cache
    this.visualsCache.clear();

    // Sync will happen on next 60-second interval (batched sync)

    return { success: true, visualId };
  }

  // ============================================
  // VISUAL PHOTO METHODS
  // ============================================

  /**
   * Upload a photo for a visual - LOCAL-FIRST approach using LocalImageService
   * Uses stable UUIDs that never change, preventing image disappearance during sync.
   * 
   * Flow:
   * 1. LocalImageService.captureImage() stores blob + metadata + queues for upload atomically
   * 2. Returns stable imageId immediately (use for Angular trackBy)
   * 3. BackgroundSync.processUploadOutbox() handles upload
   * 4. Local blob displayed until remote verified
   * 
   * @param visualId - Visual ID (temp or real)
   * @param file - Photo file
   * @param caption - Photo caption
   * @param drawings - Annotation JSON data
   * @param originalFile - Original uncompressed file (optional, unused)
   * @param serviceId - Service ID for grouping (required for proper sync)
   */
  async uploadVisualPhoto(visualId: number | string, file: File, caption: string = '', drawings?: string, originalFile?: File, serviceId?: string): Promise<any> {
    console.log('[Visual Photo] LOCAL-FIRST upload via LocalImageService for VisualID:', visualId, 'ServiceID:', serviceId);
    
    const visualIdStr = String(visualId);
    const effectiveServiceId = serviceId || '';
    
    // Use LocalImageService for proper local-first handling with stable UUIDs
    // This stores blob + metadata + outbox item in a single atomic transaction
    const localImage = await this.localImageService.captureImage(
      file,
      'hud',
      visualIdStr,
      effectiveServiceId,
      caption || '',
      drawings || ''
    );

    // Get display URL (will be local blob URL)
    const displayUrl = await this.localImageService.getDisplayUrl(localImage);

    console.log('[Visual Photo] ✅ Image captured with stable ID:', localImage.imageId, 'status:', localImage.status);

    // Return immediately with stable imageId - NEVER WAIT FOR NETWORK
    // The imageId is a stable UUID that never changes (safe for Angular trackBy)
    return {
      // Stable identifiers (use imageId for trackBy)
      imageId: localImage.imageId,           // STABLE UUID - use for Angular keys
      AttachID: localImage.imageId,          // Legacy compatibility - maps to imageId initially
      attachId: localImage.imageId,          // Lowercase version for caption/annotation updates
      _tempId: localImage.imageId,           // For backward compatibility with existing code
      _pendingFileId: localImage.imageId,    // For IndexedDB lookups when updating caption/drawings
      
      // Entity references
      VisualID: visualIdStr,
      HUDID: visualIdStr,
      entityId: visualIdStr,
      entityType: 'hud',
      serviceId: effectiveServiceId,
      
      // Content
      Annotation: caption,
      caption: caption || '',
      drawings: drawings || '',
      fileName: localImage.fileName,
      fileSize: localImage.fileSize,
      
      // Display URLs (local blob - stable during sync)
      Photo: displayUrl,
      url: displayUrl,
      thumbnailUrl: displayUrl,
      displayUrl: displayUrl,
      _thumbnailUrl: displayUrl,
      
      // Status flags - SILENT SYNC: Don't show uploading/queued indicators
      // Photos appear as normal, sync happens silently in background
      status: localImage.status,
      _syncing: false,           // SILENT: Don't show syncing indicator
      uploading: false,          // SILENT: Don't show upload spinner
      queued: false,             // SILENT: Don't show queued indicator
      isPending: localImage.status !== 'verified',  // Internal flag only
      isObjectUrl: true,
      isLocalFirst: true,        // Flag indicating new local-first system
      localBlobId: localImage.localBlobId,  // For blob URL regeneration
    };
  }

  async deleteVisualPhoto(attachId: string): Promise<any> {
    console.log('[Visual Photo] Deleting photo:', attachId);

    // Clear all attachment caches first (optimistic update)
    this.visualAttachmentsCache.clear();

    // QUEUE-FIRST: Always queue delete for background sync (matches room-elevation pattern)
    // This ensures consistent behavior online/offline and batches deletes with other sync operations
    console.log('[Visual Photo] Queuing delete for sync:', attachId);
    await this.indexedDb.addPendingRequest({
      type: 'DELETE',
      endpoint: `/api/caspio-proxy/tables/LPS_Services_HUD_Attach/records?q.where=AttachID=${attachId}`,
      method: 'DELETE',
      data: { attachId },
      dependencies: [],
      status: 'pending',
      priority: 'high',
    });
    // Sync will happen on next 60-second interval (batched sync)
    return { success: true, queued: true };
  }

  async updateVisualPhotoCaption(attachId: string, caption: string, visualId?: string): Promise<any> {
    console.log('[Visual Photo] Updating caption for AttachID:', attachId);
    const updateData = { Annotation: caption };

    // OFFLINE-FIRST: Update IndexedDB cache immediately
    if (visualId) {
      try {
        const cached = await this.indexedDb.getCachedServiceData(visualId, 'visual_attachments') || [];
        const updated = cached.map((att: any) =>
          String(att.AttachID) === String(attachId)
            ? { ...att, Annotation: caption, _localUpdate: true }
            : att
        );
        await this.indexedDb.cacheServiceData(visualId, 'visual_attachments', updated);
        console.log('[Visual Photo] ✅ Caption saved to IndexedDB for visual', visualId);
      } catch (cacheError) {
        console.warn('[Visual Photo] Failed to update IndexedDB cache:', cacheError);
      }
    }

    // Check if we're online
    if (!this.offlineService.isOnline()) {
      // Queue for later sync
      await this.indexedDb.addPendingRequest({
        type: 'UPDATE',
        endpoint: `/api/caspio-proxy/tables/LPS_Services_HUD_Attach/records?q.where=AttachID=${attachId}`,
        method: 'PUT',
        data: updateData,
        dependencies: [],
        status: 'pending',
        priority: 'normal',
      });
      console.log('[Visual Photo] ⏳ Caption queued for sync (offline)');
      // Sync will happen on next 60-second interval (batched sync)
      this.visualAttachmentsCache.clear();
      return { success: true, queued: true };
    }

    // Online - try API
    try {
      const result = await firstValueFrom(
        this.caspioService.updateServicesVisualsAttach(attachId, updateData)
      );
      console.log('[Visual Photo] ✅ Caption saved via API');
      this.visualAttachmentsCache.clear();
      return result;
    } catch (apiError) {
      // Queue for retry
      console.warn('[Visual Photo] API failed, queuing for retry');
      await this.indexedDb.addPendingRequest({
        type: 'UPDATE',
        endpoint: `/api/caspio-proxy/tables/LPS_Services_HUD_Attach/records?q.where=AttachID=${attachId}`,
        method: 'PUT',
        data: updateData,
        dependencies: [],
        status: 'pending',
        priority: 'high',
      });
      // Sync will happen on next 60-second interval (batched sync)
      this.visualAttachmentsCache.clear();
      return { success: true, queued: true };
    }
  }

  // Clear cache for a specific visual's attachments
  clearVisualAttachmentsCache(visualId?: string | number): void {
    if (visualId) {
      const key = String(visualId);
      this.visualAttachmentsCache.delete(key);
      console.log('[Visual Photo] Cleared cache for VisualID:', visualId);
    } else {
      this.visualAttachmentsCache.clear();
      console.log('[Visual Photo] Cleared all attachment caches');
    }
  }

  // Clear cache for EFE point attachments - CRITICAL for ensuring photos appear after navigation
  clearEFEAttachmentsCache(): void {
    this.efeAttachmentsCache.clear();
    console.log('[EFE Photo] Cleared all EFE attachment caches');
  }

  // ============================================
  // UNIFIED CAPTION/ANNOTATION QUEUE METHODS
  // ============================================
  // These methods ALWAYS queue caption updates, ensuring no data loss during sync operations

  /**
   * Queue a caption update for any attachment type
   * ALWAYS queues to pendingCaptions store, regardless of online status or photo sync state
   * This ensures caption changes are NEVER lost due to race conditions
   * 
   * @param attachId - The attachment ID (can be temp_xxx or real ID)
   * @param caption - The new caption text
   * @param attachType - Type of attachment ('visual', 'efe_point', 'fdf')
   * @param metadata - Additional context (serviceId, visualId, pointId)
   */
  async queueCaptionUpdate(
    attachId: string,
    caption: string,
    attachType: 'visual' | 'efe_point' | 'fdf' | 'hud',
    metadata: { serviceId?: string; visualId?: string; pointId?: string } = {}
  ): Promise<string> {
    console.log(`[Caption Queue] Queueing caption update for ${attachType} attach:`, attachId);

    // 1. Update local cache immediately with _localUpdate flag
    await this.updateLocalCacheWithCaption(attachId, caption, undefined, attachType, metadata);

    // WEBAPP MODE: Call API directly for immediate persistence (if not a temp ID)
    const isTempId = String(attachId).startsWith('temp_') || String(attachId).startsWith('img_');
    if (environment.isWeb && !isTempId) {
      console.log(`[Caption Queue] WEBAPP: Updating caption directly via API for ${attachType}:`, attachId);
      try {
        let endpoint = '';
        if (attachType === 'efe_point') {
          endpoint = `${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_EFE_Points_Attach/records?q.where=AttachID=${attachId}`;
        } else if (attachType === 'visual') {
          endpoint = `${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_Visuals_Attach/records?q.where=AttachID=${attachId}`;
        } else if (attachType === 'hud') {
          endpoint = `${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_HUD_Attach/records?q.where=AttachID=${attachId}`;
        } else if (attachType === 'fdf') {
          // FDF captions are stored on the EFE room record
          const roomId = attachId; // For FDF, attachId is the roomId
          const photoType = metadata.pointId; // photoType (Top/Bottom/Threshold) is passed in pointId
          endpoint = `${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=${roomId}`;
        }

        if (endpoint) {
          const updateData: any = { Annotation: caption };
          if (attachType === 'fdf' && metadata.pointId) {
            // FDF uses different column names: FDF{Type}Annotation
            updateData[`FDF${metadata.pointId}Annotation`] = caption;
            delete updateData.Annotation;
          }

          const response = await fetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
          });

          if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
          }

          console.log(`[Caption Queue] WEBAPP: ✅ Caption updated successfully`);
          return `webapp_direct_${Date.now()}`;
        }
      } catch (apiError: any) {
        console.error(`[Caption Queue] WEBAPP: ❌ API call failed, falling back to queue:`, apiError?.message || apiError);
        // Fall through to queue-based approach
      }
    }

    // MOBILE MODE (or webapp fallback): Queue the caption update for background sync
    const captionId = await this.indexedDb.queueCaptionUpdate({
      attachId,
      attachType,
      caption,
      serviceId: metadata.serviceId,
      visualId: metadata.visualId,
      pointId: metadata.pointId
    });

    console.log(`[Caption Queue] ✅ Caption queued:`, captionId);

    // Sync will happen on next 60-second interval (batched sync)

    return captionId;
  }

  /**
   * Queue an annotation (drawings) update for any attachment type
   * ALWAYS queues to pendingCaptions store
   */
  async queueAnnotationUpdate(
    attachId: string,
    drawings: string,
    attachType: 'visual' | 'efe_point' | 'fdf' | 'hud',
    metadata: { serviceId?: string; visualId?: string; pointId?: string; caption?: string } = {}
  ): Promise<string> {
    console.log(`[Annotation Queue] Queueing annotation update for ${attachType} attach:`, attachId);

    // 1. Update local cache immediately with _localUpdate flag
    await this.updateLocalCacheWithCaption(attachId, metadata.caption, drawings, attachType, metadata);

    // WEBAPP MODE: Call API directly for immediate persistence (if not a temp ID)
    const isTempId = String(attachId).startsWith('temp_') || String(attachId).startsWith('img_');
    if (environment.isWeb && !isTempId) {
      console.log(`[Annotation Queue] WEBAPP: Updating annotation directly via API for ${attachType}:`, attachId);
      try {
        let endpoint = '';
        const updateData: any = { Drawings: drawings };

        if (attachType === 'efe_point') {
          endpoint = `${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_EFE_Points_Attach/records?q.where=AttachID=${attachId}`;
        } else if (attachType === 'visual') {
          endpoint = `${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_Visuals_Attach/records?q.where=AttachID=${attachId}`;
        } else if (attachType === 'hud') {
          endpoint = `${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_HUD_Attach/records?q.where=AttachID=${attachId}`;
        } else if (attachType === 'fdf') {
          const roomId = attachId;
          const photoType = metadata.pointId;
          endpoint = `${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=${roomId}`;
          if (photoType) {
            updateData[`FDF${photoType}Drawings`] = drawings;
            delete updateData.Drawings;
          }
        }

        if (endpoint) {
          if (metadata.caption !== undefined) {
            if (attachType === 'fdf' && metadata.pointId) {
              updateData[`FDF${metadata.pointId}Annotation`] = metadata.caption;
            } else {
              updateData.Annotation = metadata.caption;
            }
          }

          const response = await fetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
          });

          if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
          }

          console.log(`[Annotation Queue] WEBAPP: ✅ Annotation updated successfully`);
          return `webapp_direct_${Date.now()}`;
        }
      } catch (apiError: any) {
        console.error(`[Annotation Queue] WEBAPP: ❌ API call failed, falling back to queue:`, apiError?.message || apiError);
      }
    }

    // MOBILE MODE (or webapp fallback): Queue the annotation update for background sync
    const captionId = await this.indexedDb.queueCaptionUpdate({
      attachId,
      attachType,
      drawings,
      caption: metadata.caption,
      serviceId: metadata.serviceId,
      visualId: metadata.visualId,
      pointId: metadata.pointId
    });

    console.log(`[Annotation Queue] ✅ Annotation queued:`, captionId);

    // Sync will happen on next 60-second interval (batched sync)

    return captionId;
  }

  /**
   * Queue both caption and annotation update together
   */
  async queueCaptionAndAnnotationUpdate(
    attachId: string,
    caption: string,
    drawings: string,
    attachType: 'visual' | 'efe_point' | 'fdf' | 'hud',
    metadata: { serviceId?: string; visualId?: string; pointId?: string } = {}
  ): Promise<string> {
    console.log(`[Caption+Annotation Queue] Queueing combined update for ${attachType} attach:`, attachId);

    // 1. Update local cache
    await this.updateLocalCacheWithCaption(attachId, caption, drawings, attachType, metadata);

    // WEBAPP MODE: Call API directly for immediate persistence (if not a temp ID)
    const isTempId = String(attachId).startsWith('temp_') || String(attachId).startsWith('img_');
    if (environment.isWeb && !isTempId) {
      console.log(`[Caption+Annotation Queue] WEBAPP: Updating directly via API for ${attachType}:`, attachId);
      try {
        let endpoint = '';
        const updateData: any = { Annotation: caption, Drawings: drawings };

        if (attachType === 'efe_point') {
          endpoint = `${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_EFE_Points_Attach/records?q.where=AttachID=${attachId}`;
        } else if (attachType === 'visual') {
          endpoint = `${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_Visuals_Attach/records?q.where=AttachID=${attachId}`;
        } else if (attachType === 'hud') {
          endpoint = `${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_HUD_Attach/records?q.where=AttachID=${attachId}`;
        } else if (attachType === 'fdf') {
          const roomId = attachId;
          const photoType = metadata.pointId;
          endpoint = `${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=${roomId}`;
          if (photoType) {
            updateData[`FDF${photoType}Annotation`] = caption;
            updateData[`FDF${photoType}Drawings`] = drawings;
            delete updateData.Annotation;
            delete updateData.Drawings;
          }
        }

        if (endpoint) {
          const response = await fetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
          });

          if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
          }

          console.log(`[Caption+Annotation Queue] WEBAPP: ✅ Updated successfully`);
          return `webapp_direct_${Date.now()}`;
        }
      } catch (apiError: any) {
        console.error(`[Caption+Annotation Queue] WEBAPP: ❌ API call failed, falling back to queue:`, apiError?.message || apiError);
      }
    }

    // MOBILE MODE (or webapp fallback): Queue combined update
    const captionId = await this.indexedDb.queueCaptionUpdate({
      attachId,
      attachType,
      caption,
      drawings,
      serviceId: metadata.serviceId,
      visualId: metadata.visualId,
      pointId: metadata.pointId
    });

    console.log(`[Caption+Annotation Queue] ✅ Combined update queued:`, captionId);

    // Sync will happen on next 60-second interval (batched sync)
    return captionId;
  }

  /**
   * Update local IndexedDB cache with caption/annotation changes
   * Sets _localUpdate flag to prevent background refresh from overwriting
   * ROBUST: Updates multiple stores for redundancy - pendingCaptions is authoritative
   */
  private async updateLocalCacheWithCaption(
    attachId: string,
    caption: string | undefined,
    drawings: string | undefined,
    attachType: 'visual' | 'efe_point' | 'fdf' | 'hud',
    metadata: { serviceId?: string; visualId?: string; pointId?: string }
  ): Promise<void> {
    try {
      const attachIdStr = String(attachId);
      const isTempId = attachIdStr.startsWith('temp_');
      
      // For temp IDs, TRY to update the pending photo data in pendingImages store
      // This is a BEST-EFFORT update - pendingCaptions store is authoritative
      if (isTempId) {
        const updated = await this.indexedDb.updatePendingPhotoData(attachIdStr, {
          caption: caption,
          drawings: drawings
        });
        if (updated) {
          console.log(`[Caption Cache] ✅ Updated pending photo data for temp ID:`, attachIdStr);
        } else {
          // Photo might not be in pendingImages store yet or was already synced
          // This is OK - pendingCaptions store will handle it as the authoritative source
          console.warn(`[Caption Cache] ⚠️ Photo ${attachIdStr} not found in pendingImages - relying on pendingCaptions as authoritative source`);
        }
        // DON'T return early - also try to update synced cache if it exists
        // This handles the edge case where photo synced but temp ID is still being used
      }
      
      // For real IDs (or temp IDs that might have synced), update the appropriate cache
      if (attachType === 'visual' && metadata.visualId) {
        const cached = await this.indexedDb.getCachedServiceData(metadata.visualId, 'visual_attachments') || [];
        let foundInCache = false;
        const updatedCache = cached.map((att: any) => {
          if (String(att.AttachID) === attachIdStr) {
            foundInCache = true;
            const updated: any = { ...att, _localUpdate: true, _updatedAt: Date.now() };
            if (caption !== undefined) updated.Annotation = caption;
            if (drawings !== undefined) updated.Drawings = drawings;
            return updated;
          }
          return att;
        });
        if (foundInCache) {
          await this.indexedDb.cacheServiceData(metadata.visualId, 'visual_attachments', updatedCache);
          this.visualAttachmentsCache.clear();
          console.log(`[Caption Cache] ✅ Updated visual attachments cache for visualId:`, metadata.visualId);
        } else if (!isTempId) {
          console.warn(`[Caption Cache] ⚠️ Attachment ${attachIdStr} not found in visual cache - pendingCaptions will handle it`);
        }
      } else if (attachType === 'efe_point' && metadata.pointId) {
        const cached = await this.indexedDb.getCachedServiceData(metadata.pointId, 'efe_point_attachments') || [];
        let foundInCache = false;
        const updatedCache = cached.map((att: any) => {
          if (String(att.AttachID) === attachIdStr) {
            foundInCache = true;
            const updated: any = { ...att, _localUpdate: true, _updatedAt: Date.now() };
            if (caption !== undefined) updated.Annotation = caption;
            if (drawings !== undefined) updated.Drawings = drawings;
            return updated;
          }
          return att;
        });
        if (foundInCache) {
          await this.indexedDb.cacheServiceData(metadata.pointId, 'efe_point_attachments', updatedCache);
          this.efeAttachmentsCache.clear();
          console.log(`[Caption Cache] ✅ Updated EFE point attachments cache for pointId:`, metadata.pointId);
        } else if (!isTempId) {
          console.warn(`[Caption Cache] ⚠️ Attachment ${attachIdStr} not found in EFE cache - pendingCaptions will handle it`);
        }
      } else if (attachType === 'hud' && metadata.visualId) {
        // HUD uses visualId as the HUDID for cache lookup
        const cached = await this.indexedDb.getCachedServiceData(metadata.visualId, 'hud_attachments') || [];
        let foundInCache = false;
        const updatedCache = cached.map((att: any) => {
          if (String(att.AttachID) === attachIdStr) {
            foundInCache = true;
            const updated: any = { ...att, _localUpdate: true, _updatedAt: Date.now() };
            if (caption !== undefined) updated.Annotation = caption;
            if (drawings !== undefined) updated.Drawings = drawings;
            return updated;
          }
          return att;
        });
        if (foundInCache) {
          await this.indexedDb.cacheServiceData(metadata.visualId, 'hud_attachments', updatedCache);
          console.log(`[Caption Cache] ✅ Updated HUD attachments cache for HUDID:`, metadata.visualId);
        } else if (!isTempId) {
          console.warn(`[Caption Cache] ⚠️ Attachment ${attachIdStr} not found in HUD cache - pendingCaptions will handle it`);
        }
      }
      // FDF type is handled differently (stored in room record, not attachments)
    } catch (error) {
      console.warn('[Caption Cache] ❌ Failed to update local cache:', error);
      // Continue anyway - pendingCaptions store is authoritative and will sync correctly
    }
  }

  /**
   * Get count of pending caption updates for sync status display
   */
  async getPendingCaptionCount(): Promise<number> {
    return this.indexedDb.getPendingCaptionCount();
  }

  // ============================================
  // EFE ROOM METHODS (OFFLINE-FIRST)
  // ============================================

  /**
   * Create an EFE room (offline-first pattern)
   * Similar to createVisual() but for EFE records
   */
  async createEFERoom(roomData: any): Promise<any> {
    // WEBAPP MODE: Create directly via API (no local storage)
    if (environment.isWeb) {
      console.log('[EFE Data] WEBAPP: Creating EFE room directly via API:', roomData);

      try {
        const response = await fetch(`${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_EFE/records?response=rows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(roomData)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to create EFE room: ${errorText}`);
        }

        const result = await response.json();
        const createdRecord = result.Result?.[0] || result;

        console.log('[EFE Data] WEBAPP: ✅ EFE room created with ID:', createdRecord.EFEID || createdRecord.PK_ID);

        return {
          ...roomData,
          EFEID: createdRecord.EFEID || createdRecord.PK_ID,
          PK_ID: createdRecord.PK_ID || createdRecord.EFEID,
          ...createdRecord
        };
      } catch (error: any) {
        console.error('[EFE Data] WEBAPP: ❌ Error creating EFE room:', error?.message || error);
        throw error;
      }
    }

    // MOBILE MODE: Offline-first with background sync
    console.log('[EFE Data] Creating new EFE room (OFFLINE-FIRST):', roomData);

    // Generate temporary ID
    const tempId = this.tempId.generateTempId('efe');

    // Create placeholder for immediate UI
    const placeholder = {
      ...roomData,
      EFEID: tempId,
      PK_ID: tempId,
      _tempId: tempId,
      _localOnly: true,
      _syncing: true,
      _createdAt: Date.now(),
    };

    // Store in pendingEFEData for immediate display
    await this.indexedDb.addPendingEFE({
      tempId,
      serviceId: String(roomData.ServiceID),
      type: 'room',
      data: placeholder,
    });

    // Store in IndexedDB for background sync
    await this.indexedDb.addPendingRequest({
      type: 'CREATE',
      tempId: tempId,
      endpoint: '/api/caspio-proxy/tables/LPS_Services_EFE/records?response=rows',
      method: 'POST',
      data: roomData,
      dependencies: [],
      status: 'pending',
      priority: 'high',
    });

    // Sync will happen on next 60-second interval (batched sync)

    console.log('[EFE Data] EFE room queued with temp ID:', tempId);

    // Return placeholder immediately
    return placeholder;
  }

  /**
   * Update an EFE room
   */
  async updateEFERoom(efeId: string, roomData: any): Promise<any> {
    console.log('[EFE Data] Updating EFE room:', efeId);

    // Check if this is a temp ID (offline created room)
    if (String(efeId).startsWith('temp_')) {
      console.log('[EFE Data] Cannot update room with temp ID until synced');
      throw new Error('Room not yet synced. Please wait for sync to complete.');
    }

    const result = await firstValueFrom(this.caspioService.updateServicesEFE(efeId, roomData));

    // Invalidate service cache
    if (roomData.ServiceID) {
      await this.offlineCache.invalidateServiceCaches(String(roomData.ServiceID));
    }

    return result;
  }

  /**
   * Delete an EFE room
   */
  async deleteEFERoom(efeId: string): Promise<any> {
    console.log('[EFE Data] Deleting EFE room:', efeId);

    // Check if this is a temp ID (offline created room)
    if (String(efeId).startsWith('temp_')) {
      // Remove from pending
      await this.indexedDb.removePendingEFE(efeId);
      console.log('[EFE Data] Removed pending EFE room:', efeId);
      return { deleted: true };
    }

    const result = await firstValueFrom(this.caspioService.deleteServicesEFE(efeId));
    return result;
  }

  // ============================================
  // EFE POINT METHODS (OFFLINE-FIRST)
  // ============================================

  /**
   * Create an EFE point (offline-first pattern with room dependency)
   */
  async createEFEPoint(pointData: any, roomTempId?: string): Promise<any> {
    console.log('[EFE Data] createEFEPoint called with:', { pointData, roomTempId, isWeb: environment.isWeb });

    // Determine parent ID (room's temp or real ID)
    const parentId = roomTempId || String(pointData.EFEID);
    console.log('[EFE Data] parentId resolved to:', parentId, 'type:', typeof parentId);

    // WEBAPP MODE: Create directly via API (if room has real ID, not temp)
    if (environment.isWeb && !String(parentId).startsWith('temp_')) {
      console.log('[EFE Data] WEBAPP: Entering webapp branch for point creation');
      // Ensure EFEID is numeric (database expects integer)
      const numericEfeId = parseInt(String(parentId), 10);
      if (isNaN(numericEfeId)) {
        console.error('[EFE Data] WEBAPP: Invalid EFEID (not numeric):', parentId);
        throw new Error(`Invalid EFEID: ${parentId}`);
      }

      console.log('[EFE Data] WEBAPP: Creating EFE point directly via API:', { ...pointData, EFEID: numericEfeId });

      try {
        const response = await fetch(`${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_EFE_Points/records?response=rows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            EFEID: numericEfeId,
            PointName: pointData.PointName
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to create EFE point: ${errorText}`);
        }

        const result = await response.json();
        const createdRecord = result.Result?.[0] || result;

        console.log('[EFE Data] WEBAPP: ✅ EFE point created with ID:', createdRecord.PointID || createdRecord.PK_ID);

        return {
          PointID: createdRecord.PointID || createdRecord.PK_ID,
          PK_ID: createdRecord.PK_ID || createdRecord.PointID,
          EFEID: numericEfeId,
          PointName: pointData.PointName,
          _tempId: createdRecord.PointID || createdRecord.PK_ID, // Use real ID as _tempId for compatibility
          ...createdRecord
        };
      } catch (error: any) {
        console.error('[EFE Data] WEBAPP: ❌ Error creating EFE point:', error?.message || error);
        throw error;
      }
    }

    // MOBILE MODE: Offline-first with background sync
    console.log('[EFE Data] Creating new EFE point (OFFLINE-FIRST):', pointData);

    // Generate temporary ID
    const tempId = this.tempId.generateTempId('point');

    // Create placeholder for immediate UI
    const placeholder = {
      ...pointData,
      PointID: tempId,
      PK_ID: tempId,
      EFEID: parentId, // Use the resolved parent ID
      _tempId: tempId,
      _localOnly: true,
      _syncing: true,
      _createdAt: Date.now(),
    };

    // Store in pendingEFEData for immediate display
    await this.indexedDb.addPendingEFE({
      tempId,
      serviceId: String(pointData.ServiceID || ''),
      type: 'point',
      parentId: parentId,
      data: placeholder,
    });

    // Find dependencies if room uses temp ID
    const dependencies: string[] = [];
    if (roomTempId && String(roomTempId).startsWith('temp_')) {
      // Search both pending and all requests to ensure we find the room request
      const pending = await this.indexedDb.getPendingRequests();
      const allRequests = await this.indexedDb.getAllRequests();
      const roomRequest = [...pending, ...allRequests].find(r => r.tempId === roomTempId);
      if (roomRequest) {
        dependencies.push(roomRequest.requestId);
        console.log('[EFE Data] Point depends on room request:', roomRequest.requestId);
      } else {
        console.warn('[EFE Data] Room request not found for', roomTempId, '- point may sync before room!');
      }
    }

    // Prepare data for sync - ensure EFEID is the temp ID string (if room is temp)
    // BackgroundSyncService.resolveTempIds will convert temp_efe_xxx to real ID before API call
    const syncData = {
      ...pointData,
      EFEID: parentId, // Use temp ID string, will be resolved by BackgroundSync
    };

    // Store in IndexedDB for background sync
    await this.indexedDb.addPendingRequest({
      type: 'CREATE',
      tempId: tempId,
      endpoint: '/api/caspio-proxy/tables/LPS_Services_EFE_Points/records?response=rows',
      method: 'POST',
      data: syncData,
      dependencies: dependencies,
      status: 'pending',
      priority: 'normal',
    });

    // Sync will happen on next 60-second interval (batched sync)

    console.log('[EFE Data] EFE point queued with temp ID:', tempId, 'EFEID:', parentId, 'dependencies:', dependencies);

    // Return placeholder immediately
    return placeholder;
  }

  /**
   * Update an EFE point
   */
  async updateEFEPoint(pointId: string, pointData: any): Promise<any> {
    console.log('[EFE Data] Updating EFE point:', pointId);

    // Check if this is a temp ID
    if (String(pointId).startsWith('temp_')) {
      console.log('[EFE Data] Cannot update point with temp ID until synced');
      throw new Error('Point not yet synced. Please wait for sync to complete.');
    }

    const result = await firstValueFrom(this.caspioService.updateServicesEFEPoint(pointId, pointData));

    // Clear point caches
    this.efePointsCache.clear();

    return result;
  }

  /**
   * Delete an EFE point
   */
  async deleteEFEPoint(pointId: string): Promise<any> {
    console.log('[EFE Data] Deleting EFE point:', pointId);

    // Check if this is a temp ID
    if (String(pointId).startsWith('temp_')) {
      // Remove from pending
      await this.indexedDb.removePendingEFE(pointId);
      console.log('[EFE Data] Removed pending EFE point:', pointId);
      return { deleted: true };
    }

    const result = await firstValueFrom(this.caspioService.deleteServicesEFEPoint(pointId));

    // Clear point caches
    this.efePointsCache.clear();

    return result;
  }

  // ============================================
  // EFE PHOTO METHODS (OFFLINE-FIRST)
  // ============================================

  /**
   * Upload a photo for an EFE point - LOCAL-FIRST approach using LocalImageService
   * Uses stable UUIDs that never change, preventing image disappearance during sync.
   * 
   * Flow:
   * 1. LocalImageService.captureImage() stores blob + metadata + queues for upload atomically
   * 2. Returns stable imageId immediately (use for Angular trackBy)
   * 3. BackgroundSync.processUploadOutbox() handles upload
   * 4. Local blob displayed until remote verified
   * 
   * @param pointId - EFE Point ID (temp or real)
   * @param file - Photo file
   * @param photoType - Photo type (Measurement, etc.)
   * @param drawings - Annotation JSON data
   * @param serviceId - Service ID for grouping (required for proper sync)
   */
  async uploadEFEPointPhoto(pointId: number | string, file: File, photoType: string = 'Measurement', drawings?: string, serviceId?: string): Promise<any> {
    const pointIdStr = String(pointId);
    const effectiveServiceId = serviceId || '';
    const isTempPointId = pointIdStr.startsWith('temp_');

    // WEBAPP MODE: Upload directly to S3 and create database record immediately
    if (environment.isWeb && !isTempPointId) {
      console.log('[EFE Photo] WEBAPP: Direct upload to S3 for PointID:', pointId, 'photoType:', photoType);

      try {
        // Generate unique filename for S3
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 8);
        const fileExt = file.name.split('.').pop() || 'jpg';
        const uniqueFilename = `efe_point_${pointIdStr}_${photoType.toLowerCase()}_${timestamp}_${randomId}.${fileExt}`;

        // Upload to S3 via API Gateway
        const formData = new FormData();
        formData.append('file', file, uniqueFilename);
        formData.append('tableName', 'LPS_Services_EFE_Points_Attach');
        formData.append('attachId', pointIdStr);

        const uploadUrl = `${environment.apiGatewayUrl}/api/s3/upload`;
        console.log('[EFE Photo] WEBAPP: Uploading to S3:', uploadUrl);

        const uploadResponse = await fetch(uploadUrl, {
          method: 'POST',
          body: formData
        });

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          throw new Error('Failed to upload to S3: ' + errorText);
        }

        const uploadResult = await uploadResponse.json();
        const s3Key = uploadResult.s3Key;
        console.log('[EFE Photo] WEBAPP: ✅ Uploaded to S3 with key:', s3Key);

        // Create attachment record in database
        const attachmentData = {
          PointID: parseInt(pointIdStr, 10),
          Type: photoType,
          Attachment: s3Key,
          Annotation: '',
          Drawings: drawings || ''
        };

        const createResponse = await fetch(`${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_EFE_Points_Attach/records?response=rows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(attachmentData)
        });

        if (!createResponse.ok) {
          const errorText = await createResponse.text();
          throw new Error('Failed to create attachment record: ' + errorText);
        }

        const createResult = await createResponse.json();
        const createdRecord = createResult.Result?.[0] || createResult;
        const attachId = createdRecord.AttachID || createdRecord.PK_ID;

        console.log('[EFE Photo] WEBAPP: ✅ Attachment record created with ID:', attachId);

        // Create blob URL for immediate display (most reliable)
        const displayUrl = URL.createObjectURL(file);

        return {
          imageId: String(attachId),
          AttachID: attachId,
          attachId: String(attachId),
          _tempId: String(attachId),
          _pendingFileId: String(attachId),
          PointID: pointIdStr,
          entityId: pointIdStr,
          entityType: 'efe_point',
          serviceId: effectiveServiceId,
          Type: photoType,
          photoType: photoType,
          drawings: drawings || '',
          fileName: uniqueFilename,
          fileSize: file.size,
          Photo: s3Key,
          Attachment: s3Key,
          url: displayUrl,
          thumbnailUrl: displayUrl,
          displayUrl: displayUrl,
          _thumbnailUrl: displayUrl,
          status: 'verified',
          _syncing: false,
          uploading: false,
          queued: false,
          isPending: false,
          isObjectUrl: displayUrl.startsWith('blob:'),
          isEFE: true,
          isLocalFirst: false,
          ...createdRecord
        };
      } catch (error: any) {
        console.error('[EFE Photo] WEBAPP: ❌ Upload failed:', error?.message || error);
        // Fall through to local-first approach as fallback
      }
    }

    // MOBILE MODE (or webapp fallback): Local-first upload via LocalImageService
    console.log('[EFE Photo] LOCAL-FIRST upload via LocalImageService for PointID:', pointId, 'photoType:', photoType, 'ServiceID:', serviceId);

    // Use LocalImageService for proper local-first handling with stable UUIDs
    // This stores blob + metadata + outbox item in a single atomic transaction
    // CRITICAL: Pass photoType so it's stored and used during sync
    const localImage = await this.localImageService.captureImage(
      file,
      'efe_point',
      pointIdStr,
      effectiveServiceId,
      '',  // EFE photos don't use caption in the same way
      drawings || '',
      photoType  // CRITICAL: Store photoType (Measurement/Location) for correct sync
    );

    // Get display URL (will be local blob URL)
    const displayUrl = await this.localImageService.getDisplayUrl(localImage);

    console.log('[EFE Photo] ✅ Image captured with stable ID:', localImage.imageId, 'status:', localImage.status);

    // Return immediately with stable imageId - NEVER WAIT FOR NETWORK
    // The imageId is a stable UUID that never changes (safe for Angular trackBy)
    return {
      // Stable identifiers (use imageId for trackBy)
      imageId: localImage.imageId,           // STABLE UUID - use for Angular keys
      AttachID: localImage.imageId,          // Legacy compatibility - maps to imageId initially
      attachId: localImage.imageId,          // Lowercase version for caption/annotation updates
      _tempId: localImage.imageId,           // For backward compatibility with existing code
      _pendingFileId: localImage.imageId,    // For IndexedDB lookups when updating caption/drawings

      // Entity references
      PointID: pointIdStr,
      entityId: pointIdStr,
      entityType: 'efe_point',
      serviceId: effectiveServiceId,

      // Content
      Type: photoType,
      photoType: photoType,
      drawings: drawings || '',
      fileName: localImage.fileName,
      fileSize: localImage.fileSize,

      // Display URLs (local blob - stable during sync)
      Photo: displayUrl,
      url: displayUrl,
      thumbnailUrl: displayUrl,
      displayUrl: displayUrl,
      _thumbnailUrl: displayUrl,

      // Status flags - SILENT SYNC: Don't show uploading/queued indicators
      // Photos appear as normal, sync happens silently in background
      status: localImage.status,
      _syncing: false,           // SILENT: Don't show syncing indicator
      uploading: false,          // SILENT: Don't show upload spinner
      queued: false,             // SILENT: Don't show queued indicator
      isPending: localImage.status !== 'verified',  // Internal flag only
      isObjectUrl: true,
      isEFE: true,
      isLocalFirst: true,        // Flag indicating new local-first system
      localBlobId: localImage.localBlobId,  // For blob URL regeneration
    };
  }

  /**
   * Delete an EFE point photo
   */
  async deleteEFEPointPhoto(attachId: string): Promise<any> {
    console.log('[EFE Photo] Deleting photo:', attachId);

    // Check if this is a temp ID
    if (String(attachId).startsWith('temp_')) {
      // Remove from IndexedDB
      await this.indexedDb.deleteStoredFile(attachId);
      console.log('[EFE Photo] Removed pending photo:', attachId);
      return { deleted: true };
    }

    const result = await firstValueFrom(this.caspioService.deleteServicesEFEPointsAttach(attachId));

    // Clear attachment caches
    this.efeAttachmentsCache.clear();

    return result;
  }

  /**
   * Get merged EFE rooms (API + pending offline rooms)
   */
  async getMergedEFERooms(serviceId: string): Promise<any[]> {
    // Get rooms from API (with offline cache fallback)
    const apiRooms = await this.offlineCache.getEFEByService(serviceId);

    // Merge with pending offline rooms
    return this.offlineCache.getMergedEFERooms(serviceId, apiRooms);
  }

  /**
   * Get merged EFE points (API + pending offline points)
   */
  async getMergedEFEPoints(roomId: string): Promise<any[]> {
    // Get points from API (with offline cache fallback)
    const apiPoints = await this.offlineCache.getEFEPoints(roomId);

    // Merge with pending offline points
    return this.offlineCache.getMergedEFEPoints(roomId, apiPoints);
  }

  /**
   * Get merged visuals (API + pending offline visuals)
   */
  async getMergedVisuals(serviceId: string): Promise<any[]> {
    // Get visuals from API (with offline cache fallback)
    const apiVisuals = await this.offlineCache.getVisualsByService(serviceId);

    // Merge with pending offline visuals
    return this.offlineCache.getMergedVisuals(serviceId, apiVisuals);
  }

  // ============================================================================
  // REHYDRATION - Restore purged service data from server (Phase 7)
  // ============================================================================

  /**
   * Rehydrate a service that was previously purged
   * Fetches fresh data from the server and restores to ACTIVE state
   *
   * Called when user opens a service that's in PURGED or ARCHIVED state.
   * Must be online to rehydrate.
   *
   * @param serviceId - The service to rehydrate
   * @returns Result with success status and counts of restored items
   */
  async rehydrateService(serviceId: string): Promise<{
    success: boolean;
    restored: {
      visuals: number;
      efeRooms: number;
      visualAttachments: number;
      efeAttachments: number;
    };
    error?: string;
  }> {
    console.log(`[DataService] ═══════════════════════════════════════════════════`);
    console.log(`[DataService] 🔄 REHYDRATION STARTING for service: ${serviceId}`);
    console.log(`[DataService] ═══════════════════════════════════════════════════`);

    const result = {
      success: false,
      restored: {
        visuals: 0,
        efeRooms: 0,
        visualAttachments: 0,
        efeAttachments: 0
      },
      error: undefined as string | undefined
    };

    // Must be online to rehydrate
    if (!this.offlineService.isOnline()) {
      result.error = 'Cannot rehydrate while offline. Please connect to the internet.';
      console.warn('[DataService] Rehydration failed: offline');
      return result;
    }

    try {
      // Check current purge state and show what was previously cleared
      const metadata = await this.serviceMetadata.getServiceMetadata(serviceId);

      // Log the state before rehydration
      if (metadata) {
        console.log(`[DataService] 📋 Service State Before Rehydration:`);
        console.log(`[DataService]    - Purge State: ${metadata.purgeState}`);
        console.log(`[DataService]    - Last Touched: ${new Date(metadata.lastTouchedAt).toLocaleString()}`);
        console.log(`[DataService]    - Local Revision: ${metadata.lastLocalRevision}`);
        console.log(`[DataService]    - Server ACK Revision: ${metadata.lastServerAckRevision}`);
      }

      // Count what's currently in local storage (should be 0 or minimal if purged)
      const existingImages = await db.localImages.where('serviceId').equals(serviceId).count();
      const existingVisualFields = await db.visualFields.where('serviceId').equals(serviceId).count();
      const existingEfeFields = await db.efeFields.where('serviceId').equals(serviceId).count();

      console.log(`[DataService] 📊 Current Local State (before rehydration):`);
      console.log(`[DataService]    - Local Images: ${existingImages}`);
      console.log(`[DataService]    - Visual Fields: ${existingVisualFields}`);
      console.log(`[DataService]    - EFE Fields: ${existingEfeFields}`);
      if (metadata && metadata.purgeState === 'ACTIVE') {
        console.log('[DataService] Service already ACTIVE, no rehydration needed');
        result.success = true;
        return result;
      }

      // Clear in-memory caches for this service to force fresh fetch
      this.invalidateCachesForService(serviceId, 'rehydration_start');

      // Visual categories to process
      const visualCategories = ['Grading', 'Roofing', 'Foundation', 'Superstructure', 'Limitations', 'Summary'];

      // ========== STEP 1: Seed EFE templates ==========
      console.log('[DataService] Step 1: Seeding EFE templates...');
      const efeTemplates = await this.offlineTemplate.getEFETemplates();
      if (efeTemplates && efeTemplates.length > 0) {
        await this.efeFieldRepo.seedFromTemplates(serviceId, efeTemplates);
        console.log(`[DataService] ✅ Seeded ${efeTemplates.length} EFE templates`);
      }

      // ========== STEP 2: Seed Visual templates ==========
      console.log('[DataService] Step 2: Seeding Visual templates...');
      const allVisualTemplates = await this.offlineTemplate.getVisualTemplates();
      for (const category of visualCategories) {
        try {
          // Filter templates by category
          const templates = allVisualTemplates.filter((t: any) => t.Category === category);
          if (templates && templates.length > 0) {
            await this.visualFieldRepo.seedFromTemplates(serviceId, category, templates);
          }
        } catch (err) {
          console.warn(`[DataService] Failed to seed visual templates for ${category}:`, err);
        }
      }
      console.log('[DataService] ✅ Visual templates seeded');

      // ========== STEP 3: Fetch and merge EFE rooms from server ==========
      console.log('[DataService] Step 3: Fetching EFE rooms from server...');
      const efeRooms = await firstValueFrom(this.caspioService.getServicesEFE(serviceId));
      if (efeRooms && Array.isArray(efeRooms) && efeRooms.length > 0) {
        // Cache the raw data
        await this.indexedDb.cacheServiceData(serviceId, 'efe_rooms', efeRooms);

        // Merge into efeFields table (Dexie-first)
        await this.efeFieldRepo.mergeExistingRooms(serviceId, efeRooms);
        result.restored.efeRooms = efeRooms.length;
        console.log(`[DataService] ✅ Merged ${efeRooms.length} EFE rooms`);

        // Fetch EFE points for each room and update efeFields
        for (const room of efeRooms) {
          const roomId = room.EFEID || room.RoomID;
          const roomName = room.RoomName;
          if (roomId && roomName) {
            try {
              const points = await firstValueFrom(this.caspioService.getServicesEFEPoints(String(roomId)));
              if (points && Array.isArray(points) && points.length > 0) {
                // Update efeFields with point data
                await this.efeFieldRepo.mergeExistingPoints(serviceId, roomName, points);

                // Fetch attachments for these points
                const pointIds = points.map((p: any) => String(p.PointID || p.pointId)).filter(Boolean);
                if (pointIds.length > 0) {
                  try {
                    const attachments = await firstValueFrom(
                      this.caspioService.getServicesEFEAttachments(pointIds)
                    );
                    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
                      // Create LocalImage records for each attachment
                      for (const attach of attachments) {
                        await this.createLocalImageFromAttachment(serviceId, 'efe_point', attach);
                      }
                      result.restored.efeAttachments += attachments.length;
                    }
                  } catch (err) {
                    console.warn(`[DataService] Failed to fetch EFE attachments:`, err);
                  }
                }
              }
            } catch (err) {
              console.warn(`[DataService] Failed to fetch points for room ${roomId}:`, err);
            }
          }
        }
        console.log(`[DataService] ✅ Restored ${result.restored.efeAttachments} EFE attachments`);
      }

      // ========== STEP 4: Fetch and merge Visuals from server ==========
      console.log('[DataService] Step 4: Fetching Visuals from server...');
      const visuals = await firstValueFrom(this.caspioService.getServicesVisualsByServiceId(serviceId));
      if (visuals && Array.isArray(visuals) && visuals.length > 0) {
        // Cache the raw data
        await this.indexedDb.cacheServiceData(serviceId, 'visuals', visuals);
        result.restored.visuals = visuals.length;

        // Extract unique categories from ACTUAL server data (not hardcoded)
        const serverCategories = new Set<string>();
        for (const visual of visuals) {
          if (visual.Category) {
            serverCategories.add(visual.Category);
          }
        }
        const categoriesArray = Array.from(serverCategories);
        console.log(`[DataService] Found categories in server data:`, categoriesArray);

        // Merge into visualFields table for each category found in server data
        for (const category of serverCategories) {
          await this.visualFieldRepo.mergeExistingVisuals(serviceId, category, visuals);
        }
        console.log(`[DataService] ✅ Merged ${visuals.length} visuals across ${serverCategories.size} categories`);

        // Fetch visual attachments and create LocalImage records
        for (const visual of visuals) {
          const visualId = visual.VisualID || visual.visualId;
          if (visualId) {
            try {
              const attachments = await firstValueFrom(
                this.caspioService.getServiceVisualsAttachByVisualId(String(visualId))
              );
              if (attachments && Array.isArray(attachments) && attachments.length > 0) {
                for (const attach of attachments) {
                  await this.createLocalImageFromAttachment(serviceId, 'visual', attach);
                }
                result.restored.visualAttachments += attachments.length;
              }
            } catch (err) {
              console.warn(`[DataService] Failed to fetch attachments for visual ${visualId}:`, err);
            }
          }
        }
        console.log(`[DataService] ✅ Restored ${result.restored.visualAttachments} visual attachments`);
      }

      // Update purge state to ACTIVE
      await this.serviceMetadata.setPurgeState(serviceId, 'ACTIVE');
      await this.serviceMetadata.touchService(serviceId);

      // Clear caches again to ensure UI picks up fresh data
      this.invalidateCachesForService(serviceId, 'rehydration_complete');

      result.success = true;

      // Output detailed rehydration stats
      console.log(`[DataService] ═══════════════════════════════════════════════════`);
      console.log(`[DataService] 🔄 REHYDRATION COMPLETE for service: ${serviceId}`);
      console.log(`[DataService] ═══════════════════════════════════════════════════`);
      console.log(`[DataService] 📊 Data Restored from Server:`);
      console.log(`[DataService]    - Visuals: ${result.restored.visuals}`);
      console.log(`[DataService]    - EFE Rooms: ${result.restored.efeRooms}`);
      console.log(`[DataService]    - Visual Attachments: ${result.restored.visualAttachments}`);
      console.log(`[DataService]    - EFE Attachments: ${result.restored.efeAttachments}`);
      console.log(`[DataService]    - Total Items: ${result.restored.visuals + result.restored.efeRooms + result.restored.visualAttachments + result.restored.efeAttachments}`);
      console.log(`[DataService] ═══════════════════════════════════════════════════`);

    } catch (err) {
      result.error = err instanceof Error ? err.message : 'Unknown error during rehydration';
      console.error('[DataService] Rehydration failed:', err);
    }

    return result;
  }

  /**
   * Create a LocalImage record from a server attachment
   * Used during rehydration to restore photo references
   */
  private async createLocalImageFromAttachment(
    serviceId: string,
    entityType: 'visual' | 'efe_point' | 'hud',
    attachment: any
  ): Promise<void> {
    const attachId = attachment.AttachID || attachment.PK_ID;
    let entityId: string;
    if (entityType === 'visual') {
      entityId = String(attachment.VisualID || attachment.visualId);
    } else if (entityType === 'hud') {
      entityId = String(attachment.HUDID || attachment.hudId);
    } else {
      entityId = String(attachment.PointID || attachment.pointId);
    }
    const photoUrl = attachment.Photo || attachment.Attachment;
    const caption = attachment.Caption || '';

    if (!attachId || !entityId) {
      console.warn('[DataService] Skipping attachment - missing IDs:', attachment);
      return;
    }

    // Check if LocalImage already exists for this attachId
    const existing = await db.localImages
      .where('attachId')
      .equals(String(attachId))
      .first();

    if (existing) {
      console.log(`[DataService] LocalImage already exists for attachId: ${attachId}`);
      return;
    }

    const now = Date.now();
    const imageId = `rehydrated_${attachId}_${now}`;

    const localImage: LocalImage = {
      imageId,
      entityType: entityType,
      entityId,
      serviceId,
      localBlobId: null,  // No local blob - will load from S3
      thumbBlobId: null,
      remoteS3Key: photoUrl || null,
      status: 'verified',
      attachId: String(attachId),
      isSynced: true,
      remoteUrl: photoUrl || null,
      fileName: `photo_${attachId}.jpg`,
      fileSize: 0,
      contentType: 'image/jpeg',
      caption,
      drawings: attachment.Drawings || '',
      photoType: attachment.PhotoType || null,
      createdAt: now,
      updatedAt: now,
      lastError: null,
      localVersion: 1,
      remoteVerifiedAt: now,
      remoteLoadedInUI: false
    };

    await db.localImages.add(localImage);
    console.log(`[DataService] Created LocalImage for attachment: ${attachId}`);
  }

  /**
   * Check if a service needs rehydration (is in PURGED or ARCHIVED state)
   */
  async needsRehydration(serviceId: string): Promise<boolean> {
    const metadata = await this.serviceMetadata.getServiceMetadata(serviceId);
    if (!metadata) {
      return false; // New service, doesn't need rehydration
    }
    return metadata.purgeState === 'PURGED' || metadata.purgeState === 'ARCHIVED';
  }
}
