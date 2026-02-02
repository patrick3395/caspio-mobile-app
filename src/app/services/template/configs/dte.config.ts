import { TemplateConfig } from '../template-config.interface';

/**
 * DTE (Damaged Truss Evaluation) Template Configuration
 *
 * DTE is the simplest template with:
 * - Basic online sync (no complex offline-first)
 * - No custom visuals
 * - Explicit categories hub page
 * - Hardcoded dropdown options
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
    dynamicDropdowns: false,
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
};
