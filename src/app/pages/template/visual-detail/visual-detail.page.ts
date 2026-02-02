import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, AlertController, ModalController, NavController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { CaspioService } from '../../../services/caspio.service';
import { FabricPhotoAnnotatorComponent } from '../../../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { IndexedDbService, ImageEntityType } from '../../../services/indexed-db.service';
import { PhotoHandlerService, PhotoCaptureConfig, StandardPhotoEntry } from '../../../services/photo-handler.service';
import { ImageCompressionService } from '../../../services/image-compression.service';
import { db, VisualField } from '../../../services/caspio-db';
import { VisualFieldRepoService } from '../../../services/visual-field-repo.service';
import { LocalImageService } from '../../../services/local-image.service';
import { TemplateConfig, TemplateType } from '../../../services/template/template-config.interface';
import { TemplateConfigService } from '../../../services/template/template-config.service';
import { TemplateDataAdapter } from '../../../services/template/template-data-adapter.service';
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

/**
 * GenericVisualDetailPage - Config-driven visual detail page for all templates
 *
 * This page handles visual detail display and editing for HUD, EFE, LBW, and DTE templates.
 * Instead of duplicating code across 4 template-specific pages, this page uses TemplateConfig
 * to adapt its behavior based on the current template context.
 *
 * Usage:
 * 1. The page reads the template type from the route (resolved by TemplateConfigService)
 * 2. It uses TemplateConfig for table names, field names, and feature flags
 * 3. It uses TemplateDataAdapter for unified CRUD operations
 *
 * This consolidates:
 * - hud-visual-detail.page.ts (~1,672 lines)
 * - visual-detail.page.ts (EFE, ~1,979 lines)
 * - lbw-visual-detail.page.ts (~1,840 lines)
 * - dte-visual-detail.page.ts (~1,378 lines)
 */
@Component({
  selector: 'app-template-visual-detail',
  templateUrl: './visual-detail.page.html',
  styleUrls: ['./visual-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, LazyImageDirective]
})
export class GenericVisualDetailPage implements OnInit, OnDestroy, HasUnsavedChanges {
  // WEBAPP: Expose isWeb for template to hide camera button
  isWeb = environment.isWeb;

  // Template config (resolved at runtime)
  config: TemplateConfig | null = null;

  // Route params
  categoryName: string = '';
  routeCategory: string = '';
  templateId: number = 0;
  projectId: string = '';
  serviceId: string = '';
  actualServiceId: string = '';
  visualId: string = '';  // Generic ID (HUDID, VisualID, LBWID, or DTEID)

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
  private visualFieldsSubscription?: { unsubscribe: () => void };
  private configSubscription?: Subscription;

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
    private templateConfigService: TemplateConfigService,
    private dataAdapter: TemplateDataAdapter,
    private photoHandler: PhotoHandlerService
  ) {}

  ngOnInit() {
    // Subscribe to config changes
    this.configSubscription = this.templateConfigService.config$.subscribe(config => {
      if (config) {
        this.config = config;
        console.log(`[GenericVisualDetail] Config loaded for template: ${config.id}`);
      }
    });

    this.loadRouteParams();
  }

  ionViewWillEnter() {
    if (environment.isWeb) {
      this.loading = false;
      this.saving = false;
      this.changeDetectorRef.detectChanges();
    } else {
      if (this.serviceId && this.templateId) {
        console.log('[GenericVisualDetail] ionViewWillEnter MOBILE: Reloading data');
        this.loadVisualData();
      }
    }
  }

  ngOnDestroy() {
    this.routeSubscription?.unsubscribe();
    this.localImagesSubscription?.unsubscribe();
    this.visualFieldsSubscription?.unsubscribe();
    this.configSubscription?.unsubscribe();
  }

  hasUnsavedChanges(): boolean {
    if (!environment.isWeb) return false;
    const titleChanged = this.editableTitle !== (this.item?.name || '');
    const textChanged = this.editableText !== (this.item?.text || '');
    return titleChanged || textChanged;
  }

  /**
   * Get the visual ID query param name based on template type
   */
  private getVisualIdParamName(): string {
    if (!this.config) return 'visualId';
    switch (this.config.id) {
      case 'hud': return 'hudId';
      case 'efe': return 'visualId';
      case 'lbw': return 'lbwId';
      case 'dte': return 'dteId';
      default: return 'visualId';
    }
  }

  private loadRouteParams() {
    // Get category from parent route
    const categoryParams = this.route.parent?.snapshot.params;
    const rawCategory = categoryParams?.['category'] || '';
    this.categoryName = rawCategory ? decodeURIComponent(rawCategory) : '';
    this.routeCategory = this.categoryName;
    console.log('[GenericVisualDetail] Category from route:', rawCategory, '-> decoded:', this.categoryName);

    // Get project/service IDs from container
    let containerParams = this.route.parent?.parent?.snapshot?.params;
    console.log('[GenericVisualDetail] Container params (p.p):', containerParams);

    if (containerParams) {
      this.projectId = containerParams['projectId'] || '';
      this.serviceId = containerParams['serviceId'] || '';
    }

    // Fallback: Try one more level up
    if (!this.projectId || !this.serviceId) {
      containerParams = this.route.parent?.parent?.parent?.snapshot?.params;
      console.log('[GenericVisualDetail] Container params (p.p.p):', containerParams);
      if (containerParams) {
        this.projectId = this.projectId || containerParams['projectId'] || '';
        this.serviceId = this.serviceId || containerParams['serviceId'] || '';
      }
    }

    // Get visual ID from query params (template-specific param name)
    const queryParams = this.route.snapshot.queryParams;
    const visualIdParamName = this.getVisualIdParamName();

    if (environment.isWeb && queryParams[visualIdParamName]) {
      this.visualId = queryParams[visualIdParamName];
      console.log(`[GenericVisualDetail] WEBAPP: ${visualIdParamName} from query params:`, this.visualId);
    }

    // Get actualServiceId from query params
    if (queryParams['actualServiceId']) {
      this.actualServiceId = queryParams['actualServiceId'];
      console.log('[GenericVisualDetail] actualServiceId from query params:', this.actualServiceId);
    }

    console.log('[GenericVisualDetail] Final values - Template:', this.config?.id, 'Category:', this.categoryName,
      'ProjectId:', this.projectId, 'ServiceId:', this.serviceId, 'VisualId:', this.visualId);

    // Subscribe to templateId changes
    this.routeSubscription = this.route.params.subscribe(params => {
      this.templateId = parseInt(params['templateId'], 10);
      console.log('[GenericVisualDetail] TemplateId from route:', this.templateId);
      this.loadVisualData();
    });
  }

  private async loadVisualData() {
    if (!this.config) {
      console.error('[GenericVisualDetail] No config loaded - cannot load data');
      this.loading = false;
      return;
    }

    if (environment.isWeb) {
      this.loading = true;
    } else {
      this.loading = false;
    }

    console.log('[GenericVisualDetail] ========== loadVisualData START ==========');
    console.log('[GenericVisualDetail] Template:', this.config.id);
    console.log('[GenericVisualDetail] serviceId:', this.serviceId);
    console.log('[GenericVisualDetail] templateId:', this.templateId);
    console.log('[GenericVisualDetail] visualId:', this.visualId || '(none)');

    // WEBAPP: Load via API
    if (environment.isWeb) {
      await this.loadVisualDataWebapp();
      return;
    }

    // MOBILE: Load from Dexie
    await this.loadVisualDataMobile();
  }

  /**
   * Load visual data in webapp mode (direct API)
   */
  private async loadVisualDataWebapp() {
    if (!this.config) return;

    try {
      const queryServiceId = this.actualServiceId || this.serviceId;

      // If we have a visual ID from query params, use it directly
      if (this.visualId) {
        console.log('[GenericVisualDetail] WEBAPP DIRECT: Using visualId from query params:', this.visualId);

        // Load visual by ID
        const visual = await this.dataAdapter.getVisualByIdWithConfig(this.config, this.visualId);

        if (visual) {
          console.log('[GenericVisualDetail] WEBAPP: Found visual:', visual.Name);
          this.item = this.convertRecordToItem(visual);
          this.categoryName = visual.Category || this.categoryName;
          this.editableTitle = this.item.name;
          this.editableText = this.item.text;
        } else {
          // Create minimal item for display
          console.warn('[GenericVisualDetail] WEBAPP: Visual not found, creating minimal item');
          this.item = this.createMinimalItem();
          this.editableTitle = this.item.name;
          this.editableText = '';
        }
      } else {
        // No visual ID - try to match by templateId
        console.log('[GenericVisualDetail] WEBAPP: No visualId, using priority-based matching');

        const visuals = await this.dataAdapter.getVisualsWithConfig(this.config, queryServiceId);
        console.log('[GenericVisualDetail] WEBAPP: Loaded', visuals.length, 'records');

        // Try to find matching visual
        let visual = this.findMatchingVisual(visuals);

        if (visual) {
          this.visualId = String(visual[this.config.idFieldName] || visual.PK_ID);
          this.item = this.convertRecordToItem(visual);
          this.categoryName = visual.Category || this.categoryName;
          this.editableTitle = this.item.name;
          this.editableText = this.item.text;
          console.log('[GenericVisualDetail] WEBAPP: Matched visual:', this.item.name);
        } else {
          // Load from templates
          await this.loadFromTemplates();
        }
      }

      await this.loadPhotos();
      this.loading = false;
      this.changeDetectorRef.detectChanges();

    } catch (error) {
      console.error('[GenericVisualDetail] WEBAPP: Error loading visual:', error);
      this.loading = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * Load visual data in mobile mode (Dexie-first)
   */
  private async loadVisualDataMobile() {
    if (!this.config) return;

    try {
      // Query visualFields by serviceId
      const allFields = await db.visualFields
        .where('serviceId')
        .equals(this.serviceId)
        .toArray();

      const field = allFields.find(f => f.templateId === this.templateId);

      // Load templates for fallback
      // Cast to expected type - templatesCacheKey is configured to match these values
      const cacheKey = this.config.templatesCacheKey as 'visual' | 'hud' | 'lbw' | 'dte' | 'efe';
      const cachedTemplates = await this.indexedDb.getCachedTemplates(cacheKey) || [];
      const template = cachedTemplates.find((t: any) =>
        Number(t.TemplateID || t.PK_ID) === this.templateId
      );

      console.log('[GenericVisualDetail] MOBILE: Field found:', !!field);
      console.log('[GenericVisualDetail] MOBILE: Template found:', !!template);

      if (field && field.templateName) {
        // Use Dexie field directly
        this.item = this.convertFieldToItem(field);
        this.editableTitle = this.item.name;
        this.editableText = this.item.text;
        this.categoryName = field.category || this.categoryName;
        this.visualId = String(field.tempVisualId || field.visualId || '');
        console.log('[GenericVisualDetail] MOBILE: Loaded from Dexie field:', this.item.name);
      } else if (field && template) {
        // Merge field with template
        this.item = this.mergeFieldWithTemplate(field, template);
        this.editableTitle = this.item.name;
        this.editableText = this.item.text;
        this.categoryName = field.category || template.Category || this.categoryName;
        this.visualId = String(field.tempVisualId || field.visualId || '');
        console.log('[GenericVisualDetail] MOBILE: Merged field+template');
      } else if (template) {
        // Use template only
        this.item = this.convertTemplateToItem(template);
        this.editableTitle = this.item.name;
        this.editableText = this.item.text;
        this.categoryName = template.Category || this.categoryName;
        console.log('[GenericVisualDetail] MOBILE: Loaded from template');
      } else {
        console.error('[GenericVisualDetail] MOBILE: Neither field nor template found');
        this.loading = false;
        this.changeDetectorRef.detectChanges();
        return;
      }

      // Set up Dexie subscription for real-time updates
      this.subscribeToVisualFieldChanges();

      await this.loadPhotos();
      this.loading = false;
      this.changeDetectorRef.detectChanges();

    } catch (error) {
      console.error('[GenericVisualDetail] MOBILE: Error loading visual:', error);
      this.loading = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * Load template data when no visual exists
   */
  private async loadFromTemplates() {
    if (!this.config) return;

    const templates = await this.dataAdapter.getTemplatesWithConfig(this.config);
    const template = templates.find((t: any) =>
      (t.TemplateID || t.PK_ID) == this.templateId
    );

    if (template) {
      this.item = this.convertTemplateToItem(template);
      this.categoryName = template.Category || this.categoryName;
      this.editableTitle = this.item.name;
      this.editableText = this.item.text;
      console.log('[GenericVisualDetail] Loaded from template:', this.item.name);
    } else {
      console.error('[GenericVisualDetail] Template not found for templateId:', this.templateId);
    }
  }

  /**
   * Find matching visual record by templateId
   */
  private findMatchingVisual(visuals: any[]): any | null {
    if (!this.config) return null;

    // Priority 1: Match by templateId as visualId (custom visuals)
    let visual = visuals.find((v: any) =>
      String(v[this.config!.idFieldName] || v.PK_ID) === String(this.templateId)
    );
    if (visual) {
      console.log('[GenericVisualDetail] PRIORITY 1: Found by ID as templateId');
      return visual;
    }

    // Priority 2: Match by template ID fields
    const templateIdField = this.config.templateIdFieldName;
    visual = visuals.find((v: any) =>
      String(v[templateIdField]) === String(this.templateId) ||
      String(v.TemplateID) === String(this.templateId)
    );
    if (visual) {
      console.log('[GenericVisualDetail] PRIORITY 2: Found by TemplateID field');
      return visual;
    }

    return null;
  }

  /**
   * Convert API record to VisualItem
   */
  private convertRecordToItem(record: any): VisualItem {
    return {
      id: record[this.config!.idFieldName] || record.PK_ID,
      templateId: this.templateId,
      name: record.Name || '',
      text: record.Text || '',
      originalText: record.Text || '',
      type: record.Kind || 'Comment',
      category: record.Category || this.categoryName,
      answerType: record.AnswerType || 0,
      required: false,
      answer: record.Answers || '',
      isSelected: true
    };
  }

  /**
   * Convert Dexie VisualField to VisualItem
   */
  private convertFieldToItem(field: VisualField): VisualItem {
    return {
      id: field.tempVisualId || field.visualId || field.templateId,
      templateId: field.templateId,
      name: field.templateName || '',
      text: field.templateText || '',
      originalText: field.templateText || '',
      type: field.kind || 'Comment',
      category: field.category || this.categoryName,
      answerType: field.answerType || 0,
      required: false,
      answer: field.answer,
      isSelected: field.isSelected,
      key: field.key
    };
  }

  /**
   * Merge Dexie field with template data
   */
  private mergeFieldWithTemplate(field: VisualField, template: any): VisualItem {
    return {
      id: field.tempVisualId || field.visualId || field.templateId,
      templateId: field.templateId,
      name: template.Name || '',
      text: field.templateText || template.Text || '',
      originalText: template.Text || '',
      type: field.kind || template.Kind || 'Comment',
      category: field.category || template.Category || this.categoryName,
      answerType: field.answerType || template.AnswerType || 0,
      required: false,
      answer: field.answer,
      isSelected: field.isSelected,
      key: field.key
    };
  }

  /**
   * Convert template to VisualItem
   */
  private convertTemplateToItem(template: any): VisualItem {
    return {
      id: template.TemplateID || template.PK_ID,
      templateId: template.TemplateID || template.PK_ID,
      name: template.Name || '',
      text: template.Text || '',
      originalText: template.Text || '',
      type: template.Kind || 'Comment',
      category: template.Category || this.categoryName,
      answerType: template.AnswerType || 0,
      required: false,
      isSelected: false
    };
  }

  /**
   * Create minimal item when visual not found
   */
  private createMinimalItem(): VisualItem {
    return {
      id: this.visualId || this.templateId,
      templateId: this.templateId || 0,
      name: 'Visual ' + (this.visualId || this.templateId),
      text: '',
      originalText: '',
      type: 'Comment',
      category: this.categoryName,
      answerType: 0,
      required: false,
      isSelected: true
    };
  }

  /**
   * Subscribe to Dexie visualField changes for real-time updates
   */
  private subscribeToVisualFieldChanges() {
    const observable = liveQuery(() =>
      db.visualFields
        .where(['serviceId', 'templateId'])
        .equals([this.serviceId, this.templateId])
        .first()
    );

    const subscription = observable.subscribe({
      next: async (field) => {
        if (!field) return;

        // Check if visualId changed (sync completed)
        const newVisualId = field.tempVisualId || field.visualId || '';
        if (newVisualId && newVisualId !== this.lastKnownVisualId) {
          this.lastKnownVisualId = String(newVisualId);
          this.visualId = String(newVisualId);
          console.log('[GenericVisualDetail] MOBILE: visualId updated to:', this.visualId);
          await this.loadPhotos();
          this.changeDetectorRef.detectChanges();
        }
      }
    });

    this.visualFieldsSubscription = subscription;
  }

  // ===== PHOTO LOADING =====

  private async loadPhotos() {
    if (!this.config) return;

    this.loadingPhotos = true;
    this.changeDetectorRef.detectChanges();

    try {
      if (environment.isWeb) {
        await this.loadPhotosWebapp();
      } else {
        await this.loadPhotosMobile();
      }
    } catch (error) {
      console.error('[GenericVisualDetail] Error loading photos:', error);
    } finally {
      this.loadingPhotos = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * Load photos in webapp mode (API)
   */
  private async loadPhotosWebapp() {
    if (!this.config || !this.visualId) {
      console.log('[GenericVisualDetail] WEBAPP: No visualId, skipping photo load');
      this.photos = [];
      return;
    }

    const attachments = await this.dataAdapter.getAttachmentsWithConfig(this.config, this.visualId);
    console.log('[GenericVisualDetail] WEBAPP: Loaded', attachments.length, 'attachments');

    this.photos = [];
    for (const att of attachments || []) {
      // Check Attachment first (S3 key), then Photo (legacy Caspio Files API)
      let displayUrl = att.Attachment || att.Photo || att.url || att.displayUrl || 'assets/img/photo-placeholder.svg';

      console.log('[GenericVisualDetail] WEBAPP: Processing attachment:', att.AttachID);

      // If it's an S3 key, get signed URL
      if (displayUrl && this.caspioService.isS3Key && this.caspioService.isS3Key(displayUrl)) {
        try {
          displayUrl = await this.caspioService.getS3FileUrl(displayUrl);
          console.log('[GenericVisualDetail] WEBAPP: Got S3 signed URL for:', att.AttachID);
        } catch (e) {
          console.warn('[GenericVisualDetail] WEBAPP: Could not get S3 URL:', e);
        }
      }

      const attachId = String(att.AttachID || att.attachId || att.PK_ID);
      const hasServerAnnotations = !!(att.Drawings && att.Drawings.length > 10);
      let thumbnailUrl = displayUrl;
      let hasAnnotations = hasServerAnnotations;

      // Check for cached annotated image
      try {
        const cachedAnnotated = await this.indexedDb.getCachedAnnotatedImage(attachId);
        if (cachedAnnotated && hasServerAnnotations) {
          thumbnailUrl = cachedAnnotated;
          hasAnnotations = true;
          console.log(`[GenericVisualDetail] WEBAPP: Using cached annotated image for ${attachId}`);
        } else if (cachedAnnotated && !hasServerAnnotations) {
          console.log(`[GenericVisualDetail] WEBAPP: Clearing stale cached annotated image for ${attachId}`);
          await this.indexedDb.deleteCachedAnnotatedImage(attachId);
        } else if (hasServerAnnotations && displayUrl && displayUrl !== 'assets/img/photo-placeholder.svg') {
          console.log(`[GenericVisualDetail] WEBAPP: Rendering annotations for ${attachId}...`);
          const renderedUrl = await renderAnnotationsOnPhoto(displayUrl, att.Drawings);
          if (renderedUrl && renderedUrl !== displayUrl) {
            thumbnailUrl = renderedUrl;
            try {
              const response = await fetch(renderedUrl);
              const blob = await response.blob();
              await this.indexedDb.cacheAnnotatedImage(attachId, blob);
            } catch (cacheErr) {
              console.warn('[GenericVisualDetail] WEBAPP: Failed to cache annotated image:', cacheErr);
            }
          }
        }
      } catch (annotErr) {
        console.warn(`[GenericVisualDetail] WEBAPP: Failed to process annotations for ${attachId}:`, annotErr);
      }

      this.photos.push({
        id: attachId,
        displayUrl: thumbnailUrl,
        originalUrl: displayUrl,
        caption: att.Caption || att.Annotation || '',
        uploading: false,
        isLocal: false,
        hasAnnotations,
        drawings: att.Drawings || ''
      });
    }
  }

  /**
   * Load photos in mobile mode (Dexie)
   */
  private async loadPhotosMobile() {
    if (!this.config) return;

    // Get visualId from Dexie field
    const field = await db.visualFields
      .where(['serviceId', 'templateId'])
      .equals([this.serviceId, this.templateId])
      .first();

    const effectiveVisualId = field?.tempVisualId || field?.visualId || this.visualId;
    if (effectiveVisualId) {
      this.visualId = String(effectiveVisualId);
    }

    if (!this.visualId) {
      console.log('[GenericVisualDetail] MOBILE: No visualId, skipping photo load');
      this.photos = [];
      return;
    }

    console.log('[GenericVisualDetail] MOBILE: Loading photos for visualId:', this.visualId);

    // Tiered lookup for photos
    let localImages: any[] = [];
    let foundAtTier = 0;

    // Tier 1: By visualId as entityId
    localImages = await db.localImages.where('entityId').equals(this.visualId).toArray();
    if (localImages.length > 0) {
      foundAtTier = 1;
      console.log('[GenericVisualDetail] MOBILE: TIER 1 - Found', localImages.length, 'photos');
    }

    // Tier 2: By tempVisualId
    if (localImages.length === 0 && field?.tempVisualId) {
      localImages = await db.localImages.where('entityId').equals(field.tempVisualId).toArray();
      if (localImages.length > 0) {
        foundAtTier = 2;
        console.log('[GenericVisualDetail] MOBILE: TIER 2 (tempVisualId) - Found', localImages.length, 'photos');
      }
    }

    // Tier 3: By visualId (if different from tempVisualId)
    if (localImages.length === 0 && field?.visualId && field.visualId !== field?.tempVisualId) {
      localImages = await db.localImages.where('entityId').equals(String(field.visualId)).toArray();
      if (localImages.length > 0) {
        foundAtTier = 3;
        console.log('[GenericVisualDetail] MOBILE: TIER 3 (realId) - Found', localImages.length, 'photos');
      }
    }

    if (foundAtTier > 0) {
      console.log('[GenericVisualDetail] MOBILE: Photos found at TIER', foundAtTier);
    } else {
      console.log('[GenericVisualDetail] MOBILE: No photos found for visualId:', this.visualId);
    }

    // Convert to PhotoItem format
    this.photos = [];

    for (const img of localImages) {
      const hasAnnotations = !!(img.drawings && img.drawings.length > 10);

      let displayUrl = 'assets/img/photo-placeholder.svg';
      let originalUrl = displayUrl;

      // Check for cached annotated image
      if (hasAnnotations) {
        const cachedAnnotated = await this.indexedDb.getCachedAnnotatedImage(img.imageId);
        if (cachedAnnotated) {
          displayUrl = cachedAnnotated;
        }
      }

      // Get blob URL
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
  }

  // ===== SAVE METHODS =====

  private isValidVisualId(id: string): boolean {
    if (!id) return false;
    if (id.startsWith('temp_')) return true;
    const numId = Number(id);
    return !isNaN(numId) && numId > 0;
  }

  async saveAll() {
    const titleChanged = this.editableTitle !== (this.item?.name || '');
    const textChanged = this.editableText !== (this.item?.text || '');

    if (!titleChanged && !textChanged) {
      this.goBack();
      return;
    }

    this.saving = true;
    try {
      const caspioUpdate: any = {};
      if (titleChanged) caspioUpdate.Name = this.editableTitle;
      if (textChanged) caspioUpdate.Text = this.editableText;

      const actualCategory = this.item?.category || this.categoryName;

      if (environment.isWeb) {
        if (this.isValidVisualId(this.visualId)) {
          await this.dataAdapter.updateVisual(this.visualId, caspioUpdate, this.actualServiceId || this.serviceId);
          console.log('[GenericVisualDetail] WEBAPP: Updated via API:', this.visualId);
        }
      } else {
        // MOBILE: Dexie-first
        const dexieUpdate: any = {};
        if (titleChanged) dexieUpdate.templateName = this.editableTitle;
        if (textChanged) dexieUpdate.templateText = this.editableText;

        await this.visualFieldRepo.setField(this.serviceId, actualCategory, this.templateId, dexieUpdate);
        console.log('[GenericVisualDetail] MOBILE: Updated Dexie:', dexieUpdate);

        if (this.isValidVisualId(this.visualId)) {
          await this.dataAdapter.updateVisual(this.visualId, caspioUpdate, this.actualServiceId || this.serviceId);
        }
      }

      if (this.item) {
        if (titleChanged) this.item.name = this.editableTitle;
        if (textChanged) this.item.text = this.editableText;
      }
      this.changeDetectorRef.detectChanges();

    } catch (error) {
      console.error('[GenericVisualDetail] Error saving:', error);
      await this.showToast('Error saving changes', 'danger');
    } finally {
      this.saving = false;
    }

    this.goBack();
  }

  async saveTitle() {
    if (this.editableTitle === (this.item?.name || '')) return;

    this.saving = true;
    try {
      const actualCategory = this.item?.category || this.categoryName;

      if (environment.isWeb) {
        if (this.isValidVisualId(this.visualId)) {
          await this.dataAdapter.updateVisual(this.visualId, { Name: this.editableTitle }, this.actualServiceId || this.serviceId);
          console.log('[GenericVisualDetail] WEBAPP: Updated title via API');
        }
      } else {
        const dexieUpdate: any = {
          templateName: this.editableTitle,
          isSelected: true,
          category: actualCategory
        };
        if (this.visualId) dexieUpdate.visualId = this.visualId;

        await this.visualFieldRepo.setField(this.serviceId, actualCategory, this.templateId, dexieUpdate);
        console.log('[GenericVisualDetail] MOBILE: Updated title in Dexie');

        if (this.isValidVisualId(this.visualId)) {
          await this.dataAdapter.updateVisual(this.visualId, { Name: this.editableTitle }, this.actualServiceId || this.serviceId);
        }
      }

      if (this.item) this.item.name = this.editableTitle;
    } catch (error) {
      console.error('[GenericVisualDetail] Error saving title:', error);
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

      if (environment.isWeb) {
        if (this.isValidVisualId(this.visualId)) {
          await this.dataAdapter.updateVisual(this.visualId, { Text: this.editableText }, this.actualServiceId || this.serviceId);
          console.log('[GenericVisualDetail] WEBAPP: Updated text via API');
        }
      } else {
        const dexieUpdate: any = {
          templateText: this.editableText,
          isSelected: true,
          category: actualCategory
        };
        if (this.visualId) dexieUpdate.visualId = this.visualId;

        await this.visualFieldRepo.setField(this.serviceId, actualCategory, this.templateId, dexieUpdate);
        console.log('[GenericVisualDetail] MOBILE: Updated text in Dexie');

        if (this.isValidVisualId(this.visualId)) {
          await this.dataAdapter.updateVisual(this.visualId, { Text: this.editableText }, this.actualServiceId || this.serviceId);
        }
      }

      if (this.item) this.item.text = this.editableText;
    } catch (error) {
      console.error('[GenericVisualDetail] Error saving text:', error);
      await this.showToast('Error saving description', 'danger');
    } finally {
      this.saving = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  // ===== PHOTO METHODS =====

  async addPhotoFromCamera() {
    if (!this.config) return;

    if (!this.visualId) {
      console.error('[GenericVisualDetail] Cannot capture photo - no visualId');
      await this.showToast('Error: Visual not found', 'danger');
      return;
    }

    try {
      const config: PhotoCaptureConfig = {
        entityType: this.config.entityType,
        entityId: this.visualId,
        serviceId: this.serviceId,
        category: this.categoryName,
        itemId: this.templateId,
        onTempPhotoAdded: (photo: StandardPhotoEntry) => {
          this.photos.unshift(this.convertStandardPhotoToPhotoItem(photo));
          this.changeDetectorRef.detectChanges();
        },
        onUploadComplete: (photo: StandardPhotoEntry, tempId: string) => {
          this.updatePhotoInList(photo, tempId);
          this.changeDetectorRef.detectChanges();
        },
        onUploadFailed: (tempId: string, error: any) => {
          this.removePhotoFromList(tempId);
          this.changeDetectorRef.detectChanges();
        }
      };

      await this.photoHandler.captureFromCamera(config);
    } catch (error: any) {
      const errorMessage = typeof error === 'string' ? error : error?.message || '';
      if (!errorMessage.includes('cancel') && !errorMessage.includes('Cancel') && !errorMessage.includes('User')) {
        console.error('[GenericVisualDetail] Camera error:', error);
        await this.showToast('Error taking photo', 'danger');
      }
    }
  }

  async addPhotoFromGallery() {
    if (!this.config) return;

    if (!this.visualId) {
      console.error('[GenericVisualDetail] Cannot select photo - no visualId');
      await this.showToast('Error: Visual not found', 'danger');
      return;
    }

    try {
      const config: PhotoCaptureConfig = {
        entityType: this.config.entityType,
        entityId: this.visualId,
        serviceId: this.serviceId,
        category: this.categoryName,
        itemId: this.templateId,
        skipAnnotator: true,
        onTempPhotoAdded: (photo: StandardPhotoEntry) => {
          this.photos.unshift(this.convertStandardPhotoToPhotoItem(photo, true));
          this.changeDetectorRef.detectChanges();
        },
        onUploadComplete: (photo: StandardPhotoEntry, tempId: string) => {
          this.updatePhotoInList(photo, tempId);
          this.changeDetectorRef.detectChanges();
        },
        onUploadFailed: (tempId: string, error: any) => {
          const index = this.photos.findIndex(p => p.id === tempId);
          if (index >= 0) {
            this.photos[index].uploading = false;
          }
          this.changeDetectorRef.detectChanges();
        }
      };

      await this.photoHandler.captureFromGallery(config);
    } catch (error: any) {
      const errorMessage = typeof error === 'string' ? error : error?.message || '';
      if (!errorMessage.includes('cancel') && !errorMessage.includes('Cancel') && !errorMessage.includes('User')) {
        console.error('[GenericVisualDetail] Gallery error:', error);
        await this.showToast('Error selecting photo', 'danger');
      }
    }
  }

  private convertStandardPhotoToPhotoItem(photo: StandardPhotoEntry, isUploading: boolean = false): PhotoItem {
    return {
      id: photo.imageId,
      displayUrl: photo.displayUrl,
      originalUrl: photo.originalUrl,
      caption: photo.caption || '',
      uploading: isUploading || photo.uploading || photo.isSkeleton || false,
      isLocal: photo.isLocal,
      hasAnnotations: photo.hasAnnotations,
      drawings: photo.Drawings || ''
    };
  }

  private updatePhotoInList(photo: StandardPhotoEntry, tempId: string) {
    const index = this.photos.findIndex(p => p.id === tempId);
    if (index >= 0) {
      this.photos[index] = this.convertStandardPhotoToPhotoItem(photo);
      this.photos[index].uploading = false;
    }
  }

  private removePhotoFromList(photoId: string) {
    const index = this.photos.findIndex(p => p.id === photoId);
    if (index >= 0) {
      this.photos.splice(index, 1);
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
      this.removePhotoFromList(photo.id);
      this.changeDetectorRef.detectChanges();

      if (environment.isWeb) {
        await this.dataAdapter.deleteAttachment(photo.id);
        console.log('[GenericVisualDetail] WEBAPP: Deleted attachment:', photo.id);
      } else {
        // Mobile: Delete from IndexedDB
        await this.indexedDb.deleteLocalImage(photo.id);
        console.log('[GenericVisualDetail] MOBILE: Deleted from IndexedDB:', photo.id);
      }

      await this.showToast('Photo deleted', 'success');
    } catch (error) {
      console.error('[GenericVisualDetail] Error deleting photo:', error);
      await this.loadPhotos();
      await this.showToast('Error deleting photo', 'danger');
    }
  }

  async viewPhoto(photo: PhotoItem) {
    if (!this.config) return;

    // Store original index for reliable lookup after modal closes
    const originalPhotoIndex = this.photos.findIndex(p => p.id === photo.id);

    // Use ORIGINAL URL for editing (without annotations baked in)
    const editUrl = photo.originalUrl || photo.displayUrl;

    // Decompress existing annotations for the editor
    let existingAnnotations: any = null;
    if (photo.drawings && photo.drawings.length > 10) {
      try {
        existingAnnotations = decompressAnnotationData(photo.drawings);
        console.log('[GenericVisualDetail] Found existing annotations from drawings');
      } catch (e) {
        console.warn('[GenericVisualDetail] Error loading annotations:', e);
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

    // Check if we have annotation data to save
    const hasAnnotationData = data && (data.annotatedBlob || data.compressedAnnotationData || data.annotationsData);

    if (hasAnnotationData) {
      console.log('[GenericVisualDetail] Annotation saved, processing...');

      const annotatedBlob = data.blob || data.annotatedBlob;
      const annotationsData = data.annotationData || data.annotationsData;
      const newCaption = data.caption !== undefined ? data.caption : photo.caption;

      // Create blob URL for immediate display
      let newUrl: string | null = null;
      if (annotatedBlob) {
        newUrl = URL.createObjectURL(annotatedBlob);
      }

      // Find photo in array
      let photoIndex = this.photos.findIndex(p => p.id === photo.id);
      if (photoIndex === -1 && originalPhotoIndex !== -1 && originalPhotoIndex < this.photos.length) {
        photoIndex = originalPhotoIndex;
      }

      if (photoIndex !== -1) {
        try {
          // Compress annotation data for storage
          let compressedDrawings = data.compressedAnnotationData || '';
          if (!compressedDrawings && annotationsData) {
            if (typeof annotationsData === 'object') {
              compressedDrawings = compressAnnotationData(JSON.stringify(annotationsData));
            } else if (typeof annotationsData === 'string') {
              compressedDrawings = compressAnnotationData(annotationsData);
            }
          }

          // Cache annotated image for thumbnail display
          if (annotatedBlob && annotatedBlob.size > 0) {
            try {
              await this.indexedDb.cacheAnnotatedImage(photo.id, annotatedBlob);
              console.log('[GenericVisualDetail] WEBAPP: Cached annotated image for:', photo.id);
            } catch (cacheErr) {
              console.warn('[GenericVisualDetail] WEBAPP: Failed to cache annotated image:', cacheErr);
            }
          }

          // Update annotation via API
          await this.dataAdapter.updateAttachment(photo.id, {
            Annotation: newCaption,
            Drawings: compressedDrawings
          });
          console.log('[GenericVisualDetail] WEBAPP: Updated annotation via API for:', photo.id);

          // Update local photo state
          this.photos[photoIndex].drawings = compressedDrawings;
          this.photos[photoIndex].hasAnnotations = compressedDrawings.length > 10;
          this.photos[photoIndex].caption = newCaption;
          if (newUrl) {
            this.photos[photoIndex].displayUrl = newUrl;
          }

          await this.showToast('Annotation saved', 'success');
        } catch (saveErr) {
          console.error('[GenericVisualDetail] Error saving annotation:', saveErr);
          await this.showToast('Error saving annotation', 'danger');
        }
      }

      this.changeDetectorRef.detectChanges();
    }
  }

  async openCaptionPopup(photo: PhotoItem) {
    const alert = await this.alertController.create({
      header: 'Photo Caption',
      inputs: [
        {
          name: 'caption',
          type: 'text',
          placeholder: 'Enter caption...',
          value: photo.caption || ''
        }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: async (data) => {
            if (data.caption !== photo.caption) {
              await this.saveCaption(photo, data.caption);
            }
          }
        }
      ]
    });
    await alert.present();
  }

  private async saveCaption(photo: PhotoItem, caption: string) {
    try {
      photo.caption = caption;

      if (environment.isWeb) {
        await this.dataAdapter.updateAttachment(photo.id, { Caption: caption });
        console.log('[GenericVisualDetail] WEBAPP: Updated caption via API');
      } else {
        await this.indexedDb.updateLocalImage(photo.id, { caption });
        console.log('[GenericVisualDetail] MOBILE: Updated caption in IndexedDB');
      }

      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('[GenericVisualDetail] Error saving caption:', error);
      await this.showToast('Error saving caption', 'danger');
    }
  }

  // ===== UTILITY METHODS =====

  trackByPhotoId(index: number, photo: PhotoItem): string {
    return photo.id;
  }

  onImageLoad(photo: PhotoItem) {
    photo.loading = false;
  }

  goBack() {
    this.location.back();
  }

  private async showToast(message: string, color: string = 'primary') {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }
}
