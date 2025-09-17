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

  constructor(
    private caspioService: CaspioService,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private toastController: ToastController,
    private http: HttpClient
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
}
