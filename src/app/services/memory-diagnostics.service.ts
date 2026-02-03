import { Injectable } from '@angular/core';
import { AlertController } from '@ionic/angular';

interface MemorySnapshot {
  timestamp: number;
  usedHeapMB: number;
  totalHeapMB: number;
  label: string;
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

  constructor(private alertController: AlertController) {}

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
   * Show alert comparing before/after memory snapshots
   */
  async showMemoryAlert(operationName: string, before: MemorySnapshot, after: MemorySnapshot): Promise<void> {
    const diff = after.usedHeapMB - before.usedHeapMB;
    const diffSign = diff >= 0 ? '+' : '';
    const diffColor = diff > 5 ? 'red' : diff > 1 ? 'orange' : 'green';

    const alert = await this.alertController.create({
      header: `Memory: ${operationName}`,
      message: `
        <div style="text-align: left; font-size: 14px; line-height: 1.8;">
          <p><strong>Before:</strong> ${before.usedHeapMB.toFixed(2)} MB</p>
          <p><strong>After:</strong> ${after.usedHeapMB.toFixed(2)} MB</p>
          <p style="color: ${diffColor}; font-weight: bold;">
            <strong>Change:</strong> ${diffSign}${diff.toFixed(2)} MB
          </p>
          <p><strong>Total Heap:</strong> ${after.totalHeapMB.toFixed(2)} MB</p>
        </div>
      `,
      buttons: ['OK']
    });

    await alert.present();
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
