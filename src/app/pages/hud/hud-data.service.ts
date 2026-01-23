import { Injectable, OnDestroy } from '@angular/core';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { CaspioService } from '../../services/caspio.service';
import { PlatformDetectionService } from '../../services/platform-detection.service';
import { HudFieldRepoService } from './services/hud-field-repo.service';
import { HudOperationsQueueService } from './services/hud-operations-queue.service';
import { LocalImageService } from '../../services/local-image.service';
import { BackgroundSyncService, HudSyncComplete, HudPhotoUploadComplete } from '../../services/background-sync.service';
import { IndexedDbService } from '../../services/indexed-db.service';
import { ServiceMetadataService } from '../../services/service-metadata.service';
import { OfflineService } from '../../services/offline.service';
import { OfflineTemplateService } from '../../services/offline-template.service';
import { compressAnnotationData } from '../../utils/annotation-utils';

interface CacheEntry<T> {
  value: Promise<T>;
  timestamp: number;
}

/**
 * HudDataService - Platform-aware data service for HUD functionality
 *
 * ARCHITECTURE:
 * - MOBILE: Dexie-first approach via HudFieldRepoService
 *   - Reads from local Dexie first, syncs in background
 *   - Write operations queued via HudOperationsQueueService
 *   - Photo uploads via LocalImageService (local-first)
 *   - Subscribes to sync events for cache invalidation
 *
 * - WEBAPP: Direct API calls with 5-minute in-memory cache
 *   - All operations go directly to API
 *   - No Dexie involvement, no queue batching
 *   - Photo uploads go directly to S3
 */
@Injectable({ providedIn: 'root' })
export class HudDataService implements OnDestroy {
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  // In-memory caches for WEBAPP mode
  private projectCache = new Map<string, CacheEntry<any>>();
  private serviceCache = new Map<string, CacheEntry<any>>();
  private typeCache = new Map<string, CacheEntry<any>>();
  private imageCache = new Map<string, CacheEntry<string>>();
  private hudCache = new Map<string, CacheEntry<any[]>>();
  private hudAttachmentsCache = new Map<string, CacheEntry<any[]>>();

  // Event emitted when caches are invalidated - pages should reload their data
  public cacheInvalidated$ = new Subject<{ serviceId?: string; reason: string }>();

  // Subscription array for cleanup (replaces individual syncSubscription/photoSyncSubscription)
  private syncSubscriptions: Subscription[] = [];

  // Debounce timer for cache invalidation to batch multiple sync events into one UI refresh
  private cacheInvalidationTimer: any = null;
  private pendingInvalidationServiceId: string | undefined = undefined;

  constructor(
    private readonly caspioService: CaspioService,
    private readonly platform: PlatformDetectionService,
    private readonly hudFieldRepo: HudFieldRepoService,
    private readonly hudOpsQueue: HudOperationsQueueService,
    private readonly localImageService: LocalImageService,
    private readonly backgroundSync: BackgroundSyncService,
    private readonly indexedDb: IndexedDbService,
    private readonly serviceMetadata: ServiceMetadataService,
    private readonly offlineService: OfflineService,
    private readonly offlineTemplate: OfflineTemplateService
  ) {
    // Subscribe to sync events on mobile for cache invalidation
    this.subscribeToSyncEvents();
  }

  ngOnDestroy(): void {
    this.unsubscribeFromSyncEvents();
  }

  // ============================================================================
  // PLATFORM CHECK HELPERS
  // ============================================================================

  /**
   * Check if running on mobile (uses Dexie-first approach)
   */
  isMobile(): boolean {
    return this.platform.isMobile();
  }

  /**
   * Check if running on webapp (uses direct API calls)
   */
  isWebapp(): boolean {
    return !this.platform.isMobile();
  }

  // ============================================================================
  // SYNC EVENT SUBSCRIPTIONS (MOBILE ONLY)
  // ============================================================================

  /**
   * Subscribe to sync events on mobile for cache invalidation
   * When sync completes, clear relevant caches and emit cacheInvalidated$ (debounced)
   *
   * CRITICAL: Photo sync events do NOT emit cacheInvalidated$ - pages handle directly
   * to avoid race conditions with temp ID updates
   */
  private subscribeToSyncEvents(): void {
    // Only subscribe on mobile
    if (!this.isMobile()) {
      return;
    }

    console.log('[HUD Data] Mobile mode - subscribing to sync events for cache invalidation');

    // Subscribe to HUD sync complete events
    this.syncSubscriptions.push(
      this.backgroundSync.hudSyncComplete$.subscribe((event: HudSyncComplete) => {
        console.log('[HUD Data] Sync complete event received:', event.operation, 'for', event.fieldKey);

        // Clear cache for the affected service
        this.hudCache.delete(event.serviceId);

        // Mark section dirty for smart reload
        const category = event.fieldKey.split(':')[1];
        if (category) {
          this.backgroundSync.markSectionDirty(`${event.serviceId}_${category}`);
        }

        // Debounced emit for page refresh
        this.debouncedCacheInvalidation(event.serviceId, 'hud_sync');
      })
    );

    // CRITICAL: Photo sync - clear caches but DO NOT emit cacheInvalidated$
    // Pages handle hudPhotoUploadComplete$ directly to avoid race conditions
    // Emitting cacheInvalidated$ here causes duplicate photos or lost captions
    this.syncSubscriptions.push(
      this.backgroundSync.hudPhotoUploadComplete$.subscribe((event: HudPhotoUploadComplete) => {
        console.log('[HUD Data] Photo synced, clearing in-memory caches only (no reload trigger)');
        this.hudAttachmentsCache.delete(event.hudId);
        this.imageCache.clear();
        // DO NOT call: this.debouncedCacheInvalidation(...);
        // The page handles hudPhotoUploadComplete$ directly for seamless UI updates
      })
    );

    // Subscribe to background refresh complete (fresh data downloaded in background)
    this.syncSubscriptions.push(
      this.offlineTemplate.backgroundRefreshComplete$.subscribe(event => {
        console.log('[HUD Data] Background refresh complete:', event.dataType, 'for', event.serviceId);

        // Clear the corresponding in-memory cache based on data type
        // HUD uses 'hud_records' and 'hud_attachments' data types
        if (event.dataType === 'visuals' || event.dataType === 'hud_records') {
          this.hudCache.delete(event.serviceId);
          console.log('[HUD Data] Cleared hudCache for', event.serviceId);
        } else if (event.dataType === 'visual_attachments' || event.dataType === 'hud_attachments') {
          this.hudAttachmentsCache.delete(event.serviceId);
          console.log('[HUD Data] Cleared hudAttachmentsCache for', event.serviceId);
        }

        // Debounced emit for page refresh
        this.debouncedCacheInvalidation(event.serviceId, `background_refresh_${event.dataType}`);
      })
    );

    // Subscribe to IndexedDB image changes (real-time UI updates when images created/updated)
    this.syncSubscriptions.push(
      this.indexedDb.imageChange$.subscribe(event => {
        console.log('[HUD Data] IndexedDB image change:', event.action, event.key, 'entity:', event.entityType, event.entityId);

        // Clear attachment caches if this is a HUD image
        if (event.entityType === 'hud') {
          this.hudAttachmentsCache.clear();
        }

        // Debounced emit for page refresh
        this.debouncedCacheInvalidation(event.serviceId, `indexeddb_${event.action}_${event.entityType}`);
      })
    );
  }

  /**
   * Unsubscribe from sync events and clear debounce timer
   */
  private unsubscribeFromSyncEvents(): void {
    this.syncSubscriptions.forEach(sub => sub.unsubscribe());
    this.syncSubscriptions = [];

    if (this.cacheInvalidationTimer) {
      clearTimeout(this.cacheInvalidationTimer);
      this.cacheInvalidationTimer = null;
    }
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
      console.log(`[HUD DataService] Debounced cache invalidation fired (reason: ${reason})`);
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
   * Can also be called directly by pages when manual refresh is needed
   */
  invalidateCachesForService(serviceId: string, reason: string = 'manual'): void {
    console.log(`[HUD DataService] Invalidating all caches for service ${serviceId} (reason: ${reason})`);

    // Clear service-specific caches
    this.hudCache.delete(serviceId);
    this.serviceCache.delete(serviceId);

    // Clear all attachment caches (we don't track by service)
    this.hudAttachmentsCache.clear();
    this.imageCache.clear();

    // Use debounced invalidation to batch rapid sync events
    this.debouncedCacheInvalidation(serviceId, reason);
  }

  // ============================================================================
  // READ OPERATIONS - Platform-aware
  // ============================================================================

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


  async getImage(filePath: string): Promise<string> {
    if (!filePath) {
      return '';
    }
    return this.resolveWithCache(this.imageCache, filePath, () =>
      firstValueFrom(this.caspioService.getImageFromFilesAPI(filePath))
    );
  }

  /**
   * Get HUD records for a service
   *
   * MOBILE: Reads from HudFieldRepo (Dexie) first, API data is synced in background
   * WEBAPP: Direct API call with 5-minute in-memory cache
   */
  async getVisualsByService(serviceId: string, bypassCache: boolean = false): Promise<any[]> {
    if (!serviceId) {
      console.warn('[HUD Data] getVisualsByService called with empty serviceId');
      return [];
    }

    console.log('[HUD Data] Loading HUD records for ServiceID:', serviceId, 'BypassCache:', bypassCache, 'Mobile:', this.isMobile());

    // HUD-019: Track service activity for smart purging
    this.serviceMetadata.touchService(serviceId).catch(() => {});

    // MOBILE PATH: Use Dexie-first approach
    if (this.isMobile()) {
      return this.getVisualsByServiceMobile(serviceId, bypassCache);
    }

    // WEBAPP PATH: Direct API with in-memory cache
    return this.getVisualsByServiceWebapp(serviceId, bypassCache);
  }

  /**
   * MOBILE: Get HUD records from HudFieldRepo (Dexie)
   * Returns data immediately from local storage, background sync handles API updates
   */
  private async getVisualsByServiceMobile(serviceId: string, bypassCache: boolean): Promise<any[]> {
    console.log('[HUD Data] MOBILE: Reading from HudFieldRepo for serviceId:', serviceId);

    // Get all fields for this service from Dexie
    const fields = await this.hudFieldRepo.getFieldsForCategory(serviceId, '');

    // If we have no local data, fall back to API and seed
    if (fields.length === 0 || bypassCache) {
      console.log('[HUD Data] MOBILE: No local data or bypass requested, fetching from API');
      const apiRecords = await firstValueFrom(this.caspioService.getServicesHUDByServiceId(serviceId));

      console.log('[HUD Data] MOBILE: API returned', apiRecords.length, 'records');
      return apiRecords;
    }

    // Transform HudField data to match API response format
    const hudRecords = fields
      .filter(f => f.isSelected && (f.hudId || f.tempHudId))
      .map(field => ({
        PK_ID: field.hudId || field.tempHudId,
        VisualID: field.hudId || field.tempHudId,
        ServiceID: parseInt(serviceId, 10),
        Category: field.category,
        Name: field.templateName,
        Text: field.answer || field.templateText,
        Kind: field.kind,
        Answers: field.answer,
        photoCount: field.photoCount,
        _isLocal: !field.hudId, // Flag indicating this is a local-only record
        _fieldKey: field.key
      }));

    console.log('[HUD Data] MOBILE: Returning', hudRecords.length, 'records from Dexie');
    return hudRecords;
  }

  /**
   * WEBAPP: Get HUD records directly from API with in-memory cache
   */
  private async getVisualsByServiceWebapp(serviceId: string, bypassCache: boolean): Promise<any[]> {
    console.log('[HUD Data] WEBAPP: Loading HUD records from API, bypassCache:', bypassCache);

    // Clear cache if bypass requested
    if (bypassCache) {
      console.log('[HUD Data] WEBAPP: Bypassing cache - clearing cached data');
      this.hudCache.delete(serviceId);
    }

    const hudRecords = await this.resolveWithCache(this.hudCache, serviceId, () =>
      firstValueFrom(this.caspioService.getServicesHUDByServiceId(serviceId))
    );

    console.log('[HUD Data] WEBAPP: API returned', hudRecords.length, 'records');
    if (hudRecords.length > 0) {
      console.log('[HUD Data] WEBAPP: Sample HUD record:', hudRecords[0]);
    }

    return hudRecords;
  }

  /**
   * Get HUD attachments/photos for a specific HUD record
   *
   * MOBILE: Dexie-first approach - reads from LocalImages, merges with API data
   * WEBAPP: Direct API call with in-memory cache
   */
  async getVisualAttachments(hudId: string | number): Promise<any[]> {
    if (!hudId) {
      return [];
    }
    const hudIdStr = String(hudId);
    console.log('[HUD Data] Loading attachments for HUDID:', hudIdStr, 'Mobile:', this.isMobile());

    // WEBAPP MODE: Return only server data (no local images)
    if (this.isWebapp()) {
      console.log('[HUD Data] WEBAPP MODE: Loading attachments from server only');
      return this.resolveWithCache(this.hudAttachmentsCache, hudIdStr, () =>
        firstValueFrom(this.caspioService.getServiceHUDAttachByHUDId(hudIdStr))
      );
    }

    // MOBILE MODE: OFFLINE-FIRST pattern
    // Get server attachments first (may be empty if offline)
    let serverAttachments: any[] = [];
    try {
      serverAttachments = await firstValueFrom(this.caspioService.getServiceHUDAttachByHUDId(hudIdStr));
    } catch (err) {
      console.log('[HUD Data] MOBILE: API call failed (may be offline), using local data only');
    }

    // NEW LOCAL-FIRST: Get local images for this HUD from LocalImageService
    const localImages = await this.localImageService.getImagesForEntity('hud', hudIdStr);

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
        HUDID: img.entityId,
        entityId: img.entityId,
        entityType: img.entityType,
        serviceId: img.serviceId,

        // Content
        Annotation: img.caption,
        caption: img.caption,
        Drawings: img.drawings,
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

    // Filter server attachments to exclude any that have been migrated to new system
    // (match by AttachID to imageId or attachId)
    const filteredServer = serverAttachments.filter((att: any) => {
      const attId = String(att.AttachID || att.attachId || '');
      // Keep if not in local images (by attachId match)
      return !localImages.some(img => img.attachId === attId);
    });

    // Merge: local-first images first (most recent), then server
    const merged = [...localAttachments, ...filteredServer];

    console.log('[HUD Data] Loaded attachments (mobile):', merged.length,
      `(${localAttachments.length} local-first + ${filteredServer.length} server)`);

    return merged;
  }

  /**
   * Get HUD attachments optimized for PDF generation
   * Includes pending caption/annotation changes from IndexedDB
   *
   * MOBILE: Merges LocalImages + server data + pending captions
   * WEBAPP: Direct API call
   */
  async getVisualAttachmentsForPdf(hudId: string | number): Promise<any[]> {
    if (!hudId) {
      return [];
    }
    const hudIdStr = String(hudId);

    // Get base attachments
    const attachments = await this.getVisualAttachments(hudId);

    // MOBILE: Merge pending captions/annotations
    if (this.isMobile() && attachments.length > 0) {
      const attachIds = attachments.map(a => String(a.AttachID || a.attachId || a.imageId));
      const pendingCaptions = await this.indexedDb.getPendingCaptionsForAttachments(attachIds);

      if (pendingCaptions.length > 0) {
        console.log('[HUD Data] Merging', pendingCaptions.length, 'pending captions into PDF attachments');

        // Apply pending changes to attachments
        for (const pending of pendingCaptions) {
          const attachment = attachments.find(a =>
            String(a.AttachID || a.attachId || a.imageId) === pending.attachId
          );
          if (attachment) {
            if (pending.caption !== undefined) {
              attachment.Annotation = pending.caption;
              attachment.caption = pending.caption;
              attachment._hasPendingCaption = true;
            }
            if (pending.drawings !== undefined) {
              attachment.Drawings = pending.drawings;
              attachment.drawings = pending.drawings;
              attachment._hasPendingDrawings = true;
            }
          }
        }
      }
    }

    return attachments;
  }

  // ============================================================================
  // CACHE HELPERS
  // ============================================================================

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

  /**
   * Clear all caches - use when returning to page to force fresh data load
   */
  clearAllCaches(): void {
    console.log('[HUD Data Service] Clearing ALL caches to force fresh data load');

    // Clear in-memory caches in this service
    this.projectCache.clear();
    this.serviceCache.clear();
    this.typeCache.clear();
    this.imageCache.clear();
    this.hudCache.clear();
    this.hudAttachmentsCache.clear();

    // CRITICAL: Also clear the CaspioService's localStorage cache
    // This prevents returning stale cached data from previous page visits
    this.caspioService.clearServicesCache();
  }

  /**
   * Clear specific caches for a service - use when service data changes
   */
  clearServiceCaches(serviceId: string): void {
    console.log('[HUD Data Service] Clearing caches for ServiceID:', serviceId);
    this.hudCache.delete(serviceId);
  }

  // ============================================================================
  // WRITE OPERATIONS - Platform-aware
  // ============================================================================

  /**
   * Create a new HUD record
   *
   * MOBILE: Queues operation via HudOperationsQueueService
   * WEBAPP: Direct API call
   */
  async createVisual(hudData: any): Promise<any> {
    console.log('[HUD Data] Creating HUD record:', hudData, 'Mobile:', this.isMobile());

    // HUD-019: Track service activity for smart purging
    if (hudData.ServiceID) {
      this.serviceMetadata.touchService(String(hudData.ServiceID)).catch(() => {});
    }

    // MOBILE PATH: Queue the operation
    if (this.isMobile()) {
      return this.createVisualMobile(hudData);
    }

    // WEBAPP PATH: Direct API call
    return this.createVisualWebapp(hudData);
  }

  /**
   * MOBILE: Create HUD record via operations queue
   */
  private async createVisualMobile(hudData: any): Promise<any> {
    console.log('[HUD Data] MOBILE: Queueing CREATE_HUD_VISUAL operation');

    const serviceId = String(hudData.ServiceID);
    const category = hudData.Category || '';
    const templateId = hudData.TemplateID || Date.now();

    // Generate a field key for tracking
    const fieldKey = `${serviceId}:${category}:${templateId}`;

    // Update HudFieldRepo to mark the field as selected (write-through)
    await this.hudFieldRepo.setField(serviceId, category, templateId, {
      isSelected: true,
      templateName: hudData.Name,
      templateText: hudData.Text,
      answer: hudData.Text || hudData.Answers || '',
      kind: hudData.Kind || 'Comment'
    });

    // Queue the create operation
    const opId = await this.hudOpsQueue.enqueueCreateHudVisual(
      serviceId,
      category,
      templateId,
      hudData,
      fieldKey
    );

    // Return a temporary response immediately
    return {
      PK_ID: opId, // Temp ID
      VisualID: opId,
      _tempId: opId,
      _pending: true,
      ...hudData
    };
  }

  /**
   * WEBAPP: Create HUD record via direct API call
   */
  private async createVisualWebapp(hudData: any): Promise<any> {
    console.log('[HUD Data] WEBAPP: Creating HUD record via API');

    const result = await firstValueFrom(
      this.caspioService.createServicesHUD(hudData)
    );

    // Clear cache for this service
    if (hudData.ServiceID) {
      this.hudCache.delete(String(hudData.ServiceID));
    }

    return result;
  }

  /**
   * Update an existing HUD record
   *
   * MOBILE: Queues operation via HudOperationsQueueService
   * WEBAPP: Direct API call
   */
  async updateVisual(hudId: string, updateData: any, fieldKey?: string): Promise<any> {
    console.log('[HUD Data] Updating HUD record:', hudId, 'Data:', updateData, 'Mobile:', this.isMobile());

    // MOBILE PATH: Queue the operation
    if (this.isMobile() && fieldKey) {
      return this.updateVisualMobile(hudId, updateData, fieldKey);
    }

    // WEBAPP PATH: Direct API call
    return this.updateVisualWebapp(hudId, updateData);
  }

  /**
   * MOBILE: Update HUD record via operations queue
   */
  private async updateVisualMobile(hudId: string, updateData: any, fieldKey: string): Promise<any> {
    console.log('[HUD Data] MOBILE: Queueing UPDATE_HUD_VISUAL operation');

    // Update HudFieldRepo immediately (write-through)
    const [serviceId, category, templateIdStr] = fieldKey.split(':');
    const templateId = parseInt(templateIdStr, 10);

    const patch: any = {};
    if (updateData.Text !== undefined) patch.answer = updateData.Text;
    if (updateData.Answers !== undefined) patch.answer = updateData.Answers;

    await this.hudFieldRepo.setField(serviceId, category, templateId, patch);

    // Queue the update operation
    await this.hudOpsQueue.enqueueUpdateHudVisual(
      hudId,
      updateData,
      fieldKey
    );

    return { success: true, _pending: true };
  }

  /**
   * WEBAPP: Update HUD record via direct API call
   */
  private async updateVisualWebapp(hudId: string, updateData: any): Promise<any> {
    console.log('[HUD Data] WEBAPP: Updating HUD record via API');

    const result = await firstValueFrom(
      this.caspioService.updateServicesHUD(hudId, updateData)
    );

    // Clear cache
    this.hudAttachmentsCache.clear();

    return result;
  }

  // ============================================================================
  // PHOTO OPERATIONS - Platform-aware
  // ============================================================================

  /**
   * Upload a photo for a HUD record
   *
   * MOBILE: Uses LocalImageService for local-first storage, then queues upload
   * WEBAPP: Direct upload to API
   */
  async uploadVisualPhoto(
    hudId: number,
    file: File,
    caption: string = '',
    drawings?: string,
    originalFile?: File,
    fieldKey?: string
  ): Promise<any> {
    console.log('[HUD Photo] Uploading photo for HUDID:', hudId, 'Mobile:', this.isMobile());

    // HUD-019: Track service activity for smart purging (extract serviceId from fieldKey)
    if (fieldKey) {
      const serviceId = fieldKey.split(':')[0];
      if (serviceId) {
        this.serviceMetadata.touchService(serviceId).catch(() => {});
      }
    }

    // MOBILE PATH: Local-first via LocalImageService
    if (this.isMobile() && fieldKey) {
      return this.uploadVisualPhotoMobile(hudId, file, caption, drawings, fieldKey);
    }

    // WEBAPP PATH: Direct upload
    return this.uploadVisualPhotoWebapp(hudId, file, caption, drawings, originalFile);
  }

  /**
   * MOBILE: Store photo locally first, then queue for upload
   */
  private async uploadVisualPhotoMobile(
    hudId: number,
    file: File,
    caption: string,
    drawings: string | undefined,
    fieldKey: string
  ): Promise<any> {
    console.log('[HUD Photo] MOBILE: Storing photo locally first');

    const [serviceId] = fieldKey.split(':');

    // Store photo locally via LocalImageService
    const localImage = await this.localImageService.captureImage(
      file,
      'hud',
      String(hudId),
      serviceId,
      caption,
      drawings || ''
    );

    console.log('[HUD Photo] MOBILE: Photo stored locally:', localImage.imageId);

    // Update photo count in HudFieldRepo
    const field = await this.hudFieldRepo.getField(fieldKey);
    if (field) {
      await this.hudFieldRepo.updatePhotoCount(fieldKey, (field.photoCount || 0) + 1);
    }

    // Queue the upload operation (will be processed by HudS3UploadService)
    // The photo is already queued by captureImage when stored in outbox

    // Return immediate response with local image info
    return {
      _localImageId: localImage.imageId,
      _pending: true,
      Result: [{
        AttachID: localImage.imageId,
        _isLocal: true
      }]
    };
  }

  /**
   * WEBAPP: Upload photo directly to API
   */
  private async uploadVisualPhotoWebapp(
    hudId: number,
    file: File,
    caption: string,
    drawings: string | undefined,
    originalFile?: File
  ): Promise<any> {
    console.log('[HUD Photo] WEBAPP: Direct upload to API');

    const result = await firstValueFrom(
      this.caspioService.createServicesHUDAttachWithFile(hudId, caption, file, drawings, originalFile)
    );

    console.log('[HUD Photo] WEBAPP: Upload complete:', JSON.stringify(result, null, 2));

    // Clear attachment cache for this HUD record
    const key = String(hudId);
    this.hudAttachmentsCache.delete(key);

    return result;
  }

  /**
   * Delete a photo attachment
   *
   * Both mobile and webapp use direct API call for deletes
   * (deletes are always immediate, not queued)
   */
  async deleteVisualPhoto(attachId: string): Promise<any> {
    console.log('[HUD Photo] Deleting photo:', attachId);
    const result = await firstValueFrom(this.caspioService.deleteServicesHUDAttach(attachId));

    // Clear all attachment caches
    this.hudAttachmentsCache.clear();

    return result;
  }

  /**
   * Update photo caption
   *
   * HUD-014: Platform-aware caption sync
   * MOBILE: Queue caption update for background sync via pendingCaptions table
   * WEBAPP: Direct API call for immediate persistence
   */
  async updateVisualPhotoCaption(
    attachId: string,
    caption: string,
    metadata: { serviceId?: string; hudId?: string } = {}
  ): Promise<any> {
    console.log('[HUD Photo] Updating caption for AttachID:', attachId, 'Mobile:', this.isMobile());

    // Check if this is a temp/local ID that hasn't synced yet
    const isTempId = String(attachId).startsWith('temp_') ||
                     String(attachId).startsWith('img_') ||
                     String(attachId).includes('-');

    // MOBILE PATH: Queue caption update for background sync
    if (this.isMobile()) {
      console.log('[HUD Photo] MOBILE: Queueing caption update for background sync');

      const captionId = await this.indexedDb.queueCaptionUpdate({
        attachId,
        attachType: 'visual',
        caption,
        serviceId: metadata.serviceId,
        visualId: metadata.hudId
      });

      console.log('[HUD Photo] MOBILE: Caption queued:', captionId);

      // Clear attachment cache so next load merges with pending caption
      this.hudAttachmentsCache.clear();

      return { captionId, queued: true };
    }

    // WEBAPP PATH: Direct API call (unless temp ID)
    if (isTempId) {
      console.log('[HUD Photo] WEBAPP: Temp ID detected, queueing for later sync');
      const captionId = await this.indexedDb.queueCaptionUpdate({
        attachId,
        attachType: 'visual',
        caption,
        serviceId: metadata.serviceId,
        visualId: metadata.hudId
      });
      return { captionId, queued: true };
    }

    console.log('[HUD Photo] WEBAPP: Updating caption directly via API');
    const result = await firstValueFrom(
      this.caspioService.updateServicesHUDAttach(attachId, { Annotation: caption })
    );

    // Clear all attachment caches
    this.hudAttachmentsCache.clear();

    return result;
  }

  /**
   * Update photo annotation (drawings)
   *
   * HUD-014: Platform-aware annotation sync with COMPRESSED_V3 format
   * MOBILE: Queue annotation update for background sync
   * WEBAPP: Direct API call for immediate persistence
   */
  async updateVisualPhotoAnnotation(
    attachId: string,
    drawings: string | object,
    metadata: { serviceId?: string; hudId?: string; caption?: string } = {}
  ): Promise<any> {
    console.log('[HUD Photo] Updating annotation for AttachID:', attachId, 'Mobile:', this.isMobile());

    // Compress annotation data using COMPRESSED_V3 format
    let compressedDrawings: string;
    if (typeof drawings === 'string') {
      compressedDrawings = compressAnnotationData(drawings, { emptyResult: '{}' });
    } else {
      compressedDrawings = compressAnnotationData(JSON.stringify(drawings), { emptyResult: '{}' });
    }

    console.log('[HUD Photo] Compressed annotation from',
      typeof drawings === 'string' ? drawings.length : JSON.stringify(drawings).length,
      'to', compressedDrawings.length, 'bytes');

    // Check if this is a temp/local ID
    const isTempId = String(attachId).startsWith('temp_') ||
                     String(attachId).startsWith('img_') ||
                     String(attachId).includes('-');

    // MOBILE PATH: Queue annotation update for background sync
    if (this.isMobile()) {
      console.log('[HUD Photo] MOBILE: Queueing annotation update for background sync');

      const captionId = await this.indexedDb.queueCaptionUpdate({
        attachId,
        attachType: 'visual',
        drawings: compressedDrawings,
        caption: metadata.caption,
        serviceId: metadata.serviceId,
        visualId: metadata.hudId
      });

      console.log('[HUD Photo] MOBILE: Annotation queued:', captionId);

      // Clear attachment cache
      this.hudAttachmentsCache.clear();

      return { captionId, queued: true };
    }

    // WEBAPP PATH: Direct API call (unless temp ID)
    if (isTempId) {
      console.log('[HUD Photo] WEBAPP: Temp ID detected, queueing annotation for later sync');
      const captionId = await this.indexedDb.queueCaptionUpdate({
        attachId,
        attachType: 'visual',
        drawings: compressedDrawings,
        caption: metadata.caption,
        serviceId: metadata.serviceId,
        visualId: metadata.hudId
      });
      return { captionId, queued: true };
    }

    console.log('[HUD Photo] WEBAPP: Updating annotation directly via API');
    const updateData: any = { Drawings: compressedDrawings };
    if (metadata.caption !== undefined) {
      updateData.Annotation = metadata.caption;
    }

    const result = await firstValueFrom(
      this.caspioService.updateServicesHUDAttach(attachId, updateData)
    );

    // Clear all attachment caches
    this.hudAttachmentsCache.clear();

    return result;
  }

  /**
   * Update both caption and annotation together
   *
   * HUD-014: Combines caption and annotation into single queued update
   */
  async updateVisualPhotoCaptionAndAnnotation(
    attachId: string,
    caption: string,
    drawings: string | object,
    metadata: { serviceId?: string; hudId?: string } = {}
  ): Promise<any> {
    console.log('[HUD Photo] Updating caption+annotation for AttachID:', attachId);

    // Compress annotation data using COMPRESSED_V3 format
    let compressedDrawings: string;
    if (typeof drawings === 'string') {
      compressedDrawings = compressAnnotationData(drawings, { emptyResult: '{}' });
    } else {
      compressedDrawings = compressAnnotationData(JSON.stringify(drawings), { emptyResult: '{}' });
    }

    // Check if this is a temp/local ID
    const isTempId = String(attachId).startsWith('temp_') ||
                     String(attachId).startsWith('img_') ||
                     String(attachId).includes('-');

    // MOBILE PATH or temp ID: Queue for background sync
    if (this.isMobile() || isTempId) {
      const platform = this.isMobile() ? 'MOBILE' : 'WEBAPP (temp ID)';
      console.log(`[HUD Photo] ${platform}: Queueing caption+annotation for background sync`);

      const captionId = await this.indexedDb.queueCaptionUpdate({
        attachId,
        attachType: 'visual',
        caption,
        drawings: compressedDrawings,
        serviceId: metadata.serviceId,
        visualId: metadata.hudId
      });

      console.log('[HUD Photo] Caption+annotation queued:', captionId);
      this.hudAttachmentsCache.clear();

      return { captionId, queued: true };
    }

    // WEBAPP PATH: Direct API call
    console.log('[HUD Photo] WEBAPP: Updating caption+annotation directly via API');
    const result = await firstValueFrom(
      this.caspioService.updateServicesHUDAttach(attachId, {
        Annotation: caption,
        Drawings: compressedDrawings
      })
    );

    this.hudAttachmentsCache.clear();
    return result;
  }

  // ============================================================================
  // REHYDRATION - Restore purged HUD service data from server
  // ============================================================================

  /**
   * Check if a HUD service needs rehydration (is in PURGED or ARCHIVED state)
   *
   * Called before opening a HUD service to determine if data needs to be restored.
   *
   * @param serviceId - The HUD service to check
   * @returns true if service needs rehydration, false otherwise
   */
  async needsRehydration(serviceId: string): Promise<boolean> {
    const metadata = await this.serviceMetadata.getServiceMetadata(serviceId);
    if (!metadata) {
      return false; // New service, doesn't need rehydration
    }
    return metadata.purgeState === 'PURGED' || metadata.purgeState === 'ARCHIVED';
  }

  /**
   * Rehydrate a HUD service that was previously purged
   * Fetches fresh data from the server and restores to ACTIVE state
   *
   * HUD services use TypeID=2 - we use HUD-specific API endpoints that filter correctly:
   * - getServicesHUDByServiceId: fetches LPS_Services_HUD records
   * - getServiceHUDAttachByHUDId: fetches LPS_Services_HUD_Attach records
   *
   * Called when user opens a HUD service that's in PURGED or ARCHIVED state.
   * Must be online to rehydrate.
   *
   * @param serviceId - The HUD service to rehydrate
   * @returns Result with success status and counts of restored items
   */
  async rehydrateService(serviceId: string): Promise<{
    success: boolean;
    restored: {
      hudRecords: number;
      hudAttachments: number;
    };
    error?: string;
  }> {
    console.log(`[HUD Data] ═══════════════════════════════════════════════════`);
    console.log(`[HUD Data] REHYDRATION STARTING for HUD service: ${serviceId}`);
    console.log(`[HUD Data] ═══════════════════════════════════════════════════`);

    const result = {
      success: false,
      restored: {
        hudRecords: 0,
        hudAttachments: 0
      },
      error: undefined as string | undefined
    };

    // Must be online to rehydrate
    if (!this.offlineService.isOnline()) {
      result.error = 'Cannot rehydrate while offline. Please connect to the internet.';
      console.warn('[HUD Data] Rehydration failed: offline');
      return result;
    }

    try {
      // Check current purge state
      const metadata = await this.serviceMetadata.getServiceMetadata(serviceId);

      // Log the state before rehydration
      if (metadata) {
        console.log(`[HUD Data] Service State Before Rehydration:`);
        console.log(`[HUD Data]    - Purge State: ${metadata.purgeState}`);
        console.log(`[HUD Data]    - Last Touched: ${new Date(metadata.lastTouchedAt).toLocaleString()}`);
      }

      if (metadata && metadata.purgeState === 'ACTIVE') {
        console.log('[HUD Data] Service already ACTIVE, no rehydration needed');
        result.success = true;
        return result;
      }

      // Clear in-memory caches for this service to force fresh fetch
      this.clearServiceCaches(serviceId);

      // ========== STEP 1: Fetch HUD records from server ==========
      // HUD services use TypeID=2 - we use HUD-specific API endpoints that filter correctly
      console.log('[HUD Data] Step 1: Fetching HUD records from server...');
      const hudRecords = await firstValueFrom(this.caspioService.getServicesHUDByServiceId(serviceId));

      if (hudRecords && Array.isArray(hudRecords) && hudRecords.length > 0) {
        // Cache the raw data
        await this.indexedDb.cacheServiceData(serviceId, 'hud_records', hudRecords);
        result.restored.hudRecords = hudRecords.length;
        console.log(`[HUD Data] Restored ${hudRecords.length} HUD records`);

        // ========== STEP 2: Fetch attachments for each HUD record ==========
        console.log('[HUD Data] Step 2: Fetching HUD attachments...');
        for (const hud of hudRecords) {
          const hudId = hud.PK_ID || hud.HUDID;
          if (hudId) {
            try {
              const attachments = await firstValueFrom(
                this.caspioService.getServiceHUDAttachByHUDId(String(hudId))
              );
              if (attachments && Array.isArray(attachments) && attachments.length > 0) {
                // Cache attachments for this HUD record
                await this.indexedDb.cacheServiceData(serviceId, `hud_attach_${hudId}`, attachments);
                result.restored.hudAttachments += attachments.length;
              }
            } catch (err) {
              console.warn(`[HUD Data] Failed to fetch attachments for HUD ${hudId}:`, err);
            }
          }
        }
        console.log(`[HUD Data] Restored ${result.restored.hudAttachments} HUD attachments`);
      } else {
        console.log('[HUD Data] No HUD records found on server');
      }

      // Update purge state to ACTIVE
      await this.serviceMetadata.setPurgeState(serviceId, 'ACTIVE');
      await this.serviceMetadata.touchService(serviceId);

      // Clear caches again to ensure UI picks up fresh data
      this.clearServiceCaches(serviceId);

      result.success = true;

      // Output detailed rehydration stats
      console.log(`[HUD Data] ═══════════════════════════════════════════════════`);
      console.log(`[HUD Data] REHYDRATION COMPLETE for HUD service: ${serviceId}`);
      console.log(`[HUD Data] ═══════════════════════════════════════════════════`);
      console.log(`[HUD Data] Data Restored from Server:`);
      console.log(`[HUD Data]    - HUD Records: ${result.restored.hudRecords}`);
      console.log(`[HUD Data]    - HUD Attachments: ${result.restored.hudAttachments}`);
      console.log(`[HUD Data]    - Total Items: ${result.restored.hudRecords + result.restored.hudAttachments}`);
      console.log(`[HUD Data] ═══════════════════════════════════════════════════`);

    } catch (err) {
      result.error = err instanceof Error ? err.message : 'Unknown error during rehydration';
      console.error('[HUD Data] Rehydration failed:', err);
    }

    return result;
  }
}
