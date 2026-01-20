import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError, timer } from 'rxjs';
import { tap, retryWhen, mergeMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { RetryNotificationService } from './retry-notification.service';

/**
 * Service for making requests to the Express.js backend on AWS
 * This replaces direct Caspio API calls
 * Includes automatic retry with exponential backoff for failed requests (web only)
 */
@Injectable({
  providedIn: 'root'
})
export class ApiGatewayService {
  private readonly baseUrl: string;

  constructor(
    private http: HttpClient,
    private retryNotification: RetryNotificationService
  ) {
    this.baseUrl = environment.apiGatewayUrl || '';
  }

  /**
   * Apply retry logic with exponential backoff (web only)
   */
  private withRetry<T>(request$: Observable<T>, endpoint: string): Observable<T> {
    if (!environment.isWeb) {
      return request$;
    }

    let currentAttempt = 0;

    return request$.pipe(
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

            console.log(`⏳ API Gateway Retry ${retryAttempt}/${maxRetries} for ${endpoint} after ${delayMs}ms`);
            this.retryNotification.notifyRetryAttempt(endpoint, retryAttempt, maxRetries, delayMs);

            return timer(delayMs);
          })
        )
      ),
      tap(() => {
        // Notify success after retries (web only)
        if (currentAttempt > 0) {
          this.retryNotification.notifyRetrySuccess(endpoint, currentAttempt + 1);
        }
      })
    );
  }

  /**
   * Make GET request to API Gateway
   */
  get<T>(endpoint: string, options?: { headers?: HttpHeaders }): Observable<T> {
    const url = `${this.baseUrl}${endpoint}`;
    return this.withRetry(this.http.get<T>(url, options), endpoint);
  }

  /**
   * Make POST request to API Gateway
   */
  post<T>(endpoint: string, body: any, options?: { headers?: HttpHeaders, idempotencyKey?: string }): Observable<T> {
    const url = `${this.baseUrl}${endpoint}`;

    // Ensure Content-Type is set for JSON requests
    let headers = options?.headers || new HttpHeaders();
    if (!headers.has('Content-Type')) {
      headers = headers.set('Content-Type', 'application/json');
    }

    // Add idempotency key if provided
    if (options?.idempotencyKey) {
      headers = headers.set('Idempotency-Key', options.idempotencyKey);
    }

    return this.withRetry(this.http.post<T>(url, body, { ...options, headers }), endpoint);
  }

  /**
   * Make PUT request to API Gateway
   */
  put<T>(endpoint: string, body: any, options?: { headers?: HttpHeaders }): Observable<T> {
    const url = `${this.baseUrl}${endpoint}`;
    return this.withRetry(this.http.put<T>(url, body, options), endpoint);
  }

  /**
   * Make DELETE request to API Gateway
   */
  delete<T>(endpoint: string, options?: { headers?: HttpHeaders }): Observable<T> {
    const url = `${this.baseUrl}${endpoint}`;
    return this.withRetry(this.http.delete<T>(url, options), endpoint);
  }

  /**
   * Upload file to API Gateway
   */
  uploadFile(endpoint: string, formData: FormData): Observable<any> {
    const url = `${this.baseUrl}${endpoint}`;
    return this.withRetry(this.http.post(url, formData), endpoint);
  }

  /**
   * Check API health
   */
  healthCheck(): Observable<any> {
    return this.get('/api/health');
  }
}

