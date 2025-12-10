import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, from } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

/**
 * Service for making requests to the Express.js backend on AWS
 * This replaces direct Caspio API calls
 */
@Injectable({
  providedIn: 'root'
})
export class ApiGatewayService {
  private readonly baseUrl: string;

  constructor(private http: HttpClient) {
    this.baseUrl = environment.apiGatewayUrl || '';
  }

  /**
   * Make GET request to API Gateway
   */
  get<T>(endpoint: string, options?: { headers?: HttpHeaders }): Observable<T> {
    const url = `${this.baseUrl}${endpoint}`;
    return this.http.get<T>(url, options);
  }

  /**
   * Make POST request to API Gateway
   */
  post<T>(endpoint: string, body: any, options?: { headers?: HttpHeaders, idempotencyKey?: string }): Observable<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    // Add idempotency key if provided
    let headers = options?.headers;
    if (options?.idempotencyKey) {
      headers = headers || new HttpHeaders();
      headers = headers.set('Idempotency-Key', options.idempotencyKey);
    }
    
    return this.http.post<T>(url, body, { ...options, headers });
  }

  /**
   * Make PUT request to API Gateway
   */
  put<T>(endpoint: string, body: any, options?: { headers?: HttpHeaders }): Observable<T> {
    const url = `${this.baseUrl}${endpoint}`;
    return this.http.put<T>(url, body, options);
  }

  /**
   * Make DELETE request to API Gateway
   */
  delete<T>(endpoint: string, options?: { headers?: HttpHeaders }): Observable<T> {
    const url = `${this.baseUrl}${endpoint}`;
    return this.http.delete<T>(url, options);
  }

  /**
   * Upload file to API Gateway
   */
  uploadFile(endpoint: string, formData: FormData): Observable<any> {
    const url = `${this.baseUrl}${endpoint}`;
    return this.http.post(url, formData);
  }

  /**
   * Check API health
   */
  healthCheck(): Observable<any> {
    return this.get('/api/health');
  }
}

