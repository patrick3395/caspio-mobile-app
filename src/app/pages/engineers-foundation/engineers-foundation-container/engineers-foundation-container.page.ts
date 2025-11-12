import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { RouterModule, Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { EngineersFoundationStateService } from '../services/engineers-foundation-state.service';
import { filter } from 'rxjs/operators';

interface Breadcrumb {
  label: string;
  path: string;
}

@Component({
  selector: 'app-engineers-foundation-container',
  templateUrl: './engineers-foundation-container.page.html',
  styleUrls: ['./engineers-foundation-container.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, RouterModule]
})
export class EngineersFoundationContainerPage implements OnInit {
  projectId: string = '';
  serviceId: string = '';
  projectName: string = 'Loading...';
  breadcrumbs: Breadcrumb[] = [];
  currentPageTitle: string = 'Engineers Foundation Evaluation';
  currentPageShortTitle: string = 'EFE';

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private stateService: EngineersFoundationStateService
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
    this.currentPageTitle = 'Engineers Foundation Evaluation';
    this.currentPageShortTitle = 'EFE';

    // Parse URL to build breadcrumbs and set page title
    // URL format: /engineers-foundation/{projectId}/{serviceId}/...

    if (url.includes('/project-details')) {
      this.breadcrumbs.push({ label: 'Project Details', path: 'project-details' });
      this.currentPageTitle = 'Project Details';
      this.currentPageShortTitle = 'Project Details';
    } else if (url.includes('/structural')) {
      this.breadcrumbs.push({ label: 'Structural Systems', path: 'structural' });
      this.currentPageTitle = 'Structural Systems';
      this.currentPageShortTitle = 'Structural';

      // Check for category detail
      const categoryMatch = url.match(/\/category\/([^\/]+)/);
      if (categoryMatch) {
        const categoryName = decodeURIComponent(categoryMatch[1]);
        this.breadcrumbs.push({ label: categoryName, path: `structural/category/${categoryMatch[1]}` });
        this.currentPageTitle = categoryName;
        this.currentPageShortTitle = categoryName;
      }
    } else if (url.includes('/elevation')) {
      this.breadcrumbs.push({ label: 'Elevation Plot', path: 'elevation' });
      this.currentPageTitle = 'Elevation Plot';
      this.currentPageShortTitle = 'Elevation';

      // Check for base-station or room
      if (url.includes('/base-station')) {
        this.breadcrumbs.push({ label: 'Base Station', path: 'elevation/base-station' });
        this.currentPageTitle = 'Base Station';
        this.currentPageShortTitle = 'Base Station';
      } else {
        const roomMatch = url.match(/\/room\/([^\/]+)/);
        if (roomMatch) {
          const roomName = decodeURIComponent(roomMatch[1]);
          this.breadcrumbs.push({ label: roomName, path: `elevation/room/${roomMatch[1]}` });
          this.currentPageTitle = roomName;
          this.currentPageShortTitle = roomName;
        }
      }
    }
  }

  navigateToHome() {
    this.router.navigate(['/engineers-foundation', this.projectId, this.serviceId]);
  }

  navigateToCrumb(crumb: Breadcrumb) {
    this.router.navigate(['/engineers-foundation', this.projectId, this.serviceId, crumb.path]);
  }

  goBack() {
    // Navigate back to project detail
    this.router.navigate(['/project', this.projectId]);
  }
}
