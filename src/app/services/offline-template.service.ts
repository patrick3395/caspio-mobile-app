import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { IndexedDbService } from './indexed-db.service';
import { CaspioService } from './caspio.service';
import { OfflineService } from './offline.service';

/**
 * Offline-First Template Service
 *
 * Downloads and caches complete template data when a service is created/opened.
 * Makes IndexedDB the PRIMARY data source - API calls just sync to server.
 *
 * Flow:
 * 1. Service created/opened → downloadTemplateForOffline()
 * 2. All reads → getXxx() methods (read from IndexedDB)
 * 3. All writes → IndexedDB first, then queue for sync
 * 4. Background sync → Push to server when online
 */
@Injectable({
  providedIn: 'root'
})
export class OfflineTemplateService {
  // Track download status per service
  private downloadStatus = new Map<string, 'pending' | 'downloading' | 'ready' | 'error'>();
  private downloadPromises = new Map<string, Promise<void>>();

  constructor(
    private indexedDb: IndexedDbService,
    private caspioService: CaspioService,
    private offlineService: OfflineService
  ) {}

  // ============================================
  // TEMPLATE DOWNLOAD (Call when service created/opened)
  // ============================================

  /**
   * Download complete template data for offline use.
   * Call this when user creates or opens a service.
   * Returns immediately if already downloaded.
   */
  async downloadTemplateForOffline(serviceId: string, templateType: 'EFE' | 'HUD' | 'LBW' | 'DTE', projectId?: string): Promise<void> {
    const cacheKey = `${templateType}_${serviceId}`;

    // Already downloading? Return existing promise
    if (this.downloadPromises.has(cacheKey)) {
      console.log(`[OfflineTemplate] Already downloading ${cacheKey}, waiting...`);
      return this.downloadPromises.get(cacheKey);
    }

    // Already ready? Check if data exists in IndexedDB
    const isReady = await this.isTemplateReady(serviceId, templateType);
    if (isReady) {
      console.log(`[OfflineTemplate] Template ${cacheKey} already cached`);
      this.downloadStatus.set(cacheKey, 'ready');
      return;
    }

    // Need to download - check if online
    if (!this.offlineService.isOnline()) {
      console.warn(`[OfflineTemplate] Cannot download ${cacheKey} - offline`);
      this.downloadStatus.set(cacheKey, 'error');
      throw new Error('Cannot download template while offline');
    }

    // Start download
    console.log(`[OfflineTemplate] Starting download for ${cacheKey}...`);
    this.downloadStatus.set(cacheKey, 'downloading');

    const downloadPromise = this.performDownload(serviceId, templateType, cacheKey, projectId);
    this.downloadPromises.set(cacheKey, downloadPromise);

    try {
      await downloadPromise;
      this.downloadStatus.set(cacheKey, 'ready');
      console.log(`[OfflineTemplate] Download complete for ${cacheKey}`);
    } catch (error) {
      this.downloadStatus.set(cacheKey, 'error');
      console.error(`[OfflineTemplate] Download failed for ${cacheKey}:`, error);
      throw error;
    } finally {
      this.downloadPromises.delete(cacheKey);
    }
  }

  /**
   * Perform the actual download of all template data
   */
  private async performDownload(serviceId: string, templateType: 'EFE' | 'HUD' | 'LBW' | 'DTE', cacheKey: string, projectId?: string): Promise<void> {
    console.log(`[OfflineTemplate] Downloading all data for ${cacheKey}...`);

    try {
      // Download in parallel for speed
      const downloads: Promise<any>[] = [];

      // 1. Visual Templates (categories, fields, etc.) - shared across all types
      downloads.push(
        firstValueFrom(this.caspioService.getServicesVisualsTemplates())
          .then(templates => this.indexedDb.cacheTemplates('visual', templates))
          .then(() => console.log('[OfflineTemplate] Visual templates cached'))
      );

      // 2. EFE Templates (room templates, point definitions)
      downloads.push(
        firstValueFrom(this.caspioService.getServicesEFETemplates())
          .then(templates => this.indexedDb.cacheTemplates('efe', templates))
          .then(() => console.log('[OfflineTemplate] EFE templates cached'))
      );

      // 3. Service-specific visuals (existing items for this service)
      downloads.push(
        firstValueFrom(this.caspioService.getServicesVisualsByServiceId(serviceId))
          .then(visuals => this.indexedDb.cacheServiceData(serviceId, 'visuals', visuals))
          .then(() => console.log('[OfflineTemplate] Service visuals cached'))
      );

      // 4. For EFE: Also download rooms and their points
      if (templateType === 'EFE') {
        downloads.push(this.downloadEFEData(serviceId));
      }

      // 5. Service record itself (also extract projectId if not provided)
      downloads.push(
        firstValueFrom(this.caspioService.getService(serviceId))
          .then(async (service) => {
            await this.indexedDb.cacheServiceRecord(serviceId, service);
            console.log('[OfflineTemplate] Service record cached');

            // Also cache the project if we have the ID
            const pId = projectId || service?.ProjectID;
            if (pId) {
              try {
                const project = await firstValueFrom(this.caspioService.getProject(String(pId)));
                await this.indexedDb.cacheProjectRecord(String(pId), project);
                console.log('[OfflineTemplate] Project record cached');
              } catch (err) {
                console.warn('[OfflineTemplate] Could not cache project:', err);
              }
            }
          })
      );

      await Promise.all(downloads);

      // Mark as fully downloaded
      await this.indexedDb.markTemplateDownloaded(serviceId, templateType);

      console.log(`[OfflineTemplate] All data cached for ${cacheKey}`);
    } catch (error) {
      console.error(`[OfflineTemplate] Error downloading ${cacheKey}:`, error);
      throw error;
    }
  }

  /**
   * Download EFE-specific data (rooms and points)
   */
  private async downloadEFEData(serviceId: string): Promise<void> {
    console.log('[OfflineTemplate] Downloading EFE rooms and points...');

    // Get all rooms for this service
    const rooms = await firstValueFrom(this.caspioService.getServicesEFE(serviceId));
    await this.indexedDb.cacheServiceData(serviceId, 'efe_rooms', rooms);
    console.log(`[OfflineTemplate] Cached ${rooms.length} EFE rooms`);

    // Get points for each room
    const pointPromises = rooms.map(async (room: any) => {
      const roomId = room.EFEID || room.PK_ID;
      if (roomId) {
        const points = await firstValueFrom(this.caspioService.getServicesEFEPoints(String(roomId)));
        await this.indexedDb.cacheServiceData(String(roomId), 'efe_points', points);
        return points.length;
      }
      return 0;
    });

    const pointCounts = await Promise.all(pointPromises);
    const totalPoints = pointCounts.reduce((a, b) => a + b, 0);
    console.log(`[OfflineTemplate] Cached ${totalPoints} EFE points across ${rooms.length} rooms`);
  }

  /**
   * Check if template data is already downloaded
   */
  async isTemplateReady(serviceId: string, templateType: 'EFE' | 'HUD' | 'LBW' | 'DTE'): Promise<boolean> {
    return this.indexedDb.isTemplateDownloaded(serviceId, templateType);
  }

  /**
   * Get download status for UI display
   */
  getDownloadStatus(serviceId: string, templateType: 'EFE' | 'HUD' | 'LBW' | 'DTE'): 'pending' | 'downloading' | 'ready' | 'error' | 'unknown' {
    const cacheKey = `${templateType}_${serviceId}`;
    return this.downloadStatus.get(cacheKey) || 'unknown';
  }

  // ============================================
  // DATA ACCESS (Always read from IndexedDB)
  // ============================================

  /**
   * Get visual templates from IndexedDB
   */
  async getVisualTemplates(): Promise<any[]> {
    const cached = await this.indexedDb.getCachedTemplates('visual');
    return cached || [];
  }

  /**
   * Get EFE templates from IndexedDB
   */
  async getEFETemplates(): Promise<any[]> {
    const cached = await this.indexedDb.getCachedTemplates('efe');
    return cached || [];
  }

  /**
   * Get visuals for a service from IndexedDB
   */
  async getVisualsByService(serviceId: string): Promise<any[]> {
    // Get cached visuals
    const cached = await this.indexedDb.getCachedServiceData(serviceId, 'visuals') || [];

    // Merge with pending offline visuals
    const pending = await this.getPendingVisuals(serviceId);

    console.log(`[OfflineTemplate] Visuals: ${cached.length} cached + ${pending.length} pending`);
    return [...cached, ...pending];
  }

  /**
   * Get EFE rooms for a service from IndexedDB
   */
  async getEFERooms(serviceId: string): Promise<any[]> {
    // Get cached rooms
    const cached = await this.indexedDb.getCachedServiceData(serviceId, 'efe_rooms') || [];

    // Merge with pending offline rooms
    const pending = await this.indexedDb.getPendingEFEByService(serviceId);
    const pendingRooms = pending
      .filter(p => p.type === 'room')
      .map(p => ({
        ...p.data,
        EFEID: p.tempId,
        PK_ID: p.tempId,
        _tempId: p.tempId,
        _localOnly: true,
        _syncing: true,
      }));

    console.log(`[OfflineTemplate] EFE Rooms: ${cached.length} cached + ${pendingRooms.length} pending`);
    return [...cached, ...pendingRooms];
  }

  /**
   * Get EFE points for a room from IndexedDB
   */
  async getEFEPoints(roomId: string): Promise<any[]> {
    // Get cached points
    const cached = await this.indexedDb.getCachedServiceData(roomId, 'efe_points') || [];

    // Merge with pending offline points
    const pending = await this.indexedDb.getPendingEFEPoints(roomId);
    const pendingPoints = pending.map(p => ({
      ...p.data,
      PointID: p.tempId,
      PK_ID: p.tempId,
      _tempId: p.tempId,
      _localOnly: true,
      _syncing: true,
    }));

    console.log(`[OfflineTemplate] EFE Points for ${roomId}: ${cached.length} cached + ${pendingPoints.length} pending`);
    return [...cached, ...pendingPoints];
  }

  /**
   * Get service record from IndexedDB
   */
  async getService(serviceId: string): Promise<any | null> {
    return this.indexedDb.getCachedServiceRecord(serviceId);
  }

  /**
   * Get pending (not yet synced) visuals for a service
   */
  private async getPendingVisuals(serviceId: string): Promise<any[]> {
    const pendingRequests = await this.indexedDb.getPendingRequests();

    return pendingRequests
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
  }

  // ============================================
  // DATA WRITES (IndexedDB first, then sync)
  // ============================================

  /**
   * Create a visual - saves to IndexedDB and queues for sync
   */
  async createVisual(visualData: any, serviceId: string): Promise<any> {
    const tempId = `temp_visual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create the visual object with temp ID
    const visual = {
      ...visualData,
      PK_ID: tempId,
      VisualID: tempId,
      ServiceID: parseInt(serviceId),
      _tempId: tempId,
      _localOnly: true,
      _syncing: true,
    };

    // Add to IndexedDB pending queue
    await this.indexedDb.addPendingRequest({
      type: 'CREATE',
      tempId: tempId,
      endpoint: 'LPS_Services_Visuals',
      method: 'POST',
      data: visualData,
      dependencies: [],
      status: 'pending',
      priority: 'high',
    });

    // Update local cache to include this visual immediately
    const existingVisuals = await this.indexedDb.getCachedServiceData(serviceId, 'visuals') || [];
    await this.indexedDb.cacheServiceData(serviceId, 'visuals', [...existingVisuals, visual]);

    console.log(`[OfflineTemplate] Created visual ${tempId} (pending sync)`);
    return visual;
  }

  /**
   * Update a visual - saves to IndexedDB and queues for sync
   */
  async updateVisual(visualId: string, updates: any, serviceId: string): Promise<void> {
    const isTempId = visualId.startsWith('temp_');

    if (isTempId) {
      // Update the pending request data
      await this.indexedDb.updatePendingRequestData(visualId, updates);
    } else {
      // Queue an update for a synced visual
      await this.indexedDb.addPendingRequest({
        type: 'UPDATE',
        endpoint: `LPS_Services_Visuals/${visualId}`,
        method: 'PUT',
        data: updates,
        dependencies: [],
        status: 'pending',
        priority: 'normal',
      });
    }

    // Update local cache
    const existingVisuals = await this.indexedDb.getCachedServiceData(serviceId, 'visuals') || [];
    const updatedVisuals = existingVisuals.map((v: any) => {
      if (String(v.PK_ID) === String(visualId) || v._tempId === visualId) {
        return { ...v, ...updates };
      }
      return v;
    });
    await this.indexedDb.cacheServiceData(serviceId, 'visuals', updatedVisuals);

    console.log(`[OfflineTemplate] Updated visual ${visualId} (pending sync)`);
  }

  /**
   * Create an EFE room - saves to IndexedDB and queues for sync
   */
  async createEFERoom(roomData: any, serviceId: string): Promise<any> {
    const tempId = `temp_efe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create room object with temp ID
    const room = {
      ...roomData,
      EFEID: tempId,
      PK_ID: tempId,
      ServiceID: parseInt(serviceId),
      _tempId: tempId,
      _localOnly: true,
      _syncing: true,
    };

    // Add to pending EFE data
    await this.indexedDb.addPendingEFE({
      tempId: tempId,
      serviceId: serviceId,
      type: 'room',
      data: roomData,
    });

    // Update local cache
    const existingRooms = await this.indexedDb.getCachedServiceData(serviceId, 'efe_rooms') || [];
    await this.indexedDb.cacheServiceData(serviceId, 'efe_rooms', [...existingRooms, room]);

    console.log(`[OfflineTemplate] Created EFE room ${tempId} (pending sync)`);
    return room;
  }

  /**
   * Create an EFE point - saves to IndexedDB and queues for sync
   */
  async createEFEPoint(pointData: any, roomId: string, serviceId: string): Promise<any> {
    const tempId = `temp_point_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create point object with temp ID
    const point = {
      ...pointData,
      PointID: tempId,
      PK_ID: tempId,
      EFEID: roomId,
      _tempId: tempId,
      _localOnly: true,
      _syncing: true,
    };

    // Add to pending EFE data
    await this.indexedDb.addPendingEFE({
      tempId: tempId,
      serviceId: serviceId,
      type: 'point',
      parentId: roomId,
      data: pointData,
    });

    // Update local cache
    const existingPoints = await this.indexedDb.getCachedServiceData(roomId, 'efe_points') || [];
    await this.indexedDb.cacheServiceData(roomId, 'efe_points', [...existingPoints, point]);

    console.log(`[OfflineTemplate] Created EFE point ${tempId} (pending sync)`);
    return point;
  }

  /**
   * Update service record - saves to IndexedDB and queues for sync
   */
  async updateService(serviceId: string, updates: any): Promise<void> {
    // Queue the update
    await this.indexedDb.addPendingRequest({
      type: 'UPDATE',
      endpoint: `LPS_Services/${serviceId}`,
      method: 'PUT',
      data: updates,
      dependencies: [],
      status: 'pending',
      priority: 'normal',
    });

    // Update local cache
    const existingService = await this.indexedDb.getCachedServiceRecord(serviceId);
    if (existingService) {
      await this.indexedDb.cacheServiceRecord(serviceId, { ...existingService, ...updates });
    }

    console.log(`[OfflineTemplate] Updated service ${serviceId} (pending sync)`);
  }

  /**
   * Update project record - saves to IndexedDB and queues for sync
   */
  async updateProject(projectId: string, updates: any): Promise<void> {
    // Queue the update
    await this.indexedDb.addPendingRequest({
      type: 'UPDATE',
      endpoint: `LPS_Projects/${projectId}`,
      method: 'PUT',
      data: updates,
      dependencies: [],
      status: 'pending',
      priority: 'normal',
    });

    // Update local cache
    const existingProject = await this.indexedDb.getCachedProjectRecord(projectId);
    if (existingProject) {
      await this.indexedDb.cacheProjectRecord(projectId, { ...existingProject, ...updates });
    }

    console.log(`[OfflineTemplate] Updated project ${projectId} (pending sync)`);
  }

  /**
   * Get project record from IndexedDB
   */
  async getProject(projectId: string): Promise<any | null> {
    return this.indexedDb.getCachedProjectRecord(projectId);
  }

  // ============================================
  // SYNC CALLBACKS (Update IndexedDB after sync)
  // ============================================

  /**
   * Called after a visual is synced - update cache with real ID
   */
  async onVisualSynced(tempId: string, realId: string, serviceId: string): Promise<void> {
    // Update cache - replace temp ID with real ID
    const existingVisuals = await this.indexedDb.getCachedServiceData(serviceId, 'visuals') || [];
    const updatedVisuals = existingVisuals.map((v: any) => {
      if (v._tempId === tempId) {
        return {
          ...v,
          PK_ID: realId,
          VisualID: realId,
          _tempId: undefined,
          _localOnly: false,
          _syncing: false,
        };
      }
      return v;
    });
    await this.indexedDb.cacheServiceData(serviceId, 'visuals', updatedVisuals);

    // Store mapping for dependent items (photos)
    await this.indexedDb.mapTempId(tempId, realId, 'visual');

    console.log(`[OfflineTemplate] Visual synced: ${tempId} → ${realId}`);
  }

  /**
   * Called after an EFE room is synced - update cache with real ID
   */
  async onEFERoomSynced(tempId: string, realId: string, serviceId: string): Promise<void> {
    // Update cache
    const existingRooms = await this.indexedDb.getCachedServiceData(serviceId, 'efe_rooms') || [];
    const updatedRooms = existingRooms.map((r: any) => {
      if (r._tempId === tempId) {
        return {
          ...r,
          EFEID: realId,
          PK_ID: realId,
          _tempId: undefined,
          _localOnly: false,
          _syncing: false,
        };
      }
      return r;
    });
    await this.indexedDb.cacheServiceData(serviceId, 'efe_rooms', updatedRooms);

    // Remove from pending
    await this.indexedDb.removePendingEFE(tempId);

    // Store mapping for dependent items (points)
    await this.indexedDb.mapTempId(tempId, realId, 'efe_room');

    console.log(`[OfflineTemplate] EFE Room synced: ${tempId} → ${realId}`);
  }

  /**
   * Refresh cache from server (call when coming online after extended offline)
   */
  async refreshFromServer(serviceId: string): Promise<void> {
    if (!this.offlineService.isOnline()) {
      console.log('[OfflineTemplate] Cannot refresh - offline');
      return;
    }

    console.log('[OfflineTemplate] Refreshing cache from server...');

    try {
      // Re-download all data
      const [visuals, rooms] = await Promise.all([
        firstValueFrom(this.caspioService.getServicesVisualsByServiceId(serviceId)),
        firstValueFrom(this.caspioService.getServicesEFE(serviceId)),
      ]);

      await Promise.all([
        this.indexedDb.cacheServiceData(serviceId, 'visuals', visuals),
        this.indexedDb.cacheServiceData(serviceId, 'efe_rooms', rooms),
      ]);

      console.log('[OfflineTemplate] Cache refreshed from server');
    } catch (error) {
      console.error('[OfflineTemplate] Error refreshing cache:', error);
    }
  }
}
