import { Injectable } from '@angular/core';
import { CaspioService } from './caspio.service';
import { Observable, from, throwError, timer, of } from 'rxjs';
import { map, switchMap, catchError, retry, tap } from 'rxjs/operators';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { CacheService } from './cache.service';
import { OfflineService } from './offline.service';
import { MutationTrackingService, MutationType } from './mutation-tracking.service';

export interface Project {
  PK_ID?: string;
  ProjectID?: string;
  Project_ID?: string;
  Project_Name?: string;
  CompanyID?: number;
  Company_ID?: string;
  UserID?: number;
  StatusID?: number | string;
  Address?: string;
  City?: string;
  State?: string;
  StateID?: number;
  Zip?: string;
  Date?: string;
  InspectionDate?: string;
  Fee?: number;
  Notes?: string;
  OffersID?: number;
  Status?: string;
  [key: string]: any;
}

export interface ProjectCreationData {
  company: string;
  user: string;
  dateOfRequest?: string;
  inspectionDate?: string;
  address: string;
  city: string;
  state: number | string | null;  // Can be number (StateID), string, or null for --Select--
  zip: string;
  services: string[];
  fee?: string;
  notes?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ProjectsService {
  private apiBaseUrl = environment.caspio.apiBaseUrl;

  // State mapping (exact same as local server)
  private stateMapping: { [key: string]: number } = {
    'TX': 1,    // Texas
    'GA': 2,    // Georgia
    'FL': 3,    // Florida
    'CO': 4,    // Colorado
    'CA': 6,    // California
    'AZ': 7,    // Arizona
    'SC': 8,    // South Carolina
    'TN': 9     // Tennessee
  };

  constructor(
    private caspioService: CaspioService,
    private http: HttpClient,
    private cache: CacheService,
    private offline: OfflineService,
    private mutationTracker: MutationTrackingService
  ) {}

  getProjectTableDefinition(): Observable<any> {
    return this.caspioService.get('/tables/LPS_Projects/definition');
  }

  /**
   * Clear all project-related cache entries
   */
  clearProjectCache(): void {
    // Clear all project cache keys
    this.cache.clear(this.cache.getApiCacheKey('projects_active', {}));
    this.cache.clear(this.cache.getApiCacheKey('projects_active', { companyId: 1 }));
  }

  /**
   * Clear cache for a specific project detail
   */
  clearProjectDetailCache(projectId: string): void {
    const cacheKey = this.getProjectDetailCacheKey(projectId);
    this.cache.clear(cacheKey);
    console.log('🗑️ Cleared ProjectsService cache for project:', projectId);
  }

  getActiveProjects(companyId?: number): Observable<Project[]> {
    // Build cache key
    const cacheKey = this.cache.getApiCacheKey('projects_active', { companyId });
    
    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return of(cached);
    }
    
    // Build the where clause
    let whereClause = 'StatusID%3D7';
    if (companyId) {
      whereClause += `%20AND%20CompanyID%3D${companyId}`;
    }

    // Fetch projects with StatusID = 7 (Active) and optionally filter by CompanyID
    return this.caspioService.get<any>(`/tables/LPS_Projects/records?q.where=${whereClause}`).pipe(
      map(response => response.Result || []),
      tap(projects => {
        // Cache the results for 5 minutes
        this.cache.set(cacheKey, projects, this.cache.CACHE_TIMES.MEDIUM, true);
      })
    );
  }

  getAllProjects(companyId?: number): Observable<Project[]> {
    // Build the URL with optional CompanyID filter
    let url = '/tables/LPS_Projects/records';
    if (companyId) {
      url += `?q.where=CompanyID%3D${companyId}`;
    }
    
    return this.caspioService.get<any>(url).pipe(
      map(response => response.Result || [])
    );
  }

  getProjectById(projectId: string): Observable<Project> {
    const cacheKey = this.getProjectDetailCacheKey(projectId);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return of(cached);
    }

    return this.caspioService.get<any>(`/tables/LPS_Projects/records?q.where=PK_ID%3D%27${projectId}%27`).pipe(
      map(response => response.Result && response.Result[0] || {}),
      tap(project => {
        if (project && Object.keys(project).length > 0) {
          this.cache.set(cacheKey, project, this.cache.CACHE_TIMES.MEDIUM);
        }
      })
    );
  }

  // Convert state abbreviation to StateID (exact same logic as local server)
  private getStateIDFromAbbreviation(stateAbbr: string | undefined): number | null {
    if (!stateAbbr) return null;
    const stateID = this.stateMapping[stateAbbr.toUpperCase()];
    return stateID || null;
  }

  // Create new project (exact same logic as local server)
  createProject(projectData: ProjectCreationData): Observable<any> {
    // Save original data for later lookup
    const originalAddress = projectData.address;
    const originalCity = projectData.city || '';
    const originalDate = new Date().toISOString().split('T')[0];

    // StateID must be a number - handle both string and number input
    const stateId = typeof projectData.state === 'number'
      ? projectData.state
      : (projectData.state ? parseInt(projectData.state.toString()) : null);

    // Format date as MM/DD/YYYY HH:MM:SS for Caspio Date/Time field
    const formatDateTimeForCaspio = (dateStr: string | undefined) => {
      if (!dateStr) {
        // Use current datetime if not provided
        const now = new Date();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        const year = now.getFullYear();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const seconds = now.getSeconds().toString().padStart(2, '0');
        return `${month}/${day}/${year} ${hours}:${minutes}:${seconds}`;
      }
      const date = new Date(dateStr);
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const year = date.getFullYear();
      // Add time component (default to noon if not specified)
      return `${month}/${day}/${year} 12:00:00`;
    };

    // Validate required fields
    if (!projectData.address) {
      console.error('Address is required but missing!');
      return throwError(() => new Error('Address is required'));
    }

    if (!stateId) {
      console.error('StateID is required but missing!');
      return throwError(() => new Error('State is required'));
    }

    // Build payload matching exact Caspio table structure
    const caspioData: any = {
      // Required fields - all must be integers
      CompanyID: 1, // Integer - Noble Property Inspections (REQUIRED)
      StateID: stateId, // Integer - must be numeric (VERIFIED)
      UserID: 1, // Integer - Default user (REQUIRED)
      StatusID: 7, // Integer - Active status (REQUIRED)
      Address: projectData.address.trim(), // Text(255) - Required

      // Date field - Date/Time type
      Date: formatDateTimeForCaspio(new Date().toISOString()), // Current datetime

      // Optional fields
      City: projectData.city || '', // Text(255)
      Zip: projectData.zip || '', // Text(255)

      // Set these to null as requested
      OffersID: null, // Set to null
      Fee: null, // Set to null

      // Inspection date if provided
      InspectionDate: projectData.inspectionDate ?
        formatDateTimeForCaspio(projectData.inspectionDate) :
        formatDateTimeForCaspio(new Date().toISOString())
    };

    // Add notes only if provided
    if (projectData.notes && projectData.notes.trim()) {
      caspioData.Notes = projectData.notes;
    }

    // Use caspioService.post which routes through AWS when useApiGateway is true
    // Add response=rows to get the created record back
    return this.caspioService.post<any>(`/tables/LPS_Projects/records?response=rows`, caspioData).pipe(
      switchMap(response => {
        let createdProjectId = null;
        let createdProject = null;

        // With response=rows, Caspio returns {"Result": [{created record}]}
        if (response && typeof response === 'object') {
          const result = response.Result;
          if (Array.isArray(result) && result.length > 0) {
            createdProject = result[0];
            createdProjectId = createdProject.PK_ID;
          }
        }

        // If we got the project directly from the response, use it
        if (createdProjectId && createdProject) {
          // Clear cache so the new project appears immediately
          this.clearProjectCache();

          // OPTIMIZATION: Track mutation for instant cache invalidation
          this.mutationTracker.trackProjectMutation(
            MutationType.CREATE,
            createdProjectId,
            createdProject
          );

          return of({
            success: true,
            message: 'Project created',
            projectId: createdProjectId,
            projectData: createdProject
          });
        }

        // Fallback: fetch the newly created project
        return this.fetchNewProject(originalAddress, originalCity, originalDate).pipe(
          map(newProject => {
            if (newProject && newProject.PK_ID) {
              // OPTIMIZATION: Track mutation for instant cache invalidation
              this.mutationTracker.trackProjectMutation(
                MutationType.CREATE,
                newProject.PK_ID,
                newProject
              );

              return {
                success: true,
                message: 'Project created',
                projectId: newProject.PK_ID,
                projectData: newProject
              };
            }
            console.error('Could not find project after creation - this is unexpected');
            return {
              success: true,
              message: 'Project created but ID not found',
              projectId: null
            };
          })
        );
      }),
      catchError(error => {
        console.error('ERROR CREATING PROJECT:', error);

        // Check if it's actually a success (201 status)
        if (error.status === 201) {
          // Check if we have the created record in error body (with response=rows)
          if (error.error && error.error.Result && Array.isArray(error.error.Result)) {
            const createdProject = error.error.Result[0];
            if (createdProject && createdProject.PK_ID) {
              return of({
                success: true,
                message: 'Project created',
                projectId: createdProject.PK_ID,
                projectData: createdProject
              });
            }
          }

          // Fallback to search
          return this.fetchNewProject(originalAddress, originalCity, originalDate).pipe(
            map(newProject => {
              if (newProject && newProject.PK_ID) {
                this.mutationTracker.trackProjectMutation(
                  MutationType.CREATE,
                  newProject.PK_ID,
                  newProject
                );

                return {
                  success: true,
                  message: 'Project created',
                  projectId: newProject.PK_ID,
                  projectData: newProject
                };
              }
              console.error('Could not find project after 201 response');
              return {
                success: true,
                message: 'Project created but ID not found',
                projectId: null
              };
            })
          );
        }

        return throwError(() => error);
      })
    );
  }

  // Update project status (for soft delete - StatusID 5 = deleted)
  updateProjectStatus(projectId: string | undefined, statusId: number): Observable<any> {
    if (!projectId) {
      return throwError(() => new Error('No project ID provided'));
    }

    const updateData = { StatusID: statusId };

    // Use caspioService.put which routes through AWS when useApiGateway is true
    return this.caspioService.put<any>(
      `/tables/LPS_Projects/records?q.where=PK_ID=${projectId}`,
      updateData
    ).pipe(
      tap(() => {
        this.cache.clear(this.getProjectDetailCacheKey(projectId));

        // OPTIMIZATION: Track mutation for instant cache invalidation
        this.mutationTracker.trackProjectMutation(
          MutationType.UPDATE,
          projectId,
          { StatusID: statusId }
        );
      }),
      catchError(error => {
        console.error('Error updating project status:', error);
        return throwError(() => error);
      })
    );
  }

  updateProjectPrimaryPhoto(projectId: string | undefined, photoUrl: string): Observable<any> {
    if (!projectId) {
      return throwError(() => new Error('No project ID provided'));
    }

    const updateData = { PrimaryPhoto: photoUrl };

    // Use caspioService.put which routes through AWS when useApiGateway is true
    return this.caspioService.put<any>(
      `/tables/LPS_Projects/records?q.where=PK_ID=${projectId}`,
      updateData
    ).pipe(
      tap(() => {
        console.log(`Updated PrimaryPhoto for project ${projectId}`);
        this.cache.clear(this.getProjectDetailCacheKey(projectId));

        // OPTIMIZATION: Track mutation for instant cache invalidation
        this.mutationTracker.trackProjectMutation(
          MutationType.UPDATE,
          projectId,
          { PrimaryPhoto: photoUrl }
        );
      }),
      catchError(error => {
        console.error('Error updating project primary photo:', error);
        return throwError(() => error);
      })
    );
  }

  // Fetch newly created project immediately
  private fetchNewProject(address: string, city: string, date: string): Observable<Project | null> {
    // Caspio is instantaneous, fetch immediately
    return this.getAllProjects().pipe(
      map(projects => {
        
        // Sort all projects by PK_ID descending to get the most recent first
        const sortedProjects = projects.sort((a, b) => 
          parseInt(b.PK_ID || '0') - parseInt(a.PK_ID || '0')
        );
        
        // Log the most recent projects
        if (sortedProjects.length > 0) {
        }
        
        // Look for exact address match in recent projects (check top 10)
        const recentProjects = sortedProjects.slice(0, 10);
        const matchingProject = recentProjects.find(p => 
          p.Address && p.Address.toLowerCase().trim() === address.toLowerCase().trim()
        );
        
        if (matchingProject) {
          return matchingProject;
        }
        return null;
      })
    );
  }

  // Get offers for a company
  getOffers(companyId: number): Observable<any[]> {
    return this.caspioService.get<any>(`/tables/LPS_Offers/records?q.where=CompanyID%3D${companyId}`).pipe(
      map(response => response.Result || [])
    );
  }

  // Get service types
  getServiceTypes(): Observable<any[]> {
    return this.caspioService.get<any>('/tables/LPS_Type/records').pipe(
      map(response => response.Result || [])
    );
  }

  // Get states from Caspio States table
  getStates(): Observable<any[]> {
    return this.caspioService.get<any>('/tables/LPS_States/records').pipe(
      map(response => {
        return response.Result || [];
      })
    );
  }

  // Get services for a specific project
  getServicesByProjectId(projectId: string): Observable<any[]> {
    return this.caspioService.get<any>(`/tables/LPS_Services/records?q.where=ProjectID='${projectId}'`).pipe(
      map(response => response.Result || [])
    );
  }

  private getProjectDetailCacheKey(projectId: string): string {
    return this.cache.getApiCacheKey('project_detail', { projectId });
  }
}
