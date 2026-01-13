import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IndexedDbService, PendingEFEData } from './indexed-db.service';
import { OfflineService } from './offline.service';
import { CaspioService } from './caspio.service';

/**
 * Service for managing offline data caching with network-first fallback to cache strategy.
 * Handles template caching, service data caching, and merging pending offline items.
 */
@Injectable({
  providedIn: 'root'
})
export class OfflineDataCacheService {
  private readonly TEMPLATE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly SERVICE_DATA_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    private indexedDb: IndexedDbService,
    private offlineService: OfflineService,
    private caspioService: CaspioService
  ) {}

  // ============================================
  // TEMPLATE CACHING (24hr cache, refresh in background)
  // ============================================

  /**
   * Get visuals templates with offline support.
   * Cache-first: check IndexedDB, return cached if valid.
   * If online: fetch from API, update IndexedDB cache.
   * If offline: return IndexedDB cache.
   */
  async getVisualsTemplates(): Promise<any[]> {
    console.log('[OfflineCache] Getting visuals templates');

    // Check if cache is valid
    const cacheValid = await this.indexedDb.isTemplateCacheValid('visual', this.TEMPLATE_CACHE_TTL);

    if (cacheValid) {
      const cached = await this.indexedDb.getCachedTemplates('visual');
      if (cached && cached.length > 0) {
        console.log('[OfflineCache] Using cached visuals templates:', cached.length);

        // Refresh in background if online
        if (this.offlineService.isOnline()) {
          this.refreshTemplatesInBackground('visual');
        }
        return cached;
      }
    }

    // Need to fetch from network
    if (this.offlineService.isOnline()) {
      try {
        const templates = await firstValueFrom(this.caspioService.getServicesVisualsTemplates());

        // Cache the templates
        await this.indexedDb.cacheTemplates('visual', templates);
        console.log('[OfflineCache] Fetched and cached visuals templates:', templates.length);

        return templates;
      } catch (error) {
        console.error('[OfflineCache] Failed to fetch visuals templates:', error);

        // Fallback to cache even if expired
        const cached = await this.indexedDb.getCachedTemplates('visual');
        if (cached) {
          console.log('[OfflineCache] Falling back to expired cache');
          return cached;
        }
        throw error;
      }
    }

    // Offline - return cache or empty
    const cached = await this.indexedDb.getCachedTemplates('visual');
    if (cached) {
      console.log('[OfflineCache] Offline: using cached visuals templates:', cached.length);
      return cached;
    }

    console.warn('[OfflineCache] Offline and no cached templates available');
    return [];
  }

  /**
   * Get EFE templates with offline support.
   */
  async getEFETemplates(): Promise<any[]> {
    console.log('[OfflineCache] Getting EFE templates');

    // Check if cache is valid
    const cacheValid = await this.indexedDb.isTemplateCacheValid('efe', this.TEMPLATE_CACHE_TTL);

    if (cacheValid) {
      const cached = await this.indexedDb.getCachedTemplates('efe');
      if (cached && cached.length > 0) {
        console.log('[OfflineCache] Using cached EFE templates:', cached.length);

        // Refresh in background if online
        if (this.offlineService.isOnline()) {
          this.refreshTemplatesInBackground('efe');
        }
        return cached;
      }
    }

    // Need to fetch from network
    if (this.offlineService.isOnline()) {
      try {
        const templates = await firstValueFrom(this.caspioService.getServicesEFETemplates());

        // Cache the templates
        await this.indexedDb.cacheTemplates('efe', templates);
        console.log('[OfflineCache] Fetched and cached EFE templates:', templates.length);

        return templates;
      } catch (error) {
        console.error('[OfflineCache] Failed to fetch EFE templates:', error);

        // Fallback to cache even if expired
        const cached = await this.indexedDb.getCachedTemplates('efe');
        if (cached) {
          console.log('[OfflineCache] Falling back to expired EFE cache');
          return cached;
        }
        throw error;
      }
    }

    // Offline - return cache or empty
    const cached = await this.indexedDb.getCachedTemplates('efe');
    if (cached) {
      console.log('[OfflineCache] Offline: using cached EFE templates:', cached.length);
      return cached;
    }

    console.warn('[OfflineCache] Offline and no cached EFE templates available');
    return [];
  }

  /**
   * Refresh templates in background (don't await)
   */
  private async refreshTemplatesInBackground(type: 'visual' | 'efe'): Promise<void> {
    try {
      console.log(`[OfflineCache] Background refresh for ${type} templates`);

      let templates: any[];
      if (type === 'visual') {
        templates = await firstValueFrom(this.caspioService.getServicesVisualsTemplates());
      } else {
        templates = await firstValueFrom(this.caspioService.getServicesEFETemplates());
      }

      await this.indexedDb.cacheTemplates(type, templates);
      console.log(`[OfflineCache] Background refresh complete: ${templates.length} ${type} templates`);
    } catch (error) {
      console.warn(`[OfflineCache] Background refresh failed for ${type}:`, error);
    }
  }

  // ============================================
  // SERVICE DATA CACHING (5min cache, network-first)
  // ============================================

  /**
   * Get visuals by service with offline support.
   * Network-first with cache fallback.
   */
  async getVisualsByService(serviceId: string): Promise<any[]> {
    console.log('[OfflineCache] Getting visuals for service:', serviceId);

    if (this.offlineService.isOnline()) {
      try {
        const visuals = await firstValueFrom(this.caspioService.getServicesVisualsByServiceId(serviceId));

        // Cache the data
        await this.indexedDb.cacheServiceData(serviceId, 'visuals', visuals);
        console.log('[OfflineCache] Fetched and cached visuals:', visuals.length);

        return visuals;
      } catch (error) {
        console.error('[OfflineCache] Failed to fetch visuals:', error);

        // Fallback to cache
        const cached = await this.indexedDb.getCachedServiceData(serviceId, 'visuals');
        if (cached) {
          console.log('[OfflineCache] Falling back to cached visuals:', cached.length);
          return cached;
        }
        throw error;
      }
    }

    // Offline - return cache
    const cached = await this.indexedDb.getCachedServiceData(serviceId, 'visuals');
    if (cached) {
      console.log('[OfflineCache] Offline: using cached visuals:', cached.length);
      return cached;
    }

    console.warn('[OfflineCache] Offline and no cached visuals for service:', serviceId);
    return [];
  }

  /**
   * Get EFE rooms by service with offline support.
   */
  async getEFEByService(serviceId: string): Promise<any[]> {
    console.log('[OfflineCache] Getting EFE rooms for service:', serviceId);

    if (this.offlineService.isOnline()) {
      try {
        const rooms = await firstValueFrom(this.caspioService.getServicesEFE(serviceId));

        // TASK 2 FIX: Preserve local updates (FDF, Location, Notes) when merging server data
        // Without this, local FDF changes would be lost when reloading while online
        const existingCache = await this.indexedDb.getCachedServiceData(serviceId, 'efe_rooms') || [];
        const localUpdateRooms = existingCache.filter((r: any) => r._localUpdate);

        // Merge local updates into server data
        const mergedRooms = rooms.map((serverRoom: any) => {
          const localRoom = localUpdateRooms.find((lr: any) =>
            String(lr.EFEID) === String(serverRoom.EFEID) ||
            String(lr.PK_ID) === String(serverRoom.PK_ID) ||
            lr.RoomName === serverRoom.RoomName
          );
          if (localRoom) {
            // Preserve local fields that haven't synced yet
            console.log(`[OfflineCache] Preserving local updates for room: ${serverRoom.RoomName}`);
            return {
              ...serverRoom,
              FDF: localRoom.FDF !== undefined ? localRoom.FDF : serverRoom.FDF,
              Location: localRoom.Location !== undefined ? localRoom.Location : serverRoom.Location,
              Notes: localRoom.Notes !== undefined ? localRoom.Notes : serverRoom.Notes,
              // FDF captions - preserve local annotations until synced
              FDFTopAnnotation: localRoom.FDFTopAnnotation !== undefined ? localRoom.FDFTopAnnotation : serverRoom.FDFTopAnnotation,
              FDFBottomAnnotation: localRoom.FDFBottomAnnotation !== undefined ? localRoom.FDFBottomAnnotation : serverRoom.FDFBottomAnnotation,
              FDFThresholdAnnotation: localRoom.FDFThresholdAnnotation !== undefined ? localRoom.FDFThresholdAnnotation : serverRoom.FDFThresholdAnnotation,
              _localUpdate: true  // Keep the flag until sync completes
            };
          }
          return serverRoom;
        });

        // Cache the merged data
        await this.indexedDb.cacheServiceData(serviceId, 'efe_rooms', mergedRooms);
        console.log('[OfflineCache] Fetched and cached EFE rooms:', rooms.length, `(${localUpdateRooms.length} with local updates preserved)`);

        return mergedRooms;
      } catch (error) {
        console.error('[OfflineCache] Failed to fetch EFE rooms:', error);

        // Fallback to cache
        const cached = await this.indexedDb.getCachedServiceData(serviceId, 'efe_rooms');
        if (cached) {
          console.log('[OfflineCache] Falling back to cached EFE rooms:', cached.length);
          return cached;
        }
        throw error;
      }
    }

    // Offline - return cache
    const cached = await this.indexedDb.getCachedServiceData(serviceId, 'efe_rooms');
    if (cached) {
      console.log('[OfflineCache] Offline: using cached EFE rooms:', cached.length);
      return cached;
    }

    console.warn('[OfflineCache] Offline and no cached EFE rooms for service:', serviceId);
    return [];
  }

  /**
   * Get EFE points by room with offline support.
   */
  async getEFEPoints(roomId: string): Promise<any[]> {
    console.log('[OfflineCache] Getting EFE points for room:', roomId);

    if (this.offlineService.isOnline()) {
      try {
        const points = await firstValueFrom(this.caspioService.getServicesEFEPoints(roomId));

        // Cache the data (use room ID as part of the service ID for caching)
        await this.indexedDb.cacheServiceData(roomId, 'efe_points', points);
        console.log('[OfflineCache] Fetched and cached EFE points:', points.length);

        return points;
      } catch (error) {
        console.error('[OfflineCache] Failed to fetch EFE points:', error);

        // Fallback to cache
        const cached = await this.indexedDb.getCachedServiceData(roomId, 'efe_points');
        if (cached) {
          console.log('[OfflineCache] Falling back to cached EFE points:', cached.length);
          return cached;
        }
        throw error;
      }
    }

    // Offline - return cache
    const cached = await this.indexedDb.getCachedServiceData(roomId, 'efe_points');
    if (cached) {
      console.log('[OfflineCache] Offline: using cached EFE points:', cached.length);
      return cached;
    }

    console.warn('[OfflineCache] Offline and no cached EFE points for room:', roomId);
    return [];
  }

  // ============================================
  // MERGE PENDING DATA WITH API DATA
  // ============================================

  /**
   * Merge API visuals with pending offline visuals.
   * Prevents duplicates when pending items sync.
   */
  async getMergedVisuals(serviceId: string, apiVisuals: any[]): Promise<any[]> {
    // Get pending visuals from IndexedDB (if any)
    const pendingRequests = await this.indexedDb.getPendingRequests();
    const pendingVisuals = pendingRequests
      .filter(r =>
        r.type === 'CREATE' &&
        r.endpoint.includes('Services_Visuals') &&
        !r.endpoint.includes('Attach') &&
        r.data?.ServiceID === parseInt(serviceId) &&
        r.status !== 'synced'
      )
      .map(r => ({
        ...r.data,
        PK_ID: r.tempId,
        VisualID: r.tempId,
        _tempId: r.tempId,
        _localOnly: true,
        _syncing: r.status === 'syncing',
      }));

    if (pendingVisuals.length === 0) {
      return apiVisuals;
    }

    console.log('[OfflineCache] Merging', apiVisuals.length, 'API visuals with', pendingVisuals.length, 'pending visuals');

    // Filter out pending visuals that may have already synced (check by temp ID or matching fields)
    const newPendingVisuals = pendingVisuals.filter(pending => {
      // Check if API already has this item (by temp ID in case it's in transition)
      return !apiVisuals.some(api =>
        api.PK_ID === pending._tempId ||
        api._tempId === pending._tempId
      );
    });

    return [...apiVisuals, ...newPendingVisuals];
  }

  /**
   * Merge API EFE rooms with pending offline rooms.
   */
  async getMergedEFERooms(serviceId: string, apiRooms: any[]): Promise<any[]> {
    // Get pending EFE rooms from IndexedDB
    const pendingEFE = await this.indexedDb.getPendingEFEByService(serviceId);
    const pendingRooms = pendingEFE
      .filter(p => p.type === 'room')
      .map(p => ({
        ...p.data,
        _tempId: p.tempId,
        _localOnly: true,
        _syncing: true,
      }));

    if (pendingRooms.length === 0) {
      return apiRooms;
    }

    console.log('[OfflineCache] Merging', apiRooms.length, 'API rooms with', pendingRooms.length, 'pending rooms');

    // Filter out rooms that may have synced
    const newPendingRooms = pendingRooms.filter(pending => {
      return !apiRooms.some(api =>
        api.EFEID === pending._tempId ||
        api._tempId === pending._tempId ||
        api.RoomName === pending.data?.RoomName
      );
    });

    return [...apiRooms, ...newPendingRooms];
  }

  /**
   * Merge API EFE points with pending offline points.
   */
  async getMergedEFEPoints(roomId: string, apiPoints: any[]): Promise<any[]> {
    // Get pending EFE points from IndexedDB
    const pendingPoints = await this.indexedDb.getPendingEFEPoints(roomId);
    const formattedPending = pendingPoints.map(p => ({
      ...p.data,
      _tempId: p.tempId,
      _localOnly: true,
      _syncing: true,
    }));

    if (formattedPending.length === 0) {
      return apiPoints;
    }

    console.log('[OfflineCache] Merging', apiPoints.length, 'API points with', formattedPending.length, 'pending points');

    // Filter out points that may have synced
    const newPendingPoints = formattedPending.filter(pending => {
      return !apiPoints.some(api =>
        api.PointID === pending._tempId ||
        api._tempId === pending._tempId
      );
    });

    return [...apiPoints, ...newPendingPoints];
  }

  // ============================================
  // CACHE MANAGEMENT
  // ============================================

  /**
   * Invalidate all caches for a service (call after sync completes)
   */
  async invalidateServiceCaches(serviceId: string): Promise<void> {
    console.log('[OfflineCache] Invalidating caches for service:', serviceId);
    await this.indexedDb.invalidateServiceCache(serviceId);
  }

  /**
   * Force refresh all templates (call on app start or manual refresh)
   */
  async refreshAllTemplates(): Promise<void> {
    if (!this.offlineService.isOnline()) {
      console.log('[OfflineCache] Cannot refresh templates while offline');
      return;
    }

    console.log('[OfflineCache] Refreshing all templates');

    try {
      const [visualTemplates, efeTemplates] = await Promise.all([
        firstValueFrom(this.caspioService.getServicesVisualsTemplates()),
        firstValueFrom(this.caspioService.getServicesEFETemplates())
      ]);

      await Promise.all([
        this.indexedDb.cacheTemplates('visual', visualTemplates),
        this.indexedDb.cacheTemplates('efe', efeTemplates)
      ]);

      console.log('[OfflineCache] Refreshed templates: visual=' + visualTemplates.length + ', efe=' + efeTemplates.length);
    } catch (error) {
      console.error('[OfflineCache] Failed to refresh templates:', error);
    }
  }

  /**
   * Pre-cache all data for a service (call when user navigates to a service while online)
   */
  async preCacheServiceData(serviceId: string): Promise<void> {
    if (!this.offlineService.isOnline()) {
      console.log('[OfflineCache] Cannot pre-cache while offline');
      return;
    }

    console.log('[OfflineCache] Pre-caching data for service:', serviceId);

    try {
      // Fetch and cache all data in parallel
      const [visuals, efeRooms] = await Promise.all([
        firstValueFrom(this.caspioService.getServicesVisualsByServiceId(serviceId)),
        firstValueFrom(this.caspioService.getServicesEFE(serviceId))
      ]);

      await Promise.all([
        this.indexedDb.cacheServiceData(serviceId, 'visuals', visuals),
        this.indexedDb.cacheServiceData(serviceId, 'efe_rooms', efeRooms)
      ]);

      console.log('[OfflineCache] Pre-cached: visuals=' + visuals.length + ', efeRooms=' + efeRooms.length);
    } catch (error) {
      console.error('[OfflineCache] Failed to pre-cache service data:', error);
    }
  }
}
