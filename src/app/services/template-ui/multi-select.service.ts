import { Injectable, ChangeDetectorRef } from '@angular/core';
import { environment } from '../../../environments/environment';
import { VisualItem, MultiSelectToggleResult, DropdownOptionContext } from './template-ui.interfaces';

/**
 * Multi-select option toggle context - passed to onOptionToggle
 */
export interface OptionToggleContext {
  category: string;
  item: VisualItem;
  option: string;
  isChecked: boolean;
  selectedItems: { [key: string]: boolean };
  visualRecordIds: { [key: string]: string };
  visualDropdownOptions: { [templateId: number]: string[] };
}

/**
 * Result from processing an option toggle
 */
export interface OptionToggleResult {
  /** Updated answer string (comma-separated) */
  newAnswer: string;
  /** Array of selected options */
  selectedOptions: string[];
  /** The key used for tracking (category_id) */
  key: string;
  /** Whether the item should be selected */
  shouldSelect: boolean;
  /** Whether the otherValue should be cleared */
  clearOtherValue: boolean;
  /** Updated Dexie field data */
  dexieUpdate: {
    answer: string;
    isSelected: boolean;
  };
}

/**
 * Context for adding custom "Other" option
 */
export interface AddOtherContext {
  category: string;
  item: VisualItem;
  options: string[];
}

/**
 * Result from adding a custom "Other" option
 */
export interface AddOtherResult {
  success: boolean;
  /** Updated options array with custom value inserted */
  updatedOptions: string[];
  /** Updated answer string */
  newAnswer: string;
  /** Array of selected options */
  selectedOptions: string[];
  /** Whether the option already existed */
  alreadyExisted: boolean;
  /** The custom value that was added */
  customValue: string;
  /** Dexie update data */
  dexieUpdate: {
    answer: string;
    otherValue: string;
    isSelected: boolean;
    dropdownOptions: string[];
  };
}

/**
 * MultiSelectService - Unified multi-select dropdown logic
 *
 * This service provides stateless logic for multi-select dropdowns across all templates.
 * It handles:
 * - Option selection checking
 * - Option toggle logic with mutual exclusivity
 * - Custom "Other" value handling
 * - Dropdown options management
 *
 * The service returns results that the component applies to its state.
 * This keeps the service pure and testable while the component manages:
 * - State (selectedItems, savingItems, visualRecordIds, etc.)
 * - Data service calls (create/update visuals)
 * - Dexie persistence calls
 *
 * Usage:
 *   constructor(private multiSelect: MultiSelectService) {}
 *
 *   // Check if option is selected
 *   const isSelected = this.multiSelect.isOptionSelected(item, 'Option A');
 *
 *   // Process option toggle
 *   const result = this.multiSelect.processOptionToggle({
 *     category, item, option, isChecked, selectedItems, visualRecordIds, visualDropdownOptions
 *   });
 *   // Apply result.dexieUpdate, result.newAnswer, etc.
 */
@Injectable({
  providedIn: 'root'
})
export class MultiSelectService {

  /**
   * Check if an option is currently selected in the item's answer
   *
   * @param item - Visual item with answer field
   * @param option - Option to check
   * @returns True if the option is selected
   */
  isOptionSelected(item: VisualItem, option: string): boolean {
    if (!item.answer) return false;
    const selectedOptions = item.answer.split(',').map(o => o.trim());
    return selectedOptions.includes(option);
  }

  /**
   * Parse the answer string into an array of selected options
   *
   * @param answer - Comma-separated answer string
   * @returns Array of selected options
   */
  parseAnswer(answer: string | undefined): string[] {
    if (!answer) return [];
    return answer.split(',').map(o => o.trim()).filter(o => o);
  }

  /**
   * Build an answer string from an array of options
   *
   * @param options - Array of selected options
   * @returns Comma-separated answer string
   */
  buildAnswer(options: string[]): string {
    return options.join(', ');
  }

  /**
   * Generate the key used for tracking item state
   * WEBAPP: Uses category_itemId
   * MOBILE: Uses category_templateId
   *
   * @param category - Category name (use item.category or route param)
   * @param item - Visual item
   * @returns Key string for state maps
   */
  getItemKey(category: string, item: VisualItem): string {
    const actualCategory = item.category || category;
    return environment.isWeb
      ? `${actualCategory}_${item.id}`
      : `${actualCategory}_${item.templateId}`;
  }

  /**
   * Generate the key using the standard pattern (for addMultiSelectOther)
   * Always uses category_itemId pattern
   *
   * @param category - Category name from route params
   * @param itemId - Item ID
   * @returns Key string
   */
  getStandardKey(category: string, itemId: string | number): string {
    return `${category}_${itemId}`;
  }

  /**
   * Process an option toggle and return the result to apply
   *
   * Handles:
   * - "None" being mutually exclusive
   * - Removing "None" when selecting other options
   * - Clearing otherValue when "Other" is unchecked
   * - Auto-selecting/deselecting items based on selection state
   *
   * @param context - Toggle context with current state
   * @returns Result to apply to component state
   */
  processOptionToggle(context: OptionToggleContext): OptionToggleResult {
    const { category, item, option, isChecked } = context;
    const actualCategory = item.category || category;
    const key = this.getItemKey(category, item);

    // Parse current selections
    let selectedOptions = this.parseAnswer(item.answer);
    let clearOtherValue = false;

    if (isChecked) {
      if (option === 'None') {
        // "None" is mutually exclusive - clear all other selections
        selectedOptions = ['None'];
        clearOtherValue = true;
      } else {
        // Remove "None" if selecting any other option
        selectedOptions = selectedOptions.filter(o => o !== 'None');
        if (!selectedOptions.includes(option)) {
          selectedOptions.push(option);
        }
      }
    } else {
      selectedOptions = selectedOptions.filter(o => o !== option);
      if (option === 'Other') {
        clearOtherValue = true;
      }
    }

    const newAnswer = this.buildAnswer(selectedOptions);
    const shouldSelect = selectedOptions.length > 0 || !!(item.otherValue && item.otherValue !== '');

    return {
      newAnswer,
      selectedOptions,
      key,
      shouldSelect,
      clearOtherValue,
      dexieUpdate: {
        answer: newAnswer,
        isSelected: shouldSelect
      }
    };
  }

  /**
   * Check if an item should be hidden (no selections and no other value)
   *
   * @param answer - Current answer string
   * @param otherValue - Current other value
   * @returns True if the visual should be hidden
   */
  shouldHideVisual(answer: string | undefined, otherValue: string | undefined): boolean {
    return (!answer || answer === '') && (!otherValue || otherValue === '');
  }

  /**
   * Process adding a custom "Other" value
   *
   * Handles:
   * - Trimming and validating the custom value
   * - Checking for duplicates
   * - Inserting before "None" and "Other" options
   * - Removing "None" if adding a custom value (mutually exclusive)
   * - Selecting the new custom value
   *
   * @param context - Add other context
   * @returns Result to apply, or null if value is empty
   */
  processAddOther(context: AddOtherContext): AddOtherResult | null {
    const { category, item, options } = context;
    const customValue = item.otherValue?.trim();

    if (!customValue) {
      return null;
    }

    // Make a copy of options to modify
    const updatedOptions = [...options];

    // Parse current selections
    let selectedOptions = this.parseAnswer(item.answer);

    // Remove "None" if adding a custom value (mutually exclusive)
    selectedOptions = selectedOptions.filter(o => o !== 'None');

    let alreadyExisted = false;

    // Check if this value already exists in options
    if (updatedOptions.includes(customValue)) {
      alreadyExisted = true;
      // Just select it if not already selected
      if (!selectedOptions.includes(customValue)) {
        selectedOptions.push(customValue);
      }
    } else {
      // Add the custom value to options (before None and Other)
      const noneIndex = updatedOptions.indexOf('None');
      if (noneIndex > -1) {
        updatedOptions.splice(noneIndex, 0, customValue);
      } else {
        const otherIndex = updatedOptions.indexOf('Other');
        if (otherIndex > -1) {
          updatedOptions.splice(otherIndex, 0, customValue);
        } else {
          updatedOptions.push(customValue);
        }
      }

      // Select the new custom value
      selectedOptions.push(customValue);
    }

    const newAnswer = this.buildAnswer(selectedOptions);

    return {
      success: true,
      updatedOptions,
      newAnswer,
      selectedOptions,
      alreadyExisted,
      customValue,
      dexieUpdate: {
        answer: newAnswer,
        otherValue: '', // Clear input after adding
        isSelected: true,
        dropdownOptions: updatedOptions
      }
    };
  }

  /**
   * Get dropdown options with type-safe lookup
   * Handles both string and number templateId lookups
   *
   * @param templateId - Template ID to look up
   * @param optionsMap - Map of templateId to options array
   * @returns Array of options (empty if not found)
   */
  getDropdownOptions(templateId: number, optionsMap: { [key: number | string]: string[] }): string[] {
    // Try string key first (matches LBW pattern), then fall back to number
    const templateIdStr = String(templateId);
    return optionsMap[templateIdStr as any] || optionsMap[templateId] || [];
  }

  /**
   * Initialize options for a templateId if not already present
   *
   * @param templateId - Template ID
   * @param optionsMap - Map to initialize in
   * @returns The options array (newly created or existing)
   */
  ensureOptionsExist(templateId: number, optionsMap: { [key: number]: string[] }): string[] {
    if (!optionsMap[templateId]) {
      optionsMap[templateId] = [];
    }
    return optionsMap[templateId];
  }

  /**
   * Check if "Other" option should show the input field
   *
   * @param item - Visual item
   * @returns True if "Other" is selected
   */
  shouldShowOtherInput(item: VisualItem): boolean {
    return this.isOptionSelected(item, 'Other');
  }

  /**
   * Determine if item should remain selected based on current state
   *
   * @param selectedOptions - Currently selected options
   * @param otherValue - Current other value
   * @returns True if item should stay selected
   */
  shouldItemRemainSelected(selectedOptions: string[], otherValue: string | undefined): boolean {
    return selectedOptions.length > 0 || !!(otherValue && otherValue !== '');
  }

  /**
   * Build visual data object for creating a new visual
   *
   * @param item - Visual item
   * @param serviceId - Service ID (numeric)
   * @param category - Category name
   * @param templateIdField - Field name for template ID (varies by template type)
   * @returns Visual data object ready for API
   */
  buildVisualData(
    item: VisualItem,
    serviceId: number,
    category: string,
    templateIdField: string = 'TemplateID'
  ): any {
    const templateIdInt = typeof item.templateId === 'string'
      ? parseInt(item.templateId, 10)
      : Number(item.templateId);

    return {
      ServiceID: serviceId,
      Category: item.category || category,
      Kind: item.type,
      Name: item.name,
      Text: item.text || item.originalText || '',
      Notes: item.otherValue || '',
      Answers: item.answer,
      [templateIdField]: templateIdInt
    };
  }

  /**
   * Build update data for an existing visual
   *
   * @param answer - New answer string
   * @param notes - New notes/other value
   * @param hidden - Whether to hide the visual
   * @returns Update data object
   */
  buildUpdateData(answer: string, notes: string = '', hidden: boolean = false): any {
    return {
      Answers: answer,
      Notes: hidden ? 'HIDDEN' : notes
    };
  }
}
