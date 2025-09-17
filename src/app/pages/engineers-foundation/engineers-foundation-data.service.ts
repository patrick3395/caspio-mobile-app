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
  private roomTemplatesCache: CacheEntry<any[]> | null = null;
  private visualsCache = new Map<string, CacheEntry<any[]>>();
  private visualAttachmentsCache = new Map<string, CacheEntry<any[]>>();
  private roomPointsCache = new Map<string, CacheEntry<any[]>>();
  private roomAttachmentsCache = new Map<string, CacheEntry<any[]>>();

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

  async getRoomTemplates(forceRefresh = false): Promise<any[]> {
    if (!forceRefresh && this.roomTemplatesCache && !this.isExpired(this.roomTemplatesCache.timestamp)) {
      return this.roomTemplatesCache.value;
    }

    const loader = firstValueFrom(this.caspioService.getServicesRoomTemplates());
    this.roomTemplatesCache = { value: loader, timestamp: Date.now() };
    return loader;
  }

  async getRoomsByService(serviceId: string): Promise<any[]> {
    if (!serviceId) {
      return [];
    }
    return firstValueFrom(this.caspioService.getServicesRooms(serviceId));
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
      return [];
    }
    return this.resolveWithCache(this.visualsCache, serviceId, () =>
      firstValueFrom(this.caspioService.getServicesVisualsByServiceId(serviceId))
    );
  }

  async getVisualAttachments(visualId: string | number): Promise<any[]> {
    if (!visualId) {
      return [];
    }
    const key = String(visualId);
    return this.resolveWithCache(this.visualAttachmentsCache, key, () =>
      firstValueFrom(this.caspioService.getServiceVisualsAttachByVisualId(visualId))
    );
  }

  async getRoomPoints(roomId: string | number): Promise<any[]> {
    if (!roomId) {
      return [];
    }
    const key = String(roomId);
    return this.resolveWithCache(this.roomPointsCache, key, () =>
      firstValueFrom(this.caspioService.getServicesRoomsPoints(roomId))
    );
  }

  async getRoomAttachments(pointIds: string | string[]): Promise<any[]> {
    if (!pointIds || (Array.isArray(pointIds) && pointIds.length === 0)) {
      return [];
    }
    const key = Array.isArray(pointIds) ? pointIds.sort().join('|') : pointIds;
    return this.resolveWithCache(this.roomAttachmentsCache, key, () =>
      firstValueFrom(this.caspioService.getServicesRoomsAttachments(pointIds))
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
}
