
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, LoadingController, ToastController, AlertController, ModalController } from '@ionic/angular';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription, firstValueFrom, filter } from 'rxjs';
import { CaspioService } from '../../services/caspio.service';
import { PaypalPaymentModalComponent } from '../../modals/paypal-payment-modal/paypal-payment-modal.component';
import { ConfirmationDialogService } from '../../services/confirmation-dialog.service';
import { PageTitleService } from '../../services/page-title.service';
import { environment } from '../../../environments/environment';
import { ApiGatewayService } from '../../services/api-gateway.service';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { getLogoBase64 } from '../../services/pdf/pdf-logo';

type DocumentViewerCtor = typeof import('../../components/document-viewer/document-viewer.component')['DocumentViewerComponent'];

interface StageDefinition {
  id: number;
  name: string;
  sortOrder: number;
}

interface ProjectMetadata {
  companyId: number | null;
  projectDate: Date | null;
  offersId: number | null;
  statusId: number | null;
}

interface CompanyRecord {
  PK_ID: number;
  CompanyID: number;
  StageID: number | null;
  StageName: string;
  CompanyName: string;
  SizeLabel: string;
  Size?: string;
  ServiceArea: string;
  LeadSource: string;
  Phone: string;
  Email: string;
  Website: string;
  Address: string;
  City: string;
  State: string;
  Zip: string;
  Notes: string;
  Franchise: boolean;
  DateOnboarded: string;
  CCEmail: string;
  CC_Email?: string;
  SoftwareID?: string;
  'Onboarding Stage'?: string;
  Contract?: string;
  // Autopay fields
  AutopayEnabled?: boolean;
  AutopayMethod?: string; // 'PayPal' or 'Stripe'
  // PayPal fields
  PayPalVaultToken?: string;
  PayPalPayerID?: string;
  PayPalPayerEmail?: string;
  // Stripe fields
  StripeCustomerID?: string;
  StripePaymentMethodID?: string;
  StripeBankLast4?: string;
  StripeBankName?: string;
  AutopayDay?: number;
  AutopayLastRun?: string;
  AutopayLastStatus?: string;
  AutopayReviewRequired?: boolean;
  Logo?: string;
}

interface InvoiceTotals {
  total: number;
  outstanding: number;
  paid: number;
  invoices?: number;
}

interface CompanyViewModel extends CompanyRecord {
  contactCount: number;
  openTasks: number;
  overdueTasks: number;
  totalTouches: number;
  lastTouchLabel: string;
  lastTouchDate: Date | null;
  upcomingMeetingDate: Date | null;
  invoiceTotals: InvoiceTotals;
}

interface SnapshotItem {
  label: string;
  value: string;
  icon: string;
  hint?: string;
}

interface StatItem {
  title: string;
  value: string;
  subtitle?: string;
  icon: string;
}

interface ContactRecord {
  PK_ID: number;
  ContactID: number;
  CompanyID: number | null;
  Name: string;
  Title: string;
  Goal?: string;
  Role: string;
  Email: string;
  Phone1: string;
  Phone2: string;
  PrimaryContact: boolean;
  Notes: string;
}

interface ContactGroup {
  companyId: number | null;
  companyName: string;
  contacts: ContactRecord[];
}

interface TaskViewModel {
  PK_ID: number;
  TaskID: number;
  CompanyID: number | null;
  dueDate: Date | null;
  assignment: string;
  assignmentShort: string;
  assignTo: string;
  completed: boolean;
  notes: string;
  communicationType: string;
  communicationId: number | null;
  isOverdue: boolean;
}

interface MeetingViewModel {
  PK_ID: number;
  MeetingID: number;
  CompanyID: number | null;
  subject: string;
  description: string;
  startDate: Date | null;
  endDate: Date | null;
  attendees: string[];
}

interface CommunicationViewModel {
  PK_ID: number;
  TouchID: number;
  CompanyID: number | null;
  date: Date | null;
  mode: string;
  communicationType: string;
  notes: string;
  outcome: string;
  channels: string[];
}

interface InvoiceRecord {
  PK_ID: number;
  InvoiceID: number;
  ProjectID: number | null;
  ServiceID: number | null;
  Date: string | null;
  Address: string;
  City: string;
  Zip: string;
  Fee: number;
  Paid: number | null;
  PaymentProcessor: string;
  InvoiceNotes: string;
  StateID: number | null;
  Mode: string;
  AddedInvoice: string;
}

interface InvoiceViewModel extends InvoiceRecord {
  CompanyID: number | null;
  CompanyName: string;
  DateValue: Date | null;
  ProjectDate: Date | null;
  AmountLabel: string;
  BalanceLabel: string;
  Status: string;
}

interface StageGroup {
  stage: StageDefinition;
  companies: CompanyViewModel[];
}

interface StageSummary {
  stage: StageDefinition;
  count: number;
  highlight: boolean;
}

interface InvoicePair {
  positive: InvoiceViewModel;
  negative: InvoiceViewModel | null;
  projectDate: Date | null;
  netAmount: number;
  allPositives: InvoiceViewModel[];
  allNegatives: InvoiceViewModel[];
}

interface PaidInvoiceGroup {
  companyId: number | null;
  companyName: string;
  items: InvoicePair[];
}

interface InvoiceGroup {
  companyId: number | null;
  companyName: string;
  invoices: InvoicePairWithService[];
}

interface InvoicePairWithService extends InvoicePair {
  serviceName: string;
}

@Component({
  selector: 'app-company',
  templateUrl: './company.page.html',
  styleUrls: ['./company.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, HttpClientModule]
})
export class CompanyPage implements OnInit, OnDestroy {
  isCompanyOne = false;
  currentUserCompanyId: number | null = null;
  currentUserCompanyName: string = '';
  organizationUsers: any[] = [];

  // Admin CRM main tab (Company vs Partners)
  adminMainTab: 'company' | 'partners' | 'metrics' = 'partners';
  selectedTab: 'company' | 'companies' | 'contacts' | 'tasks' | 'meetings' | 'communications' | 'invoices' | 'metrics' | 'users' | 'notifications' = 'users';
  adminDetailsExpanded = true;
  adminUsersExpanded = true;
  adminLogoFailed = false;

  // Client-only tabs (for non-CompanyID 1 users)
  clientTab: 'company' | 'payments' | 'metrics' = 'company';
  detailsExpanded = true;
  clientLogoFailed = false;
  usersExpanded = true;
  servicesExpanded = true;
  deleteAccountExpanded = false;
  editingAllFees = false;
  savingFees = false;
  paymentSettingsExpanded = true;
  outstandingBalanceExpanded = true;
  paymentHistoryExpanded = true;
  autopaySettingsExpanded = true;
  autopayAutoCharge = false; // Derived from CompanyID=1 AutopayReviewRequired (inverted)
  autopayDueCompanies: CompanyViewModel[] = []; // Companies with autopay due today
  clientOffers: any[] = [];
  clientMetrics: { totalProjects: number; activeProjects: number; completedProjects: number } | null = null;

  // Getter for client's company (for non-Company-1 users)
  get clientCompany(): CompanyRecord | null {
    return this.companies.length > 0 ? this.companies[0] : null;
  }


  // Outstanding invoices tracking for CRM company rollups
  companyOutstandingData: Map<number, {
    loading: boolean;
    balance: number;
    invoices: Array<{
      projectId: number;
      projectAddress: string;
      serviceShortNames: string;
      fee: number;
      balance: number;
      services: Array<{ name: string; fee: number }>;
    }>;
    paidInvoices: Array<{
      projectId: number;
      projectAddress: string;
      paidAmount: number;
      paidDate: string | null;
      balance: number;
      services: Array<{ name: string; fee: number }>;
    }>;
  }> = new Map();

  private routerSubscription?: Subscription;

  clientProjectsChart: Chart | null = null;
  clientServicesChart: Chart | null = null;
  clientProjectsChartData: { labels: string[]; values: number[] } = { labels: [], values: [] };
  clientServicesChartData: { labels: string[]; values: number[]; colors: string[] } = { labels: [], values: [], colors: [] };

  isLoading = false;
  isInitialLoad = true;
  isProcessingTab = false;

  // WEBAPP: Expose isWeb for template skeleton loader conditionals
  isWeb = environment.isWeb;

  companies: CompanyRecord[] = [];
  currentCompany: CompanyRecord | null = null;
  stages: StageDefinition[] = [];
  stageGroups: StageGroup[] = [];
  stageSummary: StageSummary[] = [];

  companyFilters = {
    search: '',
    stage: 'all',
    size: 'all',
    leadSource: 'all',
    onlyFranchise: false,
    hasNotes: false
  };

  selectedCompanyId: number | null = null;
  selectedCompany: CompanyViewModel | null = null;
  companySnapshot: SnapshotItem[] = [];
  companyStats: StatItem[] = [];

  contacts: ContactRecord[] = [];
  contactsSearchTerm = '';
  contactGroups: ContactGroup[] = [];
  private contactSearchDebounce: any = null;

  // Pagination for contacts
  contactsPerPage = 150;
  currentContactPage = 1;
  totalContactPages = 1;
  paginatedContactGroups: ContactGroup[] = [];

  // Users data
  allUsers: any[] = [];
  filteredUsers: any[] = [];
  usersSearchTerm = '';

  // Offers data
  allOffers: any[] = [];
  private offersByCompany = new Map<number, any[]>();

  tasks: TaskViewModel[] = [];
  filteredTasks: TaskViewModel[] = [];
  paginatedTasks: TaskViewModel[] = [];
  tasksPerPage = 150;
  currentTaskPage = 1;
  totalTaskPages = 1;
  taskFilters = {
    search: '',
    status: 'all',
    assignedTo: 'all',
    scope: 'all',
    timeframe: '7day' // 'overdue', 'past', '7day', 'all' - default to 7 day
  };
  taskAssignees: string[] = [];
  taskMetrics = { total: 0, completed: 0, outstanding: 0, overdue: 0 };
  private taskUpdatingIds = new Set<number>();

  meetings: MeetingViewModel[] = [];
  filteredMeetings: MeetingViewModel[] = [];
  paginatedMeetings: MeetingViewModel[] = [];
  meetingsPerPage = 150;
  currentMeetingPage = 1;
  totalMeetingPages = 1;
  meetingFilters = {
    search: '',
    timeframe: 'upcoming'
  };

  communications: CommunicationViewModel[] = [];
  filteredCommunications: CommunicationViewModel[] = [];
  paginatedCommunications: CommunicationViewModel[] = [];
  communicationsPerPage = 150;
  currentCommunicationPage = 1;
  totalCommunicationPages = 1;
  communicationSearchTerm = '';

  invoices: InvoiceViewModel[] = [];
  invoiceSearchTerm = '';
  invoiceViewMode: 'open' | 'past' | 'unpaid' = 'open';
  openInvoices: InvoicePair[] = [];
  unpaidInvoices: InvoicePair[] = [];
  paidInvoiceGroups: PaidInvoiceGroup[] = [];
  paginatedOpenInvoices: InvoicePair[] = [];
  paginatedUnpaidInvoices: InvoicePair[] = [];
  paginatedPaidGroups: PaidInvoiceGroup[] = [];
  paginatedInvoiceGroups: InvoiceGroup[] = [];
  invoicesPerPage = 150;
  currentInvoicePage = 1;
  totalInvoicePages = 1;
  invoiceMetrics: InvoiceTotals = { total: 0, outstanding: 0, paid: 0 };
  visibleInvoiceCount = 0;

  // Metrics tab - chart data
  revenueChart: Chart | null = null;
  revenueChartData: { labels: string[]; values: number[] } = { labels: [], values: [] };
  projectsByTypeChart: Chart | null = null;
  projectsByTypeData: { labels: string[]; completedCounts: number[]; totalRevenue: number[] } = { labels: [], completedCounts: [], totalRevenue: [] };

  // Projects data
  projects: any[] = [];

  private stageLookup = new Map<number, StageDefinition>();
  private companyNameLookup = new Map<number, string>();
  private projectDetailsLookup = new Map<number, ProjectMetadata>();
  private servicesLookup = new Map<number, number>(); // ServiceID -> TypeID
  private servicesByProjectLookup = new Map<number, number[]>(); // ProjectID -> ServiceID[]
  private typeIdToNameLookup = new Map<number, string>(); // TypeID -> TypeName (from Type table)
  private offersLookup = new Map<number, number>(); // OffersID -> TypeID
  private contactCountByCompany = new Map<number, number>();
  private taskSummaryByCompany = new Map<number, { open: number; overdue: number; nextDue: Date | null }>();
  private touchSummaryByCompany = new Map<number, { total: number; lastDate: Date | null; label: string; channels: string[] }>();
  private meetingSummaryByCompany = new Map<number, { nextMeeting: Date | null; recentMeeting: Date | null; total: number }>();
  private invoiceSummaryByCompany = new Map<number, InvoiceTotals>();
  private communicationTypeLookup = new Map<number, string>();
  private readonly excludedCompanyId = 1;

  uniqueCompanySizes: string[] = [];
  uniqueLeadSources: string[] = [];
  softwareOptions: string[] = [];
  softwareNameToIdMap: Map<string, number> = new Map();
  // Maps Size display label → Caspio List-String key (e.g. "Multi Inspector (2-5)" → "2")
  sizeLabelToKeyMap: Map<string, string> = new Map();

  // Global company filter
  globalCompanyFilterId: number | null = null;
  globalCompanySearchTerm: string = '';
  filteredCompanySuggestions: CompanyRecord[] = [];
  showCompanySuggestions: boolean = false;
  private companySearchDebounce: any = null;

  selectedContact: ContactRecord | null = null;
  isContactModalOpen = false;

  // Add contact modal
  isAddContactModalOpen = false;

  // Edit contact modal
  isEditContactModalOpen = false;
  editingContact: any = null;
  newContact: any = {
    CompanyID: null,
    Name: '',
    Title: '',
    Role: '',
    Email: '',
    Phone1: '',
    Phone2: '',
    PrimaryContact: false,
    Notes: ''
  };

  // Add user modal
  isAddUserModalOpen = false;
  newUser: any = {
    CompanyID: null,
    Name: '',
    Email: '',
    Phone: '',
    Title: ''
  };
  newUserHeadshotFile: File | null = null;
  newUserHeadshotPreview: string | null = null;

  // Edit user headshot modal
  isEditUserHeadshotModalOpen = false;
  editingUserHeadshot: any = null;
  editUserHeadshotFile: File | null = null;
  editUserHeadshotPreview: string | null = null;

  // Edit user modal
  isEditUserModalOpen = false;
  editingUser: any = null;
  editingUserOriginal: any = null;
  editUserModalHeadshotFile: File | null = null;
  editUserModalHeadshotPreview: string | null = null;

  // Invoice edit modal
  isEditInvoiceModalOpen = false;
  editingInvoice: InvoicePairWithService | null = null;

  // Add invoice modal
  isAddInvoiceModalOpen = false;
  newInvoice: any = {
    ProjectID: null,
    ServiceID: null,
    Address: '',
    City: '',
    Zip: '',
    Date: '',
    Fee: 0,
    Mode: 'positive',
    InvoiceNotes: '',
    AddedInvoice: ''
  };
  newInvoiceContext: string = '';
  addedServiceType: string = '';
  addedServiceCustomLabel: string = '';

  editingCompany: any = null;
  isEditModalOpen = false;
  editingCompanyLogoFile: File | null = null;
  editingCompanyLogoPreview: string | null = null;
  editLogoFailed = false;

  // Add company modal
  isAddCompanyModalOpen = false;
  newCompany: any = {
    CompanyName: '',
    DateOnboarded: '',
    'Onboarding Stage': '',
    SoftwareID: '',
    Size: '',
    Franchise: false,
    LeadSource: '',
    Phone: '',
    Email: '',
    CC_Email: '',
    Website: '',
    Address: '',
    City: '',
    State: '',
    Zip: '',
    ServiceArea: '',
    Contract: null,
    Notes: ''
  };
  newCompanyContractFile: File | null = null;
  newCompanyLogoFile: File | null = null;
  newCompanyLogoPreview: string | null = null;
  editingCompanyContractFile: File | null = null;
  newCompanyOffers: any[] = [];
  newCompanyOfferTypeId: number | null = null;
  editOfferTypeId: number | null = null;

  // Add meeting modal
  isAddMeetingModalOpen = false;
  newMeeting: any = {
    CompanyID: null,
    Subject: '',
    Description: '',
    StartDate: '',
    EndDate: '',
    Attendee1: '',
    Attendee2: '',
    Attendee3: '',
    Attendee4: '',
    Attendee5: ''
  };

  // Add communication modal
  isAddCommunicationModalOpen = false;
  newCommunication: any = {
    CompanyID: null,
    Date: '',
    CommunicationID: null,
    Notes: '',
    Conversed: false,
    LeftVM: false,
    AlsoTexted: false,
    AlsoEmailed: false
  };

  // Edit communication modal
  isEditCommunicationModalOpen = false;
  editingCommunication: any = null;

  // Edit meeting modal
  isEditMeetingModalOpen = false;
  editingMeeting: any = null;

  // Add task modal
  isAddTaskModalOpen = false;
  newTask: any = {
    CompanyID: null,
    CommunicationID: null,
    Due: '',
    Assignment: '',
    AssignTo: '',
    Complete: 0,
    CompleteNotes: ''
  };

  // Edit task
  isEditTaskModalOpen = false;
  editingTask: any = null;
  editingTaskOriginal: TaskViewModel | null = null;

  communicationTypes: Array<{id: number, name: string}> = [];
  taskUsers: Array<{name: string}> = [];

  // Notification settings & sender
  allCompaniesForNotif: Array<{CompanyID: number, CompanyName: string}> = [];
  globalNotifServiceComplete = true;
  globalNotifPaymentReceived = true;
  notifTargetType: 'all' | 'company' | 'user' = 'all';
  notifTargetSearch = '';
  notifTargetId: string | null = null;
  notifTargetSuggestions: Array<{id: string, label: string}> = [];
  notifTitle = '';
  notifBody = '';
  notifSending = false;
  notifHistory: Array<{title: string, body: string, targetLabel: string, time: Date, success: boolean, sent: number}> = [];

  private documentViewerComponent?: DocumentViewerCtor;

  private async loadDocumentViewer(): Promise<DocumentViewerCtor> {
    if (!this.documentViewerComponent) {
      const module = await import('../../components/document-viewer/document-viewer.component');
      this.documentViewerComponent = module.DocumentViewerComponent;
    }
    return this.documentViewerComponent;
  }

  constructor(
    private caspioService: CaspioService,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private alertController: AlertController,
    private modalController: ModalController,
    private confirmationDialog: ConfirmationDialogService,
    private apiGateway: ApiGatewayService,
    private http: HttpClient,
    private router: Router,
    private pageTitleService: PageTitleService
  ) {}

  ngOnInit() {
    // G2-SEO-001: Set page title for company page
    this.pageTitleService.setTitle('Company');

    // Register Chart.js components
    Chart.register(...registerables);

    // Check if user is from Company ID 1
    const userStr = localStorage.getItem('currentUser');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        this.currentUserCompanyId = user.companyId || null;
        this.isCompanyOne = user.companyId === 1;
      } catch (e) {
        console.error('Error parsing user data:', e);
        this.isCompanyOne = false;
      }
    }

    // Load global notification settings from backend
    this.loadNotificationSettings();

    // Load appropriate data based on company
    if (this.isCompanyOne) {
      this.loadCompanyData();
    } else {
      this.loadOrganizationUsers();
    }

    // Refresh outstanding balance data when returning to this tab from other pages
    this.routerSubscription = this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      filter(event => event.urlAfterRedirects?.includes('/tabs/company'))
    ).subscribe(() => {
      if (this.isCompanyOne) {
        // CRM view: reload balances for any previously loaded companies
        this.refreshExpandedCompanyBalances();
      } else if (this.currentUserCompanyId) {
        // Client view: reload own company balance
        this.companyOutstandingData.delete(this.currentUserCompanyId);
        this.loadCompanyOutstandingInvoices(this.currentUserCompanyId);
      }
    });
  }

  private refreshExpandedCompanyBalances() {
    const companyIds = Array.from(this.companyOutstandingData.keys());
    this.companyOutstandingData.clear();
    for (const companyId of companyIds) {
      this.loadCompanyOutstandingInvoices(companyId);
    }
  }

  async loadOrganizationUsers() {
    if (!this.currentUserCompanyId) {
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    try {
      // Load users from the Users table filtered by the current user's CompanyID
      const response = await firstValueFrom(
        this.caspioService.get<any>(`/tables/LPS_Users/records?q.where=CompanyID=${this.currentUserCompanyId}`)
      );

      if (response && response.Result) {
        this.organizationUsers = response.Result;
      }

      // Load company name and offers separately (non-blocking for user display)
      this.loadCurrentUserCompanyName();
      this.loadClientOffers();
    } catch (error) {
      console.error('Error loading organization users:', error);
      const toast = await this.toastController.create({
        message: 'Failed to load organization users',
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
    } finally {
      this.isLoading = false;
    }
  }

  async loadCurrentUserCompanyName() {
    if (!this.currentUserCompanyId) return;

    try {
      const response = await firstValueFrom(
        this.caspioService.get<any>(`/tables/LPS_Companies/records?q.where=CompanyID=${this.currentUserCompanyId}`)
      );

      if (response && response.Result && response.Result.length > 0) {
        const raw = response.Result[0];
        this.currentUserCompanyName = raw.CompanyName || raw.Name || '';
        // Normalize raw Caspio fields for client view
        // SoftwareID may be text; Size may be string or Caspio ListBox object
        const company = {
          ...raw,
          SoftwareID: typeof raw.SoftwareID === 'string' ? raw.SoftwareID : (raw.SoftwareID ?? ''),
          Size: this.extractSizeLabel(raw.Size) || '',
          CC_Email: raw.CC_Email ?? raw.CCEmail ?? '',
          Franchise: raw.Franchise === true || raw.Franchise === 1 || raw.Franchise === 'Yes',
        };
        this.companies = [company];

        // Load software lookup for resolving numeric SoftwareID to name
        this.loadSoftwareLookup();

        // Preload outstanding balance data for the payments tab
        this.loadCompanyOutstandingInvoices(this.currentUserCompanyId!);
      }
    } catch (error) {
      console.error('Error loading company name:', error);
    }
  }

  private async loadSoftwareLookup(): Promise<void> {
    if (this.softwareNameToIdMap.size > 0) return;
    try {
      const response = await firstValueFrom(
        this.caspioService.get<any>('/tables/LPS_Software/records?q.orderBy=Software&q.limit=500')
      );
      if (response?.Result) {
        this.softwareNameToIdMap.clear();
        this.softwareOptions = response.Result
          .map((r: any) => {
            const name = r.Software ?? r.Name ?? '';
            const id = Number(r.SoftwareID ?? r.PK_ID ?? 0);
            if (name.trim() !== '' && id > 0) {
              this.softwareNameToIdMap.set(name, id);
            }
            return name;
          })
          .filter((name: string) => name.trim() !== '')
          .sort();
      }
    } catch (e) {
      console.error('Error loading software lookup:', e);
    }
  }

  /**
   * Load outstanding balance for a specific company (CRM view)
   * Calculates balance based on services added to projects, minus any payments
   */
  async loadCompanyOutstandingInvoices(companyId: number): Promise<void> {
    // Initialize loading state
    this.companyOutstandingData.set(companyId, {
      loading: true,
      balance: 0,
      invoices: [],
      paidInvoices: []
    });

    try {
      // Load projects for this company
      const projectsResponse = await firstValueFrom(
        this.caspioService.get<any>(`/tables/LPS_Projects/records?q.where=CompanyID=${companyId}`)
      );

      if (!projectsResponse?.Result?.length) {
        this.companyOutstandingData.set(companyId, { loading: false, balance: 0, invoices: [], paidInvoices: [] });
        return;
      }

      // Build project lookup
      const projectLookup = new Map<number, { address: string; projectId: number }>();
      projectsResponse.Result.forEach((p: any) => {
        const projectId = p.ProjectID || p.PK_ID;
        const address = p.Address || p.ProjectName || `Project #${projectId}`;
        projectLookup.set(projectId, { address, projectId });
      });

      const projectIds = Array.from(projectLookup.keys());

      // Load invoices for all projects in parallel
      // Uses the SAME query format as project-detail's refreshInvoiceBalance
      const invoiceResponses = await Promise.all(
        projectIds.map((projectId: any) =>
          firstValueFrom(
            this.caspioService.get<any>(`/tables/LPS_Invoices/records?q.where=ProjectID=${projectId}`, false)
          ).catch(() => ({ Result: [] }))
        )
      );

      // Calculate balance per project using the SAME process as project-detail:
      // Sum ALL Fee values (positive = charge, negative = payment), round to 2 decimals
      let totalBalance = 0;
      const unpaidProjects: any[] = [];
      const paidInvoices: any[] = [];

      invoiceResponses.forEach((response: any, index: number) => {
        const projectId = projectIds[index];
        const projectInfo = projectLookup.get(projectId);
        if (!response?.Result?.length) return;

        // Sum ALL fees — identical to project-detail's refreshInvoiceBalance
        let projectBalance = 0;
        let totalCharges = 0;
        let totalPaid = 0;
        let latestPaymentDate: string | null = null;
        const services: Array<{ name: string; fee: number }> = [];

        response.Result.forEach((invoice: any) => {
          const fee = parseFloat(invoice.Fee) || 0;
          projectBalance += fee;
          if (fee > 0) {
            totalCharges += fee;
            const normalized = this.normalizeInvoiceRecord(invoice);
            const label = this.getInvoiceLineLabel(normalized);
            services.push({ name: label, fee });
          } else if (fee < 0) {
            totalPaid += Math.abs(fee);
            if (invoice.Date && (!latestPaymentDate || new Date(invoice.Date) > new Date(latestPaymentDate))) {
              latestPaymentDate = invoice.Date;
            }
          }
        });

        // Round to 2 decimal places (same as project-detail)
        projectBalance = Math.round(projectBalance * 100) / 100;
        totalCharges = Math.round(totalCharges * 100) / 100;
        totalPaid = Math.round(totalPaid * 100) / 100;

        // Include ALL projects with invoices (positive balance = owed, negative = overpaid)
        // This matches how project-detail shows the balance
        if (projectBalance !== 0 || totalCharges > 0) {
          const shortNames = [...new Set(services.map(s => s.name.substring(0, 15)))].join(', ');
          unpaidProjects.push({
            projectId,
            projectAddress: projectInfo?.address || 'Unknown',
            serviceShortNames: shortNames,
            fee: totalCharges,
            balance: projectBalance,
            services
          });
        }
        totalBalance += projectBalance;

        if (totalPaid > 0) {
          paidInvoices.push({
            projectId,
            projectAddress: projectInfo?.address || 'Unknown',
            paidAmount: totalPaid,
            paidDate: latestPaymentDate,
            balance: projectBalance,
            services
          });
        }
      });

      // Sort paid invoices by date (most recent first)
      paidInvoices.sort((a: any, b: any) => {
        if (!a.paidDate && !b.paidDate) return 0;
        if (!a.paidDate) return 1;
        if (!b.paidDate) return -1;
        return new Date(b.paidDate).getTime() - new Date(a.paidDate).getTime();
      });

      const finalBalance = Math.round(totalBalance * 100) / 100;
      this.companyOutstandingData.set(companyId, {
        loading: false,
        balance: finalBalance,
        invoices: unpaidProjects,
        paidInvoices
      });
    } catch (error) {
      console.error('Error loading company outstanding data:', error);
      this.companyOutstandingData.set(companyId, { loading: false, balance: 0, invoices: [], paidInvoices: [] });
    }
  }

  getCompanyOutstandingData(companyId: number): { loading: boolean; balance: number; invoices: any[]; paidInvoices: any[] } {
    return this.companyOutstandingData.get(companyId) || { loading: false, balance: 0, invoices: [], paidInvoices: [] };
  }

  /**
   * Generate and download an invoice PDF
   */
  async downloadInvoice(payment: any, companyName: string): Promise<void> {
    try {
      const totalCost = payment.paidAmount + payment.balance;
      const services: Array<{ name: string; fee: number }> = payment.services || [];
      const logoBase64 = await getLogoBase64();

      // Dynamic import pdfmake
      const pdfMakeModule = await import('pdfmake/build/pdfmake');
      const pdfMake = pdfMakeModule.default || pdfMakeModule;
      const pdfFontsModule: any = await import('pdfmake/build/vfs_fonts');
      const pdfFonts = pdfFontsModule.default || pdfFontsModule;
      (pdfMake as any).vfs = pdfFonts.pdfMake?.vfs || pdfFonts.vfs || pdfFonts;

      // Build header - logo left, title centered
      const headerContent: any[] = [];
      if (logoBase64) {
        headerContent.push({ image: logoBase64, width: 25, margin: [0, 0, 0, 2] });
        headerContent.push({ text: 'engineering@noble-pi.com  |  (832) 210-1397', fontSize: 8, color: '#888888', margin: [0, 0, 0, 10] });
      }
      headerContent.push({ text: 'Noble Engineering Services', style: 'companyName', alignment: 'center', margin: [0, 0, 0, 4] });
      headerContent.push({ text: 'Payment Receipt', style: 'subtitle', alignment: 'center', margin: [0, 0, 0, 0] });

      // Build services table rows
      const serviceTableBody: any[][] = [
        [
          { text: 'Service', style: 'tableHeader' },
          { text: 'Fee', style: 'tableHeader', alignment: 'right' }
        ]
      ];
      for (const s of services) {
        serviceTableBody.push([
          { text: s.name },
          { text: '$' + s.fee.toFixed(2), alignment: 'right' }
        ]);
      }

      // Balance color
      const balanceColor = payment.balance <= 0 ? '#28a745' : '#dc3545';

      const docDefinition: any = {
        content: [
          // Header
          ...headerContent,
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#cccccc' }], margin: [0, 12, 0, 20] },

          // Details
          {
            columns: [
              { text: 'Company:', style: 'label', width: 80 },
              { text: companyName }
            ],
            margin: [0, 0, 0, 6]
          },
          {
            columns: [
              { text: 'Property:', style: 'label', width: 80 },
              { text: payment.projectAddress }
            ],
            margin: [0, 0, 0, 6]
          },
          {
            columns: [
              { text: 'Date:', style: 'label', width: 80 },
              { text: payment.paidDate ? new Date(payment.paidDate).toLocaleDateString() : 'N/A' }
            ],
            margin: [0, 0, 0, 20]
          },

          // Services table
          {
            table: {
              headerRows: 1,
              widths: ['*', 'auto'],
              body: serviceTableBody
            },
            layout: {
              hLineWidth: (i: number, node: any) => i === 1 ? 2 : (i === node.table.body.length ? 0 : 0.5),
              vLineWidth: () => 0,
              hLineColor: (i: number) => i === 1 ? '#333333' : '#eeeeee',
              paddingTop: () => 6,
              paddingBottom: () => 6
            },
            margin: [0, 0, 0, 15]
          },

          // Summary section
          {
            table: {
              widths: ['*', 'auto'],
              body: [
                [
                  { text: 'Total Services:', style: 'label' },
                  { text: '$' + totalCost.toFixed(2), alignment: 'right' }
                ],
                [
                  { text: 'Amount Paid:', style: 'label' },
                  { text: '$' + payment.paidAmount.toFixed(2), alignment: 'right' }
                ],
                [
                  { text: 'Balance:', bold: true, fontSize: 13 },
                  { text: '$' + payment.balance.toFixed(2), alignment: 'right', bold: true, fontSize: 13, color: balanceColor }
                ]
              ]
            },
            layout: {
              hLineWidth: (i: number) => i === 2 ? 2 : 0,
              vLineWidth: () => 0,
              hLineColor: () => '#333333',
              paddingTop: () => 6,
              paddingBottom: () => 6,
              fillColor: () => '#f5f5f5'
            },
            margin: [0, 0, 0, 30]
          },

          // Footer
          { text: 'Thank you for your business!', alignment: 'center', color: '#888888', italics: true }
        ],
        styles: {
          companyName: { fontSize: 20, bold: true, color: '#333333' },
          subtitle: { fontSize: 12, color: '#666666' },
          label: { bold: true, color: '#555555' },
          tableHeader: { bold: true, color: '#555555' }
        },
        defaultStyle: {
          fontSize: 10
        }
      };

      const fileName = `Receipt_${payment.projectAddress.replace(/\s+/g, '_')}_${companyName.replace(/\s+/g, '_')}.pdf`;
      (pdfMake as any).createPdf(docDefinition).download(fileName);

      await this.showToast('Receipt downloaded', 'success');
    } catch (error) {
      console.error('Error generating invoice PDF:', error);
      await this.showToast('Failed to download invoice', 'danger');
    }
  }

  async loadClientOffers() {
    if (!this.currentUserCompanyId) return;

    try {
      // Load offers and types in parallel
      const [offersResponse, typesResponse] = await Promise.all([
        firstValueFrom(
          this.caspioService.get<any>(`/tables/LPS_Offers/records?q.where=CompanyID=${this.currentUserCompanyId}`)
        ),
        firstValueFrom(
          this.caspioService.get<any>('/tables/LPS_Type/records')
        )
      ]);

      // Build type lookup - use full TypeName for client view
      const typeLookup = new Map<number, string>();
      if (typesResponse && typesResponse.Result) {
        typesResponse.Result.forEach((type: any) => {
          const typeId = Number(type.TypeID || type.PK_ID);
          typeLookup.set(typeId, type.TypeName || type.TypeShort || 'Unknown');
        });
      }

      // Process offers with type names
      if (offersResponse && offersResponse.Result) {
        this.clientOffers = offersResponse.Result.map((offer: any) => {
          const typeId = offer.TypeID !== undefined && offer.TypeID !== null ? Number(offer.TypeID) : null;
          return {
            ...offer,
            typeName: typeId !== null ? (typeLookup.get(typeId) || 'Unknown Service') : 'Unknown Service'
          };
        }).sort((a: any, b: any) => {
          // Move "Other" to the bottom
          if (a.typeName === 'Other') return 1;
          if (b.typeName === 'Other') return -1;
          return a.typeName.localeCompare(b.typeName);
        });
      }
    } catch (error) {
      console.error('Error loading client offers:', error);
    }
  }

  async saveClientFee(offer: any): Promise<void> {
    offer._editingFee = false;
    const offerId = offer.OffersID || offer.PK_ID;
    if (!offerId) {
      console.warn('Offer missing ID, skipping save:', offer);
      return;
    }

    try {
      await firstValueFrom(
        this.caspioService.put(`/tables/LPS_Offers/records?q.where=OffersID=${offerId}`, {
          ClientFee: offer.ClientFee || 0
        })
      );
    } catch (error) {
      console.error(`Error saving ClientFee for offer ${offerId}:`, error);
    }
  }

  async toggleEditAllFees(): Promise<void> {
    if (this.savingFees) return;

    if (this.editingAllFees) {
      // Save all fees then exit edit mode
      this.savingFees = true;
      for (const offer of this.clientOffers) {
        const offerId = offer.OffersID || offer.PK_ID;
        if (offerId) {
          try {
            await firstValueFrom(
              this.caspioService.put(`/tables/LPS_Offers/records?q.where=OffersID=${offerId}`, {
                ClientFee: offer.ClientFee || 0
              })
            );
          } catch (error) {
            console.error(`Error saving ClientFee for offer ${offerId}:`, error);
          }
        }
      }
      this.savingFees = false;
      this.editingAllFees = false;
    } else {
      this.editingAllFees = true;
    }
  }

  async loadCompanyData(showSpinner: boolean = true) {
    // Use skeleton loaders for both web and mobile for consistent UX
    this.isLoading = true;

    try {
      // Calculate date filters for time-sensitive data
      // Tasks: Include tasks from 90 days ago to capture overdue items
      const tasksDateFilter = this.getDateFilter(90);
      // Touches/Communications: Last 180 days of activity
      const touchesDateFilter = this.getDateFilter(180);
      // Meetings: From 30 days ago (to include recent past) through future
      const meetingsDateFilter = this.getDateFilter(30);
      // Invoices: Last 365 days
      const invoicesDateFilter = this.getDateFilter(365);


      // Define all fetch tasks - will be executed in chunks to avoid overwhelming the API
      // Group 1: Reference/lookup tables (small, fast)
      const lookupTasks = [
        () => this.fetchTableRecords('Stage', { 'q.orderBy': 'StageID', 'q.limit': '500' }),
        () => this.fetchTableRecords('Software', { 'q.orderBy': 'Software', 'q.limit': '500' }),
        () => this.fetchTableRecords('Communication', { 'q.orderBy': 'CommunicationID', 'q.limit': '500' }),
        () => this.fetchTableRecords('Type', { 'q.select': 'TypeID,TypeName', 'q.limit': '500' })
      ];

      // Group 2: Core entity tables
      const coreTasks = [
        () => this.fetchTableRecords('Companies', { 'q.orderBy': 'CompanyName', 'q.limit': '1000' }),
        () => this.fetchTableRecords('Contacts', { 'q.orderBy': 'CompanyID,Name', 'q.limit': '2000' }),
        () => this.fetchTableRecords('Users', { 'q.orderBy': 'Name', 'q.limit': '1000' })
      ];

      // Group 3: Activity tables with date filters
      const activityTasks = [
        () => this.fetchTableRecords('Tasks', {
          'q.where': `Due>='${tasksDateFilter}' OR Complete=0`,
          'q.orderBy': 'Due DESC',
          'q.limit': '1000'
        }),
        () => this.fetchTableRecords('Touches', {
          'q.where': `Date>='${touchesDateFilter}'`,
          'q.orderBy': 'Date DESC',
          'q.limit': '1000'
        }),
        () => this.fetchTableRecords('Meetings', {
          'q.where': `StartDate>='${meetingsDateFilter}'`,
          'q.orderBy': 'StartDate DESC',
          'q.limit': '1000'
        })
      ];

      // Group 4: Financial and project data
      const financialTasks = [
        () => this.fetchTableRecords('Invoices', {
          'q.where': `Date>='${invoicesDateFilter}'`,
          'q.orderBy': 'Date DESC',
          'q.limit': '2000'
        }),
        () => this.fetchTableRecords('Projects', {
          'q.select': 'ProjectID,CompanyID,Date,OffersID,StatusID,Fee',
          'q.limit': '2000'
        }),
        () => this.fetchTableRecords('Services', {
          'q.select': 'PK_ID,ProjectID,TypeID',
          'q.limit': '2000'
        })
      ];

      // Group 5: Offers (may need pagination)
      const offersTasks = [
        () => this.fetchTableRecords('Offers', {
          'q.select': 'PK_ID,OffersID,TypeID,CompanyID,ServiceFee,ClientFee',
          'q.orderBy': 'OffersID',
          'q.limit': '1000'
        })
      ];

      // Execute each group sequentially, with concurrent requests within each group
      const [stageRecords, softwareRecords, communicationRecords, typeRecords] =
        await this.executeInChunks(lookupTasks, 4, 50);

      const [companyRecords, contactRecords, userRecords] =
        await this.executeInChunks(coreTasks, 3, 100);

      const [taskRecords, touchRecords, meetingRecords] =
        await this.executeInChunks(activityTasks, 3, 100);

      const [invoiceRecords, projectRecords, servicesRecords] =
        await this.executeInChunks(financialTasks, 3, 100);

      let [offersRecords] = await this.executeInChunks(offersTasks, 1, 0);


      // Fetch additional Offers in chunks using WHERE clauses
      if (offersRecords.length === 1000) {
        const lastOffersId = offersRecords[offersRecords.length - 1]?.OffersID || 0;
        let currentMaxId = lastOffersId;

        for (let chunk = 1; chunk <= 10; chunk++) {
          try {
            const minId = currentMaxId + 1;
            const maxId = currentMaxId + 1000;

            const additionalOffers = await this.fetchTableRecords('Offers', {
              'q.select': 'PK_ID,OffersID,TypeID,CompanyID,ServiceFee,ClientFee',
              'q.where': `OffersID>=${minId} AND OffersID<=${maxId}`,
              'q.orderBy': 'OffersID',
              'q.limit': '1000'
            });

            if (additionalOffers && additionalOffers.length > 0) {
              offersRecords.push(...additionalOffers);
              currentMaxId = maxId;

              if (additionalOffers.length < 1000) {
                break; // No more records in this range
              }
            } else {
              break; // No more records
            }
          } catch (e) {
            console.error(`Error fetching Offers chunk ${chunk}:`, e);
            break;
          }
        }
      }

      this.populateStageDefinitions(stageRecords);
      this.populateCommunicationTypes(communicationRecords);
      this.populateProjectLookup(projectRecords);
      this.projects = projectRecords; // Store projects for metrics aggregation
      this.populateTypeLookup(typeRecords);
      this.populateServicesLookup(servicesRecords);
      this.populateOffersLookup(offersRecords);

      // Populate software options from Software table
      this.softwareNameToIdMap.clear();
      this.softwareOptions = softwareRecords
        .map(record => {
          const name = record.Software ?? record.Name ?? '';
          const id = Number(record.SoftwareID ?? record.PK_ID ?? 0);
          if (name.trim() !== '' && id > 0) {
            this.softwareNameToIdMap.set(name, id);
          }
          return name;
        })
        .filter(name => name.trim() !== '')
        .sort();

      // Store all companies (unfiltered) for notification targeting
      this.allCompaniesForNotif = companyRecords.map(r => ({
        CompanyID: Number(r.CompanyID ?? r.PK_ID ?? 0),
        CompanyName: r.CompanyName || r.Name || ''
      }));

      const filteredCompanyRecords = companyRecords.filter(record => {
        const id = Number(record.CompanyID ?? record.PK_ID ?? 0);
        return id !== this.excludedCompanyId;
      });

      this.companies = filteredCompanyRecords.map(record => this.normalizeCompanyRecord(record));
      this.companyNameLookup.clear();
      this.companies.forEach(company => this.companyNameLookup.set(company.CompanyID, company.CompanyName));
      
      // Add excluded company to lookup for user display purposes
      const excludedCompany = companyRecords.find(record => {
        const id = Number(record.CompanyID ?? record.PK_ID ?? 0);
        return id === this.excludedCompanyId;
      });
      if (excludedCompany) {
        const normalizedExcluded = this.normalizeCompanyRecord(excludedCompany);
        this.companyNameLookup.set(normalizedExcluded.CompanyID, normalizedExcluded.CompanyName);
      }

      this.uniqueCompanySizes = this.extractUniqueValues(this.companies.map(company => company.SizeLabel));
      this.uniqueLeadSources = this.extractUniqueValues(this.companies.map(company => company.LeadSource));

      this.ensureSelectedCompany();

      this.contacts = contactRecords
        .filter(record => (record.CompanyID !== undefined && record.CompanyID !== null ? Number(record.CompanyID) : null) !== this.excludedCompanyId)
        .map(record => this.normalizeContactRecord(record));

      this.tasks = taskRecords
        .filter(record => (record.CompanyID !== undefined && record.CompanyID !== null ? Number(record.CompanyID) : null) !== this.excludedCompanyId)
        .map(record => this.normalizeTaskRecord(record));
      this.taskAssignees = this.extractUniqueValues(this.tasks.map(task => task.assignTo).filter(Boolean));

      this.meetings = meetingRecords
        .filter(record => (record.CompanyID !== undefined && record.CompanyID !== null ? Number(record.CompanyID) : null) !== this.excludedCompanyId)
        .map(record => this.normalizeMeetingRecord(record));
      this.communications = touchRecords
        .filter(record => (record.CompanyID !== undefined && record.CompanyID !== null ? Number(record.CompanyID) : null) !== this.excludedCompanyId)
        .map(record => this.normalizeTouchRecord(record));

      this.invoices = invoiceRecords
        .map(record => this.normalizeInvoiceRecord(record))
        .filter(invoice => invoice.CompanyID !== this.excludedCompanyId);

      // Process users data - don't exclude any company for users
      this.allUsers = userRecords;

      // Process offers data and group by company (after Type lookup is populated)
      this.allOffers = offersRecords;
      this.groupOffersByCompany();

      // Load current user's company if it's the excluded one
      if (this.currentUserCompanyId === this.excludedCompanyId) {
        const currentCompanyRecord = companyRecords.find(record => {
          const id = Number(record.CompanyID ?? record.PK_ID ?? 0);
          return id === this.currentUserCompanyId;
        });
        if (currentCompanyRecord) {
          this.currentCompany = this.normalizeCompanyRecord(currentCompanyRecord);
        }
      } else {
        // Current company should be in the companies array
        this.currentCompany = this.companies.find(c => c.CompanyID === this.currentUserCompanyId) || null;
      }

      this.recalculateCompanyAggregates();

      this.applyCompanyFilters();
      this.applyContactFilters();
      this.applyTaskFilters();
      this.applyMeetingFilters();
      this.applyCommunicationFilters();
      this.categorizeInvoices();
      this.applyUserFilters();
      this.updateSelectedCompanySnapshot();

      // Check for companies with autopay ready and load global toggle
      this.checkAutopayDue();
    } catch (error: any) {
      console.error('Error loading company data:', error);
      await this.showToast(error?.message ?? 'Unable to load company data', 'danger');
    } finally {
      this.isLoading = false;
      this.isInitialLoad = false;
    }
  }

  async doRefresh(event: any) {
    if (this.isCompanyOne) {
      await this.loadCompanyData(false);
    } else {
      await this.loadOrganizationUsers();
    }
    event?.target?.complete?.();
  }

  setSelectedCompany(companyId: number) {
    this.selectedCompanyId = companyId;
    this.updateSelectedCompanySnapshot();
    this.applyCompanyFilters();
    this.applyContactFilters();
    this.applyTaskFilters();
    this.applyMeetingFilters();
    this.applyCommunicationFilters();
    this.categorizeInvoices();
    this.applyUserFilters();
  }

  openContactModal(contact: ContactRecord) {
    this.selectedContact = contact;
    this.isContactModalOpen = true;
  }

  closeContactModal() {
    this.isContactModalOpen = false;
    this.selectedContact = null;
  }

  openEditContactModal(contact?: ContactRecord) {
    // If a contact is provided, use it; otherwise use selectedContact
    const contactToEdit = contact || this.selectedContact;

    if (!contactToEdit) {
      return;
    }

    // Create a copy of the contact for editing
    this.editingContact = { ...contactToEdit };

    // Close the view modal and open the edit modal
    this.isContactModalOpen = false;
    this.isEditContactModalOpen = true;
  }

  closeEditContactModal() {
    this.isEditContactModalOpen = false;
    this.editingContact = null;
  }

  async saveEditedContact() {
    if (!this.editingContact) {
      return;
    }

    // Validate required fields
    if (!this.editingContact.CompanyID) {
      await this.showToast('Please select a company', 'warning');
      return;
    }

    if (!this.editingContact.Name || this.editingContact.Name.trim() === '') {
      await this.showToast('Please enter a contact name', 'warning');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Updating contact...'
    });
    await loading.present();

    try {
      // Build payload with all fields
      const payload: any = {
        CompanyID: this.editingContact.CompanyID,
        Name: this.editingContact.Name.trim(),
        PrimaryContact: this.editingContact.PrimaryContact ? 1 : 0
      };

      // Add optional fields
      if (this.editingContact.Title && this.editingContact.Title.trim() !== '') {
        payload.Title = this.editingContact.Title.trim();
      }

      if (this.editingContact.Role && this.editingContact.Role.trim() !== '') {
        payload.Role = this.editingContact.Role.trim();
      }

      if (this.editingContact.Email && this.editingContact.Email.trim() !== '') {
        payload.Email = this.editingContact.Email.trim();
      }

      if (this.editingContact.Phone1 && this.editingContact.Phone1.trim() !== '') {
        payload.Phone1 = this.editingContact.Phone1.trim();
      }

      if (this.editingContact.Phone2 && this.editingContact.Phone2.trim() !== '') {
        payload.Phone2 = this.editingContact.Phone2.trim();
      }

      if (this.editingContact.Notes && this.editingContact.Notes.trim() !== '') {
        payload.Notes = this.editingContact.Notes.trim();
      }

      // Update via Caspio API
      await firstValueFrom(
        this.caspioService.put(`/tables/LPS_Contacts/records?q.where=ContactID=${this.editingContact.ContactID}`, payload)
      );

      // Update the contact in the local array
      const index = this.contacts.findIndex(c => c.ContactID === this.editingContact.ContactID);
      if (index !== -1) {
        this.contacts[index] = { ...this.contacts[index], ...payload };
      }

      // Close modal and refresh
      this.closeEditContactModal();
      this.applyContactFilters();

      await this.showToast('Contact updated successfully', 'success');
    } catch (error: any) {
      console.error('Error updating contact:', error);
      let errorMessage = 'Failed to update contact';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Update failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Update failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Update failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Update failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async deleteContact(contact: any, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    // G2-UX-004: Confirmation dialog with keyboard accessibility (web only)
    const result = await this.confirmationDialog.confirmDelete({
      header: 'Delete Contact',
      message: `Are you sure you want to delete contact "${contact.Name}"? This action cannot be undone.`,
      itemName: contact.Name
    });

    if (result.confirmed) {
      await this.performDeleteContact(contact);
    }
  }

  private async performDeleteContact(contact: any) {
    const loading = await this.loadingController.create({
      message: 'Deleting contact...',
      spinner: 'lines'
    });
    await loading.present();

    try {
      // Delete via Caspio API
      await firstValueFrom(
        this.caspioService.delete(`/tables/LPS_Contacts/records?q.where=ContactID=${contact.ContactID}`)
      );

      // Remove from local contacts array
      const index = this.contacts.findIndex(c => c.ContactID === contact.ContactID);
      if (index !== -1) {
        this.contacts.splice(index, 1);
      }

      // Close the edit modal
      this.closeEditContactModal();

      // Refresh contact groups
      this.applyContactFilters();

      await this.showToast('Contact deleted successfully', 'success');
    } catch (error: any) {
      console.error('Error deleting contact:', error);
      let errorMessage = 'Failed to delete contact';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Delete failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Delete failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Delete failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Delete failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  // Invoice modal methods
  openEditInvoiceModal(invoice: InvoicePairWithService) {
    this.editingInvoice = { ...invoice };
    this.isEditInvoiceModalOpen = true;
  }

  closeEditInvoiceModal() {
    this.isEditInvoiceModalOpen = false;
    this.editingInvoice = null;
  }

  async saveEditedInvoice() {
    if (!this.editingInvoice) {
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Updating invoice...'
    });
    await loading.present();

    try {
      const invoiceId = this.editingInvoice.positive.InvoiceID;

      if (!invoiceId) {
        throw new Error('Invoice ID not found');
      }

      const payload: any = {
        Address: this.editingInvoice.positive.Address,
        City: this.editingInvoice.positive.City,
        Zip: this.editingInvoice.positive.Zip,
        Date: this.editingInvoice.positive.Date,
        Fee: this.editingInvoice.positive.Fee,
        InvoiceNotes: this.editingInvoice.positive.InvoiceNotes
      };

      await firstValueFrom(
        this.caspioService.put(`/tables/LPS_Invoices/records?q.where=InvoiceID=${invoiceId}`, payload)
      );

      // Reload invoices data
      const invoiceRecords = await this.fetchTableRecords('Invoices', { 'q.orderBy': 'Date DESC', 'q.limit': '2000' });
      this.invoices = invoiceRecords
        .map(record => this.normalizeInvoiceRecord(record))
        .filter(invoice => invoice.CompanyID !== this.excludedCompanyId);

      this.recalculateCompanyAggregates();
      this.categorizeInvoices();

      await this.showToast('Invoice updated successfully', 'success');
      this.closeEditInvoiceModal();
    } catch (error: any) {
      console.error('Error updating invoice:', error);
      await this.showToast('Failed to update invoice', 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async deleteInvoice(invoice: any, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    // G2-UX-004: Confirmation dialog with keyboard accessibility (web only)
    const result = await this.confirmationDialog.confirmDeleteItem('Invoice');

    if (result.confirmed) {
      await this.performDeleteInvoice(invoice);
    }
  }

  private async performDeleteInvoice(invoice: any) {
    const loading = await this.loadingController.create({
      message: 'Deleting invoice...'
    });
    await loading.present();

    try {
      const invoiceId = invoice.positive.InvoiceID;

      if (!invoiceId) {
        throw new Error('Invoice ID not found');
      }

      await firstValueFrom(
        this.caspioService.delete(`/tables/LPS_Invoices/records?q.where=InvoiceID=${invoiceId}`)
      );

      // Reload invoices data
      const invoiceRecords = await this.fetchTableRecords('Invoices', { 'q.orderBy': 'Date DESC', 'q.limit': '2000' });
      this.invoices = invoiceRecords
        .map(record => this.normalizeInvoiceRecord(record))
        .filter(invoice => invoice.CompanyID !== this.excludedCompanyId);

      this.recalculateCompanyAggregates();
      this.categorizeInvoices();
      this.closeEditInvoiceModal();

      await this.showToast('Invoice deleted successfully', 'success');
    } catch (error: any) {
      console.error('Error deleting invoice:', error);
      await this.showToast('Failed to delete invoice', 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async deleteInvoiceLine(record: InvoiceViewModel, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    const result = await this.confirmationDialog.confirmDeleteItem('Invoice Line');
    if (!result.confirmed) {
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Deleting line item...'
    });
    await loading.present();

    try {
      if (!record.PK_ID) {
        throw new Error('Record PK_ID not found');
      }

      await firstValueFrom(
        this.caspioService.delete(`/tables/LPS_Invoices/records?q.where=PK_ID=${record.PK_ID}`)
      );

      // Remove from the editing invoice's arrays in-place
      if (this.editingInvoice) {
        this.editingInvoice.allPositives = this.editingInvoice.allPositives.filter(r => r.PK_ID !== record.PK_ID);
        this.editingInvoice.allNegatives = this.editingInvoice.allNegatives.filter(r => r.PK_ID !== record.PK_ID);

        // Recalculate net amount
        const posSum = this.editingInvoice.allPositives.reduce((sum, r) => sum + (r.Fee || 0), 0);
        const negSum = this.editingInvoice.allNegatives.reduce((sum, r) => sum + (r.Fee || 0), 0);
        this.editingInvoice.netAmount = posSum + negSum;
      }

      // Reload invoices data
      const invoiceRecords = await this.fetchTableRecords('Invoices', { 'q.orderBy': 'Date DESC', 'q.limit': '2000' });
      this.invoices = invoiceRecords
        .map(record => this.normalizeInvoiceRecord(record))
        .filter(invoice => invoice.CompanyID !== this.excludedCompanyId);

      this.recalculateCompanyAggregates();
      this.categorizeInvoices();

      await this.showToast('Line item deleted', 'success');
    } catch (error: any) {
      console.error('Error deleting invoice line:', error);
      await this.showToast('Failed to delete line item', 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  openAddInvoiceModal(invoice: InvoicePairWithService) {
    // Pre-fill with context from the selected invoice
    this.newInvoice = {
      ProjectID: invoice.positive.ProjectID,
      ServiceID: null,
      Address: invoice.positive.Address,
      City: invoice.positive.City,
      Zip: invoice.positive.Zip,
      Date: new Date().toISOString().split('T')[0],
      Fee: 0,
      Mode: 'positive',
      InvoiceNotes: '',
      AddedInvoice: ''
    };

    this.addedServiceType = '';
    this.addedServiceCustomLabel = '';
    this.newInvoiceContext = `${invoice.positive.Address || 'Unknown Address'} - ${invoice.serviceName || 'Unknown Service'}`;
    this.isAddInvoiceModalOpen = true;
  }

  closeAddInvoiceModal() {
    this.isAddInvoiceModalOpen = false;
  }

  async saveNewInvoice() {
    if (!this.addedServiceType) {
      await this.showToast('Please select a service type', 'warning');
      return;
    }

    if (this.addedServiceType === 'Other' && !this.addedServiceCustomLabel.trim()) {
      await this.showToast('Please enter a description for Other', 'warning');
      return;
    }

    if (!this.newInvoice.Fee || this.newInvoice.Fee <= 0) {
      await this.showToast('Please enter a valid amount', 'warning');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Creating invoice...'
    });
    await loading.present();

    try {
      // Determine the AddedInvoice label
      const addedInvoiceLabel = this.addedServiceType === 'Other'
        ? this.addedServiceCustomLabel.trim()
        : this.addedServiceType;

      const fee = Math.abs(this.newInvoice.Fee);

      const payload: any = {
        ProjectID: this.newInvoice.ProjectID,
        ServiceID: this.newInvoice.ServiceID,
        Address: this.newInvoice.Address,
        City: this.newInvoice.City,
        Zip: this.newInvoice.Zip,
        Date: this.newInvoice.Date,
        Fee: fee,
        InvoiceNotes: this.newInvoice.InvoiceNotes,
        AddedInvoice: addedInvoiceLabel
      };


      await firstValueFrom(
        this.caspioService.post('/tables/LPS_Invoices/records', payload)
      );

      // Reload invoices data
      const invoiceRecords = await this.fetchTableRecords('Invoices', { 'q.orderBy': 'Date DESC', 'q.limit': '2000' });
      this.invoices = invoiceRecords
        .map(record => this.normalizeInvoiceRecord(record))
        .filter(invoice => invoice.CompanyID !== this.excludedCompanyId);

      this.recalculateCompanyAggregates();
      this.categorizeInvoices();

      await this.showToast('Invoice created successfully', 'success');
      this.closeAddInvoiceModal();
    } catch (error: any) {
      console.error('Error creating invoice:', error);
      await this.showToast('Failed to create invoice', 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async openInvoicePaymentModal(invoice: InvoicePairWithService) {
    // Build services array from invoice data
    const servicesBreakdown = invoice.serviceName ? [{
      name: invoice.serviceName,
      price: invoice.netAmount
    }] : [];

    const modal = await this.modalController.create({
      component: PaypalPaymentModalComponent,
      componentProps: {
        invoice: {
          ProjectID: invoice.positive.ProjectID,
          InvoiceID: invoice.positive.InvoiceID,
          Amount: invoice.netAmount.toFixed(2),
          Address: invoice.positive.Address,
          City: invoice.positive.City,
          Services: servicesBreakdown
        }
      }
    });

    await modal.present();

    const { data } = await modal.onDidDismiss();

    if (data && data.success && data.paymentData) {
      const pd = data.paymentData;
      const grossAmount = parseFloat(pd.amount);
      const originalAmount = parseFloat(pd.originalAmount || pd.amount);
      const paypalFee = Math.round((grossAmount - originalAmount) * 100) / 100;
      const projectId = invoice.positive.ProjectID;

      // Record PayPal processing fee as a positive line item
      if (paypalFee > 0) {
        try {
          await firstValueFrom(
            this.caspioService.post<any>('/tables/LPS_Invoices/records', {
              ProjectID: Number(projectId),
              Fee: Number(paypalFee.toFixed(2)),
              Date: new Date().toISOString().split('T')[0],
              Address: String(invoice.positive.Address || ''),
              InvoiceNotes: 'PayPal Processing Fee',
              PaymentProcessor: 'PayPal'
            })
          );
        } catch (e) { console.error('Failed to record PayPal fee:', e); }
      }

      // Record the full gross payment as a negative record
      try {
        const paymentNotes = `PayPal Payment - Order: ${pd.orderID}\nPayer: ${pd.payerName} (${pd.payerEmail})\nStatus: ${pd.status}`;
        await firstValueFrom(
          this.caspioService.post<any>('/tables/LPS_Invoices/records', {
            ProjectID: Number(projectId),
            Fee: Number((-grossAmount).toFixed(2)),
            Date: new Date().toISOString().split('T')[0],
            Address: String(invoice.positive.Address || ''),
            InvoiceNotes: String(paymentNotes),
            PaymentProcessor: 'PayPal'
          })
        );
      } catch (e) { console.error('Failed to record payment:', e); }

      // Send push notification for payment received (fire-and-forget)
      try {
        const companyId = invoice.positive.CompanyID;
        if (companyId) {
          fetch(`${environment.apiGatewayUrl}/api/notifications/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              companyId: String(companyId),
              title: 'Payment Received',
              body: `$${pd.amount} payment received for ${invoice.positive.Address || 'Project'}`,
              data: { type: 'payment_received', route: `/project/${projectId}` }
            })
          });
        }
      } catch { /* push notification is non-critical */ }

      this.caspioService.clearInvoicesCache();
      // Refresh invoices after successful payment
      await this.categorizeInvoices();
    }
  }

  async openAddContactModal() {
    // Reset the contact with default values, pre-fill company if filter is applied
    this.newContact = {
      CompanyID: this.globalCompanyFilterId,
      Name: '',
      Title: '',
      Role: '',
      Email: '',
      Phone1: '',
      Phone2: '',
      PrimaryContact: false,
      Notes: ''
    };

    this.isAddContactModalOpen = true;
  }

  closeAddContactModal() {
    this.isAddContactModalOpen = false;
  }

  async openAddCompanyModal() {
    // Reset the company with default values
    this.newCompany = {
      CompanyName: '',
      DateOnboarded: '',
      'Onboarding Stage': '',
      SoftwareID: '',
      Size: '',
      Franchise: false,
      LeadSource: '',
      Phone: '',
      Email: '',
      CC_Email: '',
      Website: '',
      Address: '',
      City: '',
      State: '',
      Zip: '',
      ServiceArea: '',
      Contract: null,
      Notes: ''
    };
    this.newCompanyContractFile = null;
    this.newCompanyLogoFile = null;
    this.newCompanyLogoPreview = null;
    this.newCompanyOffers = this.getDefaultServiceOffers();
    this.newCompanyOfferTypeId = null;

    this.isAddCompanyModalOpen = true;
  }

  closeAddCompanyModal() {
    this.isAddCompanyModalOpen = false;
  }

  onNewCompanyContractChange(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.newCompanyContractFile = file;
    }
  }

  onNewCompanyLogoChange(event: any) {
    const file = event.target?.files?.[0];
    if (!file) return;
    this.newCompanyLogoFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      this.newCompanyLogoPreview = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  onEditCompanyContractChange(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.editingCompanyContractFile = file;
    }
  }

  async openContract(pkId: number, contractValue?: string) {
    if (!pkId) return;

    const fileName = contractValue
      ? contractValue.split('/').pop() || 'Contract.pdf'
      : 'Contract.pdf';

    const openInViewer = async (blobUrl: string) => {
      const DocumentViewerComponent = await this.loadDocumentViewer();
      const modal = await this.modalController.create({
        component: DocumentViewerComponent,
        componentProps: {
          fileUrl: blobUrl,
          fileName,
          fileType: 'pdf'
        },
        cssClass: 'fullscreen-modal'
      });
      await modal.present();
    };

    // If the value is a base64 data URL (from frontend upload), open directly
    if (contractValue && contractValue.startsWith('data:')) {
      const parts = contractValue.split(',');
      const mime = parts[0].match(/:(.*?);/)?.[1] || 'application/pdf';
      const byteString = atob(parts[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: mime });
      await openInViewer(URL.createObjectURL(blob));
      return;
    }

    // Try 1: Table file attachment endpoint
    try {
      const tableFileUrl = `${environment.apiGatewayUrl}/api/caspio-files/table-file?table=LPS_Companies&recordId=${pkId}&fieldName=Contract`;
      const response = await fetch(tableFileUrl, { method: 'GET', headers: { 'Accept': 'application/octet-stream' } });
      if (response.ok) {
        const blob = await response.blob();
        await openInViewer(URL.createObjectURL(blob));
        return;
      }
    } catch (e) {
      console.warn('[openContract] table-file failed, trying Files API fallback', e);
    }

    // Try 2: Files API download using the filename
    if (contractValue) {
      try {
        const cleanPath = contractValue.startsWith('/') ? contractValue : `/${contractValue}`;
        const downloadUrl = `${environment.apiGatewayUrl}/api/caspio-files/download?filePath=${encodeURIComponent(cleanPath)}`;
        const response = await fetch(downloadUrl, { method: 'GET' });
        if (response.ok) {
          const blob = await response.blob();
          await openInViewer(URL.createObjectURL(blob));
          return;
        }
      } catch (e) {
        console.warn('[openContract] Files API download failed', e);
      }
    }

    await this.showToast('Unable to load contract document', 'warning');
  }

  async saveNewCompany() {
    if (!this.newCompany) {
      return;
    }

    // Validate required field
    if (!this.newCompany.CompanyName || this.newCompany.CompanyName.trim() === '') {
      await this.showToast('Please enter a company name', 'warning');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Creating company...'
    });
    await loading.present();

    try {
      // Build payload with required and optional fields
      const payload: any = {
        CompanyName: this.newCompany.CompanyName.trim(),
        Franchise: this.newCompany.Franchise ? true : false
      };

      // Add optional fields if provided
      if (this.newCompany.DateOnboarded && this.newCompany.DateOnboarded.trim() !== '') {
        payload.DateOnboarded = this.newCompany.DateOnboarded.trim();
      }

      if (this.newCompany['Onboarding Stage'] && this.newCompany['Onboarding Stage'].trim() !== '') {
        const stageName = this.newCompany['Onboarding Stage'].trim();
        const stage = this.stages.find(s => s.name === stageName);
        if (stage) {
          payload.StageID = stage.id;
        }
      }

      if (this.newCompany.SoftwareID && this.newCompany.SoftwareID.trim() !== '') {
        const softwareName = this.newCompany.SoftwareID.trim();
        const softwareId = this.softwareNameToIdMap.get(softwareName);
        if (softwareId) {
          payload.SoftwareID = softwareId;
        }
      }

      if (this.newCompany.Size && this.newCompany.Size.trim() !== '') {
        const sizeLabel = this.newCompany.Size.trim();
        const sizeKey = this.sizeLabelToKeyMap.get(sizeLabel);
        if (sizeKey) {
          payload.Size = sizeKey;
        }
      }

      if (this.newCompany.LeadSource && this.newCompany.LeadSource.trim() !== '') {
        payload.LeadSource = this.newCompany.LeadSource.trim();
      }

      if (this.newCompany.Phone && this.newCompany.Phone.trim() !== '') {
        payload.Phone = this.newCompany.Phone.trim();
      }

      if (this.newCompany.Email && this.newCompany.Email.trim() !== '') {
        payload.Email = this.newCompany.Email.trim();
      }

      if (this.newCompany.CC_Email && this.newCompany.CC_Email.trim() !== '') {
        payload.CC_Email = this.newCompany.CC_Email.trim();
      }

      if (this.newCompany.Website && this.newCompany.Website.trim() !== '') {
        payload.Website = this.newCompany.Website.trim();
      }

      if (this.newCompany.Address && this.newCompany.Address.trim() !== '') {
        payload.Address = this.newCompany.Address.trim();
      }

      if (this.newCompany.City && this.newCompany.City.trim() !== '') {
        payload.City = this.newCompany.City.trim();
      }

      if (this.newCompany.State && this.newCompany.State.trim() !== '') {
        payload.State = this.newCompany.State.trim();
      }

      if (this.newCompany.Zip && this.newCompany.Zip.trim() !== '') {
        payload.Zip = this.newCompany.Zip.trim();
      }

      if (this.newCompany.ServiceArea && this.newCompany.ServiceArea.trim() !== '') {
        payload.ServiceArea = this.newCompany.ServiceArea.trim();
      }

      if (this.newCompanyContractFile) {
        // Convert file to base64 for Caspio file field
        const reader = new FileReader();
        await new Promise((resolve, reject) => {
          reader.onload = () => {
            payload.Contract = reader.result;
            resolve(true);
          };
          reader.onerror = reject;
          reader.readAsDataURL(this.newCompanyContractFile!);
        });
      }

      if (this.newCompanyLogoFile) {
        const reader = new FileReader();
        await new Promise((resolve, reject) => {
          reader.onload = () => {
            payload.Logo = reader.result;
            resolve(true);
          };
          reader.onerror = reject;
          reader.readAsDataURL(this.newCompanyLogoFile!);
        });
      }

      if (this.newCompany.Notes && this.newCompany.Notes.trim() !== '') {
        payload.Notes = this.newCompany.Notes.trim();
      }


      // Create the company via Caspio API
      const response = await firstValueFrom(
        this.caspioService.post('/tables/LPS_Companies/records', payload)
      );

      // Create service offers for the new company
      if (this.newCompanyOffers.length > 0) {
        // Find the new company's ID by reloading and matching by name
        const tempRecords = await this.fetchTableRecords('Companies', {
          'q.where': `CompanyName='${this.newCompany.CompanyName.trim().replace(/'/g, "''")}'`,
          'q.limit': '1'
        });
        const newCompanyId = tempRecords.length > 0 ? Number(tempRecords[0].CompanyID ?? tempRecords[0].PK_ID) : null;

        if (newCompanyId) {
          const offerPromises = this.newCompanyOffers.map(offer =>
            firstValueFrom(
              this.caspioService.post('/tables/LPS_Offers/records', {
                TypeID: Number(offer.TypeID),
                CompanyID: newCompanyId,
                ServiceFee: Number(offer.ServiceFee) || 0,
                ClientFee: Number(offer.ClientFee) || 0
              })
            ).catch(err => console.error('Error creating offer:', err))
          );
          await Promise.all(offerPromises);
        }
      }

      // Reload companies and offers so new company's data appears in UI
      const companyRecords = await this.fetchTableRecords('Companies', { 'q.orderBy': 'CompanyName', 'q.limit': '2000' });
      const offersRecords = await this.fetchTableRecords('Offers', {
        'q.select': 'PK_ID,OffersID,TypeID,CompanyID,ServiceFee,ClientFee',
        'q.orderBy': 'OffersID',
        'q.limit': '1000'
      });
      this.allOffers = offersRecords;
      this.groupOffersByCompany();
      this.allCompaniesForNotif = companyRecords.map(r => ({
        CompanyID: Number(r.CompanyID ?? r.PK_ID ?? 0),
        CompanyName: r.CompanyName || r.Name || ''
      }));
      const filteredCompanyRecords = companyRecords.filter(record => {
        const id = Number(record.CompanyID ?? record.PK_ID ?? 0);
        return id !== this.excludedCompanyId;
      });

      this.companies = filteredCompanyRecords.map(record => this.normalizeCompanyRecord(record));
      this.companyNameLookup.clear();
      this.companies.forEach(company => this.companyNameLookup.set(company.CompanyID, company.CompanyName));
      
      // Add excluded company to lookup for user display purposes
      const excludedCompany = companyRecords.find(record => {
        const id = Number(record.CompanyID ?? record.PK_ID ?? 0);
        return id === this.excludedCompanyId;
      });
      if (excludedCompany) {
        const normalizedExcluded = this.normalizeCompanyRecord(excludedCompany);
        this.companyNameLookup.set(normalizedExcluded.CompanyID, normalizedExcluded.CompanyName);
      }

      // Recalculate aggregates and reapply filters
      this.recalculateCompanyAggregates();
      this.applyCompanyFilters();
      this.updateSelectedCompanySnapshot();

      await this.showToast('Company created successfully', 'success');
      this.closeAddCompanyModal();
    } catch (error: any) {
      console.error('Error creating company:', error);
      let errorMessage = 'Failed to create company';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Create failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Create failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Create failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Create failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async saveNewContact() {
    if (!this.newContact) {
      return;
    }

    // Validate required fields
    if (!this.newContact.CompanyID) {
      await this.showToast('Please select a company', 'warning');
      return;
    }

    if (!this.newContact.Name || this.newContact.Name.trim() === '') {
      await this.showToast('Please enter a contact name', 'warning');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Creating contact...'
    });
    await loading.present();

    try {
      // Build payload with required and optional fields
      const payload: any = {
        CompanyID: this.newContact.CompanyID,
        Name: this.newContact.Name.trim(),
        PrimaryContact: this.newContact.PrimaryContact ? 1 : 0
      };

      // Add optional fields if provided
      if (this.newContact.Title && this.newContact.Title.trim() !== '') {
        payload.Title = this.newContact.Title.trim();
      }

      if (this.newContact.Role && this.newContact.Role.trim() !== '') {
        payload.Role = this.newContact.Role.trim();
      }

      if (this.newContact.Email && this.newContact.Email.trim() !== '') {
        payload.Email = this.newContact.Email.trim();
      }

      if (this.newContact.Phone1 && this.newContact.Phone1.trim() !== '') {
        payload.Phone1 = this.newContact.Phone1.trim();
      }

      if (this.newContact.Phone2 && this.newContact.Phone2.trim() !== '') {
        payload.Phone2 = this.newContact.Phone2.trim();
      }

      if (this.newContact.Notes && this.newContact.Notes.trim() !== '') {
        payload.Notes = this.newContact.Notes.trim();
      }


      // Create the contact via Caspio API
      const response = await firstValueFrom(
        this.caspioService.post('/tables/LPS_Contacts/records', payload)
      );


      // Reload contacts data to include the new contact
      const contactRecords = await this.fetchTableRecords('Contacts', { 'q.orderBy': 'Name', 'q.limit': '2000' });
      this.contacts = contactRecords
        .filter(record => (record.CompanyID !== undefined && record.CompanyID !== null ? Number(record.CompanyID) : null) !== this.excludedCompanyId)
        .map(record => this.normalizeContactRecord(record));

      // Recalculate aggregates and reapply filters
      this.recalculateCompanyAggregates();
      this.applyContactFilters();
      this.updateSelectedCompanySnapshot();

      await this.showToast('Contact created successfully', 'success');
      this.closeAddContactModal();
    } catch (error: any) {
      console.error('Error creating contact:', error);
      let errorMessage = 'Failed to create contact';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Create failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Create failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Create failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Create failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async openAddUserModal(companyId?: number) {
    // Reset the user with default values, pre-fill company with specified or current user's company
    this.newUser = {
      CompanyID: companyId ?? this.currentUserCompanyId,
      Name: '',
      Email: '',
      Phone: '',
      Password: '',
      Title: ''
    };
    this.newUserHeadshotFile = null;
    this.newUserHeadshotPreview = null;

    this.isAddUserModalOpen = true;
  }

  getCompanyUsers(companyId: number | null): any[] {
    if (companyId === null) return [];
    return this.allUsers.filter(u => Number(u.CompanyID) === companyId);
  }

  closeAddUserModal() {
    this.isAddUserModalOpen = false;
    this.newUserHeadshotFile = null;
    this.newUserHeadshotPreview = null;
  }

  onNewUserHeadshotChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.newUserHeadshotFile = input.files[0];
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.newUserHeadshotPreview = e.target.result;
      };
      reader.readAsDataURL(this.newUserHeadshotFile);
    }
  }

  async saveNewUser() {
    if (!this.newUser) {
      return;
    }

    // Validate required fields
    if (!this.newUser.CompanyID) {
      await this.showToast('Please select a company', 'warning');
      return;
    }

    if (!this.newUser.Name || this.newUser.Name.trim() === '') {
      await this.showToast('Please enter a user name', 'warning');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Creating user...'
    });
    await loading.present();

    try {
      // Build payload with required and optional fields
      const payload: any = {
        CompanyID: this.newUser.CompanyID,
        Name: this.newUser.Name.trim()
      };

      // Add optional fields if provided
      if (this.newUser.Email && this.newUser.Email.trim() !== '') {
        payload.Email = this.newUser.Email.trim();
      }

      if (this.newUser.Phone && this.newUser.Phone.trim() !== '') {
        payload.Phone = this.newUser.Phone.trim();
      }

      if (this.newUser.Title && this.newUser.Title.trim() !== '') {
        payload.Title = this.newUser.Title.trim();
      }

      // Add headshot if provided
      if (this.newUserHeadshotFile) {
        const reader = new FileReader();
        await new Promise((resolve, reject) => {
          reader.onload = () => {
            payload.Headshot = reader.result;
            resolve(true);
          };
          reader.onerror = reject;
          reader.readAsDataURL(this.newUserHeadshotFile!);
        });
      }

      // Create the user via Caspio API (request response=rows to get the created record)
      const response: any = await firstValueFrom(
        this.caspioService.post('/tables/LPS_Users/records?response=rows', payload)
      );

      // After successful creation, try to set the password via a separate PUT
      if (this.newUser.Password && this.newUser.Password.trim() !== '') {
        try {
          const newUserRecord = response?.Result?.[0];
          if (newUserRecord) {
            const userId = newUserRecord.UserID || newUserRecord.PK_ID;
            await firstValueFrom(
              this.caspioService.put(`/tables/LPS_Users/records?q.where=PK_ID=${userId}`, { Password: this.newUser.Password.trim() })
            );
          }
        } catch (pwError) {
          console.warn('Password could not be set via API:', pwError);
        }
      }


      // Reload users data based on user type
      if (this.isCompanyOne) {
        // Admin user - reload all users
        const userRecords = await this.fetchTableRecords('Users', { 'q.orderBy': 'Name', 'q.limit': '2000' });
        this.allUsers = userRecords;
        // Reapply filters
        this.applyUserFilters();
      } else {
        // Non-admin user - reload organization users
        await this.loadOrganizationUsers();
      }

      await this.showToast('User created successfully', 'success');
      this.closeAddUserModal();
    } catch (error: any) {
      console.error('Error creating user:', error);
      let errorMessage = 'Failed to create user';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Create failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Create failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Create failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Create failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async openAddMeetingModal() {
    // Reset the meeting with default values, pre-fill company if filter is applied
    this.newMeeting = {
      CompanyID: this.globalCompanyFilterId,
      Subject: '',
      Description: '',
      StartDate: '',
      EndDate: '',
      Attendee1: '',
      Attendee2: '',
      Attendee3: '',
      Attendee4: '',
      Attendee5: ''
    };

    this.isAddMeetingModalOpen = true;
  }

  closeAddMeetingModal() {
    this.isAddMeetingModalOpen = false;
  }

  async saveNewMeeting() {
    if (!this.newMeeting) {
      return;
    }

    // Validate required fields
    if (!this.newMeeting.CompanyID) {
      await this.showToast('Please select a company', 'warning');
      return;
    }

    if (!this.newMeeting.Subject || this.newMeeting.Subject.trim() === '') {
      await this.showToast('Please enter a subject', 'warning');
      return;
    }

    if (!this.newMeeting.StartDate || this.newMeeting.StartDate.trim() === '') {
      await this.showToast('Please select a start date', 'warning');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Creating meeting...'
    });
    await loading.present();

    try {
      // Build payload with required and optional fields
      const payload: any = {
        CompanyID: this.newMeeting.CompanyID,
        Subject: this.newMeeting.Subject.trim(),
        StartDate: new Date(this.newMeeting.StartDate).toISOString()
      };

      // Add optional fields if provided
      if (this.newMeeting.Description && this.newMeeting.Description.trim() !== '') {
        payload.Description = this.newMeeting.Description.trim();
      }

      if (this.newMeeting.EndDate && this.newMeeting.EndDate.trim() !== '') {
        payload.EndDate = new Date(this.newMeeting.EndDate).toISOString();
      }

      if (this.newMeeting.Attendee1 && this.newMeeting.Attendee1.trim() !== '') {
        payload.Attendee1 = this.newMeeting.Attendee1.trim();
      }

      if (this.newMeeting.Attendee2 && this.newMeeting.Attendee2.trim() !== '') {
        payload.Attendee2 = this.newMeeting.Attendee2.trim();
      }

      if (this.newMeeting.Attendee3 && this.newMeeting.Attendee3.trim() !== '') {
        payload.Attendee3 = this.newMeeting.Attendee3.trim();
      }

      if (this.newMeeting.Attendee4 && this.newMeeting.Attendee4.trim() !== '') {
        payload.Attendee4 = this.newMeeting.Attendee4.trim();
      }

      if (this.newMeeting.Attendee5 && this.newMeeting.Attendee5.trim() !== '') {
        payload.Attendee5 = this.newMeeting.Attendee5.trim();
      }


      // Create the meeting via Caspio API
      const response = await firstValueFrom(
        this.caspioService.post('/tables/LPS_Meetings/records', payload)
      );


      // Reload meetings data to include the new meeting
      const meetingRecords = await this.fetchTableRecords('Meetings', { 'q.orderBy': 'StartDate DESC', 'q.limit': '2000' });
      this.meetings = meetingRecords
        .filter(record => (record.CompanyID !== undefined && record.CompanyID !== null ? Number(record.CompanyID) : null) !== this.excludedCompanyId)
        .map(record => this.normalizeMeetingRecord(record));

      // Recalculate aggregates and reapply filters
      this.recalculateCompanyAggregates();
      this.applyMeetingFilters();
      this.updateSelectedCompanySnapshot();

      await this.showToast('Meeting created successfully', 'success');
      this.closeAddMeetingModal();
    } catch (error: any) {
      console.error('Error creating meeting:', error);
      let errorMessage = 'Failed to create meeting';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Create failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Create failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Create failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Create failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async openAddCommunicationModal() {
    // Reset the communication with default values, pre-fill company if filter is applied
    this.newCommunication = {
      CompanyID: this.globalCompanyFilterId,
      Date: '',
      CommunicationID: null,
      Notes: '',
      Conversed: false,
      LeftVM: false,
      AlsoTexted: false,
      AlsoEmailed: false
    };

    // Populate communication types from the Communication table's Type column
    this.communicationTypes = Array.from(this.communicationTypeLookup.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    this.isAddCommunicationModalOpen = true;
  }

  closeAddCommunicationModal() {
    this.isAddCommunicationModalOpen = false;
  }

  async saveNewCommunication() {
    if (!this.newCommunication) {
      return;
    }

    // Validate required fields
    if (!this.newCommunication.CompanyID) {
      await this.showToast('Please select a company', 'warning');
      return;
    }

    if (!this.newCommunication.Date || this.newCommunication.Date.trim() === '') {
      await this.showToast('Please select a date', 'warning');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Creating communication...'
    });
    await loading.present();

    try {
      // Build payload with required and optional fields
      const payload: any = {
        CompanyID: this.newCommunication.CompanyID,
        Date: new Date(this.newCommunication.Date).toISOString(),
        Conversed: this.newCommunication.Conversed ? 1 : 0,
        LeftVM: this.newCommunication.LeftVM ? 1 : 0,
        AlsoTexted: this.newCommunication.AlsoTexted ? 1 : 0,
        AlsoEmailed: this.newCommunication.AlsoEmailed ? 1 : 0
      };

      // Add optional fields if provided
      if (this.newCommunication.CommunicationID !== null) {
        payload.CommunicationID = this.newCommunication.CommunicationID;
      }

      if (this.newCommunication.Notes && this.newCommunication.Notes.trim() !== '') {
        payload.Notes = this.newCommunication.Notes.trim();
      }


      // Create the communication via Caspio API
      const response = await firstValueFrom(
        this.caspioService.post('/tables/LPS_Touches/records', payload)
      );


      // Reload communications data to include the new communication
      const touchRecords = await this.fetchTableRecords('Touches', { 'q.orderBy': 'Date DESC', 'q.limit': '2000' });
      this.communications = touchRecords
        .filter(record => (record.CompanyID !== undefined && record.CompanyID !== null ? Number(record.CompanyID) : null) !== this.excludedCompanyId)
        .map(record => this.normalizeTouchRecord(record));

      // Recalculate aggregates and reapply filters
      this.recalculateCompanyAggregates();
      this.applyCommunicationFilters();
      this.updateSelectedCompanySnapshot();

      await this.showToast('Communication created successfully', 'success');
      this.closeAddCommunicationModal();
    } catch (error: any) {
      console.error('Error creating communication:', error);
      let errorMessage = 'Failed to create communication';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Create failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Create failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Create failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Create failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async openEditCommunicationModal(communication: CommunicationViewModel) {
    // Format date for datetime-local input
    let formattedDate = '';
    if (communication.date) {
      const d = new Date(communication.date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      formattedDate = `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    // Find the raw communication record from the communications array
    const rawComm = this.communications.find(c => c.PK_ID === communication.PK_ID);

    // Determine the CommunicationID and channel flags from the raw data
    let communicationID = null;
    let conversed = false;
    let leftVM = false;
    let alsoTexted = false;
    let alsoEmailed = false;

    if (rawComm) {
      // Extract the actual database values
      if (communication.channels.includes('Call')) conversed = true;
      if (communication.channels.includes('Voicemail')) leftVM = true;
      if (communication.channels.includes('Text')) alsoTexted = true;
      if (communication.channels.includes('Email')) alsoEmailed = true;

      // Find the CommunicationID from the lookup
      for (const [id, name] of this.communicationTypeLookup.entries()) {
        if (name === communication.communicationType) {
          communicationID = id;
          break;
        }
      }
    }

    this.editingCommunication = {
      PK_ID: communication.PK_ID,
      TouchID: communication.TouchID,
      CompanyID: communication.CompanyID,
      Date: formattedDate,
      CommunicationID: communicationID,
      Notes: communication.notes,
      Conversed: conversed,
      LeftVM: leftVM,
      AlsoTexted: alsoTexted,
      AlsoEmailed: alsoEmailed
    };

    // Populate communication types from the lookup
    this.communicationTypes = Array.from(this.communicationTypeLookup.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    this.isEditCommunicationModalOpen = true;
  }

  closeEditCommunicationModal() {
    this.isEditCommunicationModalOpen = false;
    this.editingCommunication = null;
  }

  async saveEditedCommunication() {
    if (!this.editingCommunication) {
      return;
    }

    // Validate required fields
    if (!this.editingCommunication.CompanyID) {
      await this.showToast('Please select a company', 'warning');
      return;
    }

    if (!this.editingCommunication.Date || this.editingCommunication.Date.trim() === '') {
      await this.showToast('Please select a date', 'warning');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Updating communication...'
    });
    await loading.present();

    try {
      // Build payload
      const payload: any = {
        CompanyID: this.editingCommunication.CompanyID,
        Date: new Date(this.editingCommunication.Date).toISOString(),
        Conversed: this.editingCommunication.Conversed ? 1 : 0,
        LeftVM: this.editingCommunication.LeftVM ? 1 : 0,
        AlsoTexted: this.editingCommunication.AlsoTexted ? 1 : 0,
        AlsoEmailed: this.editingCommunication.AlsoEmailed ? 1 : 0
      };

      // Add optional fields
      if (this.editingCommunication.CommunicationID !== null) {
        payload.CommunicationID = this.editingCommunication.CommunicationID;
      }

      if (this.editingCommunication.Notes && this.editingCommunication.Notes.trim() !== '') {
        payload.Notes = this.editingCommunication.Notes.trim();
      }


      // Update via Caspio API using PK_ID
      const response = await firstValueFrom(
        this.caspioService.put(`/tables/LPS_Touches/records?q.where=PK_ID=${this.editingCommunication.PK_ID}`, payload)
      );


      // Reload communications data
      const touchRecords = await this.fetchTableRecords('Touches', { 'q.orderBy': 'Date DESC', 'q.limit': '2000' });
      this.communications = touchRecords
        .filter(record => (record.CompanyID !== undefined && record.CompanyID !== null ? Number(record.CompanyID) : null) !== this.excludedCompanyId)
        .map(record => this.normalizeTouchRecord(record));

      // Recalculate aggregates and reapply filters
      this.recalculateCompanyAggregates();
      this.applyCommunicationFilters();
      this.updateSelectedCompanySnapshot();

      await this.showToast('Communication updated successfully', 'success');
      this.closeEditCommunicationModal();
    } catch (error: any) {
      console.error('Error updating communication:', error);
      let errorMessage = 'Failed to update communication';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Update failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Update failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Update failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Update failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async deleteCommunication(communication: any, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    // G2-UX-004: Confirmation dialog with keyboard accessibility (web only)
    const result = await this.confirmationDialog.confirmDeleteItem('Communication');

    if (result.confirmed) {
      await this.performDeleteCommunication(communication);
    }
  }

  private async performDeleteCommunication(communication: any) {
    const loading = await this.loadingController.create({
      message: 'Deleting communication...'
    });
    await loading.present();

    try {

      await firstValueFrom(
        this.caspioService.delete(`/tables/LPS_Touches/records?q.where=PK_ID=${communication.PK_ID}`)
      );


      // Reload communications data
      const touchRecords = await this.fetchTableRecords('Touches', { 'q.orderBy': 'Date DESC', 'q.limit': '2000' });
      this.communications = touchRecords
        .filter(record => (record.CompanyID !== undefined && record.CompanyID !== null ? Number(record.CompanyID) : null) !== this.excludedCompanyId)
        .map(record => this.normalizeTouchRecord(record));

      // Recalculate aggregates and reapply filters
      this.recalculateCompanyAggregates();
      this.applyCommunicationFilters();
      this.updateSelectedCompanySnapshot();

      await this.showToast('Communication deleted successfully', 'success');
      this.closeEditCommunicationModal();
    } catch (error: any) {
      console.error('Error deleting communication:', error);
      let errorMessage = 'Failed to delete communication';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Delete failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Delete failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Delete failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Delete failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async openEditMeetingModal(meeting: MeetingViewModel) {
    // Format dates for datetime-local input
    let formattedStartDate = '';
    let formattedEndDate = '';

    if (meeting.startDate) {
      const d = new Date(meeting.startDate);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      formattedStartDate = `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    if (meeting.endDate) {
      const d = new Date(meeting.endDate);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      formattedEndDate = `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    this.editingMeeting = {
      PK_ID: meeting.PK_ID,
      MeetingID: meeting.MeetingID,
      CompanyID: meeting.CompanyID,
      Subject: meeting.subject,
      Description: meeting.description,
      StartDate: formattedStartDate,
      EndDate: formattedEndDate,
      Attendee1: meeting.attendees[0] || '',
      Attendee2: meeting.attendees[1] || '',
      Attendee3: meeting.attendees[2] || '',
      Attendee4: meeting.attendees[3] || '',
      Attendee5: meeting.attendees[4] || ''
    };

    this.isEditMeetingModalOpen = true;
  }

  closeEditMeetingModal() {
    this.isEditMeetingModalOpen = false;
    this.editingMeeting = null;
  }

  async saveEditedMeeting() {
    if (!this.editingMeeting) {
      return;
    }

    // Validate required fields
    if (!this.editingMeeting.CompanyID) {
      await this.showToast('Please select a company', 'warning');
      return;
    }

    if (!this.editingMeeting.Subject || this.editingMeeting.Subject.trim() === '') {
      await this.showToast('Please enter a subject', 'warning');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Updating meeting...'
    });
    await loading.present();

    try {
      // Build payload
      const payload: any = {
        CompanyID: this.editingMeeting.CompanyID,
        Subject: this.editingMeeting.Subject.trim()
      };

      // Add optional fields
      if (this.editingMeeting.Description && this.editingMeeting.Description.trim() !== '') {
        payload.Description = this.editingMeeting.Description.trim();
      }

      if (this.editingMeeting.StartDate && this.editingMeeting.StartDate.trim() !== '') {
        payload.StartDate = new Date(this.editingMeeting.StartDate).toISOString();
      }

      if (this.editingMeeting.EndDate && this.editingMeeting.EndDate.trim() !== '') {
        payload.EndDate = new Date(this.editingMeeting.EndDate).toISOString();
      }

      // Add attendees
      if (this.editingMeeting.Attendee1 && this.editingMeeting.Attendee1.trim() !== '') {
        payload.Attendee1 = this.editingMeeting.Attendee1.trim();
      }
      if (this.editingMeeting.Attendee2 && this.editingMeeting.Attendee2.trim() !== '') {
        payload.Attendee2 = this.editingMeeting.Attendee2.trim();
      }
      if (this.editingMeeting.Attendee3 && this.editingMeeting.Attendee3.trim() !== '') {
        payload.Attendee3 = this.editingMeeting.Attendee3.trim();
      }
      if (this.editingMeeting.Attendee4 && this.editingMeeting.Attendee4.trim() !== '') {
        payload.Attendee4 = this.editingMeeting.Attendee4.trim();
      }
      if (this.editingMeeting.Attendee5 && this.editingMeeting.Attendee5.trim() !== '') {
        payload.Attendee5 = this.editingMeeting.Attendee5.trim();
      }


      // Update via Caspio API using PK_ID
      const response = await firstValueFrom(
        this.caspioService.put(`/tables/LPS_Meetings/records?q.where=PK_ID=${this.editingMeeting.PK_ID}`, payload)
      );


      // Reload meetings data
      const meetingRecords = await this.fetchTableRecords('Meetings', { 'q.orderBy': 'StartDate DESC', 'q.limit': '2000' });
      this.meetings = meetingRecords
        .filter(record => (record.CompanyID !== undefined && record.CompanyID !== null ? Number(record.CompanyID) : null) !== this.excludedCompanyId)
        .map(record => this.normalizeMeetingRecord(record));

      // Recalculate aggregates and reapply filters
      this.recalculateCompanyAggregates();
      this.applyMeetingFilters();
      this.updateSelectedCompanySnapshot();

      await this.showToast('Meeting updated successfully', 'success');
      this.closeEditMeetingModal();
    } catch (error: any) {
      console.error('Error updating meeting:', error);
      let errorMessage = 'Failed to update meeting';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Update failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Update failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Update failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Update failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async deleteMeeting(meeting: any, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    // G2-UX-004: Confirmation dialog with keyboard accessibility (web only)
    const result = await this.confirmationDialog.confirmDeleteItem('Meeting');

    if (result.confirmed) {
      await this.performDeleteMeeting(meeting);
    }
  }

  private async performDeleteMeeting(meeting: any) {
    const loading = await this.loadingController.create({
      message: 'Deleting meeting...'
    });
    await loading.present();

    try {

      await firstValueFrom(
        this.caspioService.delete(`/tables/LPS_Meetings/records?q.where=PK_ID=${meeting.PK_ID}`)
      );


      // Reload meetings data
      const meetingRecords = await this.fetchTableRecords('Meetings', { 'q.orderBy': 'StartDate DESC', 'q.limit': '2000' });
      this.meetings = meetingRecords
        .filter(record => (record.CompanyID !== undefined && record.CompanyID !== null ? Number(record.CompanyID) : null) !== this.excludedCompanyId)
        .map(record => this.normalizeMeetingRecord(record));

      // Recalculate aggregates and reapply filters
      this.recalculateCompanyAggregates();
      this.applyMeetingFilters();
      this.updateSelectedCompanySnapshot();

      await this.showToast('Meeting deleted successfully', 'success');
      this.closeEditMeetingModal();
    } catch (error: any) {
      console.error('Error deleting meeting:', error);
      let errorMessage = 'Failed to delete meeting';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Delete failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Delete failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Delete failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Delete failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async openAddTaskModal() {
    // Reset the task with default values
    this.newTask = {
      CompanyID: this.globalCompanyFilterId,
      CommunicationID: null,
      Due: '',
      Assignment: '',
      AssignTo: '',
      Complete: 0,
      CompleteNotes: ''
    };

    // Populate communication types from the lookup
    this.communicationTypes = Array.from(this.communicationTypeLookup.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Load users from the Users table filtered by current user's CompanyID
    try {
      const userRecords = await this.fetchTableRecords('Users', {
        'q.where': `CompanyID=${this.currentUserCompanyId}`,
        'q.orderBy': 'Name',
        'q.limit': '500'
      });

      this.taskUsers = userRecords
        .filter(user => user.Name && user.Name.trim().length > 0)
        .map(user => ({ name: user.Name.trim() }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      console.error('Error loading users for task assignment:', error);
      this.taskUsers = [];
    }

    this.isAddTaskModalOpen = true;
  }

  closeAddTaskModal() {
    this.isAddTaskModalOpen = false;
  }

  async saveNewTask() {
    if (!this.newTask) {
      return;
    }

    // Validate required fields
    if (!this.newTask.CompanyID) {
      await this.showToast('Please select a company', 'warning');
      return;
    }

    if (!this.newTask.Due) {
      await this.showToast('Please select a due date', 'warning');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Creating task...',
      spinner: 'lines'
    });
    await loading.present();

    try {
      // Build payload for task creation
      const payload: any = {
        CompanyID: this.newTask.CompanyID,
        Due: new Date(this.newTask.Due).toISOString(),
        Complete: 0,
        CompleteNotes: this.newTask.CompleteNotes || ''
      };

      // Add optional fields if provided
      if (this.newTask.Assignment && this.newTask.Assignment.trim() !== '') {
        payload.Assignment = this.newTask.Assignment.trim();
      }

      if (this.newTask.AssignTo) {
        payload.AssignTo = this.newTask.AssignTo.trim();
      }

      if (this.newTask.CommunicationID) {
        payload.CommunicationID = this.newTask.CommunicationID;
      }


      // Create the task via Caspio API
      const response = await firstValueFrom(
        this.caspioService.post('/tables/LPS_Tasks/records', payload)
      );


      // Reload tasks data to include the new task
      const taskRecords = await this.fetchTableRecords('Tasks', { 'q.orderBy': 'Due DESC', 'q.limit': '2000' });
      this.tasks = taskRecords
        .filter(record => (record.CompanyID !== undefined && record.CompanyID !== null ? Number(record.CompanyID) : null) !== this.excludedCompanyId)
        .map(record => this.normalizeTaskRecord(record));
      this.taskAssignees = this.extractUniqueValues(this.tasks.map(task => task.assignTo).filter(Boolean));

      // Recalculate aggregates and reapply filters
      this.recalculateCompanyAggregates();
      this.applyTaskFilters();
      this.updateSelectedCompanySnapshot();

      this.closeAddTaskModal();
    } catch (error: any) {
      console.error('Error creating task:', error);
      let errorMessage = 'Failed to create task';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Create failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Create failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Create failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Create failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async openEditTaskModal(task: TaskViewModel) {
    this.editingTaskOriginal = task;

    // Create editable copy
    this.editingTask = {
      TaskID: task.TaskID,
      CompanyID: task.CompanyID,
      CommunicationID: task.communicationId,
      Due: task.dueDate ? this.formatDateForInput(task.dueDate) : '',
      Assignment: task.assignment,
      AssignTo: task.assignTo,
      Complete: task.completed ? 1 : 0,
      CompleteNotes: task.notes
    };

    // Populate communication types and users
    this.communicationTypes = Array.from(this.communicationTypeLookup.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    try {
      const userRecords = await this.fetchTableRecords('Users', {
        'q.where': `CompanyID=${this.currentUserCompanyId}`,
        'q.orderBy': 'Name',
        'q.limit': '500'
      });

      this.taskUsers = userRecords
        .filter(user => user.Name && user.Name.trim().length > 0)
        .map(user => ({ name: user.Name.trim() }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      console.error('Error loading users for task assignment:', error);
      this.taskUsers = [];
    }

    this.isEditTaskModalOpen = true;
  }

  closeEditTaskModal() {
    this.isEditTaskModalOpen = false;
    this.editingTask = null;
    this.editingTaskOriginal = null;
  }

  async saveEditedTask() {
    if (!this.editingTask || !this.editingTaskOriginal) {
      return;
    }

    // Validate required fields
    if (!this.editingTask.CompanyID) {
      await this.showToast('Please select a company', 'warning');
      return;
    }

    if (!this.editingTask.Due) {
      await this.showToast('Please select a due date', 'warning');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Updating task...',
      spinner: 'lines'
    });
    await loading.present();

    try {
      // Build payload for task update
      const payload: any = {
        CompanyID: this.editingTask.CompanyID,
        Due: new Date(this.editingTask.Due).toISOString(),
        Complete: this.editingTask.Complete ? 1 : 0,
        CompleteNotes: this.editingTask.CompleteNotes || ''
      };

      // Add optional fields if provided
      if (this.editingTask.Assignment && this.editingTask.Assignment.trim() !== '') {
        payload.Assignment = this.editingTask.Assignment.trim();
      }

      if (this.editingTask.AssignTo) {
        payload.AssignTo = this.editingTask.AssignTo.trim();
      }

      if (this.editingTask.CommunicationID) {
        payload.CommunicationID = this.editingTask.CommunicationID;
      }

      // Update via Caspio API
      await firstValueFrom(
        this.caspioService.put(
          `/tables/LPS_Tasks/records?q.where=TaskID=${this.editingTask.TaskID}`,
          payload
        )
      );

      // Reload tasks data
      const taskRecords = await this.fetchTableRecords('Tasks', { 'q.orderBy': 'Due DESC', 'q.limit': '2000' });
      this.tasks = taskRecords
        .filter(record => (record.CompanyID !== undefined && record.CompanyID !== null ? Number(record.CompanyID) : null) !== this.excludedCompanyId)
        .map(record => this.normalizeTaskRecord(record));
      this.taskAssignees = this.extractUniqueValues(this.tasks.map(task => task.assignTo).filter(Boolean));

      // Recalculate aggregates and reapply filters
      this.recalculateCompanyAggregates();
      this.applyTaskFilters();
      this.updateSelectedCompanySnapshot();

      this.closeEditTaskModal();
    } catch (error: any) {
      console.error('Error updating task:', error);
      let errorMessage = 'Failed to update task';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Update failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Update failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Update failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Update failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async deleteTask(task: TaskViewModel, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    // G2-UX-004: Confirmation dialog with keyboard accessibility (web only)
    const result = await this.confirmationDialog.confirmDelete({
      header: 'Delete Task',
      message: `Are you sure you want to delete this task: "${task.assignmentShort}"? This action cannot be undone.`,
      itemName: task.assignmentShort
    });

    if (result.confirmed) {
      await this.performDeleteTask(task);
    }
  }

  private async performDeleteTask(task: TaskViewModel) {
    const loading = await this.loadingController.create({
      message: 'Deleting task...',
      spinner: 'lines'
    });
    await loading.present();

    try {
      // Delete via Caspio API
      await firstValueFrom(
        this.caspioService.delete(`/tables/LPS_Tasks/records?q.where=TaskID=${task.TaskID}`)
      );

      // Remove from local tasks array
      const index = this.tasks.findIndex(t => t.TaskID === task.TaskID);
      if (index !== -1) {
        this.tasks.splice(index, 1);
      }

      // Recalculate aggregates and reapply filters
      this.recalculateCompanyAggregates();
      this.applyTaskFilters();
      this.updateSelectedCompanySnapshot();

      // Close the edit task modal if it's open
      this.closeEditTaskModal();

      await this.showToast('Task deleted successfully', 'success');
    } catch (error: any) {
      console.error('Error deleting task:', error);
      let errorMessage = 'Failed to delete task';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Delete failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Delete failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Delete failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Delete failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async deleteCompany(company: any, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    // G2-UX-004: Confirmation dialog with keyboard accessibility (web only)
    const result = await this.confirmationDialog.confirmDelete({
      header: 'Delete Company',
      message: `Are you sure you want to delete the company "${company.CompanyName}"? This action cannot be undone.`,
      itemName: company.CompanyName
    });

    if (result.confirmed) {
      await this.performDeleteCompany(company);
    }
  }

  private async performDeleteCompany(company: any) {
    const loading = await this.loadingController.create({
      message: 'Deleting company...',
      spinner: 'lines'
    });
    await loading.present();

    try {
      // Delete via Caspio API
      await firstValueFrom(
        this.caspioService.delete(`/tables/LPS_Companies/records?q.where=CompanyID=${company.CompanyID}`)
      );

      // Remove from local companies array
      const index = this.companies.findIndex(c => c.CompanyID === company.CompanyID);
      if (index !== -1) {
        this.companies.splice(index, 1);
      }

      // Close the edit modal
      this.closeEditModal();

      // Recalculate aggregates and reapply filters
      this.recalculateCompanyAggregates();
      this.applyCompanyFilters();

      await this.showToast('Company deleted successfully', 'success');
    } catch (error: any) {
      console.error('Error deleting company:', error);
      let errorMessage = 'Failed to delete company';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Delete failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Delete failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Delete failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Delete failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  // ============================================
  // AUTOPAY METHODS
  // ============================================

  async removePaymentMethod(): Promise<void> {
    // Can be called from client view (clientCompany) or CRM view (editingCompany)
    const company = this.editingCompany || this.clientCompany;
    if (!company) {
      return;
    }

    const alert = await this.alertController.create({
      header: 'Remove Payment Method',
      message: 'Are you sure you want to remove the saved payment method? Autopay will be disabled.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: async () => {
            const loading = await this.loadingController.create({
              message: 'Removing payment method...',
              spinner: 'lines'
            });
            await loading.present();

            try {
              // If Stripe payment method exists, detach it from Stripe
              if (company.StripePaymentMethodID) {
                try {
                  await firstValueFrom(
                    this.caspioService.removeStripePaymentMethod(company.StripePaymentMethodID)
                  );
                } catch (stripeError) {
                  console.warn('Failed to detach Stripe payment method:', stripeError);
                  // Continue anyway to clear local record
                }
              }

              // Clear all payment method fields in Caspio
              await firstValueFrom(
                this.caspioService.put(
                  `/tables/LPS_Companies/records?q.where=CompanyID=${company.CompanyID}`,
                  {
                    AutopayMethod: null,
                    // PayPal fields
                    PayPalVaultToken: null,
                    PayPalPayerID: null,
                    PayPalPayerEmail: null,
                    // Stripe fields
                    StripeCustomerID: null,
                    StripePaymentMethodID: null,
                    StripeBankLast4: null,
                    StripeBankName: null,
                    AutopayEnabled: 0
                  }
                )
              );

              // Update local state
              if (this.editingCompany) {
                this.editingCompany.AutopayMethod = undefined;
                this.editingCompany.PayPalVaultToken = undefined;
                this.editingCompany.PayPalPayerID = undefined;
                this.editingCompany.PayPalPayerEmail = undefined;
                this.editingCompany.StripeCustomerID = undefined;
                this.editingCompany.StripePaymentMethodID = undefined;
                this.editingCompany.StripeBankLast4 = undefined;
                this.editingCompany.StripeBankName = undefined;
                this.editingCompany.AutopayEnabled = false;
              }

              // Update company in the list
              const index = this.companies.findIndex(c => c.CompanyID === company.CompanyID);
              if (index !== -1) {
                this.companies[index].AutopayMethod = undefined;
                this.companies[index].PayPalVaultToken = undefined;
                this.companies[index].PayPalPayerID = undefined;
                this.companies[index].PayPalPayerEmail = undefined;
                this.companies[index].StripeCustomerID = undefined;
                this.companies[index].StripePaymentMethodID = undefined;
                this.companies[index].StripeBankLast4 = undefined;
                this.companies[index].StripeBankName = undefined;
                this.companies[index].AutopayEnabled = false;
              }

              await this.showToast('Payment method removed', 'success');
            } catch (error: any) {
              console.error('Error removing payment method:', error);
              await this.showToast('Failed to remove payment method', 'danger');
            } finally {
              await loading.dismiss();
            }
          }
        }
      ]
    });
    await alert.present();
  }

  /**
   * Check for companies with autopay enabled and outstanding balances, load global toggle
   */
  private async checkAutopayDue(): Promise<void> {
    try {
      // Load global auto-charge toggle from CompanyID=1
      const adminCompany = this.companies.find(c => c.CompanyID === 1);
      if (adminCompany) {
        this.autopayAutoCharge = !adminCompany.AutopayReviewRequired;
      }

      // Find companies with autopay enabled, a saved payment method, and outstanding balance
      this.autopayDueCompanies = (this.companies as CompanyViewModel[]).filter(c => {
        if (c.CompanyID === 1 || !c.AutopayEnabled) return false;
        if (!c.PayPalVaultToken && !c.StripePaymentMethodID) return false;
        const data = this.getCompanyOutstandingData(c.CompanyID);
        return data.balance > 0;
      });

      // Show alert once if there are companies ready and auto-charge is off
      if (this.autopayDueCompanies.length > 0 && !this.autopayAutoCharge) {
        const companyNames = this.autopayDueCompanies
          .map(c => c.CompanyName)
          .join(', ');

        const alert = await this.alertController.create({
          header: 'Autopay Ready',
          message: `${this.autopayDueCompanies.length} company(s) have outstanding balances with autopay enabled: ${companyNames}. Go to each company profile to review and manually run their payment.`,
          buttons: ['OK'],
          cssClass: 'custom-document-alert'
        });
        await alert.present();
      }
    } catch (error) {
      console.error('Error checking autopay due:', error);
    }
  }

  /**
   * Toggle the global autopay auto-charge (ON = auto-charges, OFF = manual only)
   * Writes to AutopayReviewRequired on CompanyID=1 (inverted: auto-charge ON = ReviewRequired OFF)
   */
  async toggleAutopaySystem(event: any): Promise<void> {
    const autoCharge = event.detail.checked;

    const loading = await this.loadingController.create({
      message: autoCharge ? 'Enabling auto-charge...' : 'Disabling auto-charge...',
      spinner: 'lines'
    });
    await loading.present();

    try {
      await firstValueFrom(
        this.caspioService.put(
          `/tables/LPS_Companies/records?q.where=CompanyID=1`,
          { AutopayReviewRequired: autoCharge ? 0 : 1 }
        )
      );

      this.autopayAutoCharge = autoCharge;

      // Update local company record
      const adminCompany = this.companies.find(c => c.CompanyID === 1);
      if (adminCompany) {
        adminCompany.AutopayReviewRequired = !autoCharge;
      }

      await this.showToast(
        autoCharge
          ? 'Auto-charge enabled — scheduled payments will now process automatically'
          : 'Auto-charge disabled — you must manually trigger payments',
        'success'
      );
    } catch (error: any) {
      console.error('Error toggling autopay system:', error);
      await this.showToast('Failed to update autopay setting', 'danger');
      event.target.checked = !autoCharge;
    } finally {
      await loading.dismiss();
    }
  }

  async triggerAutopay(company: CompanyViewModel): Promise<void> {
    const isReview = company.AutopayReviewRequired;
    const alert = await this.alertController.create({
      header: isReview ? 'Approve & Charge' : 'Trigger Autopay',
      message: isReview
        ? `Review complete for ${company.CompanyName}? This will approve and charge their saved payment method for all unpaid invoices.`
        : `Run autopay now for ${company.CompanyName}? This will charge their saved payment method for all unpaid invoices.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: isReview ? 'Approve & Charge' : 'Run Autopay',
          handler: () => this.executeAutopay(company.CompanyID)
        }
      ]
    });
    await alert.present();
  }

  async executeAutopay(companyId: number): Promise<void> {
    // Guard: don't charge if balance is zero or overpaid (negative)
    const data = this.getCompanyOutstandingData(companyId);
    if (data.balance <= 0) {
      await this.showToast(
        data.balance < 0
          ? 'This company is overpaid — no charge needed'
          : 'No outstanding balance — no charge needed',
        'warning'
      );
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Processing autopay...',
      spinner: 'lines'
    });
    await loading.present();

    try {
      const response = await firstValueFrom(
        this.caspioService.triggerAutopay(companyId)
      );

      if (response?.success) {
        await this.showToast(
          `Autopay successful. Processed ${response.invoicesProcessed || 0} invoice(s) for $${response.amount?.toFixed(2) || '0.00'}`,
          'success'
        );

        // Clear cached outstanding data and refresh
        this.companyOutstandingData.delete(companyId);
        this.loadCompanyOutstandingInvoices(companyId);

        // Refresh company and invoice data
        await this.loadCompanyData(false);
        this.applyCompanyFilters();
      } else {
        throw new Error(response?.message || 'Autopay failed');
      }
    } catch (error: any) {
      console.error('Autopay error:', error);
      const errorMessage = error?.error?.message || error?.message || 'Autopay failed';
      await this.showToast(`Autopay failed: ${errorMessage}`, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  getAutopayDayOptions(): number[] {
    return [1, 5, 10, 15, 20, 25, 28];
  }

  formatAutopayDay(day: number): string {
    const lastDigit = day % 10;
    const lastTwoDigits = day % 100;
    let suffix = 'th';
    if (lastDigit === 1 && lastTwoDigits !== 11) suffix = 'st';
    else if (lastDigit === 2 && lastTwoDigits !== 12) suffix = 'nd';
    else if (lastDigit === 3 && lastTwoDigits !== 13) suffix = 'rd';
    return `${day}${suffix} of each month`;
  }

  async toggleAutopay(event: any): Promise<void> {
    const enabled = event.detail.checked;
    const company = this.clientCompany;

    if (!company) {
      console.error('No company found for autopay toggle');
      return;
    }

    const loading = await this.loadingController.create({
      message: enabled ? 'Enabling autopay...' : 'Disabling autopay...',
      spinner: 'lines'
    });
    await loading.present();

    try {
      await firstValueFrom(
        this.caspioService.put(
          `/tables/LPS_Companies/records?q.where=CompanyID=${company.CompanyID}`,
          { AutopayEnabled: enabled ? 1 : 0 }
        )
      );

      // Update local state
      if (this.companies.length > 0) {
        this.companies[0].AutopayEnabled = enabled;
      }

      let message = enabled ? 'Autopay enabled' : 'Autopay disabled';
      if (enabled && !company.PayPalVaultToken) {
        message += '. Remember to save a payment method during your next invoice payment.';
      }

      await this.showToast(message, 'success');
    } catch (error: any) {
      console.error('Error toggling autopay:', error);
      await this.showToast('Failed to update autopay setting. Make sure AutopayEnabled field exists in database.', 'danger');
      // Reset toggle on error
      event.target.checked = !enabled;
    } finally {
      await loading.dismiss();
    }
  }

  async updateAutopayDay(day: number): Promise<void> {
    const company = this.clientCompany;
    if (!company) return;
    await this.updateCompanyAutopayDay(company, day);
  }

  async updateCompanyAutopayDay(company: CompanyRecord, day: number): Promise<void> {
    if (!company) return;

    try {
      await firstValueFrom(
        this.caspioService.put(
          `/tables/LPS_Companies/records?q.where=CompanyID=${company.CompanyID}`,
          { AutpayDay: day }
        )
      );

      // Update local state in companies array
      const companyIndex = this.companies.findIndex(c => c.CompanyID === company.CompanyID);
      if (companyIndex !== -1) {
        this.companies[companyIndex].AutopayDay = day;
      }

      // Update in stageGroups if present
      for (const group of this.stageGroups) {
        const stageCompanyIndex = group.companies.findIndex(c => c.CompanyID === company.CompanyID);
        if (stageCompanyIndex !== -1) {
          group.companies[stageCompanyIndex].AutopayDay = day;
        }
      }

      await this.showToast('Autopay day updated', 'success');
    } catch (error: any) {
      console.error('Error updating autopay day:', error);
      await this.showToast('Failed to update autopay day', 'danger');
    }
  }

  async openAddPaymentMethodModal(): Promise<void> {
    const company = this.clientCompany;
    if (!company) return;

    // Show choice between PayPal and Stripe ACH
    const alert = await this.alertController.create({
      header: 'Add Payment Method',
      buttons: [
        {
          text: 'Bank Account (ACH)',
          cssClass: 'alert-button-confirm',
          handler: () => {
            this.openStripeAchModal(company);
          }
        },
        {
          text: 'PayPal',
          cssClass: 'alert-button-confirm',
          handler: () => {
            this.openPayPalModal(company);
          }
        },
        {
          text: 'Cancel',
          role: 'cancel',
          cssClass: 'alert-button-cancel'
        }
      ],
      cssClass: 'custom-document-alert payment-method-alert'
    });
    await alert.present();
  }

  async openPayPalModal(company: CompanyRecord): Promise<void> {
    // Import the PayPal modal dynamically
    const { PaypalPaymentModalComponent } = await import('../../modals/paypal-payment-modal/paypal-payment-modal.component');

    const modal = await this.modalController.create({
      component: PaypalPaymentModalComponent,
      componentProps: {
        invoice: {
          InvoiceID: 'SETUP',
          ProjectID: null,
          Amount: '0.00',
          Description: 'Payment Method Setup',
          Address: '',
          City: ''
        },
        companyId: company.CompanyID,
        companyName: company.CompanyName,
        showAutopayOption: true,
        saveForAutopayOnly: true
      }
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();

    if (data?.success && (data?.savedPaymentMethod || data?.paymentData?.savedForAutopay)) {
      // Update local company data with the new payment method info
      const paymentData = data.paymentData;
      if (paymentData) {
        // Update the company in the companies array (for CRM view)
        const companyIndex = this.companies.findIndex(c => c.CompanyID === company.CompanyID);
        if (companyIndex !== -1) {
          this.companies[companyIndex].PayPalVaultToken = paymentData.vaultToken;
          this.companies[companyIndex].PayPalPayerEmail = paymentData.payerEmail;
          this.companies[companyIndex].AutopayMethod = 'PayPal';
          this.companies[companyIndex].AutopayEnabled = true;
        }
        // Also update in stageGroups if present
        for (const group of this.stageGroups) {
          const stageCompanyIndex = group.companies.findIndex(c => c.CompanyID === company.CompanyID);
          if (stageCompanyIndex !== -1) {
            group.companies[stageCompanyIndex].PayPalVaultToken = paymentData.vaultToken;
            group.companies[stageCompanyIndex].PayPalPayerEmail = paymentData.payerEmail;
            group.companies[stageCompanyIndex].AutopayMethod = 'PayPal';
            group.companies[stageCompanyIndex].AutopayEnabled = true;
          }
        }
      }
      // Also reload to ensure server data is synced
      await this.loadCurrentUserCompanyName();
      await this.showToast('PayPal account saved and autopay enabled!', 'success');
    }
  }

  async openStripeAchModal(company: CompanyRecord): Promise<void> {
    // Import the Stripe ACH modal dynamically
    const { StripeAchModalComponent } = await import('../../modals/stripe-ach-modal/stripe-ach-modal.component');

    const modal = await this.modalController.create({
      component: StripeAchModalComponent,
      componentProps: {
        companyId: company.CompanyID,
        companyName: company.CompanyName,
        companyEmail: company.Email || ''
      }
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();

    if (data?.success && data?.paymentData) {
      // Update local company data with the new Stripe payment method info
      const paymentData = data.paymentData;
      const companyIndex = this.companies.findIndex(c => c.CompanyID === company.CompanyID);
      if (companyIndex !== -1) {
        this.companies[companyIndex].StripeCustomerID = paymentData.customerId;
        this.companies[companyIndex].StripePaymentMethodID = paymentData.paymentMethodId;
        this.companies[companyIndex].StripeBankName = paymentData.bankName;
        this.companies[companyIndex].StripeBankLast4 = paymentData.last4;
        this.companies[companyIndex].AutopayMethod = 'Stripe';
        this.companies[companyIndex].AutopayEnabled = true;
      }
      // Also update in stageGroups if present
      for (const group of this.stageGroups) {
        const stageCompanyIndex = group.companies.findIndex(c => c.CompanyID === company.CompanyID);
        if (stageCompanyIndex !== -1) {
          group.companies[stageCompanyIndex].StripeCustomerID = paymentData.customerId;
          group.companies[stageCompanyIndex].StripePaymentMethodID = paymentData.paymentMethodId;
          group.companies[stageCompanyIndex].StripeBankName = paymentData.bankName;
          group.companies[stageCompanyIndex].StripeBankLast4 = paymentData.last4;
          group.companies[stageCompanyIndex].AutopayMethod = 'Stripe';
          group.companies[stageCompanyIndex].AutopayEnabled = true;
        }
      }
      // Update editingCompany if it matches (for edit modal)
      if (this.editingCompany && this.editingCompany.CompanyID === company.CompanyID) {
        this.editingCompany.StripeCustomerID = paymentData.customerId;
        this.editingCompany.StripePaymentMethodID = paymentData.paymentMethodId;
        this.editingCompany.StripeBankName = paymentData.bankName;
        this.editingCompany.StripeBankLast4 = paymentData.last4;
        this.editingCompany.AutopayMethod = 'Stripe';
        this.editingCompany.AutopayEnabled = true;
      }
      // Reload to ensure server data is synced
      if (this.currentUserCompanyId) {
        await this.loadCurrentUserCompanyName();
      }
      await this.showToast('Bank account linked and autopay enabled!', 'success');
    }
  }

  private formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  setStageFilter(stageId: number) {
    const newValue = String(stageId);
    this.companyFilters.stage = this.companyFilters.stage === newValue ? 'all' : newValue;
    this.applyCompanyFilters();
  }

  clearCompanyFilters() {
    this.companyFilters = {
      search: '',
      stage: 'all',
      size: 'all',
      leadSource: 'all',
      onlyFranchise: false,
      hasNotes: false
    };
    this.applyCompanyFilters();
  }

  selectClientTab(tab: 'company' | 'payments' | 'metrics') {
    this.clientTab = tab;
    if (tab === 'metrics') {
      if (!this.clientMetrics) {
        this.loadClientMetrics();
      } else {
        // Data already loaded but canvas elements are fresh from *ngIf — re-render charts
        setTimeout(() => {
          this.renderClientProjectsChart();
          this.renderClientServicesChart();
        }, 100);
      }
    }
    if (tab === 'payments' && this.currentUserCompanyId) {
      // Force reload payment data each time tab is selected
      this.companyOutstandingData.delete(this.currentUserCompanyId);
      this.loadCompanyOutstandingInvoices(this.currentUserCompanyId);
    }
  }

  async openBalancePaymentModal(event: Event) {
    event.stopPropagation(); // Prevent collapsing the section
    const companyId = this.currentUserCompanyId;
    if (!companyId) return;

    const data = this.getCompanyOutstandingData(companyId);
    const unpaidProjects = data.invoices.filter(inv => inv.balance > 0);

    if (unpaidProjects.length === 0) {
      await this.showToast('No outstanding balances', 'warning');
      return;
    }

    // Show project selection alert
    const inputs = unpaidProjects.map(proj => ({
      type: 'radio' as const,
      label: `${proj.projectAddress} — $${proj.balance.toFixed(2)}`,
      value: String(proj.projectId)
    }));

    const alert = await this.alertController.create({
      header: 'Select Project to Pay',
      inputs,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Continue',
          handler: async (selectedProjectId: string) => {
            if (!selectedProjectId) return false;
            const project = unpaidProjects.find(p => String(p.projectId) === selectedProjectId);
            if (!project) return false;

            // Build services breakdown
            const servicesBreakdown = project.services.map((s: { name: string; fee: number }) => ({
              name: s.name,
              price: s.fee
            }));

            const { PaypalPaymentModalComponent } = await import('../../modals/paypal-payment-modal/paypal-payment-modal.component');
            const modal = await this.modalController.create({
              component: PaypalPaymentModalComponent,
              componentProps: {
                invoice: {
                  ProjectID: project.projectId,
                  InvoiceID: project.projectId,
                  Amount: project.balance.toFixed(2),
                  Description: `Payment for ${project.projectAddress}`,
                  Address: project.projectAddress,
                  City: '',
                  Services: servicesBreakdown
                }
              }
            });

            await modal.present();

            const { data: modalData } = await modal.onDidDismiss();

            if (modalData?.success && modalData.paymentData) {
              const pd = modalData.paymentData;
              const grossAmount = parseFloat(pd.amount);
              const originalAmount = parseFloat(pd.originalAmount || pd.amount);
              const paypalFee = Math.round((grossAmount - originalAmount) * 100) / 100;

              // Record PayPal processing fee as a positive line item
              if (paypalFee > 0) {
                try {
                  await firstValueFrom(
                    this.caspioService.post<any>('/tables/LPS_Invoices/records', {
                      ProjectID: Number(project.projectId),
                      Fee: Number(paypalFee.toFixed(2)),
                      Date: new Date().toISOString().split('T')[0],
                      Address: String(project.projectAddress || ''),
                      InvoiceNotes: 'PayPal Processing Fee',
                      PaymentProcessor: 'PayPal'
                    })
                  );
                } catch (e) { console.error('Failed to record PayPal fee:', e); }
              }

              // Record the full gross payment as a negative record
              try {
                const paymentNotes = `PayPal Payment - Order: ${pd.orderID}\nPayer: ${pd.payerName} (${pd.payerEmail})\nStatus: ${pd.status}`;
                await firstValueFrom(
                  this.caspioService.post<any>('/tables/LPS_Invoices/records', {
                    ProjectID: Number(project.projectId),
                    Fee: Number((-grossAmount).toFixed(2)),
                    Date: new Date().toISOString().split('T')[0],
                    Address: String(project.projectAddress || ''),
                    InvoiceNotes: String(paymentNotes),
                    PaymentProcessor: 'PayPal'
                  })
                );
              } catch (e) { console.error('Failed to record payment:', e); }

              // Send push notification for payment received (fire-and-forget)
              try {
                fetch(`${environment.apiGatewayUrl}/api/notifications/send`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    companyId: String(companyId),
                    title: 'Payment Received',
                    body: `$${pd.amount} payment received for ${project.projectAddress || 'Project'}`,
                    data: { type: 'payment_received', route: `/project/${project.projectId}` }
                  })
                });
              } catch { /* push notification is non-critical */ }

              this.caspioService.clearInvoicesCache();
              // Refresh outstanding data after successful payment
              this.companyOutstandingData.delete(companyId);
              this.loadCompanyOutstandingInvoices(companyId);
            }
            return true;
          }
        }
      ],
      cssClass: 'custom-document-alert'
    });

    await alert.present();
  }

  async loadClientMetrics() {
    try {
      const companyId = this.currentUserCompanyId;
      if (!companyId) return;

      // Load projects and services in parallel
      const [projectsResponse, servicesResponse] = await Promise.all([
        this.caspioService.get<any>(`/tables/LPS_Projects/records?q.where=CompanyID=${companyId}`).toPromise(),
        this.caspioService.get<any>(`/tables/LPS_Services/records`).toPromise()
      ]);

      const projects = projectsResponse?.Result || [];
      const allServices = servicesResponse?.Result || [];

      // Calculate basic metrics
      this.clientMetrics = {
        totalProjects: projects.length,
        activeProjects: projects.filter((p: any) => p.StatusID === 7 || p.StatusID === '7').length,
        completedProjects: projects.filter((p: any) => p.StatusID === 2 || p.StatusID === '2').length
      };

      // Build projects over time data (spanning entire project history)
      const projectDates: Date[] = [];
      projects.forEach((p: any) => {
        const date = new Date(p.DateOfRequest || p.DateCreated || p.Date);
        if (!isNaN(date.getTime())) {
          projectDates.push(date);
        }
      });

      // Determine date range from earliest to latest project (or current date)
      const monthlyProjects: { [key: string]: number } = {};
      if (projectDates.length > 0) {
        const sortedDates = projectDates.sort((a, b) => a.getTime() - b.getTime());
        const minDate = new Date(sortedDates[0].getFullYear(), sortedDates[0].getMonth(), 1);
        const maxDate = new Date();

        // Generate all months between min and max
        const currentMonth = new Date(minDate);
        while (currentMonth <= maxDate) {
          const key = currentMonth.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
          monthlyProjects[key] = 0;
          currentMonth.setMonth(currentMonth.getMonth() + 1);
        }

        // Count projects per month
        projectDates.forEach((date) => {
          const key = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
          if (monthlyProjects.hasOwnProperty(key)) {
            monthlyProjects[key]++;
          }
        });
      }

      this.clientProjectsChartData = {
        labels: Object.keys(monthlyProjects),
        values: Object.values(monthlyProjects)
      };

      // Build services breakdown data
      const projectIds = projects.map((p: any) => p.ProjectID).filter((id: any) => id);
      const companyServices = allServices.filter((s: any) => projectIds.includes(s.ProjectID));

      // Get service types to map TypeID to names
      const serviceTypesResponse = await this.caspioService.get<any>('/tables/LPS_Type/records').toPromise();
      const serviceTypes = serviceTypesResponse?.Result || [];
      const typeMap: { [key: string]: string } = {};
      serviceTypes.forEach((t: any) => {
        typeMap[t.TypeID] = t.TypeShort || t.TypeName || 'Unknown';
      });

      // Count services by type
      const serviceCounts: { [key: string]: number } = {};
      companyServices.forEach((s: any) => {
        const typeName = typeMap[s.TypeID] || 'Other';
        serviceCounts[typeName] = (serviceCounts[typeName] || 0) + 1;
      });

      // Sort by count and take top 6
      const sortedServices = Object.entries(serviceCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);

      const chartColors = ['#f15a27', '#ff7b4d', '#ffa726', '#ffcc80', '#4caf50', '#81c784'];

      this.clientServicesChartData = {
        labels: sortedServices.map(([name]) => name),
        values: sortedServices.map(([, count]) => count),
        colors: chartColors.slice(0, sortedServices.length)
      };

      // Render charts after data is loaded
      setTimeout(() => {
        this.renderClientProjectsChart();
        this.renderClientServicesChart();
      }, 100);

    } catch (error) {
      console.error('Error loading client metrics:', error);
      this.clientMetrics = { totalProjects: 0, activeProjects: 0, completedProjects: 0 };
    }
  }

  renderClientProjectsChart() {
    const canvas = document.getElementById('clientProjectsChart') as HTMLCanvasElement;
    if (!canvas) return;

    if (this.clientProjectsChart) {
      this.clientProjectsChart.destroy();
      this.clientProjectsChart = null;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const config: ChartConfiguration = {
      type: 'line',
      data: {
        labels: this.clientProjectsChartData.labels,
        datasets: [{
          label: 'Projects',
          data: this.clientProjectsChartData.values,
          borderColor: '#f15a27',
          backgroundColor: 'rgba(241, 90, 39, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: '#f15a27',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1 },
            grid: { color: 'rgba(0,0,0,0.05)' }
          },
          x: {
            grid: { display: false },
            ticks: {
              maxRotation: 45,
              minRotation: 45
            }
          }
        }
      }
    };

    this.clientProjectsChart = new Chart(ctx, config);
  }

  renderClientServicesChart() {
    const canvas = document.getElementById('clientServicesChart') as HTMLCanvasElement;
    if (!canvas) return;

    if (this.clientServicesChart) {
      this.clientServicesChart.destroy();
      this.clientServicesChart = null;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // If no services data, show empty state
    if (this.clientServicesChartData.values.length === 0) {
      return;
    }

    this.clientServicesChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: this.clientServicesChartData.labels,
        datasets: [{
          data: this.clientServicesChartData.values,
          backgroundColor: this.clientServicesChartData.colors,
          borderWidth: 0,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          }
        }
      }
    } as any);
  }

  selectTab(tab: string) {
    // Instant tab switching - no data processing
    this.selectedTab = tab as any;

    // Only load data if it hasn't been loaded yet for this tab
    if (!this.tabDataLoaded[tab]) {
      this.loadTabData(tab);
      this.tabDataLoaded[tab] = true;
    }
  }

  selectAdminMainTab(tab: 'company' | 'partners' | 'metrics') {
    this.adminMainTab = tab;
    // Auto-select first sub-tab when switching main tabs
    if (tab === 'company') {
      // Load company details if not yet loaded
      if (!this.tabDataLoaded['company']) {
        this.loadTabData('company');
        this.tabDataLoaded['company'] = true;
      }
      // Keep users tab selected for Partners sub-tab compatibility
      this.selectTab('users');
    } else if (tab === 'metrics') {
      this.selectTab('metrics');
    } else {
      this.selectTab('companies');
    }
  }

  private tabDataLoaded: {[key: string]: boolean} = {
    company: false,
    companies: true, // Already loaded on init
    contacts: false,
    tasks: false,
    meetings: false,
    communications: false,
    invoices: false,
    metrics: false,
    users: true // Loaded on init
  };

  private loadTabData(tab: string) {
    // Load data asynchronously without blocking UI
    requestAnimationFrame(() => {
      switch (tab) {
        case 'company':
          this.loadCurrentCompany();
          break;
        case 'contacts':
          this.applyContactFilters();
          break;
        case 'tasks':
          this.applyTaskFilters();
          break;
        case 'meetings':
          this.applyMeetingFilters();
          break;
        case 'communications':
          this.applyCommunicationFilters();
          break;
        case 'invoices':
          this.categorizeInvoices();
          break;
        case 'metrics':
          this.aggregateRevenueByMonth();
          this.aggregateProjectsByType();
          setTimeout(() => {
            this.renderRevenueChart();
            this.renderProjectsByTypeChart();
          }, 100);
          break;
        case 'users':
          this.applyUserFilters();
          break;
      }
    });
  }

  loadCurrentCompany() {
    // Find the current user's company from the loaded data
    if (this.currentUserCompanyId !== null) {
      // Try to find in companies array first
      let company = this.companies.find(c => c.CompanyID === this.currentUserCompanyId);
      
      // If not found in filtered companies (it's the excluded company), load it separately
      if (!company && this.currentUserCompanyId === this.excludedCompanyId) {
        this.fetchCurrentCompanyData();
      } else {
        this.currentCompany = company || null;
      }
    }
  }

  async fetchCurrentCompanyData() {
    try {
      const companyRecords = await this.fetchTableRecords('Companies', { 
        'q.where': `CompanyID=${this.currentUserCompanyId}`,
        'q.limit': '1'
      });
      
      if (companyRecords && companyRecords.length > 0) {
        this.currentCompany = this.normalizeCompanyRecord(companyRecords[0]);
      }
    } catch (error) {
      console.error('Error loading current company:', error);
    }
  }

  async onTabChange(event: any) {
    // Keep for compatibility but use selectTab instead
    this.selectTab(event.detail?.value || this.selectedTab);
  }
  applyCompanyFilters() {
    const unassignedStage: StageDefinition = { id: 0, name: 'No Stage', sortOrder: 999 };
    const allStages = [...this.stages];
    if (!this.stageLookup.has(0)) {
      allStages.push(unassignedStage);
    }

    const stageMap = new Map<number, CompanyViewModel[]>();
    allStages.forEach(stage => {
      if (stage.id !== 0) {
        stageMap.set(stage.id, []);
      }
    });

    const filtered = this.companies
      .filter(company => {
        // Global company filter takes precedence
        if (this.globalCompanyFilterId !== null && company.CompanyID !== this.globalCompanyFilterId) {
          return false;
        }
        return this.matchesCompanyFilters(company);
      })
      .map(company => this.enrichCompany(company));

    filtered.forEach(company => {
      const stageId = company.StageID ?? 0;
      if (stageId === 0) {
        return;
      }
      if (!stageMap.has(stageId)) {
        stageMap.set(stageId, []);
      }
      stageMap.get(stageId)!.push(company);
    });

    const stagePriority = (stage: StageDefinition) => {
      if (stage.id === 5) {
        return -100;
      }
      return stage.sortOrder;
    };

    this.stageGroups = allStages
      .filter(stage => stage.id !== 0)
      .map(stage => ({
        stage,
        companies: (stageMap.get(stage.id) ?? []).sort((a, b) => a.CompanyName.localeCompare(b.CompanyName))
      }))
      .filter(group => group.companies.length > 0)
      .sort((a, b) => {
        // Sort by StageID from highest to lowest (Active should be first)
        return b.stage.id - a.stage.id;
      });

    this.stageSummary = this.stageGroups.map(group => ({
      stage: group.stage,
      count: group.companies.length,
      highlight: this.selectedCompanyId !== null && group.stage.id === (this.selectedCompany?.StageID ?? 0)
    }));
  }

  applyContactFilters() {
    const searchTerm = this.contactsSearchTerm.trim().toLowerCase();
    const selectedId = this.selectedCompanyId;
    const grouped = new Map<number | null, ContactRecord[]>();

    this.contacts.forEach(contact => {
      // Global company filter
      if (this.globalCompanyFilterId !== null && contact.CompanyID !== this.globalCompanyFilterId) {
        return;
      }

      if (searchTerm) {
        const haystack = [
          contact.Name,
          contact.Title,
          contact.Goal,
          contact.Email,
          contact.Phone1,
          contact.Phone2,
          this.getCompanyName(contact.CompanyID)
        ].join(' ').toLowerCase();

        if (!haystack.includes(searchTerm)) {
          return;
        }
      }
      const key = contact.CompanyID ?? null;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(contact);
    });

    const groups: ContactGroup[] = Array.from(grouped.entries()).map(([companyId, contacts]) => {
      contacts.sort((a, b) => a.Name.localeCompare(b.Name));
      return {
        companyId,
        companyName: this.getCompanyName(companyId),
        contacts
      };
    });

    groups.sort((a, b) => {
      if (selectedId !== null) {
        if (a.companyId === selectedId && b.companyId !== selectedId) {
          return -1;
        }
        if (b.companyId === selectedId && a.companyId !== selectedId) {
          return 1;
        }
      }
      return a.companyName.localeCompare(b.companyName);
    });

    this.contactGroups = groups;

    // Apply pagination
    this.currentContactPage = 1;
    this.paginateContacts();
  }

  paginateContacts() {
    // Calculate total items (all contacts across all groups)
    const totalContacts = this.contactGroups.reduce((sum, group) => sum + group.contacts.length, 0);
    this.totalContactPages = Math.ceil(totalContacts / this.contactsPerPage);

    // Flatten all contacts with their group info
    const allContactsWithGroup: {group: ContactGroup, contact: ContactRecord}[] = [];
    this.contactGroups.forEach(group => {
      group.contacts.forEach(contact => {
        allContactsWithGroup.push({group, contact});
      });
    });

    // Get current page slice
    const startIdx = (this.currentContactPage - 1) * this.contactsPerPage;
    const endIdx = startIdx + this.contactsPerPage;
    const pageContacts = allContactsWithGroup.slice(startIdx, endIdx);

    // Rebuild groups for current page
    const pageGroupMap = new Map<number | null, ContactRecord[]>();
    const companyNames = new Map<number | null, string>();

    pageContacts.forEach(item => {
      const companyId = item.group.companyId;
      if (!pageGroupMap.has(companyId)) {
        pageGroupMap.set(companyId, []);
        companyNames.set(companyId, item.group.companyName);
      }
      pageGroupMap.get(companyId)!.push(item.contact);
    });

    // Create paginated groups
    this.paginatedContactGroups = Array.from(pageGroupMap.entries()).map(([companyId, contacts]) => ({
      companyId,
      companyName: companyNames.get(companyId) || 'Unknown Company',
      contacts
    }));
  }

  applyUserFilters() {
    const searchTerm = this.usersSearchTerm.trim().toLowerCase();

    this.filteredUsers = this.allUsers.filter(user => {
      // Filter by company - use global filter if set, otherwise use current user's company
      const targetCompanyId = this.globalCompanyFilterId !== null ? this.globalCompanyFilterId : this.currentUserCompanyId;
      
      if (targetCompanyId !== null && user.CompanyID !== targetCompanyId) {
        return false;
      }

      if (searchTerm) {
        const haystack = [
          user.Name,
          user.Email,
          user.Phone,
          user.Title,
          this.getCompanyName(user.CompanyID)
        ].join(' ').toLowerCase();

        if (!haystack.includes(searchTerm)) {
          return false;
        }
      }

      return true;
    });

    // Sort by name
    this.filteredUsers.sort((a, b) => {
      const nameA = a.Name || '';
      const nameB = b.Name || '';
      return nameA.localeCompare(nameB);
    });
  }

  nextContactPage() {
    if (this.currentContactPage < this.totalContactPages) {
      this.currentContactPage++;
      this.paginateContacts();
    }
  }

  prevContactPage() {
    if (this.currentContactPage > 1) {
      this.currentContactPage--;
      this.paginateContacts();
    }
  }
  setTaskTimeframe(timeframe: string) {
    this.taskFilters.timeframe = timeframe;
    this.applyTaskFilters();
  }

  applyTaskFilters() {
    const searchTerm = this.taskFilters.search.trim().toLowerCase();
    const statusFilter = this.taskFilters.status;
    const assignedFilter = this.taskFilters.assignedTo;
    const timeframeFilter = this.taskFilters.timeframe;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    sevenDaysFromNow.setHours(23, 59, 59, 999);

    this.filteredTasks = this.tasks.filter(task => {
      // Global company filter
      if (this.globalCompanyFilterId !== null && task.CompanyID !== this.globalCompanyFilterId) {
        return false;
      }

      // Timeframe filtering
      if (timeframeFilter === 'overdue') {
        // Show only overdue tasks (past due date and not completed)
        if (!task.dueDate) {
          return false;
        }
        const taskDate = new Date(task.dueDate);
        taskDate.setHours(0, 0, 0, 0);
        if (taskDate >= now || task.completed) {
          return false;
        }
      } else if (timeframeFilter === 'past') {
        if (!task.dueDate) {
          return false;
        }
        const taskDate = new Date(task.dueDate);
        taskDate.setHours(23, 59, 59, 999);
        if (taskDate > now) {
          return false;
        }
      } else if (timeframeFilter === '7day') {
        if (!task.dueDate) {
          return false;
        }
        const taskDate = new Date(task.dueDate);
        taskDate.setHours(0, 0, 0, 0);
        if (taskDate < now || taskDate > sevenDaysFromNow) {
          return false;
        }
      }
      // timeframeFilter === 'all' shows everything

      if (statusFilter === 'completed' && !task.completed) {
        return false;
      }

      if (statusFilter === 'open' && task.completed) {
        return false;
      }

      if (assignedFilter !== 'all' && task.assignTo !== assignedFilter) {
        return false;
      }

      if (!searchTerm) {
        return true;
      }

      const haystack = [
        task.assignment,
        task.assignTo,
        task.notes,
        task.communicationType,
        this.getCompanyName(task.CompanyID)
      ].join(' ').toLowerCase();

      return haystack.includes(searchTerm);
    });

    const total = this.tasks.length;
    const completed = this.tasks.filter(task => task.completed).length;
    const outstanding = this.tasks.filter(task => !task.completed).length;
    const overdue = this.tasks.filter(task => task.isOverdue).length;

    this.taskMetrics = { total, completed, outstanding, overdue };

    // Apply pagination
    this.currentTaskPage = 1;
    this.paginateTasks();
  }

  paginateTasks() {
    this.totalTaskPages = Math.ceil(this.filteredTasks.length / this.tasksPerPage);
    const startIndex = (this.currentTaskPage - 1) * this.tasksPerPage;
    const endIndex = startIndex + this.tasksPerPage;
    this.paginatedTasks = this.filteredTasks.slice(startIndex, endIndex);
  }

  nextTaskPage() {
    if (this.currentTaskPage < this.totalTaskPages) {
      this.currentTaskPage++;
      this.paginateTasks();
    }
  }

  prevTaskPage() {
    if (this.currentTaskPage > 1) {
      this.currentTaskPage--;
      this.paginateTasks();
    }
  }

  async toggleTaskCompletion(task: TaskViewModel, completed: boolean) {
    if (task.completed === completed || this.taskUpdatingIds.has(task.TaskID)) {
      return;
    }

    this.taskUpdatingIds.add(task.TaskID);
    const previousCompleted = task.completed;

    task.completed = completed;
    task.isOverdue = !completed && task.dueDate ? this.isDateInPast(task.dueDate) : false;

    try {
      // Build payload with required fields
      const payload: any = {
        CompanyID: task.CompanyID,
        Due: task.dueDate ? new Date(task.dueDate).toISOString() : new Date().toISOString(),
        Complete: completed ? 1 : 0
      };

      // Add optional fields if they exist
      if (task.assignment) {
        payload.Assignment = task.assignment;
      }

      if (task.assignTo) {
        payload.AssignTo = task.assignTo;
      }

      if (task.communicationId) {
        payload.CommunicationID = task.communicationId;
      }

      if (task.notes) {
        payload.CompleteNotes = task.notes;
      }

      await firstValueFrom(
        this.caspioService.put(
          '/tables/LPS_Tasks/records?q.where=TaskID=' + task.TaskID,
          payload
        )
      );
    } catch (error) {
      task.completed = previousCompleted;
      task.isOverdue = !task.completed && task.dueDate ? this.isDateInPast(task.dueDate) : false;
      console.error('Error updating task status:', error);
      await this.showToast('Unable to update task status', 'danger');
    } finally {
      this.taskUpdatingIds.delete(task.TaskID);
      this.applyTaskFilters();
    }
  }

  isTaskUpdating(task: TaskViewModel): boolean {
    return this.taskUpdatingIds.has(task.TaskID);
  }
  applyMeetingFilters() {
    const searchTerm = this.meetingFilters.search.trim().toLowerCase();
    const timeframe = this.meetingFilters.timeframe;
    const now = new Date();

    this.filteredMeetings = this.meetings.filter(meeting => {
      // Global company filter
      if (this.globalCompanyFilterId !== null && meeting.CompanyID !== this.globalCompanyFilterId) {
        return false;
      }

      const startDate = meeting.startDate;
      if (timeframe === "upcoming") {
        if (!startDate || startDate < now) {
          return false;
        }
      } else if (timeframe === "past") {
        if (!startDate || startDate >= now) {
          return false;
        }
      }

      if (!searchTerm) {
        return true;
      }

      const haystack = [
        meeting.subject,
        meeting.description,
        meeting.attendees.join(' '),
        this.getCompanyName(meeting.CompanyID)
      ].join(' ').toLowerCase();

      return haystack.includes(searchTerm);
    });

    // Apply pagination
    this.currentMeetingPage = 1;
    this.paginateMeetings();
  }

  setMeetingTimeframe(timeframe: string) {
    this.meetingFilters.timeframe = timeframe;
    this.applyMeetingFilters();
  }

  paginateMeetings() {
    this.totalMeetingPages = Math.ceil(this.filteredMeetings.length / this.meetingsPerPage);
    const startIndex = (this.currentMeetingPage - 1) * this.meetingsPerPage;
    const endIndex = startIndex + this.meetingsPerPage;
    this.paginatedMeetings = this.filteredMeetings.slice(startIndex, endIndex);
  }

  nextMeetingPage() {
    if (this.currentMeetingPage < this.totalMeetingPages) {
      this.currentMeetingPage++;
      this.paginateMeetings();
    }
  }

  prevMeetingPage() {
    if (this.currentMeetingPage > 1) {
      this.currentMeetingPage--;
      this.paginateMeetings();
    }
  }

  applyCommunicationFilters() {
    const searchTerm = this.communicationSearchTerm.trim().toLowerCase();

    this.filteredCommunications = this.communications.filter(comm => {
      // Global company filter
      if (this.globalCompanyFilterId !== null && comm.CompanyID !== this.globalCompanyFilterId) {
        return false;
      }

      if (!searchTerm) {
        return true;
      }

      const haystack = [
        comm.notes,
        comm.outcome,
        this.getCompanyName(comm.CompanyID)
      ].join(' ').toLowerCase();

      return haystack.includes(searchTerm);
    });

    this.filteredCommunications.sort((a, b) => {
      const aTime = a.date ? new Date(a.date).getTime() : 0;
      const bTime = b.date ? new Date(b.date).getTime() : 0;
      return bTime - aTime;
    });

    // Apply pagination
    this.currentCommunicationPage = 1;
    this.paginateCommunications();
  }

  paginateCommunications() {
    this.totalCommunicationPages = Math.ceil(this.filteredCommunications.length / this.communicationsPerPage);
    const startIndex = (this.currentCommunicationPage - 1) * this.communicationsPerPage;
    const endIndex = startIndex + this.communicationsPerPage;
    this.paginatedCommunications = this.filteredCommunications.slice(startIndex, endIndex);
  }

  nextCommunicationPage() {
    if (this.currentCommunicationPage < this.totalCommunicationPages) {
      this.currentCommunicationPage++;
      this.paginateCommunications();
    }
  }

  prevCommunicationPage() {
    if (this.currentCommunicationPage > 1) {
      this.currentCommunicationPage--;
      this.paginateCommunications();
    }
  }
  categorizeInvoices() {
    const searchTerm = this.invoiceSearchTerm.trim().toLowerCase();

    const filtered = this.invoices.filter(invoice => {
      // Global company filter
      if (this.globalCompanyFilterId !== null && invoice.CompanyID !== this.globalCompanyFilterId) {
        return false;
      }

      if (!searchTerm) {
        return true;
      }

      const haystack = [
        String(invoice.InvoiceID),
        invoice.CompanyName,
        invoice.InvoiceNotes,
        invoice.Address,
        invoice.City,
        invoice.Status,
        invoice.PaymentProcessor ?? ''
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(searchTerm);
    });

    const groupedByProject = new Map<number | null, { positives: InvoiceViewModel[]; negatives: InvoiceViewModel[] }>();

    filtered.forEach(invoice => {
      const projectId = invoice.ProjectID ?? null;
      if (!groupedByProject.has(projectId)) {
        groupedByProject.set(projectId, { positives: [], negatives: [] });
      }
      const bucket = groupedByProject.get(projectId)!;
      if ((invoice.Fee ?? 0) < 0) {
        bucket.negatives.push(invoice);
      } else {
        bucket.positives.push(invoice);
      }
    });

    const open: InvoicePair[] = [];
    const unpaid: InvoicePair[] = [];
    const paidPairs: InvoicePair[] = [];
    const today = new Date();

    groupedByProject.forEach((bucket, projectId) => {
      const metadata = projectId !== null ? this.projectDetailsLookup.get(projectId) ?? null : null;

      bucket.positives.sort((a, b) => this.compareDatesAsc(a.DateValue, b.DateValue));
      bucket.negatives.sort((a, b) => this.compareDatesAsc(a.DateValue, b.DateValue));

      // Calculate total sum for this ProjectID
      const totalPositiveAmount = bucket.positives.reduce((sum, inv) => sum + (inv.Fee ?? 0), 0);
      const totalNegativeAmount = bucket.negatives.reduce((sum, inv) => sum + (inv.Fee ?? 0), 0);
      const projectNetAmount = totalPositiveAmount + totalNegativeAmount; // negatives are already negative values

      // Use the first positive invoice as representative for the project
      if (bucket.positives.length > 0) {
        const representative = bucket.positives[0];
        const projectDate = metadata?.projectDate ?? representative.ProjectDate ?? representative.DateValue ?? null;

        // Check if there are any payments for this project
        const hasPayments = bucket.negatives.length > 0;

        const pair: InvoicePair = {
          positive: representative,
          negative: hasPayments ? bucket.negatives[0] : null,
          projectDate,
          netAmount: projectNetAmount, // Sum of all invoices for this ProjectID
          allPositives: [...bucket.positives],
          allNegatives: [...bucket.negatives]
        };

        // Get StatusID from project metadata
        const statusId = metadata?.statusId ?? null;

        // Categorize based on StatusID and amount due:
        // Open: StatusID != 2 AND amount due != 0
        // Past: StatusID == 2 AND amount due == 0
        // Unpaid: StatusID == 2 AND amount due != 0

        if (statusId === 2) {
          // StatusID is 2
          if (projectNetAmount === 0) {
            // StatusID == 2 AND amount due == 0 -> Past
            paidPairs.push(pair);
          } else if (projectNetAmount > 0) {
            // StatusID == 2 AND amount due > 0 -> Unpaid
            unpaid.push(pair);
          }
        } else if (statusId !== 2 && projectNetAmount > 0) {
          // StatusID != 2 AND amount due > 0 -> Open
          open.push(pair);
        }
        // If amount due <= 0 and StatusID != 2, don't include in any category
      }
    });

    const byCompany = new Map<number | null, InvoicePair[]>();
    paidPairs.forEach(pair => {
      const companyId = pair.positive.CompanyID ?? pair.negative?.CompanyID ?? null;
      if (!byCompany.has(companyId)) {
        byCompany.set(companyId, []);
      }
      byCompany.get(companyId)!.push(pair);
    });

    const paidGroups: PaidInvoiceGroup[] = Array.from(byCompany.entries()).map(([companyId, items]) => {
      items.sort((a, b) => this.compareDatesDesc(a.projectDate ?? a.positive.DateValue, b.projectDate ?? b.positive.DateValue));
      return {
        companyId,
        companyName: this.getCompanyName(companyId),
        items
      };
    });

    paidGroups.sort((a, b) => a.companyName.localeCompare(b.companyName));
    open.sort((a, b) => this.compareDatesAsc(a.projectDate ?? a.positive.DateValue, b.projectDate ?? b.positive.DateValue));
    unpaid.sort((a, b) => this.compareDatesAsc(a.projectDate ?? a.positive.DateValue, b.projectDate ?? b.positive.DateValue));

    this.openInvoices = open;
    this.unpaidInvoices = unpaid;
    this.paidInvoiceGroups = paidGroups;
    this.visibleInvoiceCount = open.length + unpaid.length + paidPairs.length;
    this.updateInvoiceMetrics();

    // Apply pagination for invoices
    this.currentInvoicePage = 1;
    this.paginateInvoices();
  }

  private getServiceNameForInvoice(invoice: InvoiceViewModel): string {
    // First, try to get service name from invoice's ServiceID
    if (invoice.ServiceID !== null) {
      const typeId = this.servicesLookup.get(invoice.ServiceID);
      if (typeId !== null && typeId !== undefined) {
        const typeName = this.typeIdToNameLookup.get(typeId);
        if (typeName) {
          return typeName;
        }
      }
    }

    // Second, try to get service name from project's services
    if (invoice.ProjectID !== null) {
      const serviceIds = this.servicesByProjectLookup.get(invoice.ProjectID);
      if (serviceIds && serviceIds.length > 0) {
        // Use the first service's TypeID to get the name
        const typeId = this.servicesLookup.get(serviceIds[0]);
        if (typeId !== null && typeId !== undefined) {
          const typeName = this.typeIdToNameLookup.get(typeId);
          if (typeName) {
            return typeName;
          }
        }
      }

      // Third, try to get service name from project's OffersID
      const projectMetadata = this.projectDetailsLookup.get(invoice.ProjectID);
      if (projectMetadata?.offersId !== null && projectMetadata?.offersId !== undefined) {
        const typeId = this.offersLookup.get(projectMetadata.offersId);
        if (typeId !== null && typeId !== undefined) {
          const typeName = this.typeIdToNameLookup.get(typeId);
          if (typeName) {
            return typeName;
          }
        }
      }
    }

    return 'Service Not Specified';
  }

  getInvoiceLineLabel(record: InvoiceViewModel): string {
    // If AddedInvoice field is filled, use that as the label
    if (record.AddedInvoice && record.AddedInvoice.trim()) {
      return record.AddedInvoice.trim();
    }
    // ServiceID in LPS_Invoices stores TypeID directly, so look up TypeID first
    if (record.ServiceID !== null) {
      const directName = this.typeIdToNameLookup.get(record.ServiceID);
      if (directName) {
        return directName;
      }
    }
    // Fallback to standard resolution
    return this.getServiceNameForInvoice(record);
  }

  getInvoiceStatus(invoice: InvoicePairWithService): string {
    const statusId = invoice.positive.ProjectID !== null
      ? this.projectDetailsLookup.get(invoice.positive.ProjectID)?.statusId ?? null
      : null;
    const amountDue = invoice.netAmount;

    if (statusId === 2) {
      if (amountDue === 0) {
        return 'Paid/Complete';
      } else if (amountDue > 0) {
        return 'Unpaid';
      }
    } else if (statusId !== 2 && amountDue > 0) {
      return 'Open';
    }

    return 'Unknown';
  }

  paginateInvoices() {
    // Paginate open invoices
    const openStartIndex = (this.currentInvoicePage - 1) * this.invoicesPerPage;
    const openEndIndex = openStartIndex + this.invoicesPerPage;
    this.paginatedOpenInvoices = this.openInvoices.slice(openStartIndex, openEndIndex);

    // Paginate unpaid invoices
    const unpaidStartIndex = (this.currentInvoicePage - 1) * this.invoicesPerPage;
    const unpaidEndIndex = unpaidStartIndex + this.invoicesPerPage;
    this.paginatedUnpaidInvoices = this.unpaidInvoices.slice(unpaidStartIndex, unpaidEndIndex);

    // Paginate paid invoice groups
    const paidStartIndex = (this.currentInvoicePage - 1) * this.invoicesPerPage;
    const paidEndIndex = paidStartIndex + this.invoicesPerPage;
    this.paginatedPaidGroups = this.paidInvoiceGroups.slice(paidStartIndex, paidEndIndex);

    // Create unified invoice groups based on view mode
    let sourceInvoices: InvoicePair[] = [];
    switch (this.invoiceViewMode) {
      case 'open':
        sourceInvoices = this.openInvoices;
        break;
      case 'unpaid':
        sourceInvoices = this.unpaidInvoices;
        break;
      case 'past':
        // Flatten paid groups
        sourceInvoices = this.paidInvoiceGroups.flatMap(group => group.items);
        break;
    }

    // Group invoices by company
    const byCompany = new Map<number | null, InvoicePairWithService[]>();
    sourceInvoices.forEach(pair => {
      const companyId = pair.positive.CompanyID ?? pair.negative?.CompanyID ?? null;
      const invoiceWithService: InvoicePairWithService = {
        ...pair,
        serviceName: this.getServiceNameForInvoice(pair.positive)
      };

      if (!byCompany.has(companyId)) {
        byCompany.set(companyId, []);
      }
      byCompany.get(companyId)!.push(invoiceWithService);
    });

    // Convert to invoice groups
    const allGroups: InvoiceGroup[] = Array.from(byCompany.entries()).map(([companyId, invoices]) => ({
      companyId,
      companyName: this.getCompanyName(companyId),
      invoices
    }));

    // Sort groups by company name
    allGroups.sort((a, b) => a.companyName.localeCompare(b.companyName));

    // Paginate the groups
    const groupStartIndex = (this.currentInvoicePage - 1) * this.invoicesPerPage;
    const groupEndIndex = groupStartIndex + this.invoicesPerPage;
    this.paginatedInvoiceGroups = allGroups.slice(groupStartIndex, groupEndIndex);

    // Calculate total pages based on the category with most items
    const maxInvoices = Math.max(
      this.openInvoices.length,
      this.unpaidInvoices.length,
      this.paidInvoiceGroups.length,
      allGroups.length
    );
    this.totalInvoicePages = Math.ceil(maxInvoices / this.invoicesPerPage);
  }

  nextInvoicePage() {
    if (this.currentInvoicePage < this.totalInvoicePages) {
      this.currentInvoicePage++;
      this.paginateInvoices();
    }
  }

  prevInvoicePage() {
    if (this.currentInvoicePage > 1) {
      this.currentInvoicePage--;
      this.paginateInvoices();
    }
  }

  setInvoiceViewMode(mode: 'open' | 'past' | 'unpaid') {
    this.invoiceViewMode = mode;
    this.paginateInvoices();
  }

  updateInvoiceMetrics() {
    let total = 0;
    let outstanding = 0;
    let paid = 0;

    const recordTotals = (pair: InvoicePair) => {
      const positiveAmount = pair.positive.Fee ?? 0;
      if (positiveAmount > 0) {
        total += positiveAmount;
      }

      if (pair.negative) {
        paid += Math.abs(pair.negative.Fee ?? 0);
        if (pair.netAmount > 0) {
          outstanding += pair.netAmount;
        }
      } else {
        const partialPaid = Math.max(pair.positive.Paid ?? 0, 0);
        paid += partialPaid;
        if (pair.netAmount > 0) {
          outstanding += pair.netAmount;
        }
      }
    };

    this.openInvoices.forEach(recordTotals);
    this.unpaidInvoices.forEach(recordTotals);
    this.paidInvoiceGroups.forEach(group => group.items.forEach(recordTotals));

    this.invoiceMetrics = { total, outstanding, paid };
  }

  private compareDatesAsc(a: Date | null | undefined, b: Date | null | undefined): number {
    const aTime = a ? new Date(a).getTime() : 0;
    const bTime = b ? new Date(b).getTime() : 0;
    return aTime - bTime;
  }

  private compareDatesDesc(a: Date | null | undefined, b: Date | null | undefined): number {
    return this.compareDatesAsc(b, a);
  }
  getCompanyName(companyId: number | null): string {
    if (companyId === null) {
      return 'Unassigned';
    }
    return this.companyNameLookup.get(companyId) ?? 'Unassigned';
  }

  getUserHeadshot(user: any): string | null {
    if (!user.Headshot) {
      return null;
    }
    
    // Log the headshot value for debugging
    if (typeof user.Headshot === 'object') {
      // Caspio might return an object with a URL property
      if (user.Headshot.url) {
        return user.Headshot.url;
      }
      if (user.Headshot.Url) {
        return user.Headshot.Url;
      }
      if (user.Headshot.URL) {
        return user.Headshot.URL;
      }
    }
    
    const headshotStr = String(user.Headshot);
    
    // If it's already a data URL or full URL, return it
    if (headshotStr.startsWith('data:') || headshotStr.startsWith('http')) {
      return headshotStr;
    }
    
    // If it's a relative path or filename, construct the full URL
    // This might need to be adjusted based on how Caspio returns the URLs
    return headshotStr;
  }

  private groupOffersByCompany() {
    this.offersByCompany.clear();
    
    this.allOffers.forEach(offer => {
      const companyId = offer.CompanyID !== undefined && offer.CompanyID !== null ? Number(offer.CompanyID) : null;
      
      if (companyId !== null) {
        if (!this.offersByCompany.has(companyId)) {
          this.offersByCompany.set(companyId, []);
        }
        
        // Add type name to the offer
        const typeId = offer.TypeID !== undefined && offer.TypeID !== null ? Number(offer.TypeID) : null;
        const typeName = typeId !== null ? this.typeIdToNameLookup.get(typeId) : null;
        
        this.offersByCompany.get(companyId)!.push({
          ...offer,
          typeName: typeName || 'Unknown Service'
        });
      }
    });
  }

  getCompanyOffers(companyId: number | null): any[] {
    if (companyId === null) {
      return [];
    }
    return this.offersByCompany.get(companyId) || [];
  }

  getAvailableTypesForCompany(companyId: number): { typeId: number; typeName: string }[] {
    const existingTypeIds = new Set(
      this.getCompanyOffers(companyId).map((o: any) => Number(o.TypeID))
    );
    const available: { typeId: number; typeName: string }[] = [];
    this.typeIdToNameLookup.forEach((name, id) => {
      if (!existingTypeIds.has(id)) {
        available.push({ typeId: id, typeName: name });
      }
    });
    return available.sort((a, b) => a.typeName.localeCompare(b.typeName));
  }

  getAvailableTypesForNewCompany(): { typeId: number; typeName: string }[] {
    const existingTypeIds = new Set(this.newCompanyOffers.map((o: any) => Number(o.TypeID)));
    const available: { typeId: number; typeName: string }[] = [];
    this.typeIdToNameLookup.forEach((name, id) => {
      if (!existingTypeIds.has(id)) {
        available.push({ typeId: id, typeName: name });
      }
    });
    return available.sort((a, b) => a.typeName.localeCompare(b.typeName));
  }

  async addOfferToCompany(companyId: number) {
    if (!this.editOfferTypeId) return;
    try {
      await firstValueFrom(
        this.caspioService.post('/tables/LPS_Offers/records', {
          TypeID: this.editOfferTypeId,
          CompanyID: companyId,
          ServiceFee: 0,
          ClientFee: 0
        })
      );
      // Reload offers (skip cache to get fresh data after mutation)
      const offersRecords = await this.fetchTableRecords('Offers', {
        'q.select': 'PK_ID,OffersID,TypeID,CompanyID,ServiceFee,ClientFee',
        'q.orderBy': 'OffersID',
        'q.limit': '1000'
      }, true);
      this.allOffers = offersRecords;
      this.groupOffersByCompany();
      this.editOfferTypeId = null;
    } catch (error) {
      console.error('Error adding offer:', error);
      await this.showToast('Failed to add service', 'danger');
    }
  }

  async removeOfferFromCompany(offer: any, companyId: number) {
    const offerId = offer.OffersID || offer.PK_ID;
    if (!offerId) return;
    try {
      await firstValueFrom(
        this.caspioService.delete(`/tables/LPS_Offers/records?q.where=OffersID=${offerId}`)
      );
      // Reload offers (skip cache to get fresh data after mutation)
      const offersRecords = await this.fetchTableRecords('Offers', {
        'q.select': 'PK_ID,OffersID,TypeID,CompanyID,ServiceFee,ClientFee',
        'q.orderBy': 'OffersID',
        'q.limit': '1000'
      }, true);
      this.allOffers = offersRecords;
      this.groupOffersByCompany();
    } catch (error) {
      console.error('Error removing offer:', error);
      await this.showToast('Failed to remove service', 'danger');
    }
  }

  addOfferToNewCompany() {
    if (!this.newCompanyOfferTypeId) return;
    const typeName = this.typeIdToNameLookup.get(this.newCompanyOfferTypeId) || 'Unknown';
    this.newCompanyOffers.push({
      TypeID: this.newCompanyOfferTypeId,
      typeName,
      ServiceFee: 0,
      ClientFee: 0
    });
    this.newCompanyOfferTypeId = null;
  }

  removeOfferFromNewCompany(index: number) {
    this.newCompanyOffers.splice(index, 1);
  }

  formatFee(value: any): string {
    const num = parseFloat(value);
    if (isNaN(num) || num === 0) return '';
    return num.toFixed(2);
  }

  parseFee(event: Event): number {
    const input = event.target as HTMLInputElement;
    const cleaned = input.value.replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    const result = isNaN(num) ? 0 : Math.round(num * 100) / 100;
    input.value = result > 0 ? result.toFixed(2) : '';
    return result;
  }

  getDefaultServiceOffers(): any[] {
    // Collect all unique TypeIDs from existing offers
    const typeIdCounts = new Map<number, number>();
    this.allOffers.forEach(offer => {
      const typeId = Number(offer.TypeID);
      if (!isNaN(typeId)) {
        typeIdCounts.set(typeId, (typeIdCounts.get(typeId) || 0) + 1);
      }
    });
    // Use types that appear for at least 2 companies (common services)
    const threshold = Math.min(2, this.companies.length);
    const defaults: any[] = [];
    typeIdCounts.forEach((count, typeId) => {
      if (count >= threshold) {
        const typeName = this.typeIdToNameLookup.get(typeId) || 'Unknown';
        defaults.push({ TypeID: typeId, typeName, ServiceFee: 0, ClientFee: 0 });
      }
    });
    // If no common services found, include all types
    if (defaults.length === 0) {
      this.typeIdToNameLookup.forEach((name, id) => {
        defaults.push({ TypeID: id, typeName: name, ServiceFee: 0, ClientFee: 0 });
      });
    }
    return defaults.sort((a, b) => a.typeName.localeCompare(b.typeName));
  }

  getFirstName(fullName: string | null | undefined): string {
    if (!fullName) {
      return '';
    }
    return fullName.split(' ')[0];
  }

  formatDate(value: Date | string | null | undefined): string {
    const date = value instanceof Date ? value : value ? new Date(value) : null;
    if (!date || isNaN(date.getTime())) {
      return '—';
    }
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  }

  formatDateShort(value: Date | string | null | undefined): string {
    const date = value instanceof Date ? value : value ? new Date(value) : null;
    if (!date || isNaN(date.getTime())) {
      return '—';
    }
    // Format as M/D/YY for mobile (shorthand format)
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear() % 100; // Get last 2 digits of year
    return `${month}/${day}/${year}`;
  }

  formatTime(value: Date | string | null | undefined): string {
    const date = value instanceof Date ? value : value ? new Date(value) : null;
    if (!date || isNaN(date.getTime())) {
      return '';
    }
    return new Intl.DateTimeFormat(undefined, { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    }).format(date);
  }

  formatCurrency(value: number | string | null | undefined): string {
    const amount = typeof value === 'number' ? value : Number(value ?? 0);
    if (isNaN(amount)) {
      return '$0.00';
    }
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount);
  }

  getOrdinalSuffix(day: number): string {
    if (day > 3 && day < 21) return 'th';
    switch (day % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  }

  formatPhone(phone?: string): string {
    if (!phone) {
      return '';
    }
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return phone;
  }

  buildCompanyAddress(company: { Address?: string; City?: string; State?: string; Zip?: string }): string {
    const parts = [company.Address, company.City, company.State, company.Zip]
      .map(part => (part ?? '').toString().trim())
      .filter(part => part.length > 0);
    return parts.length ? parts.join(', ') : 'Address not provided';
  }

  formatStageName(stage: StageDefinition): string {
    const raw = stage.name?.toString().trim();
    if (!raw || raw.length === 0) {
      return `Stage ${stage.id}`;
    }
    return raw.replace(/^\d+\s*[-–]\s*/, '').replace(/^\d+\s*/, '');
  }

  onContactSearchChange(value: string | null | undefined) {
    this.contactsSearchTerm = value ?? '';
    if (this.contactSearchDebounce) {
      clearTimeout(this.contactSearchDebounce);
    }
    this.contactSearchDebounce = setTimeout(() => {
      this.applyContactFilters();
    }, 150);
  }

  onUserSearchChange(value: string | null | undefined) {
    this.usersSearchTerm = value ?? '';
    this.applyUserFilters();
  }

  openEditUserHeadshot(user: any) {
    this.editingUserHeadshot = { ...user };
    this.editUserHeadshotFile = null;
    this.editUserHeadshotPreview = this.getUserHeadshot(user);
    this.isEditUserHeadshotModalOpen = true;
  }

  closeEditUserHeadshotModal() {
    this.isEditUserHeadshotModalOpen = false;
    this.editingUserHeadshot = null;
    this.editUserHeadshotFile = null;
    this.editUserHeadshotPreview = null;
  }

  onEditUserHeadshotChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.editUserHeadshotFile = input.files[0];
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.editUserHeadshotPreview = e.target.result;
      };
      reader.readAsDataURL(this.editUserHeadshotFile);
    }
  }

  async saveUserHeadshot() {
    if (!this.editingUserHeadshot || !this.editUserHeadshotFile) {
      await this.showToast('Please select a photo to upload', 'warning');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Updating headshot...'
    });
    await loading.present();

    try {
      // Convert image to base64
      const reader = new FileReader();
      const base64Image = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          resolve(reader.result as string);
        };
        reader.onerror = reject;
        reader.readAsDataURL(this.editUserHeadshotFile!);
      });

      // Find the user's PK_ID or UserID
      const userId = this.editingUserHeadshot.UserID || this.editingUserHeadshot.PK_ID;
      
      if (!userId) {
        throw new Error('User ID not found');
      }

      // Update via Caspio API
      const payload = {
        Headshot: base64Image
      };

      await firstValueFrom(
        this.caspioService.put(`/tables/LPS_Users/records?q.where=UserID=${userId}`, payload)
      );

      // Update the user in the local arrays
      const userIndex = this.allUsers.findIndex(u =>
        (u.UserID || u.PK_ID) === userId
      );

      if (userIndex !== -1) {
        this.allUsers[userIndex].Headshot = base64Image;
      }

      // Also update organizationUsers (partner/client portal view)
      const orgIndex = this.organizationUsers.findIndex(u =>
        (u.UserID || u.PK_ID) === userId
      );
      if (orgIndex !== -1) {
        this.organizationUsers[orgIndex].Headshot = base64Image;
      }

      // Reapply filters to update the admin view
      this.applyUserFilters();

      await this.showToast('Headshot updated successfully', 'success');
      this.closeEditUserHeadshotModal();
    } catch (error: any) {
      console.error('Error updating headshot:', error);
      let errorMessage = 'Failed to update headshot';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Update failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Update failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Update failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Update failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  openEditUserModal(user: any) {
    this.editingUser = { ...user };
    this.editingUserOriginal = user;
    this.editUserModalHeadshotFile = null;
    this.editUserModalHeadshotPreview = null;
    this.isEditUserModalOpen = true;
  }

  closeEditUserModal() {
    this.isEditUserModalOpen = false;
    this.editingUser = null;
    this.editingUserOriginal = null;
    this.editUserModalHeadshotFile = null;
    this.editUserModalHeadshotPreview = null;
  }

  onEditUserModalHeadshotChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.editUserModalHeadshotFile = input.files[0];
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.editUserModalHeadshotPreview = e.target.result;
      };
      reader.readAsDataURL(this.editUserModalHeadshotFile);
    }
  }

  async saveEditedUser() {
    if (!this.editingUser) {
      return;
    }

    // Validate required fields
    if (!this.editingUser.Name || this.editingUser.Name.trim() === '') {
      await this.showToast('Please enter a user name', 'warning');
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Updating user...'
    });
    await loading.present();

    try {
      // Build payload
      const payload: any = {
        Name: this.editingUser.Name.trim()
      };

      if (this.editingUser.Email && this.editingUser.Email.trim() !== '') {
        payload.Email = this.editingUser.Email.trim();
      }

      if (this.editingUser.Phone && this.editingUser.Phone.trim() !== '') {
        payload.Phone = this.editingUser.Phone.trim();
      }

      if (this.editingUser.Title && this.editingUser.Title.trim() !== '') {
        payload.Title = this.editingUser.Title.trim();
      }

      // Add headshot if a new one was selected
      if (this.editUserModalHeadshotFile) {
        const reader = new FileReader();
        await new Promise((resolve, reject) => {
          reader.onload = () => {
            payload.Headshot = reader.result;
            resolve(true);
          };
          reader.onerror = reject;
          reader.readAsDataURL(this.editUserModalHeadshotFile!);
        });
      }

      // Find the user's ID
      const userId = this.editingUser.UserID || this.editingUser.PK_ID;

      if (!userId) {
        throw new Error('User ID not found');
      }

      // Update via Caspio API
      await firstValueFrom(
        this.caspioService.put(`/tables/LPS_Users/records?q.where=UserID=${userId}`, payload)
      );

      // Try to set password separately (Caspio may restrict Password field writes)
      if (this.editingUser.Password && this.editingUser.Password.trim() !== '') {
        try {
          await firstValueFrom(
            this.caspioService.put(`/tables/LPS_Users/records?q.where=UserID=${userId}`, { Password: this.editingUser.Password.trim() })
          );
        } catch (pwError) {
          console.warn('Password could not be updated via API:', pwError);
        }
      }

      // Update the user in the local arrays
      const userIndex = this.allUsers.findIndex(u =>
        (u.UserID || u.PK_ID) === userId
      );

      if (userIndex !== -1) {
        this.allUsers[userIndex] = { ...this.allUsers[userIndex], ...payload };
        if (this.editUserModalHeadshotFile && payload.Headshot) {
          this.allUsers[userIndex].Headshot = payload.Headshot;
        }
      }

      // Also update organizationUsers (partner/client portal view)
      const orgIndex = this.organizationUsers.findIndex(u =>
        (u.UserID || u.PK_ID) === userId
      );
      if (orgIndex !== -1) {
        this.organizationUsers[orgIndex] = { ...this.organizationUsers[orgIndex], ...payload };
        if (this.editUserModalHeadshotFile && payload.Headshot) {
          this.organizationUsers[orgIndex].Headshot = payload.Headshot;
        }
      }

      // Reapply filters to update the admin view
      this.applyUserFilters();

      await this.showToast('User updated successfully', 'success');
      this.closeEditUserModal();
    } catch (error: any) {
      console.error('Error updating user:', error);
      let errorMessage = 'Failed to update user';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Update failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Update failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Update failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Update failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async deleteUser(user: any, event?: Event) {
    if (event) {
      event.stopPropagation();
    }

    // G2-UX-004: Confirmation dialog with keyboard accessibility (web only)
    const result = await this.confirmationDialog.confirmDelete({
      header: 'Delete User',
      message: `Are you sure you want to delete user "${user.Name}"? This action cannot be undone.`,
      itemName: user.Name
    });

    if (result.confirmed) {
      await this.performDeleteUser(user);
    }
  }

  private async performDeleteUser(user: any) {
    const loading = await this.loadingController.create({
      message: 'Deleting user...',
      spinner: 'lines'
    });
    await loading.present();

    try {
      const userId = user.UserID || user.PK_ID;
      
      if (!userId) {
        throw new Error('User ID not found');
      }

      // Delete via Caspio API
      await firstValueFrom(
        this.caspioService.delete(`/tables/LPS_Users/records?q.where=UserID=${userId}`)
      );

      // Remove from local arrays
      const userIndex = this.allUsers.findIndex(u =>
        (u.UserID || u.PK_ID) === userId
      );

      if (userIndex !== -1) {
        this.allUsers.splice(userIndex, 1);
      }

      // Also remove from organizationUsers (client portal)
      const orgIndex = this.organizationUsers.findIndex(u =>
        (u.UserID || u.PK_ID) === userId
      );
      if (orgIndex !== -1) {
        this.organizationUsers.splice(orgIndex, 1);
      }

      // Close the edit modal
      this.closeEditUserModal();

      // Reapply filters
      this.applyUserFilters();
      await this.showToast('User deleted successfully', 'success');
    } catch (error: any) {
      console.error('Error deleting user:', error);
      let errorMessage = 'Failed to delete user';

      if (error?.error) {
        if (typeof error.error === 'string') {
          errorMessage = `Delete failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Delete failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Delete failed: ${error.error.message}`;
        }
      } else if (error?.message) {
        errorMessage = `Delete failed: ${error.message}`;
      }

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  // Additional helper methods for the new Companies UI
  formatCompactCurrency(value: number | string | null | undefined): string {
    const amount = typeof value === 'number' ? value : Number(value ?? 0);
    if (isNaN(amount)) {
      return '$0';
    }
    if (amount >= 1000000) {
      return `$${(amount / 1000000).toFixed(1)}M`;
    }
    if (amount >= 1000) {
      return `$${(amount / 1000).toFixed(1)}K`;
    }
    return `$${Math.round(amount)}`;
  }

  getStageIcon(stage: string): string {
    const stageMap: Record<string, string> = {
      'prospect': 'flag-outline',
      'lead': 'trending-up-outline',
      'qualified': 'checkmark-circle-outline',
      'proposal': 'document-text-outline',
      'negotiation': 'chatbubbles-outline',
      'closed won': 'trophy-outline',
      'closed lost': 'close-circle-outline',
      'active': 'rocket-outline',
      'inactive': 'pause-circle-outline'
    };
    return stageMap[stage?.toLowerCase()] || 'ellipse-outline';
  }

  getTotalContacts(companies: CompanyViewModel[]): number {
    return companies.reduce((sum, c) => sum + (c.contactCount || 0), 0);
  }

  getTotalTasks(companies: CompanyViewModel[]): number {
    return companies.reduce((sum, c) => sum + (c.openTasks || 0), 0);
  }

  private expandedCompanies = new Set<number>();
  private expandedStages = new Set<number>();
  private stagesInitialized = false;
  private expandedContactGroups = new Set<string>();
  private expandedInvoiceGroups = new Set<string>();

  isInvoiceGroupExpanded(companyName: string): boolean {
    return this.expandedInvoiceGroups.has(companyName);
  }

  toggleInvoiceGroupExpand(companyName: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (this.expandedInvoiceGroups.has(companyName)) {
      this.expandedInvoiceGroups.delete(companyName);
    } else {
      this.expandedInvoiceGroups.add(companyName);
    }
  }

  isContactGroupExpanded(companyName: string): boolean {
    return this.expandedContactGroups.has(companyName);
  }

  toggleContactGroupExpand(companyName: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (this.expandedContactGroups.has(companyName)) {
      this.expandedContactGroups.delete(companyName);
    } else {
      this.expandedContactGroups.add(companyName);
    }
  }

  isStageExpanded(stage: StageDefinition): boolean {
    // Default to collapsed (false) instead of expanded
    return this.expandedStages.has(stage.id);
  }

  toggleStageExpand(stage: StageDefinition, event?: Event): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }

    if (this.expandedStages.has(stage.id)) {
      this.expandedStages.delete(stage.id);
    } else {
      this.expandedStages.add(stage.id);
    }
  }

  isCompanyExpanded(company: CompanyViewModel): boolean {
    return this.expandedCompanies.has(company.CompanyID);
  }

  toggleCompanyExpand(company: CompanyViewModel, event: Event): void {
    event.stopPropagation();
    if (this.expandedCompanies.has(company.CompanyID)) {
      this.expandedCompanies.delete(company.CompanyID);
    } else {
      this.expandedCompanies.add(company.CompanyID);
      // Load outstanding invoice data when expanding
      this.loadCompanyOutstandingInvoices(company.CompanyID);
    }
  }

  applyCompanyFilter(company: CompanyViewModel, event: Event): void {
    event.stopPropagation();

    // If this company is already filtered, clear the filter
    if (this.globalCompanyFilterId === company.CompanyID) {
      this.clearGlobalCompanyFilter();
    } else {
      // Apply filter to this company
      this.selectGlobalCompany(company.CompanyID, company.CompanyName);
    }
  }

  viewCompanyDetails(company: CompanyViewModel, event: Event): void {
    event.stopPropagation();
  }

  async editCompany(company: CompanyViewModel, event: Event): Promise<void> {
    event.stopPropagation();

    // Ensure size options are always available (fixed Caspio field values)
    if (this.uniqueCompanySizes.length === 0) {
      this.uniqueCompanySizes = [
        'One Person',
        'Multi Inspector (2-5)',
        'Multi Inspector (5-10)',
        'Large Multi Inspector (10+)'
      ];
    }

    // Load software options and build ID-to-name map before opening modal
    await this.loadSoftwareLookup();

    // Create a clean copy with only database fields (exclude computed view model fields)
    this.editingCompany = {
      PK_ID: company.PK_ID,
      CompanyID: company.CompanyID,
      StageID: company.StageID,
      StageName: company.StageName,
      CompanyName: company.CompanyName,
      SizeLabel: company.SizeLabel,
      Size: company.Size || '',
      ServiceArea: company.ServiceArea,
      LeadSource: company.LeadSource,
      Phone: company.Phone,
      Email: company.Email,
      Website: company.Website,
      Address: company.Address,
      City: company.City,
      State: company.State,
      Zip: company.Zip,
      Notes: company.Notes,
      Franchise: company.Franchise,
      DateOnboarded: company.DateOnboarded,
      CCEmail: company.CCEmail,
      CC_Email: company.CC_Email,
      SoftwareID: company.SoftwareID,
      'Onboarding Stage': company['Onboarding Stage'],
      Contract: company.Contract,
      // Autopay fields
      AutopayEnabled: company.AutopayEnabled || false,
      PayPalVaultToken: company.PayPalVaultToken || null,
      PayPalPayerID: company.PayPalPayerID || null,
      PayPalPayerEmail: company.PayPalPayerEmail || null,
      AutopayDay: company.AutopayDay || 1,
      AutopayLastRun: company.AutopayLastRun || null,
      AutopayLastStatus: company.AutopayLastStatus || null,
      AutopayReviewRequired: company.AutopayReviewRequired || false
    };

    // Format DateOnboarded for <input type="date"> (requires yyyy-MM-dd)
    if (this.editingCompany.DateOnboarded) {
      const d = new Date(this.editingCompany.DateOnboarded);
      if (!isNaN(d.getTime())) {
        this.editingCompany.DateOnboarded = this.formatDateForInput(d);
      }
    }

    // Resolve numeric SoftwareID to software name for the dropdown
    const rawSoftwareId = this.editingCompany.SoftwareID;
    if (rawSoftwareId && !isNaN(Number(rawSoftwareId))) {
      const numId = Number(rawSoftwareId);
      let resolvedName = '';
      for (const [name, id] of this.softwareNameToIdMap.entries()) {
        if (id === numId) { resolvedName = name; break; }
      }
      this.editingCompany.SoftwareID = resolvedName;
    }
    this.editingCompany.SoftwareID = this.editingCompany.SoftwareID || '';

    // Ensure current Size value appears in dropdown options
    if (this.editingCompany.Size && !this.uniqueCompanySizes.includes(this.editingCompany.Size)) {
      this.uniqueCompanySizes.push(this.editingCompany.Size);
    }

    this.editingCompanyContractFile = null;
    this.editingCompanyLogoFile = null;
    this.editingCompanyLogoPreview = null;
    this.isEditModalOpen = true;
  }

  async editAdminCompanyDetails(): Promise<void> {
    const company = this.currentCompany;
    if (!company) return;

    // Ensure size options are always available (fixed Caspio field values)
    if (this.uniqueCompanySizes.length === 0) {
      this.uniqueCompanySizes = [
        'One Person',
        'Multi Inspector (2-5)',
        'Multi Inspector (5-10)',
        'Large Multi Inspector (10+)'
      ];
    }

    // Load software options and build ID-to-name map before opening modal
    await this.loadSoftwareLookup();

    this.editingCompany = { ...company };
    this.editingCompany.Size = this.editingCompany.Size || '';

    // Format DateOnboarded for <input type="date"> (requires yyyy-MM-dd)
    if (this.editingCompany.DateOnboarded) {
      const d = new Date(this.editingCompany.DateOnboarded);
      if (!isNaN(d.getTime())) {
        this.editingCompany.DateOnboarded = this.formatDateForInput(d);
      }
    }

    // Resolve numeric SoftwareID to software name for the dropdown
    const rawSoftwareId = this.editingCompany.SoftwareID;
    if (rawSoftwareId && !isNaN(Number(rawSoftwareId))) {
      const numId = Number(rawSoftwareId);
      let resolvedName = '';
      for (const [name, id] of this.softwareNameToIdMap.entries()) {
        if (id === numId) { resolvedName = name; break; }
      }
      this.editingCompany.SoftwareID = resolvedName;
    }
    this.editingCompany.SoftwareID = this.editingCompany.SoftwareID || '';

    // Ensure current Size value appears in dropdown options
    if (this.editingCompany.Size && !this.uniqueCompanySizes.includes(this.editingCompany.Size)) {
      this.uniqueCompanySizes.push(this.editingCompany.Size);
    }

    this.editingCompanyContractFile = null;
    this.editingCompanyLogoFile = null;
    this.editingCompanyLogoPreview = null;
    this.isEditModalOpen = true;
  }

  async editClientCompanyDetails(): Promise<void> {
    const company = this.clientCompany;
    if (!company) return;

    // Ensure size options are always available (fixed Caspio field values)
    if (this.uniqueCompanySizes.length === 0) {
      this.uniqueCompanySizes = [
        'One Person',
        'Multi Inspector (2-5)',
        'Multi Inspector (5-10)',
        'Large Multi Inspector (10+)'
      ];
    }

    // Load software options and build ID-to-name map before opening modal
    await this.loadSoftwareLookup();

    this.editingCompany = { ...company };
    this.editingCompany.Size = this.editingCompany.Size || '';

    // Format DateOnboarded for <input type="date"> (requires yyyy-MM-dd)
    if (this.editingCompany.DateOnboarded) {
      const d = new Date(this.editingCompany.DateOnboarded);
      if (!isNaN(d.getTime())) {
        this.editingCompany.DateOnboarded = this.formatDateForInput(d);
      }
    }

    // Resolve numeric SoftwareID to software name for the dropdown
    const rawSoftwareId = this.editingCompany.SoftwareID;
    if (rawSoftwareId && !isNaN(Number(rawSoftwareId))) {
      const numId = Number(rawSoftwareId);
      let resolvedName = '';
      for (const [name, id] of this.softwareNameToIdMap.entries()) {
        if (id === numId) { resolvedName = name; break; }
      }
      this.editingCompany.SoftwareID = resolvedName;
    }
    this.editingCompany.SoftwareID = this.editingCompany.SoftwareID || '';

    // Ensure current Size value appears in dropdown options
    if (this.editingCompany.Size && !this.uniqueCompanySizes.includes(this.editingCompany.Size)) {
      this.uniqueCompanySizes.push(this.editingCompany.Size);
    }

    this.editingCompanyContractFile = null;
    this.editingCompanyLogoFile = null;
    this.editingCompanyLogoPreview = null;
    this.isEditModalOpen = true;
  }

  getClientSoftwareName(): string {
    return this.resolveSoftwareName(this.clientCompany?.SoftwareID);
  }

  resolveSoftwareName(rawId: any): string {
    if (!rawId) return '';
    if (isNaN(Number(rawId))) return String(rawId); // already a name
    const numId = Number(rawId);
    for (const [name, id] of this.softwareNameToIdMap.entries()) {
      if (id === numId) return name;
    }
    return '';
  }

  closeEditModal(): void {
    this.isEditModalOpen = false;
    this.editingCompany = null;
    this.editingCompanyLogoFile = null;
    this.editingCompanyLogoPreview = null;
    this.editLogoFailed = false;
  }

  onLogoFileChange(event: any): void {
    const file = event.target?.files?.[0];
    if (!file) return;
    this.editingCompanyLogoFile = file;
    this.editLogoFailed = false;
    const reader = new FileReader();
    reader.onload = () => {
      this.editingCompanyLogoPreview = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  async saveCompanyChanges(): Promise<void> {
    if (!this.editingCompany) {
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Saving changes...',
      spinner: 'lines'
    });
    await loading.present();

    try {
      // Build payload with only fields that have actual values (matches user-save pattern)
      const payload: any = {};

      // Helper: only include non-empty text fields
      const addText = (key: string, val: any) => {
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          payload[key] = String(val).trim();
        }
      };

      // Text fields
      addText('CompanyName', this.editingCompany.CompanyName);
      addText('DateOnboarded', this.editingCompany.DateOnboarded);
      addText('LeadSource', this.editingCompany.LeadSource);
      addText('Phone', this.editingCompany.Phone);
      addText('Email', this.editingCompany.Email);
      addText('CC_Email', this.editingCompany.CC_Email);
      addText('Website', this.editingCompany.Website);
      addText('Address', this.editingCompany.Address);
      addText('City', this.editingCompany.City);
      addText('State', this.editingCompany.State);
      addText('Zip', this.editingCompany.Zip);
      addText('ServiceArea', this.editingCompany.ServiceArea);
      addText('Notes', this.editingCompany.Notes);

      // Size — Caspio List-String field, send as key string (matches working POST pattern)
      if (this.editingCompany.Size) {
        const sizeLabel = String(this.editingCompany.Size).trim();
        const sizeKey = this.sizeLabelToKeyMap.get(sizeLabel);
        if (sizeKey) {
          payload.Size = sizeKey;
        }
      }

      // Yes/No field — only send if explicitly true
      if (this.editingCompany.Franchise === true || this.editingCompany.Franchise === 1 || this.editingCompany.Franchise === 'Yes') {
        payload.Franchise = true;
      } else {
        payload.Franchise = false;
      }

      // File fields — only if new file selected
      if (this.editingCompanyContractFile) {
        const reader = new FileReader();
        await new Promise((resolve, reject) => {
          reader.onload = () => {
            payload.Contract = reader.result;
            resolve(true);
          };
          reader.onerror = reject;
          reader.readAsDataURL(this.editingCompanyContractFile!);
        });
      }

      if (this.editingCompanyLogoFile) {
        const reader = new FileReader();
        await new Promise((resolve, reject) => {
          reader.onload = () => {
            payload.Logo = reader.result;
            resolve(true);
          };
          reader.onerror = reject;
          reader.readAsDataURL(this.editingCompanyLogoFile!);
        });
      }

      // SoftwareID — resolve name to integer ID
      if (this.editingCompany.SoftwareID !== undefined && this.editingCompany.SoftwareID !== null) {
        const softwareName = String(this.editingCompany.SoftwareID).trim();
        const softwareId = this.softwareNameToIdMap.get(softwareName);
        if (softwareId) {
          payload.SoftwareID = softwareId;
        }
      }

      // StageID — resolve stage name to integer ID
      if (this.editingCompany['Onboarding Stage'] !== undefined && this.editingCompany['Onboarding Stage'] !== null) {
        const stageName = String(this.editingCompany['Onboarding Stage']).trim();
        const stage = this.stages.find(s => s.name === stageName);
        if (stage) {
          payload.StageID = stage.id;
        }
      }

      console.log('Company update payload:', JSON.stringify(payload));

      // Update via Caspio API
      const response = await firstValueFrom(
        this.caspioService.put(
          `/tables/LPS_Companies/records?q.where=CompanyID=${this.editingCompany.CompanyID}`,
          payload
        )
      );


      // If a new logo was uploaded, use the local preview for immediate display (avoids browser cache of old Caspio URL)
      if (this.editingCompanyLogoPreview) {
        this.editingCompany.Logo = this.editingCompanyLogoPreview;
      }

      // If a new contract was uploaded, update local data with the base64 for immediate display
      if (payload.Contract) {
        this.editingCompany.Contract = payload.Contract;
      }

      // Update local data
      const index = this.companies.findIndex(c => c.CompanyID === this.editingCompany.CompanyID);
      if (index !== -1) {
        // Merge the updated fields into the existing company record
        this.companies[index] = {
          ...this.companies[index],
          ...this.editingCompany
        };
      }

      // Also update currentCompany if editing own company
      if (this.currentCompany && this.currentCompany.CompanyID === this.editingCompany.CompanyID) {
        this.currentCompany = { ...this.currentCompany, ...this.editingCompany };
        this.adminLogoFailed = false;
      }

      // Also update clientCompany (companies[0]) logo for client view
      if (this.editingCompanyLogoPreview && this.companies.length > 0 && this.companies[0].CompanyID === this.editingCompany.CompanyID) {
        this.clientLogoFailed = false;
      }

      // Update offers for this company
      await this.saveCompanyOffers(this.editingCompany.CompanyID);

      // Refresh filters and views
      this.applyCompanyFilters();
      this.updateSelectedCompanySnapshot();

      await this.showToast('Company updated successfully', 'success');
      this.closeEditModal();
    } catch (error: any) {
      console.error('=== Company Update Error ===');
      console.error('Full error object:', error);
      console.error('Error message:', error?.message);
      console.error('Error status:', error?.status);
      console.error('Error statusText:', error?.statusText);
      console.error('Error body:', error?.error);

      // Try to extract Caspio-specific error messages
      let errorMessage = 'Failed to update company';

      if (error?.error) {
        // Caspio returns errors in various formats
        if (typeof error.error === 'string') {
          errorMessage = `Update failed: ${error.error}`;
        } else if (error.error.Message) {
          errorMessage = `Update failed: ${error.error.Message}`;
        } else if (error.error.message) {
          errorMessage = `Update failed: ${error.error.message}`;
        } else if (error.error.error_description) {
          errorMessage = `Update failed: ${error.error.error_description}`;
        }
      } else if (error?.message) {
        errorMessage = `Update failed: ${error.message}`;
      } else if (error?.status) {
        errorMessage = `Update failed with status ${error.status}`;
      }

      console.error('Final error message shown to user:', errorMessage);

      await this.showToast(errorMessage, 'danger');
    } finally {
      await loading.dismiss();
    }
  }

  async saveCompanyOffers(companyId: number): Promise<void> {
    try {
      const offers = this.getCompanyOffers(companyId);
      
      if (offers.length === 0) {
        return;
      }

      // Update each offer with the new ServiceFee and ClientFee
      const updatePromises = offers.map(offer => {
        const offerId = offer.OffersID || offer.PK_ID;

        if (!offerId) {
          console.warn('Offer missing ID, skipping:', offer);
          return Promise.resolve();
        }

        const payload: any = {
          ServiceFee: offer.ServiceFee
        };
        if (offer.ClientFee !== undefined) {
          payload.ClientFee = offer.ClientFee;
        }

        return firstValueFrom(
          this.caspioService.put(`/tables/LPS_Offers/records?q.where=OffersID=${offerId}`, payload)
        ).catch(error => {
          console.error(`Error updating offer ${offerId}:`, error);
          // Don't throw - continue with other offers
        });
      });

      await Promise.all(updatePromises);

      // Update the local allOffers array
      offers.forEach(offer => {
        const offerId = offer.OffersID || offer.PK_ID;
        const offerIndex = this.allOffers.findIndex(o =>
          (o.OffersID || o.PK_ID) === offerId
        );

        if (offerIndex !== -1) {
          this.allOffers[offerIndex].ServiceFee = offer.ServiceFee;
          this.allOffers[offerIndex].ClientFee = offer.ClientFee;
        }
      });

      // Regroup offers to update the view
      this.groupOffersByCompany();
    } catch (error) {
      console.error('Error saving company offers:', error);
      // Don't throw - already showing company update success
    }
  }

  trackByStage = (_: number, group: StageGroup) => group.stage.id;

  trackByCompany = (_: number, company: CompanyViewModel) => company.CompanyID;

  trackByContactGroup = (index: number, group: ContactGroup) =>
    group.companyId !== null ? group.companyId : -1 - index;

  trackByContact = (_: number, contact: ContactRecord) => contact.ContactID;

  trackByInvoiceGroup = (index: number, group: InvoiceGroup) =>
    group.companyId !== null ? group.companyId : -1 - index;

  trackByInvoice = (_: number, invoice: InvoicePairWithService) => invoice.positive.InvoiceID;

  trackByTask = (_: number, task: TaskViewModel) => task.TaskID;

  aggregateRevenueByMonth() {
    // Filter projects: Fee > 0 and exclude CompanyID 1
    const filteredProjects = this.projects.filter(project => {
      const fee = project.Fee !== undefined && project.Fee !== null ? Number(project.Fee) : 0;
      const companyId = project.CompanyID !== undefined && project.CompanyID !== null ? Number(project.CompanyID) : null;
      return fee > 0 && companyId !== 1;
    });

    // Group by month
    const monthlyRevenue = new Map<string, number>();

    filteredProjects.forEach(project => {
      const dateStr = project.Date;
      if (!dateStr) {
        return;
      }

      const date = this.toDate(dateStr);
      if (!date) {
        return;
      }

      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      const currentTotal = monthlyRevenue.get(monthKey) ?? 0;
      const fee = project.Fee !== undefined && project.Fee !== null ? Number(project.Fee) : 0;
      monthlyRevenue.set(monthKey, currentTotal + fee);
    });

    // Sort by month and create labels/values arrays
    const sortedEntries = Array.from(monthlyRevenue.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));

    this.revenueChartData = {
      labels: sortedEntries.map(([monthKey]) => {
        const [year, month] = monthKey.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1);
        return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      }),
      values: sortedEntries.map(([_, value]) => value)
    };
  }

  renderRevenueChart() {
    const canvas = document.getElementById('revenueChart') as HTMLCanvasElement;
    if (!canvas) {
      console.warn('Revenue chart canvas not found');
      return;
    }

    // Destroy existing chart if it exists
    if (this.revenueChart) {
      this.revenueChart.destroy();
      this.revenueChart = null;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const config: ChartConfiguration = {
      type: 'line',
      data: {
        labels: this.revenueChartData.labels,
        datasets: [{
          label: 'Revenue',
          data: this.revenueChartData.values,
          fill: true,
          backgroundColor: 'rgba(59, 130, 246, 0.2)',
          borderColor: 'rgb(59, 130, 246)',
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: 'rgb(59, 130, 246)',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.parsed.y;
                if (value === null || value === undefined) {
                  return 'Revenue: $0.00';
                }
                return `Revenue: $${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) => {
                if (typeof value !== 'number') {
                  return '$0';
                }
                return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
              }
            },
            grid: {
              color: 'rgba(0, 0, 0, 0.05)'
            }
          },
          x: {
            grid: {
              display: false
            }
          }
        }
      }
    };

    this.revenueChart = new Chart(ctx, config);
  }

  aggregateProjectsByType() {
    // Filter projects: exclude CompanyID 1
    const filteredProjects = this.projects.filter(project => {
      const companyId = project.CompanyID !== undefined && project.CompanyID !== null ? Number(project.CompanyID) : null;
      return companyId !== 1;
    });


    // Group by TypeName
    const typeGroups = new Map<string, { completedCount: number; totalRevenue: number }>();

    filteredProjects.forEach(project => {
      const offersId = project.OffersID !== undefined && project.OffersID !== null ? Number(project.OffersID) : null;
      const statusId = project.StatusID !== undefined && project.StatusID !== null ? Number(project.StatusID) : null;
      const fee = project.Fee !== undefined && project.Fee !== null ? Number(project.Fee) : 0;

      // Get TypeName: Projects.OffersID → Offers.TypeID → Type.TypeName
      let typeName = 'Unspecified';
      let debugInfo: any = {
        offersId,
        statusId,
        fee
      };

      if (offersId !== null) {
        const typeId = this.offersLookup.get(offersId);
        debugInfo.typeIdFromOffers = typeId;

        if (typeId !== undefined && typeId !== null) {
          const foundTypeName = this.typeIdToNameLookup.get(typeId);
          debugInfo.typeNameFromOffers = foundTypeName;

          if (foundTypeName) {
            typeName = foundTypeName;
          }
        }
      }

      // Log only if still unspecified
      if (typeName === 'Unspecified') {
      }

      // Initialize group if doesn't exist
      if (!typeGroups.has(typeName)) {
        typeGroups.set(typeName, { completedCount: 0, totalRevenue: 0 });
      }

      const group = typeGroups.get(typeName)!;

      // Count completed projects (StatusID === 2)
      if (statusId === 2) {
        group.completedCount++;
      }

      // Add to total revenue
      group.totalRevenue += fee;
    });

    // Sort by type name and create arrays
    const sortedEntries = Array.from(typeGroups.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));

    sortedEntries.forEach(([typeName, data]) => {
    });

    this.projectsByTypeData = {
      labels: sortedEntries.map(([typeName]) => typeName),
      completedCounts: sortedEntries.map(([_, data]) => data.completedCount),
      totalRevenue: sortedEntries.map(([_, data]) => data.totalRevenue)
    };
  }

  renderProjectsByTypeChart() {
    const canvas = document.getElementById('projectsByTypeChart') as HTMLCanvasElement;
    if (!canvas) {
      console.warn('Projects by type chart canvas not found');
      return;
    }

    // Destroy existing chart if it exists
    if (this.projectsByTypeChart) {
      this.projectsByTypeChart.destroy();
      this.projectsByTypeChart = null;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const config: ChartConfiguration = {
      type: 'bar',
      data: {
        labels: this.projectsByTypeData.labels,
        datasets: [
          {
            label: 'Completed Projects',
            data: this.projectsByTypeData.completedCounts,
            backgroundColor: 'rgba(16, 185, 129, 0.6)',
            borderColor: 'rgb(16, 185, 129)',
            borderWidth: 2,
            yAxisID: 'y'
          },
          {
            label: 'Total Revenue',
            data: this.projectsByTypeData.totalRevenue,
            backgroundColor: 'rgba(59, 130, 246, 0.6)',
            borderColor: 'rgb(59, 130, 246)',
            borderWidth: 2,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: true,
            position: 'top'
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const label = context.dataset.label || '';
                const value = context.parsed.y;
                if (value === null || value === undefined) {
                  return label + ': 0';
                }
                if (context.datasetIndex === 1) {
                  return label + ': $' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                }
                return label + ': ' + value;
              }
            }
          }
        },
        scales: {
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            beginAtZero: true,
            title: {
              display: true,
              text: 'Completed Projects'
            },
            ticks: {
              callback: (value) => {
                if (typeof value !== 'number') {
                  return '0';
                }
                return value.toString();
              }
            }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            beginAtZero: true,
            title: {
              display: true,
              text: 'Revenue ($)'
            },
            grid: {
              drawOnChartArea: false
            },
            ticks: {
              callback: (value) => {
                if (typeof value !== 'number') {
                  return '$0';
                }
                return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
              }
            }
          },
          x: {
            grid: {
              display: false
            }
          }
        }
      }
    };

    this.projectsByTypeChart = new Chart(ctx, config);
  }

  ngOnDestroy() {
    if (this.routerSubscription) {
      this.routerSubscription.unsubscribe();
    }
    if (this.contactSearchDebounce) {
      clearTimeout(this.contactSearchDebounce);
      this.contactSearchDebounce = null;
    }
    if (this.companySearchDebounce) {
      clearTimeout(this.companySearchDebounce);
      this.companySearchDebounce = null;
    }
    if (this.revenueChart) {
      this.revenueChart.destroy();
      this.revenueChart = null;
    }
    if (this.projectsByTypeChart) {
      this.projectsByTypeChart.destroy();
      this.projectsByTypeChart = null;
    }
  }

  // Global company filter methods
  onGlobalCompanySearch(searchTerm: string | null | undefined) {
    const term = (searchTerm ?? '').trim().toLowerCase();
    this.globalCompanySearchTerm = term;

    if (this.companySearchDebounce) {
      clearTimeout(this.companySearchDebounce);
    }

    this.companySearchDebounce = setTimeout(() => {
      if (term.length === 0) {
        this.filteredCompanySuggestions = [];
        this.showCompanySuggestions = false;
        return;
      }

      // Filter companies based on search term
      this.filteredCompanySuggestions = this.companies
        .filter(company => {
          const haystack = [
            company.CompanyName,
            company.City,
            company.State,
            company.Address
          ].join(' ').toLowerCase();
          return haystack.includes(term);
        })
        .sort((a, b) => a.CompanyName.localeCompare(b.CompanyName))
        .slice(0, 10); // Limit to 10 suggestions

      this.showCompanySuggestions = this.filteredCompanySuggestions.length > 0;
    }, 200);
  }

  selectGlobalCompany(companyId: number, companyName: string) {
    this.globalCompanyFilterId = companyId;
    this.globalCompanySearchTerm = companyName;
    this.showCompanySuggestions = false;
    this.filteredCompanySuggestions = [];

    // Apply filters across all tabs
    this.applyAllFilters();

    // Auto-expand the company's stage and company details
    const company = this.companies.find(c => c.CompanyID === companyId);
    if (company && company.StageID) {
      // Expand the stage group
      this.expandedStages.add(company.StageID);
      // Expand the company details
      this.expandedCompanies.add(companyId);
      // Load outstanding invoice data for the expanded company
      this.loadCompanyOutstandingInvoices(companyId);
    }
  }

  clearGlobalCompanyFilter() {
    this.globalCompanyFilterId = null;
    this.globalCompanySearchTerm = '';
    this.showCompanySuggestions = false;
    this.filteredCompanySuggestions = [];

    // Reapply all filters to show all data
    this.applyAllFilters();
  }

  applyAllFilters() {
    this.applyCompanyFilters();
    this.applyContactFilters();
    this.applyTaskFilters();
    this.applyMeetingFilters();
    this.applyCommunicationFilters();
    this.categorizeInvoices();
    this.applyUserFilters();
  }
  private populateStageDefinitions(records: any[]) {
    const definitions = records.map(record => {
      const name = record.Stage ?? record.Name ?? 'No Stage';
      const id = record.StageID !== undefined && record.StageID !== null ? Number(record.StageID) : 0;
      return {
        id,
        name,
        sortOrder: this.parseStageOrder(name, id)
      };
    }).sort((a, b) => a.sortOrder - b.sortOrder);

    this.stages = definitions;
    this.stageLookup.clear();
    definitions.forEach(definition => this.stageLookup.set(definition.id, definition));
  }

  private populateCommunicationTypes(records: any[]) {
    this.communicationTypeLookup.clear();
    records.forEach(record => {
      if (record.CommunicationID !== undefined) {
        this.communicationTypeLookup.set(Number(record.CommunicationID), record.Type ?? 'General');
      }
    });
  }

  private populateProjectLookup(records: any[]) {
    this.projectDetailsLookup.clear();
    records.forEach(record => {
      if (record.ProjectID === undefined || record.ProjectID === null) {
        return;
      }
      const projectId = Number(record.ProjectID);
      const companyId = record.CompanyID !== undefined && record.CompanyID !== null ? Number(record.CompanyID) : null;
      if (companyId === this.excludedCompanyId) {
        return;
      }
      const projectDate = this.toDate(record.Date);
      const offersId = record.OffersID !== undefined && record.OffersID !== null ? Number(record.OffersID) : null;
      const statusId = record.StatusID !== undefined && record.StatusID !== null ? Number(record.StatusID) : null;
      this.projectDetailsLookup.set(projectId, { companyId, projectDate, offersId, statusId });
    });
  }

  private populateServicesLookup(records: any[]) {
    this.servicesLookup.clear();
    this.servicesByProjectLookup.clear();

    records.forEach(record => {
      const serviceId = record.PK_ID !== undefined && record.PK_ID !== null ? Number(record.PK_ID) : null;
      const projectId = record.ProjectID !== undefined && record.ProjectID !== null ? Number(record.ProjectID) : null;
      const typeId = record.TypeID !== undefined && record.TypeID !== null ? Number(record.TypeID) : null;

      if (serviceId !== null && typeId !== null) {
        this.servicesLookup.set(serviceId, typeId);
      }

      if (projectId !== null && serviceId !== null) {
        if (!this.servicesByProjectLookup.has(projectId)) {
          this.servicesByProjectLookup.set(projectId, []);
        }
        this.servicesByProjectLookup.get(projectId)!.push(serviceId);
      }
    });
  }

  private populateTypeLookup(records: any[]) {
    this.typeIdToNameLookup.clear();

    records.forEach(record => {
      const typeId = record.TypeID !== undefined && record.TypeID !== null ? Number(record.TypeID) : null;
      const typeName = record.TypeName ?? '';

      if (typeId !== null && typeName) {
        this.typeIdToNameLookup.set(typeId, typeName);
      }
    });
  }

  private populateOffersLookup(records: any[]) {
    this.offersLookup.clear();

    if (records.length > 0) {
    }

    let skippedCount = 0;
    let addedCount = 0;

    records.forEach((record, index) => {
      const offersId = record.OffersID !== undefined && record.OffersID !== null ? Number(record.OffersID) :
                       (record.PK_ID !== undefined && record.PK_ID !== null ? Number(record.PK_ID) : null);

      // Try multiple possible field names for TypeID
      const typeId = record.TypeID !== undefined && record.TypeID !== null ? Number(record.TypeID) :
                     record.Type_ID !== undefined && record.Type_ID !== null ? Number(record.Type_ID) :
                     record.Type !== undefined && record.Type !== null ? Number(record.Type) :
                     record.type !== undefined && record.type !== null ? Number(record.type) : null;

      // Debug specific records
      if (offersId === 1099 || offersId === 1189 || offersId === 1346) {
      }

      if (offersId !== null && typeId !== null) {
        this.offersLookup.set(offersId, typeId);
        addedCount++;
      } else {
        skippedCount++;
        if (skippedCount <= 5) {
        }
      }
    });

    // Get OffersID range
    const offersIds = Array.from(this.offersLookup.keys());
    const minOffersId = Math.min(...offersIds);
    const maxOffersId = Math.max(...offersIds);


    // Check specific OffersIDs
  }

  private normalizeCompanyRecord(raw: any): CompanyRecord {
    const stageId = raw.StageID !== undefined && raw.StageID !== null ? Number(raw.StageID) : null;
    const stageName = stageId !== null ? this.stageLookup.get(stageId)?.name ?? 'No Stage' : 'No Stage';

    return {
      PK_ID: Number(raw.PK_ID ?? raw.CompanyID ?? 0),
      CompanyID: Number(raw.CompanyID ?? raw.PK_ID ?? 0),
      StageID: stageId,
      StageName: stageName,
      'Onboarding Stage': stageName !== 'No Stage' ? stageName : '',
      CompanyName: raw.CompanyName ?? 'Unnamed Company',
      SizeLabel: this.extractSizeLabel(raw.Size),
      Size: this.extractSizeLabel(raw.Size),
      ServiceArea: raw.ServiceArea ?? '',
      LeadSource: raw.LeadSource ?? '',
      Phone: raw.Phone ?? '',
      Email: raw.Email ?? '',
      CC_Email: raw.CC_Email ?? raw.CCEmail ?? '',
      Website: this.normalizeUrl(raw.Website ?? ''),
      Address: raw.Address ?? '',
      City: raw.City ?? '',
      State: raw.State ?? '',
      Zip: raw.Zip ?? '',
      Notes: raw.Notes ?? '',
      Franchise: Boolean(raw.Franchise),
      DateOnboarded: raw.DateOnboarded ?? '',
      CCEmail: raw.CC_Email ?? raw.CCEmail ?? '',
      SoftwareID: raw.SoftwareID !== undefined && raw.SoftwareID !== null ? String(raw.SoftwareID) : undefined,
      Logo: raw.Logo || undefined,
      Contract: raw.Contract || undefined,
      // Autopay fields (Caspio Yes/No fields return "Yes"/"No" or 1/0)
      AutopayEnabled: raw.AutopayEnabled === true || raw.AutopayEnabled === 1 || raw.AutopayEnabled === 'Yes',
      AutopayReviewRequired: raw.AutopayReviewRequired === true || raw.AutopayReviewRequired === 1 || raw.AutopayReviewRequired === 'Yes',
      AutopayMethod: raw.AutopayMethod || undefined,
      PayPalVaultToken: raw.PayPalVaultToken || undefined,
      PayPalPayerID: raw.PayPalPayerID || undefined,
      PayPalPayerEmail: raw.PayPalPayerEmail || undefined,
      StripeCustomerID: raw.StripeCustomerID || undefined,
      StripePaymentMethodID: raw.StripePaymentMethodID || undefined,
      StripeBankLast4: raw.StripeBankLast4 || undefined,
      StripeBankName: raw.StripeBankName || undefined,
      AutopayDay: raw.AutpayDay ? Number(raw.AutpayDay) : undefined,
      AutopayLastRun: raw.AutopayLastRun || undefined,
      AutopayLastStatus: raw.AutopayLastStatus || undefined
    };
  }

  private normalizeContactRecord(raw: any): ContactRecord {
    return {
      PK_ID: Number(raw.PK_ID ?? raw.ContactID ?? 0),
      ContactID: Number(raw.ContactID ?? raw.PK_ID ?? 0),
      CompanyID: raw.CompanyID !== undefined && raw.CompanyID !== null ? Number(raw.CompanyID) : null,
      Name: raw.Name ?? 'Unnamed Contact',
      Title: raw.Title ?? '',
      Goal: raw.Goal ?? '',
      Role: raw.Role ?? '',
      Email: raw.Email ?? '',
      Phone1: raw.Phone1 ?? '',
      Phone2: raw.Phone2 ?? '',
      PrimaryContact: Boolean(raw.PrimaryContact),
      Notes: raw.Notes ?? ''
    };
  }

  private normalizeTaskRecord(raw: any): TaskViewModel {
    const dueDate = this.toDate(raw.Due);
    const completed = Boolean(raw.Complete);
    const isOverdue = !completed && dueDate !== null && this.isDateInPast(dueDate);
    const assignment = (raw.Assignment ?? '').trim();
    const assignmentShort = assignment.length > 60 ? assignment.slice(0, 57) + "..." : assignment;

    return {
      PK_ID: Number(raw.PK_ID ?? raw.TaskID ?? 0),
      TaskID: Number(raw.TaskID ?? raw.PK_ID ?? 0),
      CompanyID: raw.CompanyID !== undefined && raw.CompanyID !== null ? Number(raw.CompanyID) : null,
      dueDate,
      assignment,
      assignmentShort,
      assignTo: (raw.AssignTo ?? '').trim(),
      completed,
      notes: (raw.CompleteNotes ?? '').trim(),
      communicationType: this.communicationTypeLookup.get(Number(raw.CommunicationID)) ?? 'General',
      communicationId: raw.CommunicationID !== undefined && raw.CommunicationID !== null ? Number(raw.CommunicationID) : null,
      isOverdue
    };
  }

  private normalizeMeetingRecord(raw: any): MeetingViewModel {
    const attendees = [raw.Attendee1, raw.Attendee2, raw.Attendee3, raw.Attendee4, raw.Attendee5]
      .map((value: any) => (value ?? '').toString().trim())
      .filter(value => value.length > 0);

    const allAttendees = (raw.AllAttendees ?? '').toString().split(',')
      .map((value: string) => value.trim())
      .filter(Boolean);

    return {
      PK_ID: Number(raw.PK_ID ?? raw.MeetingID ?? 0),
      MeetingID: Number(raw.MeetingID ?? raw.PK_ID ?? 0),
      CompanyID: raw.CompanyID !== undefined && raw.CompanyID !== null ? Number(raw.CompanyID) : null,
      subject: (raw.Subject ?? 'Scheduled meeting').trim(),
      description: (raw.Description ?? '').trim(),
      startDate: this.toDate(raw.StartDate ?? raw.Date),
      endDate: this.toDate(raw.EndDate),
      attendees: this.extractUniqueValues([...attendees, ...allAttendees])
    };
  }

  private normalizeTouchRecord(raw: any): CommunicationViewModel {
    const channels: string[] = [];
    if (raw.Conversed) {
      channels.push('Call');
    }
    if (raw.LeftVM) {
      channels.push('Voicemail');
    }
    if (raw.AlsoTexted) {
      channels.push('Text');
    }
    if (raw.AlsoEmailed) {
      channels.push('Email');
    }

    let mode = 'call';
    const hasText = Boolean(raw.AlsoTexted);
    const hasEmail = Boolean(raw.AlsoEmailed);

    if (hasText && hasEmail) {
      mode = 'multi';
    } else if (hasText) {
      mode = 'text';
    } else if (hasEmail) {
      mode = 'email';
    }

    const outcome = raw.Conversed ? 'Connected' : raw.LeftVM ? 'Left voicemail' : 'Attempted';

    return {
      PK_ID: Number(raw.PK_ID ?? raw.TouchID ?? 0),
      TouchID: Number(raw.TouchID ?? raw.PK_ID ?? 0),
      CompanyID: raw.CompanyID !== undefined && raw.CompanyID !== null ? Number(raw.CompanyID) : null,
      date: this.toDate(raw.Date),
      mode,
      communicationType: this.communicationTypeLookup.get(Number(raw.CommunicationID)) ?? 'General',
      notes: (raw.Notes ?? '').trim(),
      outcome,
      channels
    };
  }

  private normalizeInvoiceRecord(raw: any): InvoiceViewModel {
    const projectId = raw.ProjectID !== undefined && raw.ProjectID !== null ? Number(raw.ProjectID) : null;
    const projectDetails = projectId !== null ? this.projectDetailsLookup.get(projectId) ?? null : null;
    const fallbackCompanyId = raw.CompanyID !== undefined && raw.CompanyID !== null ? Number(raw.CompanyID) : null;
    const companyId = projectDetails?.companyId ?? fallbackCompanyId;
    const amount = Number(raw.Fee ?? 0);
    const paidAmount = Number(raw.Paid ?? 0);
    const balance = amount - paidAmount;
    let status = 'Open';
    if (amount === 0 && paidAmount === 0) {
      status = 'Draft';
    } else if (amount < 0) {
      status = 'Credit';
    } else if (paidAmount >= amount && amount > 0) {
      status = 'Paid';
    } else if (paidAmount > 0 && paidAmount < amount) {
      status = 'Partially Paid';
    }

    const processor = (raw.PaymentProcessor ?? "").trim();
    const normalizedProcessor = processor || 'Unspecified';
    const projectDate = projectDetails?.projectDate ?? this.toDate(raw.ProjectDate ?? raw.Date);

    return {
      PK_ID: Number(raw.PK_ID ?? raw.InvoiceID ?? 0),
      InvoiceID: Number(raw.InvoiceID ?? raw.PK_ID ?? 0),
      ProjectID: projectId,
      ServiceID: raw.ServiceID !== undefined && raw.ServiceID !== null ? Number(raw.ServiceID) : null,
      Date: raw.Date ?? null,
      DateValue: this.toDate(raw.Date),
      ProjectDate: projectDate,
      Address: raw.Address ?? "",
      City: raw.City ?? "",
      Zip: raw.Zip ?? "",
      Fee: amount,
      Paid: isNaN(paidAmount) ? null : paidAmount,
      PaymentProcessor: normalizedProcessor,
      InvoiceNotes: raw.InvoiceNotes ?? "",
      StateID: raw.StateID !== undefined && raw.StateID !== null ? Number(raw.StateID) : null,
      Mode: raw.Mode ?? "",
      AddedInvoice: raw.AddedInvoice ?? "",
      CompanyID: companyId,
      CompanyName: this.getCompanyName(companyId),
      AmountLabel: this.formatCurrency(amount),
      BalanceLabel: this.formatCurrency(balance),
      Status: status
    };
  }
  private recalculateCompanyAggregates() {
    this.contactCountByCompany.clear();
    this.contacts.forEach(contact => {
      if (contact.CompanyID !== null) {
        const current = this.contactCountByCompany.get(contact.CompanyID) ?? 0;
        this.contactCountByCompany.set(contact.CompanyID, current + 1);
      }
    });

    this.taskSummaryByCompany.clear();
    this.tasks.forEach(task => {
      if (task.CompanyID === null) {
        return;
      }
      const summary = this.taskSummaryByCompany.get(task.CompanyID) ?? { open: 0, overdue: 0, nextDue: null };
      if (!task.completed) {
        summary.open += 1;
        if (task.isOverdue) {
          summary.overdue += 1;
        }
        if (task.dueDate) {
          if (!summary.nextDue || task.dueDate < summary.nextDue) {
            summary.nextDue = task.dueDate;
          }
        }
      }
      this.taskSummaryByCompany.set(task.CompanyID, summary);
    });

    this.touchSummaryByCompany.clear();
    this.communications.forEach(comm => {
      if (comm.CompanyID === null) {
        return;
      }
      const summary = this.touchSummaryByCompany.get(comm.CompanyID) ?? { total: 0, lastDate: null, label: '', channels: [] as string[] };
      summary.total += 1;
      if (comm.date && (!summary.lastDate || comm.date > summary.lastDate)) {
        summary.lastDate = comm.date;
        const channelSummary = comm.channels.length
          ? comm.channels.join(', ')
          : comm.mode === 'call'
            ? 'Call'
            : comm.mode === 'email'
              ? 'Email'
              : comm.mode === 'text'
                ? 'Text'
                : 'Touch';
        summary.label = `${this.formatShortDate(comm.date)} - ${channelSummary}`;
        summary.channels = comm.channels;
      }
      this.touchSummaryByCompany.set(comm.CompanyID, summary);
    });

    this.meetingSummaryByCompany.clear();
    this.meetings.forEach(meeting => {
      if (meeting.CompanyID === null) {
        return;
      }
      const summary = this.meetingSummaryByCompany.get(meeting.CompanyID) ?? { nextMeeting: null, recentMeeting: null, total: 0 };
      summary.total += 1;
      if (meeting.startDate) {
        if (meeting.startDate >= new Date()) {
          if (!summary.nextMeeting || meeting.startDate < summary.nextMeeting) {
            summary.nextMeeting = meeting.startDate;
          }
        }
        if (!summary.recentMeeting || meeting.startDate > summary.recentMeeting) {
          summary.recentMeeting = meeting.startDate;
        }
      }
      this.meetingSummaryByCompany.set(meeting.CompanyID, summary);
    });

    this.invoiceSummaryByCompany.clear();
    this.invoices.forEach(invoice => {
      if (invoice.CompanyID === null) {
        return;
      }
      const summary = this.invoiceSummaryByCompany.get(invoice.CompanyID) ?? { total: 0, outstanding: 0, paid: 0, invoices: 0 };

      // Only count positive fees (actual invoices) for revenue total, not negative payments
      const fee = invoice.Fee ?? 0;
      if (fee > 0) {
        summary.total += fee;
        summary.invoices = (summary.invoices ?? 0) + 1;

        // Calculate outstanding balance for positive invoices
        const paid = invoice.Paid ?? 0;
        summary.paid += paid;
        const balance = fee - paid;
        if (balance > 0) {
          summary.outstanding += balance;
        }
      } else if (fee < 0) {
        // Negative fees are payments - add to paid amount
        summary.paid += Math.abs(fee);
      }

      this.invoiceSummaryByCompany.set(invoice.CompanyID, summary);
    });
  }

  private ensureSelectedCompany() {
    if (this.selectedCompanyId && this.companies.some(company => company.CompanyID === this.selectedCompanyId)) {
      return;
    }
    const fallback = this.companies[0] ?? null;
    this.selectedCompanyId = fallback?.CompanyID ?? null;
  }

  private updateSelectedCompanySnapshot() {
    if (this.selectedCompanyId === null) {
      this.selectedCompany = null;
      this.companySnapshot = [];
      this.companyStats = [];
      return;
    }

    const record = this.companies.find(company => company.CompanyID === this.selectedCompanyId);
    if (!record) {
      this.selectedCompany = null;
      this.companySnapshot = [];
      this.companyStats = [];
      return;
    }

    const viewModel = this.enrichCompany(record);
    this.selectedCompany = viewModel;

    const primaryContact = this.contacts.find(contact => contact.CompanyID === viewModel.CompanyID && contact.PrimaryContact)
      ?? this.contacts.find(contact => contact.CompanyID === viewModel.CompanyID)
      ?? null;

    const contactEmail = primaryContact?.Email ?? '';
    const addressParts = [viewModel.Address, viewModel.City, viewModel.State, viewModel.Zip].filter(Boolean).join(', ');

    this.companySnapshot = [
      {
        label: 'Stage',
        value: viewModel.StageName || 'No stage',
        icon: 'flag'
      },
      {
        label: 'Primary Contact',
        value: primaryContact ? primaryContact.Name : 'Not assigned',
        icon: 'person-circle',
        hint: contactEmail
      },
      {
        label: 'Phone',
        value: this.formatPhone(viewModel.Phone) || 'No phone on file',
        icon: 'call'
      },
      {
        label: 'Website',
        value: viewModel.Website || 'No website listed',
        icon: 'globe'
      },
      {
        label: 'Address',
        value: addressParts || 'Address not provided',
        icon: 'location'
      }
    ];

    const taskSummary = this.taskSummaryByCompany.get(viewModel.CompanyID) ?? { open: 0, overdue: 0, nextDue: null };
    const touchSummary = this.touchSummaryByCompany.get(viewModel.CompanyID) ?? { total: 0, lastDate: null, label: '', channels: [] };
    const meetingSummary = this.meetingSummaryByCompany.get(viewModel.CompanyID) ?? { nextMeeting: null, recentMeeting: null, total: 0 };
    const invoiceSummary = this.invoiceSummaryByCompany.get(viewModel.CompanyID) ?? { total: 0, outstanding: 0, paid: 0 };

    this.companyStats = [
      {
        title: 'Active Contacts',
        value: String(viewModel.contactCount),
        subtitle: viewModel.contactCount === 1 ? '1 person linked' : `${viewModel.contactCount} people linked`,
        icon: 'people'
      },
      {
        title: 'Open Tasks',
        value: String(taskSummary.open),
        subtitle: taskSummary.overdue ? `${taskSummary.overdue} overdue` : 'On schedule',
        icon: 'checkbox'
      },
      {
        title: 'Last Touch',
        value: touchSummary.label || 'No activity recorded',
        subtitle: `Total touches: ${touchSummary.total}`,
        icon: 'chatbubbles'
      },
      {
        title: 'Upcoming Meeting',
        value: meetingSummary.nextMeeting ? this.formatDate(meetingSummary.nextMeeting) : 'No meetings scheduled',
        subtitle: meetingSummary.recentMeeting ? `Last met ${this.formatDate(meetingSummary.recentMeeting)}` : 'No prior meetings recorded',
        icon: 'calendar'
      },
      {
        title: 'Billing',
        value: this.formatCurrency(invoiceSummary.total),
        subtitle: invoiceSummary.outstanding > 0
          ? `${this.formatCurrency(invoiceSummary.outstanding)} outstanding`
          : invoiceSummary.total > 0
            ? 'All invoices paid'
            : 'No invoices yet',
        icon: 'card'
      }
    ];
  }

  private enrichCompany(company: CompanyRecord): CompanyViewModel {
    const contactCount = this.contactCountByCompany.get(company.CompanyID) ?? 0;
    const taskSummary = this.taskSummaryByCompany.get(company.CompanyID) ?? { open: 0, overdue: 0, nextDue: null };
    const touchSummary = this.touchSummaryByCompany.get(company.CompanyID) ?? { total: 0, lastDate: null, label: '', channels: [] };
    const meetingSummary = this.meetingSummaryByCompany.get(company.CompanyID) ?? { nextMeeting: null, recentMeeting: null, total: 0 };
    const invoiceSummary = this.invoiceSummaryByCompany.get(company.CompanyID) ?? { total: 0, outstanding: 0, paid: 0, invoices: 0 };

    return {
      ...company,
      contactCount,
      openTasks: taskSummary.open,
      overdueTasks: taskSummary.overdue,
      totalTouches: touchSummary.total,
      lastTouchLabel: touchSummary.label || 'No recent activity',
      lastTouchDate: touchSummary.lastDate,
      upcomingMeetingDate: meetingSummary.nextMeeting,
      invoiceTotals: {
        total: invoiceSummary.total,
        outstanding: invoiceSummary.outstanding,
        paid: invoiceSummary.paid,
        invoices: invoiceSummary.invoices
      }
    };
  }

  private matchesCompanyFilters(company: CompanyRecord): boolean {
    if (company.CompanyID === this.excludedCompanyId) {
      return false;
    }

    const searchTerm = this.companyFilters.search.trim().toLowerCase();
    if (searchTerm) {
      const haystack = [
        company.CompanyName,
        company.City,
        company.State,
        company.Address,
        company.ServiceArea,
        company.LeadSource
      ].join(' ').toLowerCase();
      if (!haystack.includes(searchTerm)) {
        return false;
      }
    }

    if (this.companyFilters.stage !== 'all') {
      const stageId = Number(this.companyFilters.stage);
      const companyStage = company.StageID ?? 0;
      if (companyStage !== stageId) {
        return false;
      }
    }

    if (this.companyFilters.size !== 'all') {
      if (!company.SizeLabel || company.SizeLabel !== this.companyFilters.size) {
        return false;
      }
    }

    if (this.companyFilters.leadSource !== 'all') {
      if (!company.LeadSource || company.LeadSource !== this.companyFilters.leadSource) {
        return false;
      }
    }

    if (this.companyFilters.onlyFranchise && !company.Franchise) {
      return false;
    }

    if (this.companyFilters.hasNotes && !company.Notes) {
      return false;
    }

    return true;
  }

  private parseStageOrder(name: string, fallback?: number): number {
    const match = name?.match?.(/^(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
    if (fallback !== undefined && fallback !== null) {
      return Number(fallback);
    }
    return 999;
  }

  private extractListLabel(value: any): string {
    if (!value) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'object') {
      const entries = Object.values(value);
      if (entries.length > 0 && typeof entries[0] === 'string') {
        return entries[0];
      }
    }
    return '';
  }

  /** Extract label from a Caspio List-String object and store label→key in sizeLabelToKeyMap */
  private extractSizeLabel(value: any): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length > 0 && typeof value[keys[0]] === 'string') {
        const key = keys[0];
        const label = value[key];
        this.sizeLabelToKeyMap.set(label, key);
        return label;
      }
    }
    return '';
  }

  private extractUniqueValues(values: (string | null | undefined)[]): string[] {
    return Array.from(new Set(values
      .map(value => (value ?? '').toString().trim())
      .filter(value => value.length > 0)))
      .sort((a, b) => a.localeCompare(b));
  }

  private normalizeUrl(value: string): string {
    if (!value) {
      return '';
    }
    if (/^https?:\/\//i.test(value)) {
      return value;
    }
    return `https://${value}`;
  }

  private toDate(value: any): Date | null {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  private isDateInPast(date: Date): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const compareDate = new Date(date);
    compareDate.setHours(0, 0, 0, 0);
    return compareDate.getTime() < today.getTime();
  }

  private formatShortDate(value: Date | string | null | undefined): string {
    const date = value instanceof Date ? value : value ? new Date(value) : null;
    if (!date || isNaN(date.getTime())) {
      return '—';
    }
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }

  private async showToast(message: string, color: string) {
    if (color === 'success' || color === 'info') return;
    const toast = await this.toastController.create({
      message,
      duration: 2500,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  private async fetchTableRecords(tableName: string, params: Record<string, string> = {}, skipCache: boolean = false): Promise<any[]> {
    // Normalize table name to include LPS_ prefix if not already present
    const normalizedTableName = tableName.startsWith('LPS_') ? tableName : `LPS_${tableName}`;

    const searchParams = new URLSearchParams(params);
    const query = searchParams.toString();
    const endpoint = `/tables/${normalizedTableName}/records${query ? `?${query}` : ''}`;

    // Use caspioService.get() which routes through AWS when useApiGateway is true
    // skipCache=true bypasses mobile cache after mutations (add/delete/update)
    const response = await firstValueFrom(this.caspioService.get<any>(endpoint, !skipCache));
    return response?.Result ?? [];
  }

  /**
   * Execute an array of async functions in chunks to avoid overwhelming the API
   * @param tasks Array of functions that return promises
   * @param chunkSize Number of tasks to execute concurrently (default: 3)
   * @param delayMs Delay between chunks in milliseconds (default: 100)
   */
  private async executeInChunks<T>(
    tasks: (() => Promise<T>)[],
    chunkSize: number = 3,
    delayMs: number = 100
  ): Promise<T[]> {
    const results: T[] = [];

    for (let i = 0; i < tasks.length; i += chunkSize) {
      const chunk = tasks.slice(i, i + chunkSize);
      const chunkResults = await Promise.all(chunk.map(task => task()));
      results.push(...chunkResults);

      // Add a small delay between chunks to avoid rate limiting
      if (i + chunkSize < tasks.length && delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return results;
  }

  /**
   * Get a date string for filtering records (X days ago)
   * @param daysAgo Number of days in the past
   */
  private getDateFilter(daysAgo: number): string {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    // Format as MM/DD/YYYY for Caspio
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  }

  private async fetchAllTableRecords(tableName: string, params: Record<string, string> = {}): Promise<any[]> {
    const allRecords: any[] = [];
    let pageIndex = 1;
    const pageSize = 1000;
    let hasMoreRecords = true;


    while (hasMoreRecords) {
      const paginatedParams = {
        ...params,
        'q.pageSize': pageSize.toString(),
        'q.pageIndex': pageIndex.toString()
      };

      const records = await this.fetchTableRecords(tableName, paginatedParams);

      if (records && records.length > 0) {
        allRecords.push(...records);

        if (records.length < pageSize) {
          hasMoreRecords = false;
        } else {
          pageIndex++;
        }
      } else {
        hasMoreRecords = false;
      }
    }

    return allRecords;
  }

  async requestAccountDeletion() {
    const result = await this.confirmationDialog.confirm({
      header: 'Delete Account',
      message: 'Are you sure you want to delete your account? This action cannot be undone.',
      confirmText: 'Yes, Delete',
      cancelText: 'Cancel'
    });

    if (result.confirmed) {
      const alert = await this.alertController.create({
        header: 'Request Received',
        message: 'The admin team will reach out to you to complete the account deletion process.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  async logout() {
    const result = await this.confirmationDialog.confirm({
      header: 'Confirm Logout',
      message: 'Are you sure you want to logout?',
      confirmText: 'Logout',
      cancelText: 'Cancel'
    });

    if (result.confirmed) {
      // G2-SEC-002: Clear all auth data on logout
      localStorage.removeItem('authToken');
      localStorage.removeItem('currentUser');
      localStorage.removeItem('caspio_token');
      localStorage.removeItem('caspio_token_expiry');
      localStorage.removeItem('cognito_access_token');
      localStorage.removeItem('cognito_id_token');

      // Navigate to login
      this.router.navigate(['/login']);
    }
  }

  // --- Notification Methods ---

  private loadNotificationSettings() {
    this.apiGateway.get('/api/notifications/settings').subscribe({
      next: (res: any) => {
        this.globalNotifServiceComplete = res.serviceComplete !== false;
        this.globalNotifPaymentReceived = res.paymentReceived !== false;
      },
      error: () => {} // Defaults already set to true
    });
  }

  toggleGlobalNotif(type: string) {
    if (type === 'service_complete') {
      this.globalNotifServiceComplete = !this.globalNotifServiceComplete;
    } else if (type === 'payment_received') {
      this.globalNotifPaymentReceived = !this.globalNotifPaymentReceived;
    }
    this.apiGateway.post('/api/notifications/settings', {
      serviceComplete: this.globalNotifServiceComplete,
      paymentReceived: this.globalNotifPaymentReceived,
    }).subscribe({
      error: (err: any) => console.error('Failed to save notification settings', err)
    });
  }

  setNotifTarget(type: 'all' | 'company' | 'user') {
    this.notifTargetType = type;
    this.notifTargetSearch = '';
    this.notifTargetId = null;
    this.notifTargetSuggestions = [];
  }

  filterNotifTargets() {
    const query = this.notifTargetSearch.toLowerCase().trim();
    if (!query || query.length < 2) {
      this.notifTargetSuggestions = [];
      return;
    }

    if (this.notifTargetType === 'company') {
      this.notifTargetSuggestions = this.allCompaniesForNotif
        .filter(c => c.CompanyName?.toLowerCase().includes(query))
        .slice(0, 8)
        .map(c => ({ id: String(c.CompanyID), label: c.CompanyName }));
    } else {
      this.notifTargetSuggestions = this.allUsers
        .filter(u => {
          const name = (u.Name || `${u.First || ''} ${u.Last || ''}`).toLowerCase();
          const email = (u.Email || '').toLowerCase();
          return name.includes(query) || email.includes(query);
        })
        .slice(0, 8)
        .map(u => ({
          id: String(u.PK_ID || u.UserID),
          label: `${u.Name || `${u.First || ''} ${u.Last || ''}`} (${u.Email || ''})`
        }));
    }
  }

  selectNotifTarget(item: {id: string, label: string}) {
    this.notifTargetId = item.id;
    this.notifTargetSearch = item.label;
    this.notifTargetSuggestions = [];
  }

  canSendNotification(): boolean {
    if (!this.notifTitle.trim() || !this.notifBody.trim()) return false;
    if (this.notifTargetType !== 'all' && !this.notifTargetId) return false;
    return true;
  }

  async sendNotification() {
    if (!this.canSendNotification() || this.notifSending) return;
    this.notifSending = true;

    const payload: any = {
      title: this.notifTitle.trim(),
      body: this.notifBody.trim(),
      data: { type: 'admin_message' }
    };

    let targetLabel = 'All devices';
    if (this.notifTargetType === 'all') {
      payload.broadcast = true;
    } else if (this.notifTargetType === 'company') {
      payload.companyId = this.notifTargetId;
      targetLabel = `Company: ${this.notifTargetSearch}`;
    } else {
      payload.targetUserId = this.notifTargetId;
      targetLabel = `User: ${this.notifTargetSearch}`;
    }

    try {
      const result: any = await firstValueFrom(this.apiGateway.post('/api/notifications/send', payload));

      this.notifHistory.unshift({
        title: this.notifTitle,
        body: this.notifBody,
        targetLabel,
        time: new Date(),
        success: true,
        sent: result?.sent || 0
      });

      const toast = await this.toastController.create({
        message: `Notification sent to ${result?.sent || 0} device(s)`,
        duration: 2000,
        color: 'success',
        position: 'top'
      });
      await toast.present();

      this.notifTitle = '';
      this.notifBody = '';
    } catch (err: any) {
      this.notifHistory.unshift({
        title: this.notifTitle,
        body: this.notifBody,
        targetLabel,
        time: new Date(),
        success: false,
        sent: 0
      });

      const toast = await this.toastController.create({
        message: `Failed to send: ${err.message || 'Unknown error'}`,
        duration: 3000,
        color: 'danger',
        position: 'top'
      });
      await toast.present();
    } finally {
      this.notifSending = false;
    }
  }
}
