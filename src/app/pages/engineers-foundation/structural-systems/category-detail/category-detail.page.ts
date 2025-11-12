import { Component, OnInit, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController, AlertController, ActionSheetController, ModalController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { CaspioService } from '../../../../services/caspio.service';
import { OfflineService } from '../../../../services/offline.service';
import { CameraService } from '../../../../services/camera.service';
import { ImageCompressionService } from '../../../../services/image-compression.service';
import { EngineersFoundationDataService } from '../../engineers-foundation-data.service';
import { PhotoViewerComponent } from '../../../../components/photo-viewer/photo-viewer.component';
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
      // Load templates for this category
      await this.loadCategoryTemplates();

      // Load existing visuals for this service
      await this.loadExistingVisuals();

      this.loading = false;
    } catch (error) {
      console.error('Error loading category data:', error);
      this.loading = false;
    }
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

        // Add to appropriate section
        if (template.Type === 'Comment') {
          this.organizedData.comments.push(templateData);
        } else if (template.Type === 'Limitation') {
          this.organizedData.limitations.push(templateData);
        } else if (template.Type === 'Deficiency') {
          this.organizedData.deficiencies.push(templateData);
        } else {
          // Default to comments if type is unknown
          this.organizedData.comments.push(templateData);
        }

        // Initialize selected state
        this.selectedItems[`${this.categoryName}_${template.PK_ID}`] = false;
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
        const templateId = visual.TemplateID;
        const category = visual.Category || this.categoryName;
        const key = `${category}_${templateId}`;

        // Store the visual record ID
        this.visualRecordIds[key] = visual.PK_ID;

        // Find the template item in our organized data
        const item = this.findItemByTemplateId(templateId);
        if (!item) {
          console.warn('[LOAD VISUALS] Template not found for ID:', templateId);
          continue;
        }

        // Set selected state for checkbox items
        if (!item.answerType || item.answerType === 0) {
          this.selectedItems[key] = true;
        }

        // Set answer for Yes/No dropdowns
        if (item.answerType === 1 && visual.Answer) {
          item.answer = visual.Answer;
        }

        // Set selected options for multi-select
        if (item.answerType === 2 && visual.Answer) {
          item.answer = visual.Answer;
          if (visual.OtherValue) {
            item.otherValue = visual.OtherValue;
          }
        }

        // Load photos for this visual
        await this.loadPhotosForVisual(visual.PK_ID, key);
      }

      console.log('[LOAD VISUALS] Finished loading existing visuals');

    } catch (error) {
      console.error('[LOAD VISUALS] Error loading existing visuals:', error);
    }
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

      const attachments = await this.foundationData.getVisualAttachments(visualId);

      console.log('[LOAD PHOTOS] Found', attachments.length, 'photos for visual', visualId);

      if (attachments.length > 0) {
        this.visualPhotos[key] = attachments.map(attach => ({
          AttachID: attach.AttachID,
          id: attach.AttachID,
          name: attach.Photo || 'photo.jpg',
          url: attach.Photo,
          thumbnailUrl: attach.Photo,
          displayUrl: attach.Photo,
          caption: attach.Annotation || '',
          annotation: attach.Annotation || '',
          hasAnnotations: !!attach.Drawings,
          annotations: attach.Drawings || null,
          uploading: false,
          queued: false
        }));
      }

      this.loadingPhotosByKey[key] = false;
      this.changeDetectorRef.detectChanges();

    } catch (error) {
      console.error('[LOAD PHOTOS] Error loading photos for visual', visualId, error);
      this.loadingPhotosByKey[key] = false;
    }
  }

  goBack() {
    this.router.navigate(['../..'], { relativeTo: this.route });
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
        const visualData = {
          ServiceID: this.serviceId,
          TemplateID: item.templateId,
          Category: category,
          Type: item.type,
          Answer: item.answer || '',
          Required: item.required ? 'Yes' : 'No'
        };

        const result = await this.foundationData.createVisual(visualData);
        this.visualRecordIds[key] = result.PK_ID;
        console.log('[ANSWER] Created visual:', result.PK_ID);
      } else if (!String(visualId).startsWith('temp_')) {
        // Update existing visual
        await this.foundationData.updateVisual(visualId, {
          Answer: item.answer || ''
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
        const visualData = {
          ServiceID: this.serviceId,
          TemplateID: item.templateId,
          Category: category,
          Type: item.type,
          Answer: item.answer,
          OtherValue: item.otherValue || '',
          Required: item.required ? 'Yes' : 'No'
        };

        const result = await this.foundationData.createVisual(visualData);
        this.visualRecordIds[key] = result.PK_ID;
        console.log('[OPTION] Created visual:', result.PK_ID);
      } else if (!String(visualId).startsWith('temp_')) {
        // Update existing visual
        await this.foundationData.updateVisual(visualId, {
          Answer: item.answer,
          OtherValue: item.otherValue || ''
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
        const visualData = {
          ServiceID: this.serviceId,
          TemplateID: item.templateId,
          Category: category,
          Type: item.type,
          Answer: item.answer || '',
          OtherValue: item.otherValue || '',
          Required: item.required ? 'Yes' : 'No'
        };

        const result = await this.foundationData.createVisual(visualData);
        this.visualRecordIds[key] = result.PK_ID;
        console.log('[OTHER] Created visual:', result.PK_ID);
      } else if (!String(visualId).startsWith('temp_')) {
        // Update existing visual
        await this.foundationData.updateVisual(visualId, {
          OtherValue: item.otherValue || ''
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
    const ionContent = document.querySelector('ion-content');
    const scrollElement = ionContent?.shadowRoot?.querySelector('.inner-scroll');
    if (scrollElement) {
      this.lockedScrollY = scrollElement.scrollTop;
      console.log('[SCROLL] Saved scroll position:', this.lockedScrollY);
    }
  }

  // ============================================
  // CAMERA AND GALLERY CAPTURE METHODS
  // ============================================

  async addPhotoFromCamera(category: string, itemId: string | number) {
    // Clear any pending context-clearing timer
    if (this.contextClearTimer) {
      clearTimeout(this.contextClearTimer);
      this.contextClearTimer = null;
    }

    this.currentUploadContext = {
      category,
      itemId: String(itemId),
      action: 'add'
    };

    this.triggerFileInput('camera', { allowMultiple: false });
  }

  async addPhotoFromGallery(category: string, itemId: string | number) {
    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Photos
      });

      if (image.webPath) {
        const response = await fetch(image.webPath);
        const blob = await response.blob();
        const file = new File([blob], `gallery-${Date.now()}.jpg`, { type: 'image/jpeg' });

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
          const processedFile = {
            file: file,
            annotationData: null,
            originalFile: undefined,
            caption: ''
          };

          await this.uploadPhotoForVisual(visualId, processedFile.file, key, true, processedFile.annotationData, processedFile.originalFile, processedFile.caption);
        }

        this.currentUploadContext = null;
      }
    } catch (error) {
      if (error !== 'User cancelled photos app') {
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

  async uploadPhotoForVisual(visualId: string, photo: File, key: string, isBatchUpload: boolean = false, annotationData: any = null, originalPhoto: File | null = null, caption: string = '') {
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
        return;
      }
    }

    try {
      const visualIdNum = parseInt(actualVisualId, 10);

      if (isNaN(visualIdNum)) {
        throw new Error(`Invalid VisualID: ${actualVisualId}`);
      }

      await this.performVisualPhotoUpload(visualIdNum, uploadFile, key, true, annotationData, originalPhoto, tempId, caption);

    } catch (error) {
      console.error('Failed to prepare upload:', error);
      await this.showToast('Failed to prepare photo upload', 'danger');
    }
  }

  private async performVisualPhotoUpload(visualId: number, photo: File, key: string, isBatchUpload: boolean, annotationData: any, originalPhoto: File | null, tempId: string | undefined, caption: string) {
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

          this.visualPhotos[key][photoIndex] = {
            ...this.visualPhotos[key][photoIndex],
            AttachID: result.AttachID,
            id: result.AttachID,
            uploading: false,
            queued: false,
            url: result.thumbnailUrl || result.url,
            thumbnailUrl: result.thumbnailUrl || result.url,
            displayUrl: result.thumbnailUrl || result.url,
            caption: caption || ''
          };

          this.changeDetectorRef.detectChanges();
        }
      }

      if (!isBatchUpload) {
        await this.showToast('Photo uploaded successfully', 'success');
      }

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

      // Create the Services_Visuals record
      const visualData = {
        ServiceID: this.serviceId,
        TemplateID: Number(itemId),
        Category: category,
        Type: item.type,
        Answer: item.answer || '',
        OtherValue: item.otherValue || '',
        Required: item.required ? 'Yes' : 'No'
      };

      const result = await this.foundationData.createVisual(visualData);

      console.log('[SAVE VISUAL] Created visual with ID:', result.PK_ID);

      // Store the visual ID for photo uploads
      this.visualRecordIds[key] = result.PK_ID;

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
    console.log('[VIEW PHOTO] Opening photo viewer for', photo.AttachID);

    try {
      const modal = await this.modalController.create({
        component: PhotoViewerComponent,
        componentProps: {
          photo: photo,
          allPhotos: this.getPhotosForVisual(category, itemId),
          canDelete: true,
          canEdit: true
        },
        cssClass: 'photo-viewer-modal'
      });

      await modal.present();

      const { data } = await modal.onWillDismiss();

      if (data?.action === 'delete') {
        await this.deletePhoto(photo, category, itemId);
      } else if (data?.action === 'caption') {
        await this.openCaptionPopup(photo, category, itemId);
      }

    } catch (error) {
      console.error('Error opening photo viewer:', error);
    }
  }

  async deletePhoto(photo: any, category: string, itemId: string | number) {
    const alert = await this.alertController.create({
      header: 'Delete Photo',
      message: 'Are you sure you want to delete this photo?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            try {
              const key = `${category}_${itemId}`;

              // Remove from UI immediately
              if (this.visualPhotos[key]) {
                const index = this.visualPhotos[key].findIndex(p => p.AttachID === photo.AttachID);
                if (index !== -1) {
                  this.visualPhotos[key].splice(index, 1);
                  this.changeDetectorRef.detectChanges();
                }
              }

              // Delete from database
              if (photo.AttachID && !String(photo.AttachID).startsWith('temp_')) {
                await this.foundationData.deleteVisualPhoto(photo.AttachID);
              }

              await this.showToast('Photo deleted', 'success');
            } catch (error) {
              console.error('Error deleting photo:', error);
              await this.showToast('Failed to delete photo', 'danger');
            }
          }
        }
      ]
    });

    await alert.present();
  }

  async openCaptionPopup(photo: any, category: string, itemId: string | number) {
    const alert = await this.alertController.create({
      header: 'Edit Caption',
      inputs: [
        {
          name: 'caption',
          type: 'text',
          placeholder: 'Enter caption',
          value: photo.caption || ''
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Save',
          handler: async (data) => {
            try {
              photo.caption = data.caption;

              // Update in database
              if (photo.AttachID && !String(photo.AttachID).startsWith('temp_')) {
                await this.foundationData.updateVisualPhotoCaption(photo.AttachID, data.caption);
              }

              this.changeDetectorRef.detectChanges();
              await this.showToast('Caption updated', 'success');
            } catch (error) {
              console.error('Error updating caption:', error);
              await this.showToast('Failed to update caption', 'danger');
            }
          }
        }
      ]
    });

    await alert.present();
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  addCustomVisual(category: string, type: string) {
    console.log('Add custom visual:', category, type);
    // TODO: Implement custom visual creation
  }

  showFullText(item: VisualItem) {
    // TODO: Show modal with full text
    console.log('Show full text:', item.name);
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

  async showToast(message: string, color: string = 'primary') {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }
}
