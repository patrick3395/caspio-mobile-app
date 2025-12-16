import { Component, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { EngineersFoundationStateService } from '../services/engineers-foundation-state.service';
import { EngineersFoundationPdfService } from '../services/engineers-foundation-pdf.service';
import { SyncStatusWidgetComponent } from '../../../components/sync-status-widget/sync-status-widget.component';
import { OfflineDataCacheService } from '../../../services/offline-data-cache.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { filter } from 'rxjs/operators';

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
export class EngineersFoundationContainerPage implements OnInit {
  projectId: string = '';
  serviceId: string = '';
  projectName: string = 'Loading...';
  breadcrumbs: Breadcrumb[] = [];
  currentPageTitle: string = 'Engineers Foundation Evaluation';
  currentPageShortTitle: string = 'EFE';
  isGeneratingPDF: boolean = false;
  
  // Offline-first: template loading state
  templateReady: boolean = false;
  downloadProgress: string = 'Preparing template for offline use...';

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private stateService: EngineersFoundationStateService,
    private pdfService: EngineersFoundationPdfService,
    private location: Location,
    private offlineCache: OfflineDataCacheService,
    private offlineTemplate: OfflineTemplateService
  ) {}

  ngOnInit() {
    // Get project and service IDs from route params
    this.route.params.subscribe(async params => {
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

      // CRITICAL: Download ALL template data for offline use
      // This MUST complete before user can work on template
      await this.downloadTemplateData();
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
    this.currentPageTitle = 'Engineers Foundation Evaluation';
    this.currentPageShortTitle = 'EFE';

    // Parse URL to build breadcrumbs and set page title
    // URL format: /engineers-foundation/{projectId}/{serviceId}/...

    // Check if we're on a sub-page (not the main EFE hub)
    const isSubPage = url.includes('/project-details') ||
                      url.includes('/structural') ||
                      url.includes('/elevation');

    if (isSubPage) {
      // Add EFE main page as first breadcrumb when on sub-pages
      this.breadcrumbs.push({
        label: 'Engineers Foundation Evaluation',
        path: '',
        icon: 'clipboard-outline'
      });
    }

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
   * Download complete template for offline use.
   * This downloads EVERYTHING needed to work offline from scratch.
   * BLOCKS until complete - user must wait for offline capability.
   */
  private async downloadTemplateData(): Promise<void> {
    if (!this.serviceId) {
      console.log('[EF Container] downloadTemplateData: no serviceId, skipping');
      this.templateReady = true;
      return;
    }

    console.log(`[EF Container] downloadTemplateData() called for serviceId=${this.serviceId}, projectId=${this.projectId}`);

    // Check if already downloaded (fast path for returning to template)
    const isReady = await this.offlineTemplate.isTemplateDataReady(this.serviceId, 'EFE');
    if (isReady) {
      console.log('[EF Container] Template already cached - ready immediately');
      this.templateReady = true;
      return;
    }

    // Show loading while downloading
    this.templateReady = false;
    this.downloadProgress = 'Downloading template data for offline use...';

    try {
      // Download complete template data for offline-first operation
      console.log('[EF Container] Calling downloadTemplateForOffline...');
      await this.offlineTemplate.downloadTemplateForOffline(this.serviceId, 'EFE', this.projectId);
      console.log('[EF Container] Template downloaded - ready for offline use');
      this.downloadProgress = 'Template ready!';
    } catch (error: any) {
      // Check if it's because we're offline but have cached data
      if (error.message?.includes('offline') || error.message?.includes('Cannot download')) {
        console.log('[EF Container] Offline - checking for cached data...');
        this.downloadProgress = 'Offline - loading cached data...';
        
        // Try to verify we have some cached data
        const hasTemplates = await this.offlineTemplate.getVisualTemplates();
        if (hasTemplates && hasTemplates.length > 0) {
          console.log('[EF Container] Have cached templates - continuing offline');
          this.downloadProgress = 'Working offline with cached data';
        } else {
          console.warn('[EF Container] No cached data available offline');
          this.downloadProgress = 'Limited offline - some data may be unavailable';
        }
      } else {
        console.warn('[EF Container] Template download failed:', error);
        this.downloadProgress = 'Download failed - some features may be unavailable';
        
        // Try fallback
        try {
          console.log('[EF Container] Trying fallback pre-cache...');
          await Promise.all([
            this.offlineCache.refreshAllTemplates(),
            this.offlineCache.preCacheServiceData(this.serviceId)
          ]);
          console.log('[EF Container] Fallback pre-cache completed');
        } catch (fallbackError) {
          console.warn('[EF Container] Fallback also failed:', fallbackError);
        }
      }
    } finally {
      // Always mark as ready (even if offline/failed - let user proceed)
      this.templateReady = true;
    }
  }
}
