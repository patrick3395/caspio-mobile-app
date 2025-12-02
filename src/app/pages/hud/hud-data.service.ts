import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CaspioService } from '../../services/caspio.service';

interface CacheEntry<T> {
  value: Promise<T>;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class HudDataService {
  private readonly cacheTtlMs = 5 * 60 * 1000;

  private projectCache = new Map<string, CacheEntry<any>>();
  private serviceCache = new Map<string, CacheEntry<any>>();
  private typeCache = new Map<string, CacheEntry<any>>();
  private imageCache = new Map<string, CacheEntry<string>>();
  private hudCache = new Map<string, CacheEntry<any[]>>();
  private hudAttachmentsCache = new Map<string, CacheEntry<any[]>>();

  constructor(private readonly caspioService: CaspioService) {}

  async getProject(projectId: string | null | undefined): Promise<any> {
    if (!projectId) {
      return null;
    }
    return this.resolveWithCache(this.projectCache, projectId, () =>
      firstValueFrom(this.caspioService.getProject(projectId))
    );
  }

  async getService(serviceId: string | null | undefined): Promise<any> {
    if (!serviceId) {
      return null;
    }
    return this.resolveWithCache(this.serviceCache, serviceId, () =>
      firstValueFrom(this.caspioService.getService(serviceId))
    );
  }

  async getType(typeId: string | null | undefined): Promise<any> {
    if (!typeId) {
      return null;
    }
    return this.resolveWithCache(this.typeCache, typeId, () =>
      firstValueFrom(this.caspioService.getType(typeId))
    );
  }


  async getImage(filePath: string): Promise<string> {
    if (!filePath) {
      return '';
    }
    return this.resolveWithCache(this.imageCache, filePath, () =>
      firstValueFrom(this.caspioService.getImageFromFilesAPI(filePath))
    );
  }

  async getVisualsByService(serviceId: string, bypassCache: boolean = false): Promise<any[]> {
    if (!serviceId) {
      console.warn('[HUD Data] getVisualsByService called with empty serviceId');
      return [];
    }
    console.log('[HUD Data] Loading existing HUD records for ServiceID:', serviceId, 'BypassCache:', bypassCache);
    
    // CRITICAL: If bypassCache is true, clear the cache first
    if (bypassCache) {
      console.log('[HUD Data] Bypassing cache - clearing cached data for ServiceID:', serviceId);
      this.hudCache.delete(serviceId);
    }
    
    const hudRecords = await this.resolveWithCache(this.hudCache, serviceId, () =>
      firstValueFrom(this.caspioService.getServicesHUDByServiceId(serviceId))
    );
    console.log('[HUD Data] API returned HUD records:', hudRecords.length, 'records');
    if (hudRecords.length > 0) {
      console.log('[HUD Data] Sample HUD record data:', hudRecords[0]);
    }
    return hudRecords;
  }

  async getVisualAttachments(hudId: string | number): Promise<any[]> {
    if (!hudId) {
      return [];
    }
    const key = String(hudId);
    return this.resolveWithCache(this.hudAttachmentsCache, key, () =>
      firstValueFrom(this.caspioService.getServiceHUDAttachByHUDId(String(hudId)))
    );
  }

  private async resolveWithCache<T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
    loader: () => Promise<T>
  ): Promise<T> {
    const existing = cache.get(key);
    if (existing && !this.isExpired(existing.timestamp)) {
      return existing.value;
    }
    const valuePromise = loader();
    cache.set(key, { value: valuePromise, timestamp: Date.now() });
    return valuePromise;
  }

  private isExpired(timestamp: number): boolean {
    return Date.now() - timestamp > this.cacheTtlMs;
  }

  // Clear all caches - use when returning to page to force fresh data load
  clearAllCaches(): void {
    console.log('[HUD Data Service] Clearing ALL caches to force fresh data load');

    // Clear in-memory caches in this service
    this.projectCache.clear();
    this.serviceCache.clear();
    this.typeCache.clear();
    this.imageCache.clear();
    this.hudCache.clear();
    this.hudAttachmentsCache.clear();

    // CRITICAL: Also clear the CaspioService's localStorage cache
    // This prevents returning stale cached data from previous page visits
    this.caspioService.clearServicesCache();
  }

  // Clear specific caches for a service - use when service data changes
  clearServiceCaches(serviceId: string): void {
    console.log('[HUD Data Service] Clearing caches for ServiceID:', serviceId);
    this.hudCache.delete(serviceId);
  }

  // ============================================
  // HUD PHOTO METHODS (matching Visual Photo methods from foundation service)
  // ============================================

  async uploadVisualPhoto(hudId: number, file: File, caption: string = '', drawings?: string, originalFile?: File): Promise<any> {
    console.log('[HUD Photo] ========== Uploading photo for HUDID:', hudId, '==========');
    console.log('[HUD Photo] File:', file.name, 'Caption:', caption || '(empty)');
    
    const result = await firstValueFrom(
      this.caspioService.createServicesHUDAttachWithFile(hudId, caption, file, drawings, originalFile)
    );

    console.log('[HUD Photo] Upload complete! Raw result:', JSON.stringify(result, null, 2));
    console.log('[HUD Photo] Result.Result:', result.Result);
    console.log('[HUD Photo] Result.Result[0]:', result.Result?.[0]);

    // Clear attachment cache for this HUD record
    const key = String(hudId);
    this.hudAttachmentsCache.delete(key);

    console.log('[HUD Photo] Returning result to caller');
    return result;
  }

  async deleteVisualPhoto(attachId: string): Promise<any> {
    console.log('[HUD Photo] Deleting photo:', attachId);
    const result = await firstValueFrom(this.caspioService.deleteServicesHUDAttach(attachId));

    // Clear all attachment caches
    this.hudAttachmentsCache.clear();

    return result;
  }

  async updateVisualPhotoCaption(attachId: string, caption: string): Promise<any> {
    console.log('[HUD Photo] Updating caption for AttachID:', attachId);
    const result = await firstValueFrom(
      this.caspioService.updateServicesHUDAttach(attachId, { Annotation: caption })
    );

    // Clear all attachment caches
    this.hudAttachmentsCache.clear();

    return result;
  }

  // Create HUD record (matching createVisual from foundation service)
  async createVisual(hudData: any): Promise<any> {
    console.log('[HUD Data] Creating HUD record:', hudData);
    const result = await firstValueFrom(
      this.caspioService.createServicesHUD(hudData)
    );

    // Clear cache for this service
    if (hudData.ServiceID) {
      this.hudCache.delete(String(hudData.ServiceID));
    }

    return result;
  }

  // Update HUD record (for hiding/unhiding without deleting)
  async updateVisual(hudId: string, updateData: any): Promise<any> {
    console.log('[HUD Data] Updating HUD record:', hudId, 'Data:', updateData);
    const result = await firstValueFrom(
      this.caspioService.updateServicesHUD(hudId, updateData)
    );

    // Clear cache
    this.hudAttachmentsCache.clear();

    return result;
  }
}
