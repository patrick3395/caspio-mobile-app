import { Injectable } from '@angular/core';

interface CacheEntry {
  data: any;
  timestamp: number;
  expiresIn: number;
}

@Injectable({
  providedIn: 'root'
})
export class CacheService {
  private cache = new Map<string, CacheEntry>();
  private localStorage = window.localStorage;
  
  // Default cache times (in milliseconds)
  readonly CACHE_TIMES = {
    SHORT: 60000,        // 1 minute - for frequently changing data (mutable data)
    MEDIUM: 300000,      // 5 minutes - for semi-static data
    LONG: 900000,        // 15 minutes - for mostly static data
    VERY_LONG: 3600000,  // 1 hour - for static data like templates
    OFFLINE: 86400000,   // 24 hours - for offline mode
    
    // Performance optimization cache times
    STATIC_DATA: 86400000,      // 24 hours - for static data like templates, service types
    PROJECT_LIST: 120000,       // 2 minutes - for project lists (REDUCED from 15 min)
    IMAGES: 604800000,          // 7 days - for images
    API_RESPONSES: 60000,       // 1 minute - for API responses (REDUCED from 5 min for mutable data)
    USER_DATA: 1800000,         // 30 minutes - for user data
    SERVICE_TYPES: 86400000,    // 24 hours - for service types (rarely change)
    TEMPLATES: 86400000,        // 24 hours - for templates (rarely change)
    STATES: 86400000            // 24 hours - for states list (never changes)
  };

  constructor() {
    // Load cached data from localStorage on init
    this.loadFromLocalStorage();
  }

  /**
   * Set data in cache with optional persistence to localStorage
   */
  set(key: string, data: any, expiresIn: number = this.CACHE_TIMES.MEDIUM, persist: boolean = false): void {
    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      expiresIn
    };
    
    this.cache.set(key, entry);
    
    // Persist to localStorage for offline mode
    if (persist) {
      try {
        this.localStorage.setItem(`cache_${key}`, JSON.stringify(entry));
      } catch (e) {
        console.warn('Failed to persist cache to localStorage:', e);
      }
    }
  }

  /**
   * Get data from cache if not expired
   */
  get(key: string): any | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      // Try to load from localStorage
      return this.getFromLocalStorage(key);
    }
    
    // Check if expired
    if (Date.now() - entry.timestamp > entry.expiresIn) {
      this.cache.delete(key);
      this.localStorage.removeItem(`cache_${key}`);
      return null;
    }
    
    return entry.data;
  }

  /**
   * Check if cache has valid (non-expired) data
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Clear specific cache entry
   */
  clear(key: string): void {
    this.cache.delete(key);
    this.localStorage.removeItem(`cache_${key}`);
  }

  /**
   * Clear all cache entries
   */
  clearAll(): void {
    this.cache.clear();
    
    // Clear localStorage cache entries
    const keys = Object.keys(this.localStorage);
    keys.forEach(key => {
      if (key.startsWith('cache_')) {
        this.localStorage.removeItem(key);
      }
    });
  }

  /**
   * Clear expired entries
   */
  clearExpired(): void {
    const now = Date.now();
    
    // Clear from memory cache
    this.cache.forEach((entry, key) => {
      if (now - entry.timestamp > entry.expiresIn) {
        this.cache.delete(key);
      }
    });
    
    // Clear from localStorage
    const keys = Object.keys(this.localStorage);
    keys.forEach(key => {
      if (key.startsWith('cache_')) {
        try {
          const entry = JSON.parse(this.localStorage.getItem(key) || '{}') as CacheEntry;
          if (entry.timestamp && now - entry.timestamp > entry.expiresIn) {
            this.localStorage.removeItem(key);
          }
        } catch (e) {
          // Invalid entry, remove it
          this.localStorage.removeItem(key);
        }
      }
    });
  }

  /**
   * Get cache key for API calls
   */
  getApiCacheKey(endpoint: string, params?: any): string {
    const paramString = params ? JSON.stringify(params) : '';
    return `api_${endpoint}_${paramString}`;
  }

  /**
   * Load cached data from localStorage
   */
  private loadFromLocalStorage(): void {
    const keys = Object.keys(this.localStorage);
    const now = Date.now();
    
    keys.forEach(key => {
      if (key.startsWith('cache_')) {
        try {
          const entry = JSON.parse(this.localStorage.getItem(key) || '{}') as CacheEntry;
          
          // Only load non-expired entries
          if (entry.timestamp && now - entry.timestamp <= entry.expiresIn) {
            const cacheKey = key.replace('cache_', '');
            this.cache.set(cacheKey, entry);
          } else {
            // Clean up expired entry
            this.localStorage.removeItem(key);
          }
        } catch (e) {
          // Invalid entry, remove it
          this.localStorage.removeItem(key);
        }
      }
    });
  }

  /**
   * Get data from localStorage
   */
  private getFromLocalStorage(key: string): any | null {
    try {
      const stored = this.localStorage.getItem(`cache_${key}`);
      if (!stored) return null;
      
      const entry = JSON.parse(stored) as CacheEntry;
      
      // Check if expired
      if (Date.now() - entry.timestamp > entry.expiresIn) {
        this.localStorage.removeItem(`cache_${key}`);
        return null;
      }
      
      // Add to memory cache for faster access
      this.cache.set(key, entry);
      
      return entry.data;
    } catch (e) {
      return null;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { memoryEntries: number; localStorageEntries: number; totalSize: number } {
    const memoryEntries = this.cache.size;
    let localStorageEntries = 0;
    let totalSize = 0;
    
    Object.keys(this.localStorage).forEach(key => {
      if (key.startsWith('cache_')) {
        localStorageEntries++;
        totalSize += (this.localStorage.getItem(key) || '').length;
      }
    });
    
    return { memoryEntries, localStorageEntries, totalSize };
  }

  /**
   * Cache API response with appropriate strategy
   */
  setApiResponse(endpoint: string, params: any, data: any, strategy: keyof typeof this.CACHE_TIMES = 'API_RESPONSES'): void {
    const key = this.getApiCacheKey(endpoint, params);
    this.set(key, data, this.CACHE_TIMES[strategy], true); // Always persist API responses
  }

  /**
   * Get cached API response
   */
  getApiResponse(endpoint: string, params?: any): any | null {
    const key = this.getApiCacheKey(endpoint, params);
    return this.get(key);
  }

  /**
   * Cache static data (templates, service types, etc.)
   */
  setStaticData(key: string, data: any): void {
    this.set(key, data, this.CACHE_TIMES.STATIC_DATA, true);
  }

  /**
   * Cache images with long-term storage
   */
  setImage(key: string, data: any): void {
    this.set(key, data, this.CACHE_TIMES.IMAGES, true);
  }

  /**
   * Cache project list data
   */
  setProjectList(key: string, data: any): void {
    this.set(key, data, this.CACHE_TIMES.PROJECT_LIST, true);
  }

  /**
   * Cache user data
   */
  setUserData(key: string, data: any): void {
    this.set(key, data, this.CACHE_TIMES.USER_DATA, true);
  }

  /**
   * Preload critical data for offline mode
   */
  preloadCriticalData(): void {
    // This can be called during app initialization to preload important data
    console.log('CacheService: Preloading critical data for offline mode');
  }

  /**
   * Clear cache by pattern
   */
  clearByPattern(pattern: string): void {
    const keys = Array.from(this.cache.keys());
    keys.forEach(key => {
      if (key.includes(pattern)) {
        this.clear(key);
      }
    });

    // Also clear from localStorage
    Object.keys(this.localStorage).forEach(key => {
      if (key.startsWith('cache_') && key.includes(pattern)) {
        this.localStorage.removeItem(key);
      }
    });
  }

  /**
   * Clear cache for a specific table
   * @param tableName - Name of the table to clear cache for
   */
  clearTableCache(tableName: string): void {
    console.log(`[CacheService] Clearing cache for table: ${tableName}`);
    // Clear all cache entries that contain this table name
    this.clearByPattern(`/tables/${tableName}/records`);
  }

  /**
   * Clear all caches related to a project
   * @param projectId - The project ID to clear caches for
   */
  clearProjectRelatedCaches(projectId: string): void {
    console.log(`[CacheService] Clearing all project-related caches for projectId: ${projectId}`);
    
    // Clear project-specific caches
    this.clearByPattern(`ProjectID=${projectId}`);
    
    // Clear related tables
    this.clearTableCache('Projects');
    this.clearTableCache('Services');
    this.clearTableCache('Attach');
    this.clearTableCache('Services_Visuals');
    this.clearTableCache('Services_Visuals_Attach');
    this.clearTableCache('Services_EFE');
    this.clearTableCache('Services_EFE_Points');
    this.clearTableCache('Services_EFE_Points_Attach');
  }

  /**
   * Clear all caches related to a service
   * @param serviceId - The service ID to clear caches for
   */
  clearServiceRelatedCaches(serviceId: string): void {
    console.log(`[CacheService] Clearing all service-related caches for serviceId: ${serviceId}`);

    // Clear service-specific caches
    this.clearByPattern(`ServiceID=${serviceId}`);

    // Clear related tables
    this.clearTableCache('Services');
    this.clearTableCache('Services_Visuals');
    this.clearTableCache('Services_Visuals_Attach');
    this.clearTableCache('Services_EFE');
    this.clearTableCache('Services_EFE_Points');
    this.clearTableCache('Services_EFE_Points_Attach');
    this.clearTableCache('Service_EFE');
  }

  /**
   * OPTIMIZATION: Entity version tracking
   * Tracks version numbers for entities to automatically invalidate stale cache
   */
  private entityVersions = new Map<string, number>();

  /**
   * Get version for an entity
   */
  getEntityVersion(entityType: string, entityId: string): number {
    const key = `${entityType}::${entityId}`;
    return this.entityVersions.get(key) || 0;
  }

  /**
   * Increment version for an entity (call after mutations)
   */
  incrementEntityVersion(entityType: string, entityId: string): number {
    const key = `${entityType}::${entityId}`;
    const newVersion = (this.entityVersions.get(key) || 0) + 1;
    this.entityVersions.set(key, newVersion);
    console.log(`[CacheService] 📈 Version incremented: ${key} → ${newVersion}`);
    return newVersion;
  }

  /**
   * Get cache key with version for automatic invalidation
   */
  getVersionedCacheKey(endpoint: string, params: any, entityType?: string, entityId?: string): string {
    const baseKey = this.getApiCacheKey(endpoint, params);

    if (entityType && entityId) {
      const version = this.getEntityVersion(entityType, entityId);
      return `${baseKey}::v${version}`;
    }

    return baseKey;
  }

  /**
   * Set data with entity version tracking
   */
  setVersioned(
    endpoint: string,
    params: any,
    data: any,
    entityType: string,
    entityId: string,
    expiresIn: number = this.CACHE_TIMES.MEDIUM,
    persist: boolean = false
  ): void {
    const key = this.getVersionedCacheKey(endpoint, params, entityType, entityId);
    this.set(key, data, expiresIn, persist);
  }

  /**
   * Get data with entity version check
   */
  getVersioned(endpoint: string, params: any, entityType: string, entityId: string): any | null {
    const key = this.getVersionedCacheKey(endpoint, params, entityType, entityId);
    return this.get(key);
  }

  /**
   * Clear old versions of cached data for an entity
   */
  clearEntityVersions(entityType: string, entityId: string): void {
    const pattern = `${entityType}::${entityId}::v`;
    this.clearByPattern(pattern);
  }
}