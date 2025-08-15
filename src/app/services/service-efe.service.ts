import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { CaspioService } from './caspio.service';
import { environment } from '../../environments/environment';

export interface ServiceEFE {
  ServiceID?: number;
  ProjectID: number | string;
  PrimaryPhoto?: string;
  DateOfInspection?: string;
  TypeOfBuilding?: string;
  Style?: string;
  InAttendance?: string;
  WeatherConditions?: string;
  OutdoorTemperature?: number;
  OccupancyFurnishings?: string;
  // Additional fields from form
  YearBuilt?: string;
  SquareFootage?: string;
  FoundationType?: string;
  NumberOfStories?: string;
  ExteriorCladding?: string;
  RoofCovering?: string;
  GeneralPropertyConditions?: string;
  EvidenceOfPreviousFoundationRepair?: string;
  CrawlspaceBasement?: string;
  FoundationPerformanceOpinionDate?: string;
  PerformanceLevel?: string;
  [key: string]: any; // Allow dynamic fields
}

@Injectable({
  providedIn: 'root'
})
export class ServiceEfeService {
  private apiBaseUrl = environment.caspio.apiBaseUrl;

  constructor(
    private http: HttpClient,
    private caspioService: CaspioService
  ) {}

  // Check if Service_EFE record exists for a project
  checkServiceEFE(projectId: string): Observable<{exists: boolean, ServiceID?: number, record?: ServiceEFE}> {
    return from(this.caspioService.ensureAuthenticated()).pipe(
      switchMap(() => {
        const headers = this.getAuthHeaders();
        // First get the project to find its ProjectID (not PK_ID)
        return this.http.get<any>(`${this.apiBaseUrl}/tables/Projects/records?q.where=PK_ID=${projectId}`, { headers }).pipe(
          switchMap(projectData => {
            if (!projectData.Result || projectData.Result.length === 0) {
              return of({ exists: false });
            }
            
            const actualProjectId = projectData.Result[0].ProjectID;
            console.log(`Checking Service_EFE for ProjectID: ${actualProjectId} (from PK_ID: ${projectId})`);
            
            // Now check for Service_EFE record using the actual ProjectID
            return this.http.get<any>(`${this.apiBaseUrl}/tables/Service_EFE/records?q.where=ProjectID=${actualProjectId}`, { headers }).pipe(
              map(response => {
                if (response.Result && response.Result.length > 0) {
                  return {
                    exists: true,
                    ServiceID: response.Result[0].ServiceID,
                    record: response.Result[0]
                  };
                }
                return { exists: false };
              })
            );
          })
        );
      }),
      catchError(error => {
        console.error('Error checking Service_EFE:', error);
        return of({ exists: false });
      })
    );
  }

  // Create new Service_EFE record
  createServiceEFE(projectId: string | number): Observable<ServiceEFE> {
    return from(this.caspioService.ensureAuthenticated()).pipe(
      switchMap(() => {
        const headers = this.getAuthHeaders();
        const data = { ProjectID: projectId };
        
        return this.http.post<ServiceEFE>(`${this.apiBaseUrl}/tables/Service_EFE/records`, data, { headers }).pipe(
          map(response => {
            console.log('✅ Service_EFE record created for project:', projectId);
            return response;
          }),
          catchError(error => {
            console.error('❌ Failed to create Service_EFE record:', error);
            return throwError(() => error);
          })
        );
      })
    );
  }

  // Update Service_EFE record field
  updateField(serviceId: number, fieldName: string, value: any): Observable<any> {
    return from(this.caspioService.ensureAuthenticated()).pipe(
      switchMap(() => {
        const headers = this.getAuthHeaders();
        const updateData: any = {};
        updateData[fieldName] = value;
        
        return this.http.put<any>(
          `${this.apiBaseUrl}/tables/Service_EFE/records?q.where=ServiceID=${serviceId}`,
          updateData,
          { headers }
        ).pipe(
          map(response => {
            console.log(`✅ Field ${fieldName} updated`);
            return { success: true, message: 'Field updated' };
          }),
          catchError(error => {
            console.error(`Error updating field ${fieldName}:`, error);
            return throwError(() => error);
          })
        );
      })
    );
  }

  // Upload file to Caspio Files API and update Service_EFE record
  uploadFile(serviceId: number, fieldName: string, file: File): Observable<any> {
    return from(this.caspioService.ensureAuthenticated()).pipe(
      switchMap(() => {
        const headers = new HttpHeaders({
          'Authorization': `Bearer ${this.caspioService.getCurrentToken()}`
        });
        
        // Create form data for file upload
        const formData = new FormData();
        const timestamp = Date.now();
        const uniqueFileName = `${timestamp}_${file.name}`;
        formData.append('file', file, uniqueFileName);
        
        // Upload to Caspio Files API
        return this.http.post<any>(`${this.apiBaseUrl}/files`, formData, { headers }).pipe(
          switchMap(fileResponse => {
            // Extract file URL from response
            const fileUrl = fileResponse.Result?.fileUrl || 
                          fileResponse.Result?.Url || 
                          fileResponse.Url || 
                          fileResponse.fileUrl || 
                          uniqueFileName;
            
            console.log(`File uploaded: ${uniqueFileName}, URL: ${fileUrl}`);
            
            // Update Service_EFE record with file URL
            return this.updateField(serviceId, fieldName, fileUrl).pipe(
              map(() => ({
                success: true,
                message: 'File uploaded and linked successfully',
                fileName: uniqueFileName,
                fileUrl: fileUrl
              }))
            );
          }),
          catchError(error => {
            console.error('File upload error:', error);
            // If file already exists, still try to update the field
            if (error.error?.Code === 'FileAlreadyExists') {
              return this.updateField(serviceId, fieldName, file.name).pipe(
                map(() => ({
                  success: true,
                  message: 'File reference updated',
                  fileName: file.name
                }))
              );
            }
            return throwError(() => error);
          })
        );
      })
    );
  }

  // Get Service_EFE record by ServiceID
  getServiceEFE(serviceId: number): Observable<ServiceEFE> {
    return from(this.caspioService.ensureAuthenticated()).pipe(
      switchMap(() => {
        const headers = this.getAuthHeaders();
        return this.http.get<any>(`${this.apiBaseUrl}/tables/Service_EFE/records?q.where=ServiceID=${serviceId}`, { headers }).pipe(
          map(response => {
            if (response.Result && response.Result.length > 0) {
              return response.Result[0];
            }
            throw new Error('Service_EFE record not found');
          })
        );
      })
    );
  }

  // Batch update multiple fields
  updateMultipleFields(serviceId: number, updates: Partial<ServiceEFE>): Observable<any> {
    return from(this.caspioService.ensureAuthenticated()).pipe(
      switchMap(() => {
        const headers = this.getAuthHeaders();
        
        return this.http.put<any>(
          `${this.apiBaseUrl}/tables/Service_EFE/records?q.where=ServiceID=${serviceId}`,
          updates,
          { headers }
        ).pipe(
          map(response => {
            console.log(`✅ Multiple fields updated`);
            return { success: true, message: 'Fields updated' };
          }),
          catchError(error => {
            console.error('Error updating multiple fields:', error);
            return throwError(() => error);
          })
        );
      })
    );
  }

  private getAuthHeaders(): HttpHeaders {
    const token = this.caspioService.getCurrentToken();
    if (!token) {
      throw new Error('No authentication token available');
    }
    return new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    });
  }
}