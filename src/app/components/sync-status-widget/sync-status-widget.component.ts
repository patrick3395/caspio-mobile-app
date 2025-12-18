import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { BackgroundSyncService, SyncStatus } from '../../services/background-sync.service';
import { IndexedDbService } from '../../services/indexed-db.service';
import { Subscription, interval } from 'rxjs';

@Component({
  selector: 'app-sync-status-widget',
  templateUrl: './sync-status-widget.component.html',
  styleUrls: ['./sync-status-widget.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class SyncStatusWidgetComponent implements OnInit, OnDestroy {
  syncStatus: SyncStatus = {
    isSyncing: false,
    pendingCount: 0,
    syncedCount: 0,
    failedCount: 0,
  };

  // Modal state
  showDetails = false;
  pendingRequests: any[] = [];
  syncingRequests: any[] = [];
  failedRequests: any[] = [];

  private subscription?: Subscription;
  private pollSubscription?: Subscription;

  constructor(
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
        this.changeDetectorRef.detectChanges();
      }
    );

    // Poll IndexedDB for accurate pending count every 2 seconds
    // This ensures we show real counts even when BackgroundSync hasn't updated yet
    this.ngZone.runOutsideAngular(() => {
      this.pollSubscription = interval(2000).subscribe(() => {
        this.refreshPendingCount();
      });
    });

    // Initial count
    this.refreshPendingCount();
  }

  private async refreshPendingCount() {
    try {
      const stats = await this.indexedDb.getSyncStats();
      this.ngZone.run(() => {
        // Only update if different to avoid unnecessary change detection
        if (this.syncStatus.pendingCount !== stats.pending ||
            this.syncStatus.failedCount !== stats.failed) {
          this.syncStatus = {
            ...this.syncStatus,
            pendingCount: stats.pending,
            failedCount: stats.failed,
            syncedCount: stats.synced,
          };
          this.changeDetectorRef.detectChanges();
        }
      });
    } catch (error) {
      console.warn('[SyncWidget] Error refreshing count:', error);
    }
  }

  ngOnDestroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
    if (this.pollSubscription) {
      this.pollSubscription.unsubscribe();
    }
  }

  /**
   * User manually triggers sync
   */
  async forceSync() {
    await this.backgroundSync.forceSyncNow();
  }

  /**
   * Get sync status color
   */
  getStatusColor(): string {
    if (this.syncStatus.failedCount > 0) return 'danger';
    if (this.syncStatus.isSyncing) return 'warning';
    if (this.syncStatus.pendingCount > 0) return 'warning';
    return 'success';
  }

  /**
   * Get status icon
   */
  getStatusIcon(): string {
    if (this.syncStatus.isSyncing) return 'sync';
    if (this.syncStatus.pendingCount > 0) return 'cloud-upload-outline';
    if (this.syncStatus.failedCount > 0) return 'alert-circle';
    return 'cloud-done';
  }

  /**
   * Get status message
   */
  getStatusMessage(): string {
    if (this.syncStatus.isSyncing) {
      return `Syncing ${this.syncStatus.currentlySyncing || ''}`;
    }
    if (this.syncStatus.pendingCount > 0) {
      return `${this.syncStatus.pendingCount} pending`;
    }
    if (this.syncStatus.failedCount > 0) {
      return `${this.syncStatus.failedCount} failed`;
    }
    return 'All synced';
  }

  /**
   * Get last sync time as human-readable string
   */
  getLastSyncTime(): string {
    if (!this.syncStatus.lastSyncTime) {
      return 'Never';
    }

    const seconds = Math.floor((Date.now() - this.syncStatus.lastSyncTime) / 1000);
    
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  /**
   * Check if there are items to sync
   */
  hasPendingItems(): boolean {
    return this.syncStatus.pendingCount > 0 || this.syncStatus.isSyncing;
  }

  /**
   * Show sync details modal
   */
  async showSyncDetails(): Promise<void> {
    this.showDetails = true;
    await this.refreshDetails();
  }

  /**
   * Close sync details modal
   */
  closeDetails(): void {
    this.showDetails = false;
  }

  /**
   * Refresh details from IndexedDB
   */
  async refreshDetails(): Promise<void> {
    try {
      const requests = await this.indexedDb.getAllRequests();
      
      this.pendingRequests = requests.filter(r => r.status === 'pending');
      this.syncingRequests = requests.filter(r => r.status === 'syncing');
      this.failedRequests = requests.filter(r => r.status === 'failed');
      
      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('[SyncWidget] Error loading details:', error);
    }
  }

  /**
   * Get icon for request type
   */
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

  /**
   * Get human-readable description of request
   */
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

  /**
   * Clear all stuck/orphaned pending requests
   * Use with caution - only for debugging stuck sync issues
   */
  async clearAllPending(): Promise<void> {
    const confirmed = confirm('This will clear ALL pending sync requests. Data that hasn\'t been synced will be lost. Continue?');
    if (!confirmed) return;

    try {
      const requests = await this.indexedDb.getAllRequests();
      console.log('[SyncWidget] Clearing', requests.length, 'pending requests:');
      
      for (const request of requests) {
        console.log(`  - ${request.requestId}: ${request.type} ${request.endpoint} (${request.status})`);
        await this.indexedDb.removePendingRequest(request.requestId);
      }
      
      // Refresh count
      await this.refreshPendingCount();
      console.log('[SyncWidget] All pending requests cleared');
    } catch (error) {
      console.error('[SyncWidget] Error clearing pending requests:', error);
    }
  }

  /**
   * Log details about pending requests for debugging
   */
  async debugPendingRequests(): Promise<void> {
    try {
      const requests = await this.indexedDb.getAllRequests();
      console.log('[SyncWidget] === PENDING REQUESTS DEBUG ===');
      console.log('Total requests:', requests.length);
      
      const byStatus = {
        pending: requests.filter(r => r.status === 'pending'),
        syncing: requests.filter(r => r.status === 'syncing'),
        synced: requests.filter(r => r.status === 'synced'),
        failed: requests.filter(r => r.status === 'failed'),
      };
      
      console.log('By status:', {
        pending: byStatus.pending.length,
        syncing: byStatus.syncing.length,
        synced: byStatus.synced.length,
        failed: byStatus.failed.length,
      });
      
      for (const request of requests) {
        console.log(`  [${request.status}] ${request.requestId}:`, {
          type: request.type,
          endpoint: request.endpoint?.substring(0, 60),
          retryCount: request.retryCount,
          createdAt: new Date(request.createdAt).toISOString(),
          dependencies: request.dependencies,
          error: request.error,
        });
      }
      console.log('[SyncWidget] === END DEBUG ===');
    } catch (error) {
      console.error('[SyncWidget] Error debugging requests:', error);
    }
  }
}

