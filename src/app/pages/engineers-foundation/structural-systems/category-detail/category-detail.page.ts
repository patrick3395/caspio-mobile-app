import { Component, OnInit, ChangeDetectorRef, ViewChild, ElementRef, OnDestroy, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController, AlertController, ActionSheetController, ModalController, IonContent, ViewWillEnter } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { firstValueFrom, Observable, Subscription } from 'rxjs';
import { CaspioService } from '../../../../services/caspio.service';
import { OfflineService } from '../../../../services/offline.service';
import { CameraService } from '../../../../services/camera.service';
import { ImageCompressionService } from '../../../../services/image-compression.service';
import { CacheService } from '../../../../services/cache.service';
import { EngineersFoundationDataService } from '../../engineers-foundation-data.service';
import { FabricPhotoAnnotatorComponent } from '../../../../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { BackgroundPhotoUploadService } from '../../../../services/background-photo-upload.service';
import { IndexedDbService, LocalImage } from '../../../../services/indexed-db.service';
import { BackgroundSyncService } from '../../../../services/background-sync.service';
import { OfflineTemplateService } from '../../../../services/offline-template.service';
import { LocalImageService } from '../../../../services/local-image.service';
import { compressAnnotationData, decompressAnnotationData, EMPTY_COMPRESSED_ANNOTATIONS } from '../../../../utils/annotation-utils';
import { AddCustomVisualModalComponent } from '../../../../modals/add-custom-visual-modal/add-custom-visual-modal.component';
import { db, VisualField } from '../../../../services/caspio-db';
import { VisualFieldRepoService } from '../../../../services/visual-field-repo.service';
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
  isSaving?: boolean;
  photos?: any[];
  otherValue?: string;
  key?: string;
}

@Component({
  selector: 'app-category-detail',
  templateUrl: './category-detail.page.html',
  styleUrls: ['./category-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, LazyImageDirective]
})
export class CategoryDetailPage implements OnInit, OnDestroy, ViewWillEnter, HasUnsavedChanges {
  // Debug flag - set to true for verbose logging
  private readonly DEBUG = false;
  
  // Error tracking for debug popup
  debugLogs: { time: string; type: string; message: string }[] = [];
  showDebugPopup: boolean = false;
  
  projectId: string = '';
  serviceId: string = '';
  categoryName: string = '';

  loading: boolean = true;
  searchTerm: string = '';
  expandedAccordions: string[] = ['information', 'limitations', 'deficiencies'];
  organizedData: {
    comments: VisualItem[];
    limitations: VisualItem[];
    deficiencies: VisualItem[];
  } = {
    comments: [],
    limitations: [],
    deficiencies: []
  };

  visualDropdownOptions: { [templateId: number]: string[] } = {};
  selectedItems: { [key: string]: boolean } = {};
  savingItems: { [key: string]: boolean } = {};

  // Photo storage and tracking
  visualPhotos: { [key: string]: any[] } = {};
  visualRecordIds: { [key: string]: string } = {};
  uploadingPhotosByKey: { [key: string]: boolean } = {};
  loadingPhotosByKey: { [key: string]: boolean } = {};
  photoCountsByKey: { [key: string]: number } = {};
  pendingPhotoUploads: { [key: string]: any[] } = {};
  
  // Lazy image loading - photos only load when user clicks to expand
  expandedPhotos: { [key: string]: boolean } = {};
  currentUploadContext: { category: string; itemId: string; action: string } | null = null;
  contextClearTimer: any = null;
  lockedScrollY: number = 0;
  private _loggedPhotoKeys = new Set<string>();

  // Background upload subscriptions
  private uploadSubscription?: Subscription;
  private taskSubscription?: Subscription;
  private photoSyncSubscription?: Subscription;
  private cacheInvalidationSubscription?: Subscription;
  
  // Debounce timer for cache invalidation to prevent multiple rapid reloads
  private cacheInvalidationDebounceTimer: any = null;
  private isReloadingAfterSync = false;

  // CRITICAL: Prevent concurrent loadData() calls which can cause photo loss
  private isLoadingData = false;

  // Track if we need to reload after sync completes
  private pendingSyncReload = false;
  private syncStatusSubscription?: Subscription;
  
  // Dexie liveQuery subscription for reactive LocalImages updates
  private localImagesSubscription?: Subscription;
  // Debounce timer for liveQuery updates to prevent multiple rapid change detections
  private liveQueryDebounceTimer: any = null;

  // Dexie-first: Reactive subscription to visualFields for instant page rendering
  private visualFieldsSubscription?: Subscription;
  private visualFieldsSeeded: boolean = false;
  // Dexie-first: Store fields reference for reactive photo updates
  private lastConvertedFields: VisualField[] = [];

  // Cooldown after local operations to prevent immediate reload
  private localOperationCooldown = false;
  private localOperationCooldownTimer: any = null;
  
  // Track if initial load is complete (for ionViewWillEnter)
  private initialLoadComplete: boolean = false;
  
  // Track last loaded IDs to detect when navigation requires fresh data
  private lastLoadedServiceId: string = '';
  private lastLoadedCategoryName: string = '';
  
  // Track if background photo loading is in progress (to stabilize accordion state)
  private isLoadingPhotosInBackground = false;
  // Store accordion state during background operations to prevent state reset
  private preservedAccordionState: string[] | null = null;

  // ===== BULK CACHED DATA (ONE IndexedDB read per type) =====
  // These are pre-loaded once at section load to eliminate N+1 reads
  private bulkAttachmentsMap: Map<string, any[]> = new Map();
  private bulkCachedPhotosMap: Map<string, string> = new Map();
  private bulkAnnotatedImagesMap: Map<string, string> = new Map();
  private bulkPendingPhotosMap: Map<string, any[]> = new Map();
  private bulkLocalImagesMap: Map<string, LocalImage[]> = new Map();  // NEW: LocalImages by entityId
  // US-001 FIX: Cache temp_ID -> real_ID mappings for synchronous lookup in liveQuery handler
  // Populated during initial load and when visuals sync
  private tempIdToRealIdCache: Map<string, string> = new Map();
  private bulkVisualsCache: any[] = [];
  private bulkPendingRequestsCache: any[] = [];
  
  // Guard to prevent concurrent/duplicate loadPhotosForVisual calls for the same key
  private loadingPhotoPromises: Map<string, Promise<void>> = new Map();

  // US-003 FIX: Suppress liveQuery during batch multi-image upload to prevent race conditions
  // The liveQuery subscription fires on each IndexedDB write, which can cause duplicate entries
  // when processing multiple photos in a loop. This flag suppresses change detection during batch ops.
  private isMultiImageUploadInProgress = false;
  // Separate flag for camera captures - suppresses liveQuery to prevent duplicates with annotated photos
  // Gallery uploads use liveQuery for UI updates, but camera needs manual push for annotated URLs
  private isCameraCaptureInProgress = false;
  // Track imageIds in current batch to prevent duplicates even if liveQuery fires
  private batchUploadImageIds = new Set<string>();

  // Hidden file input for camera/gallery
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  // Ion Content for scroll management
  @ViewChild(IonContent, { static: false }) content?: IonContent;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private caspioService: CaspioService,
    private toastController: ToastController,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private actionSheetController: ActionSheetController,
    private modalController: ModalController,
    private offlineService: OfflineService,
    private changeDetectorRef: ChangeDetectorRef,
    private cameraService: CameraService,
    private imageCompression: ImageCompressionService,
    private foundationData: EngineersFoundationDataService,
    private backgroundUploadService: BackgroundPhotoUploadService,
    private cache: CacheService,
    private indexedDb: IndexedDbService,
    private backgroundSync: BackgroundSyncService,
    private offlineTemplate: OfflineTemplateService,
    private localImageService: LocalImageService,
    private ngZone: NgZone,
    private visualFieldRepo: VisualFieldRepoService
  ) {
    // Set up global error handler for this page
    this.setupErrorTracking();
  }

  /**
   * Set up error tracking to capture unhandled errors
   */
  private setupErrorTracking(): void {
    // Override console.error to capture errors
    const originalError = console.error;
    console.error = (...args: any[]) => {
      this.logDebug('ERROR', args.map(a => String(a)).join(' '));
      originalError.apply(console, args);
    };
  }

  /**
   * Add entry to debug log
   */
  logDebug(type: string, message: string): void {
    const time = new Date().toLocaleTimeString();
    this.debugLogs.unshift({ time, type, message: message.substring(0, 200) });
    // Keep only last 50 entries
    if (this.debugLogs.length > 50) {
      this.debugLogs.pop();
    }
  }

  /**
   * Show debug popup with recent errors
   */
  async showDebugPanel(): Promise<void> {
    const logs = this.debugLogs.slice(0, 20).map(l => 
      `[${l.time}] ${l.type}: ${l.message}`
    ).join('\n\n');
    
    const alert = await this.alertController.create({
      header: 'Debug Log',
      message: logs || 'No debug entries yet',
      buttons: [
        {
          text: 'Clear',
          handler: () => {
            this.debugLogs = [];
          }
        },
        {
          text: 'Close',
          role: 'cancel'
        }
      ],
      cssClass: 'debug-alert'
    });
    await alert.present();
  }

  /**
   * Toggle debug popup visibility
   */
  toggleDebugPopup(): void {
    this.showDebugPopup = !this.showDebugPopup;
  }

  async ngOnInit() {
    console.time('[CategoryDetail] ngOnInit total');
    console.log('[CategoryDetail] ========== ngOnInit START ==========');

    // Check if new image system is available
    const hasNewSystem = this.indexedDb.hasNewImageSystem();
    this.logDebug('INIT', `New image system available: ${hasNewSystem}`);
    console.log('[CategoryDetail] New image system available:', hasNewSystem);

    // Defer subscription setup to after initial render for faster first paint
    // This will be called in ionViewDidEnter instead
    // this.subscribeToUploadUpdates(); -- DEFERRED

    // Get category name from route params
    this.categoryName = this.route.snapshot.params['category'];
    console.log('[CategoryDetail] Category from route:', this.categoryName);

    // Get IDs from container route using snapshot (for offline reliability)
    // Route structure: '' (Container) -> 'structural' (anonymous) -> 'category/:category' (we are here)
    // So parent?.parent gets us to the Container which has :projectId/:serviceId
    const containerParams = this.route.parent?.parent?.snapshot?.params;
    console.log('[CategoryDetail] Container params:', containerParams);

    if (containerParams) {
      this.projectId = containerParams['projectId'];
      this.serviceId = containerParams['serviceId'];
    }

    // Fallback: Try parent?.parent?.parent for different route structures
    if (!this.projectId || !this.serviceId) {
      console.log('[CategoryDetail] Trying alternate route structure...');
      const altParams = this.route.parent?.parent?.parent?.snapshot?.params;
      console.log('[CategoryDetail] Alt params:', altParams);
      if (altParams) {
        this.projectId = this.projectId || altParams['projectId'];
        this.serviceId = this.serviceId || altParams['serviceId'];
      }
    }

    console.log('[CategoryDetail] Final values - Category:', this.categoryName, 'ProjectId:', this.projectId, 'ServiceId:', this.serviceId);

    if (this.projectId && this.serviceId && this.categoryName) {
      console.log('[CategoryDetail] All params present, initializing reactive data...');

      // ===== DEXIE-FIRST: Seed templates and subscribe to reactive updates =====
      await this.initializeVisualFields();

      // NOTE: subscribeToLocalImagesChanges() is now deferred to ionViewDidEnter
      // for faster initial render - subscriptions run after UI is visible
    } else {
      console.error('[CategoryDetail] ❌ Missing required route params - cannot load data');
      console.error('[CategoryDetail] Missing: projectId=', !this.projectId, 'serviceId=', !this.serviceId, 'categoryName=', !this.categoryName);
      this.loading = false;
      this.changeDetectorRef.detectChanges();
    }

    console.log('[CategoryDetail] ========== ngOnInit END ==========');
    console.timeEnd('[CategoryDetail] ngOnInit total');

    // Also subscribe to param changes for dynamic updates
    this.route.params.subscribe(params => {
      const newCategory = params['category'];
      if (newCategory && newCategory !== this.categoryName) {
        this.categoryName = newCategory;
        console.log('[CategoryDetail] Category changed to:', this.categoryName);
        if (this.projectId && this.serviceId) {
          // Re-initialize for new category (reactive subscription will auto-update)
          this.initializeVisualFields();
        }
      }
    });

    // Mark initial load as complete
    this.initialLoadComplete = true;
  }

  /**
   * Ionic lifecycle hook - called when navigating back to this page
   * Uses smart skip logic to avoid redundant reloads while ensuring new data always appears
   */
  async ionViewWillEnter() {
    console.time('[CategoryDetail] ionViewWillEnter');

    // ===== US-001 DEBUG: ionViewWillEnter photo population flow =====
    const debugPhotoCounts: string[] = [];
    for (const [key, photos] of Object.entries(this.visualPhotos)) {
      if ((photos as any[]).length > 0) {
        debugPhotoCounts.push(`${key}: ${(photos as any[]).length} photos`);
      }
    }
    const debugMsg = `ionViewWillEnter START\n` +
      `serviceId: ${this.serviceId}\n` +
      `categoryName: ${this.categoryName}\n` +
      `initialLoadComplete: ${this.initialLoadComplete}\n` +
      `visualPhotos keys: ${Object.keys(this.visualPhotos).length}\n` +
      `Photo counts:\n${debugPhotoCounts.slice(0, 5).join('\n') || '(none)'}`;
    this.logDebug('VIEW_ENTER', debugMsg);
    // ===== END US-001 DEBUG =====

    // Set up deferred subscriptions on first entry (after initial render for faster paint)
    // This moves non-critical subscriptions out of ngOnInit
    if (!this.uploadSubscription) {
      this.subscribeToUploadUpdates();
    }
    if (!this.localImagesSubscription && this.serviceId) {
      this.subscribeToLocalImagesChanges();
    }

    // Only process if initial load is complete and we have required IDs
    if (!this.initialLoadComplete || !this.serviceId || !this.categoryName) {
      console.timeEnd('[CategoryDetail] ionViewWillEnter');
      return;
    }

    const sectionKey = `${this.serviceId}_${this.categoryName}`;

    // Check if we have data in memory and if section is dirty
    const hasDataInMemory = Object.keys(this.visualPhotos).length > 0;
    const isDirty = this.backgroundSync.isSectionDirty(sectionKey);

    // CRITICAL: Check if service/category has changed (navigating from project details to different template)
    const serviceOrCategoryChanged = this.lastLoadedServiceId !== this.serviceId ||
                                      this.lastLoadedCategoryName !== this.categoryName;

    console.log(`[CategoryDetail] ionViewWillEnter - hasData: ${hasDataInMemory}, isDirty: ${isDirty}, changed: ${serviceOrCategoryChanged}`);

    // ===== US-001 DEBUG: Decision point =====
    this.logDebug('VIEW_ENTER', `Decision: hasData=${hasDataInMemory}, isDirty=${isDirty}, changed=${serviceOrCategoryChanged}`);
    // ===== END US-001 DEBUG =====

    // Early return if data is fresh and context unchanged
    if (hasDataInMemory && !isDirty && !serviceOrCategoryChanged) {
      // SKIP FULL RELOAD but refresh local state (blob URLs, pending captions/drawings)
      // This ensures images don't disappear when navigating back to this page
      console.log('[CategoryDetail] Refreshing local images and pending captions');

      // ===== US-001 DEBUG: Before refreshLocalState =====
      this.logDebug('VIEW_ENTER', 'Calling refreshLocalState (skip full reload path)');
      // ===== END US-001 DEBUG =====

      await this.refreshLocalState();

      // DEXIE-FIRST: Always reload photos from Dexie on navigation back
      // This ensures photos persist even if blob URLs became invalid
      if (this.lastConvertedFields && this.lastConvertedFields.length > 0) {
        // ===== US-001 DEBUG: Before populatePhotosFromDexie =====
        this.logDebug('VIEW_ENTER', `Calling populatePhotosFromDexie with ${this.lastConvertedFields.length} fields`);
        // ===== END US-001 DEBUG =====

        await this.populatePhotosFromDexie(this.lastConvertedFields);

        // ===== US-001 DEBUG: After populatePhotosFromDexie =====
        const afterPhotoCounts: string[] = [];
        for (const [key, photos] of Object.entries(this.visualPhotos)) {
          if ((photos as any[]).length > 0) {
            afterPhotoCounts.push(`${key}: ${(photos as any[]).length} photos`);
          }
        }
        this.logDebug('VIEW_ENTER', `After populatePhotosFromDexie:\n${afterPhotoCounts.slice(0, 5).join('\n') || '(none)'}`);
        // ===== END US-001 DEBUG =====

        this.changeDetectorRef.detectChanges();
      }

      console.timeEnd('[CategoryDetail] ionViewWillEnter');
      return;
    }

    // ALWAYS reload if:
    // 1. First load (no data in memory)
    // 2. Section is marked dirty (data changed while away)
    // 3. Service or category has changed (navigating from project details)
    console.log('[CategoryDetail] Reloading data - section dirty, no data, or context changed');

    // ===== US-001 DEBUG: Full reload path =====
    this.logDebug('VIEW_ENTER', 'Taking FULL RELOAD path - calling loadData()');
    // ===== END US-001 DEBUG =====

    await this.loadData();
    this.backgroundSync.clearSectionDirty(sectionKey);
    console.timeEnd('[CategoryDetail] ionViewWillEnter');
  }

  /**
   * Check if there are unsaved changes (for route guard)
   * Only checks on web platform - returns true if any items are currently being saved
   */
  hasUnsavedChanges(): boolean {
    if (!environment.isWeb) return false;

    // Check if any items are currently being saved
    return Object.values(this.savingItems).some(saving => saving === true);
  }

  /**
   * Refresh local state without full reload
   * Called when navigating back to page with cached data
   * - Regenerates blob URLs for LocalImages (they may have been invalidated)
   * - Merges pending captions/drawings into photo arrays
   */
  private async refreshLocalState(): Promise<void> {
    // 1. Get all LocalImages for this service
    const localImages = await this.localImageService.getImagesForService(this.serviceId);

    // 2. Regenerate blob URLs from IndexedDB
    const urlMap = await this.localImageService.refreshBlobUrlsForImages(localImages);

    // 3. Update in-memory photo arrays with fresh URLs
    for (const [key, photos] of Object.entries(this.visualPhotos)) {
      for (const photo of photos as any[]) {
        if (photo.isLocalImage && photo.localImageId) {
          const newUrl = urlMap.get(photo.localImageId);
          if (newUrl) {
            photo.displayUrl = newUrl;
            photo.url = newUrl;
            photo.thumbnailUrl = newUrl;
          }
        }
      }
    }

    // 4. Merge any pending captions/drawings
    await this.mergePendingCaptions();

    console.log('[CategoryDetail] Local state refreshed - URLs regenerated, captions merged');
  }

  /**
   * Merge pending captions and drawings into in-memory photo arrays
   * This ensures caption/annotation edits persist through navigation
   */
  private async mergePendingCaptions(): Promise<void> {
    const pendingCaptions = await this.indexedDb.getPendingCaptions();

    if (!pendingCaptions || pendingCaptions.length === 0) return;

    // Build lookup map: attachId -> pending caption data
    const captionMap = new Map<string, { caption: string; drawings: string }>();
    for (const pc of pendingCaptions) {
      if (pc.status === 'pending' || pc.status === 'syncing') {
        captionMap.set(pc.attachId, { caption: pc.caption || '', drawings: pc.drawings || '' });
      }
    }

    // Update in-memory photos with pending captions
    for (const [key, photos] of Object.entries(this.visualPhotos)) {
      for (const photo of photos as any[]) {
        const attachId = photo.AttachID || photo.localImageId;
        const pending = captionMap.get(attachId);
        if (pending) {
          if (pending.caption !== undefined) {
            photo.caption = pending.caption;
          }
          if (pending.drawings !== undefined) {
            photo.Drawings = pending.drawings;
            photo.hasAnnotations = !!(pending.drawings && pending.drawings.length > 100);
          }
        }
      }
    }
  }

  ngOnDestroy() {
    // Clean up subscriptions - but uploads will continue in background service
    if (this.uploadSubscription) {
      this.uploadSubscription.unsubscribe();
    }
    if (this.taskSubscription) {
      this.taskSubscription.unsubscribe();
    }
    if (this.photoSyncSubscription) {
      this.photoSyncSubscription.unsubscribe();
    }
    if (this.cacheInvalidationSubscription) {
      this.cacheInvalidationSubscription.unsubscribe();
    }
    if (this.syncStatusSubscription) {
      this.syncStatusSubscription.unsubscribe();
    }
    // Clean up Dexie liveQuery subscription
    if (this.localImagesSubscription) {
      this.localImagesSubscription.unsubscribe();
    }
    // Clean up visualFields subscription
    if (this.visualFieldsSubscription) {
      this.visualFieldsSubscription.unsubscribe();
    }
    // Clear debounce timers
    if (this.cacheInvalidationDebounceTimer) {
      clearTimeout(this.cacheInvalidationDebounceTimer);
    }
    if (this.localOperationCooldownTimer) {
      clearTimeout(this.localOperationCooldownTimer);
    }
    if (this.liveQueryDebounceTimer) {
      clearTimeout(this.liveQueryDebounceTimer);
    }
    
    // NOTE: We intentionally do NOT revoke blob URLs here anymore.
    // Revoking causes images to disappear when navigating back to this page
    // because ionViewWillEnter may skip reload if data appears cached.
    // Blob URLs are now properly cleaned up when LocalImages are pruned after sync.
    // See refreshLocalState() for how we regenerate URLs on page return.

    console.log('[CATEGORY DETAIL] Component destroyed, but uploads continue in background');
  }

  // ============================================================================
  // DEXIE-FIRST: REACTIVE DATA INITIALIZATION
  // ============================================================================

  /**
   * Initialize visual fields for this category using Dexie-first architecture
   * 1. Seed templates into visualFields (if not already seeded)
   * 2. Merge existing visuals (user selections)
   * 3. Subscribe to reactive updates (liveQuery)
   */
  private async initializeVisualFields(): Promise<void> {
    console.time('[CategoryDetail] initializeVisualFields');
    console.log('[CategoryDetail] Initializing visual fields (Dexie-first)...');

    // WEBAPP MODE: Load directly from API to see synced data from mobile
    if (environment.isWeb) {
      console.log('[CategoryDetail] WEBAPP MODE: Loading data directly from API');
      await this.loadDataFromAPI();
      console.timeEnd('[CategoryDetail] initializeVisualFields');
      return;
    }

    // MOBILE MODE: Use Dexie-first pattern
    // Unsubscribe from previous subscription if category changed
    if (this.visualFieldsSubscription) {
      this.visualFieldsSubscription.unsubscribe();
      this.visualFieldsSubscription = undefined;
    }

    // Check if fields exist for this category
    const hasFields = await this.visualFieldRepo.hasFieldsForCategory(
      this.serviceId,
      this.categoryName
    );

    // DEXIE-FIRST: Load cached dropdown options (for Walls, Crawlspace, etc.)
    const cachedDropdownData = await this.indexedDb.getCachedTemplates('visual_dropdown') || [];
    console.log(`[CategoryDetail] Loaded ${cachedDropdownData.length} cached dropdown options`);

    if (!hasFields) {
      console.log('[CategoryDetail] No fields found, seeding from templates...');

      // Get templates from cache
      const templates = await this.indexedDb.getCachedTemplates('visual') || [];

      if (templates.length === 0) {
        console.warn('[CategoryDetail] No templates in cache, showing loading...');
        this.loading = true;
        this.changeDetectorRef.detectChanges();
        // Fall back to old loadData() for initial template fetch
        await this.loadData();
        console.timeEnd('[CategoryDetail] initializeVisualFields');
        return;
      }

      // Seed templates into visualFields with cached dropdown options
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

      console.log('[CategoryDetail] Seeding complete');
    } else {
      console.log('[CategoryDetail] Fields already exist, using cached data');
    }

    // DEXIE-FIRST: Populate visualDropdownOptions from cached data
    // This replaces the API call with local cache lookup
    if (cachedDropdownData.length > 0) {
      this.populateDropdownOptionsFromCache(cachedDropdownData);
    }

    // DEXIE-FIRST: Set up LocalImages subscription FIRST (before fields subscription)
    // This ensures bulkLocalImagesMap is populated when populatePhotosFromDexie() runs
    if (!this.localImagesSubscription && this.serviceId) {
      this.subscribeToLocalImagesChanges();
    }

    // Subscribe to reactive updates - this will trigger UI render
    this.visualFieldsSubscription = this.visualFieldRepo
      .getFieldsForCategory$(this.serviceId, this.categoryName)
      .subscribe({
        next: async (fields) => {
          console.log(`[CategoryDetail] Received ${fields.length} fields from liveQuery`);
          this.convertFieldsToOrganizedData(fields);

          // DEXIE-FIRST: Show UI immediately - no loading screen
          this.loading = false;
          this.changeDetectorRef.detectChanges();

          // DEXIE-FIRST: Populate photos in background (non-blocking)
          // Photos will appear as they load, no need to wait
          this.populatePhotosFromDexie(fields).then(() => {
            this.changeDetectorRef.detectChanges();
          });
        },
        error: (err) => {
          console.error('[CategoryDetail] Error in visualFields subscription:', err);
          this.loading = false;
          this.changeDetectorRef.detectChanges();
        }
      });

    // Update tracking variables
    this.lastLoadedServiceId = this.serviceId;
    this.lastLoadedCategoryName = this.categoryName;
    this.initialLoadComplete = true;

    // DEXIE-FIRST: Only fetch from API if cache was empty (fallback for first-time use)
    if (cachedDropdownData.length === 0) {
      console.log('[CategoryDetail] No cached dropdown options, fetching from API as fallback...');
      await this.loadDropdownOptionsFromAPI();
    } else {
      console.log('[CategoryDetail] Using cached dropdown options (Dexie-first)');
    }

    console.timeEnd('[CategoryDetail] initializeVisualFields');
  }

  /**
   * WEBAPP MODE: Load data directly from API to see synced data from mobile
   * This bypasses all local Dexie caching and reads fresh from the server
   */
  private async loadDataFromAPI(): Promise<void> {
    console.log('[CategoryDetail] WEBAPP MODE: loadDataFromAPI() starting...');
    this.loading = true;
    this.changeDetectorRef.detectChanges();

    try {
      // Load templates and visuals from API (via foundationData which now fetches from server in webapp mode)
      const [templates, visuals] = await Promise.all([
        this.foundationData.getVisualsTemplates(),
        this.foundationData.getVisualsByService(this.serviceId)
      ]);

      console.log(`[CategoryDetail] WEBAPP: Loaded ${templates?.length || 0} templates, ${visuals?.length || 0} visuals from API`);

      // Debug: Log first visual's field names to verify structure
      if (visuals && visuals.length > 0) {
        const sampleVisual = visuals[0];
        console.log('[CategoryDetail] WEBAPP: Sample visual fields:', Object.keys(sampleVisual));
        console.log('[CategoryDetail] WEBAPP: Sample visual:', {
          VisualID: sampleVisual.VisualID,
          VisualTemplateID: sampleVisual.VisualTemplateID,
          TemplateID: sampleVisual.TemplateID,
          Name: sampleVisual.Name,
          Category: sampleVisual.Category,
          Kind: sampleVisual.Kind
        });
      }

      // Filter visuals for this category to get accurate count
      const categoryVisuals = (visuals || []).filter((v: any) => v.Category === this.categoryName);
      console.log(`[CategoryDetail] WEBAPP: ${categoryVisuals.length} visuals for category "${this.categoryName}"`);

      // Filter templates for this category
      const categoryTemplates = (templates || []).filter((t: any) => t.Category === this.categoryName);
      console.log(`[CategoryDetail] WEBAPP: ${categoryTemplates.length} templates for category "${this.categoryName}"`);

      // Build organized data from templates and visuals
      const organizedData: { comments: VisualItem[]; limitations: VisualItem[]; deficiencies: VisualItem[] } = {
        comments: [],
        limitations: [],
        deficiencies: []
      };

      for (const template of categoryTemplates) {
        const templateId = template.TemplateID || template.PK_ID;
        const kind = (template.Kind || 'Comment').toLowerCase();
        const templateName = template.Name || '';

        // Find matching visual (user selection) from server
        // CRITICAL: Match by TemplateID first (most reliable), with type coercion for number/string mismatches
        // Then fall back to name+category matching
        let visual = (visuals || []).find((v: any) => {
          const vTemplateId = v.VisualTemplateID || v.TemplateID;
          // Use == for type coercion (templateId may be number or string)
          return vTemplateId == templateId && v.Category === this.categoryName;
        });

        // Fallback: match by name + category if templateId didn't match
        if (!visual && templateName) {
          visual = (visuals || []).find((v: any) =>
            v.Name === templateName && v.Category === this.categoryName
          );
          if (visual) {
            console.log(`[CategoryDetail] WEBAPP: Matched visual by name fallback: "${templateName}"`);
          }
        }

        // WEBAPP: Use key format that matches isItemSelected() and getPhotosForVisual()
        // These methods use `${category}_${itemId}` format (no serviceId)
        const itemKey = `${this.categoryName}_${templateId}`;

        const item: VisualItem = {
          id: visual ? (visual.VisualID || visual.PK_ID) : templateId,
          templateId: templateId,
          name: template.Name || '',
          text: visual?.VisualText || visual?.Text || template.Text || '',
          originalText: template.Text || '',
          type: template.Kind || 'Comment',
          category: template.Category || this.categoryName,
          answerType: template.AnswerType || 0,
          required: false,
          answer: visual?.Answer || '',
          isSelected: !!visual,
          key: itemKey
        };

        // Add to appropriate section
        if (kind === 'limitation') {
          organizedData.limitations.push(item);
        } else if (kind === 'deficiency') {
          organizedData.deficiencies.push(item);
        } else {
          organizedData.comments.push(item);
        }

        // Track visual record IDs and selection state for photo loading
        if (visual) {
          const visualId = visual.VisualID || visual.PK_ID;
          this.visualRecordIds[itemKey] = String(visualId);
          // WEBAPP: Populate selectedItems so isItemSelected() returns true
          this.selectedItems[itemKey] = true;
        }
      }

      this.organizedData = organizedData;

      // Count how many items are selected (matched to visuals)
      const selectedCount = [...organizedData.comments, ...organizedData.limitations, ...organizedData.deficiencies]
        .filter(item => item.isSelected).length;
      console.log(`[CategoryDetail] WEBAPP: Organized data - ${organizedData.comments.length} comments, ${organizedData.limitations.length} limitations, ${organizedData.deficiencies.length} deficiencies`);
      console.log(`[CategoryDetail] WEBAPP: ${selectedCount} items matched to visuals (should match ${categoryVisuals.length} visuals for this category)`);

      // Load photos for selected visuals from API
      await this.loadPhotosFromAPI();

      // Load dropdown options
      await this.loadDropdownOptionsFromAPI();

      // Update tracking variables
      this.lastLoadedServiceId = this.serviceId;
      this.lastLoadedCategoryName = this.categoryName;
      this.initialLoadComplete = true;

    } catch (error) {
      console.error('[CategoryDetail] WEBAPP: Error loading data from API:', error);
    } finally {
      this.loading = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * WEBAPP MODE: Load photos from API for all selected visuals
   */
  private async loadPhotosFromAPI(): Promise<void> {
    console.log('[CategoryDetail] WEBAPP MODE: Loading photos from API...');

    // Get all visual IDs that have been selected
    const allItems = [
      ...this.organizedData.comments,
      ...this.organizedData.limitations,
      ...this.organizedData.deficiencies
    ];

    for (const item of allItems) {
      if (!item.isSelected || !item.key) continue;

      const visualId = this.visualRecordIds[item.key];
      if (!visualId) continue;

      try {
        const attachments = await this.foundationData.getVisualAttachments(visualId);
        console.log(`[CategoryDetail] WEBAPP: Loaded ${attachments?.length || 0} photos for visual ${visualId}`);

        // Convert attachments to photo format
        const photos: any[] = [];
        for (const att of attachments || []) {
          // Debug: Log attachment fields to identify correct photo field
          if (attachments.length > 0 && photos.length === 0) {
            console.log('[CategoryDetail] WEBAPP: Attachment fields:', Object.keys(att));
            console.log('[CategoryDetail] WEBAPP: Sample attachment:', JSON.stringify(att).substring(0, 500));
          }

          // Try multiple possible field names for the photo URL/key
          // Note: S3 key is stored in 'Attachment' field, not 'Photo'
          const rawPhotoValue = att.Attachment || att.Photo || att.photo || att.url || att.displayUrl || att.URL || att.S3Key || att.s3Key;
          console.log('[CategoryDetail] WEBAPP: Raw photo value for attach', att.AttachID || att.PK_ID, ':', rawPhotoValue?.substring(0, 100));

          let displayUrl = rawPhotoValue || 'assets/img/photo-placeholder.png';

          // WEBAPP: Get S3 signed URL if needed
          // Check for S3 key (starts with 'uploads/') OR full S3 URL
          if (displayUrl && displayUrl !== 'assets/img/photo-placeholder.png') {
            const isS3Key = this.caspioService.isS3Key && this.caspioService.isS3Key(displayUrl);
            const isFullS3Url = displayUrl.startsWith('https://') &&
                                displayUrl.includes('.s3.') &&
                                displayUrl.includes('amazonaws.com');

            console.log('[CategoryDetail] WEBAPP: URL analysis - isS3Key:', isS3Key, 'isFullS3Url:', isFullS3Url);

            if (isS3Key) {
              // S3 key like 'uploads/path/file.jpg' - get signed URL
              try {
                console.log('[CategoryDetail] WEBAPP: Getting signed URL for S3 key:', displayUrl);
                displayUrl = await this.caspioService.getS3FileUrl(displayUrl);
                console.log('[CategoryDetail] WEBAPP: Got signed URL:', displayUrl?.substring(0, 80));
              } catch (e) {
                console.warn('[CategoryDetail] WEBAPP: Could not get S3 URL for key:', e);
              }
            } else if (isFullS3Url) {
              // Full S3 URL - extract key and get signed URL
              try {
                // Extract S3 key from URL: https://bucket.s3.region.amazonaws.com/uploads/path/file.jpg
                const urlObj = new URL(displayUrl);
                const s3Key = urlObj.pathname.substring(1); // Remove leading '/'
                console.log('[CategoryDetail] WEBAPP: Extracted S3 key from URL:', s3Key);
                if (s3Key && s3Key.startsWith('uploads/')) {
                  displayUrl = await this.caspioService.getS3FileUrl(s3Key);
                  console.log('[CategoryDetail] WEBAPP: Got signed URL:', displayUrl?.substring(0, 80));
                } else {
                  console.warn('[CategoryDetail] WEBAPP: S3 URL does not have uploads/ key:', s3Key);
                }
              } catch (e) {
                console.warn('[CategoryDetail] WEBAPP: Could not get signed URL for S3 URL:', e);
              }
            } else {
              console.log('[CategoryDetail] WEBAPP: URL not recognized as S3, using as-is');
            }
          }

          const attachId = att.AttachID || att.attachId || att.PK_ID;
          photos.push({
            id: attachId,
            attachId: attachId,
            AttachID: attachId, // Also set capital version for error handler
            displayUrl,
            url: displayUrl,
            caption: att.Annotation || att.caption || '',
            uploading: false,
            isLocal: false,
            hasAnnotations: !!(att.Drawings && att.Drawings.length > 10),
            drawings: att.Drawings || ''
          });
        }

        this.visualPhotos[item.key] = photos;
        this.photoCountsByKey[item.key] = photos.length;
      } catch (error) {
        console.error(`[CategoryDetail] WEBAPP: Error loading photos for visual ${visualId}:`, error);
      }
    }

    this.changeDetectorRef.detectChanges();
  }

  /**
   * DEXIE-FIRST: Populate dropdown options from cached data
   * This enables instant loading of multi-select options without API call
   */
  private populateDropdownOptionsFromCache(dropdownData: any[]): void {
    console.log('[CategoryDetail] Populating dropdown options from cache...');

    // Group dropdown options by TemplateID
    dropdownData.forEach((row: any) => {
      const templateId = row.TemplateID;
      const dropdownValue = row.Dropdown;

      if (templateId && dropdownValue) {
        if (!this.visualDropdownOptions[templateId]) {
          this.visualDropdownOptions[templateId] = [];
        }
        // Add unique dropdown values for this template
        if (!this.visualDropdownOptions[templateId].includes(dropdownValue)) {
          this.visualDropdownOptions[templateId].push(dropdownValue);
        }
      }
    });

    // Add "Other" option to all multi-select dropdowns
    Object.keys(this.visualDropdownOptions).forEach(templateId => {
      const options = this.visualDropdownOptions[Number(templateId)];
      if (options && !options.includes('Other')) {
        options.push('Other');
      }
    });

    console.log('[CategoryDetail] Populated dropdown options for', Object.keys(this.visualDropdownOptions).length, 'templates from cache');

    // Trigger change detection to update UI
    this.changeDetectorRef.detectChanges();
  }

  /**
   * Load dropdown options from LPS_Services_Visuals_Drop table (API fallback)
   * Only called when cached data is not available
   * These are stored separately from templates and need to be fetched and matched by TemplateID
   */
  private async loadDropdownOptionsFromAPI(): Promise<void> {
    try {
      console.log('[CategoryDetail] Loading dropdown options from API (fallback)...');
      const dropdownData = await this.caspioService.getServicesVisualsDrop().toPromise();

      if (dropdownData && dropdownData.length > 0) {
        // Cache the dropdown data for future use
        await this.indexedDb.cacheTemplates('visual_dropdown', dropdownData);
        console.log('[CategoryDetail] Cached dropdown options for future use');

        // Group dropdown options by TemplateID
        dropdownData.forEach((row: any) => {
          const templateId = row.TemplateID; // Keep as number for consistency with field.templateId
          const dropdownValue = row.Dropdown;

          if (templateId && dropdownValue) {
            if (!this.visualDropdownOptions[templateId]) {
              this.visualDropdownOptions[templateId] = [];
            }
            // Add unique dropdown values for this template
            if (!this.visualDropdownOptions[templateId].includes(dropdownValue)) {
              this.visualDropdownOptions[templateId].push(dropdownValue);
            }
          }
        });

        // Add "Other" option to all multi-select dropdowns
        Object.keys(this.visualDropdownOptions).forEach(templateId => {
          const options = this.visualDropdownOptions[Number(templateId)];
          if (options && !options.includes('Other')) {
            options.push('Other');
          }
        });

        console.log('[CategoryDetail] Loaded dropdown options for', Object.keys(this.visualDropdownOptions).length, 'templates');

        // Trigger change detection to update UI
        this.changeDetectorRef.detectChanges();
      } else {
        console.warn('[CategoryDetail] No dropdown data received from API');
      }
    } catch (error) {
      console.error('[CategoryDetail] Error loading dropdown options:', error);
    }
  }

  /**
   * Convert VisualField[] from Dexie to organizedData structure for rendering
   * This transforms the flat field list into categorized sections
   */
  private convertFieldsToOrganizedData(fields: VisualField[]): void {
    // DEXIE-FIRST: Store fields reference for reactive photo updates
    this.lastConvertedFields = fields;

    // Reset organized data
    this.organizedData = {
      comments: [],
      limitations: [],
      deficiencies: []
    };
    this.selectedItems = {};

    // Convert each field to VisualItem and add to appropriate section
    for (const field of fields) {
      const item: VisualItem = {
        id: field.visualId || field.tempVisualId || field.templateId,
        templateId: field.templateId,
        name: field.templateName,
        text: field.templateText,
        originalText: field.templateText,
        type: field.kind,
        category: field.category,
        answerType: field.answerType,
        required: false,
        answer: field.answer,
        isSelected: field.isSelected,
        photos: [],
        otherValue: field.otherValue,
        key: field.key
      };

      // Store dropdown options (from Dexie if available)
      if (field.dropdownOptions) {
        this.visualDropdownOptions[field.templateId] = field.dropdownOptions;
      }

      // Add to appropriate section
      if (field.kind === 'Comment') {
        this.organizedData.comments.push(item);
      } else if (field.kind === 'Limitation') {
        this.organizedData.limitations.push(item);
      } else if (field.kind === 'Deficiency') {
        this.organizedData.deficiencies.push(item);
      }

      // Track selection state
      const selectionKey = `${field.category}_${field.templateId}`;
      this.selectedItems[selectionKey] = field.isSelected;

      // Set photo count (will be updated by photo loading)
      this.photoCountsByKey[selectionKey] = field.photoCount;
    }

    console.log(`[CategoryDetail] Organized: ${this.organizedData.comments.length} comments, ${this.organizedData.limitations.length} limitations, ${this.organizedData.deficiencies.length} deficiencies`);
  }

  /**
   * DEXIE-FIRST: Populate visualPhotos by querying Dexie LocalImages directly
   * This eliminates the race condition by not relying on bulkLocalImagesMap subscription
   * Called after convertFieldsToOrganizedData to render photos from Dexie data
   */
  private async populatePhotosFromDexie(fields: VisualField[]): Promise<void> {
    console.log('[DEXIE-FIRST] Populating photos directly from Dexie...');

    // ===== US-001 DEBUG: populatePhotosFromDexie start =====
    this.logDebug('DEXIE_LOAD', `populatePhotosFromDexie START\nfields count: ${fields.length}\nserviceId: ${this.serviceId}`);
    // ===== END US-001 DEBUG =====

    // DEXIE-FIRST: Load annotated images in background (non-blocking)
    // Don't await - let photos render immediately, annotations will update when ready
    if (this.bulkAnnotatedImagesMap.size === 0) {
      this.indexedDb.getAllCachedAnnotatedImagesForService().then(annotatedImages => {
        this.bulkAnnotatedImagesMap = annotatedImages;
        // Trigger change detection to update any thumbnails that now have annotations
        this.changeDetectorRef.detectChanges();
      });
    }

    // DIRECT DEXIE QUERY: Get ALL LocalImages for this service in one query
    // This eliminates the race condition - we don't rely on bulkLocalImagesMap being populated
    const allLocalImages = await this.localImageService.getImagesForService(this.serviceId);

    // ===== US-001 DEBUG: LocalImages query result =====
    const localImagesWithDrawings = allLocalImages.filter(img => img.drawings && img.drawings.length > 10);
    this.logDebug('DEXIE_LOAD', `LocalImages query:\nTotal: ${allLocalImages.length}\nWith drawings (annotations): ${localImagesWithDrawings.length}`);
    // ===== END US-001 DEBUG =====

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

    console.log(`[DEXIE-FIRST] Found ${allLocalImages.length} LocalImages for ${localImagesMap.size} entities`);

    let photosAddedCount = 0;

    for (const field of fields) {
      // US-002 FIX: Get both real and temp IDs for fallback lookup
      const realId = field.visualId;
      const tempId = field.tempVisualId;
      const visualId = realId || tempId;
      if (!visualId) continue;

      const key = `${field.category}_${field.templateId}`;

      // Store visual record ID for photo operations
      this.visualRecordIds[key] = visualId;

      // US-002 FIX: Lookup by real ID first, fallback to temp ID, then check temp-to-real mapping
      // After sync, LocalImages.entityId is updated to real ID but VisualField may still have tempId
      let localImages = realId ? (localImagesMap.get(realId) || []) : [];
      const foundWithRealId = localImages.length;
      let foundWithTempId = 0;
      let foundWithMappedId = 0;
      let mappedRealId: string | null = null;

      // Try tempId lookup
      if (localImages.length === 0 && tempId && tempId !== realId) {
        localImages = localImagesMap.get(tempId) || [];
        foundWithTempId = localImages.length;
      }

      // US-002 FIX: If still no photos and we have tempId, check IndexedDB for temp-to-real mapping
      // This handles the case where sync updated LocalImages.entityId to real ID but VisualField
      // was never updated (e.g., user reloaded page after sync)
      if (localImages.length === 0 && tempId) {
        mappedRealId = await this.indexedDb.getRealId(tempId);
        if (mappedRealId) {
          localImages = localImagesMap.get(mappedRealId) || [];
          foundWithMappedId = localImages.length;

          // Also update VisualField with the real ID so future lookups work directly
          if (localImages.length > 0 && field.templateId) {
            this.visualFieldRepo.setField(this.serviceId, this.categoryName, field.templateId, {
              visualId: mappedRealId,
              tempVisualId: null
            }).catch(err => {
              console.error('[US-002] Failed to update VisualField with mapped realId:', err);
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

        // ===== US-002 FIX: Check if photo already exists and refresh its displayUrl =====
        // This ensures displayUrl always points to a fresh local blob from LocalImages
        const existingPhotoIndex = this.visualPhotos[key].findIndex(p =>
          p.imageId === imageId ||
          p.localImageId === imageId ||
          (localImage.attachId && (String(p.AttachID) === localImage.attachId || p.attachId === localImage.attachId))
        );

        if (existingPhotoIndex !== -1) {
          // Photo already exists - REFRESH its displayUrl from LocalImages (DEXIE-FIRST)
          const existingPhoto = this.visualPhotos[key][existingPhotoIndex];

          // DEXIE-FIRST: Always refresh displayUrl from LocalImages table (local blob)
          // This ensures we NEVER use stale cached URLs or server URLs
          try {
            const freshDisplayUrl = await this.localImageService.getDisplayUrl(localImage);
            if (freshDisplayUrl && freshDisplayUrl !== 'assets/img/photo-placeholder.png') {
              // ANNOTATION FIX: Check for cached annotated image for thumbnail display
              const hasAnnotations = !!(localImage.drawings && localImage.drawings.length > 10) || existingPhoto.hasAnnotations;
              let thumbnailUrl = freshDisplayUrl;
              if (hasAnnotations) {
                const cachedAnnotatedImage = this.bulkAnnotatedImagesMap.get(imageId);
                if (cachedAnnotatedImage) {
                  thumbnailUrl = cachedAnnotatedImage;
                }
              }

              // Update displayUrl to fresh local blob (or annotated for thumbnail)
              this.visualPhotos[key][existingPhotoIndex] = {
                ...existingPhoto,
                displayUrl: thumbnailUrl,  // Use annotated if available
                url: freshDisplayUrl,      // Keep original for re-editing
                thumbnailUrl: thumbnailUrl,
                originalUrl: freshDisplayUrl,
                // Update metadata that may have changed
                localBlobId: localImage.localBlobId,
                caption: localImage.caption || existingPhoto.caption || '',
                Annotation: localImage.caption || existingPhoto.Annotation || '',
                Drawings: localImage.drawings || existingPhoto.Drawings || null,
                hasAnnotations: hasAnnotations,
                isLocalImage: true,
                isLocalFirst: true
              };

            }
          } catch (e) {
            console.warn('[DEXIE-FIRST] Failed to refresh displayUrl for existing photo:', e);
          }

          // Track IDs to prevent duplicates
          loadedPhotoIds.add(imageId);
          if (localImage.attachId) loadedPhotoIds.add(localImage.attachId);
          continue; // Don't add duplicate
        }

        // Skip if already loaded by other ID (safety check)
        if (loadedPhotoIds.has(imageId)) continue;
        if (localImage.attachId && loadedPhotoIds.has(localImage.attachId)) continue;

        // Get display URL from LocalImageService (original photo)
        let displayUrl = 'assets/img/photo-placeholder.png';
        try {
          displayUrl = await this.localImageService.getDisplayUrl(localImage);
        } catch (e) {
          console.warn('[DEXIE-FIRST] Failed to get displayUrl:', e);
        }

        // ANNOTATION FIX: Check for cached annotated image for thumbnail display
        // The annotated image is cached separately when user adds annotations
        // We use it for displayUrl/thumbnailUrl while keeping originalUrl as the base image
        let thumbnailUrl = displayUrl;
        const hasAnnotations = !!localImage.drawings && localImage.drawings.length > 10;
        if (hasAnnotations) {
          const cachedAnnotatedImage = this.bulkAnnotatedImagesMap.get(imageId);
          if (cachedAnnotatedImage) {
            thumbnailUrl = cachedAnnotatedImage;
            console.log(`[DEXIE-FIRST] Using cached annotated image for thumbnail: ${imageId}`);
          }
        }

        // Add photo to array
        this.visualPhotos[key].unshift({
          AttachID: localImage.attachId || localImage.imageId,
          attachId: localImage.attachId || localImage.imageId,
          id: localImage.attachId || localImage.imageId,
          imageId: localImage.imageId,
          localImageId: localImage.imageId,
          localBlobId: localImage.localBlobId,
          displayUrl: thumbnailUrl,  // Use annotated thumbnail if available
          url: displayUrl,           // Original photo URL
          thumbnailUrl: thumbnailUrl,
          originalUrl: displayUrl,   // Always keep original for re-editing
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
    }

    // ===== US-001/US-003 DEBUG: populatePhotosFromDexie complete =====
    const photosWithAnnotations = Object.values(this.visualPhotos)
      .flat()
      .filter((p: any) => p.hasAnnotations || (p.Drawings && p.Drawings.length > 10));
    // US-003: Count photos with data: URLs (indicates cached annotated images loaded)
    const photosWithDataUrls = Object.values(this.visualPhotos)
      .flat()
      .filter((p: any) => p.displayUrl?.startsWith('data:'));
    const debugSummary = `populatePhotosFromDexie COMPLETE\n` +
      `Photos added: ${photosAddedCount}\n` +
      `Total photos in visualPhotos: ${Object.values(this.visualPhotos).flat().length}\n` +
      `Photos with annotations: ${photosWithAnnotations.length}\n` +
      `Photos with data: URLs (US-003): ${photosWithDataUrls.length}\n` +
      `Keys with photos: ${Object.entries(this.visualPhotos).filter(([k, v]) => (v as any[]).length > 0).map(([k, v]) => `${k}:${(v as any[]).length}`).slice(0, 5).join(', ')}`;
    this.logDebug('DEXIE_LOAD', debugSummary);
    // ===== END US-001/US-003 DEBUG =====

    console.log('[DEXIE-FIRST] Photos populated directly from Dexie');
  }

  /**
   * Start a cooldown period during which cache invalidation events are ignored.
   * This prevents UI "flashing" when selecting items or uploading photos.
   */
  private startLocalOperationCooldown() {
    // Clear any existing timers
    if (this.localOperationCooldownTimer) {
      clearTimeout(this.localOperationCooldownTimer);
    }
    
    // CRITICAL: Also clear any pending debounce timer to prevent delayed reloads
    if (this.cacheInvalidationDebounceTimer) {
      clearTimeout(this.cacheInvalidationDebounceTimer);
      this.cacheInvalidationDebounceTimer = null;
    }
    
    this.localOperationCooldown = true;
    
    // Cooldown lasts 3 seconds - enough time for sync to complete
    this.localOperationCooldownTimer = setTimeout(() => {
      this.localOperationCooldown = false;
      console.log('[COOLDOWN] Local operation cooldown ended');
    }, 3000);
  }

  /**
   * Subscribe to background upload updates
   * This allows the UI to update as photos upload, even if user navigates away and comes back
   */
  private subscribeToUploadUpdates() {
    this.taskSubscription = this.backgroundUploadService.getTaskUpdates().subscribe(task => {
      if (!task) return;

      console.log('[UPLOAD UPDATE] Task:', task.id, 'Status:', task.status, 'Progress:', task.progress);

      // Update the photo in our UI based on task status
      const key = task.key;
      const tempPhotoId = task.tempPhotoId;

      if (!this.visualPhotos[key]) return;

      const photoIndex = this.visualPhotos[key].findIndex(p =>
        p.AttachID === tempPhotoId || p.id === tempPhotoId
      );

      if (photoIndex === -1) return;

      if (task.status === 'uploading') {
        // Update progress
        this.visualPhotos[key][photoIndex].uploading = true;
        this.visualPhotos[key][photoIndex].progress = task.progress;
      } else if (task.status === 'completed') {
        // Upload completed - get result from task
        const result = (task as any).result;
        if (result && result.AttachID) {
          this.updatePhotoAfterUpload(key, photoIndex, result, task.caption);
        }
      } else if (task.status === 'failed') {
        // Upload failed
        this.visualPhotos[key][photoIndex].uploading = false;
        this.visualPhotos[key][photoIndex].uploadFailed = true;
        this.visualPhotos[key][photoIndex].isSkeleton = false;  // CRITICAL: Ensure caption button is clickable
        console.error('[UPLOAD UPDATE] Upload failed for task:', task.id, task.error);
      }

      this.changeDetectorRef.detectChanges();
    });

    // Subscribe to background sync photo upload completions
    // ALWAYS display from LocalImages table - never swap displayUrl to remote URLs
    // Sync happens in background, but UI always shows local blob until finalization
    // Only update metadata and cache the remote image for persistence
    this.photoSyncSubscription = this.backgroundSync.photoUploadComplete$.subscribe(async (event) => {
      console.log('[PHOTO SYNC] Photo upload completed:', event.tempFileId);

      // ===== US-001 DEBUG: Sync completion - trace displayUrl changes =====
      const syncDebugMsg = `SYNC COMPLETE received\n` +
        `tempFileId: ${event.tempFileId}\n` +
        `result PK_ID: ${event.result?.Result?.[0]?.PK_ID || event.result?.PK_ID || 'N/A'}\n` +
        `result AttachID: ${event.result?.Result?.[0]?.AttachID || event.result?.AttachID || 'N/A'}`;
      this.logDebug('SYNC', syncDebugMsg);
      // ===== END US-001 DEBUG =====

      // DEBUG: Log all photos in visualPhotos to find the mismatch
      console.log('[PHOTO SYNC DEBUG] Searching for tempFileId:', event.tempFileId);
      console.log('[PHOTO SYNC DEBUG] Keys in visualPhotos:', Object.keys(this.visualPhotos));
      for (const debugKey of Object.keys(this.visualPhotos)) {
        const photos = this.visualPhotos[debugKey];
        console.log(`[PHOTO SYNC DEBUG] Key "${debugKey}" has ${photos.length} photos:`);
        photos.forEach((p: any, i: number) => {
          console.log(`  [${i}] AttachID: ${p.AttachID}, id: ${p.id}, imageId: ${p.imageId}, _pendingFileId: ${p._pendingFileId}`);
        });
      }

      // Find the photo in our visualPhotos by temp file ID
      let foundPhoto = false;
      for (const key of Object.keys(this.visualPhotos)) {
        const photoIndex = this.visualPhotos[key].findIndex(p =>
          p.AttachID === event.tempFileId ||
          p._pendingFileId === event.tempFileId ||
          p.id === event.tempFileId ||
          p.imageId === event.tempFileId  // Also check imageId field
        );

        if (photoIndex !== -1) {
          foundPhoto = true;
          console.log('[PHOTO SYNC] Found photo at key:', key, 'index:', photoIndex);

          const result = event.result;
          const actualResult = result?.Result?.[0] || result;
          const realAttachId = actualResult.PK_ID || actualResult.AttachID;

          // Cache the remote image for persistence (used after local blob is pruned)
          // but do NOT update displayUrl - it stays as local blob from LocalImages
          let cachedUrl = this.visualPhotos[key][photoIndex].url;
          try {
            const cachedBase64 = await this.indexedDb.getCachedPhoto(String(realAttachId));
            if (cachedBase64) {
              cachedUrl = cachedBase64;
              console.log('[PHOTO SYNC] ✅ Found cached base64 for persistence:', realAttachId);
            } else {
              console.log('[PHOTO SYNC] No cached image yet (displayUrl unchanged - staying with LocalImages)');
            }
          } catch (err) {
            console.warn('[PHOTO SYNC] Failed to get cached image:', err);
          }

          // Update photo metadata - preserve displayUrl (local blob from LocalImages)
          // CRITICAL: Preserve caption - it may have been set locally before sync
          // The upload includes the caption, so we can safely keep the local one
          const existingPhoto = this.visualPhotos[key][photoIndex];
          const serverCaption = actualResult.Annotation || actualResult.Caption || '';
          const localCaption = existingPhoto.caption || '';

          // Use local caption if it exists, otherwise use server caption
          // (server caption should match if upload worked correctly)
          const finalCaption = localCaption || serverCaption;

          this.visualPhotos[key][photoIndex] = {
            ...existingPhoto,
            AttachID: realAttachId,
            attachId: String(realAttachId),  // CRITICAL: Update lowercase for caption lookups
            id: realAttachId,                 // CRITICAL: Update id for consistency
            url: cachedUrl,  // Store cached URL for reference, but displayUrl unchanged
            // displayUrl: unchanged - stays as local blob from LocalImages table
            // thumbnailUrl: unchanged - stays as local blob from LocalImages table
            // originalUrl: unchanged - stays as local blob from LocalImages table
            caption: finalCaption,  // CRITICAL: Preserve caption
            Annotation: finalCaption,  // Also set Caspio field
            queued: false,
            uploading: false,
            isPending: false,
            _pendingFileId: undefined,
            _localUpdate: false,  // Clear local update flag - sync is complete
            isSkeleton: false
          };

          // ===== US-001 DEBUG: After sync update - trace final displayUrl =====
          const updatedPhoto = this.visualPhotos[key][photoIndex];
          const syncUpdateDebugMsg = `SYNC UPDATE APPLIED\n` +
            `key: ${key}\n` +
            `old imageId: ${event.tempFileId}\n` +
            `new AttachID: ${realAttachId}\n` +
            `displayUrl: ${updatedPhoto.displayUrl?.substring(0, 80)}...\n` +
            `displayUrl type: ${updatedPhoto.displayUrl?.startsWith('blob:') ? 'BLOB (local)' : updatedPhoto.displayUrl?.startsWith('data:') ? 'DATA (cached)' : 'OTHER'}\n` +
            `url: ${updatedPhoto.url?.substring(0, 80)}...`;
          this.logDebug('SYNC', syncUpdateDebugMsg);
          // ===== END US-001 DEBUG =====

          this.changeDetectorRef.detectChanges();
          console.log('[PHOTO SYNC] Updated photo with real ID:', realAttachId, '(displayUrl unchanged - staying with LocalImages)');
          break;
        }
      }

      // RECOVERY: If photo was NOT found, try to restore it from LocalImageService
      if (!foundPhoto) {
        console.error('[PHOTO SYNC] ❌ Photo NOT FOUND in visualPhotos! tempFileId:', event.tempFileId);
        console.error('[PHOTO SYNC] Attempting recovery from LocalImageService...');

        try {
          // Get the LocalImage
          const localImage = await this.localImageService.getImage(event.tempFileId);
          if (localImage) {
            console.log('[PHOTO SYNC] Found LocalImage:', localImage.imageId, 'entityId:', localImage.entityId);

            // Find the key by entityId (visualId)
            let recoveryKey: string | null = null;
            for (const [key, visualId] of Object.entries(this.visualRecordIds)) {
              if (String(visualId) === String(localImage.entityId) ||
                  visualId === localImage.entityId) {
                recoveryKey = key;
                break;
              }
            }

            // Also check if entityId maps to a real ID
            if (!recoveryKey) {
              const realId = await this.indexedDb.getRealId(localImage.entityId);
              if (realId) {
                for (const [key, visualId] of Object.entries(this.visualRecordIds)) {
                  if (String(visualId) === String(realId)) {
                    recoveryKey = key;
                    break;
                  }
                }
              }
            }

            if (recoveryKey) {
              console.log('[PHOTO SYNC] Recovery key found:', recoveryKey);

              // Get display URL
              const displayUrl = await this.localImageService.getDisplayUrl(localImage);

              // Get result data
              const result = event.result;
              const actualResult = result?.Result?.[0] || result;
              const realAttachId = actualResult.PK_ID || actualResult.AttachID || event.tempFileId;

              // Create photo entry
              const recoveredPhoto = {
                imageId: localImage.imageId,
                AttachID: realAttachId,
                attachId: String(realAttachId),
                id: realAttachId,
                displayUrl: displayUrl,
                url: displayUrl,
                thumbnailUrl: displayUrl,
                originalUrl: displayUrl,
                caption: localImage.caption || '',
                annotation: localImage.caption || '',
                Annotation: localImage.caption || '',
                Drawings: localImage.drawings || '',
                hasAnnotations: !!(localImage.drawings && localImage.drawings.length > 10),
                status: localImage.status,
                isLocal: !!localImage.localBlobId,
                uploading: false,
                queued: false,
                isPending: false
              };

              // Add to visualPhotos with duplicate check
              if (!this.visualPhotos[recoveryKey]) {
                this.visualPhotos[recoveryKey] = [];
              }
              
              // CRITICAL FIX: Check if photo already exists before adding to prevent duplicates
              const existingIndex = this.visualPhotos[recoveryKey].findIndex(p => 
                String(p.AttachID) === String(realAttachId) ||
                String(p.attachId) === String(realAttachId) ||
                p.imageId === localImage.imageId
              );
              
              if (existingIndex === -1) {
                this.visualPhotos[recoveryKey].push(recoveredPhoto);
                console.log('[PHOTO SYNC] ✅ Photo RECOVERED and added to visualPhotos:', recoveryKey);
              } else {
                // Update existing photo instead of adding duplicate
                this.visualPhotos[recoveryKey][existingIndex] = {
                  ...this.visualPhotos[recoveryKey][existingIndex],
                  ...recoveredPhoto
                };
                console.log('[PHOTO SYNC] ✅ Photo already exists, updated instead:', recoveryKey);
              }
              this.changeDetectorRef.detectChanges();
            } else {
              console.error('[PHOTO SYNC] ❌ Could not find recovery key for entityId:', localImage.entityId);
            }
          } else {
            console.error('[PHOTO SYNC] ❌ LocalImage not found:', event.tempFileId);
          }
        } catch (recoveryErr) {
          console.error('[PHOTO SYNC] Recovery failed:', recoveryErr);
        }
      }
    });

    // Subscribe to cache invalidation events from EngineersFoundationDataService
    // When data syncs, in-memory caches are cleared and we should reload fresh data
    // CRITICAL: Debounce to prevent multiple rapid reloads from causing issues
    this.cacheInvalidationSubscription = this.foundationData.cacheInvalidated$.subscribe((event) => {
      console.log('[CACHE INVALIDATED] Received event:', event);

      // Skip if in local operation cooldown (prevents flash when selecting items)
      if (this.localOperationCooldown) {
        console.log('[CACHE INVALIDATED] Skipping - in local operation cooldown');
        return;
      }

      // CRITICAL: Skip reload during active sync - images would disappear
      const syncStatus = this.backgroundSync.syncStatus$.getValue();
      if (syncStatus.isSyncing) {
        console.log('[CACHE INVALIDATED] Skipping - sync in progress, will reload after sync completes');
        this.pendingSyncReload = true;
        return;
      }

      // Only reload if this is our service or a global event
      if (!event.serviceId || event.serviceId === this.serviceId) {
        // Clear any existing debounce timer
        if (this.cacheInvalidationDebounceTimer) {
          clearTimeout(this.cacheInvalidationDebounceTimer);
        }

        // Skip if already reloading
        if (this.isReloadingAfterSync) {
          console.log('[CACHE INVALIDATED] Skipping - already reloading');
          return;
        }

        // Debounce: wait 100ms before reloading to batch multiple rapid events
        // Reduced from 500ms for faster UI response after sync
        this.cacheInvalidationDebounceTimer = setTimeout(async () => {
          console.log('[CACHE INVALIDATED] Debounced reload for service:', this.serviceId);
          await this.reloadVisualsAfterSync();
        }, 100);
      }
    });

    // Subscribe to sync status changes - reload AFTER sync completes (not during)
    this.syncStatusSubscription = this.backgroundSync.syncStatus$.subscribe((status) => {
      // When sync finishes and we have a pending reload, do it now
      if (!status.isSyncing && this.pendingSyncReload) {
        console.log('[SYNC COMPLETE] Sync finished, now reloading visuals...');
        this.pendingSyncReload = false;
        // Small delay to ensure all sync operations are fully complete
        setTimeout(() => {
          this.reloadVisualsAfterSync();
        }, 300);
      }
    });
  }

  /**
   * Subscribe to Dexie liveQuery for LocalImages changes
   * This enables reactive updates when IndexedDB changes (photos added, synced, deleted)
   * Automatically updates bulkLocalImagesMap without manual refresh
   */
  private subscribeToLocalImagesChanges(): void {
    // Unsubscribe from previous subscription if exists
    if (this.localImagesSubscription) {
      this.localImagesSubscription.unsubscribe();
    }
    
    if (!this.serviceId) {
      console.log('[LIVEQUERY] No serviceId, skipping subscription');
      return;
    }
    
    console.log('[LIVEQUERY] Subscribing to LocalImages changes for service:', this.serviceId);

    // Subscribe to all LocalImages for this service (visual entity type)
    this.localImagesSubscription = db.liveLocalImages$(this.serviceId, 'visual').subscribe(
      async (localImages) => {
        console.log('[LIVEQUERY] LocalImages updated:', localImages.length, 'images');

        // Suppress during camera capture to prevent duplicate photos with annotations
        // Camera code manually pushes with annotated URL; liveQuery would add with original URL
        // Gallery uploads do NOT suppress - they rely on liveQuery for UI updates
        if (this.isCameraCaptureInProgress) {
          console.log('[LIVEQUERY] Suppressing - camera capture in progress');
          return;
        }

        // Update bulkLocalImagesMap reactively (always update data immediately)
        this.updateBulkLocalImagesMap(localImages);

        // DEXIE-FIRST: Refresh photos from updated Dexie data
        if (this.lastConvertedFields && this.lastConvertedFields.length > 0) {
          await this.populatePhotosFromDexie(this.lastConvertedFields);
        }

        // CRITICAL: Debounce change detection to prevent multiple rapid UI updates
        // This prevents the "hard refresh" feeling when multiple operations happen quickly
        // (e.g., saving caption triggers both local update and IndexedDB update)
        if (this.liveQueryDebounceTimer) {
          clearTimeout(this.liveQueryDebounceTimer);
        }
        this.liveQueryDebounceTimer = setTimeout(() => {
          this.changeDetectorRef.detectChanges();
          this.liveQueryDebounceTimer = null;
        }, 100); // 100ms debounce - fast enough to feel responsive, slow enough to batch updates
      },
      (error) => {
        console.error('[LIVEQUERY] Error in LocalImages subscription:', error);
      }
    );
  }

  /**
   * Update bulkLocalImagesMap from liveQuery results
   * Groups LocalImages by entityId for efficient lookup
   */
  private updateBulkLocalImagesMap(localImages: LocalImage[]): void {
    // Clear existing map
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

    // US-001 FIX: Bidirectional ID mapping using cached temp->real mappings
    // This handles the race condition where background-sync updates photo entityId to real_ID,
    // but reloadVisualsAfterSync hasn't run yet to update visualRecordIds from temp_ID to real_ID.
    // Without this, photos "disappear" between sync completing and UI refresh.

    // Build reverse mapping: for each temp_ID in visualRecordIds, check tempIdToRealIdCache
    // and also map images with real_ID back to temp_ID
    for (const [key, tempOrRealId] of Object.entries(this.visualRecordIds)) {
      if (!tempOrRealId || !String(tempOrRealId).startsWith('temp_')) continue;

      const tempId = String(tempOrRealId);
      const realId = this.tempIdToRealIdCache.get(tempId);

      if (realId && this.bulkLocalImagesMap.has(realId)) {
        // Copy images from real_ID to temp_ID for backward compatibility
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

    // Also do reverse: for each real_ID in visualRecordIds, check if there's a temp_ID mapping
    // This handles the case where visualRecordIds was already updated to real_ID
    for (const [tempId, realId] of this.tempIdToRealIdCache.entries()) {
      if (this.bulkLocalImagesMap.has(tempId) && !this.bulkLocalImagesMap.has(realId)) {
        // Copy images from temp_ID to real_ID
        const imagesUnderTempId = this.bulkLocalImagesMap.get(tempId)!;
        this.bulkLocalImagesMap.set(realId, [...imagesUnderTempId]);
      }
    }

    console.log('[LIVEQUERY] Updated bulkLocalImagesMap with', this.bulkLocalImagesMap.size, 'entity groups');
  }

  /**
   * Reload visuals after a sync event to ensure UI shows fresh data
   * CRITICAL FIX: Uses VisualTemplateID for reliable matching, prevents key collisions
   */
  private async reloadVisualsAfterSync(): Promise<void> {
    // Prevent concurrent reloads
    if (this.isReloadingAfterSync) {
      console.log('[RELOAD AFTER SYNC] Skipping - already reloading');
      return;
    }
    
    this.isReloadingAfterSync = true;
    try {
      console.log('[RELOAD AFTER SYNC] Starting fresh visual reload...');
      
      // Get fresh visuals from IndexedDB (already updated by BackgroundSyncService)
      const visuals = await this.foundationData.getVisualsByService(this.serviceId);
      console.log('[RELOAD AFTER SYNC] Got', visuals.length, 'visuals from IndexedDB');
      
      // Track processed keys to prevent collisions within this reload
      const processedKeys = new Set<string>();
      
      // Update existing items with fresh data from server
      let anyVisualChanges = false;
      
      for (const visual of visuals) {
        // Skip if not for current category
        if (visual.Category !== this.categoryName) {
          continue;
        }
        
        const kind = visual.Kind?.toLowerCase() || '';
        const templateId = visual.VisualTemplateID || visual.TemplateID;
        const visualId = String(visual.VisualID || visual.PK_ID);
        
        // CRITICAL: Check if this visual is HIDDEN (deselected offline)
        // If so, we should NOT re-select it in the UI
        const isHidden = visual.Notes && String(visual.Notes).startsWith('HIDDEN');
        
        // Find the item in organizedData by matching templateId or name+category+kind
        let targetArray: VisualItem[] | null = null;
        if (kind === 'comment') {
          targetArray = this.organizedData.comments;
        } else if (kind === 'limitation') {
          targetArray = this.organizedData.limitations;
        } else if (kind === 'deficiency') {
          targetArray = this.organizedData.deficiencies;
        }
        
        if (targetArray) {
          // CRITICAL: Find by templateId first (most reliable), then by name+category+kind
          let existingItem: VisualItem | undefined;
          
          if (templateId) {
            existingItem = targetArray.find(item => item.templateId === templateId);
            if (existingItem) {
              console.log(`[RELOAD AFTER SYNC] Matched visual ${visualId} by TemplateID ${templateId}`);
            }
          }
          
          // If not found by templateId, try name+category+kind match
          if (!existingItem) {
            existingItem = targetArray.find(item =>
              item.name === visual.Name && item.category === visual.Category
            );
            if (existingItem && templateId) {
              console.warn(`[RELOAD AFTER SYNC] Visual ${visualId} TemplateID ${templateId} didn't match, fell back to name: "${visual.Name}"`);
            }
          }
          
          if (existingItem) {
            // CRITICAL: Use correct key format to match the rest of the codebase
            const key = `${visual.Category}_${existingItem.id}`;
            
            // CRITICAL: Check for collision - skip if this key was already processed
            if (processedKeys.has(key)) {
              console.warn(`[RELOAD AFTER SYNC] ⚠️ KEY COLLISION: Key "${key}" already processed, skipping visual ${visualId} (Name: "${visual.Name}")`);
              continue;
            }
            processedKeys.add(key);

            // US-001 FIX: If we had a temp_ID and now have a real ID, cache the mapping
            // This allows the synchronous liveQuery handler to resolve temp->real IDs
            const previousRecordId = this.visualRecordIds[key];
            if (previousRecordId && String(previousRecordId).startsWith('temp_') && !visualId.startsWith('temp_')) {
              this.tempIdToRealIdCache.set(String(previousRecordId), visualId);
              console.log(`[RELOAD AFTER SYNC] Cached temp->real mapping: ${previousRecordId} -> ${visualId}`);

              // US-001 FIX: Update all LocalImages with temp entityId to use the real ID
              // This fixes the "first album photo stuck" bug where photos captured with temp_ID
              // never get updated when the visual syncs. The liveQuery will re-fire after this
              // update and bulkLocalImagesMap will have entries under the correct real ID.
              this.indexedDb.updateEntityIdForImages(String(previousRecordId), visualId).catch(err => {
                console.error(`[RELOAD AFTER SYNC] Failed to update LocalImage entityIds:`, err);
              });

              // US-002 FIX: Update VisualField.visualId in Dexie with the real ID
              // This ensures populatePhotosFromDexie can find photos on page reload
              // because VisualField.visualId will now match LocalImages.entityId
              if (templateId) {
                this.visualFieldRepo.setField(this.serviceId, this.categoryName, templateId, {
                  visualId: visualId,
                  tempVisualId: null  // Clear temp ID since we now have real ID
                }).catch(err => {
                  console.error(`[RELOAD AFTER SYNC] Failed to update VisualField.visualId:`, err);
                });
                console.log(`[RELOAD AFTER SYNC] Updated VisualField.visualId: ${templateId} -> ${visualId}`);
              }
            }

            // Store the visual record ID for later operations (select/unselect/photo uploads)
            this.visualRecordIds[key] = visualId;
            
            // CRITICAL: Handle HIDDEN visuals - they should be DESELECTED
            if (isHidden) {
              // Check if currently selected - if so, we need to deselect
              if (this.selectedItems[key] === true) {
                console.log('[RELOAD AFTER SYNC] Deselecting HIDDEN visual:', key, 'visualId:', visualId);
                this.selectedItems[key] = false;
                existingItem.isSelected = false;
                existingItem.isSaving = false;
                this.savingItems[key] = false;
                anyVisualChanges = true;
              }
              continue; // Skip the rest - don't re-select this visual
            }
            
            // OPTIMIZATION: Only update if something actually changed
            // This prevents UI "flashing" when data is already correct
            // NOTE: visualRecordIds[key] stores the server record ID, NOT existingItem.id which is the template ID
            const currentRecordId = this.visualRecordIds[key];
            const alreadySelected = this.selectedItems[key] === true;
            const alreadyHasRealId = String(currentRecordId) === visualId;
            const hasTempMarkers = (existingItem as any)._tempId || (existingItem as any)._syncing;
            
            if (alreadySelected && alreadyHasRealId && !hasTempMarkers) {
              // Data is already up-to-date, skip to avoid UI flash
              console.log('[RELOAD AFTER SYNC] Item already up-to-date:', key, 'recordId:', currentRecordId);
              continue;
            }
            
            anyVisualChanges = true;
            
            // Update with fresh server data (only if needed)
            // NOTE: DO NOT change existingItem.id - that's the template ID used for the key format
            // Only update UI flags and store the visual record ID separately
            existingItem.isSelected = true;
            existingItem.isSaving = false;
            
            // Clear any temp ID markers
            delete (existingItem as any)._tempId;
            delete (existingItem as any)._localOnly;
            delete (existingItem as any)._syncing;
            
            this.selectedItems[key] = true;
            this.savingItems[key] = false;
            
            console.log('[RELOAD AFTER SYNC] Updated item:', key, 'with visual recordId:', visualId);
          } else {
            console.log('[RELOAD AFTER SYNC] No matching item found for visual:', visual.Name, 'templateId:', templateId);
          }
        }
      }
      
      // Refresh photo counts with fresh attachment data
      const photosChanged = await this.refreshPhotoCountsAfterSync(visuals);
      
      // Only trigger change detection if something actually changed
      if (anyVisualChanges || photosChanged) {
        console.log('[RELOAD AFTER SYNC] Changes detected, running change detection');
        this.changeDetectorRef.detectChanges();
      } else {
        console.log('[RELOAD AFTER SYNC] No changes detected, skipping change detection');
      }
      console.log('[RELOAD AFTER SYNC] Complete, visualChanges:', anyVisualChanges, 'photosChanged:', photosChanged);
      
    } catch (error) {
      console.error('[RELOAD AFTER SYNC] Error:', error);
    } finally {
      this.isReloadingAfterSync = false;
      
      // CRITICAL FIX: Set a cooldown period after reload to prevent background_refresh from triggering another reload
      // This prevents the duplicate photo issue caused by rapid sequential reloads
      this.localOperationCooldown = true;
      if (this.localOperationCooldownTimer) {
        clearTimeout(this.localOperationCooldownTimer);
      }
      this.localOperationCooldownTimer = setTimeout(() => {
        this.localOperationCooldown = false;
        console.log('[RELOAD AFTER SYNC] Cooldown period ended');
      }, 2000); // 2 second cooldown after reload
    }
  }

  /**
   * Refresh photo counts for all visuals after sync
   * Returns true if any photos were added or updated
   * BULLETPROOF: Never removes or replaces photos with valid displayUrls
   */
  private async refreshPhotoCountsAfterSync(visuals: any[]): Promise<boolean> {
    let anyChanges = false;
    
    for (const visual of visuals) {
      // Skip if not for current category
      if (visual.Category !== this.categoryName) {
        continue;
      }
      
      const kind = visual.Kind?.toLowerCase() || '';
      const templateId = visual.VisualTemplateID || visual.TemplateID;
      const visualId = visual.VisualID || visual.PK_ID;
      
      // Find the matching item to get the correct key
      let targetArray: VisualItem[] | null = null;
      if (kind === 'comment') {
        targetArray = this.organizedData.comments;
      } else if (kind === 'limitation') {
        targetArray = this.organizedData.limitations;
      } else if (kind === 'deficiency') {
        targetArray = this.organizedData.deficiencies;
      }
      
      if (!targetArray) {
        continue;
      }
      
      // Find by templateId first, then by name+category
      let existingItem = targetArray.find(item => item.templateId === templateId);
      if (!existingItem) {
        existingItem = targetArray.find(item => 
          item.name === visual.Name && item.category === visual.Category
        );
      }
      
      if (!existingItem) {
        console.log('[RELOAD AFTER SYNC] No matching item for photo refresh:', visual.Name);
        continue;
      }
      
      // CRITICAL: Use correct key format to match the rest of the codebase
      const key = `${visual.Category}_${existingItem.id}`;
      
      try {
        const attachments = await this.foundationData.getVisualAttachments(visualId);
        
        // BULLETPROOF: Get count of EXISTING photos with valid URLs + new from server
        // Never reduce the count if we have valid photos
        const existingValidPhotos = (this.visualPhotos[key] || []).filter(p => 
          p.displayUrl && 
          p.displayUrl !== 'assets/img/photo-placeholder.png' &&
          !p.displayUrl.startsWith('assets/')
        );
        this.photoCountsByKey[key] = Math.max(existingValidPhotos.length, attachments?.length || 0);
        
        // BULLETPROOF: If we already have photos with valid URLs, DON'T touch them
        if (attachments && attachments.length > 0) {
          if (!this.visualPhotos[key]) {
            this.visualPhotos[key] = [];
          }
          
          for (const att of attachments) {
            const realAttachId = String(att.PK_ID || att.AttachID);

            // BULLETPROOF: Check by multiple identifiers
            // Photos may have been added with imageId (UUID) but server returns real AttachID
            // CRITICAL FIX: Also check for LocalImage by attachId to find photos that have synced
            // This prevents phantom duplicate images when refreshing after multi-image upload
            let matchedByLocalImage = false;
            let localImageForAttach: LocalImage | null = null;
            try {
              localImageForAttach = await this.localImageService.getImageByAttachId(realAttachId);
            } catch (e) {
              // Ignore - LocalImage system not available
            }

            const existingPhotoIndex = this.visualPhotos[key].findIndex(p =>
              String(p.AttachID) === realAttachId ||
              String(p.attachId) === realAttachId ||
              String(p.id) === realAttachId ||
              // CRITICAL FIX: Also match by imageId if we found a LocalImage for this attachment
              (localImageForAttach && p.imageId === localImageForAttach.imageId)
            );

            // Track if we matched via LocalImage
            if (existingPhotoIndex !== -1 && localImageForAttach) {
              const existingPhoto = this.visualPhotos[key][existingPhotoIndex];
              if (existingPhoto.imageId === localImageForAttach.imageId) {
                matchedByLocalImage = true;
                // Update the AttachID on the existing photo so future matches work directly
                this.visualPhotos[key][existingPhotoIndex] = {
                  ...existingPhoto,
                  AttachID: realAttachId,
                  attachId: realAttachId,
                  id: realAttachId
                };
                console.log('[RELOAD AFTER SYNC] Matched photo by LocalImage imageId:', localImageForAttach.imageId, '-> AttachID:', realAttachId);
              }
            }
            
            if (existingPhotoIndex !== -1) {
              const existingPhoto = this.visualPhotos[key][existingPhotoIndex];
              
              // CRITICAL: If existing photo has a valid URL, PRESERVE IT
              // Only update if existing photo is broken (no displayUrl)
              const hasValidUrl = existingPhoto.displayUrl && 
                                  existingPhoto.displayUrl !== 'assets/img/photo-placeholder.png' &&
                                  !existingPhoto.loading;
              
              if (hasValidUrl) {
                // CRITICAL FIX: Check if attachment has local update flag
                // If so, DON'T overwrite local caption/annotation with server data
                const hasLocalUpdate = att._localUpdate || existingPhoto._localUpdate;
                
                if (hasLocalUpdate) {
                  console.log('[RELOAD AFTER SYNC] Preserving local update for photo:', realAttachId, 'caption:', existingPhoto.caption);
                  // Just ensure it's marked as not uploading/queued
                  if (existingPhoto.uploading || existingPhoto.queued) {
                    this.visualPhotos[key][existingPhotoIndex] = {
                      ...existingPhoto,
                      uploading: false,
                      queued: false,
                      isSkeleton: false,
                    };
                    anyChanges = true;
                  }
                } else {
                  // No local update - safe to compare with server data
                  const captionChanged = existingPhoto.caption !== (att.Annotation || att.Caption || '');
                  if (captionChanged) {
                    console.log('[RELOAD AFTER SYNC] Updating metadata for photo:', realAttachId);
                    this.visualPhotos[key][existingPhotoIndex] = {
                      ...existingPhoto,
                      caption: att.Annotation || att.Caption || existingPhoto.caption || '',
                      Attachment: att.Attachment || existingPhoto.Attachment,
                      uploading: false,
                      queued: false,
                      isSkeleton: false,  // CRITICAL: Ensure caption button is clickable
                    };
                    anyChanges = true;
                  } else {
                    console.log('[RELOAD AFTER SYNC] Photo already up-to-date:', realAttachId);
                  }
                }
              } else if (att.Attachment) {
                // Existing photo is broken/loading AND server has S3 key - reload it
                console.log('[RELOAD AFTER SYNC] Reloading broken photo:', realAttachId);
                this.loadSinglePhoto(att, key);
                anyChanges = true;
              }
              continue; // Already handled this photo
            }
            
            // CRITICAL FIX: Don't try to match temp photos generically here
            // The photoUploadComplete$ subscription already handles temp->real ID transition
            // Generic matching causes caption duplication when multiple photos sync at once
            // Instead, just add the new photo from server if it doesn't already exist

            // CRITICAL FIX FOR PHANTOM IMAGES: Before adding server photo, check if a LocalImage
            // exists that will be added later when loadPhotosForVisual runs. This prevents
            // duplicates when refreshPhotoCountsAfterSync runs before photos are expanded.
            if (localImageForAttach) {
              // LocalImage exists for this attachment - it will be added when user expands photos
              // Just update the photo count but don't add to visualPhotos array yet
              console.log('[RELOAD AFTER SYNC] Skipping server photo - LocalImage exists:', localImageForAttach.imageId, '-> AttachID:', realAttachId);
              continue;
            }

            if (att.Attachment) {
              console.log('[RELOAD AFTER SYNC] Loading new photo from server:', realAttachId);
              // loadSinglePhoto checks for existing entries and adds if not found
              this.loadSinglePhoto(att, key);
              anyChanges = true;
            } else {
              console.log('[RELOAD AFTER SYNC] Skipping photo with empty Attachment:', realAttachId);
            }
          }
        }
      } catch (error) {
        console.warn('[RELOAD AFTER SYNC] Error getting attachments for', key, error);
      }
    }
    
    return anyChanges;
  }

  /**
   * Update photo object after successful upload
   * LOCAL-FIRST: For local-first images, keep using local blob URLs until remote is verified
   */
  private async updatePhotoAfterUpload(key: string, photoIndex: number, result: any, caption: string) {
    // Get existing photo to check if it's local-first
    const oldPhoto = this.visualPhotos[key][photoIndex];
    
    // LOCAL-FIRST: Skip server URL fetching for local-first images
    // They should continue using their local blob URL until the remote is verified
    if (oldPhoto && (oldPhoto.isLocalFirst || oldPhoto.isLocalImage || oldPhoto.localImageId)) {
      console.log('[UPLOAD UPDATE] LOCAL-FIRST image - skipping server URL fetch, keeping local blob URL');
      // Just update status flags, keep URLs intact
      this.visualPhotos[key][photoIndex] = {
        ...oldPhoto,
        uploading: false,
        queued: false,
        isPending: result.status !== 'verified',
        status: result.status || 'uploaded'
      };
      return;
    }
    
    // LEGACY: Handle old-style photos that need server URLs
    const actualResult = result.Result && result.Result[0] ? result.Result[0] : result;
    const s3Key = actualResult.Attachment;
    const uploadedPhotoUrl = actualResult.Photo || actualResult.thumbnailUrl || actualResult.url;
    let displayableUrl = uploadedPhotoUrl || '';

    // Check if this is an S3 image
    if (s3Key && this.caspioService.isS3Key(s3Key)) {
      try {
        displayableUrl = await this.caspioService.getS3FileUrl(s3Key);
      } catch (err) {
        console.error('[UPLOAD UPDATE] S3 failed:', err);
        displayableUrl = 'assets/img/photo-placeholder.png';
      }
    }
    // Fallback to Caspio Files API
    else if (uploadedPhotoUrl && !uploadedPhotoUrl.startsWith('data:') && !uploadedPhotoUrl.startsWith('blob:')) {
      try {
        const imageData = await firstValueFrom(
          this.caspioService.getImageFromFilesAPI(uploadedPhotoUrl)
        );
        if (imageData && imageData.startsWith('data:')) {
          displayableUrl = imageData;
        } else {
          displayableUrl = 'assets/img/photo-placeholder.png';
        }
      } catch (err) {
        console.error('[UPLOAD UPDATE] Failed:', err);
        displayableUrl = 'assets/img/photo-placeholder.png';
      }
    }
    
    // CRITICAL: Preserve existing annotations if user added them while photo was uploading
    const hasExistingAnnotations = oldPhoto && (
      oldPhoto.hasAnnotations || 
      oldPhoto.Drawings || 
      (oldPhoto.displayUrl && oldPhoto.displayUrl.startsWith('blob:') && oldPhoto.displayUrl !== oldPhoto.url)
    );
    
    // Revoke old blob URL ONLY for LEGACY photos, not local-first ones
    // And only if it's the base image URL, not an annotation display URL
    if (oldPhoto && oldPhoto.url && oldPhoto.url.startsWith('blob:') && !hasExistingAnnotations && !oldPhoto.imageId) {
      URL.revokeObjectURL(oldPhoto.url);
    }

    // CRITICAL: Store original temp ID so we can find the photo later if user is editing annotations
    const originalTempId = oldPhoto?.AttachID && String(oldPhoto.AttachID).startsWith('temp_') 
      ? oldPhoto.AttachID 
      : oldPhoto?._originalTempId;

    // Update photo object - PRESERVE annotations if they exist
    this.visualPhotos[key][photoIndex] = {
      ...this.visualPhotos[key][photoIndex],
      AttachID: result.AttachID,
      id: result.AttachID,
      _originalTempId: originalTempId,  // Store for finding photo during annotation save
      // CRITICAL FIX: Clear temp flags to prevent reloadVisualsAfterSync from matching this photo as "temp"
      _tempId: undefined,
      _pendingFileId: undefined,
      _backgroundSync: undefined,
      uploading: false,
      progress: 100,
      Attachment: s3Key,
      filePath: s3Key || uploadedPhotoUrl,
      Photo: uploadedPhotoUrl,
      url: displayableUrl,
      originalUrl: displayableUrl,
      thumbnailUrl: displayableUrl,
      // CRITICAL: Preserve displayUrl if user added annotations while uploading
      displayUrl: hasExistingAnnotations ? oldPhoto.displayUrl : displayableUrl,
      // CRITICAL: Preserve caption/annotation if user set them while uploading
      caption: oldPhoto?.caption || caption || '',
      annotation: oldPhoto?.annotation || caption || '',
      Annotation: oldPhoto?.Annotation || caption || '',
      // Preserve annotation data
      hasAnnotations: oldPhoto?.hasAnnotations || false,
      Drawings: oldPhoto?.Drawings || '',
      isSkeleton: false,  // CRITICAL: Ensure caption button is clickable
      queued: false       // Clear queued state after successful upload
    };

    // If user added annotations while uploading, transfer cached annotated image to real ID
    if (hasExistingAnnotations && originalTempId) {
      console.log('[UPLOAD UPDATE] Transferring cached annotated image from temp ID to real ID:', originalTempId, '->', result.AttachID);

      try {
        // DEXIE-FIRST: Try to use pointer storage instead of copying base64
        const localImage = await this.localImageService.getImage(originalTempId);
        if (localImage?.localBlobId) {
          // Use pointer storage (saves ~930KB)
          await this.indexedDb.cacheAnnotatedPointer(String(result.AttachID), localImage.localBlobId);
          console.log('[UPLOAD UPDATE] ✅ Annotated POINTER transferred to real AttachID:', result.AttachID);

          // Update in-memory map - get displayable URL
          const displayUrl = await this.indexedDb.getCachedAnnotatedImage(String(result.AttachID));
          if (displayUrl) {
            this.bulkAnnotatedImagesMap.set(String(result.AttachID), displayUrl);
            this.bulkAnnotatedImagesMap.delete(originalTempId);
          }
        } else {
          // FALLBACK: Legacy path - no local blob, use full base64 copy
          const cachedAnnotatedImage = await this.indexedDb.getCachedAnnotatedImage(originalTempId);
          if (cachedAnnotatedImage) {
            const response = await fetch(cachedAnnotatedImage);
            const blob = await response.blob();
            const base64 = await this.indexedDb.cacheAnnotatedImage(String(result.AttachID), blob);
            console.log('[UPLOAD UPDATE] ✅ Annotated image transferred (legacy) to real AttachID:', result.AttachID);

            if (base64) {
              this.bulkAnnotatedImagesMap.set(String(result.AttachID), base64);
              this.bulkAnnotatedImagesMap.delete(originalTempId);
            }
          }
        }
      } catch (transferErr) {
        console.warn('[UPLOAD UPDATE] Failed to transfer annotated image cache:', transferErr);
      }
      
      // Also queue the annotation update to sync with the real AttachID
      if (oldPhoto?.Drawings) {
        console.log('[UPLOAD UPDATE] Queueing annotation sync with real AttachID:', result.AttachID);
        // The annotations are already stored in the photo object and will be synced
      }
    }

    console.log('[UPLOAD UPDATE] Photo updated successfully, annotations preserved:', hasExistingAnnotations);
  }

  private async loadData() {
    // CRITICAL: Prevent concurrent loadData() calls which can cause race conditions and photo loss
    if (this.isLoadingData) {
      console.log('[LOAD DATA] ⚠️ SKIPPING - loadData() already in progress');
      return;
    }
    this.isLoadingData = true;

    console.time('[CategoryDetail] loadData total');
    console.log('[LOAD DATA] ========== loadData START ==========');
    console.log('[LOAD DATA] Stack trace:', new Error().stack?.split('\n').slice(1, 4).join(' → '));
    const startTime = performance.now();

    // CRITICAL: Start cooldown to prevent cache invalidation events from causing UI flash
    this.startLocalOperationCooldown();

    // CRITICAL FIX: Preserve existing photos before clearing
    // This prevents images from disappearing during reloads/sync
    const preservedPhotos: { [key: string]: any[] } = {};
    const syncStatus = this.backgroundSync.syncStatus$.getValue();
    const syncInProgress = syncStatus.isSyncing;

    console.log('[LOAD DATA] Checking photos to preserve... (sync in progress:', syncInProgress, ')');

    for (const [key, photos] of Object.entries(this.visualPhotos)) {
      console.log(`[LOAD DATA] Key "${key}" has ${(photos as any[]).length} photos before filtering`);

      // Log each photo's status for debugging
      (photos as any[]).forEach((p: any, i: number) => {
        console.log(`[LOAD DATA]   [${i}] imageId: ${p.imageId}, displayUrl: ${p.displayUrl?.substring(0, 50)}..., uploading: ${p.uploading}, queued: ${p.queued}, status: ${p.status}`);
      });

      // BULLETPROOF PRESERVATION: Preserve photos if ANY of these conditions are true:
      // 1. Has valid blob/data URL (local image ready for display)
      // 2. Has imageId (part of LocalImage system - always keep these!)
      // 3. Has _pendingFileId (old pending system)
      // 4. Is uploading or queued (in transit - NEVER lose these)
      // 5. Sync is in progress (preserve EVERYTHING during sync)
      const validPhotos = (photos as any[]).filter(p => {
        // During sync, preserve ALL photos to prevent any loss
        if (syncInProgress) {
          console.log(`[LOAD DATA]     -> PRESERVING (sync in progress): ${p.imageId || p.AttachID}`);
          return true;
        }

        // Always preserve LocalImage system photos
        if (p.imageId) {
          console.log(`[LOAD DATA]     -> PRESERVING (has imageId): ${p.imageId}`);
          return true;
        }

        // Always preserve old pending system photos
        if (p._pendingFileId) {
          console.log(`[LOAD DATA]     -> PRESERVING (has _pendingFileId): ${p._pendingFileId}`);
          return true;
        }

        // Always preserve uploading/queued photos
        if (p.uploading || p.queued) {
          console.log(`[LOAD DATA]     -> PRESERVING (uploading/queued): ${p.AttachID}`);
          return true;
        }

        // Preserve photos with valid display URLs
        if (p.displayUrl && (p.displayUrl.startsWith('blob:') || p.displayUrl.startsWith('data:'))) {
          console.log(`[LOAD DATA]     -> PRESERVING (valid displayUrl): ${p.AttachID}`);
          return true;
        }

        console.log(`[LOAD DATA]     -> NOT preserving: ${p.AttachID} (no valid criteria)`);
        return false;
      });

      if (validPhotos.length > 0) {
        preservedPhotos[key] = validPhotos;
        console.log(`[LOAD DATA] Preserving ${validPhotos.length}/${(photos as any[]).length} photos for key: ${key}`);
      } else {
        console.log(`[LOAD DATA] ⚠️ NO photos preserved for key: ${key} (all filtered out)`);
      }
    }

    // CRITICAL FIX: Also preserve visualRecordIds so recovery can find keys
    // This was missing before - causing recovery mechanism to fail
    const preservedVisualRecordIds = { ...this.visualRecordIds };
    console.log(`[LOAD DATA] Preserved ${Object.keys(preservedVisualRecordIds).length} visualRecordIds`);

    // CRITICAL FIX: Preserve organizedData and selectedItems to prevent black screen
    // Only clear photo-related state; keep template structure visible during reload
    // organizedData will be rebuilt after new data loads (NOT cleared upfront)
    const preservedOrganizedData = { ...this.organizedData };
    const preservedSelectedItems = { ...this.selectedItems };
    console.log(`[LOAD DATA] Preserved organizedData: comments=${preservedOrganizedData.comments?.length || 0}, limitations=${preservedOrganizedData.limitations?.length || 0}, deficiencies=${preservedOrganizedData.deficiencies?.length || 0}`);

    // Clear photo-related state only (NOT organizedData - that stays visible)
    this.visualPhotos = {};
    this.visualRecordIds = {};
    this.uploadingPhotosByKey = {};
    this.loadingPhotosByKey = {};
    this.photoCountsByKey = {};
    // Keep selectedItems and organizedData visible during load to prevent black screen

    // Clear bulk caches
    this.bulkAttachmentsMap.clear();
    this.bulkCachedPhotosMap.clear();
    this.bulkAnnotatedImagesMap.clear();
    this.bulkPendingPhotosMap.clear();
    this.bulkLocalImagesMap.clear();

    // CRITICAL: Restore preserved photos immediately so UI doesn't flicker
    for (const [key, photos] of Object.entries(preservedPhotos)) {
      this.visualPhotos[key] = photos;
      this.photoCountsByKey[key] = photos.length;
      console.log(`[LOAD DATA] Restored ${photos.length} preserved photos for key: ${key}`);
    }

    // CRITICAL FIX: Restore visualRecordIds for preserved photos
    // This enables recovery mechanism to find the correct key
    for (const key of Object.keys(preservedPhotos)) {
      if (preservedVisualRecordIds[key]) {
        this.visualRecordIds[key] = preservedVisualRecordIds[key];
        console.log(`[LOAD DATA] Restored visualRecordId for key: ${key} = ${preservedVisualRecordIds[key]}`);
      }
    }

    try {
      // ===== STEP 0: FAST LOAD - All data in ONE parallel batch =====
      // Photo data loads on-demand when user clicks to expand
      console.log('[LOAD DATA] Starting fast load (no photo data)...');
      const bulkLoadStart = Date.now();
      
      const [allTemplates, visuals, pendingPhotos, pendingRequests, allLocalImages, cachedPhotos, annotatedImages] = await Promise.all([
        this.indexedDb.getCachedTemplates('visual') || [],
        this.indexedDb.getCachedServiceData(this.serviceId, 'visuals') || [],
        this.indexedDb.getAllPendingPhotosGroupedByVisual(),
        this.indexedDb.getPendingRequests(),
        this.localImageService.getImagesForService(this.serviceId),
        this.indexedDb.getAllCachedPhotosForService(this.serviceId),  // Load cached photos upfront
        this.indexedDb.getAllCachedAnnotatedImagesForService()        // Load annotated images upfront
      ]);
      
      // Store ALL bulk data in memory - NO more IndexedDB reads after this
      this.bulkPendingPhotosMap = pendingPhotos;
      this.bulkVisualsCache = visuals as any[] || [];
      this.bulkPendingRequestsCache = pendingRequests || [];
      this.bulkCachedPhotosMap = cachedPhotos;          // Store cached photos immediately
      this.bulkAnnotatedImagesMap = annotatedImages;    // Store annotated images immediately
      
      // NEW: Group LocalImages by entityId for fast lookup
      // Also resolves temp IDs to real IDs so photos persist after parent entity syncs
      // Run outside Angular zone to avoid unnecessary change detection during data processing
      await this.ngZone.runOutsideAngular(async () => {
        this.bulkLocalImagesMap.clear();
        for (const img of allLocalImages) {
          // BUGFIX: Convert entityId to string to handle numeric IDs from database
          const entityId = String(img.entityId);

          // Add to map by original entityId
          if (!this.bulkLocalImagesMap.has(entityId)) {
            this.bulkLocalImagesMap.set(entityId, []);
          }
          this.bulkLocalImagesMap.get(entityId)!.push(img);

          // CRITICAL: Also add by resolved real ID if entityId is a temp ID
          // This ensures photos show after the parent visual syncs (temp ID -> real ID)
          // but before the photo itself syncs (which updates entityId)
          if (entityId.startsWith('temp_')) {
            const realId = await this.indexedDb.getRealId(entityId);
            if (realId && realId !== entityId) {
              // US-001 FIX: Cache the temp->real mapping for synchronous lookup in liveQuery
              this.tempIdToRealIdCache.set(entityId, realId);

              if (!this.bulkLocalImagesMap.has(realId)) {
                this.bulkLocalImagesMap.set(realId, []);
              }
              // Avoid duplicates
              const existing = this.bulkLocalImagesMap.get(realId)!;
              if (!existing.some(e => e.imageId === img.imageId)) {
                existing.push(img);
              }
            }
          }
        }

        // CRITICAL FIX: Reverse mapping - for images whose entityId is already a real ID,
        // also add them under any temp IDs in visualRecordIds that map to that real ID.
        // This handles the case where the image's entityId was updated to real ID by sync,
        // but the visual in organizedData is still tracked by temp ID.
        for (const [key, tempOrRealId] of Object.entries(this.visualRecordIds)) {
          if (tempOrRealId && tempOrRealId.startsWith('temp_')) {
            // Check if this temp ID maps to a real ID that has images
            const realId = await this.indexedDb.getRealId(tempOrRealId);
            if (realId && realId !== tempOrRealId) {
              // US-001 FIX: Cache the temp->real mapping for synchronous lookup in liveQuery
              this.tempIdToRealIdCache.set(tempOrRealId, realId);

              if (this.bulkLocalImagesMap.has(realId)) {
                // Copy images from real ID to temp ID
                const imagesForRealId = this.bulkLocalImagesMap.get(realId)!;
                if (!this.bulkLocalImagesMap.has(tempOrRealId)) {
                  this.bulkLocalImagesMap.set(tempOrRealId, []);
                }
                const existingForTemp = this.bulkLocalImagesMap.get(tempOrRealId)!;
                for (const img of imagesForRealId) {
                  if (!existingForTemp.some(e => e.imageId === img.imageId)) {
                    existingForTemp.push(img);
                  }
                }
                console.log(`[LOAD DATA] Reverse-mapped ${imagesForRealId.length} images from realId ${realId} to tempId ${tempOrRealId}`);
              }
            }
          }
        }
      });

      console.log(`[LOAD DATA] Loaded ${allLocalImages.length} LocalImages for ${this.bulkLocalImagesMap.size} entities (with bidirectional ID resolution)`);
      
      // NOTE: Cached photos and annotated images are now loaded upfront in Step 0
      // No need for preloadPhotoCachesInBackground() anymore
      
      // CRITICAL: Trigger background refresh when online to sync with server
      // This follows the standard offline-first pattern used by room-elevation.page.ts
      // The cached data is displayed immediately, then updated when fresh data arrives
      if (this.offlineService.isOnline()) {
        console.log('[LOAD DATA] Online - triggering background refresh for visuals');
        this.offlineTemplate.getVisualsByService(this.serviceId); // Triggers refreshVisualsInBackground
      }
      
      console.log(`[LOAD DATA] ✅ Fast load complete in ${Date.now() - bulkLoadStart}ms:`, {
        templates: (allTemplates as any[]).length,
        visuals: this.bulkVisualsCache.length,
        pendingPhotos: pendingPhotos.size,
        pendingRequests: this.bulkPendingRequestsCache.length
      });
      
      // Only show loading if no templates cached AND no existing data visible
      if ((allTemplates as any[]).length === 0 && 
          this.organizedData.comments.length === 0 && 
          this.organizedData.limitations.length === 0 && 
          this.organizedData.deficiencies.length === 0) {
        this.loading = true;
        this.changeDetectorRef.detectChanges();
      }

      // ===== STEP 1: Load templates (pure CPU, instant) =====
      // CRITICAL FIX: Clear organizedData and selectedItems right before rebuilding
      // This prevents black screen by keeping old data visible during async load above
      this.organizedData = { comments: [], limitations: [], deficiencies: [] };
      this.selectedItems = {};
      this.loadCategoryTemplatesFromCache(allTemplates as any[]);

      // ===== STEP 2: Process visuals (uses pre-loaded bulkVisualsCache) =====
      this.loadExistingVisualsFromCache();
      console.log('[LOAD DATA] ✅ Visuals processed');
      
      // CRITICAL FIX: Show content immediately after templates and visuals are loaded
      // Don't wait for photos - they load in background. This prevents black screen.
      if (this.loading && (allTemplates as any[]).length > 0) {
        this.loading = false;
        this.changeDetectorRef.detectChanges();
        console.log('[LOAD DATA] ✅ Content visible (photos loading in background)');
      }

      // ===== STEP 3: Restore pending photos (uses bulkPendingPhotosMap) =====
      this.restorePendingPhotosFromIndexedDB();
      console.log('[LOAD DATA] ✅ Pending photos restored');

      // ===== STEP 3.5: Show initial photo counts from LocalImages (INSTANT - no I/O) =====
      // This gives users immediate feedback on photo counts while server data loads
      this.showInitialPhotoCountsFromLocalImages();

      // ===== STEP 3.6: Show page NOW - don't wait for photos =====
      this.loading = false;
      this.expandedAccordions = ['information', 'limitations', 'deficiencies'];
      this.changeDetectorRef.detectChanges();
      const loadTimeMs = performance.now() - startTime;
      console.log(`[LOAD DATA] ========== UI READY (skeleton): ${loadTimeMs.toFixed(0)}ms ==========`);
      console.timeEnd('[CategoryDetail] loadData total');

      // Performance warning if load takes too long
      if (loadTimeMs > 2000) {
        console.warn(`[PERF] Page load took ${loadTimeMs.toFixed(0)}ms - exceeds 2s target`);
      }

      // ===== STEP 3.7: Load attachments + photo URLs in background (NON-BLOCKING) =====
      // Use requestIdleCallback for better performance, falling back to setTimeout
      const loadPhotosInBackground = async () => {
        try {
          this.isLoadingPhotosInBackground = true;

          const visualIds = this.bulkVisualsCache
            .filter((v: any) => v.Category === this.categoryName)
            .map((v: any) => String(v.VisualID || v.PK_ID || v.id))
            .filter((id: string) => id && !id.startsWith('temp_'));

          if (visualIds.length > 0) {
            this.bulkAttachmentsMap = await this.indexedDb.getAllVisualAttachmentsForVisuals(visualIds);
            console.log(`[LOAD DATA BG] ✅ Loaded attachments for ${this.bulkAttachmentsMap.size} visuals`);
          }

          // Pre-load photo URLs
          await this.preloadAllPhotoUrls();
          console.log(`[LOAD DATA BG] ✅ All photo URLs pre-loaded (total: ${Date.now() - startTime}ms)`);

          // Trigger UI update
          this.changeDetectorRef.detectChanges();
        } catch (err) {
          console.warn('[LOAD DATA BG] Background photo loading failed:', err);
        } finally {
          this.isLoadingPhotosInBackground = false;
        }
      };

      // Use requestIdleCallback for non-blocking execution when browser is idle
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => loadPhotosInBackground(), { timeout: 2000 });
      } else {
        // Fallback for environments without requestIdleCallback
        setTimeout(loadPhotosInBackground, 50);
      }

    } catch (error) {
      console.error('[LOAD DATA] ❌ Error:', error);
      this.loading = false;
      this.changeDetectorRef.detectChanges();
      console.timeEnd('[CategoryDetail] loadData total');
    } finally {
      // CRITICAL: Always reset the loading flag to allow future loads
      this.isLoadingData = false;
    }

    // Track last loaded IDs to detect context changes on re-entry
    this.lastLoadedServiceId = this.serviceId;
    this.lastLoadedCategoryName = this.categoryName;

    console.log('[LOAD DATA] ========== loadData END ==========');
  }

  /**
   * Pre-load cached photos and annotated images in background
   * This ensures synced images display instantly without S3 fetches
   * Runs in parallel with page rendering - doesn't block UI
   */
  private preloadPhotoCachesInBackground(): void {
    // Use setTimeout to ensure this doesn't block initial render
    setTimeout(async () => {
      try {
        const cacheLoadStart = Date.now();
        const [cachedPhotos, annotatedImages] = await Promise.all([
          this.indexedDb.getAllCachedPhotosForService(this.serviceId),
          this.indexedDb.getAllCachedAnnotatedImagesForService()
        ]);
        
        this.bulkCachedPhotosMap = cachedPhotos;
        this.bulkAnnotatedImagesMap = annotatedImages;
        
        console.log(`[PHOTO CACHE] Pre-loaded ${cachedPhotos.size} photos, ${annotatedImages.size} annotations in ${Date.now() - cacheLoadStart}ms`);
      } catch (error) {
        console.warn('[PHOTO CACHE] Failed to pre-load caches:', error);
        // Not critical - photos will load on-demand as fallback
      }
    }, 50); // Small delay to prioritize UI rendering
  }

  /**
   * Pre-load all photo URLs for all visuals in this category
   * BLOCKING: Ensures all photos are ready before UI renders
   * This fixes the issue of images not showing on first template load
   */
  private async preloadAllPhotoUrls(): Promise<void> {
    const loadPromises: Promise<void>[] = [];
    
    for (const visual of this.bulkVisualsCache) {
      if (visual.Category !== this.categoryName) continue;
      if (visual.Notes && String(visual.Notes).startsWith('HIDDEN')) continue;
      
      const visualId = String(visual.VisualID || visual.PK_ID || visual.id);
      const item = this.findItemByNameAndCategory(visual.Name, visual.Category, visual.Kind) ||
        this.organizedData.comments.find(i => i.id === `custom_${visualId}`) ||
        this.organizedData.limitations.find(i => i.id === `custom_${visualId}`) ||
        this.organizedData.deficiencies.find(i => i.id === `custom_${visualId}`);
      
      if (!item) continue;
      
      const key = `${visual.Category}_${item.id}`;
      
      // Only load if there are photos (attachments, pending, or local)
      const attachments = this.bulkAttachmentsMap.get(visualId) || [];
      const pendingPhotos = this.bulkPendingPhotosMap.get(visualId) || [];
      const localImages = this.bulkLocalImagesMap.get(visualId) || [];
      
      if (attachments.length > 0 || pendingPhotos.length > 0 || localImages.length > 0) {
        loadPromises.push(
          this.loadPhotosForVisual(visualId, key).catch(err => {
            console.warn(`[PRELOAD] Failed to load photos for ${key}:`, err);
          })
        );
      }
    }
    
    // Also process pending visuals with LocalImages (temp IDs)
    for (const [entityId, localImages] of this.bulkLocalImagesMap.entries()) {
      if (!entityId.startsWith('temp_')) continue;
      if (localImages.length === 0) continue;
      
      // Find matching key from pending visuals
      const matchingKey = Object.entries(this.visualRecordIds)
        .find(([_, id]) => id === entityId)?.[0];
      
      if (matchingKey) {
        loadPromises.push(
          this.loadPhotosForVisual(entityId, matchingKey).catch(err => {
            console.warn(`[PRELOAD] Failed to load photos for pending ${matchingKey}:`, err);
          })
        );
      }
    }
    
    console.log(`[PRELOAD] Loading photos for ${loadPromises.length} visuals...`);
    await Promise.all(loadPromises);
  }

  /**
   * Show initial photo counts from LocalImages (instant, no I/O)
   * This provides immediate feedback to users while server data loads in background
   */
  private showInitialPhotoCountsFromLocalImages(): void {
    // Iterate through all visuals in this category and set initial photo counts from LocalImages
    for (const visual of this.bulkVisualsCache) {
      if (visual.Category !== this.categoryName) continue;
      if (visual.Notes && String(visual.Notes).startsWith('HIDDEN')) continue;

      const visualId = String(visual.VisualID || visual.PK_ID || visual.id);
      const item = this.findItemByNameAndCategory(visual.Name, visual.Category, visual.Kind) ||
        this.organizedData.comments.find(i => i.id === `custom_${visualId}`) ||
        this.organizedData.limitations.find(i => i.id === `custom_${visualId}`) ||
        this.organizedData.deficiencies.find(i => i.id === `custom_${visualId}`);

      if (!item) continue;

      const key = `${visual.Category}_${item.id}`;

      // Get counts from various sources (already in memory)
      const localImages = this.bulkLocalImagesMap.get(visualId) || [];
      const pendingPhotos = this.bulkPendingPhotosMap.get(visualId) || [];

      // Set initial photo count (will be updated when server attachments load)
      const count = localImages.length + pendingPhotos.length;
      if (count > 0 && this.photoCountsByKey[key] === undefined) {
        this.photoCountsByKey[key] = count;
      }
    }

    // Also handle pending visuals with temp IDs
    for (const [entityId, localImages] of this.bulkLocalImagesMap.entries()) {
      if (!entityId.startsWith('temp_')) continue;
      if (localImages.length === 0) continue;

      // Find matching key from visualRecordIds
      const matchingKey = Object.entries(this.visualRecordIds)
        .find(([_, id]) => id === entityId)?.[0];

      if (matchingKey && this.photoCountsByKey[matchingKey] === undefined) {
        this.photoCountsByKey[matchingKey] = localImages.length;
      }
    }

    console.log(`[INITIAL COUNTS] Set photo counts for ${Object.keys(this.photoCountsByKey).length} visuals from LocalImages`);
  }

  private async waitForSkeletonsReady(): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        // Check if all photo counts have been determined (skeletons are ready)
        const allSkeletonsReady = this.areAllSkeletonsReady();

        console.log('[SKELETON CHECK] All skeletons ready:', allSkeletonsReady);

        if (allSkeletonsReady) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000); // Check every second

      // Safety timeout after 10 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        console.warn('[SKELETON CHECK] Timeout - showing page anyway');
        resolve();
      }, 10000);
    });
  }

  private areAllSkeletonsReady(): boolean {
    // Get all items that should have photos loaded
    const allItems = [
      ...this.organizedData.comments,
      ...this.organizedData.limitations,
      ...this.organizedData.deficiencies
    ];

    // If no items at all, we're ready
    if (allItems.length === 0) {
      return true;
    }

    // Count how many items have visual records (photos to load)
    let itemsWithVisuals = 0;
    let itemsWithCountsReady = 0;

    // Check each selected item to see if its skeleton count is set
    for (const item of allItems) {
      const key = `${item.category}_${item.id}`;

      // If item is selected/has a visual record
      if (this.selectedItems[key] || this.visualRecordIds[key]) {
        itemsWithVisuals++;

        // Check if photo count has been determined
        if (this.photoCountsByKey[key] !== undefined) {
          itemsWithCountsReady++;
        }
      }
    }

    console.log('[SKELETON CHECK] Items with visuals:', itemsWithVisuals, 'Counts ready:', itemsWithCountsReady);

    // If no items have visuals, we're ready immediately
    if (itemsWithVisuals === 0) {
      return true;
    }

    // All items with visuals have their counts determined
    return itemsWithCountsReady === itemsWithVisuals;
  }

  /**
   * Load category templates from pre-read cache (no IndexedDB read)
   */
  private loadCategoryTemplatesFromCache(allTemplates: any[]) {
    if (!allTemplates || allTemplates.length === 0) {
      console.warn('[CategoryDetail] No templates in cache');
      return;
    }
    
    // Filter for this category - pure CPU operation
    const visualTemplates = allTemplates.filter((template: any) =>
      template.TypeID === 1 && template.Category === this.categoryName
    );
    
    console.log('[CategoryDetail] Templates for', this.categoryName + ':', visualTemplates.length);

    // Organize into UI structure - pure CPU
    this.organizeTemplatesIntoData(visualTemplates);
  }

  /**
   * Organize templates into organizedData structure - pure CPU, instant
   */
  private organizeTemplatesIntoData(visualTemplates: any[]) {
    visualTemplates.forEach((template: any) => {
      // CRITICAL: Use TemplateID for consistent key matching with Dexie fields and dropdown lookup
      // PK_ID is internal record ID, TemplateID is cross-reference for Services_Visuals_Drop
      const effectiveTemplateId = template.TemplateID || template.PK_ID;

      const templateData: VisualItem = {
        id: effectiveTemplateId,
        templateId: effectiveTemplateId,
        name: template.Name || 'Unnamed Item',
        text: template.Text || '',
        originalText: template.Text || '',
        type: template.Kind || 'Comment',
        category: template.Category,
        answerType: template.AnswerType || 0,
        required: template.Required === 'Yes',
        answer: '',
        isSelected: false,
        photos: []
      };

      // Parse dropdown options if AnswerType is 2 (multi-select) and embedded in template
      // Note: Most dropdown options come from LPS_Services_Visuals_Drop via loadDropdownOptionsFromAPI()
      if (template.AnswerType === 2 && template.DropdownOptions) {
        try {
          const optionsArray = JSON.parse(template.DropdownOptions);
          this.visualDropdownOptions[effectiveTemplateId] = optionsArray;
        } catch (e) {
          // Options will be loaded from API instead
        }
      }

      // Add to appropriate section
      const kind = template.Kind || template.Type || 'Comment';
      if (kind === 'Comment') {
        this.organizedData.comments.push(templateData);
      } else if (kind === 'Limitation') {
        this.organizedData.limitations.push(templateData);
      } else if (kind === 'Deficiency') {
        this.organizedData.deficiencies.push(templateData);
      } else {
        this.organizedData.comments.push(templateData);
      }

      // Initialize selected state
      this.selectedItems[`${this.categoryName}_${effectiveTemplateId}`] = false;
    });
  }

  /**
   * Keep old method for compatibility - now calls new fast method
   */
  private async loadCategoryTemplates() {
    const allTemplates = await this.indexedDb.getCachedTemplates('visual') || [];
    this.loadCategoryTemplatesFromCache(allTemplates);
  }

  /**
   * FAST: Load visuals directly from IndexedDB cache - no pending request check
   * Optimized for instant display with deferred photo loading
   * CRITICAL FIX: Uses VisualTemplateID for reliable matching, prevents key collisions
   */
  private async loadExistingVisualsFromCache() {
    // USE PRE-LOADED BULK DATA - NO IndexedDB read here
    const visuals = this.bulkVisualsCache;
    console.log('[LOAD VISUALS FAST] Using pre-loaded visuals:', visuals.length);
    
    // Track which keys have already been assigned to prevent collisions
    const assignedKeys = new Set<string>();
    
    // Process each visual for this category - sync operation, fast
    for (const visual of visuals) {
      const category = visual.Category;
      const name = visual.Name;
      const kind = visual.Kind;
      const visualId = String(visual.VisualID || visual.PK_ID || visual.id);
      const templateId = visual.VisualTemplateID || visual.TemplateID;

      // Only process visuals for current category
      if (category !== this.categoryName) continue;
      
      // CRITICAL: Match by VisualTemplateID first (most reliable), then fall back to name
      let item: VisualItem | undefined;
      
      if (templateId) {
        // Try matching by template ID first (most reliable)
        item = this.findItemByTemplateId(Number(templateId));
        if (item) {
          console.log(`[LOAD VISUALS FAST] Matched visual ${visualId} by TemplateID ${templateId}`);
        }
      }
      
      // Fall back to name matching if template ID didn't match
      if (!item) {
        item = this.findItemByNameAndCategory(name, category, kind);
        if (item && templateId) {
          console.warn(`[LOAD VISUALS FAST] Visual ${visualId} TemplateID ${templateId} didn't match, fell back to name: "${name}"`);
        }
      }
      
      // Skip hidden visuals - but still store the mapping for unhiding later
      if (visual.Notes && String(visual.Notes).startsWith('HIDDEN')) {
        if (item) {
          const hiddenKey = `${category}_${item.id}`;
          // Only assign if not already assigned to prevent collision
          if (!assignedKeys.has(hiddenKey)) {
            this.visualRecordIds[hiddenKey] = visualId;
            assignedKeys.add(hiddenKey);
            console.log(`[LOAD VISUALS FAST] Stored HIDDEN visual ${visualId} at key ${hiddenKey}`);
          } else {
            console.warn(`[LOAD VISUALS FAST] ⚠️ COLLISION: Key ${hiddenKey} already assigned, visual ${visualId} orphaned`);
          }
        }
        continue;
      }

      // Find or create item (if not found above)
      if (!item) {
        // Custom visual - create dynamic item
        const customItem: VisualItem = {
          id: `custom_${visualId}`,
          templateId: 0,
          name: visual.Name || 'Custom Item',
          text: visual.Text || '',
          originalText: visual.Text || '',
          type: visual.Kind || 'Comment',
          category: visual.Category,
          answerType: 0,
          required: false,
          answer: visual.Answers || '',
          isSelected: true,
          photos: []
        };
        
        if (kind === 'Comment') this.organizedData.comments.push(customItem);
        else if (kind === 'Limitation') this.organizedData.limitations.push(customItem);
        else if (kind === 'Deficiency') this.organizedData.deficiencies.push(customItem);
        else this.organizedData.comments.push(customItem);
        
        item = customItem;
        console.log(`[LOAD VISUALS FAST] Created custom item for visual ${visualId}: "${name}"`);
      }

      const key = `${category}_${item.id}`;
      
      // CRITICAL: Check for key collision before assigning
      if (assignedKeys.has(key)) {
        console.error(`[LOAD VISUALS FAST] ⚠️ KEY COLLISION DETECTED! Key "${key}" already has visual ${this.visualRecordIds[key]}, visual ${visualId} (Name: "${name}") would overwrite it!`);
        // Create a custom item for this orphaned visual instead of overwriting
        const orphanedItem: VisualItem = {
          id: `orphan_${visualId}`,
          templateId: 0,
          name: visual.Name || 'Orphaned Item',
          text: visual.Text || '',
          originalText: visual.Text || '',
          type: visual.Kind || 'Comment',
          category: visual.Category,
          answerType: 0,
          required: false,
          answer: visual.Answers || '',
          isSelected: true,
          photos: []
        };
        
        if (kind === 'Comment') this.organizedData.comments.push(orphanedItem);
        else if (kind === 'Limitation') this.organizedData.limitations.push(orphanedItem);
        else if (kind === 'Deficiency') this.organizedData.deficiencies.push(orphanedItem);
        else this.organizedData.comments.push(orphanedItem);
        
        const orphanKey = `${category}_orphan_${visualId}`;
        this.visualRecordIds[orphanKey] = visualId;
        assignedKeys.add(orphanKey);
        this.selectedItems[orphanKey] = true;
        this.photoCountsByKey[orphanKey] = 0;
        this.loadingPhotosByKey[orphanKey] = true;
        console.log(`[LOAD VISUALS FAST] Created orphan item with key ${orphanKey} for visual ${visualId}`);
        continue;
      }
      
      this.visualRecordIds[key] = visualId;
      assignedKeys.add(key);
      
      // Restore edited values
      if (visual.Name) item.name = visual.Name;
      if (visual.Text) item.text = visual.Text;
      
      // Set selected state
      if (!item.answerType || item.answerType === 0) {
        this.selectedItems[key] = true;
      }
      if (item.answerType === 1 && visual.Answers) item.answer = visual.Answers;
      if (item.answerType === 2 && visual.Answers) {
        item.answer = visual.Answers;
        if (visual.Notes) item.otherValue = visual.Notes;
      }
      
      // FAST PATH: Set initial photo count to 0, load in background
      this.photoCountsByKey[key] = 0;
      this.loadingPhotosByKey[key] = true;
    }
    
    console.log(`[LOAD VISUALS FAST] Finished loading. Keys assigned: ${assignedKeys.size}, visualRecordIds entries: ${Object.keys(this.visualRecordIds).length}`);
    
    // Render immediately
    this.changeDetectorRef.detectChanges();
    
    // Load photos in background (non-blocking)
    this.loadAllPhotosInBackground(visuals);
  }

  /**
   * LAZY LOADING: Only populate photo counts, don't load actual images
   * Photos are loaded on-demand when user clicks to expand
   */
  private loadAllPhotosInBackground(visuals: any[]) {
    // Preserve accordion state before background loading starts
    this.isLoadingPhotosInBackground = true;
    this.preservedAccordionState = [...this.expandedAccordions];

    setTimeout(async () => {
      // Process synced visuals from cache
      for (const visual of visuals) {
        if (visual.Category !== this.categoryName) continue;
        if (visual.Notes && String(visual.Notes).startsWith('HIDDEN')) continue;

        const visualId = String(visual.VisualID || visual.PK_ID || visual.id);
        const item = this.findItemByNameAndCategory(visual.Name, visual.Category, visual.Kind) ||
          this.organizedData.comments.find(i => i.id === `custom_${visualId}`) ||
          this.organizedData.limitations.find(i => i.id === `custom_${visualId}`) ||
          this.organizedData.deficiencies.find(i => i.id === `custom_${visualId}`);

        if (!item) continue;

        const key = `${visual.Category}_${item.id}`;

        // LAZY LOADING: Only calculate count from bulk-loaded data (no image loading)
        // DEDUP: Avoid counting same photo from multiple sources
        const attachments = this.bulkAttachmentsMap.get(visualId) || [];
        const pendingPhotos = this.bulkPendingPhotosMap.get(visualId) || [];
        const localImages = this.bulkLocalImagesMap.get(visualId) || [];
        
        const uniqueIds = new Set<string>();
        for (const att of attachments) {
          const id = String(att.AttachID || att.attachId || '');
          if (id) uniqueIds.add(id);
        }
        for (const p of pendingPhotos) {
          const id = String(p.AttachID || p.attachId || '');
          if (id && !uniqueIds.has(id)) uniqueIds.add(id);
        }
        for (const img of localImages) {
          // Skip if local image has real attachId that's already counted
          if (img.attachId && uniqueIds.has(img.attachId)) continue;
          if (img.imageId && !uniqueIds.has(img.imageId)) uniqueIds.add(img.imageId);
        }
        this.photoCountsByKey[key] = uniqueIds.size;

        // AUTO-LOAD: If there are LocalImages (unsynced photos), load them immediately
        // This ensures photos captured before navigation persist and show on return
        if (localImages.length > 0) {
          console.log(`[LOAD PHOTOS] Auto-loading ${localImages.length} LocalImages for ${key} (visualId: ${visualId})`);
          this.loadPhotosForVisual(visualId, key).catch(err => {
            console.error('[LOAD PHOTOS] Auto-load failed for', key, err);
          });
        } else {
          // Photos will load when user clicks expand - NOT automatically
          this.loadingPhotosByKey[key] = false;
        }
      }

      // CRITICAL: Also process pending visuals with LocalImages (temp IDs)
      // Pending visuals aren't in the visuals array - they're restored from IndexedDB
      // We need to check bulkLocalImagesMap for any temp IDs that have photos
      for (const [entityId, localImages] of this.bulkLocalImagesMap.entries()) {
        // Skip non-temp IDs (already processed above)
        if (!entityId.startsWith('temp_')) continue;
        if (localImages.length === 0) continue;

        // CORRECT: Search visualRecordIds which stores the tempId
        // The tempId is stored in visualRecordIds[key], NOT on item._tempId
        let matchingKey: string | null = null;
        for (const [key, recordId] of Object.entries(this.visualRecordIds)) {
          if (recordId === entityId) {
            matchingKey = key;
            break;
          }
        }

        if (!matchingKey) {
          console.log(`[LOAD PHOTOS] No key found in visualRecordIds for temp ID: ${entityId}`);
          continue;
        }

        // Update photo count - only add LocalImages that aren't already counted
        // (existing count should be 0 for temp visuals, but be safe)
        const existingCount = this.photoCountsByKey[matchingKey] || 0;
        this.photoCountsByKey[matchingKey] = Math.max(existingCount, localImages.length);

        console.log(`[LOAD PHOTOS] Auto-loading ${localImages.length} LocalImages for PENDING visual ${matchingKey} (tempId: ${entityId})`);
        this.loadPhotosForVisual(entityId, matchingKey).catch(err => {
          console.error('[LOAD PHOTOS] Auto-load failed for pending', matchingKey, err);
        });
      }

      // Restore preserved accordion state before triggering change detection
      if (this.preservedAccordionState) {
        this.expandedAccordions = [...this.preservedAccordionState];
      }

      this.isLoadingPhotosInBackground = false;
      this.preservedAccordionState = null;
      this.changeDetectorRef.detectChanges();
    }, 200);  // 200ms delay to ensure pending photos are restored first
  }

  private async loadExistingVisuals() {
    try {
      console.log('[LOAD VISUALS] Loading existing visuals for serviceId:', this.serviceId);

      // Get all visuals for this service (slower path - includes pending)
      const visuals = await this.foundationData.getVisualsByService(this.serviceId);

      console.log('[LOAD VISUALS] Found', visuals.length, 'existing visuals');

      // CRITICAL: First pass - get all photo counts before loading any photos
      // This ensures all skeletons are rendered before the page shows
      const photoCountPromises: Promise<void>[] = [];

      // Process each visual
      for (const visual of visuals) {
        const category = visual.Category;
        const name = visual.Name;
        const kind = visual.Kind;
        const visualId = String(visual.VisualID || visual.PK_ID || visual.id);

        // CRITICAL: Only process visuals that belong to the current category
        // This prevents custom visuals from appearing in other categories
        if (category !== this.categoryName) {
          console.log('[LOAD VISUALS] Skipping visual from different category:', category, '(current:', this.categoryName + ')');
          continue;
        }

        // CRITICAL: Skip hidden visuals (soft delete - keeps photos but doesn't show in UI)
        // Check for HIDDEN marker (can be "HIDDEN" or "HIDDEN|{otherValue}" for multi-select)
        if (visual.Notes && visual.Notes.startsWith('HIDDEN')) {
          console.log('[LOAD VISUALS] Skipping hidden visual:', name, visualId);
          // Store visualRecordId so we can unhide it later if user reselects
          const tempKey = `${category}_${name}_${kind}`;
          // Try to find the template ID to use the correct key
          const templateItem = this.findItemByNameAndCategory(name, category, kind);
          if (templateItem) {
            const properKey = `${category}_${templateItem.id}`;
            this.visualRecordIds[properKey] = visualId;
          }
          continue;
        }

        // Find matching template by Name, Category, and Kind
        let item = this.findItemByNameAndCategory(name, category, kind);

        // If no template match found, this is a custom visual - create dynamic item
        if (!item) {
          console.log('[LOAD VISUALS] Creating dynamic item for custom visual:', name, category, kind);

          // Create a dynamic VisualItem for custom visuals
          const customItem: VisualItem = {
            id: `custom_${visualId}`, // Use visual ID as item ID
            templateId: 0, // No template
            name: visual.Name || 'Custom Item',
            text: visual.Text || '',
            originalText: visual.Text || '',
            type: visual.Kind || 'Comment',
            category: visual.Category,
            answerType: 0, // Default to text type
            required: false,
            answer: visual.Answers || '',
            isSelected: true, // Custom visuals are always selected
            photos: []
          };

          // Add to appropriate section based on Kind
          if (kind === 'Comment') {
            this.organizedData.comments.push(customItem);
          } else if (kind === 'Limitation') {
            this.organizedData.limitations.push(customItem);
          } else if (kind === 'Deficiency') {
            this.organizedData.deficiencies.push(customItem);
          } else {
            // Default to comments if kind is unknown
            this.organizedData.comments.push(customItem);
          }

          item = customItem;
        }

        const key = `${category}_${item.id}`;

        // Store the visual record ID (extract from response)
        this.visualRecordIds[key] = visualId;

        // CRITICAL: Restore edited Name and Text from saved visual
        if (visual.Name) {
          item.name = visual.Name;
        }
        if (visual.Text) {
          item.text = visual.Text;
        }

        // Set selected state for checkbox items
        if (!item.answerType || item.answerType === 0) {
          this.selectedItems[key] = true;
        }

        // Set answer for Yes/No dropdowns
        if (item.answerType === 1 && visual.Answers) {
          item.answer = visual.Answers;
        }

        // Set selected options for multi-select
        if (item.answerType === 2 && visual.Answers) {
          item.answer = visual.Answers;
          if (visual.Notes) {
            item.otherValue = visual.Notes;
          }
        }

        // CRITICAL: Fetch the photo count FIRST (fast - just metadata)
        // This ensures we have the real skeleton count before showing the page
        this.loadingPhotosByKey[key] = true;

        // Add promise to fetch the photo count WITH TIMEOUT to prevent hanging
        const countPromise = (async () => {
          try {
            // Wrap in timeout to prevent hanging - 5 seconds max
            const timeoutPromise = new Promise<any[]>((_, reject) => {
              setTimeout(() => reject(new Error('Timeout')), 5000);
            });
            
            const attachments = await Promise.race([
              this.foundationData.getVisualAttachments(visualId),
              timeoutPromise
            ]);
            
            const count = attachments.length;
            this.photoCountsByKey[key] = count;
            console.log(`[LOAD VISUALS] Set photo count for ${key}: ${count}`);
          } catch (err) {
            console.error(`[LOAD VISUALS] Error/timeout getting photo count for ${key}:`, err);
            this.photoCountsByKey[key] = 0; // Set to 0 on error so we don't wait forever
          }
        })();

        photoCountPromises.push(countPromise);
      }

      // CRITICAL: Wait for ALL photo counts to be fetched before proceeding
      // This ensures all skeletons are ready to render
      console.log('[LOAD VISUALS] Waiting for', photoCountPromises.length, 'photo counts...');
      await Promise.all(photoCountPromises);
      console.log('[LOAD VISUALS] All photo counts fetched');

      // Trigger change detection so skeleton counts are set
      this.changeDetectorRef.detectChanges();

      console.log('[LOAD VISUALS] Photo counts ready - skeletons will now render');

      // CRITICAL: Start loading photos in background but DON'T WAIT for them
      // This allows skeletons to show immediately while photos load progressively
      setTimeout(() => {
        console.log('[LOAD VISUALS] Starting background photo loading...');

        for (const visual of visuals) {
          const category = visual.Category;
          const name = visual.Name;
          const kind = visual.Kind;
          const visualId = String(visual.VisualID || visual.PK_ID || visual.id);

          if (category !== this.categoryName) {
            continue;
          }

          const item = this.findItemByNameAndCategory(name, category, kind) ||
                       this.organizedData.comments.find(i => i.id === `custom_${visualId}`) ||
                       this.organizedData.limitations.find(i => i.id === `custom_${visualId}`) ||
                       this.organizedData.deficiencies.find(i => i.id === `custom_${visualId}`);

          if (!item) continue;

          const key = `${category}_${item.id}`;

          // Load photos in background - no await, happens asynchronously
          this.loadPhotosForVisual(visualId, key).catch(err => {
            console.error('[LOAD VISUALS] Error loading photos for visual:', visualId, err);
          });
        }

        console.log('[LOAD VISUALS] All photo loads started in background');
      }, 100); // Small delay to ensure skeletons render before photo loading starts

      console.log('[LOAD VISUALS] Returning to show page with skeletons');

    } catch (error) {
      console.error('[LOAD VISUALS] Error loading existing visuals:', error);
    }
  }

  private findItemByNameAndCategory(name: string, category: string, kind: string): VisualItem | undefined {
    // Search in all three sections for matching name/category/kind
    const allItems = [
      ...this.organizedData.comments,
      ...this.organizedData.limitations,
      ...this.organizedData.deficiencies
    ];

    return allItems.find(item => {
      const nameMatch = item.name === name;
      const categoryMatch = item.category === category || category === this.categoryName;
      const kindMatch = item.type?.toLowerCase() === kind?.toLowerCase();
      return nameMatch && categoryMatch && kindMatch;
    });
  }

  private findItemByTemplateId(templateId: number): VisualItem | undefined {
    // Search in all three sections
    let item = this.organizedData.comments.find(i => i.templateId === templateId);
    if (item) return item;

    item = this.organizedData.limitations.find(i => i.templateId === templateId);
    if (item) return item;

    item = this.organizedData.deficiencies.find(i => i.templateId === templateId);
    return item;
  }

  /**
   * Load photos for a visual - ON-DEMAND when user clicks to expand
   * Only loads photo data when needed, not on initial page load
   * Uses guard to prevent concurrent/duplicate calls for the same key
   */
  private async loadPhotosForVisual(visualId: string, key: string): Promise<void> {
    // GUARD: Return existing promise if already loading this key
    // This prevents duplicate photos from concurrent calls
    if (this.loadingPhotoPromises.has(key)) {
      console.log('[LOAD PHOTOS] Already loading key:', key, '- returning existing promise');
      return this.loadingPhotoPromises.get(key);
    }
    
    // Create and track the promise
    const promise = this._loadPhotosForVisualImpl(visualId, key);
    this.loadingPhotoPromises.set(key, promise);
    
    try {
      await promise;
    } finally {
      this.loadingPhotoPromises.delete(key);
    }
  }

  /**
   * Internal implementation of loadPhotosForVisual
   * Called by the guarded wrapper above
   */
  private async _loadPhotosForVisualImpl(visualId: string, key: string): Promise<void> {
    try {
      this.loadingPhotosByKey[key] = true;
      this.changeDetectorRef.detectChanges();

      // ===== ON-DEMAND LOAD: Only fetch data when user expands =====
      // STEP 1: Get attachments from bulk cache (already loaded during initial load)
      const attachments = this.bulkAttachmentsMap.get(visualId) || [];

      // STEP 2: Get pending photos from bulk cache (old system)
      const pendingPhotos = this.bulkPendingPhotosMap.get(visualId) || [];
      
      // STEP 2.5 (NEW): Get LocalImages for this visual (new system)
      // CRITICAL FIX: Use bulk-loaded data with ID resolution (temp ID -> real ID already resolved)
      // DO NOT make fresh query - it won't find photos captured with temp IDs after visual syncs
      const localImages = this.bulkLocalImagesMap.get(visualId) || [];
      console.log('[LOAD PHOTOS] Found', localImages.length, 'LocalImages for visual', visualId, '(from bulkLocalImagesMap)');
      
      if (this.DEBUG) console.log('[LOAD PHOTOS] Visual', visualId, ':', attachments.length, 'synced,', pendingPhotos.length, 'pending,', localImages.length, 'local');

      // STEP 3: Load cached photo data NOW (on-demand, not upfront)
      // This is the key optimization - photo data only loads when needed
      if (this.bulkCachedPhotosMap.size === 0 || this.bulkAnnotatedImagesMap.size === 0) {
        const [cachedPhotos, annotatedImages] = await Promise.all([
          this.indexedDb.getAllCachedPhotosForService(this.serviceId),
          this.indexedDb.getAllCachedAnnotatedImagesForService()
        ]);
        this.bulkCachedPhotosMap = cachedPhotos;
        this.bulkAnnotatedImagesMap = annotatedImages;
      }

      // Calculate total photo count - DEDUP: Avoid counting same photo from multiple sources
      // Photos may appear in both localImages (new system) and attachments (synced to server)
      const uniquePhotoIds = new Set<string>();
      
      // Count attachments (synced photos from server)
      for (const att of attachments) {
        const attId = String(att.AttachID || att.attachId || '');
        if (attId) uniquePhotoIds.add(attId);
      }
      
      // Count pending photos (legacy system)
      for (const p of pendingPhotos) {
        const pendId = String(p.AttachID || p.attachId || '');
        if (pendId && !uniquePhotoIds.has(pendId)) uniquePhotoIds.add(pendId);
      }
      
      // Count local images (new system) - skip if already synced (attachId exists in uniquePhotoIds)
      for (const img of localImages) {
        // If local image has real attachId that's already counted, skip it
        if (img.attachId && uniquePhotoIds.has(img.attachId)) continue;
        // Otherwise count by imageId
        if (img.imageId && !uniquePhotoIds.has(img.imageId)) {
          uniquePhotoIds.add(img.imageId);
        }
      }
      
      // Set the photo count based on unique IDs (deduped across all sources)
      this.photoCountsByKey[key] = uniquePhotoIds.size;

      // CRITICAL FIX: During sync, preserve ALL existing photos to prevent disappearing
      // Only clear photos when NOT syncing to prevent duplicates on normal reloads
      const syncStatus = this.backgroundSync.syncStatus$.getValue();
      const syncInProgress = syncStatus.isSyncing;

      const existingPhotos = this.visualPhotos[key] || [];
      let preservedPhotos: any[];

      if (syncInProgress) {
        // SYNC IN PROGRESS: Preserve ALL photos to prevent disappearing
        // This is critical - photos should NEVER disappear during sync
        preservedPhotos = [...existingPhotos];
        console.log(`[LOAD PHOTOS] SYNC IN PROGRESS - preserving ALL ${preservedPhotos.length} existing photos for key: ${key}`);
      } else {
        // NOT syncing: Preserve photos that have valid displayUrls OR are in-progress captures
        // US-001 FIX: Must preserve photos with blob:/data: URLs to prevent disappearing after sync
        preservedPhotos = existingPhotos.filter(p => {
          // Always preserve in-progress captures
          if (p._isInProgressCapture === true && p.uploading === true) {
            return true;
          }
          // Preserve photos with valid blob or data URLs (local-first photos)
          if (p.displayUrl && (p.displayUrl.startsWith('blob:') || p.displayUrl.startsWith('data:'))) {
            return true;
          }
          // Preserve LocalImage photos (they have valid local references)
          if (p.isLocalImage || p.isLocalFirst || p.localImageId) {
            return true;
          }
          return false;
        });
        console.log(`[LOAD PHOTOS] Preserving ${preservedPhotos.length}/${existingPhotos.length} photos with valid URLs`);
      }

      // Start with preserved photos
      this.visualPhotos[key] = [...preservedPhotos];

      // Build a set of already loaded photo IDs from preserved photos
      const loadedPhotoIds = new Set<string>();
      for (const p of this.visualPhotos[key]) {
        if (p.AttachID) loadedPhotoIds.add(String(p.AttachID));
        if (p.attachId) loadedPhotoIds.add(String(p.attachId));
        if (p.id) loadedPhotoIds.add(String(p.id));
        if (p.imageId) loadedPhotoIds.add(String(p.imageId));
        if (p.localImageId) loadedPhotoIds.add(String(p.localImageId));
        if (p._pendingFileId) loadedPhotoIds.add(String(p._pendingFileId));
      }
      console.log(`[LOAD PHOTOS] Key ${key} starting with ${preservedPhotos.length} preserved photos (sync: ${syncInProgress})`);

      // STEP 4: Add pending photos with regenerated blob URLs (they appear first)
      // SILENT SYNC: Don't show uploading/queued indicators for legacy pending photos
      for (const pendingPhoto of pendingPhotos) {
        const pendingId = String(pendingPhoto.AttachID);
        if (!loadedPhotoIds.has(pendingId)) {
          // Use bulk annotated image cache (O(1) lookup)
          let displayUrl = pendingPhoto.displayUrl;
          if (pendingPhoto.hasAnnotations) {
            const cachedAnnotatedImage = this.bulkAnnotatedImagesMap.get(pendingId);
            if (cachedAnnotatedImage) {
              displayUrl = cachedAnnotatedImage;
            }
          }
          
          // Add to the BEGINNING of the array so pending photos show first
          this.visualPhotos[key].unshift({
            ...pendingPhoto,
            displayUrl: displayUrl,
            thumbnailUrl: displayUrl,
            isSkeleton: false,
            uploading: false,         // SILENT SYNC: No spinner
            queued: false,            // SILENT SYNC: No indicator
            isPending: true
          });
          loadedPhotoIds.add(pendingId);
        }
      }

      // STEP 4.5 (NEW): Add LocalImages to the array
      // These are photos captured with the new local-first system
      for (const localImage of localImages) {
        const imageId = localImage.imageId;
        
        // Skip if already loaded (by imageId or attachId)
        if (loadedPhotoIds.has(imageId) || (localImage.attachId && loadedPhotoIds.has(localImage.attachId))) {
          continue;
        }
        
        // Get display URL from LocalImageService
        let displayUrl = 'assets/img/photo-placeholder.png';
        try {
          displayUrl = await this.localImageService.getDisplayUrl(localImage);
        } catch (e) {
          console.warn('[LOAD PHOTOS] Failed to get LocalImage displayUrl:', e);
        }
        
        // Add to the BEGINNING of the array so local photos show first
        // SILENT SYNC: Don't show uploading/queued indicators - photos appear as normal
        this.visualPhotos[key].unshift({
          AttachID: localImage.attachId || localImage.imageId,
          attachId: localImage.attachId || localImage.imageId,
          id: localImage.attachId || localImage.imageId,
          imageId: localImage.imageId,
          localImageId: localImage.imageId,     // For refreshLocalState() lookup
          localBlobId: localImage.localBlobId,  // For blob URL regeneration
          displayUrl: displayUrl,
          url: displayUrl,
          thumbnailUrl: displayUrl,
          originalUrl: displayUrl,
          name: localImage.fileName,
          caption: localImage.caption || '',
          annotation: localImage.caption || '',
          Annotation: localImage.caption || '',
          Drawings: localImage.drawings || null,
          hasAnnotations: !!localImage.drawings && localImage.drawings.length > 10,
          loading: false,
          uploading: false,           // SILENT SYNC: Don't show spinner
          queued: false,              // SILENT SYNC: Don't show queued indicator
          isSkeleton: false,
          isPending: localImage.status !== 'verified',  // Internal flag only
          isLocalImage: true,         // Flag to identify new system photos
          isLocalFirst: true          // Flag for local-first system
        });
        loadedPhotoIds.add(imageId);
        // CRITICAL FIX: Also add attachId to prevent duplicates when server attachments are processed
        // After sync, LocalImage has attachId matching server's AttachID - must track both
        if (localImage.attachId) {
          loadedPhotoIds.add(localImage.attachId);
        }
        
        console.log('[LOAD PHOTOS] Added LocalImage (silent sync):', imageId, 'attachId:', localImage.attachId || 'none');
      }

      // Trigger change detection so pending/local photos appear immediately
      this.changeDetectorRef.detectChanges();

      if (attachments.length > 0) {
        // Check if all synced photos are already loaded
        const allPhotosLoaded = attachments.every((a: any) => loadedPhotoIds.has(String(a.AttachID)));
        if (allPhotosLoaded && pendingPhotos.length === 0) {
          this.loadingPhotosByKey[key] = false;
          this.changeDetectorRef.detectChanges();
          return;
        }

        // ============================================================
        // Use cached photos map (O(1) lookups)
        // ============================================================
        const cachedAttachments: any[] = [];
        const uncachedAttachments: any[] = [];

        // PHASE 1: Categorize attachments as cached or uncached
        for (const attach of attachments) {
          const attachIdStr = String(attach.AttachID);

          // Skip if already loaded (either pending or synced)
          if (loadedPhotoIds.has(attachIdStr)) {
            continue;
          }

          // Check bulk cache map (O(1)) 
          const cachedImage = this.bulkCachedPhotosMap.get(attachIdStr);
          if (cachedImage) {
            cachedAttachments.push({ attach, cachedImage });
          } else {
            uncachedAttachments.push(attach);
          }
        }

        // PHASE 2: Add cached photos to UI IMMEDIATELY (no network needed)
        for (const { attach, cachedImage } of cachedAttachments) {
          this.addCachedPhotoToArray(attach, cachedImage, key);
          loadedPhotoIds.add(String(attach.AttachID));
        }
        
        // Update UI with cached photos right away
        if (cachedAttachments.length > 0) {
          this.changeDetectorRef.detectChanges();
        }

        // PHASE 3: Download uncached photos in parallel batches (non-blocking)
        if (uncachedAttachments.length > 0) {
          await this.downloadPhotosInParallel(uncachedAttachments, key);
        }
      }

      // STEP 6 (NEW): Merge pending caption updates into loaded photos
      // This ensures captions added after photo creation are visible on page reload
      await this.mergePendingCaptionsIntoPhotos(key);

      this.loadingPhotosByKey[key] = false;
      this.changeDetectorRef.detectChanges();

    } catch (error) {
      console.error('[LOAD PHOTOS] Error loading photos for visual', visualId, error);
      this.loadingPhotosByKey[key] = false;
      this.photoCountsByKey[key] = 0; // Set to 0 on error so we don't wait forever
      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * Add a cached photo to the photos array immediately (no network call needed)
   * OPTIMIZED: Uses bulk annotated images map for O(1) lookup
   */
  private addCachedPhotoToArray(attach: any, cachedImage: string, key: string): void {
    const attachId = String(attach.AttachID);
    const hasDrawings = !!attach.Drawings && attach.Drawings.length > 10;
    
    // OPTIMIZED: Use bulk cache map (O(1)) instead of IndexedDB read
    let displayUrl = cachedImage;
    if (hasDrawings) {
      const cachedAnnotatedImage = this.bulkAnnotatedImagesMap.get(attachId);
      if (cachedAnnotatedImage) {
        displayUrl = cachedAnnotatedImage;
      }
    }
    
    const keyParts = key.split('_');
    const itemId = keyParts.length > 1 ? keyParts.slice(1).join('_') : key;
    const visualIdFromRecord = this.visualRecordIds[key];
    
    const photoData = {
      AttachID: attach.AttachID,
      id: attach.AttachID,
      VisualID: attach.VisualID || visualIdFromRecord || itemId,
      name: attach.Photo || 'photo.jpg',
      filePath: attach.Attachment || attach.Photo || '',
      Photo: attach.Attachment || attach.Photo || '',
      url: cachedImage,
      originalUrl: cachedImage,
      thumbnailUrl: cachedImage,
      displayUrl: displayUrl,
      caption: attach.Annotation || '',
      annotation: attach.Annotation || '',
      Annotation: attach.Annotation || '',
      hasAnnotations: hasDrawings,
      annotations: null,
      Drawings: attach.Drawings || null,
      rawDrawingsString: attach.Drawings || null,
      uploading: false,
      queued: false,
      isObjectUrl: false,
      isSkeleton: false
    };
    
    if (!this.visualPhotos[key]) {
      this.visualPhotos[key] = [];
    }
    this.visualPhotos[key].push(photoData);
  }

  /**
   * Download uncached photos in parallel batches for faster loading
   * Uses staggered loading: first 3 photos load immediately, rest load with 50ms delays
   * Updates UI after each batch completes
   */
  private async downloadPhotosInParallel(attachments: any[], key: string): Promise<void> {
    const IMMEDIATE_COUNT = 3; // Load first 3 immediately for fast visual feedback
    const BATCH_SIZE = 5; // Then download 5 at a time
    const STAGGER_DELAY_MS = 50; // Small delay between batches to prevent UI blocking

    // Load first 3 photos immediately (no delay) for fast visual feedback
    const immediatePhotos = attachments.slice(0, IMMEDIATE_COUNT);
    const remainingPhotos = attachments.slice(IMMEDIATE_COUNT);

    if (immediatePhotos.length > 0) {
      await Promise.all(immediatePhotos.map(attach =>
        this.loadSinglePhoto(attach, key).catch(err => {
          console.error('[DOWNLOAD] Failed:', attach.AttachID, err);
        })
      ));
      this.changeDetectorRef.detectChanges();
    }

    // Load remaining photos in staggered batches
    for (let i = 0; i < remainingPhotos.length; i += BATCH_SIZE) {
      // Small delay between batches to prevent UI blocking
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, STAGGER_DELAY_MS));
      }

      const batch = remainingPhotos.slice(i, i + BATCH_SIZE);

      // Download batch in parallel
      await Promise.all(batch.map(attach =>
        this.loadSinglePhoto(attach, key).catch(err => {
          console.error('[DOWNLOAD] Failed:', attach.AttachID, err);
        })
      ));

      // Update UI after each batch completes
      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * Merge pending caption updates into loaded photos
   * CRITICAL: This ensures captions added mid-sync or after photo creation are visible
   * Pending captions take precedence over cached values
   */
  private async mergePendingCaptionsIntoPhotos(key: string): Promise<void> {
    try {
      const photos = this.visualPhotos[key];
      if (!photos || photos.length === 0) {
        return;
      }

      // Get all attachment IDs for this visual's photos
      const attachIds = photos.map(p => String(p.AttachID));
      
      // Fetch pending captions for these attachments
      const pendingCaptions = await this.indexedDb.getPendingCaptionsForAttachments(attachIds);
      
      if (pendingCaptions.length === 0) {
        return;
      }
      
      console.log(`[MERGE CAPTIONS] Merging ${pendingCaptions.length} pending captions into ${photos.length} photos for key: ${key}`);
      
      // Apply pending captions to matching photos
      for (const photo of photos) {
        const photoId = String(photo.AttachID);
        const pendingCaption = pendingCaptions.find(c => c.attachId === photoId);
        
        if (pendingCaption) {
          // Update caption if pending
          if (pendingCaption.caption !== undefined) {
            console.log(`[MERGE CAPTIONS] Applying caption to photo ${photoId}: "${pendingCaption.caption?.substring(0, 30)}..."`);
            photo.caption = pendingCaption.caption;
            photo.Annotation = pendingCaption.caption;
          }
          
          // Update drawings if pending
          if (pendingCaption.drawings !== undefined) {
            console.log(`[MERGE CAPTIONS] Applying drawings to photo ${photoId}`);
            photo.Drawings = pendingCaption.drawings;
            photo.hasAnnotations = !!pendingCaption.drawings;
          }
        }
      }
    } catch (error) {
      console.error('[MERGE CAPTIONS] Error merging pending captions:', error);
      // Don't fail the load - captions will sync later
    }
  }

  /**
   * Load a single photo - BULLETPROOF version
   * NEVER removes or replaces a photo that has a valid displayUrl
   */
  private async loadSinglePhoto(attach: any, key: string): Promise<void> {
    try {
      const attachId = String(attach.AttachID || attach.PK_ID || '');
      
      // Skip invalid attachIds
      if (!attachId || attachId === 'undefined' || attachId === 'null') {
        return;
      }
      
      // Initialize array if needed
      if (!this.visualPhotos[key]) {
        this.visualPhotos[key] = [];
      }
      
      // BULLETPROOF: Check if ANY photo in this key's array has a valid displayUrl
      // Also check if this specific photo already exists with a valid URL
      const existingPhoto = this.visualPhotos[key].find(p => 
        String(p.AttachID) === attachId || 
        String(p.id) === attachId ||
        String(p.attachId) === attachId ||
        p.imageId === attachId
      );
      
      // If photo exists with valid URL, DON'T touch it - just return
      if (existingPhoto && existingPhoto.displayUrl && 
          existingPhoto.displayUrl !== 'assets/img/photo-placeholder.png' &&
          !existingPhoto.displayUrl.startsWith('assets/')) {
        this.logDebug('SKIP', `Photo ${attachId} already has valid URL`);
        return;
      }
      
      // Also check if we have a LocalImage that this server photo corresponds to
      // (The LocalImage may have been created with a different imageId)
      let localImage: LocalImage | null = null;
      try {
        localImage = await this.localImageService.getImageByAttachId(attachId);
        if (!localImage) {
          localImage = await this.localImageService.getImage(attachId);
        }
      } catch (e) {
        // Ignore - LocalImage system not available or failed
      }
      
      // If we found a LocalImage, check if it's already in the array by imageId
      if (localImage) {
        const localImageInArray = this.visualPhotos[key].find(p => p.imageId === localImage!.imageId);
        if (localImageInArray && localImageInArray.displayUrl &&
            localImageInArray.displayUrl !== 'assets/img/photo-placeholder.png') {
          // Just update the AttachID mapping, but DON'T change the displayUrl
          this.logDebug('SKIP', `Photo ${attachId} matches LocalImage ${localImage.imageId} with valid URL`);
      return;
    }
      }
      
      // Determine display URL
      let displayUrl = 'assets/img/photo-placeholder.png';
      let isLoading = false;
      
      // Step 1: Try LocalImage blob (local first)
      if (localImage && localImage.localBlobId) {
        try {
          displayUrl = await this.localImageService.getDisplayUrl(localImage);
          this.logDebug('LOCAL', `Photo ${attachId} from LocalImage blob`);
        } catch (e) {
          this.logDebug('WARN', `LocalImage getDisplayUrl failed: ${e}`);
        }
      }
      
      // Step 2: Try cached photo
      if (displayUrl === 'assets/img/photo-placeholder.png') {
        try {
          const cached = await this.indexedDb.getCachedPhoto(attachId);
          if (cached) {
            displayUrl = cached;
            this.logDebug('CACHE', `Photo ${attachId} from cache`);
          }
        } catch (e) {
          this.logDebug('WARN', `Cache check failed: ${e}`);
        }
      }
      
      // Step 3: Load from remote (non-blocking)
      const s3Key = attach.Attachment;
      const hasImageSource = attach.Attachment || attach.Photo;
      if (displayUrl === 'assets/img/photo-placeholder.png' && hasImageSource && this.offlineService.isOnline()) {
        isLoading = true;
        this.loadPhotoFromRemote(attachId, s3Key || attach.Photo, key, !!s3Key);
      }
      
      // Create photo data
      const photoData: any = {
        AttachID: attach.AttachID || attachId,
        attachId: attachId,
        id: attach.AttachID || attachId,
        imageId: localImage?.imageId || attachId,
        displayUrl: displayUrl,
        url: displayUrl,
        thumbnailUrl: displayUrl,
        originalUrl: displayUrl,
        name: attach.Photo || 'photo.jpg',
        caption: attach.Annotation || '',
        annotation: attach.Annotation || '',
        Annotation: attach.Annotation || '',
        Drawings: attach.Drawings || null,
        hasAnnotations: !!attach.Drawings && attach.Drawings.length > 10,
        loading: isLoading,
        uploading: false,
        queued: false,
        isSkeleton: false
      };
      
      // Find by any matching ID
      const existingIndex = this.visualPhotos[key].findIndex(p => 
        String(p.AttachID) === attachId || 
        String(p.id) === attachId ||
        String(p.attachId) === attachId ||
        (localImage && p.imageId === localImage.imageId)
      );
      
      if (existingIndex !== -1) {
        // BULLETPROOF: Never replace a valid URL with a placeholder
        const existing = this.visualPhotos[key][existingIndex];
        const existingHasValidUrl = existing.displayUrl &&
          existing.displayUrl !== 'assets/img/photo-placeholder.png' &&
          !existing.displayUrl.startsWith('assets/');

        // ===== US-002 FIX: DEXIE-FIRST - Explicitly preserve local blob URLs =====
        const isLocalBlobUrl = existing.displayUrl?.startsWith('blob:') || existing.displayUrl?.startsWith('data:');
        const isLocalFirst = existing.isLocalFirst || existing.isLocalImage;

        if (existingHasValidUrl || (isLocalFirst && isLocalBlobUrl)) {
          // Keep the existing valid URL (especially local blob URLs)
          photoData.displayUrl = existing.displayUrl;
          photoData.url = existing.displayUrl;
          photoData.thumbnailUrl = existing.displayUrl;
          photoData.originalUrl = existing.originalUrl || existing.displayUrl;
          photoData.loading = false;
          // Preserve local-first flags
          photoData.isLocalFirst = existing.isLocalFirst;
          photoData.isLocalImage = existing.isLocalImage;
          photoData.localImageId = existing.localImageId;
          photoData.localBlobId = existing.localBlobId;

        }
        // ===== END US-002 FIX =====

        // Merge but preserve displayUrl
        this.visualPhotos[key][existingIndex] = { ...existing, ...photoData };
      } else {
        // New photo - add it
        this.visualPhotos[key].push(photoData);
      }
      
      try {
        this.changeDetectorRef.detectChanges();
      } catch (e) {
        // View destroyed - ignore
      }
      
    } catch (err: any) {
      this.logDebug('ERROR', `loadSinglePhoto failed: ${err?.message || err}`);
    }
  }
  
  /**
   * Load photo from remote in background (non-blocking)
   */
  private async loadPhotoFromRemote(attachId: string, imageKey: string, key: string, isS3: boolean): Promise<void> {
    try {
      let imageUrl: string | null = null;
      
      // All photos should be S3 now, but handle both cases
      if (imageKey) {
        if (isS3 || this.caspioService.isS3Key(imageKey)) {
          imageUrl = await this.caspioService.getS3FileUrl(imageKey);
        } else {
          // Legacy: treat as S3 key anyway
          imageUrl = await this.caspioService.getS3FileUrl(imageKey);
        }
      }
      
      if (imageUrl) {
        // BULLETPROOF: Preload the image BEFORE updating the UI
        // This prevents "broken link" issues
        const loaded = await this.preloadImage(imageUrl);
        
        if (!loaded) {
          this.logDebug('WARN', `Image ${attachId} failed to preload, keeping placeholder`);
          return; // Keep placeholder, don't update UI with broken link
        }
        
        // Cache it (with serviceId and s3Key)
        try {
          await this.indexedDb.cachePhoto(attachId, this.serviceId, imageUrl, imageKey);
        } catch (e) {
          // Cache failed - still continue with display
          this.logDebug('WARN', `Cache failed for ${attachId}: ${e}`);
        }
        
        // ONLY update UI after image is confirmed loadable
        if (this.visualPhotos[key]) {
          const photoIndex = this.visualPhotos[key].findIndex(p =>
            String(p.AttachID) === attachId || String(p.id) === attachId
          );
          if (photoIndex !== -1) {
            const existingPhoto = this.visualPhotos[key][photoIndex];
            const currentUrl = existingPhoto.displayUrl;

            // ===== US-002 FIX: DEXIE-FIRST - Never replace local blob URL with server URL =====
            // If photo is local-first with valid blob: or data: URL, keep it
            if (existingPhoto.isLocalFirst || existingPhoto.isLocalImage) {
              const isLocalBlobUrl = currentUrl?.startsWith('blob:') || currentUrl?.startsWith('data:');
              if (isLocalBlobUrl) {
                return; // DEXIE-FIRST: Keep local blob URL
              }
            }
            // ===== END US-002 FIX =====

            // Check one more time that we're not replacing a valid URL
            if (currentUrl &&
                currentUrl !== 'assets/img/photo-placeholder.png' &&
                !currentUrl.startsWith('assets/')) {
              // Already have a valid URL - don't replace
              this.logDebug('SKIP', `Photo ${attachId} already has valid URL, not replacing`);
              return;
            }

            this.visualPhotos[key][photoIndex].displayUrl = imageUrl;
            this.visualPhotos[key][photoIndex].url = imageUrl;
            this.visualPhotos[key][photoIndex].thumbnailUrl = imageUrl;
            this.visualPhotos[key][photoIndex].loading = false;
            
            try {
              this.changeDetectorRef.detectChanges();
            } catch (e) {
              // View destroyed - ignore
            }
          }
        }
        
        this.logDebug('REMOTE', `Photo ${attachId} loaded from remote (verified)`);
      }
    } catch (err: any) {
      this.logDebug('ERROR', `Remote load failed for ${attachId}: ${err?.message || err}`);
    }
  }

  /**
   * Preload image from remote and transition UI only after success
   * Never updates displayUrl until image is verified loadable
   * US-002 FIX: NEVER replace a valid local blob URL with server URL (DEXIE-FIRST)
   */
  private async preloadAndTransition(
    attachId: string,
    imageKey: string,
    key: string,
    isS3: boolean
  ): Promise<void> {
    try {
      // ===== US-002 FIX: Check if photo has valid local blob URL (DEXIE-FIRST) =====
      // If photo is local-first with valid blob: or data: URL, do NOT replace with server URL
      const existingPhoto = this.visualPhotos[key]?.find(p =>
        String(p.attachId) === attachId || String(p.AttachID) === attachId
      );

      if (existingPhoto && existingPhoto.isLocalFirst && existingPhoto.displayUrl) {
        const isLocalBlobUrl = existingPhoto.displayUrl.startsWith('blob:') ||
                               existingPhoto.displayUrl.startsWith('data:');
        if (isLocalBlobUrl) {
          return; // DEXIE-FIRST: Keep local blob URL, don't replace with server URL
        }
      }
      // ===== END US-002 FIX =====

      let imageDataUrl: string;

      if (isS3 && this.caspioService.isS3Key(imageKey)) {
        // S3 image
        const s3Url = await this.caspioService.getS3FileUrl(imageKey);
        
        // Preload image first
        const preloaded = await this.preloadImage(s3Url);
        if (!preloaded) throw new Error('Preload failed');
        
        // Fetch as data URL for caching
        imageDataUrl = await this.fetchAsDataUrl(s3Url);
    } else {
        // Caspio Files API
        const imageData = await firstValueFrom(
          this.caspioService.getImageFromFilesAPI(imageKey)
        );
        if (!imageData || !imageData.startsWith('data:')) {
          throw new Error('Invalid image data from Files API');
        }
        imageDataUrl = imageData;
      }
      
      // Cache the image
      await this.indexedDb.cachePhoto(attachId, this.serviceId, imageDataUrl, isS3 ? imageKey : undefined);
      
      // NOW update UI (only after success)
      const photoIndex = this.visualPhotos[key]?.findIndex(p => 
        String(p.attachId) === attachId || String(p.AttachID) === attachId
      );
      
      if (photoIndex !== -1) {
        const existingPhoto = this.visualPhotos[key][photoIndex];

        // Check for cached annotated image
        let finalDisplayUrl = imageDataUrl;
        if (existingPhoto.hasAnnotations) {
          try {
            const cachedAnnotated = await this.indexedDb.getCachedAnnotatedImage(attachId);

            // ===== US-001 DEBUG: Annotation loading from cachedAnnotatedImages =====
            const annotDebugMsg = `CACHED ANNOTATION CHECK\n` +
              `attachId: ${attachId}\n` +
              `hasAnnotations flag: ${existingPhoto.hasAnnotations}\n` +
              `cachedAnnotated found: ${!!cachedAnnotated}\n` +
              `cachedAnnotated type: ${cachedAnnotated?.substring(0, 30)}...`;
            this.logDebug('ANNOTATION', annotDebugMsg);
            // ===== END US-001 DEBUG =====

            if (cachedAnnotated) {
              finalDisplayUrl = cachedAnnotated;
            }
          } catch (e) { /* ignore */ }
        }

        this.visualPhotos[key][photoIndex] = {
          ...existingPhoto,
          url: imageDataUrl,
          originalUrl: imageDataUrl,
          thumbnailUrl: imageDataUrl,
          displayUrl: finalDisplayUrl,
          displayState: 'cached',
          loading: false
        };

    this.changeDetectorRef.detectChanges();
        console.log('[PRELOAD] ✅ Transitioned to cached image:', attachId);
      }
    } catch (err) {
      console.warn('[PRELOAD] Failed, keeping current display:', attachId, err);
      
      // Mark as remote (failed to load) but don't change displayUrl
      const photoIndex = this.visualPhotos[key]?.findIndex(p => 
        String(p.attachId) === attachId || String(p.AttachID) === attachId
      );
      
      if (photoIndex !== -1) {
        this.visualPhotos[key][photoIndex] = {
          ...this.visualPhotos[key][photoIndex],
          displayState: 'remote',
          loading: false
        };
        this.changeDetectorRef.detectChanges();
      }
    }
  }

  /**
   * Preload an image to verify it's loadable before switching
   */
  private preloadImage(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
      
      // Timeout after 30 seconds
      setTimeout(() => resolve(false), 30000);
    });
  }

  /**
   * Fetch image URL and convert to base64 data URL
   */
  private async fetchAsDataUrl(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const blob = await response.blob();
    return this.blobToDataUrl(blob);
  }

  /**
   * Restore pending visuals and photos from IndexedDB
   * Called on page load to show items that were created offline but not yet synced
   */
  private async restorePendingPhotosFromIndexedDB(): Promise<void> {
    try {
      console.log('[RESTORE PENDING] Using pre-loaded pending data...');

      // STEP 1: Restore pending VISUAL records first - USE PRE-LOADED DATA
      const pendingVisuals = this.bulkPendingRequestsCache.filter(r =>
        r.type === 'CREATE' &&
        r.endpoint?.includes('LPS_Services_Visuals') &&
        r.status !== 'synced' &&
        r.data?.ServiceID === parseInt(this.serviceId, 10) &&
        r.data?.Category === this.categoryName
      );

      console.log('[RESTORE PENDING] Found', pendingVisuals.length, 'pending visual records');

      // For each pending visual, find matching item and mark as selected
      for (const pendingVisual of pendingVisuals) {
        const visualData = pendingVisual.data;
        const tempId = pendingVisual.tempId;

        // Find the matching item by name, category, and kind
        const matchingItem = this.findItemByNameAndCategory(
          visualData.Name,
          visualData.Category,
          visualData.Kind
        );

        if (matchingItem) {
          const key = `${visualData.Category}_${matchingItem.id}`;

          console.log('[RESTORE PENDING] Restoring visual:', key, 'tempId:', tempId);

          // Mark as selected
          this.selectedItems[key] = true;

          // Store the temp visual ID
          this.visualRecordIds[key] = tempId || '';

          // Initialize photo array if needed
          if (!this.visualPhotos[key]) {
            this.visualPhotos[key] = [];
          }
        } else {
          console.log('[RESTORE PENDING] No matching item found for visual:', visualData.Name);
        }
      }

      // STEP 2: Restore pending photos - USE PRE-LOADED DATA
      if (this.bulkPendingPhotosMap.size === 0) {
        console.log('[RESTORE PENDING] No pending photos found');
        this.changeDetectorRef.detectChanges();
        return;
      }

      console.log('[RESTORE PENDING] Found pending photos for', this.bulkPendingPhotosMap.size, 'visuals');

      // For each visual ID, find the matching key and add photos
      for (const [visualId, photos] of this.bulkPendingPhotosMap) {
        // Find the key for this visual ID
        let matchingKey: string | null = null;

        // First check direct match in visualRecordIds
        for (const key of Object.keys(this.visualRecordIds)) {
          if (String(this.visualRecordIds[key]) === visualId) {
            matchingKey = key;
            break;
          }
        }

        // If not found, the visual might have been synced - check if real ID exists
        if (!matchingKey) {
          // Check if there's a real ID mapping for this temp visual
          const realId = await this.indexedDb.getRealId(visualId);
          if (realId) {
            for (const key of Object.keys(this.visualRecordIds)) {
              if (String(this.visualRecordIds[key]) === realId) {
                matchingKey = key;
                console.log('[RESTORE PENDING] Found via real ID mapping:', visualId, '→', realId);
                break;
              }
            }
          }
        }

        if (!matchingKey) {
          console.log('[RESTORE PENDING] No matching key found for visual:', visualId);
          continue;
        }

        console.log('[RESTORE PENDING] Restoring', photos.length, 'photos for key:', matchingKey);

        // Initialize array if needed
        if (!this.visualPhotos[matchingKey]) {
          this.visualPhotos[matchingKey] = [];
        }

        // Add pending photos that aren't already in the array
        for (const pendingPhoto of photos) {
          const pendingAttachIdStr = String(pendingPhoto.AttachID);
          const pendingFileIdStr = pendingPhoto._pendingFileId ? String(pendingPhoto._pendingFileId) : null;
          
          // CRITICAL FIX: Use String() conversion for consistent comparison to avoid type mismatch duplicates
          const existingIndex = this.visualPhotos[matchingKey].findIndex(p =>
            String(p.AttachID) === pendingAttachIdStr ||
            (pendingFileIdStr && String(p._pendingFileId) === pendingFileIdStr)
          );

          if (existingIndex === -1) {
            console.log('[RESTORE PENDING] Adding pending photo:', pendingPhoto.AttachID);
            // NOTE: Cached annotated images will be loaded on-demand when user expands photos
            this.visualPhotos[matchingKey].push(pendingPhoto);
          } else {
            console.log('[RESTORE PENDING] Photo already exists:', pendingPhoto.AttachID);
          }
        }

        // Update photo count
        this.photoCountsByKey[matchingKey] = this.visualPhotos[matchingKey].length;

        // Also mark item as selected if it has photos
        if (!this.selectedItems[matchingKey] && this.visualPhotos[matchingKey].length > 0) {
          this.selectedItems[matchingKey] = true;
        }
      }

      this.changeDetectorRef.detectChanges();
      console.log('[RESTORE PENDING] Pending data restored');

    } catch (error) {
      console.error('[RESTORE PENDING] Error restoring pending data:', error);
    }
  }

  // Item selection for all answer types
  isItemSelected(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;

    // For answerType 0 (checkbox items), check selectedItems dictionary
    if (this.selectedItems[key]) {
      return true;
    }

    // For answerType 1 (Yes/No) and answerType 2 (multi-select), check if item has an answer
    const item = this.findItemById(itemId);
    if (!item) {
      return false;
    }

    // For answerType 1: Check if answer is selected (Yes or No)
    if (item.answerType === 1 && item.answer && item.answer !== '') {
      return true;
    }

    // For answerType 2: Check if any options are selected
    if (item.answerType === 2 && item.answer && item.answer !== '') {
      return true;
    }

    return false;
  }

  private findItemById(itemId: string | number): VisualItem | undefined {
    // Search in all three sections
    const allItems = [
      ...this.organizedData.comments,
      ...this.organizedData.limitations,
      ...this.organizedData.deficiencies
    ];

    return allItems.find(item => item.id === itemId);
  }

  async toggleItemSelection(category: string, itemId: string | number) {
    const key = `${category}_${itemId}`;
    const newState = !this.selectedItems[key];
    this.selectedItems[key] = newState;

    console.log('[TOGGLE] Item:', key, 'Selected:', newState);

    // Set cooldown to prevent cache invalidation from causing UI flash
    this.startLocalOperationCooldown();

    // DEXIE-FIRST: Write-through to visualFields for instant reactive update
    // MUST await to prevent race condition where liveQuery fires before write completes
    const templateId = typeof itemId === 'string' ? parseInt(itemId, 10) : itemId;
    try {
      await this.visualFieldRepo.setField(this.serviceId, category, templateId, {
        isSelected: newState
      });
      console.log('[TOGGLE] Persisted isSelected to Dexie:', newState);
    } catch (err) {
      console.error('[TOGGLE] Failed to write to Dexie:', err);
    }

    if (newState) {
      // Item was checked - create visual record if it doesn't exist, or unhide if it exists
      const visualId = this.visualRecordIds[key];
      if (visualId && !String(visualId).startsWith('temp_')) {
        // Visual exists but was hidden - unhide it
        this.savingItems[key] = true;
        try {
          await this.foundationData.updateVisual(visualId, { Notes: '' }, this.serviceId);
          console.log('[TOGGLE] Unhid visual:', visualId);
          
          // CRITICAL: Load photos for this visual since they weren't loaded when hidden
          // Check if photos are already loaded
          if (!this.visualPhotos[key] || this.visualPhotos[key].length === 0) {
            console.log('[TOGGLE] Loading photos for unhidden visual:', visualId);
            this.loadingPhotosByKey[key] = true;
            this.photoCountsByKey[key] = 0;
            this.changeDetectorRef.detectChanges();
            
            // Load photos in background
            this.loadPhotosForVisual(visualId, key).then(() => {
              console.log('[TOGGLE] Photos loaded for unhidden visual:', visualId);
              this.changeDetectorRef.detectChanges();
            }).catch(err => {
              console.error('[TOGGLE] Error loading photos for unhidden visual:', err);
              this.loadingPhotosByKey[key] = false;
              this.changeDetectorRef.detectChanges();
            });
          }
        } catch (error) {
          console.error('[TOGGLE] Error unhiding visual:', error);
          this.selectedItems[key] = false;
          // Toast removed per user request
          // await this.showToast('Failed to show selection', 'danger');
        }
        this.savingItems[key] = false;
      } else if (!visualId) {
        // No visual record exists - create new one
        this.savingItems[key] = true;
        await this.saveVisualSelection(category, itemId);
        this.savingItems[key] = false;
      }
    } else {
      // Item was unchecked - hide visual instead of deleting (keeps photos intact)
      const visualId = this.visualRecordIds[key];
      if (visualId && !String(visualId).startsWith('temp_')) {
        this.savingItems[key] = true;
        try {
          // OFFLINE-FIRST: This now queues the update and returns immediately
          await this.foundationData.updateVisual(visualId, { Notes: 'HIDDEN' }, this.serviceId);
          // Keep visualRecordIds and visualPhotos intact for when user reselects
          console.log('[TOGGLE] Hid visual (queued for sync):', visualId);
        } catch (error) {
          console.error('[TOGGLE] Error hiding visual:', error);
          // Revert selection on error
          this.selectedItems[key] = true;
          // Toast removed per user request
          // await this.showToast('Failed to hide selection', 'danger');
        }
        this.savingItems[key] = false;
      } else if (visualId && String(visualId).startsWith('temp_')) {
        // For temp IDs (created offline, not yet synced), just update local state
        console.log('[TOGGLE] Hidden temp visual (not yet synced):', visualId);
        // Clear selection but keep the visual data for potential re-select
      }
    }

  }

  // Answer change for Yes/No dropdowns (answerType 1)
  async onAnswerChange(category: string, item: VisualItem) {
    const key = `${category}_${item.id}`;
    console.log('[ANSWER] Changed:', item.answer, 'for', key);

    // DEXIE-FIRST: Write-through to visualFields for instant reactive update
    this.visualFieldRepo.setField(this.serviceId, category, item.templateId, {
      answer: item.answer || '',
      isSelected: !!(item.answer && item.answer !== '')
    }).catch(err => {
      console.error('[ANSWER] Failed to write to Dexie:', err);
    });

    this.savingItems[key] = true;

    try {
      // Create or update visual record
      let visualId = this.visualRecordIds[key];

      // If answer is empty/cleared, hide the visual instead of deleting
      if (!item.answer || item.answer === '') {
        if (visualId && !String(visualId).startsWith('temp_')) {
          await this.foundationData.updateVisual(visualId, {
            Answers: '',
            Notes: 'HIDDEN'
          }, this.serviceId);
          console.log('[ANSWER] Hid visual (queued for sync):', visualId);
        }
        this.savingItems[key] = false;
        return;
      }

      if (!visualId) {
        // Create new visual
        const serviceIdNum = parseInt(this.serviceId, 10);
        const visualData = {
          ServiceID: serviceIdNum,
          Category: category,
          Kind: item.type,
          Name: item.name,
          Text: item.text || item.originalText || '',
          Notes: '',
          Answers: item.answer || ''
        };

        const result = await this.foundationData.createVisual(visualData);
        const visualId = String(result.VisualID || result.PK_ID || result.id);
        this.visualRecordIds[key] = visualId;
        console.log('[ANSWER] Created visual:', visualId);
      } else if (!String(visualId).startsWith('temp_')) {
        // Update existing visual and unhide if it was hidden
        await this.foundationData.updateVisual(visualId, {
          Answers: item.answer || '',
          Notes: ''
        }, this.serviceId);
        console.log('[ANSWER] Updated visual:', visualId);
        
        // CRITICAL: Load photos if visual was previously hidden
        const key = `${category}_${item.id}`;
        if (!this.visualPhotos[key] || this.visualPhotos[key].length === 0) {
          console.log('[ANSWER] Loading photos for unhidden visual:', visualId);
          this.loadPhotosForVisual(visualId, key).catch(err => {
            console.error('[ANSWER] Error loading photos:', err);
          });
        }
      }
    } catch (error) {
      console.error('[ANSWER] Error saving answer:', error);
      // Toast removed per user request
      // await this.showToast('Failed to save answer', 'danger');
    }

    this.savingItems[key] = false;
  }

  // Multi-select option toggle (answerType 2)
  async onOptionToggle(category: string, item: VisualItem, option: string, event: any) {
    const key = `${category}_${item.id}`;
    const isChecked = event.detail.checked;

    console.log('[OPTION] Toggled:', option, 'Checked:', isChecked, 'for', key);

    // Update the answer string
    let selectedOptions: string[] = [];
    if (item.answer) {
      selectedOptions = item.answer.split(',').map(o => o.trim()).filter(o => o);
    }

    if (isChecked) {
      if (!selectedOptions.includes(option)) {
        selectedOptions.push(option);
      }
    } else {
      selectedOptions = selectedOptions.filter(o => o !== option);
    }

    item.answer = selectedOptions.join(', ');

    // DEXIE-FIRST: Write-through to visualFields for instant reactive update
    this.visualFieldRepo.setField(this.serviceId, category, item.templateId, {
      answer: item.answer,
      isSelected: selectedOptions.length > 0 || !!(item.otherValue && item.otherValue !== '')
    }).catch(err => {
      console.error('[OPTION] Failed to write to Dexie:', err);
    });

    // Save to database
    this.savingItems[key] = true;

    try {
      let visualId = this.visualRecordIds[key];

      // If all options are unchecked AND no "Other" value, hide the visual
      if ((!item.answer || item.answer === '') && (!item.otherValue || item.otherValue === '')) {
        if (visualId && !String(visualId).startsWith('temp_')) {
          await this.foundationData.updateVisual(visualId, {
            Answers: '',
            Notes: 'HIDDEN'
          }, this.serviceId);
          console.log('[OPTION] Hid visual (queued for sync):', visualId);
        }
        this.savingItems[key] = false;
        return;
      }

      if (!visualId) {
        // Create new visual
        const serviceIdNum = parseInt(this.serviceId, 10);
        const visualData = {
          ServiceID: serviceIdNum,
          Category: category,
          Kind: item.type,
          Name: item.name,
          Text: item.text || item.originalText || '',
          Notes: item.otherValue || '',  // Store "Other" value in Notes
          Answers: item.answer
        };

        const result = await this.foundationData.createVisual(visualData);
        const newVisualId = String(result.VisualID || result.PK_ID || result.id);
        this.visualRecordIds[key] = newVisualId;

        // DEXIE-FIRST: Store tempVisualId in Dexie for persistence
        await this.visualFieldRepo.setField(this.serviceId, category, item.templateId, {
          tempVisualId: newVisualId
        });

        console.log('[OPTION] Created visual:', newVisualId);
      } else if (!String(visualId).startsWith('temp_')) {
        // Update existing visual and unhide if it was hidden
        const notesValue = item.otherValue || '';
        await this.foundationData.updateVisual(visualId, {
          Answers: item.answer,
          Notes: notesValue
        }, this.serviceId);
        console.log('[OPTION] Updated visual:', visualId);
      } else {
        // Temp ID - update the pending request
        const notesValue = item.otherValue || '';
        await this.foundationData.updateVisual(visualId, {
          Answers: item.answer,
          Notes: notesValue
        }, this.serviceId);
        console.log('[OPTION] Updated temp visual:', visualId);
      }
    } catch (error) {
      console.error('[OPTION] Error saving option:', error);
      // Toast removed per user request
      // await this.showToast('Failed to save option', 'danger');
    }

    this.savingItems[key] = false;
  }

  isOptionSelectedV1(item: VisualItem, option: string): boolean {
    if (!item.answer) return false;
    const selectedOptions = item.answer.split(',').map(o => o.trim());
    return selectedOptions.includes(option);
  }

  async onMultiSelectOtherChange(category: string, item: VisualItem) {
    const key = `${category}_${item.id}`;
    console.log('[OTHER] Value changed:', item.otherValue, 'for', key);

    this.savingItems[key] = true;

    try {
      // DEXIE-FIRST: Save otherValue to Dexie immediately for persistence across reloads
      await this.visualFieldRepo.setField(this.serviceId, category, item.templateId, {
        otherValue: item.otherValue || '',
        isSelected: true  // Selecting "Other" means the item is selected
      });
      console.log('[OTHER] Saved otherValue to Dexie:', item.otherValue);

      let visualId = this.visualRecordIds[key];

      // If "Other" value is empty AND no options selected, hide the visual
      if ((!item.otherValue || item.otherValue === '') && (!item.answer || item.answer === '')) {
        // Update Dexie to reflect unselected state
        await this.visualFieldRepo.setField(this.serviceId, category, item.templateId, {
          otherValue: '',
          isSelected: false
        });

        if (visualId && !String(visualId).startsWith('temp_')) {
          await this.foundationData.updateVisual(visualId, {
            Answers: '',
            Notes: 'HIDDEN'
          }, this.serviceId);
          console.log('[OTHER] Hid visual (queued for sync):', visualId);
        }
        this.savingItems[key] = false;
        return;
      }

      if (!visualId) {
        // Create new visual
        const serviceIdNum = parseInt(this.serviceId, 10);
        const visualData = {
          ServiceID: serviceIdNum,
          Category: category,
          Kind: item.type,
          Name: item.name,
          Text: item.text || item.originalText || '',
          Notes: item.otherValue || '',  // Store "Other" value in Notes
          Answers: item.answer || ''
        };

        const result = await this.foundationData.createVisual(visualData);
        const newVisualId = String(result.VisualID || result.PK_ID || result.id);
        this.visualRecordIds[key] = newVisualId;

        // DEXIE-FIRST: Store tempVisualId in Dexie
        await this.visualFieldRepo.setField(this.serviceId, category, item.templateId, {
          tempVisualId: newVisualId
        });

        console.log('[OTHER] Created visual:', newVisualId);
      } else if (!String(visualId).startsWith('temp_')) {
        // Update existing visual and unhide if it was hidden
        await this.foundationData.updateVisual(visualId, {
          Notes: item.otherValue || '',
          Answers: item.answer || ''
        }, this.serviceId);
        console.log('[OTHER] Updated visual:', visualId);
      } else {
        // Temp ID - update the pending request
        await this.foundationData.updateVisual(visualId, {
          Notes: item.otherValue || '',
          Answers: item.answer || ''
        }, this.serviceId);
        console.log('[OTHER] Updated temp visual:', visualId);
      }
    } catch (error) {
      console.error('[OTHER] Error saving other value:', error);
      // Toast removed per user request
      // await this.showToast('Failed to save other value', 'danger');
    }

    this.savingItems[key] = false;
  }

  isItemSaving(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.savingItems[key] || false;
  }

  // ============================================
  // PHOTO RETRIEVAL AND DISPLAY METHODS
  // ============================================

  getPhotosForVisual(category: string, itemId: string | number): any[] {
    const key = `${category}_${itemId}`;
    const photos = this.visualPhotos[key] || [];

    if (photos.length > 0) {
      if (!this._loggedPhotoKeys) this._loggedPhotoKeys = new Set();
      if (!this._loggedPhotoKeys.has(key)) {
        this._loggedPhotoKeys.add(key);
        console.log(`[PHOTO] Photos for ${key}:`, photos.length);
      }
    }

    return photos;
  }

  isLoadingPhotosForVisual(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.loadingPhotosByKey[key] === true;
  }

  getExpectedPhotoCount(category: string, itemId: string | number): number {
    const key = `${category}_${itemId}`;
    return this.photoCountsByKey[key] || 0;
  }

  // Get total photo count to display (shows expected count immediately, updates if more photos added)
  getTotalPhotoCount(category: string, itemId: string | number): number {
    const key = `${category}_${itemId}`;
    const expectedCount = this.photoCountsByKey[key] || 0;
    const actualCount = (this.visualPhotos[key] || []).length;
    // Return the maximum to handle both initial load (shows expected) and new uploads (shows actual)
    return Math.max(expectedCount, actualCount);
  }

  // ===== LAZY IMAGE LOADING METHODS =====
  
  /**
   * Check if photos are expanded for a visual
   */
  isPhotosExpanded(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.expandedPhotos[key] === true;
  }

  /**
   * Toggle photos expansion - expands and loads photos on first click
   */
  togglePhotoExpansion(category: string, itemId: string | number): void {
    const key = `${category}_${itemId}`;
    
    if (this.expandedPhotos[key]) {
      // Collapse
      this.expandedPhotos[key] = false;
    } else {
      // Expand and load photos if not already loaded
      this.expandedPhotos[key] = true;
      
      // Only load photos if we haven't loaded them yet
      const visualId = this.visualRecordIds[key];
      if (visualId && (!this.visualPhotos[key] || this.visualPhotos[key].length === 0)) {
        this.loadPhotosForVisual(visualId, key).catch(err => {
          console.error('[EXPAND] Error loading photos:', err);
        });
      }
    }
    
    this.changeDetectorRef.detectChanges();
  }

  /**
   * Expand photos for a visual
   */
  expandPhotos(category: string, itemId: string | number): void {
    const key = `${category}_${itemId}`;
    this.expandedPhotos[key] = true;
    
    // Load photos if not already loaded
    const visualId = this.visualRecordIds[key];
    if (visualId && (!this.visualPhotos[key] || this.visualPhotos[key].length === 0)) {
      this.loadPhotosForVisual(visualId, key).catch(err => {
        console.error('[EXPAND] Error loading photos:', err);
      });
    }
    
    this.changeDetectorRef.detectChanges();
  }

  /**
   * Collapse photos for a visual
   */
  collapsePhotos(category: string, itemId: string | number): void {
    const key = `${category}_${itemId}`;
    this.expandedPhotos[key] = false;
    this.changeDetectorRef.detectChanges();
  }

  getSkeletonArray(category: string, itemId: string | number): any[] {
    const count = this.getExpectedPhotoCount(category, itemId);
    return Array(count).fill({ isSkeleton: true });
  }

  isUploadingPhotos(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.uploadingPhotosByKey[key] || false;
  }

  getUploadingCount(category: string, itemId: string | number): number {
    const key = `${category}_${itemId}`;
    const photos = this.visualPhotos[key] || [];
    return photos.filter(p => p.uploading).length;
  }

  /**
   * TrackBy function for photos - uses stable imageId if available
   * CRITICAL: Using a stable key prevents Angular from remounting components
   * which causes the "disappear then reappear" issue
   */
  trackByPhotoId(index: number, photo: any): string {
    // MUST return stable UUID - NEVER fall back to index (causes re-renders)
    // Priority: imageId (new local-first) > _tempId > AttachID > generated emergency ID
    const stableId = photo.imageId || photo._tempId || photo.AttachID || photo.id;
    if (stableId) {
      return String(stableId);
    }
    // Generate emergency stable ID from available data - never use index
    console.warn('[trackBy] Photo missing stable ID, generating emergency ID:', photo);
    return `photo_${photo.VisualID || photo.PointID || 'unknown'}_${photo.fileName || photo.Photo || index}`;
  }

  // NOTE: handleImageError and handleImageLoad are defined at the end of the file
  // with comprehensive fallback logic (see IMAGE LOAD/ERROR HANDLERS section)

  saveScrollBeforePhotoClick(event: Event): void {
    // This method is still called from HTML but now handled in viewPhoto() instead
    // Keeping the method to avoid template errors
  }

  // ============================================================================
  // NEW LOCAL-FIRST IMAGE SYSTEM HELPERS
  // ============================================================================

  /**
   * Create a photo using the new local-first system
   * Returns a stable imageId that can be used as UI key
   */
  async createLocalImage(
    file: File,
    visualId: string,
    key: string,
    caption: string = '',
    drawings: string = ''
  ): Promise<LocalImage> {
    const localImage = await this.localImageService.captureImage(
      file,
      'visual',
      visualId,
      this.serviceId,
      caption,
      drawings
    );

    // Get display URL
    const displayUrl = await this.localImageService.getDisplayUrl(localImage);

    // Add to visualPhotos for immediate UI display
    if (!this.visualPhotos[key]) {
      this.visualPhotos[key] = [];
    }

    const photoData: any = {
      // Stable ID from new system
      imageId: localImage.imageId,
      
      // Legacy fields for compatibility
      AttachID: localImage.imageId, // Use imageId as AttachID for now
      id: localImage.imageId,
      
      // Display info
      displayUrl: displayUrl,
      url: displayUrl,
      thumbnailUrl: displayUrl,
      
      // Status from new system
      status: localImage.status,
      isLocal: !!localImage.localBlobId,
      
      // Metadata
      caption: caption,
      annotation: caption,
      Annotation: caption,
      Drawings: drawings,
      hasAnnotations: !!drawings && drawings.length > 10,
      
      // UI state
      uploading: localImage.status === 'uploading' || localImage.status === 'queued',
      loading: false,
      isObjectUrl: true
    };

    this.visualPhotos[key].push(photoData);
    this.changeDetectorRef.detectChanges();

    console.log('[LOCAL IMAGE] Created:', localImage.imageId, 'for key:', key);
    return localImage;
  }

  /**
   * Get display URL for a photo (works with both old and new system)
   */
  async getPhotoDisplayUrl(photo: any): Promise<string> {
    // If this is a new-system photo with imageId
    if (photo.imageId) {
      const localImage = await this.localImageService.getImage(photo.imageId);
      if (localImage) {
        return this.localImageService.getDisplayUrl(localImage);
      }
    }
    
    // Fall back to existing displayUrl
    return photo.displayUrl || photo.url || photo.thumbnailUrl || 'assets/img/photo-placeholder.png';
  }

  /**
   * Refresh photo display URL after sync
   * Called when status changes to update from local blob to remote
   */
  async refreshPhotoDisplayUrl(imageId: string, key: string): Promise<void> {
    const localImage = await this.localImageService.getImage(imageId);
    if (!localImage) return;

    const photoIndex = this.visualPhotos[key]?.findIndex(p => p.imageId === imageId);
    if (photoIndex === -1) return;

    const newDisplayUrl = await this.localImageService.getDisplayUrl(localImage);
    
    this.visualPhotos[key][photoIndex] = {
      ...this.visualPhotos[key][photoIndex],
      displayUrl: newDisplayUrl,
      url: newDisplayUrl,
      thumbnailUrl: newDisplayUrl,
      status: localImage.status,
      isLocal: !!localImage.localBlobId,
      uploading: localImage.status === 'uploading' || localImage.status === 'queued',
      AttachID: localImage.attachId || localImage.imageId // Update with real AttachID if available
    };

    this.changeDetectorRef.detectChanges();
  }

  // ============================================
  // CAMERA AND GALLERY CAPTURE METHODS
  // ============================================

  async addPhotoFromCamera(category: string, itemId: string | number) {
    // Set cooldown to prevent cache invalidation from causing UI flash
    this.startLocalOperationCooldown();
    
    try {
      // Capture photo with camera
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera
      });

      if (image.webPath) {
        // Convert to blob/file
        const response = await fetch(image.webPath);
        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);

        // Open photo editor directly
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

        // Handle annotated photo returned from annotator
        const { data } = await modal.onWillDismiss();

        if (data && data.annotatedBlob) {
          // User saved the annotated photo - upload ORIGINAL (not annotated) and save annotations separately
          const annotatedBlob = data.blob || data.annotatedBlob;
          const annotationsData = data.annotationData || data.annotationsData;
          const caption = data.caption || '';

          // CRITICAL: Upload the ORIGINAL photo, not the annotated one
          const originalFile = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });

          // Compress image before storage
          const originalSize = originalFile.size;
          const compressedFile = await this.imageCompression.compressImage(originalFile, {
            maxSizeMB: 0.8,
            maxWidthOrHeight: 1280,
            useWebWorker: true
          }) as File;
          const compressedSize = compressedFile.size;

          // Get or create visual ID
          const key = `${category}_${itemId}`;
          let visualId = this.visualRecordIds[key];

          if (!visualId) {
            await this.saveVisualSelection(category, itemId);
            visualId = this.visualRecordIds[key];
          }

          if (!visualId) {
            console.error('[CAMERA UPLOAD] Failed to create visual record');
            return;
          }

          // Compress annotations BEFORE creating photo entry
          let compressedDrawings = '';
          if (annotationsData) {
            if (typeof annotationsData === 'object') {
              compressedDrawings = compressAnnotationData(JSON.stringify(annotationsData));
            } else if (typeof annotationsData === 'string') {
              compressedDrawings = compressAnnotationData(annotationsData);
            }
          }

          // ============================================
          // NEW LOCAL-FIRST IMAGE SYSTEM
          // Uses stable UUID that NEVER changes
          // ============================================
          
          this.logDebug('CAPTURE', `Starting captureImage for visualId: ${visualId}`);

          // RACE CONDITION FIX: Suppress liveQuery during camera capture
          // Without this, liveQuery fires after Dexie write but BEFORE we push to visualPhotos,
          // causing populatePhotosFromDexie to add a duplicate entry with the original (non-annotated) URL
          this.isCameraCaptureInProgress = true;

          // Create LocalImage with stable UUID (this stores blob + creates outbox item)
          let localImage: LocalImage;
          try {
            localImage = await this.localImageService.captureImage(
              compressedFile,  // Use compressed file
              'visual',
              String(visualId),
              this.serviceId,
              caption,
              compressedDrawings
            );
            
            this.logDebug('CAPTURE', `✅ LocalImage created: ${localImage.imageId} status: ${localImage.status} blobId: ${localImage.localBlobId}`);
            console.log('[CAMERA UPLOAD] ✅ Created LocalImage with stable ID:', localImage.imageId);
          } catch (captureError: any) {
            this.logDebug('ERROR', `captureImage FAILED: ${captureError?.message || captureError}`);
            console.error('[CAMERA UPLOAD] Failed to create LocalImage:', captureError);
            throw captureError;
          }

          // Get display URL from LocalImageService (always uses local blob first)
          const displayUrl = await this.localImageService.getDisplayUrl(localImage);

          // ===== US-001 DEBUG: Photo upload - LocalImage creation and displayUrl =====
          const uploadDebugMsg = `PHOTO UPLOAD SUCCESS\n` +
            `imageId: ${localImage.imageId}\n` +
            `entityId (visualId): ${localImage.entityId}\n` +
            `status: ${localImage.status}\n` +
            `localBlobId: ${localImage.localBlobId}\n` +
            `displayUrl: ${displayUrl?.substring(0, 80)}...\n` +
            `displayUrl type: ${displayUrl?.startsWith('blob:') ? 'BLOB' : displayUrl?.startsWith('data:') ? 'DATA' : 'OTHER'}\n` +
            `key: ${key}\n` +
            `hasAnnotations: ${!!annotationsData}`;
          this.logDebug('UPLOAD', uploadDebugMsg);
          // ===== END US-001 DEBUG =====

          // For annotated images, create a separate display URL showing annotations
          let annotatedDisplayUrl = displayUrl;
          if (annotatedBlob) {
            annotatedDisplayUrl = URL.createObjectURL(annotatedBlob);
          }

          // Initialize photo array if it doesn't exist
          if (!this.visualPhotos[key]) {
            this.visualPhotos[key] = [];
          }

          // Ensure loading flag is false so photo displays immediately
          this.loadingPhotosByKey[key] = false;

          // Create photo entry using STABLE imageId as the key
          const photoEntry = {
            // STABLE ID - never changes, safe for UI key
            imageId: localImage.imageId,
            
            // For compatibility with existing code
            AttachID: localImage.imageId,
            attachId: localImage.imageId,
            id: localImage.imageId,
            
            // Display URLs
            url: displayUrl,
            displayUrl: annotatedDisplayUrl,
            originalUrl: displayUrl,
            thumbnailUrl: annotatedDisplayUrl,
            
            // Metadata
            name: 'camera-photo.jpg',
            caption: caption || '',
            annotation: caption || '',
            Annotation: caption || '',
            Drawings: compressedDrawings,
            hasAnnotations: !!annotationsData,
            
            // Status from LocalImage system - SILENT SYNC
            status: localImage.status,
            isLocal: true,
            isLocalFirst: true,
            isLocalImage: true,
            isObjectUrl: true,
            uploading: false,         // SILENT SYNC: No spinner
            queued: false,            // SILENT SYNC: No indicator
            isPending: localImage.status !== 'verified',
            isSkeleton: false,
            progress: 0
          };

          // TASK 5 FIX: Check for duplicates before adding photo
          // This prevents extra broken images when uploading photos
          const existingIndex = this.visualPhotos[key].findIndex((p: any) =>
            p.imageId === localImage.imageId ||
            p.AttachID === localImage.imageId ||
            p.id === localImage.imageId
          );

          if (existingIndex === -1) {
            // Add photo to UI immediately (no duplicate found)
            this.visualPhotos[key].push(photoEntry);
            console.log('[CAMERA UPLOAD] ✅ Photo added (silent sync):', localImage.imageId);
          } else {
            // Duplicate found - update existing entry instead of adding
            console.log('[CAMERA UPLOAD] ⚠️ Photo already exists, updating:', localImage.imageId);
            this.visualPhotos[key][existingIndex] = { ...this.visualPhotos[key][existingIndex], ...photoEntry };
          }

          // Expand photos section so user can see the newly added photo
          this.expandPhotos(category, itemId);
          this.changeDetectorRef.detectChanges();

          // RACE CONDITION FIX: Re-enable liveQuery now that photo is in visualPhotos
          this.isCameraCaptureInProgress = false;

          console.log(`  key: ${key}`);
          console.log(`  imageId: ${localImage.imageId}`);
          console.log(`  AttachID: ${photoEntry.AttachID}`);
          console.log(`  id: ${photoEntry.id}`);
          console.log(`  Total photos in key: ${this.visualPhotos[key].length}`);

          // Cache annotated image for thumbnail persistence across navigation
          // STORAGE FIX: Only cache if REAL annotations exist (not just empty canvas data)
          // Fabric.js serializes to {"version":"x","objects":[...]} - check if objects array has items
          let hasRealAnnotations = false;
          if (annotationsData) {
            try {
              const parsed = typeof annotationsData === 'string' ? JSON.parse(annotationsData) : annotationsData;
              hasRealAnnotations = parsed?.objects && Array.isArray(parsed.objects) && parsed.objects.length > 0;
              console.log(`[CAMERA UPLOAD] Annotation check: objects=${parsed?.objects?.length || 0}, hasReal=${hasRealAnnotations}`);
            } catch (e) {
              // If can't parse, check string length as fallback
              const annotationStr = typeof annotationsData === 'string' ? annotationsData : JSON.stringify(annotationsData);
              hasRealAnnotations = annotationStr.length > 500; // Much higher threshold for unparseable data
              console.log(`[CAMERA UPLOAD] Annotation check (fallback): length=${annotationStr.length}, hasReal=${hasRealAnnotations}`);
            }
          }

          if (annotatedBlob && hasRealAnnotations) {
            try {
              const base64 = await this.indexedDb.cacheAnnotatedImage(localImage.imageId, annotatedBlob);
              console.log('[CAMERA UPLOAD] ✅ Annotated image cached for thumbnail persistence');
              if (base64) {
                this.bulkAnnotatedImagesMap.set(localImage.imageId, base64);
              }
            } catch (cacheErr) {
              console.warn('[CAMERA UPLOAD] Failed to cache annotated image:', cacheErr);
            }
          } else if (annotatedBlob) {
            console.log('[CAMERA UPLOAD] Skipping annotation cache - no real drawings detected');
          }

          // Sync will happen on next 60-second interval via upload outbox
        }

        // Clean up blob URL
        URL.revokeObjectURL(imageUrl);
      }
    } catch (error) {
      // RACE CONDITION FIX: Ensure flag is reset on error
      this.isMultiImageUploadInProgress = false;

      // Check if user cancelled - don't show error for cancellations
      const errorMessage = typeof error === 'string' ? error : (error as any)?.message || '';
      const isCancelled = errorMessage.includes('cancel') ||
                         errorMessage.includes('Cancel') ||
                         errorMessage.includes('User') ||
                         error === 'User cancelled photos app';

      if (!isCancelled) {
        console.error('Error capturing photo from camera:', error);
      }
    }
  }

  async addPhotoFromGallery(category: string, itemId: string | number) {
    // Set cooldown to prevent cache invalidation from causing UI flash
    this.startLocalOperationCooldown();

    try {
      // Use pickImages to allow multiple photo selection
      // STORAGE OPTIMIZATION: Lower picker quality since we compress to 0.8MB anyway
      // User never sees this temp file - only the final compressed version
      // quality: 70 reduces temp file from ~3.5MB to ~1.5MB with no visible difference
      const images = await Camera.pickImages({
        quality: 70,
        limit: 0 // 0 = no limit on number of photos
      });

      if (images.photos && images.photos.length > 0) {
        const key = `${category}_${itemId}`;

        // Initialize photo array if it doesn't exist
        if (!this.visualPhotos[key]) {
          this.visualPhotos[key] = [];
        }

        // Ensure loading flag is false so photos display immediately
        this.loadingPhotosByKey[key] = false;

        console.log('[GALLERY UPLOAD] Starting upload for', images.photos.length, 'photos');

        // Create visual record if it doesn't exist
        let visualId = this.visualRecordIds[key];
        if (!visualId) {
          await this.saveVisualSelection(category, itemId);
          visualId = this.visualRecordIds[key];
        }

        if (!visualId) {
          console.error('[GALLERY UPLOAD] Failed to create visual record');
          return;
        }

        // ============================================
        // US-003 FIX: IMMEDIATE UPLOAD WITH DUPLICATE PREVENTION
        // Photos are added to UI immediately so user can view them right away.
        // batchUploadImageIds tracks added photos to prevent liveQuery duplicates.
        // ============================================

        // Set batch flag to suppress liveQuery change detection during processing
        // batchUploadImageIds tracks added photos to prevent liveQuery duplicates
        this.isMultiImageUploadInProgress = true;
        this.batchUploadImageIds.clear();

        try {
          // Process each photo with LocalImageService
          for (let i = 0; i < images.photos.length; i++) {
            const image = images.photos[i];

            // US-001 FIX: Add small delay between processing photos on mobile
            // This helps prevent timing issues where the last image's blob isn't ready yet
            if (i > 0) {
              await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
            }

            if (image.webPath) {
              try {
                console.log(`[GALLERY UPLOAD] Processing photo ${i + 1}/${images.photos.length}`);

                // Fetch the blob
                const response = await fetch(image.webPath);
                const blob = await response.blob();

                // US-001 FIX: Validate blob has content before creating File
                // On mobile, gallery-selected images (especially the last in a batch)
                // can have empty or corrupt blob data due to timing issues
                if (!blob || blob.size === 0) {
                  console.error(`[GALLERY UPLOAD] US-001: Photo ${i + 1} has empty blob data - skipping`);
                  continue;
                }

                const file = new File([blob], `gallery-${Date.now()}_${i}.jpg`, { type: 'image/jpeg' });

                // US-001 FIX: Double-check file size after File creation
                if (file.size === 0) {
                  console.error(`[GALLERY UPLOAD] US-001: Photo ${i + 1} file size is 0 after creation - skipping`);
                  continue;
                }

                // Compress image before storage
                const compressedFile = await this.imageCompression.compressImage(file, {
                  maxSizeMB: 0.8,
                  maxWidthOrHeight: 1280,
                  useWebWorker: true
                }) as File;

                // Create LocalImage with stable UUID
                const localImage = await this.localImageService.captureImage(
                  compressedFile,  // Use compressed file
                  'visual',
                  String(visualId),
                  this.serviceId,
                  '', // caption
                  ''  // drawings
                );

                console.log(`[GALLERY UPLOAD] ✅ Created LocalImage ${i + 1} with stable ID:`, localImage.imageId);

                // US-003 FIX: Track this imageId to prevent duplicates from liveQuery race
                this.batchUploadImageIds.add(localImage.imageId);

                // Get display URL from LocalImageService
                const displayUrl = await this.localImageService.getDisplayUrl(localImage);

                // Create photo entry using STABLE imageId as the key
                const photoEntry = {
                  // STABLE ID - never changes, safe for UI key
                  imageId: localImage.imageId,

                  // For compatibility with existing code
                  AttachID: localImage.imageId,
                  attachId: localImage.imageId,
                  id: localImage.imageId,

                  // Display URLs
                  url: displayUrl,
                  displayUrl: displayUrl,
                  originalUrl: displayUrl,
                  thumbnailUrl: displayUrl,

                  // Metadata
                  name: `photo_${i}.jpg`,
                  caption: '',
                  annotation: '',
                  Annotation: '',
                  Drawings: '',
                  hasAnnotations: false,

                  // Status from LocalImage system - SILENT SYNC
                  status: localImage.status,
                  isLocal: true,
                  isLocalFirst: true,
                  isLocalImage: true,
                  isObjectUrl: true,
                  uploading: false,         // SILENT SYNC: No spinner
                  queued: false,            // SILENT SYNC: No indicator
                  isPending: localImage.status !== 'verified',
                  isSkeleton: false,
                  progress: 0
                };

                // US-003 FIX: Check for duplicates in existing photos
                // batchUploadImageIds tracks what we've added to prevent liveQuery duplicates
                const existingIndex = this.visualPhotos[key].findIndex((p: any) =>
                  p.imageId === localImage.imageId ||
                  p.AttachID === localImage.imageId ||
                  p.id === localImage.imageId
                );
                const alreadyTracked = this.batchUploadImageIds.has(localImage.imageId);

                if (existingIndex === -1 && !alreadyTracked) {
                  // IMMEDIATE UI UPDATE: Add photo to UI right away so user can view it
                  // Track in batchUploadImageIds to prevent liveQuery from adding duplicates
                  this.batchUploadImageIds.add(localImage.imageId);
                  // Must run inside Angular zone - Camera.pickImages() runs outside zone
                  this.ngZone.run(() => {
                    this.visualPhotos[key].push(photoEntry);
                    this.changeDetectorRef.detectChanges();
                  });
                  console.log(`[GALLERY UPLOAD] ✅ Photo ${i + 1} added to UI immediately:`, localImage.imageId);
                } else {
                  // Duplicate found - skip or update existing
                  console.log(`[GALLERY UPLOAD] ⚠️ Photo ${i + 1} duplicate detected, skipping:`, localImage.imageId);
                }
                console.log(`  key: ${key}`);
                console.log(`  imageId: ${localImage.imageId}`);

                // NOTE: Capacitor temp files cannot be deleted via JS on iOS
                // iOS will clean them up automatically when storage pressure occurs
                // We've reduced quality to 50 to minimize temp file size (~1.5MB vs ~3.5MB)

              } catch (error) {
                console.error(`[GALLERY UPLOAD] Error processing photo ${i + 1}:`, error);
              }
            }
          }

          // Photos are now added immediately in the loop above
          // batchUploadImageIds prevents duplicates from liveQuery

        } finally {
          // US-003 FIX: Always reset batch flag, even if error occurs
          this.isMultiImageUploadInProgress = false;
          this.batchUploadImageIds.clear();

          // Expand photos section so user can see the newly added photos
          this.expandPhotos(category, itemId);

          // Trigger single change detection after batch completes
          this.changeDetectorRef.detectChanges();
        }

        console.log(`[GALLERY UPLOAD] ✅ All ${images.photos.length} photos processed with stable IDs`);
        console.log(`[GALLERY UPLOAD] Total photos in key: ${this.visualPhotos[key].length}`);
        // Sync will happen on next 60-second interval via upload outbox
      }
    } catch (error) {
      // Check if user cancelled - don't show error for cancellations
      const errorMessage = typeof error === 'string' ? error : (error as any)?.message || '';
      const isCancelled = errorMessage.includes('cancel') ||
                         errorMessage.includes('Cancel') ||
                         errorMessage.includes('User') ||
                         error === 'User cancelled photos app';

      if (!isCancelled) {
        console.error('Error selecting photo from gallery:', error);
      }
    }
  }

  private triggerFileInput(source: 'camera' | 'library' | 'system', options: { allowMultiple?: boolean; capture?: string } = {}): void {
    if (!this.fileInput) {
      console.error('File input not found');
      return;
    }

    const input = this.fileInput.nativeElement;
    input.accept = 'image/*';
    input.multiple = options.allowMultiple || false;

    if (source === 'camera') {
      input.setAttribute('capture', 'environment');
    } else {
      input.removeAttribute('capture');
    }

    input.click();
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }

    const files = Array.from(input.files);
    console.log(`[FILE INPUT] Selected ${files.length} file(s)`);

    if (!this.currentUploadContext) {
      console.error('[FILE INPUT] No upload context!');
      return;
    }

    const { category, itemId } = this.currentUploadContext;
    const key = `${category}_${itemId}`;

    // Get or create visual ID
    let visualId = this.visualRecordIds[key];
    if (!visualId) {
      await this.saveVisualSelection(category, itemId);
      visualId = this.visualRecordIds[key];
    }

    if (visualId) {
      for (const file of files) {
        await this.uploadPhotoForVisual(visualId, file, key, true, null, null, '');
      }
    }

    // Clear the input
    input.value = '';
    this.currentUploadContext = null;
  }

  // ============================================
  // PHOTO UPLOAD METHODS
  // ============================================

  async uploadPhotoForVisual(visualId: string, photo: File, key: string, isBatchUpload: boolean = false, annotationData: any = null, originalPhoto: File | null = null, caption: string = '', existingTempId?: string): Promise<string | null> {
    const category = key.split('_')[0];

    // Compress the photo before upload
    const originalSize = photo.size;
    const compressedPhoto = await this.imageCompression.compressImage(photo, {
      maxSizeMB: 0.8,
      maxWidthOrHeight: 1280,
      useWebWorker: true
    }) as File;
    const compressedSize = compressedPhoto.size;

    const uploadFile = compressedPhoto || photo;
    const actualVisualId = this.visualRecordIds[key] || visualId;
    const isPendingVisual = !actualVisualId || actualVisualId === '__pending__' || String(actualVisualId).startsWith('temp_');

    let tempId: string | undefined;

    if (actualVisualId && actualVisualId !== 'undefined') {
      if (!this.visualPhotos[key]) {
        this.visualPhotos[key] = [];
      }

      // CRITICAL: If existingTempId is provided, use that instead of creating a new temp photo
      // This is used when we already have a skeleton placeholder in the UI
      if (existingTempId) {
        tempId = existingTempId;
        console.log('[UPLOAD] Using existing skeleton placeholder:', tempId);

        // Photo should already be in the array with uploading state from addPhotoFromGallery
        // Just verify it exists
        const existingIndex = this.visualPhotos[key].findIndex(p => p.AttachID === tempId || p.id === tempId);
        if (existingIndex === -1) {
          console.warn('[UPLOAD] Skeleton not found, will create new temp photo');
          tempId = undefined; // Fall back to creating new temp photo
        }
      }

      // Only create a new temp photo if we don't have an existing one
      if (!tempId) {
        const objectUrl = URL.createObjectURL(photo);
        tempId = `temp_${Date.now()}_${Math.random()}`;
        const photoData: any = {
          AttachID: tempId,
          id: tempId,
          name: photo.name,
          url: objectUrl,
          thumbnailUrl: objectUrl,
          isObjectUrl: true,
          uploading: !isPendingVisual,
          queued: isPendingVisual,
          hasAnnotations: !!annotationData,
          annotations: annotationData || null,
          caption: caption || '',
          annotation: caption || ''
        };
        this.visualPhotos[key].push(photoData);
        console.log('[UPLOAD] Created new temp photo:', tempId);
      }

      this.changeDetectorRef.detectChanges();

      if (isPendingVisual) {
        if (!this.pendingPhotoUploads[key]) {
          this.pendingPhotoUploads[key] = [];
        }

        this.pendingPhotoUploads[key].push({
          file: uploadFile,
          annotationData,
          originalPhoto,
          isBatchUpload,
          tempId,
          caption: caption || ''
        });

        this.showToast('Photo queued and will upload when syncing resumes.', 'warning');
        return null;
      }
    }

    try {
      const visualIdNum = parseInt(actualVisualId, 10);

      if (isNaN(visualIdNum)) {
        throw new Error(`Invalid VisualID: ${actualVisualId}`);
      }

      const attachId = await this.performVisualPhotoUpload(visualIdNum, uploadFile, key, true, annotationData, originalPhoto, tempId, caption);
      return attachId;

    } catch (error) {
      console.error('Failed to prepare upload:', error);
      // Toast removed per user request
      // await this.showToast('Failed to prepare photo upload', 'danger');
      return null;
    }
  }

  private async performVisualPhotoUpload(visualId: number, photo: File, key: string, isBatchUpload: boolean, annotationData: any, originalPhoto: File | null, tempId: string | undefined, caption: string): Promise<string | null> {
    try {
      console.log(`[PHOTO UPLOAD] Starting LOCAL-FIRST upload for VisualID ${visualId}`);

      // CRITICAL: Pass annotations as serialized JSON string (drawings)
      const drawings = annotationData ? JSON.stringify(annotationData) : '';
      const result = await this.foundationData.uploadVisualPhoto(visualId, photo, caption, drawings, originalPhoto || undefined, this.serviceId);

      console.log(`[PHOTO UPLOAD] Upload complete for VisualID ${visualId}, imageId: ${result.imageId}, AttachID: ${result.AttachID}`);

      // LOCAL-FIRST: The result contains a local blob URL that should NOT be revoked
      // The displayUrl is from LocalImageService and points to the local blob
      // DO NOT try to get server URLs - they don't exist yet (offline-first)
      
      if (tempId && this.visualPhotos[key]) {
        const photoIndex = this.visualPhotos[key].findIndex(p => p.AttachID === tempId || p.id === tempId || p.imageId === tempId);
        if (photoIndex !== -1) {
          // LOCAL-FIRST: Do NOT revoke the blob URL - it's our only source of the image!
          // The old code revoked blob URLs, causing images to disappear
          // const oldUrl = this.visualPhotos[key][photoIndex].url;
          // if (oldUrl && oldUrl.startsWith('blob:')) {
          //   URL.revokeObjectURL(oldUrl);  // DON'T DO THIS!
          // }

          // LOCAL-FIRST: Use the displayUrl from the result (already a local blob URL)
          // No need to fetch from server - the photo will sync in background
          const displayableUrl = result.displayUrl || result.url || result.thumbnailUrl;

          console.log('[PHOTO UPLOAD] LOCAL-FIRST: Using local blob URL:', displayableUrl?.substring(0, 50));

          this.visualPhotos[key][photoIndex] = {
            ...this.visualPhotos[key][photoIndex],
            // STABLE IDs: Use imageId as the primary key (never changes)
            imageId: result.imageId,
            AttachID: result.AttachID || result.imageId,
            id: result.AttachID || result.imageId,
            // Keep identifiers for lookups
            _tempId: result.imageId,  // Keep for recovery mechanisms
            _pendingFileId: result.imageId,
            localImageId: result.imageId,  // For LocalImage system lookup
            localBlobId: result.localBlobId,  // For blob URL regeneration
            // Status flags - SILENT SYNC: Don't show uploading indicators
            uploading: false,         // SILENT SYNC: No spinner
            queued: false,            // SILENT SYNC: No indicator
            isPending: result.isPending || false,
            isLocalFirst: true,
            isLocalImage: true,
            // Display URLs - all point to local blob
            Photo: displayableUrl,
            url: displayableUrl,
            originalUrl: displayableUrl,
            thumbnailUrl: displayableUrl,
            displayUrl: displayableUrl,
            // Content
            caption: caption || '',
            annotation: caption || '',
            Annotation: caption || ''
          };

          console.log('[PHOTO UPLOAD] Updated photo object:', {
            AttachID: this.visualPhotos[key][photoIndex].AttachID,
            displayUrl: this.visualPhotos[key][photoIndex].displayUrl?.substring(0, 50),
            url: this.visualPhotos[key][photoIndex].url?.substring(0, 50),
            thumbnailUrl: this.visualPhotos[key][photoIndex].thumbnailUrl?.substring(0, 50)
          });

          this.changeDetectorRef.detectChanges();
          console.log('[PHOTO UPLOAD] Called detectChanges()');
        }
      }

      if (!isBatchUpload) {
        // Toast removed per user request
        // await this.showToast('Photo uploaded successfully', 'success');
      }

      // Clear PDF cache so new PDFs include this photo
      this.clearPdfCache();

      // Return the AttachID for immediate use (e.g., saving annotations)
      return result.AttachID;

    } catch (error) {
      console.error('[PHOTO UPLOAD] Upload failed:', error);

      if (tempId && this.visualPhotos[key]) {
        const photoIndex = this.visualPhotos[key].findIndex(p => p.AttachID === tempId || p.id === tempId);
        if (photoIndex !== -1) {
          this.visualPhotos[key].splice(photoIndex, 1);
          this.changeDetectorRef.detectChanges();
        }
      }

      // Toast removed per user request
      // await this.showToast('Failed to upload photo', 'danger');
      return null;
    }
  }

  private async saveVisualSelection(category: string, itemId: string | number) {
    const key = `${category}_${itemId}`;

    try {
      // Find the item to get template information
      const item = this.findItemByTemplateId(Number(itemId));
      if (!item) {
        console.error('[SAVE VISUAL] Template item not found for ID:', itemId);
        return;
      }

      console.log('[SAVE VISUAL] Creating visual record for', key);
      console.log('[SAVE VISUAL] Item details:', {
        name: item.name,
        type: item.type,
        category: category
      });

      const serviceIdNum = parseInt(this.serviceId, 10);
      if (isNaN(serviceIdNum)) {
        console.error('[SAVE VISUAL] Invalid ServiceID:', this.serviceId);
        return;
      }

      // Create the Services_Visuals record using EXACT same structure as original
      const visualData: any = {
        ServiceID: serviceIdNum,
        Category: category,
        Kind: item.type,      // CRITICAL: Use item.type which is now set from template.Kind
        Name: item.name,
        Text: item.text || item.originalText || '',
        Notes: ''
      };

      console.log('[SAVE VISUAL] Visual data being saved:', visualData);

      // Add Answers field if there are answers to store
      if (item.answer) {
        visualData.Answers = item.answer;
      }

      const result = await this.foundationData.createVisual(visualData);

      console.log('[SAVE VISUAL] Raw response from createVisual:', result);
      console.log('[SAVE VISUAL] Response has VisualID?', !!result.VisualID);
      console.log('[SAVE VISUAL] Response has PK_ID?', !!result.PK_ID);
      console.log('[SAVE VISUAL] Response has id?', !!result.id);

      // Extract VisualID using the SAME logic as original (line 8518-8524)
      let visualId: string | null = null;
      if (result.VisualID) {
        visualId = String(result.VisualID);
        console.log('[SAVE VISUAL] Using VisualID field:', visualId);
      } else if (result.PK_ID) {
        visualId = String(result.PK_ID);
        console.log('[SAVE VISUAL] Using PK_ID field:', visualId);
      } else if (result.id) {
        visualId = String(result.id);
        console.log('[SAVE VISUAL] Using id field:', visualId);
      }

      if (!visualId) {
        console.error('[SAVE VISUAL] No VisualID in response:', result);
        console.error('[SAVE VISUAL] Full response structure:', JSON.stringify(result, null, 2));
        throw new Error('VisualID not found in response');
      }

      console.log('[SAVE VISUAL] âœ“ Created visual with ID:', visualId);
      console.log('[SAVE VISUAL] âœ“ Storing ID in visualRecordIds[' + key + ']');

      // Store the visual ID for photo uploads
      this.visualRecordIds[key] = visualId;

      // DEXIE-FIRST: Persist tempVisualId to VisualField for photo matching after reload
      // This MUST happen before any photo upload so populatePhotosFromDexie can match photos to fields
      const templateId = typeof itemId === 'string' ? parseInt(itemId, 10) : itemId;
      try {
        await this.visualFieldRepo.setField(this.serviceId, category, templateId, {
          tempVisualId: visualId  // Always a temp ID at this point (temp_visual_xxx)
        });
        console.log('[SAVE VISUAL] Persisted tempVisualId to Dexie:', visualId);
      } catch (err) {
        console.error('[SAVE VISUAL] Failed to persist tempVisualId:', err);
      }

      // Clear PDF cache so new PDFs show updated data
      this.clearPdfCache();

      // Process any pending photo uploads for this item
      if (this.pendingPhotoUploads[key] && this.pendingPhotoUploads[key].length > 0) {
        console.log('[SAVE VISUAL] Processing', this.pendingPhotoUploads[key].length, 'pending photo uploads');

        const pendingUploads = [...this.pendingPhotoUploads[key]];
        this.pendingPhotoUploads[key] = [];

        for (const pending of pendingUploads) {
          // Update the temp photo to uploading state
          const photoIndex = this.visualPhotos[key]?.findIndex(p => p.AttachID === pending.tempId);
          if (photoIndex !== -1 && this.visualPhotos[key]) {
            this.visualPhotos[key][photoIndex].uploading = true;
            this.visualPhotos[key][photoIndex].queued = false;
          }

          // Upload the photo - CRITICAL: Pass existingTempId to prevent duplicate photo creation
          await this.uploadPhotoForVisual(
            result.PK_ID,
            pending.file,
            key,
            pending.isBatchUpload,
            pending.annotationData,
            pending.originalFile,
            pending.caption,
            pending.tempId  // CRITICAL FIX: Pass existing temp ID to update existing photo instead of creating duplicate
          );
        }
      }

    } catch (error) {
      console.error('[SAVE VISUAL] Error creating visual record:', error);
      // Toast removed per user request
      // await this.showToast('Failed to save selection', 'danger');
    }
  }

  // ============================================
  // PHOTO VIEWING AND DELETION
  // ============================================

  async viewPhoto(photo: any, category: string, itemId: string | number, event?: Event) {
    console.log('[VIEW PHOTO] Opening photo annotator for', photo.AttachID);

    try {
      const key = `${category}_${itemId}`;

      const attachId = photo.AttachID || photo.id;
      
      // CRITICAL: Store the photo index BEFORE opening modal
      // This ensures we can find the photo even if its AttachID changes during editing
      const photos = this.visualPhotos[key] || [];
      const originalPhotoIndex = photos.findIndex(p => 
        (p.AttachID || p.id) === attachId || p === photo
      );
      console.log('[VIEW PHOTO] Captured photo index:', originalPhotoIndex, 'for AttachID:', attachId);
      const isTempPhoto = String(attachId).startsWith('temp_');

      // NEW: Handle LocalImages from the new local-first system (Dexie-based)
      // These have imageId/localImageId like "img_abc" (not "temp_" which is legacy)
      // After sync, blob URLs may be stale/revoked, so we need fresh URLs from Dexie
      const isLocalFirstPhoto = photo.isLocalFirst || photo.isLocalImage || photo.localImageId || 
        (photo.imageId && String(photo.imageId).startsWith('img_'));
      
      if (isLocalFirstPhoto) {
        const localImageId = photo.localImageId || photo.imageId;
        console.log('[VIEW PHOTO] LocalImage detected, refreshing URL from Dexie:', localImageId);
        
        // Get fresh URL from LocalImageService (uses Dexie under the hood)
        const localImage = await this.indexedDb.getLocalImage(localImageId);
        
        if (localImage) {
          try {
            const freshUrl = await this.localImageService.getDisplayUrl(localImage);
            console.log('[VIEW PHOTO] Got fresh LocalImage URL:', freshUrl?.substring(0, 50));
            
            if (freshUrl && freshUrl !== 'assets/img/photo-placeholder.png') {
              photo.url = freshUrl;
              photo.thumbnailUrl = freshUrl;
              photo.originalUrl = freshUrl;
              photo.displayUrl = freshUrl;
            } else {
              // Fallback 1: Try cached photo by attachId (uses Dexie cachedPhotos table)
              let foundUrl = false;
              if (localImage.attachId) {
                const cached = await this.indexedDb.getCachedPhoto(String(localImage.attachId));
                if (cached) {
                  console.log('[VIEW PHOTO] Using cached photo for LocalImage:', localImage.attachId);
                  photo.url = cached;
                  photo.thumbnailUrl = cached;
                  photo.originalUrl = cached;
                  photo.displayUrl = cached;
                  foundUrl = true;
                }
              }
              
              // Fallback 2: Try S3 URL directly if image has remoteS3Key
              if (!foundUrl && localImage.remoteS3Key) {
                try {
                  console.log('[VIEW PHOTO] Trying S3 URL for LocalImage:', localImage.remoteS3Key);
                  const s3Url = await this.caspioService.getS3FileUrl(localImage.remoteS3Key);
                  if (s3Url) {
                    photo.url = s3Url;
                    photo.thumbnailUrl = s3Url;
                    photo.originalUrl = s3Url;
                    photo.displayUrl = s3Url;
                    foundUrl = true;
                    console.log('[VIEW PHOTO] Got S3 URL for LocalImage');
                  }
                } catch (s3Err) {
                  console.warn('[VIEW PHOTO] S3 URL fetch failed:', s3Err);
                }
              }
              
              // Fallback 3: Try to find in bulk cached photos map
              if (!foundUrl && localImage.attachId) {
                const bulkCached = this.bulkCachedPhotosMap.get(String(localImage.attachId));
                if (bulkCached) {
                  console.log('[VIEW PHOTO] Using bulk cached photo for LocalImage:', localImage.attachId);
                  photo.url = bulkCached;
                  photo.thumbnailUrl = bulkCached;
                  photo.originalUrl = bulkCached;
                  photo.displayUrl = bulkCached;
                  foundUrl = true;
                }
              }
            }
          } catch (err) {
            console.warn('[VIEW PHOTO] Failed to get LocalImage URL:', err);
          }
        } else {
          console.warn('[VIEW PHOTO] LocalImage not found in Dexie:', localImageId);
        }
      }

      // LEGACY: If temp photo, get from IndexedDB and use it instead of fetching
      if (isTempPhoto) {
        console.log('[VIEW PHOTO] Temp photo, loading from IndexedDB:', attachId);

        // Get file from IndexedDB
        const file = await this.indexedDb.getStoredFile(attachId);
        if (file) {
          const tempImageUrl = URL.createObjectURL(file);
          console.log('[VIEW PHOTO] Created object URL from IndexedDB file:', tempImageUrl.substring(0, 50));

          // Override ALL photo URLs for annotator - critical for offline viewing
          photo.url = tempImageUrl;
          photo.thumbnailUrl = tempImageUrl;
          photo.originalUrl = tempImageUrl;  // CRITICAL: Must set originalUrl too, used at line 2000
        } else {
          // FIX: Fall back to existing blob URL if getStoredFile fails
          // The photo may already have valid blob URLs from restorePendingPhotosFromIndexedDB
          const existingBlobUrl = photo.url || photo.displayUrl || photo.originalUrl || photo.thumbnailUrl;
          if (existingBlobUrl && existingBlobUrl.startsWith('blob:')) {
            console.log('[VIEW PHOTO] Using existing blob URL for temp photo:', existingBlobUrl.substring(0, 50));
            // Ensure all URL fields are set consistently for the annotator
            photo.url = existingBlobUrl;
            photo.thumbnailUrl = existingBlobUrl;
            photo.originalUrl = existingBlobUrl;
          } else {
            console.warn('[VIEW PHOTO] No blob URL available for temp photo:', attachId);
            await this.showToast('Photo not available yet', 'warning');
            return;
          }
        }
      }

      // Check if still uploading (but allow queued photos to be edited)
      if (photo.uploading && !isTempPhoto) {
        await this.showToast('Photo is still uploading', 'warning');
        return;
      }

      // CRITICAL: Save scroll position BEFORE opening modal using Ionic API
      const scrollPosition = await this.content?.getScrollElement().then(el => el.scrollTop) || 0;
      console.log('[SCROLL] Saved scroll position before modal:', scrollPosition);

      // CRITICAL FIX v1.4.340: Always use the original URL (base image without annotations)
      // The originalUrl is set during loadPhotosForVisual to the base image
      let imageUrl = photo.url || photo.thumbnailUrl || 'assets/img/photo-placeholder.png';

      // If no valid URL and we have a file path, try to fetch it
      if ((!imageUrl || imageUrl === 'assets/img/photo-placeholder.png') && (photo.filePath || photo.Photo || photo.Attachment)) {
        try {
          // Check if this is an S3 key
          if (photo.Attachment && this.caspioService.isS3Key(photo.Attachment)) {
            console.log('[VIEW PHOTO] ✨ S3 image detected, fetching URL...');
            imageUrl = await this.caspioService.getS3FileUrl(photo.Attachment);
            photo.url = imageUrl;
            photo.originalUrl = imageUrl;
            photo.thumbnailUrl = imageUrl;
            photo.displayUrl = imageUrl;
            console.log('[VIEW PHOTO] ✅ Got S3 URL');
          }
          // Fallback to Caspio Files API
          else {
            const filePath = photo.filePath || photo.Photo;
            console.log('[VIEW PHOTO] 📁 Fetching from Caspio Files API...');
            const fetchedImage = await firstValueFrom(
              this.caspioService.getImageFromFilesAPI(filePath)
            );
            if (fetchedImage && fetchedImage.startsWith('data:')) {
              imageUrl = fetchedImage;
              // Update the photo object for future use
              photo.url = fetchedImage;
              photo.originalUrl = fetchedImage;  // CRITICAL: Set originalUrl to base image
              photo.thumbnailUrl = fetchedImage;
              photo.displayUrl = fetchedImage;
              this.changeDetectorRef.detectChanges();
            }
          }
        } catch (err) {
          console.error('[VIEW PHOTO] Failed to fetch image from file path:', err);
        }
      }

      // CRITICAL: Always use the original URL (base image without annotations) for editing
      // This ensures annotations are applied to the original image, not a previously annotated version
      const originalImageUrl = photo.originalUrl || photo.url || imageUrl;

      // CRITICAL: Don't open annotator if we only have placeholder URL
      // This prevents the FabricAnnotator from failing to load the placeholder and going black
      if (!originalImageUrl || originalImageUrl === 'assets/img/photo-placeholder.png') {
        console.error('[VIEW PHOTO] Cannot open photo - no valid image URL available:', {
          attachId,
          originalUrl: photo.originalUrl,
          url: photo.url,
          imageUrl,
          isLocalFirst: isLocalFirstPhoto,
          isTempPhoto
        });
        await this.showToast('Photo not available. Please try again later.', 'warning');
        return;
      }

      // Try to load existing annotations (EXACTLY like original at line 12184-12208)
      let existingAnnotations: any = null;
      const annotationSources = [
        photo.annotations,
        photo.annotationsData,
        photo.rawDrawingsString,
        photo.Drawings
      ];

      console.log('[VIEW PHOTO] AttachID:', attachId, 'Photo object:', {
        hasAnnotations: !!photo.annotations,
        hasAnnotationsData: !!photo.annotationsData,
        hasRawDrawingsString: !!photo.rawDrawingsString,
        hasDrawings: !!photo.Drawings,
        hasAnnotationsFlag: photo.hasAnnotations,
        rawDrawingsStringLength: photo.rawDrawingsString?.length || 0,
        drawingsLength: photo.Drawings?.length || 0,
        VisualID: photo.VisualID,
        caption: photo.caption || photo.Annotation
      });

      for (const source of annotationSources) {
        if (!source) {
          continue;
        }
        try {
          if (typeof source === 'string') {
            console.log('[VIEW PHOTO] Decompressing string source, length:', source.length);
            // Using static import for offline support
            existingAnnotations = decompressAnnotationData(source);
            console.log('[VIEW PHOTO] Decompressed annotations:', existingAnnotations ? 'SUCCESS' : 'FAILED');
            if (existingAnnotations && existingAnnotations.objects) {
              console.log('[VIEW PHOTO] Found', existingAnnotations.objects.length, 'annotation objects');
            }
          } else {
            console.log('[VIEW PHOTO] Using object source directly');
            existingAnnotations = source;
          }
          if (existingAnnotations) {
            console.log('[VIEW PHOTO] Using annotations from source');
            break;
          }
        } catch (e) {
          console.error('[VIEW PHOTO] Error loading annotations from source:', e);
        }
      }

      console.log('[VIEW PHOTO] Final existingAnnotations:', existingAnnotations ? 'LOADED' : 'NULL');

      // Get existing caption
      const existingCaption = photo.caption || photo.annotation || photo.Annotation || '';

      // Open FabricPhotoAnnotatorComponent (EXACTLY like original at line 12443)
      let modal;
      try {
        modal = await this.modalController.create({
          component: FabricPhotoAnnotatorComponent,
          componentProps: {
            imageUrl: originalImageUrl,  // CRITICAL: Always use original, not display URL
            existingAnnotations: existingAnnotations,
            existingCaption: existingCaption,
            photoData: {
              ...photo,
              AttachID: attachId,
              id: attachId,
              caption: existingCaption
            },
            isReEdit: !!existingAnnotations
          },
          cssClass: 'fullscreen-modal'
        });
      } catch (chunkError: any) {
        // Handle ChunkLoadError when offline - component chunk not cached
        console.error('[VIEW PHOTO] Failed to load photo editor component:', chunkError);
        if (chunkError.name === 'ChunkLoadError' || chunkError.message?.includes('Loading chunk')) {
          await this.showToast('Photo editor not available offline. Please connect to internet and refresh.', 'warning');
        } else {
          await this.showToast('Failed to open photo editor', 'danger');
        }
        return;
      }

      await modal.present();

      // Handle annotated photo returned from annotator
      const { data } = await modal.onWillDismiss();

      // CRITICAL: Restore scroll position AFTER modal dismisses, regardless of save/cancel
      // Use setTimeout to ensure modal animation completes before restoring
      setTimeout(async () => {
        if (this.content) {
          await this.content.scrollToPoint(0, scrollPosition, 0); // 0ms duration = instant
          console.log('[SCROLL] Restored scroll position after modal dismiss:', scrollPosition);
        }
      }, 100);

      if (!data) {
        // User cancelled
        return;
      }

      if (data && data.annotatedBlob) {
        // Update photo with new annotations
        const annotatedBlob = data.blob || data.annotatedBlob;
        const annotationsData = data.annotationData || data.annotationsData;

        // CRITICAL: Create blob URL for the annotated image (for display only)
        const newUrl = URL.createObjectURL(annotatedBlob);

        // Find photo in array - use multiple strategies since AttachID might have changed
        const photos = this.visualPhotos[key] || [];
        let photoIndex = photos.findIndex(p =>
          (p.AttachID || p.id) === attachId
        );
        
        // CRITICAL FIX: If not found by attachId, use the stored index (AttachID may have changed during modal)
        if (photoIndex === -1 && originalPhotoIndex !== -1 && originalPhotoIndex < photos.length) {
          console.log('[VIEW PHOTO] Photo not found by attachId, using stored index:', originalPhotoIndex);
          photoIndex = originalPhotoIndex;
        }
        
        // Also try to find by temp ID pattern if we had a temp ID
        if (photoIndex === -1 && String(attachId).startsWith('temp_')) {
          // The photo might have a real ID now, but we can find it by looking for our temp reference
          photoIndex = photos.findIndex(p => p._originalTempId === attachId);
          if (photoIndex !== -1) {
            console.log('[VIEW PHOTO] Found photo by _originalTempId:', attachId);
          }
        }

        if (photoIndex !== -1) {
          const currentPhoto = photos[photoIndex];
          
          // CRITICAL: Use the CURRENT photo's AttachID, not the original one
          // The AttachID may have changed from temp to real while the modal was open
          const currentAttachId = currentPhoto.AttachID || currentPhoto.id || attachId;
          const isCurrentlyTemp = String(currentAttachId).startsWith('temp_');
          
          console.log('[VIEW PHOTO] Saving annotations - Original AttachID:', attachId, 'Current AttachID:', currentAttachId, 'Is temp:', isCurrentlyTemp);

          // Save annotations to database FIRST
          if (currentAttachId && !isCurrentlyTemp) {
            try {
              // CRITICAL: Save and get back the compressed drawings that were saved
              const compressedDrawings = await this.saveAnnotationToDatabase(currentAttachId, annotatedBlob, annotationsData, data.caption);

              // CRITICAL: Create NEW photo object (immutable update pattern from original line 12518-12542)
              // This ensures proper change detection and maintains separation between original and annotated
              this.visualPhotos[key][photoIndex] = {
                ...currentPhoto,
                // PRESERVE originalUrl - this is the base image without annotations
                originalUrl: currentPhoto.originalUrl || currentPhoto.url,
                // UPDATE displayUrl - this is the annotated version for display
                displayUrl: newUrl,
                // Keep url pointing to base image (not the annotated version)
                url: currentPhoto.url,
                // ANNOTATION FIX: thumbnailUrl should show annotated image, not original
                thumbnailUrl: newUrl,
                // Mark as having annotations
                hasAnnotations: !!annotationsData,
                // Store caption
                caption: data.caption !== undefined ? data.caption : currentPhoto.caption,
                annotation: data.caption !== undefined ? data.caption : currentPhoto.annotation,
                Annotation: data.caption !== undefined ? data.caption : currentPhoto.Annotation,
                // Store annotation data (uncompressed for immediate re-use)
                annotations: annotationsData,
                // CRITICAL: Store the COMPRESSED data that matches what's in the database
                // This is used when reloading or re-editing
                Drawings: compressedDrawings,
                rawDrawingsString: compressedDrawings
              };

              console.log('[SAVE] Updated photo object in visualPhotos[' + key + '][' + photoIndex + ']');
              console.log('[SAVE] Photo now has Drawings:', !!this.visualPhotos[key][photoIndex].Drawings, 'length:', this.visualPhotos[key][photoIndex].Drawings?.length || 0);
              console.log('[SAVE] Photo now has rawDrawingsString:', !!this.visualPhotos[key][photoIndex].rawDrawingsString, 'length:', this.visualPhotos[key][photoIndex].rawDrawingsString?.length || 0);
              console.log('[SAVE] Photo hasAnnotations:', this.visualPhotos[key][photoIndex].hasAnnotations);

              // CRITICAL: Clear ALL visual attachment caches (not just this one)
              // This ensures when the user navigates away and back, ALL fresh data is loaded from database
              // Clearing only the specific visualId wasn't working reliably on navigation
              this.foundationData.clearVisualAttachmentsCache(); // Clear all caches
              console.log('[SAVE] Cleared ALL attachment caches to ensure fresh data on navigation');

              // Force change detection to ensure Angular picks up the updated photo object
              this.changeDetectorRef.detectChanges();
              console.log('[SAVE] ✅ Change detection triggered');

              // Success toast removed per user request
            } catch (error) {
              console.error('[VIEW PHOTO] Error saving annotations:', error);
              // Toast removed per user request
              // await this.showToast('Failed to save annotations', 'danger');
            }
          } else if (isCurrentlyTemp) {
            // OFFLINE PHOTO: Update IndexedDB with the new annotations
            // This ensures background sync will upload the photo WITH annotations
            try {
              console.log('[SAVE OFFLINE] ========== SAVING ANNOTATIONS FOR TEMP PHOTO ==========');
              console.log('[SAVE OFFLINE] attachId:', attachId);
              console.log('[SAVE OFFLINE] currentPhoto._pendingFileId:', currentPhoto._pendingFileId);
              console.log('[SAVE OFFLINE] currentPhoto.attachId:', currentPhoto.attachId);
              console.log('[SAVE OFFLINE] currentPhoto.AttachID:', currentPhoto.AttachID);
              console.log('[SAVE OFFLINE] currentPhoto._tempId:', currentPhoto._tempId);
              console.log('[SAVE OFFLINE] currentPhoto.isPending:', currentPhoto.isPending);

              // Get the pending file ID - use multiple fallbacks
              const pendingFileId = currentPhoto._pendingFileId || currentPhoto.attachId || currentPhoto._tempId || attachId;
              console.log('[SAVE OFFLINE] Using pendingFileId:', pendingFileId);

              // Compress the annotation data for storage (using static import for offline)
              let compressedDrawings = '';
              if (annotationsData) {
                if (typeof annotationsData === 'object') {
                  compressedDrawings = compressAnnotationData(JSON.stringify(annotationsData));
                } else if (typeof annotationsData === 'string') {
                  compressedDrawings = compressAnnotationData(annotationsData);
                }
              }

              // CRITICAL: Use updatePendingPhotoData for reliable caption/drawings update
              // This is simpler and more reliable than re-reading and re-storing the entire file
              const updated = await this.indexedDb.updatePendingPhotoData(pendingFileId, {
                caption: data.caption || '',
                drawings: compressedDrawings
              });
              
              if (updated) {
                console.log('[SAVE OFFLINE] ✅ Updated IndexedDB with drawings:', compressedDrawings.length, 'chars');
              } else {
                console.warn('[SAVE OFFLINE] Could not find pending photo in IndexedDB for:', pendingFileId);
                
                // CRITICAL FIX: If file is not found, the photo may have been synced while user was annotating
                // Try to save to the database using the _originalTempId or look for a real AttachID
                const realAttachId = currentPhoto._originalTempId ? 
                  await this.indexedDb.getRealId(String(currentPhoto._originalTempId)) : null;
                  
                if (realAttachId) {
                  console.log('[SAVE OFFLINE] Photo was synced! Saving annotations to database with real ID:', realAttachId);
                  try {
                    await this.saveAnnotationToDatabase(realAttachId, annotatedBlob, annotationsData, data.caption || '');
                    console.log('[SAVE OFFLINE] ✅ Annotations saved to database with real ID');
                  } catch (dbError) {
                    console.error('[SAVE OFFLINE] Failed to save annotations to database:', dbError);
                  }
                } else {
                  console.warn('[SAVE OFFLINE] No real ID found, annotations will only be saved locally');
                }
              }

              // Update local photo object with annotated image
              console.log('[SAVE OFFLINE] Updating local photo object, newUrl:', newUrl ? 'created' : 'missing');

              this.visualPhotos[key][photoIndex] = {
                ...currentPhoto,
                originalUrl: currentPhoto.originalUrl || currentPhoto.url,
                displayUrl: newUrl,  // CRITICAL: Show annotated image immediately
                thumbnailUrl: newUrl,  // ANNOTATION FIX: thumbnailUrl should show annotated image
                hasAnnotations: !!annotationsData,
                caption: data.caption !== undefined ? data.caption : currentPhoto.caption,
                annotation: data.caption !== undefined ? data.caption : currentPhoto.annotation,
                Annotation: data.caption !== undefined ? data.caption : currentPhoto.Annotation,
                annotations: annotationsData,
                Drawings: compressedDrawings,
                rawDrawingsString: compressedDrawings,
                _localUpdate: true  // CRITICAL: Prevent reload from overwriting local annotations
              };

              console.log('[SAVE OFFLINE] Updated local photo object:');
              console.log('[SAVE OFFLINE]   - displayUrl:', this.visualPhotos[key][photoIndex].displayUrl ? 'set' : 'missing');
              console.log('[SAVE OFFLINE]   - hasAnnotations:', this.visualPhotos[key][photoIndex].hasAnnotations);
              console.log('[SAVE OFFLINE]   - Drawings length:', this.visualPhotos[key][photoIndex].Drawings?.length || 0);
              
              // CRITICAL FIX: Cache annotated image for temp photos too
              // This ensures annotations show in thumbnails even for offline photos
              if (annotatedBlob && annotatedBlob.size > 0) {
                try {
                  const base64 = await this.indexedDb.cacheAnnotatedImage(pendingFileId, annotatedBlob);
                  console.log('[SAVE OFFLINE] ✅ Annotated image cached for temp photo:', pendingFileId);
                  // Update in-memory map so same-session navigation shows the annotation
                  if (base64) {
                    this.bulkAnnotatedImagesMap.set(pendingFileId, base64);
                  }
                } catch (cacheErr) {
                  console.warn('[SAVE OFFLINE] Failed to cache annotated image:', cacheErr);
                }
              }

              // Queue caption/annotation update for sync - background sync will resolve temp ID when photo syncs
              try {
                await this.foundationData.queueCaptionAndAnnotationUpdate(
                  pendingFileId,
                  data.caption || '',
                  compressedDrawings,
                  'visual',
                  { serviceId: this.serviceId }
                );
                console.log('[SAVE OFFLINE] ✅ Caption/annotation queued for sync:', pendingFileId);
              } catch (queueErr) {
                console.warn('[SAVE OFFLINE] Failed to queue caption update:', queueErr);
              }

              // CRITICAL: Force change detection to update UI immediately
              this.changeDetectorRef.detectChanges();
              console.log('[SAVE OFFLINE] ✅ Change detection triggered');
            } catch (error) {
              console.error('[SAVE OFFLINE] Error saving annotations to IndexedDB:', error);
            }
          }
        }
      }

    } catch (error) {
      console.error('Error opening photo annotator:', error);
      // Toast removed per user request
      // await this.showToast('Failed to open photo annotator', 'danger');
    }
  }

  /**
   * Convert a Blob to a base64 data URL for caching
   */
  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result as string);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private async saveAnnotationToDatabase(attachId: string, annotatedBlob: Blob, annotationsData: any, caption: string): Promise<string> {
    // Using static import for offline support

    // CRITICAL: Process annotation data EXACTLY like the original 15,000 line code
    // Build the updateData object with Annotation and Drawings fields
    const updateData: any = {
      Annotation: caption || ''
    };

    // Add annotations to Drawings field if provided (EXACT logic from original line 11558-11758)
    if (annotationsData) {
      let drawingsData = '';

      // Handle Fabric.js canvas export (object with 'objects' and 'version' properties)
      if (annotationsData && typeof annotationsData === 'object' && 'objects' in annotationsData) {
        // This is a Fabric.js canvas export - stringify it DIRECTLY
        // The toJSON() method from Fabric.js already returns the COMPLETE canvas state
        try {
          drawingsData = JSON.stringify(annotationsData);

          // Validate the JSON is parseable
          try {
            const testParse = JSON.parse(drawingsData);
          } catch (e) {
            console.warn('[SAVE] JSON validation failed, but continuing');
          }
        } catch (e) {
          console.error('[SAVE] Failed to stringify Fabric.js object:', e);
          // Try to create a minimal representation
          drawingsData = JSON.stringify({ objects: [], version: annotationsData.version || '5.3.0' });
        }
      } else if (typeof annotationsData === 'string') {
        // Already a string - use it
        drawingsData = annotationsData;
      } else if (typeof annotationsData === 'object') {
        // Other object - stringify it
        try {
          drawingsData = JSON.stringify(annotationsData);
        } catch (e) {
          console.error('[SAVE] Failed to stringify annotations:', e);
          drawingsData = '';
        }
      }

      // CRITICAL: Final validation and compression (EXACT logic from original line 11673-11758)
      if (drawingsData && drawingsData !== '{}' && drawingsData !== '[]') {
        // Clean the data
        const originalLength = drawingsData.length;

        // Remove problematic characters that Caspio might reject
        drawingsData = drawingsData
          .replace(/\u0000/g, '') // Remove null bytes
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars
          .replace(/undefined/g, 'null'); // Replace 'undefined' strings with 'null'

        // COMPRESS the data to fit in 64KB TEXT field
        try {
          const parsed = JSON.parse(drawingsData);

          // Re-stringify to ensure clean JSON format
          drawingsData = JSON.stringify(parsed, (key, value) => {
            // Replace undefined with null for valid JSON
            return value === undefined ? null : value;
          });

          // COMPRESS (this is the key step!)
          const originalSize = drawingsData.length;
          // EMPTY_COMPRESSED_ANNOTATIONS is imported from annotation-utils - uses proper JSON format, not gzip
          drawingsData = compressAnnotationData(drawingsData, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });

          console.log(`[SAVE] Compressed annotations: ${originalSize} â†' ${drawingsData.length} bytes`);

          // Final size check
          if (drawingsData.length > 64000) {
            console.error('[SAVE] Annotation data exceeds 64KB limit:', drawingsData.length, 'bytes');
            throw new Error('Annotation data exceeds 64KB limit');
          }
        } catch (e: any) {
          if (e?.message?.includes('64KB')) {
            throw e; // Re-throw size limit errors
          }
          console.warn('[SAVE] Could not re-parse for cleaning, using as-is');
        }

        // Set the Drawings field with COMPRESSED data
        updateData.Drawings = drawingsData;
      } else {
        // Empty annotations - use proper JSON format from annotation-utils
        updateData.Drawings = EMPTY_COMPRESSED_ANNOTATIONS;
      }
    } else {
      // No annotations provided - use proper JSON format from annotation-utils
      updateData.Drawings = EMPTY_COMPRESSED_ANNOTATIONS;
    }

    console.log('[SAVE] Saving annotations to database:', {
      attachId,
      hasDrawings: !!updateData.Drawings,
      drawingsLength: updateData.Drawings?.length || 0,
      caption: caption || '(empty)',
      annotation: updateData.Annotation || '(empty)'
    });

    // Validate attachId before proceeding
    if (!attachId || String(attachId).startsWith('temp_')) {
      console.error('[SAVE] Cannot update annotations - invalid or temp AttachID:', attachId);
      throw new Error('Cannot update annotations for temp photo');
    }

    // Find the visualId for this attachment by searching visualPhotos (needed for cache and queue)
    let visualIdForCache: string | null = null;
    let foundKey: string | null = null;
    for (const [key, photos] of Object.entries(this.visualPhotos)) {
      const photo = (photos as any[]).find(p => String(p.AttachID) === String(attachId));
      if (photo) {
        foundKey = key;
        // CRITICAL: Use VisualID from photo, or visualRecordIds, or extract from key
        const recordId = this.visualRecordIds[key];
        const photoVisualId = photo.VisualID;
        visualIdForCache = photoVisualId || recordId || null;
        
        // Ensure it's a valid string, not "undefined"
        if (visualIdForCache && String(visualIdForCache) !== 'undefined') {
          visualIdForCache = String(visualIdForCache);
        } else {
          visualIdForCache = null;
        }
        
        console.log('[SAVE CACHE] Found photo for AttachID:', attachId, 'Key:', key, 'photo.VisualID:', photoVisualId, 'visualRecordIds[key]:', recordId, 'Final visualIdForCache:', visualIdForCache);
        break;
      }
    }

    if (!visualIdForCache) {
      console.warn('[SAVE CACHE] ⚠️ Could not find visualIdForCache for AttachID:', attachId);
      console.warn('[SAVE CACHE] ⚠️ Searched keys:', Object.keys(this.visualPhotos));
      console.warn('[SAVE CACHE] ⚠️ visualRecordIds:', JSON.stringify(this.visualRecordIds));
    }

    // CRITICAL: Update IndexedDB cache FIRST (offline-first pattern)
    // This ensures annotations persist locally even if API call fails
    let isLocalFirstPhoto = false;
    let localImageId: string | null = null;
    
    try {
      // CRITICAL FIX: Check if this is a local-first photo and update LocalImage record
      // Find the photo to check for localImageId
      for (const [key, photos] of Object.entries(this.visualPhotos)) {
        const photo = (photos as any[]).find(p => 
          String(p.AttachID) === String(attachId) || 
          String(p.imageId) === String(attachId) ||
          String(p.localImageId) === String(attachId)
        );
        if (photo) {
          localImageId = photo.localImageId || photo.imageId || null;
          isLocalFirstPhoto = !!(localImageId && (photo.isLocalFirst || photo.isLocalImage));
          
          if (isLocalFirstPhoto && localImageId) {
            // Update the LocalImage record with new drawings
            await this.localImageService.updateCaptionAndDrawings(
              localImageId,
              updateData.Annotation || caption,
              updateData.Drawings
            );
            console.log('[SAVE] ✅ LocalImage record updated with drawings:', localImageId);
          }
          break;
        }
      }
      
      // Also check if attachId itself looks like a local-first ID
      if (String(attachId).startsWith('img_')) {
        isLocalFirstPhoto = true;
      }
      
      if (visualIdForCache) {
        // Get existing cached attachments and update
        const cachedAttachments = await this.indexedDb.getCachedServiceData(visualIdForCache, 'visual_attachments') || [];
        console.log('[SAVE CACHE] Found', cachedAttachments.length, 'cached attachments for visual', visualIdForCache);
        
        const updatedAttachments = cachedAttachments.map((att: any) => {
          if (String(att.AttachID) === String(attachId)) {
            console.log('[SAVE CACHE] Updating attachment', attachId, 'with Drawings length:', updateData.Drawings?.length || 0);
            return {
              ...att,
              Annotation: updateData.Annotation,
              Drawings: updateData.Drawings,
              _localUpdate: true,
              _updatedAt: Date.now()
            };
          }
          return att;
        });
        await this.indexedDb.cacheServiceData(visualIdForCache, 'visual_attachments', updatedAttachments);
        console.log('[SAVE] ✅ Annotation saved to IndexedDB cache for visual', visualIdForCache, 'with _localUpdate flag');
      }
      
      // CRITICAL FIX: Also cache the annotated blob for thumbnail display on reload
      // This ensures annotations are visible in thumbnails after page reload
      if (annotatedBlob && annotatedBlob.size > 0) {
        try {
          const base64 = await this.indexedDb.cacheAnnotatedImage(String(attachId), annotatedBlob);
          console.log('[SAVE] ✅ Annotated image blob cached for thumbnail display');
          // Update in-memory map so same-session navigation shows the annotation
          if (base64) {
            this.bulkAnnotatedImagesMap.set(String(attachId), base64);
          }
        } catch (annotCacheErr) {
          console.warn('[SAVE] Failed to cache annotated image blob:', annotCacheErr);
        }
      }
    } catch (cacheError) {
      console.warn('[SAVE] Failed to update IndexedDB cache:', cacheError);
      // Continue anyway - still try API
    }

    // ALWAYS queue annotation updates - sync worker handles ID resolution for local-first photos
    // The background sync service already handles img_ prefixed IDs and resolves them to real attachIds
    await this.foundationData.queueCaptionAndAnnotationUpdate(
      isLocalFirstPhoto && localImageId ? localImageId : attachId,
      caption || '',
      updateData.Drawings,
      'visual',
      {
        serviceId: this.serviceId,
        visualId: visualIdForCache || undefined
      }
    );
    console.log('[SAVE] ✅ Annotation queued for sync:', isLocalFirstPhoto ? `local-first ${localImageId}` : attachId);

    // Return the compressed drawings string so caller can update local photo object
    return updateData.Drawings;
  }

  async deletePhoto(photo: any, category: string, itemId: string | number) {
    try {
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
        // OFFLINE-FIRST: No loading spinner - immediate UI update
        try {
          const key = `${category}_${itemId}`;

          // Remove from UI IMMEDIATELY (optimistic update)
          if (this.visualPhotos[key]) {
            this.visualPhotos[key] = this.visualPhotos[key].filter(
              (p: any) => p.AttachID !== photo.AttachID
            );
            // Update photo count immediately
            this.photoCountsByKey[key] = this.visualPhotos[key].length;
          }

          // Force UI update first
          this.changeDetectorRef.detectChanges();

          // Clear cached photo IMAGE from IndexedDB
          await this.indexedDb.deleteCachedPhoto(String(photo.AttachID));
          
          // Remove from cached ATTACHMENTS LIST in IndexedDB
          await this.indexedDb.removeAttachmentFromCache(String(photo.AttachID), 'visual_attachments');

          // Handle LocalImage (new local-first system) deletion
          const isLocalFirstPhoto = photo.isLocalFirst || photo.isLocalImage || photo.localImageId ||
            (photo.imageId && String(photo.imageId).startsWith('img_'));

          if (isLocalFirstPhoto) {
            const localImageId = photo.localImageId || photo.imageId;
            console.log('[Delete Photo] Deleting LocalImage:', localImageId);

            // CRITICAL: Get LocalImage data BEFORE deleting to check if server deletion is needed
            const localImage = await this.indexedDb.getLocalImage(localImageId);

            // If the photo was already synced (has real attachId), queue delete for server
            if (localImage?.attachId && !String(localImage.attachId).startsWith('img_')) {
              console.log('[Delete Photo] LocalImage was synced, queueing server delete:', localImage.attachId);
              await this.foundationData.deleteVisualPhoto(localImage.attachId);
            }

            // NOW delete from LocalImage system (after queuing server delete)
            await this.localImageService.deleteLocalImage(localImageId);
          }
          // Legacy photo deletion
          else if (photo.AttachID && !String(photo.AttachID).startsWith('temp_')) {
            await this.foundationData.deleteVisualPhoto(photo.AttachID);
            console.log('[Delete Photo] Deleted photo (or queued for sync):', photo.AttachID);
          }

          console.log('[Delete Photo] Photo removed successfully');
        } catch (error) {
          console.error('Error deleting photo:', error);
          // Toast removed per user request
          // await this.showToast('Failed to delete photo', 'danger');
        }
      }
    } catch (error) {
      console.error('Error in deletePhoto:', error);
      // Toast removed per user request
      // await this.showToast('Failed to delete photo', 'danger');
    }
  }

  private isCaptionPopupOpen = false;

  async openCaptionPopup(photo: any, category: string, itemId: string | number) {
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

              // Save to database using unified caption queue (ALWAYS queues, never direct API)
              // This ensures captions are never lost during sync operations
              const visualId = photo.VisualID || this.visualRecordIds[`${category}_${itemId}`] || String(itemId);
              
              photo._localUpdate = true; // Mark as local update to prevent server overwriting
              
              // CRITICAL: For local-first images, update the LocalImage record directly
              // and use the localImageId for caption queue (will resolve to real attachId on sync)
              const isLocalFirst = photo.isLocalFirst || photo.isLocalImage;
              const localImageId = photo.localImageId || photo.imageId;
              
              // If local-first image, update LocalImage record and queue with imageId
              // Otherwise use real AttachID for legacy photos
              const attachId = isLocalFirst && localImageId 
                ? localImageId  // Will be resolved to real attachId by sync worker
                : String(photo.attachId || photo.AttachID || photo._pendingFileId || '');
              
              // Also update the LocalImage record directly for local-first photos
              if (isLocalFirst && localImageId) {
                this.localImageService.updateCaptionAndDrawings(localImageId, newCaption).catch((e: any) => {
                  console.warn('[CAPTION] Failed to update LocalImage caption:', e);
                });
              }
              
              this.foundationData.queueCaptionUpdate(
                attachId,
                newCaption,
                'visual',
                {
                  serviceId: this.serviceId,
                  visualId: String(visualId)
                }
              ).then(() => {
                console.log('[CAPTION] ✅ Caption queued for sync:', attachId);
              }).catch((error) => {
                console.error('[CAPTION] Error queueing caption:', error);
              });

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

          // Build the full HTML content
          const htmlContent = `
            <div class="caption-popup-content">
              <div class="caption-input-container">
                <input type="text" id="captionInput" class="caption-text-input"
                       placeholder="Enter caption..."
                       value="${tempCaption}"
                       maxlength="255" />
                <button type="button" id="undoCaptionBtn" class="undo-caption-btn" title="Undo Last Word">
                  <ion-icon name="backspace-outline"></ion-icon>
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

  // ============================================
  // HELPER METHODS
  // ============================================

  async addCustomVisual(category: string, kind: string) {
    // Using static import for offline support
    const modal = await this.modalController.create({
      component: AddCustomVisualModalComponent,
      componentProps: {
        kind: kind,
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
      await this.createCustomVisualWithPhotos(category, kind, data.name, data.description || '', files, processedPhotos);
    }
  }

  // Create custom visual with photos
  async createCustomVisualWithPhotos(category: string, kind: string, name: string, text: string, files: FileList | File[] | null, processedPhotos: any[] = []) {
    try {
      const serviceIdNum = parseInt(this.serviceId, 10);
      if (isNaN(serviceIdNum)) {
        // Toast removed per user request
        // await this.showToast('Invalid Service ID', 'danger');
        return;
      }

      const visualData = {
        ServiceID: serviceIdNum,
        Category: category,
        Kind: kind,
        Name: name,
        Text: text,
        Notes: ''
      };

      console.log('[CREATE CUSTOM] Creating visual:', visualData);

      // Create the visual record
      const response = await this.foundationData.createVisual(visualData);

      // Extract VisualID
      let visualId: string | null = null;

      if (Array.isArray(response) && response.length > 0) {
        visualId = String(response[0].VisualID || response[0].PK_ID || response[0].id || '');
      } else if (response && typeof response === 'object') {
        if (response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
          visualId = String(response.Result[0].VisualID || response.Result[0].PK_ID || response.Result[0].id || '');
        } else {
          visualId = String(response.VisualID || response.PK_ID || response.id || '');
        }
      } else if (response) {
        visualId = String(response);
      }

      if (!visualId || visualId === 'undefined' || visualId === 'null' || visualId === '') {
        throw new Error('No VisualID returned from server');
      }

      console.log('[CREATE CUSTOM] Created visual with ID:', visualId);

      // Generate a unique templateId for custom visuals (negative to avoid collision with real templates)
      const customTemplateId = -Date.now();

      // Add to local data structure (must match loadExistingVisuals structure)
      // DEXIE-FIRST: Use templateId as the item ID for consistency with convertFieldsToOrganizedData
      // The liveQuery converts fields using field.visualId || field.tempVisualId || field.templateId
      // So we use tempVisualId as the id, which will be returned by convertFieldsToOrganizedData
      const customItem: VisualItem = {
        id: visualId, // Use tempVisualId for consistency with convertFieldsToOrganizedData
        templateId: customTemplateId, // Use unique negative ID for custom visuals
        name: name,
        text: text,
        originalText: text,
        answerType: 0,
        required: false,
        type: kind,
        category: category,
        isSelected: true, // Custom visuals are always selected
        photos: []
      };

      // DEXIE-FIRST: Use consistent key format matching convertFieldsToOrganizedData
      // Key format: ${category}_${templateId} for selection tracking
      const key = `${category}_${customTemplateId}`;
      this.visualRecordIds[key] = String(visualId);

      // Mark as selected with the correct key
      this.selectedItems[key] = true;

      console.log('[CREATE CUSTOM] Stored visualId in visualRecordIds:', key, '=', visualId);

      // DEXIE-FIRST: Upload photos FIRST before calling setField
      // This ensures photos exist in LocalImages when the liveQuery triggers populatePhotosFromDexie
      let photoCount = 0;
      if (files && files.length > 0) {
        console.log('[CREATE CUSTOM] DEXIE-FIRST: Uploading', files.length, 'photos BEFORE setField');

        // Initialize photos array
        if (!this.visualPhotos[key]) {
          this.visualPhotos[key] = [];
        }

        // Upload ALL photos to LocalImages first (persists to Dexie)
        const uploadResults = await Promise.all(Array.from(files).map(async (file, index) => {
          const photoData = processedPhotos[index] || {};
          const annotationData = photoData.annotationData || null;
          const originalFile = photoData.originalFile || null;
          const caption = photoData.caption || '';
          const fileToUpload = originalFile || file;

          // Compress the photo
          const compressedPhoto = await this.imageCompression.compressImage(fileToUpload, {
            maxSizeMB: 0.8,
            maxWidthOrHeight: 1280,
            useWebWorker: true
          }) as File;

          // Upload to LocalImages via foundationData (persists to Dexie)
          const drawings = annotationData ? JSON.stringify(annotationData) : '';
          const result = await this.foundationData.uploadVisualPhoto(visualId, compressedPhoto, caption, drawings, originalFile || undefined, this.serviceId);

          console.log(`[CREATE CUSTOM] Photo ${index + 1} persisted to LocalImages:`, result.imageId);
          return result;
        }));

        photoCount = uploadResults.length;

        // Add photos to in-memory array for immediate display
        for (const result of uploadResults) {
          this.visualPhotos[key].push({
            AttachID: result.imageId,
            id: result.imageId,
            imageId: result.imageId,
            name: result.fileName,
            url: result.displayUrl,
            thumbnailUrl: result.displayUrl,
            displayUrl: result.displayUrl,
            isObjectUrl: true,
            uploading: false,
            queued: false,
            hasAnnotations: !!(result.drawings && result.drawings.length > 10),
            caption: result.caption || '',
            annotation: result.caption || '',
            isLocalFirst: true
          });
        }

        // Update photo count
        this.photoCountsByKey[key] = photoCount;

        // DEXIE-FIRST: Set expansion state BEFORE setField so photos are visible when liveQuery fires
        this.expandedPhotos[key] = true;

        console.log('[CREATE CUSTOM] ✅ All', photoCount, 'photos uploaded to LocalImages BEFORE setField');
      }

      // NOW persist to VisualField - this triggers liveQuery which will find the photos in LocalImages
      try {
        await this.visualFieldRepo.setField(this.serviceId, category, customTemplateId, {
          isSelected: true,
          tempVisualId: visualId,
          visualId: null, // Will be set when synced
          templateName: name,
          templateText: text,
          kind: kind as 'Comment' | 'Limitation' | 'Deficiency',
          photoCount: photoCount
        });
        console.log('[CREATE CUSTOM] ✅ Persisted custom visual to Dexie (after photos):', customTemplateId, visualId);
      } catch (err) {
        console.error('[CREATE CUSTOM] Failed to persist to Dexie:', err);

        // Even if Dexie persist fails, add to organizedData for immediate display
        if (kind === 'Comment') {
          this.organizedData.comments.push(customItem);
        } else if (kind === 'Limitation') {
          this.organizedData.limitations.push(customItem);
        } else if (kind === 'Deficiency') {
          this.organizedData.deficiencies.push(customItem);
        } else {
          this.organizedData.comments.push(customItem);
        }
        this.changeDetectorRef.detectChanges();
      }

      // Clear PDF cache so new PDFs show updated data
      this.clearPdfCache();

      console.log('[CREATE CUSTOM] ✅ Custom visual created with Dexie-first pattern');

    } catch (error) {
      console.error('[CREATE CUSTOM] Error creating custom visual:', error);
    }
  }

  async showFullText(item: VisualItem) {
    // Build inputs based on AnswerType
    const inputs: any[] = [
      {
        name: 'title',
        type: 'text',
        placeholder: 'Title' + (item.required ? ' *' : ''),
        value: item.name || '',
        cssClass: 'editor-title-input'
      }
    ];

    // Add appropriate input based on AnswerType
    if (item.answerType === 1) {
      // Yes/No toggle - use originalText for display text
      const currentText = item.originalText || item.text || '';

      // Add a read-only textarea showing the original text
      if (currentText) {
        inputs.push({
          name: 'originalDescription',
          type: 'textarea',
          placeholder: 'Description',
          value: currentText,
          cssClass: 'editor-text-input',
          attributes: {
            rows: 6,
            readonly: true
          }
        });
      }

      // Add Yes/No radio buttons for the answer
      inputs.push({
        name: 'description',
        type: 'radio',
        label: 'Yes',
        value: 'Yes',
        checked: item.answer === 'Yes'
      });
      inputs.push({
        name: 'description',
        type: 'radio',
        label: 'No',
        value: 'No',
        checked: item.answer === 'No'
      });
    } else if (item.answerType === 2) {
      // Dropdown from Services_Visuals_Drop
      const options = this.visualDropdownOptions[item.templateId] || [];
      if (options.length > 0) {
        // Add each option as a radio button
        options.forEach(option => {
          inputs.push({
            name: 'description',
            type: 'radio',
            label: option,
            value: option,
            checked: item.text === option
          });
        });
      } else {
        // Fallback to text if no options available
        inputs.push({
          name: 'description',
          type: 'textarea',
          placeholder: 'Description' + (item.required ? ' *' : ''),
          value: item.text || '',
          cssClass: 'editor-text-input',
          attributes: {
            rows: 8
          }
        });
      }
    } else {
      // Default text input (AnswerType 0 or undefined)
      inputs.push({
        name: 'description',
        type: 'textarea',
        placeholder: 'Description' + (item.required ? ' *' : ''),
        value: item.text || '',
        cssClass: 'editor-text-input',
        attributes: {
          rows: 8
        }
      });
    }

    const alert = await this.alertController.create({
      header: 'Edit Description' + (item.required ? ' (Required)' : ''),
      cssClass: 'text-editor-modal',
      inputs: inputs,
      buttons: [
        {
          text: 'Save',
          cssClass: 'editor-save-btn',
          handler: async (data) => {
            // Validate required fields
            if (item.required && !data.description) {
              return false;
            }

            // Track what changed
            const titleChanged = data.title !== item.name;
            const textChanged = data.description !== item.text;

            if (titleChanged || textChanged) {
              const oldName = item.name;
              const oldText = item.text;

              // Update local item
              if (titleChanged) {
                item.name = data.title;
              }
              if (textChanged) {
                item.text = data.description;
              }

              // Save to database if this visual is already created
              const key = `${item.category}_${item.id}`;
              const visualId = this.visualRecordIds[key];

              if (visualId && !String(visualId).startsWith('temp_')) {
                try {
                  // Build update object with changed fields
                  const updateData: any = {};
                  if (titleChanged) {
                    updateData.Name = data.title;
                  }
                  if (textChanged) {
                    updateData.Text = data.description;
                  }

                  await this.foundationData.updateVisual(visualId, updateData, this.serviceId);
                  console.log('[TEXT EDIT] Updated visual:', visualId, updateData);
                  this.changeDetectorRef.detectChanges();
                } catch (error) {
                  console.error('[TEXT EDIT] Error updating visual:', error);
                  // Revert changes on error
                  item.name = oldName;
                  item.text = oldText;
                  return false;
                }
              } else {
                // Just update UI if visual doesn't exist yet
                this.changeDetectorRef.detectChanges();
              }
            }
            return true;
          }
        },
        {
          text: 'Cancel',
          role: 'cancel',
          cssClass: 'editor-cancel-btn'
        }
      ]
    });
    await alert.present();
  }

  trackByItemId(index: number, item: VisualItem): any {
    return item.id || index;
  }

  trackByOption(index: number, option: string): string {
    return option;
  }

  getDropdownDebugInfo(item: VisualItem): string {
    return `Template ${item.templateId}, Type ${item.answerType}`;
  }

  // ============================================
  // SEARCH/FILTER METHODS
  // ============================================

  filterItems(items: VisualItem[]): VisualItem[] {
    if (!this.searchTerm || this.searchTerm.trim() === '') {
      return items;
    }

    const term = this.searchTerm.toLowerCase().trim();
    return items.filter(item => {
      const nameMatch = item.name?.toLowerCase().includes(term);
      const textMatch = item.text?.toLowerCase().includes(term);
      const originalTextMatch = item.originalText?.toLowerCase().includes(term);

      return nameMatch || textMatch || originalTextMatch;
    });
  }

  /**
   * Escape HTML characters to prevent XSS (web only)
   */
  private escapeHtml(text: string): string {
    if (!environment.isWeb) return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  highlightText(text: string | undefined): string {
    if (!text || !this.searchTerm || this.searchTerm.trim() === '') {
      // Escape HTML even when no search term to prevent XSS (web only)
      return environment.isWeb ? this.escapeHtml(text || '') : (text || '');
    }

    const term = this.searchTerm.trim();
    // First escape the text to prevent XSS (web only)
    const escapedText = environment.isWeb ? this.escapeHtml(text) : text;
    // Create a case-insensitive regex to find all matches
    const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi');

    // Replace matches with highlighted span
    return escapedText.replace(regex, '<span class="highlight">$1</span>');
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.updateExpandedAccordions();
  }

  onSearchChange(): void {
    this.updateExpandedAccordions();
  }

  private updateExpandedAccordions(): void {
    if (!this.searchTerm || this.searchTerm.trim() === '') {
      // No search term - expand all accordions by default for better UX
      this.expandedAccordions = ['information', 'limitations', 'deficiencies'];
      return;
    }

    // Expand only accordions that have matching results
    const expanded: string[] = [];

    if (this.filterItems(this.organizedData.comments).length > 0) {
      expanded.push('information');
    }
    if (this.filterItems(this.organizedData.limitations).length > 0) {
      expanded.push('limitations');
    }
    if (this.filterItems(this.organizedData.deficiencies).length > 0) {
      expanded.push('deficiencies');
    }

    this.expandedAccordions = expanded;
  }

  // Simple accordion helpers (for offline reliability - ion-accordion can fail offline)
  toggleSection(section: string): void {
    const index = this.expandedAccordions.indexOf(section);
    if (index > -1) {
      this.expandedAccordions = this.expandedAccordions.filter(s => s !== section);
    } else {
      this.expandedAccordions = [...this.expandedAccordions, section];
    }
    
    // If background loading is in progress, also update the preserved state
    // This ensures user's toggle actions are respected when background loading completes
    if (this.isLoadingPhotosInBackground && this.preservedAccordionState) {
      this.preservedAccordionState = [...this.expandedAccordions];
    }
    
    this.changeDetectorRef.detectChanges();
  }

  isSectionExpanded(section: string): boolean {
    return this.expandedAccordions.includes(section);
  }

  async showToast(message: string, color: string = 'primary') {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  async onAccordionChange(event: any) {
    // CRITICAL: Prevent accordion state changes from item selections
    // This handler should ONLY respond to actual accordion header clicks
    // Item selection events (checkboxes, dropdowns) now have stopPropagation
    // so they should not trigger this handler at all

    if (event.detail && event.detail.value !== undefined) {
      // Only update if there's no active search
      if (!this.searchTerm || this.searchTerm.trim() === '') {
        this.expandedAccordions = Array.isArray(event.detail.value)
          ? event.detail.value
          : [event.detail.value].filter(v => v);
      }
    }

    // Prevent automatic scrolling when accordion expands/collapses
    if (this.content) {
      const scrollElement = await this.content.getScrollElement();
      const currentScrollTop = scrollElement.scrollTop;

      // Restore scroll position after a brief delay to override Ionic's scroll behavior
      setTimeout(() => {
        scrollElement.scrollTop = currentScrollTop;
      }, 0);
    }
  }

  /**
   * Clear PDF cache when data changes
   * This ensures the next PDF generation fetches fresh data
   */
  private clearPdfCache() {
    // Clear all PDF cache keys for this service
    console.log('[CACHE] Clearing PDF cache for serviceId:', this.serviceId);

    try {
      const now = Date.now();

      // Generate cache keys for current and previous timestamp blocks (last 10 minutes)
      for (let i = 0; i < 10; i++) {
        const timestamp = Math.floor((now - (i * 60000)) / 300000); // Check last 10 minutes of 5-min blocks
        const cacheKey = this.cache.getApiCacheKey('pdf_data', {
          serviceId: this.serviceId,
          timestamp: timestamp
        });
        this.cache.clear(cacheKey);
      }

      console.log('[CACHE] âœ" PDF cache cleared - next PDF will fetch fresh data');
    } catch (error) {
      console.error('[CACHE] Error clearing PDF cache:', error);
    }
  }

  // ============================================
  // IMAGE LOAD/ERROR HANDLERS
  // ============================================

  /**
   * Handle successful image load
   * Marks the image as successfully loaded in UI for blob pruning decisions
   */
  handleImageLoad(event: Event, photo: any): void {
    const img = event.target as HTMLImageElement;
    if (!img) return;

    // Mark as successfully loaded
    photo.loading = false;
    photo.displayState = 'loaded';

    // If this is a LocalImage with remote URL, mark as loaded in UI
    // This allows blob pruning to proceed safely
    if (photo.isLocalImage && photo.imageId) {
      this.localImageService.markRemoteLoadedInUI(photo.imageId).catch(err => {
        console.warn('[IMAGE LOAD] Failed to mark remote loaded:', err);
      });
    }
  }

  /**
   * Handle image load error
   * Attempts fallback to cached photo or placeholder
   */
  async handleImageError(event: Event, photo: any): Promise<void> {
    const img = event.target as HTMLImageElement;
    if (!img) return;

    console.warn('[IMAGE ERROR] Failed to load:', photo.AttachID || photo.imageId, 'url:', img.src?.substring(0, 50));

    // Don't retry if already showing placeholder
    if (img.src === 'assets/img/photo-placeholder.png' || img.src.endsWith('photo-placeholder.png')) {
      return;
    }

    // Track retry attempts to prevent infinite loops
    if (!photo._retryCount) {
      photo._retryCount = 0;
    }
    photo._retryCount++;

    if (photo._retryCount > 2) {
      console.warn('[IMAGE ERROR] Max retries reached, showing placeholder');
      img.src = 'assets/img/photo-placeholder.png';
      photo.displayUrl = 'assets/img/photo-placeholder.png';
      photo.loading = false;
      return;
    }

    // Try fallback chain
    try {
      // CRITICAL: Check for cached annotated image FIRST to preserve annotations in thumbnails
      // This prevents annotations from disappearing when blob URLs become invalid
      const attachId = String(photo.AttachID || photo.attachId || photo.id || '');
      const localImageId = photo.localImageId || photo.imageId;

      // Try annotated image from in-memory map first (fastest)
      let annotatedImage = this.bulkAnnotatedImagesMap.get(attachId);
      if (!annotatedImage && localImageId) {
        annotatedImage = this.bulkAnnotatedImagesMap.get(localImageId);
      }

      // If not in memory, try to get from IndexedDB cache
      if (!annotatedImage && (photo.hasAnnotations || photo.Drawings)) {
        try {
          annotatedImage = await this.indexedDb.getCachedAnnotatedImage(attachId) || undefined;
          if (!annotatedImage && localImageId) {
            annotatedImage = await this.indexedDb.getCachedAnnotatedImage(localImageId) || undefined;
          }
          // Store in memory map for future use
          if (annotatedImage) {
            this.bulkAnnotatedImagesMap.set(attachId || localImageId, annotatedImage);
          }
        } catch (e) {
          console.warn('[IMAGE ERROR] Failed to get cached annotated image:', e);
        }
      }

      if (annotatedImage) {
        console.log('[IMAGE ERROR] Using cached ANNOTATED image:', attachId || localImageId);
        img.src = annotatedImage;
        photo.displayUrl = annotatedImage;
        photo.thumbnailUrl = annotatedImage;
        // Don't update photo.url - keep original for re-editing
        return;
      }

      // Fallback 1: Try LocalImage system
      if (photo.isLocalImage || photo.localImageId || photo.imageId) {
        const localImage = await this.indexedDb.getLocalImage(localImageId);

        if (localImage) {
          const fallbackUrl = await this.localImageService.getDisplayUrl(localImage);
          if (fallbackUrl && fallbackUrl !== 'assets/img/photo-placeholder.png') {
            console.log('[IMAGE ERROR] Using LocalImage fallback:', localImageId);
            img.src = fallbackUrl;
            photo.displayUrl = fallbackUrl;
            photo.url = fallbackUrl;
            photo.thumbnailUrl = fallbackUrl;
            return;
          }
        }
      }

      // Fallback 2: Try cached photo by attachId
      if (attachId && !attachId.startsWith('temp_') && !attachId.startsWith('img_')) {
        const cached = await this.indexedDb.getCachedPhoto(attachId);
        if (cached) {
          console.log('[IMAGE ERROR] Using cached photo fallback:', attachId);
          img.src = cached;
          photo.displayUrl = cached;
          photo.url = cached;
          photo.thumbnailUrl = cached;
          return;
        }
      }

      // Fallback 3: Placeholder
      console.log('[IMAGE ERROR] No fallback available, showing placeholder');
      img.src = 'assets/img/photo-placeholder.png';
      photo.displayUrl = 'assets/img/photo-placeholder.png';
      photo.loading = false;

    } catch (err) {
      console.error('[IMAGE ERROR] Fallback failed:', err);
      img.src = 'assets/img/photo-placeholder.png';
      photo.displayUrl = 'assets/img/photo-placeholder.png';
      photo.loading = false;
    }
  }

  openVisualDetail(categoryName: string, item: VisualItem) {
    // Navigate relative to parent route since CategoryDetailPage is at the '' child path
    this.router.navigate(['visual', item.templateId], { relativeTo: this.route.parent });
  }
}
