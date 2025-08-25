import { Component, OnInit, ViewChild, ElementRef, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { CaspioService } from '../../services/caspio.service';
import { ToastController, LoadingController, AlertController, ActionSheetController, ModalController, Platform } from '@ionic/angular';
import { CameraService } from '../../services/camera.service';

interface ElevationReading {
  location: string;
  value: number | null;
}

interface ServicesVisualRecord {
  ServiceID: number;  // Changed to number to match Integer type in Caspio
  Category: string;
  Kind: string;  // Changed from Type to Kind
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
  
  // Restore accordion state after change detection
  private restoreAccordionState() {
    // Store current section states before they get reset
    const currentSectionStates = { ...this.expandedSections };
    
    // Restore section states immediately
    setTimeout(() => {
      this.expandedSections = currentSectionStates;
      
      // Restore accordion states
      if (this.visualAccordionGroup && this.expandedAccordions.length > 0) {
        this.visualAccordionGroup.value = this.expandedAccordions;
      }
    }, 50);
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
      Notes: ''                    // Text(255) in Caspio - empty for now
    };
    
    console.log('📤 DATA BEING SENT TO SERVICES_VISUALS TABLE:');
    console.log('=====================================');
    console.log('COLUMN MAPPING TO SERVICES_VISUALS TABLE:');
    console.log('   ServiceID (Integer):', visualData.ServiceID, typeof visualData.ServiceID);
    console.log('   Category (Text 255):', visualData.Category);
    console.log('   Kind (Text 255):', visualData.Kind);
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
        
        // Upload all files in parallel for speed
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
        const successCount = results.filter((r: { success: boolean }) => r.success).length;
        const failCount = results.filter((r: { success: boolean }) => !r.success).length;
        
        // Show result message
        if (failCount === 0) {
          await this.showToast(
            files.length > 1 
              ? `Successfully uploaded ${successCount} photos` 
              : 'Photo uploaded successfully',
            'success'
          );
        } else if (successCount > 0) {
          await this.showToast(
            `Uploaded ${successCount} of ${files.length} photos. ${failCount} failed.`,
            'warning'
          );
        } else {
          await this.showToast('Failed to upload photos', 'danger');
        }
        
        // Restore accordion and section states after batch upload
        this.restoreAccordionState();
        
        // Photos are already added with proper previews during upload
        // Just trigger change detection to ensure they're displayed
        if (successCount > 0) {
          this.changeDetectorRef.detectChanges();
        }
        
        // Clear upload tracking
        this.uploadingPhotos[key] = Math.max(0, (this.uploadingPhotos[key] || 0) - files.length);
        if (this.uploadingPhotos[key] === 0) {
          delete this.uploadingPhotos[key];
        }
        
        // Force change detection to update the view
        this.changeDetectorRef.detectChanges();
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
  
  // Upload photo to Service_Visuals_Attach - EXACT same approach as working Attach table
  async uploadPhotoForVisual(visualId: string, photo: File, key: string, isBatchUpload: boolean = false) {
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
    let loading: any = null;
    if (!isBatchUpload) {
      loading = await this.loadingController.create({
        message: 'Uploading photo...'
      });
      await loading.present();
    }
    
    try {
      // Using EXACT same approach as working Required Documents upload
      const response = await this.caspioService.createServicesVisualsAttachWithFile(
        visualIdNum, 
        '', // Annotation blank for now as requested
        photo
      ).toPromise();
      
      console.log('✅ Photo uploaded successfully:', response);
      
      // Store photo reference - use the actual visualRecordIds value for this key
      const actualVisualId = String(this.visualRecordIds[key]); // Ensure string for consistency
      console.log('🔍 Getting visualId for key:', key, '-> actualVisualId:', actualVisualId);
      
      if (actualVisualId && actualVisualId !== 'undefined') {
        if (!this.visualPhotos[actualVisualId]) {
          this.visualPhotos[actualVisualId] = [];
        }
        
        // Create photo object with immediate preview
        const photoData: any = {
          AttachID: response?.AttachID || response?.PK_ID || response?.id || Date.now(),
          id: response?.AttachID || response?.PK_ID || response?.id || Date.now(),
          name: photo.name,
          Photo: response?.Photo || '',
          filePath: response?.Photo || '',
          uploadedAt: new Date().toISOString(),
          url: '', // Will be populated below
          thumbnailUrl: '' // Will be populated below
        };
        
        // Create immediate preview from the uploaded file BEFORE adding to array
        await new Promise<void>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            photoData.url = reader.result as string;
            photoData.thumbnailUrl = reader.result as string;
            resolve();
          };
          reader.readAsDataURL(photo);
        });
        
        // Now add to array with preview already set
        this.visualPhotos[actualVisualId].push(photoData);
        console.log('🖼️ Photo added with preview:', {
          key,
          actualVisualId,
          actualVisualIdType: typeof actualVisualId,
          photoCount: this.visualPhotos[actualVisualId].length,
          hasUrl: !!photoData.url,
          urlLength: photoData.url?.length || 0,
          allVisualPhotoKeys: Object.keys(this.visualPhotos),
          allVisualRecordIdKeys: Object.keys(this.visualRecordIds),
          visualRecordIdsForThisKey: this.visualRecordIds[key]
        });
        
        // Trigger change detection to show preview immediately
        this.changeDetectorRef.detectChanges();
        // Restore accordion state after change detection
        this.restoreAccordionState();
      }
      
      if (loading) {
        await loading.dismiss();
      }
      if (!isBatchUpload) {
        await this.showToast('Photo uploaded successfully', 'success');
      }
      
      // Don't reload all photos - just ensure this one is visible
      // The preview is already set, just trigger change detection
      this.changeDetectorRef.detectChanges();
      // Restore accordion state after change detection
      this.restoreAccordionState();
      
    } catch (error) {
      console.error('❌ Failed to upload photo:', error);
      if (loading) {
        await loading.dismiss();
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
    
    // Debug log when checking photo count
    if (this.selectedItems[key]) {
      console.log(`📊 Photo count for ${key}:`, {
        visualId,
        count,
        hasVisualPhotos: !!this.visualPhotos[visualId],
        visualPhotosKeys: Object.keys(this.visualPhotos)
      });
    }
    
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
    
    // Enhanced debugging for problematic visuals
    if (this.selectedItems[key]) {
      console.log('📷 getPhotosForVisual DEBUG:', {
        category,
        itemId,
        key,
        visualId,
        visualIdType: typeof this.visualRecordIds[key],
        rawVisualId: this.visualRecordIds[key],
        photoCount: photos.length,
        hasVisualPhotos: !!this.visualPhotos[visualId],
        allVisualPhotoKeys: Object.keys(this.visualPhotos),
        allVisualRecordIdKeys: Object.keys(this.visualRecordIds),
        photos: photos.map(p => ({ 
          name: p.name || 'unnamed',
          hasUrl: !!p.url,
          hasThumbnail: !!p.thumbnailUrl,
          urlStart: p.url ? p.url.substring(0, 50) : 'no-url',
          filePath: p.filePath 
        }))
      });
    }
    
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
  
  // View photo - open in modal or new window
  async viewPhoto(photo: any, category: string, itemId: string) {
    try {
      console.log('👁️ Viewing photo:', photo);
      
      // If we have a data URL (base64), open it in a new window
      if (photo.url && photo.url.startsWith('data:')) {
        const newWindow = window.open('', '_blank');
        if (newWindow) {
          newWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>${photo.name || 'Photo'}</title>
              <style>
                body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #000; }
                img { max-width: 100%; max-height: 100vh; object-fit: contain; }
              </style>
            </head>
            <body>
              <img src="${photo.url}" alt="${photo.name || 'Photo'}">
            </body>
            </html>
          `);
          newWindow.document.close();
        }
      } else if (photo.link && photo.link.startsWith('https://')) {
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
            handler: async () => {
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
                name: photo.Annotation || photo.Photo || 'Photo',
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
    
    // Log final state
    console.log('📸 Final visualPhotos state after loading:', this.visualPhotos);
    console.log('📸 Keys with photos:', Object.keys(this.visualPhotos).filter(k => this.visualPhotos[k]?.length > 0));
    
    // Trigger change detection after all photos are loaded
    this.changeDetectorRef.detectChanges();
    console.log('✅ All photos loaded, change detection triggered');
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