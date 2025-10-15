
import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, LoadingController, ToastController } from '@ionic/angular';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
import { CaspioService } from '../../services/caspio.service';
import { environment } from '../../../environments/environment';
import { firstValueFrom } from 'rxjs';

interface StageDefinition {
  id: number;
  name: string;
  sortOrder: number;
}

interface ProjectMetadata {
  companyId: number | null;
  projectDate: Date | null;
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
}

interface PaidInvoiceGroup {
  companyId: number | null;
  companyName: string;
  items: InvoicePair[];
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
  organizationUsers: any[] = [];

  selectedTab: 'companies' | 'contacts' | 'tasks' | 'meetings' | 'communications' | 'invoices' | 'metrics' = 'companies';

  isLoading = false;
  isInitialLoad = true;
  isProcessingTab = false;

  companies: CompanyRecord[] = [];
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
  invoicesPerPage = 150;
  currentInvoicePage = 1;
  totalInvoicePages = 1;
  invoiceMetrics: InvoiceTotals = { total: 0, outstanding: 0, paid: 0 };
  visibleInvoiceCount = 0;

  private stageLookup = new Map<number, StageDefinition>();
  private companyNameLookup = new Map<number, string>();
  private projectDetailsLookup = new Map<number, ProjectMetadata>();
  private contactCountByCompany = new Map<number, number>();
  private taskSummaryByCompany = new Map<number, { open: number; overdue: number; nextDue: Date | null }>();
  private touchSummaryByCompany = new Map<number, { total: number; lastDate: Date | null; label: string; channels: string[] }>();
  private meetingSummaryByCompany = new Map<number, { nextMeeting: Date | null; recentMeeting: Date | null; total: number }>();
  private invoiceSummaryByCompany = new Map<number, InvoiceTotals>();
  private communicationTypeLookup = new Map<number, string>();
  private readonly excludedCompanyId = 1;

  uniqueCompanySizes: string[] = [];
  uniqueLeadSources: string[] = [];

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
  newContact: any = {
    CompanyID: null,
    Name: '',
    Title: '',
    Goal: '',
    Role: '',
    Email: '',
    Phone1: '',
    Phone2: '',
    PrimaryContact: false,
    Notes: ''
  };

  editingCompany: any = null;
  isEditModalOpen = false;

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
    Contract: '',
    Notes: ''
  };

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

  constructor(
    private caspioService: CaspioService,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private http: HttpClient
  ) {}

  ngOnInit() {
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

    // Load appropriate data based on company
    if (this.isCompanyOne) {
      this.loadCompanyData();
    } else {
      this.loadOrganizationUsers();
    }
  }

  async loadOrganizationUsers() {
    this.isLoading = true;
    try {
      // Load users from the Users table filtered by the current user's CompanyID
      const response = await firstValueFrom(
        this.caspioService.get<any>(`/tables/Users/records?q.where=CompanyID=${this.currentUserCompanyId}`)
      );

      if (response && response.Result) {
        this.organizationUsers = response.Result;
      }
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

  async loadCompanyData(showSpinner: boolean = true) {
    let loading: HTMLIonLoadingElement | null = null;
    try {
      if (showSpinner) {
        loading = await this.loadingController.create({
          message: this.isInitialLoad ? 'Loading CRM data...' : 'Refreshing data...',
          spinner: 'lines'
        });
        await loading.present();
      }

      this.isLoading = true;

      const [
        stageRecords,
        companyRecords,
        contactRecords,
        taskRecords,
        touchRecords,
        meetingRecords,
        invoiceRecords,
        projectRecords,
        communicationRecords
      ] = await Promise.all([
        this.fetchTableRecords('Stage', { 'q.orderBy': 'StageID', 'q.limit': '2000' }),
        this.fetchTableRecords('Companies', { 'q.orderBy': 'CompanyName', 'q.limit': '2000' }),
        this.fetchTableRecords('Contacts', { 'q.orderBy': 'CompanyID,Name', 'q.limit': '2000' }),
        this.fetchTableRecords('Tasks', { 'q.orderBy': 'Due DESC', 'q.limit': '2000' }),
        this.fetchTableRecords('Touches', { 'q.orderBy': 'Date DESC', 'q.limit': '2000' }),
        this.fetchTableRecords('Meetings', { 'q.orderBy': 'StartDate DESC', 'q.limit': '2000' }),
        this.fetchTableRecords('Invoices', { 'q.orderBy': 'Date DESC', 'q.limit': '2000' }),
        this.fetchTableRecords('Projects', { 'q.select': 'ProjectID,CompanyID,Date', 'q.limit': '2000' }),
        this.fetchTableRecords('Communication', { 'q.orderBy': 'CommunicationID', 'q.limit': '2000' })
      ]);

      this.populateStageDefinitions(stageRecords);
      this.populateCommunicationTypes(communicationRecords);
      this.populateProjectLookup(projectRecords);

      const filteredCompanyRecords = companyRecords.filter(record => {
        const id = Number(record.CompanyID ?? record.PK_ID ?? 0);
        return id !== this.excludedCompanyId;
      });

      this.companies = filteredCompanyRecords.map(record => this.normalizeCompanyRecord(record));
      this.companyNameLookup.clear();
      this.companies.forEach(company => this.companyNameLookup.set(company.CompanyID, company.CompanyName));

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

      this.recalculateCompanyAggregates();

      this.applyCompanyFilters();
      this.applyContactFilters();
      this.applyTaskFilters();
      this.applyMeetingFilters();
      this.applyCommunicationFilters();
      this.categorizeInvoices();
      this.updateSelectedCompanySnapshot();
    } catch (error: any) {
      console.error('Error loading company data:', error);
      await this.showToast(error?.message ?? 'Unable to load company data', 'danger');
    } finally {
      if (loading) {
        await loading.dismiss();
      }
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
  }

  openContactModal(contact: ContactRecord) {
    this.selectedContact = contact;
    this.isContactModalOpen = true;
  }

  closeContactModal() {
    this.isContactModalOpen = false;
    this.selectedContact = null;
  }

  async openAddContactModal() {
    // Reset the contact with default values, pre-fill company if filter is applied
    this.newContact = {
      CompanyID: this.globalCompanyFilterId,
      Name: '',
      Title: '',
      Goal: '',
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
      Contract: '',
      Notes: ''
    };

    this.isAddCompanyModalOpen = true;
  }

  closeAddCompanyModal() {
    this.isAddCompanyModalOpen = false;
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
        Franchise: this.newCompany.Franchise ? 1 : 0
      };

      // Add optional fields if provided
      if (this.newCompany.DateOnboarded && this.newCompany.DateOnboarded.trim() !== '') {
        payload.DateOnboarded = new Date(this.newCompany.DateOnboarded).toISOString();
      }

      if (this.newCompany['Onboarding Stage'] && this.newCompany['Onboarding Stage'].trim() !== '') {
        payload['Onboarding Stage'] = this.newCompany['Onboarding Stage'].trim();
      }

      if (this.newCompany.SoftwareID && this.newCompany.SoftwareID.trim() !== '') {
        payload.SoftwareID = this.newCompany.SoftwareID.trim();
      }

      if (this.newCompany.Size && this.newCompany.Size.trim() !== '') {
        payload.Size = this.newCompany.Size.trim();
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

      if (this.newCompany.Contract && this.newCompany.Contract.trim() !== '') {
        payload.Contract = this.newCompany.Contract.trim();
      }

      if (this.newCompany.Notes && this.newCompany.Notes.trim() !== '') {
        payload.Notes = this.newCompany.Notes.trim();
      }

      console.log('Creating company with payload:', payload);

      // Create the company via Caspio API
      const response = await firstValueFrom(
        this.caspioService.post('/tables/Companies/records', payload)
      );

      console.log('Company created successfully:', response);

      // Reload companies data to include the new company
      const companyRecords = await this.fetchTableRecords('Companies', { 'q.orderBy': 'CompanyName', 'q.limit': '2000' });
      const filteredCompanyRecords = companyRecords.filter(record => {
        const id = Number(record.CompanyID ?? record.PK_ID ?? 0);
        return id !== this.excludedCompanyId;
      });

      this.companies = filteredCompanyRecords.map(record => this.normalizeCompanyRecord(record));
      this.companyNameLookup.clear();
      this.companies.forEach(company => this.companyNameLookup.set(company.CompanyID, company.CompanyName));

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

      if (this.newContact.Goal && this.newContact.Goal.trim() !== '') {
        payload.Goal = this.newContact.Goal.trim();
      }

      if (this.newContact.Notes && this.newContact.Notes.trim() !== '') {
        payload.Notes = this.newContact.Notes.trim();
      }

      console.log('Creating contact with payload:', payload);

      // Create the contact via Caspio API
      const response = await firstValueFrom(
        this.caspioService.post('/tables/Contacts/records', payload)
      );

      console.log('Contact created successfully:', response);

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

      console.log('Creating task with payload:', payload);

      // Create the task via Caspio API
      const response = await firstValueFrom(
        this.caspioService.post('/tables/Tasks/records', payload)
      );

      console.log('Task created successfully:', response);

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
          `/tables/Tasks/records?q.where=TaskID=${this.editingTask.TaskID}`,
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

    // Confirm deletion
    const confirmDelete = confirm(`Are you sure you want to delete this task: "${task.assignmentShort}"?`);
    if (!confirmDelete) {
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Deleting task...',
      spinner: 'lines'
    });
    await loading.present();

    try {
      // Delete via Caspio API
      await firstValueFrom(
        this.caspioService.delete(`/tables/Tasks/records?q.where=TaskID=${task.TaskID}`)
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

  selectTab(tab: string) {
    // Instant tab switching - no data processing
    this.selectedTab = tab as any;

    // Only load data if it hasn't been loaded yet for this tab
    if (!this.tabDataLoaded[tab]) {
      this.loadTabData(tab);
      this.tabDataLoaded[tab] = true;
    }
  }

  private tabDataLoaded: {[key: string]: boolean} = {
    companies: true, // Already loaded on init
    contacts: false,
    tasks: false,
    meetings: false,
    communications: false,
    invoices: false,
    metrics: false
  };

  private loadTabData(tab: string) {
    // Load data asynchronously without blocking UI
    requestAnimationFrame(() => {
      switch (tab) {
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
          // Metrics tab - placeholder for future implementation
          break;
      }
    });
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
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    this.filteredTasks = this.tasks.filter(task => {
      // Global company filter
      if (this.globalCompanyFilterId !== null && task.CompanyID !== this.globalCompanyFilterId) {
        return false;
      }

      // Timeframe filtering
      if (timeframeFilter === 'overdue') {
        // Show only overdue tasks (past due date and not completed)
        if (!task.dueDate || task.dueDate >= now || task.completed) {
          return false;
        }
      } else if (timeframeFilter === 'past') {
        if (!task.dueDate || task.dueDate > now) {
          return false;
        }
      } else if (timeframeFilter === '7day') {
        if (!task.dueDate || task.dueDate < now || task.dueDate > sevenDaysFromNow) {
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
          '/tables/Tasks/records?q.where=TaskID=' + task.TaskID,
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
          netAmount: projectNetAmount // Sum of all invoices for this ProjectID
        };

        if (hasPayments) {
          // If there's any payment, it goes to paid
          paidPairs.push(pair);
        } else if (totalPositiveAmount > 0) {
          // No payments but has positive invoices
          const projectHasOccurred = projectDate ? projectDate <= today : true;
          if (!projectHasOccurred && projectNetAmount > 0) {
            // Future/active project with amount due > 0 - goes to Open
            open.push(pair);
          } else if (projectHasOccurred && projectNetAmount > 0) {
            // Past project without payment and amount due > 0 - goes to Unpaid
            unpaid.push(pair);
          }
          // If projectNetAmount <= 0, don't include in any category
        }
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

    // Calculate total pages based on the category with most items
    const maxInvoices = Math.max(
      this.openInvoices.length,
      this.unpaidInvoices.length,
      this.paidInvoiceGroups.length
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

  formatCurrency(value: number | string | null | undefined): string {
    const amount = typeof value === 'number' ? value : Number(value ?? 0);
    if (isNaN(amount)) {
      return '$0.00';
    }
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount);
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

  editCompany(company: CompanyViewModel, event: Event): void {
    event.stopPropagation();
    // Create a clean copy with only database fields (exclude computed view model fields)
    this.editingCompany = {
      PK_ID: company.PK_ID,
      CompanyID: company.CompanyID,
      StageID: company.StageID,
      StageName: company.StageName,
      CompanyName: company.CompanyName,
      SizeLabel: company.SizeLabel,
      Size: company.Size,
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
      Contract: company.Contract
    };
    this.isEditModalOpen = true;
  }

  closeEditModal(): void {
    this.isEditModalOpen = false;
    this.editingCompany = null;
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
      // Build payload with only valid database fields
      // Only include fields that should be updated
      const payload: any = {};

      // Basic company fields - send as-is (allow empty strings for clearing fields)
      if (this.editingCompany.CompanyName !== undefined && this.editingCompany.CompanyName !== null) {
        payload.CompanyName = this.editingCompany.CompanyName;
      }

      if (this.editingCompany.DateOnboarded !== undefined && this.editingCompany.DateOnboarded !== null) {
        payload.DateOnboarded = this.editingCompany.DateOnboarded;
      }

      if (this.editingCompany.Size !== undefined && this.editingCompany.Size !== null) {
        payload.Size = this.editingCompany.Size;
      }

      // IMPORTANT: Franchise must be a number (0 or 1) for Caspio boolean fields
      if (this.editingCompany.Franchise !== undefined && this.editingCompany.Franchise !== null) {
        payload.Franchise = (this.editingCompany.Franchise === true || this.editingCompany.Franchise === 1) ? 1 : 0;
      }

      if (this.editingCompany.LeadSource !== undefined && this.editingCompany.LeadSource !== null) {
        payload.LeadSource = this.editingCompany.LeadSource;
      }

      // Contact fields
      if (this.editingCompany.Phone !== undefined && this.editingCompany.Phone !== null) {
        payload.Phone = this.editingCompany.Phone;
      }

      if (this.editingCompany.Email !== undefined && this.editingCompany.Email !== null) {
        payload.Email = this.editingCompany.Email;
      }

      // CC_Email field
      if (this.editingCompany.CC_Email !== undefined && this.editingCompany.CC_Email !== null) {
        payload.CC_Email = this.editingCompany.CC_Email;
      }

      if (this.editingCompany.Website !== undefined && this.editingCompany.Website !== null) {
        payload.Website = this.editingCompany.Website;
      }

      // Address fields
      if (this.editingCompany.Address !== undefined && this.editingCompany.Address !== null) {
        payload.Address = this.editingCompany.Address;
      }

      if (this.editingCompany.City !== undefined && this.editingCompany.City !== null) {
        payload.City = this.editingCompany.City;
      }

      if (this.editingCompany.State !== undefined && this.editingCompany.State !== null) {
        payload.State = this.editingCompany.State;
      }

      if (this.editingCompany.Zip !== undefined && this.editingCompany.Zip !== null) {
        payload.Zip = this.editingCompany.Zip;
      }

      // Additional fields
      if (this.editingCompany.ServiceArea !== undefined && this.editingCompany.ServiceArea !== null) {
        payload.ServiceArea = this.editingCompany.ServiceArea;
      }

      if (this.editingCompany.Notes !== undefined && this.editingCompany.Notes !== null) {
        payload.Notes = this.editingCompany.Notes;
      }

      if (this.editingCompany.Contract !== undefined && this.editingCompany.Contract !== null) {
        payload.Contract = this.editingCompany.Contract;
      }

      if (this.editingCompany.SoftwareID !== undefined && this.editingCompany.SoftwareID !== null) {
        payload.SoftwareID = this.editingCompany.SoftwareID;
      }

      // CRITICAL FIX: Try field name without space - Caspio typically doesn't allow spaces in field names
      // The actual field name is likely "OnboardingStage" not "Onboarding Stage"
      if (this.editingCompany['Onboarding Stage'] !== undefined && this.editingCompany['Onboarding Stage'] !== null) {
        // Try without space first (more likely to be correct)
        payload.OnboardingStage = this.editingCompany['Onboarding Stage'];
      }

      console.log('=== Company Update Debug Info ===');
      console.log('Company ID:', this.editingCompany.CompanyID);
      console.log('Payload being sent:', JSON.stringify(payload, null, 2));
      console.log('Payload field count:', Object.keys(payload).length);

      // Update via Caspio API
      const response = await firstValueFrom(
        this.caspioService.put(
          `/tables/Companies/records?q.where=CompanyID=${this.editingCompany.CompanyID}`,
          payload
        )
      );

      console.log('Update successful! Response:', response);

      // Update local data
      const index = this.companies.findIndex(c => c.CompanyID === this.editingCompany.CompanyID);
      if (index !== -1) {
        // Merge the updated fields into the existing company record
        this.companies[index] = {
          ...this.companies[index],
          ...this.editingCompany
        };
      }

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

  trackByStage = (_: number, group: StageGroup) => group.stage.id;

  trackByCompany = (_: number, company: CompanyViewModel) => company.CompanyID;

  trackByContactGroup = (index: number, group: ContactGroup) =>
    group.companyId !== null ? group.companyId : -1 - index;

  trackByContact = (_: number, contact: ContactRecord) => contact.ContactID;

  trackByTask = (_: number, task: TaskViewModel) => task.TaskID;

  ngOnDestroy() {
    if (this.contactSearchDebounce) {
      clearTimeout(this.contactSearchDebounce);
      this.contactSearchDebounce = null;
    }
    if (this.companySearchDebounce) {
      clearTimeout(this.companySearchDebounce);
      this.companySearchDebounce = null;
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
      this.projectDetailsLookup.set(projectId, { companyId, projectDate });
    });
  }

  private normalizeCompanyRecord(raw: any): CompanyRecord {
    const stageId = raw.StageID !== undefined && raw.StageID !== null ? Number(raw.StageID) : null;
    const stageName = stageId !== null ? this.stageLookup.get(stageId)?.name ?? 'No Stage' : 'No Stage';

    return {
      PK_ID: Number(raw.PK_ID ?? raw.CompanyID ?? 0),
      CompanyID: Number(raw.CompanyID ?? raw.PK_ID ?? 0),
      StageID: stageId,
      StageName: stageName,
      CompanyName: raw.CompanyName ?? 'Unnamed Company',
      SizeLabel: this.extractListLabel(raw.Size),
      ServiceArea: raw.ServiceArea ?? '',
      LeadSource: raw.LeadSource ?? '',
      Phone: raw.Phone ?? '',
      Email: raw.Email ?? '',
      Website: this.normalizeUrl(raw.Website ?? ''),
      Address: raw.Address ?? '',
      City: raw.City ?? '',
      State: raw.State ?? '',
      Zip: raw.Zip ?? '',
      Notes: raw.Notes ?? '',
      Franchise: Boolean(raw.Franchise),
      DateOnboarded: raw.DateOnboarded ?? '',
      CCEmail: raw.CC_Email ?? raw.CCEmail ?? ''
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
    return date.getTime() < today.getTime();
  }

  private formatShortDate(value: Date | string | null | undefined): string {
    const date = value instanceof Date ? value : value ? new Date(value) : null;
    if (!date || isNaN(date.getTime())) {
      return '—';
    }
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
  }

  private async showToast(message: string, color: string) {
    const toast = await this.toastController.create({
      message,
      duration: 2500,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  private async fetchTableRecords(tableName: string, params: Record<string, string> = {}): Promise<any[]> {
    const token = await this.caspioService.getAuthToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    const headers = new HttpHeaders({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    });

    const searchParams = new URLSearchParams(params);
    const query = searchParams.toString();
    const url = `${environment.caspio.apiBaseUrl}/tables/${tableName}/records${query ? `?${query}` : ''}`;

    const response = await firstValueFrom(this.http.get<any>(url, { headers }));
    return response?.Result ?? [];
  }
}
