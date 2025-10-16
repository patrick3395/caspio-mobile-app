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
}
