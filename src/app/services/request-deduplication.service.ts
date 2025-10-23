import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { shareReplay, tap, finalize } from 'rxjs/operators';

interface CachedRequest<T> {
  observable: Observable<T>;
  timestamp: number;
  refCount: number;
}

/**
 * RequestDeduplicationService
 *
 * Prevents duplicate API calls when multiple components request the same data simultaneously.
 * If 3 components all request "getProjectById(123)" at the same time, only 1 API call is made
 * and all 3 components receive the same response.
 *
 * Key Features:
 * - Deduplicates identical requests
 * - Shares responses across multiple subscribers
 * - Automatically cleans up after requests complete
 * - Respects mutation tracking (invalidated on mutations)
 * - 100ms window for request deduplication
 *
 * Usage:
 * ```typescript
 * // Instead of:
 * this.http.get('/api/project/123')
 *
 * // Use:
 * this.dedup.deduplicate('project-123', () => this.http.get('/api/project/123'))
 * ```
 */
@Injectable({
  providedIn: 'root'
})
export class RequestDeduplicationService {
  private activeRequests = new Map<string, CachedRequest<any>>();
  private requestCleanupTimeout = new Map<string, any>();

  // Time window for request deduplication (ms)
  private readonly DEDUP_WINDOW = 100;

  constructor() {}

  /**
   * Deduplicate a request
   *
   * If an identical request is already in flight, returns the existing observable.
   * Otherwise, creates a new request and caches it for the deduplication window.
   *
   * @param key Unique identifier for the request
   * @param requestFn Function that returns the Observable to execute
   * @returns Observable that shares the underlying request
   */
  deduplicate<T>(key: string, requestFn: () => Observable<T>): Observable<T> {
    // Check if request is already in flight
    const existing = this.activeRequests.get(key);
    const now = Date.now();

    if (existing && (now - existing.timestamp) < this.DEDUP_WINDOW) {
      console.log('[RequestDedup] 🔄 Reusing existing request:', key);
      existing.refCount++;
      return existing.observable;
    }

    console.log('[RequestDedup] 🚀 Starting new request:', key);

    // Create new shared request
    const observable = requestFn().pipe(
      shareReplay(1), // Share result with all subscribers
      tap(() => {
        console.log('[RequestDedup] ✅ Request completed:', key);
      }),
      finalize(() => {
        // Clean up after a delay (allow for late subscribers)
        const timeout = setTimeout(() => {
          console.log('[RequestDedup] 🗑️ Cleaning up request:', key);
          this.activeRequests.delete(key);
          this.requestCleanupTimeout.delete(key);
        }, this.DEDUP_WINDOW);

        this.requestCleanupTimeout.set(key, timeout);
      })
    );

    // Cache the request
    this.activeRequests.set(key, {
      observable,
      timestamp: now,
      refCount: 1
    });

    return observable;
  }

  /**
   * Invalidate a request from the dedup cache
   *
   * Call this after mutations to ensure fresh data is fetched
   */
  invalidate(key: string): void {
    console.log('[RequestDedup] ❌ Invalidating request:', key);
    this.activeRequests.delete(key);

    const timeout = this.requestCleanupTimeout.get(key);
    if (timeout) {
      clearTimeout(timeout);
      this.requestCleanupTimeout.delete(key);
    }
  }

  /**
   * Invalidate requests by pattern
   */
  invalidatePattern(pattern: string): void {
    console.log('[RequestDedup] ❌ Invalidating requests matching:', pattern);

    const keysToInvalidate = Array.from(this.activeRequests.keys()).filter(key =>
      key.includes(pattern)
    );

    keysToInvalidate.forEach(key => this.invalidate(key));
  }

  /**
   * Clear all cached requests
   */
  clear(): void {
    console.log('[RequestDedup] 🗑️ Clearing all cached requests');

    this.requestCleanupTimeout.forEach(timeout => clearTimeout(timeout));
    this.requestCleanupTimeout.clear();
    this.activeRequests.clear();
  }

  /**
   * Get statistics about active requests
   */
  getStats(): { activeCount: number; totalRefCount: number; keys: string[] } {
    let totalRefCount = 0;
    const keys: string[] = [];

    this.activeRequests.forEach((value, key) => {
      totalRefCount += value.refCount;
      keys.push(key);
    });

    return {
      activeCount: this.activeRequests.size,
      totalRefCount,
      keys
    };
  }

  /**
   * Helper: Generate cache key for API requests
   */
  static generateKey(endpoint: string, params?: any): string {
    if (!params || Object.keys(params).length === 0) {
      return endpoint;
    }

    const paramString = JSON.stringify(params, Object.keys(params).sort());
    return `${endpoint}::${paramString}`;
  }

  /**
   * Helper: Generate key for project requests
   */
  static projectKey(projectId: string): string {
    return `project::${projectId}`;
  }

  /**
   * Helper: Generate key for service requests
   */
  static serviceKey(serviceId: string): string {
    return `service::${serviceId}`;
  }

  /**
   * Helper: Generate key for services by project
   */
  static servicesByProjectKey(projectId: string): string {
    return `services-by-project::${projectId}`;
  }

  /**
   * Helper: Generate key for attachments by project
   */
  static attachmentsByProjectKey(projectId: string): string {
    return `attachments-by-project::${projectId}`;
  }

  /**
   * Helper: Generate key for documents by service
   */
  static documentsByServiceKey(serviceId: string): string {
    return `documents-by-service::${serviceId}`;
  }
}
