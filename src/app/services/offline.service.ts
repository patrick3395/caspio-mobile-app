import { Injectable } from '@angular/core';
import { BehaviorSubject, fromEvent, merge, Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';

interface QueuedRequest {
  id: string;
  type: 'CREATE' | 'UPDATE' | 'DELETE' | 'UPLOAD';
  endpoint: string;
  data: any;
  timestamp: number;
  retries: number;
}

@Injectable({
  providedIn: 'root'
})
export class OfflineService {
  private online$ = new BehaviorSubject<boolean>(navigator.onLine);
  private requestQueue: QueuedRequest[] = [];
  private localStorage = window.localStorage;
  private QUEUE_KEY = 'offline_queue';
  private MAX_RETRIES = 3;
  
  constructor() {
    // Monitor online/offline status
    this.initializeNetworkEvents();
    // Load queued requests from localStorage
    this.loadQueue();
  }

  /**
   * Initialize network event listeners
   */
  private initializeNetworkEvents(): void {
    // Listen to browser online/offline events
    const online$ = fromEvent(window, 'online').pipe(map(() => true));
    const offline$ = fromEvent(window, 'offline').pipe(map(() => false));
    
    merge(online$, offline$).subscribe(isOnline => {
      this.online$.next(isOnline);
      
      if (isOnline) {
        console.log('📶 Back online - processing queued requests');
        this.processQueue();
      } else {
        console.log('📵 Gone offline - requests will be queued');
      }
    });
  }

  /**
   * Check if app is online
   */
  isOnline(): boolean {
    return this.online$.value;
  }

  /**
   * Get online status as observable
   */
  getOnlineStatus(): Observable<boolean> {
    return this.online$.asObservable();
  }

  /**
   * Queue a request for later processing
   */
  queueRequest(type: QueuedRequest['type'], endpoint: string, data: any): string {
    const request: QueuedRequest = {
      id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      endpoint,
      data,
      timestamp: Date.now(),
      retries: 0
    };
    
    this.requestQueue.push(request);
    this.saveQueue();
    
    // Try to process immediately if online
    if (this.isOnline()) {
      this.processQueue();
    }
    
    return request.id;
  }

  /**
   * Process queued requests
   */
  async processQueue(): Promise<void> {
    if (!this.isOnline() || this.requestQueue.length === 0) {
      return;
    }
    
    const queue = [...this.requestQueue];
    
    for (const request of queue) {
      try {
        // Process based on request type
        await this.processRequest(request);
        
        // Remove from queue on success
        this.removeFromQueue(request.id);
      } catch (error) {
        console.error(`Failed to process queued request ${request.id}:`, error);
        
        // Increment retry count
        request.retries++;
        
        if (request.retries >= this.MAX_RETRIES) {
          console.error(`Max retries reached for request ${request.id}, removing from queue`);
          this.removeFromQueue(request.id);
          
          // Store failed request for manual retry
          this.storeFailedRequest(request);
        }
      }
    }
    
    this.saveQueue();
  }

  /**
   * Process a single request
   */
  private async processRequest(request: QueuedRequest): Promise<any> {
    // This would be implemented based on your specific API calls
    // For now, it's a placeholder that would call the appropriate service method
    console.log(`Processing queued ${request.type} request to ${request.endpoint}`);
    
    // Simulate processing
    return new Promise((resolve) => {
      setTimeout(() => resolve(true), 100);
    });
  }

  /**
   * Remove request from queue
   */
  private removeFromQueue(requestId: string): void {
    this.requestQueue = this.requestQueue.filter(r => r.id !== requestId);
  }

  /**
   * Save queue to localStorage
   */
  private saveQueue(): void {
    try {
      this.localStorage.setItem(this.QUEUE_KEY, JSON.stringify(this.requestQueue));
    } catch (e) {
      console.error('Failed to save queue to localStorage:', e);
    }
  }

  /**
   * Load queue from localStorage
   */
  private loadQueue(): void {
    try {
      const stored = this.localStorage.getItem(this.QUEUE_KEY);
      if (stored) {
        this.requestQueue = JSON.parse(stored);
        
        // Clean up old requests (older than 7 days)
        const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        this.requestQueue = this.requestQueue.filter(r => r.timestamp > weekAgo);
        this.saveQueue();
      }
    } catch (e) {
      console.error('Failed to load queue from localStorage:', e);
      this.requestQueue = [];
    }
  }

  /**
   * Store failed request for manual retry
   */
  private storeFailedRequest(request: QueuedRequest): void {
    try {
      const failedKey = 'failed_requests';
      const stored = this.localStorage.getItem(failedKey);
      const failed = stored ? JSON.parse(stored) : [];
      
      failed.push({
        ...request,
        failedAt: Date.now()
      });
      
      // Keep only last 50 failed requests
      if (failed.length > 50) {
        failed.splice(0, failed.length - 50);
      }
      
      this.localStorage.setItem(failedKey, JSON.stringify(failed));
    } catch (e) {
      console.error('Failed to store failed request:', e);
    }
  }

  /**
   * Get queue status
   */
  getQueueStatus(): { count: number; oldestRequest: number | null } {
    return {
      count: this.requestQueue.length,
      oldestRequest: this.requestQueue.length > 0 
        ? Math.min(...this.requestQueue.map(r => r.timestamp))
        : null
    };
  }

  /**
   * Clear all queued requests
   */
  clearQueue(): void {
    this.requestQueue = [];
    this.saveQueue();
  }
}