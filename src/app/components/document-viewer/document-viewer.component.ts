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
          [showSidebarButton]="true"
          [sidebarVisible]="false"
          [showFindButton]="true"
          [showPagingButtons]="true"
          [showZoomButtons]="true"
          [showPresentationModeButton]="false"
          [showOpenFileButton]="false"
          [showPrintButton]="false"
          [showDownloadButton]="true"
          [showSecondaryToolbarButton]="false"
          [showRotateButton]="false"
          [showHandToolButton]="true"
          [showSpreadButton]="false"
          [showPropertiesButton]="false"
          [zoom]="'page-width'"
          [spread]="'off'"
          [theme]="'dark'"
          [pageViewMode]="'infinite-scroll'"
          [scrollMode]="1"
          backgroundColor="#2d2d2d">
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
      --background: #2d2d2d;
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
      height: calc(100vh - 56px);
      background: #2d2d2d;
      overflow: auto !important;
      -webkit-overflow-scrolling: touch;
      position: relative;
      padding: 0;
      display: flex;
      flex-direction: column;
    }
    
    /* Ensure the PDF viewer itself is scrollable */
    .pdf-container ::ng-deep #viewerContainer {
      overflow: auto !important;
      position: absolute !important;
      width: 100% !important;
      height: 100% !important;
    }
    
    .pdf-container ::ng-deep #viewer {
      position: relative !important;
    }
    
    /* Modern PDF Viewer Styling */
    ::ng-deep .pdf-container {
      /* Swap the position of sidebar and search buttons */
      #toolbarViewerLeft {
        display: flex !important;
        flex-direction: row !important;
      }
      
      /* Move search button to the left (first position) */
      #viewFind {
        order: -1 !important;
      }
      
      /* Ensure sidebar button comes after search */
      #sidebarToggle {
        order: 0 !important;
      }
      
      /* Toolbar styling */
      .toolbar {
        background: #1a1a1a !important;
        border-bottom: 1px solid #444 !important;
      }
      
      /* Modern button styling */
      .toolbarButton {
        border-radius: 6px !important;
        transition: all 0.2s ease !important;
        margin: 0 2px !important;
      }
      
      .toolbarButton:hover {
        background-color: rgba(255, 255, 255, 0.1) !important;
        transform: scale(1.05);
      }
      
      .toolbarButton:active {
        transform: scale(0.95);
      }
      
      /* Page input field */
      .toolbarField {
        background: #2d2d2d !important;
        border: 1px solid #444 !important;
        border-radius: 4px !important;
        color: #fff !important;
        padding: 4px 8px !important;
      }
      
      /* Zoom dropdown */
      #scaleSelect {
        background: #2d2d2d !important;
        border: 1px solid #444 !important;
        border-radius: 4px !important;
        color: #fff !important;
      }
      
      /* Sidebar styling */
      #sidebarContainer {
        background: #1a1a1a !important;
      }
      
      #thumbnailView {
        background: #1a1a1a !important;
      }
      
      .thumbnail {
        border: 2px solid transparent !important;
        border-radius: 4px !important;
        margin: 8px !important;
        transition: all 0.2s ease !important;
      }
      
      .thumbnail:hover {
        border-color: #F15A27 !important;
        transform: scale(1.02);
      }
      
      .thumbnail.selected {
        border-color: #F15A27 !important;
        box-shadow: 0 0 10px rgba(241, 90, 39, 0.3) !important;
      }
      
      /* Search box styling - Make it look like Ctrl+F */
      #findbar {
        background: #3a3a3a !important;
        border: 1px solid #555 !important;
        border-radius: 4px !important;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3) !important;
        padding: 4px !important;
      }
      
      #findInput {
        background: #2d2d2d !important;
        border: 2px solid #555 !important;
        border-radius: 4px !important;
        color: #fff !important;
        padding: 6px 10px !important;
        font-size: 14px !important;
        min-width: 200px !important;
      }
      
      #findInput:focus {
        border-color: #F15A27 !important;
        outline: none !important;
      }
      
      /* Style the find bar buttons */
      #findbar button {
        background: #4a4a4a !important;
        border: 1px solid #555 !important;
        color: #fff !important;
        border-radius: 3px !important;
        padding: 4px 8px !important;
        margin: 0 2px !important;
      }
      
      #findbar button:hover {
        background: #5a5a5a !important;
      }
      
      /* Ensure sidebar shows thumbnails by default */
      #sidebarContent {
        background: #1a1a1a !important;
      }
      
      #thumbnailView {
        display: block !important;
      }
      
      #outlineView, #attachmentsView, #layersView {
        display: none !important;
      }
      
      /* Hide outdated elements */
      .horizontalToolbarSeparator {
        display: none !important;
      }
      
      /* Modern scrollbar */
      ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      
      ::-webkit-scrollbar-track {
        background: #1a1a1a;
      }
      
      ::-webkit-scrollbar-thumb {
        background: #555;
        border-radius: 4px;
      }
      
      ::-webkit-scrollbar-thumb:hover {
        background: #777;
      }
    }
    
    iframe {
      width: 100%;
      height: 100%;
      border: none;
      transform-origin: top left;
      background: #2d2d2d;
    }
    
    .image-container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: #2d2d2d;
    }
    
    .image-container img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }
    
    /* Fix for iOS PDF rendering and scrolling */
    @supports (-webkit-touch-callout: none) {
      .pdf-container {
        -webkit-overflow-scrolling: touch;
        overflow: auto !important;
        height: calc(100vh - 56px) !important;
      }
      
      .pdf-container ::ng-deep #viewerContainer {
        -webkit-overflow-scrolling: touch !important;
        overflow-y: scroll !important;
      }
    }
    
    /* Ensure ion-content doesn't interfere with scrolling */
    ion-content.document-viewer-content {
      --overflow: hidden;
    }
    
    ion-content.document-viewer-content ::ng-deep .inner-scroll {
      overflow: hidden !important;
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