import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { db, HudField } from '../../../services/caspio-db';
import { ServiceMetadataService } from '../../../services/service-metadata.service';
import { PlatformDetectionService } from '../../../services/platform-detection.service';

/**
 * HudFieldRepoService - Repository API for HUD field data
 *
 * CRITICAL: Dexie-first approach is ONLY for MOBILE APP (Capacitor.isNativePlatform())
 * WEBAPP continues to use direct API calls without Dexie caching
 *
 * This service implements the Dexie-first architecture pattern for mobile:
 * - Seed from templates (one-time initialization)
 * - Reactive reads via liveQuery (auto-updates on change)
 * - Write-through on every input change
 * - Dirty flag for sync tracking
 *
 * Benefits on mobile:
 * - No loading screens - pages render immediately from Dexie
 * - No data loss - Dexie is always source of truth
 * - Instant navigation - no loadData() on page entry
 * - Automatic updates - liveQuery handles reactivity
 */
@Injectable({
  providedIn: 'root'
})
export class HudFieldRepoService {

  constructor(
    private serviceMetadata: ServiceMetadataService,
    private platform: PlatformDetectionService
  ) {}

  // ============================================================================
  // PLATFORM CHECK - Dexie-first is MOBILE ONLY
  // ============================================================================

  /**
   * Check if Dexie-first approach should be used
   * CRITICAL: Only enabled on mobile (Capacitor native platform)
   * WEBAPP uses direct API calls without Dexie caching
   */
  isDexieFirstEnabled(): boolean {
    return this.platform.isMobile();
  }

  // ============================================================================
  // SEEDING - Initialize fields from templates (MOBILE ONLY)
  // ============================================================================

  /**
   * Seed HUD fields from templates for a service/category
   * Called once when entering a category for the first time on mobile
   * Idempotent - won't overwrite existing user data
   *
   * @param serviceId - The service ID
   * @param category - The category name (e.g., 'Heating')
   * @param templates - Array of template objects from cachedTemplates
   * @param dropdownData - Optional array of dropdown options
   */
  async seedFromTemplates(serviceId: string, category: string, templates: any[], dropdownData?: any[]): Promise<void> {
    // CRITICAL: Only seed on mobile
    if (!this.isDexieFirstEnabled()) {
      console.log('[HudFieldRepo] Skipping seed - Dexie-first is WEBAPP disabled');
      return;
    }

    console.log(`[HudFieldRepo] Seeding ${templates.length} templates for ${category}`);

    // Filter templates for this category (TypeID=2 for HUD)
    const categoryTemplates = templates.filter(t =>
      t.TypeID === 2 && t.Category === category
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
   *
   * @param serviceId - The service ID
   * @param category - The category name
   * @param hudRecords - Array of existing HUD records from API
   */
  async mergeExistingHudRecords(serviceId: string, category: string, hudRecords: any[]): Promise<void> {
    // CRITICAL: Only merge on mobile
    if (!this.isDexieFirstEnabled()) {
      return;
    }

    const categoryRecords = hudRecords.filter(h => h.Category === category);

    if (categoryRecords.length === 0) {
      return;
    }

    console.log(`[HudFieldRepo] Merging ${categoryRecords.length} existing HUD records for ${category}`);

    const now = Date.now();

    // Get all existing hudFields for this category to match by name+text
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
      for (const hud of categoryRecords) {
        const hudId = hud.VisualID || hud.PK_ID || null;
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
          // No template match - create entry anyway
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

    console.log(`[HudFieldRepo] Merged ${categoryRecords.length} HUD records for ${category}`);
  }

  // ============================================================================
  // REACTIVE READS - Live queries that auto-update on change (MOBILE ONLY)
  // ============================================================================

  /**
   * Get all fields for a category as reactive Observable
   * This is the primary method for rendering HUD category detail pages on mobile
   *
   * @returns Observable that emits on ANY change to fields in this category
   */
  liveHudFields$(serviceId: string, category: string): Observable<HudField[]> {
    // CRITICAL: Only use Dexie on mobile
    if (!this.isDexieFirstEnabled()) {
      console.log('[HudFieldRepo] liveHudFields$ - Returning empty (WEBAPP mode)');
      return of([]);
    }
    return db.liveHudFields$(serviceId, category);
  }

  /**
   * Get a single field by key as reactive Observable
   */
  getField$(key: string): Observable<HudField | undefined> {
    if (!this.isDexieFirstEnabled()) {
      return of(undefined);
    }
    return db.liveHudField$(key);
  }

  /**
   * Get all dirty fields (pending sync) as reactive Observable
   */
  getDirtyFields$(): Observable<HudField[]> {
    if (!this.isDexieFirstEnabled()) {
      return of([]);
    }
    return db.liveDirtyHudFields$();
  }

  /**
   * Get all fields for a service (all categories) as reactive Observable
   */
  getAllFieldsForService$(serviceId: string): Observable<HudField[]> {
    if (!this.isDexieFirstEnabled()) {
      return of([]);
    }
    return db.liveAllHudFieldsForService$(serviceId);
  }

  // ============================================================================
  // NON-REACTIVE READS - For one-time queries (MOBILE ONLY)
  // ============================================================================

  /**
   * Get all fields for a category (non-reactive, one-time read)
   */
  async getFieldsForCategory(serviceId: string, category: string): Promise<HudField[]> {
    if (!this.isDexieFirstEnabled()) {
      return [];
    }
    return db.hudFields
      .where('[serviceId+category]')
      .equals([serviceId, category])
      .toArray();
  }

  /**
   * Get a single field by key (non-reactive)
   */
  async getField(key: string): Promise<HudField | undefined> {
    if (!this.isDexieFirstEnabled()) {
      return undefined;
    }
    return db.hudFields.where('key').equals(key).first();
  }

  /**
   * Get all dirty fields (non-reactive, for sync service)
   */
  async getDirtyFields(): Promise<HudField[]> {
    if (!this.isDexieFirstEnabled()) {
      return [];
    }
    return db.hudFields.where('dirty').equals(1).toArray();
  }

  /**
   * Check if fields exist for a category (for seeding check)
   */
  async hasFieldsForCategory(serviceId: string, category: string): Promise<boolean> {
    if (!this.isDexieFirstEnabled()) {
      return false;
    }
    const count = await db.hudFields
      .where('[serviceId+category]')
      .equals([serviceId, category])
      .count();
    return count > 0;
  }

  // ============================================================================
  // WRITE-THROUGH - Update fields and mark as dirty (MOBILE ONLY)
  // ============================================================================

  /**
   * Update a single field (write-through)
   * Marks field as dirty for sync
   *
   * @param serviceId - Service ID
   * @param category - Category name
   * @param templateId - Template ID
   * @param patch - Partial field data to update
   */
  async setField(
    serviceId: string,
    category: string,
    templateId: number,
    patch: Partial<HudField>
  ): Promise<void> {
    // CRITICAL: Only write on mobile
    if (!this.isDexieFirstEnabled()) {
      console.log('[HudFieldRepo] setField - Skipping (WEBAPP mode)');
      return;
    }

    const key = `${serviceId}:${category}:${templateId}`;
    const now = Date.now();

    await db.transaction('rw', db.hudFields, async () => {
      const existing = await db.hudFields.where('key').equals(key).first();

      if (existing) {
        await db.hudFields.update(existing.id!, {
          ...patch,
          rev: existing.rev + 1,
          updatedAt: now,
          dirty: true
        });
      } else {
        // Create new field for custom items
        const newField: HudField = {
          key,
          serviceId,
          category,
          templateId,
          templateName: patch.templateName || 'Custom Item',
          templateText: patch.templateText || '',
          kind: patch.kind || 'Comment',
          answerType: patch.answerType ?? 0,
          dropdownOptions: patch.dropdownOptions,
          isSelected: patch.isSelected ?? false,
          answer: patch.answer || '',
          otherValue: patch.otherValue || '',
          hudId: patch.hudId || null,
          tempHudId: patch.tempHudId || null,
          photoCount: patch.photoCount ?? 0,
          rev: 0,
          updatedAt: now,
          dirty: true
        };
        await db.hudFields.add(newField);
        console.log(`[HudFieldRepo] Created new field for custom HUD: ${key}`);
      }
    });

    // Track service revision for storage bloat prevention
    this.serviceMetadata.incrementLocalRevision(serviceId).catch(() => {});
  }

  /**
   * Update answer for a field
   */
  async updateAnswer(
    serviceId: string,
    category: string,
    templateId: number,
    answer: string,
    otherValue?: string
  ): Promise<void> {
    const patch: Partial<HudField> = { answer };
    if (otherValue !== undefined) {
      patch.otherValue = otherValue;
    }
    await this.setField(serviceId, category, templateId, patch);
  }

  /**
   * Update photo for a field (sets entityId for LocalImages integration)
   * This method coordinates with LocalImages table using entityType: 'hud'
   */
  async setPhoto(
    serviceId: string,
    category: string,
    templateId: number,
    photoCount: number
  ): Promise<void> {
    await this.setField(serviceId, category, templateId, { photoCount });
  }

  /**
   * Update multiple fields at once (bulk write-through)
   */
  async setFieldsBulk(
    serviceId: string,
    category: string,
    patches: { templateId: number; patch: Partial<HudField> }[]
  ): Promise<void> {
    if (!this.isDexieFirstEnabled()) {
      return;
    }

    const now = Date.now();

    await db.transaction('rw', db.hudFields, async () => {
      for (const { templateId, patch } of patches) {
        const key = `${serviceId}:${category}:${templateId}`;
        const existing = await db.hudFields.where('key').equals(key).first();

        if (existing) {
          await db.hudFields.update(existing.id!, {
            ...patch,
            rev: existing.rev + 1,
            updatedAt: now,
            dirty: true
          });
        }
      }
    });

    this.serviceMetadata.incrementLocalRevision(serviceId).catch(() => {});
  }

  // ============================================================================
  // SYNC HELPERS - For background sync service (MOBILE ONLY)
  // ============================================================================

  /**
   * Mark a field as synced (clear dirty flag, set hudId)
   * Called by sync service after successful backend write
   */
  async markSynced(key: string, hudId: string): Promise<void> {
    if (!this.isDexieFirstEnabled()) {
      return;
    }

    await db.transaction('rw', db.hudFields, async () => {
      const existing = await db.hudFields.where('key').equals(key).first();

      if (existing) {
        await db.hudFields.update(existing.id!, {
          hudId,
          tempHudId: null,
          dirty: false
        });
      }
    });
  }

  /**
   * Set temp HUD ID (called when creating pending HUD record)
   */
  async setTempHudId(key: string, tempHudId: string): Promise<void> {
    if (!this.isDexieFirstEnabled()) {
      return;
    }

    await db.transaction('rw', db.hudFields, async () => {
      const existing = await db.hudFields.where('key').equals(key).first();

      if (existing) {
        await db.hudFields.update(existing.id!, {
          tempHudId
        });
      }
    });
  }

  /**
   * Update photo count for a field
   */
  async updatePhotoCount(key: string, photoCount: number): Promise<void> {
    if (!this.isDexieFirstEnabled()) {
      return;
    }

    await db.transaction('rw', db.hudFields, async () => {
      const existing = await db.hudFields.where('key').equals(key).first();

      if (existing) {
        await db.hudFields.update(existing.id!, {
          photoCount,
          updatedAt: Date.now()
        });
      }
    });
  }

  // ============================================================================
  // CLEANUP (MOBILE ONLY)
  // ============================================================================

  /**
   * Clear all fields for a service (used when clearing cache)
   */
  async clearFieldsForService(serviceId: string): Promise<void> {
    if (!this.isDexieFirstEnabled()) {
      return;
    }

    await db.hudFields.where('serviceId').equals(serviceId).delete();
    console.log(`[HudFieldRepo] Cleared all fields for service: ${serviceId}`);
  }

  /**
   * Mark all HUD fields for a service as clean (not dirty)
   * Called after finalization to indicate all data is synced
   */
  async markAllCleanForService(serviceId: string): Promise<void> {
    if (!this.isDexieFirstEnabled()) {
      return;
    }

    await db.transaction('rw', db.hudFields, async () => {
      const fields = await db.hudFields.where('serviceId').equals(serviceId).toArray();
      for (const field of fields) {
        if (field.dirty) {
          await db.hudFields.update(field.id!, { dirty: false });
        }
      }
    });
    console.log(`[HudFieldRepo] Marked all fields clean for service: ${serviceId}`);
  }

  /**
   * Clear all HUD fields (full reset)
   */
  async clearAll(): Promise<void> {
    if (!this.isDexieFirstEnabled()) {
      return;
    }

    await db.hudFields.clear();
    console.log('[HudFieldRepo] Cleared all HUD fields');
  }
}
