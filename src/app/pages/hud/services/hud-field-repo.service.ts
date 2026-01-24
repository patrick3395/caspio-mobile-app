import { Injectable } from '@angular/core';

/**
 * Stub service for HUD field repository operations.
 * This is a placeholder for future HUD-specific field syncing functionality.
 */
@Injectable({
  providedIn: 'root'
})
export class HudFieldRepoService {
  constructor() {}

  isDexieFirstEnabled(): boolean {
    // Stub - Dexie-first is not enabled for HUD
    return false;
  }

  async getDirtyFields(): Promise<any[]> {
    // Stub - returns empty array
    return [];
  }
}
