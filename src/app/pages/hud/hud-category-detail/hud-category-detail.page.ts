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
        console.log('[HUD CATEGORY] Template:', template.Name, 'PK_ID:', template.PK_ID, 'TemplateID:', template.TemplateID, 'Kind:', template.Kind, 'Type:', template.Type);

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
        console.log('[HUD Category] All TemplateIDs with options:', Object.keys(this.visualDropdownOptions));
        
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
  private async createVisualRecord(category: string, itemId: string | number) {
    const key = `${category}_${itemId}`;
    const item = this.findItemByTemplateId(Number(itemId));
    
    if (!item) {
      console.error('[CREATE VISUAL] Item not found for itemId:', itemId);
      console.error('[CREATE VISUAL] Available items:', [
        ...this.organizedData.comments,
        ...this.organizedData.limitations,
        ...this.organizedData.deficiencies
      ].map(i => ({ id: i.id, templateId: i.templateId, name: i.name })));
      return;
    }

    this.savingItems[key] = true;

    try {
      const hudData = {
        ServiceID: parseInt(this.serviceId),
        TemplateID: item.templateId,
        Category: category,
        Kind: item.type,
        Name: item.name,
        Text: item.text,
        Notes: '',
        Answers: item.answer || ''
      };

      console.log('[CREATE VISUAL] Creating HUD record with data:', hudData);
      console.log('[CREATE VISUAL] Item details:', { id: item.id, templateId: item.templateId, name: item.name, answer: item.answer });

      const result = await firstValueFrom(this.caspioService.createServicesHUD(hudData));
      
      console.log('[CREATE VISUAL] API response:', result);
      
      if (result && result.Result && result.Result.length > 0) {
        const createdRecord = result.Result[0];
        this.visualRecordIds[key] = createdRecord.PK_ID || createdRecord.HUDID;
        console.log('[CREATE VISUAL] ✅ Created with ID:', this.visualRecordIds[key]);
        console.log('[CREATE VISUAL] Created record:', createdRecord);
        
        // Initialize photo array
        this.visualPhotos[key] = [];
        this.photoCountsByKey[key] = 0;
      } else {
        console.error('[CREATE VISUAL] ❌ No result from API');
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
      await firstValueFrom(this.caspioService.deleteServicesHUD(visualId));
      
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
    const visualId = this.visualRecordIds[key];

    console.log('[ANSWER CHANGE] Answer changed for:', item.name, 'to:', item.answer);

    if (!visualId) {
      console.log('[ANSWER CHANGE] No visual record exists, creating one');
      await this.createVisualRecord(category, item.id);
      return;
    }

    this.savingItems[key] = true;

    try {
      await firstValueFrom(this.caspioService.updateServicesHUD(visualId, {
        Answers: item.answer || ''
      }));
      console.log('[ANSWER CHANGE] Saved successfully');
    } catch (error) {
      console.error('[ANSWER CHANGE] Error saving:', error);
    } finally {
      this.savingItems[key] = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  async onOptionToggle(category: string, item: VisualItem, option: string, event: any) {
    const key = `${category}_${item.id}`;
    const isChecked = event.detail.checked;
    
    console.log('[OPTION TOGGLE] Item:', item.name, 'Option:', option, 'Checked:', isChecked);
    console.log('[OPTION TOGGLE] Current visualRecordId:', this.visualRecordIds[key]);
    console.log('[OPTION TOGGLE] Current answer before change:', item.answer);
    
    // Update item.answer with comma-separated selected options
    let selectedOptions = item.answer ? item.answer.split(',').map(s => s.trim()).filter(s => s) : [];
    
    if (isChecked) {
      if (!selectedOptions.includes(option)) {
        selectedOptions.push(option);
      }
    } else {
      selectedOptions = selectedOptions.filter(o => o !== option);
      
      // Clear "Other" value if unchecking "Other"
      if (option === 'Other') {
        item.otherValue = '';
      }
    }
    
    item.answer = selectedOptions.join(', ');
    
    console.log('[OPTION TOGGLE] New answer after change:', item.answer);
    console.log('[OPTION TOGGLE] Selected options array:', selectedOptions);
    
    // If this is the first selection and no visual record exists, create it
    if (!this.visualRecordIds[key] && selectedOptions.length > 0) {
      console.log('[OPTION TOGGLE] Creating new visual record (first selection)');
      this.selectedItems[key] = true; // Mark as selected
      await this.createVisualRecord(category, item.id);
    } else if (selectedOptions.length === 0) {
      // If all options unchecked, delete the visual record
      console.log('[OPTION TOGGLE] Deleting visual record (no selections)');
      this.selectedItems[key] = false;
      await this.deleteVisualRecord(category, item.id);
    } else {
      // Just update the answer
      console.log('[OPTION TOGGLE] Updating existing visual record');
      await this.onAnswerChange(category, item);
    }
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

  async addPhotoFromCamera(category: string, itemId: string | number) {
    const key = `${category}_${itemId}`;
    const visualId = this.visualRecordIds[key];

    if (!visualId) {
      await this.showToast('Please save the item first before adding photos', 'warning');
      return;
    }

    // Store context for when photo is captured
    this.currentUploadContext = { category, itemId: String(itemId), action: 'camera' };

    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera
      });

      if (image.webPath) {
        await this.processPhotoCapture(image.webPath, key, visualId);
      }
    } catch (error) {
      console.error('[CAMERA] Error capturing photo:', error);
    } finally {
      this.currentUploadContext = null;
    }
  }

  async addPhotoFromGallery(category: string, itemId: string | number) {
    const key = `${category}_${itemId}`;
    const visualId = this.visualRecordIds[key];

    if (!visualId) {
      await this.showToast('Please save the item first before adding photos', 'warning');
      return;
    }

    this.currentUploadContext = { category, itemId: String(itemId), action: 'gallery' };
    this.fileInput.nativeElement.click();
  }

  async onFileSelected(event: any) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    if (!this.currentUploadContext) {
      console.error('[FILE SELECTED] No upload context');
      return;
    }

    const key = `${this.currentUploadContext.category}_${this.currentUploadContext.itemId}`;
    const visualId = this.visualRecordIds[key];

    if (!visualId) {
      await this.showToast('Visual record not found', 'danger');
      return;
    }

    for (const file of files) {
      await this.uploadPhotoFile(file, key, visualId);
    }

    // Clear file input
    event.target.value = '';
    this.currentUploadContext = null;
  }

  private async processPhotoCapture(webPath: string, key: string, visualId: string) {
    try {
      // Convert webPath to blob
      const response = await fetch(webPath);
      const blob = await response.blob();
      const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' });

      await this.uploadPhotoFile(file, key, visualId);
    } catch (error) {
      console.error('[PROCESS PHOTO] Error:', error);
      await this.showToast('Failed to process photo', 'danger');
    }
  }

  private async uploadPhotoFile(file: File, key: string, visualId: string) {
    // Create temporary photo placeholder
    const tempId = `temp_${Date.now()}_${Math.random()}`;
    const tempPhoto = {
      AttachID: tempId,
      id: tempId,
      url: URL.createObjectURL(file),
      uploading: true,
      progress: 0
    };

    if (!this.visualPhotos[key]) {
      this.visualPhotos[key] = [];
    }
    this.visualPhotos[key].push(tempPhoto);
    this.uploadingPhotosByKey[key] = true;
    this.changeDetectorRef.detectChanges();

    try {
      // Compress image
      const compressedBlob = await this.imageCompression.compressImage(file);
      
      // Convert Blob to File
      const compressedFile = new File([compressedBlob], file.name, { 
        type: compressedBlob.type || 'image/jpeg' 
      });
      
      // Upload to Caspio
      const result = await firstValueFrom(
        this.caspioService.createServicesHUDAttachWithFile(
          parseInt(visualId),
          '', // annotation
          compressedFile,
          undefined, // drawings
          file // originalFile
        )
      );

      // Update temp photo with real data
      const photoIndex = this.visualPhotos[key].findIndex(p => p.AttachID === tempId);
      if (photoIndex > -1 && result) {
        await this.updatePhotoAfterUpload(key, photoIndex, result, '');
      }

      console.log('[UPLOAD] Photo uploaded successfully');
    } catch (error) {
      console.error('[UPLOAD] Error uploading photo:', error);
      
      // Remove failed photo
      const photoIndex = this.visualPhotos[key].findIndex(p => p.AttachID === tempId);
      if (photoIndex > -1) {
        this.visualPhotos[key].splice(photoIndex, 1);
      }
      
      await this.showToast('Failed to upload photo', 'danger');
    } finally {
      this.uploadingPhotosByKey[key] = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  async viewPhoto(photo: any, key: string) {
    // TODO: Implement photo viewer modal
    console.log('[VIEW PHOTO] Opening photo viewer for:', photo);
    await this.showToast('Photo viewer not yet implemented', 'primary');
  }

  async deletePhoto(photo: any, key: string) {
    const attachId = photo.AttachID || photo.id;
    
    if (!attachId || String(attachId).startsWith('temp_')) {
      // Remove from array if it's a temp photo
      const photoIndex = this.visualPhotos[key].findIndex(p => p.AttachID === attachId);
      if (photoIndex > -1) {
        this.visualPhotos[key].splice(photoIndex, 1);
      }
      return;
    }

    const confirm = await this.alertController.create({
      header: 'Delete Photo',
      message: 'Are you sure you want to delete this photo?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          cssClass: 'danger',
          handler: async () => {
            try {
              await firstValueFrom(this.caspioService.deleteServicesHUDAttach(attachId));
              
              // Remove from array
              const photoIndex = this.visualPhotos[key].findIndex(p => 
                (p.AttachID === attachId || p.id === attachId)
              );
              if (photoIndex > -1) {
                this.visualPhotos[key].splice(photoIndex, 1);
              }
              
              this.changeDetectorRef.detectChanges();
              await this.showToast('Photo deleted', 'success');
            } catch (error) {
              console.error('[DELETE PHOTO] Error:', error);
              await this.showToast('Failed to delete photo', 'danger');
            }
          }
        }
      ]
    });
    
    await confirm.present();
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
}

