import { Component, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { LbwStateService } from '../services/lbw-state.service';
import { LbwPdfService } from '../services/lbw-pdf.service';
import { filter } from 'rxjs/operators';

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
  imports: [CommonModule, IonicModule, RouterModule]
})
export class LbwContainerPage implements OnInit {
  projectId: string = '';
  serviceId: string = '';
  projectName: string = 'Loading...';
  breadcrumbs: Breadcrumb[] = [];
  currentPageTitle: string = 'LBW/Load Bearing Wall';
  currentPageShortTitle: string = 'LBW';
  isGeneratingPDF: boolean = false;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private stateService: LbwStateService,
    private pdfService: LbwPdfService,
    private location: Location
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
    this.currentPageTitle = 'LBW/Load Bearing Wall';
    this.currentPageShortTitle = 'LBW';

    // Parse URL to build breadcrumbs and set page title
    // URL format: /lbw/{projectId}/{serviceId}/...

    // Check if we're on a sub-page (not the main HUD hub)
    const isSubPage = url.includes('/project-details') || url.includes('/category/');

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
  }

  navigateToHome() {
    // Navigate back to the project detail page
    this.router.navigate(['/project', this.projectId]);
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
    // Navigate up one level in the folder tree hierarchy
    const url = this.router.url;

    // Check if we're on a category detail page
    if (url.includes('/category/')) {
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


