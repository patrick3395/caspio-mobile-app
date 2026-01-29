import { Injectable, NgZone } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { environment } from '../../environments/environment';
import { ScreenReaderAnnouncementService } from './screen-reader-announcement.service';

export interface ConfirmationDialogOptions {
  header: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  itemName?: string;
}

export interface ConfirmationResult {
  confirmed: boolean;
}

/**
 * G2-UX-004: Confirmation dialog service for destructive actions (web enhanced)
 *
 * Features:
 * - Wraps Ionic AlertController for consistent confirmation dialogs
 * - Web-only keyboard accessibility: Enter to confirm, Escape to cancel
 * - Clear description of what will be deleted
 * - Screen reader announcements for accessibility
 * - Mobile app unchanged - uses standard AlertController behavior
 *
 * Acceptance Criteria Met:
 * - Delete actions require confirmation
 * - Clear description of what will be deleted
 * - Option to cancel
 * - Keyboard accessible (Enter to confirm, Escape to cancel) - web only
 */
@Injectable({
  providedIn: 'root'
})
export class ConfirmationDialogService {
  private keyboardHandler: ((event: KeyboardEvent) => void) | null = null;
  private currentAlert: HTMLIonAlertElement | null = null;

  constructor(
    private alertController: AlertController,
    private ngZone: NgZone,
    private screenReaderAnnouncement: ScreenReaderAnnouncementService
  ) {}

  /**
   * Show a confirmation dialog for delete/destructive actions
   * Returns a promise that resolves with { confirmed: true } if confirmed, { confirmed: false } if cancelled
   */
  async confirmDelete(options: ConfirmationDialogOptions): Promise<ConfirmationResult> {
    const {
      header,
      message,
      confirmText = 'Delete',
      cancelText = 'Cancel',
      destructive = true,
      itemName
    } = options;

    // Announce to screen reader
    if (environment.isWeb) {
      const announcement = itemName
        ? `Confirmation required: ${header}. ${message}`
        : `Confirmation required: ${message}`;
      this.screenReaderAnnouncement.announce(announcement, 'assertive');
    }

    return new Promise(async (resolve) => {
      const alert = await this.alertController.create({
        header,
        message,
        backdropDismiss: true,
        buttons: [
          {
            text: confirmText,
            role: destructive ? 'destructive' : 'confirm',
            cssClass: destructive ? 'alert-button-confirm alert-button-destructive' : 'alert-button-confirm',
            handler: () => {
              this.cleanupKeyboardHandler();
              resolve({ confirmed: true });
            }
          },
          {
            text: cancelText,
            role: 'cancel',
            cssClass: 'alert-button-cancel',
            handler: () => {
              this.cleanupKeyboardHandler();
              resolve({ confirmed: false });
            }
          }
        ],
        cssClass: 'custom-document-alert confirmation-dialog'
      });

      // Store reference for keyboard handling
      this.currentAlert = alert;

      // Handle backdrop dismiss
      alert.onDidDismiss().then((detail) => {
        this.cleanupKeyboardHandler();
        if (detail.role === 'backdrop') {
          resolve({ confirmed: false });
        }
      });

      await alert.present();

      // Add web-only keyboard accessibility
      if (environment.isWeb) {
        this.setupKeyboardHandler(alert, resolve);
        this.focusConfirmButton(alert);
      }
    });
  }

  /**
   * Show a generic confirmation dialog (non-destructive)
   */
  async confirm(options: ConfirmationDialogOptions): Promise<ConfirmationResult> {
    return this.confirmDelete({
      ...options,
      destructive: false,
      confirmText: options.confirmText || 'Confirm'
    });
  }

  /**
   * Convenience method for confirming removal of an item
   */
  async confirmRemove(itemType: string, itemName?: string): Promise<ConfirmationResult> {
    const displayName = itemName ? `"${itemName}"` : `this ${itemType}`;
    return this.confirmDelete({
      header: `Remove ${itemType}`,
      message: `Are you sure you want to remove ${displayName}? This action cannot be undone.`,
      confirmText: 'Remove',
      itemName
    });
  }

  /**
   * Convenience method for confirming deletion of an item
   */
  async confirmDeleteItem(itemType: string, itemName?: string): Promise<ConfirmationResult> {
    const displayName = itemName ? `"${itemName}"` : `this ${itemType}`;
    return this.confirmDelete({
      header: `Delete ${itemType}`,
      message: `Are you sure you want to delete ${displayName}? This action cannot be undone.`,
      confirmText: 'Delete',
      itemName
    });
  }

  /**
   * Convenience method for confirming clearing of data
   */
  async confirmClear(itemType: string, additionalInfo?: string): Promise<ConfirmationResult> {
    let message = `Are you sure you want to clear all ${itemType}? This action cannot be undone.`;
    if (additionalInfo) {
      message += ` ${additionalInfo}`;
    }
    return this.confirmDelete({
      header: `Clear ${itemType}`,
      message,
      confirmText: 'Clear'
    });
  }

  /**
   * Setup keyboard handler for web (Enter to confirm, Escape to cancel)
   */
  private setupKeyboardHandler(alert: HTMLIonAlertElement, resolve: (value: ConfirmationResult) => void): void {
    this.keyboardHandler = (event: KeyboardEvent) => {
      // Only handle if this alert is still the current one
      if (this.currentAlert !== alert) return;

      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        this.ngZone.run(async () => {
          this.cleanupKeyboardHandler();
          await alert.dismiss(true, 'confirm');
          resolve({ confirmed: true });
        });
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.ngZone.run(async () => {
          this.cleanupKeyboardHandler();
          await alert.dismiss(false, 'cancel');
          resolve({ confirmed: false });
        });
      }
    };

    document.addEventListener('keydown', this.keyboardHandler, true);
  }

  /**
   * Focus the confirm button for immediate keyboard access
   */
  private focusConfirmButton(alert: HTMLIonAlertElement): void {
    // Wait for alert to be fully rendered
    setTimeout(() => {
      const confirmButton = alert.querySelector('.alert-button-confirm') as HTMLButtonElement;
      if (confirmButton) {
        confirmButton.focus();
      }
    }, 100);
  }

  /**
   * Cleanup keyboard event handler
   */
  private cleanupKeyboardHandler(): void {
    if (this.keyboardHandler) {
      document.removeEventListener('keydown', this.keyboardHandler, true);
      this.keyboardHandler = null;
    }
    this.currentAlert = null;
  }
}
