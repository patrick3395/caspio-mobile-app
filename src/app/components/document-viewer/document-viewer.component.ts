import { Component, Input, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, AlertController } from '@ionic/angular';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { NgxExtendedPdfViewerModule, NgxExtendedPdfViewerService } from 'ngx-extended-pdf-viewer';

@Component({
  selector: 'app-document-viewer',
  standalone: true,
  imports: [CommonModule, IonicModule, NgxExtendedPdfViewerModule],
  template: `
    <ion-header>
      <ion-toolbar style="--background: #F15A27; padding: 0 8px; padding-top: var(--ion-safe-area-top);">
        <div class="header-controls" *ngIf="isPDF">
          <!-- Sidebar Toggle -->
          <ion-button fill="clear" size="small" (click)="toggleSidebar()" style="color: white; --padding-start: 4px; --padding-end: 4px;">
            <ion-icon name="menu-outline" slot="icon-only"></ion-icon>
          </ion-button>
          
          <!-- Zoom Controls -->
          <ion-button fill="clear" size="small" (click)="zoomOut()" style="color: white; --padding-start: 4px; --padding-end: 4px;">
            <ion-icon name="remove-outline" slot="icon-only"></ion-icon>
          </ion-button>
          <span class="zoom-level">{{ currentZoom }}%</span>
          <ion-button fill="clear" size="small" (click)="zoomIn()" style="color: white; --padding-start: 4px; --padding-end: 4px;">
            <ion-icon name="add-outline" slot="icon-only"></ion-icon>
          </ion-button>
          
          <!-- Search Bar -->
          <div class="search-container">
            <ion-icon name="search-outline" style="color: white; margin-right: 4px;"></ion-icon>
            <input type="text" 
                   placeholder="Search..." 
                   class="header-search-input"
                   (input)="onSearchChange($event)"
                   (keyup.enter)="searchNext()"
                   #searchInput />
          </div>
          
          <!-- Right Side Actions -->
          <div class="header-actions">
            <ion-button fill="clear" size="small" (click)="openInNewTab()" style="color: white; --padding-start: 4px; --padding-end: 4px;">
              <ion-icon name="open-outline" slot="icon-only"></ion-icon>
            </ion-button>
            <ion-button fill="clear" size="small" (click)="dismiss()" style="color: white; --padding-start: 4px; --padding-end: 4px;">
              <ion-icon name="close" slot="icon-only"></ion-icon>
            </ion-button>
          </div>
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
          [height]="'calc(100vh - 80px)'"
          [mobileFriendlyZoom]="'page-width'"
          [showToolbar]="false"
          [showSidebarButton]="false"
          [sidebarVisible]="sidebarVisible"
          [showFindButton]="false"
          [showPagingButtons]="false"
          [showZoomButtons]="false"
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
          [scrollMode]="0"
          [showBorders]="true"
          [minZoom]="0.1"
          [maxZoom]="10"
          [textLayer]="true"
          [removePageBorders]="false"
          (pdfLoaded)="onPdfLoaded($event)"
          (pageRendered)="onPageRendered($event)"
          (pagesLoaded)="onPagesLoaded($event)"
          [showFindHighlightAll]="false"
          [showFindMatchCase]="false"
          [showFindEntireWord]="false"
          [showFindMatchDiacritics]="false"
          [showFindResultsCount]="true"
          [showFindMessages]="false"
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
    .header-controls {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      height: 44px;
      gap: 8px;
    }
    
    .zoom-level {
      color: white;
      font-size: 12px;
      min-width: 40px;
      text-align: center;
      margin: 0 2px;
    }
    
    .search-container {
      display: flex;
      align-items: center;
      flex: 1;
      max-width: 300px;
      margin: 0 8px;
    }
    
    .header-search-input {
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 16px;
      color: white;
      padding: 4px 12px;
      width: 100%;
      font-size: 13px;
      outline: none;
      transition: all 0.3s ease;
      height: 28px;
    }
    
    .header-search-input::placeholder {
      color: rgba(255, 255, 255, 0.7);
    }
    
    .header-search-input:focus {
      background: rgba(255, 255, 255, 0.25);
      border-color: white;
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
      height: 100%;
      background: #2d2d2d;
      overflow: hidden;
      position: relative;
      padding: 0;
      display: flex;
      flex-direction: column;
    }
    
    ::ng-deep #viewerContainer {
      overflow-y: auto !important;
      overflow-x: auto !important;
      -webkit-overflow-scrolling: touch !important;
      flex: 1;
      width: 100% !important;
      padding: 8px 4px !important;
      background: #2d2d2d !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
    }
    
    ::ng-deep .page {
      margin: 8px auto 16px auto !important;
      max-width: calc(100% - 16px) !important;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3) !important;
      border: 1px solid #444 !important;
      page-break-after: always !important;
      break-after: page !important;
    }
    
    ::ng-deep .pdfViewer {
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
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

  @ViewChild('searchInput') searchInput?: ElementRef;
  searchTerm: string = '';
  pdfLoaded: boolean = false;
  totalPages: number = 0;
  currentPage: number = 1;
  currentZoom: number = 100;
  sidebarVisible: boolean = false;

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
    this.isPDF = lowerPath.includes('.pdf') || this.fileUrl.toLowerCase().includes('.pdf');
    
    if (this.isImage) {
      // For images, use the URL directly (should be base64 data URL)
      this.displayUrl = this.fileUrl;
      console.log('Displaying image, URL starts with:', this.displayUrl.substring(0, 50));
    } else if (this.isPDF) {
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

  onSearchChange(event: any) {
    this.searchTerm = event.target.value;
    if (this.searchTerm && this.searchTerm.length > 0) {
      // Use the PDF viewer service to search
      this.pdfViewerService.find(this.searchTerm, {
        highlightAll: true,
        matchCase: false,
        wholeWords: false
      });
    } else {
      // Clear search if empty
      this.pdfViewerService.find('', {
        highlightAll: false
      });
    }
  }

  searchNext() {
    if (this.searchTerm) {
      this.pdfViewerService.findNext();
    }
  }

  searchPrevious() {
    if (this.searchTerm) {
      this.pdfViewerService.findPrevious();
    }
  }

  onPdfLoaded(event: any) {
    console.log('PDF loaded:', event);
    this.pdfLoaded = true;
    if (event && event.pagesCount) {
      this.totalPages = event.pagesCount;
      console.log('Total pages:', this.totalPages);
      
      // Force render all pages immediately for infinite scroll
      setTimeout(() => {
        // Get the viewer container
        const viewerContainer = document.getElementById('viewerContainer');
        if (viewerContainer) {
          // Scroll to bottom to trigger loading of all pages
          viewerContainer.scrollTop = viewerContainer.scrollHeight;
          // Then scroll back to top
          setTimeout(() => {
            viewerContainer.scrollTop = 0;
          }, 200);
        }
        
        // Also trigger the PDF viewer to render all pages
        const pdfViewer = (window as any).PDFViewerApplication;
        if (pdfViewer && pdfViewer.pdfViewer) {
          pdfViewer.pdfViewer.currentScaleValue = 'page-width';
          pdfViewer.pdfViewer.scrollMode = 0; // Vertical scrolling
          pdfViewer.pdfViewer.spreadMode = 0; // No spread
        }
      }, 300);
    }
  }

  onPageRendered(event: any) {
    if (event && event.pageNumber) {
      console.log('Page rendered:', event.pageNumber);
      // Update current page if needed
      if (event.pageNumber === 1) {
        // First page rendered, PDF is becoming visible
        this.currentPage = 1;
      }
    }
  }

  onPagesLoaded(event: any) {
    console.log('All pages loaded:', event);
    // Ensure all pages are rendered in infinite scroll mode
    setTimeout(() => {
      const viewerContainer = document.getElementById('viewerContainer');
      const pdfViewer = (window as any).PDFViewerApplication;
      
      if (pdfViewer && pdfViewer.pdfViewer) {
        // Set infinite scroll mode programmatically
        pdfViewer.pdfViewer.scrollMode = 0; // VERTICAL
        pdfViewer.pdfViewer.spreadMode = 0; // NONE
        
        // Force render all visible pages
        pdfViewer.pdfViewer.update();
      }
      
      if (viewerContainer) {
        // Quick scroll to trigger all page rendering
        const scrollHeight = viewerContainer.scrollHeight;
        viewerContainer.scrollTop = scrollHeight / 2;
        setTimeout(() => {
          viewerContainer.scrollTop = scrollHeight;
          setTimeout(() => {
            viewerContainer.scrollTop = 0;
          }, 100);
        }, 100);
      }
    }, 400);
  }

  toggleSidebar() {
    this.sidebarVisible = !this.sidebarVisible;
    // The sidebar visibility is controlled by the binding [sidebarVisible]
    // No need to manually update via service
  }

  zoomIn() {
    if (this.currentZoom < 300) {
      this.currentZoom = Math.min(300, this.currentZoom + 25);
      // Use the service's currentZoom property
      if (this.pdfViewerService) {
        (this.pdfViewerService as any).currentZoom = this.currentZoom / 100;
      }
    }
  }

  zoomOut() {
    if (this.currentZoom > 25) {
      this.currentZoom = Math.max(25, this.currentZoom - 25);
      // Use the service's currentZoom property
      if (this.pdfViewerService) {
        (this.pdfViewerService as any).currentZoom = this.currentZoom / 100;
      }
    }
  }

}