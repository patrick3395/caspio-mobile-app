import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CaspioService } from '../caspio.service';
import { IndexedDbService, CacheDataType } from '../indexed-db.service';
import { TempIdService } from '../temp-id.service';
import { LocalImageService } from '../local-image.service';
import { TemplateConfig, TemplateType } from './template-config.interface';
import { TemplateConfigService } from './template-config.service';
import { environment } from '../../../environments/environment';
import { db } from '../caspio-db';

/**
 * Response wrapper for Caspio API responses
 */
interface CaspioResponse<T = any> {
  Result?: T[];
  RecordsAffected?: number;
  PK_ID?: number;
}

/**
 * TemplateDataAdapter - Unified data access layer for all template types
 *
 * This service provides a config-driven API for CRUD operations on visuals,
 * attachments, templates, and dropdowns. Instead of duplicating data access
 * logic across 4 template-specific services, this adapter uses TemplateConfig
 * to generate the correct endpoints and field names.
 *
 * Usage:
 * ```typescript
 * constructor(private dataAdapter: TemplateDataAdapter) {}
 *
 * async loadVisuals() {
 *   // Adapter uses current template config automatically
 *   const visuals = await this.dataAdapter.getVisuals(this.serviceId);
 * }
 *
 * // Or use with explicit config
 * async loadVisuals() {
 *   const visuals = await this.dataAdapter.getVisualsWithConfig(
 *     HUD_CONFIG,
 *     this.serviceId
 *   );
 * }
 * ```
 */
@Injectable({
  providedIn: 'root'
})
export class TemplateDataAdapter {

  constructor(
    private caspioService: CaspioService,
    private indexedDb: IndexedDbService,
    private tempIdService: TempIdService,
    private templateConfigService: TemplateConfigService,
    private localImageService: LocalImageService
  ) {}

  /**
   * Convert config cache key to IndexedDB CacheDataType
   */
  private getCacheType(config: TemplateConfig): CacheDataType {
    return config.visualsCacheKey as CacheDataType;
  }

  /**
   * Get attachment cache type for a template
   */
  private getAttachmentCacheType(config: TemplateConfig): CacheDataType {
    // Map template types to their attachment cache keys
    switch (config.id) {
      case 'hud': return 'hud_attachments';
      case 'efe': return 'visual_attachments';
      case 'lbw': return 'lbw_attachments';
      case 'dte': return 'dte_attachments';
      default: return 'visual_attachments';
    }
  }

  // ============================================
  // VISUAL OPERATIONS
  // ============================================

  /**
   * Get all visuals for a service using current template config
   */
  async getVisuals(serviceId: string): Promise<any[]> {
    const config = this.templateConfigService.requiredConfig;
    return this.getVisualsWithConfig(config, serviceId);
  }

  /**
   * Get all visuals for a service with explicit config
   */
  async getVisualsWithConfig(config: TemplateConfig, serviceId: string): Promise<any[]> {
    const endpoint = `/tables/${config.tableName}/records?q.where=ServiceID=${serviceId}&response=rows`;

    if (environment.isWeb) {
      // Webapp: Direct API call
      const response = await this.fetchApi<CaspioResponse>(endpoint);
      return response.Result || [];
    } else {
      // Mobile: Try cache first, then API
      const cached = await this.indexedDb.getCachedServiceData(serviceId, this.getCacheType(config));
      if (cached && cached.length > 0) {
        return cached;
      }

      const response = await firstValueFrom(
        this.caspioService.get<CaspioResponse>(endpoint)
      );
      const visuals = response.Result || [];

      // Cache for offline use
      await this.indexedDb.cacheServiceData(serviceId, this.getCacheType(config), visuals);
      return visuals;
    }
  }

  /**
   * DEXIE-FIRST: Ensure service data is cached before seeding
   *
   * This method is called before the Dexie-first seeding process to ensure
   * that existing records from the server are cached in IndexedDB. This is
   * essential because:
   * 1. Seeding creates blank field records from templates
   * 2. Merging needs cached server records to apply user selections
   * 3. Without this, merging has nothing to merge and user data is lost
   *
   * @param config Template configuration
   * @param serviceId Service ID to load data for
   * @returns Cached or freshly fetched service records
   */
  async ensureServiceDataCached(config: TemplateConfig, serviceId: string): Promise<any[]> {
    const cacheType = this.getCacheType(config);

    // Check if already cached
    const cached = await this.indexedDb.getCachedServiceData(serviceId, cacheType);
    if (cached && cached.length > 0) {
      console.log(`[DataAdapter] ensureServiceDataCached: ${config.id} has ${cached.length} cached records`);
      return cached;
    }

    // Not cached - need to fetch
    console.log(`[DataAdapter] ensureServiceDataCached: ${config.id} cache empty, fetching from API...`);

    if (environment.isWeb) {
      // Webapp: Direct API call
      const endpoint = `/tables/${config.tableName}/records?q.where=ServiceID=${serviceId}&response=rows`;
      try {
        const response = await this.fetchApi<CaspioResponse>(endpoint);
        const records = response.Result || [];
        await this.indexedDb.cacheServiceData(serviceId, cacheType, records);
        console.log(`[DataAdapter] ensureServiceDataCached: ${config.id} fetched and cached ${records.length} records`);
        return records;
      } catch (error) {
        console.warn(`[DataAdapter] ensureServiceDataCached: API fetch failed:`, error);
        return [];
      }
    } else {
      // Mobile: Fetch from API if online
      try {
        const endpoint = `/tables/${config.tableName}/records?q.where=ServiceID=${serviceId}&response=rows`;
        const response = await firstValueFrom(
          this.caspioService.get<CaspioResponse>(endpoint)
        );
        const records = response.Result || [];
        await this.indexedDb.cacheServiceData(serviceId, cacheType, records);
        console.log(`[DataAdapter] ensureServiceDataCached: ${config.id} fetched and cached ${records.length} records`);
        return records;
      } catch (error) {
        console.warn(`[DataAdapter] ensureServiceDataCached: API fetch failed (offline?):`, error);
        // Return empty - offline with no cache, seeding will create blank fields
        return [];
      }
    }
  }

  /**
   * Get a single visual by ID using current template config
   */
  async getVisualById(visualId: string): Promise<any | null> {
    const config = this.templateConfigService.requiredConfig;
    return this.getVisualByIdWithConfig(config, visualId);
  }

  /**
   * Get a single visual by ID with explicit config
   */
  async getVisualByIdWithConfig(config: TemplateConfig, visualId: string): Promise<any | null> {
    const endpoint = `/tables/${config.tableName}/records?q.where=${config.idFieldName}=${visualId}`;

    if (environment.isWeb) {
      const response = await this.fetchApi<CaspioResponse>(endpoint);
      return response.Result?.[0] || null;
    } else {
      const response = await firstValueFrom(
        this.caspioService.get<CaspioResponse>(endpoint)
      );
      return response.Result?.[0] || null;
    }
  }

  /**
   * Create a new visual using current template config
   */
  async createVisual(visualData: any): Promise<any> {
    const config = this.templateConfigService.requiredConfig;
    return this.createVisualWithConfig(config, visualData);
  }

  /**
   * Create a new visual with explicit config
   */
  async createVisualWithConfig(config: TemplateConfig, visualData: any): Promise<any> {
    const endpoint = `/tables/${config.tableName}/records?response=rows`;

    if (environment.isWeb) {
      // Webapp: Direct API call
      const response = await this.fetchApi<CaspioResponse>(endpoint, 'POST', visualData);
      const createdRecord = response.Result?.[0] || response;
      const recordId = createdRecord[config.idFieldName] || createdRecord.PK_ID;

      return {
        ...visualData,
        [config.idFieldName]: recordId,
        PK_ID: recordId,
        ...createdRecord
      };
    } else {
      // Mobile: Offline-first with background sync
      const tempId = this.tempIdService.generateTempId(config.id);

      const placeholder = {
        ...visualData,
        [config.idFieldName]: tempId,
        PK_ID: tempId,
        _tempId: tempId,
        _localOnly: true,
        _syncing: true,
        _createdAt: Date.now(),
      };

      // Queue for background sync
      await this.indexedDb.addPendingRequest({
        type: 'CREATE',
        tempId: tempId,
        endpoint: `/api/caspio-proxy${endpoint}`,
        method: 'POST',
        data: visualData,
        dependencies: [],
        status: 'pending',
        priority: 'high',
      });

      // Cache placeholder
      const serviceIdStr = String(visualData.ServiceID);
      const existingRecords = await this.indexedDb.getCachedServiceData(serviceIdStr, this.getCacheType(config)) || [];
      await this.indexedDb.cacheServiceData(serviceIdStr, this.getCacheType(config), [...existingRecords, placeholder]);

      return placeholder;
    }
  }

  /**
   * Update a visual using current template config
   */
  async updateVisual(visualId: string, visualData: any, serviceId?: string): Promise<any> {
    const config = this.templateConfigService.requiredConfig;
    return this.updateVisualWithConfig(config, visualId, visualData, serviceId);
  }

  /**
   * Update a visual with explicit config
   */
  async updateVisualWithConfig(
    config: TemplateConfig,
    visualId: string,
    visualData: any,
    serviceId?: string
  ): Promise<any> {
    if (environment.isWeb) {
      // Webapp: Direct API call
      const endpoint = `/tables/${config.tableName}/records?q.where=${config.idFieldName}=${visualId}`;
      await this.fetchApi(endpoint, 'PUT', visualData);
      return { success: true, [config.idFieldName]: visualId, ...visualData };
    } else {
      // Mobile: Offline-first
      const isTempId = String(visualId).startsWith('temp_');
      let effectiveId = visualId;

      if (isTempId) {
        // Try to update pending CREATE request first
        const updated = await this.indexedDb.updatePendingRequestData(visualId, visualData);

        if (!updated) {
          // No pending request found - the CREATE has already synced
          // Look up the real ID and create an UPDATE request instead
          const realId = await this.indexedDb.getRealId(visualId);
          if (realId) {
            console.log(`[TemplateDataAdapter] Temp ID ${visualId} already synced, using real ID ${realId} for UPDATE`);
            effectiveId = realId;
            // Fall through to create UPDATE request with real ID
          } else {
            console.warn(`[TemplateDataAdapter] No pending request and no real ID mapping for ${visualId}`);
            // Still try to create an update with temp ID - it might work if mapping exists server-side
          }
        } else {
          // Successfully updated pending CREATE request - we're done
          console.log(`[TemplateDataAdapter] Updated pending CREATE request for ${visualId}`);

          // Update local cache
          if (serviceId) {
            const existingRecords = await this.indexedDb.getCachedServiceData(serviceId, this.getCacheType(config)) || [];
            const updatedRecords = existingRecords.map((r: any) => {
              const recordId = r[config.idFieldName] || r.PK_ID;
              if (String(recordId) === String(visualId)) {
                return { ...r, ...visualData, _localUpdate: true };
              }
              return r;
            });
            await this.indexedDb.cacheServiceData(serviceId, this.getCacheType(config), updatedRecords);
          }

          return { success: true, [config.idFieldName]: visualId, ...visualData };
        }
      }

      // Queue UPDATE request (for real IDs or temp IDs that have already synced)
      const endpoint = `/tables/${config.tableName}/records?q.where=${config.idFieldName}=${effectiveId}`;
      await this.indexedDb.addPendingRequest({
        type: 'UPDATE',
        endpoint: `/api/caspio-proxy${endpoint}`,
        method: 'PUT',
        data: visualData,
        dependencies: [],
        status: 'pending',
        priority: 'normal',
      });
      console.log(`[TemplateDataAdapter] Queued UPDATE request for ${effectiveId}`);

      // Update local cache
      if (serviceId) {
        const existingRecords = await this.indexedDb.getCachedServiceData(serviceId, this.getCacheType(config)) || [];
        const updatedRecords = existingRecords.map((r: any) => {
          const recordId = r[config.idFieldName] || r.PK_ID;
          // Match both temp and real IDs
          if (String(recordId) === String(visualId) || String(recordId) === String(effectiveId)) {
            return { ...r, ...visualData, _localUpdate: true };
          }
          return r;
        });
        await this.indexedDb.cacheServiceData(serviceId, this.getCacheType(config), updatedRecords);
      }

      return { success: true, [config.idFieldName]: effectiveId, ...visualData };
    }
  }

  /**
   * Delete a visual using current template config
   */
  async deleteVisual(visualId: string, serviceId?: string): Promise<boolean> {
    const config = this.templateConfigService.requiredConfig;
    return this.deleteVisualWithConfig(config, visualId, serviceId);
  }

  /**
   * Delete a visual with explicit config
   */
  async deleteVisualWithConfig(
    config: TemplateConfig,
    visualId: string,
    serviceId?: string
  ): Promise<boolean> {
    const endpoint = `/tables/${config.tableName}/records?q.where=${config.idFieldName}=${visualId}`;

    if (environment.isWeb) {
      await this.fetchApi(endpoint, 'DELETE');
      return true;
    } else {
      const isTempId = String(visualId).startsWith('temp_');

      if (isTempId) {
        // Remove pending request
        await this.indexedDb.removePendingRequest(visualId);
      } else {
        // Queue delete for sync
        await this.indexedDb.addPendingRequest({
          type: 'DELETE',
          endpoint: `/api/caspio-proxy${endpoint}`,
          method: 'DELETE',
          data: {},
          dependencies: [],
          status: 'pending',
          priority: 'normal',
        });
      }

      // Remove from local cache
      if (serviceId) {
        const existingRecords = await this.indexedDb.getCachedServiceData(serviceId, this.getCacheType(config)) || [];
        const filteredRecords = existingRecords.filter((r: any) => {
          const recordId = r[config.idFieldName] || r.PK_ID;
          return String(recordId) !== String(visualId);
        });
        await this.indexedDb.cacheServiceData(serviceId, this.getCacheType(config), filteredRecords);
      }

      return true;
    }
  }

  // ============================================
  // ATTACHMENT OPERATIONS
  // ============================================

  /**
   * Get attachments for a visual using current template config
   */
  async getAttachments(visualId: string): Promise<any[]> {
    const config = this.templateConfigService.requiredConfig;
    return this.getAttachmentsWithConfig(config, visualId);
  }

  /**
   * Get attachments for a visual with explicit config
   */
  async getAttachmentsWithConfig(config: TemplateConfig, visualId: string): Promise<any[]> {
    // Order by AttachID to maintain consistent photo order regardless of modifications
    const endpoint = `/tables/${config.attachTableName}/records?q.where=${config.idFieldName}=${visualId}&q.orderBy=AttachID`;

    if (environment.isWeb) {
      const response = await this.fetchApi<CaspioResponse>(endpoint);
      return response.Result || [];
    } else {
      const response = await firstValueFrom(
        this.caspioService.get<CaspioResponse>(endpoint)
      );
      return response.Result || [];
    }
  }

  /**
   * Create an attachment using current template config
   */
  async createAttachment(attachmentData: any): Promise<any> {
    const config = this.templateConfigService.requiredConfig;
    return this.createAttachmentWithConfig(config, attachmentData);
  }

  /**
   * Create an attachment with explicit config
   */
  async createAttachmentWithConfig(config: TemplateConfig, attachmentData: any): Promise<any> {
    const endpoint = `/tables/${config.attachTableName}/records?response=rows`;

    if (environment.isWeb) {
      const response = await this.fetchApi<CaspioResponse>(endpoint, 'POST', attachmentData);
      const createdRecord = response.Result?.[0] || response;
      return {
        ...attachmentData,
        AttachID: createdRecord.AttachID || createdRecord.PK_ID,
        PK_ID: createdRecord.AttachID || createdRecord.PK_ID,
        ...createdRecord
      };
    } else {
      // Generate temp ID using base template type (attach suffix is added by convention)
      const tempId = this.tempIdService.generateTempId(config.id) + '_attach_' + Date.now();

      const placeholder = {
        ...attachmentData,
        AttachID: tempId,
        PK_ID: tempId,
        _tempId: tempId,
        _localOnly: true,
        _syncing: true,
      };

      await this.indexedDb.addPendingRequest({
        type: 'CREATE',
        tempId: tempId,
        endpoint: `/api/caspio-proxy${endpoint}`,
        method: 'POST',
        data: attachmentData,
        dependencies: [],
        status: 'pending',
        priority: 'normal',
      });

      return placeholder;
    }
  }

  /**
   * Update an attachment using current template config
   */
  async updateAttachment(attachId: string, attachmentData: any): Promise<any> {
    const config = this.templateConfigService.requiredConfig;
    return this.updateAttachmentWithConfig(config, attachId, attachmentData);
  }

  /**
   * Update an attachment with explicit config
   */
  async updateAttachmentWithConfig(
    config: TemplateConfig,
    attachId: string,
    attachmentData: any
  ): Promise<any> {
    const endpoint = `/tables/${config.attachTableName}/records?q.where=AttachID=${attachId}`;

    if (environment.isWeb) {
      await this.fetchApi(endpoint, 'PUT', attachmentData);
      return { success: true, AttachID: attachId, ...attachmentData };
    } else {
      const isTempId = String(attachId).startsWith('temp_');
      const isLocalImageId = String(attachId).startsWith('img_');

      if (isLocalImageId) {
        // CRITICAL FIX: Handle local images (img_* prefix) that haven't synced yet
        // Update the LocalImage's drawings/caption directly in IndexedDB
        // The drawings will be uploaded with the image when background sync runs
        console.log('[TemplateDataAdapter] Updating local image annotations:', attachId);
        await this.localImageService.updateCaptionAndDrawings(
          attachId,
          attachmentData.Annotation, // caption
          attachmentData.Drawings    // compressed drawings data
        );

        // SYNC MODAL FIX: Also queue a pendingCaption entry for UI feedback
        // This shows the user their annotation change is queued for sync
        // When the photo syncs via upload outbox, it will include the annotations
        // The pendingCaption will wait for photo sync, then sync (or be cleaned up)
        const attachType = this.getAttachTypeFromConfig(config);
        console.log('[TemplateDataAdapter] Queuing caption for unsynced photo (UI feedback):', attachId);
        await this.indexedDb.queueCaptionUpdate({
          attachId: attachId,
          attachType: attachType,
          caption: attachmentData.Annotation,
          drawings: attachmentData.Drawings
        });
      } else if (isTempId) {
        await this.indexedDb.updatePendingRequestData(attachId, attachmentData);
      } else {
        // Real server ID - queue caption/drawings update for sync
        // SYNC FIX: Use queueCaptionUpdate instead of addPendingRequest
        // This ensures annotation updates appear in the sync modal and are processed correctly
        const attachType = this.getAttachTypeFromConfig(config);
        console.log('[TemplateDataAdapter] Queuing caption update for synced photo:', attachId, 'type:', attachType);
        await this.indexedDb.queueCaptionUpdate({
          attachId: attachId,
          attachType: attachType,
          caption: attachmentData.Annotation,
          drawings: attachmentData.Drawings
        });

        // THUMBNAIL/EDITOR FIX: Also update the LocalImage if one exists for this attachId
        // This ensures thumbnails and editor show the updated annotations immediately
        // The LocalImage might exist if this is a local-first photo that has synced
        const localImage = await this.indexedDb.getLocalImageByAttachId(attachId);
        if (localImage) {
          console.log('[TemplateDataAdapter] Also updating LocalImage for synced photo:', localImage.imageId);
          await this.localImageService.updateCaptionAndDrawings(
            localImage.imageId,
            attachmentData.Annotation,
            attachmentData.Drawings
          );
        }
      }

      return { success: true, AttachID: attachId, ...attachmentData };
    }
  }

  /**
   * Get the attach type string from template config for caption updates
   */
  private getAttachTypeFromConfig(config: TemplateConfig): 'visual' | 'efe_point' | 'fdf' | 'hud' | 'lbw' {
    switch (config.id) {
      case 'hud':
        return 'hud';
      case 'lbw':
        return 'lbw';
      case 'efe':
        return 'visual';  // EFE uses 'visual' type for its attachments
      case 'dte':
        return 'visual';  // DTE also uses 'visual' type
      default:
        return 'visual';
    }
  }

  /**
   * Delete an attachment using current template config
   */
  async deleteAttachment(attachId: string): Promise<boolean> {
    const config = this.templateConfigService.requiredConfig;
    return this.deleteAttachmentWithConfig(config, attachId);
  }

  /**
   * Delete an attachment with explicit config
   */
  async deleteAttachmentWithConfig(config: TemplateConfig, attachId: string): Promise<boolean> {
    const endpoint = `/tables/${config.attachTableName}/records?q.where=AttachID=${attachId}`;

    if (environment.isWeb) {
      await this.fetchApi(endpoint, 'DELETE');
      return true;
    } else {
      const isTempId = String(attachId).startsWith('temp_') || String(attachId).startsWith('img_');
      let deletedCount = 0;
      const attachIdStr = String(attachId);

      // MOBILE: Delete from local storage (localImages table)
      // Try multiple lookup methods since photos can be stored under different IDs

      // Method 1: Delete by imageId (primary key)
      const beforeDelete1 = await db.localImages.get(attachId);
      if (beforeDelete1) {
        await db.localImages.delete(attachId);
        deletedCount++;
        console.log('[TemplateDataAdapter] Deleted localImage by imageId:', attachId);
      }

      // Method 2: Find and delete by attachId field (for synced images)
      const byAttachId = await db.localImages.where('attachId').equals(attachId).toArray();
      for (const img of byAttachId) {
        await db.localImages.delete(img.imageId);
        deletedCount++;
        console.log('[TemplateDataAdapter] Deleted localImage by attachId lookup:', img.imageId);
      }

      // Method 3: Find by entityId (in case the ID is actually an entityId)
      const byEntityId = await db.localImages.where('entityId').equals(attachId).toArray();
      for (const img of byEntityId) {
        await db.localImages.delete(img.imageId);
        deletedCount++;
        console.log('[TemplateDataAdapter] Deleted localImage by entityId lookup:', img.imageId);
      }

      console.log(`[TemplateDataAdapter] Delete from localImages: ${deletedCount} images deleted for ID: ${attachId}`);

      // CRITICAL FIX: Also remove from attachment cache (visual_attachments, hud_attachments, etc.)
      // Photos are cached in TWO places - localImages AND cachedServiceData attachment caches
      const cacheType = this.getAttachmentCacheType(config);
      const allCached = await db.cachedServiceData.toArray();
      let cacheUpdatedCount = 0;

      for (const cached of allCached) {
        // Check both by exact dataType match AND by dataType containing the template type
        const isRelevantCache = cached.dataType === cacheType ||
          cached.dataType === 'visual_attachments' ||
          cached.dataType?.includes('attachments');

        if (isRelevantCache && Array.isArray(cached.data)) {
          const originalLength = cached.data.length;
          cached.data = cached.data.filter((att: any) =>
            String(att.AttachID) !== attachIdStr &&
            String(att.attachId) !== attachIdStr &&
            String(att.imageId) !== attachIdStr
          );

          if (cached.data.length < originalLength) {
            await db.cachedServiceData.put(cached);
            cacheUpdatedCount++;
            console.log(`[TemplateDataAdapter] Removed from ${cached.dataType} cache (${cached.cacheKey}): was ${originalLength} now ${cached.data.length}`);
          }
        }
      }

      console.log(`[TemplateDataAdapter] Delete complete: ${deletedCount} localImages + ${cacheUpdatedCount} cache entries updated for ID: ${attachId}`);

      // Queue backend delete (unless it's a temp/local-only image)
      if (isTempId) {
        await this.indexedDb.removePendingRequest(attachId);
      } else {
        await this.indexedDb.addPendingRequest({
          type: 'DELETE',
          endpoint: `/api/caspio-proxy${endpoint}`,
          method: 'DELETE',
          data: {},
          dependencies: [],
          status: 'pending',
          priority: 'normal',
        });
      }

      return true;
    }
  }

  // ============================================
  // TEMPLATE OPERATIONS
  // ============================================

  /**
   * Get all templates using current template config
   */
  async getTemplates(): Promise<any[]> {
    const config = this.templateConfigService.requiredConfig;
    return this.getTemplatesWithConfig(config);
  }

  /**
   * Get all templates with explicit config
   */
  async getTemplatesWithConfig(config: TemplateConfig): Promise<any[]> {
    const endpoint = `/tables/${config.templateTableName}/records?response=rows`;

    if (environment.isWeb) {
      const response = await this.fetchApi<CaspioResponse>(endpoint);
      return response.Result || [];
    } else {
      // Check cache first
      const cacheKey = this.getCacheType(config);
      const cached = await this.indexedDb.getCachedServiceData('global', cacheKey);
      if (cached && cached.length > 0) {
        return cached;
      }

      const response = await firstValueFrom(
        this.caspioService.get<CaspioResponse>(endpoint)
      );
      const templates = response.Result || [];

      // Cache templates
      await this.indexedDb.cacheServiceData('global', cacheKey, templates);
      return templates;
    }
  }

  /**
   * Get templates filtered by category
   */
  async getTemplatesByCategory(category: string): Promise<any[]> {
    const templates = await this.getTemplates();
    return templates.filter(t => t.Category === category);
  }

  // ============================================
  // DROPDOWN OPERATIONS
  // ============================================

  /**
   * Get dropdown options using current template config
   */
  async getDropdownOptions(): Promise<any[]> {
    const config = this.templateConfigService.requiredConfig;
    return this.getDropdownOptionsWithConfig(config);
  }

  /**
   * Get dropdown options with explicit config
   */
  async getDropdownOptionsWithConfig(config: TemplateConfig): Promise<any[]> {
    // Some templates use hardcoded dropdowns
    if (!config.features.dynamicDropdowns) {
      return [];
    }

    const endpoint = `/tables/${config.dropdownTableName}/records?response=rows`;

    try {
      let result: any[];
      if (environment.isWeb) {
        const response = await this.fetchApi<CaspioResponse>(endpoint);
        result = response.Result || [];
      } else {
        const response = await firstValueFrom(
          this.caspioService.get<CaspioResponse>(endpoint)
        );
        result = response.Result || [];
      }
      return result;
    } catch (error) {
      console.error(`[DataAdapter] Error loading dropdown options:`, error);
      return [];
    }
  }

  // ============================================
  // CATEGORY DETAIL OPERATIONS
  // ============================================

  /**
   * Get visuals for a service filtered by category with explicit config
   */
  async getVisualsForCategoryWithConfig(
    config: TemplateConfig,
    serviceId: string,
    category: string
  ): Promise<any[]> {
    // Get all visuals for service first
    const allVisuals = await this.getVisualsWithConfig(config, serviceId);
    // Filter by category
    return allVisuals.filter(v => v.Category === category);
  }

  /**
   * Get all attachments for a service (bulk load for category detail pages)
   */
  async getAllAttachmentsForServiceWithConfig(
    config: TemplateConfig,
    serviceId: string
  ): Promise<any[]> {
    // First get all visual IDs for this service
    const visuals = await this.getVisualsWithConfig(config, serviceId);
    const visualIds = visuals.map(v => v[config.idFieldName] || v.PK_ID).filter(Boolean);

    if (visualIds.length === 0) {
      return [];
    }

    // Build OR query for all visual IDs, order by AttachID for consistent photo order
    const idConditions = visualIds.map(id => `${config.idFieldName}=${id}`).join(' OR ');
    const endpoint = `/tables/${config.attachTableName}/records?q.where=${encodeURIComponent(idConditions)}&q.orderBy=AttachID`;

    if (environment.isWeb) {
      const response = await this.fetchApi<CaspioResponse>(endpoint);
      return response.Result || [];
    } else {
      // Check cache first
      const cached = await this.indexedDb.getCachedServiceData(serviceId, this.getAttachmentCacheType(config));
      if (cached && cached.length > 0) {
        return cached;
      }

      const response = await firstValueFrom(
        this.caspioService.get<CaspioResponse>(endpoint)
      );
      const attachments = response.Result || [];

      // Cache for offline use
      await this.indexedDb.cacheServiceData(serviceId, this.getAttachmentCacheType(config), attachments);
      return attachments;
    }
  }

  /**
   * Batch load attachments for multiple visual IDs
   * Returns a Map of visualId -> attachments[]
   */
  async getAttachmentsBatchWithConfig(
    config: TemplateConfig,
    visualIds: string[]
  ): Promise<Map<string, any[]>> {
    const result = new Map<string, any[]>();

    if (visualIds.length === 0) {
      return result;
    }

    // Build OR query for all visual IDs, order by AttachID for consistent photo order
    const idConditions = visualIds.map(id => `${config.idFieldName}=${id}`).join(' OR ');
    const endpoint = `/tables/${config.attachTableName}/records?q.where=${encodeURIComponent(idConditions)}&q.orderBy=AttachID`;

    let attachments: any[];
    if (environment.isWeb) {
      const response = await this.fetchApi<CaspioResponse>(endpoint);
      attachments = response.Result || [];
    } else {
      const response = await firstValueFrom(
        this.caspioService.get<CaspioResponse>(endpoint)
      );
      attachments = response.Result || [];
    }

    // Group attachments by visual ID (order is preserved since we sorted by AttachID)
    for (const attachment of attachments) {
      const visualId = String(attachment[config.idFieldName]);
      if (!result.has(visualId)) {
        result.set(visualId, []);
      }
      result.get(visualId)!.push(attachment);
    }

    // Initialize empty arrays for IDs with no attachments
    for (const id of visualIds) {
      if (!result.has(String(id))) {
        result.set(String(id), []);
      }
    }

    return result;
  }

  /**
   * Get dropdown options grouped by template ID for a specific category
   * Returns a Map of templateId -> options[]
   */
  async getDropdownOptionsForCategoryWithConfig(
    config: TemplateConfig,
    category: string
  ): Promise<Map<number, string[]>> {
    const result = new Map<number, string[]>();

    // Get templates for this category to know which template IDs we need
    const templates = await this.getTemplatesWithConfig(config);

    // Filter by category - try exact match first, then check if templates don't have Category field
    let categoryTemplates = templates.filter(t => t.Category === category);

    // If no matches and this is a single-category template (like HUD), use all templates
    // HUD uses route 'category/hud' but templates might not have a Category field
    if (categoryTemplates.length === 0 && !config.features.hasCategoriesHub) {
      categoryTemplates = templates;
    }

    // Extract template IDs - check multiple possible field names
    const templateIds = categoryTemplates.map(t => {
      return t.TemplateID || t.PK_ID || t[`${config.id.toUpperCase()}TemplateID`];
    }).filter(id => id !== undefined);

    if (!config.features.dynamicDropdowns || templateIds.length === 0) {
      return result;
    }

    // Get all dropdown options
    const allOptions = await this.getDropdownOptionsWithConfig(config);

    // All dropdown tables use TemplateID consistently
    // Group by template ID
    for (const option of allOptions) {
      const templateId = option.TemplateID;

      if (templateId && templateIds.includes(templateId)) {
        if (!result.has(templateId)) {
          result.set(templateId, []);
        }
        // Use 'Dropdown' field (EFE/HUD pattern) or 'DropdownValue' as fallback
        const dropdownValue = option.Dropdown || option.DropdownValue;
        if (dropdownValue && dropdownValue !== 'None' && dropdownValue !== 'Other') {
          const currentOptions = result.get(templateId)!;
          if (!currentOptions.includes(dropdownValue)) {
            currentOptions.push(dropdownValue);
          }
        }
      }
    }

    // Sort options alphabetically and add "None" and "Other" at the end
    result.forEach((options, templateId) => {
      options.sort((a, b) => a.localeCompare(b));
      if (!options.includes('None')) {
        options.push('None');
      }
      if (!options.includes('Other')) {
        options.push('Other');
      }
    });

    return result;
  }

  /**
   * Create a visual with category detail field mapping
   */
  async createCategoryVisualWithConfig(
    config: TemplateConfig,
    visualData: {
      serviceId: string;
      templateId: number;
      category: string;
      name: string;
      text: string;
      type: string;
      isSelected: boolean;
      answer?: string;
      notes?: string;
    }
  ): Promise<any> {
    // Map to database field names based on config
    const dbData: any = {
      ServiceID: visualData.serviceId,
      [config.templateIdFieldName]: visualData.templateId,
      Category: visualData.category,
      Name: visualData.name,
      Text: visualData.text,
      Kind: visualData.type, // "Comment", "Limitation", "Deficiency"
      IsSelected: visualData.isSelected ? 1 : 0,
    };

    if (visualData.answer !== undefined) {
      dbData.Answer = visualData.answer;
    }

    if (visualData.notes !== undefined) {
      dbData.Notes = visualData.notes;
    }

    return this.createVisualWithConfig(config, dbData);
  }

  /**
   * Get templates by category with explicit config
   */
  async getTemplatesByCategoryWithConfig(config: TemplateConfig, category: string): Promise<any[]> {
    const templates = await this.getTemplatesWithConfig(config);
    return templates.filter(t => t.Category === category);
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  /**
   * Fetch from API Gateway (webapp mode)
   */
  private async fetchApi<T = any>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    data?: any
  ): Promise<T> {
    const url = `${environment.apiGatewayUrl}/api/caspio-proxy${endpoint}`;

    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (data && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${errorText}`);
    }

    // DELETE often returns empty body
    if (method === 'DELETE') {
      return {} as T;
    }

    return response.json();
  }

  /**
   * Get the current template config
   */
  get currentConfig(): TemplateConfig | null {
    return this.templateConfigService.currentConfig;
  }

  /**
   * Check if we're in a valid template context
   */
  get isInTemplateContext(): boolean {
    return this.templateConfigService.isInTemplateContext;
  }
}
