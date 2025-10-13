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
    SHORT: 60000,        // 1 minute - for frequently changing data
    MEDIUM: 300000,      // 5 minutes - for semi-static data
    LONG: 900000,        // 15 minutes - for mostly static data
    VERY_LONG: 3600000,  // 1 hour - for static data like templates
    OFFLINE: 86400000,   // 24 hours - for offline mode
    
    // Performance optimization cache times
    STATIC_DATA: 86400000,      // 24 hours - for static data like templates, service types
    PROJECT_LIST: 900000,       // 15 minutes - for project lists
    IMAGES: 604800000,          // 7 days - for images
    API_RESPONSES: 300000,      // 5 minutes - for API responses
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
}