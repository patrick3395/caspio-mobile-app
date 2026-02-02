import { TemplateConfig } from '../template-config.interface';

/**
 * EFE (Engineers Foundation Evaluation) Template Configuration
 *
 * EFE is similar to HUD with:
 * - Full offline-first support
 * - Complex sync with timeout handling
 * - Custom visuals
 * - Dynamic dropdown loading from API
 * - Elevation Plot subsystem (unique to EFE)
 */
export const EFE_CONFIG: TemplateConfig = {
  // Identity
  id: 'efe',
  displayName: 'Engineers Foundation',
  routePrefix: 'engineers-foundation',

  // Database Tables
  tableName: 'LPS_Services_Visuals',
  attachTableName: 'LPS_Services_Visuals_Attach',
  dropdownTableName: 'LPS_Services_Visuals_Drop',
  templateTableName: 'LPS_Services_Visuals_Templates',

  // Field Names
  idFieldName: 'VisualID',
  templateIdFieldName: 'TemplateID',
  serviceIdFieldName: 'ServiceID',

  // Features
  features: {
    hasAnnotations: true,
    hasCustomVisuals: true,
    hasElevationPlot: true,
    hasComplexSync: true,
    hasCountIndicators: false,
    hasCategoriesHub: false,
    dynamicDropdowns: true,
    offlineFirst: true,
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
      title: 'Structural Systems',
      icon: 'construct-outline',
      route: 'structural',
      description: 'Foundation and structural inspection items',
    },
    {
      title: 'Elevation Plot',
      icon: 'analytics-outline',
      route: 'elevation',
      description: 'Room elevation measurements and analysis',
    },
  ],

  // Photo Handling
  entityType: 'visual',

  // IndexedDB Cache Keys
  templatesCacheKey: 'visual',
  visualsCacheKey: 'visual',

  // Category Hub Features (unique to EFE)
  categoryHubFeatures: {
    hasVisualLocationDropdown: true,
    visualLocationFieldName: 'StructStat',
    completedHereValue: 'Completed Here',
    providedElsewhereValue: 'Provided in Property Inspection Report',
    navigationPattern: 'nested',  // /structural -> /structural/category/:cat
  },

  // Category Detail Features
  categoryDetailFeatures: {
    hasDexieFirstWithMutex: true,
    hasActualServiceId: false,  // EFE uses route serviceId directly (matches original behavior)
    supportsAddCustomVisual: true,
    hasLazyPhotoLoading: true,
    hasDebugPanel: true,
  },

  // Sync Events
  syncEvents: {
    photoUploadEvent: 'photoUploadComplete$',
    syncCompleteEvent: 'visualSyncComplete$',
  },

  // Route Parameters
  visualIdParamName: 'visualId',
};
