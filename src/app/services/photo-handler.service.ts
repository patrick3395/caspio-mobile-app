import { Injectable } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { Camera, CameraResultType, CameraSource, GalleryPhoto } from '@capacitor/camera';
import { environment } from '../../environments/environment';
import { LocalImageService } from './local-image.service';
import { IndexedDbService, LocalImage, ImageEntityType } from './indexed-db.service';
import { ImageCompressionService } from './image-compression.service';
import { MemoryDiagnosticsService } from './memory-diagnostics.service';
import { FabricPhotoAnnotatorComponent } from '../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { compressAnnotationData, decompressAnnotationData } from '../utils/annotation-utils';
import { CaspioService } from './caspio.service';

/**
 * Configuration passed by each template for photo capture
 */
export interface PhotoCaptureConfig {
  entityType: ImageEntityType;  // 'hud' | 'visual' | 'lbw' | 'dte' | 'efe_point' | 'fdf'
  entityId: string;
  serviceId: string;
  category: string;
  itemId: string | number;

  // Callbacks for UI updates
  onTempPhotoAdded?: (photo: StandardPhotoEntry) => void;
  onUploadComplete?: (photo: StandardPhotoEntry, tempId: string) => void;
  onUploadFailed?: (tempId: string, error: any) => void;

  // Optional: Skip annotator for gallery multi-select
  skipAnnotator?: boolean;

  // Optional: Pre-expand photos section
  onExpandPhotos?: () => void;
}

/**
 * Standardized photo entry that all templates use
 */
export interface StandardPhotoEntry {
  // Primary IDs - imageId is stable UUID (never changes)
  imageId: string;
  AttachID: string;
  attachId: string;
  id: string;

  // Display URLs
  url: string;
  displayUrl: string;
  originalUrl: string;
  thumbnailUrl: string;

  // Metadata
  name: string;
  caption: string;
  annotation: string;
  Annotation: string;
  Drawings: string;
  hasAnnotations: boolean;

  // Status
  status: 'uploading' | 'local_only' | 'queued' | 'uploaded' | 'verified' | 'failed';
  isLocal: boolean;
  isLocalFirst?: boolean;
  isLocalImage?: boolean;
  isObjectUrl?: boolean;
  uploading: boolean;
  queued?: boolean;
  isPending: boolean;
  isSkeleton: boolean;
  progress: number;
  uploadFailed?: boolean;
}

/**
 * PhotoHandlerService - Unified service for camera/gallery photo capture
 *
 * Provides a single interface for all templates with two internal paths:
 * - WEBAPP: Direct upload to S3 (no local storage)
 * - MOBILE: Dexie-first local storage with background sync
 *
 * Benefits:
 * - Single source of truth for photo handling logic
 * - Templates reduced from ~400 lines to ~20 lines
 * - Consistent behavior across all templates
 * - Bug fixes applied once, work everywhere
 */
@Injectable({
  providedIn: 'root'
})
export class PhotoHandlerService {

  constructor(
    private modalController: ModalController,
    private toastController: ToastController,
    private localImageService: LocalImageService,
    private indexedDb: IndexedDbService,
    private imageCompression: ImageCompressionService,
    private caspioService: CaspioService,
    private memoryDiagnostics: MemoryDiagnosticsService
  ) {}

  // ============================================================================
  // PUBLIC API: Camera Capture
  // ============================================================================

  /**
   * Capture a photo from camera with annotator
   *
   * Flow:
   * 1. Open camera
   * 2. Open annotator modal
   * 3. Compress image
   * 4. WEBAPP: Upload directly to S3
   * 5. MOBILE: Store in Dexie, sync in background
   *
   * @returns The created photo entry, or null if user cancelled
   */
  async captureFromCamera(config: PhotoCaptureConfig): Promise<StandardPhotoEntry | null> {
    console.log('[PhotoHandlerService] captureFromCamera:', config.entityType, 'entityId:', config.entityId);

    try {
      // 1. Capture photo with camera
      const image = await Camera.getPhoto({
        quality: 85,  // Balanced quality - compression handles the rest
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera
      });

      if (!image.webPath) {
        return null;
      }

      // 2. Convert to blob
      const response = await fetch(image.webPath);
      const blob = await response.blob();
      const imageUrl = URL.createObjectURL(blob);

      try {
        // 3. Open annotator modal
        const { annotatedBlob, annotationsData, caption, cancelled } = await this.openAnnotator(imageUrl);

        if (cancelled) {
          URL.revokeObjectURL(imageUrl);
          return null;
        }

        // 4. Create file and compress
        const originalFile = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
        const compressedFile = await this.compressImage(originalFile);

        // 5. Compress annotations
        const compressedDrawings = this.compressAnnotations(annotationsData);

        // 6. Process based on platform
        const photo = await this.processPhoto(
          blob,
          compressedFile,
          annotatedBlob,
          compressedDrawings,
          caption,
          !!annotationsData,
          config
        );

        // Clean up
        URL.revokeObjectURL(imageUrl);

        return photo;

      } catch (error) {
        URL.revokeObjectURL(imageUrl);
        throw error;
      }

    } catch (error) {
      // Check if user cancelled
      if (this.isUserCancellation(error)) {
        return null;
      }
      console.error('[PhotoHandler] Camera capture error:', error);
      throw error;
    }
  }

  // ============================================================================
  // PUBLIC API: Gallery Capture
  // ============================================================================

  /**
   * Select photos from gallery (multi-select)
   *
   * For multiple photos, shows skeleton placeholders immediately
   * then processes each photo sequentially.
   *
   * @returns Array of created photo entries
   */
  async captureFromGallery(config: PhotoCaptureConfig): Promise<StandardPhotoEntry[]> {
    console.log('[PhotoHandlerService] captureFromGallery:', config.entityType, 'entityId:', config.entityId);

    try {
      // 1. Pick images from gallery
      const images = await Camera.pickImages({
        quality: 85,  // Match camera quality for consistency
        limit: 0      // No limit on number of photos
      });

      if (!images.photos || images.photos.length === 0) {
        return [];
      }

      const results: StandardPhotoEntry[] = [];

      // For single photo, open annotator
      if (images.photos.length === 1 && !config.skipAnnotator) {
        const image = images.photos[0];
        if (image.webPath) {
          const response = await fetch(image.webPath);
          const blob = await response.blob();
          const imageUrl = URL.createObjectURL(blob);

          try {
            const { annotatedBlob, annotationsData, caption, cancelled } = await this.openAnnotator(imageUrl);

            if (!cancelled) {
              const originalFile = new File([blob], `gallery-${Date.now()}.jpg`, { type: 'image/jpeg' });
              const compressedFile = await this.compressImage(originalFile);
              const compressedDrawings = this.compressAnnotations(annotationsData);

              const photo = await this.processPhoto(
                blob,
                compressedFile,
                annotatedBlob,
                compressedDrawings,
                caption,
                !!annotationsData,
                config
              );

              if (photo) {
                results.push(photo);
              }
            }

            URL.revokeObjectURL(imageUrl);
          } catch (error) {
            URL.revokeObjectURL(imageUrl);
            throw error;
          }
        }
      } else {
        // Multiple photos - create skeleton placeholders first
        const skeletons = this.createSkeletonPlaceholders(images.photos.length);

        // Notify UI about skeletons
        if (config.onTempPhotoAdded) {
          skeletons.forEach(skeleton => config.onTempPhotoAdded!(skeleton));
        }

        // Process each photo
        for (let i = 0; i < images.photos.length; i++) {
          const image = images.photos[i];
          const skeleton = skeletons[i];

          if (image.webPath) {
            try {
              const response = await fetch(image.webPath);
              const blob = await response.blob();

              if (blob.size === 0) {
                console.warn(`[PhotoHandler] Skipping empty photo ${i + 1}`);
                continue;
              }

              const originalFile = new File([blob], `gallery-${Date.now()}_${i}.jpg`, { type: 'image/jpeg' });
              const compressedFile = await this.compressImage(originalFile);

              const photo = await this.processPhoto(
                blob,
                compressedFile,
                null,  // No annotated blob for multi-select
                '',    // No drawings
                '',    // No caption
                false, // No annotations
                config,
                skeleton.imageId  // Replace this skeleton
              );

              if (photo) {
                results.push(photo);
              }
            } catch (photoError) {
              console.error(`[PhotoHandler] Failed to process photo ${i + 1}:`, photoError);
              // Notify about failure for this skeleton
              if (config.onUploadFailed) {
                config.onUploadFailed(skeleton.imageId, photoError);
              }
            }
          }
        }
      }

      return results;

    } catch (error) {
      if (this.isUserCancellation(error)) {
        return [];
      }
      console.error('[PhotoHandler] Gallery capture error:', error);
      throw error;
    }
  }

  // ============================================================================
  // PRIVATE: Photo Processing (Platform-Specific Branching)
  // ============================================================================

  /**
   * Process a photo - branches between webapp and mobile paths
   * Includes memory diagnostics to track upload memory usage
   */
  private async processPhoto(
    originalBlob: Blob,
    compressedFile: File,
    annotatedBlob: Blob | null,
    compressedDrawings: string,
    caption: string,
    hasAnnotations: boolean,
    config: PhotoCaptureConfig,
    skeletonIdToReplace?: string
  ): Promise<StandardPhotoEntry | null> {

    // Memory diagnostics: track before upload
    const fileSizeMB = (compressedFile.size / (1024 * 1024)).toFixed(2);
    const beforeSnapshot = this.memoryDiagnostics.takeSnapshot(`Before Upload (${fileSizeMB}MB)`);

    let result: StandardPhotoEntry | null = null;

    if (environment.isWeb) {
      result = await this.processWebappPhoto(
        originalBlob,
        compressedFile,
        annotatedBlob,
        compressedDrawings,
        caption,
        hasAnnotations,
        config,
        skeletonIdToReplace
      );
    } else {
      result = await this.processMobilePhoto(
        originalBlob,
        compressedFile,
        annotatedBlob,
        compressedDrawings,
        caption,
        hasAnnotations,
        config,
        skeletonIdToReplace
      );
    }

    // Memory diagnostics: track after upload and show alert
    const afterSnapshot = this.memoryDiagnostics.takeSnapshot(`After Upload (${fileSizeMB}MB)`);
    if (beforeSnapshot && afterSnapshot) {
      await this.memoryDiagnostics.showMemoryAlert(`Image Upload (${fileSizeMB}MB)`, beforeSnapshot, afterSnapshot);
    }

    return result;
  }

  /**
   * WEBAPP PATH: Direct S3 upload (no local storage)
   *
   * ANNOTATION FLATTENING FIX (EFE Pattern):
   * - ALL URLs use the ORIGINAL image (no annotated blob URLs)
   * - Annotations stored ONLY in Drawings field (compressed JSON)
   * - Photo viewer renders annotations dynamically from Drawings field
   * - This prevents annotations from being "baked in" and becoming uneditable
   */
  private async processWebappPhoto(
    originalBlob: Blob,
    compressedFile: File,
    annotatedBlob: Blob | null,
    compressedDrawings: string,
    caption: string,
    hasAnnotations: boolean,
    config: PhotoCaptureConfig,
    skeletonIdToReplace?: string
  ): Promise<StandardPhotoEntry | null> {

    console.log('[PhotoHandler] WEBAPP: Starting direct S3 upload for', config.entityType);

    // Create temp photo entry with loading state
    const tempId = skeletonIdToReplace || `uploading_${Date.now()}`;

    // ANNOTATION FLATTENING FIX: Always use original blob URL for ALL URLs
    // Annotations stored in Drawings field (JSON) - no annotated blob URLs
    const originalBlobUrl = URL.createObjectURL(originalBlob);

    const tempPhoto: StandardPhotoEntry = {
      imageId: tempId,
      AttachID: tempId,
      attachId: tempId,
      id: tempId,
      url: originalBlobUrl,              // Always original
      displayUrl: originalBlobUrl,       // Always original - no annotated cache
      originalUrl: originalBlobUrl,      // For re-editing
      thumbnailUrl: originalBlobUrl,     // Always original - no annotated cache
      name: 'photo.jpg',
      caption: caption || '',
      annotation: caption || '',
      Annotation: caption || '',
      Drawings: compressedDrawings,
      hasAnnotations,
      status: 'uploading',
      isLocal: false,
      uploading: true,
      isPending: true,
      isSkeleton: false,
      progress: 0
    };

    // Notify UI about temp photo (only if not replacing skeleton)
    if (!skeletonIdToReplace && config.onTempPhotoAdded) {
      config.onTempPhotoAdded(tempPhoto);
    }

    // Expand photos section
    if (config.onExpandPhotos) {
      config.onExpandPhotos();
    }

    try {
      // Upload directly to S3
      const uploadResult = await this.localImageService.uploadImageDirectToS3(
        compressedFile,
        config.entityType,
        config.entityId,
        config.serviceId,
        caption,
        compressedDrawings
      );

      console.log('[PhotoHandler] WEBAPP: Upload complete, AttachID:', uploadResult.attachId);

      // Create final photo entry
      // ANNOTATION FLATTENING FIX: Always use original S3 URL for ALL URLs
      const finalPhoto: StandardPhotoEntry = {
        ...tempPhoto,
        imageId: uploadResult.attachId,
        AttachID: uploadResult.attachId,
        attachId: uploadResult.attachId,
        id: uploadResult.attachId,
        url: uploadResult.s3Url,
        displayUrl: uploadResult.s3Url,    // Always original - no annotated cache
        originalUrl: uploadResult.s3Url,   // For re-editing
        thumbnailUrl: uploadResult.s3Url,  // Always original - no annotated cache
        status: 'uploaded',
        isLocal: false,
        uploading: false,
        isPending: false
      };

      // Notify UI about completion
      if (config.onUploadComplete) {
        config.onUploadComplete(finalPhoto, tempId);
      }

      return finalPhoto;

    } catch (error: any) {
      console.error('[PhotoHandler] WEBAPP: Upload failed:', error?.message || error);

      // Notify about failure
      if (config.onUploadFailed) {
        config.onUploadFailed(tempId, error);
      }

      // Show error toast
      const toast = await this.toastController.create({
        message: 'Failed to upload photo. Please try again.',
        duration: 3000,
        color: 'danger'
      });
      await toast.present();

      // Clean up blob URL
      URL.revokeObjectURL(originalBlobUrl);

      return null;
    }
  }

  /**
   * MOBILE PATH: Dexie-first local storage with background sync
   *
   * ANNOTATION HANDLING (EFE Pattern):
   * - url / originalUrl = original image (for re-editing)
   * - displayUrl / thumbnailUrl = annotated blob (for thumbnail display)
   * - Cache annotated blob to IndexedDB for persistence across navigation
   * - Keeps annotations editable while showing them in thumbnails
   */
  private async processMobilePhoto(
    originalBlob: Blob,
    compressedFile: File,
    annotatedBlob: Blob | null,
    compressedDrawings: string,
    caption: string,
    hasAnnotations: boolean,
    config: PhotoCaptureConfig,
    skeletonIdToReplace?: string
  ): Promise<StandardPhotoEntry | null> {

    console.log('[PhotoHandler] MOBILE: Starting Dexie-first capture for', config.entityType);

    try {
      // Create LocalImage with stable UUID (stores blob + creates outbox item)
      const localImage: LocalImage = await this.localImageService.captureImage(
        compressedFile,
        config.entityType,
        config.entityId,
        config.serviceId,
        caption,
        compressedDrawings
      );

      console.log('[PhotoHandler] MOBILE: LocalImage created:', localImage.imageId);

      // Get display URL from LocalImageService (uses local blob)
      let displayUrl = await this.localImageService.getDisplayUrl(localImage);

      // Fallback if getDisplayUrl returns placeholder
      if (!displayUrl || displayUrl === 'assets/img/photo-placeholder.svg') {
        console.warn('[PhotoHandler] MOBILE: getDisplayUrl returned placeholder, creating direct blob URL');
        displayUrl = URL.createObjectURL(compressedFile);
      }

      // For annotated images, create separate display URL
      let annotatedDisplayUrl = displayUrl;
      if (annotatedBlob) {
        annotatedDisplayUrl = URL.createObjectURL(annotatedBlob);

        // Cache annotated image for thumbnail persistence
        try {
          await this.indexedDb.cacheAnnotatedImage(localImage.imageId, annotatedBlob);
          console.log('[PhotoHandler] MOBILE: Cached annotated thumbnail:', localImage.imageId);
        } catch (cacheErr) {
          console.warn('[PhotoHandler] MOBILE: Failed to cache annotated thumbnail:', cacheErr);
        }
      }

      // Create photo entry using stable imageId
      // EFE PATTERN: Different URLs for different purposes
      // - url/originalUrl: Original image for API upload and re-editing
      // - displayUrl/thumbnailUrl: Annotated version for thumbnail display
      const photoEntry: StandardPhotoEntry = {
        imageId: localImage.imageId,
        AttachID: localImage.imageId,
        attachId: localImage.imageId,
        id: localImage.imageId,
        url: displayUrl,                    // Original - for API
        displayUrl: annotatedDisplayUrl,    // Annotated - for thumbnail display
        originalUrl: displayUrl,            // CRITICAL: Original - for re-editing
        thumbnailUrl: annotatedDisplayUrl,  // Annotated - for thumbnail display
        name: 'photo.jpg',
        caption: caption || '',
        annotation: caption || '',
        Annotation: caption || '',
        Drawings: compressedDrawings,
        hasAnnotations,
        status: localImage.status as any,
        isLocal: true,
        isLocalFirst: true,
        isLocalImage: true,
        isObjectUrl: true,
        uploading: false,  // SILENT SYNC: No spinner for mobile
        queued: false,
        isPending: localImage.status !== 'verified',
        isSkeleton: false,
        progress: 0
      };

      // Notify UI
      if (skeletonIdToReplace) {
        // Replace skeleton with real photo
        if (config.onUploadComplete) {
          config.onUploadComplete(photoEntry, skeletonIdToReplace);
        }
      } else {
        // Add new photo
        if (config.onTempPhotoAdded) {
          config.onTempPhotoAdded(photoEntry);
        }
      }

      // Expand photos section
      if (config.onExpandPhotos) {
        config.onExpandPhotos();
      }

      console.log('[PhotoHandler] MOBILE: Photo capture complete, syncs in background');

      return photoEntry;

    } catch (error: any) {
      console.error('[PhotoHandler] MOBILE: Capture failed:', error?.message || error);

      if (skeletonIdToReplace && config.onUploadFailed) {
        config.onUploadFailed(skeletonIdToReplace, error);
      }

      throw error;
    }
  }

  // ============================================================================
  // PRIVATE: Helper Methods
  // ============================================================================

  /**
   * Open the annotator modal
   */
  private async openAnnotator(imageUrl: string): Promise<{
    annotatedBlob: Blob | null;
    annotationsData: any;
    caption: string;
    cancelled: boolean;
  }> {
    const modal = await this.modalController.create({
      component: FabricPhotoAnnotatorComponent,
      componentProps: {
        imageUrl: imageUrl,
        existingAnnotations: null,
        existingCaption: '',
        photoData: {
          id: 'new',
          caption: ''
        },
        isReEdit: false
      },
      cssClass: 'fullscreen-modal'
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    if (data && data.annotatedBlob) {
      return {
        annotatedBlob: data.blob || data.annotatedBlob,
        annotationsData: data.annotationData || data.annotationsData,
        caption: data.caption || '',
        cancelled: false
      };
    }

    return {
      annotatedBlob: null,
      annotationsData: null,
      caption: '',
      cancelled: true
    };
  }

  /**
   * Compress an image file with fallback
   * Prioritizes resolution over file size - allows up to 2MB to preserve quality
   */
  private async compressImage(file: File): Promise<File> {
    try {
      const compressed = await this.imageCompression.compressImage(file, {
        maxSizeMB: 2.0,            // Allow larger files to preserve resolution
        maxWidthOrHeight: 1920,    // Full HD resolution
        useWebWorker: true,
        quality: 0.80              // Good quality balance
      });
      return new File([compressed], file.name, { type: 'image/jpeg' });
    } catch (error) {
      console.warn('[PhotoHandler] Compression failed, using original:', error);
      return file;
    }
  }

  /**
   * Compress annotation data
   */
  private compressAnnotations(annotationsData: any): string {
    if (!annotationsData) {
      return '';
    }

    try {
      if (typeof annotationsData === 'object') {
        return compressAnnotationData(JSON.stringify(annotationsData));
      } else if (typeof annotationsData === 'string') {
        return compressAnnotationData(annotationsData);
      }
    } catch (e) {
      console.error('[PhotoHandler] Failed to compress annotations:', e);
    }

    return '';
  }

  /**
   * Create skeleton placeholders for gallery multi-select
   */
  private createSkeletonPlaceholders(count: number): StandardPhotoEntry[] {
    const skeletons: StandardPhotoEntry[] = [];

    for (let i = 0; i < count; i++) {
      const tempId = `temp_skeleton_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`;
      skeletons.push({
        imageId: tempId,
        AttachID: tempId,
        attachId: tempId,
        id: tempId,
        url: 'assets/img/photo-placeholder.svg',
        displayUrl: 'assets/img/photo-placeholder.svg',
        originalUrl: 'assets/img/photo-placeholder.svg',
        thumbnailUrl: 'assets/img/photo-placeholder.svg',
        name: `photo_${i}.jpg`,
        caption: '',
        annotation: '',
        Annotation: '',
        Drawings: '',
        hasAnnotations: false,
        status: 'uploading',
        isLocal: false,
        uploading: false,
        isPending: true,
        isSkeleton: true,
        progress: 0
      });
    }

    return skeletons;
  }

  /**
   * Check if an error is a user cancellation
   */
  private isUserCancellation(error: any): boolean {
    const errorMessage = typeof error === 'string' ? error : error?.message || '';
    return errorMessage.includes('cancel') ||
           errorMessage.includes('Cancel') ||
           errorMessage.includes('User') ||
           error === 'User cancelled photos app';
  }

  // ============================================================================
  // PUBLIC API: Photo Preservation (for template loadPhotosForVisual methods)
  // ============================================================================

  /**
   * Check if a photo should be preserved during array rebuild/reload.
   *
   * Call this from template loadPhotosForVisual methods to determine which
   * photos to keep when clearing and rebuilding the visualPhotos array.
   *
   * Preserves:
   * - Skeleton placeholders (isSkeleton=true, imageId starts with 'temp_skeleton_')
   * - Uploading photos (uploading=true, imageId starts with 'uploading_' or 'temp_')
   * - In-progress captures (_isInProgressCapture=true)
   * - Local-first photos with blob/data URLs
   * - LocalImage photos
   *
   * @param photo - The photo object to check
   * @returns true if the photo should be preserved
   */
  shouldPreservePhoto(photo: any): boolean {
    if (!photo) return false;

    const imageId = String(photo.imageId || '');

    // Preserve skeleton placeholders (PhotoHandlerService gallery multi-select)
    if (photo.isSkeleton === true && imageId.startsWith('temp_skeleton_')) {
      return true;
    }

    // Preserve uploading photos with temp IDs
    if (photo.uploading === true && (imageId.startsWith('uploading_') || imageId.startsWith('temp_'))) {
      return true;
    }

    // Preserve in-progress captures (legacy pattern)
    if (photo._isInProgressCapture === true && photo.uploading === true) {
      return true;
    }

    // Preserve photos with valid blob or data URLs (local-first photos)
    if (photo.displayUrl && (photo.displayUrl.startsWith('blob:') || photo.displayUrl.startsWith('data:'))) {
      return true;
    }

    // Preserve LocalImage photos (they have valid local references)
    if (photo.isLocalImage || photo.isLocalFirst || photo.localImageId) {
      return true;
    }

    return false;
  }

  /**
   * Filter an array of photos to get only those that should be preserved.
   *
   * Use this in template loadPhotosForVisual methods:
   * ```
   * const existingPhotos = this.visualPhotos[key] || [];
   * const preservedPhotos = this.photoHandler.getPhotosToPreserve(existingPhotos);
   * this.visualPhotos[key] = [...preservedPhotos];
   * // Then add photos from server...
   * ```
   *
   * @param photos - Array of photo objects to filter
   * @returns Array of photos that should be preserved
   */
  getPhotosToPreserve(photos: any[]): any[] {
    if (!photos || !Array.isArray(photos)) return [];
    return photos.filter(p => this.shouldPreservePhoto(p));
  }

  // ============================================================================
  // PUBLIC API: View/Edit Existing Photos (Standardized Annotation Handling)
  // ============================================================================

  /**
   * View and edit an existing photo with annotations
   *
   * This is the STANDARDIZED method for viewing/editing photos across all templates.
   * It handles:
   * - Decompressing existing annotations from the Drawings field
   * - Opening the FabricPhotoAnnotatorComponent modal
   * - Compressing and saving annotations back to the API or IndexedDB
   * - Caching annotated images for thumbnail display
   *
   * @param config - Configuration for viewing the photo
   * @returns Result object with updated photo data, or null if user cancelled
   */
  async viewExistingPhoto(config: ViewPhotoConfig): Promise<ViewPhotoResult | null> {
    const { photo, entityType, onSaveAnnotation, onUpdatePhoto } = config;

    console.log('[PhotoHandler] viewExistingPhoto called for:', photo.id || photo.AttachID);

    // Get the original URL for editing (without annotations baked in)
    let editUrl = photo.originalUrl || photo.displayUrl || photo.url;

    // If URL is placeholder or invalid, try to get from S3
    if (!editUrl || editUrl === 'assets/img/photo-placeholder.svg') {
      const s3Key = photo.Attachment || photo.Photo;
      if (s3Key && this.caspioService.isS3Key && this.caspioService.isS3Key(s3Key)) {
        try {
          editUrl = await this.caspioService.getS3FileUrl(s3Key);
          console.log('[PhotoHandler] Fetched S3 URL for editing:', editUrl?.substring(0, 50));
        } catch (e) {
          console.warn('[PhotoHandler] Failed to get S3 URL:', e);
        }
      }
    }

    // Validate we have a valid URL
    if (!editUrl || editUrl === 'assets/img/photo-placeholder.svg') {
      console.error('[PhotoHandler] Cannot view photo - no valid image URL');
      const toast = await this.toastController.create({
        message: 'Photo not available. Please try again later.',
        duration: 3000,
        color: 'warning'
      });
      await toast.present();
      return null;
    }

    // Decompress existing annotations
    let existingAnnotations: any = null;
    const drawingsSource = photo.drawings || photo.Drawings || photo.rawDrawingsString;

    if (drawingsSource && drawingsSource.length > 10) {
      try {
        existingAnnotations = decompressAnnotationData(drawingsSource);
        console.log('[PhotoHandler] Decompressed existing annotations');
      } catch (e) {
        console.warn('[PhotoHandler] Error decompressing annotations:', e);
      }
    }

    const existingCaption = photo.caption || photo.Annotation || photo.annotation || '';

    // Open the annotator modal
    const modal = await this.modalController.create({
      component: FabricPhotoAnnotatorComponent,
      componentProps: {
        imageUrl: editUrl,
        existingAnnotations: existingAnnotations,
        existingCaption: existingCaption,
        photoData: {
          ...photo,
          AttachID: photo.id || photo.AttachID,
          id: photo.id || photo.AttachID,
          caption: existingCaption
        },
        isReEdit: !!existingAnnotations
      },
      cssClass: 'fullscreen-modal'
    });

    await modal.present();
    const { data } = await modal.onWillDismiss();

    // User cancelled
    if (!data) {
      return null;
    }

    // Check if we have annotation data to save
    const hasAnnotationData = data.annotatedBlob || data.compressedAnnotationData || data.annotationsData;

    if (!hasAnnotationData) {
      return null;
    }

    console.log('[PhotoHandler] Processing annotation save...');

    const annotatedBlob = data.blob || data.annotatedBlob;
    const annotationsData = data.annotationData || data.annotationsData;
    const newCaption = data.caption !== undefined ? data.caption : photo.caption;

    // Compress annotation data for storage
    let compressedDrawings = data.compressedAnnotationData || '';
    if (!compressedDrawings && annotationsData) {
      if (typeof annotationsData === 'object') {
        compressedDrawings = compressAnnotationData(JSON.stringify(annotationsData));
      } else if (typeof annotationsData === 'string') {
        compressedDrawings = compressAnnotationData(annotationsData);
      }
    }

    // Create blob URL for display
    let annotatedUrl: string | null = null;
    if (annotatedBlob) {
      annotatedUrl = URL.createObjectURL(annotatedBlob);
    }

    // Cache annotated image for thumbnail display
    const photoId = photo.id || photo.AttachID || photo.attachId || '';
    if (annotatedBlob && annotatedBlob.size > 0 && photoId) {
      try {
        await this.indexedDb.cacheAnnotatedImage(photoId, annotatedBlob);
        console.log('[PhotoHandler] Cached annotated image for:', photoId);
      } catch (cacheErr) {
        console.warn('[PhotoHandler] Failed to cache annotated image:', cacheErr);
      }
    }

    // Call the save callback if provided
    if (onSaveAnnotation && photoId) {
      try {
        await onSaveAnnotation(photoId, compressedDrawings, newCaption);
        console.log('[PhotoHandler] Annotation saved via callback');
      } catch (saveErr) {
        console.error('[PhotoHandler] Error in save callback:', saveErr);
        const toast = await this.toastController.create({
          message: 'Error saving annotation',
          duration: 3000,
          color: 'danger'
        });
        await toast.present();
      }
    }

    // Build the result
    const result: ViewPhotoResult = {
      photoId: photoId,
      compressedDrawings: compressedDrawings,
      caption: newCaption,
      annotatedUrl: annotatedUrl,
      hasAnnotations: compressedDrawings.length > 10,
      annotationsData: annotationsData
    };

    // Call the update callback if provided
    if (onUpdatePhoto) {
      onUpdatePhoto(result);
    }

    return result;
  }
}

/**
 * Configuration for viewing/editing an existing photo
 */
export interface ViewPhotoConfig {
  // The photo object to view/edit
  photo: {
    id?: string;
    AttachID?: string;
    attachId?: string;
    displayUrl?: string;
    originalUrl?: string;
    url?: string;
    Attachment?: string;
    Photo?: string;
    drawings?: string;
    Drawings?: string;
    rawDrawingsString?: string;
    caption?: string;
    Annotation?: string;
    annotation?: string;
    hasAnnotations?: boolean;
    [key: string]: any;
  };

  // Entity type (for context)
  entityType: ImageEntityType;

  // Callback to save annotation to API/IndexedDB
  onSaveAnnotation?: (photoId: string, compressedDrawings: string, caption: string) => Promise<void>;

  // Callback when photo is updated (for UI refresh)
  onUpdatePhoto?: (result: ViewPhotoResult) => void;
}

/**
 * Result from viewing/editing a photo
 */
export interface ViewPhotoResult {
  photoId: string;
  compressedDrawings: string;
  caption: string;
  annotatedUrl: string | null;
  hasAnnotations: boolean;
  annotationsData: any;
}
