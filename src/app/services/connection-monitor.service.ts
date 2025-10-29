import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface ConnectionHealth {
  isHealthy: boolean;
  successRate: number; // 0-100
  averageResponseTime: number; // milliseconds
  recentFailures: number;
  lastSuccessTime: number | null;
  lastFailureTime: number | null;
}

interface RequestRecord {
  timestamp: number;
  success: boolean;
  responseTime: number;
  endpoint: string;
}

@Injectable({
  providedIn: 'root'
})
export class ConnectionMonitorService {
  private readonly MAX_RECORDS = 100; // Keep last 100 requests
  private readonly HEALTH_WINDOW = 5 * 60 * 1000; // 5 minutes
  private readonly FAILURE_THRESHOLD = 5; // 5 recent failures = unhealthy

  private requestHistory: RequestRecord[] = [];
  private healthSubject = new BehaviorSubject<ConnectionHealth>({
    isHealthy: true,
    successRate: 100,
    averageResponseTime: 0,
    recentFailures: 0,
    lastSuccessTime: null,
    lastFailureTime: null
  });

  constructor() {}

  /**
   * Record a successful API request
   */
  recordSuccess(endpoint: string, responseTime: number): void {
    this.addRecord({
      timestamp: Date.now(),
      success: true,
      responseTime,
      endpoint
    });
    this.updateHealth();
  }

  /**
   * Record a failed API request
   */
  recordFailure(endpoint: string, responseTime: number = 0): void {
    this.addRecord({
      timestamp: Date.now(),
      success: false,
      responseTime,
      endpoint
    });
    this.updateHealth();
  }

  /**
   * Get the current connection health status
   */
  getHealth(): Observable<ConnectionHealth> {
    return this.healthSubject.asObservable();
  }

  /**
   * Get the current health snapshot
   */
  getCurrentHealth(): ConnectionHealth {
    return this.healthSubject.value;
  }

  /**
   * Check if connection is currently healthy
   */
  isHealthy(): boolean {
    return this.healthSubject.value.isHealthy;
  }

  /**
   * Reset all health metrics
   */
  reset(): void {
    this.requestHistory = [];
    this.healthSubject.next({
      isHealthy: true,
      successRate: 100,
      averageResponseTime: 0,
      recentFailures: 0,
      lastSuccessTime: null,
      lastFailureTime: null
    });
  }

  /**
   * Get recent request history (for debugging)
   */
  getRecentHistory(count: number = 10): RequestRecord[] {
    return this.requestHistory.slice(-count);
  }

  private addRecord(record: RequestRecord): void {
    this.requestHistory.push(record);

    // Trim old records
    if (this.requestHistory.length > this.MAX_RECORDS) {
      this.requestHistory = this.requestHistory.slice(-this.MAX_RECORDS);
    }

    // Also remove records older than the health window
    const cutoffTime = Date.now() - this.HEALTH_WINDOW;
    this.requestHistory = this.requestHistory.filter(r => r.timestamp > cutoffTime);
  }

  private updateHealth(): void {
    if (this.requestHistory.length === 0) {
      return;
    }

    const now = Date.now();
    const windowStart = now - this.HEALTH_WINDOW;

    // Get requests within the health window
    const recentRequests = this.requestHistory.filter(r => r.timestamp > windowStart);

    if (recentRequests.length === 0) {
      return;
    }

    // Calculate metrics
    const successfulRequests = recentRequests.filter(r => r.success);
    const failedRequests = recentRequests.filter(r => !r.success);
    const successRate = (successfulRequests.length / recentRequests.length) * 100;

    // Calculate average response time (only for successful requests)
    const averageResponseTime = successfulRequests.length > 0
      ? successfulRequests.reduce((sum, r) => sum + r.responseTime, 0) / successfulRequests.length
      : 0;

    // Count recent consecutive failures
    let recentFailures = 0;
    for (let i = this.requestHistory.length - 1; i >= 0; i--) {
      if (!this.requestHistory[i].success) {
        recentFailures++;
      } else {
        break; // Stop at first success
      }
    }

    // Determine if connection is healthy
    const isHealthy = recentFailures < this.FAILURE_THRESHOLD && successRate >= 50;

    // Find last success and failure times
    const lastSuccess = successfulRequests.length > 0
      ? successfulRequests[successfulRequests.length - 1].timestamp
      : null;
    const lastFailure = failedRequests.length > 0
      ? failedRequests[failedRequests.length - 1].timestamp
      : null;

    // Update health subject
    this.healthSubject.next({
      isHealthy,
      successRate: Math.round(successRate * 10) / 10, // Round to 1 decimal
      averageResponseTime: Math.round(averageResponseTime),
      recentFailures,
      lastSuccessTime: lastSuccess,
      lastFailureTime: lastFailure
    });
  }
}
