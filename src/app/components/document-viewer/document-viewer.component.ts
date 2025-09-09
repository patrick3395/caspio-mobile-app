import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, AlertController } from '@ionic/angular';
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
      <div class="viewer-container" *ngIf="!isImage && !isPDF">
        <iframe [src]="sanitizedUrl" 
                frameborder="0"
                [attr.data-file-type]="fileType"></iframe>
      </div>
      <div class="pdf-container" *ngIf="isPDF" (click)="showPDFDebugInfo()">
        <div class="pdf-wrapper">
          <iframe [src]="sanitizedUrl" 
                  type="application/pdf"
                  class="pdf-iframe"
                  allow="fullscreen"
                  allowfullscreen
                  #pdfFrame></iframe>
        </div>
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
      overflow: scroll;
      -webkit-overflow-scrolling: touch;
      position: relative;
      padding: 0;
    }
    .pdf-wrapper {
      width: 100%;
      height: auto;
      min-height: 300vh; /* Ensure enough height for multiple pages */
    }
    .pdf-iframe {
      width: 100%;
      height: 300vh; /* Make very tall to show all pages */
      border: none;
      display: block;
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
        overflow: scroll;
        height: 100%;
      }
      .pdf-wrapper {
        width: 100%;
        min-height: 300vh;
      }
      .pdf-iframe {
        width: 100%;
        height: 300vh;
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
      // For PDFs, use the URL with proper viewing parameters
      let pdfUrl = this.fileUrl;
      
      // For data URLs (base64 PDFs), ensure proper format
      if (pdfUrl.startsWith('data:')) {
        // Make sure the data URL has the correct MIME type
        if (!pdfUrl.startsWith('data:application/pdf')) {
          console.warn('PDF data URL has incorrect MIME type');
        }
      }
      // Don't add any parameters - let the browser's PDF viewer handle it naturally
      
      this.sanitizedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(pdfUrl);
      console.log('Displaying PDF with page-fit zoom for proper viewing');
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

  async showPDFDebugInfo() {
    // Try to detect PDF info from the iframe if possible
    let debugInfo = `PDF Debug Information:
    
File: ${this.fileName}
URL Type: ${this.fileUrl.startsWith('data:') ? 'Base64 Data URL' : 'Regular URL'}
File Type: ${this.fileType}

PDF Viewer Settings:
- Container Height: 100% of viewport
- iFrame Height: 300vh (3x viewport height)
- Scrolling: Enabled (overflow: scroll)
- iOS Touch Scrolling: Enabled

If you're only seeing the first page:
1. Try scrolling down - the PDF should have multiple pages rendered
2. The iframe is set to 300vh height to accommodate long PDFs
3. Zoom parameters: view=FitH&zoom=FitW (fit width)

Note: PDF page count detection requires server-side processing.
For base64 PDFs, the browser's built-in viewer handles rendering.`;

    const alert = await this.alertController.create({
      header: 'PDF Viewer Debug',
      message: `<pre style="font-size: 12px; white-space: pre-wrap;">${debugInfo}</pre>`,
      buttons: [
        {
          text: 'Copy Debug Info',
          handler: () => {
            // Try to copy to clipboard
            if (navigator.clipboard) {
              navigator.clipboard.writeText(debugInfo);
            } else {
              // Fallback for older browsers
              const textArea = document.createElement('textarea');
              textArea.value = debugInfo;
              document.body.appendChild(textArea);
              textArea.select();
              document.execCommand('copy');
              document.body.removeChild(textArea);
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
}