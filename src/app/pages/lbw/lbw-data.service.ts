import { Injectable } from '@angular/core';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { CaspioService } from '../../services/caspio.service';
import { IndexedDbService } from '../../services/indexed-db.service';
import { TempIdService } from '../../services/temp-id.service';
import { BackgroundSyncService } from '../../services/background-sync.service';
import { OfflineTemplateService } from '../../services/offline-template.service';
import { OfflineService } from '../../services/offline.service';

interface CacheEntry<T> {
  value: Promise<T>;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class LbwDataService {
  private readonly cacheTtlMs = 5 * 60 * 1000;

  private projectCache = new Map<string, CacheEntry<any>>();
  private serviceCache = new Map<string, CacheEntry<any>>();
  private typeCache = new Map<string, CacheEntry<any>>();
  private imageCache = new Map<string, CacheEntry<string>>();
  private lbwCache = new Map<string, CacheEntry<any[]>>();
  private lbwAttachmentsCache = new Map<string, CacheEntry<any[]>>();

  // Event emitted when caches are invalidated - pages should reload their data
  public cacheInvalidated$ = new Subject<{ serviceId?: string; reason: string }>();

  private syncSubscriptions: Subscription[] = [];

  constructor(
    private readonly caspioService: CaspioService,
    private readonly indexedDb: IndexedDbService,
    private readonly tempId: TempIdService,
    private readonly backgroundSync: BackgroundSyncService,
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
    // When an LBW record syncs, clear LBW caches
    this.syncSubscriptions.push(
      this.backgroundSync.lbwSyncComplete$.subscribe(event => {
        console.log('[LBW DataService] LBW synced, invalidating caches');
        this.lbwCache.clear();
        this.lbwAttachmentsCache.clear();
        this.cacheInvalidated$.next({ reason: 'lbw_sync' });
      })
    );

    // When an LBW photo syncs, clear attachment caches
    this.syncSubscriptions.push(
      this.backgroundSync.lbwPhotoUploadComplete$.subscribe(event => {
        console.log('[LBW DataService] LBW photo synced, invalidating attachment caches');
        this.lbwAttachmentsCache.clear();
        this.imageCache.clear();
        this.cacheInvalidated$.next({ reason: 'lbw_photo_sync' });
      })
    );

    // When service data syncs, clear service/project caches
    this.syncSubscriptions.push(
      this.backgroundSync.serviceDataSyncComplete$.subscribe(event => {
        console.log('[LBW DataService] Service data synced, invalidating caches');
        if (event.serviceId) {
          this.serviceCache.delete(event.serviceId);
          this.lbwCache.delete(event.serviceId);
        }
        if (event.projectId) {
          this.projectCache.delete(event.projectId);
        }
        this.cacheInvalidated$.next({ serviceId: event.serviceId, reason: 'service_data_sync' });
      })
    );
  }

  /**
   * Invalidate all caches for a specific service
   * Called after sync to ensure fresh data is loaded from IndexedDB
   */
  invalidateCachesForService(serviceId: string, reason: string = 'manual'): void {
    console.log(`[LBW DataService] Invalidating all caches for service ${serviceId} (reason: ${reason})`);

    // Clear service-specific caches
    this.lbwCache.delete(serviceId);
    this.serviceCache.delete(serviceId);

    // Clear all attachment caches (we don't track by service)
    this.lbwAttachmentsCache.clear();
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
      console.log('[LBW Service] Loaded service from IndexedDB cache');
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

  async getImage(filePath: string): Promise<string> {
    if (!filePath) {
      return '';
    }
    return this.resolveWithCache(this.imageCache, filePath, () =>
      firstValueFrom(this.caspioService.getImageFromFilesAPI(filePath))
    );
  }

  /**
   * Get LBW templates from IndexedDB (cache-first)
   */
  async getLBWTemplates(): Promise<any[]> {
    console.log('[LBW Data] Loading LBW templates');

    // OFFLINE-FIRST: Try IndexedDB first
    const cached = await this.indexedDb.getCachedTemplates('lbw');
    if (cached && cached.length > 0) {
      console.log('[LBW Data] Loaded templates from IndexedDB:', cached.length);
      return cached;
    }

    // Fallback to API if online
    if (this.offlineService.isOnline()) {
      console.log('[LBW Data] Fetching templates from API...');
      const templates = await firstValueFrom(this.caspioService.getServicesLBWTemplates());
      await this.indexedDb.cacheTemplates('lbw', templates);
      console.log('[LBW Data] Cached templates from API:', templates.length);
      return templates;
    }

    console.warn('[LBW Data] Offline and no cached templates');
    return [];
  }

  /**
   * Get LBW dropdown options from IndexedDB (cache-first)
   */
  async getLBWDropdownOptions(): Promise<any[]> {
    console.log('[LBW Data] Loading LBW dropdown options');

    // OFFLINE-FIRST: Try IndexedDB first
    const cached = await this.indexedDb.getCachedTemplates('lbw_dropdown');
    if (cached && cached.length > 0) {
      console.log('[LBW Data] Loaded dropdown options from IndexedDB:', cached.length);
      return cached;
    }

    // Fallback to API if online
    if (this.offlineService.isOnline()) {
      console.log('[LBW Data] Fetching dropdown options from API...');
      const options = await firstValueFrom(this.caspioService.getServicesLBWDrop());
      await this.indexedDb.cacheTemplates('lbw_dropdown', options);
      console.log('[LBW Data] Cached dropdown options from API:', options.length);
      return options;
    }

    console.warn('[LBW Data] Offline and no cached dropdown options');
    return [];
  }

  /**
   * Get LBW records for a service with cache-first pattern
   */
  async getVisualsByService(serviceId: string, bypassCache: boolean = false): Promise<any[]> {
    if (!serviceId) {
      console.warn('[LBW Data] getVisualsByService called with empty serviceId');
      return [];
    }
    console.log('[LBW Data] Loading existing LBW records for ServiceID:', serviceId, 'BypassCache:', bypassCache);

    // OFFLINE-FIRST: Try IndexedDB first
    if (!bypassCache) {
      const cached = await this.indexedDb.getCachedServiceData(serviceId, 'lbw_records');
      if (cached && cached.length > 0) {
        console.log('[LBW Data] Loaded LBW records from IndexedDB:', cached.length);
        return cached;
      }
    }

    // CRITICAL: If bypassCache is true, also try IndexedDB in case we're offline
    if (bypassCache) {
      console.log('[LBW Data] Bypassing in-memory cache');
      this.lbwCache.delete(serviceId);
    }

    // Fallback to API if online
    if (this.offlineService.isOnline()) {
      console.log('[LBW Data] Fetching LBW records from API...');
      const records = await firstValueFrom(this.caspioService.getServicesLBWByServiceId(serviceId));
      await this.indexedDb.cacheServiceData(serviceId, 'lbw_records', records);
      console.log('[LBW Data] Cached LBW records from API:', records.length);
      return records;
    }

    // When offline, return cached data even if bypassCache is true
    const offlineData = await this.indexedDb.getCachedServiceData(serviceId, 'lbw_records');
    console.log('[LBW Data] Offline - returning cached data:', offlineData?.length || 0);
    return offlineData || [];
  }

  /**
   * Get LBW attachments with cache-first pattern
   */
  async getVisualAttachments(lbwId: string | number): Promise<any[]> {
    if (!lbwId) {
      return [];
    }
    const key = String(lbwId);
    console.log('[LBW Data] Loading attachments for LBWID:', key);

    // OFFLINE-FIRST: Try IndexedDB first
    const cached = await this.indexedDb.getCachedServiceData(key, 'lbw_attachments');
    if (cached && cached.length > 0) {
      console.log('[LBW Data] Loaded attachments from IndexedDB:', cached.length);

      // Also get any pending photos for this LBW record
      const pendingPhotos = await this.indexedDb.getPendingPhotosForVisual(key);
      if (pendingPhotos.length > 0) {
        console.log('[LBW Data] Found pending photos:', pendingPhotos.length);
        return [...cached, ...pendingPhotos];
      }

      return cached;
    }

    // Get pending photos even if no cached attachments
    const pendingPhotos = await this.indexedDb.getPendingPhotosForVisual(key);

    // Fallback to API if online
    if (this.offlineService.isOnline()) {
      console.log('[LBW Data] Fetching attachments from API...');
      const attachments = await firstValueFrom(this.caspioService.getServiceLBWAttachByLBWId(key));
      await this.indexedDb.cacheServiceData(key, 'lbw_attachments', attachments || []);
      console.log('[LBW Data] Cached attachments from API:', attachments?.length || 0);

      if (pendingPhotos.length > 0) {
        return [...(attachments || []), ...pendingPhotos];
      }
      return attachments || [];
    }

    // Offline with no cache - return just pending photos
    return pendingPhotos;
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
    console.log('[LBW Data Service] Clearing ALL caches to force fresh data load');

    // Clear in-memory caches in this service
    this.projectCache.clear();
    this.serviceCache.clear();
    this.typeCache.clear();
    this.imageCache.clear();
    this.lbwCache.clear();
    this.lbwAttachmentsCache.clear();

    // CRITICAL: Also clear the CaspioService's localStorage cache
    // This prevents returning stale cached data from previous page visits
    this.caspioService.clearServicesCache();
  }

  // Clear specific caches for a service - use when service data changes
  clearServiceCaches(serviceId: string): void {
    console.log('[LBW Data Service] Clearing caches for ServiceID:', serviceId);
    this.lbwCache.delete(serviceId);
  }

  // ============================================
  // LBW RECORD MANAGEMENT - OFFLINE-FIRST
  // ============================================

  /**
   * Create LBW record (offline-first pattern)
   */
  async createVisual(lbwData: any): Promise<any> {
    console.log('[LBW Data] Creating LBW record (OFFLINE-FIRST):', lbwData);

    // Generate temporary ID
    const tempId = this.tempId.generateTempId('lbw');

    // Create placeholder for immediate UI
    const placeholder = {
      ...lbwData,
      LBWID: tempId,
      PK_ID: tempId,
      _tempId: tempId,
      _localOnly: true,
      _syncing: true,
      _createdAt: Date.now(),
    };

    // Store in IndexedDB cache immediately so it shows up
    const serviceId = String(lbwData.ServiceID);
    if (serviceId) {
      const existingRecords = await this.indexedDb.getCachedServiceData(serviceId, 'lbw_records') || [];
      await this.indexedDb.cacheServiceData(serviceId, 'lbw_records', [...existingRecords, placeholder]);
    }

    // Store in IndexedDB for background sync
    await this.indexedDb.addPendingRequest({
      type: 'CREATE',
      tempId: tempId,
      endpoint: '/api/caspio-proxy/tables/LPS_Services_LBW/records?response=rows',
      method: 'POST',
      data: lbwData,
      dependencies: [],
      status: 'pending',
      priority: 'high',
    });

    // Clear in-memory cache
    if (lbwData.ServiceID) {
      this.lbwCache.delete(String(lbwData.ServiceID));
    }

    // Trigger background sync
    this.backgroundSync.triggerSync();

    console.log('[LBW Data] LBW record saved with temp ID:', tempId);

    // Return placeholder immediately
    return placeholder;
  }

  /**
   * Update LBW record (offline-first pattern)
   * Used for hiding/unhiding and other updates
   */
  async updateVisual(lbwId: string, updateData: any, serviceId?: string): Promise<any> {
    console.log('[LBW Data] Updating LBW record (OFFLINE-FIRST):', lbwId, 'Data:', updateData);

    const isTempId = String(lbwId).startsWith('temp_');

    // OFFLINE-FIRST: Update IndexedDB cache immediately
    if (serviceId) {
      const existingRecords = await this.indexedDb.getCachedServiceData(serviceId, 'lbw_records') || [];
      const updatedRecords = existingRecords.map((r: any) => {
        if (String(r.LBWID) === String(lbwId) || String(r.PK_ID) === String(lbwId) || String(r._tempId) === String(lbwId)) {
          return { ...r, ...updateData, _localUpdate: true };
        }
        return r;
      });
      await this.indexedDb.cacheServiceData(serviceId, 'lbw_records', updatedRecords);
      console.log('[LBW Data] Updated IndexedDB cache for service', serviceId);
    }

    // Queue for background sync if not a temp ID
    if (!isTempId) {
      await this.indexedDb.addPendingRequest({
        type: 'UPDATE',
        endpoint: `/api/caspio-proxy/tables/LPS_Services_LBW/records?q.where=LBWID=${lbwId}`,
        method: 'PUT',
        data: updateData,
        dependencies: [],
        status: 'pending',
        priority: 'normal',
      });
      console.log('[LBW Data] Queued update for sync:', lbwId);
    }

    // Clear in-memory cache
    this.lbwCache.clear();
    this.lbwAttachmentsCache.clear();

    // Trigger background sync
    this.backgroundSync.triggerSync();

    // Return immediately with the updated data
    return { success: true, lbwId, ...updateData };
  }

  // ============================================
  // LBW PHOTO METHODS - OFFLINE-FIRST
  // ============================================

  /**
   * Upload photo for LBW record (offline-first pattern)
   */
  async uploadVisualPhoto(lbwId: number | string, file: File, caption: string = '', drawings?: string, originalFile?: File): Promise<any> {
    console.log('[LBW Photo] ========== Uploading photo for LBWID:', lbwId, '==========');
    console.log('[LBW Photo] File:', file.name, 'Caption:', caption || '(empty)');

    const lbwIdStr = String(lbwId);
    const isTempId = lbwIdStr.startsWith('temp_');

    // Generate temp photo ID
    const tempPhotoId = `temp_photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create object URL for immediate thumbnail
    const objectUrl = URL.createObjectURL(file);

    // Store file in IndexedDB for background sync
    await this.indexedDb.storePhotoFile(tempPhotoId, file, lbwIdStr, caption, drawings);

    // Check if we need to wait for the LBW record to sync first
    if (isTempId) {
      // LBW record not synced - queue with dependency
      const pending = await this.indexedDb.getPendingRequests();
      const allRequests = await this.indexedDb.getAllRequests();
      const lbwRequest = [...pending, ...allRequests].find(r => r.tempId === lbwIdStr);
      const dependencies = lbwRequest ? [lbwRequest.requestId] : [];

      if (dependencies.length === 0) {
        console.warn('[LBW Photo] LBW request not found for', lbwIdStr, '- photo may sync before LBW record!');
      } else {
        console.log('[LBW Photo] Photo depends on LBW request:', lbwRequest?.requestId);
      }

      await this.indexedDb.addPendingRequest({
        type: 'UPLOAD_FILE',
        tempId: tempPhotoId,
        endpoint: 'LBW_PHOTO_UPLOAD',
        method: 'POST',
        data: {
          tempLbwId: lbwIdStr,
          fileId: tempPhotoId,
          caption: caption || '',
          drawings: drawings || '',
        },
        dependencies: dependencies,
        status: 'pending',
        priority: 'normal',
      });

      console.log('[LBW Photo] Photo queued (waiting for LBW record)');

      // Return placeholder with thumbnail
      return {
        AttachID: tempPhotoId,
        LBWID: lbwIdStr,
        Annotation: caption,
        Photo: objectUrl,
        url: objectUrl,
        thumbnailUrl: objectUrl,
        _tempId: tempPhotoId,
        _thumbnailUrl: objectUrl,
        _syncing: true,
        uploading: false,
        queued: true,
        isObjectUrl: true,
      };
    }

    // LBW has real ID - try to upload now
    const lbwIdNum = parseInt(lbwIdStr, 10);

    try {
      const result = await firstValueFrom(
        this.caspioService.createServicesLBWAttachWithFile(lbwIdNum, caption, file, drawings, originalFile)
      );

      console.log('[LBW Photo] Upload complete! Result:', JSON.stringify(result, null, 2));

      // Delete file from IndexedDB on success
      await this.indexedDb.deleteStoredFile(tempPhotoId);

      // Clear cache
      this.lbwAttachmentsCache.delete(lbwIdStr);

      return result;
    } catch (error) {
      // Failed - keep in IndexedDB, queue for retry
      console.warn('[LBW Photo] Upload failed, queuing for retry:', error);

      await this.indexedDb.addPendingRequest({
        type: 'UPLOAD_FILE',
        tempId: tempPhotoId,
        endpoint: 'LBW_PHOTO_UPLOAD',
        method: 'POST',
        data: {
          lbwId: lbwIdNum,
          fileId: tempPhotoId,
          caption: caption || '',
          drawings: drawings || '',
          fileName: file.name,
          fileSize: file.size,
        },
        dependencies: [],
        status: 'pending',
        priority: 'high',
      });

      console.log('[LBW Photo] Photo queued for retry');

      // Return placeholder
      return {
        AttachID: tempPhotoId,
        LBWID: lbwIdStr,
        Photo: objectUrl,
        url: objectUrl,
        thumbnailUrl: objectUrl,
        _thumbnailUrl: objectUrl,
        _syncing: true,
        uploading: false,
        queued: true,
        isObjectUrl: true,
      };
    }
  }

  async deleteVisualPhoto(attachId: string): Promise<any> {
    console.log('[LBW Photo] Deleting photo:', attachId);

    // If it's a temp ID, just remove from IndexedDB
    if (String(attachId).startsWith('temp_')) {
      await this.indexedDb.deleteStoredFile(attachId);
      await this.indexedDb.removePendingRequest(attachId);
      console.log('[LBW Photo] Removed pending photo:', attachId);
      return { success: true };
    }

    // Queue for background sync if offline
    if (!this.offlineService.isOnline()) {
      await this.indexedDb.addPendingRequest({
        type: 'DELETE',
        endpoint: `/api/caspio-proxy/tables/LPS_Services_LBW_Attach/records?q.where=AttachID=${attachId}`,
        method: 'DELETE',
        data: { attachId },
        dependencies: [],
        status: 'pending',
        priority: 'normal',
      });
      console.log('[LBW Photo] Delete queued for sync (offline)');
      this.backgroundSync.triggerSync();
      this.lbwAttachmentsCache.clear();
      return { success: true, queued: true };
    }

    // Online - delete immediately
    const result = await firstValueFrom(this.caspioService.deleteServicesLBWAttach(attachId));
    this.lbwAttachmentsCache.clear();
    return result;
  }

  async updateVisualPhotoCaption(attachId: string, caption: string, lbwId?: string): Promise<any> {
    console.log('[LBW Photo] Updating caption for AttachID:', attachId);
    const updateData = { Annotation: caption };

    // OFFLINE-FIRST: Update IndexedDB cache immediately
    if (lbwId) {
      try {
        const cached = await this.indexedDb.getCachedServiceData(lbwId, 'lbw_attachments') || [];
        const updated = cached.map((att: any) =>
          String(att.AttachID) === String(attachId)
            ? { ...att, Annotation: caption, _localUpdate: true }
            : att
        );
        await this.indexedDb.cacheServiceData(lbwId, 'lbw_attachments', updated);
        console.log('[LBW Photo] ✅ Caption saved to IndexedDB for LBW', lbwId);
      } catch (cacheError) {
        console.warn('[LBW Photo] Failed to update IndexedDB cache:', cacheError);
      }
    }

    // Check if we're online
    if (!this.offlineService.isOnline()) {
      // Queue for later sync
      await this.indexedDb.addPendingRequest({
        type: 'UPDATE',
        endpoint: `/api/caspio-proxy/tables/LPS_Services_LBW_Attach/records?q.where=AttachID=${attachId}`,
        method: 'PUT',
        data: updateData,
        dependencies: [],
        status: 'pending',
        priority: 'normal',
      });
      console.log('[LBW Photo] ⏳ Caption queued for sync (offline)');
      this.backgroundSync.triggerSync();
      this.lbwAttachmentsCache.clear();
      return { success: true, queued: true };
    }

    // Online - try API
    try {
      const result = await firstValueFrom(
        this.caspioService.updateServicesLBWAttach(attachId, updateData)
      );
      console.log('[LBW Photo] ✅ Caption saved via API');
      this.lbwAttachmentsCache.clear();
      return result;
    } catch (apiError) {
      // Queue for retry
      console.warn('[LBW Photo] API failed, queuing for retry');
      await this.indexedDb.addPendingRequest({
        type: 'UPDATE',
        endpoint: `/api/caspio-proxy/tables/LPS_Services_LBW_Attach/records?q.where=AttachID=${attachId}`,
        method: 'PUT',
        data: updateData,
        dependencies: [],
        status: 'pending',
        priority: 'high',
      });
      this.backgroundSync.triggerSync();
      this.lbwAttachmentsCache.clear();
      return { success: true, queued: true };
    }
  }

  // Clear cache for a specific LBW's attachments
  clearLBWAttachmentsCache(lbwId?: string | number): void {
    if (lbwId) {
      const key = String(lbwId);
      this.lbwAttachmentsCache.delete(key);
      console.log('[LBW Photo] Cleared cache for LBWID:', lbwId);
    } else {
      this.lbwAttachmentsCache.clear();
      console.log('[LBW Photo] Cleared all attachment caches');
    }
  }
}
