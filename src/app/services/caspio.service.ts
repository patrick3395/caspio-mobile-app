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

  // Create Services_Visuals_Attach with file using PROVEN Files API method
  createServicesVisualsAttachWithFile(visualId: number, annotation: string, file: File): Observable<any> {
    console.log('📦 Two-step upload for Services_Visuals_Attach using Files API');
    
    // Wrap the entire async function in Observable to return to Angular
    return new Observable(observer => {
      this.uploadVisualsAttachWithFilesAPI(visualId, annotation, file)
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
  private async uploadVisualsAttachWithFilesAPI(visualId: number, annotation: string, file: File) {
    console.log('📦 Services_Visuals_Attach upload using PROVEN Files API method');
    console.log('====== TABLE STRUCTURE ======');
    console.log('AttachID: Autonumber (Primary Key)');
    console.log('VisualID: Integer (Foreign Key)');
    console.log('Photo: File (stores path)');
    console.log('Annotation: Text(255)');
    console.log('=============================');
    
    const accessToken = this.tokenSubject.value;
    const API_BASE_URL = environment.caspio.apiBaseUrl;
    
    console.log('Input parameters:');
    console.log('  VisualID:', visualId, '(type:', typeof visualId, ')');
    console.log('  Annotation:', annotation || '(empty)');
    console.log('  File:', file.name, 'Size:', file.size);
    
    try {
      // STEP 1: Upload file to Caspio Files API (PROVEN WORKING)
      console.log('Step 1: Uploading file to Caspio Files API...');
      const formData = new FormData();
      formData.append('file', file, file.name);
      
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
      console.log('✅ File uploaded to Files API:', uploadResult);
      
      // The file path for the Photo field
      const filePath = `/${uploadResult.Name || file.name}`;
      console.log('File path for Photo field:', filePath);
      
      // STEP 2: Create Services_Visuals_Attach record with the file path
      console.log('Step 2: Creating Services_Visuals_Attach record with file path...');
      const recordData = {
        VisualID: parseInt(visualId.toString()),
        Annotation: annotation || file.name,
        Photo: filePath  // Store the file path from Files API
      };
      
      console.log('Creating Services_Visuals_Attach record with data:', recordData);
      
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
      
      if (!createResponse.ok) {
        console.error('Failed to create Services_Visuals_Attach record:', createResponseText);
        throw new Error('Failed to create record: ' + createResponseText);
      }
      
      let createResult: any;
      if (createResponseText.length > 0) {
        const parsedResponse = JSON.parse(createResponseText);
        if (parsedResponse.Result && Array.isArray(parsedResponse.Result) && parsedResponse.Result.length > 0) {
          createResult = parsedResponse.Result[0];
          console.log('✅ Services_Visuals_Attach record created successfully:', createResult);
        } else {
          createResult = parsedResponse;
        }
      }
      
      return {
        ...createResult,
        Photo: filePath,  // Include the file path
        success: true
      };
      
    } catch (error) {
      console.error('❌ Services_Visuals_Attach upload failed:', error);
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

  // Two-step upload method for Attach table - Upload to Files API then create record with path
  private async twoStepUploadForAttach(projectId: number, typeId: number, title: string, notes: string, file: File) {
    console.log('📦 Two-step upload for Attach table (Files API method)');
    
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
      console.log('✅ File uploaded to Files API:', uploadResult);
      
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
          console.log('✅ Attach record created successfully:', createResult);
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
      console.error('❌ Two-step upload failed:', error);
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
      // Step 1: Upload new file to Caspio Files API
      console.log('Replacing attachment: uploading new file to Files API...');
      const formData = new FormData();
      formData.append('file', file, file.name);
      
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
      console.log('✅ Replacement file uploaded to Files API, path:', filePath);
      
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
      
      console.log('✅ Attachment record updated with new file');
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
