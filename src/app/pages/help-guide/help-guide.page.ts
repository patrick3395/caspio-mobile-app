import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { CaspioService } from '../../services/caspio.service';
import { PlatformDetectionService } from '../../services/platform-detection.service';
import { ImageViewerComponent } from '../../components/image-viewer/image-viewer.component';
import { environment } from '../../../environments/environment';

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
    public platform: PlatformDetectionService
  ) {}

  ngOnInit() {
    this.loadFiles();
  }

  async loadFiles() {
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
    }
  }

  // Fetch file data URL using CaspioService (same pattern as Template PDF viewer)
  async getFileDataUrl(file: FileItem): Promise<string> {
    const cacheKey = `file_${file.FileID}`;

    // Check cache first
    if (this.fileUrls.has(cacheKey)) {
      return this.fileUrls.get(cacheKey) || '';
    }

    const filePath = file.FileFile;
    if (!filePath) return '';

    try {
      const isPDF = this.isPdfFile(filePath);
      const isImage = this.isImageFile(filePath);

      let dataUrl: string;
      if (isPDF) {
        dataUrl = await this.caspioService.getPDFFromFilesAPI(filePath).toPromise() || '';
      } else if (isImage) {
        dataUrl = await this.caspioService.getImageFromFilesAPI(filePath).toPromise() || '';
      } else {
        dataUrl = await this.caspioService.getFileFromPath(filePath).toPromise() || '';
        // getFileFromPath returns {blob, dataUrl} or object URL string
        if (typeof dataUrl === 'object' && (dataUrl as any).dataUrl) {
          dataUrl = (dataUrl as any).dataUrl;
        }
      }

      if (dataUrl) {
        this.fileUrls.set(cacheKey, dataUrl);
      }
      return dataUrl;
    } catch (error) {
      console.error('[HelpGuide] Error fetching file:', error);
      return '';
    }
  }

  // Synchronous version for template binding
  getCachedFileUrl(filePath: string): string {
    return this.fileUrls.get(filePath) || '';
  }

  // Synchronous cached image URL (populated after getFileDataUrl resolves)
  getImageUrl(file: FileItem): string {
    if (!file || !file.FileFile) return 'assets/img/photo-placeholder.svg';
    const cacheKey = `file_${file.FileID}`;
    return this.fileUrls.get(cacheKey) || 'assets/img/photo-placeholder.svg';
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
    const filePath = file.FileFile;
    if (!filePath) return;

    const isImage = this.isImageFile(filePath);
    const isPDF = this.isPdfFile(filePath);

    if (isPDF) {
      // Open PDF directly in new browser tab — bypasses pdf.js, uses native browser PDF viewer
      const cleanPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
      const url = `${environment.apiGatewayUrl}/api/caspio-files/download?filePath=${encodeURIComponent(cleanPath)}`;
      window.open(url, '_blank');
    } else if (isImage) {
      const dataUrl = await this.getFileDataUrl(file);
      if (!dataUrl) return;
      const filename = file.Description || this.getFileName(filePath);
      const modal = await this.modalController.create({
        component: ImageViewerComponent,
        componentProps: {
          images: [{
            url: dataUrl,
            title: file.Description,
            filename: filename
          }],
          initialIndex: 0
        }
      });
      await modal.present();
    } else {
      const dataUrl = await this.getFileDataUrl(file);
      if (!dataUrl) return;
      const filename = file.Description || this.getFileName(filePath);
      const DocumentViewerComponent = await this.loadDocumentViewer();
      const modal = await this.modalController.create({
        component: DocumentViewerComponent,
        componentProps: {
          fileUrl: dataUrl,
          fileName: filename,
          fileType: this.getFileExtension(filePath),
          filePath: filePath
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

