import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, interval, Subscription } from 'rxjs';
import { IndexedDbService, PendingRequest } from './indexed-db.service';
import { ApiGatewayService } from './api-gateway.service';
import { ConnectionMonitorService } from './connection-monitor.service';

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
  private isSyncing = false;
  private syncIntervalMs = 30000; // Check every 30 seconds

  // Observable sync status for UI
  public syncStatus$ = new BehaviorSubject<SyncStatus>({
    isSyncing: false,
    pendingCount: 0,
    syncedCount: 0,
    failedCount: 0,
  });

  constructor(
    private indexedDb: IndexedDbService,
    private apiGateway: ApiGatewayService,
    private connectionMonitor: ConnectionMonitorService,
    private ngZone: NgZone
  ) {
    this.startBackgroundSync();
    this.listenToConnectionChanges();
  }

  /**
   * Start the background sync loop
   */
  private startBackgroundSync(): void {
    console.log('[BackgroundSync] Starting background sync service');

    // Run outside Angular zone to prevent unnecessary change detection
    this.ngZone.runOutsideAngular(() => {
      // Sync immediately on start
      this.triggerSync();

      // Then sync every 30 seconds
      this.syncInterval = interval(this.syncIntervalMs).subscribe(() => {
        this.triggerSync();
      });
    });
  }

  /**
   * Listen for connection changes and trigger sync when back online
   */
  private listenToConnectionChanges(): void {
    this.connectionMonitor.getHealth().subscribe(health => {
      if (health.isOnline && !this.isSyncing) {
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
      await this.syncPendingRequests();
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

        // If this created a new record, store ID mapping
        if (request.tempId && result && result.PK_ID) {
          await this.indexedDb.mapTempId(
            request.tempId,
            result.PK_ID.toString(),
            this.getTempIdType(request.tempId)
          );
        }

        // Mark as synced
        await this.indexedDb.updateRequestStatus(request.requestId, 'synced');
        console.log(`[BackgroundSync] ✅ Synced: ${request.requestId}`);

      } catch (error: any) {
        // Increment retry count
        await this.indexedDb.incrementRetryCount(request.requestId);
        
        // Update status back to pending (will retry later)
        await this.indexedDb.updateRequestStatus(
          request.requestId,
          'pending',
          error.message || 'Sync failed'
        );

        console.warn(`[BackgroundSync] ❌ Failed (will retry): ${request.requestId}`, error);
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
   * Resolve temporary IDs to real IDs in request data
   */
  private async resolveTempIds(request: PendingRequest): Promise<PendingRequest> {
    const data = { ...request.data };

    // Check common foreign key fields for temp IDs
    const foreignKeyFields = [
      'VisualID', 'EFEID', 'ProjectID', 'ServiceID', 
      'PointID', 'HUDID', 'LBWID', 'ParentID'
    ];

    for (const field of foreignKeyFields) {
      if (data[field] && typeof data[field] === 'string' && data[field].startsWith('temp_')) {
        const realId = await this.indexedDb.getRealId(data[field]);
        if (realId) {
          data[field] = realId;
          console.log(`[BackgroundSync] Resolved ${field}: ${data[field]} → ${realId}`);
        }
      }
    }

    return { ...request, data };
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
    this.updateSyncStatus({
      isSyncing: false,
      pendingCount: stats.pending,
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
   * Pause background sync
   */
  pauseSync(): void {
    console.log('[BackgroundSync] Pausing sync');
    if (this.syncInterval) {
      this.syncInterval.unsubscribe();
      this.syncInterval = null;
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
   * Clean up on destroy
   */
  ngOnDestroy(): void {
    if (this.syncInterval) {
      this.syncInterval.unsubscribe();
    }
  }
}

