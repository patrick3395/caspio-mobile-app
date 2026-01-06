import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { BackgroundSyncService, SyncStatus } from '../../services/background-sync.service';
import { IndexedDbService } from '../../services/indexed-db.service';
import { Subscription, merge } from 'rxjs';

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
export class SyncDetailsModalComponent implements OnInit, OnDestroy {
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
  private syncEventsSub?: Subscription;
  private refreshInterval?: any;

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
        // Refresh details whenever sync status changes
        this.refreshDetails();
      }
    );

    // Subscribe to all sync completion events for instant updates
    this.syncEventsSub = merge(
      this.backgroundSync.visualSyncComplete$,
      this.backgroundSync.photoUploadComplete$,
      this.backgroundSync.efeRoomSyncComplete$,
      this.backgroundSync.efePointSyncComplete$,
      this.backgroundSync.efePhotoUploadComplete$,
      this.backgroundSync.serviceDataSyncComplete$
    ).subscribe(() => {
      console.log('[SyncModal] Sync event received, refreshing...');
      this.refreshDetails();
    });

    // Auto-refresh every 2 seconds while modal is open
    this.refreshInterval = setInterval(() => {
      this.refreshDetails();
    }, 2000);

    // Load initial data
    this.refreshDetails();
  }

  ngOnDestroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
    if (this.syncEventsSub) {
      this.syncEventsSub.unsubscribe();
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
    const data = request.data || {};
    
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
}

