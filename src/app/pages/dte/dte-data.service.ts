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
    
    // CRITICAL: If bypassCache is true, clear the cache first
    if (bypassCache) {
      this.hudCache.delete(serviceId);
    }
    
    const hudRecords = await this.resolveWithCache(this.hudCache, serviceId, () =>
      firstValueFrom(this.caspioService.getServicesDTEByServiceId(serviceId, bypassCache))
    );
    if (hudRecords.length > 0) {
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
    this.hudCache.delete(serviceId);
  }

  // ============================================
  // HUD PHOTO METHODS (matching Visual Photo methods from foundation service)
  // ============================================

  async uploadVisualPhoto(DTEID: number, file: File, caption: string = '', drawings?: string, originalFile?: File): Promise<any> {
    
    const result = await firstValueFrom(
      this.caspioService.createServicesDTEAttachWithFile(DTEID, caption, file, drawings, originalFile)
    );


    // Clear attachment cache for this HUD record
    const key = String(DTEID);
    this.hudAttachmentsCache.delete(key);

    return result;
  }

  async deleteVisualPhoto(attachId: string): Promise<any> {

    // Clear all attachment caches first (optimistic update)
    this.hudAttachmentsCache.clear();

    // DTE: Always delete directly via API (no offline queuing support)
    try {
      await firstValueFrom(this.caspioService.deleteServicesDTEAttach(String(attachId)));
      return { success: true, deleted: true };
    } catch (error) {
      console.error('[DTE Photo] Failed to delete photo:', error);
      throw error;
    }
  }

  async updateVisualPhotoCaption(attachId: string, caption: string): Promise<any> {
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

    // Clear in-memory cache
    if (dteData.ServiceID) {
      this.hudCache.delete(String(dteData.ServiceID));
    }

    // Trigger sync on interval (batched sync)

    return placeholder;
  }

  // Update DTE record - OFFLINE-FIRST with background sync
  async updateVisual(dteId: string, updateData: any, serviceId?: string): Promise<any> {
    // WEBAPP MODE: Update directly via API
    if (environment.isWeb) {

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


        // Clear in-memory cache
        this.hudCache.clear();

        return { success: true, dteId, ...updateData };
      } catch (error: any) {
        console.error('[DTE Data] WEBAPP: Error updating DTE record:', error?.message || error);
        throw error;
      }
    }

    // MOBILE MODE: Offline-first

    const isTempId = String(dteId).startsWith('temp_');

    // OFFLINE-FIRST: Update 'dte' cache immediately, queue for sync
    if (serviceId) {
      if (isTempId) {
        // Update pending request data
        await this.indexedDb.updatePendingRequestData(dteId, updateData);
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
      }

      await this.indexedDb.cacheServiceData(serviceId, 'dte', updatedRecords);
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
      }
    }

    // Clear in-memory cache
    this.hudCache.clear();
    this.hudAttachmentsCache.clear();

    return { success: true, dteId, ...updateData };
  }
}
