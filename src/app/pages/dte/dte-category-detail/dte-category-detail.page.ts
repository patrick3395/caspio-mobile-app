import { Component, OnInit, ChangeDetectorRef, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController, AlertController, ActionSheetController, ModalController, IonContent } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { firstValueFrom, Subscription } from 'rxjs';
import { CaspioService } from '../../../services/caspio.service';
import { OfflineService } from '../../../services/offline.service';
import { CameraService } from '../../../services/camera.service';
import { ImageCompressionService } from '../../../services/image-compression.service';
import { CacheService } from '../../../services/cache.service';
import { DteDataService } from '../dte-data.service';
import { FabricPhotoAnnotatorComponent } from '../../../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { BackgroundPhotoUploadService } from '../../../services/background-photo-upload.service';
import { IndexedDbService } from '../../../services/indexed-db.service';
import { BackgroundSyncService } from '../../../services/background-sync.service';

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
export class DteCategoryDetailPage implements OnInit, OnDestroy {
  projectId: string = '';
  serviceId: string = '';
  categoryName: string = '';

  loading: boolean = true;
  searchTerm: string = '';
  expandedAccordions: string[] = []; // Start collapsed
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
    private backgroundSync: BackgroundSyncService
  ) {}

  async ngOnInit() {
    // Subscribe to background upload task updates
    this.subscribeToUploadUpdates();

    // Get category name from route
    this.route.params.subscribe(params => {
      this.categoryName = params['category'];

      // Get IDs from container route
      // Route structure: hud/:projectId/:serviceId -> category/:category (we are here)
      // So we need to go up 2 levels to get to container
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
    console.log('[DTE CATEGORY DETAIL] Component destroyed, but uploads continue in background');
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
        console.error('[UPLOAD UPDATE] ❌ Failed to load uploaded image:', err);
        displayableUrl = 'assets/img/photo-placeholder.png';
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
    this.loading = true;

    try {
      // CRITICAL: Clear cache to force fresh data load
      console.log('[LOAD DATA] ========== STARTING DATA LOAD ==========');
      console.log('[LOAD DATA] Clearing DTE Data service cache...');
      this.hudData.clearServiceCaches(this.serviceId);
      
      // Clear all state for fresh load
      console.log('[LOAD DATA] Clearing all component state for fresh load');
      this.visualPhotos = {};
      this.visualRecordIds = {};
      this.uploadingPhotosByKey = {};
      this.loadingPhotosByKey = {};
      this.photoCountsByKey = {};
      this.selectedItems = {};
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

      // Load existing visuals
      console.log('[LOAD DATA] Step 3: Loading existing visuals...');
      await this.loadExistingVisuals();

      // Restore any pending photos from IndexedDB (offline uploads)
      console.log('[LOAD DATA] Step 4: Restoring pending photos...');
      await this.restorePendingPhotosFromIndexedDB();

      console.log('[LOAD DATA] ========== DATA LOAD COMPLETE ==========');
      console.log('[LOAD DATA] Final state - visualRecordIds:', this.visualRecordIds);
      console.log('[LOAD DATA] Final state - selectedItems:', this.selectedItems);

      // Show page
      this.loading = false;

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

      console.log(`[DTE CATEGORY] Found ${hudTemplates.length} templates for category:`, this.categoryName);

      // CRITICAL: Sort templates by OrderID to ensure correct display order
      hudTemplates.sort((a: any, b: any) => {
        const orderA = a.OrderID || 0;
        const orderB = b.OrderID || 0;
        return orderA - orderB;
      });

      console.log('[DTE CATEGORY] Templates sorted by OrderID:', hudTemplates.map((t: any) => `${t.Name} (${t.OrderID || 0})`));

      // Organize templates by Kind (Type field in HUD is called "Kind")
      hudTemplates.forEach((template: any) => {
        // Log the Kind value to debug
        console.log('[DTE CATEGORY] Template:', template.Name, 'PK_ID:', template.PK_ID, 'TemplateID:', template.TemplateID, 'Kind:', template.Kind, 'Type:', template.Type);

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
        
        console.log('[DTE CATEGORY] Processing item:', template.Name, 'Kind value:', kind, 'Lowercased:', kindLower);

        if (kindLower === 'limitation' || kindLower === 'limitations') {
          this.organizedData.limitations.push(templateData);
          console.log('[DTE CATEGORY] Added to Limitations');
        } else if (kindLower === 'deficiency' || kindLower === 'deficiencies') {
          this.organizedData.deficiencies.push(templateData);
          console.log('[DTE CATEGORY] Added to Deficiencies');
        } else {
          this.organizedData.comments.push(templateData);
          console.log('[DTE CATEGORY] Added to Comments/Information');
        }

        // Note: Dropdown options are already loaded via loadAllDropdownOptions()
        // No need to load them individually here
      });

      console.log('[DTE CATEGORY] Organized data:', {
        comments: this.organizedData.comments.length,
        limitations: this.organizedData.limitations.length,
        deficiencies: this.organizedData.deficiencies.length
      });

    } catch (error) {
      console.error('Error loading category templates:', error);
    }
  }

  /**
   * Load all dropdown options from Services_DTE_Drop table
   * This loads all options upfront and groups them by TemplateID
   */
  private async loadAllDropdownOptions() {
    try {
      const dropdownData = await firstValueFrom(
        this.caspioService.getServicesDTEDrop()
      );
      
      console.log('[DTE Category] Loaded dropdown data:', dropdownData?.length || 0, 'rows');
      
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
        
        console.log('[DTE Category] Grouped by TemplateID:', Object.keys(this.visualDropdownOptions).length, 'templates have options');
        console.log('[DTE Category] All TemplateIDs with options:', Object.keys(this.visualDropdownOptions));
        
        // Add "Other" option to all multi-select dropdowns if not already present
        Object.entries(this.visualDropdownOptions).forEach(([templateId, options]) => {
          const optionsArray = options as string[];
          if (!optionsArray.includes('Other')) {
            optionsArray.push('Other');
          }
          console.log(`[DTE Category] TemplateID ${templateId}: ${optionsArray.length} options -`, optionsArray.join(', '));
        });
      } else {
        console.warn('[DTE Category] No dropdown data received from API');
      }
    } catch (error) {
      console.error('[DTE Category] Error loading dropdown options:', error);
      // Continue without dropdown options - they're optional
    }
  }

  private async loadExistingVisuals() {
    try {
      // Load all existing HUD visuals for this service and category
      console.log('[LOAD EXISTING] ========== START ==========');
      console.log('[LOAD EXISTING] ServiceID:', this.serviceId);
      console.log('[LOAD EXISTING] Category to match:', this.categoryName);
      
      // CRITICAL: Bypass cache to get fresh data
      const allVisuals = await this.hudData.getVisualsByService(this.serviceId, true);
      console.log('[LOAD EXISTING] Total visuals from API (fresh, no cache):', allVisuals.length);
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
        console.log('[LOAD EXISTING] Visual DTEID:', visual.DTEID);
        console.log('[LOAD EXISTING] Visual Name:', visual.Name);
        console.log('[LOAD EXISTING] Visual Notes:', visual.Notes);
        console.log('[LOAD EXISTING] Visual Answers:', visual.Answers);
        console.log('[LOAD EXISTING] Visual Kind:', visual.Kind);
        
        // CRITICAL: Skip hidden visuals (soft delete - keeps photos but doesn't show in UI)
        if (visual.Notes && visual.Notes.startsWith('HIDDEN')) {
          console.log('[LOAD EXISTING] ⚠️ Skipping hidden visual:', visual.Name);
          
          // Store visualRecordId so we can unhide it later if user reselects
          const item = allItems.find(i => i.name === visual.Name);
          if (item) {
            const key = `${this.categoryName}_${item.id}`;
            const DTEID = String(visual.DTEID || visual.PK_ID);
            this.visualRecordIds[key] = DTEID;
            console.log('[LOAD EXISTING] Stored hidden visual ID for potential unhide:', key, '=', DTEID);
          }
          continue;
        }
        
        const name = visual.Name;
        const kind = visual.Kind;
        const DTEID = String(visual.DTEID || visual.PK_ID || visual.id);
        
        // Find the item by Name
        let item = allItems.find(i => i.name === visual.Name);
        
        // If no template match found, this is a CUSTOM visual - create dynamic item
        if (!item) {
          console.log('[LOAD EXISTING] Creating dynamic item for custom visual:', name, kind);

          // Create a dynamic VisualItem for custom visuals
          const customItem: VisualItem = {
            id: `custom_${DTEID}`,
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
        console.log('[LOAD EXISTING] DTEID to store:', DTEID);

        // Mark as selected
        this.selectedItems[key] = true;
        console.log('[LOAD EXISTING] ✅ selectedItems[' + key + '] = true');

        // Store visual record ID
        this.visualRecordIds[key] = DTEID;
        console.log('[LOAD EXISTING] ✅ visualRecordIds[' + key + '] = ' + DTEID);

        // Update item with saved answer
        item.answer = visual.Answers || '';
        item.otherValue = visual.OtherValue || '';
        console.log('[LOAD EXISTING] ✅ item.answer set to:', item.answer);

        // Force change detection to update UI
        this.changeDetectorRef.detectChanges();

        // Load photos for this visual
        await this.loadPhotosForVisual(DTEID, key);
      }

      console.log('[LOAD EXISTING] ========== FINAL STATE ==========');
      console.log('[LOAD EXISTING] visualRecordIds:', JSON.stringify(this.visualRecordIds));
      console.log('[LOAD EXISTING] selectedItems:', JSON.stringify(this.selectedItems));
      console.log('[LOAD EXISTING] Items with answers:', allItems.filter(i => i.answer).map(i => ({ name: i.name, answer: i.answer })));
      console.log('[LOAD EXISTING] ========== END ==========');

    } catch (error) {
      console.error('[LOAD EXISTING] ❌ Error loading existing visuals:', error);
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

  private async loadPhotosForVisual(DTEID: string, key: string) {
    try {
      this.loadingPhotosByKey[key] = true;

      // Get attachments from database
      const attachments = await this.hudData.getVisualAttachments(DTEID);

      console.log('[LOAD PHOTOS] Found', attachments.length, 'photos for HUD', DTEID, 'key:', key);

      // Set photo count immediately so skeleton loaders can be displayed
      this.photoCountsByKey[key] = attachments.length;

      if (attachments.length > 0) {
        // CRITICAL: Don't reset photo array if it already has photos from uploads
        if (!this.visualPhotos[key]) {
          this.visualPhotos[key] = [];
          console.log('[LOAD PHOTOS] Initialized empty photo array for', key);
        } else {
          console.log('[LOAD PHOTOS] Photo array already exists with', this.visualPhotos[key].length, 'photos');

          // Check if we already have all the photos loaded
          const loadedPhotoIds = new Set(this.visualPhotos[key].map(p => p.AttachID));
          const allPhotosLoaded = attachments.every(a => loadedPhotoIds.has(a.AttachID));
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
    
    console.log('[LOAD PHOTO] Loading:', attachId, 'key:', key);
    
    // TWO-FIELD APPROACH: Determine display state and URL
    let displayUrl = 'assets/img/photo-placeholder.png';
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
          existingPhoto.displayUrl !== 'assets/img/photo-placeholder.png') {
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
        r.endpoint?.includes('LPS_Services_DTE_Visuals') &&
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
    const key = `${category}_${itemId}`;
    const newState = !this.selectedItems[key];
    this.selectedItems[key] = newState;

    console.log('[TOGGLE] Item:', key, 'Selected:', newState);

    if (newState) {
      // Item was checked - create visual record if it doesn't exist, or unhide if it exists
      const visualId = this.visualRecordIds[key];
      if (visualId && !String(visualId).startsWith('temp_')) {
        // Visual exists but was hidden - unhide it
        this.savingItems[key] = true;
        try {
          await this.hudData.updateVisual(visualId, { Notes: '' });
          console.log('[TOGGLE] Unhid visual:', visualId);
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
          console.log('[TOGGLE] Hid visual (preserving photos):', visualId);
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
                    console.log('[DTE TEXT EDIT] Updated visual text:', visualId, data.description);
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

    console.log('[CREATE VISUAL] ✅ Found item:', { id: item.id, templateId: item.templateId, name: item.name });

    this.savingItems[key] = true;

    try {
      const hudData = {
        ServiceID: parseInt(this.serviceId),
        Category: category,
        Kind: item.type,
        Name: item.name,
        Text: item.text,
        Notes: '',
        Answers: item.answer || ''
      };

      console.log('[CREATE VISUAL] Creating HUD record with data:', hudData);
      console.log('[CREATE VISUAL] Item details:', { id: item.id, templateId: item.templateId, name: item.name, answer: item.answer });
      console.log('[CREATE VISUAL] Note: TemplateID is not stored in Services_DTE, only used for dropdown lookup');

      const result = await firstValueFrom(this.caspioService.createServicesDTE(hudData));
      
      console.log('[CREATE VISUAL] API response:', result);
      console.log('[CREATE VISUAL] Response type:', typeof result);
      console.log('[CREATE VISUAL] Has Result array?', !!result?.Result);
      console.log('[CREATE VISUAL] Has DTEID directly?', !!result?.DTEID);
      
      // Handle BOTH response formats: direct object OR wrapped in Result array
      let createdRecord = null;
      if (result && result.DTEID) {
        // Direct object format
        createdRecord = result;
        console.log('[CREATE VISUAL] Using direct result object');
      } else if (result && result.Result && result.Result.length > 0) {
        // Wrapped in Result array
        createdRecord = result.Result[0];
        console.log('[CREATE VISUAL] Using Result[0]');
      }
      
      if (createdRecord) {
        const DTEID = String(createdRecord.DTEID || createdRecord.PK_ID);
        
        // CRITICAL: Store the record ID
        this.visualRecordIds[key] = DTEID;
        this.selectedItems[key] = true;
        
        console.log('[CREATE VISUAL] ✅ Created with DTEID:', DTEID);
        console.log('[CREATE VISUAL] Stored in visualRecordIds[' + key + '] = ' + DTEID);
        console.log('[CREATE VISUAL] Created record full data:', createdRecord);
        console.log('[CREATE VISUAL] All visualRecordIds after creation:', JSON.stringify(this.visualRecordIds));
        console.log('[CREATE VISUAL] Verification - can retrieve:', this.visualRecordIds[key]);
        
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
      console.log('[DELETE VISUAL] No visual ID found, nothing to delete');
      return;
    }

    this.savingItems[key] = true;

    try {
      console.log('[DELETE VISUAL] Deleting HUD record:', visualId);
      await firstValueFrom(this.caspioService.deleteServicesDTE(visualId));
      
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
    const key = `${category}_${item.id}`;
    console.log('[ANSWER] Changed:', item.answer, 'for', key);

    this.savingItems[key] = true;

    try {
      // Create or update visual record
      let visualId = this.visualRecordIds[key];
      console.log('[ANSWER] Current visualId:', visualId);

      // If answer is empty/cleared, hide the visual instead of deleting
      if (!item.answer || item.answer === '') {
        if (visualId && !String(visualId).startsWith('temp_')) {
          await firstValueFrom(this.caspioService.updateServicesDTE(visualId, {
            Answers: '',
            Notes: 'HIDDEN'
          }));
          console.log('[ANSWER] Hid visual (preserved photos):', visualId);
        }
        this.savingItems[key] = false;
        this.changeDetectorRef.detectChanges();
        return;
      }

      if (!visualId) {
        // Create new visual
        console.log('[ANSWER] Creating new visual for key:', key);
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

        console.log('[ANSWER] Creating with data:', visualData);

        const result = await firstValueFrom(this.caspioService.createServicesDTE(visualData));
        
        console.log('[ANSWER] 🔍 RAW API RESPONSE:', result);
        
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
          
          console.log('[ANSWER] ✅ Created visual with DTEID:', visualId);
          console.log('[ANSWER] ✅ Stored as visualRecordIds[' + key + '] =', visualId);
        } else {
          console.error('[ANSWER] ❌ FAILED to extract DTEID from response!');
        }
      } else if (!String(visualId).startsWith('temp_')) {
        // Update existing visual and unhide if it was hidden
        console.log('[ANSWER] Updating existing visual:', visualId);
        await firstValueFrom(this.caspioService.updateServicesDTE(visualId, {
          Answers: item.answer || '',
          Notes: ''
        }));
        console.log('[ANSWER] ✅ Updated visual:', visualId, 'with Answers:', item.answer);
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
      console.log('[OPTION] Current visualId for key', key, ':', visualId);

      // If all options are unchecked AND no "Other" value, hide the visual
      if ((!item.answer || item.answer === '') && (!item.otherValue || item.otherValue === '')) {
        if (visualId && !String(visualId).startsWith('temp_')) {
          await firstValueFrom(this.caspioService.updateServicesDTE(visualId, {
            Answers: '',
            Notes: 'HIDDEN'
          }));
          console.log('[OPTION] Hid visual (preserved photos):', visualId);
        }
        this.savingItems[key] = false;
        this.changeDetectorRef.detectChanges();
        return;
      }

      if (!visualId) {
        // Create new visual
        console.log('[OPTION] Creating new visual for key:', key);
        const serviceIdNum = parseInt(this.serviceId, 10);
        const visualData = {
          ServiceID: serviceIdNum,
          Category: category,
          Kind: item.type,
          Name: item.name,
          Text: item.text || item.originalText || '',
          Notes: item.otherValue || '',
          Answers: item.answer
        };

        console.log('[OPTION] Creating with data:', visualData);

        const result = await firstValueFrom(this.caspioService.createServicesDTE(visualData));
        
        console.log('[OPTION] 🔍 RAW API RESPONSE:', result);
        console.log('[OPTION] 🔍 Response type:', typeof result);
        console.log('[OPTION] 🔍 Has Result property?', result && 'Result' in result);
        console.log('[OPTION] 🔍 result.Result:', result?.Result);
        
        // Try multiple ways to extract the DTEID
        if (result && result.Result && result.Result.length > 0) {
          visualId = String(result.Result[0].DTEID || result.Result[0].PK_ID || result.Result[0].id);
          console.log('[OPTION] 🔍 Extracted visualId from result.Result[0]:', visualId);
        } else if (result && Array.isArray(result) && result.length > 0) {
          visualId = String(result[0].DTEID || result[0].PK_ID || result[0].id);
          console.log('[OPTION] 🔍 Extracted visualId from result[0]:', visualId);
        } else if (result) {
          visualId = String(result.DTEID || result.PK_ID || result.id);
          console.log('[OPTION] 🔍 Extracted visualId from result:', visualId);
        }
        
        if (visualId) {
          this.visualRecordIds[key] = visualId;
          this.selectedItems[key] = true;
          
          // Initialize photo array
          this.visualPhotos[key] = [];
          this.photoCountsByKey[key] = 0;
          
          console.log('[OPTION] ✅ Created visual with DTEID:', visualId);
          console.log('[OPTION] ✅ Stored as visualRecordIds[' + key + '] =', visualId);
          console.log('[OPTION] ✅ Verification - can retrieve:', this.visualRecordIds[key]);
        } else {
          console.error('[OPTION] ❌ FAILED to extract DTEID from response!');
        }
      } else if (!String(visualId).startsWith('temp_')) {
        // Update existing visual
        console.log('[OPTION] Updating existing visual:', visualId);
        const notesValue = item.otherValue || '';
        await firstValueFrom(this.caspioService.updateServicesDTE(visualId, {
          Answers: item.answer,
          Notes: notesValue
        }));
        console.log('[OPTION] ✅ Updated visual:', visualId, 'with Answers:', item.answer);
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

          // Check if this is a temp ID (offline mode) or real ID
          const visualIsTempId = String(visualId).startsWith('temp_');
          const visualIdNum = parseInt(visualId, 10);
          const isOfflineMode = isNaN(visualIdNum) || visualIsTempId;

          console.log('[CAMERA UPLOAD] Visual ID:', visualId, 'isOffline:', isOfflineMode);

          // Initialize photo array if it doesn't exist
          if (!this.visualPhotos[key]) {
            this.visualPhotos[key] = [];
          }

          // Create photo placeholder for immediate UI feedback
          const tempId = `temp_camera_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const objectUrl = URL.createObjectURL(blob);

          const photoEntry = {
            AttachID: tempId,
            id: tempId,
            _pendingFileId: tempId,
            name: 'camera-photo.jpg',
            url: objectUrl,
            originalUrl: objectUrl,
            thumbnailUrl: objectUrl,
            isObjectUrl: true,
            uploading: !isOfflineMode,
            queued: isOfflineMode,
            isSkeleton: false,
            hasAnnotations: !!annotationsData,
            caption: caption || '',
            annotation: caption || '',
            progress: 0
          };

          // Add photo to UI immediately
          this.visualPhotos[key].push(photoEntry);
          this.changeDetectorRef.detectChanges();
          console.log('[CAMERA UPLOAD] Added photo placeholder, offline:', isOfflineMode);

          // Serialize and compress annotations data for IndexedDB storage
          let drawingsString = '';
          if (annotationsData) {
            try {
              const { compressAnnotationData } = await import('../../../utils/annotation-utils');
              const rawData = typeof annotationsData === 'string'
                ? annotationsData
                : JSON.stringify(annotationsData);
              drawingsString = compressAnnotationData(rawData);
              console.log('[CAMERA UPLOAD] Compressed annotations:', drawingsString.length, 'chars');
            } catch (e) {
              console.error('[CAMERA UPLOAD] Failed to serialize annotations:', e);
            }
          }

          // Store photo WITH drawings in IndexedDB for offline support
          await this.indexedDb.storePhotoFile(tempId, originalFile, String(visualId), caption, drawingsString);
          console.log('[CAMERA UPLOAD] Photo stored in IndexedDB with drawings');

          // Queue the upload request in IndexedDB (survives app restart)
          await this.indexedDb.addPendingRequest({
            type: 'UPLOAD_FILE',
            tempId: tempId,
            endpoint: 'VISUAL_PHOTO_UPLOAD',
            method: 'POST',
            data: {
              visualId: visualId,
              tempVisualId: visualIsTempId ? visualId : undefined,
              fileId: tempId,
              caption: caption || '',
              drawings: drawingsString,
              fileName: originalFile.name,
              fileSize: originalFile.size,
            },
            dependencies: [],
            status: 'pending',
            priority: 'high',
          });

          console.log('[CAMERA UPLOAD] Photo queued in IndexedDB for background sync');

          // If online, also add to in-memory queue for immediate upload attempt
          if (!isOfflineMode) {
            const uploadFn = async (vId: number, photo: File, cap: string) => {
              console.log('[CAMERA UPLOAD] Uploading photo via background service');
              const result = await this.performVisualPhotoUpload(vId, photo, key, true, null, null, tempId, cap);

              if (result) {
                // In-memory upload succeeded - mark IndexedDB request as synced to prevent duplicate
                try {
                  const pendingRequests = await this.indexedDb.getPendingRequests();
                  const matchingRequest = pendingRequests.find(r =>
                    r.tempId === tempId && r.endpoint === 'VISUAL_PHOTO_UPLOAD'
                  );
                  if (matchingRequest) {
                    await this.indexedDb.updateRequestStatus(matchingRequest.requestId, 'synced');
                    await this.indexedDb.deleteStoredFile(tempId);
                    console.log('[CAMERA UPLOAD] Marked IndexedDB request as synced, cleaned up stored file');
                  }
                } catch (cleanupError) {
                  console.warn('[CAMERA UPLOAD] Failed to cleanup IndexedDB:', cleanupError);
                }
              }

              // If there are annotations, save them after upload completes
              if (annotationsData && result) {
                try {
                  console.log('[CAMERA UPLOAD] Saving annotations for AttachID:', result);
                  await this.saveAnnotationToDatabase(result, annotatedBlob, annotationsData, cap);

                  const displayUrl = URL.createObjectURL(annotatedBlob);
                  const photos = this.visualPhotos[key] || [];
                  const photoIndex = photos.findIndex(p => p.AttachID === result);
                  if (photoIndex !== -1) {
                    this.visualPhotos[key][photoIndex] = {
                      ...this.visualPhotos[key][photoIndex],
                      displayUrl: displayUrl,
                      hasAnnotations: true,
                      annotations: annotationsData,
                      annotationsData: annotationsData
                    };
                    this.changeDetectorRef.detectChanges();
                    console.log('[CAMERA UPLOAD] Annotations saved and display updated');
                  }
                } catch (error) {
                  console.error('[CAMERA UPLOAD] Error saving annotations:', error);
                }
              }

              return result;
            };

            // Add to in-memory background upload queue for immediate attempt
            this.backgroundUploadService.addToQueue(
              visualIdNum,
              originalFile,
              key,
              caption,
              tempId,
              uploadFn
            );

            console.log('[CAMERA UPLOAD] Photo queued for immediate background upload');
          } else {
            // Sync will happen on next 60-second interval (batched sync)
            console.log('[CAMERA UPLOAD] Photo queued for background sync (offline mode)');
          }
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
        const key = `${category}_${itemId}`;

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
            url: 'assets/img/photo-placeholder.png',
            thumbnailUrl: 'assets/img/photo-placeholder.png',
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

        const visualIdNum = parseInt(visualId, 10);
        if (isNaN(visualIdNum)) {
          console.error('[GALLERY UPLOAD] Invalid HUD ID:', visualId);
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

        console.log('[GALLERY UPLOAD] ✅ Valid HUD ID found:', visualIdNum);

        // CRITICAL: Process photos SEQUENTIALLY
        setTimeout(async () => {
          for (let i = 0; i < images.photos.length; i++) {
            const image = images.photos[i];
            const skeleton = skeletonPhotos[i];

            if (image.webPath) {
              try {
                console.log(`[GALLERY UPLOAD] Processing photo ${i + 1}/${images.photos.length}`);

                // Fetch the blob
                const response = await fetch(image.webPath);
                const blob = await response.blob();
                const file = new File([blob], `gallery-${Date.now()}_${i}.jpg`, { type: 'image/jpeg' });

                // Convert blob to data URL for persistent offline storage
                const dataUrl = await this.blobToDataUrl(blob);

                // Update skeleton to show preview + queued state
                const skeletonIndex = this.visualPhotos[key]?.findIndex(p => p.AttachID === skeleton.AttachID);
                if (skeletonIndex !== -1 && this.visualPhotos[key]) {
                  this.visualPhotos[key][skeletonIndex] = {
                    ...this.visualPhotos[key][skeletonIndex],
                    url: dataUrl,
                    thumbnailUrl: dataUrl,
                    isObjectUrl: false,
                    uploading: true,
                    isSkeleton: false,
                    progress: 0,
                    _pendingFileId: skeleton.AttachID  // Track for IndexedDB retrieval
                  };
                  this.changeDetectorRef.detectChanges();
                  console.log(`[GALLERY UPLOAD] Updated skeleton ${i + 1} to show preview (data URL)`);
                }

                // CRITICAL: Store photo in IndexedDB for offline support
                await this.indexedDb.storePhotoFile(skeleton.AttachID, file, visualId, '', '');
                console.log(`[GALLERY UPLOAD] Photo ${i + 1} stored in IndexedDB`);

                // Queue the upload request in IndexedDB (survives app restart)
                await this.indexedDb.addPendingRequest({
                  type: 'UPLOAD_FILE',
                  tempId: skeleton.AttachID,
                  endpoint: 'VISUAL_PHOTO_UPLOAD',
                  method: 'POST',
                  data: {
                    visualId: visualIdNum,
                    fileId: skeleton.AttachID,
                    caption: '',
                    drawings: '',
                    fileName: file.name,
                    fileSize: file.size,
                  },
                  dependencies: [],
                  status: 'pending',
                  priority: 'high',
                });

                // Add to in-memory background upload queue for immediate attempt
                const uploadFn = async (vId: number, photo: File, caption: string) => {
                  console.log(`[GALLERY UPLOAD] Uploading photo ${i + 1}/${images.photos.length}`);
                  const result = await this.performVisualPhotoUpload(vId, photo, key, true, null, null, skeleton.AttachID, caption);

                  if (result) {
                    // In-memory upload succeeded - mark IndexedDB request as synced
                    try {
                      const pendingRequests = await this.indexedDb.getPendingRequests();
                      const matchingRequest = pendingRequests.find(r =>
                        r.tempId === skeleton.AttachID && r.endpoint === 'VISUAL_PHOTO_UPLOAD'
                      );
                      if (matchingRequest) {
                        await this.indexedDb.updateRequestStatus(matchingRequest.requestId, 'synced');
                        await this.indexedDb.deleteStoredFile(skeleton.AttachID);
                        console.log(`[GALLERY UPLOAD] Marked IndexedDB request as synced for photo ${i + 1}`);
                      }
                    } catch (cleanupError) {
                      console.warn('[GALLERY UPLOAD] Failed to cleanup IndexedDB:', cleanupError);
                    }
                  }

                  return result;
                };

                this.backgroundUploadService.addToQueue(
                  visualIdNum,
                  file,
                  key,
                  '', // caption
                  skeleton.AttachID,
                  uploadFn
                );

                // NOTE: Don't call triggerSync() here - the in-memory upload service handles it
                // triggerSync would cause duplicate uploads when both services try to upload the same photo

                console.log(`[GALLERY UPLOAD] Photo ${i + 1}/${images.photos.length} queued for upload (in-memory queue)`);

              } catch (error) {
                console.error(`[GALLERY UPLOAD] Error processing photo ${i + 1}:`, error);

                // Mark the photo as failed
                const photoIndex = this.visualPhotos[key]?.findIndex(p => p.AttachID === skeleton.AttachID);
                if (photoIndex !== -1 && this.visualPhotos[key]) {
                  this.visualPhotos[key][photoIndex].uploading = false;
                  this.visualPhotos[key][photoIndex].uploadFailed = true;
                  this.changeDetectorRef.detectChanges();
                }
              }
            }
          }

          console.log(`[GALLERY UPLOAD] All ${images.photos.length} photos queued successfully`);

        }, 150); // Small delay to ensure skeletons render
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
      console.log(`[DTE PHOTO UPLOAD] Starting upload for DTEID ${DTEID}`);

      // Upload photo using HUD service
      const result = await this.hudData.uploadVisualPhoto(DTEID, photo, caption);

      console.log(`[DTE PHOTO UPLOAD] Upload complete for DTEID ${DTEID}`);
      console.log(`[DTE PHOTO UPLOAD] Full result object:`, JSON.stringify(result, null, 2));
      console.log(`[DTE PHOTO UPLOAD] Result.Result:`, result.Result);
      console.log(`[DTE PHOTO UPLOAD] AttachID:`, result.AttachID || result.Result?.[0]?.AttachID);
      console.log(`[DTE PHOTO UPLOAD] Photo path:`, result.Photo || result.Result?.[0]?.Photo);

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

          console.log('[DTE PHOTO UPLOAD] Actual result:', actualResult);
          console.log('[DTE PHOTO UPLOAD] S3 key:', s3Key);
          console.log('[DTE PHOTO UPLOAD] Uploaded photo path (old):', uploadedPhotoUrl);

          // Check if this is an S3 image
          if (s3Key && this.caspioService.isS3Key(s3Key)) {
            try {
              console.log('[DTE PHOTO UPLOAD] ✨ S3 image detected, fetching pre-signed URL...');
              displayableUrl = await this.caspioService.getS3FileUrl(s3Key);
              console.log('[DTE PHOTO UPLOAD] ✅ Got S3 pre-signed URL');
            } catch (err) {
              console.error('[DTE PHOTO UPLOAD] ❌ Failed to fetch S3 URL:', err);
              displayableUrl = 'assets/img/photo-placeholder.png';
            }
          }
          // Fallback to old Caspio Files API logic
          else if (uploadedPhotoUrl && !uploadedPhotoUrl.startsWith('data:') && !uploadedPhotoUrl.startsWith('blob:')) {
            try {
              console.log('[DTE PHOTO UPLOAD] 📁 Caspio Files API path detected, fetching image data...');
              const imageData = await firstValueFrom(
                this.caspioService.getImageFromFilesAPI(uploadedPhotoUrl)
              );
              console.log('[DTE PHOTO UPLOAD] Files API response:', imageData?.substring(0, 100));
              
              if (imageData && imageData.startsWith('data:')) {
                displayableUrl = imageData;
                console.log('[DTE PHOTO UPLOAD] ✅ Successfully converted to data URL, length:', imageData.length);
              } else {
                console.warn('[DTE PHOTO UPLOAD] ❌ Files API returned invalid data');
                displayableUrl = 'assets/img/photo-placeholder.png';
              }
            } catch (err) {
              console.error('[DTE PHOTO UPLOAD] ❌ Failed to fetch image from Files API:', err);
              displayableUrl = 'assets/img/photo-placeholder.png';
            }
          } else {
            console.log('[DTE PHOTO UPLOAD] Using URL directly (already data/blob URL)');
          }

          console.log('[DTE PHOTO UPLOAD] Final displayableUrl length:', displayableUrl?.length || 0);
          console.log('[DTE PHOTO UPLOAD] Updating photo at index', photoIndex);

          // Get AttachID from the actual result
          const attachId = actualResult.AttachID || actualResult.PK_ID || actualResult.id;
          console.log('[DTE PHOTO UPLOAD] Using AttachID:', attachId);

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

          console.log('[DTE PHOTO UPLOAD] ✅ Photo object updated:', {
            AttachID: this.visualPhotos[key][photoIndex].AttachID,
            hasUrl: !!this.visualPhotos[key][photoIndex].url,
            hasThumbnail: !!this.visualPhotos[key][photoIndex].thumbnailUrl,
            hasDisplay: !!this.visualPhotos[key][photoIndex].displayUrl,
            urlLength: this.visualPhotos[key][photoIndex].url?.length || 0
          });

          this.changeDetectorRef.detectChanges();
          console.log('[DTE PHOTO UPLOAD] ✅ Change detection triggered');
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
            console.log('[SAVE ANNOTATION] Compressed from', drawingsData.length, 'to', compressedDrawings.length, 'bytes');
          } catch (e) {
            console.error('[SAVE] Compression failed:', e);
            compressedDrawings = drawingsData;
          }
        }

        updateData.Drawings = compressedDrawings;
      }
    }

    // Update the HUD attach record
    await firstValueFrom(this.caspioService.updateServicesDTEAttach(attachId, updateData));
    console.log('[SAVE ANNOTATION] ✅ Annotations saved successfully');

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
    target.src = 'assets/img/photo-placeholder.png';
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
                    console.log('[CAPTION] Saved caption for photo:', photo.AttachID);
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
      let imageUrl = photo.url || photo.thumbnailUrl || 'assets/img/photo-placeholder.png';

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
      else if ((!imageUrl || imageUrl === 'assets/img/photo-placeholder.png') && (photo.filePath || photo.Photo || photo.Attachment)) {
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
      const originalImageUrl = photo.originalUrl || photo.url || imageUrl;

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
                  const key = `${category}_${itemId}`;

                  // Remove from UI immediately using filter
                  if (this.visualPhotos[key]) {
                    this.visualPhotos[key] = this.visualPhotos[key].filter(
                      (p: any) => p.AttachID !== photo.AttachID
                    );
                  }

                  // Delete from database
                  if (photo.AttachID && !String(photo.AttachID).startsWith('temp_')) {
                    await this.hudData.deleteVisualPhoto(photo.AttachID);
                  }

                  // Force UI update
                  this.changeDetectorRef.detectChanges();

                  await loading.dismiss();
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
        Notes: ''
      };

      console.log('[CREATE CUSTOM] Creating HUD visual:', hudData);

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

      console.log('[CREATE CUSTOM] Created HUD visual with ID:', visualId);

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

      console.log('[CREATE CUSTOM] Stored DTEID:', key, '=', visualId);

      // Upload photos if provided
      if (files && files.length > 0) {
        console.log('[CREATE CUSTOM] Uploading', files.length, 'photos');

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

        console.log('[CREATE CUSTOM] Added', tempPhotos.length, 'placeholder photos');

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
      console.log('[CREATE CUSTOM] ✅ Custom visual created successfully');

    } catch (error) {
      console.error('[CREATE CUSTOM] Error:', error);
      await this.showToast('Failed to create custom item', 'danger');
    }
  }
}

