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
    try {
      const module = await import('fabric');
      return module.fabric;
    } catch (error) {
      console.error('Failed to load Fabric.js:', error);
      throw error;
    }
  }

  async ensureFabricLoaded(): Promise<void> {
    await this.getFabric();
  }
}
