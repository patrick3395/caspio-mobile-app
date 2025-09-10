import { Component, Input, OnInit, ViewChild, ElementRef, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, AlertController } from '@ionic/angular';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { NgxExtendedPdfViewerModule, NgxExtendedPdfViewerService } from 'ngx-extended-pdf-viewer';

@Component({
  selector: 'app-document-viewer',
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule, NgxExtendedPdfViewerModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <ion-header>
      <ion-toolbar style="--background: #F15A27; padding: 0 8px; padding-top: var(--ion-safe-area-top);">
        <div class="header-controls" *ngIf="isPDF">
          <ion-title style="color: white; flex: 1;">{{ fileName || 'PDF Viewer' }}</ion-title>
          <ion-button fill="clear" size="small" (click)="openInNewTab()" style="color: white;">
            <ion-icon name="open-outline" slot="icon-only"></ion-icon>
          </ion-button>
          <ion-button fill="clear" size="small" (click)="dismiss()" style="color: white;">
            <ion-icon name="close" slot="icon-only"></ion-icon>
          </ion-button>
        </div>
        
        <!-- Non-PDF header -->
        <div class="header-controls" *ngIf="!isPDF">
          <ion-title style="color: white; flex: 1;">{{ fileName || 'Document Viewer' }}</ion-title>
          <ion-button fill="clear" size="small" (click)="openInNewTab()" style="color: white;">
            <ion-icon name="open-outline" slot="icon-only"></ion-icon>
          </ion-button>
          <ion-button fill="clear" size="small" (click)="dismiss()" style="color: white;">
            <ion-icon name="close" slot="icon-only"></ion-icon>
          </ion-button>
        </div>
      </ion-toolbar>
    </ion-header>
    <ion-content class="document-viewer-content">
      <div class="viewer-container" *ngIf="!isImage && !isPDF">
        <iframe [src]="sanitizedUrl" 
                frameborder="0"
                [attr.data-file-type]="fileType"></iframe>
      </div>
      <div class="pdf-container" *ngIf="isPDF">
        <div class="pdf-loading" *ngIf="!pdfLoaded">
          <ion-spinner name="crescent" color="warning"></ion-spinner>
          <p>Loading PDF...</p>
        </div>
        <ngx-extended-pdf-viewer 
          [src]="pdfSource"
          [height]="'100%'"
          [mobileFriendlyZoom]="'page-width'"
          [showToolbar]="false"
          [showSidebarButton]="false"
          [sidebarVisible]="false"
          [showFindButton]="false"
          [showPagingButtons]="false"
          [showZoomButtons]="false"
          [showPresentationModeButton]="false"
          [showOpenFileButton]="false"
          [showPrintButton]="false"
          [showDownloadButton]="false"
          [showSecondaryToolbarButton]="false"
          [showRotateButton]="false"
          [showHandToolButton]="true"
          [showSpreadButton]="false"
          [showPropertiesButton]="false"
          [zoom]="'page-width'"
          [spread]="'off'"
          [theme]="'light'"
          [pageViewMode]="'infinite-scroll'"
          [scrollMode]="0"
          [showBorders]="true"
          [minZoom]="0.1"
          [maxZoom]="10"
          [textLayer]="true"
          [enableDragAndDrop]="false"
          [useBrowserLocale]="true"
          backgroundColor="#ffffff"
          (pdfLoaded)="onPdfLoaded($event)"
          (pdfLoadingFailed)="onPdfLoadingFailed($event)"
          (pageRendered)="onPageRendered($event)"
          (pagesLoaded)="onPagesLoaded($event)">
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
    .header-controls {
      display: flex;
      align-items: center;
      width: 100%;
      height: 44px;
      gap: 8px;
    }
    
    .search-popup {
      position: absolute;
      top: 50px;
      left: 60px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
      padding: 12px;
      z-index: 1000;
      min-width: 320px;
      animation: slideDown 0.2s ease-out;
    }
    
    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .search-popup-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    
    .search-popup-input {
      flex: 1;
      padding: 8px 12px;
      border: 2px solid #e0e0e0;
      border-radius: 6px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }
    
    .search-popup-input:focus {
      border-color: #F15A27;
    }
    
    .search-close-btn {
      width: 28px;
      height: 28px;
      border: none;
      background: #f0f0f0;
      border-radius: 4px;
      font-size: 20px;
      cursor: pointer;
      transition: background 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .search-close-btn:hover {
      background: #e0e0e0;
    }
    
    .search-popup-controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 8px;
      border-top: 1px solid #e0e0e0;
    }
    
    .search-count {
      font-size: 13px;
      color: #666;
    }
    
    .search-nav-buttons {
      display: flex;
      gap: 4px;
    }
    
    .search-nav-btn {
      width: 28px;
      height: 28px;
      border: 1px solid #d0d0d0;
      background: white;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    
    .search-nav-btn:hover:not(:disabled) {
      background: #F15A27;
      color: white;
      border-color: #F15A27;
    }
    
    .search-nav-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    
    .search-nav-btn ion-icon {
      font-size: 16px;
    }
    
    .header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    .pdf-loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      z-index: 100;
    }
    
    .pdf-loading p {
      color: #F15A27;
      margin-top: 16px;
      font-size: 16px;
    }
    
    .document-viewer-content {
      --background: #f5f5f5;
      height: 100%;
    }
    
    ::ng-deep .document-viewer-content .inner-scroll {
      height: 100%;
      overflow: hidden;
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
      height: calc(100vh - 80px);
      background: #f5f5f5;
      position: relative;
      padding: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    
    .pdf-iframe {
      width: 100%;
      height: 100%;
      border: none;
      background: white;
    }
    
    ngx-extended-pdf-viewer {
      width: 100%;
      height: 100%;
      display: block;
    }
    
    ::ng-deep ngx-extended-pdf-viewer .ng2-pdf-viewer-container {
      width: 100% !important;
      height: 100% !important;
      position: relative !important;
    }
    
    ::ng-deep #viewerContainer {
      overflow-y: auto !important;
      overflow-x: hidden !important;
      -webkit-overflow-scrolling: touch !important;
      height: 100% !important;
      width: 100% !important;
      padding: 8px 0 !important;
      background: #f5f5f5 !important;
      position: relative !important;
    }
    
    ::ng-deep .page {
      margin: 8px auto 16px auto !important;
      max-width: calc(100% - 32px) !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
      border: 1px solid #ddd !important;
    }
    
    ::ng-deep .pdfViewer {
      display: block !important;
      width: 100% !important;
      padding-bottom: 50px !important;
    }
    
    /* Sidebar container */
    ::ng-deep #sidebarContainer {
      background: #f0f0f0 !important;
      width: 200px !important;
    }
    
    ::ng-deep #thumbnailView {
      background: #f0f0f0 !important;
    }
    
    ::ng-deep .thumbnail {
      cursor: pointer !important;
      margin: 8px !important;
      background: white !important;
    }
    
    ::ng-deep .thumbnail.selected {
      outline: 2px solid #F15A27 !important;
    }
    
    /* Fix search highlights */
    ::ng-deep .textLayer .highlight {
      background-color: rgba(255, 255, 0, 0.5) !important;
      color: black !important;
    }
    
    ::ng-deep .textLayer .highlight.selected {
      background-color: rgba(241, 90, 39, 0.6) !important;
      color: black !important;
    }
    
    ::ng-deep .textLayer .highlight.begin {
      border-radius: 4px 0 0 4px !important;
    }
    
    ::ng-deep .textLayer .highlight.end {
      border-radius: 0 4px 4px 0 !important;
    }
    
    ::ng-deep .textLayer .highlight.middle {
      border-radius: 0 !important;
    }
    
    ::ng-deep .textLayer .highlight.selected {
      background-color: #F15A27 !important;
    }
    
    /* Ensure text layer is visible */
    ::ng-deep .textLayer {
      opacity: 1 !important;
      mix-blend-mode: multiply !important;
    }
    
    ::ng-deep .textLayer span {
      color: transparent !important;
    }
    
    ::ng-deep .textLayer .highlight span {
      color: transparent !important;
    }
    
    /* Modern PDF Viewer Styling */
    ::ng-deep .pdf-container {
      /* Fixed toolbar at top */
      #toolbarContainer {
        position: sticky !important;
        position: -webkit-sticky !important;
        top: 0 !important;
        z-index: 1000 !important;
        background: #1a1a1a !important;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3) !important;
      }
      
      /* Toolbar styling */
      .toolbar {
        background: #1a1a1a !important;
        border-bottom: 1px solid #444 !important;
        position: relative !important;
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
      
      /* Sidebar styling - removed duplicates */
      
      /* Hide the entire default search bar */
      #findbar {
        display: none !important;
      }
      
      /* Hide any search-related popups */
      .doorHanger,
      .doorHangerRight {
        display: none !important;
      }
      
      #findInput {
        background: #2d2d2d !important;
        border: 2px solid #444 !important;
        border-radius: 20px !important;
        color: #fff !important;
        padding: 8px 16px !important;
        font-size: 14px !important;
        width: 250px !important;
        transition: all 0.3s ease !important;
      }
      
      #findInput:focus {
        border-color: #F15A27 !important;
        outline: none !important;
        box-shadow: 0 0 10px rgba(241, 90, 39, 0.2) !important;
      }
      
      /* Hide all search options */
      #findbarOptionsContainer {
        display: none !important;
      }
      
      #findbarOptionsTwoContainer {
        display: none !important;
      }
      
      #findbarOptionsOneContainer {
        display: none !important;
      }
      
      /* Style the search navigation buttons */
      #findPrevious,
      #findNext {
        background: #2d2d2d !important;
        border: 1px solid #444 !important;
        border-radius: 50% !important;
        width: 32px !important;
        height: 32px !important;
        margin: 0 4px !important;
        transition: all 0.2s ease !important;
      }
      
      #findPrevious:hover,
      #findNext:hover {
        background: #F15A27 !important;
        border-color: #F15A27 !important;
        transform: scale(1.1);
      }
      
      /* Style the results count */
      #findResultsCount {
        color: #F15A27 !important;
        font-weight: 500 !important;
        margin: 0 10px !important;
      }
      
      /* Hide the find message */
      #findMsg {
        display: none !important;
      }
      
      /* Highlight style */
      .highlight {
        background-color: rgba(241, 90, 39, 0.4) !important;
      }
      
      .highlight.selected {
        background-color: #F15A27 !important;
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
    
    /* Fix for iOS PDF rendering */
    @supports (-webkit-touch-callout: none) {
      .pdf-container {
        -webkit-overflow-scrolling: touch;
        overflow: auto;
        height: 100%;
      }
    }
    
    /* Ensure full height for modal */
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    
    ion-content {
      flex: 1;
      height: 100%;
    }
    
    /* Override any max-height constraints */
    ::ng-deep .pdfViewer.removePageBorders .page {
      margin: 0 auto !important;
    }
    
    ::ng-deep #viewer {
      height: 100% !important;
      overflow-y: auto !important;
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
  pdfLoaded: boolean = false;

  constructor(
    private modalController: ModalController,
    private sanitizer: DomSanitizer,
    private alertController: AlertController,
    private pdfViewerService: NgxExtendedPdfViewerService
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
    this.isPDF = lowerPath.includes('.pdf') || 
                 this.fileUrl.toLowerCase().includes('.pdf') ||
                 this.fileUrl.toLowerCase().includes('application/pdf');
    
    console.log('Document detection:', {
      isImage: this.isImage,
      isPDF: this.isPDF,
      fileName: this.fileName,
      filePath: this.filePath,
      urlStartsWith: this.fileUrl?.substring(0, 50)
    });
    
    if (this.isImage) {
      // For images, use the URL directly (should be base64 data URL)
      this.displayUrl = this.fileUrl;
      console.log('Displaying image, URL starts with:', this.displayUrl.substring(0, 50));
    } else if (this.isPDF) {
      // For PDFs, prepare the source for ngx-extended-pdf-viewer
      console.log('🔍 PDF VIEWER DEBUG - Starting PDF preparation');
      console.log('File URL length:', this.fileUrl?.length);
      console.log('File URL starts with:', this.fileUrl?.substring(0, 100));
      
      // For PDFs, prepare the source for ngx-extended-pdf-viewer
      console.log('Preparing PDF source...');
      
      if (this.fileUrl.startsWith('data:')) {
        // For base64 data URLs, pass directly - the viewer handles it efficiently
        this.pdfSource = this.fileUrl;
        console.log('Using base64 data URL directly for better performance');
      } else {
        // For regular URLs, use them directly
        this.pdfSource = this.fileUrl;
        console.log('Using direct URL for PDF');
      }
      
      // Pre-initialize the PDF viewer
      this.pdfLoaded = false;
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



  onPdfLoaded(event: any) {
    console.log('✅ PDF loaded successfully:', event);
    this.pdfLoaded = true;
    if (event && event.pagesCount) {
      console.log('PDF has', event.pagesCount, 'pages');
    }
  }

  onPageRendered(event: any) {
    if (event && event.pageNumber) {
      console.log('Page rendered:', event.pageNumber);
      // Update current page if needed
      if (event.pageNumber === 1) {
        // First page rendered, PDF is becoming visible
        this.pdfLoaded = true;
      }
    }
  }

  onPagesLoaded(event: any) {
    console.log('All pages loaded:', event);
    // Ensure proper scroll mode and container setup
    setTimeout(() => {
      const pdfViewer = (window as any).PDFViewerApplication;
      if (pdfViewer && pdfViewer.pdfViewer) {
        pdfViewer.pdfViewer.scrollMode = 0; // VERTICAL
        pdfViewer.pdfViewer.spreadMode = 0; // NONE
        
        // Force update the viewer to recalculate scroll height
        pdfViewer.pdfViewer.update();
      }
      
      // Fix the viewer container height
      const viewerContainer = document.getElementById('viewerContainer');
      if (viewerContainer) {
        // Ensure container can scroll all content
        viewerContainer.style.height = '100%';
        viewerContainer.style.overflowY = 'auto';
        viewerContainer.style.position = 'relative';
        
        // Force a reflow to ensure scrolling works
        viewerContainer.scrollTop = 1;
        viewerContainer.scrollTop = 0;
      }
    }, 200);
  }

  onPdfLoadingFailed(error: any) {
    console.error('❌ PDF loading failed:', error);
    this.pdfLoaded = false;
    
    // Show error to user
    this.alertController.create({
      header: 'PDF Loading Error',
      message: 'Unable to load the PDF document. The file may be corrupted or in an unsupported format.',
      buttons: ['OK']
    }).then(alert => alert.present());
  }


}