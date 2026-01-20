import { Injectable, NgZone } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { filter } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * G2-A11Y-003: Screen Reader Announcement Service (Web Only)
 *
 * Provides centralized screen reader announcements using aria-live regions.
 * Announces loading states, form errors, success messages, and page changes.
 */

export type AnnouncementPriority = 'polite' | 'assertive';

export interface Announcement {
  message: string;
  priority: AnnouncementPriority;
}

@Injectable({
  providedIn: 'root'
})
export class ScreenReaderAnnouncementService {
  private politeRegion: HTMLElement | null = null;
  private assertiveRegion: HTMLElement | null = null;
  private routerSubscription: Subscription | null = null;
  private clearTimeouts: Map<string, number> = new Map();

  constructor(
    private router: Router,
    private titleService: Title,
    private zone: NgZone
  ) {
    if (environment.isWeb) {
      this.initializeLiveRegions();
      this.setupPageChangeAnnouncements();
    }
  }

  /**
   * Create aria-live regions in the DOM (web only)
   */
  private initializeLiveRegions(): void {
    if (!environment.isWeb || typeof document === 'undefined') return;

    // Check if regions already exist
    if (document.getElementById('sr-announcer-polite')) return;

    // Create polite live region (for non-urgent announcements)
    this.politeRegion = document.createElement('div');
    this.politeRegion.id = 'sr-announcer-polite';
    this.politeRegion.setAttribute('aria-live', 'polite');
    this.politeRegion.setAttribute('aria-atomic', 'true');
    this.politeRegion.setAttribute('role', 'status');
    this.applyScreenReaderOnlyStyles(this.politeRegion);
    document.body.appendChild(this.politeRegion);

    // Create assertive live region (for urgent announcements)
    this.assertiveRegion = document.createElement('div');
    this.assertiveRegion.id = 'sr-announcer-assertive';
    this.assertiveRegion.setAttribute('aria-live', 'assertive');
    this.assertiveRegion.setAttribute('aria-atomic', 'true');
    this.assertiveRegion.setAttribute('role', 'alert');
    this.applyScreenReaderOnlyStyles(this.assertiveRegion);
    document.body.appendChild(this.assertiveRegion);
  }

  /**
   * Apply visually-hidden styles so content is only for screen readers
   */
  private applyScreenReaderOnlyStyles(element: HTMLElement): void {
    element.style.cssText = `
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      margin: -1px !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      white-space: nowrap !important;
      border: 0 !important;
    `;
  }

  /**
   * Announce a message to screen readers (web only)
   * @param message The message to announce
   * @param priority 'polite' for non-urgent, 'assertive' for urgent messages
   */
  announce(message: string, priority: AnnouncementPriority = 'polite'): void {
    if (!environment.isWeb) return;

    this.zone.run(() => {
      const region = priority === 'assertive' ? this.assertiveRegion : this.politeRegion;
      if (!region) return;

      // Clear any pending timeout for this region
      const timeoutKey = priority;
      if (this.clearTimeouts.has(timeoutKey)) {
        clearTimeout(this.clearTimeouts.get(timeoutKey));
      }

      // Clear region first to ensure new content is announced
      region.textContent = '';

      // Use setTimeout to ensure the DOM updates and screen readers pick up the change
      setTimeout(() => {
        region.textContent = message;

        // Clear after announcement to avoid re-reading on focus
        const clearTimeout = window.setTimeout(() => {
          region.textContent = '';
          this.clearTimeouts.delete(timeoutKey);
        }, 1000);

        this.clearTimeouts.set(timeoutKey, clearTimeout);
      }, 100);
    });
  }

  /**
   * Announce loading state (web only)
   * @param isLoading Whether loading has started or finished
   * @param context Optional context (e.g., "projects", "images")
   */
  announceLoading(isLoading: boolean, context?: string): void {
    if (!environment.isWeb) return;

    const contextText = context ? ` ${context}` : '';
    const message = isLoading
      ? `Loading${contextText}...`
      : `Finished loading${contextText}`;

    this.announce(message, 'polite');
  }

  /**
   * Announce a form error (web only)
   * @param errorMessage The error message to announce
   */
  announceFormError(errorMessage: string): void {
    if (!environment.isWeb) return;

    this.announce(`Error: ${errorMessage}`, 'assertive');
  }

  /**
   * Announce multiple form errors (web only)
   * @param errors Array of error messages
   */
  announceFormErrors(errors: string[]): void {
    if (!environment.isWeb) return;

    if (errors.length === 0) return;

    if (errors.length === 1) {
      this.announceFormError(errors[0]);
    } else {
      const message = `${errors.length} errors found. ${errors.join('. ')}`;
      this.announce(message, 'assertive');
    }
  }

  /**
   * Announce a success message (web only)
   * @param message The success message to announce
   */
  announceSuccess(message: string): void {
    if (!environment.isWeb) return;

    this.announce(message, 'polite');
  }

  /**
   * Announce an error message (web only)
   * @param message The error message to announce
   */
  announceError(message: string): void {
    if (!environment.isWeb) return;

    this.announce(`Error: ${message}`, 'assertive');
  }

  /**
   * Announce a page change (web only)
   * @param pageTitle The title of the new page
   */
  announcePageChange(pageTitle: string): void {
    if (!environment.isWeb) return;

    this.announce(`Navigated to ${pageTitle}`, 'polite');
  }

  /**
   * Set up automatic page change announcements via router (web only)
   */
  private setupPageChangeAnnouncements(): void {
    if (!environment.isWeb) return;

    this.routerSubscription = this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => {
        // Wait for title to update
        setTimeout(() => {
          const title = this.titleService.getTitle() || 'Page';
          this.announcePageChange(title);
        }, 100);
      });
  }

  /**
   * Announce action completion (web only)
   * @param action The action that was completed (e.g., "saved", "deleted", "uploaded")
   * @param itemName Optional name of the item acted upon
   */
  announceActionComplete(action: string, itemName?: string): void {
    if (!environment.isWeb) return;

    const message = itemName
      ? `${itemName} ${action} successfully`
      : `${action.charAt(0).toUpperCase() + action.slice(1)} successful`;

    this.announceSuccess(message);
  }

  /**
   * Announce count update (web only)
   * @param count The number of items
   * @param itemType The type of items (e.g., "projects", "photos")
   */
  announceCount(count: number, itemType: string): void {
    if (!environment.isWeb) return;

    const message = count === 0
      ? `No ${itemType} found`
      : count === 1
        ? `1 ${itemType.replace(/s$/, '')} found`
        : `${count} ${itemType} found`;

    this.announce(message, 'polite');
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.routerSubscription) {
      this.routerSubscription.unsubscribe();
      this.routerSubscription = null;
    }

    this.clearTimeouts.forEach(timeout => clearTimeout(timeout));
    this.clearTimeouts.clear();

    // Remove live regions from DOM
    if (this.politeRegion) {
      this.politeRegion.remove();
      this.politeRegion = null;
    }
    if (this.assertiveRegion) {
      this.assertiveRegion.remove();
      this.assertiveRegion = null;
    }
  }
}
