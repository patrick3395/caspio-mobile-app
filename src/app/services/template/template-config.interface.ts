import { ImageEntityType } from '../indexed-db.service';

/**
 * Navigation card configuration for main page
 */
export interface NavigationCard {
  title: string;
  icon: string;
  route: string;
  description: string;
  completed?: boolean;
  /** Show count indicator (e.g., comments count) */
  countKey?: 'comments' | 'limitations' | 'deficiencies';
}

/**
 * Template-specific configuration that drives generic pages
 *
 * This configuration determines how generic pages behave for each template type.
 * Instead of duplicating page code, we use this config to parameterize behavior.
 */
export interface TemplateConfig {
  // ==================== Identity ====================
  /** Unique identifier for this template type */
  id: 'hud' | 'efe' | 'lbw' | 'dte';

  /** Display name shown in UI */
  displayName: string;

  /** Route prefix (e.g., 'hud', 'engineers-foundation') */
  routePrefix: string;

  // ==================== Database Tables ====================
  /** Main visuals table name (e.g., 'LPS_Services_HUD') */
  tableName: string;

  /** Attachments table name (e.g., 'LPS_Services_HUD_Attach') */
  attachTableName: string;

  /** Dropdown options table name (e.g., 'LPS_Services_HUD_Drop') */
  dropdownTableName: string;

  /** Templates table name (e.g., 'LPS_Services_HUD_Templates') */
  templateTableName: string;

  // ==================== Field Names ====================
  /** Primary ID field name in visuals table (e.g., 'HUDID', 'VisualID', 'LBWID', 'DTEID') */
  idFieldName: string;

  /** Template ID field name (e.g., 'HUDTemplateID', 'VisualTemplateID') */
  templateIdFieldName: string;

  /** Foreign key to main services table */
  serviceIdFieldName: string;

  // ==================== Features ====================
  features: {
    /** Enable photo annotations (all templates currently support this) */
    hasAnnotations: boolean;

    /** Allow creating custom visuals via "Add Custom" button (HUD/EFE only) */
    hasCustomVisuals: boolean;

    /** Has elevation plot subsystem (EFE only) */
    hasElevationPlot: boolean;

    /** Use complex sync with timeout handling (HUD/EFE) vs simple sync (LBW/DTE) */
    hasComplexSync: boolean;

    /** Show count indicators on main page cards (HUD only) */
    hasCountIndicators: boolean;

    /** Has explicit categories hub page before category-detail (LBW/DTE) */
    hasCategoriesHub: boolean;

    /** Load dropdowns from API (HUD/EFE) vs hardcoded arrays (LBW/DTE) */
    dynamicDropdowns: boolean;

    /** Support offline-first with Dexie (HUD/EFE) vs simple online-only (LBW/DTE) */
    offlineFirst: boolean;
  };

  // ==================== Navigation ====================
  /** Cards to show on main page */
  navigationCards: NavigationCard[];

  // ==================== Photo Handling ====================
  /** Entity type for photo/image services */
  entityType: ImageEntityType;

  // ==================== IndexedDB Cache Keys ====================
  /** Cache key prefix for templates */
  templatesCacheKey: string;

  /** Cache key prefix for visuals */
  visualsCacheKey: string;
}

/**
 * Template type literal union for type safety
 */
export type TemplateType = TemplateConfig['id'];

/**
 * Map of all template configs by ID
 */
export type TemplateConfigMap = {
  [K in TemplateType]: TemplateConfig;
};
