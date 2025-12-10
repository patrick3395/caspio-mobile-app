import { Injectable } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { IndexedDbService } from './indexed-db.service';
import { TempIdService } from './temp-id.service';
import { BackgroundSyncService } from './background-sync.service';
import { ToastController } from '@ionic/angular';

/**
 * EXAMPLE: Offline-first Visual service
 * Shows how to create Visual + upload images with dependency tracking
 * 
 * Use this pattern in your existing data services:
 * - engineers-foundation-data.service.ts
 * - lbw-data.service.ts  
 * - hud-data.service.ts
 */
@Injectable({
  providedIn: 'root'
})
export class OfflineVisualServiceExample {
  constructor(
    private indexedDb: IndexedDbService,
    private tempId: TempIdService,
    private backgroundSync: BackgroundSyncService,
    private toastController: ToastController
  ) {}

  /**
   * Create a Visual (works offline)
   * Returns temp ID immediately, syncs in background
   */
  async createVisual(visualData: any): Promise<{tempId: string, visual: any}> {
    console.log('[OfflineVisual] Creating visual offline-first');

    // 1. Generate temporary ID
    const tempId = this.tempId.generateTempId('visual');

    // 2. Create placeholder for UI
    const placeholder = {
      ...visualData,
      PK_ID: tempId,
      _tempId: tempId,
      _localOnly: true,
      _syncing: true,
    };

    // 3. Save to IndexedDB for background sync
    await this.indexedDb.addPendingRequest({
      type: 'CREATE',
      tempId: tempId,
      endpoint: '/api/visuals',
      method: 'POST',
      data: visualData,
      dependencies: [],
      status: 'pending',
      priority: 'high',
    });

    // 4. Trigger background sync
    this.backgroundSync.triggerSync();

    // 5. Show success to user
    this.showToast('Visual saved! Syncing in background...');

    // 6. Return immediately for UI update
    return { tempId, visual: placeholder };
  }

  /**
   * Upload image for a Visual (works with temp ID)
   */
  async uploadVisualImage(
    visualId: string,  // Can be temp ID or real ID
    imageFile: File,
    caption: string = ''
  ): Promise<{imageId: string}> {
    console.log('[OfflineVisual] Uploading image for visual:', visualId);

    const isTempId = this.tempId.isTempId(visualId);
    const imageId = `temp_image_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Find the visual creation request if using temp ID
    let dependencies: string[] = [];
    if (isTempId) {
      const visualRequests = await this.indexedDb.getPendingRequests();
      const visualRequest = visualRequests.find(r => r.tempId === visualId);
      if (visualRequest) {
        dependencies = [visualRequest.requestId];
      }
    }

    // Save image request to IndexedDB
    await this.indexedDb.addPendingRequest({
      type: 'UPLOAD_FILE',
      tempId: imageId,
      endpoint: isTempId ? '/api/caspio-proxy/tables/LPS_Services_Visuals_Attach/records' : `/api/visuals/${visualId}/attachments`,
      method: 'POST',
      data: {
        file: await this.fileToBase64(imageFile),  // Store as base64
        fileName: imageFile.name,
        caption: caption,
        visualId: visualId,  // Will be resolved to real ID when syncing
      },
      dependencies: dependencies,  // Wait for Visual to be created first
      status: 'pending',
      priority: 'normal',
    });

    // Trigger sync
    this.backgroundSync.triggerSync();

    this.showToast('Image queued for upload');

    return { imageId };
  }

  /**
   * Update Visual (works offline)
   */
  async updateVisual(visualId: string, updateData: any): Promise<void> {
    console.log('[OfflineVisual] Updating visual:', visualId);

    const isTempId = this.tempId.isTempId(visualId);

    await this.indexedDb.addPendingRequest({
      type: 'UPDATE',
      endpoint: isTempId ? '/api/visuals' : `/api/visuals/${visualId}`,
      method: 'PUT',
      data: { ...updateData, PK_ID: visualId },
      dependencies: [],
      status: 'pending',
      priority: 'high',
    });

    this.backgroundSync.triggerSync();
    this.showToast('Changes saved');
  }

  /**
   * Delete Visual (works offline)
   */
  async deleteVisual(visualId: string): Promise<void> {
    console.log('[OfflineVisual] Deleting visual:', visualId);

    await this.indexedDb.addPendingRequest({
      type: 'DELETE',
      endpoint: `/api/visuals/${visualId}`,
      method: 'DELETE',
      data: { visualId },
      dependencies: [],
      status: 'pending',
      priority: 'normal',
    });

    this.backgroundSync.triggerSync();
    this.showToast('Visual deleted');
  }

  /**
   * Convert File to base64 for storage
   */
  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Show toast message
   */
  private async showToast(message: string): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'bottom',
    });
    toast.present();
  }
}

/**
 * HOW TO USE IN YOUR EXISTING CODE:
 * 
 * // In visual-category.page.ts (or similar)
 * 
 * async createVisualWithPhotos() {
 *   // 1. Create visual (works offline)
 *   const { tempId, visual } = await this.offlineVisual.createVisual({
 *     ServiceID: this.serviceId,
 *     Name: 'Living Room',
 *     CategoryID: 1
 *   });
 * 
 *   // 2. Update UI immediately
 *   this.visuals.push(visual);  // User sees it right away
 * 
 *   // 3. Upload photos (uses temp ID)
 *   await this.offlineVisual.uploadVisualImage(tempId, this.photo1, 'Water damage');
 *   await this.offlineVisual.uploadVisualImage(tempId, this.photo2, 'Ceiling');
 *   await this.offlineVisual.uploadVisualImage(tempId, this.photo3, 'Wall');
 * 
 *   // 4. Background sync handles everything
 *   // When online:
 *   // - Creates Visual on server → gets PK_ID
 *   // - Uploads photo1 with real VisualID
 *   // - Uploads photo2 with real VisualID
 *   // - Uploads photo3 with real VisualID
 * 
 *   // 5. User never waits, never loses data!
 * }
 * 
 * // Monitor sync status
 * this.backgroundSync.syncStatus$.subscribe(status => {
 *   console.log(`Pending: ${status.pendingCount}, Synced: ${status.syncedCount}`);
 *   if (status.isSyncing) {
 *     this.showSyncIndicator(status.currentlySyncing);
 *   }
 * });
 */

