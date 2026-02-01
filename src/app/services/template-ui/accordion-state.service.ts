import { Injectable, ChangeDetectorRef } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/**
 * AccordionStateService - Unified accordion expand/collapse management
 *
 * This service manages accordion state for template category-detail pages.
 * It handles section expansion, preservation during background operations,
 * and restoration after async operations complete.
 *
 * Usage:
 *   constructor(private accordionState: AccordionStateService) {}
 *
 *   // Initialize with default sections
 *   this.accordionState.initialize(['information', 'limitations', 'deficiencies']);
 *
 *   // Toggle section
 *   this.accordionState.toggleSection('information');
 *
 *   // Check if expanded
 *   const isExpanded = this.accordionState.isSectionExpanded('information');
 */
@Injectable({
  providedIn: 'root'
})
export class AccordionStateService {

  private preservedState: string[] | null = null;
  private isBackgroundLoading = false;

  // Observable for components that need reactive updates
  private expandedSections$ = new BehaviorSubject<string[]>([]);

  /**
   * Get the observable for expanded sections state
   */
  get expanded$() {
    return this.expandedSections$.asObservable();
  }

  /**
   * Get current expanded sections (snapshot)
   */
  get expandedSections(): string[] {
    return [...this._expandedSections];
  }

  private _expandedSections: string[] = [];

  /**
   * Initialize accordion with default expanded sections
   * Call this in ngOnInit of your component
   */
  initialize(defaultSections: string[] = ['information', 'limitations', 'deficiencies']): void {
    this._expandedSections = [...defaultSections];
    this.expandedSections$.next(this._expandedSections);
  }

  /**
   * Reset to initial state (for cleanup)
   */
  reset(): void {
    this._expandedSections = [];
    this.preservedState = null;
    this.isBackgroundLoading = false;
    this.expandedSections$.next([]);
  }

  /**
   * Toggle a section's expanded state
   * @param section - The section identifier to toggle
   * @param changeDetectorRef - Optional ChangeDetectorRef for manual change detection
   */
  toggleSection(section: string, changeDetectorRef?: ChangeDetectorRef): void {
    const index = this._expandedSections.indexOf(section);
    if (index > -1) {
      this._expandedSections = this._expandedSections.filter(s => s !== section);
    } else {
      this._expandedSections = [...this._expandedSections, section];
    }

    // If background loading is in progress, also update the preserved state
    // This ensures user's toggle actions are respected when background loading completes
    if (this.isBackgroundLoading && this.preservedState) {
      this.preservedState = [...this._expandedSections];
    }

    this.expandedSections$.next(this._expandedSections);

    if (changeDetectorRef) {
      changeDetectorRef.detectChanges();
    }
  }

  /**
   * Check if a section is currently expanded
   * @param section - The section identifier to check
   */
  isSectionExpanded(section: string): boolean {
    return this._expandedSections.includes(section);
  }

  /**
   * Expand all provided sections
   * @param sections - Array of section identifiers to expand
   */
  expandSections(sections: string[]): void {
    this._expandedSections = [...sections];
    this.expandedSections$.next(this._expandedSections);
  }

  /**
   * Expand all sections (convenience method)
   * @param allSections - All section identifiers
   */
  expandAll(allSections: string[] = ['information', 'limitations', 'deficiencies']): void {
    this._expandedSections = [...allSections];
    this.expandedSections$.next(this._expandedSections);
  }

  /**
   * Collapse all sections
   */
  collapseAll(): void {
    this._expandedSections = [];
    this.expandedSections$.next(this._expandedSections);
  }

  /**
   * Preserve current state before starting a background operation
   * Call this before starting background photo loading or other async operations
   */
  preserveState(): string[] {
    this.preservedState = [...this._expandedSections];
    this.isBackgroundLoading = true;
    return this.preservedState;
  }

  /**
   * Restore preserved state after background operation completes
   * Call this when background loading finishes to restore user's accordion state
   */
  restoreState(): void {
    if (this.preservedState) {
      this._expandedSections = [...this.preservedState];
      this.expandedSections$.next(this._expandedSections);
    }
    this.preservedState = null;
    this.isBackgroundLoading = false;
  }

  /**
   * Clear preserved state without restoring
   * Use when you want to discard the preserved state
   */
  clearPreservedState(): void {
    this.preservedState = null;
    this.isBackgroundLoading = false;
  }

  /**
   * Check if background loading is in progress
   */
  isLoadingInBackground(): boolean {
    return this.isBackgroundLoading;
  }

  /**
   * Set the expanded sections directly (for accordion change events)
   * @param sections - New array of expanded section identifiers
   * @param ignoreIfSearchActive - If true and searchTerm is provided, ignore the update
   * @param searchTerm - Current search term (optional)
   */
  setExpandedSections(sections: string[], ignoreIfSearchActive: boolean = false, searchTerm?: string): void {
    if (ignoreIfSearchActive && searchTerm && searchTerm.trim() !== '') {
      return;
    }

    this._expandedSections = [...sections];
    this.expandedSections$.next(this._expandedSections);
  }

  /**
   * Handle Ionic accordion change event
   * @param event - Ionic accordion change event
   * @param searchTerm - Current search term (if search is active, ignore accordion changes)
   */
  onAccordionChange(event: any, searchTerm?: string): void {
    if (event.detail && event.detail.value !== undefined) {
      // Only update if there's no active search
      if (!searchTerm || searchTerm.trim() === '') {
        const value = Array.isArray(event.detail.value)
          ? event.detail.value
          : [event.detail.value].filter(v => v);

        this._expandedSections = value;
        this.expandedSections$.next(this._expandedSections);
      }
    }
  }

  /**
   * Update accordions based on search results
   * Expand only sections that have matching items
   * @param hasCommentMatches - Whether comments section has matches
   * @param hasLimitationMatches - Whether limitations section has matches
   * @param hasDeficiencyMatches - Whether deficiencies section has matches
   * @param searchTerm - Current search term
   */
  updateForSearch(
    hasCommentMatches: boolean,
    hasLimitationMatches: boolean,
    hasDeficiencyMatches: boolean,
    searchTerm: string
  ): void {
    if (!searchTerm || searchTerm.trim() === '') {
      // No search term - expand all accordions by default for better UX
      this._expandedSections = ['information', 'limitations', 'deficiencies'];
    } else {
      // Expand only accordions that have matching results
      const expanded: string[] = [];

      if (hasCommentMatches) {
        expanded.push('information');
      }
      if (hasLimitationMatches) {
        expanded.push('limitations');
      }
      if (hasDeficiencyMatches) {
        expanded.push('deficiencies');
      }

      this._expandedSections = expanded;
    }

    this.expandedSections$.next(this._expandedSections);
  }
}
