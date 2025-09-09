import { Component, Input, OnInit, ViewChild, ElementRef, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, AlertController } from '@ionic/angular';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { NgxExtendedPdfViewerModule, NgxExtendedPdfViewerService } from 'ngx-extended-pdf-viewer';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-document-viewer',
  standalone: true,
  imports: [CommonModule, IonicModule, NgxExtendedPdfViewerModule, FormsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <ion-header>
      <ion-toolbar style="--background: #F15A27; padding: 0 8px; padding-top: var(--ion-safe-area-top);">
        <div class="header-controls" *ngIf="isPDF">
          <!-- Sidebar Toggle -->
          <ion-button fill="clear" size="small" (click)="toggleSidebar()" style="color: white; --padding-start: 4px; --padding-end: 4px;">
            <ion-icon name="menu-outline" slot="icon-only"></ion-icon>
          </ion-button>
          
          <!-- Search Button -->
          <ion-button fill="clear" size="small" (click)="toggleSearchPopup()" style="color: white; --padding-start: 4px; --padding-end: 4px; position: relative;">
            <ion-icon name="search-outline" slot="icon-only"></ion-icon>
          </ion-button>
          
          <!-- Search Popup -->
          <div class="search-popup" *ngIf="showSearchPopup">
            <div class="search-popup-header">
              <input type="text" 
                     placeholder="Find in document..." 
                     class="search-popup-input"
                     [(ngModel)]="searchTerm"
                     (input)="onSearchChange($event)"
                     (keyup.enter)="searchNext()"
                     (keyup.escape)="closeSearchPopup()"
                     #searchPopupInput />
              <button class="search-close-btn" (click)="closeSearchPopup()">×</button>
            </div>
            <div class="search-popup-controls" *ngIf="searchTerm">
              <span class="search-count">{{ searchResultsCount > 0 ? (currentSearchIndex + 1) + ' of ' + searchResultsCount : 'No results' }}</span>
              <div class="search-nav-buttons">
                <button class="search-nav-btn" (click)="searchPrevious()" [disabled]="searchResultsCount === 0">
                  <ion-icon name="chevron-up-outline"></ion-icon>
                </button>
                <button class="search-nav-btn" (click)="searchNext()" [disabled]="searchResultsCount === 0">
                  <ion-icon name="chevron-down-outline"></ion-icon>
                </button>
              </div>
            </div>
          </div>
          
          <!-- Spacer -->
          <div style="flex: 1;"></div>
          
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
          [height]="'100%'"
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
          [renderText]="true"
          [useOnlyCssZoom]="false"
          [enableDragAndDrop]="false"
          (pdfLoaded)="onPdfLoaded($event)"
          (pdfLoadingStarts)="onPdfLoadingStarts($event)"
          (pdfLoadingFailed)="onPdfLoadingFailed($event)"
          (pageRendered)="onPageRendered($event)"
          (pagesLoaded)="onPagesLoaded($event)"
          (thumbnailsLoaded)="onThumbnailsLoaded($event)"
          [showFindHighlightAll]="false"
          [showFindMatchCase]="false"
          [showFindEntireWord]="false"
          [showFindMatchDiacritics]="false"
          [showFindResultsCount]="false"
          [showFindMessages]="false"
          backgroundColor="#ffffff">
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

  @ViewChild('searchPopupInput') searchPopupInput?: ElementRef;
  searchTerm: string = '';
  pdfLoaded: boolean = false;
  totalPages: number = 0;
  currentPage: number = 1;
  currentZoom: number = 100;
  sidebarVisible: boolean = false;
  searchResultsCount: number = 0;
  currentSearchIndex: number = 0;
  showSearchPopup: boolean = false;

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
      console.log('Preparing PDF source...');
      console.log('File URL length:', this.fileUrl?.length);
      console.log('File URL starts with:', this.fileUrl?.substring(0, 100));
      
      // Initialize the loading state
      this.pdfLoaded = false;
      
      // Check if we have a base64 data URL and convert it if needed
      if (this.fileUrl.startsWith('data:application/pdf;base64,')) {
        // Try converting base64 to Uint8Array as an alternative approach
        try {
          console.log('📄 Converting base64 to Uint8Array for better compatibility...');
          const base64 = this.fileUrl.split(',')[1];
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          this.pdfSource = bytes;
          console.log('✅ PDF converted to Uint8Array, size:', bytes.length);
        } catch (conversionError) {
          console.error('Failed to convert to Uint8Array, using base64 directly:', conversionError);
          this.pdfSource = this.fileUrl;
          console.log('⚠️ Fallback: Using base64 data URL directly, length:', this.fileUrl.length);
        }
      } else if (this.fileUrl.startsWith('blob:')) {
        // Blob URLs don't work with ngx-extended-pdf-viewer
        console.error('❌ Blob URL detected for PDF - this will not work!');
        console.log('Blob URL:', this.fileUrl);
        // Try to show an error
        this.pdfSource = '';
        setTimeout(() => {
          this.onPdfLoadingFailed({ message: 'PDF cannot be loaded from blob URL. Please refresh and try again.' });
        }, 100);
      } else {
        // Regular URL or other format
        this.pdfSource = this.fileUrl;
        console.log('PDF source set, URL type: regular URL or other format');
      }
      
      console.log('PDF source type:', typeof this.pdfSource);
      console.log('PDF source starts with:', typeof this.pdfSource === 'string' ? this.pdfSource.substring(0, 100) : 'Not a string');
      
      // Set a timeout to show PDF even if event doesn't fire
      // Increased timeout to give PDF viewer more time to process base64 data
      setTimeout(() => {
        if (!this.pdfLoaded && this.isPDF) {
          console.log('PDF load event did not fire after 10 seconds, forcing display');
          console.log('PDF source type:', typeof this.pdfSource === 'string' ? this.pdfSource.substring(0, 50) : 'Uint8Array');
          this.pdfLoaded = true;
        }
      }, 10000);
      
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

  toggleSearchPopup() {
    this.showSearchPopup = !this.showSearchPopup;
    if (this.showSearchPopup) {
      // Focus the search input after popup opens
      setTimeout(() => {
        if (this.searchPopupInput) {
          this.searchPopupInput.nativeElement.focus();
        }
      }, 100);
    } else {
      // Clear search when closing
      this.clearSearch();
    }
  }

  closeSearchPopup() {
    this.showSearchPopup = false;
    this.clearSearch();
  }

  clearSearch() {
    this.searchTerm = '';
    this.searchResultsCount = 0;
    this.currentSearchIndex = 0;
    // Clear PDF search highlights
    if (this.pdfViewerService) {
      this.pdfViewerService.find('', {
        highlightAll: false
      });
    }
  }

  onSearchChange(event: any) {
    this.searchTerm = event.target.value;
    this.currentSearchIndex = 0;
    this.searchResultsCount = 0;
    
    if (this.searchTerm && this.searchTerm.length > 0) {
      // Perform the search
      this.performSearch();
    } else {
      // Clear search if empty
      this.clearSearchHighlights();
    }
  }

  performSearch() {
    const pdfApp = (window as any).PDFViewerApplication;
    
    if (pdfApp && pdfApp.eventBus) {
      // Dispatch find event through the event bus
      pdfApp.eventBus.dispatch('find', {
        source: window,
        type: '',
        query: this.searchTerm,
        phraseSearch: false,
        caseSensitive: false,
        entireWord: false,
        highlightAll: true,
        findPrevious: false
      });
      
      // Get search results count after a delay
      setTimeout(() => {
        if (pdfApp.findController) {
          const matchesCount = pdfApp.findController.matchesCount;
          if (matchesCount) {
            this.searchResultsCount = matchesCount.total || 0;
            this.currentSearchIndex = matchesCount.current > 0 ? matchesCount.current - 1 : 0;
          } else {
            this.searchResultsCount = 0;
            this.currentSearchIndex = 0;
          }
        }
      }, 500);
    }
  }

  searchNext() {
    if (this.searchTerm && this.searchResultsCount > 0) {
      const pdfApp = (window as any).PDFViewerApplication;
      if (pdfApp && pdfApp.eventBus) {
        pdfApp.eventBus.dispatch('find', {
          source: window,
          type: 'again',
          query: this.searchTerm,
          phraseSearch: false,
          caseSensitive: false,
          entireWord: false,
          highlightAll: true,
          findPrevious: false
        });
        this.currentSearchIndex = (this.currentSearchIndex + 1) % this.searchResultsCount;
        
        // Update count
        setTimeout(() => {
          if (pdfApp.findController && pdfApp.findController.matchesCount) {
            this.currentSearchIndex = pdfApp.findController.matchesCount.current - 1;
          }
        }, 100);
      }
    }
  }

  searchPrevious() {
    if (this.searchTerm && this.searchResultsCount > 0) {
      const pdfApp = (window as any).PDFViewerApplication;
      if (pdfApp && pdfApp.eventBus) {
        pdfApp.eventBus.dispatch('find', {
          source: window,
          type: 'again',
          query: this.searchTerm,
          phraseSearch: false,
          caseSensitive: false,
          entireWord: false,
          highlightAll: true,
          findPrevious: true
        });
        this.currentSearchIndex = this.currentSearchIndex === 0 ? 
          this.searchResultsCount - 1 : this.currentSearchIndex - 1;
        
        // Update count
        setTimeout(() => {
          if (pdfApp.findController && pdfApp.findController.matchesCount) {
            this.currentSearchIndex = pdfApp.findController.matchesCount.current - 1;
          }
        }, 100);
      }
    }
  }

  clearSearchHighlights() {
    const pdfApp = (window as any).PDFViewerApplication;
    if (pdfApp && pdfApp.eventBus) {
      pdfApp.eventBus.dispatch('find', {
        source: window,
        type: '',
        query: '',
        phraseSearch: false,
        caseSensitive: false,
        entireWord: false,
        highlightAll: false,
        findPrevious: false
      });
    }
  }

  onPdfLoadingStarts(event: any) {
    console.log('PDF loading started:', event);
    if (this.pdfSource instanceof Uint8Array) {
      console.log('PDF source is Uint8Array, length:', this.pdfSource.length);
      console.log('First 10 bytes:', Array.from(this.pdfSource.slice(0, 10)));
    } else if (typeof this.pdfSource === 'string') {
      console.log('PDF source is string, length:', this.pdfSource.length);
      console.log('PDF source begins with:', this.pdfSource.substring(0, 100));
    } else {
      console.log('PDF source type unknown:', typeof this.pdfSource);
    }
    this.pdfLoaded = false;
  }
  
  onPdfLoadingFailed(event: any) {
    console.error('PDF loading failed:', event);
    console.error('PDF failure details:', {
      error: event?.error,
      message: event?.message,
      source: typeof this.pdfSource === 'string' ? this.pdfSource?.substring(0, 100) : 'Uint8Array'
    });
    this.pdfLoaded = true; // Hide loading indicator even on failure
    
    // Show more detailed error message to user
    const errorMessage = event?.message || 'Failed to load the PDF. The file may be corrupted or too large.';
    const sourceType = typeof this.pdfSource === 'string' && this.pdfSource?.startsWith('data:') ? 'base64' : 
                      typeof this.pdfSource === 'string' ? 'URL' : 'Uint8Array';
    this.alertController.create({
      header: 'PDF Loading Error',
      message: `${errorMessage}\n\nDebug: Source type is ${sourceType}`,
      buttons: ['OK']
    }).then(alert => alert.present());
  }

  onPdfLoaded(event: any) {
    console.log('PDF loaded event fired:', event);
    this.pdfLoaded = true;
    
    if (event) {
      if (event.pagesCount) {
        this.totalPages = event.pagesCount;
        console.log('Total pages:', this.totalPages);
      }
      
      // Setup event delegation for thumbnail clicks
      this.setupThumbnailEventDelegation();
      
      // Ensure the PDF viewer is properly initialized
      setTimeout(() => {
        const pdfApp = (window as any).PDFViewerApplication;
        if (pdfApp && pdfApp.pdfViewer) {
          console.log('PDF viewer initialized successfully');
          // Force a render update
          pdfApp.pdfViewer.update();
        }
      }, 100);
    }
  }
  
  setupThumbnailEventDelegation() {
    // Use event delegation on the sidebar container
    setTimeout(() => {
      const sidebarContainer = document.getElementById('sidebarContainer');
      if (sidebarContainer) {
        // Remove any existing listener
        sidebarContainer.onclick = null;
        
        // Add new click handler
        sidebarContainer.onclick = (event: MouseEvent) => {
          const target = event.target as HTMLElement;
          const thumbnail = target.closest('.thumbnail');
          
          if (thumbnail) {
            const pageLabel = thumbnail.getAttribute('aria-label');
            const pageMatch = pageLabel ? pageLabel.match(/\d+/) : null;
            const pageNumber = pageMatch ? parseInt(pageMatch[0]) : null;
            
            if (pageNumber) {
              event.preventDefault();
              event.stopPropagation();
              this.navigateToPage(pageNumber);
            }
          }
        };
      }
    }, 300);
  }
  
  navigateToPage(pageNumber: number) {
    console.log('Navigating to page:', pageNumber);
    
    // Method 1: Use PDFViewerApplication
    const pdfApp = (window as any).PDFViewerApplication;
    if (pdfApp) {
      pdfApp.page = pageNumber;
    }
    
    // Method 2: Direct scroll to page element
    setTimeout(() => {
      const pageElement = document.querySelector(`[data-page-number="${pageNumber}"]`);
      if (pageElement) {
        pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
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
      
      // Add click event listeners to thumbnails for page navigation
      this.setupThumbnailClickHandlers();
    }, 200);
  }
  
  setupThumbnailClickHandlers() {
    // Wait a bit for thumbnails to be fully rendered
    setTimeout(() => {
      // Get the thumbnail container
      const thumbnailView = document.getElementById('thumbnailView');
      if (!thumbnailView) return;
      
      // Remove any existing listeners to avoid duplicates
      const existingThumbnails = thumbnailView.querySelectorAll('.thumbnail');
      existingThumbnails.forEach(thumb => {
        const newThumb = thumb.cloneNode(true);
        thumb.parentNode?.replaceChild(newThumb, thumb);
      });
      
      // Add click handlers to thumbnail elements
      const thumbnails = thumbnailView.querySelectorAll('.thumbnail');
      thumbnails.forEach((thumbnail: any) => {
        // Get the page number from the thumbnail's data attribute or aria-label
        const pageLabel = thumbnail.getAttribute('aria-label');
        const pageMatch = pageLabel ? pageLabel.match(/\d+/) : null;
        const pageNumber = pageMatch ? parseInt(pageMatch[0]) : null;
        
        if (pageNumber) {
          thumbnail.style.cursor = 'pointer';
          thumbnail.addEventListener('click', (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            this.goToPage(pageNumber);
          });
        }
      });
    }, 500);
  }
  
  goToPage(pageNumber: number) {
    console.log('Attempting to navigate to page:', pageNumber);
    const pdfApp = (window as any).PDFViewerApplication;
    
    if (pdfApp && pdfApp.pdfViewer) {
      // Use the PDF viewer's page navigation
      pdfApp.page = pageNumber;
      
      // Alternative method if above doesn't work
      const viewerContainer = document.getElementById('viewerContainer');
      const targetPage = document.querySelector(`[data-page-number="${pageNumber}"]`);
      
      if (viewerContainer && targetPage) {
        targetPage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      
      console.log('Navigated to page:', pageNumber);
    }
  }

  onThumbnailsLoaded(event: any) {
    console.log('Thumbnails loaded:', event);
    // Setup thumbnail click handlers after thumbnails are loaded
    setTimeout(() => {
      this.setupThumbnailClickHandlers();
      this.setupThumbnailEventDelegation();
    }, 300);
  }

  toggleSidebar() {
    this.sidebarVisible = !this.sidebarVisible;
    console.log('Sidebar toggled:', this.sidebarVisible);
    
    // Force PDF viewer to show/hide sidebar
    const pdfApp = (window as any).PDFViewerApplication;
    if (pdfApp && pdfApp.pdfSidebar) {
      if (this.sidebarVisible) {
        pdfApp.pdfSidebar.open();
        // Ensure thumbnails view is selected
        pdfApp.pdfSidebar.switchView(0); // 0 = thumbnails view
        
        // Re-setup thumbnail handlers when sidebar is shown
        setTimeout(() => {
          this.setupThumbnailClickHandlers();
          this.setupThumbnailEventDelegation();
        }, 300);
      } else {
        pdfApp.pdfSidebar.close();
      }
    }
  }

  zoomIn() {
    const pdfApp = (window as any).PDFViewerApplication;
    if (pdfApp && pdfApp.pdfViewer) {
      const currentScale = pdfApp.pdfViewer.currentScale;
      const newScale = Math.min(3, currentScale + 0.25);
      pdfApp.pdfViewer.currentScaleValue = newScale;
      this.currentZoom = Math.round(newScale * 100);
      console.log('Zooming in to:', this.currentZoom + '%');
    }
  }

  zoomOut() {
    const pdfApp = (window as any).PDFViewerApplication;
    if (pdfApp && pdfApp.pdfViewer) {
      const currentScale = pdfApp.pdfViewer.currentScale;
      const newScale = Math.max(0.25, currentScale - 0.25);
      pdfApp.pdfViewer.currentScaleValue = newScale;
      this.currentZoom = Math.round(newScale * 100);
      console.log('Zooming out to:', this.currentZoom + '%');
    }
  }

}