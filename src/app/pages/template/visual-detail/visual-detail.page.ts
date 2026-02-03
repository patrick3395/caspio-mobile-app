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
import { GenericFieldRepoService } from '../../../services/template/generic-field-repo.service';
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
  thumbnailUrl?: string;
  // Additional ID fields for annotation cache lookup (matches EFE pattern)
  imageId?: string;
  attachId?: string;
  // Additional annotation fields (matches EFE pattern)
  annotations?: any;
  rawDrawingsString?: string;
  Drawings?: string;
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

  // ANNOTATION THUMBNAIL FIX: In-memory cache for annotated image URLs
  // This ensures thumbnails show annotations immediately after save (matches EFE pattern)
  bulkAnnotatedImagesMap: Map<string, string> = new Map();

  // Caption popup state
  private isCaptionPopupOpen = false;

  // Subscriptions
  private routeSubscription?: Subscription;
  private localImagesSubscription?: Subscription;
  private visualFieldsSubscription?: { unsubscribe: () => void };
  private configSubscription?: Subscription;

  private lastKnownVisualId: string = '';

  // Destruction guard for async safety
  private isDestroyed: boolean = false;

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
    private genericFieldRepo: GenericFieldRepoService,
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
    // Set destruction flag FIRST to prevent async crashes
    this.isDestroyed = true;

    this.routeSubscription?.unsubscribe();
    this.localImagesSubscription?.unsubscribe();
    this.visualFieldsSubscription?.unsubscribe();
    this.configSubscription?.unsubscribe();
  }

  /**
   * Safe wrapper for changeDetectorRef.detectChanges()
   */
  private safeDetectChanges(): void {
    if (!this.isDestroyed) {
      try {
        this.changeDetectorRef.detectChanges();
      } catch (err) {
        console.warn('[GenericVisualDetail] detectChanges failed:', err);
      }
    }
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

    // DEXIE-FIRST: Keep loading=true until data is loaded
    // loadVisualDataMobile() will set loading=false AFTER item is set
    // This prevents the "Visual item not found" flash
    this.loading = true;

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
   *
   * DEXIE-FIRST INSTANT LOADING: Show data immediately, no loading screen
   */
  private async loadVisualDataMobile() {
    if (!this.config) {
      console.error('[GenericVisualDetail] loadVisualDataMobile: config is null!');
      return;
    }

    try {
      // ========================================
      // DEXIE-FIRST: Query Dexie field FIRST, not templates
      // Templates have stale data. Dexie fields have current user edits.
      // ========================================

      // STEP 1: Query the correct Dexie table based on template type
      const allFields = await this.getFieldsFromDexie();
      const field = allFields.find((f: any) => f.templateId === this.templateId);

      // Guard after async
      if (this.isDestroyed) return;

      console.log('[GenericVisualDetail] DEXIE-FIRST: Field found:', !!field, 'templateId:', this.templateId,
        'allFields count:', allFields.length, 'config:', this.config?.id);

      // STEP 2: If field exists, use it IMMEDIATELY (this is the Dexie-first pattern)
      if (field) {
        // Get visualId from field (use both temp and real for photo lookup)
        const tempId = this.getTempIdFromField(field);
        const realId = this.getRealIdFromField(field);
        this.visualId = tempId || realId || '';

        // Debug: Log all ID fields for this template type
        console.log(`[GenericVisualDetail] DEXIE-FIRST: ${this.config?.id} field IDs:`,
          'tempId:', tempId, 'realId:', realId,
          'field.tempHudId:', field.tempHudId, 'field.hudId:', field.hudId,
          'field.tempVisualId:', field.tempVisualId, 'field.visualId:', field.visualId);

        // Create item from Dexie field data (NOT from template - that's stale!)
        this.item = this.convertGenericFieldToItem(field);
        this.editableTitle = this.item.name;
        this.editableText = this.item.text;
        this.categoryName = field.category || this.categoryName;

        // CRITICAL: Set loading=false AFTER item is set
        this.loading = false;
        this.safeDetectChanges();

        console.log('[GenericVisualDetail] DEXIE-FIRST: Instant load from field:', this.item.name, 'visualId:', this.visualId);

        // Load photos immediately (don't wait)
        this.loadPhotosMobile().catch(err => {
          console.error('[GenericVisualDetail] Photo load error:', err);
        });

        // Set up Dexie subscription for real-time updates
        this.subscribeToVisualFieldChanges();
        return;
      }

      // STEP 3: No field in Dexie - fall back to template cache (for unvisited items)
      const cacheKey = this.config.templatesCacheKey as 'visual' | 'hud' | 'lbw' | 'dte' | 'efe';
      const cachedTemplates = await this.indexedDb.getCachedTemplates(cacheKey) || [];
      const template = cachedTemplates.find((t: any) =>
        Number(t.TemplateID || t.PK_ID) === this.templateId
      );

      // Guard after async
      if (this.isDestroyed) return;

      if (template) {
        this.item = this.convertTemplateToItem(template);
        this.editableTitle = this.item.name;
        this.editableText = this.item.text;
        this.categoryName = template.Category || this.categoryName;
        console.log('[GenericVisualDetail] FALLBACK: Loaded from template:', this.item.name);
      } else {
        // No field AND no template - create minimal item
        console.warn('[GenericVisualDetail] No Dexie field or template found for templateId:', this.templateId);
        this.item = this.createMinimalItem();
        this.editableTitle = this.item.name;
        this.editableText = '';
      }

      // CRITICAL: Set loading=false AFTER item is set
      this.loading = false;
      this.safeDetectChanges();

      // Set up Dexie subscription for real-time updates
      this.subscribeToVisualFieldChanges();

    } catch (error: any) {
      console.error('[GenericVisualDetail] MOBILE: Error loading from Dexie:', error);
      // Create minimal item so page doesn't show "not found"
      this.item = this.createMinimalItem();
      this.editableTitle = this.item.name;
      this.editableText = '';
      this.loading = false;
      this.safeDetectChanges();
    }
  }

  /**
   * Get fields from the correct Dexie table based on template type
   */
  private async getFieldsFromDexie(): Promise<any[]> {
    if (!this.config) return [];

    switch (this.config.id) {
      case 'efe':
        return db.visualFields.where('serviceId').equals(this.serviceId).toArray();
      case 'hud':
        return db.hudFields.where('serviceId').equals(this.serviceId).toArray();
      case 'lbw':
        return db.lbwFields.where('serviceId').equals(this.serviceId).toArray();
      case 'dte':
        return db.dteFields.where('serviceId').equals(this.serviceId).toArray();
      default:
        return db.visualFields.where('serviceId').equals(this.serviceId).toArray();
    }
  }

  /**
   * Get the visual ID from a field using the correct field name based on template type
   */
  private getVisualIdFromField(field: any): string {
    if (!this.config) return '';

    switch (this.config.id) {
      case 'efe':
        return String(field.tempVisualId || field.visualId || '');
      case 'hud':
        return String(field.tempHudId || field.hudId || '');
      case 'lbw':
        return String(field.tempLbwId || field.lbwId || '');
      case 'dte':
        return String(field.tempDteId || field.dteId || '');
      default:
        return String(field.tempVisualId || field.visualId || '');
    }
  }

  /**
   * Convert generic Dexie field to VisualItem (works for all template types)
   */
  private convertGenericFieldToItem(field: any): VisualItem {
    const recordId = this.getVisualIdFromField(field);
    return {
      id: recordId || field.templateId,
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
   * Merge generic Dexie field with template data
   */
  private mergeGenericFieldWithTemplate(field: any, template: any): VisualItem {
    const recordId = this.getVisualIdFromField(field);
    return {
      id: recordId || field.templateId,
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
   * Get the temp ID from a field (for photo lookup)
   */
  private getTempIdFromField(field: any): string {
    if (!field || !this.config) return '';

    switch (this.config.id) {
      case 'efe':
        return field.tempVisualId ? String(field.tempVisualId) : '';
      case 'hud':
        return field.tempHudId ? String(field.tempHudId) : '';
      case 'lbw':
        return field.tempLbwId ? String(field.tempLbwId) : '';
      case 'dte':
        return field.tempDteId ? String(field.tempDteId) : '';
      default:
        return field.tempVisualId ? String(field.tempVisualId) : '';
    }
  }

  /**
   * Get the real (synced) ID from a field (for photo lookup)
   */
  private getRealIdFromField(field: any): string {
    if (!field || !this.config) return '';

    switch (this.config.id) {
      case 'efe':
        return field.visualId ? String(field.visualId) : '';
      case 'hud':
        return field.hudId ? String(field.hudId) : '';
      case 'lbw':
        return field.lbwId ? String(field.lbwId) : '';
      case 'dte':
        return field.dteId ? String(field.dteId) : '';
      default:
        return field.visualId ? String(field.visualId) : '';
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
   * Subscribe to Dexie field changes for real-time updates (template-aware)
   */
  private subscribeToVisualFieldChanges() {
    if (!this.config) return;

    // Create liveQuery for the correct table based on template type
    // Use any type to handle different field types (VisualField, HudField, LbwField, DteField)
    const observable = liveQuery((): Promise<any> => {
      switch (this.config!.id) {
        case 'efe':
          return db.visualFields.where('[serviceId+templateId]').equals([this.serviceId, this.templateId]).first();
        case 'hud':
          return db.hudFields.where('[serviceId+templateId]').equals([this.serviceId, this.templateId]).first();
        case 'lbw':
          return db.lbwFields.where('[serviceId+templateId]').equals([this.serviceId, this.templateId]).first();
        case 'dte':
          return db.dteFields.where('[serviceId+templateId]').equals([this.serviceId, this.templateId]).first();
        default:
          return db.visualFields.where('[serviceId+templateId]').equals([this.serviceId, this.templateId]).first();
      }
    });

    const subscription = observable.subscribe({
      next: async (field: any) => {
        // Guard against processing after destruction
        if (this.isDestroyed || !field) return;

        // Check if ID changed (sync completed) using template-specific ID fields
        const newVisualId = this.getVisualIdFromField(field);
        if (newVisualId && newVisualId !== this.lastKnownVisualId) {
          this.lastKnownVisualId = String(newVisualId);
          this.visualId = String(newVisualId);
          console.log('[GenericVisualDetail] MOBILE: visualId updated to:', this.visualId);
          await this.loadPhotos();
          this.safeDetectChanges();
        }
      }
    });

    this.visualFieldsSubscription = subscription;
  }

  // ===== PHOTO LOADING =====

  private async loadPhotos() {
    if (!this.config || this.isDestroyed) return;

    this.loadingPhotos = true;
    this.safeDetectChanges();

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
      this.safeDetectChanges();
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
        loading: true,  // Image is loading until (load) event fires
        isLocal: false,
        hasAnnotations,
        // Store drawings in MULTIPLE fields (matches EFE pattern)
        drawings: att.Drawings || '',
        rawDrawingsString: att.Drawings || '',
        Drawings: att.Drawings || '',
        // Include all ID fields for cache lookup (matches EFE pattern)
        imageId: attachId,
        attachId: attachId
      });
    }
  }

  /**
   * Load photos in mobile mode (Dexie ONLY - no API calls)
   *
   * IMPORTANT: Mobile app uses strict Dexie-first approach.
   * Uses 4-tier fallback system matching EFE pattern:
   * - TIER 1: Query by visualId as entityId
   * - TIER 2: Query by alternate ID (tempId or realId)
   * - TIER 3: Query by mapped realId from tempIdMappings
   * - TIER 4: Reverse lookup via tempIdMappings
   */
  private async loadPhotosMobile() {
    if (!this.config || this.isDestroyed) return;

    // ANNOTATION THUMBNAIL FIX: Load cached annotated images into memory map (matches EFE pattern)
    if (this.bulkAnnotatedImagesMap.size === 0) {
      try {
        const cachedAnnotatedImages = await this.indexedDb.getAllCachedAnnotatedImagesForService();
        this.bulkAnnotatedImagesMap = cachedAnnotatedImages;
        console.log('[GenericVisualDetail] Loaded', cachedAnnotatedImages.size, 'cached annotated images into memory');
      } catch (e) {
        console.warn('[GenericVisualDetail] Could not load cached annotated images:', e);
      }
    }

    if (this.isDestroyed) return;

    // Re-query the correct Dexie table based on template type
    const allFields = await this.getFieldsFromDexie();
    const field = allFields.find((f: any) => f.templateId === this.templateId);

    // Get BOTH IDs - photos may be stored with either tempId OR realId
    const tempId = this.getTempIdFromField(field);
    const realId = this.getRealIdFromField(field);

    // Store both for multi-tier lookup
    this.visualId = tempId || realId || this.visualId || '';
    this.lastKnownVisualId = this.visualId;

    console.log('[GenericVisualDetail] PHOTO LOAD: tempId:', tempId, 'realId:', realId, 'visualId:', this.visualId);

    if (!this.visualId && !tempId && !realId) {
      console.log('[GenericVisualDetail] MOBILE: No visualId found, cannot load photos');
      this.photos = [];
      return;
    }

    // ========================================
    // OPTIMIZED PHOTO LOOKUP: Gather ALL possible IDs upfront, then search once
    // This matches EFE pattern - fast, single-pass lookup
    // ========================================
    const idsToSearch = new Set<string>();

    // Add direct IDs from field
    if (realId) idsToSearch.add(String(realId));
    if (tempId) idsToSearch.add(String(tempId));
    if (this.visualId && this.visualId !== realId && this.visualId !== tempId) {
      idsToSearch.add(String(this.visualId));
    }

    // UPFRONT: Get mapped IDs from tempIdMappings BEFORE searching
    // This eliminates the slow fallback tier
    if (tempId) {
      const mappedRealId = await this.indexedDb.getRealId(tempId);
      if (mappedRealId) idsToSearch.add(String(mappedRealId));
    }
    if (realId) {
      const mappedTempId = await this.indexedDb.getTempId(String(realId));
      if (mappedTempId) idsToSearch.add(String(mappedTempId));
    }

    console.log('[GenericVisualDetail] OPTIMIZED: Searching for photos with ALL IDs:', Array.from(idsToSearch));

    // Single-pass search with all possible IDs
    let localImages: any[] = [];
    let foundWithId = '';

    for (const searchId of idsToSearch) {
      if (localImages.length > 0) break;
      localImages = await db.localImages.where('entityId').equals(searchId).toArray();
      if (localImages.length > 0) {
        foundWithId = searchId;
        console.log('[GenericVisualDetail] OPTIMIZED: Found', localImages.length, 'photos with entityId:', searchId);
      }
    }

    // Log final result
    if (localImages.length > 0) {
      console.log('[GenericVisualDetail] OPTIMIZED: Total photos:', localImages.length, 'foundWithId:', foundWithId);
    } else {
      console.log('[GenericVisualDetail] OPTIMIZED: No photos found. Searched IDs:', Array.from(idsToSearch));
    }

    // Guard after async operations
    if (this.isDestroyed) return;

    // ========================================
    // OPTIMIZED PHOTO DISPLAY: Show photos immediately, load blobs in parallel
    // This matches EFE pattern for instant photo display
    // ========================================

    // STEP 1: Create PhotoItems immediately with placeholder/cached URLs
    this.photos = localImages.map(img => {
      const hasAnnotations = !!(img.drawings && img.drawings.length > 10);

      // Check memory cache first (instant)
      let displayUrl = 'assets/img/photo-placeholder.svg';
      const possibleIds = [img.imageId, img.attachId].filter(id => id);
      for (const checkId of possibleIds) {
        const memCached = this.bulkAnnotatedImagesMap.get(String(checkId));
        if (memCached) {
          displayUrl = memCached;
          break;
        }
      }

      // Use remote URL if available (no await needed)
      if (displayUrl === 'assets/img/photo-placeholder.svg' && img.remoteUrl) {
        displayUrl = img.remoteUrl;
      }

      return {
        id: img.imageId,
        displayUrl,
        originalUrl: img.remoteUrl || displayUrl,
        caption: img.caption || '',
        uploading: img.status === 'queued' || img.status === 'uploading',
        loading: !img.remoteUrl && !!img.localBlobId, // Mark as loading if needs blob fetch
        isLocal: !img.isSynced,
        hasAnnotations,
        drawings: img.drawings || '',
        rawDrawingsString: img.drawings || '',
        Drawings: img.drawings || '',
        imageId: img.imageId,
        attachId: img.attachId || undefined,
        _localBlobId: img.localBlobId // Store for async loading
      } as PhotoItem & { _localBlobId?: number };
    });

    console.log('[GenericVisualDetail] MOBILE: Showing', this.photos.length, 'photos immediately');

    // STEP 2: Trigger UI update immediately so photos show
    this.safeDetectChanges();

    // STEP 3: Load blob URLs in parallel (background)
    const loadPromises = this.photos.map(async (photo, index) => {
      if (this.isDestroyed) return;

      const img = localImages[index];
      if (!img) return;

      const hasAnnotations = photo.hasAnnotations;
      let displayUrl = photo.displayUrl;
      let originalUrl = photo.originalUrl;
      let needsUpdate = false;

      // Load from local blob if needed
      if (img.localBlobId && displayUrl === 'assets/img/photo-placeholder.svg') {
        try {
          const blob = await db.localBlobs.get(img.localBlobId);
          if (blob && !this.isDestroyed) {
            const blobObj = new Blob([blob.data], { type: blob.contentType });
            originalUrl = URL.createObjectURL(blobObj);
            displayUrl = originalUrl;
            needsUpdate = true;
          }
        } catch (e) {
          console.warn('[GenericVisualDetail] Failed to load blob:', e);
        }
      }

      // Check IndexedDB for cached annotated image
      if (hasAnnotations && !this.bulkAnnotatedImagesMap.has(String(img.imageId))) {
        const possibleIds = [img.imageId, img.attachId].filter(id => id);
        for (const checkId of possibleIds) {
          try {
            const cachedAnnotated = await this.indexedDb.getCachedAnnotatedImage(String(checkId));
            if (cachedAnnotated && !this.isDestroyed) {
              displayUrl = cachedAnnotated;
              this.bulkAnnotatedImagesMap.set(String(checkId), cachedAnnotated);
              needsUpdate = true;
              break;
            }
          } catch (e) {
            // Ignore cache lookup errors
          }
        }
      }

      // Render annotations if needed (and not already cached)
      if (hasAnnotations && originalUrl !== 'assets/img/photo-placeholder.svg' &&
          !this.bulkAnnotatedImagesMap.has(String(img.imageId))) {
        try {
          const renderedUrl = await renderAnnotationsOnPhoto(originalUrl, img.drawings);
          if (renderedUrl && renderedUrl !== originalUrl && !this.isDestroyed) {
            displayUrl = renderedUrl;
            this.bulkAnnotatedImagesMap.set(img.imageId, renderedUrl);
            if (img.attachId) {
              this.bulkAnnotatedImagesMap.set(img.attachId, renderedUrl);
            }
            needsUpdate = true;
          }
        } catch (renderErr) {
          console.warn('[GenericVisualDetail] Failed to render annotations:', renderErr);
        }
      }

      // Update photo in array if changed
      if (needsUpdate && !this.isDestroyed) {
        this.photos[index] = {
          ...this.photos[index],
          displayUrl,
          originalUrl,
          loading: false
        };
      }
    });

    // Wait for all to complete, then update UI once
    await Promise.all(loadPromises);

    if (!this.isDestroyed) {
      this.safeDetectChanges();
      console.log('[GenericVisualDetail] MOBILE: Finished loading all photo blobs');
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
        // MOBILE: Dexie ONLY - no API calls
        // Background sync will push changes to server
        const dexieUpdate: any = {};
        if (titleChanged) dexieUpdate.templateName = this.editableTitle;
        if (textChanged) dexieUpdate.templateText = this.editableText;
        dexieUpdate.isSelected = true;
        dexieUpdate.category = actualCategory;
        // Use generic recordId/tempRecordId - genericFieldRepo maps to template-specific fields
        if (this.visualId) {
          const isTempId = String(this.visualId).startsWith('temp_');
          dexieUpdate.recordId = isTempId ? null : String(this.visualId);
          dexieUpdate.tempRecordId = isTempId ? String(this.visualId) : null;
        }

        await this.genericFieldRepo.setField(this.config!, this.serviceId, actualCategory, this.templateId, dexieUpdate);
        console.log('[GenericVisualDetail] MOBILE: Updated Dexie:', dexieUpdate);
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
        // Use generic recordId/tempRecordId - genericFieldRepo maps to template-specific fields
        if (this.visualId) {
          const isTempId = String(this.visualId).startsWith('temp_');
          dexieUpdate.recordId = isTempId ? null : String(this.visualId);
          dexieUpdate.tempRecordId = isTempId ? String(this.visualId) : null;
        }

        await this.genericFieldRepo.setField(this.config!, this.serviceId, actualCategory, this.templateId, dexieUpdate);
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
        // Use generic recordId/tempRecordId - genericFieldRepo maps to template-specific fields
        if (this.visualId) {
          const isTempId = String(this.visualId).startsWith('temp_');
          dexieUpdate.recordId = isTempId ? null : String(this.visualId);
          dexieUpdate.tempRecordId = isTempId ? String(this.visualId) : null;
        }

        await this.genericFieldRepo.setField(this.config!, this.serviceId, actualCategory, this.templateId, dexieUpdate);
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
      // Store drawings in MULTIPLE fields (matches EFE pattern)
      drawings: photo.Drawings || '',
      rawDrawingsString: photo.Drawings || '',
      Drawings: photo.Drawings || '',
      // Include all ID fields for cache lookup
      imageId: photo.imageId,
      attachId: photo.attachId || undefined
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
      cssClass: 'custom-document-alert',
      buttons: [
        {
          text: 'Delete',
          role: 'destructive',
          cssClass: 'alert-button-confirm'
        },
        {
          text: 'Cancel',
          role: 'cancel',
          cssClass: 'alert-button-cancel'
        }
      ]
    });

    await alert.present();

    // Wait for dialog to dismiss and check if user confirmed deletion
    const result = await alert.onDidDismiss();
    if (result.role === 'destructive') {
      await this.confirmDeletePhoto(photo);
    }
  }

  private async confirmDeletePhoto(photo: PhotoItem) {
    try {
      this.removePhotoFromList(photo.id);
      this.changeDetectorRef.detectChanges();

      if (environment.isWeb) {
        await this.dataAdapter.deleteAttachment(photo.id);
        console.log('[GenericVisualDetail] WEBAPP: Deleted attachment:', photo.id);
      } else {
        // Mobile: Delete from LocalImageService (handles blob cleanup, outbox removal, etc.)
        await this.localImageService.deleteLocalImage(photo.id);
        console.log('[GenericVisualDetail] MOBILE: Deleted via LocalImageService:', photo.id);
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
          // Update local photo state (store in MULTIPLE fields like EFE pattern)
          this.photos[photoIndex].drawings = result.compressedDrawings;
          this.photos[photoIndex].rawDrawingsString = result.compressedDrawings;
          this.photos[photoIndex].Drawings = result.compressedDrawings;
          this.photos[photoIndex].hasAnnotations = result.hasAnnotations;
          this.photos[photoIndex].caption = result.caption;

          if (result.annotatedUrl) {
            this.photos[photoIndex].displayUrl = result.annotatedUrl;
            this.photos[photoIndex].thumbnailUrl = result.annotatedUrl;

            // ANNOTATION FIX: Cache annotated URL in memory map for persistence (matches EFE pattern)
            // Cache under BOTH photoId AND attachId for reliable lookup
            this.bulkAnnotatedImagesMap.set(String(result.photoId), result.annotatedUrl);
            if (this.photos[photoIndex].attachId && this.photos[photoIndex].attachId !== result.photoId) {
              this.bulkAnnotatedImagesMap.set(String(this.photos[photoIndex].attachId), result.annotatedUrl);
            }
            if (this.photos[photoIndex].imageId && this.photos[photoIndex].imageId !== result.photoId) {
              this.bulkAnnotatedImagesMap.set(String(this.photos[photoIndex].imageId), result.annotatedUrl);
            }
            console.log('[GenericVisualDetail] Cached annotated thumbnail in memory map for:', result.photoId);
          }
          this.changeDetectorRef.detectChanges();
        }
      }
    };

    await this.photoHandler.viewExistingPhoto(viewConfig);
  }

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
      if (environment.isWeb && !photo.isLocal) {
        const attachId = photo.id;
        if (attachId && !String(attachId).startsWith('temp_') && !String(attachId).startsWith('img_')) {
          // Use CaspioService directly with the correct attach table from config
          const attachTable = this.config?.attachTableName || 'LPS_Services_Visuals_Attach';
          const updateData = {
            Annotation: caption,
            Drawings: photo.drawings || ''
          };

          await firstValueFrom(
            this.caspioService.put(`/tables/${attachTable}/records?q.where=AttachID=${attachId}`, updateData)
          );
          console.log('[GenericVisualDetail] WEBAPP: Updated caption via API:', attachId, 'table:', attachTable);
        }
        this.changeDetectorRef.detectChanges();
        return;
      }

      // MOBILE MODE: Update in localImages (Dexie)
      await db.localImages.update(photo.id, { caption, updatedAt: Date.now() });
      console.log('[GenericVisualDetail] MOBILE: Updated caption in Dexie');

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
