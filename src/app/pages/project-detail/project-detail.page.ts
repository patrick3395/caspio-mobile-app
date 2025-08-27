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
  @ViewChild('photoInput') photoInput!: ElementRef<HTMLInputElement>;

  project: Project | null = null;
  loading = false;
  error = '';
  projectId: string = '';
  isReadOnly = false; // Track if project should be view-only
  
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
  
  // Navigation flag to prevent double-clicks
  isNavigating = false;

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
    
    // Check for add-service mode
    this.route.queryParams.subscribe(params => {
      if (params['mode'] === 'add-service') {
        // Temporarily allow editing for adding services to completed projects
        this.isReadOnly = false;
        console.log('🔍 DEBUG: Add-service mode activated');
      }
    });
    
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
        
        // Check if project is completed or in any non-active state (StatusID != 1)
        // StatusID: 1 = Active, 2 = Completed, 3 = Cancelled, 4 = On Hold
        const statusId = project.StatusID;
        
        // Check if we're in add-service mode (which overrides read-only)
        const queryParams = this.route.snapshot.queryParams;
        if (queryParams['mode'] === 'add-service') {
          this.isReadOnly = false;
          console.log('Add-service mode: Project editable despite StatusID:', statusId);
        } else {
          this.isReadOnly = statusId !== 1 && statusId !== '1';
        }
        
        if (this.isReadOnly) {
          console.log('Project is read-only. StatusID:', statusId);
        }
        
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
      
      // Check if we're in add-service mode (adding to a completed project)
      // Use activatedRoute params which are live, not snapshot
      const currentMode = await new Promise<string | undefined>((resolve) => {
        this.route.queryParams.subscribe(params => {
          resolve(params['mode']);
        });
      });
      
      // Initial debug to see if we're even entering the update logic
      alert(`DEBUG - Add Service Check:\n\nMode: ${currentMode}\nProject exists: ${!!this.project}\nShould update status: ${currentMode === 'add-service' && !!this.project}`);
      
      if (currentMode === 'add-service' && this.project) {
        // Debug: Show all project IDs and current status
        let debugInfo = '=== PROJECT STATUS UPDATE ATTEMPT ===\n\n';
        debugInfo += '1. CURRENT PROJECT DATA:\n';
        debugInfo += `   PK_ID: ${this.project.PK_ID}\n`;
        debugInfo += `   ProjectID: ${this.project.ProjectID}\n`;
        debugInfo += `   Current StatusID: ${this.project.StatusID}\n`;
        debugInfo += `   StatusID Type: ${typeof this.project.StatusID}\n\n`;
        
        debugInfo += '2. IDs TO USE:\n';
        debugInfo += `   Will use PK_ID for WHERE: ${this.project.PK_ID}\n`;
        debugInfo += `   Will update StatusID to: 1 (integer)\n\n`;
        
        alert(debugInfo);
        
        // Update project status to Active (StatusID = 1) when adding service to completed project
        const projectPkId = this.project.PK_ID;
        const projectId = this.project.ProjectID;
        
        if (projectPkId) {
          try {
            // Try using ProjectID in WHERE clause instead of PK_ID
            const updateUrl = `/tables/Projects/records?q.where=ProjectID=${projectId}`;
            const updateData = { 
              StatusID: 1  // Integer 1
            };
            
            // Debug: Show exact API call
            let apiDebug = '=== API CALL DETAILS ===\n\n';
            apiDebug += '1. UPDATE URL:\n';
            apiDebug += `   ${updateUrl}\n\n`;
            apiDebug += '2. UPDATE DATA:\n';
            apiDebug += `   ${JSON.stringify(updateData, null, 2)}\n\n`;
            apiDebug += '3. DATA TYPES:\n';
            apiDebug += `   StatusID type: ${typeof updateData.StatusID}\n`;
            apiDebug += `   StatusID value: ${updateData.StatusID}\n\n`;
            apiDebug += '4. WHERE CLAUSE:\n';
            apiDebug += `   Using ProjectID=${projectId} to find record\n`;
            
            alert(apiDebug);
            
            await this.caspioService.put<any>(updateUrl, updateData).toPromise();
            
            // Update local project object
            this.project.StatusID = 1;
            this.isReadOnly = false; // Make sure project is editable now
            console.log('🔍 DEBUG: Project status updated to Active (StatusID = 1)');
            await this.showToast('Project moved to Active status', 'success');
            
            // Debug: Confirm update
            alert(`SUCCESS - Status Update Complete:\n\nProject ${projectId} (PK_ID: ${projectPkId})\nStatusID updated to: ${this.project.StatusID}`);
          } catch (error: any) {
            console.error('Error updating project status:', error);
            
            // Detailed error debug
            let errorDebug = '=== STATUS UPDATE FAILED ===\n\n';
            errorDebug += '1. ERROR MESSAGE:\n';
            errorDebug += `   ${error.message || error}\n\n`;
            
            if (error.error) {
              errorDebug += '2. ERROR DETAILS:\n';
              errorDebug += `   ${JSON.stringify(error.error, null, 2)}\n\n`;
            }
            
            if (error.status) {
              errorDebug += '3. HTTP STATUS:\n';
              errorDebug += `   ${error.status} ${error.statusText || ''}\n\n`;
            }
            
            errorDebug += '4. ATTEMPTED UPDATE:\n';
            errorDebug += `   ProjectID: ${projectId}\n`;
            errorDebug += `   PK_ID: ${projectPkId}\n`;
            errorDebug += `   Tried to set StatusID to: 1\n`;
            
            alert(errorDebug);
            // Continue with service creation even if status update fails
          }
        } else {
          console.error('No PK_ID available for status update');
          
          let noIdDebug = '=== NO PROJECT ID AVAILABLE ===\n\n';
          noIdDebug += 'Project object:\n';
          noIdDebug += `PK_ID: ${this.project?.PK_ID}\n`;
          noIdDebug += `ProjectID: ${this.project?.ProjectID}\n`;
          noIdDebug += '\nCannot update status without project ID';
          
          alert(noIdDebug);
        }
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

  async addAdditionalService() {
    // Navigate to a new project page with this project's ID but in active mode
    // This allows adding services to completed projects
    const projectId = this.project?.PK_ID || this.project?.ProjectID;
    if (projectId) {
      // Navigate with add-service mode
      this.router.navigate(['/project', projectId], {
        queryParams: { mode: 'add-service' },
        state: { project: this.project }
      });
      
      // Temporarily enable editing
      this.isReadOnly = false;
      await this.showToast('Select services to add. Project will be moved to Active status.', 'info');
      
      // After a short delay, show the services grid
      setTimeout(() => {
        // Scroll to services section
        const servicesSection = document.querySelector('.info-section:nth-child(2)');
        if (servicesSection) {
          servicesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 500);
    }
  }

  getServiceCount(offersId: string): number {
    return this.selectedServices.filter(s => s.offersId === offersId).length;
  }

  getServiceInstanceNumber(service: ServiceSelection): number {
    const sameTypeServices = this.selectedServices.filter(s => s.offersId === service.offersId);
    return sameTypeServices.findIndex(s => s.instanceId === service.instanceId) + 1;
  }

  getServicesForTemplates(): ServiceSelection[] {
    // Filter out services that don't need templates
    return this.selectedServices.filter(service => {
      const name = service.typeName?.toLowerCase() || '';
      // Exclude Defect Cost Report and Engineers Inspection Review
      return !name.includes('defect cost report') && 
             !name.includes('engineers inspection review') &&
             !name.includes('engineer\'s inspection review');
    });
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
    // Store existing manually added documents before rebuilding
    const existingManualDocs: Map<string, DocumentItem[]> = new Map();
    for (const serviceDoc of this.serviceDocuments) {
      const manualDocs = serviceDoc.documents.filter(doc => {
        // Check if this is a manually added document
        // It won't have a templateId, or it's not in the templates
        const isFromTemplate = this.attachTemplates.some(t => 
          t.TypeID === parseInt(serviceDoc.typeId) && 
          t.Title === doc.title
        );
        // Only documents not from templates are considered manual
        return !isFromTemplate;
      });
      if (manualDocs.length > 0) {
        console.log(`📝 Preserving manual docs for ${serviceDoc.serviceName}:`, manualDocs.map(d => d.title));
        existingManualDocs.set(serviceDoc.serviceId, manualDocs);
      }
    }
    
    console.log('🔄 DEBUG: Starting loadRequiredDocumentsFromAttach');
    console.log('  - Selected services count:', this.selectedServices.length);
    console.log('  - Previous serviceDocuments count:', this.serviceDocuments.length);
    console.log('  - Manual docs preserved:', Array.from(existingManualDocs.entries()).map(([id, docs]) => ({ serviceId: id, count: docs.length })));
    
    this.serviceDocuments = [];
    
    for (const service of this.selectedServices) {
      console.log(`  📋 Processing service: ${service.typeName} (ID: ${service.serviceId})`);
      
      // Get ALL templates for this service type (both required and optional)
      const requiredTemplates = this.attachTemplates.filter(t => 
        t.TypeID === parseInt(service.typeId) && 
        (t.Required === 'Yes' || t.Required === true || t.Required === 1)
      );
      
      const documents: DocumentItem[] = [];
      
      // Documents come ONLY from the Templates table lookup
      console.log(`🔍 Loading documents from Templates table for service: "${service.typeName}"`);
      console.log(`  - Templates found: ${requiredTemplates.length}`);
      
      // Add documents ONLY from templates in the database
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
      }
      // NO FALLBACK - only use templates from database
      
      // Create the service document group
      const serviceDocGroup = {
        serviceId: service.serviceId || service.instanceId,
        serviceName: service.typeName,
        typeId: service.typeId,
        instanceNumber: this.getServiceInstanceNumber(service),
        documents: documents
      };
      
      console.log(`📋 Service document group for ${service.typeName}:`, {
        serviceId: serviceDocGroup.serviceId,
        documentCount: documents.length,
        documentTitles: documents.map(d => d.title),
        fromTemplates: requiredTemplates.length > 0
      });
      
      // Add back any manually added documents AND check for their attachments
      const manualDocs = existingManualDocs.get(serviceDocGroup.serviceId);
      if (manualDocs) {
        console.log(`📋 Adding back ${manualDocs.length} manual docs to ${service.typeName}`);
        // Check if any of these manual docs now have attachments
        for (const manualDoc of manualDocs) {
          // Find ALL attachments for this type and title - EXACT match on title
          const attachments = this.existingAttachments.filter(a => 
            a.TypeID === parseInt(service.typeId) && 
            a.Title === manualDoc.title  // Exact match on the document title
          );
          
          if (attachments.length > 0) {
            console.log(`  ✓ Manual doc "${manualDoc.title}" has ${attachments.length} attachment(s)`);
            // Update the manual doc with attachment info
            manualDoc.attachId = attachments[0].AttachID;
            manualDoc.uploaded = true;
            manualDoc.filename = attachments[0].Link;
            manualDoc.linkName = attachments[0].Link;
            manualDoc.attachmentUrl = attachments[0].Attachment;
            manualDoc.additionalFiles = attachments.slice(1).map(a => ({
              attachId: a.AttachID,
              linkName: a.Link,
              attachmentUrl: a.Attachment
            }));
          } else {
            console.log(`  - Manual doc "${manualDoc.title}" has no attachments yet`);
          }
        }
        serviceDocGroup.documents.push(...manualDocs);
      }
      
      // Also check for any attachments that don't match template or default documents
      // These could be manually added docs that were uploaded
      // Build a Set of titles that are already accounted for
      const accountedTitles = new Set(serviceDocGroup.documents.map(d => d.title));
      
      console.log(`📊 Documents already accounted for in ${service.typeName}:`, Array.from(accountedTitles));
      console.log(`📎 Existing attachments for TypeID ${service.typeId}:`, 
        this.existingAttachments
          .filter(a => a.TypeID === parseInt(service.typeId))
          .map(a => ({ Title: a.Title, AttachID: a.AttachID }))
      );
      
      // Find orphan attachments - those that aren't already in our documents list
      const orphanAttachments = this.existingAttachments.filter(a => {
        // Must match the TypeID
        if (a.TypeID !== parseInt(service.typeId)) return false;
        
        // Check if this title is already accounted for in the documents
        // This prevents duplicates when a document is uploaded
        if (accountedTitles.has(a.Title)) {
          // Already have a document with this title, don't add as orphan
          return false;
        }
        
        // This attachment's title is not in our documents list, it's an orphan
        return true;
      });
      
      // Group orphan attachments by title
      const orphansByTitle = new Map<string, any[]>();
      for (const orphan of orphanAttachments) {
        if (!orphansByTitle.has(orphan.Title)) {
          orphansByTitle.set(orphan.Title, []);
        }
        orphansByTitle.get(orphan.Title)?.push(orphan);
      }
      
      console.log(`🔍 Orphan attachments found:`, Array.from(orphansByTitle.keys()));
      
      // Add orphan documents (only truly orphaned ones)
      for (const [title, attachments] of orphansByTitle.entries()) {
        // This should never happen since we already filtered by accountedTitles above
        // but double-check to be safe
        if (!accountedTitles.has(title)) {
          console.log(`📎 Adding orphan document: "${title}" with ${attachments.length} file(s)`);
          const docItem: DocumentItem = {
            attachId: attachments[0].AttachID,
            title: title,  // Use the actual title from the attachment
            required: false,
            uploaded: true,
            filename: attachments[0].Link,
            linkName: attachments[0].Link,
            attachmentUrl: attachments[0].Attachment,
            additionalFiles: attachments.slice(1).map(a => ({
              attachId: a.AttachID,
              linkName: a.Link,
              attachmentUrl: a.Attachment
            }))
          } as any;
          serviceDocGroup.documents.push(docItem);
          
          // Add to accountedTitles to prevent duplicates in next iteration
          accountedTitles.add(title);
        } else {
          console.log(`⚠️ ERROR: Should not happen - "${title}" was supposed to be filtered out as not orphan!`);
        }
      }
      
      // Check for duplicate service documents before adding
      const existingServiceDocIndex = this.serviceDocuments.findIndex(
        sd => sd.serviceId === serviceDocGroup.serviceId && 
             sd.serviceName === serviceDocGroup.serviceName
      );
      
      if (existingServiceDocIndex >= 0) {
        console.log(`⚠️ DEBUG: Duplicate service doc found for ${serviceDocGroup.serviceName} (ID: ${serviceDocGroup.serviceId})`);
        console.log('  - Existing docs:', this.serviceDocuments[existingServiceDocIndex].documents.length);
        console.log('  - New docs:', serviceDocGroup.documents.length);
        // Replace the existing one instead of adding duplicate
        this.serviceDocuments[existingServiceDocIndex] = serviceDocGroup;
      } else {
        this.serviceDocuments.push(serviceDocGroup);
      }
    }
    
    console.log('📄 DEBUG: Final serviceDocuments count:', this.serviceDocuments.length);
    console.log('  - Service documents:', this.serviceDocuments.map(sd => ({
      name: sd.serviceName,
      id: sd.serviceId,
      docs: sd.documents.length,
      docTitles: sd.documents.map(d => d.title)
    })));
    
    // Check for duplicate documents within each service
    for (const sd of this.serviceDocuments) {
      const titles = sd.documents.map(d => d.title);
      const duplicates = titles.filter((title, index) => titles.indexOf(title) !== index);
      if (duplicates.length > 0) {
        console.error(`❌ DUPLICATE DOCUMENTS in ${sd.serviceName}:`, duplicates);
      }
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
        
        // Remove popup - proceed directly with upload
        // await this.showAttachmentDataPopup(attachData, file, serviceId);
        
        // Show loading immediately
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
          message: 'Loading documents...'
        });
        await loading.present();
        
        // Collect all images for this document (main + additional files)
        const allImages: Array<{
          url: string;
          title: string;
          filename: string;
          attachId?: string;
        }> = [];
        
        // Get the main attachment
        console.log('📸 Loading attachment with ID:', doc.attachId);
        const attachment = await this.caspioService.getAttachmentWithImage(doc.attachId).toPromise();
        
        if (attachment && attachment.Attachment) {
          console.log('✅ Got attachment URL, length:', attachment.Attachment?.length);
          allImages.push({
            url: attachment.Attachment,
            title: doc.title,
            filename: doc.linkName || doc.filename || 'document',
            attachId: doc.attachId  // Keep the original attachId
          });
        } else {
          console.error('❌ No attachment URL received for ID:', doc.attachId);
        }
        
        // Get additional files if any
        if (doc.additionalFiles && doc.additionalFiles.length > 0) {
          for (const additionalFile of doc.additionalFiles) {
            if (additionalFile.attachId) {
              try {
                const addAttachment = await this.caspioService.getAttachmentWithImage(additionalFile.attachId).toPromise();
                if (addAttachment && addAttachment.Attachment) {
                  allImages.push({
                    url: addAttachment.Attachment,
                    title: `${doc.title} - Additional`,
                    filename: additionalFile.linkName || 'additional',
                    attachId: additionalFile.attachId  // Keep the additional file's attachId
                  });
                }
              } catch (err) {
                console.error('Error loading additional file:', err);
              }
            }
          }
        }
        
        await loading.dismiss();
        
        if (allImages.length > 0) {
          
          // Use the new multiple images mode with save callback
          const modal = await this.modalController.create({
            component: ImageViewerComponent,
            componentProps: {
              images: allImages,
              initialIndex: 0,
              onSaveAnnotation: async (attachId: string, blob: Blob, filename: string) => {
                return await this.caspioService.updateAttachmentImage(attachId, blob, filename);
              }
            }
          });
          await modal.present();
        } else {
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
    // Find the parent document that contains this additional file
    let parentDoc: DocumentItem | null = null;
    let additionalFileIndex = 0;
    
    // Search through all service documents to find the parent
    for (const serviceDoc of this.serviceDocuments) {
      for (const doc of serviceDoc.documents) {
        if (doc.additionalFiles) {
          const index = doc.additionalFiles.findIndex(af => af.attachId === additionalFile.attachId);
          if (index !== -1) {
            parentDoc = doc;
            additionalFileIndex = index + 1; // +1 because main doc is at index 0
            break;
          }
        }
      }
      if (parentDoc) break;
    }
    
    if (parentDoc && parentDoc.attachId) {
      // Use the main viewDocument method but with initial index set to the additional file
      try {
        const loading = await this.loadingController.create({
          message: 'Loading documents...'
        });
        await loading.present();
        
        // Collect all images for this document (main + additional files)
        const allImages: Array<{
          url: string;
          title: string;
          filename: string;
          attachId?: string;
        }> = [];
        
        // Get the main attachment
        const attachment = await this.caspioService.getAttachmentWithImage(parentDoc.attachId).toPromise();
        
        if (attachment && attachment.Attachment) {
          allImages.push({
            url: attachment.Attachment,
            title: parentDoc.title,
            filename: parentDoc.linkName || parentDoc.filename || 'document',
            attachId: parentDoc.attachId  // Keep the original attachId
          });
        }
        
        // Get additional files if any
        if (parentDoc.additionalFiles && parentDoc.additionalFiles.length > 0) {
          for (const addFile of parentDoc.additionalFiles) {
            if (addFile.attachId) {
              try {
                const addAttachment = await this.caspioService.getAttachmentWithImage(addFile.attachId).toPromise();
                if (addAttachment && addAttachment.Attachment) {
                  allImages.push({
                    url: addAttachment.Attachment,
                    title: `${parentDoc.title} - Additional`,
                    filename: addFile.linkName || 'additional',
                    attachId: addFile.attachId  // Keep the additional file's attachId
                  });
                }
              } catch (err) {
                console.error('Error loading additional file:', err);
              }
            }
          }
        }
        
        await loading.dismiss();
        
        if (allImages.length > 0) {
          
          // Open viewer starting at the selected additional file with save callback
          const modal = await this.modalController.create({
            component: ImageViewerComponent,
            componentProps: {
              images: allImages,
              initialIndex: additionalFileIndex,
              onSaveAnnotation: async (attachId: string, blob: Blob, filename: string) => {
                return await this.caspioService.updateAttachmentImage(attachId, blob, filename);
              }
            }
          });
          await modal.present();
        } else {
          await this.showToast('Document data not available', 'warning');
        }
      } catch (error) {
        console.error('Error loading document:', error);
        await this.showToast('Failed to load document', 'danger');
      }
    } else {
      // Fallback to single image mode if parent not found
      if (additionalFile.attachId) {
        try {
          const loading = await this.loadingController.create({
            message: 'Loading document...'
          });
          await loading.present();
          
          const attachment = await this.caspioService.getAttachmentWithImage(additionalFile.attachId).toPromise();
          
          if (attachment && attachment.Attachment) {
            const modal = await this.modalController.create({
              component: ImageViewerComponent,
              componentProps: {
                images: [{
                  url: attachment.Attachment,
                  title: 'Additional File',
                  filename: additionalFile.linkName,
                  attachId: additionalFile.attachId
                }],
                initialIndex: 0,
                onSaveAnnotation: async (attachId: string, blob: Blob, filename: string) => {
                  return await this.caspioService.updateAttachmentImage(attachId, blob, filename);
                }
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

  async addCustomDocument(documentName: string) {
    if (!this.selectedServiceDoc || !documentName || !documentName.trim()) return;
    
    // Add custom document to the service's document list
    this.selectedServiceDoc.documents.push({
      title: documentName.trim(),
      required: false,
      uploaded: false,
      templateId: undefined  // No template for custom documents
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
  async openTemplate(service: ServiceSelection, event?: Event) {
    // Prevent any event bubbling
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    if (service.serviceId) {
      // Remove debounce check to allow immediate navigation
      
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
        
      try {
        // Determine navigation URL first
        let navigationUrl: string;
        
        if (isEngineersFoundation) {
          console.log('✅ Navigating to Engineers Foundation template');
          navigationUrl = `/engineers-foundation/${this.projectId}/${service.serviceId}`;
          console.log('   Route:', navigationUrl);
        } else {
          console.log('📝 Navigating to standard template form');
          navigationUrl = `/template-form/${this.projectId}/${service.serviceId}`;
          console.log('   Route:', navigationUrl);
        }
        
        // Navigate immediately without any blocking
        await this.router.navigateByUrl(navigationUrl, { replaceUrl: false });
        console.log('Navigation triggered');
        
      } catch (error) {
        console.error('Navigation error:', error);
      }
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

  getPropertyPhotoUrl(): string {
    // Check if project has a PrimaryPhoto
    if (this.project && this.project['PrimaryPhoto']) {
      // If PrimaryPhoto starts with '/', it's a Caspio file
      if (this.project['PrimaryPhoto'].startsWith('/')) {
        const account = localStorage.getItem('caspioAccount') || '';
        const token = localStorage.getItem('caspioToken') || '';
        return `https://${account}.caspio.com/rest/v2/files${this.project['PrimaryPhoto']}?access_token=${token}`;
      }
      // Otherwise return as-is (could be a full URL)
      return this.project['PrimaryPhoto'];
    }
    
    // Fall back to Google Street View
    if (!this.project || !this.formatAddress()) {
      return 'assets/img/project-placeholder.svg';
    }
    const address = encodeURIComponent(this.formatAddress());
    const apiKey = 'AIzaSyCOlOYkj3N8PT_RnoBkVJfy2BSfepqqV3A';
    return `https://maps.googleapis.com/maps/api/streetview?size=400x200&location=${address}&key=${apiKey}`;
  }
  
  getStreetViewUrl(): string {
    // Keep for backwards compatibility
    return this.getPropertyPhotoUrl();
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

  // Replace property photo functionality
  async replacePhoto() {
    if (this.photoInput && this.photoInput.nativeElement) {
      this.photoInput.nativeElement.click();
    }
  }

  async onPhotoSelected(event: any) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Projects table uses PK_ID as primary key for updates
    const projectId = this.project?.PK_ID;
    const projectAddress = this.project?.Address || 'Unknown';
    
    // Show debug popup
    const debugAlert = await this.alertController.create({
      header: 'Debug: Photo Upload',
      message: `
        <strong>Project Details:</strong><br>
        • Project ID (PK_ID): ${this.project?.PK_ID || 'N/A'}<br>
        • Project ID (ProjectID): ${this.project?.ProjectID || 'N/A'}<br>
        • Using PK_ID for update: ${projectId}<br>
        • Address: ${projectAddress}<br><br>
        <strong>File Details:</strong><br>
        • Name: ${file.name}<br>
        • Size: ${(file.size / 1024).toFixed(2)} KB<br>
        • Type: ${file.type}<br>
      `,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Upload',
          handler: async () => {
            await this.performPhotoUpload(file, projectId);
          }
        }
      ]
    });
    await debugAlert.present();
  }
  
  private async performPhotoUpload(file: File, projectId: any) {
    if (!projectId) {
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'No project ID available. Cannot update photo.',
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Uploading photo...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Upload photo to Caspio Files API
      const account = localStorage.getItem('caspioAccount') || '';
      const token = localStorage.getItem('caspioToken') || '';
      
      // Generate unique filename
      const timestamp = Date.now();
      const fileName = `property_${projectId}_${timestamp}.jpg`;
      
      // Upload to Caspio Files API using PROVEN METHOD from CLAUDE.md
      const formData = new FormData();
      formData.append('file', file, fileName);
      
      console.log('Uploading to Caspio Files API...');
      const uploadResponse = await fetch(`https://${account}.caspio.com/rest/v2/files`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      
      console.log('Upload response status:', uploadResponse.status);
      
      // Read response text once
      const responseText = await uploadResponse.text();
      console.log('Upload response text:', responseText);
      
      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.status} - ${responseText}`);
      }
      
      // Parse the response
      let uploadResult;
      try {
        if (!responseText) {
          throw new Error('Empty response from server');
        }
        
        uploadResult = JSON.parse(responseText);
      } catch (e: any) {
        console.error('Failed to parse response:', e);
        throw new Error(`Failed to parse upload response: ${e?.message || 'Unknown error'}`);
      }
      
      // Get the file path from response
      const photoPath = uploadResult.Name ? `/${uploadResult.Name}` : null;
      if (!photoPath) {
        throw new Error('No file name in upload response');
      }
      
      console.log('File uploaded successfully, path:', photoPath);
      
      // Update the Projects table with the new photo path using PK_ID
      console.log(`Updating Projects table (PK_ID: ${projectId}) with PrimaryPhoto:`, photoPath);
      
      // Show debug popup before update
      await this.showToast(`Updating PK_ID: ${projectId} with path: ${photoPath}`, 'info');
      
      const updateResponse = await this.caspioService.updateProject(projectId, {
        PrimaryPhoto: photoPath
      }).toPromise();
      
      console.log('Update response:', updateResponse);
      
      // Update local project data
      if (this.project) {
        this.project['PrimaryPhoto'] = photoPath;
      }
      
      await loading.dismiss();
      
      // Show success with details
      const successAlert = await this.alertController.create({
        header: 'Success',
        message: `Photo updated successfully!<br><br>
          <strong>Updated Record:</strong><br>
          • Project PK_ID: ${projectId}<br>
          • PrimaryPhoto Path: ${photoPath}`,
        buttons: ['OK']
      });
      await successAlert.present();
      
      // Clear the file input
      if (this.photoInput && this.photoInput.nativeElement) {
        this.photoInput.nativeElement.value = '';
      }
      
    } catch (error: any) {
      console.error('Error uploading photo:', error);
      await loading.dismiss();
      
      const alert = await this.alertController.create({
        header: 'Upload Failed',
        message: `Failed to upload photo.<br><br>
          <strong>Error Details:</strong><br>
          ${error.message || error}`,
        buttons: ['OK']
      });
      await alert.present();
    }
  }
}