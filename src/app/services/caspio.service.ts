import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError, from } from 'rxjs';
import { map, tap, catchError, switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

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

  constructor(private http: HttpClient) {
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
    console.log('🔍 DEBUG [CaspioService.post]: Token available:', !!token);
    
    if (!token) {
      console.error('❌ DEBUG [CaspioService.post]: No authentication token!');
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
    console.log('🔍 DEBUG [CaspioService.post]: Making POST request to:', url);
    console.log('🔍 DEBUG [CaspioService.post]: Request data:', data);
    
    return this.http.post<T>(url, data, { headers }).pipe(
      tap(response => {
        console.log('✅ DEBUG [CaspioService.post]: Request successful:', response);
      }),
      catchError(error => {
        console.error('❌ DEBUG [CaspioService.post]: Request failed!');
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
    console.log('🔍 DEBUG [CaspioService]: Getting services for project:', projectId);
    return this.get<any>(`/tables/Services/records?q.where=ProjectID=${projectId}`).pipe(
      map(response => {
        console.log('🔍 DEBUG [CaspioService]: Services retrieved:', response?.Result);
        return response.Result || [];
      }),
      catchError(error => {
        console.error('❌ DEBUG [CaspioService]: Failed to get services:', error);
        return throwError(() => error);
      })
    );
  }

  createService(serviceData: any): Observable<any> {
    console.log('🔍 DEBUG [CaspioService]: createService called with:', serviceData);
    // Add response=rows to get the created record back immediately
    return this.post<any>('/tables/Services/records?response=rows', serviceData).pipe(
      map(response => {
        console.log('✅ DEBUG [CaspioService]: Service created successfully:', response);
        // With response=rows, Caspio returns {"Result": [{created record}]}
        if (response && response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
          return response.Result[0]; // Return the created service record
        }
        return response; // Fallback to original response
      }),
      catchError(error => {
        console.error('❌ DEBUG [CaspioService]: Service creation failed:', error);
        console.error('Error status:', error?.status);
        console.error('Error body:', error?.error);
        return throwError(() => error);
      })
    );
  }

  updateService(serviceId: string, updateData: any): Observable<any> {
    return this.put<any>(`/tables/Services/records?q.where=PK_ID=${serviceId}`, updateData);
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
  
  // Services Visuals methods (for saving selected items)
  createServicesVisual(visualData: any): Observable<any> {
    console.log('🔍 Creating Services_Visual record:', visualData);
    return this.post<any>('/tables/Services_Visuals/records', visualData).pipe(
      tap(response => {
        console.log('✅ Services_Visual created:', response);
      }),
      catchError(error => {
        console.error('❌ Failed to create Services_Visual:', error);
        return throwError(() => error);
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
    console.log('🔍 Creating Service_Visuals_Attach record:', attachData);
    return this.post<any>('/tables/Service_Visuals_Attach/records', attachData).pipe(
      tap(response => {
        console.log('✅ Service_Visuals_Attach created:', response);
      }),
      catchError(error => {
        console.error('❌ Failed to create Service_Visuals_Attach:', error);
        return throwError(() => error);
      })
    );
  }
  
  // Upload photo to Service_Visuals_Attach with two-step process
  uploadPhotoToServiceVisualsAttach(visualId: string, photo: File): Observable<any> {
    console.log('📸 Uploading photo for VisualID:', visualId);
    
    return new Observable(observer => {
      // Step 1: Create the attachment record
      const attachData = {
        VisualID: visualId,
        // Photo field will be uploaded in step 2
      };
      
      console.log('📝 Step 1: Creating Service_Visuals_Attach record');
      
      this.post<any>('/tables/Service_Visuals_Attach/records', attachData).subscribe({
        next: (createResponse) => {
          console.log('✅ Step 1 Success: Record created:', createResponse);
          
          const attachId = createResponse.PK_ID || createResponse.id;
          
          if (!attachId) {
            console.error('❌ No ID in response:', createResponse);
            observer.error(new Error('Failed to get attachment ID'));
            return;
          }
          
          console.log('📎 Step 2: Uploading photo to ID:', attachId);
          
          // Step 2: Upload the photo using multipart/form-data
          const formData = new FormData();
          formData.append('Photo', photo, photo.name);
          
          const updateUrl = `/tables/Service_Visuals_Attach/records?q.where=PK_ID=${attachId}`;
          
          this.put<any>(updateUrl, formData).subscribe({
            next: (uploadResponse) => {
              console.log('✅ Step 2 Success: Photo uploaded');
              observer.next({ ...createResponse, photoUploaded: true });
              observer.complete();
            },
            error: (uploadError) => {
              console.error('❌ Step 2 Failed: Photo upload error:', uploadError);
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
          console.error('❌ Step 1 Failed:', createError);
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

  // Create Services_Visuals_Attach with file - EXACT COPY of working Attach method
  createServicesVisualsAttachWithFile(visualId: number, annotation: string, file: File): Observable<any> {
    console.log('📦 Method 2: Two-step upload for Services_Visuals_Attach');
    
    // Wrap the entire async function in Observable to return to Angular
    return new Observable(observer => {
      this.testTwoStepUploadVisuals(visualId, annotation, file)
        .then(result => {
          observer.next(result.create); // Return the created record
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  // EXACT COPY of the working testTwoStepUpload but for Services_Visuals_Attach
  private async testTwoStepUploadVisuals(visualId: number, annotation: string, file: File) {
    console.log('📦 Method 2: Two-step upload for Services_Visuals_Attach');
    console.log('=====================================');
    console.log('TABLE: Services_Visuals_Attach');
    console.log('COLUMNS:');
    console.log('   VisualID (Integer) - Foreign key to Services_Visuals');
    console.log('   Photo (File) - The image file field');
    console.log('   Annotation (Text) - Description/notes');
    console.log('=====================================');
    
    const accessToken = this.tokenSubject.value;
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    // Step 1: Create record with ONLY these fields (Photo is FILE type, added in step 2)
    console.log('Step 1: Creating record with VisualID and Annotation...');
    const recordData = {
      VisualID: parseInt(visualId.toString()),
      Annotation: annotation || file.name  // Store filename in Annotation if blank
    };
    
    console.log(`Sending JSON: ${JSON.stringify(recordData)}`);
    
    const createResponse = await fetch(`${API_BASE_URL}/tables/Services_Visuals_Attach/records`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(recordData)
    });

    const createResponseText = await createResponse.text();
    console.log(`Create response status: ${createResponse.status}, body: ${createResponseText}`);
    
    let createResult: any;
    if (createResponseText.length > 0) {
      try {
        createResult = JSON.parse(createResponseText);
      } catch (e) {
        throw new Error('Failed to parse create response: ' + createResponseText);
      }
    } else {
      // Empty response might mean success, let's query for the record
      console.log('Empty response from create. Querying for last record with VisualID...');
      const queryResponse = await fetch(`${API_BASE_URL}/tables/Services_Visuals_Attach/records?q.where=VisualID=${visualId}&q.orderBy=AttachID%20DESC&q.limit=1`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      const queryResult = await queryResponse.json();
      if (queryResult.Result && queryResult.Result.length > 0) {
        createResult = queryResult.Result[0];
        const recordId = createResult.AttachID || createResult.PK_ID || createResult.id;
        console.log(`Found last record: ID=${recordId}`);
      } else {
        throw new Error('Failed to create record and could not find it');
      }
    }
    
    if (!createResponse.ok && !createResult) {
      throw new Error('Failed to create record: ' + createResponseText);
    }
    
    // Get the ID - could be PK_ID, AttachID, or id depending on table
    const attachId = createResult.AttachID || createResult.PK_ID || createResult.id;
    console.log(`✅ Step 1 complete. Record ID: ${attachId}`);
    
    // Step 2: Upload file to Photo field
    console.log('Step 2: Uploading file to Photo field...');
    
    // Try different approaches for file upload
    const approaches = [
      {
        name: 'FormData with file only',
        buildBody: () => {
          const fd = new FormData();
          fd.append('Photo', file, file.name);
          return fd;
        },
        headers: {}
      },
      {
        name: 'FormData with all fields',
        buildBody: () => {
          const fd = new FormData();
          fd.append('VisualID', visualId.toString());
          fd.append('Annotation', annotation || '');
          fd.append('Photo', file, file.name);
          return fd;
        },
        headers: {}
      },
      {
        name: 'JSON with base64',
        buildBody: async () => {
          return new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = function(e) {
              const base64 = (e.target?.result as string).split(',')[1];
              resolve(JSON.stringify({ Photo: base64 }));
            };
            reader.readAsDataURL(file);
          });
        },
        headers: { 'Content-Type': 'application/json' }
      }
    ];
    
    let uploadResult = null;
    let successMethod = null;
    
    for (const approach of approaches) {
      console.log(`Trying approach: ${approach.name}`);
      
      const body = await approach.buildBody();
      
      // Try PUT to update the record
      const headers: any = {
        'Authorization': `Bearer ${accessToken}`,
        ...approach.headers
      };
      
      // Use AttachID if available, otherwise fall back to PK_ID
      const idField = createResult.AttachID ? 'AttachID' : 'PK_ID';
      const putResponse = await fetch(`${API_BASE_URL}/tables/Services_Visuals_Attach/records?q.where=${idField}=${attachId}`, {
        method: 'PUT',
        headers: headers,
        body: body as any
      });

      const responseText = await putResponse.text();
      console.log(`Response status: ${putResponse.status}, body length: ${responseText.length}`);
      
      // Handle empty response (204 No Content is success)
      if (putResponse.status === 204 || (putResponse.ok && responseText.length === 0)) {
        uploadResult = { success: true, message: 'File uploaded successfully (empty response)' };
        successMethod = approach.name;
        console.log(`✅ File upload successful with: ${approach.name}`);
        break;
      } else if (responseText.length > 0) {
        try {
          uploadResult = JSON.parse(responseText);
          if (putResponse.ok) {
            successMethod = approach.name;
            console.log(`✅ File upload successful with: ${approach.name}`);
            break;
          }
        } catch (e) {
          uploadResult = { response: responseText };
        }
        
        if (!putResponse.ok) {
          console.log(`❌ Failed with ${approach.name}: ${putResponse.status} - ${responseText}`);
        }
      }
    }
    
    // Return complete record with Photo field populated
    const finalRecord = {
      ...createResult,
      Photo: uploadResult?.Photo || file.name,
      AttachID: attachId,
      VisualID: visualId,
      Annotation: annotation || file.name
    };
    
    return { 
      create: finalRecord, 
      upload: uploadResult,
      successMethod: successMethod 
    };
  }

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

  updateProject(projectId: string, updateData: any): Observable<any> {
    return this.put<any>(`/tables/Projects/records?q.where=PK_ID=${projectId}`, updateData);
  }

  // Attach (Attachments) table methods
  getAttachmentsByProject(projectId: string): Observable<any[]> {
    return this.get<any>(`/tables/Attach/records?q.where=ProjectID=${projectId}`).pipe(
      map(response => response.Result || [])
    );
  }

  createAttachment(attachData: any): Observable<any> {
    console.log('🔍 [CaspioService.createAttachment] Creating attachment with data:', attachData);
    // Remove ?response=rows as per Caspio best practices
    return this.post<any>('/tables/Attach/records', attachData).pipe(
      tap(response => {
        console.log('✅ [CaspioService.createAttachment] Success response:', response);
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

  // Create attachment with file - Method 2: Two-step upload (EXACTLY as in test HTML)
  createAttachmentWithFile(projectId: number, typeId: number, title: string, notes: string, file: File): Observable<any> {
    console.log('📦 Method 2: Two-step upload');
    
    // Wrap the entire async function in Observable to return to Angular
    return new Observable(observer => {
      this.testTwoStepUpload(projectId, typeId, title, notes, file)
        .then(result => {
          observer.next(result.create); // Return the created record
          observer.complete();
        })
        .catch(error => {
          observer.error(error);
        });
    });
  }

  // EXACT COPY of the HTML test function that works
  private async testTwoStepUpload(projectId: number, typeId: number, title: string, notes: string, file: File) {
    console.log('📦 Method 2: Two-step upload');
    
    const accessToken = this.tokenSubject.value;
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    // Step 1: Create record with ONLY these fields
    console.log('Step 1: Creating record with ONLY ProjectID, TypeID, Title, Notes, Link...');
    const recordData = {
      ProjectID: parseInt(projectId.toString()),
      TypeID: parseInt(typeId.toString()),
      Title: title,
      Notes: notes,
      Link: file.name
    };
    
    console.log(`Sending JSON: ${JSON.stringify(recordData)}`);
    
    // Add response=rows to get the created record immediately
    const createResponse = await fetch(`${API_BASE_URL}/tables/Attach/records?response=rows`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(recordData)
    });

    const createResponseText = await createResponse.text();
    console.log(`Create response status: ${createResponse.status}, body: ${createResponseText}`);
    
    let createResult: any;
    let attachId: string;
    
    if (createResponseText.length > 0) {
      try {
        const parsedResponse = JSON.parse(createResponseText);
        // With response=rows, Caspio returns {"Result": [{created record}]}
        if (parsedResponse.Result && Array.isArray(parsedResponse.Result) && parsedResponse.Result.length > 0) {
          createResult = parsedResponse.Result[0];
          attachId = createResult.AttachID;
          console.log('✅ Record created with response=rows, AttachID:', attachId);
        } else {
          // Fallback if response format is different
          createResult = parsedResponse;
          attachId = createResult.AttachID;
        }
      } catch (e) {
        throw new Error('Failed to parse create response: ' + createResponseText);
      }
    } else {
      throw new Error('Empty response from create endpoint');
    }
    
    if (!createResponse.ok && !createResult) {
      throw new Error('Failed to create record: ' + createResponseText);
    }
    console.log(`✅ Step 1 complete. AttachID: ${attachId}`);
    
    // Step 2: Upload file to Attachment field
    console.log('Step 2: Uploading file to Attachment field...');
    
    // Try different approaches for file upload
    const approaches = [
      {
        name: 'FormData with file only',
        buildBody: () => {
          const fd = new FormData();
          fd.append('Attachment', file, file.name);
          return fd;
        },
        headers: {}
      },
      {
        name: 'FormData with all fields',
        buildBody: () => {
          const fd = new FormData();
          fd.append('ProjectID', projectId.toString());
          fd.append('TypeID', typeId.toString());
          fd.append('Title', title);
          fd.append('Notes', notes);
          fd.append('Link', file.name);
          fd.append('Attachment', file, file.name);
          return fd;
        },
        headers: {}
      },
      {
        name: 'JSON with base64',
        buildBody: async () => {
          return new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = function(e) {
              const base64 = (e.target?.result as string).split(',')[1];
              resolve(JSON.stringify({ Attachment: base64 }));
            };
            reader.readAsDataURL(file);
          });
        },
        headers: { 'Content-Type': 'application/json' }
      }
    ];
    
    let uploadResult = null;
    let successMethod = null;
    
    for (const approach of approaches) {
      console.log(`Trying approach: ${approach.name}`);
      
      const body = await approach.buildBody();
      
      // Try PUT to update the record
      const headers: any = {
        'Authorization': `Bearer ${accessToken}`,
        ...approach.headers
      };
      
      const putResponse = await fetch(`${API_BASE_URL}/tables/Attach/records?q.where=AttachID=${attachId}`, {
        method: 'PUT',
        headers: headers,
        body: body as any
      });

      const responseText = await putResponse.text();
      console.log(`Response status: ${putResponse.status}, body length: ${responseText.length}`);
      
      // Handle empty response (204 No Content is success)
      if (putResponse.status === 204 || (putResponse.ok && responseText.length === 0)) {
        uploadResult = { success: true, message: 'File uploaded successfully (empty response)' };
        successMethod = approach.name;
        console.log(`✅ File upload successful with: ${approach.name}`);
        break;
      } else if (responseText.length > 0) {
        try {
          uploadResult = JSON.parse(responseText);
          if (putResponse.ok) {
            successMethod = approach.name;
            console.log(`✅ File upload successful with: ${approach.name}`);
            break;
          }
        } catch (e) {
          uploadResult = { response: responseText };
        }
        
        if (!putResponse.ok) {
          console.log(`❌ Failed with ${approach.name}: ${putResponse.status} - ${responseText}`);
        }
      }
    }
    
    return { 
      create: createResult, 
      upload: uploadResult,
      successMethod: successMethod 
    };
  }

  updateAttachment(attachId: string, updateData: any): Observable<any> {
    return this.put<any>(`/tables/Attach/records?q.where=AttachID=${attachId}`, updateData);
  }

  deleteAttachment(attachId: string): Observable<any> {
    return this.delete<any>(`/tables/Attach/records?q.where=AttachID=${attachId}`);
  }

  // Get attachment with base64 data for display
  getAttachmentWithImage(attachId: string): Observable<any> {
    return this.get<any>(`/tables/Attach/records?q.where=AttachID=${attachId}`).pipe(
      map(response => {
        if (response.Result && response.Result.length > 0) {
          const record = response.Result[0];
          // If attachment is base64, add data URL prefix for display
          if (record.Attachment && record.Attachment.length > 1000 && !record.Attachment.startsWith('http')) {
            const mimeType = this.getMimeTypeFromFilename(record.Link || 'image.jpg');
            record.AttachmentDataUrl = `data:${mimeType};base64,${record.Attachment}`;
          }
          return record;
        }
        return null;
      })
    );
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

  // File upload method
  uploadFileToAttachment(attachId: string, file: File): Observable<any> {
    console.log('🔍 [CaspioService.uploadFileToAttachment] Uploading file:', {
      attachId: attachId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type
    });
    
    const formData = new FormData();
    formData.append('Attachment', file, file.name);
    
    // Log the FormData contents
    console.log('📦 FormData contents:');
    formData.forEach((value, key) => {
      console.log(`  ${key}:`, value);
    });
    
    // Try the direct record update endpoint
    // Pattern: /tables/{tableName}/records/{recordId}
    const endpoint = `/tables/Attach/records/${attachId}`;
    console.log('🎯 REST API endpoint for file upload:', endpoint);
    console.log('📌 Full URL will be:', `${environment.caspio.apiBaseUrl}${endpoint}`);
    console.log('🔧 Using PUT method with multipart/form-data');
    
    return this.put<any>(endpoint, formData).pipe(
      tap(response => {
        console.log('✅ [CaspioService.uploadFileToAttachment] Upload success:', response);
      }),
      catchError(error => {
        console.error('❌ [CaspioService.uploadFileToAttachment] Upload failed:', error);
        console.error('Failed endpoint was:', endpoint);
        console.error('Troubleshooting:');
        console.error('  1. Verify AttachID exists:', attachId);
        console.error('  2. Check field name is "Attachment" in Attach table');
        console.error('  3. Verify Files API is enabled in Caspio');
        return throwError(() => error);
      })
    );
  }
}