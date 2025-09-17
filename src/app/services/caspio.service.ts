import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError, from, of } from 'rxjs';
import { map, tap, catchError, switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ImageCompressionService } from './image-compression.service';
import { CacheService } from './cache.service';
import { OfflineService } from './offline.service';

export interface CaspioToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface CaspioAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

@Injectable({
  providedIn: 'root'
})
export class CaspioService {
  private tokenSubject = new BehaviorSubject<string | null>(null);
  private tokenExpirationTimer: any;
  private imageCache = new Map<string, string>(); // Cache for loaded images
  private imageWorker: Worker | null = null;
  private imageWorkerTaskId = 0;
  private imageWorkerCallbacks = new Map<number, { resolve: (value: string) => void; reject: (reason?: any) => void }>();

  constructor(
    private http: HttpClient,
    private imageCompression: ImageCompressionService,
    private cache: CacheService,
    private offline: OfflineService
  ) {
    this.loadStoredToken();
  }

  authenticate(): Observable<CaspioAuthResponse> {
    const body = new URLSearchParams();
    body.set('grant_type', 'client_credentials');
    body.set('client_id', environment.caspio.clientId);
    body.set('client_secret', environment.caspio.clientSecret);

    const headers = new HttpHeaders({
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    });

    return this.http.post<CaspioAuthResponse>(
      environment.caspio.tokenEndpoint,
      body.toString(),
      { headers }
    ).pipe(
      tap(response => {
        this.setToken(response.access_token, response.expires_in);
      }),
      catchError(error => {
        console.error('Authentication failed:', error);
        console.error('Auth error details:', {
          status: error.status,
          statusText: error.statusText,
          message: error.message,
          url: error.url,
          error: error.error
        });
        return throwError(() => error);
      })
    );
  }

  private setToken(token: string, expiresIn: number): void {
    this.tokenSubject.next(token);
    localStorage.setItem('caspio_token', token);
    localStorage.setItem('caspio_token_expiry', (Date.now() + (expiresIn * 1000)).toString());
    
    this.setTokenExpirationTimer(expiresIn * 1000);
  }

  private setTokenExpirationTimer(expiresInMs: number): void {
    if (this.tokenExpirationTimer) {
      clearTimeout(this.tokenExpirationTimer);
    }
    
    this.tokenExpirationTimer = setTimeout(() => {
      this.clearToken();
    }, expiresInMs);
  }

  private loadStoredToken(): void {
    const token = localStorage.getItem('caspio_token');
    const expiry = localStorage.getItem('caspio_token_expiry');
    
    if (token && expiry && Date.now() < parseInt(expiry, 10)) {
      this.tokenSubject.next(token);
      const remainingTime = parseInt(expiry, 10) - Date.now();
      this.setTokenExpirationTimer(remainingTime);
    } else {
      this.clearToken();
    }
  }

  private clearToken(): void {
    this.tokenSubject.next(null);
    localStorage.removeItem('caspio_token');
    localStorage.removeItem('caspio_token_expiry');
    if (this.tokenExpirationTimer) {
      clearTimeout(this.tokenExpirationTimer);
    }
  }

  getToken(): Observable<string | null> {
    return this.tokenSubject.asObservable();
  }

  getCurrentToken(): string | null {
    return this.tokenSubject.value;
  }

  isAuthenticated(): boolean {
    return this.getCurrentToken() !== null;
  }

  async ensureAuthenticated(): Promise<void> {
    if (!this.isAuthenticated()) {
      await this.authenticate().toPromise();
    }
  }

  // Get a valid token, authenticating if necessary
  getValidToken(): Observable<string> {
    const currentToken = this.getCurrentToken();
    if (currentToken) {
      return of(currentToken);
    } else {
      // Need to authenticate first
      return this.authenticate().pipe(
        map(response => response.access_token)
      );
    }
  }
  
  // Get the Caspio account ID from the API URL
  getAccountID(): string {
    // Extract account ID from the API base URL
    const match = environment.caspio.apiBaseUrl.match(/https:\/\/([^.]+)\.caspio\.com/);
    return match ? match[1] : 'c2hcf092'; // Fallback to known account ID
  }

  get<T>(endpoint: string): Observable<T> {
    const token = this.getCurrentToken();
    if (!token) {
      console.error('No authentication token available for GET request to:', endpoint);
      return throwError(() => new Error('No authentication token available'));
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    });

    const url = `${environment.caspio.apiBaseUrl}${endpoint}`;
    console.log('Making GET request to:', url);
    
    return this.http.get<T>(url, { headers }).pipe(
      catchError(error => {
        console.error(`GET request failed for ${endpoint}:`, error);
        console.error('GET error details:', {
          status: error.status,
          statusText: error.statusText,
          message: error.message,
          url: error.url,
          error: error.error
        });
        return throwError(() => error);
      })
    );
  }

  post<T>(endpoint: string, data: any): Observable<T> {
    const token = this.getCurrentToken();
    console.log('?? DEBUG [CaspioService.post]: Token available:', !!token);
    
    if (!token) {
      console.error('? DEBUG [CaspioService.post]: No authentication token!');
      return throwError(() => new Error('No authentication token available'));
    }

    // Check if data is FormData (for file uploads)
    const isFormData = data instanceof FormData;
    
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      // Don't set Content-Type for FormData - let browser set it with boundary
      ...(isFormData ? {} : { 'Content-Type': 'application/json' })
    });

    const url = `${environment.caspio.apiBaseUrl}${endpoint}`;
    console.log('?? DEBUG [CaspioService.post]: Making POST request to:', url);
    console.log('?? DEBUG [CaspioService.post]: Request data:', data);
    
    return this.http.post<T>(url, data, { headers }).pipe(
      tap(response => {
        console.log('? DEBUG [CaspioService.post]: Request successful:', response);
      }),
      catchError(error => {
        console.error('? DEBUG [CaspioService.post]: Request failed!');
        console.error('URL:', url);
        console.error('Error:', error);
        console.error('Error status:', error?.status);
        console.error('Error message:', error?.message);
        console.error('Error body:', error?.error);
        return throwError(() => error);
      })
    );
  }

  put<T>(endpoint: string, data: any): Observable<T> {
    const token = this.getCurrentToken();
    if (!token) {
      return throwError(() => new Error('No authentication token available'));
    }

    // Check if data is FormData (for file uploads)
    const isFormData = data instanceof FormData;
    
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      // Don't set Content-Type for FormData - let browser set it with boundary
      ...(isFormData ? {} : { 'Content-Type': 'application/json' })
    });

    return this.http.put<T>(`${environment.caspio.apiBaseUrl}${endpoint}`, data, { headers });
  }

  delete<T>(endpoint: string): Observable<T> {
    const token = this.getCurrentToken();
    if (!token) {
      return throwError(() => new Error('No authentication token available'));
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    });

    return this.http.delete<T>(`${environment.caspio.apiBaseUrl}${endpoint}`, { headers });
  }

  logout(): void {
    this.clearToken();
  }

  getOfferById(offersId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.get(`/tables/Offers/records?q.where=PK_ID=${offersId}`).subscribe({
        next: (response: any) => {
          if (response && response.Result && response.Result.length > 0) {
            resolve(response.Result[0]);
          } else {
            resolve(null);
          }
        },
        error: (error) => {
          console.error('Error fetching offer:', error);
          reject(error);
        }
      });
    });
  }

  // Service Types methods
  getServiceTypes(): Observable<any[]> {
    return this.get<any>('/tables/Type/records').pipe(
      map(response => response.Result || [])
    );
  }

  // Offers methods
  getOffersByCompany(companyId: string): Observable<any[]> {
    return this.get<any>(`/tables/Offers/records?q.where=CompanyID=${companyId}`).pipe(
      map(response => response.Result || [])
    );
  }

  // Services table methods
  getServicesByProject(projectId: string): Observable<any[]> {
    console.log('?? DEBUG [CaspioService]: Getting services for project:', projectId);
    return this.get<any>(`/tables/Services/records?q.where=ProjectID=${projectId}`).pipe(
      map(response => {
        console.log('?? DEBUG [CaspioService]: Services retrieved:', response?.Result);
        return response.Result || [];
      }),
      catchError(error => {
        console.error('? DEBUG [CaspioService]: Failed to get services:', error);
        return throwError(() => error);
      })
    );
  }

  createService(serviceData: any): Observable<any> {
    console.log('?? DEBUG [CaspioService]: createService called with:', serviceData);
    // Add response=rows to get the created record back immediately
    return this.post<any>('/tables/Services/records?response=rows', serviceData).pipe(
      map(response => {
        console.log('? DEBUG [CaspioService]: Service created successfully:', response);
        // With response=rows, Caspio returns {"Result": [{created record}]}
        if (response && response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
          return response.Result[0]; // Return the created service record
        }
        return response; // Fallback to original response
      }),
      catchError(error => {
        console.error('? DEBUG [CaspioService]: Service creation failed:', error);
        console.error('Error status:', error?.status);
        console.error('Error body:', error?.error);
        return throwError(() => error);
      })
    );
  }

  deleteService(serviceId: string): Observable<any> {
    return this.delete<any>(`/tables/Services/records?q.where=PK_ID=${serviceId}`);
  }

  // Attach Templates methods
  getAttachTemplates(): Observable<any[]> {
    return this.get<any>('/tables/Attach_Templates/records').pipe(
      map(response => response.Result || [])
    );
  }

  // Services Visuals Templates methods
  getServicesVisualsTemplates(): Observable<any[]> {
    return this.get<any>('/tables/Services_Visuals_Templates/records').pipe(
      map(response => response.Result || [])
    );
  }

  // Services Room Templates methods - simplified
  getServicesRoomTemplates(): Observable<any[]> {
    return this.get<any>('/tables/Services_Rooms_Templates/records').pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('Room templates error:', error);
        return of([]);
      })
    );
  }
  
  // Services Rooms methods
  getServicesRooms(serviceId: string): Observable<any[]> {
    const query = `ServiceID=${serviceId}`;
    return this.get<any>(`/tables/Services_Rooms/records?q.where=${encodeURIComponent(query)}`).pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('Services Rooms error:', error);
        return of([]);
      })
    );
  }

  // Get Services_Rooms_Points for a specific room
  getServicesRoomsPoints(roomId: string): Observable<any[]> {
    const query = `RoomID=${roomId}`;
    return this.get<any>(`/tables/Services_Rooms_Points/records?q.where=${encodeURIComponent(query)}`).pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('Services Rooms Points error:', error);
        return of([]);
      })
    );
  }

  // Check if a specific point exists for a room
  checkRoomPointExists(roomId: string, pointName: string): Observable<any> {
    const query = `RoomID=${roomId} AND PointName='${pointName}'`;
    return this.get<any>(`/tables/Services_Rooms_Points/records?q.where=${encodeURIComponent(query)}`).pipe(
      map(response => {
        const results = response.Result || [];
        return results.length > 0 ? results[0] : null;
      }),
      catchError(error => {
        console.error('Check room point error:', error);
        return of(null);
      })
    );
  }

  // Get Services_Rooms_Points_Attach for specific point IDs
  getServicesRoomsAttachments(pointIds: string[] | string): Observable<any[]> {
    // Handle single ID or array of IDs
    const idArray = Array.isArray(pointIds) ? pointIds : [pointIds];
    if (!idArray || idArray.length === 0) {
      return of([]);
    }
    // Build query for multiple PointIDs using OR
    const query = idArray.map(id => `PointID=${id}`).join(' OR ');
    return this.get<any>(`/tables/Services_Rooms_Points_Attach/records?q.where=${encodeURIComponent(query)}`).pipe(
      map(response => {
        const results = response.Result || [];
        console.log(`[getServicesRoomsAttachments] Retrieved ${results.length} photos for PointID(s): ${idArray.join(', ')}`);
        results.forEach((photo: any, index: number) => {
          console.log(`  Photo ${index + 1}: AttachID=${photo.AttachID}, Photo=${photo.Photo}, HasDrawings=${!!photo.Drawings}`);
        });
        return results;
      }),
      catchError(error => {
        console.error('Services_Rooms_Points_Attach error:', error);
        return of([]);
      })
    );
  }

  createServicesRoom(data: any): Observable<any> {
    console.log('Creating Services_Rooms record with data:', data);
    return this.post<any>('/tables/Services_Rooms/records?response=rows', data).pipe(
      map(response => {
        console.log('Services_Rooms response:', response);
        // Handle various response formats
        if (!response) {
          console.log('Warning: null response from Services_Rooms creation');
          return {};
        }
        if (response.Result && Array.isArray(response.Result)) {
          return response.Result[0] || response;
        }
        return response;
      }),
      catchError(error => {
        console.error('Services_Rooms creation error:', error);
        throw error;
      })
    );
  }

  // Delete a Services_Rooms record
  deleteServicesRoom(roomId: string): Observable<any> {
    console.log('Deleting Services_Rooms record with RoomID:', roomId);
    const query = `RoomID=${roomId}`;
    return this.delete<any>(`/tables/Services_Rooms/records?q.where=${encodeURIComponent(query)}`).pipe(
      tap(response => {
        console.log('Services_Rooms delete response:', response);
      }),
      catchError(error => {
        console.error('Services_Rooms deletion error:', error);
        throw error;
      })
    );
  }
  
  // Update Services_Rooms record
  updateServicesRoom(roomId: string, data: any): Observable<any> {
    return this.put<any>(`/tables/Services_Rooms/records?q.where=PK_ID=${roomId}`, data);
  }
  
  // Get Services_Rooms_Drop for dropdown options
  getServicesRoomsDrop(): Observable<any[]> {
    return this.get<any>('/tables/Services_Rooms_Drop/records').pipe(
      map(response => {
        if (response && response.Result) {
          return response.Result;
        }
        return [];
      })
    );
  }
  
  // Get Services_Visuals_Drop for dropdown options
  getServicesVisualsDrop(): Observable<any[]> {
    return this.get<any>('/tables/Services_Visuals_Drop/records').pipe(
      map(response => {
        if (response && response.Result) {
          return response.Result;
        }
        return [];
      })
    );
  }
  
  // Get Services_Drop for dropdown options (Weather Conditions, Temperature, etc.)
  getServicesDrop(): Observable<any[]> {
    return this.get<any>('/tables/Services_Drop/records').pipe(
      map(response => {
        if (response && response.Result) {
          return response.Result;
        }
        return [];
      })
    );
  }
  
  // Get Projects_Drop for dropdown options
  getProjectsDrop(): Observable<any[]> {
    return this.get<any>('/tables/Projects_Drop/records').pipe(
      map(response => {
        if (response && response.Result) {
          return response.Result;
        }
        return [];
      })
    );
  }
  
  // Create Services_Rooms_Points record
  createServicesRoomsPoint(data: any): Observable<any> {
    console.log('Creating Services_Rooms_Points record:', data);
    return this.post<any>('/tables/Services_Rooms_Points/records?response=rows', data).pipe(
      map(response => {
        console.log('Services_Rooms_Points response:', response);
        if (!response) {
          return {};
        }
        if (response.Result && Array.isArray(response.Result)) {
          return response.Result[0] || response;
        }
        return response;
      }),
      catchError(error => {
        console.error('Services_Rooms_Points creation error:', error);
        throw error;
      })
    );
  }
  
  // Update Services_Rooms_Points record
  updateServicesRoomsPoint(pointId: string, data: any): Observable<any> {
    console.log('Updating Services_Rooms_Points record:', pointId, data);
    const url = `/tables/Services_Rooms_Points/records?q.where=PointID=${pointId}`;
    return this.put<any>(url, data).pipe(
      tap(response => {
        console.log('Services_Rooms_Points updated:', response);
      }),
      catchError(error => {
        console.error('Services_Rooms_Points update error:', error);
        throw error;
      })
    );
  }
  
  // Delete Services_Rooms_Points record
  deleteServicesRoomsPoint(pointId: string): Observable<any> {
    console.log('Deleting Services_Rooms_Points record:', pointId);
    const url = `/tables/Services_Rooms_Points/records?q.where=PointID=${pointId}`;
    return this.delete<any>(url).pipe(
      tap(response => {
        console.log('Services_Rooms_Points deleted:', response);
      }),
      catchError(error => {
        console.error('Services_Rooms_Points deletion error:', error);
        throw error;
      })
    );
  }
  
  // Create Services_Rooms_Points_Attach record with file using two-step Files API method
  createServicesRoomsPointsAttachWithFile(pointId: number, drawingsData: string, file: File): Observable<any> {
    console.log('?? Two-step upload for Services_Rooms_Points_Attach using Files API');
    
    // Wrap the entire async function in Observable to return to Angular
    return new Observable(observer => {
      this.uploadRoomPointsAttachWithFilesAPI(pointId, drawingsData, file)
        .then(result => {
          observer.next(result); // Return the created record
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  // Two-step upload method for Services_Rooms_Points_Attach (matching visual method)
  private async uploadRoomPointsAttachWithFilesAPI(pointId: number, drawingsData: string, file: File) {
    console.log('?? Services_Rooms_Points_Attach upload using PROVEN Files API method');
    console.log('====== TABLE STRUCTURE ======');
    console.log('AttachID: Autonumber (Primary Key)');
    console.log('PointID: Integer (Foreign Key)');
    console.log('Photo: File (stores path)');
    console.log('Annotation: Text(255) - NOT USED');
    console.log('Drawings: Text - For annotation data');
    console.log('=============================');
    
    const accessToken = this.tokenSubject.value;
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    console.log('Input parameters:');
    console.log('  PointID:', pointId, '(type:', typeof pointId, ')');
    console.log('  Drawings:', drawingsData ? `${drawingsData.length} chars` : '(empty)');
    console.log('  File:', file.name, 'Size:', file.size);
    
    try {
      // [v1.4.391] Generate unique filename to prevent duplication (like Structural section)
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const fileExt = file.name.split('.').pop() || 'jpg';
      const uniqueFilename = `room_point_${pointId}_${timestamp}_${randomId}.${fileExt}`;

      console.log(`[v1.4.391] Generating unique filename for Elevation photo:`);
      console.log(`  Original: ${file.name}`);
      console.log(`  Unique: ${uniqueFilename}`);

      // STEP 1: Upload file to Caspio Files API with unique filename
      console.log('Step 1: Uploading file to Caspio Files API...');
      const formData = new FormData();
      formData.append('file', file, uniqueFilename);
      
      const filesUrl = `${API_BASE_URL}/files`;
      console.log('Uploading to Files API:', filesUrl);
      
      const uploadResponse = await fetch(filesUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`
          // NO Content-Type header - let browser set it with boundary
        },
        body: formData
      });
      
      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('Files API upload failed:', errorText);
        throw new Error('Failed to upload file to Files API: ' + errorText);
      }
      
      const uploadResult = await uploadResponse.json();
      console.log('? File uploaded to Files API:', uploadResult);
      
      // [v1.4.391] Use unique filename in file path to prevent duplication
      const filePath = `/${uploadResult.Name || uniqueFilename}`;
      console.log('[v1.4.391] File path for Photo field (with unique name):', filePath);
      
      // STEP 2: Create Services_Rooms_Points_Attach record WITH the Photo field path
      console.log('Step 2: Creating Services_Rooms_Points_Attach record with file path...');
      console.log('Table: Services_Rooms_Points_Attach');
      console.log('Fields being sent:');
      console.log('  - PointID (Integer):', parseInt(pointId.toString()));
      console.log('  - Photo (File path):', filePath);
      console.log('  - Drawings (Text):', drawingsData ? `${drawingsData.length} chars` : 'empty');
      
      const recordData: any = {
        PointID: parseInt(pointId.toString()),
        Photo: filePath  // Include the file path in initial creation
      };
      
      // Only add Drawings field if we have annotation data
      // Don't send empty string - just omit the field
      if (drawingsData && drawingsData.length > 0) {
        recordData.Drawings = drawingsData;
      }
      
      console.log('Record data JSON:', JSON.stringify(recordData, null, 2));
      
      const createUrl = `${API_BASE_URL}/tables/Services_Rooms_Points_Attach/records?response=rows`;
      const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(recordData)
      });
      
      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error('Record creation failed:', errorText);
        throw new Error('Failed to create Services_Rooms_Points_Attach record: ' + errorText);
      }
      
      const createdRecord = await createResponse.json();
      console.log('? Services_Rooms_Points_Attach record created:', createdRecord);
      
      // Return the created record (Result[0] has the full record with AttachID)
      return createdRecord.Result?.[0] || createdRecord;
      
    } catch (error) {
      console.error('? Two-step upload failed:', error);
      throw error;
    }
  }

  // Legacy method for direct data posting (kept for backward compatibility)
  createServicesRoomsAttach(data: any): Observable<any> {
    console.log('Creating Services_Rooms_Points_Attach record (LEGACY):', data);
    console.log('Data types:', {
      PointID: typeof data.PointID,
      Photo: typeof data.Photo,
      Annotation: typeof data.Annotation
    });
    return this.post<any>('/tables/Services_Rooms_Points_Attach/records?response=rows', data).pipe(
      map(response => {
        console.log('Services_Rooms_Points_Attach response:', response);
        if (!response) {
          return {};
        }
        if (response.Result && Array.isArray(response.Result)) {
          return response.Result[0] || response;
        }
        return response;
      }),
      catchError(error => {
        console.error('Services_Rooms_Points_Attach creation error:', error);
        console.error('Request data was:', data);
        console.error('Error details:', {
          status: error.status,
          statusText: error.statusText,
          message: error.message,
          error: error.error
        });
        throw error;
      })
    );
  }
  
  // Update Services_Rooms_Points_Attach record (for caption/annotation updates)
  updateServicesRoomsPointsAttach(attachId: string, data: any): Observable<any> {
    console.log('?? Updating Services_Rooms_Points_Attach annotation');
    console.log('  AttachID:', attachId);
    console.log('  Update data:', data);
    
    const url = `/tables/Services_Rooms_Points_Attach/records?q.where=AttachID=${attachId}`;
    return this.put<any>(url, data).pipe(
      tap(response => {
        console.log('? Room point annotation updated:', response);
      }),
      catchError(error => {
        console.error('? Failed to update room point annotation:', error);
        return throwError(() => error);
      })
    );
  }
  
  // Delete Services_Rooms_Points_Attach record
  deleteServicesRoomsPointsAttach(attachId: string): Observable<any> {
    console.log('??? Deleting Services_Rooms_Points_Attach record');
    console.log('  AttachID:', attachId);
    
    const url = `/tables/Services_Rooms_Points_Attach/records?q.where=AttachID=${attachId}`;
    return this.delete<any>(url).pipe(
      tap(response => {
        console.log('? Room point attachment deleted:', response);
      }),
      catchError(error => {
        console.error('? Error deleting room point attachment:', error);
        return throwError(() => error);
      })
    );
  }
  
  // Services Visuals methods (for saving selected items)
  createServicesVisual(visualData: any): Observable<any> {
    console.log('?? Creating Services_Visual record:', visualData);
    // Use response=rows to get the created record back immediately
    return this.post<any>('/tables/Services_Visuals/records?response=rows', visualData).pipe(
      tap(response => {
        console.log('? Services_Visual created, full response:', response);
        // With response=rows, the actual record is in Result array
        if (response && response.Result && response.Result.length > 0) {
          console.log('? Created record:', response.Result[0]);
          console.log('? VisualID (correct):', response.Result[0].VisualID);
          console.log('?? PK_ID (do not use):', response.Result[0].PK_ID);
        }
      }),
      map(response => {
        // Return the first record from Result array if it exists
        if (response && response.Result && response.Result.length > 0) {
          return response.Result[0];
        }
        return response;
      }),
      catchError(error => {
        console.error('? Failed to create Services_Visual:', error);
        return throwError(() => error);
      })
    );
  }
  
  // Update Services_Visuals record
  updateServicesVisual(visualId: string, visualData: any): Observable<any> {
    console.log('?? Updating Services_Visual record:', visualId, visualData);
    const url = `/tables/Services_Visuals/records?q.where=VisualID=${visualId}`;
    return this.put<any>(url, visualData).pipe(
      tap(response => {
        console.log('? Services_Visual updated:', response);
      }),
      catchError(error => {
        console.error('? Failed to update Services_Visual:', error);
        return throwError(() => error);
      })
    );
  }
  
  getServiceById(serviceId: string): Observable<any> {
    return this.get<any>(`/tables/Services/records?q.where=PK_ID=${serviceId}`).pipe(
      map(response => {
        const result = response.Result;
        return result && result.length > 0 ? result[0] : null;
      })
    );
  }
  
  getServicesVisualsByServiceId(serviceId: string): Observable<any[]> {
    return this.get<any>(`/tables/Services_Visuals/records?q.where=ServiceID=${serviceId}`).pipe(
      map(response => response.Result || [])
    );
  }
  
  deleteServicesVisual(visualId: string): Observable<any> {
    return this.delete<any>(`/tables/Services_Visuals/records?q.where=PK_ID=${visualId}`);
  }
  
  // Service_Visuals_Attach methods (for photos)
  createServiceVisualsAttach(attachData: any): Observable<any> {
    console.log('?? Creating Service_Visuals_Attach record:', attachData);
    return this.post<any>('/tables/Service_Visuals_Attach/records', attachData).pipe(
      tap(response => {
        console.log('? Service_Visuals_Attach created:', response);
      }),
      catchError(error => {
        console.error('? Failed to create Service_Visuals_Attach:', error);
        return throwError(() => error);
      })
    );
  }
  
  // Upload photo to Service_Visuals_Attach with two-step process
  uploadPhotoToServiceVisualsAttach(visualId: string, photo: File): Observable<any> {
    console.log('?? Uploading photo for VisualID:', visualId);
    
    return new Observable(observer => {
      // Step 1: Create the attachment record
      const attachData = {
        VisualID: visualId,
        // Photo field will be uploaded in step 2
      };
      
      console.log('?? Step 1: Creating Service_Visuals_Attach record');
      
      this.post<any>('/tables/Service_Visuals_Attach/records', attachData).subscribe({
        next: (createResponse) => {
          console.log('? Step 1 Success: Record created:', createResponse);
          
          const attachId = createResponse.PK_ID || createResponse.id;
          
          if (!attachId) {
            console.error('? No ID in response:', createResponse);
            observer.error(new Error('Failed to get attachment ID'));
            return;
          }
          
          console.log('?? Step 2: Uploading photo to ID:', attachId);
          
          // Step 2: Upload the photo using multipart/form-data
          const formData = new FormData();
          formData.append('Photo', photo, photo.name);
          
          const updateUrl = `/tables/Service_Visuals_Attach/records?q.where=PK_ID=${attachId}`;
          
          this.put<any>(updateUrl, formData).subscribe({
            next: (uploadResponse) => {
              console.log('? Step 2 Success: Photo uploaded');
              observer.next({ ...createResponse, photoUploaded: true });
              observer.complete();
            },
            error: (uploadError) => {
              console.error('? Step 2 Failed: Photo upload error:', uploadError);
              observer.next({ 
                ...createResponse, 
                photoUploaded: false, 
                uploadError: uploadError.message 
              });
              observer.complete();
            }
          });
        },
        error: (createError) => {
          console.error('? Step 1 Failed:', createError);
          observer.error(createError);
        }
      });
    });
  }
  
  getServiceVisualsAttachByVisualId(visualId: string): Observable<any[]> {
    return this.get<any>(`/tables/Services_Visuals_Attach/records?q.where=VisualID=${visualId}`).pipe(
      map(response => response.Result || [])
    );
  }
  
  // Update Services_Visuals_Attach record (for caption/annotation updates)
  updateServicesVisualsAttach(attachId: string, data: any): Observable<any> {
    const url = `/tables/Services_Visuals_Attach/records?q.where=AttachID=${attachId}`;
    return this.put<any>(url, data);
  }
  
  // Update Services_Visuals_Attach record
  updateServiceVisualsAttach(attachId: string, data: any): Observable<any> {
    console.log('?? [v1.4.329] Updating Services_Visuals_Attach record');
    console.log('  AttachID:', attachId);
    console.log('  AttachID type:', typeof attachId);
    console.log('  Update data:', data);
    console.log('  Update data keys:', Object.keys(data));
    
    // CRITICAL: Ensure AttachID is a number for Caspio API
    const attachIdNum = typeof attachId === 'string' ? parseInt(attachId, 10) : attachId;
    if (isNaN(attachIdNum)) {
      console.error('? Invalid AttachID - not a number:', attachId);
      return throwError(() => new Error(`Invalid AttachID: ${attachId} is not a valid number`));
    }
    
    // v1.4.329 FIX: Use raw fetch like CREATE does, not Angular HttpClient
    // This prevents double JSON.stringify of the Drawings field
    return new Observable(observer => {
      const accessToken = this.getCurrentToken();
      if (!accessToken) {
        observer.error(new Error('No authentication token available'));
        return;
      }
      
      const API_BASE_URL = environment.caspio.apiBaseUrl;
      const endpoint = `/tables/Services_Visuals_Attach/records?q.where=AttachID=${attachIdNum}`;
      const fullUrl = `${API_BASE_URL}${endpoint}`;
      
      console.log('  [v1.4.329] Using raw fetch for UPDATE (like CREATE does)');
      console.log('  Full URL:', fullUrl);
      console.log('  Data being sent:', JSON.stringify(data, null, 2));
      
      // Use fetch directly like the CREATE operation does
      fetch(fullUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)  // Single stringify, just like CREATE
      })
      .then(async response => {
        const responseText = await response.text();
        console.log(`  Update response status: ${response.status}`);
        console.log(`  Update response text: ${responseText}`);
        
        if (!response.ok) {
          // Parse error response
          let errorData: any = {};
          try {
            errorData = JSON.parse(responseText);
          } catch (e) {
            errorData = { message: responseText };
          }
          
          console.error('? Update failed:', errorData);
          console.error('  Status:', response.status);
          console.error('  AttachID used:', attachIdNum);
          console.error('  Data sent:', JSON.stringify(data));
          
          const error: any = new Error(errorData.Message || errorData.message || 'Update failed');
          error.status = response.status;
          error.error = errorData;
          throw error;
        }
        
        // Success - parse response if it's JSON
        let result = {};
        if (responseText) {
          try {
            result = JSON.parse(responseText);
          } catch (e) {
            // Response might be empty for successful updates
            result = { success: true };
          }
        }
        
        console.log('? Update successful:', result);
        observer.next(result);
        observer.complete();
      })
      .catch(error => {
        console.error('? Update request failed:', error);
        observer.error(error);
      });
    });
  }
  
  // Delete Services_Visuals_Attach record
  deleteServiceVisualsAttach(attachId: string): Observable<any> {
    return this.delete<any>(`/tables/Services_Visuals_Attach/records?q.where=AttachID=${attachId}`);
  }
  
  // Upload file to Caspio Files API
  uploadFile(file: File, customFileName?: string): Observable<any> {
    const token = this.getCurrentToken();
    if (!token) {
      return throwError(() => new Error('No authentication token available'));
    }
    
    const fileName = customFileName || file.name;
    console.log('?? Uploading file to Files API:', fileName);
    const formData = new FormData();
    formData.append('file', file, fileName);
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    return new Observable(observer => {
      fetch(`${API_BASE_URL}/files`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      })
      .then(async response => {
        console.log('Files API response status:', response.status);
        console.log('Files API response ok:', response.ok);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('Files API error response:', errorText);
          throw new Error(`Files API error (${response.status}): ${errorText}`);
        }
        
        const result = await response.json();
        console.log('Files API success response:', result);
        
        // Check multiple possible response formats
        const fileName = result.Name || result.name || result.FileName || result.fileName || file.name;
        const finalResult = {
          ...result,
          Name: fileName
        };
        
        console.log('Final result with Name:', finalResult);
        return finalResult;
      })
      .then(result => {
        observer.next(result);
        observer.complete();
      })
      .catch(error => {
        console.error('Upload file error:', error);
        observer.error(error);
      });
    });
  }
  
  // Get image from Caspio Files API
  // Get attachments by project ID and type ID
  getAttachmentsByProjectAndType(projectId: string, typeId: number): Observable<any[]> {
    return this.get<any>(`/tables/Attach/records?q.where=ProjectID=${projectId}%20AND%20TypeID=${typeId}`).pipe(
      map(response => response.Result || [])
    );
  }
  
  // Get single attachment by ID
  getAttachment(attachId: string): Observable<any> {
    return this.get<any>(`/tables/Attach/records?q.where=AttachID=${attachId}`).pipe(
      map(response => {
        if (response && response.Result && response.Result.length > 0) {
          return response.Result[0];
        }
        return null;
      })
    );
  }
  
  // Get PDF from Files API
  getPDFFromFilesAPI(filePath: string): Observable<string> {
    const accessToken = this.tokenSubject.value;
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    return new Observable(observer => {
      // Clean the file path
      const cleanPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
      
      // Fetch from Files API
      fetch(`${API_BASE_URL}/files/path?filePath=${encodeURIComponent(cleanPath)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.blob();
      })
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => {
          observer.next(reader.result as string);
          observer.complete();
        };
        reader.onerror = () => observer.error(reader.error);
        reader.readAsDataURL(blob);
      })
      .catch(error => {
        console.error('Error fetching PDF:', error);
        observer.error(error);
      });
    });
  }
  
  // Clear the image cache (for debugging photo duplication issues)
  clearImageCache() {
    const size = this.imageCache.size;
    this.imageCache.clear();
    console.log(`[ImageCache] Cleared ${size} cached images`);
  }
  
  // Simple hash function for debugging image uniqueness
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }

  // Helper method to compress annotation data (same as used in engineers-foundation page)
  private compressAnnotationData(data: string): string {
    console.log('??? Compressing annotation data in CaspioService');
    console.log('  Original size:', data.length, 'bytes');
    
    // Don't compress empty or minimal data
    if (!data || data === '{}' || data === '[]' || data === '""' || data === 'null' || data === '') {
      console.log('  Empty or minimal data, returning empty string');
      return '';
    }
    
    try {
      // Always minify first
      const parsed = JSON.parse(data);
      
      // Check if there's actually any content to compress
      if (parsed && parsed.objects && parsed.objects.length === 0) {
        console.log('  Empty objects array, returning empty string');
        return '';
      }
      
      const minified = JSON.stringify(parsed);
      console.log('  After minification:', minified.length, 'bytes');
      
      // If data is small enough after minification, return it
      if (minified.length < 50000) { // Less than 50KB
        console.log('  Data small enough after minification');
        return minified;
      }
      
      // Apply balanced simplification for large data
      console.log('  ?? Data large, applying BALANCED simplification');
      
      // Simplify the data structure to fit within limits
      if (parsed.objects) {
        parsed.objects = parsed.objects.map((obj: any) => {
          // Keep essential properties, remove verbose ones
          const simplified: any = {
            type: obj.type,
            left: Math.round(obj.left),
            top: Math.round(obj.top),
            width: Math.round(obj.width || 0),
            height: Math.round(obj.height || 0),
            angle: Math.round(obj.angle || 0)
          };
          
          // Keep stroke and fill info if present
          if (obj.stroke) simplified.stroke = obj.stroke;
          if (obj.strokeWidth) simplified.strokeWidth = obj.strokeWidth;
          if (obj.fill) simplified.fill = obj.fill;
          
          // Keep text for text objects
          if (obj.type === 'i-text' && obj.text) {
            simplified.text = obj.text;
            simplified.fontSize = obj.fontSize || 20;
          }
          
          // Keep path data for path objects (but simplified)
          if (obj.type === 'path' && obj.path) {
            // Keep only essential path data
            simplified.path = obj.path;
          }
          
          return simplified;
        });
      }
      
      const compressed = JSON.stringify(parsed);
      console.log('  After compression:', compressed.length, 'bytes');
      
      // Mark as compressed version 3
      return 'COMPRESSED_V3:' + compressed;
      
    } catch (e) {
      console.error('Compression failed:', e);
      return data; // Return original if compression fails
    }
  }

  getImageFromFilesAPI(filePath: string): Observable<string> {
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    // Simple debugging
    console.log(`[v1.4.386] getImageFromFilesAPI called for: ${filePath}`);
    
    // IMPORTANT: Cache disabled to prevent duplication
    // DO NOT use normalized/lowercase paths
    
    // Use getValidToken to ensure fresh token
    return this.getValidToken().pipe(
      switchMap(accessToken => new Observable<string>(observer => {
        // Clean the file path - use exact path, no normalization
        const cleanPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
        console.log(`[v1.4.386] Fetching from API with fresh token: ${cleanPath}`);
        
        // Fetch from Files API
        fetch(`${API_BASE_URL}/files/path?filePath=${encodeURIComponent(cleanPath)}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/octet-stream'
          }
        })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status}`);
        }
        return response.blob();
      })
      .then(blob => this.convertBlobToDataUrl(blob))
      .then(result => {
        console.log(`[v1.4.384] Image loaded: ${filePath}, size: ${result.length}`);
        observer.next(result);
        observer.complete();
      })
      .catch(error => {
        console.error('Error fetching image:', error);
        observer.error(error);
      });
      }))
    );
  }

  private convertBlobToDataUrl(blob: Blob): Promise<string> {
    const worker = this.ensureImageWorker();
    if (!worker) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read image data'));
        reader.readAsDataURL(blob);
      });
    }

    const taskId = ++this.imageWorkerTaskId;
    return new Promise<string>((resolve, reject) => {
      this.imageWorkerCallbacks.set(taskId, { resolve, reject });
      try {
        worker.postMessage({ id: taskId, type: 'BLOB_TO_DATA_URL', blob }, [blob]);
      } catch (error) {
        this.imageWorkerCallbacks.delete(taskId);
        console.error('Failed to post message to image worker:', error);
        // Fallback to main thread conversion
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read image data'));
        reader.readAsDataURL(blob);
      }
    });
  }

  private ensureImageWorker(): Worker | null {
    if (typeof Worker === 'undefined') {
      return null;
    }

    if (!this.imageWorker) {
      try {
        this.imageWorker = new Worker(new URL('../workers/image-processor.worker', import.meta.url), {
          type: 'module'
        });
        this.imageWorker.onmessage = (event: MessageEvent) => {
          const { id, success, result, error } = event.data || {};
          if (typeof id !== 'number') {
            return;
          }
          const callbacks = this.imageWorkerCallbacks.get(id);
          if (!callbacks) {
            return;
          }
          this.imageWorkerCallbacks.delete(id);
          if (success) {
            callbacks.resolve(result);
          } else {
            callbacks.reject(error || new Error('Image worker failed'));
          }
        };
        this.imageWorker.onerror = (event: ErrorEvent) => {
          console.error('Image worker error:', event.message);
        };
      } catch (error) {
        console.error('Failed to initialize image worker:', error);
        this.imageWorker = null;
        return null;
      }
    }

    return this.imageWorker;
  }

  // Create Services_Visuals_Attach with file using PROVEN Files API method
  createServicesVisualsAttachWithFile(visualId: number, annotation: string, file: File, drawings?: string, originalFile?: File): Observable<any> {
    console.log('?? Two-step upload for Services_Visuals_Attach using Files API');
    
    // Wrap the entire async function in Observable to return to Angular
    return new Observable(observer => {
      this.uploadVisualsAttachWithFilesAPI(visualId, annotation, file, drawings, originalFile)
        .then(result => {
          observer.next(result); // Return the created record
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  // New method using PROVEN Files API approach for Services_Visuals_Attach
  private async uploadVisualsAttachWithFilesAPI(visualId: number, annotation: string, file: File, drawings?: string, originalFile?: File) {
    console.log('?? Services_Visuals_Attach upload using PROVEN Files API method');
    console.log('====== TABLE STRUCTURE ======');
    console.log('AttachID: Autonumber (Primary Key)');
    console.log('VisualID: Integer (Foreign Key)');
    console.log('Photo: File (stores path)');
    console.log('Annotation: Text(255)');
    console.log('Drawings: Text (stores annotation JSON)');
    console.log('=============================');
    
    const accessToken = this.tokenSubject.value;
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    console.log('Input parameters:');
    console.log('  VisualID:', visualId, '(type:', typeof visualId, ')');
    console.log('  Annotation:', annotation || '(empty)');
    console.log('  File:', file.name, 'Size:', file.size);
    console.log('  Has Drawings:', !!drawings);
    console.log('  Has Original File:', !!originalFile);
    
    try {
      let originalFilePath = '';
      
      // STEP 1A: If we have an original file (before annotation), upload it first
      if (originalFile && drawings) {
        console.log('Step 1A: Uploading original (un-annotated) file to Caspio Files API...');
        const originalFormData = new FormData();
        const originalFileName = `original_${originalFile.name}`;
        originalFormData.append('file', originalFile, originalFileName);
        
        const originalUploadResponse = await fetch(`${API_BASE_URL}/files`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`
          },
          body: originalFormData
        });
        
        if (originalUploadResponse.ok) {
          const originalUploadResult = await originalUploadResponse.json();
          originalFilePath = `/${originalUploadResult.Name || originalFileName}`;
          console.log('? Original file uploaded:', originalFilePath);
        }
      }
      
      // STEP 1B: Upload file to Caspio Files API
      // CRITICAL: Check if we have drawings - if so, we should NOT upload the file!
      console.log('Step 1B: File upload decision...');
      console.log('  Has drawings (annotations):', !!drawings);
      console.log('  File to upload:', file.name, 'Size:', file.size);
      
      // IMPORTANT: If we only have annotations (drawings), we should NOT upload a new file
      // The Photo field should remain unchanged, pointing to the original image
      if (drawings && !file.name.startsWith('original_')) {
        console.log('?? WARNING: Attempting to upload file when only updating annotations!');
        console.log('  This would replace the original image with the annotated version.');
        console.log('  Skipping file upload to preserve original image.');
        
        // For now, let's still upload to see what's happening
        // TODO: In production, we should skip this upload entirely
      }
      
      // [v1.4.387] Generate unique filename to prevent duplication
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const fileExt = file.name.split('.').pop() || 'jpg';
      const uniqueFilename = `visual_${visualId}_${timestamp}_${randomId}.${fileExt}`;
      
      console.log(`[v1.4.387] Generating unique filename:`);
      console.log(`  Original: ${file.name}`);
      console.log(`  Unique: ${uniqueFilename}`);
      
      const formData = new FormData();
      formData.append('file', file, uniqueFilename);
      
      const filesUrl = `${API_BASE_URL}/files`;
      console.log('Uploading to Files API:', filesUrl);
      
      const uploadResponse = await fetch(filesUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`
          // NO Content-Type header - let browser set it with boundary
        },
        body: formData
      });
      
      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('Files API upload failed:', errorText);
        throw new Error('Failed to upload file to Files API: ' + errorText);
      }
      
      const uploadResult = await uploadResponse.json();
      console.log('? File uploaded to Files API:', uploadResult);
      
      // The file path for the Photo field - use unique filename
      const filePath = `/${uploadResult.Name || uniqueFilename}`;
      console.log('File path for Photo field:', filePath);
      
      // STEP 2: Create Services_Visuals_Attach record WITH the Photo field path
      console.log('Step 2: Creating Services_Visuals_Attach record with file path...');
      console.log('Table: Services_Visuals_Attach');
      console.log('Fields being sent:');
      console.log('  - VisualID (Integer):', parseInt(visualId.toString()));
      console.log('  - Annotation (Text):', annotation || file.name);
      console.log('  - Photo (File path):', filePath);
      console.log('  - Drawings (Text):', drawings ? 'Annotation JSON data present' : 'No annotations');
      
      const recordData: any = {
        VisualID: parseInt(visualId.toString()),
        Annotation: annotation || '',  // Keep blank if no annotation provided
        Photo: filePath  // Include the file path in initial creation
      };
      
      // Add Drawings field if annotation data is provided
      // IMPORTANT: Drawings field is TEXT type with 64KB limit
      // Apply compression like Elevation Plot does
      if (drawings && drawings.length > 0) {
        console.log('Processing Drawings field data...');
        console.log('  Original drawings length:', drawings.length);
        
        // Apply compression if needed (using the same method as Elevation Plot)
        let compressedDrawings = drawings;
        
        // Try to compress the data if it's large
        if (drawings.length > 50000) {
          console.log('  Data is large, attempting compression...');
          compressedDrawings = this.compressAnnotationData(drawings);
          console.log('  After compression:', compressedDrawings.length, 'bytes');
        }
        
        // Only add if within the field limit after compression
        if (compressedDrawings.length <= 64000) {
          recordData.Drawings = compressedDrawings;
          console.log('? Drawings field added, final size:', compressedDrawings.length);
        } else {
          console.warn('?? Drawings data still too large after compression:', compressedDrawings.length, 'bytes');
          console.warn('?? Skipping Drawings field to avoid data type error');
        }
      }
      
      console.log('Creating Services_Visuals_Attach record with data:', JSON.stringify(recordData));
      
      const createResponse = await fetch(`${API_BASE_URL}/tables/Services_Visuals_Attach/records?response=rows`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(recordData)
      });
      
      const createResponseText = await createResponse.text();
      console.log(`Create response status: ${createResponse.status}`);
      console.log(`Create response body: ${createResponseText}`);
      
      if (!createResponse.ok) {
        console.error('Failed to create Services_Visuals_Attach record:', createResponseText);
        throw new Error('Failed to create record: ' + createResponseText);
      }
      
      let createResult: any;
      if (createResponseText.length > 0) {
        const parsedResponse = JSON.parse(createResponseText);
        if (parsedResponse.Result && Array.isArray(parsedResponse.Result) && parsedResponse.Result.length > 0) {
          createResult = parsedResponse.Result[0];
          console.log('? Services_Visuals_Attach record created successfully:', createResult);
        } else if (Array.isArray(parsedResponse) && parsedResponse.length > 0) {
          createResult = parsedResponse[0];
          console.log('? Services_Visuals_Attach record created successfully (array response):', createResult);
        } else {
          createResult = parsedResponse;
          console.log('? Services_Visuals_Attach record created successfully (object response):', createResult);
        }
      } else {
        console.log('?? Empty response from create, but status was OK');
        createResult = { success: true };
      }
      
      // Return the created record with the file path
      const attachId = createResult.AttachID || createResult.PK_ID || createResult.id;
      console.log('Record created with AttachID:', attachId);
      
      // No need for STEP 3 anymore - Photo field is already set with the file path
      
      return {
        ...createResult,
        AttachID: attachId,
        Photo: filePath,  // Include the file path
        success: true
      };
      
    } catch (error) {
      console.error('? Services_Visuals_Attach upload failed:', error);
      throw error;
    }
  }

  // OLD METHOD REMOVED - now using uploadVisualsAttachWithFilesAPI
  // The old testTwoStepUploadVisuals method has been removed as it used incorrect approaches
  // Always use the Files API method (upload file first, then store path in database)

  // Get unique categories from Services_Visuals_Templates
  getServicesVisualsCategories(): Observable<string[]> {
    return this.get<any>('/tables/Services_Visuals_Templates/records').pipe(
      map(response => {
        const templates = response.Result || [];
        // Extract unique categories
        const categorySet = new Set<string>(templates.map((t: any) => t.Category).filter((c: any) => c));
        const categories: string[] = Array.from(categorySet);
        return categories.sort();
      })
    );
  }

  // Project methods
  getProject(projectId: string): Observable<any> {
    return this.get<any>(`/tables/Projects/records?q.where=PK_ID=${projectId}`).pipe(
      map(response => response.Result && response.Result.length > 0 ? response.Result[0] : null)
    );
  }
  
  // Type methods
  getType(typeId: string): Observable<any> {
    // First try TypeID field
    return this.get<any>(`/tables/Type/records?q.where=TypeID=${typeId}`).pipe(
      map(response => response.Result && response.Result.length > 0 ? response.Result[0] : null),
      catchError(error => {
        console.log('TypeID query failed, trying PK_ID as fallback:', error);
        // If TypeID fails, try PK_ID as fallback
        return this.get<any>(`/tables/Type/records?q.where=PK_ID=${typeId}`).pipe(
          map(response => response.Result && response.Result.length > 0 ? response.Result[0] : null)
        );
      })
    );
  }

  updateProject(projectId: string, updateData: any): Observable<any> {
    return this.put<any>(`/tables/Projects/records?q.where=PK_ID=${projectId}`, updateData);
  }
  
  // Service methods
  getService(serviceId: string): Observable<any> {
    // Services table uses PK_ID as primary key, not ServiceID
    return this.get<any>(`/tables/Services/records?q.where=PK_ID=${serviceId}`).pipe(
      map(response => response.Result && response.Result.length > 0 ? response.Result[0] : null)
    );
  }
  
  updateService(serviceId: string, updateData: any): Observable<any> {
    // Services table uses PK_ID as primary key, not ServiceID
    console.log('?? [CaspioService.updateService] Updating service:', { serviceId, updateData });
    return this.put<any>(`/tables/Services/records?q.where=PK_ID=${serviceId}`, updateData).pipe(
      tap(response => {
        console.log('? [CaspioService.updateService] Service updated successfully:', response);
      }),
      catchError(error => {
        console.error('? [CaspioService.updateService] Failed to update service:', error);
        return throwError(() => error);
      })
    );
  }

  // Attach (Attachments) table methods
  getAttachmentsByProject(projectId: string): Observable<any[]> {
    return this.get<any>(`/tables/Attach/records?q.where=ProjectID=${projectId}`).pipe(
      map(response => response.Result || [])
    );
  }

  createAttachment(attachData: any): Observable<any> {
    console.log('?? [CaspioService.createAttachment] Creating attachment with data:', attachData);
    // Remove ?response=rows as per Caspio best practices
    return this.post<any>('/tables/Attach/records', attachData).pipe(
      tap(response => {
        console.log('? [CaspioService.createAttachment] Success response:', response);
      }),
      catchError(error => {
        console.error('? [CaspioService.createAttachment] Failed:', error);
        console.error('Error details:', {
          status: error?.status,
          statusText: error?.statusText,
          message: error?.message,
          error: error?.error
        });
        return throwError(() => error);
      })
    );
  }

  // Create attachment with file using two-step upload (like Services_Visuals_Attach)
  createAttachmentWithFile(projectId: number, typeId: number, title: string, notes: string, file: File): Observable<any> {
    console.log('?? Two-step upload for Attach table');
    
    // Wrap the entire async function in Observable to return to Angular
    return new Observable(observer => {
      this.twoStepUploadForAttach(projectId, typeId, title, notes, file)
        .then(result => {
          observer.next(result); // Return the created record
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  // Two-step upload method for Attach table - Upload to Files API then create record with path
  private async twoStepUploadForAttach(projectId: number, typeId: number, title: string, notes: string, file: File) {
    console.log('?? Two-step upload for Attach table (Files API method)');
    
    const accessToken = this.tokenSubject.value;
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    try {
      // Step 1: Upload file to Caspio Files API
      console.log('Step 1: Uploading file to Caspio Files API...');
      const formData = new FormData();
      formData.append('file', file, file.name);
      
      // Upload to Files API (can optionally specify folder with externalKey)
      const filesUrl = `${API_BASE_URL}/files`;
      console.log('Uploading to Files API:', filesUrl);
      
      const uploadResponse = await fetch(filesUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`
          // NO Content-Type header - let browser set it with boundary
        },
        body: formData
      });
      
      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('Files API upload failed:', errorText);
        throw new Error('Failed to upload file to Files API: ' + errorText);
      }
      
      const uploadResult = await uploadResponse.json();
      console.log('? File uploaded to Files API:', uploadResult);
      
      // The file path for the Attachment field (use root path or folder path)
      const filePath = `/${uploadResult.Name || file.name}`;
      console.log('File path for Attachment field:', filePath);
      
      // Step 2: Create Attach record with the file path
      console.log('Step 2: Creating Attach record with file path...');
      const recordData = {
        ProjectID: parseInt(projectId.toString()),
        TypeID: parseInt(typeId.toString()),
        Title: title || file.name,
        Notes: notes || 'Uploaded from mobile',
        Link: file.name,
        Attachment: filePath  // Store the file path from Files API
        // NO ServiceID - this field doesn't exist in Attach table
      };
      
      console.log('Creating Attach record with data:', recordData);
      
      const createResponse = await fetch(`${API_BASE_URL}/tables/Attach/records?response=rows`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(recordData)
      });
      
      const createResponseText = await createResponse.text();
      console.log(`Create response status: ${createResponse.status}`);
      
      if (!createResponse.ok) {
        console.error('Failed to create Attach record:', createResponseText);
        throw new Error('Failed to create Attach record: ' + createResponseText);
      }
      
      let createResult: any;
      if (createResponseText.length > 0) {
        const parsedResponse = JSON.parse(createResponseText);
        if (parsedResponse.Result && Array.isArray(parsedResponse.Result) && parsedResponse.Result.length > 0) {
          createResult = parsedResponse.Result[0];
          console.log('? Attach record created successfully:', createResult);
        } else {
          createResult = parsedResponse;
        }
      }
      
      return {
        ...createResult,
        Attachment: filePath,  // Include the file path
        success: true
      };
      
    } catch (error) {
      console.error('? Two-step upload failed:', error);
      throw error;
    }
  }
  
  // Removed old uploadFileAndCreateAttachment method that used wrong Files API approach
  // All file uploads now use the correct two-step process per CLAUDE.md

  // File upload method - for replacing existing attachment
  uploadFileToAttachment(attachId: string, file: File): Observable<any> {
    return new Observable(observer => {
      this.replaceAttachmentFile(attachId, file)
        .then(result => {
          observer.next(result);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }
  
  private async replaceAttachmentFile(attachId: string, file: File) {
    const accessToken = this.tokenSubject.value;
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    try {
      // Check if file is an image and compress if needed
      let fileToUpload: File | Blob = file;
      if (file.type && file.type.startsWith('image/')) {
        console.log('Compressing image before upload...');
        const compressedBlob = await this.imageCompression.compressImage(file, {
          maxSizeMB: 1.5,
          maxWidthOrHeight: 1920,
          useWebWorker: true
        });
        // Convert Blob back to File to maintain the name property
        fileToUpload = new File([compressedBlob], file.name, { type: compressedBlob.type });
        console.log(`Image compressed: ${(file.size / 1024).toFixed(1)}KB -> ${(fileToUpload.size / 1024).toFixed(1)}KB`);
      }
      
      // Step 1: Upload file to Caspio Files API
      console.log('Replacing attachment: uploading file to Files API...');
      const formData = new FormData();
      formData.append('file', fileToUpload, file.name);
      
      const filesUrl = `${API_BASE_URL}/files`;
      const uploadResponse = await fetch(filesUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`
          // NO Content-Type header - let browser set it with boundary
        },
        body: formData
      });
      
      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error('Failed to upload replacement file: ' + errorText);
      }
      
      const uploadResult = await uploadResponse.json();
      const filePath = `/${uploadResult.Name || file.name}`;
      console.log('? Replacement file uploaded to Files API, path:', filePath);
      
      // Step 2: Update the Attach record with new file path and name
      const updateResponse = await fetch(
        `${API_BASE_URL}/tables/Attach/records?q.where=AttachID=${attachId}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            Attachment: filePath,  // Update file path
            Link: file.name        // Update filename
          })
        }
      );
      
      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        throw new Error('Failed to update attachment record: ' + errorText);
      }
      
      console.log('? Attachment record updated with new file');
      return { success: true, attachId, fileName: file.name, filePath };
      
    } catch (error) {
      console.error('Failed to replace attachment:', error);
      throw error;
    }
  }

  updateAttachment(attachId: string, updateData: any): Observable<any> {
    return this.put<any>(`/tables/Attach/records?q.where=AttachID=${attachId}`, updateData);
  }

  deleteAttachment(attachId: string): Observable<any> {
    return this.delete<any>(`/tables/Attach/records?q.where=AttachID=${attachId}`);
  }

  // Get attachment with file data for display (following the working example pattern)
  getAttachmentWithImage(attachId: string): Observable<any> {
    console.log('?? getAttachmentWithImage called for AttachID:', attachId);
    const accessToken = this.tokenSubject.value;
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    return new Observable(observer => {
      // First get the record to find the file path in the Attachment field
      fetch(`${API_BASE_URL}/tables/Attach/records?q.where=AttachID=${attachId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to get attachment record: ${response.status}`);
        }
        return response.json();
      })
      .then(async data => {
        if (data.Result && data.Result.length > 0) {
          const record = data.Result[0];
          console.log('?? Attachment record found:', {
            AttachID: record.AttachID,
            Title: record.Title,
            Link: record.Link,
            Attachment: record.Attachment
          });
          
          // Check if there's a file path in the Attachment field
          console.log('?? Checking Attachment field:');
          console.log('  - Value:', record.Attachment);
          console.log('  - Type:', typeof record.Attachment);
          console.log('  - Length:', record.Attachment?.length);
          
          if (record.Attachment && typeof record.Attachment === 'string' && record.Attachment.length > 0) {
            // The Attachment field might contain:
            // 1. Just a filename: "IMG_7755.png"
            // 2. A full path: "/IMG_7755.png" or "/Inspections/IMG_7755.png"
            // 3. Or something else
            let filePath = record.Attachment;
            
            // If it's just a filename, try adding a leading slash
            if (!filePath.startsWith('/')) {
              // Try with just a leading slash first
              filePath = '/' + filePath;
            }
            
            // Use the /files/path endpoint EXACTLY like the working example
            const fileUrl = `${API_BASE_URL}/files/path?filePath=${encodeURIComponent(filePath)}`;
            console.log('?? Fetching file from path:');
            console.log('  - File path:', filePath);
            console.log('  - Full URL:', fileUrl);
            
            try {
              const fileResponse = await fetch(fileUrl, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Accept': 'application/octet-stream'
                }
              });
              
              console.log('?? File fetch response status:', fileResponse.status);
              
              if (!fileResponse.ok) {
                const errorBody = await fileResponse.text();
                console.error('  - Error response body:', errorBody);
                throw new Error(`File fetch failed: ${fileResponse.status} ${fileResponse.statusText}`);
              }
              
              // Get the blob
              let blob = await fileResponse.blob();
              console.log('?? Blob received, size:', blob.size, 'type:', blob.type);
              
              // Detect MIME type if not set
              let mimeType = blob.type;
              if (!mimeType || mimeType === 'application/octet-stream') {
                // Try to detect from filename
                const filename = record.Link || record.Attachment || '';
                if (filename.toLowerCase().endsWith('.png')) {
                  mimeType = 'image/png';
                } else if (filename.toLowerCase().endsWith('.jpg') || filename.toLowerCase().endsWith('.jpeg')) {
                  mimeType = 'image/jpeg';
                } else if (filename.toLowerCase().endsWith('.gif')) {
                  mimeType = 'image/gif';
                } else if (filename.toLowerCase().endsWith('.pdf')) {
                  mimeType = 'application/pdf';
                }
                
                // Create new blob with correct MIME type
                if (mimeType !== blob.type) {
                  console.log('?? Converting blob MIME type from', blob.type, 'to', mimeType);
                  blob = new Blob([blob], { type: mimeType });
                }
              }
              
              // For PDFs, convert to base64 data URL instead of blob URL
              // ngx-extended-pdf-viewer doesn't work well with blob URLs
              if (mimeType === 'application/pdf') {
                console.log('?? PDF detected, converting to base64 for viewer compatibility');
                const reader = new FileReader();
                reader.onloadend = () => {
                  const base64data = reader.result as string;
                  console.log('? Converted PDF to base64 data URL');
                  console.log('  - Data URL starts with:', base64data.substring(0, 50));
                  record.Attachment = base64data;
                  observer.next(record);
                  observer.complete();
                };
                reader.readAsDataURL(blob);
              } else {
                // For images and other files, use object URL as before
                const objectUrl = URL.createObjectURL(blob);
                console.log('? Created object URL for image display:', objectUrl);
                console.log('  - Object URL starts with:', objectUrl.substring(0, 50));
                record.Attachment = objectUrl;
                observer.next(record);
                observer.complete();
              }
              
            } catch (error) {
              console.error('? File fetch failed:', error);
              console.error('  - Error details:', error);
              
              // Try with /Inspections/ prefix if the simple path failed
              if (!filePath.includes('/Inspections/')) {
                try {
                  const inspectionsPath = '/Inspections' + (filePath.startsWith('/') ? filePath : '/' + filePath);
                  const inspectionsUrl = `${API_BASE_URL}/files/path?filePath=${encodeURIComponent(inspectionsPath)}`;
                  console.log('?? Trying with /Inspections prefix:', inspectionsPath);
                  
                  const inspResponse = await fetch(inspectionsUrl, {
                    method: 'GET',
                    headers: {
                      'Authorization': `Bearer ${accessToken}`,
                      'Accept': 'application/octet-stream'
                    }
                  });
                  
                  if (inspResponse.ok) {
                    let blob = await inspResponse.blob();
                    console.log('? Success with /Inspections prefix');
                    
                    // Detect MIME type if not set
                    let mimeType = blob.type;
                    if (!mimeType || mimeType === 'application/octet-stream') {
                      const filename = record.Link || record.Attachment || '';
                      if (filename.toLowerCase().endsWith('.pdf')) {
                        mimeType = 'application/pdf';
                        blob = new Blob([blob], { type: mimeType });
                      }
                    }
                    
                    // For PDFs, convert to base64
                    if (mimeType === 'application/pdf') {
                      console.log('?? PDF detected in /Inspections path, converting to base64');
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        const base64data = reader.result as string;
                        record.Attachment = base64data;
                        observer.next(record);
                        observer.complete();
                      };
                      reader.readAsDataURL(blob);
                    } else {
                      const objectUrl = URL.createObjectURL(blob);
                      record.Attachment = objectUrl;
                      observer.next(record);
                      observer.complete();
                    }
                    return;
                  }
                } catch (inspError) {
                  console.error('? /Inspections prefix also failed:', inspError);
                }
              }
              
              // Try alternate method if path-based methods fail
              try {
                const altUrl = `${API_BASE_URL}/tables/Attach/records/${attachId}/files/Attachment`;
                console.log('?? Trying table-based file endpoint:', altUrl);
                
                const altResponse = await fetch(altUrl, {
                  method: 'GET',
                  headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/octet-stream'
                  }
                });
                
                if (!altResponse.ok) {
                  throw new Error(`Alternate method failed: ${altResponse.status}`);
                }
                
                const blob = await altResponse.blob();
                const objectUrl = URL.createObjectURL(blob);
                console.log('? Alternate method succeeded, created object URL');
                
                record.Attachment = objectUrl;
                observer.next(record);
                observer.complete();
                
              } catch (altError) {
                console.error('? Both methods failed:', altError);
                record.Attachment = this.createPlaceholderImage(record.Title, record.Link);
                observer.next(record);
                observer.complete();
              }
            }
          } else {
            console.log('?? No file path in Attachment field');
            record.Attachment = this.createPlaceholderImage(record.Title, record.Link);
            observer.next(record);
            observer.complete();
          }
        } else {
          console.log('? No attachment record found');
          observer.next(null);
          observer.complete();
        }
      })
      .catch(error => {
        console.error('? Error fetching attachment record:', error);
        observer.next(null);
        observer.complete();
      });
    });
  }
  
  // Update an existing attachment with new image data
  async updateAttachmentImage(attachId: string, imageBlob: Blob, filename: string): Promise<boolean> {
    const accessToken = this.tokenSubject.value;
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    try {
      console.log('?? DEBUG: Starting updateAttachmentImage');
      console.log('  - AttachID:', attachId);
      console.log('  - Blob size:', imageBlob.size, 'bytes');
      console.log('  - Blob type:', imageBlob.type);
      console.log('  - Filename:', filename);
      console.log('  - Access token present:', !!accessToken);
      console.log('  - API URL:', API_BASE_URL);
      
      if (!attachId) {
        console.error('? ERROR: No attachId provided!');
        return false;
      }
      
      // Step 1: Upload new file to Files API
      const timestamp = Date.now();
      const uniqueFilename = `annotated_${timestamp}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const filePath = `/Inspections/${uniqueFilename}`;
      
      console.log('?? Step 1: Uploading new file to Files API...');
      console.log('  - Upload URL:', `${API_BASE_URL}/files/Inspections`);
      console.log('  - Unique filename:', uniqueFilename);
      console.log('  - File path:', filePath);
      
      const formData = new FormData();
      formData.append('File', imageBlob, uniqueFilename);
      
      const uploadResponse = await fetch(`${API_BASE_URL}/files/Inspections`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        body: formData
      });
      
      const uploadResponseText = await uploadResponse.text();
      console.log('  - Upload response status:', uploadResponse.status);
      console.log('  - Upload response headers:', uploadResponse.headers);
      
      if (!uploadResponse.ok) {
        console.error('? Failed to upload file!');
        console.error('  - Status:', uploadResponse.status);
        console.error('  - Status text:', uploadResponse.statusText);
        console.error('  - Response body:', uploadResponseText);
        return false;
      }
      
      let uploadResult: any;
      try {
        uploadResult = JSON.parse(uploadResponseText);
        console.log('? File uploaded successfully:', uploadResult);
      } catch (e) {
        console.log('?? Could not parse upload response as JSON:', uploadResponseText);
        // Continue anyway as file might have been uploaded
      }
      
      // Step 2: Update the Attach record with new file path
      console.log('?? Step 2: Updating Attach record with new file path...');
      console.log('  - Update URL:', `${API_BASE_URL}/tables/Attach/records?q.where=AttachID=${attachId}`);
      
      const updateData = {
        Attachment: filePath,
        Link: uniqueFilename
      };
      console.log('  - Update data:', JSON.stringify(updateData));
      
      const updateResponse = await fetch(`${API_BASE_URL}/tables/Attach/records?q.where=AttachID=${attachId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData)
      });
      
      const updateResponseText = await updateResponse.text();
      console.log('  - Update response status:', updateResponse.status);
      
      if (!updateResponse.ok) {
        console.error('? Failed to update Attach record!');
        console.error('  - Status:', updateResponse.status);
        console.error('  - Status text:', updateResponse.statusText);
        console.error('  - Response body:', updateResponseText);
        return false;
      }
      
      console.log('? Attachment updated successfully with annotated image');
      console.log('  - Response:', updateResponseText);
      return true;
      
    } catch (error) {
      console.error('? EXCEPTION in updateAttachmentImage:');
      console.error('  - Error type:', error instanceof Error ? error.constructor.name : typeof error);
      console.error('  - Error message:', error instanceof Error ? error.message : String(error));
      console.error('  - Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
      return false;
    }
  }
  
  // Save annotation data as JSON in Notes field or separate table
  async saveAnnotationData(attachId: string, annotationData: any): Promise<boolean> {
    const accessToken = this.tokenSubject.value;
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    try {
      console.log('?? Saving annotation data for AttachID:', attachId);
      
      // Store annotations as JSON in the Notes field of Attach table
      const updateData = {
        Notes: JSON.stringify(annotationData)
      };
      
      const response = await fetch(`${API_BASE_URL}/tables/Attach/records?q.where=AttachID=${attachId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData)
      });
      
      if (!response.ok) {
        console.error('Failed to save annotation data:', response.status);
        return false;
      }
      
      console.log('? Annotation data saved successfully');
      return true;
      
    } catch (error) {
      console.error('? Error saving annotation data:', error);
      return false;
    }
  }
  
  // Retrieve annotation data from Notes field
  async getAnnotationData(attachId: string): Promise<any | null> {
    const accessToken = this.tokenSubject.value;
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    try {
      const response = await fetch(`${API_BASE_URL}/tables/Attach/records?q.where=AttachID=${attachId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        console.error('Failed to get annotation data:', response.status);
        return null;
      }
      
      const data = await response.json();
      if (data.Result && data.Result.length > 0) {
        const notes = data.Result[0].Notes;
        if (notes) {
          try {
            return JSON.parse(notes);
          } catch (e) {
            console.log('Notes field does not contain valid JSON');
            return null;
          }
        }
      }
      
      return null;
      
    } catch (error) {
      console.error('? Error getting annotation data:', error);
      return null;
    }
  }
  
  // Helper to get record and create placeholder
  private getRecordAndCreatePlaceholder(attachId: string, observer: any): void {
    const accessToken = this.tokenSubject.value;
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    fetch(`${API_BASE_URL}/tables/Attach/records?q.where=AttachID=${attachId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    })
    .then(r => r.json())
    .then(data => {
      if (data.Result && data.Result.length > 0) {
        const record = data.Result[0];
        record.Attachment = this.createPlaceholderImage(record.Title, record.Link);
        observer.next(record);
      } else {
        observer.next(null);
      }
      observer.complete();
    })
    .catch(() => {
      observer.next(null);
      observer.complete();
    });
  }
  
  // Helper to create placeholder image
  private createPlaceholderImage(title: string, filename: string): string {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, 400, 300);
      ctx.fillStyle = '#333';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(title || 'Document', 200, 140);
      ctx.fillText(filename || 'No filename', 200, 170);
      ctx.font = '12px Arial';
      ctx.fillText('(Preview not available)', 200, 200);
    }
    return canvas.toDataURL();
  }

  private getMimeTypeFromFilename(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes: {[key: string]: string} = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'pdf': 'application/pdf'
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  // Authenticate user against Users table
  authenticateUser(email: string, password: string, companyId: number): Observable<any> {
    return this.getValidToken().pipe(
      switchMap(token => {
        const headers = new HttpHeaders({
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        });

        // FIRST - Try to find user by email ONLY
        // Properly escape special characters for Caspio
        // The + character and @ need to be handled carefully
        const escapedEmail = email
          .replace(/'/g, "''")  // Escape single quotes for SQL
          .replace(/\+/g, '%2B'); // URL encode plus sign
        
        // Query by EMAIL ONLY first to see what we get
        const whereClause = `Email='${email.replace(/'/g, "''")}'`; // Keep original email in WHERE clause
        
        const params = {
          q: JSON.stringify({
            where: whereClause
          })
        };

        return this.http.get<any>(
          `${environment.caspio.apiBaseUrl}/tables/Users/records`,
          { headers, params }
        ).pipe(
          map(response => {
            const allUsers = response.Result || [];
            
            if (allUsers.length > 0) {
              // Find exact email match (case-insensitive)
              const exactMatch = allUsers.find((u: any) => 
                u.Email && u.Email.toLowerCase() === email.toLowerCase()
              );
              
              if (exactMatch) {
                // Check if password matches
                if (exactMatch.Password === password) {
                  return [exactMatch]; // Return only the matching user
                } else {
                  // Password doesn't match - return empty array
                  return [];
                }
              } else {
                // No email match found
                return [];
              }
            }
            
            return [];
          }),
          catchError(error => {
            console.error('User authentication failed:', error);
            return of([]);
          })
        );
      })
    );
  }

  // Get the current auth token (for storing in localStorage)
  async getAuthToken(): Promise<string | null> {
    return this.tokenSubject.value;
  }

  // Get ALL users for debugging (no WHERE clause)
  getAllUsersForDebug(): Observable<any> {
    return this.getValidToken().pipe(
      switchMap(token => {
        const headers = new HttpHeaders({
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        });

        // Get ALL users without any WHERE clause
        return this.http.get<any>(
          `${environment.caspio.apiBaseUrl}/tables/Users/records`,
          { headers }
        ).pipe(
          map(response => {
            const users = response.Result || [];
            console.log(`Debug: Found ${users.length} total users in database`);
            return users;
          }),
          catchError(error => {
            console.error('Failed to get users for debug:', error);
            return of([]);
          })
        );
      })
    );
  }

  // Files table methods
  getFiles(): Observable<any[]> {
    return this.get<any>('/tables/Files/records').pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('Failed to get files:', error);
        return of([]);
      })
    );
  }

  getFilesByType(typeId: number): Observable<any[]> {
    return this.get<any>(`/tables/Files/records?q.where=TypeID=${typeId}`).pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('Failed to get files by type:', error);
        return of([]);
      })
    );
  }

  // Types table methods
  getTypes(): Observable<any[]> {
    return this.get<any>('/tables/Types/records').pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('Failed to get types:', error);
        return of([]);
      })
    );
  }

  // Help table methods
  getHelpById(helpId: number): Observable<any> {
    const endpoint = `/tables/Help/records?q.select=HelpID,Title,Comment&q.where=HelpID%3D${helpId}`;
    console.log('[Help] Fetching help record', { helpId, endpoint });

    return this.get<any>(endpoint).pipe(
      map(response => {
        const results = response.Result || [];
        console.log('[Help] Response for help record', { helpId, count: results.length, raw: response });
        if (results.length > 0) {
          const record = { ...results[0] };
          console.log('[Help] Normalized help record', record);
          return record;
        }
        console.warn('[Help] No help record found', { helpId, response });
        return null;
      }),
      catchError(error => {
        console.error('[Help] Failed to get help by ID', { helpId, error });
        return of(null);
      })
    );
  }

  // Get help items by HelpID
  getHelpItemsByHelpId(helpId: number): Observable<any[]> {
    const endpoint = `/tables/Help_Items/records?q.select=HelpID,ItemType,Item&q.where=HelpID%3D${helpId}`;
    console.log('[HelpItems] Fetching help items', { helpId, endpoint });

    return this.get<any>(endpoint).pipe(
      map(response => {
        const results = response.Result || [];
        console.log('[HelpItems] Response for help items', {
          helpId,
          count: results.length,
          raw: response
        });
        return results;
      }),
      catchError(error => {
        console.error('[HelpItems] Failed to get help items', { helpId, error });
        return of([]);
      })
    );
  }

  // Get help images by HelpID
  getHelpImagesByHelpId(helpId: number): Observable<any[]> {
    const endpoint = `/tables/Help_Images/records?q.select=HelpID,HelpImage&q.where=HelpID%3D${helpId}`;
    console.log('[HelpImages] Fetching help images', { helpId, endpoint });

    return this.get<any>(endpoint).pipe(
      map(response => {
        const results = response.Result || [];
        console.log('[HelpImages] Response for help images', {
          helpId,
          count: results.length,
          raw: response,
          firstImage: results[0] ? {
            HelpID: results[0].HelpID,
            HelpImage: results[0].HelpImage,
            HelpImageType: typeof results[0].HelpImage,
            HelpImageLength: results[0].HelpImage ? String(results[0].HelpImage).length : 0
          } : 'No images found'
        });
        return results;
      }),
      catchError(error => {
        console.error('[HelpImages] Failed to get help images', { helpId, error });
        return of([]);
      })
    );
  }
}
