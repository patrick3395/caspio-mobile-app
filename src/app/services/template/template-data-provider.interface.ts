import { Observable } from 'rxjs';
import { TemplateConfig } from './template-config.interface';

/**
 * Normalized visual record interface - works across all template types (HUD, EFE, LBW, DTE)
 */
export interface VisualRecord {
  id: string;
  templateId: number;
  serviceId: string;
  category: string;
  name: string;
  text: string;
  kind: 'Comment' | 'Limitation' | 'Deficiency';
  isSelected: boolean;
  answer?: string;
  notes?: string;
  // Temp ID tracking for offline-first
  _tempId?: string;
  _localOnly?: boolean;
  _syncing?: boolean;
}

/**
 * Normalized attachment record interface
 */
export interface AttachmentRecord {
  attachId: string;
  visualId: string;
  fileName: string;
  caption: string;
  drawings?: string;
  displayUrl: string;
  isLocal: boolean;
  isSynced: boolean;
}

/**
 * Result wrapper that includes cache/sync status
 */
export interface DataResult<T> {
  data: T;
  isFromCache: boolean;
  hasPendingSync: boolean;
}

/**
 * Sync event emitted when background sync completes
 */
export interface SyncEvent {
  serviceId?: string;
  reason: string;
}

/**
 * ITemplateDataProvider - Platform-agnostic interface for template data operations
 *
 * This abstract class defines the contract for all data operations.
 * Two implementations exist:
 * - WebappTemplateDataProvider: Direct API calls, no caching, no sync
 * - MobileTemplateDataProvider: Dexie-first, background sync, cache management
 *
 * Pages inject this via TEMPLATE_DATA_PROVIDER token and don't need to know
 * which implementation they're using.
 */
export abstract class ITemplateDataProvider {
  // ==================== Visual Operations ====================

  /**
   * Get all visuals for a service
   */
  abstract getVisuals(config: TemplateConfig, serviceId: string): Promise<DataResult<VisualRecord[]>>;

  /**
   * Get a single visual by ID
   */
  abstract getVisualById(config: TemplateConfig, visualId: string): Promise<VisualRecord | null>;

  /**
   * Get visuals filtered by category
   */
  abstract getVisualsForCategory(
    config: TemplateConfig,
    serviceId: string,
    category: string
  ): Promise<DataResult<VisualRecord[]>>;

  /**
   * Create a new visual record
   */
  abstract createVisual(config: TemplateConfig, visual: Partial<VisualRecord>): Promise<VisualRecord>;

  /**
   * Update an existing visual record
   */
  abstract updateVisual(
    config: TemplateConfig,
    visualId: string,
    updates: Partial<VisualRecord>,
    serviceId?: string
  ): Promise<VisualRecord>;

  /**
   * Delete a visual record
   */
  abstract deleteVisual(config: TemplateConfig, visualId: string, serviceId?: string): Promise<boolean>;

  // ==================== Attachment Operations ====================

  /**
   * Get attachments for a specific visual
   */
  abstract getAttachments(config: TemplateConfig, visualId: string): Promise<AttachmentRecord[]>;

  /**
   * Get all attachments for a service, grouped by visual ID
   */
  abstract getAttachmentsForService(
    config: TemplateConfig,
    serviceId: string
  ): Promise<Map<string, AttachmentRecord[]>>;

  /**
   * Create a new attachment
   */
  abstract createAttachment(config: TemplateConfig, attachment: Partial<AttachmentRecord>): Promise<AttachmentRecord>;

  /**
   * Update an attachment (caption, drawings, etc.)
   */
  abstract updateAttachment(
    config: TemplateConfig,
    attachId: string,
    updates: Partial<AttachmentRecord>
  ): Promise<AttachmentRecord>;

  /**
   * Delete an attachment
   */
  abstract deleteAttachment(config: TemplateConfig, attachId: string): Promise<boolean>;

  // ==================== Template Operations ====================

  /**
   * Get all templates for the template type
   */
  abstract getTemplates(config: TemplateConfig): Promise<any[]>;

  /**
   * Get templates filtered by category
   */
  abstract getTemplatesForCategory(config: TemplateConfig, category: string): Promise<any[]>;

  /**
   * Get dropdown options for multi-select fields
   */
  abstract getDropdownOptions(config: TemplateConfig): Promise<Map<number, string[]>>;

  // ==================== Service Operations ====================

  /**
   * Get service record by ID
   */
  abstract getService(serviceId: string): Promise<any>;

  /**
   * Update service record
   */
  abstract updateService(serviceId: string, updates: any): Promise<void>;

  // ==================== Raw Visual Operations ====================

  /**
   * Get raw (un-normalized) visual records for validation.
   * Returns backend records with fields like Selected, SelectedOptions, FK_Template, Answer.
   */
  abstract getRawVisuals(config: TemplateConfig, serviceId: string): Promise<any[]>;

  // ==================== Sync Operations ====================
  // These are meaningful on mobile, no-op on webapp

  /**
   * Observable that emits when sync completes
   * Webapp: Returns EMPTY (never emits)
   * Mobile: Emits when background sync completes
   */
  abstract onSyncComplete(): Observable<SyncEvent>;

  /**
   * Check if there are pending changes to sync
   * Webapp: Always returns false
   * Mobile: Checks pending request queue
   */
  abstract hasPendingChanges(serviceId: string): Promise<boolean>;

  /**
   * Force immediate sync
   * Webapp: No-op
   * Mobile: Triggers background sync
   */
  abstract forceSyncNow(): Promise<void>;

  // ==================== Cache Operations ====================
  // These are meaningful on mobile, no-op on webapp

  /**
   * Refresh cache from server
   * Webapp: No-op
   * Mobile: Downloads fresh data
   */
  abstract refreshCache(config: TemplateConfig, serviceId: string): Promise<void>;

  /**
   * Clear cached data
   * Webapp: No-op
   * Mobile: Clears IndexedDB cache
   */
  abstract clearCache(config: TemplateConfig, serviceId?: string): Promise<void>;
}
