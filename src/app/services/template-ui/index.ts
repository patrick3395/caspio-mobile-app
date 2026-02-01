/**
 * Template UI Services - Barrel Export
 *
 * This module provides unified UI services for template category-detail pages.
 * These services consolidate duplicated logic across HUD, DTE, LBW, and EFE templates.
 *
 * Services:
 * - AccordionStateService: Accordion expand/collapse state management
 * - SearchFilterService: Search filtering and text highlighting
 * - MultiSelectService: Multi-select dropdown handling
 * - PhotoUIService: Photo UI operations (delete, counts, states)
 * - VisualSelectionService: Visual item selection logic
 *
 * Interfaces:
 * - VisualItem: Visual field item structure
 * - OrganizedData: How items are organized in category pages
 * - ITemplateDataService: Abstraction for template data services
 * - TemplateCategoryConfig: Configuration for template-specific behavior
 *
 * Usage:
 *   import {
 *     AccordionStateService,
 *     SearchFilterService,
 *     MultiSelectService,
 *     PhotoUIService,
 *     VisualSelectionService,
 *     VisualItem,
 *     OrganizedData
 *   } from '../../services/template-ui';
 */

// Services
export { AccordionStateService } from './accordion-state.service';
export { SearchFilterService } from './search-filter.service';
export { MultiSelectService, OptionToggleContext, OptionToggleResult, AddOtherContext, AddOtherResult } from './multi-select.service';
export { PhotoUIService, PhotoDeleteContext, PhotoDeleteResult, PhotoStateMaps } from './photo-ui.service';
export { VisualSelectionService, ItemLookupResult, SelectionToggleResult } from './visual-selection.service';

// Interfaces
export {
  VisualItem,
  OrganizedData,
  ITemplateDataService,
  TemplateCategoryConfig,
  SectionType,
  DEFAULT_SECTIONS,
  DropdownOptionContext,
  MultiSelectToggleResult,
  PhotoDeleteConfig,
  ItemSelectionState
} from './template-ui.interfaces';
