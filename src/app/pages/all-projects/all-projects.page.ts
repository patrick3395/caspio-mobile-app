import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { ProjectsService, Project } from '../../services/projects.service';
import { CaspioService } from '../../services/caspio.service';
import { AlertController } from '@ionic/angular';

@Component({
  selector: 'app-all-projects',
  templateUrl: './all-projects.page.html',
  styleUrls: ['./all-projects.page.scss'],
  standalone: false
})
export class AllProjectsPage implements OnInit {
  projects: Project[] = [];
  loading = false;
  error = '';
  currentUser: any = null;
  searchTerm = '';

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
    private alertController: AlertController
  ) {}

  ngOnInit() {
    // Load current user info
    const userStr = localStorage.getItem('currentUser');
    if (userStr) {
      try {
        this.currentUser = JSON.parse(userStr);
        console.log('Current user:', this.currentUser);
      } catch (e) {
        console.error('Error parsing user data:', e);
      }
    }
    
    this.checkAuthAndLoadProjects();
  }

  ionViewWillEnter() {
    // Always reload when entering the page
    console.log('ionViewWillEnter - reloading all projects');
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
        console.log('Authentication successful in AllProjects');
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
        console.log('Loading all projects for CompanyID:', companyId);
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
        this.loading = false;
        console.log(`Non-active projects loaded for CompanyID ${companyId}:`, this.projects);
      },
      error: (error) => {
        this.error = 'Failed to load projects';
        this.loading = false;
        console.error('Error loading projects:', error);
      }
    });
  }

  getFilteredProjects(): Project[] {
    if (!this.searchTerm) {
      return this.projects;
    }
    
    const term = this.searchTerm.toLowerCase();
    return this.projects.filter(project => 
      (project.Address && project.Address.toLowerCase().includes(term)) ||
      (project['Title'] && project['Title'].toLowerCase().includes(term)) ||
      (project.ProjectID && project.ProjectID.toString().includes(term))
    );
  }

  // Get projects by specific status
  getProjectsByStatus(statusId: number): Project[] {
    const filtered = this.getFilteredProjects();
    return filtered.filter(p => 
      p.StatusID === statusId || p.StatusID === statusId.toString()
    );
  }

  // Get projects with other/unknown status
  getOtherProjects(): Project[] {
    const filtered = this.getFilteredProjects();
    return filtered.filter(p => 
      p.StatusID !== 2 && p.StatusID !== '2' &&
      p.StatusID !== 3 && p.StatusID !== '3' &&
      p.StatusID !== 4 && p.StatusID !== '4'
    );
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
    const apiKey = 'AIzaSyCOlOYkj3N8PT_RnoBkVJfy2BSfepqqV3A';
    return `https://maps.googleapis.com/maps/api/streetview?size=120x120&location=${encodedAddress}&key=${apiKey}`;
  }

  // Handle image loading errors
  handleImageError(event: any) {
    event.target.src = 'assets/img/project-placeholder.svg';
  }

  selectProject(project: Project) {
    console.log('Selected project:', project);
    // Navigate to project detail page with project ID
    this.router.navigate(['/project', project.PK_ID || project.ProjectID], {
      state: { project }
    });
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
    console.log('Begin async refresh');
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