import { TemplateConfig } from '../template-config.interface';

/**
 * CSA (Cost Segregation Analysis) Template Configuration
 *
 * CSA uses Dexie-first architecture with:
 * - Offline-first data storage in csaFields table
 * - Reactive UI via liveQuery subscriptions
 * - No custom visuals
 * - Explicit categories hub page
 * - Dynamic dropdowns from LPS_Services_CSA_Drop table
 */
export const CSA_CONFIG: TemplateConfig = {
  // Identity
  id: 'csa',
  displayName: 'Cost Segregation Analysis',
  routePrefix: 'csa',

  // Database Tables
  tableName: 'LPS_Services_CSA',
  attachTableName: 'LPS_Services_CSA_Attach',
  dropdownTableName: 'LPS_Services_CSA_Drop',
  templateTableName: 'LPS_Services_CSA_Templates',

  // Field Names
  idFieldName: 'CSAID',
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
    dynamicDropdowns: true,  // CSA uses LPS_Services_CSA_Drop table
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
      title: 'Cost Segregation Analysis',
      icon: 'calculator-outline',
      route: 'categories',
      description: 'CSA components and analysis items',
    },
  ],

  // Photo Handling
  entityType: 'csa',

  // IndexedDB Cache Keys
  templatesCacheKey: 'csa',
  visualsCacheKey: 'csa',

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
    photoUploadEvent: 'csaPhotoUploadComplete$',
    syncCompleteEvent: 'csaSyncComplete$',
  },

  // Route Parameters
  visualIdParamName: 'csaId',

  // Validation
  validation: {
    categorySectionName: 'Cost Segregation Analysis',
    hasElevationPlotValidation: false,
  },
};
