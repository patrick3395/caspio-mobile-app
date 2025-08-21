import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { CaspioService } from '../../services/caspio.service';
import { ToastController, LoadingController } from '@ionic/angular';

interface ElevationReading {
  location: string;
  value: number | null;
}

interface ServicesVisualRecord {
  ServiceID: string;
  Category: string;
  Type: string;
  Name: string;
  Notes?: string;
  Text?: string;
  TemplateID?: string;
}

@Component({
  selector: 'app-engineers-foundation',
  templateUrl: './engineers-foundation.page.html',
  styleUrls: ['./engineers-foundation.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class EngineersFoundationPage implements OnInit {
  projectId: string = '';
  serviceId: string = '';
  projectData: any = null;
  
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
  
  // Form data for the template
  formData: any = {
    // Structural Systems fields
    foundationType: '',
    foundationCondition: '',
    structuralObservations: '',
    
    // Elevation Plot fields
    elevationAnalysis: '',
    
    // Additional fields to be added based on requirements
  };
  
  // Elevation readings array
  elevationReadings: ElevationReading[] = [];
  
  // UI state
  expandedSections: { [key: string]: boolean } = {
    structural: true,
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
    private loadingController: LoadingController
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
      
      // Extract unique categories
      const categoriesSet = new Set<string>();
      this.visualTemplates.forEach(template => {
        if (template.Category) {
          categoriesSet.add(template.Category);
        }
      });
      
      this.visualCategories = Array.from(categoriesSet).sort();
      
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
    if (!this.serviceId) return;
    
    try {
      const existingVisuals = await this.caspioService.getServicesVisualsByServiceId(this.serviceId).toPromise();
      console.log('Existing visuals loaded:', existingVisuals);
      
      // Mark items as selected based on existing records
      existingVisuals.forEach(visual => {
        if (visual.TemplateID && visual.Category) {
          const key = `${visual.Category}_${visual.TemplateID}`;
          this.selectedItems[key] = true;
          
          // Store the record ID for potential deletion
          const recordKey = `visual_${visual.Category}_${visual.TemplateID}`;
          localStorage.setItem(recordKey, visual.PK_ID || visual.id);
          
          // Update categoryData if exists
          if (this.categoryData[visual.Category] && this.categoryData[visual.Category][visual.TemplateID]) {
            this.categoryData[visual.Category][visual.TemplateID].selected = true;
          }
        }
      });
      
      console.log('Visual selections restored:', this.selectedItems);
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
    const key = `${category}_${itemId}`;
    const wasSelected = this.selectedItems[key];
    
    // Set saving state
    this.savingItems[key] = true;
    
    this.selectedItems[key] = !wasSelected;
    
    // Update the categoryData as well
    if (this.categoryData[category] && this.categoryData[category][itemId]) {
      this.categoryData[category][itemId].selected = this.selectedItems[key];
    }
    
    console.log('Item toggled:', key, this.selectedItems[key]);
    
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
    if (!this.serviceId) {
      console.error('No ServiceID available for saving visual');
      return;
    }
    
    // Find the template data
    const template = this.visualTemplates.find(t => t.PK_ID === templateId);
    if (!template) {
      console.error('Template not found:', templateId);
      return;
    }
    
    const visualData: ServicesVisualRecord = {
      ServiceID: this.serviceId,
      Category: category,
      Type: template.Type || '',
      Name: template.Name || '',
      Notes: '', // Can be updated later if needed
      Text: template.Text || '',
      TemplateID: templateId
    };
    
    try {
      const response = await this.caspioService.createServicesVisual(visualData).toPromise();
      console.log('✅ Visual saved to Services_Visuals:', response);
      
      // Store the record ID for potential deletion later
      const recordKey = `visual_${category}_${templateId}`;
      localStorage.setItem(recordKey, response.PK_ID || response.id);
      
    } catch (error) {
      console.error('❌ Failed to save visual:', error);
      await this.showToast('Failed to save selection', 'danger');
      
      // Revert the selection on error
      const key = `${category}_${templateId}`;
      this.selectedItems[key] = false;
      if (this.categoryData[category] && this.categoryData[category][templateId]) {
        this.categoryData[category][templateId].selected = false;
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
}