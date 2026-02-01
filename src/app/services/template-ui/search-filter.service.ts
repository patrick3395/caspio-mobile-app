import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import { VisualItem } from './template-ui.interfaces';

/**
 * SearchFilterService - Unified search and filter logic for template pages
 *
 * This service provides search/filter functionality for category-detail pages.
 * It handles:
 * - Filtering items by search term
 * - Text highlighting with XSS protection
 * - Search state management
 *
 * Usage:
 *   constructor(private searchFilter: SearchFilterService) {}
 *
 *   // Filter items
 *   const filtered = this.searchFilter.filterItems(items, this.searchTerm);
 *
 *   // Highlight matching text
 *   const highlighted = this.searchFilter.highlightText(text, this.searchTerm);
 */
@Injectable({
  providedIn: 'root'
})
export class SearchFilterService {

  /**
   * Filter visual items by search term
   * Searches in name, text, and originalText fields
   *
   * @param items - Array of visual items to filter
   * @param searchTerm - Search term to filter by
   * @returns Filtered array of items matching the search term
   */
  filterItems(items: VisualItem[], searchTerm: string): VisualItem[] {
    if (!items) {
      return [];
    }

    if (!searchTerm || searchTerm.trim() === '') {
      return items;
    }

    const term = searchTerm.toLowerCase().trim();
    return items.filter(item => {
      const nameMatch = item.name?.toLowerCase().includes(term);
      const textMatch = item.text?.toLowerCase().includes(term);
      const originalTextMatch = item.originalText?.toLowerCase().includes(term);

      return nameMatch || textMatch || originalTextMatch;
    });
  }

  /**
   * Check if any items match the search term
   *
   * @param items - Array of visual items to check
   * @param searchTerm - Search term to check against
   * @returns True if any items match the search term
   */
  hasMatches(items: VisualItem[], searchTerm: string): boolean {
    return this.filterItems(items, searchTerm).length > 0;
  }

  /**
   * Get count of items matching the search term
   *
   * @param items - Array of visual items to count
   * @param searchTerm - Search term to filter by
   * @returns Number of matching items
   */
  getMatchCount(items: VisualItem[], searchTerm: string): number {
    return this.filterItems(items, searchTerm).length;
  }

  /**
   * Highlight matching text with XSS protection (web only)
   * Returns HTML string with <span class="highlight"> around matches
   *
   * @param text - Text to highlight
   * @param searchTerm - Search term to highlight
   * @returns HTML string with highlighted matches
   */
  highlightText(text: string | undefined, searchTerm: string): string {
    if (!text || !searchTerm || searchTerm.trim() === '') {
      // Escape HTML even when no search term to prevent XSS (web only)
      return environment.isWeb ? this.escapeHtml(text || '') : (text || '');
    }

    const term = searchTerm.trim();
    // First escape the text to prevent XSS (web only)
    const escapedText = environment.isWeb ? this.escapeHtml(text) : text;
    // Create a case-insensitive regex to find all matches
    const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi');

    // Replace matches with highlighted span
    return escapedText.replace(regex, '<span class="highlight">$1</span>');
  }

  /**
   * Escape HTML characters to prevent XSS (web only)
   * @param text - Text to escape
   * @returns Escaped text safe for HTML rendering
   */
  escapeHtml(text: string): string {
    if (!environment.isWeb) return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Escape special regex characters in search term
   * @param str - String to escape
   * @returns Escaped string safe for regex
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Check if a search is currently active
   * @param searchTerm - Search term to check
   * @returns True if search term is non-empty
   */
  isSearchActive(searchTerm: string): boolean {
    return !!searchTerm && searchTerm.trim() !== '';
  }

  /**
   * Normalize search term (trim and lowercase)
   * @param searchTerm - Search term to normalize
   * @returns Normalized search term
   */
  normalizeSearchTerm(searchTerm: string): string {
    return (searchTerm || '').toLowerCase().trim();
  }

  /**
   * Search across multiple fields with custom field names
   * Useful for items with non-standard field names
   *
   * @param item - Any object to search in
   * @param searchTerm - Search term to search for
   * @param fields - Array of field names to search in
   * @returns True if any field contains the search term
   */
  searchInFields(item: any, searchTerm: string, fields: string[]): boolean {
    if (!searchTerm || searchTerm.trim() === '') {
      return true; // No search term means include all
    }

    const term = searchTerm.toLowerCase().trim();
    return fields.some(field => {
      const value = item[field];
      return typeof value === 'string' && value.toLowerCase().includes(term);
    });
  }

  /**
   * Filter any array by search term in specified fields
   * Generic version of filterItems for non-VisualItem arrays
   *
   * @param items - Array of items to filter
   * @param searchTerm - Search term to filter by
   * @param fields - Field names to search in
   * @returns Filtered array
   */
  filterByFields<T>(items: T[], searchTerm: string, fields: string[]): T[] {
    if (!items) {
      return [];
    }

    if (!searchTerm || searchTerm.trim() === '') {
      return items;
    }

    return items.filter(item => this.searchInFields(item, searchTerm, fields));
  }
}
