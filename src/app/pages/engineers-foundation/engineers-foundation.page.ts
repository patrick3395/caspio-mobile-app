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
    
    // Load visual categories from Services_Visuals_Templates
    await this.loadVisualCategories();
    
    // Load any existing template data
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
  toggleItemSelection(category: string, itemId: string) {
    const key = `${category}_${itemId}`;
    this.selectedItems[key] = !this.selectedItems[key];
    
    // Update the categoryData as well
    if (this.categoryData[category] && this.categoryData[category][itemId]) {
      this.categoryData[category][itemId].selected = this.selectedItems[key];
    }
    
    console.log('Item toggled:', key, this.selectedItems[key]);
  }
  
  // Check if item is selected
  isItemSelected(category: string, itemId: string): boolean {
    return this.selectedItems[`${category}_${itemId}`] || false;
  }
}