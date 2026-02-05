import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { environment } from '../../../environments/environment';
import { GlobalErrorHandlerService, ErrorInfo } from '../../services/global-error-handler.service';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';

/**
 * G2-ERRORS-001: Error Boundary Component
 *
 * Displays user-friendly error messages with recovery options.
 * Only rendered on web platform.
 *
 * G2-PERF-003: OnPush change detection for performance optimization (web only)
 * G2-A11Y-001: Focus trap and proper ARIA attributes for accessibility
 */
@Component({
  selector: 'app-error-boundary',
  standalone: true,
  imports: [CommonModule, IonicModule, FocusTrapDirective],
  changeDetection: environment.isWeb ? ChangeDetectionStrategy.OnPush : ChangeDetectionStrategy.Default,
  template: `
    <div
      class="error-boundary-overlay"
      *ngIf="isWeb && showError"
      (click)="onOverlayClick($event)"
      role="presentation"
    >
      <div
        class="error-boundary-modal"
        role="alertdialog"
        aria-labelledby="error-title"
        aria-describedby="error-message"
        aria-modal="true"
        appFocusTrap
        [autoFocus]="true"
        [restoreFocus]="true"
      >
        <div class="error-icon" aria-hidden="true">
          <ion-icon name="alert-circle-outline"></ion-icon>
        </div>
        <h2 id="error-title" class="error-title">Something went wrong</h2>
        <p id="error-message" class="error-message">{{ errorMessage }}</p>

        <!-- Debug info (non-production only) -->
        <div class="error-debug" *ngIf="!isProduction && errorStack">
          <details>
            <summary>Technical Details</summary>
            <pre>{{ errorStack }}</pre>
          </details>
        </div>

        <div class="error-actions" role="group" aria-label="Error recovery actions">
          <button
            class="error-btn error-btn-secondary"
            (click)="dismiss()"
            aria-label="Dismiss error message"
          >
            <ion-icon name="close-outline" aria-hidden="true"></ion-icon>
            Dismiss
          </button>
          <button
            class="error-btn error-btn-secondary"
            (click)="goBack()"
            aria-label="Go back to previous page"
          >
            <ion-icon name="arrow-back-outline" aria-hidden="true"></ion-icon>
            Go Back
          </button>
          <button
            class="error-btn error-btn-primary"
            (click)="retry()"
            aria-label="Retry the operation"
          >
            <ion-icon name="refresh-outline" aria-hidden="true"></ion-icon>
            Retry
          </button>
        </div>

        <p class="error-help">
          If this problem persists, try refreshing the page or contact support.
        </p>
      </div>
    </div>
  `,
  styles: []
})
export class ErrorBoundaryComponent implements OnInit, OnDestroy {
  isWeb = environment.isWeb;
  isProduction = environment.production;
  showError = false;
  errorMessage = '';
  errorStack: string | undefined;

  constructor(
    private errorHandler: GlobalErrorHandlerService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.isWeb && this.showError) {
      this.dismiss();
    }
  }

  ngOnInit(): void {
    if (!this.isWeb) {
      return;
    }

    // Register to receive error notifications
    this.errorHandler.registerErrorCallback((error: ErrorInfo) => {
      this.showErrorModal(error);
    });
  }

  ngOnDestroy(): void {
    if (this.isWeb) {
      this.errorHandler.unregisterErrorCallback();
    }
  }

  private showErrorModal(error: ErrorInfo): void {
    this.errorMessage = error.message;
    this.errorStack = error.stack;
    this.showError = true;

    // G2-PERF-003: Use markForCheck() for OnPush compatibility
    this.cdr.markForCheck();

    // Log for debugging
  }

  dismiss(): void {
    this.showError = false;
    this.errorMessage = '';
    this.errorStack = undefined;
  }

  retry(): void {
    this.dismiss();
    // Reload the current route
    window.location.reload();
  }

  goBack(): void {
    this.dismiss();
    // Try to navigate back, fall back to home if no history
    if (window.history.length > 1) {
      window.history.back();
    } else {
      this.router.navigate(['/']);
    }
  }

  onOverlayClick(event: MouseEvent): void {
    // Only dismiss if clicking the overlay itself, not the modal content
    if ((event.target as HTMLElement).classList.contains('error-boundary-overlay')) {
      this.dismiss();
    }
  }
}
