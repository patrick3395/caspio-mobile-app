import { Injectable } from '@angular/core';

/**
 * Service for generating and managing temporary IDs
 * Used when creating records offline that need server-generated IDs
 */
@Injectable({
  providedIn: 'root'
})
export class TempIdService {
  private prefix = 'temp_';

  /**
   * Generate a temporary ID for a specific entity type
   * Format: temp_{type}_{timestamp}_{random}
   * Example: temp_visual_1702345678_k3j9d2a1x
   */
  generateTempId(type: 'visual' | 'efe' | 'project' | 'service' | 'hud' | 'lbw' | 'point'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 11);
    return `${this.prefix}${type}_${timestamp}_${random}`;
  }

  /**
   * Check if an ID is a temporary ID
   */
  isTempId(id: any): boolean {
    if (!id || typeof id !== 'string') {
      return false;
    }
    return id.startsWith(this.prefix);
  }

  /**
   * Extract type from temporary ID
   */
  getTempIdType(tempId: string): string | null {
    if (!this.isTempId(tempId)) {
      return null;
    }

    // Extract type from format: temp_{type}_{timestamp}_{random}
    const parts = tempId.split('_');
    return parts.length >= 2 ? parts[1] : null;
  }

  /**
   * Generate a placeholder object with temp ID
   */
  createPlaceholder(type: string, data: any): any {
    const tempId = this.generateTempId(type as any);
    return {
      ...data,
      PK_ID: tempId,
      _tempId: tempId,
      _localOnly: true,
      _syncing: true,
      _createdAt: Date.now(),
    };
  }
}

