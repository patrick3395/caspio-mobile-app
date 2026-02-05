import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { SyncStatusWidgetComponent } from '../../../components/sync-status-widget/sync-status-widget.component';
import { OfflineDataCacheService } from '../../../services/offline-data-cache.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { OfflineService } from '../../../services/offline.service';
import { NavigationHistoryService } from '../../../services/navigation-history.service';
import { PageTitleService } from '../../../services/page-title.service';
import { TemplateConfigService } from '../../../services/template/template-config.service';
import { filter } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

interface Breadcrumb {
  label: string;
  path: string;
  icon?: string;
}

@Component({
  selector: 'app-csa-container',
  templateUrl: './csa-container.page.html',
  styleUrls: ['./csa-container.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, SyncStatusWidgetComponent]
})
export class CsaContainerPage implements OnInit {
  projectId: string = '';
  serviceId: string = '';
  projectName: string = 'Loading...';
  breadcrumbs: Breadcrumb[] = [];
  currentPageTitle: string = 'Cost Segregation Analysis';
  currentPageShortTitle: string = 'CSA';
  isGeneratingPDF: boolean = false;
  isSubPage: boolean = false;

  // Offline-first: template loading state
  templateReady: boolean = false;
  downloadProgress: string = 'Preparing template...';

  // WEBAPP MODE: Flag for template to hide sync-related UI
  isWeb: boolean = environment.isWeb;

  // Track last loaded service to prevent unnecessary re-downloads
  private static lastLoadedServiceId: string = '';

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private location: Location,
    private offlineCache: OfflineDataCacheService,
    private offlineTemplate: OfflineTemplateService,
    private offlineService: OfflineService,
    private navigationHistory: NavigationHistoryService,
    private pageTitleService: PageTitleService,
    private templateConfigService: TemplateConfigService,
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

      // Skip re-download if navigating within the same service
      const isNewService = CsaContainerPage.lastLoadedServiceId !== newServiceId;
      const isFirstLoad = !CsaContainerPage.lastLoadedServiceId;

      this.projectId = newProjectId;
      this.serviceId = newServiceId;

      // Only show loading and re-download if this is a NEW service
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
        CsaContainerPage.lastLoadedServiceId = newServiceId;
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

  private updateBreadcrumbs() {
    this.breadcrumbs = [];
    const url = this.router.url;

    // Reset to default title
    this.currentPageTitle = 'Cost Segregation Analysis';
    this.currentPageShortTitle = 'CSA';

    // Check if we're on a sub-page (not the main CSA hub)
    this.isSubPage = url.includes('/project-details') || url.includes('/category/') || url.includes('/visual/');

    if (this.isSubPage) {
      // Add CSA main page as first breadcrumb when on sub-pages
      this.breadcrumbs.push({
        label: 'Cost Segregation Analysis',
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

    // Check for visual detail (must be after category check)
    const visualMatch = url.match(/\/visual\/([^\/]+)/);
    if (visualMatch && categoryMatch) {
      this.breadcrumbs.push({
        label: 'Visual Detail',
        path: `category/${categoryMatch[1]}/visual/${visualMatch[1]}`,
        icon: 'image-outline'
      });
      this.currentPageTitle = 'Visual Detail';
      this.currentPageShortTitle = 'Visual';
    }

    // Update page title with project address and current section
    this.updatePageTitle();
  }

  private updatePageTitle() {
    if (!environment.isWeb) return;

    const projectAddress = this.projectName || 'Project';
    this.pageTitleService.setCategoryTitle(this.currentPageShortTitle, projectAddress + ' - CSA');
  }

  navigateToHome() {
    // Navigate back to the project detail page
    if (environment.isWeb) {
      this.router.navigate(['/project', this.projectId], { replaceUrl: true });
    } else {
      this.router.navigate(['/project', this.projectId]);
    }
  }

  navigateToCrumb(crumb: Breadcrumb) {
    // If path is empty, navigate to CSA main page
    if (!crumb.path || crumb.path === '') {
      this.router.navigate(['/csa', this.projectId, this.serviceId]);
    } else {
      this.router.navigate(['/csa', this.projectId, this.serviceId, crumb.path]);
    }
  }

  goBack() {
    // On web, use browser history for proper back/forward support
    if (environment.isWeb && this.navigationHistory.canGoBack()) {
      this.navigationHistory.navigateBack();
      return;
    }

    // Mobile fallback: Navigate up one level in the folder tree hierarchy
    const url = this.router.url;

    // IMPORTANT: Check for /visual/ first since it also contains /category/
    if (url.includes('/category/') && url.includes('/visual/')) {
      // On visual-detail page - navigate back to category-detail page
      const categoryMatch = url.match(/\/category\/([^\/]+)/);
      if (categoryMatch) {
        this.router.navigate(['/csa', this.projectId, this.serviceId, 'category', categoryMatch[1]]);
      } else {
        this.router.navigate(['/csa', this.projectId, this.serviceId]);
      }
    } else if (url.includes('/category/')) {
      // Navigate to categories list page
      this.router.navigate(['/csa', this.projectId, this.serviceId, 'categories']);
    } else if (url.includes('/categories')) {
      // Navigate to CSA main page
      this.router.navigate(['/csa', this.projectId, this.serviceId]);
    } else if (url.includes('/project-details')) {
      // Navigate to CSA main page
      this.router.navigate(['/csa', this.projectId, this.serviceId]);
    } else {
      // We're on the main CSA page, navigate to project detail
      this.navigateToHome();
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

        await this.offlineTemplate.downloadTemplateForOffline(this.serviceId, 'CSA', this.projectId);

        this.downloadProgress = 'Template ready!';
        this.changeDetectorRef.detectChanges();
      } catch (error: any) {
        console.warn('[CSA Container] Template download failed:', error);
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
          console.warn('[CSA Container] Fallback also failed:', fallbackError);
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
}
