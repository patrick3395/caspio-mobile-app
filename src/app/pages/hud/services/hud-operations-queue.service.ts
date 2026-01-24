import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface HudSyncCompleteEvent {
  serviceId: string;
  fieldKey: string;
  hudId: number;
  operation: 'create' | 'update' | 'delete';
}

/**
 * Stub service for HUD operations queue.
 * This is a placeholder for future HUD-specific batch sync functionality.
 */
@Injectable({
  providedIn: 'root'
})
export class HudOperationsQueueService {
  syncComplete$ = new Subject<HudSyncCompleteEvent>();

  constructor() {}

  async syncDirtyFields(serviceId: string): Promise<number> {
    // Stub - returns 0 operations enqueued
    return 0;
  }
}
