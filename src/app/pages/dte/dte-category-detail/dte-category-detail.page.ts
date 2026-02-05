import { Component, OnInit, ChangeDetectorRef, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController, AlertController, ActionSheetController, ModalController, IonContent, ViewWillEnter } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import { CaspioService } from '../../../services/caspio.service';
import { OfflineService } from '../../../services/offline.service';
import { CameraService } from '../../../services/camera.service';
import { ImageCompressionService } from '../../../services/image-compression.service';
import { CacheService } from '../../../services/cache.service';
import { DteDataService } from '../dte-data.service';
import { FabricPhotoAnnotatorComponent } from '../../../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { BackgroundPhotoUploadService } from '../../../services/background-photo-upload.service';
import { IndexedDbService } from '../../../services/indexed-db.service';
import { BackgroundSyncService } from '../../../services/background-sync.service';
import { LocalImageService } from '../../../services/local-image.service';
import { environment } from '../../../../environments/environment';
import { renderAnnotationsOnPhoto } from '../../../utils/annotation-utils';
import { db } from '../../../services/caspio-db';
import { VisualFieldRepoService } from '../../../services/visual-field-repo.service';
import { PhotoHandlerService, PhotoCaptureConfig, StandardPhotoEntry } from '../../../services/photo-handler.service';
import {
  AccordionStateService,
  SearchFilterService,
  MultiSelectService,
  PhotoUIService,
  VisualSelectionService,
  VisualItem as SharedVisualItem
} from '../../../services/template-ui';

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
  selector: 'app-dte-category-detail',
  templateUrl: './dte-category-detail.page.html',
  styleUrls: ['./dte-category-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class DteCategoryDetailPage implements OnInit, OnDestroy, ViewWillEnter {
  projectId: string = '';
  serviceId: string = '';
  categoryName: string = '';

  // Webapp detection for conditional rendering
  isWeb: boolean = environment.isWeb;

  loading: boolean = false;  // Start false - show cached data instantly, only show spinner if cache empty
  isRefreshing: boolean = false;  // Track background refresh status
  searchTerm: string = '';
  expandedAccordions: string[] = ['information', 'limitations', 'deficiencies']; // Start expanded like HUD
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
  expandedPhotos: { [key: string]: boolean } = {};
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
    private hudData: DteDataService,
    private backgroundUploadService: BackgroundPhotoUploadService,
    private cache: CacheService,
    private indexedDb: IndexedDbService,
    private backgroundSync: BackgroundSyncService,
    private localImageService: LocalImageService,
    private visualFieldRepo: VisualFieldRepoService,
    private photoHandler: PhotoHandlerService,
    // Template UI Services (consolidated from duplicated code)
    private accordionStateService: AccordionStateService,
    private searchFilterService: SearchFilterService,
    private multiSelectService: MultiSelectService,
    private photoUIService: PhotoUIService,
    private visualSelectionService: VisualSelectionService
  ) {}

  async ngOnInit() {
    // Subscribe to background upload task updates
    this.subscribeToUploadUpdates();

    // Get category name from route params using snapshot (for reliability)
    // CRITICAL: Decode URL-encoded category names for proper matching
    const rawCategory = this.route.snapshot.params['category'];
    this.categoryName = rawCategory ? decodeURIComponent(rawCategory) : '';

    // Get IDs from container route using snapshot
    // DTE route structure: 'dte/:projectId/:serviceId' (Container) -> 'category/:category' (we are here)
    // So parent has :projectId/:serviceId directly
    let containerParams = this.route.parent?.snapshot?.params;

    if (containerParams) {
      this.projectId = containerParams['projectId'];
      this.serviceId = containerParams['serviceId'];
    }

    // Fallback: Try parent?.parent for alternate route structures
    if (!this.projectId || !this.serviceId) {
      containerParams = this.route.parent?.parent?.snapshot?.params;
      if (containerParams) {
        this.projectId = this.projectId || containerParams['projectId'];
        this.serviceId = this.serviceId || containerParams['serviceId'];
      }
    }


    if (this.projectId && this.serviceId && this.categoryName) {
      this.loadData();
    } else {
      console.error('[DTE CategoryDetail] Missing required route params');
      this.loading = false;
    }
  }

  async ionViewWillEnter() {
    // WEBAPP: Reload data when returning to this page
    // This ensures photos and title/text edits made in visual-detail show here
    if (environment.isWeb && this.serviceId && this.categoryName) {
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

      // CRITICAL: Refresh annotated image URLs after loading photos
      // This ensures annotations added in visual-detail show in category-detail thumbnails
      await this.refreshAnnotatedImageUrls();

      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * Refresh annotated image URLs for photos that have annotations
   * This ensures thumbnails show the annotated version, not the base image
   * CRITICAL: Called on ionViewWillEnter to sync annotations from visual-detail page
   */
  private async refreshAnnotatedImageUrls(): Promise<void> {
    // First, refresh the bulkAnnotatedImagesMap from IndexedDB
    const annotatedImages = await this.indexedDb.getAllCachedAnnotatedImagesForService();
    this.bulkAnnotatedImagesMap = annotatedImages;


    // Update in-memory photos with annotated image URLs
    for (const [key, photos] of Object.entries(this.visualPhotos)) {
      for (const photo of photos as any[]) {
        // Check if this photo has annotations confirmed (from server or prior marking)
        // IMPORTANT: Only apply cached annotations if photo is already marked as having annotations
        // This prevents stale cache (from old deleted photos) from being applied to new photos
        const hasConfirmedAnnotations = photo.hasAnnotations || (photo.Drawings && photo.Drawings.length > 10);

        if (!hasConfirmedAnnotations) continue; // Skip photos without confirmed annotations

        // Try to find cached annotated image by various IDs
        const attachId = photo.AttachID || photo.attachId || photo.id || '';
        const localImageId = photo.localImageId || photo.imageId;

        let annotatedImage = this.bulkAnnotatedImagesMap.get(attachId);
        if (!annotatedImage && localImageId) {
          annotatedImage = this.bulkAnnotatedImagesMap.get(localImageId);
        }

        // If found cached annotated image for a photo with confirmed annotations, use it
        if (annotatedImage) {
          photo.displayUrl = annotatedImage;
          photo.thumbnailUrl = annotatedImage;
          // Keep photo.url as original for re-editing
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
  }

  /**
   * Subscribe to background upload updates
   */
  private subscribeToUploadUpdates() {
    this.taskSubscription = this.backgroundUploadService.getTaskUpdates().subscribe(task => {
      if (!task) return;


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

    // Subscribe to background sync photo upload completions
    // This handles the case where photos are uploaded via IndexedDB queue (offline -> online)
    this.photoSyncSubscription = this.backgroundSync.photoUploadComplete$.subscribe(async (event) => {

      // Find the photo in our visualPhotos by temp file ID
      for (const key of Object.keys(this.visualPhotos)) {
        const photoIndex = this.visualPhotos[key].findIndex(p =>
          p.AttachID === event.tempFileId ||
          p._pendingFileId === event.tempFileId ||
          p.id === event.tempFileId
        );

        if (photoIndex !== -1) {

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
  }

  /**
   * Update photo object after successful upload
   */
  private async updatePhotoAfterUpload(key: string, photoIndex: number, result: any, caption: string) {

    // Handle both direct result and Result array format
    const actualResult = result.Result && result.Result[0] ? result.Result[0] : result;
    const s3Key = actualResult.Attachment;
    const uploadedPhotoUrl = actualResult.Photo || actualResult.thumbnailUrl || actualResult.url;
    let displayableUrl = uploadedPhotoUrl || '';


    // Check if this is an S3 image
    if (s3Key && this.caspioService.isS3Key(s3Key)) {
      try {
        displayableUrl = await this.caspioService.getS3FileUrl(s3Key);
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
    }


    // Get AttachID from the actual result
    const attachId = actualResult.AttachID || actualResult.PK_ID || actualResult.id;

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

    
    this.changeDetectorRef.detectChanges();
  }

  private async loadData() {

    try {
      // STEP 1: Check if we have cached visuals data - if so, skip loading spinner
      const cachedVisuals = await this.indexedDb.getCachedServiceData(this.serviceId, 'visuals');
      const hasCachedData = cachedVisuals && cachedVisuals.length > 0;

      if (hasCachedData) {
        // Don't show loading spinner - display cached data immediately
        this.loading = false;
      } else {
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
      await this.loadAllDropdownOptions();

      // Load templates for this category
      await this.loadCategoryTemplates();

      // Load existing visuals - use cache for instant display, background refresh for freshness
      await this.loadExistingVisuals(!!hasCachedData);

      // Restore any pending photos from IndexedDB (offline uploads)
      await this.restorePendingPhotosFromIndexedDB();


      // Ensure all sections are expanded after loading
      this.expandedAccordions = ['information', 'limitations', 'deficiencies'];

      // Hide loading spinner (if it was shown)
      this.loading = false;
      this.changeDetectorRef.detectChanges();

    } catch (error) {
      console.error('[LOAD DATA] ❌ Error loading category data:', error);
      this.loading = false;
    }
  }

  private async loadCategoryTemplates() {
    try {
      // Get all DTE templates for this category
      const allTemplates = await this.caspioService.getServicesDTETemplates().toPromise();
      const hudTemplates = (allTemplates || []).filter((template: any) =>
        template.Category === this.categoryName
      );


      // CRITICAL: Sort templates by OrderID to ensure correct display order
      hudTemplates.sort((a: any, b: any) => {
        const orderA = a.OrderID || 0;
        const orderB = b.OrderID || 0;
        return orderA - orderB;
      });


      // Organize templates by Kind (Type field in HUD is called "Kind")
      hudTemplates.forEach((template: any) => {
        // Log the Kind value to debug

        const templateData: VisualItem = {
          id: template.PK_ID,
          templateId: template.TemplateID || template.PK_ID,  // Use TemplateID field, fallback to PK_ID
          name: template.Name || 'Unnamed Item',
          text: template.Text || '',
          originalText: template.Text || '',
          type: template.Kind || template.Type || 'Comment',  // Try Kind first, then Type
          category: template.Category || this.categoryName,
          answerType: template.AnswerType || 0,
          required: template.Required === 'Yes',
          answer: '',
          isSelected: false,
          photos: []
        };

        // Add to appropriate array based on Kind or Type
        const kind = template.Kind || template.Type || 'Comment';
        const kindLower = kind.toLowerCase().trim();
        

        if (kindLower === 'limitation' || kindLower === 'limitations') {
          this.organizedData.limitations.push(templateData);
        } else if (kindLower === 'deficiency' || kindLower === 'deficiencies') {
          this.organizedData.deficiencies.push(templateData);
        } else {
          this.organizedData.comments.push(templateData);
        }

        // Note: Dropdown options are already loaded via loadAllDropdownOptions()
        // No need to load them individually here
      });


    } catch (error) {
      console.error('Error loading category templates:', error);
    }
  }

  /**
   * Load all dropdown options from Services_DTE_Drop table
   * This loads all options upfront and groups them by TemplateID
   * WEBAPP FIX: Also merges custom options from Dexie visualFields
   */
  private async loadAllDropdownOptions() {
    try {
      const dropdownData = await firstValueFrom(
        this.caspioService.getServicesDTEDrop()
      );


      if (dropdownData && dropdownData.length > 0) {
        // Group dropdown options by TemplateID
        dropdownData.forEach((row: any) => {
          const templateId = String(row.TemplateID); // Convert to string for consistency
          const dropdownValue = row.Dropdown;

          if (templateId && dropdownValue) {
            if (!this.visualDropdownOptions[templateId]) {
              this.visualDropdownOptions[templateId] = [];
            }
            // Add unique dropdown values for this template (excluding None/Other which we add at end)
            if (!this.visualDropdownOptions[templateId].includes(dropdownValue) &&
                dropdownValue !== 'None' && dropdownValue !== 'Other') {
              this.visualDropdownOptions[templateId].push(dropdownValue);
            }
          }
        });


        // WEBAPP FIX: Merge custom options from Dexie visualFields
        // Custom options added via "Other" are saved to Dexie and need to be merged here
        try {
          const dexieFields = await this.visualFieldRepo.getFieldsForCategory(
            this.serviceId,
            this.categoryName
          );

          for (const field of dexieFields) {
            if (field.dropdownOptions && field.dropdownOptions.length > 0) {
              const templateId = String(field.templateId);
              if (!this.visualDropdownOptions[templateId]) {
                this.visualDropdownOptions[templateId] = [];
              }
              // Merge custom options from Dexie (excluding None/Other)
              for (const opt of field.dropdownOptions) {
                if (opt !== 'None' && opt !== 'Other' &&
                    !this.visualDropdownOptions[templateId].includes(opt)) {
                  this.visualDropdownOptions[templateId].push(opt);
                }
              }
            }
          }
        } catch (dexieError) {
          console.warn('[DTE Category] WEBAPP: Could not load custom options from Dexie:', dexieError);
        }

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

      } else {
        console.warn('[DTE Category] No dropdown data received from API');

        // WEBAPP FIX: Even without API data, still load custom options from Dexie
        try {
          const dexieFields = await this.visualFieldRepo.getFieldsForCategory(
            this.serviceId,
            this.categoryName
          );

          for (const field of dexieFields) {
            if (field.dropdownOptions && field.dropdownOptions.length > 0) {
              const templateId = String(field.templateId);
              if (!this.visualDropdownOptions[templateId]) {
                this.visualDropdownOptions[templateId] = [];
              }
              // Merge custom options from Dexie
              for (const opt of field.dropdownOptions) {
                if (!this.visualDropdownOptions[templateId].includes(opt)) {
                  this.visualDropdownOptions[templateId].push(opt);
                }
              }
            }
          }
          this.changeDetectorRef.detectChanges();
        } catch (dexieError) {
          console.warn('[DTE Category] WEBAPP: Could not load custom options from Dexie:', dexieError);
        }
      }
    } catch (error) {
      console.error('[DTE Category] Error loading dropdown options:', error);
      // Continue without dropdown options - they're optional
    }
  }

  private async loadExistingVisuals(useCacheFirst: boolean = false) {
    try {
      // Load all existing HUD visuals for this service and category

      // CACHE-FIRST PATTERN: Use cached data for instant display, then refresh in background
      // If useCacheFirst is true, we use cache (bypassCache=false) and trigger background refresh
      // If useCacheFirst is false (cache was empty), we do a blocking API call
      const allVisuals = await this.hudData.getVisualsByService(this.serviceId, !useCacheFirst);

      // If we used cache, schedule a background refresh for freshness
      if (useCacheFirst && this.offlineService.isOnline()) {
        this.triggerBackgroundRefresh();
      }

      
      const categoryVisuals = allVisuals.filter((v: any) => v.Category === this.categoryName);

      if (categoryVisuals.length > 0) {
      }

      // WEBAPP API-FIRST: Save existing in-memory mappings before reload
      // This allows matching visuals even when Name has been edited (the mapping persists in memory)
      const existingMappings = environment.isWeb ? new Map(Object.entries(this.visualRecordIds)) : null;
      if (environment.isWeb) {
      }

      // Get all available template items
      const allItems = [
        ...this.organizedData.comments,
        ...this.organizedData.limitations,
        ...this.organizedData.deficiencies
      ];

      for (const visual of categoryVisuals) {

        // CRITICAL: Skip hidden visuals (soft delete - keeps photos but doesn't show in UI)
        if (visual.Notes && visual.Notes.startsWith('HIDDEN')) {

          // Store visualRecordId so we can unhide it later if user reselects
          // CRITICAL: Only store if visual's category matches current category
          if (visual.Category === this.categoryName) {
            const DTEID = String(visual.DTEID || visual.PK_ID);
            let item: VisualItem | undefined = undefined;

            // WEBAPP API-FIRST: Check existing in-memory mapping first
            if (environment.isWeb && existingMappings && existingMappings.size > 0) {
              for (const [key, storedDteId] of existingMappings.entries()) {
                if (storedDteId === DTEID) {
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
              this.visualRecordIds[key] = DTEID;
            }
          }
          continue;
        }

        const name = visual.Name;
        const kind = visual.Kind;
        const DTEID = String(visual.DTEID || visual.PK_ID || visual.id);

        // Find the item - WEBAPP uses in-memory mappings, then falls back to Name
        let item: VisualItem | undefined = undefined;

        // WEBAPP API-FIRST PRIORITY 1: Check existing in-memory mapping
        // This ensures visual stays matched even after Name is edited
        if (environment.isWeb && existingMappings && existingMappings.size > 0) {
          for (const [key, storedDteId] of existingMappings.entries()) {
            if (storedDteId === DTEID) {
              // Find the template item that matches this key
              item = allItems.find(i => {
                const itemKey = `${this.categoryName}_${i.id}`;
                return itemKey === key;
              });
              if (item) {
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
          }
        } else if (!item && visual.Category !== this.categoryName) {
        }

        // PRIORITY 3: Match by TemplateID (handles case where Name was edited in visual-detail)
        // This is critical when component is recreated (in-memory mappings lost) and Name changed
        if (!item && environment.isWeb && visual.Category === this.categoryName) {
          const visualTemplateId = visual.DTETemplateID || visual.VisualTemplateID || visual.TemplateID || visual.FK_Template;
          if (visualTemplateId) {
            item = allItems.find(i => String(i.templateId) === String(visualTemplateId));
            if (item) {
            }
          }
        }

        // If no template match found, this is a CUSTOM visual - create dynamic item
        if (!item) {

          // Create a dynamic VisualItem for custom visuals
          const customItem: VisualItem = {
            id: `custom_${DTEID}`,
            templateId: 0,
            name: visual.Name,
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
        } else {
        }

        const key = `${this.categoryName}_${item.id}`;


        // Mark as selected
        this.selectedItems[key] = true;

        // Store visual record ID
        this.visualRecordIds[key] = DTEID;

        // Update item with saved answer
        item.answer = visual.Answers || '';
        item.otherValue = visual.OtherValue || '';

        // WEBAPP FIX: Update name and text from server if edited in visual-detail
        // Server is source of truth for WEBAPP mode
        if (environment.isWeb) {
          if (visual.Name && visual.Name !== item.name) {
            item.name = visual.Name;
          }
          if (visual.Text && visual.Text !== item.text) {
            item.text = visual.Text;
          }
        }

        // Force change detection to update UI
        this.changeDetectorRef.detectChanges();

        // MOBILE MODE: Load photos for this visual individually
        if (!environment.isWeb) {
          await this.loadPhotosForVisual(DTEID, key);
        }
      }

      // WEBAPP MODE: Load all photos from API in one batch with signed URLs
      // This ensures photos are loaded synchronously before the page renders
      if (environment.isWeb) {
        await this.loadPhotosFromAPI();
      }


    } catch (error) {
      console.error('[LOAD EXISTING] ❌ Error loading existing visuals:', error);
    }
  }

  /**
   * Trigger a background refresh to update cached data without blocking the UI
   * This ensures data stays fresh while providing instant page loads
   */
  private triggerBackgroundRefresh(): void {
    this.isRefreshing = true;

    // Use setTimeout to ensure this runs after the current render cycle
    setTimeout(async () => {
      try {

        // Fetch fresh data from API (bypass cache)
        const freshVisuals = await this.hudData.getVisualsByService(this.serviceId, true);

        // Cache the fresh data in IndexedDB for future instant loads
        await this.indexedDb.cacheServiceData(this.serviceId, 'visuals', freshVisuals);

        // Update UI with fresh data (preserving photos that are uploading)
        const categoryVisuals = freshVisuals.filter((v: any) => v.Category === this.categoryName);
        await this.processVisualsUpdate(categoryVisuals);

        this.isRefreshing = false;
        this.changeDetectorRef.detectChanges();
      } catch (error) {
        console.error('[BACKGROUND REFRESH] ❌ Error during background refresh:', error);
        this.isRefreshing = false;
      }
    }, 100);
  }

  /**
   * Process visual updates from background refresh without losing upload state
   * WEBAPP FIX: Use DTEID-first matching to prevent mismatch when titles are edited
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

      const DTEID = String(visual.DTEID || visual.PK_ID || visual.id);
      let item: VisualItem | undefined = undefined;

      // WEBAPP FIX: PRIORITY 1 - Find item by DTEID using existing visualRecordIds mapping
      // This ensures we match the CORRECT item even after title/name edits
      // (Previous code used name matching which broke when titles were changed to match template names)
      for (const [key, storedDteId] of Object.entries(this.visualRecordIds)) {
        if (String(storedDteId) === DTEID) {
          // Found existing mapping - find the item that matches this key
          item = allItems.find(i => `${this.categoryName}_${i.id}` === key);
          if (item) {
          }
          break;
        }
      }

      // PRIORITY 2: Fall back to name matching if no existing DTEID mapping
      if (!item) {
        item = allItems.find(i => i.name === visual.Name);
        if (item) {
        }
      }

      if (item) {
        const key = `${this.categoryName}_${item.id}`;

        // Update selection state and record ID
        this.selectedItems[key] = true;
        this.visualRecordIds[key] = DTEID;

        // Update name from server if changed (server is source of truth)
        if (visual.Name && visual.Name !== item.name) {
          item.name = visual.Name;
        }

        // Update answer but preserve any local edits
        if (!item.answer && visual.Answers) {
          item.answer = visual.Answers;
        }

        // Only load photos if we don't already have them (preserve uploading photos)
        if (!this.visualPhotos[key] || this.visualPhotos[key].length === 0) {
          await this.loadPhotosForVisual(DTEID, key);
        }
      }
    }
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

  /**
   * Get the standardized photo key for a category/item combination.
   * Webapp uses itemId directly, mobile uses templateId for consistency.
   */
  private getPhotoKey(category: string, itemId: string | number): string {
    if (environment.isWeb) {
      return `${category}_${itemId}`;
    }
    const item = this.findItemById(itemId);
    return `${category}_${item?.templateId ?? itemId}`;
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
   * Mirrors LBW/EFE's loadPhotosFromAPI approach for WEBAPP mode
   */
  private async loadPhotosFromAPI(): Promise<void> {

    // WEBAPP FIX: Load cached annotated images FIRST for thumbnail display
    if (this.bulkAnnotatedImagesMap.size === 0) {
      try {
        this.bulkAnnotatedImagesMap = await this.indexedDb.getAllCachedAnnotatedImagesForService();
      } catch (e) {
        console.warn('[DTE] WEBAPP: Failed to load annotated images cache:', e);
      }
    }

    // Get all visual IDs that have been selected
    for (const [key, dteId] of Object.entries(this.visualRecordIds)) {
      if (!dteId) continue;

      try {
        const attachments = await this.hudData.getVisualAttachments(dteId);

        // Convert attachments to photo format
        const photos: any[] = [];
        for (const att of attachments || []) {
          // Try multiple possible field names for the S3 key
          const rawPhotoValue = att.Attachment || att.attachment || att.Photo || att.photo || '';
          let displayUrl = rawPhotoValue || 'assets/img/photo-placeholder.svg';

          // WEBAPP: Get S3 signed URL if needed
          if (displayUrl && displayUrl !== 'assets/img/photo-placeholder.svg') {
            const isS3Key = this.caspioService.isS3Key(displayUrl);

            if (isS3Key) {
              // S3 key - get signed URL
              try {
                displayUrl = await this.caspioService.getS3FileUrl(displayUrl);
              } catch (e) {
                console.warn('[DTE] WEBAPP: Could not get S3 URL:', e);
                displayUrl = 'assets/img/photo-placeholder.svg';
              }
            }
          }

          const attachId = String(att.AttachID || att.attachId || att.PK_ID);
          const hasServerAnnotations = !!(att.Drawings && att.Drawings.length > 10);
          let thumbnailUrl = displayUrl;
          let hasAnnotations = hasServerAnnotations;

          // WEBAPP FIX: Check for cached annotated image
          // IMPORTANT: Only use cached annotations if server confirms photo HAS annotations
          // This prevents stale cache (from old deleted photos) from being applied to new uploads
          // Local annotations sync to server immediately in WEBAPP mode, so server should have the data
          const cachedAnnotated = this.bulkAnnotatedImagesMap.get(attachId);
          if (cachedAnnotated && hasServerAnnotations) {
            // Server confirms annotations exist - use cached version (may be more up-to-date than server render)
            thumbnailUrl = cachedAnnotated;
            hasAnnotations = true;
          } else if (hasServerAnnotations && displayUrl && displayUrl !== 'assets/img/photo-placeholder.svg') {
            // No cached image but server has Drawings - render annotations on the fly
            try {
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
                  console.warn('[DTE] WEBAPP: Failed to cache annotated image:', cacheErr);
                }
              }
            } catch (renderErr) {
              console.warn(`[DTE] WEBAPP: Failed to render annotations for ${attachId}:`, renderErr);
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
            Attachment: rawPhotoValue,
            uploading: false,
            loading: false,
            isLocal: false,
            isPending: false,
            hasAnnotations,
            Drawings: att.Drawings || ''
          });
        }

        this.visualPhotos[key] = photos;
        this.photoCountsByKey[key] = photos.length;
      } catch (error) {
        console.error(`[DTE] WEBAPP: Error loading photos for DTE ${dteId}:`, error);
      }
    }

    this.changeDetectorRef.detectChanges();
  }

  private async loadPhotosForVisual(DTEID: string, key: string) {
    try {
      this.loadingPhotosByKey[key] = true;

      // CRITICAL FIX: Check sync status to preserve photos during sync
      const syncStatus = this.backgroundSync.syncStatus$.getValue();
      const syncInProgress = syncStatus.isSyncing;

      // Get attachments from database
      const attachments = await this.hudData.getVisualAttachments(DTEID);


      // Set photo count immediately so skeleton loaders can be displayed
      this.photoCountsByKey[key] = attachments.length;

      if (attachments.length > 0) {
        // CRITICAL: Don't reset photo array if it already has photos from uploads
        if (!this.visualPhotos[key]) {
          this.visualPhotos[key] = [];
        } else {

          // CRITICAL FIX: During sync, skip reload to prevent photos from disappearing
          if (syncInProgress) {
            this.loadingPhotosByKey[key] = false;
            this.changeDetectorRef.detectChanges();
            return;
          }

          // Check if we already have all the photos loaded
          const loadedPhotoIds = new Set(this.visualPhotos[key].map(p => p.AttachID));
          const allPhotosLoaded = attachments.every(a => loadedPhotoIds.has(a.AttachID));
          if (allPhotosLoaded) {
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
            continue;
          }

          await this.loadSinglePhoto(attach, key);
        }

      } else {
        // CRITICAL FIX: During sync, don't clear photos even if attachments is empty
        if (syncInProgress && this.visualPhotos[key]?.length > 0) {
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
    const s3Key = attach.Attachment;
    const filePath = attach.Attachment || attach.Photo || '';
    const hasImageSource = attach.Attachment || attach.Photo;
    
    
    // TWO-FIELD APPROACH: Determine display state and URL
    let displayUrl = 'assets/img/photo-placeholder.svg';
    let displayState: 'local' | 'uploading' | 'cached' | 'remote_loading' | 'remote' = 'remote';
    let localBlobKey: string | undefined;
    let imageUrl = '';
    
    // STEP 1: Check for local pending blob first (highest priority)
    try {
      const localBlobUrl = await this.indexedDb.getPhotoBlobUrl(attachId);
      if (localBlobUrl) {
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
    
    const hasDrawings = !!(attach.Drawings && attach.Drawings.length > 0 && attach.Drawings !== '{}');

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
      thumbnailUrl: imageUrl || displayUrl,
      displayUrl: displayUrl,
      // Metadata
      caption: attach.Annotation || '',
      annotation: attach.Annotation || '',
      Annotation: attach.Annotation || '',
      hasAnnotations: hasDrawings,
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
      this.preloadAndTransition(attachId, s3Key || attach.Photo, key, !!s3Key && this.caspioService.isS3Key(s3Key)).catch(err => {
        console.warn('[LOAD PHOTO] Preload failed:', attachId, err);
      });
    }
    
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
      
      if (isS3) {
        const s3Url = await this.caspioService.getS3FileUrl(imageKey);
        const preloaded = await this.preloadImage(s3Url);
        if (!preloaded) throw new Error('Preload failed');
        imageDataUrl = await this.fetchAsDataUrl(s3Url);
      } else {
        const imageData = await this.hudData.getImage(imageKey);
        if (!imageData || !imageData.startsWith('data:')) {
          throw new Error('Invalid image data');
        }
        imageDataUrl = imageData;
      }
      
      await this.indexedDb.cachePhoto(attachId, this.serviceId, imageDataUrl, isS3 ? imageKey : undefined);
      
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

      // STEP 1: Restore pending VISUAL records first
      const pendingRequests = await this.indexedDb.getPendingRequests();
      const pendingVisuals = pendingRequests.filter(r =>
        r.type === 'CREATE' &&
        r.endpoint?.includes('LPS_Services_DTE_Visuals') &&
        r.status !== 'synced' &&
        r.data?.ServiceID === parseInt(this.serviceId, 10) &&
        r.data?.Category === this.categoryName
      );


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
        this.changeDetectorRef.detectChanges();
        return;
      }


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
          continue;
        }


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

    } catch (error) {
      console.error('[RESTORE PENDING] Error restoring pending data:', error);
    }
  }

  // UI Helper Methods
  goBack() {
    this.router.navigate(['..'], { relativeTo: this.route });
  }

  filterItems(items: VisualItem[]): VisualItem[] {
    // Delegate to shared SearchFilterService
    return this.searchFilterService.filterItems(items as SharedVisualItem[], this.searchTerm) as VisualItem[];
  }

  /**
   * Escape HTML characters to prevent XSS (web only)
   * @deprecated Use searchFilterService.escapeHtml() instead
   */
  private escapeHtml(text: string): string {
    return this.searchFilterService.escapeHtml(text);
  }

  highlightText(text: string | undefined): string {
    // Delegate to shared SearchFilterService
    return this.searchFilterService.highlightText(text, this.searchTerm);
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

  // Simple accordion helpers (for offline reliability - ion-accordion can fail offline)
  toggleSection(section: string): void {
    const index = this.expandedAccordions.indexOf(section);
    if (index > -1) {
      this.expandedAccordions = this.expandedAccordions.filter(s => s !== section);
    } else {
      this.expandedAccordions = [...this.expandedAccordions, section];
    }
    this.changeDetectorRef.detectChanges();
  }

  isSectionExpanded(section: string): boolean {
    return this.expandedAccordions.includes(section);
  }

  // Count how many items are selected/checked in a section
  getSelectedCount(items: VisualItem[]): number {
    if (!items) return 0;
    return items.filter(item => this.isItemSelected(this.categoryName, item.templateId)).length;
  }

  async toggleItemSelection(category: string, itemId: string | number) {
    const key = `${category}_${itemId}`;
    const newState = !this.selectedItems[key];
    this.selectedItems[key] = newState;


    if (newState) {
      // Item was checked - create visual record if it doesn't exist, or unhide if it exists
      const visualId = this.visualRecordIds[key];
      if (visualId && !String(visualId).startsWith('temp_')) {
        // Visual exists but was hidden - unhide it
        this.savingItems[key] = true;
        try {
          await this.hudData.updateVisual(visualId, { Notes: '' });
        } catch (error) {
          console.error('[TOGGLE] Error unhiding visual:', error);
          this.selectedItems[key] = false;
        } finally {
          this.savingItems[key] = false;
          this.changeDetectorRef.detectChanges();
        }
      } else {
        // Create new visual record
        await this.createVisualRecord(category, itemId);
      }
    } else {
      // Item was unchecked - HIDE it (don't delete, preserves photos)
      const visualId = this.visualRecordIds[key];
      if (visualId && !String(visualId).startsWith('temp_')) {
        this.savingItems[key] = true;
        try {
          await this.hudData.updateVisual(visualId, { Notes: 'HIDDEN' });
        } catch (error) {
          console.error('[TOGGLE] Error hiding visual:', error);
          this.selectedItems[key] = true; // Revert on error
        } finally {
          this.savingItems[key] = false;
          this.changeDetectorRef.detectChanges();
        }
      }
    }
  }

  isItemSelected(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.selectedItems[key] || false;
  }

  isItemSaving(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.savingItems[key] || false;
  }

  getPhotosForVisual(category: string, itemId: string | number): any[] {
    const key = `${category}_${itemId}`;
    return this.visualPhotos[key] || [];
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
                    this.changeDetectorRef.detectChanges();
                  } catch (error) {
                    console.error('[DTE TEXT EDIT] Error updating visual:', error);
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
    await alert.present();
  }

  trackByItemId(index: number, item: VisualItem): any {
    return item.id;
  }

  trackByOption(index: number, option: string): any {
    return option;
  }

  getDropdownOptions(templateId: number): string[] {
    // Delegate to shared MultiSelectService
    const options = this.multiSelectService.getDropdownOptions(templateId, this.visualDropdownOptions);

    // Debug logging to see what's available
    const templateIdStr = String(templateId);
    if (options.length === 0 && !this._loggedPhotoKeys.has(templateIdStr)) {
      this._loggedPhotoKeys.add(templateIdStr);
    } else if (options.length > 0 && !this._loggedPhotoKeys.has(templateIdStr)) {
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
    const key = `${category}_${itemId}`;
    const item = this.findItemById(itemId);  // Find by ID, not templateId
    
    if (!item) {
      console.error('[CREATE VISUAL] ❌ Item not found for itemId:', itemId);
      console.error('[CREATE VISUAL] Available items:', [
        ...this.organizedData.comments,
        ...this.organizedData.limitations,
        ...this.organizedData.deficiencies
      ].map(i => ({ id: i.id, templateId: i.templateId, name: i.name })));
      return;
    }


    this.savingItems[key] = true;

    try {
      const templateIdInt = typeof item.templateId === 'string' ? parseInt(item.templateId, 10) : Number(item.templateId);
      const hudData = {
        ServiceID: parseInt(this.serviceId),
        Category: category,
        Kind: item.type,
        Name: item.name,
        Text: item.text,
        Notes: '',
        Answers: item.answer || '',
        TemplateID: templateIdInt
      };


      // SYNC QUEUE FIX: Use DteDataService which handles offline-first with sync queue
      const result = await this.hudData.createVisual(hudData);
      
      
      // Handle BOTH response formats: direct object OR wrapped in Result array
      let createdRecord = null;
      if (result && result.DTEID) {
        // Direct object format
        createdRecord = result;
      } else if (result && result.Result && result.Result.length > 0) {
        // Wrapped in Result array
        createdRecord = result.Result[0];
      }
      
      if (createdRecord) {
        const DTEID = String(createdRecord.DTEID || createdRecord.PK_ID);
        
        // CRITICAL: Store the record ID
        this.visualRecordIds[key] = DTEID;
        this.selectedItems[key] = true;
        
        
        // Initialize photo array
        this.visualPhotos[key] = [];
        this.photoCountsByKey[key] = 0;
        
        // CRITICAL: Clear cache so fresh reload will include this new record
        this.hudData.clearServiceCaches(this.serviceId);
        
        // Force change detection to ensure UI updates
        this.changeDetectorRef.detectChanges();
      } else {
        console.error('[CREATE VISUAL] ❌ Could not extract HUD record from response:', result);
      }
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
    const key = `${category}_${itemId}`;
    const visualId = this.visualRecordIds[key];
    
    if (!visualId) {
      return;
    }

    this.savingItems[key] = true;

    try {
      await firstValueFrom(this.caspioService.deleteServicesDTE(visualId));
      
      // Clean up local state
      delete this.visualRecordIds[key];
      delete this.visualPhotos[key];
      delete this.photoCountsByKey[key];
      
    } catch (error) {
      console.error('[DELETE VISUAL] Error:', error);
    } finally {
      this.savingItems[key] = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  async onAnswerChange(category: string, item: VisualItem) {
    const key = `${category}_${item.id}`;

    this.savingItems[key] = true;

    try {
      // Create or update visual record
      let visualId = this.visualRecordIds[key];

      // If answer is empty/cleared, hide the visual instead of deleting
      if (!item.answer || item.answer === '') {
        if (visualId && !String(visualId).startsWith('temp_')) {
          // SYNC QUEUE FIX: Use DteDataService which handles offline-first with sync queue
          await this.hudData.updateVisual(visualId, {
            Answers: '',
            Notes: 'HIDDEN'
          }, this.serviceId);
        }
        this.savingItems[key] = false;
        this.changeDetectorRef.detectChanges();
        return;
      }

      if (!visualId) {
        // Create new visual
        const serviceIdNum = parseInt(this.serviceId, 10);
        const templateIdInt = typeof item.templateId === 'string' ? parseInt(item.templateId, 10) : Number(item.templateId);
        const visualData = {
          ServiceID: serviceIdNum,
          Category: category,
          Kind: item.type,
          Name: item.name,
          Text: item.text || item.originalText || '',
          Notes: '',
          Answers: item.answer || '',
          TemplateID: templateIdInt
        };


        // SYNC QUEUE FIX: Use DteDataService which handles offline-first with sync queue
        const result = await this.hudData.createVisual(visualData);
        
        
        // Try multiple ways to extract the DTEID
        if (result && result.Result && result.Result.length > 0) {
          visualId = String(result.Result[0].DTEID || result.Result[0].PK_ID || result.Result[0].id);
        } else if (result && Array.isArray(result) && result.length > 0) {
          visualId = String(result[0].DTEID || result[0].PK_ID || result[0].id);
        } else if (result) {
          visualId = String(result.DTEID || result.PK_ID || result.id);
        }
        
        if (visualId) {
          this.visualRecordIds[key] = visualId;
          this.selectedItems[key] = true;
          
          // Initialize photo array
          this.visualPhotos[key] = [];
          this.photoCountsByKey[key] = 0;
          
        } else {
          console.error('[ANSWER] ❌ FAILED to extract DTEID from response!');
        }
      } else if (!String(visualId).startsWith('temp_')) {
        // Update existing visual and unhide if it was hidden
        // SYNC QUEUE FIX: Use DteDataService which handles offline-first with sync queue
        await this.hudData.updateVisual(visualId, {
          Answers: item.answer || '',
          Notes: ''
        }, this.serviceId);
      }
    } catch (error) {
      console.error('[ANSWER] ❌ Error saving answer:', error);
      await this.showToast('Failed to save answer', 'danger');
    }

    this.savingItems[key] = false;
    this.changeDetectorRef.detectChanges();
  }

  async onOptionToggle(category: string, item: VisualItem, option: string, event: any) {
    const key = `${category}_${item.id}`;
    const isChecked = event.detail.checked;


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
          // SYNC QUEUE FIX: Use DteDataService which handles offline-first with sync queue
          await this.hudData.updateVisual(visualId, {
            Answers: '',
            Notes: 'HIDDEN'
          }, this.serviceId);
        }
        this.savingItems[key] = false;
        this.changeDetectorRef.detectChanges();
        return;
      }

      if (!visualId) {
        // Create new visual
        const serviceIdNum = parseInt(this.serviceId, 10);
        const templateIdInt = typeof item.templateId === 'string' ? parseInt(item.templateId, 10) : Number(item.templateId);
        const visualData = {
          ServiceID: serviceIdNum,
          Category: category,
          Kind: item.type,
          Name: item.name,
          Text: item.text || item.originalText || '',
          Notes: item.otherValue || '',
          Answers: item.answer,
          TemplateID: templateIdInt
        };


        // SYNC QUEUE FIX: Use DteDataService which handles offline-first with sync queue
        const result = await this.hudData.createVisual(visualData);
        
        
        // Try multiple ways to extract the DTEID
        if (result && result.Result && result.Result.length > 0) {
          visualId = String(result.Result[0].DTEID || result.Result[0].PK_ID || result.Result[0].id);
        } else if (result && Array.isArray(result) && result.length > 0) {
          visualId = String(result[0].DTEID || result[0].PK_ID || result[0].id);
        } else if (result) {
          visualId = String(result.DTEID || result.PK_ID || result.id);
        }
        
        if (visualId) {
          this.visualRecordIds[key] = visualId;
          this.selectedItems[key] = true;
          
          // Initialize photo array
          this.visualPhotos[key] = [];
          this.photoCountsByKey[key] = 0;
          
        } else {
          console.error('[OPTION] ❌ FAILED to extract DTEID from response!');
        }
      } else if (!String(visualId).startsWith('temp_')) {
        // Update existing visual
        const notesValue = item.otherValue || '';
        // SYNC QUEUE FIX: Use DteDataService which handles offline-first with sync queue
        await this.hudData.updateVisual(visualId, {
          Answers: item.answer,
          Notes: notesValue
        }, this.serviceId);
      }
    } catch (error) {
      console.error('[OPTION] ❌ Error saving option:', error);
      await this.showToast('Failed to save option', 'danger');
    }

    this.savingItems[key] = false;
    this.changeDetectorRef.detectChanges();
  }

  isOptionSelectedV1(item: VisualItem, option: string): boolean {
    // Delegate to shared MultiSelectService
    return this.multiSelectService.isOptionSelected(item as SharedVisualItem, option);
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
    

    await this.onAnswerChange(category, item);
  }

  // Add custom option for category item multi-select
  // STANDARDIZED: Matches EFE/LBW/HUD pattern - saves dropdownOptions to Dexie for persistence
  async addMultiSelectOther(category: string, item: VisualItem) {
    if (!item.otherValue || !item.otherValue.trim()) {
      return;
    }

    const customValue = item.otherValue.trim();
    const templateId = String(item.templateId);
    const actualCategory = item.category || category;
    const key = `${actualCategory}_${item.templateId}`;


    // Ensure visualDropdownOptions array exists
    if (!this.visualDropdownOptions[templateId]) {
      this.visualDropdownOptions[templateId] = [];
    }

    // Parse current selections
    let selectedOptions = item.answer ? item.answer.split(',').map(s => s.trim()).filter(s => s) : [];

    // Remove "None" if adding a custom value (mutually exclusive)
    selectedOptions = selectedOptions.filter(o => o !== 'None');

    // Check if this custom value already exists in options
    if (this.visualDropdownOptions[templateId].includes(customValue)) {
      // Just select it if not already selected
      if (!selectedOptions.includes(customValue)) {
        selectedOptions.push(customValue);
      }
    } else {
      // Add to options (before None and Other if they exist)
      const options = this.visualDropdownOptions[templateId];
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

      // Select the new custom value
      selectedOptions.push(customValue);
    }

    // Update item answer
    item.answer = selectedOptions.join(', ');

    // Clear the input
    item.otherValue = '';


    // DEXIE-FIRST: Write-through to visualFields including updated dropdownOptions
    // This ensures custom options persist across page loads
    // STANDARDIZED: Use 'category' (the route param passed from template) to match load path
    // Load uses this.categoryName, so save must use the same value for Dexie key consistency
    await this.visualFieldRepo.setField(this.serviceId, category, item.templateId, {
      answer: item.answer,
      otherValue: '',
      isSelected: true,
      dropdownOptions: [...this.visualDropdownOptions[templateId]]  // Save the updated options array to Dexie
    });


    await this.onAnswerChange(category, item);
  }

  // ============================================
  // CAMERA AND GALLERY CAPTURE METHODS (Using PhotoHandlerService)
  // ============================================

  async addPhotoFromCamera(category: string, itemId: string | number) {
    const key = this.getPhotoKey(category, itemId);

    // Get or create DTE record first
    let visualId = this.visualRecordIds[key];
    if (!visualId) {
      await this.saveVisualSelection(category, itemId);
      visualId = this.visualRecordIds[key];
    }

    if (!visualId) {
      console.error('[DTE CAMERA] Failed to create DTE record');
      await this.showToast('Failed to create record for photo', 'danger');
      return;
    }

    // Initialize photo array if needed
    if (!this.visualPhotos[key]) {
      this.visualPhotos[key] = [];
    }

    // Configure and call PhotoHandlerService
    const config: PhotoCaptureConfig = {
      entityType: 'dte',
      entityId: String(visualId),
      serviceId: this.serviceId,
      category,
      itemId,
      onTempPhotoAdded: (photo: StandardPhotoEntry) => {
        this.visualPhotos[key].push(photo);
        this.expandedPhotos[key] = true;
        this.changeDetectorRef.detectChanges();
      },
      onUploadComplete: (photo: StandardPhotoEntry, tempId: string) => {
        const index = this.visualPhotos[key].findIndex(p =>
          p.AttachID === tempId || p.imageId === tempId
        );
        if (index !== -1) {
          this.visualPhotos[key][index] = photo;
        }
        this.changeDetectorRef.detectChanges();
      },
      onUploadFailed: (tempId: string, error: any) => {
        console.error('[DTE CAMERA] Upload failed:', error);
        const index = this.visualPhotos[key].findIndex(p =>
          p.AttachID === tempId || p.imageId === tempId
        );
        if (index !== -1) {
          this.visualPhotos[key][index].uploading = false;
          this.visualPhotos[key][index].uploadFailed = true;
        }
        this.changeDetectorRef.detectChanges();
      },
      onExpandPhotos: () => {
        this.expandedPhotos[key] = true;
        this.changeDetectorRef.detectChanges();
      }
    };

    await this.photoHandler.captureFromCamera(config);
  }

  async addPhotoFromGallery(category: string, itemId: string | number) {
    const key = this.getPhotoKey(category, itemId);

    // Get or create DTE record first
    let visualId = this.visualRecordIds[key];
    if (!visualId) {
      await this.saveVisualSelection(category, itemId);
      visualId = this.visualRecordIds[key];
    }

    if (!visualId) {
      console.error('[DTE GALLERY] Failed to create DTE record');
      await this.showToast('Failed to create record for photo', 'danger');
      return;
    }

    // Initialize photo array if needed
    if (!this.visualPhotos[key]) {
      this.visualPhotos[key] = [];
    }

    // Configure and call PhotoHandlerService
    const config: PhotoCaptureConfig = {
      entityType: 'dte',
      entityId: String(visualId),
      serviceId: this.serviceId,
      category,
      itemId,
      skipAnnotator: true, // Gallery photos don't go through annotator
      onTempPhotoAdded: (photo: StandardPhotoEntry) => {
        this.visualPhotos[key].push(photo);
        this.expandedPhotos[key] = true;
        this.changeDetectorRef.detectChanges();
      },
      onUploadComplete: (photo: StandardPhotoEntry, tempId: string) => {
        const index = this.visualPhotos[key].findIndex(p =>
          p.AttachID === tempId || p.imageId === tempId
        );
        if (index !== -1) {
          this.visualPhotos[key][index] = photo;
        }
        this.changeDetectorRef.detectChanges();
      },
      onUploadFailed: (tempId: string, error: any) => {
        console.error('[DTE GALLERY] Upload failed:', error);
        const index = this.visualPhotos[key].findIndex(p =>
          p.AttachID === tempId || p.imageId === tempId
        );
        if (index !== -1) {
          this.visualPhotos[key][index].uploading = false;
          this.visualPhotos[key][index].uploadFailed = true;
        }
        this.changeDetectorRef.detectChanges();
      },
      onExpandPhotos: () => {
        this.expandedPhotos[key] = true;
        this.changeDetectorRef.detectChanges();
      }
    };

    await this.photoHandler.captureFromGallery(config);
  }

  /**
   * Handle file input selection (for web file input)
   */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const context = this.currentUploadContext;
    if (!context) {
      console.error('[FILE SELECT] No upload context set');
      return;
    }

    // Process selected files
    Array.from(input.files).forEach(file => {
      // Create a blob URL for preview
      const blobUrl = URL.createObjectURL(file);
    });

    // Clear the input for future selections
    input.value = '';
  }

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
      if (visualId && !this.visualPhotos[key]?.length && !this.loadingPhotosByKey[key]) {
        this.loadPhotosForVisual(visualId, key);
      }
    }
    this.changeDetectorRef.detectChanges();
  }

  // Perform HUD photo upload (matches performVisualPhotoUpload from structural systems)
  private async performVisualPhotoUpload(
    DTEID: number,
    photo: File,
    key: string,
    isBatchUpload: boolean,
    annotationData: any,
    originalPhoto: File | null,
    tempId: string | undefined,
    caption: string
  ): Promise<string | null> {
    try {

      // Upload photo using HUD service
      const result = await this.hudData.uploadVisualPhoto(DTEID, photo, caption);


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


          // Check if this is an S3 image
          if (s3Key && this.caspioService.isS3Key(s3Key)) {
            try {
              displayableUrl = await this.caspioService.getS3FileUrl(s3Key);
            } catch (err) {
              console.error('[DTE PHOTO UPLOAD] ❌ Failed to fetch S3 URL:', err);
              displayableUrl = 'assets/img/photo-placeholder.svg';
            }
          }
          // Fallback to old Caspio Files API logic
          else if (uploadedPhotoUrl && !uploadedPhotoUrl.startsWith('data:') && !uploadedPhotoUrl.startsWith('blob:')) {
            try {
              const imageData = await firstValueFrom(
                this.caspioService.getImageFromFilesAPI(uploadedPhotoUrl)
              );
              
              if (imageData && imageData.startsWith('data:')) {
                displayableUrl = imageData;
              } else {
                console.warn('[DTE PHOTO UPLOAD] ❌ Files API returned invalid data');
                displayableUrl = 'assets/img/photo-placeholder.svg';
              }
            } catch (err) {
              console.error('[DTE PHOTO UPLOAD] ❌ Failed to fetch image from Files API:', err);
              displayableUrl = 'assets/img/photo-placeholder.svg';
            }
          } else {
          }


          // Get AttachID from the actual result
          const attachId = actualResult.AttachID || actualResult.PK_ID || actualResult.id;

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


          this.changeDetectorRef.detectChanges();
        } else {
          console.warn('[DTE PHOTO UPLOAD] ❌ Could not find photo with tempId:', tempId);
        }
      }

      // Return the AttachID for immediate use
      return result.AttachID;

    } catch (error) {
      console.error('[DTE PHOTO UPLOAD] ❌ Upload failed:', error);

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
          } catch (e) {
            console.error('[SAVE] Compression failed:', e);
            compressedDrawings = drawingsData;
          }
        }

        updateData.Drawings = compressedDrawings;
      }
    }

    // Update the DTE attach record
    await firstValueFrom(this.caspioService.updateServicesDTEAttach(attachId, updateData));

    // TASK 4 FIX: Cache the annotated blob for thumbnail display on reload
    // This ensures annotations are visible in thumbnails after page reload
    if (annotatedBlob && annotatedBlob.size > 0) {
      try {
        const base64 = await this.indexedDb.cacheAnnotatedImage(String(attachId), annotatedBlob);
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
    return `photo_${photo.VisualID || photo.DTEID || 'unknown'}_${photo.fileName || photo.Photo || index}`;
  }

  handleImageError(event: any, photo: any) {
    const target = event.target as HTMLImageElement;
    target.src = 'assets/img/photo-placeholder.svg';
  }

  saveScrollBeforePhotoClick(event: Event): void {
    // Scroll position is handled in viewPhoto
  }

  isLoadingPhotosForVisual(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.loadingPhotosByKey[key] === true;
  }

  getSkeletonArray(category: string, itemId: string | number): any[] {
    const key = `${category}_${itemId}`;
    const count = this.photoCountsByKey[key] || 0;
    return Array(count).fill({ isSkeleton: true });
  }

  isUploadingPhotos(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.uploadingPhotosByKey[key] === true;
  }

  getUploadingCount(category: string, itemId: string | number): number {
    const key = `${category}_${itemId}`;
    const photos = this.visualPhotos[key] || [];
    return photos.filter(p => p.uploading).length;
  }

  getTotalPhotoCount(category: string, itemId: string | number): number {
    const key = `${category}_${itemId}`;
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
                  })
                  .catch((error) => {
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

    try {
      const key = `${category}_${itemId}`;

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

      // NEW: Handle LocalImages from the new local-first system (Dexie-based)
      // These have imageId/localImageId like "img_abc" (not "temp_" which is legacy)
      const isLocalFirstPhoto = photo.isLocalFirst || photo.isLocalImage || photo.localImageId ||
        (photo.imageId && String(photo.imageId).startsWith('img_'));

      if (isLocalFirstPhoto && !isPendingPhoto) {
        const localImageId = photo.localImageId || photo.imageId;

        const localImage = await this.indexedDb.getLocalImage(localImageId);
        if (localImage) {
          // ANNOTATION FIX: Update photo.Drawings with fresh data from Dexie
          // This ensures annotations persist after page reload
          if (localImage.drawings && localImage.drawings.length > 10) {
            photo.Drawings = localImage.drawings;
            photo.hasAnnotations = true;
          }

          // FULL RESOLUTION FIX: For the annotator, we MUST get the FULL RESOLUTION image
          // Do NOT use getDisplayUrl() directly as it may return a thumbnail when full-res is purged
          // Use three-tier approach matching EFE template
          try {
            let fullResUrl: string | null = null;

            // First try: Get full-resolution blob directly
            if (localImage.localBlobId) {
              fullResUrl = await this.localImageService.getOriginalBlobUrl(localImage.localBlobId);
              if (fullResUrl) {
                photo._hasFullResBlob = true;
              }
            }

            // Second try: If no full-res blob (purged), fetch from S3
            if (!fullResUrl && localImage.remoteS3Key) {
              try {
                fullResUrl = await this.caspioService.getS3FileUrl(localImage.remoteS3Key);
                if (fullResUrl) {
                  photo._hasFullResBlob = true;
                }
              } catch (s3Err) {
                console.warn('[VIEW PHOTO] S3 fetch failed:', s3Err);
              }
            }

            // Third try: Fall back to getDisplayUrl (may be thumbnail - last resort)
            if (!fullResUrl) {
              console.warn('[VIEW PHOTO] ⚠️ No full-res available, falling back to getDisplayUrl (may be thumbnail)');
              fullResUrl = await this.localImageService.getDisplayUrl(localImage);
            }

            if (fullResUrl && fullResUrl !== 'assets/img/photo-placeholder.svg') {
              photo.url = fullResUrl;
              photo.thumbnailUrl = fullResUrl;
              photo.originalUrl = fullResUrl;
              photo.displayUrl = fullResUrl;
              imageUrl = fullResUrl;
            }
          } catch (err) {
            console.warn('[VIEW PHOTO] Failed to get LocalImage URL:', err);
          }
        }
      }

      // If no valid URL and we have a file path, try to fetch it
      if ((!imageUrl || imageUrl === 'assets/img/photo-placeholder.svg') && (photo.filePath || photo.Photo || photo.Attachment)) {
        try {
          // Check if this is an S3 key
          if (photo.Attachment && this.caspioService.isS3Key(photo.Attachment)) {
            imageUrl = await this.caspioService.getS3FileUrl(photo.Attachment);
            photo.url = imageUrl;
            photo.originalUrl = imageUrl;
            photo.thumbnailUrl = imageUrl;
            photo.displayUrl = imageUrl;
          }
          // Fallback to Caspio Files API
          else {
            const filePath = photo.filePath || photo.Photo;
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

          // Handle LocalImage (local-first system) deletion
          const isLocalFirstPhoto = photo.isLocalFirst || photo.isLocalImage || photo.localImageId ||
            (photo.imageId && String(photo.imageId).startsWith('img_'));

          if (isLocalFirstPhoto) {
            const localImageId = photo.localImageId || photo.imageId;

            // CRITICAL: Get LocalImage data BEFORE deleting to check if server deletion is needed
            const localImage = await this.indexedDb.getLocalImage(localImageId);

            // If the photo was already synced (has real attachId), queue delete for server
            if (localImage?.attachId && !String(localImage.attachId).startsWith('img_')) {
              await this.hudData.deleteVisualPhoto(localImage.attachId);
            }

            // NOW delete from LocalImage system (after queuing server delete)
            await this.localImageService.deleteLocalImage(localImageId);
          }
          // Legacy photo deletion
          else if (photo.AttachID && !String(photo.AttachID).startsWith('temp_')) {
            await this.hudData.deleteVisualPhoto(photo.AttachID);
          }

        } catch (error) {
          console.error('Error deleting photo:', error);
        }
      }
    } catch (error) {
      console.error('Error in deletePhoto:', error);
    }
  }

  private async showToast(message: string, color: string = 'primary') {
    if (color === 'success' || color === 'info') return;
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

  // Create custom visual with photos
  async createCustomVisualWithPhotos(category: string, kind: string, name: string, text: string, files: FileList | File[] | null, processedPhotos: any[] = []) {
    try {
      const serviceIdNum = parseInt(this.serviceId, 10);
      if (isNaN(serviceIdNum)) {
        return;
      }

      const hudData = {
        ServiceID: serviceIdNum,
        Category: category,
        Kind: kind,
        Name: name,
        Text: text,
        Notes: '',
        TemplateID: 0  // Custom visual - no template
      };


      // Create the HUD record
      const response = await this.hudData.createVisual(hudData);

      // Extract DTEID (handle both direct and Result wrapped formats)
      let visualId: string | null = null;

      if (response && response.DTEID) {
        visualId = String(response.DTEID);
      } else if (Array.isArray(response) && response.length > 0) {
        visualId = String(response[0].DTEID || response[0].PK_ID || response[0].id || '');
      } else if (response && typeof response === 'object') {
        if (response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
          visualId = String(response.Result[0].DTEID || response.Result[0].PK_ID || response.Result[0].id || '');
        } else {
          visualId = String(response.DTEID || response.PK_ID || response.id || '');
        }
      } else if (response) {
        visualId = String(response);
      }

      if (!visualId || visualId === 'undefined' || visualId === 'null' || visualId === '') {
        throw new Error('No DTEID returned from server');
      }


      // Add to local data structure
      const customItem: VisualItem = {
        id: `custom_${visualId}`,
        templateId: 0,
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

      // Add to appropriate array
      if (kind === 'Comment') {
        this.organizedData.comments.push(customItem);
      } else if (kind === 'Limitation') {
        this.organizedData.limitations.push(customItem);
      } else if (kind === 'Deficiency') {
        this.organizedData.deficiencies.push(customItem);
      }

      // Store visual ID
      const key = `${category}_${customItem.id}`;
      this.visualRecordIds[key] = String(visualId);
      this.selectedItems[key] = true;


      // Upload photos if provided
      if (files && files.length > 0) {

        // Initialize photos array
        if (!this.visualPhotos[key]) {
          this.visualPhotos[key] = [];
        }

        // Add placeholder photos
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
            displayUrl: photoData.previewUrl || objectUrl,
            isObjectUrl: true,
            uploading: true,
            hasAnnotations: !!photoData.annotationData,
            annotations: photoData.annotationData || null,
            caption: photoData.caption || '',
            annotation: photoData.caption || ''
          };
        });

        this.visualPhotos[key].push(...tempPhotos);
        this.changeDetectorRef.detectChanges();


        // Upload photos in background
        const uploadPromises = Array.from(files).map(async (file, index) => {
          const tempId = tempPhotos[index].AttachID;
          try {
            const photoData = processedPhotos[index] || {};
            const annotationData = photoData.annotationData || null;
            const originalFile = photoData.originalFile || null;
            const caption = photoData.caption || '';

            const fileToUpload = originalFile || file;
            const result = await this.hudData.uploadVisualPhoto(parseInt(visualId!, 10), fileToUpload, caption);
            
            // Handle result format
            const actualResult = result.Result && result.Result[0] ? result.Result[0] : result;
            const attachId = actualResult.AttachID || actualResult.PK_ID || actualResult.id;

            if (!attachId) {
              console.error(`[CREATE CUSTOM] No AttachID for photo ${index + 1}`);
              return;
            }

            // If there are annotations, save them
            if (annotationData) {
              const annotatedBlob = photoData.annotatedBlob;
              if (annotatedBlob) {
                await this.saveAnnotationToDatabase(attachId, annotatedBlob, annotationData, caption);
              }
            }

            // Update photo in UI
            const photoIndex = this.visualPhotos[key]?.findIndex(p => p.AttachID === tempId);
            if (photoIndex !== -1 && this.visualPhotos[key]) {
              await this.updatePhotoAfterUpload(key, photoIndex, actualResult, caption);
            }

          } catch (error) {
            console.error(`[CREATE CUSTOM] Failed to upload photo ${index + 1}:`, error);
          }
        });

        await Promise.all(uploadPromises);
      }

      this.changeDetectorRef.detectChanges();

    } catch (error) {
      console.error('[CREATE CUSTOM] Error:', error);
      await this.showToast('Failed to create custom item', 'danger');
    }
  }

  /**
   * Navigate to visual detail page (same pattern as HUD)
   * Visual-detail will determine DTEID from Dexie field lookup (tempVisualId || visualId)
   */
  openVisualDetail(categoryName: string, item: VisualItem) {

    // WEBAPP SIMPLIFIED: The DTEID is stored in visualRecordIds (LBW pattern)
    let dteId = '';
    let routeId: string | number = item.templateId || item.id;

    if (environment.isWeb) {
      const itemIdStr = String(item.id || '');

      // Custom visual: id = "custom_12345" -> extract DTEID directly
      if (itemIdStr.startsWith('custom_')) {
        dteId = itemIdStr.replace('custom_', '');
        routeId = dteId; // Use the numeric DTEID for the route
      } else {
        // Template visual: look up in visualRecordIds, fallback to item.dteId (LBW pattern)
        const key = `${categoryName}_${item.id}`;
        dteId = this.visualRecordIds[key] || (item as any).dteId || '';
        routeId = item.templateId || item.id;
      }
    } else {
      // MOBILE: Use LBW pattern with isCustomVisual and item.dteId fallback
      const isCustomVisual = !item.templateId || item.templateId === 0;
      const keyId = isCustomVisual ? item.id : item.templateId;
      const key = `${categoryName}_${keyId}`;
      dteId = this.visualRecordIds[key] || (item as any).dteId || '';
      routeId = isCustomVisual ? item.id : item.templateId;
    }


    // LBW pattern: Always pass dteId in queryParams (even if empty)
    // The visual-detail page uses priority-based matching when dteId is empty
    this.router.navigate(
      ['/dte', this.projectId, this.serviceId, 'category', this.categoryName, 'visual', routeId],
      { queryParams: { dteId } }
    );
  }
}

