import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { ProjectsService, Project } from '../../services/projects.service';
import { CaspioService } from '../../services/caspio.service';
import { AlertController } from '@ionic/angular';
import { environment } from '../../../environments/environment';
import { PlatformDetectionService } from '../../services/platform-detection.service';

@Component({
  selector: 'app-all-projects',
  templateUrl: './all-projects.page.html',
  styleUrls: ['./all-projects.page.scss'],
  standalone: false
})
export class AllProjectsPage implements OnInit {
  projects: Project[] = [];
  filteredProjects: Project[] = [];
  completedProjects: Project[] = [];
  onHoldProjects: Project[] = [];
  cancelledProjects: Project[] = [];
  archivedProjects: Project[] = [];
  loading = false;
  error = '';
  currentUser: any = null;
  searchTerm = '';
  private readonly googleMapsApiKey = environment.googleMapsApiKey;

  // Get current user info
  getUserInfo(): string {
    if (this.currentUser) {
      return `${this.currentUser.name || this.currentUser.Name || 'User'} (Company ${this.currentUser.companyId || this.currentUser.CompanyID || ''})`;
    }
    return '';
  }

  constructor(
    private projectsService: ProjectsService,
    private caspioService: CaspioService,
    private router: Router,
    private route: ActivatedRoute,
    private alertController: AlertController,
    public platform: PlatformDetectionService
  ) {}

  ngOnInit() {
    // Load current user info
    const userStr = localStorage.getItem('currentUser');
    if (userStr) {
      try {
        this.currentUser = JSON.parse(userStr);
      } catch (e) {
        console.error('Error parsing user data:', e);
      }
    }
    
    this.checkAuthAndLoadProjects();
  }

  ionViewWillEnter() {
    this.checkAuthAndLoadProjects();
  }

  checkAuthAndLoadProjects() {
    if (!this.caspioService.isAuthenticated()) {
      this.authenticateAndLoad();
    } else {
      this.loadAllProjects();
    }
  }

  authenticateAndLoad() {
    this.loading = true;
    this.caspioService.authenticate().subscribe({
      next: () => {
        this.loadAllProjects();
      },
      error: (error) => {
        const errorMessage = error?.error?.message || error?.message || 'Unknown error';
        this.error = `Authentication failed: ${errorMessage}`;
        this.loading = false;
        console.error('Authentication error:', error);
      }
    });
  }

  loadAllProjects() {
    this.loading = true;
    this.error = '';
    
    // Get the current user's CompanyID from localStorage
    const userStr = localStorage.getItem('currentUser');
    let companyId: number | undefined;
    
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        companyId = user.companyId || user.CompanyID;
      } catch (e) {
        console.error('Error parsing user data:', e);
      }
    }
    
    // Load all projects and filter out StatusID: 1 (Active)
    this.projectsService.getAllProjects(companyId).subscribe({
      next: (allProjects) => {
        // Filter out projects with StatusID: 1 (Active projects)
        this.projects = allProjects.filter(p => 
          p.StatusID !== 1 && p.StatusID !== '1' && p.Status !== 'Active'
        );
        this.rebuildBuckets();
        this.loading = false;
      },
      error: (error) => {
        this.error = 'Failed to load projects';
        this.loading = false;
        console.error('Error loading projects:', error);
      }
    });
  }

  handleSearchTermChange(term: string | null | undefined) {
    this.searchTerm = term ?? "";
    this.rebuildBuckets();
  }

  private rebuildBuckets() {
    const term = this.searchTerm.trim().toLowerCase();
    const filtered = term
      ? this.projects.filter(project => (
          project.Address && project.Address.toLowerCase().includes(term)
        ) || (
          project.City && project.City.toLowerCase().includes(term)
        ))
      : [...this.projects];

    this.filteredProjects = filtered;
    this.completedProjects = this.filterByStatus(filtered, 2);
    this.onHoldProjects = this.filterByStatus(filtered, 4);
    this.cancelledProjects = this.filterByStatus(filtered, 3);
    this.archivedProjects = filtered.filter(project =>
      ![2, 3, 4].includes(Number(project.StatusID))
    );
  }

  private filterByStatus(projects: Project[], statusId: number): Project[] {
    return projects.filter(project => Number(project.StatusID) === statusId);
  }

  trackByProject(_: number, project: Project) {
    return project.PK_ID || project.ProjectID;
  }

  // Format address for display
  formatAddress(project: Project): string {
    const parts = [];
    if (project.Address) parts.push(project.Address);
    if (project.City) parts.push(project.City);
    if (project.State) parts.push(project.State);
    return parts.join(', ') || 'No Address';
  }

  // Get project thumbnail image using Google Street View
  getProjectImage(project: Project): string {
    const address = this.formatAddress(project);
    if (!address || address === 'No Address') {
      return 'assets/img/project-placeholder.svg';
    }
    const encodedAddress = encodeURIComponent(address);
    return `https://maps.googleapis.com/maps/api/streetview?size=120x120&location=${encodedAddress}&key=${this.googleMapsApiKey}`;
  }

  // Handle image loading errors
  handleImageError(event: any) {
    event.target.src = 'assets/img/project-placeholder.svg';
  }

  selectProject(project: Project) {
    
    // Navigate to project detail page with project ID
    const projectId = project.PK_ID || project.ProjectID;
    if (projectId) {
      this.router.navigate(['/project', projectId], {
        state: { project }
      });
    } else {
      console.error('No project ID found:', project);
      this.showErrorAlert('Cannot open project - no ID found');
    }
  }
  
  private async showErrorAlert(message: string) {
    const alert = await this.alertController.create({
      header: 'Error',
      message: message,
      buttons: ['OK']
    });
    await alert.present();
  }

  private getProjectDetailContent(project: Project): string {
    // Helper function to escape HTML
    const escapeHtml = (text: any): string => {
      if (!text) return '';
      const str = String(text);
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    };
    
    const formatDate = (date: string) => {
      if (!date) return 'N/A';
      try {
        return new Date(date).toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric' 
        });
      } catch {
        return 'Invalid Date';
      }
    };

    let content = `
      <div class="project-detail-content">
        <div class="detail-row">
          <strong>Project ID:</strong> ${escapeHtml(this.formatProjectId(project))}
        </div>
        <div class="detail-row">
          <strong>Address:</strong> ${escapeHtml(project.Address) || 'N/A'}
        </div>
        <div class="detail-row">
          <strong>City, State:</strong> ${escapeHtml(project.City) || 'N/A'}, ${escapeHtml(project.State) || 'N/A'} ${escapeHtml(project.Zip) || ''}
        </div>
        <div class="detail-row">
          <strong>Status:</strong> <span class="status-badge ${this.getStatusColor(project)}">${escapeHtml(this.getStatusLabel(project))}</span>
        </div>
    `;

    // Add dates section if any exist
    if (project['DateCreated'] || project['DateOfInspection'] || project['DateCompleted']) {
      content += `<div class="detail-separator"></div>`;
      
      if (project['DateCreated']) {
        content += `<div class="detail-row"><strong>Created:</strong> ${escapeHtml(formatDate(project['DateCreated']))}</div>`;
      }
      if (project['DateOfInspection']) {
        content += `<div class="detail-row"><strong>Inspection:</strong> ${escapeHtml(formatDate(project['DateOfInspection']))}</div>`;
      }
      if (project['DateCompleted']) {
        content += `<div class="detail-row"><strong>Completed:</strong> ${escapeHtml(formatDate(project['DateCompleted']))}</div>`;
      }
    }

    // Add contact info if exists
    if (project['ClientName'] || project['ClientPhone'] || project['ClientEmail']) {
      content += `<div class="detail-separator"></div>`;
      
      if (project['ClientName']) {
        content += `<div class="detail-row"><strong>Client:</strong> ${escapeHtml(project['ClientName'])}</div>`;
      }
      if (project['ClientPhone']) {
        content += `<div class="detail-row"><strong>Phone:</strong> ${escapeHtml(project['ClientPhone'])}</div>`;
      }
      if (project['ClientEmail']) {
        content += `<div class="detail-row"><strong>Email:</strong> ${escapeHtml(project['ClientEmail'])}</div>`;
      }
    }

    // Add notes if exists
    if (project['Notes']) {
      content += `
        <div class="detail-separator"></div>
        <div class="detail-row">
          <strong>Notes:</strong><br>
          <div class="notes-text">${escapeHtml(project['Notes'])}</div>
        </div>
      `;
    }

    content += `</div>`;
    return content;
  }

  formatProjectId(project: Project): string {
    const projectId = project.ProjectID || project.PK_ID || '';
    return projectId ? `#${projectId}` : '';
  }

  getStatusLabel(project: Project): string {
    // Return appropriate status label based on StatusID
    switch(project.StatusID) {
      case 2:
      case '2':
        return 'Completed';
      case 3:
      case '3':
        return 'Cancelled';
      case 4:
      case '4':
        return 'On Hold';
      default:
        return 'Archived';
    }
  }

  getStatusColor(project: Project): string {
    // Return appropriate color based on StatusID
    switch(project.StatusID) {
      case 2:
      case '2':
        return 'success'; // Green for completed
      case 3:
      case '3':
        return 'danger'; // Red for cancelled
      case 4:
      case '4':
        return 'warning'; // Yellow for on hold
      default:
        return 'medium'; // Gray for archived
    }
  }

  async doRefresh(event: any) {
    await this.loadAllProjects();
    event.target.complete();
  }

  async logout() {
    const alert = await this.alertController.create({
      header: 'Confirm Logout',
      message: 'Are you sure you want to logout?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Logout',
          handler: () => {
            localStorage.removeItem('currentUser');
            this.router.navigate(['/login']);
          }
        }
      ]
    });

    await alert.present();
  }
}
