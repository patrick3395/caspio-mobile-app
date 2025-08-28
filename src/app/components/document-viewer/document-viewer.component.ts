import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-document-viewer',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <ion-header>
      <ion-toolbar style="--background: #F15A27;">
        <ion-title style="color: white;">{{ fileName || 'Document Viewer' }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="openInNewTab()" style="color: white;">
            <ion-icon name="open-outline" slot="icon-only"></ion-icon>
          </ion-button>
          <ion-button (click)="dismiss()" style="color: white;">
            <ion-icon name="close" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="document-viewer-content">
      <div class="viewer-container" *ngIf="!isImage">
        <iframe [src]="sanitizedUrl" frameborder="0"></iframe>
      </div>
      <div class="image-container" *ngIf="isImage">
        <img [src]="fileUrl" [alt]="fileName" />
      </div>
    </ion-content>
  `,
  styles: [`
    .document-viewer-content {
      --background: #f5f5f5;
    }
    .viewer-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: none;
    }
    .image-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: #000;
    }
    .image-container img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
  `]
})
export class DocumentViewerComponent {
  @Input() fileUrl!: string;
  @Input() fileName!: string;
  @Input() fileType!: string;
  
  sanitizedUrl: SafeResourceUrl | null = null;
  isImage = false;

  constructor(
    private modalController: ModalController,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    // Check if it's an image
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'];
    const lowerName = (this.fileName || '').toLowerCase();
    this.isImage = imageExtensions.some(ext => lowerName.endsWith(ext));
    
    if (!this.isImage) {
      // For PDFs and other documents, use iframe with Google Docs viewer as fallback
      if (this.fileUrl.toLowerCase().includes('.pdf')) {
        // Try direct PDF viewing first, with Google Docs as fallback
        this.sanitizedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.fileUrl);
      } else {
        // For other documents, use Google Docs viewer
        const encodedUrl = encodeURIComponent(this.fileUrl);
        const viewerUrl = `https://docs.google.com/viewer?url=${encodedUrl}&embedded=true`;
        this.sanitizedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(viewerUrl);
      }
    }
  }

  openInNewTab() {
    window.open(this.fileUrl, '_blank');
  }

  dismiss() {
    this.modalController.dismiss();
  }
}