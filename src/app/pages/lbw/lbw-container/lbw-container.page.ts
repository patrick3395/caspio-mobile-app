import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { LbwStateService } from '../services/lbw-state.service';
import { TemplatePdfService } from '../../../services/template/template-pdf.service';
import { SyncStatusWidgetComponent } from '../../../components/sync-status-widget/sync-status-widget.component';
import { OfflineDataCacheService } from '../../../services/offline-data-cache.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { OfflineService } from '../../../services/offline.service';
import { NavigationHistoryService } from '../../../services/navigation-history.service';
import { PageTitleService } from '../../../services/page-title.service';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { environment } from '../../../../environments/environment';

interface Breadcrumb {
  label: string;
  path: string;
  icon?: string;
}

@Component({
  selector: 'app-lbw-container',
  templateUrl: './lbw-container.page.html',
  styleUrls: ['./lbw-container.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, SyncStatusWidgetComponent]
})
export class LbwContainerPage implements OnInit, OnDestroy {
  projectId: string = '';
  serviceId: string = '';
  projectName: string = 'Loading...';
  breadcrumbs: Breadcrumb[] = [];
  currentPageTitle: string = 'LBW/Load Bearing Wall';
  currentPageShortTitle: string = 'LBW';
  isGeneratingPDF: boolean = false;

  // Offline-first: template loading state
  templateReady: boolean = false;
  downloadProgress: string = 'Preparing template for offline use...';

  // WEBAPP MODE: Flag for template to hide sync-related UI
  isWeb: boolean = environment.isWeb;

  // US-002 FIX: Track last loaded service to prevent unnecessary re-downloads
  // MOBILE FIX: Made static so it persists across component recreation (Ionic destroys/recreates pages)
  private static lastLoadedServiceId: string = '';

  // Subscriptions for cleanup
  private syncSubscriptions: Subscription[] = [];

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private stateService: LbwStateService,
    private pdfService: TemplatePdfService,
    private location: Location,
    private offlineCache: OfflineDataCacheService,
    private offlineTemplate: OfflineTemplateService,
    private offlineService: OfflineService,
    private navigationHistory: NavigationHistoryService,
    private pageTitleService: PageTitleService,
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
      const isNewService = LbwContainerPage.lastLoadedServiceId !== newServiceId;
      const isFirstLoad = !LbwContainerPage.lastLoadedServiceId;

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
      }

      // US-002 FIX: Only show loading and re-download if this is a NEW service
      if (isNewService || isFirstLoad) {

        // CRITICAL: Force loading screen to render before starting download
        this.templateReady = false;
        this.downloadProgress = 'Loading template data...';
        this.changeDetectorRef.detectChanges();

        // Small delay to ensure UI renders loading state
        await new Promise(resolve => setTimeout(resolve, 50));

        // CRITICAL: Download ALL template data for offline use
        await this.downloadTemplateData();

        // Track that we've loaded this service
        LbwContainerPage.lastLoadedServiceId = newServiceId;
      } else {
        // CRITICAL: Must set templateReady=true when skipping download
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
   * Template Loading - ALWAYS shows loading screen and syncs fresh data when online
   */
  private async downloadTemplateData(): Promise<void> {
    if (!this.serviceId) {
      this.templateReady = true;
      this.changeDetectorRef.detectChanges();
      return;
    }


    // WEBAPP MODE: Skip template download - pages will fetch directly from API
    if (environment.isWeb) {
      this.templateReady = true;
      this.downloadProgress = 'Ready';
      this.changeDetectorRef.detectChanges();
      return;
    }

    // MOBILE MODE: Download template for offline use
    this.templateReady = false;
    this.downloadProgress = 'Loading template data...';
    this.changeDetectorRef.detectChanges();

    const isOnline = this.offlineService.isOnline();

    if (isOnline) {
      // ONLINE: Always download fresh data
      try {
        this.downloadProgress = 'Syncing template data...';
        this.changeDetectorRef.detectChanges();

        await this.offlineTemplate.downloadTemplateForOffline(this.serviceId, 'LBW', this.projectId);

        this.downloadProgress = 'Template ready!';
        this.changeDetectorRef.detectChanges();
      } catch (error: any) {
        console.warn('[LBW Container] Template download failed:', error);
        this.downloadProgress = 'Sync failed - checking cached data...';
        this.changeDetectorRef.detectChanges();

        // Try fallback download
        try {
          this.downloadProgress = 'Attempting fallback sync...';
          this.changeDetectorRef.detectChanges();
          await Promise.all([
            this.offlineCache.refreshAllTemplates(),
            this.offlineCache.preCacheServiceData(this.serviceId)
          ]);
          this.downloadProgress = 'Template ready (partial sync)';
          this.changeDetectorRef.detectChanges();
        } catch (fallbackError) {
          console.warn('[LBW Container] Fallback also failed:', fallbackError);
          this.downloadProgress = 'Limited functionality - some data unavailable';
          this.changeDetectorRef.detectChanges();
        }
      }
    } else {
      // OFFLINE: Check for cached data
      this.downloadProgress = 'Offline - loading cached data...';
      this.changeDetectorRef.detectChanges();
      this.downloadProgress = 'Working offline with cached data';
      this.changeDetectorRef.detectChanges();
    }

    // Always mark as ready - let user proceed
    this.templateReady = true;
    this.changeDetectorRef.detectChanges();
  }

  private updateBreadcrumbs() {
    this.breadcrumbs = [];
    const url = this.router.url;

    // Reset to default title
    this.currentPageTitle = 'LBW/Load Bearing Wall';
    this.currentPageShortTitle = 'LBW';

    // Parse URL to build breadcrumbs and set page title
    // URL format: /lbw/{projectId}/{serviceId}/...

    // Check if we're on a sub-page (not the main LBW hub)
    const isSubPage = url.includes('/project-details') || url.includes('/categories') || url.includes('/category/');

    if (isSubPage) {
      // Add LBW main page as first breadcrumb when on sub-pages
      this.breadcrumbs.push({
        label: 'LBW/Load Bearing Wall',
        path: '',
        icon: 'home-outline'
      });
    }

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

    // Check for categories list page
    if (url.includes('/categories') && !url.includes('/category/')) {
      this.breadcrumbs.push({
        label: 'Load Bearing Wall',
        path: 'categories',
        icon: 'construct-outline'
      });
      this.currentPageTitle = 'Load Bearing Wall';
      this.currentPageShortTitle = 'LBW';
    }

    // Check for category detail
    const categoryMatch = url.match(/\/category\/([^\/]+)/);
    if (categoryMatch) {
      // Add categories breadcrumb first
      this.breadcrumbs.push({
        label: 'Load Bearing Wall',
        path: 'categories',
        icon: 'construct-outline'
      });

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
    this.pageTitleService.setCategoryTitle(this.currentPageShortTitle, projectAddress + ' - LBW');
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
    // If path is empty, navigate to LBW main page
    if (!crumb.path || crumb.path === '') {
      this.router.navigate(['/lbw', this.projectId, this.serviceId]);
    } else {
      this.router.navigate(['/lbw', this.projectId, this.serviceId, crumb.path]);
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

    // Check if we're on a visual detail page (must check BEFORE /category/ since URL contains both)
    if (url.includes('/visual/')) {
      // Extract category from URL and navigate to category detail page
      // URL format: /lbw/projectId/serviceId/category/categoryName/visual/templateId
      const categoryMatch = url.match(/\/category\/([^\/]+)/);
      if (categoryMatch) {
        const categoryName = categoryMatch[1];
        this.router.navigate(['/lbw', this.projectId, this.serviceId, 'category', categoryName]);
      } else {
        // Fallback to categories list if category can't be extracted
        this.router.navigate(['/lbw', this.projectId, this.serviceId, 'categories']);
      }
    } else if (url.includes('/category/')) {
      // We're on a category detail page - navigate to categories list page
      this.router.navigate(['/lbw', this.projectId, this.serviceId, 'categories']);
    } else if (url.includes('/categories')) {
      // Navigate to LBW main page
      this.router.navigate(['/lbw', this.projectId, this.serviceId]);
    } else if (url.includes('/project-details')) {
      // Navigate to LBW main page
      this.router.navigate(['/lbw', this.projectId, this.serviceId]);
    } else {
      // We're on the main LBW page, navigate to project detail
      this.navigateToHome();
    }
  }

  async generatePDF() {
    if (!this.projectId || !this.serviceId) {
      console.error('[LBW Container] Cannot generate PDF: missing project or service ID');
      return;
    }

    this.isGeneratingPDF = true;
    try {
      await this.pdfService.generatePDF(this.projectId, this.serviceId);
    } catch (error) {
      console.error('[LBW Container] Error generating PDF:', error);
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
}
