import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject, Subscription } from 'rxjs';
import { filter, debounceTime } from 'rxjs/operators';
import { IndexedDbService } from './indexed-db.service';
import { OfflineService } from './offline.service';
import { ScreenReaderAnnouncementService } from './screen-reader-announcement.service';
import { environment } from '../../environments/environment';

/**
 * Represents the state of data loading with cache-first pattern
 */
export interface DataLoadState<T> {
  data: T | null;
  source: 'cache' | 'api' | 'pending' | 'none';
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
  isStale: boolean;
  isEmpty: boolean;
}

/**
 * Options for loading data with cache-first pattern
 */
export interface CacheFirstOptions {
  /** Force fetch from API even if cache exists */
  forceRefresh?: boolean;
  /** Maximum age of cache before considered stale (ms) */
  staleAfterMs?: number;
  /** Whether to block on first load if cache is empty */
  blockOnEmpty?: boolean;
  /** Service ID for filtering events */
  serviceId?: string;
}

/**
 * Unified Data Loading Service
 * 
 * Enforces a standardized cache-first pattern across all pages:
 * 1. Read from cache IMMEDIATELY (instant UI)
 * 2. If cache empty + online: fetch synchronously (blocking)
 * 3. If cache exists + online: refresh in background (non-blocking)
 * 4. If offline: use cache only, show offline indicator
 * 5. Emit events when data refreshes so pages can update
 * 
 * This ensures consistent behavior across all sections of the template.
 */
@Injectable({
  providedIn: 'root'
})
export class DataLoadingService {
  // Default stale time: 5 minutes
  private readonly DEFAULT_STALE_MS = 5 * 60 * 1000;

  // Event emitted when any data type refreshes
  public dataRefreshed$ = new Subject<{ dataType: string; serviceId?: string }>();

  constructor(
    private indexedDb: IndexedDbService,
    private offlineService: OfflineService,
    private screenReaderAnnouncement: ScreenReaderAnnouncementService
  ) {}

  /**
   * Load data with cache-first pattern
   * 
   * @param cacheKey - Unique key for this data in cache
   * @param dataType - Type of data (visuals, efe_rooms, etc.)
   * @param fetcher - Function to fetch fresh data from API
   * @param options - Loading options
   * @returns Observable that emits data state changes
   */
  async loadWithCacheFirst<T>(
    serviceId: string,
    dataType: 'visuals' | 'efe_rooms' | 'efe_points' | 'visual_attachments' | 'efe_point_attachments',
    fetcher: () => Promise<T[]>,
    options: CacheFirstOptions = {}
  ): Promise<DataLoadState<T[]>> {
    const {
      forceRefresh = false,
      staleAfterMs = this.DEFAULT_STALE_MS,
      blockOnEmpty = true
    } = options;

    // Step 1: Read from cache immediately
    const cached = await this.indexedDb.getCachedServiceData(serviceId, dataType);
    const cacheExists = cached && cached.length > 0;
    const isOnline = this.offlineService.isOnline();

    // Initial state from cache
    let state: DataLoadState<T[]> = {
      data: cached || [],
      source: cacheExists ? 'cache' : 'none',
      loading: false,
      error: null,
      lastUpdated: cacheExists ? Date.now() : null,
      isStale: false,
      isEmpty: !cacheExists || cached.length === 0
    };

    // Step 2: If cache empty and online, fetch synchronously (blocking)
    if (state.isEmpty && isOnline && blockOnEmpty) {
      state.loading = true;

      // G2-A11Y-003: Announce loading state (web only)
      if (environment.isWeb) {
        this.screenReaderAnnouncement.announceLoading(true, dataType.replace(/_/g, ' '));
      }

      try {
        const freshData = await fetcher();
        await this.indexedDb.cacheServiceData(serviceId, dataType, freshData || []);

        state = {
          data: freshData || [],
          source: 'api',
          loading: false,
          error: null,
          lastUpdated: Date.now(),
          isStale: false,
          isEmpty: !freshData || freshData.length === 0
        };


        // G2-A11Y-003: Announce loading complete (web only)
        if (environment.isWeb) {
          this.screenReaderAnnouncement.announceLoading(false, dataType.replace(/_/g, ' '));
        }
      } catch (error: any) {
        console.error(`[DataLoading] Error fetching ${dataType}:`, error);
        state = {
          ...state,
          loading: false,
          error: error.message || 'Failed to load data',
          source: 'none'
        };

        // G2-A11Y-003: Announce error (web only)
        if (environment.isWeb) {
          this.screenReaderAnnouncement.announceError(error.message || 'Failed to load data');
        }
      }
    }

    // Step 3: If cache exists and online, schedule background refresh
    if (cacheExists && isOnline && !forceRefresh) {
      // Non-blocking background refresh
      this.refreshInBackground(serviceId, dataType, fetcher);
    }

    // Step 4: If force refresh requested and online
    if (forceRefresh && isOnline) {
      state.loading = true;

      // G2-A11Y-003: Announce loading state (web only)
      if (environment.isWeb) {
        this.screenReaderAnnouncement.announceLoading(true, dataType.replace(/_/g, ' '));
      }

      try {
        const freshData = await fetcher();
        await this.indexedDb.cacheServiceData(serviceId, dataType, freshData || []);

        state = {
          data: freshData || [],
          source: 'api',
          loading: false,
          error: null,
          lastUpdated: Date.now(),
          isStale: false,
          isEmpty: !freshData || freshData.length === 0
        };

        this.dataRefreshed$.next({ dataType, serviceId });

        // G2-A11Y-003: Announce loading complete (web only)
        if (environment.isWeb) {
          this.screenReaderAnnouncement.announceLoading(false, dataType.replace(/_/g, ' '));
        }
      } catch (error: any) {
        state.error = error.message;
        state.loading = false;

        // G2-A11Y-003: Announce error (web only)
        if (environment.isWeb) {
          this.screenReaderAnnouncement.announceError(error.message || 'Failed to load data');
        }
      }
    }

    return state;
  }

  /**
   * Refresh data in background (non-blocking)
   * Emits dataRefreshed$ event when complete
   */
  private refreshInBackground<T>(
    serviceId: string,
    dataType: string,
    fetcher: () => Promise<T[]>
  ): void {
    setTimeout(async () => {
      try {
        const freshData = await fetcher();
        await this.indexedDb.cacheServiceData(serviceId, dataType as any, freshData || []);
        
        this.dataRefreshed$.next({ dataType, serviceId });
      } catch (error) {
        console.debug(`[DataLoading] Background refresh failed for ${dataType} (using cache)`);
      }
    }, 100);
  }

  /**
   * Ensure cache is populated for a given data type
   * Returns true if cache has data, false otherwise
   * If online and cache empty, will attempt to fetch
   */
  async ensureCachePopulated(
    serviceId: string,
    dataType: 'visuals' | 'efe_rooms' | 'efe_points' | 'visual_attachments' | 'efe_point_attachments',
    fetcher: () => Promise<any[]>
  ): Promise<boolean> {
    const cached = await this.indexedDb.getCachedServiceData(serviceId, dataType);
    
    if (cached && cached.length > 0) {
      return true;
    }

    // Cache empty - try to fetch if online
    if (this.offlineService.isOnline()) {
      try {
        const freshData = await fetcher();
        await this.indexedDb.cacheServiceData(serviceId, dataType, freshData || []);
        return (freshData && freshData.length > 0);
      } catch (error) {
        console.error(`[DataLoading] Failed to populate cache for ${dataType}:`, error);
        return false;
      }
    }

    return false;
  }

  /**
   * Ensure templates are cached
   * Templates are global (not per-service)
   */
  async ensureTemplatesCached(
    templateType: 'visual' | 'efe',
    fetcher: () => Promise<any[]>
  ): Promise<boolean> {
    const cached = await this.indexedDb.getCachedTemplates(templateType);
    
    if (cached && cached.length > 0) {
      return true;
    }

    // Cache empty - try to fetch if online
    if (this.offlineService.isOnline()) {
      try {
        const freshData = await fetcher();
        await this.indexedDb.cacheTemplates(templateType, freshData || []);
        return (freshData && freshData.length > 0);
      } catch (error) {
        console.error(`[DataLoading] Failed to populate templates for ${templateType}:`, error);
        return false;
      }
    }

    return false;
  }

  /**
   * Create a standardized subscription to refresh events
   * Returns a Subscription that should be cleaned up in ngOnDestroy
   * 
   * @param serviceId - Service ID to filter events for
   * @param invalidationSource - Observable that emits cache invalidation events
   * @param refreshSource - Observable that emits background refresh events  
   * @param callback - Function to call when refresh is needed
   * @param debounceMs - Debounce time in ms (default 500)
   */
  subscribeToRefreshEvents(
    serviceId: string,
    invalidationSource: Observable<{ serviceId?: string; reason: string }>,
    refreshSource: Observable<{ serviceId: string; dataType: string }>,
    callback: () => void,
    debounceMs: number = 500
  ): Subscription[] {
    const subscriptions: Subscription[] = [];

    // Subscribe to cache invalidation with debounce
    const invalidationSub = invalidationSource
      .pipe(
        filter(e => !e.serviceId || e.serviceId === serviceId),
        debounceTime(debounceMs)
      )
      .subscribe(() => {
        callback();
      });
    subscriptions.push(invalidationSub);

    // Subscribe to background refresh completion
    const refreshSub = refreshSource
      .pipe(filter(e => e.serviceId === serviceId))
      .subscribe(() => {
        callback();
      });
    subscriptions.push(refreshSub);

    // Subscribe to this service's refresh events
    const dataSub = this.dataRefreshed$
      .pipe(filter(e => e.serviceId === serviceId))
      .subscribe(() => {
        callback();
      });
    subscriptions.push(dataSub);

    return subscriptions;
  }

  /**
   * Get current online status
   */
  isOnline(): boolean {
    return this.offlineService.isOnline();
  }

  /**
   * Check if data exists in cache (without fetching)
   */
  async hasCachedData(
    serviceId: string,
    dataType: 'visuals' | 'efe_rooms' | 'efe_points' | 'visual_attachments' | 'efe_point_attachments'
  ): Promise<boolean> {
    const cached = await this.indexedDb.getCachedServiceData(serviceId, dataType);
    return cached && cached.length > 0;
  }

  /**
   * Check if templates exist in cache (without fetching)
   */
  async hasCachedTemplates(templateType: 'visual' | 'efe'): Promise<boolean> {
    const cached = await this.indexedDb.getCachedTemplates(templateType);
    return cached && cached.length > 0;
  }
}

