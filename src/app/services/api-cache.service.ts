import { Injectable } from '@angular/core';
import { Observable, of, Subject, BehaviorSubject } from 'rxjs';
import { tap, shareReplay, finalize } from 'rxjs/operators';
import { environment } from '../../environments/environment';

/**
 * Cache entry with stale-while-revalidate support
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
  staleAt: number;
  isRevalidating: boolean;
}

/**
 * In-flight request tracking for deduplication
 */
interface InFlightRequest<T> {
  observable: Observable<T>;
  timestamp: number;
}

/**
 * Cache strategy options
 */
export interface CacheOptions {
  /** Time in ms before data is considered stale (default: 30s) */
  staleTime?: number;
  /** Time in ms before data expires completely (default: 5m) */
  maxAge?: number;
  /** Cache key override (default: generated from endpoint + params) */
  cacheKey?: string;
  /** Whether to persist to localStorage (default: false) */
  persist?: boolean;
  /** Entity type for invalidation tracking */
  entityType?: string;
  /** Entity ID for invalidation tracking */
  entityId?: string;
}

/**
 * Predefined cache strategies
 */
export const CACHE_STRATEGIES = {
  /** For data that rarely changes (templates, service types, states) */
  STATIC: { staleTime: 3600000, maxAge: 86400000, persist: true }, // 1hr stale, 24hr max

  /** For data that changes occasionally (user data, company info) */
  SEMI_STATIC: { staleTime: 300000, maxAge: 1800000, persist: true }, // 5min stale, 30min max

  /** For data that changes frequently (project lists, service lists) */
  DYNAMIC: { staleTime: 30000, maxAge: 120000, persist: false }, // 30s stale, 2min max

  /** For highly mutable data (individual records being edited) */
  VOLATILE: { staleTime: 10000, maxAge: 60000, persist: false }, // 10s stale, 1min max

  /** No caching - always fetch fresh */
  NONE: { staleTime: 0, maxAge: 0, persist: false }
};

/**
 * G2-PERF-004: API Response Caching Service with Request Deduplication
 *
 * Features:
 * - Stale-while-revalidate: Returns cached data immediately while fetching fresh data in background
 * - Request deduplication: Multiple identical requests within window share single HTTP call
 * - Cache invalidation: Automatic invalidation on mutations (POST/PUT/DELETE)
 * - Web-only: All caching features are disabled on mobile
 *
 * Usage:
 * ```typescript
 * // Get with caching (returns cached, revalidates in background if stale)
 * this.apiCache.get('/api/projects', null, () => this.http.get('/api/projects'), CACHE_STRATEGIES.DYNAMIC)
 *
 * // Invalidate after mutation
 * this.apiCache.invalidatePattern('/api/projects')
 * ```
 */
@Injectable({
  providedIn: 'root'
})
export class ApiCacheService {
  // In-memory cache
  private cache = new Map<string, CacheEntry<any>>();

  // In-flight requests for deduplication
  private inFlightRequests = new Map<string, InFlightRequest<any>>();

  // Deduplication window in ms
  private readonly DEDUP_WINDOW = 100;

  // Subject for cache updates (stale-while-revalidate)
  private cacheUpdates = new Map<string, Subject<any>>();

  // Observable for cache statistics
  private statsSubject = new BehaviorSubject<{ hits: number; misses: number; revalidations: number }>({
    hits: 0,
    misses: 0,
    revalidations: 0
  });

  stats$ = this.statsSubject.asObservable();

  constructor() {
    // Load persisted cache on init (web only)
    if (environment.isWeb) {
      this.loadFromLocalStorage();
    }
  }

  /**
   * Get data with caching and stale-while-revalidate strategy
   *
   * @param endpoint The API endpoint (used for cache key generation)
   * @param params Request parameters (included in cache key)
   * @param requestFn Function that returns the Observable to execute
   * @param options Cache options (strategy, persistence, etc.)
   * @returns Observable that emits cached data immediately if available, then fresh data
   */
  get<T>(
    endpoint: string,
    params: any,
    requestFn: () => Observable<T>,
    options: CacheOptions = CACHE_STRATEGIES.DYNAMIC
  ): Observable<T> {
    // On mobile, bypass all caching
    if (!environment.isWeb) {
      return requestFn();
    }

    const cacheKey = options.cacheKey || this.generateCacheKey(endpoint, params, options.entityType, options.entityId);
    const now = Date.now();
    const entry = this.cache.get(cacheKey);

    // Case 1: Fresh cache hit - return immediately
    if (entry && now < entry.staleAt) {
      this.incrementStats('hits');
      return of(entry.data);
    }

    // Case 2: Stale cache hit - return cached, revalidate in background
    if (entry && now < entry.expiresAt && !entry.isRevalidating) {
      this.incrementStats('hits');
      this.incrementStats('revalidations');

      // Mark as revalidating to prevent duplicate background fetches
      entry.isRevalidating = true;

      // Background revalidation
      this.revalidateInBackground(cacheKey, requestFn, options);

      return of(entry.data);
    }

    // Case 3: Expired or no cache - fetch with deduplication
    this.incrementStats('misses');

    return this.fetchWithDeduplication(cacheKey, requestFn, options);
  }

  /**
   * Fetch with request deduplication
   * If identical request is in flight, share that request instead of making new one
   */
  private fetchWithDeduplication<T>(
    cacheKey: string,
    requestFn: () => Observable<T>,
    options: CacheOptions
  ): Observable<T> {
    const now = Date.now();
    const existing = this.inFlightRequests.get(cacheKey);

    // If identical request is in flight within dedup window, share it
    if (existing && (now - existing.timestamp) < this.DEDUP_WINDOW) {
      return existing.observable;
    }

    // Create new shared request
    const observable = requestFn().pipe(
      tap(data => {
        this.setCache(cacheKey, data, options);
      }),
      shareReplay(1),
      finalize(() => {
        // Clean up in-flight request after completion
        setTimeout(() => {
          this.inFlightRequests.delete(cacheKey);
        }, this.DEDUP_WINDOW);
      })
    );

    // Track in-flight request
    this.inFlightRequests.set(cacheKey, {
      observable,
      timestamp: now
    });

    return observable;
  }

  /**
   * Revalidate cache in background (stale-while-revalidate)
   */
  private revalidateInBackground<T>(
    cacheKey: string,
    requestFn: () => Observable<T>,
    options: CacheOptions
  ): void {
    requestFn().subscribe({
      next: (data) => {
        this.setCache(cacheKey, data, options);

        // Notify subscribers of cache update
        const updateSubject = this.cacheUpdates.get(cacheKey);
        if (updateSubject) {
          updateSubject.next(data);
        }
      },
      error: (error) => {
        console.warn(`[ApiCache] ⚠️ Background revalidation failed: ${cacheKey}`, error);
        // Keep stale data on revalidation failure
        const entry = this.cache.get(cacheKey);
        if (entry) {
          entry.isRevalidating = false;
        }
      }
    });
  }

  /**
   * Set data in cache
   */
  private setCache<T>(cacheKey: string, data: T, options: CacheOptions): void {
    const now = Date.now();
    const staleTime = options.staleTime ?? CACHE_STRATEGIES.DYNAMIC.staleTime;
    const maxAge = options.maxAge ?? CACHE_STRATEGIES.DYNAMIC.maxAge;

    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      staleAt: now + staleTime,
      expiresAt: now + maxAge,
      isRevalidating: false
    };

    this.cache.set(cacheKey, entry);

    // Persist to localStorage if requested
    if (options.persist) {
      this.persistToLocalStorage(cacheKey, entry);
    }
  }

  /**
   * Generate cache key from endpoint and params
   */
  private generateCacheKey(endpoint: string, params: any, entityType?: string, entityId?: string): string {
    let key = `api::${endpoint}`;

    if (params && Object.keys(params).length > 0) {
      const sortedParams = JSON.stringify(params, Object.keys(params).sort());
      key += `::${sortedParams}`;
    }

    // Include entity version for automatic invalidation
    if (entityType && entityId) {
      const version = this.getEntityVersion(entityType, entityId);
      key += `::v${version}`;
    }

    return key;
  }

  // ==========================================
  // Cache Invalidation
  // ==========================================

  /**
   * Invalidate cache for a specific key
   */
  invalidate(cacheKey: string): void {
    if (!environment.isWeb) return;

    this.cache.delete(cacheKey);
    this.removeFromLocalStorage(cacheKey);
    this.inFlightRequests.delete(cacheKey);
  }

  /**
   * Invalidate cache entries matching a pattern
   * Useful for invalidating related data after mutations
   */
  invalidatePattern(pattern: string): void {
    if (!environment.isWeb) return;


    // Invalidate memory cache
    const keysToDelete: string[] = [];
    this.cache.forEach((_, key) => {
      if (key.includes(pattern)) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => {
      this.cache.delete(key);
      this.removeFromLocalStorage(key);
    });

    // Invalidate in-flight requests
    this.inFlightRequests.forEach((_, key) => {
      if (key.includes(pattern)) {
        this.inFlightRequests.delete(key);
      }
    });

  }

  /**
   * Invalidate cache for a specific entity type
   */
  invalidateEntity(entityType: string, entityId?: string): void {
    if (!environment.isWeb) return;

    const pattern = entityId ? `${entityType}::${entityId}` : entityType;
    this.invalidatePattern(pattern);

    // Increment entity version to auto-invalidate versioned keys
    if (entityId) {
      this.incrementEntityVersion(entityType, entityId);
    }
  }

  /**
   * Clear all cache
   */
  clearAll(): void {
    if (!environment.isWeb) return;

    this.cache.clear();
    this.inFlightRequests.clear();
    this.clearLocalStorageCache();
    this.entityVersions.clear();
  }

  // ==========================================
  // Entity Version Tracking (for auto-invalidation)
  // ==========================================

  private entityVersions = new Map<string, number>();

  private getEntityVersion(entityType: string, entityId: string): number {
    const key = `${entityType}::${entityId}`;
    return this.entityVersions.get(key) || 0;
  }

  private incrementEntityVersion(entityType: string, entityId: string): void {
    const key = `${entityType}::${entityId}`;
    const newVersion = (this.entityVersions.get(key) || 0) + 1;
    this.entityVersions.set(key, newVersion);
  }

  // ==========================================
  // LocalStorage Persistence
  // ==========================================

  private readonly STORAGE_PREFIX = 'apicache_';

  private persistToLocalStorage<T>(cacheKey: string, entry: CacheEntry<T>): void {
    try {
      localStorage.setItem(
        this.STORAGE_PREFIX + cacheKey,
        JSON.stringify(entry)
      );
    } catch (e) {
      console.warn('[ApiCache] Failed to persist to localStorage:', e);
    }
  }

  private removeFromLocalStorage(cacheKey: string): void {
    try {
      localStorage.removeItem(this.STORAGE_PREFIX + cacheKey);
    } catch (e) {
      // Ignore
    }
  }

  private loadFromLocalStorage(): void {
    try {
      const now = Date.now();
      const keys = Object.keys(localStorage).filter(k => k.startsWith(this.STORAGE_PREFIX));

      keys.forEach(storageKey => {
        try {
          const entry = JSON.parse(localStorage.getItem(storageKey) || '{}') as CacheEntry<any>;

          // Only load non-expired entries
          if (entry.expiresAt && now < entry.expiresAt) {
            const cacheKey = storageKey.replace(this.STORAGE_PREFIX, '');
            entry.isRevalidating = false; // Reset revalidation flag
            this.cache.set(cacheKey, entry);
          } else {
            // Clean up expired entry
            localStorage.removeItem(storageKey);
          }
        } catch (e) {
          localStorage.removeItem(storageKey);
        }
      });

    } catch (e) {
      console.warn('[ApiCache] Failed to load from localStorage:', e);
    }
  }

  private clearLocalStorageCache(): void {
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith(this.STORAGE_PREFIX));
      keys.forEach(key => localStorage.removeItem(key));
    } catch (e) {
      // Ignore
    }
  }

  // ==========================================
  // Cache Updates Subscription (for stale-while-revalidate)
  // ==========================================

  /**
   * Subscribe to cache updates for a specific key
   * Useful for components that want to be notified when background revalidation completes
   */
  onCacheUpdate<T>(cacheKey: string): Observable<T> {
    if (!this.cacheUpdates.has(cacheKey)) {
      this.cacheUpdates.set(cacheKey, new Subject<any>());
    }
    return this.cacheUpdates.get(cacheKey)!.asObservable();
  }

  // ==========================================
  // Statistics
  // ==========================================

  private incrementStats(type: 'hits' | 'misses' | 'revalidations'): void {
    const current = this.statsSubject.value;
    this.statsSubject.next({
      ...current,
      [type]: current[type] + 1
    });
  }

  getStats(): {
    cacheSize: number;
    inFlightCount: number;
    hits: number;
    misses: number;
    revalidations: number;
    hitRate: number;
  } {
    const stats = this.statsSubject.value;
    const total = stats.hits + stats.misses;
    return {
      cacheSize: this.cache.size,
      inFlightCount: this.inFlightRequests.size,
      ...stats,
      hitRate: total > 0 ? (stats.hits / total) * 100 : 0
    };
  }

  /**
   * Get all cached keys (for debugging)
   */
  getCachedKeys(): string[] {
    return Array.from(this.cache.keys());
  }
}
