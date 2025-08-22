import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ProjectsService, Project } from '../../services/projects.service';
import { CaspioService } from '../../services/caspio.service';
import { IonModal, ToastController, AlertController, LoadingController, ModalController } from '@ionic/angular';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ImageViewerComponent } from '../../components/image-viewer/image-viewer.component';

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
  linkName?: string;  // The Link field from Caspio (filename)
  attachmentUrl?: string;
  additionalFiles?: Array<{  // For multiple uploads of the same document
    attachId: string;
    linkName: string;
    attachmentUrl: string;
  }>;
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
    private loadingController: LoadingController,
    private modalController: ModalController
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
        
        // Load offers first, then services (services need offers to match properly)
        await this.loadAvailableOffers();
        
        // Now load these in parallel
        await Promise.all([
          this.loadExistingServices(),  // This needs offers to be loaded first
          this.loadAttachTemplates(),
          this.loadExistingAttachments()
        ]);
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
      // Use actual ProjectID from project data for querying services
      const projectId = this.project?.ProjectID || this.projectId;
      const services = await this.caspioService.getServicesByProject(projectId).toPromise();
      
      console.log('🔍 Loading existing services:', services);
      console.log('🔍 Available offers for matching:', this.availableOffers);
      
      // Convert existing services to our selection format
      this.selectedServices = (services || []).map((service: any) => {
        // Find offer by TypeID (Services table doesn't have OffersID)
        const offer = this.availableOffers.find(o => {
          // Try multiple matching strategies for TypeID
          return o.TypeID == service.TypeID;  // Use == for type coercion
        });
        
        if (!offer) {
          console.error('❌ CRITICAL: Could not find offer for service:', {
            serviceTypeID: service.TypeID,
            serviceTypeIDType: typeof service.TypeID,
            availableOfferTypeIDs: this.availableOffers.map(o => ({
              TypeID: o.TypeID,
              type: typeof o.TypeID,
              OffersID: o.OffersID,
              TypeName: o.TypeName
            }))
          });
        } else {
          console.log('✅ Matched service to offer:', {
            serviceTypeID: service.TypeID,
            offerTypeID: offer.TypeID,
            offerOffersID: offer.OffersID,
            offerTypeName: offer.TypeName
          });
        }
        
        return {
          instanceId: this.generateInstanceId(),
          serviceId: service.PK_ID || service.ServiceID,
          offersId: offer?.OffersID || '', // Get OffersID from the matched offer
          typeId: service.TypeID.toString(),
          typeName: offer?.TypeName || offer?.Service_Name || 'Service',
          dateOfInspection: service.DateOfInspection || new Date().toISOString()
        };
      });
      
      console.log('✅ Existing services loaded and matched with offers:', this.selectedServices);
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
      // Use actual ProjectID from project data for querying attachments
      const projectId = this.project?.ProjectID || this.projectId;
      const attachments = await this.caspioService.getAttachmentsByProject(projectId).toPromise();
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


  getServicePrice(service: ServiceSelection): number {
    // Find the matching offer to get the price
    const offer = this.availableOffers.find(o => o.OffersID === service.offersId);
    if (offer && offer.ServiceFee) {
      return parseFloat(offer.ServiceFee) || 0;
    }
    return 0;
  }

  calculateServicesTotal(): number {
    let total = 0;
    for (const service of this.selectedServices) {
      total += this.getServicePrice(service);
    }
    return total;
  }
  
  // Check if all required documents are uploaded for a service
  areAllRequiredDocsUploaded(serviceDoc: any): boolean {
    if (!serviceDoc || !serviceDoc.documents) return false;
    
    // Get only required documents
    const requiredDocs = serviceDoc.documents.filter((doc: any) => doc.required === true);
    
    // If no required docs, return false (don't color green)
    if (requiredDocs.length === 0) return false;
    
    // Check if ALL required documents are uploaded
    // Only return true if there are required docs AND they're ALL uploaded
    const allUploaded = requiredDocs.every((doc: any) => doc.uploaded === true);
    
    console.log('Checking docs for service:', serviceDoc.serviceName, {
      totalDocs: serviceDoc.documents.length,
      requiredDocs: requiredDocs.length,
      allUploaded: allUploaded
    });
    
    return allUploaded;
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
      
      // Create service record in Caspio - Services table only has ProjectID, TypeID, DateOfInspection
      // IMPORTANT: Use project.ProjectID (not PK_ID) for the Services table relationship
      const serviceData = {
        ProjectID: this.project?.ProjectID || this.projectId, // Use actual ProjectID from project, not PK_ID
        TypeID: offer.TypeID,
        DateOfInspection: new Date().toISOString().split('T')[0] // Format as YYYY-MM-DD for date input
      };
      
      console.log('🔍 DEBUG: Creating service with data:', serviceData);
      console.log('🔍 DEBUG: Calling caspioService.createService...');
      
      const newService = await this.caspioService.createService(serviceData).toPromise();
      
      console.log('🔍 DEBUG: Service created successfully:', newService);
      
      // Caspio returns the service instantly - get the ID
      if (!newService || (!newService.PK_ID && !newService.ServiceID)) {
        throw new Error('Service created but no ID returned from Caspio');
      }
      
      // Add to selected services with the real service ID
      const selection: ServiceSelection = {
        instanceId: this.generateInstanceId(),
        serviceId: newService.PK_ID || newService.ServiceID,  // Use real ID from Caspio
        offersId: offer.OffersID || offer.PK_ID,
        typeId: offer.TypeID,
        typeName: offer.TypeName || offer.Service_Name || 'Service',
        dateOfInspection: serviceData.DateOfInspection
      };
      
      console.log('🔍 DEBUG: Adding selection to selectedServices:', selection);
      
      this.selectedServices.push(selection);
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
      // Delete from Caspio - service always has real ID
      if (service.serviceId) {
        console.log('🗑️ Deleting service from Caspio:', service.serviceId);
        await this.caspioService.deleteService(service.serviceId).toPromise();
      }
      
      // Remove from selected services
      const index = this.selectedServices.findIndex(s => s.instanceId === service.instanceId);
      if (index > -1) {
        this.selectedServices.splice(index, 1);
      }
      
      this.updateDocumentsList();
      
      await this.showToast(`${service.typeName} removed`, 'success');
    } catch (error) {
      console.error('❌ Error removing service:', error);
      // Still remove from UI even if Caspio delete fails
      const index = this.selectedServices.findIndex(s => s.instanceId === service.instanceId);
      if (index > -1) {
        this.selectedServices.splice(index, 1);
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
      if (service.serviceId) {
        await this.caspioService.updateService(service.serviceId, {
          DateOfInspection: service.dateOfInspection
        }).toPromise();
        
        // Show saved indicator briefly
        service.saved = true;
        // Remove indicator immediately on next tick
        requestAnimationFrame(() => {
          setTimeout(() => service.saved = false, 300);
        });
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
        
        // Show saved indicator briefly
        service.saved = true;
        // Remove indicator immediately on next tick
        requestAnimationFrame(() => {
          setTimeout(() => service.saved = false, 300);
        });
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
          // Find ALL attachments for this type and title (for multiple uploads)
          const attachments = this.existingAttachments.filter(a => 
            a.TypeID === parseInt(service.typeId) && 
            a.Title === template.Title
          );
          
          // Create the main document entry
          const docItem: DocumentItem = {
            attachId: attachments[0]?.AttachID,  // First attachment ID for main actions
            title: template.Title || template.AttachmentName || 'Document',
            required: (template.Required === 'Yes' || template.Required === true || template.Required === 1),
            uploaded: attachments.length > 0,
            templateId: template.PK_ID,
            filename: attachments[0]?.Link,
            linkName: attachments[0]?.Link,
            attachmentUrl: attachments[0]?.Attachment,
            // Store all attachments for display
            additionalFiles: attachments.slice(1).map(a => ({
              attachId: a.AttachID,
              linkName: a.Link,
              attachmentUrl: a.Attachment
            }))
          } as any;
          
          documents.push(docItem);
        }
      } else {
        // Use service-specific defaults
        for (let i = 0; i < docTitles.length; i++) {
          // Find ALL attachments for this type and title (for multiple uploads)
          const attachments = this.existingAttachments.filter(a => 
            a.TypeID === parseInt(service.typeId) && 
            a.Title === docTitles[i]
          );
          
          // Create the main document entry
          const docItem: DocumentItem = {
            attachId: attachments[0]?.AttachID,  // First attachment ID for main actions
            title: docTitles[i],
            required: i === 0, // First document is required, others optional
            uploaded: attachments.length > 0,
            filename: attachments[0]?.Link,
            linkName: attachments[0]?.Link,
            attachmentUrl: attachments[0]?.Attachment,
            // Store all attachments for display
            additionalFiles: attachments.slice(1).map(a => ({
              attachId: a.AttachID,
              linkName: a.Link,
              attachmentUrl: a.Attachment
            }))
          } as any;
          
          documents.push(docItem);
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
    // Check if serviceId exists
    if (!serviceId) {
      console.error('No serviceId provided for document upload');
      return;
    }
    
    this.currentUploadContext = { serviceId, typeId, doc, action: 'upload' };
    this.fileInput.nativeElement.click();
  }

  async replaceDocument(serviceId: string, typeId: string, doc: DocumentItem) {
    if (!serviceId) {
      console.error('No serviceId provided for document replace');
      return;
    }
    
    if (!doc.attachId) return;
    this.currentUploadContext = { serviceId, typeId, doc, action: 'replace' };
    this.fileInput.nativeElement.click();
  }

  async uploadAdditionalFile(serviceId: string, typeId: string, doc: DocumentItem) {
    if (!serviceId) {
      console.error('No serviceId provided for additional file upload');
      return;
    }
    
    this.currentUploadContext = { serviceId, typeId, doc, action: 'additional' };
    this.fileInput.nativeElement.click();
  }

  async handleFileSelect(event: any) {
    const file = event.target.files[0];
    if (!file || !this.currentUploadContext) return;
    
    let loading: any = null;
    
    try {
      const { serviceId, typeId, doc, action } = this.currentUploadContext;
      
      if (action === 'upload' || action === 'additional') {
        // Create new Attach record WITH FILE - only ProjectID and TypeID are needed
        // IMPORTANT: Use project.ProjectID (not PK_ID) for the Attach table relationship
        const projectIdNum = parseInt(this.project?.ProjectID || this.projectId);
        const typeIdNum = parseInt(typeId);
        
        console.log('🔍 DEBUG: Parsing IDs for upload:', {
          routeProjectId: this.projectId,
          actualProjectID: this.project?.ProjectID,
          projectIdNum,
          typeId,
          typeIdNum,
          serviceId: serviceId + ' (not needed for Attach table)'
        });
        
        if (isNaN(projectIdNum) || isNaN(typeIdNum)) {
          console.error('Invalid IDs:', { routeProjectId: this.projectId, actualProjectID: this.project?.ProjectID, typeId });
          await this.showToast('Invalid project or type ID. Please refresh and try again.', 'danger');
          throw new Error('Invalid ID values');
        }
        
        // ServiceID is NOT needed for Attach table - only ProjectID, TypeID, Title, Notes, Link, Attachment
        
        // Build the attachment data for preview
        const attachData = {
          ProjectID: projectIdNum,
          TypeID: typeIdNum,
          Title: doc.title || 'Document',
          Notes: '',
          Link: file.name,  // We ARE sending Link field with filename
          Attachment: `[File: ${file.name}]`
        };
        
        console.log('📝 Creating attachment record with file:', attachData);
        console.log('  ServiceID:', serviceId, '- NOT sent to Attach table (not a field in that table)');
        
        // Show popup with the data being sent - user must confirm before upload proceeds
        await this.showAttachmentDataPopup(attachData, file, serviceId);
        
        // Only show loading AFTER user confirms in the popup
        loading = await this.loadingController.create({
          message: 'Uploading file...'
        });
        await loading.present();
        
        // Create attachment WITH file in ONE request (using Observable converted to Promise)
        const response = await this.caspioService.createAttachmentWithFile(
          projectIdNum,
          typeIdNum,
          doc.title || 'Document',
          '', // notes
          file
        ).toPromise();
        
        console.log('📋 Create attachment with file response:', response);
        
        // Attachment created - update UI immediately without waiting
        if (response) {
          console.log('✅ Attachment created successfully:', response);
          // Add full attachment record immediately for instant UI update
          // Response should have all fields including AttachID, Link, and Attachment URL
          const newAttachment = {
            AttachID: response.AttachID || response.PK_ID,
            ProjectID: response.ProjectID || projectIdNum,
            TypeID: response.TypeID || typeIdNum,
            Title: response.Title || doc.title || 'Document',
            Notes: response.Notes || '',
            Link: response.Link || file.name,
            Attachment: response.Attachment || ''
          };
          this.existingAttachments.push(newAttachment);
          console.log('📎 Added attachment to list:', newAttachment);
          // Update documents list immediately - this will show the link and green color
          this.updateDocumentsList();
        }
      } else if (action === 'replace' && doc.attachId) {
        // Show loading for replace action
        loading = await this.loadingController.create({
          message: 'Replacing file...'
        });
        await loading.present();
        
        // Replace existing file
        console.log('🔄 Replacing file for AttachID:', doc.attachId);
        await this.uploadFileToCaspio(doc.attachId, file);
        
        // Update Link field with new filename
        await this.caspioService.updateAttachment(doc.attachId, {
          Link: file.name
        }).toPromise();
        console.log('✅ Updated Link field with new filename:', file.name);
        
        // Update the attachment in our local list immediately
        const existingAttach = this.existingAttachments.find(a => a.AttachID === doc.attachId);
        if (existingAttach) {
          existingAttach.Link = file.name;
        }
        // Update documents list immediately
        this.updateDocumentsList();
      }
      
      // Don't reload - UI is already updated
    } catch (error: any) {
      console.error('❌ Error handling file upload:', error);
      console.error('Error details:', {
        message: error?.message,
        status: error?.status,
        statusText: error?.statusText,
        error: error?.error
      });
      
      // Show detailed error popup for debugging
      if (error?.message !== 'Upload cancelled by user') {
        await this.showErrorPopup(error, {
          attempted_action: 'file_upload',
          file_name: file?.name,
          file_size: file?.size,
          context: this.currentUploadContext
        });
      }
      
      await this.showToast('Failed to upload file', 'danger');
    } finally {
      if (loading) {
        await loading.dismiss();
      }
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
    // If doc has an attachId, fetch the actual file from Caspio
    if (doc.attachId) {
      try {
        const loading = await this.loadingController.create({
          message: 'Loading document...'
        });
        await loading.present();
        
        // Get the attachment with the actual file data
        const attachment = await this.caspioService.getAttachmentWithImage(doc.attachId).toPromise();
        
        if (attachment && attachment.Attachment) {
          // The Attachment field should contain base64 data
          const modal = await this.modalController.create({
            component: ImageViewerComponent,
            componentProps: {
              base64Data: attachment.Attachment,
              title: doc.title,
              filename: doc.linkName || doc.filename
            }
          });
          await loading.dismiss();
          await modal.present();
        } else {
          await loading.dismiss();
          await this.showToast('Document data not available', 'warning');
        }
      } catch (error) {
        console.error('Error loading document:', error);
        await this.showToast('Failed to load document', 'danger');
      }
    } else {
      await this.showToast('Document not available', 'warning');
    }
  }

  async viewAdditionalDocument(additionalFile: any) {
    // View additional file using its attachId
    if (additionalFile.attachId) {
      try {
        const loading = await this.loadingController.create({
          message: 'Loading document...'
        });
        await loading.present();
        
        // Get the attachment with the actual file data
        const attachment = await this.caspioService.getAttachmentWithImage(additionalFile.attachId).toPromise();
        
        if (attachment && attachment.Attachment) {
          // The Attachment field should contain base64 data
          const modal = await this.modalController.create({
            component: ImageViewerComponent,
            componentProps: {
              base64Data: attachment.Attachment,
              title: 'Additional File',
              filename: additionalFile.linkName
            }
          });
          await loading.dismiss();
          await modal.present();
        } else {
          await loading.dismiss();
          await this.showToast('Document data not available', 'warning');
        }
      } catch (error) {
        console.error('Error loading document:', error);
        await this.showToast('Failed to load document', 'danger');
      }
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
  async openTemplate(service: ServiceSelection) {
    if (service.serviceId) {
      // Show alert with ServiceID and ProjectID for verification
      const alert = await this.alertController.create({
        header: 'Opening Template',
        message: `
          <strong>ServiceID:</strong> ${service.serviceId}<br>
          <strong>ProjectID:</strong> ${this.project?.ProjectID || this.projectId}<br><br>
          <strong>Service Type:</strong> ${service.typeName}<br>
          <strong>Instance:</strong> ${this.getServiceInstanceNumber(service)}
        `,
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel'
          },
          {
            text: 'Continue',
            handler: () => {
              // Navigate to specific template based on service type
              // Convert typeId to string for consistent comparison
              const typeIdStr = String(service.typeId);
              
              console.log('🔍 Template Navigation Debug:', {
                typeName: service.typeName,
                typeId: service.typeId,
                typeIdStr: typeIdStr,
                serviceId: service.serviceId,
                projectId: this.projectId,
                isEngineersFoundation: service.typeName === 'Engineers Foundation Evaluation' || typeIdStr === '35'
              });
              
              // Check both typeName and typeId (35 is Engineers Foundation Evaluation)
              // Also check for various name formats
              const isEngineersFoundation = 
                service.typeName === 'Engineers Foundation Evaluation' || 
                service.typeName === 'Engineer\'s Foundation Evaluation' ||
                service.typeName?.toLowerCase().includes('engineer') && service.typeName?.toLowerCase().includes('foundation') ||
                typeIdStr === '35';
                
              if (isEngineersFoundation) {
                console.log('✅ Navigating to Engineers Foundation template');
                console.log('   Route: /engineers-foundation/' + this.projectId + '/' + service.serviceId);
                this.router.navigate(['/engineers-foundation', this.projectId, service.serviceId]);
              } else {
                console.log('📝 Navigating to standard template form');
                console.log('   Route: /template-form/' + this.projectId + '/' + service.serviceId);
                this.router.navigate(['/template-form', this.projectId, service.serviceId]);
              }
            }
          }
        ]
      });
      await alert.present();
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
    // Force refresh of active projects by using query params to trigger reload
    this.router.navigate(['/tabs/active-projects'], { 
      queryParams: { refresh: new Date().getTime() },
      queryParamsHandling: 'merge'
    });
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

  private async showAttachmentDataPopup(attachData: any, file: File, serviceId: any) {
    const alert = await this.alertController.create({
      header: 'Attachment Data Being Sent',
      message: `
        <strong>Table: Attach</strong><br><br>
        <strong>Fields to be populated:</strong><br>
        <strong>ProjectID:</strong> ${attachData.ProjectID}<br>
        <strong>TypeID:</strong> ${attachData.TypeID}<br>
        <strong>Title:</strong> ${attachData.Title}<br>
        <strong>Notes:</strong> ${attachData.Notes || '(empty)'}<br>
        <strong>Link:</strong> ${attachData.Link}<br>
        <strong>Attachment:</strong> [File: ${file.name}, ${file.size} bytes, ${file.type}]<br><br>
        <strong>Context (not sent to table):</strong><br>
        <strong>ServiceID:</strong> ${serviceId}<br>
        <strong>API Endpoint:</strong> /tables/Attach/records?response=rows<br>
        <strong>Method:</strong> Two-step upload (JSON then File)
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