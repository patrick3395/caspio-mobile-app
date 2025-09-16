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
  imageUrl?: string; // Store the base64 URL after fetching
}

interface HelpItem {
  HelpID: number;
  ItemType: string; // 'Do', 'Dont', 'Tip'
  Item: string;
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
        <!-- Description Section -->
        <div *ngIf="helpText" class="help-description-section">
          <h3>Description</h3>
          <div class="help-text">
            <div [innerHTML]="helpText"></div>
          </div>
        </div>

        <!-- Help Items Table (Dos and Don'ts) -->
        <div *ngIf="helpItems && helpItems.length > 0" class="help-items-section">
          <h3>Guidelines</h3>
          <div class="help-items-table">
            <div class="help-item-row" *ngFor="let item of helpItems">
              <div class="item-type" [class.do-type]="item.ItemType === 'Do'"
                   [class.dont-type]="item.ItemType === 'Dont'"
                   [class.tip-type]="item.ItemType === 'Tip'">
                <ion-icon *ngIf="item.ItemType === 'Do'" name="checkmark-circle" style="color: #4CAF50;"></ion-icon>
                <ion-icon *ngIf="item.ItemType === 'Dont'" name="close-circle" style="color: #f44336;"></ion-icon>
                <ion-icon *ngIf="item.ItemType === 'Tip'" name="bulb" style="color: #FFC107;"></ion-icon>
                <span class="type-label" [style.color]="item.ItemType === 'Dont' ? '#f44336' : null">{{ item.ItemType === 'Dont' ? "Don't" : item.ItemType }}</span>
              </div>
              <div class="item-content">{{ item.Item }}</div>
            </div>
          </div>
        </div>

        <!-- Help Images -->
        <div *ngIf="helpImages && helpImages.length > 0" class="help-images-section">
          <h3>Related Images</h3>
          <div class="images-grid">
            <div *ngFor="let image of helpImages" class="image-container">
              <img [src]="image.imageUrl || 'assets/img/photo-placeholder.svg'"
                   [alt]="'Help image for ' + (image.HelpImage || 'unknown')"
                   (click)="viewImage(image)"
                   (error)="handleImageError($event)"
                   (load)="onImageLoad($event, image)">
              <div class="image-path-debug" style="font-size: 12px; color: #666; padding: 8px; background: #f5f5f5; word-break: break-all;">
                <strong>File:</strong> {{ image.HelpImage }}
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

    /* Common section styling */
    .help-description-section,
    .help-items-section,
    .help-images-section {
      margin: 24px 0;
      padding: 20px;
      background: #f9f9f9;
      border-radius: 12px;
      border: 1px solid #e0e0e0;
    }

    /* Common header styling for all sections */
    .help-description-section h3,
    .help-items-section h3,
    .help-images-section h3 {
      color: var(--ion-color-primary);
      margin-bottom: 16px;
      font-size: 20px;
      font-weight: 600;
      margin-top: 0;
    }

    .help-text {
      line-height: 1.6;
      font-size: 16px;
    }

    .help-text h1, .help-text h2, .help-text h3 {
      color: var(--ion-color-primary);
      margin-top: 16px;
      margin-bottom: 12px;
    }

    .help-text p {
      margin-bottom: 16px;
    }

    .help-items-table {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .help-item-row {
      display: flex;
      align-items: center;
      background: white;
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      gap: 12px;
    }

    .item-type {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-width: 100px;
      font-weight: 600;
      font-size: 14px;
      padding: 8px;
    }

    .item-type ion-icon {
      font-size: 20px;
    }

    .do-type {
      color: #4CAF50;
    }

    .dont-type {
      color: #f44336;
    }

    .tip-type {
      color: #FFC107;
    }

    .type-label {
      text-transform: uppercase;
      font-size: 13px;
      letter-spacing: 0.5px;
      font-weight: 700;
    }

    .item-content {
      flex: 1;
      font-size: 14px;
      line-height: 1.5;
      color: #333;
    }


    .images-grid {
      display: flex;
      flex-direction: column;
      gap: 20px;
      margin-top: 20px;
    }

    .image-container {
      background: var(--ion-color-light);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      border: 2px solid #e0e0e0;
    }

    .image-container img {
      width: 100%;
      height: auto;
      min-height: 300px;
      max-height: 500px;
      object-fit: contain;
      cursor: pointer;
      transition: transform 0.2s ease;
      background: white;
      padding: 10px;
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

    .image-path-debug {
      border-top: 1px solid #ddd;
      margin-top: -1px;
    }

    /* Mobile-first responsive design */
    @media (max-width: 768px) {
      .image-container img {
        min-height: 250px;
        max-height: 400px;
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
  helpItems: HelpItem[] = [];
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
      // Load help data, items, and images in parallel
      const [helpData, helpItems, helpImages] = await Promise.all([
        this.caspioService.getHelpById(this.helpId).toPromise(),
        this.caspioService.getHelpItemsByHelpId(this.helpId).toPromise(),
        this.caspioService.getHelpImagesByHelpId(this.helpId).toPromise()
      ]);

      this.addDebugMessage('Help response', helpData);
      this.addDebugMessage('Help items response', helpItems);
      this.addDebugMessage('Help images response', helpImages);

      this.helpData = helpData;
      this.helpItems = helpItems || [];
      this.helpImages = helpImages || [];
      this.helpText = helpData?.Comment || '';

      if (!this.title && helpData?.Title) {
        this.title = helpData.Title;
      }

      // Fetch actual image data for each help image
      if (this.helpImages && this.helpImages.length > 0) {
        console.log(`[HelpModal v1.4.402] Found ${this.helpImages.length} image(s), fetching as base64...`);

        // Fetch each image as base64
        for (let image of this.helpImages) {
          if (image.HelpImage) {
            console.log(`[HelpModal v1.4.402] Fetching image: ${image.HelpImage}`);
            try {
              // Use CaspioService to get image as base64
              const base64Url = await this.caspioService.getImageFromFilesAPI(image.HelpImage).toPromise();
              image.imageUrl = base64Url || 'assets/img/photo-placeholder.svg';
              console.log(`[HelpModal v1.4.402] Image fetched successfully, length: ${base64Url?.length || 0}`);
            } catch (error) {
              console.error(`[HelpModal v1.4.402] Failed to fetch image ${image.HelpImage}:`, error);
              image.imageUrl = 'assets/img/photo-placeholder.svg';
            }
          } else {
            image.imageUrl = 'assets/img/photo-placeholder.svg';
          }
        }
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

  // This method is no longer used - we fetch images as base64 using CaspioService
  // Keeping for reference only
  /*
  getImageUrl(imagePath: string): string {
    // Old implementation - replaced with base64 fetching
    return 'assets/img/photo-placeholder.svg';
  }
  */

  async handleImageError(event: any) {
    console.error('[HelpModal v1.4.402] Image failed to load');
    console.error('[HelpModal v1.4.402] This was a base64 image that failed to display');
    // Set placeholder
    event.target.src = 'assets/img/photo-placeholder.svg';
  }

  onImageLoad(event: any, image: HelpImage) {
    console.log('[HelpModal v1.4.402] Image loaded successfully:', image.HelpImage);
    console.log('[HelpModal v1.4.402] Base64 image displayed');
  }

  async viewImage(image: HelpImage) {
    // You could implement a full-screen image viewer here
    // For now, just open in a new tab/window
    console.log('[HelpModal v1.4.402] viewImage called with:', image);
    const imageUrl = image.imageUrl || 'assets/img/photo-placeholder.svg';
    console.log('[HelpModal v1.4.402] Opening image URL (length):', imageUrl.length);
    window.open(imageUrl, '_blank');
  }

  dismiss() {
    this.modalController.dismiss();
  }
}

