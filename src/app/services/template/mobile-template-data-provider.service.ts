import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { db } from '../caspio-db';
import { IndexedDbService } from '../indexed-db.service';
import { BackgroundSyncService } from '../background-sync.service';
import { OfflineTemplateService } from '../offline-template.service';
import { TempIdService } from '../temp-id.service';
import { LocalImageService } from '../local-image.service';
import { TemplateConfig } from './template-config.interface';
import {
  ITemplateDataProvider,
  VisualRecord,
  AttachmentRecord,
  DataResult,
  SyncEvent
} from './template-data-provider.interface';

/**
 * MobileTemplateDataProvider - Dexie-first implementation for mobile
 *
 * Characteristics:
 * - All reads from Dexie (IndexedDB) first
 * - Writes go to Dexie + sync queue
 * - Background sync pushes to server
 * - Reactive updates via sync events
 * - Proper temp ID handling for offline creates
 */
@Injectable()
export class MobileTemplateDataProvider extends ITemplateDataProvider {

  private syncComplete$ = new Subject<SyncEvent>();

  constructor(
    private indexedDb: IndexedDbService,
    private backgroundSync: BackgroundSyncService,
    private offlineTemplate: OfflineTemplateService,
    private tempIdService: TempIdService,
    private localImageService: LocalImageService
  ) {
    super();
    this.subscribeToSyncEvents();
  }

  private subscribeToSyncEvents(): void {
    // Subscribe to visual sync events
    this.backgroundSync.visualSyncComplete$.subscribe(e => {
      this.syncComplete$.next({ serviceId: e.serviceId, reason: 'visual_sync' });
    });

    // Subscribe to HUD sync events
    this.backgroundSync.hudSyncComplete$.subscribe(e => {
      this.syncComplete$.next({ serviceId: e.serviceId, reason: 'hud_sync' });
    });

    // Subscribe to LBW sync events
    this.backgroundSync.lbwSyncComplete$.subscribe(e => {
      this.syncComplete$.next({ serviceId: e.serviceId, reason: 'lbw_sync' });
    });
  }

  // ==================== Visual Operations ====================

  async getVisuals(config: TemplateConfig, serviceId: string): Promise<DataResult<VisualRecord[]>> {
    let records: any[] = [];
    let hasPending = false;

    // Load from template-specific sources
    switch (config.id) {
      case 'efe':
        // Use visualFields table for EFE
        if (config.features.offlineFirst) {
          const fields = await db.visualFields
            .where('serviceId')
            .equals(serviceId)
            .toArray();
          records = fields.map(f => this.mapFieldToVisualRecord(f));
          hasPending = fields.some(f => !!f.tempVisualId && !f.visualId);
        } else {
          records = await this.offlineTemplate.getVisualsByService(serviceId);
          records = records.map(r => this.mapToVisualRecord(config, r));
        }
        break;

      case 'hud':
        // Use hudFields table for HUD
        if (config.features.offlineFirst) {
          const fields = await db.hudFields
            .where('serviceId')
            .equals(serviceId)
            .toArray();
          records = fields.map(f => this.mapHudFieldToVisualRecord(f));
          hasPending = fields.some(f => !!f.tempHudId && !f.hudId);
        } else {
          records = await this.offlineTemplate.getHudByService(serviceId);
          records = records.map(r => this.mapToVisualRecord(config, r));
        }
        break;

      case 'lbw':
        records = await this.offlineTemplate.getLbwByService(serviceId);
        records = records.map(r => this.mapToVisualRecord(config, r));
        break;

      case 'dte':
        const cached = await this.indexedDb.getCachedServiceData(serviceId, 'visuals');
        records = (cached || []).map(r => this.mapToVisualRecord(config, r));
        break;
    }

    return {
      data: records,
      isFromCache: true,
      hasPendingSync: hasPending
    };
  }

  async getVisualById(config: TemplateConfig, visualId: string): Promise<VisualRecord | null> {
    // Check template-specific tables first
    if (config.features.offlineFirst) {
      if (config.id === 'efe') {
        const fields = await db.visualFields
          .filter(f => f.visualId === visualId || f.tempVisualId === visualId)
          .toArray();

        if (fields.length > 0) {
          return this.mapFieldToVisualRecord(fields[0]);
        }
      } else if (config.id === 'hud') {
        const fields = await db.hudFields
          .filter(f => f.hudId === visualId || f.tempHudId === visualId)
          .toArray();

        if (fields.length > 0) {
          return this.mapHudFieldToVisualRecord(fields[0]);
        }
      }
    }

    return null;
  }

  async getVisualsForCategory(
    config: TemplateConfig,
    serviceId: string,
    category: string
  ): Promise<DataResult<VisualRecord[]>> {
    // Use VisualFields table for offlineFirst templates
    if (config.features.offlineFirst && config.id === 'efe') {
      const fields = await db.visualFields
        .where('[serviceId+category]')
        .equals([serviceId, category])
        .toArray();

      const hasPending = fields.some(f => !!f.tempVisualId && !f.visualId);

      return {
        data: fields.map(f => this.mapFieldToVisualRecord(f)),
        isFromCache: true,
        hasPendingSync: hasPending
      };
    }

    // Fallback for non-offlineFirst templates
    const allResult = await this.getVisuals(config, serviceId);
    return {
      data: allResult.data.filter(v => v.category === category),
      isFromCache: allResult.isFromCache,
      hasPendingSync: allResult.hasPendingSync
    };
  }

  async createVisual(config: TemplateConfig, visual: Partial<VisualRecord>): Promise<VisualRecord> {
    const tempId = this.tempIdService.generateTempId(config.id);

    const record: VisualRecord = {
      id: tempId,
      templateId: visual.templateId || 0,
      serviceId: visual.serviceId || '',
      category: visual.category || '',
      name: visual.name || '',
      text: visual.text || '',
      kind: visual.kind || 'Comment',
      isSelected: visual.isSelected ?? true,
      answer: visual.answer,
      notes: visual.notes,
      _tempId: tempId,
      _localOnly: true,
      _syncing: true
    };

    // Queue for background sync
    const dbData = this.mapFromVisualRecord(config, record);
    const endpoint = `/tables/${config.tableName}/records?response=rows`;
    await this.indexedDb.addPendingRequest({
      type: 'CREATE',
      tempId: tempId,
      endpoint: `/api/caspio-proxy${endpoint}`,
      method: 'POST',
      data: dbData,
      dependencies: [],
      status: 'pending',
      priority: 'high',
      serviceId: record.serviceId
    });

    console.log('[MobileDataProvider] Created visual with temp ID:', tempId);
    return record;
  }

  async updateVisual(
    config: TemplateConfig,
    visualId: string,
    updates: Partial<VisualRecord>,
    serviceId?: string
  ): Promise<VisualRecord> {
    const isTempId = visualId.startsWith('temp_');
    const dbData = this.mapFromVisualRecord(config, updates);

    if (isTempId) {
      // Update the pending request data
      await this.indexedDb.updatePendingRequestData(visualId, dbData);
    } else {
      // Queue update for background sync
      const endpoint = `/tables/${config.tableName}/records?q.where=${config.idFieldName}=${visualId}`;
      await this.indexedDb.addPendingRequest({
        type: 'UPDATE',
        endpoint: `/api/caspio-proxy${endpoint}`,
        method: 'PUT',
        data: dbData,
        dependencies: [],
        status: 'pending',
        priority: 'normal',
        serviceId: serviceId
      });
    }

    return { id: visualId, ...updates } as VisualRecord;
  }

  async deleteVisual(config: TemplateConfig, visualId: string, serviceId?: string): Promise<boolean> {
    const isTempId = visualId.startsWith('temp_');

    if (isTempId) {
      // Just remove from pending queue
      await this.indexedDb.removePendingRequest(visualId);
    } else {
      // Queue delete for sync
      const endpoint = `/tables/${config.tableName}/records?q.where=${config.idFieldName}=${visualId}`;
      await this.indexedDb.addPendingRequest({
        type: 'DELETE',
        endpoint: `/api/caspio-proxy${endpoint}`,
        method: 'DELETE',
        data: {},
        dependencies: [],
        status: 'pending',
        priority: 'normal',
        serviceId: serviceId
      });
    }

    return true;
  }

  // ==================== Attachment Operations ====================

  async getAttachments(config: TemplateConfig, visualId: string): Promise<AttachmentRecord[]> {
    // Get from LocalImages table (Dexie)
    const localImages = await this.localImageService.getImagesForEntity(
      config.entityType as any,
      visualId
    );

    return localImages.map(img => this.mapLocalImageToAttachment(img));
  }

  async getAttachmentsForService(
    config: TemplateConfig,
    serviceId: string
  ): Promise<Map<string, AttachmentRecord[]>> {
    // Get all local images for this service
    const localImages = await db.localImages
      .where('serviceId')
      .equals(serviceId)
      .toArray();

    const attachmentMap = new Map<string, AttachmentRecord[]>();
    for (const img of localImages) {
      if (!img.entityId) continue;

      if (!attachmentMap.has(img.entityId)) {
        attachmentMap.set(img.entityId, []);
      }
      attachmentMap.get(img.entityId)!.push(this.mapLocalImageToAttachment(img));
    }

    return attachmentMap;
  }

  async createAttachment(config: TemplateConfig, attachment: Partial<AttachmentRecord>): Promise<AttachmentRecord> {
    // On mobile, attachments are created through LocalImageService camera/gallery flow
    // This method is a placeholder - the actual implementation uses PhotoHandlerService
    throw new Error('Use PhotoHandlerService for mobile attachment creation');
  }

  async updateAttachment(
    config: TemplateConfig,
    attachId: string,
    updates: Partial<AttachmentRecord>
  ): Promise<AttachmentRecord> {
    // Update LocalImage record
    const updateData: any = {};
    if (updates.caption !== undefined) updateData.caption = updates.caption;
    if (updates.drawings !== undefined) updateData.drawings = updates.drawings;

    await db.localImages
      .where('imageId')
      .equals(attachId)
      .modify(updateData);

    return { attachId, ...updates } as AttachmentRecord;
  }

  async deleteAttachment(config: TemplateConfig, attachId: string): Promise<boolean> {
    // Delete from local images table
    await db.localImages.where('imageId').equals(attachId).delete();
    return true;
  }

  // ==================== Template Operations ====================

  async getTemplates(config: TemplateConfig): Promise<any[]> {
    let templates: any[] = [];

    switch (config.id) {
      case 'hud':
        templates = await this.offlineTemplate.ensureHudTemplatesReady();
        break;
      case 'efe':
        // EFE uses shared visual templates table, filter by TypeID=1
        templates = await this.offlineTemplate.ensureVisualTemplatesReady();
        templates = templates.filter((t: any) => t.TypeID === 1);
        break;
      case 'lbw':
        templates = await this.offlineTemplate.getLbwTemplates();
        break;
      case 'dte':
        templates = await this.indexedDb.getCachedTemplates('dte') || [];
        break;
      default:
        templates = [];
    }

    return templates;
  }

  async getTemplatesForCategory(config: TemplateConfig, category: string): Promise<any[]> {
    const templates = await this.getTemplates(config);
    return templates.filter(t => t.Category === category);
  }

  async getDropdownOptions(config: TemplateConfig): Promise<Map<number, string[]>> {
    if (!config.features.dynamicDropdowns) {
      return new Map();
    }

    // Get from cached dropdown data
    const cacheKey = `${config.id}_dropdown` as any;
    const cached = await this.indexedDb.getCachedTemplates(cacheKey) || [];

    const optionsMap = new Map<number, string[]>();
    for (const option of cached) {
      const templateId = option.TemplateID ||
                         option[`${config.id.toUpperCase()}TemplateID`] ||
                         option.HUDTemplateID ||
                         option.VisualTemplateID;

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

  // ==================== Service Operations ====================

  async getService(serviceId: string): Promise<any> {
    return this.offlineTemplate.getService(serviceId);
  }

  async updateService(serviceId: string, updates: any): Promise<void> {
    await this.offlineTemplate.updateService(serviceId, updates);
  }

  // ==================== Sync Operations ====================

  onSyncComplete(): Observable<SyncEvent> {
    return this.syncComplete$.asObservable();
  }

  async hasPendingChanges(serviceId: string): Promise<boolean> {
    const pending = await this.indexedDb.getPendingRequests();
    return pending.some((p: any) => p.serviceId === serviceId && p.status === 'pending');
  }

  async forceSyncNow(): Promise<void> {
    // Trigger background sync - the backgroundSync service handles this internally
    // No direct method available, sync runs automatically
    console.log('[MobileDataProvider] forceSyncNow called - sync runs automatically');
  }

  // ==================== Cache Operations ====================

  async refreshCache(config: TemplateConfig, serviceId: string): Promise<void> {
    // Cache refresh is handled by OfflineTemplateService download methods
    console.log('[MobileDataProvider] refreshCache called for service:', serviceId);
  }

  async clearCache(config: TemplateConfig, serviceId?: string): Promise<void> {
    // Clear cache for the specific template type
    if (serviceId && config.id === 'efe') {
      await this.indexedDb.clearCachedServiceData(serviceId, 'visuals');
    }
    console.log('[MobileDataProvider] clearCache called');
  }

  // ==================== Private Helpers ====================

  private mapToVisualRecord(config: TemplateConfig, record: any): VisualRecord {
    return {
      id: String(record[config.idFieldName] || record.PK_ID || record._tempId),
      templateId: record[config.templateIdFieldName] || record.TemplateID || 0,
      serviceId: String(record.ServiceID || record.serviceId),
      category: record.Category || record.category || '',
      name: record.Name || record.name || '',
      text: record.Text || record.text || '',
      kind: record.Kind || record.kind || 'Comment',
      isSelected: record.Notes !== 'HIDDEN' && record.isSelected !== false,
      answer: record.Answers || record.Answer || record.answer || '',
      notes: record.Notes || record.notes || '',
      _tempId: record._tempId,
      _localOnly: record._localOnly,
      _syncing: record._syncing
    };
  }

  private mapFieldToVisualRecord(field: any): VisualRecord {
    return {
      id: String(field.visualId || field.tempVisualId || field.templateId),
      templateId: field.templateId,
      serviceId: field.serviceId,
      category: field.category,
      name: field.templateName || '',
      text: field.answer || field.templateText || '',
      kind: field.kind as any || 'Comment',
      isSelected: field.isSelected,
      answer: field.answer || '',
      _tempId: field.tempVisualId || undefined,
      _localOnly: !!field.tempVisualId && !field.visualId
    };
  }

  private mapHudFieldToVisualRecord(field: any): VisualRecord {
    return {
      id: String(field.hudId || field.tempHudId || field.templateId),
      templateId: field.templateId,
      serviceId: field.serviceId,
      category: field.category,
      name: field.templateName || '',
      text: field.answer || field.templateText || '',
      kind: field.kind as any || 'Comment',
      isSelected: field.isSelected,
      answer: field.answer || '',
      _tempId: field.tempHudId || undefined,
      _localOnly: !!field.tempHudId && !field.hudId
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

  private mapLocalImageToAttachment(img: any): AttachmentRecord {
    return {
      attachId: img.attachId || img.imageId,
      visualId: img.entityId,
      fileName: img.fileName || '',
      caption: img.caption || '',
      drawings: img.drawings,
      displayUrl: img.localPath || img.thumbnailPath || '',
      isLocal: !img.isSynced,
      isSynced: img.isSynced || false
    };
  }
}
