import { Injectable, NgZone } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { BehaviorSubject, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Interface for components that can have unsaved changes
 * Components implementing this interface can be protected by the UnsavedChangesGuard
 */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/**
 * UnsavedChangesService - Web-only unsaved changes tracking and confirmation
 *
 * This service manages unsaved changes tracking for the webapp to:
 * - Track which pages have unsaved changes
 * - Show confirmation dialogs when navigating away with unsaved changes
 * - Handle browser back button with unsaved changes
 * - Work with both in-app navigation and browser navigation
 *
 * On mobile (environment.isWeb = false), this service does nothing
 * to preserve native mobile app behavior.
 */
@Injectable({
  providedIn: 'root'
})
export class UnsavedChangesService {
  // Track dirty state for current page
  private isDirtySubject = new BehaviorSubject<boolean>(false);
  isDirty$: Observable<boolean> = this.isDirtySubject.asObservable();

  // Track the component with unsaved changes
  private currentComponent: HasUnsavedChanges | null = null;

  // Track if we're showing a confirmation dialog (to prevent duplicate dialogs)
  private isShowingDialog = false;

  // Browser beforeunload listener reference
  private beforeUnloadListener: ((e: BeforeUnloadEvent) => void) | null = null;

  constructor(
    private alertController: AlertController,
    private ngZone: NgZone
  ) {
    // Only initialize for web
    if (environment.isWeb) {
      this.initializeBrowserProtection();
    }
  }

  /**
   * Initialize browser tab/window close protection
   * Shows browser's native "Leave site?" dialog when closing tab with unsaved changes
   */
  private initializeBrowserProtection(): void {
    this.beforeUnloadListener = (e: BeforeUnloadEvent): string | undefined => {
      if (this.isDirtySubject.getValue()) {
        // Standard way to show browser's native dialog
        e.preventDefault();
        // Chrome requires returnValue to be set
        e.returnValue = '';
        return '';
      }
      return undefined;
    };

    window.addEventListener('beforeunload', this.beforeUnloadListener);
    console.log('[UnsavedChanges] Browser protection initialized');
  }

  /**
   * Register a component as having unsaved changes
   * Call this when the user starts editing data
   */
  markDirty(component?: HasUnsavedChanges): void {
    if (!environment.isWeb) return;

    this.isDirtySubject.next(true);
    if (component) {
      this.currentComponent = component;
    }
    console.log('[UnsavedChanges] Page marked as dirty');
  }

  /**
   * Clear the dirty state
   * Call this when data is saved or when explicitly clearing unsaved changes
   */
  markClean(): void {
    if (!environment.isWeb) return;

    this.isDirtySubject.next(false);
    this.currentComponent = null;
    console.log('[UnsavedChanges] Page marked as clean');
  }

  /**
   * Check if current page has unsaved changes
   */
  isDirty(): boolean {
    if (!environment.isWeb) return false;

    // First check if component reports unsaved changes
    if (this.currentComponent && typeof this.currentComponent.hasUnsavedChanges === 'function') {
      return this.currentComponent.hasUnsavedChanges();
    }

    // Fall back to service-tracked dirty state
    return this.isDirtySubject.getValue();
  }

  /**
   * Show confirmation dialog when attempting to navigate away with unsaved changes
   * Returns true if user confirms they want to leave, false if they want to stay
   */
  async confirmNavigation(): Promise<boolean> {
    if (!environment.isWeb) return true;
    if (!this.isDirty()) return true;
    if (this.isShowingDialog) return false;

    this.isShowingDialog = true;

    return new Promise<boolean>(async (resolve) => {
      const alert = await this.alertController.create({
        header: 'Unsaved Changes',
        message: 'You have unsaved changes. Are you sure you want to leave this page? Your changes will be lost.',
        backdropDismiss: false,
        buttons: [
          {
            text: 'Stay',
            role: 'cancel',
            cssClass: 'secondary',
            handler: () => {
              console.log('[UnsavedChanges] User chose to stay');
              this.isShowingDialog = false;
              resolve(false);
            }
          },
          {
            text: 'Leave',
            role: 'destructive',
            cssClass: 'danger',
            handler: () => {
              console.log('[UnsavedChanges] User chose to leave');
              this.isShowingDialog = false;
              this.markClean(); // Clear dirty state since user is leaving
              resolve(true);
            }
          }
        ]
      });

      await alert.present();
    });
  }

  /**
   * Check if we're on the web platform
   */
  isWeb(): boolean {
    return environment.isWeb;
  }

  /**
   * Cleanup - call when service is destroyed
   */
  cleanup(): void {
    if (this.beforeUnloadListener) {
      window.removeEventListener('beforeunload', this.beforeUnloadListener);
      this.beforeUnloadListener = null;
    }
  }
}
