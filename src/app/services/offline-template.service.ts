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
    console.log('[OfflineTemplate] ensureVisualTemplatesReady() called');
    
    // Check if we have cached templates
    try {
      const cached = await this.indexedDb.getCachedTemplates('visual');
      console.log('[OfflineTemplate] IndexedDB getCachedTemplates result:', cached ? `${cached.length} templates` : 'null/undefined');
      
      if (cached && cached.length > 0) {
        console.log(`[OfflineTemplate] ✅ ensureVisualTemplatesReady: ${cached.length} templates already cached`);
        return cached;
      }
    } catch (dbError) {
      console.error('[OfflineTemplate] ❌ IndexedDB error when getting cached templates:', dbError);
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
   * Force refresh template data from the server.
   * Clears cached data and re-downloads everything.
   * Use this when user wants to sync or when data appears stale.
   */
  async forceRefreshTemplateData(serviceId: string, templateType: 'EFE' | 'HUD' | 'LBW' | 'DTE', projectId?: string): Promise<void> {
    if (!this.offlineService.isOnline()) {
      console.warn('[OfflineTemplate] Cannot force refresh while offline');
      return;
    }

    const cacheKey = `${templateType}_${serviceId}`;
    console.log(`[OfflineTemplate] Force refreshing ${cacheKey}...`);

    // Clear the download status to allow re-download
    this.downloadStatus.delete(cacheKey);

    // Clear cached service data (but NOT templates as those are shared)
    await this.indexedDb.clearCachedServiceData(serviceId, 'visuals');
    await this.indexedDb.clearCachedServiceData(serviceId, 'efe_rooms');
    
    // Clear cached photos for this service
    await this.indexedDb.clearCachedPhotosForService(serviceId);
    
    // Mark template as not downloaded so it will re-download
    await this.indexedDb.removeTemplateDownloadStatus(serviceId, templateType);

    // Re-download
    await this.performDownload(serviceId, templateType, cacheKey, projectId);
    this.downloadStatus.set(cacheKey, 'ready');
    
    console.log(`[OfflineTemplate] Force refresh complete for ${cacheKey}`);
  }

  /**
   * Perform the actual download of all template data
   */
  private async performDownload(serviceId: string, templateType: 'EFE' | 'HUD' | 'LBW' | 'DTE', cacheKey: string, projectId?: string): Promise<void> {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║         OFFLINE TEMPLATE DOWNLOAD STARTING                      ║');
    console.log(`║  Service: ${serviceId.padEnd(10)} | Type: ${templateType.padEnd(5)} | Key: ${cacheKey.padEnd(15)}  ║`);
    console.log('╚════════════════════════════════════════════════════════════════╝');

    // Track what we download for final summary
    const downloadSummary = {
      visualTemplates: 0,
      efeTemplates: 0,
      serviceVisuals: 0,
      visualAttachments: 0,
      efeRooms: 0,
      efePoints: 0,
      efePointAttachments: 0,
      serviceRecord: false,
      projectRecord: false,
      servicesDrop: 0,
      projectsDrop: 0,
      statusOptions: 0,
      efeDrop: 0
    };

    try {
      // Download in parallel for speed
      const downloads: Promise<any>[] = [];

      // 1. Visual Templates (Structural System categories - comments, limitations, deficiencies)
      console.log('\n[1/8] 📋 Downloading VISUAL TEMPLATES (Structural System categories)...');
      downloads.push(
        firstValueFrom(this.caspioService.getServicesVisualsTemplates())
          .then(async (templates) => {
            downloadSummary.visualTemplates = templates?.length || 0;
            await this.indexedDb.cacheTemplates('visual', templates);
            console.log(`    ✅ Visual Templates: ${downloadSummary.visualTemplates} templates cached`);
            console.log(`    📦 Categories include: ${[...new Set(templates?.map((t: any) => t.Category) || [])].slice(0, 5).join(', ')}...`);
            return templates;
          })
      );

      // 2. EFE Templates (room templates with elevation points)
      console.log('[2/8] 🏠 Downloading EFE TEMPLATES (Room elevation templates)...');
      downloads.push(
        firstValueFrom(this.caspioService.getServicesEFETemplates())
          .then(async (templates) => {
            downloadSummary.efeTemplates = templates?.length || 0;
            await this.indexedDb.cacheTemplates('efe', templates);
            console.log(`    ✅ EFE Templates: ${downloadSummary.efeTemplates} room templates cached`);
            return templates;
          })
      );

      // 3. Service-specific visuals AND their attachments (existing items for this service)
      console.log('[3/8] 🔍 Downloading SERVICE VISUALS (existing structural items for this service)...');
      downloads.push(
        firstValueFrom(this.caspioService.getServicesVisualsByServiceId(serviceId))
          .then(async (visuals) => {
            downloadSummary.serviceVisuals = visuals?.length || 0;
            await this.indexedDb.cacheServiceData(serviceId, 'visuals', visuals);
            console.log(`    ✅ Service Visuals: ${downloadSummary.serviceVisuals} existing items cached`);
            
            // CRITICAL: Also cache attachments for each visual (needed for photo counts offline)
            if (visuals && visuals.length > 0) {
              console.log(`    📸 Caching photo attachments for ${visuals.length} visuals...`);
              const allAttachments: any[] = [];
              
              const attachmentPromises = visuals.map(async (visual: any) => {
                const visualId = visual.VisualID || visual.PK_ID;
                if (visualId) {
                  try {
                    const attachments = await firstValueFrom(
                      this.caspioService.getServiceVisualsAttachByVisualId(String(visualId))
                    );
                    await this.indexedDb.cacheServiceData(String(visualId), 'visual_attachments', attachments || []);
                    // Collect all attachments for image download
                    if (attachments && attachments.length > 0) {
                      allAttachments.push(...attachments);
                    }
                    return attachments?.length || 0;
                  } catch (err) {
                    console.warn(`    ⚠️ Failed to cache attachments for visual ${visualId}:`, err);
                    return 0;
                  }
                }
                return 0;
              });
              const counts = await Promise.all(attachmentPromises);
              downloadSummary.visualAttachments = counts.reduce((a, b) => a + b, 0);
              console.log(`    ✅ Visual Attachments: ${downloadSummary.visualAttachments} attachment records cached`);
              
              // CRITICAL: Download and cache actual image files for offline viewing
              if (allAttachments.length > 0) {
                console.log(`    🖼️ Downloading ${allAttachments.length} actual images for offline...`);
                await this.downloadAndCacheImages(allAttachments, serviceId);
                console.log(`    ✅ Images downloaded and cached for offline viewing`);
              }
            } else {
              console.log('    ℹ️ No existing visuals - new template (this is normal)');
            }
            return visuals;
          })
      );

      // 4. For EFE: Also download rooms, points, and point attachments
      if (templateType === 'EFE') {
        console.log('[4/8] 📐 Downloading EFE DATA (rooms, points, and point attachments)...');
        downloads.push(
          this.downloadEFEDataWithSummary(serviceId, downloadSummary)
        );
      }

      // 5. Service record itself
      console.log('[5/8] 📝 Downloading SERVICE RECORD...');
      downloads.push(
        this.safeCacheServiceRecord(serviceId, projectId)
          .then(() => {
            downloadSummary.serviceRecord = true;
            downloadSummary.projectRecord = true;
            console.log('    ✅ Service and Project records cached');
          })
      );

      // 6. Global dropdown data - Services_Drop
      console.log('[6/8] 📋 Downloading SERVICES_DROP (dropdown options)...');
      downloads.push(
        firstValueFrom(this.caspioService.getServicesDrop())
          .then(async (data) => {
            downloadSummary.servicesDrop = data?.length || 0;
            await this.indexedDb.cacheGlobalData('services_drop', data);
            console.log(`    ✅ Services_Drop: ${downloadSummary.servicesDrop} dropdown options cached`);
            return data;
          })
          .catch(err => {
            console.warn('    ⚠️ Services_Drop cache failed:', err);
            return [];
          })
      );

      // 7. Global dropdown data - Projects_Drop
      console.log('[7/8] 📋 Downloading PROJECTS_DROP (dropdown options)...');
      downloads.push(
        firstValueFrom(this.caspioService.getProjectsDrop())
          .then(async (data) => {
            downloadSummary.projectsDrop = data?.length || 0;
            await this.indexedDb.cacheGlobalData('projects_drop', data);
            console.log(`    ✅ Projects_Drop: ${downloadSummary.projectsDrop} dropdown options cached`);
            return data;
          })
          .catch(err => {
            console.warn('    ⚠️ Projects_Drop cache failed:', err);
            return [];
          })
      );

      // 8. Status options for finalization
      console.log('[8/9] 🏷️ Downloading STATUS OPTIONS...');
      downloads.push(
        firstValueFrom(this.caspioService.get('/tables/LPS_Status/records'))
          .then(async (response: any) => {
            const statusData = response?.Result || [];
            downloadSummary.statusOptions = statusData.length;
            await this.indexedDb.cacheGlobalData('status', statusData);
            console.log(`    ✅ Status Options: ${downloadSummary.statusOptions} options cached`);
            return statusData;
          })
          .catch(err => {
            console.warn('    ⚠️ Status cache failed:', err);
            return [];
          })
      );

      // 9. EFE Drop options (FDF dropdown for elevation plots)
      if (templateType === 'EFE') {
        console.log('[9/9] 📋 Downloading EFE_DROP (FDF dropdown options)...');
        downloads.push(
          firstValueFrom(this.caspioService.getServicesEFEDrop())
            .then(async (data) => {
              downloadSummary.efeDrop = data?.length || 0;
              await this.indexedDb.cacheGlobalData('efe_drop', data);
              console.log(`    ✅ EFE_Drop (FDF options): ${downloadSummary.efeDrop} options cached`);
              return data;
            })
            .catch(err => {
              console.warn('    ⚠️ EFE_Drop cache failed:', err);
              return [];
            })
        );
      }

      await Promise.all(downloads);

      // Mark as fully downloaded
      await this.indexedDb.markTemplateDownloaded(serviceId, templateType);

      // Print final summary
      console.log('\n╔════════════════════════════════════════════════════════════════╗');
      console.log('║            📦 TEMPLATE DOWNLOAD COMPLETE                        ║');
      console.log('╠════════════════════════════════════════════════════════════════╣');
      console.log(`║  📋 Visual Templates (Structural System):  ${String(downloadSummary.visualTemplates).padStart(5)} templates    ║`);
      console.log(`║  🏠 EFE Templates (Room definitions):      ${String(downloadSummary.efeTemplates).padStart(5)} templates    ║`);
      console.log(`║  🔍 Service Visuals (existing items):      ${String(downloadSummary.serviceVisuals).padStart(5)} items        ║`);
      console.log(`║  📸 Visual Attachments (photos):           ${String(downloadSummary.visualAttachments).padStart(5)} photos       ║`);
      console.log(`║  📐 EFE Rooms:                             ${String(downloadSummary.efeRooms).padStart(5)} rooms        ║`);
      console.log(`║  📍 EFE Points:                            ${String(downloadSummary.efePoints).padStart(5)} points       ║`);
      console.log(`║  🖼️ EFE Point Attachments:                 ${String(downloadSummary.efePointAttachments).padStart(5)} photos       ║`);
      console.log(`║  📝 Service Record:                        ${downloadSummary.serviceRecord ? '  YES' : '   NO'}             ║`);
      console.log(`║  📝 Project Record:                        ${downloadSummary.projectRecord ? '  YES' : '   NO'}             ║`);
      console.log(`║  📋 Services_Drop options:                 ${String(downloadSummary.servicesDrop).padStart(5)} options      ║`);
      console.log(`║  📋 Projects_Drop options:                 ${String(downloadSummary.projectsDrop).padStart(5)} options      ║`);
      console.log(`║  🏷️ Status options:                        ${String(downloadSummary.statusOptions).padStart(5)} options      ║`);
      console.log(`║  📋 EFE_Drop (FDF) options:                ${String(downloadSummary.efeDrop).padStart(5)} options      ║`);
      console.log('╠════════════════════════════════════════════════════════════════╣');
      console.log('║  ✅ TEMPLATE IS READY FOR OFFLINE USE                           ║');
      console.log('╚════════════════════════════════════════════════════════════════╝\n');

    } catch (error) {
      console.error('╔════════════════════════════════════════════════════════════════╗');
      console.error('║  ❌ TEMPLATE DOWNLOAD FAILED                                    ║');
      console.error('╚════════════════════════════════════════════════════════════════╝');
      console.error(`[OfflineTemplate] Error downloading ${cacheKey}:`, error);
      throw error;
    }
  }

  /**
   * Download and cache actual image files for offline viewing
   * Converts S3 images to base64 and stores in IndexedDB
   */
  private async downloadAndCacheImages(attachments: any[], serviceId: string): Promise<void> {
    const batchSize = 5; // Process in batches to avoid overwhelming the network
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < attachments.length; i += batchSize) {
      const batch = attachments.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (attach) => {
        const attachId = String(attach.AttachID);
        const s3Key = attach.Attachment;
        
        // Skip if no S3 key
        if (!s3Key || !this.caspioService.isS3Key(s3Key)) {
          console.log(`    ⏭️ Skipping attachment ${attachId} - no S3 key`);
          return;
        }

        try {
          // Get pre-signed URL
          const s3Url = await this.caspioService.getS3FileUrl(s3Key);
          
          // Fetch the actual image
          const response = await fetch(s3Url);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          
          const blob = await response.blob();
          
          // Convert to base64 data URL
          const base64 = await this.blobToDataUrl(blob);
          
          // Cache in IndexedDB
          await this.indexedDb.cachePhoto(attachId, serviceId, base64, s3Key);
          successCount++;
        } catch (err) {
          console.warn(`    ⚠️ Failed to cache image ${attachId}:`, err);
          failCount++;
        }
      });

      await Promise.all(batchPromises);
      
      // Progress update for large batches
      if (attachments.length > 10) {
        console.log(`    📊 Progress: ${Math.min(i + batchSize, attachments.length)}/${attachments.length} images processed`);
      }
    }

    console.log(`    📸 Image caching complete: ${successCount} succeeded, ${failCount} failed`);
  }

  /**
   * Convert blob to base64 data URL
   */
  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Download EFE data with summary tracking
   */
  private async downloadEFEDataWithSummary(serviceId: string, summary: any): Promise<void> {
    // Get all rooms for this service
    const rooms = await firstValueFrom(this.caspioService.getServicesEFE(serviceId));
    summary.efeRooms = rooms?.length || 0;
    await this.indexedDb.cacheServiceData(serviceId, 'efe_rooms', rooms);
    console.log(`    ✅ EFE Rooms: ${summary.efeRooms} rooms cached`);

    // Collect all point IDs for attachment download
    const allPointIds: string[] = [];

    // Get points for each room
    if (rooms && rooms.length > 0) {
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
      summary.efePoints = pointCounts.reduce((a, b) => a + b, 0);
      console.log(`    ✅ EFE Points: ${summary.efePoints} points across ${summary.efeRooms} rooms`);
    } else {
      console.log('    ℹ️ No EFE rooms yet - new template (this is normal)');
    }

    // Download attachments for all points
    if (allPointIds.length > 0) {
      console.log(`    📸 Caching attachments for ${allPointIds.length} points...`);
      
      // Fetch attachments in batches
      const batchSize = 10;
      let totalAttachments = 0;
      const allEfeAttachments: any[] = [];
      
      for (let i = 0; i < allPointIds.length; i += batchSize) {
        const batch = allPointIds.slice(i, i + batchSize);
        
        const attachmentPromises = batch.map(async (pointId) => {
          try {
            const attachments = await firstValueFrom(
              this.caspioService.getServicesEFEAttachments(pointId)
            );
            await this.indexedDb.cacheServiceData(pointId, 'efe_point_attachments', attachments || []);
            // Collect all attachments for image download
            if (attachments && attachments.length > 0) {
              allEfeAttachments.push(...attachments);
            }
            return attachments?.length || 0;
          } catch (err) {
            await this.indexedDb.cacheServiceData(pointId, 'efe_point_attachments', []);
            return 0;
          }
        });
        
        const counts = await Promise.all(attachmentPromises);
        totalAttachments += counts.reduce((a, b) => a + b, 0);
      }
      
      summary.efePointAttachments = totalAttachments;
      console.log(`    ✅ EFE Point Attachments: ${summary.efePointAttachments} attachment records cached`);
      
      // CRITICAL: Download and cache actual EFE images for offline viewing
      if (allEfeAttachments.length > 0) {
        console.log(`    🖼️ Downloading ${allEfeAttachments.length} EFE images for offline...`);
        await this.downloadAndCacheEFEImages(allEfeAttachments, String(summary.efeRooms));
        console.log(`    ✅ EFE images downloaded and cached`);
      }
    }
  }

  /**
   * Download and cache EFE point images for offline viewing
   */
  private async downloadAndCacheEFEImages(attachments: any[], serviceId: string): Promise<void> {
    const batchSize = 5;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < attachments.length; i += batchSize) {
      const batch = attachments.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (attach) => {
        const attachId = String(attach.AttachID || attach.PK_ID);
        const s3Key = attach.Attachment;
        
        // Skip if no S3 key
        if (!s3Key || !this.caspioService.isS3Key(s3Key)) {
          return;
        }

        try {
          // Get pre-signed URL
          const s3Url = await this.caspioService.getS3FileUrl(s3Key);
          
          // Fetch the actual image
          const response = await fetch(s3Url);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          
          const blob = await response.blob();
          const base64 = await this.blobToDataUrl(blob);
          
          // Cache in IndexedDB
          await this.indexedDb.cachePhoto(attachId, serviceId, base64, s3Key);
          successCount++;
        } catch (err) {
          console.warn(`    ⚠️ Failed to cache EFE image ${attachId}:`, err);
          failCount++;
        }
      });

      await Promise.all(batchPromises);
    }

    console.log(`    📸 EFE image caching: ${successCount} succeeded, ${failCount} failed`);
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
    try {
      const cached = await this.indexedDb.getCachedServiceData(key, 'visual_attachments');
      if (cached !== null && cached !== undefined) {
        console.log(`[OfflineTemplate] Visual attachments from cache for ${key}: ${cached.length}`);
        return cached;
      }
    } catch (cacheError) {
      console.warn(`[OfflineTemplate] Error reading cache for ${key}:`, cacheError);
    }

    // Cache miss - try API if online
    if (this.offlineService.isOnline()) {
      console.log(`[OfflineTemplate] Visual attachments cache miss for ${key}, fetching from API...`);
      try {
        // Add timeout to prevent hanging - 10 seconds max
        const timeoutPromise = new Promise<any[]>((_, reject) => {
          setTimeout(() => reject(new Error('API timeout')), 10000);
        });
        
        const attachments = await Promise.race([
          firstValueFrom(this.caspioService.getServiceVisualsAttachByVisualId(key)),
          timeoutPromise
        ]);
        
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
   * Get EFE points for a room from IndexedDB (offline-first with API fallback)
   */
  async getEFEPoints(roomId: string): Promise<any[]> {
    // Get cached points from IndexedDB first
    let cached = await this.indexedDb.getCachedServiceData(roomId, 'efe_points');
    
    // If no cache and online, fetch from API
    if ((cached === null || cached === undefined) && this.offlineService.isOnline()) {
      console.log(`[OfflineTemplate] EFE Points cache miss for ${roomId}, fetching from API...`);
      try {
        // Add timeout to prevent hanging
        const timeoutPromise = new Promise<any[]>((_, reject) => {
          setTimeout(() => reject(new Error('API timeout')), 10000);
        });
        
        const points = await Promise.race([
          firstValueFrom(this.caspioService.getServicesEFEPoints(roomId)),
          timeoutPromise
        ]);
        
        // Cache for future offline use
        await this.indexedDb.cacheServiceData(roomId, 'efe_points', points || []);
        cached = points || [];
        console.log(`[OfflineTemplate] EFE Points fetched and cached for ${roomId}: ${cached.length}`);
      } catch (error) {
        console.error(`[OfflineTemplate] Failed to fetch EFE Points for ${roomId}:`, error);
        cached = [];
      }
    }
    
    cached = cached || [];

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

    // Add to pending EFE data (for local display)
    await this.indexedDb.addPendingEFE({
      tempId: tempId,
      serviceId: serviceId,
      type: 'room',
      data: roomData,
    });

    // IMPORTANT: Also add to pendingRequests for BackgroundSyncService to process
    await this.indexedDb.addPendingRequest({
      type: 'CREATE',
      endpoint: 'LPS_Services_EFE/',
      method: 'POST',
      tempId: tempId,
      data: {
        ...roomData,
        ServiceID: parseInt(serviceId),
      },
      dependencies: [], // Rooms have no dependencies
      status: 'pending',
      priority: 'high', // Rooms sync first
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
    const isRoomTempId = roomId.startsWith('temp_');

    // Create point object with temp ID
    const point = {
      ...pointData,
      PointID: tempId,
      PK_ID: tempId,
      EFEID: roomId, // May be temp ID - will be resolved before sync
      _tempId: tempId,
      _localOnly: true,
      _syncing: true,
    };

    // Add to pending EFE data (for local display)
    await this.indexedDb.addPendingEFE({
      tempId: tempId,
      serviceId: serviceId,
      type: 'point',
      parentId: roomId,
      data: pointData,
    });

    // Find the room's pending request to get its requestId for dependency
    let dependencies: string[] = [];
    if (isRoomTempId) {
      const pending = await this.indexedDb.getPendingRequests();
      const allRequests = await this.indexedDb.getAllRequests();
      const roomRequest = [...pending, ...allRequests].find(r => r.tempId === roomId);
      if (roomRequest) {
        dependencies = [roomRequest.requestId];
        console.log(`[OfflineTemplate] Point ${tempId} depends on room request ${roomRequest.requestId}`);
      } else {
        console.warn(`[OfflineTemplate] Room request not found for ${roomId}, point may sync before room!`);
      }
    }

    // IMPORTANT: Also add to pendingRequests for BackgroundSyncService to process
    await this.indexedDb.addPendingRequest({
      type: 'CREATE',
      endpoint: 'LPS_Services_EFE_Points/',
      method: 'POST',
      tempId: tempId,
      data: {
        ...pointData,
        EFEID: roomId, // BackgroundSync will resolve temp ID to real ID
      },
      dependencies: dependencies, // Wait for room to sync first
      status: 'pending',
      priority: 'normal', // Points sync after rooms
    });

    // Update local cache - use temp room ID as key for offline display
    const cacheKey = roomId;
    const existingPoints = await this.indexedDb.getCachedServiceData(cacheKey, 'efe_points') || [];
    await this.indexedDb.cacheServiceData(cacheKey, 'efe_points', [...existingPoints, point]);

    console.log(`[OfflineTemplate] Created EFE point ${tempId} for room ${roomId} (deps: ${dependencies.length > 0 ? dependencies[0] : 'none'})`);
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

  /**
   * Get EFE Drop options (FDF dropdown for elevation plots) - IndexedDB first, API fallback
   */
  async getEFEDropOptions(): Promise<any[]> {
    // Try IndexedDB first
    const cached = await this.indexedDb.getCachedGlobalData('efe_drop');
    if (cached && cached.length > 0) {
      console.log('[OfflineTemplate] Loaded EFE_Drop options from cache:', cached.length);
      return cached;
    }

    // If online, fetch and cache
    if (this.offlineService.isOnline()) {
      try {
        const data = await firstValueFrom(this.caspioService.getServicesEFEDrop());
        await this.indexedDb.cacheGlobalData('efe_drop', data);
        console.log('[OfflineTemplate] Fetched and cached EFE_Drop options:', data?.length || 0);
        return data || [];
      } catch (error) {
        console.error('[OfflineTemplate] Failed to fetch EFE_Drop options:', error);
      }
    }

    console.warn('[OfflineTemplate] No EFE_Drop options available');
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
