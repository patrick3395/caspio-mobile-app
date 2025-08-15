import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { CaspioService } from '../../services/caspio.service';

@Component({
  selector: 'app-template-form',
  templateUrl: './template-form.page.html',
  styleUrls: ['./template-form.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class TemplateFormPage implements OnInit {
  offersId: string = '';
  serviceName: string = '';
  projectId: string = '';
  currentSection: number = 1;
  serviceFee: number = 285.00;
  
  expandedSections: { [key: number]: boolean } = {
    1: true,
    2: false,
    3: false
  };
  
  expandedSubsections: { [key: string]: boolean } = {
    'general': true,
    'information': false
  };
  
  formData: any = {
    // General section fields
    primaryPhoto: '',
    inspectionDate: '',
    buildingType: '',
    style: '',
    attendance: '',
    weather: '',
    temperature: '',
    occupancy: '',
    
    // Information section fields
    company: 'Noble Property Inspections',
    user: 'Patrick Bullock',
    date: new Date().toISOString(),
    requestedAddress: '',
    city: '',
    state: 'TX',
    zip: '',
    serviceType: '',
    
    // Structural Systems fields
    homeInspectionReport: '',
    homeInspectionLink: '',
    engineersEvaluationReport: '',
    engineerLink: '',
    supportDocument: '',
    
    // Elevation Plot fields
    notes: ''
  };

  selectedFiles: { [key: string]: File | null } = {};

  constructor(
    private route: ActivatedRoute,
    private caspioService: CaspioService
  ) { }

  async ngOnInit() {
    this.offersId = this.route.snapshot.paramMap.get('offersId') || '';
    this.projectId = this.route.snapshot.paramMap.get('projectId') || '';
    
    if (this.offersId && this.offersId !== 'new') {
      await this.loadServiceName();
    }
    
    // Auto-save every 30 seconds
    setInterval(() => {
      this.autoSave();
    }, 30000);
  }

  async loadServiceName() {
    try {
      const offer = await this.caspioService.getOfferById(this.offersId);
      if (offer) {
        this.serviceName = offer.Service_Name || '';
        // Set service fee based on service type
        if (this.serviceName.includes('Foundation')) {
          this.serviceFee = 285.00;
        } else if (this.serviceName.includes('Truss')) {
          this.serviceFee = 350.00;
        }
      }
    } catch (error) {
      console.error('Error loading service name:', error);
    }
  }

  toggleSection(sectionNum: number) {
    this.expandedSections[sectionNum] = !this.expandedSections[sectionNum];
    this.currentSection = sectionNum;
  }

  toggleSubsection(subsectionName: string) {
    this.expandedSubsections[subsectionName] = !this.expandedSubsections[subsectionName];
  }

  goToSection(sectionNum: number) {
    // Collapse all sections
    Object.keys(this.expandedSections).forEach(key => {
      this.expandedSections[parseInt(key)] = false;
    });
    // Expand selected section
    this.expandedSections[sectionNum] = true;
    this.currentSection = sectionNum;
  }

  getGeneralCompletion(): number {
    const fields = ['buildingType', 'style', 'attendance', 'weather', 'temperature', 'occupancy'];
    const completed = fields.filter(field => this.formData[field] && this.formData[field] !== '').length;
    return Math.round((completed / fields.length) * 100);
  }

  onFileSelected(event: any, fieldName: string) {
    const file = event.target.files[0];
    if (file) {
      this.selectedFiles[fieldName] = file;
      this.formData[fieldName] = file.name;
      console.log(`File selected for ${fieldName}:`, file.name);
      
      // Auto-save when file is selected
      this.autoSave();
    }
  }

  async autoSave() {
    try {
      // Save to localStorage for persistence
      localStorage.setItem('templateFormData', JSON.stringify(this.formData));
      console.log('Form auto-saved');
      
      // If we have a project ID, save to Caspio
      if (this.projectId && this.projectId !== 'new') {
        // TODO: Implement Caspio save
        console.log('Would save to Caspio for project:', this.projectId);
      }
    } catch (error) {
      console.error('Auto-save error:', error);
    }
  }

  async submitForm() {
    console.log('Form submitted:', this.formData);
    
    // Validate required fields
    if (!this.formData.requestedAddress || !this.formData.city) {
      alert('Please fill in all required fields');
      return;
    }
    
    try {
      // TODO: Submit to Caspio API
      // For now, just show success message
      alert('Template form submitted successfully!');
      
      // Clear saved data
      localStorage.removeItem('templateFormData');
    } catch (error) {
      console.error('Submit error:', error);
      alert('Error submitting form. Please try again.');
    }
  }

  ionViewWillEnter() {
    // Load saved form data
    const savedData = localStorage.getItem('templateFormData');
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        this.formData = { ...this.formData, ...parsed };
        console.log('Loaded saved form data');
      } catch (error) {
        console.error('Error loading saved data:', error);
      }
    }
  }
}