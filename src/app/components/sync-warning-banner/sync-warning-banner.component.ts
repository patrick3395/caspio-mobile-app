import { Component, Input, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Subscription, interval } from 'rxjs';
import { ServiceMetadataService } from '../../services/service-metadata.service';
import { environment } from '../../../environments/environment';

/**
 * SyncWarningBanner - Displays warning when service has unsynced changes
 *
 * Phase 6 of Storage Bloat Prevention:
 * Shows persistent banner when:
 * - outboxCount > 0 (pending uploads/mutations)
 * - lastServerAckRevision < lastLocalRevision (local changes not yet synced)
 *
 * Used on engineers-foundation pages to warn users about unsynced data
 * that could prevent automatic storage cleanup.
 */
@Component({
  selector: 'app-sync-warning-banner',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <div *ngIf="showWarning && !isWeb" class="sync-warning-banner" [class.expanded]="expanded">
      <div class="banner-content" (click)="toggleExpanded()">
        <ion-icon name="cloud-offline-outline" class="warning-icon"></ion-icon>
        <span class="warning-text">{{ warningMessage }}</span>
        <ion-icon [name]="expanded ? 'chevron-up' : 'chevron-down'" class="expand-icon"></ion-icon>
      </div>
      <div *ngIf="expanded" class="banner-details">
        <p *ngIf="pendingCount > 0">{{ pendingCount }} item(s) waiting to sync</p>
        <p *ngIf="unsyncedRevisions">Local changes not yet uploaded</p>
        <p class="hint">Connect to sync your data</p>
      </div>
    </div>
  `,
  styles: [`
    .sync-warning-banner {
      background: var(--ion-color-warning);
      color: var(--ion-color-warning-contrast);
      padding: 8px 16px;
      margin: 0;
      font-size: 14px;
    }

    .banner-content {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }

    .warning-icon {
      font-size: 20px;
      flex-shrink: 0;
    }

    .warning-text {
      flex: 1;
      font-weight: 500;
    }

    .expand-icon {
      font-size: 16px;
      flex-shrink: 0;
    }

    .banner-details {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(0, 0, 0, 0.1);
      font-size: 13px;
    }

    .banner-details p {
      margin: 4px 0;
    }

    .banner-details .hint {
      opacity: 0.8;
      font-style: italic;
    }
  `]
})
export class SyncWarningBannerComponent implements OnInit, OnDestroy {
  @Input() serviceId: string = '';

  isWeb = environment.isWeb;
  showWarning = false;
  expanded = false;
  warningMessage = 'Unsynced changes';
  pendingCount = 0;
  unsyncedRevisions = false;

  private checkSubscription?: Subscription;

  constructor(
    private serviceMetadata: ServiceMetadataService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    if (this.isWeb || !this.serviceId) {
      return;
    }

    // Check sync status immediately
    this.checkSyncStatus();

    // Check periodically (every 10 seconds)
    this.checkSubscription = interval(10000).subscribe(() => {
      this.checkSyncStatus();
    });
  }

  ngOnDestroy(): void {
    if (this.checkSubscription) {
      this.checkSubscription.unsubscribe();
    }
  }

  toggleExpanded(): void {
    this.expanded = !this.expanded;
  }

  private async checkSyncStatus(): Promise<void> {
    if (!this.serviceId) {
      return;
    }

    try {
      const metadata = await this.serviceMetadata.getServiceMetadata(this.serviceId);
      const outboxCount = await this.serviceMetadata.getOutboxCount(this.serviceId);

      this.pendingCount = outboxCount;
      this.unsyncedRevisions = metadata
        ? metadata.lastServerAckRevision < metadata.lastLocalRevision
        : false;

      // Show warning if there are pending items or unsynced revisions
      this.showWarning = this.pendingCount > 0 || this.unsyncedRevisions;

      // Update message based on state
      if (this.pendingCount > 0 && this.unsyncedRevisions) {
        this.warningMessage = `${this.pendingCount} unsynced item(s)`;
      } else if (this.pendingCount > 0) {
        this.warningMessage = `${this.pendingCount} item(s) waiting to sync`;
      } else if (this.unsyncedRevisions) {
        this.warningMessage = 'Unsynced changes - connect to sync';
      }

      this.cdr.detectChanges();
    } catch (err) {
      console.warn('[SyncWarningBanner] Error checking sync status:', err);
    }
  }
}
