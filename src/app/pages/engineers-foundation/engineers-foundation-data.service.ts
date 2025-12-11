import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CaspioService } from '../../services/caspio.service';
import { IndexedDbService } from '../../services/indexed-db.service';
import { TempIdService } from '../../services/temp-id.service';
import { BackgroundSyncService } from '../../services/background-sync.service';
import { OfflineDataCacheService } from '../../services/offline-data-cache.service';
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

  constructor(
    private readonly caspioService: CaspioService,
    private readonly indexedDb: IndexedDbService,
    private readonly tempId: TempIdService,
    private readonly backgroundSync: BackgroundSyncService,
    private readonly offlineCache: OfflineDataCacheService,
    private readonly offlineService: OfflineService
  ) {}

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

  async getEFETemplates(forceRefresh = false): Promise<any[]> {
    // Use offline cache for templates (with IndexedDB persistence)
    if (!forceRefresh) {
      // Check in-memory cache first
      if (this.efeTemplatesCache && !this.isExpired(this.efeTemplatesCache.timestamp)) {
        return this.efeTemplatesCache.value;
      }
    }

    // Use OfflineDataCacheService which handles IndexedDB caching
    const templatesPromise = this.offlineCache.getEFETemplates();

    // Update in-memory cache
    this.efeTemplatesCache = { value: templatesPromise, timestamp: Date.now() };

    return templatesPromise;
  }

  /**
   * Get visual templates with offline support
   */
  async getVisualsTemplates(forceRefresh = false): Promise<any[]> {
    // Use offline cache for templates (with IndexedDB persistence)
    return this.offlineCache.getVisualsTemplates();
  }

  async getEFEByService(serviceId: string, forceRefresh = true): Promise<any[]> {
    if (!serviceId) {
      console.warn('[EFE Data] getEFEByService called with empty serviceId');
      return [];
    }
    
    // CRITICAL: Always bypass cache for room data to ensure we get latest changes
    // Room data changes frequently (adding, renaming, deleting rooms)
    if (forceRefresh) {
      console.log('[EFE Data] FORCE REFRESH - Clearing cache and loading fresh rooms for ServiceID:', serviceId);
      // Clear the specific cache in CaspioService for this service's EFE data
      this.caspioService.clearServicesCache();
    } else {
      console.log('[EFE Data] Loading existing rooms for ServiceID:', serviceId);
    }
    
    const rooms = await firstValueFrom(this.caspioService.getServicesEFE(serviceId));
    console.log('[EFE Data] API returned rooms:', rooms.length, 'rooms');
    if (rooms.length > 0) {
      console.log('[EFE Data] Sample room data:', rooms[0]);
    }
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
    console.log('[Visual Data] Loading existing visuals for ServiceID:', serviceId);
    const visuals = await this.resolveWithCache(this.visualsCache, serviceId, () =>
      firstValueFrom(this.caspioService.getServicesVisualsByServiceId(serviceId))
    );
    console.log('[Visual Data] API returned visuals:', visuals.length, 'visuals');
    if (visuals.length > 0) {
      console.log('[Visual Data] Sample visual data:', visuals[0]);
    }
    return visuals;
  }

  async getVisualAttachments(visualId: string | number): Promise<any[]> {
    if (!visualId) {
      return [];
    }
    const key = String(visualId);
    return this.resolveWithCache(this.visualAttachmentsCache, key, () =>
      firstValueFrom(this.caspioService.getServiceVisualsAttachByVisualId(String(visualId)))
    );
  }

  async getEFEPoints(roomId: string | number): Promise<any[]> {
    if (!roomId) {
      return [];
    }
    const key = String(roomId);
    return this.resolveWithCache(this.efePointsCache, key, () =>
      firstValueFrom(this.caspioService.getServicesEFEPoints(String(roomId)))
    );
  }

  async getEFEAttachments(pointIds: string | string[]): Promise<any[]> {
    if (!pointIds || (Array.isArray(pointIds) && pointIds.length === 0)) {
      return [];
    }
    const key = Array.isArray(pointIds) ? pointIds.sort().join('|') : pointIds;
    return this.resolveWithCache(this.efeAttachmentsCache, key, () =>
      firstValueFrom(this.caspioService.getServicesEFEAttachments(pointIds))
    );
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
      endpoint: '/api/caspio-proxy/tables/LPS_Services_Visuals/records?response=rows',
      method: 'POST',
      data: visualData,
      dependencies: [],
      status: 'pending',
      priority: 'high',
    });

    // Clear cache
    if (visualData.ServiceID) {
      this.visualsCache.delete(String(visualData.ServiceID));
    }

    // Trigger background sync
    this.backgroundSync.triggerSync();

    console.log('[Visual Data] Visual saved with temp ID:', tempId);

    // Return placeholder immediately
    return placeholder;
  }

  async updateVisual(visualId: string, visualData: any): Promise<any> {
    console.log('[Visual Data] Updating visual:', visualId);
    const result = await firstValueFrom(this.caspioService.updateServicesVisual(visualId, visualData));

    // Clear cache to force reload (we don't know which service this visual belongs to)
    this.visualsCache.clear();

    return result;
  }

  async deleteVisual(visualId: string): Promise<any> {
    console.log('[Visual Data] Deleting visual:', visualId);
    const result = await firstValueFrom(this.caspioService.deleteServicesVisual(visualId));

    // Clear cache to force reload
    this.visualsCache.clear();

    return result;
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
      const pending = await this.indexedDb.getPendingRequests();
      const visualRequest = pending.find(r => r.tempId === visualIdStr);
      const dependencies = visualRequest ? [visualRequest.requestId] : [];

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

      // Return placeholder with thumbnail
      return {
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
    }

    // Visual has real ID - upload now
    const visualIdNum = parseInt(visualIdStr, 10);
    
    try {
      const result = await firstValueFrom(
        this.caspioService.createServicesVisualsAttachWithFile(visualIdNum, caption, file, drawings, originalFile)
      );

      // Success - DON'T delete file yet (background sync might need it)
      // File will be deleted by background sync after confirming upload
      console.log('[Visual Photo] Upload succeeded, file kept in IndexedDB for background sync');

      // Clear cache
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
      
      // Return placeholder
      return {
        AttachID: tempPhotoId,
        Photo: objectUrl,
        url: objectUrl,
        thumbnailUrl: objectUrl,
        _thumbnailUrl: objectUrl,
        _syncing: true,
        uploading: false,  // Saved to IndexedDB, not actively uploading
        queued: true,      // Will upload in background
        isObjectUrl: true,
      };
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

    // Create placeholder for immediate UI
    const placeholder = {
      ...pointData,
      PointID: tempId,
      PK_ID: tempId,
      _tempId: tempId,
      _localOnly: true,
      _syncing: true,
      _createdAt: Date.now(),
    };

    // Determine parent ID (room's temp or real ID)
    const parentId = roomTempId || String(pointData.EFEID);

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
      const pending = await this.indexedDb.getPendingRequests();
      const roomRequest = pending.find(r => r.tempId === roomTempId);
      if (roomRequest) {
        dependencies.push(roomRequest.requestId);
        console.log('[EFE Data] Point depends on room request:', roomRequest.requestId);
      }
    }

    // Store in IndexedDB for background sync
    await this.indexedDb.addPendingRequest({
      type: 'CREATE',
      tempId: tempId,
      endpoint: '/api/caspio-proxy/tables/LPS_Services_EFE_Points/records?response=rows',
      method: 'POST',
      data: pointData,
      dependencies: dependencies,
      status: 'pending',
      priority: 'normal',
    });

    // Trigger background sync
    this.backgroundSync.triggerSync();

    console.log('[EFE Data] EFE point queued with temp ID:', tempId, 'dependencies:', dependencies);

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
    console.log('[EFE Photo] Uploading photo for PointID:', pointId);

    const pointIdStr = String(pointId);
    const isTempId = pointIdStr.startsWith('temp_');

    // Generate temp photo ID
    const tempPhotoId = `temp_efe_photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create object URL for immediate thumbnail
    const objectUrl = URL.createObjectURL(file);

    // Store file in IndexedDB
    await this.indexedDb.storeEFEPhotoFile(tempPhotoId, file, pointIdStr, photoType, drawings);

    if (isTempId) {
      // Point not synced - queue with dependency
      const pending = await this.indexedDb.getPendingRequests();
      const pointRequest = pending.find(r => r.tempId === pointIdStr);
      const dependencies = pointRequest ? [pointRequest.requestId] : [];

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

      // Return placeholder with thumbnail
      return {
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
    }

    // Point has real ID - try to upload now
    const pointIdNum = parseInt(pointIdStr, 10);

    try {
      const result = await firstValueFrom(
        this.caspioService.createServicesEFEPointsAttachWithFile(pointIdNum, drawings || '', file, photoType)
      );

      // Success - delete stored file
      await this.indexedDb.deleteStoredFile(tempPhotoId);

      // Clear caches
      this.efeAttachmentsCache.clear();

      console.log('[EFE Photo] Upload succeeded');
      return result;
    } catch (error) {
      // Failed - keep in IndexedDB, queue for retry
      await this.indexedDb.addPendingRequest({
        type: 'UPLOAD_FILE',
        tempId: tempPhotoId,
        endpoint: 'EFE_POINT_PHOTO_UPLOAD',
        method: 'POST',
        data: {
          pointId: pointIdNum,
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

      console.log('[EFE Photo] Upload failed, queued for retry');

      // Return placeholder
      return {
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
