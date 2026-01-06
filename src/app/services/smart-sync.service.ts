import { Injectable, OnDestroy, NgZone } from '@angular/core';
import { Subject, Subscription, interval } from 'rxjs';
import { IndexedDbService } from './indexed-db.service';
import { OfflineService } from './offline.service';
import { OfflineTemplateService } from './offline-template.service';
import { BackgroundSyncService } from './background-sync.service';
import { CaspioService } from './caspio.service';
import { firstValueFrom } from 'rxjs';

/**
 * Smart Sync Service
 * 
 * Provides intelligent synchronization with:
 * 1. Immediate sync for dirty/changed items when online
 * 2. Hourly full cache refresh when online
 * 3. Prevention of overlapping sync operations
 * 4. Events for UI sync status updates
 * 
 * This follows the Spectora-style approach where:
 * - Data shows immediately in UI
 * - Background sync happens periodically
 * - Transition from offline to synced is seamless
 */

export interface SyncStatus {
  isFullRefreshInProgress: boolean;
  isDirtySyncInProgress: boolean;
  lastFullRefresh: number | null;
  lastDirtySync: number | null;
  pendingItemCount: number;
  errors: string[];
}

export interface SyncEvent {
  type: 'dirty_sync_start' | 'dirty_sync_complete' | 'full_refresh_start' | 'full_refresh_complete' | 'sync_error';
  message: string;
  timestamp: number;
  itemCount?: number;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class SmartSyncService implements OnDestroy {
  // Event emitters for UI updates
  public syncEvent$ = new Subject<SyncEvent>();
  public syncStatus$ = new Subject<SyncStatus>();
  
  // Sync state
  private status: SyncStatus = {
    isFullRefreshInProgress: false,
    isDirtySyncInProgress: false,
    lastFullRefresh: null,
    lastDirtySync: null,
    pendingItemCount: 0,
    errors: []
  };
  
  // Hourly refresh timer (1 hour = 3600000ms)
  private readonly FULL_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  private readonly DIRTY_CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds
  
  private fullRefreshSubscription: Subscription | null = null;
  private dirtyCheckSubscription: Subscription | null = null;
  private onlineSubscription: Subscription | null = null;
  
  // Track dirty items per service
  private dirtyItems = new Map<string, Set<string>>(); // serviceId -> Set of item identifiers
  
  // Track active services (currently open in UI)
  private activeServices = new Set<string>();
  
  constructor(
    private indexedDb: IndexedDbService,
    private offlineService: OfflineService,
    private offlineTemplate: OfflineTemplateService,
    private backgroundSync: BackgroundSyncService,
    private caspioService: CaspioService,
    private ngZone: NgZone
  ) {
    this.startSmartSync();
    console.log('[SmartSync] Service initialized');
  }
  
  ngOnDestroy(): void {
    this.stopSmartSync();
  }
  
  /**
   * Start the smart sync timers
   */
  private startSmartSync(): void {
    // Start hourly full refresh timer
    this.ngZone.runOutsideAngular(() => {
      // Check for full refresh every minute, but only do it hourly
      this.fullRefreshSubscription = interval(60 * 1000).subscribe(() => {
        this.checkAndDoFullRefresh();
      });
      
      // Check for dirty items every 30 seconds
      this.dirtyCheckSubscription = interval(this.DIRTY_CHECK_INTERVAL_MS).subscribe(() => {
        this.processDirtyItems();
      });
    });
    
    // Listen to online status changes
    this.onlineSubscription = this.offlineService.onlineStatus$.subscribe(isOnline => {
      if (isOnline) {
        console.log('[SmartSync] Came online - triggering dirty sync');
        this.processDirtyItems();
      }
    });
    
    // Initial pending count update
    this.updatePendingCount();
  }
  
  /**
   * Stop all sync timers
   */
  private stopSmartSync(): void {
    if (this.fullRefreshSubscription) {
      this.fullRefreshSubscription.unsubscribe();
      this.fullRefreshSubscription = null;
    }
    if (this.dirtyCheckSubscription) {
      this.dirtyCheckSubscription.unsubscribe();
      this.dirtyCheckSubscription = null;
    }
    if (this.onlineSubscription) {
      this.onlineSubscription.unsubscribe();
      this.onlineSubscription = null;
    }
  }
  
  /**
   * Register a service as actively being viewed
   * Used to prioritize sync for active services
   */
  registerActiveService(serviceId: string): void {
    this.activeServices.add(serviceId);
    console.log(`[SmartSync] Registered active service: ${serviceId}`);
  }
  
  /**
   * Unregister a service when no longer being viewed
   */
  unregisterActiveService(serviceId: string): void {
    this.activeServices.delete(serviceId);
    console.log(`[SmartSync] Unregistered active service: ${serviceId}`);
  }
  
  /**
   * Get list of active services
   */
  getActiveServices(): string[] {
    return Array.from(this.activeServices);
  }
  
  /**
   * Mark an item as dirty (needs sync)
   */
  markDirty(serviceId: string, itemType: string, itemId: string): void {
    const key = `${itemType}:${itemId}`;
    if (!this.dirtyItems.has(serviceId)) {
      this.dirtyItems.set(serviceId, new Set());
    }
    this.dirtyItems.get(serviceId)!.add(key);
    console.log(`[SmartSync] Marked dirty: ${serviceId} -> ${key}`);
    
    // Update pending count
    this.updatePendingCount();
  }
  
  /**
   * Clear dirty flag for an item (after successful sync)
   */
  clearDirty(serviceId: string, itemType: string, itemId: string): void {
    const key = `${itemType}:${itemId}`;
    const serviceItems = this.dirtyItems.get(serviceId);
    if (serviceItems) {
      serviceItems.delete(key);
      if (serviceItems.size === 0) {
        this.dirtyItems.delete(serviceId);
      }
    }
    this.updatePendingCount();
  }
  
  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    return { ...this.status };
  }
  
  /**
   * Force a full refresh (manual trigger)
   */
  async forceFullRefresh(serviceId?: string): Promise<void> {
    await this.doFullRefresh(serviceId);
  }
  
  /**
   * Check if it's time for a full refresh
   */
  private checkAndDoFullRefresh(): void {
    if (!this.offlineService.isOnline()) {
      return;
    }
    
    if (this.status.isFullRefreshInProgress) {
      return;
    }
    
    const now = Date.now();
    const timeSinceLastRefresh = this.status.lastFullRefresh 
      ? now - this.status.lastFullRefresh 
      : Infinity;
    
    if (timeSinceLastRefresh >= this.FULL_REFRESH_INTERVAL_MS) {
      console.log('[SmartSync] Hourly refresh triggered');
      this.doFullRefresh();
    }
  }
  
  /**
   * Process dirty items (sync changed items)
   */
  private async processDirtyItems(): Promise<void> {
    if (!this.offlineService.isOnline()) {
      return;
    }
    
    if (this.status.isDirtySyncInProgress) {
      return;
    }
    
    // Get pending request count from IndexedDB
    try {
      const pendingRequests = await this.indexedDb.getPendingRequests();
      const pendingCount = pendingRequests.length;
      
      if (pendingCount > 0) {
        this.status.isDirtySyncInProgress = true;
        this.emitEvent('dirty_sync_start', `Syncing ${pendingCount} pending items...`, pendingCount);
        
        // The BackgroundSyncService handles the actual sync
        // We just monitor and report status
        console.log(`[SmartSync] ${pendingCount} pending items to sync`);
        
        // Wait a bit for background sync to process
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check remaining count
        const remainingRequests = await this.indexedDb.getPendingRequests();
        const synced = pendingCount - remainingRequests.length;
        
        this.status.isDirtySyncInProgress = false;
        this.status.lastDirtySync = Date.now();
        this.emitEvent('dirty_sync_complete', `Synced ${synced} items`, synced);
      }
      
      this.updatePendingCount();
    } catch (error) {
      console.error('[SmartSync] Error processing dirty items:', error);
      this.status.isDirtySyncInProgress = false;
      this.emitEvent('sync_error', 'Failed to sync dirty items', 0, String(error));
    }
  }
  
  /**
   * Perform a full cache refresh
   */
  private async doFullRefresh(serviceId?: string): Promise<void> {
    if (!this.offlineService.isOnline()) {
      console.log('[SmartSync] Cannot do full refresh - offline');
      return;
    }
    
    if (this.status.isFullRefreshInProgress) {
      console.log('[SmartSync] Full refresh already in progress');
      return;
    }
    
    this.status.isFullRefreshInProgress = true;
    this.emitEvent('full_refresh_start', 'Starting full cache refresh...');
    
    try {
      console.log('[SmartSync] Starting full cache refresh...');
      
      // Refresh templates (global)
      await this.refreshTemplates();
      
      // If a specific service is provided, refresh just that service
      // Otherwise, refresh all cached services
      if (serviceId) {
        await this.refreshServiceData(serviceId);
      } else {
        await this.refreshAllCachedServices();
      }
      
      this.status.lastFullRefresh = Date.now();
      this.emitEvent('full_refresh_complete', 'Cache refresh complete');
      console.log('[SmartSync] Full cache refresh complete');
      
    } catch (error) {
      console.error('[SmartSync] Full refresh failed:', error);
      this.status.errors.push(`Full refresh failed: ${error}`);
      this.emitEvent('sync_error', 'Full refresh failed', 0, String(error));
    } finally {
      this.status.isFullRefreshInProgress = false;
      this.emitStatus();
    }
  }
  
  /**
   * Refresh global templates
   */
  private async refreshTemplates(): Promise<void> {
    try {
      // Refresh visual templates
      const visualTemplates = await firstValueFrom(this.caspioService.getServicesVisualsTemplates());
      if (visualTemplates && visualTemplates.length > 0) {
        await this.indexedDb.cacheTemplates('visual', visualTemplates);
        console.log(`[SmartSync] Refreshed ${visualTemplates.length} visual templates`);
      }
      
      // Refresh EFE templates
      const efeTemplates = await firstValueFrom(this.caspioService.getServicesEFETemplates());
      if (efeTemplates && efeTemplates.length > 0) {
        await this.indexedDb.cacheTemplates('efe', efeTemplates);
        console.log(`[SmartSync] Refreshed ${efeTemplates.length} EFE templates`);
      }
    } catch (error) {
      console.warn('[SmartSync] Failed to refresh templates:', error);
      // Don't throw - templates are less critical than service data
    }
  }
  
  /**
   * Refresh data for a specific service
   */
  private async refreshServiceData(serviceId: string): Promise<void> {
    try {
      // Refresh visuals
      const visuals = await firstValueFrom(this.caspioService.getServicesVisualsByServiceId(serviceId));
      if (visuals && visuals.length > 0) {
        // Use safe merge (preserve local updates)
        const existingVisuals = await this.indexedDb.getCachedServiceData(serviceId, 'visuals') || [];
        const mergedVisuals = this.safeMerge(existingVisuals, visuals, 'PK_ID');
        await this.indexedDb.cacheServiceData(serviceId, 'visuals', mergedVisuals);
        console.log(`[SmartSync] Refreshed ${visuals.length} visuals for service ${serviceId}`);
      }
      
      // Refresh EFE rooms
      const rooms = await firstValueFrom(this.caspioService.getServicesEFE(serviceId));
      if (rooms && rooms.length > 0) {
        // Use safe merge (preserve local updates)
        const existingRooms = await this.indexedDb.getCachedServiceData(serviceId, 'efe_rooms') || [];
        const mergedRooms = this.safeMerge(existingRooms, rooms, 'EFEID');
        await this.indexedDb.cacheServiceData(serviceId, 'efe_rooms', mergedRooms);
        console.log(`[SmartSync] Refreshed ${rooms.length} EFE rooms for service ${serviceId}`);
      }
      
      // Notify that refresh is complete
      this.offlineTemplate.backgroundRefreshComplete$.next({ serviceId, dataType: 'visuals' });
      this.offlineTemplate.backgroundRefreshComplete$.next({ serviceId, dataType: 'efe_rooms' });
      
    } catch (error) {
      console.warn(`[SmartSync] Failed to refresh service ${serviceId}:`, error);
    }
  }
  
  /**
   * Refresh all cached services (for hourly full refresh)
   */
  private async refreshAllCachedServices(): Promise<void> {
    try {
      // Get all cached service IDs
      const allVisualCaches = await this.indexedDb.getAllCachedServiceData('visuals');
      const allEfeCaches = await this.indexedDb.getAllCachedServiceData('efe_rooms');
      
      // Combine unique service IDs
      const serviceIds = new Set<string>();
      allVisualCaches.forEach(cache => serviceIds.add(cache.serviceId));
      allEfeCaches.forEach(cache => serviceIds.add(cache.serviceId));
      
      console.log(`[SmartSync] Refreshing ${serviceIds.size} cached services`);
      
      // Refresh each service (with concurrency limit)
      const serviceArray = Array.from(serviceIds);
      const batchSize = 3;
      
      for (let i = 0; i < serviceArray.length; i += batchSize) {
        const batch = serviceArray.slice(i, i + batchSize);
        await Promise.all(batch.map(serviceId => this.refreshServiceData(serviceId)));
      }
      
    } catch (error) {
      console.warn('[SmartSync] Failed to refresh all services:', error);
    }
  }
  
  /**
   * Safe merge: Combine server data with local updates
   * Preserves _localUpdate flagged items and temp items
   */
  private safeMerge(existing: any[], fresh: any[], idField: string): any[] {
    // Build map of local updates and temp items
    const localUpdates = new Map<string, any>();
    const tempItems: any[] = [];
    
    for (const item of existing) {
      if (item._localUpdate) {
        const id = String(item[idField] || item.PK_ID);
        localUpdates.set(id, item);
      }
      if (item._tempId && String(item._tempId).startsWith('temp_')) {
        tempItems.push(item);
      }
    }
    
    // Merge: use local version where applicable
    const merged = fresh.map(serverItem => {
      const id = String(serverItem[idField] || serverItem.PK_ID);
      const localItem = localUpdates.get(id);
      if (localItem) {
        return localItem; // Keep local version
      }
      return serverItem;
    });
    
    // Add temp items not in server response
    return [...merged, ...tempItems];
  }
  
  /**
   * Update pending item count
   */
  private async updatePendingCount(): Promise<void> {
    try {
      const pending = await this.indexedDb.getPendingRequests();
      this.status.pendingItemCount = pending.length;
      this.emitStatus();
    } catch (error) {
      console.warn('[SmartSync] Failed to update pending count:', error);
    }
  }
  
  /**
   * Emit a sync event
   */
  private emitEvent(
    type: SyncEvent['type'], 
    message: string, 
    itemCount?: number, 
    error?: string
  ): void {
    this.ngZone.run(() => {
      this.syncEvent$.next({
        type,
        message,
        timestamp: Date.now(),
        itemCount,
        error
      });
    });
    this.emitStatus();
  }
  
  /**
   * Emit current status
   */
  private emitStatus(): void {
    this.ngZone.run(() => {
      this.syncStatus$.next({ ...this.status });
    });
  }
}
