import { Injectable } from '@angular/core';
import { IndexedDbService } from './indexed-db.service';
import { BackgroundSyncService } from './background-sync.service';

/**
 * Service to restore pending offline items on app start
 * Makes items persist across page reloads
 */
@Injectable({
  providedIn: 'root'
})
export class OfflineRestoreService {
  constructor(
    private indexedDb: IndexedDbService,
    private backgroundSync: BackgroundSyncService
  ) {}

  /**
   * Restore pending Visuals for a service
   * Call this in component ngOnInit
   */
  async restorePendingVisuals(serviceId: string): Promise<any[]> {
    const pending = await this.indexedDb.getPendingRequests();
    
    const pendingVisuals = pending.filter(r => 
      r.type === 'CREATE' && 
      r.endpoint.includes('Services_Visuals') &&
      r.status !== 'synced' &&
      r.data.ServiceID === parseInt(serviceId)
    );

    console.log(`[OfflineRestore] Found ${pendingVisuals.length} pending visuals for service ${serviceId}`);

    return pendingVisuals.map(req => ({
      ...req.data,
      PK_ID: req.tempId,
      _tempId: req.tempId,
      _syncing: true,
      _localOnly: true,
      _createdAt: req.createdAt,
    }));
  }

  /**
   * Restore pending photos for a visual
   */
  async restorePendingPhotos(visualId: string): Promise<any[]> {
    const pendingPhotos = await this.indexedDb.getAllPendingPhotos();
    
    const photosForVisual = pendingPhotos.filter(p => 
      String(p.visualId) === String(visualId)
    );

    console.log(`[OfflineRestore] Found ${photosForVisual.length} pending photos for visual ${visualId}`);

    return Promise.all(photosForVisual.map(async (photo) => {
      // Recreate object URL from stored file
      const objectUrl = photo.file ? URL.createObjectURL(photo.file) : null;

      return {
        AttachID: photo.imageId,
        id: photo.imageId,
        name: photo.fileName,
        url: objectUrl,
        thumbnailUrl: objectUrl,
        isObjectUrl: true,
        uploading: true,
        _tempId: photo.imageId,
        _syncing: true,
        caption: photo.caption || '',
      };
    }));
  }

  /**
   * Trigger sync for all pending items
   */
  async syncAll(): Promise<void> {
    await this.backgroundSync.triggerSync();
  }

  /**
   * Get total pending count (for badges/indicators)
   */
  async getPendingCount(): Promise<number> {
    const stats = await this.indexedDb.getSyncStats();
    return stats.pending + stats.failed;
  }
}

