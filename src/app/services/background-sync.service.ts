import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Subject, interval, Subscription, firstValueFrom } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { IndexedDbService, PendingRequest, LocalImage, UploadOutboxItem } from './indexed-db.service';
import { ApiGatewayService } from './api-gateway.service';
import { ConnectionMonitorService } from './connection-monitor.service';
import { CaspioService } from './caspio.service';
import { LocalImageService } from './local-image.service';
import { OperationsQueueService } from './operations-queue.service';
import { environment } from '../../environments/environment';

export interface PhotoUploadComplete {
  tempFileId: string;
  tempVisualId?: string;
  realVisualId: number;
  result: any; // Contains AttachID, S3 URL, etc.
}

export interface EFERoomSyncComplete {
  tempId: string;
  realId: number;
  result: any;
}

export interface EFEPointSyncComplete {
  tempId: string;
  realId: number;
  result: any;
}

export interface EFEPhotoUploadComplete {
  tempFileId: string;
  tempPointId?: string;
  realPointId: number;
  result: any;
}

export interface ServiceDataSyncComplete {
  serviceId?: string;
  projectId?: string;
}

export interface SyncStatus {
  isSyncing: boolean;
  pendingCount: number;
  syncedCount: number;
  failedCount: number;
  lastSyncTime?: number;
  currentlySyncing?: string;  // Description of what's being synced
}

/**
 * Background sync service with rolling retry
 * Keeps trying to sync pending requests until they succeed
 */
@Injectable({
  providedIn: 'root'
})
export class BackgroundSyncService {
  private syncInterval: Subscription | null = null;
  private connectionSubscription: Subscription | null = null;
  private isSyncing = false;
  private syncIntervalMs = 60000; // Check every 60 seconds (batched sync - was 30s)

  // ==========================================================================
  // ROLLING SYNC WINDOW
  // Changes are batched and synced after 60 seconds of no new changes
  // Timer resets each time a new change is queued (rolling window)
  // ==========================================================================
  private rollingSyncTimer: any = null;
  private rollingWindowMs = 60000; // 60-second rolling window
  private pendingChangesCount = 0;
  private syncQueueSubscription: Subscription | null = null;

  // Subject to notify when pending count changes (for UI)
  public pendingChanges$ = new BehaviorSubject<number>(0);

  // Observable sync status for UI
  public syncStatus$ = new BehaviorSubject<SyncStatus>({
    isSyncing: false,
    pendingCount: 0,
    syncedCount: 0,
    failedCount: 0,
  });

  // Emits when a photo upload completes - pages can subscribe to update local state
  public photoUploadComplete$ = new Subject<PhotoUploadComplete>();

  // EFE sync events - pages can subscribe to update UI when EFE data syncs
  public efeRoomSyncComplete$ = new Subject<EFERoomSyncComplete>();
  public efePointSyncComplete$ = new Subject<EFEPointSyncComplete>();
  public efePhotoUploadComplete$ = new Subject<EFEPhotoUploadComplete>();

  // Service/Project data sync events - pages can subscribe to reload data after sync
  public serviceDataSyncComplete$ = new Subject<ServiceDataSyncComplete>();

  // Visual sync events - emits when visuals are synced so pages can refresh
  public visualSyncComplete$ = new Subject<{ serviceId: string; visualId: string; tempId?: string }>();

  // Caption sync events - emits when caption/annotation updates complete
  public captionSyncComplete$ = new Subject<{ attachId: string; attachType: string; captionId: string }>();

  // ==========================================================================
  // SECTION DIRTY FLAG TRACKING
  // Tracks which sections need to reload data on next visit
  // This enables smart skip-reload for faster navigation while ensuring
  // new data always appears when it should
  // ==========================================================================
  private sectionDirtyFlags = new Map<string, boolean>();

  /**
   * Mark a section as dirty (needs reload on next visit)
   * Called after any data change: photo upload, sync, annotation, delete, etc.
   * @param sectionKey - Format: "serviceId_category" or "serviceId_roomName" or "serviceId_elevation"
   */
  markSectionDirty(sectionKey: string): void {
    this.sectionDirtyFlags.set(sectionKey, true);
    console.log(`[BackgroundSync] Section marked dirty: ${sectionKey}`);
  }

  /**
   * Mark all sections for a service as dirty
   * Used when a broad sync completes that might affect multiple sections
   */
  markAllSectionsDirty(serviceId: string): void {
    // Mark all existing sections with this serviceId as dirty
    for (const key of this.sectionDirtyFlags.keys()) {
      if (key.startsWith(serviceId)) {
        this.sectionDirtyFlags.set(key, true);
      }
    }
    // Also set a general service-level dirty flag
    this.sectionDirtyFlags.set(serviceId, true);
    console.log(`[BackgroundSync] All sections marked dirty for service: ${serviceId}`);
  }

  /**
   * Check if a section is dirty (needs reload)
   * @returns true if section needs reload, false if can skip
   */
  isSectionDirty(sectionKey: string): boolean {
    // Default to true (dirty) if not tracked yet - ensures first load always happens
    return this.sectionDirtyFlags.get(sectionKey) ?? true;
  }

  /**
   * Clear dirty flag after successful reload
   * Called by pages after they finish loading data
   */
  clearSectionDirty(sectionKey: string): void {
    this.sectionDirtyFlags.set(sectionKey, false);
    console.log(`[BackgroundSync] Section cleared: ${sectionKey}`);
  }

  // ==========================================================================
  // ROLLING SYNC WINDOW METHODS
  // ==========================================================================

  /**
   * Queue a change and reset the rolling sync window
   * Called whenever a new change is made (photo added, annotation updated, etc.)
   * This batches changes and syncs after 60 seconds of no new changes
   */
  queueChange(reason: string = 'change'): void {
    this.pendingChangesCount++;
    this.pendingChanges$.next(this.pendingChangesCount);
    console.log(`[BackgroundSync] Change queued (${reason}), pending: ${this.pendingChangesCount}, resetting 60s timer`);
    this.resetRollingSyncWindow();
  }

  /**
   * Reset the rolling sync window timer
   * Called whenever a new change is queued - creates a 60-second debounce effect
   */
  private resetRollingSyncWindow(): void {
    // Clear existing timer
    if (this.rollingSyncTimer) {
      clearTimeout(this.rollingSyncTimer);
      this.rollingSyncTimer = null;
    }

    // Don't set timer if offline
    if (!navigator.onLine) {
      console.log('[BackgroundSync] Offline - rolling sync timer not started');
      return;
    }

    // Set new timer - sync after 60 seconds of no new changes
    this.rollingSyncTimer = setTimeout(() => {
      console.log(`[BackgroundSync] Rolling window expired - syncing ${this.pendingChangesCount} pending changes`);
      this.rollingSyncTimer = null;
      this.triggerSync();
    }, this.rollingWindowMs);

    console.log(`[BackgroundSync] Rolling sync timer reset - will sync in ${this.rollingWindowMs / 1000}s if no new changes`);
  }

  /**
   * Get current pending changes count
   */
  getPendingChangesCount(): number {
    return this.pendingChangesCount;
  }

  /**
   * Clear pending changes count (called after successful sync)
   */
  private clearPendingChangesCount(): void {
    this.pendingChangesCount = 0;
    this.pendingChanges$.next(0);
  }

  constructor(
    private indexedDb: IndexedDbService,
    private apiGateway: ApiGatewayService,
    private connectionMonitor: ConnectionMonitorService,
    private ngZone: NgZone,
    private caspioService: CaspioService,
    private localImageService: LocalImageService,
    private operationsQueue: OperationsQueueService
  ) {
    this.startBackgroundSync();
    this.listenToConnectionChanges();
    this.subscribeToSyncQueueChanges();
    // NOTE: App state listener for native foreground/background removed - @capacitor/app not available in web build
  }

  /**
   * Subscribe to sync queue changes from IndexedDbService
   * When changes are queued (pending requests, captions, uploads), reset the rolling sync window
   */
  private subscribeToSyncQueueChanges(): void {
    this.syncQueueSubscription = this.indexedDb.syncQueueChange$.subscribe(({ reason }) => {
      console.log(`[BackgroundSync] Sync queue change detected: ${reason}`);
      this.queueChange(reason);
    });
  }

  /**
   * Start the background sync loop
   * MODIFIED: Uses rolling window instead of fixed interval for user-initiated changes
   * Fixed interval kept as fallback for any missed changes
   */
  private startBackgroundSync(): void {
    console.log('[BackgroundSync] Starting background sync service with rolling window');

    // TASK 1 FIX: Await reset of stuck items before triggering sync
    // This prevents race conditions where sync starts before stuck items are reset
    this.initializeSync();
  }

  /**
   * Initialize sync by resetting stuck items first, then starting the sync loop
   * TASK 1 FIX: Separated from startBackgroundSync to properly await async operations
   */
  private async initializeSync(): Promise<void> {
    // Reset any stuck 'syncing' requests to 'pending' on startup
    // This handles cases where the app was closed during a sync
    await this.resetStuckSyncingRequests();

    // TASK 1 FIX: Also reset the sync status from DB after cleanup
    // This ensures the UI shows correct state on startup
    await this.updateSyncStatusFromDb();

    // Run outside Angular zone to prevent unnecessary change detection
    this.ngZone.runOutsideAngular(() => {
      // Sync immediately on start to process any pending items from previous session
      this.triggerSync();

      // Keep the fixed interval as a fallback safety net (every 60 seconds)
      // This catches any changes that might not have triggered queueChange()
      // The rolling window handles user-initiated changes with proper debouncing
      this.syncInterval = interval(this.syncIntervalMs).subscribe(() => {
        // Only trigger if we're not already waiting on rolling window
        if (!this.rollingSyncTimer) {
          this.triggerSync();
        } else {
          console.log('[BackgroundSync] Skipping fixed interval - rolling window active');
        }
      });
    });
  }

  /**
   * Reset any stuck 'syncing' requests to 'pending' on startup
   * This handles cases where the app was closed during a sync
   * FIXED: Batch operations using Promise.all for faster startup
   */
  private async resetStuckSyncingRequests(): Promise<void> {
    try {
      const now = Date.now();
      const fiveMinutesAgo = now - (5 * 60 * 1000);  // 5 minutes

      // Fetch all data in parallel
      const [allRequests, allCaptions] = await Promise.all([
        this.indexedDb.getAllRequests(),
        this.indexedDb.getAllPendingCaptions()
      ]);

      // Categorize requests
      const stuckSyncing = allRequests.filter(r => r.status === 'syncing');
      const stuckPending = allRequests.filter(r =>
        r.status === 'pending' &&
        r.createdAt < fiveMinutesAgo &&
        (r.retryCount || 0) >= 3
      );
      const syncedRequests = allRequests.filter(r => r.status === 'synced');

      // Categorize captions
      const stuckCaptions = allCaptions.filter(c => c.status === 'syncing');
      const stuckPendingCaptions = allCaptions.filter(c =>
        c.status === 'pending' &&
        c.createdAt < fiveMinutesAgo &&
        (c.retryCount || 0) >= 3
      );
      const syncedCaptions = allCaptions.filter(c => c.status === 'synced');

      // FIXED: Batch all update operations using Promise.all
      const updatePromises: Promise<void>[] = [];

      // Reset stuck 'syncing' requests
      if (stuckSyncing.length > 0) {
        console.log(`[BackgroundSync] Found ${stuckSyncing.length} stuck 'syncing' requests, resetting to 'pending'`);
        updatePromises.push(...stuckSyncing.map(r =>
          this.indexedDb.updateRequestStatus(r.requestId, 'pending')
        ));
      }

      // Reset stuck 'pending' requests with high retry counts
      if (stuckPending.length > 0) {
        console.log(`[BackgroundSync] Found ${stuckPending.length} stuck 'pending' requests with high retry counts, resetting`);
        updatePromises.push(...stuckPending.map(r =>
          this.indexedDb.updatePendingRequest(r.requestId, {
            retryCount: 0,
            lastAttempt: 0,
            error: undefined
          })
        ));
      }

      // Clean up old 'synced' requests
      if (syncedRequests.length > 0) {
        console.log(`[BackgroundSync] Found ${syncedRequests.length} old 'synced' requests, cleaning up`);
        updatePromises.push(...syncedRequests.map(r =>
          this.indexedDb.removePendingRequest(r.requestId)
        ));
      }

      // Reset stuck 'syncing' captions
      if (stuckCaptions.length > 0) {
        console.log(`[BackgroundSync] Found ${stuckCaptions.length} stuck 'syncing' captions, resetting to 'pending'`);
        updatePromises.push(...stuckCaptions.map(c =>
          this.indexedDb.updateCaptionStatus(c.captionId, 'pending')
        ));
      }

      // Reset stuck 'pending' captions with high retry counts
      if (stuckPendingCaptions.length > 0) {
        console.log(`[BackgroundSync] Found ${stuckPendingCaptions.length} stuck 'pending' captions with high retry counts, resetting`);
        updatePromises.push(...stuckPendingCaptions.map(c =>
          this.indexedDb.updateCaptionStatus(c.captionId, 'pending', {
            retryCount: 0,
            lastAttempt: 0
          })
        ));
      }

      // Clean up old 'synced' captions
      if (syncedCaptions.length > 0) {
        console.log(`[BackgroundSync] Found ${syncedCaptions.length} old 'synced' captions, cleaning up`);
        updatePromises.push(...syncedCaptions.map(c =>
          this.indexedDb.deletePendingCaption(c.captionId)
        ));
      }

      // Execute all updates in parallel
      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
        console.log(`[BackgroundSync] Batch reset complete: ${updatePromises.length} operations`);
      }

      // CRITICAL FIX: Reset stuck upload outbox items
      // Items can get stuck if their nextRetryAt is pushed far into the future
      await this.resetStuckUploadOutboxItems(fiveMinutesAgo);

    } catch (error) {
      console.warn('[BackgroundSync] Error resetting stuck requests:', error);
    }
  }
  
  /**
   * Reset stuck upload outbox items
   * Items can get stuck if they've been retrying for too long
   * FIXED: Batch operations using Promise.all
   */
  private async resetStuckUploadOutboxItems(olderThan: number): Promise<void> {
    try {
      const allOutboxItems = await this.indexedDb.getAllUploadOutboxItems();
      const now = Date.now();

      // Find items that are old and have high attempts or nextRetryAt in the far future
      const stuckItems = allOutboxItems.filter(item =>
        item.createdAt < olderThan &&
        (item.attempts >= 3 || item.nextRetryAt > now + (10 * 60 * 1000)) // nextRetryAt > 10min in future
      );

      if (stuckItems.length > 0) {
        console.log(`[BackgroundSync] Found ${stuckItems.length} stuck upload outbox items, resetting`);
        // FIXED: Batch reset all items in parallel
        await Promise.all(stuckItems.map(item =>
          this.indexedDb.updateOutboxItem(item.opId, {
            attempts: 0,
            nextRetryAt: now,
            lastError: null
          })
        ));
        console.log(`[BackgroundSync] Batch reset ${stuckItems.length} outbox items complete`);
      }
    } catch (error) {
      console.warn('[BackgroundSync] Error resetting stuck outbox items:', error);
    }
  }

  /**
   * Listen for connection changes and trigger sync when back online
   * FIXED: Store subscription to prevent memory leak
   */
  private listenToConnectionChanges(): void {
    // Clean up any existing subscription first
    if (this.connectionSubscription) {
      this.connectionSubscription.unsubscribe();
      this.connectionSubscription = null;
    }

    this.connectionSubscription = this.connectionMonitor.getHealth().subscribe(health => {
      if (health.isHealthy && !this.isSyncing) {
        console.log('[BackgroundSync] Connection restored, triggering sync');
        this.triggerSync();
      }
    });
  }

  /**
   * Trigger an immediate sync attempt
   */
  async triggerSync(): Promise<void> {
    // Don't start new sync if already syncing
    if (this.isSyncing) {
      console.log('[BackgroundSync] Sync already in progress, skipping');
      return;
    }

    // Don't sync if offline
    if (!navigator.onLine) {
      console.log('[BackgroundSync] Offline, skipping sync');
      return;
    }

    this.isSyncing = true;
    this.updateSyncStatus({ isSyncing: true });

    try {
      // Reset any stuck 'syncing' requests before processing
      // This handles cases where sync was interrupted (navigation, network issues, etc.)
      await this.resetStuckSyncingRequests();

      // TASK 2 FIX: Process OperationsQueue FIRST (rooms, points creation)
      // OperationsQueue handles CREATE operations that generate temp IDs
      // These must complete before FDF photos can sync (they reference room temp IDs)
      // Without this, clicking "Sync Now" wouldn't process queued room creations
      console.log('[BackgroundSync] Processing OperationsQueue (room/point creations)...');
      await this.operationsQueue.processQueue();

      // Process pending requests (rooms, points updates)
      // This ensures rooms have real IDs before we try to upload FDF photos
      // FDF photos use room ID as entityId - if room hasn't synced, photo would be deferred
      await this.syncPendingRequests();

      // Process upload outbox (new local-first image system) AFTER rooms/points sync
      await this.processUploadOutbox();

      // CRITICAL: Process pending caption updates independently from photo uploads
      await this.syncPendingCaptions();
      
      // Cleanup: Remove stale pending captions that couldn't sync (temp IDs never resolved, etc.)
      // This prevents the sync queue from showing ghost items
      const staleCleared = await this.indexedDb.clearStalePendingCaptions(60); // 60 min threshold
      if (staleCleared > 0) {
        console.log(`[BackgroundSync] Cleaned up ${staleCleared} stale caption(s)`);
      }
      
      // CRITICAL FIX: Clean up truly stuck upload outbox items (older than 1 hour with many attempts)
      // This prevents the sync queue from showing items that will never succeed
      const stuckOutboxCleared = await this.indexedDb.cleanupStuckUploadOutboxItems(60); // 60 min threshold
      if (stuckOutboxCleared > 0) {
        console.log(`[BackgroundSync] Cleaned up ${stuckOutboxCleared} stuck upload outbox item(s)`);
      }
      
      // Perform storage cleanup after successful sync (runs in background, non-blocking)
      this.performStorageCleanup().catch(err => {
        console.warn('[BackgroundSync] Storage cleanup failed:', err);
      });

      // Clear pending changes count after successful sync
      this.clearPendingChangesCount();
      console.log('[BackgroundSync] Sync completed successfully, pending changes cleared');
    } catch (error) {
      console.error('[BackgroundSync] Sync failed:', error);
    } finally {
      this.isSyncing = false;
      await this.updateSyncStatusFromDb();
    }
  }

  /**
   * Sync all pending requests with dependency awareness
   */
  private async syncPendingRequests(): Promise<void> {
    const pending = await this.indexedDb.getPendingRequests();

    if (pending.length === 0) {
      console.log('[BackgroundSync] No pending requests');
      return;
    }

    console.log(`[BackgroundSync] Syncing ${pending.length} pending requests`);

    for (const request of pending) {
      // Check if it's time to retry (exponential backoff)
      if (!this.shouldRetryNow(request)) {
        continue;
      }

      // Check dependencies
      const depsCompleted = await this.indexedDb.areDependenciesCompleted(request.dependencies);
      if (!depsCompleted) {
        console.log(`[BackgroundSync] Skipping ${request.requestId} - dependencies not met`);
        continue;
      }

      // Resolve any temp IDs to real IDs
      const resolvedRequest = await this.resolveTempIds(request);

      // Update status to syncing
      await this.indexedDb.updateRequestStatus(request.requestId, 'syncing');
      this.updateSyncStatus({ currentlySyncing: this.getRequestDescription(request) });

      // Attempt to sync
      try {
        const result = await this.performSync(resolvedRequest);

        // CRITICAL FIX: Verify RecordsAffected for UPDATE requests
        // Caspio returns 200 OK with RecordsAffected:0 if no matching record exists
        // This was causing FDF updates to be silently lost when room EFEID didn't match
        if (request.type === 'UPDATE' && request.method === 'PUT') {
          const recordsAffected = result?.RecordsAffected ?? result?.recordsAffected;
          if (recordsAffected === 0) {
            console.warn(`[BackgroundSync] ⚠️ UPDATE returned 0 records affected - record may not exist yet`);
            console.warn(`[BackgroundSync] Request endpoint: ${request.endpoint}`);
            console.warn(`[BackgroundSync] Request data:`, request.data);

            // Keep the request pending for retry - don't remove from queue
            await this.indexedDb.updateRequestStatus(request.requestId, 'pending', 'No records updated - retrying', true);
            continue;
          }
          console.log(`[BackgroundSync] ✅ UPDATE affected ${recordsAffected} record(s)`);
        }

      // If this created a new record, store ID mapping and emit events
      if (request.tempId) {
        let realId: number | string | null = null;

        // Determine the correct ID field based on the endpoint
        if (request.endpoint.includes('Services_Visuals') && !request.endpoint.includes('Attach')) {
          // For Visuals, use VisualID field (not PK_ID) - attachments link to this
          if (result && result.VisualID) {
            realId = result.VisualID;
          } else if (result && result.Result && result.Result[0]) {
            realId = result.Result[0].VisualID || result.Result[0].PK_ID;
          }
        } else if (request.endpoint.includes('Services_EFE_Points')) {
          // For EFE Points, use PointID
          if (result && result.PointID) {
            realId = result.PointID;
          } else if (result && result.Result && result.Result[0]) {
            realId = result.Result[0].PointID || result.Result[0].PK_ID;
          }

          // Update IndexedDB cache and emit sync complete event
          if (realId) {
            // Get the room ID from request data (could be temp or real ID)
            const roomId = String(request.data?.EFEID || '');
            const pointData = result.Result?.[0] || result;
            
            // Update the IndexedDB cache for points
            if (roomId) {
              const existingPoints = await this.indexedDb.getCachedServiceData(roomId, 'efe_points') || [];
              
              // Find and update the point with temp ID, or add new if not found
              let pointUpdated = false;
              const updatedPoints = existingPoints.map((p: any) => {
                if (p._tempId === request.tempId || p.PointID === request.tempId || p.PK_ID === request.tempId) {
                  pointUpdated = true;
                  return {
                    ...p,
                    ...pointData,
                    PointID: realId,
                    PK_ID: realId,
                    EFEID: roomId, // Use the resolved room ID
                    _tempId: undefined,
                    _localOnly: undefined,
                    _syncing: undefined
                  };
                }
                return p;
              });
              
              // If point wasn't in cache (shouldn't happen but just in case), add it
              if (!pointUpdated && pointData) {
                updatedPoints.push({
                  ...pointData,
                  PointID: realId,
                  PK_ID: realId,
                  EFEID: roomId
                });
              }
              
              await this.indexedDb.cacheServiceData(roomId, 'efe_points', updatedPoints);
              console.log(`[BackgroundSync] Updated EFE points cache for room ${roomId}`);
            }

            // CRITICAL: Store temp-to-real point ID mapping for photo restoration on reload
            // This allows loadElevationPoints to find pending photos that were stored with temp point IDs
            await this.indexedDb.mapTempId(request.tempId!, String(realId), 'point');
            console.log(`[BackgroundSync] ✅ Stored point ID mapping: ${request.tempId} -> ${realId}`);

            this.ngZone.run(() => {
              this.efePointSyncComplete$.next({
                tempId: request.tempId!,
                realId: parseInt(String(realId)),
                result: result
              });
            });

            // Remove from pendingEFEData
            await this.indexedDb.removePendingEFE(request.tempId);
          }
        } else if (request.endpoint.includes('Services_EFE/') || request.endpoint.includes('Services_EFE')) {
          // For EFE Rooms, use EFEID
          if (result && result.EFEID) {
            realId = result.EFEID;
          } else if (result && result.Result && result.Result[0]) {
            realId = result.Result[0].EFEID || result.Result[0].PK_ID;
          }

          // Update IndexedDB cache and emit sync complete event
          if (realId) {
            const serviceId = String(request.data?.ServiceID || '');
            
            // Update the IndexedDB cache to replace temp ID with real room data
            if (serviceId) {
              const existingRooms = await this.indexedDb.getCachedServiceData(serviceId, 'efe_rooms') || [];
              const roomData = result.Result?.[0] || result;
              
              // Find and update the room with temp ID, or add new if not found
              let roomUpdated = false;
              const updatedRooms = existingRooms.map((r: any) => {
                if (r._tempId === request.tempId || r.EFEID === request.tempId || r.PK_ID === request.tempId) {
                  roomUpdated = true;
                  return {
                    ...r,
                    ...roomData,
                    EFEID: realId,
                    PK_ID: realId,
                    _tempId: undefined,
                    _localOnly: undefined,
                    _syncing: undefined
                  };
                }
                return r;
              });
              
              // If room wasn't in cache (shouldn't happen but just in case), add it
              if (!roomUpdated && roomData) {
                updatedRooms.push({
                  ...roomData,
                  EFEID: realId,
                  PK_ID: realId
                });
              }
              
              await this.indexedDb.cacheServiceData(serviceId, 'efe_rooms', updatedRooms);
              console.log(`[BackgroundSync] Updated EFE rooms cache for service ${serviceId}`);
            }

            this.ngZone.run(() => {
              this.efeRoomSyncComplete$.next({
                tempId: request.tempId!,
                realId: parseInt(String(realId)),
                result: result
              });
            });

            // Remove from pendingEFEData
            await this.indexedDb.removePendingEFE(request.tempId);
          }
        } else {
          // For other tables, use PK_ID
          if (result && result.PK_ID) {
            realId = result.PK_ID;
          } else if (result && result.Result && result.Result[0] && result.Result[0].PK_ID) {
            realId = result.Result[0].PK_ID;
          }
        }

        if (realId) {
          await this.indexedDb.mapTempId(
            request.tempId,
            realId.toString(),
            this.getTempIdType(request.tempId)
          );
          console.log(`[BackgroundSync] Mapped ${request.tempId} → ${realId}`);
        }
      }

        // Emit sync complete event for Service/Project updates so pages can reload
        if (request.type === 'UPDATE') {
          console.log(`[BackgroundSync] UPDATE completed for endpoint: ${request.endpoint}`);
          console.log(`[BackgroundSync] UPDATE data was:`, request.data);
          if (request.endpoint.includes('LPS_Services/records')) {
            const match = request.endpoint.match(/PK_ID=(\d+)/);
            if (match) {
              console.log(`[BackgroundSync] Emitting serviceDataSyncComplete for serviceId=${match[1]}`);
              this.ngZone.run(() => {
                this.serviceDataSyncComplete$.next({ serviceId: match[1] });
              });
            }
          } else if (request.endpoint.includes('LPS_Projects/records')) {
            const match = request.endpoint.match(/PK_ID=(\d+)/);
            if (match) {
              console.log(`[BackgroundSync] Emitting serviceDataSyncComplete for projectId=${match[1]}`);
              this.ngZone.run(() => {
                this.serviceDataSyncComplete$.next({ projectId: match[1] });
              });
            }
          } else if (request.endpoint.includes('LPS_Services_Visuals_Attach')) {
            // Clear _localUpdate flag from IndexedDB cache after successful annotation sync
            const attachMatch = request.endpoint.match(/AttachID=(\d+)/);
            if (attachMatch) {
              const attachId = attachMatch[1];
              console.log(`[BackgroundSync] Annotation synced for AttachID ${attachId}, clearing _localUpdate flag`);
              await this.clearLocalUpdateFlag('visual_attachments', attachId);
            }
          } else if (request.endpoint.includes('LPS_Services_EFE_Points_Attach')) {
            // Clear _localUpdate flag from EFE attachments cache
            const attachMatch = request.endpoint.match(/AttachID=(\d+)/);
            if (attachMatch) {
              const attachId = attachMatch[1];
              console.log(`[BackgroundSync] EFE Annotation synced for AttachID ${attachId}, clearing _localUpdate flag`);
              await this.clearLocalUpdateFlag('efe_point_attachments', attachId);
            }
          } else if (request.endpoint.includes('LPS_Services_Visuals/records') && !request.endpoint.includes('Attach')) {
            // Clear _localUpdate flag from Visuals cache after successful update (e.g., Notes: 'HIDDEN')
            const visualMatch = request.endpoint.match(/VisualID=(\d+)/);
            if (visualMatch) {
              const visualId = visualMatch[1];
              const serviceId = request.data?.ServiceID;
              console.log(`[BackgroundSync] Visual UPDATE synced for VisualID ${visualId}, clearing _localUpdate flag`);
              await this.clearVisualLocalUpdateFlag(visualId, serviceId);
            }
          } else if (request.endpoint.includes('LPS_Services_EFE/records') && !request.endpoint.includes('Points')) {
            // Clear _localUpdate flag from EFE rooms cache after successful update (FDF, Location, Notes)
            const efeMatch = request.endpoint.match(/EFEID=(\d+)/);
            if (efeMatch) {
              const efeId = efeMatch[1];
              const serviceId = request.data?.ServiceID;
              console.log(`[BackgroundSync] EFE Room UPDATE synced for EFEID ${efeId}, clearing _localUpdate flag`);
              await this.clearEFERoomLocalUpdateFlag(efeId, serviceId);
            }
          }
        }

        // Emit visual sync complete for CREATE operations on visuals
        if (request.type === 'CREATE' && (request.endpoint === 'LPS_Services_Visuals' || request.endpoint.includes('LPS_Services_Visuals/records'))) {
          const serviceId = request.data?.ServiceID;
          // Extract visual ID from result
          let visualId = result?.VisualID || result?.Result?.[0]?.VisualID || result?.PK_ID || result?.Result?.[0]?.PK_ID;
          
          if (serviceId && visualId) {
            console.log(`[BackgroundSync] Visual created - emitting visualSyncComplete for serviceId=${serviceId}, visualId=${visualId}`);
            this.ngZone.run(() => {
              this.visualSyncComplete$.next({
                serviceId: String(serviceId),
                visualId: String(visualId),
                tempId: request.tempId
              });
            });
            
            // Also refresh the visuals cache from server
            await this.refreshVisualsCache(String(serviceId));
          }
        }

        // CRITICAL: Delete the request after successful sync instead of just marking as 'synced'
        // This prevents stale "pending" counts in the sync widget
        await this.indexedDb.removePendingRequest(request.requestId);
        console.log(`[BackgroundSync] ✅ Synced and removed: ${request.requestId}`);

      } catch (error: any) {
        const errorMessage = error.message || 'Sync failed';

        // Check if this is a dependency-related failure (should retry immediately when dependency resolves)
        const isDependencyError = errorMessage.includes('not synced yet') ||
                                   errorMessage.includes('dependency') ||
                                   errorMessage.includes('waiting for');

        if (isDependencyError) {
          // DON'T increment retry count for dependency failures
          // These should retry immediately when the dependency resolves
          // TASK 2 FIX: Skip lastAttempt update so exponential backoff doesn't delay retry
          console.log(`[BackgroundSync] ⏳ Dependency pending for ${request.requestId}: ${errorMessage}`);
          await this.indexedDb.updateRequestStatus(request.requestId, 'pending', errorMessage, true);
        } else {
          // Real failure - increment retry count for exponential backoff
          const newRetryCount = await this.indexedDb.incrementRetryCount(request.requestId);

          // US-001 FIX: Mark as 'failed' after too many retries so it shows in Failed tab
          // This prevents silent failures where users never know something went wrong
          const MAX_RETRIES_BEFORE_FAILED = 10;
          if (newRetryCount >= MAX_RETRIES_BEFORE_FAILED) {
            const failedMessage = `Failed after ${newRetryCount} attempts: ${errorMessage}`;
            await this.indexedDb.updateRequestStatus(request.requestId, 'failed', failedMessage);
            console.error(`[BackgroundSync] ❌ FAILED PERMANENTLY: ${request.requestId}`, failedMessage);
          } else {
            await this.indexedDb.updateRequestStatus(request.requestId, 'pending', errorMessage);
            console.warn(`[BackgroundSync] ❌ Failed (will retry ${newRetryCount}/${MAX_RETRIES_BEFORE_FAILED}): ${request.requestId}`, error);
          }
        }
      }
    }
  }

  /**
   * Sync pending caption/annotation updates
   * Processes the pendingCaptions queue independently from photo uploads
   * This ensures caption changes are never lost due to race conditions
   */
  private async syncPendingCaptions(): Promise<void> {
    // Clean up orphaned captions first (temp IDs with no pending image)
    await this.indexedDb.cleanupOrphanedCaptions();
    
    const pendingCaptions = await this.indexedDb.getPendingCaptions();
    
    if (pendingCaptions.length === 0) {
      return;
    }
    
    console.log(`[BackgroundSync] Processing ${pendingCaptions.length} pending caption updates`);
    
    for (const caption of pendingCaptions) {
      try {
        // Check if attachId needs resolution BEFORE marking as syncing
        // This prevents status flicker (pending->syncing->pending) on mobile
        const attachIdStr = String(caption.attachId || '');
        let resolvedAttachId = attachIdStr;
        
        // Check for temp_ prefix (legacy system)
        if (attachIdStr.startsWith('temp_')) {
          const realId = await this.indexedDb.getRealId(attachIdStr);
          if (!realId) {
            // Track the dependency wait so it's visible in failed tab
            const dependencyError = `Waiting for photo sync (temp ID: ${attachIdStr})`;
            console.log(`[BackgroundSync] Caption ${caption.captionId} waiting: ${dependencyError}`);
            await this.indexedDb.updateCaptionStatus(caption.captionId, 'pending', dependencyError);
            continue;
          }
          resolvedAttachId = realId;
          console.log(`[BackgroundSync] Resolved caption attachId (temp): ${caption.attachId} → ${realId}`);
        }
        // Check for local-first imageId (new system - UUIDs or img_ prefix)
        else if (attachIdStr.startsWith('img_') || attachIdStr.includes('-')) {
          // This looks like a local-first imageId - look up the LocalImage to get real attachId
          const localImage = await this.indexedDb.getLocalImage(attachIdStr);
          if (localImage) {
            if (localImage.attachId && !String(localImage.attachId).startsWith('img_')) {
              // Photo has synced and has a real Caspio AttachID
              resolvedAttachId = localImage.attachId;
              console.log(`[BackgroundSync] Resolved caption attachId (local-first): ${caption.attachId} → ${resolvedAttachId}`);
            } else {
              // Photo hasn't synced yet - track the dependency so it's visible
              const dependencyError = `Waiting for photo upload (image: ${attachIdStr})`;
              console.log(`[BackgroundSync] Caption ${caption.captionId} waiting: ${dependencyError}`);
              await this.indexedDb.updateCaptionStatus(caption.captionId, 'pending', dependencyError);
              continue;
            }
          } else {
            // LocalImage not found - might be old temp ID format, try getRealId
            const realId = await this.indexedDb.getRealId(attachIdStr);
            if (realId) {
              resolvedAttachId = realId;
              console.log(`[BackgroundSync] Resolved caption attachId (fallback): ${caption.attachId} → ${realId}`);
            } else {
              // Can't resolve - might be already synced with this ID, try anyway
              console.log(`[BackgroundSync] Caption attachId ${attachIdStr} - proceeding as-is`);
            }
          }
        }
        
        // Mark as syncing ONLY after we know we can proceed
        await this.indexedDb.updateCaptionStatus(caption.captionId, 'syncing');
        
        // Build update data
        const updateData: any = {};
        if (caption.caption !== undefined) {
          updateData.Annotation = caption.caption;
        }
        if (caption.drawings !== undefined) {
          updateData.Drawings = caption.drawings;
        }
        
        // Determine endpoint based on type
        let endpoint: string;
        switch (caption.attachType) {
          case 'visual':
            endpoint = `/api/caspio-proxy/tables/LPS_Services_Visuals_Attach/records?q.where=AttachID=${resolvedAttachId}`;
            break;
          case 'efe_point':
            endpoint = `/api/caspio-proxy/tables/LPS_Services_EFE_Points_Attach/records?q.where=AttachID=${resolvedAttachId}`;
            break;
          case 'fdf':
            // FDF updates go to the EFE room record, not attachments
            // The attachId is the EFEID (room ID), and pointId stores the photo type (Top/Bottom/Threshold)
            const photoType = caption.pointId || 'Top'; // Default to Top if not specified
            
            // Build FDF-specific update data with dynamic column names
            // Column names are FDF{Type}Drawings and FDF{Type}Annotation (not FDFPhoto{Type}...)
            const fdfUpdateData: any = {};
            if (caption.caption !== undefined) {
              fdfUpdateData[`FDF${photoType}Annotation`] = caption.caption;
            }
            if (caption.drawings !== undefined) {
              fdfUpdateData[`FDF${photoType}Drawings`] = caption.drawings;
            }
            
            console.log(`[BackgroundSync] Syncing FDF caption for room ${resolvedAttachId}, type: ${photoType}`);
            endpoint = `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=${resolvedAttachId}`;
            
            try {
              const fdfResponse: any = await this.apiGateway.put(endpoint, fdfUpdateData).toPromise();
              const fdfRecordsAffected = fdfResponse?.RecordsAffected ?? fdfResponse?.recordsAffected ?? 1;
              
              if (fdfRecordsAffected === 0) {
                console.warn(`[BackgroundSync] ⚠️ FDF caption sync returned 0 records - room may not exist yet: ${resolvedAttachId}`);
                await this.indexedDb.updateCaptionStatus(caption.captionId, 'pending', 'Room not found', true);
                continue;
              }
              
              console.log(`[BackgroundSync] ✅ FDF caption synced: ${caption.captionId} (${fdfRecordsAffected} record(s) updated)`);
              await this.indexedDb.updateCaptionStatus(caption.captionId, 'synced');
              
              // Schedule deletion after 30 seconds
              const fdfCaptionId = caption.captionId;
              setTimeout(() => {
                this.indexedDb.deletePendingCaption(fdfCaptionId).catch(err => {
                  console.warn(`[BackgroundSync] Failed to delete FDF caption: ${fdfCaptionId}`, err);
                });
              }, 30000);
              
              continue;
            } catch (fdfError) {
              console.error(`[BackgroundSync] FDF caption sync failed:`, fdfError);
              await this.indexedDb.updateCaptionStatus(caption.captionId, 'pending', String(fdfError), true);
              continue;
            }
          default:
            console.warn(`[BackgroundSync] Unknown caption type: ${caption.attachType}`);
            await this.indexedDb.updateCaptionStatus(caption.captionId, 'failed', 'Unknown type');
            continue;
        }
        
        // Perform the API update
        console.log(`[BackgroundSync] Syncing caption for ${caption.attachType} AttachID=${resolvedAttachId}`);
        const response: any = await this.apiGateway.put(endpoint, updateData).toPromise();
        
        // CRITICAL: Verify that records were actually updated
        // Caspio returns 200 OK with RecordsAffected:0 if no matching record exists
        const recordsAffected = response?.RecordsAffected ?? response?.recordsAffected ?? 1;
        if (recordsAffected === 0) {
          console.warn(`[BackgroundSync] ⚠️ Caption sync returned 0 records affected - attachment may not exist yet: ${resolvedAttachId}`);
          // Set back to pending for retry WITH backoff to prevent rapid retry loops
          // The incrementRetry flag ensures proper exponential backoff
          await this.indexedDb.updateCaptionStatus(caption.captionId, 'pending', 'Attachment not found', true);
          continue;
        }
        
        console.log(`[BackgroundSync] ✅ Caption synced: ${caption.captionId} (${recordsAffected} record(s) updated)`);
        
        // CRITICAL: Update the synced cache with caption/drawings data
        // This ensures the cache has correct data for future page loads
        await this.updateSyncedCacheWithCaption({
          attachId: resolvedAttachId,
          attachType: caption.attachType,
          caption: caption.caption,
          drawings: caption.drawings,
          visualId: caption.visualId,
          pointId: caption.pointId,
          serviceId: caption.serviceId
        });
        
        // CRITICAL FIX: Mark as synced but DON'T delete immediately
        // Keep synced captions for 30 seconds in case user reloads page quickly
        // This fixes captions disappearing on reload
        await this.indexedDb.updateCaptionStatus(caption.captionId, 'synced');
        console.log(`[BackgroundSync] Caption marked as synced: ${caption.captionId} - will delete in 30s`);

        // Schedule deletion after 30 seconds (gives time for page reload to merge)
        const captionIdToDelete = caption.captionId;
        setTimeout(() => {
          this.indexedDb.deletePendingCaption(captionIdToDelete).then(() => {
            console.log(`[BackgroundSync] Caption deleted after delay: ${captionIdToDelete}`);
          }).catch(err => {
            console.warn(`[BackgroundSync] Failed to delete caption: ${captionIdToDelete}`, err);
          });
        }, 30000);

        // Emit event for pages to update UI
        this.ngZone.run(() => {
          this.captionSyncComplete$.next({
            attachId: resolvedAttachId,
            attachType: caption.attachType,
            captionId: caption.captionId
          });
        });

        // Mark sections dirty for caption updates
        if (caption.serviceId) {
          this.markAllSectionsDirty(caption.serviceId);
        }
        
      } catch (error: any) {
        console.warn(`[BackgroundSync] ❌ Caption sync failed: ${caption.captionId}`, error);
        await this.indexedDb.updateCaptionStatus(caption.captionId, 'failed', error.message || 'Sync failed');
      }
    }
  }

  /**
   * Determine if request should be retried now based on exponential backoff
   */
  private shouldRetryNow(request: PendingRequest): boolean {
    if (!request.lastAttempt) {
      return true; // Never attempted, try now
    }

    const timeSinceLastAttempt = Date.now() - request.lastAttempt;
    const retryDelay = this.calculateRetryDelay(request.retryCount);

    return timeSinceLastAttempt >= retryDelay;
  }

  /**
   * Calculate retry delay with exponential backoff
   * Gets progressively longer, but never gives up
   */
  private calculateRetryDelay(retryCount: number): number {
    // Retry schedule:
    // 0: Immediate
    // 1: 30 seconds
    // 2: 1 minute
    // 3: 2 minutes
    // 4: 5 minutes
    // 5-10: 10 minutes
    // 10-24: 30 minutes
    // 24+: 1 hour

    if (retryCount === 0) return 0;
    if (retryCount === 1) return 30 * 1000;        // 30s
    if (retryCount === 2) return 60 * 1000;        // 1m
    if (retryCount === 3) return 2 * 60 * 1000;    // 2m
    if (retryCount === 4) return 5 * 60 * 1000;    // 5m
    if (retryCount <= 10) return 10 * 60 * 1000;   // 10m
    if (retryCount <= 24) return 30 * 60 * 1000;   // 30m
    return 60 * 60 * 1000;  // 1h (max delay, keeps trying forever)
  }

  /**
   * Perform the actual API request
   */
  private async performSync(request: PendingRequest): Promise<any> {
    // Handle photo uploads with temp Visual IDs
    if (request.endpoint === 'VISUAL_PHOTO_UPLOAD') {
      return this.syncVisualPhotoUpload(request);
    }

    // Handle EFE point photo uploads
    if (request.endpoint === 'EFE_POINT_PHOTO_UPLOAD') {
      return this.syncEFEPointPhotoUpload(request);
    }

    // Handle file uploads specially
    if (request.type === 'UPLOAD_FILE' && request.data.file) {
      return this.syncFileUpload(request);
    }

    switch (request.method) {
      case 'GET':
        return this.apiGateway.get(request.endpoint).toPromise();
      case 'POST':
        return this.apiGateway.post(request.endpoint, request.data).toPromise();
      case 'PUT':
        return this.apiGateway.put(request.endpoint, request.data).toPromise();
      case 'DELETE':
        return this.apiGateway.delete(request.endpoint).toPromise();
      default:
        throw new Error(`Unsupported method: ${request.method}`);
    }
  }

  /**
   * Sync photo upload for a Visual using existing S3 upload
   * Now retrieves drawings from IndexedDB for offline annotation support
   */
  private async syncVisualPhotoUpload(request: PendingRequest): Promise<any> {
    const data = request.data;

    console.log('[BackgroundSync] Photo upload - raw data:', data);

    // CRITICAL: Mark photo as uploading to prevent it showing in pending list during upload
    // This prevents broken images when user navigates away and back during sync
    await this.indexedDb.markPhotoUploading(data.fileId);

    // Get file AND annotations from IndexedDB
    const photoData = await this.indexedDb.getStoredPhotoData(data.fileId);
    if (!photoData) {
      console.error('[BackgroundSync] Photo data not found in IndexedDB:', data.fileId);
      // Mark as failed - file is missing, can't upload
      await this.indexedDb.updateRequestStatus(request.requestId, 'failed', 'File not found in storage');
      throw new Error(`Photo file not found: ${data.fileId}`);
    }

    const { file, drawings: storedDrawings, caption: storedCaption } = photoData;

    // Use drawings from IndexedDB if available, otherwise fall back to request data
    const drawings = storedDrawings || data.drawings || '';
    const caption = storedCaption || data.caption || '';

    console.log('[BackgroundSync] File retrieved successfully:', file.name, file.size);
    console.log('[BackgroundSync] Drawings from storage:', drawings.length, 'chars');
    console.log('[BackgroundSync] Caption from storage:', caption);

    // Resolve temp Visual ID to real ID if needed
    let visualId = data.tempVisualId || data.visualId;
    console.log('[BackgroundSync] Visual ID from request:', visualId);

    if (visualId && String(visualId).startsWith('temp_')) {
      const realId = await this.indexedDb.getRealId(String(visualId));
      console.log('[BackgroundSync] Resolved temp ID:', visualId, '→', realId);

      if (!realId) {
        throw new Error(`Visual not synced yet: ${visualId}`);
      }
      visualId = parseInt(realId);
    } else {
      visualId = parseInt(String(visualId));
    }

    // CRITICAL: Check for NaN before proceeding
    if (isNaN(visualId)) {
      console.error('[BackgroundSync] Visual ID is NaN after parsing:', data.visualId, data.tempVisualId);
      throw new Error(`Invalid visual ID: ${data.visualId || data.tempVisualId}`);
    }

    console.log('[BackgroundSync] Final Visual ID for upload:', visualId);

    // Generate idempotency key for AWS deduplication
    const idempotencyKey = data.idempotencyKey || `photo_${visualId}_${data.fileName}_${data.fileSize}`;
    console.log('[BackgroundSync] Using idempotency key:', idempotencyKey);

    try {
      // CRITICAL FIX: Re-read annotations RIGHT before upload in case user updated while waiting
      // This handles the race condition where user annotates during upload queue wait
      const latestPhotoData = await this.indexedDb.getStoredPhotoData(data.fileId);
      const latestDrawings = latestPhotoData?.drawings || drawings;
      const latestCaption = latestPhotoData?.caption || caption;
      
      if (latestDrawings !== drawings) {
        console.log('[BackgroundSync] ⚠️ Drawings updated while waiting! Using latest:', latestDrawings.length, 'chars');
      }
      
      // Call the EXISTING S3 upload method with LATEST drawings AND caption from IndexedDB
      const result = await this.caspioService.uploadVisualsAttachWithS3(
        visualId,
        latestDrawings,  // Now using the LATEST annotations
        file,
        latestCaption    // Now passing the caption
      );

      console.log('[BackgroundSync] Photo uploaded successfully to Visual', visualId, 'with', latestDrawings.length, 'chars of drawings, caption:', latestCaption || '(none)');

      // STEP 1: Update photo status to 'synced' (before cleanup)
      await this.indexedDb.updatePhotoStatus(data.fileId, 'synced');
      console.log('[BackgroundSync] Photo status updated to synced:', data.fileId);

      // STEP 2: Cache the uploaded image as base64 for offline viewing
      // CRITICAL: This MUST succeed before we delete the local blob
      // This enables seamless URL transition from blob URL to cached base64
      let cachingSucceeded = false;
      const realAttachId = result.AttachID || result.attachId;
      try {
        if (result.s3Key || result.Photo) {
          await this.cacheUploadedPhoto(
            realAttachId,
            data.serviceId || '',
            result.s3Key || result.Photo
          );
          console.log('[BackgroundSync] ✅ Cached uploaded photo for offline viewing');
          cachingSucceeded = true;
        } else {
          // No S3 key, but upload succeeded - mark as cached anyway
          cachingSucceeded = true;
        }
      } catch (cacheErr) {
        console.warn('[BackgroundSync] Failed to cache uploaded photo:', cacheErr);
        // DON'T delete local blob if caching failed - user still needs to see the photo
        console.warn('[BackgroundSync] ⚠️ Keeping local blob because caching failed');
      }

      // STEP 3: Update any pending caption updates with the real AttachID
      // This handles the case where user added caption while photo was still uploading
      if (realAttachId && data.fileId) {
        const updatedCount = await this.indexedDb.updateCaptionAttachId(data.fileId, String(realAttachId));
        if (updatedCount > 0) {
          console.log(`[BackgroundSync] ✅ Updated ${updatedCount} pending captions with real AttachID: ${realAttachId}`);
        }
      }

      // STEP 4: Emit event so pages can update their local state with cached URL
      this.ngZone.run(() => {
        this.photoUploadComplete$.next({
          tempFileId: data.fileId,
          tempVisualId: data.tempVisualId,
          realVisualId: visualId,
          result: result
        });
      });

      // STEP 4.5: Mark sections dirty so they reload on next visit
      // This ensures photos appear even if page was navigated away during upload
      // Get serviceId from stored photo data if available
      const storedPhotoData = await this.indexedDb.getStoredPhotoData(data.fileId);
      if (storedPhotoData?.serviceId) {
        this.markAllSectionsDirty(storedPhotoData.serviceId);
      }

      // STEP 5: Clean up stored photo ONLY if caching succeeded
      // Use a short delay to allow any in-progress navigation to complete
      // This prevents race conditions where user navigates while sync is finishing
      if (cachingSucceeded) {
        const fileIdToDelete = data.fileId;
        setTimeout(async () => {
          try {
            await this.indexedDb.deleteStoredFile(fileIdToDelete);
            console.log('[BackgroundSync] Cleaned up stored photo file:', fileIdToDelete);
          } catch (delErr) {
            console.warn('[BackgroundSync] Failed to delete stored file:', fileIdToDelete, delErr);
          }
        }, 2000); // 2 second delay to allow navigation to complete
      } else {
        console.log('[BackgroundSync] ⚠️ Skipping local blob deletion - caching failed');
      }

      // Refresh visual attachments cache with new photo
      // CRITICAL: Preserve local updates (_localUpdate flag) when merging
      try {
        const freshAttachments = await this.caspioService.getServiceVisualsAttachByVisualId(String(visualId)).toPromise() || [];
        
        // Get existing cached attachments to preserve local updates
        const existingCache = await this.indexedDb.getCachedServiceData(String(visualId), 'visual_attachments') || [];
        
        // Build map of locally updated attachments that should NOT be overwritten
        const localUpdates = new Map<string, any>();
        for (const att of existingCache) {
          if (att._localUpdate) {
            localUpdates.set(String(att.AttachID), att);
            console.log(`[BackgroundSync] Preserving local annotation for AttachID ${att.AttachID}`);
          }
        }
        
        // Merge: use local version for items with pending updates
        const mergedAttachments = freshAttachments.map((att: any) => {
          const localVersion = localUpdates.get(String(att.AttachID));
          if (localVersion) {
            // Keep local Drawings and Annotation since they have pending changes
            return { ...att, Drawings: localVersion.Drawings, Annotation: localVersion.Annotation, _localUpdate: true };
          }
          return att;
        });
        
        await this.indexedDb.cacheServiceData(String(visualId), 'visual_attachments', mergedAttachments);
        console.log(`[BackgroundSync] ✅ Refreshed attachments cache for visual ${visualId}: ${freshAttachments.length} photos, ${localUpdates.size} local updates preserved`);
      } catch (cacheErr) {
        console.warn(`[BackgroundSync] Failed to refresh attachments cache:`, cacheErr);
      }

      return result;
    } catch (error: any) {
      console.error('[BackgroundSync] Photo upload failed, will retry with same idempotency key');
      // CRITICAL: Reset photo status to pending so it shows up in the pending list again
      await this.indexedDb.markPhotoPending(data.fileId);
      throw error;
    }
  }

  /**
   * Sync EFE point photo upload
   * Handles offline photo uploads for elevation plot points
   */
  private async syncEFEPointPhotoUpload(request: PendingRequest): Promise<any> {
    const data = request.data;

    console.log('[BackgroundSync] EFE photo upload - raw data:', data);

    // CRITICAL: Mark photo as uploading to prevent it showing in pending list during upload
    // This prevents broken images when user navigates away and back during sync
    await this.indexedDb.markPhotoUploading(data.fileId);

    // Get file and annotations from IndexedDB
    const photoData = await this.indexedDb.getStoredEFEPhotoData(data.fileId);
    if (!photoData) {
      console.error('[BackgroundSync] EFE photo data not found in IndexedDB:', data.fileId);
      await this.indexedDb.updateRequestStatus(request.requestId, 'failed', 'File not found in storage');
      throw new Error(`EFE photo file not found: ${data.fileId}`);
    }

    const { file, drawings, photoType, pointId: storedPointId } = photoData;

    console.log('[BackgroundSync] EFE file retrieved:', file.name, file.size, 'bytes');
    console.log('[BackgroundSync] Drawings:', drawings.length, 'chars, photoType:', photoType);

    // IMPORTANT: tempPointId may have already been resolved by resolveTempIds()
    // Check if it's already a number (resolved) or still a temp string
    let pointId = data.tempPointId || data.pointId || storedPointId;
    console.log('[BackgroundSync] Point ID from request data:', pointId, 'type:', typeof pointId);

    // If it's already a number (resolved by resolveTempIds), use it directly
    if (typeof pointId === 'number' && !isNaN(pointId)) {
      console.log('[BackgroundSync] Point ID already resolved to number:', pointId);
    } else if (pointId && String(pointId).startsWith('temp_')) {
      // Still a temp ID - try to resolve it
      const realId = await this.indexedDb.getRealId(String(pointId));
      console.log('[BackgroundSync] Resolved temp Point ID:', pointId, '→', realId);

      if (!realId) {
        throw new Error(`EFE Point not synced yet: ${pointId}`);
      }
      pointId = parseInt(realId);
    } else {
      pointId = parseInt(String(pointId));
    }

    // Validate Point ID
    if (isNaN(pointId)) {
      console.error('[BackgroundSync] Point ID is NaN:', data.pointId, data.tempPointId, storedPointId);
      throw new Error(`Invalid Point ID: ${data.pointId || data.tempPointId || storedPointId}`);
    }

    console.log('[BackgroundSync] Final Point ID for EFE upload:', pointId, 'type:', typeof pointId);
    console.log('[BackgroundSync] Full request data for debugging:', JSON.stringify({
      tempPointId: data.tempPointId,
      pointId: data.pointId,
      storedPointId: storedPointId,
      fileId: data.fileId,
      photoType: photoType || data.photoType
    }));

    // CRITICAL: Validate PointID is a valid number before API call
    if (!pointId || isNaN(pointId) || pointId <= 0) {
      console.error('[BackgroundSync] ❌ INVALID PointID detected before API call:', pointId);
      throw new Error(`Invalid PointID for EFE photo: ${pointId}`);
    }

    try {
      // CRITICAL FIX: Re-read annotations and caption RIGHT before upload in case user updated while waiting
      // This handles the race condition where user annotates/adds caption during upload queue wait
      const latestPhotoData = await this.indexedDb.getStoredEFEPhotoData(data.fileId);
      const latestDrawings = latestPhotoData?.drawings || drawings;
      const latestCaption = latestPhotoData?.caption || data.caption || '';
      
      if (latestDrawings !== drawings) {
        console.log('[BackgroundSync] ⚠️ EFE Drawings updated while waiting! Using latest:', latestDrawings.length, 'chars');
      }
      if (latestCaption) {
        console.log('[BackgroundSync] EFE Caption from storage:', latestCaption);
      }

      // Call the S3 upload method for EFE point attachments
      console.log('[BackgroundSync] Calling uploadEFEPointsAttachWithS3 with PointID:', pointId);
      const result = await this.caspioService.uploadEFEPointsAttachWithS3(
        pointId,
        latestDrawings || data.drawings || '',  // Use LATEST drawings
        file,
        photoType || data.photoType || 'Measurement',
        latestCaption  // CRITICAL: Pass caption to upload
      );

      console.log('[BackgroundSync] ✅ EFE photo uploaded to Point', pointId, 'Result:', JSON.stringify(result));

      // STEP 1: Update photo status to 'synced' (before cleanup)
      await this.indexedDb.updatePhotoStatus(data.fileId, 'synced');
      console.log('[BackgroundSync] EFE photo status updated to synced:', data.fileId);

      // STEP 2: Cache the uploaded image as base64 for offline viewing
      // CRITICAL: This MUST succeed before we delete the local blob
      let cachingSucceeded = false;
      const realAttachId = result.AttachID || result.attachId;
      try {
        if (result.s3Key || result.Photo) {
          await this.cacheUploadedPhoto(
            realAttachId,
            data.serviceId || '',
            result.s3Key || result.Photo
          );
          console.log('[BackgroundSync] ✅ Cached EFE photo for offline viewing');
          cachingSucceeded = true;
        } else {
          // No S3 key, but upload succeeded - mark as cached anyway
          cachingSucceeded = true;
        }
      } catch (cacheErr) {
        console.warn('[BackgroundSync] Failed to cache EFE photo:', cacheErr);
        // DON'T delete local blob if caching failed
        console.warn('[BackgroundSync] ⚠️ Keeping local blob because caching failed');
      }

      // STEP 3: Update any pending caption updates with the real AttachID
      // This handles the case where user added caption while photo was still uploading
      if (realAttachId && data.fileId) {
        const updatedCount = await this.indexedDb.updateCaptionAttachId(data.fileId, String(realAttachId));
        if (updatedCount > 0) {
          console.log(`[BackgroundSync] ✅ Updated ${updatedCount} pending EFE captions with real AttachID: ${realAttachId}`);
        }
      }

      // STEP 4: Emit event so pages can update their local state with cached URL
      this.ngZone.run(() => {
        this.efePhotoUploadComplete$.next({
          tempFileId: data.fileId,
          tempPointId: data.tempPointId,
          realPointId: pointId,
          result: result
        });
      });

      // STEP 4.5: Mark sections dirty for EFE photos
      // Get serviceId from stored photo data if available
      const storedEfePhotoData = await this.indexedDb.getStoredPhotoData(data.fileId);
      if (storedEfePhotoData?.serviceId) {
        this.markAllSectionsDirty(storedEfePhotoData.serviceId);
      }

      // STEP 5: Clean up stored photo ONLY if caching succeeded
      // Use a short delay to allow any in-progress navigation to complete
      if (cachingSucceeded) {
        const fileIdToDelete = data.fileId;
        setTimeout(async () => {
          try {
            await this.indexedDb.deleteStoredFile(fileIdToDelete);
            console.log('[BackgroundSync] Cleaned up EFE photo file:', fileIdToDelete);
          } catch (delErr) {
            console.warn('[BackgroundSync] Failed to delete EFE stored file:', fileIdToDelete, delErr);
          }
        }, 2000); // 2 second delay to allow navigation to complete
      } else {
        console.log('[BackgroundSync] ⚠️ Skipping EFE local blob deletion - caching failed');
      }

      return result;
    } catch (error: any) {
      console.error('[BackgroundSync] EFE photo upload failed, will retry');
      // CRITICAL: Reset photo status to pending so it shows up in the pending list again
      await this.indexedDb.markPhotoPending(data.fileId);
      throw error;
    }
  }

  /**
   * Sync file upload - convert base64 back to File
   */
  private async syncFileUpload(request: PendingRequest): Promise<any> {
    const data = request.data;
    
    // Get real Visual ID if using temp ID
    let visualId = data.visualId;
    if (visualId && typeof visualId === 'string' && visualId.startsWith('temp_')) {
      const realId = await this.indexedDb.getRealId(visualId);
      if (realId) {
        visualId = parseInt(realId);
      } else {
        throw new Error(`Visual not synced yet: ${visualId}`);
      }
    }

    // Convert base64 back to File
    const file = this.base64ToFile(data.file, data.fileName);
    const originalFile = data.originalFile ? this.base64ToFile(data.originalFile, 'original_' + data.fileName) : undefined;

    // Use the Caspio service method directly (it handles FormData)
    // Import CaspioService and call createServicesVisualsAttachWithFile
    // For now, throw error to prevent silent failures
    console.error('[BackgroundSync] File upload needs CaspioService integration');
    throw new Error('File upload not yet integrated with background sync');
  }

  /**
   * Convert base64 to File object
   */
  private base64ToFile(base64: string, fileName: string): File {
    // Remove data URL prefix if present
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
    
    // Convert base64 to blob
    const byteString = atob(base64Data);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    
    const blob = new Blob([ab], { type: 'image/jpeg' });
    return new File([blob], fileName, { type: 'image/jpeg' });
  }

  /**
   * Resolve temporary IDs to real IDs in request data AND endpoint URL
   */
  private async resolveTempIds(request: PendingRequest): Promise<PendingRequest> {
    const data = { ...request.data };
    let endpoint = request.endpoint;

    // Check common foreign key fields for temp IDs
    // Include both standard fields and custom field names used for offline queuing
    const foreignKeyFields = [
      'VisualID', 'EFEID', 'ProjectID', 'ServiceID',
      'PointID', 'HUDID', 'LBWID', 'ParentID',
      'tempVisualId', 'tempPointId', 'tempRoomId',
      '_tempEfeId'  // Custom field for deferred FDF updates
    ];

    for (const field of foreignKeyFields) {
      if (data[field] && typeof data[field] === 'string' && data[field].startsWith('temp_')) {
        const tempId = data[field];
        const realId = await this.indexedDb.getRealId(tempId);
        if (realId) {
          data[field] = realId;
          console.log(`[BackgroundSync] Resolved ${field}: ${tempId} → ${realId}`);
        } else {
          console.warn(`[BackgroundSync] Could not resolve ${field}: ${tempId} - real ID not found`);
        }
      }
    }

    // TASK 2 FIX: Resolve DEFERRED placeholders in endpoint URL for FDF/Location/Notes updates
    // When FDF is updated on a room with temp ID, endpoint is set to EFEID=DEFERRED
    // We need to resolve the _tempEfeId to get the real EFEID and update the endpoint
    if (endpoint.includes('EFEID=DEFERRED') && data._tempEfeId) {
      const tempEfeId = data._tempEfeId;

      // US-002 FIX: Check if _tempEfeId is already a real ID (not starting with 'temp_')
      // This can happen if the loop above already resolved it, or if a real ID was stored
      if (typeof tempEfeId === 'string' && !tempEfeId.startsWith('temp_')) {
        // Already a real ID - use it directly
        endpoint = endpoint.replace('EFEID=DEFERRED', `EFEID=${tempEfeId}`);
        console.log(`[BackgroundSync] Using real EFEID directly: ${tempEfeId}`);
        delete data._tempEfeId;
      } else {
        // Still a temp ID - try to resolve it
        const realEfeId = await this.indexedDb.getRealId(tempEfeId);
        if (realEfeId) {
          endpoint = endpoint.replace('EFEID=DEFERRED', `EFEID=${realEfeId}`);
          console.log(`[BackgroundSync] Resolved DEFERRED endpoint: ${tempEfeId} → ${realEfeId}`);
          delete data._tempEfeId;
        } else {
          // Room not synced yet - throw error to defer until room syncs
          console.log(`[BackgroundSync] FDF update deferred - room not synced yet: ${tempEfeId}`);
          throw new Error(`Room not synced yet: ${tempEfeId}`);
        }
      }
    }

    return { ...request, endpoint, data };
  }

  /**
   * Get human-readable description of request for UI
   */
  private getRequestDescription(request: PendingRequest): string {
    const typeMap: any = {
      'CREATE': 'Creating',
      'UPDATE': 'Updating',
      'DELETE': 'Deleting',
      'UPLOAD_FILE': 'Uploading',
    };

    const action = typeMap[request.type] || 'Processing';
    const entity = request.endpoint.split('/').pop() || 'data';
    
    return `${action} ${entity}...`;
  }

  /**
   * Get entity type from temp ID
   */
  private getTempIdType(tempId: string): string {
    const parts = tempId.split('_');
    return parts.length >= 2 ? parts[1] : 'unknown';
  }

  /**
   * Update sync status and notify observers
   */
  private updateSyncStatus(partial: Partial<SyncStatus>): void {
    const current = this.syncStatus$.value;
    this.ngZone.run(() => {
      this.syncStatus$.next({ ...current, ...partial });
    });
  }

  /**
   * Update sync status from database
   */
  private async updateSyncStatusFromDb(): Promise<void> {
    const stats = await this.indexedDb.getSyncStats();
    // Include pending caption count in the total
    const pendingCaptionCount = await this.indexedDb.getPendingCaptionCount();
    this.updateSyncStatus({
      isSyncing: false,
      pendingCount: stats.pending + pendingCaptionCount,
      syncedCount: stats.synced,
      failedCount: stats.failed,
      lastSyncTime: Date.now(),
      currentlySyncing: undefined,
    });
  }

  /**
   * Force sync now (for manual trigger)
   */
  async forceSyncNow(): Promise<void> {
    console.log('[BackgroundSync] Force sync triggered');
    await this.triggerSync();
  }

  /**
   * TASK 3 FIX: Public method to refresh sync status from database
   * Called after clearing pending items to update the UI
   */
  async refreshSyncStatus(): Promise<void> {
    console.log('[BackgroundSync] Refreshing sync status from database');
    await this.updateSyncStatusFromDb();
  }

  /**
   * Pause background sync
   * FIXED: Also cleanup connection subscription and rolling timer to prevent memory leak
   */
  pauseSync(): void {
    console.log('[BackgroundSync] Pausing sync');
    if (this.syncInterval) {
      this.syncInterval.unsubscribe();
      this.syncInterval = null;
    }
    // Also cleanup connection subscription
    if (this.connectionSubscription) {
      this.connectionSubscription.unsubscribe();
      this.connectionSubscription = null;
    }
    // Clear rolling sync timer
    if (this.rollingSyncTimer) {
      clearTimeout(this.rollingSyncTimer);
      this.rollingSyncTimer = null;
    }
    // Cleanup sync queue subscription
    if (this.syncQueueSubscription) {
      this.syncQueueSubscription.unsubscribe();
      this.syncQueueSubscription = null;
    }
  }

  /**
   * Resume background sync
   */
  resumeSync(): void {
    console.log('[BackgroundSync] Resuming sync');
    if (!this.syncInterval) {
      this.startBackgroundSync();
    }
  }

  /**
   * Get current sync status
   */
  getSyncStatus(): SyncStatus {
    return this.syncStatus$.value;
  }

  /**
   * Update IndexedDB cache after successful UPDATE sync
   * Fetches fresh data from server to ensure cache has complete record
   */
  private async updateCacheAfterSync(request: PendingRequest, result: any): Promise<void> {
    try {
      // Check endpoint to determine which cache to update
      if (request.endpoint.includes('LPS_Services/records')) {
        // Extract service ID from endpoint (q.where=PK_ID=XXX)
        const match = request.endpoint.match(/PK_ID=(\d+)/);
        if (match) {
          const serviceId = match[1];
          // Fetch complete record from server
          const freshData = await this.caspioService.getService(serviceId).toPromise();
          if (freshData) {
            await this.indexedDb.cacheServiceRecord(serviceId, freshData);
            console.log(`[BackgroundSync] Refreshed service cache for ${serviceId} from server`);

            // Emit event so pages can reload their data
            this.ngZone.run(() => {
              this.serviceDataSyncComplete$.next({ serviceId });
            });
          }
        }
      } else if (request.endpoint.includes('LPS_Projects/records')) {
        // Extract project ID from endpoint (q.where=PK_ID=XXX)
        const match = request.endpoint.match(/PK_ID=(\d+)/);
        if (match) {
          const projectId = match[1];
          // Fetch complete record from server
          const freshData = await this.caspioService.getProject(projectId).toPromise();
          if (freshData) {
            await this.indexedDb.cacheProjectRecord(projectId, freshData);
            console.log(`[BackgroundSync] Refreshed project cache for ${projectId} from server`);

            // Emit event so pages can reload their data
            this.ngZone.run(() => {
              this.serviceDataSyncComplete$.next({ projectId });
            });
          }
        }
      }
    } catch (error) {
      console.warn('[BackgroundSync] Failed to refresh cache after sync:', error);
      // Non-critical - don't throw
    }
  }

  /**
   * Update synced cache with caption/drawings data after successful caption sync
   * CRITICAL: This ensures the cache has the correct data for future page loads
   * Called after caption sync succeeds to persist the synced data in IndexedDB cache
   */
  private async updateSyncedCacheWithCaption(
    caption: { 
      attachId: string; 
      attachType: 'visual' | 'efe_point' | 'fdf';
      caption?: string; 
      drawings?: string;
      visualId?: string;
      pointId?: string;
      serviceId?: string;
    }
  ): Promise<void> {
    try {
      if (caption.attachType === 'visual') {
        let foundInCache = false;
        
        // PRIMARY PATH: Use visualId if available (fast, O(1) lookup)
        if (caption.visualId) {
          const cached = await this.indexedDb.getCachedServiceData(
            caption.visualId, 'visual_attachments'
          ) || [];
          
          const updated = cached.map((att: any) => {
            if (String(att.AttachID) === String(caption.attachId)) {
              foundInCache = true;
              const updatedAtt = { ...att, _syncedAt: Date.now() };
              delete updatedAtt._localUpdate;
              delete updatedAtt._updatedAt;
              if (caption.caption !== undefined) {
                updatedAtt.Annotation = caption.caption;
              }
              if (caption.drawings !== undefined) {
                updatedAtt.Drawings = caption.drawings;
              }
              return updatedAtt;
            }
            return att;
          });
          
          if (foundInCache) {
            await this.indexedDb.cacheServiceData(
              caption.visualId, 'visual_attachments', updated
            );
            console.log(`[BackgroundSync] ✅ Updated synced cache with caption for visual attachment ${caption.attachId}`);
          }
        }
        
        // FALLBACK PATH: Search all visual_attachments caches when visualId is missing
        // This handles the case where visualId wasn't available when caption was queued
        if (!foundInCache && caption.serviceId) {
          console.log(`[BackgroundSync] 🔍 Searching all caches for attachment ${caption.attachId} (visualId was missing)`);
          const allCaches = await this.indexedDb.getAllCachedServiceData('visual_attachments');
          
          for (const cache of allCaches) {
            const attachments = cache.data || [];
            let foundInThisCache = false;
            
            const updatedAttachments = attachments.map((att: any) => {
              if (String(att.AttachID) === String(caption.attachId)) {
                foundInThisCache = true;
                foundInCache = true;
                const updatedAtt = { ...att, _syncedAt: Date.now() };
                delete updatedAtt._localUpdate;
                delete updatedAtt._updatedAt;
                if (caption.caption !== undefined) {
                  updatedAtt.Annotation = caption.caption;
                }
                if (caption.drawings !== undefined) {
                  updatedAtt.Drawings = caption.drawings;
                }
                return updatedAtt;
              }
              return att;
            });
            
            if (foundInThisCache) {
              await this.indexedDb.cacheServiceData(cache.serviceId, 'visual_attachments', updatedAttachments);
              console.log(`[BackgroundSync] ✅ Found and updated attachment ${caption.attachId} in cache ${cache.serviceId} (fallback search)`);
              break; // Found it, no need to continue searching
            }
          }
        }
        
        if (!foundInCache) {
          console.log(`[BackgroundSync] ⚠️ Attachment ${caption.attachId} not in any cache - will be loaded on next page visit`);
        }
      } else if (caption.attachType === 'efe_point') {
        let foundInCache = false;
        
        // PRIMARY PATH: Use pointId if available (fast, O(1) lookup)
        if (caption.pointId) {
          const cached = await this.indexedDb.getCachedServiceData(
            caption.pointId, 'efe_point_attachments'
          ) || [];
          
          const updated = cached.map((att: any) => {
            if (String(att.AttachID) === String(caption.attachId)) {
              foundInCache = true;
              const updatedAtt = { ...att, _syncedAt: Date.now() };
              delete updatedAtt._localUpdate;
              delete updatedAtt._updatedAt;
              if (caption.caption !== undefined) {
                updatedAtt.Annotation = caption.caption;
              }
              if (caption.drawings !== undefined) {
                updatedAtt.Drawings = caption.drawings;
              }
              return updatedAtt;
            }
            return att;
          });
          
          if (foundInCache) {
            await this.indexedDb.cacheServiceData(
              caption.pointId, 'efe_point_attachments', updated
            );
            console.log(`[BackgroundSync] ✅ Updated synced cache with caption for EFE point attachment ${caption.attachId}`);
          }
        }
        
        // FALLBACK PATH: Search all efe_point_attachments caches when pointId is missing
        if (!foundInCache && caption.serviceId) {
          console.log(`[BackgroundSync] 🔍 Searching all EFE caches for attachment ${caption.attachId} (pointId was missing)`);
          const allCaches = await this.indexedDb.getAllCachedServiceData('efe_point_attachments');
          
          for (const cache of allCaches) {
            const attachments = cache.data || [];
            let foundInThisCache = false;
            
            const updatedAttachments = attachments.map((att: any) => {
              if (String(att.AttachID) === String(caption.attachId)) {
                foundInThisCache = true;
                foundInCache = true;
                const updatedAtt = { ...att, _syncedAt: Date.now() };
                delete updatedAtt._localUpdate;
                delete updatedAtt._updatedAt;
                if (caption.caption !== undefined) {
                  updatedAtt.Annotation = caption.caption;
                }
                if (caption.drawings !== undefined) {
                  updatedAtt.Drawings = caption.drawings;
                }
                return updatedAtt;
              }
              return att;
            });
            
            if (foundInThisCache) {
              await this.indexedDb.cacheServiceData(cache.serviceId, 'efe_point_attachments', updatedAttachments);
              console.log(`[BackgroundSync] ✅ Found and updated EFE attachment ${caption.attachId} in cache ${cache.serviceId} (fallback search)`);
              break;
            }
          }
        }
        
        if (!foundInCache) {
          console.log(`[BackgroundSync] ⚠️ EFE Attachment ${caption.attachId} not in any cache - will be loaded on next page visit`);
        }
      }
      // FDF type is handled differently (stored in room record, not attachments)
    } catch (error) {
      console.warn(`[BackgroundSync] ⚠️ Failed to update synced cache with caption:`, error);
      // Non-fatal - the data is synced to server, cache will refresh eventually
    }
  }

  /**
   * Refresh visuals cache from server after sync
   * This ensures the local cache has the latest data including real IDs
   * Also downloads and caches actual images for offline viewing
   */
  private async clearLocalUpdateFlag(dataType: 'visual_attachments' | 'efe_point_attachments', attachId: string): Promise<void> {
    try {
      // We need to find which visualId/pointId this attachment belongs to
      // Search through all cached service data for this attachment
      const allCaches = await this.indexedDb.getAllCachedServiceData(dataType);
      
      for (const cache of allCaches) {
        const attachments = cache.data || [];
        let found = false;
        
        const updatedAttachments = attachments.map((att: any) => {
          if (String(att.AttachID) === String(attachId) && att._localUpdate) {
            found = true;
            // Remove the _localUpdate flag - the data is now synced
            const { _localUpdate, _updatedAt, ...rest } = att;
            return rest;
          }
          return att;
        });
        
        if (found) {
          await this.indexedDb.cacheServiceData(cache.serviceId, dataType, updatedAttachments);
          console.log(`[BackgroundSync] ✅ Cleared _localUpdate flag for AttachID ${attachId} in ${cache.serviceId}`);
          return;
        }
      }
      
      console.log(`[BackgroundSync] AttachID ${attachId} not found in any cache (may already be cleared)`);
    } catch (error) {
      console.warn(`[BackgroundSync] Error clearing _localUpdate flag for AttachID ${attachId}:`, error);
    }
  }
  
  /**
   * Clear the _localUpdate flag from a visual after successful sync
   * This allows future background refreshes to use server data
   */
  private async clearVisualLocalUpdateFlag(visualId: string, serviceId?: string): Promise<void> {
    try {
      // Helper to check if visual matches by PK_ID or VisualID
      const matchesVisual = (v: any) => {
        return (String(v.PK_ID) === String(visualId) || String(v.VisualID) === String(visualId)) && v._localUpdate;
      };
      
      // If we have the serviceId, update directly
      if (serviceId) {
        const visuals = await this.indexedDb.getCachedServiceData(String(serviceId), 'visuals') || [];
        let found = false;
        
        const updatedVisuals = visuals.map((v: any) => {
          if (matchesVisual(v)) {
            found = true;
            // Remove the _localUpdate flag - the data is now synced
            const { _localUpdate, ...rest } = v;
            return rest;
          }
          return v;
        });
        
        if (found) {
          await this.indexedDb.cacheServiceData(String(serviceId), 'visuals', updatedVisuals);
          console.log(`[BackgroundSync] ✅ Cleared _localUpdate flag for VisualID ${visualId} in service ${serviceId}`);
          return;
        }
      }
      
      // Otherwise search all services for this visual
      const allCaches = await this.indexedDb.getAllCachedServiceData('visuals');
      
      for (const cache of allCaches) {
        const visuals = cache.data || [];
        let found = false;
        
        const updatedVisuals = visuals.map((v: any) => {
          if (matchesVisual(v)) {
            found = true;
            const { _localUpdate, ...rest } = v;
            return rest;
          }
          return v;
        });
        
        if (found) {
          await this.indexedDb.cacheServiceData(cache.serviceId, 'visuals', updatedVisuals);
          console.log(`[BackgroundSync] ✅ Cleared _localUpdate flag for VisualID ${visualId} in ${cache.serviceId}`);
          return;
        }
      }
      
      console.log(`[BackgroundSync] VisualID ${visualId} not found in any cache (may already be cleared)`);
    } catch (error) {
      console.warn(`[BackgroundSync] Error clearing _localUpdate flag for VisualID ${visualId}:`, error);
    }
  }
  
  /**
   * Clear the _localUpdate flag from an EFE room after successful sync
   * This allows future background refreshes to use server data for FDF, Location, Notes
   */
  private async clearEFERoomLocalUpdateFlag(efeId: string, serviceId?: string): Promise<void> {
    try {
      // Helper to check if room matches by EFEID or PK_ID
      const matchesRoom = (r: any) => {
        return (String(r.EFEID) === String(efeId) || String(r.PK_ID) === String(efeId)) && r._localUpdate;
      };
      
      // If we have the serviceId, update directly
      if (serviceId) {
        const rooms = await this.indexedDb.getCachedServiceData(String(serviceId), 'efe_rooms') || [];
        let found = false;
        
        const updatedRooms = rooms.map((r: any) => {
          if (matchesRoom(r)) {
            found = true;
            // Remove the _localUpdate flag - the data is now synced
            const { _localUpdate, ...rest } = r;
            return rest;
          }
          return r;
        });
        
        if (found) {
          await this.indexedDb.cacheServiceData(String(serviceId), 'efe_rooms', updatedRooms);
          console.log(`[BackgroundSync] ✅ Cleared _localUpdate flag for EFEID ${efeId} in service ${serviceId}`);
          return;
        }
      }
      
      // Otherwise search all services for this room
      const allCaches = await this.indexedDb.getAllCachedServiceData('efe_rooms');
      
      for (const cache of allCaches) {
        const rooms = cache.data || [];
        let found = false;
        
        const updatedRooms = rooms.map((r: any) => {
          if (matchesRoom(r)) {
            found = true;
            const { _localUpdate, ...rest } = r;
            return rest;
          }
          return r;
        });
        
        if (found) {
          await this.indexedDb.cacheServiceData(cache.serviceId, 'efe_rooms', updatedRooms);
          console.log(`[BackgroundSync] ✅ Cleared _localUpdate flag for EFEID ${efeId} in ${cache.serviceId}`);
          return;
        }
      }
      
      console.log(`[BackgroundSync] EFEID ${efeId} not found in any cache (may already be cleared)`);
    } catch (error) {
      console.warn(`[BackgroundSync] Error clearing _localUpdate flag for EFEID ${efeId}:`, error);
    }
  }
  
  private async refreshVisualsCache(serviceId: string): Promise<void> {
    try {
      console.log(`[BackgroundSync] Refreshing visuals cache for service ${serviceId}...`);
      
      // CRITICAL FIX: Check for pending UPDATE requests BEFORE fetching from server
      // This prevents race conditions where cache refresh overwrites local HIDDEN state
      let pendingVisualUpdates = new Set<string>();
      try {
        const pendingRequests = await this.indexedDb.getPendingRequests();
        pendingVisualUpdates = new Set<string>(
          pendingRequests
            .filter(r => r.type === 'UPDATE' && r.endpoint.includes('LPS_Services_Visuals/records') && !r.endpoint.includes('Attach'))
            .map(r => {
              const match = r.endpoint.match(/VisualID=(\d+)/);
              return match ? match[1] : null;
            })
            .filter((id): id is string => id !== null)
        );
        
        if (pendingVisualUpdates.size > 0) {
          console.log(`[BackgroundSync] Found ${pendingVisualUpdates.size} pending UPDATE requests for visuals:`, [...pendingVisualUpdates]);
        }
      } catch (pendingErr) {
        console.warn('[BackgroundSync] Failed to check pending requests (continuing without):', pendingErr);
      }
      
      // Fetch fresh visuals from server
      const freshVisuals = await this.caspioService.getServicesVisualsByServiceId(serviceId).toPromise();
      
      if (freshVisuals && freshVisuals.length >= 0) {
        // Get existing cached visuals to preserve local updates
        const existingCache = await this.indexedDb.getCachedServiceData(serviceId, 'visuals') || [];
        
        // Build map of locally updated visuals that should NOT be overwritten
        // Include both _localUpdate flagged AND visuals with pending UPDATE requests
        // CRITICAL: Key by BOTH PK_ID and VisualID to ensure matches
        const localUpdates = new Map<string, any>();
        for (const visual of existingCache) {
          const pkId = String(visual.PK_ID || '');
          const vId = String(visual.VisualID || '');
          const tempId = visual._tempId || '';
          
          // Check if has _localUpdate flag OR has pending UPDATE request (by either ID)
          const hasPendingByPkId = pkId && pendingVisualUpdates.has(pkId);
          const hasPendingByVisualId = vId && pendingVisualUpdates.has(vId);
          
          if (visual._localUpdate || hasPendingByPkId || hasPendingByVisualId) {
            // Store by both keys to ensure we find it when merging
            if (pkId) localUpdates.set(pkId, visual);
            if (vId) localUpdates.set(vId, visual);
            if (tempId) localUpdates.set(tempId, visual);
            const reason = visual._localUpdate ? '_localUpdate flag' : 'pending UPDATE request';
            console.log(`[BackgroundSync] Preserving local version PK_ID=${pkId} VisualID=${vId} (${reason}, Notes: ${visual.Notes})`);
          }
        }
        
        // Merge: use local version for items with pending updates, server version for others
        const mergedVisuals = freshVisuals.map((serverVisual: any) => {
          const pkId = String(serverVisual.PK_ID);
          const vId = String(serverVisual.VisualID || serverVisual.PK_ID);
          // Try to find local version by either key
          const localVersion = localUpdates.get(pkId) || localUpdates.get(vId);
          if (localVersion) {
            console.log(`[BackgroundSync] Keeping local version of visual PK_ID=${pkId} with Notes: ${localVersion.Notes}`);
            return localVersion;
          }
          return serverVisual;
        });
        
        // Also add any temp visuals from existing cache
        const tempVisuals = existingCache.filter((v: any) => v._tempId && String(v._tempId).startsWith('temp_'));
        const finalVisuals = [...mergedVisuals, ...tempVisuals];
        
        await this.indexedDb.cacheServiceData(serviceId, 'visuals', finalVisuals);
        console.log(`[BackgroundSync] ✅ Visuals cache refreshed: ${freshVisuals.length} server, ${localUpdates.size} local updates preserved, ${tempVisuals.length} temp for service ${serviceId}`);
        
        // Refresh attachments AND download actual images for each visual
        for (const visual of freshVisuals) {
          const visualId = visual.VisualID || visual.PK_ID;
          if (visualId) {
            try {
              const attachments = await this.caspioService.getServiceVisualsAttachByVisualId(String(visualId)).toPromise();
              await this.indexedDb.cacheServiceData(String(visualId), 'visual_attachments', attachments || []);
              
              // CRITICAL: Also download and cache actual images for offline
              if (attachments && attachments.length > 0) {
                await this.downloadAndCachePhotos(attachments, serviceId);
              }
            } catch (err) {
              console.warn(`[BackgroundSync] Failed to refresh attachments for visual ${visualId}:`, err);
            }
          }
        }
        console.log(`[BackgroundSync] ✅ Visual attachments and images cache refreshed for service ${serviceId}`);
      }
    } catch (error) {
      console.warn(`[BackgroundSync] Failed to refresh visuals cache for ${serviceId}:`, error);
      // Non-critical - don't throw
    }
  }

  /**
   * Download and cache actual photo images as base64 for offline viewing
   */

  /**
   * Cache a single uploaded photo for offline viewing
   * Called after successful photo upload to enable seamless URL transition
   * @param attachId - The real attachment ID from the server
   * @param serviceId - Service ID for grouping
   * @param s3Key - S3 key or Photo URL from upload result
   */
  private async cacheUploadedPhoto(attachId: string, serviceId: string, s3Key: string): Promise<void> {
    if (!attachId || !s3Key) {
      console.warn('[BackgroundSync] Cannot cache photo - missing attachId or s3Key');
      return;
    }

    try {
      // Check if it's an S3 key or already a URL
      let s3Url: string;
      if (this.caspioService.isS3Key(s3Key)) {
        s3Url = await this.caspioService.getS3FileUrl(s3Key);
      } else if (s3Key.startsWith('http')) {
        s3Url = s3Key;
      } else {
        console.warn('[BackgroundSync] Unknown photo format, skipping cache:', s3Key?.substring(0, 50));
        return;
      }

      // Download and convert to base64 using cross-platform XMLHttpRequest
      const base64 = await this.fetchImageAsBase64(s3Url);

      // Cache in IndexedDB
      await this.indexedDb.cachePhoto(attachId, serviceId, base64, s3Key);
      console.log('[BackgroundSync] Cached uploaded photo:', attachId);
    } catch (err: any) {
      console.warn('[BackgroundSync] Failed to cache uploaded photo:', attachId, err?.message || err);
      // Don't throw - the upload was successful, just caching failed
    }
  }

  /**
   * Cache photo from local blob BEFORE it gets pruned
   * This is the CRITICAL step that ensures photos don't disappear after sync
   * 
   * The flow is:
   * 1. Photo captured -> stored in localBlobs (ArrayBuffer)
   * 2. Photo uploads successfully -> we call this method
   * 3. This converts the local blob to base64 and stores in cachedPhotos
   * 4. Later, when blob is pruned, getDisplayUrl() uses cachedPhotos as fallback
   */
  private async cachePhotoFromLocalBlob(
    imageId: string, 
    attachId: string, 
    serviceId: string, 
    s3Key: string
  ): Promise<void> {
    try {
      // Get the LocalImage to find the blobId
      const image = await this.indexedDb.getLocalImage(imageId);
      if (!image || !image.localBlobId) {
        console.warn('[BackgroundSync] Cannot cache from blob - no blobId for image:', imageId);
        return;
      }

      // Get the actual blob data from IndexedDB
      const blob = await this.indexedDb.getLocalBlob(image.localBlobId);
      if (!blob || !blob.data) {
        console.warn('[BackgroundSync] Cannot cache from blob - blob not found:', image.localBlobId);
        return;
      }

      // Convert ArrayBuffer to base64 data URL
      const base64 = await this.arrayBufferToBase64DataUrl(blob.data, blob.contentType || 'image/jpeg');

      // Cache in IndexedDB using attachId (the real Caspio ID)
      await this.indexedDb.cachePhoto(attachId, serviceId, base64, s3Key);
      
      console.log('[BackgroundSync] ✅ Cached photo from local blob:', attachId, 'imageId:', imageId, 'size:', base64.length);
    } catch (err: any) {
      console.error('[BackgroundSync] Failed to cache photo from local blob:', imageId, err?.message || err);
      // Don't throw - we'll fall back to S3 URL if needed
    }
  }

  /**
   * Convert ArrayBuffer to base64 data URL
   * Works in both browser and Capacitor environments
   */
  private arrayBufferToBase64DataUrl(buffer: ArrayBuffer, contentType: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const blob = new Blob([buffer], { type: contentType });
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            resolve(reader.result);
          } else {
            reject(new Error('FileReader did not return string'));
          }
        };
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Download and cache photos for offline viewing
   * Uses XMLHttpRequest for cross-platform compatibility (web + mobile)
   */
  private async downloadAndCachePhotos(attachments: any[], serviceId: string): Promise<void> {
    const isNative = Capacitor.isNativePlatform();
    
    for (const attach of attachments) {
      const attachId = String(attach.AttachID || attach.PK_ID);
      const s3Key = attach.Attachment;
      
      // Skip if no S3 key or already cached
      if (!s3Key || !this.caspioService.isS3Key(s3Key)) {
        continue;
      }

      // Check if already cached
      const existing = await this.indexedDb.getCachedPhoto(attachId);
      if (existing) {
        continue; // Already cached
      }

      try {
        // Get pre-signed URL and download image
        const s3Url = await this.caspioService.getS3FileUrl(s3Key);
        
        // Use XMLHttpRequest for cross-platform compatibility
        const base64 = await this.fetchImageAsBase64(s3Url);
        
        // Cache in IndexedDB
        await this.indexedDb.cachePhoto(attachId, serviceId, base64, s3Key);
        console.log(`[BackgroundSync] Cached image for attachment ${attachId}${isNative ? ' [Mobile]' : ''}`);
      } catch (err: any) {
        console.warn(`[BackgroundSync] Failed to cache image ${attachId}:`, err?.message || err);
      }
    }
  }

  /**
   * Fetch image and convert to base64 data URL
   * Uses XMLHttpRequest which works reliably on both web and mobile (Capacitor)
   */
  private fetchImageAsBase64(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      xhr.timeout = 30000; // 30 second timeout
      
      xhr.onload = () => {
        if (xhr.status === 200) {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('FileReader error'));
          reader.readAsDataURL(xhr.response);
        } else {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      };
      
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.ontimeout = () => reject(new Error('Request timeout'));
      xhr.send();
    });
  }

  /**
   * Force retry all old/stuck pending requests
   * Resets retry count and triggers immediate sync
   * 
   * Call this when user wants to force sync or when app detects stuck requests
   */
  async forceRetryAllStuck(): Promise<number> {
    console.log('[BackgroundSync] Force retrying all stuck requests...');
    
    try {
      // Reset all old pending requests
      const resetCount = await this.indexedDb.forceRetryOldRequests(5); // 5 minutes
      
      if (resetCount > 0) {
        console.log(`[BackgroundSync] Reset ${resetCount} stuck requests, triggering immediate sync`);
        // Trigger immediate sync
        this.triggerSync();
      }
      
      return resetCount;
    } catch (error) {
      console.error('[BackgroundSync] Error forcing retry:', error);
      return 0;
    }
  }

  /**
   * Get diagnostic info about pending sync requests
   * Useful for debugging sync issues
   */
  async getDiagnostics(): Promise<{
    total: number;
    byStatus: { [status: string]: number };
    byType: { [type: string]: number };
    oldestPending: number | null;
    avgRetryCount: number;
    stuckCount: number;
    isSyncing: boolean;
  }> {
    const diagnostics = await this.indexedDb.getSyncDiagnostics();
    return {
      ...diagnostics,
      isSyncing: this.isSyncing
    };
  }

  /**
   * Clear all old/stale requests that are unlikely to ever sync
   * Use with caution - this will delete data
   * 
   * @param olderThanHours - Clear requests older than this many hours (default: 48)
   */
  async clearStaleRequests(olderThanHours: number = 48): Promise<number> {
    console.log(`[BackgroundSync] Clearing stale requests older than ${olderThanHours} hours...`);
    
    const clearedCount = await this.indexedDb.clearStaleRequests(olderThanHours);
    console.log(`[BackgroundSync] Cleared ${clearedCount} stale requests`);
    
    return clearedCount;
  }

  // ============================================================================
  // STORAGE CLEANUP
  // ============================================================================

  // ============================================================================
  // NEW LOCAL-FIRST IMAGE UPLOAD PROCESSING
  // ============================================================================

  /**
   * TASK 2 FIX: Reset deferred photos whose dependencies are now resolved
   * Photos with temp entityIds that were deferred get reset to be processed immediately
   * when their parent entity (room, point) has synced and has a real ID
   */
  private async resetDeferredPhotosWithResolvedDependencies(): Promise<number> {
    if (!this.indexedDb.hasNewImageSystem()) {
      return 0;
    }

    const allItems = await this.indexedDb.getAllUploadOutboxItems();
    const now = Date.now();
    let resetCount = 0;

    for (const item of allItems) {
      // Skip items that are already ready
      if (item.nextRetryAt <= now) {
        continue;
      }

      const image = await this.indexedDb.getLocalImage(item.imageId);
      if (!image) continue;

      // Check if this photo was deferred due to temp entityId
      // BUGFIX: Convert entityId to string to handle numeric IDs from database
      if (String(image.entityId).startsWith('temp_')) {
        const realId = await this.indexedDb.getRealId(image.entityId);
        if (realId) {
          // Dependency resolved! Reset nextRetryAt to process immediately
          await this.indexedDb.updateOutboxItem(item.opId, {
            nextRetryAt: now
          });
          console.log(`[BackgroundSync] Reset deferred photo ${item.imageId} - dependency resolved: ${image.entityId} -> ${realId}`);
          resetCount++;
        }
      }
    }

    if (resetCount > 0) {
      console.log(`[BackgroundSync] Reset ${resetCount} deferred photos with resolved dependencies`);
    }

    return resetCount;
  }

  /**
   * Process upload outbox - new local-first image system
   *
   * Key features:
   * - Stable imageId never changes
   * - Local blob preserved until remote is VERIFIED
   * - Status state machine: local_only -> queued -> uploading -> uploaded -> verified
   */
  private async processUploadOutbox(): Promise<void> {
    // Check if new system is available
    if (!this.indexedDb.hasNewImageSystem()) {
      console.log('[BackgroundSync] Upload outbox: new image system not available');
      return;
    }

    // TASK 2 FIX: Reset any deferred photos whose dependencies (rooms/points) have now synced
    // This ensures photos don't stay stuck in deferred state after their parent entity syncs
    await this.resetDeferredPhotosWithResolvedDependencies();

    // TASK 2 FIX: Log all outbox items for debugging
    const allItems = await this.indexedDb.getAllUploadOutboxItems();
    const readyItems = await this.localImageService.getReadyUploads();

    if (allItems.length > 0) {
      console.log(`[BackgroundSync] Upload outbox: ${allItems.length} total, ${readyItems.length} ready`);
      // Log details for items that aren't ready
      const notReadyItems = allItems.filter(a => !readyItems.some(r => r.opId === a.opId));
      for (const item of notReadyItems) {
        const image = await this.indexedDb.getLocalImage(item.imageId);
        console.log(`[BackgroundSync]   NOT READY: ${item.opId}, type: ${image?.entityType || 'unknown'}, nextRetry: ${new Date(item.nextRetryAt).toISOString()}, attempts: ${item.attempts}, error: ${item.lastError || 'none'}`);
      }
    }

    if (readyItems.length === 0) {
      return;
    }

    console.log(`[BackgroundSync] Processing ${readyItems.length} upload outbox items`);

    for (const item of readyItems) {
      try {
        await this.processUploadOutboxItem(item);
      } catch (err: any) {
        console.error('[BackgroundSync] Upload outbox item failed:', item.opId, err);
        await this.localImageService.handleUploadFailure(
          item.opId, 
          item.imageId, 
          err?.message || 'Unknown error'
        );
      }
    }
  }

  /**
   * Process a single upload outbox item
   */
  private async processUploadOutboxItem(item: UploadOutboxItem): Promise<void> {
    const image = await this.indexedDb.getLocalImage(item.imageId);
    if (!image) {
      console.warn('[BackgroundSync] Image not found for outbox item:', item.imageId);
      await this.indexedDb.removeOutboxItem(item.opId);
      return;
    }

    // Get the blob data
    if (!image.localBlobId) {
      console.warn('[BackgroundSync] No local blob for image:', item.imageId);
      await this.indexedDb.removeOutboxItem(item.opId);
      // Mark image as failed so it doesn't show as stuck
      await this.localImageService.markFailed(item.imageId, 'No local blob data');
      return;
    }

    const blob = await this.indexedDb.getLocalBlob(image.localBlobId);
    if (!blob) {
      console.warn('[BackgroundSync] Blob not found:', image.localBlobId);
      await this.indexedDb.removeOutboxItem(item.opId);
      // Mark image as failed so it doesn't show as stuck
      await this.localImageService.markFailed(item.imageId, 'Blob data not found');
      return;
    }

    console.log('[BackgroundSync] Uploading image:', item.imageId, 'type:', image.entityType, 'entityId:', image.entityId, 'photoType:', image.photoType);

    // Resolve temp entityId if needed BEFORE marking as uploading
    // This prevents items from getting stuck in 'uploading' status when deferred
    // BUGFIX: Convert entityId to string to handle numeric IDs from database
    let entityId = String(image.entityId);
    if (entityId.startsWith('temp_')) {
      const realId = await this.indexedDb.getRealId(entityId);
      if (!realId) {
        // Parent entity not synced yet - delay and retry later (don't throw)
        // Track the dependency wait with error message so it's visible in failed tab
        const dependencyError = `Waiting for parent entity sync (entity: ${entityId})`;
        console.log(`[BackgroundSync] Entity not synced yet, delaying photo: ${item.imageId} (entity: ${entityId})`);
        await this.indexedDb.updateOutboxItem(item.opId, {
          nextRetryAt: Date.now() + 30000,  // Retry in 30 seconds
          lastError: dependencyError
        });
        // Update local image with dependency error so it's visible
        await this.localImageService.updateStatus(item.imageId, 'queued', { lastError: dependencyError });
        // Keep status as 'queued' (don't mark as uploading yet)
        return;  // Skip for now, will retry on next sync cycle
      }
      entityId = realId;
      // Update image with resolved entityId
      await this.indexedDb.updateLocalImage(item.imageId, { entityId: realId });
    }

    // Mark as uploading ONLY after we've confirmed we can proceed
    await this.localImageService.markUploadStarted(item.opId, item.imageId);

    // Convert ArrayBuffer back to File
    const file = new File(
      [blob.data], 
      image.fileName, 
      { type: blob.contentType || 'image/jpeg' }
    );

    // Upload based on entity type
    let result: any;
    switch (image.entityType) {
      case 'visual':
        result = await this.caspioService.uploadVisualsAttachWithS3(
          parseInt(entityId),
          image.drawings || '',
          file,
          image.caption || ''
        );
        break;
      case 'efe_point':
        result = await this.caspioService.uploadEFEPointsAttachWithS3(
          parseInt(entityId),
          image.drawings || '',
          file,
          image.photoType || 'Measurement', // Use stored photoType (Measurement/Location)
          image.caption || ''
        );
        break;
      case 'fdf':
        // FDF photos are stored on the EFE room record itself, not as attachments
        // photoType is stored in image.photoType (e.g., 'Top', 'Bottom', 'Threshold')
        console.log('[BackgroundSync] FDF photo upload starting:', item.imageId, 'roomId:', entityId, 'photoType:', image.photoType);
        result = await this.uploadFDFPhoto(entityId, file, image.photoType || 'Top');
        console.log('[BackgroundSync] FDF photo upload completed:', item.imageId, 'result:', result);
        break;
      // Add more entity types as needed
      default:
        throw new Error(`Unsupported entity type: ${image.entityType}`);
    }

    // Extract results
    const attachId = String(result.AttachID || result.attachId || result.Result?.[0]?.AttachID);
    const s3Key = result.Attachment || result.s3Key || result.Result?.[0]?.Attachment;

    if (!attachId || !s3Key) {
      throw new Error('Upload response missing AttachID or s3Key');
    }

    console.log('[BackgroundSync] ✅ Upload success:', item.imageId, 'attachId:', attachId, 's3Key:', s3Key?.substring(0, 50));

    // Mark as uploaded (NOT verified yet)
    await this.localImageService.handleUploadSuccess(item.opId, item.imageId, s3Key, attachId);

    // CRITICAL: Cache the photo from local blob BEFORE it can be pruned
    // This ensures we have a base64 fallback even after the blob is deleted
    await this.cachePhotoFromLocalBlob(item.imageId, attachId, image.serviceId, s3Key);

    // Verify remote is loadable (async, non-blocking)
    this.verifyAndMarkImage(item.imageId).catch(err => {
      console.warn('[BackgroundSync] Verification failed (will retry):', item.imageId, err);
    });

    // Emit legacy event for backward compatibility
    if (image.entityType === 'visual') {
      this.ngZone.run(() => {
        this.photoUploadComplete$.next({
          tempFileId: item.imageId,
          tempVisualId: image.entityId,
          realVisualId: parseInt(entityId),
          result
        });
      });
    } else if (image.entityType === 'efe_point') {
      this.ngZone.run(() => {
        this.efePhotoUploadComplete$.next({
          tempFileId: item.imageId,
          tempPointId: image.entityId,
          realPointId: parseInt(entityId),
          result
        });
      });
    }

    // Mark sections dirty
    if (image.serviceId) {
      this.markAllSectionsDirty(image.serviceId);
    }
  }

  /**
   * Upload FDF photo to S3 and update EFE room record
   * FDF photos are stored as fields on the room record, not as separate attachments
   */
  private async uploadFDFPhoto(roomId: string, file: File, photoType: string): Promise<any> {
    console.log('[BackgroundSync] Uploading FDF photo:', photoType, 'for room:', roomId);
    
    // Generate unique filename for S3
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 8);
    const fileExt = file.name.split('.').pop() || 'jpg';
    const uniqueFilename = `fdf_${photoType.toLowerCase()}_${roomId}_${timestamp}_${randomId}.${fileExt}`;

    // Upload to S3 via API Gateway
    const formData = new FormData();
    formData.append('file', file, uniqueFilename);
    formData.append('tableName', 'LPS_Services_EFE');
    formData.append('attachId', roomId);

    const uploadUrl = `${environment.apiGatewayUrl}/api/s3/upload`;
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      body: formData
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error('Failed to upload FDF file to S3: ' + errorText);
    }

    const uploadResult = await uploadResponse.json();
    const s3Key = uploadResult.s3Key;
    console.log('[BackgroundSync] FDF photo uploaded to S3:', s3Key);

    // Update the room record with S3 key in the appropriate column
    // photoType is 'Top', 'Bottom', or 'Threshold'
    const attachmentColumnName = `FDFPhoto${photoType}Attachment`;
    const updateData: any = {};
    updateData[attachmentColumnName] = s3Key;

    await firstValueFrom(this.caspioService.updateServicesEFEByEFEID(roomId, updateData));
    console.log('[BackgroundSync] Updated EFE room record with', attachmentColumnName);

    return {
      AttachID: `fdf_${roomId}_${photoType.toLowerCase()}`,
      Attachment: s3Key,
      s3Key: s3Key
    };
  }

  /**
   * Verify remote image is loadable and mark as verified
   */
  private async verifyAndMarkImage(imageId: string): Promise<void> {
    const verified = await this.localImageService.verifyRemoteImage(imageId);
    
    if (verified) {
      console.log('[BackgroundSync] ✅ Remote verified:', imageId);
    } else {
      console.warn('[BackgroundSync] ⚠️ Remote not verified yet:', imageId);
      // Will be retried on next sync or when UI loads
    }
  }

  // ============================================================================
  // LOCAL BLOB PRUNING
  // ============================================================================

  /**
   * Prune local blobs for verified images
   * Only prunes when:
   * - Image status is 'verified'
   * - Remote has been successfully loaded in UI at least once
   * - OR image is older than 24 hours (grace period for UI to load)
   * - AND a cached base64 exists (or we create one first)
   */
  private async pruneVerifiedBlobs(): Promise<void> {
    if (!this.indexedDb.hasNewImageSystem()) {
      return;
    }

    try {
      // Get all local images
      const allImages = await this.getAllLocalImages();
      const now = Date.now();
      const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours
      
      let prunedCount = 0;
      let cachedBeforePrune = 0;
      
      for (const image of allImages) {
        // Skip if not verified
        if (image.status !== 'verified') {
          continue;
        }
        
        // Skip if no local blob
        if (!image.localBlobId) {
          continue;
        }
        
        // Check if safe to prune
        const isPastGracePeriod = (now - image.createdAt) > GRACE_PERIOD_MS;
        const hasLoadedInUI = image.remoteLoadedInUI;
        
        if (hasLoadedInUI || isPastGracePeriod) {
          try {
            // DEFENSIVE CHECK: Before pruning, ensure we have a cached photo fallback
            if (image.attachId) {
              const cachedPhoto = await this.indexedDb.getCachedPhoto(String(image.attachId));
              if (!cachedPhoto) {
                // No cached photo exists - create one from the local blob before pruning
                console.log('[BackgroundSync] No cached photo found, creating from blob before pruning:', image.imageId);
                await this.cachePhotoFromLocalBlob(
                  image.imageId, 
                  String(image.attachId), 
                  image.serviceId, 
                  image.remoteS3Key || ''
                );
                cachedBeforePrune++;
              }
            }
            
            await this.localImageService.pruneLocalBlob(image.imageId);
            prunedCount++;
          } catch (err) {
            console.warn('[BackgroundSync] Failed to prune blob:', image.imageId, err);
          }
        }
      }
      
      if (prunedCount > 0 || cachedBeforePrune > 0) {
        console.log(`[BackgroundSync] ✅ Pruned ${prunedCount} verified local blobs (cached ${cachedBeforePrune} first)`);
      }
    } catch (err) {
      console.warn('[BackgroundSync] Blob pruning error:', err);
    }
  }

  /**
   * Get all local images (helper for pruning)
   */
  private async getAllLocalImages(): Promise<LocalImage[]> {
    if (!this.indexedDb.hasNewImageSystem()) {
      return [];
    }
    
    // Get all services and aggregate images
    const activeServiceIds = await this.getActiveServiceIds();
    const allImages: LocalImage[] = [];
    
    for (const serviceId of activeServiceIds) {
      const images = await this.indexedDb.getLocalImagesForService(serviceId);
      allImages.push(...images);
    }
    
    return allImages;
  }

  // ============================================================================
  // STORAGE CLEANUP
  // ============================================================================

  /**
   * Perform storage cleanup after sync cycle
   * Only runs if storage usage exceeds threshold
   * Deletes old cached photos that aren't in active services
   */
  private async performStorageCleanup(): Promise<void> {
    // First, prune verified local blobs using standard retention policy
    await this.pruneVerifiedBlobs();
    
    try {
      // ============================================================================
      // STORAGE PRESSURE PRUNING (Requirement F)
      // If usage/quota > 75%, prune oldest verified blobs using LRU by updatedAt
      // ============================================================================
      
      let usagePercent = 0;
      
      // Use navigator.storage.estimate() for accurate storage measurement
      if ('storage' in navigator && 'estimate' in (navigator as any).storage) {
        try {
          const estimate = await (navigator as any).storage.estimate();
          usagePercent = ((estimate.usage || 0) / (estimate.quota || 1)) * 100;
          console.log(`[BackgroundSync] Storage: ${(estimate.usage / (1024 * 1024)).toFixed(1)}MB / ${(estimate.quota / (1024 * 1024)).toFixed(1)}MB (${usagePercent.toFixed(1)}%)`);
        } catch (estimateErr) {
          console.warn('[BackgroundSync] navigator.storage.estimate() failed, using fallback');
          const stats = await this.indexedDb.getStorageStats();
          usagePercent = stats.percent;
        }
      } else {
        // Fallback for browsers without navigator.storage
        const stats = await this.indexedDb.getStorageStats();
        usagePercent = stats.percent;
      }
      
      // Check if storage pressure requires aggressive pruning
      if (usagePercent > 75) {
        console.log(`[BackgroundSync] ⚠️ Storage pressure: ${usagePercent.toFixed(1)}% - starting aggressive LRU pruning`);
        
        // Get verified images ordered by updatedAt (oldest first for LRU)
        const verifiedImages = await this.indexedDb.getVerifiedImagesOrderedByAge();
        console.log(`[BackgroundSync] Found ${verifiedImages.length} verified images with local blobs eligible for pruning`);
        
        let prunedCount = 0;
        
        // Prune oldest verified images until storage is under 70%
        for (const image of verifiedImages) {
          if (image.localBlobId && image.remoteLoadedInUI) {
            // DEFENSIVE CHECK: Ensure cached photo exists before pruning
            if (image.attachId) {
              const cachedPhoto = await this.indexedDb.getCachedPhoto(String(image.attachId));
              if (!cachedPhoto) {
                // Create cached photo from blob before pruning
                await this.cachePhotoFromLocalBlob(
                  image.imageId, 
                  String(image.attachId), 
                  image.serviceId, 
                  image.remoteS3Key || ''
                );
              }
            }
            
            await this.localImageService.pruneLocalBlob(image.imageId);
            prunedCount++;
            
            // Re-check storage every 5 images to avoid over-pruning
            if (prunedCount % 5 === 0) {
              if ('storage' in navigator && 'estimate' in (navigator as any).storage) {
                const newEstimate = await (navigator as any).storage.estimate();
                const newPercent = ((newEstimate.usage || 0) / (newEstimate.quota || 1)) * 100;
                
                if (newPercent < 70) {
                  console.log(`[BackgroundSync] Storage now at ${newPercent.toFixed(1)}%, stopping pruning`);
                  break;
                }
              }
            }
          }
        }
        
        if (prunedCount > 0) {
          console.log(`[BackgroundSync] ✅ Pruned ${prunedCount} verified blobs due to storage pressure`);
        }
      }
      
      // Also prune verified blobs older than 72h for non-active jobs (retention policy)
      await this.pruneOldVerifiedBlobs(72 * 60 * 60 * 1000);
      
      // Legacy cleanup: Get active service IDs and clean old cached photos
      if (usagePercent > 70) {
        const activeServiceIds = await this.getActiveServiceIds();
        const deleted = await this.indexedDb.cleanupOldCachedPhotos(activeServiceIds, 30);
        
        if (deleted > 0) {
          console.log(`[BackgroundSync] Cleanup complete: deleted ${deleted} old cached photos`);
        }
      }
    } catch (err) {
      console.warn('[BackgroundSync] Storage cleanup error:', err);
    }
  }
  
  /**
   * Prune verified blobs older than retention period (Requirement F)
   */
  private async pruneOldVerifiedBlobs(retentionMs: number): Promise<void> {
    try {
      const verifiedImages = await this.indexedDb.getVerifiedImagesOrderedByAge();
      const cutoffTime = Date.now() - retentionMs;
      let prunedCount = 0;
      
      for (const image of verifiedImages) {
        // Only prune if older than retention period and remote has been loaded
        if (image.updatedAt < cutoffTime && image.localBlobId && image.remoteLoadedInUI) {
          // DEFENSIVE CHECK: Ensure cached photo exists before pruning
          if (image.attachId) {
            const cachedPhoto = await this.indexedDb.getCachedPhoto(String(image.attachId));
            if (!cachedPhoto) {
              // Create cached photo from blob before pruning
              await this.cachePhotoFromLocalBlob(
                image.imageId, 
                String(image.attachId), 
                image.serviceId, 
                image.remoteS3Key || ''
              );
            }
          }
          
          await this.localImageService.pruneLocalBlob(image.imageId);
          prunedCount++;
        }
      }
      
      if (prunedCount > 0) {
        console.log(`[BackgroundSync] Pruned ${prunedCount} verified blobs older than ${retentionMs / (60 * 60 * 1000)}h`);
      }
    } catch (err) {
      console.warn('[BackgroundSync] Error pruning old verified blobs:', err);
    }
  }

  /**
   * Get list of active service IDs to preserve during cleanup
   * Returns service IDs from recently accessed cached data
   */
  private async getActiveServiceIds(): Promise<string[]> {
    const serviceIds = new Set<string>();
    
    try {
      // Get service IDs from cached visuals data (last accessed services)
      const cachedVisuals = await this.indexedDb.getAllCachedServiceData('visuals');
      for (const data of cachedVisuals) {
        if (data.serviceId) {
          serviceIds.add(String(data.serviceId));
        }
      }
      
      // Also check visual attachments
      const cachedAttachments = await this.indexedDb.getAllCachedServiceData('visual_attachments');
      for (const data of cachedAttachments) {
        if (data.serviceId) {
          serviceIds.add(String(data.serviceId));
        }
      }
      
      // Also check pending requests for service IDs
      const pendingRequests = await this.indexedDb.getPendingRequests();
      for (const req of pendingRequests) {
        if (req.data?.serviceId) {
          serviceIds.add(String(req.data.serviceId));
        }
      }
      
      console.log(`[BackgroundSync] Found ${serviceIds.size} active service IDs`);
    } catch (err) {
      console.warn('[BackgroundSync] Error getting active service IDs:', err);
    }
    
    return Array.from(serviceIds);
  }

  /**
   * Force storage cleanup regardless of quota threshold
   * Use for manual cleanup or when user reports storage issues
   */
  async forceStorageCleanup(): Promise<{deleted: number, newPercent: number}> {
    console.log('[BackgroundSync] Forcing storage cleanup...');
    
    const activeServiceIds = await this.getActiveServiceIds();
    const deleted = await this.indexedDb.cleanupOldCachedPhotos(activeServiceIds, 7); // More aggressive: 7 days
    
    const newStats = await this.indexedDb.getStorageStats();
    
    console.log(`[BackgroundSync] Force cleanup complete: deleted ${deleted} photos, storage at ${newStats.percent.toFixed(1)}%`);
    
    return {
      deleted,
      newPercent: newStats.percent
    };
  }

  /**
   * Clean up on destroy
   */
  ngOnDestroy(): void {
    if (this.syncInterval) {
      this.syncInterval.unsubscribe();
    }
  }
}

