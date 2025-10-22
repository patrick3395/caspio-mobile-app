import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError, from, of, firstValueFrom } from 'rxjs';
import { map, tap, catchError, switchMap, finalize } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ImageCompressionService } from './image-compression.service';
import { CacheService } from './cache.service';
import { OfflineService, QueuedRequest } from './offline.service';
import { compressAnnotationData, EMPTY_COMPRESSED_ANNOTATIONS } from '../utils/annotation-utils';

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
  
  // Request deduplication
  private pendingRequests = new Map<string, Observable<any>>();

  constructor(
    private http: HttpClient,
    private imageCompression: ImageCompressionService,
    private cache: CacheService,
    private offline: OfflineService
  ) {
    this.loadStoredToken();
    this.offline.registerProcessor(this.processQueuedRequest.bind(this));
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

  get<T>(endpoint: string, useCache: boolean = true): Observable<T> {
    // Create a unique key for this request
    const requestKey = `GET:${endpoint}`;
    
    // Check if there's already a pending request for this endpoint
    if (this.pendingRequests.has(requestKey)) {
      console.log(`🔄 Request deduplication: reusing pending request for ${endpoint}`);
      return this.pendingRequests.get(requestKey)!;
    }

    // Check cache first if enabled
    if (useCache) {
      const cachedData = this.cache.getApiResponse(endpoint);
      if (cachedData !== null) {
        console.log(`🚀 Cache hit for ${endpoint}`);
        return of(cachedData);
      }
    }

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
    
    // Create the request observable
    const request$ = this.http.get<T>(url, { headers }).pipe(
      tap(data => {
        // Cache the response
        if (useCache) {
          const cacheStrategy = this.getCacheStrategy(endpoint);
          this.cache.setApiResponse(endpoint, null, data, cacheStrategy);
          console.log(`💾 Cached ${endpoint} with strategy ${cacheStrategy}`);
        }
      }),
      finalize(() => {
        // Remove from pending requests when complete
        this.pendingRequests.delete(requestKey);
      }),
      catchError(error => {
        // Remove from pending requests on error
        this.pendingRequests.delete(requestKey);
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

    // Store the pending request
    this.pendingRequests.set(requestKey, request$);
    
    return request$;
  }

  post<T>(endpoint: string, data: any): Observable<T> {
    if (!this.offline.isOnline()) {
      return from(this.queueOfflineRequest<T>('POST', endpoint, data));
    }

    return this.performPost<T>(endpoint, data);
  }

  private performPost<T>(endpoint: string, data: any): Observable<T> {
    const token = this.getCurrentToken();
    
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
    
    return this.http.post<T>(url, data, { headers }).pipe(
      tap(response => {
        // Automatically clear cache after successful POST (create) operations
        this.invalidateCacheForEndpoint(endpoint, 'POST');
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
    if (!this.offline.isOnline()) {
      return from(this.queueOfflineRequest<T>('PUT', endpoint, data));
    }

    return this.performPut<T>(endpoint, data);
  }

  private performPut<T>(endpoint: string, data: any): Observable<T> {
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

    return this.http.put<T>(`${environment.caspio.apiBaseUrl}${endpoint}`, data, { headers }).pipe(
      tap(response => {
        // Automatically clear cache after successful PUT (update) operations
        this.invalidateCacheForEndpoint(endpoint, 'PUT');
      })
    );
  }

  delete<T>(endpoint: string): Observable<T> {
    if (!this.offline.isOnline()) {
      return from(this.queueOfflineRequest<T>('DELETE', endpoint, null));
    }

    return this.performDelete<T>(endpoint);
  }

  private performDelete<T>(endpoint: string): Observable<T> {
    const token = this.getCurrentToken();
    if (!token) {
      return throwError(() => new Error('No authentication token available'));
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    });

    return this.http.delete<T>(`${environment.caspio.apiBaseUrl}${endpoint}`, { headers }).pipe(
      tap(response => {
        // Automatically clear cache after successful DELETE operations
        this.invalidateCacheForEndpoint(endpoint, 'DELETE');
      })
    );
  }

  private async queueOfflineRequest<T>(method: QueuedRequest['type'], endpoint: string, data: any): Promise<T> {
    const payload = await this.serializePayload(data);
    this.offline.queueRequest(method, endpoint, payload);
    return null as T;
  }

  private async serializePayload(data: any): Promise<any> {
    if (data instanceof FormData) {
      const entries: any[] = [];
      for (const [key, value] of Array.from(data.entries())) {
        if (value instanceof File) {
          const dataUrl = await this.blobToDataUrl(value);
          entries.push({ key, value: dataUrl, fileName: value.name, type: value.type, __file: true });
        } else {
          entries.push({ key, value });
        }
      }
      return { __formData: true, entries };
    }
    return data;
  }

  private async deserializePayload(payload: any): Promise<any> {
    if (payload && payload.__formData) {
      const formData = new FormData();
      for (const entry of payload.entries) {
        if (entry.__file && entry.value) {
          const blob = this.dataUrlToBlob(entry.value, entry.type || 'application/octet-stream');
          const file = new File([blob], entry.fileName || 'file', { type: entry.type || 'application/octet-stream' });
          formData.append(entry.key, file);
        } else {
          formData.append(entry.key, entry.value);
        }
      }
      return formData;
    }
    return payload;
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  private dataUrlToBlob(dataUrl: string, contentType: string): Blob {
    const parts = dataUrl.split(',');
    const byteString = atob(parts[1] || '');
    const buffer = new ArrayBuffer(byteString.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < byteString.length; i++) {
      view[i] = byteString.charCodeAt(i);
    }
    return new Blob([buffer], { type: contentType });
  }

  private async processQueuedRequest(request: QueuedRequest): Promise<any> {
    const payload = await this.deserializePayload(request.data);
    switch (request.type) {
      case 'POST':
        await firstValueFrom(this.performPost(request.endpoint, payload));
        break;
      case 'PUT':
        await firstValueFrom(this.performPut(request.endpoint, payload));
        break;
      case 'DELETE':
        await firstValueFrom(this.performDelete(request.endpoint));
        break;
      default:
        throw new Error(`Unsupported queued request type: ${request.type}`);
    }
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
    // Don't specify fields - let it return all available fields to avoid errors if Icon doesn't exist
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
    return this.get<any>(`/tables/Services/records?q.where=ProjectID=${projectId}`).pipe(
      map(response => {
        return response.Result || [];
      }),
      catchError(error => {
        console.error('? DEBUG [CaspioService]: Failed to get services:', error);
        return throwError(() => error);
      })
    );
  }

  createService(serviceData: any): Observable<any> {
    // Add response=rows to get the created record back immediately
    return this.post<any>('/tables/Services/records?response=rows', serviceData).pipe(
      map(response => {
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

  // Get Services Visuals Templates filtered by TypeID
  getServicesVisualsTemplatesByTypeId(typeId: number): Observable<any[]> {
    // Use Caspio's query parameter to filter by TypeID
    const query = `TypeID=${typeId}`;
    return this.get<any>(`/tables/Services_Visuals_Templates/records?q.where=${encodeURIComponent(query)}`).pipe(
      map(response => {
        return response.Result || [];
      }),
      catchError(error => {
        console.error(`Error fetching templates for TypeID ${typeId}:`, error);
        return of([]);
      })
    );
  }

  // Services EFE Templates methods - simplified
  getServicesEFETemplates(): Observable<any[]> {
    return this.get<any>('/tables/Services_EFE_Templates/records').pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('EFE templates error:', error);
        return of([]);
      })
    );
  }
  
  // Services EFE methods
  getServicesEFE(serviceId: string): Observable<any[]> {
    const query = `ServiceID=${serviceId}`;
    // Add limit parameter to ensure we get all records (Caspio default might be limited)
    return this.get<any>(`/tables/Services_EFE/records?q.where=${encodeURIComponent(query)}&q.limit=1000`).pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('Services EFE error:', error);
        return of([]);
      })
    );
  }

  // Get Services_EFE_Points for a specific EFE
  getServicesEFEPoints(efeId: string): Observable<any[]> {
    const query = `EFEID=${efeId}`;
    return this.get<any>(`/tables/Services_EFE_Points/records?q.where=${encodeURIComponent(query)}`).pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('Services EFE Points error:', error);
        return of([]);
      })
    );
  }

  // Check if a specific point exists for an EFE
  checkEFEPointExists(efeId: string, pointName: string): Observable<any> {
    const query = `EFEID=${efeId} AND PointName='${pointName}'`;
    return this.get<any>(`/tables/Services_EFE_Points/records?q.where=${encodeURIComponent(query)}`).pipe(
      map(response => {
        const results = response.Result || [];
        return results.length > 0 ? results[0] : null;
      }),
      catchError(error => {
        console.error('Check EFE point error:', error);
        return of(null);
      })
    );
  }

  // Get Services_EFE_Points_Attach for specific point IDs
  getServicesEFEAttachments(pointIds: string[] | string): Observable<any[]> {
    // Handle single ID or array of IDs
    const idArray = Array.isArray(pointIds) ? pointIds : [pointIds];
    if (!idArray || idArray.length === 0) {
      return of([]);
    }
    // Build query for multiple PointIDs using OR
    const query = idArray.map(id => `PointID=${id}`).join(' OR ');
    return this.get<any>(`/tables/Services_EFE_Points_Attach/records?q.where=${encodeURIComponent(query)}`).pipe(
      map(response => {
        const results = response.Result || [];
        results.forEach((photo: any, index: number) => {
        });
        return results;
      }),
      catchError(error => {
        console.error('Services_EFE_Points_Attach error:', error);
        return of([]);
      })
    );
  }

  createServicesEFE(data: any): Observable<any> {
    return this.post<any>('/tables/Services_EFE/records?response=rows', data).pipe(
      map(response => {
        // Handle various response formats
        if (!response) {
          return {};
        }
        if (response.Result && Array.isArray(response.Result)) {
          return response.Result[0] || response;
        }
        return response;
      }),
      catchError(error => {
        console.error('Services EFE creation error:', error);
        throw error;
      })
    );
  }

  // Delete a Services_EFE record
  deleteServicesEFE(efeId: string): Observable<any> {
    const query = `EFEID=${efeId}`;
    return this.delete<any>(`/tables/Services_EFE/records?q.where=${encodeURIComponent(query)}`).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('Services EFE deletion error:', error);
        throw error;
      })
    );
  }
  
  // Update Services_EFE record
  updateServicesEFE(efeId: string, data: any): Observable<any> {
    return this.put<any>(`/tables/Services_EFE/records?q.where=PK_ID=${efeId}`, data);
  }

  // Update Services_EFE record by EFEID (for FDF annotations/drawings)
  updateServicesEFEByEFEID(efeId: string, data: any): Observable<any> {
    const url = `/tables/Services_EFE/records?q.where=EFEID=${efeId}`;
    return this.put<any>(url, data).pipe(
      tap(response => {
        console.log('Services EFE updated:', response);
      }),
      catchError(error => {
        console.error('Failed to update Services EFE record:', error);
        return throwError(() => error);
      })
    );
  }
  
  // Get Services_EFE_Drop for dropdown options
  getServicesEFEDrop(): Observable<any[]> {
    return this.get<any>('/tables/Services_EFE_Drop/records').pipe(
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
  
  // Create Services_EFE_Points record
  createServicesEFEPoint(data: any): Observable<any> {
    return this.post<any>('/tables/Services_EFE_Points/records?response=rows', data).pipe(
      map(response => {
        if (!response) {
          return {};
        }
        if (response.Result && Array.isArray(response.Result)) {
          return response.Result[0] || response;
        }
        return response;
      }),
      catchError(error => {
        console.error('Services EFE Points creation error:', error);
        throw error;
      })
    );
  }
  
  // Update Services_EFE_Points record
  updateServicesEFEPoint(pointId: string, data: any): Observable<any> {
    const url = `/tables/Services_EFE_Points/records?q.where=PointID=${pointId}`;
    return this.put<any>(url, data).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('Services EFE Points update error:', error);
        throw error;
      })
    );
  }
  
  // Delete Services_EFE_Points record
  deleteServicesEFEPoint(pointId: string): Observable<any> {
    const url = `/tables/Services_EFE_Points/records?q.where=PointID=${pointId}`;
    return this.delete<any>(url).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('Services EFE Points deletion error:', error);
        throw error;
      })
    );
  }
  
  // Create Services_EFE_Points_Attach record with file using two-step Files API method
  createServicesEFEPointsAttachWithFile(pointId: number, drawingsData: string, file: File, photoType?: string): Observable<any> {
    
    // Wrap the entire async function in Observable to return to Angular
    return new Observable(observer => {
      this.uploadEFEPointsAttachWithFilesAPI(pointId, drawingsData, file, photoType)
        .then(result => {
          observer.next(result); // Return the created record
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  // Two-step upload method for Services_EFE_Points_Attach (matching visual method)
  private async uploadEFEPointsAttachWithFilesAPI(pointId: number, drawingsData: string, file: File, photoType?: string) {
    
    const accessToken = this.tokenSubject.value;
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    try {
      // [v1.4.391] Generate unique filename to prevent duplication (like Structural section)
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const fileExt = file.name.split('.').pop() || 'jpg';
      const uniqueFilename = `efe_point_${pointId}_${timestamp}_${randomId}.${fileExt}`;
      const formData = new FormData();
      formData.append('file', file, uniqueFilename);
      
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
        console.error('Files API upload failed:', errorText);
        throw new Error('Failed to upload file to Files API: ' + errorText);
      }
      
      const uploadResult = await uploadResponse.json();
      
      // [v1.4.391] Use unique filename in file path to prevent duplication
      const filePath = `/${uploadResult.Name || uniqueFilename}`;
      
      const recordData: any = {
        PointID: parseInt(pointId.toString()),
        Photo: filePath,  // Include the file path in initial creation
        Annotation: '' // Initialize annotation as blank (user can add their own caption)
      };
      
      // Only add Drawings field if we have annotation data
      // Don't send empty string - just omit the field
      if (drawingsData && drawingsData.length > 0) {
        recordData.Drawings = drawingsData;
      }
      
      const createUrl = `${API_BASE_URL}/tables/Services_EFE_Points_Attach/records?response=rows`;
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
        throw new Error('Failed to create Services_EFE_Points_Attach record: ' + errorText);
      }
      
      const createdRecord = await createResponse.json();
      
      // Return the created record (Result[0] has the full record with AttachID)
      return createdRecord.Result?.[0] || createdRecord;
      
    } catch (error) {
      console.error('? Two-step upload failed:', error);
      throw error;
    }
  }

  // Legacy method for direct data posting (kept for backward compatibility)
  createServicesEFEAttach(data: any): Observable<any> {
    return this.post<any>('/tables/Services_EFE_Points_Attach/records?response=rows', data).pipe(
      map(response => {
        if (!response) {
          return {};
        }
        if (response.Result && Array.isArray(response.Result)) {
          return response.Result[0] || response;
        }
        return response;
      }),
      catchError(error => {
        console.error('Services EFE Points Attach creation error:', error);
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
  
  // Update Services_EFE_Points_Attach record (for caption/annotation updates)
  updateServicesEFEPointsAttach(attachId: string, data: any): Observable<any> {
    
    const url = `/tables/Services_EFE_Points_Attach/records?q.where=AttachID=${attachId}`;
    return this.put<any>(url, data).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('? Failed to update EFE point annotation:', error);
        return throwError(() => error);
      })
    );
  }
  
  // Delete Services_EFE_Points_Attach record
  deleteServicesEFEPointsAttach(attachId: string): Observable<any> {
    
    const url = `/tables/Services_EFE_Points_Attach/records?q.where=AttachID=${attachId}`;
    return this.delete<any>(url).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('? Error deleting EFE point attachment:', error);
        return throwError(() => error);
      })
    );
  }
  
  // Services Visuals methods (for saving selected items)
  createServicesVisual(visualData: any): Observable<any> {
    // Use response=rows to get the created record back immediately
    return this.post<any>('/tables/Services_Visuals/records?response=rows', visualData).pipe(
      tap(response => {
        // With response=rows, the actual record is in Result array
        if (response && response.Result && response.Result.length > 0) {
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
    const url = `/tables/Services_Visuals/records?q.where=VisualID=${visualId}`;
    return this.put<any>(url, visualData).pipe(
      tap(response => {
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
    // Add limit parameter to ensure we get all records (Caspio default might be limited)
    return this.get<any>(`/tables/Services_Visuals/records?q.where=ServiceID=${serviceId}&q.limit=1000`).pipe(
      map(response => response.Result || [])
    );
  }
  
  deleteServicesVisual(visualId: string): Observable<any> {
    return this.delete<any>(`/tables/Services_Visuals/records?q.where=PK_ID=${visualId}`);
  }
  
  // Service_Visuals_Attach methods (for photos)
  createServiceVisualsAttach(attachData: any): Observable<any> {
    return this.post<any>('/tables/Service_Visuals_Attach/records', attachData).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('? Failed to create Service_Visuals_Attach:', error);
        return throwError(() => error);
      })
    );
  }
  
  // Upload photo to Service_Visuals_Attach with two-step process
  uploadPhotoToServiceVisualsAttach(visualId: string, photo: File): Observable<any> {
    
    return new Observable(observer => {
      // Step 1: Create the attachment record
      const attachData = {
        VisualID: visualId,
        // Photo field will be uploaded in step 2
      };
      
      this.post<any>('/tables/Service_Visuals_Attach/records', attachData).subscribe({
        next: (createResponse) => {
          
          const attachId = createResponse.PK_ID || createResponse.id;
          
          if (!attachId) {
            console.error('? No ID in response:', createResponse);
            observer.error(new Error('Failed to get attachment ID'));
            return;
          }
          
          // Step 2: Upload the photo using multipart/form-data
          const formData = new FormData();
          formData.append('Photo', photo, photo.name);
          
          const updateUrl = `/tables/Service_Visuals_Attach/records?q.where=PK_ID=${attachId}`;
          
          this.put<any>(updateUrl, formData).subscribe({
            next: (uploadResponse) => {
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
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('Files API error response:', errorText);
          throw new Error(`Files API error (${response.status}): ${errorText}`);
        }
        
        const result = await response.json();
        
        // Check multiple possible response formats
        const fileName = result.Name || result.name || result.FileName || result.fileName || file.name;
        const finalResult = {
          ...result,
          Name: fileName
        };
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

  getImageFromFilesAPI(filePath: string): Observable<string> {
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    // IMPORTANT: Cache disabled to prevent duplication
    // DO NOT use normalized/lowercase paths
    
    // Use getValidToken to ensure fresh token
    return this.getValidToken().pipe(
      switchMap(accessToken => new Observable<string>(observer => {
        // Clean the file path - use exact path, no normalization
        const cleanPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
        
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
    // [v1.4.571] Generate unique call ID to track duplicate calls
    const callId = `svcCall_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const accessToken = this.tokenSubject.value;
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    try {
      let originalFilePath = '';

      // STEP 1A: If we have an original file (before annotation), upload it first
      if (originalFile && drawings) {
        const originalFormData = new FormData();
        // CRITICAL FIX: Generate UNIQUE filename for original to prevent duplicates
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 8);
        const fileExt = originalFile.name.split('.').pop() || 'jpg';
        const originalFileName = `visual_${visualId}_original_${timestamp}_${randomId}.${fileExt}`;
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
        }
      }
      
      // STEP 1B: Upload file to Caspio Files API
      // [v1.4.570] FIX: Only upload the main file if we DON'T have an original file already
      // This prevents duplicate uploads when annotations are present
      let filePath = '';

      if (originalFilePath) {
        filePath = originalFilePath;
      } else {

        // [v1.4.387] Generate unique filename to prevent duplication
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 8);
        const fileExt = file.name.split('.').pop() || 'jpg';
        const uniqueFilename = `visual_${visualId}_${timestamp}_${randomId}.${fileExt}`;

        const formData = new FormData();
        formData.append('file', file, uniqueFilename);

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
          console.error('Files API upload failed:', errorText);
          throw new Error('Failed to upload file to Files API: ' + errorText);
        }

        const uploadResult = await uploadResponse.json();

        // The file path for the Photo field - use unique filename
        filePath = `/${uploadResult.Name || uniqueFilename}`;
      }
      
      const recordData: any = {
        VisualID: parseInt(visualId.toString()),
        Annotation: annotation || '',  // Keep blank if no annotation provided
        Photo: filePath  // Include the file path in initial creation
      };
      
      // Add Drawings field if annotation data is provided
      // IMPORTANT: Drawings field is TEXT type with 64KB limit
      // Apply compression like Elevation Plot does
      if (drawings && drawings.length > 0) {
        
        // Apply compression if needed (using the same method as Elevation Plot)
        let compressedDrawings = drawings;
        
        // Try to compress the data if it's large
        if (drawings.length > 50000) {
          compressedDrawings = compressAnnotationData(drawings, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });
        }
        
        // Only add if within the field limit after compression
        if (compressedDrawings.length <= 64000) {
          recordData.Drawings = compressedDrawings;
        } else {
          console.warn('?? Drawings data still too large after compression:', compressedDrawings.length, 'bytes');
          console.warn('?? Skipping Drawings field to avoid data type error');
        }
      }
      
      const createResponse = await fetch(`${API_BASE_URL}/tables/Services_Visuals_Attach/records?response=rows`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(recordData)
      });
      
      const createResponseText = await createResponse.text();
      
      if (!createResponse.ok) {
        console.error('Failed to create Services_Visuals_Attach record:', createResponseText);
        throw new Error('Failed to create record: ' + createResponseText);
      }
      
      let createResult: any;
      if (createResponseText.length > 0) {
        const parsedResponse = JSON.parse(createResponseText);
        if (parsedResponse.Result && Array.isArray(parsedResponse.Result) && parsedResponse.Result.length > 0) {
          createResult = parsedResponse.Result[0];
        } else if (Array.isArray(parsedResponse) && parsedResponse.length > 0) {
          createResult = parsedResponse[0];
        } else {
          createResult = parsedResponse;
        }
      } else {
        createResult = { success: true };
      }
      
      // Return the created record with the file path
      const attachId = createResult.AttachID || createResult.PK_ID || createResult.id;
      
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
    return this.put<any>(`/tables/Services/records?q.where=PK_ID=${serviceId}`, updateData).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('? [CaspioService.updateService] Failed to update service:', error);
        return throwError(() => error);
      })
    );
  }

  updateServiceByServiceId(serviceId: string, updateData: any): Observable<any> {
    console.log('[CaspioService.updateServiceByServiceId] Request details:', {
      serviceId,
      updateData,
      url: `/tables/Services/records?q.where=ServiceID=${serviceId}`
    });
    
    return this.put<any>(`/tables/Services/records?q.where=ServiceID=${serviceId}`, updateData).pipe(
      tap(response => {
        console.log('✓ [CaspioService.updateServiceByServiceId] Service updated successfully');
        console.log('[CaspioService.updateServiceByServiceId] Response:', response);
      }),
      catchError(error => {
        console.error('? [CaspioService.updateServiceByServiceId] Failed to update service:', error);
        return throwError(() => error);
      })
    );
  }

  // Attach (Attachments) table methods
  getAttachmentsByProject(projectId: string, useCache: boolean = true): Observable<any[]> {
    return this.get<any>(`/tables/Attach/records?q.where=ProjectID=${projectId}`, useCache).pipe(
      map(response => response.Result || [])
    );
  }

  createAttachment(attachData: any, serviceId?: string): Observable<any> {
    // Store ServiceID in Notes field with special format to tie document to specific service instance
    const dataToSend = { ...attachData };
    if (serviceId) {
      // Prepend ServiceID to Notes field: [SID:123] existing notes
      const serviceIdPrefix = `[SID:${serviceId}]`;
      dataToSend.Notes = dataToSend.Notes 
        ? `${serviceIdPrefix} ${dataToSend.Notes}`
        : serviceIdPrefix;
    }
    
    // Remove ?response=rows as per Caspio best practices
    return this.post<any>('/tables/Attach/records', dataToSend).pipe(
      tap(response => {
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
  createAttachmentWithFile(projectId: number, typeId: number, title: string, notes: string, file: File, serviceId?: string): Observable<any> {
    
    // Wrap the entire async function in Observable to return to Angular
    return new Observable(observer => {
      this.twoStepUploadForAttach(projectId, typeId, title, notes, file, serviceId)
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
  private async twoStepUploadForAttach(projectId: number, typeId: number, title: string, notes: string, file: File, serviceId?: string) {
    
    const accessToken = this.tokenSubject.value;
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    try {
      const formData = new FormData();
      formData.append('file', file, file.name);
      
      // Upload to Files API (can optionally specify folder with externalKey)
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
        console.error('Files API upload failed:', errorText);
        throw new Error('Failed to upload file to Files API: ' + errorText);
      }
      
      const uploadResult = await uploadResponse.json();
      
      // The file path for the Attachment field (use root path or folder path)
      const filePath = `/${uploadResult.Name || file.name}`;
      const recordData: any = {
        ProjectID: parseInt(projectId.toString()),
        TypeID: parseInt(typeId.toString()),
        Title: title || file.name,
        Notes: notes || 'Uploaded from mobile',
        Link: file.name,
        Attachment: filePath  // Store the file path from Files API
      };
      
      // Store ServiceID in Notes field with special format to tie document to specific service instance
      if (serviceId) {
        const serviceIdPrefix = `[SID:${serviceId}]`;
        recordData.Notes = recordData.Notes 
          ? `${serviceIdPrefix} ${recordData.Notes}`
          : serviceIdPrefix;
      }
      
      const createResponse = await fetch(`${API_BASE_URL}/tables/Attach/records?response=rows`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(recordData)
      });
      
      const createResponseText = await createResponse.text();
      
      if (!createResponse.ok) {
        console.error('Failed to create Attach record:', createResponseText);
        throw new Error('Failed to create Attach record: ' + createResponseText);
      }
      
      let createResult: any;
      if (createResponseText.length > 0) {
        const parsedResponse = JSON.parse(createResponseText);
        if (parsedResponse.Result && Array.isArray(parsedResponse.Result) && parsedResponse.Result.length > 0) {
          createResult = parsedResponse.Result[0];
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
        const compressedBlob = await this.imageCompression.compressImage(file, {
          maxSizeMB: 1.5,
          maxWidthOrHeight: 1920,
          useWebWorker: true
        });
        // Convert Blob back to File to maintain the name property
        fileToUpload = new File([compressedBlob], file.name, { type: compressedBlob.type });
      }
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
            
            try {
              const fileResponse = await fetch(fileUrl, {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                  'Accept': 'application/octet-stream'
                }
              });
              
              if (!fileResponse.ok) {
                const errorBody = await fileResponse.text();
                console.error('  - Error response body:', errorBody);
                throw new Error(`File fetch failed: ${fileResponse.status} ${fileResponse.statusText}`);
              }
              
              // Get the blob
              let blob = await fileResponse.blob();
              
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
                  blob = new Blob([blob], { type: mimeType });
                }
              }
              
              // For PDFs, convert to base64 data URL instead of blob URL
              // ngx-extended-pdf-viewer doesn't work well with blob URLs
              if (mimeType === 'application/pdf') {
                const reader = new FileReader();
                reader.onloadend = () => {
                  const base64data = reader.result as string;
                  record.Attachment = base64data;
                  observer.next(record);
                  observer.complete();
                };
                reader.readAsDataURL(blob);
              } else {
                // For images and other files, use object URL as before
                const objectUrl = URL.createObjectURL(blob);
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
                  
                  const inspResponse = await fetch(inspectionsUrl, {
                    method: 'GET',
                    headers: {
                      'Authorization': `Bearer ${accessToken}`,
                      'Accept': 'application/octet-stream'
                    }
                  });
                  
                  if (inspResponse.ok) {
                    let blob = await inspResponse.blob();
                    
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
            record.Attachment = this.createPlaceholderImage(record.Title, record.Link);
            observer.next(record);
            observer.complete();
          }
        } else {
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
      
      if (!attachId) {
        console.error('? ERROR: No attachId provided!');
        return false;
      }
      
      // Step 1: Upload new file to Files API
      const timestamp = Date.now();
      const uniqueFilename = `annotated_${timestamp}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const filePath = `/Inspections/${uniqueFilename}`;
      
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
      } catch (e) {
        // Continue anyway as file might have been uploaded
      }
      
      const updateData = {
        Attachment: filePath,
        Link: uniqueFilename
      };
      
      const updateResponse = await fetch(`${API_BASE_URL}/tables/Attach/records?q.where=AttachID=${attachId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updateData)
      });
      
      const updateResponseText = await updateResponse.text();
      
      if (!updateResponse.ok) {
        console.error('? Failed to update Attach record!');
        console.error('  - Status:', updateResponse.status);
        console.error('  - Status text:', updateResponse.statusText);
        console.error('  - Response body:', updateResponseText);
        return false;
      }
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
    return this.get<any>('/tables/Type/records').pipe(
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

    return this.get<any>(endpoint).pipe(
      map(response => {
        const results = response.Result || [];
        if (results.length > 0) {
          const record = { ...results[0] };
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

    return this.get<any>(endpoint).pipe(
      map(response => {
        const results = response.Result || [];
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

    return this.get<any>(endpoint).pipe(
      map(response => {
        const results = response.Result || [];
        return results;
      }),
      catchError(error => {
        console.error('[HelpImages] Failed to get help images', { helpId, error });
        return of([]);
      })
    );
  }

  private getCacheStrategy(endpoint: string): keyof typeof this.cache.CACHE_TIMES {
    // Immutable data - long cache (24 hours)
    if (endpoint.includes('/tables/Type/records') || endpoint.includes('/tables/ServiceTypes')) {
      return 'SERVICE_TYPES';
    }
    if (endpoint.includes('/tables/Services_Visuals_Templates') || 
        endpoint.includes('/tables/Services_EFE_Templates') ||
        endpoint.includes('/tables/Attach_Templates') ||
        endpoint.includes('/tables/Templates')) {
      return 'TEMPLATES';
    }
    if (endpoint.includes('/tables/States')) {
      return 'STATES';
    }
    if (endpoint.includes('/tables/Offers/records')) {
      return 'STATIC_DATA';
    }
    
    // Mutable data - short cache (1-2 minutes)
    if (endpoint.includes('/tables/Attach/records')) {
      return 'SHORT';
    }
    if (endpoint.includes('/tables/Services/records')) {
      return 'SHORT';
    }
    if (endpoint.includes('/tables/Services_Visuals/records') || 
        endpoint.includes('/tables/Services_Visuals_Attach/records')) {
      return 'SHORT';
    }
    if (endpoint.includes('/tables/Services_EFE/records') || 
        endpoint.includes('/tables/Services_EFE_Points/records') ||
        endpoint.includes('/tables/Services_EFE_Points_Attach/records') ||
        endpoint.includes('/tables/Service_EFE/records')) {
      return 'SHORT';
    }
    if (endpoint.includes('/tables/Projects/records')) {
      return 'PROJECT_LIST'; // 2 minutes
    }
    
    // Images - long cache
    if (endpoint.includes('/files/') || endpoint.includes('image')) {
      return 'IMAGES';
    }
    
    // User data - medium cache
    if (endpoint.includes('/tables/Users') || endpoint.includes('/tables/Companies')) {
      return 'USER_DATA';
    }
    
    // Default to short cache for mutable data
    return 'SHORT';
  }

  /**
   * Extract table name from endpoint for cache invalidation
   */
  private extractTableName(endpoint: string): string | null {
    const match = endpoint.match(/\/tables\/([^\/]+)\/records/);
    return match ? match[1] : null;
  }

  /**
   * Invalidate cache for an endpoint after mutation operations
   */
  private invalidateCacheForEndpoint(endpoint: string, operation: 'POST' | 'PUT' | 'DELETE'): void {
    const tableName = this.extractTableName(endpoint);
    
    if (!tableName) {
      console.log(`[CaspioService] No table name found in endpoint: ${endpoint}`);
      return;
    }

    console.log(`[CaspioService] Cache invalidation triggered: ${operation} on table ${tableName}`);
    
    // Clear cache for this specific table
    this.cache.clearTableCache(tableName);
    
    // Clear related caches based on table relationships
    if (tableName === 'Services') {
      // When Services change, also clear related service tables
      this.cache.clearTableCache('Services_Visuals');
      this.cache.clearTableCache('Services_Visuals_Attach');
      this.cache.clearTableCache('Services_EFE');
      this.cache.clearTableCache('Services_EFE_Points');
      this.cache.clearTableCache('Service_EFE');
      this.cache.clearTableCache('Projects'); // Projects list may need refresh
    } else if (tableName === 'Attach') {
      // When attachments change, projects may need refresh
      this.cache.clearTableCache('Projects');
    } else if (tableName === 'Projects') {
      // When projects change, clear related data
      this.cache.clearTableCache('Services');
      this.cache.clearTableCache('Attach');
    } else if (tableName.startsWith('Services_')) {
      // Any services-related table change should clear Services cache
      this.cache.clearTableCache('Services');
    }
  }

  /**
   * Clear all pending requests (useful for cleanup or error recovery)
   */
  public clearPendingRequests(): void {
    this.pendingRequests.clear();
    console.log('🧹 Cleared all pending requests');
  }

  /**
   * Get pending requests count (for debugging)
   */
  public getPendingRequestsCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * Clear cached data for Services-related tables
   * Call this when reloading template pages to force fresh data from Caspio
   * @param projectId Optional - if provided, clears Services cache for specific project
   */
  public clearServicesCache(projectId?: string): void {
    console.log('[CaspioService] Clearing Services-related cache entries', projectId ? `for project: ${projectId}` : '');
    
    // Clear Services-related template caches
    this.cache.clearByPattern('Services_Visuals');
    this.cache.clearByPattern('Services_EFE');
    this.cache.clearByPattern('Services_EFE_Points');
    this.cache.clearByPattern('Services_Visuals_Attach');
    
    // Clear the main Services table cache for specific project if provided
    if (projectId) {
      const endpoint = `/tables/Services/records?q.where=ProjectID=${projectId}`;
      const cacheKey = this.cache.getApiCacheKey(endpoint, null);
      this.cache.clear(cacheKey);
      console.log('🗑️ Cleared Services table cache for project:', projectId);
    }
  }

  /**
   * Clear cached data for Attach table (Support Documents)
   * Call this when adding/updating/deleting attachments to force fresh data from Caspio
   * @param projectId Optional - if provided, clears Attach cache for specific project
   */
  public clearAttachmentsCache(projectId?: string): void {
    console.log('[CaspioService] Clearing Attachments cache entries', projectId ? `for project: ${projectId}` : '');
    this.cache.clearByPattern('Attach/records');
    
    // Clear the main Attach table cache for specific project if provided
    if (projectId) {
      const endpoint = `/tables/Attach/records?q.where=ProjectID=${projectId}`;
      const cacheKey = this.cache.getApiCacheKey(endpoint, null);
      this.cache.clear(cacheKey);
      console.log('🗑️ Cleared Attach table cache for project:', projectId);
    }
  }

  // ============================================================================
  // PAYMENT & INVOICE METHODS
  // ============================================================================

  /**
   * Get invoices by company ID
   */
  getInvoicesByCompany(companyId: string | number): Observable<any[]> {
    return this.get<any>(`/tables/Invoices/records?q.where=CompanyID=${companyId}`).pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('Failed to get invoices:', error);
        return of([]);
      })
    );
  }

  /**
   * Get single invoice by ID
   */
  getInvoiceById(invoiceId: string | number): Observable<any> {
    return this.get<any>(`/tables/Invoices/records?q.where=InvoiceID=${invoiceId}`).pipe(
      map(response => {
        if (response && response.Result && response.Result.length > 0) {
          return response.Result[0];
        }
        return null;
      }),
      catchError(error => {
        console.error('Failed to get invoice:', error);
        return of(null);
      })
    );
  }

  /**
   * Update invoice with payment information
   * Uses existing Invoices table fields: Paid, PaymentProcessor, InvoiceNotes, Status
   */
  updateInvoiceWithPayment(invoiceId: string | number, paymentData: {
    amount: number;
    orderID: string;
    payerID: string;
    payerEmail: string;
    payerName: string;
    status: string;
    createTime: string;
    updateTime: string;
  }): Observable<any> {
    const paymentNotes = `PayPal Payment - Order: ${paymentData.orderID}\n` +
                        `Payer: ${paymentData.payerName} (${paymentData.payerEmail})\n` +
                        `Transaction ID: ${paymentData.payerID}\n` +
                        `Processed: ${new Date(paymentData.createTime).toLocaleString()}\n` +
                        `Status: ${paymentData.status}`;

    return this.put<any>(`/tables/Invoices/records?q.where=InvoiceID=${invoiceId}`, {
      Paid: paymentData.amount,
      PaymentProcessor: 'PayPal',
      InvoiceNotes: paymentNotes,
      Status: 'Paid'
    }).pipe(
      tap(response => {
        console.log('[Payment] Invoice updated with payment details');
        this.clearInvoicesCache();
      }),
      catchError(error => {
        console.error('[Payment] Failed to update invoice with payment:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Clear invoices cache
   */
  public clearInvoicesCache(): void {
    console.log('[CaspioService] Clearing Invoices cache entries');
    this.cache.clearByPattern('Invoices/records');
  }
}
