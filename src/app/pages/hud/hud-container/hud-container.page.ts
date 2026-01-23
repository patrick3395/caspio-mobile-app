import { Component, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { HudStateService } from '../services/hud-state.service';
import { HudPdfService } from '../services/hud-pdf.service';
import { SyncStatusWidgetComponent } from '../../../components/sync-status-widget/sync-status-widget.component';
import { OfflineDataCacheService } from '../../../services/offline-data-cache.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { NavigationHistoryService } from '../../../services/navigation-history.service';
import { PageTitleService } from '../../../services/page-title.service';
import { filter } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';

interface Breadcrumb {
  label: string;
  path: string;
  icon?: string;
}

@Component({
  selector: 'app-hud-container',
  templateUrl: './hud-container.page.html',
  styleUrls: ['./hud-container.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule, SyncStatusWidgetComponent]
})
export class HudContainerPage implements OnInit {
  projectId: string = '';
  serviceId: string = '';
  projectName: string = 'Loading...';
  breadcrumbs: Breadcrumb[] = [];
  currentPageTitle: string = 'HUD/Manufactured Home';
  currentPageShortTitle: string = 'HUD';
  isGeneratingPDF: boolean = false;
  isWeb: boolean = environment.isWeb;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private stateService: HudStateService,
    private pdfService: HudPdfService,
    private location: Location,
    private offlineCache: OfflineDataCacheService,
    private offlineTemplate: OfflineTemplateService,
    private navigationHistory: NavigationHistoryService,
    private pageTitleService: PageTitleService
  ) {}

  ngOnInit() {
    // Get project and service IDs from route params
    this.route.params.subscribe(params => {
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];

      // Initialize state service with IDs
      this.stateService.initialize(this.projectId, this.serviceId);

      // Subscribe to project name updates
      this.stateService.projectData$.subscribe(data => {
        if (data?.projectName) {
          this.projectName = data.projectName;
        }
      });

      // Pre-cache templates and service data for offline use (non-blocking)
      this.preCacheForOffline();
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
    this.currentPageTitle = 'HUD/Manufactured Home';
    this.currentPageShortTitle = 'HUD';

    // Parse URL to build breadcrumbs and set page title
    // URL format: /hud/{projectId}/{serviceId}/...

    // Check if we're on a sub-page (not the main HUD hub)
    const isSubPage = url.includes('/project-details') || url.includes('/category/');

    if (isSubPage) {
      // Add HUD main page as first breadcrumb when on sub-pages
      this.breadcrumbs.push({
        label: 'HUD/Manufactured Home',
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
   * Download complete template for offline use.
   * Runs in background, doesn't block UI.
   */
  private async preCacheForOffline(): Promise<void> {
    if (!this.serviceId) return;

    console.log('[HUD Container] Downloading template for offline use...');

    try {
      await this.offlineTemplate.downloadTemplateForOffline(this.serviceId, 'HUD');
      console.log('[HUD Container] Template downloaded - ready for offline use');
    } catch (error) {
      console.warn('[HUD Container] Template download skipped:', error);
      try {
        await Promise.all([
          this.offlineCache.refreshAllTemplates(),
          this.offlineCache.preCacheServiceData(this.serviceId)
        ]);
      } catch (fallbackError) {
        console.warn('[HUD Container] Fallback pre-cache also failed:', fallbackError);
      }
    }
  }
}

