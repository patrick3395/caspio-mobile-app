import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, ToastController, LoadingController, AlertController } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { CaspioService } from '../../services/caspio.service';
import { ServiceEfeService } from '../../services/service-efe.service';
import { Subject, timer } from 'rxjs';
import { debounceTime, distinctUntilChanged, takeUntil } from 'rxjs/operators';

type DocumentViewerCtor = typeof import('../../components/document-viewer/document-viewer.component')['DocumentViewerComponent'];

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
  
  // Submission tracking
  isSubmitted: boolean = false;
  submittedDate: string = '';
  
  // Auto-save related
  private destroy$ = new Subject<void>();
  private autoSaveSubject = new Subject<{field: string, value: any}>();
  saveStatus: string = '';
  saveStatusType: 'info' | 'success' | 'error' = 'info';

  private documentViewerComponent?: DocumentViewerCtor;

  
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
  documentPreviewUrls: { [key: string]: string } = {};
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

  private async loadDocumentViewer(): Promise<DocumentViewerCtor> {
    if (!this.documentViewerComponent) {
      const module = await import('../../components/document-viewer/document-viewer.component');
      this.documentViewerComponent = module.DocumentViewerComponent;
    }
    return this.documentViewerComponent;
  }

  constructor(
    private route: ActivatedRoute,
    private caspioService: CaspioService,
    private serviceEfeService: ServiceEfeService,
    private modalController: ModalController,
    private toastController: ToastController,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private cdr: ChangeDetectorRef
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
    
    // Initialize document status tracking for UI
    this.initializeDocumentTracking();
    
    // Check for existing Service_EFE record and load data
    await this.initializeServiceRecord();
  }
  
  initializeDocumentTracking() {
    // Ensure document tracking objects are initialized
    if (!this.documentStatus) {
      this.documentStatus = {
        homeInspectionReport: false,
        engineersEvaluationReport: false,
        supportDocument: false
      };
    }
    if (!this.documentNames) this.documentNames = {};
    if (!this.documentDates) this.documentDates = {};
    if (!this.documentAttachIds) this.documentAttachIds = {};
    if (!this.additionalDocuments) this.additionalDocuments = [];
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
        
        // Load existing data
        if (checkResult.record) {
          this.loadExistingData(checkResult.record);
          
          // Check if service was previously submitted
          if (checkResult.record['Status'] === 'Under Review') {
            this.isSubmitted = true;
            this.submittedDate = checkResult.record['SubmittedDate'] || '';
          }
        }
      } else {
        const newRecord = await this.serviceEfeService.createServiceEFE(this.projectId).toPromise();
        if (newRecord) {
          // Wait and check again to get the ServiceID
          await timer(1000).toPromise();
          const recheckResult = await this.serviceEfeService.checkServiceEFE(this.projectId).toPromise();
          if (recheckResult?.exists && recheckResult.ServiceID) {
            this.currentServiceID = recheckResult.ServiceID;
          }
        }
      }
      
      // Load existing documents from Attach table
      await this.loadExistingDocuments();
    } catch (error) {
      console.error('Error initializing Service_EFE:', error);
      this.showSaveStatus('Failed to initialize service record', 'error');
    }
  }
  
  async loadExistingDocuments() {
    if (!this.projectId) return;
    
    try {
      
      // Load documents with TypeID = 3 for this project
      const attachments = await this.caspioService.getAttachmentsByProjectAndType(this.projectId, 3).toPromise();
      
      if (attachments && attachments.length > 0) {
        
        for (const attachment of attachments) {
          const link = attachment.Link || '';
          const fileName = attachment.Attachment || '';
          
          // Determine document type based on Link field
          let docType = '';
          if (link.toLowerCase().includes('support')) {
            docType = 'supportDocument';
          } else if (link.toLowerCase().includes('home') || link.toLowerCase().includes('inspection')) {
            docType = 'homeInspectionReport';
          } else if (link.toLowerCase().includes('engineer') || link.toLowerCase().includes('evaluation')) {
            docType = 'engineersEvaluationReport';
          }
          
          if (docType) {
            this.documentStatus[docType] = true;
            this.documentNames[docType] = link;
            this.documentAttachIds[docType] = attachment.AttachID;
            
            // Store the actual file path for later use
            this.documentPreviewUrls[docType] = fileName; // Store the file path temporarily
            
            // Generate preview URL for images
            if (fileName && this.isImageFile(fileName)) {
              try {
                const base64Data = await this.caspioService.getImageFromFilesAPI(fileName).toPromise();
                if (base64Data) {
                  this.documentPreviewUrls[docType] = base64Data;
                }
              } catch (error) {
                console.error('Error loading image preview for', docType, error);
              }
            } else if (fileName) {
            }
          }
        }
      } else {
        await this.showToast('No documents found for this project', 'info');
      }
    } catch (error) {
      console.error('Error loading existing documents:', error);
    }
  }
  
  isImageFile(fileName: string): boolean {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];
    const ext = fileName.toLowerCase();
    return imageExtensions.some(extension => ext.endsWith(extension));
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
    // PERFORMANCE OPTIMIZATION: Use immutable update for better change detection
    this.expandedSubsections = {
      ...this.expandedSubsections,
      [subsectionName]: !this.expandedSubsections[subsectionName]
    };
    
    // PERFORMANCE: Use RAF for smooth toggle animation
    requestAnimationFrame(() => {
      this.cdr?.detectChanges?.();
    });
  }

  goToSection(sectionNum: number) {
    // PERFORMANCE OPTIMIZATION: Only change if actually different
    if (this.currentSection === sectionNum && this.expandedSections[sectionNum]) {
      return; // Already at this section, no work needed
    }
    
    // OPTIMIZED: Create new object instead of iterating (better for change detection)
    const newExpandedSections: { [key: number]: boolean } = {};
    newExpandedSections[sectionNum] = true;
    
    this.expandedSections = newExpandedSections;
    this.currentSection = sectionNum;
    
    // PERFORMANCE: Use RAF for smooth section transition
    requestAnimationFrame(() => {
      // Trigger minimal change detection
      this.cdr?.detectChanges?.();
    });
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
  
  async showToast(message: string, type: 'info' | 'success' | 'error' | 'warning') {
    const toast = await this.toastController.create({
      message: message,
      duration: type === 'error' ? 3000 : 2000,
      position: 'top',
      color: type === 'error' ? 'danger' : type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'medium'
    });
    await toast.present();
  }
  
  // Check if a field has value (for CSS classes)
  hasValue(fieldName: string): boolean {
    return this.fieldStates[fieldName] || false;
  }

  async submitForm() {
    if (!this.formData) return;
    
    // Validate required fields
    if (!this.formData['requestedAddress'] || !this.formData['city']) {
      await this.showToast('Please fill in all required fields', 'error');
      return;
    }
    
    // Check if we have a service record to update
    if (!this.currentServiceID) {
      await this.showToast('No service record found. Please try again.', 'error');
      return;
    }
    
    // Show loading indicator
    const loading = await this.loadingController.create({
      message: 'Submitting service...'
    });
    await loading.present();
    
    try {
      // Get current date/time in ISO format
      const submittedDateTime = new Date().toISOString();
      
      // Update Status to "Under Review" and save submission date
      await this.serviceEfeService.updateMultipleFields(this.currentServiceID, {
        Status: 'Under Review',
        SubmittedDate: submittedDateTime
      }).toPromise();
      
      // Update local state
      this.isSubmitted = true;
      this.submittedDate = submittedDateTime;
      
      await loading.dismiss();
      await this.showToast('Service submitted successfully!', 'success');
      
    } catch (error) {
      console.error('Submit error:', error);
      await loading.dismiss();
      await this.showToast('Error submitting service. Please try again.', 'error');
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
    
    // Immediately update UI to show file is selected
    this.documentNames[docType] = file.name;
    this.documentDates[docType] = new Date().toLocaleDateString();
    this.documentStatus[docType] = true; // Mark as uploaded immediately for UI feedback
    this.fieldStates[docType] = true;
    this.updateAllSectionProgress();
    
    // Store the file for later upload if needed
    this.selectedFiles[docType] = file;
    
    // Create preview URL for images
    if (this.isDocumentImage(docType)) {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.documentPreviewUrls[docType] = e.target.result;
      };
      reader.readAsDataURL(file);
    }
    
    // If we have a project ID, try to upload to Caspio
    if (this.projectId) {
      this.showSaveStatus(`Uploading ${linkTitle}...`, 'info');
      
      try {
        // Create attachment record with the Link field populated with the document title
        const response = await this.caspioService.createAttachmentWithFile(
          parseInt(this.projectId),
          1, // TypeID for documents
          linkTitle, // This goes in the Title field
          `Document type: ${linkTitle} | File: ${file.name}`, // Notes field
          file
        ).toPromise();
        
        if (response) {
          this.documentAttachIds[docType] = response.AttachID || response.id;
          // Update the link name to show what was uploaded
          this.documentNames[docType] = `${linkTitle} - ${file.name}`;
          this.showSaveStatus(`${linkTitle} uploaded successfully`, 'success');
        } else {
          this.showSaveStatus('Document saved locally', 'info');
        }
      } catch (error) {
        console.error('Ã¢Å¡Â Ã¯Â¸Â Could not upload to Caspio, keeping local:', error);
        // Keep the document marked as uploaded locally even if Caspio upload fails
        this.showSaveStatus('Document saved locally', 'info');
      }
    } else {
      this.showSaveStatus('Document saved locally', 'info');
    }
    
    // Force change detection
    this.updateAllSectionProgress();
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

  async viewDocument(docType: string) {
    const attachId = this.documentAttachIds[docType];
    const fileName = this.documentNames[docType];
    
    // Show loading using the same style as Loading Report
    const loading = await this.alertController.create({
      header: 'Loading Report',
      message: 'Loading document...',
      buttons: [
        {
          text: 'Cancel',
          handler: () => {
            return true; // Allow dismissal
          }
        }
      ],
      backdropDismiss: false,
      cssClass: 'template-loading-alert'
    });
    await loading.present();
    
    try {
      // If we have a stored file object from recent upload, use it
      if (this.selectedFiles[docType]) {
        const file = this.selectedFiles[docType];
        const reader = new FileReader();
        reader.onload = async (e: any) => {
          await loading.dismiss();
          const DocumentViewerComponent = await this.loadDocumentViewer();
          const modal = await this.modalController.create({
            component: DocumentViewerComponent,
            componentProps: {
              fileUrl: e.target.result,
              fileName: fileName || file!.name,
              fileType: file!.type
            }
          });
          await modal.present();
        };
        reader.readAsDataURL(file);
      } else if (attachId) {
        // Fetch from Caspio
        try {
          // Get the attachment record
          const attachment = await this.caspioService.getAttachment(attachId.toString()).toPromise();
          
          if (attachment && attachment.Attachment) {
            const filePath = attachment.Attachment;
            
            // Determine file type
            const isPDF = filePath.toLowerCase().endsWith('.pdf');
            const isImage = this.isImageFile(filePath);
            
            if (isPDF) {
              const pdfData = await this.caspioService.getPDFFromFilesAPI(filePath).toPromise();
              await loading.dismiss();
              
              if (pdfData) {
                const DocumentViewerComponent = await this.loadDocumentViewer();
                const modal = await this.modalController.create({
                  component: DocumentViewerComponent,
                  componentProps: {
                    fileUrl: pdfData,
                    fileName: fileName || 'Document.pdf',
                    fileType: 'application/pdf'
                  }
                });
                await modal.present();
              } else {
                await this.showToast('Failed to load PDF', 'error');
              }
            } else if (isImage) {
              const imageData = await this.caspioService.getImageFromFilesAPI(filePath).toPromise();
              await loading.dismiss();
              
              if (imageData) {
                const DocumentViewerComponent = await this.loadDocumentViewer();
                const modal = await this.modalController.create({
                  component: DocumentViewerComponent,
                  componentProps: {
                    fileUrl: imageData,
                    fileName: fileName || 'Image',
                    fileType: this.getFileTypeFromName(filePath)
                  }
                });
                await modal.present();
              } else {
                await this.showToast('Failed to load image', 'error');
              }
            } else {
              await loading.dismiss();
              await this.showToast(`Document type not supported: ${filePath}`, 'warning');
            }
          } else {
            await loading.dismiss();
            await this.showToast('Document path not found in database', 'error');
          }
        } catch (error) {
          await loading.dismiss();
          console.error('Failed to load document:', error);
          await this.showToast(`Error: ${(error as any).message || 'Unable to load document'}`, 'error');
        }
      } else {
        await loading.dismiss();
        await this.showToast('No document to view', 'warning');
      }
    } catch (error) {
      await loading.dismiss();
      console.error('Error viewing document:', error);
      await this.showToast('Error viewing document', 'error');
    }
  }
  
  // Helper methods for document preview
  isDocumentPDF(docType: string): boolean {
    const fileName = this.documentNames[docType] || '';
    return fileName.toLowerCase().endsWith('.pdf');
  }
  
  isDocumentImage(docType: string): boolean {
    const fileName = this.documentNames[docType] || '';
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg'];
    return imageExtensions.some(ext => fileName.toLowerCase().endsWith(ext));
  }
  
  isDocumentOther(docType: string): boolean {
    return !this.isDocumentPDF(docType) && !this.isDocumentImage(docType);
  }
  
  getDocumentShortName(docType: string): string {
    const fileName = this.documentNames[docType] || 'Document';
    // Remove the title prefix if present (e.g., "Support Document - filename.pdf" => "filename.pdf")
    const parts = fileName.split(' - ');
    const shortName = parts.length > 1 ? parts[parts.length - 1] : fileName;
    // Return the full name without truncation
    return shortName;
  }
  
  getFileTypeFromName(fileName: string): string {
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: { [key: string]: string } = {
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif'
    };
    return mimeTypes[extension] || 'application/octet-stream';
  }
  
  handleDocumentPreviewError(event: any, docType: string) {
    console.error('Document preview failed to load:', docType);
    event.target.src = 'assets/img/photo-placeholder.svg';
  }

  replaceDocument(docType: string) {
    
    // Clear the file input first to allow selecting the same file
    const fileInput = document.getElementById(docType) as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
      // Trigger file input click
      setTimeout(() => {
        fileInput.click();
      }, 100);
    }
  }

  async removeDocument(docType: string) {
    const attachId = this.documentAttachIds[docType];
    
    if (attachId) {
      try {
        await this.caspioService.deleteAttachment(attachId.toString()).toPromise();
      } catch (error) {
        console.error('Ã¢ÂÅ’ Failed to delete document:', error);
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
  }

  removeAdditionalDocument(index: number) {
    this.additionalDocuments.splice(index, 1);
  }
}

