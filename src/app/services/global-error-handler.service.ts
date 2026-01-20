import { ErrorHandler, Injectable, NgZone } from '@angular/core';
import { environment } from '../../environments/environment';

/**
 * G2-ERRORS-001: Global Error Handler Service
 *
 * Catches unhandled errors and displays user-friendly messages.
 * Only active on web platform to avoid affecting mobile app behavior.
 */
@Injectable({
  providedIn: 'root'
})
export class GlobalErrorHandlerService implements ErrorHandler {
  private errorSubject: ((error: ErrorInfo) => void) | null = null;

  constructor(private zone: NgZone) {
    // Web only: Set up global unhandled promise rejection handler
    if (environment.isWeb && typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        event.preventDefault();
        this.handleError(event.reason);
      });
    }
  }

  /**
   * Register a callback to receive error notifications
   */
  registerErrorCallback(callback: (error: ErrorInfo) => void): void {
    this.errorSubject = callback;
  }

  /**
   * Unregister the error callback
   */
  unregisterErrorCallback(): void {
    this.errorSubject = null;
  }

  /**
   * Handle errors caught by Angular's error handler
   */
  handleError(error: any): void {
    // Always log for debugging
    console.error('[GlobalErrorHandler] Unhandled error:', error);

    // Only show error UI on web
    if (!environment.isWeb) {
      return;
    }

    // Extract error information
    const errorInfo = this.extractErrorInfo(error);

    // Run inside Angular zone to trigger change detection
    this.zone.run(() => {
      if (this.errorSubject) {
        this.errorSubject(errorInfo);
      }
    });
  }

  /**
   * Extract user-friendly error information from any error type
   */
  private extractErrorInfo(error: any): ErrorInfo {
    let message = 'An unexpected error occurred';
    let stack: string | undefined;
    let type: ErrorType = 'unknown';

    if (error instanceof Error) {
      message = error.message || message;
      stack = error.stack;

      // Classify error type
      if (error.name === 'ChunkLoadError' || message.includes('Loading chunk')) {
        type = 'chunk_load';
        message = 'Failed to load application resources. Please check your internet connection.';
      } else if (message.includes('Network') || message.includes('fetch') || message.includes('CORS')) {
        type = 'network';
        message = 'Network error. Please check your internet connection and try again.';
      } else if (message.includes('timeout') || message.includes('Timeout')) {
        type = 'timeout';
        message = 'The request timed out. Please try again.';
      }
    } else if (typeof error === 'string') {
      message = error;
    } else if (error?.message) {
      message = error.message;
    } else if (error?.error?.message) {
      message = error.error.message;
    }

    // Don't expose internal error details to users in production
    const userMessage = environment.production
      ? this.getSafeMessage(type, message)
      : message;

    return {
      message: userMessage,
      type,
      timestamp: new Date(),
      stack: environment.production ? undefined : stack
    };
  }

  /**
   * Get a safe, user-friendly message based on error type
   */
  private getSafeMessage(type: ErrorType, originalMessage: string): string {
    switch (type) {
      case 'chunk_load':
        return 'Failed to load application resources. Please refresh the page.';
      case 'network':
        return 'Network error. Please check your connection and try again.';
      case 'timeout':
        return 'The request timed out. Please try again.';
      default:
        return 'Something went wrong. Please try again or refresh the page.';
    }
  }
}

export type ErrorType = 'unknown' | 'network' | 'timeout' | 'chunk_load';

export interface ErrorInfo {
  message: string;
  type: ErrorType;
  timestamp: Date;
  stack?: string;
}
