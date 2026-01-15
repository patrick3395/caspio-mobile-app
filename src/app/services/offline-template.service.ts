import { Injectable } from '@angular/core';
import { firstValueFrom, Subject } from 'rxjs';
import { Capacitor } from '@capacitor/core';
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

  // Event emitted when background refresh completes - pages can subscribe to reload their data
  public backgroundRefreshComplete$ = new Subject<{
    serviceId: string;
    dataType: 'visuals' | 'efe_rooms' | 'efe_points' | 'visual_attachments' | 'efe_point_attachments';
  }>();

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
    
    // Check if we have cached templates FIRST (instant return for offline)
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

    // CRITICAL: If offline and no cache, return empty immediately - don't wait for downloads
    if (!this.offlineService.isOnline()) {
      console.log('[OfflineTemplate] ⚠️ Offline with no cached templates - returning empty');
      return [];
    }

    // Only wait for downloads if ONLINE (they might complete soon)
    for (const [key, promise] of this.downloadPromises.entries()) {
      if (key.startsWith('EFE_')) {
        console.log(`[OfflineTemplate] ensureVisualTemplatesReady: waiting for download ${key}...`);
        try {
          // Add timeout to prevent hanging
          const timeoutPromise = new Promise<void>((_, reject) => 
            setTimeout(() => reject(new Error('Download timeout')), 5000)
          );
          await Promise.race([promise, timeoutPromise]);
        } catch (err) {
          console.warn('[OfflineTemplate] Download wait timed out or failed:', err);
        }
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
   * Ensure EFE templates are ready for use (room definitions for Elevation Plot).
   * - If cached: returns immediately
   * - If download in progress: waits for it
   * - If not started: fetches from API and caches
   * 
   * Call this from pages that need EFE templates to ensure they're available.
   */
  async ensureEFETemplatesReady(): Promise<any[]> {
    console.log('[OfflineTemplate] ensureEFETemplatesReady() called');
    
    // Check if we have cached templates FIRST (instant return for offline)
    try {
      const cached = await this.indexedDb.getCachedTemplates('efe');
      console.log('[OfflineTemplate] IndexedDB getCachedTemplates(efe) result:', cached ? `${cached.length} templates` : 'null/undefined');
      
      if (cached && cached.length > 0) {
        console.log(`[OfflineTemplate] ✅ ensureEFETemplatesReady: ${cached.length} templates already cached`);
        return cached;
      }
    } catch (dbError) {
      console.error('[OfflineTemplate] ❌ IndexedDB error when getting cached EFE templates:', dbError);
    }

    // CRITICAL: If offline and no cache, return empty immediately - don't wait for downloads
    if (!this.offlineService.isOnline()) {
      console.log('[OfflineTemplate] ⚠️ Offline with no cached EFE templates - returning empty');
      return [];
    }

    // Only wait for downloads if ONLINE (they might complete soon)
    for (const [key, promise] of this.downloadPromises.entries()) {
      if (key.startsWith('EFE_')) {
        console.log(`[OfflineTemplate] ensureEFETemplatesReady: waiting for download ${key}...`);
        try {
          // Add timeout to prevent hanging
          const timeoutPromise = new Promise<void>((_, reject) => 
            setTimeout(() => reject(new Error('Download timeout')), 5000)
          );
          await Promise.race([promise, timeoutPromise]);
        } catch (err) {
          console.warn('[OfflineTemplate] Download wait timed out or failed:', err);
        }
        // Check again after download completes
        const afterDownload = await this.indexedDb.getCachedTemplates('efe');
        if (afterDownload && afterDownload.length > 0) {
          console.log(`[OfflineTemplate] ensureEFETemplatesReady: ${afterDownload.length} templates available after download`);
          return afterDownload;
        }
      }
    }

    // No cache, no download in progress - fetch directly if online
    if (this.offlineService.isOnline()) {
      console.log('[OfflineTemplate] ensureEFETemplatesReady: fetching from API...');
      try {
        const templates = await firstValueFrom(this.caspioService.getServicesEFETemplates());
        await this.indexedDb.cacheTemplates('efe', templates);
        console.log(`[OfflineTemplate] ensureEFETemplatesReady: fetched and cached ${templates.length} templates`);
        return templates;
      } catch (error) {
        console.error('[OfflineTemplate] ensureEFETemplatesReady: API fetch failed:', error);
        return [];
      }
    }

    console.warn('[OfflineTemplate] ensureEFETemplatesReady: offline and no cache available');
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

      // Collect attachments for background image download (non-blocking)
      let collectedVisualAttachments: any[] = [];
      
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
              
              const attachmentPromises = visuals.map(async (visual: any) => {
                const visualId = visual.VisualID || visual.PK_ID;
                if (visualId) {
                  try {
                    const attachments = await firstValueFrom(
                      this.caspioService.getServiceVisualsAttachByVisualId(String(visualId))
                    );
                    await this.indexedDb.cacheServiceData(String(visualId), 'visual_attachments', attachments || []);
                    // Collect all attachments for BACKGROUND image download (non-blocking)
                    if (attachments && attachments.length > 0) {
                      collectedVisualAttachments.push(...attachments);
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
              // NOTE: Image download moved to background (non-blocking) - see below
            } else {
              console.log('    ℹ️ No existing visuals - new template (this is normal)');
            }
            return visuals;
          })
      );

      // Collect EFE attachments for background image download (non-blocking)
      let collectedEfeAttachments: any[] = [];
      
      // 4. For EFE: Also download rooms, points, and point attachments
      if (templateType === 'EFE') {
        console.log('[4/8] 📐 Downloading EFE DATA (rooms, points, and point attachments)...');
        downloads.push(
          this.downloadEFEDataWithSummary(serviceId, downloadSummary).then(efeAttachments => {
            // Collect EFE attachments for BACKGROUND image download (non-blocking)
            collectedEfeAttachments = efeAttachments || [];
          })
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

      // Mark as fully downloaded - template is now READY for use
      await this.indexedDb.markTemplateDownloaded(serviceId, templateType);

      // OPTIMIZATION: Start image downloads in BACKGROUND (non-blocking)
      // Template is ready for use immediately, images will cache in background
      const totalImages = collectedVisualAttachments.length + collectedEfeAttachments.length;
      if (totalImages > 0) {
        console.log(`    🖼️ Starting BACKGROUND image download for ${totalImages} images...`);
        this.downloadImagesInBackground(collectedVisualAttachments, collectedEfeAttachments, serviceId);
      }

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
   * Uses XMLHttpRequest for cross-platform compatibility (web + mobile)
   * 
   * OPTIMIZATION: Uses batch cache check at start to avoid individual checks
   */
  private async downloadAndCacheImages(attachments: any[], serviceId: string): Promise<void> {
    // OPTIMIZATION: Increased batch size for faster downloads
    const batchSize = 20;
    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;
    const isNative = Capacitor.isNativePlatform();
    
    // Log database diagnostics for debugging mobile issues
    const diagnostics = await this.indexedDb.getDatabaseDiagnostics();
    console.log(`    🖼️ Starting image download (platform: ${isNative ? 'mobile' : 'web'}, count: ${attachments.length})`);
    console.log(`    📊 DB Status: version=${diagnostics.version}, cachedPhotosStore=${diagnostics.hasCachedPhotosStore}, existingPhotos=${diagnostics.cachedPhotosCount}`);

    // OPTIMIZATION: Batch check all cached photo IDs upfront (single IndexedDB read)
    const cachedPhotoIds = await this.indexedDb.getAllCachedPhotoIds();
    
    // Filter to only download images that aren't already cached
    const toDownload = attachments.filter(attach => {
      const attachId = String(attach.AttachID);
      const s3Key = attach.Attachment;
      
      // Skip if no S3 key
      if (!s3Key || !this.caspioService.isS3Key(s3Key)) {
        skippedCount++;
        return false;
      }
      
      // Skip if already cached
      if (cachedPhotoIds.has(attachId)) {
        skippedCount++;
        return false;
      }
      
      return true;
    });
    
    console.log(`    📊 Batch cache check: ${skippedCount} already cached, ${toDownload.length} to download`);
    
    // Download only missing images in batches
    for (let i = 0; i < toDownload.length; i += batchSize) {
      const batch = toDownload.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (attach) => {
        const attachId = String(attach.AttachID);
        const s3Key = attach.Attachment;

        try {
          // Get pre-signed URL
          const s3Url = await this.caspioService.getS3FileUrl(s3Key);
          
          // Use XMLHttpRequest-based fetch for cross-platform compatibility
          // Standard fetch() can have CORS issues on native mobile platforms
          const base64 = await this.fetchImageAsBase64(s3Url);
          
          // Cache in IndexedDB
          await this.indexedDb.cachePhoto(attachId, serviceId, base64, s3Key);
          successCount++;
          
          if (isNative) {
            console.log(`    ✅ [Mobile] Cached image ${attachId}`);
          }
        } catch (err: any) {
          console.warn(`    ⚠️ Failed to cache image ${attachId}:`, err?.message || err);
          failCount++;
        }
      });

      await Promise.all(batchPromises);
      
      // Progress update for large batches
      if (toDownload.length > 10) {
        console.log(`    📊 Progress: ${Math.min(i + batchSize, toDownload.length)}/${toDownload.length} images (${successCount} new, ${failCount} failed)`);
      }
    }

    console.log(`    📸 Image caching complete: ${successCount} new, ${skippedCount} already cached, ${failCount} failed (platform: ${isNative ? 'mobile' : 'web'})`);
  }

  /**
   * OPTIMIZATION: Download images in background (non-blocking)
   * This allows the template to be "ready" immediately while images cache in background
   * The user can start working on the template while images download
   */
  private downloadImagesInBackground(
    visualAttachments: any[], 
    efeAttachments: any[], 
    serviceId: string
  ): void {
    // Don't await - run in background
    const backgroundDownload = async () => {
      try {
        // Download visual images
        if (visualAttachments.length > 0) {
          console.log(`    🖼️ [BG] Downloading ${visualAttachments.length} visual images...`);
          await this.downloadAndCacheImages(visualAttachments, serviceId);
          console.log(`    ✅ [BG] Visual images cached`);
        }
        
        // Download EFE images
        if (efeAttachments.length > 0) {
          console.log(`    🖼️ [BG] Downloading ${efeAttachments.length} EFE images...`);
          await this.downloadAndCacheEFEImages(efeAttachments, serviceId);
          console.log(`    ✅ [BG] EFE images cached`);
        }
        
        console.log(`    ✅ [BG] All background image downloads complete`);
      } catch (error) {
        console.warn('    ⚠️ [BG] Background image download error:', error);
        // Don't throw - this is background, don't affect user experience
      }
    };
    
    // Start in background (fire and forget)
    backgroundDownload();
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
   * Public method to fetch an S3 image and convert to base64 data URL
   * Handles getting the signed S3 URL first, then fetching the image
   */
  async fetchImageAsBase64Exposed(s3KeyOrUrl: string): Promise<string> {
    // If it's an S3 key, get the signed URL first
    let url = s3KeyOrUrl;
    if (this.caspioService.isS3Key(s3KeyOrUrl)) {
      url = await this.caspioService.getS3FileUrl(s3KeyOrUrl);
    }
    return this.fetchImageAsBase64(url);
  }

  /**
   * Fetch image and convert to base64 data URL
   * Uses XMLHttpRequest which works reliably on both web and mobile (Capacitor)
   * The standard fetch() API can have CORS issues on native mobile platforms
   */
  private fetchImageAsBase64(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      xhr.timeout = 30000; // 30 second timeout
      
      xhr.onload = () => {
        if (xhr.status === 200) {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('FileReader error'));
          reader.readAsDataURL(xhr.response);
        } else {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      };
      
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.ontimeout = () => reject(new Error('Request timeout'));
      xhr.send();
    });
  }

  /**
   * Download EFE data with summary tracking
   * Returns collected attachments for background image download (non-blocking)
   */
  private async downloadEFEDataWithSummary(serviceId: string, summary: any): Promise<any[]> {
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

    // Collect all EFE attachments for BACKGROUND image download (non-blocking)
    const allEfeAttachments: any[] = [];

    // Download attachment RECORDS for all points (but not images yet)
    if (allPointIds.length > 0) {
      console.log(`    📸 Caching attachments for ${allPointIds.length} points...`);
      
      // Fetch attachments in batches
      const batchSize = 20; // OPTIMIZATION: Increased from 10
      let totalAttachments = 0;
      
      for (let i = 0; i < allPointIds.length; i += batchSize) {
        const batch = allPointIds.slice(i, i + batchSize);
        
        const attachmentPromises = batch.map(async (pointId) => {
          try {
            const attachments = await firstValueFrom(
              this.caspioService.getServicesEFEAttachments(pointId)
            );
            await this.indexedDb.cacheServiceData(pointId, 'efe_point_attachments', attachments || []);
            // Collect all attachments for BACKGROUND image download
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
      // NOTE: Image download moved to background (non-blocking) - handled by caller
    }
    
    // Return collected attachments for background image download
    return allEfeAttachments;
  }

  /**
   * Download and cache EFE (Elevation Plot) images for offline viewing
   * Uses XMLHttpRequest for cross-platform compatibility (web + mobile)
   * 
   * OPTIMIZATION: Uses batch cache check at start to avoid individual checks
   */
  private async downloadAndCacheEFEImages(attachments: any[], serviceId: string): Promise<void> {
    // OPTIMIZATION: Increased batch size for faster downloads
    const batchSize = 20;
    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;
    const isNative = Capacitor.isNativePlatform();
    
    console.log(`    🖼️ Starting EFE image download (platform: ${isNative ? 'mobile' : 'web'}, count: ${attachments.length})`);

    // OPTIMIZATION: Batch check all cached photo IDs upfront (single IndexedDB read)
    const cachedPhotoIds = await this.indexedDb.getAllCachedPhotoIds();
    
    // Filter to only download images that aren't already cached
    const toDownload = attachments.filter(attach => {
      const attachId = String(attach.AttachID || attach.PK_ID);
      const s3Key = attach.Attachment;
      
      // Skip if no S3 key
      if (!s3Key || !this.caspioService.isS3Key(s3Key)) {
        skippedCount++;
        return false;
      }
      
      // Skip if already cached
      if (cachedPhotoIds.has(attachId)) {
        skippedCount++;
        return false;
      }
      
      return true;
    });
    
    console.log(`    📊 EFE batch cache check: ${skippedCount} already cached, ${toDownload.length} to download`);

    // Download only missing images in batches
    for (let i = 0; i < toDownload.length; i += batchSize) {
      const batch = toDownload.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (attach) => {
        const attachId = String(attach.AttachID || attach.PK_ID);
        const s3Key = attach.Attachment;

        try {
          // Get pre-signed URL
          const s3Url = await this.caspioService.getS3FileUrl(s3Key);
          
          // Use XMLHttpRequest-based fetch for cross-platform compatibility
          const base64 = await this.fetchImageAsBase64(s3Url);
          
          // Cache in IndexedDB
          await this.indexedDb.cachePhoto(attachId, serviceId, base64, s3Key);
          successCount++;
          
          if (isNative) {
            console.log(`    ✅ [Mobile] Cached EFE image ${attachId}`);
          }
        } catch (err: any) {
          console.warn(`    ⚠️ Failed to cache EFE image ${attachId}:`, err?.message || err);
          failCount++;
        }
      });

      await Promise.all(batchPromises);
      
      // Progress update for large batches
      if (toDownload.length > 10) {
        console.log(`    📊 EFE Progress: ${Math.min(i + batchSize, toDownload.length)}/${toDownload.length} (${successCount} new, ${failCount} failed)`);
      }
    }

    console.log(`    📸 EFE image caching: ${successCount} new, ${skippedCount} already cached, ${failCount} failed (platform: ${isNative ? 'mobile' : 'web'})`);
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
   * CRITICAL: Also verifies that actual data exists in cache (not just the download flag)
   * This prevents the case where download flag is set but cache was cleared
   * 
   * OPTIMIZATION: Uses parallel IndexedDB reads instead of sequential
   */
  async isTemplateReady(serviceId: string, templateType: 'EFE' | 'HUD' | 'LBW' | 'DTE'): Promise<boolean> {
    // First check the download flag (must be first - early exit)
    const hasDownloadFlag = await this.indexedDb.isTemplateDownloaded(serviceId, templateType);
    if (!hasDownloadFlag) {
      console.log(`[OfflineTemplate] isTemplateReady(${serviceId}, ${templateType}): No download flag`);
      return false;
    }

    // OPTIMIZATION: Verify all data exists in PARALLEL (faster than sequential)
    const [visualTemplates, efeTemplates, serviceRecord] = await Promise.all([
      this.indexedDb.getCachedTemplates('visual'),
      templateType === 'EFE' ? this.indexedDb.getCachedTemplates('efe') : Promise.resolve([1]), // Dummy array for non-EFE
      this.indexedDb.getCachedServiceRecord(serviceId)
    ]);

    // Check visual templates
    if (!visualTemplates || visualTemplates.length === 0) {
      console.log(`[OfflineTemplate] isTemplateReady: Download flag set but visual templates missing - forcing re-download`);
      await this.indexedDb.removeTemplateDownloadStatus(serviceId, templateType);
      return false;
    }

    // Check EFE templates (only for EFE template type)
    if (templateType === 'EFE' && (!efeTemplates || efeTemplates.length === 0)) {
      console.log(`[OfflineTemplate] isTemplateReady: Download flag set but EFE templates missing - forcing re-download`);
      await this.indexedDb.removeTemplateDownloadStatus(serviceId, templateType);
      return false;
    }

    // Check service record
    if (!serviceRecord) {
      console.log(`[OfflineTemplate] isTemplateReady: Download flag set but service record missing - forcing re-download`);
      await this.indexedDb.removeTemplateDownloadStatus(serviceId, templateType);
      return false;
    }

    // NEW: Verify service visuals cache exists (even if empty array - that's valid)
    // null means cache entry doesn't exist at all (never fetched)
    // [] means we fetched but service has no visuals yet (valid for new services)
    const cachedVisuals = await this.indexedDb.getCachedServiceData(serviceId, 'visuals');
    if (cachedVisuals === null) {
      console.log(`[OfflineTemplate] isTemplateReady: Visuals never cached - marking not ready`);
      await this.indexedDb.removeTemplateDownloadStatus(serviceId, templateType);
      return false;
    }

    console.log(`[OfflineTemplate] isTemplateReady(${serviceId}, ${templateType}): ✅ All data verified (visuals: ${cachedVisuals?.length || 0})`);
    return true;
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
   * Get visuals for a service - CACHE-FIRST for instant loading
   * Returns cached data immediately, refreshes in background when online
   */
  async getVisualsByService(serviceId: string): Promise<any[]> {
    alert(`[DEBUG getVisualsByService] START for serviceId: ${serviceId}`);

    // 1. Read from cache IMMEDIATELY
    const cached = await this.indexedDb.getCachedServiceData(serviceId, 'visuals') || [];

    // 2. Merge with pending offline visuals
    const pending = await this.getPendingVisuals(serviceId);
    const merged = [...cached, ...pending];

    alert(`[DEBUG getVisualsByService] cached: ${cached.length}, pending: ${pending.length}, merged: ${merged.length}`);

    // 3. Return immediately if we have data
    if (merged.length > 0) {
      console.log(`[OfflineTemplate] Visuals: ${cached.length} cached + ${pending.length} pending (instant)`);

      // 4. Background refresh (non-blocking) when online
      if (this.offlineService.isOnline()) {
        this.refreshVisualsInBackground(serviceId);
      }
      return merged;
    }

    // 5. Cache empty - fetch from API if online (blocking only when no cache)
    if (this.offlineService.isOnline()) {
      try {
        alert(`[DEBUG getVisualsByService] Cache empty, fetching from API...`);
        console.log(`[OfflineTemplate] No cached visuals, fetching from API...`);
        const freshVisuals = await firstValueFrom(this.caspioService.getServicesVisualsByServiceId(serviceId));
        alert(`[DEBUG getVisualsByService] API returned: ${freshVisuals?.length || 0} visuals`);
        await this.indexedDb.cacheServiceData(serviceId, 'visuals', freshVisuals);
        return [...freshVisuals, ...pending];
      } catch (error) {
        alert(`[DEBUG getVisualsByService] API FAILED: ${error}`);
        console.warn(`[OfflineTemplate] API fetch failed:`, error);
      }
    } else {
      alert(`[DEBUG getVisualsByService] OFFLINE - cannot fetch from API`);
    }

    console.log(`[OfflineTemplate] No visuals available (offline, no cache)`);
    return pending; // Return any pending items at least
  }

  /**
   * Get visual attachments - CACHE-FIRST for instant loading
   * Returns cached data immediately, refreshes in background when online
   * CRITICAL: Preserves local updates (annotations) when merging with server data
   */
  async getVisualAttachments(visualId: string | number): Promise<any[]> {
    const key = String(visualId);
    
    // Skip for temp IDs - they won't have server data
    if (key.startsWith('temp_')) {
      console.log(`[OfflineTemplate] Skipping for temp visual ${key}`);
      return [];
    }

    // 1. Read from cache IMMEDIATELY
    const cached = await this.indexedDb.getCachedServiceData(key, 'visual_attachments');
    
    // 2. Return immediately if we have data
    if (cached && cached.length > 0) {
      console.log(`[OfflineTemplate] Attachments for ${key}: ${cached.length} (instant from cache)`);
      
      // 3. Background refresh (non-blocking) when online
      if (this.offlineService.isOnline()) {
        this.refreshAttachmentsInBackground(key);
      }
      return cached;
    }
    
    // 4. Cache empty - fetch from API if online (blocking only when no cache)
    if (this.offlineService.isOnline()) {
      try {
        console.log(`[OfflineTemplate] No cached attachments for ${key}, fetching from API...`);
        const attachments = await firstValueFrom(this.caspioService.getServiceVisualsAttachByVisualId(key));
        await this.indexedDb.cacheServiceData(key, 'visual_attachments', attachments || []);
        return attachments || [];
      } catch (error) {
        console.warn(`[OfflineTemplate] API fetch failed for ${key}:`, error);
      }
    }
    
    return [];
  }

  /**
   * Get EFE rooms for a service - CACHE-FIRST for instant loading
   * Returns cached data immediately, refreshes in background when online
   * 
   * STANDARDIZED PATTERN:
   * 1. Read from cache IMMEDIATELY (instant UI)
   * 2. Merge with pending offline rooms
   * 3. If merged has data: return immediately, refresh in background
   * 4. If both empty + online: fetch SYNCHRONOUSLY (blocking)
   * 5. If offline and empty: return empty with offline indicator
   */
  async getEFERooms(serviceId: string): Promise<any[]> {
    console.log(`[OfflineTemplate] getEFERooms(${serviceId}) called`);

    // 1. Read from cache IMMEDIATELY
    const cached = await this.indexedDb.getCachedServiceData(serviceId, 'efe_rooms') || [];
    console.log(`[OfflineTemplate] getEFERooms: ${cached.length} rooms in cache`);

    // 2. Merge with pending offline rooms
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
    console.log(`[OfflineTemplate] getEFERooms: ${pendingRooms.length} pending rooms`);

    // CRITICAL FIX: Deduplicate rooms - pending rooms have latest local changes (e.g., FDF selection)
    // and should override cached versions. Use a Map keyed by room identifier to ensure uniqueness.
    const roomMap = new Map<string, any>();

    // First, add cached rooms
    for (const room of cached) {
      const key = room.RoomName || String(room.EFEID || room.PK_ID || room._tempId);
      roomMap.set(key, room);
    }

    // Then, override with pending rooms (they have the most recent local changes like FDF)
    for (const room of pendingRooms) {
      const key = room.RoomName || String(room.EFEID || room.PK_ID || room._tempId);
      roomMap.set(key, room);
    }

    const merged = Array.from(roomMap.values());
    
    // 3. Return immediately if we have data
    if (merged.length > 0) {
      console.log(`[OfflineTemplate] ✅ EFE Rooms: ${cached.length} cached + ${pendingRooms.length} pending (instant)`);
      
      // Background refresh (non-blocking) when online
      if (this.offlineService.isOnline()) {
        this.refreshEFERoomsInBackground(serviceId);
      }
      return merged;
    }
    
    // 4. CRITICAL: Cache AND pending both empty - fetch synchronously if online
    // This is the first-load scenario where we MUST block until data is available
    if (this.offlineService.isOnline()) {
      try {
        console.log(`[OfflineTemplate] ⏳ No cached EFE rooms, fetching from API (BLOCKING)...`);
        const freshRooms = await firstValueFrom(this.caspioService.getServicesEFE(serviceId));
        
        // Cache the fetched data
        await this.indexedDb.cacheServiceData(serviceId, 'efe_rooms', freshRooms || []);
        
        console.log(`[OfflineTemplate] ✅ Fetched and cached ${freshRooms?.length || 0} EFE rooms from API`);
        return [...(freshRooms || []), ...pendingRooms];
      } catch (error) {
        console.error(`[OfflineTemplate] ❌ API fetch failed for EFE rooms:`, error);
      }
    } else {
      console.log(`[OfflineTemplate] ⚠️ Offline and no cached EFE rooms - returning empty`);
    }
    
    // 5. Return pending rooms only (may be empty)
    return pendingRooms;
  }

  /**
   * Get EFE points for a room - CACHE-FIRST for instant loading
   * Returns cached data immediately, refreshes in background when online
   */
  async getEFEPoints(roomId: string): Promise<any[]> {
    const isTemp = roomId.startsWith('temp_');
    
    // 1. Read from cache IMMEDIATELY
    const cached = await this.indexedDb.getCachedServiceData(roomId, 'efe_points') || [];
    
    // 2. Merge with pending offline points
    const pending = await this.indexedDb.getPendingEFEPoints(roomId);
    const pendingPoints = pending.map(p => ({
      ...p.data,
      PointID: p.tempId,
      PK_ID: p.tempId,
      _tempId: p.tempId,
      _localOnly: true,
      _syncing: true,
    }));
    const merged = [...cached, ...pendingPoints];
    
    // 3. Return immediately if we have data
    if (merged.length > 0) {
      console.log(`[OfflineTemplate] EFE Points for ${roomId}: ${cached.length} cached + ${pendingPoints.length} pending (instant)`);
      
      // 4. Background refresh (non-blocking) when online - skip for temp rooms
      if (!isTemp && this.offlineService.isOnline()) {
        this.refreshEFEPointsInBackground(roomId);
      }
      return merged;
    }
    
    // 5. Cache empty - fetch from API if online and not temp (blocking only when no cache)
    if (!isTemp && this.offlineService.isOnline()) {
      try {
        console.log(`[OfflineTemplate] No cached EFE points for ${roomId}, fetching from API...`);
        const freshPoints = await firstValueFrom(this.caspioService.getServicesEFEPoints(roomId));
        await this.indexedDb.cacheServiceData(roomId, 'efe_points', freshPoints || []);
        return [...(freshPoints || []), ...pendingPoints];
      } catch (error) {
        console.warn(`[OfflineTemplate] API fetch failed:`, error);
      }
    }
    
    return pendingPoints;
  }

  /**
   * Get EFE point attachments - CACHE-FIRST for instant loading
   * Returns cached data immediately, refreshes in background when online
   * CRITICAL: Preserves local updates (annotations) when merging with server data
   * NOTE: Pending photos are merged at page level using getAllPendingPhotosGroupedByPoint()
   * to avoid N+1 IndexedDB reads (matches getVisualAttachments pattern)
   */
  async getEFEPointAttachments(pointId: string | number): Promise<any[]> {
    const key = String(pointId);
    
    // Skip for temp point IDs - they won't have server data
    if (key.startsWith('temp_')) {
      console.log(`[OfflineTemplate] Skipping for temp point ${key}`);
      return [];
    }

    // 1. Read from cache IMMEDIATELY
    const cached = await this.indexedDb.getCachedServiceData(key, 'efe_point_attachments');
    
    // 2. Return immediately if we have data
    if (cached && cached.length > 0) {
      console.log(`[OfflineTemplate] EFE attachments for ${key}: ${cached.length} (instant from cache)`);
      
      // 3. Background refresh (non-blocking) when online
      if (this.offlineService.isOnline()) {
        this.refreshEFEAttachmentsInBackground(key);
      }
      return cached;
    }
    
    // 4. Cache empty - fetch from API if online (blocking only when no cache)
    if (this.offlineService.isOnline()) {
      try {
        console.log(`[OfflineTemplate] No cached EFE attachments for ${key}, fetching from API...`);
        const attachments = await firstValueFrom(this.caspioService.getServicesEFEAttachments(key));
        await this.indexedDb.cacheServiceData(key, 'efe_point_attachments', attachments || []);
        return attachments || [];
      } catch (error) {
        console.warn(`[OfflineTemplate] API fetch failed for ${key}:`, error);
      }
    }
    
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

  // ============================================
  // BACKGROUND REFRESH HELPERS (Non-blocking)
  // ============================================

  /**
   * Refresh visuals cache in background (non-blocking)
   * Fire-and-forget pattern - doesn't block UI
   * PRESERVES local updates (_localUpdate flag) when merging with fresh server data
   * Also checks for pending UPDATE requests to prevent race conditions
   * Emits backgroundRefreshComplete$ when done so pages can reload
   */
  private refreshVisualsInBackground(serviceId: string): void {
    setTimeout(async () => {
      try {
        // CRITICAL FIX: Check for pending UPDATE requests BEFORE fetching from server
        // This prevents race conditions where cache refresh overwrites local HIDDEN state
        let pendingVisualUpdates = new Set<string>();
        try {
          const pendingRequests = await this.indexedDb.getPendingRequests();
          pendingVisualUpdates = new Set<string>(
            pendingRequests
              .filter(r => r.type === 'UPDATE' && r.endpoint.includes('LPS_Services_Visuals/records') && !r.endpoint.includes('Attach'))
              .map(r => {
                const match = r.endpoint.match(/VisualID=(\d+)/);
                return match ? match[1] : null;
              })
              .filter((id): id is string => id !== null)
          );
          
          if (pendingVisualUpdates.size > 0) {
            console.log(`[OfflineTemplate] Found ${pendingVisualUpdates.size} pending UPDATE requests for visuals:`, [...pendingVisualUpdates]);
          }
        } catch (pendingErr) {
          console.warn('[OfflineTemplate] Failed to check pending requests (continuing without):', pendingErr);
        }
        
        const freshVisuals = await firstValueFrom(this.caspioService.getServicesVisualsByServiceId(serviceId));
        
        // Get existing cached visuals to find local updates that should be preserved
        const existingCache = await this.indexedDb.getCachedServiceData(serviceId, 'visuals') || [];
        
        // Check if cache has any LOCAL changes that need protection
        const hasLocalChanges = existingCache.some((item: any) => 
          item._localUpdate || 
          (item._tempId && String(item._tempId).startsWith('temp_'))
        ) || pendingVisualUpdates.size > 0;
        
        // SMART DEFENSIVE GUARD: Only protect if there are actual local changes
        if ((!freshVisuals || freshVisuals.length === 0) && existingCache.length > 0) {
          if (hasLocalChanges) {
            console.warn(`[OfflineTemplate] ⚠️ API returned empty but cache has ${existingCache.length} items with local changes - protecting cache`);
            return; // Preserve cache with local changes
          }
          // No local changes - clear cache (data was deleted on server)
          console.log(`[OfflineTemplate] API returned empty, no local changes - clearing visuals cache for ${serviceId}`);
          await this.indexedDb.cacheServiceData(serviceId, 'visuals', []);
          this.backgroundRefreshComplete$.next({ serviceId, dataType: 'visuals' });
          return;
        }
        
        // Warn if API returns significantly fewer items but still allow if no local changes
        if (freshVisuals && existingCache.length > 0 && freshVisuals.length < existingCache.length * 0.5) {
          if (hasLocalChanges) {
            console.warn(`[OfflineTemplate] ⚠️ API returned ${freshVisuals.length} visuals but cache has ${existingCache.length} with local changes - protecting cache`);
            return; // Preserve cache with local changes
          }
          console.log(`[OfflineTemplate] API returned ${freshVisuals.length} visuals (was ${existingCache.length}), no local changes - updating cache`);
        }
        
        // Build a map of locally updated visuals that should NOT be overwritten
        // Include both _localUpdate flagged AND visuals with pending UPDATE requests
        // CRITICAL: Key by BOTH PK_ID and VisualID to ensure matches
        const localUpdates = new Map<string, any>();
        for (const visual of existingCache) {
          const pkId = String(visual.PK_ID || '');
          const vId = String(visual.VisualID || '');
          const tempId = visual._tempId || '';
          
          // Check if has _localUpdate flag OR has pending UPDATE request (by either ID)
          const hasPendingByPkId = pkId && pendingVisualUpdates.has(pkId);
          const hasPendingByVisualId = vId && pendingVisualUpdates.has(vId);
          
          if (visual._localUpdate || hasPendingByPkId || hasPendingByVisualId) {
            // Store by both keys to ensure we find it when merging
            if (pkId) localUpdates.set(pkId, visual);
            if (vId) localUpdates.set(vId, visual);
            if (tempId) localUpdates.set(tempId, visual);
            const reason = visual._localUpdate ? '_localUpdate flag' : 'pending UPDATE request';
            console.log(`[OfflineTemplate] Preserving local version PK_ID=${pkId} VisualID=${vId} (${reason}, Notes: ${visual.Notes})`);
          }
        }
        
        // Merge: use local version for items with pending updates, server version for others
        const mergedVisuals = freshVisuals.map((serverVisual: any) => {
          const pkId = String(serverVisual.PK_ID);
          const vId = String(serverVisual.VisualID || serverVisual.PK_ID);
          // Try to find local version by either key
          const localVersion = localUpdates.get(pkId) || localUpdates.get(vId);
          if (localVersion) {
            // Keep local version since it has pending changes not yet on server
            console.log(`[OfflineTemplate] Keeping local version of visual PK_ID=${pkId} with Notes: ${localVersion.Notes}`);
            return localVersion;
          }
          return serverVisual;
        });
        
        // Also add any temp visuals (created offline, not yet synced) from existing cache
        const tempVisuals = existingCache.filter((v: any) => v._tempId && String(v._tempId).startsWith('temp_'));
        const finalVisuals = [...mergedVisuals, ...tempVisuals];
        
        await this.indexedDb.cacheServiceData(serviceId, 'visuals', finalVisuals);
        console.log(`[OfflineTemplate] Background refresh: ${freshVisuals.length} server visuals, ${localUpdates.size} local updates preserved, ${tempVisuals.length} temp visuals for ${serviceId}`);
        
        // Notify pages that fresh data is available
        this.backgroundRefreshComplete$.next({ serviceId, dataType: 'visuals' });
      } catch (error) {
        // Silently fail - user has cached data
        console.debug(`[OfflineTemplate] Background refresh failed for visuals (ok - using cache)`);
      }
    }, 100);
  }

  /**
   * Refresh visual attachments cache in background (non-blocking)
   * Preserves local updates (_localUpdate flag) when merging
   * Emits backgroundRefreshComplete$ when done so pages can reload
   */
  private refreshAttachmentsInBackground(visualId: string): void {
    setTimeout(async () => {
      try {
        const freshAttachments = await firstValueFrom(this.caspioService.getServiceVisualsAttachByVisualId(visualId));
        
        // Preserve local updates
        const existingCache = await this.indexedDb.getCachedServiceData(visualId, 'visual_attachments') || [];
        
        // Check if cache has any LOCAL changes that need protection
        const hasLocalChanges = existingCache.some((item: any) => 
          item._localUpdate || 
          (item._tempId && String(item._tempId).startsWith('temp_'))
        );
        
        // SMART DEFENSIVE GUARD: Only protect if there are actual local changes
        if ((!freshAttachments || freshAttachments.length === 0) && existingCache.length > 0) {
          if (hasLocalChanges) {
            console.warn(`[OfflineTemplate] ⚠️ API returned empty but cache has ${existingCache.length} attachments with local changes - protecting cache`);
            return; // Preserve cache with local changes
          }
          // No local changes - clear cache (data was deleted on server)
          console.log(`[OfflineTemplate] API returned empty, no local changes - clearing attachments cache for visual ${visualId}`);
          await this.indexedDb.cacheServiceData(visualId, 'visual_attachments', []);
          this.backgroundRefreshComplete$.next({ serviceId: visualId, dataType: 'visual_attachments' });
          return;
        }
        
        // Warn if API returns significantly fewer items but still allow if no local changes
        if (freshAttachments && existingCache.length > 0 && freshAttachments.length < existingCache.length * 0.5) {
          if (hasLocalChanges) {
            console.warn(`[OfflineTemplate] ⚠️ API returned ${freshAttachments.length} attachments but cache has ${existingCache.length} with local changes - protecting cache`);
            return; // Preserve cache with local changes
          }
          console.log(`[OfflineTemplate] API returned ${freshAttachments.length} attachments (was ${existingCache.length}), no local changes - updating cache`);
        }
        
        const localUpdates = new Map<string, any>();
        for (const att of existingCache) {
          if (att._localUpdate) {
            localUpdates.set(String(att.AttachID), att);
          }
        }
        
        // Also preserve pending attachments (created offline, not yet synced)
        const pendingAttachments = existingCache.filter((a: any) => a._tempId && String(a._tempId).startsWith('temp_'));
        
        // Merge with local updates
        let mergedAttachments = freshAttachments || [];
        if (localUpdates.size > 0) {
          mergedAttachments = mergedAttachments.map((att: any) => {
            const localUpdate = localUpdates.get(String(att.AttachID));
            if (localUpdate) {
              return { ...att, Annotation: localUpdate.Annotation, Drawings: localUpdate.Drawings, _localUpdate: true, _updatedAt: localUpdate._updatedAt };
            }
            return att;
          });
        }
        
        // Include pending attachments that aren't in the server response yet
        const finalAttachments = [...mergedAttachments, ...pendingAttachments];
        
        await this.indexedDb.cacheServiceData(visualId, 'visual_attachments', finalAttachments);
        console.log(`[OfflineTemplate] Background refresh: ${freshAttachments?.length || 0} attachments + ${pendingAttachments.length} pending for visual ${visualId}`);
        
        // Notify pages that fresh data is available
        this.backgroundRefreshComplete$.next({ serviceId: visualId, dataType: 'visual_attachments' });
      } catch (error) {
        console.debug(`[OfflineTemplate] Background refresh failed for attachments (ok - using cache)`);
      }
    }, 100);
  }

  /**
   * Refresh EFE rooms cache in background (non-blocking)
   * Emits backgroundRefreshComplete$ when done so pages can reload
   */
  private refreshEFERoomsInBackground(serviceId: string): void {
    setTimeout(async () => {
      try {
        const freshRooms = await firstValueFrom(this.caspioService.getServicesEFE(serviceId));
        
        // CRITICAL: Preserve local updates (_localUpdate flag) when merging
        // This prevents overwriting offline changes (like FDF selection) with server data
        const existingCache = await this.indexedDb.getCachedServiceData(serviceId, 'efe_rooms') || [];
        
        // Check if cache has any LOCAL changes that need protection
        const hasLocalChanges = existingCache.some((item: any) => 
          item._localUpdate || 
          (item._tempId && String(item._tempId).startsWith('temp_'))
        );
        
        // SMART DEFENSIVE GUARD: Only protect if there are actual local changes
        if ((!freshRooms || freshRooms.length === 0) && existingCache.length > 0) {
          if (hasLocalChanges) {
            console.warn(`[OfflineTemplate] ⚠️ API returned empty but cache has ${existingCache.length} EFE rooms with local changes - protecting cache`);
            return; // Preserve cache with local changes
          }
          // No local changes - clear cache (data was deleted on server)
          console.log(`[OfflineTemplate] API returned empty, no local changes - clearing EFE rooms cache for ${serviceId}`);
          await this.indexedDb.cacheServiceData(serviceId, 'efe_rooms', []);
          this.backgroundRefreshComplete$.next({ serviceId, dataType: 'efe_rooms' });
          return;
        }
        
        // Warn if API returns significantly fewer items but still allow if no local changes
        if (freshRooms && existingCache.length > 0 && freshRooms.length < existingCache.length * 0.5) {
          if (hasLocalChanges) {
            console.warn(`[OfflineTemplate] ⚠️ API returned ${freshRooms.length} rooms but cache has ${existingCache.length} with local changes - protecting cache`);
            return; // Preserve cache with local changes
          }
          console.log(`[OfflineTemplate] API returned ${freshRooms.length} rooms (was ${existingCache.length}), no local changes - updating cache`);
        }
        
        const localUpdates = new Map<string, any>();
        
        // Collect rooms with local updates
        for (const room of existingCache) {
          if (room._localUpdate) {
            // Use both EFEID and PK_ID as keys since ID types can vary
            const roomId = String(room.EFEID || room.PK_ID || room._tempId);
            localUpdates.set(roomId, room);
            console.log(`[OfflineTemplate] Preserving local updates for room ${roomId}:`, {
              FDF: room.FDF,
              Location: room.Location,
              Notes: room.Notes
            });
          }
        }
        
        // Also preserve temp rooms (created offline, not yet synced)
        const tempRooms = existingCache.filter((r: any) => r._tempId && String(r._tempId).startsWith('temp_'));
        
        // Merge fresh data with local updates
        let mergedRooms = freshRooms || [];
        if (localUpdates.size > 0) {
          mergedRooms = mergedRooms.map((room: any) => {
            const roomId = String(room.EFEID || room.PK_ID);
            const localUpdate = localUpdates.get(roomId);
            if (localUpdate) {
              // Merge: use server data but override with local changes
              return {
                ...room,
                FDF: localUpdate.FDF !== undefined ? localUpdate.FDF : room.FDF,
                Location: localUpdate.Location !== undefined ? localUpdate.Location : room.Location,
                Notes: localUpdate.Notes !== undefined ? localUpdate.Notes : room.Notes,
                _localUpdate: true  // Keep the flag until synced
              };
            }
            return room;
          });
          console.log(`[OfflineTemplate] Merged ${localUpdates.size} local updates with server data`);
        }
        
        // Include temp rooms that aren't in the server response yet
        const finalRooms = [...mergedRooms, ...tempRooms];
        
        await this.indexedDb.cacheServiceData(serviceId, 'efe_rooms', finalRooms);
        console.log(`[OfflineTemplate] Background refresh: ${freshRooms?.length || 0} EFE rooms + ${tempRooms.length} temp rooms for ${serviceId}`);
        
        // Notify pages that fresh data is available
        this.backgroundRefreshComplete$.next({ serviceId, dataType: 'efe_rooms' });
      } catch (error) {
        console.debug(`[OfflineTemplate] Background refresh failed for EFE rooms (ok - using cache)`);
      }
    }, 100);
  }

  /**
   * Refresh EFE points cache in background (non-blocking)
   * Preserves local updates when merging with server data
   * Emits backgroundRefreshComplete$ when done so pages can reload
   */
  private refreshEFEPointsInBackground(roomId: string): void {
    setTimeout(async () => {
      try {
        const freshPoints = await firstValueFrom(this.caspioService.getServicesEFEPoints(roomId));
        
        // CRITICAL: Preserve local updates (_localUpdate flag) when merging
        const existingCache = await this.indexedDb.getCachedServiceData(roomId, 'efe_points') || [];
        
        // Check if cache has any LOCAL changes that need protection
        const hasLocalChanges = existingCache.some((item: any) => 
          item._localUpdate || 
          (item._tempId && String(item._tempId).startsWith('temp_'))
        );
        
        // SMART DEFENSIVE GUARD: Only protect if there are actual local changes
        if ((!freshPoints || freshPoints.length === 0) && existingCache.length > 0) {
          if (hasLocalChanges) {
            console.warn(`[OfflineTemplate] ⚠️ API returned empty but cache has ${existingCache.length} EFE points with local changes - protecting cache`);
            return; // Preserve cache with local changes
          }
          // No local changes - clear cache (data was deleted on server)
          console.log(`[OfflineTemplate] API returned empty, no local changes - clearing EFE points cache for room ${roomId}`);
          await this.indexedDb.cacheServiceData(roomId, 'efe_points', []);
          this.backgroundRefreshComplete$.next({ serviceId: roomId, dataType: 'efe_points' });
          return;
        }
        
        // Warn if API returns significantly fewer items but still allow if no local changes
        if (freshPoints && existingCache.length > 0 && freshPoints.length < existingCache.length * 0.5) {
          if (hasLocalChanges) {
            console.warn(`[OfflineTemplate] ⚠️ API returned ${freshPoints.length} points but cache has ${existingCache.length} with local changes - protecting cache`);
            return; // Preserve cache with local changes
          }
          console.log(`[OfflineTemplate] API returned ${freshPoints.length} points (was ${existingCache.length}), no local changes - updating cache`);
        }
        
        const localUpdates = new Map<string, any>();
        
        // Collect points with local updates
        for (const point of existingCache) {
          if (point._localUpdate) {
            const pointId = String(point.PointID || point.PK_ID || point._tempId);
            localUpdates.set(pointId, point);
          }
        }
        
        // Also preserve temp points (created offline, not yet synced)
        const tempPoints = existingCache.filter((p: any) => p._tempId && String(p._tempId).startsWith('temp_'));
        
        // Merge fresh data with local updates
        let mergedPoints = freshPoints || [];
        if (localUpdates.size > 0) {
          mergedPoints = mergedPoints.map((point: any) => {
            const pointId = String(point.PointID || point.PK_ID);
            const localUpdate = localUpdates.get(pointId);
            if (localUpdate) {
              return {
                ...point,
                Elevation: localUpdate.Elevation !== undefined ? localUpdate.Elevation : point.Elevation,
                _localUpdate: true
              };
            }
            return point;
          });
          console.log(`[OfflineTemplate] Merged ${localUpdates.size} local point updates with server data`);
        }
        
        // Include temp points that aren't in the server response yet
        const finalPoints = [...mergedPoints, ...tempPoints];
        
        await this.indexedDb.cacheServiceData(roomId, 'efe_points', finalPoints);
        console.log(`[OfflineTemplate] Background refresh: ${freshPoints?.length || 0} EFE points + ${tempPoints.length} temp points for room ${roomId}`);
        
        // Notify pages that fresh data is available
        this.backgroundRefreshComplete$.next({ serviceId: roomId, dataType: 'efe_points' });
      } catch (error) {
        console.debug(`[OfflineTemplate] Background refresh failed for EFE points (ok - using cache)`);
      }
    }, 100);
  }

  /**
   * Refresh EFE point attachments cache in background (non-blocking)
   * Preserves local updates (_localUpdate flag) when merging
   * Emits backgroundRefreshComplete$ when done so pages can reload
   */
  private refreshEFEAttachmentsInBackground(pointId: string): void {
    setTimeout(async () => {
      try {
        const freshAttachments = await firstValueFrom(this.caspioService.getServicesEFEAttachments(pointId));
        
        // Preserve local updates
        const existingCache = await this.indexedDb.getCachedServiceData(pointId, 'efe_point_attachments') || [];
        
        // Check if cache has any LOCAL changes that need protection
        const hasLocalChanges = existingCache.some((item: any) => 
          item._localUpdate || 
          (item._tempId && String(item._tempId).startsWith('temp_'))
        );
        
        // SMART DEFENSIVE GUARD: Only protect if there are actual local changes
        if ((!freshAttachments || freshAttachments.length === 0) && existingCache.length > 0) {
          if (hasLocalChanges) {
            console.warn(`[OfflineTemplate] ⚠️ API returned empty but cache has ${existingCache.length} EFE attachments with local changes - protecting cache`);
            return; // Preserve cache with local changes
          }
          // No local changes - clear cache (data was deleted on server)
          console.log(`[OfflineTemplate] API returned empty, no local changes - clearing EFE attachments cache for point ${pointId}`);
          await this.indexedDb.cacheServiceData(pointId, 'efe_point_attachments', []);
          this.backgroundRefreshComplete$.next({ serviceId: pointId, dataType: 'efe_point_attachments' });
          return;
        }
        
        // Warn if API returns significantly fewer items but still allow if no local changes
        if (freshAttachments && existingCache.length > 0 && freshAttachments.length < existingCache.length * 0.5) {
          if (hasLocalChanges) {
            console.warn(`[OfflineTemplate] ⚠️ API returned ${freshAttachments.length} EFE attachments but cache has ${existingCache.length} with local changes - protecting cache`);
            return; // Preserve cache with local changes
          }
          console.log(`[OfflineTemplate] API returned ${freshAttachments.length} EFE attachments (was ${existingCache.length}), no local changes - updating cache`);
        }
        
        const localUpdates = new Map<string, any>();
        for (const att of existingCache) {
          if (att._localUpdate) {
            localUpdates.set(String(att.AttachID), att);
          }
        }
        
        // Also preserve pending attachments (created offline, not yet synced)
        const pendingAttachments = existingCache.filter((a: any) => a._tempId && String(a._tempId).startsWith('temp_'));
        
        // Merge with local updates
        let mergedAttachments = freshAttachments || [];
        if (localUpdates.size > 0) {
          mergedAttachments = mergedAttachments.map((att: any) => {
            const localUpdate = localUpdates.get(String(att.AttachID));
            if (localUpdate) {
              return { ...att, Annotation: localUpdate.Annotation, Drawings: localUpdate.Drawings, _localUpdate: true, _updatedAt: localUpdate._updatedAt };
            }
            return att;
          });
        }
        
        // Include pending attachments that aren't in the server response yet
        const finalAttachments = [...mergedAttachments, ...pendingAttachments];
        
        await this.indexedDb.cacheServiceData(pointId, 'efe_point_attachments', finalAttachments);
        console.log(`[OfflineTemplate] Background refresh: ${freshAttachments?.length || 0} EFE attachments + ${pendingAttachments.length} pending for point ${pointId}`);
        
        // Notify pages that fresh data is available
        this.backgroundRefreshComplete$.next({ serviceId: pointId, dataType: 'efe_point_attachments' });
      } catch (error) {
        console.debug(`[OfflineTemplate] Background refresh failed for EFE attachments (ok - using cache)`);
      }
    }, 100);
  }

  // ============================================
  // PENDING ITEMS HELPERS
  // ============================================

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
    // CRITICAL: Use the correct API endpoint format for creating visuals
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
      // CRITICAL: Use the correct API endpoint format with q.where clause
      await this.indexedDb.addPendingRequest({
        type: 'UPDATE',
        endpoint: `/api/caspio-proxy/tables/LPS_Services_Visuals/records?q.where=VisualID=${visualId}`,
        method: 'PUT',
        data: updates,
        dependencies: [],
        status: 'pending',
        priority: 'normal',
      });
    }

    // Update local cache with _localUpdate flag to preserve during background refresh
    const existingVisuals = await this.indexedDb.getCachedServiceData(serviceId, 'visuals') || [];
    let matchFound = false;
    const updatedVisuals = existingVisuals.map((v: any) => {
      // CRITICAL: Check BOTH PK_ID and VisualID since API returns both
      const pkMatch = String(v.PK_ID) === String(visualId);
      const visualIdMatch = String(v.VisualID) === String(visualId);
      const tempMatch = v._tempId === visualId;
      
      if (pkMatch || visualIdMatch || tempMatch) {
        matchFound = true;
        console.log(`[OfflineTemplate] Updating visual in cache: PK_ID=${v.PK_ID}, VisualID=${v.VisualID}, updates=`, updates);
        // Add _localUpdate flag so background refresh won't overwrite
        return { ...v, ...updates, _localUpdate: true };
      }
      return v;
    });
    
    if (!matchFound) {
      console.warn(`[OfflineTemplate] ⚠️ Visual ${visualId} not found in cache for service ${serviceId}`);
      console.warn(`[OfflineTemplate] Cache has ${existingVisuals.length} visuals`);
    }
    
    await this.indexedDb.cacheServiceData(serviceId, 'visuals', updatedVisuals);

    console.log(`[OfflineTemplate] Updated visual ${visualId} with _localUpdate flag (pending sync), matchFound=${matchFound}`);
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
      endpoint: '/api/caspio-proxy/tables/LPS_Services_EFE/records?response=rows',
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
      endpoint: '/api/caspio-proxy/tables/LPS_Services_EFE_Points/records?response=rows',
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



