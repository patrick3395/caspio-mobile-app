import { Injectable } from '@angular/core';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { CaspioService } from '../../services/caspio.service';
import { IndexedDbService } from '../../services/indexed-db.service';
import { TempIdService } from '../../services/temp-id.service';
import { BackgroundSyncService } from '../../services/background-sync.service';
import { OfflineDataCacheService } from '../../services/offline-data-cache.service';
import { OfflineTemplateService } from '../../services/offline-template.service';
import { OfflineService } from '../../services/offline.service';

interface CacheEntry<T> {
  value: Promise<T>;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class EngineersFoundationDataService {
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

  constructor(
    private readonly caspioService: CaspioService,
    private readonly indexedDb: IndexedDbService,
    private readonly tempId: TempIdService,
    private readonly backgroundSync: BackgroundSyncService,
    private readonly offlineCache: OfflineDataCacheService,
    private readonly offlineTemplate: OfflineTemplateService,
    private readonly offlineService: OfflineService
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
    this.syncSubscriptions.push(
      this.backgroundSync.photoUploadComplete$.subscribe(event => {
        console.log('[DataService] Photo synced, invalidating attachment caches');
        this.visualAttachmentsCache.clear();
        this.efeAttachmentsCache.clear();
        this.imageCache.clear();
        this.cacheInvalidated$.next({ reason: 'photo_sync' });
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
        this.cacheInvalidated$.next({ serviceId: event.serviceId, reason: 'service_data_sync' });
      })
    );

    // When EFE room syncs, clear EFE caches
    this.syncSubscriptions.push(
      this.backgroundSync.efeRoomSyncComplete$.subscribe(event => {
        console.log('[DataService] EFE room synced, invalidating EFE caches');
        this.efePointsCache.clear();
        this.efeAttachmentsCache.clear();
        this.cacheInvalidated$.next({ reason: 'efe_room_sync' });
      })
    );

    // When EFE point syncs, clear point caches
    this.syncSubscriptions.push(
      this.backgroundSync.efePointSyncComplete$.subscribe(event => {
        console.log('[DataService] EFE point synced, invalidating point caches');
        this.efePointsCache.clear();
        this.efeAttachmentsCache.clear();
        this.cacheInvalidated$.next({ reason: 'efe_point_sync' });
      })
    );
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
    
    // Emit event so pages can reload
    this.cacheInvalidated$.next({ serviceId, reason });
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

  async getVisualAttachments(visualId: string | number): Promise<any[]> {
    if (!visualId) {
      return [];
    }
    console.log('[Visual Data] Loading attachments for VisualID:', visualId);

    // OFFLINE-FIRST: Use OfflineTemplateService which reads from IndexedDB
    const attachments = await this.offlineTemplate.getVisualAttachments(visualId);
    console.log('[Visual Data] Loaded attachments:', attachments.length, '(from IndexedDB + API fallback)');

    return attachments;
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

    // OFFLINE-FIRST: Use OfflineTemplateService which reads from IndexedDB
    const ids = Array.isArray(pointIds) ? pointIds : [pointIds];
    const allAttachments: any[] = [];

    for (const pointId of ids) {
      const attachments = await this.offlineTemplate.getEFEPointAttachments(pointId);
      allAttachments.push(...attachments);
    }

    console.log('[EFE Data] Loaded attachments for', ids.length, 'points:', allAttachments.length, '(from IndexedDB + API fallback)');
    return allAttachments;
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
    console.log('[Visual Data] Creating new visual (OFFLINE-FIRST):', visualData);

    // Generate temporary ID
    const tempId = this.tempId.generateTempId('visual');

    // Create placeholder for immediate UI
    const placeholder = {
      ...visualData,
      VisualID: tempId,
      PK_ID: tempId,
      _tempId: tempId,
      _localOnly: true,
      _syncing: true,
      _createdAt: Date.now(),
    };

    // CRITICAL: Add to IndexedDB visuals cache immediately so it shows up on page reload
    const serviceId = String(visualData.ServiceID);
    if (serviceId) {
      const existingVisuals = await this.indexedDb.getCachedServiceData(serviceId, 'visuals') || [];
      existingVisuals.push(placeholder);
      await this.indexedDb.cacheServiceData(serviceId, 'visuals', existingVisuals);
      console.log('[Visual Data] Added visual to IndexedDB cache:', tempId);
    }

    // Store in IndexedDB for background sync
    await this.indexedDb.addPendingRequest({
      type: 'CREATE',
      tempId: tempId,
      endpoint: '/api/caspio-proxy/tables/LPS_Services_Visuals/records?response=rows',
      method: 'POST',
      data: visualData,
      dependencies: [],
      status: 'pending',
      priority: 'high',
    });

    // Clear in-memory cache (not IndexedDB)
    if (visualData.ServiceID) {
      this.visualsCache.delete(String(visualData.ServiceID));
    }

    // Trigger background sync
    this.backgroundSync.triggerSync();

    console.log('[Visual Data] Visual saved with temp ID:', tempId);

    // Return placeholder immediately
    return placeholder;
  }

  async updateVisual(visualId: string, visualData: any, serviceId?: string): Promise<any> {
    console.log('[Visual Data] Updating visual (OFFLINE-FIRST):', visualId, visualData);
    
    const isTempId = String(visualId).startsWith('temp_');
    
    // OFFLINE-FIRST: Update IndexedDB cache immediately, queue for sync
    if (serviceId) {
      await this.offlineTemplate.updateVisual(visualId, visualData, serviceId);
    } else {
      // If no serviceId, still queue for sync but skip cache update
      if (!isTempId) {
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `LPS_Services_Visuals/${visualId}`,
          method: 'PUT',
          data: visualData,
          dependencies: [],
          status: 'pending',
          priority: 'normal',
        });
        console.log('[Visual Data] Queued update for sync:', visualId);
      }
    }

    // Clear in-memory cache
    this.visualsCache.clear();

    // Trigger background sync
    this.backgroundSync.triggerSync();

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
      await this.indexedDb.addPendingRequest({
        type: 'DELETE',
        endpoint: `LPS_Services_Visuals/${visualId}`,
        method: 'DELETE',
        data: { visualId },
        dependencies: [],
        status: 'pending',
        priority: 'normal',
      });
      console.log('[Visual Data] Queued delete for sync:', visualId);
      
      // Remove from IndexedDB cache if we have serviceId
      if (serviceId) {
        const existingVisuals = await this.indexedDb.getCachedServiceData(serviceId, 'visuals') || [];
        const filteredVisuals = existingVisuals.filter((v: any) => 
          String(v.PK_ID) !== String(visualId) && String(v.VisualID) !== String(visualId)
        );
        await this.indexedDb.cacheServiceData(serviceId, 'visuals', filteredVisuals);
      }
    }

    // Clear in-memory cache
    this.visualsCache.clear();

    // Trigger background sync
    this.backgroundSync.triggerSync();

    return { success: true, visualId };
  }

  // ============================================
  // VISUAL PHOTO METHODS
  // ============================================

  async uploadVisualPhoto(visualId: number | string, file: File, caption: string = '', drawings?: string, originalFile?: File): Promise<any> {
    console.log('[Visual Photo] Uploading photo for VisualID:', visualId);
    
    const visualIdStr = String(visualId);
    const isTempId = visualIdStr.startsWith('temp_');

    // SIMPLE APPROACH: Always store file in IndexedDB first, queue upload
    const tempPhotoId = `temp_photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create object URL for immediate thumbnail
    const objectUrl = URL.createObjectURL(file);
    
    // Check if this exact photo is already queued (prevent duplicates)
    const pending = await this.indexedDb.getPendingRequests();
    const alreadyQueued = pending.some(r => 
      r.type === 'UPLOAD_FILE' &&
      r.endpoint === 'VISUAL_PHOTO_UPLOAD' &&
      r.data.visualId === parseInt(visualIdStr) &&
      r.data.fileName === file.name &&
      r.status !== 'synced'
    );

    if (alreadyQueued) {
      console.log('[Visual Photo] Photo already queued, skipping duplicate');
      return {
        AttachID: tempPhotoId,
        _thumbnailUrl: objectUrl,
        _duplicate: true,
      };
    }
    
    // Store file in IndexedDB
    await this.indexedDb.storePhotoFile(tempPhotoId, file, visualIdStr, caption);

    if (isTempId) {
      // Visual not synced - queue with dependency
      // Search in both pending and all requests to find the visual's requestId
      const pending = await this.indexedDb.getPendingRequests();
      const allRequests = await this.indexedDb.getAllRequests();
      const visualRequest = [...pending, ...allRequests].find(r => r.tempId === visualIdStr);
      const dependencies = visualRequest ? [visualRequest.requestId] : [];

      if (dependencies.length === 0) {
        console.warn('[Visual Photo] Visual request not found for', visualIdStr, '- photo may sync before visual!');
      } else {
        console.log('[Visual Photo] Photo depends on visual request:', visualRequest?.requestId);
      }

      await this.indexedDb.addPendingRequest({
        type: 'UPLOAD_FILE',
        tempId: tempPhotoId,
        endpoint: 'VISUAL_PHOTO_UPLOAD',
        method: 'POST',
        data: {
          tempVisualId: visualIdStr,
          fileId: tempPhotoId,
          caption: caption || '',
          drawings: drawings || '',
        },
        dependencies: dependencies,
        status: 'pending',
        priority: 'normal',
      });

      console.log('[Visual Photo] Photo queued (waiting for Visual)');

      // Create placeholder with thumbnail
      const placeholder = {
        AttachID: tempPhotoId,
        VisualID: visualIdStr,
        Annotation: caption,
        Photo: objectUrl,  // Show from object URL
        url: objectUrl,
        thumbnailUrl: objectUrl,
        _tempId: tempPhotoId,
        _thumbnailUrl: objectUrl,
        _syncing: true,
        uploading: false,  // Not actively uploading
        queued: true,      // Queued for background sync
        isObjectUrl: true,
      };

      // CRITICAL: Add to IndexedDB attachments cache immediately
      const existingAttachments = await this.indexedDb.getCachedServiceData(visualIdStr, 'visual_attachments') || [];
      existingAttachments.push(placeholder);
      await this.indexedDb.cacheServiceData(visualIdStr, 'visual_attachments', existingAttachments);
      console.log('[Visual Photo] Added photo to IndexedDB cache:', tempPhotoId);

      return placeholder;
    }

    // Visual has real ID - upload now
    const visualIdNum = parseInt(visualIdStr, 10);
    
    try {
      const result = await firstValueFrom(
        this.caspioService.createServicesVisualsAttachWithFile(visualIdNum, caption, file, drawings, originalFile)
      );

      // Success - DON'T delete file yet (background sync might need it)
      console.log('[Visual Photo] Upload succeeded');

      // CRITICAL: Add to IndexedDB attachments cache immediately
      const existingAttachments = await this.indexedDb.getCachedServiceData(visualIdStr, 'visual_attachments') || [];
      existingAttachments.push(result);
      await this.indexedDb.cacheServiceData(visualIdStr, 'visual_attachments', existingAttachments);
      console.log('[Visual Photo] Added uploaded photo to IndexedDB cache');

      // Clear in-memory cache
      this.visualAttachmentsCache.delete(visualIdStr);

      return result;
    } catch (error) {
      // Failed - keep in IndexedDB, queue for retry
      const idempotencyKey = `photo_upload_${visualIdNum}_${file.name}_${file.size}`;
      
      await this.indexedDb.addPendingRequest({
        type: 'UPLOAD_FILE',
        tempId: tempPhotoId,
        endpoint: 'VISUAL_PHOTO_UPLOAD',
        method: 'POST',
        data: {
          visualId: visualIdNum,
          fileId: tempPhotoId,
          caption: caption || '',
          drawings: drawings || '',
          fileName: file.name,
          fileSize: file.size,
          idempotencyKey: idempotencyKey,
        },
        dependencies: [],
        status: 'pending',
        priority: 'high',
      });

      console.log('[Visual Photo] Upload failed, queued for retry');
      
      // Create placeholder
      const placeholder = {
        AttachID: tempPhotoId,
        VisualID: visualIdStr,
        Photo: objectUrl,
        url: objectUrl,
        thumbnailUrl: objectUrl,
        _thumbnailUrl: objectUrl,
        _syncing: true,
        uploading: false,  // Saved to IndexedDB, not actively uploading
        queued: true,      // Will upload in background
        isObjectUrl: true,
      };

      // CRITICAL: Add to IndexedDB attachments cache immediately
      const existingAttachments = await this.indexedDb.getCachedServiceData(visualIdStr, 'visual_attachments') || [];
      existingAttachments.push(placeholder);
      await this.indexedDb.cacheServiceData(visualIdStr, 'visual_attachments', existingAttachments);
      console.log('[Visual Photo] Added photo to IndexedDB cache:', tempPhotoId);

      return placeholder;
    }
  }

  async deleteVisualPhoto(attachId: string): Promise<any> {
    console.log('[Visual Photo] Deleting photo:', attachId);
    const result = await firstValueFrom(this.caspioService.deleteServiceVisualsAttach(attachId));

    // Clear all attachment caches since we don't know which visual this belongs to
    this.visualAttachmentsCache.clear();

    return result;
  }

  async updateVisualPhotoCaption(attachId: string, caption: string): Promise<any> {
    console.log('[Visual Photo] Updating caption for AttachID:', attachId);
    const result = await firstValueFrom(
      this.caspioService.updateServicesVisualsAttach(attachId, { Annotation: caption })
    );

    // Clear all attachment caches
    this.visualAttachmentsCache.clear();

    return result;
  }

  /**
   * Update visual photo attachment (caption + annotations) - OFFLINE-FIRST
   * Updates IndexedDB cache immediately and queues for background sync
   */
  async updateVisualAttachment(attachId: string, visualId: string, updateData: { Annotation?: string; Drawings?: string }): Promise<any> {
    console.log('[Visual Attach] Updating attachment (OFFLINE-FIRST):', attachId, 'for visual:', visualId);
    
    const isTempId = String(attachId).startsWith('temp_');
    
    if (isTempId) {
      console.warn('[Visual Attach] Cannot update temp attachment:', attachId);
      return { success: false, error: 'Cannot update temp attachment' };
    }

    // 1. Update IndexedDB cache immediately
    try {
      const cachedAttachments = await this.indexedDb.getCachedServiceData(visualId, 'visual_attachments') || [];
      const attachIndex = cachedAttachments.findIndex((a: any) => 
        String(a.AttachID) === String(attachId) || String(a.PK_ID) === String(attachId)
      );
      
      if (attachIndex !== -1) {
        // Update the attachment in cache
        cachedAttachments[attachIndex] = {
          ...cachedAttachments[attachIndex],
          ...updateData,
          Annotation: updateData.Annotation !== undefined ? updateData.Annotation : cachedAttachments[attachIndex].Annotation,
          Drawings: updateData.Drawings !== undefined ? updateData.Drawings : cachedAttachments[attachIndex].Drawings,
          _pendingSync: true,
          _updatedAt: Date.now()
        };
        await this.indexedDb.cacheServiceData(visualId, 'visual_attachments', cachedAttachments);
        console.log('[Visual Attach] Updated IndexedDB cache for attachment:', attachId);
      } else {
        console.warn('[Visual Attach] Attachment not found in cache:', attachId);
      }
    } catch (cacheError) {
      console.error('[Visual Attach] Error updating cache:', cacheError);
    }

    // 2. Queue the update for background sync
    const attachIdNum = parseInt(attachId, 10);
    if (!isNaN(attachIdNum)) {
      await this.indexedDb.addPendingRequest({
        type: 'UPDATE',
        endpoint: `/tables/LPS_Services_Visuals_Attach/records?q.where=AttachID=${attachIdNum}`,
        method: 'PUT',
        data: updateData,
        dependencies: [],
        status: 'pending',
        priority: 'normal',
      });
      console.log('[Visual Attach] Queued annotation update for sync:', attachId);
    }

    // 3. Clear in-memory cache
    this.visualAttachmentsCache.clear();

    // 4. Trigger background sync
    this.backgroundSync.triggerSync();

    // 5. Return immediately
    return { success: true, attachId, ...updateData };
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

  /**
   * Update EFE point attachment (caption + annotations) - OFFLINE-FIRST
   * Updates IndexedDB cache immediately and queues for background sync
   */
  async updateEFEPointAttachment(attachId: string, pointId: string, updateData: { Annotation?: string; Drawings?: string }): Promise<any> {
    console.log('[EFE Attach] Updating attachment (OFFLINE-FIRST):', attachId, 'for point:', pointId);
    
    const isTempId = String(attachId).startsWith('temp_');
    
    if (isTempId) {
      console.warn('[EFE Attach] Cannot update temp attachment:', attachId);
      return { success: false, error: 'Cannot update temp attachment' };
    }

    // 1. Update IndexedDB cache immediately
    try {
      const cachedAttachments = await this.indexedDb.getCachedServiceData(pointId, 'efe_point_attachments') || [];
      const attachIndex = cachedAttachments.findIndex((a: any) => 
        String(a.AttachID) === String(attachId) || String(a.PK_ID) === String(attachId)
      );
      
      if (attachIndex !== -1) {
        // Update the attachment in cache
        cachedAttachments[attachIndex] = {
          ...cachedAttachments[attachIndex],
          ...updateData,
          Annotation: updateData.Annotation !== undefined ? updateData.Annotation : cachedAttachments[attachIndex].Annotation,
          Drawings: updateData.Drawings !== undefined ? updateData.Drawings : cachedAttachments[attachIndex].Drawings,
          _pendingSync: true,
          _updatedAt: Date.now()
        };
        await this.indexedDb.cacheServiceData(pointId, 'efe_point_attachments', cachedAttachments);
        console.log('[EFE Attach] Updated IndexedDB cache for attachment:', attachId);
      } else {
        console.warn('[EFE Attach] Attachment not found in cache:', attachId);
      }
    } catch (cacheError) {
      console.error('[EFE Attach] Error updating cache:', cacheError);
    }

    // 2. Queue the update for background sync
    const attachIdNum = parseInt(attachId, 10);
    if (!isNaN(attachIdNum)) {
      await this.indexedDb.addPendingRequest({
        type: 'UPDATE',
        endpoint: `/tables/LPS_Services_EFE_Points_Attach/records?q.where=AttachID=${attachIdNum}`,
        method: 'PUT',
        data: updateData,
        dependencies: [],
        status: 'pending',
        priority: 'normal',
      });
      console.log('[EFE Attach] Queued annotation update for sync:', attachId);
    }

    // 3. Clear in-memory cache
    this.efeAttachmentsCache.clear();

    // 4. Trigger background sync
    this.backgroundSync.triggerSync();

    // 5. Return immediately
    return { success: true, attachId, ...updateData };
  }

  // ============================================
  // EFE ROOM METHODS (OFFLINE-FIRST)
  // ============================================

  /**
   * Create an EFE room (offline-first pattern)
   * Similar to createVisual() but for EFE records
   */
  async createEFERoom(roomData: any): Promise<any> {
    console.log('[EFE Data] Creating new EFE room (OFFLINE-FIRST):', roomData);

    // Generate temporary ID
    const tempId = this.tempId.generateTempId('efe');
    const serviceId = String(roomData.ServiceID);

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

    // CRITICAL: Add to IndexedDB efe_rooms cache immediately
    const existingRooms = await this.indexedDb.getCachedServiceData(serviceId, 'efe_rooms') || [];
    existingRooms.push(placeholder);
    await this.indexedDb.cacheServiceData(serviceId, 'efe_rooms', existingRooms);
    console.log('[EFE Data] Added room to IndexedDB cache:', tempId);

    // Store in pendingEFEData for immediate display (legacy, kept for compatibility)
    await this.indexedDb.addPendingEFE({
      tempId,
      serviceId: serviceId,
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

    // Trigger background sync
    this.backgroundSync.triggerSync();

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
    console.log('[EFE Data] Creating new EFE point (OFFLINE-FIRST):', pointData);

    // Generate temporary ID
    const tempId = this.tempId.generateTempId('point');

    // Determine parent ID (room's temp or real ID)
    // If roomTempId is provided, use it for both dependencies AND EFEID in the request
    const parentId = roomTempId || String(pointData.EFEID);

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

    // CRITICAL: Add to IndexedDB efe_points cache immediately
    const existingPoints = await this.indexedDb.getCachedServiceData(parentId, 'efe_points') || [];
    existingPoints.push(placeholder);
    await this.indexedDb.cacheServiceData(parentId, 'efe_points', existingPoints);
    console.log('[EFE Data] Added point to IndexedDB cache:', tempId);

    // Store in pendingEFEData for immediate display (legacy, kept for compatibility)
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

    // Trigger background sync
    this.backgroundSync.triggerSync();

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
   * Upload EFE point photo (offline-first pattern with point dependency)
   */
  async uploadEFEPointPhoto(pointId: number | string, file: File, photoType: string = 'Measurement', drawings?: string): Promise<any> {
    console.log('[EFE Photo] ========== uploadEFEPointPhoto START ==========');
    console.log('[EFE Photo] Input PointID:', pointId, 'type:', typeof pointId);
    console.log('[EFE Photo] PhotoType:', photoType, 'Drawings length:', drawings?.length || 0);

    const pointIdStr = String(pointId);
    const isTempId = pointIdStr.startsWith('temp_');
    const isActuallyOffline = !this.offlineService.isOnline();
    
    console.log('[EFE Photo] pointIdStr:', pointIdStr);
    console.log('[EFE Photo] isTempId:', isTempId);
    console.log('[EFE Photo] isActuallyOffline:', isActuallyOffline);

    // Generate temp photo ID
    const tempPhotoId = `temp_efe_photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create object URL for immediate thumbnail
    const objectUrl = URL.createObjectURL(file);

    // Store file in IndexedDB with correct pointId
    console.log('[EFE Photo] Storing in IndexedDB with pointId:', pointIdStr);
    await this.indexedDb.storeEFEPhotoFile(tempPhotoId, file, pointIdStr, photoType, drawings);

    if (isTempId) {
      // Point not synced - queue with dependency
      // Search in both pending and all requests (in case point was created earlier)
      const pending = await this.indexedDb.getPendingRequests();
      const allRequests = await this.indexedDb.getAllRequests();
      const pointRequest = [...pending, ...allRequests].find(r => r.tempId === pointIdStr);
      const dependencies = pointRequest ? [pointRequest.requestId] : [];
      
      if (dependencies.length === 0) {
        console.warn('[EFE Photo] Point request not found for', pointIdStr, '- photo may sync before point!');
      } else {
        console.log('[EFE Photo] Photo depends on point request:', pointRequest?.requestId);
      }

      await this.indexedDb.addPendingRequest({
        type: 'UPLOAD_FILE',
        tempId: tempPhotoId,
        endpoint: 'EFE_POINT_PHOTO_UPLOAD',
        method: 'POST',
        data: {
          tempPointId: pointIdStr,
          fileId: tempPhotoId,
          photoType: photoType || 'Measurement',
          drawings: drawings || '',
        },
        dependencies: dependencies,
        status: 'pending',
        priority: 'normal',
      });

      console.log('[EFE Photo] Photo queued (waiting for Point):', tempPhotoId);

      // Create placeholder with thumbnail
      const placeholder = {
        AttachID: tempPhotoId,
        PointID: pointIdStr,
        Type: photoType,
        Photo: objectUrl,
        url: objectUrl,
        thumbnailUrl: objectUrl,
        _tempId: tempPhotoId,
        _thumbnailUrl: objectUrl,
        _syncing: true,
        uploading: false,
        queued: true,
        isObjectUrl: true,
        isEFE: true,
      };

      // CRITICAL: Add to IndexedDB cache immediately
      const existingAttachments = await this.indexedDb.getCachedServiceData(pointIdStr, 'efe_point_attachments') || [];
      existingAttachments.push(placeholder);
      await this.indexedDb.cacheServiceData(pointIdStr, 'efe_point_attachments', existingAttachments);
      console.log('[EFE Photo] Added photo to IndexedDB cache:', tempPhotoId);

      return placeholder;
    }

    // Point has real ID - check if we should try to upload now or queue
    const pointIdNum = parseInt(pointIdStr, 10);
    console.log('[EFE Photo] Real PointID:', pointIdNum, 'isActuallyOffline:', isActuallyOffline);

    // If we're offline, skip the API call and queue directly
    if (isActuallyOffline) {
      console.log('[EFE Photo] Offline - queueing directly without API attempt');
      
      await this.indexedDb.addPendingRequest({
        type: 'UPLOAD_FILE',
        tempId: tempPhotoId,
        endpoint: 'EFE_POINT_PHOTO_UPLOAD',
        method: 'POST',
        data: {
          pointId: pointIdNum,  // Real point ID
          fileId: tempPhotoId,
          photoType: photoType || 'Measurement',
          drawings: drawings || '',
          fileName: file.name,
          fileSize: file.size,
        },
        dependencies: [],
        status: 'pending',
        priority: 'high',
      });

      console.log('[EFE Photo] ✅ Queued for offline sync with real PointID:', pointIdNum);

      // Create placeholder with queued state
      const placeholder = {
        AttachID: tempPhotoId,
        PointID: pointIdNum,
        Type: photoType,
        Photo: objectUrl,
        url: objectUrl,
        thumbnailUrl: objectUrl,
        _tempId: tempPhotoId,
        _thumbnailUrl: objectUrl,
        _syncing: true,
        uploading: false,
        queued: true,
        isObjectUrl: true,
        isEFE: true,
      };

      // CRITICAL: Add to IndexedDB cache immediately
      const existingAttachments = await this.indexedDb.getCachedServiceData(pointIdStr, 'efe_point_attachments') || [];
      existingAttachments.push(placeholder);
      await this.indexedDb.cacheServiceData(pointIdStr, 'efe_point_attachments', existingAttachments);
      console.log('[EFE Photo] Added photo to IndexedDB cache:', tempPhotoId);

      return placeholder;
    }

    // Online - try to upload now
    try {
      console.log('[EFE Photo] Online - attempting direct upload for PointID:', pointIdNum);
      const result = await firstValueFrom(
        this.caspioService.createServicesEFEPointsAttachWithFile(pointIdNum, drawings || '', file, photoType)
      );

      // Success - delete stored file
      await this.indexedDb.deleteStoredFile(tempPhotoId);

      // CRITICAL: Add to IndexedDB cache immediately
      const existingAttachments = await this.indexedDb.getCachedServiceData(pointIdStr, 'efe_point_attachments') || [];
      existingAttachments.push(result);
      await this.indexedDb.cacheServiceData(pointIdStr, 'efe_point_attachments', existingAttachments);

      // Clear in-memory cache
      this.efeAttachmentsCache.clear();

      console.log('[EFE Photo] Upload succeeded, added to IndexedDB cache');
      return result;
    } catch (error) {
      // Failed - keep in IndexedDB, queue for retry
      console.log('[EFE Photo] Upload failed, queueing for retry with PointID:', pointIdNum);
      
      await this.indexedDb.addPendingRequest({
        type: 'UPLOAD_FILE',
        tempId: tempPhotoId,
        endpoint: 'EFE_POINT_PHOTO_UPLOAD',
        method: 'POST',
        data: {
          pointId: pointIdNum,  // Real point ID (not temp)
          fileId: tempPhotoId,
          photoType: photoType || 'Measurement',
          drawings: drawings || '',
          fileName: file.name,
          fileSize: file.size,
        },
        dependencies: [],
        status: 'pending',
        priority: 'high',
      });

      console.log('[EFE Photo] ✅ Queued for retry with pointId:', pointIdNum);

      // Create placeholder
      const placeholder = {
        AttachID: tempPhotoId,
        PointID: pointIdStr,
        Type: photoType,
        Photo: objectUrl,
        url: objectUrl,
        thumbnailUrl: objectUrl,
        _tempId: tempPhotoId,
        _thumbnailUrl: objectUrl,
        _syncing: true,
        uploading: false,
        queued: true,
        isObjectUrl: true,
        isEFE: true,
      };

      // CRITICAL: Add to IndexedDB cache immediately
      const existingAttachments = await this.indexedDb.getCachedServiceData(pointIdStr, 'efe_point_attachments') || [];
      existingAttachments.push(placeholder);
      await this.indexedDb.cacheServiceData(pointIdStr, 'efe_point_attachments', existingAttachments);
      console.log('[EFE Photo] Added photo to IndexedDB cache:', tempPhotoId);

      return placeholder;
    }
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
}
