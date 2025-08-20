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
  state: number | string;  // Can be number (StateID) or string for compatibility
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
        
        // StateID must be a number - handle both string and number input
        const stateId = typeof projectData.state === 'number' 
          ? projectData.state 
          : (projectData.state ? parseInt(projectData.state.toString()) : null);
        
        // Extra verification that all IDs are truly integers
        console.log('🗺️ Input state:', projectData.state, 'Type:', typeof projectData.state);
        console.log('🗺️ Using StateID:', stateId, 'Type:', typeof stateId);
        console.log('✅ Verification of Integer Fields:');
        console.log('  - CompanyID: 1, is integer?', Number.isInteger(1), '(type:', typeof 1, ')');
        console.log('  - StateID:', stateId, 'is integer?', Number.isInteger(stateId), '(type:', typeof stateId, ')');
        console.log('  - UserID: 1, is integer?', Number.isInteger(1), '(type:', typeof 1, ')');
        console.log('  - StatusID: 1, is integer?', Number.isInteger(1), '(type:', typeof 1, ')');
        
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
          console.error('❌ Address is required but missing!');
          return throwError(() => new Error('Address is required'));
        }
        
        if (!stateId) {
          console.error('❌ StateID is required but missing!');
          return throwError(() => new Error('State is required'));
        }
        
        // Build payload matching exact Caspio table structure
        const caspioData: any = {
          // Required fields - all must be integers
          CompanyID: 1, // Integer - Noble Property Inspections (REQUIRED)
          StateID: stateId, // Integer - must be numeric (VERIFIED)
          UserID: 1, // Integer - Default user (REQUIRED)
          StatusID: 1, // Integer - Active status (REQUIRED)
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
        
        console.log('📤 CASPIO PROJECTS TABLE - FIELD MAPPING:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📊 TABLE: Projects');
        console.log('📍 API ENDPOINT: /tables/Projects/records');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('COLUMN HEADERS AND VALUES:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        // List each field with its column name, value, and type
        const fieldMapping = [
          { column: 'CompanyID', value: caspioData.CompanyID, dataType: 'Integer', required: 'YES' },
          { column: 'StateID', value: caspioData.StateID, dataType: 'Integer', required: 'YES' },
          { column: 'UserID', value: caspioData.UserID, dataType: 'Integer', required: 'YES' },
          { column: 'StatusID', value: caspioData.StatusID, dataType: 'Integer', required: 'YES' },
          { column: 'Address', value: caspioData.Address, dataType: 'Text(255)', required: 'YES' },
          { column: 'City', value: caspioData.City, dataType: 'Text(255)', required: 'NO' },
          { column: 'Zip', value: caspioData.Zip, dataType: 'Text(255)', required: 'NO' },
          { column: 'Date', value: caspioData.Date, dataType: 'Date/Time', required: 'YES' },
          { column: 'InspectionDate', value: caspioData.InspectionDate, dataType: 'Date/Time', required: 'NO' },
          { column: 'OffersID', value: caspioData.OffersID, dataType: 'Integer', required: 'NO (NULL)' },
          { column: 'Fee', value: caspioData.Fee, dataType: 'Currency', required: 'NO (NULL)' },
          { column: 'Notes', value: caspioData.Notes, dataType: 'Text(64000)', required: 'NO' }
        ];
        
        fieldMapping.forEach(field => {
          if (field.value !== undefined) {
            const jsType = typeof field.value;
            console.log(`Column: ${field.column.padEnd(15)} | Caspio Type: ${field.dataType.padEnd(12)} | Required: ${field.required.padEnd(3)} | Value: ${field.value} (JS: ${jsType})`);
          }
        });
        
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📋 FULL JSON PAYLOAD:');
        console.log(JSON.stringify(caspioData, null, 2));
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔑 Auth Token:', this.caspioService.getCurrentToken() ? 'Present' : 'Missing');
        console.log('📍 Full URL:', `${this.apiBaseUrl}/tables/Projects/records`);
        
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
            console.error('❌ ERROR CREATING PROJECT - DETAILED ANALYSIS:');
            console.error('════════════════════════════════════════════════');
            console.error('HTTP STATUS:', error.status, '(' + error.statusText + ')');
            console.error('API ENDPOINT:', error.url);
            console.error('════════════════════════════════════════════════');
            
            // Show Caspio's error response
            if (error.error) {
              console.error('📛 CASPIO ERROR RESPONSE:');
              if (typeof error.error === 'object') {
                console.error(JSON.stringify(error.error, null, 2));
                if (error.error.Message) {
                  console.error('⚠️ ERROR MESSAGE:', error.error.Message);
                }
                if (error.error.Details) {
                  console.error('📝 ERROR DETAILS:', error.error.Details);
                }
              } else {
                console.error(error.error);
              }
            }
            
            console.error('════════════════════════════════════════════════');
            console.error('📤 WHAT WE ATTEMPTED TO SEND:');
            console.error('────────────────────────────────────────────────');
            
            // Show each field we tried to send
            const sentFields = [
              { column: 'CompanyID', value: caspioData.CompanyID, expected: 'Integer' },
              { column: 'StateID', value: caspioData.StateID, expected: 'Integer' },
              { column: 'UserID', value: caspioData.UserID, expected: 'Integer' },
              { column: 'OffersID', value: caspioData.OffersID, expected: 'Integer' },
              { column: 'Address', value: caspioData.Address, expected: 'Text(255)' },
              { column: 'City', value: caspioData.City, expected: 'Text(255)' },
              { column: 'Zip', value: caspioData.Zip, expected: 'Text(255)' },
              { column: 'Date', value: caspioData.Date, expected: 'Date/Time' },
              { column: 'InspectionDate', value: caspioData.InspectionDate, expected: 'Date/Time' },
              { column: 'Fee', value: caspioData.Fee, expected: 'Currency' }
            ];
            
            sentFields.forEach(field => {
              if (field.value !== undefined) {
                console.error(`  ${field.column.padEnd(15)}: ${field.value} (${typeof field.value})`);
              }
            });
            
            console.error('════════════════════════════════════════════════');
            console.error('💡 POSSIBLE ISSUES:');
            console.error('1. Missing required field (Address, StateID, OffersID, Fee)');
            console.error('2. Wrong data type (StateID should be number)');
            console.error('3. Invalid StateID value (not in States table)');
            console.error('4. Invalid OffersID value (not in Offers table)');
            console.error('5. Authentication token expired');
            console.error('════════════════════════════════════════════════');
            
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

  // Get states from Caspio States table
  getStates(): Observable<any[]> {
    return this.caspioService.get<any>('/tables/States/records').pipe(
      map(response => {
        console.log('📍 States loaded from Caspio:', response.Result);
        return response.Result || [];
      })
    );
  }
}