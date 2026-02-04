import { Injectable } from '@angular/core';
import { firstValueFrom, Subject, Subscription } from 'rxjs';
import { CaspioService } from '../../services/caspio.service';
import { IndexedDbService } from '../../services/indexed-db.service';
import { TempIdService } from '../../services/temp-id.service';
import { BackgroundSyncService } from '../../services/background-sync.service';
import { OfflineTemplateService } from '../../services/offline-template.service';
import { OfflineService } from '../../services/offline.service';
import { environment } from '../../../environments/environment';

interface CacheEntry<T> {
  value: Promise<T>;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class DteDataService {
  private readonly cacheTtlMs = 5 * 60 * 1000;

  private projectCache = new Map<string, CacheEntry<any>>();
  private serviceCache = new Map<string, CacheEntry<any>>();
  private typeCache = new Map<string, CacheEntry<any>>();
  private imageCache = new Map<string, CacheEntry<string>>();
  private hudCache = new Map<string, CacheEntry<any[]>>();
  private hudAttachmentsCache = new Map<string, CacheEntry<any[]>>();

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
   */
  private subscribeToSyncEvents(): void {
    // Subscribe to DTE-specific sync events
    this.syncSubscriptions.push(
      this.backgroundSync.dteSyncComplete$.subscribe(event => {
        console.log('[DTE DataService] DTE synced, invalidating caches for service:', event.serviceId);
        this.hudCache.clear();
        this.cacheInvalidated$.next({ serviceId: event.serviceId, reason: 'dte_sync' });
      })
    );
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

  async getVisualsByService(serviceId: string, bypassCache: boolean = false): Promise<any[]> {
    if (!serviceId) {
      console.warn('[DTE Data] getVisualsByService called with empty serviceId');
      return [];
    }
    console.log('[DTE Data] Loading existing HUD records for ServiceID:', serviceId, 'BypassCache:', bypassCache);
    
    // CRITICAL: If bypassCache is true, clear the cache first
    if (bypassCache) {
      console.log('[DTE Data] Bypassing cache - clearing cached data for ServiceID:', serviceId);
      this.hudCache.delete(serviceId);
    }
    
    const hudRecords = await this.resolveWithCache(this.hudCache, serviceId, () =>
      firstValueFrom(this.caspioService.getServicesDTEByServiceId(serviceId, bypassCache))
    );
    console.log('[DTE Data] API returned HUD records:', hudRecords.length, 'records');
    if (hudRecords.length > 0) {
      console.log('[DTE Data] Sample HUD record data:', hudRecords[0]);
    }
    return hudRecords;
  }

  async getVisualAttachments(DTEID: string | number): Promise<any[]> {
    if (!DTEID) {
      return [];
    }
    const key = String(DTEID);
    return this.resolveWithCache(this.hudAttachmentsCache, key, () =>
      firstValueFrom(this.caspioService.getServiceDTEAttachByDTEId(String(DTEID)))
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
    console.log('[DTE Data Service] Clearing ALL caches to force fresh data load');

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

  // Clear specific caches for a service - use when service data changes
  clearServiceCaches(serviceId: string): void {
    console.log('[DTE Data Service] Clearing caches for ServiceID:', serviceId);
    this.hudCache.delete(serviceId);
  }

  // ============================================
  // HUD PHOTO METHODS (matching Visual Photo methods from foundation service)
  // ============================================

  async uploadVisualPhoto(DTEID: number, file: File, caption: string = '', drawings?: string, originalFile?: File): Promise<any> {
    console.log('[DTE Photo] ========== Uploading photo for DTEID:', DTEID, '==========');
    console.log('[DTE Photo] File:', file.name, 'Caption:', caption || '(empty)');
    
    const result = await firstValueFrom(
      this.caspioService.createServicesDTEAttachWithFile(DTEID, caption, file, drawings, originalFile)
    );

    console.log('[DTE Photo] Upload complete! Raw result:', JSON.stringify(result, null, 2));
    console.log('[DTE Photo] Result.Result:', result.Result);
    console.log('[DTE Photo] Result.Result[0]:', result.Result?.[0]);

    // Clear attachment cache for this HUD record
    const key = String(DTEID);
    this.hudAttachmentsCache.delete(key);

    console.log('[DTE Photo] Returning result to caller');
    return result;
  }

  async deleteVisualPhoto(attachId: string): Promise<any> {
    console.log('[DTE Photo] Deleting photo:', attachId);

    // Clear all attachment caches first (optimistic update)
    this.hudAttachmentsCache.clear();

    // DTE: Always delete directly via API (no offline queuing support)
    console.log('[DTE Photo] Deleting photo directly via API:', attachId);
    try {
      await firstValueFrom(this.caspioService.deleteServicesDTEAttach(String(attachId)));
      console.log('[DTE Photo] Photo deleted successfully:', attachId);
      return { success: true, deleted: true };
    } catch (error) {
      console.error('[DTE Photo] Failed to delete photo:', error);
      throw error;
    }
  }

  async updateVisualPhotoCaption(attachId: string, caption: string): Promise<any> {
    console.log('[DTE Photo] Updating caption for AttachID:', attachId);
    const result = await firstValueFrom(
      this.caspioService.updateServicesDTEAttach(attachId, { Annotation: caption })
    );

    // Clear all attachment caches
    this.hudAttachmentsCache.clear();

    return result;
  }

  // Create DTE record - OFFLINE-FIRST with background sync (matching LBW pattern)
  async createVisual(dteData: any): Promise<any> {
    // WEBAPP MODE: Create directly via API
    if (environment.isWeb) {
      console.log('[DTE Data] WEBAPP: Creating DTE record directly via API:', dteData);
      try {
        const response = await fetch(`${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_DTE/records?response=rows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dteData)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to create DTE record: ${errorText}`);
        }

        const result = await response.json();
        console.log('[DTE Data] WEBAPP: DTE record created:', result);

        // Clear in-memory cache
        if (dteData.ServiceID) {
          this.hudCache.delete(String(dteData.ServiceID));
        }

        return {
          ...dteData,
          DTEID: result.Result?.[0]?.DTEID || result.Result?.[0]?.PK_ID,
          PK_ID: result.Result?.[0]?.PK_ID || result.Result?.[0]?.DTEID,
          ...result.Result?.[0]
        };
      } catch (error: any) {
        console.error('[DTE Data] WEBAPP: ❌ Error creating DTE record:', error?.message || error);
        throw error;
      }
    }

    // MOBILE MODE: Offline-first with background sync
    console.log('[DTE Data] Creating new DTE record (OFFLINE-FIRST):', dteData);

    // Generate temporary ID (using 'dte' prefix for DTE records)
    const tempId = this.tempId.generateTempId('dte');

    // Create placeholder for immediate UI
    const placeholder = {
      ...dteData,
      DTEID: tempId,
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
      endpoint: '/api/caspio-proxy/tables/LPS_Services_DTE/records?response=rows',
      method: 'POST',
      data: dteData,
      dependencies: [],
      status: 'pending',
      priority: 'high',
    });

    // CRITICAL: Cache placeholder to 'dte' cache for Dexie-first pattern
    const serviceIdStr = String(dteData.ServiceID);
    const existingDteRecords = await this.indexedDb.getCachedServiceData(serviceIdStr, 'dte') || [];
    await this.indexedDb.cacheServiceData(serviceIdStr, 'dte', [...existingDteRecords, placeholder]);
    console.log('[DTE Data] ✅ Cached DTE placeholder to Dexie:', tempId);

    // Clear in-memory cache
    if (dteData.ServiceID) {
      this.hudCache.delete(String(dteData.ServiceID));
    }

    // Trigger sync on interval (batched sync)
    console.log('[DTE Data] ✅ DTE record queued for sync with tempId:', tempId);

    return placeholder;
  }

  // Update DTE record - OFFLINE-FIRST with background sync
  async updateVisual(dteId: string, updateData: any, serviceId?: string): Promise<any> {
    // WEBAPP MODE: Update directly via API
    if (environment.isWeb) {
      console.log('[DTE Data] WEBAPP: Updating DTE record directly via API:', dteId, updateData);

      try {
        const response = await fetch(`${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_DTE/records?q.where=DTEID=${dteId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to update DTE record: ${errorText}`);
        }

        console.log('[DTE Data] WEBAPP: DTE record updated:', dteId);

        // Clear in-memory cache
        this.hudCache.clear();

        return { success: true, dteId, ...updateData };
      } catch (error: any) {
        console.error('[DTE Data] WEBAPP: Error updating DTE record:', error?.message || error);
        throw error;
      }
    }

    // MOBILE MODE: Offline-first
    console.log('[DTE Data] Updating DTE record (OFFLINE-FIRST):', dteId, updateData);

    const isTempId = String(dteId).startsWith('temp_');

    // OFFLINE-FIRST: Update 'dte' cache immediately, queue for sync
    if (serviceId) {
      if (isTempId) {
        // Update pending request data
        await this.indexedDb.updatePendingRequestData(dteId, updateData);
        console.log('[DTE Data] Updated pending request:', dteId);
      } else {
        // Queue update for sync
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_DTE/records?q.where=DTEID=${dteId}`,
          method: 'PUT',
          data: updateData,
          dependencies: [],
          status: 'pending',
          priority: 'normal',
        });
        console.log('[DTE Data] Queued update for sync:', dteId);
      }

      // Update 'dte' cache with _localUpdate flag to preserve during background refresh
      const existingDteRecords = await this.indexedDb.getCachedServiceData(serviceId, 'dte') || [];
      let matchFound = false;
      const updatedRecords = existingDteRecords.map((v: any) => {
        // Check BOTH PK_ID, DTEID, and _tempId since API may return any of these
        const vId = String(v.DTEID || v.PK_ID || v._tempId || '');
        if (vId === dteId) {
          matchFound = true;
          return { ...v, ...updateData, _localUpdate: true };
        }
        return v;
      });

      if (!matchFound && isTempId) {
        // For temp IDs not in cache, add a new record
        updatedRecords.push({ ...updateData, _tempId: dteId, PK_ID: dteId, DTEID: dteId, _localUpdate: true });
        console.log('[DTE Data] Added temp record to dte cache:', dteId);
      }

      await this.indexedDb.cacheServiceData(serviceId, 'dte', updatedRecords);
      console.log(`[DTE Data] Updated 'dte' cache, matchFound=${matchFound}:`, dteId);
    } else {
      // If no serviceId, still queue for sync but skip cache update
      if (!isTempId) {
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_DTE/records?q.where=DTEID=${dteId}`,
          method: 'PUT',
          data: updateData,
          dependencies: [],
          status: 'pending',
          priority: 'normal',
        });
        console.log('[DTE Data] Queued update for sync (no serviceId):', dteId);
      }
    }

    // Clear in-memory cache
    this.hudCache.clear();
    this.hudAttachmentsCache.clear();
    console.log('[DTE Data] Cleared hudCache and hudAttachmentsCache after update');

    return { success: true, dteId, ...updateData };
  }
}
