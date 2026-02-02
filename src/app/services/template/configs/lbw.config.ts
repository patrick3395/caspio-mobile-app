import { TemplateConfig } from '../template-config.interface';

/**
 * LBW (Load Bearing Wall) Template Configuration
 *
 * LBW is a simpler template with:
 * - Basic online sync (no complex offline-first)
 * - No custom visuals
 * - Explicit categories hub page
 * - Hardcoded dropdown options
 */
export const LBW_CONFIG: TemplateConfig = {
  // Identity
  id: 'lbw',
  displayName: 'Load Bearing Wall',
  routePrefix: 'lbw',

  // Database Tables
  tableName: 'LPS_Services_LBW',
  attachTableName: 'LPS_Services_LBW_Attach',
  dropdownTableName: 'LPS_Services_LBW_Drop',
  templateTableName: 'LPS_Services_LBW_Templates',

  // Field Names
  idFieldName: 'LBWID',
  templateIdFieldName: 'TemplateID',
  serviceIdFieldName: 'ServiceID',

  // Features
  features: {
    hasAnnotations: true,
    hasCustomVisuals: false,
    hasElevationPlot: false,
    hasComplexSync: false,
    hasCountIndicators: false,
    hasCategoriesHub: true,
    dynamicDropdowns: true,  // LBW uses LPS_Services_LBW_Drop table
    offlineFirst: false,
  },

  // Navigation Cards
  navigationCards: [
    {
      title: 'Project Details',
      icon: 'document-text-outline',
      route: 'project-details',
      description: 'Property information and inspection details',
    },
    {
      title: 'Load Bearing Wall',
      icon: 'construct-outline',
      route: 'categories',
      description: 'LBW inspection checklist items and photos',
    },
  ],

  // Photo Handling
  entityType: 'lbw',

  // IndexedDB Cache Keys
  templatesCacheKey: 'lbw',
  visualsCacheKey: 'lbw',

  // Category Hub Features
  categoryHubFeatures: {
    hasVisualLocationDropdown: false,
    navigationPattern: 'sibling',  // /categories -> /category/:cat
  },

  // Category Detail Features
  categoryDetailFeatures: {
    hasDexieFirstWithMutex: false,
    hasActualServiceId: false,
    supportsAddCustomVisual: true,
    hasLazyPhotoLoading: false,
    hasDebugPanel: false,
  },

  // Sync Events
  syncEvents: {
    photoUploadEvent: 'lbwPhotoUploadComplete$',
    syncCompleteEvent: 'lbwSyncComplete$',
  },

  // Route Parameters
  visualIdParamName: 'lbwId',
};
