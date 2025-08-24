import { Component, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { CaspioService } from '../../services/caspio.service';
import { ToastController, LoadingController, AlertController, ActionSheetController, ModalController } from '@ionic/angular';

interface ElevationReading {
  location: string;
  value: number | null;
}

interface ServicesVisualRecord {
  ServiceID: number;  // Changed to number to match Integer type in Caspio
  Category: string;
  Type: string;
  Name: string;
  Notes: string;  // Made required, will send empty string if not provided
}

@Component({
  selector: 'app-engineers-foundation',
  templateUrl: './engineers-foundation.page.html',
  styleUrls: ['./engineers-foundation.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class EngineersFoundationPage implements OnInit, AfterViewInit {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  
  projectId: string = '';
  serviceId: string = '';
  projectData: any = null;
  currentUploadContext: any = null;
  
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
  
  // UI state
  expandedSections: { [key: string]: boolean } = {
    project: false,  // Project Details collapsed by default
    structural: false,  // Structural Systems collapsed by default
    elevation: false
  };
  
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
    private modalController: ModalController
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
  
  async loadVisualCategories() {
    try {
      // Get all templates
      const templates = await this.caspioService.getServicesVisualsTemplates().toPromise();
      this.visualTemplates = templates || [];
      
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
            type: template.Type,
            category: template.Category
          };
          
          // Initialize selection state
          this.selectedItems[`${category}_${template.PK_ID}`] = false;
          
          // Sort into appropriate Type section
          const typeStr = String(template.Type).toLowerCase();
          if (typeStr.includes('comment')) {
            this.organizedData[category].comments.push(templateData);
          } else if (typeStr.includes('limitation')) {
            this.organizedData[category].limitations.push(templateData);
          } else if (typeStr.includes('deficienc')) {
            this.organizedData[category].deficiencies.push(templateData);
          } else {
            // Default to comments if type is unclear
            this.organizedData[category].comments.push(templateData);
          }
          
          // Keep old structure for compatibility
          this.categoryData[category][template.PK_ID] = {
            templateId: template.PK_ID,
            name: template.Name,
            text: template.Text,
            type: template.Type,
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
              const visualId = visual.PK_ID || visual.id || visual.VisualID;
              
              // Store in tracking object for photo uploads
              this.visualRecordIds[key] = visualId;
              
              console.log('📌 Stored visual ID:', visualId, 'for key:', key);
              console.log('📋 Updated selectedItems:', this.selectedItems);
            } else {
              console.log('⚠️ No matching template found for:', visual.Name);
            }
          }
        });
      }
      
      console.log('✅ Visual selections restored:', this.selectedItems);
      console.log('📌 Visual record IDs:', this.visualRecordIds);
      
      // Load existing photos for these visuals
      await this.loadExistingPhotos();
    } catch (error) {
      console.error('Error loading existing visual selections:', error);
    }
  }
  
  toggleSection(section: string) {
    this.expandedSections[section] = !this.expandedSections[section];
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
  
  // Save and submit functions
  async saveTemplate() {
    // Save to localStorage as draft
    const draftKey = `efe_template_${this.projectId}_${this.serviceId}`;
    const draftData = {
      formData: this.formData,
      elevationReadings: this.elevationReadings,
      savedAt: new Date().toISOString()
    };
    
    localStorage.setItem(draftKey, JSON.stringify(draftData));
    
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
          // Store the ID for future reference
          this.visualRecordIds[key] = exists.PK_ID || exists.id || exists.VisualID;
          console.log('   Stored existing ID:', this.visualRecordIds[key]);
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
      Type: template.Type || '',  // Text(255) in Caspio
      Name: template.Name || '',  // Text(255) in Caspio
      Notes: ''                    // Text(255) in Caspio - empty for now
    };
    
    console.log('📤 DATA BEING SENT TO SERVICES_VISUALS TABLE:');
    console.log('=====================================');
    console.log('COLUMN MAPPING TO SERVICES_VISUALS TABLE:');
    console.log('   ServiceID (Integer):', visualData.ServiceID, typeof visualData.ServiceID);
    console.log('   Category (Text 255):', visualData.Category);
    console.log('   Type (Text 255):', visualData.Type);
    console.log('   Name (Text 255):', visualData.Name);
    console.log('   Notes (Text 255):', visualData.Notes);
    console.log('=====================================');
    console.log('⚠️ NOT SENDING: Text, TemplateID (these columns do not exist in Services_Visuals)');
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
      
      // Show debug popup for visual creation
      await this.showVisualCreationDebug(category, templateId, response);
      
      // Check if response exists (even if empty, it might mean success)
      // Caspio sometimes returns empty response on successful POST
      if (response === undefined || response === null || response === '') {
        console.log('⚠️ Empty response received - treating as success (common with Caspio)');
        // Generate a temporary ID for tracking
        const tempId = `temp_${Date.now()}`;
        const recordKey = `visual_${category}_${templateId}`;
        localStorage.setItem(recordKey, tempId);
        this.visualRecordIds[`${category}_${templateId}`] = tempId;
        
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
      if (Array.isArray(response) && response.length > 0) {
        visualId = response[0].PK_ID || response[0].VisualID || response[0].id;
        console.log('📋 Response was array, extracted ID from first item:', visualId);
      } else if (response && typeof response === 'object') {
        // If response has Result array (Caspio pattern)
        if (response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
          visualId = response.Result[0].PK_ID || response.Result[0].VisualID || response.Result[0].id;
          console.log('📋 Response had Result array, extracted ID:', visualId);
        } else {
          // Direct object response
          visualId = response.PK_ID || response.VisualID || response.id;
          console.log('📋 Response was object, extracted ID:', visualId);
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
      
      // Check if it's a real error or just a response parsing issue
      // Status 200-299 means success even if response parsing failed
      if (error?.status >= 200 && error?.status < 300) {
        console.log('✅ Request was successful (status 2xx) - ignoring response parsing error');
        // Treat as success
        const tempId = `temp_${Date.now()}`;
        const recordKey = `visual_${category}_${templateId}`;
        localStorage.setItem(recordKey, tempId);
        this.visualRecordIds[`${category}_${templateId}`] = tempId;
        
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
        console.error('Expected columns: ServiceID (Integer), Category (Text), Type (Text), Name (Text), Notes (Text)');
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
    this.currentUploadContext = { category, itemId, item, action: 'upload' };
    this.fileInput.nativeElement.click();
  }
  
  // Camera button handler - EXACTLY like Required Documents uploadDocument
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
  
  // Handle file selection from the hidden input (same pattern as Required Documents)
  async handleFileSelect(event: any) {
    const file = event.target.files[0];
    if (!file || !this.currentUploadContext) return;
    
    const { category, itemId, item } = this.currentUploadContext;
    
    try {
      console.log('📸 File selected:', file.name);
      
      // Get or create visual ID
      const key = `${category}_${itemId}`;
      let visualId = this.visualRecordIds[key];
      
      if (!visualId) {
        // Need to save the visual first
        await this.saveVisualSelection(category, itemId);
        visualId = this.visualRecordIds[key];
      }
      
      if (visualId) {
        await this.uploadPhotoForVisual(visualId, file, key);
      }
    } catch (error) {
      console.error('❌ Error handling file:', error);
      await this.showToast('Failed to upload file', 'danger');
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
  
  // Upload photo to Service_Visuals_Attach - EXACT same approach as working Attach table
  async uploadPhotoForVisual(visualId: string, photo: File, key: string) {
    console.log('=====================================');
    console.log('📤 UPLOADING PHOTO TO SERVICE_VISUALS_ATTACH');
    console.log('=====================================');
    console.log('   VisualID (string):', visualId);
    console.log('   Key:', key);
    console.log('   Photo Name:', photo.name);
    console.log('   Photo Size:', photo.size);
    console.log('   Photo Type:', photo.type);
    
    // Debug: Check all stored visual IDs
    console.log('🔍 All stored visual IDs:', this.visualRecordIds);
    console.log('🔍 Visual ID for this key:', this.visualRecordIds[key]);
    
    try {
      // Validate the visualId before proceeding
      console.log('🔍 Validating VisualID before upload:');
      console.log('   - Raw visualId parameter:', visualId);
      console.log('   - Type of visualId:', typeof visualId);
      console.log('   - visualRecordIds[key]:', this.visualRecordIds[key]);
      
      // Use the ID from visualRecordIds to ensure consistency
      const actualVisualId = this.visualRecordIds[key] || visualId;
      console.log('   - Using actualVisualId:', actualVisualId);
      
      // Parse visualId to number as required by the service
      const visualIdNum = parseInt(actualVisualId, 10);
      console.log('   - Parsed to number:', visualIdNum);
      
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
      
      // Show popup with data to be sent
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
              await this.performVisualPhotoUpload(visualIdNum, photo, key);
            }
          }
        ]
      });
      
      await alert.present();
      
    } catch (error) {
      console.error('❌ Failed to prepare upload:', error);
      await this.showToast('Failed to prepare photo upload', 'danger');
    }
  }
  
  // Separate method to perform the actual upload
  private async performVisualPhotoUpload(visualIdNum: number, photo: File, key: string) {
    const loading = await this.loadingController.create({
      message: 'Uploading photo...'
    });
    await loading.present();
    
    try {
      // Using EXACT same approach as working Required Documents upload
      const response = await this.caspioService.createServicesVisualsAttachWithFile(
        visualIdNum, 
        '', // Annotation blank for now as requested
        photo
      ).toPromise();
      
      console.log('✅ Photo uploaded successfully:', response);
      
      // Store photo reference - need to use the visualId from the key parameter
      const visualId = key.split('_').pop(); // Extract visualId from key
      if (visualId) {
        if (!this.visualPhotos[visualId]) {
          this.visualPhotos[visualId] = [];
        }
        this.visualPhotos[visualId].push({
          id: response?.AttachID || response?.PK_ID || response?.id || Date.now(),
          name: photo.name,
          link: response?.Photo || '',
          uploadedAt: new Date().toISOString()
        });
      }
      
      await loading.dismiss();
      await this.showToast('Photo uploaded successfully', 'success');
      
      // Reload photos to show the new upload
      await this.loadExistingPhotos();
      
    } catch (error) {
      console.error('❌ Failed to upload photo:', error);
      await loading.dismiss();
      await this.showToast('Failed to upload photo', 'danger');
    }
  }
  
  // Get photo count for a visual
  getPhotoCount(category: string, itemId: string): number {
    const visualId = this.visualRecordIds[`${category}_${itemId}`];
    return visualId && this.visualPhotos[visualId] ? this.visualPhotos[visualId].length : 0;
  }
  
  // Get photos for a visual
  getPhotosForVisual(category: string, itemId: string): any[] {
    const visualId = this.visualRecordIds[`${category}_${itemId}`];
    return visualId && this.visualPhotos[visualId] ? this.visualPhotos[visualId] : [];
  }
  
  // View photo - open in modal or new window
  async viewPhoto(photo: any, category: string, itemId: string) {
    try {
      console.log('👁️ Viewing photo:', photo);
      
      // If we have a Caspio URL in the link field
      if (photo.link && photo.link.startsWith('https://')) {
        window.open(photo.link, '_blank');
      } else if (photo.Photo && photo.Photo.startsWith('https://')) {
        window.open(photo.Photo, '_blank');
      } else {
        await this.showToast('Unable to view photo', 'warning');
      }
    } catch (error) {
      console.error('Error viewing photo:', error);
      await this.showToast('Failed to view photo', 'danger');
    }
  }
  
  // Replace existing photo
  async replacePhoto(photo: any, category: string, itemId: string) {
    this.currentUploadContext = { 
      category, 
      itemId, 
      action: 'replace',
      existingPhotoId: photo.id || photo.AttachID
    };
    this.fileInput.nativeElement.click();
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
    
    if (response === undefined || response === null || response === '') {
      responseType = 'Empty/Null Response';
      extractedId = 'Will generate temp ID';
    } else if (Array.isArray(response) && response.length > 0) {
      responseType = 'Array Response';
      extractedId = response[0].PK_ID || response[0].VisualID || response[0].id || 'Not found in array';
    } else if (response && typeof response === 'object') {
      if (response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
        responseType = 'Object with Result array';
        extractedId = response.Result[0].PK_ID || response.Result[0].VisualID || response.Result[0].id || 'Not found in Result';
      } else {
        responseType = 'Direct Object';
        extractedId = response.PK_ID || response.VisualID || response.id || 'Not found in object';
      }
    } else {
      responseType = 'Direct ID';
      extractedId = response;
    }
    
    // Get all existing visuals for comparison
    let existingVisuals = [];
    try {
      const visuals = await this.caspioService.getServicesVisualsByServiceId(this.serviceId).toPromise();
      if (visuals && Array.isArray(visuals)) {
        existingVisuals = visuals.map(v => ({
          id: v.PK_ID || v.VisualID || v.id,
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
          
          <strong style="color: blue;">Extracted ID:</strong> ${extractedId}<br>
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
          const visualId = ourVisual.PK_ID || ourVisual.VisualID || ourVisual.id;
          const recordKey = `visual_${category}_${templateId}`;
          localStorage.setItem(recordKey, String(visualId));
          this.visualRecordIds[`${category}_${templateId}`] = String(visualId);
          console.log('✅ Visual ID refreshed:', visualId, 'for key:', `${category}_${templateId}`);
        } else {
          console.log('⚠️ Could not find visual with Category:', category, 'and Name:', templateName);
          console.log('Available visuals:', visuals.map(v => ({ Category: v.Category, Name: v.Name, ID: v.PK_ID || v.VisualID })));
        }
      }
    } catch (error) {
      console.error('Failed to refresh visual ID:', error);
    }
  }
  
  // Load existing photos for visuals
  async loadExistingPhotos() {
    for (const key in this.visualRecordIds) {
      const visualId = this.visualRecordIds[key];
      if (visualId) {
        try {
          const photos = await this.caspioService.getServiceVisualsAttachByVisualId(visualId).toPromise();
          if (photos && photos.length > 0) {
            this.visualPhotos[visualId] = photos;
            console.log(`📸 Loaded ${photos.length} photos for visual ${visualId}`);
          }
        } catch (error) {
          console.error(`Failed to load photos for visual ${visualId}:`, error);
        }
      }
    }
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