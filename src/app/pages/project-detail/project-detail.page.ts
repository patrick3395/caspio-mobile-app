import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { ProjectsService, Project } from '../../services/projects.service';
import { CaspioService } from '../../services/caspio.service';
import { IonModal, ToastController, AlertController, LoadingController, ModalController, ViewWillEnter } from '@ionic/angular';
import { HttpClient } from '@angular/common/http';
import { ImageViewerComponent } from '../../components/image-viewer/image-viewer.component';
import { ImageCompressionService } from '../../services/image-compression.service';
import { EngineersFoundationDataService } from '../engineers-foundation/engineers-foundation-data.service';
import { PlatformDetectionService } from '../../services/platform-detection.service';
import { firstValueFrom } from 'rxjs';
import { filter, first, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { PaypalPaymentModalComponent } from '../../modals/paypal-payment-modal/paypal-payment-modal.component';
import { MutationTrackingService, MutationType } from '../../services/mutation-tracking.service';
import { OptimisticUpdateService } from '../../services/optimistic-update.service';
import { NavigationHistoryService } from '../../services/navigation-history.service';
import { ConfirmationDialogService } from '../../services/confirmation-dialog.service';
import { PageTitleService } from '../../services/page-title.service';
import { BackgroundSyncService } from '../../services/background-sync.service';
import { OfflineTemplateService } from '../../services/offline-template.service';
import { TemplatePdfService } from '../../services/template/template-pdf.service';
import { TemplateType } from '../../services/template/template-config.interface';

type DocumentViewerCtor = typeof import('../../components/document-viewer/document-viewer.component')['DocumentViewerComponent'];
interface Breadcrumb {
  label: string;
  path: string;
  icon?: string;
}

interface ServiceSelection {
  instanceId: string;
  serviceId?: string; // PK_ID from Services table
  offersId: string;
  typeId: string;
  typeName: string;
  typeShort?: string; // Short code like EIR, EFE, DCR, etc.
  typeIcon?: string; // Icon path from LPS_Type table
  typeIconUrl?: string; // Base64 data URL for the icon
  dateOfInspection: string;
  ReportFinalized?: boolean; // Whether the report has been finalized
  Status?: string; // Status field (e.g., "Under Review", "Report Finalized")
  StatusID?: number; // FK to LPS_Status.StatusID - used for client status lookup
  StatusDateTime?: string; // ISO date string when the status was last updated (also used for submission date)
  saving?: boolean;
  saved?: boolean;
  serviceFee?: number; // Per-instance fee (editable by admin)
  // Deliverables fields (for CompanyID = 1)
  StatusEng?: string;
  Deliverable?: string; // File URL
  EngNotes?: string;
  InspectorNotes?: string;
  [key: string]: any; // Index signature to allow dynamic property access
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
  isLink?: boolean; // Flag to identify if this is a manually added link
  additionalFiles?: Array<{  // For multiple uploads of the same document
    attachId: string;
    linkName: string;
    attachmentUrl: string;
  }>;
}

interface ServiceDocumentGroup {
  serviceId: string;
  serviceName: string;
  typeShort?: string;
  typeId: string;
  instanceNumber: number;
  documents: DocumentItem[];
}

interface ProjectDetailCacheState {
  project: Project | null;
  isReadOnly: boolean;
  availableOffers: any[];
  selectedServices: ServiceSelection[];
  attachTemplates: any[];
  existingAttachments: any[];
  serviceDocuments: ServiceDocumentGroup[];
  optionalDocumentsList: any[];
  templateServicesCache: ServiceSelection[];
  templateServicesCacheKey: string;
  showDeliverablesTable: boolean;
  isCompanyOne: boolean;
  projectCompanyId: string;
  projectTotalPaid: number;
  projectInvoiceBalance: number;
  timestamp: number;
}

/**
 * G2-PERF-003: OnPush change detection for performance optimization (web only)
 * This page uses OnPush strategy to reduce unnecessary re-renders.
 * Manual change detection (markForCheck) is used when async operations complete.
 */
@Component({
  selector: 'app-project-detail',
  templateUrl: './project-detail.page.html',
  styleUrls: ['./project-detail.page.scss'],
  standalone: false,
  changeDetection: environment.isWeb ? ChangeDetectionStrategy.OnPush : ChangeDetectionStrategy.Default
})
export class ProjectDetailPage implements OnInit, OnDestroy, ViewWillEnter {
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

  // Services tab toggle: 'active' shows selected services, 'add' shows available-to-add
  servicesTab: 'active' | 'add' = 'add';

  // Project balance from LPS_Invoices (sum of all Fee: positive = charges, negative = payments)
  projectTotalPaid: number = 0;
  projectInvoiceBalance: number = 0;

  // WEBAPP: Cache sorted offers to prevent DOM re-creation
  private sortedOffersCache: any[] = [];
  private sortedOffersCacheKey: string = '';
  
  // Documents
  attachTemplates: any[] = [];
  existingAttachments: any[] = [];
  serviceDocuments: ServiceDocumentGroup[] = [];
  loadingDocuments = false;
  optionalDocumentsList: any[] = [];
  currentUploadContext: any = null;

  // Notes
  savingNotes = false;
  notesSaved = false;

  // Deliverables
  showDeliverablesTable = false;
  currentDeliverableUpload: any = null;
  statusOptions: any[] = [];
  isCompanyOne = false; // Track if logged-in user is CompanyID = 1
  projectCompanyId: string = '1'; // Store the project's CompanyID for API calls
  projectCompanyName: string = ''; // Store the project's company name (for admin view)
  expandedDeliverables: Set<string> = new Set(); // Track which deliverables are expanded (by unique key)
  
  // Track changes since last submission (by serviceId)
  changesAfterSubmission: { [serviceId: string]: boolean } = {};

  // For modal
  selectedServiceDoc: ServiceDocumentGroup | null = null;
  isAddingLink = false; // Flag to track if adding link vs document
  
  // Navigation flag to prevent double-clicks
  isNavigating = false;

  // Breadcrumbs (web only)
  breadcrumbs: Breadcrumb[] = [];
  isWeb = environment.isWeb;

  // Sync/Save button states
  isSaving = false;
  isSyncing = false;
  pendingSyncCount = 0;

  private documentViewerComponent?: DocumentViewerCtor;
  private templateServicesCache: ServiceSelection[] = [];
  private templateServicesCacheKey = '';
  private pendingFinalizedServiceId: string | null = null;

  private static readonly DETAIL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private static detailStateCache = new Map<string, ProjectDetailCacheState>();

  private restoreStateFromCache(): boolean {
    if (!this.projectId) {
      return false;
    }

    const cached = ProjectDetailPage.detailStateCache.get(this.projectId);
    if (!cached) {
      return false;
    }

    const cacheAge = Date.now() - cached.timestamp;
    if (cacheAge > ProjectDetailPage.DETAIL_CACHE_TTL) {
      ProjectDetailPage.detailStateCache.delete(this.projectId);
      return false;
    }

    try {

      this.project = ProjectDetailPage.deepClone(cached.project);
      this.isReadOnly = cached.isReadOnly;
      this.availableOffers = ProjectDetailPage.deepClone(cached.availableOffers);
      this.selectedServices = ProjectDetailPage.deepClone(cached.selectedServices);
      this.servicesTab = this.selectedServices.length > 0 ? 'active' : 'add';
      this.attachTemplates = ProjectDetailPage.deepClone(cached.attachTemplates);
      this.existingAttachments = ProjectDetailPage.deepClone(cached.existingAttachments);
      this.serviceDocuments = ProjectDetailPage.deepClone(cached.serviceDocuments);
      this.optionalDocumentsList = ProjectDetailPage.deepClone(cached.optionalDocumentsList);
      this.templateServicesCache = ProjectDetailPage.deepClone(cached.templateServicesCache);
      this.templateServicesCacheKey = cached.templateServicesCacheKey;
      this.showDeliverablesTable = cached.showDeliverablesTable;
      this.isCompanyOne = cached.isCompanyOne;
      this.projectCompanyId = cached.projectCompanyId || '1';
      this.projectTotalPaid = cached.projectTotalPaid || 0;
      this.projectInvoiceBalance = cached.projectInvoiceBalance || 0;

      // Apply pending finalized service flag if present (from cache restoration)
      if (this.pendingFinalizedServiceId) {
        const service = this.selectedServices.find(s => s.serviceId === this.pendingFinalizedServiceId);
        if (service) {
          service.ReportFinalized = true;
          this.changeDetectorRef.markForCheck();
        }
        this.pendingFinalizedServiceId = null;
      }

      // Recalculate showDeliverablesTable based on restored services (for safety)
      if (this.isCompanyOne) {
        // Admins: Always show the table if there are services
        this.showDeliverablesTable = this.selectedServices.length > 0;
      } else {
        // Clients: Only show if at least one service has StatusID = 5 (Complete)
        this.showDeliverablesTable = this.selectedServices.some(s => s.StatusID === 5);
      }

      this.loading = false;
      this.loadingServices = false;
      this.loadingDocuments = false;
      this.error = '';


      return true;
    } catch (error) {
      console.warn('Failed to restore project detail cache:', error);
      ProjectDetailPage.detailStateCache.delete(this.projectId);
      return false;
    }
  }

  private cacheCurrentState(): void {
    if (!this.projectId) {
      return;
    }

    try {
      const cacheEntry: ProjectDetailCacheState = {
        project: ProjectDetailPage.deepClone(this.project),
        isReadOnly: this.isReadOnly,
        availableOffers: ProjectDetailPage.deepClone(this.availableOffers),
        selectedServices: ProjectDetailPage.deepClone(this.selectedServices),
        attachTemplates: ProjectDetailPage.deepClone(this.attachTemplates),
        existingAttachments: ProjectDetailPage.deepClone(this.existingAttachments),
        serviceDocuments: ProjectDetailPage.deepClone(this.serviceDocuments),
        optionalDocumentsList: ProjectDetailPage.deepClone(this.optionalDocumentsList),
        templateServicesCache: ProjectDetailPage.deepClone(this.templateServicesCache),
        templateServicesCacheKey: this.templateServicesCacheKey,
        showDeliverablesTable: this.showDeliverablesTable,
        isCompanyOne: this.isCompanyOne,
        projectCompanyId: this.projectCompanyId,
        projectTotalPaid: this.projectTotalPaid,
        projectInvoiceBalance: this.projectInvoiceBalance,
        timestamp: Date.now()
      };

      ProjectDetailPage.detailStateCache.set(this.projectId, cacheEntry);
    } catch (error) {
      console.warn('Failed to cache project detail state:', error);
    }
  }

  private static deepClone<T>(value: T): T {
    if (value === null || value === undefined) {
      return value;
    }

    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  /**
   * Save pending (not yet uploaded) documents to localStorage so they survive page refresh.
   * Only saves documents that haven't been uploaded yet.
   */
  private savePendingDocumentsToStorage(): void {
    if (!this.projectId) return;

    try {
      // Extract only pending documents (not uploaded) from each service
      const pendingDocs: { serviceId: string; documents: any[] }[] = [];

      for (const serviceDoc of this.serviceDocuments) {
        const pending = serviceDoc.documents.filter(d => !d.uploaded);
        if (pending.length > 0) {
          pendingDocs.push({
            serviceId: serviceDoc.serviceId,
            documents: pending
          });
        }
      }

      if (pendingDocs.length > 0) {
        localStorage.setItem(
          `pendingDocuments_${this.projectId}`,
          JSON.stringify(pendingDocs)
        );
      } else {
        // No pending docs, clear storage
        localStorage.removeItem(`pendingDocuments_${this.projectId}`);
      }
    } catch (error) {
      console.warn('Failed to save pending documents to storage:', error);
    }
  }

  /**
   * Load pending documents from localStorage and merge them into serviceDocuments.
   * Called during page initialization to restore pending documents after refresh.
   */
  private loadPendingDocumentsFromStorage(): void {
    if (!this.projectId) return;

    try {
      const stored = localStorage.getItem(`pendingDocuments_${this.projectId}`);
      if (!stored) return;

      const pendingDocs: { serviceId: string; documents: any[] }[] = JSON.parse(stored);

      for (const pending of pendingDocs) {
        const serviceDoc = this.serviceDocuments.find(sd => sd.serviceId === pending.serviceId);
        if (serviceDoc) {
          // Add pending documents that don't already exist
          for (const doc of pending.documents) {
            const exists = serviceDoc.documents.some(d => d.title === doc.title);
            if (!exists) {
              serviceDoc.documents.push(doc);
            }
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load pending documents from storage:', error);
      // Clear corrupted data
      localStorage.removeItem(`pendingDocuments_${this.projectId}`);
    }
  }

  /**
   * Clear pending documents from storage for a specific service after upload.
   */
  private clearPendingDocumentFromStorage(serviceId: string, docTitle: string): void {
    if (!this.projectId) return;

    try {
      const stored = localStorage.getItem(`pendingDocuments_${this.projectId}`);
      if (!stored) return;

      const pendingDocs: { serviceId: string; documents: any[] }[] = JSON.parse(stored);
      const serviceEntry = pendingDocs.find(p => p.serviceId === serviceId);

      if (serviceEntry) {
        serviceEntry.documents = serviceEntry.documents.filter(d => d.title !== docTitle);

        // Remove service entry if no more pending docs
        const updatedPendingDocs = pendingDocs.filter(p => p.documents.length > 0);

        if (updatedPendingDocs.length > 0) {
          localStorage.setItem(
            `pendingDocuments_${this.projectId}`,
            JSON.stringify(updatedPendingDocs)
          );
        } else {
          localStorage.removeItem(`pendingDocuments_${this.projectId}`);
        }
      }
    } catch (error) {
      console.warn('Failed to clear pending document from storage:', error);
    }
  }

  private async loadDocumentViewer(): Promise<DocumentViewerCtor> {
    if (!this.documentViewerComponent) {
      const module = await import('../../components/document-viewer/document-viewer.component');
      this.documentViewerComponent = module.DocumentViewerComponent;
    }
    return this.documentViewerComponent;
  }

  constructor(
    private route: ActivatedRoute,
    public router: Router,
    private location: Location,
    private projectsService: ProjectsService,
    private caspioService: CaspioService,
    private http: HttpClient,
    private toastController: ToastController,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private modalController: ModalController,
    private changeDetectorRef: ChangeDetectorRef,
    private imageCompression: ImageCompressionService,
    private foundationData: EngineersFoundationDataService,
    public platform: PlatformDetectionService,
    private mutationTracker: MutationTrackingService,
    private optimisticUpdate: OptimisticUpdateService,
    private navigationHistory: NavigationHistoryService,
    private confirmationDialog: ConfirmationDialogService,
    private pageTitleService: PageTitleService,
    private backgroundSync: BackgroundSyncService,
    private offlineTemplate: OfflineTemplateService,
    private templatePdfService: TemplatePdfService
  ) {}

  /**
   * Update breadcrumbs for web navigation (G2-NAV-002)
   * Also updates page title (G2-SEO-001)
   */
  private updateBreadcrumbs() {
    if (!environment.isWeb) return;

    this.breadcrumbs = [];

    // Add the project breadcrumb (current page)
    const projectName = this.project?.Address || 'Project';
    this.breadcrumbs.push({
      label: projectName,
      path: '',
      icon: 'document-text-outline'
    });

    // G2-SEO-001: Update page title with project address
    this.pageTitleService.setProjectTitle(projectName);
  }

  /**
   * Navigate to home (projects list) from breadcrumb
   */
  navigateToBreadcrumbHome() {
    this.router.navigate(['/active-projects']);
  }

  /**
   * Navigate to a breadcrumb item (for future extensibility)
   */
  navigateToCrumb(crumb: Breadcrumb) {
    // Currently only one level, so no navigation needed
    // This can be extended for deeper navigation if needed
  }

  ngOnInit() {
    this.projectId = this.route.snapshot.paramMap.get('id') || '';

    // Subscribe to pending sync changes count (mobile only)
    if (!environment.isWeb) {
      this.backgroundSync.pendingChanges$.subscribe(count => {
        this.pendingSyncCount = count;
        this.changeDetectorRef.markForCheck();
      });
    }

    // Check for add-service mode
    this.route.queryParams.subscribe(params => {
      if (params['mode'] === 'add-service') {
        // Temporarily allow editing for adding services to completed projects
        this.isReadOnly = false;
      }
    });

    if (this.projectId) {
      // Try to restore from cache first
      const restoredFromCache = this.restoreStateFromCache();
      if (!restoredFromCache) {
        // No cache, load from server
        this.loadProject();
      } else {
        // Ensure loading indicators are cleared when restoring cached state
        this.loading = false;
        this.loadingServices = false;
        this.loadingDocuments = false;
        // G2-NAV-002: Update breadcrumbs from cached state (web only)
        this.updateBreadcrumbs();
      }
    } else {
      console.error('❌ DEBUG: No projectId provided!');
    }
  }

  async ionViewWillEnter() {

    // BULLETPROOF: Check localStorage for finalized service info
    const storedData = localStorage.getItem('pendingFinalizedService');

    if (storedData) {
      try {
        const navigationData = JSON.parse(storedData);

        // Check if this data is for this project and is recent (within 10 seconds)
        const age = Date.now() - navigationData.timestamp;

        if (age < 10000) {

          // CRITICAL: Check if we're on the CORRECT project page
          if (navigationData.projectId !== this.projectId) {
            console.warn('[ProjectDetail] ⚠️ Navigation data is for project', navigationData.projectId, 'but we are on project', this.projectId);

            // Update projectId to load the correct project's data
            this.projectId = navigationData.projectId;

            // Update the browser URL without going through Angular Router (avoids outlet error)
            this.location.replaceState('/project/' + navigationData.projectId);

            // Clear the static cache for the NEW project
            ProjectDetailPage.detailStateCache.delete(this.projectId);

            // Continue with the loading process below
          }

          // Clear the localStorage item immediately so we don't process it again
          localStorage.removeItem('pendingFinalizedService');

          // Store for later - will apply after services are loaded
          this.pendingFinalizedServiceId = navigationData.finalizedServiceId;

          // CRITICAL: Clear ALL caches to force fresh data load
          ProjectDetailPage.detailStateCache.delete(this.projectId);

          this.foundationData.clearAllCaches();

          // WEB FIX: Clear pending requests to prevent deduplication issues
          this.caspioService.clearPendingRequests();

          // FORCE a complete reload from server
          await this.loadProject();

          // WEB FIX: Force multiple change detections for web browsers
          if (this.platform.isWeb()) {
            this.changeDetectorRef.markForCheck();
            setTimeout(() => {
              this.changeDetectorRef.markForCheck();
            }, 100);
            setTimeout(() => {
              this.changeDetectorRef.markForCheck();
            }, 500);
          }
        } else {
          localStorage.removeItem('pendingFinalizedService');
        }
      } catch (e) {
        console.error('[ProjectDetail] Error parsing navigation data:', e);
        localStorage.removeItem('pendingFinalizedService');
      }
    } else {
    }

  }

  ngOnDestroy(): void {
    this.cacheCurrentState();
  }

  async loadProject() {
    // Auth handled server-side via API Gateway
    await this.fetchProjectOptimized();
  }

  async fetchProjectOptimized() {
    const startTime = performance.now();
    this.loading = true;
    this.error = '';

    try {
      const projectData = await this.projectsService.getProjectById(this.projectId).toPromise();

      if (!projectData) {
        console.error('❌ No project data returned for ID:', this.projectId);
        this.error = 'Failed to load project';
        this.loading = false;
        this.changeDetectorRef.markForCheck();

        // Show debug alert on mobile
        await this.showDebugAlert('Project Load Error',
          `No project found with ID: ${this.projectId}\n\nPlease check if the project exists and you have permission to access it.`);
        return;
      }

      this.project = projectData;

      const actualProjectId = projectData?.ProjectID || this.projectId;
      const statusId = projectData?.StatusID;
      const isCompletedProject = this.isCompletedStatus(statusId);
      const isAddServiceMode = this.route.snapshot.queryParams['mode'] === 'add-service';
      this.isReadOnly = isCompletedProject && !isAddServiceMode;

      // Check company ID and store it for API calls
      const projectCompanyId = Number(projectData?.CompanyID || projectData?.Company_ID);
      this.projectCompanyId = projectCompanyId ? projectCompanyId.toString() : '1';

      // Check if logged-in user is from admin company (CompanyID = 1)
      // This determines if they see admin view (all services) vs client view (completed only)
      const userStr = localStorage.getItem('currentUser');
      let userCompanyId = 0;
      if (userStr) {
        try {
          const user = JSON.parse(userStr);
          userCompanyId = user.companyId || user.CompanyID || 0;
        } catch (e) {
          console.error('Error parsing user data:', e);
        }
      }
      this.isCompanyOne = userCompanyId === 1;

      const parallelStartTime = performance.now();

      // If we have a pending finalized service, force fresh data for Services table
      // Add cache-busting timestamp to prevent request deduplication
      const servicesPromise = this.pendingFinalizedServiceId
        ? this.caspioService.get<any>(`/tables/LPS_Services/records?q.where=ProjectID=${actualProjectId}&_t=${Date.now()}`, false).pipe(
            map((response: any) => response.Result || [])
          ).toPromise()
        : this.caspioService.getServicesByProject(actualProjectId).toPromise();

      const promises = [
        this.caspioService.getOffersByCompany(this.projectCompanyId).toPromise(),
        this.caspioService.getServiceTypes().toPromise(),
        servicesPromise, // Use the conditional promise
        this.caspioService.getAttachTemplates().toPromise(),
        this.caspioService.getAttachmentsByProject(actualProjectId).toPromise()
      ];

      // Always load Status table for deliverables
      promises.push(this.caspioService.get<any>('/tables/LPS_Status/records').toPromise());

      // Load invoices for balance calculation (always fresh, no cache)
      promises.push(this.caspioService.get<any>(`/tables/LPS_Invoices/records?q.where=ProjectID=${actualProjectId}`, false).toPromise());

      // Load company name for admin view
      if (this.isCompanyOne && projectCompanyId) {
        promises.push(this.caspioService.get<any>(`/tables/LPS_Companies/records?q.where=CompanyID=${projectCompanyId}`).toPromise());
      }

      const results = await Promise.allSettled(promises);

      const [offers, types, services, attachTemplates, existingAttachments, statuses, invoicesResult, companyResult] = results;

      const parallelElapsed = performance.now() - parallelStartTime;

      // Extract values from settled promises
      const offersData = offers.status === 'fulfilled' ? offers.value : [];
      const typesData = types.status === 'fulfilled' ? types.value : [];
      const servicesData = services.status === 'fulfilled' ? services.value : [];
      const attachTemplatesData = attachTemplates.status === 'fulfilled' ? attachTemplates.value : [];
      const existingAttachmentsData = existingAttachments.status === 'fulfilled' ? existingAttachments.value : [];

      // Extract status options if loaded
      if (statuses) {
        const statusesData: any = statuses.status === 'fulfilled' ? statuses.value : null;
        if (statusesData && statusesData.Result) {
          this.statusOptions = statusesData.Result;
        }
      }

      // Extract company name for admin view
      if (companyResult && companyResult.status === 'fulfilled') {
        const companyData: any = companyResult.value;
        if (companyData?.Result?.[0]) {
          this.projectCompanyName = companyData.Result[0].CompanyName || companyData.Result[0].Name || '';
        }
      }

      // Calculate balance from ALL invoice records (positive Fee = charge, negative Fee = payment)
      this.projectTotalPaid = 0;
      this.projectInvoiceBalance = 0;
      if (invoicesResult && invoicesResult.status === 'fulfilled') {
        const invoicesData: any = invoicesResult.value;
        if (invoicesData?.Result) {
          invoicesData.Result.forEach((invoice: any) => {
            const fee = parseFloat(invoice.Fee) || 0;
            this.projectInvoiceBalance += fee;
            if (fee < 0) {
              this.projectTotalPaid += Math.abs(fee);
            }
          });
        }
      }

      // Log any failures
      if (offers.status === 'rejected') console.error('Failed to load offers:', offers.reason);
      if (types.status === 'rejected') console.error('Failed to load types:', types.reason);
      if (services.status === 'rejected') console.error('Failed to load services:', services.reason);
      if (attachTemplates.status === 'rejected') console.error('Failed to load attach templates:', attachTemplates.reason);
      if (existingAttachments.status === 'rejected') console.error('Failed to load attachments:', existingAttachments.reason);
      if (statuses && statuses.status === 'rejected') console.error('Failed to load statuses:', statuses.reason);

      // Process offers and types
      this.availableOffers = (offersData || []).map((offer: any) => {
        const type = (typesData || []).find((t: any) => t.PK_ID === offer.TypeID || t.TypeID === offer.TypeID);
        const typePkId = type?.PK_ID || null;

        // Resolve cached icon synchronously so it's available before first render
        let cachedIconUrl = '';
        if (typePkId) {
          const cacheKey = `icon_${typePkId}`;
          cachedIconUrl = ProjectDetailPage.iconCache.get(cacheKey) || '';
          if (!cachedIconUrl) {
            try { cachedIconUrl = localStorage.getItem(cacheKey) || ''; } catch {}
            if (cachedIconUrl) ProjectDetailPage.iconCache.set(cacheKey, cachedIconUrl);
          }
        }

        return {
          ...offer,
          TypeName: type?.TypeName || type?.Type || offer.Service_Name || offer.Description || 'Unknown Service',
          TypeShort: type?.TypeShort || '',
          TypeIcon: type?.Icon || '',
          TypePK_ID: typePkId,
          TypeIconUrl: cachedIconUrl
        };
      });

      // Process existing services FIRST (so loadIconImages has data to work with)
      this.selectedServices = (servicesData || []).map((service: any) => {
        const offer = this.availableOffers.find(o => o.TypeID == service.TypeID);
        
        return {
          instanceId: `${service.PK_ID || service.ServiceID}_${Date.now()}_${Math.random()}`,
          serviceId: service.PK_ID || service.ServiceID,
          offersId: offer?.OffersID || offer?.PK_ID || '',
          typeId: service.TypeID,
          typeName: offer?.TypeName || 'Unknown Service',
          typeShort: offer?.TypeShort || '',
          typeIcon: offer?.TypeIcon || '',
          typeIconUrl: offer?.TypeIconUrl || '',  // Use the loaded base64 URL
          dateOfInspection: service.DateOfInspection || service.InspectionDate || new Date().toISOString(),
          serviceFee: service.ServiceFee != null ? parseFloat(service.ServiceFee) || 0 : (offer?.ServiceFee ? parseFloat(offer.ServiceFee) || 0 : 0),
          ReportFinalized: service.Status === 'Finalized' || service.Status === 'Updated' || service.Status === 'Under Review' || service.ReportFinalized || false,
          Status: service.Status || '',
          StatusID: service.StatusID || null,  // FK to LPS_Status.StatusID
          StatusDateTime: service.StatusDateTime || '',
          // Deliverables fields - use StatusEng from database (should be "Created")
          StatusEng: service.StatusEng || '',  // Don't fallback to Status - show what's actually in StatusEng field
          Deliverable: service.Deliverable || '',
          EngNotes: service.EngNotes || '',
          InspectorNotes: service.InspectorNotes || ''
        };
      });

      // Apply pending finalized service flag if present
      if (this.pendingFinalizedServiceId) {

        // Try both string and number comparison
        const service = this.selectedServices.find(s =>
          s.serviceId === this.pendingFinalizedServiceId ||
          s.serviceId === String(this.pendingFinalizedServiceId) ||
          String(s.serviceId) === String(this.pendingFinalizedServiceId)
        );

        if (service) {

          // Update ReportFinalized flag and Status (Status already loaded from DB, but ensure consistency)
          service.ReportFinalized = true;
          // Preserve 'Under Review' status if already submitted, otherwise set to 'Finalized'
          if (service.Status !== 'Under Review') {
            if (!service.Status || service.Status !== 'Finalized') {
              service.Status = 'Finalized';
            }
          }

          // Mark that changes have been made (for Re-Submit button)
          if (service.serviceId) {
            this.changesAfterSubmission[service.serviceId] = true;
          }

          this.changeDetectorRef.markForCheck();
        } else {
          console.warn('[ProjectDetail] Service not found with serviceId:', this.pendingFinalizedServiceId);
        }
        this.pendingFinalizedServiceId = null;
      }

      // Set default services tab based on whether services exist
      this.servicesTab = this.selectedServices.length > 0 ? 'active' : 'add';

      // Determine if we should show the Deliverables table
      if (this.isCompanyOne) {
        // Admins: Always show the table if there are services
        this.showDeliverablesTable = this.selectedServices.length > 0;
      } else {
        // Clients: Only show if at least one service has StatusID = 5 (Complete)
        this.showDeliverablesTable = this.selectedServices.some(s => s.StatusID === 5);
      }

      // Load icon images AFTER selectedServices is populated (don't await - let it run async)
      this.loadIconImages();

      // Process attach templates
      this.attachTemplates = attachTemplatesData || [];

      // Process existing attachments
      this.existingAttachments = existingAttachmentsData || [];

      // Update documents
      this.updateDocumentsList();

      // Restore any pending documents from localStorage (survives page refresh)
      this.loadPendingDocumentsFromStorage();

      // Update storage to remove any pending docs that are now uploaded
      this.savePendingDocumentsToStorage();

      // Load PrimaryPhoto if needed (async, don't wait)
      if (this.project?.['PrimaryPhoto'] && this.project['PrimaryPhoto'].startsWith('/')) {
        this.loadProjectImageData();
      }

      this.loading = false;
      this.loadingServices = false;
      this.changeDetectorRef.markForCheck();

      // G2-NAV-002: Update breadcrumbs now that project is loaded (web only)
      this.updateBreadcrumbs();

      const totalElapsed = performance.now() - startTime;
      this.cacheCurrentState();

    } catch (error: any) {
      console.error('❌ Error in fetchProjectOptimized:', error);

      // Detailed debug alert for mobile
      const errorDetails = `Error loading project:\n\nProject ID: ${this.projectId}\n\nError: ${error?.message || error}\n\nStatus: ${error?.status}\n\nDetails: ${JSON.stringify(error?.error || error)}`;
      await this.showDebugAlert('Project Load Error', errorDetails);

      this.error = 'Failed to load project';
      this.loading = false;
      this.loadingServices = false;
      this.changeDetectorRef.markForCheck();
    }
  }

  async fetchProject() {
    this.loading = true;
    this.error = '';

    this.projectsService.getProjectById(this.projectId).subscribe({
      next: async (project) => {
        this.project = project;
        this.loading = false;
        this.changeDetectorRef.markForCheck();
        
        // Determine if the project has been completed (StatusID = 2)
        // StatusID: 7 = Active, 2 = Completed, 3 = Cancelled, 4 = On Hold
        const statusId = project.StatusID;
        const isCompletedProject = this.isCompletedStatus(statusId);
        
        // Check if we're in add-service mode (which overrides read-only)
        const queryParams = this.route.snapshot.queryParams;
        if (queryParams['mode'] === 'add-service') {
          this.isReadOnly = false;
        } else {
          this.isReadOnly = isCompletedProject;
        }

        // Check if logged-in user is from admin company (CompanyID = 1)
        const userStr = localStorage.getItem('currentUser');
        let userCompanyId = 0;
        if (userStr) {
          try {
            const user = JSON.parse(userStr);
            userCompanyId = user.companyId || user.CompanyID || 0;
          } catch (e) {
            console.error('Error parsing user data:', e);
          }
        }
        this.isCompanyOne = userCompanyId === 1;

        // Load company name for admin view
        const projectCompanyId = Number(project.CompanyID || project.Company_ID);
        this.projectCompanyId = projectCompanyId ? projectCompanyId.toString() : '1';
        if (this.isCompanyOne && projectCompanyId) {
          try {
            const companyResult: any = await this.caspioService.get<any>(`/tables/LPS_Companies/records?q.where=CompanyID=${projectCompanyId}`).toPromise();
            if (companyResult?.Result?.[0]) {
              this.projectCompanyName = companyResult.Result[0].CompanyName || companyResult.Result[0].Name || '';
            }
          } catch (e) {
            console.error('Error loading company name:', e);
          }
        }

        if (this.isReadOnly) {
        }

        // Load offers first, then services (services need offers to match properly)
        await this.loadAvailableOffers();

        // Build parallel promises array
        const parallelPromises = [
          this.loadExistingServices(),  // This needs offers to be loaded first
          this.loadAttachTemplates(),
          this.loadExistingAttachments(),
          this.loadStatusOptions() // Always load status options
        ];

        // Now load these in parallel
        await Promise.all(parallelPromises);

        // Determine if we should show the Deliverables table after services are loaded
        if (this.isCompanyOne) {
          // Admins: Always show the table if there are services
          this.showDeliverablesTable = this.selectedServices.length > 0;
        } else {
          // Clients: Only show if at least one service has StatusID = 5 (Complete)
          this.showDeliverablesTable = this.selectedServices.some(s => s.StatusID === 5);
        }

        // Load icon images AFTER selectedServices is populated (don't await - let it run async)
        this.loadIconImages();
      },
      error: (error) => {
        this.error = 'Failed to load project';
        this.loading = false;
        this.changeDetectorRef.markForCheck();
        console.error('Error loading project:', error);
      }
    });
  }


  private isCompletedStatus(status: any): boolean {
    if (status === null || status === undefined) {
      return false;
    }

    if (typeof status === 'number') {
      return status === 2 || status === 5;
    }

    if (typeof status === 'string') {
      return status.trim() === '2' || status.trim() === '5';
    }

    return false;
  }

  async loadAvailableOffers() {
    this.loadingServices = true;
    try {
      const offers = await this.caspioService.getOffersByCompany(this.projectCompanyId).toPromise();
      const types = await this.caspioService.getServiceTypes().toPromise();

      // Merge offer data with type names
      const processedOffers = (offers || []).map((offer: any) => {
        const type = (types || []).find((t: any) => t.PK_ID === offer.TypeID || t.TypeID === offer.TypeID);
        const typePkId = type?.PK_ID || null;

        // Resolve cached icon synchronously
        let cachedIconUrl = '';
        if (typePkId) {
          const cacheKey = `icon_${typePkId}`;
          cachedIconUrl = ProjectDetailPage.iconCache.get(cacheKey) || '';
          if (!cachedIconUrl) {
            try { cachedIconUrl = localStorage.getItem(cacheKey) || ''; } catch {}
            if (cachedIconUrl) ProjectDetailPage.iconCache.set(cacheKey, cachedIconUrl);
          }
        }

        const result = {
          ...offer,
          TypeName: type?.TypeName || type?.Type || offer.Service_Name || offer.Description || 'Unknown Service',
          TypeShort: type?.TypeShort || '',
          TypeIcon: type?.Icon || '',
          TypePK_ID: typePkId,
          TypeIconUrl: cachedIconUrl
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

      // Note: Icon images will be loaded after selectedServices is populated
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
        }
        
        // Debug logging for status and datetime
        if (service.Status) {
        }
        
        return {
          instanceId: this.generateInstanceId(),
          serviceId: service.PK_ID || service.ServiceID,
          offersId: offer?.OffersID || '', // Get OffersID from the matched offer
          typeId: service.TypeID.toString(),
          typeName: offer?.TypeName || offer?.Service_Name || 'Service',
          typeShort: offer?.TypeShort || '',
          typeIcon: offer?.TypeIcon || '',
          typeIconUrl: offer?.TypeIconUrl || '',  // Include the loaded icon URL
          dateOfInspection: service.DateOfInspection || new Date().toISOString(),
          serviceFee: service.ServiceFee != null ? parseFloat(service.ServiceFee) || 0 : (offer?.ServiceFee ? parseFloat(offer.ServiceFee) || 0 : 0),
          ReportFinalized: service.Status === 'Finalized' || service.Status === 'Updated' || service.Status === 'Under Review' || service.ReportFinalized || false,
          Status: service.Status || '',
          StatusID: service.StatusID || null,  // FK to LPS_Status.StatusID
          StatusDateTime: service.StatusDateTime || '',
          // Deliverables fields - preload StatusEng with Status if not set
          StatusEng: service.StatusEng || service.Status || '',
          Deliverable: service.Deliverable || '',
          EngNotes: service.EngNotes || '',
          InspectorNotes: service.InspectorNotes || ''
        };
      });

      // Apply pending finalized service flag if present
      if (this.pendingFinalizedServiceId) {

        // Try both string and number comparison
        const service = this.selectedServices.find(s =>
          s.serviceId === this.pendingFinalizedServiceId ||
          s.serviceId === String(this.pendingFinalizedServiceId) ||
          String(s.serviceId) === String(this.pendingFinalizedServiceId)
        );

        if (service) {
          service.ReportFinalized = true;
          
          // Mark that changes have been made (for Re-Submit button)
          if (service.serviceId) {
            this.changesAfterSubmission[service.serviceId] = true;
          }
          
          this.changeDetectorRef.markForCheck();
        } else {
          console.warn('[ProjectDetail] Service not found with serviceId:', this.pendingFinalizedServiceId);
        }
        this.pendingFinalizedServiceId = null;
      }

      // Set default services tab based on whether services exist
      this.servicesTab = this.selectedServices.length > 0 ? 'active' : 'add';

      // Trigger progress calculation for Engineers Foundation services
      let foundEngineersFoundation = false;
      this.selectedServices.forEach(service => {
        if (service.typeName === 'Engineers Foundation Evaluation' && service.serviceId) {
          foundEngineersFoundation = true;

          // Pre-calculate progress to populate cache
          this.calculateEngineersFoundationProgress(service).then(progress => {
            const cacheKey = `${this.projectId}_${service.serviceId}`;
            this.templateProgressCache[cacheKey] = {
              progress,
              timestamp: Date.now()
            };
            // Trigger change detection to update the view
            this.changeDetectorRef.markForCheck();
          }).catch(error => {
            // Error handling - could log to console if needed
          });
        }
      });

      if (!foundEngineersFoundation) {
      }

      this.updateDocumentsList();
    } catch (error) {
      console.error('Error loading existing services:', error);
    }
  }

  async loadAttachTemplates() {
    try {
      this.attachTemplates = (await this.caspioService.getAttachTemplates().toPromise()) || [];
    } catch (error) {
      console.error('Error loading attach templates:', error);
    }
  }

  async loadExistingAttachments(bypassCache: boolean = true) {
    this.loadingDocuments = true;
    try {
      // ALWAYS bypass cache on page entry for critical user-facing data
      // This ensures users see the most recent data after mutations
      // Cache invalidation happens automatically after mutations, but this is a safety measure

      // Use actual ProjectID from project data for querying attachments
      const projectId = this.project?.ProjectID || this.projectId;
      // Always bypass cache (useCache = false) for fresh data
      const attachments = await this.caspioService.getAttachmentsByProject(projectId, false).toPromise();

      // Sort attachments by AttachID to maintain consistent order (oldest to newest)
      this.existingAttachments = (attachments || []).sort((a: any, b: any) => {
        const idA = parseInt(a.AttachID) || 0;
        const idB = parseInt(b.AttachID) || 0;
        return idA - idB;
      });

      this.updateDocumentsList();

      // Restore any pending documents from localStorage
      this.loadPendingDocumentsFromStorage();

      // Update storage to remove any pending docs that are now uploaded
      this.savePendingDocumentsToStorage();
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
    if (service.serviceFee != null) {
      return service.serviceFee;
    }
    const offer = this.availableOffers.find(o => o.OffersID === service.offersId);
    if (offer && offer.ServiceFee) {
      return parseFloat(offer.ServiceFee) || 0;
    }
    return 0;
  }

  async updateServicePrice(service: ServiceSelection, event: Event) {
    const input = event.target as HTMLInputElement;
    const newFee = parseFloat(input.value) || 0;
    service.serviceFee = newFee;

    if (!service.serviceId) return;

    try {
      await this.caspioService.put(
        `/tables/LPS_Services/records?q.where=PK_ID='${service.serviceId}'`,
        { ServiceFee: newFee }
      ).toPromise();
    } catch (error) {
      console.error('[ProjectDetail] Error updating service fee:', error);
    }

    this.changeDetectorRef.markForCheck();
  }

  calculateServicesTotal(): number {
    let total = 0;
    for (const service of this.selectedServices) {
      total += this.getServicePrice(service);
    }
    return total;
  }

  calculateProjectBalance(): number {
    return this.projectInvoiceBalance;
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
    
    return allUploaded;
  }

  async toggleService(event: any, offer: any) {
    if (this.isReadOnly) {
      return;
    }
    const isChecked = event.detail.checked;
    
    if (isChecked) {
      await this.addService(offer);
    } else {
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
      
      if (currentMode === 'add-service' && this.project) {
        // Update project status to Active (StatusID = 7) when adding service to completed project
        const projectPkId = this.project.PK_ID;
        const projectId = this.project.ProjectID;

        if (projectPkId) {
          try {
            const updateUrl = `/tables/LPS_Projects/records?q.where=ProjectID=${projectId}`;
            const updateData = {
              StatusID: 7  // Active status
            };

            await this.caspioService.put<any>(updateUrl, updateData).toPromise();

            // Update local project object
            this.project.StatusID = 7;
            this.isReadOnly = false;
            this.changeDetectorRef.markForCheck();
            // Toast removed per user request
          } catch (error: any) {
            console.error('Error updating project status:', error);
            // Continue with service creation even if status update fails
            await this.showToast('Warning: Could not update project status', 'warning');
          }
        } else {
          console.error('No PK_ID available for status update');
        }
      }
      
      // Create service record in Caspio - Services table only has ProjectID, TypeID, DateOfInspection
      // IMPORTANT: Use project.ProjectID (not PK_ID) for the Services table relationship

      // Ensure we're using the correct ProjectID (the actual ProjectID field, not PK_ID)
      const projectIdToUse = this.project?.ProjectID;

      if (!projectIdToUse) {
        throw new Error(`Cannot create service: ProjectID not found. Project data: ${JSON.stringify({
          PK_ID: this.project?.PK_ID,
          ProjectID: this.project?.ProjectID,
          routeId: this.projectId
        })}`);
      }

      // Ensure status options are loaded before creating service (fixes first-project-after-login issue)
      await this.ensureStatusOptionsLoaded();

      // Get StatusAdmin values from Status table
      const inProgressStatus = this.getStatusAdminByClient("In Progress");
      const createdStatus = this.getStatusAdminByClient("Created");

      const serviceData = {
        ProjectID: projectIdToUse, // Use actual ProjectID from project (the numeric ProjectID field)
        TypeID: offer.TypeID,
        DateOfInspection: new Date().toISOString().split('T')[0], // Format as YYYY-MM-DD for date input
        Status: inProgressStatus, // Set status to "In Progress" (using StatusAdmin from Status table)
        StatusID: 7, // FK to LPS_Status.StatusID - default status for new services
        StatusEng: createdStatus // Set StatusEng to "Created" (using StatusAdmin from Status table)
      };


      const newService = await this.caspioService.createService(serviceData).toPromise();

      // Create corresponding invoice record in LPS_Invoices with positive fee
      const serviceFee = parseFloat(offer.ServiceFee) || 0;
      if (serviceFee > 0) {
        try {
          await firstValueFrom(
            this.caspioService.post<any>('/tables/LPS_Invoices/records', {
              ProjectID: Number(projectIdToUse),
              ServiceID: Number(offer.TypeID),
              Fee: Number(serviceFee.toFixed(2)),
              Date: new Date().toISOString().split('T')[0],
              Address: String(this.project?.Address || ''),
              City: String(this.project?.City || ''),
              StateID: this.project?.StateID ? Number(this.project.StateID) : null,
              Zip: String(this.project?.Zip || '')
            })
          );
          this.projectInvoiceBalance += serviceFee;
        } catch (invoiceError) {
          console.error('Error creating invoice for service:', invoiceError);
        }
      }

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
        typeShort: offer.TypeShort || '',
        typeIcon: offer.TypeIcon || '',
        typeIconUrl: offer.TypeIconUrl || '',  // Include the pre-loaded base64 icon
        dateOfInspection: serviceData.DateOfInspection,
        ReportFinalized: false,  // New services are not finalized
        Status: serviceData.Status,  // StatusAdmin value for "In Progress"
        StatusID: 7,  // FK to LPS_Status.StatusID - default status for new services
        StatusEng: serviceData.StatusEng,  // StatusAdmin value for "Created"
        StatusDateTime: new Date().toISOString()  // Set current timestamp
      };
      
      
      this.selectedServices.push(selection);
      this.updateDocumentsList();

      // OPTIMIZATION: Track mutation for automatic cache invalidation
      const actualProjectId = this.project?.ProjectID || this.projectId;
      if (selection.serviceId) {
        this.mutationTracker.trackServiceMutation(
          MutationType.CREATE,
          selection.serviceId,
          actualProjectId,
          selection
        );
      }

      // CRITICAL: Clear all caches to ensure fresh data on page reload
      // Clear the static component cache (in-memory)
      ProjectDetailPage.detailStateCache.delete(this.projectId);

      // Clear the ProjectsService cache for this specific project
      this.projectsService.clearProjectDetailCache(this.projectId);

      // Clear the CaspioService cache for Services table
      this.caspioService.clearServicesCache(actualProjectId);

      // CRITICAL: Trigger change detection for OnPush strategy (webapp)
      this.changeDetectorRef.markForCheck();

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
      cssClass: 'custom-document-alert',
      buttons: [
        {
          text: 'REMOVE',
          cssClass: 'alert-button-save',
          handler: async () => {
            await this.performRemoveService(service);
          }
        },
        {
          text: 'CANCEL',
          role: 'cancel',
          cssClass: 'alert-button-cancel'
        }
      ]
    });
    
    await alert.present();
  }

  private async performRemoveService(service: ServiceSelection) {
    if (this.isReadOnly) {
      return;
    }

    // TypeScript guard: Ensure serviceId exists before deletion
    if (!service.serviceId) {
      console.error('Cannot delete service: missing serviceId');
      this.showToast('Failed to remove service: Invalid service ID', 'danger');
      return;
    }

    this.updatingServices = true;

    const actualProjectId = this.project?.ProjectID || this.projectId;
    const serviceId = service.serviceId; // Capture for closure

    // Delete corresponding invoice from LPS_Invoices matching ProjectID and ServiceID (TypeID)
    if (this.project?.ProjectID && service.typeId) {
      try {
        const serviceFee = this.getServicePrice(service);
        await firstValueFrom(
          this.caspioService.delete<any>(
            `/tables/LPS_Invoices/records?q.where=ProjectID=${Number(this.project.ProjectID)} AND ServiceID=${Number(service.typeId)} AND Fee>0`
          )
        );
        this.projectInvoiceBalance -= serviceFee;
        this.changeDetectorRef.markForCheck();
      } catch (invoiceError) {
        console.error('Error deleting invoice for service:', invoiceError);
      }
    }

    // OPTIMIZATION: Use optimistic update for instant removal
    this.optimisticUpdate.removeFromArray(
      this.selectedServices,
      service,
      () => this.caspioService.deleteService(serviceId),
      () => {
        // On success

        // Track mutation for automatic cache invalidation
        this.mutationTracker.trackServiceMutation(
          MutationType.DELETE,
          serviceId,
          actualProjectId
        );

        // Update documents list
        this.updateDocumentsList();

        // Clear all caches to ensure fresh data on page reload
        ProjectDetailPage.detailStateCache.delete(this.projectId);
        this.projectsService.clearProjectDetailCache(this.projectId);
        this.caspioService.clearServicesCache(actualProjectId);

        this.updatingServices = false;
        this.changeDetectorRef.markForCheck();
      },
      (error) => {
        // On error (item already rolled back by OptimisticUpdateService)
        console.error('❌ Error deleting service:', error);
        this.showToast('Failed to remove service', 'danger');
        this.updatingServices = false;
        this.changeDetectorRef.markForCheck();
      }
    ).subscribe();

    // Service removed from UI instantly - no need to wait for API
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

  async duplicateService(offersId: string, typeName: string, event?: Event) {
    if (event) {
      event.stopPropagation(); // Prevent row expansion toggle
    }
    if (this.isReadOnly) {
      return;
    }
    const offer = this.availableOffers.find(o => o.OffersID === offersId);
    if (offer) {
      await this.addService(offer);
    }
  }

  async removeOneServiceInstance(offersId: string, event?: Event) {
    if (event) {
      event.stopPropagation(); // Prevent row expansion toggle
    }
    if (this.isReadOnly) {
      return;
    }
    
    const services = this.selectedServices.filter(s => s.offersId === offersId);
    if (services.length > 0) {
      // Remove the last instance
      const lastService = services[services.length - 1];
      await this.removeServiceInstance(lastService);
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

  // Check if there are multiple instances of the same service type in documents
  hasMultipleDocumentInstances(typeId: string): boolean {
    return this.serviceDocuments.filter(sd => sd.typeId === typeId).length > 1;
  }

  getServiceInstanceNumber(service: ServiceSelection): number {
    const sameTypeServices = this.selectedServices.filter(s => s.offersId === service.offersId);
    return sameTypeServices.findIndex(s => s.instanceId === service.instanceId) + 1;
  }

  // Get all instances of a specific service type
  getServiceInstances(offersId: string): ServiceSelection[] {
    return this.selectedServices.filter(s => s.offersId === offersId);
  }

  hasTemplate(service: ServiceSelection): boolean {
    const name = service.typeName?.toLowerCase() || '';
    const typeShort = service.typeShort?.toUpperCase() || '';
    return !name.includes('defect cost report') &&
           !name.includes('engineers inspection review') &&
           !name.includes("engineer's inspection review") &&
           typeShort !== 'ENG';
  }

  getServiceDocumentGroup(service: ServiceSelection): ServiceDocumentGroup | undefined {
    if (!service.serviceId && !service.instanceId) return undefined;
    const id = service.serviceId || service.instanceId;
    return this.serviceDocuments.find(sd => sd.serviceId === id);
  }

  // Check if service has been submitted before
  hasBeenSubmitted(service: ServiceSelection): boolean {
    return service.Status === 'Under Review';
  }

  // Check if submit button should be enabled (orange) for a service
  isSubmitButtonEnabled(service: ServiceSelection): boolean {
    const typeName = service.typeName?.toLowerCase() || '';
    const typeShort = service.typeShort?.toUpperCase() || '';
    const isDCR = typeShort === 'DCR' || typeName.includes('defect cost report');
    const isEIR = typeShort === 'EIR' || typeName.includes('engineers inspection review') || typeName.includes("engineer's inspection review");
    const isENG = typeShort === 'ENG';

    // If already submitted (Status = "Under Review"), only enable if changes have been made
    if (this.hasBeenSubmitted(service)) {
      const hasChanges = this.changesAfterSubmission[service.serviceId || ''] === true;
      return hasChanges;
    }

    // For EFE reports, enable if ReportFinalized is true (works for both initial submission and updates)
    if (service.ReportFinalized) {
      return true;
    }

    // For DCR, EIR, and ENG, enable if required document (Property Inspection Report) is uploaded
    if (isDCR || isEIR || isENG) {
      // Find the service documents for this service
      const serviceDoc = this.serviceDocuments.find(sd => sd.serviceId === service.serviceId);
      if (serviceDoc) {
        // Check if Property Inspection Report or Home Inspection Report is uploaded
        const requiredDoc = serviceDoc.documents.find(doc =>
          doc.uploaded && (
            doc.title.toLowerCase().includes('property inspection report') ||
            doc.title.toLowerCase().includes('home inspection report')
          )
        );
        const enabled = !!requiredDoc;
        return enabled;
      }
    }

    return false;
  }

  // Toggle service expanded (add first instance if not selected, or navigate to it if already selected)
  async toggleServiceExpanded(offer: any) {
    if (this.isReadOnly) {
      return;
    }

    const isSelected = this.isServiceSelected(offer.OffersID);

    if (!isSelected) {
      // Add first instance of this service
      await this.addService(offer);
    } else if (this.servicesTab === 'add') {
      // On Add Services tab, clicking an already-selected service adds another instance
      await this.duplicateService(offer.OffersID, offer.TypeName);
    }
    // If already selected on Active tab, the expansion is handled by the template's *ngIf
  }

  getSortedServices(): ServiceSelection[] {
    const order = ['EIR', 'EFE', 'DCR', 'HUD', 'ELBW', 'ECSA', 'EWPI', 'EDTE', 'OTHER'];

    return [...this.selectedServices].sort((a, b) => {
      // Use typeShort field directly
      const typeA = a.typeShort || 'OTHER';
      const typeB = b.typeShort || 'OTHER';

      const indexA = order.indexOf(typeA);
      const indexB = order.indexOf(typeB);

      // If both are in the order array, sort by position
      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }

      // If only A is in order, A comes first
      if (indexA !== -1) return -1;

      // If only B is in order, B comes first
      if (indexB !== -1) return 1;

      // If neither is in order, sort alphabetically by typeName
      return a.typeName.localeCompare(b.typeName);
    });
  }

  // TrackBy function to prevent DOM re-creation on change detection
  trackByOfferId(index: number, offer: any): string {
    return offer.OffersID;
  }

  getSortedOffers(): any[] {
    // WEBAPP: Cache sorted offers to prevent array re-creation on every template read
    // This prevents click events from hitting wrong elements due to DOM re-creation
    const cacheKey = this.availableOffers.map(o => o.OffersID).join(',');

    if (cacheKey === this.sortedOffersCacheKey && this.sortedOffersCache.length > 0) {
      return this.sortedOffersCache;
    }

    const order = ['EIR', 'EFE', 'DCR', 'HUD', 'ELBW', 'ECSA', 'EWPI', 'EDTE', 'OTHER'];

    this.sortedOffersCache = [...this.availableOffers].sort((a, b) => {
      // Use TypeShort field directly
      const typeA = a.TypeShort || 'OTHER';
      const typeB = b.TypeShort || 'OTHER';

      const indexA = order.indexOf(typeA);
      const indexB = order.indexOf(typeB);

      // If both are in the order array, sort by position
      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }

      // If only A is in order, A comes first
      if (indexA !== -1) return -1;

      // If only B is in order, B comes first
      if (indexB !== -1) return 1;

      // If neither is in order, sort alphabetically by TypeName
      return (a.TypeName || '').localeCompare(b.TypeName || '');
    });

    this.sortedOffersCacheKey = cacheKey;
    return this.sortedOffersCache;
  }

  onServicesTabChange(event: any) {
    this.servicesTab = event.detail.value;
  }

  getFilteredOffers(): any[] {
    const sorted = this.getSortedOffers();
    if (this.servicesTab === 'active') {
      return sorted.filter(offer => this.isServiceSelected(offer.OffersID));
    }
    // Add Services tab shows ALL offers (even already-selected ones)
    return sorted;
  }

  getServicesForTemplates(): ServiceSelection[] {
    const cacheKey = this.selectedServices
      .map(service => `${service.offersId}:${service.instanceId}:${service.serviceId ?? ''}`)
      .join('|');

    if (cacheKey !== this.templateServicesCacheKey) {
      this.templateServicesCacheKey = cacheKey;
      this.templateServicesCache = this.selectedServices.filter(service => {
        const name = service.typeName?.toLowerCase() || '';
        const short = service.typeShort?.toUpperCase() || '';
        return !name.includes('defect cost report') &&
               !name.includes('engineers inspection review') &&
               !name.includes("engineer's inspection review") &&
               short !== 'ENG';
      });
    }

    return this.templateServicesCache;
  }

  trackTemplateService(_: number, service: ServiceSelection) {
    return `${service.offersId}-${service.instanceId}`;
  }

  trackServiceDocument(_: number, group: ServiceDocumentGroup) {
    return `${group.serviceId}-${group.instanceNumber}`;
  }

  trackDocument(_: number, doc: DocumentItem) {
    return doc.attachId || doc.title;
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

  async updateNotes() {
    if (!this.project || this.isReadOnly) {
      return;
    }

    this.savingNotes = true;
    this.notesSaved = false;

    try {
      // Projects table uses PK_ID as primary key for updates
      const projectId = this.project.PK_ID;
      if (!projectId) {
        throw new Error('Project ID not found');
      }

      await this.caspioService.updateProject(projectId.toString(), {
        Notes: this.project.Notes || ''
      }).toPromise();

      // Show saved indicator briefly
      this.notesSaved = true;
      setTimeout(() => {
        this.notesSaved = false;
      }, 2000);

    } catch (error) {
      console.error('Error updating notes:', error);
      await this.showToast('Failed to update notes', 'danger');
    } finally {
      this.savingNotes = false;
    }
  }

  async loadStatusOptions() {
    try {
      const response = await this.caspioService.get<any>('/tables/LPS_Status/records').toPromise();
      if (response && response.Result) {
        this.statusOptions = response.Result;

        // Verify "Created" exists
        const createdRecord = this.statusOptions.find((s: any) => s.Status_Client === 'Created');

        // Verify "In Progress" exists
        const inProgressRecord = this.statusOptions.find((s: any) => s.Status_Client === 'In Progress');
      }
    } catch (error) {
      console.error('Error loading status options:', error);
    }
  }

  // Ensure status options are loaded before using them (fixes first-project-after-login issue)
  async ensureStatusOptionsLoaded(): Promise<void> {
    // If already loaded with valid data, return immediately
    if (this.statusOptions && this.statusOptions.length > 0) {
      return;
    }


    // Try loading up to 3 times with small delays
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.loadStatusOptions();

        if (this.statusOptions && this.statusOptions.length > 0) {
          return;
        }

        // Wait a bit before retrying
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`[Status] Attempt ${attempt} failed:`, error);
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }

    console.warn('[Status] Could not load status options after 3 attempts, proceeding with fallback values');
  }

  // Helper method to get Status_Admin value by Status_Client lookup
  getStatusAdminByClient(statusClient: string): string {
    
    const statusRecord = this.statusOptions.find(s => s.Status_Client === statusClient);
    
    if (statusRecord && statusRecord.Status_Admin) {
      return statusRecord.Status_Admin;
    }
    // Fallback to StatusClient if Status_Admin not found
    console.warn(`[Status] Status_Admin not found for Status_Client "${statusClient}", using Status_Client as fallback`);
    console.warn(`[Status] This means StatusEng will be set to "${statusClient}" instead of a Status_Admin value`);
    return statusClient;
  }

  // Helper method to get Status_Client value by Status_Admin lookup (for display)
  getStatusClientByAdmin(statusAdmin: string): string {
    if (!statusAdmin) {
      return '';
    }
    const statusRecord = this.statusOptions.find(s => s.Status_Admin === statusAdmin);
    if (statusRecord && statusRecord.Status_Client) {
      return statusRecord.Status_Client;
    }
    // Fallback to Status_Admin if Status_Client not found (or if it's a legacy value)
    // This handles backwards compatibility with old hardcoded values
    return statusAdmin;
  }

  // Helper method to get Status_Client value by StatusID lookup (for client-facing display)
  getStatusClientById(statusId: number | undefined): string {
    if (!statusId && statusId !== 0) {
      return '';
    }
    // Use string comparison to handle potential type mismatches from Caspio API
    // Only search by StatusID field (not PK_ID, which is a different value)
    const statusIdStr = String(statusId);
    const statusRecord = this.statusOptions.find(s => String(s.StatusID) === statusIdStr);
    if (statusRecord && statusRecord.Status_Client) {
      return statusRecord.Status_Client;
    }
    console.warn(`[Status Lookup] No Status_Client found for StatusID: ${statusId}`);
    return '';
  }

  // Deliverables methods (for CompanyID = 1)
  async updateDeliverableField(service: ServiceSelection, fieldName: string, value: string) {
    if (!service.serviceId || this.isReadOnly) {
      return;
    }

    try {
      const updateData: any = {};
      updateData[fieldName] = value;

      await this.caspioService.updateService(service.serviceId, updateData).toPromise();

      // Update local service object
      service[fieldName] = value;

      // Silent update - no toast notification
    } catch (error) {
      console.error(`Error updating ${fieldName}:`, error);
      await this.showToast(`Failed to update ${fieldName}`, 'danger');
    }
  }

  async updateServiceStatus(service: ServiceSelection, statusId: number) {
    if (!service.serviceId || this.isReadOnly) {
      return;
    }

    try {
      await this.caspioService.updateService(service.serviceId, { StatusID: statusId }).toPromise();

      // Update local service object
      service.StatusID = statusId;

      // Check if all services are now complete (StatusID = 5) → auto-complete the project
      if (this.selectedServices.length > 0 &&
          this.selectedServices.every(s => Number(s.StatusID) === 5)) {
        const projectPkId = this.project?.PK_ID;
        if (projectPkId) {
          await this.projectsService.updateProjectStatus(projectPkId, 5).toPromise();
          this.project!.StatusID = 5;
          this.isReadOnly = true;
          this.changeDetectorRef.markForCheck();
        }
      }
    } catch (error) {
      console.error('Error updating service status:', error);
      await this.showToast('Failed to update status', 'danger');
    }
  }

  async uploadDeliverableFile(service: ServiceSelection, event: any) {
    const file = event.target.files[0];
    if (!file || !service.serviceId || this.isReadOnly) {
      return;
    }

    let loading: any = null;

    try {
      loading = await this.loadingController.create({
        message: 'Uploading deliverable...'
      });
      await loading.present();

      // Step 1: Upload file to Caspio Files storage
      const uploadResult = await this.caspioService.uploadFile(file).toPromise();


      // Extract file path from various possible response formats
      let filePath = null;
      if (uploadResult) {
        // Try different response formats
        filePath = uploadResult.Name ||
                   uploadResult.name ||
                   uploadResult.FileName ||
                   uploadResult.fileName ||
                   uploadResult.Result?.Name ||
                   uploadResult.Result?.name ||
                   uploadResult.Result?.FileName ||
                   uploadResult.Result?.fileName;
      }

      if (!filePath) {
        console.error('Full upload result:', JSON.stringify(uploadResult));
        throw new Error('File upload failed - no file path returned');
      }

      // Ensure file path starts with /
      if (!filePath.startsWith('/')) {
        filePath = '/' + filePath;
      }


      // Step 2: Update the Services record with the file path in the Deliverable field
      await this.caspioService.updateService(service.serviceId, {
        Deliverable: filePath
      }).toPromise();

      // Update local service object
      service.Deliverable = filePath;
      this.changeDetectorRef.markForCheck();

      await this.showToast('Deliverable uploaded successfully', 'success');
    } catch (error) {
      console.error('Error uploading deliverable:', error);
      await this.showToast('Failed to upload deliverable', 'danger');
    } finally {
      if (loading) {
        await loading.dismiss();
      }
      // Clear file input
      event.target.value = '';
      this.changeDetectorRef.markForCheck();
    }
  }

  getDeliverableUrl(service: ServiceSelection): string | null {
    // The Deliverable field will contain the file path from Caspio
    // When Caspio returns file field values, they should be usable URLs
    return service.Deliverable || null;
  }

  hasDeliverable(service: ServiceSelection): boolean {
    return !!service.Deliverable;
  }

  getDeliverableFilename(service: ServiceSelection): string {
    if (!service.Deliverable) return '';
    return service.Deliverable.split('/').pop() || `${service.typeName} Deliverable`;
  }

  getDeliverablesServices(): ServiceSelection[] {
    if (this.isCompanyOne) {
      // CompanyID = 1 (Admins): Show all services at all stages
      return this.selectedServices;
    } else {
      // Other companies (Clients): Only show services with StatusID = 5 (Complete)
      return this.selectedServices.filter(s => s.StatusID === 5);
    }
  }

  toggleDeliverableExpanded(service: ServiceSelection) {
    const key = `${service.offersId}-${service.instanceId}`;
    if (this.expandedDeliverables.has(key)) {
      this.expandedDeliverables.delete(key);
    } else {
      this.expandedDeliverables.add(key);
    }
  }

  isDeliverableExpanded(service: ServiceSelection): boolean {
    const key = `${service.offersId}-${service.instanceId}`;
    return this.expandedDeliverables.has(key);
  }

  async viewDeliverableFile(service: ServiceSelection) {
    if (!service.Deliverable || !service.serviceId) {
      await this.showToast('No deliverable file available', 'warning');
      return;
    }

    try {
      let cancelled = false;

      // Create loading alert with cancel button
      const loading = await this.alertController.create({
        header: 'Loading Document',
        message: 'Loading deliverable...',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            handler: () => {
              cancelled = true;
              return true;
            }
          }
        ],
        backdropDismiss: false,
        cssClass: 'custom-document-alert'
      });
      await loading.present();

      // Set up the cancel flag
      loading.onDidDismiss().then((result) => {
        if (result.role === 'cancel' || result.data === 'cancelled') {
          cancelled = true;
        }
      });

      // Use the Deliverable path we already have in the service object
      const filePath = service.Deliverable;

      // Fetch the actual file using the Deliverable field path
      const fileData = await this.caspioService.getFileFromPath(filePath).toPromise();


      // Dismiss loading
      try {
        await loading.dismiss();
      } catch (e) {
        // Already dismissed
      }

      // If cancelled, return early
      if (cancelled) {
        return;
      }

      if (!fileData || !fileData.url) {
        await this.showToast('Failed to load deliverable', 'danger');
        return;
      }

      const filename = `${service.typeName}_deliverable`;

      // Check if it's a PDF
      const isPDF = filePath.toLowerCase().includes('.pdf') ||
                   fileData.type === 'application/pdf';


      if (isPDF) {
        // Use PDF viewer for PDFs
        const DocumentViewerComponent = await this.loadDocumentViewer();
        const modal = await this.modalController.create({
          component: DocumentViewerComponent,
          componentProps: {
            fileUrl: fileData.url,
            fileName: filename,
            fileType: 'pdf',
            filePath: filePath
          },
          cssClass: 'fullscreen-modal'
        });
        await modal.present();
      } else {
        // For images or other files, use image viewer
        const modal = await this.modalController.create({
          component: ImageViewerComponent,
          componentProps: {
            images: [{
              url: fileData.url,
              title: filename,
              filename: filename
            }],
            initialIndex: 0
          }
        });
        await modal.present();
      }
    } catch (error) {
      console.error('Error viewing deliverable:', error);
      await this.showToast('Failed to view deliverable', 'danger');
    }
  }

  async deleteDeliverableFile(service: ServiceSelection) {
    if (!service.Deliverable || !service.serviceId) {
      return;
    }

    // G2-UX-004: Confirmation dialog with keyboard accessibility (web only)
    const result = await this.confirmationDialog.confirmDeleteItem('Deliverable File');

    if (result.confirmed) {
      try {
        const loading = await this.loadingController.create({
          message: 'Deleting deliverable...'
        });
        await loading.present();

        // Clear the Deliverable field in the Services table
        await this.caspioService.updateService(service.serviceId!, {
          Deliverable: ''
        }).toPromise();

        // Update local service object
        service.Deliverable = '';

        await loading.dismiss();
        await this.showToast('Deliverable deleted successfully', 'success');
      } catch (error) {
        console.error('Error deleting deliverable:', error);
        await this.showToast('Failed to delete deliverable', 'danger');
      }
    }
  }

  async downloadDeliverableFile(service: ServiceSelection) {
    if (!service.Deliverable) {
      await this.showToast('No deliverable file available', 'warning');
      return;
    }

    try {
      const loading = await this.loadingController.create({
        message: 'Downloading...'
      });
      await loading.present();

      // Fetch the file from Caspio
      const filePath = service.Deliverable;
      const fileData = await this.caspioService.getFileFromPath(filePath).toPromise();

      await loading.dismiss();

      if (!fileData || !fileData.blob) {
        await this.showToast('Failed to download deliverable', 'danger');
        return;
      }

      // Extract filename from path or use service name
      let filename = filePath.split('/').pop() || `${service.typeName}_deliverable`;

      // Ensure filename has extension
      if (!filename.includes('.')) {
        if (fileData.type === 'application/pdf') {
          filename += '.pdf';
        }
      }

      // Create a blob URL and trigger download
      const blobUrl = URL.createObjectURL(fileData.blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up the blob URL after a short delay
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 100);

      await this.showToast('Download started', 'success');
    } catch (error) {
      console.error('Error downloading deliverable:', error);
      await this.showToast('Failed to download deliverable', 'danger');
    }
  }

  // Document management methods
  updateDocumentsList() {
    // Store ALL documents (uploaded and pending) with their original order
    const existingDocs: Map<string, Map<string, { doc: DocumentItem, order: number }>> = new Map();
    for (const serviceDoc of this.serviceDocuments) {
      const docMap = new Map<string, { doc: DocumentItem, order: number }>();
      serviceDoc.documents.forEach((doc, index) => {
        // Use title as key to match documents
        docMap.set(doc.title, { doc, order: index });
      });
      existingDocs.set(serviceDoc.serviceId, docMap);
    }

    this.serviceDocuments = [];

    for (const service of this.selectedServices) {
      // Get ALL templates for this service type where Auto = 'Yes'
      const autoTemplates = this.attachTemplates.filter(t =>
        t.TypeID === parseInt(service.typeId) &&
        (t.Auto === 'Yes' || t.Auto === true || t.Auto === 1)
      );

      const documents: DocumentItem[] = [];

      // Add documents ONLY from templates in the database where Auto = 'Yes'
      if (autoTemplates.length > 0) {
        // Use actual templates from database
        for (const template of autoTemplates) {
          // Find ALL attachments for this specific service instance
          // Filter by ServiceID stored in Notes field (for multiple instances of same type)
          const attachments = this.existingAttachments.filter(a => {
            // Must match TypeID
            if (a.TypeID !== parseInt(service.typeId)) return false;
            // Must match Title (including versioned variants like "Title #2", "Title #3", etc.)
            const titleMatches = a.Title === template.Title ||
                                 a.Title.match(new RegExp(`^${template.Title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} #\\d+$`));
            if (!titleMatches) return false;
            
            // Extract ServiceID from Notes field [SID:123]
            const attachServiceId = this.extractServiceIdFromNotes(a.Notes);
            
            // If attachment has ServiceID in Notes, must match this service instance
            if (attachServiceId && service.serviceId) {
              return attachServiceId === parseInt(service.serviceId);
            }
            
            // BACKWARD COMPATIBILITY: If no ServiceID in Notes
            // Only show in FIRST instance (#1) of this service type to prevent duplicates
            if (!attachServiceId) {
              const instanceNum = this.getServiceInstanceNumber(service);
              return instanceNum === 1; // Only show in first instance
            }
            
            return false;
          });


          // Sort attachments by AttachID to maintain consistent order
          attachments.sort((a: any, b: any) => {
            const idA = parseInt(a.AttachID) || 0;
            const idB = parseInt(b.AttachID) || 0;
            return idA - idB;
          });

          // If there are attachments, create a document item for each one (including versioned ones)
          if (attachments.length > 0) {
            for (const attachment of attachments) {
              const docItem: DocumentItem = {
                attachId: attachment.AttachID,
                title: attachment.Title,  // Use actual attachment title (includes version numbers)
                required: (template.Required === 'Yes' || template.Required === true || template.Required === 1),
                uploaded: true,
                templateId: template.PK_ID,
                filename: attachment.Link,
                linkName: attachment.Link,
                attachmentUrl: attachment.Attachment,
                isLink: this.determineIfLink(attachment)
              } as any;

              documents.push(docItem);
            }
          } else {
            // No attachments yet - create placeholder document with template title
            const docItem: DocumentItem = {
              attachId: undefined,
              title: template.Title || template.AttachmentName || 'Document',
              required: (template.Required === 'Yes' || template.Required === true || template.Required === 1),
              uploaded: false,
              templateId: template.PK_ID,
              filename: undefined,
              linkName: undefined,
              attachmentUrl: undefined,
              isLink: false
            } as any;

            documents.push(docItem);
          }
        }
      }
      // NO FALLBACK - only use templates from database
      
      // Create the service document group (but don't set documents yet)
      const serviceDocGroup = {
        serviceId: service.serviceId || service.instanceId,
        serviceName: service.typeName,
        typeShort: service.typeShort,
        typeId: service.typeId,
        instanceNumber: this.getServiceInstanceNumber(service),
        documents: [] as DocumentItem[]  // Will set this after all documents are added
      };

      // Add back any pending documents and check if they've been uploaded
      const storedDocsForService = existingDocs.get(serviceDocGroup.serviceId);
      if (storedDocsForService) {
        // Get all pending documents from stored order
        const pending = Array.from(storedDocsForService.values())
          .filter(item => !item.doc.uploaded)
          .map(item => item.doc);

        // Add all pending documents back to the list
        for (const pendingDoc of pending) {
          // Check if this pending document has now been uploaded for THIS specific service instance
          // Also check for versioned variants of the title
          const uploadedAttachment = this.existingAttachments.find(a => {
            if (a.TypeID !== parseInt(service.typeId)) return false;
            // Match exact title or versioned variant
            const titleMatches = a.Title === pendingDoc.title ||
                                 a.Title.match(new RegExp(`^${pendingDoc.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} #\\d+$`));
            if (!titleMatches) return false;
            
            // Extract ServiceID from Notes field [SID:123]
            const attachServiceId = this.extractServiceIdFromNotes(a.Notes);
            
            // If attachment has ServiceID in Notes, must match this service instance
            if (attachServiceId && service.serviceId) {
              return attachServiceId === parseInt(service.serviceId);
            }
            
            // BACKWARD COMPATIBILITY: If no ServiceID in Notes
            // Only match for FIRST instance (#1) to prevent duplicates across instances
            if (!attachServiceId) {
              const instanceNum = this.getServiceInstanceNumber(service);
              return instanceNum === 1;
            }
            
            return false;
          });

          if (uploadedAttachment) {
            const updatedDoc = {
              ...pendingDoc,
              title: uploadedAttachment.Title,  // Use actual title from database (may include version number)
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
      
      // Find orphan attachments - those that aren't already in our documents list
      const orphanAttachments = this.existingAttachments.filter(a => {
        // Must match the TypeID
        if (a.TypeID !== parseInt(service.typeId)) return false;
        
        // Extract ServiceID from Notes field [SID:123]
        const attachServiceId = this.extractServiceIdFromNotes(a.Notes);
        
        // If attachment has ServiceID in Notes, must match this service instance
        if (attachServiceId && service.serviceId) {
          if (attachServiceId !== parseInt(service.serviceId)) return false;
        }
        
        // BACKWARD COMPATIBILITY: If no ServiceID in Notes
        // Only show in FIRST instance (#1) of this service type to prevent duplicates
        if (!attachServiceId) {
          const instanceNum = this.getServiceInstanceNumber(service);
          if (instanceNum !== 1) return false; // Skip for instances #2, #3, etc.
        }
        
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

      // Add orphan documents (only truly orphaned ones)
      for (const [title, attachments] of orphansByTitle.entries()) {
        // Sort attachments by AttachID to maintain consistent order
        attachments.sort((a: any, b: any) => {
          const idA = parseInt(a.AttachID) || 0;
          const idB = parseInt(b.AttachID) || 0;
          return idA - idB;
        });
        // This should never happen since we already filtered by accountedTitles above
        // but double-check to be safe
        if (!accountedTitles.has(title)) {
          const docItem: DocumentItem = {
            attachId: attachments[0].AttachID,
            title: title,  // Use the actual title from the attachment
            required: false,
            uploaded: true,
            filename: attachments[0].Link,
            linkName: attachments[0].Link,
            attachmentUrl: attachments[0].Attachment,
            isLink: this.determineIfLink(attachments[0]), // Determine if this is a link
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
        }
      }
      
      // Now that all documents are collected, restore original order
      // Get the stored order for this service
      const storedOrder = existingDocs.get(serviceDocGroup.serviceId);

      if (storedOrder) {
        // Sort documents by their original order
        documents.sort((a, b) => {
          const orderA = storedOrder.get(a.title)?.order ?? 999999;
          const orderB = storedOrder.get(b.title)?.order ?? 999999;
          return orderA - orderB;
        });
      } else {
        // No previous order, sort by AttachID for new services
        documents.sort((a: any, b: any) => {
          const idA = parseInt(a.attachId) || 999999;
          const idB = parseInt(b.attachId) || 999999;
          return idA - idB;
        });
      }

      serviceDocGroup.documents = documents;

      // Check for duplicate service documents before adding
      const existingServiceDocIndex = this.serviceDocuments.findIndex(
        sd => sd.serviceId === serviceDocGroup.serviceId &&
             sd.serviceName === serviceDocGroup.serviceName
      );
      
      if (existingServiceDocIndex >= 0) {
        // Replace the existing one instead of adding duplicate
        this.serviceDocuments[existingServiceDocIndex] = serviceDocGroup;
      } else {
        this.serviceDocuments.push(serviceDocGroup);
      }
    }
    
    // Check for duplicate documents within each service and remove them
    for (const sd of this.serviceDocuments) {
      const seen = new Map<string, DocumentItem>();
      const deduplicatedDocs: DocumentItem[] = [];
      
      for (const doc of sd.documents) {
        const existingDoc = seen.get(doc.title);
        
        if (!existingDoc) {
          // First occurrence of this title
          seen.set(doc.title, doc);
          deduplicatedDocs.push(doc);
        } else {
          // Duplicate found - keep the uploaded one if one is uploaded
          if (doc.uploaded && !existingDoc.uploaded) {
            // Replace the pending one with the uploaded one
            const index = deduplicatedDocs.indexOf(existingDoc);
            if (index >= 0) {
              deduplicatedDocs[index] = doc;
              seen.set(doc.title, doc);
            }
          }
          // If existingDoc is already uploaded, or both are the same status, keep the first one (ignore this duplicate)
        }
      }
      
      // Replace documents array with deduplicated version
      sd.documents = deduplicatedDocs;
    }
  }

  async uploadDocument(serviceId: string, typeId: string, doc: DocumentItem) {
    // Check if serviceId exists
    if (!serviceId) {
      console.error('No serviceId provided for document upload');
      return;
    }

    // If document already exists (uploaded or has a link), show Replace or Cancel
    if (doc.uploaded && doc.attachId) {
      const confirm = await this.alertController.create({
        header: 'Replace Document',
        message: `"${doc.title}" already exists. Do you want to replace it?`,
        cssClass: 'custom-document-alert',
        buttons: [
          {
            text: 'Replace',
            handler: () => {
              this.currentUploadContext = { serviceId, typeId, doc, action: 'replace' };
              this.fileInput.nativeElement.click();
            }
          },
          {
            text: 'Cancel',
            role: 'cancel'
          }
        ]
      });
      await confirm.present();
    } else {
      // Document doesn't exist yet, proceed with normal upload
      this.currentUploadContext = { serviceId, typeId, doc, action: 'upload' };
      this.fileInput.nativeElement.click();
    }
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
        
        if (isNaN(projectIdNum) || isNaN(typeIdNum)) {
          console.error('Invalid IDs:', { routeProjectId: this.projectId, actualProjectID: this.project?.ProjectID, typeId });
          await this.showToast('Invalid project or type ID. Please refresh and try again.', 'danger');
          throw new Error('Invalid ID values');
        }
        
        // ServiceID is NOT needed for Attach table - only ProjectID, TypeID, Title, Notes, Link, Attachment
        
        // Show upload popup with Cancel button (dismisses popup only — upload continues)
        if (environment.isWeb) {
          loading = await this.alertController.create({
            header: 'Uploading',
            message: `Uploading ${file.name}...`,
            buttons: [
              {
                text: 'Upload in Background',
                role: 'cancel'
              }
            ],
            backdropDismiss: false,
            cssClass: 'custom-document-alert'
          });
          await loading.present();
        } else {
          loading = await this.loadingController.create({
            message: 'Uploading file...',
            cssClass: 'custom-loading-popup'
          });
          await loading.present();
        }

        // Create attachment WITH file in ONE request (using Observable converted to Promise)
        // Pass serviceId to tie document to specific service instance
        const response = await this.caspioService.createAttachmentWithFile(
          projectIdNum,
          typeIdNum,
          doc.title || 'Document',
          '', // notes
          file,
          serviceId // Pass serviceId to differentiate between multiple instances
        ).toPromise();

        // Upload completed — update UI regardless of cancel flag
        // (file is already on server, so reflect it in the UI)
        if (response) {
          await this.loadExistingAttachments();
          this.changeDetectorRef.markForCheck();

          if (serviceId) {
            this.changesAfterSubmission[serviceId] = true;
          }
        }
      } else if (action === 'replace' && doc.attachId) {
        // Show replace popup with Cancel button (dismisses popup only — upload continues)
        if (environment.isWeb) {
          loading = await this.alertController.create({
            header: 'Replacing',
            message: `Replacing with ${file.name}...`,
            buttons: [
              {
                text: 'Upload in Background',
                role: 'cancel'
              }
            ],
            backdropDismiss: false,
            cssClass: 'custom-document-alert'
          });
          await loading.present();
        } else {
          loading = await this.loadingController.create({
            message: 'Replacing file...',
            cssClass: 'custom-loading-popup'
          });
          await loading.present();
        }

        // uploadFileToCaspio calls replaceAttachmentFile which updates both Attachment and Link fields
        await this.uploadFileToCaspio(doc.attachId, file);

        // Replace completed — update UI regardless of cancel flag
        // (file is already on server, so reflect it in the UI)
        await this.loadExistingAttachments();
        this.changeDetectorRef.markForCheck();

        if (serviceId) {
          this.changesAfterSubmission[serviceId] = true;
        }
      }
      
      // UI updated by reloading from database after successful mutation
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
      
      // Use the service method which handles authentication
      const response = await this.caspioService.uploadFileToAttachment(attachId, file).toPromise();
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
    // G2-UX-004: Confirmation dialog with keyboard accessibility (web only)
    const result = await this.confirmationDialog.confirmDelete({
      header: 'Delete Document',
      message: `Are you sure you want to delete "${doc.linkName || doc.filename}"? This action cannot be undone.`,
      itemName: doc.linkName || doc.filename
    });

    if (result.confirmed) {
      const loading = await this.loadingController.create({
        message: 'Deleting document...'
      });
      await loading.present();

      try {
        // Delete the attachment record
        if (doc.attachId) {
          await this.caspioService.deleteAttachment(doc.attachId).toPromise();
        }

        // Remove the attachment from our local list
        const attachIndex = this.existingAttachments.findIndex(a => a.AttachID === doc.attachId);
        if (attachIndex > -1) {
          this.existingAttachments.splice(attachIndex, 1);
        }

        // Remove the document from the serviceDocuments array
        const serviceDoc = this.serviceDocuments.find(sd => sd.serviceId === serviceId);
        if (serviceDoc) {
          const docIndex = serviceDoc.documents.findIndex(d => d === doc);
          if (docIndex > -1) {
            serviceDoc.documents.splice(docIndex, 1);
          }
        }

        await loading.dismiss();
        await this.showToast('Document deleted', 'success');

        // Update UI immediately from local state (don't re-fetch — API may have propagation delay)
        this.changeDetectorRef.detectChanges();

      } catch (error) {
        console.error('Error deleting document:', error);
        await loading.dismiss();
        await this.showToast('Failed to delete document', 'danger');
      }
    }
  }

  async removePendingDocument(serviceId: string, doc: DocumentItem) {
    // Find the service in serviceDocuments and remove the pending document
    const serviceDoc = this.serviceDocuments.find(sd => sd.serviceId === serviceId);
    if (serviceDoc) {
      const index = serviceDoc.documents.indexOf(doc);
      if (index > -1) {
        serviceDoc.documents.splice(index, 1);

        // Update localStorage and cache
        this.savePendingDocumentsToStorage();
        this.cacheCurrentState();
        this.changeDetectorRef.markForCheck();
      }
    }
  }

  async deleteAdditionalFile(serviceId: string, additionalFile: any) {
    // G2-UX-004: Confirmation dialog with keyboard accessibility (web only)
    const result = await this.confirmationDialog.confirmDelete({
      header: 'Delete Document',
      message: `Are you sure you want to delete "${additionalFile.linkName}"? This action cannot be undone.`,
      itemName: additionalFile.linkName
    });

    if (result.confirmed) {
      const loading = await this.loadingController.create({
        message: 'Deleting document...'
      });
      await loading.present();

      try {
        // Delete the attachment record
        await this.caspioService.deleteAttachment(additionalFile.attachId).toPromise();

        // Remove from local data
        const attachIndex = this.existingAttachments.findIndex(a => a.AttachID === additionalFile.attachId);
        if (attachIndex > -1) {
          this.existingAttachments.splice(attachIndex, 1);
        }

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
        await this.showToast('Document deleted', 'success');

        // Update UI immediately from local state (don't re-fetch — API may have propagation delay)
        this.changeDetectorRef.detectChanges();

      } catch (error) {
        console.error('Error deleting document:', error);
        await loading.dismiss();
        await this.showToast('Failed to delete document', 'danger');
      }
    }
  }

  async viewDocument(doc: DocumentItem) {
    // Check if this is a link - either marked as link or linkName/filename contains URL patterns
    const linkToOpen = this.extractLinkUrl(doc);

    if (linkToOpen) {
      if (environment.isWeb) {
        // Web: Open the link in a new tab
        window.open(linkToOpen, '_blank');
      } else {
        // Mobile: Show popup with the URL
        const alert = await this.alertController.create({
          header: 'External Link',
          message: `To view, visit this URL:\n\n${linkToOpen}`,
          buttons: [
            {
              text: 'Copy URL',
              handler: () => {
                navigator.clipboard.writeText(linkToOpen).then(() => {
                  this.showToast('URL copied to clipboard', 'success');
                }).catch(() => {
                  this.showToast('Failed to copy URL', 'warning');
                });
                return false; // Keep alert open
              }
            },
            {
              text: 'Open',
              handler: () => {
                window.open(linkToOpen, '_blank');
              }
            },
            {
              text: 'Close',
              role: 'cancel'
            }
          ],
          cssClass: 'custom-document-alert'
        });
        await alert.present();
      }
      return;
    }
    
    // If doc has an attachId, fetch the actual file from Caspio
    if (doc.attachId) {
      try {
        let cancelled = false;

        // Create loading alert with cancel button - MATCH Loading Report design
        const loading = await this.alertController.create({
          header: 'Loading Report',
          message: 'Loading document...',
          buttons: [
            {
              text: 'Cancel',
              role: 'cancel',
              handler: () => {
                cancelled = true;
                return true; // Allow dismissal
              }
            }
          ],
          backdropDismiss: false,
          cssClass: 'custom-document-alert'
        });
        await loading.present();

        // Set up the cancel flag only if user clicks cancel
        loading.onDidDismiss().then((result) => {
          // Only mark as cancelled if the user clicked the cancel button
          if (result.role === 'cancel' || result.data === 'cancelled') {
            cancelled = true;
          }
        });
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
            // Simple PDF viewing - open in browser's native PDF viewer
            // This works reliably on both web and mobile
            await this.openPdfInBrowser(fileUrl, filename);
          } else {
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

  /**
   * Opens a PDF in the DocumentViewerComponent modal (same viewer on both web and mobile).
   */
  private async openPdfInBrowser(fileUrl: string, filename: string): Promise<void> {
    try {
      const { DocumentViewerComponent } = await import('../../components/document-viewer/document-viewer.component');
      const modal = await this.modalController.create({
        component: DocumentViewerComponent,
        componentProps: {
          fileUrl: fileUrl,
          fileName: filename,
          fileType: 'pdf',
          filePath: filename
        },
        cssClass: 'fullscreen-modal'
      });
      await modal.present();
    } catch (error) {
      console.error('Error opening PDF:', error);
      await this.showToast('Failed to open PDF', 'danger');
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
                cancelled = true;
                return true; // Allow dismissal
              }
            }
          ],
          backdropDismiss: false,
          cssClass: 'custom-document-alert'
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
            // Simple PDF viewing - open in browser's native PDF viewer
            // This works reliably on both web and mobile
            await this.openPdfInBrowser(fileUrl, filename);
          } else {
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
    this.isAddingLink = false; // Adding document, not link
    
    // Get optional templates for this type (Auto = 'No' only, since Auto = 'Yes' are shown automatically)
    const optionalTemplates = this.attachTemplates.filter(t => 
      t.TypeID === parseInt(serviceDoc.typeId) && 
      (t.Auto === 'No' || t.Auto === false || t.Auto === 0 || !t.Auto)
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

  async showOptionalDocumentsForLink(serviceDoc: ServiceDocumentGroup) {
    this.selectedServiceDoc = serviceDoc;
    this.isAddingLink = true; // Adding link, not document
    
    // Get optional templates for this type (Auto = 'No' only, since Auto = 'Yes' are shown automatically)
    const optionalTemplates = this.attachTemplates.filter(t => 
      t.TypeID === parseInt(serviceDoc.typeId) && 
      (t.Auto === 'No' || t.Auto === false || t.Auto === 0 || !t.Auto)
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

    // Check if document with same title already exists and generate versioned title
    const versionedTitle = this.getVersionedTitle(doc.title, this.selectedServiceDoc);

    // If in link mode, add document immediately with isLink flag (no URL prompt yet)
    if (this.isAddingLink) {
      this.selectedServiceDoc.documents.push({
        title: versionedTitle,
        required: doc.required,
        uploaded: false,
        templateId: doc.templateId,
        isLink: true // Mark as link document
      });

      await this.optionalDocsModal.dismiss();
      this.selectedServiceDoc = null;

      // Persist and update UI
      this.savePendingDocumentsToStorage();
      this.cacheCurrentState();
      this.changeDetectorRef.markForCheck();
      return;
    }

    // Add document to the service's document list
    this.selectedServiceDoc.documents.push({
      title: versionedTitle,
      required: doc.required,
      uploaded: false,
      templateId: doc.templateId
    });

    await this.optionalDocsModal.dismiss();
    this.selectedServiceDoc = null;

    // Persist and update UI
    this.savePendingDocumentsToStorage();
    this.cacheCurrentState();
    this.changeDetectorRef.markForCheck();
  }

  async promptForDocumentLink(doc: any) {
    const alert = await this.alertController.create({
      header: 'Add Link',
      cssClass: 'custom-document-alert',
      inputs: [
        {
          name: 'documentUrl',
          type: 'url',
          placeholder: 'Enter URL (https://...)'
        }
      ],
      buttons: [
        {
          text: 'SAVE',
          cssClass: 'alert-button-save',
          handler: async (data) => {
            if (data.documentUrl && data.documentUrl.trim()) {
              await this.addDocumentLink(doc, data.documentUrl.trim());
              return true;
            }
            return false;
          }
        },
        {
          text: 'CANCEL',
          role: 'cancel',
          cssClass: 'alert-button-cancel'
        }
      ]
    });

    await alert.present();
  }

  async addDocumentLink(doc: any, url: string) {
    if (!this.selectedServiceDoc) return;

    try {
      // Check if document title needs versioning
      const versionedTitle = this.getVersionedTitle(doc.title, this.selectedServiceDoc);

      // Create attachment record in Caspio
      const attachmentData: any = {
        ProjectID: this.project?.ProjectID || this.projectId,
        TypeID: parseInt(this.selectedServiceDoc.typeId),
        Title: versionedTitle,
        Link: url, // Store the URL in the Link field
        Attachment: '', // Empty attachment field for links
        Notes: 'Link added from mobile'
      };


      // Pass serviceId as second parameter to createAttachment
      const response = await this.caspioService.createAttachment(attachmentData, this.selectedServiceDoc.serviceId).toPromise();


      if (response && (response.PK_ID || response.AttachID)) {

        // Reload attachments from database to ensure UI matches server state
        // Cache was automatically cleared by CaspioService, so this gets fresh data
        await this.loadExistingAttachments();

        // WEBAPP: Trigger change detection to update UI with OnPush strategy
        this.changeDetectorRef.markForCheck();

        await this.showToast('Link added successfully', 'success')
      } else {
        throw new Error('No ID returned from server');
      }
    } catch (error) {
      console.error('Error adding document link:', error);
      await this.showToast('Failed to add link', 'danger');
    }
    
    await this.optionalDocsModal.dismiss();
    this.selectedServiceDoc = null;
    this.isAddingLink = false;
  }

  async editLink(serviceId: string, doc: DocumentItem) {
    // Check if this document has an uploaded file (not a link)
    const hasUploadedFile = doc.uploaded && !doc.isLink && doc.attachmentUrl && doc.attachmentUrl.trim() !== '';
    
    // If there's an uploaded file, show confirmation to replace it with a link
    if (hasUploadedFile) {
      const confirmAlert = await this.alertController.create({
        header: 'Replace Document with Link',
        message: `Are you sure you want to replace the uploaded file "${doc.linkName || doc.filename}" with a link? This will remove the file.`,
        cssClass: 'custom-document-alert',
        buttons: [
          {
            text: 'REPLACE',
            cssClass: 'alert-button-save',
            handler: () => {
              // Show the URL input popup
              this.showLinkInputPopup(serviceId, doc, true);
              return true;
            }
          },
          {
            text: 'CANCEL',
            role: 'cancel',
            cssClass: 'alert-button-cancel'
          }
        ]
      });
      await confirmAlert.present();
    } else {
      // No file to replace, just show the link input
      this.showLinkInputPopup(serviceId, doc, false);
    }
  }
  
  private async showLinkInputPopup(serviceId: string, doc: DocumentItem, isReplacing: boolean) {
    const alert = await this.alertController.create({
      header: isReplacing ? 'Replace with Link' : (doc.attachId ? 'Edit Link' : 'Add Link'),
      cssClass: 'custom-document-alert',
      inputs: [
        {
          name: 'linkUrl',
          type: 'url',
          placeholder: 'Enter URL (https://...)',
          value: doc.linkName || '',
          attributes: {
            required: true
          }
        }
      ],
      buttons: [
        {
          text: isReplacing ? 'REPLACE' : (doc.attachId ? 'UPDATE LINK' : 'SAVE'),
          cssClass: 'alert-button-save',
          handler: async (data) => {
            if (data.linkUrl && data.linkUrl.trim()) {
              if (doc.attachId) {
                // Update existing attachment - replace file with link
                await this.replaceDocumentWithLink(serviceId, doc, data.linkUrl.trim());
              } else {
                // Create new link in database
                await this.createDocumentLink(serviceId, doc, data.linkUrl.trim());
              }
              // Manually dismiss after operations complete
              await alert.dismiss();
              return false; // Prevent auto-dismissal
            }
            return false; // Don't dismiss if URL is empty
          }
        },
        {
          text: 'CANCEL',
          role: 'cancel',
          cssClass: 'alert-button-cancel'
        }
      ]
    });

    await alert.present();
  }
  
  async replaceDocumentWithLink(serviceId: string, doc: DocumentItem, newUrl: string) {
    if (!doc.attachId) return;
    
    try {
      // Update the attachment to clear the Attachment field and set Link field
      await this.caspioService.updateAttachment(doc.attachId, {
        Link: newUrl,
        Attachment: '' // Clear the file attachment
      }).toPromise();

      // Update local existingAttachments array
      const existingAttach = this.existingAttachments.find(a => a.AttachID === doc.attachId);
      if (existingAttach) {
        existingAttach.Link = newUrl;
        existingAttach.Attachment = ''; // Clear the attachment
      }

      // Rebuild documents list to reflect the change
      this.updateDocumentsList();

      // Invalidate cache to ensure fresh data on reload
      ProjectDetailPage.detailStateCache.delete(this.projectId);

      // Reload attachments from database to ensure UI matches server state
      // Cache was automatically cleared by CaspioService, so this gets fresh data
      await this.loadExistingAttachments();

      // WEBAPP: Trigger change detection to update UI with OnPush strategy
      this.changeDetectorRef.markForCheck();

      this.showToast('Document replaced with link successfully', 'success');
    } catch (error) {
      console.error('Error replacing document with link:', error);
      this.showToast('Failed to replace document with link', 'danger');
    }
  }


  async createDocumentLink(serviceId: string, doc: DocumentItem, url: string) {
    // Find the service document group
    const serviceDoc = this.serviceDocuments.find(sd => sd.serviceId === serviceId);
    if (!serviceDoc) return;

    try {
      // DON'T apply versioning here - this is for adding a link to an EXISTING document
      // The document already has its proper title (possibly with version number)
      // Versioning is only applied when adding NEW documents via "Add Document" modal

      // Create attachment record in Caspio
      const attachmentData = {
        ProjectID: this.project?.ProjectID || this.projectId,
        TypeID: parseInt(serviceDoc.typeId),
        Title: doc.title, // Use the existing document title as-is
        Link: url, // Store the URL in the Link field
        Attachment: '', // Empty attachment field for links
        Notes: 'Link added from mobile'
      };


      const response = await this.caspioService.createAttachment(attachmentData, serviceDoc.serviceId).toPromise();


      if (response && (response.PK_ID || response.AttachID)) {

        // Reload attachments from database to ensure UI matches server state
        // Cache was automatically cleared by CaspioService, so this gets fresh data
        await this.loadExistingAttachments();

        // WEBAPP: Trigger change detection to update UI with OnPush strategy
        this.changeDetectorRef.markForCheck();

        this.showToast('Link added successfully', 'success');
      }
    } catch (error) {
      console.error('Error creating link:', error);
      this.showToast('Failed to add link', 'danger');
    }
  }

  async promptForCustomDocument() {
    const alert = await this.alertController.create({
      header: 'Add Custom Document',
      cssClass: 'custom-document-alert',
      inputs: [
        {
          name: 'documentName',
          type: 'text',
          placeholder: 'Document Name'
        }
      ],
      buttons: [
        {
          text: 'SAVE',
          cssClass: 'alert-button-save',
          handler: (data) => {
            if (data.documentName && data.documentName.trim()) {
              this.addCustomDocument(data.documentName.trim());
              return true;
            }
            return false;
          }
        },
        {
          text: 'CANCEL',
          role: 'cancel',
          cssClass: 'alert-button-cancel'
        }
      ]
    });

    await alert.present();
  }

  async addCustomDocument(documentName: string) {
    if (!this.selectedServiceDoc || !documentName || !documentName.trim()) return;

    // Check if document with same name already exists and generate versioned title
    const versionedTitle = this.getVersionedTitle(documentName.trim(), this.selectedServiceDoc);

    // Add custom document to the service's document list
    // If in link mode, mark as link document
    const newDoc: any = {
      title: versionedTitle,
      required: false,
      uploaded: false,
      templateId: undefined  // No template for custom documents
    };

    // If adding via Add Link button, mark as link
    if (this.isAddingLink) {
      newDoc.isLink = true;
    }

    this.selectedServiceDoc.documents.push(newDoc);

    await this.optionalDocsModal.dismiss();
    this.selectedServiceDoc = null;
    this.isAddingLink = false; // Reset link mode flag

    // Persist and update UI
    this.savePendingDocumentsToStorage();
    this.cacheCurrentState();
    this.changeDetectorRef.markForCheck();
  }

  async removeOptionalDocument(serviceId: string, doc: DocumentItem) {
    const serviceDoc = this.serviceDocuments.find(sd => sd.serviceId === serviceId);
    if (serviceDoc) {
      const index = serviceDoc.documents.indexOf(doc);
      if (index > -1) {
        serviceDoc.documents.splice(index, 1);

        // Update localStorage and cache
        this.savePendingDocumentsToStorage();
        this.cacheCurrentState();
        this.changeDetectorRef.markForCheck();
      }
    }
  }

  closeOptionalDocsModal() {
    this.optionalDocsModal.dismiss();
    this.selectedServiceDoc = null;
    this.isAddingLink = false; // Reset link mode flag
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
      return;
    }

    // Convert typeId to string for consistent comparison
    const typeIdStr = String(service.typeId);

    const openPdf = this.isReadOnly || !!options?.openPdf;
    
    // Check both typeName and typeId (35 is Engineers Foundation Evaluation)
    // Also check for various name formats
    const isEngineersFoundation =
      service.typeName === 'Engineers Foundation Evaluation' ||
      service.typeName === 'Engineer\'s Foundation Evaluation' ||
      service.typeName?.toLowerCase().includes('engineer') && service.typeName?.toLowerCase().includes('foundation') ||
      typeIdStr === '35';

    // Check for HUD template - typically includes "HUD" or "Manufactured" in the name
    // TypeID 2 is HUD/Manufactured Housing
    const isHUDTemplate =
      service.typeName?.toLowerCase().includes('hud') ||
      service.typeName?.toLowerCase().includes('manufactured') ||
      service.typeName?.toLowerCase().includes('mobile home') ||
      typeIdStr === '2';

    // Check for LBW template - Load Bearing Wall
    const isLBWTemplate =
      service.typeName?.toLowerCase().includes('lbw') ||
      service.typeName?.toLowerCase().includes('load bearing wall') ||
      service.typeName?.toLowerCase().includes('load-bearing wall');

    // Check for DTE template - Damaged Truss Evaluation
    const isDTETemplate =
      service.typeName?.toLowerCase().includes('dte') ||
      service.typeName?.toLowerCase().includes('damaged truss') ||
      service.typeName?.toLowerCase().includes('truss evaluation');

    // Check for CSA template - Cost Segregation Analysis
    const isCSATemplate =
      service.typeShort?.toUpperCase() === 'ECSA' ||
      service.typeName?.toLowerCase().includes('csa') ||
      service.typeName?.toLowerCase().includes('cost segregation');

    // Navigate immediately - remove all blocking checks
    // US-002 FIX: Use retryNavigation helper to avoid hard refresh fallbacks
    if (isHUDTemplate) {
      const extras: any = { replaceUrl: false };
      if (openPdf) {
        extras.queryParams = { openPdf: '1' };
      }
      this.retryNavigation(['hud', this.projectId, service.serviceId], extras);
    } else if (isLBWTemplate) {
      const extras: any = { replaceUrl: false };
      if (openPdf) {
        extras.queryParams = { openPdf: '1' };
      }
      this.retryNavigation(['lbw', this.projectId, service.serviceId], extras);
    } else if (isDTETemplate) {
      const extras: any = { replaceUrl: false };
      if (openPdf) {
        extras.queryParams = { openPdf: '1' };
      }
      this.retryNavigation(['dte', this.projectId, service.serviceId], extras);
    } else if (isCSATemplate) {
      const extras: any = { replaceUrl: false };
      if (openPdf) {
        extras.queryParams = { openPdf: '1' };
      }
      this.retryNavigation(['csa', this.projectId, service.serviceId], extras);
    } else if (isEngineersFoundation) {
      const extras: any = { replaceUrl: false };
      if (openPdf) {
        extras.queryParams = { openPdf: '1' };
      }
      // Pass ReportFinalized flag in navigation state
      if (service.ReportFinalized) {
        extras.state = {
          ReportFinalized: service.ReportFinalized
        };
      }
      this.retryNavigation(['engineers-foundation', this.projectId, service.serviceId], extras);
    } else {
      const extras: any = { replaceUrl: false };
      if (openPdf) {
        extras.queryParams = { openPdf: '1' };
      }
      this.retryNavigation(['template-form', this.projectId, service.serviceId], extras);
    }
  }

  /**
   * US-002 FIX: Retry navigation with exponential backoff instead of hard refresh fallback
   * This prevents the app from hard refreshing when router navigation fails temporarily
   */
  private async retryNavigation(commands: any[], extras: any, attempt: number = 1): Promise<void> {
    const maxAttempts = 3;
    try {
      const success = await this.router.navigate(commands, extras);
      if (!success && attempt < maxAttempts) {
        console.warn(`[ProjectDetail] Navigation returned false, retry ${attempt}/${maxAttempts}`);
        await new Promise(resolve => setTimeout(resolve, 100 * attempt));
        return this.retryNavigation(commands, extras, attempt + 1);
      }
    } catch (error) {
      console.error(`[ProjectDetail] Navigation error on attempt ${attempt}:`, error);
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 100 * attempt));
        return this.retryNavigation(commands, extras, attempt + 1);
      }
      // Final fallback: show error to user instead of hard refresh
      console.error('[ProjectDetail] Navigation failed after all retries - NOT using hard refresh');
      // Don't use window.location.assign - just log and let user try again
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
  private readonly PROJECT_IMAGE_CACHE_PREFIX = 'project_img_';
  private readonly CACHE_EXPIRY_HOURS = 24;

  getPropertyPhotoUrl(): string {
    // Check if project has a PrimaryPhoto
    if (this.project && this.project['PrimaryPhoto']) {
      const primaryPhoto = this.project['PrimaryPhoto'];
      
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
      }
    } else {
    }
    
    // Fall back to Google Street View
    if (!this.project || !this.formatAddress()) {
      return 'assets/img/project-placeholder.svg';
    }
    const address = encodeURIComponent(this.formatAddress());
    const streetViewUrl = `https://maps.googleapis.com/maps/api/streetview?size=400x200&location=${address}&key=${this.googleMapsApiKey}`;
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
    
    // Create cache key
    const projectId = this.project.PK_ID;
    const cacheKey = `${projectId}_${primaryPhoto}`;
    const storageCacheKey = `${this.PROJECT_IMAGE_CACHE_PREFIX}${cacheKey}`;
    
    // Check localStorage cache first
    try {
      const cachedData = localStorage.getItem(storageCacheKey);
      if (cachedData) {
        const cacheEntry = JSON.parse(cachedData);
        const cacheAge = Date.now() - cacheEntry.timestamp;
        const maxAge = this.CACHE_EXPIRY_HOURS * 60 * 60 * 1000;
        
        if (cacheAge < maxAge && cacheEntry.imageData) {
          // Use cached image
          this.projectImageData = cacheEntry.imageData;
          this.changeDetectorRef.markForCheck();
          return;
        } else {
          // Cache expired, remove it
          localStorage.removeItem(storageCacheKey);
        }
      }
    } catch (e) {
      console.error('Error reading image cache:', e);
    }
    
    this.imageLoadInProgress = true;
    
    try {
      const imageData = await this.caspioService.getImageFromFilesAPI(primaryPhoto).toPromise();
      
      if (imageData && imageData.startsWith('data:')) {
        // Store the base64 data
        this.projectImageData = imageData;
        
        // Store in localStorage for future visits
        try {
          const cacheEntry = {
            imageData: imageData,
            timestamp: Date.now()
          };
          localStorage.setItem(storageCacheKey, JSON.stringify(cacheEntry));
        } catch (storageError) {
          console.warn('Failed to cache image in localStorage (may be full):', storageError);
        }
        
        // Trigger change detection to update the view
        this.changeDetectorRef.markForCheck();
      } else {
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
                }).catch(() => {
                  // Fallback for older browsers/WebView
                  const textArea = document.createElement('textarea');
                  textArea.value = debugText;
                  document.body.appendChild(textArea);
                  textArea.select();
                  document.execCommand('copy');
                  document.body.removeChild(textArea);
                });
              } else {
                // Fallback for older browsers/WebView
                const textArea = document.createElement('textarea');
                textArea.value = debugText;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
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
        ],
        cssClass: 'custom-document-alert'
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

  /**
   * State options for the address edit dropdown
   */
  private stateOptions = [
    { StateID: 7, State: 'Arizona', Abbr: 'AZ' },
    { StateID: 6, State: 'California', Abbr: 'CA' },
    { StateID: 4, State: 'Colorado', Abbr: 'CO' },
    { StateID: 3, State: 'Florida', Abbr: 'FL' },
    { StateID: 2, State: 'Georgia', Abbr: 'GA' },
    { StateID: 8, State: 'South Carolina', Abbr: 'SC' },
    { StateID: 9, State: 'Tennessee', Abbr: 'TN' },
    { StateID: 1, State: 'Texas', Abbr: 'TX' }
  ].sort((a, b) => a.State.localeCompare(b.State));

  /**
   * Get current state ID from project (handles both State abbr and StateID)
   */
  private getCurrentStateId(): number | null {
    if (!this.project) return null;

    // If StateID exists, use it
    if (this.project.StateID) {
      return this.project.StateID;
    }

    // If State abbreviation exists, find matching StateID
    const projectState = this.project.State;
    if (projectState) {
      const match = this.stateOptions.find(s =>
        s.Abbr === projectState || s.State === projectState
      );
      return match?.StateID || null;
    }

    return null;
  }

  /**
   * Escape HTML to prevent XSS attacks (web only)
   */
  private escapeHtml(text: string): string {
    if (!environment.isWeb) return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Open modal to edit the project address
   */
  async openEditAddressModal() {
    const currentStateId = this.getCurrentStateId();

    // Build state options HTML with proper escaping to prevent XSS
    let stateOptionsHtml = '<option value="">-- Select State --</option>';
    this.stateOptions.forEach(state => {
      const selected = state.StateID === currentStateId ? 'selected' : '';
      stateOptionsHtml += `<option value="${this.escapeHtml(String(state.StateID))}" ${selected}>${this.escapeHtml(state.State)}</option>`;
    });

    const alert = await this.alertController.create({
      header: 'Edit Address',
      cssClass: 'custom-document-alert edit-address-alert',
      message: ' ',
      buttons: [
        {
          text: 'Save',
          handler: () => {
            const addressInput = document.getElementById('edit-address-input') as HTMLInputElement;
            const cityInput = document.getElementById('edit-city-input') as HTMLInputElement;
            const stateSelect = document.getElementById('edit-state-select') as HTMLSelectElement;
            const zipInput = document.getElementById('edit-zip-input') as HTMLInputElement;

            this.saveAddressChanges({
              address: addressInput?.value || '',
              city: cityInput?.value || '',
              stateId: stateSelect?.value ? parseInt(stateSelect.value) : null,
              zip: zipInput?.value || ''
            });
          }
        },
        {
          text: 'Cancel',
          role: 'cancel'
        }
      ]
    });

    await alert.present();

    // Inject custom HTML form after alert is presented (with XSS protection)
    setTimeout(() => {
      const alertMessage = document.querySelector('.edit-address-alert .alert-message');
      if (alertMessage) {
        // Escape user-provided values to prevent XSS
        const escapedAddress = this.escapeHtml(this.project?.Address || '');
        const escapedCity = this.escapeHtml(this.project?.City || '');
        const escapedZip = this.escapeHtml(this.project?.Zip || '');

        alertMessage.innerHTML = `
          <div class="edit-address-form">
            <div class="form-field">
              <label>Street Address</label>
              <input type="text" id="edit-address-input" value="${escapedAddress}" placeholder="Enter street address">
            </div>
            <div class="form-field">
              <label>City</label>
              <input type="text" id="edit-city-input" value="${escapedCity}" placeholder="Enter city">
            </div>
            <div class="form-field">
              <label>State</label>
              <select id="edit-state-select">${stateOptionsHtml}</select>
            </div>
            <div class="form-field">
              <label>Zip Code</label>
              <input type="text" id="edit-zip-input" value="${escapedZip}" placeholder="Enter zip code">
            </div>
          </div>
        `;
      }
    }, 100);
  }

  /**
   * Save address changes to the project
   */
  private async saveAddressChanges(data: { address: string; city: string; stateId: number | null; zip: string }) {
    if (!this.project || !this.projectId) return;

    const loading = await this.loadingController.create({
      message: 'Saving address...'
    });
    await loading.present();

    try {
      // Find state abbreviation from StateID (for local display only)
      const stateOption = this.stateOptions.find(s => s.StateID === data.stateId);
      const stateAbbr = stateOption?.Abbr || '';

      // Only send fields that exist in the LPS_Projects table
      // Note: State field doesn't exist in table, only StateID
      const updateData: any = {
        Address: data.address,
        City: data.city,
        StateID: data.stateId,
        Zip: data.zip
      };

      // Update via API - use PK_ID for Caspio REST API updates (matches mobile app pattern)
      await this.caspioService.updateProject(this.project?.PK_ID || this.projectId, updateData).toPromise();

      // Update local project object (including State for display purposes)
      this.project.Address = data.address;
      this.project.City = data.city;
      this.project.StateID = data.stateId ?? undefined;
      this.project.State = stateAbbr;
      this.project.Zip = data.zip;

      // Update cache and trigger UI refresh
      this.cacheCurrentState();
      this.changeDetectorRef.markForCheck();

      await loading.dismiss();
    } catch (error) {
      await loading.dismiss();
      console.error('Error saving address:', error);

      const toast = await this.toastController.create({
        message: 'Failed to save address. Please try again.',
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
    }
  }

  goBack() {
    // G2-NAV-001: On web, use browser history for proper back/forward support
    if (environment.isWeb && this.navigationHistory.canGoBack()) {
      this.navigationHistory.navigateBack();
      return;
    }

    // Fallback: Force refresh of active projects by using query params to trigger reload
    this.router.navigate(['/tabs/active-projects'], {
      queryParams: { refresh: new Date().getTime() },
      queryParamsHandling: 'merge'
    });
  }

  // Cache for template progress to avoid repeated API calls
  private templateProgressCache: { [key: string]: { progress: number; timestamp: number } } = {};
  private readonly CACHE_DURATION = 60000; // 1 minute cache

  private static iconCache: Map<string, string> = new Map();

  async loadIconImages() {
    // Get unique type IDs from selected services (normalize to strings for comparison)
    const selectedTypeIds = new Set(this.selectedServices.map(s => String(s.typeId)));

    // Filter for offers that: 1) have icons, 2) are actually used by selected services
    const offersWithIcons = this.availableOffers
      .filter(offer =>
        offer.TypeIcon &&
        offer.TypeIcon.trim() !== '' &&
        selectedTypeIds.has(String(offer.TypeID))
      );

    if (offersWithIcons.length === 0) {
      return; // No icons to load
    }

    const applyIcon = (offer: any, imageData: string) => {
      offer.TypeIconUrl = imageData;
      this.selectedServices.forEach(service => {
        if (String(service.typeId) === String(offer.TypeID)) {
          service.typeIconUrl = imageData;
        }
      });
      // detectChanges() forces immediate re-render (markForCheck is insufficient
      // with OnPush when fetch() resolves outside a zone-triggered CD cycle)
      try { this.changeDetectorRef.detectChanges(); } catch {}
    };

    const iconPromises = offersWithIcons.map(async (offer) => {
        if (!offer.TypePK_ID) {
          offer.TypeIconUrl = '';
          return;
        }

        const cacheKey = `icon_${offer.TypePK_ID}`;

        // Check in-memory cache first (instant)
        const memCached = ProjectDetailPage.iconCache.get(cacheKey);
        if (memCached) {
          applyIcon(offer, memCached);
          return;
        }

        // Check localStorage cache (fast)
        try {
          const stored = localStorage.getItem(cacheKey);
          if (stored) {
            ProjectDetailPage.iconCache.set(cacheKey, stored);
            applyIcon(offer, stored);
            return;
          }
        } catch {}

        try {
          // Fetch icon from LPS_Type table attachment using the record's PK_ID
          const imageData = await this.caspioService.getTypeIconImage(offer.TypePK_ID, offer.TypeIcon).toPromise();

          if (imageData && imageData.startsWith('data:')) {
            // Cache in memory and localStorage
            ProjectDetailPage.iconCache.set(cacheKey, imageData);
            try { localStorage.setItem(cacheKey, imageData); } catch {}

            applyIcon(offer, imageData);
          } else {
            offer.TypeIconUrl = '';
          }
        } catch (error: any) {
          offer.TypeIconUrl = '';
        }
      });

    // Wait for all icons to load in parallel
    await Promise.all(iconPromises);
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
        this.changeDetectorRef.markForCheck();
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
        `/tables/LPS_Services/records?q.where=PK_ID=${service.serviceId}`
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
        `/tables/LPS_Services_Visuals/records?q.where=ServiceID=${service.serviceId}`
      ).toPromise();

      if (visualsData?.ResultSet && visualsData.ResultSet.length > 0) {
        structuralProgress = Math.min(100, visualsData.ResultSet.length * 10);
        debugInfo += `Structural: ${visualsData.ResultSet.length} visuals = ${structuralProgress}%\n`;
      } else {
        debugInfo += `Structural: No visuals found = 0%\n`;
      }

      // 3. Check elevation plot completion
      const roomsData: any = await this.caspioService.get(
        `/tables/LPS_Services_EFE/records?q.where=ServiceID=${service.serviceId}`
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
        buttons: ['OK'],
        cssClass: 'custom-document-alert'
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
      buttons: ["OK"],
      cssClass: 'custom-document-alert'
    });

    await alert.present();
  }

  private generateInstanceId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate a versioned title if document with same title already exists
   * Returns: "Document #2", "Document #3", etc.
   */
  private getVersionedTitle(baseTitle: string, serviceDoc: any): string {
    // Get all existing document titles in this service (both uploaded and pending)
    const existingTitles = serviceDoc.documents.map((d: any) => d.title);

    // Find all documents with titles matching the base title or versioned variants
    const baseTitleLower = baseTitle.toLowerCase();
    const matchingTitles = existingTitles.filter((t: string) => {
      const titleLower = t.toLowerCase();
      // Match exact title or title with version suffix (e.g., "Document #2")
      return titleLower === baseTitleLower ||
             titleLower.match(new RegExp(`^${baseTitleLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} #\\d+$`));
    });

    // If no duplicates, return original title
    if (matchingTitles.length === 0) {
      return baseTitle;
    }

    // Find the highest version number
    let maxVersion = 1;
    for (const existingTitle of matchingTitles) {
      const match = existingTitle.match(/#(\d+)$/);
      if (match) {
        const version = parseInt(match[1]);
        if (version > maxVersion) {
          maxVersion = version;
        }
      }
    }

    // Return title with next version number
    const nextVersion = maxVersion + 1;
    return `${baseTitle} #${nextVersion}`;
  }

  /**
   * Extract ServiceID from Notes field
   * Format: [SID:123] rest of notes
   */
  private extractServiceIdFromNotes(notes: string): number | null {
    if (!notes) return null;
    const match = notes.match(/\[SID:(\d+)\]/);
    return match ? parseInt(match[1]) : null;
  }

  /**
   * Extract link URL from document if it's a link
   * Returns the URL string if document is a link, null otherwise
   */
  private extractLinkUrl(doc: DocumentItem): string | null {
    
    // Check if explicitly marked as link AND has a valid URL in linkName
    if (doc.isLink && doc.linkName) {
      const linkName = doc.linkName.trim();
      // Only return if it's actually a URL (not a file path or vercel link)
      if ((linkName.startsWith('http://') || linkName.startsWith('https://')) && 
          !linkName.includes('vercel.app')) {
        return linkName;
      }
    }
    
    // Check linkName for URL patterns - but EXCLUDE vercel.app and file paths
    if (doc.linkName && typeof doc.linkName === 'string') {
      const linkName = doc.linkName.trim();
      // Only process if it looks like a URL and is NOT a vercel link or file path
      const looksLikeUrl = linkName.startsWith('http://') || linkName.startsWith('https://') || 
                          linkName.includes('.com') || linkName.includes('.org') || 
                          linkName.includes('.net') || linkName.includes('.edu');
      const isVercelLink = linkName.includes('vercel.app');
      const isFilePath = linkName.startsWith('/') || linkName.endsWith('.pdf') || linkName.endsWith('.jpg') || linkName.endsWith('.png');
      
      if (looksLikeUrl && !isVercelLink && !isFilePath) {
        const url = linkName.startsWith('http') ? linkName : `https://${linkName}`;
        return url;
      }
    }
    
    // Check filename for URL patterns - but EXCLUDE vercel.app and file paths
    if (doc.filename && typeof doc.filename === 'string') {
      const filename = doc.filename.trim();
      // Only process if it looks like a URL and is NOT a vercel link or file path
      const looksLikeUrl = filename.startsWith('http://') || filename.startsWith('https://') || 
                          filename.includes('.com') || filename.includes('.org') || 
                          filename.includes('.net') || filename.includes('.edu');
      const isVercelLink = filename.includes('vercel.app');
      const isFilePath = filename.startsWith('/') || filename.endsWith('.pdf') || filename.endsWith('.jpg') || filename.endsWith('.png');
      
      if (looksLikeUrl && !isVercelLink && !isFilePath) {
        const url = filename.startsWith('http') ? filename : `https://${filename}`;
        return url;
      }
    }
    
    return null;
  }

  private determineIfLink(attachment: any): boolean {
    if (!attachment) return false;
    
    // Debug logging for custom links
    if (attachment.Title && attachment.Title.includes('Custom Document')) {
    }
    
    // If the Link field contains a URL (starts with http/https), it's a link
    if (attachment.Link && typeof attachment.Link === 'string') {
      const link = attachment.Link.toLowerCase().trim();
      if (link.startsWith('http://') || link.startsWith('https://')) {
        return true;
      }
    }
    
    // If there's no Attachment field but there's a Link field, it's likely a link
    if (!attachment.Attachment && attachment.Link) {
      return true;
    }
    
    // If there's an Attachment field with actual content, it's likely a file
    if (attachment.Attachment && attachment.Attachment.trim() !== '') {
      return false;
    }
    
    // If there's a Link field but no meaningful Attachment field, it's likely a link
    if (attachment.Link && (!attachment.Attachment || attachment.Attachment.trim() === '')) {
      return true;
    }
    
    // Default to false (file) if we can't determine
    return false;
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
      ],
      cssClass: 'custom-document-alert'
    });
    await alert.present();
  }

  /**
   * Maps service typeShort to OfflineTemplateService template types.
   * Returns null for services without offline template support.
   */
  private getTemplateType(typeShort: string): 'EFE' | 'HUD' | 'LBW' | 'DTE' | 'CSA' | null {
    const normalized = typeShort?.toUpperCase() || '';
    if (normalized === 'EFE') return 'EFE';
    if (normalized === 'HUD') return 'HUD';
    if (normalized === 'LBW') return 'LBW';
    if (normalized === 'DTE') return 'DTE';
    if (normalized === 'CSA') return 'CSA';
    if (normalized === 'ELBW') return 'LBW';
    if (normalized === 'EDTE') return 'DTE';
    if (normalized === 'ECSA') return 'CSA';
    return null;
  }

  /**
   * Save: Push all pending local changes to the cloud.
   */
  async saveToCloud(): Promise<void> {
    if (this.isSaving) return;

    this.isSaving = true;
    this.changeDetectorRef.markForCheck();

    const loading = await this.loadingController.create({
      message: 'Saving changes to cloud...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Trigger the sync
      await this.backgroundSync.forceSyncNow();

      // Wait for sync to actually complete (isSyncing becomes false)
      // forceSyncNow may return early if a sync was already in progress
      const status = this.backgroundSync.syncStatus$.value;
      if (status.isSyncing) {
        await firstValueFrom(
          this.backgroundSync.syncStatus$.pipe(
            filter(s => !s.isSyncing),
            first()
          )
        );
      }

      await loading.dismiss();
      await this.showToast('Changes saved to cloud', 'success');
    } catch (error) {
      console.error('[ProjectDetail] Save to cloud failed:', error);
      await loading.dismiss();
      await this.showToast('Failed to save changes. Please try again.', 'danger');
    } finally {
      this.isSaving = false;
      this.changeDetectorRef.markForCheck();
    }
  }

  /**
   * Sync: Pull fresh data from cloud to IndexedDB for selected services.
   */
  async syncFromCloud(): Promise<void> {
    if (this.isSyncing) return;

    // Check if online first
    if (!navigator.onLine) {
      await this.showToast('Cannot sync while offline. Please connect to the internet.', 'warning');
      return;
    }

    // Build debug info for services
    const serviceDebugInfo = this.selectedServices.map(s => {
      const templateType = this.getTemplateType(s.typeShort || '');
      return `${s.typeName}: id=${s.serviceId || 'NONE'}, type=${s.typeShort || 'NONE'}, template=${templateType || 'NONE'}`;
    });

    const servicesWithTemplates = this.selectedServices.filter(s => {
      const hasServiceId = !!s.serviceId;
      const templateType = this.getTemplateType(s.typeShort || '');
      return hasServiceId && templateType;
    });

    if (servicesWithTemplates.length === 0) {
      // Show detailed alert about why nothing can sync
      const alert = await this.alertController.create({
        header: 'Cannot Sync',
        message: `No services available to sync.<br><br>` +
          `<strong>Selected Services (${this.selectedServices.length}):</strong><br>` +
          (serviceDebugInfo.length > 0 ? serviceDebugInfo.join('<br>') : 'None') +
          `<br><br><strong>Requirements:</strong><br>` +
          `- Service must have a serviceId (saved to cloud)<br>` +
          `- Type must be EFE, HUD, LBW, or DTE`,
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    this.isSyncing = true;
    this.changeDetectorRef.markForCheck();

    const loading = await this.loadingController.create({
      message: `Syncing ${servicesWithTemplates.length} service(s)...`,
      spinner: 'crescent'
    });
    await loading.present();

    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    try {
      for (const service of servicesWithTemplates) {
        const templateType = this.getTemplateType(service.typeShort || '');
        if (!templateType || !service.serviceId) continue;

        try {
          loading.message = `Syncing ${service.typeShort || service.typeName}...`;
          await this.offlineTemplate.forceRefreshTemplateData(
            service.serviceId,
            templateType,
            this.projectId
          );
          successCount++;
        } catch (error: any) {
          const errorMsg = error?.message || error?.toString() || 'Unknown error';
          errors.push(`${service.typeName}: ${errorMsg}`);
          errorCount++;
        }
      }

      await loading.dismiss();

      if (errorCount === 0) {
        await this.showToast(`Synced ${successCount} service(s) successfully`, 'success');
      } else if (successCount > 0) {
        await this.showToast(`Synced ${successCount} service(s), ${errorCount} failed`, 'warning');
      } else {
        // Show detailed error alert
        const alert = await this.alertController.create({
          header: 'Sync Failed',
          message: `All ${errorCount} service(s) failed to sync.<br><br>` +
            `<strong>Errors:</strong><br>` +
            errors.join('<br>'),
          buttons: ['OK']
        });
        await alert.present();
      }
    } catch (error: any) {
      await loading.dismiss();
      const alert = await this.alertController.create({
        header: 'Sync Error',
        message: `Unexpected error: ${error?.message || error?.toString() || 'Unknown'}`,
        buttons: ['OK']
      });
      await alert.present();
    } finally {
      this.isSyncing = false;
      this.changeDetectorRef.markForCheck();
    }
  }

  onIconError(event: any, service: any) {
    // This should rarely be called now since we're using pre-loaded base64 URLs
    console.error('Icon failed to load for service:', service.typeName);
    event.target.style.display = 'none'; // Hide broken image
  }

  private async showToast(message: string, color: string = 'primary') {
    if (color === 'success' || color === 'info') return;
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
      cssClass: 'custom-document-alert'
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

    // Projects table uses ProjectID as primary key for updates
    const projectId = this.project?.PK_ID;

    // Start upload immediately without confirmation
    await this.performPhotoUpload(file, projectId);
  }
  
  private async performPhotoUpload(file: File, projectId: any) {
    if (!projectId) {
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'No project ID available. Cannot update photo.',
        buttons: ['OK'],
        cssClass: 'custom-document-alert'
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
      // Generate unique filename
      const timestamp = Date.now();
      const fileName = `property_${projectId}_${timestamp}.jpg`;
      const compressedFile = await this.imageCompression.compressImage(file, {
        maxSizeMB: 1.5,
        maxWidthOrHeight: 1920,
        useWebWorker: true
      });

      // Upload via gateway proxy
      const formData = new FormData();
      formData.append('file', compressedFile, fileName);

      const uploadResponse = await fetch(`${environment.apiGatewayUrl}/api/caspio-files/upload`, {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        const responseText = await uploadResponse.text();
        console.error('Files API error:', responseText);
        throw new Error(`Upload failed: ${uploadResponse.status} - ${responseText}`);
      }

      const uploadResult = await uploadResponse.json();

      // Handle different possible response formats from Files API
      let uploadedFileName: string;
      if (uploadResult.Name) {
        uploadedFileName = uploadResult.Name;
      } else if (uploadResult.name) {
        uploadedFileName = uploadResult.name;
      } else if (uploadResult.Result && uploadResult.Result.Name) {
        uploadedFileName = uploadResult.Result.Name;
      } else {
        console.warn('Could not find filename in Files API response, using original:', fileName);
        uploadedFileName = fileName;
      }
      
      // STEP 2: Update Projects table with the file path
      const filePath = `/${uploadedFileName}`;
      
      // Use the service method which handles the update properly
      const updateResponse = await this.caspioService.updateProject(projectId, {
        PrimaryPhoto: filePath
      }).toPromise();
      
      // Update local project data immediately
      if (this.project) {
        this.project['PrimaryPhoto'] = filePath;
        
        // PERFORMANCE FIX: Use the compressed file directly as blob URL for immediate display
        // Instead of fetching from Caspio again
        const blobUrl = URL.createObjectURL(compressedFile);
        this.projectImageData = blobUrl;
        this.imageLoadInProgress = false;
        
        // Trigger change detection to refresh the image immediately
        this.changeDetectorRef.markForCheck();
        
        // Optionally load the actual file from Caspio in the background for persistence
        // but don't block the UI or wait for it
        setTimeout(() => {
          if (filePath.startsWith('/')) {
            this.caspioService.getImageFromFilesAPI(filePath).toPromise().then(imageData => {
              if (imageData && imageData.startsWith('data:')) {
                // Replace blob URL with base64 for permanent storage
                URL.revokeObjectURL(blobUrl); // Clean up blob URL
                this.projectImageData = imageData;
                this.changeDetectorRef.markForCheck();
              }
            }).catch(err => {
              console.error('Background image load failed:', err);
              // Keep using blob URL
            });
          }
        }, 100); // Small delay to not block UI thread
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
        cssClass: 'custom-document-alert',
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
      await this.generatePDFForService(savedServices[0]);
      return;
    }

    const alert = await this.alertController.create({
      header: 'Select Template',
      message: 'Choose a template to open its PDF report.',
      inputs: savedServices.map((service, index) => {
        const count = this.getServiceCount(service.offersId);
        const instanceNum = count > 1 ? ` #${this.getServiceInstanceNumber(service)}` : '';
        const prefix = service.typeShort ? `${service.typeShort} - ` : '';
        return {
          type: 'radio' as const,
          label: `${prefix}${service.typeName}${instanceNum}`,
          value: index,
          checked: index === 0
        };
      }),
      buttons: [
        {
          text: 'Open PDF',
          handler: async (selectedIndex) => {
            const index = typeof selectedIndex === 'number' ? selectedIndex : parseInt(String(selectedIndex), 10);
            const selectedService = savedServices[index];

            if (!selectedService) {
              await this.showToast('Unable to determine which template to open. Please try again.', 'danger');
              return false;
            }

            await this.generatePDFForService(selectedService);
            return true;
          }
        },
        {
          text: 'Cancel',
          role: 'cancel'
        }
      ],
      cssClass: 'custom-document-alert'
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

    const configId = this.resolveTemplateConfigId(service);

    if (configId) {
      await this.templatePdfService.generatePDF(this.projectId, service.serviceId, configId);
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

  /**
   * Maps a ServiceSelection to a TemplateType config ID (hud, efe, dte, lbw).
   * Returns null for services without PDF template support.
   */
  private resolveTemplateConfigId(service: ServiceSelection): TemplateType | null {
    const typeName = service.typeName?.toLowerCase() || '';
    const typeShort = service.typeShort?.toUpperCase() || '';
    const typeIdStr = String(service.typeId || '');

    if (typeShort === 'EFE' || typeName.includes('engineer') && typeName.includes('foundation') || typeIdStr === '35') {
      return 'efe';
    }
    if (typeShort === 'HUD' || typeName.includes('hud') || typeName.includes('manufactured') || typeName.includes('mobile home') || typeIdStr === '2') {
      return 'hud';
    }
    if (typeShort === 'DTE' || typeShort === 'EDTE' || typeName.includes('damaged truss') || typeName.includes('truss evaluation')) {
      return 'dte';
    }
    if (typeShort === 'LBW' || typeShort === 'ELBW' || typeName.includes('load bearing wall') || typeName.includes('load-bearing wall')) {
      return 'lbw';
    }
    return null;
  }

  /**
   * Handle submit button click - show explanation if not enabled
   */
  async handleSubmitClick(service: ServiceSelection) {
    if (this.isSubmitButtonEnabled(service)) {
      // Button is enabled, proceed with submission
      await this.submitFinalizedReport(service);
    } else {
      // Button is gray/disabled, show explanation
      await this.showSubmitDisabledExplanation(service);
    }
  }

  /**
   * Show explanation for why submit button is disabled
   */
  async showSubmitDisabledExplanation(service: ServiceSelection) {
    const typeName = service.typeName?.toLowerCase() || '';
    const typeShort = service.typeShort?.toUpperCase() || '';
    const isDCR = typeShort === 'DCR' || typeName.includes('defect cost report');
    const isEIR = typeShort === 'EIR' || typeName.includes('engineers inspection review') || typeName.includes("engineer's inspection review");
    const isEFE = typeShort === 'EFE' || typeName.includes('engineers foundation') || typeName.includes("engineer's foundation");
    const isENG = typeShort === 'ENG';

    let message = '';
    let header = 'Submit Not Available';

    // If service is already "Under Review", button is grayed because no changes have been made
    if (service.Status === 'Under Review') {
      header = 'Update Not Available';
      message = 'There have been no changes to the project so there is no need to update the submission.';
    }
    // For initial submission (not yet submitted)
    else if (isEFE) {
      message = 'The report must be finalized before it can be submitted. Complete the Engineers Foundation template and finalize the report.';
    } else if (isDCR || isEIR || isENG) {
      message = 'A Property Inspection Report or Home Inspection Report must be uploaded before this report can be submitted.';
    } else {
      message = 'The report must be finalized or required documents must be uploaded before submission.';
    }

    const alert = await this.alertController.create({
      header: header,
      message: message,
      cssClass: 'custom-document-alert',
      buttons: [
        {
          text: 'OK',
          cssClass: 'alert-button-save'
        }
      ]
    });

    await alert.present();
  }

  /**
   * Open PayPal payment modal for the project
   */
  async submitFinalizedReport(service: ServiceSelection) {
    if (!service || !service.serviceId) {
      await this.showToast('Service information not available', 'danger');
      return;
    }

    // This check is now redundant since handleSubmitClick already checks
    // But keeping it as a safety check
    if (!this.isSubmitButtonEnabled(service)) {
      await this.showToast('Report must be finalized or required documents uploaded before submission', 'warning');
      return;
    }

    // Show confirmation alert
    const alert = await this.alertController.create({
      cssClass: 'custom-document-alert',
      header: 'Submit Report',
      message: `Are you sure you want to submit the finalized ${service.typeName} report?`,
      buttons: [
        {
          text: 'Submit',
          handler: async () => {
            await this.processReportSubmission(service);
          }
        },
        {
          text: 'Cancel',
          role: 'cancel'
        }
      ]
    });

    await alert.present();
  }

  async processReportSubmission(service: ServiceSelection) {
    const loading = await this.loadingController.create({
      message: 'Submitting report...'
    });
    await loading.present();

    try {

      if (!service.serviceId) {
        throw new Error('Service ID not found');
      }

      // Get current date/time in ISO format
      const submittedDateTime = new Date().toISOString();

      // Update Status to "Under Review" and StatusEng to "Submitted" in Caspio Services table
      const updateData = {
        Status: 'Under Review',
        StatusEng: 'Submitted',
        StatusDateTime: submittedDateTime
      };


      await this.caspioService.put(
        `/tables/LPS_Services/records?q.where=PK_ID='${service.serviceId}'`,
        updateData
      ).toPromise();

      // Update local service object
      service.Status = 'Under Review';
      service.StatusEng = 'Submitted';
      service.StatusDateTime = submittedDateTime;

      // Reset change tracking - button should be grayed out until next change
      if (service.serviceId) {
        this.changesAfterSubmission[service.serviceId] = false;
      }

      await loading.dismiss();
      await this.showToast(`${service.typeName} report submitted successfully`, 'success');

    } catch (error) {
      console.error('[Submit Report] Error:', error);
      await loading.dismiss();
      await this.showToast('Failed to submit report. Please try again.', 'danger');
    }
  }

  async openPaymentModal() {
    if (!this.project || !this.project.PK_ID) {
      await this.showToast('Project information not available', 'danger');
      return;
    }

    const totalAmount = this.calculateServicesTotal();

    if (totalAmount <= 0) {
      await this.showToast('No amount due for this project', 'warning');
      return;
    }

    // Build services breakdown
    const servicesBreakdown = this.selectedServices.map(service => ({
      name: service.typeName,
      price: this.getServicePrice(service)
    }));

    const modal = await this.modalController.create({
      component: PaypalPaymentModalComponent,
      componentProps: {
        invoice: {
          ProjectID: this.project.ProjectID,
          InvoiceID: this.project.PK_ID,
          Amount: totalAmount.toFixed(2),
          Description: `Payment for ${this.project.Address || 'Project'}, ${this.project.City || ''}`,
          Address: this.project.Address,
          City: this.project.City,
          Services: servicesBreakdown
        }
      }
    });

    await modal.present();

    const { data } = await modal.onDidDismiss();

    if (data && data.success) {
      // Process the payment
      await this.processPayment(data.paymentData);
    }
  }

  /**
   * Process payment and create invoice records (matches autopay ledger model)
   * Creates one negative-fee record per service paid
   */
  async processPayment(paymentData: any) {
    const loading = await this.loadingController.create({
      message: 'Processing payment...'
    });
    await loading.present();

    try {
      const paymentNotes = `PayPal Payment - Order: ${paymentData.orderID}\n` +
                          `Payer: ${paymentData.payerName} (${paymentData.payerEmail})\n` +
                          `Transaction ID: ${paymentData.payerID}\n` +
                          `Processed: ${new Date(paymentData.createTime).toLocaleString()}\n` +
                          `Status: ${paymentData.status}`;

      // Create a negative-fee invoice record per service (matches autopay ledger model)
      for (const service of this.selectedServices) {
        const fee = this.getServicePrice(service);
        if (fee <= 0) continue;

        await firstValueFrom(
          this.caspioService.post<any>('/tables/LPS_Invoices/records', {
            ProjectID: Number(this.project?.ProjectID),
            ServiceID: Number(service.serviceId),
            Fee: Number((-fee).toFixed(2)),
            Date: new Date().toISOString().split('T')[0],
            Address: String(this.project?.Address || ''),
            InvoiceNotes: String(paymentNotes),
            Mode: 'negative',
            PaymentProcessor: 'PayPal'
          })
        );
      }

      this.caspioService.clearInvoicesCache();

      // Update paid total so balance reflects immediately
      this.projectTotalPaid += this.calculateServicesTotal();

      await loading.dismiss();

      // Show success message
      const alert = await this.alertController.create({
        header: 'Payment Successful!',
        message: `Your payment of $${paymentData.amount} has been processed successfully.`,
        buttons: ['OK'],
        cssClass: 'custom-document-alert'
      });
      await alert.present();

      // Show success toast
      await this.showToast('Payment processed successfully', 'success');

    } catch (error) {
      await loading.dismiss();
      console.error('Payment processing error:', error);

      const alert = await this.alertController.create({
        header: 'Payment Error',
        message: 'Failed to process payment. Please contact support.',
        buttons: ['OK'],
        cssClass: 'custom-document-alert'
      });
      await alert.present();
    }
  }
}






