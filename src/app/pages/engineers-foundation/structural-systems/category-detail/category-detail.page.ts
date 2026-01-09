import { Component, OnInit, ChangeDetectorRef, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController, AlertController, ActionSheetController, ModalController, IonContent, ViewWillEnter } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
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
import { compressAnnotationData, decompressAnnotationData } from '../../../../utils/annotation-utils';
import { AddCustomVisualModalComponent } from '../../../../modals/add-custom-visual-modal/add-custom-visual-modal.component';

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
  imports: [CommonModule, IonicModule, FormsModule]
})
export class CategoryDetailPage implements OnInit, OnDestroy, ViewWillEnter {
  // Debug flag - set to true for verbose logging
  private readonly DEBUG = false;
  
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
  private bulkVisualsCache: any[] = [];
  private bulkPendingRequestsCache: any[] = [];

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
    private localImageService: LocalImageService
  ) {}

  async ngOnInit() {
    console.log('[CategoryDetail] ========== ngOnInit START ==========');
    
    // Subscribe to background upload task updates
    this.subscribeToUploadUpdates();

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
      console.log('[CategoryDetail] All params present, calling loadData()');
      await this.loadData();
      console.log('[CategoryDetail] loadData() completed');
    } else {
      console.error('[CategoryDetail] ❌ Missing required route params - cannot load data');
      console.error('[CategoryDetail] Missing: projectId=', !this.projectId, 'serviceId=', !this.serviceId, 'categoryName=', !this.categoryName);
      this.loading = false;
      this.changeDetectorRef.detectChanges();
    }
    
    console.log('[CategoryDetail] ========== ngOnInit END ==========');

    // Also subscribe to param changes for dynamic updates
    this.route.params.subscribe(params => {
      const newCategory = params['category'];
      if (newCategory && newCategory !== this.categoryName) {
        this.categoryName = newCategory;
        console.log('[CategoryDetail] Category changed to:', this.categoryName);
        if (this.projectId && this.serviceId) {
          this.loadData();
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
    // Only process if initial load is complete and we have required IDs
    if (!this.initialLoadComplete || !this.serviceId || !this.categoryName) {
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
    
    // ALWAYS reload if:
    // 1. First load (no data in memory)
    // 2. Section is marked dirty (data changed while away)
    // 3. Service or category has changed (navigating from project details)
    if (!hasDataInMemory || isDirty || serviceOrCategoryChanged) {
      console.log('[CategoryDetail] Reloading data - section dirty, no data, or context changed');
      await this.loadData();
      this.backgroundSync.clearSectionDirty(sectionKey);
    } else {
      console.log('[CategoryDetail] Skipping reload - data unchanged, using cached view');
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
    // Clear debounce timers
    if (this.cacheInvalidationDebounceTimer) {
      clearTimeout(this.cacheInvalidationDebounceTimer);
    }
    if (this.localOperationCooldownTimer) {
      clearTimeout(this.localOperationCooldownTimer);
    }
    
    // Clean up blob URLs from LocalImageService to prevent memory leaks
    this.localImageService.revokeAllBlobUrls();
    
    console.log('[CATEGORY DETAIL] Component destroyed, but uploads continue in background');
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
    // This handles seamless URL transition from blob URL to cached base64
    // CRITICAL: No flicker - image stays the same, only metadata changes
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

          const result = event.result;
          const actualResult = result?.Result?.[0] || result;
          const realAttachId = actualResult.PK_ID || actualResult.AttachID;
          
          // SEAMLESS SWAP: Get the cached base64 (already downloaded by BackgroundSyncService)
          let newThumbnailUrl = this.visualPhotos[key][photoIndex].thumbnailUrl;
          try {
            const cachedBase64 = await this.indexedDb.getCachedPhoto(String(realAttachId));
            if (cachedBase64) {
              newThumbnailUrl = cachedBase64;
              console.log('[PHOTO SYNC] ✅ Seamless swap to cached base64 for:', realAttachId);
            } else {
              console.log('[PHOTO SYNC] No cached image yet, keeping blob URL temporarily');
            }
            
            // Check for annotated image - use it for display if exists
            const annotatedImage = this.bulkAnnotatedImagesMap.get(String(realAttachId)) 
              || this.bulkAnnotatedImagesMap.get(event.tempFileId);
            if (annotatedImage) {
              newThumbnailUrl = annotatedImage;
              console.log('[PHOTO SYNC] ✅ Using annotated image for thumbnail:', realAttachId);
            }
          } catch (err) {
            console.warn('[PHOTO SYNC] Failed to get cached image:', err);
          }

          // Update photo metadata without flicker
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
            thumbnailUrl: newThumbnailUrl,
            url: newThumbnailUrl,
            Photo: newThumbnailUrl,
            originalUrl: newThumbnailUrl,
            displayUrl: newThumbnailUrl,
            caption: finalCaption,  // CRITICAL: Preserve caption
            Annotation: finalCaption,  // Also set Caspio field
            queued: false,
            uploading: false,
            isPending: false,
            _pendingFileId: undefined,
            _localUpdate: false,  // Clear local update flag - sync is complete
            isSkeleton: false
          };

          this.changeDetectorRef.detectChanges();
          break;
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
        
        // Debounce: wait 500ms before reloading to batch multiple rapid events
        this.cacheInvalidationDebounceTimer = setTimeout(async () => {
          console.log('[CACHE INVALIDATED] Debounced reload for service:', this.serviceId);
          await this.reloadVisualsAfterSync();
        }, 500);
      }
    });
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
        this.photoCountsByKey[key] = attachments?.length || 0;
        
        // CRITICAL: If we already have photos with valid URLs, DON'T disrupt them
        // Only update metadata, don't replace working photos with broken ones
        if (attachments && attachments.length > 0) {
          if (!this.visualPhotos[key]) {
            this.visualPhotos[key] = [];
          }
          
          for (const att of attachments) {
            const realAttachId = String(att.PK_ID || att.AttachID);
            
            // First check if we already have this photo with a valid URL
            const existingPhotoIndex = this.visualPhotos[key].findIndex(p => 
              String(p.AttachID) === realAttachId || String(p.attachId) === realAttachId
            );
            
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
   */
  private async updatePhotoAfterUpload(key: string, photoIndex: number, result: any, caption: string) {
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

    // Get existing photo to preserve annotations
    const oldPhoto = this.visualPhotos[key][photoIndex];
    
    // CRITICAL: Preserve existing annotations if user added them while photo was uploading
    const hasExistingAnnotations = oldPhoto && (
      oldPhoto.hasAnnotations || 
      oldPhoto.Drawings || 
      (oldPhoto.displayUrl && oldPhoto.displayUrl.startsWith('blob:') && oldPhoto.displayUrl !== oldPhoto.url)
    );
    
    // Revoke old blob URL ONLY if it's the base image URL, not an annotation display URL
    if (oldPhoto && oldPhoto.url && oldPhoto.url.startsWith('blob:') && !hasExistingAnnotations) {
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
      
      // Get the cached annotated image using the temp ID and re-cache with real ID
      try {
        const cachedAnnotatedImage = await this.indexedDb.getCachedAnnotatedImage(originalTempId);
        if (cachedAnnotatedImage) {
          // Convert base64 back to blob and re-cache with real ID
          const response = await fetch(cachedAnnotatedImage);
          const blob = await response.blob();
          const base64 = await this.indexedDb.cacheAnnotatedImage(String(result.AttachID), blob);
          console.log('[UPLOAD UPDATE] ✅ Annotated image transferred to real AttachID:', result.AttachID);
          
          // Update in-memory map with the real AttachID so same-session navigation works
          if (base64) {
            this.bulkAnnotatedImagesMap.set(String(result.AttachID), base64);
            // Remove the temp ID entry
            this.bulkAnnotatedImagesMap.delete(originalTempId);
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
    console.log('[LOAD DATA] ========== loadData START ==========');
    const startTime = Date.now();
    
    // CRITICAL: Start cooldown to prevent cache invalidation events from causing UI flash
    this.startLocalOperationCooldown();
    
    // Clear all state
    this.visualPhotos = {};
    this.visualRecordIds = {};
    this.uploadingPhotosByKey = {};
    this.loadingPhotosByKey = {};
    this.photoCountsByKey = {};
    this.selectedItems = {};
    this.organizedData = { comments: [], limitations: [], deficiencies: [] };
    
    // Clear bulk caches
    this.bulkAttachmentsMap.clear();
    this.bulkCachedPhotosMap.clear();
    this.bulkAnnotatedImagesMap.clear();
    this.bulkPendingPhotosMap.clear();

    try {
      // ===== STEP 0: FAST LOAD - All data in ONE parallel batch =====
      // Photo data loads on-demand when user clicks to expand
      console.log('[LOAD DATA] Starting fast load (no photo data)...');
      const bulkLoadStart = Date.now();
      
      const [allTemplates, visuals, pendingPhotos, pendingRequests] = await Promise.all([
        this.indexedDb.getCachedTemplates('visual') || [],
        this.indexedDb.getCachedServiceData(this.serviceId, 'visuals') || [],
        this.indexedDb.getAllPendingPhotosGroupedByVisual(),
        this.indexedDb.getPendingRequests()
      ]);
      
      // Store ALL bulk data in memory - NO more IndexedDB reads after this
      this.bulkPendingPhotosMap = pendingPhotos;
      this.bulkVisualsCache = visuals as any[] || [];
      this.bulkPendingRequestsCache = pendingRequests || [];
      
      // Pre-load photo caches in background for fast display of synced images
      // This runs in parallel with page rendering - doesn't block UI
      this.preloadPhotoCachesInBackground();
      
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
      
      // Only show loading if no templates cached
      if ((allTemplates as any[]).length === 0) {
        this.loading = true;
        this.changeDetectorRef.detectChanges();
      }

      // ===== STEP 1: Load templates (pure CPU, instant) =====
      this.loadCategoryTemplatesFromCache(allTemplates as any[]);

      // ===== STEP 2: Process visuals (uses pre-loaded bulkVisualsCache) =====
      this.loadExistingVisualsFromCache();
      console.log('[LOAD DATA] ✅ Visuals processed');

      // ===== STEP 3: Restore pending photos (uses bulkPendingPhotosMap) =====
      this.restorePendingPhotosFromIndexedDB();
      console.log('[LOAD DATA] ✅ Pending photos restored');

      // Show page IMMEDIATELY - photo counts will update in background
      this.loading = false;
      this.expandedAccordions = ['information', 'limitations', 'deficiencies'];
      this.changeDetectorRef.detectChanges();
      
      console.log(`[LOAD DATA] ========== UI READY: ${Date.now() - startTime}ms ==========`);

      // ===== STEP 4: Load photo counts in BACKGROUND (non-blocking) =====
      setTimeout(async () => {
        const visualIds = this.bulkVisualsCache
          .filter((v: any) => v.Category === this.categoryName)
          .map((v: any) => String(v.VisualID || v.PK_ID || v.id))
          .filter((id: string) => id && !id.startsWith('temp_'));
        
        if (visualIds.length > 0) {
          this.bulkAttachmentsMap = await this.indexedDb.getAllVisualAttachmentsForVisuals(visualIds);
          // Update photo counts with loaded attachments
          this.loadAllPhotosInBackground(this.bulkVisualsCache);
          this.changeDetectorRef.detectChanges();
          console.log(`[LOAD DATA] ✅ Photo counts updated in background`);
        }
      }, 0);

    } catch (error) {
      console.error('[LOAD DATA] ❌ Error:', error);
      this.loading = false;
      this.changeDetectorRef.detectChanges();
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
      const templateData: VisualItem = {
        id: template.PK_ID,
        templateId: template.PK_ID,
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

      // Parse dropdown options if AnswerType is 2 (multi-select)
      if (template.AnswerType === 2 && template.DropdownOptions) {
        try {
          const optionsArray = JSON.parse(template.DropdownOptions);
          this.visualDropdownOptions[template.PK_ID] = optionsArray;
        } catch (e) {
          this.visualDropdownOptions[template.PK_ID] = [];
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
      this.selectedItems[`${this.categoryName}_${template.PK_ID}`] = false;
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
        const attachments = this.bulkAttachmentsMap.get(visualId) || [];
        const pendingPhotos = this.bulkPendingPhotosMap.get(visualId) || [];
        this.photoCountsByKey[key] = attachments.length + pendingPhotos.length;
        
        // Photos will load when user clicks expand - NOT automatically
        this.loadingPhotosByKey[key] = false;
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
   */
  private async loadPhotosForVisual(visualId: string, key: string) {
    try {
      this.loadingPhotosByKey[key] = true;
      this.changeDetectorRef.detectChanges();

      // ===== ON-DEMAND LOAD: Only fetch data when user expands =====
      // STEP 1: Get attachments from bulk cache (already loaded during initial load)
      const attachments = this.bulkAttachmentsMap.get(visualId) || [];

      // STEP 2: Get pending photos from bulk cache
      const pendingPhotos = this.bulkPendingPhotosMap.get(visualId) || [];
      
      if (this.DEBUG) console.log('[LOAD PHOTOS] Visual', visualId, ':', attachments.length, 'synced,', pendingPhotos.length, 'pending');

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

      // Calculate total photo count
      const existingCount = this.visualPhotos[key]?.length || 0;
      const totalCount = attachments.length + pendingPhotos.length;
      this.photoCountsByKey[key] = Math.max(existingCount, totalCount);

      // Initialize photo array if not exists
      if (!this.visualPhotos[key]) {
        this.visualPhotos[key] = [];
      }

      // Build a set of already loaded photo IDs (use String for consistent comparison)
      const loadedPhotoIds = new Set(this.visualPhotos[key].map(p => String(p.AttachID)));

      // STEP 4: Add pending photos with regenerated blob URLs (they appear first)
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
            uploading: pendingPhoto.status === 'uploading',
            queued: pendingPhoto.status === 'pending',
            isPending: true
          });
          loadedPhotoIds.add(pendingId);
        }
      }

      // Trigger change detection so pending photos appear immediately
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
   * Updates UI after each batch completes
   */
  private async downloadPhotosInParallel(attachments: any[], key: string): Promise<void> {
    const BATCH_SIZE = 5; // Download 5 at a time
    
    for (let i = 0; i < attachments.length; i += BATCH_SIZE) {
      const batch = attachments.slice(i, i + BATCH_SIZE);
      
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
   * Load a single photo using the LocalImage system for stable display
   * Priority: LocalImage local blob > LocalImage verified remote > cached photo > remote fetch
   * Never changes displayUrl until new source is verified loadable
   */
  private async loadSinglePhoto(attach: any, key: string): Promise<void> {
    // CRITICAL: Wrap entire function in try-catch to prevent crashes
    try {
      const attachId = String(attach.AttachID || attach.PK_ID);
      
      // Validate attachId before proceeding
      if (!attachId || attachId === 'undefined' || attachId === 'null') {
        console.warn('[LOAD PHOTO] Invalid attachId, skipping:', attach);
        return;
      }

      console.log('[LOAD PHOTO] Loading attachId:', attachId, 'for key:', key);
      
      // ============================================
      // STEP 1: Check LocalImage system first
      // This handles both new local photos AND synced photos
      // ============================================
      
      // Check if the attachId is actually an imageId (UUID format from new system)
      let localImage: LocalImage | null = null;
      
      // First try as imageId (for photos created with new system)
      try {
        localImage = await this.localImageService.getImage(attachId);
      } catch (e) {
        // Ignore - not a LocalImage
      }
      
      // If not found, try by Caspio AttachID (for synced photos)
      if (!localImage) {
        try {
          localImage = await this.localImageService.getImageByAttachId(attachId);
        } catch (e) {
          // Ignore - not a LocalImage
        }
      }
      
      // If we found a LocalImage, use it as the source of truth
      if (localImage) {
        const displayUrl = await this.localImageService.getDisplayUrl(localImage);
        
        // Check for annotated image cache
        let annotatedDisplayUrl = displayUrl;
        const hasDrawings = !!attach.Drawings && attach.Drawings.length > 10;
        if (hasDrawings) {
          try {
            const cachedAnnotated = await this.indexedDb.getCachedAnnotatedImage(localImage.imageId);
            if (cachedAnnotated) {
              annotatedDisplayUrl = cachedAnnotated;
            }
          } catch (e) {
            // Ignore
          }
        }
        
        const photoData: any = {
          // STABLE ID - use imageId, never changes
          imageId: localImage.imageId,
          
          // Legacy compatibility - use imageId as the key
          AttachID: localImage.attachId || localImage.imageId,
          attachId: localImage.attachId || localImage.imageId,
          id: localImage.imageId,
          VisualID: localImage.entityId,
          
          // Display URLs
          url: displayUrl,
          originalUrl: displayUrl,
          thumbnailUrl: displayUrl,
          displayUrl: annotatedDisplayUrl,
          
          // Metadata from Caspio data
          name: attach.Photo || 'photo.jpg',
          filePath: attach.Attachment || attach.Photo || '',
          Photo: attach.Attachment || attach.Photo || '',
          remoteS3Key: localImage.remoteS3Key || attach.Attachment,
          
          // Caption/Annotations
          caption: attach.Annotation || localImage.caption || '',
          annotation: attach.Annotation || localImage.caption || '',
          Annotation: attach.Annotation || localImage.caption || '',
          hasAnnotations: hasDrawings,
          Drawings: attach.Drawings || localImage.drawings || null,
          
          // Status from LocalImage system
          status: localImage.status,
          isLocal: !!localImage.localBlobId,
          isObjectUrl: !!localImage.localBlobId,
          uploading: localImage.status === 'uploading',
          queued: localImage.status === 'queued' || localImage.status === 'local_only',
          isSkeleton: false,
          loading: false
        };
        
        // Add to UI
        if (!this.visualPhotos[key]) {
          this.visualPhotos[key] = [];
        }
        
        // Check for existing entry by imageId
        const existingIndex = this.visualPhotos[key].findIndex(p => 
          p.imageId === localImage!.imageId ||
          String(p.AttachID) === attachId
        );
        
        if (existingIndex !== -1) {
          this.visualPhotos[key][existingIndex] = photoData;
        } else {
          this.visualPhotos[key].push(photoData);
        }
        
        this.changeDetectorRef.detectChanges();
        console.log('[LOAD PHOTO] ✅ Loaded from LocalImage:', localImage.imageId, 'status:', localImage.status);
        return;
      }
      
      // ============================================
      // STEP 2: Not a LocalImage - load from remote/cache (existing Caspio photos)
      // This handles photos that existed before the new system
      // ============================================
      
      const s3Key = attach.Attachment;
      const filePath = attach.Attachment || attach.Photo || '';
      const hasImageSource = attach.Attachment || attach.Photo;
      
      let displayUrl = 'assets/img/photo-placeholder.png';
      let displayState: 'local' | 'uploading' | 'cached' | 'remote_loading' | 'remote' = 'remote';
      let imageUrl = '';
      
      // Check cached photo
      try {
        const cachedImage = await this.indexedDb.getCachedPhoto(attachId);
        if (cachedImage) {
          displayUrl = cachedImage;
          imageUrl = cachedImage;
          displayState = 'cached';
        }
      } catch (cacheErr) {
        console.warn('[LOAD PHOTO] Cache check failed:', cacheErr);
      }
      
      // If no cached image, determine if we need remote fetch
      if (displayState !== 'cached') {
        if (!hasImageSource) {
          if (this.DEBUG) console.log('[LOAD PHOTO] ⚠️ Skipping photo with no image source:', attachId);
          return;
        }
        
        if (!this.offlineService.isOnline()) {
          displayState = 'remote';
        } else if (s3Key && this.caspioService.isS3Key(s3Key)) {
          displayState = 'remote_loading';
        } else if (attach.Photo) {
          displayState = 'remote_loading';
        } else {
          displayState = 'remote';
        }
      }
      
      // Check for drawings/annotations
      const hasDrawings = !!attach.Drawings && attach.Drawings.length > 10;
      
      let annotatedDisplayUrl = displayUrl;
      if (hasDrawings && displayState !== 'remote_loading' && displayState !== 'remote') {
        try {
          const cachedAnnotatedImage = await this.indexedDb.getCachedAnnotatedImage(attachId);
          if (cachedAnnotatedImage) {
            annotatedDisplayUrl = cachedAnnotatedImage;
          }
        } catch (annotErr) {
          // Ignore
        }
      }
      
      const keyParts = key.split('_');
      const itemId = keyParts.length > 1 ? keyParts.slice(1).join('_') : key;
      const visualIdFromRecord = this.visualRecordIds[key];
      
      const photoData: any = {
        AttachID: attach.AttachID,
        attachId: attachId,
        id: attach.AttachID,
        VisualID: attach.VisualID || visualIdFromRecord || itemId,
        name: attach.Photo || 'photo.jpg',
        filePath: filePath,
        Photo: filePath,
        remoteS3Key: s3Key,
        displayState: displayState,
        url: imageUrl || displayUrl,
        originalUrl: imageUrl || displayUrl,
        thumbnailUrl: imageUrl || displayUrl,
        displayUrl: annotatedDisplayUrl,
        caption: attach.Annotation || '',
        annotation: attach.Annotation || '',
        Annotation: attach.Annotation || '',
        hasAnnotations: hasDrawings,
        Drawings: attach.Drawings || null,
        uploading: false,
        queued: false,
        isObjectUrl: false,
        isSkeleton: false,
        loading: displayState === 'remote_loading'
      };

      if (!this.visualPhotos[key]) {
        this.visualPhotos[key] = [];
      }

      const attachIdStr = String(attach.AttachID);
      const existingIndex = this.visualPhotos[key].findIndex(p => 
        String(p.AttachID) === attachIdStr || 
        String(p.id) === attachIdStr
      );
      
      if (existingIndex !== -1) {
        const existingPhoto = this.visualPhotos[key][existingIndex];
        if (displayState === 'remote_loading' && 
            existingPhoto.displayUrl && 
            existingPhoto.displayUrl !== 'assets/img/photo-placeholder.png') {
          photoData.displayUrl = existingPhoto.displayUrl;
          photoData.displayState = existingPhoto.displayState || 'cached';
        }
        this.visualPhotos[key][existingIndex] = photoData;
      } else {
        this.visualPhotos[key].push(photoData);
      }

      this.changeDetectorRef.detectChanges();
      
      if (displayState === 'remote_loading') {
        this.preloadAndTransition(attachId, s3Key || attach.Photo, key, !!s3Key).catch(err => {
          console.warn('[LOAD PHOTO] Preload failed for:', attachId, err);
        });
      }
      
      console.log('[LOAD PHOTO] Completed (legacy):', attachId, 'state:', displayState);
    } catch (err) {
      console.error('[LOAD PHOTO] Critical error loading photo:', attach?.AttachID, err);
    }
  }

  /**
   * Preload image from remote and transition UI only after success
   * Never updates displayUrl until image is verified loadable
   */
  private async preloadAndTransition(
    attachId: string, 
    imageKey: string, 
    key: string, 
    isS3: boolean
  ): Promise<void> {
    try {
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
        const visualId = String(result.VisualID || result.PK_ID || result.id);
        this.visualRecordIds[key] = visualId;
        console.log('[OPTION] Created visual:', visualId);
      } else if (!String(visualId).startsWith('temp_')) {
        // Update existing visual and unhide if it was hidden
        const notesValue = item.otherValue || '';
        await this.foundationData.updateVisual(visualId, {
          Answers: item.answer,
          Notes: notesValue
        }, this.serviceId);
        console.log('[OPTION] Updated visual:', visualId);
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
      let visualId = this.visualRecordIds[key];

      // If "Other" value is empty AND no options selected, hide the visual
      if ((!item.otherValue || item.otherValue === '') && (!item.answer || item.answer === '')) {
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
        const visualId = String(result.VisualID || result.PK_ID || result.id);
        this.visualRecordIds[key] = visualId;
        console.log('[OTHER] Created visual:', visualId);
      } else if (!String(visualId).startsWith('temp_')) {
        // Update existing visual and unhide if it was hidden
        await this.foundationData.updateVisual(visualId, {
          Notes: item.otherValue || '',
          Answers: item.answer || ''
        }, this.serviceId);
        console.log('[OTHER] Updated visual:', visualId);
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
  trackByPhotoId(index: number, photo: any): any {
    // Prefer stable imageId from new local-first system
    // Falls back to AttachID/id for legacy photos
    return photo.imageId || photo.AttachID || photo.id || index;
  }

  /**
   * Handle image load error - shows placeholder and marks for retry
   */
  handleImageError(event: any, photo: any) {
    console.error('Image failed to load:', photo);
    event.target.src = 'assets/img/photo-placeholder.png';
    
    // If this is a verified remote image that failed, mark for retry
    if (photo.imageId && photo.status === 'verified') {
      console.log('[IMAGE ERROR] Verified image failed to load, may need re-verification:', photo.imageId);
    }
  }

  /**
   * Handle successful image load - marks remote as loaded in UI
   * This enables safe blob pruning
   */
  handleImageLoad(event: any, photo: any) {
    // If this is a remote image (not local blob), mark as loaded in UI
    if (photo.imageId && !photo.isLocal && photo.status === 'verified') {
      this.localImageService.markRemoteLoadedInUI(photo.imageId).catch(err => {
        console.warn('[IMAGE LOAD] Failed to mark remote loaded:', err);
      });
    }
  }

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
          
          // Create LocalImage with stable UUID (this stores blob + creates outbox item)
          const localImage = await this.localImageService.captureImage(
            originalFile,
            'visual',
            String(visualId),
            this.serviceId,
            caption,
            compressedDrawings
          );
          
          console.log('[CAMERA UPLOAD] ✅ Created LocalImage with stable ID:', localImage.imageId);

          // Get display URL from LocalImageService (always uses local blob first)
          const displayUrl = await this.localImageService.getDisplayUrl(localImage);
          
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
            
            // Status from LocalImage system
            status: localImage.status,
            isLocal: true,
            isObjectUrl: true,
            uploading: false,
            queued: true,
            isPending: true,
            isSkeleton: false,
            progress: 0
          };

          // Add photo to UI immediately
          this.visualPhotos[key].push(photoEntry);
          this.changeDetectorRef.detectChanges();
          console.log('[CAMERA UPLOAD] ✅ Photo visible in UI with stable imageId:', localImage.imageId);

          // Cache annotated image for thumbnail persistence across navigation
          if (annotatedBlob && annotationsData) {
            try {
              const base64 = await this.indexedDb.cacheAnnotatedImage(localImage.imageId, annotatedBlob);
              console.log('[CAMERA UPLOAD] ✅ Annotated image cached for thumbnail persistence');
              if (base64) {
                this.bulkAnnotatedImagesMap.set(localImage.imageId, base64);
              }
            } catch (cacheErr) {
              console.warn('[CAMERA UPLOAD] Failed to cache annotated image:', cacheErr);
            }
          }

          // Sync will happen on next 60-second interval via upload outbox
        }

        // Clean up blob URL
        URL.revokeObjectURL(imageUrl);
      }
    } catch (error) {
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
      const images = await Camera.pickImages({
        quality: 90,
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
        // NEW LOCAL-FIRST IMAGE SYSTEM
        // Uses stable UUID that NEVER changes
        // ============================================

        // Process each photo with LocalImageService
        for (let i = 0; i < images.photos.length; i++) {
          const image = images.photos[i];

          if (image.webPath) {
            try {
              console.log(`[GALLERY UPLOAD] Processing photo ${i + 1}/${images.photos.length}`);

              // Fetch the blob
              const response = await fetch(image.webPath);
              const blob = await response.blob();
              const file = new File([blob], `gallery-${Date.now()}_${i}.jpg`, { type: 'image/jpeg' });

              // Create LocalImage with stable UUID
              const localImage = await this.localImageService.captureImage(
                file,
                'visual',
                String(visualId),
                this.serviceId,
                '', // caption
                ''  // drawings
              );
              
              console.log(`[GALLERY UPLOAD] ✅ Created LocalImage ${i + 1} with stable ID:`, localImage.imageId);

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
                
                // Status from LocalImage system
                status: localImage.status,
                isLocal: true,
                isObjectUrl: true,
                uploading: false,
                queued: true,
                isPending: true,
                isSkeleton: false,
                progress: 0
              };

              // Add photo to UI immediately
              this.visualPhotos[key].push(photoEntry);
              this.changeDetectorRef.detectChanges();
              console.log(`[GALLERY UPLOAD] ✅ Photo ${i + 1} visible in UI with stable imageId`);

            } catch (error) {
              console.error(`[GALLERY UPLOAD] Error processing photo ${i + 1}:`, error);
            }
          }
        }

        console.log(`[GALLERY UPLOAD] ✅ All ${images.photos.length} photos processed with stable IDs`);
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
    const compressedPhoto = await this.imageCompression.compressImage(photo, {
      maxSizeMB: 0.8,
      maxWidthOrHeight: 1280,
      useWebWorker: true
    }) as File;

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
      console.log(`[PHOTO UPLOAD] Starting upload for VisualID ${visualId}`);

      // CRITICAL: Pass annotations as serialized JSON string (drawings)
      const drawings = annotationData ? JSON.stringify(annotationData) : '';
      const result = await this.foundationData.uploadVisualPhoto(visualId, photo, caption, drawings, originalPhoto || undefined);

      console.log(`[PHOTO UPLOAD] Upload complete for VisualID ${visualId}, AttachID: ${result.AttachID}`);

      if (tempId && this.visualPhotos[key]) {
        const photoIndex = this.visualPhotos[key].findIndex(p => p.AttachID === tempId || p.id === tempId);
        if (photoIndex !== -1) {
          const oldUrl = this.visualPhotos[key][photoIndex].url;
          if (oldUrl && oldUrl.startsWith('blob:')) {
            URL.revokeObjectURL(oldUrl);
          }

          // CRITICAL: Get the uploaded photo URL from the result
          const actualResult = result.Result && result.Result[0] ? result.Result[0] : result;
          const s3Key = actualResult.Attachment; // S3 key
          const uploadedPhotoUrl = actualResult.Photo || actualResult.thumbnailUrl || actualResult.url;
          let displayableUrl = uploadedPhotoUrl || '';

          console.log('[PHOTO UPLOAD] Actual result:', actualResult);
          console.log('[PHOTO UPLOAD] S3 key:', s3Key);
          console.log('[PHOTO UPLOAD] Uploaded photo path (old):', uploadedPhotoUrl);

          // Check if this is an S3 image
          if (s3Key && this.caspioService.isS3Key(s3Key)) {
            try {
              console.log('[PHOTO UPLOAD] ✨ S3 image detected, fetching pre-signed URL...');
              displayableUrl = await this.caspioService.getS3FileUrl(s3Key);
              console.log('[PHOTO UPLOAD] ✅ Got S3 pre-signed URL');
            } catch (err) {
              console.error('[PHOTO UPLOAD] ❌ Failed to fetch S3 URL:', err);
              displayableUrl = 'assets/img/photo-placeholder.png';
            }
          }
          // Fallback to old Caspio Files API logic
          else if (uploadedPhotoUrl && !uploadedPhotoUrl.startsWith('data:') && !uploadedPhotoUrl.startsWith('blob:')) {
            try {
              console.log('[PHOTO UPLOAD] 📁 Caspio Files API path detected, fetching image data...');
              const imageData = await firstValueFrom(
                this.caspioService.getImageFromFilesAPI(uploadedPhotoUrl)
              );
              if (imageData && imageData.startsWith('data:')) {
                displayableUrl = imageData;
                console.log('[PHOTO UPLOAD] ✅ Successfully converted to data URL, length:', imageData.length);
              } else {
                console.warn('[PHOTO UPLOAD] ❌ Files API returned invalid data:', imageData?.substring(0, 50));
              }
            } catch (err) {
              console.error('[PHOTO UPLOAD] ❌ Failed to load uploaded image:', err);
              displayableUrl = 'assets/img/photo-placeholder.png';
            }
          } else {
            console.log('[PHOTO UPLOAD] Using URL directly (already data/blob URL):', uploadedPhotoUrl?.substring(0, 50));
          }

          console.log('[PHOTO UPLOAD] Updating photo object at index', photoIndex, 'with displayableUrl length:', displayableUrl?.length || 0);

          this.visualPhotos[key][photoIndex] = {
            ...this.visualPhotos[key][photoIndex],
            AttachID: result.AttachID,
            id: result.AttachID,
            // CRITICAL FIX: Clear temp flags to prevent reloadVisualsAfterSync from matching this photo as "temp"
            _tempId: undefined,
            _pendingFileId: undefined,
            _backgroundSync: undefined,
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

      // If temp photo, get from IndexedDB and use it instead of fetching
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
                // Update thumbnailUrl if it was a placeholder or blob URL
                thumbnailUrl: (currentPhoto.thumbnailUrl &&
                              !currentPhoto.thumbnailUrl.startsWith('blob:') &&
                              currentPhoto.thumbnailUrl !== 'assets/img/photo-placeholder.png')
                              ? currentPhoto.thumbnailUrl
                              : currentPhoto.url,
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
          const EMPTY_COMPRESSED_ANNOTATIONS = 'H4sIAAAAAAAAA6tWKkktLlGyUlAqS8wpTtVRKi1OLYrPTFGyUqoFAJRGGIYcAAAA';
          drawingsData = compressAnnotationData(drawingsData, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });

          console.log(`[SAVE] Compressed annotations: ${originalSize} â†’ ${drawingsData.length} bytes`);

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
        // Empty annotations
        updateData.Drawings = 'H4sIAAAAAAAAA6tWKkktLlGyUlAqS8wpTtVRKi1OLYrPTFGyUqoFAJRGGIYcAAAA';
      }
    } else {
      // No annotations provided
      updateData.Drawings = 'H4sIAAAAAAAAA6tWKkktLlGyUlAqS8wpTtVRKi1OLYrPTFGyUqoFAJRGGIYcAAAA';
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
    try {
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

    // ALWAYS queue the annotation update using unified method
    // This ensures annotations are never lost during sync operations
    await this.foundationData.queueCaptionAndAnnotationUpdate(
      attachId,
      caption || '',
      updateData.Drawings,
      'visual',
      {
        serviceId: this.serviceId,
        visualId: visualIdForCache || undefined
      }
    );
    console.log('[SAVE] ✅ Annotation queued for sync:', attachId);

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

          // Delete from database (or queue for sync if offline)
          if (photo.AttachID && !String(photo.AttachID).startsWith('temp_')) {
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
              const attachId = String(photo._pendingFileId || photo.attachId || photo.AttachID || '');
              const visualId = photo.VisualID || this.visualRecordIds[`${category}_${itemId}`] || String(itemId);
              
              photo._localUpdate = true; // Mark as local update to prevent server overwriting
              
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

      // Add to local data structure (must match loadExistingVisuals structure)
      const customItem: VisualItem = {
        id: `custom_${visualId}`, // Use consistent ID format with prefix
        templateId: 0, // No template for custom visuals
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

      // Add to appropriate array based on Kind
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

      // Store the visual ID for photo uploads using consistent key
      const key = `${category}_${customItem.id}`;
      this.visualRecordIds[key] = String(visualId);

      // Mark as selected
      this.selectedItems[key] = true;

      console.log('[CREATE CUSTOM] Stored visualId in visualRecordIds:', key, '=', visualId);

      // Upload photos if provided
      if (files && files.length > 0) {
        console.log('[CREATE CUSTOM] Uploading', files.length, 'photos for visual:', visualId);

        // Initialize photos array if not exists
        if (!this.visualPhotos[key]) {
          this.visualPhotos[key] = [];
        }

        // Add placeholder photos immediately so user sees them uploading
        const tempPhotos = Array.from(files).map((file, index) => {
          const photoData = processedPhotos[index] || {};
          const objectUrl = URL.createObjectURL(file);
          const tempId = `temp_${Date.now()}_${index}`;

          return {
            AttachID: tempId,
            id: tempId,
            name: file.name,
            url: objectUrl,
            thumbnailUrl: objectUrl,
            displayUrl: photoData.previewUrl || objectUrl, // Use preview from modal if available
            isObjectUrl: true,
            uploading: true,
            hasAnnotations: !!photoData.annotationData,
            annotations: photoData.annotationData || null,
            caption: photoData.caption || '',
            annotation: photoData.caption || ''
          };
        });

        // Add all temp photos to the array at once
        this.visualPhotos[key].push(...tempPhotos);

        // Trigger change detection so photos show immediately
        this.changeDetectorRef.detectChanges();

        console.log('[CREATE CUSTOM] Added', tempPhotos.length, 'placeholder photos to UI');

        // Upload photos in background with annotation data
        const uploadPromises = Array.from(files).map(async (file, index) => {
          const tempId = tempPhotos[index].AttachID;
          try {
            // Get annotation data and caption for this photo from processedPhotos
            const photoData = processedPhotos[index] || {};
            const annotationData = photoData.annotationData || null;
            const originalFile = photoData.originalFile || null;
            const caption = photoData.caption || '';

            console.log(`[CREATE CUSTOM] Uploading photo ${index + 1}:`, {
              hasAnnotations: !!annotationData,
              hasOriginalFile: !!originalFile,
              caption: caption
            });

            // Upload the ORIGINAL photo (without annotations baked in)
            // If we have an originalFile, use that; otherwise use the file as-is
            const fileToUpload = originalFile || file;
            
            // CRITICAL FIX: Handle temp VisualIDs correctly
            // If visualId is a temp ID (starts with 'temp_'), pass it as string
            // Otherwise, parse it as integer for API compatibility
            const isTempVisualId = String(visualId).startsWith('temp_');
            const visualIdForUpload = isTempVisualId ? visualId! : parseInt(visualId!, 10);
            
            console.log(`[CREATE CUSTOM] Uploading photo with VisualID:`, visualIdForUpload, 'isTemp:', isTempVisualId);
            
            // CRITICAL: Pass annotations as serialized JSON string (drawings) and original file
            const drawings = annotationData ? JSON.stringify(annotationData) : '';
            const result = await this.foundationData.uploadVisualPhoto(visualIdForUpload, fileToUpload, caption, drawings, originalFile || undefined);
            const attachId = result?.AttachID || result?.PK_ID || result?.id;

            if (!attachId) {
              console.error(`[CREATE CUSTOM] No AttachID returned for photo ${index + 1}`);
              // Mark this photo as failed
              const photoIndex = this.visualPhotos[key]?.findIndex(p => p.AttachID === tempId);
              if (photoIndex !== -1 && this.visualPhotos[key]) {
                this.visualPhotos[key][photoIndex].uploading = false;
                this.visualPhotos[key][photoIndex].uploadFailed = true;
                this.changeDetectorRef.detectChanges();
              }
              return { success: false, error: new Error('No AttachID returned') };
            }

            console.log(`[CREATE CUSTOM] Photo ${index + 1} uploaded with AttachID:`, attachId);

            // If there are annotations, save them to the database
            if (annotationData) {
              try {
                console.log(`[CREATE CUSTOM] Saving annotations for photo ${index + 1}`);

                // Use the annotated file as the blob (file contains the annotated version)
                // The originalFile is what we uploaded, file is the one with annotations baked in
                const annotatedBlob = file instanceof Blob ? file : new Blob([file]);

                await this.saveAnnotationToDatabase(attachId, annotatedBlob, annotationData, caption);
                console.log(`[CREATE CUSTOM] Annotations saved for photo ${index + 1}`);
              } catch (annotError) {
                console.error(`[CREATE CUSTOM] Failed to save annotations for photo ${index + 1}:`, annotError);
                // Don't fail the whole upload if just annotations fail
              }
            }

            // Mark this specific photo as done uploading
            const photoIndex = this.visualPhotos[key]?.findIndex(p => p.AttachID === tempId);
            if (photoIndex !== -1 && this.visualPhotos[key]) {
              this.visualPhotos[key][photoIndex].uploading = false;
              this.visualPhotos[key][photoIndex].AttachID = attachId;
              this.visualPhotos[key][photoIndex].id = attachId;
              this.changeDetectorRef.detectChanges();
              console.log(`[CREATE CUSTOM] Photo ${index + 1} upload complete, UI updated`);
            }

            return { success: true, error: null };
          } catch (error: any) {
            console.error(`Failed to upload file ${index + 1}:`, error);
            // Mark this photo as failed
            const photoIndex = this.visualPhotos[key]?.findIndex(p => p.AttachID === tempId);
            if (photoIndex !== -1 && this.visualPhotos[key]) {
              this.visualPhotos[key][photoIndex].uploading = false;
              this.visualPhotos[key][photoIndex].uploadFailed = true;
              this.changeDetectorRef.detectChanges();
            }
            return { success: false, error };
          }
        });

        // Monitor uploads in background
        Promise.all(uploadPromises).then(results => {
          const uploadSuccessCount = results.filter((r: { success: boolean }) => r.success).length;
          const failCount = results.filter((r: { success: boolean }) => !r.success).length;

          if (failCount > 0 && uploadSuccessCount > 0) {
            this.showToast(
              `Uploaded ${uploadSuccessCount} of ${files.length} photos. ${failCount} failed.`,
              'warning'
            );
          } else if (failCount > 0 && uploadSuccessCount === 0) {
            this.showToast('Failed to upload photos', 'danger');
          }

          // Reload photos from database to get full data with annotations
          // Small delay to ensure database has processed all uploads
          setTimeout(() => {
            console.log('[CREATE CUSTOM] Reloading photos after upload delay');

            // Clean up temp blob URLs before reloading
            if (this.visualPhotos[key]) {
              this.visualPhotos[key].forEach(photo => {
                if (photo.isObjectUrl && photo.url) {
                  URL.revokeObjectURL(photo.url);
                }
                if (photo.isObjectUrl && photo.thumbnailUrl && photo.thumbnailUrl !== photo.url) {
                  URL.revokeObjectURL(photo.thumbnailUrl);
                }
              });
            }

            this.loadPhotosForVisual(visualId!, key);
          }, 500);
        });
      }

      // Trigger change detection
      this.changeDetectorRef.detectChanges();

      return {
        itemId: customItem.id,
        visualId: String(visualId),
        key: key
      };

    } catch (error: any) {
      console.error('[CREATE CUSTOM] Error creating custom visual:', error);
      const errorMsg = error?.error?.Message || error?.message || 'Failed to add visual';
      // Toast removed per user request
      // await this.showToast(errorMsg, 'danger');
      return null;
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
            // Validate required fields (only check description since title is read-only)
            if (item.required && !data.description) {
              // Toast removed per user request
              // await this.showToast('Please fill in the description field', 'warning');
              return false;
            }

            // Update the item text if changed (name is read-only)
            if (data.description !== item.text) {
              const oldText = item.text;

              item.text = data.description;

              // Save to database if this visual is already created
              const key = `${item.category}_${item.id}`;
              const visualId = this.visualRecordIds[key];

              if (visualId && !String(visualId).startsWith('temp_')) {
                try {
                  // Only update the Text field (Name must stay constant for matching)
                  await this.foundationData.updateVisual(visualId, {
                    Text: data.description
                  }, this.serviceId);
                  console.log('[TEXT EDIT] Updated visual text:', visualId);
                  this.changeDetectorRef.detectChanges();
                } catch (error) {
                  console.error('[TEXT EDIT] Error updating visual:', error);
                  // Revert changes on error
                  item.text = oldText;
                  // Toast removed per user request
                  // await this.showToast('Failed to save changes', 'danger');
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

  highlightText(text: string | undefined): string {
    if (!text || !this.searchTerm || this.searchTerm.trim() === '') {
      return text || '';
    }

    const term = this.searchTerm.trim();
    // Create a case-insensitive regex to find all matches
    const regex = new RegExp(`(${this.escapeRegex(term)})`, 'gi');

    // Replace matches with highlighted span
    return text.replace(regex, '<span class="highlight">$1</span>');
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
      
      console.log('[CACHE] âœ“ PDF cache cleared - next PDF will fetch fresh data');
    } catch (error) {
      console.error('[CACHE] Error clearing PDF cache:', error);
    }
  }
}
