import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Subject, interval, Subscription } from 'rxjs';
import { Capacitor } from '@capacitor/core';
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

    // Reset any stuck 'syncing' requests to 'pending' on startup
    // This handles cases where the app was closed during a sync
    this.resetStuckSyncingRequests();

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
   * Reset any stuck 'syncing' requests to 'pending' on startup
   * This handles cases where the app was closed during a sync
   */
  private async resetStuckSyncingRequests(): Promise<void> {
    try {
      const allRequests = await this.indexedDb.getAllRequests();
      const stuckSyncing = allRequests.filter(r => r.status === 'syncing');
      
      if (stuckSyncing.length > 0) {
        console.log(`[BackgroundSync] Found ${stuckSyncing.length} stuck 'syncing' requests, resetting to 'pending'`);
        for (const request of stuckSyncing) {
          await this.indexedDb.updateRequestStatus(request.requestId, 'pending');
        }
      }
      
      // Also clean up any old 'synced' requests that weren't deleted
      const syncedRequests = allRequests.filter(r => r.status === 'synced');
      if (syncedRequests.length > 0) {
        console.log(`[BackgroundSync] Found ${syncedRequests.length} old 'synced' requests, cleaning up`);
        for (const request of syncedRequests) {
          await this.indexedDb.removePendingRequest(request.requestId);
        }
      }
    } catch (error) {
      console.warn('[BackgroundSync] Error resetting stuck requests:', error);
    }
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
      // CRITICAL: Process pending caption updates independently from photo uploads
      await this.syncPendingCaptions();
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
          console.log(`[BackgroundSync] ⏳ Dependency pending for ${request.requestId}: ${errorMessage}`);
          await this.indexedDb.updateRequestStatus(request.requestId, 'pending', errorMessage);
        } else {
          // Real failure - increment retry count for exponential backoff
          await this.indexedDb.incrementRetryCount(request.requestId);
          await this.indexedDb.updateRequestStatus(request.requestId, 'pending', errorMessage);
          console.warn(`[BackgroundSync] ❌ Failed (will retry): ${request.requestId}`, error);
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
    const pendingCaptions = await this.indexedDb.getPendingCaptions();
    
    if (pendingCaptions.length === 0) {
      return;
    }
    
    console.log(`[BackgroundSync] Processing ${pendingCaptions.length} pending caption updates`);
    
    for (const caption of pendingCaptions) {
      try {
        // Mark as syncing
        await this.indexedDb.updateCaptionStatus(caption.captionId, 'syncing');
        
        // Check if attachId is still a temp ID
        let resolvedAttachId = caption.attachId;
        if (caption.attachId.startsWith('temp_')) {
          const realId = await this.indexedDb.getRealId(caption.attachId);
          if (!realId) {
            console.log(`[BackgroundSync] Caption ${caption.captionId} waiting for photo sync (${caption.attachId})`);
            await this.indexedDb.updateCaptionStatus(caption.captionId, 'pending');
            continue; // Photo not synced yet, skip for now
          }
          resolvedAttachId = realId;
          console.log(`[BackgroundSync] Resolved caption attachId: ${caption.attachId} → ${realId}`);
        }
        
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
            // Skip for now - handled differently
            console.log(`[BackgroundSync] FDF caption updates handled separately`);
            await this.indexedDb.deletePendingCaption(caption.captionId);
            continue;
          default:
            console.warn(`[BackgroundSync] Unknown caption type: ${caption.attachType}`);
            await this.indexedDb.updateCaptionStatus(caption.captionId, 'failed', 'Unknown type');
            continue;
        }
        
        // Perform the API update
        console.log(`[BackgroundSync] Syncing caption for ${caption.attachType} AttachID=${resolvedAttachId}`);
        await this.apiGateway.put(endpoint, updateData).toPromise();
        
        console.log(`[BackgroundSync] ✅ Caption synced: ${caption.captionId}`);
        
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
        
        // Clean up - delete the pending caption from queue
        await this.indexedDb.deletePendingCaption(caption.captionId);
        
        // Emit event for pages to update UI
        this.ngZone.run(() => {
          this.captionSyncComplete$.next({
            attachId: resolvedAttachId,
            attachType: caption.attachType,
            captionId: caption.captionId
          });
        });
        
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
      // This enables seamless URL transition from blob URL to cached base64
      try {
        if (result.s3Key || result.Photo) {
          await this.cacheUploadedPhoto(
            result.AttachID || result.attachId,
            data.serviceId || '',
            result.s3Key || result.Photo
          );
          console.log('[BackgroundSync] ✅ Cached uploaded photo for offline viewing');
        }
      } catch (cacheErr) {
        console.warn('[BackgroundSync] Failed to cache uploaded photo:', cacheErr);
        // Continue anyway - photo was uploaded successfully
      }

      // STEP 3: Update any pending caption updates with the real AttachID
      // This handles the case where user added caption while photo was still uploading
      const realAttachId = result.AttachID || result.attachId;
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

      // STEP 5: Clean up stored photo after successful upload and caching
      await this.indexedDb.deleteStoredFile(data.fileId);
      console.log('[BackgroundSync] Cleaned up stored photo file:', data.fileId);

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
      try {
        if (result.s3Key || result.Photo) {
          await this.cacheUploadedPhoto(
            result.AttachID || result.attachId,
            data.serviceId || '',
            result.s3Key || result.Photo
          );
          console.log('[BackgroundSync] ✅ Cached EFE photo for offline viewing');
        }
      } catch (cacheErr) {
        console.warn('[BackgroundSync] Failed to cache EFE photo:', cacheErr);
        // Continue anyway - photo was uploaded successfully
      }

      // STEP 3: Update any pending caption updates with the real AttachID
      // This handles the case where user added caption while photo was still uploading
      const realAttachId = result.AttachID || result.attachId;
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

      // STEP 5: Clean up stored photo
      await this.indexedDb.deleteStoredFile(data.fileId);
      console.log('[BackgroundSync] Cleaned up EFE photo file:', data.fileId);

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
   * Resolve temporary IDs to real IDs in request data
   */
  private async resolveTempIds(request: PendingRequest): Promise<PendingRequest> {
    const data = { ...request.data };

    // Check common foreign key fields for temp IDs
    // Include both standard fields and custom field names used for offline queuing
    const foreignKeyFields = [
      'VisualID', 'EFEID', 'ProjectID', 'ServiceID', 
      'PointID', 'HUDID', 'LBWID', 'ParentID',
      'tempVisualId', 'tempPointId', 'tempRoomId'  // Custom fields used for offline photo uploads
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
      if (caption.attachType === 'visual' && caption.visualId) {
        const cached = await this.indexedDb.getCachedServiceData(
          caption.visualId, 'visual_attachments'
        ) || [];
        
        let foundInCache = false;
        const updated = cached.map((att: any) => {
          if (String(att.AttachID) === String(caption.attachId)) {
            foundInCache = true;
            const updatedAtt = { ...att, _syncedAt: Date.now() };
            // Remove _localUpdate flag since data is now synced
            delete updatedAtt._localUpdate;
            delete updatedAtt._updatedAt;
            // Apply the synced caption/drawings data
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
        } else {
          console.log(`[BackgroundSync] ⚠️ Attachment ${caption.attachId} not in cache - will be loaded on next page visit`);
        }
      } else if (caption.attachType === 'efe_point' && caption.pointId) {
        const cached = await this.indexedDb.getCachedServiceData(
          caption.pointId, 'efe_point_attachments'
        ) || [];
        
        let foundInCache = false;
        const updated = cached.map((att: any) => {
          if (String(att.AttachID) === String(caption.attachId)) {
            foundInCache = true;
            const updatedAtt = { ...att, _syncedAt: Date.now() };
            // Remove _localUpdate flag since data is now synced
            delete updatedAtt._localUpdate;
            delete updatedAtt._updatedAt;
            // Apply the synced caption/drawings data
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
        } else {
          console.log(`[BackgroundSync] ⚠️ EFE Attachment ${caption.attachId} not in cache - will be loaded on next page visit`);
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

  /**
   * Clean up on destroy
   */
  ngOnDestroy(): void {
    if (this.syncInterval) {
      this.syncInterval.unsubscribe();
    }
  }
}

