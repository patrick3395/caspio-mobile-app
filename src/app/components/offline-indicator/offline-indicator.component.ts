import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';
import { OfflineIndicatorService, OfflineIndicatorState } from '../../services/offline-indicator.service';

/**
 * G2-ERRORS-003: Offline Indicator Component
 *
 * Displays offline status and queued action count.
 * Only rendered on web platform.
 *
 * This component serves as the Angular integration point for the
 * OfflineIndicatorService which handles the actual DOM manipulation
 * of the banner and toast elements.
 */
@Component({
  selector: 'app-offline-indicator',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <!-- The actual banner and toasts are rendered via DOM manipulation by OfflineIndicatorService -->
    <!-- This component just ensures the service is initialized and provides Angular lifecycle hooks -->
    <ng-container *ngIf="isWeb">
      <!-- Hidden element to ensure change detection picks up state changes -->
      <div class="offline-indicator-anchor" [attr.data-offline]="state?.isOffline" style="display: none;"></div>
    </ng-container>
  `,
  styles: []
})
export class OfflineIndicatorComponent implements OnInit, OnDestroy {
  isWeb = environment.isWeb;
  state: OfflineIndicatorState | null = null;
  private subscription: Subscription | null = null;

  constructor(private offlineIndicatorService: OfflineIndicatorService) {}

  ngOnInit(): void {
    if (!this.isWeb) {
      return;
    }

    // Subscribe to state changes
    this.subscription = this.offlineIndicatorService.getState().subscribe(state => {
      this.state = state;
    });

    console.log('[OfflineIndicator] Component initialized for web platform');
  }

  ngOnDestroy(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }
}
