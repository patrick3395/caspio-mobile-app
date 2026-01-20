import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError, timer, of } from 'rxjs';
import { tap, retryWhen, mergeMap, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { RetryNotificationService } from './retry-notification.service';
import { OfflineService } from './offline.service';
import { ApiCacheService, CacheOptions, CACHE_STRATEGIES } from './api-cache.service';

export interface QueuedActionResult {
  queued: boolean;
  requestId?: string;
  message: string;
}

/**
 * Options for cached GET requests
 */
export interface CachedGetOptions {
  headers?: HttpHeaders;
  cache?: CacheOptions;
  /** Patterns to invalidate this cache (e.g., 'projects' invalidates when projects change) */
  invalidateOn?: string[];
}

/**
 * Service for making requests to the Express.js backend on AWS
 * This replaces direct Caspio API calls
 * Includes automatic retry with exponential backoff for failed requests (web only)
 * G2-ERRORS-003: Added offline detection and action queueing
 * G2-PERF-004: Added request caching and deduplication (web only)
 */
@Injectable({
  providedIn: 'root'
})
export class ApiGatewayService {
  private readonly baseUrl: string;

  // Re-export cache strategies for consumers
  static readonly CACHE_STRATEGIES = CACHE_STRATEGIES;

  constructor(
    private http: HttpClient,
    private retryNotification: RetryNotificationService,
    private offlineService: OfflineService,
    private apiCache: ApiCacheService
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

  // ==========================================
  // G2-PERF-004: Cached GET with deduplication
  // ==========================================

  /**
   * Make GET request with caching and request deduplication (web only)
   *
   * Features:
   * - Returns cached data immediately if available and fresh
   * - Stale-while-revalidate: Returns stale data while fetching fresh in background
   * - Request deduplication: Multiple simultaneous identical requests share one HTTP call
   * - On mobile: Falls back to regular non-cached GET
   *
   * @param endpoint The API endpoint
   * @param params Query parameters (used for cache key generation)
   * @param options Cache and request options
   *
   * @example
   * // Basic usage with default DYNAMIC strategy (30s stale, 2min max)
   * this.api.getCached('/api/projects', null)
   *
   * // With cache strategy
   * this.api.getCached('/api/templates', null, { cache: CACHE_STRATEGIES.STATIC })
   *
   * // With entity tracking for auto-invalidation
   * this.api.getCached('/api/projects/123', null, {
   *   cache: { ...CACHE_STRATEGIES.DYNAMIC, entityType: 'project', entityId: '123' }
   * })
   */
  getCached<T>(endpoint: string, params?: any, options?: CachedGetOptions): Observable<T> {
    // On mobile, bypass caching and use regular GET
    if (!environment.isWeb) {
      return this.get<T>(endpoint, { headers: options?.headers });
    }

    const url = `${this.baseUrl}${endpoint}`;
    const cacheOptions = options?.cache || CACHE_STRATEGIES.DYNAMIC;

    return this.apiCache.get<T>(
      endpoint,
      params,
      () => this.withRetry(this.http.get<T>(url, { headers: options?.headers }), endpoint),
      cacheOptions
    );
  }

  /**
   * Make POST request to API Gateway
   * Automatically invalidates related cache entries on success (web only)
   */
  post<T>(endpoint: string, body: any, options?: { headers?: HttpHeaders, idempotencyKey?: string, invalidatePatterns?: string[] }): Observable<T> {
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

    return this.withRetry(this.http.post<T>(url, body, { ...options, headers }), endpoint).pipe(
      tap(() => {
        // G2-PERF-004: Invalidate cache on mutation (web only)
        if (environment.isWeb) {
          this.invalidateCacheForEndpoint(endpoint, options?.invalidatePatterns);
        }
      })
    );
  }

  /**
   * Make PUT request to API Gateway
   * Automatically invalidates related cache entries on success (web only)
   */
  put<T>(endpoint: string, body: any, options?: { headers?: HttpHeaders, invalidatePatterns?: string[] }): Observable<T> {
    const url = `${this.baseUrl}${endpoint}`;
    return this.withRetry(this.http.put<T>(url, body, options), endpoint).pipe(
      tap(() => {
        // G2-PERF-004: Invalidate cache on mutation (web only)
        if (environment.isWeb) {
          this.invalidateCacheForEndpoint(endpoint, options?.invalidatePatterns);
        }
      })
    );
  }

  /**
   * Make DELETE request to API Gateway
   * Automatically invalidates related cache entries on success (web only)
   */
  delete<T>(endpoint: string, options?: { headers?: HttpHeaders, invalidatePatterns?: string[] }): Observable<T> {
    const url = `${this.baseUrl}${endpoint}`;
    return this.withRetry(this.http.delete<T>(url, options), endpoint).pipe(
      tap(() => {
        // G2-PERF-004: Invalidate cache on mutation (web only)
        if (environment.isWeb) {
          this.invalidateCacheForEndpoint(endpoint, options?.invalidatePatterns);
        }
      })
    );
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

  // ==========================================
  // G2-PERF-004: Cache Management Methods
  // ==========================================

  /**
   * Invalidate cache entries related to an endpoint
   * Extracts resource type from endpoint and invalidates matching patterns
   */
  private invalidateCacheForEndpoint(endpoint: string, additionalPatterns?: string[]): void {
    // Extract resource pattern from endpoint (e.g., /api/projects/123 -> projects)
    const resourcePattern = this.extractResourcePattern(endpoint);
    if (resourcePattern) {
      console.log(`[ApiGateway] 🗑️ Invalidating cache for: ${resourcePattern}`);
      this.apiCache.invalidatePattern(resourcePattern);
    }

    // Invalidate additional patterns if provided
    if (additionalPatterns?.length) {
      additionalPatterns.forEach(pattern => {
        console.log(`[ApiGateway] 🗑️ Invalidating additional pattern: ${pattern}`);
        this.apiCache.invalidatePattern(pattern);
      });
    }
  }

  /**
   * Extract resource pattern from endpoint for cache invalidation
   * e.g., /api/projects/123 -> projects
   * e.g., /api/services/456/visuals -> services, visuals
   */
  private extractResourcePattern(endpoint: string): string | null {
    const match = endpoint.match(/\/api\/([^/]+)/);
    return match ? match[1] : null;
  }

  /**
   * Manually invalidate cache by pattern (web only)
   * Useful for custom cache invalidation scenarios
   */
  invalidateCache(pattern: string): void {
    if (environment.isWeb) {
      this.apiCache.invalidatePattern(pattern);
    }
  }

  /**
   * Invalidate cache for a specific entity (web only)
   */
  invalidateCacheForEntity(entityType: string, entityId?: string): void {
    if (environment.isWeb) {
      this.apiCache.invalidateEntity(entityType, entityId);
    }
  }

  /**
   * Clear all cached data (web only)
   */
  clearAllCache(): void {
    if (environment.isWeb) {
      this.apiCache.clearAll();
    }
  }

  /**
   * Get cache statistics (web only)
   */
  getCacheStats(): { cacheSize: number; inFlightCount: number; hits: number; misses: number; revalidations: number; hitRate: number } | null {
    if (environment.isWeb) {
      return this.apiCache.getStats();
    }
    return null;
  }
}

