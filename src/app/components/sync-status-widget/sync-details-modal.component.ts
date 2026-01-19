import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { BackgroundSyncService, SyncStatus } from '../../services/background-sync.service';
import { IndexedDbService, PendingCaptionUpdate } from '../../services/indexed-db.service';
import { Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { db } from '../../services/caspio-db';

@Component({
  selector: 'app-sync-details-modal',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Sync Status</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">
            <ion-icon name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    
    <ion-content class="ion-padding">
      <!-- Tab Selector -->
      <ion-segment [(ngModel)]="selectedTab" mode="ios" class="sync-tabs">
        <ion-segment-button value="queue">
          <ion-label>Queue ({{ queueCount }})</ion-label>
        </ion-segment-button>
        <ion-segment-button value="failed">
          <ion-label>
            <span class="failed-tab-label" [class.has-failed]="failedCount > 0">
              Failed ({{ failedCount }})
            </span>
          </ion-label>
        </ion-segment-button>
      </ion-segment>

      <!-- QUEUE TAB -->
      <div *ngIf="selectedTab === 'queue'" class="tab-content">
        <!-- Summary -->
        <div class="sync-summary">
          <div class="sync-stat" [class.active]="syncStatus.isSyncing">
            <ion-icon name="sync" [class.spinning]="syncStatus.isSyncing"></ion-icon>
            <span>{{ syncStatus.isSyncing ? 'Syncing...' : 'Idle' }}</span>
          </div>
          <div class="sync-stat pending">
            <span class="count">{{ pendingRequests.length + pendingCaptions.length + pendingPhotos.length }}</span>
            <span class="label">Pending</span>
          </div>
          <div class="sync-stat syncing">
            <span class="count">{{ syncingRequests.length }}</span>
            <span class="label">Syncing</span>
          </div>
        </div>

        <!-- Currently Syncing -->
        <div class="sync-section" *ngIf="syncingRequests.length > 0">
          <h4><ion-icon name="sync" class="spinning"></ion-icon> Currently Syncing</h4>
          <div class="request-list">
            <div class="request-item syncing" *ngFor="let req of syncingRequests">
              <ion-icon [name]="getRequestIcon(req)"></ion-icon>
              <span class="request-desc">{{ getRequestDescription(req) }}</span>
            </div>
          </div>
        </div>

        <!-- Pending Queue -->
        <div class="sync-section" *ngIf="pendingRequests.length > 0 || pendingCaptions.length > 0 || pendingPhotos.length > 0">
          <h4><ion-icon name="time-outline"></ion-icon> Waiting to Sync</h4>
          <div class="request-list">
            <!-- Pending Photos (new LocalImage system) -->
            <div class="request-item photo" *ngFor="let photo of pendingPhotos; let i = index">
              <span class="queue-number">{{ i + 1 }}</span>
              <ion-icon name="image-outline"></ion-icon>
              <span class="request-desc">Photo: {{ photo.fileName || 'Uploading...' }}</span>
              <span class="status-badge" *ngIf="photo.status">{{ photo.status }}</span>
            </div>
            <!-- Pending Captions/Annotations -->
            <div class="request-item caption"
                 *ngFor="let cap of pendingCaptions; let i = index"
                 [class.syncing]="cap.status === 'syncing'"
                 [class.failed]="cap.status === 'failed'">
              <span class="queue-number">{{ pendingPhotos.length + i + 1 }}</span>
              <ion-icon name="text-outline"></ion-icon>
              <span class="request-desc">{{ getCaptionDescription(cap) }}</span>
              <span class="status-badge" [class.syncing]="cap.status === 'syncing'" [class.failed]="cap.status === 'failed'">
                {{ getCaptionStatusLabel(cap) }}
              </span>
            </div>
            <!-- Pending Requests -->
            <div class="request-item" *ngFor="let req of pendingRequests; let i = index">
              <span class="queue-number">{{ pendingPhotos.length + pendingCaptions.length + i + 1 }}</span>
              <ion-icon [name]="getRequestIcon(req)"></ion-icon>
              <span class="request-desc">{{ getRequestDescription(req) }}</span>
              <span class="dependency-badge" *ngIf="req.dependencies?.length > 0" title="Waiting for dependencies">
                <ion-icon name="git-branch-outline"></ion-icon>
              </span>
            </div>
          </div>
        </div>

        <!-- Empty State for Queue -->
        <div class="empty-state" *ngIf="pendingRequests.length === 0 && syncingRequests.length === 0 && pendingCaptions.length === 0 && pendingPhotos.length === 0">
          <ion-icon name="checkmark-circle-outline" color="success"></ion-icon>
          <p>All changes synced!</p>
        </div>
      </div>

      <!-- FAILED TAB -->
      <div *ngIf="selectedTab === 'failed'" class="tab-content">
        <!-- Failed Items -->
        <div class="sync-section failed-section" *ngIf="failedRequests.length > 0 || failedCaptions.length > 0 || failedPhotos.length > 0">
          <div class="failed-header">
            <h4><ion-icon name="alert-circle-outline"></ion-icon> Failed Sync Items</h4>
            <p class="failed-subtitle">These items could not be synced. Tap an item to see error details.</p>
          </div>
          <div class="request-list">
            <!-- Failed Requests -->
            <div class="failed-item-card" *ngFor="let req of failedRequests" (click)="toggleErrorDetails(req.requestId)">
              <div class="failed-item-header">
                <ion-icon [name]="getRequestIcon(req)" class="failed-icon"></ion-icon>
                <span class="request-desc">{{ getRequestDescription(req) }}</span>
                <ion-button fill="clear" size="small" (click)="retryFailedRequest(req.requestId); $event.stopPropagation()" title="Retry this item">
                  <ion-icon name="refresh-outline" slot="icon-only"></ion-icon>
                </ion-button>
              </div>
              <div class="failed-item-error" *ngIf="req.error">
                <div class="error-summary">
                  <ion-icon name="warning-outline"></ion-icon>
                  <span>{{ req.error }}</span>
                </div>
                <div class="error-details" *ngIf="expandedErrorId === req.requestId">
                  <div class="error-detail-row" *ngIf="req.retryCount">
                    <span class="detail-label">Retry attempts:</span>
                    <span class="detail-value">{{ req.retryCount }}</span>
                  </div>
                  <div class="error-detail-row" *ngIf="req.lastAttempt">
                    <span class="detail-label">Last attempt:</span>
                    <span class="detail-value">{{ formatTimestamp(req.lastAttempt) }}</span>
                  </div>
                  <div class="error-detail-row" *ngIf="req.endpoint">
                    <span class="detail-label">Endpoint:</span>
                    <span class="detail-value endpoint">{{ req.endpoint }}</span>
                  </div>
                </div>
              </div>
            </div>
            <!-- Failed Photos -->
            <div class="failed-item-card" *ngFor="let photo of failedPhotos" (click)="toggleErrorDetails(photo.imageId)">
              <div class="failed-item-header">
                <ion-icon name="image-outline" class="failed-icon"></ion-icon>
                <span class="request-desc">Photo: {{ photo.fileName || photo.imageId }}</span>
                <ion-button fill="clear" size="small" (click)="retryFailedPhoto(photo.imageId); $event.stopPropagation()" title="Retry this item">
                  <ion-icon name="refresh-outline" slot="icon-only"></ion-icon>
                </ion-button>
              </div>
              <div class="failed-item-error" *ngIf="photo.lastError">
                <div class="error-summary">
                  <ion-icon name="warning-outline"></ion-icon>
                  <span>{{ photo.lastError }}</span>
                </div>
                <div class="error-details" *ngIf="expandedErrorId === photo.imageId">
                  <div class="error-detail-row">
                    <span class="detail-label">Entity type:</span>
                    <span class="detail-value">{{ photo.entityType }}</span>
                  </div>
                  <div class="error-detail-row">
                    <span class="detail-label">Entity ID:</span>
                    <span class="detail-value endpoint">{{ photo.entityId }}</span>
                  </div>
                  <div class="error-detail-row" *ngIf="photo.createdAt">
                    <span class="detail-label">Created:</span>
                    <span class="detail-value">{{ formatTimestamp(photo.createdAt) }}</span>
                  </div>
                </div>
              </div>
            </div>
            <!-- Failed Captions -->
            <div class="failed-item-card" *ngFor="let cap of failedCaptions" (click)="toggleErrorDetails(cap.captionId)">
              <div class="failed-item-header">
                <ion-icon name="text-outline" class="failed-icon"></ion-icon>
                <span class="request-desc">{{ getCaptionDescription(cap) }}</span>
                <ion-button fill="clear" size="small" (click)="retryFailedCaption(cap.captionId); $event.stopPropagation()" title="Retry this item">
                  <ion-icon name="refresh-outline" slot="icon-only"></ion-icon>
                </ion-button>
              </div>
              <div class="failed-item-error" *ngIf="cap.error">
                <div class="error-summary">
                  <ion-icon name="warning-outline"></ion-icon>
                  <span>{{ cap.error }}</span>
                </div>
                <div class="error-details" *ngIf="expandedErrorId === cap.captionId">
                  <div class="error-detail-row" *ngIf="cap.retryCount">
                    <span class="detail-label">Retry attempts:</span>
                    <span class="detail-value">{{ cap.retryCount }}</span>
                  </div>
                  <div class="error-detail-row" *ngIf="cap.lastAttempt">
                    <span class="detail-label">Last attempt:</span>
                    <span class="detail-value">{{ formatTimestamp(cap.lastAttempt) }}</span>
                  </div>
                  <div class="error-detail-row">
                    <span class="detail-label">Attach ID:</span>
                    <span class="detail-value endpoint">{{ cap.attachId }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <!-- Retry All Failed button -->
          <ion-button expand="block" fill="outline" color="warning" (click)="retryAllFailed()" *ngIf="failedRequests.length + failedCaptions.length + failedPhotos.length > 1" class="retry-all-btn">
            <ion-icon name="refresh" slot="start"></ion-icon>
            Retry All Failed ({{ failedRequests.length + failedCaptions.length + failedPhotos.length }})
          </ion-button>
          <!-- Clear All Failed button -->
          <ion-button expand="block" fill="outline" color="danger" (click)="clearAllFailed()" *ngIf="failedRequests.length + failedCaptions.length + failedPhotos.length > 0" class="clear-failed-btn">
            <ion-icon name="trash-outline" slot="start"></ion-icon>
            Clear All Failed ({{ failedRequests.length + failedCaptions.length + failedPhotos.length }})
          </ion-button>
        </div>

        <!-- Empty State for Failed -->
        <div class="empty-state" *ngIf="failedRequests.length === 0 && failedCaptions.length === 0 && failedPhotos.length === 0">
          <ion-icon name="checkmark-circle-outline" color="success"></ion-icon>
          <p>No failed sync items</p>
        </div>
      </div>
    </ion-content>

    <ion-footer>
      <ion-toolbar>
        <div class="footer-buttons">
          <ion-button expand="block" (click)="forceSync()" [disabled]="syncStatus.isSyncing">
            <ion-icon name="sync" slot="start"></ion-icon>
            {{ syncStatus.isSyncing ? 'Syncing...' : 'Sync Now' }}
          </ion-button>
          <ion-button expand="block" fill="outline" color="danger" (click)="clearStuckRequests()" [disabled]="syncStatus.isSyncing || stuckCount === 0">
            <ion-icon name="trash-outline" slot="start"></ion-icon>
            Clear Stuck ({{ stuckCount }})
          </ion-button>
          <ion-button expand="block" fill="outline" color="warning" (click)="clearAllPending()" [disabled]="syncStatus.isSyncing || totalPendingCount === 0">
            <ion-icon name="close-circle-outline" slot="start"></ion-icon>
            Clear All Pending ({{ totalPendingCount }})
          </ion-button>
          <ion-button expand="block" fill="outline" (click)="refreshDetails()">
            <ion-icon name="refresh" slot="start"></ion-icon>
            Refresh
          </ion-button>
        </div>
      </ion-toolbar>
    </ion-footer>
  `,
  styles: [`
    .sync-summary {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--ion-color-light);
      flex-wrap: wrap;
    }

    .sync-stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px 12px;
      background: var(--ion-color-light);
      border-radius: 8px;
      min-width: 60px;
      flex: 1;
    }

    .sync-stat.active {
      background: #fff3cd;
    }

    .sync-stat.active ion-icon {
      color: #856404;
    }

    .sync-stat.pending .count {
      color: #f0ad4e;
    }

    .sync-stat.syncing .count {
      color: #5bc0de;
    }

    .sync-stat.failed .count {
      color: #d9534f;
    }

    .sync-stat .count {
      font-size: 20px;
      font-weight: 700;
    }

    .sync-stat .label {
      font-size: 11px;
      color: var(--ion-color-medium);
      text-transform: uppercase;
    }

    .sync-stat ion-icon {
      font-size: 20px;
    }

    .sync-section {
      margin-bottom: 20px;
    }

    .sync-section h4 {
      margin: 0 0 10px 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--ion-color-medium-shade);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .sync-section h4 ion-icon {
      font-size: 16px;
    }

    .sync-section.failed-section h4 {
      color: #d9534f;
    }

    .request-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .request-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: var(--ion-color-light);
      border-radius: 8px;
      font-size: 13px;
    }

    .request-item ion-icon {
      font-size: 18px;
      color: var(--ion-color-medium);
      flex-shrink: 0;
    }

    .request-item .queue-number {
      width: 20px;
      height: 20px;
      background: var(--ion-color-medium-tint);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 600;
      color: var(--ion-color-medium-shade);
      flex-shrink: 0;
    }

    .request-item .request-desc {
      flex: 1;
      color: var(--ion-color-dark);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .request-item .dependency-badge {
      color: #f0ad4e;
      font-size: 14px;
      flex-shrink: 0;
    }

    .request-item .error-msg {
      font-size: 11px;
      color: #d9534f;
      flex-shrink: 0;
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .request-item ion-button {
      --padding-start: 4px;
      --padding-end: 4px;
      margin: 0;
      flex-shrink: 0;
    }

    .retry-all-btn {
      margin-top: 12px;
    }

    .request-item.syncing {
      background: #e8f4fd;
      border-left: 3px solid #5bc0de;
    }

    .request-item.syncing ion-icon {
      color: #5bc0de;
    }

    .request-item.failed {
      background: #fdf2f2;
      border-left: 3px solid #d9534f;
    }

    .request-item.failed ion-icon {
      color: #d9534f;
    }

    .request-item.caption {
      background: #f0f9ff;
      border-left: 3px solid #0ea5e9;
    }

    .request-item.caption ion-icon {
      color: #0ea5e9;
    }

    .request-item.photo {
      background: #f0fdf4;
      border-left: 3px solid #22c55e;
    }

    .request-item.photo ion-icon {
      color: #22c55e;
    }

    .request-item .status-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--ion-color-light-shade);
      color: var(--ion-color-medium-shade);
      text-transform: uppercase;
    }

    .empty-state {
      text-align: center;
      padding: 30px 20px;
      color: var(--ion-color-medium);
    }

    .empty-state ion-icon {
      font-size: 48px;
      margin-bottom: 10px;
    }

    .empty-state p {
      margin: 0;
      font-size: 14px;
    }

    .footer-buttons {
      display: flex;
      gap: 10px;
      padding: 8px;
    }

    .footer-buttons ion-button {
      flex: 1;
    }

    .spinning {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* Tab Styles */
    .sync-tabs {
      margin-bottom: 16px;
    }

    .tab-content {
      min-height: 200px;
    }

    .failed-tab-label {
      color: inherit;
    }

    .failed-tab-label.has-failed {
      color: #d9534f;
      font-weight: 600;
    }

    /* Failed Item Card Styles */
    .failed-header {
      margin-bottom: 12px;
    }

    .failed-header h4 {
      margin-bottom: 4px;
    }

    .failed-subtitle {
      font-size: 12px;
      color: var(--ion-color-medium);
      margin: 0;
    }

    .failed-item-card {
      background: #fdf2f2;
      border: 1px solid #fca5a5;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: background-color 0.2s;
    }

    .failed-item-card:hover {
      background: #fee2e2;
    }

    .failed-item-card:active {
      background: #fecaca;
    }

    .failed-item-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .failed-item-header .failed-icon {
      font-size: 20px;
      color: #dc2626;
      flex-shrink: 0;
    }

    .failed-item-header .request-desc {
      flex: 1;
      font-size: 13px;
      font-weight: 500;
      color: var(--ion-color-dark);
    }

    .failed-item-header ion-button {
      --padding-start: 6px;
      --padding-end: 6px;
      margin: 0;
    }

    .failed-item-error {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #fca5a5;
    }

    .error-summary {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      color: #b91c1c;
      font-size: 12px;
    }

    .error-summary ion-icon {
      font-size: 14px;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .error-summary span {
      word-break: break-word;
    }

    .error-details {
      margin-top: 10px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.5);
      border-radius: 6px;
      font-size: 11px;
    }

    .error-detail-row {
      display: flex;
      gap: 8px;
      margin-bottom: 6px;
    }

    .error-detail-row:last-child {
      margin-bottom: 0;
    }

    .detail-label {
      color: var(--ion-color-medium-shade);
      flex-shrink: 0;
      min-width: 90px;
    }

    .detail-value {
      color: var(--ion-color-dark);
      word-break: break-word;
    }

    .detail-value.endpoint {
      font-family: monospace;
      font-size: 10px;
      background: var(--ion-color-light);
      padding: 2px 4px;
      border-radius: 3px;
    }
  `],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SyncDetailsModalComponent implements OnInit, OnDestroy {
  syncStatus: SyncStatus = {
    isSyncing: false,
    pendingCount: 0,
    syncedCount: 0,
    failedCount: 0,
  };

  // Tab state
  selectedTab: 'queue' | 'failed' = 'queue';
  expandedErrorId: string | null = null;

  pendingRequests: any[] = [];
  syncingRequests: any[] = [];
  failedRequests: any[] = [];
  failedCaptions: PendingCaptionUpdate[] = [];
  failedPhotos: any[] = [];  // Failed LocalImage uploads
  pendingCaptions: PendingCaptionUpdate[] = [];
  pendingPhotos: any[] = [];  // New LocalImage system photos waiting to upload
  stuckCount: number = 0;
  totalPendingCount: number = 0;

  // Computed counts for tabs
  get queueCount(): number {
    return this.pendingRequests.length + this.pendingCaptions.length +
           this.pendingPhotos.length + this.syncingRequests.length;
  }

  get failedCount(): number {
    return this.failedRequests.length + this.failedCaptions.length + this.failedPhotos.length;
  }

  private subscription?: Subscription;
  private liveQuerySub?: Subscription;
  private refreshInterval?: any;

  constructor(
    private modalController: ModalController,
    private backgroundSync: BackgroundSyncService,
    private indexedDb: IndexedDbService,
    private changeDetectorRef: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

  ngOnInit() {
    // Subscribe to sync status updates
    this.subscription = this.backgroundSync.syncStatus$.subscribe(
      status => {
        this.syncStatus = status;
        this.changeDetectorRef.markForCheck();
      }
    );

    // CRITICAL: Use SINGLE Dexie liveQuery for all data to avoid combineLatest inconsistency
    // When separate liveQueries are used with combineLatest, adding a photo to uploadOutbox
    // can cause pendingRequests liveQuery to return stale/empty data
    this.liveQuerySub = db.liveSyncModalData$().pipe(
      debounceTime(250) // Debounce rapid-fire updates
    ).subscribe(async ({ requests, captions, outboxItems, failedImages }) => {
      console.log('[SyncModal] Dexie liveQuery update:', {
        requests: requests.length,
        captions: captions.length,
        outbox: outboxItems.length,
        failedImages: failedImages.length
      });

      // Update requests by status (fast filter operations)
      const pendingReqs = requests.filter(r => r.status === 'pending');
      const syncingReqs = requests.filter(r => r.status === 'syncing');
      const failedReqs = requests.filter(r => r.status === 'failed');

      // Separate pending captions from failed captions for UI display
      const pendingCaps = captions.filter(c => c.status === 'pending' || c.status === 'syncing');
      const failedCaps = captions.filter(c => c.status === 'failed');

      // FIXED: Batch load pending photos using Promise.all instead of sequential loop
      let photos: any[] = [];
      try {
        // DEBUG: Log outbox items received
        console.log('[SyncModal] Processing outbox items:', outboxItems.length, 'items');
        if (outboxItems.length > 0) {
          console.log('[SyncModal] Outbox imageIds:', outboxItems.map(i => i.imageId));
        }

        const photoPromises = outboxItems.map(async (item) => {
          const localImage = await this.indexedDb.getLocalImage(item.imageId);
          // DEBUG: Log each lookup result
          console.log(`[SyncModal] getLocalImage(${item.imageId}):`, localImage ? 'FOUND' : 'NOT FOUND');
          if (localImage) {
            return {
              ...item,
              fileName: localImage.fileName,
              status: localImage.status
            };
          }
          return null;
        });
        const results = await Promise.all(photoPromises);
        photos = results.filter(p => p !== null);
        console.log('[SyncModal] Final photos count:', photos.length);
      } catch (e) {
        console.warn('[SyncModal] Error loading photo details:', e);
      }

      // Calculate stuck count (before NgZone)
      const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
      const stuckRequests = pendingReqs.filter(r =>
        r.createdAt < thirtyMinutesAgo && (r.retryCount || 0) > 5
      ).length;
      const staleCaptions = pendingCaps.filter(c =>
        c.createdAt < thirtyMinutesAgo && (c.retryCount || 0) > 5
      ).length;

      // Update UI in NgZone (single batch update)
      this.ngZone.run(() => {
        this.pendingRequests = pendingReqs;
        this.syncingRequests = syncingReqs;
        this.failedRequests = failedReqs;
        this.failedCaptions = failedCaps;
        this.failedPhotos = failedImages;
        this.pendingCaptions = pendingCaps;
        this.pendingPhotos = photos;
        this.totalPendingCount = pendingReqs.length + pendingCaps.length +
                                  photos.length + failedReqs.length + failedCaps.length + failedImages.length;
        this.stuckCount = stuckRequests + staleCaptions;
        this.changeDetectorRef.markForCheck();
      });
    });

    // Fallback refresh every 10 seconds (increased from 5 since liveQuery handles real-time)
    this.refreshInterval = setInterval(() => {
      this.refreshDetails();
    }, 10000);

    // Load initial data
    this.refreshDetails();
  }

  ngOnDestroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
    if (this.liveQuerySub) {
      this.liveQuerySub.unsubscribe();
    }
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  dismiss() {
    this.modalController.dismiss();
  }

  async forceSync() {
    await this.backgroundSync.forceSyncNow();
  }

  async clearStuckRequests() {
    console.log('[SyncModal] Clearing stuck/broken requests...');
    
    // CRITICAL FIX: First reset old pending requests with high retry counts
    // Give them a fresh start by resetting retry count to 0
    const resetCount = await this.indexedDb.forceRetryOldRequests(10); // 10 min old with retries
    console.log(`[SyncModal] Reset ${resetCount} old pending requests for retry`);
    
    // Clear requests older than 30 minutes with high retry count (truly stuck requests)
    const clearedRequests = await this.indexedDb.clearOldPendingRequests(30);
    console.log(`[SyncModal] Cleared ${clearedRequests} stuck requests`);
    
    // Also clear stale pending captions
    const clearedCaptions = await this.indexedDb.clearStalePendingCaptions(30);
    console.log(`[SyncModal] Cleared ${clearedCaptions} stale captions`);
    
    // CRITICAL FIX: Also clean up stuck upload outbox items
    const clearedOutbox = await this.indexedDb.cleanupStuckUploadOutboxItems(30); // 30 min old
    console.log(`[SyncModal] Cleared ${clearedOutbox} stuck upload outbox items`);
    
    // Trigger a sync to retry the reset items
    await this.backgroundSync.forceSyncNow();
    
    // Refresh the list immediately
    await this.refreshDetails();
  }

  async refreshDetails() {
    // NOTE: This method is now mostly a fallback since liveQuery handles real-time updates
    // We only use this for calculating stuck counts which require more complex queries
    try {
      // Stuck count calculation (requires checking timestamps)
      const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
      const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
      
      // Count requests that are stuck pending with high retry counts
      const stuckRequests = this.pendingRequests.filter(r => 
        (r.createdAt < thirtyMinutesAgo && (r.retryCount || 0) > 5) ||
        (r.createdAt < tenMinutesAgo && (r.retryCount || 0) >= 3) // Also count 10+ min old with 3+ retries
      ).length;
      
      // Also count stale captions as stuck
      const staleCaptions = await this.indexedDb.getStaleCaptionCount(30);
      
      // Also count stuck upload outbox items
      const allOutbox = await this.indexedDb.getAllUploadOutboxItems();
      const stuckOutbox = allOutbox.filter(item => 
        item.createdAt < tenMinutesAgo && item.attempts >= 3
      ).length;
      
      this.stuckCount = stuckRequests + staleCaptions + stuckOutbox;
      
      // Total count is updated by liveQuery, but update here as fallback
      this.totalPendingCount = this.pendingRequests.length + this.pendingCaptions.length + 
                                this.pendingPhotos.length + this.failedRequests.length;
      
      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('[SyncModal] Error in refreshDetails:', error);
    }
  }

  async clearAllPending() {
    console.log('[SyncModal] Clearing ALL pending sync items...');
    const result = await this.indexedDb.clearAllPendingSync();
    console.log(`[SyncModal] Cleared: ${result.requests} requests, ${result.captions} captions, ${result.images} images, ${result.outbox} outbox, ${result.localImages} stuck localImages`);

    // TASK 3 FIX: Refresh background sync status so widget shows correct count
    await this.backgroundSync.refreshSyncStatus();

    // Refresh the list immediately
    await this.refreshDetails();
  }

  getRequestIcon(request: any): string {
    const endpoint = request.endpoint || '';
    const data = request.data || {};

    // FDF photo deletion
    if (data._displayType === 'FDF_PHOTO_DELETE') {
      return 'trash-outline';
    }

    // Annotation/drawing updates
    if (endpoint.includes('Attach') && request.type === 'UPDATE' && (data.Drawings !== undefined || data.Annotation !== undefined)) {
      return 'brush-outline';
    }
    if (endpoint.includes('Attach') || request.type === 'PHOTO_UPLOAD') {
      return 'image-outline';
    }
    if (endpoint.includes('Services_Visuals')) {
      return 'eye-outline';
    }
    if (endpoint.includes('Services_EFE_Points')) {
      return 'pin-outline';
    }
    if (endpoint.includes('Services_EFE')) {
      return 'home-outline';
    }
    if (endpoint.includes('Services')) {
      return 'document-outline';
    }
    
    switch (request.type) {
      case 'CREATE': return 'add-circle-outline';
      case 'UPDATE': return 'create-outline';
      case 'DELETE': return 'trash-outline';
      default: return 'cloud-outline';
    }
  }

  getRequestDescription(request: any): string {
    const endpoint = request.endpoint || '';
    const type = request.type || '';
    const data = request.data || {};

    // FDF photo deletion (from room-elevation page)
    if (data._displayType === 'FDF_PHOTO_DELETE') {
      const photoType = data._photoType || 'FDF';
      const roomName = data._roomName || '';
      if (roomName) {
        return `Delete FDF ${photoType} photo: ${roomName}`.substring(0, 50);
      }
      return `Delete FDF ${photoType} photo`;
    }

    // Visual photo uploads
    if (endpoint === 'VISUAL_PHOTO_UPLOAD') {
      const category = data.category || '';
      const itemName = data.visualItemName || data.fileName || '';
      if (category && itemName) {
        return `Photo: ${category} - ${itemName}`.substring(0, 50);
      }
      return `Upload photo: ${data.fileName || 'Photo'}`;
    }
    
    // EFE point photo uploads
    if (endpoint === 'EFE_POINT_PHOTO_UPLOAD') {
      const pointName = data.pointName || data.photoType || '';
      const roomName = data.roomName || '';
      if (roomName && pointName) {
        return `Photo: ${roomName} - ${pointName}`.substring(0, 50);
      }
      return `Elevation photo: ${pointName || data.fileName || 'Photo'}`;
    }
    
    // Photo uploads (generic)
    if (type === 'PHOTO_UPLOAD' || type === 'EFE_PHOTO_UPLOAD') {
      const photoType = data.photoType || 'Photo';
      return `Upload ${photoType} photo`;
    }
    
    // Visual attachments
    if (endpoint.includes('Services_Visuals_Attach')) {
      if (type === 'DELETE') {
        return `Delete photo: ${data.fileName || 'Visual photo'}`;
      }
      if (type === 'UPDATE') {
        if (data.Annotation !== undefined && data.Drawings !== undefined) {
          return `Save annotations: Visual photo`;
        }
        if (data.Annotation !== undefined) {
          return `Save caption: Visual photo`;
        }
        if (data.Drawings !== undefined) {
          return `Save drawings: Visual photo`;
        }
        return `Update: Visual photo`;
      }
      return `Upload photo: ${data.fileName || 'Visual photo'}`;
    }
    
    // Visuals
    if (endpoint.includes('Services_Visuals') && !endpoint.includes('Attach')) {
      const category = data.Category || '';
      const item = data.VisualItem || data.Name || '';
      const kind = data.Kind || '';
      
      if (type === 'CREATE') {
        if (category && item) {
          return `Add ${kind || 'item'}: ${category} - ${item}`.substring(0, 50);
        }
        return `Add ${kind || 'visual'}: ${category || 'New item'}`;
      }
      if (type === 'UPDATE') {
        if (data.Notes !== undefined) return `Update notes: ${item || category}`.substring(0, 50);
        if (data.OtherValue !== undefined) return `Update value: ${item || category}`.substring(0, 50);
        return `Update: ${item || category || 'Visual'}`.substring(0, 50);
      }
      if (type === 'DELETE') {
        return `Remove: ${item || category || 'Visual'}`.substring(0, 50);
      }
    }
    
    // EFE Point Attachments (annotations/captions)
    if (endpoint.includes('Services_EFE_Points_Attach')) {
      if (type === 'DELETE') {
        return `Delete photo: ${data.fileName || 'Elevation photo'}`;
      }
      if (type === 'UPDATE') {
        if (data.Annotation !== undefined && data.Drawings !== undefined) {
          return `Save annotations: Elevation photo`;
        }
        if (data.Annotation !== undefined) {
          return `Save caption: Elevation photo`;
        }
        if (data.Drawings !== undefined) {
          return `Save drawings: Elevation photo`;
        }
        return `Update: Elevation photo`;
      }
      return `Elevation photo: ${data.fileName || 'Photo'}`;
    }
    
    // EFE Points
    if (endpoint.includes('Services_EFE_Points') && !endpoint.includes('Attach')) {
      const pointName = data.PointName || '';
      if (type === 'CREATE') {
        return `Add point: ${pointName || 'Elevation point'}`;
      }
      if (type === 'UPDATE') {
        if (data.Elevation !== undefined) return `Elevation: ${pointName} = ${data.Elevation}`;
        if (data.Notes !== undefined) return `Notes: ${pointName}`;
        return `Update: ${pointName || 'Point'}`;
      }
    }
    
    // EFE Rooms
    if (endpoint.includes('Services_EFE') && !endpoint.includes('Points') && !endpoint.includes('Attach')) {
      const roomName = data.RoomName || '';
      if (type === 'CREATE') {
        return `Add room: ${roomName || 'Room'}`;
      }
      if (type === 'UPDATE') {
        if (data.FDF !== undefined) return `FDF: ${roomName}`;
        if (data.Location !== undefined) return `Location: ${roomName}`;
        if (data.Notes !== undefined) return `Notes: ${roomName}`;
        return `Update: ${roomName || 'Room'}`;
      }
    }
    
    // EFE Attachments (generic)
    if (endpoint.includes('EFE') && endpoint.includes('Attach')) {
      if (type === 'UPDATE' && (data.Annotation !== undefined || data.Drawings !== undefined)) {
        return `Save annotations: Photo`;
      }
      return `Elevation photo: ${data.fileName || 'Photo'}`;
    }
    
    // Service/Project updates
    if (endpoint.includes('/Services/') && type === 'UPDATE') {
      return 'Update service data';
    }
    if (endpoint.includes('/Projects/') && type === 'UPDATE') {
      return 'Update project data';
    }
    
    // Generic
    if (type === 'CREATE') return 'Add new item';
    if (type === 'UPDATE') return 'Update item';
    if (type === 'DELETE') return 'Remove item';
    
    return 'Sync data';
  }

  /**
   * Get description for a pending caption update
   */
  getCaptionDescription(caption: PendingCaptionUpdate): string {
    const hasCaption = caption.caption !== undefined;
    const hasDrawings = caption.drawings !== undefined;
    
    let typeLabel = 'Photo';
    if (caption.attachType === 'visual') {
      typeLabel = 'Visual';
    } else if (caption.attachType === 'efe_point') {
      typeLabel = 'Elevation';
    } else if (caption.attachType === 'fdf') {
      typeLabel = 'FDF';
    }
    
    // Calculate age for debugging
    const ageMinutes = Math.round((Date.now() - caption.createdAt) / 60000);
    const ageStr = ageMinutes > 60 ? `${Math.round(ageMinutes / 60)}h` : `${ageMinutes}m`;
    const isStale = ageMinutes > 30;
    const staleIndicator = isStale ? ' ⚠️' : '';
    
    // Show if waiting for temp ID resolution
    const attachIdStr = String(caption.attachId || '');
    const hasTempId = attachIdStr.startsWith('temp_');
    const waitingIndicator = hasTempId ? ' (waiting for photo)' : '';
    
    if (hasCaption && hasDrawings) {
      return `${typeLabel}: caption & drawings${waitingIndicator}${staleIndicator}`;
    } else if (hasCaption) {
      const captionPreview = caption.caption!.substring(0, 15);
      return `${typeLabel}: "${captionPreview}${caption.caption!.length > 15 ? '...' : ''}"${waitingIndicator}${staleIndicator}`;
    } else if (hasDrawings) {
      return `${typeLabel}: drawings${waitingIndicator}${staleIndicator}`;
    }
    
    return `${typeLabel}: update${waitingIndicator}${staleIndicator}`;
  }

  /**
   * Get status label for a pending caption
   */
  getCaptionStatusLabel(caption: PendingCaptionUpdate): string {
    const attachIdStr = String(caption.attachId || '');
    const hasTempId = attachIdStr.startsWith('temp_') || attachIdStr.startsWith('img_');

    switch (caption.status) {
      case 'syncing':
        return 'syncing';
      case 'failed':
        return 'failed';
      case 'synced':
        return 'synced';
      case 'pending':
      default:
        if (hasTempId) {
          return 'waiting';
        }
        return 'pending';
    }
  }

  /**
   * Retry a single failed request
   */
  async retryFailedRequest(requestId: string): Promise<void> {
    console.log(`[SyncModal] Retrying failed request: ${requestId}`);
    const success = await this.indexedDb.retryRequest(requestId);
    if (success) {
      // Trigger sync to process the retry immediately
      await this.backgroundSync.forceSyncNow();
    }
  }

  /**
   * Retry a single failed caption update
   */
  async retryFailedCaption(captionId: string): Promise<void> {
    console.log(`[SyncModal] Retrying failed caption: ${captionId}`);
    const success = await this.indexedDb.retryCaption(captionId);
    if (success) {
      // Trigger sync to process the retry immediately
      await this.backgroundSync.forceSyncNow();
    }
  }

  /**
   * Retry a single failed photo upload
   */
  async retryFailedPhoto(imageId: string): Promise<void> {
    console.log(`[SyncModal] Retrying failed photo: ${imageId}`);
    // Reset the photo status to 'queued' and re-add to outbox
    await this.indexedDb.retryFailedPhoto(imageId);
    // Trigger sync to process the retry immediately
    await this.backgroundSync.forceSyncNow();
  }

  /**
   * Retry all failed items (requests, captions, and photos)
   */
  async retryAllFailed(): Promise<void> {
    console.log(`[SyncModal] Retrying all failed items...`);

    // Reset all failed requests
    for (const req of this.failedRequests) {
      await this.indexedDb.retryRequest(req.requestId);
    }

    // Reset all failed captions
    for (const cap of this.failedCaptions) {
      await this.indexedDb.retryCaption(cap.captionId);
    }

    // Reset all failed photos
    for (const photo of this.failedPhotos) {
      await this.indexedDb.retryFailedPhoto(photo.imageId);
    }

    console.log(`[SyncModal] Reset ${this.failedRequests.length} requests, ${this.failedCaptions.length} captions, and ${this.failedPhotos.length} photos for retry`);

    // Trigger sync to process all retries
    await this.backgroundSync.forceSyncNow();
  }

  /**
   * Clear all failed items permanently (removes stale failure data)
   */
  async clearAllFailed(): Promise<void> {
    console.log(`[SyncModal] Clearing all failed items...`);
    const result = await this.indexedDb.clearAllFailed();
    console.log(`[SyncModal] Cleared: ${result.requests} requests, ${result.captions} captions, ${result.photos} photos`);

    // Refresh sync status so widget shows correct count
    await this.backgroundSync.refreshSyncStatus();

    // Refresh the list immediately
    await this.refreshDetails();
  }

  /**
   * Toggle expanded error details for a failed item
   */
  toggleErrorDetails(id: string): void {
    if (this.expandedErrorId === id) {
      this.expandedErrorId = null;
    } else {
      this.expandedErrorId = id;
    }
    this.changeDetectorRef.markForCheck();
  }

  /**
   * Format a timestamp for display
   */
  formatTimestamp(timestamp: number): string {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) {
      return 'Just now';
    } else if (diffMins < 60) {
      return `${diffMins} min ago`;
    } else if (diffMins < 1440) {
      const hours = Math.floor(diffMins / 60);
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
}

