import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { EngineersFoundationStateService } from '../services/engineers-foundation-state.service';
import { EngineersFoundationPdfService } from '../services/engineers-foundation-pdf.service';
import { SyncStatusWidgetComponent } from '../../../components/sync-status-widget/sync-status-widget.component';
import { OfflineDataCacheService } from '../../../services/offline-data-cache.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { OfflineService } from '../../../services/offline.service';
import { BackgroundSyncService } from '../../../services/background-sync.service';
import { IndexedDbService } from '../../../services/indexed-db.service';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { environment } from '../../../../environments/environment';

interface Breadcrumb {
  label: string;
  path: string;
  icon?: string;
}

@Component({
  selector: 'app-engineers-foundation-container',
  templateUrl: './engineers-foundation-container.page.html',
  styleUrls: ['./engineers-foundation-container.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, SyncStatusWidgetComponent]
})
export class EngineersFoundationContainerPage implements OnInit, OnDestroy {
  projectId: string = '';
  serviceId: string = '';
  projectName: string = 'Loading...';
  breadcrumbs: Breadcrumb[] = [];
  currentPageTitle: string = 'Engineers Foundation Evaluation';
  currentPageShortTitle: string = 'EFE';
  isGeneratingPDF: boolean = false;
  isSubPage: boolean = false;

  // Offline-first: template loading state
  templateReady: boolean = false;
  downloadProgress: string = 'Preparing template for offline use...';

  // US-002 FIX: Track last loaded service to prevent unnecessary re-downloads
  // CRITICAL: The check ONLY uses lastLoadedServiceId, NOT templateReady state!
  // This prevents the loading overlay from appearing when:
  // - Navigating within the same service (between rooms/categories)
  // - Route params re-firing for any reason (cache invalidation, navigation events)
  // - Any scenario where templateReady might be temporarily false
  // MOBILE FIX: Made static so it persists across component recreation (Ionic destroys/recreates pages)
  private static lastLoadedServiceId: string = '';

  // Subscriptions for cleanup
  private syncSubscriptions: Subscription[] = [];

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private stateService: EngineersFoundationStateService,
    private pdfService: EngineersFoundationPdfService,
    private location: Location,
    private offlineCache: OfflineDataCacheService,
    private offlineTemplate: OfflineTemplateService,
    private offlineService: OfflineService,
    private backgroundSync: BackgroundSyncService,
    private indexedDb: IndexedDbService,
    private changeDetectorRef: ChangeDetectorRef
  ) {
    // CRITICAL: Ensure loading screen shows immediately
    this.templateReady = false;
    this.downloadProgress = 'Loading template...';
  }

  ngOnInit() {
    // CRITICAL: Ensure loading screen is visible immediately
    this.templateReady = false;
    this.downloadProgress = 'Initializing template...';
    this.changeDetectorRef.detectChanges();

    // Get project and service IDs from route params
    this.route.params.subscribe(async params => {
      const newProjectId = params['projectId'];
      const newServiceId = params['serviceId'];

      // US-002 FIX: Skip re-download if navigating within the same service
      // CRITICAL: Only check serviceId, NOT templateReady state!
      // This prevents the loading overlay from appearing unnecessarily when:
      // - Navigating between rooms/categories in the same service
      // - Returning to a page after clicking back
      // - Any internal navigation that doesn't change the service
      // - Route params re-firing for any reason (cache invalidation, etc.)
      //
      // The previous bug checked both lastLoadedServiceId AND templateReady,
      // which could fail if templateReady was false for any reason during
      // navigation within the same service.
      const isNewService = EngineersFoundationContainerPage.lastLoadedServiceId !== newServiceId;
      const isFirstLoad = !EngineersFoundationContainerPage.lastLoadedServiceId;

      this.projectId = newProjectId;
      this.serviceId = newServiceId;

      // Initialize state service with IDs
      this.stateService.initialize(this.projectId, this.serviceId);

      // Subscribe to project name updates (only once per service)
      if (isNewService || isFirstLoad) {
        this.stateService.projectData$.subscribe(data => {
          if (data?.projectName) {
            this.projectName = data.projectName;
          }
        });

        // Subscribe to sync events to refresh cache when data syncs
        this.subscribeToSyncEvents();
      }

      // US-002 FIX: Only show loading and re-download if this is a NEW service
      // CRITICAL: Never show loading overlay for same service - even if templateReady is false
      if (isNewService || isFirstLoad) {
        console.log('[EF Container] New service detected, downloading template data...');

        // CRITICAL: Force loading screen to render before starting download
        this.templateReady = false;
        this.downloadProgress = 'Loading template data...';
        this.changeDetectorRef.detectChanges();

        // Small delay to ensure UI renders loading state
        await new Promise(resolve => setTimeout(resolve, 50));

        // CRITICAL: Download ALL template data for offline use
        // This MUST complete before user can work on template
        await this.downloadTemplateData();

        // Track that we've loaded this service - BEFORE setting templateReady
        // This ensures any subsequent route param emissions don't trigger reload
        EngineersFoundationContainerPage.lastLoadedServiceId = newServiceId;
      } else {
        console.log('[EF Container] Same service (' + newServiceId + '), skipping re-download to prevent hard refresh');
        // CRITICAL: Must set templateReady=true when skipping download, otherwise loading screen persists
        this.templateReady = true;
        this.changeDetectorRef.detectChanges();
      }
    });

    // Subscribe to router events to update breadcrumbs
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      this.updateBreadcrumbs();
    });

    // Initial breadcrumb update
    this.updateBreadcrumbs();
  }

  ngOnDestroy() {
    // Clean up subscriptions
    this.syncSubscriptions.forEach(sub => sub.unsubscribe());
  }

  /**
   * Subscribe to background sync events to refresh cache when data syncs
   */
  private subscribeToSyncEvents(): void {
    // When visuals sync, the cache is automatically refreshed by BackgroundSyncService
    // But we also want to know so we can potentially refresh UI
    const visualSub = this.backgroundSync.visualSyncComplete$.subscribe(event => {
      if (event.serviceId === this.serviceId) {
        console.log('[EF Container] Visual synced:', event);
        // Cache is already refreshed by BackgroundSyncService
      }
    });
    this.syncSubscriptions.push(visualSub);

    // When photos sync, cache is automatically refreshed
    const photoSub = this.backgroundSync.photoUploadComplete$.subscribe(event => {
      console.log('[EF Container] Photo upload complete:', event);
      // Cache is already refreshed by BackgroundSyncService
    });
    this.syncSubscriptions.push(photoSub);

    // When service data syncs, trigger a full cache refresh
    const serviceSub = this.backgroundSync.serviceDataSyncComplete$.subscribe(event => {
      if (event.serviceId === this.serviceId || event.projectId === this.projectId) {
        console.log('[EF Container] Service/Project data synced:', event);
        // Cache is already refreshed by BackgroundSyncService.updateCacheAfterSync()
      }
    });
    this.syncSubscriptions.push(serviceSub);
  }

  private updateBreadcrumbs() {
    this.breadcrumbs = [];
    const url = this.router.url;

    // Reset to default title
    this.currentPageTitle = 'Engineers Foundation Evaluation';
    this.currentPageShortTitle = 'EFE';

    // Parse URL to build breadcrumbs and set page title
    // URL format: /engineers-foundation/{projectId}/{serviceId}/...

    // Check if we're on a sub-page (not the main EFE hub)
    this.isSubPage = url.includes('/project-details') ||
                     url.includes('/structural') ||
                     url.includes('/elevation');

    // Always add EFE main page breadcrumb (clipboard icon)
    this.breadcrumbs.push({
      label: 'Engineers Foundation Evaluation',
      path: '',
      icon: 'clipboard-outline'
    });

    if (url.includes('/project-details')) {
      // Add Project Details breadcrumb
      this.breadcrumbs.push({ label: 'Project Details', path: 'project-details', icon: 'document-text-outline' });
      this.currentPageTitle = 'Project Details';
      this.currentPageShortTitle = 'Project Details';
    } else if (url.includes('/structural')) {
      // Add structural systems breadcrumb
      this.breadcrumbs.push({ label: 'Structural Systems', path: 'structural', icon: 'construct-outline' });
      this.currentPageTitle = 'Structural Systems';
      this.currentPageShortTitle = 'Structural';

      // Check for category detail
      const categoryMatch = url.match(/\/category\/([^\/]+)/);
      if (categoryMatch) {
        const categoryName = decodeURIComponent(categoryMatch[1]);
        const categoryIcon = this.getCategoryIcon(categoryName);
        this.breadcrumbs.push({ label: categoryName, path: `structural/category/${categoryMatch[1]}`, icon: categoryIcon });
        this.currentPageTitle = categoryName;
        this.currentPageShortTitle = categoryName;
      }
    } else if (url.includes('/elevation')) {
      // Add elevation plot breadcrumb
      this.breadcrumbs.push({ label: 'Elevation Plot', path: 'elevation', icon: 'analytics-outline' });
      this.currentPageTitle = 'Elevation Plot';
      this.currentPageShortTitle = 'Elevation';

      // Check for base-station or room
      if (url.includes('/base-station')) {
        this.breadcrumbs.push({ label: 'Base Station', path: 'elevation/base-station', icon: 'navigate-outline' });
        this.currentPageTitle = 'Base Station';
        this.currentPageShortTitle = 'Base Station';
      } else {
        const roomMatch = url.match(/\/room\/([^\/]+)/);
        if (roomMatch) {
          const roomName = decodeURIComponent(roomMatch[1]);
          this.breadcrumbs.push({ label: roomName, path: `elevation/room/${roomMatch[1]}`, icon: 'location-outline' });
          this.currentPageTitle = roomName;
          this.currentPageShortTitle = roomName;
        }
      }
    }
  }

  navigateToHome() {
    // Navigate back to the project detail page (where reports, deliverables, services are)
    this.router.navigate(['/project', this.projectId]);
  }

  navigateToCrumb(crumb: Breadcrumb) {
    // If path is empty, navigate to EFE main page (no additional path segment)
    if (!crumb.path || crumb.path === '') {
      this.router.navigate(['/engineers-foundation', this.projectId, this.serviceId]);
    } else {
      this.router.navigate(['/engineers-foundation', this.projectId, this.serviceId, crumb.path]);
    }
  }

  goBack() {
    // Navigate up one level in the folder tree hierarchy (not browser history)
    const url = this.router.url;

    // Check if we're on a deep sub-page (category detail or room)
    if (url.includes('/structural/category/')) {
      // Navigate to structural systems page
      this.router.navigate(['/engineers-foundation', this.projectId, this.serviceId, 'structural']);
    } else if (url.includes('/elevation/room/') || url.includes('/elevation/base-station')) {
      // Navigate to elevation plot page
      this.router.navigate(['/engineers-foundation', this.projectId, this.serviceId, 'elevation']);
    } else if (url.includes('/structural') || url.includes('/elevation') || url.includes('/project-details')) {
      // Navigate to EFE main page
      this.router.navigate(['/engineers-foundation', this.projectId, this.serviceId]);
    } else {
      // We're on the main EFE page, navigate to project detail
      this.navigateToHome();
    }
  }

  async generatePDF() {
    if (!this.projectId || !this.serviceId) {
      console.error('[Container] Cannot generate PDF: missing project or service ID');
      return;
    }

    this.isGeneratingPDF = true;
    try {
      await this.pdfService.generatePDF(this.projectId, this.serviceId);
    } catch (error) {
      console.error('[Container] Error generating PDF:', error);
    } finally {
      this.isGeneratingPDF = false;
    }
  }

  private getCategoryIcon(categoryName: string): string {
    const iconMap: { [key: string]: string } = {
      'Foundations': 'business-outline',
      'Grading and Drainage': 'water-outline',
      'General Conditions': 'document-text-outline',
      'Roof Structure': 'home-outline',
      'Floor Framing': 'grid-outline',
      'Wall Framing': 'apps-outline',
      'Attic': 'triangle-outline',
      'Crawlspace': 'arrow-down-outline',
      'Crawlspaces': 'arrow-down-outline',
      'Walls (Interior and Exterior)': 'square-outline',
      'Ceilings and Floors': 'layers-outline',
      'Doors (Interior and Exterior)': 'enter-outline',
      'Windows': 'stop-outline',
      'Other': 'ellipsis-horizontal-circle-outline',
      'Basements': 'cube-outline'
    };

    return iconMap[categoryName] || 'construct-outline';
  }

  /**
   * Template Loading - ALWAYS shows loading screen and syncs fresh data when online
   * 
   * The strategy is:
   * 1. ALWAYS show loading screen to indicate sync in progress
   * 2. If online: Download fresh template data (blocking)
   * 3. If offline: Check for cached data and proceed if available
   * 4. Ensure images are cached after template data is ready
   */
  private async downloadTemplateData(): Promise<void> {
    if (!this.serviceId) {
      console.log('[EF Container] loadTemplate: no serviceId, skipping');
      this.templateReady = true;
      this.changeDetectorRef.detectChanges();
      return;
    }

    console.log(`[EF Container] ========== TEMPLATE LOAD ==========`);
    console.log(`[EF Container] ServiceID: ${this.serviceId}, ProjectID: ${this.projectId}`);
    console.log(`[EF Container] Online: ${this.offlineService.isOnline()}`);

    // ALWAYS show loading screen first
    this.templateReady = false;
    this.downloadProgress = 'Loading template data...';
    this.changeDetectorRef.detectChanges();
    console.log('[EF Container] Loading screen should now be visible');

    const isOnline = this.offlineService.isOnline();

    if (isOnline) {
      // ONLINE: Always download fresh data
      try {
        this.downloadProgress = 'Syncing template data...';
        this.changeDetectorRef.detectChanges();
        console.log('[EF Container] Online - downloading fresh template data...');
        
        await this.offlineTemplate.downloadTemplateForOffline(this.serviceId, 'EFE', this.projectId);
        console.log('[EF Container] ✅ Template data synced successfully');
        
        // OPTIMIZATION: Removed blocking ensureImagesCached() call
        // Images now download in background via OfflineTemplateService.downloadImagesInBackground()
        // This allows the template to be ready immediately while images cache in background
        
        // Verify and log what was cached (debug only)
        await this.verifyDownloadedData();
        
        this.downloadProgress = 'Template ready!';
        this.changeDetectorRef.detectChanges();
        console.log('[EF Container] ✅ Template fully loaded (images caching in background)');
      } catch (error: any) {
        console.warn('[EF Container] Template download failed:', error);
        this.downloadProgress = 'Sync failed - checking cached data...';
        this.changeDetectorRef.detectChanges();
        
        // Check if we have cached data to fall back to
        const hasCachedData = await this.verifyCachedDataExists();
        if (hasCachedData) {
          console.log('[EF Container] Using cached data after sync failure');
          this.downloadProgress = 'Using cached data (sync failed)';
          this.changeDetectorRef.detectChanges();
        } else {
          // Try fallback download
          try {
            console.log('[EF Container] Trying fallback pre-cache...');
            this.downloadProgress = 'Attempting fallback sync...';
            this.changeDetectorRef.detectChanges();
            await Promise.all([
              this.offlineCache.refreshAllTemplates(),
              this.offlineCache.preCacheServiceData(this.serviceId)
            ]);
            console.log('[EF Container] Fallback completed');
            this.downloadProgress = 'Template ready (partial sync)';
            this.changeDetectorRef.detectChanges();
          } catch (fallbackError) {
            console.warn('[EF Container] Fallback also failed:', fallbackError);
            this.downloadProgress = 'Limited functionality - some data unavailable';
            this.changeDetectorRef.detectChanges();
          }
        }
      }
    } else {
      // OFFLINE: Check for cached data
      this.downloadProgress = 'Offline - loading cached data...';
      this.changeDetectorRef.detectChanges();
      console.log('[EF Container] Offline - checking for cached data...');
      
      const hasCachedData = await this.verifyCachedDataExists();
      
      if (hasCachedData) {
        console.log('[EF Container] ✅ Cached data found - ready for offline use');
        this.downloadProgress = 'Working offline with cached data';
        this.changeDetectorRef.detectChanges();
        await this.verifyDownloadedData();
      } else {
        console.warn('[EF Container] No cached data available offline');
        this.downloadProgress = 'Connect to internet to download template data';
        this.changeDetectorRef.detectChanges();
      }
    }

    // Always mark as ready - let user proceed
    this.templateReady = true;
    this.changeDetectorRef.detectChanges();
    console.log('[EF Container] Template ready, loading screen hidden');
  }

  /**
   * Verify what data was actually cached in IndexedDB after download
   * OPTIMIZATION: Only runs in development mode to avoid IndexedDB reads in production
   */
  private async verifyDownloadedData(): Promise<void> {
    // OPTIMIZATION: Skip verification in production - saves 8 IndexedDB reads
    if (environment.production) {
      console.log('[EF Container] Skipping data verification in production mode');
      return;
    }

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║         📋 VERIFYING CACHED DATA IN INDEXEDDB                   ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');

    try {
      // Check Visual Templates (Structural System categories)
      const visualTemplates = await this.indexedDb.getCachedTemplates('visual');
      const visualTemplateCount = visualTemplates?.length || 0;
      const categories = Array.from(new Set(visualTemplates?.map((t: any) => t.Category) || []));
      console.log(`║  📋 Visual Templates:        ${String(visualTemplateCount).padStart(5)} templates in ${categories.length} categories  ║`);
      if (categories.length > 0) {
        console.log(`║     Categories: ${categories.slice(0, 3).join(', ')}${categories.length > 3 ? '...' : ''}`);
      }

      // Check EFE Templates (Room definitions)
      const efeTemplates = await this.indexedDb.getCachedTemplates('efe');
      const efeTemplateCount = efeTemplates?.length || 0;
      console.log(`║  🏠 EFE Templates:           ${String(efeTemplateCount).padStart(5)} room templates                 ║`);

      // Check Service Visuals
      const serviceVisuals = await this.indexedDb.getCachedServiceData(this.serviceId, 'visuals');
      const visualCount = serviceVisuals?.length || 0;
      console.log(`║  🔍 Service Visuals:         ${String(visualCount).padStart(5)} existing items                  ║`);

      // Check EFE Rooms
      const efeRooms = await this.indexedDb.getCachedServiceData(this.serviceId, 'efe_rooms');
      const roomCount = efeRooms?.length || 0;
      console.log(`║  📐 EFE Rooms:               ${String(roomCount).padStart(5)} rooms                            ║`);

      // Check Service Record
      const serviceRecord = await this.indexedDb.getCachedServiceRecord(this.serviceId);
      const hasService = serviceRecord ? 'YES' : 'NO';
      console.log(`║  📝 Service Record:            ${hasService.padStart(3)}                                ║`);

      // Check Project Record
      const projectRecord = await this.indexedDb.getCachedProjectRecord(this.projectId);
      const hasProject = projectRecord ? 'YES' : 'NO';
      console.log(`║  📝 Project Record:            ${hasProject.padStart(3)}                                ║`);

      // Check Global Data
      const servicesDrop = await this.indexedDb.getCachedGlobalData('services_drop');
      const projectsDrop = await this.indexedDb.getCachedGlobalData('projects_drop');
      const status = await this.indexedDb.getCachedGlobalData('status');
      console.log(`║  📋 Services_Drop:           ${String(servicesDrop?.length || 0).padStart(5)} options                        ║`);
      console.log(`║  📋 Projects_Drop:           ${String(projectsDrop?.length || 0).padStart(5)} options                        ║`);
      console.log(`║  🏷️ Status:                   ${String(status?.length || 0).padStart(5)} options                        ║`);

      console.log('╠════════════════════════════════════════════════════════════════╣');
      
      // Summary verdict
      const allGood = visualTemplateCount > 0 && efeTemplateCount > 0 && serviceRecord && projectRecord;
      if (allGood) {
        console.log('║  ✅ ALL REQUIRED DATA CACHED - READY FOR OFFLINE USE            ║');
      } else {
        console.log('║  ⚠️ SOME DATA MAY BE MISSING - CHECK ABOVE                       ║');
      }
      console.log('╚════════════════════════════════════════════════════════════════╝\n');

    } catch (error) {
      console.error('║  ❌ ERROR VERIFYING CACHED DATA:', error);
      console.log('╚════════════════════════════════════════════════════════════════╝\n');
    }
  }

  /**
   * OFFLINE-FIRST: Verify that we actually have cached data in IndexedDB
   * Returns true only if critical data exists (not just the download status flag)
   * 
   * STANDARDIZED: This method verifies ALL required data types exist:
   * 1. Visual templates (Structural Systems categories)
   * 2. EFE templates (Room definitions for Elevation Plot)
   * 3. Service record (Project context)
   * 
   * If any are missing, returns false to trigger re-download.
   */
  private async verifyCachedDataExists(): Promise<boolean> {
    console.log('[EF Container] Verifying cached data exists...');
    try {
      // Check for visual templates (required for Structural Systems)
      const visualTemplates = await this.indexedDb.getCachedTemplates('visual');
      if (!visualTemplates || visualTemplates.length === 0) {
        console.log('[EF Container] ❌ No visual templates cached');
        return false;
      }
      console.log(`[EF Container] ✅ Visual templates: ${visualTemplates.length}`);

      // Check for EFE templates (required for Elevation Plot room definitions)
      const efeTemplates = await this.indexedDb.getCachedTemplates('efe');
      if (!efeTemplates || efeTemplates.length === 0) {
        console.log('[EF Container] ❌ No EFE templates cached');
        return false;
      }
      console.log(`[EF Container] ✅ EFE templates: ${efeTemplates.length}`);

      // Check for service record (required for project context)
      const serviceRecord = await this.indexedDb.getCachedServiceRecord(this.serviceId);
      if (!serviceRecord) {
        console.log('[EF Container] ❌ No service record cached');
        return false;
      }
      console.log(`[EF Container] ✅ Service record cached`);

      // STANDARDIZED: Check if EFE room data is available
      // If online and no rooms cached, let getEFERooms() fetch them
      // If offline and no rooms, that's acceptable (may be a new service)
      const efeRooms = await this.indexedDb.getCachedServiceData(this.serviceId, 'efe_rooms');
      console.log(`[EF Container] EFE rooms in cache: ${efeRooms?.length || 0}`);

      console.log('[EF Container] ✅ All required cached data verified');
      return true;
    } catch (error) {
      console.error('[EF Container] Error verifying cached data:', error);
      return false;
    }
  }

  /**
   * Ensure images are cached in IndexedDB for offline viewing
   * Runs in background - if offline, just logs and returns (images already in cache or not available)
   */
  private async ensureImagesCached(): Promise<void> {
    try {
      console.log('[EF Container] Ensuring images are cached...');
      
      let cachedCount = 0;
      let skippedCount = 0;
      let queuedCount = 0;
      
      // PART 1: Cache visual attachments (Structural Systems)
      const visuals = await this.offlineTemplate.getVisualsByService(this.serviceId);
      const visualIds = visuals.map((v: any) => v.VisualID || v.PK_ID).filter((id: any) => id);
      
      for (const visualId of visualIds) {
        try {
          const attachments = await this.offlineTemplate.getVisualAttachments(visualId);
          
          for (const att of attachments) {
            const result = await this.cacheImageIfNeeded(att);
            if (result === 'cached') cachedCount++;
            else if (result === 'skipped') skippedCount++;
            else if (result === 'queued') queuedCount++;
          }
        } catch (attErr) {
          console.warn(`[EF Container] Failed to get attachments for visual ${visualId}:`, attErr);
        }
      }
      
      console.log(`[EF Container] Visual image caching: ${cachedCount} new, ${skippedCount} existing, ${queuedCount} queued`);
      
      // PART 2: Cache EFE point attachments (Elevation Plot)
      let efeCachedCount = 0;
      let efeSkippedCount = 0;
      let efeQueuedCount = 0;
      
      const rooms = await this.offlineTemplate.getEFERooms(this.serviceId);
      for (const room of rooms) {
        const roomId = room.EFEID || room.PK_ID;
        if (!roomId) continue;
        
        try {
          const points = await this.offlineTemplate.getEFEPoints(String(roomId));
          for (const point of points) {
            const pointId = point.PointID || point.PK_ID;
            if (!pointId) continue;
            
            try {
              const attachments = await this.offlineTemplate.getEFEPointAttachments(String(pointId));
              for (const att of attachments) {
                const result = await this.cacheImageIfNeeded(att);
                if (result === 'cached') efeCachedCount++;
                else if (result === 'skipped') efeSkippedCount++;
                else if (result === 'queued') efeQueuedCount++;
              }
            } catch (pointAttErr) {
              // Ignore attachment errors for individual points
            }
          }
        } catch (pointsErr) {
          console.warn(`[EF Container] Failed to get points for room ${roomId}:`, pointsErr);
        }
      }
      
      console.log(`[EF Container] EFE image caching: ${efeCachedCount} new, ${efeSkippedCount} existing, ${efeQueuedCount} queued`);
      console.log(`[EF Container] Total: ${cachedCount + efeCachedCount} new, ${skippedCount + efeSkippedCount} existing`);
    } catch (error) {
      console.warn('[EF Container] Image caching check failed (non-critical):', error);
    }
  }

  /**
   * Helper to cache a single image if not already cached
   */
  private async cacheImageIfNeeded(att: any): Promise<'cached' | 'skipped' | 'queued' | 'failed'> {
    const attachId = String(att.AttachID || att.PK_ID);
    const s3Key = att.Attachment;
    
    if (!s3Key) return 'skipped';
    
    // Check if already cached in IndexedDB
    try {
      const cached = await this.indexedDb.getCachedPhoto(attachId);
      if (cached) return 'skipped';
    } catch (cacheErr) {
      // Ignore cache check errors
    }
    
    // Not cached - attempt to fetch if online
    if (this.offlineService.isOnline()) {
      try {
        const dataUrl = await this.offlineTemplate.fetchImageAsBase64Exposed(s3Key);
        await this.indexedDb.cachePhoto(attachId, this.serviceId, dataUrl, s3Key);
        return 'cached';
      } catch (imgErr) {
        console.warn(`[EF Container] Failed to cache image ${attachId}:`, imgErr);
        return 'failed';
      }
    } else {
      return 'queued';
    }
  }
}
