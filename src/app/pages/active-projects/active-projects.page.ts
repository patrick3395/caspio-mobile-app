import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ProjectsService, Project } from '../../services/projects.service';
import { CaspioService } from '../../services/caspio.service';
import { Capacitor } from '@capacitor/core';

declare const IonicDeploy: any;

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

  constructor(
    private projectsService: ProjectsService,
    private caspioService: CaspioService,
    private router: Router
  ) {}

  ngOnInit() {
    this.checkAuthAndLoadProjects();
  }

  ionViewWillEnter() {
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
    
    // First, let's get the table definition to understand the structure
    this.projectsService.getProjectTableDefinition().subscribe({
      next: (definition) => {
        console.log('Projects table structure:', definition);
        
        // Now load the active projects
        this.projectsService.getActiveProjects().subscribe({
          next: (projects) => {
            this.projects = projects;
            this.loading = false;
            console.log('Active projects loaded:', projects);
          },
          error: (error) => {
            // If filtered query fails, try getting all projects and filter locally
            this.projectsService.getAllProjects().subscribe({
              next: (allProjects) => {
                this.projects = allProjects.filter(p => 
                  p.StatusID === 1 || p.StatusID === '1' || p.Status === 'Active'
                );
                this.loading = false;
                console.log('Projects filtered locally:', this.projects);
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
    
    this.projectsService.getActiveProjects().subscribe({
      next: (projects) => {
        this.projects = projects;
        this.loading = false;
        this.error = '';
        console.log('Projects loaded directly:', projects);
      },
      error: (error) => {
        // If filtered query fails, try getting all projects and filter locally
        this.projectsService.getAllProjects().subscribe({
          next: (allProjects) => {
            this.projects = allProjects.filter(p => 
              p.StatusID === 1 || p.StatusID === '1' || p.Status === 'Active'
            );
            this.loading = false;
            this.error = '';
            console.log('All projects loaded and filtered:', this.projects);
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
    const address = this.formatAddress(project);
    if (!address) {
      return 'assets/img/project-placeholder.svg';
    }
    const encodedAddress = encodeURIComponent(address);
    const apiKey = 'AIzaSyCOlOYkj3N8PT_RnoBkVJfy2BSfepqqV3A';
    return `https://maps.googleapis.com/maps/api/streetview?size=120x120&location=${encodedAddress}&key=${apiKey}`;
  }

  formatAddress(project: Project): string {
    const parts = [];
    if (project.Address) parts.push(project.Address);
    if (project.City) parts.push(project.City);
    if (project.State) parts.push(project.State);
    return parts.join(', ');
  }

  createNewProject() {
    // Navigate to new project page
    console.log('Create new project clicked');
    this.router.navigate(['/new-project']);
  }

  async checkForUpdates() {
    console.log('Manual update check initiated');
    console.log('Platform:', Capacitor.getPlatform());
    console.log('Is Native:', Capacitor.isNativePlatform());
    
    const win = window as any;
    const deployPlugin = typeof IonicDeploy !== 'undefined' ? IonicDeploy : 
                        win.IonicDeploy || win.IonicCordova || win.Deploy;
    
    console.log('Deploy plugin found:', !!deployPlugin);
    
    if (Capacitor.isNativePlatform() && deployPlugin) {
      try {
        // Try to configure the plugin first
        const config = {
          appId: '1e8beef6',
          channel: 'Caspio Mobile App'
        };
        
        console.log('Initializing with config:', config);
        
        // Some versions don't need init, try without it first
        let currentVersion;
        try {
          currentVersion = await deployPlugin.getCurrentVersion();
          console.log('Current version (no init):', currentVersion);
        } catch (e) {
          console.log('getCurrentVersion failed, trying init first');
          await deployPlugin.configure(config);
          currentVersion = await deployPlugin.getCurrentVersion();
          console.log('Current version (after configure):', currentVersion);
        }
        
        console.log('Checking for updates...');
        const update = await deployPlugin.checkForUpdate();
        console.log('Update response:', update);
        
        if (update && update.available) {
          console.log('Update available:', update);
          alert('Update found! Downloading...');
          
          await deployPlugin.downloadUpdate((progress: number) => {
            console.log('Update download progress:', progress);
          });
          
          await deployPlugin.extractUpdate((progress: number) => {
            console.log('Update extract progress:', progress);
          });
          
          alert('Update installed! App will restart.');
          await deployPlugin.reloadApp();
        } else {
          console.log('No updates available');
          alert('App is up to date! Current version: ' + (currentVersion?.versionId || 'unknown'));
        }
      } catch (error: any) {
        console.error('Update check failed:', error);
        const errorMsg = error?.message || error?.error || JSON.stringify(error);
        alert('Update check failed: ' + errorMsg);
        
        // Log available methods on the plugin
        console.log('Available plugin methods:', Object.keys(deployPlugin).filter(k => typeof deployPlugin[k] === 'function'));
      }
    } else {
      console.log('Live updates not available');
      console.log('Available window properties:', Object.keys(win).filter(k => k.toLowerCase().includes('ionic') || k.toLowerCase().includes('deploy')));
      alert('Live updates plugin not found. Please ensure Build 26 includes the cordova-plugin-ionic.');
    }
  }
}