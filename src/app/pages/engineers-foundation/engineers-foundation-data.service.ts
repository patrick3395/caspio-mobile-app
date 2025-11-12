import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CaspioService } from '../../services/caspio.service';

interface CacheEntry<T> {
  value: Promise<T>;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class EngineersFoundationDataService {
  private readonly cacheTtlMs = 5 * 60 * 1000;

  private projectCache = new Map<string, CacheEntry<any>>();
  private serviceCache = new Map<string, CacheEntry<any>>();
  private typeCache = new Map<string, CacheEntry<any>>();
  private imageCache = new Map<string, CacheEntry<string>>();
  private efeTemplatesCache: CacheEntry<any[]> | null = null;
  private visualsCache = new Map<string, CacheEntry<any[]>>();
  private visualAttachmentsCache = new Map<string, CacheEntry<any[]>>();
  private efePointsCache = new Map<string, CacheEntry<any[]>>();
  private efeAttachmentsCache = new Map<string, CacheEntry<any[]>>();

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

  async getEFETemplates(forceRefresh = false): Promise<any[]> {
    if (!forceRefresh && this.efeTemplatesCache && !this.isExpired(this.efeTemplatesCache.timestamp)) {
      return this.efeTemplatesCache.value;
    }

    const loader = firstValueFrom(this.caspioService.getServicesEFETemplates());
    this.efeTemplatesCache = { value: loader, timestamp: Date.now() };
    return loader;
  }

  async getEFEByService(serviceId: string, forceRefresh = true): Promise<any[]> {
    if (!serviceId) {
      console.warn('[EFE Data] getEFEByService called with empty serviceId');
      return [];
    }
    
    // CRITICAL: Always bypass cache for room data to ensure we get latest changes
    // Room data changes frequently (adding, renaming, deleting rooms)
    if (forceRefresh) {
      console.log('[EFE Data] FORCE REFRESH - Clearing cache and loading fresh rooms for ServiceID:', serviceId);
      // Clear the specific cache in CaspioService for this service's EFE data
      this.caspioService.clearServicesCache();
    } else {
      console.log('[EFE Data] Loading existing rooms for ServiceID:', serviceId);
    }
    
    const rooms = await firstValueFrom(this.caspioService.getServicesEFE(serviceId));
    console.log('[EFE Data] API returned rooms:', rooms.length, 'rooms');
    if (rooms.length > 0) {
      console.log('[EFE Data] Sample room data:', rooms[0]);
    }
    return rooms;
  }

  async getImage(filePath: string): Promise<string> {
    if (!filePath) {
      return '';
    }
    return this.resolveWithCache(this.imageCache, filePath, () =>
      firstValueFrom(this.caspioService.getImageFromFilesAPI(filePath))
    );
  }

  async getVisualsByService(serviceId: string): Promise<any[]> {
    if (!serviceId) {
      console.warn('[Visual Data] getVisualsByService called with empty serviceId');
      return [];
    }
    console.log('[Visual Data] Loading existing visuals for ServiceID:', serviceId);
    const visuals = await this.resolveWithCache(this.visualsCache, serviceId, () =>
      firstValueFrom(this.caspioService.getServicesVisualsByServiceId(serviceId))
    );
    console.log('[Visual Data] API returned visuals:', visuals.length, 'visuals');
    if (visuals.length > 0) {
      console.log('[Visual Data] Sample visual data:', visuals[0]);
    }
    return visuals;
  }

  async getVisualAttachments(visualId: string | number): Promise<any[]> {
    if (!visualId) {
      return [];
    }
    const key = String(visualId);
    return this.resolveWithCache(this.visualAttachmentsCache, key, () =>
      firstValueFrom(this.caspioService.getServiceVisualsAttachByVisualId(String(visualId)))
    );
  }

  async getEFEPoints(roomId: string | number): Promise<any[]> {
    if (!roomId) {
      return [];
    }
    const key = String(roomId);
    return this.resolveWithCache(this.efePointsCache, key, () =>
      firstValueFrom(this.caspioService.getServicesEFEPoints(String(roomId)))
    );
  }

  async getEFEAttachments(pointIds: string | string[]): Promise<any[]> {
    if (!pointIds || (Array.isArray(pointIds) && pointIds.length === 0)) {
      return [];
    }
    const key = Array.isArray(pointIds) ? pointIds.sort().join('|') : pointIds;
    return this.resolveWithCache(this.efeAttachmentsCache, key, () =>
      firstValueFrom(this.caspioService.getServicesEFEAttachments(pointIds))
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
    console.log('[Data Service] Clearing ALL caches to force fresh data load');

    // Clear in-memory caches in this service
    this.projectCache.clear();
    this.serviceCache.clear();
    this.typeCache.clear();
    this.imageCache.clear();
    this.efeTemplatesCache = null;
    this.visualsCache.clear();
    this.visualAttachmentsCache.clear();
    this.efePointsCache.clear();
    this.efeAttachmentsCache.clear();

    // CRITICAL: Also clear the CaspioService's localStorage cache
    // This prevents returning stale cached data from previous page visits
    this.caspioService.clearServicesCache();
  }

  // Clear specific caches for a service - use when service data changes
  clearServiceCaches(serviceId: string): void {
    console.log('[Data Service] Clearing caches for ServiceID:', serviceId);
    this.visualsCache.delete(serviceId);
    // Note: Can't easily clear EFE points/attachments without knowing all room IDs
    // Better to use clearAllCaches() when returning to page
  }

  // ============================================
  // VISUAL MANAGEMENT METHODS
  // ============================================

  async createVisual(visualData: any): Promise<any> {
    console.log('[Visual Data] Creating new visual:', visualData);
    const result = await firstValueFrom(this.caspioService.createServicesVisual(visualData));

    // Clear cache for this service to force reload
    if (visualData.ServiceID) {
      this.visualsCache.delete(String(visualData.ServiceID));
    }

    return result;
  }

  async updateVisual(visualId: string, visualData: any): Promise<any> {
    console.log('[Visual Data] Updating visual:', visualId);
    const result = await firstValueFrom(this.caspioService.updateServicesVisual(visualId, visualData));

    // Clear cache to force reload (we don't know which service this visual belongs to)
    this.visualsCache.clear();

    return result;
  }

  async deleteVisual(visualId: string): Promise<any> {
    console.log('[Visual Data] Deleting visual:', visualId);
    const result = await firstValueFrom(this.caspioService.deleteServicesVisual(visualId));

    // Clear cache to force reload
    this.visualsCache.clear();

    return result;
  }

  // ============================================
  // VISUAL PHOTO METHODS
  // ============================================

  async uploadVisualPhoto(visualId: number, file: File, caption: string = '', drawings?: string, originalFile?: File): Promise<any> {
    console.log('[Visual Photo] Uploading photo for VisualID:', visualId);
    const result = await firstValueFrom(
      this.caspioService.createServicesVisualsAttachWithFile(visualId, caption, file, drawings, originalFile)
    );

    // Clear attachment cache for this visual
    const key = String(visualId);
    this.visualAttachmentsCache.delete(key);

    return result;
  }

  async deleteVisualPhoto(attachId: string): Promise<any> {
    console.log('[Visual Photo] Deleting photo:', attachId);
    const result = await firstValueFrom(this.caspioService.deleteServiceVisualsAttach(attachId));

    // Clear all attachment caches since we don't know which visual this belongs to
    this.visualAttachmentsCache.clear();

    return result;
  }

  async updateVisualPhotoCaption(attachId: string, caption: string): Promise<any> {
    console.log('[Visual Photo] Updating caption for AttachID:', attachId);
    const result = await firstValueFrom(
      this.caspioService.updateServicesVisualsAttach(attachId, { Annotation: caption })
    );

    // Clear all attachment caches
    this.visualAttachmentsCache.clear();

    return result;
  }
}
