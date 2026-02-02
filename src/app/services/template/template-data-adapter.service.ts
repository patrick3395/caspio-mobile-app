import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CaspioService } from '../caspio.service';
import { IndexedDbService, CacheDataType } from '../indexed-db.service';
import { TempIdService } from '../temp-id.service';
import { TemplateConfig, TemplateType } from './template-config.interface';
import { TemplateConfigService } from './template-config.service';
import { environment } from '../../../environments/environment';

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
    private templateConfigService: TemplateConfigService
  ) {}

  /**
   * Convert config cache key to IndexedDB CacheDataType
   */
  private getCacheType(config: TemplateConfig): CacheDataType {
    return this.getCacheType(config) as CacheDataType;
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
    const endpoint = `/tables/${config.tableName}/records?q.where=${config.idFieldName}=${visualId}`;

    if (environment.isWeb) {
      // Webapp: Direct API call
      await this.fetchApi(endpoint, 'PUT', visualData);
      return { success: true, [config.idFieldName]: visualId, ...visualData };
    } else {
      // Mobile: Offline-first
      const isTempId = String(visualId).startsWith('temp_');

      if (isTempId) {
        // Update pending request
        await this.indexedDb.updatePendingRequestData(visualId, visualData);
      } else {
        // Queue update for sync
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy${endpoint}`,
          method: 'PUT',
          data: visualData,
          dependencies: [],
          status: 'pending',
          priority: 'normal',
        });
      }

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
    const endpoint = `/tables/${config.attachTableName}/records?q.where=${config.idFieldName}=${visualId}`;

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

      if (isTempId) {
        await this.indexedDb.updatePendingRequestData(attachId, attachmentData);
      } else {
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy${endpoint}`,
          method: 'PUT',
          data: attachmentData,
          dependencies: [],
          status: 'pending',
          priority: 'normal',
        });
      }

      return { success: true, AttachID: attachId, ...attachmentData };
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
      const isTempId = String(attachId).startsWith('temp_');

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
      console.log(`[DataAdapter] Template ${config.id} uses hardcoded dropdowns`);
      return [];
    }

    const endpoint = `/tables/${config.dropdownTableName}/records?response=rows`;

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
