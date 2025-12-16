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
   * Ensure visual templates are ready for use.
   * - If cached: returns immediately
   * - If download in progress: waits for it
   * - If not started: fetches from API and caches
   * 
   * Call this from pages that need templates to ensure they're available.
   */
  async ensureVisualTemplatesReady(): Promise<any[]> {
    // Check if we have cached templates
    const cached = await this.indexedDb.getCachedTemplates('visual');
    if (cached && cached.length > 0) {
      console.log(`[OfflineTemplate] ensureVisualTemplatesReady: ${cached.length} templates already cached`);
      return cached;
    }

    // Check if any download is in progress - wait for it
    for (const [key, promise] of this.downloadPromises.entries()) {
      if (key.startsWith('EFE_')) {
        console.log(`[OfflineTemplate] ensureVisualTemplatesReady: waiting for download ${key}...`);
        await promise;
        // Check again after download completes
        const afterDownload = await this.indexedDb.getCachedTemplates('visual');
        if (afterDownload && afterDownload.length > 0) {
          console.log(`[OfflineTemplate] ensureVisualTemplatesReady: ${afterDownload.length} templates available after download`);
          return afterDownload;
        }
      }
    }

    // No cache, no download in progress - fetch directly if online
    if (this.offlineService.isOnline()) {
      console.log('[OfflineTemplate] ensureVisualTemplatesReady: fetching from API...');
      try {
        const templates = await firstValueFrom(this.caspioService.getServicesVisualsTemplates());
        await this.indexedDb.cacheTemplates('visual', templates);
        console.log(`[OfflineTemplate] ensureVisualTemplatesReady: fetched and cached ${templates.length} templates`);
        return templates;
      } catch (error) {
        console.error('[OfflineTemplate] ensureVisualTemplatesReady: API fetch failed:', error);
        return [];
      }
    }

    console.warn('[OfflineTemplate] ensureVisualTemplatesReady: offline and no cache available');
    return [];
  }

  /**
   * Download complete template data for offline use.
   * Call this when user creates or opens a service.
   * Returns immediately if already downloaded.
   */
  async downloadTemplateForOffline(serviceId: string, templateType: 'EFE' | 'HUD' | 'LBW' | 'DTE', projectId?: string): Promise<void> {
    const cacheKey = `${templateType}_${serviceId}`;
    console.log(`[OfflineTemplate] downloadTemplateForOffline(${serviceId}, ${templateType}) called`);

    // Already downloading? Return existing promise
    if (this.downloadPromises.has(cacheKey)) {
      console.log(`[OfflineTemplate] Already downloading ${cacheKey}, waiting...`);
      return this.downloadPromises.get(cacheKey);
    }

    // Already ready? Check if data exists in IndexedDB
    const isReady = await this.isTemplateReady(serviceId, templateType);
    console.log(`[OfflineTemplate] isTemplateReady(${serviceId}, ${templateType}) = ${isReady}`);
    if (isReady) {
      console.log(`[OfflineTemplate] Template ${cacheKey} already cached - NOT downloading again`);
      this.downloadStatus.set(cacheKey, 'ready');
      // Don't refresh here - it would overwrite offline changes before sync completes
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

      // 3. Service-specific visuals AND their attachments (existing items for this service)
      downloads.push(
        firstValueFrom(this.caspioService.getServicesVisualsByServiceId(serviceId))
          .then(async (visuals) => {
            await this.indexedDb.cacheServiceData(serviceId, 'visuals', visuals);
            console.log('[OfflineTemplate] Service visuals cached:', visuals.length);
            
            // CRITICAL: Also cache attachments for each visual (needed for photo counts offline)
            if (visuals && visuals.length > 0) {
              console.log('[OfflineTemplate] Caching attachments for', visuals.length, 'visuals...');
              const attachmentPromises = visuals.map(async (visual: any) => {
                const visualId = visual.VisualID || visual.PK_ID;
                if (visualId) {
                  try {
                    const attachments = await firstValueFrom(
                      this.caspioService.getServiceVisualsAttachByVisualId(String(visualId))
                    );
                    await this.indexedDb.cacheServiceData(String(visualId), 'visual_attachments', attachments || []);
                    return attachments?.length || 0;
                  } catch (err) {
                    console.warn(`[OfflineTemplate] Failed to cache attachments for visual ${visualId}:`, err);
                    return 0;
                  }
                }
                return 0;
              });
              const counts = await Promise.all(attachmentPromises);
              const totalAttachments = counts.reduce((a, b) => a + b, 0);
              console.log('[OfflineTemplate] Visual attachments cached:', totalAttachments, 'total');
            }
          })
      );

      // 4. For EFE: Also download rooms and their points
      if (templateType === 'EFE') {
        downloads.push(this.downloadEFEData(serviceId));
      }

      // 5. Service record itself (also extract projectId if not provided)
      // IMPORTANT: Bypass localStorage cache (false) to get fresh data from API
      // Also check for pending UPDATE requests - don't overwrite local changes
      downloads.push(
        this.safeCacheServiceRecord(serviceId, projectId)
      );

      // 6. Global dropdown data - Services_Drop (InAttendance, WeatherConditions, etc.)
      downloads.push(
        firstValueFrom(this.caspioService.getServicesDrop())
          .then(data => this.indexedDb.cacheGlobalData('services_drop', data))
          .then(() => console.log('[OfflineTemplate] Services_Drop cached'))
          .catch(err => console.warn('[OfflineTemplate] Services_Drop cache failed:', err))
      );

      // 7. Global dropdown data - Projects_Drop (TypeOfBuilding, Style, etc.)
      downloads.push(
        firstValueFrom(this.caspioService.getProjectsDrop())
          .then(data => this.indexedDb.cacheGlobalData('projects_drop', data))
          .then(() => console.log('[OfflineTemplate] Projects_Drop cached'))
          .catch(err => console.warn('[OfflineTemplate] Projects_Drop cache failed:', err))
      );

      // 8. Status options for finalization
      downloads.push(
        firstValueFrom(this.caspioService.get('/tables/LPS_Status/records'))
          .then((response: any) => {
            const statusData = response?.Result || [];
            return this.indexedDb.cacheGlobalData('status', statusData);
          })
          .then(() => console.log('[OfflineTemplate] Status options cached'))
          .catch(err => console.warn('[OfflineTemplate] Status cache failed:', err))
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
   * Safely cache service record - checks for pending updates first
   * If there are pending updates, merge API data with local changes
   * This prevents overwriting offline changes during template download
   */
  private async safeCacheServiceRecord(serviceId: string, projectId?: string): Promise<void> {
    console.log(`[OfflineTemplate] safeCacheServiceRecord(${serviceId}) called`);
    try {
      // Check if there are pending OR syncing UPDATE requests for this service
      // Use getAllRequests() to include 'syncing' status (not just 'pending')
      const allRequests = await this.indexedDb.getAllRequests();
      console.log(`[OfflineTemplate] safeCacheServiceRecord(${serviceId}): found ${allRequests.length} total requests`);

      const serviceUpdateRequests = allRequests.filter(r =>
        r.type === 'UPDATE' &&
        r.endpoint.includes('LPS_Services') &&
        r.endpoint.includes(`PK_ID=${serviceId}`)
      );
      console.log(`[OfflineTemplate] safeCacheServiceRecord(${serviceId}): service update requests:`, serviceUpdateRequests.map(r => ({ status: r.status, data: r.data })));

      const hasPendingServiceUpdates = serviceUpdateRequests.some(r =>
        r.status === 'pending' || r.status === 'syncing'
      );
      console.log(`[OfflineTemplate] safeCacheServiceRecord(${serviceId}): hasPendingServiceUpdates = ${hasPendingServiceUpdates}`);

      // Get existing local cache (may have offline changes)
      const existingLocalService = await this.indexedDb.getCachedServiceRecord(serviceId);
      console.log(`[OfflineTemplate] safeCacheServiceRecord(${serviceId}): existingLocalService =`, existingLocalService ? JSON.stringify(existingLocalService).substring(0, 200) : 'null');

      // Fetch fresh data from API - BYPASS localStorage cache to get latest from server
      console.log(`[OfflineTemplate] safeCacheServiceRecord(${serviceId}): fetching from API...`);
      const apiService = await firstValueFrom(this.caspioService.getService(serviceId, false));
      console.log(`[OfflineTemplate] safeCacheServiceRecord(${serviceId}): apiService =`, apiService ? JSON.stringify(apiService).substring(0, 200) : 'null');

      if (hasPendingServiceUpdates && existingLocalService) {
        // Merge: Start with API data, then overlay local changes
        // This preserves any fields that were updated locally but not yet synced
        console.log('[OfflineTemplate] Service has pending updates - merging with local changes');

        // Extract the pending update data to identify changed fields
        const pendingServiceUpdates = serviceUpdateRequests
          .filter(r => r.status === 'pending' || r.status === 'syncing')
          .reduce((acc, r) => ({ ...acc, ...r.data }), {});
        console.log(`[OfflineTemplate] safeCacheServiceRecord(${serviceId}): pendingServiceUpdates =`, pendingServiceUpdates);

        // Merged service = API base + pending local changes
        const mergedService = { ...apiService, ...pendingServiceUpdates };
        console.log(`[OfflineTemplate] safeCacheServiceRecord(${serviceId}): mergedService =`, JSON.stringify(mergedService).substring(0, 200));
        await this.indexedDb.cacheServiceRecord(serviceId, mergedService);
        console.log('[OfflineTemplate] Service record cached (merged with local changes)');
      } else if (apiService) {
        // No pending updates - safe to use API data directly
        console.log(`[OfflineTemplate] safeCacheServiceRecord(${serviceId}): NO pending updates - caching API data directly`);
        await this.indexedDb.cacheServiceRecord(serviceId, apiService);
        console.log('[OfflineTemplate] Service record cached');
      } else {
        console.log(`[OfflineTemplate] safeCacheServiceRecord(${serviceId}): apiService is null - not caching`);
      }

      // Also cache the project (same logic)
      const pId = projectId || apiService?.ProjectID;
      if (pId) {
        await this.safeCacheProjectRecord(String(pId));
      }
    } catch (err) {
      console.warn('[OfflineTemplate] Could not cache service record:', err);
    }
  }

  /**
   * Safely cache project record - checks for pending updates first
   */
  private async safeCacheProjectRecord(projectId: string): Promise<void> {
    try {
      // Check for pending OR syncing UPDATE requests for this project
      const allRequests = await this.indexedDb.getAllRequests();
      const hasPendingProjectUpdates = allRequests.some(r =>
        r.type === 'UPDATE' &&
        (r.status === 'pending' || r.status === 'syncing') &&
        r.endpoint.includes('LPS_Projects') &&
        r.endpoint.includes(`PK_ID=${projectId}`)
      );

      // Get existing local cache
      const existingLocalProject = await this.indexedDb.getCachedProjectRecord(projectId);

      // Fetch fresh from API - BYPASS localStorage cache
      const apiProject = await firstValueFrom(this.caspioService.getProject(projectId, false));

      if (hasPendingProjectUpdates && existingLocalProject) {
        // Merge API data with pending local changes
        console.log('[OfflineTemplate] Project has pending updates - merging with local changes');

        const pendingProjectUpdates = allRequests
          .filter(r => r.type === 'UPDATE' && (r.status === 'pending' || r.status === 'syncing') && r.endpoint.includes('LPS_Projects') && r.endpoint.includes(`PK_ID=${projectId}`))
          .reduce((acc, r) => ({ ...acc, ...r.data }), {});

        const mergedProject = { ...apiProject, ...pendingProjectUpdates };
        await this.indexedDb.cacheProjectRecord(projectId, mergedProject);
        console.log('[OfflineTemplate] Project record cached (merged with local changes)');
      } else if (apiProject) {
        await this.indexedDb.cacheProjectRecord(projectId, apiProject);
        console.log('[OfflineTemplate] Project record cached');
      }
    } catch (err) {
      console.warn('[OfflineTemplate] Could not cache project:', err);
    }
  }

  /**
   * Download EFE-specific data (rooms, points, and point attachments)
   */
  private async downloadEFEData(serviceId: string): Promise<void> {
    console.log('[OfflineTemplate] Downloading EFE rooms, points, and attachments...');

    // Get all rooms for this service
    const rooms = await firstValueFrom(this.caspioService.getServicesEFE(serviceId));
    await this.indexedDb.cacheServiceData(serviceId, 'efe_rooms', rooms);
    console.log(`[OfflineTemplate] Cached ${rooms.length} EFE rooms`);

    // Collect all point IDs for attachment download
    const allPointIds: string[] = [];

    // Get points for each room
    const pointPromises = rooms.map(async (room: any) => {
      const roomId = room.EFEID || room.PK_ID;
      if (roomId) {
        const points = await firstValueFrom(this.caspioService.getServicesEFEPoints(String(roomId)));
        await this.indexedDb.cacheServiceData(String(roomId), 'efe_points', points);
        
        // Collect point IDs for attachment download
        for (const point of points) {
          const pointId = point.PointID || point.PK_ID;
          if (pointId) {
            allPointIds.push(String(pointId));
          }
        }
        
        return points.length;
      }
      return 0;
    });

    const pointCounts = await Promise.all(pointPromises);
    const totalPoints = pointCounts.reduce((a, b) => a + b, 0);
    console.log(`[OfflineTemplate] Cached ${totalPoints} EFE points across ${rooms.length} rooms`);

    // Download attachments for all points
    if (allPointIds.length > 0) {
      console.log(`[OfflineTemplate] Downloading attachments for ${allPointIds.length} points...`);
      
      // Fetch attachments in batches to avoid overwhelming the API
      const batchSize = 10;
      let totalAttachments = 0;
      
      for (let i = 0; i < allPointIds.length; i += batchSize) {
        const batch = allPointIds.slice(i, i + batchSize);
        
        const attachmentPromises = batch.map(async (pointId) => {
          try {
            const attachments = await firstValueFrom(
              this.caspioService.getServicesEFEAttachments(pointId)
            );
            await this.indexedDb.cacheServiceData(pointId, 'efe_point_attachments', attachments || []);
            return attachments?.length || 0;
          } catch (err) {
            console.warn(`[OfflineTemplate] Failed to fetch attachments for point ${pointId}:`, err);
            // Cache empty array to indicate we tried
            await this.indexedDb.cacheServiceData(pointId, 'efe_point_attachments', []);
            return 0;
          }
        });
        
        const counts = await Promise.all(attachmentPromises);
        totalAttachments += counts.reduce((a, b) => a + b, 0);
      }
      
      console.log(`[OfflineTemplate] Cached ${totalAttachments} EFE point attachments`);
    }
  }

  /**
   * Check if template data is already downloaded
   */
  async isTemplateReady(serviceId: string, templateType: 'EFE' | 'HUD' | 'LBW' | 'DTE'): Promise<boolean> {
    return this.indexedDb.isTemplateDownloaded(serviceId, templateType);
  }

  /**
   * Refresh service and project records from server (non-blocking)
   * Called when template is already cached but we want fresh data
   */
  private async refreshServiceAndProjectRecords(serviceId: string, projectId?: string): Promise<void> {
    console.log('[OfflineTemplate] Refreshing service/project records from server...');

    try {
      // Fetch service record - bypass localStorage cache to get fresh data
      const service = await firstValueFrom(this.caspioService.getService(serviceId, false));
      if (service) {
        await this.indexedDb.cacheServiceRecord(serviceId, service);
        console.log('[OfflineTemplate] Service record refreshed');

        // Also refresh project if we have the ID - bypass cache
        const pId = projectId || service?.ProjectID;
        if (pId) {
          const project = await firstValueFrom(this.caspioService.getProject(String(pId), false));
          if (project) {
            await this.indexedDb.cacheProjectRecord(String(pId), project);
            console.log('[OfflineTemplate] Project record refreshed');
          }
        }
      }
    } catch (error) {
      console.warn('[OfflineTemplate] Failed to refresh service/project records:', error);
      // Non-critical - continue with cached data
    }
  }

  /**
   * Get download status for UI display (sync version - checks memory only)
   */
  getDownloadStatus(serviceId: string, templateType: 'EFE' | 'HUD' | 'LBW' | 'DTE'): 'pending' | 'downloading' | 'ready' | 'error' | 'unknown' {
    const cacheKey = `${templateType}_${serviceId}`;
    return this.downloadStatus.get(cacheKey) || 'unknown';
  }

  /**
   * Check if template data is ready (async version - checks IndexedDB)
   */
  async isTemplateDataReady(serviceId: string, templateType: 'EFE' | 'HUD' | 'LBW' | 'DTE'): Promise<boolean> {
    // Check in-memory status first (fastest)
    const cacheKey = `${templateType}_${serviceId}`;
    if (this.downloadStatus.get(cacheKey) === 'ready') {
      return true;
    }

    // Check IndexedDB for cached data
    const isReady = await this.isTemplateReady(serviceId, templateType);
    if (isReady) {
      this.downloadStatus.set(cacheKey, 'ready');
    }
    return isReady;
  }

  // ============================================
  // DATA ACCESS (Always read from IndexedDB)
  // ============================================

  /**
   * Get visual templates - IndexedDB first, API fallback if empty and online
   */
  async getVisualTemplates(): Promise<any[]> {
    // First try IndexedDB cache
    const cached = await this.indexedDb.getCachedTemplates('visual');
    if (cached && cached.length > 0) {
      console.log(`[OfflineTemplate] Visual templates from cache: ${cached.length}`);
      return cached;
    }

    // Cache empty - try API if online
    if (this.offlineService.isOnline()) {
      console.log('[OfflineTemplate] Visual templates cache empty, fetching from API...');
      try {
        const templates = await firstValueFrom(this.caspioService.getServicesVisualsTemplates());
        // Cache for future offline use
        await this.indexedDb.cacheTemplates('visual', templates);
        console.log(`[OfflineTemplate] Visual templates fetched and cached: ${templates.length}`);
        return templates;
      } catch (error) {
        console.error('[OfflineTemplate] Failed to fetch visual templates:', error);
        return [];
      }
    }

    console.warn('[OfflineTemplate] Visual templates: offline and no cache available');
    return [];
  }

  /**
   * Get EFE templates - IndexedDB first, API fallback if empty and online
   */
  async getEFETemplates(): Promise<any[]> {
    // First try IndexedDB cache
    const cached = await this.indexedDb.getCachedTemplates('efe');
    if (cached && cached.length > 0) {
      console.log(`[OfflineTemplate] EFE templates from cache: ${cached.length}`);
      return cached;
    }

    // Cache empty - try API if online
    if (this.offlineService.isOnline()) {
      console.log('[OfflineTemplate] EFE templates cache empty, fetching from API...');
      try {
        const templates = await firstValueFrom(this.caspioService.getServicesEFETemplates());
        // Cache for future offline use
        await this.indexedDb.cacheTemplates('efe', templates);
        console.log(`[OfflineTemplate] EFE templates fetched and cached: ${templates.length}`);
        return templates;
      } catch (error) {
        console.error('[OfflineTemplate] Failed to fetch EFE templates:', error);
        return [];
      }
    }

    console.warn('[OfflineTemplate] EFE templates: offline and no cache available');
    return [];
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
   * Get visual attachments from IndexedDB - IndexedDB first, API fallback if online
   */
  async getVisualAttachments(visualId: string | number): Promise<any[]> {
    const key = String(visualId);
    
    // Check IndexedDB first - null means not cached, empty array means cached but no attachments
    const cached = await this.indexedDb.getCachedServiceData(key, 'visual_attachments');
    if (cached !== null && cached !== undefined) {
      console.log(`[OfflineTemplate] Visual attachments from cache for ${key}: ${cached.length}`);
      return cached;
    }

    // Cache miss - try API if online
    if (this.offlineService.isOnline()) {
      console.log(`[OfflineTemplate] Visual attachments cache miss for ${key}, fetching from API...`);
      try {
        const attachments = await firstValueFrom(
          this.caspioService.getServiceVisualsAttachByVisualId(key)
        );
        // Cache for future offline use
        await this.indexedDb.cacheServiceData(key, 'visual_attachments', attachments || []);
        console.log(`[OfflineTemplate] Visual attachments fetched and cached for ${key}: ${attachments?.length || 0}`);
        return attachments || [];
      } catch (error) {
        console.error(`[OfflineTemplate] Failed to fetch visual attachments for ${key}:`, error);
        return [];
      }
    }

    console.warn(`[OfflineTemplate] Visual attachments: offline and no cache for ${key}`);
    return [];
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
   * Get EFE point attachments from IndexedDB (offline-first)
   */
  async getEFEPointAttachments(pointId: string | number): Promise<any[]> {
    const key = String(pointId);
    
    // Check IndexedDB first
    const cached = await this.indexedDb.getCachedServiceData(key, 'efe_point_attachments');
    if (cached !== null && cached !== undefined) {
      console.log(`[OfflineTemplate] EFE point attachments from cache for ${key}: ${cached.length}`);
      return cached;
    }

    // Cache miss - try API if online
    if (this.offlineService.isOnline()) {
      console.log(`[OfflineTemplate] EFE point attachments cache miss for ${key}, fetching from API...`);
      try {
        const attachments = await firstValueFrom(
          this.caspioService.getServicesEFEAttachments(key)
        );
        // Cache for future offline use
        await this.indexedDb.cacheServiceData(key, 'efe_point_attachments', attachments || []);
        console.log(`[OfflineTemplate] EFE point attachments fetched and cached for ${key}: ${attachments?.length || 0}`);
        return attachments || [];
      } catch (error) {
        console.error(`[OfflineTemplate] Failed to fetch EFE point attachments for ${key}:`, error);
        return [];
      }
    }

    console.warn(`[OfflineTemplate] EFE point attachments: offline and no cache for ${key}`);
    return [];
  }

  /**
   * Get service record from IndexedDB
   */
  async getService(serviceId: string): Promise<any | null> {
    console.log(`[OfflineTemplate] getService(${serviceId}) called`);
    const result = await this.indexedDb.getCachedServiceRecord(serviceId);
    console.log(`[OfflineTemplate] getService(${serviceId}) returning:`, result ? JSON.stringify(result).substring(0, 200) : 'null');
    return result;
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
    console.log(`[OfflineTemplate] updateService(${serviceId}) called with updates:`, updates);

    // Queue the update - serviceId param is actually PK_ID from route
    await this.indexedDb.addPendingRequest({
      type: 'UPDATE',
      endpoint: `/api/caspio-proxy/tables/LPS_Services/records?q.where=PK_ID=${serviceId}`,
      method: 'PUT',
      data: updates,
      dependencies: [],
      status: 'pending',
      priority: 'normal',
    });
    console.log(`[OfflineTemplate] updateService(${serviceId}): pending request added`);

    // Update local cache - ALWAYS update, even if no existing record
    const existingService = await this.indexedDb.getCachedServiceRecord(serviceId);
    console.log(`[OfflineTemplate] updateService(${serviceId}): existingService =`, existingService ? JSON.stringify(existingService).substring(0, 200) : 'null');

    const updatedService = existingService
      ? { ...existingService, ...updates }
      : { PK_ID: serviceId, ...updates };
    console.log(`[OfflineTemplate] updateService(${serviceId}): updatedService =`, JSON.stringify(updatedService).substring(0, 200));

    await this.indexedDb.cacheServiceRecord(serviceId, updatedService);

    console.log(`[OfflineTemplate] updateService(${serviceId}): DONE - service cached`);
  }

  /**
   * Update project record - saves to IndexedDB and queues for sync
   */
  async updateProject(projectId: string, updates: any): Promise<void> {
    // Queue the update - use /api/caspio-proxy (matching CaspioService pattern)
    await this.indexedDb.addPendingRequest({
      type: 'UPDATE',
      endpoint: `/api/caspio-proxy/tables/LPS_Projects/records?q.where=PK_ID=${projectId}`,
      method: 'PUT',
      data: updates,
      dependencies: [],
      status: 'pending',
      priority: 'normal',
    });

    // Update local cache - ALWAYS update, even if no existing record
    const existingProject = await this.indexedDb.getCachedProjectRecord(projectId);
    const updatedProject = existingProject
      ? { ...existingProject, ...updates }
      : { PK_ID: projectId, ...updates };
    await this.indexedDb.cacheProjectRecord(projectId, updatedProject);

    console.log(`[OfflineTemplate] Updated project ${projectId} (pending sync)`);
  }

  /**
   * Get project record from IndexedDB
   */
  async getProject(projectId: string): Promise<any | null> {
    return this.indexedDb.getCachedProjectRecord(projectId);
  }

  // ============================================
  // GLOBAL DATA ACCESS (Dropdowns, Status)
  // ============================================

  /**
   * Get Services_Drop dropdown options from IndexedDB
   * Falls back to API if not cached and online
   */
  async getServicesDrop(): Promise<any[]> {
    // Try IndexedDB first
    const cached = await this.indexedDb.getCachedGlobalData('services_drop');
    if (cached && cached.length > 0) {
      console.log('[OfflineTemplate] Loaded Services_Drop from cache:', cached.length);
      return cached;
    }

    // If online, fetch and cache
    if (this.offlineService.isOnline()) {
      try {
        const data = await firstValueFrom(this.caspioService.getServicesDrop());
        await this.indexedDb.cacheGlobalData('services_drop', data);
        console.log('[OfflineTemplate] Fetched and cached Services_Drop:', data.length);
        return data;
      } catch (error) {
        console.error('[OfflineTemplate] Failed to fetch Services_Drop:', error);
      }
    }

    console.warn('[OfflineTemplate] No Services_Drop data available');
    return [];
  }

  /**
   * Get Projects_Drop dropdown options from IndexedDB
   * Falls back to API if not cached and online
   */
  async getProjectsDrop(): Promise<any[]> {
    // Try IndexedDB first
    const cached = await this.indexedDb.getCachedGlobalData('projects_drop');
    if (cached && cached.length > 0) {
      console.log('[OfflineTemplate] Loaded Projects_Drop from cache:', cached.length);
      return cached;
    }

    // If online, fetch and cache
    if (this.offlineService.isOnline()) {
      try {
        const data = await firstValueFrom(this.caspioService.getProjectsDrop());
        await this.indexedDb.cacheGlobalData('projects_drop', data);
        console.log('[OfflineTemplate] Fetched and cached Projects_Drop:', data.length);
        return data;
      } catch (error) {
        console.error('[OfflineTemplate] Failed to fetch Projects_Drop:', error);
      }
    }

    console.warn('[OfflineTemplate] No Projects_Drop data available');
    return [];
  }

  /**
   * Get Status options from IndexedDB
   * Falls back to API if not cached and online
   */
  async getStatusOptions(): Promise<any[]> {
    // Try IndexedDB first
    const cached = await this.indexedDb.getCachedGlobalData('status');
    if (cached && cached.length > 0) {
      console.log('[OfflineTemplate] Loaded Status options from cache:', cached.length);
      return cached;
    }

    // If online, fetch and cache
    if (this.offlineService.isOnline()) {
      try {
        const response: any = await firstValueFrom(this.caspioService.get('/tables/LPS_Status/records'));
        const data = response?.Result || [];
        await this.indexedDb.cacheGlobalData('status', data);
        console.log('[OfflineTemplate] Fetched and cached Status options:', data.length);
        return data;
      } catch (error) {
        console.error('[OfflineTemplate] Failed to fetch Status options:', error);
      }
    }

    console.warn('[OfflineTemplate] No Status options available');
    return [];
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
