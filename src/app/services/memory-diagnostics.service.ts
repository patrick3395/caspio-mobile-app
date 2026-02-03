import { Injectable } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { db } from './caspio-db';

interface MemorySnapshot {
  timestamp: number;
  usedHeapMB: number;
  totalHeapMB: number;
  label: string;
}

interface StorageStats {
  localImagesCount: number;
  localImagesMB: number;
  localBlobsCount: number;
  localBlobsMB: number;
  cachedPhotosCount: number;
  cachedPhotosMB: number;
  uploadOutboxCount: number;
  totalMB: number;
}

/**
 * Memory Diagnostics Service
 * Tracks memory usage before/after operations to detect memory leaks
 *
 * Usage:
 *   await memoryDiagnostics.trackOperation('Image Upload', async () => {
 *     // do the upload
 *   });
 */
@Injectable({
  providedIn: 'root'
})
export class MemoryDiagnosticsService {
  private snapshots: MemorySnapshot[] = [];
  private enabled = true; // Toggle to enable/disable alerts
  private operationCounter = 0; // Track operation count when memory API unavailable

  constructor(private alertController: AlertController) {
    console.log('[MemoryDiagnostics] Service initialized');
  }

  /**
   * Get current memory usage in MB
   * Works in Chrome/Chromium-based browsers (including Capacitor apps)
   */
  getMemoryUsage(): { usedHeapMB: number; totalHeapMB: number; limitMB: number } | null {
    const perf = (performance as any);
    if (perf && perf.memory) {
      return {
        usedHeapMB: perf.memory.usedJSHeapSize / (1024 * 1024),
        totalHeapMB: perf.memory.totalJSHeapSize / (1024 * 1024),
        limitMB: perf.memory.jsHeapSizeLimit / (1024 * 1024)
      };
    }
    return null;
  }

  /**
   * Take a memory snapshot with a label
   */
  takeSnapshot(label: string): MemorySnapshot | null {
    const memory = this.getMemoryUsage();
    if (!memory) {
      console.warn('[MemoryDiagnostics] performance.memory not available');
      return null;
    }

    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      usedHeapMB: memory.usedHeapMB,
      totalHeapMB: memory.totalHeapMB,
      label
    };

    this.snapshots.push(snapshot);
    console.log(`[MemoryDiagnostics] ${label}: ${memory.usedHeapMB.toFixed(2)} MB used`);
    return snapshot;
  }

  /**
   * Track memory before and after an async operation
   * Shows alert with before/after comparison
   */
  async trackOperation<T>(operationName: string, operation: () => Promise<T>): Promise<T> {
    const beforeSnapshot = this.takeSnapshot(`Before ${operationName}`);

    const result = await operation();

    const afterSnapshot = this.takeSnapshot(`After ${operationName}`);

    if (this.enabled && beforeSnapshot && afterSnapshot) {
      await this.showMemoryAlert(operationName, beforeSnapshot, afterSnapshot);
    }

    return result;
  }

  /**
   * Show alert comparing before/after storage stats
   * Uses IndexedDB stats which work on mobile
   */
  async showStorageComparisonAlert(
    operationName: string,
    beforeStats: StorageStats,
    afterStats: StorageStats,
    details: string = ''
  ): Promise<void> {
    if (!this.enabled) return;

    const blobDiff = afterStats.localBlobsMB - beforeStats.localBlobsMB;
    const cachedDiff = afterStats.cachedPhotosMB - beforeStats.cachedPhotosMB;
    const totalDiff = afterStats.totalMB - beforeStats.totalMB;

    const formatDiff = (diff: number) => {
      const sign = diff >= 0 ? '+' : '';
      const color = diff > 2 ? 'red' : diff > 0.5 ? 'orange' : 'green';
      return `<span style="color: ${color};">${sign}${diff.toFixed(2)} MB</span>`;
    };

    try {
      const alert = await this.alertController.create({
        header: operationName,
        message: `
          <div style="text-align: left; font-size: 13px; line-height: 1.5;">
            ${details ? `<p><strong>${details}</strong></p>` : ''}
            <table style="width: 100%; font-size: 12px;">
              <tr><th></th><th>Before</th><th>After</th><th>Diff</th></tr>
              <tr>
                <td>Blobs</td>
                <td>${beforeStats.localBlobsMB.toFixed(1)}</td>
                <td>${afterStats.localBlobsMB.toFixed(1)}</td>
                <td>${formatDiff(blobDiff)}</td>
              </tr>
              <tr>
                <td>Cached</td>
                <td>${beforeStats.cachedPhotosMB.toFixed(1)}</td>
                <td>${afterStats.cachedPhotosMB.toFixed(1)}</td>
                <td>${formatDiff(cachedDiff)}</td>
              </tr>
              <tr style="font-weight: bold;">
                <td>Total</td>
                <td>${beforeStats.totalMB.toFixed(1)} MB</td>
                <td>${afterStats.totalMB.toFixed(1)} MB</td>
                <td>${formatDiff(totalDiff)}</td>
              </tr>
            </table>
          </div>
        `,
        buttons: ['OK']
      });

      await alert.present();
    } catch (err) {
      console.error('[MemoryDiagnostics] Failed to show comparison alert:', err);
    }
  }

  /**
   * Show alert comparing before/after memory snapshots
   * Falls back to storage stats on mobile
   */
  async showMemoryAlert(operationName: string, before: MemorySnapshot | null, after: MemorySnapshot | null): Promise<void> {
    if (!this.enabled) return;

    console.log('[MemoryDiagnostics] Showing memory alert for:', operationName);

    // Always show storage stats since memory API doesn't work on mobile
    const stats = await this.getStorageStats();

    try {
      const alert = await this.alertController.create({
        header: `${operationName}`,
        message: `
          <div style="text-align: left; font-size: 13px; line-height: 1.6;">
            <p style="margin: 4px 0;"><strong>IndexedDB Storage:</strong></p>
            <p style="margin: 2px 0;">• Local Blobs: ${stats.localBlobsCount} (${stats.localBlobsMB.toFixed(2)} MB)</p>
            <p style="margin: 2px 0;">• Cached Photos: ${stats.cachedPhotosCount} (${stats.cachedPhotosMB.toFixed(2)} MB)</p>
            <p style="margin: 2px 0;">• Upload Queue: ${stats.uploadOutboxCount}</p>
            <p style="margin: 4px 0; font-weight: bold;">Total: ${stats.totalMB.toFixed(2)} MB</p>
          </div>
        `,
        buttons: ['OK']
      });

      await alert.present();
      console.log('[MemoryDiagnostics] Alert presented successfully');
    } catch (err) {
      console.error('[MemoryDiagnostics] Failed to show alert:', err);
    }
  }

  /**
   * Get IndexedDB storage statistics
   * This works on mobile and gives real insight into storage usage
   */
  async getStorageStats(): Promise<StorageStats> {
    try {
      // Get counts
      const localImagesCount = await db.localImages.count();
      const localBlobsCount = await db.localBlobs.count();
      const cachedPhotosCount = await db.cachedPhotos.count();
      const uploadOutboxCount = await db.uploadOutbox.count();

      // Calculate sizes by sampling data
      let localBlobsMB = 0;
      let cachedPhotosMB = 0;
      let localImagesMB = 0;

      // Get blob sizes (this is where most storage is)
      const blobs = await db.localBlobs.toArray();
      for (const blob of blobs) {
        if (blob.data) {
          localBlobsMB += blob.data.byteLength / (1024 * 1024);
        }
      }

      // Get cached photos sizes
      const cachedPhotos = await db.cachedPhotos.toArray();
      for (const photo of cachedPhotos) {
        if (photo.imageData) {
          // Base64 string length * 0.75 gives approximate binary size
          cachedPhotosMB += (photo.imageData.length * 0.75) / (1024 * 1024);
        }
      }

      // LocalImages table is mostly metadata, estimate small size
      localImagesMB = localImagesCount * 0.001; // ~1KB per record estimate

      const totalMB = localBlobsMB + cachedPhotosMB + localImagesMB;

      return {
        localImagesCount,
        localImagesMB,
        localBlobsCount,
        localBlobsMB,
        cachedPhotosCount,
        cachedPhotosMB,
        uploadOutboxCount,
        totalMB
      };
    } catch (err) {
      console.error('[MemoryDiagnostics] Failed to get storage stats:', err);
      return {
        localImagesCount: 0,
        localImagesMB: 0,
        localBlobsCount: 0,
        localBlobsMB: 0,
        cachedPhotosCount: 0,
        cachedPhotosMB: 0,
        uploadOutboxCount: 0,
        totalMB: 0
      };
    }
  }

  /**
   * Simple alert to confirm an operation happened (for debugging)
   * Shows IndexedDB storage stats which work on mobile
   */
  async showOperationAlert(operationName: string, details: string = ''): Promise<void> {
    if (!this.enabled) return;

    this.operationCounter++;
    console.log(`[MemoryDiagnostics] Operation #${this.operationCounter}: ${operationName}`);

    // Get IndexedDB storage stats (works on mobile!)
    const stats = await this.getStorageStats();

    try {
      const alert = await this.alertController.create({
        header: `${operationName}`,
        message: `
          <div style="text-align: left; font-size: 13px; line-height: 1.6;">
            ${details ? `<p><strong>Details:</strong> ${details}</p>` : ''}
            <hr style="margin: 8px 0; border: none; border-top: 1px solid #ddd;">
            <p style="margin: 4px 0;"><strong>IndexedDB Storage:</strong></p>
            <p style="margin: 2px 0;">• Local Blobs: ${stats.localBlobsCount} (${stats.localBlobsMB.toFixed(2)} MB)</p>
            <p style="margin: 2px 0;">• Cached Photos: ${stats.cachedPhotosCount} (${stats.cachedPhotosMB.toFixed(2)} MB)</p>
            <p style="margin: 2px 0;">• Local Images: ${stats.localImagesCount}</p>
            <p style="margin: 2px 0;">• Upload Queue: ${stats.uploadOutboxCount}</p>
            <p style="margin: 4px 0; font-weight: bold;">Total: ${stats.totalMB.toFixed(2)} MB</p>
          </div>
        `,
        buttons: ['OK']
      });

      await alert.present();
    } catch (err) {
      console.error('[MemoryDiagnostics] Failed to show operation alert:', err);
    }
  }

  /**
   * Show a simple memory status alert
   */
  async showCurrentMemory(label: string = 'Current Memory'): Promise<void> {
    const memory = this.getMemoryUsage();
    if (!memory) {
      const alert = await this.alertController.create({
        header: 'Memory Info',
        message: 'Memory API not available on this device',
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    const usedPercent = (memory.usedHeapMB / memory.limitMB * 100).toFixed(1);

    const alert = await this.alertController.create({
      header: label,
      message: `
        <div style="text-align: left; font-size: 14px; line-height: 1.8;">
          <p><strong>Used Heap:</strong> ${memory.usedHeapMB.toFixed(2)} MB</p>
          <p><strong>Total Heap:</strong> ${memory.totalHeapMB.toFixed(2)} MB</p>
          <p><strong>Heap Limit:</strong> ${memory.limitMB.toFixed(0)} MB</p>
          <p><strong>Usage:</strong> ${usedPercent}%</p>
        </div>
      `,
      buttons: ['OK']
    });

    await alert.present();
  }

  /**
   * Enable or disable memory alerts
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    console.log(`[MemoryDiagnostics] Alerts ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get all snapshots for analysis
   */
  getSnapshots(): MemorySnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Clear snapshot history
   */
  clearSnapshots(): void {
    this.snapshots = [];
  }
}
