import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { ImageCompressionService } from './image-compression.service';

export interface UploadTask {
  id: string;
  visualId: number;
  photo: File;
  key: string;
  caption: string;
  tempPhotoId: string;
  status: 'queued' | 'uploading' | 'completed' | 'failed';
  progress: number;
  error?: any;
  retryCount: number;
}

export interface UploadQueueStatus {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  activeTasks: number;
  queuedTasks: number;
}

/**
 * BackgroundPhotoUploadService
 *
 * CRITICAL SERVICE FOR PHOTO RELIABILITY
 *
 * This service ensures:
 * 1. ALL selected photos are uploaded (no partial uploads)
 * 2. Uploads persist across navigation
 * 3. Uploads happen sequentially or with limited parallelism to prevent overwhelming the system
 * 4. Failed uploads are retried automatically
 * 5. Upload state is preserved even if user navigates away
 *
 * Usage:
 * ```typescript
 * this.uploadService.addToQueue(visualId, photo, key, caption, tempId, uploadFn);
 * ```
 */
@Injectable({
  providedIn: 'root'
})
export class BackgroundPhotoUploadService {
  private uploadQueue: UploadTask[] = [];
  private activeUploads: Map<string, UploadTask> = new Map();
  private maxParallelUploads = 3; // Upload 3 photos at a time for better performance
  private isProcessing = false;

  // Observables for UI updates
  private queueStatus$ = new BehaviorSubject<UploadQueueStatus>({
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    activeTasks: 0,
    queuedTasks: 0
  });

  private taskUpdates$ = new BehaviorSubject<UploadTask | null>(null);

  constructor(private imageCompression: ImageCompressionService) {
    console.log('[UPLOAD SERVICE] BackgroundPhotoUploadService initialized');
  }

  /**
   * Add a photo upload to the queue
   * Returns the task ID for tracking
   */
  addToQueue(
    visualId: number,
    photo: File,
    key: string,
    caption: string,
    tempPhotoId: string,
    uploadFn: (visualId: number, photo: File, caption: string) => Promise<any>
  ): string {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const task: UploadTask = {
      id: taskId,
      visualId,
      photo,
      key,
      caption,
      tempPhotoId,
      status: 'queued',
      progress: 0,
      retryCount: 0
    };

    // Store the upload function in a closure
    (task as any).uploadFn = uploadFn;

    this.uploadQueue.push(task);
    this.updateQueueStatus();

    console.log(`[UPLOAD SERVICE] Added task ${taskId} to queue. Queue size: ${this.uploadQueue.length}`);

    // Start processing if not already running
    this.processQueue();

    return taskId;
  }

  /**
   * Process the upload queue
   * Uploads photos with limited parallelism
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      console.log('[UPLOAD SERVICE] Already processing queue');
      return;
    }

    this.isProcessing = true;
    console.log('[UPLOAD SERVICE] Starting queue processing');

    while (this.uploadQueue.length > 0 || this.activeUploads.size > 0) {
      // Start new uploads up to the parallel limit
      while (
        this.activeUploads.size < this.maxParallelUploads &&
        this.uploadQueue.length > 0
      ) {
        const task = this.uploadQueue.shift();
        if (task) {
          this.activeUploads.set(task.id, task);
          this.updateQueueStatus();

          // Start upload (don't await - let it run in parallel)
          this.uploadTask(task).catch(error => {
            console.error(`[UPLOAD SERVICE] Task ${task.id} failed:`, error);
          });
        }
      }

      // Wait a bit before checking again
      await this.sleep(100);
    }

    this.isProcessing = false;
    console.log('[UPLOAD SERVICE] Queue processing complete');
  }

  /**
   * Upload a single task
   */
  private async uploadTask(task: UploadTask): Promise<void> {
    const maxRetries = 3;

    task.status = 'uploading';
    task.progress = 10;
    this.taskUpdates$.next(task);
    this.updateQueueStatus();

    console.log(`[UPLOAD SERVICE] Starting upload for task ${task.id}`);

    try {
      // Compress the photo
      task.progress = 20;
      this.taskUpdates$.next(task);

      const compressedPhoto = await this.imageCompression.compressImage(task.photo, {
        maxSizeMB: 0.8,
        maxWidthOrHeight: 1280,
        useWebWorker: true
      }) as File;

      const uploadFile = compressedPhoto || task.photo;

      // Perform upload
      task.progress = 50;
      this.taskUpdates$.next(task);

      const uploadFn = (task as any).uploadFn;
      const result = await uploadFn(task.visualId, uploadFile, task.caption);

      // Upload successful
      task.status = 'completed';
      task.progress = 100;
      this.taskUpdates$.next(task);

      console.log(`[UPLOAD SERVICE] Task ${task.id} completed successfully`);

      // Store result for retrieval
      (task as any).result = result;

    } catch (error) {
      console.error(`[UPLOAD SERVICE] Task ${task.id} failed (attempt ${task.retryCount + 1}):`, error);

      task.retryCount++;

      if (task.retryCount < maxRetries) {
        // Retry
        console.log(`[UPLOAD SERVICE] Retrying task ${task.id} (${task.retryCount}/${maxRetries})`);
        task.status = 'queued';
        task.progress = 0;
        this.uploadQueue.unshift(task); // Add back to front of queue
      } else {
        // Max retries exceeded
        task.status = 'failed';
        task.error = error;
        console.error(`[UPLOAD SERVICE] Task ${task.id} failed after ${maxRetries} retries`);
      }

      this.taskUpdates$.next(task);
    } finally {
      // Remove from active uploads
      this.activeUploads.delete(task.id);
      this.updateQueueStatus();
    }
  }

  /**
   * Get observable for queue status updates
   */
  getQueueStatus(): Observable<UploadQueueStatus> {
    return this.queueStatus$.asObservable();
  }

  /**
   * Get observable for individual task updates
   */
  getTaskUpdates(): Observable<UploadTask | null> {
    return this.taskUpdates$.asObservable();
  }

  /**
   * Get current queue status
   */
  getCurrentStatus(): UploadQueueStatus {
    return this.queueStatus$.value;
  }

  /**
   * Update queue status and emit to subscribers
   */
  private updateQueueStatus(): void {
    const allTasks = [
      ...Array.from(this.activeUploads.values()),
      ...this.uploadQueue
    ];

    const status: UploadQueueStatus = {
      totalTasks: allTasks.length,
      completedTasks: allTasks.filter(t => t.status === 'completed').length,
      failedTasks: allTasks.filter(t => t.status === 'failed').length,
      activeTasks: this.activeUploads.size,
      queuedTasks: this.uploadQueue.length
    };

    this.queueStatus$.next(status);
  }

  /**
   * Clear completed and failed tasks
   */
  clearCompleted(): void {
    this.uploadQueue = this.uploadQueue.filter(
      task => task.status !== 'completed' && task.status !== 'failed'
    );
    this.updateQueueStatus();
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): UploadTask | undefined {
    return this.activeUploads.get(taskId) ||
           this.uploadQueue.find(t => t.id === taskId);
  }

  /**
   * Check if any uploads are in progress
   */
  hasActiveUploads(): boolean {
    return this.activeUploads.size > 0 || this.uploadQueue.length > 0;
  }

  /**
   * Helper sleep function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
