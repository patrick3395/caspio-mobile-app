import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ProjectsService, Project } from '../../services/projects.service';
import { CaspioService } from '../../services/caspio.service';

@Component({
  selector: 'app-project-detail',
  templateUrl: './project-detail.page.html',
  styleUrls: ['./project-detail.page.scss'],
  standalone: false
})
export class ProjectDetailPage implements OnInit {
  project: Project | null = null;
  loading = false;
  error = '';
  projectId: string = '';
  serviceName: string = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private projectsService: ProjectsService,
    private caspioService: CaspioService
  ) {}

  ngOnInit() {
    this.projectId = this.route.snapshot.paramMap.get('id') || '';
    if (this.projectId) {
      this.loadProject();
    }
  }

  loadProject() {
    if (!this.caspioService.isAuthenticated()) {
      this.caspioService.authenticate().subscribe({
        next: () => {
          this.fetchProject();
        },
        error: (error) => {
          this.error = 'Authentication failed';
          console.error('Authentication error:', error);
        }
      });
    } else {
      this.fetchProject();
    }
  }

  fetchProject() {
    this.loading = true;
    this.error = '';
    
    this.projectsService.getProjectById(this.projectId).subscribe({
      next: async (project) => {
        this.project = project;
        this.loading = false;
        console.log('Project loaded:', project);
        
        // Load service name if OffersID is available
        if (project['OffersID']) {
          await this.loadServiceName(String(project['OffersID']));
        }
      },
      error: (error) => {
        this.error = 'Failed to load project';
        this.loading = false;
        console.error('Error loading project:', error);
      }
    });
  }

  async loadServiceName(offersId: string) {
    try {
      const offer = await this.caspioService.getOfferById(offersId);
      if (offer) {
        this.serviceName = offer.Service_Name || '';
      }
    } catch (error) {
      console.error('Error loading service name:', error);
    }
  }

  formatAddress(): string {
    if (!this.project) return '';
    const parts = [];
    if (this.project.Address) parts.push(this.project.Address);
    if (this.project.City) parts.push(this.project.City);
    if (this.project.State) parts.push(this.project.State);
    return parts.join(', ');
  }

  getStreetViewUrl(): string {
    if (!this.project || !this.formatAddress()) {
      return 'assets/img/project-placeholder.svg';
    }
    const address = encodeURIComponent(this.formatAddress());
    const apiKey = 'AIzaSyCOlOYkj3N8PT_RnoBkVJfy2BSfepqqV3A';
    return `https://maps.googleapis.com/maps/api/streetview?size=400x200&location=${address}&key=${apiKey}`;
  }

  goBack() {
    this.router.navigate(['/tabs/active-projects']);
  }

  openTemplate(template?: any) {
    if (this.project && this.project['OffersID']) {
      this.router.navigate(['/template-form', this.projectId, String(this.project['OffersID'])]);
    } else if (template) {
      // Handle specific template navigation
      console.log('Opening template:', template);
      this.router.navigate(['/template-form', this.projectId, template.id]);
    }
  }

  hasTemplates(): boolean {
    // Check if project has associated templates
    // This will be true if the project has an OffersID or other template indicators
    return !!(this.project && (this.project['OffersID'] || this.serviceName));
  }

  getAvailableTemplates(): any[] {
    // Return available templates for this project
    // For now, return a single template if service name exists
    if (this.serviceName) {
      return [{
        id: this.project?.['OffersID'] || '1',
        name: this.serviceName
      }];
    }
    return [];
  }

  getCityState(): string {
    if (!this.project) return '';
    const parts = [];
    if (this.project.City) parts.push(this.project.City);
    if (this.project.State) parts.push(this.project.State);
    if (this.project['ZIP']) parts.push(this.project['ZIP']);
    return parts.join(', ');
  }

  formatDate(date: any): string {
    if (!date) return 'Not specified';
    try {
      const d = new Date(date);
      return d.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
    } catch {
      return date.toString();
    }
  }

  uploadDocument(docType: string) {
    console.log('Upload document:', docType);
    // TODO: Implement file upload dialog and upload to Caspio Files API
    // This will use the ServiceEfeService to upload files
  }

  viewDocument(docType: string) {
    console.log('View document:', docType);
    // TODO: Implement document viewer
    // This will retrieve and display the document from Caspio
  }
}