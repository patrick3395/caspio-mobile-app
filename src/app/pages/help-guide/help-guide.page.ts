import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, LoadingController } from '@ionic/angular';
import { CaspioService } from '../../services/caspio.service';
import { PlatformDetectionService } from '../../services/platform-detection.service';

type DocumentViewerCtor = typeof import('../../components/document-viewer/document-viewer.component')['DocumentViewerComponent'];

interface FileItem {
  FileID: number;
  TypeID: number;
  TypeName?: string;
  Description: string;
  FileFile: string;
  Order?: number;
}

interface FileSection {
  typeId: number;
  typeName: string;
  files: FileItem[];
}

@Component({
  selector: 'app-help-guide',
  templateUrl: './help-guide.page.html',
  styleUrls: ['./help-guide.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class HelpGuidePage implements OnInit {
  fileSections: FileSection[] = [];
  loading = false;
  error = '';
  fileUrls: Map<string, string> = new Map(); // Cache for converted file URLs
  selectedTab = 'help'; // Default to help tab
  private documentViewerComponent?: DocumentViewerCtor;
  private filesCache: any[] | null = null;
  private typesCache: any[] | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes


  private async loadDocumentViewer(): Promise<DocumentViewerCtor> {
    if (!this.documentViewerComponent) {
      const module = await import('../../components/document-viewer/document-viewer.component');
      this.documentViewerComponent = module.DocumentViewerComponent;
    }
    return this.documentViewerComponent;
  }

  constructor(
    private caspioService: CaspioService,
    private modalController: ModalController,
    private loadingController: LoadingController,
    public platform: PlatformDetectionService
  ) {}

  ngOnInit() {
    this.loadFiles();
  }

  async loadFiles() {
    // Show loading overlay immediately
    const loading = await this.loadingController.create({
      message: 'Loading support files...',
      spinner: 'crescent'
    });
    await loading.present();

    this.loading = true;
    this.error = '';

    try {
      let files: any[];
      let types: any[];

      // Check if cache is valid
      const now = Date.now();
      const cacheValid = this.filesCache && this.typesCache && (now - this.cacheTimestamp < this.CACHE_DURATION);

      if (cacheValid) {
        // Use cached data
        files = this.filesCache!;
        types = this.typesCache!;
      } else {
        // Fetch fresh data and cache it
        files = await this.caspioService.getFiles().toPromise() || [];
        types = await this.caspioService.getTypes().toPromise() || [];

        this.filesCache = files;
        this.typesCache = types;
        this.cacheTimestamp = now;
      }

      if (files && Array.isArray(files)) {
        const typeMap = new Map();

        if (types && Array.isArray(types)) {
          types.forEach(type => {
            typeMap.set(type.TypeID, type.TypeName);
          });
        }

        // Group files by TypeID
        const groupedFiles = new Map<number, FileItem[]>();

        files.forEach(file => {
          const typeId = file.TypeID;
          if (!groupedFiles.has(typeId)) {
            groupedFiles.set(typeId, []);
          }

          const fileWithTypeName = {
            ...file,
            TypeName: typeMap.get(typeId) || `Type ${typeId}`
          };

          groupedFiles.get(typeId)!.push(fileWithTypeName);
        });

        // Convert map to array of sections
        this.fileSections = Array.from(groupedFiles.entries()).map(([typeId, files]) => ({
          typeId,
          typeName: typeId === 0 ? 'General' : (typeMap.get(typeId) || `Type ${typeId}`),
          files: files.sort((a, b) => (a.Order || 0) - (b.Order || 0))
        }));

        // Sort sections by TypeID
        this.fileSections.sort((a, b) => a.typeId - b.typeId);
      }
    } catch (error) {
      console.error('Error loading files:', error);
      this.error = 'Failed to load help guide files';
    } finally {
      this.loading = false;
      await loading.dismiss();
    }
  }

  async getFileUrl(filePath: string): Promise<string> {
    if (!filePath) return '';

    // Check cache first
    if (this.fileUrls.has(filePath)) {
      return this.fileUrls.get(filePath) || '';
    }

    // If it's already a full URL or data URL, return as is
    if (filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('data:')) {
      return filePath;
    }

    // Use direct URL for much faster loading (skip base64 conversion)
    const account = localStorage.getItem('caspio_account') || 'c7bbd842ec87b9';
    const token = localStorage.getItem('caspio_token');
    const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
    const url = `https://${account}.caspio.com/rest/v2/files/${cleanPath}?access_token=${token}`;

    this.fileUrls.set(filePath, url);
    return url;
  }
  
  // Synchronous version for template binding
  getCachedFileUrl(filePath: string): string {
    return this.fileUrls.get(filePath) || '';
  }

  // Lazy loading image URL for template - now synchronous since we build URLs directly
  getImageUrl(filePath: string): string {
    if (!filePath) return 'assets/img/photo-placeholder.svg';

    // Check cache first
    if (this.fileUrls.has(filePath)) {
      return this.fileUrls.get(filePath) || 'assets/img/photo-placeholder.svg';
    }

    // Build URL directly (synchronous)
    if (filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('data:')) {
      return filePath;
    }

    const account = localStorage.getItem('caspio_account') || 'c7bbd842ec87b9';
    const token = localStorage.getItem('caspio_token');
    const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
    const url = `https://${account}.caspio.com/rest/v2/files/${cleanPath}?access_token=${token}`;

    // Cache it for next time
    this.fileUrls.set(filePath, url);
    return url;
  }

  isImageFile(filePath: string): boolean {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp'];
    const lowerPath = filePath.toLowerCase();
    return imageExtensions.some(ext => lowerPath.endsWith(ext));
  }

  isPdfFile(filePath: string): boolean {
    return filePath.toLowerCase().endsWith('.pdf');
  }

  getFileExtension(filePath: string): string {
    const parts = filePath.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'FILE';
  }

  async openFile(file: FileItem) {
    const url = await this.getFileUrl(file.FileFile);
    if (url) {
      const DocumentViewerComponent = await this.loadDocumentViewer();
      const modal = await this.modalController.create({
        component: DocumentViewerComponent,
        componentProps: {
          fileUrl: url,
          fileName: file.Description || this.getFileName(file.FileFile),
          fileType: this.getFileExtension(file.FileFile),
          filePath: file.FileFile
        },
        cssClass: 'fullscreen-modal'
      });
      await modal.present();
    }
  }

  getFileName(filePath: string): string {
    const parts = filePath.split('/');
    return parts[parts.length - 1] || 'Document';
  }

  async doRefresh(event: any) {
    // Clear cache on manual refresh
    this.filesCache = null;
    this.typesCache = null;
    this.cacheTimestamp = 0;

    await this.loadFiles();
    event.target.complete();
  }

  openYouTubeVideo(videoId: string) {
    // Open YouTube video in browser or YouTube app
    const videoUrls: { [key: string]: string } = {
      'QshYGopHdqc': 'https://youtu.be/QshYGopHdqc?si=fT6qjRzaS4uTa7ur',
      '0IW44h_8m2I': 'https://youtu.be/0IW44h_8m2I?si=Hhj8zXqItjogkQkq'
    };
    
    const url = videoUrls[videoId] || `https://youtu.be/${videoId}`;
    window.open(url, '_system');
  }

  handleThumbnailError(event: any) {
    // Fallback thumbnail if YouTube thumbnail fails to load
    event.target.src = 'assets/img/video-placeholder.png';
  }
}

