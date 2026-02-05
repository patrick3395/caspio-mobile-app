/**
 * Performance Monitoring Service
 * Tracks and reports performance metrics for optimization
 */

import { Injectable } from '@angular/core';

export interface PerformanceMetrics {
  loadTime: number;
  memoryUsage: number;
  networkRequests: number;
  cacheHitRate: number;
  bundleSize: number;
  imageLoadTime: number;
  componentLoadTime: number;
  timestamp: number;
}

export interface PerformanceReport {
  overallScore: number;
  metrics: PerformanceMetrics;
  recommendations: string[];
  criticalIssues: string[];
}

@Injectable({
  providedIn: 'root'
})
export class PerformanceMonitorService {
  private metrics: PerformanceMetrics[] = [];
  private networkRequests = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private componentLoadTimes = new Map<string, number>();
  private imageLoadTimes = new Map<string, number>();

  constructor() {
    this.initializeMonitoring();
  }

  /**
   * Start performance monitoring
   */
  start(): void {
    this.initializeMonitoring();
  }

  /**
   * Initialize performance monitoring
   */
  private initializeMonitoring(): void {
    if (typeof window === 'undefined') return;

    // Monitor page load performance
    window.addEventListener('load', () => {
      this.recordPageLoadMetrics();
    });

    // Monitor memory usage
    this.startMemoryMonitoring();

    // Monitor network performance
    this.startNetworkMonitoring();

  }

  /**
   * Record page load metrics
   */
  private recordPageLoadMetrics(): void {
    if (typeof performance === 'undefined') return;

    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const loadTime = navigation.loadEventEnd - navigation.fetchStart;

    const metrics: PerformanceMetrics = {
      loadTime,
      memoryUsage: this.getMemoryUsage(),
      networkRequests: this.networkRequests,
      cacheHitRate: this.getCacheHitRate(),
      bundleSize: this.getBundleSize(),
      imageLoadTime: this.getAverageImageLoadTime(),
      componentLoadTime: this.getAverageComponentLoadTime(),
      timestamp: Date.now()
    };

    this.metrics.push(metrics);
  }

  /**
   * Start memory monitoring
   */
  private startMemoryMonitoring(): void {
    if (!('memory' in performance)) return;

    setInterval(() => {
      const memory = (performance as any).memory;
      if (memory) {
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Start network monitoring
   */
  private startNetworkMonitoring(): void {
    if (typeof PerformanceObserver === 'undefined') return;

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'resource') {
          this.networkRequests++;
          
          // Check if it was a cache hit
          const resource = entry as PerformanceResourceTiming;
          if (resource.transferSize === 0 && resource.decodedBodySize > 0) {
            this.cacheHits++;
          } else {
            this.cacheMisses++;
          }
        }
      }
    });

    observer.observe({ entryTypes: ['resource'] });
  }

  /**
   * Record component load time
   */
  recordComponentLoadTime(componentName: string, loadTime: number): void {
    this.componentLoadTimes.set(componentName, loadTime);
  }

  /**
   * Record image load time
   */
  recordImageLoadTime(imageUrl: string, loadTime: number): void {
    this.imageLoadTimes.set(imageUrl, loadTime);
  }

  /**
   * Get current memory usage
   */
  private getMemoryUsage(): number {
    if (!('memory' in performance)) return 0;
    
    const memory = (performance as any).memory;
    return memory ? Math.round(memory.usedJSHeapSize / 1024 / 1024) : 0;
  }

  /**
   * Get cache hit rate
   */
  private getCacheHitRate(): number {
    const total = this.cacheHits + this.cacheMisses;
    return total > 0 ? (this.cacheHits / total) * 100 : 0;
  }

  /**
   * Get bundle size (approximate)
   */
  private getBundleSize(): number {
    // This would need to be implemented based on your bundle analysis
    return 0;
  }

  /**
   * Get average image load time
   */
  private getAverageImageLoadTime(): number {
    const times = Array.from(this.imageLoadTimes.values());
    return times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  }

  /**
   * Get average component load time
   */
  private getAverageComponentLoadTime(): number {
    const times = Array.from(this.componentLoadTimes.values());
    return times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  }

  /**
   * Generate performance report
   */
  generateReport(): PerformanceReport {
    const latestMetrics = this.metrics[this.metrics.length - 1];
    if (!latestMetrics) {
      return {
        overallScore: 0,
        metrics: {} as PerformanceMetrics,
        recommendations: [],
        criticalIssues: ['No performance data available']
      };
    }

    const score = this.calculatePerformanceScore(latestMetrics);
    const recommendations = this.generateRecommendations(latestMetrics);
    const criticalIssues = this.identifyCriticalIssues(latestMetrics);

    return {
      overallScore: score,
      metrics: latestMetrics,
      recommendations,
      criticalIssues
    };
  }

  /**
   * Calculate overall performance score
   */
  private calculatePerformanceScore(metrics: PerformanceMetrics): number {
    let score = 100;

    // Deduct points for slow load times
    if (metrics.loadTime > 3000) score -= 20;
    else if (metrics.loadTime > 2000) score -= 10;
    else if (metrics.loadTime > 1000) score -= 5;

    // Deduct points for high memory usage
    if (metrics.memoryUsage > 100) score -= 15;
    else if (metrics.memoryUsage > 50) score -= 10;

    // Deduct points for low cache hit rate
    if (metrics.cacheHitRate < 50) score -= 15;
    else if (metrics.cacheHitRate < 70) score -= 10;

    // Deduct points for slow image loading
    if (metrics.imageLoadTime > 2000) score -= 10;
    else if (metrics.imageLoadTime > 1000) score -= 5;

    return Math.max(0, score);
  }

  /**
   * Generate performance recommendations
   */
  private generateRecommendations(metrics: PerformanceMetrics): string[] {
    const recommendations: string[] = [];

    if (metrics.loadTime > 2000) {
      recommendations.push('Consider implementing code splitting to reduce initial bundle size');
    }

    if (metrics.memoryUsage > 50) {
      recommendations.push('Review memory usage and implement proper cleanup in components');
    }

    if (metrics.cacheHitRate < 70) {
      recommendations.push('Improve caching strategy to increase cache hit rate');
    }

    if (metrics.imageLoadTime > 1000) {
      recommendations.push('Implement image optimization and lazy loading');
    }

    if (metrics.networkRequests > 50) {
      recommendations.push('Reduce number of network requests through batching and caching');
    }

    return recommendations;
  }

  /**
   * Identify critical performance issues
   */
  private identifyCriticalIssues(metrics: PerformanceMetrics): string[] {
    const issues: string[] = [];

    if (metrics.loadTime > 5000) {
      issues.push('Critical: Page load time exceeds 5 seconds');
    }

    if (metrics.memoryUsage > 150) {
      issues.push('Critical: Memory usage exceeds 150MB');
    }

    if (metrics.cacheHitRate < 30) {
      issues.push('Critical: Cache hit rate below 30%');
    }

    return issues;
  }

  /**
   * Get performance trends
   */
  getPerformanceTrends(): { loadTime: number[]; memoryUsage: number[]; cacheHitRate: number[] } {
    return {
      loadTime: this.metrics.map(m => m.loadTime),
      memoryUsage: this.metrics.map(m => m.memoryUsage),
      cacheHitRate: this.metrics.map(m => m.cacheHitRate)
    };
  }

  /**
   * Export performance data
   */
  exportPerformanceData(): string {
    return JSON.stringify({
      metrics: this.metrics,
      componentLoadTimes: Object.fromEntries(this.componentLoadTimes),
      imageLoadTimes: Object.fromEntries(this.imageLoadTimes),
      report: this.generateReport()
    }, null, 2);
  }

  /**
   * Clear performance data
   */
  clearData(): void {
    this.metrics = [];
    this.componentLoadTimes.clear();
    this.imageLoadTimes.clear();
    this.networkRequests = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
}