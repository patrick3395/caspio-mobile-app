/**
 * Template UI Shared Interfaces
 *
 * These interfaces are used across all template category-detail pages.
 * They provide a common contract for visual items, data services, and configuration.
 */

import { ImageEntityType } from '../indexed-db.service';

/**
 * Visual Item - represents a single visual field item in category-detail pages
 * This interface is used across HUD, DTE, LBW, and EFE templates
 */
export interface VisualItem {
  id: string | number;
  templateId: number;
  name: string;
  text: string;
  originalText: string;
  type: string;
  category: string;
  answerType: number;
  required: boolean;
  answer?: string;
  isSelected?: boolean;
  isSaving?: boolean;
  photos?: any[];
  otherValue?: string;
  key?: string;
}

/**
 * Organized Data structure - how visual items are organized in category-detail pages
 */
export interface OrganizedData {
  comments: VisualItem[];
  limitations: VisualItem[];
  deficiencies: VisualItem[];
}

/**
 * Template Data Service Interface - abstraction over template-specific data services
 *
 * Each template (HUD, DTE, LBW, EFE) has its own data service that implements this interface.
 * This allows the shared UI services to work with any template's data service.
 */
export interface ITemplateDataService {
  /**
   * Create a new visual record
   */
  createVisual(data: any): Promise<any>;

  /**
   * Update an existing visual record
   */
  updateVisual(id: string, data: any, serviceId: string): Promise<any>;

  /**
   * Get all visuals for a service
   */
  getVisualsForService(serviceId: string): Promise<any[]>;

  /**
   * Clear service-related caches
   */
  clearServiceCaches?(serviceId: string): void;
}

/**
 * Template Category Configuration - defines template-specific behavior
 *
 * Each category-detail page creates a config object to pass to shared services.
 */
export interface TemplateCategoryConfig {
  /** Template type identifier */
  templateType: 'hud' | 'dte' | 'lbw' | 'efe';

  /** Entity type for photo handling */
  entityType: ImageEntityType;

  /** Which field to use for item ID keys */
  idField: 'templateId' | 'id';

  /** Service ID from route params */
  serviceId: string;

  /** Actual service ID field (if different from route param) */
  actualServiceId?: string;

  /** Category name from route params */
  categoryName: string;

  /** Project ID from route params */
  projectId?: string;

  /** Data service instance (injected) */
  dataService?: ITemplateDataService;
}

/**
 * Section identifiers used across all templates
 */
export type SectionType = 'information' | 'limitations' | 'deficiencies';

/**
 * Default sections for accordion initialization
 */
export const DEFAULT_SECTIONS: SectionType[] = ['information', 'limitations', 'deficiencies'];

/**
 * Dropdown option with category context
 */
export interface DropdownOptionContext {
  templateId: number;
  options: string[];
  category: string;
}

/**
 * Multi-select toggle result
 */
export interface MultiSelectToggleResult {
  success: boolean;
  newAnswer: string;
  selectedOptions: string[];
  error?: string;
}

/**
 * Photo deletion config
 */
export interface PhotoDeleteConfig {
  entityType: ImageEntityType;
  serviceId: string;
  categoryName: string;
  itemId: string | number;
  onDeleteComplete?: () => void;
  onDeleteError?: (error: any) => void;
}

/**
 * Item selection state
 */
export interface ItemSelectionState {
  selectedItems: { [key: string]: boolean };
  savingItems: { [key: string]: boolean };
}
