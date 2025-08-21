import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { CaspioService } from '../../services/caspio.service';
import { ServiceEfeService } from '../../services/service-efe.service';
import { Subject, timer } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

@Component({
  selector: 'app-template-form',
  templateUrl: './template-form.page.html',
  styleUrls: ['./template-form.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class TemplateFormPage implements OnInit, OnDestroy {
  offersId: string = '';
  serviceName: string = '';
  projectId: string = '';
  currentSection: number = 1;
  serviceFee: number = 285.00;
  currentServiceID: number | null = null;
  
  // Auto-save related
  private destroy$ = new Subject<void>();
  private autoSaveSubject = new Subject<{field: string, value: any}>();
  saveStatus: string = '';
  saveStatusType: 'info' | 'success' | 'error' = 'info';
  
  // Field completion tracking
  fieldStates: { [key: string]: boolean } = {};
  sectionProgress: { [key: string]: number } = {
    general: 0,
    information: 0,
    foundation: 0,
    structural: 0,
    elevation: 0
  };

  // Document tracking
  documentStatus: { [key: string]: boolean } = {
    homeInspectionReport: false,
    engineersEvaluationReport: false,
    supportDocument: false
  };
  
  documentNames: { [key: string]: string } = {};
  documentDates: { [key: string]: string } = {};
  documentAttachIds: { [key: string]: number } = {};
  additionalDocuments: any[] = [];
  
  expandedSections: { [key: number | string]: boolean } = {
    'project': true,  // Project Information section expanded by default
    1: false,
    2: false,
    3: false
  };
  
  expandedSubsections: { [key: string]: boolean } = {
    'general': true,
    'information': false,
    'foundation': false
  };
  
  // Project-level data (shared across all services)
  projectData: any = {
    ClientName: '',
    AgentName: '',
    InspectorName: '',
    YearBuilt: '',
    SquareFeet: '',
    TypeOfBuilding: '',
    Style: '',
    InAttendance: '',
    WeatherConditions: '',
    OutdoorTemperature: '',
    OccupancyFurnishings: '',
    FirstFoundationType: '',
    SecondFoundationType: '',
    SecondFoundationRooms: '',
    ThirdFoundationType: '',
    ThirdFoundationRooms: '',
    OwnerOccupantInterview: ''
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
    
    // Foundation fields
    foundationType: '',
    foundationCondition: '',
    foundationNotes: '',
    
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
    private caspioService: CaspioService,
    private serviceEfeService: ServiceEfeService
  ) {
    // Initialize auto-save with 1 second debounce (same as local server)
    this.autoSaveSubject.pipe(
      debounceTime(1000),
      distinctUntilChanged((prev, curr) => 
        prev.field === curr.field && prev.value === curr.value
      ),
      takeUntil(this.destroy$)
    ).subscribe(({field, value}) => {
      this.performAutoSave(field, value);
    });
  }

  async ngOnInit() {
    this.offersId = this.route.snapshot.paramMap.get('offersId') || '';
    this.projectId = this.route.snapshot.paramMap.get('projectId') || '';
    
    if (this.offersId && this.offersId !== 'new') {
      await this.loadServiceName();
    }
    
    // Load project data (shared across all services)
    await this.loadProjectData();
    
    // Check for existing Service_EFE record and load data
    await this.initializeServiceRecord();
  }
  
  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
  
  async initializeServiceRecord() {
    if (!this.projectId || this.projectId === 'new') return;
    
    try {
      const checkResult = await this.serviceEfeService.checkServiceEFE(this.projectId).toPromise();
      
      if (checkResult?.exists && checkResult.ServiceID) {
        this.currentServiceID = checkResult.ServiceID;
        console.log('Found existing Service_EFE record:', this.currentServiceID);
        
        // Load existing data
        if (checkResult.record) {
          this.loadExistingData(checkResult.record);
        }
      } else {
        // Create new Service_EFE record
        console.log('Creating new Service_EFE record for project:', this.projectId);
        const newRecord = await this.serviceEfeService.createServiceEFE(this.projectId).toPromise();
        if (newRecord) {
          // Wait and check again to get the ServiceID
          await timer(1000).toPromise();
          const recheckResult = await this.serviceEfeService.checkServiceEFE(this.projectId).toPromise();
          if (recheckResult?.exists && recheckResult.ServiceID) {
            this.currentServiceID = recheckResult.ServiceID;
            console.log('New Service_EFE record created with ID:', this.currentServiceID);
          }
        }
      }
    } catch (error) {
      console.error('Error initializing Service_EFE:', error);
      this.showSaveStatus('Failed to initialize service record', 'error');
    }
  }
  
  loadExistingData(record: any) {
    // Map database fields to form fields
    const fieldMapping: { [key: string]: string } = {
      'PrimaryPhoto': 'primaryPhoto',
      'DateOfInspection': 'inspectionDate',
      'TypeOfBuilding': 'buildingType',
      'Style': 'style',
      'InAttendance': 'attendance',
      'WeatherConditions': 'weather',
      'OutdoorTemperature': 'temperature',
      'OccupancyFurnishings': 'occupancy',
      'YearBuilt': 'yearBuilt',
      'SquareFootage': 'squareFootage',
      'FoundationType': 'foundationType',
      'NumberOfStories': 'numberOfStories',
      'ExteriorCladding': 'exteriorCladding',
      'RoofCovering': 'roofCovering',
      'FoundationCondition': 'foundationCondition',
      'FoundationNotes': 'foundationNotes',
      'HomeInspectionReport': 'homeInspectionReport',
      'HomeInspectionLink': 'homeInspectionLink',
      'EngineersEvaluationReport': 'engineersEvaluationReport',
      'EngineerLink': 'engineerLink',
      'SupportDocument': 'supportDocument',
      'Notes': 'notes'
    };
    
    Object.keys(fieldMapping).forEach(dbField => {
      const formField = fieldMapping[dbField];
      if (record[dbField]) {
        this.formData[formField] = record[dbField];
        this.fieldStates[formField] = true;
      }
    });
    
    this.updateAllSectionProgress();
    this.showSaveStatus('Existing data loaded', 'success');
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

  toggleSection(sectionNum: number | string) {
    this.expandedSections[sectionNum] = !this.expandedSections[sectionNum];
    if (typeof sectionNum === 'number') {
      this.currentSection = sectionNum;
    }
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

  getProjectCompletion(): number {
    const projectFields = [
      'ClientName', 'AgentName', 'InspectorName', 'YearBuilt', 'SquareFeet',
      'TypeOfBuilding', 'Style', 'InAttendance', 'WeatherConditions',
      'OutdoorTemperature', 'OccupancyFurnishings', 'FirstFoundationType'
    ];
    const completed = projectFields.filter(field => 
      this.projectData[field] && this.projectData[field] !== ''
    ).length;
    return Math.round((completed / projectFields.length) * 100);
  }

  async onFileSelected(event: any, fieldName: string) {
    const file = event.target.files[0];
    if (file) {
      this.selectedFiles[fieldName] = file;
      this.formData[fieldName] = file.name;
      console.log(`File selected for ${fieldName}:`, file.name);
      
      // Mark field as completed
      this.fieldStates[fieldName] = true;
      this.updateAllSectionProgress();
      
      // Upload file if we have a Service_EFE record
      if (this.currentServiceID) {
        this.showSaveStatus('Uploading file...', 'info');
        
        try {
          const result = await this.serviceEfeService.uploadFile(
            this.currentServiceID, 
            this.getDbFieldName(fieldName), 
            file
          ).toPromise();
          
          if (result?.success) {
            this.showSaveStatus('File uploaded', 'success');
            console.log('✅ File uploaded successfully:', result);
          } else {
            this.showSaveStatus('Upload failed', 'error');
          }
        } catch (error) {
          console.error('File upload error:', error);
          this.showSaveStatus('Upload failed', 'error');
          
          // Still save the filename reference
          this.onFieldChange(fieldName, file.name);
        }
      } else {
        // No Service_EFE record yet, just save filename for later
        this.onFieldChange(fieldName, file.name);
      }
    }
  }
  
  // Helper method to get database field name
  private getDbFieldName(formFieldName: string): string {
    const fieldMapping: { [key: string]: string } = {
      'primaryPhoto': 'PrimaryPhoto',
      'homeInspectionReport': 'HomeInspectionReport',
      'engineersEvaluationReport': 'EngineersEvaluationReport',
      'supportDocument': 'SupportDocument'
    };
    return fieldMapping[formFieldName] || formFieldName;
  }

  // Called when project-level field changes
  onProjectFieldChange(fieldName: string, value: any) {
    console.log(`Project field changed: ${fieldName} = ${value}`);
    
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
  
  // Load project data from localStorage or Caspio
  private async loadProjectData() {
    if (!this.projectId || this.projectId === 'new') return;
    
    // First try localStorage
    const projectDataKey = `projectData_${this.projectId}`;
    const savedData = localStorage.getItem(projectDataKey);
    if (savedData) {
      try {
        this.projectData = { ...this.projectData, ...JSON.parse(savedData) };
        console.log('Loaded project data from localStorage:', this.projectData);
      } catch (error) {
        console.error('Error parsing saved project data:', error);
      }
    }
    
    // Then load from Caspio to get latest data
    try {
      const project = await this.caspioService.getProject(this.projectId).toPromise();
      if (project) {
        // Merge with existing projectData
        Object.keys(this.projectData).forEach(key => {
          if (project[key] !== undefined && project[key] !== null) {
            this.projectData[key] = project[key];
          }
        });
        console.log('Loaded project data from Caspio:', this.projectData);
        
        // Update localStorage
        localStorage.setItem(projectDataKey, JSON.stringify(this.projectData));
      }
    } catch (error) {
      console.error('Error loading project data from Caspio:', error);
    }
  }
  
  // Called when any field changes
  onFieldChange(fieldName: string, value: any) {
    // Update field state
    if (value && value !== '') {
      this.fieldStates[fieldName] = true;
    } else {
      this.fieldStates[fieldName] = false;
    }
    
    // Update section progress
    this.updateAllSectionProgress();
    
    // Trigger auto-save with debounce
    this.autoSaveSubject.next({field: fieldName, value: value});
  }
  
  // Perform the actual auto-save
  async performAutoSave(fieldName: string, value: any) {
    if (!this.currentServiceID) {
      this.showSaveStatus('No service record found', 'error');
      return;
    }
    
    this.showSaveStatus('Saving...', 'info');
    
    try {
      // Map form field to database field
      const fieldMapping: { [key: string]: string } = {
        'primaryPhoto': 'PrimaryPhoto',
        'inspectionDate': 'DateOfInspection',
        'buildingType': 'TypeOfBuilding',
        'style': 'Style',
        'attendance': 'InAttendance',
        'weather': 'WeatherConditions',
        'temperature': 'OutdoorTemperature',
        'occupancy': 'OccupancyFurnishings',
        'yearBuilt': 'YearBuilt',
        'squareFootage': 'SquareFootage',
        'foundationType': 'FoundationType',
        'foundationCondition': 'FoundationCondition',
        'foundationNotes': 'FoundationNotes',
        'numberOfStories': 'NumberOfStories',
        'exteriorCladding': 'ExteriorCladding',
        'roofCovering': 'RoofCovering',
        'homeInspectionReport': 'HomeInspectionReport',
        'homeInspectionLink': 'HomeInspectionLink',
        'engineersEvaluationReport': 'EngineersEvaluationReport',
        'engineerLink': 'EngineerLink',
        'supportDocument': 'SupportDocument',
        'notes': 'Notes'
      };
      
      const dbField = fieldMapping[fieldName] || fieldName;
      
      await this.serviceEfeService.updateField(this.currentServiceID, dbField, value).toPromise();
      
      this.showSaveStatus('Saved', 'success');
      console.log(`✅ Auto-saved ${fieldName}: ${value}`);
    } catch (error) {
      console.error('Auto-save error:', error);
      this.showSaveStatus('Save failed', 'error');
    }
  }
  
  // Update progress for all sections
  updateAllSectionProgress() {
    // General section fields
    const generalFields = ['primaryPhoto', 'inspectionDate', 'buildingType', 'style', 
                           'attendance', 'weather', 'temperature', 'occupancy'];
    let generalCompleted = 0;
    generalFields.forEach(field => {
      if (this.fieldStates[field]) generalCompleted++;
    });
    this.sectionProgress['general'] = Math.round((generalCompleted / generalFields.length) * 100);
    
    // Information section fields  
    const infoFields = ['yearBuilt', 'squareFootage', 'foundationType', 'numberOfStories',
                        'exteriorCladding', 'roofCovering'];
    let infoCompleted = 0;
    infoFields.forEach(field => {
      if (this.fieldStates[field]) infoCompleted++;
    });
    this.sectionProgress['information'] = Math.round((infoCompleted / infoFields.length) * 100);
    
    // Foundation section fields
    const foundationFields = ['foundationType', 'foundationCondition', 'foundationNotes'];
    let foundationCompleted = 0;
    foundationFields.forEach(field => {
      if (this.fieldStates[field]) foundationCompleted++;
    });
    this.sectionProgress['foundation'] = Math.round((foundationCompleted / foundationFields.length) * 100);
    
    // Structural Systems section fields
    const structuralFields = ['homeInspectionReport', 'homeInspectionLink', 'engineersEvaluationReport', 
                              'engineerLink', 'supportDocument'];
    let structuralCompleted = 0;
    structuralFields.forEach(field => {
      if (this.fieldStates[field]) structuralCompleted++;
    });
    this.sectionProgress['structural'] = Math.round((structuralCompleted / structuralFields.length) * 100);
    
    // Elevation Plot section fields
    const elevationFields = ['notes'];
    let elevationCompleted = 0;
    elevationFields.forEach(field => {
      if (this.fieldStates[field]) elevationCompleted++;
    });
    this.sectionProgress['elevation'] = Math.round((elevationCompleted / elevationFields.length) * 100);
  }
  
  // Show save status message
  showSaveStatus(message: string, type: 'info' | 'success' | 'error') {
    this.saveStatus = message;
    this.saveStatusType = type;
    
    // Auto-hide success messages after 2 seconds
    if (type === 'success') {
      setTimeout(() => {
        this.saveStatus = '';
      }, 2000);
    }
  }
  
  // Check if a field has value (for CSS classes)
  hasValue(fieldName: string): boolean {
    return this.fieldStates[fieldName] || false;
  }

  async submitForm() {
    if (!this.formData) return;
    console.log('Form submitted:', this.formData);
    
    // Validate required fields
    if (!this.formData['requestedAddress'] || !this.formData['city']) {
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
        if (this.formData && parsed) {
          this.formData = { ...this.formData, ...parsed };
        }
        console.log('Loaded saved form data');
      } catch (error) {
        console.error('Error loading saved data:', error);
      }
    }
  }

  // Document Management Methods
  getUploadedDocumentsCount(): number {
    const mainDocs = Object.values(this.documentStatus).filter(status => status).length;
    return mainDocs + this.additionalDocuments.length;
  }

  getTotalDocumentsCount(): number {
    return 3 + this.additionalDocuments.length; // 3 main documents + additional
  }

  async onDocumentSelected(event: any, docType: string, linkTitle: string) {
    const file = event.target.files[0];
    if (!file) return;

    console.log(`📄 Document selected for ${docType}:`, file.name);
    
    // Store document info
    this.documentNames[docType] = file.name;
    this.documentDates[docType] = new Date().toLocaleDateString();
    
    // Upload to Caspio if we have a service ID
    if (this.currentServiceID && this.projectId) {
      this.showSaveStatus(`Uploading ${linkTitle}...`, 'info');
      
      try {
        // Create attachment record with the Link field populated
        const response = await this.caspioService.createAttachmentWithFile(
          parseInt(this.projectId),
          1, // TypeID for documents
          linkTitle,
          `Document for Service ID: ${this.currentServiceID}`,
          file
        ).toPromise();
        
        if (response) {
          console.log('✅ Document uploaded:', response);
          this.documentStatus[docType] = true;
          this.documentAttachIds[docType] = response.AttachID || response.id;
          this.showSaveStatus(`${linkTitle} uploaded successfully`, 'success');
          
          // Update field tracking
          this.fieldStates[docType] = true;
          this.updateAllSectionProgress();
        }
      } catch (error) {
        console.error('❌ Document upload failed:', error);
        this.showSaveStatus('Upload failed', 'error');
      }
    } else {
      // Mark as uploaded locally (will upload when service is created)
      this.documentStatus[docType] = true;
      this.selectedFiles[docType] = file;
      this.fieldStates[docType] = true;
      this.updateAllSectionProgress();
    }
  }

  onLinkProvided(docType: string, event: any) {
    const link = event.target.value;
    if (link && link.trim()) {
      this.documentNames[docType] = link;
      this.documentDates[docType] = new Date().toLocaleDateString();
      this.documentStatus[docType] = true;
      this.fieldStates[docType] = true;
      this.updateAllSectionProgress();
    }
  }

  viewDocument(docType: string) {
    const attachId = this.documentAttachIds[docType];
    if (attachId) {
      // TODO: Implement document viewing
      console.log(`View document ${docType} with AttachID: ${attachId}`);
    } else if (this.documentNames[docType]?.startsWith('http')) {
      window.open(this.documentNames[docType], '_blank');
    }
  }

  replaceDocument(docType: string) {
    // Reset the document status to allow re-upload
    this.documentStatus[docType] = false;
    
    // Trigger file input click
    setTimeout(() => {
      const fileInput = document.getElementById(docType) as HTMLInputElement;
      if (fileInput) {
        fileInput.click();
      }
    }, 100);
  }

  async removeDocument(docType: string) {
    const attachId = this.documentAttachIds[docType];
    
    if (attachId) {
      try {
        await this.caspioService.deleteAttachment(attachId.toString()).toPromise();
        console.log(`✅ Document ${docType} deleted`);
      } catch (error) {
        console.error('❌ Failed to delete document:', error);
      }
    }
    
    // Clear local tracking
    this.documentStatus[docType] = false;
    delete this.documentNames[docType];
    delete this.documentDates[docType];
    delete this.documentAttachIds[docType];
    delete this.selectedFiles[docType];
    
    // Update field tracking
    this.fieldStates[docType] = false;
    this.updateAllSectionProgress();
  }

  addAdditionalDocument() {
    // TODO: Implement additional document upload dialog
    console.log('Add additional document');
  }

  removeAdditionalDocument(index: number) {
    this.additionalDocuments.splice(index, 1);
  }
}