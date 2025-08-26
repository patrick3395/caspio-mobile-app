import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { ProjectsService, Project } from '../../services/projects.service';
import { CaspioService } from '../../services/caspio.service';
import { AlertController, ModalController } from '@ionic/angular';

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
    private alertController: AlertController,
    private modalController: ModalController
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

  async selectProject(project: Project) {
    console.log('Selected project:', project);
    
    // Create a modal to show project details
    const modal = await this.modalController.create({
      component: 'ion-modal',
      cssClass: 'project-detail-modal',
      componentProps: {
        project: project
      }
    });

    // Present the modal
    const modalElement = modal as any;
    modalElement.innerHTML = this.getProjectDetailModalContent(project);
    
    await modal.present();
  }

  private getProjectDetailModalContent(project: Project): string {
    const streetViewUrl = this.getProjectImage(project);
    const formatDate = (date: string) => {
      if (!date) return 'N/A';
      return new Date(date).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    };

    return `
      <ion-header>
        <ion-toolbar color="primary">
          <ion-title>${this.formatAddress(project)}</ion-title>
          <ion-buttons slot="end">
            <ion-button onclick="this.closest('ion-modal').dismiss()">
              <ion-icon name="close" slot="icon-only"></ion-icon>
            </ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>
      <ion-content class="project-detail-content">
        <div class="street-view-section">
          <img src="${streetViewUrl}" alt="Street View" class="street-view-image" onerror="this.src='assets/img/project-placeholder.svg'">
        </div>
        
        <div class="detail-sections">
          <!-- Project Information -->
          <div class="detail-section">
            <h3 class="section-header">
              <ion-icon name="information-circle"></ion-icon>
              Project Information
            </h3>
            <ion-list lines="none">
              <ion-item>
                <ion-label>
                  <p>Project ID</p>
                  <h3>${this.formatProjectId(project)}</h3>
                </ion-label>
              </ion-item>
              <ion-item>
                <ion-label>
                  <p>Address</p>
                  <h3>${project.Address || 'N/A'}</h3>
                </ion-label>
              </ion-item>
              <ion-item>
                <ion-label>
                  <p>City, State</p>
                  <h3>${project.City || 'N/A'}, ${project.State || 'N/A'} ${project.Zip || ''}</h3>
                </ion-label>
              </ion-item>
              <ion-item>
                <ion-label>
                  <p>Status</p>
                  <h3>
                    <ion-badge color="${this.getStatusColor(project)}">
                      ${this.getStatusLabel(project)}
                    </ion-badge>
                  </h3>
                </ion-label>
              </ion-item>
            </ion-list>
          </div>

          <!-- Dates -->
          <div class="detail-section">
            <h3 class="section-header">
              <ion-icon name="calendar"></ion-icon>
              Important Dates
            </h3>
            <ion-list lines="none">
              ${project['DateCreated'] ? `
                <ion-item>
                  <ion-label>
                    <p>Created</p>
                    <h3>${formatDate(project['DateCreated'])}</h3>
                  </ion-label>
                </ion-item>
              ` : ''}
              ${project['DateOfInspection'] ? `
                <ion-item>
                  <ion-label>
                    <p>Inspection Date</p>
                    <h3>${formatDate(project['DateOfInspection'])}</h3>
                  </ion-label>
                </ion-item>
              ` : ''}
              ${project['DateCompleted'] ? `
                <ion-item>
                  <ion-label>
                    <p>Completed</p>
                    <h3>${formatDate(project['DateCompleted'])}</h3>
                  </ion-label>
                </ion-item>
              ` : ''}
            </ion-list>
          </div>

          <!-- Contact Information -->
          ${(project['ClientName'] || project['ClientPhone'] || project['ClientEmail']) ? `
            <div class="detail-section">
              <h3 class="section-header">
                <ion-icon name="person"></ion-icon>
                Contact Information
              </h3>
              <ion-list lines="none">
                ${project['ClientName'] ? `
                  <ion-item>
                    <ion-label>
                      <p>Client Name</p>
                      <h3>${project['ClientName']}</h3>
                    </ion-label>
                  </ion-item>
                ` : ''}
                ${project['ClientPhone'] ? `
                  <ion-item>
                    <ion-label>
                      <p>Phone</p>
                      <h3>${project['ClientPhone']}</h3>
                    </ion-label>
                  </ion-item>
                ` : ''}
                ${project['ClientEmail'] ? `
                  <ion-item>
                    <ion-label>
                      <p>Email</p>
                      <h3>${project['ClientEmail']}</h3>
                    </ion-label>
                  </ion-item>
                ` : ''}
              </ion-list>
            </div>
          ` : ''}

          <!-- Additional Details -->
          ${project['Notes'] ? `
            <div class="detail-section">
              <h3 class="section-header">
                <ion-icon name="document-text"></ion-icon>
                Notes
              </h3>
              <div class="notes-content">
                ${project['Notes']}
              </div>
            </div>
          ` : ''}
        </div>
      </ion-content>
    `;
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