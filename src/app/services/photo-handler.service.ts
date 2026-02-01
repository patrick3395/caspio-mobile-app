import { Injectable } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { Camera, CameraResultType, CameraSource, GalleryPhoto } from '@capacitor/camera';
import { environment } from '../../environments/environment';
import { LocalImageService } from './local-image.service';
import { IndexedDbService, LocalImage, ImageEntityType } from './indexed-db.service';
import { ImageCompressionService } from './image-compression.service';
import { FabricPhotoAnnotatorComponent } from '../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { compressAnnotationData } from '../utils/annotation-utils';

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
    private imageCompression: ImageCompressionService
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
    try {
      // 1. Capture photo with camera
      const image = await Camera.getPhoto({
        quality: 90,
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
    try {
      // 1. Pick images from gallery
      const images = await Camera.pickImages({
        quality: 70,  // Lower quality since we compress anyway
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

    if (environment.isWeb) {
      return this.processWebappPhoto(
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
      return this.processMobilePhoto(
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

    console.log('[PhotoHandler] WEBAPP: Starting direct S3 upload...');

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

    console.log('[PhotoHandler] MOBILE: Starting Dexie-first capture...');

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
   */
  private async compressImage(file: File): Promise<File> {
    try {
      const compressed = await this.imageCompression.compressImage(file, {
        maxSizeMB: 0.8,
        maxWidthOrHeight: 1280,
        useWebWorker: true
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
}
