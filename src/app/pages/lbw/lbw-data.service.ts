import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CaspioService } from '../../services/caspio.service';

interface CacheEntry<T> {
  value: Promise<T>;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class LbwDataService {
  private readonly cacheTtlMs = 5 * 60 * 1000;

  private projectCache = new Map<string, CacheEntry<any>>();
  private serviceCache = new Map<string, CacheEntry<any>>();
  private typeCache = new Map<string, CacheEntry<any>>();
  private imageCache = new Map<string, CacheEntry<string>>();
  private lbwCache = new Map<string, CacheEntry<any[]>>();
  private lbwAttachmentsCache = new Map<string, CacheEntry<any[]>>();

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
      console.warn('[LBW Data] getVisualsByService called with empty serviceId');
      return [];
    }
    console.log('[LBW Data] Loading existing LBW records for ServiceID:', serviceId, 'BypassCache:', bypassCache);
    
    // CRITICAL: If bypassCache is true, clear the cache first
    if (bypassCache) {
      console.log('[LBW Data] Bypassing cache - clearing cached data for ServiceID:', serviceId);
      this.lbwCache.delete(serviceId);
    }
    
    const lbwRecords = await this.resolveWithCache(this.lbwCache, serviceId, () =>
      firstValueFrom(this.caspioService.getServicesLBWByServiceId(serviceId))
    );
    console.log('[LBW Data] API returned LBW records:', lbwRecords.length, 'records');
    if (lbwRecords.length > 0) {
      console.log('[LBW Data] Sample LBW record data:', lbwRecords[0]);
    }
    return lbwRecords;
  }

  async getVisualAttachments(lbwId: string | number): Promise<any[]> {
    if (!lbwId) {
      return [];
    }
    const key = String(lbwId);
    return this.resolveWithCache(this.lbwAttachmentsCache, key, () =>
      firstValueFrom(this.caspioService.getServiceLBWAttachByLBWId(String(lbwId)))
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
    console.log('[LBW Data Service] Clearing ALL caches to force fresh data load');

    // Clear in-memory caches in this service
    this.projectCache.clear();
    this.serviceCache.clear();
    this.typeCache.clear();
    this.imageCache.clear();
    this.lbwCache.clear();
    this.lbwAttachmentsCache.clear();

    // CRITICAL: Also clear the CaspioService's localStorage cache
    // This prevents returning stale cached data from previous page visits
    this.caspioService.clearServicesCache();
  }

  // Clear specific caches for a service - use when service data changes
  clearServiceCaches(serviceId: string): void {
    console.log('[LBW Data Service] Clearing caches for ServiceID:', serviceId);
    this.lbwCache.delete(serviceId);
  }

  // ============================================
  // LBW PHOTO METHODS (matching Visual Photo methods from foundation service)
  // ============================================

  async uploadVisualPhoto(lbwId: number, file: File, caption: string = '', drawings?: string, originalFile?: File): Promise<any> {
    console.log('[LBW Photo] ========== Uploading photo for LBWID:', lbwId, '==========');
    console.log('[LBW Photo] File:', file.name, 'Caption:', caption || '(empty)');
    
    const result = await firstValueFrom(
      this.caspioService.createServicesLBWAttachWithFile(lbwId, caption, file, drawings, originalFile)
    );

    console.log('[LBW Photo] Upload complete! Raw result:', JSON.stringify(result, null, 2));
    console.log('[LBW Photo] Result.Result:', result.Result);
    console.log('[LBW Photo] Result.Result[0]:', result.Result?.[0]);

    // Clear attachment cache for this LBW record
    const key = String(lbwId);
    this.lbwAttachmentsCache.delete(key);

    console.log('[LBW Photo] Returning result to caller');
    return result;
  }

  async deleteVisualPhoto(attachId: string): Promise<any> {
    console.log('[LBW Photo] Deleting photo:', attachId);
    const result = await firstValueFrom(this.caspioService.deleteServicesLBWAttach(attachId));

    // Clear all attachment caches
    this.lbwAttachmentsCache.clear();

    return result;
  }

  async updateVisualPhotoCaption(attachId: string, caption: string): Promise<any> {
    console.log('[LBW Photo] Updating caption for AttachID:', attachId);
    const result = await firstValueFrom(
      this.caspioService.updateServicesLBWAttach(attachId, { Annotation: caption })
    );

    // Clear all attachment caches
    this.lbwAttachmentsCache.clear();

    return result;
  }

  // Create LBW record (matching createVisual from foundation service)
  async createVisual(lbwData: any): Promise<any> {
    console.log('[LBW Data] Creating LBW record:', lbwData);
    const result = await firstValueFrom(
      this.caspioService.createServicesLBW(lbwData)
    );

    // Clear cache for this service
    if (lbwData.ServiceID) {
      this.lbwCache.delete(String(lbwData.ServiceID));
    }

    return result;
  }

  // Update LBW record (for hiding/unhiding without deleting)
  async updateVisual(lbwId: string, updateData: any): Promise<any> {
    console.log('[LBW Data] Updating LBW record:', lbwId, 'Data:', updateData);
    const result = await firstValueFrom(
      this.caspioService.updateServicesLBW(lbwId, updateData)
    );

    // Clear cache
    this.lbwAttachmentsCache.clear();

    return result;
  }
}
