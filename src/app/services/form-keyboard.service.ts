import { Injectable } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { environment } from '../../environments/environment';

/**
 * Form Keyboard Navigation Service (Web Only)
 * Provides keyboard navigation support for forms
 * G2-FORMS-003
 */

export interface KeyboardNavigationConfig {
  formSelector?: string;           // CSS selector for the form
  submitOnEnter?: boolean;         // Whether Enter submits the form (default: true)
  escapeCloses?: boolean;          // Whether Escape closes modal (default: true)
  trapFocus?: boolean;             // Trap focus within form (default: false)
}

@Injectable({
  providedIn: 'root'
})
export class FormKeyboardService {

  private keydownHandlers: Map<string, (event: KeyboardEvent) => void> = new Map();

  // Only enable on web platform
  private get isWeb(): boolean {
    return environment.isWeb;
  }

  constructor(private modalController: ModalController) {}

  /**
   * Initialize keyboard navigation for a form/modal
   * Call this in ngAfterViewInit or ionViewDidEnter
   */
  initKeyboardNavigation(
    containerId: string,
    config: KeyboardNavigationConfig = {}
  ): void {
    if (!this.isWeb) return;

    const {
      submitOnEnter = true,
      escapeCloses = true
    } = config;

    // Remove any existing handler
    this.destroyKeyboardNavigation(containerId);

    const handler = (event: KeyboardEvent) => {
      // Handle Escape key - close modals/dialogs
      if (event.key === 'Escape' && escapeCloses) {
        this.handleEscapeKey(event);
      }

      // Handle Enter key - submit form (except in textareas)
      if (event.key === 'Enter' && submitOnEnter) {
        this.handleEnterKey(event, config.formSelector);
      }
    };

    document.addEventListener('keydown', handler);
    this.keydownHandlers.set(containerId, handler);
  }

  /**
   * Handle Escape key - dismiss top modal
   */
  private async handleEscapeKey(event: KeyboardEvent): Promise<void> {
    // Don't handle if in an input that might use Escape
    const target = event.target as HTMLElement;
    if (target.tagName === 'SELECT' && (target as HTMLSelectElement).multiple) {
      return; // Allow native Escape behavior for multi-selects
    }

    // Try to dismiss the top modal
    try {
      const modal = await this.modalController.getTop();
      if (modal) {
        event.preventDefault();
        event.stopPropagation();
        await modal.dismiss(null, 'escape');
      }
    } catch (e) {
      // No modal to dismiss
    }
  }

  /**
   * Handle Enter key - submit form
   */
  private handleEnterKey(event: KeyboardEvent, formSelector?: string): void {
    const target = event.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();

    // Don't submit if in textarea (allow newlines)
    if (tagName === 'textarea') {
      return;
    }

    // Don't submit if in a select (allow Enter to select option)
    if (tagName === 'select') {
      return;
    }

    // Don't submit if focused on a button (allow Enter to click button)
    if (tagName === 'button' || target.getAttribute('role') === 'button') {
      return;
    }

    // Check if we're in a form
    const form = target.closest('form');
    if (form) {
      event.preventDefault();

      // Find and click the submit button
      const submitBtn = form.querySelector(
        'button[type="submit"], ion-button[type="submit"], [type="submit"]'
      ) as HTMLElement;

      if (submitBtn && !submitBtn.hasAttribute('disabled')) {
        submitBtn.click();
      }
    }
  }

  /**
   * Set logical tab order for form elements
   * Automatically assigns tabindex based on visual order
   */
  setTabOrder(containerSelector: string, elementSelectors: string[]): void {
    if (!this.isWeb) return;

    const container = document.querySelector(containerSelector);
    if (!container) return;

    let tabIndex = 1;
    for (const selector of elementSelectors) {
      const elements = container.querySelectorAll(selector);
      elements.forEach((el: Element) => {
        (el as HTMLElement).tabIndex = tabIndex++;
      });
    }
  }

  /**
   * Enable arrow key navigation for a dropdown/select
   */
  enableDropdownArrowKeys(selectElement: HTMLSelectElement | HTMLElement): void {
    if (!this.isWeb) return;

    // For ion-select, Ionic handles this natively
    // For native select, browser handles this natively
    // This method is here for custom dropdown implementations

    const isIonSelect = selectElement.tagName.toLowerCase() === 'ion-select';
    if (isIonSelect) {
      // Ionic handles arrow keys in action sheets/popovers
      return;
    }

    // For native selects, ensure they're focusable
    if ((selectElement as HTMLSelectElement).tabIndex === undefined) {
      (selectElement as HTMLSelectElement).tabIndex = 0;
    }
  }

  /**
   * Focus the first focusable element in a container
   */
  focusFirst(containerSelector: string): void {
    if (!this.isWeb) return;

    const container = document.querySelector(containerSelector);
    if (!container) return;

    const focusable = container.querySelector<HTMLElement>(
      'input:not([disabled]):not([type="hidden"]), ' +
      'select:not([disabled]), ' +
      'textarea:not([disabled]), ' +
      'button:not([disabled]), ' +
      'ion-input:not([disabled]), ' +
      'ion-select:not([disabled]), ' +
      'ion-textarea:not([disabled]), ' +
      '[tabindex]:not([tabindex="-1"])'
    );

    if (focusable) {
      // For ion-input, focus the native input inside
      const nativeInput = focusable.querySelector('input');
      if (nativeInput) {
        nativeInput.focus();
      } else {
        focusable.focus();
      }
    }
  }

  /**
   * Focus the next focusable element
   */
  focusNext(currentElement: HTMLElement): void {
    if (!this.isWeb) return;

    const focusables = this.getFocusableElements(document.body);
    const currentIndex = focusables.indexOf(currentElement);

    if (currentIndex >= 0 && currentIndex < focusables.length - 1) {
      focusables[currentIndex + 1].focus();
    }
  }

  /**
   * Focus the previous focusable element
   */
  focusPrevious(currentElement: HTMLElement): void {
    if (!this.isWeb) return;

    const focusables = this.getFocusableElements(document.body);
    const currentIndex = focusables.indexOf(currentElement);

    if (currentIndex > 0) {
      focusables[currentIndex - 1].focus();
    }
  }

  /**
   * Get all focusable elements within a container
   */
  private getFocusableElements(container: HTMLElement): HTMLElement[] {
    const selector =
      'input:not([disabled]):not([type="hidden"]), ' +
      'select:not([disabled]), ' +
      'textarea:not([disabled]), ' +
      'button:not([disabled]), ' +
      'a[href], ' +
      '[tabindex]:not([tabindex="-1"])';

    return Array.from(container.querySelectorAll<HTMLElement>(selector))
      .filter(el => {
        // Filter out hidden elements
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
  }

  /**
   * Clean up keyboard navigation for a component
   * Call this in ngOnDestroy or ionViewWillLeave
   */
  destroyKeyboardNavigation(containerId: string): void {
    const handler = this.keydownHandlers.get(containerId);
    if (handler) {
      document.removeEventListener('keydown', handler);
      this.keydownHandlers.delete(containerId);
    }
  }

  /**
   * Add keyboard shortcut for form submission
   * For cases where the form doesn't use a standard form element
   */
  addSubmitShortcut(
    containerId: string,
    submitCallback: () => void,
    isValidCallback?: () => boolean
  ): void {
    if (!this.isWeb) return;

    // Remove existing handler
    this.destroyKeyboardNavigation(containerId);

    const handler = (event: KeyboardEvent) => {
      // Handle Enter key
      if (event.key === 'Enter') {
        const target = event.target as HTMLElement;
        const tagName = target.tagName.toLowerCase();

        // Don't submit from textarea
        if (tagName === 'textarea') return;
        // Don't submit from buttons (let them handle their own click)
        if (tagName === 'button') return;

        // Check if form is valid
        if (isValidCallback && !isValidCallback()) {
          return;
        }

        event.preventDefault();
        submitCallback();
      }

      // Handle Escape key - close modals
      if (event.key === 'Escape') {
        this.handleEscapeKey(event);
      }
    };

    document.addEventListener('keydown', handler);
    this.keydownHandlers.set(containerId, handler);
  }
}
