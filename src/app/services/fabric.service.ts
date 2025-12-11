/**
 * Fabric.js Service
 * Handles dynamic loading of Fabric.js library
 */

import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class FabricService {
  private fabric: any = null;
  private loadingPromise: Promise<any> | null = null;

  async getFabric(): Promise<any> {
    if (this.fabric) {
      return this.fabric;
    }

    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = this.loadFabric();
    this.fabric = await this.loadingPromise;
    return this.fabric;
  }

  private async loadFabric(): Promise<any> {
    console.log('[FabricService] loadFabric starting...');
    try {
      const module = await import('fabric');
      console.log('[FabricService] Fabric module imported:', Object.keys(module));
      // fabric.js exports the fabric object directly, not as module.fabric
      return module;
    } catch (error) {
      console.error('[FabricService] Failed to load Fabric.js:', error);
      throw error;
    }
  }

  async ensureFabricLoaded(): Promise<void> {
    console.log('[FabricService] ensureFabricLoaded called, fabric already loaded:', !!this.fabric);
    try {
      await this.getFabric();
      console.log('[FabricService] Fabric loaded successfully');
    } catch (error) {
      console.error('[FabricService] Failed to load Fabric:', error);
      throw error;
    }
  }
}
