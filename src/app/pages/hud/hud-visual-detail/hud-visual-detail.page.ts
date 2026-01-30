import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, AlertController, ModalController, NavController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { CaspioService } from '../../../services/caspio.service';
import { FabricPhotoAnnotatorComponent } from '../../../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { IndexedDbService } from '../../../services/indexed-db.service';
import { ImageCompressionService } from '../../../services/image-compression.service';
import { db, VisualField } from '../../../services/caspio-db';
import { VisualFieldRepoService } from '../../../services/visual-field-repo.service';
import { LocalImageService } from '../../../services/local-image.service';
import { HudDataService } from '../hud-data.service';
import { compressAnnotationData } from '../../../utils/annotation-utils';
import { liveQuery } from 'dexie';
import { environment } from '../../../../environments/environment';
import { HasUnsavedChanges } from '../../../services/unsaved-changes.service';
import { LazyImageDirective } from '../../../directives/lazy-image.directive';

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
  isLocal: boolean;
  hasAnnotations?: boolean;
  drawings?: string;
  originalUrl?: string;
}

@Component({
  selector: 'app-hud-visual-detail',
  templateUrl: './hud-visual-detail.page.html',
  styleUrls: ['./hud-visual-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, LazyImageDirective]
})
export class HudVisualDetailPage implements OnInit, OnDestroy, HasUnsavedChanges {
  categoryName: string = '';
  routeCategory: string = '';  // Original category from route (e.g., 'hud') - used for navigation
  templateId: number = 0;
  projectId: string = '';
  serviceId: string = '';
  actualServiceId: string = '';  // Actual ServiceID field from Services record (used for HUD FK)
  hudId: string = '';  // The actual HUDID used to store photos

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

  // Subscriptions
  private routeSubscription?: Subscription;
  private localImagesSubscription?: Subscription;
  private visualFieldsSubscription?: { unsubscribe: () => void };  // Dexie liveQuery subscription

  // Track the last known hudId to detect changes after sync
  private lastKnownHudId: string = '';

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
    private hudData: HudDataService
  ) {}

  ngOnInit() {
    this.loadRouteParams();
  }

  ionViewWillEnter() {
    // Reload data when returning to this page for BOTH modes
    // WEBAPP: Reloads from server API to get latest title/description edits
    // MOBILE: Reloads from Dexie to get synced data
    if (this.serviceId && this.templateId) {
      console.log('[HudVisualDetail] ionViewWillEnter: Reloading data, isWeb:', environment.isWeb);
      this.loadVisualData();
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
    // HUD Route structure: Container (projectId/serviceId) -> category/:category -> visual/:templateId
    // From visual-detail, we need to go up multiple levels

    // Get category from parent route params (category/:category level)
    const categoryParams = this.route.parent?.snapshot.params;
    this.categoryName = categoryParams?.['category'] || '';
    this.routeCategory = this.categoryName;  // Store original route category for back navigation
    console.log('[HudVisualDetail] Category from route:', this.categoryName);

    // Get project/service IDs from container (go up through to container)
    // Try parent?.parent first (category -> container)
    let containerParams = this.route.parent?.parent?.snapshot?.params;
    console.log('[HudVisualDetail] Container params (p.p):', containerParams);

    if (containerParams) {
      this.projectId = containerParams['projectId'] || '';
      this.serviceId = containerParams['serviceId'] || '';
    }

    // Fallback: Try one more level up if needed
    if (!this.projectId || !this.serviceId) {
      containerParams = this.route.parent?.parent?.parent?.snapshot?.params;
      console.log('[HudVisualDetail] Container params (p.p.p):', containerParams);
      if (containerParams) {
        this.projectId = this.projectId || containerParams['projectId'] || '';
        this.serviceId = this.serviceId || containerParams['serviceId'] || '';
      }
    }

    // Get actualServiceId from query params (passed from category detail page)
    const queryParams = this.route.snapshot.queryParams;

    // WEBAPP MODE: Use hudId from query params for direct API lookup
    // MOBILE MODE: Don't use hudId from query params - loadPhotos() determines it from Dexie
    if (environment.isWeb && queryParams['hudId']) {
      this.hudId = queryParams['hudId'];
      console.log('[HudVisualDetail] WEBAPP: hudId from query params:', this.hudId);
    }

    // CRITICAL: actualServiceId is the real FK for HUD records (route param serviceId is PK_ID)
    if (queryParams['actualServiceId']) {
      this.actualServiceId = queryParams['actualServiceId'];
      console.log('[HudVisualDetail] actualServiceId from query params:', this.actualServiceId);
    }

    console.log('[HudVisualDetail] Final values - Category:', this.categoryName, 'ProjectId:', this.projectId, 'ServiceId:', this.serviceId, 'HudId:', this.hudId);

    // Get templateId from current route
    this.routeSubscription = this.route.params.subscribe(params => {
      this.templateId = parseInt(params['templateId'], 10);
      console.log('[HudVisualDetail] TemplateId from route:', this.templateId);
      this.loadVisualData();
    });
  }

  private async loadVisualData() {
    this.loading = true;

    // Store HUDID from query params - ONLY used for WEBAPP mode
    // MOBILE mode determines hudId from Dexie field lookup (tempVisualId || visualId)
    // This avoids race conditions where query param has real ID but photos still have temp entityId
    const hudIdFromQueryParams = this.hudId;

    try {
      // WEBAPP MODE: Load directly from server API
      if (environment.isWeb) {
        console.log('[HudVisualDetail] WEBAPP MODE: Loading HUD data from server');
        console.log('[HudVisualDetail] WEBAPP: HUDID from query params:', hudIdFromQueryParams || '(none)');

        let visual: any = null;

        // PRIORITY 1: If we have HUDID, fetch directly from table (most reliable, always fresh)
        if (hudIdFromQueryParams) {
          console.log('[HudVisualDetail] WEBAPP: Fetching HUD record directly by HUDID:', hudIdFromQueryParams);
          visual = await firstValueFrom(this.caspioService.getServicesHUDById(hudIdFromQueryParams));
          if (visual) {
            console.log('[HudVisualDetail] WEBAPP: Got fresh HUD record - Name:', visual.Name, 'Text:', visual.Text?.substring(0, 50));
          }
        }

        // PRIORITY 2: Fall back to service-level query + name matching
        if (!visual) {
          const queryServiceId = this.actualServiceId || this.serviceId;
          const hudRecords = await this.hudData.getHudByService(queryServiceId);
          console.log('[HudVisualDetail] WEBAPP: Loaded', hudRecords.length, 'HUD records for ServiceID:', queryServiceId);

          // Load templates to get the Name and Category for matching
          const templates = (await this.caspioService.getServicesHUDTemplates().toPromise()) || [];
          const template = templates.find((t: any) =>
            (t.TemplateID || t.PK_ID) == this.templateId
          );

          if (template && template.Name) {
            visual = hudRecords.find((v: any) =>
              v.Name === template.Name && v.Category === template.Category
            );
            if (visual) {
              console.log('[HudVisualDetail] WEBAPP: Matched HUD record by name+category:', template.Name, template.Category);
            }
          }

          // If still no visual, use template as fallback
          if (!visual && template) {
            console.log('[HudVisualDetail] WEBAPP: HUD record not found, using template data');
            const effectiveTemplateId = template.TemplateID || template.PK_ID;
            const actualCategory = template.Category || '';
            this.item = {
              id: effectiveTemplateId,
              templateId: effectiveTemplateId,
              name: template.Name || '',
              text: template.Text || '',
              originalText: template.Text || '',
              type: template.Kind || 'Comment',
              category: actualCategory,
              answerType: template.AnswerType || 0,
              required: false,
              isSelected: false
            };
            this.categoryName = actualCategory;
            this.editableTitle = this.item.name;
            this.editableText = this.item.text;

            if (hudIdFromQueryParams) {
              this.hudId = hudIdFromQueryParams;
              console.log('[HudVisualDetail] WEBAPP: Using HUDID from query params for photos:', this.hudId);
            }

            await this.loadPhotos();
            return;
          }
        }

        if (visual) {
          const actualCategory = visual.Category || '';
          this.item = {
            id: visual.HUDID || visual.PK_ID,
            templateId: this.templateId,
            name: visual.Name || '',
            text: visual.Text || '',
            originalText: visual.Text || '',
            type: visual.Kind || 'Comment',
            category: actualCategory,
            answerType: visual.AnswerType || 0,
            required: false,
            answer: visual.Answers || '',
            isSelected: true
          };
          this.hudId = String(visual.HUDID || visual.PK_ID);
          this.categoryName = actualCategory;
          this.editableTitle = this.item.name;
          this.editableText = this.item.text;
          console.log('[HudVisualDetail] WEBAPP: Loaded HUD record:', this.item.name, 'HUDID:', this.hudId, 'Category:', actualCategory);
        }

        // Load photos from server
        await this.loadPhotos();
        return;
      }

      // MOBILE MODE: Match EFE pattern exactly
      // 1. Try to load from Dexie visualFields first
      // 2. Fallback to cached templates
      console.log('[HudVisualDetail] MOBILE MODE: Loading data from Dexie');

      // Query visualFields by serviceId, then filter by templateId
      const allFields = await db.visualFields
        .where('serviceId')
        .equals(this.serviceId)
        .toArray();

      const field = allFields.find(f => f.templateId === this.templateId);

      // ALWAYS load cached templates - needed for fallback when field.templateName is empty
      const cachedTemplates = await this.indexedDb.getCachedTemplates('hud') || [];
      const template = cachedTemplates.find((t: any) =>
        Number(t.TemplateID || t.PK_ID) === this.templateId
      );

      console.log('[HudVisualDetail] MOBILE: Field found:', !!field, 'templateName:', field?.templateName);
      console.log('[HudVisualDetail] MOBILE: Template found:', !!template, 'Name:', template?.Name);

      // CRITICAL: If field exists but templateName is empty (old data), use template.Name as fallback
      if (field && field.templateName) {
        // Field has templateName - use it directly (matches EFE pattern)
        this.item = this.convertFieldToItem(field);
        this.editableTitle = this.item.name;
        this.editableText = this.item.text;

        // CRITICAL: Update categoryName to actual category (needed for saveTitle to find correct Dexie field)
        this.categoryName = field.category || this.categoryName;

        // NOTE: hudId is set in loadPhotos() using tempVisualId || visualId (EFE pattern)

        console.log('[HudVisualDetail] MOBILE: Loaded from Dexie field:', this.item.name, 'category:', this.categoryName);
      } else if (field && template) {
        // Field exists but templateName is empty - merge field data with template name
        // This handles data created before templateName was stored
        const actualCategory = field.category || template.Category || this.categoryName;
        this.item = {
          id: field.tempVisualId || field.visualId || field.templateId,
          templateId: field.templateId,
          name: template.Name || '',  // Use template name since field.templateName is empty
          text: field.templateText || template.Text || '',
          originalText: template.Text || '',
          type: field.kind || template.Kind || 'Comment',
          category: actualCategory,
          answerType: field.answerType || template.AnswerType || 0,
          required: false,
          answer: field.answer,
          isSelected: field.isSelected,
          key: field.key
        };
        this.editableTitle = this.item.name;
        this.editableText = this.item.text;

        // CRITICAL: Update categoryName to actual category (needed for saveTitle to find correct Dexie field)
        this.categoryName = actualCategory;

        // NOTE: hudId is set in loadPhotos() using tempVisualId || visualId (EFE pattern)

        console.log('[HudVisualDetail] MOBILE: Merged field+template - Name:', this.item.name, 'category:', this.categoryName);
      } else if (template) {
        // No field exists - use template (item not yet selected)
        const effectiveTemplateId = template.TemplateID || template.PK_ID;
        const actualCategory = template.Category || this.categoryName;
        this.item = {
          id: effectiveTemplateId,
          templateId: effectiveTemplateId,
          name: template.Name || '',
          text: template.Text || '',
          originalText: template.Text || '',
          type: template.Kind || 'Comment',
          category: actualCategory,
          answerType: template.AnswerType || 0,
          required: false,
          isSelected: false
        };
        this.editableTitle = this.item.name;
        this.editableText = this.item.text;

        // CRITICAL: Update categoryName to actual category (needed for saveTitle to find correct Dexie field)
        this.categoryName = actualCategory;

        // NOTE: For template-only case (no field exists yet), there won't be any photos
        // since photos are only added after a visual is created (which creates the field)
        // Do NOT use hudIdFromQueryParams - let loadPhotos() handle it via Dexie lookup

        console.log('[HudVisualDetail] MOBILE: Loaded from template:', this.item.name, 'category:', this.categoryName);
      } else {
        console.warn('[HudVisualDetail] MOBILE: No field or template found for ID:', this.templateId);
      }

      // Load photos
      await this.loadPhotos();

      // MOBILE: Subscribe to visualField changes to react to sync updates
      // This ensures the page updates when sync modifies the Dexie field
      this.subscribeToVisualFieldChanges();

    } catch (error) {
      console.error('[HudVisualDetail] Error loading data:', error);
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

    // Store current hudId to detect changes
    this.lastKnownHudId = this.hudId;

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

        // Get the current hudId from field (tempVisualId first, then visualId)
        const currentHudId = field.tempVisualId || field.visualId || '';

        // Check if hudId changed (indicates sync completed and assigned real ID)
        const hudIdChanged = currentHudId !== this.lastKnownHudId && this.lastKnownHudId !== '';

        // Update item data from field
        if (field.templateName && this.item) {
          const newName = field.templateName;
          const newText = field.templateText || '';

          // Only update if different (avoid unnecessary UI updates)
          if (this.item.name !== newName || this.item.text !== newText) {
            console.log('[HudVisualDetail] liveQuery: Field changed, updating item');
            console.log('[HudVisualDetail] liveQuery: Name:', this.item.name, '->', newName);

            this.item.name = newName;
            this.item.text = newText;
            this.editableTitle = newName;
            this.editableText = newText;
            this.changeDetectorRef.detectChanges();
          }
        }

        // If hudId changed (sync completed), reload photos with correct entityId
        if (hudIdChanged) {
          console.log('[HudVisualDetail] liveQuery: HudId changed from', this.lastKnownHudId, 'to', currentHudId, '- reloading photos');
          this.lastKnownHudId = currentHudId;
          // Note: Don't set this.hudId here - let loadPhotos() do it from fresh field data
          await this.loadPhotos();
          this.changeDetectorRef.detectChanges();
        }
      },
      error: (err) => {
        console.error('[HudVisualDetail] liveQuery error:', err);
      }
    });

    console.log('[HudVisualDetail] Subscribed to visualField changes');
  }

  private convertFieldToItem(field: VisualField): VisualItem {
    return {
      // EFE PATTERN: Use tempVisualId || visualId for the item id (not field.id which is Dexie auto-increment)
      id: field.tempVisualId || field.visualId || field.templateId,
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
      // WEBAPP MODE: Load photos from server API
      if (environment.isWeb) {
        if (!this.hudId) {
          this.photos = [];
          return;
        }

        console.log('[HudVisualDetail] WEBAPP MODE: Loading photos for hudId:', this.hudId);
        const attachments = await this.hudData.getHudAttachments(this.hudId);
        console.log('[HudVisualDetail] WEBAPP: Found', attachments?.length || 0, 'attachments from server');

        this.photos = [];
        for (const att of attachments || []) {
          // HUD NOTE: S3 uploads store the key in 'Attachment' field, not 'Photo'
          // Check Attachment first (S3 key), then Photo (legacy Caspio Files API)
          let displayUrl = att.Attachment || att.Photo || att.url || att.displayUrl || 'assets/img/photo-placeholder.svg';

          console.log('[HudVisualDetail] WEBAPP: Processing attachment:', {
            AttachID: att.AttachID,
            Attachment: att.Attachment,
            Photo: att.Photo,
            displayUrl
          });

          // If it's an S3 key, get signed URL
          if (displayUrl && this.caspioService.isS3Key && this.caspioService.isS3Key(displayUrl)) {
            try {
              displayUrl = await this.caspioService.getS3FileUrl(displayUrl);
              console.log('[HudVisualDetail] WEBAPP: Got S3 signed URL for:', att.AttachID);
            } catch (e) {
              console.warn('[HudVisualDetail] WEBAPP: Could not get S3 URL:', e);
            }
          }

          this.photos.push({
            id: att.AttachID || att.attachId || att.PK_ID,
            displayUrl,
            originalUrl: displayUrl,
            caption: att.Annotation || att.caption || '',
            uploading: false,
            isLocal: false,
            hasAnnotations: !!(att.Drawings && att.Drawings.length > 10),
            drawings: att.Drawings || ''
          });
        }

        return;
      }

      // MOBILE MODE: Load from local Dexie
      // EFE PATTERN: ALWAYS re-query visualFields and OVERWRITE hudId
      // This ensures we use the correct entityId for photo lookup after sync
      // HUD NOTE: Query by serviceId only (not by route category) because
      // route uses 'hud' but actual data has real categories

      const allFields = await db.visualFields
        .where('serviceId')
        .equals(this.serviceId)
        .toArray();

      const field = allFields.find(f => f.templateId === this.templateId);

      // EFE PATTERN: The entityId for photos is the visualId (temp_hud_xxx or real HUDID)
      // CRITICAL: Use tempVisualId FIRST because localImages are stored with the original temp ID
      // After sync, visualId contains the real ID but photos still have entityId = tempVisualId
      // NOTE: Don't use field.id (Dexie auto-increment) as it's not a valid visual ID
      this.hudId = field?.tempVisualId || field?.visualId || '';

      // Update lastKnownHudId for liveQuery change detection
      this.lastKnownHudId = this.hudId;

      if (!this.hudId) {
        console.log('[HudVisualDetail] MOBILE: No hudId found, cannot load photos');
        this.photos = [];
        return;
      }

      console.log('[HudVisualDetail] MOBILE: Loading photos for hudId:', this.hudId, 'field tempVisualId:', field?.tempVisualId, 'visualId:', field?.visualId);

      // DEXIE-FIRST: Load local images from IndexedDB using hudId as entityId
      // DIRECT Dexie query - matching EFE pattern EXACTLY (no service wrapper)
      let localImages = await db.localImages
        .where('entityId')
        .equals(this.hudId)
        .toArray();

      // FALLBACK 1: If no photos found and we have both tempVisualId and visualId, try the other ID
      // This handles the race condition where updateEntityIdForImages() hasn't completed yet
      // after sync - photos may still have entityId = tempVisualId while field has visualId
      if (localImages.length === 0 && field?.tempVisualId && field?.visualId) {
        const alternateId = (this.hudId === field.tempVisualId) ? field.visualId : field.tempVisualId;
        if (alternateId && alternateId !== this.hudId) {
          console.log('[HudVisualDetail] MOBILE: No photos found, trying alternate ID:', alternateId);
          localImages = await db.localImages
            .where('entityId')
            .equals(alternateId)
            .toArray();
          if (localImages.length > 0) {
            console.log('[HudVisualDetail] MOBILE: Found', localImages.length, 'photos with alternate ID');
          }
        }
      }

      // FALLBACK 2: If no photos found and we have tempVisualId, check tempIdMappings for mapped realId
      // This handles the case where photos were captured with REAL server ID (from cache)
      // but Dexie field has tempVisualId (from createVisual in MOBILE mode)
      // Pattern from hud-category-detail.populatePhotosFromDexie() lines 1694-1713
      if (localImages.length === 0 && field?.tempVisualId) {
        const mappedRealId = await this.indexedDb.getRealId(field.tempVisualId);
        if (mappedRealId) {
          console.log('[HudVisualDetail] MOBILE: Trying mapped realId from tempIdMappings:', mappedRealId);
          localImages = await db.localImages
            .where('entityId')
            .equals(mappedRealId)
            .toArray();
          if (localImages.length > 0) {
            console.log('[HudVisualDetail] MOBILE: Found', localImages.length, 'photos with mapped realId');
            // Update VisualField with realId so future lookups work directly
            this.visualFieldRepo.setField(this.serviceId, this.categoryName, this.templateId, {
              visualId: mappedRealId
            }).catch(err => console.error('[HudVisualDetail] Failed to update visualId:', err));
          }
        }
      }

      // FALLBACK 3: If still no photos, do REVERSE lookup - query tempIdMappings by realId to find tempId
      // This handles the case where:
      // - Sync completed, VisualField.visualId has real ID but tempVisualId is null
      // - Photos still have entityId = temp_hud_xxx (updateEntityIdForImages hasn't run)
      // Pattern from hud-category-detail.populatePhotosFromDexie() lines 1715-1728
      if (localImages.length === 0 && field?.visualId && !field?.tempVisualId) {
        const reverseLookupTempId = await this.indexedDb.getTempId(field.visualId);
        if (reverseLookupTempId) {
          console.log('[HudVisualDetail] MOBILE: REVERSE LOOKUP - realId:', field.visualId, '-> tempId:', reverseLookupTempId);
          localImages = await db.localImages
            .where('entityId')
            .equals(reverseLookupTempId)
            .toArray();
          if (localImages.length > 0) {
            console.log('[HudVisualDetail] MOBILE: Found', localImages.length, 'photos with reverse-lookup tempId');
          }
        }
      }

      console.log('[HudVisualDetail] MOBILE: Found', localImages.length, 'localImages for hudId:', this.hudId);

      // Convert to PhotoItem format
      this.photos = [];

      for (const img of localImages) {
        // Check if image has annotations
        const hasAnnotations = !!(img.drawings && img.drawings.length > 10);

        // Get the blob data if available
        let displayUrl = 'assets/img/photo-placeholder.svg';
        let originalUrl = displayUrl;

        // DEXIE-FIRST: Check for cached annotated image first (for thumbnails with annotations)
        if (hasAnnotations) {
          const cachedAnnotated = await this.indexedDb.getCachedAnnotatedImage(img.imageId);
          if (cachedAnnotated) {
            displayUrl = cachedAnnotated;
            console.log('[HudVisualDetail] MOBILE: Using cached annotated image for:', img.imageId);
          }
        }

        // Get original blob URL
        if (img.localBlobId) {
          const blob = await db.localBlobs.get(img.localBlobId);
          if (blob) {
            const blobObj = new Blob([blob.data], { type: blob.contentType });
            originalUrl = URL.createObjectURL(blobObj);
            // If no cached annotated image, use original
            if (displayUrl === 'assets/img/photo-placeholder.svg') {
              displayUrl = originalUrl;
            }
          }
        } else if (img.remoteUrl) {
          originalUrl = img.remoteUrl;
          if (displayUrl === 'assets/img/photo-placeholder.svg') {
            displayUrl = img.remoteUrl;
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
          drawings: img.drawings || ''
        });
      }

    } catch (error) {
      console.error('[HudVisualDetail] Error loading photos:', error);
    } finally {
      this.loadingPhotos = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  // ===== SAVE METHODS =====

  /**
   * Check if hudId is a valid Caspio HUD ID (not Dexie auto-increment ID)
   * HUD IDs can be small numbers like "93", so we check for valid numeric or temp IDs
   */
  private isValidHudId(id: string): boolean {
    if (!id) return false;
    // Valid: temp_visual_xxx OR any numeric Caspio ID (including small numbers like "93")
    // Invalid: empty strings
    // Note: HUD IDs can be small numbers, so don't require length > 3
    if (id.startsWith('temp_')) return true;
    const numId = Number(id);
    return !isNaN(numId) && numId > 0;
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

      // Use actual category from item (not route param "hud")
      const actualCategory = this.item?.category || this.categoryName;

      // DEXIE-FIRST: Update local Dexie field (creates if doesn't exist)
      await this.visualFieldRepo.setField(
        this.serviceId,
        actualCategory,
        this.templateId,
        dexieUpdate
      );
      console.log('[HudVisualDetail] ✅ Updated Dexie field:', dexieUpdate);

      // Queue update to Caspio for background sync (only if valid hudId)
      if (this.isValidHudId(this.hudId)) {
        await this.hudData.updateVisual(this.hudId, caspioUpdate, this.actualServiceId || this.serviceId);
        console.log('[HudVisualDetail] ✅ Updated Caspio HUD record:', this.hudId, caspioUpdate);
      } else {
        console.log('[HudVisualDetail] No valid hudId (' + this.hudId + ') - saved to Dexie only');
      }

      // Update local item state for immediate UI feedback
      if (this.item) {
        if (titleChanged) this.item.name = this.editableTitle;
        if (textChanged) this.item.text = this.editableText;
      }

      this.changeDetectorRef.detectChanges();

    } catch (error) {
      console.error('[HudVisualDetail] Error saving:', error);
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
      // Use actual category from item (not route param "hud")
      const actualCategory = this.item?.category || this.categoryName;

      // DEXIE-FIRST: Update local Dexie field (creates if doesn't exist)
      await this.visualFieldRepo.setField(
        this.serviceId,
        actualCategory,
        this.templateId,
        { templateName: this.editableTitle }
      );
      console.log('[HudVisualDetail] ✅ Updated title in Dexie');

      // Queue update to Caspio for background sync (only if valid hudId)
      if (this.isValidHudId(this.hudId)) {
        await this.hudData.updateVisual(this.hudId, { Name: this.editableTitle }, this.actualServiceId || this.serviceId);
        console.log('[HudVisualDetail] ✅ Updated title in Caspio HUD record:', this.hudId);
      } else {
        console.log('[HudVisualDetail] No valid hudId (' + this.hudId + ') - title saved to Dexie only');
      }

      // Update local item state for immediate UI feedback
      if (this.item) {
        this.item.name = this.editableTitle;
      }
    } catch (error) {
      console.error('[HudVisualDetail] Error saving title:', error);
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
      // Use actual category from item (not route param "hud")
      const actualCategory = this.item?.category || this.categoryName;

      // DEXIE-FIRST: Update local Dexie field (creates if doesn't exist)
      await this.visualFieldRepo.setField(
        this.serviceId,
        actualCategory,
        this.templateId,
        { templateText: this.editableText }
      );
      console.log('[HudVisualDetail] ✅ Updated text in Dexie');

      // Queue update to Caspio for background sync (only if valid hudId)
      if (this.isValidHudId(this.hudId)) {
        await this.hudData.updateVisual(this.hudId, { Text: this.editableText }, this.actualServiceId || this.serviceId);
        console.log('[HudVisualDetail] ✅ Updated text in Caspio HUD record:', this.hudId);
      } else {
        console.log('[HudVisualDetail] No valid hudId (' + this.hudId + ') - text saved to Dexie only');
      }

      // Update local item state for immediate UI feedback
      if (this.item) {
        this.item.text = this.editableText;
      }
    } catch (error) {
      console.error('[HudVisualDetail] Error saving text:', error);
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
        console.error('[HudVisualDetail] Camera error:', error);
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
        console.error('[HudVisualDetail] Gallery error:', error);
        await this.showToast('Error selecting photo', 'danger');
      }
    }
  }

  private async processAndSavePhoto(dataUrl: string) {
    try {
      if (!this.hudId) {
        console.error('[HudVisualDetail] Cannot save photo - no hudId found');
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
        console.log('[HudVisualDetail] WEBAPP MODE: Direct S3 upload starting...');

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
          // Upload directly to S3
          const uploadResult = await this.localImageService.uploadImageDirectToS3(
            file,
            'hud',
            this.hudId,
            this.serviceId,
            '', // caption
            ''  // drawings
          );

          console.log('[HudVisualDetail] WEBAPP: ✅ Upload complete, AttachID:', uploadResult.attachId);

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

          // Clean up temp blob URL
          URL.revokeObjectURL(tempDisplayUrl);

        } catch (uploadError: any) {
          console.error('[HudVisualDetail] WEBAPP: ❌ Upload failed:', uploadError?.message || uploadError);

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
        'hud',
        this.hudId,
        this.serviceId,
        '', // caption
        ''  // drawings
      );

      console.log('[HudVisualDetail] ✅ Photo captured via LocalImageService:', localImage.imageId);

      // Get display URL from LocalImageService
      const displayUrl = await this.localImageService.getDisplayUrl(localImage);

      // Add to photos array immediately for UI display
      this.photos.unshift({
        id: localImage.imageId,
        displayUrl,
        caption: '',
        uploading: false,
        isLocal: true
      });

      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('[HudVisualDetail] Error processing photo:', error);
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
        await this.hudData.deleteVisualPhoto(localImage.attachId);
        console.log('[HudVisualDetail] ✅ Queued photo deletion to Caspio:', localImage.attachId);
      }

      await this.showToast('Photo deleted', 'success');
      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('[HudVisualDetail] Error deleting photo:', error);
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

      // Update in localImages (Dexie)
      await db.localImages.update(photo.id, { caption, updatedAt: Date.now() });

      // Get the localImage to check status
      const localImage = await db.localImages.get(photo.id);

      // DEXIE-FIRST: Always queue caption update
      // Use attachId if synced, otherwise use imageId (sync worker will resolve it)
      const attachId = localImage?.attachId || photo.id;

      await this.hudData.queueCaptionAndAnnotationUpdate(
        attachId,
        caption,
        localImage?.drawings || '',
        'hud',
        { serviceId: this.serviceId, visualId: this.hudId }
      );
      console.log('[HudVisualDetail] ✅ Queued caption update:', attachId, localImage?.attachId ? '(synced)' : '(pending photo sync)');

      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('[HudVisualDetail] Error saving caption:', error);
      await this.showToast('Error saving caption', 'danger');
    }
  }

  async viewPhoto(photo: PhotoItem) {
    // Store original index for reliable lookup after modal closes
    const originalPhotoIndex = this.photos.findIndex(p => p.id === photo.id);

    // CRITICAL: Use ORIGINAL URL for editing (without annotations)
    // This allows re-editing annotations on the base image
    const editUrl = photo.originalUrl || photo.displayUrl;

    const modal = await this.modalController.create({
      component: FabricPhotoAnnotatorComponent,
      componentProps: {
        imageUrl: editUrl,
        photoId: photo.id,
        caption: photo.caption,
        entityId: this.hudId,
        entityType: 'hud',
        // Pass existing drawings for re-editing
        existingDrawings: photo.drawings || ''
      },
      cssClass: 'fullscreen-modal'
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();

    // Check if we have annotation data to save (with or without blob)
    // WEBAPP: Canvas may be tainted (cross-origin) so blob could be null but annotation data still present
    const hasAnnotationData = data && (data.annotatedBlob || data.compressedAnnotationData || data.annotationsData);

    if (hasAnnotationData) {
      console.log('[HudVisualDetail] Annotation saved, processing...', data.canvasTainted ? '(canvas tainted - no image export)' : '');

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

          // WEBAPP MODE: Photos come from server, not localImages
          if (environment.isWeb && !photo.isLocal) {
            // Cache annotated image for thumbnail display (use photo.id which is AttachID)
            if (annotatedBlob && annotatedBlob.size > 0) {
              try {
                await this.indexedDb.cacheAnnotatedImage(photo.id, annotatedBlob);
                console.log('[HudVisualDetail] WEBAPP: ✅ Cached annotated image for AttachID:', photo.id);
              } catch (cacheErr) {
                console.warn('[HudVisualDetail] WEBAPP: Failed to cache annotated image:', cacheErr);
              }
            }

            // Queue annotation update directly to Caspio (photo.id IS the AttachID in webapp mode)
            await this.hudData.queueCaptionAndAnnotationUpdate(
              photo.id,
              newCaption,
              compressedDrawings,
              'hud',
              { serviceId: this.serviceId, visualId: this.hudId }
            );
            console.log('[HudVisualDetail] WEBAPP: ✅ Queued annotation update to Caspio for AttachID:', photo.id);

            // Show appropriate toast based on whether we could export the image
            if (data.canvasTainted) {
              await this.showToast('Annotations saved (refresh to see updates)', 'success');
            }
          } else {
            // MOBILE MODE: Update LocalImages table with new drawings
            await db.localImages.update(photo.id, {
              drawings: compressedDrawings,
              caption: newCaption,
              updatedAt: Date.now()
            });
            console.log('[HudVisualDetail] ✅ Updated LocalImages with drawings:', compressedDrawings.length, 'chars');

            // Cache annotated image for thumbnail display
            if (annotatedBlob && annotatedBlob.size > 0) {
              try {
                await this.indexedDb.cacheAnnotatedImage(photo.id, annotatedBlob);
                console.log('[HudVisualDetail] ✅ Cached annotated image for:', photo.id);
              } catch (cacheErr) {
                console.warn('[HudVisualDetail] Failed to cache annotated image:', cacheErr);
              }
            }

            // Get the localImage to check if it has an attachId (synced to Caspio)
            const localImage = await db.localImages.get(photo.id);
            if (localImage?.attachId) {
              // Queue annotation update to Caspio for background sync
              await this.hudData.queueCaptionAndAnnotationUpdate(
                localImage.attachId,
                newCaption,
                compressedDrawings,
                'hud',
                { serviceId: this.serviceId, visualId: this.hudId }
              );
              console.log('[HudVisualDetail] ✅ Queued annotation update to Caspio:', localImage.attachId);
            } else {
              console.log('[HudVisualDetail] Photo not yet synced, annotations stored locally for upload');
            }
          }

          // Update local photo object immediately for UI
          this.photos[photoIndex] = {
            ...this.photos[photoIndex],
            displayUrl: newUrl || this.photos[photoIndex].displayUrl,  // Keep existing URL if no new blob
            originalUrl: this.photos[photoIndex].originalUrl || photo.originalUrl,
            caption: newCaption,
            hasAnnotations: !!annotationsData || !!compressedDrawings,
            drawings: compressedDrawings
          };

          this.changeDetectorRef.detectChanges();
          console.log('[HudVisualDetail] ✅ UI updated with annotated image');

        } catch (error) {
          console.error('[HudVisualDetail] Error saving annotations:', error);
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
    // MOBILE: Use NavController for proper Ionic navigation stack
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

  trackByPhotoId(index: number, photo: PhotoItem): string {
    return photo.id || index.toString();
  }
}
