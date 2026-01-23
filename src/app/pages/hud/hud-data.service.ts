import { Injectable, OnDestroy } from '@angular/core';
import { firstValueFrom, Subscription } from 'rxjs';
import { CaspioService } from '../../services/caspio.service';
import { PlatformDetectionService } from '../../services/platform-detection.service';
import { HudFieldRepoService } from './services/hud-field-repo.service';
import { HudOperationsQueueService } from './services/hud-operations-queue.service';
import { LocalImageService } from '../../services/local-image.service';
import { BackgroundSyncService, HudSyncComplete, HudPhotoUploadComplete } from '../../services/background-sync.service';
import { IndexedDbService } from '../../services/indexed-db.service';
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

  // Subscriptions for mobile sync events
  private syncSubscription: Subscription | null = null;
  private photoSyncSubscription: Subscription | null = null;

  constructor(
    private readonly caspioService: CaspioService,
    private readonly platform: PlatformDetectionService,
    private readonly hudFieldRepo: HudFieldRepoService,
    private readonly hudOpsQueue: HudOperationsQueueService,
    private readonly localImageService: LocalImageService,
    private readonly backgroundSync: BackgroundSyncService,
    private readonly indexedDb: IndexedDbService
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
   * When sync completes, clear relevant caches so fresh data is loaded
   */
  private subscribeToSyncEvents(): void {
    // Only subscribe on mobile
    if (!this.isMobile()) {
      return;
    }

    console.log('[HUD Data] Mobile mode - subscribing to sync events for cache invalidation');

    // Subscribe to HUD sync complete events
    this.syncSubscription = this.backgroundSync.hudSyncComplete$.subscribe(
      (event: HudSyncComplete) => {
        console.log('[HUD Data] Sync complete event received:', event.operation, 'for', event.fieldKey);

        // Clear cache for the affected service
        this.hudCache.delete(event.serviceId);

        // Mark section dirty for smart reload
        const category = event.fieldKey.split(':')[1];
        if (category) {
          this.backgroundSync.markSectionDirty(`${event.serviceId}_${category}`);
        }
      }
    );

    // Subscribe to HUD photo upload complete events
    this.photoSyncSubscription = this.backgroundSync.hudPhotoUploadComplete$.subscribe(
      (event: HudPhotoUploadComplete) => {
        console.log('[HUD Data] Photo upload complete event received:', event.imageId);

        // Clear attachment cache for this HUD
        this.hudAttachmentsCache.delete(event.hudId);
      }
    );
  }

  /**
   * Unsubscribe from sync events
   */
  private unsubscribeFromSyncEvents(): void {
    if (this.syncSubscription) {
      this.syncSubscription.unsubscribe();
      this.syncSubscription = null;
    }
    if (this.photoSyncSubscription) {
      this.photoSyncSubscription.unsubscribe();
      this.photoSyncSubscription = null;
    }
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

  async getVisualAttachments(hudId: string | number): Promise<any[]> {
    if (!hudId) {
      return [];
    }
    const key = String(hudId);
    return this.resolveWithCache(this.hudAttachmentsCache, key, () =>
      firstValueFrom(this.caspioService.getServiceHUDAttachByHUDId(String(hudId)))
    );
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
}
