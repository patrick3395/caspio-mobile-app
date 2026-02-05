import { Injectable, NgZone } from '@angular/core';
import { Router, NavigationEnd, NavigationStart } from '@angular/router';
import { Location } from '@angular/common';
import { filter } from 'rxjs/operators';
import { environment } from '../../environments/environment';

/**
 * NavigationHistoryService - Web-only browser back/forward support
 *
 * This service manages browser history for the webapp to ensure:
 * - Browser back/forward buttons work correctly
 * - Deep linking works for all routes
 * - No duplicate history entries
 * - Proper state restoration on navigation
 *
 * On mobile (environment.isWeb = false), this service does nothing
 * and defers to Ionic's NavController for native navigation behavior.
 */
@Injectable({
  providedIn: 'root'
})
export class NavigationHistoryService {
  // Track navigation history length for web
  private historyLength = 0;

  // Track if we're currently navigating back (to prevent double-handling)
  private isNavigatingBack = false;

  // Track the previous URL for back detection
  private previousUrl: string = '';
  private currentUrl: string = '';

  // Track navigation IDs to detect forward/back
  private navigationId = 0;
  private maxNavigationId = 0;

  constructor(
    private router: Router,
    private location: Location,
    private ngZone: NgZone
  ) {
    // Only initialize for web
    if (environment.isWeb) {
      this.initializeHistoryTracking();
    }
  }

  /**
   * Initialize history tracking for web platform
   */
  private initializeHistoryTracking(): void {
    // Track initial URL
    this.currentUrl = this.router.url || '/';
    this.historyLength = window.history.length;

    // Listen to router navigation events
    this.router.events.pipe(
      filter(event => event instanceof NavigationStart || event instanceof NavigationEnd)
    ).subscribe(event => {
      if (event instanceof NavigationStart) {
        // Track navigation ID for forward/back detection
        const navStart = event as NavigationStart;
        if (navStart.navigationTrigger === 'popstate') {
          // This is a browser back/forward navigation
          this.isNavigatingBack = true;
        } else {
          this.isNavigatingBack = false;
        }
      } else if (event instanceof NavigationEnd) {
        // Update URL tracking
        this.previousUrl = this.currentUrl;
        this.currentUrl = (event as NavigationEnd).urlAfterRedirects;

        // Update navigation ID tracking
        if (!this.isNavigatingBack) {
          this.navigationId++;
          this.maxNavigationId = this.navigationId;
        }

        // Reset back navigation flag
        this.isNavigatingBack = false;

        // Update history length
        this.historyLength = window.history.length;

      }
    });

    // Listen to browser popstate events for back/forward button detection
    window.addEventListener('popstate', (event) => {
      this.ngZone.run(() => {
      });
    });

  }

  /**
   * Check if browser back navigation is available
   * Returns true if there's history to go back to
   */
  canGoBack(): boolean {
    if (!environment.isWeb) {
      return false;
    }

    // Check if we have navigation history beyond the initial page
    // history.length > 1 means there's at least one page to go back to
    // But we also need to make sure we're not at the entry point
    return window.history.length > 1 && this.navigationId > 0;
  }

  /**
   * Navigate back using browser history
   * Returns true if navigation was performed, false if no history available
   */
  navigateBack(): boolean {
    if (!environment.isWeb) {
      return false;
    }

    if (this.canGoBack()) {
      this.isNavigatingBack = true;
      this.navigationId--;
      this.location.back();
      return true;
    }

    return false;
  }

  /**
   * Navigate forward using browser history
   * Returns true if navigation was performed
   */
  navigateForward(): boolean {
    if (!environment.isWeb) {
      return false;
    }

    if (this.navigationId < this.maxNavigationId) {
      this.navigationId++;
      this.location.forward();
      return true;
    }

    return false;
  }

  /**
   * Get the previous URL in history
   */
  getPreviousUrl(): string {
    return this.previousUrl;
  }

  /**
   * Get the current URL
   */
  getCurrentUrl(): string {
    return this.currentUrl;
  }

  /**
   * Check if this is the web platform
   */
  isWeb(): boolean {
    return environment.isWeb;
  }

  /**
   * Check if we're currently handling a back navigation
   * Useful for components that need to know if navigation was user-initiated
   */
  isBackNavigation(): boolean {
    return this.isNavigatingBack;
  }

  /**
   * Replace the current history entry without adding a new one
   * Useful for redirects or state updates that shouldn't create history entries
   */
  replaceState(url: string): void {
    if (!environment.isWeb) {
      return;
    }

    this.location.replaceState(url);
    this.currentUrl = url;
  }

  /**
   * Get navigation history debug info
   */
  getDebugInfo(): { historyLength: number; navigationId: number; maxNavigationId: number; currentUrl: string; previousUrl: string } {
    return {
      historyLength: this.historyLength,
      navigationId: this.navigationId,
      maxNavigationId: this.maxNavigationId,
      currentUrl: this.currentUrl,
      previousUrl: this.previousUrl
    };
  }
}
