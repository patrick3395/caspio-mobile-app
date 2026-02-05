import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';

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
 *
 * Toast/DOM rendering has been removed — only state observables remain.
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
   * Suppress notifications (no-op — toasts removed)
   */
  suppressNotifications(): void {}

  /**
   * Resume notifications (no-op — toasts removed)
   */
  resumeNotifications(): void {}

  /**
   * Notify user of retry attempt (no-op — toasts removed)
   */
  notifyRetryAttempt(endpoint: string, attempt: number, maxAttempts: number, delayMs: number): void {}

  /**
   * Notify user that all retries have been exhausted (no-op — toasts removed)
   */
  notifyRetryExhausted(endpoint: string, error: string, retryCallback?: () => void): void {}

  /**
   * Notify user that retry was successful (no-op — toasts removed)
   */
  notifyRetrySuccess(endpoint: string, attempt: number): void {}

  /**
   * Clear retry state (no-op — toasts removed)
   */
  clearRetryState(): void {}
}
