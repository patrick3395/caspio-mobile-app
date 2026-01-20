import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError, timer, of } from 'rxjs';
import { tap, retryWhen, mergeMap, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { RetryNotificationService } from './retry-notification.service';
import { OfflineService } from './offline.service';

export interface QueuedActionResult {
  queued: boolean;
  requestId?: string;
  message: string;
}

/**
 * Service for making requests to the Express.js backend on AWS
 * This replaces direct Caspio API calls
 * Includes automatic retry with exponential backoff for failed requests (web only)
 * G2-ERRORS-003: Added offline detection and action queueing
 */
@Injectable({
  providedIn: 'root'
})
export class ApiGatewayService {
  private readonly baseUrl: string;

  constructor(
    private http: HttpClient,
    private retryNotification: RetryNotificationService,
    private offlineService: OfflineService
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

  // ==========================================
  // G2-ERRORS-003: Offline-aware operations
  // ==========================================

  /**
   * Check if the app is currently online (web only)
   */
  isOnline(): boolean {
    if (!environment.isWeb) {
      return true; // Mobile handles offline differently
    }
    return this.offlineService.isOnline();
  }

  /**
   * Queue a POST request for later when offline (web only)
   * Returns immediately with a queued status
   */
  queuePostWhenOffline(endpoint: string, body: any): QueuedActionResult {
    if (!environment.isWeb) {
      return { queued: false, message: 'Queueing not available on mobile' };
    }

    const requestId = this.offlineService.queueRequest('POST', endpoint, body);
    console.log(`[ApiGateway] Queued POST request for ${endpoint} (ID: ${requestId})`);

    return {
      queued: true,
      requestId,
      message: 'Your action has been queued and will be synced when you\'re back online.'
    };
  }

  /**
   * Queue a PUT request for later when offline (web only)
   */
  queuePutWhenOffline(endpoint: string, body: any): QueuedActionResult {
    if (!environment.isWeb) {
      return { queued: false, message: 'Queueing not available on mobile' };
    }

    const requestId = this.offlineService.queueRequest('PUT', endpoint, body);
    console.log(`[ApiGateway] Queued PUT request for ${endpoint} (ID: ${requestId})`);

    return {
      queued: true,
      requestId,
      message: 'Your changes have been saved locally and will be synced when you\'re back online.'
    };
  }

  /**
   * Queue a DELETE request for later when offline (web only)
   */
  queueDeleteWhenOffline(endpoint: string): QueuedActionResult {
    if (!environment.isWeb) {
      return { queued: false, message: 'Queueing not available on mobile' };
    }

    const requestId = this.offlineService.queueRequest('DELETE', endpoint, null);
    console.log(`[ApiGateway] Queued DELETE request for ${endpoint} (ID: ${requestId})`);

    return {
      queued: true,
      requestId,
      message: 'Your delete request has been queued and will be processed when you\'re back online.'
    };
  }

  /**
   * Make a POST request with offline fallback (web only)
   * If offline, queues the request and returns a success-like response
   */
  postWithOfflineFallback<T>(
    endpoint: string,
    body: any,
    options?: { headers?: HttpHeaders, idempotencyKey?: string }
  ): Observable<T | QueuedActionResult> {
    if (!environment.isWeb) {
      return this.post<T>(endpoint, body, options);
    }

    if (!this.isOnline()) {
      const result = this.queuePostWhenOffline(endpoint, body);
      return of(result as T | QueuedActionResult);
    }

    return this.post<T>(endpoint, body, options).pipe(
      catchError(error => {
        // If the error is due to network issues, queue the request
        if (error.status === 0 || error.status === 504 || !navigator.onLine) {
          const result = this.queuePostWhenOffline(endpoint, body);
          return of(result as T | QueuedActionResult);
        }
        return throwError(() => error);
      })
    );
  }

  /**
   * Make a PUT request with offline fallback (web only)
   */
  putWithOfflineFallback<T>(
    endpoint: string,
    body: any,
    options?: { headers?: HttpHeaders }
  ): Observable<T | QueuedActionResult> {
    if (!environment.isWeb) {
      return this.put<T>(endpoint, body, options);
    }

    if (!this.isOnline()) {
      const result = this.queuePutWhenOffline(endpoint, body);
      return of(result as T | QueuedActionResult);
    }

    return this.put<T>(endpoint, body, options).pipe(
      catchError(error => {
        if (error.status === 0 || error.status === 504 || !navigator.onLine) {
          const result = this.queuePutWhenOffline(endpoint, body);
          return of(result as T | QueuedActionResult);
        }
        return throwError(() => error);
      })
    );
  }

  /**
   * Make a DELETE request with offline fallback (web only)
   */
  deleteWithOfflineFallback<T>(
    endpoint: string,
    options?: { headers?: HttpHeaders }
  ): Observable<T | QueuedActionResult> {
    if (!environment.isWeb) {
      return this.delete<T>(endpoint, options);
    }

    if (!this.isOnline()) {
      const result = this.queueDeleteWhenOffline(endpoint);
      return of(result as T | QueuedActionResult);
    }

    return this.delete<T>(endpoint, options).pipe(
      catchError(error => {
        if (error.status === 0 || error.status === 504 || !navigator.onLine) {
          const result = this.queueDeleteWhenOffline(endpoint);
          return of(result as T | QueuedActionResult);
        }
        return throwError(() => error);
      })
    );
  }
}

