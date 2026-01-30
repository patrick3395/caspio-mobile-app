import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, AlertController, ModalController, NavController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { CaspioService } from '../../../../services/caspio.service';
import { FabricPhotoAnnotatorComponent } from '../../../../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { IndexedDbService } from '../../../../services/indexed-db.service';
import { ImageCompressionService } from '../../../../services/image-compression.service';
import { db, VisualField } from '../../../../services/caspio-db';
import { VisualFieldRepoService } from '../../../../services/visual-field-repo.service';
import { LocalImageService } from '../../../../services/local-image.service';
import { EngineersFoundationDataService } from '../../engineers-foundation-data.service';
import { compressAnnotationData, decompressAnnotationData, renderAnnotationsOnPhoto } from '../../../../utils/annotation-utils';
import { liveQuery } from 'dexie';
import { environment } from '../../../../../environments/environment';
import { HasUnsavedChanges } from '../../../../services/unsaved-changes.service';
import { LazyImageDirective } from '../../../../directives/lazy-image.directive';

interface VisualItem {
  id: string | number;
  templateId: number;
  name: string;
  text: string;
  originalText: string;
  type: string;
  category: string;
  answerType: number;
  required: boolean;
  answer?: string;
  isSelected?: boolean;
  key?: string;
}

interface PhotoItem {
  id: string;
  displayUrl: string;
  caption: string;
  uploading: boolean;
  loading?: boolean;
  isLocal: boolean;
  hasAnnotations?: boolean;
  drawings?: string;
  originalUrl?: string;
  thumbnailUrl?: string;
  // Additional ID fields for annotation cache lookup (matches category-detail pattern)
  imageId?: string;
  attachId?: string;
}

@Component({
  selector: 'app-visual-detail',
  templateUrl: './visual-detail.page.html',
  styleUrls: ['./visual-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, LazyImageDirective]
})
export class VisualDetailPage implements OnInit, OnDestroy, HasUnsavedChanges {
  // WEBAPP: Expose isWeb for template to hide camera button
  isWeb = environment.isWeb;

  categoryName: string = '';
  templateId: number = 0;
  projectId: string = '';
  serviceId: string = '';
  visualId: string = '';  // The actual visualId used to store photos

  // Visual item data
  item: VisualItem | null = null;
  loading: boolean = true;
  saving: boolean = false;

  // Editable fields
  editableTitle: string = '';
  editableText: string = '';

  // Photos
  photos: PhotoItem[] = [];
  loadingPhotos: boolean = false;
  uploadingPhotos: boolean = false;

  // ANNOTATION THUMBNAIL FIX: In-memory cache for annotated image URLs
  // This ensures thumbnails show annotations immediately after save
  bulkAnnotatedImagesMap: Map<string, string> = new Map();

  // Subscriptions
  private routeSubscription?: Subscription;
  private localImagesSubscription?: Subscription;
  private visualFieldsSubscription?: { unsubscribe: () => void };  // Dexie liveQuery subscription

  // Track the last known visualId to detect changes after sync
  private lastKnownVisualId: string = '';

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private navController: NavController,
    private location: Location,
    private caspioService: CaspioService,
    private toastController: ToastController,
    private alertController: AlertController,
    private modalController: ModalController,
    private changeDetectorRef: ChangeDetectorRef,
    private indexedDb: IndexedDbService,
    private imageCompression: ImageCompressionService,
    private visualFieldRepo: VisualFieldRepoService,
    private localImageService: LocalImageService,
    private foundationData: EngineersFoundationDataService
  ) {}

  ngOnInit() {
    this.loadRouteParams();
  }

  ionViewWillEnter() {
    // WEBAPP: Clear loading state when returning to this page
    if (environment.isWeb) {
      this.loading = false;
      this.saving = false;
      this.changeDetectorRef.detectChanges();
    } else {
      // MOBILE: Reload data when returning to this page (sync may have happened)
      // This ensures we show fresh data after sync completes
      if (this.serviceId && this.templateId) {
        console.log('[VisualDetail] ionViewWillEnter MOBILE: Reloading data');
        this.loadVisualData();
      }
    }
  }

  ngOnDestroy() {
    this.routeSubscription?.unsubscribe();
    this.localImagesSubscription?.unsubscribe();
    this.visualFieldsSubscription?.unsubscribe();
  }

  /**
   * Check if there are unsaved changes (for route guard)
   * Only checks on web platform
   */
  hasUnsavedChanges(): boolean {
    if (!environment.isWeb) return false;

    // Check if title or text has been modified from the original values
    const titleChanged = this.editableTitle !== (this.item?.name || '');
    const textChanged = this.editableText !== (this.item?.text || '');

    return titleChanged || textChanged;
  }

  private loadRouteParams() {
    // Route structure: Container (projectId/serviceId) -> structural -> category/:category -> visual/:templateId
    // From visual-detail, we need to go up multiple levels

    // Get category from parent route params (category/:category level)
    const categoryParams = this.route.parent?.snapshot.params;
    this.categoryName = categoryParams?.['category'] || '';
    console.log('[VisualDetail] Category from route:', this.categoryName);

    // Get project/service IDs from container (go up through structural to container)
    // Try parent?.parent?.parent first (category -> structural -> container)
    let containerParams = this.route.parent?.parent?.parent?.snapshot?.params;
    console.log('[VisualDetail] Container params (p.p.p):', containerParams);

    if (containerParams) {
      this.projectId = containerParams['projectId'] || '';
      this.serviceId = containerParams['serviceId'] || '';
    }

    // Fallback: Try one more level up if needed
    if (!this.projectId || !this.serviceId) {
      containerParams = this.route.parent?.parent?.parent?.parent?.snapshot?.params;
      console.log('[VisualDetail] Container params (p.p.p.p):', containerParams);
      if (containerParams) {
        this.projectId = this.projectId || containerParams['projectId'] || '';
        this.serviceId = this.serviceId || containerParams['serviceId'] || '';
      }
    }

    console.log('[VisualDetail] Final values - Category:', this.categoryName, 'ProjectId:', this.projectId, 'ServiceId:', this.serviceId);

    // Get templateId from current route
    this.routeSubscription = this.route.params.subscribe(params => {
      this.templateId = parseInt(params['templateId'], 10);
      console.log('[VisualDetail] TemplateId from route:', this.templateId);
      this.loadVisualData();
    });
  }

  private async loadVisualData() {
    this.loading = true;

    try {
      // WEBAPP MODE: Load from server API to see synced data from mobile
      if (environment.isWeb) {
        console.log('[VisualDetail] WEBAPP MODE: Loading visual data from server');
        const visuals = await this.foundationData.getVisualsByService(this.serviceId);

        let visual: any = null;

        // PRIORITY 1: Check service mapping (persists across component destruction)
        // This ensures we find the visual even after name has been edited
        const mappedVisualId = this.foundationData.getWebappVisualRecordId(this.serviceId, this.categoryName, this.templateId);
        if (mappedVisualId) {
          visual = visuals.find((v: any) =>
            String(v.VisualID || v.PK_ID) === String(mappedVisualId)
          );
          if (visual) {
            console.log('[VisualDetail] WEBAPP PRIORITY 1: Matched by service mapping: templateId=' + this.templateId + ' -> VisualID=' + mappedVisualId);
          }
        }

        // PRIORITY 2: Match by TemplateID with type coercion (number/string mismatch)
        if (!visual) {
          visual = visuals.find((v: any) => {
            const vTemplateId = v.VisualTemplateID || v.TemplateID;
            return vTemplateId == this.templateId && v.Category === this.categoryName;
          });
          if (visual) {
            console.log('[VisualDetail] WEBAPP PRIORITY 2: Matched by TemplateID:', this.templateId);
          }
        }

        // PRIORITY 3: Fallback - load template name and match by name+category
        if (!visual) {
          const templates = await this.foundationData.getVisualsTemplates();
          const template = templates.find((t: any) =>
            ((t.TemplateID || t.PK_ID) == this.templateId) && t.Category === this.categoryName
          );
          if (template && template.Name) {
            visual = visuals.find((v: any) =>
              v.Name === template.Name && v.Category === this.categoryName
            );
            if (visual) {
              console.log('[VisualDetail] WEBAPP PRIORITY 3: Matched visual by name fallback:', template.Name);
            }
          }
        }

        if (visual) {
          this.item = {
            id: visual.VisualID || visual.PK_ID,
            templateId: visual.VisualTemplateID || visual.templateId || this.templateId,
            name: visual.Name || '',
            text: visual.VisualText || visual.Text || '',
            originalText: visual.VisualText || visual.Text || '',
            type: visual.Kind || 'Comment',
            category: visual.Category || this.categoryName,
            answerType: visual.AnswerType || 0,
            required: false,
            answer: visual.Answer || '',
            isSelected: true
          };
          this.visualId = String(visual.VisualID || visual.PK_ID);
          this.editableTitle = this.item.name;
          this.editableText = this.item.text;
          console.log('[VisualDetail] WEBAPP: Loaded visual from server:', this.item.name);
        } else {
          // No visual found - may be a template that hasn't been selected yet
          console.log('[VisualDetail] WEBAPP: Visual not found, loading template...');
          const templates = await this.foundationData.getVisualsTemplates();
          const template = templates.find((t: any) =>
            ((t.TemplateID || t.PK_ID) == this.templateId) && t.Category === this.categoryName
          );

          if (template) {
            const effectiveTemplateId = template.TemplateID || template.PK_ID;
            this.item = {
              id: effectiveTemplateId,
              templateId: effectiveTemplateId,
              name: template.Name || '',
              text: template.Text || '',
              originalText: template.Text || '',
              type: template.Kind || 'Comment',
              category: template.Category || this.categoryName,
              answerType: template.AnswerType || 0,
              required: false,
              isSelected: false
            };
            this.editableTitle = this.item.name;
            this.editableText = this.item.text;
            console.log('[VisualDetail] WEBAPP: Loaded from template:', this.item.name);
          }
        }

        // Load photos from server
        await this.loadPhotos();
        return;
      }

      // MOBILE MODE: Try to load from Dexie visualFields first
      const fields = await db.visualFields
        .where('[serviceId+category]')
        .equals([this.serviceId, this.categoryName])
        .toArray();

      const field = fields.find(f => f.templateId === this.templateId);

      if (field) {
        this.item = this.convertFieldToItem(field);
        this.editableTitle = this.item.name;
        this.editableText = this.item.text;
        console.log('[VisualDetail] Loaded item from Dexie field:', this.item.name);
      } else {
        // FALLBACK: Load from cached templates if field doesn't exist yet
        console.log('[VisualDetail] Field not in Dexie, loading from templates...');
        const cachedTemplates = await this.indexedDb.getCachedTemplates('visual') || [];
        // Match by TemplateID first, fallback to PK_ID (consistent with category-detail)
        const template = cachedTemplates.find((t: any) =>
          ((t.TemplateID || t.PK_ID) === this.templateId) && t.Category === this.categoryName
        );

        if (template) {
          // Create item from template - use effectiveTemplateId for consistency
          const effectiveTemplateId = template.TemplateID || template.PK_ID;
          this.item = {
            id: effectiveTemplateId,
            templateId: effectiveTemplateId,
            name: template.Name || '',
            text: template.Text || '',
            originalText: template.Text || '',
            type: template.Kind || 'Comment',
            category: template.Category || this.categoryName,
            answerType: template.AnswerType || 0,
            required: false,
            isSelected: false
          };
          this.editableTitle = this.item.name;
          this.editableText = this.item.text;
          console.log('[VisualDetail] Loaded item from template:', this.item.name);
        } else {
          console.warn('[VisualDetail] Template not found for ID:', this.templateId);
        }
      }

      // Load photos
      await this.loadPhotos();

      // MOBILE: Subscribe to visualField changes to react to sync updates
      // This ensures the page updates when sync modifies the Dexie field
      this.subscribeToVisualFieldChanges();

    } catch (error) {
      console.error('[VisualDetail] Error loading data:', error);
      await this.showToast('Error loading visual data', 'danger');
    } finally {
      this.loading = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * Subscribe to visualField changes via liveQuery
   * This allows the page to react when sync updates the Dexie field
   */
  private subscribeToVisualFieldChanges() {
    // Only needed for MOBILE mode - WEBAPP loads from server
    if (environment.isWeb) return;

    // Unsubscribe from previous subscription if exists
    this.visualFieldsSubscription?.unsubscribe();

    // Store current visualId to detect changes
    this.lastKnownVisualId = this.visualId;

    // Subscribe to visualFields changes for this service/template
    const observable = liveQuery(() =>
      db.visualFields
        .where('serviceId')
        .equals(this.serviceId)
        .toArray()
    );

    this.visualFieldsSubscription = observable.subscribe({
      next: async (fields) => {
        const field = fields.find(f => f.templateId === this.templateId);
        if (!field) return;

        // Get the current visualId from field (tempVisualId first, then visualId)
        const currentVisualId = field.tempVisualId || field.visualId || '';

        // Check if visualId changed (indicates sync completed and assigned real ID)
        const visualIdChanged = currentVisualId !== this.lastKnownVisualId && this.lastKnownVisualId !== '';

        // Update item data from field
        if (field.templateName && this.item) {
          const newName = field.templateName;
          const newText = field.templateText || '';

          // Only update if different (avoid unnecessary UI updates)
          if (this.item.name !== newName || this.item.text !== newText) {
            console.log('[VisualDetail] liveQuery: Field changed, updating item');
            console.log('[VisualDetail] liveQuery: Name:', this.item.name, '->', newName);

            this.item.name = newName;
            this.item.text = newText;
            this.editableTitle = newName;
            this.editableText = newText;
            this.changeDetectorRef.detectChanges();
          }
        }

        // If visualId changed (sync completed), update item.id and reload photos with correct entityId
        if (visualIdChanged) {
          console.log('[VisualDetail] liveQuery: VisualId changed from', this.lastKnownVisualId, 'to', currentVisualId, '- reloading photos');
          this.lastKnownVisualId = currentVisualId;

          // Update item.id reference to new visualId (temp -> real ID transition)
          if (this.item) {
            this.item.id = field.visualId || field.tempVisualId || this.item.id;
            console.log('[VisualDetail] liveQuery: Updated item.id to', this.item.id);
          }

          // Note: Don't set this.visualId here - let loadPhotos() do it from fresh field data
          await this.loadPhotos();
          this.changeDetectorRef.detectChanges();
        }
      },
      error: (err) => {
        console.error('[VisualDetail] liveQuery error:', err);
      }
    });

    console.log('[VisualDetail] Subscribed to visualField changes');
  }

  private convertFieldToItem(field: VisualField): VisualItem {
    return {
      id: field.id || field.templateId,
      templateId: field.templateId,
      name: field.templateName || '',
      text: field.templateText || '',
      originalText: field.templateText || '',
      type: field.kind || '',
      category: field.category || '',
      answerType: field.answerType || 0,
      required: false,
      answer: field.answer,
      isSelected: field.isSelected,
      key: field.key
    };
  }

  private async loadPhotos() {
    this.loadingPhotos = true;

    try {
      // ANNOTATION THUMBNAIL FIX: Load cached annotated images into memory map
      // This ensures thumbnails show annotations on page load
      if (this.bulkAnnotatedImagesMap.size === 0) {
        try {
          const cachedAnnotatedImages = await this.indexedDb.getAllCachedAnnotatedImagesForService();
          this.bulkAnnotatedImagesMap = cachedAnnotatedImages;
          console.log('[VisualDetail] Loaded', cachedAnnotatedImages.size, 'cached annotated images into memory');
        } catch (e) {
          console.warn('[VisualDetail] Could not load cached annotated images:', e);
        }
      }

      // WEBAPP MODE: Load photos from server API
      if (environment.isWeb) {
        if (!this.visualId) {
          this.photos = [];
          return;
        }

        console.log('[VisualDetail] WEBAPP MODE: Loading photos for visualId:', this.visualId);
        const attachments = await this.foundationData.getVisualAttachments(this.visualId);
        console.log('[VisualDetail] WEBAPP: Found', attachments?.length || 0, 'attachments from server');

        // WEBAPP: Load cached annotated images (persists annotations across page refresh)
        let cachedAnnotatedImages: Map<string, string> = new Map();
        try {
          cachedAnnotatedImages = await this.indexedDb.getAllCachedAnnotatedImagesForService();
          console.log(`[VisualDetail] WEBAPP: Loaded ${cachedAnnotatedImages.size} cached annotated images`);
        } catch (e) {
          console.warn('[VisualDetail] WEBAPP: Could not load cached annotated images:', e);
        }

        this.photos = [];
        for (const att of attachments || []) {
          // S3 uploads store the key in 'Attachment' field, not 'Photo'
          // Check Attachment first (S3 key), then Photo (legacy Caspio Files API)
          let displayUrl = att.Attachment || att.Photo || att.url || att.displayUrl || 'assets/img/photo-placeholder.svg';

          // If it's an S3 key, get signed URL
          if (displayUrl && this.caspioService.isS3Key && this.caspioService.isS3Key(displayUrl)) {
            try {
              displayUrl = await this.caspioService.getS3FileUrl(displayUrl);
            } catch (e) {
              console.warn('[VisualDetail] WEBAPP: Could not get S3 URL:', e);
            }
          }

          const attachId = String(att.AttachID || att.attachId || att.PK_ID);
          const hasServerAnnotations = !!(att.Drawings && att.Drawings.length > 10);
          let thumbnailUrl = displayUrl;
          let hasAnnotations = hasServerAnnotations;

          // WEBAPP FIX: ALWAYS check for cached annotated image first
          // CRITICAL: Annotations added locally may not be synced yet but are cached
          try {
            const cachedAnnotatedImage = cachedAnnotatedImages.get(attachId);
            if (cachedAnnotatedImage) {
              thumbnailUrl = cachedAnnotatedImage;
              hasAnnotations = true;
              console.log(`[VisualDetail] WEBAPP: Using cached annotated image for ${attachId}`);
            } else if (hasServerAnnotations && displayUrl && displayUrl !== 'assets/img/photo-placeholder.svg') {
              // No cached image but server has Drawings - render annotations on the fly
              console.log(`[VisualDetail] WEBAPP: Rendering annotations for ${attachId}...`);
              const renderedUrl = await renderAnnotationsOnPhoto(displayUrl, att.Drawings);
              if (renderedUrl && renderedUrl !== displayUrl) {
                thumbnailUrl = renderedUrl;
                // Cache for future use (convert data URL to blob first)
                try {
                  const response = await fetch(renderedUrl);
                  const blob = await response.blob();
                  await this.indexedDb.cacheAnnotatedImage(attachId, blob);
                } catch (cacheErr) {
                  console.warn('[VisualDetail] WEBAPP: Failed to cache annotated image:', cacheErr);
                }
                console.log(`[VisualDetail] WEBAPP: Rendered and cached annotations for ${attachId}`);
              }
            }
          } catch (annotErr) {
            console.warn(`[VisualDetail] WEBAPP: Failed to process annotations for ${attachId}:`, annotErr);
          }

          this.photos.push({
            id: attachId,
            displayUrl: thumbnailUrl,   // Use annotated if available
            originalUrl: displayUrl,    // Original for re-annotation
            caption: att.Annotation || att.caption || '',
            uploading: false,
            loading: true,              // Image is loading until (load) event fires
            isLocal: false,
            hasAnnotations,
            drawings: att.Drawings || '',
            // Include all ID fields for cache lookup (matches category-detail pattern)
            imageId: attachId,
            attachId: attachId
          });
        }

        return;
      }

      // MOBILE MODE: Load from local Dexie
      // EFE PATTERN: ALWAYS re-query visualFields and OVERWRITE visualId
      // This ensures we use the correct entityId for photo lookup after sync
      const allFields = await db.visualFields
        .where('serviceId')
        .equals(this.serviceId)
        .toArray();

      const field = allFields.find(f => f.templateId === this.templateId);

      // The entityId for photos is the visualId (temp_visual_xxx or real VisualID)
      // CRITICAL: Use tempVisualId FIRST because localImages are stored with the original temp ID
      // After sync, visualId contains the real ID but photos still have entityId = tempVisualId
      // NOTE: Don't use field.id (Dexie auto-increment) as it's not a valid visual ID
      this.visualId = field?.tempVisualId || field?.visualId || '';

      // Update lastKnownVisualId for liveQuery change detection
      this.lastKnownVisualId = this.visualId;

      if (!this.visualId) {
        console.log('[VisualDetail] MOBILE: No visualId found, cannot load photos');
        this.photos = [];
        return;
      }

      console.log('[VisualDetail] MOBILE: Loading photos for visualId:', this.visualId, 'field tempVisualId:', field?.tempVisualId, 'visualId:', field?.visualId);

      // DEXIE-FIRST: Load local images from IndexedDB using visualId as entityId
      // DIRECT Dexie query - 4-TIER FALLBACK for photo lookup
      let foundAtTier = 0;

      let localImages = await db.localImages
        .where('entityId')
        .equals(this.visualId)
        .toArray();

      if (localImages.length > 0) {
        foundAtTier = 1;
        console.log('[VisualDetail] MOBILE: TIER 1 (primary) - Found', localImages.length, 'photos with visualId:', this.visualId);
      }

      // FALLBACK 1: If no photos found and we have both tempVisualId and visualId, try the other ID
      if (localImages.length === 0 && field?.tempVisualId && field?.visualId) {
        const alternateId = (this.visualId === field.tempVisualId) ? field.visualId : field.tempVisualId;
        if (alternateId && alternateId !== this.visualId) {
          console.log('[VisualDetail] MOBILE: No photos found, trying alternate ID:', alternateId);
          localImages = await db.localImages.where('entityId').equals(alternateId).toArray();
          if (localImages.length > 0) {
            foundAtTier = 2;
            console.log('[VisualDetail] MOBILE: TIER 2 (alternate ID) - Found', localImages.length, 'photos');
          }
        }
      }

      // FALLBACK 2: If no photos found and we have tempVisualId, check tempIdMappings for mapped realId
      if (localImages.length === 0 && field?.tempVisualId) {
        const mappedRealId = await this.indexedDb.getRealId(field.tempVisualId);
        if (mappedRealId) {
          console.log('[VisualDetail] MOBILE: Trying mapped realId from tempIdMappings:', mappedRealId);
          localImages = await db.localImages.where('entityId').equals(mappedRealId).toArray();
          if (localImages.length > 0) {
            foundAtTier = 3;
            console.log('[VisualDetail] MOBILE: TIER 3 (tempIdMappings) - Found', localImages.length, 'photos');
            // Update VisualField with realId so future lookups work directly
            this.visualFieldRepo.setField(this.serviceId, this.categoryName, this.templateId, {
              visualId: mappedRealId
            }).catch(err => console.error('[VisualDetail] Failed to update visualId:', err));
          }
        }
      }

      // FALLBACK 3: If still no photos, do REVERSE lookup - query tempIdMappings by realId to find tempId
      if (localImages.length === 0 && field?.visualId && !field?.tempVisualId) {
        const reverseLookupTempId = await this.indexedDb.getTempId(field.visualId);
        if (reverseLookupTempId) {
          console.log('[VisualDetail] MOBILE: TIER 4 REVERSE LOOKUP - realId:', field.visualId, '-> tempId:', reverseLookupTempId);
          localImages = await db.localImages.where('entityId').equals(reverseLookupTempId).toArray();
          if (localImages.length > 0) {
            foundAtTier = 4;
            console.log('[VisualDetail] MOBILE: TIER 4 (reverse lookup) - Found', localImages.length, 'photos');
          }
        }
      }

      // Log final result with tier information
      if (foundAtTier > 0) {
        console.log('[VisualDetail] MOBILE: Photos found at TIER', foundAtTier, '- Total:', localImages.length, 'photos');
      } else {
        console.log('[VisualDetail] MOBILE: No photos found after all 4 tiers for visualId:', this.visualId);
      }

      // Convert to PhotoItem format
      this.photos = [];

      for (const img of localImages) {
        // Check if image has annotations
        const hasAnnotations = !!(img.drawings && img.drawings.length > 10);

        // Get the blob data if available
        let displayUrl = 'assets/img/photo-placeholder.svg';
        let originalUrl = displayUrl;

        // ANNOTATION THUMBNAIL FIX: Check multiple IDs for cached annotated image
        // Annotations may be cached under imageId or attachId after sync
        const possibleIds = [img.imageId, img.attachId].filter(id => id);
        let foundCachedAnnotated = false;

        for (const checkId of possibleIds) {
          // First check in-memory map (fastest)
          const memCached = this.bulkAnnotatedImagesMap.get(String(checkId));
          if (memCached) {
            displayUrl = memCached;
            foundCachedAnnotated = true;
            console.log('[VisualDetail] Using memory-cached annotated image for:', checkId);
            break;
          }

          // Then check IndexedDB if image has annotations
          if (hasAnnotations && !foundCachedAnnotated) {
            const cachedAnnotated = await this.indexedDb.getCachedAnnotatedImage(String(checkId));
            if (cachedAnnotated) {
              displayUrl = cachedAnnotated;
              foundCachedAnnotated = true;
              // Also store in memory map for faster future lookups
              this.bulkAnnotatedImagesMap.set(String(checkId), cachedAnnotated);
              console.log('[VisualDetail] Using IndexedDB-cached annotated image for:', checkId);
              break;
            }
          }
        }

        // Get original blob URL
        if (img.localBlobId) {
          const blob = await db.localBlobs.get(img.localBlobId);
          if (blob) {
            const blobObj = new Blob([blob.data], { type: blob.contentType });
            originalUrl = URL.createObjectURL(blobObj);
            // If no cached annotated image, use original
            if (!foundCachedAnnotated) {
              displayUrl = originalUrl;
            }
          }
        } else if (img.remoteUrl) {
          originalUrl = img.remoteUrl;
          if (!foundCachedAnnotated) {
            displayUrl = img.remoteUrl;
          }
        }

        // ANNOTATION THUMBNAIL FIX: If we have drawings but no cached image, render annotations
        if (hasAnnotations && !foundCachedAnnotated && originalUrl !== 'assets/img/photo-placeholder.svg') {
          try {
            console.log('[VisualDetail] Rendering annotations on the fly for:', img.imageId);
            const renderedUrl = await renderAnnotationsOnPhoto(originalUrl, img.drawings);
            if (renderedUrl && renderedUrl !== originalUrl) {
              displayUrl = renderedUrl;
              // Cache for future use
              this.bulkAnnotatedImagesMap.set(img.imageId, renderedUrl);
              if (img.attachId) {
                this.bulkAnnotatedImagesMap.set(img.attachId, renderedUrl);
              }
            }
          } catch (renderErr) {
            console.warn('[VisualDetail] Failed to render annotations:', renderErr);
          }
        }

        this.photos.push({
          id: img.imageId,
          displayUrl,
          originalUrl,
          caption: img.caption || '',
          uploading: img.status === 'queued' || img.status === 'uploading',
          isLocal: !img.isSynced,
          hasAnnotations,
          drawings: img.drawings || '',
          // Store all IDs for cache lookup in getPhotos()
          imageId: img.imageId,
          attachId: img.attachId || undefined
        });
      }

    } catch (error) {
      console.error('[VisualDetail] Error loading photos:', error);
    } finally {
      this.loadingPhotos = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  // ===== SAVE METHODS =====

  /**
   * Check if visualId is a valid Caspio visual ID (not Dexie auto-increment ID)
   */
  private isValidVisualId(id: string): boolean {
    if (!id) return false;
    // Valid: temp_visual_xxx or numeric Caspio IDs
    // Invalid: single digit Dexie IDs like "1", "2", etc.
    return id.startsWith('temp_') || (id.length > 3 && !isNaN(Number(id)));
  }

  async saveAll() {
    // Check for changes - allow save even if item doesn't exist yet
    const titleChanged = this.editableTitle !== (this.item?.name || '');
    const textChanged = this.editableText !== (this.item?.text || '');

    if (!titleChanged && !textChanged) {
      this.goBack();
      return;
    }

    this.saving = true;
    try {
      // Build update data for both Dexie and Caspio sync
      const dexieUpdate: any = {};
      const caspioUpdate: any = {};

      if (titleChanged) {
        dexieUpdate.templateName = this.editableTitle;
        caspioUpdate.Name = this.editableTitle;
      }

      if (textChanged) {
        dexieUpdate.templateText = this.editableText;
        caspioUpdate.Text = this.editableText;
      }

      // DEXIE-FIRST: Update local Dexie field (creates if doesn't exist)
      await this.visualFieldRepo.setField(
        this.serviceId,
        this.categoryName,
        this.templateId,
        dexieUpdate
      );
      console.log('[VisualDetail] ✅ Updated Dexie field:', dexieUpdate);

      // Queue update to Caspio for background sync (only if valid visualId)
      if (this.isValidVisualId(this.visualId)) {
        await this.foundationData.updateVisual(this.visualId, caspioUpdate, this.serviceId);
      }

      // Update local item state for immediate UI feedback
      if (this.item) {
        if (titleChanged) this.item.name = this.editableTitle;
        if (textChanged) this.item.text = this.editableText;
      }

      this.changeDetectorRef.detectChanges();

    } catch (error) {
      console.error('[VisualDetail] Error saving:', error);
      await this.showToast('Error saving changes', 'danger');
    } finally {
      this.saving = false;
    }

    // Navigate back
    this.goBack();
  }

  async saveTitle() {
    // Allow save even if item doesn't exist yet
    if (this.editableTitle === (this.item?.name || '')) return;

    this.saving = true;
    try {
      // DEXIE-FIRST: Update local Dexie field (creates if doesn't exist)
      // CRITICAL: Also save visualId, isSelected, and category so category-detail can restore it
      const dexieUpdate: any = {
        templateName: this.editableTitle,
        isSelected: true,  // Visual is selected if user is editing it
        category: this.categoryName
      };
      if (this.visualId) {
        dexieUpdate.visualId = this.visualId;
      }
      await this.visualFieldRepo.setField(
        this.serviceId,
        this.categoryName,
        this.templateId,
        dexieUpdate
      );
      console.log('[VisualDetail] ✅ Updated title in Dexie with visualId:', this.visualId);

      // Queue update to Caspio for background sync (only if valid visualId)
      if (this.isValidVisualId(this.visualId)) {
        await this.foundationData.updateVisual(this.visualId, { Name: this.editableTitle }, this.serviceId);
        console.log('[VisualDetail] ✅ Queued title update to Caspio');
      } else {
        console.log('[VisualDetail] No valid visualId - title saved to Dexie only');
      }

      // Update local item state for immediate UI feedback
      if (this.item) {
        this.item.name = this.editableTitle;
      }
    } catch (error) {
      console.error('[VisualDetail] Error saving title:', error);
      await this.showToast('Error saving title', 'danger');
    } finally {
      this.saving = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  async saveText() {
    // Allow save even if item doesn't exist yet
    if (this.editableText === (this.item?.text || '')) return;

    this.saving = true;
    try {
      // DEXIE-FIRST: Update local Dexie field (creates if doesn't exist)
      // CRITICAL: Also save visualId, isSelected, and category so category-detail can restore it
      const dexieUpdate: any = {
        templateText: this.editableText,
        isSelected: true,  // Visual is selected if user is editing it
        category: this.categoryName
      };
      if (this.visualId) {
        dexieUpdate.visualId = this.visualId;
      }
      await this.visualFieldRepo.setField(
        this.serviceId,
        this.categoryName,
        this.templateId,
        dexieUpdate
      );
      console.log('[VisualDetail] ✅ Updated text in Dexie with visualId:', this.visualId);

      // Queue update to Caspio for background sync (only if valid visualId)
      if (this.isValidVisualId(this.visualId)) {
        await this.foundationData.updateVisual(this.visualId, { Text: this.editableText }, this.serviceId);
        console.log('[VisualDetail] ✅ Queued text update to Caspio');
      } else {
        console.log('[VisualDetail] No valid visualId - text saved to Dexie only');
      }

      // Update local item state for immediate UI feedback
      if (this.item) {
        this.item.text = this.editableText;
      }
    } catch (error) {
      console.error('[VisualDetail] Error saving text:', error);
      await this.showToast('Error saving description', 'danger');
    } finally {
      this.saving = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  // ===== PHOTO METHODS =====

  async addPhotoFromCamera() {
    try {
      const photo = await Camera.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        saveToGallery: false
      });

      if (photo.dataUrl) {
        await this.processAndSavePhoto(photo.dataUrl);
      }
    } catch (error: any) {
      if (error?.message !== 'User cancelled photos app') {
        console.error('[VisualDetail] Camera error:', error);
        await this.showToast('Error taking photo', 'danger');
      }
    }
  }

  async addPhotoFromGallery() {
    try {
      const photo = await Camera.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Photos,
        saveToGallery: false
      });

      if (photo.dataUrl) {
        await this.processAndSavePhoto(photo.dataUrl);
      }
    } catch (error: any) {
      if (error?.message !== 'User cancelled photos app') {
        console.error('[VisualDetail] Gallery error:', error);
        await this.showToast('Error selecting photo', 'danger');
      }
    }
  }

  private async processAndSavePhoto(dataUrl: string) {
    try {
      if (!this.visualId) {
        console.error('[VisualDetail] Cannot save photo - no visualId found');
        await this.showToast('Error: Visual not found', 'danger');
        return;
      }

      // Convert dataUrl to blob then to File
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      // Compress the image
      const compressedBlob = await this.imageCompression.compressImage(blob as File, {
        maxSizeMB: 0.8,
        maxWidthOrHeight: 1280,
        useWebWorker: true
      });

      // Create File object
      const file = new File([compressedBlob], `photo_${Date.now()}.webp`, {
        type: compressedBlob.type || 'image/webp'
      });

      // ============================================
      // WEBAPP MODE: Direct S3 Upload
      // MOBILE MODE: Local-first with background sync
      // ============================================

      if (environment.isWeb) {
        console.log('[VisualDetail] WEBAPP MODE: Direct S3 upload starting...');

        // Create temp display URL
        const tempDisplayUrl = URL.createObjectURL(compressedBlob);
        const tempId = `uploading_${Date.now()}`;

        // Add temp photo entry with loading state
        this.photos.unshift({
          id: tempId,
          displayUrl: tempDisplayUrl,
          originalUrl: tempDisplayUrl,
          caption: '',
          uploading: true,
          isLocal: false
        });
        this.changeDetectorRef.detectChanges();

        try {
          // DEBUG: Log the exact visualId being used for upload
          console.log('[VisualDetail] WEBAPP: ⚠️ UPLOAD DEBUG - Using visualId:', this.visualId, 'for photo upload');

          // Upload directly to S3
          const uploadResult = await this.localImageService.uploadImageDirectToS3(
            file,
            'visual',
            this.visualId,
            this.serviceId,
            '', // caption
            ''  // drawings
          );

          console.log('[VisualDetail] WEBAPP: ✅ Upload complete, AttachID:', uploadResult.attachId, 'stored with VisualID:', this.visualId);

          // Replace temp photo with real photo
          const tempIndex = this.photos.findIndex(p => p.id === tempId);
          if (tempIndex >= 0) {
            this.photos[tempIndex] = {
              id: uploadResult.attachId,
              displayUrl: uploadResult.s3Url,
              originalUrl: uploadResult.s3Url,
              caption: '',
              uploading: false,
              isLocal: false,
              hasAnnotations: false,
              drawings: ''
            };
          }

          this.changeDetectorRef.detectChanges();
          await this.showToast('Photo uploaded successfully', 'success');

          // CRITICAL: Clear attachment cache so next page load fetches fresh data from server
          this.foundationData.clearEFEAttachmentsCache();

          // Clean up temp blob URL
          URL.revokeObjectURL(tempDisplayUrl);

        } catch (uploadError: any) {
          console.error('[VisualDetail] WEBAPP: ❌ Upload failed:', uploadError?.message || uploadError);

          // Remove temp photo on error
          const tempIndex = this.photos.findIndex(p => p.id === tempId);
          if (tempIndex >= 0) {
            this.photos.splice(tempIndex, 1);
          }
          this.changeDetectorRef.detectChanges();

          URL.revokeObjectURL(tempDisplayUrl);
          await this.showToast('Failed to upload photo. Please try again.', 'danger');
        }

        return;
      }

      // ============================================
      // MOBILE MODE: Local-first with background sync
      // ============================================

      // DEXIE-FIRST: Use LocalImageService.captureImage() which:
      // 1. Stores blob + metadata atomically
      // 2. Adds to upload outbox for background sync
      // 3. Returns stable imageId for UI
      const localImage = await this.localImageService.captureImage(
        file,
        'visual',
        this.visualId,
        this.serviceId,
        '', // caption
        ''  // drawings
      );

      console.log('[VisualDetail] ✅ Photo captured via LocalImageService:', localImage.imageId);

      // Get display URL from LocalImageService
      const displayUrl = await this.localImageService.getDisplayUrl(localImage);

      // Add to photos array immediately for UI display
      // CRITICAL: Set originalUrl for annotation re-editing (so we can annotate from the original image)
      this.photos.unshift({
        id: localImage.imageId,
        displayUrl,
        originalUrl: displayUrl,  // Store original for re-annotation
        caption: '',
        uploading: false,
        isLocal: true,
        hasAnnotations: false,
        drawings: ''
      });

      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('[VisualDetail] Error processing photo:', error);
      await this.showToast('Error processing photo', 'danger');
    }
  }

  async deletePhoto(photo: PhotoItem) {
    const alert = await this.alertController.create({
      header: 'Delete Photo',
      message: 'Are you sure you want to delete this photo?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            await this.confirmDeletePhoto(photo);
          }
        }
      ]
    });
    await alert.present();
  }

  private async confirmDeletePhoto(photo: PhotoItem) {
    try {
      // Remove from local array immediately for UI responsiveness
      const index = this.photos.findIndex(p => p.id === photo.id);
      if (index >= 0) {
        this.photos.splice(index, 1);
      }

      // Get localImage data before deletion
      const localImage = await db.localImages.get(photo.id);

      // Delete from IndexedDB (Dexie)
      if (localImage) {
        // Delete blob if exists
        if (localImage.localBlobId) {
          await db.localBlobs.delete(localImage.localBlobId);
        }
        // Delete image record
        await db.localImages.delete(photo.id);
      }

      // DEXIE-FIRST: Queue deletion for background sync if already synced to Caspio
      if (localImage?.attachId) {
        await this.foundationData.deleteVisualPhoto(localImage.attachId);
        console.log('[VisualDetail] ✅ Queued photo deletion to Caspio:', localImage.attachId);
      }

      await this.showToast('Photo deleted', 'success');
      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('[VisualDetail] Error deleting photo:', error);
      await this.showToast('Error deleting photo', 'danger');
    }
  }

  private isCaptionPopupOpen = false;

  async openCaptionPopup(photo: PhotoItem) {
    // Prevent multiple simultaneous popups
    if (this.isCaptionPopupOpen) {
      return;
    }

    this.isCaptionPopupOpen = true;

    try {
      // Escape HTML to prevent injection and errors
      const escapeHtml = (text: string) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      };

      // Create a temporary caption value to work with
      const tempCaption = escapeHtml(photo.caption || '');

      // Define preset location buttons - 3 columns layout
      const presetButtons = [
        ['Front', '1st', 'Laundry'],
        ['Left', '2nd', 'Kitchen'],
        ['Right', '3rd', 'Living'],
        ['Back', '4th', 'Dining'],
        ['Top', '5th', 'Bedroom'],
        ['Bottom', 'Floor', 'Bathroom'],
        ['Middle', 'Unit', 'Closet'],
        ['Primary', 'Attic', 'Entry'],
        ['Supply', 'Porch', 'Office'],
        ['Return', 'Deck', 'Garage'],
        ['Staircase', 'Roof', 'Indoor'],
        ['Hall', 'Ceiling', 'Outdoor']
      ];

      // Build custom HTML for the alert with preset buttons
      let buttonsHtml = '<div class="preset-buttons-container">';
      presetButtons.forEach(row => {
        buttonsHtml += '<div class="preset-row">';
        row.forEach(label => {
          buttonsHtml += `<button type="button" class="preset-btn" data-text="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
        });
        buttonsHtml += '</div>';
      });
      buttonsHtml += '</div>';

      const alert = await this.alertController.create({
        header: 'Photo Caption',
        cssClass: 'caption-popup-alert',
        message: ' ', // Empty space to prevent Ionic from hiding the message area
        buttons: [
          {
            text: 'Save',
            handler: () => {
              // Get caption value
              const input = document.getElementById('captionInput') as HTMLInputElement;
              const newCaption = input?.value || '';

              // Update photo caption in UI immediately
              photo.caption = newCaption;
              this.changeDetectorRef.detectChanges();

              // Close popup immediately (don't wait for save)
              this.isCaptionPopupOpen = false;

              // Save caption in background
              this.saveCaption(photo, newCaption);

              return true; // Close popup immediately
            }
          },
          {
            text: 'Cancel',
            role: 'cancel',
            handler: () => {
              this.isCaptionPopupOpen = false;
              return true;
            }
          }
        ]
      });

      await alert.present();

      // Inject HTML content immediately after presentation
      setTimeout(() => {
        try {
          const alertElement = document.querySelector('.caption-popup-alert .alert-message');
          if (!alertElement) {
            this.isCaptionPopupOpen = false;
            return;
          }

          // Build the full HTML content with inline styles for mobile app compatibility
          const htmlContent = `
            <div class="caption-popup-content">
              <div class="caption-input-container" style="position: relative; margin-bottom: 16px;">
                <input type="text" id="captionInput" class="caption-text-input"
                       placeholder="Enter caption..."
                       value="${tempCaption}"
                       maxlength="255"
                       style="width: 100%; padding: 14px 54px 14px 14px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; color: #333; background: white; box-sizing: border-box; height: 52px;" />
                <button type="button" id="undoCaptionBtn" class="undo-caption-btn" title="Undo Last Word"
                        style="position: absolute; right: 5px; top: 5px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; z-index: 10;">
                  <ion-icon name="backspace-outline" style="font-size: 20px; color: #666;"></ion-icon>
                </button>
              </div>
              ${buttonsHtml}
            </div>
          `;
          alertElement.innerHTML = htmlContent;

          const captionInput = document.getElementById('captionInput') as HTMLInputElement;
          const undoBtn = document.getElementById('undoCaptionBtn') as HTMLButtonElement;

          // Use event delegation for better performance
          const container = document.querySelector('.caption-popup-alert .preset-buttons-container');
          if (container && captionInput) {
            container.addEventListener('click', (e) => {
              try {
                const target = e.target as HTMLElement;
                const btn = target.closest('.preset-btn') as HTMLElement;
                if (btn) {
                  e.preventDefault();
                  e.stopPropagation();
                  const text = btn.getAttribute('data-text');
                  if (text && captionInput) {
                    // Add text + space to current caption
                    captionInput.value = (captionInput.value || '') + text + ' ';
                    // CRITICAL: Remove focus from button immediately to prevent orange highlight on mobile
                    (btn as HTMLButtonElement).blur();
                  }
                }
              } catch (error) {
                console.error('Error handling preset button click:', error);
              }
            }, { passive: false });
          }

          // Add click handler for undo button
          if (undoBtn && captionInput) {
            undoBtn.addEventListener('click', (e) => {
              try {
                e.preventDefault();
                e.stopPropagation();
                const currentValue = captionInput.value || '';
                if (currentValue.trim() === '') {
                  return;
                }
                // Trim trailing spaces and split by spaces
                const words = currentValue.trim().split(' ');
                // Remove the last word
                if (words.length > 0) {
                  words.pop();
                }
                // Join back and update input
                captionInput.value = words.join(' ');
                // Add trailing space if there are still words
                if (captionInput.value.length > 0) {
                  captionInput.value += ' ';
                }
              } catch (error) {
                console.error('Error handling undo button click:', error);
              }
            });
          }

          // CRITICAL: Add Enter key handler to prevent form submission and provide smooth save
          if (captionInput) {
            captionInput.addEventListener('keydown', (e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                // Find and click the Save button to trigger the save handler
                const saveBtn = document.querySelector('.caption-popup-alert button.alert-button:not([data-role="cancel"])') as HTMLButtonElement;
                if (saveBtn) {
                  saveBtn.click();
                }
              }
            });
          }
        } catch (error) {
          console.error('Error injecting caption popup content:', error);
          this.isCaptionPopupOpen = false;
        }
      }, 0);

      // Reset flag when alert is dismissed
      alert.onDidDismiss().then(() => {
        this.isCaptionPopupOpen = false;
      });

    } catch (error) {
      console.error('Error opening caption popup:', error);
      this.isCaptionPopupOpen = false;
    }
  }

  private async saveCaption(photo: PhotoItem, caption: string) {
    try {
      photo.caption = caption;

      // WEBAPP MODE: Update directly via Caspio API
      // Photos come from server, not localImages - use photo.drawings directly
      if (environment.isWeb && !photo.isLocal) {
        const attachId = photo.id;
        if (attachId && !String(attachId).startsWith('temp_') && !String(attachId).startsWith('img_')) {
          // CRITICAL: Use photo.drawings to preserve existing annotations
          // Do NOT use localImage?.drawings as localImages is empty in WEBAPP mode
          await this.foundationData.queueCaptionAndAnnotationUpdate(
            attachId,
            caption,
            photo.drawings || '',
            'visual',
            { serviceId: this.serviceId, visualId: this.visualId }
          );
          console.log('[VisualDetail] WEBAPP: ✅ Updated caption via API (preserved drawings):', attachId);
        }
        this.changeDetectorRef.detectChanges();
        return;
      }

      // MOBILE MODE: Update in localImages (Dexie)
      await db.localImages.update(photo.id, { caption, updatedAt: Date.now() });

      // Get the localImage to check status
      const localImage = await db.localImages.get(photo.id);

      // DEXIE-FIRST: Always queue caption update
      // Use attachId if synced, otherwise use imageId (sync worker will resolve it)
      const attachId = localImage?.attachId || photo.id;

      await this.foundationData.queueCaptionAndAnnotationUpdate(
        attachId,
        caption,
        localImage?.drawings || '',
        'visual',
        { serviceId: this.serviceId, visualId: this.visualId }
      );
      console.log('[VisualDetail] ✅ Queued caption update:', attachId, localImage?.attachId ? '(synced)' : '(pending photo sync)');

      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('[VisualDetail] Error saving caption:', error);
      await this.showToast('Error saving caption', 'danger');
    }
  }

  async viewPhoto(photo: PhotoItem) {
    // Store original index for reliable lookup after modal closes
    const originalPhotoIndex = this.photos.findIndex(p => p.id === photo.id);

    // CRITICAL: Use ORIGINAL URL for editing (without annotations)
    // This allows re-editing annotations on the base image
    const editUrl = photo.originalUrl || photo.displayUrl;

    // WEBAPP FIX: Load existing annotations properly (matching LBW pattern)
    // The annotator expects existingAnnotations, not existingDrawings
    let existingAnnotations: any = null;
    if (photo.drawings && photo.drawings.length > 10) {
      try {
        existingAnnotations = decompressAnnotationData(photo.drawings);
        console.log('[VisualDetail] Found existing annotations from drawings');
      } catch (e) {
        console.warn('[VisualDetail] Error loading annotations:', e);
      }
    }

    const modal = await this.modalController.create({
      component: FabricPhotoAnnotatorComponent,
      componentProps: {
        imageUrl: editUrl,
        photoId: photo.id,
        caption: photo.caption,
        entityId: this.visualId,
        entityType: 'visual',
        // Pass existing annotations for re-editing (correct prop name)
        existingAnnotations: existingAnnotations,
        existingCaption: photo.caption || '',
        isReEdit: !!existingAnnotations
      },
      cssClass: 'fullscreen-modal'
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();

    // Check if we have annotation data to save (with or without blob)
    // WEBAPP: Canvas may be tainted (cross-origin) so blob could be null but annotation data still present
    const hasAnnotationData = data && (data.annotatedBlob || data.compressedAnnotationData || data.annotationsData);

    if (hasAnnotationData) {
      console.log('[VisualDetail] Annotation saved, processing...', data.canvasTainted ? '(canvas tainted - no image export)' : '');

      const annotatedBlob = data.blob || data.annotatedBlob;
      const annotationsData = data.annotationData || data.annotationsData;
      const newCaption = data.caption !== undefined ? data.caption : photo.caption;

      // Create blob URL for immediate display (only if we have a blob)
      let newUrl: string | null = null;
      if (annotatedBlob) {
        newUrl = URL.createObjectURL(annotatedBlob);
      }

      // Find photo in array (may have moved)
      let photoIndex = this.photos.findIndex(p => p.id === photo.id);
      if (photoIndex === -1 && originalPhotoIndex !== -1 && originalPhotoIndex < this.photos.length) {
        photoIndex = originalPhotoIndex;
      }

      if (photoIndex !== -1) {
        try {
          // Use pre-compressed data if available, otherwise compress annotation data for storage
          let compressedDrawings = data.compressedAnnotationData || '';
          if (!compressedDrawings && annotationsData) {
            if (typeof annotationsData === 'object') {
              compressedDrawings = compressAnnotationData(JSON.stringify(annotationsData));
            } else if (typeof annotationsData === 'string') {
              compressedDrawings = compressAnnotationData(annotationsData);
            }
          }

          // WEBAPP MODE: Save directly to Caspio API (photos are server-side, not in local DB)
          if (environment.isWeb) {
            console.log('[VisualDetail] WEBAPP: Saving annotations directly to Caspio for AttachID:', photo.id);
            await this.foundationData.queueCaptionAndAnnotationUpdate(
              photo.id,
              newCaption,
              compressedDrawings,
              'visual',
              { serviceId: this.serviceId, visualId: this.visualId }
            );
            console.log('[VisualDetail] WEBAPP: ✅ Annotation update sent to Caspio');

            // Cache annotated image for thumbnail display
            if (annotatedBlob && annotatedBlob.size > 0) {
              try {
                await this.indexedDb.cacheAnnotatedImage(photo.id, annotatedBlob);
                console.log('[VisualDetail] WEBAPP: ✅ Cached annotated image for:', photo.id);
              } catch (cacheErr) {
                console.warn('[VisualDetail] WEBAPP: Failed to cache annotated image:', cacheErr);
              }
            }
          } else {
            // MOBILE MODE: DEXIE-FIRST - Update LocalImages table with new drawings
            await db.localImages.update(photo.id, {
              drawings: compressedDrawings,
              caption: newCaption,
              updatedAt: Date.now()
            });
            console.log('[VisualDetail] ✅ Updated LocalImages with drawings:', compressedDrawings.length, 'chars');

            // DEXIE-FIRST: Cache annotated image for thumbnail display
            if (annotatedBlob && annotatedBlob.size > 0) {
              try {
                await this.indexedDb.cacheAnnotatedImage(photo.id, annotatedBlob);
                console.log('[VisualDetail] ✅ Cached annotated image for:', photo.id);
              } catch (cacheErr) {
                console.warn('[VisualDetail] Failed to cache annotated image:', cacheErr);
              }
            }

            // Get the localImage to check if it has an attachId (synced to Caspio)
            const localImage = await db.localImages.get(photo.id);
            if (localImage?.attachId) {
              // Queue annotation update to Caspio for background sync
              await this.foundationData.queueCaptionAndAnnotationUpdate(
                localImage.attachId,
                newCaption,
                compressedDrawings,
                'visual',
                { serviceId: this.serviceId, visualId: this.visualId }
              );
              console.log('[VisualDetail] ✅ Queued annotation update to Caspio:', localImage.attachId);
            } else {
              console.log('[VisualDetail] Photo not yet synced, annotations stored locally for upload');
            }
          }

          // Show appropriate toast based on whether we could export the image
          if (data.canvasTainted) {
            await this.showToast('Annotations saved (refresh to see updates)', 'success');
          }

          // ANNOTATION THUMBNAIL FIX: Update UI immediately with new array reference
          const newDisplayUrl = newUrl || this.photos[photoIndex].displayUrl;
          const updatedPhoto: PhotoItem = {
            ...this.photos[photoIndex],
            displayUrl: newDisplayUrl,  // Keep existing URL if no new blob
            thumbnailUrl: newDisplayUrl,  // Also update thumbnailUrl for consistency
            originalUrl: this.photos[photoIndex].originalUrl || photo.originalUrl,
            caption: newCaption,
            hasAnnotations: !!annotationsData || !!compressedDrawings,
            drawings: compressedDrawings
          };

          // ANNOTATION THUMBNAIL FIX: Cache annotated URL under ALL possible IDs
          // This ensures lookup works whether using imageId, attachId, or id
          if (newUrl) {
            this.bulkAnnotatedImagesMap.set(photo.id, newUrl);
            // Also cache under imageId if different
            if (photo.imageId && photo.imageId !== photo.id) {
              this.bulkAnnotatedImagesMap.set(photo.imageId, newUrl);
            }
            // Also cache under attachId if available
            if (photo.attachId) {
              this.bulkAnnotatedImagesMap.set(photo.attachId, newUrl);
            }
            // If we just got the attachId from localImage, cache under that too
            const localImage = await db.localImages.get(photo.id);
            if (localImage?.attachId && localImage.attachId !== photo.id) {
              this.bulkAnnotatedImagesMap.set(localImage.attachId, newUrl);
            }
            console.log('[VisualDetail] Cached annotated URL for all IDs:', photo.id, photo.imageId, photo.attachId);
          }

          // CRITICAL: Create NEW array reference for Angular change detection
          const newPhotosArray = [...this.photos];
          newPhotosArray[photoIndex] = updatedPhoto;
          this.photos = newPhotosArray;

          this.changeDetectorRef.detectChanges();
          console.log('[VisualDetail] ✅ UI updated with annotated image - array reference replaced');

        } catch (error) {
          console.error('[VisualDetail] Error saving annotations:', error);
          await this.showToast('Error saving annotations', 'danger');
        }
      }
    } else if (data?.saved) {
      // Caption-only update (no annotation blob)
      await this.loadPhotos();
    }
  }

  // ===== NAVIGATION =====

  goBack() {
    // MOBILE: Use NavController for proper Ionic navigation stack handling
    // WEBAPP: Use Location service for browser history
    if (environment.isWeb) {
      this.location.back();
    } else {
      this.navController.back();
    }
  }

  // ===== UTILITIES =====

  private async showToast(message: string, color: 'success' | 'danger' | 'warning' = 'success') {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  onImageLoad(photo: PhotoItem) {
    // Image finished loading - remove shimmer effect
    if (photo) {
      photo.loading = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * ANNOTATION THUMBNAIL FIX: Get photos with cached annotated URLs applied
   * This method is called on every render to ensure thumbnails show annotations
   * Matches the category-detail pattern with multi-ID lookup
   */
  getPhotos(): PhotoItem[] {
    // Apply cached annotated URLs from bulkAnnotatedImagesMap
    if (this.photos.length > 0 && this.bulkAnnotatedImagesMap.size > 0) {
      for (const photo of this.photos) {
        // ANNOTATION THUMBNAIL FIX: Check multiple IDs for cached annotation
        // After sync, annotations may be cached under attachId instead of imageId
        const photoIds = [
          photo.imageId,
          photo.attachId,
          photo.id
        ].filter(id => id);

        for (const id of photoIds) {
          const cachedAnnotatedUrl = this.bulkAnnotatedImagesMap.get(String(id));
          if (cachedAnnotatedUrl && cachedAnnotatedUrl !== photo.displayUrl) {
            // Apply cached annotated URL to photo for display
            photo.displayUrl = cachedAnnotatedUrl;
            photo.thumbnailUrl = cachedAnnotatedUrl;
            photo.hasAnnotations = true;
            break; // Found cached URL, stop checking other IDs
          }
        }
      }
    }
    return this.photos;
  }

  trackByPhotoId(index: number, photo: PhotoItem): string {
    return photo.id || index.toString();
  }
}
