import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, AlertController } from '@ionic/angular';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { NgxExtendedPdfViewerModule } from 'ngx-extended-pdf-viewer';

@Component({
  selector: 'app-document-viewer',
  standalone: true,
  imports: [CommonModule, IonicModule, NgxExtendedPdfViewerModule],
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
      <div class="viewer-container" *ngIf="!isImage && !isPDF">
        <iframe [src]="sanitizedUrl" 
                frameborder="0"
                [attr.data-file-type]="fileType"></iframe>
      </div>
      <div class="pdf-container" *ngIf="isPDF">
        <ngx-extended-pdf-viewer 
          [src]="pdfSource"
          [height]="'calc(100vh - 56px)'"
          [mobileFriendlyZoom]="'page-width'"
          [showToolbar]="true"
          [showSidebarButton]="false"
          [showFindButton]="true"
          [showPagingButtons]="true"
          [showZoomButtons]="true"
          [showPresentationModeButton]="false"
          [showOpenFileButton]="false"
          [showPrintButton]="true"
          [showDownloadButton]="true"
          [showSecondaryToolbarButton]="true"
          [showRotateButton]="true"
          [showHandToolButton]="true"
          [showSpreadButton]="false"
          [showPropertiesButton]="false"
          [zoom]="'page-width'"
          [spread]="'off'"
          backgroundColor="#525659">
        </ngx-extended-pdf-viewer>
      </div>
      <div class="image-container" *ngIf="isImage">
        <img [src]="displayUrl || fileUrl" 
             [alt]="fileName" 
             (error)="handleImageError($event)" />
      </div>
    </ion-content>
  `,
  styles: [`
    .document-viewer-content {
      --background: #ffffff;
    }
    .viewer-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .pdf-container {
      width: 100%;
      height: 100%;
      background: #525659;
      overflow: auto;
      -webkit-overflow-scrolling: touch;
      position: relative;
      padding: 0;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: none;
      transform-origin: top left;
      background: #ffffff;
    }
    .image-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: #f5f5f5;
    }
    .image-container img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    
    /* Fix for iOS PDF rendering */
    @supports (-webkit-touch-callout: none) {
      .pdf-container {
        -webkit-overflow-scrolling: touch;
        overflow: auto;
        height: 100%;
      }
    }
  `]
})
export class DocumentViewerComponent implements OnInit {
  @Input() fileUrl!: string;
  @Input() fileName!: string;
  @Input() fileType!: string;
  @Input() filePath?: string; // Original file path
  
  sanitizedUrl: SafeResourceUrl | null = null;
  isImage = false;
  isPDF = false;
  displayUrl: string = '';
  pdfSource: string | Uint8Array = '';

  constructor(
    private modalController: ModalController,
    private sanitizer: DomSanitizer,
    private alertController: AlertController
  ) {}

  ngOnInit() {
    console.log('DocumentViewer initialized with:', {
      fileUrl: this.fileUrl,
      fileName: this.fileName,
      fileType: this.fileType,
      filePath: this.filePath
    });
    
    // Check if it's an image
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'];
    const lowerName = (this.fileName || '').toLowerCase();
    const lowerPath = (this.filePath || this.fileName || '').toLowerCase();
    
    // Check both filename and filepath for extension
    this.isImage = imageExtensions.some(ext => lowerName.endsWith(ext) || lowerPath.endsWith(ext));
    this.isPDF = lowerPath.includes('.pdf') || this.fileUrl.toLowerCase().includes('.pdf');
    
    if (this.isImage) {
      // For images, use the URL directly (should be base64 data URL)
      this.displayUrl = this.fileUrl;
      console.log('Displaying image, URL starts with:', this.displayUrl.substring(0, 50));
    } else if (this.isPDF) {
      // For PDFs, prepare the source for ngx-extended-pdf-viewer
      if (this.fileUrl.startsWith('data:')) {
        // For base64 data URLs, convert to Uint8Array
        try {
          const base64 = this.fileUrl.split(',')[1];
          const binary = atob(base64);
          const len = binary.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          this.pdfSource = bytes;
          console.log('Loaded PDF from base64, size:', len, 'bytes');
        } catch (error) {
          console.error('Error converting base64 to Uint8Array:', error);
          // Fallback to direct URL
          this.pdfSource = this.fileUrl;
        }
      } else {
        // For regular URLs, use them directly
        this.pdfSource = this.fileUrl;
      }
      
      console.log('PDF source prepared for ngx-extended-pdf-viewer');
    } else {
      // For other documents, use Google Docs viewer if not a data URL
      if (this.fileUrl.startsWith('data:')) {
        // Can't use Google Docs viewer with data URLs
        this.sanitizedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.fileUrl);
      } else {
        const encodedUrl = encodeURIComponent(this.fileUrl);
        const viewerUrl = `https://docs.google.com/viewer?url=${encodedUrl}&embedded=true`;
        this.sanitizedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(viewerUrl);
        console.log('Using Google Docs viewer');
      }
    }
  }

  openInNewTab() {
    // For data URLs, create a blob and open it
    if (this.fileUrl.startsWith('data:')) {
      const base64Data = this.fileUrl.split(',')[1];
      const mimeType = this.fileUrl.split(':')[1].split(';')[0];
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);
      
      window.open(blobUrl, '_blank');
      
      // Clean up after a delay
      setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
    } else {
      window.open(this.fileUrl, '_blank');
    }
  }

  handleImageError(event: any) {
    console.error('Image failed to load:', this.fileUrl);
    // Set a placeholder image
    event.target.src = 'assets/img/photo-placeholder.svg';
  }

  dismiss() {
    this.modalController.dismiss();
  }

}