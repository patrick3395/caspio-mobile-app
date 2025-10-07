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
  appVersion = '1.4.576'; // Update this to match package.json version
  private readonly googleMapsApiKey = environment.googleMapsApiKey;
  searchTerm = '';
  
  // Lazy loading configuration
  private readonly INITIAL_LOAD = 20; // Initial number of projects to show
  private readonly LOAD_MORE = 10; // Number of projects to load on scroll
  private currentIndex = 0;
  
  // Services cache
  private servicesCache: { [projectId: string]: string } = {};
  private serviceTypes: any[] = [];

  // Force update timestamp
  getCurrentTimestamp(): string {
    return new Date().toLocaleString();
  }
  
  // Get app version
  getAppVersion(): string {
    return this.appVersion;
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
      // Call async method properly
      this.loadActiveProjects().catch(error => {
        console.error('Error loading active projects:', error);
        this.error = 'Failed to load projects';
        this.loading = false;
      });
    }
  }

  authenticateAndLoad() {
    this.loading = true;
    this.caspioService.authenticate().subscribe({
      next: () => {
        this.loadActiveProjects().catch(error => {
          console.error('Error loading projects after authentication:', error);
          this.error = 'Failed to load projects after authentication';
          this.loading = false;
        });
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

  async loadActiveProjects() {
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
    forkJoin({
      projects: this.projectsService.getActiveProjects(companyId),
      serviceTypes: this.projectsService.getServiceTypes()
    }).subscribe({
      next: async (results) => {
        this.projects = results.projects || [];
        this.serviceTypes = results.serviceTypes || [];
        
        console.log('📊 Loaded Type table data:');
        this.serviceTypes.forEach(type => {
          console.log(`  TypeID ${type.TypeID || type.PK_ID}: ${type.TypeName || type.TypeShort}`);
        });
        
        // Load services for each project from Services table - AWAIT to make it synchronous
        console.log('🚀 About to load services from Services table...');
        console.log('📊 Number of projects to process:', this.projects.length);
        console.log('📊 Number of service types available:', this.serviceTypes.length);
        
        try {
          await this.loadProjectServicesFromServicesTable();
          console.log('✅ Services loading completed - cache size:', Object.keys(this.servicesCache).length);
          console.log('📝 Services cache contents:', this.servicesCache);
        } catch (servicesError) {
          console.error('💥 Services loading failed:', servicesError);
        }
        
        console.log('🎯 Applying filter and displaying projects...');
        
        this.applySearchFilter();
        this.loading = false;
        const elapsed = performance.now() - startTime;
        console.log(`🏁 Total loading time: ${elapsed.toFixed(2)}ms`);
      },
      error: (error) => {
        // If parallel load fails, try getting projects only and services later
        this.projectsService.getActiveProjects(companyId).subscribe({
          next: async (projects) => {
            this.projects = projects;
            // Load service types if not already loaded
            if (!this.serviceTypes || this.serviceTypes.length === 0) {
              this.serviceTypes = await this.projectsService.getServiceTypes().toPromise() || [];
            }
            await this.loadProjectServicesFromServicesTable(); // Make synchronous
            this.applySearchFilter();
            this.loading = false;
            const elapsed = performance.now() - startTime;
          },
          error: (err) => {
            // If filtered query fails, try getting all projects and filter locally
            this.projectsService.getAllProjects(companyId).subscribe({
              next: async (allProjects) => {
                this.projects = allProjects.filter(p =>
                  p.StatusID === 1 || p.StatusID === '1' || p.Status === 'Active'
                );
                // Load services even in nested fallback scenario
                if (!this.serviceTypes || this.serviceTypes.length === 0) {
                  this.serviceTypes = await this.projectsService.getServiceTypes().toPromise() || [];
                }
                await this.loadProjectServicesFromServicesTable();
                this.loading = false;
                const elapsed = performance.now() - startTime;
                this.applySearchFilter();
              },
              error: (finalErr) => {
                this.error = 'Failed to load projects';
                this.loading = false;
                console.error('Error loading projects:', finalErr);
              }
            });
          }
        });
      }
    });
  }

  async loadProjectsDirectly() {
    this.loading = true;
    this.error = '';
    
    // Get the current user's CompanyID
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
    
    forkJoin({
      projects: this.projectsService.getActiveProjects(companyId),
      serviceTypes: this.projectsService.getServiceTypes()
    }).subscribe({
      next: async (results) => {
        this.projects = results.projects || [];
        this.serviceTypes = results.serviceTypes || [];
        await this.loadProjectServicesFromServicesTable();
        this.applySearchFilter();
        this.loading = false;
        this.error = '';
      },
      error: (error) => {
        // If filtered query fails, try getting all projects and filter locally
        this.projectsService.getAllProjects(companyId).subscribe({
          next: async (allProjects) => {
            this.projects = allProjects.filter(p => 
              p.StatusID === 1 || p.StatusID === '1' || p.Status === 'Active'
            );
            // Load services even in nested fallback - make synchronous  
            if (!this.serviceTypes || this.serviceTypes.length === 0) {
              this.serviceTypes = await this.projectsService.getServiceTypes().toPromise() || [];
            }
            await this.loadProjectServicesFromServicesTable();
            this.loading = false;
            this.error = '';
            this.applySearchFilter();
          },
          error: (err) => {
            const errorMessage = err?.error?.message || err?.message || 'Unknown error';
            this.error = `Failed to load projects: ${errorMessage}`;
            this.loading = false;
            console.error('Error loading all projects:', err);
            console.error('Full error details:', JSON.stringify(err, null, 2));
          }
        });
      }
    });
  }

  /**
   * Load services data asynchronously (fallback when parallel loading fails)
   */
  async loadServicesDataAsync() {
    try {
      console.log('Loading service types...');
      const serviceTypes = await this.projectsService.getServiceTypes().toPromise();
      this.serviceTypes = serviceTypes || [];
      console.log('Loaded service types:', this.serviceTypes.length, 'types');
      await this.loadProjectServicesFromServicesTable();
    } catch (error) {
      console.error('Error loading services data:', error);
    }
  }

  /**
   * Load services for all projects from the Services table
   */
  async loadProjectServicesFromServicesTable() {
    console.log('Starting loadProjectServicesFromServicesTable...');
    console.log('Projects:', this.projects?.length);
    console.log('Service Types:', this.serviceTypes?.length);
    
    if (!this.projects || !this.serviceTypes || this.projects.length === 0) {
      console.log('Early return: missing projects or serviceTypes');
      return;
    }
    
    // Log project data to understand the structure
    console.log('First project sample:', this.projects[0]);
    
    // Create batch queries for all projects with proper type safety
    // CRITICAL: Use ProjectID field (NOT PK_ID) as that's what Services table references
    const projectIds: string[] = this.projects
      .map(p => {
        // Services table uses ProjectID as foreign key, NOT PK_ID
        const servicesProjectId = p.ProjectID; // This is what Services table references
        const displayId = p.PK_ID; // This is what shows in UI as #2062
        
        console.log(`🔍 Project ${p.Address}:`);
        console.log(`  - PK_ID (Display): ${displayId} (shows as #${displayId} in UI)`);
        console.log(`  - ProjectID (Services FK): ${servicesProjectId} (what Services table uses)`);
        console.log(`  - Using for Services query: ${servicesProjectId}`);
        
        return servicesProjectId; // Use ProjectID for Services table queries
      })
      .filter((id): id is string => typeof id === 'string' && id.trim() !== '');
    
    console.log('Project IDs to query for services:', projectIds);
    
    if (projectIds.length === 0) {
      console.log('No valid project IDs found');
      return;
    }
    
    try {
      // Query services for all projects in parallel
      const serviceRequests = projectIds.map(async (projectId: string) => {
        console.log(`Querying services for ProjectID: ${projectId}`);
        
        try {
          const query = `/tables/Services/records?q.where=ProjectID='${projectId}'`;
          console.log(`🔍 Services query for ${projectId}: ${query}`);
          
          const result = await this.caspioService.get<any>(query).toPromise();
          console.log(`📥 Raw Services API response for ${projectId}:`, JSON.stringify(result, null, 2));
          
          const services = result?.Result || [];
          console.log(`📊 Parsed services count for ${projectId}: ${services.length}`);
          
          if (services.length > 0) {
            console.log(`🎯 Services found for ProjectID ${projectId}:`);
            services.forEach((service: any, idx: number) => {
              console.log(`  Service ${idx + 1}: TypeID=${service.TypeID}, ServiceID=${service.ServiceID || service.PK_ID}`);
            });
          } else {
            console.log(`❌ NO SERVICES FOUND for ProjectID ${projectId} in Services table`);
          }
          
          return { projectId, services }; // Return object with projectId and services
        } catch (error) {
          console.error(`💥 ERROR querying services for project ${projectId}:`, error);
          console.error('Full error details:', JSON.stringify(error, null, 2));
          return { projectId, services: [] };
        }
      });
      
      const servicesResults = await Promise.allSettled(serviceRequests);
      
      // Process results and build services cache
      console.log('🔄 Processing Services query results...');
      servicesResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          const { projectId, services } = result.value;
          console.log(`🔄 Processing result for ProjectID ${projectId}, services count: ${services.length}`);
          
          const serviceNames = this.formatProjectServices(services);
          this.servicesCache[projectId] = serviceNames;
          
          console.log(`✅ CACHED services for ProjectID ${projectId}: "${serviceNames}"`);
          console.log(`🗂️ Cache key used: "${projectId}"`);
        } else {
          // Use the project ID from our array for failed requests
          const projectId = projectIds[index];
          this.servicesCache[projectId] = '(No Services Selected)';
          console.log(`❌ FAILED result for ProjectID ${projectId} - cached: "(No Services Selected)"`);
          if (result.status === 'rejected') {
            console.error(`💥 Services query REJECTED for project ${projectId}:`, result.reason);
          }
        }
      });
      
      // Trigger change detection to update UI
      this.cdr.detectChanges();
      console.log('🎯 Services loading completed successfully! Cache contents:', Object.keys(this.servicesCache).length, 'projects');
      
    } catch (error) {
      console.error('Error loading project services:', error);
      // Set fallback for all projects
      projectIds.forEach((projectId: string) => {
        this.servicesCache[projectId] = '(No Services Selected)';
      });
      // Trigger change detection for fallback values
      this.cdr.detectChanges();
      console.log('❌ Services loading failed - using fallback values');
    }
  }

  /**
   * Format multiple services for a project into display string
   */
  formatProjectServices(services: any[]): string {
    console.log('Formatting services:', services);
    
    if (!services || services.length === 0) {
      return '(No Services Selected)';
    }
    
    const serviceNames = services.map(service => {
      console.log('Processing service:', service);
      console.log('Looking for TypeID:', service.TypeID);
      
      const serviceType = this.serviceTypes.find(t => {
        const typeIdMatch = t.TypeID === service.TypeID;
        const pkIdMatch = t.PK_ID === service.TypeID;
        const match = typeIdMatch || pkIdMatch;
        
        if (service.TypeID === 1 || service.TypeID === 2) { // Log details for EFE/HUD
          console.log(`🔍 Matching TypeID ${service.TypeID}:`);
          console.log(`  Type record: TypeID=${t.TypeID}, PK_ID=${t.PK_ID}, TypeName="${t.TypeName}"`);
          console.log(`  Match result: ${match} (TypeID: ${typeIdMatch}, PK_ID: ${pkIdMatch})`);
        }
        
        return match;
      });
      
      console.log('Found service type:', serviceType);
      const name = serviceType?.TypeName || serviceType?.TypeShort || 'Unknown Service';
      console.log('Service name:', name);
      return name;
    }).filter(name => name && name !== 'Unknown Service');
    
    console.log('Final service names:', serviceNames);
    
    if (serviceNames.length === 0) {
      return '(No Services Selected)';
    }
    
    // Join multiple services with commas, or use short codes if available
    return serviceNames.join(', ');
  }

  /**
   * Get formatted services string for a project
   */
  getProjectServices(project: Project): string {
    // CRITICAL: Use ProjectID (Services table foreign key), NOT PK_ID (display ID)
    const servicesProjectId = project.ProjectID; // What Services table references (e.g., 2059)
    const displayId = project.PK_ID; // What shows in UI (e.g., #2062)
    
    if (!servicesProjectId) {
      console.log(`❌ No ProjectID found for ${project.Address} (PK_ID: ${displayId})`);
      return '(No Services Selected)';
    }
    
    // Check cache using the correct ProjectID
    console.log(`🔍 CACHE LOOKUP for ${project.Address}:`);
    console.log(`  - PK_ID (Display): #${displayId}`);
    console.log(`  - ProjectID (Services FK): ${servicesProjectId}`);
    console.log(`  - Looking for cache key: "${servicesProjectId}"`);
    console.log(`  - Available cache keys:`, Object.keys(this.servicesCache));
    console.log(`  - Cache has key "${servicesProjectId}":`, this.servicesCache.hasOwnProperty(servicesProjectId));
    
    if (this.servicesCache.hasOwnProperty(servicesProjectId)) {
      const cached = this.servicesCache[servicesProjectId];
      console.log(`✅ FOUND cached services: "${cached}"`);
      return cached;
    }
    
    // If services haven't been loaded yet, return fallback
    console.log(`❌ Services not yet loaded for ProjectID ${servicesProjectId} (${project.Address})`);
    console.log(`📝 Full cache contents:`, this.servicesCache);
    return '(No Services Selected)';
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
    return `https://maps.googleapis.com/maps/api/streetview?size=120x120&location=${encodedAddress}&key=${this.googleMapsApiKey}`;
  }
  
  private projectImageCache: { [projectId: string]: string } = {};
  
  async loadProjectImage(project: Project) {
    const projectId = project.PK_ID;
    const primaryPhoto = project['PrimaryPhoto'];
    
    if (!projectId || !primaryPhoto || !primaryPhoto.startsWith('/')) {
      return;
    }
    
    // Create a cache key that includes the photo path to detect changes
    const cacheKey = `${projectId}_${primaryPhoto}`;
    
    // Check if we already have this exact image cached
    if (this.projectImageCache[cacheKey]) {
      // Update the projectId cache to point to this image
      this.projectImageCache[projectId] = this.projectImageCache[cacheKey];
      return;
    }
    
    try {
      const imageData = await this.caspioService.getImageFromFilesAPI(primaryPhoto).toPromise();
      
      if (imageData && imageData.startsWith('data:')) {
        // Store in cache with both keys
        this.projectImageCache[projectId] = imageData;
        this.projectImageCache[cacheKey] = imageData;
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

  async deleteProject(project: Project) {
    const alert = await this.alertController.create({
      header: 'Delete Project',
      message: `Are you sure you want to delete the project at ${project.Address}?`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          handler: async () => {
            await this.performProjectDeletion(project);
          }
        }
      ]
    });

    await alert.present();
  }

  async performProjectDeletion(project: Project) {
    const loading = await this.alertController.create({
      message: 'Deleting project...'
    });
    await loading.present();

    try {
      // Soft delete by setting StatusID to 5
      await this.projectsService.updateProjectStatus(project.PK_ID, 5).toPromise();

      // Remove from displayed list
      this.projects = this.projects.filter(p => p.PK_ID !== project.PK_ID);
      this.applySearchFilter();

      await loading.dismiss();

      const toast = await this.alertController.create({
        message: 'Project deleted successfully',
        buttons: ['OK']
      });
      await toast.present();
      setTimeout(() => toast.dismiss(), 2000);
    } catch (error) {
      console.error('Error deleting project:', error);
      await loading.dismiss();

      const errorAlert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to delete project. Please try again.',
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
      await this.loadActiveProjects();
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
