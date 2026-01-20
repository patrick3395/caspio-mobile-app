/**
 * Focus Trap Directive
 * Traps keyboard focus within a container (typically a modal dialog).
 * Ensures that Tab and Shift+Tab cycle through focusable elements within the container.
 *
 * Web-only: This directive only activates on web platform (environment.isWeb).
 * On mobile, native modal handling is used.
 *
 * Usage:
 * <div appFocusTrap [autoFocus]="true">
 *   <!-- Modal content -->
 * </div>
 */

import {
  Directive,
  ElementRef,
  Input,
  OnInit,
  OnDestroy,
  NgZone,
  AfterViewInit
} from '@angular/core';
import { environment } from '../../environments/environment';

@Directive({
  selector: '[appFocusTrap]',
  standalone: true
})
export class FocusTrapDirective implements OnInit, AfterViewInit, OnDestroy {
  @Input() autoFocus = true;
  @Input() restoreFocus = true;

  private focusableElements: HTMLElement[] = [];
  private previouslyFocusedElement: HTMLElement | null = null;
  private keydownHandler: ((event: KeyboardEvent) => void) | null = null;

  private readonly focusableSelectors = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]'
  ].join(', ');

  constructor(
    private el: ElementRef<HTMLElement>,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    // Only apply focus trap on web platform
    if (!environment.isWeb) {
      return;
    }

    // Store the previously focused element for restoration
    if (this.restoreFocus) {
      this.previouslyFocusedElement = document.activeElement as HTMLElement;
    }
  }

  ngAfterViewInit(): void {
    // Only apply focus trap on web platform
    if (!environment.isWeb) {
      return;
    }

    // Wait for the DOM to be fully rendered
    setTimeout(() => {
      this.updateFocusableElements();
      this.setupKeydownHandler();

      if (this.autoFocus) {
        this.focusFirstElement();
      }
    }, 100);
  }

  ngOnDestroy(): void {
    this.removeKeydownHandler();

    // Restore focus to the previously focused element
    if (environment.isWeb && this.restoreFocus && this.previouslyFocusedElement) {
      try {
        this.previouslyFocusedElement.focus();
      } catch (e) {
        // Element may no longer be in the DOM
      }
    }
  }

  private updateFocusableElements(): void {
    const container = this.el.nativeElement;
    const elements = container.querySelectorAll(this.focusableSelectors);
    this.focusableElements = Array.from(elements) as HTMLElement[];
  }

  private setupKeydownHandler(): void {
    this.ngZone.runOutsideAngular(() => {
      this.keydownHandler = (event: KeyboardEvent) => {
        if (event.key === 'Tab') {
          this.handleTabKey(event);
        } else if (event.key === 'Escape') {
          // Allow Escape to close modal - don't prevent default
          // The modal component should handle the Escape key
        }
      };

      this.el.nativeElement.addEventListener('keydown', this.keydownHandler);
    });
  }

  private removeKeydownHandler(): void {
    if (this.keydownHandler) {
      this.el.nativeElement.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }

  private handleTabKey(event: KeyboardEvent): void {
    // Refresh focusable elements in case the DOM has changed
    this.updateFocusableElements();

    if (this.focusableElements.length === 0) {
      event.preventDefault();
      return;
    }

    const firstElement = this.focusableElements[0];
    const lastElement = this.focusableElements[this.focusableElements.length - 1];
    const activeElement = document.activeElement as HTMLElement;

    if (event.shiftKey) {
      // Shift+Tab: If on first element, wrap to last
      if (activeElement === firstElement || !this.el.nativeElement.contains(activeElement)) {
        event.preventDefault();
        lastElement.focus();
      }
    } else {
      // Tab: If on last element, wrap to first
      if (activeElement === lastElement || !this.el.nativeElement.contains(activeElement)) {
        event.preventDefault();
        firstElement.focus();
      }
    }
  }

  private focusFirstElement(): void {
    if (this.focusableElements.length > 0) {
      // Try to focus a close button first (for better UX in modals)
      const closeButton = this.focusableElements.find(
        el => el.getAttribute('aria-label')?.toLowerCase().includes('close') ||
              el.getAttribute('aria-label')?.toLowerCase().includes('cancel')
      );

      if (closeButton) {
        closeButton.focus();
      } else {
        this.focusableElements[0].focus();
      }
    }
  }

  /**
   * Public method to manually update focusable elements
   * (useful when modal content changes dynamically)
   */
  public refresh(): void {
    if (environment.isWeb) {
      this.updateFocusableElements();
    }
  }

  /**
   * Public method to focus the first focusable element
   */
  public focusFirst(): void {
    if (environment.isWeb) {
      this.updateFocusableElements();
      this.focusFirstElement();
    }
  }
}
