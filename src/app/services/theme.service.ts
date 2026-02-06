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

    // Read stored preference, fall back to light mode
    const stored = window.localStorage.getItem(this.storageKey);
    if (stored === 'dark') {
      this.manualOverride = true;
      this.applyTheme(true);
    } else if (stored === 'light') {
      this.manualOverride = true;
      this.applyTheme(false);
    } else {
      // No stored preference — default to light mode
      this.applyTheme(false);
    }
  }

  toggleTheme(): void {
    const newValue = !this.darkModeSubject.value;
    this.manualOverride = true;
    this.applyTheme(newValue);
    this.persistPreference(newValue);
  }

  setDarkMode(enabled: boolean): void {
    this.manualOverride = true;
    this.applyTheme(enabled);
    this.persistPreference(enabled);
  }

  useSystemPreference(): void {
    this.manualOverride = false;
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(this.storageKey);
    }
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.applyTheme(this.mediaQuery.matches);

    this.mediaListener = (event: MediaQueryListEvent) => {
      if (!this.manualOverride) {
        this.applyTheme(event.matches);
      }
    };

    if (typeof this.mediaQuery.addEventListener === 'function') {
      this.mediaQuery.addEventListener('change', this.mediaListener);
    } else if (typeof this.mediaQuery.addListener === 'function') {
      this.mediaQuery.addListener(this.mediaListener);
    }
  }

  private persistPreference(isDark: boolean): void {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(this.storageKey, isDark ? 'dark' : 'light');
    }
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
