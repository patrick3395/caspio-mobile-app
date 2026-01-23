import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { HudStateService } from '../services/hud-state.service';
import { HudPdfService } from '../services/hud-pdf.service';
import { HudDataService } from '../hud-data.service';
import { SyncStatusWidgetComponent } from '../../../components/sync-status-widget/sync-status-widget.component';
import { OfflineDataCacheService } from '../../../services/offline-data-cache.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { OfflineService } from '../../../services/offline.service';
import { BackgroundSyncService } from '../../../services/background-sync.service';
import { IndexedDbService } from '../../../services/indexed-db.service';
import { NavigationHistoryService } from '../../../services/navigation-history.service';
import { PageTitleService } from '../../../services/page-title.service';
import { filter } from 'rxjs/operators';
import { Subscription, firstValueFrom } from 'rxjs';
import { CaspioService } from '../../../services/caspio.service';
import { environment } from '../../../../environments/environment';

interface Breadcrumb {
  label: string;
  path: string;
  icon?: string;
}

/**
 * HUD Container Page
 *
 * Data Loading Architecture:
 * - Uses Dexie-first pattern: checks cache before API calls
 * - HUD services use TypeID=2 in LPS_Services table
 * - Template loading uses HUD-specific methods (getCachedTemplates('hud'), downloadTemplateForOffline with 'HUD' type)
 * - HUD data operations use HUD-specific API endpoints (getServicesHUDByServiceId, getServiceHUDAttachByHUDId)
 * - Attachments use getServiceHUDAttachByHUDId endpoint
 *
 * Service Instance Tracking:
 * - Supports multiple HUD services per project (HUD #1, HUD #2, etc.)
 * - loadServiceInstanceNumber() queries CaspioService for all project services
 * - Filters by same TypeID and sorts by PK_ID for consistent ordering
 */
@Component({
  selector: 'app-hud-container',
  templateUrl: './hud-container.page.html',
  styleUrls: ['./hud-container.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, SyncStatusWidgetComponent]
})
export class HudContainerPage implements OnInit, OnDestroy {
  projectId: string = '';
  serviceId: string = '';
  projectName: string = 'Loading...';
  breadcrumbs: Breadcrumb[] = [];
  currentPageTitle: string = 'HUD/Manufactured Home';
  currentPageShortTitle: string = 'HUD';
  isGeneratingPDF: boolean = false;
  isSubPage: boolean = false;

  // Service instance tracking for multiple HUD services on same project
  serviceInstanceNumber: number = 1;
  totalHUDServices: number = 1;
  private serviceInstanceLoaded: boolean = false;

  // Offline-first: template loading state
  templateReady: boolean = false;
  downloadProgress: string = 'Preparing template for offline use...';

  // WEBAPP MODE: Flag for template to hide sync-related UI
  isWeb: boolean = environment.isWeb;

  // US-002 FIX: Track last loaded service to prevent unnecessary re-downloads
  // CRITICAL: The check ONLY uses lastLoadedServiceId, NOT templateReady state!
  // This prevents the loading overlay from appearing when:
  // - Navigating within the same service (between categories)
  // - Route params re-firing for any reason (cache invalidation, navigation events)
  // - Any scenario where templateReady might be temporarily false
  // MOBILE FIX: Made static so it persists across component recreation (Ionic destroys/recreates pages)
  private static lastLoadedServiceId: string = '';

  // Subscriptions for cleanup
  private syncSubscriptions: Subscription[] = [];

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private stateService: HudStateService,
    private pdfService: HudPdfService,
    private location: Location,
    private offlineCache: OfflineDataCacheService,
    private offlineTemplate: OfflineTemplateService,
    private offlineService: OfflineService,
    private backgroundSync: BackgroundSyncService,
    private indexedDb: IndexedDbService,
    private changeDetectorRef: ChangeDetectorRef,
    private navigationHistory: NavigationHistoryService,
    private pageTitleService: PageTitleService,
    private hudData: HudDataService,
    private caspioService: CaspioService
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
      const isNewService = HudContainerPage.lastLoadedServiceId !== newServiceId;
      const isFirstLoad = !HudContainerPage.lastLoadedServiceId;

      this.projectId = newProjectId;
      this.serviceId = newServiceId;

      // Initialize state service with IDs
      this.stateService.initialize(this.projectId, this.serviceId);

      // Load service instance number (for multiple HUD services on same project)
      // MUST await this to ensure instance number is loaded before UI renders
      // FIX: Also check !serviceInstanceLoaded because the component may be recreated
      // (instance variables reset to defaults) while lastLoadedServiceId is static (persists).
      // Without this check, returning to the same service would skip loading and show "HUD" not "HUD #1"
      if (isNewService || isFirstLoad || !this.serviceInstanceLoaded) {
        await this.loadServiceInstanceNumber();
      }

      // ========== REHYDRATION CHECK (runs every time, not just new service) ==========
      // Check if service was purged and needs data restored
      // This must run even for "same service" because user might have force purged
      if (!environment.isWeb && this.offlineService.isOnline()) {
        try {
          const needsRehydration = await this.hudData.needsRehydration(newServiceId);
          if (needsRehydration) {
            console.log('[HUD Container] Service needs rehydration - starting...');

            // Show loading screen for rehydration
            this.templateReady = false;
            this.downloadProgress = 'Restoring data from server...';
            this.changeDetectorRef.detectChanges();

            const result = await this.hudData.rehydrateService(newServiceId);

            if (result.success) {
              console.log(`[HUD Container] Rehydration complete: ${result.restored.hudRecords} records, ${result.restored.hudAttachments} attachments`);
            } else {
              console.error(`[HUD Container] Rehydration failed: ${result.error}`);
            }
          }
        } catch (err) {
          console.error('[HUD Container] Rehydration check failed:', err);
        }
      }

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
        console.log('[HUD Container] New service detected, downloading template data...');

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
        HudContainerPage.lastLoadedServiceId = newServiceId;
      } else {
        console.log('[HUD Container] Same service (' + newServiceId + '), skipping re-download to prevent hard refresh');
        // CRITICAL: Must set templateReady=true when skipping download, otherwise loading screen persists
        this.templateReady = true;
        this.changeDetectorRef.detectChanges();
      }

      // Update breadcrumbs after loading
      this.updateBreadcrumbs();
    });

    // Subscribe to router events to update breadcrumbs
    // Only update if service instance has been loaded (totalHUDServices is set)
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      // Only update breadcrumbs after initial load has completed
      // The initial breadcrumb update is done in loadServiceInstanceNumber()
      if (this.serviceInstanceLoaded) {
        this.updateBreadcrumbs();
      }
    });
  }

  ngOnDestroy() {
    // Clean up subscriptions
    this.syncSubscriptions.forEach(sub => sub.unsubscribe());
  }

  /**
   * Subscribe to background sync events to refresh cache when data syncs
   */
  private subscribeToSyncEvents(): void {
    // When HUD data syncs, refresh cache
    const hudSyncSub = this.backgroundSync.hudSyncComplete$.subscribe(event => {
      if (event.serviceId === this.serviceId) {
        console.log('[HUD Container] HUD data synced:', event);
        // Cache is automatically refreshed by BackgroundSyncService
      }
    });
    this.syncSubscriptions.push(hudSyncSub);

    // When photos sync, cache is automatically refreshed
    const photoSub = this.backgroundSync.hudPhotoUploadComplete$.subscribe(event => {
      console.log('[HUD Container] HUD photo upload complete:', event);
      // Cache is already refreshed by BackgroundSyncService
    });
    this.syncSubscriptions.push(photoSub);

    // When service data syncs, trigger a full cache refresh
    const serviceSub = this.backgroundSync.serviceDataSyncComplete$.subscribe(event => {
      if (event.serviceId === this.serviceId || event.projectId === this.projectId) {
        console.log('[HUD Container] Service/Project data synced:', event);
        // Cache is already refreshed by BackgroundSyncService.updateCacheAfterSync()
      }
    });
    this.syncSubscriptions.push(serviceSub);
  }

  private updateBreadcrumbs() {
    this.breadcrumbs = [];
    const url = this.router.url;

    // Reset to default title - include instance number if multiple HUD services exist
    if (this.totalHUDServices > 1) {
      this.currentPageTitle = `HUD/Manufactured Home #${this.serviceInstanceNumber}`;
      this.currentPageShortTitle = `HUD #${this.serviceInstanceNumber}`;
    } else {
      this.currentPageTitle = 'HUD/Manufactured Home';
      this.currentPageShortTitle = 'HUD';
    }

    // Parse URL to build breadcrumbs and set page title
    // URL format: /hud/{projectId}/{serviceId}/...

    // Check if we're on a sub-page (not the main HUD hub)
    this.isSubPage = url.includes('/project-details') || url.includes('/category/');

    // Always add HUD main page breadcrumb (include instance number if multiple)
    const hudLabel = this.totalHUDServices > 1
      ? `HUD/Manufactured Home #${this.serviceInstanceNumber}`
      : 'HUD/Manufactured Home';
    this.breadcrumbs.push({
      label: hudLabel,
      path: '',
      icon: 'clipboard-outline'
    });

    // Check for project details
    if (url.includes('/project-details')) {
      this.breadcrumbs.push({
        label: 'Project Details',
        path: 'project-details',
        icon: 'document-text-outline'
      });
      this.currentPageTitle = 'Project Details';
      this.currentPageShortTitle = 'Project Details';
    }

    // Check for category detail
    const categoryMatch = url.match(/\/category\/([^\/]+)/);
    if (categoryMatch) {
      const categoryName = decodeURIComponent(categoryMatch[1]);
      const categoryIcon = this.getCategoryIcon(categoryName);
      this.breadcrumbs.push({
        label: categoryName,
        path: `category/${categoryMatch[1]}`,
        icon: categoryIcon
      });
      this.currentPageTitle = categoryName;
      this.currentPageShortTitle = categoryName;
    }

    // G2-SEO-001: Update page title with project address and current section
    this.updatePageTitle();
  }

  /**
   * G2-SEO-001: Update browser tab title based on current page
   */
  private updatePageTitle() {
    if (!environment.isWeb) return;

    const projectAddress = this.projectName || 'Project';
    this.pageTitleService.setCategoryTitle(this.currentPageShortTitle, projectAddress + ' - HUD');
  }

  /**
   * Load service instance number for display when multiple HUD services exist on the same project
   * This allows showing "HUD #1", "HUD #2" etc. in the header
   */
  private async loadServiceInstanceNumber(): Promise<void> {
    try {
      // First get the current service to find its TypeID
      // Try offline cache first, then fall back to API (needed for web mode)
      let currentService = await this.offlineTemplate.getService(this.serviceId);

      if (!currentService) {
        // Fallback to API (especially needed in web mode where template download is skipped)
        console.log('[HUD Container] No cached service, fetching from API...');
        currentService = await firstValueFrom(this.caspioService.getService(this.serviceId, false));
      }

      if (!currentService) {
        console.log('[HUD Container] Could not load current service from cache or API');
        return;
      }

      // Convert TypeID to string for consistent comparison
      const currentTypeId = String(currentService.TypeID);
      console.log(`[HUD Container] Current service TypeID: ${currentTypeId}`);

      // Get all services for this project
      const allServices = await firstValueFrom(this.caspioService.getServicesByProject(this.projectId));
      console.log(`[HUD Container] Found ${allServices?.length || 0} total services for project`);

      // Debug: log all services and their TypeIDs
      if (allServices) {
        allServices.forEach((s: any) => {
          console.log(`[HUD Container] Service ${s.PK_ID || s.ServiceID}: TypeID=${s.TypeID}`);
        });
      }

      // Filter to only services with the same TypeID (same service type)
      // Use String() conversion for consistent comparison
      const sameTypeServices = (allServices || [])
        .filter((s: any) => String(s.TypeID) === currentTypeId)
        .sort((a: any, b: any) => {
          // Sort by PK_ID (ServiceID) to get consistent ordering
          const idA = parseInt(a.PK_ID || a.ServiceID) || 0;
          const idB = parseInt(b.PK_ID || b.ServiceID) || 0;
          return idA - idB;
        });

      console.log(`[HUD Container] Same type services count: ${sameTypeServices.length}`);
      this.totalHUDServices = sameTypeServices.length;

      // Find the index of the current service
      const currentIndex = sameTypeServices.findIndex((s: any) =>
        String(s.PK_ID || s.ServiceID) === String(this.serviceId)
      );

      this.serviceInstanceNumber = currentIndex >= 0 ? currentIndex + 1 : 1;

      console.log(`[HUD Container] Service instance: ${this.serviceInstanceNumber} of ${this.totalHUDServices} HUD services`);

      // Mark as loaded and update breadcrumbs with new instance number
      this.serviceInstanceLoaded = true;
      this.updateBreadcrumbs();
      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.warn('[HUD Container] Error loading service instance number:', error);
      // Keep defaults (1 of 1) but still mark as loaded
      this.serviceInstanceLoaded = true;
      this.updateBreadcrumbs();
      this.changeDetectorRef.detectChanges();
    }
  }

  navigateToHome() {
    // Navigate back to the project detail page
    // Use replaceUrl on web to avoid template staying in browser history
    if (environment.isWeb) {
      this.router.navigate(['/project', this.projectId], { replaceUrl: true });
    } else {
      this.router.navigate(['/project', this.projectId]);
    }
  }

  navigateToCrumb(crumb: Breadcrumb) {
    // If path is empty, navigate to HUD main page
    if (!crumb.path || crumb.path === '') {
      this.router.navigate(['/hud', this.projectId, this.serviceId]);
    } else {
      this.router.navigate(['/hud', this.projectId, this.serviceId, crumb.path]);
    }
  }

  goBack() {
    // G2-NAV-001: On web, use browser history for proper back/forward support
    if (environment.isWeb && this.navigationHistory.canGoBack()) {
      this.navigationHistory.navigateBack();
      return;
    }

    // Mobile fallback: Navigate up one level in the folder tree hierarchy
    const url = this.router.url;

    // Check if we're on a category detail page
    if (url.includes('/category/')) {
      // Navigate to HUD main page
      this.router.navigate(['/hud', this.projectId, this.serviceId]);
    } else if (url.includes('/project-details')) {
      // Navigate to HUD main page
      this.router.navigate(['/hud', this.projectId, this.serviceId]);
    } else {
      // We're on the main HUD page, navigate to project detail
      this.navigateToHome();
    }
  }

  async generatePDF() {
    if (!this.projectId || !this.serviceId) {
      console.error('[HUD Container] Cannot generate PDF: missing project or service ID');
      return;
    }

    this.isGeneratingPDF = true;
    try {
      await this.pdfService.generatePDF(this.projectId, this.serviceId);
    } catch (error) {
      console.error('[HUD Container] Error generating PDF:', error);
    } finally {
      this.isGeneratingPDF = false;
    }
  }

  private getCategoryIcon(categoryName: string): string {
    // Map category names to icons
    const iconMap: { [key: string]: string } = {
      'Site': 'globe-outline',
      'Foundation': 'business-outline',
      'Exterior': 'home-outline',
      'Roof': 'umbrella-outline',
      'Structure': 'construct-outline',
      'Plumbing': 'water-outline',
      'Electrical': 'flash-outline',
      'Heating/Cooling': 'thermometer-outline',
      'Interior': 'grid-outline',
      'Appliances': 'apps-outline',
      'Other': 'ellipsis-horizontal-circle-outline'
    };

    return iconMap[categoryName] || 'document-text-outline';
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
      console.log('[HUD Container] loadTemplate: no serviceId, skipping');
      this.templateReady = true;
      this.changeDetectorRef.detectChanges();
      return;
    }

    console.log(`[HUD Container] ========== TEMPLATE LOAD ==========`);
    console.log(`[HUD Container] ServiceID: ${this.serviceId}, ProjectID: ${this.projectId}`);
    console.log(`[HUD Container] Online: ${this.offlineService.isOnline()}`);

    // WEBAPP MODE: Skip template download - pages will fetch directly from API
    if (environment.isWeb) {
      console.log('[HUD Container] WEBAPP MODE: Skipping template download - pages fetch from API directly');
      this.templateReady = true;
      this.downloadProgress = 'Ready';
      this.changeDetectorRef.detectChanges();
      return;
    }

    // MOBILE MODE: Download template for offline use
    // ALWAYS show loading screen first
    this.templateReady = false;
    this.downloadProgress = 'Loading template data...';
    this.changeDetectorRef.detectChanges();
    console.log('[HUD Container] Loading screen should now be visible');

    const isOnline = this.offlineService.isOnline();

    if (isOnline) {
      // ONLINE: Always download fresh data
      try {
        this.downloadProgress = 'Syncing template data...';
        this.changeDetectorRef.detectChanges();
        console.log('[HUD Container] Online - downloading fresh template data...');

        await this.offlineTemplate.downloadTemplateForOffline(this.serviceId, 'HUD', this.projectId);
        console.log('[HUD Container] ✅ Template data synced successfully');

        // Verify and log what was cached (debug only)
        await this.verifyDownloadedData();

        this.downloadProgress = 'Template ready!';
        this.changeDetectorRef.detectChanges();
        console.log('[HUD Container] ✅ Template fully loaded');
      } catch (error: any) {
        console.warn('[HUD Container] Template download failed:', error);
        this.downloadProgress = 'Sync failed - checking cached data...';
        this.changeDetectorRef.detectChanges();

        // Check if we have cached data to fall back to
        const hasCachedData = await this.verifyCachedDataExists();
        if (hasCachedData) {
          console.log('[HUD Container] Using cached data after sync failure');
          this.downloadProgress = 'Using cached data (sync failed)';
          this.changeDetectorRef.detectChanges();
        } else {
          // Try fallback download
          try {
            console.log('[HUD Container] Trying fallback pre-cache...');
            this.downloadProgress = 'Attempting fallback sync...';
            this.changeDetectorRef.detectChanges();
            await Promise.all([
              this.offlineCache.refreshAllTemplates(),
              this.offlineCache.preCacheServiceData(this.serviceId)
            ]);
            console.log('[HUD Container] Fallback completed');
            this.downloadProgress = 'Template ready (partial sync)';
            this.changeDetectorRef.detectChanges();
          } catch (fallbackError) {
            console.warn('[HUD Container] Fallback also failed:', fallbackError);
            this.downloadProgress = 'Limited functionality - some data unavailable';
            this.changeDetectorRef.detectChanges();
          }
        }
      }
    } else {
      // OFFLINE: Check for cached data
      this.downloadProgress = 'Offline - loading cached data...';
      this.changeDetectorRef.detectChanges();
      console.log('[HUD Container] Offline - checking for cached data...');

      const hasCachedData = await this.verifyCachedDataExists();

      if (hasCachedData) {
        console.log('[HUD Container] ✅ Cached data found - ready for offline use');
        this.downloadProgress = 'Working offline with cached data';
        this.changeDetectorRef.detectChanges();
        await this.verifyDownloadedData();
      } else {
        console.warn('[HUD Container] No cached data available offline');
        this.downloadProgress = 'Connect to internet to download template data';
        this.changeDetectorRef.detectChanges();
      }
    }

    // Always mark as ready - let user proceed
    this.templateReady = true;
    this.changeDetectorRef.detectChanges();
    console.log('[HUD Container] Template ready, loading screen hidden');
  }

  /**
   * Verify what data was actually cached in IndexedDB after download
   * OPTIMIZATION: Only runs in development mode to avoid IndexedDB reads in production
   */
  private async verifyDownloadedData(): Promise<void> {
    // OPTIMIZATION: Skip verification in production - saves IndexedDB reads
    if (environment.production) {
      console.log('[HUD Container] Skipping data verification in production mode');
      return;
    }

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║         📋 VERIFYING CACHED DATA IN INDEXEDDB (HUD)            ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');

    try {
      // Check HUD Templates
      const hudTemplates = await this.indexedDb.getCachedTemplates('hud');
      const hudTemplateCount = hudTemplates?.length || 0;
      const categories = Array.from(new Set(hudTemplates?.map((t: any) => t.Category) || []));
      console.log(`║  📋 HUD Templates:           ${String(hudTemplateCount).padStart(5)} templates in ${categories.length} categories  ║`);
      if (categories.length > 0) {
        console.log(`║     Categories: ${categories.slice(0, 3).join(', ')}${categories.length > 3 ? '...' : ''}`);
      }

      // Note: HUD field data is stored in db.hudFields table (Dexie-first pattern)
      // Fields are created on-demand when user enters a category, so we don't verify here

      // Check Service Record
      const serviceRecord = await this.indexedDb.getCachedServiceRecord(this.serviceId);
      const hasService = serviceRecord ? 'YES' : 'NO';
      console.log(`║  📝 Service Record:            ${hasService.padStart(3)}                                ║`);

      // Check Project Record
      const projectRecord = await this.indexedDb.getCachedProjectRecord(this.projectId);
      const hasProject = projectRecord ? 'YES' : 'NO';
      console.log(`║  📝 Project Record:            ${hasProject.padStart(3)}                                ║`);

      console.log('╠════════════════════════════════════════════════════════════════╣');

      // Summary verdict
      const allGood = hudTemplateCount > 0 && serviceRecord && projectRecord;
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
   */
  private async verifyCachedDataExists(): Promise<boolean> {
    console.log('[HUD Container] Verifying cached data exists...');
    try {
      // Check for HUD templates (required for categories)
      const hudTemplates = await this.indexedDb.getCachedTemplates('hud');
      if (!hudTemplates || hudTemplates.length === 0) {
        console.log('[HUD Container] ❌ No HUD templates cached');
        return false;
      }
      console.log(`[HUD Container] ✅ HUD templates: ${hudTemplates.length}`);

      // Check for service record (required for project context)
      const serviceRecord = await this.indexedDb.getCachedServiceRecord(this.serviceId);
      if (!serviceRecord) {
        console.log('[HUD Container] ❌ No service record cached');
        return false;
      }
      console.log(`[HUD Container] ✅ Service record cached`);

      console.log('[HUD Container] ✅ All required cached data verified');
      return true;
    } catch (error) {
      console.error('[HUD Container] Error verifying cached data:', error);
      return false;
    }
  }
}
