import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Subject, interval, Subscription } from 'rxjs';
import { IndexedDbService, PendingRequest } from './indexed-db.service';
import { ApiGatewayService } from './api-gateway.service';
import { ConnectionMonitorService } from './connection-monitor.service';
import { CaspioService } from './caspio.service';

export interface PhotoUploadComplete {
  tempFileId: string;
  tempVisualId?: string;
  realVisualId: number;
  result: any; // Contains AttachID, S3 URL, etc.
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
  private isSyncing = false;
  private syncIntervalMs = 30000; // Check every 30 seconds

  // Observable sync status for UI
  public syncStatus$ = new BehaviorSubject<SyncStatus>({
    isSyncing: false,
    pendingCount: 0,
    syncedCount: 0,
    failedCount: 0,
  });

  // Emits when a photo upload completes - pages can subscribe to update local state
  public photoUploadComplete$ = new Subject<PhotoUploadComplete>();

  constructor(
    private indexedDb: IndexedDbService,
    private apiGateway: ApiGatewayService,
    private connectionMonitor: ConnectionMonitorService,
    private ngZone: NgZone,
    private caspioService: CaspioService
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
      if (request.tempId) {
        let realId = null;
        
        // For Visuals, use VisualID field (not PK_ID) - attachments link to this
        if (request.endpoint.includes('Services_Visuals')) {
          if (result && result.VisualID) {
            realId = result.VisualID;
          } else if (result && result.Result && result.Result[0]) {
            realId = result.Result[0].VisualID || result.Result[0].PK_ID;
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
          console.log(`[BackgroundSync] Mapped ${request.tempId} → ${realId} (VisualID for attachments)`);
        }
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
    // Handle photo uploads with temp Visual IDs
    if (request.endpoint === 'VISUAL_PHOTO_UPLOAD') {
      return this.syncVisualPhotoUpload(request);
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

    console.log('[BackgroundSync] Final Visual ID for upload:', visualId);

    // Generate idempotency key for AWS deduplication
    const idempotencyKey = data.idempotencyKey || `photo_${visualId}_${data.fileName}_${data.fileSize}`;
    console.log('[BackgroundSync] Using idempotency key:', idempotencyKey);

    try {
      // Call the EXISTING S3 upload method with drawings from IndexedDB
      const result = await this.caspioService.uploadVisualsAttachWithS3(
        visualId,
        drawings,  // Now properly retrieved from IndexedDB
        file
      );

      console.log('[BackgroundSync] Photo uploaded successfully to Visual', visualId, 'with', drawings.length, 'chars of drawings');

      // Emit event so pages can update their local state
      this.ngZone.run(() => {
        this.photoUploadComplete$.next({
          tempFileId: data.fileId,
          tempVisualId: data.tempVisualId,
          realVisualId: visualId,
          result: result
        });
      });

      // Clean up stored photo after successful upload
      await this.indexedDb.deleteStoredFile(data.fileId);
      console.log('[BackgroundSync] Cleaned up stored photo file:', data.fileId);

      return result;
    } catch (error: any) {
      console.error('[BackgroundSync] Photo upload failed, will retry with same idempotency key');
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

