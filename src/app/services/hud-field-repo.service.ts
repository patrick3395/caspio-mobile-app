import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { db, HudField } from './caspio-db';
import { ServiceMetadataService } from './service-metadata.service';

/**
 * HudFieldRepoService - Repository API for HUD field data
 *
 * This service implements the Dexie-first architecture pattern for HUD:
 * - Seed from templates (one-time initialization)
 * - Reactive reads via liveQuery (auto-updates on change)
 * - Write-through on every input change
 * - Dirty flag for sync tracking
 *
 * Benefits:
 * - No loading screens - pages render immediately from Dexie
 * - No data loss - Dexie is always source of truth
 * - Instant navigation - no loadData() on page entry
 * - Automatic updates - liveQuery handles reactivity
 */
@Injectable({
  providedIn: 'root'
})
export class HudFieldRepoService {

  constructor(private serviceMetadata: ServiceMetadataService) {}

  // ============================================================================
  // SEEDING - Initialize fields from templates
  // ============================================================================

  /**
   * Seed HUD fields from templates for a service/category
   * Called once when entering a category for the first time
   * Idempotent - won't overwrite existing user data
   */
  async seedFromTemplates(serviceId: string, category: string, templates: any[], dropdownData?: any[]): Promise<void> {
    console.log(`[HudFieldRepo] Seeding ${templates.length} templates for ${category}`);

    // Filter templates for this category (HUD uses TypeID=1 for checklist items)
    const categoryTemplates = templates.filter(t =>
      t.TypeID === 1 && t.Category === category
    );

    if (categoryTemplates.length === 0) {
      console.log('[HudFieldRepo] No templates to seed for this category');
      return;
    }

    // Build dropdown options map by TemplateID from cached dropdown data
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
      // Add "Other" option to all multi-select dropdowns
      Object.keys(dropdownOptionsMap).forEach(templateId => {
        const options = dropdownOptionsMap[Number(templateId)];
        if (options && !options.includes('Other')) {
          options.push('Other');
        }
      });
      console.log(`[HudFieldRepo] Built dropdown options map for ${Object.keys(dropdownOptionsMap).length} templates`);
    }

    // Check which fields already exist (don't overwrite user data)
    const existingKeys = new Set<string>();
    const existingFields = await db.hudFields
      .where('[serviceId+category]')
      .equals([serviceId, category])
      .toArray();

    existingFields.forEach(f => existingKeys.add(f.key));

    // Build new fields to insert
    const newFields: HudField[] = [];
    const now = Date.now();

    for (const template of categoryTemplates) {
      const effectiveTemplateId = template.TemplateID || template.PK_ID;
      const key = `${serviceId}:${category}:${effectiveTemplateId}`;

      // Skip if already exists (preserve user data)
      if (existingKeys.has(key)) {
        continue;
      }

      // Get dropdown options
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

      const field: HudField = {
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
        hudId: null,
        tempHudId: null,
        photoCount: 0,
        rev: 0,
        updatedAt: now,
        dirty: false
      };

      newFields.push(field);
    }

    if (newFields.length > 0) {
      await db.transaction('rw', db.hudFields, async () => {
        await db.hudFields.bulkAdd(newFields);
      });
      console.log(`[HudFieldRepo] Seeded ${newFields.length} new fields`);
    } else {
      console.log('[HudFieldRepo] All fields already exist, no seeding needed');
    }
  }

  /**
   * Merge existing HUD records into HUD fields
   * Called after seeding to apply user's existing selections
   */
  async mergeExistingVisuals(serviceId: string, category: string, huds: any[]): Promise<void> {
    // Filter HUD records for this category
    const categoryHuds = huds.filter(h => h.Category === category);

    if (categoryHuds.length === 0) {
      return;
    }

    console.log(`[HudFieldRepo] Merging ${categoryHuds.length} existing HUD records for ${category}`);

    const now = Date.now();

    // Get all existing hudFields for this category
    const existingFields = await db.hudFields
      .where('[serviceId+category]')
      .equals([serviceId, category])
      .toArray();

    // Build maps for matching
    const fieldsByNameAndText = new Map<string, HudField>();
    const fieldsByText = new Map<string, HudField>();
    const fieldsByName = new Map<string, HudField>();

    for (const field of existingFields) {
      const name = (field.templateName || '').toLowerCase().trim();
      const text = (field.templateText || '').toLowerCase().trim();

      if (name && text) {
        fieldsByNameAndText.set(`${name}|${text}`, field);
      }
      if (text) {
        fieldsByText.set(text, field);
      }
      if (name) {
        fieldsByName.set(name, field);
      }
    }

    console.log(`[HudFieldRepo] Found ${existingFields.length} existing fields for matching`);

    await db.transaction('rw', db.hudFields, async () => {
      for (const hud of categoryHuds) {
        const hudId = hud.HUDID || hud.PK_ID || null;
        const hudName = (hud.Name || '').trim();
        const hudText = (hud.Text || '').trim();
        const nameLower = hudName.toLowerCase();
        const textLower = hudText.toLowerCase();

        // Try to find matching field
        let matchingField: HudField | undefined;

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
          await db.hudFields.update(matchingField.id!, {
            isSelected: true,
            answer: hudText || hud.Answers || '',
            otherValue: hud.OtherValue || '',
            hudId: hudId ? String(hudId) : null,
            tempHudId: null,
            photoCount: hud.photoCount || 0,
            updatedAt: now,
            dirty: false
          });
          console.log(`[HudFieldRepo] Updated hudField by template match: ${hudName}`);
        } else {
          // No template match - create entry (handles custom HUD items)
          const syntheticTemplateId = hudId || Date.now();
          const key = `${serviceId}:${category}:${syntheticTemplateId}`;

          const newField: HudField = {
            key,
            serviceId,
            category,
            templateId: Number(syntheticTemplateId),
            templateName: hudName,
            templateText: hudText,
            kind: hud.Kind || 'Comment',
            answerType: 0,
            dropdownOptions: undefined,
            isSelected: true,
            answer: hudText || hud.Answers || '',
            otherValue: hud.OtherValue || '',
            hudId: hudId ? String(hudId) : null,
            tempHudId: null,
            photoCount: hud.photoCount || 0,
            rev: 0,
            updatedAt: now,
            dirty: false
          };
          await db.hudFields.add(newField);
          console.log(`[HudFieldRepo] Created hudField (custom/no template): ${hudName}`);
        }
      }
    });

    console.log(`[HudFieldRepo] Merged ${categoryHuds.length} HUD records for ${category}`);
  }

  // ============================================================================
  // REACTIVE READS - Live queries that auto-update on change
  // ============================================================================

  /**
   * Get all fields for a category as reactive Observable
   */
  getFieldsForCategory$(serviceId: string, category: string): Observable<HudField[]> {
    return db.liveHudFields$(serviceId, category);
  }

  /**
   * Get a single field by key as reactive Observable
   */
  getField$(key: string): Observable<HudField | undefined> {
    return db.liveHudField$(key);
  }

  /**
   * Get all dirty fields (pending sync) as reactive Observable
   */
  getDirtyFields$(): Observable<HudField[]> {
    return db.liveDirtyHudFields$();
  }

  /**
   * Get all fields for a service (all categories) as reactive Observable
   */
  getAllFieldsForService$(serviceId: string): Observable<HudField[]> {
    return db.liveAllHudFieldsForService$(serviceId);
  }

  // ============================================================================
  // NON-REACTIVE READS - For one-time queries
  // ============================================================================

  /**
   * Get all fields for a category (non-reactive)
   */
  async getFieldsForCategory(serviceId: string, category: string): Promise<HudField[]> {
    return db.hudFields
      .where('[serviceId+category]')
      .equals([serviceId, category])
      .toArray();
  }

  /**
   * Get a single field by key (non-reactive)
   */
  async getField(key: string): Promise<HudField | undefined> {
    return db.hudFields.where('key').equals(key).first();
  }

  /**
   * Get all dirty fields (non-reactive, for sync service)
   */
  async getDirtyFields(): Promise<HudField[]> {
    return db.hudFields.where('dirty').equals(1).toArray();
  }

  /**
   * Check if fields exist for a category (for seeding check)
   */
  async hasFieldsForCategory(serviceId: string, category: string): Promise<boolean> {
    const count = await db.hudFields
      .where('[serviceId+category]')
      .equals([serviceId, category])
      .count();
    return count > 0;
  }

  // ============================================================================
  // WRITES - Field updates with dirty tracking
  // ============================================================================

  /**
   * Update a field (partial update)
   */
  async setField(serviceId: string, category: string, templateId: number, updates: Partial<HudField>): Promise<void> {
    const key = `${serviceId}:${category}:${templateId}`;
    const existing = await this.getField(key);

    if (!existing) {
      console.warn(`[HudFieldRepo] Field not found for update: ${key}`);
      return;
    }

    const now = Date.now();

    // Mark as dirty if user-facing data changed
    const isDirty = updates.isSelected !== undefined ||
                    updates.answer !== undefined ||
                    updates.otherValue !== undefined;

    await db.hudFields.update(existing.id!, {
      ...updates,
      rev: (existing.rev || 0) + 1,
      updatedAt: now,
      dirty: isDirty ? true : existing.dirty
    });
  }

  /**
   * Create a new HUD record (custom visual or new selection)
   */
  async createHud(serviceId: string, category: string, templateId: number, data: Partial<HudField>): Promise<string> {
    const tempId = `temp_hud_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const key = `${serviceId}:${category}:${templateId}`;
    const now = Date.now();

    // Check if field exists
    const existing = await this.getField(key);

    if (existing) {
      // Update existing field
      await db.hudFields.update(existing.id!, {
        isSelected: true,
        answer: data.answer || existing.answer,
        otherValue: data.otherValue || existing.otherValue,
        tempHudId: tempId,
        rev: (existing.rev || 0) + 1,
        updatedAt: now,
        dirty: true
      });
    } else {
      // Create new field
      const newField: HudField = {
        key,
        serviceId,
        category,
        templateId,
        templateName: data.templateName || 'Custom Item',
        templateText: data.templateText || '',
        kind: data.kind || 'Comment',
        answerType: data.answerType || 0,
        dropdownOptions: data.dropdownOptions,
        isSelected: true,
        answer: data.answer || '',
        otherValue: data.otherValue || '',
        hudId: null,
        tempHudId: tempId,
        photoCount: 0,
        rev: 0,
        updatedAt: now,
        dirty: true
      };
      await db.hudFields.add(newField);
    }

    console.log(`[HudFieldRepo] Created HUD with tempId: ${tempId}`);
    return tempId;
  }

  /**
   * Delete a HUD field (deselect or remove custom)
   */
  async deleteHud(serviceId: string, category: string, templateId: number): Promise<void> {
    const key = `${serviceId}:${category}:${templateId}`;
    const existing = await this.getField(key);

    if (!existing) {
      return;
    }

    const now = Date.now();

    // If it's a template-based field, just deselect it
    // If it's a custom field (no real hudId), delete it entirely
    if (existing.hudId || existing.tempHudId) {
      await db.hudFields.update(existing.id!, {
        isSelected: false,
        rev: (existing.rev || 0) + 1,
        updatedAt: now,
        dirty: true
      });
    } else {
      await db.hudFields.delete(existing.id!);
    }

    console.log(`[HudFieldRepo] Deleted/deselected HUD: ${key}`);
  }

  /**
   * Mark a field as synced (called after successful API sync)
   */
  async markSynced(key: string, hudId: string): Promise<void> {
    const existing = await this.getField(key);
    if (!existing) return;

    await db.hudFields.update(existing.id!, {
      hudId: hudId,
      tempHudId: null,
      dirty: false
    });

    console.log(`[HudFieldRepo] Marked synced: ${key} -> ${hudId}`);
  }

  /**
   * Check if Dexie-first is enabled
   */
  isDexieFirstEnabled(): boolean {
    return true;
  }
}
