import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ProjectsService, Project } from '../../services/projects.service';
import { CaspioService } from '../../services/caspio.service';
import { Capacitor } from '@capacitor/core';

declare const IonicDeploy: any;
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
    
    const win = window as any;
    
    // Check all possible locations for the plugin
    const possiblePlugins = [
      typeof IonicDeploy !== 'undefined' ? IonicDeploy : null,
      win.IonicDeploy,
      win.IonicCordova, 
      win.Deploy,
      win.cordova?.plugin?.IonicDeploy,
      win.cordova?.plugin?.Deploy,
      win.Ionic?.Deploy
    ].filter(p => p);
    
    console.log('Found plugins at:', possiblePlugins.length, 'locations');
    
    if (Capacitor.isNativePlatform() && possiblePlugins.length > 0) {
      const deployPlugin = possiblePlugins[0];
      
      try {
        // First, log ALL properties and methods
        console.log('Plugin object keys:', Object.keys(deployPlugin));
        console.log('Plugin methods:', Object.keys(deployPlugin).filter(k => typeof deployPlugin[k] === 'function'));
        
        // Try to find the right method names - cordova-plugin-ionic uses different names
        const methodMap = {
          check: deployPlugin.check || deployPlugin.checkForUpdate || deployPlugin.sync,
          download: deployPlugin.download || deployPlugin.downloadUpdate,
          extract: deployPlugin.extract || deployPlugin.extractUpdate,
          reload: deployPlugin.reload || deployPlugin.reloadApp || deployPlugin.load,
          getVersions: deployPlugin.getVersions || deployPlugin.getAvailableVersions,
          getCurrentVersion: deployPlugin.getCurrentVersion || deployPlugin.getConfiguration
        };
        
        console.log('Method mapping:', Object.keys(methodMap).map(k => `${k}: ${!!methodMap[k]}`));
        
        // Show what we found
        const availableMethods = Object.keys(deployPlugin).filter(k => typeof deployPlugin[k] === 'function').join(', ');
        alert(`Plugin found!\nAvailable methods:\n${availableMethods || 'No methods found'}`);
        
        // If we have a sync method, use it (common in cordova-plugin-ionic)
        if (deployPlugin.sync) {
          console.log('Using sync method');
          const result = await deployPlugin.sync({updateMethod: 'auto'});
          console.log('Sync result:', result);
          
          if (result === 'true' || result === true) {
            alert('Update downloaded and will be applied on next app start!');
          } else {
            alert('App is up to date!');
          }
        } 
        // If check method exists, use it
        else if (methodMap.check) {
          console.log('Using check method');
          const hasUpdate = await methodMap.check();
          
          if (hasUpdate) {
            alert('Update available! Downloading...');
            
            if (methodMap.download) {
              await methodMap.download();
              
              if (methodMap.extract) {
                await methodMap.extract();
              }
              
              if (methodMap.reload) {
                alert('Update installed! Restarting...');
                await methodMap.reload();
              }
            }
          } else {
            alert('App is up to date!');
          }
        }
        // No recognized methods
        else {
          alert(`Plugin API not recognized.\nMethods found: ${availableMethods}\n\nPlease check console for details.`);
        }
        
      } catch (error: any) {
        console.error('Update error:', error);
        const errorMsg = error?.message || error?.error || JSON.stringify(error);
        alert(`Error: ${errorMsg}`);
      }
    } else {
      alert('Live updates plugin not found.\nMake sure cordova-plugin-ionic is installed.');
    }
  }
}