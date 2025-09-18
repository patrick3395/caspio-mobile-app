
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, LoadingController, ToastController } from '@ionic/angular';
import { HttpClient, HttpClientModule, HttpHeaders } from '@angular/common/http';
import { CaspioService } from '../../services/caspio.service';
import { environment } from '../../../environments/environment';

interface StageDefinition {
  id: number;
  name: string;
  sortOrder: number;
}

interface CompanyRecord {
  PK_ID: number;
  CompanyID: number;
  StageID: number | null;
  StageName: string;
  CompanyName: string;
  SizeLabel: string;
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
  Role: string;
  Email: string;
  Phone1: string;
  Phone2: string;
  PrimaryContact: boolean;
  Notes: string;
}

interface TaskViewModel {
  PK_ID: number;
  TaskID: number;
  CompanyID: number | null;
  dueDate: Date | null;
  dueLabel: string;
  assignment: string;
  assignTo: string;
  completed: boolean;
  notes: string;
  communicationType: string;
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
@Component({
  selector: 'app-company',
  templateUrl: './company.page.html',
  styleUrls: ['./company.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, HttpClientModule]
})
export class CompanyPage implements OnInit {
  selectedTab: 'companies' | 'contacts' | 'tasks' | 'meetings' | 'communications' | 'invoices' = 'companies';

  isLoading = false;
  isInitialLoad = true;

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

  selectedCompanyId: number | null = 1;
  selectedCompany: CompanyViewModel | null = null;
  companySnapshot: SnapshotItem[] = [];
  companyStats: StatItem[] = [];

  contacts: ContactRecord[] = [];
  filteredContacts: ContactRecord[] = [];
  contactFilters = {
    search: '',
    companyScope: 'selected',
    role: 'all',
    showPrimaryOnly: false
  };
  uniqueContactRoles: string[] = [];

  tasks: TaskViewModel[] = [];
  filteredTasks: TaskViewModel[] = [];
  taskFilters = {
    search: '',
    status: 'all',
    assignedTo: 'all',
    scope: 'selected',
    overdueOnly: false
  };
  taskAssignees: string[] = [];
  taskMetrics = { total: 0, completed: 0, outstanding: 0, overdue: 0 };

  meetings: MeetingViewModel[] = [];
  filteredMeetings: MeetingViewModel[] = [];
  meetingFilters = {
    search: '',
    scope: 'selected',
    timeframe: 'upcoming'
  };

  communications: CommunicationViewModel[] = [];
  filteredCommunications: CommunicationViewModel[] = [];
  communicationFilters = {
    search: '',
    scope: 'selected',
    type: 'all',
    mode: 'all',
    onlyResponses: false
  };
  communicationTypes: string[] = [];

  invoices: InvoiceViewModel[] = [];
  filteredInvoices: InvoiceViewModel[] = [];
  invoiceFilters = {
    search: '',
    scope: 'selected',
    status: 'all',
    paymentProcessor: 'all'
  };
  invoiceMetrics: InvoiceTotals = { total: 0, outstanding: 0, paid: 0 };
  paymentProcessors: string[] = [];

  private stageLookup = new Map<number, StageDefinition>();
  private companyNameLookup = new Map<number, string>();
  private projectCompanyLookup = new Map<number, number>();
  private contactCountByCompany = new Map<number, number>();
  private taskSummaryByCompany = new Map<number, { open: number; overdue: number; nextDue: Date | null }>();
  private touchSummaryByCompany = new Map<number, { total: number; lastDate: Date | null; label: string; channels: string[] }>();
  private meetingSummaryByCompany = new Map<number, { nextMeeting: Date | null; recentMeeting: Date | null; total: number }>();
  private invoiceSummaryByCompany = new Map<number, InvoiceTotals>();
  private communicationTypeLookup = new Map<number, string>();

  uniqueCompanySizes: string[] = [];
  uniqueLeadSources: string[] = [];
  constructor(
    private caspioService: CaspioService,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private http: HttpClient
  ) {}

  ngOnInit() {
    this.loadCompanyData();
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
        this.fetchTableRecords('Stage', { 'q.orderBy': 'StageID', 'q.limit': '1000' }),
        this.fetchTableRecords('Companies', { 'q.orderBy': 'CompanyName', 'q.limit': '1000' }),
        this.fetchTableRecords('Contacts', { 'q.orderBy': 'Name', 'q.limit': '1000' }),
        this.fetchTableRecords('Tasks', { 'q.orderBy': 'Due DESC', 'q.limit': '1000' }),
        this.fetchTableRecords('Touches', { 'q.orderBy': 'Date DESC', 'q.limit': '1000' }),
        this.fetchTableRecords('Meetings', { 'q.orderBy': 'StartDate DESC', 'q.limit': '1000' }),
        this.fetchTableRecords('Invoices', { 'q.orderBy': 'Date DESC', 'q.limit': '1000' }),
        this.fetchTableRecords('Projects', { 'q.select': 'ProjectID,CompanyID,Address,City,StateID,Zip,Date', 'q.limit': '1000' }),
        this.fetchTableRecords('Communication', { 'q.orderBy': 'CommunicationID', 'q.limit': '1000' })
      ]);

      this.populateStageDefinitions(stageRecords);
      this.populateCommunicationTypes(communicationRecords);
      this.populateProjectLookup(projectRecords);

      this.companies = companyRecords.map(record => this.normalizeCompanyRecord(record));
      this.companyNameLookup.clear();
      this.companies.forEach(company => this.companyNameLookup.set(company.CompanyID, company.CompanyName));

      this.uniqueCompanySizes = this.extractUniqueValues(this.companies.map(company => company.SizeLabel));
      this.uniqueLeadSources = this.extractUniqueValues(this.companies.map(company => company.LeadSource));

      this.ensureSelectedCompany();

      this.contacts = contactRecords.map(record => this.normalizeContactRecord(record));
      this.uniqueContactRoles = this.extractUniqueValues(this.contacts.map(contact => contact.Role).filter(Boolean));

      this.tasks = taskRecords.map(record => this.normalizeTaskRecord(record));
      this.taskAssignees = this.extractUniqueValues(this.tasks.map(task => task.assignTo).filter(Boolean));

      this.meetings = meetingRecords.map(record => this.normalizeMeetingRecord(record));
      this.communications = touchRecords.map(record => this.normalizeTouchRecord(record));
      this.communicationTypes = this.extractUniqueValues(this.communications.map(comm => comm.communicationType).filter(Boolean));

      this.invoices = invoiceRecords.map(record => this.normalizeInvoiceRecord(record));
      this.paymentProcessors = this.extractUniqueValues(this.invoices.map(invoice => invoice.PaymentProcessor || 'Unspecified'));

      this.recalculateCompanyAggregates();

      this.applyCompanyFilters();
      this.applyContactFilters();
      this.applyTaskFilters();
      this.applyMeetingFilters();
      this.applyCommunicationFilters();
      this.applyInvoiceFilters();
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
    await this.loadCompanyData(false);
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
    this.applyInvoiceFilters();
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

  onTabChange(event: any) {
    this.selectedTab = event.detail?.value || this.selectedTab;
    switch (this.selectedTab) {
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
        this.applyInvoiceFilters();
        break;
      case 'companies':
      default:
        this.applyCompanyFilters();
        break;
    }
  }
  applyCompanyFilters() {
    const unassignedStage: StageDefinition = { id: 0, name: 'No Stage', sortOrder: 999 };
    const allStages = [...this.stages];
    if (!this.stageLookup.has(0)) {
      allStages.push(unassignedStage);
    }

    const stageMap = new Map<number, CompanyViewModel[]>();
    allStages.forEach(stage => stageMap.set(stage.id, []));

    const filtered = this.companies
      .filter(company => this.matchesCompanyFilters(company))
      .map(company => this.enrichCompany(company));

    filtered.forEach(company => {
      const stageId = company.StageID ?? 0;
      if (!stageMap.has(stageId)) {
        stageMap.set(stageId, []);
      }
      stageMap.get(stageId)!.push(company);
    });

    this.stageGroups = allStages
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(stage => ({
        stage,
        companies: (stageMap.get(stage.id) ?? []).sort((a, b) => a.CompanyName.localeCompare(b.CompanyName))
      }));

    this.stageSummary = this.stageGroups.map(group => ({
      stage: group.stage,
      count: group.companies.length,
      highlight: this.selectedCompanyId !== null && group.stage.id === (this.selectedCompany?.StageID ?? 0)
    }));
  }

  applyContactFilters() {
    const searchTerm = this.contactFilters.search.trim().toLowerCase();
    const scope = this.contactFilters.companyScope;
    const selectedId = this.selectedCompanyId;
    const roleFilter = this.contactFilters.role;

    this.filteredContacts = this.contacts.filter(contact => {
      if (scope === 'selected') {
        if (selectedId === null || contact.CompanyID !== selectedId) {
          return false;
        }
      }

      if (roleFilter !== 'all' && contact.Role !== roleFilter) {
        return false;
      }

      if (this.contactFilters.showPrimaryOnly && !contact.PrimaryContact) {
        return false;
      }

      if (!searchTerm) {
        return true;
      }

      const haystack = [
        contact.Name,
        contact.Title,
        contact.Role,
        contact.Email,
        contact.Phone1,
        contact.Phone2,
        this.getCompanyName(contact.CompanyID)
      ].join(' ').toLowerCase();

      return haystack.includes(searchTerm);
    });
  }

  applyTaskFilters() {
    const searchTerm = this.taskFilters.search.trim().toLowerCase();
    const scope = this.taskFilters.scope;
    const selectedId = this.selectedCompanyId;
    const statusFilter = this.taskFilters.status;
    const assignedFilter = this.taskFilters.assignedTo;
    const overdueOnly = this.taskFilters.overdueOnly;

    this.filteredTasks = this.tasks.filter(task => {
      if (scope === 'selected') {
        if (selectedId === null || task.CompanyID !== selectedId) {
          return false;
        }
      }

      if (statusFilter === 'completed' && !task.completed) {
        return false;
      }

      if (statusFilter === 'open' && task.completed) {
        return false;
      }

      if (assignedFilter !== 'all' && task.assignTo !== assignedFilter) {
        return false;
      }

      if (overdueOnly && !task.isOverdue) {
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
  }

  applyMeetingFilters() {
    const searchTerm = this.meetingFilters.search.trim().toLowerCase();
    const scope = this.meetingFilters.scope;
    const timeframe = this.meetingFilters.timeframe;
    const selectedId = this.selectedCompanyId;
    const now = new Date();

    this.filteredMeetings = this.meetings.filter(meeting => {
      if (scope === 'selected') {
        if (selectedId === null || meeting.CompanyID !== selectedId) {
          return false;
        }
      }

      if (timeframe === 'upcoming') {
        if (!meeting.startDate || meeting.startDate < now) {
          return false;
        }
      } else if (timeframe === 'past') {
        if (!meeting.startDate || meeting.startDate >= now) {
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
  }

  applyCommunicationFilters() {
    const searchTerm = this.communicationFilters.search.trim().toLowerCase();
    const scope = this.communicationFilters.scope;
    const selectedId = this.selectedCompanyId;
    const typeFilter = this.communicationFilters.type;
    const modeFilter = this.communicationFilters.mode;
    const onlyResponses = this.communicationFilters.onlyResponses;

    this.filteredCommunications = this.communications.filter(comm => {
      if (scope === 'selected') {
        if (selectedId === null || comm.CompanyID !== selectedId) {
          return false;
        }
      }

      if (typeFilter !== 'all' && comm.communicationType !== typeFilter) {
        return false;
      }

      if (modeFilter !== 'all') {
        if (modeFilter === 'call' && !(comm.mode === 'call' || comm.mode === 'multi')) {
          return false;
        }
        if (modeFilter === 'email' && !(comm.mode === 'email' || comm.mode === 'multi')) {
          return false;
        }
        if (modeFilter === 'text' && !(comm.mode === 'text' || comm.mode === 'multi')) {
          return false;
        }
      }

      if (onlyResponses && comm.outcome !== 'Connected') {
        return false;
      }

      if (!searchTerm) {
        return true;
      }

      const haystack = [
        comm.communicationType,
        comm.notes,
        comm.outcome,
        comm.channels.join(' '),
        this.getCompanyName(comm.CompanyID)
      ].join(' ').toLowerCase();

      return haystack.includes(searchTerm);
    });

    this.communicationTypes = this.extractUniqueValues(this.communications.map(comm => comm.communicationType).filter(Boolean));
  }

  applyInvoiceFilters() {
    const searchTerm = this.invoiceFilters.search.trim().toLowerCase();
    const scope = this.invoiceFilters.scope;
    const statusFilter = this.invoiceFilters.status;
    const processorFilter = this.invoiceFilters.paymentProcessor;
    const selectedId = this.selectedCompanyId;

    this.filteredInvoices = this.invoices.filter(invoice => {
      if (scope === 'selected') {
        if (selectedId === null || invoice.CompanyID !== selectedId) {
          return false;
        }
      }

      if (statusFilter !== 'all' && invoice.Status !== statusFilter) {
        return false;
      }

      if (processorFilter !== 'all') {
        const processor = invoice.PaymentProcessor || 'Unspecified';
        if (processor !== processorFilter) {
          return false;
        }
      }

      if (!searchTerm) {
        return true;
      }

      const haystack = [
        invoice.InvoiceID,
        invoice.CompanyName,
        invoice.Address,
        invoice.City,
        invoice.InvoiceNotes,
        invoice.Status,
        invoice.PaymentProcessor
      ].join(' ').toLowerCase();

      return haystack.includes(searchTerm);
    });

    this.invoiceMetrics = this.filteredInvoices.reduce((acc, invoice) => {
      acc.total += invoice.Fee ?? 0;
      const paid = invoice.Paid ?? 0;
      acc.paid += paid;
      const balance = (invoice.Fee ?? 0) - paid;
      if (balance > 0) {
        acc.outstanding += balance;
      }
      return acc;
    }, { total: 0, outstanding: 0, paid: 0 });
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
    this.projectCompanyLookup.clear();
    records.forEach(record => {
      if (record.ProjectID !== undefined && record.CompanyID !== undefined && record.CompanyID !== null) {
        this.projectCompanyLookup.set(Number(record.ProjectID), Number(record.CompanyID));
      }
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

    return {
      PK_ID: Number(raw.PK_ID ?? raw.TaskID ?? 0),
      TaskID: Number(raw.TaskID ?? raw.PK_ID ?? 0),
      CompanyID: raw.CompanyID !== undefined && raw.CompanyID !== null ? Number(raw.CompanyID) : null,
      dueDate,
      dueLabel: this.formatDate(dueDate),
      assignment: (raw.Assignment ?? '').trim(),
      assignTo: (raw.AssignTo ?? '').trim(),
      completed,
      notes: (raw.CompleteNotes ?? '').trim(),
      communicationType: this.communicationTypeLookup.get(Number(raw.CommunicationID)) ?? 'General',
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
    const companyId = projectId !== null ? this.projectCompanyLookup.get(projectId) ?? null : null;
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

    const processor = (raw.PaymentProcessor ?? '').trim();
    const normalizedProcessor = processor || 'Unspecified';

    return {
      PK_ID: Number(raw.PK_ID ?? raw.InvoiceID ?? 0),
      InvoiceID: Number(raw.InvoiceID ?? raw.PK_ID ?? 0),
      ProjectID: projectId,
      ServiceID: raw.ServiceID !== undefined && raw.ServiceID !== null ? Number(raw.ServiceID) : null,
      Date: raw.Date ?? null,
      DateValue: this.toDate(raw.Date),
      Address: raw.Address ?? '',
      City: raw.City ?? '',
      Zip: raw.Zip ?? '',
      Fee: amount,
      Paid: isNaN(paidAmount) ? null : paidAmount,
      PaymentProcessor: normalizedProcessor,
      InvoiceNotes: raw.InvoiceNotes ?? '',
      StateID: raw.StateID !== undefined && raw.StateID !== null ? Number(raw.StateID) : null,
      Mode: raw.Mode ?? '',
      CompanyID: companyId,
      CompanyName: companyId !== null ? (this.companyNameLookup.get(companyId) ?? 'Unknown company') : 'Unassigned',
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
        summary.label = `${this.formatShortDate(comm.date)} · ${channelSummary}`;
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
      summary.total += invoice.Fee ?? 0;
      const paid = invoice.Paid ?? 0;
      summary.paid += paid;
      const balance = (invoice.Fee ?? 0) - paid;
      if (balance > 0) {
        summary.outstanding += balance;
      }
      summary.invoices = (summary.invoices ?? 0) + 1;
      this.invoiceSummaryByCompany.set(invoice.CompanyID, summary);
    });
  }

  private ensureSelectedCompany() {
    if (this.selectedCompanyId && this.companies.some(company => company.CompanyID === this.selectedCompanyId)) {
      return;
    }
    const fallback = this.companies.find(company => company.CompanyID === 1) ?? this.companies[0] ?? null;
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

    const response = await this.http.get<any>(url, { headers }).toPromise();
    return response?.Result ?? [];
  }
}
