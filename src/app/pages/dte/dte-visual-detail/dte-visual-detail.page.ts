import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, AlertController, ModalController, NavController, ViewWillEnter } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { CaspioService } from '../../../services/caspio.service';
import { FabricPhotoAnnotatorComponent } from '../../../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { IndexedDbService } from '../../../services/indexed-db.service';
import { PhotoHandlerService, PhotoCaptureConfig, StandardPhotoEntry } from '../../../services/photo-handler.service';
import { ImageCompressionService } from '../../../services/image-compression.service';
import { db, VisualField } from '../../../services/caspio-db';
import { VisualFieldRepoService } from '../../../services/visual-field-repo.service';
import { LocalImageService } from '../../../services/local-image.service';
import { DteDataService } from '../dte-data.service';
import { compressAnnotationData, decompressAnnotationData, renderAnnotationsOnPhoto } from '../../../utils/annotation-utils';
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
  loading?: boolean;
  isLocal: boolean;
  hasAnnotations?: boolean;
  drawings?: string;
  originalUrl?: string;
}

@Component({
  selector: 'app-dte-visual-detail',
  templateUrl: './dte-visual-detail.page.html',
  styleUrls: ['./dte-visual-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, LazyImageDirective]
})
export class DteVisualDetailPage implements OnInit, OnDestroy, ViewWillEnter, HasUnsavedChanges {
  // WEBAPP: Expose isWeb for template to hide camera button
  isWeb = environment.isWeb;

  categoryName: string = '';
  routeCategory: string = '';  // Original category from route - used for navigation
  templateId: number = 0;
  projectId: string = '';
  serviceId: string = '';
  actualServiceId: string = '';  // Actual ServiceID field from Services record (used for DTE FK)
  dteId: string = '';  // The actual DTEID used to store photos

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

  // Track the last known dteId to detect changes after sync
  private lastKnownDteId: string = '';

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
    private dteData: DteDataService,
    private photoHandler: PhotoHandlerService
  ) {}

  ngOnInit() {
    this.loadRouteParams();
  }

  ionViewWillEnter() {
    // WEBAPP: Clear loading state when returning to this page
    // This prevents the page from hanging if route params aren't set yet
    if (environment.isWeb) {
      this.loading = false;
      this.saving = false;
      this.changeDetectorRef.detectChanges();
    } else {
      // MOBILE: Reload data when returning to this page (sync may have happened)
      // This ensures we show fresh data after sync completes
      if (this.serviceId && this.templateId) {
        console.log('[DteVisualDetail] ionViewWillEnter MOBILE: Reloading data');
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

    const titleChanged = this.editableTitle !== (this.item?.name || '');
    const textChanged = this.editableText !== (this.item?.text || '');

    return titleChanged || textChanged;
  }

  private loadRouteParams() {
    // DTE Route structure: Container (projectId/serviceId) -> category/:category -> visual/:templateId
    // Get category from parent route params (category/:category level)
    // CRITICAL: Decode URL-encoded category names for proper matching
    const categoryParams = this.route.parent?.snapshot.params;
    const rawCategory = categoryParams?.['category'] || '';
    this.categoryName = rawCategory ? decodeURIComponent(rawCategory) : '';
    this.routeCategory = this.categoryName;
    console.log('[DteVisualDetail] Category from route:', rawCategory, '-> decoded:', this.categoryName);

    // Get project/service IDs from container (go up through to container)
    let containerParams = this.route.parent?.parent?.snapshot?.params;
    console.log('[DteVisualDetail] Container params (p.p):', containerParams);

    if (containerParams) {
      this.projectId = containerParams['projectId'] || '';
      this.serviceId = containerParams['serviceId'] || '';
    }

    // Fallback: Try one more level up if needed
    if (!this.projectId || !this.serviceId) {
      containerParams = this.route.parent?.parent?.parent?.snapshot?.params;
      console.log('[DteVisualDetail] Container params (p.p.p):', containerParams);
      if (containerParams) {
        this.projectId = this.projectId || containerParams['projectId'] || '';
        this.serviceId = this.serviceId || containerParams['serviceId'] || '';
      }
    }

    // Get query params (passed from category detail page)
    const queryParams = this.route.snapshot.queryParams;

    // WEBAPP MODE: Use dteId from query params for direct API lookup
    // MOBILE MODE: Don't use dteId from query params - loadVisualData() determines it from Dexie
    if (environment.isWeb && queryParams['dteId']) {
      this.dteId = queryParams['dteId'];
      console.log('[DteVisualDetail] WEBAPP: dteId from query params:', this.dteId);
    }

    if (queryParams['actualServiceId']) {
      this.actualServiceId = queryParams['actualServiceId'];
      console.log('[DteVisualDetail] actualServiceId from query params:', this.actualServiceId);
    }

    console.log('[DteVisualDetail] Final values - Category:', this.categoryName, 'ProjectId:', this.projectId, 'ServiceId:', this.serviceId, 'DteId:', this.dteId);

    // Get templateId from current route
    this.routeSubscription = this.route.params.subscribe(params => {
      this.templateId = parseInt(params['templateId'], 10);
      console.log('[DteVisualDetail] TemplateId from route:', this.templateId);
      this.loadVisualData();
    });
  }

  private async loadVisualData() {
    this.loading = true;

    let dteIdFromQueryParams = this.dteId;

    // WEBAPP FIX: If query params don't have dteId, try to read from Dexie
    // This ensures photos are found after page reload even if query params were lost
    if (environment.isWeb && !dteIdFromQueryParams && this.serviceId && this.templateId) {
      try {
        // Key format: ${serviceId}_${category}_${templateId}
        const fieldKey = `${this.serviceId}_${this.categoryName}_${this.templateId}`;
        const dexieField = await this.visualFieldRepo.getField(fieldKey);
        if (dexieField?.visualId) {
          dteIdFromQueryParams = dexieField.visualId;
          this.dteId = dexieField.visualId;
          console.log('[DteVisualDetail] WEBAPP: Restored dteId from Dexie:', dteIdFromQueryParams);
        }
      } catch (e) {
        console.warn('[DteVisualDetail] WEBAPP: Could not restore dteId from Dexie:', e);
      }
    }

    try {
      // WEBAPP MODE: Use LBW-style priority matching
      if (environment.isWeb) {
        console.log('[DteVisualDetail] WEBAPP MODE: Using priority-based matching (LBW pattern)');

        let visual: any = null;
        const queryServiceId = this.actualServiceId || this.serviceId;

        // PRIORITY 1: If we have DTEID, fetch directly from table (most reliable, always fresh)
        if (dteIdFromQueryParams) {
          console.log('[DteVisualDetail] WEBAPP: PRIORITY 1 - Fetching DTE record directly by DTEID:', dteIdFromQueryParams);
          visual = await firstValueFrom(this.caspioService.getServicesDTEById(dteIdFromQueryParams));
          if (visual) {
            console.log('[DteVisualDetail] WEBAPP: PRIORITY 1 - Got fresh DTE record - Name:', visual.Name, 'DTEID:', visual.DTEID);
          }
        }

        // Load all DTE records and templates for fallback matching
        const dteRecords = !visual ? await this.dteData.getVisualsByService(queryServiceId, true) : [];
        if (!visual) {
          console.log('[DteVisualDetail] WEBAPP: Loaded', dteRecords.length, 'DTE records for ServiceID:', queryServiceId);
        }

        const templates = (await this.caspioService.getServicesDTETemplates().toPromise()) || [];
        const template = templates.find((t: any) =>
          (t.TemplateID || t.PK_ID) == this.templateId
        );
        console.log('[DteVisualDetail] WEBAPP: Template found for templateId', this.templateId, ':', template ? template.Name : '(NOT FOUND)');

        // PRIORITY 1.5: For custom visuals, templateId might BE the DTEID - try matching directly (LBW pattern)
        if (!visual && this.templateId > 0) {
          console.log('[DteVisualDetail] WEBAPP: PRIORITY 1.5 - Looking for visual by templateId as DTEID:', this.templateId);
          visual = dteRecords.find((v: any) =>
            String(v.DTEID || v.PK_ID) === String(this.templateId)
          );
          if (visual) {
            console.log('[DteVisualDetail] WEBAPP: PRIORITY 1.5 - Found custom visual by DTEID:', this.templateId);
            this.dteId = String(visual.DTEID || visual.PK_ID);
          }
        }

        // PRIORITY 2: Match by TemplateID fields (LBW pattern)
        if (!visual && template) {
          const templateIdToMatch = String(template.TemplateID || template.PK_ID);
          console.log('[DteVisualDetail] WEBAPP: PRIORITY 2 - Looking for visual by TemplateID:', templateIdToMatch);
          visual = dteRecords.find((v: any) =>
            String(v.DTETemplateID) === templateIdToMatch ||
            String(v.VisualTemplateID) === templateIdToMatch ||
            String(v.TemplateID) === templateIdToMatch
          );
          if (visual) {
            console.log('[DteVisualDetail] WEBAPP: PRIORITY 2 - Matched DTE record by templateId:', templateIdToMatch);
          }
        }

        // PRIORITY 3: Fall back to Name + Category matching
        if (!visual && template && template.Name) {
          console.log('[DteVisualDetail] WEBAPP: PRIORITY 3 - Looking for visual by Name+Category:', template.Name, template.Category);
          visual = dteRecords.find((v: any) =>
            v.Name === template.Name && v.Category === template.Category
          );
          if (visual) {
            console.log('[DteVisualDetail] WEBAPP: PRIORITY 3 - Matched DTE record by name+category:', template.Name, template.Category);
          }
        }

        // PRIORITY 4: If only ONE visual in category, use it (LBW pattern)
        if (!visual && template) {
          const categoryVisuals = dteRecords.filter((v: any) => v.Category === (template.Category || this.categoryName));
          if (categoryVisuals.length === 1) {
            visual = categoryVisuals[0];
            console.log('[DteVisualDetail] WEBAPP: PRIORITY 4 FALLBACK - Using only visual in category:', visual.DTEID, 'Name:', visual.Name);
          } else if (categoryVisuals.length > 1) {
            console.warn('[DteVisualDetail] WEBAPP: PRIORITY 4 SKIPPED - Multiple visuals in category (' + categoryVisuals.length + '). No dteId provided, cannot determine correct visual.');
            console.warn('[DteVisualDetail] WEBAPP: Available visuals:', categoryVisuals.map((v: any) => ({ DTEID: v.DTEID, Name: v.Name })));
          }
        }

        if (visual) {
          const actualCategory = visual.Category || '';
          const visualDteId = String(visual.DTEID || visual.PK_ID);

          this.item = {
            id: visual.DTEID || visual.PK_ID,
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
          // WEBAPP FIX: Always use the visual's actual DTEID from server data (matches LBW pattern)
          this.dteId = visualDteId;
          this.categoryName = actualCategory;
          this.editableTitle = this.item.name;
          this.editableText = this.item.text;
          console.log('[DteVisualDetail] WEBAPP: Loaded DTE record:', this.item.name, 'DTEID:', this.dteId, 'Category:', actualCategory);
        } else if (template) {
          // No DTE record found - use template data
          console.log('[DteVisualDetail] WEBAPP: DTE record not found, using template data');
          const effectiveTemplateId = template.TemplateID || template.PK_ID || this.templateId;
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
          console.log('[DteVisualDetail] WEBAPP: Loaded from template:', this.item.name, 'Category:', actualCategory);

          // CRITICAL: Ensure we have the DTEID from query params for loading photos
          if (dteIdFromQueryParams) {
            this.dteId = dteIdFromQueryParams;
            console.log('[DteVisualDetail] WEBAPP: Using DTEID from query params for photos:', this.dteId);
          }
        } else {
          // Neither visual nor template found
          console.error('[DteVisualDetail] WEBAPP: ❌ Neither visual nor template found!');
        }

        await this.loadPhotos();
        return;
      }

      // MOBILE MODE: Load from Dexie
      console.log('[DteVisualDetail] MOBILE MODE: Loading data from Dexie');

      const allFields = await db.visualFields
        .where('serviceId')
        .equals(this.serviceId)
        .toArray();

      const field = allFields.find(f => f.templateId === this.templateId);

      const cachedTemplates = await this.indexedDb.getCachedTemplates('visual') || [];
      const template = cachedTemplates.find((t: any) =>
        Number(t.TemplateID || t.PK_ID) === this.templateId
      );

      console.log('[DteVisualDetail] MOBILE: Field found:', !!field, 'templateName:', field?.templateName);

      if (field && field.templateName) {
        this.item = this.convertFieldToItem(field);
        this.editableTitle = this.item.name;
        this.editableText = this.item.text;
        this.categoryName = field.category || this.categoryName;
        console.log('[DteVisualDetail] MOBILE: Loaded from Dexie field:', this.item.name);
      } else if (field && template) {
        const actualCategory = field.category || template.Category || this.categoryName;
        this.item = {
          id: field.tempVisualId || field.visualId || field.templateId,
          templateId: field.templateId,
          name: template.Name || '',
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
        this.categoryName = actualCategory;
        console.log('[DteVisualDetail] MOBILE: Merged field+template');
      } else if (template) {
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
        this.categoryName = actualCategory;
        console.log('[DteVisualDetail] MOBILE: Loaded from template:', this.item.name);
      } else {
        console.warn('[DteVisualDetail] MOBILE: No field or template found for ID:', this.templateId);
      }

      await this.loadPhotos();
      this.subscribeToVisualFieldChanges();

    } catch (error) {
      console.error('[DteVisualDetail] Error loading data:', error);
      await this.showToast('Error loading visual data', 'danger');
    } finally {
      this.loading = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  private subscribeToVisualFieldChanges() {
    if (environment.isWeb) return;

    this.visualFieldsSubscription?.unsubscribe();
    this.lastKnownDteId = this.dteId;

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

        const currentDteId = field.tempVisualId || field.visualId || '';
        const dteIdChanged = currentDteId !== this.lastKnownDteId && this.lastKnownDteId !== '';

        if (field.templateName && this.item) {
          const newName = field.templateName;
          const newText = field.templateText || '';

          if (this.item.name !== newName || this.item.text !== newText) {
            console.log('[DteVisualDetail] liveQuery: Field changed, updating item');
            this.item.name = newName;
            this.item.text = newText;
            this.editableTitle = newName;
            this.editableText = newText;
            this.changeDetectorRef.detectChanges();
          }
        }

        if (dteIdChanged) {
          console.log('[DteVisualDetail] liveQuery: DteId changed - reloading photos');
          this.lastKnownDteId = currentDteId;
          await this.loadPhotos();
          this.changeDetectorRef.detectChanges();
        }
      },
      error: (err) => {
        console.error('[DteVisualDetail] liveQuery error:', err);
      }
    });

    console.log('[DteVisualDetail] Subscribed to visualField changes');
  }

  private convertFieldToItem(field: VisualField): VisualItem {
    return {
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
        if (!this.dteId) {
          this.photos = [];
          return;
        }

        console.log('[DteVisualDetail] WEBAPP MODE: Loading photos for dteId:', this.dteId);
        const attachments = await this.dteData.getVisualAttachments(this.dteId);
        console.log('[DteVisualDetail] WEBAPP: Found', attachments?.length || 0, 'attachments');

        // Load cached annotated images FIRST (annotations may not have synced to server yet)
        const annotatedImagesMap = await this.indexedDb.getAllCachedAnnotatedImagesForService();
        console.log('[DteVisualDetail] WEBAPP: Loaded', annotatedImagesMap.size, 'cached annotated images');

        this.photos = [];
        for (const att of attachments || []) {
          const attachId = String(att.AttachID || att.attachId || att.PK_ID);
          let displayUrl = att.Attachment || att.Photo || att.url || 'assets/img/photo-placeholder.svg';
          let originalUrl = displayUrl;

          if (displayUrl && this.caspioService.isS3Key && this.caspioService.isS3Key(displayUrl)) {
            try {
              displayUrl = await this.caspioService.getS3FileUrl(displayUrl);
              originalUrl = displayUrl; // Save the original S3 URL for re-annotation
            } catch (e) {
              console.warn('[DteVisualDetail] WEBAPP: Could not get S3 URL:', e);
            }
          }

          const hasServerAnnotations = !!(att.Drawings && att.Drawings.length > 10);
          let thumbnailUrl = displayUrl;
          let hasAnnotations = hasServerAnnotations;

          // WEBAPP FIX: Check for cached annotated image, but ONLY use if server also has annotations
          // This prevents stale cached images from appearing when annotations were cleared
          // or when the cache has an image from a different photo with the same attachId
          try {
            const cachedAnnotated = annotatedImagesMap.get(attachId);
            if (cachedAnnotated && hasServerAnnotations) {
              // Server has annotations AND we have a cached image - use the cached version
              thumbnailUrl = cachedAnnotated;
              hasAnnotations = true;
              console.log(`[DteVisualDetail] WEBAPP: Using cached annotated image for ${attachId} (server has Drawings)`);
            } else if (cachedAnnotated && !hasServerAnnotations) {
              // Cached image exists but server has NO annotations - cache is stale, clear it
              console.log(`[DteVisualDetail] WEBAPP: Clearing stale cached annotated image for ${attachId} (server has no Drawings)`);
              await this.indexedDb.deleteCachedAnnotatedImage(attachId);
            } else if (hasServerAnnotations && displayUrl && displayUrl !== 'assets/img/photo-placeholder.svg') {
              // No cached image but server has Drawings - render annotations on the fly
              console.log(`[DteVisualDetail] WEBAPP: Rendering annotations for ${attachId}...`);
              const renderedUrl = await renderAnnotationsOnPhoto(displayUrl, att.Drawings);
              if (renderedUrl && renderedUrl !== displayUrl) {
                thumbnailUrl = renderedUrl;
                // Cache for future use (convert data URL to blob first)
                try {
                  const response = await fetch(renderedUrl);
                  const blob = await response.blob();
                  await this.indexedDb.cacheAnnotatedImage(attachId, blob);
                } catch (cacheErr) {
                  console.warn('[DteVisualDetail] WEBAPP: Failed to cache annotated image:', cacheErr);
                }
                console.log(`[DteVisualDetail] WEBAPP: Rendered and cached annotations for ${attachId}`);
              }
            }
          } catch (annotErr) {
            console.warn(`[DteVisualDetail] WEBAPP: Failed to process annotations for ${attachId}:`, annotErr);
          }

          this.photos.push({
            id: attachId,
            displayUrl: thumbnailUrl,   // Use annotated if available
            originalUrl: originalUrl,   // Original for re-annotation
            caption: att.Annotation || att.caption || '',
            uploading: false,
            loading: true,              // Image is loading until (load) event fires
            isLocal: false,
            hasAnnotations,
            drawings: att.Drawings || ''
          });
        }

        return;
      }

      // MOBILE MODE: Load from Dexie
      const allFields = await db.visualFields
        .where('serviceId')
        .equals(this.serviceId)
        .toArray();

      const field = allFields.find(f => f.templateId === this.templateId);
      this.dteId = field?.tempVisualId || field?.visualId || '';
      this.lastKnownDteId = this.dteId;

      if (!this.dteId) {
        console.log('[DteVisualDetail] MOBILE: No dteId found');
        this.photos = [];
        return;
      }

      console.log('[DteVisualDetail] MOBILE: Loading photos for dteId:', this.dteId);

      let localImages = await db.localImages
        .where('entityId')
        .equals(this.dteId)
        .toArray();

      // Fallback lookups for entity ID mismatches
      if (localImages.length === 0 && field?.tempVisualId && field?.visualId) {
        const alternateId = (this.dteId === field.tempVisualId) ? field.visualId : field.tempVisualId;
        if (alternateId && alternateId !== this.dteId) {
          localImages = await db.localImages.where('entityId').equals(alternateId).toArray();
        }
      }

      if (localImages.length === 0 && field?.tempVisualId) {
        const mappedRealId = await this.indexedDb.getRealId(field.tempVisualId);
        if (mappedRealId) {
          localImages = await db.localImages.where('entityId').equals(mappedRealId).toArray();
        }
      }

      if (localImages.length === 0 && field?.visualId && !field?.tempVisualId) {
        const reverseLookupTempId = await this.indexedDb.getTempId(field.visualId);
        if (reverseLookupTempId) {
          localImages = await db.localImages.where('entityId').equals(reverseLookupTempId).toArray();
        }
      }

      console.log('[DteVisualDetail] MOBILE: Found', localImages.length, 'localImages');

      this.photos = [];
      for (const img of localImages) {
        const hasAnnotations = !!(img.drawings && img.drawings.length > 10);
        let displayUrl = 'assets/img/photo-placeholder.svg';
        let originalUrl = displayUrl;

        if (hasAnnotations) {
          const cachedAnnotated = await this.indexedDb.getCachedAnnotatedImage(img.imageId);
          if (cachedAnnotated) {
            displayUrl = cachedAnnotated;
          }
        }

        if (img.localBlobId) {
          const blob = await db.localBlobs.get(img.localBlobId);
          if (blob) {
            const blobObj = new Blob([blob.data], { type: blob.contentType });
            originalUrl = URL.createObjectURL(blobObj);
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
      console.error('[DteVisualDetail] Error loading photos:', error);
    } finally {
      this.loadingPhotos = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  // ===== SAVE METHODS =====

  private isValidDteId(id: string): boolean {
    if (!id) return false;
    if (id.startsWith('temp_')) return true;
    const numId = Number(id);
    return !isNaN(numId) && numId > 0;
  }

  async saveTitle() {
    if (this.editableTitle === (this.item?.name || '')) return;

    this.saving = true;
    try {
      const actualCategory = this.item?.category || this.categoryName;

      // WEBAPP: Direct API update only (no Dexie) - matching LBW pattern
      // MOBILE: Dexie-first with background sync
      if (environment.isWeb) {
        if (this.isValidDteId(this.dteId)) {
          await this.dteData.updateVisual(this.dteId, { Name: this.editableTitle });
          console.log('[DteVisualDetail] WEBAPP: ✅ Updated title via API:', this.dteId);
        } else {
          console.warn('[DteVisualDetail] WEBAPP: No valid dteId, cannot save title');
        }
      } else {
        // MOBILE: DEXIE-FIRST - Include visualId so Dexie mapping exists for category-detail lookup
        const fieldData: any = {
          templateName: this.editableTitle,
          isSelected: true,
          category: actualCategory
        };

        if (this.isValidDteId(this.dteId)) {
          fieldData.visualId = this.dteId;
        }

        await this.visualFieldRepo.setField(
          this.serviceId,
          actualCategory,
          this.templateId,
          fieldData
        );
        console.log('[DteVisualDetail] MOBILE: ✅ Updated title in Dexie with visualId:', this.dteId);

        if (this.isValidDteId(this.dteId)) {
          await this.dteData.updateVisual(this.dteId, { Name: this.editableTitle });
          console.log('[DteVisualDetail] MOBILE: ✅ Queued title update for sync:', this.dteId);
        }
      }

      if (this.item) {
        this.item.name = this.editableTitle;
      }
    } catch (error) {
      console.error('[DteVisualDetail] Error saving title:', error);
      await this.showToast('Error saving title', 'danger');
    } finally {
      this.saving = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  async saveText() {
    if (this.editableText === (this.item?.text || '')) return;

    this.saving = true;
    try {
      const actualCategory = this.item?.category || this.categoryName;

      // WEBAPP: Direct API update only (no Dexie) - matching LBW pattern
      // MOBILE: Dexie-first with background sync
      if (environment.isWeb) {
        if (this.isValidDteId(this.dteId)) {
          await this.dteData.updateVisual(this.dteId, { Text: this.editableText });
          console.log('[DteVisualDetail] WEBAPP: ✅ Updated text via API:', this.dteId);
        } else {
          console.warn('[DteVisualDetail] WEBAPP: No valid dteId, cannot save text');
        }
      } else {
        // MOBILE: DEXIE-FIRST - Include visualId so Dexie mapping exists for category-detail lookup
        const fieldData: any = {
          templateText: this.editableText,
          isSelected: true,
          category: actualCategory
        };

        if (this.isValidDteId(this.dteId)) {
          fieldData.visualId = this.dteId;
        }

        await this.visualFieldRepo.setField(
          this.serviceId,
          actualCategory,
          this.templateId,
          fieldData
        );
        console.log('[DteVisualDetail] MOBILE: ✅ Updated text in Dexie with visualId:', this.dteId);

        if (this.isValidDteId(this.dteId)) {
          await this.dteData.updateVisual(this.dteId, { Text: this.editableText });
          console.log('[DteVisualDetail] MOBILE: ✅ Queued text update for sync:', this.dteId);
        }
      }

      if (this.item) {
        this.item.text = this.editableText;
      }
    } catch (error) {
      console.error('[DteVisualDetail] Error saving text:', error);
      await this.showToast('Error saving description', 'danger');
    } finally {
      this.saving = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  // ===== PHOTO METHODS (using centralized PhotoHandlerService) =====

  /**
   * Capture photo from camera using consolidated PhotoHandlerService
   */
  async addPhotoFromCamera() {
    if (!this.dteId) {
      console.error('[DteVisualDetail] Cannot capture photo - no dteId found');
      await this.showToast('Error: Visual not found', 'danger');
      return;
    }

    try {
      const config: PhotoCaptureConfig = {
        entityType: 'dte',
        entityId: this.dteId,
        serviceId: this.serviceId,
        category: this.categoryName,
        itemId: this.templateId,
        onTempPhotoAdded: (photo: StandardPhotoEntry) => {
          this.photos.unshift({
            id: photo.imageId,
            displayUrl: photo.displayUrl,
            originalUrl: photo.originalUrl,
            caption: photo.caption || '',
            uploading: photo.uploading,
            isLocal: photo.isLocal,
            hasAnnotations: photo.hasAnnotations,
            drawings: photo.Drawings || ''
          });
          this.changeDetectorRef.detectChanges();
        },
        onUploadComplete: (photo: StandardPhotoEntry, tempId: string) => {
          const tempIndex = this.photos.findIndex(p => p.id === tempId);
          if (tempIndex >= 0) {
            this.photos[tempIndex] = {
              id: photo.imageId,
              displayUrl: photo.displayUrl,
              originalUrl: photo.originalUrl,
              caption: photo.caption || '',
              uploading: false,
              isLocal: photo.isLocal,
              hasAnnotations: photo.hasAnnotations,
              drawings: photo.Drawings || ''
            };
          }
          // Clear attachment cache for fresh data
          this.dteData.clearAllCaches();
          this.changeDetectorRef.detectChanges();
        },
        onUploadFailed: (tempId: string, error: any) => {
          const tempIndex = this.photos.findIndex(p => p.id === tempId);
          if (tempIndex >= 0) {
            this.photos.splice(tempIndex, 1);
          }
          this.changeDetectorRef.detectChanges();
        }
      };

      await this.photoHandler.captureFromCamera(config);
    } catch (error: any) {
      // Check if user cancelled
      const errorMessage = typeof error === 'string' ? error : error?.message || '';
      if (!errorMessage.includes('cancel') && !errorMessage.includes('Cancel') && !errorMessage.includes('User')) {
        console.error('[DteVisualDetail] Camera error:', error);
        await this.showToast('Error taking photo', 'danger');
      }
    }
  }

  /**
   * Select photos from gallery using consolidated PhotoHandlerService
   */
  async addPhotoFromGallery() {
    if (!this.dteId) {
      console.error('[DteVisualDetail] Cannot select photo - no dteId found');
      await this.showToast('Error: Visual not found', 'danger');
      return;
    }

    try {
      const config: PhotoCaptureConfig = {
        entityType: 'dte',
        entityId: this.dteId,
        serviceId: this.serviceId,
        category: this.categoryName,
        itemId: this.templateId,
        skipAnnotator: true,  // Multi-select skips annotator
        onTempPhotoAdded: (photo: StandardPhotoEntry) => {
          this.photos.unshift({
            id: photo.imageId,
            displayUrl: photo.displayUrl,
            originalUrl: photo.originalUrl,
            caption: photo.caption || '',
            uploading: photo.uploading || photo.isSkeleton,
            isLocal: photo.isLocal,
            hasAnnotations: photo.hasAnnotations,
            drawings: photo.Drawings || ''
          });
          this.changeDetectorRef.detectChanges();
        },
        onUploadComplete: (photo: StandardPhotoEntry, tempId: string) => {
          const tempIndex = this.photos.findIndex(p => p.id === tempId);
          if (tempIndex >= 0) {
            this.photos[tempIndex] = {
              id: photo.imageId,
              displayUrl: photo.displayUrl,
              originalUrl: photo.originalUrl,
              caption: photo.caption || '',
              uploading: false,
              isLocal: photo.isLocal,
              hasAnnotations: photo.hasAnnotations,
              drawings: photo.Drawings || ''
            };
          }
          // Clear attachment cache for fresh data
          this.dteData.clearAllCaches();
          this.changeDetectorRef.detectChanges();
        },
        onUploadFailed: (tempId: string, error: any) => {
          const tempIndex = this.photos.findIndex(p => p.id === tempId);
          if (tempIndex >= 0) {
            this.photos[tempIndex] = {
              ...this.photos[tempIndex],
              uploading: false
            };
          }
          this.changeDetectorRef.detectChanges();
        }
      };

      await this.photoHandler.captureFromGallery(config);
    } catch (error: any) {
      // Check if user cancelled
      const errorMessage = typeof error === 'string' ? error : error?.message || '';
      if (!errorMessage.includes('cancel') && !errorMessage.includes('Cancel') && !errorMessage.includes('User')) {
        console.error('[DteVisualDetail] Gallery error:', error);
        await this.showToast('Error selecting photo', 'danger');
      }
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
      // Remove from UI immediately
      const index = this.photos.findIndex(p => p.id === photo.id);
      if (index >= 0) {
        this.photos.splice(index, 1);
      }

      // Force UI update first
      this.changeDetectorRef.detectChanges();

      // WEBAPP MODE: Direct API delete
      if (environment.isWeb) {
        if (photo.id) {
          await this.dteData.deleteVisualPhoto(photo.id);
          console.log('[DteVisualDetail] WEBAPP: Deleted photo from server:', photo.id);
        }
        console.log('[DteVisualDetail] Photo removed successfully');
        return;
      }

      // MOBILE MODE: Delete from Dexie and queue server deletion
      const localImage = await db.localImages.get(photo.id);

      if (localImage) {
        if (localImage.localBlobId) {
          await db.localBlobs.delete(localImage.localBlobId);
        }
        await db.localImages.delete(photo.id);
      }

      if (localImage?.attachId) {
        await this.dteData.deleteVisualPhoto(localImage.attachId);
        console.log('[DteVisualDetail] MOBILE: Queued photo deletion to Caspio:', localImage.attachId);
      }

      console.log('[DteVisualDetail] Photo removed successfully');
    } catch (error) {
      console.error('[DteVisualDetail] Error deleting photo:', error);
    }
  }

  private isCaptionPopupOpen = false;

  async openCaptionPopup(photo: PhotoItem) {
    if (this.isCaptionPopupOpen) return;

    this.isCaptionPopupOpen = true;

    try {
      const escapeHtml = (text: string) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      };

      const tempCaption = escapeHtml(photo.caption || '');

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
        message: ' ',
        buttons: [
          {
            text: 'Save',
            handler: () => {
              const input = document.getElementById('captionInput') as HTMLInputElement;
              const newCaption = input?.value || '';
              photo.caption = newCaption;
              this.changeDetectorRef.detectChanges();
              this.isCaptionPopupOpen = false;
              this.saveCaption(photo, newCaption);
              return true;
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

      setTimeout(() => {
        try {
          const alertElement = document.querySelector('.caption-popup-alert .alert-message');
          if (!alertElement) {
            this.isCaptionPopupOpen = false;
            return;
          }

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

          const container = document.querySelector('.caption-popup-alert .preset-buttons-container');
          if (container && captionInput) {
            container.addEventListener('click', (e) => {
              const target = e.target as HTMLElement;
              const btn = target.closest('.preset-btn') as HTMLElement;
              if (btn) {
                e.preventDefault();
                e.stopPropagation();
                const text = btn.getAttribute('data-text');
                if (text && captionInput) {
                  captionInput.value = (captionInput.value || '') + text + ' ';
                  (btn as HTMLButtonElement).blur();
                }
              }
            }, { passive: false });
          }

          if (undoBtn && captionInput) {
            undoBtn.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              const currentValue = captionInput.value || '';
              if (currentValue.trim() === '') return;
              const words = currentValue.trim().split(' ');
              if (words.length > 0) words.pop();
              captionInput.value = words.join(' ');
              if (captionInput.value.length > 0) captionInput.value += ' ';
            });
          }

          if (captionInput) {
            captionInput.addEventListener('keydown', (e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                const saveBtn = document.querySelector('.caption-popup-alert button.alert-button:not([data-role="cancel"])') as HTMLButtonElement;
                if (saveBtn) saveBtn.click();
              }
            });
          }
        } catch (error) {
          console.error('Error injecting caption popup content:', error);
          this.isCaptionPopupOpen = false;
        }
      }, 0);

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
          await firstValueFrom(this.caspioService.updateServicesDTEAttach(String(attachId), {
            Annotation: caption,
            Drawings: photo.drawings || ''
          }));
          console.log('[DteVisualDetail] WEBAPP: ✅ Updated caption via API (preserved drawings):', attachId);
        }
        this.changeDetectorRef.detectChanges();
        return;
      }

      // MOBILE MODE: Update in localImages (Dexie)
      await db.localImages.update(photo.id, { caption, updatedAt: Date.now() });

      const localImage = await db.localImages.get(photo.id);
      const attachId = localImage?.attachId || photo.id;

      // Queue caption update with drawings preserved
      await firstValueFrom(this.caspioService.updateServicesDTEAttach(String(attachId), {
        Annotation: caption,
        Drawings: localImage?.drawings || ''
      }));
      console.log('[DteVisualDetail] ✅ Queued caption update:', attachId);

      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('[DteVisualDetail] Error saving caption:', error);
      await this.showToast('Error saving caption', 'danger');
    }
  }

  async viewPhoto(photo: PhotoItem) {
    const originalPhotoIndex = this.photos.findIndex(p => p.id === photo.id);
    const editUrl = photo.originalUrl || photo.displayUrl;

    // WEBAPP FIX: Load existing annotations properly (matching category-detail pattern)
    // The annotator expects existingAnnotations, not existingDrawings
    let existingAnnotations: any = null;
    if (photo.drawings && photo.drawings.length > 10) {
      try {
        existingAnnotations = decompressAnnotationData(photo.drawings);
        console.log('[DteVisualDetail] Found existing annotations from drawings');
      } catch (e) {
        console.warn('[DteVisualDetail] Error loading annotations:', e);
      }
    }

    const existingCaption = photo.caption || '';

    const modal = await this.modalController.create({
      component: FabricPhotoAnnotatorComponent,
      componentProps: {
        imageUrl: editUrl,
        existingAnnotations: existingAnnotations,
        existingCaption: existingCaption,
        photoData: {
          ...photo,
          AttachID: photo.id,
          id: photo.id,
          caption: existingCaption
        },
        isReEdit: !!existingAnnotations
      },
      cssClass: 'fullscreen-modal'
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();

    const hasAnnotationData = data && (data.annotatedBlob || data.compressedAnnotationData || data.annotationsData);

    if (hasAnnotationData) {
      console.log('[DteVisualDetail] Annotation saved, processing...');

      const annotatedBlob = data.blob || data.annotatedBlob;
      const annotationsData = data.annotationData || data.annotationsData;
      const newCaption = data.caption !== undefined ? data.caption : photo.caption;

      let newUrl: string | null = null;
      if (annotatedBlob) {
        newUrl = URL.createObjectURL(annotatedBlob);
      }

      let photoIndex = this.photos.findIndex(p => p.id === photo.id);
      if (photoIndex === -1 && originalPhotoIndex !== -1 && originalPhotoIndex < this.photos.length) {
        photoIndex = originalPhotoIndex;
      }

      if (photoIndex !== -1) {
        try {
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
                console.log('[DteVisualDetail] WEBAPP: ✅ Cached annotated image for AttachID:', photo.id);
              } catch (cacheErr) {
                console.warn('[DteVisualDetail] WEBAPP: Failed to cache annotated image:', cacheErr);
              }
            }

            // Update annotation directly via Caspio API (photo.id IS the AttachID in webapp mode)
            await firstValueFrom(this.caspioService.updateServicesDTEAttach(String(photo.id), {
              Annotation: newCaption,
              Drawings: compressedDrawings
            }));
            console.log('[DteVisualDetail] WEBAPP: ✅ Updated annotation via API for AttachID:', photo.id);

            // Show appropriate toast based on whether we could export the image
            if (data.canvasTainted) {
              await this.showToast('Annotations saved (refresh to see updates)', 'success');
            }
          } else {
            // MOBILE MODE
            await db.localImages.update(photo.id, {
              drawings: compressedDrawings,
              caption: newCaption,
              updatedAt: Date.now()
            });

            if (annotatedBlob && annotatedBlob.size > 0) {
              try {
                await this.indexedDb.cacheAnnotatedImage(photo.id, annotatedBlob);
              } catch (cacheErr) {
                console.warn('[DteVisualDetail] Failed to cache annotated image:', cacheErr);
              }
            }

            const localImage = await db.localImages.get(photo.id);
            if (localImage?.attachId) {
              await this.dteData.updateVisualPhotoCaption(localImage.attachId, newCaption);
              console.log('[DteVisualDetail] Queued annotation update to Caspio:', localImage.attachId);
            }
          }

          this.photos[photoIndex] = {
            ...this.photos[photoIndex],
            displayUrl: newUrl || this.photos[photoIndex].displayUrl,
            originalUrl: this.photos[photoIndex].originalUrl || photo.originalUrl,
            caption: newCaption,
            hasAnnotations: !!annotationsData || !!compressedDrawings,
            drawings: compressedDrawings
          };

          this.changeDetectorRef.detectChanges();

        } catch (error) {
          console.error('[DteVisualDetail] Error saving annotations:', error);
          await this.showToast('Error saving annotations', 'danger');
        }
      }
    } else if (data?.saved) {
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

  trackByPhotoId(index: number, photo: PhotoItem): string {
    return photo.id || index.toString();
  }
}
