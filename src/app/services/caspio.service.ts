import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError, from, of, timer, firstValueFrom } from 'rxjs';
import { map, tap, catchError, switchMap, finalize, retryWhen, mergeMap, filter } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { ImageCompressionService } from './image-compression.service';
import { CacheService } from './cache.service';
import { OfflineService, QueuedRequest } from './offline.service';
import { ConnectionMonitorService } from './connection-monitor.service';
import { ApiGatewayService } from './api-gateway.service';
import { RetryNotificationService } from './retry-notification.service';
import { compressAnnotationData, EMPTY_COMPRESSED_ANNOTATIONS } from '../utils/annotation-utils';

@Injectable({
  providedIn: 'root'
})
export class CaspioService {
  private imageCache = new Map<string, string>(); // Cache for loaded images
  private imageWorker: Worker | null = null;
  private imageWorkerTaskId = 0;
  private imageWorkerCallbacks = new Map<number, { resolve: (value: string) => void; reject: (reason?: any) => void }>();

  // Request deduplication
  private pendingRequests = new Map<string, Observable<any>>();

  private debugMode = !environment.production;

  constructor(
    private http: HttpClient,
    private imageCompression: ImageCompressionService,
    private cache: CacheService,
    private offline: OfflineService,
    private connectionMonitor: ConnectionMonitorService,
    private apiGateway: ApiGatewayService,
    private retryNotification: RetryNotificationService
  ) {
    this.offline.registerProcessor(this.processQueuedRequest.bind(this));
  }

  /**
   * Check if we should use API Gateway backend
   */
  private useApiGateway(): boolean {
    return environment.useApiGateway === true;
  }

  // Legacy: Caspio auth is now handled server-side. This stub prevents compile errors
  // in the fallback code paths that are never reached when useApiGateway is true.
  private getValidToken(): Observable<string> {
    return throwError(() => new Error('Direct Caspio auth removed - all requests go through API Gateway'));
  }

  // Get the Caspio account ID
  getAccountID(): string {
    return 'c2hcf092';
  }

  /**
   * Get the current connection health status
   * Useful for UI indicators or diagnostics
   */
  getConnectionHealth() {
    return this.connectionMonitor.getHealth();
  }

  /**
   * Check if connection is currently healthy
   */
  isConnectionHealthy(): boolean {
    return this.connectionMonitor.isHealthy();
  }

  get<T>(endpoint: string, useCache: boolean = true): Observable<T> {
    // WEBAPP FIX: Never use cache in WEBAPP mode - always fetch fresh data
    const effectiveUseCache = environment.isWeb ? false : useCache;

    // Route through API Gateway if enabled
    if (this.useApiGateway()) {
      return this.apiGateway.get<T>(`/api/caspio-proxy${endpoint}`).pipe(
        tap(data => {
          // Cache the response (only for mobile)
          if (effectiveUseCache) {
            this.cache.setApiResponse(endpoint, {}, data);
          }
        }),
        catchError(error => {
          if (!environment.production) {
            console.error(`[CaspioService] AWS API Gateway error for ${endpoint}:`, error);
          }
          return throwError(() => error);
        })
      );
    }


    // Create a unique key for this request
    const requestKey = `GET:${endpoint}`;

    // Check if there's already a pending request for this endpoint
    if (this.pendingRequests.has(requestKey)) {
      if (this.debugMode) {
      }
      return this.pendingRequests.get(requestKey)!;
    }

    // Check cache first if enabled (WEBAPP mode always bypasses)
    if (effectiveUseCache) {
      const cachedData = this.cache.getApiResponse(endpoint);
      if (cachedData !== null) {
        if (this.debugMode) {
        }
        return of(cachedData);
      }
    }

    // Use getValidToken to ensure we have a valid token (handles refresh automatically)
    const request$ = this.getValidToken().pipe(
      switchMap(token => {
        const headers = new HttpHeaders({
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        });

        const url = `${environment.caspio.apiBaseUrl}${endpoint}`;
        const startTime = Date.now();

        let currentAttempt = 0;
        return this.http.get<T>(url, { headers }).pipe(
          // Retry with exponential backoff for network errors
          retryWhen(errors =>
            errors.pipe(
              mergeMap((error, index) => {
                const retryAttempt = index + 1;
                const maxRetries = 3;

                // Don't retry on auth errors (401, 403) or client errors (400)
                if (error.status === 401 || error.status === 403 || error.status === 400) {
                  if (this.debugMode) {
                    console.error(`❌ Non-retryable error (${error.status}) for ${endpoint}`);
                  }
                  return throwError(() => error);
                }

                // Don't retry if we've exceeded max attempts
                if (retryAttempt > maxRetries) {
                  if (this.debugMode) {
                    console.error(`❌ Max retries (${maxRetries}) exceeded for ${endpoint}`);
                  }
                  // Notify user that all retries exhausted (web only)
                  if (environment.isWeb) {
                    this.retryNotification.notifyRetryExhausted(endpoint, error.message || 'Request failed');
                  }
                  return throwError(() => error);
                }

                // Calculate exponential backoff: 1s, 2s, 4s
                const delayMs = Math.pow(2, retryAttempt - 1) * 1000;
                currentAttempt = retryAttempt;

                if (this.debugMode) {
                }

                // Notify user of retry attempt (web only)
                if (environment.isWeb) {
                  this.retryNotification.notifyRetryAttempt(endpoint, retryAttempt, maxRetries, delayMs);
                }

                return timer(delayMs);
              })
            )
          ),
          tap(data => {
            // Record successful request
            const responseTime = Date.now() - startTime;
            this.connectionMonitor.recordSuccess(endpoint, responseTime);

            // Notify success after retries (web only)
            if (environment.isWeb && currentAttempt > 0) {
              this.retryNotification.notifyRetrySuccess(endpoint, currentAttempt + 1);
            }

            // Cache the response (skip on web — web always fetches fresh)
            if (effectiveUseCache) {
              const cacheStrategy = this.getCacheStrategy(endpoint);
              this.cache.setApiResponse(endpoint, null, data, cacheStrategy);
              if (this.debugMode) {
              }
            }
          })
        );
      }),
      finalize(() => {
        // Remove from pending requests when complete
        this.pendingRequests.delete(requestKey);
      }),
      catchError(error => {
        // Remove from pending requests on error
        this.pendingRequests.delete(requestKey);

        // Record failed request
        this.connectionMonitor.recordFailure(endpoint);

        // Enhanced error messages
        let errorMessage = 'Request failed';
        if (error.status === 401) {
          errorMessage = 'Authentication failed - invalid or expired token';
        } else if (error.status === 403) {
          errorMessage = 'Access forbidden - insufficient permissions';
        } else if (error.status === 404) {
          errorMessage = 'API endpoint not found';
        } else if (error.status === 0) {
          errorMessage = 'Network error - please check your connection';
        } else if (error.status >= 500) {
          errorMessage = 'Server error - please try again later';
        }

        console.error(`❌ GET request failed for ${endpoint}: ${errorMessage}`, {
          status: error.status,
          statusText: error.statusText,
          message: error.message,
          url: error.url
        });

        return throwError(() => new Error(errorMessage));
      })
    );

    // Store the pending request
    this.pendingRequests.set(requestKey, request$);

    return request$;
  }

  post<T>(endpoint: string, data: any): Observable<T> {
    // Route through API Gateway if enabled
    if (this.useApiGateway()) {
      return this.apiGateway.post<T>(`/api/caspio-proxy${endpoint}`, data).pipe(
        tap(() => this.invalidateCacheForEndpoint(endpoint, 'POST')),
        catchError(error => {
          console.error(`[CaspioService] AWS API Gateway error for POST ${endpoint}:`, error);
          return throwError(() => error);
        })
      );
    }


    if (!this.offline.isOnline()) {
      return from(this.queueOfflineRequest<T>('POST', endpoint, data));
    }

    return this.performPost<T>(endpoint, data);
  }

  private performPost<T>(endpoint: string, data: any): Observable<T> {
    // Use getValidToken() to ensure we have a valid token (with automatic refresh)
    return this.getValidToken().pipe(
      switchMap(token => {
        // Check if data is FormData (for file uploads)
        const isFormData = data instanceof FormData;

        const headers = new HttpHeaders({
          'Authorization': `Bearer ${token}`,
          // Don't set Content-Type for FormData - let browser set it with boundary
          ...(isFormData ? {} : { 'Content-Type': 'application/json' })
        });

        const url = `${environment.caspio.apiBaseUrl}${endpoint}`;
        let currentAttempt = 0;

        let request$ = this.http.post<T>(url, data, { headers });

        // Add retry with exponential backoff for network errors (web only)
        if (environment.isWeb) {
          request$ = request$.pipe(
            retryWhen(errors =>
              errors.pipe(
                mergeMap((error, index) => {
                  const retryAttempt = index + 1;
                  const maxRetries = 3;

                  // Don't retry on auth errors (401, 403) or client errors (400)
                  if (error.status === 401 || error.status === 403 || error.status === 400) {
                    return throwError(() => error);
                  }

                  // Don't retry if we've exceeded max attempts
                  if (retryAttempt > maxRetries) {
                    this.retryNotification.notifyRetryExhausted(endpoint, error.message || 'Request failed');
                    return throwError(() => error);
                  }

                  // Calculate exponential backoff: 1s, 2s, 4s
                  const delayMs = Math.pow(2, retryAttempt - 1) * 1000;
                  currentAttempt = retryAttempt;

                  if (this.debugMode) {
                  }

                  this.retryNotification.notifyRetryAttempt(endpoint, retryAttempt, maxRetries, delayMs);
                  return timer(delayMs);
                })
              )
            )
          );
        }

        return request$.pipe(
          tap(response => {
            // Notify success after retries (web only)
            if (environment.isWeb && currentAttempt > 0) {
              this.retryNotification.notifyRetrySuccess(endpoint, currentAttempt + 1);
            }
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
      })
    );
  }

  put<T>(endpoint: string, data: any): Observable<T> {
    // Route through API Gateway if enabled
    if (this.useApiGateway()) {
      return this.apiGateway.put<T>(`/api/caspio-proxy${endpoint}`, data).pipe(
        tap(() => this.invalidateCacheForEndpoint(endpoint, 'PUT')),
        catchError(error => {
          console.error(`[CaspioService] AWS API Gateway error for PUT ${endpoint}:`, error);
          return throwError(() => error);
        })
      );
    }


    if (!this.offline.isOnline()) {
      return from(this.queueOfflineRequest<T>('PUT', endpoint, data));
    }

    return this.performPut<T>(endpoint, data);
  }

  private performPut<T>(endpoint: string, data: any): Observable<T> {
    // Use getValidToken() to ensure we have a valid token (with automatic refresh)
    return this.getValidToken().pipe(
      switchMap(token => {
        // Check if data is FormData (for file uploads)
        const isFormData = data instanceof FormData;

        const headers = new HttpHeaders({
          'Authorization': `Bearer ${token}`,
          // Don't set Content-Type for FormData - let browser set it with boundary
          ...(isFormData ? {} : { 'Content-Type': 'application/json' })
        });

        const url = `${environment.caspio.apiBaseUrl}${endpoint}`;
        let currentAttempt = 0;

        let request$ = this.http.put<T>(url, data, { headers });

        // Add retry with exponential backoff for network errors (web only)
        if (environment.isWeb) {
          request$ = request$.pipe(
            retryWhen(errors =>
              errors.pipe(
                mergeMap((error, index) => {
                  const retryAttempt = index + 1;
                  const maxRetries = 3;

                  // Don't retry on auth errors (401, 403) or client errors (400)
                  if (error.status === 401 || error.status === 403 || error.status === 400) {
                    return throwError(() => error);
                  }

                  // Don't retry if we've exceeded max attempts
                  if (retryAttempt > maxRetries) {
                    this.retryNotification.notifyRetryExhausted(endpoint, error.message || 'Request failed');
                    return throwError(() => error);
                  }

                  // Calculate exponential backoff: 1s, 2s, 4s
                  const delayMs = Math.pow(2, retryAttempt - 1) * 1000;
                  currentAttempt = retryAttempt;

                  if (this.debugMode) {
                  }

                  this.retryNotification.notifyRetryAttempt(endpoint, retryAttempt, maxRetries, delayMs);
                  return timer(delayMs);
                })
              )
            )
          );
        }

        return request$.pipe(
          tap(response => {
            // Notify success after retries (web only)
            if (environment.isWeb && currentAttempt > 0) {
              this.retryNotification.notifyRetrySuccess(endpoint, currentAttempt + 1);
            }
            // Automatically clear cache after successful PUT (update) operations
            this.invalidateCacheForEndpoint(endpoint, 'PUT');
          }),
          catchError(error => {
            console.error('? DEBUG [CaspioService.put]: Request failed!');
            console.error('Error:', error);
            return throwError(() => error);
          })
        );
      })
    );
  }

  delete<T>(endpoint: string): Observable<T> {
    // Route through API Gateway if enabled
    if (this.useApiGateway()) {
      return this.apiGateway.delete<T>(`/api/caspio-proxy${endpoint}`).pipe(
        tap(() => this.invalidateCacheForEndpoint(endpoint, 'DELETE')),
        catchError(error => {
          console.error(`[CaspioService] AWS API Gateway error for DELETE ${endpoint}:`, error);
          return throwError(() => error);
        })
      );
    }


    if (!this.offline.isOnline()) {
      return from(this.queueOfflineRequest<T>('DELETE', endpoint, null));
    }

    return this.performDelete<T>(endpoint);
  }

  private performDelete<T>(endpoint: string): Observable<T> {
    // Use getValidToken() to ensure we have a valid token (with automatic refresh)
    return this.getValidToken().pipe(
      switchMap(token => {
        const headers = new HttpHeaders({
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        });

        const url = `${environment.caspio.apiBaseUrl}${endpoint}`;
        let currentAttempt = 0;

        let request$ = this.http.delete<T>(url, { headers });

        // Add retry with exponential backoff for network errors (web only)
        if (environment.isWeb) {
          request$ = request$.pipe(
            retryWhen(errors =>
              errors.pipe(
                mergeMap((error, index) => {
                  const retryAttempt = index + 1;
                  const maxRetries = 3;

                  // Don't retry on auth errors (401, 403) or client errors (400)
                  if (error.status === 401 || error.status === 403 || error.status === 400) {
                    return throwError(() => error);
                  }

                  // Don't retry if we've exceeded max attempts
                  if (retryAttempt > maxRetries) {
                    this.retryNotification.notifyRetryExhausted(endpoint, error.message || 'Request failed');
                    return throwError(() => error);
                  }

                  // Calculate exponential backoff: 1s, 2s, 4s
                  const delayMs = Math.pow(2, retryAttempt - 1) * 1000;
                  currentAttempt = retryAttempt;

                  if (this.debugMode) {
                  }

                  this.retryNotification.notifyRetryAttempt(endpoint, retryAttempt, maxRetries, delayMs);
                  return timer(delayMs);
                })
              )
            )
          );
        }

        return request$.pipe(
          tap(response => {
            // Notify success after retries (web only)
            if (environment.isWeb && currentAttempt > 0) {
              this.retryNotification.notifyRetrySuccess(endpoint, currentAttempt + 1);
            }
            // Automatically clear cache after successful DELETE operations
            this.invalidateCacheForEndpoint(endpoint, 'DELETE');
          }),
          catchError(error => {
            console.error('? DEBUG [CaspioService.delete]: Request failed!');
            console.error('Error:', error);
            return throwError(() => error);
          })
        );
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
    // Token management removed - auth handled server-side via API Gateway
  }

  getOfferById(offersId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.get(`/tables/LPS_Offers/records?q.where=PK_ID=${offersId}`).subscribe({
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
    return this.get<any>('/tables/LPS_Type/records').pipe(
      map(response => response.Result || [])
    );
  }

  // Get icon image from LPS_Type table attachment
  getTypeIconImage(typeId: string | number, iconFileName?: string): Observable<string> {
    const GATEWAY_URL = environment.apiGatewayUrl;

    // Table attachment API via backend proxy: single direct request (fast)
    const fetchFromTable$ = new Observable<string>(observer => {
      const url = `${GATEWAY_URL}/api/caspio-files/table-file?table=LPS_Type&recordId=${typeId}&fieldName=Icon`;

      fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/octet-stream' }
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to fetch icon: ${response.status}`);
        }
        return response.blob();
      })
      .then(blob => this.convertBlobToDataUrl(blob))
      .then(result => {
        observer.next(result);
        observer.complete();
      })
      .catch(error => {
        observer.error(error);
      });
    });

    const trimmedFileName = iconFileName?.trim();

    // Try table attachment first (single fast request), fall back to Files API
    if (trimmedFileName) {
      return fetchFromTable$.pipe(
        catchError(() => {
          return this.getImageFromFilesAPI(trimmedFileName);
        })
      );
    }

    return fetchFromTable$;
  }

  // Offers methods
  getOffersByCompany(companyId: string): Observable<any[]> {
    return this.get<any>(`/tables/LPS_Offers/records?q.where=CompanyID=${companyId}`).pipe(
      map(response => response.Result || [])
    );
  }

  // Services table methods
  getServicesByProject(projectId: string): Observable<any[]> {
    return this.get<any>(`/tables/LPS_Services/records?q.where=ProjectID=${projectId}`).pipe(
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
    return this.post<any>('/tables/LPS_Services/records?response=rows', serviceData).pipe(
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
    return this.delete<any>(`/tables/LPS_Services/records?q.where=PK_ID=${serviceId}`);
  }

  // Attach Templates methods
  getAttachTemplates(): Observable<any[]> {
    return this.get<any>('/tables/LPS_Attach_Templates/records').pipe(
      map(response => response.Result || [])
    );
  }

  // Services Visuals Templates methods
  getServicesVisualsTemplates(): Observable<any[]> {
    return this.get<any>('/tables/LPS_Services_Visuals_Templates/records').pipe(
      map(response => response.Result || [])
    );
  }

  // Get Services Visuals Templates filtered by TypeID
  getServicesVisualsTemplatesByTypeId(typeId: number): Observable<any[]> {
    // Use Caspio's query parameter to filter by TypeID
    const query = `TypeID=${typeId}`;
    return this.get<any>(`/tables/LPS_Services_Visuals_Templates/records?q.where=${encodeURIComponent(query)}`).pipe(
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
    return this.get<any>('/tables/LPS_Services_EFE_Templates/records').pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('EFE templates error:', error);
        return of([]);
      })
    );
  }

  // Services HUD Templates methods
  getServicesHUDTemplates(): Observable<any[]> {
    return this.get<any>('/tables/LPS_Services_HUD_Templates/records').pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('HUD templates error:', error);
        return of([]);
      })
    );
  }

  // Services LBW Templates methods
  getServicesLBWTemplates(): Observable<any[]> {
    return this.get<any>('/tables/LPS_Services_LBW_Templates/records').pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('LBW templates error:', error);
        return of([]);
      })
    );
  }
  
  // Services EFE methods
  getServicesEFE(serviceId: string): Observable<any[]> {
    const query = `ServiceID=${serviceId}`;
    // Add limit parameter to ensure we get all records (Caspio default might be limited)
    return this.get<any>(`/tables/LPS_Services_EFE/records?q.where=${encodeURIComponent(query)}&q.limit=1000`).pipe(
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
    return this.get<any>(`/tables/LPS_Services_EFE_Points/records?q.where=${encodeURIComponent(query)}`).pipe(
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
    return this.get<any>(`/tables/LPS_Services_EFE_Points/records?q.where=${encodeURIComponent(query)}`).pipe(
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
    return this.get<any>(`/tables/LPS_Services_EFE_Points_Attach/records?q.where=${encodeURIComponent(query)}`).pipe(
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
    return this.post<any>('/tables/LPS_Services_EFE/records?response=rows', data).pipe(
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
    const url = `/tables/LPS_Services_EFE/records?q.where=PK_ID=${efeId}`;

    return this.delete<any>(url).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('[CaspioService] Services EFE deletion error:', error);
        console.error('[CaspioService] Error details:', {
          status: error.status,
          message: error.message,
          error: error.error
        });
        throw error;
      })
    );
  }

  // Delete Services_EFE record by EFEID
  deleteServicesEFEByEFEID(efeId: string): Observable<any> {
    const url = `/tables/LPS_Services_EFE/records?q.where=EFEID=${efeId}`;

    return this.delete<any>(url).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('[CaspioService] Services EFE deletion error (by EFEID):', error);
        console.error('[CaspioService] Error details:', {
          status: error.status,
          message: error.message,
          error: error.error
        });
        throw error;
      })
    );
  }

  // Update Services_EFE record
  updateServicesEFE(efeId: string, data: any): Observable<any> {
    return this.put<any>(`/tables/LPS_Services_EFE/records?q.where=PK_ID=${efeId}`, data);
  }

  // Update Services_EFE record by EFEID (for FDF annotations/drawings)
  updateServicesEFEByEFEID(efeId: string, data: any): Observable<any> {

    // Log any Drawings fields specifically
    Object.keys(data).forEach(key => {
      if (key.includes('Drawings')) {
      }
    });

    const url = `/tables/LPS_Services_EFE/records?q.where=EFEID=${efeId}`;
    return this.put<any>(url, data).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('[CaspioService] Failed to update Services EFE record:', error);
        console.error('[CaspioService] Error details:', {
          status: error.status,
          message: error.message,
          error: error.error
        });
        return throwError(() => error);
      })
    );
  }
  
  // Get Services_EFE_Drop for dropdown options
  getServicesEFEDrop(): Observable<any[]> {
    return this.get<any>('/tables/LPS_Services_EFE_Drop/records').pipe(
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
    return this.get<any>('/tables/LPS_Services_Visuals_Drop/records').pipe(
      map(response => {
        if (response && response.Result) {
          return response.Result;
        }
        return [];
      })
    );
  }

  // Get Services_HUD_Drop for dropdown options
  getServicesHUDDrop(): Observable<any[]> {
    return this.get<any>('/tables/LPS_Services_HUD_Drop/records').pipe(
      map(response => {
        if (response && response.Result) {
          return response.Result;
        }
        return [];
      })
    );
  }

  // Get Services_LBW_Drop for dropdown options
  getServicesLBWDrop(): Observable<any[]> {
    return this.get<any>('/tables/LPS_Services_LBW_Drop/records').pipe(
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
    return this.get<any>('/tables/LPS_Services_Drop/records').pipe(
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
    return this.get<any>('/tables/LPS_Projects_Drop/records').pipe(
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
    return this.post<any>('/tables/LPS_Services_EFE_Points/records?response=rows', data).pipe(
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
    const url = `/tables/LPS_Services_EFE_Points/records?q.where=PointID=${pointId}`;
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
    const url = `/tables/LPS_Services_EFE_Points/records?q.where=PointID=${pointId}`;
    return this.delete<any>(url).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('Services EFE Points deletion error:', error);
        throw error;
      })
    );
  }
  
  // Create Services_EFE_Points_Attach record with file using S3
  createServicesEFEPointsAttachWithFile(pointId: number, drawingsData: string, file: File, photoType?: string): Observable<any> {
    return new Observable(observer => {
      this.uploadEFEPointsAttachWithS3(pointId, drawingsData, file, photoType)
        .then(result => {
          observer.next(result);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  // FAST UPLOAD: Create EFE Points attachment record immediately, then upload photo asynchronously
  // Step 1: Create the record with placeholder/pending status
  createServicesEFEPointsAttachRecord(pointId: number, drawingsData: string, photoType?: string): Observable<any> {
    return new Observable(observer => {
      this.createEFEPointsAttachRecordOnly(pointId, drawingsData, photoType)
        .then(result => {
          observer.next(result);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  private async createEFEPointsAttachRecordOnly(pointId: number, drawingsData: string, photoType?: string) {
    const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;

    try {
      const recordData: any = {
        PointID: parseInt(pointId.toString()),
        Annotation: '' // Empty annotation field
        // Photo field left empty - will be updated after upload
      };

      // Add Type field to identify Location vs Measurement photos
      if (photoType) {
        recordData.Type = photoType; // "Location" or "Measurement"
      }

      // Add Drawings field if we have annotation data
      if (drawingsData && drawingsData.length > 0) {
        recordData.Drawings = drawingsData;
      }

      const createResponse = await fetch(`${PROXY_BASE_URL}/tables/LPS_Services_EFE_Points_Attach/records?response=rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recordData)
      });

      const createResponseText = await createResponse.text();

      if (!createResponse.ok) {
        console.error('Failed to create Services_EFE_Points_Attach record:', createResponseText);
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

      const attachId = createResult.AttachID || createResult.PK_ID || createResult.id;

      return {
        ...createResult,
        AttachID: attachId,
        success: true
      };

    } catch (error: any) {
      console.error('[createEFEPointsAttachRecordOnly] ERROR:', error);
      throw error;
    }
  }

  // Step 2: Upload photo and update existing EFE Points record (S3)
  updateServicesEFEPointsAttachPhoto(attachId: number, file: File): Observable<any> {
    return new Observable(observer => {
      this.uploadAndUpdateEFEPointsAttachPhotoToS3(attachId, file)
        .then(result => {
          observer.next(result);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  // Legacy method for direct data posting (kept for backward compatibility)
  createServicesEFEAttach(data: any): Observable<any> {
    return this.post<any>('/tables/LPS_Services_EFE_Points_Attach/records?response=rows', data).pipe(
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

    const url = `/tables/LPS_Services_EFE_Points_Attach/records?q.where=AttachID=${attachId}`;
    return this.put<any>(url, data).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('[CaspioService] Failed to update EFE point annotation:', error);
        console.error('[CaspioService] Error details:', {
          status: error.status,
          message: error.message,
          error: error.error
        });
        return throwError(() => error);
      })
    );
  }
  
  // Delete Services_EFE_Points_Attach record
  deleteServicesEFEPointsAttach(attachId: string): Observable<any> {
    
    const url = `/tables/LPS_Services_EFE_Points_Attach/records?q.where=AttachID=${attachId}`;
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
    return this.post<any>('/tables/LPS_Services_Visuals/records?response=rows', visualData).pipe(
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
    const url = `/tables/LPS_Services_Visuals/records?q.where=VisualID=${visualId}`;
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
    return this.get<any>(`/tables/LPS_Services/records?q.where=PK_ID=${serviceId}`).pipe(
      map(response => {
        const result = response.Result;
        return result && result.length > 0 ? result[0] : null;
      })
    );
  }
  
  getServicesVisualsByServiceId(serviceId: string): Observable<any[]> {
    // Add limit parameter to ensure we get all records (Caspio default might be limited)
    return this.get<any>(`/tables/LPS_Services_Visuals/records?q.where=ServiceID=${serviceId}&q.limit=1000`).pipe(
      map(response => response.Result || [])
    );
  }
  
  deleteServicesVisual(visualId: string): Observable<any> {
    return this.delete<any>(`/tables/LPS_Services_Visuals/records?q.where=PK_ID=${visualId}`);
  }

  // Services HUD methods (for HUD template records)
  createServicesHUD(hudData: any): Observable<any> {
    return this.post<any>('/tables/LPS_Services_HUD/records?response=rows', hudData).pipe(
      tap(response => {
        if (response && response.Result && response.Result.length > 0) {
        }
      }),
      map(response => {
        if (response && response.Result && response.Result.length > 0) {
          return response.Result[0];
        }
        return response;
      }),
      catchError(error => {
        console.error('❌ Failed to create Services_HUD:', error);
        return throwError(() => error);
      })
    );
  }

  updateServicesHUD(hudId: string, hudData: any): Observable<any> {
    const url = `/tables/LPS_Services_HUD/records?q.where=HUDID=${hudId}`;
    return this.put<any>(url, hudData).pipe(
      catchError(error => {
        console.error('❌ Failed to update Services_HUD:', error);
        return throwError(() => error);
      })
    );
  }

  getServicesHUDByServiceId(serviceId: string, bypassCache: boolean = false): Observable<any[]> {
    return this.get<any>(`/tables/LPS_Services_HUD/records?q.where=ServiceID=${serviceId}&q.limit=1000`, !bypassCache).pipe(
      tap(response => {
      }),
      map(response => response.Result || [])
    );
  }

  /**
   * Get a single HUD record by its HUDID
   * Always bypasses cache to get fresh data
   */
  getServicesHUDById(hudId: string): Observable<any> {
    // Add timestamp to bust any HTTP/CDN caching
    const cacheBuster = Date.now();
    return this.get<any>(`/tables/LPS_Services_HUD/records?q.where=HUDID=${hudId}&_cb=${cacheBuster}`, false).pipe(
      tap(response => {
        if (response?.Result?.[0]) {
        }
      }),
      map(response => response.Result?.[0] || null)
    );
  }

  deleteServicesHUD(hudId: string): Observable<any> {
    return this.delete<any>(`/tables/LPS_Services_HUD/records?q.where=PK_ID=${hudId}`);
  }

  // Services_HUD_Attach methods (for HUD photos)
  getServiceHUDAttachByHUDId(hudId: string): Observable<any[]> {
    return this.get<any>(`/tables/LPS_Services_HUD_Attach/records?q.where=HUDID=${hudId}`).pipe(
      map(response => response.Result || [])
    );
  }

  createServicesHUDAttachWithFile(hudId: number, annotation: string, file: File, drawings?: string, originalFile?: File): Observable<any> {
    return new Observable(observer => {
      // Use new S3 upload method
      this.uploadHUDAttachWithS3(hudId, annotation, file, drawings, originalFile)
        .then(result => {
          observer.next(result);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  updateServicesHUDAttach(attachId: string, data: any): Observable<any> {
    const url = `/tables/LPS_Services_HUD_Attach/records?q.where=AttachID=${attachId}`;
    return this.put<any>(url, data);
  }

  updateServicesHUDAttachPhoto(attachId: number, file: File, originalFile?: File): Observable<any> {
    return new Observable(observer => {
      this.uploadAndUpdateHUDAttachPhotoToS3(attachId, file, originalFile)
        .then(result => {
          observer.next(result);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  createServicesHUDAttachRecord(hudId: number, annotation: string, drawings?: string): Observable<any> {
    return new Observable(observer => {
      this.createHUDAttachRecordOnly(hudId, annotation, drawings)
        .then(result => {
          observer.next(result);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  private async createHUDAttachRecordOnly(hudId: number, annotation: string, drawings?: string): Promise<any> {
    const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;
    const payload = {
      HUDID: hudId,
      Annotation: annotation || '',
      Drawings: drawings || ''
    };

    const response = await fetch(`${PROXY_BASE_URL}/tables/LPS_Services_HUD_Attach/records?response=rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HUD attach record creation failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result.Result && result.Result.length > 0 ? result.Result[0] : result;
  }

  deleteServicesHUDAttach(attachId: string): Observable<any> {
    return this.delete<any>(`/tables/LPS_Services_HUD_Attach/records?q.where=AttachID=${attachId}`);
  }

  // ============================================
  // S3 PHOTO UPLOAD METHODS (New Approach)
  // ============================================

  /**
   * Upload photo to S3 and update HUD attach record with S3 key
   * @param attachId - The AttachID of the record to update
   * @param file - The file to upload
   * @param originalFile - Optional original uncompressed file
   */
  async uploadAndUpdateHUDAttachPhotoToS3(attachId: number, file: File, originalFile?: File): Promise<any> {
    try {
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const fileExt = file.name.split('.').pop() || 'jpg';
      const uniqueFilename = `hud_attach_${attachId}_${timestamp}_${randomId}.${fileExt}`;

      // Upload to S3 via backend
      const formData = new FormData();
      formData.append('file', file, uniqueFilename);
      formData.append('tableName', 'LPS_Services_HUD_Attach');
      formData.append('attachId', attachId.toString());

      const uploadUrl = `${environment.apiGatewayUrl}/api/s3/upload`;
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('S3 upload failed:', errorText);
        throw new Error('Failed to upload file to S3: ' + errorText);
      }

      const uploadResult = await uploadResponse.json();
      const s3Key = uploadResult.s3Key;


      // Update the HUD attach record with the S3 key in Attachment field
      const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;

      const updateData: any = {
        Attachment: s3Key  // Store S3 key in Attachment field
      };

      const updateResponse = await fetch(`${PROXY_BASE_URL}/tables/LPS_Services_HUD_Attach/records?q.where=AttachID=${attachId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error('Failed to update Services_HUD_Attach record:', errorText);
        throw new Error('Failed to update record: ' + errorText);
      }


      return {
        AttachID: attachId,
        Attachment: s3Key,
        success: true
      };

    } catch (error) {
      console.error('Error in uploadAndUpdateHUDAttachPhotoToS3:', error);
      throw error;
    }
  }

  /**
   * Get pre-signed URL for S3 file
   * @param s3Key - The S3 key of the file
   */
  async getS3FileUrl(s3Key: string): Promise<string> {
    try {
      const url = `${environment.apiGatewayUrl}/api/s3/url?s3Key=${encodeURIComponent(s3Key)}`;
      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to get S3 pre-signed URL:', errorText);
        throw new Error('Failed to get file URL: ' + errorText);
      }

      const result = await response.json();
      return result.url;

    } catch (error) {
      console.error('Error getting S3 file URL:', error);
      throw error;
    }
  }

  /**
   * Check if a value is an S3 key (starts with 'uploads/')
   */
  isS3Key(value: string | null | undefined): boolean {
    return !!value && typeof value === 'string' && value.startsWith('uploads/');
  }

  /**
   * Delete file from S3
   * @param s3Key - The S3 key of the file to delete
   */
  async deleteS3File(s3Key: string): Promise<void> {
    try {
      const url = `${environment.apiGatewayUrl}/api/s3/file`;
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ s3Key })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to delete S3 file:', errorText);
        throw new Error('Failed to delete file: ' + errorText);
      }


    } catch (error) {
      console.error('Error deleting S3 file:', error);
      throw error;
    }
  }

  // ============================================
  // S3 UPLOAD METHODS FOR ALL _ATTACH TABLES
  // ============================================

  /**
   * Upload HUD attach photo to S3 (new S3-based flow)
   * @param hudId - The HUD ID
   * @param annotation - The caption/annotation text
   * @param file - The file to upload
   * @param drawings - Optional drawings/annotations data
   * @param originalFile - Optional original file before annotation
   */
  private async uploadHUDAttachWithS3(hudId: number, annotation: string, file: File, drawings?: string, originalFile?: File): Promise<any> {

    // VALIDATION: Reject empty or invalid files
    if (!file || file.size === 0) {
      console.error('[HUD ATTACH S3] ❌ REJECTING: Empty or missing file!');
      throw new Error('Cannot upload empty or missing file');
    }

    // US-001 FIX: Compress image before upload to avoid 413 Request Entity Too Large
    // API Gateway has size limits - compress to max 1MB to ensure uploads succeed
    let fileToUpload: File = file;
    const MAX_SIZE_MB = 1; // 1MB max to stay under API Gateway limits

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      try {
        const compressedBlob = await this.imageCompression.compressImage(file, {
          maxSizeMB: MAX_SIZE_MB,
          maxWidthOrHeight: 1920,
          useWebWorker: true
        });
        fileToUpload = new File([compressedBlob], file.name, { type: compressedBlob.type || 'image/jpeg' });
      } catch (compressErr) {
        console.warn('[HUD ATTACH S3] Compression failed, using original:', compressErr);
        // Continue with original file - may fail with 413 but worth trying
      }
    }

    try {
      // Prepare record data for Caspio
      const recordData: any = { HUDID: parseInt(hudId.toString()), Annotation: annotation || '' };
      if (drawings && drawings.length > 0) {
        let compressedDrawings = drawings;
        if (drawings.length > 50000) compressedDrawings = compressAnnotationData(drawings, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });
        if (compressedDrawings.length <= 64000) recordData.Drawings = compressedDrawings;
      }

      // US-002 FIX: ATOMIC UPLOAD - Upload to S3 FIRST, then create record with Attachment
      // This prevents orphaned records without Attachment field

      // Step 1: Generate unique filename and upload to S3 FIRST (before creating record)
      const timestamp = Date.now();
      const uniqueFilename = `hud_${hudId}_${timestamp}_${Math.random().toString(36).substring(2, 8)}.${file.name.split('.').pop() || 'jpg'}`;

      // Use a temporary placeholder attachId for S3 key generation (will be part of path)
      const tempAttachId = `pending_${timestamp}`;

      // US-001 FIX: S3 upload with retry for mobile failures
      const MAX_S3_RETRIES = 3;
      const INITIAL_RETRY_DELAY_MS = 500;

      let s3Key: string | null = null;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_S3_RETRIES; attempt++) {
        try {
          // Create fresh FormData for each attempt (FormData can only be consumed once)
          const formData = new FormData();
          formData.append('file', fileToUpload, uniqueFilename);
          formData.append('tableName', 'LPS_Services_HUD_Attach');
          formData.append('attachId', tempAttachId);


          const uploadResponse = await fetch(`${environment.apiGatewayUrl}/api/s3/upload`, { method: 'POST', body: formData });

          if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            console.error(`[HUD ATTACH S3] S3 upload failed (attempt ${attempt}):`, uploadResponse.status, errorText);
            throw new Error(`S3 upload failed: ${uploadResponse.status} - ${errorText?.substring(0, 100)}`);
          }

          const result = await uploadResponse.json();
          s3Key = result.s3Key;

          if (!s3Key) {
            throw new Error('S3 upload succeeded but no s3Key returned');
          }

          break; // Success - exit retry loop

        } catch (err: any) {
          lastError = err;
          console.warn(`[HUD ATTACH S3] S3 upload attempt ${attempt} failed:`, err?.message || err);

          if (attempt < MAX_S3_RETRIES) {
            const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
      }

      // Check if all retries failed
      if (!s3Key) {
        console.error('[HUD ATTACH S3] ❌ All S3 upload attempts failed');
        throw lastError || new Error('S3 upload failed after all retries');
      }

      // Step 2: Now create the Caspio record WITH the Attachment field populated
      // This ensures we NEVER create a record without an Attachment
      recordData.Attachment = s3Key;  // CRITICAL: Include Attachment in initial creation

      const recordResponse = await fetch(`${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_HUD_Attach/records?response=rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recordData)
      });

      if (!recordResponse.ok) {
        const errorText = await recordResponse.text();
        console.error('[HUD ATTACH S3] ❌ Record creation failed:', errorText);
        // S3 file was uploaded but record creation failed - file is orphaned in S3
        // This is acceptable - orphaned S3 files don't cause broken images in UI
        throw new Error(`HUD record creation failed (${recordResponse.status})`);
      }

      const attachId = (await recordResponse.json()).Result?.[0]?.AttachID;
      if (!attachId) {
        throw new Error('Failed to get AttachID from record creation response');
      }


      // Return result with all fields
      return {
        Result: [{
          AttachID: attachId,
          HUDID: hudId,
          Attachment: s3Key,
          Drawings: recordData.Drawings || '',
          Annotation: annotation || ''
        }],
        AttachID: attachId,
        Attachment: s3Key,
        Annotation: annotation || ''
      };
    } catch (error) {
      console.error('[HUD ATTACH S3] ❌ Failed:', error);
      throw error;
    }
  }

  /**
   * Upload EFE Points attach photo to S3
   * Public for BackgroundSyncService to call during offline sync
   * Uses AWS API Gateway proxy for all Caspio API calls
   */
  async uploadEFEPointsAttachWithS3(pointId: number, drawingsData: string, file: File, photoType?: string, caption?: string): Promise<any> {

    // CRITICAL: Validate PointID before proceeding
    const parsedPointId = parseInt(String(pointId), 10);
    if (isNaN(parsedPointId) || parsedPointId <= 0) {
      console.error('[EFE ATTACH S3] ❌ INVALID PointID:', pointId);
      throw new Error(`Invalid PointID for EFE photo upload: ${pointId}`);
    }

    // Use API Gateway proxy instead of direct Caspio API
    const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;

    try {
      // Prepare record data
      const recordData: any = {
        PointID: parsedPointId,
        Annotation: caption || ''
      };

      // Add Type field only if specified (field name is "Type", not "PhotoType")
      if (photoType) {
        recordData.Type = photoType;
      }

      if (drawingsData && drawingsData.length > 0) {
        let compressedDrawings = drawingsData;
        if (drawingsData.length > 50000) {
          compressedDrawings = compressAnnotationData(drawingsData, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });
        }
        if (compressedDrawings.length <= 64000) {
          recordData.Drawings = compressedDrawings;
        }
      }

      // US-002 FIX: ATOMIC UPLOAD - Upload to S3 FIRST, then create record with Attachment
      // This prevents orphaned records without Attachment field

      // Step 1: Generate unique filename and upload to S3 FIRST
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const fileExt = file.name.split('.').pop() || 'jpg';
      const uniqueFilename = `efe_${pointId}_${timestamp}_${randomId}.${fileExt}`;
      const tempAttachId = `pending_${timestamp}`;

      const formData = new FormData();
      formData.append('file', file, uniqueFilename);
      formData.append('tableName', 'LPS_Services_EFE_Points_Attach');
      formData.append('attachId', tempAttachId);

      const uploadResponse = await fetch(`${environment.apiGatewayUrl}/api/s3/upload`, { method: 'POST', body: formData });
      if (!uploadResponse.ok) {
        const uploadError = await uploadResponse.text();
        console.error('[EFE ATTACH S3] ❌ S3 upload failed:', uploadError);
        throw new Error('S3 upload failed');
      }
      const { s3Key } = await uploadResponse.json();

      // Step 2: Create the Caspio record WITH the Attachment field populated
      recordData.Attachment = s3Key;  // CRITICAL: Include Attachment in initial creation


      const recordResponse = await fetch(`${PROXY_BASE_URL}/tables/LPS_Services_EFE_Points_Attach/records?response=rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recordData)
      });

      if (!recordResponse.ok) {
        const errorText = await recordResponse.text();
        console.error('[EFE ATTACH S3] ❌ Record creation failed:', recordResponse.status, errorText);
        throw new Error(`EFE attach record creation failed: ${recordResponse.status}`);
      }

      const recordResult = await recordResponse.json();
      const attachId = recordResult.Result?.[0]?.AttachID || recordResult.AttachID;
      if (!attachId) {
        throw new Error('Failed to get AttachID from record creation response');
      }

      return { Result: [{ AttachID: attachId, PointID: pointId, Attachment: s3Key, Drawings: recordData.Drawings || '' }], AttachID: attachId, Attachment: s3Key };
    } catch (error) {
      console.error('[EFE ATTACH S3] ❌ Failed:', error);
      throw error;
    }
  }

  /**
   * Upload photo to S3 and update existing EFE Points attach record
   */
  private async uploadAndUpdateEFEPointsAttachPhotoToS3(attachId: number, file: File): Promise<any> {
    try {
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const fileExt = file.name.split('.').pop() || 'jpg';
      const uniqueFilename = `efe_point_${attachId}_${timestamp}_${randomId}.${fileExt}`;

      // Upload to S3
      const formData = new FormData();
      formData.append('file', file, uniqueFilename);
      formData.append('tableName', 'LPS_Services_EFE_Points_Attach');
      formData.append('attachId', attachId.toString());

      const uploadUrl = `${environment.apiGatewayUrl}/api/s3/upload`;
      const uploadResponse = await fetch(uploadUrl, { method: 'POST', body: formData });

      if (!uploadResponse.ok) throw new Error('S3 upload failed');

      const { s3Key } = await uploadResponse.json();

      // Update record with S3 key via API Gateway proxy
      const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;

      const updateResponse = await fetch(`${PROXY_BASE_URL}/tables/LPS_Services_EFE_Points_Attach/records?q.where=AttachID=${attachId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ Attachment: s3Key })
      });

      if (!updateResponse.ok) throw new Error('Failed to update record');

      return { AttachID: attachId, Attachment: s3Key, success: true };

    } catch (error) {
      console.error('[EFE ATTACH S3 UPDATE] ❌ Failed:', error);
      throw error;
    }
  }

  private async uploadLBWAttachWithS3(lbwId: number, annotation: string, file: File, drawings?: string): Promise<any> {

    // VALIDATION: Reject empty or invalid files
    if (!file || file.size === 0) {
      console.error('[LBW ATTACH S3] ❌ REJECTING: Empty or missing file!');
      throw new Error('Cannot upload empty or missing file');
    }

    // US-001 FIX: Compress image before upload to avoid 413 Request Entity Too Large
    // API Gateway has size limits - compress to max 1MB to ensure uploads succeed
    let fileToUpload: File = file;
    const MAX_SIZE_MB = 1; // 1MB max to stay under API Gateway limits

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      try {
        const compressedBlob = await this.imageCompression.compressImage(file, {
          maxSizeMB: MAX_SIZE_MB,
          maxWidthOrHeight: 1920,
          useWebWorker: true
        });
        fileToUpload = new File([compressedBlob], file.name, { type: compressedBlob.type || 'image/jpeg' });
      } catch (compressErr) {
        console.warn('[LBW ATTACH S3] Compression failed, using original:', compressErr);
        // Continue with original file - may fail with 413 but worth trying
      }
    }

    const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;

    try {
      // Prepare record data
      const recordData: any = { LBWID: parseInt(lbwId.toString()), Annotation: annotation || '' };
      if (drawings && drawings.length > 0) {
        let compressedDrawings = drawings;
        if (drawings.length > 50000) compressedDrawings = compressAnnotationData(drawings, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });
        if (compressedDrawings.length <= 64000) recordData.Drawings = compressedDrawings;
      }

      // US-002 FIX: ATOMIC UPLOAD - Upload to S3 FIRST, then create record with Attachment
      // This prevents orphaned records without Attachment field

      // Step 1: Generate unique filename and upload to S3 FIRST (with retry logic)
      const timestamp = Date.now();
      const uniqueFilename = `lbw_${lbwId}_${timestamp}_${Math.random().toString(36).substring(2, 8)}.${file.name.split('.').pop() || 'jpg'}`;
      const tempAttachId = `pending_${timestamp}`;

      // US-001 FIX: S3 upload with retry for mobile failures
      const MAX_S3_RETRIES = 3;
      const INITIAL_RETRY_DELAY_MS = 500;

      let s3Key: string | null = null;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_S3_RETRIES; attempt++) {
        try {
          // Create fresh FormData for each attempt (FormData can only be consumed once)
          const formData = new FormData();
          formData.append('file', fileToUpload, uniqueFilename);
          formData.append('tableName', 'LPS_Services_LBW_Attach');
          formData.append('attachId', tempAttachId);


          const uploadResponse = await fetch(`${environment.apiGatewayUrl}/api/s3/upload`, { method: 'POST', body: formData });

          if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            console.error(`[LBW ATTACH S3] S3 upload failed (attempt ${attempt}):`, uploadResponse.status, errorText);
            throw new Error(`S3 upload failed: ${uploadResponse.status} - ${errorText?.substring(0, 100)}`);
          }

          const result = await uploadResponse.json();
          s3Key = result.s3Key;

          if (!s3Key) {
            throw new Error('S3 upload succeeded but no s3Key returned');
          }

          break; // Success - exit retry loop

        } catch (err: any) {
          lastError = err;
          console.warn(`[LBW ATTACH S3] S3 upload attempt ${attempt} failed:`, err?.message || err);

          if (attempt < MAX_S3_RETRIES) {
            const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
      }

      // If all retries failed, throw the last error
      if (!s3Key) {
        console.error('[LBW ATTACH S3] ❌ All S3 upload attempts failed');
        throw lastError || new Error('S3 upload failed after all retries');
      }

      // Step 2: Create the Caspio record WITH the Attachment field populated
      recordData.Attachment = s3Key;  // CRITICAL: Include Attachment in initial creation

      const recordResponse = await fetch(`${PROXY_BASE_URL}/tables/LPS_Services_LBW_Attach/records?response=rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recordData)
      });

      if (!recordResponse.ok) {
        const errorText = await recordResponse.text();
        console.error('[LBW ATTACH S3] ❌ Record creation failed:', errorText);
        throw new Error(`LBW record creation failed: ${errorText?.substring(0, 100)}`);
      }

      const recordResult = await recordResponse.json();
      const attachId = recordResult.Result?.[0]?.AttachID;
      if (!attachId) {
        console.error('[LBW ATTACH S3] ❌ No AttachID in response:', JSON.stringify(recordResult).substring(0, 200));
        throw new Error('Failed to get AttachID from record creation response');
      }

      return { Result: [{ AttachID: attachId, LBWID: lbwId, Annotation: annotation, Attachment: s3Key, Drawings: recordData.Drawings || '' }], AttachID: attachId, Attachment: s3Key };
    } catch (error: any) {
      console.error('[LBW ATTACH S3] ❌ Failed:', error?.message || error);
      throw error;
    }
  }

  async uploadVisualsAttachWithS3(visualId: number, drawingsData: string, file: File, caption?: string): Promise<any> {

    // VALIDATION: Reject empty or invalid files
    if (!file || file.size === 0) {
      console.error('[VISUALS ATTACH S3] ❌ REJECTING: Empty or missing file!');
      throw new Error('Cannot upload empty or missing file');
    }

    // US-001 FIX: Compress image before upload to avoid 413 Request Entity Too Large
    // API Gateway has size limits - compress to max 1MB to ensure uploads succeed
    let fileToUpload: File = file;
    const MAX_SIZE_MB = 1; // 1MB max to stay under API Gateway limits

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      try {
        const compressedBlob = await this.imageCompression.compressImage(file, {
          maxSizeMB: MAX_SIZE_MB,
          maxWidthOrHeight: 1920,
          useWebWorker: true
        });
        fileToUpload = new File([compressedBlob], file.name, { type: compressedBlob.type || 'image/jpeg' });
      } catch (compressErr) {
        console.warn('[VISUALS ATTACH S3] Compression failed, using original:', compressErr);
        // Continue with original file - may fail with 413 but worth trying
      }
    }

    try {
      // Prepare record data for Caspio
      const recordData: any = { VisualID: parseInt(visualId.toString()), Annotation: caption || '' };
      if (drawingsData && drawingsData.length > 0) {
        let compressedDrawings = drawingsData;
        if (drawingsData.length > 50000) compressedDrawings = compressAnnotationData(drawingsData, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });
        if (compressedDrawings.length <= 64000) recordData.Drawings = compressedDrawings;
      }

      // US-002 FIX: ATOMIC UPLOAD - Upload to S3 FIRST, then create record with Attachment
      // This prevents orphaned records without Attachment field

      // Step 1: Generate unique filename and upload to S3 FIRST (before creating record)
      const timestamp = Date.now();
      const uniqueFilename = `visual_${visualId}_${timestamp}_${Math.random().toString(36).substring(2, 8)}.${file.name.split('.').pop() || 'jpg'}`;

      // Use a temporary placeholder attachId for S3 key generation (will be part of path)
      const tempAttachId = `pending_${timestamp}`;

      // US-001 FIX: S3 upload with retry for mobile failures
      const MAX_S3_RETRIES = 3;
      const INITIAL_RETRY_DELAY_MS = 500;

      let s3Key: string | null = null;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_S3_RETRIES; attempt++) {
        try {
          // Create fresh FormData for each attempt (FormData can only be consumed once)
          const formData = new FormData();
          formData.append('file', fileToUpload, uniqueFilename);
          formData.append('tableName', 'LPS_Services_Visuals_Attach');
          formData.append('attachId', tempAttachId);


          const uploadResponse = await fetch(`${environment.apiGatewayUrl}/api/s3/upload`, { method: 'POST', body: formData });

          if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text();
            console.error(`[VISUALS ATTACH S3] S3 upload failed (attempt ${attempt}):`, uploadResponse.status, errorText);
            throw new Error(`S3 upload failed: ${uploadResponse.status} - ${errorText?.substring(0, 100)}`);
          }

          const result = await uploadResponse.json();
          s3Key = result.s3Key;

          if (!s3Key) {
            throw new Error('S3 upload succeeded but no s3Key returned');
          }

          break; // Success - exit retry loop

        } catch (err: any) {
          lastError = err;
          console.warn(`[VISUALS ATTACH S3] S3 upload attempt ${attempt} failed:`, err?.message || err);

          if (attempt < MAX_S3_RETRIES) {
            const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
      }

      // Check if all retries failed
      if (!s3Key) {
        console.error('[VISUALS ATTACH S3] ❌ All S3 upload attempts failed');
        throw lastError || new Error('S3 upload failed after all retries');
      }

      // Step 2: Now create the Caspio record WITH the Attachment field populated
      // This ensures we NEVER create a record without an Attachment
      recordData.Attachment = s3Key;  // CRITICAL: Include Attachment in initial creation

      const recordResponse = await fetch(`${environment.apiGatewayUrl}/api/caspio-proxy/tables/LPS_Services_Visuals_Attach/records?response=rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recordData)
      });

      if (!recordResponse.ok) {
        const errorText = await recordResponse.text();
        console.error('[VISUALS ATTACH S3] ❌ Record creation failed:', errorText);
        // S3 file was uploaded but record creation failed - file is orphaned in S3
        // This is acceptable - orphaned S3 files don't cause broken images in UI
        throw new Error(`Visuals record creation failed (${recordResponse.status})`);
      }

      const attachId = (await recordResponse.json()).Result?.[0]?.AttachID;
      if (!attachId) {
        throw new Error('Failed to get AttachID from record creation response');
      }


      // Return result with all fields
      return {
        Result: [{
          AttachID: attachId,
          VisualID: visualId,
          Attachment: s3Key,
          Drawings: recordData.Drawings || '',
          Annotation: caption || ''
        }],
        AttachID: attachId,
        Attachment: s3Key,
        Annotation: caption || ''
      };
    } catch (error) {
      console.error('[VISUALS ATTACH S3] ❌ Failed:', error);
      throw error;
    }
  }

  private async uploadDTEAttachWithS3(dteId: number, annotation: string, file: File, drawings?: string): Promise<any> {
    const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;

    try {
      // Prepare record data
      const recordData: any = { DTEID: parseInt(dteId.toString()), Annotation: annotation || '' };
      if (drawings && drawings.length > 0) {
        let compressedDrawings = drawings;
        if (drawings.length > 50000) compressedDrawings = compressAnnotationData(drawings, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });
        if (compressedDrawings.length <= 64000) recordData.Drawings = compressedDrawings;
      }

      // US-002 FIX: ATOMIC UPLOAD - Upload to S3 FIRST, then create record with Attachment
      // This prevents orphaned records without Attachment field

      // Step 1: Generate unique filename and upload to S3 FIRST
      const timestamp = Date.now();
      const uniqueFilename = `dte_${dteId}_${timestamp}_${Math.random().toString(36).substring(2, 8)}.${file.name.split('.').pop() || 'jpg'}`;
      const tempAttachId = `pending_${timestamp}`;

      const formData = new FormData();
      formData.append('file', file, uniqueFilename);
      formData.append('tableName', 'LPS_Services_DTE_Attach');
      formData.append('attachId', tempAttachId);

      const uploadResponse = await fetch(`${environment.apiGatewayUrl}/api/s3/upload`, { method: 'POST', body: formData });
      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('[DTE ATTACH S3] ❌ S3 upload failed:', errorText);
        throw new Error('S3 upload failed');
      }
      const { s3Key } = await uploadResponse.json();

      // Step 2: Create the Caspio record WITH the Attachment field populated
      recordData.Attachment = s3Key;  // CRITICAL: Include Attachment in initial creation

      const recordResponse = await fetch(`${PROXY_BASE_URL}/tables/LPS_Services_DTE_Attach/records?response=rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recordData)
      });

      if (!recordResponse.ok) {
        const errorText = await recordResponse.text();
        console.error('[DTE ATTACH S3] ❌ Record creation failed:', errorText);
        throw new Error(`DTE record creation failed (${recordResponse.status})`);
      }

      const attachId = (await recordResponse.json()).Result?.[0]?.AttachID;
      if (!attachId) {
        throw new Error('Failed to get AttachID from record creation response');
      }

      return { Result: [{ AttachID: attachId, DTEID: dteId, Annotation: annotation, Attachment: s3Key, Drawings: recordData.Drawings || '' }], AttachID: attachId, Attachment: s3Key };
    } catch (error) {
      console.error('[DTE ATTACH S3] ❌ Failed:', error);
      throw error;
    }
  }

  // ============================================
  // LBW (Load Bearing Wall) API Methods
  // ============================================

  createServicesLBW(lbwData: any): Observable<any> {
    return this.post<any>('/tables/LPS_Services_LBW/records?response=rows', lbwData).pipe(
      tap(response => {
        if (response && response.Result && response.Result.length > 0) {
        }
      }),
      catchError(error => {
        console.error('❌ Failed to create Services_LPS:', error);
        return throwError(() => error);
      })
    );
  }

  updateServicesLBW(lbwId: string, lbwData: any): Observable<any> {
    const url = `/tables/LPS_Services_LBW/records?q.where=LBWID=${lbwId}`;
    return this.put<any>(url, lbwData).pipe(
      catchError(error => {
        console.error('❌ Failed to update Services_LPS:', error);
        return throwError(() => error);
      })
    );
  }

  getServicesLBWByServiceId(serviceId: string, bypassCache: boolean = false): Observable<any[]> {
    return this.get<any>(`/tables/LPS_Services_LBW/records?q.where=ServiceID=${serviceId}&q.limit=1000`, !bypassCache).pipe(
      map(response => response.Result || [])
    );
  }

  deleteServicesLBW(lbwId: string): Observable<any> {
    return this.delete<any>(`/tables/LPS_Services_LBW/records?q.where=PK_ID=${lbwId}`);
  }

  // Services_LPS_Attach methods (for LBW photos)
  getServiceLBWAttachByLBWId(lbwId: string, bypassCache: boolean = false): Observable<any[]> {
    return this.get<any>(`/tables/LPS_Services_LBW_Attach/records?q.where=LBWID=${lbwId}&q.limit=1000`, !bypassCache).pipe(
      map(response => response.Result || [])
    );
  }

  createServicesLBWAttachWithFile(lbwId: number, annotation: string, file: File, drawings?: string, originalFile?: File): Observable<any> {
    return new Observable(observer => {
      this.uploadLBWAttachWithS3(lbwId, annotation, file, drawings)
        .then(result => {
          observer.next(result);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  updateServicesLBWAttach(attachId: string, data: any): Observable<any> {
    const url = `/tables/LPS_Services_LBW_Attach/records?q.where=AttachID=${attachId}`;
    return this.put<any>(url, data);
  }

  updateServicesLBWAttachPhoto(attachId: number, file: File, originalFile?: File): Observable<any> {
    return new Observable(observer => {
      this.uploadAndUpdateLBWAttachPhoto(attachId, file, originalFile)
        .then(result => {
          observer.next(result);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  createServicesLBWAttachRecord(lbwId: number, annotation: string, drawings?: string): Observable<any> {
    return new Observable(observer => {
      this.createLBWAttachRecordOnly(lbwId, annotation, drawings)
        .then(result => {
          observer.next(result);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  deleteServicesLBWAttach(attachId: string): Observable<any> {
    return this.delete<any>(`/tables/LPS_Services_LBW_Attach/records?q.where=AttachID=${attachId}`);
  }

  private async uploadAndUpdateLBWAttachPhoto(attachId: number, file: File, originalFile?: File): Promise<any> {
    const GATEWAY_URL = environment.apiGatewayUrl;
    const PROXY_BASE_URL = `${GATEWAY_URL}/api/caspio-proxy`;

    try {
      let filePath = '';
      let originalFilePath = '';

      // Upload original file first if present
      if (originalFile) {
        const originalFormData = new FormData();
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 8);
        const fileExt = originalFile.name.split('.').pop() || 'jpg';
        const originalFileName = `lbw_attach_${attachId}_original_${timestamp}_${randomId}.${fileExt}`;
        originalFormData.append('file', originalFile, originalFileName);

        const originalUploadResponse = await fetch(`${GATEWAY_URL}/api/caspio-files/upload`, {
          method: 'POST',
          body: originalFormData
        });

        if (originalUploadResponse.ok) {
          const originalUploadResult = await originalUploadResponse.json();
          originalFilePath = `/${originalUploadResult.Name || originalFileName}`;
        }
      }

      // Upload main file via backend proxy
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const fileExt = file.name.split('.').pop() || 'jpg';
      const uniqueFilename = `lbw_attach_${attachId}_${timestamp}_${randomId}.${fileExt}`;

      const formData = new FormData();
      formData.append('file', file, uniqueFilename);

      const uploadResponse = await fetch(`${GATEWAY_URL}/api/caspio-files/upload`, {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error('Failed to upload file to Files API: ' + errorText);
      }

      const uploadResult = await uploadResponse.json();
      filePath = `/${uploadResult.Name || uniqueFilename}`;

      // Update the LBW attach record with the photo path
      const updateData: any = {
        Photo: originalFilePath || filePath
      };

      const updateResponse = await fetch(`${PROXY_BASE_URL}/tables/LPS_Services_LBW_Attach/records?q.where=AttachID=${attachId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        throw new Error('Failed to update record: ' + errorText);
      }

      return {
        AttachID: attachId,
        Photo: originalFilePath || filePath,
        OriginalPhoto: originalFilePath
      };

    } catch (error) {
      console.error('Error in uploadAndUpdateLBWAttachPhoto:', error);
      throw error;
    }
  }

  private async createLBWAttachRecordOnly(lbwId: number, annotation: string, drawings?: string): Promise<any> {
    const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;
    const payload = {
      LBWID: lbwId,
      Annotation: annotation || '',
      Drawings: drawings || ''
    };

    const response = await fetch(`${PROXY_BASE_URL}/tables/LPS_Services_LBW_Attach/records?response=rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`LBW attach record creation failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result.Result && result.Result.length > 0 ? result.Result[0] : result;
  }

  // ============================================
  // DTE (Damaged Truss Evaluation) API Methods
  // ============================================

  // Templates
  getServicesDTETemplates(): Observable<any[]> {
    return this.get<any>('/tables/LPS_Services_DTE_Templates/records').pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('DTE templates error:', error);
        return of([]);
      })
    );
  }

  // Dropdown Options
  getServicesDTEDrop(): Observable<any[]> {
    return this.get<any>('/tables/LPS_Services_DTE_Drop/records').pipe(
      map(response => {
        if (response && response.Result) {
          return response.Result;
        }
        return [];
      })
    );
  }

  // Main Records (CRUD)
  createServicesDTE(dteData: any): Observable<any> {
    return this.post<any>('/tables/LPS_Services_DTE/records?response=rows', dteData).pipe(
      tap(response => {
        if (response && response.Result && response.Result.length > 0) {
        }
      }),
      map(response => {
        if (response && response.Result && response.Result.length > 0) {
          return response.Result[0];
        }
        return response;
      }),
      catchError(error => {
        console.error('❌ Failed to create Services_DTE:', error);
        return throwError(() => error);
      })
    );
  }

  updateServicesDTE(dteId: string, dteData: any): Observable<any> {
    const url = `/tables/LPS_Services_DTE/records?q.where=DTEID=${dteId}`;
    return this.put<any>(url, dteData).pipe(
      catchError(error => {
        console.error('❌ Failed to update Services_DTE:', error);
        return throwError(() => error);
      })
    );
  }

  getServicesDTEByServiceId(serviceId: string, bypassCache: boolean = false): Observable<any[]> {
    return this.get<any>(`/tables/LPS_Services_DTE/records?q.where=ServiceID=${serviceId}&q.limit=1000`, !bypassCache).pipe(
      map(response => response.Result || [])
    );
  }

  /**
   * Get a single DTE record by its DTEID
   * Always bypasses cache to get fresh data
   */
  getServicesDTEById(dteId: string): Observable<any> {
    // Add timestamp to bust any HTTP/CDN caching
    const cacheBuster = Date.now();
    return this.get<any>(`/tables/LPS_Services_DTE/records?q.where=DTEID=${dteId}&_cb=${cacheBuster}`, false).pipe(
      tap(response => {
        if (response?.Result?.[0]) {
        }
      }),
      map(response => response.Result?.[0] || null)
    );
  }

  deleteServicesDTE(dteId: string): Observable<any> {
    return this.delete<any>(`/tables/LPS_Services_DTE/records?q.where=PK_ID=${dteId}`);
  }

  // Attachments (Photos)
  getServiceDTEAttachByDTEId(dteId: string): Observable<any[]> {
    return this.get<any>(`/tables/LPS_Services_DTE_Attach/records?q.where=DTEID=${dteId}&q.limit=1000`).pipe(
      map(response => response.Result || [])
    );
  }

  createServicesDTEAttachWithFile(dteId: number, annotation: string, file: File, drawings?: string, originalFile?: File): Observable<any> {
    return new Observable(observer => {
      this.uploadDTEAttachWithS3(dteId, annotation, file, drawings)
        .then(result => {
          observer.next(result);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  updateServicesDTEAttach(attachId: string, data: any): Observable<any> {
    const url = `/tables/LPS_Services_DTE_Attach/records?q.where=AttachID=${attachId}`;
    return this.put<any>(url, data);
  }

  updateServicesDTEAttachPhoto(attachId: number, file: File, originalFile?: File): Observable<any> {
    return new Observable(observer => {
      this.uploadAndUpdateDTEAttachPhoto(attachId, file, originalFile)
        .then(result => {
          observer.next(result);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  createServicesDTEAttachRecord(dteId: number, annotation: string, drawings?: string): Observable<any> {
    return new Observable(observer => {
      this.createDTEAttachRecordOnly(dteId, annotation, drawings)
        .then(result => {
          observer.next(result);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  deleteServicesDTEAttach(attachId: string): Observable<any> {
    return this.delete<any>(`/tables/LPS_Services_DTE_Attach/records?q.where=AttachID=${attachId}`);
  }

  private async uploadAndUpdateDTEAttachPhoto(attachId: number, file: File, originalFile?: File): Promise<any> {
    const GATEWAY_URL = environment.apiGatewayUrl;
    const PROXY_BASE_URL = `${GATEWAY_URL}/api/caspio-proxy`;

    try {
      let filePath = '';
      let originalFilePath = '';

      // Upload original file first if present
      if (originalFile) {
        const originalFormData = new FormData();
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 8);
        const fileExt = originalFile.name.split('.').pop() || 'jpg';
        const originalFileName = `dte_attach_${attachId}_original_${timestamp}_${randomId}.${fileExt}`;
        originalFormData.append('file', originalFile, originalFileName);

        const originalUploadResponse = await fetch(`${GATEWAY_URL}/api/caspio-files/upload`, {
          method: 'POST',
          body: originalFormData
        });

        if (originalUploadResponse.ok) {
          const originalUploadResult = await originalUploadResponse.json();
          originalFilePath = `/${originalUploadResult.Name || originalFileName}`;
        }
      }

      // Upload main file via backend proxy
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const fileExt = file.name.split('.').pop() || 'jpg';
      const uniqueFilename = `dte_attach_${attachId}_${timestamp}_${randomId}.${fileExt}`;

      const formData = new FormData();
      formData.append('file', file, uniqueFilename);

      const uploadResponse = await fetch(`${GATEWAY_URL}/api/caspio-files/upload`, {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error('Failed to upload file to Files API: ' + errorText);
      }

      const uploadResult = await uploadResponse.json();
      filePath = `/${uploadResult.Name || uniqueFilename}`;

      // Update the DTE attach record with the photo path
      const updateData: any = {
        Photo: originalFilePath || filePath
      };

      const updateResponse = await fetch(`${PROXY_BASE_URL}/tables/LPS_Services_DTE_Attach/records?q.where=AttachID=${attachId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        throw new Error('Failed to update record: ' + errorText);
      }

      return {
        AttachID: attachId,
        Photo: originalFilePath || filePath,
        OriginalPhoto: originalFilePath
      };

    } catch (error) {
      console.error('Error in uploadAndUpdateDTEAttachPhoto:', error);
      throw error;
    }
  }

  private async createDTEAttachRecordOnly(dteId: number, annotation: string, drawings?: string): Promise<any> {
    const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;
    const payload = {
      DTEID: dteId,
      Annotation: annotation || '',
      Drawings: drawings || ''
    };

    const response = await fetch(`${PROXY_BASE_URL}/tables/LPS_Services_DTE_Attach/records?response=rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`DTE attach record creation failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result.Result && result.Result.length > 0 ? result.Result[0] : result;
  }

  // ============================================
  // CSA (Cost Segregation Analysis) API Methods
  // ============================================

  // Templates
  getServicesCSATemplates(): Observable<any[]> {
    return this.get<any>('/tables/LPS_Services_CSA_Templates/records').pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('CSA templates error:', error);
        return of([]);
      })
    );
  }

  // Dropdown Options
  getServicesCSADrop(): Observable<any[]> {
    return this.get<any>('/tables/LPS_Services_CSA_Drop/records').pipe(
      map(response => {
        if (response && response.Result) {
          return response.Result;
        }
        return [];
      })
    );
  }

  // Main Records (CRUD)
  createServicesCSA(csaData: any): Observable<any> {
    return this.post<any>('/tables/LPS_Services_CSA/records?response=rows', csaData).pipe(
      tap(response => {
        if (response && response.Result && response.Result.length > 0) {
        }
      }),
      map(response => {
        if (response && response.Result && response.Result.length > 0) {
          return response.Result[0];
        }
        return response;
      }),
      catchError(error => {
        console.error('❌ Failed to create Services_CSA:', error);
        return throwError(() => error);
      })
    );
  }

  updateServicesCSA(csaId: string, csaData: any): Observable<any> {
    const url = `/tables/LPS_Services_CSA/records?q.where=CSAID=${csaId}`;
    return this.put<any>(url, csaData).pipe(
      catchError(error => {
        console.error('❌ Failed to update Services_CSA:', error);
        return throwError(() => error);
      })
    );
  }

  getServicesCSAByServiceId(serviceId: string, bypassCache: boolean = false): Observable<any[]> {
    return this.get<any>(`/tables/LPS_Services_CSA/records?q.where=ServiceID=${serviceId}&q.limit=1000`, !bypassCache).pipe(
      map(response => response.Result || [])
    );
  }

  /**
   * Get a single CSA record by its CSAID
   * Always bypasses cache to get fresh data
   */
  getServicesCSAById(csaId: string): Observable<any> {
    // Add timestamp to bust any HTTP/CDN caching
    const cacheBuster = Date.now();
    return this.get<any>(`/tables/LPS_Services_CSA/records?q.where=CSAID=${csaId}&_cb=${cacheBuster}`, false).pipe(
      tap(response => {
        if (response?.Result?.[0]) {
        }
      }),
      map(response => response.Result?.[0] || null)
    );
  }

  deleteServicesCSA(csaId: string): Observable<any> {
    return this.delete<any>(`/tables/LPS_Services_CSA/records?q.where=PK_ID=${csaId}`);
  }

  // Attachments (Photos)
  getServiceCSAAttachByCSAId(csaId: string): Observable<any[]> {
    return this.get<any>(`/tables/LPS_Services_CSA_Attach/records?q.where=CSAID=${csaId}&q.limit=1000`).pipe(
      map(response => response.Result || [])
    );
  }

  updateServicesCSAAttach(attachId: string, data: any): Observable<any> {
    const url = `/tables/LPS_Services_CSA_Attach/records?q.where=AttachID=${attachId}`;
    return this.put<any>(url, data);
  }

  deleteServicesCSAAttach(attachId: string): Observable<any> {
    return this.delete<any>(`/tables/LPS_Services_CSA_Attach/records?q.where=AttachID=${attachId}`);
  }

  createServicesCSAAttachWithFile(csaId: number, annotation: string, file: File, drawings?: string, originalFile?: File): Observable<any> {
    return new Observable(observer => {
      this.uploadCSAAttachWithS3(csaId, annotation, file, drawings)
        .then(result => {
          observer.next(result);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  private async uploadCSAAttachWithS3(csaId: number, annotation: string, file: File, drawings?: string): Promise<any> {
    try {
      // Prepare record data
      const recordData: any = { CSAID: parseInt(csaId.toString()), Annotation: annotation || '' };
      if (drawings && drawings.length > 0) {
        let compressedDrawings = drawings;
        if (drawings.length > 50000) compressedDrawings = compressAnnotationData(drawings, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });
        if (compressedDrawings.length <= 64000) recordData.Drawings = compressedDrawings;
      }

      // US-002 FIX: ATOMIC UPLOAD - Upload to S3 FIRST, then create record with Attachment
      // This prevents orphaned records without Attachment field

      // Step 1: Generate unique filename and upload to S3 FIRST
      const timestamp = Date.now();
      const uniqueFilename = `csa_${csaId}_${timestamp}_${Math.random().toString(36).substring(2, 8)}.${file.name.split('.').pop() || 'jpg'}`;
      const tempAttachId = `pending_${timestamp}`;

      const formData = new FormData();
      formData.append('file', file, uniqueFilename);
      formData.append('tableName', 'LPS_Services_CSA_Attach');
      formData.append('attachId', tempAttachId);


      const uploadResponse = await fetch(`${environment.apiGatewayUrl}/api/s3/upload`, { method: 'POST', body: formData });
      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('[CSA ATTACH S3] ❌ S3 upload failed:', errorText);
        throw new Error('S3 upload failed');
      }
      const { s3Key } = await uploadResponse.json();

      // Step 2: Create the Caspio record WITH the Attachment field populated
      recordData.Attachment = s3Key;  // CRITICAL: Include Attachment in initial creation


      const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;
      const recordResponse = await fetch(`${PROXY_BASE_URL}/tables/LPS_Services_CSA_Attach/records?response=rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recordData)
      });

      if (!recordResponse.ok) {
        const errorText = await recordResponse.text();
        console.error('[CSA ATTACH S3] ❌ Record creation failed:', errorText);
        throw new Error(`CSA record creation failed (${recordResponse.status})`);
      }

      const attachId = (await recordResponse.json()).Result?.[0]?.AttachID;
      if (!attachId) {
        throw new Error('Failed to get AttachID from record creation response');
      }


      // Return result with all fields
      return {
        Result: [{
          AttachID: attachId,
          CSAID: csaId,
          Attachment: s3Key,
          Drawings: recordData.Drawings || '',
          Annotation: annotation || ''
        }],
        AttachID: attachId,
        Attachment: s3Key,
        Annotation: annotation || ''
      };
    } catch (error) {
      console.error('[CSA ATTACH S3] ❌ Failed:', error);
      throw error;
    }
  }

  // Service_Visuals_Attach methods (for photos)
  createServiceVisualsAttach(attachData: any): Observable<any> {
    return this.post<any>('/tables/LPS_Service_Visuals_Attach/records', attachData).pipe(
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
      
      this.post<any>('/tables/LPS_Service_Visuals_Attach/records', attachData).subscribe({
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
          
          const updateUrl = `/tables/LPS_Service_Visuals_Attach/records?q.where=PK_ID=${attachId}`;
          
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
    return this.get<any>(`/tables/LPS_Services_Visuals_Attach/records?q.where=VisualID=${visualId}`).pipe(
      map(response => response.Result || [])
    );
  }
  
  // Update Services_Visuals_Attach record (for caption/annotation updates)
  updateServicesVisualsAttach(attachId: string, data: any): Observable<any> {
    // Validate AttachID is a valid number
    const attachIdNum = typeof attachId === 'string' ? parseInt(attachId, 10) : attachId;
    if (isNaN(attachIdNum)) {
      console.error('[CaspioService] Invalid AttachID for annotation update:', attachId);
      return throwError(() => new Error(`Invalid AttachID: ${attachId}`));
    }
    
    
    const url = `/tables/LPS_Services_Visuals_Attach/records?q.where=AttachID=${attachIdNum}`;
    return this.put<any>(url, data).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('[CaspioService] Annotation update FAILED for AttachID:', attachIdNum, error);
        return throwError(() => error);
      })
    );
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
      const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;
      const endpoint = `/tables/LPS_Services_Visuals_Attach/records?q.where=AttachID=${attachIdNum}`;
      const fullUrl = `${PROXY_BASE_URL}${endpoint}`;

      // Use fetch directly like the CREATE operation does
      fetch(fullUrl, {
        method: 'PUT',
        headers: {
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
    return this.delete<any>(`/tables/LPS_Services_Visuals_Attach/records?q.where=AttachID=${attachId}`);
  }
  
  // Upload file to Caspio Files API via backend proxy
  uploadFile(file: File, customFileName?: string): Observable<any> {
    const GATEWAY_URL = environment.apiGatewayUrl;
    const fileName = customFileName || file.name;
    const formData = new FormData();
    formData.append('file', file, fileName);

    return new Observable(observer => {
      fetch(`${GATEWAY_URL}/api/caspio-files/upload`, {
        method: 'POST',
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
    return this.get<any>(`/tables/LPS_Attach/records?q.where=ProjectID=${projectId}%20AND%20TypeID=${typeId}`).pipe(
      map(response => response.Result || [])
    );
  }
  
  // Get single attachment by ID
  getAttachment(attachId: string): Observable<any> {
    return this.get<any>(`/tables/LPS_Attach/records?q.where=AttachID=${attachId}`).pipe(
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
    const GATEWAY_URL = environment.apiGatewayUrl;

    return new Observable(observer => {
      // Clean the file path
      const cleanPath = filePath.startsWith('/') ? filePath : `/${filePath}`;

      // Fetch via backend proxy (cache-busted to avoid stale cached responses)
      fetch(`${GATEWAY_URL}/api/caspio-files/download?filePath=${encodeURIComponent(cleanPath)}&_t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store'
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
    const GATEWAY_URL = environment.apiGatewayUrl;

    // IMPORTANT: Cache disabled to prevent duplication
    // DO NOT use normalized/lowercase paths

    return new Observable<string>(observer => {
      // If the path is just a filename (no "/" anywhere), try common icon folders
      const isJustFilename = !filePath.includes('/');
      const generateFilenameVariants = (filename: string): string[] => {
        const variants = new Set<string>();
        const trimmed = filename.trim().replace(/^\/+/, '');
        variants.add(trimmed);

        const dotIndex = trimmed.lastIndexOf('.');
        const hasExtension = dotIndex > 0 && dotIndex < trimmed.length - 1;
        const baseName = hasExtension ? trimmed.substring(0, dotIndex) : trimmed;
        const extension = hasExtension ? trimmed.substring(dotIndex + 1) : '';

        const extensionVariants = extension
          ? [extension.toLowerCase(), extension.toUpperCase()]
          : [''];

        const baseVariantsSeed = new Set<string>();
        baseVariantsSeed.add(baseName);
        baseVariantsSeed.add(baseName.replace(/\s+/g, '_'));
        baseVariantsSeed.add(baseName.replace(/\s+/g, ''));
        baseVariantsSeed.add(baseName.replace(/[\s-]+/g, '-'));
        baseVariantsSeed.add(baseName.replace(/[\s-]+/g, '_'));
        baseVariantsSeed.add(baseName.replace(/-/g, ''));

        baseVariantsSeed.forEach(variant => variants.add(variant));

        const combinedVariants = new Set<string>();
        if (extensionVariants.length === 1 && extensionVariants[0] === '') {
          variants.forEach(variant => combinedVariants.add(variant));
        } else {
          baseVariantsSeed.forEach(baseVariant => {
            extensionVariants.forEach(extVariant => {
              if (extVariant) {
                combinedVariants.add(`${baseVariant}.${extVariant}`);
              }
            });
          });
        }

        variants.forEach(variant => combinedVariants.add(variant));
        return Array.from(combinedVariants);
      };

      const filenameVariants = isJustFilename ? generateFilenameVariants(filePath) : [filePath];
      const pathPrefixes = ['/Icons', '/images', '/icons', ''];
      const pathsToTry = isJustFilename
        ? Array.from(new Set(pathPrefixes.flatMap(prefix => {
            return filenameVariants.map(variant => {
              const cleanedVariant = variant.replace(/^\/+/, '');
              const basePath = prefix ? `${prefix}/${cleanedVariant}` : `/${cleanedVariant}`;
              return basePath.replace(/\/{2,}/g, '/');
            });
          })))
        : [filePath.startsWith('/') ? filePath : `/${filePath}`];


      // Try each path in sequence
      const tryNextPath = (index: number): void => {
        if (index >= pathsToTry.length) {
          const error = new Error(`Failed to fetch image from any location - Path: "${filePath}"`);
          console.error(`[Files API] All ${pathsToTry.length} path attempts failed for "${filePath}"`);
          console.error(`   Tried paths:`, pathsToTry);
          observer.error(error);
          return;
        }

        const cleanPath = pathsToTry[index];
        const fullUrl = `${GATEWAY_URL}/api/caspio-files/download?filePath=${encodeURIComponent(cleanPath)}`;

        fetch(fullUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/octet-stream' }
        })
        .then(response => {
          if (!response.ok) {
            // If this path failed, try the next one
            console.warn(`[Files API] Attempt ${index + 1} failed - Status ${response.status}: "${cleanPath}"`);
            tryNextPath(index + 1);
            return null;
          }
          return response.blob();
        })
        .then(blob => {
          if (blob) {
            return this.convertBlobToDataUrl(blob);
          }
          return null;
        })
        .then(result => {
          if (result) {
            observer.next(result);
            observer.complete();
          }
        })
        .catch(error => {
          // Error in this attempt, try next path
          console.warn(`[Files API] Error on attempt ${index + 1}: "${cleanPath}"`, error?.message || error);
          tryNextPath(index + 1);
        });
      };

      // Start trying paths
      tryNextPath(0);
    });
  }

  // [PERFORMANCE] New method to return blob directly without base64 conversion
  // Eliminates 33% bandwidth overhead from base64 encoding
  getImageBlobFromFilesAPI(filePath: string): Observable<Blob> {
    const GATEWAY_URL = environment.apiGatewayUrl;

    return new Observable<Blob>(observer => {
      // If the path is just a filename (no "/" anywhere), try common icon folders
      const isJustFilename = !filePath.includes('/');
      const pathsToTry = isJustFilename
        ? [
            `/Icons/${filePath}`,           // Try Icons folder first
            `/images/${filePath}`,          // Try images folder
            `/icons/${filePath}`,           // Try lowercase icons folder
            `/${filePath}`                  // Finally try root
          ]
        : [filePath.startsWith('/') ? filePath : `/${filePath}`]; // Use path as-is if it has folders

      // Try each path in sequence
      const tryNextPath = (index: number): void => {
        if (index >= pathsToTry.length) {
          const error = new Error(`Failed to fetch blob from any location - Path: "${filePath}"`);
          observer.error(error);
          return;
        }

        const cleanPath = pathsToTry[index];
        const fullUrl = `${GATEWAY_URL}/api/caspio-files/download?filePath=${encodeURIComponent(cleanPath)}`;

        fetch(fullUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/octet-stream' }
        })
        .then(response => {
          if (!response.ok) {
            // If this path failed, try the next one
            tryNextPath(index + 1);
            return null;
          }
          return response.blob();
        })
        .then(blob => {
          if (blob) {
            observer.next(blob);
            observer.complete();
          }
        })
        .catch(error => {
          // Error in this attempt, try next path
          tryNextPath(index + 1);
        });
      };

      // Start trying paths
      tryNextPath(0);
    });
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
        // IMPORTANT: Blobs are NOT transferable - don't include in transfer list
        // Only ArrayBuffer, MessagePort, and ImageBitmap can be transferred
        worker.postMessage({ id: taskId, type: 'BLOB_TO_DATA_URL', blob });
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

  // Create Services_Visuals_Attach with file using S3
  createServicesVisualsAttachWithFile(visualId: number, annotation: string, file: File, drawings?: string, originalFile?: File): Observable<any> {
    return new Observable(observer => {
      // Now passing annotation (caption) to uploadVisualsAttachWithS3
      this.uploadVisualsAttachWithS3(visualId, drawings || '', file, annotation)
        .then(result => {
          observer.next(result);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  // FAST UPLOAD: Create attachment record immediately, then upload photo asynchronously
  // Step 1: Create the record with placeholder/pending status
  createServicesVisualsAttachRecord(visualId: number, annotation: string, drawings?: string): Observable<any> {
    return new Observable(observer => {
      this.createVisualsAttachRecordOnly(visualId, annotation, drawings)
        .then(result => {
          observer.next(result);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  private async createVisualsAttachRecordOnly(visualId: number, annotation: string, drawings?: string) {
    const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;

    try {
      const recordData: any = {
        VisualID: parseInt(visualId.toString()),
        Annotation: annotation || '',
        // Photo field left empty - will be updated after upload
      };

      // Add Drawings field if annotation data is provided
      if (drawings && drawings.length > 0) {
        let compressedDrawings = drawings;

        // Compress if needed
        if (drawings.length > 50000) {
          compressedDrawings = compressAnnotationData(drawings, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });
        }

        // Only add if within field limit
        if (compressedDrawings.length <= 64000) {
          recordData.Drawings = compressedDrawings;
        } else {
          console.warn('Drawings data too large after compression, skipping');
        }
      }

      const createResponse = await fetch(`${PROXY_BASE_URL}/tables/LPS_Services_Visuals_Attach/records?response=rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

      const attachId = createResult.AttachID || createResult.PK_ID || createResult.id;

      return {
        ...createResult,
        AttachID: attachId,
        success: true
      };

    } catch (error: any) {
      console.error('[createVisualsAttachRecordOnly] ERROR:', error);
      throw error;
    }
  }

  // Step 2: Upload photo and update existing record
  updateServicesVisualsAttachPhoto(attachId: number, file: File, originalFile?: File): Observable<any> {
    return new Observable(observer => {
      this.uploadAndUpdateVisualsAttachPhoto(attachId, file, originalFile)
        .then(result => {
          observer.next(result);
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  private async uploadAndUpdateVisualsAttachPhoto(attachId: number, file: File, originalFile?: File) {
    const GATEWAY_URL = environment.apiGatewayUrl;
    const PROXY_BASE_URL = `${GATEWAY_URL}/api/caspio-proxy`;

    try {
      let filePath = '';
      let originalFilePath = '';

      // Upload original file first if present
      if (originalFile) {
        const originalFormData = new FormData();
        const timestamp = Date.now();
        const randomId = Math.random().toString(36).substring(2, 8);
        const fileExt = originalFile.name.split('.').pop() || 'jpg';
        const originalFileName = `visual_attach_${attachId}_original_${timestamp}_${randomId}.${fileExt}`;
        originalFormData.append('file', originalFile, originalFileName);

        const originalUploadResponse = await fetch(`${GATEWAY_URL}/api/caspio-files/upload`, {
          method: 'POST',
          body: originalFormData
        });

        if (originalUploadResponse.ok) {
          const originalUploadResult = await originalUploadResponse.json();
          originalFilePath = `/${originalUploadResult.Name || originalFileName}`;
        }
      }

      // Upload main file via backend proxy
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const fileExt = file.name.split('.').pop() || 'jpg';
      const uniqueFilename = `visual_attach_${attachId}_${timestamp}_${randomId}.${fileExt}`;

      const formData = new FormData();
      formData.append('file', file, uniqueFilename);

      const uploadResponse = await fetch(`${GATEWAY_URL}/api/caspio-files/upload`, {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('Files API upload failed:', errorText);
        throw new Error('Failed to upload file to Files API: ' + errorText);
      }

      const uploadResult = await uploadResponse.json();
      filePath = `/${uploadResult.Name || uniqueFilename}`;

      // Update the record with the photo path
      const updateData: any = {
        Photo: originalFilePath || filePath
      };

      const updateResponse = await fetch(`${PROXY_BASE_URL}/tables/LPS_Services_Visuals_Attach/records?q.where=AttachID=${attachId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error('Failed to update Services_Visuals_Attach record:', errorText);
        throw new Error('Failed to update record: ' + errorText);
      }

      return {
        AttachID: attachId,
        Photo: originalFilePath || filePath,
        success: true
      };

    } catch (error: any) {
      console.error('[uploadAndUpdateVisualsAttachPhoto] ERROR:', error);
      throw error;
    }
  }

  // Get unique categories from Services_Visuals_Templates
  getServicesVisualsCategories(): Observable<string[]> {
    return this.get<any>('/tables/LPS_Services_Visuals_Templates/records').pipe(
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
  getProject(projectId: string, useCache: boolean = true): Observable<any> {
    // All requests go through generic proxy or direct Caspio
    // Note: Routes use PK_ID for navigation, so getProject uses PK_ID
    return this.get<any>(`/tables/LPS_Projects/records?q.where=PK_ID=${projectId}`, useCache).pipe(
      map(response => response.Result && response.Result.length > 0 ? response.Result[0] : null)
    );
  }

  // LPS_Type methods
  getType(typeId: string): Observable<any> {
    // First try TypeID field
    return this.get<any>(`/tables/LPS_Type/records?q.where=TypeID=${typeId}`).pipe(
      map(response => response.Result && response.Result.length > 0 ? response.Result[0] : null),
      catchError(error => {
        // If TypeID fails, try PK_ID as fallback
        return this.get<any>(`/tables/LPS_Type/records?q.where=PK_ID=${typeId}`).pipe(
          map(response => response.Result && response.Result.length > 0 ? response.Result[0] : null)
        );
      })
    );
  }

  updateProject(projectId: string | number, updateData: any): Observable<any> {
    // Note: Use PK_ID for updates (matches mobile app pattern)
    const endpoint = `/tables/LPS_Projects/records?q.where=PK_ID=${projectId}`;
    return this.put<any>(endpoint, updateData).pipe(
      tap(() => {}),
      catchError(error => {
        console.error('[CaspioService] updateProject failed:', { projectId, endpoint, error });
        throw error;
      })
    );
  }
  
  // Service methods
  getService(serviceId: string, useCache: boolean = true): Observable<any> {
    // Services table uses PK_ID as primary key, not ServiceID
    return this.get<any>(`/tables/LPS_Services/records?q.where=PK_ID=${serviceId}`, useCache).pipe(
      map(response => response.Result && response.Result.length > 0 ? response.Result[0] : null)
    );
  }
  
  updateService(serviceId: string, updateData: any): Observable<any> {
    return this.put<any>(`/tables/LPS_Services/records?q.where=PK_ID=${serviceId}`, updateData).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('? [CaspioService.updateService] Failed to update service:', error);
        return throwError(() => error);
      })
    );
  }

  updateServiceByServiceId(serviceId: string, updateData: any): Observable<any> {
    
    return this.put<any>(`/tables/LPS_Services/records?q.where=ServiceID=${serviceId}`, updateData).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('? [CaspioService.updateServiceByServiceId] Failed to update service:', error);
        return throwError(() => error);
      })
    );
  }

  // Attach (Attachments) table methods
  getAttachmentsByProject(projectId: string, useCache: boolean = true): Observable<any[]> {
    return this.get<any>(`/tables/LPS_Attach/records?q.where=ProjectID=${projectId}`, useCache).pipe(
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


    // Use response=rows to get the created record back immediately
    return this.post<any>('/tables/LPS_Attach/records?response=rows', dataToSend).pipe(
      map(response => {
        // With response=rows, Caspio returns {"Result": [{created record}]}
        if (response && response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
          return response.Result[0]; // Return the created attachment record
        }
        return response; // Fallback to original response
      }),
      catchError(error => {
        console.error('❌ [CaspioService.createAttachment] Failed:', error);
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

  // Helper method to check for duplicate document titles and add versioning
  private async getVersionedDocumentTitle(projectId: number, typeId: number, baseTitle: string, serviceId?: string): Promise<string> {
    const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;

    try {
      // Build query to get existing documents with same ProjectID and TypeID
      const queryParams = new URLSearchParams({
        q: JSON.stringify({
          AND: [
            { ProjectID: projectId },
            { TypeID: typeId }
          ]
        })
      });

      const response = await fetch(`${PROXY_BASE_URL}/tables/LPS_Attach/records?${queryParams}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        console.warn('[Versioning] Failed to fetch existing attachments for duplicate check:', response.statusText);
        return baseTitle; // Return original title if check fails
      }

      const data = await response.json();
      const existingAttachments = data.Result || [];

      // Filter attachments for this specific service instance if serviceId provided
      const relevantAttachments = existingAttachments.filter((a: any) => {
        if (!serviceId) return true; // If no serviceId, check all attachments

        // Extract ServiceID from Notes field [SID:123]
        const match = a.Notes?.match(/\[SID:(\d+)\]/);
        const attachServiceId = match ? match[1] : null;

        // If attachment has ServiceID, must match
        if (attachServiceId) {
          return attachServiceId === serviceId;
        }

        // If no ServiceID in Notes, include it (backward compatibility)
        return true;
      });


      // Find all documents with titles matching the base title or versioned variants
      const baseTitleLower = baseTitle.toLowerCase();
      const existingTitles = relevantAttachments
        .map((a: any) => a.Title)
        .filter((t: string) => {
          const titleLower = t.toLowerCase();
          // Match exact title or title with version suffix (e.g., "Document #2")
          return titleLower === baseTitleLower ||
                 titleLower.match(new RegExp(`^${baseTitleLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} #\\d+$`));
        });


      // If no duplicates, return original title
      if (existingTitles.length === 0) {
        return baseTitle;
      }

      // Find the highest version number
      let maxVersion = 1;
      for (const existingTitle of existingTitles) {
        const match = existingTitle.match(/#(\d+)$/);
        if (match) {
          const version = parseInt(match[1]);
          if (version > maxVersion) {
            maxVersion = version;
          }
        }
      }

      // Return title with next version number
      const nextVersion = maxVersion + 1;
      const versionedTitle = `${baseTitle} #${nextVersion}`;
      return versionedTitle;

    } catch (error) {
      console.error('[Versioning] Error checking for duplicate document titles:', error);
      return baseTitle; // Return original title if error occurs
    }
  }

  // Two-step upload method for Attach table - Upload to Files API then create record with path
  private async twoStepUploadForAttach(projectId: number, typeId: number, title: string, notes: string, file: File, serviceId?: string) {

    const GATEWAY_URL = environment.apiGatewayUrl;
    const PROXY_BASE_URL = `${GATEWAY_URL}/api/caspio-proxy`;

    try {
      const formData = new FormData();
      formData.append('file', file, file.name);

      // Upload to Files API via backend proxy
      const uploadResponse = await fetch(`${GATEWAY_URL}/api/caspio-files/upload`, {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('Files API upload failed:', errorText);
        throw new Error('Failed to upload file to Files API: ' + errorText);
      }

      const uploadResult = await uploadResponse.json();

      // Check for duplicate document titles and add versioning (#2, #3, etc.)
      const versionedTitle = await this.getVersionedDocumentTitle(projectId, typeId, title || file.name, serviceId);

      // The file path for the Attachment field (use root path or folder path)
      const filePath = `/${uploadResult.Name || file.name}`;
      const recordData: any = {
        ProjectID: parseInt(projectId.toString()),
        TypeID: parseInt(typeId.toString()),
        Title: versionedTitle,
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
      
      const createResponse = await fetch(`${PROXY_BASE_URL}/tables/LPS_Attach/records?response=rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      
      // CRITICAL: Clear attachments cache so UI shows new document immediately
      this.clearAttachmentsCache(String(projectId));

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
    const GATEWAY_URL = environment.apiGatewayUrl;
    const PROXY_BASE_URL = `${GATEWAY_URL}/api/caspio-proxy`;

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

      // Upload via backend proxy
      const uploadResponse = await fetch(`${GATEWAY_URL}/api/caspio-files/upload`, {
        method: 'POST',
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
        `${PROXY_BASE_URL}/tables/LPS_Attach/records?q.where=AttachID=${attachId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
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

      // CRITICAL: Clear attachments cache so UI shows updated document immediately
      this.clearAttachmentsCache();

      return { success: true, attachId, fileName: file.name, filePath };

    } catch (error) {
      console.error('Failed to replace attachment:', error);
      throw error;
    }
  }

  updateAttachment(attachId: string, updateData: any): Observable<any> {
    return this.put<any>(`/tables/LPS_Attach/records?q.where=AttachID=${attachId}`, updateData);
  }

  deleteAttachment(attachId: string): Observable<any> {
    return this.delete<any>(`/tables/LPS_Attach/records?q.where=AttachID=${attachId}`);
  }

  // Get file from Caspio using file path (for file fields like Deliverable)
  getFileFromPath(filePath: string): Observable<any> {
    const GATEWAY_URL = environment.apiGatewayUrl;

    return new Observable(observer => {
      // Ensure file path starts with /
      if (!filePath.startsWith('/')) {
        filePath = '/' + filePath;
      }

      // Use the backend proxy
      const fileUrl = `${GATEWAY_URL}/api/caspio-files/download?filePath=${encodeURIComponent(filePath)}`;

      fetch(fileUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/octet-stream' }
      })
      .then(async fileResponse => {

        if (!fileResponse.ok) {
          const errorText = await fileResponse.text();
          console.error('[getFileFromPath] Error response:', errorText);
          throw new Error(`File fetch failed: ${fileResponse.status} - ${errorText}`);
        }

        // Get the blob
        let blob = await fileResponse.blob();

        // Detect MIME type from filename
        let mimeType = blob.type;
        if (!mimeType || mimeType === 'application/octet-stream') {
          if (filePath.toLowerCase().endsWith('.pdf')) {
            mimeType = 'application/pdf';
          } else if (filePath.toLowerCase().endsWith('.png')) {
            mimeType = 'image/png';
          } else if (filePath.toLowerCase().endsWith('.jpg') || filePath.toLowerCase().endsWith('.jpeg')) {
            mimeType = 'image/jpeg';
          }


          // Create new blob with correct MIME type
          if (mimeType !== blob.type) {
            blob = new Blob([blob], { type: mimeType });
          }
        }

        // For PDFs, convert to base64 data URL
        if (mimeType === 'application/pdf') {
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result as string;
            observer.next({
              url: dataUrl,
              type: mimeType,
              blob: blob
            });
            observer.complete();
          };
          reader.onerror = (error) => {
            console.error('[getFileFromPath] FileReader error:', error);
            observer.error(new Error('Failed to read file'));
          };
          reader.readAsDataURL(blob);
        } else {
          // For other files, create object URL
          const objectUrl = URL.createObjectURL(blob);
          observer.next({
            url: objectUrl,
            type: mimeType,
            blob: blob
          });
          observer.complete();
        }
      })
      .catch(error => {
        console.error('[getFileFromPath] Error:', error);
        observer.error(error);
      });
    });
  }

  // Get attachment with file data for display (following the working example pattern)
  getAttachmentWithImage(attachId: string): Observable<any> {
    const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;
    const GATEWAY_URL = environment.apiGatewayUrl;

    return new Observable(observer => {
      // First get the record to find the file path in the Attachment field
      fetch(`${PROXY_BASE_URL}/tables/LPS_Attach/records?q.where=AttachID=${attachId}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
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
            let filePath = record.Attachment;

            if (!filePath.startsWith('/')) {
              filePath = '/' + filePath;
            }

            // Download via backend proxy
            const fileUrl = `${GATEWAY_URL}/api/caspio-files/download?filePath=${encodeURIComponent(filePath)}`;

            try {
              const fileResponse = await fetch(fileUrl, {
                method: 'GET',
                headers: { 'Accept': 'application/octet-stream' }
              });

              if (!fileResponse.ok) {
                const errorBody = await fileResponse.text();
                console.error('  - Error response body:', errorBody);
                throw new Error(`File fetch failed: ${fileResponse.status} ${fileResponse.statusText}`);
              }

              let blob = await fileResponse.blob();

              let mimeType = blob.type;
              if (!mimeType || mimeType === 'application/octet-stream') {
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

                if (mimeType !== blob.type) {
                  blob = new Blob([blob], { type: mimeType });
                }
              }

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

            } catch (error) {
              console.error('File fetch failed:', error);

              // Try with /Inspections/ prefix if the simple path failed
              if (!filePath.includes('/Inspections/')) {
                try {
                  const inspectionsPath = '/Inspections' + (filePath.startsWith('/') ? filePath : '/' + filePath);
                  const inspectionsUrl = `${GATEWAY_URL}/api/caspio-files/download?filePath=${encodeURIComponent(inspectionsPath)}`;

                  const inspResponse = await fetch(inspectionsUrl, {
                    method: 'GET',
                    headers: { 'Accept': 'application/octet-stream' }
                  });

                  if (inspResponse.ok) {
                    let blob = await inspResponse.blob();

                    let mimeType = blob.type;
                    if (!mimeType || mimeType === 'application/octet-stream') {
                      const filename = record.Link || record.Attachment || '';
                      if (filename.toLowerCase().endsWith('.pdf')) {
                        mimeType = 'application/pdf';
                        blob = new Blob([blob], { type: mimeType });
                      }
                    }

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
                  console.error('/Inspections prefix also failed:', inspError);
                }
              }

              // Try alternate method: table record attachment field via backend proxy
              try {
                const altUrl = `${GATEWAY_URL}/api/caspio-files/table-file?table=LPS_Attach&recordId=${attachId}&fieldName=Attachment`;

                const altResponse = await fetch(altUrl, {
                  method: 'GET',
                  headers: { 'Accept': 'application/octet-stream' }
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
                console.error('Both methods failed:', altError);
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
        console.error('Error fetching attachment record:', error);
        observer.next(null);
        observer.complete();
      });
    });
  }
  
  // Update an existing attachment with new image data
  async updateAttachmentImage(attachId: string, imageBlob: Blob, filename: string): Promise<boolean> {
    const GATEWAY_URL = environment.apiGatewayUrl;
    const PROXY_BASE_URL = `${GATEWAY_URL}/api/caspio-proxy`;

    try {

      if (!attachId) {
        console.error('ERROR: No attachId provided!');
        return false;
      }

      // Step 1: Upload new file to Files API via backend proxy
      const timestamp = Date.now();
      const uniqueFilename = `annotated_${timestamp}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const filePath = `/Inspections/${uniqueFilename}`;

      const formData = new FormData();
      formData.append('file', imageBlob, uniqueFilename);
      formData.append('folder', 'Inspections');

      const uploadResponse = await fetch(`${GATEWAY_URL}/api/caspio-files/upload`, {
        method: 'POST',
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
      
      const updateResponse = await fetch(`${PROXY_BASE_URL}/tables/LPS_Attach/records?q.where=AttachID=${attachId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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
    const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;

    try {

      // Store annotations as JSON in the Notes field of Attach table
      const updateData = {
        Notes: JSON.stringify(annotationData)
      };

      const response = await fetch(`${PROXY_BASE_URL}/tables/LPS_Attach/records?q.where=AttachID=${attachId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
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
    const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;

    try {
      const response = await fetch(`${PROXY_BASE_URL}/tables/LPS_Attach/records?q.where=AttachID=${attachId}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
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
    const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;

    fetch(`${PROXY_BASE_URL}/tables/LPS_Attach/records?q.where=AttachID=${attachId}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
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
    const PROXY_BASE_URL = `${environment.apiGatewayUrl}/api/caspio-proxy`;
    const whereClause = `Email='${email.replace(/'/g, "''")}'`;

    return from(
      fetch(`${PROXY_BASE_URL}/tables/LPS_Users/records?q.where=${encodeURIComponent(whereClause)}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      }).then(response => {
        if (!response.ok) throw new Error(`Auth request failed: ${response.status}`);
        return response.json();
      })
    ).pipe(
      map(response => {
        const allUsers = response.Result || [];

        if (allUsers.length > 0) {
          const exactMatch = allUsers.find((u: any) =>
            u.Email && u.Email.toLowerCase() === email.toLowerCase()
          );

          if (exactMatch) {
            if (exactMatch.Password === password) {
              return [exactMatch];
            } else {
              return [];
            }
          } else {
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
  }

  // Get the current auth token (for storing in localStorage)
  async getAuthToken(): Promise<string | null> {
    return null;
  }

  // Files table methods
  getFiles(): Observable<any[]> {
    return this.get<any>('/tables/LPS_Files/records').pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('Failed to get files:', error);
        return of([]);
      })
    );
  }

  getFilesByType(typeId: number): Observable<any[]> {
    return this.get<any>(`/tables/LPS_Files/records?q.where=TypeID=${typeId}`).pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('Failed to get files by type:', error);
        return of([]);
      })
    );
  }

  // LPS_Type table methods
  getTypes(): Observable<any[]> {
    return this.get<any>('/tables/LPS_Type/records').pipe(
      map(response => response.Result || []),
      catchError(error => {
        console.error('Failed to get types:', error);
        return of([]);
      })
    );
  }

  // Help table methods
  getHelpById(helpId: number): Observable<any> {
    const endpoint = `/tables/LPS_Help/records?q.select=HelpID,Title,Comment&q.where=HelpID%3D${helpId}`;

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
    const endpoint = `/tables/LPS_Help_Items/records?q.select=HelpID,ItemType,Item&q.where=HelpID%3D${helpId}`;

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
    const endpoint = `/tables/LPS_Help_Images/records?q.select=HelpID,HelpImage&q.where=HelpID%3D${helpId}`;

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
    if (endpoint.includes('/tables/LPS_Type/records') || endpoint.includes('/tables/LPS_ServiceTypes')) {
      return 'SERVICE_TYPES';
    }
    if (endpoint.includes('/tables/LPS_Services_Visuals_Templates') ||
        endpoint.includes('/tables/LPS_Services_EFE_Templates') ||
        endpoint.includes('/tables/LPS_Attach_Templates') ||
        endpoint.includes('/tables/LPS_Templates')) {
      return 'TEMPLATES';
    }
    if (endpoint.includes('/tables/LPS_States')) {
      return 'STATES';
    }
    if (endpoint.includes('/tables/LPS_Offers/records')) {
      return 'STATIC_DATA';
    }
    
    // Mutable data - short cache (1-2 minutes)
    if (endpoint.includes('/tables/LPS_Attach/records')) {
      return 'SHORT';
    }
    if (endpoint.includes('/tables/LPS_Services/records')) {
      return 'SHORT';
    }
    if (endpoint.includes('/tables/LPS_Services_Visuals/records') || 
        endpoint.includes('/tables/LPS_Services_Visuals_Attach/records')) {
      return 'SHORT';
    }
    if (endpoint.includes('/tables/LPS_Services_EFE/records') || 
        endpoint.includes('/tables/LPS_Services_EFE_Points/records') ||
        endpoint.includes('/tables/LPS_Services_EFE_Points_Attach/records') ||
        endpoint.includes('/tables/LPS_Service_EFE/records')) {
      return 'SHORT';
    }
    if (endpoint.includes('/tables/LPS_Projects/records')) {
      return 'PROJECT_LIST'; // 2 minutes
    }
    
    // Images - long cache
    if (endpoint.includes('/files/') || endpoint.includes('image')) {
      return 'IMAGES';
    }
    
    // User data - medium cache
    if (endpoint.includes('/tables/LPS_Users') || endpoint.includes('/tables/LPS_Companies')) {
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
      return;
    }

    
    // Clear cache for this specific table
    this.cache.clearTableCache(tableName);
    
    // Clear related caches based on table relationships
    if (tableName === 'LPS_Services') {
      // When Services change, also clear related service tables
      this.cache.clearTableCache('LPS_Services_Visuals');
      this.cache.clearTableCache('LPS_Services_Visuals_Attach');
      this.cache.clearTableCache('LPS_Services_EFE');
      this.cache.clearTableCache('LPS_Services_EFE_Points');
      this.cache.clearTableCache('LPS_Service_EFE');
      this.cache.clearTableCache('LPS_Projects'); // Projects list may need refresh
    } else if (tableName === 'LPS_Attach') {
      // When attachments change, projects may need refresh
      this.cache.clearTableCache('LPS_Projects');
    } else if (tableName === 'LPS_Projects') {
      // When projects change, clear related data
      this.cache.clearTableCache('LPS_Services');
      this.cache.clearTableCache('LPS_Attach');
    } else if (tableName.startsWith('LPS_Services_')) {
      // Any services-related table change should clear Services cache
      this.cache.clearTableCache('LPS_Services');
    }
  }

  /**
   * Clear all pending requests (useful for cleanup or error recovery)
   */
  public clearPendingRequests(): void {
    this.pendingRequests.clear();
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
    
    // Clear Services-related template caches
    this.cache.clearByPattern('LPS_Services_Visuals');
    this.cache.clearByPattern('LPS_Services_EFE');
    this.cache.clearByPattern('LPS_Services_EFE_Points');
    this.cache.clearByPattern('LPS_Services_Visuals_Attach');
    
    // Clear the main Services table cache for specific project if provided
    if (projectId) {
      const endpoint = `/tables/LPS_Services/records?q.where=ProjectID=${projectId}`;
      const cacheKey = this.cache.getApiCacheKey(endpoint, null);
      this.cache.clear(cacheKey);
    }
  }

  /**
   * Clear cached data for Attach table (Support Documents)
   * Call this when adding/updating/deleting attachments to force fresh data from Caspio
   * @param projectId Optional - if provided, clears Attach cache for specific project
   */
  public clearAttachmentsCache(projectId?: string): void {
    this.cache.clearByPattern('LPS_Attach/records');
    
    // Clear the main Attach table cache for specific project if provided
    if (projectId) {
      const endpoint = `/tables/LPS_Attach/records?q.where=ProjectID=${projectId}`;
      const cacheKey = this.cache.getApiCacheKey(endpoint, null);
      this.cache.clear(cacheKey);
    }
  }

  // ============================================================================
  // PAYMENT & INVOICE METHODS
  // ============================================================================

  /**
   * Get invoices by company ID
   */
  getInvoicesByCompany(companyId: string | number): Observable<any[]> {
    return this.get<any>(`/tables/LPS_Invoices/records?q.where=CompanyID=${companyId}`).pipe(
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
    return this.get<any>(`/tables/LPS_Invoices/records?q.where=InvoiceID=${invoiceId}`).pipe(
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

    return this.put<any>(`/tables/LPS_Invoices/records?q.where=InvoiceID=${invoiceId}`, {
      Paid: paymentData.amount,
      PaymentProcessor: 'PayPal',
      InvoiceNotes: paymentNotes,
      Status: 'Paid'
    }).pipe(
      tap(response => {
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
    this.cache.clearByPattern('LPS_Invoices/records');
  }

  // ============================================
  // AUTOPAY METHODS
  // ============================================

  /**
   * Trigger autopay for a specific company via the backend API
   * @param companyId The company ID to process autopay for
   */
  triggerAutopay(companyId: number): Observable<any> {
    return this.http.post(`${environment.apiGatewayUrl}/api/autopay/trigger`, { companyId }).pipe(
      tap(response => {
        this.clearInvoicesCache();
      }),
      catchError(error => {
        console.error('[Autopay] Failed to trigger autopay:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Save payment method to a company
   * @param companyId Company ID
   * @param vaultData Vault token and payer info from PayPal
   */
  savePaymentMethod(companyId: number, vaultData: {
    vaultToken: string;
    payerId: string;
    payerEmail: string;
  }): Observable<any> {
    return this.put(`/tables/LPS_Companies/records?q.where=CompanyID=${companyId}`, {
      PayPalVaultToken: vaultData.vaultToken,
      PayPalPayerID: vaultData.payerId,
      PayPalPayerEmail: vaultData.payerEmail
    });
  }

  /**
   * Remove saved payment method from a company
   * @param companyId Company ID
   */
  removePaymentMethod(companyId: number): Observable<any> {
    return this.put(`/tables/LPS_Companies/records?q.where=CompanyID=${companyId}`, {
      PayPalVaultToken: null,
      PayPalPayerID: null,
      PayPalPayerEmail: null,
      AutopayEnabled: 0
    });
  }

  /**
   * Create a PayPal order with vault configuration (server-side)
   * @param amount Amount to charge
   * @param description Order description
   * @returns Order ID
   */
  createPayPalOrderWithVault(amount: string, description: string): Observable<{ orderId: string }> {
    return this.http.post<{ success: boolean; orderId: string }>(
      `${environment.apiGatewayUrl}/api/paypal/create-order`,
      { amount, description, returnUrl: window.location.href }
    ).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('[PayPal] Failed to create order:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Capture a PayPal order and get vault token
   * @param orderId Order ID to capture
   * @returns Captured order with vault token
   */
  capturePayPalOrder(orderId: string): Observable<{
    orderId: string;
    status: string;
    vaultToken: string | null;
    payerId: string;
    payerEmail: string;
  }> {
    return this.http.post<{
      success: boolean;
      orderId: string;
      status: string;
      vaultToken: string | null;
      payerId: string;
      payerEmail: string;
    }>(
      `${environment.apiGatewayUrl}/api/paypal/capture-order`,
      { orderId }
    ).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('[PayPal] Failed to capture order:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Create a PayPal vault setup token for saving payment method without charge
   * @returns Setup token ID and approval URL
   */
  createVaultSetupToken(): Observable<{ setupTokenId: string; approvalUrl: string }> {
    return this.http.post<{ success: boolean; setupTokenId: string; approvalUrl: string }>(
      `${environment.apiGatewayUrl}/api/paypal/setup-token`,
      {}
    ).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('[PayPal] Failed to create vault setup token:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Create a PayPal payment token from an approved setup token
   * @param setupTokenId The approved setup token ID
   * @returns Payment token details for saving
   */
  createPaymentToken(setupTokenId: string): Observable<{
    paymentTokenId: string;
    payerId: string;
    payerEmail: string;
  }> {
    return this.http.post<{
      success: boolean;
      paymentTokenId: string;
      payerId: string;
      payerEmail: string;
    }>(
      `${environment.apiGatewayUrl}/api/paypal/payment-token`,
      { setupTokenId }
    ).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('[PayPal] Failed to create payment token:', error);
        return throwError(() => error);
      })
    );
  }

  // ============================================
  // STRIPE ACH METHODS
  // ============================================

  /**
   * Create or get a Stripe customer for a company
   * @param companyId Company ID
   * @param companyName Company name
   * @param email Optional email
   * @returns Stripe customer ID
   */
  createStripeCustomer(companyId: number, companyName: string, email?: string): Observable<{
    customerId: string;
    email?: string;
  }> {
    return this.http.post<{
      success: boolean;
      customerId: string;
      email?: string;
    }>(
      `${environment.apiGatewayUrl}/api/stripe/customer`,
      { companyId, companyName, email }
    ).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('[Stripe] Failed to create customer:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Create a Financial Connections session for bank linking
   * @param customerId Stripe customer ID
   * @returns Client secret for FC modal
   */
  createFCSession(customerId: string): Observable<{
    clientSecret: string;
    sessionId: string;
  }> {
    return this.http.post<{
      success: boolean;
      clientSecret: string;
      sessionId: string;
    }>(
      `${environment.apiGatewayUrl}/api/stripe/fc-session`,
      { customerId }
    ).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('[Stripe] Failed to create FC session:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Link a bank account from Financial Connections
   * @param customerId Stripe customer ID
   * @param accountId Linked account ID from FC
   * @returns Payment method details
   */
  linkStripeBank(customerId: string, accountId: string): Observable<{
    paymentMethodId: string;
    bankName: string;
    last4: string;
  }> {
    return this.http.post<{
      success: boolean;
      paymentMethodId: string;
      bankName: string;
      last4: string;
    }>(
      `${environment.apiGatewayUrl}/api/stripe/link-bank`,
      { customerId, accountId }
    ).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('[Stripe] Failed to link bank:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Remove a Stripe payment method
   * @param paymentMethodId Payment method ID to remove
   */
  removeStripePaymentMethod(paymentMethodId: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${environment.apiGatewayUrl}/api/stripe/remove-payment-method`,
      { paymentMethodId }
    ).pipe(
      tap(response => {
      }),
      catchError(error => {
        console.error('[Stripe] Failed to remove payment method:', error);
        return throwError(() => error);
      })
    );
  }
}
