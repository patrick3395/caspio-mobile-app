import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, LoadingController } from '@ionic/angular';
import { CaspioService } from '../../services/caspio.service';

interface HelpData {
  HelpID: number;
  Title: string;
  Text: string;
}

interface HelpImage {
  HelpID: number;
  HelpImage: string;
  Description?: string;
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
        <div *ngIf="helpData?.Text" class="help-text">
          <div [innerHTML]="helpData.Text"></div>
        </div>

        <!-- Help Images -->
        <div *ngIf="helpImages && helpImages.length > 0" class="help-images">
          <h3>Related Images</h3>
          <div class="images-grid">
            <div *ngFor="let image of helpImages" class="image-container">
              <img [src]="getImageUrl(image.HelpImage)" 
                   [alt]="image.Description || 'Help image'"
                   (click)="viewImage(image)"
                   (error)="handleImageError($event)">
              <p *ngIf="image.Description" class="image-description">{{ image.Description }}</p>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div *ngIf="!helpData?.Text && (!helpImages || helpImages.length === 0)" class="empty-state">
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

    .image-description {
      padding: 12px;
      font-size: 14px;
      color: var(--ion-color-medium);
      margin: 0;
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
  loading = false;
  error = '';

  constructor(
    private modalController: ModalController,
    private loadingController: LoadingController,
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

    try {
      // Load help data and images in parallel
      const [helpData, helpImages] = await Promise.all([
        this.caspioService.getHelpById(this.helpId).toPromise(),
        this.caspioService.getHelpImagesByHelpId(this.helpId).toPromise()
      ]);

      this.helpData = helpData;
      this.helpImages = helpImages || [];
      
      console.log('Help data loaded:', this.helpData);
      console.log('Help images loaded:', this.helpImages);
      
    } catch (error) {
      console.error('Error loading help data:', error);
      this.error = 'Failed to load help information. Please try again.';
    } finally {
      this.loading = false;
    }
  }

  getImageUrl(imagePath: string): string {
    if (!imagePath) return 'assets/img/photo-placeholder.svg';
    
    // If it's already a data URL, return as-is
    if (imagePath.startsWith('data:')) {
      return imagePath;
    }
    
    // Otherwise, construct Caspio Files API URL
    const account = localStorage.getItem('caspio_account') || 'c7bbd842ec87b9';
    const token = localStorage.getItem('caspio_token');
    const cleanPath = imagePath.startsWith('/') ? imagePath.substring(1) : imagePath;
    return `https://${account}.caspio.com/rest/v2/files/${cleanPath}?access_token=${token}`;
  }

  handleImageError(event: any) {
    event.target.src = 'assets/img/photo-placeholder.svg';
  }

  async viewImage(image: HelpImage) {
    // You could implement a full-screen image viewer here
    // For now, just open in a new tab/window
    const imageUrl = this.getImageUrl(image.HelpImage);
    window.open(imageUrl, '_blank');
  }

  dismiss() {
    this.modalController.dismiss();
  }
}
