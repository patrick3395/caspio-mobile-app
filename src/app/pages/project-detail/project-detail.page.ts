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
    if (this.projectId) {
      this.loadProject();
    }
  }

  async loadProject() {
    if (!this.caspioService.isAuthenticated()) {
      this.caspioService.authenticate().subscribe({
        next: () => {
          this.fetchProject();
        },
        error: (error) => {
          this.error = 'Authentication failed';
          console.error('Authentication error:', error);
        }
      });
    } else {
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
    try {
      // Load offers for company ID 1 (Noble Property Inspections)
      const offers = await this.caspioService.getOffersByCompany('1').toPromise();
      
      // Also load Types table to get type names
      const types = await this.caspioService.getServiceTypes().toPromise();
      
      // Merge offer data with type names
      this.availableOffers = (offers || []).map((offer: any) => {
        const type = (types || []).find((t: any) => t.PK_ID === offer.TypeID || t.TypeID === offer.TypeID);
        return {
          ...offer,
          TypeName: type?.Type || offer.Service_Name || 'Unknown Service'
        };
      });
      
      console.log('Available offers loaded:', this.availableOffers);
    } catch (error) {
      console.error('Error loading offers:', error);
      await this.showToast('Failed to load available services', 'danger');
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
    const isChecked = event.detail.checked;
    
    if (isChecked) {
      await this.addService(offer);
    } else {
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
    this.updatingServices = true;
    
    try {
      // Create service record in Caspio
      const serviceData = {
        ProjectID: this.projectId,
        TypeID: offer.TypeID,
        DateOfInspection: new Date().toISOString()
      };
      
      const newService = await this.caspioService.createService(serviceData).toPromise();
      
      // Add to selected services
      const selection: ServiceSelection = {
        instanceId: this.generateInstanceId(),
        serviceId: newService.PK_ID,
        offersId: offer.OffersID,
        typeId: offer.TypeID,
        typeName: offer.TypeName || offer.Service_Name,
        dateOfInspection: serviceData.DateOfInspection
      };
      
      this.selectedServices.push(selection);
      this.saveToLocalStorage();
      this.updateDocumentsList();
      
      await this.showToast(`${selection.typeName} added`, 'success');
    } catch (error) {
      console.error('Error adding service:', error);
      await this.showToast('Failed to add service', 'danger');
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
      // Delete from Caspio if it has a serviceId
      if (service.serviceId) {
        await this.caspioService.deleteService(service.serviceId).toPromise();
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
      console.error('Error removing service:', error);
      await this.showToast('Failed to remove service', 'danger');
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
      // Get templates for this service type
      const templates = this.attachTemplates.filter(t => 
        t.TypeID === parseInt(service.typeId) && 
        (t.Auto === 'Yes' || t.Auto === true || t.Auto === 1) &&
        (t.Required === 'Yes' || t.Required === true || t.Required === 1)
      );
      
      const documents: DocumentItem[] = [];
      
      // Add required documents from templates
      if (templates.length > 0) {
        for (const template of templates) {
          const attachment = this.existingAttachments.find(a => 
            a.TypeID === parseInt(service.typeId) && 
            a.Title === template.Title
          );
          
          documents.push({
            attachId: attachment?.AttachID,
            title: template.Title || template.AttachmentName || 'Document',
            required: true,
            uploaded: !!attachment,
            templateId: template.PK_ID,
            filename: attachment?.Link,
            attachmentUrl: attachment?.Attachment
          });
        }
      } else {
        // Fallback documents if no templates
        const defaultDocs = [
          { title: 'Home Inspection Report', required: true },
          { title: 'Cubicasa', required: false }
        ];
        
        for (const doc of defaultDocs) {
          const attachment = this.existingAttachments.find(a => 
            a.TypeID === parseInt(service.typeId) && 
            a.Title === doc.title
          );
          
          documents.push({
            attachId: attachment?.AttachID,
            title: doc.title,
            required: doc.required,
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
        // Create new Attach record
        const attachData = {
          ProjectID: this.projectId,
          TypeID: typeId,
          Title: doc.title,
          Notes: `Uploaded via mobile app on ${new Date().toLocaleDateString()}`,
          Link: file.name
        };
        
        const newAttach = await this.caspioService.createAttachment(attachData).toPromise();
        
        // Upload file to Caspio Files API
        await this.uploadFileToCaspio(newAttach.AttachID, file);
        
        await this.showToast('File uploaded successfully', 'success');
      } else if (action === 'replace' && doc.attachId) {
        // Replace existing file
        await this.uploadFileToCaspio(doc.attachId, file);
        
        // Update Link field with new filename
        await this.caspioService.updateAttachment(doc.attachId, {
          Link: file.name
        }).toPromise();
        
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
    const formData = new FormData();
    formData.append('file', file);
    
    const token = this.caspioService.getCurrentToken();
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`
    });
    
    // Upload to Caspio Files API endpoint
    const apiUrl = `https://c2hcf092.caspio.com/rest/v2/files/Attach/${attachId}`;
    
    await this.http.post(apiUrl, formData, { headers }).toPromise();
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

  private generateInstanceId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private saveToLocalStorage() {
    const key = `project_${this.projectId}_services`;
    localStorage.setItem(key, JSON.stringify(this.selectedServices));
  }

  private async showToast(message: string, color: string = 'primary') {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }
}