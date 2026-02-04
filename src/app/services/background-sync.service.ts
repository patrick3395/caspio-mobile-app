import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Subject, interval, Subscription, firstValueFrom } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { IndexedDbService, PendingRequest, LocalImage, UploadOutboxItem } from './indexed-db.service';
import { db } from './caspio-db';
import { ApiGatewayService } from './api-gateway.service';
import { ConnectionMonitorService } from './connection-monitor.service';
import { CaspioService } from './caspio.service';
import { LocalImageService } from './local-image.service';
import { OperationsQueueService } from './operations-queue.service';
import { ServiceMetadataService } from './service-metadata.service';
import { ThumbnailService } from './thumbnail.service';
import { PlatformDetectionService } from './platform-detection.service';
import { MemoryDiagnosticsService } from './memory-diagnostics.service';
import { environment } from '../../environments/environment';

// HUD services - lazy import to avoid circular dependency
// These are resolved at runtime via Angular's injector
type HudFieldRepoServiceType = import('../pages/hud/services/hud-field-repo.service').HudFieldRepoService;
type HudOperationsQueueServiceType = import('../pages/hud/services/hud-operations-queue.service').HudOperationsQueueService;
type HudS3UploadServiceType = import('../pages/hud/services/hud-s3-upload.service').HudS3UploadService;

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

export interface HudSyncComplete {
  serviceId: string;
  fieldKey: string;
  hudId: string;
  operation: 'create' | 'update' | 'delete';
}

export interface HudPhotoUploadComplete {
  imageId: string;
  attachId: string;
  s3Key: string;
  hudId: string;
}

export interface LbwPhotoUploadComplete {
  imageId: string;
  attachId: string;
  s3Key: string;
  lbwId: string;
}

export interface LbwSyncComplete {
  serviceId: string;
  lbwId: string;
  operation: 'create' | 'update' | 'delete';
}

export interface DtePhotoUploadComplete {
  imageId: string;
  attachId: string;
  s3Key: string;
  dteId: string;
}

export interface DteSyncComplete {
  serviceId: string;
  dteId: string;
  operation: 'create' | 'update' | 'delete';
}

export interface CsaPhotoUploadComplete {
  imageId: string;
  attachId: string;
  s3Key: string;
  csaId: string;
}

export interface CsaSyncComplete {
  serviceId: string;
  csaId: string;
  operation: 'create' | 'update' | 'delete';
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
  // ROLLING SYNC WINDOW WITH MAXIMUM WAIT TIME
  // Changes are batched with two timers:
  // 1. Short debounce (10s) - resets with each change for batching
  // 2. Maximum wait (60s) - from FIRST change, never resets
  // Sync triggers when EITHER timer expires
  // ==========================================================================
  private rollingSyncTimer: any = null;
  private maxWaitTimer: any = null;
  private rollingWindowMs = 10000; // 10-second debounce for batching rapid changes
  private maxWaitMs = 60000; // 60-second maximum wait from first change
  private firstChangeTimestamp: number | null = null; // Track when first change was queued
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

  // HUD sync events - pages can subscribe to update UI when HUD data syncs
  public hudSyncComplete$ = new Subject<HudSyncComplete>();
  public hudPhotoUploadComplete$ = new Subject<HudPhotoUploadComplete>();

  // LBW sync events - pages can subscribe to update UI when LBW data syncs
  public lbwSyncComplete$ = new Subject<LbwSyncComplete>();
  public lbwPhotoUploadComplete$ = new Subject<LbwPhotoUploadComplete>();

  // DTE sync events - pages can subscribe to update UI when DTE data syncs
  public dteSyncComplete$ = new Subject<DteSyncComplete>();
  public dtePhotoUploadComplete$ = new Subject<DtePhotoUploadComplete>();

  // CSA sync events - pages can subscribe to update UI when CSA data syncs
  public csaSyncComplete$ = new Subject<CsaSyncComplete>();
  public csaPhotoUploadComplete$ = new Subject<CsaPhotoUploadComplete>();

  // ==========================================================================
  // HUD SERVICES - Lazy loaded to avoid circular dependencies
  // ==========================================================================
  private _hudFieldRepo: HudFieldRepoServiceType | null = null;
  private _hudOpsQueue: HudOperationsQueueServiceType | null = null;
  private _hudS3Upload: HudS3UploadServiceType | null = null;
  private hudServicesSubscription: Subscription | null = null;

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
   * Queue a change and manage sync timers
   * Called whenever a new change is made (photo added, annotation updated, etc.)
   *
   * Uses two-timer approach:
   * 1. Short debounce timer (10s) - resets with each change to batch rapid changes
   * 2. Maximum wait timer (60s) - starts on FIRST change, never resets
   * Sync happens when EITHER timer expires, preventing indefinite delays
   */
  queueChange(reason: string = 'change'): void {
    this.pendingChangesCount++;
    this.pendingChanges$.next(this.pendingChangesCount);

    const isFirstChange = this.firstChangeTimestamp === null;

    // Track when first change was queued (for max wait calculation)
    if (isFirstChange) {
      this.firstChangeTimestamp = Date.now();
    }

    const timeSinceFirst = this.firstChangeTimestamp ? Math.round((Date.now() - this.firstChangeTimestamp) / 1000) : 0;
    console.log(`[BackgroundSync] Change queued (${reason}), pending: ${this.pendingChangesCount}, time since first: ${timeSinceFirst}s`);

    this.resetRollingSyncWindow(isFirstChange);
  }

  /**
   * Reset the rolling sync window timer
   * Called whenever a new change is queued
   *
   * @param isFirstChange - If true, also starts the maximum wait timer
   */
  private resetRollingSyncWindow(isFirstChange: boolean = false): void {
    // Clear existing debounce timer (this one resets with each change)
    if (this.rollingSyncTimer) {
      clearTimeout(this.rollingSyncTimer);
      this.rollingSyncTimer = null;
    }

    // Don't set timers if offline
    if (!navigator.onLine) {
      console.log('[BackgroundSync] Offline - sync timers not started');
      return;
    }

    // Start maximum wait timer on FIRST change only (never resets)
    if (isFirstChange && !this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(() => {
        console.log(`[BackgroundSync] ⏰ MAX WAIT (${this.maxWaitMs / 1000}s) reached - syncing ${this.pendingChangesCount} pending changes`);
        this.clearSyncTimers();
        this.triggerSync();
      }, this.maxWaitMs);
      console.log(`[BackgroundSync] Max wait timer started - will force sync in ${this.maxWaitMs / 1000}s regardless of new changes`);
    }

    // Set debounce timer - sync after short period of no new changes
    this.rollingSyncTimer = setTimeout(() => {
      console.log(`[BackgroundSync] Debounce (${this.rollingWindowMs / 1000}s) expired - syncing ${this.pendingChangesCount} pending changes`);
      this.clearSyncTimers();
      this.triggerSync();
    }, this.rollingWindowMs);

    console.log(`[BackgroundSync] Debounce timer reset - will sync in ${this.rollingWindowMs / 1000}s if no new changes`);
  }

  /**
   * Clear all sync timers and reset first change timestamp
   * Called after sync triggers or completes
   */
  private clearSyncTimers(): void {
    if (this.rollingSyncTimer) {
      clearTimeout(this.rollingSyncTimer);
      this.rollingSyncTimer = null;
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
    this.firstChangeTimestamp = null;
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
    private operationsQueue: OperationsQueueService,
    private serviceMetadata: ServiceMetadataService,
    private thumbnailService: ThumbnailService,
    private platform: PlatformDetectionService,
    private memoryDiagnostics: MemoryDiagnosticsService
  ) {
    this.startBackgroundSync();
    this.listenToConnectionChanges();
    this.subscribeToSyncQueueChanges();
    this.subscribeToHudServices();
    // NOTE: App state listener for native foreground/background removed - @capacitor/app not available in web build
  }

  // ==========================================================================
  // HUD SERVICES LAZY LOADING
  // Avoids circular dependency by loading services at runtime
  // ==========================================================================

  /**
   * Get HudFieldRepoService lazily to avoid circular dependency
   */
  private async getHudFieldRepo(): Promise<HudFieldRepoServiceType | null> {
    if (this._hudFieldRepo) return this._hudFieldRepo;
    try {
      const module = await import('../pages/hud/services/hud-field-repo.service');
      // Get from Angular's injector via the global injector (providedIn: 'root' services)
      const injector = (window as any).__ngInjector;
      if (injector) {
        this._hudFieldRepo = injector.get(module.HudFieldRepoService);
      }
      return this._hudFieldRepo;
    } catch (e) {
      console.warn('[BackgroundSync] Could not load HudFieldRepoService:', e);
      return null;
    }
  }

  /**
   * Get HudOperationsQueueService lazily to avoid circular dependency
   */
  private async getHudOpsQueue(): Promise<HudOperationsQueueServiceType | null> {
    if (this._hudOpsQueue) return this._hudOpsQueue;
    try {
      const module = await import('../pages/hud/services/hud-operations-queue.service');
      const injector = (window as any).__ngInjector;
      if (injector) {
        this._hudOpsQueue = injector.get(module.HudOperationsQueueService);
      }
      return this._hudOpsQueue;
    } catch (e) {
      console.warn('[BackgroundSync] Could not load HudOperationsQueueService:', e);
      return null;
    }
  }

  /**
   * Get HudS3UploadService lazily to avoid circular dependency
   */
  private async getHudS3Upload(): Promise<HudS3UploadServiceType | null> {
    if (this._hudS3Upload) return this._hudS3Upload;
    try {
      const module = await import('../pages/hud/services/hud-s3-upload.service');
      const injector = (window as any).__ngInjector;
      if (injector) {
        this._hudS3Upload = injector.get(module.HudS3UploadService);
      }
      return this._hudS3Upload;
    } catch (e) {
      console.warn('[BackgroundSync] Could not load HudS3UploadService:', e);
      return null;
    }
  }

  /**
   * Subscribe to HUD services' events and forward to BackgroundSyncService subjects
   * This connects the HUD-specific upload events to the central sync service
   */
  private async subscribeToHudServices(): Promise<void> {
    // Only subscribe on mobile where HUD uses Dexie-first architecture
    if (!this.platform.isMobile()) {
      console.log('[BackgroundSync] Webapp mode - HUD syncs immediately without batching');
      return;
    }

    try {
      // Subscribe to HUD photo upload events
      const hudS3Upload = await this.getHudS3Upload();
      if (hudS3Upload) {
        // Forward HUD photo upload events to the central hudPhotoUploadComplete$ subject
        this.hudServicesSubscription = hudS3Upload.uploadComplete$.subscribe((result) => {
          console.log('[BackgroundSync] HUD photo upload complete:', result.imageId);
          this.ngZone.run(() => {
            this.hudPhotoUploadComplete$.next(result);
          });
        });
        console.log('[BackgroundSync] Subscribed to HUD photo upload events');
      }

      // Subscribe to HUD sync events (create/update/delete operations)
      const hudOpsQueue = await this.getHudOpsQueue();
      if (hudOpsQueue) {
        hudOpsQueue.syncComplete$.subscribe((event) => {
          console.log(`[BackgroundSync] HUD sync complete: ${event.operation} for ${event.fieldKey}`);
          this.ngZone.run(() => {
            this.hudSyncComplete$.next({
              serviceId: event.serviceId,
              fieldKey: event.fieldKey,
              hudId: event.hudId,
              operation: event.operation
            });
          });
        });
        console.log('[BackgroundSync] Subscribed to HUD sync events');
      }
    } catch (e) {
      console.warn('[BackgroundSync] Could not subscribe to HUD services:', e);
    }
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
        // Only trigger if we're not already waiting on sync timers
        if (!this.rollingSyncTimer && !this.maxWaitTimer) {
          this.triggerSync();
        } else {
          console.log('[BackgroundSync] Skipping fixed interval - sync timers active');
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

      // US-001 FIX: Also reset LocalImages stuck in 'uploading' status
      // These can occur if the app was closed during an upload
      await this.resetStuckUploadingImages(allOutboxItems);
    } catch (error) {
      console.warn('[BackgroundSync] Error resetting stuck outbox items:', error);
    }
  }

  /**
   * US-001 FIX: Reset LocalImages that are stuck in 'uploading' status
   * If a LocalImage has status='uploading' but still has an outbox entry,
   * it means the upload was interrupted. Reset to 'queued' so it can retry.
   */
  private async resetStuckUploadingImages(outboxItems: UploadOutboxItem[]): Promise<void> {
    if (outboxItems.length === 0) return;

    try {
      // Find LocalImages that are stuck - have outbox entry and 'uploading' status
      const stuckImages: { imageId: string }[] = [];

      for (const item of outboxItems) {
        const image = await this.indexedDb.getLocalImage(item.imageId);
        if (image && image.status === 'uploading') {
          stuckImages.push({ imageId: image.imageId });
        }
      }

      if (stuckImages.length > 0) {
        console.log(`[BackgroundSync] Found ${stuckImages.length} images stuck in 'uploading' status, resetting to 'queued'`);
        await Promise.all(stuckImages.map(img =>
          this.localImageService.updateStatus(img.imageId, 'queued', { lastError: 'Upload was interrupted' })
        ));
      }
    } catch (error) {
      console.warn('[BackgroundSync] Error resetting stuck uploading images:', error);
    }
  }

  /**
   * US-001 FIX: Reset ALL stuck 'uploading' images immediately
   * Called at the start of every sync cycle to handle mobile-specific issues where:
   * 1. Uploads get interrupted without throwing errors (network timeouts)
   * 2. Multiple rapid uploads cause race conditions on slower mobile CPUs
   * 3. App backgrounding/foregrounding interrupts in-progress uploads
   *
   * This is different from resetStuckUploadingImages which only runs for old items (> 5 min)
   */
  private async resetAllStuckUploadingImages(): Promise<void> {
    try {
      const allOutboxItems = await this.indexedDb.getAllUploadOutboxItems();
      if (allOutboxItems.length === 0) return;

      const now = Date.now();
      // US-001 FIX: Use 90-second threshold - 30s more than upload timeout (60s)
      // This ensures timed-out uploads get caught even if error handling fails
      // Previously 2 minutes was too long and caused stuck items to linger
      const STUCK_THRESHOLD_MS = 90 * 1000; // 90 seconds (upload timeout is 60s)
      const stuckImages: { imageId: string; opId: string; stuckDuration: number }[] = [];

      // Find images that are stuck in 'uploading' status for too long
      for (const item of allOutboxItems) {
        const image = await this.indexedDb.getLocalImage(item.imageId);
        if (image && image.status === 'uploading') {
          // Check how long the image has been in 'uploading' status
          const uploadingDuration = now - image.updatedAt;

          // US-001 FIX: Only reset if uploading for more than threshold
          // This prevents interrupting legitimate ongoing uploads
          if (uploadingDuration > STUCK_THRESHOLD_MS) {
            stuckImages.push({
              imageId: image.imageId,
              opId: item.opId,
              stuckDuration: uploadingDuration
            });
          }
        }
      }

      if (stuckImages.length > 0) {
        console.log(`[BackgroundSync] US-001: Found ${stuckImages.length} images stuck in 'uploading' for >90s:`);
        stuckImages.forEach(img => {
          console.log(`[BackgroundSync]   - ${img.imageId} stuck for ${Math.round(img.stuckDuration/1000)}s`);
        });

        // Reset both the LocalImage status AND the outbox item's nextRetryAt
        await Promise.all(stuckImages.map(async (img) => {
          // Reset image status to 'queued' so it can be retried
          await this.localImageService.updateStatus(img.imageId, 'queued', {
            lastError: `Upload timed out after ${Math.round(img.stuckDuration/1000)}s - retrying`
          });
          // Reset the outbox item's nextRetryAt to now so it's immediately ready
          await this.indexedDb.updateOutboxItem(img.opId, {
            nextRetryAt: now
          });
        }));

        console.log(`[BackgroundSync] US-001: Reset ${stuckImages.length} stuck uploads, ready for retry`);
      }
    } catch (error) {
      console.warn('[BackgroundSync] Error in resetAllStuckUploadingImages:', error);
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

      // HUD-004: Process dirty HUD fields (MOBILE ONLY)
      // Webapp syncs immediately without batching via direct API calls
      // Mobile uses Dexie-first architecture with dirty flag tracking
      await this.syncDirtyHudFields();

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

      // Update service metadata revisions for storage bloat prevention (Phase 3)
      // This marks that the server has received all local changes
      this.syncAllServiceRevisions().catch(err => {
        console.warn('[BackgroundSync] Failed to sync service revisions:', err);
      });
    } catch (error) {
      console.error('[BackgroundSync] Sync failed:', error);
    } finally {
      this.isSyncing = false;
      await this.updateSyncStatusFromDb();
    }
  }

  // ==========================================================================
  // HUD SYNC - Dirty field batching and sync (MOBILE ONLY)
  // ==========================================================================

  /**
   * Sync all dirty HUD fields (MOBILE ONLY)
   *
   * This method:
   * 1. Gets all dirty HUD fields from Dexie
   * 2. Groups them by service ID for batch processing
   * 3. Enqueues create/update/delete operations via HudOperationsQueueService
   * 4. Emits hudSyncComplete$ events for UI refresh
   * 5. Dirty flags are cleared by HudOperationsQueueService on success
   *
   * WEBAPP: Syncs immediately without batching - this method is a no-op
   */
  private async syncDirtyHudFields(): Promise<void> {
    // MOBILE ONLY: Webapp syncs immediately without batching
    if (!this.platform.isMobile()) {
      return;
    }

    try {
      const hudFieldRepo = await this.getHudFieldRepo();
      const hudOpsQueue = await this.getHudOpsQueue();

      if (!hudFieldRepo || !hudOpsQueue) {
        console.log('[BackgroundSync] HUD services not available, skipping HUD sync');
        return;
      }

      // Check if Dexie-first is enabled (should be true on mobile)
      if (!hudFieldRepo.isDexieFirstEnabled()) {
        return;
      }

      // Get all dirty fields
      const dirtyFields = await hudFieldRepo.getDirtyFields();

      if (dirtyFields.length === 0) {
        console.log('[BackgroundSync] No dirty HUD fields to sync');
        return;
      }

      console.log(`[BackgroundSync] Syncing ${dirtyFields.length} dirty HUD fields`);

      // Group by service ID for batch processing
      const fieldsByService = new Map<string, typeof dirtyFields>();
      for (const field of dirtyFields) {
        const serviceFields = fieldsByService.get(field.serviceId) || [];
        serviceFields.push(field);
        fieldsByService.set(field.serviceId, serviceFields);
      }

      // Process each service's dirty fields
      let totalEnqueued = 0;
      for (const [serviceId, fields] of fieldsByService) {
        console.log(`[BackgroundSync] Processing ${fields.length} dirty HUD fields for service ${serviceId}`);

        // Use HudOperationsQueueService.syncDirtyFields() which handles the enqueuing
        // and sets up callbacks to emit hudSyncComplete$ events
        const enqueued = await hudOpsQueue.syncDirtyFields(serviceId);
        totalEnqueued += enqueued;

        // Mark section dirty so UI knows to refresh
        this.markSectionDirty(`${serviceId}_hud`);
      }

      console.log(`[BackgroundSync] Enqueued ${totalEnqueued} HUD operations across ${fieldsByService.size} services`);

    } catch (error) {
      console.error('[BackgroundSync] Error syncing dirty HUD fields:', error);
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
        } else if (request.endpoint.includes('Services_HUD') && !request.endpoint.includes('Attach')) {
          // For HUD records, use HUDID (or VisualID/PK_ID as fallback)
          if (result && result.HUDID) {
            realId = result.HUDID;
          } else if (result && result.VisualID) {
            realId = result.VisualID;
          } else if (result && result.Result && result.Result[0]) {
            realId = result.Result[0].HUDID || result.Result[0].VisualID || result.Result[0].PK_ID;
          }

          // Update IndexedDB 'hud' cache and emit sync complete event
          if (realId) {
            const serviceId = String(request.data?.ServiceID || '');

            // Update the IndexedDB cache to replace temp ID with real HUD data
            if (serviceId) {
              const existingHud = await this.indexedDb.getCachedServiceData(serviceId, 'hud') || [];
              const hudData = result.Result?.[0] || result;

              // Find and update the HUD record with temp ID, or add new if not found
              let hudUpdated = false;
              const updatedHud = existingHud.map((h: any) => {
                if (h._tempId === request.tempId || h.HUDID === request.tempId || h.VisualID === request.tempId || h.PK_ID === request.tempId) {
                  hudUpdated = true;
                  return {
                    ...h,
                    ...hudData,
                    HUDID: realId,
                    VisualID: realId,
                    PK_ID: realId,
                    _tempId: undefined,
                    _localOnly: undefined,
                    _syncing: undefined
                  };
                }
                return h;
              });

              // If HUD record wasn't in cache (shouldn't happen but just in case), add it
              if (!hudUpdated && hudData) {
                updatedHud.push({
                  ...hudData,
                  HUDID: realId,
                  VisualID: realId,
                  PK_ID: realId
                });
              }

              await this.indexedDb.cacheServiceData(serviceId, 'hud', updatedHud);
              console.log(`[BackgroundSync] ✅ Updated HUD cache for service ${serviceId}: temp ${request.tempId} -> real ${realId}`);
            }

            // Emit sync complete event for HUD
            this.ngZone.run(() => {
              this.hudSyncComplete$.next({
                serviceId: String(request.data?.ServiceID || ''),
                fieldKey: '',
                hudId: String(realId),
                operation: 'create'
              });
            });
          }
        } else if (request.endpoint.includes('Services_LBW') && !request.endpoint.includes('Attach')) {
          // For LBW records, use LBWID (or PK_ID as fallback)
          if (result && result.LBWID) {
            realId = result.LBWID;
          } else if (result && result.PK_ID) {
            realId = result.PK_ID;
          } else if (result && result.Result && result.Result[0]) {
            realId = result.Result[0].LBWID || result.Result[0].PK_ID;
          }

          // Update IndexedDB 'lbw_records' cache and emit sync complete event
          if (realId) {
            const serviceId = String(request.data?.ServiceID || '');

            // Update the IndexedDB cache to replace temp ID with real LBW data
            if (serviceId) {
              const existingLbw = await this.indexedDb.getCachedServiceData(serviceId, 'lbw_records') || [];
              const lbwData = result.Result?.[0] || result;

              // Find and update the LBW record with temp ID, or add new if not found
              let lbwUpdated = false;
              const updatedLbw = existingLbw.map((l: any) => {
                if (l._tempId === request.tempId || l.LBWID === request.tempId || l.PK_ID === request.tempId) {
                  lbwUpdated = true;
                  return {
                    ...l,
                    ...lbwData,
                    LBWID: realId,
                    PK_ID: realId,
                    _tempId: undefined,
                    _localOnly: undefined,
                    _syncing: undefined
                  };
                }
                return l;
              });

              // If LBW record wasn't in cache (shouldn't happen but just in case), add it
              if (!lbwUpdated && lbwData) {
                updatedLbw.push({
                  ...lbwData,
                  LBWID: realId,
                  PK_ID: realId
                });
              }

              await this.indexedDb.cacheServiceData(serviceId, 'lbw_records', updatedLbw);
              console.log(`[BackgroundSync] ✅ Updated LBW cache for service ${serviceId}: temp ${request.tempId} -> real ${realId}`);
            }

            // Emit sync complete event for LBW
            this.ngZone.run(() => {
              this.lbwSyncComplete$.next({
                serviceId: String(request.data?.ServiceID || ''),
                lbwId: String(realId),
                operation: 'create'
              });
            });
          }
        } else if (request.endpoint.includes('Services_DTE') && !request.endpoint.includes('Attach')) {
          // For DTE records, use DTEID (or PK_ID as fallback)
          if (result && result.DTEID) {
            realId = result.DTEID;
          } else if (result && result.PK_ID) {
            realId = result.PK_ID;
          } else if (result && result.Result && result.Result[0]) {
            realId = result.Result[0].DTEID || result.Result[0].PK_ID;
          }

          // Update IndexedDB 'dte' cache and emit sync complete event
          if (realId) {
            const serviceId = String(request.data?.ServiceID || '');

            // Update the IndexedDB cache to replace temp ID with real DTE data
            if (serviceId) {
              const existingDte = await this.indexedDb.getCachedServiceData(serviceId, 'dte') || [];
              const dteData = result.Result?.[0] || result;

              // Find and update the DTE record with temp ID, or add new if not found
              let dteUpdated = false;
              const updatedDte = existingDte.map((d: any) => {
                if (d._tempId === request.tempId || d.DTEID === request.tempId || d.PK_ID === request.tempId) {
                  dteUpdated = true;
                  return {
                    ...d,
                    ...dteData,
                    DTEID: realId,
                    PK_ID: realId,
                    _tempId: undefined,
                    _localOnly: undefined,
                    _syncing: undefined
                  };
                }
                return d;
              });

              // If DTE record wasn't in cache (shouldn't happen but just in case), add it
              if (!dteUpdated && dteData) {
                updatedDte.push({
                  ...dteData,
                  DTEID: realId,
                  PK_ID: realId
                });
              }

              await this.indexedDb.cacheServiceData(serviceId, 'dte', updatedDte);
              console.log(`[BackgroundSync] ✅ Updated DTE cache for service ${serviceId}: temp ${request.tempId} -> real ${realId}`);
            }

            // Emit sync complete event for DTE
            this.ngZone.run(() => {
              this.dteSyncComplete$.next({
                serviceId: String(request.data?.ServiceID || ''),
                dteId: String(realId),
                operation: 'create'
              });
            });
          }
        } else if (request.endpoint.includes('Services_CSA') && !request.endpoint.includes('Attach')) {
          // For CSA records, use CSAID (or PK_ID as fallback)
          console.log('[BackgroundSync] CSA record sync - processing result');
          // DEBUG ALERT
          if (typeof alert !== 'undefined') {
            alert(`[CSA SYNC DEBUG] CSA record created - processing result: ${JSON.stringify(result)?.substring(0, 100)}`);
          }

          if (result && result.CSAID) {
            realId = result.CSAID;
          } else if (result && result.PK_ID) {
            realId = result.PK_ID;
          } else if (result && result.Result && result.Result[0]) {
            realId = result.Result[0].CSAID || result.Result[0].PK_ID;
          }

          // Update IndexedDB 'csa' cache and emit sync complete event
          if (realId) {
            const serviceId = String(request.data?.ServiceID || '');
            console.log(`[BackgroundSync] CSA record synced - realId: ${realId}, serviceId: ${serviceId}`);
            // DEBUG ALERT
            if (typeof alert !== 'undefined') {
              alert(`[CSA SYNC DEBUG] CSA record synced - realId: ${realId}, serviceId: ${serviceId}`);
            }

            // Update the IndexedDB cache to replace temp ID with real CSA data
            if (serviceId) {
              const existingCsa = await this.indexedDb.getCachedServiceData(serviceId, 'csa_records') || [];
              const csaData = result.Result?.[0] || result;

              // Find and update the CSA record with temp ID, or add new if not found
              let csaUpdated = false;
              const updatedCsa = existingCsa.map((d: any) => {
                if (d._tempId === request.tempId || d.CSAID === request.tempId || d.PK_ID === request.tempId) {
                  csaUpdated = true;
                  return {
                    ...d,
                    ...csaData,
                    CSAID: realId,
                    PK_ID: realId,
                    _tempId: undefined,
                    _localOnly: undefined,
                    _syncing: undefined
                  };
                }
                return d;
              });

              // If CSA record wasn't in cache (shouldn't happen but just in case), add it
              if (!csaUpdated && csaData) {
                updatedCsa.push({
                  ...csaData,
                  CSAID: realId,
                  PK_ID: realId
                });
              }

              await this.indexedDb.cacheServiceData(serviceId, 'csa_records', updatedCsa);
              console.log(`[BackgroundSync] ✅ Updated CSA cache for service ${serviceId}: temp ${request.tempId} -> real ${realId}`);
            }

            // Emit sync complete event for CSA
            this.ngZone.run(() => {
              this.csaSyncComplete$.next({
                serviceId: String(request.data?.ServiceID || ''),
                csaId: String(realId),
                operation: 'create'
              });
            });
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
          } else if (request.endpoint.includes('LPS_Services_HUD/records') && !request.endpoint.includes('Attach')) {
            // Clear _localUpdate flag from HUD cache after successful update (Notes: 'HIDDEN', etc.)
            const hudMatch = request.endpoint.match(/VisualID=(\d+)/);
            if (hudMatch) {
              const hudId = hudMatch[1];
              const serviceId = request.data?.ServiceID;
              console.log(`[BackgroundSync] HUD UPDATE synced for VisualID ${hudId}, clearing _localUpdate flag`);
              await this.clearHudLocalUpdateFlag(hudId, serviceId);
            }
          } else if (request.endpoint.includes('LPS_Services_LBW/records') && !request.endpoint.includes('Attach')) {
            // Clear _localUpdate flag from LBW cache after successful update
            const lbwMatch = request.endpoint.match(/LBWID=(\d+)/);
            if (lbwMatch) {
              const lbwId = lbwMatch[1];
              const serviceId = request.data?.ServiceID;
              console.log(`[BackgroundSync] LBW UPDATE synced for LBWID ${lbwId}, clearing _localUpdate flag`);
              await this.clearLbwLocalUpdateFlag(lbwId, serviceId);
            }
          } else if (request.endpoint.includes('LPS_Services_DTE/records') && !request.endpoint.includes('Attach')) {
            // Clear _localUpdate flag from DTE cache after successful update
            const dteMatch = request.endpoint.match(/DTEID=(\d+)/);
            if (dteMatch) {
              const dteId = dteMatch[1];
              const serviceId = request.data?.ServiceID;
              console.log(`[BackgroundSync] DTE UPDATE synced for DTEID ${dteId}, clearing _localUpdate flag`);
              await this.clearDteLocalUpdateFlag(dteId, serviceId);
            }
          }
        }

        // Emit visual sync complete for CREATE operations on visuals
        if (request.type === 'CREATE' && (request.endpoint === 'LPS_Services_Visuals' || request.endpoint.includes('LPS_Services_Visuals/records'))) {
          const serviceId = request.data?.ServiceID;
          // Extract visual ID from result
          let visualId = result?.VisualID || result?.Result?.[0]?.VisualID || result?.PK_ID || result?.Result?.[0]?.PK_ID;

          // CRITICAL FIX: Always store temp ID mapping if visualId is found
          // Previously required both serviceId AND visualId, but if serviceId is NaN (from empty string),
          // the mapping wouldn't be stored and photos would be stuck with "Waiting for parent entity sync"
          if (visualId && request.tempId) {
            await this.indexedDb.mapTempId(request.tempId, String(visualId), 'visual');
            console.log(`[BackgroundSync] ✅ Stored visual ID mapping: ${request.tempId} -> ${visualId}`);
          } else if (!visualId) {
            console.error(`[BackgroundSync] ❌ Visual CREATE succeeded but no VisualID in response:`, JSON.stringify(result)?.substring(0, 200));
          }

          // Emit sync complete and refresh cache only if we have a valid serviceId
          const validServiceId = serviceId && !isNaN(Number(serviceId)) ? String(serviceId) : null;
          if (validServiceId && visualId) {
            console.log(`[BackgroundSync] Visual created - emitting visualSyncComplete for serviceId=${validServiceId}, visualId=${visualId}`);

            this.ngZone.run(() => {
              this.visualSyncComplete$.next({
                serviceId: validServiceId,
                visualId: String(visualId),
                tempId: request.tempId
              });
            });

            // Also refresh the visuals cache from server
            await this.refreshVisualsCache(validServiceId);
          } else if (visualId) {
            // Visual created but serviceId invalid - still emit event with what we have
            console.warn(`[BackgroundSync] Visual created but serviceId invalid (${serviceId}), visualId=${visualId}`);
            this.ngZone.run(() => {
              this.visualSyncComplete$.next({
                serviceId: String(serviceId || ''),
                visualId: String(visualId),
                tempId: request.tempId
              });
            });
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
        // Apply exponential backoff for retries (same logic as requests)
        if (caption.retryCount && caption.retryCount > 0 && caption.lastAttempt) {
          const timeSinceLastAttempt = Date.now() - caption.lastAttempt;
          const retryDelay = this.calculateRetryDelay(caption.retryCount);
          if (timeSinceLastAttempt < retryDelay) {
            // Skip this caption for now, will retry later
            continue;
          }
        }

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
          case 'hud':
            endpoint = `/api/caspio-proxy/tables/LPS_Services_HUD_Attach/records?q.where=AttachID=${resolvedAttachId}`;
            break;
          case 'lbw':
            endpoint = `/api/caspio-proxy/tables/LPS_Services_LBW_Attach/records?q.where=AttachID=${resolvedAttachId}`;
            break;
          case 'dte':
            endpoint = `/api/caspio-proxy/tables/LPS_Services_DTE_Attach/records?q.where=AttachID=${resolvedAttachId}`;
            break;
          case 'csa':
            console.log('[BackgroundSync] CSA caption sync - AttachID:', resolvedAttachId);
            // DEBUG ALERT
            if (typeof alert !== 'undefined') {
              alert(`[CSA SYNC DEBUG] Caption sync starting - AttachID: ${resolvedAttachId}`);
            }
            endpoint = `/api/caspio-proxy/tables/LPS_Services_CSA_Attach/records?q.where=AttachID=${resolvedAttachId}`;
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
        const errorMessage = error.message || 'Sync failed';
        const currentRetryCount = caption.retryCount || 0;
        const MAX_RETRIES_BEFORE_FAILED = 10;

        // Increment retry count and apply exponential backoff
        const newRetryCount = currentRetryCount + 1;

        if (newRetryCount >= MAX_RETRIES_BEFORE_FAILED) {
          // Mark as failed after too many retries so it shows in Failed tab
          const failedMessage = `Failed after ${newRetryCount} attempts: ${errorMessage}`;
          console.error(`[BackgroundSync] ❌ Caption FAILED PERMANENTLY: ${caption.captionId}`, failedMessage);
          await this.indexedDb.updateCaptionStatus(caption.captionId, 'failed', failedMessage, true);
        } else {
          // Keep as pending for retry with backoff
          console.warn(`[BackgroundSync] ❌ Caption sync failed (will retry ${newRetryCount}/${MAX_RETRIES_BEFORE_FAILED}): ${caption.captionId}`, error);
          await this.indexedDb.updateCaptionStatus(caption.captionId, 'pending', errorMessage, true);
        }
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

    // CRITICAL: Strip underscore-prefixed metadata fields from data before sending to API
    // These fields (like _displayType, _photoType, _roomName, _tempEfeId) are for internal use only
    // Caspio will reject requests with unknown fields
    let cleanedData = request.data;
    if (request.data && typeof request.data === 'object') {
      cleanedData = Object.fromEntries(
        Object.entries(request.data).filter(([key]) => !key.startsWith('_'))
      );
    }

    switch (request.method) {
      case 'GET':
        return this.apiGateway.get(request.endpoint).toPromise();
      case 'POST':
        return this.apiGateway.post(request.endpoint, cleanedData).toPromise();
      case 'PUT':
        return this.apiGateway.put(request.endpoint, cleanedData).toPromise();
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
            result.s3Key || result.Photo,
            data.fileId  // Pass imageId for Dexie-first pointer storage
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
            result.s3Key || result.Photo,
            data.fileId  // Pass imageId for Dexie-first pointer storage
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
        // DEXIE-FIRST FIX: Add quotes around EFEID for Caspio query compatibility
        endpoint = endpoint.replace('EFEID=DEFERRED', `EFEID='${tempEfeId}'`);
        console.log(`[BackgroundSync] Using real EFEID directly: ${tempEfeId}`);
        delete data._tempEfeId;
      } else {
        // Still a temp ID - try to resolve it
        const realEfeId = await this.indexedDb.getRealId(tempEfeId);
        if (realEfeId) {
          // DEXIE-FIRST FIX: Add quotes around EFEID for Caspio query compatibility
          endpoint = endpoint.replace('EFEID=DEFERRED', `EFEID='${realEfeId}'`);
          console.log(`[BackgroundSync] Resolved DEFERRED endpoint: ${tempEfeId} → ${realEfeId}`);
          delete data._tempEfeId;
        } else {
          // Room not synced yet - throw error to defer until room syncs
          console.log(`[BackgroundSync] FDF update deferred - room not synced yet: ${tempEfeId}`);
          throw new Error(`Room not synced yet: ${tempEfeId}`);
        }
      }
    }

    // Resolve PointID=DEFERRED for point deletion/update with temp IDs
    if (endpoint.includes('PointID=DEFERRED') && data._tempPointId) {
      const tempPointId = data._tempPointId;

      // Check if _tempPointId is already a real ID
      if (typeof tempPointId === 'string' && !tempPointId.startsWith('temp_')) {
        // Already a real ID - use it directly
        endpoint = endpoint.replace('PointID=DEFERRED', `PointID=${tempPointId}`);
        console.log(`[BackgroundSync] Using real PointID directly: ${tempPointId}`);
        delete data._tempPointId;
      } else {
        // Still a temp ID - try to resolve it
        const realPointId = await this.indexedDb.getRealId(tempPointId);
        if (realPointId) {
          endpoint = endpoint.replace('PointID=DEFERRED', `PointID=${realPointId}`);
          console.log(`[BackgroundSync] Resolved PointID DEFERRED: ${tempPointId} → ${realPointId}`);
          delete data._tempPointId;
        } else {
          // Point not synced yet - throw error to defer
          console.log(`[BackgroundSync] Point operation deferred - point not synced yet: ${tempPointId}`);
          throw new Error(`Point not synced yet: ${tempPointId}`);
        }
      }
    }

    // Resolve AttachID=DEFERRED for attachment deletion with temp IDs
    if (endpoint.includes('AttachID=DEFERRED') && data._tempAttachId) {
      const tempAttachId = data._tempAttachId;

      if (typeof tempAttachId === 'string' && !tempAttachId.startsWith('temp_')) {
        endpoint = endpoint.replace('AttachID=DEFERRED', `AttachID=${tempAttachId}`);
        console.log(`[BackgroundSync] Using real AttachID directly: ${tempAttachId}`);
        delete data._tempAttachId;
      } else {
        const realAttachId = await this.indexedDb.getRealId(tempAttachId);
        if (realAttachId) {
          endpoint = endpoint.replace('AttachID=DEFERRED', `AttachID=${realAttachId}`);
          console.log(`[BackgroundSync] Resolved AttachID DEFERRED: ${tempAttachId} → ${realAttachId}`);
          delete data._tempAttachId;
        } else {
          console.log(`[BackgroundSync] Attachment operation deferred - not synced yet: ${tempAttachId}`);
          throw new Error(`Attachment not synced yet: ${tempAttachId}`);
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
   * US-001 FIX: Reset nextRetryAt for ALL upload outbox items before syncing
   * This ensures items with backoff delays are immediately retried when user clicks Force Sync
   */
  async forceSyncNow(): Promise<void> {
    console.log('[BackgroundSync] Force sync triggered');

    // US-001 FIX: AGGRESSIVE reset - when user clicks Force Sync, reset ALL 'uploading' items
    // regardless of how long they've been uploading. User expects immediate retry.
    await this.forceResetAllUploadingImages();

    // US-001 FIX: Reset nextRetryAt for all pending upload items
    // When user clicks Force Sync, they expect ALL items to sync immediately,
    // regardless of any exponential backoff delays
    await this.resetAllUploadOutboxRetryTimes();

    await this.triggerSync();
  }

  /**
   * US-001 FIX: AGGRESSIVE reset for Force Sync - reset ALL 'uploading' items immediately
   * This is called only by forceSyncNow() when user explicitly wants to retry everything.
   * Different from resetAllStuckUploadingImages() which uses a 2-minute threshold.
   */
  private async forceResetAllUploadingImages(): Promise<void> {
    try {
      const allOutboxItems = await this.indexedDb.getAllUploadOutboxItems();
      if (allOutboxItems.length === 0) return;

      const now = Date.now();
      const uploadingImages: { imageId: string; opId: string }[] = [];

      // Find ALL images currently in 'uploading' status
      for (const item of allOutboxItems) {
        const image = await this.indexedDb.getLocalImage(item.imageId);
        if (image && image.status === 'uploading') {
          uploadingImages.push({ imageId: image.imageId, opId: item.opId });
        }
      }

      if (uploadingImages.length > 0) {
        console.log(`[BackgroundSync] Force sync: resetting ${uploadingImages.length} 'uploading' images to 'queued'`);

        // Reset ALL uploading items - user clicked Force Sync so they want immediate retry
        await Promise.all(uploadingImages.map(async (img) => {
          await this.localImageService.updateStatus(img.imageId, 'queued', {
            lastError: 'Force sync - retrying upload'
          });
          await this.indexedDb.updateOutboxItem(img.opId, {
            nextRetryAt: now
          });
        }));
      }
    } catch (error) {
      console.warn('[BackgroundSync] Error in forceResetAllUploadingImages:', error);
    }
  }

  /**
   * US-001 FIX: Reset nextRetryAt for all upload outbox items
   * Called by forceSyncNow to ensure all items are immediately eligible for sync
   */
  private async resetAllUploadOutboxRetryTimes(): Promise<void> {
    try {
      const allItems = await this.indexedDb.getAllUploadOutboxItems();
      const now = Date.now();

      // Find items that have nextRetryAt in the future (are waiting for backoff)
      const delayedItems = allItems.filter(item => item.nextRetryAt > now);

      if (delayedItems.length > 0) {
        console.log(`[BackgroundSync] Force sync: resetting ${delayedItems.length} delayed upload items`);
        await Promise.all(delayedItems.map(item =>
          this.indexedDb.updateOutboxItem(item.opId, {
            nextRetryAt: now
          })
        ));
      }
    } catch (error) {
      console.warn('[BackgroundSync] Error resetting upload retry times:', error);
    }
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
    // Clear sync timers (debounce and max wait)
    this.clearSyncTimers();
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
      attachType: 'visual' | 'efe_point' | 'fdf' | 'hud' | 'lbw' | 'dte' | 'csa';
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
      } else if (caption.attachType === 'hud') {
        // HUD: Update hud_attachments cache and localImages
        let foundInCache = false;

        // Update localImages table (MOBILE mode source of truth)
        try {
          // First try to find by imageId matching attachId
          const localImage = await db.localImages.get(caption.attachId);
          if (localImage) {
            const updateData: any = { updatedAt: Date.now() };
            if (caption.caption !== undefined) updateData.caption = caption.caption;
            if (caption.drawings !== undefined) updateData.drawings = caption.drawings;
            await db.localImages.update(caption.attachId, updateData);
            foundInCache = true;
            console.log(`[BackgroundSync] ✅ Updated localImages with synced caption for HUD: ${caption.attachId}`);
          } else {
            // Try to find by attachId field
            const imagesWithAttachId = await db.localImages.where('attachId').equals(caption.attachId).toArray();
            if (imagesWithAttachId.length > 0) {
              for (const img of imagesWithAttachId) {
                const updateData: any = { updatedAt: Date.now() };
                if (caption.caption !== undefined) updateData.caption = caption.caption;
                if (caption.drawings !== undefined) updateData.drawings = caption.drawings;
                await db.localImages.update(img.imageId, updateData);
                foundInCache = true;
                console.log(`[BackgroundSync] ✅ Updated localImages (by attachId) with synced caption for HUD: ${img.imageId}`);
              }
            }
          }
        } catch (err) {
          console.warn(`[BackgroundSync] Failed to update localImages for HUD caption:`, err);
        }

        // Update hud_attachments cache
        if (caption.visualId) {
          const cached = await this.indexedDb.getCachedServiceData(caption.visualId, 'hud_attachments') || [];
          const updated = cached.map((att: any) => {
            if (String(att.AttachID) === String(caption.attachId)) {
              foundInCache = true;
              const updatedAtt = { ...att, _syncedAt: Date.now() };
              delete updatedAtt._localUpdate;
              delete updatedAtt._updatedAt;
              if (caption.caption !== undefined) updatedAtt.Annotation = caption.caption;
              if (caption.drawings !== undefined) updatedAtt.Drawings = caption.drawings;
              return updatedAtt;
            }
            return att;
          });
          if (foundInCache) {
            await this.indexedDb.cacheServiceData(caption.visualId, 'hud_attachments', updated);
            console.log(`[BackgroundSync] ✅ Updated hud_attachments cache for ${caption.attachId}`);
          }
        }

        if (!foundInCache) {
          console.log(`[BackgroundSync] ⚠️ HUD Attachment ${caption.attachId} not in any cache - will be loaded on next page visit`);
        }
      } else if (caption.attachType === 'lbw') {
        // LBW: Update lbw_attachments cache and localImages
        let foundInCache = false;

        // Update localImages table (MOBILE mode source of truth)
        try {
          // First try to find by imageId matching attachId
          const localImage = await db.localImages.get(caption.attachId);
          if (localImage) {
            const updateData: any = { updatedAt: Date.now() };
            if (caption.caption !== undefined) updateData.caption = caption.caption;
            if (caption.drawings !== undefined) updateData.drawings = caption.drawings;
            await db.localImages.update(caption.attachId, updateData);
            foundInCache = true;
            console.log(`[BackgroundSync] ✅ Updated localImages with synced caption for LBW: ${caption.attachId}`);
          } else {
            // Try to find by attachId field
            const imagesWithAttachId = await db.localImages.where('attachId').equals(caption.attachId).toArray();
            if (imagesWithAttachId.length > 0) {
              for (const img of imagesWithAttachId) {
                const updateData: any = { updatedAt: Date.now() };
                if (caption.caption !== undefined) updateData.caption = caption.caption;
                if (caption.drawings !== undefined) updateData.drawings = caption.drawings;
                await db.localImages.update(img.imageId, updateData);
                foundInCache = true;
                console.log(`[BackgroundSync] ✅ Updated localImages (by attachId) with synced caption for LBW: ${img.imageId}`);
              }
            }
          }
        } catch (err) {
          console.warn(`[BackgroundSync] Failed to update localImages for LBW caption:`, err);
        }

        // Update lbw_attachments cache
        if (caption.visualId) {
          const cached = await this.indexedDb.getCachedServiceData(caption.visualId, 'lbw_attachments') || [];
          const updated = cached.map((att: any) => {
            if (String(att.AttachID) === String(caption.attachId)) {
              foundInCache = true;
              const updatedAtt = { ...att, _syncedAt: Date.now() };
              delete updatedAtt._localUpdate;
              delete updatedAtt._updatedAt;
              if (caption.caption !== undefined) updatedAtt.Annotation = caption.caption;
              if (caption.drawings !== undefined) updatedAtt.Drawings = caption.drawings;
              return updatedAtt;
            }
            return att;
          });
          if (foundInCache) {
            await this.indexedDb.cacheServiceData(caption.visualId, 'lbw_attachments', updated);
            console.log(`[BackgroundSync] ✅ Updated lbw_attachments cache for ${caption.attachId}`);
          }
        }

        if (!foundInCache) {
          console.log(`[BackgroundSync] ⚠️ LBW Attachment ${caption.attachId} not in any cache - will be loaded on next page visit`);
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

  private async clearHudLocalUpdateFlag(hudId: string, serviceId?: string): Promise<void> {
    try {
      // Helper to check if HUD record matches by HUDID, VisualID, or PK_ID
      const matchesHud = (h: any) => {
        return (String(h.HUDID) === String(hudId) || String(h.VisualID) === String(hudId) || String(h.PK_ID) === String(hudId)) && h._localUpdate;
      };

      // If we have the serviceId, update directly
      if (serviceId) {
        const hudRecords = await this.indexedDb.getCachedServiceData(String(serviceId), 'hud') || [];
        let found = false;

        const updatedHud = hudRecords.map((h: any) => {
          if (matchesHud(h)) {
            found = true;
            // Remove the _localUpdate flag - the data is now synced
            const { _localUpdate, ...rest } = h;
            return rest;
          }
          return h;
        });

        if (found) {
          await this.indexedDb.cacheServiceData(String(serviceId), 'hud', updatedHud);
          console.log(`[BackgroundSync] ✅ Cleared _localUpdate flag for HUD ${hudId} in service ${serviceId}`);
          return;
        }
      }

      // Otherwise search all services for this HUD record
      const allCaches = await this.indexedDb.getAllCachedServiceData('hud');

      for (const cache of allCaches) {
        const hudRecords = cache.data || [];
        let found = false;

        const updatedHud = hudRecords.map((h: any) => {
          if (matchesHud(h)) {
            found = true;
            const { _localUpdate, ...rest } = h;
            return rest;
          }
          return h;
        });

        if (found) {
          await this.indexedDb.cacheServiceData(cache.serviceId, 'hud', updatedHud);
          console.log(`[BackgroundSync] ✅ Cleared _localUpdate flag for HUD ${hudId} in ${cache.serviceId}`);
          return;
        }
      }

      console.log(`[BackgroundSync] HUD ${hudId} not found in any cache (may already be cleared)`);
    } catch (error) {
      console.warn(`[BackgroundSync] Error clearing _localUpdate flag for HUD ${hudId}:`, error);
    }
  }

  private async clearLbwLocalUpdateFlag(lbwId: string, serviceId?: string): Promise<void> {
    try {
      // Helper to check if LBW record matches by LBWID or PK_ID
      const matchesLbw = (l: any) => {
        return (String(l.LBWID) === String(lbwId) || String(l.PK_ID) === String(lbwId)) && l._localUpdate;
      };

      // If we have the serviceId, update directly
      if (serviceId) {
        const lbwRecords = await this.indexedDb.getCachedServiceData(String(serviceId), 'lbw_records') || [];
        let found = false;

        const updatedLbw = lbwRecords.map((l: any) => {
          if (matchesLbw(l)) {
            found = true;
            // Remove the _localUpdate flag - the data is now synced
            const { _localUpdate, ...rest } = l;
            return rest;
          }
          return l;
        });

        if (found) {
          await this.indexedDb.cacheServiceData(String(serviceId), 'lbw_records', updatedLbw);
          console.log(`[BackgroundSync] ✅ Cleared _localUpdate flag for LBW ${lbwId} in service ${serviceId}`);
          return;
        }
      }

      // Otherwise search all services for this LBW record
      const allCaches = await this.indexedDb.getAllCachedServiceData('lbw_records');

      for (const cache of allCaches) {
        const lbwRecords = cache.data || [];
        let found = false;

        const updatedLbw = lbwRecords.map((l: any) => {
          if (matchesLbw(l)) {
            found = true;
            const { _localUpdate, ...rest } = l;
            return rest;
          }
          return l;
        });

        if (found) {
          await this.indexedDb.cacheServiceData(cache.serviceId, 'lbw_records', updatedLbw);
          console.log(`[BackgroundSync] ✅ Cleared _localUpdate flag for LBW ${lbwId} in ${cache.serviceId}`);
          return;
        }
      }

      console.log(`[BackgroundSync] LBW ${lbwId} not found in any cache (may already be cleared)`);
    } catch (error) {
      console.warn(`[BackgroundSync] Error clearing _localUpdate flag for LBW ${lbwId}:`, error);
    }
  }

  private async clearDteLocalUpdateFlag(dteId: string, serviceId?: string): Promise<void> {
    try {
      // Helper to check if DTE record matches by DTEID or PK_ID
      const matchesDte = (d: any) => {
        return (String(d.DTEID) === String(dteId) || String(d.PK_ID) === String(dteId)) && d._localUpdate;
      };

      // If we have the serviceId, update directly
      if (serviceId) {
        const dteRecords = await this.indexedDb.getCachedServiceData(String(serviceId), 'dte') || [];
        let found = false;

        const updatedDte = dteRecords.map((d: any) => {
          if (matchesDte(d)) {
            found = true;
            // Remove the _localUpdate flag - the data is now synced
            const { _localUpdate, ...rest } = d;
            return rest;
          }
          return d;
        });

        if (found) {
          await this.indexedDb.cacheServiceData(String(serviceId), 'dte', updatedDte);
          console.log(`[BackgroundSync] ✅ Cleared _localUpdate flag for DTE ${dteId} in service ${serviceId}`);
          return;
        }
      }

      // Otherwise search all services for this DTE record
      const allCaches = await this.indexedDb.getAllCachedServiceData('dte');

      for (const cache of allCaches) {
        const dteRecords = cache.data || [];
        let found = false;

        const updatedDte = dteRecords.map((d: any) => {
          if (matchesDte(d)) {
            found = true;
            const { _localUpdate, ...rest } = d;
            return rest;
          }
          return d;
        });

        if (found) {
          await this.indexedDb.cacheServiceData(cache.serviceId, 'dte', updatedDte);
          console.log(`[BackgroundSync] ✅ Cleared _localUpdate flag for DTE ${dteId} in ${cache.serviceId}`);
          return;
        }
      }

      console.log(`[BackgroundSync] DTE ${dteId} not found in any cache (may already be cleared)`);
    } catch (error) {
      console.warn(`[BackgroundSync] Error clearing _localUpdate flag for DTE ${dteId}:`, error);
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
   * @param imageId - Optional LocalImage ID to use pointer storage (Dexie-first)
   */
  private async cacheUploadedPhoto(attachId: string, serviceId: string, s3Key: string, imageId?: string): Promise<void> {
    if (!attachId || !s3Key) {
      console.warn('[BackgroundSync] Cannot cache photo - missing attachId or s3Key');
      return;
    }

    try {
      // DEXIE-FIRST: If we have imageId, try to use pointer storage (saves ~930KB)
      if (imageId) {
        const image = await this.indexedDb.getLocalImage(imageId);
        if (image?.localBlobId) {
          await this.indexedDb.cachePhotoPointer(attachId, serviceId, image.localBlobId, s3Key);
          console.log('[BackgroundSync] ✅ Cached photo pointer (Dexie-first):', attachId, '-> blobId:', image.localBlobId);
          return;
        }
      }

      // FALLBACK: Download from S3 and cache as base64 (for legacy photos without local blob)
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

      // Cache in IndexedDB (legacy path)
      await this.indexedDb.cachePhoto(attachId, serviceId, base64, s3Key);
      console.log('[BackgroundSync] Cached uploaded photo (legacy):', attachId);
    } catch (err: any) {
      console.warn('[BackgroundSync] Failed to cache uploaded photo:', attachId, err?.message || err);
      // Don't throw - the upload was successful, just caching failed
    }
  }

  /**
   * Cache photo pointer from local blob
   * STORAGE OPTIMIZED: Instead of converting blob→base64→store (~930KB),
   * we just store a pointer to the existing localBlobs entry (~50 bytes)
   *
   * The flow is:
   * 1. Photo captured -> stored in localBlobs (ArrayBuffer)
   * 2. Photo uploads successfully -> we call this method
   * 3. This stores a POINTER to localBlobs (not a copy)
   * 4. Both tempId and attachId resolve to same blob - no duplication
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
        console.warn('[BackgroundSync] Cannot cache pointer - no blobId for image:', imageId);
        return;
      }

      // STORAGE OPTIMIZATION: Use pointer instead of base64 copy
      // This saves ~930KB per photo by storing ~50 byte pointer
      await this.indexedDb.cachePhotoPointer(attachId, serviceId, image.localBlobId, s3Key);

      console.log('[BackgroundSync] ✅ Cached photo pointer:', attachId, '-> blobId:', image.localBlobId, '(saved ~930KB)');
    } catch (err: any) {
      console.error('[BackgroundSync] Failed to cache photo pointer:', imageId, err?.message || err);
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
   * DEXIE-FIRST: Prefers pointer storage when local blob exists
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

      // DEXIE-FIRST: Check if we have a local image with this attachId
      const localImages = await this.indexedDb.getLocalImagesForService(serviceId);
      const matchingImage = localImages.find(img => String(img.attachId) === attachId && img.localBlobId);

      if (matchingImage?.localBlobId) {
        // Use pointer storage instead of downloading from S3
        try {
          await this.indexedDb.cachePhotoPointer(attachId, serviceId, matchingImage.localBlobId, s3Key);
          console.log(`[BackgroundSync] Cached pointer for attachment ${attachId} (Dexie-first)${isNative ? ' [Mobile]' : ''}`);
          continue;
        } catch (err: any) {
          console.warn(`[BackgroundSync] Pointer cache failed, falling back to S3:`, err?.message);
          // Fall through to S3 download
        }
      }

      // FALLBACK: Download from S3 (for legacy photos without local blobs)
      try {
        const s3Url = await this.caspioService.getS3FileUrl(s3Key);
        const base64 = await this.fetchImageAsBase64(s3Url);
        await this.indexedDb.cachePhoto(attachId, serviceId, base64, s3Key);
        console.log(`[BackgroundSync] Cached image from S3 for attachment ${attachId}${isNative ? ' [Mobile]' : ''}`);
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

    // US-001 FIX: Reset ALL stuck 'uploading' images IMMEDIATELY at the start of each sync
    // This is critical for mobile where uploads can get interrupted without throwing errors
    // Previously this only ran for items > 5 min old, causing fresh uploads to stay stuck
    await this.resetAllStuckUploadingImages();

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

    // ANNOTATION FLATTENING FIX: Lock image to prevent annotation caching during upload
    // This prevents race conditions where annotated blob could interfere with original blob upload
    this.indexedDb.lockImageForUpload(item.imageId);
    // Also lock by localBlobId to catch any lookups by blob ID
    if (image.localBlobId) {
      this.indexedDb.lockImageForUpload(image.localBlobId);
    }

    try {
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

    // US-001 FIX: Validate blob.data exists and has content
    // On mobile, gallery-selected images can have corrupted/empty blob data
    // especially the last image in a multi-select batch
    if (!blob.data || blob.data.byteLength === 0) {
      console.error('[BackgroundSync] US-001: Blob data is empty/corrupt:', item.imageId, 'blobId:', image.localBlobId, 'byteLength:', blob.data?.byteLength);
      await this.indexedDb.removeOutboxItem(item.opId);
      // Mark as FAILED (not queued) - corrupt blob will never succeed
      await this.localImageService.markFailed(item.imageId, 'Image data is corrupt or empty - please re-add the photo');
      return;
    }

    console.log('[BackgroundSync] Uploading image:', item.imageId, 'type:', image.entityType, 'entityId:', image.entityId, 'photoType:', image.photoType, 'blobSize:', blob.data.byteLength);

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
      console.log(`[BackgroundSync] Resolved temp ID: ${entityId} -> ${realId}`);
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

    // US-001 FIX: Upload with timeout to prevent indefinite hangs on mobile
    // Mobile networks can cause fetch() to hang without throwing errors
    // 60-second timeout ensures stuck uploads are detected and retried
    const UPLOAD_TIMEOUT_MS = 60000;

    const uploadWithTimeout = async <T>(uploadPromise: Promise<T>, description: string): Promise<T> => {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Upload timeout after ${UPLOAD_TIMEOUT_MS/1000}s: ${description}`));
        }, UPLOAD_TIMEOUT_MS);
      });
      return Promise.race([uploadPromise, timeoutPromise]);
    };

    // Upload based on entity type
    let result: any;
    try {
      switch (image.entityType) {
        case 'visual':
          result = await uploadWithTimeout(
            this.caspioService.uploadVisualsAttachWithS3(
              parseInt(entityId),
              image.drawings || '',
              file,
              image.caption || ''
            ),
            `visual upload for ${item.imageId}`
          );
          break;
        case 'efe_point':
          result = await uploadWithTimeout(
            this.caspioService.uploadEFEPointsAttachWithS3(
              parseInt(entityId),
              image.drawings || '',
              file,
              image.photoType || 'Measurement', // Use stored photoType (Measurement/Location)
              image.caption || ''
            ),
            `efe_point upload for ${item.imageId}`
          );
          break;
        case 'fdf':
          // FDF photos are stored on the EFE room record itself, not as attachments
          // photoType is stored in image.photoType (e.g., 'Top', 'Bottom', 'Threshold')
          console.log('[BackgroundSync] FDF photo upload starting:', item.imageId, 'roomId:', entityId, 'photoType:', image.photoType);
          result = await uploadWithTimeout(
            this.uploadFDFPhoto(entityId, file, image.photoType || 'Top'),
            `fdf upload for ${item.imageId}`
          );
          console.log('[BackgroundSync] FDF photo upload completed:', item.imageId, 'result:', result);
          break;
        case 'hud':
          // HUD photos are stored in LPS_Services_HUD_Attach table
          console.log('[BackgroundSync] HUD photo upload starting:', item.imageId, 'hudId:', entityId);
          result = await uploadWithTimeout(
            this.caspioService.createServicesHUDAttachWithFile(
              parseInt(entityId),
              image.caption || '',
              file,
              image.drawings || ''
            ).toPromise(),
            `hud upload for ${item.imageId}`
          );
          console.log('[BackgroundSync] HUD photo upload completed:', item.imageId, 'result:', result);
          break;
        case 'lbw':
          // LBW photos are stored in LPS_Services_LBW_Attach table
          console.log('[BackgroundSync] LBW photo upload starting:', item.imageId, 'lbwId:', entityId);
          result = await uploadWithTimeout(
            this.caspioService.createServicesLBWAttachWithFile(
              parseInt(entityId),
              image.caption || '',
              file,
              image.drawings || ''
            ).toPromise(),
            `lbw upload for ${item.imageId}`
          );
          console.log('[BackgroundSync] LBW photo upload completed:', item.imageId, 'result:', result);
          break;
        case 'dte':
          // DTE photos are stored in LPS_Services_DTE_Attach table
          console.log('[BackgroundSync] DTE photo upload starting:', item.imageId, 'dteId:', entityId);
          result = await uploadWithTimeout(
            this.caspioService.createServicesDTEAttachWithFile(
              parseInt(entityId),
              image.caption || '',
              file,
              image.drawings || ''
            ).toPromise(),
            `dte upload for ${item.imageId}`
          );
          console.log('[BackgroundSync] DTE photo upload completed:', item.imageId, 'result:', result);
          break;
        case 'csa':
          // CSA photos are stored in LPS_Services_CSA_Attach table
          console.log('[BackgroundSync] CSA photo upload starting:', item.imageId, 'csaId:', entityId);
          // DEBUG ALERT
          if (typeof alert !== 'undefined') {
            alert(`[CSA SYNC DEBUG] Starting photo upload - imageId: ${item.imageId}, csaId: ${entityId}`);
          }
          result = await uploadWithTimeout(
            this.caspioService.createServicesCSAAttachWithFile(
              parseInt(entityId),
              image.caption || '',
              file,
              image.drawings || ''
            ).toPromise(),
            `csa upload for ${item.imageId}`
          );
          console.log('[BackgroundSync] CSA photo upload completed:', item.imageId, 'result:', result);
          // DEBUG ALERT
          if (typeof alert !== 'undefined') {
            alert(`[CSA SYNC DEBUG] Photo upload completed - imageId: ${item.imageId}, result: ${JSON.stringify(result)?.substring(0, 100)}`);
          }
          break;
        default:
          throw new Error(`Unsupported entity type: ${image.entityType}`);
      }

      // US-001 FIX: Validate result immediately after API call to catch malformed responses
      if (!result || typeof result !== 'object') {
        throw new Error(`Invalid upload response (type: ${typeof result}): ${JSON.stringify(result)?.substring(0, 100)}`);
      }
    } catch (uploadError: any) {
      // US-001 FIX: Explicit logging for mobile upload failures
      console.error('[BackgroundSync] Mobile upload error:', item.imageId, 'entityType:', image.entityType, 'error:', uploadError?.message || uploadError);
      throw uploadError; // Re-throw to trigger handleUploadFailure
    }

    // Extract results
    // US-001 FIX: Get raw values first to check for undefined properly
    const rawAttachId = result.AttachID || result.attachId || result.Result?.[0]?.AttachID;
    const rawS3Key = result.Attachment || result.s3Key || result.Result?.[0]?.Attachment;

    // Convert to string, handling undefined properly
    const attachId = rawAttachId !== undefined ? String(rawAttachId) : '';
    const s3Key = rawS3Key || '';

    // US-001 FIX: More robust validation - check for empty strings and "undefined" string
    if (!attachId || attachId === 'undefined' || !s3Key || s3Key === 'undefined') {
      throw new Error(`Upload response missing AttachID or s3Key (got attachId='${attachId}', s3Key='${s3Key?.substring(0, 30)}')`);
    }

    console.log('[BackgroundSync] ✅ Upload success:', item.imageId, 'attachId:', attachId, 's3Key:', s3Key?.substring(0, 50));

    // Mark as uploaded (NOT verified yet)
    await this.localImageService.handleUploadSuccess(item.opId, item.imageId, s3Key, attachId);

    // DEXIE-FIRST: Disabled cachePhotoFromLocalBlob - localBlobs are NOT pruned
    // so we don't need to create a cachedPhotos fallback. This saves ~1MB per photo.
    // The localBlob remains the source of truth until user finalizes the report.
    // await this.cachePhotoFromLocalBlob(item.imageId, attachId, image.serviceId, s3Key);

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
    } else if (image.entityType === 'hud') {
      this.ngZone.run(() => {
        this.hudPhotoUploadComplete$.next({
          imageId: item.imageId,
          attachId: attachId,
          s3Key: s3Key,
          hudId: entityId
        });
      });
    } else if (image.entityType === 'lbw') {
      this.ngZone.run(() => {
        this.lbwPhotoUploadComplete$.next({
          imageId: item.imageId,
          attachId: attachId,
          s3Key: s3Key,
          lbwId: entityId
        });
      });
    } else if (image.entityType === 'csa') {
      console.log('[BackgroundSync] Emitting csaPhotoUploadComplete$ event');
      // DEBUG ALERT
      if (typeof alert !== 'undefined') {
        alert(`[CSA SYNC DEBUG] Emitting csaPhotoUploadComplete$ - imageId: ${item.imageId}, attachId: ${attachId}, csaId: ${entityId}`);
      }
      this.ngZone.run(() => {
        this.csaPhotoUploadComplete$.next({
          imageId: item.imageId,
          attachId: attachId,
          s3Key: s3Key,
          csaId: entityId
        });
      });
    }

    // Mark sections dirty
    if (image.serviceId) {
      this.markAllSectionsDirty(image.serviceId);
    }
    } finally {
      // ANNOTATION FLATTENING FIX: Always unlock after upload completes or fails
      this.indexedDb.unlockImageAfterUpload(item.imageId);
      if (image.localBlobId) {
        this.indexedDb.unlockImageAfterUpload(image.localBlobId);
      }
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
   * Prune local blobs for verified images (Phase 5: Storage Pressure Handling)
   *
   * Uses two-stage purge: generates thumbnail before deleting full-res blob.
   * Only prunes when:
   * - Image status is 'verified'
   * - Remote has been successfully loaded in UI at least once
   * - OR image is older than 24 hours (grace period for UI to load)
   */
  private async pruneVerifiedBlobs(): Promise<void> {
    if (!this.indexedDb.hasNewImageSystem()) {
      return;
    }

    try {
      const allImages = await this.getAllLocalImages();
      const now = Date.now();
      const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours

      let prunedCount = 0;

      for (const image of allImages) {
        // Skip if not verified
        if (image.status !== 'verified') {
          continue;
        }

        // Skip if no local blob (already pruned)
        if (!image.localBlobId) {
          continue;
        }

        // Check if safe to prune
        const isPastGracePeriod = (now - image.createdAt) > GRACE_PERIOD_MS;
        const hasLoadedInUI = image.remoteLoadedInUI;

        if (hasLoadedInUI || isPastGracePeriod) {
          try {
            // Use softPurgeImage which ensures thumbnail exists before pruning
            await this.softPurgeImage(image.imageId);
            prunedCount++;
          } catch (err) {
            console.warn('[BackgroundSync] Failed to prune blob:', image.imageId, err);
          }
        }
      }

      if (prunedCount > 0) {
        console.log(`[BackgroundSync] ✅ Pruned ${prunedCount} verified local blobs (thumbnails preserved)`);
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
   * Perform storage cleanup after sync cycle (Phase 5: Storage Pressure Handling)
   *
   * Two-stage approach:
   * - Stage 1: Soft purge all verified images (delete full-res, keep thumbnails)
   * - Stage 2: If still over 80%, hard purge inactive services
   */
  private async performStorageCleanup(): Promise<void> {
    // HUD-018: Clean up old temp ID mappings (24-hour retention)
    // This is a lightweight operation that runs every sync cycle
    try {
      const tempIdMappingsCleared = await this.indexedDb.cleanupTempIdMappings(24);
      if (tempIdMappingsCleared > 0) {
        console.log(`[BackgroundSync] HUD-018: Cleaned up ${tempIdMappingsCleared} old temp ID mappings`);
      }
    } catch (err) {
      console.warn('[BackgroundSync] HUD-018: Temp ID mapping cleanup failed:', err);
    }

    // First, prune verified local blobs using standard retention policy (24h grace)
    await this.pruneVerifiedBlobs();

    // ============================================================================
    // AUTO-PURGE: Check for inactive services (2 days) - runs EVERY sync
    // This is independent of storage pressure - we always clean up old data
    // Safety checks in isPurgeSafe() prevent purging unsynced data
    // ============================================================================
    try {
      const hardResult = await this.hardPurgeInactiveServices();
      if (hardResult.purged.length > 0) {
        console.log(`[BackgroundSync] Auto-purged ${hardResult.purged.length} inactive services (2+ days old)`);
      }
    } catch (purgeErr) {
      console.warn('[BackgroundSync] Auto-purge check failed:', purgeErr);
    }

    try {
      // Get current storage usage
      let usagePercent = 0;

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
        const stats = await this.indexedDb.getStorageStats();
        usagePercent = stats.percent;
      }

      // No pressure - skip additional cleanup
      if (usagePercent < 75) {
        return;
      }

      console.log(`[BackgroundSync] ⚠️ Storage pressure: ${usagePercent.toFixed(1)}% - starting soft purge`);

      // ============================================================================
      // SOFT PURGE: Remove full-res blobs from verified images (thumbnails preserved)
      // Only runs under storage pressure
      // ============================================================================
      const softResult = await this.softPurgeAllVerified();
      console.log(`[BackgroundSync] Soft purge complete: freed ${softResult.purged} images`);

      // Legacy cleanup: Clean old cached photos if still under pressure
      if (usagePercent > 70) {
        const activeServiceIds = await this.getActiveServiceIds();
        const deleted = await this.indexedDb.cleanupOldCachedPhotos(activeServiceIds, 30);

        if (deleted > 0) {
          console.log(`[BackgroundSync] Legacy cleanup: deleted ${deleted} old cached photos`);
        }
      }
    } catch (err) {
      console.warn('[BackgroundSync] Storage cleanup error:', err);
    }
  }
  
  /**
   * Prune verified blobs older than retention period
   * Uses softPurgeImage to ensure thumbnails are preserved
   */
  private async pruneOldVerifiedBlobs(retentionMs: number): Promise<void> {
    try {
      const verifiedImages = await this.indexedDb.getVerifiedImagesOrderedByAge();
      const cutoffTime = Date.now() - retentionMs;
      let prunedCount = 0;

      for (const image of verifiedImages) {
        // Only prune if older than retention period and has local blob
        if (image.updatedAt < cutoffTime && image.localBlobId) {
          try {
            await this.softPurgeImage(image.imageId);
            prunedCount++;
          } catch (err) {
            console.warn('[BackgroundSync] Failed to prune old blob:', image.imageId, err);
          }
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
   * Force sync all pending data for a service and wait for completion
   * Called during finalization to ensure all data is synced before cleanup
   */
  async forceSyncAllPendingForService(
    serviceId: string,
    onProgress?: (status: string, current: number, total: number) => void
  ): Promise<{
    success: boolean;
    requestsSynced: number;
    requestsFailed: number;
    captionsSynced: number;
    captionsFailed: number;
  }> {
    console.log(`[BackgroundSync] Force syncing all pending for service: ${serviceId}`);

    // Get initial counts
    const pendingRequests = await this.indexedDb.getPendingRequests();
    const serviceRequests = pendingRequests.filter(r =>
      r.data?.serviceId === serviceId || r.data?.ServiceID === serviceId
    );

    const pendingCaptions = await this.indexedDb.getPendingCaptions();
    const serviceCaptions = pendingCaptions.filter(c => c.serviceId === serviceId);

    const totalItems = serviceRequests.length + serviceCaptions.length;

    if (totalItems === 0) {
      console.log('[BackgroundSync] No pending items to sync');
      return { success: true, requestsSynced: 0, requestsFailed: 0, captionsSynced: 0, captionsFailed: 0 };
    }

    onProgress?.('Starting sync...', 0, totalItems);

    // Trigger sync
    await this.triggerSync();

    // Poll for completion with timeout (30 seconds)
    const maxWaitMs = 30000;
    const pollIntervalMs = 1000;
    let elapsed = 0;

    while (elapsed < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      elapsed += pollIntervalMs;

      // Check remaining counts
      const remainingRequests = await this.indexedDb.getPendingRequests();
      const remainingServiceRequests = remainingRequests.filter(r =>
        (r.data?.serviceId === serviceId || r.data?.ServiceID === serviceId) &&
        r.status !== 'failed'
      );

      const remainingCaptions = await this.indexedDb.getPendingCaptions();
      const remainingServiceCaptions = remainingCaptions.filter(c =>
        c.serviceId === serviceId && c.status !== 'failed'
      );

      const remaining = remainingServiceRequests.length + remainingServiceCaptions.length;
      const synced = totalItems - remaining;

      onProgress?.(`Syncing... (${synced}/${totalItems})`, synced, totalItems);

      if (remaining === 0) {
        break;
      }
    }

    // Count final results
    const finalRequests = await this.indexedDb.getPendingRequests();
    const finalServiceRequests = finalRequests.filter(r =>
      r.data?.serviceId === serviceId || r.data?.ServiceID === serviceId
    );
    const failedRequests = finalServiceRequests.filter(r => r.status === 'failed');

    const finalCaptions = await this.indexedDb.getPendingCaptions();
    const finalServiceCaptions = finalCaptions.filter(c => c.serviceId === serviceId);
    const failedCaptions = finalServiceCaptions.filter(c => c.status === 'failed');

    const result = {
      success: failedRequests.length === 0 && failedCaptions.length === 0,
      requestsSynced: serviceRequests.length - finalServiceRequests.length,
      requestsFailed: failedRequests.length,
      captionsSynced: serviceCaptions.length - finalServiceCaptions.length,
      captionsFailed: failedCaptions.length
    };

    console.log('[BackgroundSync] Force sync complete:', result);
    return result;
  }

  // ============================================================================
  // SERVICE METADATA - Storage Bloat Prevention (Phase 3)
  // ============================================================================

  /**
   * Sync service metadata revisions after successful sync cycle
   * This marks that the server has received all local changes for each service
   * Used by storage bloat prevention to determine if data is safe to purge
   */
  private async syncAllServiceRevisions(): Promise<void> {
    try {
      // Get all services that have metadata tracked
      const allServices = await this.serviceMetadata.getAllServices();

      for (const service of allServices) {
        // Check if service has unsynced changes
        if (service.lastLocalRevision > service.lastServerAckRevision) {
          // Verify outbox is empty for this service (all uploads complete)
          const outboxCount = await this.serviceMetadata.getOutboxCount(service.serviceId);

          if (outboxCount === 0) {
            // Sync the revisions - server has all changes
            await this.serviceMetadata.syncRevisions(service.serviceId);
          }
        }
      }
    } catch (err) {
      console.warn('[BackgroundSync] Error syncing service revisions:', err);
    }
  }

  // ============================================================================
  // TWO-STAGE PURGE - Storage Bloat Prevention (Phase 4)
  // ============================================================================

  /**
   * Stage 1: Soft purge - Delete full-res blob, keep thumbnail
   * Called after upload ACK when image is verified on server
   *
   * @param imageId - The local image ID to soft purge
   */
  async softPurgeImage(imageId: string): Promise<void> {
    try {
      const image = await this.indexedDb.getLocalImage(imageId);
      if (!image) {
        console.warn('[BackgroundSync] softPurgeImage: Image not found:', imageId);
        return;
      }

      // Only purge verified images
      if (image.status !== 'verified') {
        console.log('[BackgroundSync] softPurgeImage: Skipping non-verified image:', imageId, 'status:', image.status);
        return;
      }

      // Skip if already purged (no local blob)
      if (!image.localBlobId) {
        console.log('[BackgroundSync] softPurgeImage: Already purged:', imageId);
        return;
      }

      // Ensure thumbnail exists before deleting full-res
      if (!image.thumbBlobId) {
        console.log('[BackgroundSync] softPurgeImage: Generating thumbnail before purge:', imageId);
        await this.generateAndStoreThumbnail(imageId);
      }

      // Delete full-res blob, keep thumbnail
      await this.indexedDb.deleteLocalBlob(image.localBlobId);
      await this.indexedDb.updateLocalImage(imageId, { localBlobId: null });

      console.log('[BackgroundSync] ✅ Soft purged image:', imageId);
    } catch (err) {
      console.warn('[BackgroundSync] softPurgeImage error:', imageId, err);
    }
  }

  /**
   * Generate and store thumbnail for an existing image
   * Used by soft purge when image was captured before thumbnail support
   */
  private async generateAndStoreThumbnail(imageId: string): Promise<void> {
    const image = await this.indexedDb.getLocalImage(imageId);
    if (!image || !image.localBlobId) {
      console.warn('[BackgroundSync] generateAndStoreThumbnail: No image or blob:', imageId);
      return;
    }

    // Get the full-res blob data
    const blob = await this.indexedDb.getLocalBlob(image.localBlobId);
    if (!blob || !blob.data) {
      console.warn('[BackgroundSync] generateAndStoreThumbnail: Blob data not found:', imageId);
      return;
    }

    try {
      // Generate thumbnail
      const thumbResult = await this.thumbnailService.generateThumbnailFromArrayBuffer(
        blob.data,
        blob.contentType || 'image/jpeg'
      );

      // Store thumbnail blob
      const thumbBlobId = `thumb_${imageId}`;
      await db.localBlobs.put({
        blobId: thumbBlobId,
        data: thumbResult.data,
        contentType: thumbResult.contentType,
        sizeBytes: thumbResult.sizeBytes,
        createdAt: Date.now()
      });

      // Update image record with thumbnail reference
      await this.indexedDb.updateLocalImage(imageId, { thumbBlobId });

      console.log('[BackgroundSync] ✅ Generated thumbnail for:', imageId, 'size:', thumbResult.sizeBytes);
    } catch (err) {
      console.warn('[BackgroundSync] generateAndStoreThumbnail error:', imageId, err);
    }
  }

  /**
   * Soft purge all verified images
   * Called during storage pressure handling
   */
  async softPurgeAllVerified(): Promise<{ purged: number; skipped: number }> {
    let purged = 0;
    let skipped = 0;

    try {
      const allImages = await this.getAllLocalImages();

      for (const image of allImages) {
        if (image.status === 'verified' && image.localBlobId) {
          try {
            await this.softPurgeImage(image.imageId);
            purged++;
          } catch {
            skipped++;
          }
        }
      }

      console.log(`[BackgroundSync] softPurgeAllVerified: purged=${purged}, skipped=${skipped}`);
    } catch (err) {
      console.warn('[BackgroundSync] softPurgeAllVerified error:', err);
    }

    return { purged, skipped };
  }

  /**
   * Stage 2: Hard purge - Delete all local data for inactive services
   * Only purges services that are:
   * - Inactive for more than 1 hour (PURGE_AFTER_MS) - TESTING VALUE
   * - Safe to purge (no pending uploads, server has latest, not open)
   *
   * @returns Object with arrays of purged and skipped service IDs
   */
  async hardPurgeInactiveServices(): Promise<{ purged: string[]; skipped: string[] }> {
    const PURGE_AFTER_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
    const cutoff = Date.now() - PURGE_AFTER_MS;

    const purged: string[] = [];
    const skipped: string[] = [];

    try {
      const inactiveServices = await this.serviceMetadata.getInactiveServices(cutoff);
      console.log(`[BackgroundSync] hardPurgeInactiveServices: Found ${inactiveServices.length} inactive services`);

      for (const service of inactiveServices) {
        const { safe, reasons } = await this.serviceMetadata.isPurgeSafe(service.serviceId);

        if (!safe) {
          console.log(`[BackgroundSync] Skipping purge for ${service.serviceId}:`, reasons);
          skipped.push(service.serviceId);
          continue;
        }

        // Purge synced data for this service (matches clearAllSyncedData behavior)
        await this.purgeServiceData(service.serviceId);
        await this.serviceMetadata.setPurgeState(service.serviceId, 'PURGED');
        purged.push(service.serviceId);

        console.log(`[BackgroundSync] ✅ Auto-purged service: ${service.serviceId} (will rehydrate on next open)`);
      }

      console.log(`[BackgroundSync] hardPurgeInactiveServices complete: purged=${purged.length}, skipped=${skipped.length}`);
    } catch (err) {
      console.warn('[BackgroundSync] hardPurgeInactiveServices error:', err);
    }

    return { purged, skipped };
  }

  /**
   * Clear synced blob data for a service (used by auto-purge)
   * Matches clearAllSyncedData behavior for consistent rehydration:
   * - Clears verified blobs (full-res and thumbnails)
   * - KEEPS LocalImage records (with blobId set to null for S3 fallback)
   * - Clears cachedPhotos
   * - Does NOT delete field tables (rehydration will refresh them)
   * - Service is marked as PURGED for rehydration trigger
   */
  private async purgeServiceData(serviceId: string): Promise<void> {
    try {
      console.log(`[BackgroundSync] 🗑️ PURGE STARTING for service: ${serviceId}`);

      // Get all local images for this service
      const images = await this.indexedDb.getLocalImagesForService(serviceId);
      const verifiedImages = images.filter(img => img.status === 'verified');

      // Count stats before purge
      const cachedPhotoCount = await db.cachedPhotos.where('serviceId').equals(serviceId).count();

      // Calculate total blob bytes being purged
      let totalBlobBytes = 0;
      let fullResBlobCount = 0;
      let thumbBlobCount = 0;

      // Delete blobs for VERIFIED images only, keep LocalImage records with S3 keys
      for (const image of verifiedImages) {
        // Delete full-res blob if exists
        if (image.localBlobId) {
          const blob = await this.indexedDb.getLocalBlob(image.localBlobId);
          if (blob) totalBlobBytes += blob.sizeBytes || 0;
          await this.indexedDb.deleteLocalBlob(image.localBlobId);
          fullResBlobCount++;
        }
        // Delete thumbnail blob if exists
        if (image.thumbBlobId) {
          const thumbBlob = await this.indexedDb.getLocalBlob(image.thumbBlobId);
          if (thumbBlob) totalBlobBytes += thumbBlob.sizeBytes || 0;
          await this.indexedDb.deleteLocalBlob(image.thumbBlobId);
          thumbBlobCount++;
        }
        // Update LocalImage record - clear blob references but KEEP the record
        // This allows immediate S3 fallback via getDisplayUrl()
        await db.localImages.update(image.imageId, {
          localBlobId: null,
          thumbBlobId: null
        });
      }

      // Delete cached photos for this service (annotated image cache)
      await db.cachedPhotos.where('serviceId').equals(serviceId).delete();

      // NOTE: Field tables are NOT deleted - rehydration will refresh them from server
      // This matches clearAllSyncedData behavior for consistent rehydration flow

      // Output detailed purge stats
      console.log(`[BackgroundSync] ═══════════════════════════════════════════════════`);
      console.log(`[BackgroundSync] 🗑️ PURGE COMPLETE for service: ${serviceId}`);
      console.log(`[BackgroundSync] ═══════════════════════════════════════════════════`);
      console.log(`[BackgroundSync] 📸 Verified images processed: ${verifiedImages.length} of ${images.length}`);
      console.log(`[BackgroundSync]    - Full-res blobs freed: ${fullResBlobCount}`);
      console.log(`[BackgroundSync]    - Thumbnail blobs freed: ${thumbBlobCount}`);
      console.log(`[BackgroundSync]    - Total bytes freed: ${(totalBlobBytes / 1024 / 1024).toFixed(2)} MB`);
      console.log(`[BackgroundSync] 🖼️ Cached photos cleared: ${cachedPhotoCount}`);
      console.log(`[BackgroundSync] 📝 LocalImage records preserved with S3 keys for fallback`);
      console.log(`[BackgroundSync] ═══════════════════════════════════════════════════`);
    } catch (err) {
      console.warn(`[BackgroundSync] purgeServiceData error for ${serviceId}:`, err);
      throw err;
    }
  }

  // ============================================================================
  // MANUAL PURGE - User-initiated storage cleanup (Phase 6)
  // ============================================================================

  /**
   * Check if a service can be safely purged
   * Returns detailed status for UI to display appropriate warnings
   */
  async getServicePurgeStatus(serviceId: string): Promise<{
    canPurge: boolean;
    hasUnsyncedData: boolean;
    pendingCount: number;
    reasons: string[];
  }> {
    const { safe, reasons } = await this.serviceMetadata.isPurgeSafe(serviceId);
    const pendingCount = await this.serviceMetadata.getOutboxCount(serviceId);
    const metadata = await this.serviceMetadata.getServiceMetadata(serviceId);

    const hasUnsyncedData = pendingCount > 0 ||
      (metadata ? metadata.lastServerAckRevision < metadata.lastLocalRevision : false);

    return {
      canPurge: safe,
      hasUnsyncedData,
      pendingCount,
      reasons
    };
  }

  /**
   * Manually purge a service's local data
   * Use forceUnsafe=true to purge even if there's unsynced data (with user confirmation)
   *
   * @returns Result object with success status and any warnings
   */
  async manualPurgeService(
    serviceId: string,
    forceUnsafe: boolean = false
  ): Promise<{
    success: boolean;
    purgedImages: number;
    warning?: string;
    error?: string;
  }> {
    console.log(`[BackgroundSync] Manual purge requested for service: ${serviceId}, forceUnsafe: ${forceUnsafe}`);

    try {
      const status = await this.getServicePurgeStatus(serviceId);

      // Block if unsafe and not forced
      if (!status.canPurge && !forceUnsafe) {
        return {
          success: false,
          purgedImages: 0,
          warning: `Cannot purge: ${status.reasons.join(', ')}. Use force option to override.`
        };
      }

      // Warn if forcing unsafe purge
      let warning: string | undefined;
      if (!status.canPurge && forceUnsafe) {
        warning = `Forced purge with unsynced data: ${status.reasons.join(', ')}`;
        console.warn('[BackgroundSync] ⚠️', warning);
      }

      // Count images before purge
      const imagesBefore = await db.localImages.where('serviceId').equals(serviceId).count();

      // Perform the purge
      await this.purgeServiceData(serviceId);

      // Update service metadata
      await this.serviceMetadata.setPurgeState(serviceId, 'PURGED');

      return {
        success: true,
        purgedImages: imagesBefore,
        warning
      };
    } catch (err) {
      console.error('[BackgroundSync] Manual purge failed:', err);
      return {
        success: false,
        purgedImages: 0,
        error: err instanceof Error ? err.message : 'Unknown error'
      };
    }
  }

  /**
   * Get storage usage statistics for a service
   * Useful for showing users how much space they can free
   */
  async getServiceStorageStats(serviceId: string): Promise<{
    imageCount: number;
    blobCount: number;
    estimatedBytes: number;
  }> {
    try {
      const images = await db.localImages.where('serviceId').equals(serviceId).toArray();

      let blobCount = 0;
      let estimatedBytes = 0;

      for (const img of images) {
        if (img.localBlobId) {
          blobCount++;
          const blob = await db.localBlobs.get(img.localBlobId);
          if (blob) {
            estimatedBytes += blob.sizeBytes || 0;
          }
        }
        if (img.thumbBlobId) {
          const thumb = await db.localBlobs.get(img.thumbBlobId);
          if (thumb) {
            estimatedBytes += thumb.sizeBytes || 0;
          }
        }
      }

      return {
        imageCount: images.length,
        blobCount,
        estimatedBytes
      };
    } catch (err) {
      console.warn('[BackgroundSync] Error getting storage stats:', err);
      return { imageCount: 0, blobCount: 0, estimatedBytes: 0 };
    }
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

