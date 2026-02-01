import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { VisualItem, OrganizedData, ItemSelectionState } from './template-ui.interfaces';

/**
 * Item lookup result
 */
export interface ItemLookupResult {
  item: VisualItem | undefined;
  found: boolean;
  key: string;
  actualCategory: string;
}

/**
 * Selection toggle result
 */
export interface SelectionToggleResult {
  key: string;
  newState: boolean;
  actualCategory: string;
  templateId: number;
  dexieUpdate: {
    isSelected: boolean;
    category: string;
    templateName: string;
    templateText: string;
    kind: 'Comment' | 'Limitation' | 'Deficiency';
  };
}

/**
 * VisualSelectionService - Unified visual item selection logic
 *
 * This service provides:
 * - Item selection state checking
 * - Selection count tracking
 * - Item lookup in organized data
 * - Key generation for selection tracking
 *
 * The service handles the stateless logic while the component manages:
 * - State maps (selectedItems, savingItems)
 * - Dexie persistence calls
 * - Data service calls (create/update visuals)
 *
 * Usage:
 *   constructor(private visualSelection: VisualSelectionService) {}
 *
 *   // Check if item is selected
 *   const isSelected = this.visualSelection.isItemSelected(
 *     category, itemId, selectedItems, organizedData
 *   );
 *
 *   // Get selected count
 *   const count = this.visualSelection.getSelectedCount(items, categoryName, selectedItems, organizedData);
 */
@Injectable({
  providedIn: 'root'
})
export class VisualSelectionService {

  /**
   * Generate the key used for item selection tracking
   *
   * @param category - Category name
   * @param itemId - Item ID (can be templateId or id)
   * @returns Key string (category_itemId)
   */
  getSelectionKey(category: string, itemId: string | number): string {
    return `${category}_${itemId}`;
  }

  /**
   * Find an item by templateId or id in organized data
   *
   * @param itemId - ID to search for (can be templateId or id)
   * @param organizedData - Organized data containing all items
   * @returns Found item or undefined
   */
  findItemById(itemId: string | number, organizedData: OrganizedData): VisualItem | undefined {
    if (!organizedData) return undefined;

    const allItems = [
      ...(organizedData.comments || []),
      ...(organizedData.limitations || []),
      ...(organizedData.deficiencies || [])
    ];

    // Search by templateId first (what the template passes), then by id
    return allItems.find(item => item.templateId === itemId || item.id === itemId);
  }

  /**
   * Find an item by templateId specifically
   *
   * @param templateId - Template ID to search for
   * @param organizedData - Organized data containing all items
   * @returns Found item or undefined
   */
  findItemByTemplateId(templateId: number, organizedData: OrganizedData): VisualItem | undefined {
    if (!organizedData) return undefined;

    const allItems = [
      ...(organizedData.comments || []),
      ...(organizedData.limitations || []),
      ...(organizedData.deficiencies || [])
    ];

    return allItems.find(item => item.templateId === templateId);
  }

  /**
   * Check if an item is selected
   * Handles multiple key patterns (LBW, HUD) for backwards compatibility
   *
   * @param category - Category name (from route params)
   * @param itemId - Item ID to check
   * @param selectedItems - Map of selected items
   * @param organizedData - Organized data for item lookup
   * @returns True if the item is selected
   */
  isItemSelected(
    category: string,
    itemId: string | number,
    selectedItems: { [key: string]: boolean },
    organizedData: OrganizedData
  ): boolean {
    const key = this.getSelectionKey(category, itemId);

    // Check primary key first
    if (selectedItems[key]) {
      return true;
    }

    // Find the item to check additional keys
    const item = this.findItemById(itemId, organizedData);

    // LBW PATTERN FIX: For custom items, the key is stored with item.id
    // but this method may be called with item.templateId
    if (item && item.id && item.id !== itemId) {
      const itemIdKey = this.getSelectionKey(category, item.id);
      if (selectedItems[itemIdKey]) {
        return true;
      }
      // Also check with item's actual category
      if (item.category && item.category !== category) {
        const itemCategoryIdKey = this.getSelectionKey(item.category, item.id);
        if (selectedItems[itemCategoryIdKey]) {
          return true;
        }
      }
    }

    // HUD FIX: Also check using the item's actual category
    // because selectedItems may be stored with actual category
    // but template passes route category
    if (item && item.category && item.category !== category) {
      const itemCategoryKey = this.getSelectionKey(item.category, itemId);
      if (selectedItems[itemCategoryKey]) {
        return true;
      }
    }

    if (!item) {
      return false;
    }

    // For answerType 1: Check if answer is selected (Yes or No)
    if (item.answerType === 1 && item.answer && item.answer !== '') {
      return true;
    }

    // For answerType 2: Check if any options are selected
    if (item.answerType === 2 && item.answer && item.answer !== '') {
      return true;
    }

    return false;
  }

  /**
   * Count how many items are selected in a list
   *
   * @param items - Array of items to count
   * @param categoryName - Category name to use for key lookup
   * @param selectedItems - Map of selected items
   * @param organizedData - Organized data for item lookup
   * @returns Number of selected items
   */
  getSelectedCount(
    items: VisualItem[],
    categoryName: string,
    selectedItems: { [key: string]: boolean },
    organizedData: OrganizedData
  ): number {
    if (!items) return 0;
    return items.filter(item =>
      this.isItemSelected(categoryName, item.templateId, selectedItems, organizedData)
    ).length;
  }

  /**
   * Get counts for all sections
   *
   * @param organizedData - Organized data containing all items
   * @param categoryName - Category name for key lookup
   * @param selectedItems - Map of selected items
   * @returns Object with counts for each section
   */
  getSectionCounts(
    organizedData: OrganizedData,
    categoryName: string,
    selectedItems: { [key: string]: boolean }
  ): { comments: number; limitations: number; deficiencies: number; total: number } {
    const comments = this.getSelectedCount(organizedData.comments, categoryName, selectedItems, organizedData);
    const limitations = this.getSelectedCount(organizedData.limitations, categoryName, selectedItems, organizedData);
    const deficiencies = this.getSelectedCount(organizedData.deficiencies, categoryName, selectedItems, organizedData);

    return {
      comments,
      limitations,
      deficiencies,
      total: comments + limitations + deficiencies
    };
  }

  /**
   * Prepare a selection toggle operation
   * Returns the data needed to perform the toggle
   *
   * @param category - Category name (from route params)
   * @param itemId - Item ID to toggle
   * @param selectedItems - Current selected items map
   * @param organizedData - Organized data for item lookup
   * @returns Toggle result with key, new state, and Dexie update data
   */
  prepareToggle(
    category: string,
    itemId: string | number,
    selectedItems: { [key: string]: boolean },
    organizedData: OrganizedData
  ): SelectionToggleResult {
    const templateId = typeof itemId === 'string' ? parseInt(itemId, 10) : itemId;
    const item = this.findItemByTemplateId(templateId, organizedData);
    const actualCategory = item?.category || category;

    // Use actualCategory for key to match how visualRecordIds work
    const key = this.getSelectionKey(actualCategory, itemId);
    const newState = !selectedItems[key];

    return {
      key,
      newState,
      actualCategory,
      templateId,
      dexieUpdate: {
        isSelected: newState,
        category: actualCategory,
        templateName: item?.name || '',
        templateText: item?.text || item?.originalText || '',
        kind: (item?.type as 'Comment' | 'Limitation' | 'Deficiency') || 'Comment'
      }
    };
  }

  /**
   * Apply a selection toggle to the selectedItems map
   *
   * @param result - Toggle result from prepareToggle
   * @param selectedItems - Selected items map to update
   */
  applyToggle(result: SelectionToggleResult, selectedItems: { [key: string]: boolean }): void {
    selectedItems[result.key] = result.newState;
  }

  /**
   * Set selection state for an item
   *
   * @param category - Category name
   * @param itemId - Item ID
   * @param isSelected - New selection state
   * @param selectedItems - Selected items map to update
   */
  setSelected(
    category: string,
    itemId: string | number,
    isSelected: boolean,
    selectedItems: { [key: string]: boolean }
  ): void {
    const key = this.getSelectionKey(category, itemId);
    selectedItems[key] = isSelected;
  }

  /**
   * Clear all selections
   *
   * @param selectedItems - Selected items map to clear
   */
  clearAllSelections(selectedItems: { [key: string]: boolean }): void {
    for (const key of Object.keys(selectedItems)) {
      selectedItems[key] = false;
    }
  }

  /**
   * Get all selected item keys
   *
   * @param selectedItems - Selected items map
   * @returns Array of keys for selected items
   */
  getSelectedKeys(selectedItems: { [key: string]: boolean }): string[] {
    return Object.keys(selectedItems).filter(key => selectedItems[key]);
  }

  /**
   * Check if any items are selected
   *
   * @param selectedItems - Selected items map
   * @returns True if any items are selected
   */
  hasAnySelected(selectedItems: { [key: string]: boolean }): boolean {
    return Object.values(selectedItems).some(v => v);
  }

  /**
   * Populate selectedItems from existing visual data
   * Use during initialization to restore selection state
   *
   * @param visuals - Array of visual records from API
   * @param categoryName - Category name for key generation
   * @param selectedItems - Selected items map to populate
   * @param idField - Which field to use for ID ('templateId' or 'id')
   */
  populateFromVisuals(
    visuals: any[],
    categoryName: string,
    selectedItems: { [key: string]: boolean },
    idField: 'templateId' | 'id' = 'templateId'
  ): void {
    for (const visual of visuals) {
      const itemId = idField === 'templateId' ? visual.HUDTemplateID : visual.id;
      if (itemId) {
        const key = this.getSelectionKey(categoryName, itemId);
        selectedItems[key] = true;
      }
    }
  }

  /**
   * Set saving state for an item
   *
   * @param category - Category name
   * @param itemId - Item ID
   * @param isSaving - New saving state
   * @param savingItems - Saving items map to update
   */
  setSaving(
    category: string,
    itemId: string | number,
    isSaving: boolean,
    savingItems: { [key: string]: boolean }
  ): void {
    const key = this.getSelectionKey(category, itemId);
    savingItems[key] = isSaving;
  }

  /**
   * Check if an item is currently saving
   *
   * @param category - Category name
   * @param itemId - Item ID
   * @param savingItems - Saving items map
   * @param organizedData - Organized data for item lookup (optional, for category fallback)
   * @returns True if the item is saving
   */
  isSaving(
    category: string,
    itemId: string | number,
    savingItems: { [key: string]: boolean },
    organizedData?: OrganizedData
  ): boolean {
    const key = this.getSelectionKey(category, itemId);
    if (savingItems[key]) {
      return true;
    }

    // HUD FIX: Also check using item's actual category
    if (organizedData) {
      const item = this.findItemById(itemId, organizedData);
      if (item && item.category && item.category !== category) {
        const itemCategoryKey = this.getSelectionKey(item.category, itemId);
        return savingItems[itemCategoryKey] || false;
      }
    }

    return false;
  }
}
