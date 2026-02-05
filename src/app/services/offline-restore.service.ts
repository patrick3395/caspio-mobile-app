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

  // ============================================
  // EFE (ELEVATION PLOT) RESTORE METHODS
  // ============================================

  /**
   * Restore pending EFE rooms for a service
   * Call this in elevation-plot-hub ngOnInit
   */
  async restorePendingEFERooms(serviceId: string): Promise<any[]> {
    const pendingEFE = await this.indexedDb.getPendingEFEByService(serviceId);

    const pendingRooms = pendingEFE.filter(p => p.type === 'room');


    return pendingRooms.map(p => ({
      ...p.data,
      EFEID: p.tempId,
      PK_ID: p.tempId,
      _tempId: p.tempId,
      _syncing: true,
      _localOnly: true,
      _createdAt: p.createdAt,
    }));
  }

  /**
   * Restore pending EFE points for a room
   * Call this in room-elevation ngOnInit
   */
  async restorePendingEFEPoints(roomId: string): Promise<any[]> {
    const pendingPoints = await this.indexedDb.getPendingEFEPoints(roomId);


    return pendingPoints.map(p => ({
      ...p.data,
      PointID: p.tempId,
      PK_ID: p.tempId,
      _tempId: p.tempId,
      _syncing: true,
      _localOnly: true,
      _createdAt: p.createdAt,
    }));
  }

  /**
   * Restore pending EFE photos for a point
   */
  async restorePendingEFEPhotos(pointId: string): Promise<any[]> {
    const pendingPhotos = await this.indexedDb.getPendingPhotosForPoint(pointId);


    return pendingPhotos;
  }

  /**
   * Get all pending EFE items for a service (rooms + points + photos)
   * Useful for showing sync status
   */
  async getPendingEFECount(serviceId: string): Promise<{ rooms: number; points: number; photos: number }> {
    const pendingEFE = await this.indexedDb.getPendingEFEByService(serviceId);
    const allPhotos = await this.indexedDb.getAllPendingPhotos();

    const rooms = pendingEFE.filter(p => p.type === 'room').length;
    const points = pendingEFE.filter(p => p.type === 'point').length;
    const photos = allPhotos.filter(p => p.isEFE).length;

    return { rooms, points, photos };
  }
}

