
import { Component, OnInit } from '@angular/core';
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
export class CompanyPage implements OnInit {
  selectedTab: 'companies' | 'contacts' | 'tasks' | 'meetings' | 'communications' | 'invoices' = 'companies';

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

  tasks: TaskViewModel[] = [];
  filteredTasks: TaskViewModel[] = [];
  taskFilters = {
    search: '',
    status: 'all',
    assignedTo: 'all',
    scope: 'all',
    overdueOnly: false
  };
  taskAssignees: string[] = [];
  taskMetrics = { total: 0, completed: 0, outstanding: 0, overdue: 0 };
  private taskUpdatingIds = new Set<number>();

  meetings: MeetingViewModel[] = [];
  filteredMeetings: MeetingViewModel[] = [];
  meetingFilters = {
    search: '',
    timeframe: 'upcoming'
  };

  communications: CommunicationViewModel[] = [];
  filteredCommunications: CommunicationViewModel[] = [];
  communicationSearchTerm = '';

  invoices: InvoiceViewModel[] = [];
  invoiceSearchTerm = '';
  openInvoices: InvoicePair[] = [];
  unpaidInvoices: InvoicePair[] = [];
  paidInvoiceGroups: PaidInvoiceGroup[] = [];
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

  selectedContact: ContactRecord | null = null;
  isContactModalOpen = false;
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
    invoices: false
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
      .filter(company => this.matchesCompanyFilters(company))
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
  }
  applyTaskFilters() {
    const searchTerm = this.taskFilters.search.trim().toLowerCase();
    const statusFilter = this.taskFilters.status;
    const assignedFilter = this.taskFilters.assignedTo;
    const overdueOnly = this.taskFilters.overdueOnly;

    this.filteredTasks = this.tasks.filter(task => {
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

  async toggleTaskCompletion(task: TaskViewModel, completed: boolean) {
    if (task.completed === completed || this.taskUpdatingIds.has(task.TaskID)) {
      return;
    }

    this.taskUpdatingIds.add(task.TaskID);
    const previousCompleted = task.completed;

    task.completed = completed;
    task.isOverdue = !completed && task.dueDate ? this.isDateInPast(task.dueDate) : false;

    try {
      const payload: any = {
        Complete: completed ? 1 : 0,
        CompleteDate: completed ? new Date().toISOString() : null
      };
      await firstValueFrom(
        this.caspioService.put(
          '/tables/Tasks/records?q.where=TaskID=' + task.TaskID,
          payload
        )
      );
      await this.showToast(completed ? 'Task marked as complete' : 'Task reopened', 'success');
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
  }

  applyCommunicationFilters() {
    const searchTerm = this.communicationSearchTerm.trim().toLowerCase();

    this.filteredCommunications = this.communications.filter(comm => {
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
  }
  categorizeInvoices() {
    const searchTerm = this.invoiceSearchTerm.trim().toLowerCase();

    const filtered = this.invoices.filter(invoice => {
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

      bucket.positives.forEach(positive => {
        const negative = bucket.negatives.shift() ?? null;
        const projectDate = metadata?.projectDate ?? positive.ProjectDate ?? negative?.ProjectDate ?? positive.DateValue ?? negative?.DateValue ?? null;
        const net = (positive.Fee ?? 0) + (negative?.Fee ?? 0);
        const pair: InvoicePair = {
          positive,
          negative,
          projectDate,
          netAmount: net
        };

        if (negative) {
          paidPairs.push(pair);
        } else {
          const outstanding = Math.max((positive.Fee ?? 0) - (positive.Paid ?? 0), 0);
          pair.netAmount = outstanding;
          const projectHasOccurred = projectDate ? projectDate <= today : (positive.DateValue ? positive.DateValue <= today : true);
          if (projectHasOccurred) {
            unpaid.push(pair);
          } else {
            open.push(pair);
          }
        }
      });
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

  viewCompanyDetails(company: CompanyViewModel, event: Event): void {
    event.stopPropagation();
    // Navigate to company details page or open modal
    console.log('View details for:', company.CompanyName);
  }

  editCompany(company: CompanyViewModel, event: Event): void {
    event.stopPropagation();
    // Open edit modal or navigate to edit page
    console.log('Edit company:', company.CompanyName);
  }

  addTask(company: CompanyViewModel, event: Event): void {
    event.stopPropagation();
    // Open task creation modal
    console.log('Add task for:', company.CompanyName);
  }

  trackByStage = (_: number, group: StageGroup) => group.stage.id;

  trackByCompany = (_: number, company: CompanyViewModel) => company.CompanyID;

  trackByContactGroup = (_: number, group: ContactGroup) => group.companyId ?? -1;

  trackByContact = (_: number, contact: ContactRecord) => contact.ContactID;

  trackByTask = (_: number, task: TaskViewModel) => task.TaskID;
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
