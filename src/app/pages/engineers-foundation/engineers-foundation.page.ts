import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { CaspioService } from '../../services/caspio.service';
import { ToastController, LoadingController, AlertController, ActionSheetController, ModalController, Platform } from '@ionic/angular';
import { CameraService } from '../../services/camera.service';
import { PhotoViewerComponent } from '../../components/photo-viewer/photo-viewer.component';
import { PhotoAnnotatorComponent } from '../../components/photo-annotator/photo-annotator.component';

interface ElevationReading {
  location: string;
  value: number | null;
}

interface ServicesVisualRecord {
  ServiceID: number;  // Changed to number to match Integer type in Caspio
  Category: string;
  Kind: string;  // Changed from Type to Kind
  Name: string;
  Text: string;  // The full text content
  Notes: string;  // Made required, will send empty string if not provided
}

@Component({
  selector: 'app-engineers-foundation',
  templateUrl: './engineers-foundation.page.html',
  styleUrls: ['./engineers-foundation.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class EngineersFoundationPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  
  projectId: string = '';
  serviceId: string = '';
  projectData: any = null;
  currentUploadContext: any = null;
  uploadingPhotos: { [key: string]: number } = {}; // Track uploads per visual
  
  // Categories from Services_Visuals_Templates
  visualCategories: string[] = [];
  visualTemplates: any[] = [];
  expandedCategories: { [key: string]: boolean } = {};
  categoryData: { [key: string]: any } = {};
  
  // Organized by Type within each Category
  organizedData: { [category: string]: { 
    comments: any[], 
    limitations: any[], 
    deficiencies: any[] 
  }} = {};
  
  // Track selected items
  selectedItems: { [key: string]: boolean } = {};
  
  // Track saving state for items
  savingItems: { [key: string]: boolean } = {};
  
  // Track visual record IDs from Services_Visuals table
  visualRecordIds: { [key: string]: string } = {};
  
  // Track photos for each visual
  visualPhotos: { [visualId: string]: any[] } = {};
  
  // Form data for the template
  formData: any = {
    // Elevation Plot fields
    elevationAnalysis: '',
    
    // Additional fields to be added based on requirements
  };
  
  // Elevation readings array
  elevationReadings: ElevationReading[] = [];
  
  // Room templates for elevation plot
  roomTemplates: any[] = [];
  roomElevationData: { [roomName: string]: any } = {};
  
  // UI state
  expandedSections: { [key: string]: boolean } = {
    project: false,  // Project Details collapsed by default
    structural: false,  // Structural Systems collapsed by default
    elevation: false
  };
  
  // Track which accordion categories are expanded
  expandedAccordions: string[] = [];
  @ViewChild('visualAccordionGroup') visualAccordionGroup: any;
  
  saveStatus: string = '';
  saveStatusType: 'info' | 'success' | 'error' = 'info';
  
  // Track field completion
  fieldCompletion: { [key: string]: number } = {
    structural: 0,
    elevation: 0
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private caspioService: CaspioService,
    private toastController: ToastController,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private actionSheetController: ActionSheetController,
    private modalController: ModalController,
    private changeDetectorRef: ChangeDetectorRef,
    private cameraService: CameraService,
    private platform: Platform
  ) {}

  async ngOnInit() {
    // Get project ID from route params
    this.projectId = this.route.snapshot.paramMap.get('projectId') || '';
    this.serviceId = this.route.snapshot.paramMap.get('serviceId') || '';
    
    console.log('Engineers Foundation Evaluation initialized:', {
      projectId: this.projectId,
      serviceId: this.serviceId
    });
    
    // Load project data
    await this.loadProjectData();
    
    // Load visual categories from Services_Visuals_Templates FIRST
    await this.loadVisualCategories();
    
    // Load room templates for elevation plot
    await this.loadRoomTemplates();
    
    // Then load any existing template data (including visual selections)
    await this.loadExistingData();
    
    // Initialize with some default elevation readings
    if (this.elevationReadings.length === 0) {
      this.addElevationReading();
    }
  }
  
  ngAfterViewInit() {
    // ViewChild ready
  }
  
  ngOnDestroy() {
    // Clean up timers
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    
    // Clean up object URLs to prevent memory leaks
    Object.values(this.visualPhotos).forEach((photos: any) => {
      if (Array.isArray(photos)) {
        photos.forEach((photo: any) => {
          if (photo.isObjectUrl && photo.url) {
            URL.revokeObjectURL(photo.url);
          }
        });
      }
    });
    
    // Clear any data to prevent memory leaks
    this.visualPhotos = {};
    this.roomElevationData = {};
    this.roomTemplates = [];
    
    // Force garbage collection hints
    this.formData = {};
    this.elevationReadings = [];
  }
  
  async loadProjectData() {
    if (!this.projectId) return;
    
    try {
      const loading = await this.loadingController.create({
        message: 'Loading project data...'
      });
      await loading.present();
      
      this.projectData = await this.caspioService.getProject(this.projectId).toPromise();
      console.log('Project data loaded:', this.projectData);
      
      await loading.dismiss();
    } catch (error) {
      console.error('Error loading project data:', error);
      await this.showToast('Failed to load project data', 'danger');
    }
  }
  
  async loadRoomTemplates() {
    try {
      console.log('Loading room templates from Services_Room_Templates...');
      
      const allTemplates = await this.caspioService.getServicesRoomTemplates().toPromise();
      
      if (allTemplates && allTemplates.length > 0) {
        // Filter templates where Auto = 'Yes'
        const autoTemplates = allTemplates.filter((template: any) => 
          template.Auto === 'Yes' || template.Auto === true || template.Auto === 1
        );
        
        this.roomTemplates = autoTemplates;
        console.log(`Loaded ${autoTemplates.length} auto room templates from ${allTemplates.length} total:`, autoTemplates);
        
        // Initialize room elevation data for each auto template
        autoTemplates.forEach((template: any) => {
          if (template.RoomName && !this.roomElevationData[template.RoomName]) {
            // Extract elevation points from Point1Name, Point2Name, etc.
            const elevationPoints: any[] = [];
            
            // Check for up to 20 point columns (Point1Name through Point20Name)
            for (let i = 1; i <= 20; i++) {
              const pointColumnName = `Point${i}Name`;
              const pointName = template[pointColumnName];
              
              if (pointName && pointName.trim() !== '') {
                elevationPoints.push({
                  pointNumber: i,
                  name: pointName,
                  value: '',  // User will input the elevation value
                  photo: null  // User can attach a photo
                });
              }
            }
            
            console.log(`Room ${template.RoomName} has ${elevationPoints.length} elevation points:`, elevationPoints);
            
            this.roomElevationData[template.RoomName] = {
              roomName: template.RoomName,
              templateId: template.PK_ID || template.TemplateId,
              elevationPoints: elevationPoints,
              pointCount: template.PointCount || elevationPoints.length,
              points: [],  // Legacy - keeping for compatibility
              expanded: false,
              notes: ''
            };
          }
        });
        
        console.log('Initialized room elevation data:', this.roomElevationData);
      } else {
        console.log('No room templates found in Services_Room_Templates');
        this.roomTemplates = [];
      }
    } catch (error: any) {
      console.error('Error loading room templates (non-critical):', error);
      this.roomTemplates = [];
      // Don't reset roomElevationData if it already has data
      if (!this.roomElevationData || Object.keys(this.roomElevationData).length === 0) {
        this.roomElevationData = {};
      }
    }
  }

  async loadVisualCategories() {
    try {
      // Get all templates - filter by TypeID = 1 for Foundation Evaluation
      const allTemplates = await this.caspioService.getServicesVisualsTemplates().toPromise();
      
      // Filter templates for TypeID = 1 (Foundation Evaluation)
      this.visualTemplates = (allTemplates || []).filter(template => template.TypeID === 1);
      
      console.log(`Filtered ${this.visualTemplates.length} templates for Foundation Evaluation (TypeID = 1)`);
      
      // Extract unique categories in order they appear
      const categoriesSet = new Set<string>();
      const categoriesOrder: string[] = [];
      
      this.visualTemplates.forEach(template => {
        if (template.Category && !categoriesSet.has(template.Category)) {
          categoriesSet.add(template.Category);
          categoriesOrder.push(template.Category);
        }
      });
      
      // Use the order they appear in the table, not alphabetical
      this.visualCategories = categoriesOrder;
      console.log('Categories in original order:', this.visualCategories);
      
      // Initialize organized data structure for each category
      this.visualCategories.forEach(category => {
        this.expandedCategories[category] = false;
        this.categoryData[category] = {};
        
        // Initialize organized structure
        this.organizedData[category] = {
          comments: [],
          limitations: [],
          deficiencies: []
        };
        
        // Get all templates for this category
        const categoryTemplates = this.visualTemplates.filter(t => t.Category === category);
        
        // Organize templates by Type
        categoryTemplates.forEach(template => {
          const templateData = {
            id: template.PK_ID,
            name: template.Name,
            text: template.Text || '',
            kind: template.Kind, // Changed from Type to Kind
            category: template.Category
          };
          
          // Initialize selection state
          this.selectedItems[`${category}_${template.PK_ID}`] = false;
          
          // Sort into appropriate Kind section (was Type, now Kind)
          const kindStr = String(template.Kind || '').toLowerCase();
          if (kindStr.includes('comment')) {
            this.organizedData[category].comments.push(templateData);
          } else if (kindStr.includes('limitation')) {
            this.organizedData[category].limitations.push(templateData);
          } else if (kindStr.includes('deficienc')) {
            this.organizedData[category].deficiencies.push(templateData);
          } else {
            // Default to comments if kind is unclear
            this.organizedData[category].comments.push(templateData);
          }
          
          // Keep old structure for compatibility
          this.categoryData[category][template.PK_ID] = {
            templateId: template.PK_ID,
            name: template.Name,
            text: template.Text,
            kind: template.Kind, // Changed from Type to Kind
            selected: false,
            value: '',
            notes: ''
          };
        });
      });
      
      console.log('Visual categories loaded:', this.visualCategories);
      console.log('Organized data:', this.organizedData);
      console.log('Category templates:', this.categoryData);
    } catch (error) {
      console.error('Error loading visual categories:', error);
      await this.showToast('Failed to load template categories', 'warning');
    }
  }
  
  async loadExistingData() {
    // Load existing visual selections from Services_Visuals table
    await this.loadExistingVisualSelections();
    
    // TODO: Load existing template data from Service_EFE table
    // This will be implemented based on your Caspio table structure
    
    // For now, check localStorage for draft data
    const draftKey = `efe_template_${this.projectId}_${this.serviceId}`;
    const draftData = localStorage.getItem(draftKey);
    
    if (draftData) {
      try {
        const parsed = JSON.parse(draftData);
        this.formData = { ...this.formData, ...parsed.formData };
        this.elevationReadings = parsed.elevationReadings || [];
        
        // Skip loading room elevation data to prevent issues
        
        console.log('Draft data loaded from localStorage');
      } catch (error) {
        console.error('Error loading draft data:', error);
      }
    }
  }
  
  async loadExistingVisualSelections() {
    console.log('=====================================');
    console.log('📥 LOADING EXISTING VISUAL SELECTIONS');
    console.log('=====================================');
    console.log('   ServiceID:', this.serviceId);
    
    if (!this.serviceId) {
      console.log('❌ No ServiceID - skipping load');
      return;
    }
    
    try {
      console.log('⏳ Fetching from Services_Visuals table...');
      const existingVisuals = await this.caspioService.getServicesVisualsByServiceId(this.serviceId).toPromise();
      console.log('📋 Existing visuals loaded:', existingVisuals);
      console.log('   Count:', existingVisuals?.length || 0);
      
      // Mark items as selected based on existing records
      if (existingVisuals && Array.isArray(existingVisuals)) {
        existingVisuals.forEach(visual => {
          console.log('🔍 Processing visual:', visual);
          
          // Find matching template by Name and Category
          if (visual.Category && visual.Name) {
            // Find the template that matches this visual
            const matchingTemplate = this.visualTemplates.find(t => 
              t.Category === visual.Category && 
              t.Name === visual.Name
            );
            
            if (matchingTemplate) {
              const key = `${visual.Category}_${matchingTemplate.PK_ID}`;
              console.log('✅ Found matching template, marking as selected:', key);
              console.log('   Template PK_ID:', matchingTemplate.PK_ID);
              console.log('   Visual Name:', visual.Name);
              this.selectedItems[key] = true;
              
              // Store the visual record ID
              const visualId = visual.VisualID || visual.PK_ID || visual.id;
              
              // Store in tracking object for photo uploads - ALWAYS as string
              this.visualRecordIds[key] = String(visualId);
              
              console.log('📌 Stored visual ID:', visualId, 'for key:', key, 'Type:', typeof this.visualRecordIds[key]);
              console.log('📋 Updated selectedItems:', this.selectedItems);
            } else {
              console.log('⚠️ No matching template found for:', visual.Name);
            }
          }
        });
      }
      
      console.log('✅ Visual selections restored:', this.selectedItems);
      console.log('📌 Visual record IDs:', this.visualRecordIds);
      
      // Add a small delay to ensure visual IDs are properly set
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Load existing photos for these visuals
      console.log('📸 About to load existing photos...');
      await this.loadExistingPhotos();
      console.log('📸 Finished loading existing photos');
    } catch (error) {
      console.error('Error loading existing visual selections:', error);
    }
  }
  
  toggleSection(section: string) {
    this.expandedSections[section] = !this.expandedSections[section];
  }
  
  // Track which accordions are expanded
  onAccordionChange(event: any) {
    console.log('Accordion changed:', event.detail.value);
    if (event.detail.value) {
      // Store the expanded accordion value
      this.expandedAccordions = Array.isArray(event.detail.value) 
        ? event.detail.value 
        : [event.detail.value];
    } else {
      this.expandedAccordions = [];
    }
  }
  
  // Ensure accordion values are synced without causing UI flicker
  private restoreAccordionState() {
    // Simply ensure accordion values are set if needed
    if (this.visualAccordionGroup && this.expandedAccordions.length > 0) {
      this.visualAccordionGroup.value = this.expandedAccordions;
    }
    // No need to mess with expandedSections - they should maintain their state naturally
  }
  
  getSectionCompletion(section: string): number {
    // Calculate completion percentage based on filled fields
    switch(section) {
      case 'structural':
        const structuralFields = ['foundationType', 'foundationCondition', 'structuralObservations'];
        const filledStructural = structuralFields.filter(field => this.formData[field]).length;
        return Math.round((filledStructural / structuralFields.length) * 100);
        
      case 'elevation':
        const hasReadings = this.elevationReadings.some(r => r.location && r.value !== null);
        const hasAnalysis = !!this.formData.elevationAnalysis;
        if (hasReadings && hasAnalysis) return 100;
        if (hasReadings || hasAnalysis) return 50;
        return 0;
        
      default:
        return 0;
    }
  }
  
  // Elevation readings management
  addElevationReading() {
    this.elevationReadings.push({
      location: '',
      value: null
    });
  }
  
  removeElevationReading(index: number) {
    this.elevationReadings.splice(index, 1);
  }
  
  clearElevationReadings() {
    this.elevationReadings = [];
    this.addElevationReading(); // Add one empty reading
  }
  
  // Room elevation helper methods
  private saveDebounceTimer: any;
  
  onRoomNotesChange(roomName: string) {
    console.log(`Notes changed for room ${roomName}`);
    // Debounce auto-save to prevent too frequent saves
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDraft();
    }, 1000); // Save after 1 second of no changes
  }

  // Handle elevation point value change
  onElevationPointChange(roomName: string, point: any) {
    console.log(`Elevation changed for ${roomName} - ${point.name}: ${point.value}`);
    
    // Save to draft after a delay
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDraft();
    }, 1000);
  }

  // Take photo for elevation point
  async takePhotoForElevationPoint(roomName: string, point: any, event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    console.log(`Taking photo for elevation point: ${roomName} - ${point.name}`);
    
    try {
      // Initialize photos array if needed
      if (!point.photos) {
        point.photos = [];
      }
      
      // Create file input for camera
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'camera' as any;
      input.multiple = true; // Allow multiple photos
      
      const filesSelected = new Promise<FileList | null>((resolve) => {
        input.onchange = (event: any) => {
          resolve(event.target?.files || null);
        };
      });
      
      input.click();
      
      const files = await filesSelected;
      if (files && files.length > 0) {
        // Convert files to preview URLs
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const objectUrl = URL.createObjectURL(file);
          
          point.photos.push({
            file: file,
            url: objectUrl,
            thumbnailUrl: objectUrl,
            name: file.name,
            isObjectUrl: true
          });
        }
        
        // Update photo count
        point.photoCount = point.photos.length;
        
        console.log(`Added ${files.length} photo(s) to ${point.name}. Total: ${point.photoCount}`);
        await this.showToast(`${files.length} photo(s) added to ${point.name}`, 'success');
        
        // TODO: Upload to Caspio when saving
        this.saveDraft();
      }
    } catch (error) {
      console.error('Error taking photo for elevation point:', error);
      await this.showToast('Failed to capture photo', 'danger');
    }
  }

  // View elevation photo in modal
  async viewElevationPhoto(photo: any) {
    console.log('Viewing elevation photo:', photo);
    
    // Use the PhotoViewerComponent directly since we don't have category/itemId context
    if (photo && (photo.url || photo.filePath)) {
      const modal = await this.modalController.create({
        component: PhotoViewerComponent,
        componentProps: {
          photo: {
            ...photo,
            Photo: photo.filePath || photo.url
          }
        },
        cssClass: 'photo-viewer-modal'
      });
      await modal.present();
    }
  }
  
  // Save and submit functions
  saveDraft() {
    try {
      // Save to localStorage as draft (non-async version for auto-save)
      const draftKey = `efe_template_${this.projectId}_${this.serviceId}`;
      const draftData = {
        formData: this.formData,
        elevationReadings: this.elevationReadings,
        // Removed roomElevationData to prevent memory issues
        savedAt: new Date().toISOString()
      };
      
      localStorage.setItem(draftKey, JSON.stringify(draftData));
      console.log('Draft saved at', new Date().toLocaleTimeString());
    } catch (error) {
      console.error('Error saving draft:', error);
    }
  }

  async saveTemplate() {
    // Save to localStorage as draft
    this.saveDraft();
    this.showSaveStatus('Draft saved locally', 'success');
    await this.showToast('Template saved as draft', 'success');
  }
  
  async submitTemplate() {
    // Validate required fields
    if (!this.formData.foundationType || !this.formData.foundationCondition) {
      await this.showToast('Please fill in all required fields', 'warning');
      return;
    }
    
    const loading = await this.loadingController.create({
      message: 'Submitting evaluation...'
    });
    await loading.present();
    
    try {
      // TODO: Submit to Caspio Service_EFE table
      // This will be implemented based on your specific requirements
      
      const submitData = {
        ProjectID: this.projectId,
        ServiceID: this.serviceId,
        ...this.formData,
        ElevationReadings: JSON.stringify(this.elevationReadings),
        SubmittedAt: new Date().toISOString()
      };
      
      console.log('Submitting template data:', submitData);
      
      // For now, just simulate success
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      await loading.dismiss();
      await this.showToast('Evaluation submitted successfully', 'success');
      
      // Clear draft
      const draftKey = `efe_template_${this.projectId}_${this.serviceId}`;
      localStorage.removeItem(draftKey);
      
      // Navigate back
      this.router.navigate(['/project-detail', this.projectId]);
      
    } catch (error) {
      console.error('Error submitting template:', error);
      await loading.dismiss();
      await this.showToast('Failed to submit evaluation', 'danger');
    }
  }
  
  // Utility functions
  formatDate(dateString: string): string {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString();
    } catch {
      return dateString;
    }
  }
  
  showSaveStatus(message: string, type: 'info' | 'success' | 'error') {
    this.saveStatus = message;
    this.saveStatusType = type;
    
    setTimeout(() => {
      this.saveStatus = '';
    }, 3000);
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
  
  // Helper methods for template
  getTemplatesForCategory(category: string): any[] {
    return this.visualTemplates.filter(t => t.Category === category);
  }
  
  getTemplatesCountForCategory(category: string): number {
    return this.visualTemplates.filter(t => t.Category === category).length;
  }
  
  // Toggle item selection
  async toggleItemSelection(category: string, itemId: string) {
    console.log('=====================================');
    console.log('🔄 TOGGLE ITEM SELECTION CALLED');
    console.log('=====================================');
    console.log('   Category:', category);
    console.log('   ItemID:', itemId);
    
    const key = `${category}_${itemId}`;
    const wasSelected = this.selectedItems[key];
    
    console.log('   Key:', key);
    console.log('   Was Selected:', wasSelected);
    console.log('   Will be Selected:', !wasSelected);
    
    // Set saving state
    this.savingItems[key] = true;
    
    this.selectedItems[key] = !wasSelected;
    
    // Update the categoryData as well
    if (this.categoryData[category] && this.categoryData[category][itemId]) {
      this.categoryData[category][itemId].selected = this.selectedItems[key];
    }
    
    console.log('✅ Item toggled:', key, 'New state:', this.selectedItems[key]);
    
    try {
      // Save or remove from Services_Visuals table
      if (this.selectedItems[key]) {
        // Item was selected - save to Services_Visuals
        await this.saveVisualSelection(category, itemId);
        await this.showToast('Selection saved', 'success');
      } else {
        // Item was deselected - remove from Services_Visuals if exists
        await this.removeVisualSelection(category, itemId);
      }
    } finally {
      // Clear saving state
      this.savingItems[key] = false;
    }
  }
  
  // Save visual selection to Services_Visuals table
  async saveVisualSelection(category: string, templateId: string) {
    console.log('=====================================');
    console.log('🔍 SAVING VISUAL TO SERVICES_VISUALS');
    console.log('=====================================');
    
    if (!this.serviceId) {
      console.error('❌ No ServiceID available for saving visual');
      return;
    }
    
    console.log('📋 Input Parameters:');
    console.log('   Category:', category);
    console.log('   TemplateID:', templateId);
    console.log('   ServiceID:', this.serviceId);
    
    // Find the template data first
    const template = this.visualTemplates.find(t => t.PK_ID === templateId);
    if (!template) {
      console.error('❌ Template not found:', templateId);
      return;
    }
    
    // Check if this visual already exists
    const key = `${category}_${templateId}`;
    if (this.visualRecordIds[key]) {
      console.log('⚠️ Visual already exists with ID:', this.visualRecordIds[key]);
      console.log('   Skipping duplicate save');
      return;
    }
    
    // Also check if it exists in the database but wasn't loaded yet
    try {
      const existingVisuals = await this.caspioService.getServicesVisualsByServiceId(this.serviceId).toPromise();
      if (existingVisuals) {
        const exists = existingVisuals.find((v: any) => 
          v.Category === category && 
          v.Name === template.Name
        );
        if (exists) {
          console.log('⚠️ Visual already exists in database:', exists);
          // Store the ID for future reference - ALWAYS as string
          const existingId = exists.VisualID || exists.PK_ID || exists.id;
          this.visualRecordIds[key] = String(existingId);
          console.log('   Stored existing ID:', this.visualRecordIds[key], 'Type:', typeof this.visualRecordIds[key]);
          return;
        }
      }
    } catch (error) {
      console.error('Error checking for existing visual:', error);
    }
    
    console.log('📄 Template Found:', template);
    
    // Convert ServiceID to number (Caspio expects Integer type)
    const serviceIdNum = parseInt(this.serviceId, 10);
    if (isNaN(serviceIdNum)) {
      console.error('❌ Invalid ServiceID - not a number:', this.serviceId);
      await this.showToast('Invalid Service ID', 'danger');
      return;
    }
    
    // ONLY include the columns that exist in Services_Visuals table
    const visualData: ServicesVisualRecord = {
      ServiceID: serviceIdNum,  // Integer type in Caspio
      Category: category || '',   // Text(255) in Caspio
      Kind: template.Kind || '',  // Text(255) in Caspio - was Type, now Kind
      Name: template.Name || '',  // Text(255) in Caspio
      Text: template.Text || '',   // Text field in Caspio - the full text content
      Notes: ''                    // Text(255) in Caspio - empty for now
    };
    
    console.log('📤 DATA BEING SENT TO SERVICES_VISUALS TABLE:');
    console.log('=====================================');
    console.log('COLUMN MAPPING TO SERVICES_VISUALS TABLE:');
    console.log('   ServiceID (Integer):', visualData.ServiceID, typeof visualData.ServiceID);
    console.log('   Category (Text 255):', visualData.Category);
    console.log('   Kind (Text 255):', visualData.Kind);
    console.log('   Name (Text 255):', visualData.Name);
    console.log('   Text (Text field):', visualData.Text);
    console.log('   Notes (Text 255):', visualData.Notes);
    console.log('=====================================');
    console.log('📦 Full visualData object being sent:', JSON.stringify(visualData, null, 2));
    console.log('📌 Template info for reference (not sent):', {
      TemplateID: templateId,
      Text: template.Text
    });
    
    try {
      console.log('⏳ Calling caspioService.createServicesVisual...');
      const response = await this.caspioService.createServicesVisual(visualData).toPromise();
      console.log('✅ Visual saved to Services_Visuals:', response);
      console.log('✅ Response details:', JSON.stringify(response, null, 2));
      
      // Skip debug popup for faster performance
      // await this.showVisualCreationDebug(category, templateId, response);
      
      // Check if response exists (even if empty, it might mean success)
      // Caspio sometimes returns empty response on successful POST
      if (response === undefined || response === null || response === '') {
        console.log('⚠️ Empty response received - treating as success (common with Caspio)');
        // Generate a temporary ID for tracking
        const tempId = `temp_${Date.now()}`;
        const recordKey = `visual_${category}_${templateId}`;
        localStorage.setItem(recordKey, tempId);
        this.visualRecordIds[`${category}_${templateId}`] = String(tempId);
        
        // Query the table to get the actual VisualID
        setTimeout(async () => {
          await this.refreshVisualId(category, templateId);
        }, 1000);
        
        console.log('✅ Visual appears to be saved (will verify)');
        return; // Exit successfully
      }
      
      // Store the record ID for potential deletion later
      // Response should have the created record
      let visualId: any;
      
      // If response is an array, get the first item
      // IMPORTANT: Use VisualID, not PK_ID for Services_Visuals table
      if (Array.isArray(response) && response.length > 0) {
        visualId = response[0].VisualID || response[0].PK_ID || response[0].id;
        console.log('📋 Response was array, extracted ID from first item:', visualId);
        console.log('   - VisualID:', response[0].VisualID, '(preferred)');
        console.log('   - PK_ID:', response[0].PK_ID, '(not used if VisualID exists)');
      } else if (response && typeof response === 'object') {
        // If response has Result array (Caspio pattern)
        if (response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
          visualId = response.Result[0].VisualID || response.Result[0].PK_ID || response.Result[0].id;
          console.log('📋 Response had Result array, extracted ID:', visualId);
          console.log('   - VisualID:', response.Result[0].VisualID, '(preferred)');
          console.log('   - PK_ID:', response.Result[0].PK_ID, '(not used if VisualID exists)');
        } else {
          // Direct object response
          visualId = response.VisualID || response.PK_ID || response.id;
          console.log('📋 Response was object, extracted ID:', visualId);
          console.log('   - VisualID:', response.VisualID, '(preferred)');
          console.log('   - PK_ID:', response.PK_ID, '(not used if VisualID exists)');
        }
      } else {
        // Response might be the ID itself
        visualId = response;
        console.log('📋 Response was ID directly:', visualId);
      }
      
      console.log('🔍 Full response object:', JSON.stringify(response, null, 2));
      console.log('🔍 Extracted VisualID:', visualId);
      
      const recordKey = `visual_${category}_${templateId}`;
      localStorage.setItem(recordKey, String(visualId));
      
      // Store in our tracking object for photo uploads
      this.visualRecordIds[`${category}_${templateId}`] = String(visualId);
      console.log('📌 Visual Record ID stored:', visualId, 'for key:', `${category}_${templateId}`);
      
    } catch (error: any) {
      console.error('⚠️ Error during save (checking if actually failed):', error);
      console.error('=====================================');
      console.error('ERROR DETAILS:');
      console.error('   Status:', error?.status);
      console.error('   Status Text:', error?.statusText);
      console.error('   Message:', error?.message);
      console.error('   Error Body:', error?.error);
      console.error('=====================================');
      
      // Show debug alert for the error
      const errorAlert = await this.alertController.create({
        header: 'Visual Save Error',
        message: `
          <div style="text-align: left; font-family: monospace; font-size: 12px;">
            <strong style="color: red;">❌ FAILED TO SAVE VISUAL</strong><br><br>
            
            <strong>Data Sent:</strong><br>
            • ServiceID: ${visualData.ServiceID}<br>
            • Category: ${visualData.Category}<br>
            • Kind: ${visualData.Kind}<br>
            • Name: ${visualData.Name}<br>
            • Text: ${visualData.Text?.substring(0, 50)}...<br>
            • Notes: ${visualData.Notes}<br><br>
            
            <strong>Error Details:</strong><br>
            • Status: ${error?.status || 'No status'}<br>
            • Status Text: ${error?.statusText || 'Unknown'}<br>
            • Message: ${error?.message || 'No message'}<br><br>
            
            <strong>Error Body:</strong><br>
            <div style="background: #ffe0e0; padding: 10px; border-radius: 5px; max-height: 150px; overflow-y: auto;">
              ${JSON.stringify(error?.error || error, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
            </div>
          </div>
        `,
        buttons: ['OK']
      });
      await errorAlert.present();
      
      // Check if it's a real error or just a response parsing issue
      // Status 200-299 means success even if response parsing failed
      if (error?.status >= 200 && error?.status < 300) {
        console.log('✅ Request was successful (status 2xx) - ignoring response parsing error');
        // Treat as success
        const tempId = `temp_${Date.now()}`;
        const recordKey = `visual_${category}_${templateId}`;
        localStorage.setItem(recordKey, tempId);
        this.visualRecordIds[`${category}_${templateId}`] = String(tempId);
        
        // Try to get the real ID
        setTimeout(async () => {
          await this.refreshVisualId(category, templateId);
        }, 1000);
        
        await this.showToast('Selection saved', 'success');
        return; // Keep the checkbox selected
      }
      
      // Check for specific error types
      if (error?.status === 400) {
        console.error('⚠️ 400 Bad Request - Check column names and data types');
        console.error('Expected columns: ServiceID (Integer), Category (Text), Kind (Text), Name (Text), Notes (Text)');
      } else if (!error?.status) {
        console.log('⚠️ No status code - might be a response parsing issue, checking table...');
        // Try to verify if it was actually saved
        setTimeout(async () => {
          const saved = await this.verifyVisualSaved(category, templateId);
          if (saved) {
            console.log('✅ Verified: Visual was actually saved');
            await this.showToast('Selection saved', 'success');
          } else {
            console.error('❌ Verified: Visual was NOT saved');
            // Only now revert the selection
            const key = `${category}_${templateId}`;
            this.selectedItems[key] = false;
            if (this.categoryData[category] && this.categoryData[category][templateId]) {
              this.categoryData[category][templateId].selected = false;
            }
          }
        }, 1000);
        return; // Don't revert immediately
      }
      
      await this.showToast('Failed to save selection', 'danger');
      
      // Only revert if we're sure it failed
      if (error?.status >= 400) {
        const key = `${category}_${templateId}`;
        this.selectedItems[key] = false;
        if (this.categoryData[category] && this.categoryData[category][templateId]) {
          this.categoryData[category][templateId].selected = false;
        }
      }
    }
  }
  
  // Remove visual selection from Services_Visuals table
  async removeVisualSelection(category: string, templateId: string) {
    // Check if we have a stored record ID
    const recordKey = `visual_${category}_${templateId}`;
    const recordId = localStorage.getItem(recordKey);
    
    if (recordId) {
      try {
        await this.caspioService.deleteServicesVisual(recordId).toPromise();
        console.log('✅ Visual removed from Services_Visuals');
        localStorage.removeItem(recordKey);
      } catch (error) {
        console.error('❌ Failed to remove visual:', error);
        // Don't show error toast for deletion failures
      }
    }
  }
  
  // Check if item is selected
  isItemSelected(category: string, itemId: string): boolean {
    return this.selectedItems[`${category}_${itemId}`] || false;
  }
  
  // Check if item is being saved
  isItemSaving(category: string, itemId: string): boolean {
    return this.savingItems[`${category}_${itemId}`] || false;
  }
  
  // Show full text in sleek editor modal
  async showFullText(item: any) {
    const alert = await this.alertController.create({
      header: 'View Details',
      cssClass: 'text-editor-modal',
      inputs: [
        {
          name: 'title',
          type: 'text',
          placeholder: 'Title',
          value: item.name || '',
          cssClass: 'editor-title-input'
        },
        {
          name: 'description',
          type: 'textarea',
          placeholder: 'Description',
          value: item.text || '',
          cssClass: 'editor-text-input',
          attributes: {
            rows: 8
          }
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          cssClass: 'editor-cancel-btn'
        },
        {
          text: 'Save',
          cssClass: 'editor-save-btn',
          handler: (data) => {
            // Update the item with new values
            if (data.title !== item.name || data.description !== item.text) {
              item.name = data.title;
              item.text = data.description;
              this.saveTemplate(); // Auto-save the changes
              this.showToast('Changes saved', 'success');
            }
            return true;
          }
        }
      ]
    });
    await alert.present();
  }
  
  // EXACT COPY OF uploadDocument from project-detail
  async uploadDocument(category: string, itemId: string, item: any) {
    // Show action sheet with camera and gallery options
    const actionSheet = await this.actionSheetController.create({
      header: 'Select Photo Source',
      buttons: [
        {
          text: 'Take Photo',
          icon: 'camera',
          handler: () => {
            this.capturePhotoFromCamera(category, itemId, item);
          }
        },
        {
          text: 'Choose from Gallery',
          icon: 'images',
          handler: () => {
            // Use existing file input for gallery
            this.currentUploadContext = { category, itemId, item, action: 'upload' };
            this.fileInput.nativeElement.click();
          }
        },
        {
          text: 'Cancel',
          icon: 'close',
          role: 'cancel'
        }
      ]
    });
    
    await actionSheet.present();
  }
  
  // New method to capture photo from camera
  async capturePhotoFromCamera(category: string, itemId: string, item: any) {
    try {
      // Prevent any navigation
      event?.preventDefault();
      event?.stopPropagation();
      
      const photo = await this.cameraService.takePicture();
      
      if (!photo || !photo.dataUrl) {
        console.log('No photo captured');
        return;
      }
      
      // Convert base64 to File
      const fileName = `photo_${Date.now()}.jpg`;
      const file = this.cameraService.base64ToFile(photo.dataUrl, fileName);
      
      // Get visual ID
      const key = `${category}_${itemId}`;
      let visualId = this.visualRecordIds[key];
      
      if (!visualId) {
        // Need to save the visual first
        await this.saveVisualSelection(category, itemId);
        visualId = this.visualRecordIds[key];
      }
      
      if (visualId) {
        // Upload the photo
        await this.uploadPhotoForVisual(visualId, file, key, false);
      }
    } catch (error) {
      console.error('Error capturing photo:', error);
      await this.showToast('Failed to capture photo', 'danger');
    }
  }
  
  // Multiple photo capture session with proper confirmation
  private async startMultiPhotoCapture(visualId: string, key: string, category: string, itemId: string) {
    const capturedPhotos: File[] = [];
    let keepCapturing = true;
    let photoCounter = 0;
    
    console.log('🎬 Starting multi-photo capture session');
    
    while (keepCapturing) {
      let currentFile: File | null = null;
      let retakePhoto = true;
      
      // Keep retaking until user is satisfied with the photo
      while (retakePhoto) {
        try {
          console.log(`📸 Opening camera for photo ${photoCounter + 1}`);
          
          // Create file input for camera capture
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.capture = 'camera' as any; // Force camera
          
          const fileSelected = new Promise<File | null>((resolve) => {
            let resolved = false;
            
            input.onchange = (event: any) => {
              if (!resolved) {
                resolved = true;
                const file = event.target?.files?.[0];
                console.log('📁 File selected:', file?.name);
                resolve(file || null);
              }
            };
            
            // Add a listener for cancel - give reasonable timeout
            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                resolve(null);
              }
            }, 120000); // 2 minutes timeout
          });
          
          input.click();
          
          currentFile = await fileSelected;
          
          if (currentFile) {
            // Show preview and options
            const objectUrl = URL.createObjectURL(currentFile);
            
            // Create custom alert with photo preview
            const alert = await this.alertController.create({
              header: 'Photo Review',
              message: `
                <div style="text-align: center;">
                  <img src="${objectUrl}" style="max-width: 100%; max-height: 200px; border-radius: 8px; margin: 10px 0;">
                  <p style="margin-top: 10px;">What would you like to do with this photo?</p>
                </div>
              `,
              buttons: [
                {
                  text: 'Retake',
                  role: 'retake',
                  cssClass: 'alert-button-retake',
                  handler: () => {
                    console.log('👤 User chose to retake photo');
                    URL.revokeObjectURL(objectUrl);
                    retakePhoto = true;
                    return true;
                  }
                },
                {
                  text: 'Use Photo',
                  role: 'use',
                  cssClass: 'alert-button-use',
                  handler: () => {
                    console.log('✅ User chose to use photo');
                    URL.revokeObjectURL(objectUrl);
                    retakePhoto = false;
                    keepCapturing = false; // End capture session after using photo
                    return true;
                  }
                },
                {
                  text: 'Take Another Photo',
                  role: 'another',
                  cssClass: 'alert-button-primary',
                  handler: () => {
                    console.log('➕ User chose to take another photo');
                    URL.revokeObjectURL(objectUrl);
                    retakePhoto = false;
                    keepCapturing = true; // Continue capture session
                    return true;
                  }
                }
              ],
              backdropDismiss: false
            });
            
            await alert.present();
            const { role } = await alert.onDidDismiss();
            
            // Process based on user choice
            if (role === 'retake') {
              // Continue the retake loop
              currentFile = null;
            } else if (role === 'use' || role === 'another') {
              // Save the photo
              photoCounter++;
              capturedPhotos.push(currentFile);
              console.log(`📸 Photo ${photoCounter} accepted: ${currentFile.name}`);
              
              // Upload this photo immediately in background
              console.log(`📤 Uploading photo ${photoCounter} in background...`);
              this.uploadPhotoForVisual(visualId, currentFile, key, true)
                .then(() => {
                  console.log(`✅ Photo ${photoCounter} uploaded successfully`);
                  this.showToast(`Photo ${photoCounter} uploaded`, 'success');
                })
                .catch(err => {
                  console.error(`❌ Failed to upload photo ${photoCounter}:`, err);
                  this.showToast(`Failed to upload photo ${photoCounter}`, 'danger');
                });
              
              retakePhoto = false;
              
              if (role === 'use') {
                keepCapturing = false;
              }
            }
          } else {
            // User cancelled camera
            console.log('❌ Camera cancelled by user');
            retakePhoto = false;
            keepCapturing = false;
          }
        } catch (error) {
          console.error('❌ Error capturing photo:', error);
          await this.showToast('Failed to capture photo', 'danger');
          retakePhoto = false;
          keepCapturing = false;
        }
      }
    }
    
    // Final summary
    if (capturedPhotos.length > 0) {
      console.log(`✅ Capture session complete. ${capturedPhotos.length} photo(s) being uploaded`);
      // Don't show another toast here as we already show individual upload toasts
    } else {
      console.log('📷 No photos captured in this session');
    }
  }
  
  // Camera button handler - allows multiple photo capture
  async takePhotoForVisual(category: string, itemId: string, event?: Event) {
    console.log('📸 Camera button clicked!', { category, itemId });
    
    // Prevent event bubbling
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    const key = `${category}_${itemId}`;
    let visualId = this.visualRecordIds[key];
    
    if (!visualId) {
      console.error('❌ No Visual ID found for:', key);
      await this.showToast('Please save the visual first by checking the box', 'warning');
      return;
    }
    
    // Check if it's a temp ID
    if (visualId.startsWith('temp_')) {
      console.log('⏳ Visual has temp ID, refreshing...');
      await this.refreshVisualId(category, itemId);
      const updatedId = this.visualRecordIds[key];
      if (updatedId && !updatedId.startsWith('temp_')) {
        visualId = updatedId;
      } else {
        await this.showToast('Please wait for visual to finish saving', 'warning');
        return;
      }
    }
    
    // Start multiple photo capture session
    await this.startMultiPhotoCapture(visualId, key, category, itemId);
    return; // Skip the old single-photo logic below
    
    // DETAILED DEBUGGING
    console.log('🔍 DEBUGGING FILE INPUT:');
    console.log('1. this.fileInput exists?', !!this.fileInput);
    console.log('2. this.fileInput object:', this.fileInput);
    
    if (this.fileInput) {
      console.log('3. nativeElement exists?', !!this.fileInput.nativeElement);
      console.log('4. nativeElement:', this.fileInput.nativeElement);
      
      if (this.fileInput.nativeElement) {
        console.log('5. Element type:', this.fileInput.nativeElement.tagName);
        console.log('6. Element id:', this.fileInput.nativeElement.id);
        console.log('7. Element display:', window.getComputedStyle(this.fileInput.nativeElement).display);
        
        // Try to find the element directly in DOM
        const directElement = document.querySelector('input[type="file"]');
        console.log('8. Direct DOM query found:', !!directElement);
        
        if (directElement) {
          console.log('9. Using direct element instead');
          this.currentUploadContext = { visualId, key, category, itemId };
          (directElement as HTMLInputElement).click();
          console.log('10. Clicked direct element');
        } else {
          // Try original way
          this.currentUploadContext = { visualId, key, category, itemId };
          this.fileInput.nativeElement.click();
          console.log('11. Clicked via ViewChild');
        }
      } else {
        console.error('❌ nativeElement is null/undefined');
        await this.showToast('File input not available', 'danger');
      }
    } else {
      console.error('❌ fileInput ViewChild is null/undefined');
      await this.showToast('Camera not initialized', 'danger');
    }
  }
  
  // Handle file selection from the hidden input (supports multiple files)
  async handleFileSelect(event: any) {
    const files = event.target.files;
    if (!files || files.length === 0 || !this.currentUploadContext) return;
    
    const { category, itemId, item } = this.currentUploadContext;
    
    // Show non-blocking toast instead of loading modal
    const uploadMessage = files.length > 1 
      ? `Uploading ${files.length} photos in background...` 
      : 'Uploading photo in background...';
    await this.showToast(uploadMessage, 'primary');
    
    try {
      console.log(`📸 ${files.length} file(s) selected`);
      
      // Get or create visual ID
      const key = `${category}_${itemId}`;
      let visualId = this.visualRecordIds[key];
      
      // Track that we're uploading for this visual
      this.uploadingPhotos[key] = (this.uploadingPhotos[key] || 0) + files.length;
      
      if (!visualId) {
        // Need to save the visual first
        await this.saveVisualSelection(category, itemId);
        visualId = this.visualRecordIds[key];
      }
      
      if (visualId) {
        // Convert FileList to File array properly
        const fileArray: File[] = [];
        for (let i = 0; i < files.length; i++) {
          fileArray.push(files[i]);
        }
        
        // Track upload results
        let uploadSuccessCount = 0;
        
        // Upload all photos directly without annotation popup
        const uploadPromises = fileArray.map((file, index) => 
          this.uploadPhotoForVisual(visualId, file, key, true)
            .then(() => {
              console.log(`✅ File ${index + 1} uploaded successfully`);
              return { success: true, error: null };
            })
            .catch((error) => {
              console.error(`❌ Failed to upload file ${index + 1}:`, error);
              return { success: false, error };
            })
        );
        
        // Wait for all uploads to complete
        const results = await Promise.all(uploadPromises);
        
        // Count successes and failures
        uploadSuccessCount = results.filter((r: { success: boolean }) => r.success).length;
        const failCount = results.filter((r: { success: boolean }) => !r.success).length;
        
        // Show result message
        if (failCount === 0) {
          await this.showToast(
          files.length > 1 
            ? `Successfully uploaded ${uploadSuccessCount} photos` 
            : 'Photo uploaded successfully',
            'success'
          );
        } else if (uploadSuccessCount > 0) {
          await this.showToast(
            `Uploaded ${uploadSuccessCount} of ${files.length} photos. ${failCount} failed.`,
            'warning'
          );
        } else {
          await this.showToast('Failed to upload photos', 'danger');
        }
        
        // No need to restore states - the UI should remain unchanged
        
        // Photos are already added with proper previews during upload
        // Removed change detection to improve performance
        
        // Clear upload tracking
        this.uploadingPhotos[key] = Math.max(0, (this.uploadingPhotos[key] || 0) - files.length);
        if (this.uploadingPhotos[key] === 0) {
          delete this.uploadingPhotos[key];
        }
        
        // Removed change detection to improve performance
      }
    } catch (error) {
      console.error('❌ Error handling files:', error);
      await this.showToast('Failed to upload files', 'danger');
    } finally {
      // Reset file input
      if (this.fileInput && this.fileInput.nativeElement) {
        this.fileInput.nativeElement.value = '';
      }
      this.currentUploadContext = null;
    }
  }
  
  // DEPRECATED - Keeping for reference
  private async capturePhoto(visualId: string, key: string) {
    try {
      console.log('📸 Opening camera for visual:', visualId);
      
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'camera' as any; // Force camera
      
      const fileSelected = new Promise<File | null>((resolve) => {
        input.onchange = (event: any) => {
          const file = event.target?.files?.[0];
          resolve(file || null);
        };
      });
      
      input.click();
      
      const file = await fileSelected;
      if (file) {
        console.log('📸 Photo captured:', file.name);
        await this.uploadPhotoForVisual(visualId, file, key);
      }
    } catch (error) {
      console.error('❌ Error capturing photo:', error);
      await this.showToast('Failed to capture photo', 'danger');
    }
  }
  
  // Select from gallery
  private async selectFromGallery(visualId: string, key: string) {
    try {
      console.log('🖼️ Opening gallery for visual:', visualId);
      
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      // No capture attribute for gallery
      
      const fileSelected = new Promise<File | null>((resolve) => {
        input.onchange = (event: any) => {
          const file = event.target?.files?.[0];
          resolve(file || null);
        };
      });
      
      input.click();
      
      const file = await fileSelected;
      if (file) {
        console.log('🖼️ Image selected:', file.name);
        await this.uploadPhotoForVisual(visualId, file, key);
      }
    } catch (error) {
      console.error('❌ Error selecting from gallery:', error);
      await this.showToast('Failed to select image', 'danger');
    }
  }
  
  // Select document
  private async selectDocument(visualId: string, key: string) {
    try {
      console.log('📄 Opening document picker for visual:', visualId);
      
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg';
      
      const fileSelected = new Promise<File | null>((resolve) => {
        input.onchange = (event: any) => {
          const file = event.target?.files?.[0];
          resolve(file || null);
        };
      });
      
      input.click();
      
      const file = await fileSelected;
      if (file) {
        console.log('📄 Document selected:', file.name);
        await this.uploadPhotoForVisual(visualId, file, key);
      }
    } catch (error) {
      console.error('❌ Error selecting document:', error);
      await this.showToast('Failed to select document', 'danger');
    }
  }
  
  // Annotate photo before upload
  async annotatePhoto(photo: File): Promise<File> {
    const modal = await this.modalController.create({
      component: PhotoAnnotatorComponent,
      componentProps: {
        imageFile: photo
      },
      cssClass: 'fullscreen-modal'
    });
    
    await modal.present();
    const { data } = await modal.onDidDismiss();
    
    if (data && data instanceof Blob) {
      // Convert blob to File with same name
      return new File([data], photo.name, { type: 'image/jpeg' });
    }
    
    // Return original photo if annotation was cancelled
    return photo;
  }
  
  // Upload photo to Service_Visuals_Attach - EXACT same approach as working Attach table
  async uploadPhotoForVisual(visualId: string, photo: File, key: string, isBatchUpload: boolean = false) {
    // Extract category from key (format: category_itemId)
    const category = key.split('_')[0];
    
    // Ensure the accordion for this category stays expanded
    if (!this.expandedAccordions.includes(category)) {
      this.expandedAccordions.push(category);
      if (this.visualAccordionGroup) {
        this.visualAccordionGroup.value = this.expandedAccordions;
      }
    }
    
    // Use the ID from visualRecordIds to ensure consistency
    const actualVisualId = this.visualRecordIds[key] || visualId;
    
    // INSTANTLY show preview with object URL
    if (actualVisualId && actualVisualId !== 'undefined') {
      if (!this.visualPhotos[actualVisualId]) {
        this.visualPhotos[actualVisualId] = [];
      }
      
      // Create instant preview
      const objectUrl = URL.createObjectURL(photo);
      const tempId = `temp_${Date.now()}_${Math.random()}`;
      const photoData: any = {
        AttachID: tempId,
        id: tempId,
        name: photo.name,
        url: objectUrl,
        thumbnailUrl: objectUrl,
        isObjectUrl: true,
        uploading: true // Flag to show it's uploading
      };
      
      // Add immediately for instant feedback
      this.visualPhotos[actualVisualId].push(photoData);
    }
    
    // Now do the actual upload in background
    try {
      // Parse visualId to number as required by the service
      const visualIdNum = parseInt(actualVisualId, 10);
      
      if (isNaN(visualIdNum)) {
        throw new Error(`Invalid VisualID: ${actualVisualId}`);
      }
      
      // Prepare debug information
      const allVisualIds = Object.entries(this.visualRecordIds)
        .map(([k, v]) => `${k}: ${v}`)
        .join('<br>');
      
      // Prepare the data that will be sent
      const dataToSend = {
        table: 'Services_Visuals_Attach',
        fields: {
          VisualID: visualIdNum,
          Annotation: '', // Annotation is blank as requested
          Photo: `[File: ${photo.name}]`
        },
        fileInfo: {
          name: photo.name,
          size: `${(photo.size / 1024).toFixed(2)} KB`,
          type: photo.type || 'unknown'
        },
        process: [
          '1. Upload file to Files API',
          '2. Create record with VisualID and Annotation (without Photo)',
          '3. Update record with Photo field containing file path'
        ],
        debug: {
          key: key,
          rawVisualId: visualId,
          actualVisualId: actualVisualId,
          parsedNumber: visualIdNum,
          storedForKey: this.visualRecordIds[key],
          allStoredIds: allVisualIds
        }
      };
      
      // Show popup with data to be sent (skip for batch uploads)
      if (!isBatchUpload) {
        const alert = await this.alertController.create({
          header: 'Services_Visuals_Attach Upload Debug',
        message: `
          <div style="text-align: left; font-family: monospace; font-size: 12px;">
            <strong style="color: red;">🔍 DEBUG INFO:</strong><br>
            • Key: ${dataToSend.debug.key}<br>
            • Raw VisualID param: ${dataToSend.debug.rawVisualId}<br>
            • Stored for this key: ${dataToSend.debug.storedForKey}<br>
            • Using VisualID: <strong style="color: blue;">${dataToSend.debug.actualVisualId}</strong><br>
            • Parsed Number: <strong style="color: blue;">${dataToSend.debug.parsedNumber}</strong><br><br>
            
            <strong>All Stored Visual IDs:</strong><br>
            <div style="max-height: 100px; overflow-y: auto; background: #f0f0f0; padding: 5px;">
              ${dataToSend.debug.allStoredIds || 'None'}
            </div><br>
            
            <strong>Table:</strong> ${dataToSend.table}<br><br>
            
            <strong>Fields to Send:</strong><br>
            • VisualID: <strong style="color: red;">${dataToSend.fields.VisualID}</strong> (Integer)<br>
            • Annotation: "${dataToSend.fields.Annotation}" (Text)<br>
            • Photo: Will store file path after upload<br><br>
            
            <strong>File Info:</strong><br>
            • Name: ${dataToSend.fileInfo.name}<br>
            • Size: ${dataToSend.fileInfo.size}<br>
            • Type: ${dataToSend.fileInfo.type}<br><br>
            
            <strong>Upload Process:</strong><br>
            ${dataToSend.process.map(step => `• ${step}`).join('<br>')}
          </div>
        `,
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel'
          },
          {
            text: 'Upload',
            handler: async () => {
              // Proceed with upload
              await this.performVisualPhotoUpload(visualIdNum, photo, key, false);
            }
          }
        ]
      });
      
        await alert.present();
      } else {
        // For batch uploads, proceed directly without popup
        await this.performVisualPhotoUpload(visualIdNum, photo, key, true);
      }
      
    } catch (error) {
      console.error('❌ Failed to prepare upload:', error);
      await this.showToast('Failed to prepare photo upload', 'danger');
    }
  }
  
  // Separate method to perform the actual upload
  private async performVisualPhotoUpload(visualIdNum: number, photo: File, key: string, isBatchUpload: boolean = false) {
    try {
      // Using EXACT same approach as working Required Documents upload
      const response = await this.caspioService.createServicesVisualsAttachWithFile(
        visualIdNum, 
        '', // Annotation blank for now as requested
        photo
      ).toPromise();
      
      console.log('✅ Photo uploaded successfully:', response);
      
      // Update the temporary photo with real data
      const actualVisualId = String(this.visualRecordIds[key]);
      
      if (actualVisualId && actualVisualId !== 'undefined' && this.visualPhotos[actualVisualId]) {
        // Find the temp photo and update it with real data
        const photos = this.visualPhotos[actualVisualId];
        const tempPhotoIndex = photos.findIndex((p: any) => p.uploading === true && p.name === photo.name);
        
        if (tempPhotoIndex !== -1) {
          // Update the temp photo with real data
          photos[tempPhotoIndex] = {
            ...photos[tempPhotoIndex],
            AttachID: response?.AttachID || response?.PK_ID || response?.id,
            id: response?.AttachID || response?.PK_ID || response?.id,
            Photo: response?.Photo || '',
            filePath: response?.Photo || '',
            uploading: false // Remove uploading flag
            // Keep the object URL for preview
          };
        }
      }
      
      // No need to restore states - the UI should remain unchanged
      
    } catch (error) {
      console.error('❌ Failed to upload photo:', error);
      
      // Remove the failed temp photo from display
      const actualVisualId = String(this.visualRecordIds[key]);
      if (actualVisualId && this.visualPhotos[actualVisualId]) {
        const photos = this.visualPhotos[actualVisualId];
        const tempPhotoIndex = photos.findIndex((p: any) => p.uploading === true && p.name === photo.name);
        if (tempPhotoIndex !== -1) {
          photos.splice(tempPhotoIndex, 1);
        }
      }
      
      if (!isBatchUpload) {
        await this.showToast('Failed to upload photo', 'danger');
      } else {
        throw error; // Re-throw for batch handler to catch
      }
    }
  }
  
  // Get photo count for a visual
  getPhotoCount(category: string, itemId: string): number {
    const key = `${category}_${itemId}`;
    const visualId = String(this.visualRecordIds[key]); // Ensure string
    const count = visualId && visualId !== 'undefined' && this.visualPhotos[visualId] ? this.visualPhotos[visualId].length : 0;
    
    // Removed console logging for performance
    
    return count;
  }
  
  // Check if photos are currently uploading for a visual
  isUploadingPhotos(category: string, itemId: string): boolean {
    const key = `${category}_${itemId}`;
    return (this.uploadingPhotos[key] || 0) > 0;
  }
  
  // Get number of photos being uploaded
  getUploadingCount(category: string, itemId: string): number {
    const key = `${category}_${itemId}`;
    return this.uploadingPhotos[key] || 0;
  }
  
  // Get photos for a visual
  getPhotosForVisual(category: string, itemId: string): any[] {
    const key = `${category}_${itemId}`;
    const visualId = String(this.visualRecordIds[key]); // Ensure string
    const photos = visualId && visualId !== 'undefined' && this.visualPhotos[visualId] ? this.visualPhotos[visualId] : [];
    
    // Removed console logging for performance
    
    return photos;
  }
  
  // Handle image loading errors
  handleImageError(event: any, photo: any) {
    console.log('⚠️ Image failed to load:', photo.name, photo.filePath);
    // Replace with a simple inline SVG as fallback
    const target = event.target as HTMLImageElement;
    target.src = 'data:image/svg+xml;base64,' + btoa(`
      <svg width="150" height="100" xmlns="http://www.w3.org/2000/svg">
        <rect width="150" height="100" fill="#f0f0f0"/>
        <text x="75" y="45" text-anchor="middle" fill="#999" font-family="Arial" font-size="14">📷</text>
        <text x="75" y="65" text-anchor="middle" fill="#999" font-family="Arial" font-size="11">Photo</text>
      </svg>
    `);
  }
  
  // Add custom visual comment
  async addCustomVisual(category: string, kind: string) {
    const alert = await this.alertController.create({
      header: `Add ${kind}`,
      inputs: [
        {
          name: 'name',
          type: 'text',
          placeholder: 'Enter title/name',
          attributes: {
            required: true
          }
        },
        {
          name: 'description',
          type: 'textarea',
          placeholder: 'Enter description (optional)',
          attributes: {
            rows: 4
          }
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Add',
          handler: async (data) => {
            if (!data.name || !data.name.trim()) {
              await this.showToast('Please enter a name', 'warning');
              return false;
            }
            
            // Create the visual without photos initially
            await this.createCustomVisualWithPhotos(category, kind, data.name, data.description || '', null);
            
            return true;
          }
        }
      ]
    });
    
    await alert.present();
  }
  
  // Create custom visual with photos
  async createCustomVisualWithPhotos(category: string, kind: string, name: string, text: string, files: FileList | null) {
    try {
      const serviceId = this.serviceId;
      if (!serviceId) {
        await this.showToast('Service ID not found', 'danger');
        return;
      }
      
      const serviceIdNum = parseInt(serviceId, 10);
      if (isNaN(serviceIdNum)) {
        await this.showToast('Invalid Service ID', 'danger');
        return;
      }
      
      const visualData: ServicesVisualRecord = {
        ServiceID: serviceIdNum,
        Category: category,
        Kind: kind,
        Name: name,
        Text: text,
        Notes: ''
      };
      
      const loading = await this.loadingController.create({
        message: 'Creating visual...'
      });
      await loading.present();
      
      try {
        // Create the visual record
        const response = await this.caspioService.createServicesVisual(visualData).toPromise();
        console.log('✅ Custom visual created:', response);
        
        // Use VisualID from response
        const visualId = response?.VisualID || response?.PK_ID;
        if (!visualId) {
          throw new Error('No VisualID returned from server');
        }
        
        // Add to local data structure
        if (!this.organizedData[category]) {
          this.organizedData[category] = {
            comments: [],
            limitations: [],
            deficiencies: []
          };
        }
        
        const customItem = {
          id: visualId.toString(),
          name: name,
          text: text,
          isCustom: true
        };
        
        // Add to appropriate array
        const kindKey = kind.toLowerCase() + 's';
        if (kindKey === 'comments') {
          this.organizedData[category].comments.push(customItem);
        } else if (kindKey === 'limitations') {
          this.organizedData[category].limitations.push(customItem);
        } else if (kindKey === 'deficiencys' || kindKey === 'deficiencies') {
          this.organizedData[category].deficiencies.push(customItem);
        }
        
        // Store the visual ID for photo uploads
        const key = `${category}_${customItem.id}`;
        this.visualRecordIds[key] = String(visualId);
        
        // Mark as selected
        this.selectedItems[key] = true;
        
        // Update categoryData
        if (!this.categoryData[category]) {
          this.categoryData[category] = {};
        }
        this.categoryData[category][customItem.id] = {
          selected: true,
          ...customItem
        };
        
        await loading.dismiss();
        
        // Upload photos if provided
        if (files && files.length > 0) {
          const uploadLoading = await this.loadingController.create({
            message: `Uploading ${files.length} file(s)...`
          });
          await uploadLoading.present();
          
          let successCount = 0;
          let failCount = 0;
          
          // Upload each file
          for (let i = 0; i < files.length; i++) {
            try {
              await this.uploadPhotoForVisual(String(visualId), files[i], key, true);
              successCount++;
            } catch (error) {
              console.error(`Failed to upload file ${i + 1}:`, error);
              failCount++;
            }
          }
          
          await uploadLoading.dismiss();
          
          // Show result
          if (failCount === 0) {
            await this.showToast(`Visual created with ${successCount} file(s)`, 'success');
          } else if (successCount > 0) {
            await this.showToast(`Visual created. ${successCount} file(s) uploaded, ${failCount} failed`, 'warning');
          } else {
            await this.showToast('Visual created but file uploads failed', 'warning');
          }
        } else {
          await this.showToast('Visual added successfully', 'success');
        }
        
        // Trigger change detection
        this.changeDetectorRef.detectChanges();
        
      } catch (error) {
        console.error('Error creating custom visual:', error);
        await loading.dismiss();
        await this.showToast('Failed to add visual', 'danger');
      }
    } catch (error) {
      console.error('Error in createCustomVisualWithPhotos:', error);
    }
  }
  
  // Create custom visual in database (original method kept for backward compatibility)
  async createCustomVisual(category: string, kind: string, name: string, text: string) {
    try {
      const serviceId = this.serviceId;
      if (!serviceId) {
        await this.showToast('Service ID not found', 'danger');
        return;
      }
      
      const serviceIdNum = parseInt(serviceId, 10);
      if (isNaN(serviceIdNum)) {
        await this.showToast('Invalid Service ID', 'danger');
        return;
      }
      
      const visualData: ServicesVisualRecord = {
        ServiceID: serviceIdNum,
        Category: category,
        Kind: kind,
        Name: name,
        Text: text,
        Notes: ''
      };
      
      const loading = await this.loadingController.create({
        message: 'Adding visual...'
      });
      await loading.present();
      
      try {
        const response = await this.caspioService.createServicesVisual(visualData).toPromise();
        console.log('✅ Custom visual created:', response);
        
        // Show debug popup with the response
        const debugAlert = await this.alertController.create({
          header: 'Custom Visual Creation Response',
          message: `
            <div style="text-align: left; font-family: monospace; font-size: 12px;">
              <strong style="color: green;">✅ VISUAL CREATED SUCCESSFULLY</strong><br><br>
              
              <strong>Response from Caspio:</strong><br>
              <div style="background: #f0f0f0; padding: 10px; border-radius: 5px; max-height: 200px; overflow-y: auto;">
                ${JSON.stringify(response, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
              </div><br>
              
              <strong style="color: blue;">Key Fields:</strong><br>
              • VisualID (PRIMARY): <strong style="color: green;">${response?.VisualID || 'NOT FOUND'}</strong><br>
              • PK_ID: ${response?.PK_ID || 'N/A'}<br>
              • ServiceID: ${response?.ServiceID || 'N/A'}<br>
              • Category: ${response?.Category || 'N/A'}<br>
              • Kind: ${response?.Kind || 'N/A'}<br>
              • Name: ${response?.Name || 'N/A'}<br><br>
              
              <strong>Will be stored as:</strong><br>
              • Key: ${category}_${response?.VisualID || response?.PK_ID || Date.now()}<br>
              • VisualID for photos: <strong style="color: green;">${response?.VisualID || response?.PK_ID || 'MISSING!'}</strong>
            </div>
          `,
          cssClass: 'debug-alert-wide',
          buttons: ['OK']
        });
        await debugAlert.present();
        
        // Add to local data structure
        if (!this.organizedData[category]) {
          this.organizedData[category] = {
            comments: [],
            limitations: [],
            deficiencies: []
          };
        }
        
        // Determine which array to add to based on kind
        const kindKey = kind.toLowerCase() + 's'; // comments, limitations, deficiencies
        
        // Use VisualID from response, NOT PK_ID
        const visualId = response?.VisualID || response?.PK_ID || Date.now().toString();
        const customItem = {
          id: visualId.toString(), // Convert to string for consistency
          name: name,
          text: text,
          isCustom: true
        };
        
        if (kindKey === 'comments') {
          this.organizedData[category].comments.push(customItem);
        } else if (kindKey === 'limitations') {
          this.organizedData[category].limitations.push(customItem);
        } else if (kindKey === 'deficiencys' || kindKey === 'deficiencies') {
          this.organizedData[category].deficiencies.push(customItem);
        }
        
        // Store the visual ID for photo uploads - use VisualID from response!
        const key = `${category}_${customItem.id}`;
        this.visualRecordIds[key] = String(response?.VisualID || response?.PK_ID || customItem.id);
        console.log('📌 Stored VisualID for photos:', {
          key: key,
          visualId: this.visualRecordIds[key],
          responseVisualID: response?.VisualID,
          responsePK_ID: response?.PK_ID
        });
        
        // Mark as selected (use selectedItems, not selectedVisuals)
        this.selectedItems[key] = true;
        
        // Also update categoryData for consistency
        if (!this.categoryData[category]) {
          this.categoryData[category] = {};
        }
        this.categoryData[category][customItem.id] = {
          selected: true,
          ...customItem
        };
        
        await loading.dismiss();
        await this.showToast('Visual added successfully', 'success');
        
        // Trigger change detection
        this.changeDetectorRef.detectChanges();
        
      } catch (error) {
        console.error('Error creating custom visual:', error);
        await loading.dismiss();
        await this.showToast('Failed to add visual', 'danger');
      }
    } catch (error) {
      console.error('Error in createCustomVisual:', error);
    }
  }
  
  // Update existing photo attachment
  async updatePhotoAttachment(attachId: string, file: File): Promise<void> {
    try {
      console.log('🔍 updatePhotoAttachment called with:');
      console.log('  attachId:', attachId);
      console.log('  attachId type:', typeof attachId);
      console.log('  file:', file.name);
      
      // Debug popup - show what we're about to do
      const debugAlert1 = await this.alertController.create({
        header: 'Photo Update Debug - Step 1',
        message: `
          <div style="text-align: left; font-family: monospace; font-size: 12px;">
            <strong style="color: blue;">📤 ATTEMPTING TO UPDATE PHOTO</strong><br><br>
            
            <strong>Attachment ID:</strong> ${attachId}<br>
            <strong>Attachment ID Type:</strong> ${typeof attachId}<br>
            <strong>Attachment ID Length:</strong> ${attachId?.length || 0}<br>
            <strong>File Name:</strong> ${file.name}<br>
            <strong>File Size:</strong> ${(file.size / 1024).toFixed(2)} KB<br>
            <strong>File Type:</strong> ${file.type}<br><br>
            
            <strong>Process:</strong><br>
            1. Upload new file to Files API<br>
            2. Update Services_Visuals_Attach record<br>
            3. Replace Photo field with new path<br><br>
            
            <strong style="color: orange;">Next: Uploading file to Caspio Files API...</strong>
          </div>
        `,
        buttons: ['Continue']
      });
      await debugAlert1.present();
      await debugAlert1.onDidDismiss();
      
      // First upload the new file
      let uploadResult: any;
      try {
        console.log('🔄 Attempting file upload...');
        uploadResult = await this.caspioService.uploadFile(file).toPromise();
        console.log('✅ Upload result:', uploadResult);
        
        // Debug popup - show upload result
        const debugAlert2 = await this.alertController.create({
          header: 'Photo Update Debug - Step 2',
          message: `
            <div style="text-align: left; font-family: monospace; font-size: 12px;">
              <strong style="color: green;">✅ FILE UPLOADED SUCCESSFULLY</strong><br><br>
              
              <strong>Upload Result:</strong><br>
              <div style="background: #f0f0f0; padding: 10px; border-radius: 5px; max-height: 300px; overflow-y: auto;">
                ${JSON.stringify(uploadResult, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
              </div><br>
              
              <strong>File Name from API:</strong> ${uploadResult?.Name || 'NOT FOUND'}<br>
              <strong>Alternative names checked:</strong><br>
              • result.Name: ${uploadResult?.Name || 'undefined'}<br>
              • result.name: ${uploadResult?.name || 'undefined'}<br>
              • result.FileName: ${uploadResult?.FileName || 'undefined'}<br>
              • result.fileName: ${uploadResult?.fileName || 'undefined'}<br><br>
              
              <strong>File Path to Store:</strong> /${uploadResult?.Name || 'unknown'}<br><br>
              
              <strong style="color: orange;">Next: Updating attachment record...</strong>
            </div>
          `,
          buttons: ['Continue']
        });
        await debugAlert2.present();
        await debugAlert2.onDidDismiss();
        
      } catch (uploadError: any) {
        console.error('❌ File upload failed:', uploadError);
        
        // Show detailed error popup
        const errorAlert = await this.alertController.create({
          header: 'Photo Update Debug - Upload Error',
          message: `
            <div style="text-align: left; font-family: monospace; font-size: 12px;">
              <strong style="color: red;">❌ FILE UPLOAD FAILED</strong><br><br>
              
              <strong>Error Message:</strong> ${uploadError?.message || 'Unknown error'}<br><br>
              
              <strong>Error Details:</strong><br>
              <div style="background: #ffe0e0; padding: 10px; border-radius: 5px; max-height: 200px; overflow-y: auto;">
                ${JSON.stringify(uploadError, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
              </div><br>
              
              <strong>File attempted:</strong> ${file.name}<br>
              <strong>File size:</strong> ${(file.size / 1024).toFixed(2)} KB<br>
              <strong>File type:</strong> ${file.type}<br><br>
              
              <strong style="color: orange;">Check console for more details</strong>
            </div>
          `,
          buttons: ['OK']
        });
        await errorAlert.present();
        throw uploadError;
      }
      
      if (!uploadResult || !uploadResult.Name) {
        throw new Error('File upload failed - no Name returned');
      }
      
      // Update the attachment record with new file path
      const updateData = {
        Photo: `/${uploadResult.Name}`
      };
      
      // Debug popup - show update request
      const debugAlert3 = await this.alertController.create({
        header: 'Photo Update Debug - Step 3',
        message: `
          <div style="text-align: left; font-family: monospace; font-size: 12px;">
            <strong style="color: blue;">📝 UPDATING ATTACHMENT RECORD</strong><br><br>
            
            <strong>Table:</strong> Services_Visuals_Attach<br>
            <strong>Where:</strong> AttachID = ${attachId}<br><br>
            
            <strong>Update Data:</strong><br>
            <div style="background: #f0f0f0; padding: 10px; border-radius: 5px;">
              ${JSON.stringify(updateData, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
            </div><br>
            
            <strong>API Endpoint:</strong><br>
            PUT /tables/Services_Visuals_Attach/records?q.where=AttachID=${attachId}<br><br>
            
            <strong style="color: orange;">Sending update request...</strong>
          </div>
        `,
        buttons: ['Send Update']
      });
      await debugAlert3.present();
      await debugAlert3.onDidDismiss();
      
      const updateResult = await this.caspioService.updateServiceVisualsAttach(attachId, updateData).toPromise();
      
      // Debug popup - show update result
      const debugAlert4 = await this.alertController.create({
        header: 'Photo Update Debug - Complete',
        message: `
          <div style="text-align: left; font-family: monospace; font-size: 12px;">
            <strong style="color: green;">✅ UPDATE COMPLETE</strong><br><br>
            
            <strong>Update Response:</strong><br>
            <div style="background: #f0f0f0; padding: 10px; border-radius: 5px; max-height: 200px; overflow-y: auto;">
              ${JSON.stringify(updateResult, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
            </div><br>
            
            <strong>Photo attachment updated successfully!</strong>
          </div>
        `,
        buttons: ['OK']
      });
      await debugAlert4.present();
      
      console.log('✅ Photo attachment updated successfully');
    } catch (error: any) {
      console.error('❌ Failed to update photo attachment:', error);
      
      // Debug popup - show error
      const errorAlert = await this.alertController.create({
        header: 'Photo Update Error',
        message: `
          <div style="text-align: left; font-family: monospace; font-size: 12px;">
            <strong style="color: red;">❌ UPDATE FAILED</strong><br><br>
            
            <strong>Error Message:</strong><br>
            ${error?.message || 'Unknown error'}<br><br>
            
            <strong>Error Details:</strong><br>
            <div style="background: #ffe0e0; padding: 10px; border-radius: 5px; max-height: 200px; overflow-y: auto;">
              ${JSON.stringify(error, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
            </div><br>
            
            <strong>Attachment ID:</strong> ${attachId}<br>
            <strong>File Name:</strong> ${file?.name || 'N/A'}<br>
          </div>
        `,
        buttons: ['OK']
      });
      await errorAlert.present();
      
      throw error;
    }
  }
  
  // View photo - open viewer with integrated annotation
  async viewPhoto(photo: any, category: string, itemId: string) {
    try {
      console.log('👁️ Viewing photo:', photo);
      
      const imageUrl = photo.url || photo.thumbnailUrl || 'assets/img/photo-placeholder.png';
      const photoName = photo.name || 'Photo';
      const key = `${category}_${itemId}`;
      const visualId = this.visualRecordIds[key];
      
      // Open enhanced photo viewer with annotation option
      const modal = await this.modalController.create({
        component: PhotoViewerComponent,
        componentProps: {
          photoUrl: imageUrl,
          photoName: photoName,
          photoCaption: photo.caption || '',
          canAnnotate: true,
          visualId: visualId,
          categoryKey: key,
          photoData: photo  // Pass the photo object for update
        },
        cssClass: 'photo-viewer-modal'
      });
      
      await modal.present();
      
      // Handle annotated photo or updated caption if returned
      const { data } = await modal.onDidDismiss();
      
      if (data && data.updatedCaption !== undefined) {
        // Caption was updated
        photo.caption = data.updatedCaption;
        await this.saveCaption(photo, category, itemId);
        this.changeDetectorRef.detectChanges();
      } else if (data && data.annotatedBlob) {
        // Update the existing photo instead of creating new
        const annotatedFile = new File([data.annotatedBlob], photoName, { type: 'image/jpeg' });
        
        if (photo.AttachID || photo.id) {
          // Removed loading screen to allow debug popups to be visible
          
          try {
            // Update the existing attachment
            await this.updatePhotoAttachment(photo.AttachID || photo.id, annotatedFile);
            
            // Update the local photo data
            const photoIndex = this.visualPhotos[visualId]?.findIndex(
              (p: any) => (p.AttachID || p.id) === (photo.AttachID || photo.id)
            );
            
            if (photoIndex !== -1 && this.visualPhotos[visualId]) {
              // Update the photo URL with the new blob
              const newUrl = URL.createObjectURL(data.annotatedBlob);
              this.visualPhotos[visualId][photoIndex].url = newUrl;
              this.visualPhotos[visualId][photoIndex].thumbnailUrl = newUrl;
            }
            
            await this.showToast('Photo updated successfully', 'success');
            
            // Trigger change detection
            this.changeDetectorRef.detectChanges();
          } catch (error) {
            await this.showToast('Failed to update photo', 'danger');
          }
        }
      }
      
    } catch (error) {
      console.error('Error viewing photo:', error);
      await this.showToast('Failed to view photo', 'danger');
    }
  }
  
  // Delete existing photo
  async deletePhoto(photo: any, category: string, itemId: string) {
    try {
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
            handler: () => {
              // Return false to prevent auto-dismiss, dismiss manually after delete
              // This prevents the handler from blocking the alert dismissal
              setTimeout(async () => {
                const loading = await this.loadingController.create({
                  message: 'Deleting photo...'
                });
                await loading.present();
                
                try {
                  const attachId = photo.AttachID || photo.id;
                  await this.caspioService.deleteServiceVisualsAttach(attachId).toPromise();
                  
                  // Remove from local array
                  const visualId = this.visualRecordIds[`${category}_${itemId}`];
                  if (visualId && this.visualPhotos[visualId]) {
                    this.visualPhotos[visualId] = this.visualPhotos[visualId].filter(
                      (p: any) => (p.AttachID || p.id) !== attachId
                    );
                  }
                  
                  await loading.dismiss();
                  await this.showToast('Photo deleted successfully', 'success');
                } catch (error) {
                  await loading.dismiss();
                  console.error('Failed to delete photo:', error);
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
  
  // Add another photo
  async addAnotherPhoto(category: string, itemId: string) {
    this.currentUploadContext = { 
      category, 
      itemId,
      action: 'add'
    };
    this.fileInput.nativeElement.click();
  }
  
  // Save caption to the Annotation field in Services_Visuals_Attach table
  async saveCaption(photo: any, category: string, itemId: string) {
    try {
      // Only save if there's an AttachID and the caption has changed
      if (!photo.AttachID) {
        console.warn('No AttachID for photo, cannot save caption');
        return;
      }

      // Update the Services_Visuals_Attach record with the new caption
      const updateData = {
        Annotation: photo.caption || ''  // Save caption or empty string
      };

      await this.caspioService.updateServicesVisualsAttach(photo.AttachID, updateData).toPromise();
      
      // Show brief toast
      await this.showToast('Caption saved', 'success');
      
    } catch (error) {
      console.error('Error saving caption:', error);
      await this.showToast('Failed to save caption', 'danger');
    }
  }
  
  // Verify if visual was actually saved
  async verifyVisualSaved(category: string, templateId: string): Promise<boolean> {
    try {
      console.log('🔍 Verifying if visual was saved...');
      const visuals = await this.caspioService.getServicesVisualsByServiceId(this.serviceId).toPromise();
      
      if (visuals && Array.isArray(visuals)) {
        const templateName = this.categoryData[category]?.[templateId]?.name;
        const found = visuals.some(v => 
          v.Category === category && 
          v.Name === templateName
        );
        
        if (found) {
          console.log('✅ Visual found in table - it was saved!');
          // Also refresh the ID
          await this.refreshVisualId(category, templateId);
          return true;
        }
      }
      console.log('❌ Visual not found in table');
      return false;
    } catch (error) {
      console.error('Error verifying visual:', error);
      return false;
    }
  }
  
  // Show debug popup for visual creation
  async showVisualCreationDebug(category: string, templateId: string, response: any) {
    const key = `${category}_${templateId}`;
    
    // Extract ID from response
    let extractedId = 'Unknown';
    let responseType = 'Unknown';
    
    let pkId = 'N/A';
    let visualIdFromResponse = 'N/A';
    
    if (response === undefined || response === null || response === '') {
      responseType = 'Empty/Null Response';
      extractedId = 'Will generate temp ID';
    } else if (Array.isArray(response) && response.length > 0) {
      responseType = 'Array Response';
      visualIdFromResponse = response[0].VisualID || 'Not found';
      pkId = response[0].PK_ID || 'Not found';
      extractedId = response[0].VisualID || response[0].PK_ID || response[0].id || 'Not found in array';
    } else if (response && typeof response === 'object') {
      if (response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
        responseType = 'Object with Result array';
        visualIdFromResponse = response.Result[0].VisualID || 'Not found';
        pkId = response.Result[0].PK_ID || 'Not found';
        extractedId = response.Result[0].VisualID || response.Result[0].PK_ID || response.Result[0].id || 'Not found in Result';
      } else {
        responseType = 'Direct Object';
        visualIdFromResponse = response.VisualID || 'Not found';
        pkId = response.PK_ID || 'Not found';
        extractedId = response.VisualID || response.PK_ID || response.id || 'Not found in object';
      }
    } else {
      responseType = 'Direct ID';
      extractedId = response;
    }
    
    // Get all existing visuals for comparison
    let existingVisuals: Array<{id: any, name: string, category: string}> = [];
    try {
      const visuals = await this.caspioService.getServicesVisualsByServiceId(this.serviceId).toPromise();
      if (visuals && Array.isArray(visuals)) {
        existingVisuals = visuals.map(v => ({
          id: v.VisualID || v.PK_ID || v.id,
          name: v.Name,
          category: v.Category
        }));
      }
    } catch (e) {
      console.error('Failed to get existing visuals:', e);
    }
    
    const existingVisualsHtml = existingVisuals
      .map(v => `ID: ${v.id} - ${v.category}/${v.name}`)
      .join('<br>') || 'None found';
    
    const alert = await this.alertController.create({
      header: 'Visual Creation Debug',
      message: `
        <div style="font-family: monospace; font-size: 12px;">
          <strong style="color: red;">🔍 VISUAL CREATION RESPONSE:</strong><br><br>
          
          <strong>Key:</strong> ${key}<br>
          <strong>Category:</strong> ${category}<br>
          <strong>Template ID:</strong> ${templateId}<br><br>
          
          <strong>Response Type:</strong> ${responseType}<br>
          <strong>Raw Response:</strong><br>
          <div style="background: #f0f0f0; padding: 5px; max-height: 150px; overflow-y: auto;">
            ${JSON.stringify(response, null, 2)}
          </div><br>
          
          <strong style="color: red;">⚠️ ID FIELDS FROM RESPONSE:</strong><br>
          • <strong>VisualID:</strong> ${visualIdFromResponse} <span style="color: green;">(✓ CORRECT - USE THIS)</span><br>
          • <strong>PK_ID:</strong> ${pkId} <span style="color: red;">(✗ WRONG - DO NOT USE)</span><br><br>
          
          <strong style="color: blue;">Using ID:</strong> ${extractedId}<br>
          <strong>Will Store As:</strong> ${this.visualRecordIds[key] || 'Not yet stored'}<br><br>
          
          <strong>Existing Visuals in Database:</strong><br>
          <div style="background: #f0f0f0; padding: 5px; max-height: 100px; overflow-y: auto;">
            ${existingVisualsHtml}
          </div><br>
          
          <strong>Current visualRecordIds:</strong><br>
          <div style="background: #f0f0f0; padding: 5px; max-height: 100px; overflow-y: auto;">
            ${Object.entries(this.visualRecordIds).map(([k, v]) => `${k}: ${v}`).join('<br>') || 'None'}
          </div>
        </div>
      `,
      buttons: ['OK']
    });
    
    await alert.present();
  }
  
  // Refresh visual ID after save
  async refreshVisualId(category: string, templateId: string) {
    try {
      console.log('🔄 Refreshing Visual ID for:', category, templateId);
      const visuals = await this.caspioService.getServicesVisualsByServiceId(this.serviceId).toPromise();
      
      console.log('📋 Retrieved visuals from database:', visuals);
      
      if (visuals && Array.isArray(visuals)) {
        // Find the visual we just created
        const templateName = this.categoryData[category]?.[templateId]?.name;
        console.log('🔍 Looking for visual with Category:', category, 'and Name:', templateName);
        
        const ourVisual = visuals.find(v => 
          v.Category === category && 
          v.Name === templateName
        );
        
        if (ourVisual) {
          console.log('✅ Found our visual:', ourVisual);
          const visualId = ourVisual.VisualID || ourVisual.PK_ID || ourVisual.id;
          const recordKey = `visual_${category}_${templateId}`;
          localStorage.setItem(recordKey, String(visualId));
          this.visualRecordIds[`${category}_${templateId}`] = String(visualId);
          console.log('✅ Visual ID refreshed:', visualId, 'for key:', `${category}_${templateId}`);
        } else {
          console.log('⚠️ Could not find visual with Category:', category, 'and Name:', templateName);
          console.log('Available visuals:', visuals.map(v => ({ Category: v.Category, Name: v.Name, ID: v.VisualID || v.PK_ID })));
        }
      }
    } catch (error) {
      console.error('Failed to refresh visual ID:', error);
    }
  }
  
  // Load existing photos for visuals
  async loadExistingPhotos() {
    console.log('🔄 Loading existing photos for all visuals...');
    console.log('Visual IDs to load:', this.visualRecordIds);
    console.log('Current visualPhotos state:', this.visualPhotos);
    
    for (const key in this.visualRecordIds) {
      const rawVisualId = this.visualRecordIds[key];
      const visualId = String(rawVisualId); // Ensure string consistency
      if (visualId && visualId !== 'undefined' && !visualId.startsWith('temp_')) {
        try {
          console.log(`📥 Fetching photos for visual ${visualId} (${key})`);
          const photos = await this.caspioService.getServiceVisualsAttachByVisualId(rawVisualId).toPromise();
          console.log(`Found ${photos?.length || 0} photos for visual ${visualId}:`, photos);
          
          if (photos && photos.length > 0) {
            // Process photos to add preview URLs
            const processedPhotos = await Promise.all(photos.map(async (photo: any) => {
              console.log('Processing photo:', photo);
              const photoData = {
                ...photo,
                name: photo.Photo || 'Photo',
                caption: photo.Annotation || '',  // Load existing caption from Annotation field
                url: '',
                thumbnailUrl: ''
              };
              
              // If we have a Photo field with a file path, try to fetch it
              if (photo.Photo && typeof photo.Photo === 'string') {
                photoData.filePath = photo.Photo;
                photoData.hasPhoto = true;
                
                try {
                  console.log(`🖼️ Fetching image from Files API for: ${photo.Photo}`);
                  const imageData = await this.caspioService.getImageFromFilesAPI(photo.Photo).toPromise();
                  
                  if (imageData && imageData.startsWith('data:')) {
                    console.log('✅ Image data received, valid base64, length:', imageData.length);
                    photoData.url = imageData;
                    photoData.thumbnailUrl = imageData;
                  } else {
                    console.log('⚠️ Invalid image data, using fallback');
                    // Use a simple base64 encoded SVG as fallback
                    photoData.url = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#e0e0e0"/><text x="75" y="50" text-anchor="middle" fill="#666" font-size="14">📷 Photo</text></svg>');
                    photoData.thumbnailUrl = photoData.url;
                  }
                } catch (err) {
                  console.error('❌ Error fetching image:', err);
                  // Use simple SVG fallback
                  photoData.url = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#e0e0e0"/><text x="75" y="50" text-anchor="middle" fill="#666" font-size="14">📷 Photo</text></svg>');
                  photoData.thumbnailUrl = photoData.url;
                }
              } else {
                console.log('⚠️ No Photo field or not a string:', photo.Photo);
                // No photo exists
                photoData.url = '';
                photoData.thumbnailUrl = '';
                photoData.hasPhoto = false;
              }
              
              console.log('Photo data processed:', {
                name: photoData.name,
                hasUrl: !!photoData.url,
                urlLength: photoData.url?.length,
                filePath: photoData.filePath
              });
              
              return photoData;
            }));
            
            // Store photos using the same ID format - ensure string consistency
            this.visualPhotos[visualId] = processedPhotos;
            console.log(`📸 Loaded ${processedPhotos.length} photos for visual ${visualId}, stored in visualPhotos`);
            console.log(`Photos stored at visualPhotos[${visualId}]:`, {
              visualId,
              visualIdType: typeof visualId,
              photos: processedPhotos,
              keyForThisVisual: key
            });
          } else {
            console.log(`No photos found for visual ${visualId}`);
          }
        } catch (error) {
          console.error(`Failed to load photos for visual ${visualId}:`, error);
        }
      }
    }
    
    // Log final state (reduced logging)
    console.log('Photos loaded for', Object.keys(this.visualPhotos).filter(k => this.visualPhotos[k]?.length > 0).length, 'visuals');
  }
  
  // Create a placeholder image
  private createPlaceholderImage(): string {
    const canvas = document.createElement('canvas');
    canvas.width = 150; // Match new preview size
    canvas.height = 100; // Match new preview size
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, 150, 100);
      ctx.fillStyle = '#999';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Photo', 75, 45);
      ctx.fillText('Loading...', 75, 60);
    }
    return canvas.toDataURL();
  }
  
  // Create a generic photo placeholder (for existing photos)
  private createGenericPhotoPlaceholder(): string {
    const canvas = document.createElement('canvas');
    canvas.width = 150;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Light blue background
      ctx.fillStyle = '#e3f2fd';
      ctx.fillRect(0, 0, 150, 100);
      
      // Draw a simple camera icon
      ctx.fillStyle = '#1976d2';
      // Camera body
      ctx.fillRect(55, 40, 40, 30);
      // Camera lens
      ctx.beginPath();
      ctx.arc(75, 55, 8, 0, 2 * Math.PI);
      ctx.fill();
      // Flash
      ctx.fillRect(65, 35, 20, 5);
      
      // Text
      ctx.fillStyle = '#666';
      ctx.font = '11px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Click to view', 75, 85);
    }
    return canvas.toDataURL();
  }

  // Handle project field changes
  onProjectFieldChange(fieldName: string, value: any) {
    console.log(`Project field changed: ${fieldName} = ${value}`);
    
    // Update the project data
    if (this.projectData) {
      this.projectData[fieldName] = value;
    }
    
    // Save to localStorage for persistence across all services
    const projectDataKey = `projectData_${this.projectId}`;
    localStorage.setItem(projectDataKey, JSON.stringify(this.projectData));
    
    // Trigger auto-save to Projects table
    this.autoSaveProjectField(fieldName, value);
  }
  
  // Auto-save project field to Caspio Projects table
  private autoSaveProjectField(fieldName: string, value: any) {
    if (!this.projectId || this.projectId === 'new') return;
    
    this.showSaveStatus(`Saving ${fieldName}...`, 'info');
    
    // Update the Projects table directly
    this.caspioService.updateProject(this.projectId, { [fieldName]: value }).subscribe({
      next: () => {
        this.showSaveStatus(`${fieldName} saved`, 'success');
      },
      error: (error) => {
        console.error(`Error saving project field ${fieldName}:`, error);
        this.showSaveStatus(`Failed to save ${fieldName}`, 'error');
      }
    });
  }

  // Calculate project information completion percentage
  getProjectCompletion(): number {
    if (!this.projectData) return 0;
    
    const requiredFields = [
      'ClientName', 'AgentName', 'InspectorName', 'InAttendance',
      'YearBuilt', 'SquareFeet', 'TypeOfBuilding', 'Style',
      'OccupancyFurnishings', 'WeatherConditions', 'OutdoorTemperature'
    ];
    
    let completed = 0;
    for (const field of requiredFields) {
      if (this.projectData[field] && this.projectData[field].toString().trim() !== '') {
        completed++;
      }
    }
    
    return Math.round((completed / requiredFields.length) * 100);
  }
}