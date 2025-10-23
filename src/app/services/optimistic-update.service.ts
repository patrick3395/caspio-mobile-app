import { Injectable } from '@angular/core';
import { Observable, Subject, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';

export interface OptimisticOperation<T> {
  id: string;
  operation: () => Observable<T>;
  rollback: () => void;
  onSuccess?: (result: T) => void;
  onError?: (error: any) => void;
  startTime: number;
  status: 'pending' | 'success' | 'error';
}

/**
 * OptimisticUpdateService
 *
 * Provides optimistic UI updates for all mutations, making edits feel instant
 * while maintaining data integrity with automatic rollback on errors.
 *
 * Key Features:
 * - Instant UI updates before API confirmation
 * - Automatic rollback on API errors
 * - Loading state shown only if operation takes > 300ms
 * - Success/error notifications
 * - Pending operation tracking
 *
 * Usage:
 * ```typescript
 * optimisticUpdate.apply({
 *   id: 'delete-project-123',
 *   operation: () => this.projectsService.deleteProject('123'),
 *   rollback: () => this.projects.push(deletedProject),
 *   onSuccess: () => console.log('Deleted!'),
 *   onError: (err) => this.showError(err)
 * });
 * ```
 */
@Injectable({
  providedIn: 'root'
})
export class OptimisticUpdateService {
  private pendingOperations = new Map<string, OptimisticOperation<any>>();
  private operations$ = new Subject<OptimisticOperation<any>>();

  // Threshold for showing loading indicators (ms)
  private readonly LOADING_THRESHOLD = 300;

  constructor() {}

  /**
   * Apply an optimistic update
   *
   * The UI is updated immediately (you do this before calling),
   * and this service handles the API call with rollback on error.
   *
   * @param config Operation configuration
   * @returns Observable of the operation result
   */
  apply<T>(config: {
    id: string;
    operation: () => Observable<T>;
    rollback: () => void;
    onSuccess?: (result: T) => void;
    onError?: (error: any) => void;
    showLoadingAfter?: number;
  }): Observable<T> {
    const operation: OptimisticOperation<T> = {
      id: config.id,
      operation: config.operation,
      rollback: config.rollback,
      onSuccess: config.onSuccess,
      onError: config.onError,
      startTime: Date.now(),
      status: 'pending'
    };

    // Track operation
    this.pendingOperations.set(config.id, operation);
    this.operations$.next(operation);

    console.log('[OptimisticUpdate] ⚡ Started:', config.id);

    // Set timeout to show loading if operation takes too long
    const loadingThreshold = config.showLoadingAfter ?? this.LOADING_THRESHOLD;
    const loadingTimer = setTimeout(() => {
      if (this.pendingOperations.has(config.id)) {
        console.log('[OptimisticUpdate] ⏳ Slow operation, showing loading:', config.id);
        // Emit updated operation status for components to show loading
        this.operations$.next({ ...operation, status: 'pending' });
      }
    }, loadingThreshold);

    return config.operation().pipe(
      tap(result => {
        clearTimeout(loadingTimer);
        const elapsed = Date.now() - operation.startTime;

        console.log('[OptimisticUpdate] ✅ Success:', config.id, `(${elapsed}ms)`);

        operation.status = 'success';
        this.pendingOperations.delete(config.id);
        this.operations$.next(operation);

        if (config.onSuccess) {
          config.onSuccess(result);
        }
      }),
      catchError(error => {
        clearTimeout(loadingTimer);
        const elapsed = Date.now() - operation.startTime;

        console.error('[OptimisticUpdate] ❌ Error:', config.id, `(${elapsed}ms)`, error);

        operation.status = 'error';
        this.pendingOperations.delete(config.id);
        this.operations$.next(operation);

        // Rollback the optimistic update
        console.log('[OptimisticUpdate] 🔄 Rolling back:', config.id);
        config.rollback();

        if (config.onError) {
          config.onError(error);
        }

        return throwError(() => error);
      })
    );
  }

  /**
   * Check if an operation is pending
   */
  isPending(id: string): boolean {
    return this.pendingOperations.has(id);
  }

  /**
   * Get pending operation
   */
  getOperation(id: string): OptimisticOperation<any> | undefined {
    return this.pendingOperations.get(id);
  }

  /**
   * Get all pending operations
   */
  getPendingOperations(): OptimisticOperation<any>[] {
    return Array.from(this.pendingOperations.values());
  }

  /**
   * Observable stream of operation status changes
   */
  get operations() {
    return this.operations$.asObservable();
  }

  /**
   * Cancel a pending operation
   */
  cancel(id: string): void {
    const operation = this.pendingOperations.get(id);
    if (operation) {
      console.log('[OptimisticUpdate] ❌ Cancelled:', id);
      operation.rollback();
      this.pendingOperations.delete(id);
    }
  }

  /**
   * Clear all pending operations
   */
  clearAll(): void {
    console.log('[OptimisticUpdate] 🗑️ Clearing all pending operations');
    this.pendingOperations.forEach(op => op.rollback());
    this.pendingOperations.clear();
  }

  /**
   * Helper: Optimistic array item addition
   *
   * @example
   * optimisticUpdate.addToArray(
   *   this.projects,
   *   newProject,
   *   () => projectsService.create(newProject)
   * );
   */
  addToArray<T>(
    array: T[],
    item: T,
    operation: () => Observable<T>,
    onSuccess?: (result: T) => void,
    onError?: (error: any) => void
  ): Observable<T> {
    // Add to array immediately (optimistic)
    array.push(item);

    return this.apply({
      id: `add-${Date.now()}`,
      operation,
      rollback: () => {
        // Remove from array on error
        const index = array.indexOf(item);
        if (index > -1) {
          array.splice(index, 1);
        }
      },
      onSuccess,
      onError
    });
  }

  /**
   * Helper: Optimistic array item removal
   *
   * @example
   * optimisticUpdate.removeFromArray(
   *   this.projects,
   *   project,
   *   () => projectsService.delete(project.id)
   * );
   */
  removeFromArray<T>(
    array: T[],
    item: T,
    operation: () => Observable<any>,
    onSuccess?: (result: any) => void,
    onError?: (error: any) => void
  ): Observable<any> {
    // Remove from array immediately (optimistic)
    const index = array.indexOf(item);
    if (index > -1) {
      array.splice(index, 1);
    }

    return this.apply({
      id: `remove-${Date.now()}`,
      operation,
      rollback: () => {
        // Add back to array on error (at original position if possible)
        if (index > -1) {
          array.splice(index, 0, item);
        } else {
          array.push(item);
        }
      },
      onSuccess,
      onError
    });
  }

  /**
   * Helper: Optimistic property update
   *
   * @example
   * optimisticUpdate.updateProperty(
   *   project,
   *   'status',
   *   'archived',
   *   () => projectsService.updateStatus(project.id, 'archived')
   * );
   */
  updateProperty<T, K extends keyof T>(
    object: T,
    property: K,
    newValue: T[K],
    operation: () => Observable<any>,
    onSuccess?: (result: any) => void,
    onError?: (error: any) => void
  ): Observable<any> {
    // Store old value for rollback
    const oldValue = object[property];

    // Update property immediately (optimistic)
    object[property] = newValue;

    return this.apply({
      id: `update-${String(property)}-${Date.now()}`,
      operation,
      rollback: () => {
        // Restore old value on error
        object[property] = oldValue;
      },
      onSuccess,
      onError
    });
  }

  /**
   * Helper: Optimistic object replacement in array
   *
   * @example
   * optimisticUpdate.replaceInArray(
   *   this.projects,
   *   oldProject,
   *   updatedProject,
   *   () => projectsService.update(updatedProject)
   * );
   */
  replaceInArray<T>(
    array: T[],
    oldItem: T,
    newItem: T,
    operation: () => Observable<T>,
    onSuccess?: (result: T) => void,
    onError?: (error: any) => void
  ): Observable<T> {
    // Replace in array immediately (optimistic)
    const index = array.indexOf(oldItem);
    if (index > -1) {
      array[index] = newItem;
    }

    return this.apply({
      id: `replace-${Date.now()}`,
      operation,
      rollback: () => {
        // Restore old item on error
        if (index > -1) {
          array[index] = oldItem;
        }
      },
      onSuccess,
      onError
    });
  }
}
