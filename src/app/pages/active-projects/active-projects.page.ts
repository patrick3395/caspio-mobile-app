import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { ProjectsService, Project } from '../../services/projects.service';
import { CaspioService } from '../../services/caspio.service';
import { IonicDeployService } from '../../services/ionic-deploy.service';
import { AlertController } from '@ionic/angular';

@Component({
  selector: 'app-active-projects',
  templateUrl: './active-projects.page.html',
  styleUrls: ['./active-projects.page.scss'],
  standalone: false
})
export class ActiveProjectsPage implements OnInit {
  projects: Project[] = [];
  loading = false;
  error = '';
  currentUser: any = null;
  appVersion = '1.4.141'; // Update this to match package.json version

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
    
    // Subscribe to query params to handle refresh
    this.route.queryParams.subscribe(params => {
      if (params['refresh']) {
        console.log('Refresh parameter detected, reloading projects...');
        this.checkAuthAndLoadProjects();
      }
    });
    this.checkAuthAndLoadProjects();
  }

  ionViewWillEnter() {
    // Always reload when entering the page
    console.log('ionViewWillEnter - reloading active projects');
    // Clear image cache to ensure fresh images are loaded
    this.projectImageCache = {};
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
        console.log('Authentication successful in ActiveProjects');
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
    this.loading = true;
    this.error = '';
    
    // Get the current user's CompanyID from localStorage
    const userStr = localStorage.getItem('currentUser');
    let companyId: number | undefined;
    
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        companyId = user.companyId || user.CompanyID;
        console.log('Loading projects for CompanyID:', companyId);
      } catch (e) {
        console.error('Error parsing user data:', e);
      }
    }
    
    // First, let's get the table definition to understand the structure
    this.projectsService.getProjectTableDefinition().subscribe({
      next: (definition) => {
        console.log('Projects table structure:', definition);
        
        // Now load the active projects filtered by CompanyID
        this.projectsService.getActiveProjects(companyId).subscribe({
          next: (projects) => {
            this.projects = projects;
            this.loading = false;
            console.log(`Active projects loaded for CompanyID ${companyId}:`, projects);
          },
          error: (error) => {
            // If filtered query fails, try getting all projects and filter locally
            this.projectsService.getAllProjects(companyId).subscribe({
              next: (allProjects) => {
                this.projects = allProjects.filter(p => 
                  p.StatusID === 1 || p.StatusID === '1' || p.Status === 'Active'
                );
                this.loading = false;
                console.log(`Projects filtered locally for CompanyID ${companyId}:`, this.projects);
              },
              error: (err) => {
                this.error = 'Failed to load projects';
                this.loading = false;
                console.error('Error loading projects:', err);
              }
            });
          }
        });
      },
      error: (error) => {
        const errorMessage = error?.error?.message || error?.message || 'Unknown error';
        this.error = `Failed to get table structure: ${errorMessage}`;
        this.loading = false;
        console.error('Error getting table definition:', error);
        console.error('Error details:', JSON.stringify(error, null, 2));
        // Try to load projects anyway without table definition
        this.loadProjectsDirectly();
      }
    });
  }

  loadProjectsDirectly() {
    console.log('Attempting to load projects directly without table definition...');
    this.loading = true;
    this.error = '';
    
    // Get the current user's CompanyID
    const userStr = localStorage.getItem('currentUser');
    let companyId: number | undefined;
    
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        companyId = user.companyId || user.CompanyID;
        console.log('Loading projects directly for CompanyID:', companyId);
      } catch (e) {
        console.error('Error parsing user data:', e);
      }
    }
    
    this.projectsService.getActiveProjects(companyId).subscribe({
      next: (projects) => {
        this.projects = projects;
        this.loading = false;
        this.error = '';
        console.log(`Projects loaded directly for CompanyID ${companyId}:`, projects);
      },
      error: (error) => {
        // If filtered query fails, try getting all projects and filter locally
        this.projectsService.getAllProjects(companyId).subscribe({
          next: (allProjects) => {
            this.projects = allProjects.filter(p => 
              p.StatusID === 1 || p.StatusID === '1' || p.Status === 'Active'
            );
            this.loading = false;
            this.error = '';
            console.log(`All projects loaded and filtered for CompanyID ${companyId}:`, this.projects);
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
    const apiKey = 'AIzaSyCOlOYkj3N8PT_RnoBkVJfy2BSfepqqV3A';
    return `https://maps.googleapis.com/maps/api/streetview?size=120x120&location=${encodedAddress}&key=${apiKey}`;
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
      // Use the same method as Structural Systems - fetch as base64 data URL
      console.log(`Loading project image from Files API: ${primaryPhoto}`);
      const imageData = await this.caspioService.getImageFromFilesAPI(primaryPhoto).toPromise();
      
      if (imageData && imageData.startsWith('data:')) {
        // Store in cache with both keys
        this.projectImageCache[projectId] = imageData;
        this.projectImageCache[cacheKey] = imageData;
        
        // Trigger change detection to update the view
        // The template will re-evaluate getProjectImage and use the cached value
        console.log(`✅ Project image loaded for ${projectId}`);
      } else {
        console.log('⚠️ Invalid image data for project', projectId);
        // Use fallback
        const address = this.formatAddress(project);
        if (address) {
          const encodedAddress = encodeURIComponent(address);
          const apiKey = 'AIzaSyCOlOYkj3N8PT_RnoBkVJfy2BSfepqqV3A';
          this.projectImageCache[projectId] = `https://maps.googleapis.com/maps/api/streetview?size=120x120&location=${encodedAddress}&key=${apiKey}`;
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
        const apiKey = 'AIzaSyCOlOYkj3N8PT_RnoBkVJfy2BSfepqqV3A';
        this.projectImageCache[projectId] = `https://maps.googleapis.com/maps/api/streetview?size=120x120&location=${encodedAddress}&key=${apiKey}`;
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
    // Navigate to new project page
    console.log('Create new project clicked');
    this.router.navigate(['/new-project']);
  }

  async checkForUpdates() {
    console.log('Refresh initiated');
    
    // Show loading while refreshing
    this.loading = true;
    
    try {
      // Just reload the projects list
      await this.loadActiveProjects();
      console.log('Projects refreshed successfully');
    } catch (error) {
      console.error('Error refreshing projects:', error);
      this.error = 'Failed to refresh projects';
    } finally {
      this.loading = false;
    }
    
    // Check for live updates and handle corruption
    try {
      console.log('Checking for app updates...');
      
      // If on native platform, try to sync
      if ((window as any).Capacitor && (window as any).Capacitor.isNativePlatform()) {
        try {
          const LiveUpdates = await import('@capacitor/live-updates');
          
          // Try to sync updates
          try {
            const result = await LiveUpdates.sync((percentage: number) => {
              console.log(`Update progress: ${percentage}%`);
            });
            console.log('Live update sync result:', result);
            
            if (result.activeApplicationPathChanged) {
              console.log('✅ New update applied');
              // Reload to apply the update
              await LiveUpdates.reload();
              return;
            }
          } catch (syncErr: any) {
            console.log('Sync error:', syncErr);
            
            // Check for corruption errors
            const isCorrupted = syncErr.message && (
              syncErr.message.includes('corrupt') || 
              syncErr.message.includes('unpack') ||
              syncErr.message.includes('FilerOperationsError') ||
              syncErr.message.includes('File Manager Error') ||
              syncErr.message.includes('IonicLiveUpdate')
            );
            
            if (isCorrupted) {
              console.log('⚠️ CORRUPTION DETECTED during refresh');
              console.log('Error was:', syncErr.message);
              
              // Show error to user
              this.error = 'Live Update corrupted. Please close and reopen the app.';
              
              try {
                // Try to force reload
                console.log('Attempting to reload to bundled version...');
                await LiveUpdates.reload();
              } catch (reloadErr) {
                console.log('Reload failed:', reloadErr);
                // Continue with normal refresh even if reload fails
              }
            }
          }
        } catch (err) {
          console.log('Live Updates error:', err);
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
}