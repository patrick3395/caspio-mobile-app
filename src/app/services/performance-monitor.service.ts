import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

interface PerformanceEntryLike {
  name: string;
  value?: number;
  startTime?: number;
  duration?: number;
  entryType: string;
  [key: string]: any;
}

@Injectable({ providedIn: 'root' })
export class PerformanceMonitorService {
  private started = false;

  start(): void {
    if (this.started || typeof window === 'undefined') {
      return;
    }
    this.started = true;

    if (!environment.production) {
      // Keep the logging in development to make it actionable during QA sessions
      this.bootstrapObservers();
    } else {
      // In production, observe and log only high-level metrics to avoid console noise
      this.bootstrapObservers({ logDetailed: false });
    }
  }

  private bootstrapObservers(options: { logDetailed?: boolean } = {}): void {
    const { logDetailed = true } = options;

    if (typeof performance === 'undefined') {
      return;
    }

    if (typeof PerformanceObserver !== 'undefined') {
      this.observeMetric('largest-contentful-paint', (entry) => {
        this.logMetric('LCP', entry.startTime ?? entry.renderTime ?? entry.loadTime, entry, logDetailed);
      });

      this.observeMetric('first-input', (entry) => {
        const delay = entry.processingStart - entry.startTime;
        this.logMetric('FID', delay, entry, logDetailed);
      });

      this.observeMetric('layout-shift', (entry) => {
        if (!entry.hadRecentInput) {
          this.logMetric('CLS', entry.value, entry, logDetailed);
        }
      });

      this.observeMetric('paint', (entry) => {
        if (entry.name === 'first-contentful-paint') {
          this.logMetric('FCP', entry.startTime, entry, logDetailed);
        }
      });

      this.observeMetric('longtask', (entry) => {
        this.logMetric('LongTask', entry.duration, entry, logDetailed);
      });
    }

    const navigationEntries = performance.getEntriesByType('navigation');
    if (navigationEntries.length > 0) {
      const nav = navigationEntries[0] as PerformanceEntryLike;
      this.logMetric('TTFB', (nav as any).responseStart, nav, logDetailed);
      this.logMetric('DomContentLoaded', (nav as any).domContentLoadedEventStart, nav, logDetailed);
      this.logMetric('Load', (nav as any).loadEventStart, nav, logDetailed);
    }
  }

  private observeMetric(type: string, handler: (entry: any) => void): void {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          handler(entry);
        }
      });
      observer.observe({ type, buffered: true });
    } catch (error) {
      console.warn(`[PerformanceMonitor] Unable to observe ${type}:`, error);
    }
  }

  private logMetric(label: string, value: number | undefined, entry: PerformanceEntryLike, logDetailed: boolean): void {
    if (typeof value !== 'number') {
      return;
    }
    const rounded = Math.round(value);
    if (logDetailed) {
    } else {
    }
  }
}
