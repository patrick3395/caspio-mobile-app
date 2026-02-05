import { Injectable, ChangeDetectorRef } from '@angular/core';
import { ConfirmationDialogService } from '../confirmation-dialog.service';
import { IndexedDbService } from '../indexed-db.service';
import { LocalImageService } from '../local-image.service';
import { environment } from '../../../environments/environment';

/**
 * Photo deletion context - passed from component
 */
export interface PhotoDeleteContext {
  /** The photo object to delete */
  photo: any;
  /** Category name */
  category: string;
  /** Item ID the photo belongs to */
  itemId: string | number;
  /** Visual photos map from component */
  visualPhotos: { [key: string]: any[] };
  /** Photo counts map from component */
  photoCountsByKey: { [key: string]: number };
  /** Change detector for UI updates */
  changeDetectorRef?: ChangeDetectorRef;
  /** Data service delete method (template-specific) */
  deleteVisualPhoto: (attachId: string) => Promise<void>;
}

/**
 * Photo deletion result
 */
export interface PhotoDeleteResult {
  success: boolean;
  deleted: boolean;
  error?: any;
}

/**
 * Photo state tracking maps
 */
export interface PhotoStateMaps {
  uploadingPhotosByKey: { [key: string]: boolean };
  loadingPhotosByKey: { [key: string]: boolean };
  savingPhotosByKey?: { [key: string]: boolean };
  expandedPhotos: { [key: string]: boolean };
}

/**
 * PhotoUIService - Unified photo UI operations for template pages
 *
 * This service provides:
 * - Photo deletion with confirmation dialog
 * - Photo state tracking utilities (loading, uploading, saving)
 * - Photo count helpers
 * - Key generation for photo tracking
 *
 * It leverages the existing ConfirmationDialogService for delete confirmations
 * and coordinates with IndexedDbService and LocalImageService for cleanup.
 *
 * Usage:
 *   constructor(private photoUI: PhotoUIService) {}
 *
 *   // Delete a photo with confirmation
 *   await this.photoUI.deletePhotoWithConfirmation({
 *     photo, category, itemId, visualPhotos, photoCountsByKey, deleteVisualPhoto: this.hudData.deleteVisualPhoto.bind(this.hudData)
 *   });
 *
 *   // Check if uploading
 *   const isUploading = this.photoUI.isUploading(key, uploadingPhotosByKey);
 */
@Injectable({
  providedIn: 'root'
})
export class PhotoUIService {

  constructor(
    private confirmationDialog: ConfirmationDialogService,
    private indexedDb: IndexedDbService,
    private localImageService: LocalImageService
  ) {}

  /**
   * Generate the key used for photo tracking
   *
   * @param category - Category name
   * @param itemId - Item ID
   * @returns Key string (category_itemId)
   */
  getPhotoKey(category: string, itemId: string | number): string {
    return `${category}_${itemId}`;
  }

  /**
   * Check if photos are currently uploading for a key
   *
   * @param key - Photo key
   * @param uploadingMap - Map of uploading states
   * @returns True if uploading
   */
  isUploading(key: string, uploadingMap: { [key: string]: boolean }): boolean {
    return !!uploadingMap[key];
  }

  /**
   * Check if photos are currently loading for a key
   *
   * @param key - Photo key
   * @param loadingMap - Map of loading states
   * @returns True if loading
   */
  isLoading(key: string, loadingMap: { [key: string]: boolean }): boolean {
    return !!loadingMap[key];
  }

  /**
   * Check if an item is currently saving
   *
   * @param category - Category name
   * @param itemId - Item ID
   * @param savingMap - Map of saving states
   * @returns True if saving
   */
  isItemSaving(category: string, itemId: string | number, savingMap: { [key: string]: boolean }): boolean {
    const key = this.getPhotoKey(category, itemId);
    return !!savingMap[key];
  }

  /**
   * Get photo count for a key
   *
   * @param key - Photo key
   * @param photosMap - Map of photos arrays
   * @returns Number of photos
   */
  getPhotoCount(key: string, photosMap: { [key: string]: any[] }): number {
    return photosMap[key]?.length || 0;
  }

  /**
   * Get photo count from counts map
   *
   * @param key - Photo key
   * @param countsMap - Map of photo counts
   * @returns Number of photos
   */
  getPhotoCountFromMap(key: string, countsMap: { [key: string]: number }): number {
    return countsMap[key] || 0;
  }

  /**
   * Check if photo section is expanded
   *
   * @param key - Photo key
   * @param expandedMap - Map of expanded states
   * @returns True if expanded
   */
  isPhotoSectionExpanded(key: string, expandedMap: { [key: string]: boolean }): boolean {
    return !!expandedMap[key];
  }

  /**
   * Toggle photo section expansion
   *
   * @param key - Photo key
   * @param expandedMap - Map of expanded states
   * @returns New expanded state
   */
  togglePhotoSection(key: string, expandedMap: { [key: string]: boolean }): boolean {
    expandedMap[key] = !expandedMap[key];
    return expandedMap[key];
  }

  /**
   * Show photo delete confirmation dialog
   *
   * @returns Promise that resolves to true if user confirmed deletion
   */
  async confirmPhotoDelete(): Promise<boolean> {
    const result = await this.confirmationDialog.confirmDelete({
      header: 'Delete Photo',
      message: 'Are you sure you want to delete this photo?',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true
    });
    return result.confirmed;
  }

  /**
   * Delete a photo with confirmation dialog
   * Handles both local-first and legacy photos
   *
   * @param context - Delete context with photo data and callbacks
   * @returns Result indicating success/failure
   */
  async deletePhotoWithConfirmation(context: PhotoDeleteContext): Promise<PhotoDeleteResult> {
    const {
      photo,
      category,
      itemId,
      visualPhotos,
      photoCountsByKey,
      changeDetectorRef,
      deleteVisualPhoto
    } = context;

    try {
      // Show confirmation dialog
      const confirmed = await this.confirmPhotoDelete();

      if (!confirmed) {
        return { success: true, deleted: false };
      }

      // OFFLINE-FIRST: Immediate UI update
      const key = this.getPhotoKey(category, itemId);

      // Remove from UI immediately (optimistic update)
      if (visualPhotos[key]) {
        visualPhotos[key] = visualPhotos[key].filter(
          (p: any) => p.AttachID !== photo.AttachID
        );
        // Update photo count immediately
        photoCountsByKey[key] = visualPhotos[key].length;
      }

      // Force UI update
      if (changeDetectorRef) {
        changeDetectorRef.detectChanges();
      }

      // Clear cached photo IMAGE from IndexedDB
      await this.indexedDb.deleteCachedPhoto(String(photo.AttachID));

      // Remove from cached ATTACHMENTS LIST in IndexedDB
      await this.indexedDb.removeAttachmentFromCache(String(photo.AttachID), 'visual_attachments');

      // Handle LocalImage (new local-first system) deletion
      const isLocalFirstPhoto = this.isLocalFirstPhoto(photo);

      if (isLocalFirstPhoto) {
        await this.deleteLocalFirstPhoto(photo, deleteVisualPhoto);
      }
      // Legacy photo deletion
      else if (photo.AttachID && !String(photo.AttachID).startsWith('temp_')) {
        await deleteVisualPhoto(photo.AttachID);
      }

      return { success: true, deleted: true };
    } catch (error) {
      console.error('[PhotoUI] Error deleting photo:', error);
      return { success: false, deleted: false, error };
    }
  }

  /**
   * Check if a photo is from the local-first system
   *
   * @param photo - Photo object
   * @returns True if local-first photo
   */
  isLocalFirstPhoto(photo: any): boolean {
    return photo.isLocalFirst ||
      photo.isLocalImage ||
      photo.localImageId ||
      (photo.imageId && String(photo.imageId).startsWith('img_'));
  }

  /**
   * Delete a local-first photo
   * Handles both local deletion and server sync
   *
   * @param photo - Photo object
   * @param deleteVisualPhoto - Server delete function
   */
  private async deleteLocalFirstPhoto(
    photo: any,
    deleteVisualPhoto: (attachId: string) => Promise<void>
  ): Promise<void> {
    const localImageId = photo.localImageId || photo.imageId;

    // CRITICAL: Get LocalImage data BEFORE deleting to check if server deletion is needed
    const localImage = await this.indexedDb.getLocalImage(localImageId);

    // If the photo was already synced (has real attachId), queue delete for server
    if (localImage?.attachId && !String(localImage.attachId).startsWith('img_')) {
      await deleteVisualPhoto(localImage.attachId);
    }

    // NOW delete from LocalImage system (after queuing server delete)
    await this.localImageService.deleteLocalImage(localImageId);
  }

  /**
   * Remove a photo from the photos array (without confirmation)
   * Use for batch operations or when confirmation already handled
   *
   * @param key - Photo key
   * @param attachId - Attachment ID to remove
   * @param visualPhotos - Photos map
   * @param photoCountsByKey - Counts map
   */
  removePhotoFromArray(
    key: string,
    attachId: string,
    visualPhotos: { [key: string]: any[] },
    photoCountsByKey: { [key: string]: number }
  ): void {
    if (visualPhotos[key]) {
      visualPhotos[key] = visualPhotos[key].filter(
        (p: any) => p.AttachID !== attachId
      );
      photoCountsByKey[key] = visualPhotos[key].length;
    }
  }

  /**
   * Add a photo to the photos array
   *
   * @param key - Photo key
   * @param photo - Photo to add
   * @param visualPhotos - Photos map
   * @param photoCountsByKey - Counts map
   */
  addPhotoToArray(
    key: string,
    photo: any,
    visualPhotos: { [key: string]: any[] },
    photoCountsByKey: { [key: string]: number }
  ): void {
    if (!visualPhotos[key]) {
      visualPhotos[key] = [];
    }
    visualPhotos[key].push(photo);
    photoCountsByKey[key] = visualPhotos[key].length;
  }

  /**
   * Update photo counts map from photos map
   *
   * @param visualPhotos - Photos map
   * @param photoCountsByKey - Counts map to update
   */
  syncPhotoCounts(
    visualPhotos: { [key: string]: any[] },
    photoCountsByKey: { [key: string]: number }
  ): void {
    for (const key of Object.keys(visualPhotos)) {
      photoCountsByKey[key] = visualPhotos[key]?.length || 0;
    }
  }

  /**
   * Get total photo count across all keys
   *
   * @param photoCountsByKey - Counts map
   * @returns Total photo count
   */
  getTotalPhotoCount(photoCountsByKey: { [key: string]: number }): number {
    return Object.values(photoCountsByKey).reduce((sum, count) => sum + (count || 0), 0);
  }

  /**
   * Check if any photos are uploading
   *
   * @param uploadingMap - Map of uploading states
   * @returns True if any uploads in progress
   */
  hasAnyUploading(uploadingMap: { [key: string]: boolean }): boolean {
    return Object.values(uploadingMap).some(v => v);
  }

  /**
   * Check if any photos are loading
   *
   * @param loadingMap - Map of loading states
   * @returns True if any loading in progress
   */
  hasAnyLoading(loadingMap: { [key: string]: boolean }): boolean {
    return Object.values(loadingMap).some(v => v);
  }

  /**
   * Set uploading state for a key
   *
   * @param key - Photo key
   * @param isUploading - New state
   * @param uploadingMap - Map to update
   */
  setUploading(key: string, isUploading: boolean, uploadingMap: { [key: string]: boolean }): void {
    uploadingMap[key] = isUploading;
  }

  /**
   * Set loading state for a key
   *
   * @param key - Photo key
   * @param isLoading - New state
   * @param loadingMap - Map to update
   */
  setLoading(key: string, isLoading: boolean, loadingMap: { [key: string]: boolean }): void {
    loadingMap[key] = isLoading;
  }

  /**
   * Clear all uploading states
   *
   * @param uploadingMap - Map to clear
   */
  clearAllUploading(uploadingMap: { [key: string]: boolean }): void {
    for (const key of Object.keys(uploadingMap)) {
      uploadingMap[key] = false;
    }
  }

  /**
   * Clear all loading states
   *
   * @param loadingMap - Map to clear
   */
  clearAllLoading(loadingMap: { [key: string]: boolean }): void {
    for (const key of Object.keys(loadingMap)) {
      loadingMap[key] = false;
    }
  }
}
