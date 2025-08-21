import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ProjectsService, Project } from '../../services/projects.service';
import { CaspioService } from '../../services/caspio.service';
import { IonModal, ToastController, AlertController, LoadingController } from '@ionic/angular';
import { HttpClient, HttpHeaders } from '@angular/common/http';

interface ServiceSelection {
  instanceId: string;
  serviceId?: string; // PK_ID from Services table
  offersId: string;
  typeId: string;
  typeName: string;
  dateOfInspection: string;
  saving?: boolean;
  saved?: boolean;
}

interface DocumentItem {
  attachId?: string;
  title: string;
  required: boolean;
  uploaded: boolean;
  templateId?: string;
  filename?: string;
  attachmentUrl?: string;
}

interface ServiceDocumentGroup {
  serviceId: string;
  serviceName: string;
  typeId: string;
  instanceNumber: number;
  documents: DocumentItem[];
}

@Component({
  selector: 'app-project-detail',
  templateUrl: './project-detail.page.html',
  styleUrls: ['./project-detail.page.scss'],
  standalone: false
})
export class ProjectDetailPage implements OnInit {
  @ViewChild('optionalDocsModal') optionalDocsModal!: IonModal;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  project: Project | null = null;
  loading = false;
  error = '';
  projectId: string = '';
  
  // Services
  availableOffers: any[] = [];
  selectedServices: ServiceSelection[] = [];
  loadingServices = false;
  updatingServices = false;
  
  // Documents
  attachTemplates: any[] = [];
  existingAttachments: any[] = [];
  serviceDocuments: ServiceDocumentGroup[] = [];
  loadingDocuments = false;
  optionalDocumentsList: any[] = [];
  currentUploadContext: any = null;
  
  // For modal
  selectedServiceDoc: ServiceDocumentGroup | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private projectsService: ProjectsService,
    private caspioService: CaspioService,
    private http: HttpClient,
    private toastController: ToastController,
    private alertController: AlertController,
    private loadingController: LoadingController
  ) {}

  ngOnInit() {
    this.projectId = this.route.snapshot.paramMap.get('id') || '';
    console.log('🔍 DEBUG: ProjectDetailPage initialized with projectId:', this.projectId);
    
    // Log environment config (without secrets)
    console.log('🔍 DEBUG: API Base URL:', this.caspioService['http'] ? 'HttpClient available' : 'HttpClient NOT available');
    
    if (this.projectId) {
      this.loadProject();
    } else {
      console.error('❌ DEBUG: No projectId provided!');
    }
  }

  async loadProject() {
    console.log('🔍 DEBUG: loadProject called');
    console.log('🔍 DEBUG: Current authentication status:', this.caspioService.isAuthenticated());
    console.log('🔍 DEBUG: Current token:', this.caspioService.getCurrentToken());
    
    if (!this.caspioService.isAuthenticated()) {
      console.log('🔍 DEBUG: Not authenticated, attempting to authenticate...');
      this.caspioService.authenticate().subscribe({
        next: () => {
          console.log('✅ DEBUG: Authentication successful');
          this.fetchProject();
        },
        error: (error) => {
          this.error = 'Authentication failed';
          console.error('❌ DEBUG: Authentication error:', error);
          console.error('Error details:', {
            status: error?.status,
            message: error?.message,
            error: error?.error
          });
        }
      });
    } else {
      console.log('🔍 DEBUG: Already authenticated, fetching project...');
      this.fetchProject();
    }
  }

  async fetchProject() {
    this.loading = true;
    this.error = '';
    
    this.projectsService.getProjectById(this.projectId).subscribe({
      next: async (project) => {
        this.project = project;
        this.loading = false;
        console.log('Project loaded:', project);
        
        // Load related data
        await this.loadAvailableOffers();
        await this.loadExistingServices();
        await this.loadAttachTemplates();
        await this.loadExistingAttachments();
      },
      error: (error) => {
        this.error = 'Failed to load project';
        this.loading = false;
        console.error('Error loading project:', error);
      }
    });
  }

  async loadAvailableOffers() {
    this.loadingServices = true;
    console.log('🔍 DEBUG: Starting to load available offers...');
    try {
      // Load offers for company ID 1 (Noble Property Inspections)
      console.log('🔍 DEBUG: Fetching offers for CompanyID=1...');
      const offers = await this.caspioService.getOffersByCompany('1').toPromise();
      console.log('🔍 DEBUG: Offers received:', offers);
      
      // Also load Types table to get type names
      console.log('🔍 DEBUG: Fetching service types...');
      const types = await this.caspioService.getServiceTypes().toPromise();
      console.log('🔍 DEBUG: Types received:', types);
      
      // Merge offer data with type names
      const processedOffers = (offers || []).map((offer: any) => {
        const type = (types || []).find((t: any) => t.PK_ID === offer.TypeID || t.TypeID === offer.TypeID);
        const result = {
          ...offer,
          TypeName: type?.TypeName || type?.Type || offer.Service_Name || offer.Description || 'Unknown Service'
        };
        console.log('🔍 DEBUG: Processed offer:', result);
        return result;
      });
      
      // Sort alphabetically with "Other" at the bottom
      this.availableOffers = processedOffers.sort((a: any, b: any) => {
        const nameA = a.TypeName.toLowerCase();
        const nameB = b.TypeName.toLowerCase();
        
        // Put "Other" at the bottom
        if (nameA === 'other') return 1;
        if (nameB === 'other') return -1;
        
        // Otherwise sort alphabetically
        return nameA.localeCompare(nameB);
      });
      
      console.log('✅ Available offers loaded and sorted:', this.availableOffers);
    } catch (error) {
      console.error('❌ Error loading offers - Full details:', error);
      console.error('Error type:', typeof error);
      console.error('Error stack:', (error as any)?.stack);
      await this.showToast(`Failed to load services: ${(error as any)?.message || error}`, 'danger');
    } finally {
      this.loadingServices = false;
    }
  }

  async loadExistingServices() {
    try {
      const services = await this.caspioService.getServicesByProject(this.projectId).toPromise();
      
      // Convert existing services to our selection format
      this.selectedServices = (services || []).map((service: any) => {
        const offer = this.availableOffers.find(o => o.TypeID === service.TypeID);
        return {
          instanceId: this.generateInstanceId(),
          serviceId: service.PK_ID,
          offersId: offer?.OffersID || service.TypeID,
          typeId: service.TypeID,
          typeName: offer?.TypeName || 'Service',
          dateOfInspection: service.DateOfInspection || new Date().toISOString()
        };
      });
      
      console.log('Existing services loaded:', this.selectedServices);
      this.updateDocumentsList();
    } catch (error) {
      console.error('Error loading existing services:', error);
    }
  }

  async loadAttachTemplates() {
    try {
      this.attachTemplates = (await this.caspioService.getAttachTemplates().toPromise()) || [];
      console.log('Attach templates loaded:', this.attachTemplates);
    } catch (error) {
      console.error('Error loading attach templates:', error);
    }
  }

  async loadExistingAttachments() {
    this.loadingDocuments = true;
    try {
      const attachments = await this.caspioService.getAttachmentsByProject(this.projectId).toPromise();
      this.existingAttachments = attachments || [];
      console.log('Existing attachments loaded:', this.existingAttachments);
      this.updateDocumentsList();
    } catch (error) {
      console.error('Error loading existing attachments:', error);
    } finally {
      this.loadingDocuments = false;
    }
  }

  // Service selection methods
  isServiceSelected(offersId: string): boolean {
    return this.selectedServices.some(s => s.offersId === offersId);
  }

  async toggleService(event: any, offer: any) {
    console.log('🔍 DEBUG: toggleService called with:', { checked: event.detail.checked, offer });
    const isChecked = event.detail.checked;
    
    if (isChecked) {
      console.log('🔍 DEBUG: Checkbox checked, adding service...');
      await this.addService(offer);
    } else {
      console.log('🔍 DEBUG: Checkbox unchecked, removing service...');
      await this.removeAllServiceInstances(offer.OffersID);
    }
  }

  async toggleServiceByLabel(offer: any) {
    const isSelected = this.isServiceSelected(offer.OffersID);
    if (isSelected) {
      await this.removeAllServiceInstances(offer.OffersID);
    } else {
      await this.addService(offer);
    }
  }

  async addService(offer: any) {
    console.log('🔍 DEBUG: Starting addService with offer:', offer);
    this.updatingServices = true;
    
    try {
      // Validate offer data
      if (!offer) {
        throw new Error('No offer data provided');
      }
      if (!offer.TypeID) {
        throw new Error('Offer missing TypeID');
      }
      
      // Create service record in Caspio
      const serviceData = {
        ProjectID: this.projectId,
        TypeID: offer.TypeID,
        DateOfInspection: new Date().toISOString().split('T')[0] // Format as YYYY-MM-DD for date input
      };
      
      console.log('🔍 DEBUG: Creating service with data:', serviceData);
      console.log('🔍 DEBUG: Calling caspioService.createService...');
      
      const newService = await this.caspioService.createService(serviceData).toPromise();
      
      console.log('🔍 DEBUG: Service created successfully:', newService);
      
      // Add to selected services
      const selection: ServiceSelection = {
        instanceId: this.generateInstanceId(),
        serviceId: newService?.PK_ID || newService?.id || 'temp_' + Date.now(),
        offersId: offer.OffersID || offer.PK_ID,
        typeId: offer.TypeID,
        typeName: offer.TypeName || offer.Service_Name || 'Service',
        dateOfInspection: serviceData.DateOfInspection
      };
      
      console.log('🔍 DEBUG: Adding selection to selectedServices:', selection);
      
      this.selectedServices.push(selection);
      this.saveToLocalStorage();
      this.updateDocumentsList();
      
      console.log('✅ Service added successfully');
      await this.showToast(`${selection.typeName} added`, 'success');
    } catch (error) {
      console.error('❌ Error adding service - Full details:', error);
      console.error('Error type:', typeof error);
      console.error('Error message:', (error as any)?.message);
      console.error('Error stack:', (error as any)?.stack);
      console.error('Error response:', (error as any)?.error);
      
      const errorMessage = (error as any)?.error?.Message || 
                          (error as any)?.message || 
                          'Unknown error occurred';
      
      await this.showToast(`Failed to add service: ${errorMessage}`, 'danger');
    } finally {
      this.updatingServices = false;
    }
  }

  async removeServiceInstance(service: ServiceSelection) {
    const alert = await this.alertController.create({
      header: 'Remove Service',
      message: `Are you sure you want to remove ${service.typeName}?`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Remove',
          handler: async () => {
            await this.performRemoveService(service);
          }
        }
      ]
    });
    
    await alert.present();
  }

  private async performRemoveService(service: ServiceSelection) {
    this.updatingServices = true;
    
    try {
      // Delete from Caspio if it has a real serviceId (not temporary)
      if (service.serviceId && !service.serviceId.toString().startsWith('temp_')) {
        console.log('🗑️ Deleting service from Caspio:', service.serviceId);
        await this.caspioService.deleteService(service.serviceId).toPromise();
      } else {
        console.log('⚠️ Service has temporary ID, skipping Caspio delete:', service.serviceId);
      }
      
      // Remove from selected services
      const index = this.selectedServices.findIndex(s => s.instanceId === service.instanceId);
      if (index > -1) {
        this.selectedServices.splice(index, 1);
      }
      
      this.saveToLocalStorage();
      this.updateDocumentsList();
      
      await this.showToast(`${service.typeName} removed`, 'success');
    } catch (error) {
      console.error('❌ Error removing service:', error);
      // Still remove from UI even if Caspio delete fails
      const index = this.selectedServices.findIndex(s => s.instanceId === service.instanceId);
      if (index > -1) {
        this.selectedServices.splice(index, 1);
        this.saveToLocalStorage();
        this.updateDocumentsList();
      }
      await this.showToast('Service removed locally', 'warning');
    } finally {
      this.updatingServices = false;
    }
  }

  async removeAllServiceInstances(offersId: string) {
    const services = this.selectedServices.filter(s => s.offersId === offersId);
    for (const service of services) {
      await this.performRemoveService(service);
    }
  }

  async duplicateService(offersId: string, typeName: string) {
    const offer = this.availableOffers.find(o => o.OffersID === offersId);
    if (offer) {
      await this.addService(offer);
    }
  }

  getServiceCount(offersId: string): number {
    return this.selectedServices.filter(s => s.offersId === offersId).length;
  }

  getServiceInstanceNumber(service: ServiceSelection): number {
    const sameTypeServices = this.selectedServices.filter(s => s.offersId === service.offersId);
    return sameTypeServices.findIndex(s => s.instanceId === service.instanceId) + 1;
  }

  formatDateForInput(dateString: string): string {
    if (!dateString) return new Date().toISOString().split('T')[0];
    try {
      const date = new Date(dateString);
      return date.toISOString().split('T')[0];
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  }

  async updateServiceDateFromInput(service: ServiceSelection, event: any) {
    const newDate = event.target.value;
    if (!newDate) return;
    
    service.dateOfInspection = new Date(newDate).toISOString();
    service.saving = true;
    service.saved = false;
    
    try {
      if (service.serviceId && service.serviceId !== 'temp_' + service.serviceId) {
        await this.caspioService.updateService(service.serviceId, {
          DateOfInspection: service.dateOfInspection
        }).toPromise();
        
        service.saved = true;
        setTimeout(() => {
          service.saved = false;
        }, 2000);
      }
    } catch (error) {
      console.error('Error updating service date:', error);
      await this.showToast('Failed to update date', 'danger');
    } finally {
      service.saving = false;
    }
  }

  async updateServiceDate(service: ServiceSelection, event: any) {
    const newDate = event.detail.value;
    service.dateOfInspection = newDate;
    service.saving = true;
    service.saved = false;
    
    try {
      if (service.serviceId) {
        await this.caspioService.updateService(service.serviceId, {
          DateOfInspection: newDate
        }).toPromise();
        
        service.saved = true;
        setTimeout(() => {
          service.saved = false;
        }, 2000);
      }
    } catch (error) {
      console.error('Error updating service date:', error);
      await this.showToast('Failed to update date', 'danger');
    } finally {
      service.saving = false;
    }
  }

  // Document management methods
  updateDocumentsList() {
    this.serviceDocuments = [];
    
    for (const service of this.selectedServices) {
      // Get ALL templates for this service type (both required and optional)
      const requiredTemplates = this.attachTemplates.filter(t => 
        t.TypeID === parseInt(service.typeId) && 
        (t.Required === 'Yes' || t.Required === true || t.Required === 1)
      );
      
      const documents: DocumentItem[] = [];
      
      // Map service types to their specific documents
      const serviceDocMap: any = {
        'home inspection': ['Inspection Report', 'Client Agreement', 'Photos'],
        'pool/spa inspection': ['Pool/Spa Report', 'Equipment Photos'],
        'termite inspection': ['WDI Report', 'Treatment Recommendations'],
        'sewer scope': ['Sewer Scope Report', 'Video Link'],
        'foundation survey': ['Foundation Report', 'Elevation Certificate'],
        'mold inspection': ['Mold Report', 'Lab Results'],
        'radon testing': ['Radon Report', 'Test Results'],
        'cubicasa': ['Floor Plan', '3D Model', 'Measurements'],
        'other': ['Service Report', 'Documentation']
      };
      
      // Find matching document set based on service name
      const serviceName = service.typeName.toLowerCase();
      let docTitles = serviceDocMap[serviceName];
      
      // If no exact match, check for partial matches
      if (!docTitles) {
        for (const key in serviceDocMap) {
          if (serviceName.includes(key) || key.includes(serviceName)) {
            docTitles = serviceDocMap[key];
            break;
          }
        }
      }
      
      // Default to generic documents if no match found
      if (!docTitles) {
        docTitles = ['Service Report', 'Supporting Documentation'];
      }
      
      // Add documents based on templates or defaults
      if (requiredTemplates.length > 0) {
        // Use actual templates from database
        for (const template of requiredTemplates) {
          const attachment = this.existingAttachments.find(a => 
            a.ServiceID === service.serviceId && 
            a.Title === template.Title
          );
          
          documents.push({
            attachId: attachment?.AttachID,
            title: template.Title || template.AttachmentName || 'Document',
            required: (template.Required === 'Yes' || template.Required === true || template.Required === 1),
            uploaded: !!attachment,
            templateId: template.PK_ID,
            filename: attachment?.Link,
            attachmentUrl: attachment?.Attachment
          });
        }
      } else {
        // Use service-specific defaults
        for (let i = 0; i < docTitles.length; i++) {
          const attachment = this.existingAttachments.find(a => 
            a.ServiceID === service.serviceId && 
            a.Title === docTitles[i]
          );
          
          documents.push({
            attachId: attachment?.AttachID,
            title: docTitles[i],
            required: i === 0, // First document is required, others optional
            uploaded: !!attachment,
            filename: attachment?.Link,
            attachmentUrl: attachment?.Attachment
          });
        }
      }
      
      this.serviceDocuments.push({
        serviceId: service.serviceId || service.instanceId,
        serviceName: service.typeName,
        typeId: service.typeId,
        instanceNumber: this.getServiceInstanceNumber(service),
        documents: documents
      });
    }
  }

  async uploadDocument(serviceId: string, typeId: string, doc: DocumentItem) {
    this.currentUploadContext = { serviceId, typeId, doc, action: 'upload' };
    this.fileInput.nativeElement.click();
  }

  async replaceDocument(doc: DocumentItem) {
    if (!doc.attachId) return;
    this.currentUploadContext = { doc, action: 'replace' };
    this.fileInput.nativeElement.click();
  }

  async uploadAdditionalFile(serviceId: string, typeId: string, doc: DocumentItem) {
    this.currentUploadContext = { serviceId, typeId, doc, action: 'additional' };
    this.fileInput.nativeElement.click();
  }

  async handleFileSelect(event: any) {
    const file = event.target.files[0];
    if (!file || !this.currentUploadContext) return;
    
    const loading = await this.loadingController.create({
      message: 'Uploading file...'
    });
    await loading.present();
    
    try {
      const { serviceId, typeId, doc, action } = this.currentUploadContext;
      
      if (action === 'upload' || action === 'additional') {
        // Create new Attach record - ensure all IDs are valid integers
        const projectIdNum = parseInt(this.projectId);
        const typeIdNum = parseInt(typeId);
        const serviceIdNum = parseInt(serviceId);
        
        if (isNaN(projectIdNum) || isNaN(typeIdNum) || isNaN(serviceIdNum)) {
          console.error('Invalid IDs:', { projectId: this.projectId, typeId, serviceId });
          throw new Error('Invalid ID values');
        }
        
        // Build the attachment data - NOTE: Attach table doesn't have ServiceID field
        const attachData = {
          ProjectID: projectIdNum,
          TypeID: typeIdNum,
          Title: doc.title || 'Document',
          Notes: '', // Empty notes field
          Link: '', // Will be populated after file upload
          Attachment: '' // Will be populated by file upload
        };
        // DO NOT add ServiceID - it's not a field in the Attach table
        
        console.log('📝 Creating attachment record:', attachData);
        console.log('📊 Field values being sent to Caspio Attach table:');
        console.log('  ProjectID:', attachData.ProjectID, '(type:', typeof attachData.ProjectID, ')');
        console.log('  TypeID:', attachData.TypeID, '(type:', typeof attachData.TypeID, ')');
        console.log('  Title:', attachData.Title);
        console.log('  Notes:', attachData.Notes || '(empty)');
        console.log('  Link:', attachData.Link || '(empty - will be set after upload)');
        console.log('  Attachment:', attachData.Attachment || '(empty - will be set by upload)');
        console.log('  ServiceID (context only):', serviceIdNum, '- NOT sent to table');
        
        // Show popup with the data being sent
        await this.showAttachmentDataPopup(attachData, file, serviceIdNum);
        
        const response = await this.caspioService.createAttachment(attachData).toPromise();
        console.log('📋 Create attachment response:', response);
        
        // With response=rows, we get the created record immediately
        let attachId: string;
        if (response?.Result && response.Result.length > 0) {
          attachId = response.Result[0].AttachID;
          console.log('✅ Got AttachID from response:', attachId);
        } else {
          console.error('Unexpected response format:', response);
          await this.showErrorPopup(
            { status: 'N/A', message: 'No AttachID in response' },
            attachData
          );
          throw new Error('Failed to get AttachID from created record');
        }
        console.log('📌 Using AttachID:', attachId);
        
        // Upload file to Caspio Files API
        await this.uploadFileToCaspio(attachId, file);
        
        // Update the Link field with the filename after successful upload
        await this.caspioService.updateAttachment(attachId, {
          Link: file.name
        }).toPromise();
        console.log('✅ Updated Link field with filename:', file.name);
        
        await this.showToast('File uploaded successfully', 'success');
      } else if (action === 'replace' && doc.attachId) {
        // Replace existing file
        console.log('🔄 Replacing file for AttachID:', doc.attachId);
        await this.uploadFileToCaspio(doc.attachId, file);
        
        // Update Link field with new filename
        await this.caspioService.updateAttachment(doc.attachId, {
          Link: file.name
        }).toPromise();
        console.log('✅ Updated Link field with new filename:', file.name);
        
        await this.showToast('File replaced successfully', 'success');
      }
      
      // Reload attachments and update display
      await this.loadExistingAttachments();
    } catch (error) {
      console.error('Error handling file upload:', error);
      await this.showToast('Failed to upload file', 'danger');
    } finally {
      await loading.dismiss();
      this.fileInput.nativeElement.value = '';
      this.currentUploadContext = null;
    }
  }

  private async uploadFileToCaspio(attachId: string, file: File): Promise<void> {
    try {
      console.log('📤 ATTEMPTING FILE UPLOAD TO CASPIO');
      console.log('  AttachID:', attachId);
      console.log('  File name:', file.name);
      console.log('  File size:', file.size, 'bytes');
      console.log('  File type:', file.type);
      console.log('  File last modified:', new Date(file.lastModified).toISOString());
      
      // Use the service method which handles authentication
      const response = await this.caspioService.uploadFileToAttachment(attachId, file).toPromise();
      console.log('📥 Upload response:', response);
      
      console.log('✅ FILE UPLOADED SUCCESSFULLY to Attach folder');
    } catch (error: any) {
      console.error('❌ FILE UPLOAD FAILED');
      console.error('Full error:', error);
      console.error('Error details:', {
        status: error?.status,
        statusText: error?.statusText,
        message: error?.message,
        error: error?.error,
        url: error?.url
      });
      
      // Log the exact endpoint we tried
      console.error('🔴 Attempted Files API endpoint: /files/Attach/Attachment/' + attachId);
      
      // If it's a 404, the Files API might not be available or the AttachID is wrong
      if (error.status === 404) {
        console.error('⚠️ 404 ERROR: Files API endpoint not found or AttachID is invalid');
        console.error('Possible issues:');
        console.error('  1. AttachID does not exist:', attachId);
        console.error('  2. Files API endpoint format is incorrect');
        console.error('  3. Attachment field name is not "Attachment"');
      } else if (error.status === 400) {
        console.error('⚠️ 400 ERROR: Bad request - check field names and data format');
      } else if (error.status === 401) {
        console.error('⚠️ 401 ERROR: Authentication issue');
      }
      throw error;
    }
  }

  async viewDocument(doc: DocumentItem) {
    if (doc.attachmentUrl) {
      window.open(doc.attachmentUrl, '_blank');
    } else {
      await this.showToast('Document not available', 'warning');
    }
  }

  async showOptionalDocuments(serviceDoc: ServiceDocumentGroup) {
    this.selectedServiceDoc = serviceDoc;
    
    // Get optional templates for this type
    const optionalTemplates = this.attachTemplates.filter(t => 
      t.TypeID === parseInt(serviceDoc.typeId) && 
      (t.Auto === 'No' || t.Auto === false || t.Auto === 0 ||
       (t.Required === 'No' || t.Required === false || t.Required === 0))
    );
    
    if (optionalTemplates.length > 0) {
      this.optionalDocumentsList = optionalTemplates.map(t => ({
        title: t.Title || t.AttachmentName || 'Document',
        required: t.Required === 'Yes' || t.Required === true || t.Required === 1,
        templateId: t.PK_ID
      }));
    } else {
      // Default optional documents
      this.optionalDocumentsList = [
        { title: 'Additional Photos', required: false },
        { title: 'Supporting Documentation', required: false },
        { title: 'Client Notes', required: false },
        { title: 'Supplemental Report', required: false }
      ];
    }
    
    await this.optionalDocsModal.present();
  }

  async addOptionalDocument(doc: any) {
    if (!this.selectedServiceDoc) return;
    
    // Add document to the service's document list
    this.selectedServiceDoc.documents.push({
      title: doc.title,
      required: doc.required,
      uploaded: false,
      templateId: doc.templateId
    });
    
    await this.optionalDocsModal.dismiss();
    this.selectedServiceDoc = null;
  }

  async removeOptionalDocument(serviceId: string, doc: DocumentItem) {
    const serviceDoc = this.serviceDocuments.find(sd => sd.serviceId === serviceId);
    if (serviceDoc) {
      const index = serviceDoc.documents.indexOf(doc);
      if (index > -1) {
        serviceDoc.documents.splice(index, 1);
      }
    }
  }

  closeOptionalDocsModal() {
    this.optionalDocsModal.dismiss();
    this.selectedServiceDoc = null;
  }

  // Template navigation
  openTemplate(service: ServiceSelection) {
    if (service.serviceId) {
      this.router.navigate(['/template-form', this.projectId, service.serviceId]);
    }
  }

  // Utility methods
  formatAddress(): string {
    if (!this.project) return '';
    const parts = [];
    if (this.project.Address) parts.push(this.project.Address);
    if (this.project.City) parts.push(this.project.City);
    if (this.project.State) parts.push(this.project.State);
    return parts.join(', ');
  }

  getStreetViewUrl(): string {
    if (!this.project || !this.formatAddress()) {
      return 'assets/img/project-placeholder.svg';
    }
    const address = encodeURIComponent(this.formatAddress());
    const apiKey = 'AIzaSyCOlOYkj3N8PT_RnoBkVJfy2BSfepqqV3A';
    return `https://maps.googleapis.com/maps/api/streetview?size=400x200&location=${address}&key=${apiKey}`;
  }

  getCityState(): string {
    if (!this.project) return '';
    const parts = [];
    if (this.project.City) parts.push(this.project.City);
    if (this.project.State) parts.push(this.project.State);
    if (this.project.Zip) parts.push(this.project.Zip);
    return parts.join(', ');
  }

  formatDate(date: any): string {
    if (!date) return 'Not specified';
    try {
      const d = new Date(date);
      return d.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
    } catch {
      return 'Invalid date';
    }
  }

  goBack() {
    this.router.navigate(['/tabs/active-projects']);
  }

  getTemplateProgress(service: any): number {
    // This is a placeholder for template completion tracking
    // In the future, this will query multiple tables to calculate completion percentage
    // For now, return a demo value based on service type
    
    // You can implement logic here to:
    // 1. Query template-specific tables for this service
    // 2. Count completed fields vs total fields
    // 3. Calculate percentage
    
    // Demo: Return different progress for different services
    const serviceProgress: { [key: string]: number } = {
      'Engineers Foundation Evaluation': 35,
      'Home Inspection Report': 75,
      'Roof Inspection': 20,
      'HVAC Assessment': 90,
      'Electrical Inspection': 45,
      'Plumbing Inspection': 60
    };
    
    // Return the progress for this service, or 0 if not found
    return serviceProgress[service.typeName] || 0;
  }

  private generateInstanceId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private saveToLocalStorage() {
    const key = `project_${this.projectId}_services`;
    localStorage.setItem(key, JSON.stringify(this.selectedServices));
  }

  private async showToast(message: string, color: string = 'primary') {
    console.log(`🔍 DEBUG: Showing toast - Color: ${color}, Message: ${message}`);
    const toast = await this.toastController.create({
      message,
      duration: color === 'danger' ? 5000 : 2000, // Show errors longer
      color,
      position: 'bottom',
      buttons: color === 'danger' ? [
        {
          text: 'Dismiss',
          role: 'cancel'
        }
      ] : []
    });
    await toast.present();
  }

  private async showAttachmentDataPopup(attachData: any, file: File, serviceId: number) {
    const alert = await this.alertController.create({
      header: 'Attachment Data Being Sent',
      message: `
        <strong>Table: Attach</strong><br><br>
        <strong>ProjectID:</strong> ${attachData.ProjectID}<br>
        <strong>TypeID:</strong> ${attachData.TypeID}<br>
        <strong>Title:</strong> ${attachData.Title}<br>
        <strong>Notes:</strong> ${attachData.Notes || '(empty)'}<br>
        <strong>Link:</strong> ${attachData.Link || '(will be set after upload)'}<br>
        <strong>Attachment:</strong> ${attachData.Attachment || '(will be set by upload)'}<br><br>
        <strong>File Info:</strong><br>
        <strong>Name:</strong> ${file.name}<br>
        <strong>Size:</strong> ${file.size} bytes<br>
        <strong>Type:</strong> ${file.type}<br><br>
        <strong>Context:</strong><br>
        <strong>ServiceID:</strong> ${serviceId} (used for context, not sent)<br>
        <strong>API Endpoint:</strong> /tables/Attach/records?response=rows
      `,
      buttons: [
        {
          text: 'Cancel Upload',
          role: 'cancel',
          cssClass: 'secondary'
        },
        {
          text: 'Continue',
          role: 'confirm'
        }
      ]
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();
    
    if (role === 'cancel') {
      throw new Error('Upload cancelled by user');
    }
  }

  private async showErrorPopup(error: any, attachData: any) {
    const errorDetails = `
      <strong>Error Status:</strong> ${error?.status || 'Unknown'}<br>
      <strong>Error Message:</strong> ${error?.error?.Message || error?.message || 'Unknown error'}<br><br>
      <strong>Data Attempted:</strong><br>
      ${JSON.stringify(attachData, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}<br><br>
      <strong>Possible Issues:</strong><br>
      1. Check if ProjectID ${attachData.ProjectID} exists<br>
      2. Check if TypeID ${attachData.TypeID} is valid<br>
      3. Verify API endpoint is correct<br>
      4. Check authentication token
    `;

    const alert = await this.alertController.create({
      header: 'Attachment Upload Failed',
      message: errorDetails,
      buttons: ['OK'],
      cssClass: 'error-alert'
    });

    await alert.present();
  }
}