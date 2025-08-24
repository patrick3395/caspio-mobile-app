import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError, from, of } from 'rxjs';
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

  // Create attachment with file using two-step upload (like Services_Visuals_Attach)
  createAttachmentWithFile(projectId: number, typeId: number, title: string, notes: string, file: File): Observable<any> {
    console.log('📦 Two-step upload for Attach table');
    
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

  // Two-step upload method for Attach table (similar to Services_Visuals_Attach)
  private async twoStepUploadForAttach(projectId: number, typeId: number, title: string, notes: string, file: File) {
    console.log('📦 Two-step upload for Attach table');
    
    const accessToken = this.tokenSubject.value;
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    // Step 1: Create record WITHOUT file
    console.log('Step 1: Creating Attach record without file...');
    const recordData = {
      ProjectID: parseInt(projectId.toString()),
      TypeID: parseInt(typeId.toString()),
      Title: title,
      Notes: notes,
      Link: file.name
      // Attachment field is FILE type, will be added in step 2
    };
    
    console.log('Creating record with:', recordData);
    
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
      throw new Error('Failed to create Attach record: ' + createResponseText);
    }
    
    let createResult: any;
    if (createResponseText.length > 0) {
      const parsedResponse = JSON.parse(createResponseText);
      if (parsedResponse.Result && Array.isArray(parsedResponse.Result)) {
        createResult = parsedResponse.Result[0];
      } else {
        createResult = parsedResponse;
      }
    }
    
    const attachId = createResult.AttachID || createResult.PK_ID;
    console.log('✅ Record created with AttachID:', attachId);
    
    // Step 2: Upload file to the Attachment field using the specific file field endpoint
    console.log('Step 2: Uploading file to Attachment field...');
    
    // Try the specific file field endpoint first (this works for Services_Visuals_Attach)
    const fileFieldUrl = `${API_BASE_URL}/tables/Attach/records/${attachId}/files/Attachment`;
    console.log('Using file field endpoint:', fileFieldUrl);
    
    // Build multipart/form-data with the file
    const formData = new FormData();
    formData.append('file', file, file.name);
    
    // Upload directly to the file field
    const uploadResponse = await fetch(fileFieldUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`
        // NO Content-Type header - let browser set it with boundary
      },
      body: formData
    });
    
    const uploadResponseText = await uploadResponse.text();
    console.log(`Upload response status: ${uploadResponse.status}, body: ${uploadResponseText || '(empty)'}`);
    
    if (uploadResponse.status === 204 || uploadResponse.ok) {
      console.log('✅ File uploaded successfully to Attachment field');
      
      // Step 3: Fetch the record again to get the actual file path
      console.log('Step 3: Fetching updated record with file path...');
      const fetchResponse = await fetch(
        `${API_BASE_URL}/tables/Attach/records?q.where=AttachID=${attachId}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
          }
        }
      );
      
      if (fetchResponse.ok) {
        const fetchData = await fetchResponse.json();
        if (fetchData.Result && fetchData.Result.length > 0) {
          const updatedRecord = fetchData.Result[0];
          console.log('✅ Retrieved updated record:');
          console.log('  - AttachID:', updatedRecord.AttachID);
          console.log('  - Title:', updatedRecord.Title);
          console.log('  - Link:', updatedRecord.Link);
          console.log('  - Attachment field value:', updatedRecord.Attachment);
          console.log('  - Attachment field type:', typeof updatedRecord.Attachment);
          console.log('  - Full record:', JSON.stringify(updatedRecord));
          return updatedRecord;
        }
      }
      
      // If fetch failed, return what we have
      return {
        ...createResult,
        AttachID: attachId,
        Attachment: file.name // Fallback to filename
      };
    } else {
      console.error('Failed to upload file:', uploadResponseText);
      // Still return the record even if file upload failed
      return createResult;
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
      // Use the specific file field endpoint that works
      console.log('Replacing attachment file using file field endpoint...');
      
      // Use the direct file field endpoint
      const fileFieldUrl = `${API_BASE_URL}/tables/Attach/records/${attachId}/files/Attachment`;
      console.log('Using file field endpoint:', fileFieldUrl);
      
      const formData = new FormData();
      formData.append('file', file, file.name);
      
      // Upload directly to the file field
      const updateResponse = await fetch(fileFieldUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`
          // NO Content-Type header - let browser set it with boundary
        },
        body: formData
      });
      
      const updateResponseText = await updateResponse.text();
      console.log(`Update response status: ${updateResponse.status}`);
      
      if (updateResponse.status === 204 || updateResponse.ok) {
        console.log('✅ File replaced successfully');
        
        // Also update the Link field with the new filename
        const updateLinkResponse = await fetch(
          `${API_BASE_URL}/tables/Attach/records?q.where=AttachID=${attachId}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              Link: file.name
            })
          }
        );
        
        return { success: true, attachId, fileName: file.name };
      } else {
        throw new Error('Failed to replace attachment file: ' + updateResponseText);
      }
      
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
    console.log('🔍 getAttachmentWithImage called for AttachID:', attachId);
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
          console.log('📎 Attachment record found:', {
            AttachID: record.AttachID,
            Title: record.Title,
            Link: record.Link,
            Attachment: record.Attachment
          });
          
          // Check if there's a file path in the Attachment field
          console.log('🔍 Checking Attachment field:');
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
            console.log('📥 Fetching file from path:');
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
              
              console.log('📥 File fetch response status:', fileResponse.status);
              
              if (!fileResponse.ok) {
                const errorBody = await fileResponse.text();
                console.error('  - Error response body:', errorBody);
                throw new Error(`File fetch failed: ${fileResponse.status} ${fileResponse.statusText}`);
              }
              
              // Get the blob
              let blob = await fileResponse.blob();
              console.log('📦 Blob received, size:', blob.size, 'type:', blob.type);
              
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
                  console.log('🔄 Converting blob MIME type from', blob.type, 'to', mimeType);
                  blob = new Blob([blob], { type: mimeType });
                }
              }
              
              // Use URL.createObjectURL EXACTLY like the example - this is the key!
              const objectUrl = URL.createObjectURL(blob);
              console.log('✅ Created object URL for image display:', objectUrl);
              console.log('  - Object URL starts with:', objectUrl.substring(0, 50));
              
              // Return the record with the object URL as the Attachment
              record.Attachment = objectUrl;
              observer.next(record);
              observer.complete();
              
            } catch (error) {
              console.error('❌ File fetch failed:', error);
              console.error('  - Error details:', error);
              
              // Try with /Inspections/ prefix if the simple path failed
              if (!filePath.includes('/Inspections/')) {
                try {
                  const inspectionsPath = '/Inspections' + (filePath.startsWith('/') ? filePath : '/' + filePath);
                  const inspectionsUrl = `${API_BASE_URL}/files/path?filePath=${encodeURIComponent(inspectionsPath)}`;
                  console.log('🔄 Trying with /Inspections prefix:', inspectionsPath);
                  
                  const inspResponse = await fetch(inspectionsUrl, {
                    method: 'GET',
                    headers: {
                      'Authorization': `Bearer ${accessToken}`,
                      'Accept': 'application/octet-stream'
                    }
                  });
                  
                  if (inspResponse.ok) {
                    const blob = await inspResponse.blob();
                    const objectUrl = URL.createObjectURL(blob);
                    console.log('✅ Success with /Inspections prefix');
                    record.Attachment = objectUrl;
                    observer.next(record);
                    observer.complete();
                    return;
                  }
                } catch (inspError) {
                  console.error('❌ /Inspections prefix also failed:', inspError);
                }
              }
              
              // Try alternate method if path-based methods fail
              try {
                const altUrl = `${API_BASE_URL}/tables/Attach/records/${attachId}/files/Attachment`;
                console.log('🔄 Trying table-based file endpoint:', altUrl);
                
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
                console.log('✅ Alternate method succeeded, created object URL');
                
                record.Attachment = objectUrl;
                observer.next(record);
                observer.complete();
                
              } catch (altError) {
                console.error('❌ Both methods failed:', altError);
                record.Attachment = this.createPlaceholderImage(record.Title, record.Link);
                observer.next(record);
                observer.complete();
              }
            }
          } else {
            console.log('⚠️ No file path in Attachment field');
            record.Attachment = this.createPlaceholderImage(record.Title, record.Link);
            observer.next(record);
            observer.complete();
          }
        } else {
          console.log('❌ No attachment record found');
          observer.next(null);
          observer.complete();
        }
      })
      .catch(error => {
        console.error('❌ Error fetching attachment record:', error);
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
      console.log('🔍 DEBUG: Starting updateAttachmentImage');
      console.log('  - AttachID:', attachId);
      console.log('  - Blob size:', imageBlob.size, 'bytes');
      console.log('  - Blob type:', imageBlob.type);
      console.log('  - Filename:', filename);
      console.log('  - Access token present:', !!accessToken);
      console.log('  - API URL:', API_BASE_URL);
      
      if (!attachId) {
        console.error('❌ ERROR: No attachId provided!');
        return false;
      }
      
      // Step 1: Upload new file to Files API
      const timestamp = Date.now();
      const uniqueFilename = `annotated_${timestamp}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const filePath = `/Inspections/${uniqueFilename}`;
      
      console.log('📤 Step 1: Uploading new file to Files API...');
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
        console.error('❌ Failed to upload file!');
        console.error('  - Status:', uploadResponse.status);
        console.error('  - Status text:', uploadResponse.statusText);
        console.error('  - Response body:', uploadResponseText);
        return false;
      }
      
      let uploadResult: any;
      try {
        uploadResult = JSON.parse(uploadResponseText);
        console.log('✅ File uploaded successfully:', uploadResult);
      } catch (e) {
        console.log('⚠️ Could not parse upload response as JSON:', uploadResponseText);
        // Continue anyway as file might have been uploaded
      }
      
      // Step 2: Update the Attach record with new file path
      console.log('📝 Step 2: Updating Attach record with new file path...');
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
        console.error('❌ Failed to update Attach record!');
        console.error('  - Status:', updateResponse.status);
        console.error('  - Status text:', updateResponse.statusText);
        console.error('  - Response body:', updateResponseText);
        return false;
      }
      
      console.log('✅ Attachment updated successfully with annotated image');
      console.log('  - Response:', updateResponseText);
      return true;
      
    } catch (error) {
      console.error('❌ EXCEPTION in updateAttachmentImage:');
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
      console.log('💾 Saving annotation data for AttachID:', attachId);
      
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
      
      console.log('✅ Annotation data saved successfully');
      return true;
      
    } catch (error) {
      console.error('❌ Error saving annotation data:', error);
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
      console.error('❌ Error getting annotation data:', error);
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
}
