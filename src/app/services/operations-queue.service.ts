import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { db, QueuedOperation, OperationType, OperationStatus } from './caspio-db';

// Re-export types from caspio-db for backward compatibility
export { OperationType, OperationStatus } from './caspio-db';

export interface Operation extends QueuedOperation {
  // Callbacks are in-memory only - not persisted to IndexedDB
  onSuccess?: (result: any) => void;
  onError?: (error: any) => void;
  onProgress?: (percent: number) => void;
}

// Map to store callbacks by operation ID (in-memory, not persisted)
const callbackMap = new Map<string, {
  onSuccess?: (result: any) => void;
  onError?: (error: any) => void;
  onProgress?: (percent: number) => void;
}>();

@Injectable({
  providedIn: 'root'
})
export class OperationsQueueService {
  private queue: Operation[] = [];
  private processing = false;
  private queueSubject = new BehaviorSubject<Operation[]>([]);
  private initialized = false;

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

      // FIXED: Auto-restore queue on service initialization
      this.restore().catch(err => {
        console.error('[OperationsQueue] Failed to auto-restore queue:', err);
      });
    }
  }

  /**
   * Enqueue an operation with automatic retry and deduplication
   * FIXED: Store callbacks separately and persist to IndexedDB
   */
  async enqueue(operation: Partial<Operation>): Promise<string> {
    const opId = this.generateOperationId();
    const op: Operation = {
      id: opId,
      type: operation.type!,
      status: 'pending',
      retryCount: 0,
      maxRetries: operation.maxRetries || 3,
      data: operation.data || {},
      dependencies: operation.dependencies || [],
      createdAt: Date.now(),
      lastAttempt: 0,
      dedupeKey: operation.dedupeKey
    };

    // Store callbacks in memory map (not persisted)
    if (operation.onSuccess || operation.onError || operation.onProgress) {
      callbackMap.set(opId, {
        onSuccess: operation.onSuccess,
        onError: operation.onError,
        onProgress: operation.onProgress
      });
    }

    // Check for duplicates
    if (op.dedupeKey && this.isDuplicate(op.dedupeKey)) {
      console.log(`[OperationsQueue] Skipping duplicate operation: ${op.dedupeKey}`);
      const existingOp = this.findOperationByDedupeKey(op.dedupeKey);
      // Transfer callbacks to existing operation
      if (existingOp && (operation.onSuccess || operation.onError || operation.onProgress)) {
        callbackMap.set(existingOp.id, {
          onSuccess: operation.onSuccess,
          onError: operation.onError,
          onProgress: operation.onProgress
        });
      }
      return existingOp!.id;
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

      // Get callbacks from map and call onSuccess if exists
      // CRITICAL FIX: Await async callbacks to ensure temp ID mappings complete
      // before the next sync stage starts (fixes auto-sync random failures)
      const callbacks = callbackMap.get(op.id);
      if (callbacks?.onSuccess) {
        try {
          await Promise.resolve(callbacks.onSuccess(result));
        } catch (callbackErr) {
          console.warn(`[OperationsQueue] onSuccess callback error for ${op.id}:`, callbackErr);
        }
      }

      // Remove from queue and cleanup callbacks
      this.removeOperation(op.id);
      callbackMap.delete(op.id);
      console.log(`[OperationsQueue] Completed ${op.type} operation ${op.id}`);

    } catch (error: any) {
      console.error(`[OperationsQueue] Error executing ${op.type}:`, error);

      // Check if we should retry
      if (op.retryCount < op.maxRetries && this.isRetryableError(error)) {
        op.status = 'pending';
        op.retryCount++;
        op.error = error.message || 'Operation failed';

        // FIXED: Exponential backoff with cap at 5 minutes to prevent infinite waits
        const delay = Math.min(Math.pow(2, op.retryCount) * 1000, 5 * 60 * 1000);
        console.log(`[OperationsQueue] Will retry ${op.type} in ${delay}ms`);

        await this.sleep(delay);

      } else {
        // Final failure
        op.status = 'failed';
        op.error = error.message || 'Operation failed after max retries';

        // Get callbacks from map and call onError if exists
        const callbacks = callbackMap.get(op.id);
        if (callbacks?.onError) {
          callbacks.onError(error);
        }

        // Cleanup callbacks on failure
        callbackMap.delete(op.id);
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
   * FIXED: Use callback map for onProgress instead of op.onProgress
   */
  private async performOperation(op: Operation): Promise<any> {
    const executor = this.executors.get(op.type);
    if (!executor) {
      throw new Error(`No executor registered for operation type: ${op.type}`);
    }
    const callbacks = callbackMap.get(op.id);
    return executor(op.data, callbacks?.onProgress);
  }

  /**
   * Get the next operation that's ready to execute (dependencies met)
   * FIXED: Fail operations if their dependencies failed (don't wait forever)
   */
  private getNextReadyOperation(): Operation | null {
    for (const op of this.queue) {
      if (op.status !== 'pending') continue;

      // Check if any dependency failed - if so, fail this operation too
      const failedDep = op.dependencies.find(depId => {
        const dep = this.queue.find(o => o.id === depId);
        return dep && (dep.status === 'failed' || dep.status === 'cancelled');
      });

      if (failedDep) {
        // Mark this operation as failed due to dependency failure
        op.status = 'failed';
        op.error = `Dependency ${failedDep} failed or was cancelled`;
        const callbacks = callbackMap.get(op.id);
        if (callbacks?.onError) {
          callbacks.onError(new Error(op.error));
        }
        callbackMap.delete(op.id);
        console.error(`[OperationsQueue] Operation ${op.id} failed: dependency ${failedDep} failed/cancelled`);
        this.queueSubject.next([...this.queue]);
        continue;
      }

      // Check if all dependencies are completed (or removed from queue)
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
   * Persist queue to IndexedDB using Dexie
   * FIXED: Migrated from localStorage to IndexedDB for larger queue support
   */
  private async persist(): Promise<void> {
    try {
      // Clear existing queue and add all current operations
      await db.transaction('rw', db.operationsQueue, async () => {
        await db.operationsQueue.clear();
        // Add all operations (without callbacks - they're in memory map)
        const queuedOps: QueuedOperation[] = this.queue.map(op => ({
          id: op.id,
          type: op.type,
          status: op.status,
          retryCount: op.retryCount,
          maxRetries: op.maxRetries,
          data: op.data,
          dependencies: op.dependencies,
          createdAt: op.createdAt,
          lastAttempt: op.lastAttempt,
          error: op.error,
          dedupeKey: op.dedupeKey
        }));
        if (queuedOps.length > 0) {
          await db.operationsQueue.bulkAdd(queuedOps);
        }
      });
    } catch (error) {
      console.error('[OperationsQueue] Failed to persist queue to IndexedDB:', error);
      // Fallback to localStorage for older data migration
      try {
        localStorage.setItem('operations_queue', JSON.stringify(
          this.queue.map(op => ({
            ...op,
            onSuccess: undefined,
            onError: undefined,
            onProgress: undefined
          }))
        ));
      } catch (e) {
        console.error('[OperationsQueue] Fallback localStorage persist also failed:', e);
      }
    }
  }

  /**
   * Restore queue from IndexedDB using Dexie
   * FIXED: Auto-called on service initialization, migrates from localStorage if needed
   */
  async restore(): Promise<void> {
    if (this.initialized) {
      console.log('[OperationsQueue] Already initialized, skipping restore');
      return;
    }
    this.initialized = true;

    try {
      // Try to restore from IndexedDB first
      const storedOps = await db.operationsQueue.toArray();

      if (storedOps.length > 0) {
        this.queue = storedOps.map(op => ({ ...op }));
        this.queueSubject.next([...this.queue]);
        console.log(`[OperationsQueue] Restored ${this.queue.length} operations from IndexedDB`);
      } else {
        // Migrate from localStorage if exists
        const localStorageData = localStorage.getItem('operations_queue');
        if (localStorageData) {
          const parsed = JSON.parse(localStorageData);
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.queue = parsed;
            this.queueSubject.next([...this.queue]);
            // Persist to IndexedDB to complete migration
            await this.persist();
            // Remove localStorage after successful migration
            localStorage.removeItem('operations_queue');
            console.log(`[OperationsQueue] Migrated ${this.queue.length} operations from localStorage to IndexedDB`);
          }
        }
      }

      // Resume processing if queue has pending items
      if (this.queue.length > 0 && navigator.onLine) {
        const pendingCount = this.queue.filter(op => op.status === 'pending').length;
        if (pendingCount > 0) {
          console.log(`[OperationsQueue] Found ${pendingCount} pending operations, resuming processing`);
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
