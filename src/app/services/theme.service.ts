import { DOCUMENT } from '@angular/common';
import { Inject, Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ThemeService implements OnDestroy {
  private readonly storageKey = 'app-theme-preference';
  private readonly darkClass = 'dark-theme';
  private readonly metaThemeSelector = 'meta[name="theme-color"]';

  private readonly darkModeSubject = new BehaviorSubject<boolean>(false);
  readonly darkMode$: Observable<boolean> = this.darkModeSubject.asObservable();

  private mediaQuery: MediaQueryList | null = null;
  private manualOverride = false;
  private mediaListener?: (event: MediaQueryListEvent) => void;

  constructor(@Inject(DOCUMENT) private document: Document) {
    if (typeof window === 'undefined') {
      return;
    }

    // Force light mode always - ignore system preferences and stored preferences
    this.applyTheme(false);
    this.manualOverride = true;

    // Clear any stored dark mode preference
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(this.storageKey);
    }
  }

  toggleTheme(): void {
    // Force light mode - do nothing
    this.applyTheme(false);
  }

  setDarkMode(enabled: boolean): void {
    // Force light mode - ignore dark mode requests
    this.applyTheme(false);
  }

  useSystemPreference(): void {
    // Force light mode - ignore system preferences
    this.applyTheme(false);
  }

  private applyTheme(isDark: boolean): void {
    this.darkModeSubject.next(isDark);
    const body = this.document?.body;
    if (!body) return;

    body.classList.toggle(this.darkClass, isDark);
    body.classList.toggle('dark', isDark);
    this.updateMetaThemeColor(isDark);
  }

  private updateMetaThemeColor(isDark: boolean): void {
    const meta = this.document?.querySelector(this.metaThemeSelector);
    if (!meta) {
      return;
    }
    meta.setAttribute('content', isDark ? '#121212' : '#FFFFFF');
  }

  ngOnDestroy(): void {
    if (this.mediaQuery && this.mediaListener) {
      if (typeof this.mediaQuery.removeEventListener === 'function') {
        this.mediaQuery.removeEventListener('change', this.mediaListener);
      } else if (typeof this.mediaQuery.removeListener === 'function') {
        this.mediaQuery.removeListener(this.mediaListener);
      }
    }
  }
}
