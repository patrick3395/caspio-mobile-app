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
import { HudDataService } from '../hud-data.service';
import { FabricPhotoAnnotatorComponent } from '../../../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { BackgroundPhotoUploadService } from '../../../services/background-photo-upload.service';

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
  selector: 'app-hud-category-detail',
  templateUrl: './hud-category-detail.page.html',
  styleUrls: ['./hud-category-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class HudCategoryDetailPage implements OnInit, OnDestroy {
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

  // Background upload subscriptions
  private uploadSubscription?: Subscription;
  private taskSubscription?: Subscription;

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
    private hudData: HudDataService,
    private backgroundUploadService: BackgroundPhotoUploadService,
    private cache: CacheService
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
    console.log('[HUD CATEGORY DETAIL] Component destroyed, but uploads continue in background');
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
  }

  /**
   * Update photo object after successful upload
   */
  private async updatePhotoAfterUpload(key: string, photoIndex: number, result: any, caption: string) {
    const uploadedPhotoUrl = result.thumbnailUrl || result.url || result.Photo;
    let displayableUrl = uploadedPhotoUrl;

    // Convert file path to displayable URL if needed
    if (uploadedPhotoUrl && !uploadedPhotoUrl.startsWith('data:') && !uploadedPhotoUrl.startsWith('blob:')) {
      try {
        const imageData = await firstValueFrom(
          this.caspioService.getImageFromFilesAPI(uploadedPhotoUrl)
        );
        if (imageData && imageData.startsWith('data:')) {
          displayableUrl = imageData;
        }
      } catch (err) {
        console.error('[UPLOAD UPDATE] Failed to load uploaded image:', err);
        displayableUrl = 'assets/img/photo-placeholder.png';
      }
    }

    // Update photo object
    this.visualPhotos[key][photoIndex] = {
      ...this.visualPhotos[key][photoIndex],
      AttachID: result.AttachID,
      id: result.AttachID,
      uploading: false,
      progress: 100,
      filePath: uploadedPhotoUrl,
      Photo: uploadedPhotoUrl,
      url: displayableUrl,
      originalUrl: displayableUrl,
      thumbnailUrl: displayableUrl,
      displayUrl: displayableUrl,
      caption: caption || '',
      annotation: caption || '',
      Annotation: caption || ''
    };

    console.log('[UPLOAD UPDATE] Photo updated successfully');
  }

  private async loadData() {
    this.loading = true;

    try {
      // Clear all state for fresh load
      console.log('[LOAD DATA] Clearing all photo state for fresh load');
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
      await this.loadAllDropdownOptions();

      // Load templates for this category
      await this.loadCategoryTemplates();

      // Load existing visuals
      await this.loadExistingVisuals();

      // Show page
      this.loading = false;

    } catch (error) {
      console.error('Error loading category data:', error);
      this.loading = false;
    }
  }

  private async loadCategoryTemplates() {
    try {
      // Get all HUD templates for this category
      const allTemplates = await this.caspioService.getServicesHUDTemplates().toPromise();
      const hudTemplates = (allTemplates || []).filter((template: any) =>
        template.Category === this.categoryName
      );

      console.log(`[HUD CATEGORY] Found ${hudTemplates.length} templates for category:`, this.categoryName);

      // Organize templates by Kind (Type field in HUD is called "Kind")
      hudTemplates.forEach((template: any) => {
        // Log the Kind value to debug
        console.log('[HUD CATEGORY] Template:', template.Name, 'Kind:', template.Kind, 'Type:', template.Type);

        const templateData: VisualItem = {
          id: template.PK_ID,
          templateId: template.PK_ID,
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
        
        console.log('[HUD CATEGORY] Processing item:', template.Name, 'Kind value:', kind, 'Lowercased:', kindLower);

        if (kindLower === 'limitation' || kindLower === 'limitations') {
          this.organizedData.limitations.push(templateData);
          console.log('[HUD CATEGORY] Added to Limitations');
        } else if (kindLower === 'deficiency' || kindLower === 'deficiencies') {
          this.organizedData.deficiencies.push(templateData);
          console.log('[HUD CATEGORY] Added to Deficiencies');
        } else {
          this.organizedData.comments.push(templateData);
          console.log('[HUD CATEGORY] Added to Comments/Information');
        }

        // Note: Dropdown options are already loaded via loadAllDropdownOptions()
        // No need to load them individually here
      });

      console.log('[HUD CATEGORY] Organized data:', {
        comments: this.organizedData.comments.length,
        limitations: this.organizedData.limitations.length,
        deficiencies: this.organizedData.deficiencies.length
      });

    } catch (error) {
      console.error('Error loading category templates:', error);
    }
  }

  /**
   * Load all dropdown options from Services_HUD_Drop table
   * This loads all options upfront and groups them by TemplateID
   */
  private async loadAllDropdownOptions() {
    try {
      const dropdownData = await firstValueFrom(
        this.caspioService.getServicesHUDDrop()
      );
      
      console.log('[HUD Category] Loaded dropdown data:', dropdownData?.length || 0, 'rows');
      
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
        
        console.log('[HUD Category] Grouped by TemplateID:', Object.keys(this.visualDropdownOptions).length, 'templates have options');
        
        // Add "Other" option to all multi-select dropdowns if not already present
        Object.entries(this.visualDropdownOptions).forEach(([templateId, options]) => {
          const optionsArray = options as string[];
          if (!optionsArray.includes('Other')) {
            optionsArray.push('Other');
          }
          console.log(`[HUD Category] TemplateID ${templateId}: ${optionsArray.length} options -`, optionsArray.join(', '));
        });
      } else {
        console.warn('[HUD Category] No dropdown data received from API');
      }
    } catch (error) {
      console.error('[HUD Category] Error loading dropdown options:', error);
      // Continue without dropdown options - they're optional
    }
  }

  private async loadExistingVisuals() {
    try {
      // Load all existing HUD visuals for this service and category
      const allVisuals = await this.hudData.getVisualsByService(this.serviceId);
      const categoryVisuals = allVisuals.filter((v: any) => v.Category === this.categoryName);

      console.log(`[HUD CATEGORY] Found ${categoryVisuals.length} existing visuals for category:`, this.categoryName);

      for (const visual of categoryVisuals) {
        const templateId = visual.TemplateID || visual.templateId;
        const key = `${this.categoryName}_${templateId}`;

        // Mark as selected
        this.selectedItems[key] = true;

        // Store visual record ID
        this.visualRecordIds[key] = visual.PK_ID || visual.id;

        // Update item with saved answer
        const item = this.findItemByTemplateId(templateId);
        if (item) {
          item.answer = visual.Answers || '';
          item.otherValue = visual.OtherValue || '';
        }

        // Load photos for this visual
        await this.loadPhotosForVisual(key, visual.PK_ID || visual.id);
      }

    } catch (error) {
      console.error('Error loading existing visuals:', error);
    }
  }

  private findItemByTemplateId(templateId: number): VisualItem | undefined {
    const allItems = [
      ...this.organizedData.comments,
      ...this.organizedData.limitations,
      ...this.organizedData.deficiencies
    ];
    return allItems.find(item => item.templateId === templateId);
  }

  private async loadPhotosForVisual(key: string, hudId: string) {
    try {
      this.loadingPhotosByKey[key] = true;
      const photos = await this.hudData.getVisualAttachments(hudId);
      
      this.photoCountsByKey[key] = photos.length;
      this.visualPhotos[key] = [];

      for (const photo of photos) {
        // Load photo data
        const photoUrl = photo.Photo || photo.Photo_Thumbnail || '';
        let displayUrl = '';

        if (photoUrl) {
          try {
            const imageData = await this.hudData.getImage(photoUrl);
            displayUrl = imageData || 'assets/img/photo-placeholder.png';
          } catch (err) {
            console.error('Error loading photo:', err);
            displayUrl = 'assets/img/photo-placeholder.png';
          }
        }

        this.visualPhotos[key].push({
          AttachID: photo.PK_ID || photo.AttachID,
          id: photo.PK_ID || photo.AttachID,
          url: displayUrl,
          filePath: photoUrl,
          caption: photo.Annotation || '',
          annotation: photo.Annotation || '',
          Annotation: photo.Annotation || '',
          AnnotationData: photo.AnnotationData || '',
          uploading: false
        });
      }

      this.loadingPhotosByKey[key] = false;
    } catch (error) {
      console.error('Error loading photos for visual:', key, error);
      this.loadingPhotosByKey[key] = false;
      this.photoCountsByKey[key] = 0;
    }
  }

  // UI Helper Methods
  goBack() {
    this.router.navigate(['..'], { relativeTo: this.route });
  }

  filterItems(items: VisualItem[]): VisualItem[] {
    if (!this.searchTerm) {
      return items;
    }

    const term = this.searchTerm.toLowerCase();
    return items.filter(item =>
      item.name.toLowerCase().includes(term) ||
      item.text.toLowerCase().includes(term)
    );
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

  onSearchChange() {
    // Trigger change detection
    this.changeDetectorRef.detectChanges();
  }

  clearSearch() {
    this.searchTerm = '';
    this.changeDetectorRef.detectChanges();
  }

  onAccordionChange(event: any) {
    this.expandedAccordions = event.detail.value;
  }

  toggleItemSelection(category: string, itemId: string | number) {
    const key = `${category}_${itemId}`;
    this.selectedItems[key] = !this.selectedItems[key];

    if (this.selectedItems[key]) {
      // Create visual record
      this.createVisualRecord(category, itemId);
    } else {
      // Delete visual record
      this.deleteVisualRecord(category, itemId);
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
    return this.visualDropdownOptions[templateIdStr] || [];
  }

  // Data Management Methods (Stubs - implement based on HUD API)
  private async createVisualRecord(category: string, itemId: string | number) {
    console.log('[HUD CATEGORY] TODO: Create visual record for:', category, itemId);
    // TODO: Implement HUD visual record creation
  }

  private async deleteVisualRecord(category: string, itemId: string | number) {
    console.log('[HUD CATEGORY] TODO: Delete visual record for:', category, itemId);
    // TODO: Implement HUD visual record deletion
  }

  async onAnswerChange(category: string, item: VisualItem) {
    console.log('[HUD CATEGORY] TODO: Save answer for:', category, item.name, item.answer);
    // TODO: Implement answer saving
  }

  async onOptionToggle(category: string, item: VisualItem, option: string, event: any) {
    console.log('[HUD CATEGORY] TODO: Toggle option:', category, item.name, option, event.detail.checked);
    // TODO: Implement multi-select option toggling
  }

  isOptionSelectedV1(item: VisualItem, option: string): boolean {
    if (!item.answer) return false;
    const selectedOptions = item.answer.split(',').map(o => o.trim());
    return selectedOptions.includes(option);
  }

  async onMultiSelectOtherChange(category: string, item: VisualItem) {
    console.log('[HUD CATEGORY] TODO: Save other value:', category, item.name, item.otherValue);
    // TODO: Implement other value saving
  }

  async addPhotoFromCamera(category: string, itemId: string | number) {
    console.log('[HUD CATEGORY] TODO: Add photo from camera:', category, itemId);
    // TODO: Implement camera photo capture
  }

  async addPhotoFromGallery(category: string, itemId: string | number) {
    console.log('[HUD CATEGORY] TODO: Add photo from gallery:', category, itemId);
    // TODO: Implement gallery photo selection
  }

  async viewPhoto(photo: any, key: string) {
    console.log('[HUD CATEGORY] TODO: View photo:', photo, key);
    // TODO: Implement photo viewer
  }

  async deletePhoto(photo: any, key: string) {
    console.log('[HUD CATEGORY] TODO: Delete photo:', photo, key);
    // TODO: Implement photo deletion
  }

  async onFileSelected(event: any) {
    console.log('[HUD CATEGORY] TODO: File selected:', event);
    // TODO: Implement file upload
  }
}

