import { Component, OnInit, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ProjectsService, Project } from '../../services/projects.service';
import { CaspioService } from '../../services/caspio.service';
import { IonModal, ToastController, AlertController, LoadingController, ModalController } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { ImageViewerComponent } from '../../components/image-viewer/image-viewer.component';
import { DocumentViewerComponent } from '../../components/document-viewer/document-viewer.component';
import { ImageCompressionService } from '../../services/image-compression.service';
import { PdfPreviewComponent } from '../../components/pdf-preview/pdf-preview.component';
import { EngineersFoundationDataService } from '../engineers-foundation/engineers-foundation-data.service';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

interface ServiceSelection {
  instanceId: string;
  serviceId?: string; // PK_ID from Services table
  offersId: string;
  typeId: string;
  typeName: string;
  typeIcon?: string; // Icon path from Types table
  typeIconUrl?: string; // Base64 data URL for the icon
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

interface PdfVisualCategory {
  name: string;
  comments: any[];
  limitations: any[];
  deficiencies: any[];
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
  private readonly googleMapsApiKey = environment.googleMapsApiKey;
  
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
    private modalController: ModalController,
    private changeDetectorRef: ChangeDetectorRef,
    private imageCompression: ImageCompressionService,
    private foundationData: EngineersFoundationDataService
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
          this.fetchProjectOptimized();
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
      this.fetchProjectOptimized();
    }
  }

  async fetchProjectOptimized() {
    this.loading = true;
    this.error = '';

    try {
      // First get the project data to determine the actual ProjectID
      console.log('📍 Loading project with ID:', this.projectId);
      const projectData = await this.projectsService.getProjectById(this.projectId).toPromise();

      if (!projectData) {
        console.error('❌ No project data returned for ID:', this.projectId);
        this.error = 'Failed to load project';
        this.loading = false;

        // Show debug alert on mobile
        await this.showDebugAlert('Project Load Error',
          `No project found with ID: ${this.projectId}\n\nPlease check if the project exists and you have permission to access it.`);
        return;
      }

      this.project = projectData;
      console.log('✅ Project loaded:', projectData);

      const actualProjectId = projectData?.ProjectID || this.projectId;
      const statusId = projectData?.StatusID;
      const isCompletedProject = this.isCompletedStatus(statusId);
      const isAddServiceMode = this.route.snapshot.queryParams['mode'] === 'add-service';
      this.isReadOnly = isCompletedProject && !isAddServiceMode;

      // Now load everything else with individual error handling
      let offers: any, types: any, services: any, attachTemplates: any, existingAttachments: any;

      try {
        console.log('📍 Loading offers for company 1...');
        offers = await this.caspioService.getOffersByCompany('1').toPromise();
      } catch (error) {
        console.error('❌ Failed to load offers:', error);
        await this.showDebugAlert('Offers Load Error', `Failed to load offers: ${error}`);
      }

      try {
        console.log('📍 Loading service types...');
        types = await this.caspioService.getServiceTypes().toPromise();
      } catch (error) {
        console.error('❌ Failed to load types:', error);
      }

      try {
        console.log('📍 Loading existing services...');
        services = await this.caspioService.getServicesByProject(actualProjectId).toPromise();
      } catch (error) {
        console.error('❌ Failed to load services:', error);
      }

      try {
        console.log('📍 Loading attach templates...');
        attachTemplates = await this.caspioService.getAttachTemplates().toPromise();
      } catch (error) {
        console.error('❌ Failed to load attach templates:', error);
      }

      try {
        console.log('📍 Loading existing attachments...');
        existingAttachments = await this.caspioService.getAttachmentsByProject(actualProjectId).toPromise();
      } catch (error) {
        console.error('❌ Failed to load attachments:', error);
      }

      // Process offers and types
      this.availableOffers = (offers || []).map((offer: any) => {
        const type = (types || []).find((t: any) => t.PK_ID === offer.TypeID || t.TypeID === offer.TypeID);
        return {
          ...offer,
          TypeName: type?.TypeName || type?.Type || offer.Service_Name || offer.Description || 'Unknown Service',
          TypeShort: type?.TypeShort || '',
          TypeIcon: type?.Icon || '',
          TypeIconUrl: ''  // Will be loaded asynchronously
        };
      });

      // Load icon images asynchronously like Engineers Foundation does
      this.loadIconImages();

      // Process existing services
      this.selectedServices = (services || []).map((service: any) => {
        const offer = this.availableOffers.find(o => o.TypeID == service.TypeID);
        return {
          instanceId: `${service.PK_ID || service.ServiceID}_${Date.now()}_${Math.random()}`,
          serviceId: service.PK_ID || service.ServiceID,
          offersId: offer?.OffersID || offer?.PK_ID || '',
          typeId: service.TypeID,
          typeName: offer?.TypeName || 'Unknown Service',
          typeIcon: offer?.TypeIcon || '',
          typeIconUrl: offer?.TypeIconUrl || '',  // Use the loaded base64 URL
          dateOfInspection: service.DateOfInspection || service.InspectionDate || new Date().toISOString()
        };
      });

      // Process attach templates
      this.attachTemplates = attachTemplates || [];

      // Process existing attachments
      this.existingAttachments = existingAttachments || [];

      // Update documents
      this.updateDocumentsList();

      // Load PrimaryPhoto if needed (async, don't wait)
      if (this.project?.['PrimaryPhoto'] && this.project['PrimaryPhoto'].startsWith('/')) {
        this.loadProjectImageData();
      }

      this.loading = false;
      this.loadingServices = false;

    } catch (error: any) {
      console.error('❌ Error in fetchProjectOptimized:', error);

      // Detailed debug alert for mobile
      const errorDetails = `Error loading project:\n\nProject ID: ${this.projectId}\n\nError: ${error?.message || error}\n\nStatus: ${error?.status}\n\nDetails: ${JSON.stringify(error?.error || error)}`;
      await this.showDebugAlert('Project Load Error', errorDetails);

      this.error = 'Failed to load project';
      this.loading = false;
      this.loadingServices = false;
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
        
        // Determine if the project has been completed (StatusID = 2)
        // StatusID: 1 = Active, 2 = Completed, 3 = Cancelled, 4 = On Hold
        const statusId = project.StatusID;
        const isCompletedProject = this.isCompletedStatus(statusId);
        
        // Check if we're in add-service mode (which overrides read-only)
        const queryParams = this.route.snapshot.queryParams;
        if (queryParams['mode'] === 'add-service') {
          this.isReadOnly = false;
          console.log('Add-service mode: Project editable despite StatusID:', statusId);
        } else {
          this.isReadOnly = isCompletedProject;
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


  private isCompletedStatus(status: any): boolean {
    if (status === null || status === undefined) {
      return false;
    }

    if (typeof status === 'number') {
      return status === 2;
    }

    if (typeof status === 'string') {
      return status.trim() === '2';
    }

    return false;
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
          TypeName: type?.TypeName || type?.Type || offer.Service_Name || offer.Description || 'Unknown Service',
          TypeShort: type?.TypeShort || '',
          TypeIcon: type?.Icon || ''
        };
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
          typeIcon: offer?.TypeIcon || '',
          dateOfInspection: service.DateOfInspection || new Date().toISOString()
        };
      });
      
      console.log('✅ Existing services loaded and matched with offers:', this.selectedServices);

      // Trigger progress calculation for Engineers Foundation services
      let foundEngineersFoundation = false;
      this.selectedServices.forEach(service => {
        if (service.typeName === 'Engineers Foundation Evaluation' && service.serviceId) {
          foundEngineersFoundation = true;
          // Show toast that we're calculating
          this.showToast(`Calculating progress for Engineers Foundation...`, 'info');

          // Pre-calculate progress to populate cache
          this.calculateEngineersFoundationProgress(service).then(progress => {
            const cacheKey = `${this.projectId}_${service.serviceId}`;
            this.templateProgressCache[cacheKey] = {
              progress,
              timestamp: Date.now()
            };
            // Trigger change detection to update the view
            this.changeDetectorRef.detectChanges();

            // Show result in toast
            this.showToast(`Engineers Foundation progress: ${progress}%`, 'success');
          }).catch(error => {
            this.showToast(`Error calculating progress: ${error.message}`, 'danger');
          });
        }
      });

      if (!foundEngineersFoundation) {
        console.log('No Engineers Foundation services found');
      }

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
    if (this.isReadOnly) {
      return;
    }
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
    if (this.isReadOnly) {
      return;
    }
    const isSelected = this.isServiceSelected(offer.OffersID);
    if (isSelected) {
      await this.removeAllServiceInstances(offer.OffersID);
    } else {
      await this.addService(offer);
    }
  }

  async addService(offer: any) {
    if (this.isReadOnly) {
      return;
    }
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
      
      // Log debug info without showing alert
      console.log(`Add Service Check - Mode: ${currentMode}, Project exists: ${!!this.project}, Should update status: ${currentMode === 'add-service' && !!this.project}`);
      
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
        
        console.log(debugInfo);
        
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
            
            console.log(apiDebug);
            
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
            
            console.error(errorDebug);
            // Continue with service creation even if status update fails
          }
        } else {
          console.error('No PK_ID available for status update');
          
          let noIdDebug = '=== NO PROJECT ID AVAILABLE ===\n\n';
          noIdDebug += 'Project object:\n';
          noIdDebug += `PK_ID: ${this.project?.PK_ID}\n`;
          noIdDebug += `ProjectID: ${this.project?.ProjectID}\n`;
          noIdDebug += '\nCannot update status without project ID';
          
          console.error(noIdDebug);
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
        typeIcon: offer.TypeIcon || '',
        typeIconUrl: offer.TypeIconUrl || '',  // Include the pre-loaded base64 icon
        dateOfInspection: serviceData.DateOfInspection
      };
      
      console.log('🔍 DEBUG: Adding selection to selectedServices:', selection);
      
      this.selectedServices.push(selection);
      this.updateDocumentsList();
      
      console.log('✅ Service added successfully');
      // Success toast removed per user request
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
    if (this.isReadOnly) {
      return;
    }
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
    if (this.isReadOnly) {
      return;
    }
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
      
      // Success toast removed per user request
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
    if (this.isReadOnly) {
      return;
    }
    const services = this.selectedServices.filter(s => s.offersId === offersId);
    for (const service of services) {
      await this.performRemoveService(service);
    }
  }

  async duplicateService(offersId: string, typeName: string) {
    if (this.isReadOnly) {
      return;
    }
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
    const filtered = this.selectedServices.filter(service => {
      const name = service.typeName?.toLowerCase() || '';
      // Exclude Defect Cost Report and Engineers Inspection Review
      return !name.includes('defect cost report') &&
             !name.includes('engineers inspection review') &&
             !name.includes('engineer\'s inspection review');
    });

    // Debug: Show first service icon data

    return filtered;
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
    // Store ALL pending (non-uploaded) documents before rebuilding
    const pendingDocs: Map<string, DocumentItem[]> = new Map();
    for (const serviceDoc of this.serviceDocuments) {
      const pending = serviceDoc.documents.filter(doc => !doc.uploaded);
      if (pending.length > 0) {
        console.log(`📝 Preserving pending docs for ${serviceDoc.serviceName}:`, pending.map(d => d.title));
        pendingDocs.set(serviceDoc.serviceId, pending);
      }
    }
    
    console.log('🔄 DEBUG: Starting loadRequiredDocumentsFromAttach');
    console.log('  - Selected services count:', this.selectedServices.length);
    console.log('  - Previous serviceDocuments count:', this.serviceDocuments.length);
    console.log('  - Pending docs preserved:', Array.from(pendingDocs.entries()).map(([id, docs]) => ({ serviceId: id, count: docs.length })));
    
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
      
      // Create the service document group (but don't set documents yet)
      const serviceDocGroup = {
        serviceId: service.serviceId || service.instanceId,
        serviceName: service.typeName,
        typeId: service.typeId,
        instanceNumber: this.getServiceInstanceNumber(service),
        documents: [] as DocumentItem[]  // Will set this after all documents are added
      };

      console.log(`📋 Processing documents for ${service.typeName}:`, {
        serviceId: serviceDocGroup.serviceId,
        documentCount: documents.length,
        documentTitles: documents.map(d => d.title),
        fromTemplates: requiredTemplates.length > 0
      });

      // Add back any pending documents and check if they've been uploaded
      const pending = pendingDocs.get(serviceDocGroup.serviceId);
      if (pending) {
        console.log(`📋 Adding back ${pending.length} pending docs to ${service.typeName}`);
        // Add all pending documents back to the list
        for (const pendingDoc of pending) {
          // Check if this pending document has now been uploaded
          const uploadedAttachment = this.existingAttachments.find(a =>
            a.TypeID === parseInt(service.typeId) &&
            a.Title === pendingDoc.title
          );

          if (uploadedAttachment) {
            // Document has been uploaded! Update it with attachment info
            console.log(`✅ Pending doc "${pendingDoc.title}" has been uploaded`);
            const updatedDoc = {
              ...pendingDoc,
              uploaded: true,
              attachId: uploadedAttachment.AttachID,
              filename: uploadedAttachment.Link,
              linkName: uploadedAttachment.Link,
              attachmentUrl: uploadedAttachment.Attachment
            };
            documents.push(updatedDoc);
          } else {
            // Still pending, add as-is if not already in the list
            const exists = documents.some(d => d.title === pendingDoc.title);
            if (!exists) {
              documents.push(pendingDoc);
            }
          }
        }
      }
      
      // Also check for any attachments that don't match template or default documents
      // These could be manually added docs that were uploaded
      // Build a Set of titles that are already accounted for - need to rebuild after adding pending docs
      const accountedTitles = new Set(documents.map(d => d.title));
      
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
          documents.push(docItem);

          // Add to accountedTitles to prevent duplicates in next iteration
          accountedTitles.add(title);
        } else {
          console.log(`⚠️ ERROR: Should not happen - "${title}" was supposed to be filtered out as not orphan!`);
        }
      }
      
      // Now that all documents are collected, set them on the service doc group
      serviceDocGroup.documents = documents;

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

  async deleteRequiredDocument(serviceId: string, doc: DocumentItem) {
    // Show confirmation
    const confirm = await this.alertController.create({
      header: 'Delete Document',
      message: `Are you sure you want to delete "${doc.linkName || doc.filename}"?`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          cssClass: 'danger-button',
          handler: async () => {
            const loading = await this.loadingController.create({
              message: 'Deleting document...'
            });
            await loading.present();

            try {
              // Delete the attachment record
              if (doc.attachId) {
                await this.caspioService.deleteAttachment(doc.attachId).toPromise();
              }
              
              // Clear the document data
              doc.uploaded = false;
              doc.attachId = undefined;
              doc.filename = undefined;
              doc.linkName = undefined;
              
              await loading.dismiss();
              
              // Refresh the project to ensure consistency
              await this.loadProject();
            } catch (error) {
              console.error('Error deleting document:', error);
              await loading.dismiss();
              await this.showToast('Failed to delete document', 'danger');
            }
          }
        }
      ]
    });
    await confirm.present();
  }

  async removePendingDocument(serviceId: string, doc: DocumentItem) {
    // Find the service in serviceDocuments and remove the pending document
    const serviceDoc = this.serviceDocuments.find(sd => sd.serviceId === serviceId);
    if (serviceDoc) {
      const index = serviceDoc.documents.indexOf(doc);
      if (index > -1) {
        serviceDoc.documents.splice(index, 1);
      }
    }
  }

  async deleteAdditionalFile(serviceId: string, additionalFile: any) {
    // Show confirmation
    const confirm = await this.alertController.create({
      header: 'Delete Document',
      message: `Are you sure you want to delete "${additionalFile.linkName}"?`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          cssClass: 'danger-button',
          handler: async () => {
            const loading = await this.loadingController.create({
              message: 'Deleting document...'
            });
            await loading.present();

            try {
              // Delete the attachment record
              await this.caspioService.deleteAttachment(additionalFile.attachId).toPromise();
              
              // Remove from local data
              for (const serviceDoc of this.serviceDocuments) {
                for (const doc of serviceDoc.documents) {
                  if (doc.additionalFiles) {
                    const index = doc.additionalFiles.findIndex(af => af.attachId === additionalFile.attachId);
                    if (index !== -1) {
                      doc.additionalFiles.splice(index, 1);
                      break;
                    }
                  }
                }
              }
              
              await loading.dismiss();
            } catch (error) {
              console.error('Error deleting document:', error);
              await loading.dismiss();
              await this.showToast('Failed to delete document', 'danger');
            }
          }
        }
      ]
    });
    await confirm.present();
  }

  async viewDocument(doc: DocumentItem) {
    // If doc has an attachId, fetch the actual file from Caspio
    if (doc.attachId) {
      try {
        let cancelled = false;

        // Create loading alert with cancel button
        const loading = await this.alertController.create({
          header: 'Loading Document',
          message: 'Loading document...',
          buttons: [
            {
              text: 'Cancel',
              role: 'cancel',
              handler: () => {
                console.log('Document loading cancelled by user');
                cancelled = true;
                return true; // Allow dismissal
              }
            }
          ],
          backdropDismiss: false
        });
        await loading.present();

        // Set up the cancel flag only if user clicks cancel
        loading.onDidDismiss().then((result) => {
          // Only mark as cancelled if the user clicked the cancel button
          if (result.role === 'cancel' || result.data === 'cancelled') {
            cancelled = true;
          }
        });

        // Get the main attachment
        console.log('📄 Loading attachment with ID:', doc.attachId);
        const attachmentPromise = this.caspioService.getAttachmentWithImage(doc.attachId).toPromise();

        // Wait for the attachment to load
        const attachment = await attachmentPromise.catch(error => {
          console.error('Error loading attachment:', error);
          return null;
        });

        // Dismiss the loading dialog
        try {
          await loading.dismiss();
        } catch (e) {
          // Already dismissed
        }

        // If cancelled or failed, return early
        if (cancelled) {
          console.log('Document loading was cancelled by user');
          return;
        }

        if (!attachment) {
          await this.showToast('Failed to load document', 'danger');
          return;
        }

        if (attachment && attachment.Attachment) {
          const filename = doc.linkName || doc.filename || 'document';
          const fileUrl = attachment.Attachment;
          
          // Check if it's a PDF based on filename or data URL
          const isPDF = filename.toLowerCase().includes('.pdf') || 
                       fileUrl.toLowerCase().includes('application/pdf') ||
                       fileUrl.toLowerCase().includes('.pdf');
          
          if (isPDF) {
            console.log('📑 Opening PDF with DocumentViewerComponent');
            // Use DocumentViewerComponent for PDFs
            const modal = await this.modalController.create({
              component: DocumentViewerComponent,
              componentProps: {
                fileUrl: fileUrl,
                fileName: filename,
                fileType: 'pdf',
                filePath: doc.linkName || doc.filename
              },
              cssClass: 'fullscreen-modal'
            });
            await modal.present();
          } else {
            console.log('🖼️ Opening image with ImageViewerComponent');
            // Show ONLY this single document/image
            const modal = await this.modalController.create({
              component: ImageViewerComponent,
              componentProps: {
                images: [{
                  url: fileUrl,
                  title: doc.title,
                  filename: filename,
                  attachId: doc.attachId
                }],
                initialIndex: 0,
                onSaveAnnotation: async (attachId: string, blob: Blob, fname: string) => {
                  return await this.caspioService.updateAttachmentImage(attachId, blob, fname);
                }
              }
            });
            await modal.present();
          }
        } else {
          console.error('❌ No attachment URL received for ID:', doc.attachId);
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
    // View ONLY the selected additional document
    if (additionalFile && additionalFile.attachId) {
      try {
        let cancelled = false;

        // Create loading alert with cancel button
        const loading = await this.alertController.create({
          header: 'Loading Document',
          message: 'Loading document...',
          buttons: [
            {
              text: 'Cancel',
              role: 'cancel',
              handler: () => {
                console.log('Document loading cancelled by user');
                cancelled = true;
                return true; // Allow dismissal
              }
            }
          ],
          backdropDismiss: false
        });
        await loading.present();

        // Set up the cancel flag only if user clicks cancel
        loading.onDidDismiss().then((result) => {
          // Only mark as cancelled if the user clicked the cancel button
          if (result.role === 'cancel' || result.data === 'cancelled') {
            cancelled = true;
          }
        });

        // Get only this specific attachment
        const attachmentPromise = this.caspioService.getAttachmentWithImage(additionalFile.attachId).toPromise();

        // Wait for the attachment to load
        const attachment = await attachmentPromise.catch(error => {
          console.error('Error loading attachment:', error);
          return null;
        });

        // Dismiss the loading dialog
        try {
          await loading.dismiss();
        } catch (e) {
          // Already dismissed
        }

        // If cancelled or failed, return early
        if (cancelled) {
          console.log('Document loading was cancelled by user');
          return;
        }

        if (!attachment) {
          await this.showToast('Failed to load document', 'danger');
          return;
        }

        if (attachment && attachment.Attachment) {
          const filename = additionalFile.linkName || 'document';
          const fileUrl = attachment.Attachment;
          
          // Check if it's a PDF based on filename or data URL
          const isPDF = filename.toLowerCase().includes('.pdf') || 
                       fileUrl.toLowerCase().includes('application/pdf') ||
                       fileUrl.toLowerCase().includes('.pdf');
          
          if (isPDF) {
            console.log('📑 Opening PDF with DocumentViewerComponent');
            // Use DocumentViewerComponent for PDFs
            const modal = await this.modalController.create({
              component: DocumentViewerComponent,
              componentProps: {
                fileUrl: fileUrl,
                fileName: filename,
                fileType: 'pdf',
                filePath: additionalFile.linkName
              },
              cssClass: 'fullscreen-modal'
            });
            await modal.present();
          } else {
            console.log('🖼️ Opening image with ImageViewerComponent');
            // For images, show only this single image
            const modal = await this.modalController.create({
              component: ImageViewerComponent,
              componentProps: {
                images: [{
                  url: fileUrl,
                  title: 'Additional Document',
                  filename: filename,
                  attachId: additionalFile.attachId
                }],
                initialIndex: 0,
                onSaveAnnotation: async (attachId: string, blob: Blob, fname: string) => {
                  return await this.caspioService.updateAttachmentImage(attachId, blob, fname);
                }
              }
            });
            await modal.present();
          }
        } else {
          console.error('❌ No attachment URL received for ID:', additionalFile.attachId);
          await this.showToast('Document data not available', 'warning');
        }
      } catch (error) {
        console.error('Error loading additional document:', error);
        await this.showToast('Error loading document', 'error');
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

  handleTemplateClick(service: ServiceSelection, event?: Event): void {
    if (this.isReadOnly) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      this.generatePDFForService(service);
      return;
    }

    this.openTemplate(service, event);
  }
  private async openPdfDocumentForService(service: ServiceSelection): Promise<boolean> {
    const serviceDocGroup = this.serviceDocuments.find(sd => sd.serviceId === service.serviceId);
    if (!serviceDocGroup) {
      return false;
    }

    const mainPdf = serviceDocGroup.documents.find(doc => this.documentLooksLikePdf(doc));
    if (mainPdf) {
      await this.viewDocument(mainPdf);
      return true;
    }

    for (const doc of serviceDocGroup.documents) {
      const pdfAdditional = doc.additionalFiles?.find(file => this.additionalFileLooksLikePdf(file));
      if (pdfAdditional) {
        await this.viewAdditionalDocument(pdfAdditional);
        return true;
      }
    }

    return false;
  }

  private documentLooksLikePdf(doc: DocumentItem | undefined): boolean {
    if (!doc) {
      return false;
    }

    if (this.stringLooksLikePdf(doc.linkName) || this.stringLooksLikePdf(doc.filename) || this.stringLooksLikePdf(doc.attachmentUrl)) {
      return true;
    }

    if (doc.title && doc.title.toLowerCase().includes('pdf')) {
      return true;
    }

    return false;
  }

  private additionalFileLooksLikePdf(file: any): boolean {
    if (!file) {
      return false;
    }

    return this.stringLooksLikePdf(file.linkName) || this.stringLooksLikePdf(file.attachmentUrl);
  }

  private stringLooksLikePdf(value?: string | null): boolean {
    if (!value) {
      return false;
    }

    const lower = value.toLowerCase();
    return lower.endsWith('.pdf') || lower.includes('.pdf') || lower.includes('application/pdf');
  }

  // Template navigation - Fixed double-click issue
  openTemplate(service: ServiceSelection, event?: Event, options?: { openPdf?: boolean }) {
    // Prevent any event bubbling
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }

    // Navigate immediately without any checks
    if (!service.serviceId) {
      console.log('No serviceId, cannot navigate');
      return;
    }

    // Convert typeId to string for consistent comparison
    const typeIdStr = String(service.typeId);

    const openPdf = this.isReadOnly || !!options?.openPdf;

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

    // Check for HUD template - typically includes "HUD" or "Manufactured" in the name
    const isHUDTemplate =
      service.typeName?.toLowerCase().includes('hud') ||
      service.typeName?.toLowerCase().includes('manufactured') ||
      service.typeName?.toLowerCase().includes('mobile home');

    // Navigate immediately - remove all blocking checks
    if (isHUDTemplate) {
      console.log('🏠 Navigating to HUD template - IMMEDIATE');
      const url = `/hud-template/${this.projectId}/${service.serviceId}`;
      const extras: any = { replaceUrl: false };
      if (openPdf) {
        extras.queryParams = { openPdf: '1' };
      }

      // Use Angular router; fallback to direct navigation with query param if needed
      this.router.navigate(['hud-template', this.projectId, service.serviceId], extras).catch(error => {
        console.error('Router navigation failed, using fallback:', error);
        const finalUrl = openPdf ? `${url}?openPdf=1` : url;
        window.location.assign(finalUrl);
      });
    } else if (isEngineersFoundation) {
      console.log('✅ Navigating to Engineers Foundation template - IMMEDIATE');
      // Force navigation with location.assign for immediate response
      const url = `/engineers-foundation/${this.projectId}/${service.serviceId}`;
      const extras: any = { replaceUrl: false };
      if (openPdf) {
        extras.queryParams = { openPdf: '1' };
      }

      this.router.navigate(['engineers-foundation', this.projectId, service.serviceId], extras).catch(error => {
        console.error('Router navigation failed, using fallback:', error);
        const finalUrl = openPdf ? `${url}?openPdf=1` : url;
        window.location.assign(finalUrl);
      });
    } else {
      console.log('📝 Navigating to standard template form');
      const extras: any = { replaceUrl: false };
      if (openPdf) {
        extras.queryParams = { openPdf: '1' };
      }
      this.router.navigate(['template-form', this.projectId, service.serviceId], extras).catch(error => {
        console.error('Router navigation to template-form failed:', error);
        const url = `/template-form/${this.projectId}/${service.serviceId}`;
        const finalUrl = openPdf ? `${url}?openPdf=1` : url;
        window.location.assign(finalUrl);
      });
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

  private projectImageData: string | null = null;
  private imageLoadInProgress = false;

  getPropertyPhotoUrl(): string {
    // Check if project has a PrimaryPhoto
    if (this.project && this.project['PrimaryPhoto']) {
      const primaryPhoto = this.project['PrimaryPhoto'];
      console.log('🖼️ PrimaryPhoto value:', primaryPhoto);
      
      // If we already have the base64 data, use it
      if (this.projectImageData) {
        return this.projectImageData;
      }
      
      // If it's already a data URL or http URL, use it directly
      if (primaryPhoto.startsWith('data:') || primaryPhoto.startsWith('http')) {
        return primaryPhoto;
      }
      
      // If PrimaryPhoto starts with '/', it's a Caspio file
      if (primaryPhoto.startsWith('/')) {
        // Start loading if not already in progress
        if (!this.imageLoadInProgress) {
          this.loadProjectImageData();
        }
        
        // Return placeholder while loading
        return 'assets/img/photo-loading.svg';
      } else {
        console.log('⚠️ Unknown photo format:', primaryPhoto);
        this.showToast(`Debug: Unknown photo format: ${primaryPhoto}`, 'warning');
      }
    } else {
      console.log('📸 No PrimaryPhoto found in project data');
    }
    
    // Fall back to Google Street View
    if (!this.project || !this.formatAddress()) {
      console.log('📸 Using placeholder image');
      return 'assets/img/project-placeholder.svg';
    }
    const address = encodeURIComponent(this.formatAddress());
    const streetViewUrl = `https://maps.googleapis.com/maps/api/streetview?size=400x200&location=${address}&key=${this.googleMapsApiKey}`;
    console.log('📸 Using Street View:', streetViewUrl);
    return streetViewUrl;
  }
  
  async loadProjectImageData() {
    if (!this.project || !this.project['PrimaryPhoto'] || this.imageLoadInProgress) {
      return;
    }
    
    const primaryPhoto = this.project['PrimaryPhoto'];
    if (!primaryPhoto.startsWith('/')) {
      return;
    }
    
    this.imageLoadInProgress = true;
    
    try {
      // Use the same method as Structural Systems - fetch as base64 data URL
      console.log(`Loading project image from Files API: ${primaryPhoto}`);
      const imageData = await this.caspioService.getImageFromFilesAPI(primaryPhoto).toPromise();
      
      if (imageData && imageData.startsWith('data:')) {
        // Store the base64 data
        this.projectImageData = imageData;
        console.log('✅ Project image loaded successfully');
        
        // Trigger change detection to update the view
        this.changeDetectorRef.detectChanges();
      } else {
        console.log('⚠️ Invalid image data received');
        // Use fallback
        const address = this.formatAddress();
        if (address) {
          const encodedAddress = encodeURIComponent(address);
          this.projectImageData = `https://maps.googleapis.com/maps/api/streetview?size=400x300&location=${encodedAddress}&key=${this.googleMapsApiKey}`;
        } else {
          this.projectImageData = 'assets/img/project-placeholder.svg';
        }
      }
    } catch (error) {
      console.error('Error loading project image:', error);
      // Show user-friendly error
      await this.showToast('Unable to load project image', 'warning');
      
      // Use fallback on error
      const address = this.formatAddress();
      if (address) {
        const encodedAddress = encodeURIComponent(address);
        this.projectImageData = `https://maps.googleapis.com/maps/api/streetview?size=400x300&location=${encodedAddress}&key=${this.googleMapsApiKey}`;
      } else {
        this.projectImageData = 'assets/img/project-placeholder.svg';
      }
    } finally {
      this.imageLoadInProgress = false;
    }
  }

  getStreetViewUrl(): string {
    // Keep for backwards compatibility
    return this.getPropertyPhotoUrl();
  }
  
  async onPhotoError(event: any) {
    const errorUrl = event.target.src;
    
    // Don't show error for placeholder/loading images - these are expected
    if (errorUrl.includes('photo-loading.svg') || 
        errorUrl.includes('project-placeholder.svg')) {
      // Just set fallback silently
      event.target.src = 'assets/img/project-placeholder.svg';
      return;
    }
    
    // If it's a data URL that failed, silently use fallback (shouldn't happen but just in case)
    if (errorUrl.startsWith('data:')) {
      event.target.src = 'assets/img/project-placeholder.svg';
      return;
    }
    
    // If it's a Google Street View URL that failed, use placeholder
    if (errorUrl.includes('maps.googleapis.com/maps/api/streetview')) {
      event.target.src = 'assets/img/project-placeholder.svg';
      return;
    }
    
    // Only log real errors (not placeholders)
    console.error('❌ Photo failed to load:', event.target.src);
    
    // Set fallback image
    event.target.src = 'assets/img/project-placeholder.svg';
    
    // Don't show alerts in production - too intrusive
    return;
    
    /* Commented out for production
    // Parse the URL to show debug information
    if (errorUrl.includes('caspio.com')) {
      const urlParts = errorUrl.split('?');
      const baseUrl = urlParts[0];
      const hasToken = urlParts[1] && urlParts[1].includes('access_token');
      const tokenValue = urlParts[1]?.split('access_token=')[1];
      
      // Extract file path
      const pathMatch = baseUrl.match(/\/files(.+)$/);
      const filePath = pathMatch ? pathMatch[1] : 'Unknown';
      
      // Create debug text for copying
      const currentToken = this.caspioService.getCurrentToken();
      const isSameToken = tokenValue && currentToken && tokenValue.substring(0, 20) === currentToken.substring(0, 20);
      
      const debugText = `Image Load Failed Debug Info:
File Path: ${filePath}
Has Token: ${hasToken ? 'Yes' : 'No'}
Token Length: ${tokenValue?.length || 0}
Account: ${this.caspioService.getAccountID()}
Current Token: ${this.caspioService.getCurrentToken() ? 'Present' : 'Missing'}
Tokens Match: ${isSameToken ? 'Yes' : 'No'}
PrimaryPhoto Value: ${this.project?.['PrimaryPhoto'] || 'Not set'}
Full URL: ${errorUrl}

Troubleshooting:
- Check if file exists in Caspio Files section
- Verify token is still valid (not expired)
- Ensure file permissions are correct`;

      // Show detailed debug alert
      const alert = await this.alertController.create({
        header: 'Image Load Failed',
        message: `
          <strong>File Path:</strong> ${filePath}<br>
          <strong>Has Token:</strong> ${hasToken ? 'Yes' : 'No'}<br>
          <strong>Token Length:</strong> ${tokenValue?.length || 0}<br>
          <strong>Account:</strong> ${this.caspioService.getAccountID()}<br>
          <strong>Current Token:</strong> ${this.caspioService.getCurrentToken() ? 'Present' : 'Missing'}<br>
          <strong>Tokens Match:</strong> ${isSameToken ? 'Yes' : 'No'}<br>
          <strong>PrimaryPhoto Value:</strong> ${this.project?.['PrimaryPhoto'] || 'Not set'}<br>
          <br>
          <strong style="color: #ff9800;">Possible Issues:</strong><br>
          • File may not exist in Caspio<br>
          • Token may be expired<br>
          • File permissions issue<br>
          <br>
          <strong>Full URL (first 150 chars):</strong><br>
          ${errorUrl.substring(0, 150)}...
        `,
        buttons: [
          {
            text: 'Copy Debug Info',
            handler: () => {
              // Copy to clipboard
              if (navigator.clipboard) {
                navigator.clipboard.writeText(debugText).then(() => {
                  this.showToast('Debug info copied to clipboard', 'success');
                }).catch(() => {
                  // Fallback for older browsers/WebView
                  const textArea = document.createElement('textarea');
                  textArea.value = debugText;
                  document.body.appendChild(textArea);
                  textArea.select();
                  document.execCommand('copy');
                  document.body.removeChild(textArea);
                  this.showToast('Debug info copied to clipboard', 'success');
                });
              } else {
                // Fallback for older browsers/WebView
                const textArea = document.createElement('textarea');
                textArea.value = debugText;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                this.showToast('Debug info copied to clipboard', 'success');
              }
              return false; // Keep alert open
            }
          },
          {
            text: 'Try Fresh Token',
            handler: () => {
              this.caspioService.getValidToken().subscribe(async token => {
                if (token) {
                  await this.showToast('Got fresh token, reloading...', 'success');
                  // Force a re-render
                  const tempProject = this.project;
                  this.project = null;
                  setTimeout(() => {
                    this.project = tempProject;
                  }, 100);
                }
              });
            }
          },
          {
            text: 'OK',
            role: 'cancel'
          }
        ]
      });
      await alert.present();
    } else {
      // Non-Caspio URL error
      await this.showToast(`Image load failed: ${errorUrl.substring(0, 50)}...`, 'danger');
    }
    
    // Set a fallback image
    event.target.src = 'assets/img/project-placeholder.svg';
    */
  }

  getCompanyName(): string {
    if (!this.project) return 'Not specified';

    // Company ID to name mapping
    const companyIDToName: { [key: number]: string } = {
      1: 'Noble Property Inspections'
      // Add more companies here as needed
    };

    const companyId = Number(this.project.CompanyID || this.project.Company_ID);
    if (companyId && companyIDToName[companyId]) {
      return companyIDToName[companyId];
    }

    // If no mapping found, return a default or the ID itself
    return companyId ? `Company ${companyId}` : 'Not specified';
  }

  getCityStateZip(): string {
    if (!this.project) return 'Not specified';

    // State ID to abbreviation mapping
    const stateIDToAbbreviation: { [key: number]: string } = {
      1: 'TX',    // Texas
      2: 'GA',    // Georgia
      3: 'FL',    // Florida
      4: 'CO',    // Colorado
      6: 'CA',    // California
      7: 'AZ',    // Arizona
      8: 'SC',    // South Carolina
      9: 'TN'     // Tennessee
    };
    
    // Build the City, State Zip string
    let result = '';
    
    // Add City
    if (this.project.City) {
      result = this.project.City;
    }
    
    // Add State (with comma if city exists)
    // First check if State field exists, otherwise use StateID
    let stateAbbr = this.project.State;
    if (!stateAbbr && this.project.StateID) {
      stateAbbr = stateIDToAbbreviation[this.project.StateID];
    }
    
    if (stateAbbr) {
      if (result) {
        result += ', ' + stateAbbr;
      } else {
        result = stateAbbr;
      }
    }
    
    // Add Zip (with space if city or state exists)
    if (this.project.Zip) {
      if (result) {
        result += ' ' + this.project.Zip;
      } else {
        result = this.project.Zip;
      }
    }
    
    return result || 'Not specified';
  }
  
  // Keeping old method for backwards compatibility if used elsewhere
  getCityState(): string {
    return this.getCityStateZip();
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

  // Cache for template progress to avoid repeated API calls
  private templateProgressCache: { [key: string]: { progress: number; timestamp: number } } = {};
  private readonly CACHE_DURATION = 60000; // 1 minute cache

  async loadIconImages() {
    // Load icon images asynchronously using the same method as Engineers Foundation template
    for (const offer of this.availableOffers) {
      if (offer.TypeIcon && offer.TypeIcon.startsWith('/')) {
        try {
          // Use the same getImageFromFilesAPI method that Engineers Foundation uses for thumbnails
          const imageData = await this.caspioService.getImageFromFilesAPI(offer.TypeIcon).toPromise();
          if (imageData && imageData.startsWith('data:')) {
            // Store the base64 data URL
            offer.TypeIconUrl = imageData;

            // Update any existing services that use this offer
            this.selectedServices.forEach(service => {
              if (service.typeId === offer.TypeID) {
                service.typeIconUrl = imageData;
              }
            });
          }
        } catch (error) {
          console.error(`Failed to load icon for ${offer.TypeName}:`, error);
        }
      }
    }
  }

  getIconUrl(iconPath: string): string {
    // This method is no longer needed - we'll use the pre-loaded base64 URLs instead
    return '';
  }

  getTemplateProgress(service: any): number {
    // For Engineers Foundation Evaluation, check actual data completion
    if (service.typeName === 'Engineers Foundation Evaluation' && service.serviceId) {
      // Check cache first
      const cacheKey = `${this.projectId}_${service.serviceId}`;
      const cached = this.templateProgressCache[cacheKey];
      const now = Date.now();

      if (cached && (now - cached.timestamp) < this.CACHE_DURATION) {
        return cached.progress;
      }

      // Start async calculation but return cached or default immediately
      this.calculateEngineersFoundationProgress(service).then(progress => {
        this.templateProgressCache[cacheKey] = { progress, timestamp: now };
        // Trigger change detection to update the view
        this.changeDetectorRef.detectChanges();
      }).catch(error => {
        console.error('Error calculating template progress:', error);
      });

      // Return cached value or 0 while loading
      return cached?.progress || 0;
    }

    // Default progress values for other service types (for demo purposes)
    const serviceProgress: { [key: string]: number } = {
      'Home Inspection Report': 75,
      'Roof Inspection': 20,
      'HVAC Assessment': 90,
      'Electrical Inspection': 45,
      'Plumbing Inspection': 60
    };

    // Return the progress for this service, or 0 if not found
    return serviceProgress[service.typeName] || 0;
  }

  private async calculateEngineersFoundationProgress(service: any): Promise<number> {
    try {
      if (!service.serviceId) {
        return 0;
      }

      let debugInfo = `Service ID: ${service.serviceId}\n\n`;
      let projectProgress = 0;
      let structuralProgress = 0;
      let elevationProgress = 0;

      // 1. Check project information completion
      const serviceData: any = await this.caspioService.get(
        `/tables/Services/records?q.where=PK_ID=${service.serviceId}`
      ).toPromise();

      if (serviceData?.ResultSet?.[0]) {
        const record = serviceData.ResultSet[0];
        const requiredFields = ['DateOfInspection', 'FirstFoundationType'];
        let filledFields = 0;

        for (const field of requiredFields) {
          if (record[field] && record[field] !== '') {
            filledFields++;
          }
        }

        projectProgress = requiredFields.length > 0 ?
          Math.round((filledFields / requiredFields.length) * 100) : 100;
        debugInfo += `Project: ${filledFields}/${requiredFields.length} fields = ${projectProgress}%\n`;
      } else {
        debugInfo += `Project: No service record found = 0%\n`;
      }

      // 2. Check structural systems completion
      const visualsData: any = await this.caspioService.get(
        `/tables/Services_Visuals/records?q.where=ServiceID=${service.serviceId}`
      ).toPromise();

      if (visualsData?.ResultSet && visualsData.ResultSet.length > 0) {
        structuralProgress = Math.min(100, visualsData.ResultSet.length * 10);
        debugInfo += `Structural: ${visualsData.ResultSet.length} visuals = ${structuralProgress}%\n`;
      } else {
        debugInfo += `Structural: No visuals found = 0%\n`;
      }

      // 3. Check elevation plot completion
      const roomsData: any = await this.caspioService.get(
        `/tables/Services_Rooms/records?q.where=ServiceID=${service.serviceId}`
      ).toPromise();

      if (roomsData?.ResultSet && roomsData.ResultSet.length > 0) {
        elevationProgress = Math.min(100, roomsData.ResultSet.length * 20);
        debugInfo += `Elevation: ${roomsData.ResultSet.length} rooms = ${elevationProgress}%\n`;
      } else {
        debugInfo += `Elevation: No rooms found = 0%\n`;
      }

      // Calculate average
      const sections = [projectProgress, structuralProgress, elevationProgress];
      const average = Math.round(sections.reduce((sum, val) => sum + val, 0) / sections.length);
      debugInfo += `\nAverage: ${average}%`;

      // Show debug alert
      const alert = await this.alertController.create({
        header: 'Progress Debug Info',
        message: debugInfo.replace(/\n/g, '<br>'),
        buttons: ['OK']
      });
      await alert.present();

      return average;
    } catch (error) {
      console.error('Error calculating template progress:', error);
      // Fall back to localStorage method if API fails
      const storageKey = `template_progress_${this.projectId}_${service.serviceId}`;
      const storedProgress = localStorage.getItem(storageKey);

      if (storedProgress) {
        const progress = JSON.parse(storedProgress);
        const projectProgress = progress.project || 0;
        const structuralProgress = progress.structural || 0;
        const elevationProgress = progress.elevation || 0;

        const sections = [projectProgress, structuralProgress, elevationProgress];
        return Math.round(sections.reduce((sum, val) => sum + val, 0) / sections.length);
      }

      return 0;
    }
  }

  private isTemplateComplete(service: ServiceSelection): boolean {
    if (!service) {
      return false;
    }

    return this.getTemplateProgress(service) >= 100;
  }

  private async showIncompleteTemplateAlert(): Promise<void> {
    const alert = await this.alertController.create({
      header: "Incomplete Template",
      message: "Please complete required fields before generating the report.",
      buttons: ["OK"]
    });

    await alert.present();
  }

  private generateInstanceId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async showDebugAlert(title: string, message: string) {
    const alert = await this.alertController.create({
      header: title,
      message: message.replace(/\n/g, '<br>'),
      buttons: [
        {
          text: 'Copy Debug Info',
          handler: () => {
            if (navigator.clipboard) {
              navigator.clipboard.writeText(message);
            }
            return false;
          }
        },
        {
          text: 'OK',
          role: 'cancel'
        }
      ]
    });
    await alert.present();
  }

  onIconError(event: any, service: any) {
    // This should rarely be called now since we're using pre-loaded base64 URLs
    console.error('Icon failed to load for service:', service.typeName);
    event.target.style.display = 'none'; // Hide broken image
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
    
    // Start upload immediately without confirmation
    await this.performPhotoUpload(file, projectId);
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
      // Copy EXACT method from Structural Systems that works
      console.log('📦 Using proven two-step upload method for Projects table');
      console.log('====== PROJECTS TABLE ======');
      console.log('PK_ID: Primary Key for updates');
      console.log('PrimaryPhoto: File field (stores path)');
      console.log('=============================');
      
      // Get account from CaspioService (it extracts from environment)
      const account = this.caspioService.getAccountID();
      
      // Get token through CaspioService to ensure it's valid and handle refresh if needed
      let token: string;
      try {
        const tokenResult = await this.caspioService.getValidToken().toPromise();
        if (!tokenResult) {
          throw new Error('Token is null or undefined');
        }
        token = tokenResult;
        console.log('✅ Got valid token from CaspioService');
      } catch (tokenError) {
        console.error('❌ Failed to get valid token:', tokenError);
        throw new Error('Failed to get authentication token. Please logout and login again.');
      }
      
      // Debug: Check authentication
      console.log('🔐 Authentication Check:');
      console.log('  Account:', account || 'MISSING!');
      console.log('  Token obtained via:', 'CaspioService.getValidToken()');
      console.log('  Token exists:', !!token);
      console.log('  Token length:', token?.length || 0);
      console.log('  Token first 20 chars:', token ? token.substring(0, 20) + '...' : 'N/A');
      
      if (!account || !token) {
        throw new Error(`Authentication missing: Account: ${account}, Token exists: ${!!token}. Unable to authenticate with Caspio.`);
      }
      
      // Debug: Check file
      console.log('📄 File Info:');
      console.log('  Type:', file.type);
      console.log('  Size:', file.size, 'bytes');
      console.log('  Name:', file.name);
      
      // Generate unique filename
      const timestamp = Date.now();
      const fileName = `property_${projectId}_${timestamp}.jpg`;
      console.log('  New filename:', fileName);
      
      // STEP 1: Compress the image before upload
      console.log('Step 1: Compressing image before upload...');
      const compressedFile = await this.imageCompression.compressImage(file, {
        maxSizeMB: 1.5,
        maxWidthOrHeight: 1920,
        useWebWorker: true
      });
      console.log(`Image compressed: ${(file.size / 1024).toFixed(1)}KB -> ${(compressedFile.size / 1024).toFixed(1)}KB`);
      
      // STEP 2: Upload compressed file to Caspio Files API (PROVEN WORKING)
      console.log('Step 2: Uploading compressed file to Caspio Files API...');
      
      // No toast - just proceed with upload
      const formData = new FormData();
      formData.append('file', compressedFile, fileName);
      
      const filesUrl = `https://${account}.caspio.com/rest/v2/files`;
      console.log('Uploading to Files API:', filesUrl);
      
      // Add more detailed request logging
      console.log('📡 Making Files API Request:');
      console.log('  URL:', filesUrl);
      console.log('  Method: PUT');
      console.log('  Auth header:', `Bearer ${token.substring(0, 20)}...`);
      console.log('  File in FormData:', fileName);
      
      const uploadResponse = await fetch(filesUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`
          // NO Content-Type header - let browser set it with boundary
        },
        body: formData
      });
      
      console.log('Files API response status:', uploadResponse.status);
      console.log('Files API response headers:', uploadResponse.headers);
      console.log('Files API response statusText:', uploadResponse.statusText);
      
      // Get response text first for debugging
      const responseText = await uploadResponse.text();
      console.log('Files API raw response:', responseText);
      
      if (!uploadResponse.ok) {
        console.error('Files API error:', responseText);
        
        // More detailed error for common issues
        if (uploadResponse.status === 401) {
          throw new Error(`Authentication failed (401): Token may be expired. Please logout and login again.`);
        } else if (uploadResponse.status === 403) {
          throw new Error(`Permission denied (403): Check if Files API is enabled for your account.`);
        } else if (uploadResponse.status === 413) {
          throw new Error(`File too large (413): Please use a smaller image.`);
        } else {
          throw new Error(`Files API failed: ${uploadResponse.status} - ${responseText}`);
        }
      }
      
      // Try to parse the response as JSON
      let uploadResult: any;
      try {
        uploadResult = JSON.parse(responseText);
      } catch (parseError) {
        console.log('Response is not JSON, treating as string:', responseText);
        uploadResult = responseText;
      }
      
      console.log('Files API parsed response:', uploadResult);
      
      // Handle different possible response formats from Files API
      let uploadedFileName: string;
      
      // Check different possible property names for the filename
      if (uploadResult.Name) {
        uploadedFileName = uploadResult.Name;
      } else if (uploadResult.name) {
        uploadedFileName = uploadResult.name;
      } else if (uploadResult.fileName) {
        uploadedFileName = uploadResult.fileName;
      } else if (uploadResult.FileName) {
        uploadedFileName = uploadResult.FileName;
      } else if (typeof uploadResult === 'string') {
        // Sometimes the API returns just the filename as a string
        uploadedFileName = uploadResult;
      } else if (uploadResult.Result && uploadResult.Result.Name) {
        uploadedFileName = uploadResult.Result.Name;
      } else {
        // If we can't find the filename in the response, use the original filename
        console.warn('Could not find filename in Files API response, using original:', fileName);
        uploadedFileName = fileName;
      }
      
      console.log('Extracted filename from response:', uploadedFileName);
      
      // STEP 2: Update Projects table with the file path
      const filePath = `/${uploadedFileName}`;
      console.log('Step 2: Updating Projects table with file path:', filePath);
      console.log('Using PK_ID:', projectId);
      
      // Use the service method which handles the update properly
      const updateResponse = await this.caspioService.updateProject(projectId, {
        PrimaryPhoto: filePath
      }).toPromise();
      
      console.log('✅ Successfully updated PrimaryPhoto for project:', projectId);
      console.log('Update response:', updateResponse);
      
      // Update local project data immediately
      if (this.project) {
        this.project['PrimaryPhoto'] = filePath;
        console.log('✅ Updated local project data with new photo path:', filePath);
        
        // Clear the cached image data to force reload
        this.projectImageData = null;
        this.imageLoadInProgress = false;
        
        // Trigger change detection to refresh the image immediately
        this.changeDetectorRef.detectChanges();
        
        // Start loading the new image
        if (filePath.startsWith('/')) {
          this.loadProjectImageData();
        }
      }
      
      await loading.dismiss();
      
      // Show simple success toast
      await this.showToast('Photo updated successfully', 'success');
      
      // Clear the file input
      if (this.photoInput && this.photoInput.nativeElement) {
        this.photoInput.nativeElement.value = '';
      }
      
    } catch (error: any) {
      console.error('Error uploading photo:', error);
      await loading.dismiss();
      
      // Comprehensive debug popup
      let debugInfo = {
        stage: 'Unknown',
        projectId: projectId,
        account: this.caspioService.getAccountID(),
        tokenExists: !!localStorage.getItem('caspio_token'),
        tokenLength: localStorage.getItem('caspio_token')?.length || 0,
        fileName: '',
        filePath: '',
        errorMessage: error?.message || 'No message',
        errorStatus: error?.status || 'No status',
        errorResponse: '',
        fullError: JSON.stringify(error, null, 2),
        timestamp: new Date().toISOString()
      };
      
      // Try to determine at which stage the error occurred
      if (error.message?.includes('Files API')) {
        debugInfo.stage = 'File Upload to Caspio Files';
      } else if (error.message?.includes('Update')) {
        debugInfo.stage = 'Updating Projects Table';
      } else if (error.message?.includes('token')) {
        debugInfo.stage = 'Authentication';
      }
      
      // Try to parse error response if available
      if (error.response) {
        try {
          debugInfo.errorResponse = await error.response.text();
        } catch {
          debugInfo.errorResponse = 'Could not read response';
        }
      }
      
      const alert = await this.alertController.create({
        header: '🔴 Upload Failed - Debug Info',
        message: `
          <div style="font-size: 12px; text-align: left; max-height: 400px; overflow-y: auto;">
            <strong style="color: red;">Stage:</strong> ${debugInfo.stage}<br><br>
            
            <strong>Project Info:</strong><br>
            • Project ID (PK_ID): ${debugInfo.projectId}<br>
            • Account: ${debugInfo.account}<br>
            • Token Exists: ${debugInfo.tokenExists ? '✅ Yes' : '❌ No'}<br>
            • Token Length: ${debugInfo.tokenLength} chars<br><br>
            
            <strong>Error Details:</strong><br>
            • Message: ${debugInfo.errorMessage}<br>
            • Status: ${debugInfo.errorStatus}<br><br>
            
            <strong>Full Error Object:</strong><br>
            <pre style="background: #f0f0f0; padding: 8px; border-radius: 4px; white-space: pre-wrap; word-wrap: break-word;">
${debugInfo.fullError}
            </pre>
            
            <strong>Response (if any):</strong><br>
            <pre style="background: #ffe0e0; padding: 8px; border-radius: 4px; white-space: pre-wrap; word-wrap: break-word;">
${debugInfo.errorResponse || 'No response body'}
            </pre>
            
            <strong>Time:</strong> ${debugInfo.timestamp}<br><br>
            
            <strong style="color: blue;">Common Issues:</strong><br>
            • Token expired → Re-login<br>
            • Wrong account → Check caspioAccount in storage<br>
            • File too large → Try smaller image<br>
            • Network issue → Check connection<br>
            • PrimaryPhoto field type → Must be File type in Caspio
          </div>
        `,
        cssClass: 'debug-alert',
        buttons: [
          {
            text: 'Copy Debug Info',
            handler: () => {
              // Create a simple text version for copying
              const textVersion = `
Upload Failed - Debug Info
==========================
Stage: ${debugInfo.stage}
Project ID: ${debugInfo.projectId}
Account: ${debugInfo.account}
Token Exists: ${debugInfo.tokenExists}
Token Length: ${debugInfo.tokenLength}
Error Message: ${debugInfo.errorMessage}
Error Status: ${debugInfo.errorStatus}
Full Error: ${debugInfo.fullError}
Response: ${debugInfo.errorResponse}
Time: ${debugInfo.timestamp}
              `;
              
              // Try to copy to clipboard (may not work on all devices)
              if (navigator.clipboard) {
                navigator.clipboard.writeText(textVersion);
                this.showToast('Debug info copied to clipboard', 'success');
              }
              return false; // Keep alert open
            }
          },
          {
            text: 'OK',
            role: 'cancel'
          }
        ]
      });
      await alert.present();
    }
  }

  async generateServicePDF() {
    const templateServices = this.getServicesForTemplates();
    const savedServices = templateServices.filter(service => !!service.serviceId);

    if ((!templateServices || templateServices.length === 0) && (!savedServices || savedServices.length === 0)) {
      await this.showToast('No templates available for PDF generation', 'warning');
      return;
    }

    if (savedServices.length === 0) {
      await this.showToast('Save the template service before generating a PDF', 'warning');
      return;
    }

    if (savedServices.length === 1) {
      const singleService = savedServices[0];

      if (!this.isReadOnly && !this.isTemplateComplete(singleService)) {
        await this.showIncompleteTemplateAlert();
        return;
      }

      await this.generatePDFForService(singleService);
      return;
    }

    const alert = await this.alertController.create({
      header: 'Select Template',
      message: 'Choose a template to open its PDF report.',
      inputs: savedServices.map((service, index) => ({
        type: 'radio',
        label: `${service.typeName} - ${this.formatDate(service.dateOfInspection)}`,
        value: index,
        checked: index === 0
      })),
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Open PDF',
          handler: async (selectedIndex) => {
            const index = typeof selectedIndex === 'number' ? selectedIndex : parseInt(String(selectedIndex), 10);
            const selectedService = savedServices[index];

            if (!selectedService) {
              await this.showToast('Unable to determine which template to open. Please try again.', 'danger');
              return false;
            }

            if (!this.isReadOnly && !this.isTemplateComplete(selectedService)) {
              await this.showIncompleteTemplateAlert();
              return false;
            }

            await this.generatePDFForService(selectedService);
            return true;
          }
        },
      ],
    });

    await alert.present();
  }

  async generatePDFForService(service?: ServiceSelection) {
    if (!service) {
      await this.showToast('Select a template to generate the PDF', 'warning');
      return;
    }

    if (!service.serviceId) {
      await this.showToast('Please save the service before generating a PDF', 'warning');
      return;
    }

    if (!this.isReadOnly && !this.isTemplateComplete(service)) {
      await this.showIncompleteTemplateAlert();
      return;
    }

    if (this.isEngineersFoundationService(service)) {
      await this.generateEngineersFoundationPdf(service);
      return;
    }

    if (this.isHudTemplateService(service)) {
      await this.generateHudPdf(service);
      return;
    }

    if (this.isReadOnly) {
      const openedPdf = await this.openPdfDocumentForService(service);
      if (openedPdf) {
        return;
      }
    }

    // Fallback to opening the template directly for other service types
    this.openTemplate(service, undefined, { openPdf: true });
  }

  private isEngineersFoundationService(service: ServiceSelection): boolean {
    const typeName = service.typeName?.toLowerCase() || '';
    const typeIdStr = String(service.typeId || '');
    return typeName.includes('engineer') && typeName.includes('foundation') || typeIdStr === '35';
  }

  private isHudTemplateService(service: ServiceSelection): boolean {
    const typeName = service.typeName?.toLowerCase() || '';
    return typeName.includes('hud') || typeName.includes('manufactured') || typeName.includes('mobile home');
  }

  private async generateEngineersFoundationPdf(service: ServiceSelection): Promise<void> {
    const loading = await this.loadingController.create({
      message: 'Preparing PDF report...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      await this.ensureValidToken();

      const [projectRecord, serviceRecord, visuals] = await Promise.all([
        this.ensureProjectLoaded(),
        firstValueFrom(this.caspioService.getServiceById(service.serviceId!)),
        this.foundationData.getVisualsByService(service.serviceId!)
      ]);

      if (!serviceRecord) {
        throw new Error('Service record not found.');
      }

      const projectInfo = await this.buildProjectInfoForPdf(projectRecord, serviceRecord);
      const structuralData = await this.buildStructuralDataFromVisuals(visuals || []);
      const elevationData = await this.buildElevationDataForService(service.serviceId!);

      await this.preloadPrimaryPhoto(projectInfo);
      try {
        await loading.dismiss();
      } catch {}

      await this.presentPdfModal(projectInfo, structuralData, elevationData, serviceRecord);
    } catch (error) {
      console.error('Error generating Engineers Foundation PDF:', error);
      try {
        await loading.dismiss();
      } catch {}
      await this.showToast('Failed to generate PDF. Please try again.', 'danger');
    }
  }

  private async generateHudPdf(service: ServiceSelection): Promise<void> {
    const loading = await this.loadingController.create({
      message: 'Preparing PDF report...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      await this.ensureValidToken();

      const [projectRecord, serviceRecord, visuals] = await Promise.all([
        this.ensureProjectLoaded(),
        firstValueFrom(this.caspioService.getServiceById(service.serviceId!)),
        this.foundationData.getVisualsByService(service.serviceId!)
      ]);

      if (!serviceRecord) {
        throw new Error('Service record not found.');
      }

      const projectInfo = await this.buildProjectInfoForPdf(projectRecord, serviceRecord);
      const structuralData = await this.buildStructuralDataFromVisuals(visuals || []);

      await this.preloadPrimaryPhoto(projectInfo);
      try {
        await loading.dismiss();
      } catch {}

      await this.presentPdfModal(projectInfo, structuralData, [], serviceRecord);
    } catch (error) {
      console.error('Error generating HUD PDF:', error);
      try {
        await loading.dismiss();
      } catch {}
      await this.showToast('Failed to generate PDF. Please try again.', 'danger');
    }
  }

  private async ensureProjectLoaded(): Promise<Project | null> {
    if (this.project) {
      return this.project;
    }
    if (!this.projectId) {
      return null;
    }
    try {
      const project = await firstValueFrom(this.projectsService.getProjectById(this.projectId));
      this.project = project || null;
      return this.project;
    } catch (error) {
      console.error('Failed to load project record:', error);
      return this.project || null;
    }
  }

  private async ensureValidToken(): Promise<void> {
    if (this.caspioService.getCurrentToken()) {
      return;
    }
    try {
      await firstValueFrom(this.caspioService.getValidToken());
    } catch (error) {
      console.warn('Unable to refresh Caspio token:', error);
    }
  }

  private async buildProjectInfoForPdf(project: Project | null, serviceRecord: any): Promise<any> {
    const primaryPhoto = (project?.['PrimaryPhoto'] as string | undefined) || (project?.['primaryPhoto'] as string | undefined) || null;
    const zip = (project?.['ZIP'] as string | undefined) || (project?.['Zip'] as string | undefined) || '';

    return {
      projectId: this.projectId,
      serviceId: serviceRecord?.PK_ID || serviceRecord?.ServiceID || '',
      primaryPhoto,
      primaryPhotoBase64: null,
      address: project?.Address || '',
      city: project?.City || '',
      state: project?.State || '',
      zip,
      fullAddress: `${project?.Address || ''}, ${project?.City || ''}, ${project?.State || ''} ${zip}`.trim(),
      clientName: (project?.['ClientName'] as string | undefined) || (project?.['Owner'] as string | undefined) || '',
      agentName: (project?.['AgentName'] as string | undefined) || '',
      inspectorName: (project?.['InspectorName'] as string | undefined) || '',
      inAttendance: serviceRecord?.InAttendance || '',
      yearBuilt: (project?.['YearBuilt'] as string | undefined) || '',
      squareFeet: (project?.['SquareFeet'] as string | undefined) || '',
      typeOfBuilding: (project?.['TypeOfBuilding'] as string | undefined) || '',
      style: (project?.['Style'] as string | undefined) || '',
      occupancyFurnishings: serviceRecord?.OccupancyFurnishings || '',
      weatherConditions: serviceRecord?.WeatherConditions || '',
      outdoorTemperature: serviceRecord?.OutdoorTemperature || '',
      firstFoundationType: serviceRecord?.FirstFoundationType || '',
      secondFoundationType: serviceRecord?.SecondFoundationType || '',
      secondFoundationRooms: serviceRecord?.SecondFoundationRooms || '',
      thirdFoundationType: serviceRecord?.ThirdFoundationType || '',
      thirdFoundationRooms: serviceRecord?.ThirdFoundationRooms || '',
      ownerOccupantInterview: serviceRecord?.OwnerOccupantInterview || '',
      inspectionDate: this.formatDate(serviceRecord?.DateOfInspection || new Date().toISOString()),
      inspectorPhone: '936-202-8013',
      inspectorEmail: 'info@noblepropertyinspections.com',
      companyName: 'Noble Property Inspections',
      projectData: project,
      serviceData: serviceRecord
    };
  }

  private async buildStructuralDataFromVisuals(visuals: any[]): Promise<any[]> {
    if (!visuals || visuals.length === 0) {
      return [];
    }

    const resultsMap = new Map<string, PdfVisualCategory>();

    const attachments = await Promise.all(
      visuals.map(async (visual) => {
        const visualId = visual?.VisualID || visual?.PK_ID;
        if (!visualId) {
          return { visual, attachments: [] };
        }
        try {
          const data = await firstValueFrom(this.caspioService.getServiceVisualsAttachByVisualId(visualId));
          return { visual, attachments: data || [] };
        } catch (error) {
          console.error('Failed to load visual attachments:', error);
          return { visual, attachments: [] };
        }
      })
    );

    attachments.forEach(({ visual, attachments: visualAttachments }) => {
      const category = visual?.Category || 'General';
      const kind = (visual?.Kind || visual?.Type || '').toLowerCase();
      const existingBucket = resultsMap.get(category);
      const bucket: PdfVisualCategory = existingBucket || {
        name: category,
        comments: [] as any[],
        limitations: [] as any[],
        deficiencies: [] as any[]
      };

      const item = {
        name: visual?.Name || visual?.VisualName || 'Untitled',
        text: visual?.Text || visual?.Notes || '',
        notes: visual?.Notes || '',
        answers: visual?.Answers || '',
        visualId: visual?.VisualID || visual?.PK_ID,
        photos: (visualAttachments || []).map(att => this.buildPhotoObject(att))
      };

      if (kind === 'limitation') {
        bucket.limitations.push(item);
      } else if (kind === 'deficiency') {
        bucket.deficiencies.push(item);
      } else {
        bucket.comments.push(item);
      }

      if (!existingBucket) {
        resultsMap.set(category, bucket);
      }
    });

    return Array.from(resultsMap.values()).filter(group =>
      group.comments.length || group.limitations.length || group.deficiencies.length
    );
  }

  private async buildElevationDataForService(serviceId: string): Promise<any[]> {
    const rooms = await this.foundationData.getRoomsByService(serviceId);
    if (!rooms || rooms.length === 0) {
      return [];
    }

    const roomResults = await Promise.all(rooms.map(room => this.buildRoomElevation(room)));
    return roomResults.filter(room => !!room);
  }

  private async buildRoomElevation(room: any): Promise<any | null> {
    const roomName = room?.RoomName || room?.name;
    if (!roomName) {
      return null;
    }
    const roomId = room?.RoomID || room?.PK_ID;

    const result: any = {
      name: roomName,
      fdf: room?.FDF || 'None',
      fdfPhotos: {},
      notes: room?.Notes || '',
      points: []
    };

    if (room?.FDFPhotoTop || room?.FDFPhotoBottom || room?.FDFPhotoThreshold) {
      result.fdfPhotos = await this.buildFdfPhotos(room);
    }

    if (!roomId) {
      return result;
    }

    try {
      const pointRecords = await this.foundationData.getRoomPoints(roomId);
      if (pointRecords && pointRecords.length > 0) {
        const pointResults = await Promise.all(pointRecords.map(async (point: any) => {
          const pointId = point?.PointID || point?.PK_ID;
          const pointName = point?.PointName || `Point ${pointId || ''}`;
          const value = point?.PointValue || point?.Value || point?.Measurement || '';

          let photos: any[] = [];
          if (pointId) {
            try {
              const attachments = await this.foundationData.getRoomAttachments(pointId);
              photos = (attachments || []).map(att => this.buildPhotoObject(att));
            } catch (error) {
              console.error('Failed to load point attachments:', error);
            }
          }

          return {
            name: pointName,
            value,
            photos
          };
        }));
        result.points = pointResults;
      }
    } catch (error) {
      console.error('Failed to load room points:', error);
    }

    return result;
  }

  private async buildFdfPhotos(room: any): Promise<any> {
    const photoMap: any = {};
    const fields = [
      { field: 'FDFPhotoTop', key: 'top' },
      { field: 'FDFPhotoBottom', key: 'bottom' },
      { field: 'FDFPhotoThreshold', key: 'threshold' }
    ];

    for (const field of fields) {
      const path = room?.[field.field];
      if (!path) {
        continue;
      }

      photoMap[field.key] = true;
      try {
        const imageData = await this.foundationData.getImage(path);
        if (imageData && imageData.startsWith('data:')) {
          photoMap[`${field.key}Url`] = imageData;
        } else {
          photoMap[`${field.key}Url`] = this.buildFileUrl(path);
        }
      } catch (error) {
        console.error('Failed to load FDF photo:', error);
        photoMap[`${field.key}Url`] = this.buildFileUrl(path);
      }
    }

    return photoMap;
  }

  private buildPhotoObject(attachment: any): any {
    if (!attachment) {
      return { url: 'assets/img/photo-placeholder.svg', displayUrl: 'assets/img/photo-placeholder.svg' };
    }

    const photoPath = attachment.Photo || attachment.photo || attachment.Attachment || '';
    const displayUrl = this.buildFileUrl(photoPath);

    return {
      url: displayUrl,
      displayUrl,
      caption: attachment.Annotation || attachment.caption || '',
      annotation: attachment.Annotation || attachment.caption || '',
      attachId: attachment.AttachID || attachment.PK_ID || '',
      hasAnnotations: !!attachment.Drawings
    };
  }

  private buildFileUrl(photoPath: string): string {
    if (!photoPath) {
      return 'assets/img/photo-placeholder.svg';
    }

    if (photoPath.startsWith('data:') || photoPath.startsWith('http')) {
      return photoPath;
    }

    if (photoPath.startsWith('/')) {
      const account = this.caspioService.getAccountID();
      const token = this.caspioService.getCurrentToken() || '';
      return `https://${account}.caspio.com/rest/v2/files${photoPath}?access_token=${token}`;
    }

    return photoPath;
  }

  private async preloadPrimaryPhoto(projectInfo: any): Promise<void> {
    const primaryPhoto = projectInfo?.primaryPhoto;
    if (!primaryPhoto || typeof primaryPhoto !== 'string' || !primaryPhoto.startsWith('/')) {
      return;
    }

    try {
      const imageData = await firstValueFrom(this.caspioService.getImageFromFilesAPI(primaryPhoto));
      if (imageData && imageData.startsWith('data:')) {
        projectInfo.primaryPhotoBase64 = imageData;
      }
    } catch (error) {
      console.error('Failed to preload primary photo:', error);
    }
  }

  private async presentPdfModal(projectInfo: any, structuralData: any[], elevationData: any[], serviceRecord: any): Promise<void> {
    try {
      const modal = await this.modalController.create({
        component: PdfPreviewComponent,
        componentProps: {
          projectData: projectInfo,
          structuralData,
          elevationData,
          serviceData: serviceRecord
        },
        cssClass: 'fullscreen-modal',
        backdropDismiss: false,
        animated: true
      });

      await modal.present();
      await modal.onDidDismiss();
    } catch (error) {
      console.error('Unable to present PDF modal:', error);
      await this.showToast('Failed to open PDF preview', 'danger');
    }
  }
}






