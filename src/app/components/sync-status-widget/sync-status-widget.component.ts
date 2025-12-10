import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { BackgroundSyncService, SyncStatus } from '../../services/background-sync.service';
import { Subscription } from 'rxjs';

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

  constructor(private backgroundSync: BackgroundSyncService) {}

  ngOnInit() {
    // Subscribe to sync status updates
    this.subscription = this.backgroundSync.syncStatus$.subscribe(
      status => {
        this.syncStatus = status;
      }
    );
  }

  ngOnDestroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
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

