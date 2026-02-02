import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, AlertController, NavController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { CaspioService } from '../../../services/caspio.service';
import { IndexedDbService, ImageEntityType } from '../../../services/indexed-db.service';
import { PhotoHandlerService, PhotoCaptureConfig, StandardPhotoEntry, ViewPhotoConfig, ViewPhotoResult } from '../../../services/photo-handler.service';
import { ImageCompressionService } from '../../../services/image-compression.service';
import { db, VisualField } from '../../../services/caspio-db';
import { VisualFieldRepoService } from '../../../services/visual-field-repo.service';
import { LocalImageService } from '../../../services/local-image.service';
import { TemplateConfig, TemplateType } from '../../../services/template/template-config.interface';
import { TemplateConfigService } from '../../../services/template/template-config.service';
import { TemplateDataAdapter } from '../../../services/template/template-data-adapter.service';
import { decompressAnnotationData, renderAnnotationsOnPhoto } from '../../../utils/annotation-utils';
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
    // Works for BOTH webapp and mobile
    const queryParams = this.route.snapshot.queryParams;
    const visualIdParamName = this.getVisualIdParamName();

    if (queryParams[visualIdParamName]) {
      this.visualId = queryParams[visualIdParamName];
      console.log(`[GenericVisualDetail] ${visualIdParamName} from query params:`, this.visualId);
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
   * Load visual data in mobile mode (Dexie-first ONLY - no API calls)
   *
   * IMPORTANT: Mobile app uses strict Dexie-first approach.
   * All data comes from local Dexie storage, populated by background sync.
   * Page loads should NEVER call API directly.
   */
  private async loadVisualDataMobile() {
    if (!this.config) return;

    try {
      // Query visualFields by serviceId from Dexie
      const allFields = await db.visualFields
        .where('serviceId')
        .equals(this.serviceId)
        .toArray();

      const field = allFields.find(f => f.templateId === this.templateId);

      // Load templates from Dexie cache
      const cacheKey = this.config.templatesCacheKey as 'visual' | 'hud' | 'lbw' | 'dte' | 'efe';
      const cachedTemplates = await this.indexedDb.getCachedTemplates(cacheKey) || [];
      const template = cachedTemplates.find((t: any) =>
        Number(t.TemplateID || t.PK_ID) === this.templateId
      );

      console.log('[GenericVisualDetail] MOBILE: Field found:', !!field);
      console.log('[GenericVisualDetail] MOBILE: Template found:', !!template);
      console.log('[GenericVisualDetail] MOBILE: Cached templates count:', cachedTemplates.length);

      // Get visualId from field if available
      if (field) {
        this.visualId = String(field.tempVisualId || field.visualId || '');
      }

      if (field && field.templateName) {
        // Use Dexie field directly
        this.item = this.convertFieldToItem(field);
        this.editableTitle = this.item.name;
        this.editableText = this.item.text;
        this.categoryName = field.category || this.categoryName;
        console.log('[GenericVisualDetail] MOBILE: Loaded from Dexie field:', this.item.name);
      } else if (field && template) {
        // Merge field with template
        this.item = this.mergeFieldWithTemplate(field, template);
        this.editableTitle = this.item.name;
        this.editableText = this.item.text;
        this.categoryName = field.category || template.Category || this.categoryName;
        console.log('[GenericVisualDetail] MOBILE: Merged field+template');
      } else if (template) {
        // Use template only
        this.item = this.convertTemplateToItem(template);
        this.editableTitle = this.item.name;
        this.editableText = this.item.text;
        this.categoryName = template.Category || this.categoryName;
        console.log('[GenericVisualDetail] MOBILE: Loaded from template');
      } else if (field) {
        // Field exists but no template name - use field data
        this.item = this.convertFieldToItem(field);
        this.editableTitle = this.item.name || 'Visual ' + this.templateId;
        this.editableText = this.item.text || '';
        this.categoryName = field.category || this.categoryName;
        console.log('[GenericVisualDetail] MOBILE: Loaded from field (no template)');
      } else {
        // No data in Dexie - create minimal item
        // This can happen if sync hasn't completed yet
        console.warn('[GenericVisualDetail] MOBILE: No data in Dexie, creating minimal item');
        this.item = this.createMinimalItem();
        this.editableTitle = this.item.name;
        this.editableText = '';
      }

      // Set up Dexie subscription for real-time updates
      this.subscribeToVisualFieldChanges();

      await this.loadPhotos();
      this.loading = false;
      this.changeDetectorRef.detectChanges();

    } catch (error) {
      console.error('[GenericVisualDetail] MOBILE: Error loading from Dexie:', error);
      // Create minimal item so page doesn't show "not found"
      this.item = this.createMinimalItem();
      this.editableTitle = this.item.name;
      this.editableText = '';
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
   * Load photos in mobile mode (Dexie ONLY - no API calls)
   *
   * IMPORTANT: Mobile app uses strict Dexie-first approach.
   * Uses 4-tier fallback system matching EFE pattern:
   * - TIER 1: Query by visualId as entityId
   * - TIER 2: Query by alternate ID (tempVisualId or visualId)
   * - TIER 3: Query by mapped realId from tempIdMappings
   * - TIER 4: Reverse lookup via tempIdMappings
   */
  private async loadPhotosMobile() {
    if (!this.config) return;

    alert(`[DEBUG] loadPhotosMobile START\nserviceId: ${this.serviceId}\ntemplateId: ${this.templateId}`);

    // Re-query visualFields to get fresh data (EFE pattern)
    const allFields = await db.visualFields
      .where('serviceId')
      .equals(this.serviceId)
      .toArray();

    alert(`[DEBUG] Found ${allFields.length} visualFields for serviceId: ${this.serviceId}`);

    const field = allFields.find(f => f.templateId === this.templateId);

    alert(`[DEBUG] Field for templateId ${this.templateId}: ${field ? 'FOUND' : 'NOT FOUND'}\ntempVisualId: ${field?.tempVisualId || 'none'}\nvisualId: ${field?.visualId || 'none'}`);

    // CRITICAL: Use tempVisualId FIRST because localImages are stored with the original temp ID
    // After sync, visualId contains the real ID but photos still have entityId = tempVisualId
    this.visualId = field?.tempVisualId || field?.visualId || this.visualId || '';
    this.lastKnownVisualId = this.visualId;

    if (!this.visualId) {
      alert('[DEBUG] NO visualId - cannot load photos');
      console.log('[GenericVisualDetail] MOBILE: No visualId found, cannot load photos');
      this.photos = [];
      return;
    }

    alert(`[DEBUG] Using visualId: ${this.visualId}`);
    console.log('[GenericVisualDetail] MOBILE: Loading photos - visualId:', this.visualId,
      'tempVisualId:', field?.tempVisualId, 'field.visualId:', field?.visualId);

    // 4-TIER FALLBACK for photo lookup (matching EFE pattern)
    let localImages: any[] = [];
    let foundAtTier = 0;

    // TIER 1: Query by this.visualId as entityId
    localImages = await db.localImages.where('entityId').equals(this.visualId).toArray();
    if (localImages.length > 0) {
      foundAtTier = 1;
      alert(`[DEBUG] TIER 1 - Found ${localImages.length} photos with entityId: ${this.visualId}`);
      console.log('[GenericVisualDetail] MOBILE: TIER 1 - Found', localImages.length, 'photos');
    } else {
      alert(`[DEBUG] TIER 1 - No photos found with entityId: ${this.visualId}`);
    }

    // TIER 2: Try alternate ID (if field has both tempVisualId and visualId)
    if (localImages.length === 0 && field?.tempVisualId && field?.visualId) {
      const alternateId = (this.visualId === field.tempVisualId) ? field.visualId : field.tempVisualId;
      if (alternateId && alternateId !== this.visualId) {
        alert(`[DEBUG] TIER 2 - Trying alternate ID: ${alternateId}`);
        console.log('[GenericVisualDetail] MOBILE: TIER 2 - Trying alternate ID:', alternateId);
        localImages = await db.localImages.where('entityId').equals(String(alternateId)).toArray();
        if (localImages.length > 0) {
          foundAtTier = 2;
          alert(`[DEBUG] TIER 2 - Found ${localImages.length} photos`);
          console.log('[GenericVisualDetail] MOBILE: TIER 2 - Found', localImages.length, 'photos');
        }
      }
    }

    // TIER 3: Query by mapped realId from tempIdMappings
    if (localImages.length === 0 && field?.tempVisualId) {
      const mappedRealId = await this.indexedDb.getRealId(field.tempVisualId);
      alert(`[DEBUG] TIER 3 - mappedRealId for ${field.tempVisualId}: ${mappedRealId || 'none'}`);
      if (mappedRealId) {
        console.log('[GenericVisualDetail] MOBILE: TIER 3 - Trying mapped realId:', mappedRealId);
        localImages = await db.localImages.where('entityId').equals(mappedRealId).toArray();
        if (localImages.length > 0) {
          foundAtTier = 3;
          alert(`[DEBUG] TIER 3 - Found ${localImages.length} photos`);
          console.log('[GenericVisualDetail] MOBILE: TIER 3 - Found', localImages.length, 'photos');
        }
      }
    }

    // TIER 4: Reverse lookup - query tempIdMappings by realId to find tempId
    if (localImages.length === 0 && field?.visualId && !field?.tempVisualId) {
      const reverseLookupTempId = await this.indexedDb.getTempId(field.visualId);
      alert(`[DEBUG] TIER 4 - reverseLookupTempId for ${field.visualId}: ${reverseLookupTempId || 'none'}`);
      if (reverseLookupTempId) {
        console.log('[GenericVisualDetail] MOBILE: TIER 4 - Reverse lookup tempId:', reverseLookupTempId);
        localImages = await db.localImages.where('entityId').equals(reverseLookupTempId).toArray();
        if (localImages.length > 0) {
          foundAtTier = 4;
          alert(`[DEBUG] TIER 4 - Found ${localImages.length} photos`);
          console.log('[GenericVisualDetail] MOBILE: TIER 4 - Found', localImages.length, 'photos');
        }
      }
    }

    // Log final result
    if (foundAtTier > 0) {
      alert(`[DEBUG] FINAL: Photos found at TIER ${foundAtTier} - Total: ${localImages.length}`);
      console.log('[GenericVisualDetail] MOBILE: Photos found at TIER', foundAtTier, '- Total:', localImages.length);
    } else {
      alert(`[DEBUG] FINAL: No photos found after all 4 tiers`);
      console.log('[GenericVisualDetail] MOBILE: No photos found after all 4 tiers');
    }

    // Convert to PhotoItem format
    this.photos = [];
    const loadedPhotoIds = new Set<string>();

    for (const img of localImages) {
      // Skip duplicates
      if (loadedPhotoIds.has(img.imageId)) continue;
      if (img.attachId && loadedPhotoIds.has(img.attachId)) continue;

      alert(`[DEBUG] Processing image:\nimageId: ${img.imageId}\nlocalBlobId: ${img.localBlobId || 'none'}\nremoteUrl: ${img.remoteUrl || 'none'}\nremoteS3Key: ${img.remoteS3Key || 'none'}`);

      const hasAnnotations = !!(img.drawings && img.drawings.length > 10);
      let displayUrl = 'assets/img/photo-placeholder.svg';
      let originalUrl = displayUrl;

      // Check for cached annotated image (check multiple IDs)
      const possibleIds = [img.imageId, img.attachId].filter(id => id);
      for (const checkId of possibleIds) {
        if (hasAnnotations) {
          const cachedAnnotated = await this.indexedDb.getCachedAnnotatedImage(String(checkId));
          if (cachedAnnotated) {
            displayUrl = cachedAnnotated;
            console.log('[GenericVisualDetail] MOBILE: Using cached annotated image for:', checkId);
            break;
          }
        }
      }

      // Get blob URL from local storage (Dexie localBlobs table)
      if (img.localBlobId) {
        const blob = await db.localBlobs.get(img.localBlobId);
        if (blob) {
          alert(`[DEBUG] Found blob in localBlobs - size: ${blob.data?.byteLength || 0} bytes`);
          const blobObj = new Blob([blob.data], { type: blob.contentType });
          originalUrl = URL.createObjectURL(blobObj);
          if (displayUrl === 'assets/img/photo-placeholder.svg') {
            displayUrl = originalUrl;
          }
        } else {
          alert(`[DEBUG] localBlobId ${img.localBlobId} NOT FOUND in localBlobs table`);
        }
      }

      // If no local blob but has remote URL cached in Dexie
      if (originalUrl === 'assets/img/photo-placeholder.svg' && img.remoteUrl) {
        alert(`[DEBUG] Using remoteUrl: ${img.remoteUrl.substring(0, 50)}...`);
        originalUrl = img.remoteUrl;
        displayUrl = img.remoteUrl;
      }

      // If synced and has S3 key stored in Dexie
      if (originalUrl === 'assets/img/photo-placeholder.svg' && img.remoteS3Key) {
        alert(`[DEBUG] Using remoteS3Key: ${img.remoteS3Key}`);
        originalUrl = img.remoteS3Key;
        displayUrl = img.remoteS3Key;
      }

      alert(`[DEBUG] Final URLs:\ndisplayUrl: ${displayUrl.substring(0, 50)}...\noriginalUrl: ${originalUrl.substring(0, 50)}...`);

      loadedPhotoIds.add(img.imageId);
      if (img.attachId) loadedPhotoIds.add(img.attachId);

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

    alert(`[DEBUG] COMPLETE: Loaded ${this.photos.length} photos from Dexie`);
    console.log('[GenericVisualDetail] MOBILE: Loaded', this.photos.length, 'photos from Dexie');
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
        // WEBAPP: Update via API
        if (this.isValidVisualId(this.visualId)) {
          await this.dataAdapter.updateVisual(this.visualId, { Name: this.editableTitle }, this.actualServiceId || this.serviceId);
          console.log('[GenericVisualDetail] WEBAPP: Updated title via API');
        }
      } else {
        // MOBILE: Dexie ONLY - no API calls
        // Background sync will push changes to server
        const dexieUpdate: any = {
          templateName: this.editableTitle,
          isSelected: true,
          category: actualCategory
        };
        if (this.visualId) dexieUpdate.visualId = this.visualId;

        await this.visualFieldRepo.setField(this.serviceId, actualCategory, this.templateId, dexieUpdate);
        console.log('[GenericVisualDetail] MOBILE: Updated title in Dexie');
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
        // WEBAPP: Update via API
        if (this.isValidVisualId(this.visualId)) {
          await this.dataAdapter.updateVisual(this.visualId, { Text: this.editableText }, this.actualServiceId || this.serviceId);
          console.log('[GenericVisualDetail] WEBAPP: Updated text via API');
        }
      } else {
        // MOBILE: Dexie ONLY - no API calls
        // Background sync will push changes to server
        const dexieUpdate: any = {
          templateText: this.editableText,
          isSelected: true,
          category: actualCategory
        };
        if (this.visualId) dexieUpdate.visualId = this.visualId;

        await this.visualFieldRepo.setField(this.serviceId, actualCategory, this.templateId, dexieUpdate);
        console.log('[GenericVisualDetail] MOBILE: Updated text in Dexie');
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

    // Store original index for reliable lookup after result
    const originalPhotoIndex = this.photos.findIndex(p => p.id === photo.id);

    // Use the STANDARDIZED viewExistingPhoto method from PhotoHandlerService
    const viewConfig: ViewPhotoConfig = {
      photo: {
        id: photo.id,
        AttachID: photo.id,
        displayUrl: photo.displayUrl,
        originalUrl: photo.originalUrl,
        drawings: photo.drawings,
        Drawings: photo.drawings,
        caption: photo.caption,
        Annotation: photo.caption,
        hasAnnotations: photo.hasAnnotations
      },
      entityType: this.config.entityType,
      onSaveAnnotation: async (photoId: string, compressedDrawings: string, caption: string) => {
        // Save annotation via the data adapter
        await this.dataAdapter.updateAttachment(photoId, {
          Annotation: caption,
          Drawings: compressedDrawings
        });
        console.log('[GenericVisualDetail] WEBAPP: Updated annotation via API for:', photoId);
      },
      onUpdatePhoto: (result: ViewPhotoResult) => {
        // Find photo in array
        let photoIndex = this.photos.findIndex(p => p.id === result.photoId);
        if (photoIndex === -1 && originalPhotoIndex !== -1 && originalPhotoIndex < this.photos.length) {
          photoIndex = originalPhotoIndex;
        }

        if (photoIndex !== -1) {
          // Update local photo state
          this.photos[photoIndex].drawings = result.compressedDrawings;
          this.photos[photoIndex].hasAnnotations = result.hasAnnotations;
          this.photos[photoIndex].caption = result.caption;
          if (result.annotatedUrl) {
            this.photos[photoIndex].displayUrl = result.annotatedUrl;
          }
          this.changeDetectorRef.detectChanges();
        }
      }
    };

    await this.photoHandler.viewExistingPhoto(viewConfig);
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
