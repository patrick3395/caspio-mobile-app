import { Component, OnInit } from '@angular/core';
import { CaspioService } from '../../services/caspio.service';
import { AlertController, LoadingController, ToastController } from '@ionic/angular';

interface User {
  UserID: number;
  FirstName: string;
  LastName: string;
  Email: string;
  Phone?: string;
  Role?: string;
  Status?: string;
  CreatedDate?: string;
  LastLogin?: string;
  CompanyID: number;
}

@Component({
  selector: 'app-company',
  templateUrl: './company.page.html',
  styleUrls: ['./company.page.scss'],
})
export class CompanyPage implements OnInit {
  users: User[] = [];
  filteredUsers: User[] = [];
  isLoading = false;
  searchTerm = '';
  companyName = 'Noble Property Inspections';
  companyId = 1; // Noble Property Inspections

  constructor(
    private caspioService: CaspioService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private toastController: ToastController
  ) {}

  ngOnInit() {
    this.loadUsers();
  }

  async loadUsers() {
    this.isLoading = true;
    const loading = await this.loadingController.create({
      message: 'Loading users...',
      spinner: 'circles'
    });
    await loading.present();

    try {
      // Get users filtered by CompanyID
      this.caspioService.getValidToken().subscribe({
        next: async (token) => {
          const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          };

          // Query users with CompanyID filter
          const params = {
            'q.where': `CompanyID=${this.companyId}`,
            'q.orderBy': 'LastName,FirstName'
          };

          const response = await fetch(
            `https://c7eku786.caspio.com/rest/v2/tables/Users/records?${new URLSearchParams(params)}`,
            { headers }
          );

          if (response.ok) {
            const data = await response.json();
            this.users = data.Result || [];
            this.filteredUsers = [...this.users];
            
            if (this.users.length === 0) {
              this.showToast('No users found for this company', 'warning');
            }
          } else {
            throw new Error('Failed to fetch users');
          }

          await loading.dismiss();
          this.isLoading = false;
        },
        error: async (error) => {
          console.error('Error getting token:', error);
          await loading.dismiss();
          this.isLoading = false;
          this.showToast('Failed to load users', 'danger');
        }
      });
    } catch (error) {
      console.error('Error loading users:', error);
      await loading.dismiss();
      this.isLoading = false;
      this.showToast('Failed to load users', 'danger');
    }
  }

  filterUsers(event: any) {
    const searchValue = event.target.value.toLowerCase();
    this.searchTerm = searchValue;

    if (!searchValue) {
      this.filteredUsers = [...this.users];
      return;
    }

    this.filteredUsers = this.users.filter(user => {
      const fullName = `${user.FirstName} ${user.LastName}`.toLowerCase();
      const email = user.Email?.toLowerCase() || '';
      const role = user.Role?.toLowerCase() || '';
      
      return fullName.includes(searchValue) || 
             email.includes(searchValue) || 
             role.includes(searchValue);
    });
  }

  async viewUserDetails(user: User) {
    const alert = await this.alertController.create({
      header: `${user.FirstName} ${user.LastName}`,
      message: `
        <ion-list>
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
          ${user.Role ? `
          <ion-item>
            <ion-label>
              <p>Role</p>
              <h3>${user.Role}</h3>
            </ion-label>
          </ion-item>` : ''}
          ${user.Status ? `
          <ion-item>
            <ion-label>
              <p>Status</p>
              <h3>${user.Status}</h3>
            </ion-label>
          </ion-item>` : ''}
          ${user.LastLogin ? `
          <ion-item>
            <ion-label>
              <p>Last Login</p>
              <h3>${new Date(user.LastLogin).toLocaleDateString()}</h3>
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
    const first = user.FirstName?.charAt(0) || '';
    const last = user.LastName?.charAt(0) || '';
    return (first + last).toUpperCase();
  }

  getUserStatusColor(status?: string): string {
    if (!status) return 'medium';
    
    switch (status.toLowerCase()) {
      case 'active':
        return 'success';
      case 'inactive':
        return 'danger';
      case 'pending':
        return 'warning';
      default:
        return 'medium';
    }
  }
}