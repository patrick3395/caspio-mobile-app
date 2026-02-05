import { Injectable } from '@angular/core';
import { CanDeactivate } from '@angular/router';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { UnsavedChangesService, HasUnsavedChanges } from '../services/unsaved-changes.service';

/**
 * UnsavedChangesGuard - Web-only route guard for unsaved changes
 *
 * This guard intercepts navigation attempts and checks if the current page
 * has unsaved changes. If so, it shows a confirmation dialog.
 *
 * Works with:
 * - In-app navigation (router.navigate, routerLink)
 * - Browser back/forward buttons
 *
 * On mobile (environment.isWeb = false), this guard always allows navigation.
 *
 * Usage:
 * 1. Component implements HasUnsavedChanges interface
 * 2. Add canDeactivate: [UnsavedChangesGuard] to route config
 * 3. Component registers with UnsavedChangesService when dirty
 */
@Injectable({
  providedIn: 'root'
})
export class UnsavedChangesGuard implements CanDeactivate<HasUnsavedChanges> {

  constructor(private unsavedChangesService: UnsavedChangesService) {}

  canDeactivate(
    component: HasUnsavedChanges
  ): Observable<boolean> | Promise<boolean> | boolean {
    // Skip guard on mobile - only active on web
    if (!environment.isWeb) {
      return true;
    }

    // Check if component has its own unsaved changes check
    if (component && typeof component.hasUnsavedChanges === 'function') {
      if (component.hasUnsavedChanges()) {
        return this.unsavedChangesService.confirmNavigation();
      }
      return true;
    }

    // Fall back to service-level dirty tracking
    if (this.unsavedChangesService.isDirty()) {
      return this.unsavedChangesService.confirmNavigation();
    }

    return true;
  }
}
