import { Injectable } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { db } from './caspio-db';
import { environment } from '../../environments/environment';
import { ServiceMetadataService } from './service-metadata.service';

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
  // Extended stats (optional)
  pendingImagesCount?: number;
  pendingImagesMB?: number;
  cachedServiceDataCount?: number;
  cachedServiceDataMB?: number;
  cachedTemplatesCount?: number;
  cachedTemplatesMB?: number;
  fieldTablesCount?: number;
  fieldTablesMB?: number;
  orphanedBlobsCount?: number;
  orphanedBlobsMB?: number;
}

// Storage thresholds for mobile devices
const STORAGE_WARNING_MB = 1000;  // Show warning at 1 GB
const STORAGE_CRITICAL_MB = 2000; // Critical warning at 2 GB

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

  constructor(
    private alertController: AlertController,
    private serviceMetadata: ServiceMetadataService
  ) {
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
   * Get DETAILED storage statistics including ALL tables
   * Use this to diagnose storage bloat
   */
  async getDetailedStorageStats(): Promise<StorageStats> {
    const basicStats = await this.getStorageStats();

    try {
      // Pending images (has ArrayBuffer data)
      const pendingImages = await db.pendingImages.toArray();
      let pendingImagesMB = 0;
      for (const img of pendingImages) {
        if (img.fileData) {
          pendingImagesMB += img.fileData.byteLength / (1024 * 1024);
        }
      }

      // Cached service data (JSON responses)
      const cachedServiceData = await db.cachedServiceData.toArray();
      let cachedServiceDataMB = 0;
      for (const item of cachedServiceData) {
        cachedServiceDataMB += JSON.stringify(item).length / (1024 * 1024);
      }

      // Cached templates
      const cachedTemplates = await db.cachedTemplates.toArray();
      let cachedTemplatesMB = 0;
      for (const item of cachedTemplates) {
        cachedTemplatesMB += JSON.stringify(item).length / (1024 * 1024);
      }

      // Field tables
      let fieldTablesCount = 0;
      let fieldTablesMB = 0;

      const visualFields = await db.visualFields.toArray();
      fieldTablesCount += visualFields.length;
      fieldTablesMB += JSON.stringify(visualFields).length / (1024 * 1024);

      const efeFields = await db.efeFields.toArray();
      fieldTablesCount += efeFields.length;
      fieldTablesMB += JSON.stringify(efeFields).length / (1024 * 1024);

      const hudFields = await db.hudFields.toArray();
      fieldTablesCount += hudFields.length;
      fieldTablesMB += JSON.stringify(hudFields).length / (1024 * 1024);

      const lbwFields = await db.lbwFields.toArray();
      fieldTablesCount += lbwFields.length;
      fieldTablesMB += JSON.stringify(lbwFields).length / (1024 * 1024);

      const dteFields = await db.dteFields.toArray();
      fieldTablesCount += dteFields.length;
      fieldTablesMB += JSON.stringify(dteFields).length / (1024 * 1024);

      // Find orphaned blobs (blobs not referenced by any LocalImage)
      const allLocalImages = await db.localImages.toArray();
      const referencedBlobIds = new Set<string>();
      for (const img of allLocalImages) {
        if (img.localBlobId) referencedBlobIds.add(img.localBlobId);
        if (img.thumbBlobId) referencedBlobIds.add(img.thumbBlobId);
      }

      const allBlobs = await db.localBlobs.toArray();
      let orphanedBlobsCount = 0;
      let orphanedBlobsMB = 0;
      for (const blob of allBlobs) {
        if (!referencedBlobIds.has(blob.blobId)) {
          orphanedBlobsCount++;
          if (blob.data) {
            orphanedBlobsMB += blob.data.byteLength / (1024 * 1024);
          }
        }
      }

      const extendedTotalMB = basicStats.totalMB + pendingImagesMB + cachedServiceDataMB +
                              cachedTemplatesMB + fieldTablesMB;

      return {
        ...basicStats,
        totalMB: extendedTotalMB,
        pendingImagesCount: pendingImages.length,
        pendingImagesMB,
        cachedServiceDataCount: cachedServiceData.length,
        cachedServiceDataMB,
        cachedTemplatesCount: cachedTemplates.length,
        cachedTemplatesMB,
        fieldTablesCount,
        fieldTablesMB,
        orphanedBlobsCount,
        orphanedBlobsMB
      };
    } catch (err) {
      console.error('[MemoryDiagnostics] Failed to get detailed stats:', err);
      return basicStats;
    }
  }

  /**
   * Show detailed storage breakdown alert
   */
  async showDetailedStorageAlert(): Promise<void> {
    const stats = await this.getDetailedStorageStats();

    const alert = await this.alertController.create({
      header: '📊 Detailed Storage',
      message: `
        <div style="text-align: left; font-size: 13px; line-height: 1.6;">
          <p><strong>Total: ${stats.totalMB.toFixed(1)} MB</strong></p>
          <hr style="margin: 8px 0;">
          <p>• Local Blobs: ${stats.localBlobsCount} (${stats.localBlobsMB.toFixed(1)} MB)</p>
          <p>• Cached Photos: ${stats.cachedPhotosCount} (${stats.cachedPhotosMB.toFixed(1)} MB)</p>
          <p>• Local Images: ${stats.localImagesCount} records</p>
          <p>• Upload Queue: ${stats.uploadOutboxCount}</p>
          ${stats.pendingImagesCount !== undefined ? `<p>• Pending Images: ${stats.pendingImagesCount} (${stats.pendingImagesMB?.toFixed(1)} MB)</p>` : ''}
          ${stats.cachedServiceDataCount !== undefined ? `<p>• Cached API Data: ${stats.cachedServiceDataCount} (${stats.cachedServiceDataMB?.toFixed(1)} MB)</p>` : ''}
          ${stats.cachedTemplatesCount !== undefined ? `<p>• Cached Templates: ${stats.cachedTemplatesCount} (${stats.cachedTemplatesMB?.toFixed(1)} MB)</p>` : ''}
          ${stats.fieldTablesCount !== undefined ? `<p>• Field Records: ${stats.fieldTablesCount} (${stats.fieldTablesMB?.toFixed(1)} MB)</p>` : ''}
          ${stats.orphanedBlobsCount !== undefined && stats.orphanedBlobsCount > 0 ? `<p style="color: #dc3545;">• ⚠️ Orphaned Blobs: ${stats.orphanedBlobsCount} (${stats.orphanedBlobsMB?.toFixed(1)} MB)</p>` : ''}
          <hr style="margin: 8px 0;">
          <p style="color: #666; font-size: 11px;">Note: iOS may show higher storage in Settings due to WebKit caching.</p>
        </div>
      `,
      buttons: [
        {
          text: 'Clear Orphans',
          handler: () => {
            this.clearOrphanedBlobs();
          }
        },
        {
          text: 'Clear ALL',
          cssClass: 'danger',
          handler: () => {
            this.showAggressiveClearConfirmation();
          }
        },
        { text: 'OK' }
      ]
    });
    await alert.present();
  }

  /**
   * Clear orphaned blobs (blobs not referenced by any LocalImage)
   */
  async clearOrphanedBlobs(): Promise<number> {
    const allLocalImages = await db.localImages.toArray();
    const referencedBlobIds = new Set<string>();
    for (const img of allLocalImages) {
      if (img.localBlobId) referencedBlobIds.add(img.localBlobId);
      if (img.thumbBlobId) referencedBlobIds.add(img.thumbBlobId);
    }

    const allBlobs = await db.localBlobs.toArray();
    let clearedCount = 0;
    let clearedMB = 0;

    for (const blob of allBlobs) {
      if (!referencedBlobIds.has(blob.blobId)) {
        if (blob.data) {
          clearedMB += blob.data.byteLength / (1024 * 1024);
        }
        await db.localBlobs.delete(blob.blobId);
        clearedCount++;
      }
    }

    console.log(`[MemoryDiagnostics] Cleared ${clearedCount} orphaned blobs (${clearedMB.toFixed(1)} MB)`);

    if (clearedCount > 0) {
      const alert = await this.alertController.create({
        header: '✅ Orphans Cleared',
        message: `Removed ${clearedCount} orphaned blob(s) (${clearedMB.toFixed(1)} MB)`,
        buttons: ['OK']
      });
      await alert.present();
    }

    return clearedCount;
  }

  /**
   * Show confirmation for aggressive clear
   */
  private async showAggressiveClearConfirmation(): Promise<void> {
    const alert = await this.alertController.create({
      header: '⚠️ Clear ALL Data?',
      message: `
        <div style="text-align: left; font-size: 14px;">
          <p>This will delete <strong>ALL</strong> local data including:</p>
          <ul style="margin: 8px 0; padding-left: 20px;">
            <li>All cached photos and blobs</li>
            <li>All pending uploads</li>
            <li>All cached API data</li>
            <li>All field data</li>
          </ul>
          <p style="color: #dc3545;"><strong>Data not yet synced to server will be LOST.</strong></p>
          <p style="margin-top: 8px;">You may need to restart the app for iOS to reclaim space.</p>
        </div>
      `,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Clear Everything',
          cssClass: 'danger',
          handler: () => {
            this.clearAllDataAggressive();
          }
        }
      ]
    });
    await alert.present();
  }

  /**
   * AGGRESSIVE clear - removes ALL IndexedDB data
   * Use when normal clear isn't freeing space
   */
  async clearAllDataAggressive(): Promise<void> {
    console.log('[MemoryDiagnostics] Starting AGGRESSIVE clear...');

    const beforeStats = await this.getDetailedStorageStats();

    try {
      // Clear ALL tables
      await db.localBlobs.clear();
      await db.localImages.clear();
      await db.uploadOutbox.clear();
      await db.cachedPhotos.clear();
      await db.cachedServiceData.clear();
      await db.cachedTemplates.clear();
      await db.pendingImages.clear();
      await db.pendingRequests.clear();
      await db.pendingCaptions.clear();
      await db.pendingEFEData.clear();
      await db.tempIdMappings.clear();
      await db.operationsQueue.clear();
      await db.visualFields.clear();
      await db.efeFields.clear();
      await db.hudFields.clear();
      await db.lbwFields.clear();
      await db.dteFields.clear();

      // Mark all services as PURGED
      const services = await db.serviceMetadata.toArray();
      for (const svc of services) {
        await this.serviceMetadata.setPurgeState(svc.serviceId, 'PURGED');
      }

      const afterStats = await this.getDetailedStorageStats();
      const freedMB = beforeStats.totalMB - afterStats.totalMB;

      console.log(`[MemoryDiagnostics] AGGRESSIVE clear complete. Freed ${freedMB.toFixed(1)} MB`);

      const alert = await this.alertController.create({
        header: '✅ All Data Cleared',
        message: `
          <div style="text-align: left;">
            <p>Freed <strong>${freedMB.toFixed(1)} MB</strong> from IndexedDB.</p>
            <p style="margin-top: 8px;">Current usage: <strong>${afterStats.totalMB.toFixed(1)} MB</strong></p>
            <p style="margin-top: 12px; color: #666; font-size: 13px;">
              <strong>Important:</strong> iOS may still show high storage in Settings.
              Try closing and reopening the app, or delete and reinstall to fully reclaim space.
            </p>
          </div>
        `,
        buttons: ['OK']
      });
      await alert.present();
    } catch (err) {
      console.error('[MemoryDiagnostics] Aggressive clear failed:', err);
      const errorAlert = await this.alertController.create({
        header: 'Clear Failed',
        message: 'Unable to clear all data. Try restarting the app.',
        buttons: ['OK']
      });
      await errorAlert.present();
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

  // ============================================================================
  // CRITICAL STORAGE WARNING (App Startup Check)
  // ============================================================================

  /**
   * Check storage on app startup and show warning if critical
   * Called from app.component.ts initializeApp()
   *
   * @returns true if storage is OK, false if critical warning was shown
   */
  async checkCriticalStorage(): Promise<boolean> {
    // Only check on mobile - webapp doesn't use local storage heavily
    if (environment.isWeb) {
      return true;
    }

    try {
      const stats = await this.getStorageStats();
      console.log(`[MemoryDiagnostics] Startup storage check: ${stats.totalMB.toFixed(1)} MB`);

      if (stats.totalMB >= STORAGE_CRITICAL_MB) {
        console.warn(`[MemoryDiagnostics] CRITICAL: Storage at ${stats.totalMB.toFixed(1)} MB (threshold: ${STORAGE_CRITICAL_MB} MB)`);
        await this.showStorageWarningAlert(stats, 'critical');
        return false;
      } else if (stats.totalMB >= STORAGE_WARNING_MB) {
        console.warn(`[MemoryDiagnostics] WARNING: Storage at ${stats.totalMB.toFixed(1)} MB (threshold: ${STORAGE_WARNING_MB} MB)`);
        await this.showStorageWarningAlert(stats, 'warning');
        return false;
      }

      return true;
    } catch (err) {
      console.error('[MemoryDiagnostics] Failed to check storage on startup:', err);
      return true; // Don't block app startup on error
    }
  }

  /**
   * Show storage warning alert with option to clear synced data
   */
  private async showStorageWarningAlert(
    stats: StorageStats,
    level: 'warning' | 'critical'
  ): Promise<void> {
    const isCritical = level === 'critical';
    const threshold = isCritical ? STORAGE_CRITICAL_MB : STORAGE_WARNING_MB;

    const header = isCritical ? '⚠️ Storage Critical' : '📦 Storage Warning';
    const color = isCritical ? 'danger' : 'warning';

    const message = `
      <div style="text-align: left; font-size: 14px; line-height: 1.6;">
        <p style="margin: 0 0 12px 0;">
          Local storage is at <strong>${stats.totalMB.toFixed(1)} MB</strong>
          ${isCritical ? '— this may cause app issues.' : '— consider clearing synced photos.'}
        </p>
        <div style="background: #f5f5f5; padding: 10px; border-radius: 8px; font-size: 13px;">
          <p style="margin: 2px 0;">• Local Blobs: ${stats.localBlobsCount} (${stats.localBlobsMB.toFixed(1)} MB)</p>
          <p style="margin: 2px 0;">• Cached Photos: ${stats.cachedPhotosCount} (${stats.cachedPhotosMB.toFixed(1)} MB)</p>
          <p style="margin: 2px 0;">• Pending Uploads: ${stats.uploadOutboxCount}</p>
        </div>
        <p style="margin: 12px 0 0 0; font-size: 13px; color: #666;">
          Clearing removes synced photos from local storage. They remain on the server.
        </p>
      </div>
    `;

    const alert = await this.alertController.create({
      header,
      message,
      backdropDismiss: !isCritical, // Critical requires action
      buttons: [
        {
          text: 'Details',
          cssClass: 'secondary',
          handler: () => {
            this.showDetailedStorageAlert();
            return false; // Keep alert open
          }
        },
        {
          text: 'Later',
          role: 'cancel',
          cssClass: 'secondary'
        },
        {
          text: 'Clear Synced Data',
          cssClass: color,
          handler: async () => {
            await this.clearAllSyncedData();
            return true;
          }
        }
      ]
    });

    await alert.present();
  }

  /**
   * Clear all synced/verified data to free up storage
   * Only clears data that has been successfully synced to the server
   *
   * IMPORTANT: Marks affected services as PURGED so they will rehydrate
   * when the user reopens them. This ensures data is restored from the server.
   */
  async clearAllSyncedData(): Promise<{ clearedMB: number; clearedCount: number; servicesMarked: number }> {
    console.log('[MemoryDiagnostics] Starting clearAllSyncedData...');

    const beforeStats = await this.getStorageStats();
    let clearedCount = 0;
    let servicesMarked = 0;

    try {
      // 1. Delete all verified local blobs (full-res images that are synced)
      const allImages = await db.localImages.toArray();
      const verifiedImages = allImages.filter(img => img.status === 'verified');

      // Collect unique serviceIds from cleared images for marking as PURGED
      const affectedServiceIds = new Set<string>();

      for (const image of verifiedImages) {
        try {
          // Delete full-res blob
          if (image.localBlobId) {
            await db.localBlobs.delete(image.localBlobId);
          }
          // Delete thumbnail blob
          if (image.thumbBlobId) {
            await db.localBlobs.delete(image.thumbBlobId);
          }
          // Update LocalImage record to clear blob references
          await db.localImages.update(image.imageId, {
            localBlobId: null,
            thumbBlobId: null
          });
          clearedCount++;

          // Track affected service
          if (image.serviceId) {
            affectedServiceIds.add(image.serviceId);
          }
        } catch (err) {
          console.warn('[MemoryDiagnostics] Failed to clear image:', image.imageId, err);
        }
      }

      // 2. Clear all cached photos (server-side photo cache)
      const cachedPhotosCount = await db.cachedPhotos.count();
      await db.cachedPhotos.clear();
      clearedCount += cachedPhotosCount;

      // 3. Clear old synced requests (already completed)
      const syncedRequests = await db.pendingRequests
        .filter(r => r.status === 'synced')
        .toArray();
      for (const req of syncedRequests) {
        await db.pendingRequests.delete(req.requestId);
      }

      // 4. CRITICAL: Mark affected services as PURGED so they will rehydrate
      // This ensures data is restored from the server when the user reopens the service
      console.log(`[MemoryDiagnostics] Marking ${affectedServiceIds.size} services for rehydration...`);
      for (const serviceId of affectedServiceIds) {
        try {
          await this.serviceMetadata.setPurgeState(serviceId, 'PURGED');
          servicesMarked++;
          console.log(`[MemoryDiagnostics] Marked service ${serviceId} as PURGED`);
        } catch (err) {
          console.warn(`[MemoryDiagnostics] Failed to mark service ${serviceId} as PURGED:`, err);
        }
      }

      const afterStats = await this.getStorageStats();
      const clearedMB = beforeStats.totalMB - afterStats.totalMB;

      console.log(`[MemoryDiagnostics] ✅ Cleared ${clearedCount} items, freed ${clearedMB.toFixed(1)} MB, marked ${servicesMarked} services for rehydration`);

      // Show confirmation
      const confirmAlert = await this.alertController.create({
        header: '✅ Storage Cleared',
        message: `
          <div style="text-align: left; font-size: 14px;">
            <p>Freed <strong>${clearedMB.toFixed(1)} MB</strong> of storage.</p>
            <p style="margin-top: 8px;">Current usage: <strong>${afterStats.totalMB.toFixed(1)} MB</strong></p>
            ${servicesMarked > 0 ? `<p style="margin-top: 8px; color: #666;">${servicesMarked} service(s) will restore data from server when opened.</p>` : ''}
          </div>
        `,
        buttons: ['OK']
      });
      await confirmAlert.present();

      return { clearedMB, clearedCount, servicesMarked };
    } catch (err) {
      console.error('[MemoryDiagnostics] clearAllSyncedData failed:', err);

      const errorAlert = await this.alertController.create({
        header: 'Clear Failed',
        message: 'Unable to clear storage. Please try again.',
        buttons: ['OK']
      });
      await errorAlert.present();

      return { clearedMB: 0, clearedCount: 0, servicesMarked: 0 };
    }
  }
}
