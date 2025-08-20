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
        
        // Save original data for later lookup
        const originalAddress = projectData.address;
        const originalCity = projectData.city || '';
        const originalDate = new Date().toISOString().split('T')[0];
        
        // Log what we received from the form
        console.log('📋 Form data received:', {
          address: projectData.address,
          city: projectData.city,
          state: projectData.state,
          zip: projectData.zip,
          inspectionDate: projectData.inspectionDate
        });
        
        // Get StateID from abbreviation (required field)
        const stateId = this.getStateIDFromAbbreviation(projectData.state);
        console.log('🗺️ State mapping:', projectData.state, '->', stateId);
        
        // Format date as MM/DD/YYYY for Caspio
        const formatDateForCaspio = (dateStr: string | undefined) => {
          if (!dateStr) return '';
          const date = new Date(dateStr);
          const month = (date.getMonth() + 1).toString().padStart(2, '0');
          const day = date.getDate().toString().padStart(2, '0');
          const year = date.getFullYear();
          return `${month}/${day}/${year}`;
        };
        
        // Validate required fields
        if (!projectData.address) {
          console.error('❌ Address is required but missing!');
          return throwError(() => new Error('Address is required'));
        }
        
        // Build payload with required fields
        // Based on Caspio table: Address*, StateID*, OffersID*, Fee*
        const caspioData: any = {
          CompanyID: 1, // Noble Property Inspections (might be required)
          Address: projectData.address.trim(), // Required - trimmed
          StateID: stateId || 1, // Required - must be numeric ID
          OffersID: 1, // Required - default service type
          Fee: 265.00, // Required - as decimal
          StatusID: 1, // Active status (might be required)
          UserID: 1 // Default user (might be required)
        };
        
        // Add optional fields only if they have values
        if (projectData.city) {
          caspioData.City = projectData.city;
        }
        if (projectData.zip) {
          caspioData.Zip = projectData.zip;
        }
        if (projectData.inspectionDate) {
          caspioData.InspectionDate = formatDateForCaspio(projectData.inspectionDate);
        }
        
        // Add notes only if provided
        if (projectData.notes && projectData.notes.trim()) {
          caspioData.Notes = projectData.notes;
        }
        
        console.log('📤 Data being sent to Caspio:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        Object.keys(caspioData).forEach(key => {
          const value = caspioData[key];
          const type = typeof value;
          console.log(`  ${key}: ${value} (${type})`);
        });
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📍 Full URL:', `${this.apiBaseUrl}/tables/Projects/records`);
        console.log('🔑 Token:', this.caspioService.getCurrentToken() ? 'Present' : 'Missing');
        console.log('📋 JSON being sent:', JSON.stringify(caspioData, null, 2));
        
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
            console.log('📥 Response headers:', response.headers);
            console.log('📥 Response body:', response.body);
            
            // Caspio returns 201 Created with empty body on success
            if (response.status === 201 || response.status === 200) {
              console.log('✅ Project created successfully with status:', response.status);
              console.log('📍 Will search for project with address:', originalAddress);
              
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
            console.error('❌ ERROR CREATING PROJECT - FULL DETAILS:');
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.error('Status Code:', error.status);
            console.error('Status Text:', error.statusText);
            console.error('URL:', error.url);
            console.error('Error Body:', error.error);
            console.error('Error Message:', error.message);
            
            // Show what we tried to send
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.error('FAILED REQUEST DATA:');
            Object.keys(caspioData).forEach(key => {
              console.error(`  ${key}: ${caspioData[key]} (${typeof caspioData[key]})`);
            });
            console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            
            if (error.error && typeof error.error === 'object') {
              console.error('Caspio Error Response:', JSON.stringify(error.error, null, 2));
            }
            if (error.error && error.error.Message) {
              console.error('⚠️ Caspio says:', error.error.Message);
            }
            
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

  // Fetch newly created project (simplified to only match on address)
  private fetchNewProject(address: string, city: string, date: string): Observable<Project | null> {
    // Wait a moment for Caspio to process the insert
    return timer(1000).pipe(
      switchMap(() => this.getAllProjects()),
      map(projects => {
        console.log('🔍 Looking for project with address:', address);
        
        // Log first few projects for debugging
        if (projects && projects.length > 0) {
          console.log('📋 Latest projects:', projects.slice(0, 3).map(p => ({
            PK_ID: p.PK_ID,
            ProjectID: p.ProjectID,
            Address: p.Address,
            Date: p.Date
          })));
        }
        
        // Find projects matching our criteria - simplified to only address
        const matchingProjects = projects.filter(p => 
          p.Address === address
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