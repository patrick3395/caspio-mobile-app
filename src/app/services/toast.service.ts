import { Injectable, NgZone } from '@angular/core';
import { environment } from '../../environments/environment';
import { ScreenReaderAnnouncementService } from './screen-reader-announcement.service';

export type ToastType = 'success' | 'info' | 'warning' | 'error';

export interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number;
  dismissible?: boolean;
}

interface ToastElement {
  element: HTMLElement;
  timeout: any;
}

/**
 * G2-UX-003: Toast notification service for non-blocking messages (web only)
 *
 * Features:
 * - Success and info toast types with auto-dismiss
 * - Manual dismiss capability via close button
 * - Screen reader announcements for accessibility
 * - Non-blocking - doesn't interfere with user interaction
 * - Stacks multiple toasts vertically
 */
@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private toasts: ToastElement[] = [];
  private styleInjected = false;
  private readonly defaultDuration = 4000;
  private readonly toastGap = 12;
  private readonly baseTop = 16;

  constructor(
    private ngZone: NgZone,
    private screenReaderAnnouncement: ScreenReaderAnnouncementService
  ) {}

  /**
   * Show a success toast notification
   */
  success(message: string, duration?: number): void {
    this.show({ message, type: 'success', duration });
  }

  /**
   * Show an info toast notification
   */
  info(message: string, duration?: number): void {
    this.show({ message, type: 'info', duration });
  }

  /**
   * Show a warning toast notification
   */
  warning(message: string, duration?: number): void {
    this.show({ message, type: 'warning', duration });
  }

  /**
   * Show an error toast notification
   */
  error(message: string, duration?: number): void {
    this.show({ message, type: 'error', duration });
  }

  /**
   * Show a toast notification with custom options
   */
  show(options: ToastOptions): void {
    if (!environment.isWeb) return;

    this.ngZone.run(() => {
      const {
        message,
        type = 'info',
        duration = this.defaultDuration,
        dismissible = true
      } = options;

      // Announce to screen readers
      this.announceToScreenReader(message, type);

      // Inject styles if not already done
      this.ensureStyles();

      // Create toast element
      const toast = this.createToastElement(message, type, dismissible);

      // Add to DOM
      document.body.appendChild(toast);

      // Calculate position
      this.updateToastPositions();

      // Set up auto-dismiss
      const timeout = setTimeout(() => {
        this.dismissToast(toast);
      }, duration);

      this.toasts.push({ element: toast, timeout });

      // Trigger entrance animation
      requestAnimationFrame(() => {
        toast.classList.add('toast-visible');
      });
    });
  }

  /**
   * Dismiss all active toasts
   */
  dismissAll(): void {
    if (!environment.isWeb) return;

    const toastsCopy = [...this.toasts];
    toastsCopy.forEach(({ element }) => {
      this.dismissToast(element);
    });
  }

  private createToastElement(message: string, type: ToastType, dismissible: boolean): HTMLElement {
    const toast = document.createElement('div');
    toast.className = `app-toast app-toast-${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');

    const icon = this.getIcon(type);
    const bgColor = this.getBackgroundColor(type);

    toast.innerHTML = `
      <div class="app-toast-content">
        <span class="app-toast-icon" aria-hidden="true">${icon}</span>
        <span class="app-toast-message">${this.escapeHtml(message)}</span>
        ${dismissible ? `<button class="app-toast-close" aria-label="Dismiss notification" type="button">&times;</button>` : ''}
      </div>
    `;

    toast.style.cssText = `
      position: fixed;
      right: 16px;
      z-index: 99999;
      max-width: 400px;
      min-width: 280px;
      padding: 14px 16px;
      border-radius: 8px;
      background: ${bgColor};
      color: white;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      opacity: 0;
      transform: translateX(20px);
      transition: opacity 0.3s ease, transform 0.3s ease, top 0.3s ease;
      pointer-events: auto;
    `;

    // Style the close button
    if (dismissible) {
      const closeButton = toast.querySelector('.app-toast-close') as HTMLButtonElement;
      if (closeButton) {
        closeButton.style.cssText = `
          background: transparent;
          border: none;
          color: white;
          font-size: 20px;
          line-height: 1;
          cursor: pointer;
          padding: 0 0 0 12px;
          opacity: 0.8;
          transition: opacity 0.2s ease;
        `;
        closeButton.addEventListener('mouseenter', () => {
          closeButton.style.opacity = '1';
        });
        closeButton.addEventListener('mouseleave', () => {
          closeButton.style.opacity = '0.8';
        });
        closeButton.addEventListener('click', (e) => {
          e.stopPropagation();
          this.dismissToast(toast);
        });
      }
    }

    return toast;
  }

  private dismissToast(toastElement: HTMLElement): void {
    const index = this.toasts.findIndex(t => t.element === toastElement);
    if (index === -1) return;

    const { timeout } = this.toasts[index];
    clearTimeout(timeout);

    // Trigger exit animation
    toastElement.style.opacity = '0';
    toastElement.style.transform = 'translateX(20px)';

    setTimeout(() => {
      toastElement.remove();
      this.toasts.splice(index, 1);
      this.updateToastPositions();
    }, 300);
  }

  private updateToastPositions(): void {
    let currentTop = this.baseTop;
    this.toasts.forEach(({ element }) => {
      element.style.top = `${currentTop}px`;
      currentTop += element.offsetHeight + this.toastGap;
    });
  }

  private announceToScreenReader(message: string, type: ToastType): void {
    switch (type) {
      case 'success':
        this.screenReaderAnnouncement.announceSuccess(message);
        break;
      case 'error':
        this.screenReaderAnnouncement.announceError(message);
        break;
      case 'warning':
      case 'info':
      default:
        this.screenReaderAnnouncement.announce(message, 'polite');
        break;
    }
  }

  private getIcon(type: ToastType): string {
    switch (type) {
      case 'success': return '✓';
      case 'info': return 'ℹ';
      case 'warning': return '⚠';
      case 'error': return '✕';
    }
  }

  private getBackgroundColor(type: ToastType): string {
    switch (type) {
      case 'success': return '#27ae60';
      case 'info': return '#3498db';
      case 'warning': return '#f39c12';
      case 'error': return '#e74c3c';
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private ensureStyles(): void {
    if (this.styleInjected || document.getElementById('app-toast-styles')) return;

    const style = document.createElement('style');
    style.id = 'app-toast-styles';
    style.textContent = `
      .app-toast.toast-visible {
        opacity: 1 !important;
        transform: translateX(0) !important;
      }
      .app-toast-content {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .app-toast-icon {
        flex-shrink: 0;
        font-size: 16px;
      }
      .app-toast-message {
        flex: 1;
        word-break: break-word;
      }
      .app-toast-close:focus {
        outline: 2px solid white;
        outline-offset: 2px;
      }
      @media (max-width: 480px) {
        .app-toast {
          right: 8px !important;
          left: 8px !important;
          max-width: none !important;
          min-width: auto !important;
        }
      }
    `;
    document.head.appendChild(style);
    this.styleInjected = true;
  }
}
