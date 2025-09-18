import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, AlertController, LoadingController, ToastController } from '@ionic/angular';
import { CaspioService } from '../../services/caspio.service';
import { HttpClient, HttpHeaders, HttpClientModule } from '@angular/common/http';
import { environment } from '../../../environments/environment';

interface User {
  UserID?: number;
  Name: string;
  Title?: string;
  Phone?: string;
  Email: string;
  Headshot?: any;
  CompanyID?: number;
  FirstName?: string;
  LastName?: string;
}

@Component({
  selector: 'app-company',
  templateUrl: './company.page.html',
  styleUrls: ['./company.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, HttpClientModule]
})
export class CompanyPage implements OnInit {
  users: User[] = [];
  filteredUsers: User[] = [];
  isLoading = false;
  searchTerm = '';
  companyName = 'Noble Property Inspections';
  companyId = 1; // Noble Property Inspections
  selectedTab = 'companies'; // Default tab for CompanyID = 1

  companyProfile: any = null;
  companySnapshot: { label: string; value: string; icon: string; hint?: string }[] = [];
  companyStats: { title: string; value: string; subtitle?: string; icon: string }[] = [];

  contacts: any[] = [];
  filteredContacts: any[] = [];
  contactsSearchTerm = '';

  tasks: any[] = [];
  filteredTasks: any[] = [];
  taskSearchTerm = '';
  taskStatusFilter: 'all' | 'open' | 'completed' = 'all';
  taskAssigneeFilter = 'all';
  taskAssignees: string[] = [];
  taskMetrics = { total: 0, completed: 0, outstanding: 0, overdue: 0 };

  communications: any[] = [];
  filteredCommunications: any[] = [];
  communicationSearchTerm = '';
  communicationTypeFilter = 'all';
  communicationTypes: string[] = [];

  invoices: any[] = [];
  filteredInvoices: any[] = [];
  invoiceSearchTerm = '';
  invoiceStatusFilter = 'all';
  invoiceMetrics = { total: 0, outstanding: 0, paid: 0 };

  readonly contactFieldMap = {
    name: ['Name', 'FullName', 'ContactName', 'DisplayName'],
    title: ['Title', 'Role', 'Position', 'JobTitle'],
    email: ['Email', 'EmailAddress', 'PrimaryEmail'],
    phone: ['Phone', 'PhoneNumber', 'Mobile', 'CellPhone'],
    city: ['City', 'LocationCity'],
    tags: ['Tags', 'Category', 'Labels'],
    lastContact: ['LastContact', 'LastContactDate', 'Last_Contact_Date']
  } as const;

  readonly taskFieldMap = {
    title: ['Title', 'TaskTitle', 'Task', 'Name', 'Subject'],
    description: ['Description', 'Details', 'Notes', 'Summary'],
    assignedTo: ['AssignedTo', 'AssignTo', 'AssignedUser', 'Owner', 'Assigned_Name'],
    status: ['Status', 'TaskStatus', 'State', 'Stage'],
    completed: ['Completed', 'Complete', 'IsComplete', 'Done'],
    dueDate: ['DueDate', 'Due_On', 'DueDateTime', 'Deadline'],
    priority: ['Priority', 'Importance', 'Urgency']
  } as const;

  readonly communicationFieldMap = {
    subject: ['Subject', 'Topic', 'Title'],
    summary: ['Summary', 'Notes', 'Description', 'Details'],
    type: ['Type', 'Channel', 'Medium'],
    contact: ['ContactName', 'Name', 'Recipient', 'To'],
    owner: ['Owner', 'AgentName', 'HandledBy'],
    date: ['Date', 'ContactDate', 'CommunicationDate', 'CreatedOn']
  } as const;

  readonly invoiceFieldMap = {
    number: ['InvoiceNumber', 'Number', 'InvoiceNo', 'InvoiceID'],
    date: ['InvoiceDate', 'Date', 'IssuedOn'],
    dueDate: ['DueDate', 'Due_On', 'Deadline'],
    status: ['Status', 'State'],
    amount: ['Amount', 'Total', 'InvoiceTotal', 'BalanceDue'],
    balance: ['Balance', 'Outstanding', 'BalanceDue', 'AmountDue']
  } as const;

  constructor(
    private caspioService: CaspioService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private http: HttpClient
  ) {}

  ngOnInit() {
    this.loadCompanyData();
  }

  async loadCompanyData() {
    await Promise.all([
      this.loadCompanyProfile(),
      this.loadUsers(),
      this.loadContacts(),
      this.loadTasks(),
      this.loadCommunications(),
      this.loadInvoices()
    ]);
    this.buildCompanyStats();
  }

  async loadUsers() {
    this.isLoading = true;
    const loading = await this.loadingController.create({
      message: 'Loading users...',
      spinner: 'circles'
    });
    await loading.present();

    try {
      // Get token from CaspioService
      const token = await this.caspioService.getAuthToken();
      
      if (!token) {
        throw new Error('No authentication token available');
      }

      const headers = new HttpHeaders({
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      });

      // Query users with CompanyID filter
      const params = {
        'q.where': `CompanyID=${this.companyId}`,
        'q.orderBy': 'Name'
      };

      const response = await this.http.get<any>(
        `${environment.caspio.apiBaseUrl}/tables/Users/records?${new URLSearchParams(params)}`,
        { headers }
      ).toPromise();

      if (response && response.Result) {
        this.users = response.Result.map((rawUser: any) => {
          const normalizedHeadshot = this.normalizeHeadshotPath(rawUser?.Headshot);
          return {
            ...rawUser,
            Headshot: normalizedHeadshot ?? ''
          } as User;
        });
        this.filteredUsers = [...this.users];
        
        // Load headshot images for each user
        await this.loadHeadshots();
        
        if (this.users.length === 0) {
          await this.showToast('No users found for this company', 'warning');
        }
      } else {
        throw new Error('Invalid response format');
      }
    } catch (error: any) {
      console.error('Error loading users:', error);
      await this.showToast(error.message || 'Failed to load users', 'danger');
    } finally {
      await loading.dismiss();
      this.isLoading = false;
    }
  }

  async loadHeadshots() {
    // Load headshot images from Caspio Files API
    const errors: any[] = [];
    
    for (let user of this.users) {
      const headshotPath = this.normalizeHeadshotPath(user.Headshot);
      if (!headshotPath) {
        user.Headshot = '';
        continue;
      }

      // If already a data URL or absolute HTTP URL, keep as-is
      if (typeof headshotPath === 'string' && (headshotPath.startsWith('data:') || headshotPath.startsWith('http'))) {
        user.Headshot = headshotPath;
        continue;
      }

      if (headshotPath) {
        try {
          console.log(`[DEBUG] Loading headshot for ${user.Name}, path: ${headshotPath}`);
          
          // If Headshot is a file path, get the image URL
          // Convert Observable to Promise and await the result
          const imageUrl = await this.caspioService.getImageFromFilesAPI(headshotPath).toPromise();
          if (imageUrl) {
            user.Headshot = imageUrl;
            console.log(`[DEBUG] Successfully loaded headshot for ${user.Name}`);
          }
        } catch (error: any) {
          console.error(`[DEBUG] Failed to load headshot for ${user.Name}:`, error);
          errors.push({
            user: user.Name,
            userId: user.UserID,
            path: headshotPath,
            error: error.message || error
          });
          // Use default avatar if image fails to load
          user.Headshot = '';
        }
      }
    }
    
    // If there were errors, show a debug popup with all of them
    if (errors.length > 0) {
      const errorList = errors.map(e => 
        `User: ${e.user} (ID: ${e.userId})<br>Path: ${e.path}<br>Error: ${e.error}<br>`
      ).join('<br>');
      
      const alert = await this.alertController.create({
        header: 'Debug: Headshot Load Errors',
        message: `
          <strong>Failed to load ${errors.length} headshot(s):</strong><br><br>
          ${errorList}
          <br><strong>This may be due to:</strong><br>
          - Invalid authentication token<br>
          - File not found in Caspio<br>
          - Network connectivity issues<br>
          - CORS/permission errors
        `,
        buttons: [
          {
            text: 'Copy Debug Info',
            handler: () => {
              const textToCopy = `Headshot Load Errors:\n${errors.map(e => 
                `User: ${e.user} (ID: ${e.userId})\nPath: ${e.path}\nError: ${e.error}\n`
              ).join('\n')}`;
              navigator.clipboard.writeText(textToCopy).catch(() => {
                const textarea = document.createElement('textarea');
                textarea.value = textToCopy;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
              });
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
  }

  private async loadCompanyProfile() {
    try {
      const records = await this.fetchTableRecords('Companies', {
        'q.where': `PK_ID=${this.companyId}`
      });
      this.companyProfile = records.length ? records[0] : null;
    } catch (error) {
      console.error('Error loading company profile:', error);
    }
  }

  private async loadContacts() {
    try {
      this.contacts = await this.fetchTableRecords('Contacts', {
        'q.where': `CompanyID=${this.companyId}`,
        'q.orderBy': 'Name'
      });
    } catch (error) {
      console.error('Error loading contacts:', error);
      this.contacts = [];
    }

    this.applyContactFilters();
    this.buildCompanyStats();
  }

  applyContactFilters() {
    const term = this.contactsSearchTerm.trim().toLowerCase();
    this.filteredContacts = this.contacts.filter(contact => {
      const name = this.resolveField(contact, this.contactFieldMap.name, '').toLowerCase();
      const email = this.resolveField(contact, this.contactFieldMap.email, '').toLowerCase();
      const title = this.resolveField(contact, this.contactFieldMap.title, '').toLowerCase();
      const phone = (this.resolveField(contact, this.contactFieldMap.phone, '') || '').toString().toLowerCase();

      if (!term) {
        return true;
      }

      return name.includes(term) || email.includes(term) || title.includes(term) || phone.includes(term);
    });
  }

  private async loadTasks() {
    try {
      this.tasks = await this.fetchTableRecords('Tasks', {
        'q.where': `CompanyID=${this.companyId}`,
        'q.orderBy': 'DueDate DESC'
      });
    } catch (error) {
      console.error('Error loading tasks:', error);
      this.tasks = [];
    }

    this.taskAssignees = Array.from(new Set(this.tasks.map(task => this.resolveField(task, this.taskFieldMap.assignedTo, ''))))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    this.recalculateTaskMetrics();
    this.applyTaskFilters();
  }

  applyTaskFilters() {
    const term = this.taskSearchTerm.trim().toLowerCase();
    const assigneeFilter = this.taskAssigneeFilter.toLowerCase();
    const now = new Date();

    this.filteredTasks = this.tasks.filter(task => {
      const title = this.resolveField(task, this.taskFieldMap.title, '').toLowerCase();
      const description = this.resolveField(task, this.taskFieldMap.description, '').toLowerCase();
      const assignedTo = this.resolveField(task, this.taskFieldMap.assignedTo, '');
      const assignedToLower = assignedTo.toLowerCase();
      const status = this.resolveField(task, this.taskFieldMap.status, '').toLowerCase();
      const completed = this.resolveBoolean(task, this.taskFieldMap.completed);
      const dueDate = this.getDateValue(task, this.taskFieldMap.dueDate);

      if (assigneeFilter !== 'all' && assignedToLower !== assigneeFilter) {
        return false;
      }

      if (this.taskStatusFilter === 'completed' && !completed) {
        return false;
      }

      if (this.taskStatusFilter === 'open' && completed) {
        return false;
      }

      if (term) {
        const priority = this.resolveField(task, this.taskFieldMap.priority, '').toLowerCase();
        if (
          !title.includes(term) &&
          !description.includes(term) &&
          !assignedToLower.includes(term) &&
          !status.includes(term) &&
          !priority.includes(term)
        ) {
          return false;
        }
      }

      return true;
    }).map(task => ({
      ...task,
      __meta: {
        title: this.resolveField(task, this.taskFieldMap.title, 'Untitled Task'),
        description: this.resolveField(task, this.taskFieldMap.description, ''),
        assignedTo: this.resolveField(task, this.taskFieldMap.assignedTo, 'Unassigned'),
        status: this.resolveField(task, this.taskFieldMap.status, this.resolveBoolean(task, this.taskFieldMap.completed) ? 'Completed' : 'Open'),
        completed: this.resolveBoolean(task, this.taskFieldMap.completed),
        dueDate: this.getDateValue(task, this.taskFieldMap.dueDate),
        dueDateLabel: this.formatDate(this.getDateValue(task, this.taskFieldMap.dueDate)),
        isOverdue: (() => {
          const due = this.getDateValue(task, this.taskFieldMap.dueDate);
          if (!due) { return false; }
          const completed = this.resolveBoolean(task, this.taskFieldMap.completed);
          return !completed && due < now;
        })(),
        priority: this.resolveField(task, this.taskFieldMap.priority, '')
      }
    }));

    this.buildCompanyStats();
  }

  private recalculateTaskMetrics() {
    const now = new Date();
    const total = this.tasks.length;
    const completed = this.tasks.filter(task => this.resolveBoolean(task, this.taskFieldMap.completed)).length;
    const overdue = this.tasks.filter(task => {
      const due = this.getDateValue(task, this.taskFieldMap.dueDate);
      if (!due) { return false; }
      return !this.resolveBoolean(task, this.taskFieldMap.completed) && due < now;
    }).length;
    const outstanding = total - completed;

    this.taskMetrics = { total, completed, outstanding, overdue };
  }

  private async loadCommunications() {
    try {
      this.communications = await this.fetchTableRecords('Communications', {
        'q.where': `CompanyID=${this.companyId}`,
        'q.orderBy': 'Date DESC'
      });
    } catch (error) {
      console.error('Error loading communications:', error);
      this.communications = [];
    }

    this.communicationTypes = Array.from(new Set(
      this.communications
        .map(comm => this.resolveField(comm, this.communicationFieldMap.type, '').toString().toLowerCase())
    )).filter(Boolean).sort((a, b) => a.localeCompare(b));

    this.applyCommunicationFilters();
  }

  applyCommunicationFilters() {
    const term = this.communicationSearchTerm.trim().toLowerCase();
    const typeFilter = this.communicationTypeFilter.toLowerCase();

    this.filteredCommunications = this.communications.filter(comm => {
      const subject = this.resolveField(comm, this.communicationFieldMap.subject, '').toLowerCase();
      const summary = this.resolveField(comm, this.communicationFieldMap.summary, '').toLowerCase();
      const type = this.resolveField(comm, this.communicationFieldMap.type, '').toLowerCase();
      const contact = this.resolveField(comm, this.communicationFieldMap.contact, '').toLowerCase();
      const owner = this.resolveField(comm, this.communicationFieldMap.owner, '').toLowerCase();

      if (typeFilter !== 'all' && type !== typeFilter) {
        return false;
      }

      if (!term) {
        return true;
      }

      return subject.includes(term) || summary.includes(term) || contact.includes(term) || owner.includes(term) || type.includes(term);
    });
  }

  private async loadInvoices() {
    try {
      this.invoices = await this.fetchTableRecords('Invoices', {
        'q.where': `CompanyID=${this.companyId}`,
        'q.orderBy': 'InvoiceDate DESC'
      });
    } catch (error) {
      console.error('Error loading invoices:', error);
      this.invoices = [];
    }

    this.calculateInvoiceMetrics();
    this.applyInvoiceFilters();
  }

  applyInvoiceFilters() {
    const term = this.invoiceSearchTerm.trim().toLowerCase();
    const statusFilter = this.invoiceStatusFilter.toLowerCase();

    this.filteredInvoices = this.invoices.filter(invoice => {
      const number = this.resolveField(invoice, this.invoiceFieldMap.number, '').toLowerCase();
      const status = this.resolveField(invoice, this.invoiceFieldMap.status, '').toLowerCase();
      const amount = this.resolveField(invoice, this.invoiceFieldMap.amount, '').toString();

      if (statusFilter !== 'all') {
        if (statusFilter === 'open' && status.includes('paid')) {
          return false;
        }
        if (statusFilter === 'paid' && !status.includes('paid')) {
          return false;
        }
      }

      if (!term) {
        return true;
      }

      return number.includes(term) || status.includes(term) || amount.includes(term);
    });

    this.buildCompanyStats();
  }

  private calculateInvoiceMetrics() {
    let total = 0;
    let paid = 0;
    let outstanding = 0;

    this.invoices.forEach(invoice => {
      const amountValue = Number(this.resolveField(invoice, this.invoiceFieldMap.amount, 0)) || 0;
      const balanceValue = Number(this.resolveField(invoice, this.invoiceFieldMap.balance, amountValue)) || 0;
      const status = this.resolveField(invoice, this.invoiceFieldMap.status, '').toLowerCase();

      total += amountValue;
      if (status.includes('paid') || balanceValue === 0) {
        paid += amountValue;
      } else {
        outstanding += balanceValue;
      }
    });

    this.invoiceMetrics = {
      total,
      outstanding,
      paid
    };
  }

  filterUsers(event: any) {
    const searchValue = event.target.value.toLowerCase();
    this.searchTerm = searchValue;

    if (!searchValue) {
      this.filteredUsers = [...this.users];
      return;
    }

    this.filteredUsers = this.users.filter(user => {
      const name = user.Name?.toLowerCase() || '';
      const email = user.Email?.toLowerCase() || '';
      const title = user.Title?.toLowerCase() || '';
      const phone = user.Phone?.toLowerCase() || '';
      
      return name.includes(searchValue) || 
             email.includes(searchValue) || 
             title.includes(searchValue) ||
             phone.includes(searchValue);
    });
  }

  async viewUserDetails(user: User) {
    const alert = await this.alertController.create({
      header: user.Name,
      message: `
        <ion-list>
          ${user.Title ? `
          <ion-item>
            <ion-label>
              <p>Title</p>
              <h3>${user.Title}</h3>
            </ion-label>
          </ion-item>` : ''}
          <ion-item>
            <ion-label>
              <p>Email</p>
              <h3>${user.Email}</h3>
            </ion-label>
          </ion-item>
          ${user.Phone ? `
          <ion-item>
            <ion-label>
              <p>Phone</p>
              <h3>${user.Phone}</h3>
            </ion-label>
          </ion-item>` : ''}
        </ion-list>
      `,
      buttons: ['Close']
    });

    await alert.present();
  }

  async doRefresh(event: any) {
    await this.loadUsers();
    event.target.complete();
  }

  private async showToast(message: string, color: string) {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  getUserInitials(user: User): string {
    if (user.Name) {
      const nameParts = user.Name.split(' ');
      const first = nameParts[0]?.charAt(0) || '';
      const last = nameParts[nameParts.length - 1]?.charAt(0) || '';
      return (first + last).toUpperCase();
    }
    return 'U';
  }

  formatPhone(phone?: string): string {
    if (!phone) return '';
    // Format phone number if it's just digits
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return phone;
  }

  async uploadHeadshot(user: User) {
    // Create hidden file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    // Remove capture attribute to show iOS picker with all options
    
    fileInput.onchange = async (event: any) => {
      const file = event.target.files[0];
      if (!file) return;

      const loading = await this.loadingController.create({
        message: 'Uploading headshot...',
        spinner: 'circles'
      });
      await loading.present();

      try {
        // Compress image if needed
        let imageFile = file;
        if (file.size > 1500000) { // If larger than 1.5MB
          const compressedBlob = await this.compressImage(file);
          imageFile = new File([compressedBlob], file.name, { type: compressedBlob.type });
        }

        // Upload to Caspio Files API
        const token = await this.caspioService.getAuthToken();
        if (!token) throw new Error('No authentication token');

        const formData = new FormData();
        formData.append('file', imageFile, `headshot_${user.UserID || Date.now()}.jpg`);

        const uploadResponse = await fetch(
          `${environment.caspio.apiBaseUrl}/files`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`
            },
            body: formData
          }
        );

        if (!uploadResponse.ok) {
          throw new Error('Failed to upload image');
        }

        const uploadResult = await uploadResponse.json();
        console.log('[DEBUG] Upload response:', JSON.stringify(uploadResult));

        const extractedPath = this.extractUploadedFilePath(uploadResult);
        if (!extractedPath) {
          throw new Error(`Invalid upload response - no filename found: ${JSON.stringify(uploadResult)}`);
        }

        const filePath = extractedPath.startsWith('/') ? extractedPath : `/${extractedPath}`;
        console.log('[DEBUG] File path for database:', filePath);

        // Update user record with new headshot path
        const updateResponse = await fetch(
          `${environment.caspio.apiBaseUrl}/tables/Users/records?q.where=UserID=${user.UserID}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              Headshot: filePath
            })
          }
        );

        if (!updateResponse.ok) {
          throw new Error('Failed to update user record');
        }

        // Update local user object and reload headshot
        const normalizedStoredPath = this.normalizeHeadshotPath(filePath) ?? filePath;
        user.Headshot = normalizedStoredPath;
        
        // Get the new image URL with debug info
        try {
          console.log('[DEBUG] Attempting to fetch image from path:', filePath);
          
          // Get a fresh token for the image fetch
          const freshToken = await this.caspioService.getAuthToken();
          console.log('[DEBUG] Using fresh token for image fetch:', freshToken ? 'Token exists' : 'No token');
          
          const imageUrl = await this.caspioService.getImageFromFilesAPI(filePath).toPromise();

          if (imageUrl) {
            user.Headshot = imageUrl;
            console.log('[DEBUG] Image loaded successfully, length:', imageUrl.length);
          } else {
            throw new Error('No image URL returned from API');
          }
        } catch (imgError: any) {
          console.error('[DEBUG] Failed to load image:', imgError);
          
          // Show debug popup with error details
          const debugInfo = `
            <strong>Image Load Error</strong><br><br>
            <strong>File Path:</strong> ${filePath}<br>
            <strong>User ID:</strong> ${user.UserID}<br>
            <strong>Error:</strong> ${imgError.message || imgError}<br>
            <strong>Status:</strong> ${imgError.status || 'N/A'}<br><br>
            <strong>Details:</strong><br>
            ${JSON.stringify(imgError, null, 2).substring(0, 500)}
          `;
          
          const alert = await this.alertController.create({
            header: 'Debug: Image Load Failed',
            message: debugInfo,
            buttons: [
              {
                text: 'Copy Debug Info',
                handler: () => {
                  const textToCopy = `Image Load Error\nPath: ${filePath}\nUser: ${user.UserID}\nError: ${imgError.message || imgError}\nDetails: ${JSON.stringify(imgError)}`;
                  navigator.clipboard.writeText(textToCopy).catch(() => {
                    // Fallback for older browsers
                    const textarea = document.createElement('textarea');
                    textarea.value = textToCopy;
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                  });
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
          
          // Still show success for upload, but note the image load issue
          await this.showToast('Headshot uploaded but failed to load preview', 'warning');
          return;
        }

        await this.showToast('Headshot uploaded successfully', 'success');
      } catch (error: any) {
        console.error('Error uploading headshot:', error);
        await this.showToast(error.message || 'Failed to upload headshot', 'danger');
      } finally {
        await loading.dismiss();
      }
    };

    // Trigger file selection
    fileInput.click();
  }

  private async compressImage(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          // Calculate new dimensions (max 1920px)
          let width = img.width;
          let height = img.height;
          const maxDimension = 1920;
          
          if (width > height) {
            if (width > maxDimension) {
              height = (height * maxDimension) / width;
              width = maxDimension;
            }
          } else {
            if (height > maxDimension) {
              width = (width * maxDimension) / height;
              height = maxDimension;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          
          ctx?.drawImage(img, 0, 0, width, height);
          
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('Failed to compress image'));
              }
            },
            'image/jpeg',
            0.8
          );
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  private extractUploadedFilePath(uploadResult: any): string | null {
    if (!uploadResult) {
      return null;
    }

    const queue: any[] = [uploadResult];
    while (queue.length > 0) {
      const current = queue.shift();

      if (!current) {
        continue;
      }

      if (typeof current === 'string') {
        const normalized = current.trim();
        if (normalized && normalized !== 'undefined' && normalized !== '/undefined') {
          return normalized;
        }
        continue;
      }

      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }

      if (typeof current === 'object') {
        const candidateKeys = ['Path', 'FilePath', 'Name', 'FileName', 'filename', 'name'];
        for (const key of candidateKeys) {
          const value = current[key];
          if (typeof value === 'string' && value.trim()) {
            const normalized = value.trim();
            if (normalized && normalized !== 'undefined' && normalized !== '/undefined') {
              return normalized;
            }
          }
        }

        const nestedKeys = ['Result', 'Results', 'Data', 'Items', 'Value'];
        for (const nestedKey of nestedKeys) {
          if (current[nestedKey]) {
            queue.push(current[nestedKey]);
          }
        }
      }
    }

    return null;
  }

  private normalizeHeadshotPath(raw: any): string | null {
    if (!raw) {
      return null;
    }

    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (!trimmed || trimmed === 'undefined' || trimmed === '/undefined' || trimmed === 'null') {
        return null;
      }
      if (trimmed.startsWith('data:') || trimmed.startsWith('http')) {
        return trimmed;
      }
      return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    }

    if (Array.isArray(raw)) {
      for (const item of raw) {
        const normalized = this.normalizeHeadshotPath(item);
        if (normalized) {
          return normalized;
        }
      }
      return null;
    }

    if (typeof raw === 'object') {
      const candidateKeys = ['FilePath', 'Path', 'Url', 'URL', 'link', 'Link', 'Name', 'FileName', 'value'];
      for (const key of candidateKeys) {
        const value = raw[key];
        if (typeof value === 'string') {
          const normalized = this.normalizeHeadshotPath(value);
          if (normalized) {
            return normalized;
          }
        }
      }

      const nestedKeys = ['Result', 'Results', 'Data', 'Items', 'Value'];
      for (const nestedKey of nestedKeys) {
        if (raw[nestedKey]) {
          const normalized = this.normalizeHeadshotPath(raw[nestedKey]);
          if (normalized) {
            return normalized;
          }
        }
      }
    }

    return null;
  }

  onTabChange(event: any) {
    this.selectedTab = event.detail?.value || this.selectedTab;
  }

  private buildCompanyStats() {
    if (!this.companyProfile) {
      this.companySnapshot = [];
      this.companyStats = [];
      return;
    }

    const profile = this.companyProfile;
    this.companySnapshot = [
      {
        label: 'Primary Contact',
        value: this.resolveField(profile, ['PrimaryContact', 'Primary_Contact', 'ContactName', 'OwnerName'], 'Not assigned'),
        icon: 'person-circle',
        hint: this.resolveField(profile, ['PrimaryContactEmail', 'Email', 'PrimaryEmail'])
      },
      {
        label: 'Phone',
        value: this.formatPhone(this.resolveField(profile, ['Phone', 'PhoneNumber', 'MainPhone'])),
        icon: 'call'
      },
      {
        label: 'Website',
        value: this.resolveField(profile, ['Website', 'Site', 'URL'], '—'),
        icon: 'globe'
      },
      {
        label: 'Billing Address',
        value: [
          this.resolveField(profile, ['BillingAddress', 'Address', 'Street']),
          this.resolveField(profile, ['City']),
          this.resolveField(profile, ['State', 'StateProvince']),
          this.resolveField(profile, ['Zip', 'PostalCode'])
        ].filter(Boolean).join(', ') || '—',
        icon: 'home'
      }
    ];

    this.companyStats = [
      {
        title: 'Active Contacts',
        value: String(this.contacts.length || 0),
        subtitle: 'Total people linked to this company',
        icon: 'people'
      },
      {
        title: 'Open Tasks',
        value: String(this.taskMetrics.outstanding),
        subtitle: `${this.taskMetrics.completed} completed`,
        icon: 'checkbox'
      },
      {
        title: 'Outstanding Invoices',
        value: this.formatCurrency(this.invoiceMetrics.outstanding),
        subtitle: `${this.invoiceMetrics.paid ? this.formatCurrency(this.invoiceMetrics.paid) + ' paid' : 'No payments yet'}`,
        icon: 'card'
      }
    ];
  }

  private async fetchTableRecords(tableName: string, params: Record<string, string> = {}): Promise<any[]> {
    const token = await this.caspioService.getAuthToken();
    if (!token) {
      throw new Error('No authentication token available');
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    });

    const searchParams = new URLSearchParams(params);
    const query = searchParams.toString();
    const url = `${environment.caspio.apiBaseUrl}/tables/${tableName}/records${query ? `?${query}` : ''}`;

    const response = await this.http.get<any>(url, { headers }).toPromise();
    return response?.Result ?? [];
  }

  private resolveField(record: any, candidates: readonly string[], fallback: any = ''): any {
    if (!record) {
      return fallback;
    }

    for (const candidate of candidates) {
      if (record[candidate] !== undefined && record[candidate] !== null) {
        return record[candidate];
      }
      const matchKey = Object.keys(record).find(key => key.toLowerCase() === candidate.toLowerCase());
      if (matchKey && record[matchKey] !== undefined && record[matchKey] !== null) {
        return record[matchKey];
      }
    }

    return fallback;
  }

  private resolveBoolean(record: any, candidates: readonly string[]): boolean {
    const value = this.resolveField(record, candidates);
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value === 1;
    }
    if (typeof value === 'string') {
      return ['true', 'yes', 'y', '1', 'completed', 'complete', 'done'].includes(value.toLowerCase());
    }
    return false;
  }

  private getDateValue(record: any, candidates: readonly string[]): Date | null {
    const value = this.resolveField(record, candidates);
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  formatDate(value: Date | string | null | undefined): string {
    if (!value) {
      return '—';
    }

    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) {
      return '—';
    }

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatCurrency(value: any): string {
    const numericValue = Number(value);
    if (isNaN(numericValue)) {
      return '$0.00';
    }

    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD'
    }).format(numericValue);
  }

  displayField(record: any, candidates: readonly string[], fallback: string = '—'): string {
    const value = this.resolveField(record, candidates, fallback);
    if (value === undefined || value === null || value === '') {
      return fallback;
    }
    return String(value);
  }

  displayDate(record: any, candidates: readonly string[]): string {
    const date = this.getDateValue(record, candidates);
    return this.formatDate(date);
  }
}
