import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ProjectsService, Project } from '../../services/projects.service';
import { CaspioService } from '../../services/caspio.service';
import { DeployService } from '../../services/deploy.service';
import { Capacitor } from '@capacitor/core';

declare const cordova: any;

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
    private deployService: DeployService,
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
    
    // Wait a moment for the plugin to initialize
    setTimeout(async () => {
      const deployPlugin = this.deployService.getDeployPlugin();
      
      if (deployPlugin) {
        try {
          console.log('Using DeployService plugin');
          const hasUpdate = await this.deployService.checkForUpdates();
          
          if (hasUpdate) {
            alert('Update installed! The app will refresh with the new version.');
          } else {
            alert('App is up to date!');
          }
        } catch (error: any) {
          console.error('Update error:', error);
          alert(`Update check error: ${error?.message || JSON.stringify(error)}`);
        }
      } else {
        // Fallback: Try to find plugin manually
        const win = window as any;
        
        if (typeof cordova !== 'undefined' && cordova.plugin) {
          console.log('Cordova plugins available:', Object.keys(cordova.plugin));
          
          // Look for the deploy plugin
          const deploy = cordova.plugin.Deploy || cordova.plugin.IonicDeploy;
          
          if (deploy) {
            console.log('Found deploy plugin, methods:', Object.keys(deploy).filter(k => typeof deploy[k] === 'function'));
            
            try {
              const result = await deploy.sync({ updateMethod: 'auto' });
              console.log('Sync result:', result);
              
              if (result === 'UPDATE_AVAILABLE') {
                alert('Update installed! The app will refresh.');
              } else {
                alert('App is up to date!');
              }
            } catch (error: any) {
              alert(`Sync error: ${error?.message || JSON.stringify(error)}`);
            }
          } else {
            alert('Deploy plugin not found. Available plugins:\n' + Object.keys(cordova.plugin).join(', '));
          }
        } else {
          alert('Cordova not available. Make sure the plugin is properly installed.');
        }
      }
    }, 1000);
  }
}