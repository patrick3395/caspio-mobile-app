import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { distinctUntilChanged, skip } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { OfflineService } from './offline.service';

export interface OfflineIndicatorState {
  isOffline: boolean;
  queuedActionsCount: number;
  showBanner: boolean;
  lastOnlineTime: number | null;
}

/**
 * Service to manage offline indicator UI for web platform (G2-ERRORS-003)
 * Shows clear indication when user goes offline and tracks queued actions
 */
@Injectable({
  providedIn: 'root'
})
export class OfflineIndicatorService {
  private state$ = new BehaviorSubject<OfflineIndicatorState>({
    isOffline: false,
    queuedActionsCount: 0,
    showBanner: false,
    lastOnlineTime: null
  });

  private bannerElement: HTMLElement | null = null;
  private toastElement: HTMLElement | null = null;
  private toastTimeout: any = null;
  private subscriptions: Subscription[] = [];
  private initialized = false;

  constructor(
    private ngZone: NgZone,
    private offlineService: OfflineService
  ) {
    // Only initialize on web platform
    if (environment.isWeb) {
      this.initialize();
    }
  }

  private initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Set initial state based on current online status
    const isOffline = !this.offlineService.isOnline();
    this.state$.next({
      ...this.state$.value,
      isOffline,
      showBanner: isOffline,
      lastOnlineTime: isOffline ? null : Date.now()
    });

    // If offline at startup, show banner immediately
    if (isOffline) {
      this.showOfflineBanner();
    }

    // Subscribe to online status changes (skip initial value)
    const onlineSub = this.offlineService.getOnlineStatus()
      .pipe(
        distinctUntilChanged(),
        skip(1) // Skip initial value since we handled it above
      )
      .subscribe(isOnline => {
        this.handleConnectionChange(isOnline);
      });

    this.subscriptions.push(onlineSub);

    // Subscribe to queue count changes to update indicator
    const queueSub = this.offlineService.getQueueCount()
      .pipe(distinctUntilChanged())
      .subscribe(count => {
        this.updateQueuedActionsCount(count);
      });

    this.subscriptions.push(queueSub);

    // Ensure animation styles are loaded
    this.ensureAnimationStyles();

    console.log('[OfflineIndicator] Initialized - monitoring connection status');
  }

  /**
   * Get current offline indicator state
   */
  getState(): Observable<OfflineIndicatorState> {
    return this.state$.asObservable();
  }

  /**
   * Get current state snapshot
   */
  getCurrentState(): OfflineIndicatorState {
    return this.state$.value;
  }

  /**
   * Check if currently offline
   */
  isOffline(): boolean {
    return this.state$.value.isOffline;
  }

  /**
   * Update the count of queued actions
   */
  updateQueuedActionsCount(count: number): void {
    if (!environment.isWeb) return;

    this.state$.next({
      ...this.state$.value,
      queuedActionsCount: count
    });

    // Update banner if visible
    if (this.bannerElement) {
      this.updateBannerContent();
    }
  }

  /**
   * Handle connection state change
   */
  private handleConnectionChange(isOnline: boolean): void {
    if (!environment.isWeb) return;

    this.ngZone.run(() => {
      if (isOnline) {
        // Going online
        this.state$.next({
          ...this.state$.value,
          isOffline: false,
          showBanner: false,
          lastOnlineTime: Date.now()
        });

        this.hideOfflineBanner();
        this.showConnectionRestoredToast();

        console.log('[OfflineIndicator] Connection restored');
      } else {
        // Going offline
        this.state$.next({
          ...this.state$.value,
          isOffline: true,
          showBanner: true
        });

        this.showOfflineBanner();
        this.showOfflineToast();

        console.log('[OfflineIndicator] Connection lost');
      }
    });
  }

  /**
   * Show persistent offline banner at top of screen
   */
  private showOfflineBanner(): void {
    if (!environment.isWeb) return;
    if (this.bannerElement) return; // Already showing

    const banner = document.createElement('div');
    banner.id = 'offline-indicator-banner';
    banner.className = 'offline-indicator-banner';

    this.updateBannerHTML(banner);
    this.applyBannerStyles(banner);

    document.body.appendChild(banner);
    this.bannerElement = banner;

    // Add body padding to prevent content overlap
    document.body.style.paddingTop = '48px';
  }

  /**
   * Update banner HTML content
   */
  private updateBannerHTML(banner: HTMLElement): void {
    const queuedCount = this.state$.value.queuedActionsCount;
    const queuedText = queuedCount > 0
      ? ` • ${queuedCount} action${queuedCount !== 1 ? 's' : ''} queued`
      : '';

    banner.innerHTML = `
      <div class="offline-banner-content">
        <span class="offline-banner-icon">📡</span>
        <span class="offline-banner-text">
          <strong>You're offline</strong>
          <span class="offline-banner-subtitle">Changes will sync when connection returns${queuedText}</span>
        </span>
      </div>
    `;
  }

  /**
   * Update banner content when queued count changes
   */
  private updateBannerContent(): void {
    if (this.bannerElement) {
      this.updateBannerHTML(this.bannerElement);
    }
  }

  /**
   * Apply styles to banner element
   */
  private applyBannerStyles(banner: HTMLElement): void {
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 99998;
      padding: 12px 16px;
      background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
      color: white;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      animation: offlineBannerSlideDown 0.3s ease-out;
    `;
  }

  /**
   * Hide offline banner
   */
  private hideOfflineBanner(): void {
    if (!this.bannerElement) return;

    this.bannerElement.style.animation = 'offlineBannerSlideUp 0.3s ease-in forwards';

    setTimeout(() => {
      if (this.bannerElement) {
        this.bannerElement.remove();
        this.bannerElement = null;
      }
      document.body.style.paddingTop = '';
    }, 300);
  }

  /**
   * Show toast notification when going offline
   */
  private showOfflineToast(): void {
    this.showToast(
      'Connection lost. Your changes will be saved and synced when you\'re back online.',
      'offline'
    );
  }

  /**
   * Show toast notification when connection is restored
   */
  private showConnectionRestoredToast(): void {
    const queuedCount = this.state$.value.queuedActionsCount;
    const message = queuedCount > 0
      ? `Back online! Syncing ${queuedCount} queued action${queuedCount !== 1 ? 's' : ''}...`
      : 'Back online! Connection restored.';

    this.showToast(message, 'online');
  }

  /**
   * Show a toast notification
   */
  private showToast(message: string, type: 'offline' | 'online'): void {
    if (!environment.isWeb) return;

    this.ngZone.run(() => {
      // Clear existing toast
      this.dismissToast();

      const toast = document.createElement('div');
      toast.className = `offline-indicator-toast offline-indicator-toast-${type}`;
      toast.innerHTML = `
        <div class="offline-toast-content">
          <span class="offline-toast-icon">${type === 'offline' ? '📡' : '✅'}</span>
          <span class="offline-toast-message">${message}</span>
        </div>
      `;

      const bgColor = type === 'offline' ? '#e74c3c' : '#27ae60';
      toast.style.cssText = `
        position: fixed;
        top: ${this.bannerElement ? '60px' : '16px'};
        left: 50%;
        transform: translateX(-50%);
        z-index: 99999;
        padding: 12px 20px;
        border-radius: 8px;
        background: ${bgColor};
        color: white;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        animation: offlineToastSlideDown 0.3s ease-out;
        max-width: 90%;
        text-align: center;
      `;

      document.body.appendChild(toast);
      this.toastElement = toast;

      // Auto-dismiss after duration
      const duration = type === 'offline' ? 5000 : 3000;
      this.toastTimeout = setTimeout(() => {
        this.dismissToast();
      }, duration);
    });
  }

  /**
   * Dismiss current toast
   */
  private dismissToast(): void {
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
    if (this.toastElement) {
      this.toastElement.remove();
      this.toastElement = null;
    }
  }

  /**
   * Ensure animation styles are in the document
   */
  private ensureAnimationStyles(): void {
    if (document.getElementById('offline-indicator-styles')) return;

    const style = document.createElement('style');
    style.id = 'offline-indicator-styles';
    style.textContent = `
      @keyframes offlineBannerSlideDown {
        from {
          transform: translateY(-100%);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }

      @keyframes offlineBannerSlideUp {
        from {
          transform: translateY(0);
          opacity: 1;
        }
        to {
          transform: translateY(-100%);
          opacity: 0;
        }
      }

      @keyframes offlineToastSlideDown {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(-20px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }

      .offline-banner-content {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
      }

      .offline-banner-icon {
        font-size: 18px;
      }

      .offline-banner-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .offline-banner-subtitle {
        font-size: 12px;
        opacity: 0.9;
        font-weight: 400;
      }

      .offline-toast-content {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .offline-toast-icon {
        font-size: 16px;
      }

      .offline-toast-message {
        line-height: 1.4;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Clean up resources
   */
  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.dismissToast();
    this.hideOfflineBanner();
  }
}
