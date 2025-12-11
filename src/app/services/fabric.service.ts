/**
 * Fabric.js Service
 * Provides access to Fabric.js library
 *
 * NOTE: Using static import instead of dynamic import to ensure
 * fabric.js is bundled with the main app and available offline.
 */

import { Injectable } from '@angular/core';
import * as fabric from 'fabric';

@Injectable({
  providedIn: 'root'
})
export class FabricService {
  private fabric: any = fabric;

  async getFabric(): Promise<any> {
    // Return immediately since fabric is statically imported
    return this.fabric;
  }

  async ensureFabricLoaded(): Promise<void> {
    // No-op since fabric is statically imported and always available
    console.log('[FabricService] Fabric already loaded (static import)');
  }
}
