import { Component, OnInit, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController, AlertController, ActionSheetController, ModalController, IonContent } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CaspioService } from '../../../../services/caspio.service';
import { OfflineService } from '../../../../services/offline.service';
import { CameraService } from '../../../../services/camera.service';
import { ImageCompressionService } from '../../../../services/image-compression.service';
import { EngineersFoundationDataService } from '../../engineers-foundation-data.service';
import { FabricPhotoAnnotatorComponent } from '../../../../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

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
export class CategoryDetailPage implements OnInit {
  projectId: string = '';
  serviceId: string = '';
  categoryName: string = '';

  loading: boolean = true;
  searchTerm: string = '';
  expandedAccordions: string[] = [];
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
  currentUploadContext: { category: string; itemId: string; action: string } | null = null;
  contextClearTimer: any = null;
  lockedScrollY: number = 0;
  private _loggedPhotoKeys = new Set<string>();

  // Background upload queue
  backgroundUploadQueue: Array<() => Promise<void>> = [];
  activeUploadCount: number = 0;
  maxParallelUploads: number = 2;

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
    private foundationData: EngineersFoundationDataService
  ) {}

  async ngOnInit() {
    // Get category name from route
    this.route.params.subscribe(params => {
      this.categoryName = params['category'];

      // Get IDs from container route
      // Route structure: engineers-foundation/:projectId/:serviceId -> structural -> category/:category (we are here)
      // So we need to go up 3 levels to get to container
      this.route.parent?.parent?.parent?.params.subscribe(parentParams => {
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

  private async loadData() {
    this.loading = true;

    try {
      // Load templates for this category (fast - just structure)
      await this.loadCategoryTemplates();

      // Start loading existing visuals (don't await - fire in background)
      this.loadExistingVisuals();

      // Poll every second until all skeleton loaders are ready
      await this.waitForSkeletonsReady();

      // Show page with skeleton loaders visible
      this.loading = false;

      // Images continue loading progressively in the background

    } catch (error) {
      console.error('Error loading category data:', error);
      this.loading = false;
    }
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

  private async loadCategoryTemplates() {
    try {
      // Get all templates for TypeID = 1 (Foundation Evaluation)
      const allTemplates = await this.caspioService.getServicesVisualsTemplates().toPromise();
      const visualTemplates = (allTemplates || []).filter((template: any) =>
        template.TypeID === 1 && template.Category === this.categoryName
      );

      // Organize templates by Type
      visualTemplates.forEach((template: any) => {
        const templateData: VisualItem = {
          id: template.PK_ID,
          templateId: template.PK_ID,
          name: template.Name || 'Unnamed Item',
          text: template.Text || '',
          originalText: template.Text || '',
          type: template.Type || 'Comment',
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
            console.error('Error parsing dropdown options for template', template.PK_ID, e);
            this.visualDropdownOptions[template.PK_ID] = [];
          }
        }

        // Add to appropriate section based on Kind field (not Type field)
        const kind = template.Kind || template.Type || 'Comment';
        console.log('[LOAD TEMPLATES] Item:', template.Name, 'Kind:', kind, 'Type:', template.Type);

        if (kind === 'Comment') {
          this.organizedData.comments.push(templateData);
        } else if (kind === 'Limitation') {
          this.organizedData.limitations.push(templateData);
        } else if (kind === 'Deficiency') {
          this.organizedData.deficiencies.push(templateData);
        } else {
          // Default to comments if type is unknown
          console.warn('[LOAD TEMPLATES] Unknown kind:', kind, 'for item:', template.Name);
          this.organizedData.comments.push(templateData);
        }

        // Initialize selected state
        this.selectedItems[`${this.categoryName}_${template.PK_ID}`] = false;
      });

      console.log('[LOAD TEMPLATES] Organized data:', {
        comments: this.organizedData.comments.length,
        limitations: this.organizedData.limitations.length,
        deficiencies: this.organizedData.deficiencies.length
      });

    } catch (error) {
      console.error('Error loading category templates:', error);
    }
  }

  private async loadExistingVisuals() {
    try {
      console.log('[LOAD VISUALS] Loading existing visuals for serviceId:', this.serviceId);

      // Get all visuals for this service
      const visuals = await this.foundationData.getVisualsByService(this.serviceId);

      console.log('[LOAD VISUALS] Found', visuals.length, 'existing visuals');

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

        // CRITICAL: Set loading state and placeholder count IMMEDIATELY so skeletons show right away
        // This prevents the page from jumping as photos load
        this.loadingPhotosByKey[key] = true;
        this.photoCountsByKey[key] = 1; // Placeholder - will be updated with real count

        // Load photos for this visual in background (don't await)
        this.loadPhotosForVisual(visualId, key).catch(err => {
          console.error('[LOAD VISUALS] Error loading photos for visual:', visualId, err);
        });
      }

      console.log('[LOAD VISUALS] Finished processing existing visuals');

      // Trigger change detection immediately so skeletons appear right away
      this.changeDetectorRef.detectChanges();

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

    return allItems.find(item =>
      item.name === name &&
      item.category === category &&
      item.type === kind
    );
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

  private async loadPhotosForVisual(visualId: string, key: string) {
    try {
      this.loadingPhotosByKey[key] = true;

      // Get attachment count first (this is fast - just metadata)
      const attachments = await this.foundationData.getVisualAttachments(visualId);

      console.log('[LOAD PHOTOS] Found', attachments.length, 'photos for visual', visualId);

      // Set photo count immediately so skeleton loaders can be displayed
      this.photoCountsByKey[key] = attachments.length;

      if (attachments.length > 0) {
        // Initialize photo array with placeholders (shows skeleton loaders)
        this.visualPhotos[key] = [];

        // Trigger change detection so skeletons appear
        this.changeDetectorRef.detectChanges();

        // Load each photo progressively - show as soon as ready instead of waiting for all
        for (let i = 0; i < attachments.length; i++) {
          const attach = attachments[i];

          // Process this photo in the background
          this.loadSinglePhoto(attach, key).catch(err => {
            console.error('[LOAD PHOTOS] Failed to load photo:', attach.AttachID, err);
          });
        }
      } else {
        this.loadingPhotosByKey[key] = false;
        this.changeDetectorRef.detectChanges();
      }

    } catch (error) {
      console.error('[LOAD PHOTOS] Error loading photos for visual', visualId, error);
      this.loadingPhotosByKey[key] = false;
      this.photoCountsByKey[key] = 0; // Set to 0 on error so we don't wait forever
      this.changeDetectorRef.detectChanges();
    }
  }

  private async loadSinglePhoto(attach: any, key: string) {
    const filePath = attach.Photo;
    let imageUrl = '';

    // Convert file path to base64 image using Files API
    if (filePath) {
      try {
        const imageData = await firstValueFrom(
          this.caspioService.getImageFromFilesAPI(filePath)
        );
        if (imageData && imageData.startsWith('data:')) {
          imageUrl = imageData;
        }
      } catch (err) {
        console.error('[LOAD PHOTOS] Failed to load image:', filePath, err);
        imageUrl = 'assets/img/photo-placeholder.png';
      }
    }

    const hasDrawings = !!attach.Drawings;
    console.log('[LOAD PHOTO] AttachID:', attach.AttachID, 'Has Drawings:', hasDrawings, 'Drawings length:', attach.Drawings?.length || 0);

    const photoData = {
      AttachID: attach.AttachID,
      id: attach.AttachID,
      name: attach.Photo || 'photo.jpg',
      filePath: filePath,
      Photo: filePath,
      url: imageUrl,
      originalUrl: imageUrl,        // CRITICAL: Set originalUrl to base image
      thumbnailUrl: imageUrl,
      displayUrl: imageUrl,          // Will be overwritten with annotated version if user annotates
      caption: attach.Annotation || '',
      annotation: attach.Annotation || '',
      Annotation: attach.Annotation || '',
      hasAnnotations: hasDrawings,
      annotations: null,              // Don't set this to compressed string - will be decompressed on view
      Drawings: attach.Drawings || null,  // CRITICAL: Store original Drawings field
      rawDrawingsString: attach.Drawings || null,  // CRITICAL: Store for decompression
      uploading: false,
      queued: false,
      isObjectUrl: false
    };

    // Add photo to array as soon as it's ready
    if (!this.visualPhotos[key]) {
      this.visualPhotos[key] = [];
    }
    this.visualPhotos[key].push(photoData);

    // Check if all photos for this item are loaded
    if (this.visualPhotos[key].length === this.photoCountsByKey[key]) {
      this.loadingPhotosByKey[key] = false;
      console.log('[LOAD PHOTOS] All photos loaded for', key);
    }

    // Trigger change detection to show this photo
    this.changeDetectorRef.detectChanges();
  }

  // Item selection for checkbox-based items (answerType 0)
  isItemSelected(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.selectedItems[key] || false;
  }

  async toggleItemSelection(category: string, itemId: string | number) {
    const key = `${category}_${itemId}`;
    const newState = !this.selectedItems[key];
    this.selectedItems[key] = newState;

    console.log('[TOGGLE] Item:', key, 'Selected:', newState);

    if (newState) {
      // Item was checked - create visual record if it doesn't exist
      if (!this.visualRecordIds[key]) {
        this.savingItems[key] = true;
        await this.saveVisualSelection(category, itemId);
        this.savingItems[key] = false;
      }
    } else {
      // Item was unchecked - delete visual record if it exists
      const visualId = this.visualRecordIds[key];
      if (visualId && !String(visualId).startsWith('temp_')) {
        this.savingItems[key] = true;
        try {
          await this.foundationData.deleteVisual(visualId);
          delete this.visualRecordIds[key];
          delete this.visualPhotos[key];
          console.log('[TOGGLE] Deleted visual:', visualId);
        } catch (error) {
          console.error('[TOGGLE] Error deleting visual:', error);
          // Revert selection on error
          this.selectedItems[key] = true;
          await this.showToast('Failed to remove selection', 'danger');
        }
        this.savingItems[key] = false;
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
        // Update existing visual
        await this.foundationData.updateVisual(visualId, {
          Answers: item.answer || ''
        });
        console.log('[ANSWER] Updated visual:', visualId);
      }
    } catch (error) {
      console.error('[ANSWER] Error saving answer:', error);
      await this.showToast('Failed to save answer', 'danger');
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
        // Update existing visual
        await this.foundationData.updateVisual(visualId, {
          Answers: item.answer,
          Notes: item.otherValue || ''
        });
        console.log('[OPTION] Updated visual:', visualId);
      }
    } catch (error) {
      console.error('[OPTION] Error saving option:', error);
      await this.showToast('Failed to save option', 'danger');
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
        // Update existing visual
        await this.foundationData.updateVisual(visualId, {
          Notes: item.otherValue || ''
        });
        console.log('[OTHER] Updated visual:', visualId);
      }
    } catch (error) {
      console.error('[OTHER] Error saving other value:', error);
      await this.showToast('Failed to save other value', 'danger');
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

  trackByPhotoId(index: number, photo: any): any {
    return photo.AttachID || photo.id || index;
  }

  handleImageError(event: any, photo: any) {
    console.error('Image failed to load:', photo);
    event.target.src = 'assets/img/photo-placeholder.png';
  }

  saveScrollBeforePhotoClick(event: Event): void {
    // This method is still called from HTML but now handled in viewPhoto() instead
    // Keeping the method to avoid template errors
  }

  // ============================================
  // CAMERA AND GALLERY CAPTURE METHODS
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

          if (visualId) {
            // Upload the ORIGINAL photo WITHOUT annotations baked in and get the AttachID
            const attachId = await this.uploadPhotoForVisual(visualId, originalFile, key, true, null, null, caption);

            // If there are annotations and we got an AttachID, save them immediately
            if (annotationsData && attachId) {
              try {
                console.log('[CAMERA UPLOAD] Saving annotations for AttachID:', attachId);

                // Save annotations to database
                await this.saveAnnotationToDatabase(attachId, annotatedBlob, annotationsData, caption);

                // Create display URL with annotations
                const displayUrl = URL.createObjectURL(annotatedBlob);

                // Update photo object to show annotations
                const photos = this.visualPhotos[key] || [];
                const photoIndex = photos.findIndex(p => p.AttachID === attachId);
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
                } else {
                  console.warn('[CAMERA UPLOAD] Could not find photo at index for AttachID:', attachId);
                }
              } catch (error) {
                console.error('[CAMERA UPLOAD] Error saving annotations:', error);
              }
            }
          }
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
        await this.showToast('Failed to capture photo', 'danger');
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
        this.currentUploadContext = {
          category,
          itemId: String(itemId),
          action: 'add'
        };

        const key = `${category}_${itemId}`;
        let visualId = this.visualRecordIds[key];

        if (!visualId) {
          await this.saveVisualSelection(category, itemId);
          visualId = this.visualRecordIds[key];
        }

        if (visualId) {
          // Initialize photo array if it doesn't exist
          if (!this.visualPhotos[key]) {
            this.visualPhotos[key] = [];
          }

          console.log('[GALLERY UPLOAD] Starting upload for', images.photos.length, 'photos');

          // CRITICAL: Create skeleton placeholders IMMEDIATELY so user sees instant feedback
          const skeletonPhotos = images.photos.map((image, i) => {
            const tempId = `temp_skeleton_${Date.now()}_${i}`;
            return {
              AttachID: tempId,
              id: tempId,
              name: `photo_${i}.jpg`,
              url: 'assets/img/photo-placeholder.png', // Skeleton state
              thumbnailUrl: 'assets/img/photo-placeholder.png',
              isObjectUrl: false,
              uploading: false, // Will be set to true when we have the actual blob
              isSkeleton: true, // Mark as skeleton
              hasAnnotations: false,
              caption: '',
              annotation: ''
            };
          });

          // Add all skeleton placeholders to UI immediately
          this.visualPhotos[key].push(...skeletonPhotos);
          this.changeDetectorRef.detectChanges();
          console.log('[GALLERY UPLOAD] Added', skeletonPhotos.length, 'skeleton placeholders');

          // Now fetch blobs and upload in the background
          images.photos.forEach(async (image, i) => {
            if (image.webPath) {
              try {
                // Fetch the blob
                const response = await fetch(image.webPath);
                const blob = await response.blob();
                const file = new File([blob], `gallery-${Date.now()}_${i}.jpg`, { type: 'image/jpeg' });

                // Create object URL for preview
                const objectUrl = URL.createObjectURL(blob);

                // Find the skeleton placeholder and update it to show preview + uploading state
                const skeletonIndex = this.visualPhotos[key]?.findIndex(p => p.AttachID === skeletonPhotos[i].AttachID);
                if (skeletonIndex !== -1 && this.visualPhotos[key]) {
                  this.visualPhotos[key][skeletonIndex] = {
                    ...this.visualPhotos[key][skeletonIndex],
                    url: objectUrl,
                    thumbnailUrl: objectUrl,
                    isObjectUrl: true,
                    uploading: true, // Now show uploading spinner
                    isSkeleton: false
                  };
                  this.changeDetectorRef.detectChanges();
                  console.log('[GALLERY UPLOAD] Updated skeleton', i, 'to show preview + uploading state');
                }

                // Upload the photo, passing the skeleton tempId so it updates the existing placeholder
                console.log('[GALLERY UPLOAD] Uploading photo', i + 1);
                await this.uploadPhotoForVisual(visualId, file, key, true, null, null, '', skeletonPhotos[i].AttachID);
              } catch (error) {
                console.error('[GALLERY UPLOAD] Error uploading photo', i + 1, ':', error);

                // Mark the photo as failed
                const photoIndex = this.visualPhotos[key]?.findIndex(p => p.AttachID === skeletonPhotos[i].AttachID);
                if (photoIndex !== -1 && this.visualPhotos[key]) {
                  this.visualPhotos[key][photoIndex].uploading = false;
                  this.visualPhotos[key][photoIndex].uploadFailed = true;
                  this.changeDetectorRef.detectChanges();
                }
              }
            }
          });
        }

        this.currentUploadContext = null;
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
        await this.showToast('Failed to select photo', 'danger');
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
      await this.showToast('Failed to prepare photo upload', 'danger');
      return null;
    }
  }

  private async performVisualPhotoUpload(visualId: number, photo: File, key: string, isBatchUpload: boolean, annotationData: any, originalPhoto: File | null, tempId: string | undefined, caption: string): Promise<string | null> {
    try {
      console.log(`[PHOTO UPLOAD] Starting upload for VisualID ${visualId}`);

      const result = await this.foundationData.uploadVisualPhoto(visualId, photo, caption);

      console.log(`[PHOTO UPLOAD] Upload complete for VisualID ${visualId}, AttachID: ${result.AttachID}`);

      if (tempId && this.visualPhotos[key]) {
        const photoIndex = this.visualPhotos[key].findIndex(p => p.AttachID === tempId || p.id === tempId);
        if (photoIndex !== -1) {
          const oldUrl = this.visualPhotos[key][photoIndex].url;
          if (oldUrl && oldUrl.startsWith('blob:')) {
            URL.revokeObjectURL(oldUrl);
          }

          // CRITICAL: Get the uploaded photo URL from the result
          const uploadedPhotoUrl = result.thumbnailUrl || result.url || result.Photo;
          let displayableUrl = uploadedPhotoUrl;

          // If we got a file path, convert it to a displayable URL
          if (uploadedPhotoUrl && !uploadedPhotoUrl.startsWith('data:') && !uploadedPhotoUrl.startsWith('blob:')) {
            try {
              console.log('[PHOTO UPLOAD] Converting file path to displayable URL:', uploadedPhotoUrl);
              const imageData = await firstValueFrom(
                this.caspioService.getImageFromFilesAPI(uploadedPhotoUrl)
              );
              if (imageData && imageData.startsWith('data:')) {
                displayableUrl = imageData;
                console.log('[PHOTO UPLOAD] Successfully converted to data URL, length:', imageData.length);
                console.log('[PHOTO UPLOAD] Data URL prefix:', imageData.substring(0, 100));
              } else {
                console.warn('[PHOTO UPLOAD] Files API returned invalid data:', imageData?.substring(0, 50));
              }
            } catch (err) {
              console.error('[PHOTO UPLOAD] Failed to load uploaded image:', err);
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
        await this.showToast('Photo uploaded successfully', 'success');
      }

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

      await this.showToast('Failed to upload photo', 'danger');
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

      const serviceIdNum = parseInt(this.serviceId, 10);
      if (isNaN(serviceIdNum)) {
        console.error('[SAVE VISUAL] Invalid ServiceID:', this.serviceId);
        return;
      }

      // Create the Services_Visuals record using EXACT same structure as original
      const visualData: any = {
        ServiceID: serviceIdNum,
        Category: category,
        Kind: item.type,      // Use "Kind" not "Type"
        Name: item.name,
        Text: item.text || item.originalText || '',
        Notes: ''
      };

      // Add Answers field if there are answers to store
      if (item.answer) {
        visualData.Answers = item.answer;
      }

      const result = await this.foundationData.createVisual(visualData);

      // Extract VisualID using the SAME logic as original (line 8518-8524)
      let visualId: string | null = null;
      if (result.VisualID) {
        visualId = String(result.VisualID);
      } else if (result.PK_ID) {
        visualId = String(result.PK_ID);
      } else if (result.id) {
        visualId = String(result.id);
      }

      if (!visualId) {
        console.error('[SAVE VISUAL] No VisualID in response:', result);
        throw new Error('VisualID not found in response');
      }

      console.log('[SAVE VISUAL] Created visual with ID:', visualId);

      // Store the visual ID for photo uploads
      this.visualRecordIds[key] = visualId;

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

          // Upload the photo
          await this.uploadPhotoForVisual(
            result.PK_ID,
            pending.file,
            key,
            pending.isBatchUpload,
            pending.annotationData,
            pending.originalFile,
            pending.caption
          );
        }
      }

    } catch (error) {
      console.error('[SAVE VISUAL] Error creating visual record:', error);
      await this.showToast('Failed to save selection', 'danger');
    }
  }

  // ============================================
  // PHOTO VIEWING AND DELETION
  // ============================================

  async viewPhoto(photo: any, category: string, itemId: string | number, event?: Event) {
    console.log('[VIEW PHOTO] Opening photo annotator for', photo.AttachID);

    try {
      const key = `${category}_${itemId}`;

      // Check if photo is still uploading
      if (photo.uploading || photo.queued) {
        await this.showToast('Photo is still uploading. Please try again once it finishes.', 'warning');
        return;
      }

      const attachId = photo.AttachID || photo.id;
      if (!attachId || String(attachId).startsWith('temp_')) {
        await this.showToast('Photo is still processing. Please try again in a moment.', 'warning');
        return;
      }

      // CRITICAL: Save scroll position BEFORE opening modal using Ionic API
      const scrollPosition = await this.content?.getScrollElement().then(el => el.scrollTop) || 0;
      console.log('[SCROLL] Saved scroll position before modal:', scrollPosition);

      // CRITICAL FIX v1.4.340: Always use the original URL (base image without annotations)
      // The originalUrl is set during loadPhotosForVisual to the base image
      let imageUrl = photo.url || photo.thumbnailUrl || 'assets/img/photo-placeholder.png';

      // If no valid URL and we have a file path, try to fetch it
      if ((!imageUrl || imageUrl === 'assets/img/photo-placeholder.png') && (photo.filePath || photo.Photo)) {
        try {
          const filePath = photo.filePath || photo.Photo;
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

      console.log('[VIEW PHOTO] AttachID:', attachId, 'Loading annotations from sources:', {
        hasAnnotations: !!photo.annotations,
        hasAnnotationsData: !!photo.annotationsData,
        hasRawDrawingsString: !!photo.rawDrawingsString,
        hasDrawings: !!photo.Drawings,
        rawDrawingsStringLength: photo.rawDrawingsString?.length || 0,
        drawingsLength: photo.Drawings?.length || 0
      });

      for (const source of annotationSources) {
        if (!source) {
          continue;
        }
        try {
          if (typeof source === 'string') {
            console.log('[VIEW PHOTO] Decompressing string source, length:', source.length);
            // Import decompression utility
            const { decompressAnnotationData } = await import('../../../../utils/annotation-utils');
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
      const modal = await this.modalController.create({
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

        // Find photo in array and update it
        const photos = this.visualPhotos[key] || [];
        const photoIndex = photos.findIndex(p =>
          (p.AttachID || p.id) === attachId
        );

        if (photoIndex !== -1) {
          const currentPhoto = photos[photoIndex];

          // Save annotations to database FIRST
          if (attachId && !String(attachId).startsWith('temp_')) {
            try {
              // CRITICAL: Save and get back the compressed drawings that were saved
              const compressedDrawings = await this.saveAnnotationToDatabase(attachId, annotatedBlob, annotationsData, data.caption);

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

              console.log('[SAVE] Updated photo object with compressed drawings, length:', compressedDrawings?.length || 0);

              // CRITICAL: Clear ALL visual attachment caches (not just this one)
              // This ensures when the user navigates away and back, ALL fresh data is loaded from database
              // Clearing only the specific visualId wasn't working reliably on navigation
              this.foundationData.clearVisualAttachmentsCache(); // Clear all caches
              console.log('[SAVE] Cleared ALL attachment caches to ensure fresh data on navigation');

              // DON'T manually call detectChanges() - let Angular handle it automatically
              // Manual detectChanges() was causing scroll position to reset
              // Angular will automatically detect the change when the modal dismisses

              // Success toast removed per user request
            } catch (error) {
              console.error('[VIEW PHOTO] Error saving annotations:', error);
              await this.showToast('Failed to save annotations', 'danger');
            }
          }
        }
      }

    } catch (error) {
      console.error('Error opening photo annotator:', error);
      await this.showToast('Failed to open photo annotator', 'danger');
    }
  }

  private async saveAnnotationToDatabase(attachId: string, annotatedBlob: Blob, annotationsData: any, caption: string): Promise<string> {
    // Import compression utilities
    const { compressAnnotationData } = await import('../../../../utils/annotation-utils');

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

          console.log(`[SAVE] Compressed annotations: ${originalSize} → ${drawingsData.length} bytes`);

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
      caption: caption || '(empty)'
    });

    // CRITICAL FIX: Call updateServicesVisualsAttach directly to save BOTH fields
    // (the updateVisualPhotoCaption method only updates caption, not drawings)
    await firstValueFrom(
      this.caspioService.updateServicesVisualsAttach(attachId, updateData)
    );

    console.log('[SAVE] Successfully saved caption and drawings for AttachID:', attachId);

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

                  // Remove from UI immediately using filter for cleaner updates
                  if (this.visualPhotos[key]) {
                    this.visualPhotos[key] = this.visualPhotos[key].filter(
                      (p: any) => p.AttachID !== photo.AttachID
                    );
                  }

                  // Delete from database
                  if (photo.AttachID && !String(photo.AttachID).startsWith('temp_')) {
                    await this.foundationData.deleteVisualPhoto(photo.AttachID);
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
            text: 'Cancel',
            role: 'cancel',
            handler: () => {
              this.isCaptionPopupOpen = false;
              return true;
            }
          },
          {
            text: 'Save',
            handler: async () => {
              try {
                const input = document.getElementById('captionInput') as HTMLInputElement;
                const newCaption = input?.value || '';
                photo.caption = newCaption;

                // Update in database
                if (photo.AttachID && !String(photo.AttachID).startsWith('temp_')) {
                  await this.foundationData.updateVisualPhotoCaption(photo.AttachID, newCaption);
                }

                this.changeDetectorRef.detectChanges();
                // Remove success toast - silent update
                this.isCaptionPopupOpen = false;
                return true;
              } catch (error) {
                console.error('Error updating caption:', error);
                await this.showToast('Failed to update caption', 'danger');
                this.isCaptionPopupOpen = false;
                return true;
              }
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
    // Dynamically import the modal component
    const { AddCustomVisualModalComponent } = await import('../../../../modals/add-custom-visual-modal/add-custom-visual-modal.component');

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
        await this.showToast('Invalid Service ID', 'danger');
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
            const result = await this.foundationData.uploadVisualPhoto(parseInt(visualId!, 10), fileToUpload, caption);
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
      await this.showToast(errorMsg, 'danger');
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
          text: 'Cancel',
          role: 'cancel',
          cssClass: 'editor-cancel-btn'
        },
        {
          text: 'Save',
          cssClass: 'editor-save-btn',
          handler: async (data) => {
            // Validate required fields (only check description since title is read-only)
            if (item.required && !data.description) {
              await this.showToast('Please fill in the description field', 'warning');
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
                  });
                  console.log('[TEXT EDIT] Updated visual text:', visualId);
                  this.changeDetectorRef.detectChanges();
                } catch (error) {
                  console.error('[TEXT EDIT] Error updating visual:', error);
                  // Revert changes on error
                  item.text = oldText;
                  await this.showToast('Failed to save changes', 'danger');
                  return false;
                }
              } else {
                // Just update UI if visual doesn't exist yet
                this.changeDetectorRef.detectChanges();
              }
            }
            return true;
          }
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
      // No search term - collapse all accordions
      this.expandedAccordions = [];
      return;
    }

    // Expand accordions that have matching results
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
}
