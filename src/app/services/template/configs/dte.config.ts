import { TemplateConfig } from '../template-config.interface';

/**
 * DTE (Damaged Truss Evaluation) Template Configuration
 *
 * DTE uses Dexie-first architecture with:
 * - Offline-first data storage in dteFields table
 * - Reactive UI via liveQuery subscriptions
 * - No custom visuals
 * - Explicit categories hub page
 * - Dynamic dropdowns from LPS_Services_DTE_Drop table
 */
export const DTE_CONFIG: TemplateConfig = {
  // Identity
  id: 'dte',
  displayName: 'Damaged Truss Evaluation',
  routePrefix: 'dte',

  // Database Tables
  tableName: 'LPS_Services_DTE',
  attachTableName: 'LPS_Services_DTE_Attach',
  dropdownTableName: 'LPS_Services_DTE_Drop',
  templateTableName: 'LPS_Services_DTE_Templates',

  // Field Names
  idFieldName: 'DTEID',
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
    dynamicDropdowns: true,  // DTE uses LPS_Services_DTE_Drop table
    offlineFirst: true,  // Dexie-first architecture enabled
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
      title: 'Damaged Truss Evaluation',
      icon: 'construct-outline',
      route: 'categories',
      description: 'DTE inspection checklist items and photos',
    },
  ],

  // Photo Handling
  entityType: 'dte',

  // IndexedDB Cache Keys
  templatesCacheKey: 'dte',
  visualsCacheKey: 'dte',

  // Category Hub Features
  categoryHubFeatures: {
    hasVisualLocationDropdown: false,
    navigationPattern: 'sibling',  // /categories -> /category/:cat
  },

  // Category Detail Features
  categoryDetailFeatures: {
    hasDexieFirstWithMutex: true,  // Dexie-first with mutex for concurrent access
    hasActualServiceId: false,
    supportsAddCustomVisual: true,
    hasLazyPhotoLoading: false,
    hasDebugPanel: false,
  },

  // Sync Events
  syncEvents: {
    photoUploadEvent: 'dtePhotoUploadComplete$',
    syncCompleteEvent: 'dteSyncComplete$',
  },

  // Route Parameters
  visualIdParamName: 'dteId',

  // Validation
  validation: {
    categorySectionName: 'Damaged Truss Evaluation',
    hasElevationPlotValidation: false,
  },
};
