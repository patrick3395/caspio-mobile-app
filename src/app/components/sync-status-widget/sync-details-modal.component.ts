import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { BackgroundSyncService, SyncStatus } from '../../services/background-sync.service';
import { IndexedDbService } from '../../services/indexed-db.service';
import { Subscription } from 'rxjs';

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
      <!-- Summary -->
      <div class="sync-summary">
        <div class="sync-stat" [class.active]="syncStatus.isSyncing">
          <ion-icon name="sync" [class.spinning]="syncStatus.isSyncing"></ion-icon>
          <span>{{ syncStatus.isSyncing ? 'Syncing...' : 'Idle' }}</span>
        </div>
        <div class="sync-stat pending">
          <span class="count">{{ pendingRequests.length }}</span>
          <span class="label">Pending</span>
        </div>
        <div class="sync-stat syncing">
          <span class="count">{{ syncingRequests.length }}</span>
          <span class="label">Syncing</span>
        </div>
        <div class="sync-stat failed" *ngIf="failedRequests.length > 0">
          <span class="count">{{ failedRequests.length }}</span>
          <span class="label">Failed</span>
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
      <div class="sync-section" *ngIf="pendingRequests.length > 0">
        <h4><ion-icon name="time-outline"></ion-icon> Waiting to Sync</h4>
        <div class="request-list">
          <div class="request-item" *ngFor="let req of pendingRequests; let i = index">
            <span class="queue-number">{{ i + 1 }}</span>
            <ion-icon [name]="getRequestIcon(req)"></ion-icon>
            <span class="request-desc">{{ getRequestDescription(req) }}</span>
            <span class="dependency-badge" *ngIf="req.dependencies?.length > 0" title="Waiting for dependencies">
              <ion-icon name="git-branch-outline"></ion-icon>
            </span>
          </div>
        </div>
      </div>

      <!-- Failed -->
      <div class="sync-section failed-section" *ngIf="failedRequests.length > 0">
        <h4><ion-icon name="alert-circle-outline"></ion-icon> Failed</h4>
        <div class="request-list">
          <div class="request-item failed" *ngFor="let req of failedRequests">
            <ion-icon [name]="getRequestIcon(req)"></ion-icon>
            <span class="request-desc">{{ getRequestDescription(req) }}</span>
            <span class="error-msg" *ngIf="req.error">{{ req.error }}</span>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div class="empty-state" *ngIf="pendingRequests.length === 0 && syncingRequests.length === 0 && failedRequests.length === 0">
        <ion-icon name="checkmark-circle-outline" color="success"></ion-icon>
        <p>All changes synced!</p>
      </div>
    </ion-content>

    <ion-footer>
      <ion-toolbar>
        <div class="footer-buttons">
          <ion-button expand="block" (click)="forceSync()" [disabled]="syncStatus.isSyncing">
            <ion-icon name="sync" slot="start"></ion-icon>
            {{ syncStatus.isSyncing ? 'Syncing...' : 'Sync Now' }}
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
  `],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class SyncDetailsModalComponent implements OnInit {
  syncStatus: SyncStatus = {
    isSyncing: false,
    pendingCount: 0,
    syncedCount: 0,
    failedCount: 0,
  };

  pendingRequests: any[] = [];
  syncingRequests: any[] = [];
  failedRequests: any[] = [];

  private subscription?: Subscription;

  constructor(
    private modalController: ModalController,
    private backgroundSync: BackgroundSyncService,
    private indexedDb: IndexedDbService,
    private changeDetectorRef: ChangeDetectorRef
  ) {}

  ngOnInit() {
    // Subscribe to sync status updates
    this.subscription = this.backgroundSync.syncStatus$.subscribe(
      status => {
        this.syncStatus = status;
        this.changeDetectorRef.detectChanges();
      }
    );

    // Load initial data
    this.refreshDetails();
  }

  ngOnDestroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }

  dismiss() {
    this.modalController.dismiss();
  }

  async forceSync() {
    await this.backgroundSync.forceSyncNow();
  }

  async refreshDetails() {
    try {
      const requests = await this.indexedDb.getAllRequests();
      
      this.pendingRequests = requests.filter(r => r.status === 'pending');
      this.syncingRequests = requests.filter(r => r.status === 'syncing');
      this.failedRequests = requests.filter(r => r.status === 'failed');
      
      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('[SyncModal] Error loading details:', error);
    }
  }

  getRequestIcon(request: any): string {
    const endpoint = request.endpoint || '';
    
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
    
    // Photo uploads
    if (type === 'PHOTO_UPLOAD' || type === 'EFE_PHOTO_UPLOAD') {
      const photoType = data.photoType || 'Photo';
      return `Upload ${photoType} photo`;
    }
    
    // Visual attachments
    if (endpoint.includes('Services_Visuals_Attach')) {
      return 'Upload visual photo';
    }
    
    // Visuals
    if (endpoint.includes('Services_Visuals') && !endpoint.includes('Attach')) {
      if (type === 'CREATE') {
        const category = data.Category || '';
        const item = data.VisualItem || '';
        return `Create: ${category} - ${item}`.substring(0, 50);
      }
      if (type === 'UPDATE') {
        return 'Update visual';
      }
      if (type === 'DELETE') {
        return 'Delete visual';
      }
    }
    
    // EFE Points
    if (endpoint.includes('Services_EFE_Points')) {
      if (type === 'CREATE') {
        const pointName = data.PointName || 'Elevation point';
        return `Create point: ${pointName}`;
      }
      return 'Update elevation point';
    }
    
    // EFE Rooms
    if (endpoint.includes('Services_EFE') && !endpoint.includes('Points') && !endpoint.includes('Attach')) {
      if (type === 'CREATE') {
        const roomName = data.RoomName || 'Room';
        return `Create room: ${roomName}`;
      }
      if (type === 'UPDATE') {
        if (data.FDF) return 'Update FDF';
        if (data.Location) return 'Update location';
        if (data.Notes) return 'Update notes';
        return 'Update room data';
      }
    }
    
    // EFE Attachments
    if (endpoint.includes('EFE') && endpoint.includes('Attach')) {
      return 'Upload EFE photo';
    }
    
    // Generic
    if (type === 'CREATE') return 'Create new record';
    if (type === 'UPDATE') return 'Update record';
    if (type === 'DELETE') return 'Delete record';
    
    return 'Sync data';
  }
}

