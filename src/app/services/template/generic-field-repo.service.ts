import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Table } from 'dexie';
import { db, VisualField, HudField, LbwField, DteField, CsaField } from '../caspio-db';
import { ServiceMetadataService } from '../service-metadata.service';
import { TemplateConfig } from './template-config.interface';

/**
 * Common field interface that both VisualField and HudField satisfy
 * Used for type-safe generic operations
 */
export interface GenericField {
  id?: number;
  key: string;
  serviceId: string;
  category: string;
  templateId: number;
  templateName: string;
  templateText: string;
  kind: 'Comment' | 'Limitation' | 'Deficiency';
  answerType: number;
  dropdownOptions?: string[];
  isSelected: boolean;
  answer: string;
  otherValue: string;
  photoCount: number;
  rev: number;
  updatedAt: number;
  dirty: boolean;
  // Generic ID fields - actual property depends on template
  recordId: string | null;
  tempRecordId: string | null;
}

/**
 * GenericFieldRepoService - Unified repository for all template field types
 *
 * This service provides a single interface for Dexie-first field operations
 * across all templates (EFE, HUD, LBW, DTE). The underlying Dexie table and
 * field mappings are determined by the TemplateConfig.
 *
 * Benefits:
 * - Single code path for all templates
 * - Consistent Dexie-first behavior
 * - Easy to add new templates
 */
@Injectable({
  providedIn: 'root'
})
export class GenericFieldRepoService {

  constructor(private serviceMetadata: ServiceMetadataService) {}

  // ============================================================================
  // SEEDING - Initialize fields from templates
  // ============================================================================

  async seedFromTemplates(
    config: TemplateConfig,
    serviceId: string,
    category: string,
    templates: any[],
    dropdownData?: any[]
  ): Promise<void> {
    console.log(`[GenericFieldRepo] Seeding ${templates.length} templates for ${config.id}/${category}`);

    // Debug: Show what categories exist in the templates
    if (templates.length > 0) {
      const allCategories = [...new Set(templates.map(t => t.Category))];
      console.log(`[GenericFieldRepo] Available categories in templates: ${JSON.stringify(allCategories)}`);
      const typeIds = [...new Set(templates.map(t => t.TypeID))];
      console.log(`[GenericFieldRepo] Available TypeIDs in templates: ${JSON.stringify(typeIds)}`);
    }

    // Filter templates for this category
    // HUD has no categories hub - show ALL TypeID=1 templates for the single category page
    // Other templates with categories hubs filter by category name
    const hasCategoriesHub = config.features.hasCategoriesHub;
    const categoryLower = category?.toLowerCase() || '';

    const categoryTemplates = templates.filter(t => {
      // HUD has no categories hub - show ALL templates on the single page (no filtering)
      if (config.id === 'hud' && !hasCategoriesHub) {
        return true; // Include all HUD templates
      }

      // For EFE, require TypeID === 1 (checklist items) AND category match
      // Handle both number and string TypeID (API may return either)
      if (config.id === 'efe') {
        const typeMatch = t.TypeID === 1 || t.TypeID === '1' || Number(t.TypeID) === 1;
        const templateCategory = (t.Category || '').toLowerCase();
        return typeMatch && templateCategory === categoryLower;
      }

      // LBW, DTE - filter by category only (case-insensitive)
      const templateCategory = (t.Category || '').toLowerCase();
      return templateCategory === categoryLower;
    });

    console.log(`[GenericFieldRepo] Found ${categoryTemplates.length} templates for category "${category}" (template type: ${config.id})`);


    if (categoryTemplates.length === 0) {
      console.log('[GenericFieldRepo] No templates to seed for this category');
      return;
    }

    // Build dropdown options map
    const dropdownOptionsMap: { [templateId: number]: string[] } = {};
    if (dropdownData && dropdownData.length > 0) {
      dropdownData.forEach((row: any) => {
        const templateId = row.TemplateID;
        const dropdownValue = row.Dropdown;
        if (templateId && dropdownValue) {
          if (!dropdownOptionsMap[templateId]) {
            dropdownOptionsMap[templateId] = [];
          }
          if (!dropdownOptionsMap[templateId].includes(dropdownValue)) {
            dropdownOptionsMap[templateId].push(dropdownValue);
          }
        }
      });
      Object.keys(dropdownOptionsMap).forEach(templateId => {
        const options = dropdownOptionsMap[Number(templateId)];
        if (options && !options.includes('Other')) {
          options.push('Other');
        }
      });
    }

    // Get the appropriate table
    const table = this.getTable(config);

    // Check existing fields
    const existingKeys = new Set<string>();
    const existingFields = await table
      .where('[serviceId+category]')
      .equals([serviceId, category])
      .toArray();

    existingFields.forEach((f: any) => existingKeys.add(f.key));

    // Build new fields
    const newFields: any[] = [];
    const now = Date.now();

    for (const template of categoryTemplates) {
      const effectiveTemplateId = template.TemplateID || template.PK_ID;
      const key = `${serviceId}:${category}:${effectiveTemplateId}`;

      if (existingKeys.has(key)) continue;

      let dropdownOptions: string[] | undefined;
      if (template.AnswerType === 2) {
        if (dropdownOptionsMap[effectiveTemplateId]) {
          dropdownOptions = dropdownOptionsMap[effectiveTemplateId];
        } else if (template.DropdownOptions) {
          try {
            dropdownOptions = JSON.parse(template.DropdownOptions);
          } catch (e) {
            dropdownOptions = [];
          }
        }
      }

      // Create field with template-specific ID property names
      const field = this.createField(config, {
        key,
        serviceId,
        category,
        templateId: effectiveTemplateId,
        templateName: template.Name || 'Unnamed Item',
        templateText: template.Text || '',
        kind: (template.Kind || 'Comment') as 'Comment' | 'Limitation' | 'Deficiency',
        answerType: template.AnswerType || 0,
        dropdownOptions,
        isSelected: false,
        answer: '',
        otherValue: '',
        photoCount: 0,
        rev: 0,
        updatedAt: now,
        dirty: false
      });

      newFields.push(field);
    }

    const skippedCount = categoryTemplates.length - newFields.length;
    console.log(`[GenericFieldRepo] Creating ${newFields.length} new fields (${skippedCount} already exist)`);

    if (newFields.length > 0) {
      await db.transaction('rw', table, async () => {
        await table.bulkAdd(newFields);
      });
      console.log(`[GenericFieldRepo] ✅ Successfully seeded ${newFields.length} new fields to ${config.id}Fields table`);
    } else {
      console.log(`[GenericFieldRepo] No new fields to seed (all ${categoryTemplates.length} templates already have fields)`);
    }
  }

  async mergeExistingRecords(
    config: TemplateConfig,
    serviceId: string,
    category: string,
    records: any[]
  ): Promise<void> {
    const idFieldName = config.idFieldName; // 'VisualID', 'HUDID', etc.
    const hasCategoriesHub = config.features.hasCategoriesHub;

    // HUD has no categories hub - merge ALL records (templates have different Category than saved records)
    // Other templates filter by category
    const categoryRecords = (config.id === 'hud' && !hasCategoriesHub)
      ? records
      : records.filter(r => r.Category === category);

    if (categoryRecords.length === 0) return;

    console.log(`[GenericFieldRepo] Merging ${categoryRecords.length} existing records for ${config.id}/${category}`);

    const table = this.getTable(config);
    const now = Date.now();

    const existingFields = await table
      .where('[serviceId+category]')
      .equals([serviceId, category])
      .toArray();

    // Build matching maps
    const fieldsByNameAndText = new Map<string, any>();
    const fieldsByText = new Map<string, any>();
    const fieldsByName = new Map<string, any>();

    for (const field of existingFields) {
      const name = (field.templateName || '').toLowerCase().trim();
      const text = (field.templateText || '').toLowerCase().trim();
      if (name && text) fieldsByNameAndText.set(`${name}|${text}`, field);
      if (text) fieldsByText.set(text, field);
      if (name) fieldsByName.set(name, field);
    }

    await db.transaction('rw', table, async () => {
      for (const record of categoryRecords) {
        const recordId = record[idFieldName] || record.PK_ID || null;
        const recordName = (record.Name || '').trim();
        const recordText = (record.Text || '').trim();
        const nameLower = recordName.toLowerCase();
        const textLower = recordText.toLowerCase();

        let matchingField: any;
        if (nameLower && textLower) {
          matchingField = fieldsByNameAndText.get(`${nameLower}|${textLower}`);
        }
        if (!matchingField && textLower) {
          matchingField = fieldsByText.get(textLower);
        }
        if (!matchingField && nameLower) {
          matchingField = fieldsByName.get(nameLower);
        }

        if (matchingField) {
          const updates = this.createUpdateWithRecordId(config, {
            isSelected: true,
            answer: recordText || record.Answers || '',
            otherValue: record.OtherValue || '',
            photoCount: record.photoCount || 0,
            updatedAt: now,
            dirty: false
          }, recordId ? String(recordId) : null);

          await table.update(matchingField.id!, updates);
        } else {
          // Create new field for custom/unmatched record
          const syntheticTemplateId = recordId || Date.now();
          const key = `${serviceId}:${category}:${syntheticTemplateId}`;

          const newField = this.createField(config, {
            key,
            serviceId,
            category,
            templateId: Number(syntheticTemplateId),
            templateName: recordName,
            templateText: recordText,
            kind: record.Kind || 'Comment',
            answerType: 0,
            dropdownOptions: undefined,
            isSelected: true,
            answer: recordText || record.Answers || '',
            otherValue: record.OtherValue || '',
            photoCount: record.photoCount || 0,
            rev: 0,
            updatedAt: now,
            dirty: false
          }, recordId ? String(recordId) : null);

          await table.add(newField);
        }
      }
    });

    console.log(`[GenericFieldRepo] Merged ${categoryRecords.length} records`);
  }

  // ============================================================================
  // REACTIVE READS
  // ============================================================================

  getFieldsForCategory$(config: TemplateConfig, serviceId: string, category: string): Observable<any[]> {
    switch (config.id) {
      case 'efe':
        return db.liveVisualFields$(serviceId, category);
      case 'hud':
        return db.liveHudFields$(serviceId, category);
      case 'lbw':
        return db.liveLbwFields$(serviceId, category);
      case 'dte':
        return db.liveDteFields$(serviceId, category);
      case 'csa':
        return db.liveCsaFields$(serviceId, category);
      default:
        throw new Error(`[GenericFieldRepo] Unknown template for liveQuery: ${config.id}`);
    }
  }

  // ============================================================================
  // NON-REACTIVE READS
  // ============================================================================

  async getFieldsForCategory(config: TemplateConfig, serviceId: string, category: string): Promise<any[]> {
    const table = this.getTable(config);
    return table
      .where('[serviceId+category]')
      .equals([serviceId, category])
      .toArray();
  }

  async hasFieldsForCategory(config: TemplateConfig, serviceId: string, category: string): Promise<boolean> {
    const table = this.getTable(config);
    const count = await table
      .where('[serviceId+category]')
      .equals([serviceId, category])
      .count();
    return count > 0;
  }

  async getField(config: TemplateConfig, key: string): Promise<any> {
    const table = this.getTable(config);
    return table.where('key').equals(key).first();
  }

  // ============================================================================
  // WRITES
  // ============================================================================

  /**
   * Set field values in the appropriate template table
   * Handles template-specific ID field mapping automatically
   *
   * @param config - Template configuration
   * @param serviceId - Service ID
   * @param category - Category name
   * @param templateId - Template ID
   * @param updates - Field updates (can include generic recordId/tempRecordId)
   */
  async setField(
    config: TemplateConfig,
    serviceId: string,
    category: string,
    templateId: number,
    updates: any
  ): Promise<void> {
    const key = `${serviceId}:${category}:${templateId}`;
    const table = this.getTable(config);
    const existing = await table.where('key').equals(key).first();

    // Map generic recordId/tempRecordId to template-specific field names
    const mappedUpdates = this.mapRecordIdFields(config, updates);
    const now = Date.now();

    if (!existing) {
      // Field doesn't exist yet (user acted before seeding completed)
      // Create a minimal field with the provided updates
      console.log(`[GenericFieldRepo] Field not found, creating: ${key}`);

      const newField = this.createField(config, {
        key,
        serviceId,
        category,
        templateId,
        templateName: '',  // Will be populated when template data is available
        templateText: '',
        kind: 'Comment' as const,
        answerType: 0,
        isSelected: mappedUpdates.isSelected ?? true,
        answer: mappedUpdates.answer ?? '',
        otherValue: mappedUpdates.otherValue ?? '',
        photoCount: 0,
        rev: 1,
        updatedAt: now,
        dirty: true,
        ...mappedUpdates
      });

      await table.add(newField);
      console.log(`[GenericFieldRepo] Created field: ${key}`);
      return;
    }

    // Mark dirty if any user-editable field changed (for sync to backend)
    const isDirty = mappedUpdates.isSelected !== undefined ||
                    mappedUpdates.answer !== undefined ||
                    mappedUpdates.otherValue !== undefined ||
                    mappedUpdates.templateName !== undefined ||
                    mappedUpdates.templateText !== undefined;

    await table.update(existing.id!, {
      ...mappedUpdates,
      rev: (existing.rev || 0) + 1,
      updatedAt: now,
      dirty: isDirty ? true : existing.dirty
    });
  }

  /**
   * Map generic recordId/tempRecordId to template-specific field names
   * This allows callers to use generic field names that get converted to:
   * - EFE: visualId, tempVisualId
   * - HUD: hudId, tempHudId
   * - LBW: lbwId, tempLbwId
   * - DTE: dteId, tempDteId
   */
  private mapRecordIdFields(config: TemplateConfig, updates: any): any {
    const mapped = { ...updates };

    // If caller passed generic recordId, map to template-specific field
    if ('recordId' in updates) {
      switch (config.id) {
        case 'efe':
          mapped.visualId = updates.recordId;
          break;
        case 'hud':
          mapped.hudId = updates.recordId;
          break;
        case 'lbw':
          mapped.lbwId = updates.recordId;
          break;
        case 'dte':
          mapped.dteId = updates.recordId;
          break;
        case 'csa':
          mapped.csaId = updates.recordId;
          break;
      }
      delete mapped.recordId;
    }

    // If caller passed generic tempRecordId, map to template-specific field
    if ('tempRecordId' in updates) {
      switch (config.id) {
        case 'efe':
          mapped.tempVisualId = updates.tempRecordId;
          break;
        case 'hud':
          mapped.tempHudId = updates.tempRecordId;
          break;
        case 'lbw':
          mapped.tempLbwId = updates.tempRecordId;
          break;
        case 'dte':
          mapped.tempDteId = updates.tempRecordId;
          break;
        case 'csa':
          mapped.tempCsaId = updates.tempRecordId;
          break;
      }
      delete mapped.tempRecordId;
    }

    return mapped;
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private getTable(config: TemplateConfig): Table<any, number> {
    switch (config.id) {
      case 'efe':
        return db.visualFields;
      case 'hud':
        return db.hudFields;
      case 'lbw':
        return db.lbwFields;
      case 'dte':
        return db.dteFields;
      case 'csa':
        return db.csaFields;
      default:
        throw new Error(`[GenericFieldRepo] Unknown template: ${config.id}`);
    }
  }

  /**
   * Create a field object with template-specific ID property names
   * Only sets ID fields if not already present in baseField
   */
  private createField(config: TemplateConfig, baseField: any, recordId?: string | null): any {
    const field = { ...baseField };

    // Only set ID fields if not already present in baseField
    switch (config.id) {
      case 'efe':
        if (!('visualId' in baseField)) field.visualId = recordId || null;
        if (!('tempVisualId' in baseField)) field.tempVisualId = null;
        break;
      case 'hud':
        if (!('hudId' in baseField)) field.hudId = recordId || null;
        if (!('tempHudId' in baseField)) field.tempHudId = null;
        break;
      case 'lbw':
        if (!('lbwId' in baseField)) field.lbwId = recordId || null;
        if (!('tempLbwId' in baseField)) field.tempLbwId = null;
        break;
      case 'dte':
        if (!('dteId' in baseField)) field.dteId = recordId || null;
        if (!('tempDteId' in baseField)) field.tempDteId = null;
        break;
      case 'csa':
        if (!('csaId' in baseField)) field.csaId = recordId || null;
        if (!('tempCsaId' in baseField)) field.tempCsaId = null;
        break;
      default:
        throw new Error(`[GenericFieldRepo] Unknown template for createField: ${config.id}`);
    }

    return field;
  }

  /**
   * Create an update object with template-specific ID property
   */
  private createUpdateWithRecordId(config: TemplateConfig, baseUpdate: any, recordId: string | null): any {
    const update = { ...baseUpdate };

    switch (config.id) {
      case 'efe':
        update.visualId = recordId;
        update.tempVisualId = null;
        break;
      case 'hud':
        update.hudId = recordId;
        update.tempHudId = null;
        break;
      case 'lbw':
        update.lbwId = recordId;
        update.tempLbwId = null;
        break;
      case 'dte':
        update.dteId = recordId;
        update.tempDteId = null;
        break;
      case 'csa':
        update.csaId = recordId;
        update.tempCsaId = null;
        break;
      default:
        throw new Error(`[GenericFieldRepo] Unknown template for createUpdateWithRecordId: ${config.id}`);
    }

    return update;
  }

  /**
   * Get the record ID from a field (template-specific property)
   */
  getRecordId(config: TemplateConfig, field: any): string | null {
    switch (config.id) {
      case 'efe':
        return field.visualId || field.tempVisualId || null;
      case 'hud':
        return field.hudId || field.tempHudId || null;
      case 'lbw':
        return field.lbwId || field.tempLbwId || null;
      case 'dte':
        return field.dteId || field.tempDteId || null;
      case 'csa':
        return field.csaId || field.tempCsaId || null;
      default:
        return null;
    }
  }

  /**
   * Get the temp record ID from a field
   */
  getTempRecordId(config: TemplateConfig, field: any): string | null {
    switch (config.id) {
      case 'efe':
        return field.tempVisualId || null;
      case 'hud':
        return field.tempHudId || null;
      case 'lbw':
        return field.tempLbwId || null;
      case 'dte':
        return field.tempDteId || null;
      case 'csa':
        return field.tempCsaId || null;
      default:
        return null;
    }
  }

  /**
   * Check if Dexie-first is enabled for this template
   */
  isDexieFirstEnabled(config: TemplateConfig): boolean {
    return config.id === 'efe' || config.id === 'hud' || config.id === 'lbw' || config.id === 'dte' || config.id === 'csa';
  }
}
