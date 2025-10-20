import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { ProjectsService, Project } from '../../services/projects.service';
import { CaspioService } from '../../services/caspio.service';
import { IonicDeployService } from '../../services/ionic-deploy.service';
import { AlertController } from '@ionic/angular';
import { environment } from '../../../environments/environment';
import { PlatformDetectionService } from '../../services/platform-detection.service';
import { forkJoin } from 'rxjs';

@Component({
  selector: 'app-active-projects',
  templateUrl: './active-projects.page.html',
  styleUrls: ['./active-projects.page.scss'],
  standalone: false
})
export class ActiveProjectsPage implements OnInit {
  projects: Project[] = [];
  filteredProjects: Project[] = [];
  displayedProjects: Project[] = []; // Projects currently shown
  loading = false;
  error = '';
  currentUser: any = null;
  private readonly googleMapsApiKey = environment.googleMapsApiKey;
  searchTerm = '';
  
  // Lazy loading configuration
  private readonly INITIAL_LOAD = 20; // Initial number of projects to show
  private readonly LOAD_MORE = 10; // Number of projects to load on scroll
  private currentIndex = 0;
  
  // Services cache - now stores array of service objects with status
  private servicesCache: { [projectId: string]: Array<{shortCode: string, status: string}> } = {};
  private serviceTypes: any[] = [];

  // Force update timestamp
  getCurrentTimestamp(): string {
    return new Date().toLocaleString();
  }
  

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
    private deployService: IonicDeployService,
    private router: Router,
    private route: ActivatedRoute,
    private alertController: AlertController,
    public platform: PlatformDetectionService,
    private cdr: ChangeDetectorRef
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
    
    // Subscribe to query params to handle refresh
    this.route.queryParams.subscribe(params => {
      if (params['refresh']) {
        this.checkAuthAndLoadProjects();
      }
    });
    this.checkAuthAndLoadProjects();
  }

  ionViewWillEnter() {
    // [v1.4.498] PERFORMANCE FIX: Don't clear image cache on re-entry (saves 2-5s)
    // Cache will automatically update if PrimaryPhoto path changes
    // Only clear cache if user explicitly requests refresh
    this.checkAuthAndLoadProjects();
  }

  checkAuthAndLoadProjects() {
    if (!this.caspioService.isAuthenticated()) {
      this.authenticateAndLoad();
    } else {
      this.loadActiveProjects();
    }
  }

  authenticateAndLoad() {
    this.loading = true;
    this.caspioService.authenticate().subscribe({
      next: () => {
        this.loadActiveProjects();
      },
      error: (error) => {
        const errorMessage = error?.error?.message || error?.message || 'Unknown error';
        this.error = `Authentication failed: ${errorMessage}`;
        this.loading = false;
        console.error('Authentication error:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
      }
    });
  }

  loadActiveProjects() {
    const startTime = performance.now();
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

    // [v1.4.498] PERFORMANCE FIX: Load projects first, then services
    // Load projects and service types in parallel
    // Simple approach: Load projects first, then load services for each
    this.projectsService.getActiveProjects(companyId).subscribe({
      next: (projects) => {
        this.projects = projects || [];
        console.log('📦 Loaded projects:', this.projects.length);
        
        // Load service types and then services
        this.projectsService.getServiceTypes().subscribe({
          next: (serviceTypes) => {
            this.serviceTypes = serviceTypes || [];
            console.log('📦 Loaded service types:', this.serviceTypes.length);
            
            // Simple services loading for each project
            this.loadServicesSimple();
            
            this.applySearchFilter();
            this.loading = false;
            const elapsed = performance.now() - startTime;
            console.log(`🏁 Total loading time: ${elapsed.toFixed(2)}ms`);
          },
          error: (typeError) => {
            console.error('Error loading service types:', typeError);
            this.loading = false;
            this.error = 'Failed to load service types';
          }
        });
      },
      error: (error) => {
        console.error('Error loading projects:', error);
        this.error = 'Failed to load projects';
        this.loading = false;
      }
    });
  }

  // Removed - using simplified loadActiveProjects instead

  /**
   * Simple, direct services loading using existing app patterns
   */
  loadServicesSimple() {
    console.log('🚀 Starting simple services loading...');
    
    if (!this.projects || !this.serviceTypes) {
      console.log('❌ Cannot load services: missing projects or serviceTypes');
      return;
    }
    
    // For each project, query Services table directly (like project-detail does)
    this.projects.forEach(project => {
      const projectId = project.ProjectID; // Use actual ProjectID for Services table
      const displayId = project.PK_ID; // What shows in UI
      
      console.log(`🔍 Loading services for ${project.Address}:`);
      console.log(`  - ProjectID (for Services): ${projectId}`);
      console.log(`  - PK_ID (for display): ${displayId}`);
      
      if (projectId) {
        // Direct API call like project-detail page does
        this.caspioService.get(`/tables/Services/records?q.where=ProjectID='${projectId}'`).subscribe({
          next: (response: any) => {
            const services = response?.Result || [];
            console.log(`📥 Services API response for ProjectID ${projectId}:`, services);
            
            if (services.length > 0) {
              // Create array of service objects with status
              const serviceObjects = services.map((service: any) => {
                const serviceType = this.serviceTypes.find(t => t.TypeID === service.TypeID);
                const shortCode = serviceType?.TypeShort || serviceType?.TypeName || 'Unknown';
                const status = service.Status || 'Not Started';
                console.log(`  TypeID ${service.TypeID} → "${shortCode}: ${status}"`);
                return { shortCode, status };
              }).filter((obj: any) => obj.shortCode && obj.shortCode !== 'Unknown');
              
              this.servicesCache[projectId] = serviceObjects;
              console.log(`✅ CACHED: ProjectID ${projectId} →`, serviceObjects);
            } else {
              this.servicesCache[projectId] = [];
              console.log(`❌ No services found for ProjectID ${projectId}`);
            }
          },
          error: (error) => {
            console.error(`Error loading services for ProjectID ${projectId}:`, error);
            this.servicesCache[projectId] = [];
          }
        });
      } else {
        console.log(`❌ No ProjectID found for ${project.Address}`);
        if (displayId) {
          this.servicesCache[displayId] = [];
        }
      }
    });
  }



  /**
   * Get services array for a project (for vertical display with status)
   */
  getProjectServicesArray(project: Project): Array<{shortCode: string, status: string}> {
    const projectId = project.ProjectID; // Use ProjectID for Services table lookup
    
    if (!projectId) {
      return [];
    }
    
    // Return cached services array or empty array
    return this.servicesCache[projectId] || [];
  }

  /**
   * Get formatted services string for a project (deprecated - kept for compatibility)
   */
  getProjectServices(project: Project): string {
    const projectId = project.ProjectID; // Use ProjectID for Services table lookup
    
    if (!projectId) {
      return '(No Services Selected)';
    }
    
    // Return cached services as comma-separated string or fallback
    const services = this.servicesCache[projectId];
    if (!services || services.length === 0) {
      return '(No Services Selected)';
    }
    
    return services.map(s => s.shortCode).join(', ');
  }

  getProjectImage(project: Project): string {
    // Check if project has a PrimaryPhoto
    if (project && project['PrimaryPhoto']) {
      const primaryPhoto = project['PrimaryPhoto'];
      
      // If it's already a data URL or http URL, use it directly
      if (primaryPhoto.startsWith('data:') || primaryPhoto.startsWith('http')) {
        return primaryPhoto;
      }
      
      // If PrimaryPhoto starts with '/', it's a Caspio file path
      // We need to fetch it using the Files API and store the result
      if (primaryPhoto.startsWith('/')) {
        const projectId = project.PK_ID;
        
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
    if (!address) {
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
  
  private projectImageCache: { [projectId: string]: string } = {};
  private readonly PROJECT_IMAGE_CACHE_PREFIX = 'project_img_';
  private readonly CACHE_EXPIRY_HOURS = 24;
  private savingPrimaryPhoto: Set<string> = new Set(); // Track which projects are currently being saved
  
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
          this.cdr.detectChanges();
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
        this.cdr.detectChanges();
      } else {
        // Use fallback
        const address = this.formatAddress(project);
        if (address) {
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
      if (address) {
        const encodedAddress = encodeURIComponent(address);
        this.projectImageCache[projectId] = `https://maps.googleapis.com/maps/api/streetview?size=120x120&location=${encodedAddress}&key=${this.googleMapsApiKey}`;
      } else {
        this.projectImageCache[projectId] = 'assets/img/project-placeholder.svg';
      }
    }
  }

  formatAddress(project: Project): string {
    const parts = [];
    if (project.Address) parts.push(project.Address);
    if (project.City) parts.push(project.City);
    if (project.State) parts.push(project.State);
    return parts.join(', ');
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

  async archiveProject(project: Project) {
    const alert = await this.alertController.create({
      header: 'Archive Project',
      message: `Are you sure you want to archive the project at ${project.Address}?`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          cssClass: 'alert-button-cancel'
        },
        {
          text: 'Archive',
          cssClass: 'alert-button-confirm',
          handler: async () => {
            await this.performProjectDeletion(project);
          }
        }
      ],
      cssClass: 'custom-document-alert'
    });

    await alert.present();
  }

  async performProjectDeletion(project: Project) {
    const loading = await this.alertController.create({
      message: 'Archiving project...'
    });
    await loading.present();

    try {
      // Archive by setting StatusID to 5
      await this.projectsService.updateProjectStatus(project.PK_ID, 5).toPromise();

      // Remove from displayed list
      this.projects = this.projects.filter(p => p.PK_ID !== project.PK_ID);
      this.applySearchFilter();

      await loading.dismiss();

      const toast = await this.alertController.create({
        message: 'Project archived successfully',
        buttons: ['OK']
      });
      await toast.present();
      setTimeout(() => toast.dismiss(), 2000);
    } catch (error) {
      console.error('Error archiving project:', error);
      await loading.dismiss();

      const errorAlert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to archive project. Please try again.',
        buttons: ['OK']
      });
      await errorAlert.present();
    }
  }

  async onProjectImageError(event: any, project: Project) {
    const imgUrl = event.target?.src || '';
    
    // Don't show error for placeholder images - these are expected
    if (imgUrl.includes('photo-loading.svg') || 
        imgUrl.includes('project-placeholder.svg')) {
      // Just set fallback silently
      event.target.src = 'assets/img/project-placeholder.svg';
      return;
    }
    
    // If it's a data URL that failed, silently use fallback (shouldn't happen but just in case)
    if (imgUrl.startsWith('data:')) {
      event.target.src = 'assets/img/project-placeholder.svg';
      return;
    }
    
    // Only log real errors (not placeholders)
    console.error('Project image failed to load:', imgUrl);
    
    // Set fallback image
    event.target.src = 'assets/img/project-placeholder.svg';
    
    // Don't show alert - just use fallback silently
    return;
    
    /* Commented out alert for production - too intrusive
    const primaryPhoto = project?.['PrimaryPhoto'] || '';
    const token = this.caspioService.getCurrentToken();
    const account = this.caspioService.getAccountID();
    
    // Create debug text for copying
    const debugText = `Project Image Load Failed Debug Info:
Project ID: ${project?.PK_ID}
Address: ${this.formatAddress(project)}
PrimaryPhoto: ${primaryPhoto}
Has Token: ${token ? 'Yes' : 'No'}
Token Length: ${token?.length || 0}
Account: ${account}
URL Attempted: ${imgUrl}`;

    const alert = await this.alertController.create({
      header: 'Project Image Load Failed',
      message: `
        <strong>Project ID:</strong> ${project?.PK_ID}<br>
        <strong>Address:</strong> ${this.formatAddress(project)}<br>
        <strong>PrimaryPhoto:</strong> ${primaryPhoto}<br>
        <strong>Has Token:</strong> ${token ? 'Yes' : 'No'}<br>
        <strong>Token Length:</strong> ${token?.length || 0}<br>
        <strong>Account:</strong> ${account}<br>
        <strong>URL Attempted:</strong> ${imgUrl.substring(0, 100)}...
      `,
      buttons: [
        {
          text: 'Copy Debug Info',
          handler: async () => {
            // Copy to clipboard
            if (navigator.clipboard) {
              navigator.clipboard.writeText(debugText).then(async () => {
                // Show toast through a separate method call to avoid context issues
                const toast = await this.alertController.create({
                  header: 'Copied!',
                  message: 'Debug info copied to clipboard',
                  buttons: ['OK']
                });
                await toast.present();
                setTimeout(() => toast.dismiss(), 2000);
              }).catch(async () => {
                // Fallback for older browsers/WebView
                const textArea = document.createElement('textarea');
                textArea.value = debugText;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                const toast = await this.alertController.create({
                  header: 'Copied!',
                  message: 'Debug info copied to clipboard',
                  buttons: ['OK']
                });
                await toast.present();
                setTimeout(() => toast.dismiss(), 2000);
              });
            } else {
              // Fallback for older browsers/WebView
              const textArea = document.createElement('textarea');
              textArea.value = debugText;
              document.body.appendChild(textArea);
              textArea.select();
              document.execCommand('copy');
              document.body.removeChild(textArea);
              const toast = await this.alertController.create({
                header: 'Copied!',
                message: 'Debug info copied to clipboard',
                buttons: ['OK']
              });
              await toast.present();
              setTimeout(() => toast.dismiss(), 2000);
            }
            return false; // Keep alert open
          }
        },
        {
          text: 'Try Refresh',
          handler: () => {
            this.checkAuthAndLoadProjects();
          }
        },
        {
          text: 'OK',
          role: 'cancel'
        }
      ]
    });

    await alert.present();
    
    // Set fallback image
    event.target.src = 'assets/img/project-placeholder.svg';
    */
  }

  createNewProject() {
    this.router.navigate(['/new-project']);
  }

  async refreshProjects() {
    await this.checkForUpdates();
  }

  async checkForUpdates() {
    
    // Show loading while refreshing
    this.loading = true;
    
    // Clear services cache to force reload
    this.servicesCache = {};
    
    try {
      // Just reload the projects list
      this.loadActiveProjects();
    } catch (error) {
      console.error('Error refreshing projects:', error);
      this.error = 'Failed to refresh projects';
    } finally {
      this.loading = false;
    }
    
    // Check for live updates and handle corruption
    try {
      
      // If on native platform, try to sync
      if ((window as any).Capacitor && (window as any).Capacitor.isNativePlatform()) {
        try {
          const LiveUpdates = await import('@capacitor/live-updates');
          
          // Try to sync updates
          try {
            const result = await LiveUpdates.sync((percentage: number) => {
            });
            
            if (result.activeApplicationPathChanged) {
              // Reload to apply the update
              await LiveUpdates.reload();
              return;
            }
          } catch (syncErr: any) {
            
            // Check for corruption errors
            const isCorrupted = syncErr.message && (
              syncErr.message.includes('corrupt') || 
              syncErr.message.includes('unpack') ||
              syncErr.message.includes('FilerOperationsError') ||
              syncErr.message.includes('File Manager Error') ||
              syncErr.message.includes('IonicLiveUpdate')
            );
            
            if (isCorrupted) {
              
              // Show error to user
              this.error = 'Live Update corrupted. Please close and reopen the app.';
              
              try {
                await LiveUpdates.reload();
              } catch (reloadErr) {
                // Continue with normal refresh even if reload fails
              }
            }
          }
        } catch (err) {
        }
      }
    } catch (updateError) {
      console.error('Live update check failed (non-critical):', updateError);
      // Don't show error to user as refresh still worked
    }
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
            // Clear auth data
            localStorage.removeItem('authToken');
            localStorage.removeItem('currentUser');
            localStorage.removeItem('caspio_token');
            localStorage.removeItem('caspio_token_expiry');
            
            // Navigate to login
            this.router.navigate(['/login']);
          }
        }
      ]
    });

    await alert.present();
  }

  /**
   * Initialize lazy loading for projects list
   */
  initializeLazyLoading(): void {
    this.currentIndex = 0;
    const source = this.filteredProjects;
    this.displayedProjects = source.slice(0, this.INITIAL_LOAD);
    this.currentIndex = this.displayedProjects.length;

    // [v1.4.498] PERFORMANCE FIX: Preload images for visible projects in parallel
    this.preloadVisibleProjectImages();
  }

  /**
   * Preload images for currently visible projects in parallel
   */
  private preloadVisibleProjectImages(): void {
    const projectsWithPhotos = this.displayedProjects.filter(p =>
      p['PrimaryPhoto'] && p['PrimaryPhoto'].startsWith('/')
    );

    if (projectsWithPhotos.length === 0) {
      return;
    }
    const startTime = performance.now();

    // Load all images in parallel
    const loadPromises = projectsWithPhotos.map(project => this.loadProjectImage(project));

    Promise.all(loadPromises).then(() => {
      const elapsed = performance.now() - startTime;
    }).catch(err => {
      console.error('[v1.4.498] Error preloading images:', err);
    });
  }

  /**
   * Load more projects when scrolling
   */
  loadMoreProjects(event?: any): void {
    setTimeout(() => {
      const nextBatch = this.filteredProjects.slice(
        this.currentIndex, 
        this.currentIndex + this.LOAD_MORE
      );
      
      this.displayedProjects = [...this.displayedProjects, ...nextBatch];
      this.currentIndex += nextBatch.length;
      
      if (event && event.target) {
        event.target.complete();
        
        // Disable infinite scroll if all projects are loaded
        if (this.currentIndex >= this.filteredProjects.length) {
          event.target.disabled = true;
        }
      }
    }, 100); // Small delay for smooth scrolling
  }

  /**
   * Check if more projects can be loaded
   */
  hasMoreProjects(): boolean {
    return this.currentIndex < this.filteredProjects.length;
  }

  handleSearchTermChange(term: string | null | undefined): void {
    this.searchTerm = term ?? '';
    this.applySearchFilter();
  }

  private applySearchFilter(): void {
    const normalizedTerm = this.searchTerm.trim().toLowerCase();

    this.filteredProjects = normalizedTerm
      ? this.projects.filter(project => {
          const addressMatch = (project.Address || '').toLowerCase().includes(normalizedTerm);
          const cityMatch = (project.City || '').toLowerCase().includes(normalizedTerm);
          return addressMatch || cityMatch;
        })
      : [...this.projects];

    this.initializeLazyLoading();
  }
}
