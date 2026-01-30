import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { db, VisualField } from './caspio-db';
import { ServiceMetadataService } from './service-metadata.service';

/**
 * VisualFieldRepoService - Repository API for visual field data
 *
 * This service implements the Dexie-first architecture pattern:
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
export class VisualFieldRepoService {

  constructor(private serviceMetadata: ServiceMetadataService) {}

  // ============================================================================
  // SEEDING - Initialize fields from templates
  // ============================================================================

  /**
   * Seed visual fields from templates for a service/category
   * Called once when entering a category for the first time
   * Idempotent - won't overwrite existing user data
   *
   * @param serviceId - The service ID
   * @param category - The category name (e.g., 'Foundations')
   * @param templates - Array of template objects from cachedTemplates
   * @param dropdownData - Optional array of dropdown options from LPS_Services_Visuals_Drop (cached)
   */
  async seedFromTemplates(serviceId: string, category: string, templates: any[], dropdownData?: any[]): Promise<void> {
    console.log(`[VisualFieldRepo] Seeding ${templates.length} templates for ${category}`);

    // Filter templates for this category
    const categoryTemplates = templates.filter(t =>
      t.TypeID === 1 && t.Category === category
    );

    if (categoryTemplates.length === 0) {
      console.log('[VisualFieldRepo] No templates to seed for this category');
      return;
    }

    // Build dropdown options map by TemplateID from cached dropdown data
    // This enables Dexie-first loading of multi-select options (Walls, Crawlspace, etc.)
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
      console.log(`[VisualFieldRepo] Built dropdown options map for ${Object.keys(dropdownOptionsMap).length} templates`);
    }

    // Check which fields already exist (don't overwrite user data)
    const existingKeys = new Set<string>();
    const existingFields = await db.visualFields
      .where('[serviceId+category]')
      .equals([serviceId, category])
      .toArray();

    existingFields.forEach(f => existingKeys.add(f.key));

    // Build new fields to insert
    const newFields: VisualField[] = [];
    const now = Date.now();

    for (const template of categoryTemplates) {
      // CRITICAL: Use TemplateID for key/templateId (matches VisualTemplateID in merge and dropdown lookup)
      // PK_ID is internal record ID, TemplateID is cross-reference for dropdowns in Services_Visuals_Drop
      const effectiveTemplateId = template.TemplateID || template.PK_ID;
      const key = `${serviceId}:${category}:${effectiveTemplateId}`;

      // Skip if already exists (preserve user data)
      if (existingKeys.has(key)) {
        continue;
      }

      // Get dropdown options: first from cached dropdown data, then from embedded template
      let dropdownOptions: string[] | undefined;
      if (template.AnswerType === 2) {
        // Priority 1: Use cached dropdown data from LPS_Services_Visuals_Drop
        if (dropdownOptionsMap[effectiveTemplateId]) {
          dropdownOptions = dropdownOptionsMap[effectiveTemplateId];
        }
        // Priority 2: Fall back to embedded DropdownOptions in template
        else if (template.DropdownOptions) {
          try {
            dropdownOptions = JSON.parse(template.DropdownOptions);
          } catch (e) {
            dropdownOptions = [];
          }
        }
      }

      const field: VisualField = {
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
        visualId: null,
        tempVisualId: null,
        photoCount: 0,
        rev: 0,
        updatedAt: now,
        dirty: false  // Not dirty - no user changes yet
      };

      newFields.push(field);
    }

    if (newFields.length > 0) {
      // Bulk insert in a single transaction for performance
      await db.transaction('rw', db.visualFields, async () => {
        await db.visualFields.bulkAdd(newFields);
      });
      console.log(`[VisualFieldRepo] Seeded ${newFields.length} new fields`);
    } else {
      console.log('[VisualFieldRepo] All fields already exist, no seeding needed');
    }
  }

  /**
   * Merge existing visuals into visual fields
   * Called after seeding to apply user's existing selections
   *
   * @param serviceId - The service ID
   * @param category - The category name
   * @param visuals - Array of existing visual records from cachedServiceData
   */
  async mergeExistingVisuals(serviceId: string, category: string, visuals: any[]): Promise<void> {
    // Filter visuals for this category
    const categoryVisuals = visuals.filter(v => v.Category === category);

    if (categoryVisuals.length === 0) {
      return;
    }

    console.log(`[VisualFieldRepo] Merging ${categoryVisuals.length} existing visuals for ${category}`);

    const now = Date.now();

    // Get all existing visualFields for this category to match by name+text
    const existingFields = await db.visualFields
      .where('[serviceId+category]')
      .equals([serviceId, category])
      .toArray();

    // Build maps for matching - try multiple strategies
    // Key 1: name+text combined (most specific)
    // Key 2: text alone (for cases where name might differ)
    // Key 3: name alone (fallback)
    const fieldsByNameAndText = new Map<string, VisualField>();
    const fieldsByText = new Map<string, VisualField>();
    const fieldsByName = new Map<string, VisualField>();

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

    console.log(`[VisualFieldRepo] Found ${existingFields.length} existing fields for matching`);

    // Apply updates/inserts in transaction
    await db.transaction('rw', db.visualFields, async () => {
      for (const visual of categoryVisuals) {
        const visualId = visual.VisualID || visual.PK_ID || null;
        const visualName = (visual.Name || '').trim();
        const visualText = (visual.Text || '').trim();
        const nameLower = visualName.toLowerCase();
        const textLower = visualText.toLowerCase();

        // Try to find matching field - most specific first
        let matchingField: VisualField | undefined;

        // Strategy 1: Match by name + text (most accurate)
        if (nameLower && textLower) {
          matchingField = fieldsByNameAndText.get(`${nameLower}|${textLower}`);
        }

        // Strategy 2: Match by text alone
        if (!matchingField && textLower) {
          matchingField = fieldsByText.get(textLower);
        }

        // Strategy 3: Match by name alone (least specific)
        if (!matchingField && nameLower) {
          matchingField = fieldsByName.get(nameLower);
        }

        if (matchingField) {
          // Update existing field - matched to template
          await db.visualFields.update(matchingField.id!, {
            isSelected: true,
            answer: visualText || visual.Answers || '',
            otherValue: visual.OtherValue || '',
            visualId: visualId ? String(visualId) : null,
            tempVisualId: null,
            photoCount: visual.photoCount || 0,
            updatedAt: now,
            dirty: false
          });
          console.log(`[VisualFieldRepo] Updated visualField by template match: ${visualName}`);
        } else {
          // No template match - create entry anyway (handles custom visuals)
          // Use visualId as the "templateId" since we don't have the real one
          const syntheticTemplateId = visualId || Date.now();
          const key = `${serviceId}:${category}:${syntheticTemplateId}`;

          const newField: VisualField = {
            key,
            serviceId,
            category,
            templateId: Number(syntheticTemplateId),
            templateName: visualName,
            templateText: visualText,
            kind: visual.Kind || 'Comment',
            answerType: 0,
            dropdownOptions: undefined,
            isSelected: true,
            answer: visualText || visual.Answers || '',
            otherValue: visual.OtherValue || '',
            visualId: visualId ? String(visualId) : null,
            tempVisualId: null,
            photoCount: visual.photoCount || 0,
            rev: 0,
            updatedAt: now,
            dirty: false
          };
          await db.visualFields.add(newField);
          console.log(`[VisualFieldRepo] Created visualField (custom/no template): ${visualName}`);
        }
      }
    });

    console.log(`[VisualFieldRepo] Merged ${categoryVisuals.length} visuals for ${category}`);
  }

  // ============================================================================
  // REACTIVE READS - Live queries that auto-update on change
  // ============================================================================

  /**
   * Get all fields for a category as reactive Observable
   * This is the primary method for rendering category detail pages
   *
   * @returns Observable that emits on ANY change to fields in this category
   */
  getFieldsForCategory$(serviceId: string, category: string): Observable<VisualField[]> {
    return db.liveVisualFields$(serviceId, category);
  }

  /**
   * Get a single field by key as reactive Observable
   */
  getField$(key: string): Observable<VisualField | undefined> {
    return db.liveVisualField$(key);
  }

  /**
   * Get all dirty fields (pending sync) as reactive Observable
   */
  getDirtyFields$(): Observable<VisualField[]> {
    return db.liveDirtyVisualFields$();
  }

  /**
   * Get all fields for a service (all categories) as reactive Observable
   */
  getAllFieldsForService$(serviceId: string): Observable<VisualField[]> {
    return db.liveAllVisualFieldsForService$(serviceId);
  }

  // ============================================================================
  // NON-REACTIVE READS - For one-time queries
  // ============================================================================

  /**
   * Get all fields for a category (non-reactive, one-time read)
   */
  async getFieldsForCategory(serviceId: string, category: string): Promise<VisualField[]> {
    return db.visualFields
      .where('[serviceId+category]')
      .equals([serviceId, category])
      .toArray();
  }

  /**
   * Get a single field by key (non-reactive)
   */
  async getField(key: string): Promise<VisualField | undefined> {
    return db.visualFields.where('key').equals(key).first();
  }

  /**
   * Get all dirty fields (non-reactive, for sync service)
   */
  async getDirtyFields(): Promise<VisualField[]> {
    return db.visualFields.where('dirty').equals(1).toArray();
  }

  /**
   * Check if fields exist for a category (for seeding check)
   */
  async hasFieldsForCategory(serviceId: string, category: string): Promise<boolean> {
    const count = await db.visualFields
      .where('[serviceId+category]')
      .equals([serviceId, category])
      .count();
    return count > 0;
  }

  // ============================================================================
  // WRITE-THROUGH - Update fields and mark as dirty
  // ============================================================================

  /**
   * Update a single field (write-through)
   * Marks field as dirty for sync
   * Creates new field if it doesn't exist (for custom visuals)
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
    patch: Partial<VisualField>
  ): Promise<void> {
    const key = `${serviceId}:${category}:${templateId}`;
    const now = Date.now();

    await db.transaction('rw', db.visualFields, async () => {
      const existing = await db.visualFields.where('key').equals(key).first();

      if (existing) {
        // Update existing field
        await db.visualFields.update(existing.id!, {
          ...patch,
          rev: existing.rev + 1,
          updatedAt: now,
          dirty: true
        });
      } else {
        // DEXIE-FIRST: Create new field for custom visuals
        // This ensures liveQuery fires and UI updates reactively
        const newField: VisualField = {
          key,
          serviceId,
          category,
          templateId,
          templateName: patch.templateName || '',
          templateText: patch.templateText || '',
          kind: patch.kind || 'Comment',
          answerType: patch.answerType ?? 0,
          dropdownOptions: patch.dropdownOptions,
          isSelected: patch.isSelected ?? false,
          answer: patch.answer || '',
          otherValue: patch.otherValue || '',
          visualId: patch.visualId || null,
          tempVisualId: patch.tempVisualId || null,
          photoCount: patch.photoCount ?? 0,
          rev: 0,
          updatedAt: now,
          dirty: true
        };
        await db.visualFields.add(newField);
        console.log(`[VisualFieldRepo] Created new field for custom visual: ${key}`);
      }
    });

    // Track service revision for storage bloat prevention (Phase 3)
    this.serviceMetadata.incrementLocalRevision(serviceId).catch(() => {});
  }

  /**
   * Update multiple fields at once (bulk write-through)
   * More efficient than individual setField calls
   */
  async setFieldsBulk(
    serviceId: string,
    category: string,
    patches: { templateId: number; patch: Partial<VisualField> }[]
  ): Promise<void> {
    const now = Date.now();

    await db.transaction('rw', db.visualFields, async () => {
      for (const { templateId, patch } of patches) {
        const key = `${serviceId}:${category}:${templateId}`;
        const existing = await db.visualFields.where('key').equals(key).first();

        if (existing) {
          await db.visualFields.update(existing.id!, {
            ...patch,
            rev: existing.rev + 1,
            updatedAt: now,
            dirty: true
          });
        }
      }
    });

    // Track service revision for storage bloat prevention (Phase 3)
    this.serviceMetadata.incrementLocalRevision(serviceId).catch(() => {});
  }

  /**
   * Update field by key (alternative to serviceId/category/templateId)
   */
  async setFieldByKey(key: string, patch: Partial<VisualField>): Promise<void> {
    await db.transaction('rw', db.visualFields, async () => {
      const existing = await db.visualFields.where('key').equals(key).first();

      if (existing) {
        await db.visualFields.update(existing.id!, {
          ...patch,
          rev: existing.rev + 1,
          updatedAt: Date.now(),
          dirty: true
        });
      }
    });
  }

  // ============================================================================
  // SYNC HELPERS - For background sync service
  // ============================================================================

  /**
   * Mark a field as synced (clear dirty flag, set visualId)
   * Called by sync service after successful backend write
   */
  async markSynced(key: string, visualId: string): Promise<void> {
    await db.transaction('rw', db.visualFields, async () => {
      const existing = await db.visualFields.where('key').equals(key).first();

      if (existing) {
        await db.visualFields.update(existing.id!, {
          visualId,
          tempVisualId: null,
          dirty: false
        });
      }
    });
  }

  /**
   * Set temp visual ID (called when creating pending visual record)
   */
  async setTempVisualId(key: string, tempVisualId: string): Promise<void> {
    await db.transaction('rw', db.visualFields, async () => {
      const existing = await db.visualFields.where('key').equals(key).first();

      if (existing) {
        await db.visualFields.update(existing.id!, {
          tempVisualId
        });
      }
    });
  }

  /**
   * Update photo count for a field
   */
  async updatePhotoCount(key: string, photoCount: number): Promise<void> {
    await db.transaction('rw', db.visualFields, async () => {
      const existing = await db.visualFields.where('key').equals(key).first();

      if (existing) {
        await db.visualFields.update(existing.id!, {
          photoCount,
          updatedAt: Date.now()
        });
      }
    });
  }

  // ============================================================================
  // CLEANUP
  // ============================================================================

  /**
   * Clear all fields for a service (used when clearing cache)
   */
  async clearFieldsForService(serviceId: string): Promise<void> {
    await db.visualFields.where('serviceId').equals(serviceId).delete();
    console.log(`[VisualFieldRepo] Cleared all fields for service: ${serviceId}`);
  }

  /**
   * Mark all visual fields for a service as clean (not dirty)
   * Called after finalization to indicate all data is synced
   */
  async markAllCleanForService(serviceId: string): Promise<void> {
    await db.transaction('rw', db.visualFields, async () => {
      const fields = await db.visualFields.where('serviceId').equals(serviceId).toArray();
      for (const field of fields) {
        if (field.dirty) {
          await db.visualFields.update(field.id!, { dirty: false });
        }
      }
    });
    console.log(`[VisualFieldRepo] Marked all fields clean for service: ${serviceId}`);
  }

  /**
   * Clear all visual fields (full reset)
   */
  async clearAll(): Promise<void> {
    await db.visualFields.clear();
    console.log('[VisualFieldRepo] Cleared all visual fields');
  }
}
