import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export type OperationType = 'CREATE_ROOM' | 'CREATE_POINT' | 'UPLOAD_PHOTO' | 'UPDATE_ROOM' | 'DELETE_ROOM' |
                            'CREATE_VISUAL' | 'UPDATE_VISUAL' | 'DELETE_VISUAL' | 'UPLOAD_VISUAL_PHOTO' | 'UPLOAD_VISUAL_PHOTO_UPDATE' | 'UPLOAD_ROOM_POINT_PHOTO_UPDATE' | 'UPLOAD_FDF_PHOTO';
export type OperationStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'cancelled';

export interface Operation {
  id: string;
  type: OperationType;
  status: OperationStatus;
  retryCount: number;
  maxRetries: number;
  data: any;
  dependencies: string[];
  createdAt: number;
  lastAttempt: number;
  error?: string;
  dedupeKey?: string;
  onSuccess?: (result: any) => void;
  onError?: (error: any) => void;
  onProgress?: (percent: number) => void;
}

@Injectable({
  providedIn: 'root'
})
export class OperationsQueueService {
  private queue: Operation[] = [];
  private processing = false;
  private queueSubject = new BehaviorSubject<Operation[]>([]);

  public queue$ = this.queueSubject.asObservable();

  constructor() {
    // Monitor network status
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('[OperationsQueue] Network restored - processing queue');
        this.processQueue();
      });

      window.addEventListener('offline', () => {
        console.log('[OperationsQueue] Network lost - operations will be queued');
      });
    }
  }

  /**
   * Enqueue an operation with automatic retry and deduplication
   */
  async enqueue(operation: Partial<Operation>): Promise<string> {
    const op: Operation = {
      id: this.generateOperationId(),
      type: operation.type!,
      status: 'pending',
      retryCount: 0,
      maxRetries: operation.maxRetries || 3,
      data: operation.data || {},
      dependencies: operation.dependencies || [],
      createdAt: Date.now(),
      lastAttempt: 0,
      dedupeKey: operation.dedupeKey,
      onSuccess: operation.onSuccess,
      onError: operation.onError,
      onProgress: operation.onProgress
    };

    // Check for duplicates
    if (op.dedupeKey && this.isDuplicate(op.dedupeKey)) {
      console.log(`[OperationsQueue] Skipping duplicate operation: ${op.dedupeKey}`);
      return this.findOperationByDedupeKey(op.dedupeKey)!.id;
    }

    this.queue.push(op);
    this.queueSubject.next([...this.queue]);
    await this.persist();

    console.log(`[OperationsQueue] Enqueued ${op.type} operation ${op.id}`);

    // Start processing if not already running
    if (!this.processing) {
      this.processQueue();
    }

    return op.id;
  }

  /**
   * Process the queue with dependency resolution and retry logic
   */
  async processQueue(): Promise<void> {
    if (this.processing) {
      console.log('[OperationsQueue] Already processing queue');
      return;
    }

    if (!navigator.onLine) {
      console.log('[OperationsQueue] Offline - waiting for network');
      return;
    }

    this.processing = true;

    try {
      while (true) {
        const nextOp = this.getNextReadyOperation();

        if (!nextOp) {
          console.log('[OperationsQueue] No more operations ready');
          break;
        }

        await this.executeOperation(nextOp);
      }
    } finally {
      this.processing = false;
      await this.persist();
      this.queueSubject.next([...this.queue]);
    }
  }

  /**
   * Execute a single operation with retry logic
   */
  private async executeOperation(op: Operation): Promise<void> {
    op.status = 'in-progress';
    op.lastAttempt = Date.now();
    this.queueSubject.next([...this.queue]);

    try {
      console.log(`[OperationsQueue] Executing ${op.type} (attempt ${op.retryCount + 1}/${op.maxRetries + 1})`);

      const result = await this.performOperation(op);

      // Success
      op.status = 'completed';
      if (op.onSuccess) {
        op.onSuccess(result);
      }

      // Remove from queue
      this.removeOperation(op.id);
      console.log(`[OperationsQueue] Completed ${op.type} operation ${op.id}`);

    } catch (error: any) {
      console.error(`[OperationsQueue] Error executing ${op.type}:`, error);

      // Check if we should retry
      if (op.retryCount < op.maxRetries && this.isRetryableError(error)) {
        op.status = 'pending';
        op.retryCount++;
        op.error = error.message || 'Operation failed';

        // Exponential backoff
        const delay = Math.pow(2, op.retryCount) * 1000;
        console.log(`[OperationsQueue] Will retry ${op.type} in ${delay}ms`);

        await this.sleep(delay);

      } else {
        // Final failure
        op.status = 'failed';
        op.error = error.message || 'Operation failed after max retries';

        if (op.onError) {
          op.onError(error);
        }

        console.error(`[OperationsQueue] Operation ${op.id} failed permanently:`, op.error);
      }
    }

    this.queueSubject.next([...this.queue]);
  }

  /**
   * Set the executor function for a specific operation type
   */
  private executors = new Map<OperationType, (data: any, onProgress?: (p: number) => void) => Promise<any>>();

  setExecutor(type: OperationType, executor: (data: any, onProgress?: (p: number) => void) => Promise<any>): void {
    this.executors.set(type, executor);
  }

  /**
   * Perform the actual operation using registered executors
   */
  private async performOperation(op: Operation): Promise<any> {
    const executor = this.executors.get(op.type);
    if (!executor) {
      throw new Error(`No executor registered for operation type: ${op.type}`);
    }
    return executor(op.data, op.onProgress);
  }

  /**
   * Get the next operation that's ready to execute (dependencies met)
   */
  private getNextReadyOperation(): Operation | null {
    for (const op of this.queue) {
      if (op.status !== 'pending') continue;

      // Check if all dependencies are completed
      const dependenciesMet = op.dependencies.every(depId => {
        const dep = this.queue.find(o => o.id === depId);
        return !dep || dep.status === 'completed';
      });

      if (dependenciesMet) {
        return op;
      }
    }

    return null;
  }

  /**
   * Check if error is retryable (network errors, timeouts)
   */
  private isRetryableError(error: any): boolean {
    return error.status === 0 ||           // Network error
           error.status === 408 ||          // Timeout
           error.status === 429 ||          // Too many requests
           error.status >= 500 ||           // Server error
           error.name === 'TimeoutError';
  }

  /**
   * Check for duplicate operations
   */
  private isDuplicate(dedupeKey: string): boolean {
    return this.queue.some(op =>
      op.dedupeKey === dedupeKey &&
      (op.status === 'pending' || op.status === 'in-progress')
    );
  }

  private findOperationByDedupeKey(dedupeKey: string): Operation | undefined {
    return this.queue.find(op => op.dedupeKey === dedupeKey);
  }

  /**
   * Remove an operation from the queue
   */
  private removeOperation(id: string): void {
    const index = this.queue.findIndex(op => op.id === id);
    if (index >= 0) {
      this.queue.splice(index, 1);
    }
  }

  /**
   * Generate unique operation ID
   */
  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Persist queue to IndexedDB (placeholder - to be implemented)
   */
  private async persist(): Promise<void> {
    // TODO: Implement IndexedDB persistence
    try {
      localStorage.setItem('operations_queue', JSON.stringify(
        this.queue.map(op => ({
          ...op,
          // Remove callbacks for serialization
          onSuccess: undefined,
          onError: undefined,
          onProgress: undefined
        }))
      ));
    } catch (error) {
      console.error('[OperationsQueue] Failed to persist queue:', error);
    }
  }

  /**
   * Restore queue from IndexedDB (placeholder - to be implemented)
   */
  async restore(): Promise<void> {
    try {
      const stored = localStorage.getItem('operations_queue');
      if (stored) {
        this.queue = JSON.parse(stored);
        this.queueSubject.next([...this.queue]);
        console.log(`[OperationsQueue] Restored ${this.queue.length} operations from storage`);

        // Resume processing
        if (this.queue.length > 0 && navigator.onLine) {
          this.processQueue();
        }
      }
    } catch (error) {
      console.error('[OperationsQueue] Failed to restore queue:', error);
    }
  }

  /**
   * Manual retry for failed operation
   */
  async retryOperation(id: string): Promise<void> {
    const op = this.queue.find(o => o.id === id);
    if (!op) {
      console.error('[OperationsQueue] Operation not found:', id);
      return;
    }

    if (op.status !== 'failed') {
      console.warn('[OperationsQueue] Operation is not in failed state:', op.status);
      return;
    }

    op.status = 'pending';
    op.retryCount = 0;
    op.error = undefined;
    this.queueSubject.next([...this.queue]);

    if (!this.processing) {
      this.processQueue();
    }
  }

  /**
   * Cancel an operation
   */
  cancelOperation(id: string): void {
    const op = this.queue.find(o => o.id === id);
    if (op && op.status !== 'completed') {
      op.status = 'cancelled';
      this.removeOperation(id);
      this.queueSubject.next([...this.queue]);
      this.persist();
    }
  }

  /**
   * Get queue statistics
   */
  getStats() {
    const pending = this.queue.filter(op => op.status === 'pending').length;
    const inProgress = this.queue.filter(op => op.status === 'in-progress').length;
    const failed = this.queue.filter(op => op.status === 'failed').length;
    const total = this.queue.length;

    return { pending, inProgress, failed, total };
  }

  /**
   * Check if queue has pending operations
   */
  hasPending(): boolean {
    return this.queue.some(op =>
      op.status === 'pending' || op.status === 'in-progress'
    );
  }

  /**
   * Get progress percentage
   */
  getProgress(): number {
    if (this.queue.length === 0) return 1;
    const completed = this.queue.filter(op => op.status === 'completed').length;
    return completed / this.queue.length;
  }

  /**
   * Clear all completed operations
   */
  clearCompleted(): void {
    this.queue = this.queue.filter(op => op.status !== 'completed');
    this.queueSubject.next([...this.queue]);
    this.persist();
  }

  /**
   * Get all operations
   */
  getAllOperations(): Operation[] {
    return [...this.queue];
  }
}
