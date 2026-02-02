import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { IonicModule, ToastController, LoadingController, AlertController, ModalController, ViewWillEnter } from '@ionic/angular';
import { Subject, Subscription } from 'rxjs';
import { takeUntil, debounceTime, filter } from 'rxjs/operators';

import { environment } from '../../../../environments/environment';
import { TemplateConfig } from '../../../services/template/template-config.interface';
import { TemplateConfigService } from '../../../services/template/template-config.service';
import { TemplateDataAdapter } from '../../../services/template/template-data-adapter.service';
import { TEMPLATE_DATA_PROVIDER } from '../../../services/template/template-data-provider.factory';
import { ITemplateDataProvider } from '../../../services/template/template-data-provider.interface';
import { IndexedDbService, LocalImage } from '../../../services/indexed-db.service';
import { BackgroundSyncService } from '../../../services/background-sync.service';
import { PhotoHandlerService, PhotoCaptureConfig, ViewPhotoConfig, ViewPhotoResult, StandardPhotoEntry } from '../../../services/photo-handler.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { CaspioService } from '../../../services/caspio.service';
import { HudDataService } from '../../hud/hud-data.service';
import { LbwDataService } from '../../lbw/lbw-data.service';
import { DteDataService } from '../../dte/dte-data.service';
import { EngineersFoundationDataService } from '../../engineers-foundation/engineers-foundation-data.service';
import { HasUnsavedChanges } from '../../../services/unsaved-changes.service';
import { LocalImageService } from '../../../services/local-image.service';
import { AddCustomVisualModalComponent } from '../../../modals/add-custom-visual-modal/add-custom-visual-modal.component';
import { firstValueFrom } from 'rxjs';
import { db, VisualField } from '../../../services/caspio-db';
import { VisualFieldRepoService } from '../../../services/visual-field-repo.service';
import { renderAnnotationsOnPhoto } from '../../../utils/annotation-utils';

/**
 * Visual item interface for category detail pages
 */
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
  isSaving?: boolean;
  photos?: any[];
  otherValue?: string;
  key?: string;
}

/**
 * Organized data structure for the three sections
 */
interface OrganizedData {
  comments: VisualItem[];
  limitations: VisualItem[];
  deficiencies: VisualItem[];
}

/**
 * Debug log entry
 */
interface DebugLogEntry {
  time: string;
  type: string;
  message: string;
}

/**
 * GenericCategoryDetailPage - Unified category detail page for all templates
 *
 * This component consolidates the HUD, EFE, LBW, and DTE category detail pages
 * into a single config-driven implementation. It uses:
 * - TemplateConfigService for auto-detecting which template is active
 * - TemplateDataAdapter for config-driven data operations
 * - Config-driven feature flags for template-specific behavior
 */
@Component({
  selector: 'app-generic-category-detail',
  templateUrl: './category-detail.page.html',
  styleUrls: ['./category-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class GenericCategoryDetailPage implements OnInit, OnDestroy, ViewWillEnter, HasUnsavedChanges {
  // ==================== Template Config ====================
  config: TemplateConfig | null = null;

  // ==================== Route Parameters ====================
  projectId: string = '';
  serviceId: string = '';
  actualServiceId: string = '';
  categoryName: string = '';

  // ==================== UI State ====================
  loading: boolean = true;
  isRefreshing: boolean = false;
  searchTerm: string = '';
  isWeb = environment.isWeb;

  // ==================== Data State ====================
  organizedData: OrganizedData = { comments: [], limitations: [], deficiencies: [] };
  visualDropdownOptions: { [templateId: number]: string[] } = {};
  selectedItems: { [key: string]: boolean } = {};
  savingItems: { [key: string]: boolean } = {};

  // ==================== Photo State ====================
  visualPhotos: { [key: string]: any[] } = {};
  visualRecordIds: { [key: string]: string } = {};
  uploadingPhotosByKey: { [key: string]: boolean } = {};
  loadingPhotosByKey: { [key: string]: boolean } = {};
  photoCountsByKey: { [key: string]: number } = {};
  expandedPhotos: { [key: string]: boolean } = {};
  bulkAnnotatedImagesMap: Map<string, string> = new Map();

  // ==================== DEXIE-FIRST: Bulk Caching Maps (MOBILE ONLY) ====================
  private bulkLocalImagesMap: Map<string, LocalImage[]> = new Map();
  private tempIdToRealIdCache: Map<string, string> = new Map();
  private lastConvertedFields: VisualField[] = [];

  // ==================== DEXIE-FIRST: Guard Flags (MOBILE ONLY) ====================
  private isPopulatingPhotos = false;
  private localOperationCooldown = false;
  private isCameraCaptureInProgress = false;
  private isMultiImageUploadInProgress = false;
  private liveQueryDebounceTimer: any = null;
  private initialLoadComplete: boolean = false;
  private lastLoadedServiceId: string = '';
  private lastLoadedCategoryName: string = '';

  // ==================== Caption Popup State ====================
  private isCaptionPopupOpen = false;

  // ==================== Accordion State ====================
  expandedSections: Set<string> = new Set(['information', 'limitations', 'deficiencies']);

  // ==================== Debug State ====================
  debugLogs: DebugLogEntry[] = [];
  showDebugPopup: boolean = false;

  // ==================== Subscriptions ====================
  private destroy$ = new Subject<void>();
  private configSubscription?: Subscription;
  private syncSubscription?: Subscription;
  private localImagesSubscription?: Subscription;
  private visualFieldsSubscription?: Subscription;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private changeDetectorRef: ChangeDetectorRef,
    private ngZone: NgZone,
    private toastController: ToastController,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private modalController: ModalController,
    private templateConfigService: TemplateConfigService,
    private dataAdapter: TemplateDataAdapter,
    private indexedDb: IndexedDbService,
    private backgroundSync: BackgroundSyncService,
    private photoHandler: PhotoHandlerService,
    private offlineTemplate: OfflineTemplateService,
    private caspioService: CaspioService,
    private localImageService: LocalImageService,
    private hudData: HudDataService,
    private lbwData: LbwDataService,
    private dteData: DteDataService,
    private efeData: EngineersFoundationDataService,
    private visualFieldRepo: VisualFieldRepoService,
    @Inject(TEMPLATE_DATA_PROVIDER) private dataProvider: ITemplateDataProvider
  ) {}

  // ==================== Lifecycle ====================

  ngOnInit(): void {
    this.logDebug('INIT', 'GenericCategoryDetailPage initializing');

    // Subscribe to config changes
    this.configSubscription = this.templateConfigService.activeConfig$
      .pipe(takeUntil(this.destroy$))
      .subscribe(config => {
        this.config = config;
        this.logDebug('CONFIG', `Config loaded for template: ${config.id}`);
        this.loadRouteParams();
      });
  }

  ionViewWillEnter(): void {
    this.logDebug('VIEW', 'ionViewWillEnter called');

    // DEXIE-FIRST (MOBILE): Use smart reload with reactive subscriptions
    if (!environment.isWeb && this.config?.features.offlineFirst) {
      // If initial load not complete, subscriptions will be set up in loadRouteParams
      if (!this.initialLoadComplete) {
        this.logDebug('VIEW', 'Initial load not complete, skipping ionViewWillEnter');
        return;
      }

      // Check if we need to reload (different service/category)
      const needsReload = this.serviceId !== this.lastLoadedServiceId ||
                          this.categoryName !== this.lastLoadedCategoryName;

      if (needsReload) {
        this.logDebug('VIEW', 'Service/category changed, reinitializing');
        this.initializeVisualFields();
      } else {
        // Same page, just refresh photos from Dexie
        this.logDebug('VIEW', 'Same page, refreshing local state');
        this.refreshLocalState();
      }
      return;
    }

    // WEBAPP: Use existing API-based refresh
    if (this.config && !this.loading) {
      this.loadData();
    }
  }

  ngOnDestroy(): void {
    this.logDebug('DESTROY', 'GenericCategoryDetailPage destroying');
    this.destroy$.next();
    this.destroy$.complete();
    this.configSubscription?.unsubscribe();
    this.syncSubscription?.unsubscribe();

    // DEXIE-FIRST: Clean up Dexie subscriptions
    this.localImagesSubscription?.unsubscribe();
    this.visualFieldsSubscription?.unsubscribe();

    // Clear debounce timers
    if (this.liveQueryDebounceTimer) {
      clearTimeout(this.liveQueryDebounceTimer);
      this.liveQueryDebounceTimer = null;
    }
  }

  // ==================== HasUnsavedChanges ====================

  hasUnsavedChanges(): boolean {
    // Check if any items are currently saving
    return Object.values(this.savingItems).some(saving => saving);
  }

  // ==================== Route Loading ====================

  private async loadRouteParams(): Promise<void> {
    // Get route params - need to traverse up the route tree
    // Route structure: template/:projectId/:serviceId/category/:category
    // or: template/:projectId/:serviceId/structural/category/:category (for EFE)

    const currentParams = this.route.snapshot?.params || {};
    this.categoryName = currentParams['category'] || '';

    // Traverse up to find projectId and serviceId
    let currentRoute = this.route.snapshot;
    while (currentRoute) {
      if (currentRoute.params['projectId']) {
        this.projectId = currentRoute.params['projectId'];
      }
      if (currentRoute.params['serviceId']) {
        this.serviceId = currentRoute.params['serviceId'];
      }
      currentRoute = currentRoute.parent as any;
    }

    this.logDebug('ROUTE', `Loaded params: projectId=${this.projectId}, serviceId=${this.serviceId}, category=${this.categoryName}`);

    if (this.serviceId && this.categoryName) {
      // DEXIE-FIRST: Use different loading strategies based on platform
      if (environment.isWeb) {
        // WEBAPP: Use existing API-based loading
        await this.loadData();
      } else {
        // MOBILE: Use Dexie-first for templates that support it
        if (this.config?.features.offlineFirst) {
          await this.initializeVisualFields();
        } else {
          await this.loadData();
        }
      }
    } else {
      this.logDebug('ERROR', `Missing required params - serviceId: ${this.serviceId}, category: ${this.categoryName}`);
      this.loading = false;
    }
  }

  // ==================== Data Loading ====================

  private async loadData(): Promise<void> {
    if (!this.config) {
      this.logDebug('ERROR', 'Cannot load data - config not available');
      return;
    }

    this.loading = true;
    this.logDebug('LOAD', `Loading data for ${this.config.id} category: ${this.categoryName}`);

    try {
      // Resolve actualServiceId if needed
      if (this.config.categoryDetailFeatures.hasActualServiceId) {
        this.logDebug('LOAD', `Resolving actualServiceId (hasActualServiceId=true)...`);
        await this.resolveActualServiceId();
        this.logDebug('LOAD', `Resolved: actualServiceId=${this.actualServiceId}, routeServiceId=${this.serviceId}`);
      } else {
        this.actualServiceId = this.serviceId;
        this.logDebug('LOAD', `Using route serviceId directly: ${this.serviceId}`);
      }

      // Load templates and visuals using the appropriate service based on config
      const { templates, visuals } = await this.loadTemplatesAndVisuals();
      this.logDebug('LOAD', `Loaded ${templates.length} templates, ${visuals.length} visuals`);

      if (templates.length === 0) {
        this.logDebug('WARN', 'No templates loaded - check API connection');
      }

      // Build visual record map
      this.buildVisualRecordMap(visuals);

      // Load dropdown options if template uses dynamic dropdowns
      if (this.config.features.dynamicDropdowns) {
        await this.loadDropdownOptions();
      }

      // Organize items into sections
      this.organizeItems(templates, visuals);

      // Load photo counts
      await this.loadPhotoCounts();

      // Load cached annotated images for thumbnail display
      await this.loadCachedAnnotatedImages();

      this.loading = false;
      this.changeDetectorRef.detectChanges();
      this.logDebug('LOAD', 'Data loading complete');

    } catch (error) {
      this.logDebug('ERROR', `Data loading failed: ${error}`);
      this.loading = false;
      await this.showToast('Failed to load data. Please try again.', 'danger');
    }
  }

  // ==================== DEXIE-FIRST: Mobile Data Loading ====================

  /**
   * Initialize visual fields for this category using Dexie-first architecture (MOBILE ONLY)
   * 1. Resolve actualServiceId if needed
   * 2. Seed templates into visualFields (if not already seeded)
   * 3. Merge existing visuals (user selections)
   * 4. Subscribe to reactive updates (liveQuery)
   */
  private async initializeVisualFields(): Promise<void> {
    if (!this.config) {
      this.logDebug('ERROR', 'initializeVisualFields called without config');
      return;
    }

    console.time('[GenericCategoryDetail] initializeVisualFields');
    this.logDebug('DEXIE', `Initializing visual fields (Dexie-first) for ${this.config.id}...`);

    // Resolve actualServiceId if needed (same as loadData)
    if (this.config.categoryDetailFeatures.hasActualServiceId) {
      await this.resolveActualServiceId();
    } else {
      this.actualServiceId = this.serviceId;
    }

    // Unsubscribe from previous subscription if category changed
    if (this.visualFieldsSubscription) {
      this.visualFieldsSubscription.unsubscribe();
      this.visualFieldsSubscription = undefined;
    }

    // Check if fields exist for this category (only for EFE with VisualField table)
    // Other templates (HUD, LBW, DTE) use their own tables and existing data patterns
    const isVisualFieldTemplate = this.config.id === 'efe';

    if (isVisualFieldTemplate) {
      const hasFields = await this.visualFieldRepo.hasFieldsForCategory(
        this.serviceId,
        this.categoryName
      );

      if (!hasFields) {
        this.logDebug('DEXIE', 'No fields found, seeding from templates...');

        // Get templates from cache
        const templates = await this.indexedDb.getCachedTemplates('visual') || [];

        if (templates.length === 0) {
          this.logDebug('WARN', 'No templates in cache, falling back to loadData()');
          await this.loadData();
          console.timeEnd('[GenericCategoryDetail] initializeVisualFields');
          return;
        }

        // Get cached dropdown data
        const cachedDropdownData = await this.indexedDb.getCachedTemplates('visual_dropdown') || [];

        // Seed templates into visualFields
        await this.visualFieldRepo.seedFromTemplates(
          this.serviceId,
          this.categoryName,
          templates,
          cachedDropdownData
        );

        // Get existing visuals and merge selections
        const visuals = await this.indexedDb.getCachedServiceData(this.serviceId, 'visuals') || [];
        await this.visualFieldRepo.mergeExistingVisuals(
          this.serviceId,
          this.categoryName,
          visuals as any[]
        );

        this.logDebug('DEXIE', 'Seeding complete');
      } else {
        this.logDebug('DEXIE', 'Fields already exist, using cached data');
      }

      // Set up LocalImages subscription FIRST (before fields subscription)
      if (!this.localImagesSubscription && this.serviceId) {
        this.subscribeToLocalImagesChanges();
      }

      // Subscribe to reactive updates - this will trigger UI render
      this.visualFieldsSubscription = this.visualFieldRepo
        .getFieldsForCategory$(this.serviceId, this.categoryName)
        .subscribe({
          next: async (fields) => {
            this.logDebug('DEXIE', `Received ${fields.length} fields from liveQuery`);
            this.convertFieldsToOrganizedData(fields);

            // Show UI immediately - no loading screen
            this.loading = false;
            this.changeDetectorRef.detectChanges();

            // Suppress photo population during capture to prevent duplicates
            if (this.isCameraCaptureInProgress || this.isMultiImageUploadInProgress) {
              this.logDebug('DEXIE', 'Suppressing photo population - capture in progress');
              return;
            }

            // Populate photos in background (non-blocking)
            this.populatePhotosFromDexie(fields).then(() => {
              this.changeDetectorRef.detectChanges();
            });
          },
          error: (err) => {
            this.logDebug('ERROR', `Error in visualFields subscription: ${err}`);
            this.loading = false;
            this.changeDetectorRef.detectChanges();
          }
        });
    } else {
      // For non-EFE templates (HUD, LBW, DTE), use existing loadData pattern but with Dexie photos
      await this.loadData();

      // Set up LocalImages subscription for reactive photo updates
      if (!this.localImagesSubscription && this.serviceId) {
        this.subscribeToLocalImagesChanges();
      }
    }

    // Update tracking variables
    this.lastLoadedServiceId = this.serviceId;
    this.lastLoadedCategoryName = this.categoryName;
    this.initialLoadComplete = true;

    console.timeEnd('[GenericCategoryDetail] initializeVisualFields');
  }

  /**
   * Subscribe to Dexie liveQuery for LocalImages changes (MOBILE ONLY)
   * Enables reactive updates when IndexedDB changes (photos added, synced, deleted)
   */
  private subscribeToLocalImagesChanges(): void {
    if (this.localImagesSubscription) {
      this.localImagesSubscription.unsubscribe();
    }

    if (!this.serviceId || !this.config) {
      this.logDebug('DEXIE', 'No serviceId or config, skipping LocalImages subscription');
      return;
    }

    this.logDebug('DEXIE', `Subscribing to LocalImages changes for service: ${this.serviceId}`);

    // Subscribe to all LocalImages for this service with the appropriate entity type
    const entityType = this.config.entityType as any;
    this.localImagesSubscription = db.liveLocalImages$(this.serviceId, entityType).subscribe(
      async (localImages) => {
        this.logDebug('DEXIE', `LocalImages updated: ${localImages.length} images`);

        // Suppress during camera capture to prevent duplicate photos
        if (this.isCameraCaptureInProgress || this.isMultiImageUploadInProgress) {
          this.logDebug('DEXIE', 'Suppressing - capture in progress');
          return;
        }

        // Update bulkLocalImagesMap reactively
        this.updateBulkLocalImagesMap(localImages);

        // Refresh photos from updated Dexie data
        if (this.lastConvertedFields && this.lastConvertedFields.length > 0) {
          await this.populatePhotosFromDexie(this.lastConvertedFields);
        }

        // Debounce change detection
        if (this.liveQueryDebounceTimer) {
          clearTimeout(this.liveQueryDebounceTimer);
        }
        this.liveQueryDebounceTimer = setTimeout(() => {
          this.changeDetectorRef.detectChanges();
          this.liveQueryDebounceTimer = null;
        }, 100);
      },
      (error) => {
        this.logDebug('ERROR', `Error in LocalImages subscription: ${error}`);
      }
    );
  }

  /**
   * Update bulkLocalImagesMap from liveQuery results (MOBILE ONLY)
   * Groups LocalImages by entityId for efficient lookup
   */
  private updateBulkLocalImagesMap(localImages: LocalImage[]): void {
    this.bulkLocalImagesMap.clear();

    // Group LocalImages by entityId
    for (const img of localImages) {
      if (!img.entityId) continue;

      const entityId = String(img.entityId);
      if (!this.bulkLocalImagesMap.has(entityId)) {
        this.bulkLocalImagesMap.set(entityId, []);
      }
      this.bulkLocalImagesMap.get(entityId)!.push(img);
    }

    // Bidirectional ID mapping using cached temp->real mappings
    for (const [key, tempOrRealId] of Object.entries(this.visualRecordIds)) {
      if (!tempOrRealId || !String(tempOrRealId).startsWith('temp_')) continue;

      const tempId = String(tempOrRealId);
      const realId = this.tempIdToRealIdCache.get(tempId);

      if (realId && this.bulkLocalImagesMap.has(realId)) {
        const imagesUnderRealId = this.bulkLocalImagesMap.get(realId)!;
        if (!this.bulkLocalImagesMap.has(tempId)) {
          this.bulkLocalImagesMap.set(tempId, []);
        }
        const existing = this.bulkLocalImagesMap.get(tempId)!;
        for (const img of imagesUnderRealId) {
          if (!existing.some(e => e.imageId === img.imageId)) {
            existing.push(img);
          }
        }
      }
    }

    // Reverse mapping
    for (const [tempId, realId] of this.tempIdToRealIdCache.entries()) {
      if (this.bulkLocalImagesMap.has(tempId) && !this.bulkLocalImagesMap.has(realId)) {
        const imagesUnderTempId = this.bulkLocalImagesMap.get(tempId)!;
        this.bulkLocalImagesMap.set(realId, [...imagesUnderTempId]);
      }
    }

    this.logDebug('DEXIE', `Updated bulkLocalImagesMap with ${this.bulkLocalImagesMap.size} entity groups`);
  }

  /**
   * Populate visualPhotos by querying Dexie LocalImages directly (MOBILE ONLY)
   * Uses 4-tier fallback: realId → tempId → mapped realId → reverse lookup
   */
  private async populatePhotosFromDexie(fields: VisualField[]): Promise<void> {
    // Mutex: Prevent concurrent calls that cause duplicate photos
    if (this.isPopulatingPhotos) {
      this.logDebug('DEXIE', 'Skipping - already populating photos (mutex)');
      return;
    }
    this.isPopulatingPhotos = true;

    try {
      this.logDebug('DEXIE', `Populating photos from Dexie for ${fields.length} fields...`);

      // Load annotated images in background if not loaded
      if (this.bulkAnnotatedImagesMap.size === 0) {
        this.indexedDb.getAllCachedAnnotatedImagesForService().then(annotatedImages => {
          this.bulkAnnotatedImagesMap = annotatedImages;
          this.changeDetectorRef.detectChanges();
        });
      }

      // Get ALL LocalImages for this service in one query
      const allLocalImages = await this.localImageService.getImagesForService(this.serviceId);

      // Group by entityId for efficient lookup
      const localImagesMap = new Map<string, LocalImage[]>();
      for (const img of allLocalImages) {
        if (!img.entityId) continue;
        const entityId = String(img.entityId);
        if (!localImagesMap.has(entityId)) {
          localImagesMap.set(entityId, []);
        }
        localImagesMap.get(entityId)!.push(img);
      }

      this.logDebug('DEXIE', `Found ${allLocalImages.length} LocalImages for ${localImagesMap.size} entities`);

      let photosAddedCount = 0;

      for (const field of fields) {
        const realId = field.visualId;
        const tempId = field.tempVisualId;
        const visualId = realId || tempId;
        if (!visualId) continue;

        const key = `${field.category}_${field.templateId}`;
        this.visualRecordIds[key] = visualId;

        // 4-tier fallback lookup
        let localImages = realId ? (localImagesMap.get(realId) || []) : [];

        // Try tempId lookup
        if (localImages.length === 0 && tempId && tempId !== realId) {
          localImages = localImagesMap.get(tempId) || [];
        }

        // Check IndexedDB for temp-to-real mapping
        if (localImages.length === 0 && tempId) {
          const mappedRealId = await this.indexedDb.getRealId(tempId);
          if (mappedRealId) {
            localImages = localImagesMap.get(mappedRealId) || [];
            // Update VisualField with the real ID
            if (localImages.length > 0 && field.templateId) {
              this.visualFieldRepo.setField(this.serviceId, this.categoryName, field.templateId, {
                visualId: mappedRealId,
                tempVisualId: null
              }).catch(err => {
                this.logDebug('ERROR', `Failed to update VisualField with mapped realId: ${err}`);
              });
            }
          }
        }

        if (localImages.length === 0) continue;

        // Initialize photos array if not exists
        if (!this.visualPhotos[key]) {
          this.visualPhotos[key] = [];
        }

        // Track already loaded photos to avoid duplicates
        const loadedPhotoIds = new Set<string>();
        for (const p of this.visualPhotos[key]) {
          if (p.imageId) loadedPhotoIds.add(p.imageId);
          if (p.AttachID) loadedPhotoIds.add(String(p.AttachID));
          if (p.localImageId) loadedPhotoIds.add(p.localImageId);
        }

        // Add LocalImages to visualPhotos
        for (const localImage of localImages) {
          const imageId = localImage.imageId;

          // Check if photo already exists - refresh its displayUrl
          const existingPhotoIndex = this.visualPhotos[key].findIndex(p =>
            p.imageId === imageId ||
            p.localImageId === imageId ||
            (localImage.attachId && (String(p.AttachID) === localImage.attachId || p.attachId === localImage.attachId))
          );

          if (existingPhotoIndex !== -1) {
            // Photo exists - refresh displayUrl from LocalImages
            try {
              const freshDisplayUrl = await this.localImageService.getDisplayUrl(localImage);
              if (freshDisplayUrl && freshDisplayUrl !== 'assets/img/photo-placeholder.svg') {
                const hasAnnotations = !!(localImage.drawings && localImage.drawings.length > 10);

                // ANNOTATION THUMBNAIL FIX: Use cached annotated image for thumbnail display
                // Check BOTH attachId AND imageId for cached annotated image
                // (cache may be stored under either depending on sync state)
                let cachedAnnotatedUrl = localImage.attachId
                  ? this.bulkAnnotatedImagesMap.get(localImage.attachId)
                  : null;
                if (!cachedAnnotatedUrl) {
                  cachedAnnotatedUrl = this.bulkAnnotatedImagesMap.get(localImage.imageId);
                }
                const thumbnailUrl = (cachedAnnotatedUrl && hasAnnotations) ? cachedAnnotatedUrl : freshDisplayUrl;

                this.visualPhotos[key][existingPhotoIndex] = {
                  ...this.visualPhotos[key][existingPhotoIndex],
                  displayUrl: thumbnailUrl,         // Use annotated version for display
                  url: freshDisplayUrl,             // Original for upload
                  thumbnailUrl: thumbnailUrl,       // Use annotated version for thumbnail
                  originalUrl: freshDisplayUrl,     // Original for re-editing in annotator
                  localBlobId: localImage.localBlobId,
                  caption: localImage.caption || '',
                  Annotation: localImage.caption || '',
                  Drawings: localImage.drawings || null,
                  hasAnnotations: hasAnnotations,
                  isLocalImage: true,
                  isLocalFirst: true
                };
              }
            } catch (e) {
              this.logDebug('WARN', `Failed to refresh displayUrl for existing photo: ${e}`);
            }
            loadedPhotoIds.add(imageId);
            if (localImage.attachId) loadedPhotoIds.add(localImage.attachId);
            continue;
          }

          // Skip if already loaded by other ID
          if (loadedPhotoIds.has(imageId)) continue;
          if (localImage.attachId && loadedPhotoIds.has(localImage.attachId)) continue;

          // Get display URL
          let displayUrl = 'assets/img/photo-placeholder.svg';
          try {
            displayUrl = await this.localImageService.getDisplayUrl(localImage);
          } catch (e) {
            this.logDebug('WARN', `Failed to get displayUrl: ${e}`);
          }

          const hasAnnotations = !!localImage.drawings && localImage.drawings.length > 10;

          // ANNOTATION THUMBNAIL FIX: Use cached annotated image for thumbnail display
          // The original image URL is preserved in originalUrl for the annotator
          // But thumbnailUrl and displayUrl should show the annotated version if available
          let thumbnailUrl = displayUrl;

          // Check for cached annotated image (stored when annotations are saved)
          // NOTE: Must check BOTH attachId AND imageId because:
          // - Before sync: cached with imageId ("img_xxx")
          // - After sync: LocalImage has attachId ("12345") but cache still uses imageId
          let cachedAnnotatedUrl = localImage.attachId
            ? this.bulkAnnotatedImagesMap.get(localImage.attachId)
            : null;
          if (!cachedAnnotatedUrl) {
            cachedAnnotatedUrl = this.bulkAnnotatedImagesMap.get(localImage.imageId);
          }

          if (cachedAnnotatedUrl && hasAnnotations) {
            thumbnailUrl = cachedAnnotatedUrl;
            this.logDebug('ANNOTATED', `Using cached annotated thumbnail for ${localImage.imageId}`);
          }

          // Add photo to array
          this.visualPhotos[key].unshift({
            AttachID: localImage.attachId || localImage.imageId,
            attachId: localImage.attachId || localImage.imageId,
            id: localImage.attachId || localImage.imageId,
            imageId: localImage.imageId,
            localImageId: localImage.imageId,
            localBlobId: localImage.localBlobId,
            displayUrl: thumbnailUrl,           // Use annotated version for display
            url: displayUrl,                     // Original for upload
            thumbnailUrl: thumbnailUrl,          // Use annotated version for thumbnail
            originalUrl: displayUrl,             // Original for re-editing in annotator
            name: localImage.fileName,
            caption: localImage.caption || '',
            annotation: localImage.caption || '',
            Annotation: localImage.caption || '',
            Drawings: localImage.drawings || null,
            hasAnnotations: hasAnnotations,
            loading: false,
            uploading: false,
            queued: false,
            isSkeleton: false,
            isLocalImage: true,
            isLocalFirst: true
          });

          loadedPhotoIds.add(imageId);
          if (localImage.attachId) loadedPhotoIds.add(localImage.attachId);
          photosAddedCount++;
        }

        // Update photo count
        this.photoCountsByKey[key] = this.visualPhotos[key].length;

        // Persist photo count to Dexie
        if (field.templateId) {
          this.visualFieldRepo.setField(this.serviceId, field.category, field.templateId, {
            photoCount: this.visualPhotos[key].length
          }).catch(err => {
            this.logDebug('WARN', `Failed to save photoCount: ${err}`);
          });
        }
      }

      this.logDebug('DEXIE', `Photos populated: ${photosAddedCount} new photos added`);
    } finally {
      this.isPopulatingPhotos = false;
    }
  }

  /**
   * Convert VisualFields to organized data structure for template (MOBILE ONLY)
   */
  private convertFieldsToOrganizedData(fields: VisualField[]): void {
    // Store reference for reactive photo updates
    this.lastConvertedFields = fields;

    const comments: VisualItem[] = [];
    const limitations: VisualItem[] = [];
    const deficiencies: VisualItem[] = [];

    for (const field of fields) {
      const item: VisualItem = {
        id: field.visualId || field.tempVisualId || field.templateId,
        templateId: field.templateId,
        name: field.templateName,
        text: field.answer || field.templateText,
        originalText: field.templateText,
        type: field.kind,
        category: field.category,
        answerType: field.answerType,
        required: false,
        answer: field.answer,
        isSelected: field.isSelected,
        otherValue: field.otherValue,
        key: `${field.category}_${field.templateId}`
      };

      // Store selection state and visual record ID
      const selectionKey = `${field.category}_${field.templateId}`;
      if (field.visualId || field.tempVisualId) {
        this.visualRecordIds[selectionKey] = field.visualId || field.tempVisualId || '';
      }
      this.selectedItems[selectionKey] = field.isSelected;
      this.photoCountsByKey[selectionKey] = field.photoCount;

      // Populate dropdown options if available
      if (field.answerType === 2 && field.dropdownOptions) {
        this.visualDropdownOptions[field.templateId] = field.dropdownOptions;
      }

      switch (field.kind) {
        case 'Limitation':
          limitations.push(item);
          break;
        case 'Deficiency':
          deficiencies.push(item);
          break;
        default:
          comments.push(item);
      }
    }

    this.organizedData = { comments, limitations, deficiencies };
    this.logDebug('DEXIE', `Organized: ${comments.length} comments, ${limitations.length} limitations, ${deficiencies.length} deficiencies`);
  }

  /**
   * Refresh local state when returning to the page (MOBILE ONLY)
   * Regenerates blob URLs and restores pending captions
   */
  private async refreshLocalState(): Promise<void> {
    this.logDebug('DEXIE', 'Refreshing local state...');

    // Reload photos from Dexie to refresh blob URLs
    if (this.lastConvertedFields && this.lastConvertedFields.length > 0) {
      await this.populatePhotosFromDexie(this.lastConvertedFields);
      this.changeDetectorRef.detectChanges();
    }

    // Merge any pending captions from IndexedDB
    await this.mergePendingCaptions();

    this.logDebug('DEXIE', 'Local state refreshed');
  }

  /**
   * Merge pending captions from IndexedDB (MOBILE ONLY)
   * Restores unsaved captions after navigation
   */
  private async mergePendingCaptions(): Promise<void> {
    try {
      const allPendingCaptions = await this.indexedDb.getAllPendingCaptions();
      // Filter to only this service's captions
      const pendingCaptions = allPendingCaptions.filter(c => c.serviceId === this.serviceId);

      if (!pendingCaptions || pendingCaptions.length === 0) return;

      this.logDebug('DEXIE', `Merging ${pendingCaptions.length} pending captions`);

      for (const pending of pendingCaptions) {
        const attachId = pending.attachId;
        // Find photo by attachId and update caption
        for (const key of Object.keys(this.visualPhotos)) {
          const photos = this.visualPhotos[key];
          const photoIndex = photos.findIndex((p: any) =>
            String(p.AttachID) === attachId || p.attachId === attachId || p.imageId === attachId
          );
          if (photoIndex >= 0) {
            photos[photoIndex].caption = pending.caption || '';
            photos[photoIndex].Annotation = pending.caption || '';
            break;
          }
        }
      }

      this.changeDetectorRef.detectChanges();
    } catch (error) {
      this.logDebug('WARN', `Failed to merge pending captions: ${error}`);
    }
  }

  private async resolveActualServiceId(): Promise<void> {
    // For HUD/EFE, the route serviceId is PK_ID but we need ServiceID field
    // Query the services table to get the actual ServiceID value
    try {
      let serviceRecord: any = null;

      // Use the appropriate data service based on template type
      switch (this.config?.id) {
        case 'hud':
          serviceRecord = await this.hudData.getService(this.serviceId);
          break;
        case 'efe':
          serviceRecord = await this.efeData.getService(this.serviceId);
          break;
        case 'lbw':
          serviceRecord = await this.lbwData.getService(this.serviceId);
          break;
        case 'dte':
          serviceRecord = await this.dteData.getService(this.serviceId);
          break;
      }

      if (serviceRecord) {
        this.logDebug('SERVICE', `Service record loaded: PK_ID=${serviceRecord.PK_ID}, ServiceID=${serviceRecord.ServiceID}`);
        this.actualServiceId = String(serviceRecord.ServiceID || this.serviceId);
      } else {
        this.logDebug('WARN', 'Could not load service record, using route serviceId');
        this.actualServiceId = this.serviceId;
      }
    } catch (error) {
      this.logDebug('ERROR', `Failed to resolve actualServiceId: ${error}`);
      this.actualServiceId = this.serviceId;
    }
  }

  /**
   * Load templates and visuals using the unified dataProvider
   * This standardizes data loading across all templates (HUD, EFE, LBW, DTE)
   */
  private async loadTemplatesAndVisuals(): Promise<{ templates: any[]; visuals: any[] }> {
    if (!this.config) {
      this.logDebug('ERROR', 'loadTemplatesAndVisuals called without config');
      return { templates: [], visuals: [] };
    }

    const serviceId = this.actualServiceId || this.serviceId;
    this.logDebug('LOAD', `Loading for ${this.config.id}, serviceId=${serviceId}, category=${this.categoryName}`);

    // Use unified dataProvider for all templates - handles webapp/mobile differences internally
    // HUD loads ALL templates/visuals (single page shows everything)
    // EFE/LBW/DTE filter by category
    const isHud = this.config.id === 'hud';

    try {
      if (isHud) {
        // HUD: Load all templates and visuals (no category filter)
        this.logDebug('LOAD', 'Loading HUD templates and visuals via dataProvider...');
        const [templates, visualsResult] = await Promise.all([
          this.dataProvider.getTemplates(this.config),
          this.dataProvider.getVisuals(this.config, serviceId)
        ]);

        this.logDebug('LOAD', `HUD: ${templates?.length || 0} templates, ${visualsResult.data?.length || 0} visuals`);
        if (templates?.length > 0) {
          this.logDebug('DEBUG', `First HUD template: ${JSON.stringify({ Name: templates[0].Name, Kind: templates[0].Kind, TemplateID: templates[0].TemplateID })}`);
        }

        // Convert VisualRecord[] back to raw format for compatibility with existing code
        const visuals = visualsResult.data.map(v => this.visualRecordToRaw(v));
        return { templates: templates || [], visuals };

      } else {
        // EFE/LBW/DTE: Load templates and visuals filtered by category
        this.logDebug('LOAD', `Loading ${this.config.id.toUpperCase()} templates and visuals via dataProvider...`);
        const [templates, visualsResult] = await Promise.all([
          this.dataProvider.getTemplatesForCategory(this.config, this.categoryName),
          this.dataProvider.getVisualsForCategory(this.config, serviceId, this.categoryName)
        ]);

        this.logDebug('LOAD', `${this.config.id.toUpperCase()} (category=${this.categoryName}): ${templates?.length || 0} templates, ${visualsResult.data?.length || 0} visuals`);

        // Convert VisualRecord[] back to raw format for compatibility with existing code
        const visuals = visualsResult.data.map(v => this.visualRecordToRaw(v));
        return { templates: templates || [], visuals };
      }
    } catch (error) {
      this.logDebug('ERROR', `Failed to load templates/visuals: ${error}`);
      console.error('[CategoryDetail] loadTemplatesAndVisuals error:', error);
      return { templates: [], visuals: [] };
    }
  }

  /**
   * Convert normalized VisualRecord back to raw database format for compatibility
   */
  private visualRecordToRaw(record: any): any {
    if (!this.config) return record;
    return {
      [this.config.idFieldName]: record.id,
      [this.config.templateIdFieldName]: record.templateId,
      ServiceID: record.serviceId,
      Category: record.category,
      Name: record.name,
      Text: record.text,
      Kind: record.kind,
      Notes: record.isSelected ? '' : 'HIDDEN',
      Answers: record.answer || '',
      // Preserve any extra fields
      ...record
    };
  }

  private buildVisualRecordMap(visuals: any[]): void {
    if (!this.config) return;

    const config = this.config;
    this.logDebug('MAP', `Building visual record map from ${visuals.length} visuals`);

    // Log all visuals for debugging
    visuals.forEach((v, i) => {
      const tId = v[config.templateIdFieldName] || v.TemplateID;
      const vId = v[config.idFieldName] || v.PK_ID;
      this.logDebug('MAP', `Visual[${i}]: templateId=${tId}, visualId=${vId}, Category=${v.Category}, Name=${v.Name?.substring(0, 30)}`);
    });

    for (const visual of visuals) {
      const templateId: string | number = visual[config.templateIdFieldName] || visual.TemplateID;
      const visualId: string | number = visual[config.idFieldName] || visual.PK_ID;
      // IMPORTANT: Always use this.categoryName for consistent keys
      // The visual.Category should match this.categoryName since we filter by category
      const category: string = this.categoryName;

      if (templateId) {
        const key = `${category}_${templateId}`;
        this.visualRecordIds[key] = String(visualId);
        this.selectedItems[key] = visual.Notes !== 'HIDDEN';
        this.logDebug('MAP', `Mapped: ${key} -> visualId=${visualId}, selected=${this.selectedItems[key]}`);
      }
    }

    this.logDebug('MAP', `Built ${Object.keys(this.visualRecordIds).length} visual record mappings`);
  }

  private async loadDropdownOptions(): Promise<void> {
    if (!this.config) return;

    this.logDebug('DROPDOWN', `Loading dropdown options for category: ${this.categoryName}`);

    try {
      // Use unified dataProvider - handles webapp/mobile differences internally
      const optionsMap = await this.dataProvider.getDropdownOptions(this.config);

      optionsMap.forEach((options, templateId) => {
        // Add "None" and "Other" options if not already present
        const finalOptions = [...options];
        if (!finalOptions.includes('None')) {
          finalOptions.push('None');
        }
        if (!finalOptions.includes('Other')) {
          finalOptions.push('Other');
        }
        this.visualDropdownOptions[templateId] = finalOptions;
      });

      this.logDebug('DROPDOWN', `Loaded options for ${optionsMap.size} templates`);
    } catch (error) {
      this.logDebug('ERROR', `Failed to load dropdown options: ${error}`);
      console.error('[CategoryDetail] Error loading dropdown options:', error);
    }
  }

  private organizeItems(templates: any[], visuals: any[]): void {
    const comments: VisualItem[] = [];
    const limitations: VisualItem[] = [];
    const deficiencies: VisualItem[] = [];
    const matchedVisualIds = new Set<string>();

    // Create visual items from templates
    for (const template of templates) {
      const templateId = template.TemplateID || template.PK_ID;
      const key = `${this.categoryName}_${templateId}`;

      // Find matching visual record if exists
      const visual = visuals.find(v => {
        const vTemplateId = v[this.config!.templateIdFieldName] || v.TemplateID;
        return String(vTemplateId) === String(templateId);
      });

      // Track matched visuals
      if (visual) {
        const visualId = String(visual[this.config!.idFieldName] || visual.PK_ID);
        matchedVisualIds.add(visualId);
      }

      // Get the answer from the visual record (field is 'Answers', plural)
      const answerValue = visual?.Answers || visual?.Answer || '';

      // Determine if item is selected:
      // - If there's a visual record, it's selected (record existence = selection for AnswerType 0)
      // - For AnswerType 2 (multi-select), also check if there's an answer value
      // - If there's no visual but was previously selected in session, keep that state
      const answerType = template.AnswerType || 0;
      const hasVisualRecord = !!visual;
      const hasVisualWithAnswer = hasVisualRecord && (answerType === 0 || answerValue);
      const isSelected = hasVisualWithAnswer || this.selectedItems[key] || false;

      const item: VisualItem = {
        id: visual ? (visual[this.config!.idFieldName] || visual.PK_ID) : templateId,
        templateId: templateId,
        name: visual?.Name || template.Name || '',
        text: visual?.Text || template.Text || '',
        originalText: template.Text || '',
        type: template.Kind || 'Comment',
        category: this.categoryName,
        answerType: template.AnswerType || 0,
        required: template.Required === 1 || template.Required === true,
        answer: answerValue,
        isSelected: isSelected,
        otherValue: visual?.Notes || '',
        key: key
      };

      // Update selection state
      if (isSelected) {
        this.selectedItems[key] = true;
      }

      // Organize by type
      switch (item.type) {
        case 'Limitation':
          limitations.push(item);
          break;
        case 'Deficiency':
          deficiencies.push(item);
          break;
        default:
          comments.push(item);
      }
    }

    // Process custom visuals (those with TemplateID = 0 or unmatched)
    for (const visual of visuals) {
      const visualId = String(visual[this.config!.idFieldName] || visual.PK_ID);
      const visualCategory = visual.Category || '';
      const visualTemplateId = visual[this.config!.templateIdFieldName] || visual.TemplateID;

      // Skip if already matched to a template
      if (matchedVisualIds.has(visualId)) continue;

      // Skip if not in current category
      if (visualCategory !== this.categoryName) continue;

      // This is a custom visual (TemplateID = 0 or unmatched)
      const customItemId = `custom_${visualId}`;
      const key = `${this.categoryName}_${customItemId}`;
      const kind = visual.Kind || 'Comment';

      this.logDebug('CUSTOM', `Loading custom visual: ${visual.Name} (ID: ${visualId})`);

      const customItem: VisualItem = {
        id: customItemId,
        templateId: 0,  // Custom visuals use templateId 0
        name: visual.Name || 'Custom Item',
        text: visual.Text || visual.VisualText || '',
        originalText: visual.Text || visual.VisualText || '',
        type: kind,
        category: this.categoryName,
        answerType: 0,
        required: false,
        answer: visual.Answers || visual.Answer || '',
        isSelected: true,  // Custom visuals are always selected
        otherValue: visual.Notes || '',
        key: key
      };

      // Store visual record ID
      this.visualRecordIds[key] = visualId;
      this.selectedItems[key] = true;

      // Organize by type
      switch (kind) {
        case 'Limitation':
          limitations.push(customItem);
          break;
        case 'Deficiency':
          deficiencies.push(customItem);
          break;
        default:
          comments.push(customItem);
      }
    }

    this.organizedData = { comments, limitations, deficiencies };
    this.logDebug('ORGANIZE', `Organized: ${comments.length} comments, ${limitations.length} limitations, ${deficiencies.length} deficiencies`);

    // Restore custom options from saved answers
    this.restoreCustomOptionsFromAnswers();
  }

  /**
   * Restore custom "Other" options from saved answers
   * When user adds custom options via "Other", they're saved in the Answers field
   * but not persisted to the dropdown table. On reload, we need to add them back
   * to the dropdown options so they appear as selectable checkboxes.
   */
  private restoreCustomOptionsFromAnswers(): void {
    const allItems = [
      ...this.organizedData.comments,
      ...this.organizedData.limitations,
      ...this.organizedData.deficiencies
    ];

    for (const item of allItems) {
      // Only process multi-select items (answerType 2) with answers
      if (item.answerType !== 2 || !item.answer) continue;

      // Get the dropdown options for this template
      let options = this.visualDropdownOptions[item.templateId];
      if (!options) {
        options = [];
        this.visualDropdownOptions[item.templateId] = options;
      }

      // Parse the saved answers
      const savedAnswers = item.answer.split(',').map(a => a.trim()).filter(a => a);

      // Find answers that aren't in the current options (these are custom options)
      for (const answer of savedAnswers) {
        if (!options.includes(answer)) {
          // This is a custom option - add it before "None" and "Other"
          const noneIndex = options.indexOf('None');
          if (noneIndex > -1) {
            options.splice(noneIndex, 0, answer);
          } else {
            const otherIndex = options.indexOf('Other');
            if (otherIndex > -1) {
              options.splice(otherIndex, 0, answer);
            } else {
              options.push(answer);
            }
          }
          this.logDebug('DROPDOWN', `Restored custom option: "${answer}" for templateId ${item.templateId}`);
        }
      }
    }
  }

  private async loadPhotoCounts(): Promise<void> {
    // Load photo counts for all items that have visual records
    const visualKeys = Object.keys(this.visualRecordIds);
    this.logDebug('PHOTO', `Loading photo counts for ${visualKeys.length} visual records`);

    for (const key of visualKeys) {
      const visualId = this.visualRecordIds[key];
      if (visualId && !visualId.startsWith('temp_')) {
        try {
          const attachments = await this.dataAdapter.getAttachmentsWithConfig(this.config!, visualId);
          this.photoCountsByKey[key] = attachments.length;
          if (attachments.length > 0) {
            this.logDebug('PHOTO', `${key}: ${attachments.length} photos`);
          }
        } catch (error) {
          this.logDebug('ERROR', `Failed to load photo count for ${key}: ${error}`);
          this.photoCountsByKey[key] = 0;
        }
      }
    }

    const totalPhotos = Object.values(this.photoCountsByKey).reduce((sum, count) => sum + count, 0);
    this.logDebug('PHOTO', `Total photos loaded: ${totalPhotos}`);
  }

  /**
   * Load cached annotated images from IndexedDB for thumbnail display
   */
  private async loadCachedAnnotatedImages(): Promise<void> {
    try {
      const annotatedImages = await this.indexedDb.getAllCachedAnnotatedImagesForService(this.serviceId);
      this.bulkAnnotatedImagesMap = annotatedImages;
      this.logDebug('PHOTO', `Loaded ${annotatedImages.size} cached annotated images`);
    } catch (error) {
      this.logDebug('ERROR', `Failed to load cached annotated images: ${error}`);
      this.bulkAnnotatedImagesMap = new Map();
    }
  }

  // ==================== Search ====================

  onSearchChange(): void {
    // Debounce is handled by Angular's ngModel
    this.changeDetectorRef.detectChanges();
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.changeDetectorRef.detectChanges();
  }

  filterItems(items: VisualItem[]): VisualItem[] {
    if (!this.searchTerm) return items;

    const term = this.searchTerm.toLowerCase();
    return items.filter(item =>
      item.name.toLowerCase().includes(term) ||
      item.text.toLowerCase().includes(term)
    );
  }

  highlightText(text: string): string {
    if (!this.searchTerm || !text) return text;

    const escapedTerm = this.searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedTerm})`, 'gi');
    return text.replace(regex, '<span class="highlight">$1</span>');
  }

  // ==================== Accordion State ====================

  toggleSection(section: string): void {
    if (this.expandedSections.has(section)) {
      this.expandedSections.delete(section);
    } else {
      this.expandedSections.add(section);
    }
  }

  isSectionExpanded(section: string): boolean {
    return this.expandedSections.has(section);
  }

  // ==================== Item Selection ====================

  /**
   * Get the lookup ID for an item (handles both template and custom items)
   * Custom items (templateId 0) use their id (custom_${visualId})
   * Template items use their templateId
   */
  getItemLookupId(item: VisualItem): string | number {
    return item.templateId === 0 ? item.id : item.templateId;
  }

  isItemSelected(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.selectedItems[key] || false;
  }

  async toggleItemSelection(category: string, itemId: string | number): Promise<void> {
    const key = `${category}_${itemId}`;
    const newState = !this.selectedItems[key];
    this.selectedItems[key] = newState;

    this.logDebug('SELECT', `Item ${key} selection: ${newState}`);

    // DEXIE-FIRST (MOBILE): Persist selection state to Dexie
    if (!environment.isWeb && this.config?.features.offlineFirst) {
      const templateId = typeof itemId === 'number' ? itemId : parseInt(String(itemId), 10);
      if (!isNaN(templateId)) {
        try {
          await this.visualFieldRepo.setField(this.serviceId, category, templateId, {
            isSelected: newState
          });
          this.logDebug('SELECT', `Persisted isSelected to Dexie: ${newState}`);
        } catch (err) {
          this.logDebug('ERROR', `Failed to write selection to Dexie: ${err}`);
        }
      }
    }

    // If selecting, ensure visual record exists
    if (newState) {
      const visualId = this.visualRecordIds[key];
      if (!visualId) {
        // Create visual record
        const createdId = await this.ensureVisualRecordExists(category, itemId);
        if (createdId) {
          // Update Dexie with the visual ID
          if (!environment.isWeb && this.config?.features.offlineFirst) {
            const templateId = typeof itemId === 'number' ? itemId : parseInt(String(itemId), 10);
            if (!isNaN(templateId)) {
              const isTempId = createdId.startsWith('temp_');
              await this.visualFieldRepo.setField(this.serviceId, category, templateId, {
                visualId: isTempId ? null : createdId,
                tempVisualId: isTempId ? createdId : null
              }).catch(err => this.logDebug('ERROR', `Failed to update visualId: ${err}`));
            }
          }
        }
      }
    }

    this.changeDetectorRef.detectChanges();
  }

  isItemSaving(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.savingItems[key] || false;
  }

  // ==================== Answer Handling ====================

  async onAnswerChange(category: string, item: VisualItem): Promise<void> {
    const key = `${category}_${item.templateId}`;
    this.logDebug('ANSWER', `Answer changed for ${key}: ${item.answer}`);

    this.savingItems[key] = true;
    this.changeDetectorRef.detectChanges();

    try {
      // Update selection state based on answer
      const isSelected = !!(item.answer && item.answer.trim() !== '');
      this.selectedItems[key] = isSelected;

      // DEXIE-FIRST (MOBILE): Persist answer and selection to Dexie
      if (!environment.isWeb && this.config?.features.offlineFirst) {
        await this.visualFieldRepo.setField(this.serviceId, category, item.templateId, {
          answer: item.answer || '',
          isSelected: isSelected
        });
        this.logDebug('ANSWER', `Persisted answer to Dexie`);
      }

      // Save to backend if we have a visual record
      const visualId = this.visualRecordIds[key];
      if (visualId && !String(visualId).startsWith('temp_')) {
        await this.dataAdapter.updateVisualWithConfig(this.config!, visualId, {
          Answers: item.answer || '',
          Answer: item.answer || ''
        });
      }

    } catch (error) {
      this.logDebug('ERROR', `Failed to save answer: ${error}`);
      await this.showToast('Failed to save answer', 'danger');
    } finally {
      this.savingItems[key] = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  // ==================== Multi-Select Handling ====================

  getDropdownOptions(templateId: number): string[] {
    return this.visualDropdownOptions[templateId] || [];
  }

  isOptionSelected(item: VisualItem, option: string): boolean {
    if (!item.answer) return false;
    const selectedOptions = item.answer.split(',').map(o => o.trim());
    return selectedOptions.includes(option);
  }

  async onOptionToggle(category: string, item: VisualItem, option: string, event: any): Promise<void> {
    const isChecked = event.detail.checked;
    const itemId = this.getItemLookupId(item);
    const key = `${category}_${itemId}`;
    let selectedOptions = item.answer ? item.answer.split(',').map(o => o.trim()).filter(o => o) : [];

    console.log('[OPTION] Toggled:', option, 'Checked:', isChecked, 'for', key);

    if (isChecked) {
      // Handle "None" being mutually exclusive
      if (option === 'None') {
        selectedOptions = ['None'];
        item.otherValue = '';
      } else {
        selectedOptions = selectedOptions.filter(o => o !== 'None');
        if (!selectedOptions.includes(option)) {
          selectedOptions.push(option);
        }
      }
      // Auto-select the item when any option is checked
      this.selectedItems[key] = true;
    } else {
      selectedOptions = selectedOptions.filter(o => o !== option);
      if (option === 'Other') {
        item.otherValue = '';
      }
      // If no options remain selected and no "Other" value, deselect the item
      if (selectedOptions.length === 0 && (!item.otherValue || item.otherValue === '')) {
        this.selectedItems[key] = false;
      }
    }

    item.answer = selectedOptions.join(', ');
    this.logDebug('OPTION', `Options for ${key}: ${item.answer}`);

    // Save to backend
    await this.saveMultiSelectAnswer(item, selectedOptions.length > 0);
    this.changeDetectorRef.detectChanges();
  }

  async addMultiSelectOther(category: string, item: VisualItem): Promise<void> {
    const customValue = item.otherValue?.trim();
    if (!customValue) return;

    const itemId = this.getItemLookupId(item);
    const key = `${category}_${itemId}`;
    console.log('[OTHER] Adding custom option:', customValue, 'for', key);

    // Get current options for this template
    let options = this.visualDropdownOptions[item.templateId];
    if (!options) {
      options = [];
      this.visualDropdownOptions[item.templateId] = options;
    }

    // Parse current selections
    let selectedOptions = item.answer ? item.answer.split(',').map(o => o.trim()).filter(o => o) : [];

    // Remove "None" if adding a custom value (mutually exclusive)
    selectedOptions = selectedOptions.filter(o => o !== 'None');

    // Check if this value already exists in options
    if (options.includes(customValue)) {
      console.log(`[OTHER] Option "${customValue}" already exists`);
      // Just select it if not already selected
      if (!selectedOptions.includes(customValue)) {
        selectedOptions.push(customValue);
      }
    } else {
      // Add the custom value to options (before None and Other)
      const noneIndex = options.indexOf('None');
      if (noneIndex > -1) {
        options.splice(noneIndex, 0, customValue);
      } else {
        const otherIndex = options.indexOf('Other');
        if (otherIndex > -1) {
          options.splice(otherIndex, 0, customValue);
        } else {
          options.push(customValue);
        }
      }
      console.log(`[OTHER] Added custom option: "${customValue}"`);

      // Select the new custom value
      selectedOptions.push(customValue);
    }

    // Update the answer
    item.answer = selectedOptions.join(', ');

    // Clear the input field
    item.otherValue = '';

    // Auto-select the item
    this.selectedItems[key] = true;

    this.logDebug('OTHER', `Added custom value: ${customValue}, answer: ${item.answer}`);

    // Save to backend
    await this.saveMultiSelectAnswer(item, true);
    this.changeDetectorRef.detectChanges();
  }

  /**
   * Save multi-select answer to backend (standardized for all templates)
   * All templates use 'Answers' field (plural)
   */
  private async saveMultiSelectAnswer(item: VisualItem, isSelected: boolean): Promise<void> {
    if (!this.config) return;

    // Get the visual record ID for this item
    const itemId = this.getItemLookupId(item);
    const key = `${this.categoryName}_${itemId}`;
    let visualId = this.visualRecordIds[key];

    // DEXIE-FIRST (MOBILE): Always persist to Dexie first
    if (!environment.isWeb && this.config.features.offlineFirst) {
      const templateId = item.templateId;
      if (templateId) {
        try {
          await this.visualFieldRepo.setField(this.serviceId, this.categoryName, templateId, {
            answer: item.answer || '',
            isSelected: isSelected,
            otherValue: item.otherValue || ''
          });
          this.logDebug('SAVE', `Persisted multi-select to Dexie: ${item.answer}`);
        } catch (err) {
          this.logDebug('ERROR', `Failed to write multi-select to Dexie: ${err}`);
        }
      }
    }

    // WEBAPP: If no visual record exists, create one first
    if (!visualId && environment.isWeb) {
      this.logDebug('SAVE', `No visual record for ${key}, creating one...`);
      const createdId = await this.ensureVisualRecordExists(this.categoryName, itemId);
      if (createdId) {
        visualId = createdId;
        this.logDebug('SAVE', `Created visual record: ${visualId}`);
      } else {
        this.logDebug('ERROR', `Failed to create visual record for ${key}`);
        return;
      }
    }

    if (!visualId) {
      this.logDebug('SAVE', `No visual record for ${key}, cannot save to backend`);
      return;
    }

    // Skip temp IDs - they haven't been synced to server yet
    if (String(visualId).startsWith('temp_')) {
      this.logDebug('SAVE', `Skipping temp ID ${visualId}, will sync later`);
      return;
    }

    try {
      // Use unified dataProvider - handles webapp/mobile differences internally
      await this.dataProvider.updateVisual(this.config, String(visualId), {
        answer: item.answer || ''
      });
      this.logDebug('SAVE', `Saved Answers for ${key}: ${item.answer}`);
    } catch (error) {
      console.error('[SAVE] Failed to save answer:', error);
      await this.showToast('Failed to save selection', 'warning');
    }
  }

  // ==================== Photo Handling ====================

  getPhotosForVisual(category: string, itemId: string | number): any[] {
    const key = `${category}_${itemId}`;
    return this.visualPhotos[key] || [];
  }

  getTotalPhotoCount(category: string, itemId: string | number): number {
    const key = `${category}_${itemId}`;
    return this.photoCountsByKey[key] || this.getPhotosForVisual(category, itemId).length;
  }

  isPhotosExpanded(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.expandedPhotos[key] || false;
  }

  togglePhotoExpansion(category: string, itemId: string | number): void {
    const key = `${category}_${itemId}`;
    this.expandedPhotos[key] = !this.expandedPhotos[key];

    if (this.expandedPhotos[key] && !this.visualPhotos[key]) {
      this.loadPhotosForVisual(category, itemId);
    }
  }

  private async loadPhotosForVisual(category: string, itemId: string | number): Promise<void> {
    const key = `${category}_${itemId}`;
    const visualId = this.visualRecordIds[key];

    this.logDebug('PHOTO', `loadPhotosForVisual called: key=${key}, visualId=${visualId}`);

    if (!visualId || !this.config) {
      this.logDebug('PHOTO', `Skipping photo load - visualId=${visualId}, config=${!!this.config}`);
      return;
    }

    this.loadingPhotosByKey[key] = true;
    this.changeDetectorRef.detectChanges();

    try {
      const attachments = await this.dataAdapter.getAttachmentsWithConfig(this.config, visualId);
      this.logDebug('PHOTO', `Loaded ${attachments.length} attachments for visualId=${visualId}`);

      if (attachments.length > 0) {
        this.logDebug('PHOTO', `First attachment fields: ${Object.keys(attachments[0]).join(', ')}`);
        this.logDebug('PHOTO', `First attachment: Attachment=${attachments[0].Attachment?.substring(0, 50)}, S3ImageUrl=${attachments[0].S3ImageUrl?.substring(0, 50)}`);
      }

      // Process attachments with S3 URL handling
      const photos = [];
      for (const att of attachments) {
        // Try multiple possible field names for the photo URL/key
        // Note: S3 key is stored in 'Attachment' field, not 'Photo' or 'S3ImageUrl'
        const rawPhotoValue = att.Attachment || att.Photo || att.S3ImageUrl || att.ImageUrl || att.url;
        const attachId = String(att.AttachID || att.PK_ID);

        let originalUrl = rawPhotoValue || 'assets/img/photo-placeholder.svg';
        let displayUrl = originalUrl;

        // WEBAPP: Get S3 signed URL if needed
        if (this.isWeb && originalUrl && originalUrl !== 'assets/img/photo-placeholder.svg') {
          originalUrl = await this.getSignedUrlIfNeeded(rawPhotoValue);
          displayUrl = originalUrl;
        }

        // ANNOTATION FIX: Check for cached annotated thumbnail with multi-tier fallback
        const hasDrawings = !!(att.Drawings && att.Drawings.length > 10);
        let foundCachedAnnotated = false;

        if (hasDrawings) {
          // TIER 1: Check in-memory map first (fastest)
          const memCached = this.bulkAnnotatedImagesMap.get(attachId);
          if (memCached) {
            displayUrl = memCached;
            foundCachedAnnotated = true;
            this.logDebug('ANNOTATED', `Using memory-cached annotated thumbnail for ${attachId}`);
          }

          // TIER 2: Check IndexedDB cache
          if (!foundCachedAnnotated) {
            try {
              const cachedAnnotated = await this.indexedDb.getCachedAnnotatedImage(attachId);
              if (cachedAnnotated) {
                displayUrl = cachedAnnotated;
                foundCachedAnnotated = true;
                // Store in memory map for faster future lookups
                this.bulkAnnotatedImagesMap.set(attachId, cachedAnnotated);
                this.logDebug('ANNOTATED', `Using IndexedDB-cached annotated thumbnail for ${attachId}`);
              }
            } catch (e) {
              this.logDebug('WARN', `Failed to get cached annotated image: ${e}`);
            }
          }

          // TIER 3: Render annotations on-the-fly and cache
          if (!foundCachedAnnotated && originalUrl && originalUrl !== 'assets/img/photo-placeholder.svg') {
            try {
              this.logDebug('ANNOTATED', `Rendering annotations on-the-fly for ${attachId}`);
              const renderedUrl = await renderAnnotationsOnPhoto(originalUrl, att.Drawings);
              if (renderedUrl && renderedUrl !== originalUrl) {
                displayUrl = renderedUrl;
                foundCachedAnnotated = true;
                // Cache in memory map
                this.bulkAnnotatedImagesMap.set(attachId, renderedUrl);
                // Cache to IndexedDB in background (non-blocking)
                try {
                  const response = await fetch(renderedUrl);
                  const blob = await response.blob();
                  this.indexedDb.cacheAnnotatedImage(attachId, blob)
                    .then(() => this.logDebug('ANNOTATED', `Cached rendered annotation for ${attachId}`))
                    .catch(err => this.logDebug('WARN', `Failed to cache annotated image: ${err}`));
                } catch (fetchErr) {
                  this.logDebug('WARN', `Failed to cache annotated blob: ${fetchErr}`);
                }
              }
            } catch (renderErr) {
              this.logDebug('WARN', `Failed to render annotations: ${renderErr}`);
            }
          }
        }

        photos.push({
          id: att.AttachID || att.PK_ID,
          AttachID: att.AttachID || att.PK_ID,
          url: rawPhotoValue,
          originalUrl: originalUrl,
          displayUrl: displayUrl,
          thumbnailUrl: displayUrl,
          caption: att.Annotation || att.Caption || '',
          Annotation: att.Annotation || att.Caption || '',
          name: att.Name || '',
          Drawings: att.Drawings || '',
          hasAnnotations: hasDrawings,
          uploading: false,
          loading: false,
          // Include all ID fields for cache lookup (matches EFE pattern)
          imageId: attachId,
          attachId: attachId
        });
      }

      this.visualPhotos[key] = photos;
      this.photoCountsByKey[key] = photos.length;
      this.logDebug('PHOTO', `Processed ${photos.length} photos for ${key}`);
    } catch (error) {
      this.logDebug('ERROR', `Failed to load photos for ${key}: ${error}`);
      this.visualPhotos[key] = [];
    } finally {
      this.loadingPhotosByKey[key] = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * Convert S3 key or URL to a signed URL if needed
   */
  private async getSignedUrlIfNeeded(url: string): Promise<string> {
    if (!url || url === 'assets/img/photo-placeholder.svg') {
      return url;
    }

    try {
      // Check if it's an S3 key (starts with 'uploads/')
      const isS3Key = url.startsWith('uploads/');

      // Check if it's a full S3 URL
      const isFullS3Url = url.startsWith('https://') &&
                          url.includes('.s3.') &&
                          url.includes('amazonaws.com');

      if (isS3Key) {
        // S3 key like 'uploads/path/file.jpg' - get signed URL
        this.logDebug('PHOTO', `Getting signed URL for S3 key: ${url.substring(0, 50)}`);
        const signedUrl = await this.caspioService.getS3FileUrl(url);
        return signedUrl || url;
      } else if (isFullS3Url) {
        // Full S3 URL - extract key and get signed URL
        const urlObj = new URL(url);
        const s3Key = urlObj.pathname.substring(1); // Remove leading '/'
        if (s3Key && s3Key.startsWith('uploads/')) {
          this.logDebug('PHOTO', `Getting signed URL for extracted key: ${s3Key.substring(0, 50)}`);
          const signedUrl = await this.caspioService.getS3FileUrl(s3Key);
          return signedUrl || url;
        }
      }

      // Return as-is if not S3
      return url;
    } catch (error) {
      this.logDebug('WARN', `Could not get signed URL: ${error}`);
      return url;
    }
  }

  isLoadingPhotosForVisual(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.loadingPhotosByKey[key] || false;
  }

  isUploadingPhotos(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.uploadingPhotosByKey[key] || false;
  }

  getUploadingCount(category: string, itemId: string | number): number {
    const photos = this.getPhotosForVisual(category, itemId);
    return photos.filter(p => p.uploading).length;
  }

  getSkeletonArray(category: string, itemId: string | number): number[] {
    const count = this.photoCountsByKey[`${category}_${itemId}`] || 3;
    return Array(Math.min(count, 6)).fill(0);
  }

  async addPhotoFromCamera(category: string, itemId: string | number): Promise<void> {
    this.logDebug('PHOTO', `Camera capture for ${category}_${itemId}`);

    if (!this.config) {
      await this.showToast('Configuration not loaded', 'danger');
      return;
    }

    const key = `${category}_${itemId}`;

    // Get or create visual record first
    let visualId: string | null | undefined = this.visualRecordIds[key];
    if (!visualId) {
      visualId = await this.ensureVisualRecordExists(category, itemId);
      if (!visualId) {
        this.logDebug('ERROR', 'Failed to create visual record for photo');
        await this.showToast('Failed to create record for photo', 'danger');
        return;
      }
    }

    // Initialize photo array if needed
    if (!this.visualPhotos[key]) {
      this.visualPhotos[key] = [];
    }

    // Configure and call PhotoHandlerService
    const captureConfig: PhotoCaptureConfig = {
      entityType: this.config.entityType as any,
      entityId: String(visualId),
      serviceId: this.serviceId,
      category,
      itemId,
      onTempPhotoAdded: (photo: StandardPhotoEntry) => {
        this.logDebug('PHOTO', `Temp photo added: ${photo.imageId}`);
        this.visualPhotos[key].push(photo);
        this.photoCountsByKey[key] = this.visualPhotos[key].length;
        this.expandedPhotos[key] = true;
        this.changeDetectorRef.detectChanges();
      },
      onUploadComplete: (photo: StandardPhotoEntry, tempId: string) => {
        this.logDebug('PHOTO', `Upload complete: ${photo.imageId}, was: ${tempId}`);
        // Replace temp photo with uploaded photo
        const photoIndex = this.visualPhotos[key].findIndex(p =>
          p.imageId === tempId || p.AttachID === tempId || p.id === tempId
        );
        if (photoIndex >= 0) {
          this.visualPhotos[key][photoIndex] = photo;
        }
        this.changeDetectorRef.detectChanges();
      },
      onUploadFailed: (tempId: string, error: any) => {
        this.logDebug('ERROR', `Upload failed for ${tempId}: ${error}`);
        // Keep the photo but mark as failed
        const photoIndex = this.visualPhotos[key].findIndex(p =>
          p.imageId === tempId || p.AttachID === tempId || p.id === tempId
        );
        if (photoIndex >= 0) {
          this.visualPhotos[key][photoIndex].uploadFailed = true;
        }
        this.changeDetectorRef.detectChanges();
      },
      onExpandPhotos: () => {
        this.expandedPhotos[key] = true;
        this.changeDetectorRef.detectChanges();
      }
    };

    // Set guard flag to suppress liveQuery during capture
    this.isCameraCaptureInProgress = true;
    try {
      await this.photoHandler.captureFromCamera(captureConfig);
    } finally {
      this.isCameraCaptureInProgress = false;
    }
  }

  async addPhotoFromGallery(category: string, itemId: string | number): Promise<void> {
    this.logDebug('PHOTO', `Gallery select for ${category}_${itemId}`);

    if (!this.config) {
      await this.showToast('Configuration not loaded', 'danger');
      return;
    }

    const key = `${category}_${itemId}`;

    // Get or create visual record first
    let visualId: string | null | undefined = this.visualRecordIds[key];
    if (!visualId) {
      visualId = await this.ensureVisualRecordExists(category, itemId);
      if (!visualId) {
        this.logDebug('ERROR', 'Failed to create visual record for photo');
        await this.showToast('Failed to create record for photo', 'danger');
        return;
      }
    }

    // Initialize photo array if needed
    if (!this.visualPhotos[key]) {
      this.visualPhotos[key] = [];
    }

    // Configure and call PhotoHandlerService
    const captureConfig: PhotoCaptureConfig = {
      entityType: this.config.entityType as any,
      entityId: String(visualId),
      serviceId: this.serviceId,
      category,
      itemId,
      skipAnnotator: true, // Gallery photos don't go through annotator by default
      onTempPhotoAdded: (photo: StandardPhotoEntry) => {
        this.logDebug('PHOTO', `Gallery photo added: ${photo.imageId}`);
        this.visualPhotos[key].push(photo);
        this.photoCountsByKey[key] = this.visualPhotos[key].length;
        this.expandedPhotos[key] = true;
        this.changeDetectorRef.detectChanges();
      },
      onUploadComplete: (photo: StandardPhotoEntry, tempId: string) => {
        this.logDebug('PHOTO', `Gallery upload complete: ${photo.imageId}`);
        const photoIndex = this.visualPhotos[key].findIndex(p =>
          p.imageId === tempId || p.AttachID === tempId || p.id === tempId
        );
        if (photoIndex >= 0) {
          this.visualPhotos[key][photoIndex] = photo;
        }
        this.changeDetectorRef.detectChanges();
      },
      onUploadFailed: (tempId: string, error: any) => {
        this.logDebug('ERROR', `Gallery upload failed for ${tempId}: ${error}`);
        const photoIndex = this.visualPhotos[key].findIndex(p =>
          p.imageId === tempId || p.AttachID === tempId || p.id === tempId
        );
        if (photoIndex >= 0) {
          this.visualPhotos[key][photoIndex].uploadFailed = true;
        }
        this.changeDetectorRef.detectChanges();
      },
      onExpandPhotos: () => {
        this.expandedPhotos[key] = true;
        this.changeDetectorRef.detectChanges();
      }
    };

    // Set guard flag to suppress liveQuery during gallery upload
    this.isMultiImageUploadInProgress = true;
    try {
      await this.photoHandler.captureFromGallery(captureConfig);
    } finally {
      this.isMultiImageUploadInProgress = false;
    }
  }

  async viewPhoto(photo: any, category: string, itemId: string | number, event?: Event): Promise<void> {
    this.logDebug('PHOTO', `View photo: ${photo.id || photo.AttachID}`);

    if (!this.config) return;

    const key = `${category}_${itemId}`;

    // DEXIE-FIRST FIX: For LocalImage photos, refresh drawings and URL from Dexie BEFORE opening annotator
    // This is critical because:
    // 1. The photo object in visualPhotos may have stale/empty drawings
    // 2. After saving annotations, drawings are updated in Dexie but not in the in-memory photo object
    // 3. We need the FULL RESOLUTION image for the annotator, not a thumbnail
    const isLocalFirstPhoto = photo.isLocalFirst || photo.isLocalImage || photo.localImageId ||
      (photo.imageId && String(photo.imageId).startsWith('img_'));

    if (isLocalFirstPhoto && !environment.isWeb) {
      const localImageId = photo.localImageId || photo.imageId;
      this.logDebug('PHOTO', `LocalImage detected, refreshing from Dexie: ${localImageId}`);

      try {
        // Get fresh LocalImage from Dexie
        const localImage = await this.indexedDb.getLocalImage(localImageId);

        if (localImage) {
          // CRITICAL: Update photo.Drawings with fresh data from Dexie
          // This ensures annotations are shown in the editor even after page navigation
          if (localImage.drawings && localImage.drawings.length > 10) {
            photo.Drawings = localImage.drawings;
            photo.hasAnnotations = true;
            this.logDebug('PHOTO', `Loaded fresh drawings from Dexie: ${localImage.drawings.length} chars`);
          }

          // Get FULL RESOLUTION blob URL for the annotator
          // Do NOT use getDisplayUrl() as it may return a thumbnail when full-res is purged
          let fullResUrl: string | null = null;

          if (localImage.localBlobId) {
            fullResUrl = await this.localImageService.getOriginalBlobUrl(localImage.localBlobId);
            if (fullResUrl) {
              this.logDebug('PHOTO', `Got FULL RESOLUTION blob URL for annotator`);
            }
          }

          // Fallback to S3 if local blob not available
          if (!fullResUrl && localImage.remoteS3Key) {
            try {
              fullResUrl = await this.caspioService.getS3FileUrl(localImage.remoteS3Key);
              if (fullResUrl) {
                this.logDebug('PHOTO', `Got FULL RESOLUTION from S3`);
              }
            } catch (s3Err) {
              this.logDebug('WARN', `S3 fetch failed: ${s3Err}`);
            }
          }

          // Last resort: use getDisplayUrl (may be thumbnail)
          if (!fullResUrl) {
            fullResUrl = await this.localImageService.getDisplayUrl(localImage);
          }

          // Update photo URLs for the annotator
          if (fullResUrl && fullResUrl !== 'assets/img/photo-placeholder.svg') {
            photo.originalUrl = fullResUrl;  // CRITICAL: For re-editing without flattening
            photo.url = fullResUrl;
            this.logDebug('PHOTO', `Updated photo URLs from Dexie`);
          }

          // Update caption if changed
          if (localImage.caption) {
            photo.caption = localImage.caption;
            photo.Annotation = localImage.caption;
          }
        } else {
          this.logDebug('WARN', `LocalImage not found in Dexie: ${localImageId}`);
        }
      } catch (err) {
        this.logDebug('ERROR', `Failed to refresh LocalImage from Dexie: ${err}`);
      }
    }

    // Configure view photo
    const viewConfig: ViewPhotoConfig = {
      photo: photo,
      entityType: this.config.entityType as any,
      onSaveAnnotation: async (id: string, compressedDrawings: string, caption: string) => {
        this.logDebug('PHOTO', `Saving annotation for ${id}`);
        try {
          // Save annotation via adapter
          await this.dataAdapter.updateAttachmentWithConfig(this.config!, id, {
            Drawings: compressedDrawings,
            Annotation: caption
          });
          this.logDebug('PHOTO', 'Annotation saved successfully');
        } catch (error) {
          this.logDebug('ERROR', `Failed to save annotation: ${error}`);
          throw error;
        }
      },
      onUpdatePhoto: (result: ViewPhotoResult) => {
        this.logDebug('PHOTO', `Photo updated: ${result.photoId}`);
        // Update photo in local array
        const photos = this.visualPhotos[key] || [];
        const photoIndex = photos.findIndex(p =>
          (p.AttachID || p.id || p.imageId) === result.photoId
        );
        if (photoIndex >= 0) {
          photos[photoIndex].caption = result.caption;
          photos[photoIndex].Annotation = result.caption;
          photos[photoIndex].Drawings = result.compressedDrawings;
          photos[photoIndex].hasAnnotations = result.hasAnnotations;
          if (result.annotatedUrl) {
            photos[photoIndex].displayUrl = result.annotatedUrl;
            photos[photoIndex].thumbnailUrl = result.annotatedUrl;
            // Cache annotated URL in memory map for persistence
            this.bulkAnnotatedImagesMap.set(String(result.photoId), result.annotatedUrl);
            this.logDebug('ANNOTATED', `Cached annotated thumbnail for ${result.photoId}`);
          }
          this.changeDetectorRef.detectChanges();
        }
      }
    };

    await this.photoHandler.viewExistingPhoto(viewConfig);
  }

  async deletePhoto(photo: any, category: string, itemId: string | number): Promise<void> {
    const key = `${category}_${itemId}`;
    const photoId = photo.AttachID || photo.id || photo.imageId;
    this.logDebug('PHOTO', `Delete photo: ${photoId}`);

    // Confirm deletion - styled to match app theme
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
      try {
        // Remove from API if it has a real ID
        if (photoId && !String(photoId).startsWith('temp_') && !String(photoId).startsWith('uploading_')) {
          await this.dataAdapter.deleteAttachmentWithConfig(this.config!, photoId);
          this.logDebug('PHOTO', `Deleted from API: ${photoId}`);
        }

        // Remove from local array
        const photos = this.visualPhotos[key] || [];
        this.visualPhotos[key] = photos.filter(p =>
          (p.AttachID || p.id || p.imageId) !== photoId
        );
        this.photoCountsByKey[key] = this.visualPhotos[key].length;
        this.changeDetectorRef.detectChanges();
      } catch (error) {
        this.logDebug('ERROR', `Delete failed: ${error}`);
        await this.showToast('Failed to delete photo', 'danger');
      }
    }
  }

  async openCaptionPopup(photo: any, category: string, itemId: string | number): Promise<void> {
    // Prevent multiple simultaneous popups
    if (this.isCaptionPopupOpen) {
      return;
    }

    this.isCaptionPopupOpen = true;
    const photoId = photo.AttachID || photo.id || photo.imageId;
    this.logDebug('CAPTION', `Edit caption for photo: ${photoId}`);

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
              photo.Annotation = newCaption;

              // Update in visualPhotos array
              const key = `${category}_${itemId}`;
              const photos = this.visualPhotos[key] || [];
              const photoIndex = photos.findIndex((p: any) =>
                (p.AttachID || p.id || p.imageId) === photoId
              );
              if (photoIndex >= 0) {
                photos[photoIndex].caption = newCaption;
                photos[photoIndex].Annotation = newCaption;
              }

              this.changeDetectorRef.detectChanges();

              // Close popup immediately (don't wait for save)
              this.isCaptionPopupOpen = false;

              // Save caption in background
              this.saveCaptionInBackground(photoId, newCaption);

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

  /**
   * Save caption in background without blocking UI
   */
  private async saveCaptionInBackground(photoId: string | number, newCaption: string): Promise<void> {
    try {
      if (photoId && !String(photoId).startsWith('temp_')) {
        await this.dataAdapter.updateAttachmentWithConfig(this.config!, String(photoId), {
          Annotation: newCaption
        });
        this.logDebug('CAPTION', 'Caption saved successfully');
      }
    } catch (error) {
      this.logDebug('ERROR', `Failed to save caption: ${error}`);
      await this.showToast('Failed to save caption', 'danger');
    }
  }

  /**
   * Ensure a visual record exists for the given item.
   * Creates one if it doesn't exist.
   */
  private async ensureVisualRecordExists(category: string, itemId: string | number): Promise<string | null> {
    const key = `${category}_${itemId}`;

    // Check if we already have a visual ID
    if (this.visualRecordIds[key]) {
      return this.visualRecordIds[key];
    }

    // Find the item to get its details
    const allItems = [
      ...this.organizedData.comments,
      ...this.organizedData.limitations,
      ...this.organizedData.deficiencies
    ];
    const item = allItems.find(i => String(i.templateId) === String(itemId));

    if (!item) {
      this.logDebug('ERROR', `Item not found for templateId: ${itemId}`);
      return null;
    }

    try {
      this.logDebug('VISUAL', `Creating visual record for ${category}_${itemId}`);

      // Create visual record using template-specific data service
      // IMPORTANT: Use actualServiceId (the ServiceID field) for HUD/EFE, not route serviceId (which is PK_ID)
      const effectiveServiceId = this.actualServiceId || this.serviceId;
      const visualData = {
        ServiceID: parseInt(effectiveServiceId, 10),
        Category: category,
        Kind: item.type,
        Name: item.name,
        Text: item.text || item.originalText || '',
        Notes: '',
        [this.config!.templateIdFieldName]: item.templateId
      };

      console.log('[CategoryDetail] Creating visual with data:', visualData);

      // Use unified dataProvider - handles webapp/mobile differences internally
      const visualRecord = {
        serviceId: effectiveServiceId,
        templateId: item.templateId,
        category: category,
        name: item.name,
        text: item.text || item.originalText || '',
        kind: item.type as 'Comment' | 'Limitation' | 'Deficiency',
        isSelected: true,
        notes: ''
      };

      const createdVisual = await this.dataProvider.createVisual(this.config!, visualRecord);

      console.log('[CategoryDetail] Create response:', createdVisual);
      // dataProvider returns normalized VisualRecord with id property
      const visualId = createdVisual?.id;
      console.log('[CategoryDetail] Extracted visualId:', visualId);

      if (visualId) {
        this.visualRecordIds[key] = String(visualId);
        this.selectedItems[key] = true;
        this.logDebug('VISUAL', `Created visual record: ${visualId}`);

        // DEXIE-FIRST (MOBILE): Persist to Dexie when visual record is created
        if (!environment.isWeb && this.config?.features.offlineFirst) {
          const templateId = typeof itemId === 'number' ? itemId : parseInt(String(itemId), 10);
          if (!isNaN(templateId)) {
            const isTempId = String(visualId).startsWith('temp_');
            try {
              await this.visualFieldRepo.setField(this.serviceId, category, templateId, {
                isSelected: true,
                visualId: isTempId ? null : String(visualId),
                tempVisualId: isTempId ? String(visualId) : null
              });
              this.logDebug('VISUAL', `Persisted visual to Dexie: ${visualId}`);
            } catch (err) {
              this.logDebug('ERROR', `Failed to persist visual to Dexie: ${err}`);
            }
          }
        }

        return String(visualId);
      }

      return null;
    } catch (error) {
      this.logDebug('ERROR', `Failed to create visual record: ${error}`);
      return null;
    }
  }

  handleImageError(event: Event, photo: any): void {
    const img = event.target as HTMLImageElement;
    img.src = 'assets/img/photo-placeholder.svg';
    photo.loading = false;
  }

  // ==================== Navigation ====================

  async openVisualDetail(category: string, item: VisualItem): Promise<void> {
    // Use getItemLookupId for consistent key lookup (handles both template and custom items)
    const lookupId = this.getItemLookupId(item);
    const visualId = this.visualRecordIds[`${category}_${lookupId}`];

    if (!visualId || !this.config) {
      this.logDebug('NAV', `Cannot navigate - no visual record for key: ${category}_${lookupId}`);
      return;
    }

    const queryParams: any = { actualServiceId: this.actualServiceId };
    queryParams[this.config.visualIdParamName] = visualId;

    // For navigation, use templateId for template items, or the visualId for custom items
    const routeParam = item.templateId !== 0 ? item.templateId : visualId;

    this.router.navigate(['visual', routeParam], {
      relativeTo: this.route,
      queryParams
    });
  }

  // ==================== Custom Visual ====================

  async addCustomVisual(category: string, type: string): Promise<void> {
    this.logDebug('CUSTOM', `Add custom ${type} for ${category}`);

    if (!this.config) {
      await this.showToast('Configuration not loaded', 'danger');
      return;
    }

    // Open the Add Custom Visual modal
    const modal = await this.modalController.create({
      component: AddCustomVisualModalComponent,
      componentProps: {
        kind: type,
        category: category
      }
    });

    await modal.present();

    const { data } = await modal.onDidDismiss();

    if (data && data.name) {
      // Get processed photos with annotation data and captions
      const processedPhotos = data.processedPhotos || [];
      const files = data.files && data.files.length > 0 ? data.files : null;

      // Create the visual with photos
      await this.createCustomVisualWithPhotos(category, type, data.name, data.description || '', files, processedPhotos);
    }
  }

  /**
   * Create a custom visual record with optional photos
   */
  private async createCustomVisualWithPhotos(
    category: string,
    kind: string,
    name: string,
    text: string,
    files: FileList | File[] | null,
    processedPhotos: any[] = []
  ): Promise<void> {
    if (!this.config) return;

    try {
      const serviceIdNum = parseInt(this.actualServiceId || this.serviceId, 10);
      if (isNaN(serviceIdNum)) {
        this.logDebug('ERROR', 'Invalid Service ID for custom visual');
        return;
      }

      // Build visual data based on template type
      const visualData: any = {
        ServiceID: serviceIdNum,
        Category: category,
        Kind: kind,
        Name: name,
        Text: text,
        Notes: '',
        TemplateID: 0  // Custom visual - no template
      };

      this.logDebug('CUSTOM', `Creating visual: ${JSON.stringify(visualData)}`);

      // Create the visual record using the appropriate data service
      let response: any;
      switch (this.config.id) {
        case 'hud':
          response = await this.hudData.createVisual(visualData);
          break;
        case 'efe':
          response = await this.efeData.createVisual(visualData);
          break;
        case 'lbw':
          response = await this.lbwData.createVisual(visualData);
          break;
        case 'dte':
          response = await this.dteData.createVisual(visualData);
          break;
        default:
          throw new Error(`Unknown template type: ${this.config.id}`);
      }

      // Extract visual ID from response
      let visualId: string | null = null;
      if (Array.isArray(response) && response.length > 0) {
        visualId = String(response[0][this.config.idFieldName] || response[0].PK_ID || response[0].id || '');
      } else if (response && typeof response === 'object') {
        if (response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
          visualId = String(response.Result[0][this.config.idFieldName] || response.Result[0].PK_ID || response.Result[0].id || '');
        } else {
          visualId = String(response[this.config.idFieldName] || response.PK_ID || response.id || '');
        }
      } else if (response) {
        visualId = String(response);
      }

      if (!visualId || visualId === 'undefined' || visualId === 'null' || visualId === '') {
        throw new Error('No visual ID returned from server');
      }

      this.logDebug('CUSTOM', `Created visual with ID: ${visualId}`);

      // Custom visuals use id format: custom_${visualId}, templateId: 0
      // This matches the format used when loading custom visuals from the database
      const customItemId = `custom_${visualId}`;
      const customItem: VisualItem = {
        id: customItemId,
        templateId: 0,  // Custom visuals always use templateId 0
        name: name,
        text: text,
        originalText: text,
        answerType: 0,
        required: false,
        type: kind,
        category: category,
        isSelected: true,
        photos: []
      };

      // Key uses custom_${visualId} to match loading pattern
      const key = `${category}_${customItemId}`;
      this.visualRecordIds[key] = String(visualId);
      this.selectedItems[key] = true;

      this.logDebug('CUSTOM', `Stored visualId in visualRecordIds: ${key} = ${visualId}`);

      // DEXIE-FIRST (MOBILE): Persist custom visual to Dexie
      if (!environment.isWeb && this.config.features.offlineFirst) {
        // Use a negative templateId for custom visuals (to avoid collision with real templates)
        const customTemplateId = -Math.abs(parseInt(visualId, 10) || Date.now());
        const isTempId = visualId.startsWith('temp_');

        try {
          await this.visualFieldRepo.setField(this.serviceId, category, customTemplateId, {
            isSelected: true,
            visualId: isTempId ? null : visualId,
            tempVisualId: isTempId ? visualId : null,
            templateName: name,
            templateText: text,
            kind: kind as 'Comment' | 'Limitation' | 'Deficiency',
            answerType: 0,
            answer: '',
            photoCount: files?.length || 0
          });
          this.logDebug('CUSTOM', `Persisted custom visual to Dexie: templateId=${customTemplateId}`);
        } catch (err) {
          this.logDebug('ERROR', `Failed to persist custom visual to Dexie: ${err}`);
        }
      }

      // Add to the appropriate section in organized data
      const sectionMap: { [key: string]: keyof OrganizedData } = {
        'Comment': 'comments',
        'Limitation': 'limitations',
        'Deficiency': 'deficiencies'
      };
      const sectionKey = sectionMap[kind] || 'comments';
      this.organizedData[sectionKey].push(customItem);  // Add to bottom of section

      // Upload photos if provided
      if (files && files.length > 0) {
        await this.uploadCustomVisualPhotos(key, visualId, files, processedPhotos);
      }

      this.changeDetectorRef.detectChanges();
      this.logDebug('CUSTOM', 'Custom visual created successfully');

    } catch (error) {
      this.logDebug('ERROR', `Failed to create custom visual: ${error}`);
      await this.showToast('Failed to create custom item', 'danger');
    }
  }

  /**
   * Upload photos for a custom visual
   * IMPORTANT: Uses originalFile (not annotated file) for upload to prevent flattening.
   * Annotations are stored separately in the Drawings field as JSON.
   */
  private async uploadCustomVisualPhotos(
    key: string,
    visualId: string,
    files: FileList | File[],
    processedPhotos: any[]
  ): Promise<void> {
    if (!this.config) return;

    // Initialize photos array
    if (!this.visualPhotos[key]) {
      this.visualPhotos[key] = [];
    }

    this.logDebug('CUSTOM', `Uploading ${files.length} photos for custom visual`);

    for (let index = 0; index < files.length; index++) {
      const photoData = processedPhotos[index] || {};
      const annotationData = photoData.annotationData || null;
      const caption = photoData.caption || '';

      // CRITICAL: Use originalFile (before annotations) for upload
      // This prevents flattening annotations onto the image
      // Annotations are stored in Drawings field as JSON, not baked into the image
      const fileToUpload = photoData.originalFile || photoData.file || files[index];
      const drawings = annotationData ? JSON.stringify(annotationData) : '';

      this.logDebug('CUSTOM', `Photo ${index + 1}: hasAnnotations=${!!annotationData}, usingOriginal=${!!photoData.originalFile}`);

      try {
        // Upload the ORIGINAL photo to S3 (not the annotated version)
        const uploadResult = await this.localImageService.uploadImageDirectToS3(
          fileToUpload,
          this.config.entityType,
          visualId,
          this.serviceId,
          caption,
          drawings
        );

        this.logDebug('CUSTOM', `Photo ${index + 1} uploaded, AttachID: ${uploadResult.attachId}`);

        // Get signed URL for the original image (for re-editing annotations)
        let originalUrl = uploadResult.s3Url;
        if (this.isWeb && uploadResult.s3Url) {
          originalUrl = await this.getSignedUrlIfNeeded(uploadResult.s3Url);
        }

        // For display: use annotated preview if available, otherwise original
        // The previewUrl from modal contains the rendered annotations for display
        let displayUrl = originalUrl;
        const hasAnnotations = !!annotationData;

        if (hasAnnotations && photoData.previewUrl) {
          // Use the annotated preview for thumbnail display
          displayUrl = photoData.previewUrl;

          // Cache the annotated image for persistence
          try {
            const response = await fetch(photoData.previewUrl);
            const blob = await response.blob();
            await this.indexedDb.cacheAnnotatedImage(String(uploadResult.attachId), blob);
            this.bulkAnnotatedImagesMap.set(String(uploadResult.attachId), photoData.previewUrl);
            this.logDebug('CUSTOM', `Cached annotated thumbnail for ${uploadResult.attachId}`);
          } catch (cacheErr) {
            this.logDebug('ERROR', `Failed to cache annotated image: ${cacheErr}`);
          }
        }

        // Add to local photos array
        this.visualPhotos[key].push({
          AttachID: uploadResult.attachId,
          id: uploadResult.attachId,
          imageId: uploadResult.attachId,
          name: `photo_${index}.jpg`,
          url: uploadResult.s3Url,
          originalUrl: originalUrl,      // Original for re-editing
          thumbnailUrl: displayUrl,      // Annotated for display
          displayUrl: displayUrl,        // Annotated for display
          caption: caption,
          Annotation: caption,
          Drawings: drawings,
          hasAnnotations: hasAnnotations,
          uploading: false,
          loading: false
        });

        this.photoCountsByKey[key] = this.visualPhotos[key].length;

      } catch (uploadError) {
        this.logDebug('ERROR', `Failed to upload photo ${index + 1}: ${uploadError}`);
      }
    }

    // Expand photos section after upload
    this.expandedPhotos[key] = true;
    this.changeDetectorRef.detectChanges();
  }

  // ==================== Debug ====================

  showDebugPanel(): void {
    this.showDebugPopup = true;
  }

  toggleDebugPopup(): void {
    this.showDebugPopup = !this.showDebugPopup;
  }

  private logDebug(type: string, message: string): void {
    if (this.config?.categoryDetailFeatures?.hasDebugPanel) {
      const now = new Date();
      const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
      this.debugLogs.unshift({ time, type, message });

      // Keep only last 100 entries
      if (this.debugLogs.length > 100) {
        this.debugLogs = this.debugLogs.slice(0, 100);
      }
    }
    console.log(`[GenericCategoryDetail] [${type}] ${message}`);
  }

  // ==================== Utilities ====================

  private async showToast(message: string, color: string = 'primary'): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      position: 'bottom',
      color
    });
    await toast.present();
  }

  private async simulateApiCall(): Promise<void> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  getSelectedCount(items: VisualItem[]): number {
    return items.filter(item => {
      const key = `${item.category}_${item.templateId}`;
      return this.selectedItems[key];
    }).length;
  }

  // ==================== TrackBy Functions ====================

  trackByItemId(index: number, item: VisualItem): string {
    return `${item.category}_${item.templateId}`;
  }

  trackByPhotoId(index: number, photo: any): string {
    return photo.id || index.toString();
  }

  trackByOption(index: number, option: string): string {
    return option;
  }
}
