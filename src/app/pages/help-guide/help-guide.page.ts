import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { CaspioService } from '../../services/caspio.service';

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
  imports: [CommonModule, IonicModule]
})
export class HelpGuidePage implements OnInit {
  fileSections: FileSection[] = [];
  loading = false;
  error = '';

  constructor(
    private caspioService: CaspioService
  ) {}

  ngOnInit() {
    this.loadFiles();
  }

  async loadFiles() {
    this.loading = true;
    this.error = '';

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
          typeName: typeMap.get(typeId) || `Type ${typeId}`,
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

  getFileUrl(filePath: string): string {
    if (!filePath) return '';
    
    // If it's already a full URL, return as is
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      return filePath;
    }
    
    // Otherwise construct Caspio file URL
    const account = localStorage.getItem('caspio_account') || 'c7bbd842ec87b9';
    const token = localStorage.getItem('caspio_token');
    
    // Remove leading slash if present
    const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
    
    // Construct the Caspio Files API URL
    return `https://${account}.caspio.com/rest/v2/files/${cleanPath}?access_token=${token}`;
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

  openFile(filePath: string) {
    const url = this.getFileUrl(filePath);
    if (url) {
      window.open(url, '_blank');
    }
  }

  async doRefresh(event: any) {
    await this.loadFiles();
    event.target.complete();
  }
}