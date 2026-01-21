import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { ProjectsService, Project } from '../../services/projects.service';
import { CaspioService } from '../../services/caspio.service';
import { AlertController } from '@ionic/angular';
import { environment } from '../../../environments/environment';
import { PlatformDetectionService } from '../../services/platform-detection.service';
import { PageTitleService } from '../../services/page-title.service';

/**
 * G2-PERF-003: OnPush change detection for performance optimization (web only)
 * This page uses OnPush strategy to reduce unnecessary re-renders.
 * Manual change detection (markForCheck) is used when async operations complete.
 */
@Component({
  selector: 'app-all-projects',
  templateUrl: './all-projects.page.html',
  styleUrls: ['./all-projects.page.scss'],
  standalone: false,
  changeDetection: environment.isWeb ? ChangeDetectionStrategy.OnPush : ChangeDetectionStrategy.Default
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

  // WEBAPP: Track which project is being navigated to (for loading feedback)
  selectingProjectId: string | number | null = null;
  
  // Services cache
  private servicesCache: { [projectId: string]: string } = {};
  private serviceTypes: any[] = [];

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
    public platform: PlatformDetectionService,
    private changeDetectorRef: ChangeDetectorRef,
    private pageTitleService: PageTitleService
  ) {}

  ngOnInit() {
    // G2-SEO-001: Set page title for all projects
    this.pageTitleService.setListTitle('All Projects');

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
    // WEBAPP: Reset selection state when returning to this page
    if (environment.isWeb) {
      this.selectingProjectId = null;
    }
    this.checkAuthAndLoadProjects();
  }

  checkAuthAndLoadProjects() {
    // When using API Gateway, AWS handles authentication - no need to auth here
    if (environment.useApiGateway) {
      this.loadAllProjects();
      return;
    }

    // Legacy direct Caspio mode - requires frontend authentication
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
        
        // Load service types and then services
        this.projectsService.getServiceTypes().subscribe({
          next: (serviceTypes) => {
            this.serviceTypes = serviceTypes || [];
            
            // Load services for each project
            this.loadServicesSimple();
            
            this.rebuildBuckets();
            this.loading = false;
          },
          error: (typeError) => {
            console.error('Error loading service types:', typeError);
            this.rebuildBuckets();
            this.loading = false;
          }
        });
      },
      error: (error) => {
        this.error = 'Failed to load projects';
        this.loading = false;
        console.error('Error loading projects:', error);
      }
    });
  }
  
  /**
   * Load services for all projects using batch API calls
   * OPTIMIZED: Uses single API call per batch instead of N separate calls
   * This prevents 503 errors from API rate limiting
   */
  loadServicesSimple() {
    if (!this.projects || !this.serviceTypes) {
      return;
    }

    if (this.projects.length === 0) {
      return;
    }

    // Collect all unique ProjectIDs (filter out undefined/null/empty)
    const projectIds: string[] = this.projects
      .map(p => p.ProjectID)
      .filter((id): id is string => id != null && id !== '');

    if (projectIds.length === 0) {
      return;
    }

    // WEBAPP: Batch in chunks of 20 to avoid URL length limits and API rate limiting
    const BATCH_SIZE = 20;
    const batches: string[][] = [];

    for (let i = 0; i < projectIds.length; i += BATCH_SIZE) {
      batches.push(projectIds.slice(i, i + BATCH_SIZE));
    }

    // Process batches sequentially to avoid overwhelming the API
    this.processBatchSequentially(batches, 0);
  }

  /**
   * Process service batches sequentially to prevent API overload
   */
  private processBatchSequentially(batches: string[][], index: number) {
    if (index >= batches.length) {
      // All batches processed, trigger change detection
      this.changeDetectorRef.markForCheck();
      return;
    }

    const batch = batches[index];
    const whereClause = batch.map(id => `ProjectID='${id}'`).join(' OR ');

    this.caspioService.get(`/tables/LPS_Services/records?q.where=${encodeURIComponent(whereClause)}`).subscribe({
      next: (response: any) => {
        const allServices = response?.Result || [];

        // Group services by ProjectID client-side
        const servicesByProject: { [projectId: string]: any[] } = {};
        allServices.forEach((service: any) => {
          const projectId = service.ProjectID;
          if (!servicesByProject[projectId]) {
            servicesByProject[projectId] = [];
          }
          servicesByProject[projectId].push(service);
        });

        // Map services to display format for each project in this batch
        batch.forEach(projectId => {
          const projectServices = servicesByProject[projectId] || [];

          if (projectServices.length > 0) {
            const serviceNames = projectServices.map((service: any) => {
              const serviceType = this.serviceTypes.find((t: any) => t.TypeID === service.TypeID);
              return serviceType?.TypeShort || serviceType?.TypeName || 'Unknown';
            }).filter((name: string) => name && name !== 'Unknown').join(', ');

            this.servicesCache[projectId] = serviceNames || '(No Services Selected)';
          } else {
            this.servicesCache[projectId] = '(No Services Selected)';
          }
        });

        // Trigger UI update after each batch
        this.changeDetectorRef.markForCheck();

        // Process next batch after a small delay to prevent API overload
        setTimeout(() => {
          this.processBatchSequentially(batches, index + 1);
        }, 100);
      },
      error: (error) => {
        console.error(`Error batch loading services:`, error);
        // Set fallback for all projects in this batch
        batch.forEach(projectId => {
          this.servicesCache[projectId] = '(No Services Selected)';
        });

        // Continue with next batch even on error
        setTimeout(() => {
          this.processBatchSequentially(batches, index + 1);
        }, 500);
      }
    });
  }
  
  /**
   * Get formatted services string for a project
   */
  getProjectServices(project: Project): string {
    const projectId = project.ProjectID;
    
    if (!projectId) {
      return '(No Services Selected)';
    }
    
    // Return cached services or fallback
    return this.servicesCache[projectId] || '(No Services Selected)';
  }
  
  formatCityStateZip(project: Project): string {
    const parts = [];
    if (project.City) parts.push(project.City);
    if (project.State) parts.push(project.State);
    if (project.Zip) parts.push(project.Zip);
    return parts.join(', ');
  }
  
  formatCreatedDate(dateString: string): string {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return dateString;
    }
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

  private projectImageCache: { [projectId: string]: string} = {};
  private readonly PROJECT_IMAGE_CACHE_PREFIX = 'project_img_';
  private readonly CACHE_EXPIRY_HOURS = 24;
  private savingPrimaryPhoto: Set<string> = new Set(); // Track which projects are currently being saved

  // WEBAPP: Track image loading state for shimmer effect
  private imageLoadedSet: Set<string> = new Set();
  
  /**
   * Save the Google Street View image URL to the database as PrimaryPhoto
   */
  private saveGoogleImageToDatabase(project: Project, googleImageUrl: string): void {
    const projectId = project.PK_ID;
    
    if (!projectId) {
      return;
    }
    
    // Prevent duplicate saves for the same project
    if (this.savingPrimaryPhoto.has(projectId)) {
      return;
    }
    
    this.savingPrimaryPhoto.add(projectId);
    
    console.log(`📸 Saving Google image URL to database for project ${projectId}`);
    
    this.projectsService.updateProjectPrimaryPhoto(projectId, googleImageUrl).subscribe({
      next: () => {
        // Update the local project object so we don't try to save again
        project['PrimaryPhoto'] = googleImageUrl;
        this.savingPrimaryPhoto.delete(projectId);
        console.log(`✅ Successfully saved Google image URL for project ${projectId}`);
      },
      error: (error) => {
        console.error(`❌ Error saving Google image URL for project ${projectId}:`, error);
        this.savingPrimaryPhoto.delete(projectId);
      }
    });
  }
  
  // Get project thumbnail image
  getProjectImage(project: Project): string {
    // Check if project has a PrimaryPhoto
    if (project && project['PrimaryPhoto']) {
      const primaryPhoto = project['PrimaryPhoto'];
      
      // If it's already a data URL or http URL, use it directly
      if (primaryPhoto.startsWith('data:') || primaryPhoto.startsWith('http')) {
        return primaryPhoto;
      }
      
      // Check if we have it in memory cache
      const projectId = project.PK_ID;
      if (projectId && this.projectImageCache[projectId]) {
        return this.projectImageCache[projectId];
      }

      // We need to fetch it using the Files API and store the result
      if (primaryPhoto.startsWith('/')) {
        // Check if projectId exists and we have the base64 image cached
        if (projectId && this.projectImageCache && this.projectImageCache[projectId]) {
          return this.projectImageCache[projectId];
        }
        
        // Start loading the image asynchronously if we have a valid project
        if (projectId) {
          this.loadProjectImage(project);
        }
        
        // Return placeholder while loading
        return 'assets/img/photo-loading.svg';
      }
    }
    
    // Fall back to Google Street View if no PrimaryPhoto
    const address = this.formatAddress(project);
    if (!address || address === 'No Address') {
      return 'assets/img/project-placeholder.svg';
    }
    const encodedAddress = encodeURIComponent(address);
    const googleImageUrl = `https://maps.googleapis.com/maps/api/streetview?size=120x120&location=${encodedAddress}&key=${this.googleMapsApiKey}`;
    
    // Save the Google image URL to the database if PrimaryPhoto is empty
    if (project && project.PK_ID && !project['PrimaryPhoto']) {
      this.saveGoogleImageToDatabase(project, googleImageUrl);
    }
    
    return googleImageUrl;
  }
  
  async loadProjectImage(project: Project) {
    const projectId = project.PK_ID;
    const primaryPhoto = project['PrimaryPhoto'];
    
    if (!projectId || !primaryPhoto || !primaryPhoto.startsWith('/')) {
      return;
    }
    
    // Create a cache key that includes the photo path to detect changes
    const cacheKey = `${projectId}_${primaryPhoto}`;
    const storageCacheKey = `${this.PROJECT_IMAGE_CACHE_PREFIX}${cacheKey}`;
    
    // Check memory cache first
    if (this.projectImageCache[cacheKey]) {
      // Update the projectId cache to point to this image
      this.projectImageCache[projectId] = this.projectImageCache[cacheKey];
      return;
    }
    
    // Check localStorage cache
    try {
      const cachedData = localStorage.getItem(storageCacheKey);
      if (cachedData) {
        const cacheEntry = JSON.parse(cachedData);
        const cacheAge = Date.now() - cacheEntry.timestamp;
        const maxAge = this.CACHE_EXPIRY_HOURS * 60 * 60 * 1000;
        
        if (cacheAge < maxAge && cacheEntry.imageData) {
          // Use cached image
          this.projectImageCache[projectId] = cacheEntry.imageData;
          this.projectImageCache[cacheKey] = cacheEntry.imageData;
          this.changeDetectorRef.markForCheck();
          return;
        } else {
          // Cache expired, remove it
          localStorage.removeItem(storageCacheKey);
        }
      }
    } catch (e) {
      console.error('Error reading image cache:', e);
    }
    
    try {
      const imageData = await this.caspioService.getImageFromFilesAPI(primaryPhoto).toPromise();
      
      if (imageData && imageData.startsWith('data:')) {
        // Store in memory cache with both keys
        this.projectImageCache[projectId] = imageData;
        this.projectImageCache[cacheKey] = imageData;
        
        // Store in localStorage for persistence
        try {
          const cacheEntry = {
            imageData: imageData,
            timestamp: Date.now()
          };
          localStorage.setItem(storageCacheKey, JSON.stringify(cacheEntry));
        } catch (storageError) {
          console.warn('Failed to cache image in localStorage (may be full):', storageError);
          // Continue without localStorage cache
        }
        
        // Trigger change detection to update the view
        this.changeDetectorRef.markForCheck();
      } else {
        // Use fallback
        const address = this.formatAddress(project);
        if (address && address !== 'No Address') {
          const encodedAddress = encodeURIComponent(address);
          this.projectImageCache[projectId] = `https://maps.googleapis.com/maps/api/streetview?size=120x120&location=${encodedAddress}&key=${this.googleMapsApiKey}`;
        } else {
          this.projectImageCache[projectId] = 'assets/img/project-placeholder.svg';
        }
      }
    } catch (error) {
      console.error('Error loading project image:', error);
      // Use fallback on error
      const address = this.formatAddress(project);
      if (address && address !== 'No Address') {
        const encodedAddress = encodeURIComponent(address);
        this.projectImageCache[projectId] = `https://maps.googleapis.com/maps/api/streetview?size=120x120&location=${encodedAddress}&key=${this.googleMapsApiKey}`;
      } else {
        this.projectImageCache[projectId] = 'assets/img/project-placeholder.svg';
      }
    }
  }

  /**
   * WEBAPP: Check if an image is still loading (for shimmer effect)
   */
  isImageLoading(project: Project): boolean {
    if (!environment.isWeb) return false;
    const projectId = project.PK_ID || project.ProjectID;
    return projectId ? !this.imageLoadedSet.has(projectId) : false;
  }

  /**
   * WEBAPP: Called when project image finishes loading
   */
  onProjectImageLoad(project: Project): void {
    if (!environment.isWeb) return;
    const projectId = project.PK_ID || project.ProjectID;
    if (projectId) {
      this.imageLoadedSet.add(projectId);
    }
  }

  // Handle image loading errors
  handleImageError(event: any, project?: Project) {
    // WEBAPP: Mark as loaded even on error (to stop shimmer)
    if (environment.isWeb && project) {
      const projectId = project.PK_ID || project.ProjectID;
      if (projectId) {
        this.imageLoadedSet.add(projectId);
      }
    }
    event.target.src = 'assets/img/project-placeholder.svg';
  }

  selectProject(project: Project) {
    // Navigate to project detail page with project ID
    const projectId = project.PK_ID || project.ProjectID;
    if (projectId) {
      // WEBAPP: Show immediate loading feedback per web design guidelines
      if (environment.isWeb) {
        this.selectingProjectId = projectId;
        this.changeDetectorRef.markForCheck();
      }

      this.router.navigate(['/project', projectId], {
        state: { project }
      });
    } else {
      console.error('No project ID found:', project);
      this.showErrorAlert('Cannot open project - no ID found');
    }
  }

  // WEBAPP: Check if a project is currently being selected/navigated to
  isSelectingProject(project: Project): boolean {
    if (!environment.isWeb) return false;
    const projectId = project.PK_ID || project.ProjectID;
    return this.selectingProjectId === projectId;
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
            // G2-SEC-002: Clear all auth data on logout (web only)
            if (environment.isWeb) {
              localStorage.removeItem('authToken');
              localStorage.removeItem('currentUser');
              localStorage.removeItem('caspio_token');
              localStorage.removeItem('caspio_token_expiry');
              // Clear any Cognito tokens
              localStorage.removeItem('cognito_access_token');
              localStorage.removeItem('cognito_id_token');
            }

            // Navigate to login
            this.router.navigate(['/login']);
          }
        }
      ]
    });

    await alert.present();
  }
}
