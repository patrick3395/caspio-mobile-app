import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { CaspioService } from '../../services/caspio.service';
import { DocumentViewerComponent } from '../../components/document-viewer/document-viewer.component';

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

  constructor(
    private caspioService: CaspioService,
    private modalController: ModalController
  ) {}

  ngOnInit() {
    this.loadFiles();
  }

  async loadFiles() {
    this.loading = true;
    this.error = '';
    this.fileUrls.clear(); // Clear cache

    try {
      // Get all files from the Files table
      const files = await this.caspioService.getFiles().toPromise();
      
      if (files && Array.isArray(files)) {
        // Get types to map TypeID to TypeName
        const types = await this.caspioService.getTypes().toPromise();
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
        
        // Pre-load all file URLs for faster display
        for (const section of this.fileSections) {
          for (const file of section.files) {
            if (file.FileFile) {
              // Pre-fetch URLs in background
              this.getFileUrl(file.FileFile).then(url => {
                console.log(`Pre-loaded URL for ${file.Description}`);
              }).catch(err => {
                console.error(`Failed to pre-load ${file.FileFile}:`, err);
              });
            }
          }
        }

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
    
    try {
      // For ALL files (images, PDFs, etc), convert to base64 data URL
      // This ensures we have the actual file content for previews
      console.log(`Converting file to base64: ${filePath}`);
      const base64Data = await this.caspioService.getImageFromFilesAPI(filePath).toPromise();
      
      if (base64Data && base64Data.startsWith('data:')) {
        this.fileUrls.set(filePath, base64Data);
        return base64Data;
      }
      
      // Fallback to direct URL if base64 conversion fails
      const account = localStorage.getItem('caspio_account') || 'c7bbd842ec87b9';
      const token = localStorage.getItem('caspio_token');
      const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
      const url = `https://${account}.caspio.com/rest/v2/files/${cleanPath}?access_token=${token}`;
      
      this.fileUrls.set(filePath, url);
      return url;
      
    } catch (error) {
      console.error('Error getting file URL:', error);
      return '';
    }
  }
  
  // Synchronous version for template binding
  getCachedFileUrl(filePath: string): string {
    return this.fileUrls.get(filePath) || '';
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