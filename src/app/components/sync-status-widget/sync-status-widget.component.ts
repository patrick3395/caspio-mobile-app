import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone, ViewEncapsulation, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { BackgroundSyncService, SyncStatus } from '../../services/background-sync.service';
import { IndexedDbService } from '../../services/indexed-db.service';
import { Subscription, interval, merge } from 'rxjs';
import { debounceTime, map } from 'rxjs/operators';
import { SyncDetailsModalComponent } from './sync-details-modal.component';
import { db } from '../../services/caspio-db';

@Component({
  selector: 'app-sync-status-widget',
  templateUrl: './sync-status-widget.component.html',
  styleUrls: ['./sync-status-widget.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, SyncDetailsModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SyncStatusWidgetComponent implements OnInit, OnDestroy {
  syncStatus: SyncStatus = {
    isSyncing: false,
    pendingCount: 0,
    syncedCount: 0,
    failedCount: 0,
  };

  private subscription?: Subscription;
  private liveQuerySubscription?: Subscription;

  constructor(
    private backgroundSync: BackgroundSyncService,
    private indexedDb: IndexedDbService,
    private changeDetectorRef: ChangeDetectorRef,
    private ngZone: NgZone,
    private modalController: ModalController
  ) {}

  ngOnInit() {
    // Subscribe to sync status updates from BackgroundSyncService
    this.subscription = this.backgroundSync.syncStatus$.subscribe(
      status => {
        this.syncStatus = status;
        this.changeDetectorRef.markForCheck();
      }
    );

    // FIXED: Use Dexie liveQuery for reactive sync counts instead of polling
    // This is more efficient - only updates when data actually changes
    this.liveQuerySubscription = db.liveSyncStats$().pipe(
      debounceTime(300) // Prevent rapid-fire updates
    ).subscribe(stats => {
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
          this.changeDetectorRef.markForCheck();
        }
      });
    });
  }

  ngOnDestroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
    if (this.liveQuerySubscription) {
      this.liveQuerySubscription.unsubscribe();
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

  // Track if modal is currently open to prevent double-tap issues
  private isModalOpen = false;
  
  /**
   * Show sync details modal using Ionic modal controller
   * This ensures proper z-index handling and mobile compatibility
   */
  async showSyncDetails(): Promise<void> {
    console.log('[SyncWidget] showSyncDetails called');
    
    // Prevent double-tap from opening multiple modals
    if (this.isModalOpen) {
      console.log('[SyncWidget] Modal already open, ignoring');
      return;
    }
    
    this.isModalOpen = true;
    
    try {
      console.log('[SyncWidget] Creating modal...');
      const modal = await this.modalController.create({
        component: SyncDetailsModalComponent,
        // Use full-screen modal for mobile compatibility
        cssClass: 'sync-details-modal-fullscreen',
        canDismiss: true,
        showBackdrop: true,
        backdropDismiss: true,
      });
      
      // Handle modal dismiss
      modal.onDidDismiss().then(() => {
        console.log('[SyncWidget] Modal dismissed');
        this.isModalOpen = false;
      });
      
      console.log('[SyncWidget] Modal created, presenting...');
      await modal.present();
      console.log('[SyncWidget] Modal presented successfully');
    } catch (error) {
      console.error('[SyncWidget] Error opening modal:', error);
      this.isModalOpen = false;
      // Show an alert as fallback to confirm the click works
      alert('Error opening sync modal: ' + (error as Error).message);
    }
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
      
      // Count will refresh automatically via liveQuery subscription
      console.log('[SyncWidget] All pending requests cleared');
      this.changeDetectorRef.markForCheck();
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

