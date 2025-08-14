import { Component, OnInit } from '@angular/core';
import { ProjectsService, Project } from '../../services/projects.service';
import { CaspioService } from '../../services/caspio.service';

@Component({
  selector: 'app-active-projects',
  templateUrl: './active-projects.page.html',
  styleUrls: ['./active-projects.page.scss'],
})
export class ActiveProjectsPage implements OnInit {
  projects: Project[] = [];
  loading = false;
  error = '';

  constructor(
    private projectsService: ProjectsService,
    private caspioService: CaspioService
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
        this.loadActiveProjects();
      },
      error: (error) => {
        this.error = 'Authentication failed';
        this.loading = false;
        console.error('Authentication error:', error);
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
                  p.Status === 'Active' || p.Status === 'active'
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
        this.error = 'Failed to get table structure';
        this.loading = false;
        console.error('Error getting table definition:', error);
      }
    });
  }

  getProjectImage(project: Project): string {
    // Return a placeholder image for now
    // You can update this to use actual project images if available
    return 'assets/img/project-placeholder.svg';
  }

  formatAddress(project: Project): string {
    const parts = [];
    if (project.Address) parts.push(project.Address);
    if (project.City) parts.push(project.City);
    if (project.State) parts.push(project.State);
    return parts.join(', ');
  }
}