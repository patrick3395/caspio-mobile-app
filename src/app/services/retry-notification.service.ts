import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { environment } from '../../environments/environment';
import { ScreenReaderAnnouncementService } from './screen-reader-announcement.service';

export interface RetryState {
  isRetrying: boolean;
  currentAttempt: number;
  maxAttempts: number;
  endpoint: string;
  lastError?: string;
  canManualRetry: boolean;
}

export interface ManualRetryRequest {
  endpoint: string;
  error: string;
  retryCallback: () => void;
}

/**
 * Service to provide user feedback for API retry attempts (web only)
 * Tracks retry state and provides manual retry option after all automatic retries fail
 */
@Injectable({
  providedIn: 'root'
})
export class RetryNotificationService {
  private retryState$ = new BehaviorSubject<RetryState>({
    isRetrying: false,
    currentAttempt: 0,
    maxAttempts: 3,
    endpoint: '',
    canManualRetry: false
  });

  private manualRetryRequest$ = new Subject<ManualRetryRequest>();
  private toastElement: HTMLElement | null = null;
  private dismissTimeout: any = null;

  constructor(
    private ngZone: NgZone,
    private screenReaderAnnouncement: ScreenReaderAnnouncementService
  ) {}

  /**
   * Get current retry state as observable
   */
  getRetryState(): Observable<RetryState> {
    return this.retryState$.asObservable();
  }

  /**
   * Get manual retry requests as observable
   */
  getManualRetryRequests(): Observable<ManualRetryRequest> {
    return this.manualRetryRequest$.asObservable();
  }

  /**
   * Notify user of retry attempt (web only)
   */
  notifyRetryAttempt(endpoint: string, attempt: number, maxAttempts: number, delayMs: number): void {
    if (!environment.isWeb) return;

    this.retryState$.next({
      isRetrying: true,
      currentAttempt: attempt,
      maxAttempts,
      endpoint: this.getEndpointName(endpoint),
      canManualRetry: false
    });

    const message = `Retrying request (${attempt}/${maxAttempts})...`;

    // G2-A11Y-003: Announce retry attempt to screen readers
    this.screenReaderAnnouncement.announce(message, 'polite');

    this.showRetryToast(
      message,
      'warning',
      delayMs + 1000 // Show for duration of delay + 1 second
    );
  }

  /**
   * Notify user that all retries have been exhausted (web only)
   */
  notifyRetryExhausted(endpoint: string, error: string, retryCallback?: () => void): void {
    if (!environment.isWeb) return;

    const endpointName = this.getEndpointName(endpoint);

    this.retryState$.next({
      isRetrying: false,
      currentAttempt: 3,
      maxAttempts: 3,
      endpoint: endpointName,
      lastError: error,
      canManualRetry: !!retryCallback
    });

    // G2-A11Y-003: Announce error to screen readers
    this.screenReaderAnnouncement.announceError(`Request failed after 3 attempts`);

    if (retryCallback) {
      // Emit manual retry request for UI to handle
      this.manualRetryRequest$.next({
        endpoint: endpointName,
        error,
        retryCallback
      });

      this.showRetryToastWithAction(
        `Request failed after 3 attempts. Tap to retry.`,
        'danger',
        retryCallback
      );
    } else {
      this.showRetryToast(
        `Request failed after 3 attempts`,
        'danger',
        5000
      );
    }
  }

  /**
   * Notify user that retry was successful (web only)
   */
  notifyRetrySuccess(endpoint: string, attempt: number): void {
    if (!environment.isWeb) return;

    this.retryState$.next({
      isRetrying: false,
      currentAttempt: 0,
      maxAttempts: 3,
      endpoint: '',
      canManualRetry: false
    });

    if (attempt > 1) {
      const message = `Request succeeded after ${attempt} attempts`;

      // G2-A11Y-003: Announce success to screen readers
      this.screenReaderAnnouncement.announceSuccess(message);

      this.showRetryToast(
        message,
        'success',
        2000
      );
    }
  }

  /**
   * Clear retry state
   */
  clearRetryState(): void {
    this.retryState$.next({
      isRetrying: false,
      currentAttempt: 0,
      maxAttempts: 3,
      endpoint: '',
      canManualRetry: false
    });
    this.dismissToast();
  }

  /**
   * Extract readable endpoint name from full endpoint
   */
  private getEndpointName(endpoint: string): string {
    // Extract table/resource name from endpoint
    const parts = endpoint.split('/').filter(p => p);
    const resourceName = parts[parts.length - 1]?.split('?')[0] || 'resource';
    return resourceName;
  }

  /**
   * Escape HTML characters to prevent XSS (web only)
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Show a toast notification (web only)
   */
  private showRetryToast(message: string, type: 'warning' | 'danger' | 'success', duration: number): void {
    if (!environment.isWeb) return;

    this.ngZone.run(() => {
      this.dismissToast();

      // Escape message to prevent XSS
      const escapedMessage = this.escapeHtml(message);

      const toast = document.createElement('div');
      toast.className = `retry-toast retry-toast-${type}`;
      toast.innerHTML = `
        <div class="retry-toast-content">
          <span class="retry-toast-icon">${this.getIcon(type)}</span>
          <span class="retry-toast-message">${escapedMessage}</span>
        </div>
      `;
      toast.style.cssText = `
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 99999;
        padding: 12px 20px;
        border-radius: 8px;
        background: ${this.getBackgroundColor(type)};
        color: white;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        animation: slideDown 0.3s ease-out;
        display: flex;
        align-items: center;
        gap: 8px;
      `;

      // Add animation keyframes if not already present
      this.ensureAnimationStyles();

      document.body.appendChild(toast);
      this.toastElement = toast;

      this.dismissTimeout = setTimeout(() => {
        this.dismissToast();
      }, duration);
    });
  }

  /**
   * Show a toast with manual retry action (web only)
   */
  private showRetryToastWithAction(message: string, type: 'danger', retryCallback: () => void): void {
    if (!environment.isWeb) return;

    this.ngZone.run(() => {
      this.dismissToast();

      // Escape message to prevent XSS
      const escapedMessage = this.escapeHtml(message);

      const toast = document.createElement('div');
      toast.className = `retry-toast retry-toast-${type} retry-toast-actionable`;
      toast.innerHTML = `
        <div class="retry-toast-content">
          <span class="retry-toast-icon">${this.getIcon(type)}</span>
          <span class="retry-toast-message">${escapedMessage}</span>
          <button class="retry-toast-button">Retry</button>
        </div>
      `;
      toast.style.cssText = `
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 99999;
        padding: 12px 20px;
        border-radius: 8px;
        background: ${this.getBackgroundColor(type)};
        color: white;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        animation: slideDown 0.3s ease-out;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
      `;

      // Style the retry button
      const button = toast.querySelector('.retry-toast-button') as HTMLButtonElement;
      if (button) {
        button.style.cssText = `
          background: rgba(255, 255, 255, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.4);
          color: white;
          padding: 4px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          margin-left: 8px;
        `;
        button.addEventListener('click', (e) => {
          e.stopPropagation();
          this.dismissToast();
          retryCallback();
        });
      }

      // Allow clicking entire toast to retry
      toast.addEventListener('click', () => {
        this.dismissToast();
        retryCallback();
      });

      this.ensureAnimationStyles();
      document.body.appendChild(toast);
      this.toastElement = toast;

      // Auto-dismiss after 10 seconds
      this.dismissTimeout = setTimeout(() => {
        this.dismissToast();
      }, 10000);
    });
  }

  private dismissToast(): void {
    if (this.dismissTimeout) {
      clearTimeout(this.dismissTimeout);
      this.dismissTimeout = null;
    }
    if (this.toastElement) {
      this.toastElement.remove();
      this.toastElement = null;
    }
  }

  private getIcon(type: 'warning' | 'danger' | 'success'): string {
    switch (type) {
      case 'warning': return '⏳';
      case 'danger': return '❌';
      case 'success': return '✅';
    }
  }

  private getBackgroundColor(type: 'warning' | 'danger' | 'success'): string {
    switch (type) {
      case 'warning': return '#f39c12';
      case 'danger': return '#e74c3c';
      case 'success': return '#27ae60';
    }
  }

  private ensureAnimationStyles(): void {
    if (document.getElementById('retry-toast-styles')) return;

    const style = document.createElement('style');
    style.id = 'retry-toast-styles';
    style.textContent = `
      @keyframes slideDown {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(-20px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }
      .retry-toast-content {
        display: flex;
        align-items: center;
        gap: 8px;
      }
    `;
    document.head.appendChild(style);
  }
}
