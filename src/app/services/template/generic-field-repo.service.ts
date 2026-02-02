import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Table } from 'dexie';
import { db, VisualField, HudField } from '../caspio-db';
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

    // Filter templates for this category
    const categoryTemplates = templates.filter(t =>
      t.TypeID === 1 && t.Category === category
    );

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

    if (newFields.length > 0) {
      await db.transaction('rw', table, async () => {
        await table.bulkAdd(newFields);
      });
      console.log(`[GenericFieldRepo] Seeded ${newFields.length} new fields`);
    }
  }

  async mergeExistingRecords(
    config: TemplateConfig,
    serviceId: string,
    category: string,
    records: any[]
  ): Promise<void> {
    const idFieldName = config.idFieldName; // 'VisualID', 'HUDID', etc.
    const categoryRecords = records.filter(r => r.Category === category);

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
      default:
        return db.liveVisualFields$(serviceId, category);
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

    if (!existing) {
      console.warn(`[GenericFieldRepo] Field not found: ${key}`);
      return;
    }

    const now = Date.now();
    const isDirty = updates.isSelected !== undefined ||
                    updates.answer !== undefined ||
                    updates.otherValue !== undefined;

    await table.update(existing.id!, {
      ...updates,
      rev: (existing.rev || 0) + 1,
      updatedAt: now,
      dirty: isDirty ? true : existing.dirty
    });
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
      default:
        return db.visualFields;
    }
  }

  /**
   * Create a field object with template-specific ID property names
   */
  private createField(config: TemplateConfig, baseField: any, recordId?: string | null): any {
    const field = { ...baseField };

    switch (config.id) {
      case 'efe':
        field.visualId = recordId || null;
        field.tempVisualId = null;
        break;
      case 'hud':
        field.hudId = recordId || null;
        field.tempHudId = null;
        break;
      default:
        field.visualId = recordId || null;
        field.tempVisualId = null;
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
      default:
        update.visualId = recordId;
        update.tempVisualId = null;
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
      default:
        return field.visualId || field.tempVisualId || null;
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
      default:
        return field.tempVisualId || null;
    }
  }

  /**
   * Check if Dexie-first is enabled for this template
   */
  isDexieFirstEnabled(config: TemplateConfig): boolean {
    return config.id === 'efe' || config.id === 'hud';
  }
}
