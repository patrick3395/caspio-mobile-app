import { Component, Input, OnInit, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { NgxExtendedPdfViewerModule } from 'ngx-extended-pdf-viewer';

@Component({
  selector: 'app-document-viewer',
  standalone: true,
  imports: [CommonModule, IonicModule, NgxExtendedPdfViewerModule],
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="viewer-header">
      <button *ngIf="isPDF" class="header-btn" (click)="sidebarOpen = !sidebarOpen" title="Toggle page thumbnails">
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 512 512" fill="none" stroke="white" stroke-width="32" stroke-linecap="round"><line x1="80" y1="160" x2="432" y2="160"/><line x1="80" y1="256" x2="432" y2="256"/><line x1="80" y1="352" x2="432" y2="352"/></svg>
      </button>
      <div *ngIf="!isPDF" class="header-btn-spacer"></div>
      <span class="header-title">{{ fileName || 'Document Viewer' }}</span>
      <div class="header-actions">
        <button *ngIf="isPDF" class="header-btn" (click)="downloadPdf()" title="Download PDF">
          <ion-icon name="download-outline"></ion-icon>
        </button>
        <button class="header-btn" (click)="dismiss()" title="Close">
          <ion-icon name="close"></ion-icon>
        </button>
      </div>
    </div>
    <ion-content class="document-viewer-content">
      <div class="viewer-container" *ngIf="!isImage && !isPDF">
        <iframe [src]="sanitizedUrl"
                frameborder="0"
                [attr.data-file-type]="fileType"></iframe>
      </div>
      <div class="pdf-container" *ngIf="isPDF">
        <ngx-extended-pdf-viewer
          [src]="pdfSource"
          [height]="'100%'"
          [mobileFriendlyZoom]="'150%'"
          [showToolbar]="false"
          [showSidebarButton]="false"
          [(sidebarVisible)]="sidebarOpen"
          [showFindButton]="false"
          [showPagingButtons]="false"
          [showZoomButtons]="false"
          [showPresentationModeButton]="false"
          [showOpenFileButton]="false"
          [showPrintButton]="false"
          [showDownloadButton]="false"
          [showSecondaryToolbarButton]="false"
          [showRotateButton]="false"
          [showHandToolButton]="false"
          [showSpreadButton]="false"
          [showPropertiesButton]="false"
          [showStampEditor]="false"
          [showDrawEditor]="false"
          [showHighlightEditor]="false"
          [showTextEditor]="false"
          [showCommentEditor]="false"
          [showSignatureEditor]="false"
          [zoom]="'page-width'"
          [spread]="'off'"
          [theme]="'dark'"
          [pageViewMode]="'multiple'"
          [scrollMode]="0"
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
    app-document-viewer .viewer-header {
      display: flex;
      align-items: center;
      background: #1a1a1a;
      padding: env(safe-area-inset-top, 0px) 8px 0 8px;
      min-height: calc(48px + env(safe-area-inset-top, 0px));
      gap: 4px;
    }
    app-document-viewer .header-btn {
      background: none !important;
      border: none !important;
      color: white !important;
      cursor: pointer;
      padding: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
    }
    app-document-viewer .header-btn:hover {
      background: rgba(255, 255, 255, 0.1) !important;
    }
    app-document-viewer .header-btn ion-icon {
      font-size: 22px;
      color: white !important;
    }
    app-document-viewer .header-btn svg {
      color: white !important;
    }
    app-document-viewer .header-btn-spacer {
      width: 38px;
    }
    app-document-viewer .header-title {
      flex: 1;
      color: white;
      font-size: 14px;
      font-weight: 500;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    app-document-viewer .header-actions {
      display: flex;
      gap: 2px;
    }
    app-document-viewer .document-viewer-content {
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
      overflow: hidden !important;
      position: relative;
      padding-top: env(safe-area-inset-top, 0px);
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
      /* Only show sidebar toggle, zoom, and print — hide everything else in left/middle */
      #toolbarViewerLeft {
        display: flex !important;
        flex-direction: row !important;
      }

      /* Hide search button */
      #viewFind {
        display: none !important;
      }

      /* Hide page number / navigation from center */
      #toolbarViewerMiddle {
        display: none !important;
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

      /* Hide sidebar view toggle buttons (thumbnail/outline/attachments) */
      #toolbarSidebar {
        display: none !important;
      }

      /* Ensure sidebar shows thumbnails by default */
      #sidebarContent {
        background: #1a1a1a !important;
        top: 0 !important;
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
      .pdf-container ::ng-deep #viewerContainer {
        -webkit-overflow-scrolling: touch !important;
        overflow-y: scroll !important;
      }
    }

    /* Ensure ion-content doesn't interfere with scrolling */
    ion-content.document-viewer-content {
      --overflow: hidden;
      height: 100%;
    }

    ion-content.document-viewer-content ::ng-deep .inner-scroll {
      overflow: hidden !important;
      height: 100% !important;
    }

    /* Print: global.scss handles hiding everything except #printContainer */

  `]
})
export class DocumentViewerComponent implements OnInit {
  @Input() fileUrl!: string;
  @Input() fileName!: string;
  @Input() fileType!: string;
  @Input() filePath?: string;

  sanitizedUrl: SafeResourceUrl | null = null;
  isImage = false;
  isPDF = false;
  displayUrl: string = '';
  pdfSource: string | Uint8Array = '';
  sidebarOpen = false;

  constructor(
    private modalController: ModalController,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'];
    const lowerName = (this.fileName || '').toLowerCase();
    const lowerPath = (this.filePath || this.fileName || '').toLowerCase();

    this.isImage = imageExtensions.some(ext => lowerName.endsWith(ext) || lowerPath.endsWith(ext));
    this.isPDF = lowerPath.includes('.pdf') || this.fileUrl.toLowerCase().includes('.pdf') || (this.fileType || '').toLowerCase() === 'pdf';

    if (this.isImage) {
      this.displayUrl = this.fileUrl;
    } else if (this.isPDF) {
      if (this.fileUrl.startsWith('data:')) {
        try {
          const base64 = this.fileUrl.split(',')[1];
          const binary = atob(base64);
          const len = binary.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          this.pdfSource = bytes;
        } catch (error) {
          console.error('Error converting base64 to Uint8Array:', error);
          this.pdfSource = this.fileUrl;
        }
      } else {
        this.pdfSource = this.fileUrl;
      }
    } else {
      if (this.fileUrl.startsWith('data:')) {
        this.sanitizedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.fileUrl);
      } else {
        const encodedUrl = encodeURIComponent(this.fileUrl);
        const viewerUrl = `https://docs.google.com/viewer?url=${encodedUrl}&embedded=true`;
        this.sanitizedUrl = this.sanitizer.bypassSecurityTrustResourceUrl(viewerUrl);
      }
    }
  }

  downloadPdf() {
    const triggerDownload = (blob: Blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = this.fileName || 'document.pdf';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      // Delay cleanup so browser has time to initiate the download
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
    };

    // Prefer using already-loaded pdfSource to avoid extra fetch
    if (this.pdfSource instanceof Uint8Array) {
      triggerDownload(new Blob([this.pdfSource], { type: 'application/pdf' }));
    } else if (this.fileUrl.startsWith('data:')) {
      const base64Data = this.fileUrl.split(',')[1];
      const byteCharacters = atob(base64Data);
      const byteArray = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteArray[i] = byteCharacters.charCodeAt(i);
      }
      triggerDownload(new Blob([byteArray], { type: 'application/pdf' }));
    } else {
      // blob: or regular URL — fetch then download
      fetch(this.fileUrl)
        .then(r => r.blob())
        .then(triggerDownload)
        .catch(err => console.error('Download failed:', err));
    }
  }

  handleImageError(event: any) {
    console.error('Image failed to load:', this.fileUrl);
    event.target.src = 'assets/img/photo-placeholder.svg';
  }

  dismiss() {
    this.modalController.dismiss();
  }
}
