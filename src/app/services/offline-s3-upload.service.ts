import { Injectable } from '@angular/core';
import { IndexedDbService } from './indexed-db.service';
import { TempIdService } from './temp-id.service';
import { BackgroundSyncService } from './background-sync.service';

/**
 * Offline-first S3 Upload Service
 * Wraps the existing S3 upload to add offline queuing
 * Preserves the exact 3-step process when online
 */
@Injectable({
  providedIn: 'root'
})
export class OfflineS3UploadService {
  constructor(
    private indexedDb: IndexedDbService,
    private tempId: TempIdService,
    private backgroundSync: BackgroundSyncService
  ) {}

  /**
   * Queue Visual photo upload (3-step S3 process)
   * Works offline - stores file locally and replays when online
   */
  async queueVisualPhotoUpload(
    visualId: number | string,
    file: File,
    drawingsData: string = '',
    caption: string = ''
  ): Promise<{tempAttachId: string, thumbnailUrl: string}> {
    console.log('[OfflineS3] Queuing visual photo upload');

    // Generate temp ID for this attachment
    const tempAttachId = this.tempId.generateTempId('image' as any);
    
    // Create object URL for immediate thumbnail display
    const thumbnailUrl = URL.createObjectURL(file);

    // Convert file to base64 for storage
    const fileBase64 = await this.fileToBase64(file);

    // Store file separately in IndexedDB (for large files)
    await this.storeFileBlob(tempAttachId, file, thumbnailUrl);

    // Check if Visual ID is temporary (Visual not created yet)
    const visualIdStr = String(visualId);
    const isVisualTemp = this.tempId.isTempId(visualIdStr);
    
    let dependencies: string[] = [];
    if (isVisualTemp) {
      // Find the Visual creation request
      const pending = await this.indexedDb.getPendingRequests();
      const visualRequest = pending.find(r => r.tempId === visualIdStr);
      if (visualRequest) {
        dependencies.push(visualRequest.requestId);
      }
    }

    // Create 3 linked requests (same as working S3 upload)
    
    // Request 1: Create Caspio Attachment Record
    const req1Id = await this.indexedDb.addPendingRequest({
      type: 'CREATE',
      tempId: tempAttachId,
      endpoint: '/api/caspio-proxy/tables/LPS_Services_Visuals_Attach/records?response=rows',
      method: 'POST',
      data: {
        VisualID: visualId,  // Will be resolved if temp
        Annotation: caption || '',
        Drawings: drawingsData.length <= 64000 ? drawingsData : '',
      },
      dependencies: dependencies,  // Wait for Visual if temp
      status: 'pending',
      priority: 'high',
    });

    // Request 2: Upload to S3 (depends on Request 1)
    const req2Id = await this.indexedDb.addPendingRequest({
      type: 'UPLOAD_FILE',
      endpoint: '/api/s3/upload',
      method: 'POST',
      data: {
        file: fileBase64,
        fileName: file.name,
        tableName: 'LPS_Services_Visuals_Attach',
        attachId: `{{${req1Id}.AttachID}}`,  // Placeholder - will be resolved from req1 result
        visualId: visualId,
      },
      dependencies: [req1Id],  // Wait for record creation
      status: 'pending',
      priority: 'high',
    });

    // Request 3: Update Caspio with S3 Key (depends on Request 2)
    await this.indexedDb.addPendingRequest({
      type: 'UPDATE',
      endpoint: '/api/caspio-proxy/tables/LPS_Services_Visuals_Attach/records',
      method: 'PUT',
      data: {
        attachId: `{{${req1Id}.AttachID}}`,  // From req1
        s3Key: `{{${req2Id}.s3Key}}`,  // From req2
      },
      dependencies: [req1Id, req2Id],  // Wait for both
      status: 'pending',
      priority: 'normal',
    });

    // Trigger background sync
    this.backgroundSync.triggerSync();

    console.log('[OfflineS3] Photo queued with 3-step process');

    // Return temp data for immediate UI display
    return {
      tempAttachId,
      thumbnailUrl,  // Display this while uploading
    };
  }

  /**
   * Store file blob in IndexedDB for offline access
   */
  private async storeFileBlob(tempId: string, file: File, thumbnailUrl: string): Promise<void> {
    const db = await (this.indexedDb as any).ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingImages'], 'readwrite');
      const store = transaction.objectStore('pendingImages');

      const imageData = {
        imageId: tempId,
        requestId: tempId,
        file: file,  // Store actual File object
        thumbnailUrl: thumbnailUrl,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        status: 'pending',
        createdAt: Date.now(),
      };

      const addRequest = store.add(imageData);

      addRequest.onsuccess = () => resolve();
      addRequest.onerror = () => reject(addRequest.error);
    });
  }

  /**
   * Get thumbnail for pending image
   */
  async getPendingImageThumbnail(tempAttachId: string): Promise<string | null> {
    const db = await (this.indexedDb as any).ensureDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['pendingImages'], 'readonly');
      const store = transaction.objectStore('pendingImages');
      const getRequest = store.get(tempAttachId);

      getRequest.onsuccess = () => {
        const imageData = getRequest.result;
        if (imageData && imageData.file) {
          // Create object URL from stored file
          const url = URL.createObjectURL(imageData.file);
          resolve(url);
        } else {
          resolve(null);
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Convert File to base64
   */
  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
}

