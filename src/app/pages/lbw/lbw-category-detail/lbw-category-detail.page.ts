import { Component, OnInit, ChangeDetectorRef, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController, AlertController, ActionSheetController, ModalController, IonContent } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import { CaspioService } from '../../../services/caspio.service';
import { OfflineService } from '../../../services/offline.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { CameraService } from '../../../services/camera.service';
import { ImageCompressionService } from '../../../services/image-compression.service';
import { CacheService } from '../../../services/cache.service';
import { LbwDataService } from '..\/lbw-data.service';
import { FabricPhotoAnnotatorComponent } from '../../../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { BackgroundPhotoUploadService } from '../../../services/background-photo-upload.service';
import { IndexedDbService, LocalImage } from '../../../services/indexed-db.service';
import { BackgroundSyncService } from '../../../services/background-sync.service';
import { LocalImageService } from '../../../services/local-image.service';
import { VisualFieldRepoService } from '../../../services/visual-field-repo.service';
import { environment } from '../../../../environments/environment';
import { db, VisualField } from '../../../services/caspio-db';
import { renderAnnotationsOnPhoto } from '../../../utils/annotation-utils';

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
  key?: string;  // Computed key: ${category}_${templateId}
}

@Component({
  selector: 'app-lbw-category-detail',
  templateUrl: './lbw-category-detail.page.html',
  styleUrls: ['./lbw-category-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class LbwCategoryDetailPage implements OnInit, OnDestroy {
  projectId: string = '';
  serviceId: string = '';
  categoryName: string = '';

  loading: boolean = false;  // Start false - show cached data instantly, only show spinner if cache empty
  isRefreshing: boolean = false;  // Track background refresh status
  searchTerm: string = '';
  expandedAccordions: string[] = ['information', 'limitations', 'deficiencies']; // Start expanded like EFE

  // WEBAPP: Expose isWeb for template skeleton loader conditionals
  isWeb = environment.isWeb;

  // Track expanded photos per visual item
  expandedPhotos: { [key: string]: boolean } = {};
  organizedData: {
    comments: VisualItem[];
    limitations: VisualItem[];
    deficiencies: VisualItem[];
  } = {
    comments: [],
    limitations: [],
    deficiencies: []
  };

  visualDropdownOptions: { [templateId: string]: string[] } = {};
  selectedItems: { [key: string]: boolean } = {};
  savingItems: { [key: string]: boolean } = {};

  // Photo storage and tracking
  visualPhotos: { [key: string]: any[] } = {};
  visualRecordIds: { [key: string]: string } = {};
  uploadingPhotosByKey: { [key: string]: boolean } = {};
  loadingPhotosByKey: { [key: string]: boolean } = {};
  photoCountsByKey: { [key: string]: number } = {};
  pendingPhotoUploads: { [key: string]: any[] } = {};
  currentUploadContext: { category: string; itemId: string; action: string } | null = null;
  contextClearTimer: any = null;
  lockedScrollY: number = 0;
  private _loggedPhotoKeys = new Set<string>();
  private isCaptionPopupOpen = false;

  // TASK 4: Bulk cache maps for fast annotated thumbnail display
  private bulkAnnotatedImagesMap: Map<string, string> = new Map();

  // Background upload subscriptions
  private uploadSubscription?: Subscription;
  private taskSubscription?: Subscription;
  private photoSyncSubscription?: Subscription;

  // DEXIE-FIRST: VisualFields subscription for reactive updates
  private visualFieldsSubscription?: Subscription;
  private lastConvertedFields: VisualField[] = [];
  private tempIdToRealIdCache: Map<string, string> = new Map();
  private isPopulatingPhotos: boolean = false;
  private bulkLocalImagesMap: Map<string, LocalImage[]> = new Map();
  private localOperationCooldown: boolean = false;
  private localOperationCooldownTimer: any = null;
  private cacheInvalidationDebounceTimer: any = null;
  private initialLoadComplete: boolean = false;
  private lastLoadedServiceId: string = '';
  private lastLoadedCategoryName: string = '';

  // DEXIE-FIRST: LocalImages liveQuery subscription for reactive photo updates
  private localImagesSubscription?: Subscription;
  // RACE CONDITION FIX: Prevent liveQuery from firing during camera capture
  private isCameraCaptureInProgress: boolean = false;

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
    private offlineTemplate: OfflineTemplateService,
    private changeDetectorRef: ChangeDetectorRef,
    private cameraService: CameraService,
    private imageCompression: ImageCompressionService,
    private hudData: LbwDataService,
    private backgroundUploadService: BackgroundPhotoUploadService,
    private cache: CacheService,
    private indexedDb: IndexedDbService,
    private backgroundSync: BackgroundSyncService,
    private localImageService: LocalImageService,
    private visualFieldRepo: VisualFieldRepoService
  ) {}

  async ngOnInit() {
    // Subscribe to background upload task updates
    this.subscribeToUploadUpdates();

    // Get route params
    // Route structure after nesting: lbw/:projectId/:serviceId (container) -> category/:category -> '' (we are here)
    // - this.route = empty path component
    // - this.route.parent = category/:category (has category param)
    // - this.route.parent.parent = container (has projectId, serviceId)
    this.route.parent?.params.subscribe(params => {
      this.categoryName = params['category'];

      // Get IDs from container route (go up 2 levels)
      this.route.parent?.parent?.params.subscribe(parentParams => {
        this.projectId = parentParams['projectId'];
        this.serviceId = parentParams['serviceId'];

        console.log('Category:', this.categoryName, 'ProjectId:', this.projectId, 'ServiceId:', this.serviceId);

        if (this.projectId && this.serviceId && this.categoryName) {
          this.loadData();
        } else {
          console.error('Missing required route params');
          this.loading = false;
        }
      });
    });
  }

  async ionViewWillEnter() {
    console.log('[LBW] ionViewWillEnter - serviceId:', this.serviceId, 'categoryName:', this.categoryName);

    // Set up deferred subscriptions if not already done (HUD pattern)
    if (!this.localImagesSubscription && this.serviceId) {
      this.subscribeToLocalImagesChanges();
    }

    // MOBILE MODE: Reload data from Dexie when returning to page
    // Sync may have completed while user was on visual-detail page
    if (!environment.isWeb && this.serviceId && this.categoryName && this.initialLoadComplete) {
      console.log('[LBW] MOBILE: Reloading from Dexie on page return...');
      this.loading = false;

      // Merge Dexie visual fields to get latest edits
      await this.mergeDexieVisualFields();

      // HUD PATTERN: Refresh lastConvertedFields from Dexie before populating photos
      // This ensures we have fresh visualId/tempVisualId values after sync
      await this.refreshLastConvertedFieldsFromDexie();

      // Repopulate photos from Dexie (sync may have updated entityIds)
      if (this.lastConvertedFields.length > 0) {
        await this.populatePhotosFromDexie(this.lastConvertedFields);
      }

      this.changeDetectorRef.detectChanges();
      return;
    }

    // WEBAPP: Reload data when returning to this page
    // This ensures photos and title/text edits made in visual-detail show here
    if (environment.isWeb && this.serviceId && this.categoryName) {
      console.log('[LBW] WEBAPP: ionViewWillEnter - reloading data...');
      this.loading = false;

      // CRITICAL: Clear caches to force fresh data load
      // This ensures title/text edits made in visual-detail are reflected here
      this.hudData.clearServiceCaches(this.serviceId);

      // Reload existing visuals with fresh data (bypass cache)
      await this.loadExistingVisuals(false);

      // If we have visual record IDs, reload photos from API
      if (Object.keys(this.visualRecordIds).length > 0) {
        await this.loadPhotosFromAPI();
      }

      this.changeDetectorRef.detectChanges();
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
    // DEXIE-FIRST: Clean up VisualFields subscription
    if (this.visualFieldsSubscription) {
      this.visualFieldsSubscription.unsubscribe();
    }
    // DEXIE-FIRST: Clean up LocalImages subscription
    if (this.localImagesSubscription) {
      this.localImagesSubscription.unsubscribe();
    }
    // Clear any pending timers
    if (this.localOperationCooldownTimer) {
      clearTimeout(this.localOperationCooldownTimer);
    }
    if (this.cacheInvalidationDebounceTimer) {
      clearTimeout(this.cacheInvalidationDebounceTimer);
    }
    console.log('[LBW CATEGORY DETAIL] Component destroyed, but uploads continue in background');
  }

  /**
   * Subscribe to background upload updates
   */
  private subscribeToUploadUpdates() {
    this.taskSubscription = this.backgroundUploadService.getTaskUpdates().subscribe(task => {
      if (!task) return;

      console.log('[UPLOAD UPDATE] Task:', task.id, 'Status:', task.status, 'Progress:', task.progress);

      const key = task.key;
      const tempPhotoId = task.tempPhotoId;

      if (!this.visualPhotos[key]) return;

      const photoIndex = this.visualPhotos[key].findIndex(p =>
        p.AttachID === tempPhotoId || p.id === tempPhotoId
      );

      if (photoIndex === -1) return;

      if (task.status === 'uploading') {
        this.visualPhotos[key][photoIndex].uploading = true;
        this.visualPhotos[key][photoIndex].progress = task.progress;
      } else if (task.status === 'completed') {
        const result = (task as any).result;
        if (result && result.AttachID) {
          this.updatePhotoAfterUpload(key, photoIndex, result, task.caption);
        }
      } else if (task.status === 'failed') {
        this.visualPhotos[key][photoIndex].uploading = false;
        this.visualPhotos[key][photoIndex].uploadFailed = true;
        console.error('[UPLOAD UPDATE] Upload failed for task:', task.id, task.error);
      }

      this.changeDetectorRef.detectChanges();
    });

    // Subscribe to LBW-specific photo upload completions (DEXIE-FIRST pattern)
    // This handles the case where LBW photos are uploaded via background sync
    this.backgroundSync.lbwPhotoUploadComplete$.subscribe(async (event) => {
      console.log('[LBW PHOTO SYNC] LBW photo upload completed:', event.imageId, 'attachId:', event.attachId);

      // Find the photo in our visualPhotos by imageId
      for (const key of Object.keys(this.visualPhotos)) {
        const photoIndex = this.visualPhotos[key].findIndex(p =>
          p.imageId === event.imageId ||
          p.AttachID === event.imageId ||
          p.id === event.imageId
        );

        if (photoIndex !== -1) {
          console.log('[LBW PHOTO SYNC] Found photo at key:', key, 'index:', photoIndex);

          // Update the photo with the real attachId
          this.visualPhotos[key][photoIndex].AttachID = event.attachId;
          this.visualPhotos[key][photoIndex].attachId = event.attachId;
          this.visualPhotos[key][photoIndex].uploading = false;
          this.visualPhotos[key][photoIndex].queued = false;
          this.visualPhotos[key][photoIndex].isLocal = false;

          this.changeDetectorRef.detectChanges();
          break;
        }
      }
    });

    // Subscribe to background sync photo upload completions
    // This handles the case where photos are uploaded via IndexedDB queue (offline -> online)
    this.photoSyncSubscription = this.backgroundSync.photoUploadComplete$.subscribe(async (event) => {
      console.log('[PHOTO SYNC] Photo upload completed:', event.tempFileId);

      // Find the photo in our visualPhotos by temp file ID
      for (const key of Object.keys(this.visualPhotos)) {
        const photoIndex = this.visualPhotos[key].findIndex(p =>
          p.AttachID === event.tempFileId ||
          p._pendingFileId === event.tempFileId ||
          p.id === event.tempFileId
        );

        if (photoIndex !== -1) {
          console.log('[PHOTO SYNC] Found photo at key:', key, 'index:', photoIndex);

          // Update the photo with the result from sync
          const result = event.result;
          const actualResult = result?.Result?.[0] || result;
          const caption = this.visualPhotos[key][photoIndex].caption || '';

          await this.updatePhotoAfterUpload(key, photoIndex, {
            AttachID: actualResult.PK_ID || actualResult.AttachID,
            Result: [actualResult],
            ...actualResult
          }, caption);

          // Also remove queued flag
          if (this.visualPhotos[key][photoIndex]) {
            this.visualPhotos[key][photoIndex].queued = false;
            this.visualPhotos[key][photoIndex]._pendingFileId = undefined;
          }

          this.changeDetectorRef.detectChanges();
          break;
        }
      }
    });

    // SYNC FIX: Subscribe to LBW visual sync completions
    // When a visual syncs, update the Dexie VisualField with the real LBWID
    // This ensures future lookups work directly without temp ID resolution
    this.backgroundSync.lbwSyncComplete$.subscribe(async (event) => {
      if (event.operation !== 'create') return;
      if (!event.serviceId || event.serviceId !== this.serviceId) return;

      console.log('[LBW SYNC] Visual synced:', event.lbwId, 'for service:', event.serviceId);

      // Find which key this visual belongs to by checking visualRecordIds
      for (const [key, visualId] of Object.entries(this.visualRecordIds)) {
        // Skip if not a temp ID
        if (!String(visualId).startsWith('temp_')) continue;

        // Check if this temp ID maps to the synced real ID
        const mappedRealId = await this.indexedDb.getRealId(String(visualId));
        if (mappedRealId && mappedRealId === event.lbwId) {
          console.log('[LBW SYNC] Found matching key:', key, 'temp:', visualId, '-> real:', event.lbwId);

          // Update visualRecordIds with real ID
          const previousTempId = String(visualId);
          this.visualRecordIds[key] = event.lbwId;

          // Cache temp->real mapping for synchronous lookup
          this.tempIdToRealIdCache.set(previousTempId, event.lbwId);

          // Extract templateId from key (format: category_templateId)
          const keyParts = key.split('_');
          const templateId = parseInt(keyParts[keyParts.length - 1], 10);
          const category = keyParts.slice(0, -1).join('_');

          if (!isNaN(templateId)) {
            // Update Dexie VisualField with real LBWID
            try {
              await this.visualFieldRepo.setField(this.serviceId, category, templateId, {
                visualId: event.lbwId,
                // Keep tempVisualId for fallback lookup until LocalImages.entityId is updated
              });
              console.log('[LBW SYNC] Updated Dexie VisualField:', templateId, '-> visualId:', event.lbwId);
            } catch (err) {
              console.error('[LBW SYNC] Failed to update Dexie VisualField:', err);
            }

            // Update lastConvertedFields in-memory
            const fieldToUpdate = this.lastConvertedFields.find(f => f.templateId === templateId);
            if (fieldToUpdate) {
              fieldToUpdate.visualId = event.lbwId;
              console.log('[LBW SYNC] Updated lastConvertedFields for templateId:', templateId);
            }
          }

          // Update LocalImages.entityId from temp to real
          this.indexedDb.updateEntityIdForImages(previousTempId, event.lbwId).catch(err => {
            console.error('[LBW SYNC] Failed to update LocalImage entityIds:', err);
          });

          this.changeDetectorRef.detectChanges();
          break;
        }
      }
    });
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
      console.log('[LBW COOLDOWN] Local operation cooldown ended');
    }, 3000);
  }

  /**
   * Update photo object after successful upload
   */
  private async updatePhotoAfterUpload(key: string, photoIndex: number, result: any, caption: string) {
    console.log('[UPLOAD UPDATE] ========== Updating photo after upload ==========');
    console.log('[UPLOAD UPDATE] Key:', key, 'Index:', photoIndex);
    console.log('[UPLOAD UPDATE] Result:', JSON.stringify(result, null, 2));

    // Handle both direct result and Result array format
    const actualResult = result.Result && result.Result[0] ? result.Result[0] : result;
    const s3Key = actualResult.Attachment;
    const uploadedPhotoUrl = actualResult.Photo || actualResult.thumbnailUrl || actualResult.url;
    let displayableUrl = uploadedPhotoUrl || '';

    console.log('[UPLOAD UPDATE] S3 key:', s3Key);

    // Check if this is an S3 image
    if (s3Key && this.caspioService.isS3Key(s3Key)) {
      try {
        console.log('[UPLOAD UPDATE] ✨ S3 image, fetching URL...');
        displayableUrl = await this.caspioService.getS3FileUrl(s3Key);
        console.log('[UPLOAD UPDATE] ✅ Got S3 URL');
      } catch (err) {
        console.error('[UPLOAD UPDATE] ❌ S3 failed:', err);
        displayableUrl = 'assets/img/photo-placeholder.svg';
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
          displayableUrl = 'assets/img/photo-placeholder.svg';
        }
      } catch (err) {
        console.error('[UPLOAD UPDATE] ❌ Failed to load uploaded image:', err);
        displayableUrl = 'assets/img/photo-placeholder.svg';
      }
    } else {
      console.log('[UPLOAD UPDATE] URL already displayable (data: or blob:)');
    }

    console.log('[UPLOAD UPDATE] Final displayableUrl length:', displayableUrl?.length || 0);

    // Get AttachID from the actual result
    const attachId = actualResult.AttachID || actualResult.PK_ID || actualResult.id;
    console.log('[UPLOAD UPDATE] Using AttachID:', attachId);

    // Revoke old blob URL
    const oldPhoto = this.visualPhotos[key][photoIndex];
    if (oldPhoto?.url?.startsWith('blob:')) URL.revokeObjectURL(oldPhoto.url);

    // Update photo object
    this.visualPhotos[key][photoIndex] = {
      ...this.visualPhotos[key][photoIndex],
      AttachID: attachId,
      id: attachId,
      uploading: false,
      progress: 100,
      Attachment: s3Key,
      filePath: s3Key || uploadedPhotoUrl,
      Photo: uploadedPhotoUrl,
      url: displayableUrl,
      originalUrl: displayableUrl,
      thumbnailUrl: displayableUrl,
      displayUrl: displayableUrl,
      caption: caption || '',
      annotation: caption || '',
      Annotation: caption || ''
    };

    console.log('[UPLOAD UPDATE] ✅ Photo updated successfully');
    console.log('[UPLOAD UPDATE] Updated photo object:', {
      AttachID: this.visualPhotos[key][photoIndex].AttachID,
      hasUrl: !!this.visualPhotos[key][photoIndex].url,
      urlLength: this.visualPhotos[key][photoIndex].url?.length || 0
    });
    
    this.changeDetectorRef.detectChanges();
    console.log('[UPLOAD UPDATE] ✅ Change detection triggered');
  }

  private async loadData() {
    console.log('[LOAD DATA] ========== STARTING CACHE-FIRST DATA LOAD ==========');

    // MOBILE MODE: Use DEXIE-first pattern - load from local storage, no spinners
    if (!environment.isWeb) {
      console.log('[LOAD DATA] MOBILE MODE: Using DEXIE-first pattern');
      await this.loadDataFromCache();
      return;
    }

    try {
      // WEBAPP MODE: Check if we have cached visuals data - if so, skip loading spinner
      const cachedVisuals = await this.indexedDb.getCachedServiceData(this.serviceId, 'lbw_records');
      const hasCachedData = cachedVisuals && cachedVisuals.length > 0;

      if (hasCachedData) {
        console.log('[LOAD DATA] ✅ Cache HIT - Found', cachedVisuals.length, 'cached visuals, loading instantly');
        // Don't show loading spinner - display cached data immediately
        this.loading = false;
      } else {
        console.log('[LOAD DATA] ⏳ Cache MISS - No cached data, showing loading spinner');
        this.loading = true;
      }

      // Reset state but preserve any photo data during background refresh
      if (!hasCachedData) {
        // Only fully clear state on initial load (cache empty)
        this.visualPhotos = {};
        this.visualRecordIds = {};
        this.uploadingPhotosByKey = {};
        this.loadingPhotosByKey = {};
        this.photoCountsByKey = {};
        this.selectedItems = {};
      }

      this.organizedData = {
        comments: [],
        limitations: [],
        deficiencies: []
      };

      // Load dropdown options for all templates (needed before loading templates)
      console.log('[LOAD DATA] Step 1: Loading dropdown options...');
      await this.loadAllDropdownOptions();

      // Load templates for this category
      console.log('[LOAD DATA] Step 2: Loading templates...');
      await this.loadCategoryTemplates();

      // Load existing visuals - use cache for instant display, background refresh for freshness
      console.log('[LOAD DATA] Step 3: Loading existing visuals (cache-first)...');
      await this.loadExistingVisuals(!!hasCachedData);

      // Restore any pending photos from IndexedDB (offline uploads)
      console.log('[LOAD DATA] Step 4: Restoring pending photos...');
      await this.restorePendingPhotosFromIndexedDB();

      // TITLE/TEXT FIX: Merge edited names and text from Dexie visualFields
      console.log('[LOAD DATA] Step 5: Merging Dexie visualFields (title/text edits)...');
      await this.mergeDexieVisualFields();

      console.log('[LOAD DATA] ========== DATA LOAD COMPLETE ==========');
      console.log('[LOAD DATA] Final state - visualRecordIds:', this.visualRecordIds);
      console.log('[LOAD DATA] Final state - selectedItems:', this.selectedItems);

      // Hide loading spinner (if it was shown)
      this.loading = false;

    } catch (error) {
      console.error('[LOAD DATA] ❌ Error loading category data:', error);
      this.loading = false;
    }
  }

  /**
   * TITLE/TEXT FIX: Merge edited names and text from Dexie visualFields
   * When user edits title/text in visual-detail, it's saved to Dexie.
   * This method merges those edits back into the displayed items.
   */
  private async mergeDexieVisualFields(): Promise<void> {
    try {
      // Load Dexie visualFields for this category using compound index (like HUD)
      const dexieFields = await this.visualFieldRepo.getFieldsForCategory(this.serviceId, this.categoryName);

      if (!dexieFields || dexieFields.length === 0) {
        console.log('[MERGE DEXIE] No Dexie fields found for category:', this.categoryName);
        return;
      }

      console.log('[MERGE DEXIE] Found', dexieFields.length, 'Dexie fields for category:', this.categoryName);

      // Build a map of templateId -> dexieField for quick lookup
      const fieldMap = new Map<number, any>();
      for (const field of dexieFields) {
        if (field.templateId) {
          fieldMap.set(field.templateId, field);
        }
      }

      // Merge into all organized data arrays
      const allItems = [
        ...this.organizedData.comments,
        ...this.organizedData.limitations,
        ...this.organizedData.deficiencies
      ];

      for (const item of allItems) {
        const dexieField = fieldMap.get(item.templateId);
        if (!dexieField) continue;

        const key = `${item.category || this.categoryName}_${item.templateId}`;

        // Store visualId from Dexie if we don't already have it
        const visualId = dexieField.visualId || dexieField.tempVisualId;
        if (visualId && !this.visualRecordIds[key]) {
          this.visualRecordIds[key] = visualId;
          console.log(`[MERGE DEXIE] Stored visualId from Dexie: ${key} = ${visualId}`);
        }

        // TITLE/TEXT FIX: Restore edited name and text from Dexie
        if (dexieField.templateName && dexieField.templateName !== item.name) {
          console.log(`[MERGE DEXIE] Restored title from Dexie - key: ${key}, old: "${item.name}", new: "${dexieField.templateName}"`);
          item.name = dexieField.templateName;
        }
        if (dexieField.templateText && dexieField.templateText !== item.text) {
          console.log(`[MERGE DEXIE] Restored text from Dexie - key: ${key}`);
          item.text = dexieField.templateText;
        }

        // Restore selection state - CRITICAL: Update BOTH item.isSelected AND selectedItems map
        if (dexieField.isSelected) {
          item.isSelected = true;
          this.selectedItems[key] = true;
        }

        // Restore answer if present
        if (dexieField.answer && !item.answer) {
          item.answer = dexieField.answer;
        }
      }

      this.changeDetectorRef.detectChanges();
      console.log('[MERGE DEXIE] Merge complete');

    } catch (error) {
      console.error('[MERGE DEXIE] Error merging Dexie fields:', error);
    }
  }

  private async loadCategoryTemplates() {
    try {
      // DEXIE-FIRST: Get all LBW templates from cache
      const allTemplates = await this.offlineTemplate.getLbwTemplates();
      const hudTemplates = (allTemplates || []).filter((template: any) =>
        template.Category === this.categoryName
      );

      console.log(`[LBW CATEGORY] Found ${hudTemplates.length} templates for category:`, this.categoryName);

      // Organize templates by Kind (Type field in HUD is called "Kind")
      hudTemplates.forEach((template: any) => {
        // Log the Kind value to debug
        console.log('[LBW CATEGORY] Template:', template.Name, 'PK_ID:', template.PK_ID, 'TemplateID:', template.TemplateID, 'Kind:', template.Kind, 'Type:', template.Type);

        const templateData: VisualItem = {
          id: template.PK_ID,
          templateId: template.TemplateID || template.PK_ID,  // Use TemplateID field, fallback to PK_ID
          name: template.Name || 'Unnamed Item',
          text: template.Text || '',
          originalText: template.Text || '',
          type: template.Kind || template.Type || 'Comment',  // Try Kind first, then Type
          category: template.Category,
          answerType: template.AnswerType || 0,
          required: template.Required === 'Yes',
          answer: '',
          isSelected: false,
          photos: []
        };

        // Add to appropriate array based on Kind or Type
        const kind = template.Kind || template.Type || 'Comment';
        const kindLower = kind.toLowerCase().trim();
        
        console.log('[LBW CATEGORY] Processing item:', template.Name, 'Kind value:', kind, 'Lowercased:', kindLower);

        if (kindLower === 'limitation' || kindLower === 'limitations') {
          this.organizedData.limitations.push(templateData);
          console.log('[LBW CATEGORY] Added to Limitations');
        } else if (kindLower === 'deficiency' || kindLower === 'deficiencies') {
          this.organizedData.deficiencies.push(templateData);
          console.log('[LBW CATEGORY] Added to Deficiencies');
        } else {
          this.organizedData.comments.push(templateData);
          console.log('[LBW CATEGORY] Added to Comments/Information');
        }

        // Note: Dropdown options are already loaded via loadAllDropdownOptions()
        // No need to load them individually here
      });

      // Sort each section: multi-select first, then yes/no, then text (for uniform display)
      this.sortOrganizedDataByAnswerType();

      console.log('[LBW CATEGORY] Organized data:', {
        comments: this.organizedData.comments.length,
        limitations: this.organizedData.limitations.length,
        deficiencies: this.organizedData.deficiencies.length
      });

    } catch (error) {
      console.error('Error loading category templates:', error);
    }
  }

  /**
   * Load all dropdown options from Services_LBW_Drop table
   * This loads all options upfront and groups them by TemplateID
   * DEXIE-FIRST: Use cache-first pattern for mobile
   */
  private async loadAllDropdownOptions() {
    try {
      const dropdownData = await this.offlineTemplate.getLbwDropdownOptions();

      console.log('[LBW CATEGORY] Loaded dropdown data:', dropdownData?.length || 0, 'rows');
      
      if (dropdownData && dropdownData.length > 0) {
        // Group dropdown options by TemplateID
        dropdownData.forEach((row: any) => {
          const templateId = String(row.TemplateID); // Convert to string for consistency
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
        
        console.log('[LBW CATEGORY] Grouped by TemplateID:', Object.keys(this.visualDropdownOptions).length, 'templates have options');
        console.log('[LBW CATEGORY] All TemplateIDs with options:', Object.keys(this.visualDropdownOptions));
        
        // Add "Other" option to all multi-select dropdowns if not already present
        Object.entries(this.visualDropdownOptions).forEach(([templateId, options]) => {
          const optionsArray = options as string[];
          if (!optionsArray.includes('Other')) {
            optionsArray.push('Other');
          }
          console.log(`[LBW CATEGORY] TemplateID ${templateId}: ${optionsArray.length} options -`, optionsArray.join(', '));
        });
      } else {
        console.warn('[LBW CATEGORY] No dropdown data received from API');
      }
    } catch (error) {
      console.error('[LBW CATEGORY] Error loading dropdown options:', error);
      // Continue without dropdown options - they're optional
    }
  }

  /**
   * Populate dropdown options from cached data (instant, no API call)
   * This is called during loadDataFromCache() to prevent "jumping" multi-select options
   */
  private populateDropdownOptionsFromCache(dropdownData: any[]): void {
    if (!dropdownData || dropdownData.length === 0) {
      return;
    }

    console.log('[LBW CategoryDetail] Populating dropdown options from cache, count:', dropdownData.length);

    // Group dropdown options by TemplateID
    dropdownData.forEach((row: any) => {
      const templateId = String(row.TemplateID); // Convert to string for consistency
      const dropdownValue = row.Dropdown;

      if (templateId && dropdownValue) {
        if (!this.visualDropdownOptions[templateId]) {
          this.visualDropdownOptions[templateId] = [];
        }
        // Add unique dropdown values (excluding None/Other which we add at end)
        if (!this.visualDropdownOptions[templateId].includes(dropdownValue) &&
            dropdownValue !== 'None' && dropdownValue !== 'Other') {
          this.visualDropdownOptions[templateId].push(dropdownValue);
        }
      }
    });

    // Sort options alphabetically and add "None" and "Other" at the end
    Object.keys(this.visualDropdownOptions).forEach(templateId => {
      const options = this.visualDropdownOptions[templateId];
      if (options) {
        // Sort alphabetically
        options.sort((a: string, b: string) => a.localeCompare(b));
        // Add "None" and "Other" at the end
        if (!options.includes('None')) {
          options.push('None');
        }
        if (!options.includes('Other')) {
          options.push('Other');
        }
      }
    });

    console.log('[LBW CategoryDetail] Populated dropdown options for', Object.keys(this.visualDropdownOptions).length, 'templates from cache');

    // Trigger change detection to update UI immediately
    this.changeDetectorRef.detectChanges();
  }

  private async loadExistingVisuals(useCacheFirst: boolean = false) {
    try {
      // Load all existing LBW visuals for this service and category
      console.log('[LOAD EXISTING] ========== START ==========');
      console.log('[LOAD EXISTING] ServiceID:', this.serviceId);
      console.log('[LOAD EXISTING] Category to match:', this.categoryName);
      console.log('[LOAD EXISTING] UseCacheFirst:', useCacheFirst);

      // WEBAPP API-FIRST: Save existing in-memory mappings before reload
      // This allows matching visuals even when Name has been edited (the mapping persists in memory)
      const existingMappings = environment.isWeb ? new Map(Object.entries(this.visualRecordIds)) : null;
      if (environment.isWeb) {
        console.log(`[LOAD EXISTING] WEBAPP: Saved ${existingMappings?.size || 0} existing in-memory mappings`);
      }

      // CACHE-FIRST PATTERN: Use cached data for instant display, then refresh in background
      // If useCacheFirst is true, we use cache (bypassCache=false) and trigger background refresh
      // If useCacheFirst is false (cache was empty), we do a blocking API call
      const allVisuals = await this.hudData.getVisualsByService(this.serviceId, !useCacheFirst);

      // If we used cache, schedule a background refresh for freshness
      if (useCacheFirst && this.offlineService.isOnline()) {
        this.triggerBackgroundRefresh();
      }

      console.log('[LOAD EXISTING] Total visuals:', allVisuals.length, useCacheFirst ? '(from cache)' : '(from API)');
      console.log('[LOAD EXISTING] All visuals:', allVisuals);
      
      const categoryVisuals = allVisuals.filter((v: any) => v.Category === this.categoryName);
      console.log('[LOAD EXISTING] Visuals for this category:', categoryVisuals.length);

      if (categoryVisuals.length > 0) {
        console.log('[LOAD EXISTING] Category visuals full data:', categoryVisuals);
      }

      // Get all available template items
      const allItems = [
        ...this.organizedData.comments,
        ...this.organizedData.limitations,
        ...this.organizedData.deficiencies
      ];
      console.log('[LOAD EXISTING] Available template items:', allItems.length);
      console.log('[LOAD EXISTING] Template item names:', allItems.map(i => i.name));

      for (const visual of categoryVisuals) {
        console.log('[LOAD EXISTING] ========== Processing Visual ==========');
        console.log('[LOAD EXISTING] Visual LBWID:', visual.LBWID);
        console.log('[LOAD EXISTING] Visual Name:', visual.Name);
        console.log('[LOAD EXISTING] Visual Notes:', visual.Notes);
        console.log('[LOAD EXISTING] Visual Answers:', visual.Answers);
        console.log('[LOAD EXISTING] Visual Kind:', visual.Kind);
        
        // CRITICAL: Skip hidden visuals (soft delete - keeps photos but doesn't show in UI)
        if (visual.Notes && visual.Notes.startsWith('HIDDEN')) {
          console.log('[LOAD EXISTING] ⚠️ Skipping hidden visual:', visual.Name);

          // Store visualRecordId so we can unhide it later if user reselects
          // CRITICAL: Only store if visual's category matches current category
          if (visual.Category === this.categoryName) {
            const LBWID = String(visual.LBWID || visual.PK_ID);
            let item: VisualItem | undefined = undefined;

            // WEBAPP API-FIRST: Check existing in-memory mapping first
            if (environment.isWeb && existingMappings && existingMappings.size > 0) {
              for (const [key, storedLbwId] of existingMappings.entries()) {
                if (storedLbwId === LBWID) {
                  item = allItems.find(i => `${this.categoryName}_${i.id}` === key);
                  break;
                }
              }
            }
            // Fall back to Name matching
            if (!item) {
              item = allItems.find(i => i.name === visual.Name);
            }

            if (item) {
              const key = `${this.categoryName}_${item.id}`;
              this.visualRecordIds[key] = LBWID;
              console.log('[LOAD EXISTING] Stored hidden visual ID for potential unhide:', key, '=', LBWID);
            }
          }
          continue;
        }

        const name = visual.Name;
        const kind = visual.Kind;
        const LBWID = String(visual.LBWID || visual.PK_ID || visual.id);

        // Find the item - WEBAPP uses in-memory mappings, then falls back to Name
        let item: VisualItem | undefined = undefined;

        // WEBAPP API-FIRST PRIORITY 1: Check existing in-memory mapping
        // This ensures visual stays matched even after Name is edited
        if (environment.isWeb && existingMappings && existingMappings.size > 0) {
          for (const [key, storedLbwId] of existingMappings.entries()) {
            if (storedLbwId === LBWID) {
              // Find the template item that matches this key
              item = allItems.find(i => {
                const itemKey = `${this.categoryName}_${i.id}`;
                return itemKey === key;
              });
              if (item) {
                console.log(`[LOAD EXISTING] WEBAPP PRIORITY 1: Matched by in-memory mapping: LBWID=${LBWID} -> key=${key}`);
              }
              break;
            }
          }
        }

        // PRIORITY 2: Fall back to Name + Category matching
        // CRITICAL: Must check category to avoid matching visuals from other categories with same name
        if (!item && visual.Category === this.categoryName) {
          item = allItems.find(i => i.name === visual.Name);
          if (item) {
            console.log(`[LOAD EXISTING] PRIORITY 2: Matched by Name+Category: "${visual.Name}" in "${visual.Category}"`);
          }
        } else if (!item && visual.Category !== this.categoryName) {
          console.log(`[LOAD EXISTING] Skipping visual from different category: "${visual.Name}" in "${visual.Category}" (current: "${this.categoryName}")`);
          continue;
        }
        
        // If no template match found, this is a CUSTOM visual - create dynamic item
        if (!item) {
          console.log('[LOAD EXISTING] Creating dynamic item for custom visual:', name, kind);

          // Create a dynamic VisualItem for custom visuals
          const customItem: VisualItem = {
            id: `custom_${LBWID}`,
            templateId: 0,
            name: visual.Name || 'Custom Item',
            text: visual.Text || '',
            originalText: visual.Text || '',
            type: visual.Kind || 'Comment',
            category: visual.Category,
            answerType: 0,
            required: false,
            answer: visual.Answers || '',
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
            // Default to comments
            this.organizedData.comments.push(customItem);
          }

          item = customItem;
          console.log('[LOAD EXISTING] ✅ Created and added custom item:', item.name);
        } else {
          console.log('[LOAD EXISTING] ✅ Found matching template item:');
          console.log('[LOAD EXISTING]   - Name:', item.name);
          console.log('[LOAD EXISTING]   - ID:', item.id);
          console.log('[LOAD EXISTING]   - TemplateID:', item.templateId);
          console.log('[LOAD EXISTING]   - AnswerType:', item.answerType);
        }

        const key = `${this.categoryName}_${item.id}`;

        console.log('[LOAD EXISTING] Constructed key:', key);
        console.log('[LOAD EXISTING] LBWID to store:', LBWID);

        // Mark as selected
        this.selectedItems[key] = true;
        console.log('[LOAD EXISTING] ✅ selectedItems[' + key + '] = true');

        // Store visual record ID
        this.visualRecordIds[key] = LBWID;
        console.log('[LOAD EXISTING] ✅ visualRecordIds[' + key + '] = ' + LBWID);

        // Update item with saved answer
        item.answer = visual.Answers || '';
        item.otherValue = visual.OtherValue || '';
        console.log('[LOAD EXISTING] ✅ item.answer set to:', item.answer);

        // Force change detection to update UI
        this.changeDetectorRef.detectChanges();

        // MOBILE MODE: Load photos for this visual individually
        // WEBAPP MODE: Photos will be loaded in batch below
        if (!environment.isWeb) {
          await this.loadPhotosForVisual(LBWID, key);
        }
      }

      // WEBAPP MODE: Load all photos from API in one batch with signed URLs
      // This ensures photos are loaded synchronously before the page renders
      if (environment.isWeb) {
        console.log('[LOAD EXISTING] WEBAPP: Loading all photos from API...');
        await this.loadPhotosFromAPI();
      }

      // Sort each section: multi-select first, then yes/no, then text (for uniform display)
      this.sortOrganizedDataByAnswerType();

      console.log('[LOAD EXISTING] ========== FINAL STATE ==========');
      console.log('[LOAD EXISTING] visualRecordIds:', JSON.stringify(this.visualRecordIds));
      console.log('[LOAD EXISTING] selectedItems:', JSON.stringify(this.selectedItems));
      console.log('[LOAD EXISTING] Items with answers:', allItems.filter(i => i.answer).map(i => ({ name: i.name, answer: i.answer })));
      console.log('[LOAD EXISTING] ========== END ==========');

    } catch (error) {
      console.error('[LOAD EXISTING] ❌ Error loading existing visuals:', error);
    }
  }

  /**
   * Trigger a background refresh to update cached data without blocking the UI
   * This ensures data stays fresh while providing instant page loads
   */
  private triggerBackgroundRefresh(): void {
    console.log('[BACKGROUND REFRESH] Scheduling background data refresh...');
    this.isRefreshing = true;

    // Use setTimeout to ensure this runs after the current render cycle
    setTimeout(async () => {
      try {
        console.log('[BACKGROUND REFRESH] Starting background refresh...');

        // Fetch fresh data from API (bypass cache)
        const freshVisuals = await this.hudData.getVisualsByService(this.serviceId, true);
        console.log('[BACKGROUND REFRESH] Fetched', freshVisuals.length, 'fresh visuals');

        // Cache the fresh data in IndexedDB for future instant loads
        await this.indexedDb.cacheServiceData(this.serviceId, 'lbw_records', freshVisuals);
        console.log('[BACKGROUND REFRESH] Cached fresh data to IndexedDB');

        // Update UI with fresh data (preserving photos that are uploading)
        const categoryVisuals = freshVisuals.filter((v: any) => v.Category === this.categoryName);
        await this.processVisualsUpdate(categoryVisuals);

        this.isRefreshing = false;
        this.changeDetectorRef.detectChanges();
        console.log('[BACKGROUND REFRESH] ✅ Background refresh complete');
      } catch (error) {
        console.error('[BACKGROUND REFRESH] ❌ Error during background refresh:', error);
        this.isRefreshing = false;
      }
    }, 100);
  }

  /**
   * Process visual updates from background refresh without losing upload state
   */
  private async processVisualsUpdate(categoryVisuals: any[]): Promise<void> {
    // Get all available template items
    const allItems = [
      ...this.organizedData.comments,
      ...this.organizedData.limitations,
      ...this.organizedData.deficiencies
    ];

    for (const visual of categoryVisuals) {
      // Skip hidden visuals
      if (visual.Notes && visual.Notes.startsWith('HIDDEN')) {
        continue;
      }

      // CRITICAL: Only process visuals that match the current category
      // This prevents visuals from other categories with same name from overwriting
      if (visual.Category !== this.categoryName) {
        continue;
      }

      const LBWID = String(visual.LBWID || visual.PK_ID || visual.id);
      const item = allItems.find(i => i.name === visual.Name);

      if (item) {
        const key = `${this.categoryName}_${item.id}`;

        // Update selection state and record ID
        this.selectedItems[key] = true;
        this.visualRecordIds[key] = LBWID;

        // Update answer but preserve any local edits
        if (!item.answer && visual.Answers) {
          item.answer = visual.Answers;
        }

        // Only load photos if we don't already have them (preserve uploading photos)
        if (!this.visualPhotos[key] || this.visualPhotos[key].length === 0) {
          await this.loadPhotosForVisual(LBWID, key);
        }
      }
    }
  }

  // ============================================================================
  // DEXIE-FIRST METHODS - MOBILE MODE
  // ============================================================================

  /**
   * MOBILE MODE: Load data from Dexie cache first for instant page loads
   * This is the DEXIE-first pattern - no loading spinners, instant UI
   * PHASE 7.1: Set loading = false early for cache-first instant display
   */
  private async loadDataFromCache(): Promise<void> {
    console.log('[LBW CategoryDetail] MOBILE MODE: loadDataFromCache() starting...');
    // PHASE 7.1: For MOBILE cache-first, don't show loading spinner initially
    // Only show spinner if we need to fall back to API (no cached templates)
    this.loading = false;
    this.changeDetectorRef.detectChanges();

    try {
      // Load LBW templates, visuals, AND dropdown options from cache IN PARALLEL
      // CRITICAL: Load dropdown options with templates for instant multi-select display (no jumping)
      const [templates, visuals, dropdownData] = await Promise.all([
        this.indexedDb.getCachedTemplates('lbw'),
        this.hudData.getVisualsByService(this.serviceId, false), // false = use cache
        this.indexedDb.getCachedTemplates('lbw_dropdown')
      ]);

      console.log(`[LBW CategoryDetail] MOBILE: Loaded ${templates?.length || 0} templates, ${visuals?.length || 0} LBW records, ${dropdownData?.length || 0} dropdown options from cache`);

      // INSTANT DROPDOWN OPTIONS: Populate dropdown options from cache immediately
      // This prevents "jumping" where multi-select options appear after a delay
      if (dropdownData && dropdownData.length > 0) {
        this.populateDropdownOptionsFromCache(dropdownData);
      }

      // If no templates in cache, fall back to API
      if (!templates || templates.length === 0) {
        console.warn('[LBW CategoryDetail] MOBILE: No templates in cache, falling back to API...');
        // Show loading spinner for API fallback (no cached data available)
        this.loading = true;
        await this.loadAllDropdownOptions();
        await this.loadCategoryTemplates();
        await this.loadExistingVisuals(false);
        await this.restorePendingPhotosFromIndexedDB();
        await this.mergeDexieVisualFields();
        this.loading = false;
        this.initialLoadComplete = true;
        this.changeDetectorRef.detectChanges();
        return;
      }

      // Filter templates for this category
      const categoryTemplates = (templates || []).filter((t: any) => t.Category === this.categoryName);
      const categoryVisuals = (visuals || []).filter((v: any) => v.Category === this.categoryName);

      // TITLE EDIT FIX: Load Dexie visualFields FIRST to get templateId -> visualId mappings
      // Use getFieldsForCategory() like HUD does - uses compound index for reliable lookup
      const dexieFields = await this.visualFieldRepo.getFieldsForCategory(this.serviceId, this.categoryName);

      // Build templateId -> visualId map from Dexie
      const templateToVisualMap = new Map<number, string>();
      for (const field of dexieFields) {
        const visualId = field.visualId || field.tempVisualId;
        if (visualId && field.templateId) {
          templateToVisualMap.set(field.templateId, visualId);
        }
      }
      console.log(`[LBW CategoryDetail] MOBILE: Built templateId->visualId map with ${templateToVisualMap.size} entries from Dexie (category: ${this.categoryName})`);

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

        // TITLE EDIT FIX: PRIORITY 1 - Find by LBWID from Dexie mapping
        let visual: any = null;
        const dexieVisualId = templateToVisualMap.get(templateId);
        if (dexieVisualId) {
          // SYNC FIX: If dexieVisualId is a temp ID, check if it maps to a real LBWID
          // After sync, Dexie still has tempVisualId but cache has real LBWID
          let effectiveVisualId = String(dexieVisualId);
          if (effectiveVisualId.startsWith('temp_')) {
            const mappedRealId = await this.indexedDb.getRealId(effectiveVisualId);
            if (mappedRealId) {
              console.log(`[LBW CategoryDetail] MOBILE: Resolved temp ID ${effectiveVisualId} -> real ID ${mappedRealId}`);
              effectiveVisualId = mappedRealId;
            }
          }
          visual = (categoryVisuals || []).find((v: any) =>
            String(v.LBWID || v.PK_ID) === effectiveVisualId
          );
          if (visual) {
            console.log(`[LBW CategoryDetail] MOBILE: Matched visual by Dexie LBWID for template ${templateId}:`, effectiveVisualId);
          }
        }

        // PRIORITY 2: Find by LBWTemplateID/VisualTemplateID/TemplateID
        if (!visual) {
          visual = (categoryVisuals || []).find((v: any) => {
            const vTemplateId = v.LBWTemplateID || v.VisualTemplateID || v.TemplateID;
            return vTemplateId == templateId;
          });
        }

        // PRIORITY 3: Fallback match by name
        if (!visual && templateName) {
          visual = (categoryVisuals || []).find((v: any) => v.Name === templateName);
        }

        const itemKey = `${this.categoryName}_${templateId}`;

        const item: VisualItem = {
          id: visual ? (visual.LBWID || visual.VisualID || visual.PK_ID) : templateId,
          templateId: templateId,
          name: visual?.Name || template.Name || '',
          text: visual?.VisualText || visual?.Text || template.Text || '',
          originalText: template.Text || '',
          type: template.Kind || 'Comment',
          category: template.Category || this.categoryName,
          answerType: template.AnswerType || 0,
          required: false,
          answer: visual?.Answers || '',
          otherValue: (template.AnswerType === 2 && visual?.Notes && !String(visual.Notes).startsWith('HIDDEN')) ? visual.Notes : '',
          isSelected: !!visual,
          key: itemKey
        };

        // Add to appropriate section
        if (kind === 'limitation' || kind === 'limitations') {
          organizedData.limitations.push(item);
        } else if (kind === 'deficiency' || kind === 'deficiencies') {
          organizedData.deficiencies.push(item);
        } else {
          organizedData.comments.push(item);
        }

        // Track visual record IDs and selection state
        if (visual) {
          const visualId = visual.LBWID || visual.VisualID || visual.PK_ID;
          this.visualRecordIds[itemKey] = String(visualId);
          this.selectedItems[itemKey] = true;
        }
      }

      this.organizedData = organizedData;

      console.log(`[LBW CategoryDetail] MOBILE: Organized - ${organizedData.comments.length} comments, ${organizedData.limitations.length} limitations, ${organizedData.deficiencies.length} deficiencies`);

      // DEXIE-FIRST: Load VisualFields from Dexie to restore local changes
      // dexieFields is already filtered by category from getFieldsForCategory() above
      try {
        const dexieFieldMap = new Map<number, any>();
        for (const field of dexieFields) {
          dexieFieldMap.set(field.templateId, field);
        }

        // Merge Dexie field data into items
        const allItems = [...organizedData.comments, ...organizedData.limitations, ...organizedData.deficiencies];
        for (const item of allItems) {
          const dexieField = dexieFieldMap.get(item.templateId);
          if (dexieField) {
            const key = `${dexieField.category}_${dexieField.templateId}`;
            const visualId = dexieField.visualId || dexieField.tempVisualId;

            // Restore visualId for photo matching
            if (visualId && !this.visualRecordIds[key]) {
              this.visualRecordIds[key] = visualId;
            }

            // TITLE/TEXT FIX: Restore edited name and text from Dexie
            if (dexieField.templateName && dexieField.templateName !== item.name) {
              console.log(`[LBW CategoryDetail] MOBILE: Restored title from Dexie - key: ${key}, old: "${item.name}", new: "${dexieField.templateName}"`);
              item.name = dexieField.templateName;
            }
            if (dexieField.templateText && dexieField.templateText !== item.text) {
              item.text = dexieField.templateText;
            }

            // Restore answer from Dexie
            if (dexieField.answer !== undefined && dexieField.answer !== null && dexieField.answer !== '') {
              item.answer = dexieField.answer;
            }

            // Restore otherValue and isSelected
            if (dexieField.otherValue !== undefined && dexieField.otherValue !== null) {
              item.otherValue = dexieField.otherValue;
            }
            if (dexieField.isSelected) {
              item.isSelected = true;
              this.selectedItems[key] = true;
            }

            // Restore dropdownOptions from Dexie
            if (dexieField.dropdownOptions && dexieField.dropdownOptions.length > 0) {
              this.visualDropdownOptions[item.templateId] = dexieField.dropdownOptions;
            }
          }
        }

        console.log(`[LBW CategoryDetail] MOBILE: Merged ${dexieFieldMap.size} VisualFields from Dexie`);

        // CUSTOM VISUAL FIX: Add custom visuals from Dexie that aren't in organizedData
        // dexieFields is already filtered by category from getFieldsForCategory()
        for (const field of dexieFields) {
          if (field.templateId < 0 && field.isSelected) {
            const existingItem = allItems.find(item => item.templateId === field.templateId);
            if (!existingItem) {
              const key = `${field.category}_${field.templateId}`;
              const visualId = field.tempVisualId || field.visualId;

              const customItem: VisualItem = {
                id: field.tempVisualId || field.visualId || field.templateId,
                templateId: field.templateId,
                name: field.templateName || 'Custom Item',
                text: field.templateText || '',
                originalText: field.templateText || '',
                type: field.kind || 'Comment',
                category: field.category,
                answerType: 0,
                required: false,
                answer: field.answer || '',
                isSelected: true,
                photos: [],
                key: key
              };

              // Add to appropriate section
              if (field.kind === 'Comment') {
                organizedData.comments.push(customItem);
              } else if (field.kind === 'Limitation') {
                organizedData.limitations.push(customItem);
              } else if (field.kind === 'Deficiency') {
                organizedData.deficiencies.push(customItem);
              } else {
                organizedData.comments.push(customItem);
              }

              if (visualId) {
                this.visualRecordIds[key] = visualId;
              }
              this.selectedItems[key] = true;

              console.log(`[LBW CategoryDetail] MOBILE: Added custom visual from Dexie: templateId=${field.templateId}, name="${customItem.name}"`);
            }
          }
        }
      } catch (err) {
        console.error('[LBW CategoryDetail] MOBILE: Failed to load VisualFields from Dexie:', err);
      }

      // Sort each section: multi-select first, then yes/no, then text (for uniform display)
      this.sortOrganizedDataByAnswerType();

      // MOBILE FIX: Populate lastConvertedFields from organizedData
      this.lastConvertedFields = this.buildConvertedFieldsFromOrganizedData(organizedData);
      console.log(`[LBW CategoryDetail] MOBILE: Built ${this.lastConvertedFields.length} converted fields for photo matching`);

      // Load photos from Dexie (LocalImages table)
      await this.populatePhotosFromDexie(this.lastConvertedFields);

      // Subscribe to VisualFields changes
      this.subscribeToVisualFieldChanges();

      // DEXIE-FIRST: Subscribe to LocalImages changes for reactive photo updates
      this.subscribeToLocalImagesChanges();

      // Load dropdown options from cache
      const cachedDropdownData = await this.indexedDb.getCachedTemplates('lbw_dropdown') || [];
      if (cachedDropdownData.length > 0) {
        this.populateDropdownOptionsFromCache(cachedDropdownData);
      }

      // Update tracking variables
      this.lastLoadedServiceId = this.serviceId;
      this.lastLoadedCategoryName = this.categoryName;
      this.initialLoadComplete = true;

    } catch (error) {
      console.error('[LBW CategoryDetail] MOBILE: Error loading data from cache:', error);
    } finally {
      this.loading = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * MOBILE FIX: Build VisualField-like objects from organizedData
   * Required for populatePhotosFromDexie() to work
   */
  private buildConvertedFieldsFromOrganizedData(data: { comments: VisualItem[]; limitations: VisualItem[]; deficiencies: VisualItem[] }): VisualField[] {
    const fields: VisualField[] = [];
    const allItems = [...data.comments, ...data.limitations, ...data.deficiencies];

    for (const item of allItems) {
      const key = (item as any).key || `${item.category || this.categoryName}_${item.templateId}`;
      const visualId = this.visualRecordIds[key];

      // Determine visualId and tempVisualId
      let effectiveVisualId: string | null = null;
      let effectiveTempVisualId: string | null = null;

      if (visualId) {
        const visualIdStr = String(visualId);
        if (visualIdStr.startsWith('temp_')) {
          effectiveTempVisualId = visualIdStr;
        } else {
          effectiveVisualId = visualIdStr;
          // Reverse lookup in tempIdToRealIdCache
          for (const [tempId, mappedRealId] of this.tempIdToRealIdCache.entries()) {
            if (mappedRealId === visualIdStr) {
              effectiveTempVisualId = tempId;
              break;
            }
          }
        }
      }

      fields.push({
        key: `${this.serviceId}:${item.category || this.categoryName}:${item.templateId}`,
        serviceId: this.serviceId,
        category: item.category || this.categoryName,
        templateId: item.templateId,
        templateName: item.name || '',
        templateText: item.text || '',
        kind: (item.type || 'Comment') as 'Comment' | 'Limitation' | 'Deficiency',
        answerType: item.answerType || 0,
        isSelected: item.isSelected || false,
        answer: item.answer || '',
        otherValue: item.otherValue || '',
        visualId: effectiveVisualId,
        tempVisualId: effectiveTempVisualId,
        photoCount: this.visualPhotos[key]?.length || 0,
        rev: 0,
        updatedAt: Date.now(),
        dirty: false
      });
    }

    return fields;
  }

  /**
   * DEXIE-FIRST: Populate photos directly from Dexie LocalImages table
   * Uses 4-tier fallback for robust photo matching
   */
  private async populatePhotosFromDexie(fields: VisualField[]): Promise<void> {
    // MUTEX: Prevent concurrent calls
    if (this.isPopulatingPhotos) {
      console.log('[LBW DEXIE-FIRST] Skipping - already populating photos (mutex)');
      return;
    }
    this.isPopulatingPhotos = true;

    try {
      console.log('[LBW DEXIE-FIRST] Populating photos directly from Dexie...');

      // Load annotated images in background (non-blocking)
      if (this.bulkAnnotatedImagesMap.size === 0) {
        this.indexedDb.getAllCachedAnnotatedImagesForService().then(annotatedImages => {
          this.bulkAnnotatedImagesMap = annotatedImages;
          this.changeDetectorRef.detectChanges();
        });
      }

      // DIRECT DEXIE QUERY: Get ALL LocalImages for this service filtered by 'lbw' entity type
      const allLocalImages = await this.localImageService.getImagesForService(this.serviceId, 'lbw');

      console.log(`[LBW DEXIE-FIRST] Found ${allLocalImages.length} LocalImages for service`);

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

      let photosAddedCount = 0;

      for (const field of fields) {
        // 4-TIER FALLBACK for photo lookup
        const realId = field.visualId;
        const tempId = field.tempVisualId;
        const visualId = realId || tempId;
        if (!visualId) continue;

        const key = `${field.category}_${field.templateId}`;

        // Store visual record ID for photo operations
        this.visualRecordIds[key] = visualId;

        // TIER 1: Lookup by real ID first
        let localImages = realId ? (localImagesMap.get(realId) || []) : [];

        // TIER 2: Try tempId lookup
        if (localImages.length === 0 && tempId && tempId !== realId) {
          localImages = localImagesMap.get(tempId) || [];
        }

        // TIER 3: Check IndexedDB for temp-to-real mapping
        if (localImages.length === 0 && tempId) {
          const mappedRealId = await this.indexedDb.getRealId(tempId);
          if (mappedRealId) {
            localImages = localImagesMap.get(mappedRealId) || [];
            if (localImages.length > 0) {
              console.log(`[LBW DEXIE-FIRST] TIER 3: Found ${localImages.length} photos via temp->real mapping for ${tempId}`);
            }
          }
        }

        // TIER 4: Reverse lookup - have realId but no tempId
        if (localImages.length === 0 && realId && !tempId) {
          const reverseLookupTempId = await this.indexedDb.getTempId(realId);
          if (reverseLookupTempId) {
            localImages = localImagesMap.get(reverseLookupTempId) || [];
            if (localImages.length > 0) {
              console.log(`[LBW DEXIE-FIRST] TIER 4: Found ${localImages.length} photos via reverse lookup for ${realId}`);
            }
          }
        }

        if (localImages.length === 0) {
          continue;
        }

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
                let thumbnailUrl = freshDisplayUrl;
                if (hasAnnotations) {
                  const cachedAnnotated = this.bulkAnnotatedImagesMap.get(imageId);
                  if (cachedAnnotated) {
                    thumbnailUrl = cachedAnnotated;
                  }
                }
                this.visualPhotos[key][existingPhotoIndex] = {
                  ...this.visualPhotos[key][existingPhotoIndex],
                  displayUrl: thumbnailUrl,
                  url: freshDisplayUrl,
                  thumbnailUrl: thumbnailUrl,
                  originalUrl: freshDisplayUrl,
                  localBlobId: localImage.localBlobId,
                  caption: localImage.caption || this.visualPhotos[key][existingPhotoIndex].caption || '',
                  Drawings: localImage.drawings || null,
                  hasAnnotations: hasAnnotations,
                  isLocalImage: true
                };
              }
            } catch (e) {
              console.warn('[LBW DEXIE-FIRST] Failed to refresh displayUrl:', e);
            }
            loadedPhotoIds.add(imageId);
            if (localImage.attachId) loadedPhotoIds.add(localImage.attachId);
            continue;
          }

          // Skip if already loaded
          if (loadedPhotoIds.has(imageId)) continue;
          if (localImage.attachId && loadedPhotoIds.has(localImage.attachId)) continue;

          // Get display URL from LocalImageService
          let displayUrl = 'assets/img/photo-placeholder.svg';
          try {
            displayUrl = await this.localImageService.getDisplayUrl(localImage);
          } catch (e) {
            console.warn('[LBW DEXIE-FIRST] Failed to get displayUrl:', e);
          }

          // Check for annotated image
          let thumbnailUrl = displayUrl;
          const hasAnnotations = !!localImage.drawings && localImage.drawings.length > 10;
          if (hasAnnotations) {
            const cachedAnnotated = this.bulkAnnotatedImagesMap.get(imageId);
            if (cachedAnnotated) {
              thumbnailUrl = cachedAnnotated;
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
            displayUrl: thumbnailUrl,
            url: displayUrl,
            thumbnailUrl: thumbnailUrl,
            originalUrl: displayUrl,
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

      console.log(`[LBW DEXIE-FIRST] Populated ${photosAddedCount} photos from Dexie`);
    } finally {
      this.isPopulatingPhotos = false;
    }
  }

  /**
   * Subscribe to VisualFields changes for reactive updates
   * When sync updates VisualField with real ID, this subscription fires
   */
  private subscribeToVisualFieldChanges(): void {
    // Unsubscribe from previous subscription
    if (this.visualFieldsSubscription) {
      this.visualFieldsSubscription.unsubscribe();
    }

    if (!this.serviceId) {
      console.log('[LBW VISUALFIELDS] No serviceId, skipping subscription');
      return;
    }

    console.log('[LBW VISUALFIELDS] Subscribing to VisualFields changes for service:', this.serviceId);

    // Subscribe to ALL VisualFields for this service
    this.visualFieldsSubscription = this.visualFieldRepo
      .getAllFieldsForService$(this.serviceId)
      .subscribe({
        next: async (fields) => {
          console.log(`[LBW VISUALFIELDS] Received ${fields.length} fields from liveQuery`);

          // Store fresh fields as lastConvertedFields
          this.lastConvertedFields = fields;

          // Build a map of visualId -> Dexie field for updating organizedData
          const fieldsByVisualId = new Map<string, any>();
          for (const field of fields) {
            const visualId = field.visualId || field.tempVisualId;
            if (visualId) {
              fieldsByVisualId.set(String(visualId), field);
            }
          }

          // Update visualRecordIds and organizedData items
          for (const field of fields) {
            const key = `${field.category}_${field.templateId}`;
            const visualId = field.visualId || field.tempVisualId;
            if (visualId) {
              this.visualRecordIds[key] = visualId;

              // Find matching item and update
              const allItems = [...this.organizedData.comments, ...this.organizedData.limitations, ...this.organizedData.deficiencies];
              for (const item of allItems) {
                // Match custom items by their id
                if ((item as any).id === `custom_${visualId}` && item.templateId !== field.templateId) {
                  console.log(`[LBW VISUALFIELDS] Updating custom item templateId: ${item.templateId} -> ${field.templateId}`);
                  item.templateId = field.templateId;
                }

                // Update item name from Dexie templateName
                if ((item as any).id === `custom_${visualId}` && field.templateName) {
                  if (item.name !== field.templateName) {
                    console.log(`[LBW VISUALFIELDS] Updating item name: "${item.name}" -> "${field.templateName}"`);
                    item.name = field.templateName;
                  }
                }
              }
            }
          }

          // Populate photos with fresh fields
          await this.populatePhotosFromDexie(fields);
          this.changeDetectorRef.detectChanges();
        },
        error: (err) => {
          console.error('[LBW VISUALFIELDS] Error in VisualFields subscription:', err);
        }
      });
  }

  /**
   * HUD PATTERN FIX: Refresh lastConvertedFields with fresh visualId/tempVisualId from Dexie
   *
   * This is CRITICAL for the LocalImages liveQuery to work correctly.
   *
   * ROOT CAUSE: When sync updates VisualFields with real IDs (via setField()),
   * the LocalImages liveQuery fires but lastConvertedFields still has stale IDs.
   * populatePhotosFromDexie() then looks for photos using outdated IDs and fails.
   *
   * FIX: Before populating photos, fetch fresh VisualFields from Dexie and update
   * lastConvertedFields with the current visualId/tempVisualId values.
   */
  private async refreshLastConvertedFieldsFromDexie(): Promise<void> {
    if (!this.serviceId || this.lastConvertedFields.length === 0) {
      return;
    }

    try {
      // Get unique categories from lastConvertedFields
      const categories = new Set<string>();
      for (const field of this.lastConvertedFields) {
        if (field.category) {
          categories.add(field.category);
        }
      }

      // Fetch fresh VisualFields from Dexie for all categories
      const freshFieldsMap = new Map<string, VisualField>();
      for (const category of categories) {
        const fields = await this.visualFieldRepo.getFieldsForCategory(this.serviceId, category);
        for (const field of fields) {
          // Key by serviceId:category:templateId to match lastConvertedFields
          const key = `${field.serviceId}:${field.category}:${field.templateId}`;
          freshFieldsMap.set(key, field);
        }
      }

      if (freshFieldsMap.size === 0) {
        return;
      }

      // Update lastConvertedFields with fresh visualId/tempVisualId from Dexie
      let updatedCount = 0;
      for (const field of this.lastConvertedFields) {
        const freshField = freshFieldsMap.get(field.key);
        if (freshField) {
          // Only update if there's a change
          const visualIdChanged = field.visualId !== freshField.visualId;
          const tempVisualIdChanged = field.tempVisualId !== freshField.tempVisualId;

          if (visualIdChanged || tempVisualIdChanged) {
            field.visualId = freshField.visualId;
            field.tempVisualId = freshField.tempVisualId;
            updatedCount++;

            // Also update visualRecordIds for consistency
            const recordKey = `${field.category}_${field.templateId}`;
            const newVisualId = freshField.visualId || freshField.tempVisualId;
            if (newVisualId) {
              this.visualRecordIds[recordKey] = newVisualId;
            }
          }
        }
      }

      if (updatedCount > 0) {
        console.log(`[LBW DEXIE-FIRST] Refreshed ${updatedCount} fields with fresh IDs from Dexie`);
      }
    } catch (err) {
      console.error('[LBW DEXIE-FIRST] Failed to refresh lastConvertedFields:', err);
    }
  }

  /**
   * DEXIE-FIRST: Subscribe to LocalImages changes for reactive photo updates
   * When photos are captured or synced, this subscription fires to update the UI
   */
  private subscribeToLocalImagesChanges(): void {
    // Unsubscribe from previous subscription
    if (this.localImagesSubscription) {
      this.localImagesSubscription.unsubscribe();
    }

    if (!this.serviceId) {
      console.log('[LBW LOCALIMAGES] No serviceId, skipping subscription');
      return;
    }

    console.log('[LBW LOCALIMAGES] Subscribing to LocalImages changes for service:', this.serviceId, 'entityType: lbw');

    // Subscribe to LocalImages for this service with 'lbw' entity type
    this.localImagesSubscription = db.liveLocalImages$(this.serviceId, 'lbw').subscribe({
      next: async (images) => {
        console.log(`[LBW LOCALIMAGES] Received ${images.length} images from liveQuery`);

        // RACE CONDITION FIX: Skip if camera capture is in progress
        // The camera method will add the photo to visualPhotos directly
        if (this.isCameraCaptureInProgress) {
          console.log('[LBW LOCALIMAGES] Skipping - camera capture in progress');
          return;
        }

        // Skip if local operation cooldown is active
        if (this.localOperationCooldown) {
          console.log('[LBW LOCALIMAGES] Skipping - local operation cooldown active');
          return;
        }

        // Only process if we have lastConvertedFields
        if (this.lastConvertedFields.length === 0) {
          console.log('[LBW LOCALIMAGES] Skipping - no lastConvertedFields');
          return;
        }

        // HUD PATTERN FIX: Refresh lastConvertedFields from Dexie before populating
        // This ensures we have fresh visualId/tempVisualId values after sync
        await this.refreshLastConvertedFieldsFromDexie();

        // Populate photos from the fresh LocalImages
        await this.populatePhotosFromDexie(this.lastConvertedFields);
        this.changeDetectorRef.detectChanges();
      },
      error: (err) => {
        console.error('[LBW LOCALIMAGES] Error in LocalImages subscription:', err);
      }
    });
  }

  private findItemByName(name: string): VisualItem | undefined {
    const allItems = [
      ...this.organizedData.comments,
      ...this.organizedData.limitations,
      ...this.organizedData.deficiencies
    ];
    return allItems.find(item => item.name === name);
  }

  private findItemByTemplateId(templateId: number): VisualItem | undefined {
    const allItems = [
      ...this.organizedData.comments,
      ...this.organizedData.limitations,
      ...this.organizedData.deficiencies
    ];
    return allItems.find(item => item.templateId === templateId);
  }

  private findItemById(id: string | number): VisualItem | undefined {
    const allItems = [
      ...this.organizedData.comments,
      ...this.organizedData.limitations,
      ...this.organizedData.deficiencies
    ];
    return allItems.find(item => item.id === id || item.id === Number(id));
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

  /**
   * WEBAPP MODE: Load photos from API for all selected visuals
   * This method loads photos synchronously with signed S3 URLs
   * Mirrors EFE's loadPhotosFromAPI approach for WEBAPP mode
   */
  private async loadPhotosFromAPI(): Promise<void> {
    console.log('[LBW] WEBAPP MODE: Loading photos from API...');

    // WEBAPP FIX: Load cached annotated images FIRST for thumbnail display
    if (this.bulkAnnotatedImagesMap.size === 0) {
      try {
        this.bulkAnnotatedImagesMap = await this.indexedDb.getAllCachedAnnotatedImagesForService();
        console.log(`[LBW] WEBAPP: Loaded ${this.bulkAnnotatedImagesMap.size} cached annotated images`);
      } catch (e) {
        console.warn('[LBW] WEBAPP: Failed to load annotated images cache:', e);
      }
    }

    // Get all visual IDs that have been selected
    for (const [key, lbwId] of Object.entries(this.visualRecordIds)) {
      if (!lbwId) continue;

      try {
        const attachments = await this.hudData.getVisualAttachments(lbwId);
        console.log(`[LBW] WEBAPP: Loaded ${attachments?.length || 0} photos for LBW ${lbwId}`);

        // Convert attachments to photo format
        const photos: any[] = [];
        for (const att of attachments || []) {
          // Debug: Log attachment fields to identify correct photo field
          if (attachments.length > 0 && photos.length === 0) {
            console.log('[LBW] WEBAPP: Attachment fields:', Object.keys(att));
          }

          // Try multiple possible field names for the S3 key
          const rawPhotoValue = att.Attachment || att.attachment || att.Photo || att.photo || att.S3Key || att.s3Key || '';
          console.log('[LBW] WEBAPP: Raw photo value for attach', att.AttachID || att.PK_ID, ':', rawPhotoValue?.substring(0, 100));

          let displayUrl = rawPhotoValue || 'assets/img/photo-placeholder.svg';

          // WEBAPP: Get S3 signed URL if needed
          if (displayUrl && displayUrl !== 'assets/img/photo-placeholder.svg') {
            const isS3Key = displayUrl.startsWith('uploads/') || (this.caspioService.isS3Key && this.caspioService.isS3Key(displayUrl));

            if (isS3Key) {
              // S3 key - get signed URL
              try {
                console.log('[LBW] WEBAPP: Getting signed URL for S3 key:', displayUrl);
                displayUrl = await this.caspioService.getS3FileUrl(displayUrl);
                console.log('[LBW] WEBAPP: Got signed URL:', displayUrl?.substring(0, 80));
              } catch (e) {
                console.warn('[LBW] WEBAPP: Could not get S3 URL for key:', e);
                displayUrl = 'assets/img/photo-placeholder.svg';
              }
            } else {
              console.log('[LBW] WEBAPP: URL not recognized as S3 key, using as-is:', displayUrl?.substring(0, 50));
            }
          }

          const attachId = String(att.AttachID || att.attachId || att.PK_ID);
          const hasServerAnnotations = !!(att.Drawings && att.Drawings.length > 10);
          let thumbnailUrl = displayUrl;
          let hasAnnotations = hasServerAnnotations;

          // WEBAPP FIX: ALWAYS check for cached annotated image first
          // CRITICAL: Annotations added locally may not be synced yet but are cached
          const cachedAnnotated = this.bulkAnnotatedImagesMap.get(attachId);
          if (cachedAnnotated) {
            thumbnailUrl = cachedAnnotated;
            hasAnnotations = true;
            console.log(`[LBW] WEBAPP: Using cached annotated image for ${attachId}`);
          } else if (hasServerAnnotations && displayUrl && displayUrl !== 'assets/img/photo-placeholder.svg') {
            // No cached image but server has Drawings - render annotations on the fly
            try {
              console.log(`[LBW] WEBAPP: Rendering annotations for ${attachId}...`);
              const renderedUrl = await renderAnnotationsOnPhoto(displayUrl, att.Drawings);
              if (renderedUrl && renderedUrl !== displayUrl) {
                thumbnailUrl = renderedUrl;
                // Cache in memory for immediate use
                this.bulkAnnotatedImagesMap.set(attachId, renderedUrl);
                // Also persist to IndexedDB (convert data URL to blob first)
                try {
                  const response = await fetch(renderedUrl);
                  const blob = await response.blob();
                  await this.indexedDb.cacheAnnotatedImage(attachId, blob);
                } catch (cacheErr) {
                  console.warn('[LBW] WEBAPP: Failed to cache annotated image:', cacheErr);
                }
                console.log(`[LBW] WEBAPP: Rendered and cached annotations for ${attachId}`);
              }
            } catch (renderErr) {
              console.warn(`[LBW] WEBAPP: Failed to render annotations for ${attachId}:`, renderErr);
            }
          }

          photos.push({
            id: attachId,
            attachId: attachId,
            AttachID: attachId,
            displayUrl: thumbnailUrl,   // Use annotated if available
            url: displayUrl,            // Original S3 URL
            thumbnailUrl: thumbnailUrl, // Use annotated if available
            originalUrl: displayUrl,    // Original for re-annotation
            caption: att.Annotation || att.caption || '',
            annotation: att.Annotation || '',
            Annotation: att.Annotation || '',
            uploading: false,
            loading: true,              // Image is loading until (load) event fires
            isLocal: false,
            isPending: false,
            hasAnnotations,
            Drawings: att.Drawings || ''
          });
        }

        this.visualPhotos[key] = photos;
        this.photoCountsByKey[key] = photos.length;
        console.log(`[LBW] WEBAPP: Stored ${photos.length} photos for key ${key}`);
      } catch (error) {
        console.error(`[LBW] WEBAPP: Error loading photos for LBW ${lbwId}:`, error);
      }
    }

    this.changeDetectorRef.detectChanges();
    console.log('[LBW] WEBAPP MODE: Photo loading complete');
  }

  private async loadPhotosForVisual(LBWID: string, key: string) {
    try {
      this.loadingPhotosByKey[key] = true;

      // CRITICAL FIX: Check sync status to preserve photos during sync
      const syncStatus = this.backgroundSync.syncStatus$.getValue();
      const syncInProgress = syncStatus.isSyncing;

      // Get attachments from database
      const attachments = await this.hudData.getVisualAttachments(LBWID);

      console.log('[LOAD PHOTOS] Found', attachments.length, 'photos for LBW', LBWID, 'key:', key, 'sync:', syncInProgress);

      // Set photo count immediately so skeleton loaders can be displayed
      this.photoCountsByKey[key] = attachments.length;

      if (attachments.length > 0) {
        // CRITICAL: Don't reset photo array if it already has photos from uploads
        if (!this.visualPhotos[key]) {
          this.visualPhotos[key] = [];
          console.log('[LOAD PHOTOS] Initialized empty photo array for', key);
        } else {
          console.log('[LOAD PHOTOS] Photo array already exists with', this.visualPhotos[key].length, 'photos');

          // CRITICAL FIX: During sync, skip reload to prevent photos from disappearing
          if (syncInProgress) {
            console.log('[LOAD PHOTOS] SYNC IN PROGRESS - preserving existing photos, skipping reload for', key);
            this.loadingPhotosByKey[key] = false;
            this.changeDetectorRef.detectChanges();
            return;
          }

          // Check if we already have all the photos loaded
          const loadedPhotoIds = new Set(this.visualPhotos[key].map(p => p.AttachID));
          const allPhotosLoaded = attachments.every((a: any) => loadedPhotoIds.has(a.AttachID));
          if (allPhotosLoaded) {
            console.log('[LOAD PHOTOS] All photos already loaded - skipping reload');
            this.loadingPhotosByKey[key] = false;
            this.changeDetectorRef.detectChanges();
            return;
          }
        }

        // Trigger change detection so skeletons appear
        this.changeDetectorRef.detectChanges();

        // Load photos sequentially
        for (let i = 0; i < attachments.length; i++) {
          const attach = attachments[i];

          // Check if photo already loaded
          const existingPhotoIndex = this.visualPhotos[key].findIndex(p => p.AttachID === attach.AttachID);
          if (existingPhotoIndex !== -1) {
            console.log('[LOAD PHOTOS] Photo', attach.AttachID, 'already loaded - skipping');
            continue;
          }

          await this.loadSinglePhoto(attach, key);
        }

        console.log('[LOAD PHOTOS] Completed loading all photos for', key);
      } else {
        // CRITICAL FIX: During sync, don't clear photos even if attachments is empty
        if (syncInProgress && this.visualPhotos[key]?.length > 0) {
          console.log('[LOAD PHOTOS] SYNC IN PROGRESS - preserving existing photos despite empty attachments for', key);
          this.loadingPhotosByKey[key] = false;
          this.changeDetectorRef.detectChanges();
          return;
        }
        this.visualPhotos[key] = [];
      }

      this.loadingPhotosByKey[key] = false;
      this.changeDetectorRef.detectChanges();

    } catch (error) {
      console.error('[LOAD PHOTOS] Error loading photos for key:', key, error);
      this.loadingPhotosByKey[key] = false;
      this.photoCountsByKey[key] = 0;
      this.visualPhotos[key] = [];
    }
  }

  /**
   * Load a single photo with two-field approach for robust UI transitions
   * Priority: local blob > cached > remote (with preload)
   * Never changes displayUrl until new source is verified loadable
   */
  private async loadSinglePhoto(attach: any, key: string): Promise<void> {
    const attachId = String(attach.AttachID || attach.PK_ID || attach.id);
    // Try multiple possible field names for S3 key (Caspio may use different casing)
    const s3Key = attach.Attachment || attach.attachment || attach.S3Key || attach.s3Key || attach.Photo || attach.photo || '';
    const filePath = s3Key;
    const hasImageSource = !!s3Key;

    console.log('[LOAD PHOTO] Loading:', attachId, 'key:', key, 's3Key:', s3Key, 'hasImageSource:', hasImageSource);
    console.log('[LOAD PHOTO] Attachment record fields:', Object.keys(attach).join(', '));
    
    // TWO-FIELD APPROACH: Determine display state and URL
    let displayUrl = 'assets/img/photo-placeholder.svg';
    let displayState: 'local' | 'uploading' | 'cached' | 'remote_loading' | 'remote' = 'remote';
    let localBlobKey: string | undefined;
    let imageUrl = '';
    
    // STEP 1: Check for local pending blob first (highest priority)
    try {
      const localBlobUrl = await this.indexedDb.getPhotoBlobUrl(attachId);
      if (localBlobUrl) {
        console.log('[LOAD PHOTO] ✅ Using local blob for:', attachId);
        displayUrl = localBlobUrl;
        imageUrl = localBlobUrl;
        displayState = 'local';
        localBlobKey = attachId;
      }
    } catch (err) { /* ignore */ }
    
    // STEP 2: Check cached photo (if no local blob)
    if (!localBlobKey) {
      try {
        const cachedImage = await this.indexedDb.getCachedPhoto(attachId);
        if (cachedImage) {
          console.log('[LOAD PHOTO] ✅ Using cached image for:', attachId);
          displayUrl = cachedImage;
          imageUrl = cachedImage;
          displayState = 'cached';
        }
      } catch (err) { /* ignore */ }
    }
    
    // STEP 3: If no local/cached, determine if we need remote fetch
    if (displayState !== 'local' && displayState !== 'cached') {
      if (!hasImageSource) {
        console.warn('[LOAD PHOTO] ⚠️ No photo path or S3 key in attachment');
      } else if (this.offlineService && !this.offlineService.isOnline()) {
        displayState = 'remote';
      } else {
        displayState = 'remote_loading';
      }
    }

    const hasServerDrawings = !!(attach.Drawings && attach.Drawings.length > 0 && attach.Drawings !== '{}');

    // WEBAPP FIX: ALWAYS check for cached annotated image for thumbnail display
    // CRITICAL: Annotations added locally may not be synced yet but are cached
    let thumbnailUrl = imageUrl || displayUrl;
    let hasAnnotations = hasServerDrawings;
    if (environment.isWeb) {
      const cachedAnnotated = this.bulkAnnotatedImagesMap.get(attachId);
      if (cachedAnnotated) {
        thumbnailUrl = cachedAnnotated;
        hasAnnotations = true;
        console.log(`[LOAD PHOTO] Using cached annotated image for ${attachId}`);
      }
    }

    const photoData: any = {
      AttachID: attachId,
      attachId: attachId,
      id: attachId,
      name: attach.Photo || 'photo.jpg',
      filePath: filePath,
      Photo: filePath,
      // Two-field approach
      localBlobKey: localBlobKey,
      remoteS3Key: s3Key,
      displayState: displayState,
      // Display URLs
      url: imageUrl || displayUrl,
      originalUrl: imageUrl || displayUrl,
      thumbnailUrl: thumbnailUrl,       // Use annotated if available
      displayUrl: thumbnailUrl,         // Use annotated for display
      // Metadata
      caption: attach.Annotation || '',
      annotation: attach.Annotation || '',
      Annotation: attach.Annotation || '',
      hasAnnotations: hasAnnotations,
      annotations: null,
      Drawings: attach.Drawings || null,
      rawDrawingsString: attach.Drawings || null,
      // Status
      uploading: false,
      queued: false,
      isObjectUrl: !!localBlobKey,
      loading: displayState === 'remote_loading'
    };

    if (!this.visualPhotos[key]) {
      this.visualPhotos[key] = [];
    }

    const existingIndex = this.visualPhotos[key].findIndex(p => 
      String(p.AttachID) === attachId || String(p.attachId) === attachId
    );
    
    if (existingIndex !== -1) {
      // Preserve existing displayUrl if valid and we're loading
      const existingPhoto = this.visualPhotos[key][existingIndex];
      if (displayState === 'remote_loading' && 
          existingPhoto.displayUrl && 
          existingPhoto.displayUrl !== 'assets/img/photo-placeholder.svg') {
        photoData.displayUrl = existingPhoto.displayUrl;
        photoData.displayState = existingPhoto.displayState || 'cached';
      }
      this.visualPhotos[key][existingIndex] = photoData;
    } else {
      this.visualPhotos[key].push(photoData);
    }

    this.changeDetectorRef.detectChanges();
    
    // STEP 4: If remote_loading, preload and transition in background
    if (displayState === 'remote_loading' && hasImageSource) {
      console.log('[LOAD PHOTO] Starting remote preload for:', attachId, 'with s3Key:', s3Key);
      this.preloadAndTransition(attachId, s3Key, key, true).catch(err => {
        console.warn('[LOAD PHOTO] Preload failed:', attachId, err);
      });
    }
    
    console.log('[LOAD PHOTO] ✅ Completed:', attachId, 'state:', displayState);
  }

  /**
   * Preload image from remote and transition UI only after success
   */
  private async preloadAndTransition(
    attachId: string,
    imageKey: string,
    key: string,
    isS3: boolean
  ): Promise<void> {
    try {
      let imageDataUrl: string;

      // All LBW photos should be S3 now - always use getS3FileUrl
      // This matches HUD's approach which treats all photos as S3
      if (imageKey) {
        const s3Url = await this.caspioService.getS3FileUrl(imageKey);
        const preloaded = await this.preloadImage(s3Url);
        if (!preloaded) throw new Error('Preload failed');
        imageDataUrl = await this.fetchAsDataUrl(s3Url);
      } else {
        throw new Error('No image key provided');
      }

      await this.indexedDb.cachePhoto(attachId, this.serviceId, imageDataUrl, imageKey);
      
      const photoIndex = this.visualPhotos[key]?.findIndex(p => 
        String(p.attachId) === attachId || String(p.AttachID) === attachId
      );
      
      if (photoIndex !== -1) {
        this.visualPhotos[key][photoIndex] = {
          ...this.visualPhotos[key][photoIndex],
          url: imageDataUrl,
          originalUrl: imageDataUrl,
          thumbnailUrl: imageDataUrl,
          displayUrl: imageDataUrl,
          displayState: 'cached',
          loading: false
        };
        this.changeDetectorRef.detectChanges();
        console.log('[PRELOAD] ✅ Transitioned to cached:', attachId);
      }
    } catch (err) {
      console.warn('[PRELOAD] Failed:', attachId, err);
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

  private preloadImage(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
      setTimeout(() => resolve(false), 30000);
    });
  }

  private async fetchAsDataUrl(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Restore pending visuals and photos from IndexedDB
   * Called on page load to show items that were created offline but not yet synced
   */
  private async restorePendingPhotosFromIndexedDB(): Promise<void> {
    try {
      console.log('[RESTORE PENDING] Checking for pending data in IndexedDB...');

      // STEP 1: Restore pending VISUAL records first
      const pendingRequests = await this.indexedDb.getPendingRequests();
      const pendingVisuals = pendingRequests.filter(r =>
        r.type === 'CREATE' &&
        r.endpoint?.includes('LPS_Services_LBW_Visuals') &&
        r.status !== 'synced' &&
        r.data?.ServiceID === parseInt(this.serviceId, 10) &&
        r.data?.Category === this.categoryName
      );

      console.log('[RESTORE PENDING] Found', pendingVisuals.length, 'pending visual records');

      for (const pendingVisual of pendingVisuals) {
        const visualData = pendingVisual.data;
        const tempId = pendingVisual.tempId;

        const matchingItem = this.findItemByNameAndCategory(
          visualData.Name,
          visualData.Category,
          visualData.Kind
        );

        if (matchingItem) {
          const key = `${visualData.Category}_${matchingItem.id}`;
          console.log('[RESTORE PENDING] Restoring visual:', key, 'tempId:', tempId);
          this.selectedItems[key] = true;
          this.visualRecordIds[key] = tempId || '';
          if (!this.visualPhotos[key]) {
            this.visualPhotos[key] = [];
          }
        }
      }

      // STEP 2: Restore pending photos
      const pendingPhotosMap = await this.indexedDb.getAllPendingPhotosGroupedByVisual();

      if (pendingPhotosMap.size === 0) {
        console.log('[RESTORE PENDING] No pending photos found');
        this.changeDetectorRef.detectChanges();
        return;
      }

      console.log('[RESTORE PENDING] Found pending photos for', pendingPhotosMap.size, 'visuals');

      for (const [visualId, photos] of pendingPhotosMap) {
        let matchingKey: string | null = null;

        for (const key of Object.keys(this.visualRecordIds)) {
          if (String(this.visualRecordIds[key]) === visualId) {
            matchingKey = key;
            break;
          }
        }

        if (!matchingKey) {
          const realId = await this.indexedDb.getRealId(visualId);
          if (realId) {
            for (const key of Object.keys(this.visualRecordIds)) {
              if (String(this.visualRecordIds[key]) === realId) {
                matchingKey = key;
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

        if (!this.visualPhotos[matchingKey]) {
          this.visualPhotos[matchingKey] = [];
        }

        for (const pendingPhoto of photos) {
          const existingIndex = this.visualPhotos[matchingKey].findIndex(p =>
            p.AttachID === pendingPhoto.AttachID ||
            p._pendingFileId === pendingPhoto._pendingFileId
          );

          if (existingIndex === -1) {
            this.visualPhotos[matchingKey].push(pendingPhoto);
          }
        }

        this.photoCountsByKey[matchingKey] = this.visualPhotos[matchingKey].length;

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

  // UI Helper Methods
  goBack() {
    this.router.navigate(['..'], { relativeTo: this.route });
  }

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
   * Sort organizedData sections by answerType for uniform display
   * Multi-select (answerType 2) first, then yes/no (answerType 1), then text (answerType 0)
   */
  private sortOrganizedDataByAnswerType(): void {
    const sortByAnswerType = (a: VisualItem, b: VisualItem) => {
      // Multi-select (2) comes first, then yes/no (1), then text (0)
      const orderA = a.answerType === 2 ? 0 : (a.answerType === 1 ? 1 : 2);
      const orderB = b.answerType === 2 ? 0 : (b.answerType === 1 ? 1 : 2);
      return orderA - orderB;
    };

    this.organizedData.comments.sort(sortByAnswerType);
    this.organizedData.limitations.sort(sortByAnswerType);
    this.organizedData.deficiencies.sort(sortByAnswerType);
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

  onSearchChange(): void {
    // Auto-expand accordions that have matches
    if (!this.searchTerm || this.searchTerm.trim() === '') {
      // If search is cleared, collapse all accordions
      this.expandedAccordions = [];
      this.changeDetectorRef.detectChanges();
      return;
    }

    // Expand accordions with matching items
    const newExpanded: string[] = [];
    
    if (this.filterItems(this.organizedData.comments).length > 0) {
      newExpanded.push('information');
    }
    if (this.filterItems(this.organizedData.limitations).length > 0) {
      newExpanded.push('limitations');
    }
    if (this.filterItems(this.organizedData.deficiencies).length > 0) {
      newExpanded.push('deficiencies');
    }

    this.expandedAccordions = newExpanded;
    this.changeDetectorRef.detectChanges();
  }

  clearSearch() {
    this.searchTerm = '';
    this.expandedAccordions = [];
    this.changeDetectorRef.detectChanges();
  }

  onAccordionChange(event: any) {
    this.expandedAccordions = event.detail.value;
  }

  async toggleItemSelection(category: string, itemId: string | number) {
    // CRITICAL FIX: Find item to get actual category (not route param)
    const item = this.findItemById(itemId);
    // CRITICAL FIX: Use item.templateId for Dexie (not item.id which is PK_ID)
    // item.templateId = template.TemplateID || template.PK_ID
    // The Dexie lookup in loadDataFromCache uses item.templateId, so save must match
    const templateId = item?.templateId ?? (typeof itemId === 'string' ? parseInt(String(itemId), 10) : Number(itemId));
    const actualCategory = item?.category || category;

    // Use actualCategory for key to match how visualRecordIds and Dexie merge work
    // Use templateId (not itemId) to match Dexie lookup pattern
    const key = `${actualCategory}_${templateId}`;
    const newState = !this.selectedItems[key];
    this.selectedItems[key] = newState;

    // CRITICAL: Also update item.isSelected for UI sync
    if (item) {
      item.isSelected = newState;
    }

    console.log('[TOGGLE] Item:', key, 'Selected:', newState, 'actualCategory:', actualCategory);

    // Set cooldown to prevent cache invalidation from causing UI flash
    this.startLocalOperationCooldown();

    // DEXIE-FIRST: Write-through to visualFields for instant reactive update
    // MUST await to prevent race condition where liveQuery fires before write completes
    try {
      await this.visualFieldRepo.setField(this.serviceId, actualCategory, templateId, {
        isSelected: newState,
        category: actualCategory,  // Store actual category for proper lookup
        templateName: item?.name || '',
        templateText: item?.text || item?.originalText || '',
        kind: (item?.type as 'Comment' | 'Limitation' | 'Deficiency') || 'Comment'
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
          await this.hudData.updateVisual(visualId, { Notes: '' }, this.serviceId);
          console.log('[TOGGLE] Unhid visual:', visualId);

          // CRITICAL: Load photos for this visual since they weren't loaded when hidden
          if (!this.visualPhotos[key] || this.visualPhotos[key].length === 0) {
            console.log('[TOGGLE] Loading photos for unhidden visual:', visualId);
            this.loadingPhotosByKey[key] = true;
            this.photoCountsByKey[key] = 0;
            this.changeDetectorRef.detectChanges();

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
        }
        this.savingItems[key] = false;
      } else if (!visualId) {
        // No visual record exists - create new one
        this.savingItems[key] = true;
        await this.createVisualRecord(actualCategory, itemId);
        this.savingItems[key] = false;
      }
    } else {
      // Item was unchecked - hide visual instead of deleting (keeps photos intact)
      const visualId = this.visualRecordIds[key];
      if (visualId && !String(visualId).startsWith('temp_')) {
        this.savingItems[key] = true;
        try {
          // OFFLINE-FIRST: This now queues the update and returns immediately
          await this.hudData.updateVisual(visualId, { Notes: 'HIDDEN' }, this.serviceId);
          // Keep visualRecordIds and visualPhotos intact for when user reselects
          console.log('[TOGGLE] Hid visual (queued for sync):', visualId);
        } catch (error) {
          console.error('[TOGGLE] Error hiding visual:', error);
          // Revert selection on error
          this.selectedItems[key] = true;
        }
        this.savingItems[key] = false;
      } else if (visualId && String(visualId).startsWith('temp_')) {
        // For temp IDs (created offline, not yet synced), just update local state
        console.log('[TOGGLE] Hidden temp visual (not yet synced):', visualId);
      }
    }
    this.changeDetectorRef.detectChanges();
  }

  isItemSelected(category: string, itemId: string | number): boolean {
    // CRITICAL FIX: Use item.templateId for key (not item.id) to match Dexie lookup pattern
    const item = this.findItemById(itemId);
    const templateId = item?.templateId ?? itemId;
    const key = `${category}_${templateId}`;

    // For answerType 0 (checkbox items), check selectedItems dictionary
    if (this.selectedItems[key]) {
      return true;
    }

    // Also check using the item's actual category (in case it differs from route category)
    if (item && item.category && item.category !== category) {
      const itemCategoryKey = `${item.category}_${templateId}`;
      if (this.selectedItems[itemCategoryKey]) {
        return true;
      }
    }

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

  // Count how many items are selected/checked in a section
  getSelectedCount(items: VisualItem[]): number {
    if (!items) return 0;
    return items.filter(item => this.isItemSelected(item.category || this.categoryName, item.id)).length;
  }

  isItemSaving(category: string, itemId: string | number): boolean {
    // CRITICAL FIX: Use item.templateId for key (not item.id) to match Dexie lookup pattern
    const item = this.findItemById(itemId);
    const templateId = item?.templateId ?? itemId;
    const key = `${category}_${templateId}`;
    return this.savingItems[key] || false;
  }

  getPhotosForVisual(category: string, itemId: string | number): any[] {
    // CRITICAL FIX: Use item.templateId for key (not itemId) to match Dexie lookup pattern
    const item = this.findItemById(itemId);
    const templateId = item?.templateId ?? itemId;
    const key = `${category}_${templateId}`;
    return this.visualPhotos[key] || [];
  }

  async showFullText(item: VisualItem) {
    console.log('[LBW] showFullText called for item:', item?.name, 'answerType:', item?.answerType);

    if (!item) {
      console.error('[LBW] showFullText called with null/undefined item');
      return;
    }

    try {
    // Build inputs based on AnswerType
    const inputs: any[] = [
      {
        name: 'title',
        type: 'text',
        placeholder: 'Title' + (item.required ? ' *' : ''),
        value: item.name || '',
        cssClass: 'editor-title-input',
        attributes: {
          readonly: true  // Name is used for matching - should not be edited
        }
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
      // Multi-select - show options as checkboxes
      const options = this.getDropdownOptions(item.templateId);
      if (options.length > 0) {
        // Add each option as a checkbox
        options.forEach(option => {
          inputs.push({
            name: option,
            type: 'checkbox',
            label: option,
            value: option,
            checked: this.isOptionSelectedV1(item, option)
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

            // Update the item text if changed (name is read-only)
            if (item.answerType === 0 || !item.answerType) {
              // For text items, update the text field
              if (data.description !== item.text) {
                const oldText = item.text;
                item.text = data.description;

                // Save to database if this visual is already created
                const key = `${item.category}_${item.id}`;
                const visualId = this.visualRecordIds[key];

                if (visualId && !String(visualId).startsWith('temp_')) {
                  try {
                    // TODO: Implement HUD visual update
                    // await this.hudData.updateVisual(visualId, { Text: data.description });
                    console.log('[HUD TEXT EDIT] Updated visual text:', visualId, data.description);
                    this.changeDetectorRef.detectChanges();
                  } catch (error) {
                    console.error('[HUD TEXT EDIT] Error updating visual:', error);
                    item.text = oldText;
                    return false;
                  }
                } else {
                  this.changeDetectorRef.detectChanges();
                }
              }
            } else if (item.answerType === 1) {
              // For Yes/No items, update the answer
              if (data.description !== item.answer) {
                item.answer = data.description;
                await this.onAnswerChange(item.category, item);
              }
            } else if (item.answerType === 2) {
              // For multi-select, update based on checkboxes
              const selectedOptions: string[] = [];
              const options = this.getDropdownOptions(item.templateId);
              options.forEach(option => {
                if (data[option]) {
                  selectedOptions.push(option);
                }
              });
              const newAnswer = selectedOptions.join(', ');
              if (newAnswer !== item.answer) {
                item.answer = newAnswer;
                await this.onAnswerChange(item.category, item);
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
    console.log('[LBW] Alert created, presenting...');
    await alert.present();
    console.log('[LBW] Alert presented successfully');
    } catch (error) {
      console.error('[LBW] Error in showFullText:', error);
      await this.showToast('Failed to open item details', 'danger');
    }
  }

  trackByItemId(index: number, item: VisualItem): any {
    return item.id;
  }

  trackByOption(index: number, option: string): any {
    return option;
  }

  getDropdownOptions(templateId: number): string[] {
    const templateIdStr = String(templateId);
    const options = this.visualDropdownOptions[templateIdStr] || [];
    
    // Debug logging to see what's available
    if (options.length === 0 && !this._loggedPhotoKeys.has(templateIdStr)) {
      console.log('[GET DROPDOWN] No options found for TemplateID:', templateIdStr);
      console.log('[GET DROPDOWN] Available TemplateIDs:', Object.keys(this.visualDropdownOptions));
      this._loggedPhotoKeys.add(templateIdStr);
    } else if (options.length > 0 && !this._loggedPhotoKeys.has(templateIdStr)) {
      console.log('[GET DROPDOWN] TemplateID', templateIdStr, 'has', options.length, 'options:', options);
      this._loggedPhotoKeys.add(templateIdStr);
    }
    
    return options;
  }

  // Data Management Methods
  // Alias for createVisualRecord to match structural systems naming
  private async saveVisualSelection(category: string, itemId: string | number) {
    return this.createVisualRecord(category, itemId);
  }

  private async createVisualRecord(category: string, itemId: string | number) {
    const item = this.findItemById(itemId);  // Find by ID, not templateId
    // CRITICAL FIX: Use item.templateId for key (not itemId) to match Dexie lookup pattern
    const templateId = item?.templateId ?? itemId;
    const key = `${category}_${templateId}`;

    if (!item) {
      console.error('[CREATE VISUAL] ❌ Item not found for itemId:', itemId);
      console.error('[CREATE VISUAL] Available items:', [
        ...this.organizedData.comments,
        ...this.organizedData.limitations,
        ...this.organizedData.deficiencies
      ].map(i => ({ id: i.id, templateId: i.templateId, name: i.name })));
      return;
    }

    console.log('[CREATE VISUAL] ✅ Found item:', { id: item.id, templateId: item.templateId, name: item.name });

    this.savingItems[key] = true;

    // Set cooldown to prevent cache invalidation from causing UI flash
    this.startLocalOperationCooldown();

    try {
      const serviceIdNum = parseInt(this.serviceId, 10);
      if (isNaN(serviceIdNum)) {
        console.error('[CREATE VISUAL] Invalid ServiceID:', this.serviceId);
        return;
      }

      const templateIdInt = typeof item.templateId === 'string' ? parseInt(item.templateId, 10) : Number(item.templateId);
      const lbwData = {
        ServiceID: serviceIdNum,
        Category: item.category || category,  // Use template's actual category
        Kind: item.type,
        Name: item.name,
        Text: item.text || item.originalText || '',
        Notes: '',
        Answers: item.answer || '',
        TemplateID: templateIdInt
      };

      console.log('[CREATE VISUAL] Creating LBW record with DEXIE-FIRST pattern:', lbwData);

      // DEXIE-FIRST: Use hudData.createVisual() which handles temp IDs and sync queue
      const result = await this.hudData.createVisual(lbwData);

      console.log('[CREATE VISUAL] Response from createVisual:', result);

      // Extract LBWID (will be temp_lbw_xxx in mobile mode)
      const lbwId = String(result.LBWID || result.PK_ID || result.id || '');

      if (!lbwId) {
        console.error('[CREATE VISUAL] ❌ No LBWID in response:', result);
        throw new Error('LBWID not found in response');
      }

      // Store the record ID (temp or real)
      this.visualRecordIds[key] = lbwId;
      this.selectedItems[key] = true;

      console.log('[CREATE VISUAL] ✅ Created with LBWID:', lbwId);
      console.log('[CREATE VISUAL] Stored in visualRecordIds[' + key + '] =', lbwId);

      // Initialize photo array
      this.visualPhotos[key] = [];
      this.photoCountsByKey[key] = 0;

      // DEXIE-FIRST: Persist tempVisualId AND templateName/Text to VisualField
      // This enables reactive updates and photo matching
      const templateId = typeof itemId === 'string' ? parseInt(String(itemId), 10) : Number(itemId);
      try {
        await this.visualFieldRepo.setField(this.serviceId, item.category || category, templateId, {
          tempVisualId: lbwId,  // Will be temp_lbw_xxx in mobile mode
          templateName: item.name || '',
          templateText: item.text || item.originalText || '',
          category: item.category || category,
          kind: (item.type as 'Comment' | 'Limitation' | 'Deficiency') || 'Comment',
          isSelected: true
        });
        console.log('[CREATE VISUAL] ✅ Persisted tempVisualId to Dexie:', lbwId, item.name);

        // MOBILE FIX: Update lastConvertedFields with the new lbwId
        const fieldIndex = this.lastConvertedFields.findIndex(f => f.templateId === templateId);
        if (fieldIndex !== -1) {
          this.lastConvertedFields[fieldIndex] = {
            ...this.lastConvertedFields[fieldIndex],
            tempVisualId: lbwId
          };
          console.log('[CREATE VISUAL] Updated lastConvertedFields with tempVisualId:', lbwId);
        }
      } catch (err) {
        console.error('[CREATE VISUAL] Failed to persist tempVisualId to Dexie:', err);
      }

      // Clear cache so fresh reload will include this new record
      this.hudData.clearServiceCaches(this.serviceId);

      // Force change detection to ensure UI updates
      this.changeDetectorRef.detectChanges();

    } catch (error) {
      console.error('[CREATE VISUAL] ❌ Error creating visual:', error);
      this.selectedItems[key] = false; // Revert selection on error
      await this.showToast('Failed to create visual record', 'danger');
    } finally {
      this.savingItems[key] = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  private async deleteVisualRecord(category: string, itemId: string | number) {
    // CRITICAL FIX: Use item.templateId for key (not itemId) to match Dexie lookup pattern
    const item = this.findItemById(itemId);
    const templateId = item?.templateId ?? itemId;
    const key = `${category}_${templateId}`;
    const visualId = this.visualRecordIds[key];
    
    if (!visualId) {
      console.log('[DELETE VISUAL] No visual ID found, nothing to delete');
      return;
    }

    this.savingItems[key] = true;

    try {
      console.log('[DELETE VISUAL] Deleting HUD record:', visualId);
      await firstValueFrom(this.caspioService.deleteServicesLBW(visualId));
      
      // Clean up local state
      delete this.visualRecordIds[key];
      delete this.visualPhotos[key];
      delete this.photoCountsByKey[key];
      
      console.log('[DELETE VISUAL] Deleted successfully');
    } catch (error) {
      console.error('[DELETE VISUAL] Error:', error);
    } finally {
      this.savingItems[key] = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  async onAnswerChange(category: string, item: VisualItem) {
    // CRITICAL FIX: Use item.category (not route param) to match visualRecordIds keys
    const actualCategory = item.category || category;
    const key = `${actualCategory}_${item.templateId}`;
    console.log('[ANSWER] Changed:', item.answer, 'for', key, 'actualCategory:', actualCategory);

    // DEXIE-FIRST: Write-through to visualFields for instant reactive update
    this.visualFieldRepo.setField(this.serviceId, actualCategory, item.templateId, {
      answer: item.answer || '',
      isSelected: !!(item.answer && item.answer !== '')
    }).catch(err => {
      console.error('[ANSWER] Failed to write to Dexie:', err);
    });

    this.savingItems[key] = true;

    try {
      // Create or update visual record
      let visualId = this.visualRecordIds[key];
      console.log('[ANSWER] Current visualId:', visualId);

      // If answer is empty/cleared, hide the visual instead of deleting
      if (!item.answer || item.answer === '') {
        if (visualId && !String(visualId).startsWith('temp_')) {
          // DEXIE-FIRST: Use hudData.updateVisual which handles queue
          await this.hudData.updateVisual(visualId, {
            Answers: '',
            Notes: 'HIDDEN'
          }, this.serviceId);
          console.log('[ANSWER] Hid visual (queued for sync):', visualId);
        }
        this.savingItems[key] = false;
        this.changeDetectorRef.detectChanges();
        return;
      }

      if (!visualId) {
        // Create new visual using DEXIE-FIRST pattern
        console.log('[ANSWER] Creating new visual for key:', key);
        const serviceIdNum = parseInt(this.serviceId, 10);
        const templateIdInt = typeof item.templateId === 'string' ? parseInt(item.templateId, 10) : Number(item.templateId);
        const visualData = {
          ServiceID: serviceIdNum,
          Category: item.category || category,  // Use template's actual category
          Kind: item.type,
          Name: item.name,
          Text: item.text || item.originalText || '',
          Notes: '',
          Answers: item.answer || '',
          TemplateID: templateIdInt
        };

        console.log('[ANSWER] Creating with DEXIE-FIRST:', visualData);

        // DEXIE-FIRST: Use hudData.createVisual which handles temp IDs and queue
        const result = await this.hudData.createVisual(visualData);

        visualId = String(result.LBWID || result.PK_ID || result.id || '');

        if (visualId) {
          this.visualRecordIds[key] = visualId;
          this.selectedItems[key] = true;

          // Initialize photo array
          this.visualPhotos[key] = [];
          this.photoCountsByKey[key] = 0;

          console.log('[ANSWER] ✅ Created visual with LBWID:', visualId);

          // DEXIE-FIRST: Persist tempVisualId to VisualField
          try {
            await this.visualFieldRepo.setField(this.serviceId, actualCategory, item.templateId, {
              tempVisualId: visualId,
              isSelected: true
            });
            console.log('[ANSWER] ✅ Persisted tempVisualId to Dexie:', visualId);
          } catch (err) {
            console.error('[ANSWER] Failed to persist tempVisualId:', err);
          }
        } else {
          console.error('[ANSWER] ❌ FAILED to extract LBWID from response!');
        }
      } else if (!String(visualId).startsWith('temp_')) {
        // Update existing visual and unhide if it was hidden
        console.log('[ANSWER] Updating existing visual:', visualId);
        // DEXIE-FIRST: Use hudData.updateVisual which handles queue
        await this.hudData.updateVisual(visualId, {
          Answers: item.answer || '',
          Notes: ''
        }, this.serviceId);
        console.log('[ANSWER] ✅ Updated visual (queued for sync):', visualId);

        // CRITICAL: Load photos if visual was previously hidden
        if (!this.visualPhotos[key] || this.visualPhotos[key].length === 0) {
          console.log('[ANSWER] Loading photos for unhidden visual:', visualId);
          this.loadPhotosForVisual(visualId, key).catch(err => {
            console.error('[ANSWER] Error loading photos:', err);
          });
        }
      }
    } catch (error) {
      console.error('[ANSWER] ❌ Error saving answer:', error);
      await this.showToast('Failed to save answer', 'danger');
    }

    this.savingItems[key] = false;
    this.changeDetectorRef.detectChanges();
  }

  async onOptionToggle(category: string, item: VisualItem, option: string, event: any) {
    // CRITICAL FIX: Use item.templateId and item.category for proper key matching
    const actualCategory = item.category || category;
    const key = `${actualCategory}_${item.templateId}`;
    const isChecked = event.detail.checked;

    console.log('[OPTION] Toggled:', option, 'Checked:', isChecked, 'for', key, 'templateId:', item.templateId);

    // Update the answer string
    let selectedOptions: string[] = [];
    if (item.answer) {
      selectedOptions = item.answer.split(',').map(o => o.trim()).filter(o => o);
    }

    if (isChecked) {
      if (option === 'None') {
        // "None" is mutually exclusive - clear all other selections
        selectedOptions = ['None'];
        item.otherValue = '';
      } else {
        // Remove "None" if selecting any other option
        selectedOptions = selectedOptions.filter(o => o !== 'None');
        if (!selectedOptions.includes(option)) {
          selectedOptions.push(option);
        }
      }
      // Auto-select the item when any option is checked
      this.selectedItems[key] = true;
    } else {
      selectedOptions = selectedOptions.filter(o => o !== option);
      // If no options remain selected and no "Other" value, deselect the item
      if (selectedOptions.length === 0 && (!item.otherValue || item.otherValue === '')) {
        this.selectedItems[key] = false;
      }
    }

    item.answer = selectedOptions.join(', ');

    // DEXIE-FIRST: Write-through to visualFields for instant reactive update
    this.visualFieldRepo.setField(this.serviceId, actualCategory, item.templateId, {
      answer: item.answer,
      isSelected: !!(item.answer && item.answer !== ''),
      otherValue: item.otherValue || ''
    }).catch(err => {
      console.error('[OPTION] Failed to write to Dexie:', err);
    });

    // Save to database
    this.savingItems[key] = true;

    try {
      let visualId = this.visualRecordIds[key];
      console.log('[OPTION] Current visualId for key', key, ':', visualId);

      // If all options are unchecked AND no "Other" value, hide the visual
      if ((!item.answer || item.answer === '') && (!item.otherValue || item.otherValue === '')) {
        if (visualId && !String(visualId).startsWith('temp_')) {
          // DEXIE-FIRST: Use hudData.updateVisual which handles queue
          await this.hudData.updateVisual(visualId, {
            Answers: '',
            Notes: 'HIDDEN'
          }, this.serviceId);
          console.log('[OPTION] Hid visual (queued for sync):', visualId);
        }
        this.savingItems[key] = false;
        this.changeDetectorRef.detectChanges();
        return;
      }

      if (!visualId) {
        // Create new visual using DEXIE-FIRST pattern
        console.log('[OPTION] Creating new visual for key:', key);
        const serviceIdNum = parseInt(this.serviceId, 10);
        const templateIdInt = typeof item.templateId === 'string' ? parseInt(item.templateId, 10) : Number(item.templateId);
        const visualData = {
          ServiceID: serviceIdNum,
          Category: item.category || category,  // Use template's actual category
          Kind: item.type,
          Name: item.name,
          Text: item.text || item.originalText || '',
          Notes: item.otherValue || '',
          Answers: item.answer,
          TemplateID: templateIdInt
        };

        console.log('[OPTION] Creating with DEXIE-FIRST:', visualData);

        // DEXIE-FIRST: Use hudData.createVisual which handles temp IDs and queue
        const result = await this.hudData.createVisual(visualData);

        visualId = String(result.LBWID || result.PK_ID || result.id || '');

        if (visualId) {
          this.visualRecordIds[key] = visualId;
          this.selectedItems[key] = true;

          // Initialize photo array
          this.visualPhotos[key] = [];
          this.photoCountsByKey[key] = 0;

          console.log('[OPTION] ✅ Created visual with LBWID:', visualId);

          // DEXIE-FIRST: Persist tempVisualId to VisualField
          try {
            await this.visualFieldRepo.setField(this.serviceId, actualCategory, item.templateId, {
              tempVisualId: visualId,
              isSelected: true
            });
            console.log('[OPTION] ✅ Persisted tempVisualId to Dexie:', visualId);
          } catch (err) {
            console.error('[OPTION] Failed to persist tempVisualId:', err);
          }
        } else {
          console.error('[OPTION] ❌ FAILED to extract LBWID from response!');
        }
      } else if (!String(visualId).startsWith('temp_')) {
        // Update existing visual using DEXIE-FIRST pattern
        console.log('[OPTION] Updating existing visual:', visualId);
        const notesValue = item.otherValue || '';
        // DEXIE-FIRST: Use hudData.updateVisual which handles queue
        await this.hudData.updateVisual(visualId, {
          Answers: item.answer,
          Notes: notesValue
        }, this.serviceId);
        console.log('[OPTION] ✅ Updated visual (queued for sync):', visualId);
      }
    } catch (error) {
      console.error('[OPTION] ❌ Error saving option:', error);
      await this.showToast('Failed to save option', 'danger');
    }

    this.savingItems[key] = false;
    this.changeDetectorRef.detectChanges();
  }

  isOptionSelectedV1(item: VisualItem, option: string): boolean {
    if (!item.answer) return false;
    const selectedOptions = item.answer.split(',').map(o => o.trim());
    return selectedOptions.includes(option);
  }

  async onMultiSelectOtherChange(category: string, item: VisualItem) {
    if (!item.otherValue || !item.otherValue.trim()) {
      return;
    }

    // Update the answer to include the "Other" custom value
    let selectedOptions = item.answer ? item.answer.split(',').map(s => s.trim()).filter(s => s) : [];

    // Replace "Other" with the custom value
    const otherIndex = selectedOptions.indexOf('Other');
    if (otherIndex > -1) {
      selectedOptions[otherIndex] = item.otherValue.trim();
    } else {
      // Add custom value if "Other" wasn't in the list
      selectedOptions.push(item.otherValue.trim());
    }

    item.answer = selectedOptions.join(', ');

    console.log('[OTHER CHANGE] Custom value:', item.otherValue, 'New answer:', item.answer);

    await this.onAnswerChange(category, item);
  }

  /**
   * Add a custom value from "Other" input to the options list
   * This allows users to add multiple custom options that persist
   */
  async addMultiSelectOther(category: string, item: VisualItem) {
    const customValue = item.otherValue?.trim();
    if (!customValue) {
      return;
    }

    // CRITICAL FIX: Use item.templateId (not item.id) and item.category to match visualRecordIds keys
    const actualCategory = item.category || category;
    const key = `${actualCategory}_${item.templateId}`;
    console.log('[OTHER] Adding custom option:', customValue, 'for', key, 'templateId:', item.templateId);

    // Get current options for this template
    let options = this.visualDropdownOptions[item.templateId];
    if (!options) {
      options = [];
      this.visualDropdownOptions[item.templateId] = options;
    }

    // Parse current selections
    let selectedOptions: string[] = [];
    if (item.answer) {
      selectedOptions = item.answer.split(',').map(o => o.trim()).filter(o => o);
    }

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

    // Update item answer
    item.answer = selectedOptions.join(', ');

    // Clear the input field for the next entry
    item.otherValue = '';

    // DEXIE-FIRST: Write-through to visualFields including updated dropdownOptions
    // This ensures custom options persist across page loads and liveQuery updates
    await this.visualFieldRepo.setField(this.serviceId, actualCategory, item.templateId, {
      answer: item.answer,
      otherValue: '',
      isSelected: true,
      dropdownOptions: [...options]  // Save the updated options array to Dexie
    });

    console.log('[OTHER] Saved dropdownOptions to Dexie:', options);

    // Save to database
    this.savingItems[key] = true;
    try {
      let visualId = this.visualRecordIds[key];

      if (!visualId) {
        // Create new visual
        const serviceIdNum = parseInt(this.serviceId, 10);
        const templateIdInt = typeof item.templateId === 'string' ? parseInt(item.templateId, 10) : Number(item.templateId);
        const visualData = {
          ServiceID: serviceIdNum,
          Category: item.category,  // FIX: Use template's actual category, not route param
          Kind: item.type,
          Name: item.name,
          Text: item.text || item.originalText || '',
          Notes: '',
          Answers: item.answer,
          TemplateID: templateIdInt
        };

        const result = await this.hudData.createVisual(visualData);
        const newVisualId = String(result.LBWID || result.VisualID || result.PK_ID || result.id);
        this.visualRecordIds[key] = newVisualId;

        await this.visualFieldRepo.setField(this.serviceId, actualCategory, item.templateId, {
          tempVisualId: newVisualId,
          templateName: item.name || '',
          templateText: item.text || item.originalText || '',
          category: actualCategory,
          kind: (item.type as 'Comment' | 'Limitation' | 'Deficiency') || 'Comment',
          isSelected: true
        });

        console.log('[OTHER] Created visual:', newVisualId);
      } else {
        // Update existing visual
        await this.hudData.updateVisual(visualId, {
          Answers: item.answer,
          Notes: ''
        }, this.serviceId);
        console.log('[OTHER] Updated visual:', visualId);
      }
    } catch (error) {
      console.error('[OTHER] Error saving custom option:', error);
    }

    this.savingItems[key] = false;
    this.changeDetectorRef.detectChanges();
  }

  // ============================================
  // CAMERA AND GALLERY CAPTURE METHODS (EXACT FROM STRUCTURAL SYSTEMS)
  // ============================================

  async addPhotoFromCamera(category: string, itemId: string | number) {
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
          // User saved the annotated photo
          const annotatedBlob = data.blob || data.annotatedBlob;
          const annotationsData = data.annotationData || data.annotationsData;
          const caption = data.caption || '';

          // CRITICAL: Upload the ORIGINAL photo, not the annotated one
          const originalFile = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });

          // Get or create visual ID
          // CRITICAL FIX: Use item.templateId for key (not itemId) to match Dexie lookup pattern
          const item = this.findItemById(itemId);
          const templateId = item?.templateId ?? itemId;
          const key = `${category}_${templateId}`;
          let visualId = this.visualRecordIds[key];

          if (!visualId) {
            await this.saveVisualSelection(category, itemId);
            visualId = this.visualRecordIds[key];
          }

          if (!visualId) {
            // DEBUG ALERT: visualId not obtained
            console.error('[CAMERA UPLOAD] Failed to create visual record');
            return;
          }

          // Compress annotations BEFORE creating photo entry
          let compressedDrawings = '';
          if (annotationsData) {
            try {
              const { compressAnnotationData } = await import('../../../utils/annotation-utils');
              if (typeof annotationsData === 'object') {
                compressedDrawings = compressAnnotationData(JSON.stringify(annotationsData));
              } else if (typeof annotationsData === 'string') {
                compressedDrawings = compressAnnotationData(annotationsData);
              }
            } catch (e) {
              console.error('[CAMERA UPLOAD] Failed to compress annotations:', e);
            }
          }

          // ============================================
          // WEBAPP MODE: Direct S3 Upload (No Local Storage)
          // MOBILE MODE: Local-first with background sync
          // ============================================

          // DEBUG ALERT: Show which path we're taking on mobile device
          // WEBAPP MODE: Upload directly to S3
          if (environment.isWeb) {
            alert('[LBW DEBUG 2] Going to WEBAPP path - Direct S3 upload');
            console.log('[CAMERA UPLOAD] WEBAPP MODE: Direct S3 upload starting...');

            // Initialize photo array if it doesn't exist
            if (!this.visualPhotos[key]) {
              this.visualPhotos[key] = [];
            }

            // Create temp photo entry with loading state (show roller)
            const tempId = `uploading_${Date.now()}`;
            // ANNOTATION FLATTENING FIX: Create SEPARATE URLs for original and annotated
            // originalBlobUrl points to the original camera image (for re-editing)
            // annotatedDisplayUrl points to the rendered annotations (for thumbnails)
            const originalBlobUrl = URL.createObjectURL(blob);
            const annotatedDisplayUrl = annotatedBlob ? URL.createObjectURL(annotatedBlob) : originalBlobUrl;
            const tempPhotoEntry = {
              imageId: tempId,
              AttachID: tempId,
              attachId: tempId,
              id: tempId,
              url: originalBlobUrl,              // Base image reference
              displayUrl: annotatedDisplayUrl,   // Annotated version for thumbnails
              originalUrl: originalBlobUrl,      // CRITICAL: Keep original for re-editing
              thumbnailUrl: annotatedDisplayUrl, // Show annotations in thumbnails
              name: 'camera-photo.jpg',
              caption: caption || '',
              annotation: caption || '',
              Annotation: caption || '',
              Drawings: compressedDrawings,
              hasAnnotations: !!annotationsData,
              status: 'uploading',
              isLocal: false,
              uploading: true,  // Show loading roller
              isPending: true,
              isSkeleton: false,
              progress: 0
            };

            // Add temp photo to UI immediately (with loading roller)
            this.visualPhotos[key].push(tempPhotoEntry);
            this.expandedPhotos[key] = true;
            this.changeDetectorRef.detectChanges();

            try {
              // Upload directly to S3
              const uploadResult = await this.localImageService.uploadImageDirectToS3(
                originalFile,
                'lbw',
                String(visualId),
                this.serviceId,
                caption,
                compressedDrawings
              );

              console.log('[CAMERA UPLOAD] WEBAPP: Upload complete, AttachID:', uploadResult.attachId);

              // Replace temp photo with real photo (remove loading roller)
              const tempIndex = this.visualPhotos[key].findIndex((p: any) => p.imageId === tempId);
              if (tempIndex >= 0) {
                this.visualPhotos[key][tempIndex] = {
                  ...tempPhotoEntry,
                  imageId: uploadResult.attachId,
                  AttachID: uploadResult.attachId,
                  attachId: uploadResult.attachId,
                  id: uploadResult.attachId,
                  url: uploadResult.s3Url,
                  displayUrl: annotatedBlob ? annotatedDisplayUrl : uploadResult.s3Url,
                  originalUrl: uploadResult.s3Url,
                  thumbnailUrl: annotatedBlob ? annotatedDisplayUrl : uploadResult.s3Url,
                  status: 'uploaded',
                  isLocal: false,
                  uploading: false,  // Remove loading roller
                  isPending: false,
                  _pendingFileId: undefined  // Clear pending flag - photo is now on backend
                };
              }

              this.changeDetectorRef.detectChanges();

              // CRITICAL: Clear attachment cache so next page load fetches fresh data from server
              this.hudData.clearAttachmentCache(String(visualId));

              // Clean up blob URL
              URL.revokeObjectURL(imageUrl);
              console.log('[CAMERA UPLOAD] WEBAPP: Photo added successfully');
              return;

            } catch (uploadError: any) {
              console.error('[CAMERA UPLOAD] WEBAPP: Upload failed:', uploadError?.message || uploadError);

              // Remove temp photo on error
              const tempIndex = this.visualPhotos[key].findIndex((p: any) => p.imageId === tempId);
              if (tempIndex >= 0) {
                this.visualPhotos[key].splice(tempIndex, 1);
              }
              this.changeDetectorRef.detectChanges();

              // Show error toast
              const toast = await this.toastController.create({
                message: 'Failed to upload photo. Please try again.',
                duration: 3000,
                color: 'danger'
              });
              await toast.present();
              return;
            }
          }

          // ============================================
          // MOBILE MODE: Local-first with background sync
          // ============================================

          // ============================================
          // MOBILE MODE: DEXIE-FIRST LOCAL IMAGE SYSTEM
          // Uses localImageService.captureImage() for proper LocalImage creation
          // Photos sync silently in background via BackgroundSyncService
          // ============================================

          console.log('[CAMERA UPLOAD] MOBILE MODE: Starting DEXIE-FIRST capture for visualId:', visualId);

          // RACE CONDITION FIX: Suppress liveQuery during camera capture
          // Without this, liveQuery fires after Dexie write but BEFORE we push to visualPhotos,
          // causing populatePhotosFromDexie to add a duplicate entry with the original (non-annotated) URL
          this.isCameraCaptureInProgress = true;

          // Compress the original file before storing (matches HUD pattern)
          let compressedFile = originalFile;
          try {
            const compressed = await this.imageCompression.compressImage(originalFile, {
              maxWidth: 2048,
              maxHeight: 2048,
              quality: 0.85
            });
            compressedFile = new File([compressed], originalFile.name, { type: 'image/jpeg' });
            console.log('[CAMERA UPLOAD] Compressed:', originalFile.size, '->', compressedFile.size);
          } catch (compressError) {
            console.warn('[CAMERA UPLOAD] Compression failed, using original:', compressError);
          }

          // Create LocalImage with stable UUID (this stores blob + creates outbox item)
          let localImage: LocalImage;
          try {
            localImage = await this.localImageService.captureImage(
              compressedFile,
              'lbw',  // Entity type for LBW photos
              String(visualId),
              this.serviceId,
              caption,
              compressedDrawings
            );
            console.log('[CAMERA UPLOAD] Created LocalImage with stable ID:', localImage.imageId, 'status:', localImage.status);
          } catch (captureError: any) {
            console.error('[CAMERA UPLOAD] Failed to create LocalImage:', captureError);
            this.isCameraCaptureInProgress = false;
            throw captureError;
          }

          // US-001 FIX: Cache annotated image FIRST (before getDisplayUrl calls)
          // This ensures liveQuery callbacks can find the cached annotated image
          if (annotationsData && annotatedBlob) {
            try {
              await this.indexedDb.cacheAnnotatedImage(localImage.imageId, annotatedBlob);
              console.log('[CAMERA UPLOAD] Cached annotated image for thumbnail:', localImage.imageId);
            } catch (cacheError) {
              console.warn('[CAMERA UPLOAD] Failed to cache annotated image:', cacheError);
            }
          }

          // Get display URL from LocalImageService (always uses local blob first)
          let displayUrl = await this.localImageService.getDisplayUrl(localImage);

          // US-001 FIX: If getDisplayUrl returns placeholder, create blob URL directly from compressed file
          // This handles timing issues where the Dexie transaction may not have fully committed
          if (!displayUrl || displayUrl === 'assets/img/photo-placeholder.svg') {
            console.warn('[CAMERA UPLOAD] US-001 FIX: getDisplayUrl returned placeholder, creating direct blob URL');
            displayUrl = URL.createObjectURL(compressedFile);
          }

          // For annotated images, create a separate display URL showing annotations
          let annotatedDisplayUrl = displayUrl;
          if (annotatedBlob) {
            annotatedDisplayUrl = URL.createObjectURL(annotatedBlob);
          }

          console.log('[CAMERA UPLOAD] MOBILE: displayUrl type:', displayUrl?.startsWith('blob:') ? 'BLOB' : 'OTHER');

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

          // Check for duplicates before adding photo
          const existingIndex = this.visualPhotos[key].findIndex((p: any) =>
            p.imageId === localImage.imageId ||
            p.AttachID === localImage.imageId ||
            p.id === localImage.imageId
          );

          if (existingIndex === -1) {
            // Add photo to UI immediately (no duplicate found)
            this.visualPhotos[key].push(photoEntry);
            console.log('[CAMERA UPLOAD] Photo added (silent sync):', localImage.imageId);
          } else {
            // Duplicate found - update existing entry instead of adding
            console.log('[CAMERA UPLOAD] Photo already exists, updating:', localImage.imageId);
            this.visualPhotos[key][existingIndex] = { ...this.visualPhotos[key][existingIndex], ...photoEntry };
          }

          // Expand photos section so user can see the newly added photo
          this.expandedPhotos[key] = true;
          this.changeDetectorRef.detectChanges();

          // RACE CONDITION FIX: Re-enable liveQuery now that photo is in visualPhotos
          this.isCameraCaptureInProgress = false;

          console.log('[CAMERA UPLOAD] MOBILE: Photo capture complete');
          console.log('  key:', key);
          console.log('  imageId:', localImage.imageId);
          console.log('  Total photos in key:', this.visualPhotos[key].length);
        }

        // Clean up blob URL
        URL.revokeObjectURL(imageUrl);
      }
    } catch (error) {
      // Check if user cancelled
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
    try {
      // Use pickImages to allow multiple photo selection
      const images = await Camera.pickImages({
        quality: 90,
        limit: 0 // 0 = no limit on number of photos
      });

      if (images.photos && images.photos.length > 0) {
        // CRITICAL FIX: Use item.templateId for key (not itemId) to match Dexie lookup pattern
        const item = this.findItemById(itemId);
        const templateId = item?.templateId ?? itemId;
        const key = `${category}_${templateId}`;

        // Initialize photo array if it doesn't exist
        if (!this.visualPhotos[key]) {
          this.visualPhotos[key] = [];
        }

        console.log('[GALLERY UPLOAD] Starting upload for', images.photos.length, 'photos');

        // CRITICAL: Create skeleton placeholders IMMEDIATELY for all photos
        const skeletonPhotos = images.photos.map((image, i) => {
          const tempId = `temp_skeleton_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 9)}`;
          return {
            AttachID: tempId,
            id: tempId,
            name: `photo_${i}.jpg`,
            url: 'assets/img/photo-placeholder.svg',
            thumbnailUrl: 'assets/img/photo-placeholder.svg',
            isObjectUrl: false,
            uploading: false,
            isSkeleton: true,
            hasAnnotations: false,
            caption: '',
            annotation: '',
            progress: 0
          };
        });

        // Add all skeleton placeholders to UI immediately
        this.visualPhotos[key].push(...skeletonPhotos);
        this.changeDetectorRef.detectChanges();
        console.log('[GALLERY UPLOAD] Added', skeletonPhotos.length, 'skeleton placeholders');

        // NOW create visual record if it doesn't exist
        let visualId = this.visualRecordIds[key];
        if (!visualId) {
          console.log('[GALLERY UPLOAD] Creating HUD record...');
          await this.saveVisualSelection(category, itemId);
          visualId = this.visualRecordIds[key];
        }

        if (!visualId) {
          console.error('[GALLERY UPLOAD] Failed to create HUD record');
          // Mark all skeleton photos as failed
          skeletonPhotos.forEach(skeleton => {
            const photoIndex = this.visualPhotos[key]?.findIndex(p => p.AttachID === skeleton.AttachID);
            if (photoIndex !== -1 && this.visualPhotos[key]) {
              this.visualPhotos[key][photoIndex].uploading = false;
              this.visualPhotos[key][photoIndex].uploadFailed = true;
              this.visualPhotos[key][photoIndex].isSkeleton = false;
            }
          });
          this.changeDetectorRef.detectChanges();
          return;
        }

        // MOBILE FIX: In MOBILE mode, visualId can be a temp ID like 'temp_lbw_xxx'
        // Only validate that visualId is not empty, not that it's a number
        // The parseInt check was causing gallery uploads to fail in MOBILE mode
        const isTempId = String(visualId).startsWith('temp_');
        const visualIdNum = parseInt(visualId, 10);

        // Only validate as number for WEBAPP mode or if it's not a temp ID
        if (!isTempId && isNaN(visualIdNum) && environment.isWeb) {
          console.error('[GALLERY UPLOAD] Invalid LBW ID (not a number and not a temp ID):', visualId);
          // Mark all skeleton photos as failed
          skeletonPhotos.forEach(skeleton => {
            const photoIndex = this.visualPhotos[key]?.findIndex(p => p.AttachID === skeleton.AttachID);
            if (photoIndex !== -1 && this.visualPhotos[key]) {
              this.visualPhotos[key][photoIndex].uploading = false;
              this.visualPhotos[key][photoIndex].uploadFailed = true;
              this.visualPhotos[key][photoIndex].isSkeleton = false;
            }
          });
          this.changeDetectorRef.detectChanges();
          return;
        }

        console.log('[GALLERY UPLOAD] visualId validation passed:', visualId, 'isTempId:', isTempId);

        console.log('[GALLERY UPLOAD] ✅ Valid LBW ID found:', visualId);

        // ============================================
        // WEBAPP MODE: Direct S3 Upload (No Local Storage)
        // MOBILE MODE: Local-first with background sync
        // ============================================

        if (environment.isWeb) {
          console.log('[GALLERY UPLOAD] WEBAPP MODE: Direct S3 upload starting...');

          // Expand photos section
          this.expandedPhotos[key] = true;

          // Process photos sequentially for WEBAPP
          for (let i = 0; i < images.photos.length; i++) {
            const image = images.photos[i];
            const skeleton = skeletonPhotos[i];

            if (image.webPath) {
              try {
                console.log(`[GALLERY UPLOAD] WEBAPP: Processing photo ${i + 1}/${images.photos.length}`);

                // Fetch the blob
                const response = await fetch(image.webPath);
                const blob = await response.blob();
                const file = new File([blob], `gallery-${Date.now()}_${i}.jpg`, { type: 'image/jpeg' });

                // Update skeleton to show preview + uploading state
                const previewUrl = URL.createObjectURL(blob);
                const skeletonIndex = this.visualPhotos[key]?.findIndex(p => p.AttachID === skeleton.AttachID);
                if (skeletonIndex !== -1 && this.visualPhotos[key]) {
                  this.visualPhotos[key][skeletonIndex] = {
                    ...this.visualPhotos[key][skeletonIndex],
                    url: previewUrl,
                    displayUrl: previewUrl,
                    thumbnailUrl: previewUrl,
                    isObjectUrl: true,
                    uploading: true,
                    isSkeleton: false,
                    progress: 0
                  };
                  this.changeDetectorRef.detectChanges();
                }

                // Upload directly to S3
                const uploadResult = await this.localImageService.uploadImageDirectToS3(
                  file,
                  'lbw',
                  String(visualId),
                  this.serviceId,
                  '', // caption
                  ''  // drawings
                );

                console.log(`[GALLERY UPLOAD] WEBAPP: Photo ${i + 1} uploaded, AttachID:`, uploadResult.attachId);

                // Replace skeleton with real photo
                const finalIndex = this.visualPhotos[key]?.findIndex(p => p.AttachID === skeleton.AttachID);
                if (finalIndex !== -1 && this.visualPhotos[key]) {
                  this.visualPhotos[key][finalIndex] = {
                    ...this.visualPhotos[key][finalIndex],
                    imageId: uploadResult.attachId,
                    AttachID: uploadResult.attachId,
                    attachId: uploadResult.attachId,
                    id: uploadResult.attachId,
                    url: uploadResult.s3Url,
                    displayUrl: uploadResult.s3Url,
                    originalUrl: uploadResult.s3Url,
                    thumbnailUrl: uploadResult.s3Url,
                    status: 'uploaded',
                    isLocal: false,
                    uploading: false,
                    isPending: false,
                    _pendingFileId: undefined  // Clear pending flag - photo is now on backend
                  };
                }
                this.changeDetectorRef.detectChanges();

                // CRITICAL: Clear attachment cache so next page load fetches fresh data from server
                this.hudData.clearAttachmentCache(String(visualId));

              } catch (error) {
                console.error(`[GALLERY UPLOAD] WEBAPP: Error uploading photo ${i + 1}:`, error);

                // Mark the photo as failed
                const photoIndex = this.visualPhotos[key]?.findIndex(p => p.AttachID === skeleton.AttachID);
                if (photoIndex !== -1 && this.visualPhotos[key]) {
                  this.visualPhotos[key][photoIndex].uploading = false;
                  this.visualPhotos[key][photoIndex].uploadFailed = true;
                  this.visualPhotos[key][photoIndex].isSkeleton = false;
                  this.changeDetectorRef.detectChanges();
                }
              }
            }
          }

          console.log(`[GALLERY UPLOAD] WEBAPP: All ${images.photos.length} photos processed`);
          return;
        }

        // ============================================
        // MOBILE MODE: DEXIE-FIRST LOCAL IMAGE SYSTEM
        // Uses localImageService.captureImage() for proper LocalImage creation
        // Photos sync silently in background via BackgroundSyncService
        // ============================================

        console.log('[GALLERY UPLOAD] MOBILE MODE: Starting DEXIE-FIRST capture...');

        // Expand photos section
        this.expandedPhotos[key] = true;

        // RACE CONDITION FIX: Suppress liveQuery during gallery processing
        this.isCameraCaptureInProgress = true;

        // Process photos sequentially with DEXIE-FIRST pattern
        for (let i = 0; i < images.photos.length; i++) {
          const image = images.photos[i];
          const skeleton = skeletonPhotos[i];

          if (image.webPath) {
            try {
              console.log(`[GALLERY UPLOAD] MOBILE: Processing photo ${i + 1}/${images.photos.length}`);

              // Fetch the blob
              const response = await fetch(image.webPath);
              const blob = await response.blob();
              const file = new File([blob], `gallery-${Date.now()}_${i}.jpg`, { type: 'image/jpeg' });

              // Compress the file before storing
              let compressedFile = file;
              try {
                const compressed = await this.imageCompression.compressImage(file, {
                  maxWidth: 2048,
                  maxHeight: 2048,
                  quality: 0.85
                });
                compressedFile = new File([compressed], file.name, { type: 'image/jpeg' });
                console.log(`[GALLERY UPLOAD] Compressed ${i + 1}:`, file.size, '->', compressedFile.size);
              } catch (compressError) {
                console.warn(`[GALLERY UPLOAD] Compression failed for ${i + 1}, using original:`, compressError);
              }

              // Create LocalImage with stable UUID (this stores blob + creates outbox item)
              let localImage: LocalImage;
              try {
                localImage = await this.localImageService.captureImage(
                  compressedFile,
                  'lbw',  // Entity type for LBW photos
                  String(visualId),
                  this.serviceId,
                  '',  // No caption for gallery photos
                  ''   // No drawings for gallery photos
                );
                console.log(`[GALLERY UPLOAD] Created LocalImage ${i + 1}:`, localImage.imageId);
              } catch (captureError: any) {
                console.error(`[GALLERY UPLOAD] Failed to create LocalImage ${i + 1}:`, captureError);
                // Mark skeleton as failed
                const skeletonIndex = this.visualPhotos[key]?.findIndex(p => p.AttachID === skeleton.AttachID);
                if (skeletonIndex !== -1 && this.visualPhotos[key]) {
                  this.visualPhotos[key][skeletonIndex].uploading = false;
                  this.visualPhotos[key][skeletonIndex].uploadFailed = true;
                  this.visualPhotos[key][skeletonIndex].isSkeleton = false;
                }
                this.changeDetectorRef.detectChanges();
                continue;
              }

              // Get display URL from LocalImageService
              let displayUrl = await this.localImageService.getDisplayUrl(localImage);

              // US-001 FIX: If getDisplayUrl returns placeholder, create blob URL directly from compressed file
              if (!displayUrl || displayUrl === 'assets/img/photo-placeholder.svg') {
                console.warn(`[GALLERY UPLOAD] US-001 FIX: getDisplayUrl returned placeholder for photo ${i + 1}, creating direct blob URL`);
                displayUrl = URL.createObjectURL(compressedFile);
              }

              // Replace skeleton with actual photo entry
              const skeletonIndex = this.visualPhotos[key]?.findIndex(p => p.AttachID === skeleton.AttachID);
              if (skeletonIndex !== -1 && this.visualPhotos[key]) {
                this.visualPhotos[key][skeletonIndex] = {
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
                  name: `gallery-photo-${i + 1}.jpg`,
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
                this.changeDetectorRef.detectChanges();
              }

              console.log(`[GALLERY UPLOAD] MOBILE: Photo ${i + 1}/${images.photos.length} added (silent sync)`);

            } catch (error) {
              console.error(`[GALLERY UPLOAD] MOBILE: Error processing photo ${i + 1}:`, error);

              // Mark the skeleton as failed
              const photoIndex = this.visualPhotos[key]?.findIndex(p => p.AttachID === skeleton.AttachID);
              if (photoIndex !== -1 && this.visualPhotos[key]) {
                this.visualPhotos[key][photoIndex].uploading = false;
                this.visualPhotos[key][photoIndex].uploadFailed = true;
                this.visualPhotos[key][photoIndex].isSkeleton = false;
                this.changeDetectorRef.detectChanges();
              }
            }
          }
        }

        // RACE CONDITION FIX: Re-enable liveQuery now that photos are in visualPhotos
        this.isCameraCaptureInProgress = false;

        console.log(`[GALLERY UPLOAD] MOBILE: All ${images.photos.length} photos processed with DEXIE-FIRST`);
      }
    } catch (error) {
      // Check if user cancelled
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

  // Perform HUD photo upload (matches performVisualPhotoUpload from structural systems)
  private async performVisualPhotoUpload(
    LBWID: number,
    photo: File,
    key: string,
    isBatchUpload: boolean,
    annotationData: any,
    originalPhoto: File | null,
    tempId: string | undefined,
    caption: string
  ): Promise<string | null> {
    try {
      console.log(`[HUD PHOTO UPLOAD] Starting upload for LBWID ${LBWID}`);

      // Upload photo using HUD service
      const result = await this.hudData.uploadVisualPhoto(LBWID, photo, caption);

      console.log(`[HUD PHOTO UPLOAD] Upload complete for LBWID ${LBWID}`);
      console.log(`[HUD PHOTO UPLOAD] Full result object:`, JSON.stringify(result, null, 2));
      console.log(`[HUD PHOTO UPLOAD] Result.Result:`, result.Result);
      console.log(`[HUD PHOTO UPLOAD] AttachID:`, result.AttachID || result.Result?.[0]?.AttachID);
      console.log(`[HUD PHOTO UPLOAD] Photo path:`, result.Photo || result.Result?.[0]?.Photo);

      if (tempId && this.visualPhotos[key]) {
        const photoIndex = this.visualPhotos[key].findIndex(p => p.AttachID === tempId || p.id === tempId);
        if (photoIndex !== -1) {
          const oldUrl = this.visualPhotos[key][photoIndex].url;
          if (oldUrl && oldUrl.startsWith('blob:')) {
            URL.revokeObjectURL(oldUrl);
          }

          // CRITICAL: Get the uploaded photo URL from the result
          // Handle both direct result and Result array format
          const actualResult = result.Result && result.Result[0] ? result.Result[0] : result;
          const s3Key = actualResult.Attachment; // S3 key
          const uploadedPhotoUrl = actualResult.Photo || actualResult.thumbnailUrl || actualResult.url; // Old Caspio path
          let displayableUrl = uploadedPhotoUrl || '';

          console.log('[LBW PHOTO UPLOAD] Actual result:', actualResult);
          console.log('[LBW PHOTO UPLOAD] S3 key:', s3Key);
          console.log('[LBW PHOTO UPLOAD] Uploaded photo path (old):', uploadedPhotoUrl);

          // Check if this is an S3 image
          if (s3Key && this.caspioService.isS3Key(s3Key)) {
            try {
              console.log('[LBW PHOTO UPLOAD] ✨ S3 image detected, fetching pre-signed URL...');
              displayableUrl = await this.caspioService.getS3FileUrl(s3Key);
              console.log('[LBW PHOTO UPLOAD] ✅ Got S3 pre-signed URL');
            } catch (err) {
              console.error('[LBW PHOTO UPLOAD] ❌ Failed to fetch S3 URL:', err);
              displayableUrl = 'assets/img/photo-placeholder.svg';
            }
          }
          // Fallback to old Caspio Files API logic
          else if (uploadedPhotoUrl && !uploadedPhotoUrl.startsWith('data:') && !uploadedPhotoUrl.startsWith('blob:')) {
            try {
              console.log('[LBW PHOTO UPLOAD] 📁 Caspio Files API path detected, fetching image data...');
              const imageData = await firstValueFrom(
                this.caspioService.getImageFromFilesAPI(uploadedPhotoUrl)
              );
              console.log('[LBW PHOTO UPLOAD] Files API response:', imageData?.substring(0, 100));
              
              if (imageData && imageData.startsWith('data:')) {
                displayableUrl = imageData;
                console.log('[LBW PHOTO UPLOAD] ✅ Successfully converted to data URL, length:', imageData.length);
              } else {
                console.warn('[LBW PHOTO UPLOAD] ❌ Files API returned invalid data');
                displayableUrl = 'assets/img/photo-placeholder.svg';
              }
            } catch (err) {
              console.error('[LBW PHOTO UPLOAD] ❌ Failed to fetch image from Files API:', err);
              displayableUrl = 'assets/img/photo-placeholder.svg';
            }
          } else {
            console.log('[LBW PHOTO UPLOAD] Using URL directly (already data/blob URL)');
          }

          console.log('[HUD PHOTO UPLOAD] Final displayableUrl length:', displayableUrl?.length || 0);
          console.log('[HUD PHOTO UPLOAD] Updating photo at index', photoIndex);

          // Get AttachID from the actual result
          const attachId = actualResult.AttachID || actualResult.PK_ID || actualResult.id;
          console.log('[HUD PHOTO UPLOAD] Using AttachID:', attachId);

          this.visualPhotos[key][photoIndex] = {
            ...this.visualPhotos[key][photoIndex],
            AttachID: attachId,
            id: attachId,
            uploading: false,
            queued: false,
            filePath: uploadedPhotoUrl,
            Photo: uploadedPhotoUrl,
            url: displayableUrl,
            originalUrl: displayableUrl,      // CRITICAL: Set originalUrl to base image
            thumbnailUrl: displayableUrl,
            displayUrl: displayableUrl,        // Will be overwritten if user annotates
            caption: caption || '',
            annotation: caption || '',
            Annotation: caption || ''
          };

          console.log('[HUD PHOTO UPLOAD] ✅ Photo object updated:', {
            AttachID: this.visualPhotos[key][photoIndex].AttachID,
            hasUrl: !!this.visualPhotos[key][photoIndex].url,
            hasThumbnail: !!this.visualPhotos[key][photoIndex].thumbnailUrl,
            hasDisplay: !!this.visualPhotos[key][photoIndex].displayUrl,
            urlLength: this.visualPhotos[key][photoIndex].url?.length || 0
          });

          this.changeDetectorRef.detectChanges();
          console.log('[HUD PHOTO UPLOAD] ✅ Change detection triggered');
        } else {
          console.warn('[HUD PHOTO UPLOAD] ❌ Could not find photo with tempId:', tempId);
        }
      }

      // Return the AttachID for immediate use
      return result.AttachID;

    } catch (error) {
      console.error('[HUD PHOTO UPLOAD] ❌ Upload failed:', error);

      if (tempId && this.visualPhotos[key]) {
        const photoIndex = this.visualPhotos[key].findIndex(p => p.AttachID === tempId || p.id === tempId);
        if (photoIndex !== -1) {
          this.visualPhotos[key].splice(photoIndex, 1);
          this.changeDetectorRef.detectChanges();
        }
      }

      return null;
    }
  }

  // Save annotation data to database (from structural systems)
  private async saveAnnotationToDatabase(attachId: string, annotatedBlob: Blob, annotationsData: any, caption: string): Promise<string> {
    // Import compression utilities
    const { compressAnnotationData } = await import('../../../utils/annotation-utils');

    // Build the updateData object with Annotation and Drawings fields
    const updateData: any = {
      Annotation: caption || ''
    };

    // Add annotations to Drawings field if provided
    if (annotationsData) {
      let drawingsData = '';

      // Handle Fabric.js canvas export
      if (annotationsData && typeof annotationsData === 'object' && 'objects' in annotationsData) {
        try {
          drawingsData = JSON.stringify(annotationsData);
        } catch (e) {
          console.error('[SAVE] Failed to stringify Fabric.js object:', e);
          drawingsData = JSON.stringify({ objects: [], version: '5.3.0' });
        }
      } else if (typeof annotationsData === 'string') {
        drawingsData = annotationsData;
      } else if (typeof annotationsData === 'object') {
        try {
          drawingsData = JSON.stringify(annotationsData);
        } catch (e) {
          console.error('[SAVE] Failed to stringify annotation data:', e);
        }
      }

      if (drawingsData && drawingsData.length > 0) {
        // Compress if large
        let compressedDrawings = drawingsData;
        if (drawingsData.length > 50000) {
          try {
            compressedDrawings = compressAnnotationData(drawingsData, { emptyResult: '{}' });
            console.log('[SAVE ANNOTATION] Compressed from', drawingsData.length, 'to', compressedDrawings.length, 'bytes');
          } catch (e) {
            console.error('[SAVE] Compression failed:', e);
            compressedDrawings = drawingsData;
          }
        }

        updateData.Drawings = compressedDrawings;
      }
    }

    // Update the LBW attach record
    // MOBILE MODE: Queue for background sync instead of direct API call
    if (!environment.isWeb) {
      // Queue annotation update for background sync
      await this.hudData.queueCaptionUpdate(
        attachId,
        updateData.Annotation || '',
        updateData.Drawings || '',
        { serviceId: this.serviceId }
      );
      console.log('[SAVE ANNOTATION] ✅ Annotations queued for background sync');
    } else {
      // WEBAPP MODE: Direct API call
      await firstValueFrom(this.caspioService.updateServicesLBWAttach(attachId, updateData));
      console.log('[SAVE ANNOTATION] ✅ Annotations saved directly to API');
    }

    // TASK 4 FIX: Cache the annotated blob for thumbnail display on reload
    // This ensures annotations are visible in thumbnails after page reload
    if (annotatedBlob && annotatedBlob.size > 0) {
      try {
        const base64 = await this.indexedDb.cacheAnnotatedImage(String(attachId), annotatedBlob);
        console.log('[SAVE ANNOTATION] ✅ Annotated image blob cached for thumbnail display');
        // Update in-memory map so same-session navigation shows the annotation
        if (base64 && this.bulkAnnotatedImagesMap) {
          this.bulkAnnotatedImagesMap.set(String(attachId), base64);
        }
      } catch (annotCacheErr) {
        console.warn('[SAVE ANNOTATION] Failed to cache annotated image blob:', annotCacheErr);
      }
    }

    // ANNOTATION FLATTENING PREVENTION (Attempt #1 - Issue #1 in Mobile_Issues.md)
    // Verify that we actually have valid annotation data being saved
    if (!updateData.Drawings || updateData.Drawings === '{}') {
      if (annotationsData && typeof annotationsData === 'object' && annotationsData.objects?.length > 0) {
        console.error('[SAVE] ⚠️ ANNOTATION FLATTENING RISK: annotationsData has', annotationsData.objects.length,
          'objects but Drawings field is empty/default. Annotations may not be editable on reload!');
      }
    } else {
      // Verify the saved data can be decompressed back to valid annotations
      try {
        const { decompressAnnotationData } = await import('../../../utils/annotation-utils');
        const verifyDecompressed = decompressAnnotationData(updateData.Drawings);
        if (!verifyDecompressed || !verifyDecompressed.objects || verifyDecompressed.objects.length === 0) {
          console.warn('[SAVE] ⚠️ ANNOTATION VERIFICATION WARNING: Saved Drawings decompresses to empty annotations');
        } else {
          console.log('[SAVE] ✅ ANNOTATION VERIFICATION PASSED:', verifyDecompressed.objects.length, 'objects will be editable on reload');
        }
      } catch (verifyError) {
        console.error('[SAVE] ⚠️ ANNOTATION VERIFICATION FAILED: Cannot decompress saved Drawings:', verifyError);
      }
    }

    return attachId;
  }

  // Clear PDF cache (stub for compatibility)
  private clearPdfCache(): void {
    // Future: implement PDF cache clearing if needed
  }

  // Helper methods from structural systems
  trackByPhotoId(index: number, photo: any): string {
    // MUST return stable UUID - NEVER fall back to index (causes re-renders)
    // Priority: imageId (new local-first) > _tempId > AttachID > generated emergency ID
    const stableId = photo.imageId || photo._tempId || photo.AttachID || photo.id;
    if (stableId) {
      return String(stableId);
    }
    // Generate emergency stable ID from available data - never use index
    console.warn('[trackBy] Photo missing stable ID, generating emergency ID:', photo);
    return `photo_${photo.VisualID || photo.LBWID || 'unknown'}_${photo.fileName || photo.Photo || index}`;
  }

  handleImageError(event: any, photo: any) {
    const target = event.target as HTMLImageElement;
    target.src = 'assets/img/photo-placeholder.svg';
    // Also mark as not loading when error occurs
    if (photo) {
      photo.loading = false;
    }
  }

  onImageLoad(photo: any) {
    // Image finished loading - remove shimmer effect
    if (photo) {
      photo.loading = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  saveScrollBeforePhotoClick(event: Event): void {
    // Scroll position is handled in viewPhoto
  }

  isLoadingPhotosForVisual(category: string, itemId: string | number): boolean {
    // CRITICAL FIX: Use item.templateId for key (not itemId) to match Dexie lookup pattern
    const item = this.findItemById(itemId);
    const templateId = item?.templateId ?? itemId;
    const key = `${category}_${templateId}`;
    return this.loadingPhotosByKey[key] === true;
  }

  getSkeletonArray(category: string, itemId: string | number): any[] {
    // CRITICAL FIX: Use item.templateId for key (not itemId) to match Dexie lookup pattern
    const item = this.findItemById(itemId);
    const templateId = item?.templateId ?? itemId;
    const key = `${category}_${templateId}`;
    const count = this.photoCountsByKey[key] || 0;
    return Array(count).fill({ isSkeleton: true });
  }

  isUploadingPhotos(category: string, itemId: string | number): boolean {
    // CRITICAL FIX: Use item.templateId for key (not itemId) to match Dexie lookup pattern
    const item = this.findItemById(itemId);
    const templateId = item?.templateId ?? itemId;
    const key = `${category}_${templateId}`;
    return this.uploadingPhotosByKey[key] === true;
  }

  getUploadingCount(category: string, itemId: string | number): number {
    // CRITICAL FIX: Use item.templateId for key (not itemId) to match Dexie lookup pattern
    const item = this.findItemById(itemId);
    const templateId = item?.templateId ?? itemId;
    const key = `${category}_${templateId}`;
    const photos = this.visualPhotos[key] || [];
    return photos.filter(p => p.uploading).length;
  }

  getTotalPhotoCount(category: string, itemId: string | number): number {
    // CRITICAL FIX: Use item.templateId for key (not itemId) to match Dexie lookup pattern
    const item = this.findItemById(itemId);
    const templateId = item?.templateId ?? itemId;
    const key = `${category}_${templateId}`;
    return (this.visualPhotos[key] || []).length;
  }

  async openCaptionPopup(photo: any, category: string, itemId: string | number) {
    // Prevent multiple popups
    if ((this as any).isCaptionPopupOpen) {
      return;
    }

    (this as any).isCaptionPopupOpen = true;

    try {
      // Escape HTML
      const escapeHtml = (text: string) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      };

      const tempCaption = escapeHtml(photo.caption || '');

      // Define preset location buttons - 3 columns
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

      // Build HTML for preset buttons
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
            text: 'Cancel',
            role: 'cancel',
            handler: () => {
              (this as any).isCaptionPopupOpen = false;
            }
          },
          {
            text: 'Save',
            handler: () => {
              const input = document.getElementById('captionInput') as HTMLInputElement;
              const newCaption = input?.value || '';

              // Update photo caption in UI immediately
              photo.caption = newCaption;
              this.changeDetectorRef.detectChanges();

              // Close popup immediately
              (this as any).isCaptionPopupOpen = false;

              // Save to database in background
              if (photo.AttachID && !String(photo.AttachID).startsWith('temp_')) {
                this.hudData.updateVisualPhotoCaption(photo.AttachID, newCaption)
                  .then(() => {
                    console.log('[CAPTION] Saved caption for photo:', photo.AttachID);
                  })
                  .catch((error: unknown) => {
                    console.error('[CAPTION] Error saving caption:', error);
                    this.showToast('Caption saved to device, will sync when online', 'warning');
                  });
              }

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
            (this as any).isCaptionPopupOpen = false;
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
                    // Remove focus from button to prevent highlight
                    (btn as HTMLButtonElement).blur();
                  }
                }
              } catch (error) {
                console.error('Error handling preset button click:', error);
              }
            }, { passive: false });
          }

          // Add undo button handler
          if (undoBtn && captionInput) {
            undoBtn.addEventListener('click', (e) => {
              try {
                e.preventDefault();
                e.stopPropagation();
                const currentValue = captionInput.value || '';
                if (currentValue.trim() === '') {
                  return;
                }
                const words = currentValue.trim().split(' ');
                if (words.length > 0) {
                  words.pop();
                }
                captionInput.value = words.join(' ');
                if (captionInput.value.length > 0) {
                  captionInput.value += ' ';
                }
              } catch (error) {
                console.error('Error handling undo button click:', error);
              }
            });
          }
        } catch (error) {
          console.error('Error injecting caption popup content:', error);
          (this as any).isCaptionPopupOpen = false;
        }
      }, 0);

    } catch (error) {
      console.error('Error opening caption popup:', error);
      (this as any).isCaptionPopupOpen = false;
    }
  }

  async viewPhoto(photo: any, category: string, itemId: string | number, event?: Event) {
    console.log('[VIEW PHOTO] Opening photo annotator for', photo.AttachID);

    try {
      // CRITICAL FIX: Use item.templateId for key (not itemId) to match Dexie lookup pattern
      const item = this.findItemById(itemId);
      const templateId = item?.templateId ?? itemId;
      const key = `${category}_${templateId}`;

      // Check if photo is still uploading
      if (photo.uploading || photo.queued) {
        return;
      }

      const attachId = photo.AttachID || photo.id;
      if (!attachId) {
        return;
      }

      // Save scroll position
      const scrollPosition = await this.content?.getScrollElement().then(el => el.scrollTop) || 0;

      // Get image URL
      let imageUrl = photo.url || photo.thumbnailUrl || 'assets/img/photo-placeholder.svg';

      // Check if this is a pending/offline photo (temp ID) - retrieve from IndexedDB
      const isPendingPhoto = String(attachId).startsWith('temp_') || photo._pendingFileId;
      const pendingFileId = photo._pendingFileId || attachId;

      if (isPendingPhoto) {
        console.log('[VIEW PHOTO] Pending photo detected, retrieving from IndexedDB:', pendingFileId);
        try {
          const photoData = await this.indexedDb.getStoredPhotoData(pendingFileId);
          if (photoData && photoData.file) {
            // Convert file to data URL for the annotator
            const blob = photoData.file;
            imageUrl = await this.blobToDataUrl(blob);
            // CRITICAL: Must also set photo.originalUrl - it's checked first later
            photo.url = imageUrl;
            photo.originalUrl = imageUrl;
            photo.thumbnailUrl = imageUrl;
            console.log('[VIEW PHOTO] ✅ Retrieved pending photo from IndexedDB, URL set');
          } else {
            console.warn('[VIEW PHOTO] Pending photo not found in IndexedDB');
            // If the photo has a data URL already, use it
            if (photo.url && photo.url.startsWith('data:')) {
              imageUrl = photo.url;
            } else {
              await this.showToast('Photo not available offline', 'warning');
              return;
            }
          }
        } catch (err) {
          console.error('[VIEW PHOTO] Error retrieving pending photo:', err);
          // Try using existing URL if available
          if (photo.url && photo.url.startsWith('data:')) {
            imageUrl = photo.url;
          } else {
            await this.showToast('Photo not available offline', 'warning');
            return;
          }
        }
      }
      // If no valid URL and we have a file path, try to fetch it
      else if ((!imageUrl || imageUrl === 'assets/img/photo-placeholder.svg') && (photo.filePath || photo.Photo || photo.Attachment)) {
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
              photo.url = fetchedImage;
              photo.originalUrl = fetchedImage;
              photo.thumbnailUrl = fetchedImage;
              photo.displayUrl = fetchedImage;
            }
          }
          this.changeDetectorRef.detectChanges();
        } catch (err) {
          console.error('[VIEW PHOTO] Failed to fetch image:', err);
        }
      }

      // Always use the original URL for editing
      let originalImageUrl = photo.originalUrl || photo.url || imageUrl;

      // ANNOTATION FLATTENING FIX #6: Validate original URL on re-edit
      // If originalUrl equals displayUrl AND photo has annotations, the original may have been overwritten
      if (originalImageUrl === photo.displayUrl && photo.hasAnnotations && photo.Attachment) {
        console.warn('[VIEW PHOTO] ⚠️ originalUrl same as displayUrl - may be flattened');
        console.warn('[VIEW PHOTO] Attempting to fetch original from S3:', photo.Attachment);

        // Try to get base image from S3 (the authoritative source)
        if (this.caspioService.isS3Key(photo.Attachment)) {
          try {
            const s3OriginalUrl = await this.caspioService.getS3FileUrl(photo.Attachment);
            if (s3OriginalUrl && s3OriginalUrl !== originalImageUrl) {
              console.log('[VIEW PHOTO] ✅ Fetched original from S3, using instead of potentially flattened URL');
              originalImageUrl = s3OriginalUrl;
            }
          } catch (e) {
            console.error('[VIEW PHOTO] Failed to fetch from S3, using potentially flattened URL:', e);
          }
        }
      }

      // Try to load existing annotations
      let existingAnnotations: any = null;
      const annotationSources = [
        photo.annotations,
        photo.annotationsData,
        photo.rawDrawingsString,
        photo.Drawings
      ];

      for (const source of annotationSources) {
        if (!source) continue;
        try {
          if (typeof source === 'string') {
            const { decompressAnnotationData } = await import('../../../utils/annotation-utils');
            existingAnnotations = decompressAnnotationData(source);
          } else {
            existingAnnotations = source;
          }
          if (existingAnnotations) break;
        } catch (e) {
          console.error('[VIEW PHOTO] Error loading annotations:', e);
        }
      }

      // ANNOTATION FLATTENING DETECTION (Attempt #1 - Issue #1 in Mobile_Issues.md)
      // If photo has hasAnnotations flag but no annotation data was found, the image may be flattened
      if (photo.hasAnnotations && !existingAnnotations) {
        console.warn('[VIEW PHOTO] ⚠️ POTENTIAL ANNOTATION FLATTENING DETECTED');
        console.warn('[VIEW PHOTO] Photo marked as having annotations (hasAnnotations=true) but no annotation data found');
        console.warn('[VIEW PHOTO] AttachID:', attachId, 'Annotation sources checked:', {
          'photo.annotations': !!photo.annotations,
          'photo.annotationsData': !!photo.annotationsData,
          'photo.rawDrawingsString': !!photo.rawDrawingsString,
          'photo.Drawings': !!photo.Drawings
        });
        console.warn('[VIEW PHOTO] Any new annotations will be added on top of existing flattened annotations');
      }

      const existingCaption = photo.caption || photo.annotation || photo.Annotation || '';

      // Open FabricPhotoAnnotatorComponent
      const modal = await this.modalController.create({
        component: FabricPhotoAnnotatorComponent,
        componentProps: {
          imageUrl: originalImageUrl,
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

      await modal.present();
      const { data } = await modal.onWillDismiss();

      // Restore scroll position
      setTimeout(async () => {
        if (this.content) {
          await this.content.scrollToPoint(0, scrollPosition, 0);
        }
      }, 100);

      if (!data || !data.annotatedBlob) {
        return;
      }

      // User saved annotations - update the photo
      const annotatedBlob = data.blob || data.annotatedBlob;
      const annotationsData = data.annotationData || data.annotationsData;
      const newCaption = data.caption || existingCaption;

      // Save annotations to database
      await this.saveAnnotationToDatabase(attachId, annotatedBlob, annotationsData, newCaption);

      // Update UI
      const photos = this.visualPhotos[key] || [];
      const photoIndex = photos.findIndex(p => (p.AttachID || p.id) === attachId);
      if (photoIndex !== -1) {
        const displayUrl = URL.createObjectURL(annotatedBlob);
        this.visualPhotos[key][photoIndex] = {
          ...this.visualPhotos[key][photoIndex],
          displayUrl: displayUrl,
          hasAnnotations: true,
          annotations: annotationsData,
          annotationsData: annotationsData,
          caption: newCaption,
          annotation: newCaption,
          Annotation: newCaption
        };
        this.changeDetectorRef.detectChanges();
      }

    } catch (error) {
      console.error('Error viewing photo:', error);
    }
  }

  async deletePhoto(photo: any, category: string, itemId: string | number) {
    // CRITICAL FIX: Use item.templateId for key (not itemId) to match Dexie lookup pattern
    // Capture these values BEFORE the setTimeout closure
    const item = this.findItemById(itemId);
    const templateId = item?.templateId ?? itemId;
    const key = `${category}_${templateId}`;

    try {
      const alert = await this.alertController.create({
        header: 'Delete Photo',
        message: 'Are you sure you want to delete this photo?',
        cssClass: 'custom-document-alert',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            cssClass: 'alert-button-cancel'
          },
          {
            text: 'Delete',
            cssClass: 'alert-button-confirm',
            handler: () => {
              // Return true to allow alert to dismiss, then process deletion
              setTimeout(async () => {
                const loading = await this.loadingController.create({
                  message: 'Deleting photo...'
                });
                await loading.present();

                try {
                  // Remove from UI immediately using filter
                  if (this.visualPhotos[key]) {
                    this.visualPhotos[key] = this.visualPhotos[key].filter(
                      (p: any) => p.AttachID !== photo.AttachID && p.imageId !== photo.imageId
                    );
                  }

                  // DEXIE-FIRST: Delete from local IndexedDB (localImages and localBlobs)
                  const imageIdToDelete = photo.imageId || photo.localImageId;
                  if (imageIdToDelete) {
                    try {
                      // Get the localImage to find the blobId
                      const localImage = await db.localImages.get(imageIdToDelete);
                      if (localImage) {
                        // Delete the blob if exists
                        if (localImage.localBlobId) {
                          await db.localBlobs.delete(localImage.localBlobId);
                          console.log('[DELETE PHOTO] Deleted blob:', localImage.localBlobId);
                        }
                        // Delete the localImage record
                        await db.localImages.delete(imageIdToDelete);
                        console.log('[DELETE PHOTO] Deleted localImage:', imageIdToDelete);
                      }
                    } catch (dexieError) {
                      console.warn('[DELETE PHOTO] Error deleting from Dexie:', dexieError);
                    }
                  }

                  // Delete from backend database (for synced photos)
                  const attachIdToDelete = photo.AttachID || photo.attachId;
                  if (attachIdToDelete && !String(attachIdToDelete).startsWith('temp_') && !String(attachIdToDelete).startsWith('img_')) {
                    await this.hudData.deleteVisualPhoto(attachIdToDelete);
                    console.log('[DELETE PHOTO] Queued backend deletion:', attachIdToDelete);
                  }

                  // Force UI update
                  this.changeDetectorRef.detectChanges();

                  await loading.dismiss();
                  await this.showToast('Photo deleted', 'success');
                } catch (error) {
                  await loading.dismiss();
                  console.error('Error deleting photo:', error);
                  await this.showToast('Failed to delete photo', 'danger');
                }
              }, 100);

              return true; // Allow alert to dismiss immediately
            }
          }
        ]
      });

      await alert.present();
    } catch (error) {
      console.error('Error in deletePhoto:', error);
      await this.showToast('Failed to delete photo', 'danger');
    }
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

  /**
   * Convert a Blob to a data URL string
   * Used for persistent offline storage (data URLs survive page navigation unlike blob URLs)
   */
  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ============================================
  // ADD CUSTOM VISUAL (from structural systems)
  // ============================================

  async addCustomVisual(category: string, kind: string) {
    // Dynamically import the modal component
    const { AddCustomVisualModalComponent } = await import('../../../modals/add-custom-visual-modal/add-custom-visual-modal.component');

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

  // Create custom visual with photos - DEXIE-FIRST pattern
  async createCustomVisualWithPhotos(category: string, kind: string, name: string, text: string, files: FileList | File[] | null, processedPhotos: any[] = []) {
    try {
      const serviceIdNum = parseInt(this.serviceId, 10);
      if (isNaN(serviceIdNum)) {
        return;
      }

      const visualData = {
        ServiceID: serviceIdNum,
        Category: category,
        Kind: kind,
        Name: name,
        Text: text,
        Notes: '',
        TemplateID: 0  // Custom visual - no template
      };

      console.log('[CREATE CUSTOM] Creating LBW visual:', visualData);

      // Create the LBW record
      const response = await this.hudData.createVisual(visualData);

      // Extract LBWID (handle both direct and Result wrapped formats)
      let visualId: string | null = null;

      if (response && response.LBWID) {
        visualId = String(response.LBWID);
      } else if (Array.isArray(response) && response.length > 0) {
        visualId = String(response[0].LBWID || response[0].PK_ID || response[0].id || '');
      } else if (response && typeof response === 'object') {
        if (response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
          visualId = String(response.Result[0].LBWID || response.Result[0].PK_ID || response.Result[0].id || '');
        } else {
          visualId = String(response.LBWID || response.PK_ID || response.id || '');
        }
      } else if (response) {
        visualId = String(response);
      }

      if (!visualId || visualId === 'undefined' || visualId === 'null' || visualId === '') {
        throw new Error('No LBWID returned from server');
      }

      console.log('[CREATE CUSTOM] Created LBW visual with ID:', visualId);

      // Generate a unique templateId for custom visuals (negative to avoid collision with real templates)
      const customTemplateId = -Date.now();

      // Add to local data structure (must match loadExistingVisuals structure)
      // DEXIE-FIRST: Use templateId as the item ID for consistency with convertFieldsToOrganizedData
      const customItem: VisualItem = {
        id: visualId, // Use visualId for consistency with convertFieldsToOrganizedData
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

        // ============================================
        // WEBAPP MODE: Direct S3 Upload (matches camera/gallery pattern)
        // MOBILE MODE: Local-first with background sync
        // ============================================

        if (environment.isWeb) {
          // WEBAPP MODE: Upload directly to S3 - follows EXACT same pattern as addPhotoFromCamera
          console.log('[CREATE CUSTOM] WEBAPP MODE: Uploading', files.length, 'photos directly to S3');

          // Import compressAnnotationData for annotation handling
          const { compressAnnotationData } = await import('../../../utils/annotation-utils');

          // Process each photo sequentially to match camera upload behavior
          for (let index = 0; index < files.length; index++) {
            const file = files[index];
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

            // Compress annotations if present
            const compressedDrawings = annotationData ? compressAnnotationData(JSON.stringify(annotationData)) : '';

            // Create temp photo entry with loading state (show roller) - EXACT same structure as camera upload
            const tempId = `uploading_${Date.now()}_${index}`;
            const previewUrl = photoData.previewUrl || URL.createObjectURL(file);
            const tempPhotoEntry = {
              imageId: tempId,
              AttachID: tempId,
              attachId: tempId,
              id: tempId,
              url: previewUrl,
              displayUrl: previewUrl,
              originalUrl: previewUrl,
              thumbnailUrl: previewUrl,
              name: `photo_${index}.jpg`,
              caption: caption || '',
              annotation: caption || '',
              Annotation: caption || '',
              Drawings: compressedDrawings,
              hasAnnotations: !!annotationData,
              status: 'uploading',
              isLocal: false,
              uploading: true,  // Show loading roller
              isPending: true,
              isSkeleton: false,
              progress: 0
            };

            // Add temp photo to UI immediately (with loading roller)
            this.visualPhotos[key].push(tempPhotoEntry);
            this.loadingPhotosByKey[key] = false;
            this.expandedPhotos[key] = true;
            this.changeDetectorRef.detectChanges();

            try {
              // Upload directly to S3
              const uploadResult = await this.localImageService.uploadImageDirectToS3(
                compressedPhoto,
                'lbw',
                String(visualId),
                this.serviceId,
                caption,
                compressedDrawings
              );

              console.log(`[CREATE CUSTOM] WEBAPP: Photo ${index + 1} uploaded to S3:`, uploadResult.attachId);

              // Replace temp photo with real photo (remove loading roller) - EXACT same as camera upload
              const tempIndex = this.visualPhotos[key].findIndex((p: any) => p.imageId === tempId);
              if (tempIndex >= 0) {
                this.visualPhotos[key][tempIndex] = {
                  ...tempPhotoEntry,
                  imageId: uploadResult.attachId,
                  AttachID: uploadResult.attachId,
                  attachId: uploadResult.attachId,
                  id: uploadResult.attachId,
                  url: uploadResult.s3Url,
                  displayUrl: annotationData ? previewUrl : uploadResult.s3Url,
                  originalUrl: uploadResult.s3Url,
                  thumbnailUrl: annotationData ? previewUrl : uploadResult.s3Url,
                  status: 'uploaded',
                  isLocal: false,
                  uploading: false,  // Remove loading roller
                  isPending: false
                };
              }

              // Update photo count
              this.photoCountsByKey[key] = this.visualPhotos[key].length;
              this.changeDetectorRef.detectChanges();

              photoCount++;

            } catch (uploadError: any) {
              console.error(`[CREATE CUSTOM] WEBAPP: Photo ${index + 1} upload failed:`, uploadError?.message || uploadError);

              // Remove temp photo on error
              const tempIndex = this.visualPhotos[key].findIndex((p: any) => p.imageId === tempId);
              if (tempIndex >= 0) {
                this.visualPhotos[key].splice(tempIndex, 1);
              }
              this.changeDetectorRef.detectChanges();

              // Show error toast
              const toast = await this.toastController.create({
                message: `Failed to upload photo ${index + 1}. Please try again.`,
                duration: 3000,
                color: 'danger'
              });
              await toast.present();
            }
          }

          // Set expansion state so photos are visible
          this.expandedPhotos[key] = true;

          console.log('[CREATE CUSTOM] WEBAPP: All', photoCount, 'photos uploaded to S3');

        } else {
          // MOBILE MODE: Upload ALL photos to LocalImages first (persists to Dexie)
          console.log('[CREATE CUSTOM] MOBILE MODE: Uploading', files.length, 'photos to LocalImages');

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

            // Upload to LocalImages via hudData (persists to Dexie)
            const drawings = annotationData ? JSON.stringify(annotationData) : '';
            const result = await this.hudData.uploadVisualPhoto(visualId, compressedPhoto, caption, drawings, originalFile || undefined, this.serviceId);

            console.log(`[CREATE CUSTOM] MOBILE: Photo ${index + 1} persisted to LocalImages:`, result.imageId);
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

          console.log('[CREATE CUSTOM] MOBILE: All', photoCount, 'photos uploaded to LocalImages');
        }
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
          category: category,  // Store actual category for Dexie lookup
          photoCount: photoCount
        });
        console.log('[CREATE CUSTOM] Persisted custom visual to Dexie (after photos):', customTemplateId, visualId);
      } catch (err) {
        console.error('[CREATE CUSTOM] Failed to persist to Dexie:', err);
      }

      // CRITICAL FIX: Add custom item to organizedData for BOTH webapp AND mobile modes
      // LBW mobile doesn't use liveQuery like EFE does, so we must explicitly add the item
      console.log('[CREATE CUSTOM] Adding custom item to organizedData for immediate display');
      if (kind === 'Comment') {
        this.organizedData.comments.push(customItem);
      } else if (kind === 'Limitation') {
        this.organizedData.limitations.push(customItem);
      } else if (kind === 'Deficiency') {
        this.organizedData.deficiencies.push(customItem);
      } else {
        this.organizedData.comments.push(customItem);
      }

      // Re-sort to maintain uniform display (multi-select first, then yes/no, then text)
      this.sortOrganizedDataByAnswerType();
      this.changeDetectorRef.detectChanges();

      // Clear PDF cache so new PDFs show updated data
      this.clearPdfCache();

      console.log('[CREATE CUSTOM] Custom visual created successfully');

    } catch (error) {
      console.error('[CREATE CUSTOM] Error creating custom visual:', error);
      await this.showToast('Failed to create custom item', 'danger');
    }
  }

  // ============================================
  // SIMPLE ACCORDION METHODS (EFE-style)
  // ============================================

  /**
   * Toggle accordion section expansion
   */
  toggleSection(section: string): void {
    const index = this.expandedAccordions.indexOf(section);
    if (index > -1) {
      this.expandedAccordions.splice(index, 1);
    } else {
      this.expandedAccordions.push(section);
    }
    this.changeDetectorRef.detectChanges();
  }

  /**
   * Check if accordion section is expanded
   */
  isSectionExpanded(section: string): boolean {
    return this.expandedAccordions.includes(section);
  }

  /**
   * Toggle photo expansion for a visual item
   */
  togglePhotoExpansion(category: string, templateId: string | number): void {
    const key = `${category}_${templateId}`;
    this.expandedPhotos[key] = !this.expandedPhotos[key];
    this.changeDetectorRef.detectChanges();
  }

  /**
   * Check if photos are expanded for a visual item
   */
  isPhotosExpanded(category: string, templateId: string | number): boolean {
    const key = `${category}_${templateId}`;
    return this.expandedPhotos[key] === true;
  }

  /**
   * Navigate to visual detail page
   * LBW now uses a dedicated visual detail page (like HUD/EFE)
   */
  openVisualDetail(category: string, item: any): void {
    console.log('[LBW] openVisualDetail - navigating to visual detail page for:', item?.name, 'category:', category);

    // For custom visuals (templateId = 0), use item.id as the key
    // For template visuals, use templateId
    const isCustomVisual = !item.templateId || item.templateId === 0;
    const keyId = isCustomVisual ? item.id : item.templateId;
    const key = `${category}_${keyId}`;
    const lbwId = this.visualRecordIds[key] || '';

    // For navigation, use the templateId (or item.id for custom visuals)
    const routeId = isCustomVisual ? item.id : item.templateId;

    console.log('[LBW] openVisualDetail - projectId:', this.projectId, 'serviceId:', this.serviceId, 'category:', category, 'routeId:', routeId, 'lbwId:', lbwId, 'isCustomVisual:', isCustomVisual);

    // Use absolute navigation to ensure correct path
    this.router.navigate(['/lbw', this.projectId, this.serviceId, 'category', category, 'visual', routeId], {
      queryParams: { lbwId }
    });
  }

  // Debug panel properties and methods
  debugLogs: { time: string; type: string; message: string }[] = [];
  showDebugPopup: boolean = false;

  showDebugPanel(): void {
    this.showDebugPopup = true;
  }

  toggleDebugPopup(): void {
    this.showDebugPopup = !this.showDebugPopup;
  }
}




