import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';

interface ImageData {
  url: string;
  title: string;
  filename: string;
}

@Component({
  selector: 'app-image-viewer',
  templateUrl: './image-viewer.component.html',
  styleUrls: ['./image-viewer.component.scss'],
  standalone: false
})
export class ImageViewerComponent implements OnInit {
  // Legacy single image inputs (for backward compatibility)
  @Input() base64Data: string = '';
  @Input() title: string = '';
  @Input() filename: string = '';
  
  // New multiple images input
  @Input() images: ImageData[] = [];
  @Input() initialIndex: number = 0;
  
  currentIndex: number = 0;
  isFullscreen: boolean = false;
  private allImages: ImageData[] = [];

  constructor(private modalController: ModalController) {}

  ngOnInit() {
    // If images array is provided, use it
    if (this.images && this.images.length > 0) {
      this.allImages = this.images;
      this.currentIndex = this.initialIndex || 0;
      console.log('🖼️ ImageViewer initialized with multiple images:', this.allImages.length);
    } 
    // Otherwise, fall back to single image mode (backward compatibility)
    else if (this.base64Data) {
      const mimeType = this.getMimeTypeFromFilename(this.filename);
      let imageUrl = this.base64Data;
      
      if (!this.base64Data.includes('base64,')) {
        imageUrl = `data:${mimeType};base64,${this.base64Data}`;
      }
      
      this.allImages = [{
        url: imageUrl,
        title: this.title || 'Document',
        filename: this.filename || 'document.jpg'
      }];
      this.currentIndex = 0;
      console.log('🖼️ ImageViewer initialized in single image mode');
    } else {
      console.error('❌ No image data provided to ImageViewer');
    }
  }

  private getMimeTypeFromFilename(filename: string): string {
    const ext = filename?.split('.').pop()?.toLowerCase();
    const mimeTypes: {[key: string]: string} = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'pdf': 'application/pdf'
    };
    return mimeTypes[ext || ''] || 'image/jpeg';
  }

  // Navigation methods
  previousImage() {
    if (this.hasPrevious()) {
      this.currentIndex--;
    }
  }

  nextImage() {
    if (this.hasNext()) {
      this.currentIndex++;
    }
  }

  selectImage(index: number) {
    if (index >= 0 && index < this.allImages.length) {
      this.currentIndex = index;
    }
  }

  hasPrevious(): boolean {
    return this.currentIndex > 0;
  }

  hasNext(): boolean {
    return this.currentIndex < this.allImages.length - 1;
  }

  hasMultipleImages(): boolean {
    return this.allImages.length > 1;
  }

  // Get current image data
  getCurrentImageUrl(): string {
    return this.allImages[this.currentIndex]?.url || '';
  }

  getCurrentTitle(): string {
    return this.allImages[this.currentIndex]?.title || 'Document';
  }

  getCurrentFilename(): string {
    return this.allImages[this.currentIndex]?.filename || 'document';
  }

  getAllImages(): ImageData[] {
    return this.allImages;
  }

  // Actions
  dismiss() {
    this.modalController.dismiss();
  }

  downloadImage() {
    const current = this.allImages[this.currentIndex];
    if (current) {
      const link = document.createElement('a');
      link.href = current.url;
      link.download = current.filename;
      link.click();
    }
  }

  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;
    
    // Add or remove fullscreen class to ion-content
    const content = document.querySelector('app-image-viewer ion-content');
    if (content) {
      if (this.isFullscreen) {
        content.classList.add('fullscreen-mode');
      } else {
        content.classList.remove('fullscreen-mode');
      }
    }
  }
}