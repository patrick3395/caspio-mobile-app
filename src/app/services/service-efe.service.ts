import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { CaspioService } from './caspio.service';

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

  constructor(
    private caspioService: CaspioService
  ) {}

  // Check if Service_EFE record exists for a project
  checkServiceEFE(projectId: string): Observable<{exists: boolean, ServiceID?: number, record?: ServiceEFE}> {
    // First get the project to find its ProjectID (not PK_ID)
    return this.caspioService.get<any>(`/tables/LPS_Projects/records?q.where=PK_ID=${projectId}`).pipe(
      switchMap(projectData => {
        if (!projectData.Result || projectData.Result.length === 0) {
          return of({ exists: false });
        }

        const actualProjectId = projectData.Result[0].ProjectID;

        // Now check for Service_EFE record using the actual ProjectID
        return this.caspioService.get<any>(`/tables/LPS_Service_EFE/records?q.where=ProjectID=${actualProjectId}`).pipe(
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
      }),
      catchError(error => {
        console.error('Error checking Service_EFE:', error);
        return of({ exists: false });
      })
    );
  }

  // Create new Service_EFE record
  createServiceEFE(projectPkId: string | number): Observable<ServiceEFE> {
    // First get the actual ProjectID from the Projects table
    return this.caspioService.get<any>(`/tables/LPS_Projects/records?q.where=PK_ID=${projectPkId}`).pipe(
      switchMap(projectData => {
        if (!projectData.Result || projectData.Result.length === 0) {
          return throwError(() => new Error('Project not found'));
        }

        const actualProjectId = projectData.Result[0].ProjectID;
        const data = { ProjectID: actualProjectId };

        return this.caspioService.post<any>(`/tables/LPS_Service_EFE/records`, data).pipe(
          map(response => {
            // Handle response - may be empty for 201 Created
            if (response?.Result && response.Result.length > 0) {
              return response.Result[0] as ServiceEFE;
            }
            return { ProjectID: actualProjectId } as ServiceEFE;
          }),
          catchError(error => {
            console.error('Failed to create Service_EFE record:', error);
            // Check if it's actually a success (201 status)
            if (error.status === 201) {
              return of({ ProjectID: actualProjectId } as ServiceEFE);
            }
            return throwError(() => error);
          })
        );
      })
    );
  }

  // Update Service_EFE record field
  updateField(serviceId: number, fieldName: string, value: any): Observable<any> {
    const updateData: any = {};
    updateData[fieldName] = value;

    return this.caspioService.put<any>(
      `/tables/LPS_Service_EFE/records?q.where=ServiceID=${serviceId}`,
      updateData
    ).pipe(
      map(response => {
        return { success: true, message: 'Field updated' };
      }),
      catchError(error => {
        console.error(`Error updating field ${fieldName}:`, error);
        return throwError(() => error);
      })
    );
  }

  // Upload file to Caspio Files API and update Service_EFE record
  uploadFile(serviceId: number, fieldName: string, file: File): Observable<any> {
    // Create form data for file upload
    const formData = new FormData();
    const timestamp = Date.now();
    const uniqueFileName = `${timestamp}_${file.name}`;
    formData.append('file', file, uniqueFileName);

    // Upload to Caspio Files API via caspioService
    return this.caspioService.post<any>(`/files`, formData).pipe(
      switchMap(fileResponse => {
        // Extract file URL from response
        const fileUrl = fileResponse.Result?.fileUrl ||
                      fileResponse.Result?.Url ||
                      fileResponse.Url ||
                      fileResponse.fileUrl ||
                      uniqueFileName;

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
  }

  // Get Service_EFE record by ServiceID
  getServiceEFE(serviceId: number): Observable<ServiceEFE> {
    return this.caspioService.get<any>(`/tables/LPS_Service_EFE/records?q.where=ServiceID=${serviceId}`).pipe(
      map(response => {
        if (response.Result && response.Result.length > 0) {
          return response.Result[0];
        }
        throw new Error('Service_EFE record not found');
      })
    );
  }

  // Batch update multiple fields
  updateMultipleFields(serviceId: number, updates: Partial<ServiceEFE>): Observable<any> {
    return this.caspioService.put<any>(
      `/tables/LPS_Service_EFE/records?q.where=ServiceID=${serviceId}`,
      updates
    ).pipe(
      map(response => {
        return { success: true, message: 'Fields updated' };
      }),
      catchError(error => {
        console.error('Error updating multiple fields:', error);
        return throwError(() => error);
      })
    );
  }
}
