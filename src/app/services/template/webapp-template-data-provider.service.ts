import { Injectable } from '@angular/core';
import { Observable, EMPTY, firstValueFrom } from 'rxjs';
import { TemplateConfig } from './template-config.interface';
import { ApiGatewayService } from '../api-gateway.service';
import {
  ITemplateDataProvider,
  VisualRecord,
  AttachmentRecord,
  DataResult,
  SyncEvent
} from './template-data-provider.interface';

/**
 * WebappTemplateDataProvider - Direct API implementation for webapp
 *
 * Characteristics:
 * - All operations go directly to API Gateway
 * - No local caching (IndexedDB not used)
 * - No sync management (changes are immediate)
 * - Stateless - each request is independent
 * - Sync/cache operations are no-ops
 */
@Injectable()
export class WebappTemplateDataProvider extends ITemplateDataProvider {

  constructor(private apiGateway: ApiGatewayService) {
    super();
  }

  // ==================== Visual Operations ====================

  async getVisuals(config: TemplateConfig, serviceId: string): Promise<DataResult<VisualRecord[]>> {
    const endpoint = `/tables/${config.tableName}/records?q.where=ServiceID=${serviceId}&q.limit=1000`;
    const result = await this.fetchApi<any>(endpoint);
    const records = (result.Result || []).map((r: any) => this.mapToVisualRecord(config, r));

    return {
      data: records,
      isFromCache: false,
      hasPendingSync: false
    };
  }

  async getVisualById(config: TemplateConfig, visualId: string): Promise<VisualRecord | null> {
    const endpoint = `/tables/${config.tableName}/records?q.where=${config.idFieldName}=${visualId}`;
    const result = await this.fetchApi<any>(endpoint);
    const record = result.Result?.[0];
    return record ? this.mapToVisualRecord(config, record) : null;
  }

  async getVisualsForCategory(
    config: TemplateConfig,
    serviceId: string,
    category: string
  ): Promise<DataResult<VisualRecord[]>> {
    const allResult = await this.getVisuals(config, serviceId);
    return {
      data: allResult.data.filter(v => v.category === category),
      isFromCache: false,
      hasPendingSync: false
    };
  }

  async createVisual(config: TemplateConfig, visual: Partial<VisualRecord>): Promise<VisualRecord> {
    const endpoint = `/tables/${config.tableName}/records?response=rows`;
    const dbData = this.mapFromVisualRecord(config, visual);

    const result = await this.fetchApi<any>(endpoint, 'POST', dbData);

    const created = result.Result?.[0] || result;
    return this.mapToVisualRecord(config, { ...dbData, ...created });
  }

  async updateVisual(
    config: TemplateConfig,
    visualId: string,
    updates: Partial<VisualRecord>,
    serviceId?: string
  ): Promise<VisualRecord> {
    const endpoint = `/tables/${config.tableName}/records?q.where=${config.idFieldName}=${visualId}`;
    const dbData = this.mapFromVisualRecord(config, updates);

    await this.fetchApi(endpoint, 'PUT', dbData);
    return { id: visualId, ...updates } as VisualRecord;
  }

  async deleteVisual(config: TemplateConfig, visualId: string, serviceId?: string): Promise<boolean> {
    const endpoint = `/tables/${config.tableName}/records?q.where=${config.idFieldName}=${visualId}`;
    await this.fetchApi(endpoint, 'DELETE');
    return true;
  }

  // ==================== Attachment Operations ====================

  async getAttachments(config: TemplateConfig, visualId: string): Promise<AttachmentRecord[]> {
    // Order by AttachID to maintain consistent photo order regardless of modifications
    const endpoint = `/tables/${config.attachTableName}/records?q.where=${config.idFieldName}=${visualId}&q.orderBy=AttachID`;
    const result = await this.fetchApi<any>(endpoint);
    return (result.Result || []).map((r: any) => this.mapToAttachmentRecord(config, r));
  }

  async getAttachmentsForService(
    config: TemplateConfig,
    serviceId: string
  ): Promise<Map<string, AttachmentRecord[]>> {
    // First get all visual IDs for this service
    const visualsResult = await this.getVisuals(config, serviceId);
    const visualIds = visualsResult.data.map(v => v.id);

    if (visualIds.length === 0) {
      return new Map();
    }

    // Build OR query for batch loading, order by AttachID to maintain consistent photo order
    const idConditions = visualIds.map(id => `${config.idFieldName}=${id}`).join(' OR ');
    const endpoint = `/tables/${config.attachTableName}/records?q.where=${encodeURIComponent(idConditions)}&q.orderBy=AttachID&q.limit=1000`;

    try {
      const result = await this.fetchApi<any>(endpoint);

      // Group by visual ID
      const attachmentMap = new Map<string, AttachmentRecord[]>();
      for (const record of (result.Result || [])) {
        const visualId = String(record[config.idFieldName]);
        if (!attachmentMap.has(visualId)) {
          attachmentMap.set(visualId, []);
        }
        attachmentMap.get(visualId)!.push(this.mapToAttachmentRecord(config, record));
      }

      return attachmentMap;
    } catch (error) {
      console.error('[WebappDataProvider] Error loading attachments:', error);
      return new Map();
    }
  }

  async createAttachment(config: TemplateConfig, attachment: Partial<AttachmentRecord>): Promise<AttachmentRecord> {
    const endpoint = `/tables/${config.attachTableName}/records?response=rows`;
    const result = await this.fetchApi<any>(endpoint, 'POST', attachment);
    const created = result.Result?.[0] || result;
    return this.mapToAttachmentRecord(config, { ...attachment, ...created });
  }

  async updateAttachment(
    config: TemplateConfig,
    attachId: string,
    updates: Partial<AttachmentRecord>
  ): Promise<AttachmentRecord> {
    const endpoint = `/tables/${config.attachTableName}/records?q.where=AttachID=${attachId}`;
    const dbData: any = {};
    if (updates.caption !== undefined) dbData.Annotation = updates.caption;
    if (updates.drawings !== undefined) dbData.Drawings = updates.drawings;

    await this.fetchApi(endpoint, 'PUT', dbData);
    return { attachId, ...updates } as AttachmentRecord;
  }

  async deleteAttachment(config: TemplateConfig, attachId: string): Promise<boolean> {
    const endpoint = `/tables/${config.attachTableName}/records?q.where=AttachID=${attachId}`;
    await this.fetchApi(endpoint, 'DELETE');
    return true;
  }

  // ==================== Template Operations ====================

  async getTemplates(config: TemplateConfig): Promise<any[]> {
    const endpoint = `/tables/${config.templateTableName}/records?q.limit=1000`;
    const result = await this.fetchApi<any>(endpoint);
    let templates = result.Result || [];

    // EFE uses shared visual templates table, filter by TypeID=1
    // Handle both number and string TypeID (API may return either)
    if (config.id === 'efe') {
      templates = templates.filter((t: any) => t.TypeID === 1 || t.TypeID === '1' || Number(t.TypeID) === 1);
    }

    return templates;
  }

  async getTemplatesForCategory(config: TemplateConfig, category: string): Promise<any[]> {
    const templates = await this.getTemplates(config);
    return templates.filter(t => t.Category === category);
  }

  async getDropdownOptions(config: TemplateConfig): Promise<Map<number, string[]>> {
    if (!config.features.dynamicDropdowns || !config.dropdownTableName) {
      return new Map();
    }

    const endpoint = `/tables/${config.dropdownTableName}/records?q.limit=1000`;
    const result = await this.fetchApi<any>(endpoint);

    const optionsMap = new Map<number, string[]>();
    for (const option of (result.Result || [])) {
      // All dropdown tables use TemplateID consistently
      const templateId = option.TemplateID;

      if (templateId) {
        if (!optionsMap.has(templateId)) {
          optionsMap.set(templateId, []);
        }
        const value = option.Dropdown || option.DropdownValue;
        if (value && value !== 'None' && value !== 'Other') {
          optionsMap.get(templateId)!.push(value);
        }
      }
    }

    return optionsMap;
  }

  // ==================== Raw Visual Operations ====================

  async getRawVisuals(config: TemplateConfig, serviceId: string): Promise<any[]> {
    const endpoint = `/tables/${config.tableName}/records?q.where=ServiceID=${serviceId}&q.limit=1000`;
    const result = await this.fetchApi<any>(endpoint);
    return result.Result || [];
  }

  // ==================== Service Operations ====================

  async getService(serviceId: string): Promise<any> {
    const endpoint = `/tables/LPS_Services/records?q.where=PK_ID=${serviceId}`;
    const result = await this.fetchApi<any>(endpoint);
    return result.Result?.[0] || null;
  }

  async updateService(serviceId: string, updates: any): Promise<void> {
    const endpoint = `/tables/LPS_Services/records?q.where=PK_ID=${serviceId}`;
    await this.fetchApi(endpoint, 'PUT', updates);
  }

  // ==================== Sync Operations (No-op for webapp) ====================

  onSyncComplete(): Observable<SyncEvent> {
    return EMPTY; // Webapp doesn't have sync events
  }

  async hasPendingChanges(serviceId: string): Promise<boolean> {
    return false; // Webapp changes are immediate
  }

  async forceSyncNow(): Promise<void> {
    // No-op for webapp
  }

  // ==================== Cache Operations (No-op for webapp) ====================

  async refreshCache(config: TemplateConfig, serviceId: string): Promise<void> {
    // No-op for webapp - no cache to refresh
  }

  async clearCache(config: TemplateConfig, serviceId?: string): Promise<void> {
    // No-op for webapp - no cache to clear
  }

  // ==================== Private Helpers ====================

  private async fetchApi<T = any>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    data?: any
  ): Promise<T> {
    const proxyEndpoint = `/api/caspio-proxy${endpoint}`;

    switch (method) {
      case 'GET':
        return firstValueFrom(this.apiGateway.get<T>(proxyEndpoint));
      case 'POST':
        return firstValueFrom(this.apiGateway.post<T>(proxyEndpoint, data));
      case 'PUT':
        return firstValueFrom(this.apiGateway.put<T>(proxyEndpoint, data));
      case 'DELETE':
        await firstValueFrom(this.apiGateway.delete<T>(proxyEndpoint));
        return {} as T;
      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  }

  private mapToVisualRecord(config: TemplateConfig, record: any): VisualRecord {
    return {
      id: String(record[config.idFieldName] || record.PK_ID),
      templateId: record[config.templateIdFieldName] || 0,
      serviceId: String(record.ServiceID),
      category: record.Category || '',
      name: record.Name || '',
      text: record.Text || '',
      kind: record.Kind || 'Comment',
      isSelected: record.Notes !== 'HIDDEN',
      answer: record.Answers || record.Answer || '',
      notes: record.Notes || ''
    };
  }

  private mapFromVisualRecord(config: TemplateConfig, record: Partial<VisualRecord>): any {
    const dbRecord: any = {};
    if (record.serviceId !== undefined) dbRecord.ServiceID = parseInt(String(record.serviceId), 10);
    if (record.templateId !== undefined) dbRecord[config.templateIdFieldName] = record.templateId;
    if (record.category !== undefined) dbRecord.Category = record.category;
    if (record.name !== undefined) dbRecord.Name = record.name;
    if (record.text !== undefined) dbRecord.Text = record.text;
    if (record.kind !== undefined) dbRecord.Kind = record.kind;
    if (record.answer !== undefined) dbRecord.Answers = record.answer;
    if (record.notes !== undefined) dbRecord.Notes = record.notes;
    return dbRecord;
  }

  private mapToAttachmentRecord(config: TemplateConfig, record: any): AttachmentRecord {
    return {
      attachId: String(record.AttachID || record.PK_ID),
      visualId: String(record[config.idFieldName] || record.VisualID || record.HUDID || record.LBWID || record.DTEID),
      fileName: record.FileName || '',
      caption: record.Annotation || record.Caption || '',
      drawings: record.Drawings,
      displayUrl: record.FilePath || '',
      isLocal: false,
      isSynced: true
    };
  }
}
