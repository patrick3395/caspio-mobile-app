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
}

