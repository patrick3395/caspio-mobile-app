import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CaspioService } from '../../services/caspio.service';
import { IndexedDbService } from '../../services/indexed-db.service';
import { TempIdService } from '../../services/temp-id.service';
import { BackgroundSyncService } from '../../services/background-sync.service';

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
    private readonly backgroundSync: BackgroundSyncService
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
    if (!forceRefresh && this.efeTemplatesCache && !this.isExpired(this.efeTemplatesCache.timestamp)) {
      return this.efeTemplatesCache.value;
    }

    const loader = firstValueFrom(this.caspioService.getServicesEFETemplates());
    this.efeTemplatesCache = { value: loader, timestamp: Date.now() };
    return loader;
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
        _tempId: tempPhotoId,
        _thumbnailUrl: objectUrl,
        _syncing: true,
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
        _thumbnailUrl: objectUrl,
        _syncing: true,
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
}
