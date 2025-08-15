import { Injectable } from '@angular/core';
import { CaspioService } from './caspio.service';
import { Observable, from, throwError, timer } from 'rxjs';
import { map, switchMap, catchError, retry } from 'rxjs/operators';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';

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
  state: string;
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
    private http: HttpClient
  ) {}

  getProjectTableDefinition(): Observable<any> {
    return this.caspioService.get('/tables/Projects/definition');
  }

  getActiveProjects(): Observable<Project[]> {
    // Fetch projects with StatusID = 1 (Active)
    return this.caspioService.get<any>('/tables/Projects/records?q.where=StatusID%3D1').pipe(
      map(response => response.Result || [])
    );
  }

  getAllProjects(): Observable<Project[]> {
    return this.caspioService.get<any>('/tables/Projects/records').pipe(
      map(response => response.Result || [])
    );
  }

  getProjectById(projectId: string): Observable<Project> {
    return this.caspioService.get<any>(`/tables/Projects/records?q.where=PK_ID%3D%27${projectId}%27`).pipe(
      map(response => response.Result && response.Result[0] || {})
    );
  }

  // Convert state abbreviation to StateID (exact same logic as local server)
  private getStateIDFromAbbreviation(stateAbbr: string | undefined): number | null {
    if (!stateAbbr) return null;
    const stateID = this.stateMapping[stateAbbr.toUpperCase()];
    console.log(`🗺️ Converting state '${stateAbbr}' to StateID: ${stateID || 'NOT FOUND'}`);
    return stateID || null;
  }

  // Create new project (exact same logic as local server)
  createProject(projectData: ProjectCreationData): Observable<any> {
    return from(this.caspioService.ensureAuthenticated()).pipe(
      switchMap(() => {
        console.log('🔍 Raw project data received:', projectData);
        console.log('📝 State value from form:', projectData.state);
        
        // Save original data for later lookup
        const originalAddress = projectData.address;
        const originalCity = projectData.city;
        const originalDate = projectData.dateOfRequest || new Date().toISOString().split('T')[0];
        
        // Convert state abbreviation to StateID
        const stateID = this.getStateIDFromAbbreviation(projectData.state);
        
        if (!stateID) {
          return throwError(() => new Error(`Unsupported state: ${projectData.state}. Supported states: TX, GA, FL, CO, CA, AZ, SC, TN`));
        }
        
        // Get the first selected service TypeID and use it as OffersID
        const selectedOffersID = projectData.services && projectData.services.length > 0 
          ? parseInt(projectData.services[0]) 
          : 1; // Default to 1 if none selected
        
        console.log('📝 Selected service for OffersID:', selectedOffersID);
        
        // Map form fields to Caspio fields (exact same mapping as local server)
        const caspioData = {
          CompanyID: parseInt(projectData.company) || 1, // Company from dropdown
          UserID: parseInt(projectData.user) || 1, // User from dropdown
          Date: originalDate, // Date of Request
          InspectionDate: projectData.inspectionDate,
          Address: originalAddress,
          City: originalCity,
          StateID: stateID, // Now using numeric StateID from mapping
          Zip: projectData.zip,
          StatusID: 1, // Active status (1 = Active)
          Fee: parseFloat(projectData.fee || '265.00'), // Service fee from form
          Notes: projectData.notes || '', // Notes from textarea
          OffersID: selectedOffersID, // Service type stored in OffersID field
        };
        
        console.log('📤 Data being sent to Caspio (with converted StateID):', caspioData);
        
        const headers = new HttpHeaders({
          'Authorization': `Bearer ${this.caspioService.getCurrentToken()}`,
          'Content-Type': 'application/json'
        });
        
        return this.http.post<any>(`${this.apiBaseUrl}/tables/Projects/records`, caspioData, { 
          headers,
          observe: 'response' // Get full response to check status
        }).pipe(
          switchMap(response => {
            console.log('✅ Project creation response status:', response.status);
            console.log('📥 Response body:', response.body);
            
            // Caspio returns 201 Created with empty body on success
            if (response.status === 201 || response.status === 200) {
              console.log('✅ Project created successfully');
              
              // Fetch the newly created project to get its PK_ID
              return this.fetchNewProject(originalAddress, originalCity, originalDate).pipe(
                map(newProject => {
                  if (newProject) {
                    return {
                      success: true,
                      message: 'Project created',
                      projectId: newProject.PK_ID,
                      projectData: newProject
                    };
                  }
                  // Even if we can't find the project, return success
                  // The project was created, we just can't find it yet
                  return { 
                    success: true, 
                    message: 'Project created',
                    projectId: 'new' // Fallback ID
                  };
                })
              );
            } else {
              return throwError(() => new Error('Failed to create project'));
            }
          }),
          catchError(error => {
            console.error('Error creating project:', error);
            
            // Check if it's actually a success (201 status)
            if (error.status === 201) {
              console.log('✅ Project created (201 in error handler)');
              // Still success, Caspio returns 201 with empty body
              return this.fetchNewProject(originalAddress, originalCity, originalDate).pipe(
                map(newProject => {
                  if (newProject) {
                    return {
                      success: true,
                      message: 'Project created',
                      projectId: newProject.PK_ID,
                      projectData: newProject
                    };
                  }
                  return { 
                    success: true, 
                    message: 'Project created',
                    projectId: 'new'
                  };
                })
              );
            }
            
            return throwError(() => error);
          })
        );
      })
    );
  }

  // Fetch newly created project (same logic as local server)
  private fetchNewProject(address: string, city: string, date: string): Observable<Project | null> {
    // Wait a moment for Caspio to process the insert
    return timer(1000).pipe(
      switchMap(() => this.getAllProjects()),
      map(projects => {
        console.log('🔍 Looking for project with:', {
          address: address,
          city: city,
          date: date
        });
        
        // Log first few projects for debugging
        if (projects && projects.length > 0) {
          console.log('📋 Latest projects:', projects.slice(0, 3).map(p => ({
            PK_ID: p.PK_ID,
            ProjectID: p.ProjectID,
            Address: p.Address,
            City: p.City,
            Date: p.Date
          })));
        }
        
        // Find projects matching our criteria - EXACT SAME as local server
        // Only match on Address and City, not Date
        const matchingProjects = projects.filter(p => 
          p.Address === address && 
          p.City === city
        );
        
        if (matchingProjects.length > 0) {
          // Sort by PK_ID descending and get the first (newest)
          const newProject = matchingProjects.sort((a, b) => 
            parseInt(b.PK_ID || '0') - parseInt(a.PK_ID || '0')
          )[0];
          console.log('📍 Found new project with PK_ID:', newProject.PK_ID);
          console.log('📍 Project has ProjectID:', newProject.ProjectID);
          return newProject;
        }
        
        console.log('⚠️ No matching project found');
        return null;
      })
    );
  }

  // Get offers for a company
  getOffers(companyId: number): Observable<any[]> {
    return this.caspioService.get<any>(`/tables/Offers/records?q.where=CompanyID%3D${companyId}`).pipe(
      map(response => response.Result || [])
    );
  }

  // Get service types
  getServiceTypes(): Observable<any[]> {
    return this.caspioService.get<any>('/tables/Type/records').pipe(
      map(response => response.Result || [])
    );
  }

  // Get states
  getStates(): Observable<any[]> {
    return this.caspioService.get<any>('/tables/States/records').pipe(
      map(response => response.Result || [])
    );
  }
}