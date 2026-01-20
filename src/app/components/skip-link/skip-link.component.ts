import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { environment } from '../../../environments/environment';

/**
 * G2-A11Y-002: Skip link component for keyboard accessibility
 * Provides a skip link that allows keyboard users to bypass navigation
 * and jump directly to the main content area.
 * Web only - not rendered on mobile platforms.
 */
@Component({
  selector: 'app-skip-link',
  standalone: true,
  imports: [CommonModule],
  template: `
    <a
      *ngIf="isWeb"
      class="skip-link"
      href="#main-content"
      (click)="skipToMain($event)"
    >
      Skip to main content
    </a>
  `,
  styles: [`
    .skip-link {
      position: absolute;
      top: -100px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99999;
      background: var(--noble-orange, #F15A27);
      color: white;
      padding: 12px 24px;
      border-radius: 0 0 8px 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      transition: top 0.2s ease-in-out;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .skip-link:focus,
    .skip-link:focus-visible {
      top: 0;
      outline: 3px solid var(--noble-dark-gray, #333333);
      outline-offset: 2px;
    }
  `]
})
export class SkipLinkComponent {
  readonly isWeb = environment.isWeb;

  skipToMain(event: Event): void {
    event.preventDefault();
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      mainContent.focus();
      mainContent.scrollIntoView({ behavior: 'smooth' });
    }
  }
}
