import { Component, OnInit, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController, AlertController, ActionSheetController, ModalController } from '@ionic/angular';
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
        const category = visual.Category;
        const name = visual.Name;
        const kind = visual.Kind;

        // Find matching template by Name, Category, and Kind
        const item = this.findItemByNameAndCategory(name, category, kind);
        if (!item) {
          console.warn('[LOAD VISUALS] Template not found for:', name, category, kind);
          continue;
        }

        const key = `${category}_${item.id}`;

        // Store the visual record ID (extract from response)
        const visualId = String(visual.VisualID || visual.PK_ID || visual.id);
        this.visualRecordIds[key] = visualId;

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

        // Load photos for this visual
        await this.loadPhotosForVisual(visualId, key);
      }

      console.log('[LOAD VISUALS] Finished loading existing visuals');

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
      this.photoCountsByKey[key] = 0;

      const attachments = await this.foundationData.getVisualAttachments(visualId);

      console.log('[LOAD PHOTOS] Found', attachments.length, 'photos for visual', visualId);

      if (attachments.length > 0) {
        this.photoCountsByKey[key] = attachments.length;

        // Process each attachment and convert file paths to displayable URLs
        const photoPromises = attachments.map(async (attach) => {
          const filePath = attach.Photo;
          let imageUrl = '';

          // Convert file path to base64 image using Files API (EXACTLY like original)
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

          return {
            AttachID: attach.AttachID,
            id: attach.AttachID,
            name: attach.Photo || 'photo.jpg',
            filePath: filePath,
            Photo: filePath,
            url: imageUrl,
            thumbnailUrl: imageUrl,
            displayUrl: imageUrl,
            caption: attach.Annotation || '',
            annotation: attach.Annotation || '',
            hasAnnotations: !!attach.Drawings,
            annotations: attach.Drawings || null,
            rawDrawingsString: attach.Drawings || null,
            uploading: false,
            queued: false,
            isObjectUrl: false
          };
        });

        this.visualPhotos[key] = await Promise.all(photoPromises);
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

      // Try to get a valid image URL (EXACTLY like original at line 12179)
      let imageUrl = photo.url || photo.thumbnailUrl || photo.displayUrl;

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
            photo.thumbnailUrl = fetchedImage;
            photo.displayUrl = fetchedImage;
            this.changeDetectorRef.detectChanges();
          }
        } catch (err) {
          console.error('[VIEW PHOTO] Failed to fetch image from file path:', err);
        }
      }

      // Fallback to placeholder if still no URL
      if (!imageUrl) {
        imageUrl = 'assets/img/photo-placeholder.png';
      }

      // Try to load existing annotations (EXACTLY like original at line 12184-12208)
      let existingAnnotations: any = null;
      const annotationSources = [
        photo.annotations,
        photo.annotationsData,
        photo.rawDrawingsString,
        photo.Drawings
      ];

      for (const source of annotationSources) {
        if (!source) {
          continue;
        }
        try {
          if (typeof source === 'string') {
            // Import decompression utility
            const { decompressAnnotationData } = await import('../../../../utils/annotation-utils');
            existingAnnotations = decompressAnnotationData(source);
          } else {
            existingAnnotations = source;
          }
          if (existingAnnotations) {
            break;
          }
        } catch (e) {
          // Ignore parse errors
        }
      }

      // Get existing caption
      const existingCaption = photo.caption || photo.annotation || photo.Annotation || '';

      // Open FabricPhotoAnnotatorComponent (EXACTLY like original at line 12443)
      const modal = await this.modalController.create({
        component: FabricPhotoAnnotatorComponent,
        componentProps: {
          imageUrl: imageUrl,
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

      if (!data) {
        return; // User cancelled
      }

      if (data && data.annotatedBlob) {
        // Update photo with new annotations
        const annotatedBlob = data.blob || data.annotatedBlob;
        const annotationsData = data.annotationData || data.annotationsData;

        const newUrl = URL.createObjectURL(annotatedBlob);

        // Find photo in array and update it
        const photos = this.visualPhotos[key] || [];
        const photoIndex = photos.findIndex(p =>
          (p.AttachID || p.id) === attachId
        );

        if (photoIndex !== -1) {
          const targetPhoto = photos[photoIndex];

          if (!targetPhoto.originalUrl) {
            targetPhoto.originalUrl = targetPhoto.url;
          }

          targetPhoto.displayUrl = newUrl;
          targetPhoto.url = newUrl;
          targetPhoto.thumbnailUrl = newUrl;
          targetPhoto.hasAnnotations = !!annotationsData;

          if (data.caption !== undefined) {
            targetPhoto.caption = data.caption;
            targetPhoto.annotation = data.caption;
            targetPhoto.Annotation = data.caption;
          }

          if (annotationsData) {
            targetPhoto.annotations = annotationsData;
            // Note: rawDrawingsString will be updated after save with the compressed version
          }

          this.changeDetectorRef.detectChanges();

          // Save annotations to database
          if (attachId && !String(attachId).startsWith('temp_')) {
            try {
              // CRITICAL: Save and get back the compressed drawings that were saved
              const compressedDrawings = await this.saveAnnotationToDatabase(attachId, annotatedBlob, annotationsData, data.caption);

              // CRITICAL: Update rawDrawingsString with the COMPRESSED data that was saved to database
              // This ensures local state matches database state (original code line 12034)
              if (compressedDrawings) {
                targetPhoto.rawDrawingsString = compressedDrawings;
              }

              await this.showToast('Annotations saved', 'success');
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
