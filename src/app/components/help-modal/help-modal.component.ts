import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, LoadingController, AlertController } from '@ionic/angular';
import { CaspioService } from '../../services/caspio.service';

interface HelpData {
  HelpID: number;
  Title?: string;
  Comment?: string;
}

interface HelpImage {
  HelpID: number;
  HelpImage: string;
}

@Component({
  selector: 'app-help-modal',
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ title || 'Help Information' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">
            <ion-icon name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="help-modal-content">
      <!-- Loading State -->
      <div *ngIf="loading" class="loading-container">
        <ion-spinner name="crescent"></ion-spinner>
        <p>Loading help information...</p>
      </div>

      <!-- Error State -->
      <div *ngIf="error && !loading" class="error-container">
        <ion-icon name="alert-circle-outline" class="error-icon"></ion-icon>
        <p>{{ error }}</p>
        <ion-button (click)="loadHelpData()" fill="outline" size="small">
          Retry
        </ion-button>
      </div>

      <!-- Help Content -->
      <div *ngIf="!loading && !error" class="help-content">
        <!-- Help Text -->
        <div *ngIf="helpText" class="help-text">
          <div [innerHTML]="helpText"></div>
        </div>

        <!-- Help Images -->
        <div *ngIf="helpImages && helpImages.length > 0" class="help-images">
          <h3>Related Images</h3>
          <div class="images-grid">
            <div *ngFor="let image of helpImages" class="image-container">
              <img [src]="getImageUrl(image.HelpImage || '')"
                   [alt]="'Help image for ' + (image.HelpImage || 'unknown')"
                   (click)="viewImage(image)"
                   (error)="handleImageError($event)"
                   (load)="onImageLoad($event, image)">
              <div class="image-path-debug" style="font-size: 10px; color: #666; margin-top: 4px; word-break: break-all;">
                Path: {{ image.HelpImage }}
              </div>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div *ngIf="!helpText && (!helpImages || helpImages.length === 0)" class="empty-state">
          <ion-icon name="information-circle-outline" class="empty-icon"></ion-icon>
          <h3>No Help Information Available</h3>
          <p>Help content for this section is not yet available.</p>
        </div>
      </div>
    </ion-content>
  `,
  styles: [`
    .help-modal-content {
      --padding-start: 16px;
      --padding-end: 16px;
      --padding-top: 16px;
      --padding-bottom: 16px;
    }

    .loading-container, .error-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      text-align: center;
    }

    .error-icon {
      font-size: 48px;
      color: var(--ion-color-danger);
      margin-bottom: 16px;
    }

    .help-content {
      padding: 16px 0;
    }

    .help-text {
      margin-bottom: 24px;
      line-height: 1.6;
      font-size: 16px;
    }

    .help-text h1, .help-text h2, .help-text h3 {
      color: var(--ion-color-primary);
      margin-top: 24px;
      margin-bottom: 12px;
    }

    .help-text p {
      margin-bottom: 16px;
    }

    .help-images h3 {
      color: var(--ion-color-primary);
      margin-bottom: 16px;
      font-size: 18px;
    }

    .images-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }

    .image-container {
      background: var(--ion-color-light);
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .image-container img {
      width: 100%;
      height: 150px;
      object-fit: cover;
      cursor: pointer;
      transition: transform 0.2s ease;
    }

    .image-container img:hover {
      transform: scale(1.05);
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      text-align: center;
    }

    .empty-icon {
      font-size: 64px;
      color: var(--ion-color-medium);
      margin-bottom: 16px;
    }

    .empty-state h3 {
      color: var(--ion-color-medium);
      margin-bottom: 8px;
    }

    .empty-state p {
      color: var(--ion-color-medium);
      font-size: 14px;
    }

    /* Mobile-first responsive design */
    @media (max-width: 768px) {
      .images-grid {
        grid-template-columns: 1fr;
      }
      
      .help-text {
        font-size: 15px;
      }
    }
  `],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class HelpModalComponent implements OnInit {
  @Input() helpId!: number;
  @Input() title?: string;

  helpData: HelpData | null = null;
  helpImages: HelpImage[] = [];
  helpText = '';
  debugMessages: string[] = [];
  loading = false;
  error = '';

  constructor(
    private modalController: ModalController,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private caspioService: CaspioService
  ) {}

  ngOnInit() {
    if (this.helpId) {
      this.loadHelpData();
    } else {
      this.error = 'No help ID provided';
    }
  }

  async loadHelpData() {
    this.loading = true;
    this.error = '';
    this.helpText = '';
    this.debugMessages = [];

    const helpEndpoint = this.getHelpEndpoint(this.helpId);
    const imagesEndpoint = this.getHelpImagesEndpoint(this.helpId);
    this.addDebugMessage('Help request', helpEndpoint);
    this.addDebugMessage('Help images request', imagesEndpoint);

    try {
      // Load help data and images in parallel
      const [helpData, helpImages] = await Promise.all([
        this.caspioService.getHelpById(this.helpId).toPromise(),
        this.caspioService.getHelpImagesByHelpId(this.helpId).toPromise()
      ]);

      this.addDebugMessage('Help response', helpData);
      this.addDebugMessage('Help images response', helpImages);

      this.helpData = helpData;
      this.helpImages = helpImages || [];
      this.helpText = helpData?.Comment || '';

      if (!this.title && helpData?.Title) {
        this.title = helpData.Title;
      }

      // Debug: Show what we got for images
      if (this.helpImages && this.helpImages.length > 0) {
        const imageDebugInfo = this.helpImages.map(img => ({
          HelpID: img.HelpID,
          HelpImage: img.HelpImage,
          HelpImageType: typeof img.HelpImage,
          HelpImageValue: img.HelpImage ? String(img.HelpImage).substring(0, 100) : 'null'
        }));
        await this.presentDebugAlert('Help Images Debug Info',
          `Found ${this.helpImages.length} image(s):\n\n${JSON.stringify(imageDebugInfo, null, 2)}`);
      }

      if (!helpData || !this.helpText) {
        this.error = 'Help content unavailable.';
        await this.presentDebugAlert('Help Content Unavailable', this.debugMessages.join('\n\n'));
      }

    } catch (error) {
      this.error = 'Help content unavailable.';
      this.addDebugMessage('Help error', error);
      await this.presentDebugAlert('Help Content Unavailable');
    } finally {
      this.loading = false;
    }
  }

  private getHelpEndpoint(helpId: number): string {
    return `/tables/Help/records?q.select=HelpID,Title,Comment&q.where=HelpID%3D${helpId}`;
  }

  private getHelpImagesEndpoint(helpId: number): string {
    return `/tables/Help_Images/records?q.select=HelpID,HelpImage&q.where=HelpID%3D${helpId}`;
  }

  private addDebugMessage(label: string, value: any) {
    const formattedValue = this.escapeHtml(this.formatDebugValue(value));
    this.debugMessages.push(`<strong>${label}</strong><br><pre>${formattedValue}</pre>`);
  }

  private formatDebugValue(value: any): string {
    if (value === undefined) {
      return 'undefined';
    }
    if (value === null) {
      return 'null';
    }
    if (typeof value === 'string') {
      return value;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return String(value);
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private async presentDebugAlert(title: string, customMessage?: string) {
    const message = customMessage || (this.debugMessages.length > 0 ? this.debugMessages.join('<br><br>') : 'No debug information available.');

    const alert = await this.alertController.create({
      header: title,
      message: message.replace(/\n/g, '<br>'),
      buttons: [
        {
          text: 'Copy Debug Info',
          handler: () => {
            const textToCopy = message.replace(/<br>/g, '\n').replace(/<[^>]*>/g, '');
            if (navigator.clipboard) {
              navigator.clipboard.writeText(textToCopy);
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

  getImageUrl(imagePath: string): string {
    console.log('[HelpModal v1.4.398] getImageUrl called with:', imagePath);

    if (!imagePath) {
      console.log('[HelpModal v1.4.398] No image path provided, returning placeholder');
      return 'assets/img/photo-placeholder.svg';
    }

    // If it's already a data URL, return as-is
    if (imagePath.startsWith('data:')) {
      console.log('[HelpModal v1.4.398] Image is already a data URL');
      return imagePath;
    }

    // If it starts with http/https, it might be a full URL already
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      console.log('[HelpModal v1.4.398] Image appears to be a full URL:', imagePath);
      return imagePath;
    }

    // Otherwise, construct Caspio Files API URL
    const account = localStorage.getItem('caspio_account') || 'c7bbd842ec87b9';
    const token = localStorage.getItem('caspio_token');

    if (!token) {
      console.error('[HelpModal v1.4.398] No auth token found!');
      this.presentDebugAlert('Auth Error', 'No authentication token found. Please log in again.');
      return 'assets/img/photo-placeholder.svg';
    }

    // Clean the path - remove leading slash if present
    let cleanPath = imagePath.startsWith('/') ? imagePath.substring(1) : imagePath;

    // URL encode the entire path to handle spaces and special characters
    // Important: For Caspio Files API, we need to encode the full path
    const encodedPath = encodeURIComponent(cleanPath).replace(/%2F/g, '/');

    const fullUrl = `https://${account}.caspio.com/rest/v2/files/${encodedPath}?access_token=${token}`;
    console.log('[HelpModal v1.4.398] Constructed Caspio Files URL:', fullUrl);
    console.log('[HelpModal v1.4.398] Token present:', !!token);
    console.log('[HelpModal v1.4.398] Account:', account);
    console.log('[HelpModal v1.4.398] Original path:', imagePath);
    console.log('[HelpModal v1.4.398] Clean path:', cleanPath);
    console.log('[HelpModal v1.4.398] Encoded path:', encodedPath);

    // Show debug popup with the URL
    this.presentDebugAlert('Image URL Debug',
      `Path: ${imagePath}\n\nConstructed URL:\n${fullUrl}\n\nToken: ${token ? 'Present' : 'Missing'}`);

    return fullUrl;
  }

  async handleImageError(event: any) {
    console.error('[HelpModal v1.4.398] Image failed to load:', event.target.src);

    // Try to show what went wrong
    const failedUrl = event.target.src;
    const debugInfo = `Image Load Failed:\n\nAttempted URL:\n${failedUrl}\n\nPlease check:\n1. Token is valid\n2. File exists in Caspio\n3. Path is correct`;

    // Show debug alert
    await this.presentDebugAlert('Image Load Error', debugInfo);

    // Set placeholder
    event.target.src = 'assets/img/photo-placeholder.svg';
  }

  onImageLoad(event: any, image: HelpImage) {
    console.log('[HelpModal v1.4.398] Image loaded successfully:', image.HelpImage);
    console.log('[HelpModal v1.4.398] Image URL that worked:', event.target.src);
  }

  async viewImage(image: HelpImage) {
    // You could implement a full-screen image viewer here
    // For now, just open in a new tab/window
    console.log('[HelpModal v1.4.398] viewImage called with:', image);
    const imageUrl = this.getImageUrl(image.HelpImage || '');
    console.log('[HelpModal v1.4.398] Opening image URL:', imageUrl);
    window.open(imageUrl, '_blank');
  }

  dismiss() {
    this.modalController.dismiss();
  }
}

