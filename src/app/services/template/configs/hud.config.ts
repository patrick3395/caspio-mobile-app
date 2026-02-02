import { TemplateConfig } from '../template-config.interface';

/**
 * HUD (Mobile/Manufactured Homes) Template Configuration
 *
 * HUD is the most feature-rich template with:
 * - Full offline-first support
 * - Complex sync with timeout handling
 * - Custom visuals
 * - Count indicators on main page
 * - Dynamic dropdown loading from API
 */
export const HUD_CONFIG: TemplateConfig = {
  // Identity
  id: 'hud',
  displayName: 'HUD / Mobile Manufactured',
  routePrefix: 'hud',

  // Database Tables
  tableName: 'LPS_Services_HUD',
  attachTableName: 'LPS_Services_HUD_Attach',
  dropdownTableName: 'LPS_Services_HUD_Drop',
  templateTableName: 'LPS_Services_HUD_Templates',

  // Field Names
  idFieldName: 'HUDID',
  templateIdFieldName: 'TemplateID',
  serviceIdFieldName: 'ServiceID',

  // Features
  features: {
    hasAnnotations: true,
    hasCustomVisuals: true,
    hasElevationPlot: false,
    hasComplexSync: true,
    hasCountIndicators: true,
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
      title: 'HUD / Mobile Manufactured',
      icon: 'construct-outline',
      route: 'category/hud',
      description: 'HUD inspection checklist items and photos',
    },
  ],

  // Photo Handling
  entityType: 'hud',

  // IndexedDB Cache Keys
  templatesCacheKey: 'hud',
  visualsCacheKey: 'hud',

  // Category Detail Features
  categoryDetailFeatures: {
    hasDexieFirstWithMutex: true,
    hasActualServiceId: true,
    supportsAddCustomVisual: true,
    hasLazyPhotoLoading: true,
    hasDebugPanel: true,
  },

  // Sync Events
  syncEvents: {
    photoUploadEvent: 'hudPhotoUploadComplete$',
    syncCompleteEvent: 'hudSyncComplete$',
  },

  // Route Parameters
  visualIdParamName: 'hudId',
};
