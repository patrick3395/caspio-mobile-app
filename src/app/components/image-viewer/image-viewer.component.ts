import { Component, Input, OnInit } from '@angular/core';
import { ModalController } from '@ionic/angular';

@Component({
  selector: 'app-image-viewer',
  templateUrl: './image-viewer.component.html',
  styleUrls: ['./image-viewer.component.scss'],
  standalone: false
})
export class ImageViewerComponent implements OnInit {
  @Input() base64Data: string = '';
  @Input() title: string = '';
  @Input() filename: string = '';
  
  imageDataUrl: string = '';

  constructor(private modalController: ModalController) {}

  ngOnInit() {
    console.log('🖼️ ImageViewer initialized with:', {
      title: this.title,
      filename: this.filename,
      base64DataLength: this.base64Data ? this.base64Data.length : 0,
      base64DataStart: this.base64Data ? this.base64Data.substring(0, 50) : null
    });
    
    // Convert base64 to data URL for display
    if (this.base64Data) {
      const mimeType = this.getMimeTypeFromFilename(this.filename);
      if (this.base64Data.includes('base64,')) {
        this.imageDataUrl = this.base64Data;
      } else {
        this.imageDataUrl = `data:${mimeType};base64,${this.base64Data}`;
      }
      console.log('🖼️ Image data URL created, length:', this.imageDataUrl.length);
    } else {
      console.error('❌ No base64 data provided to ImageViewer');
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

  dismiss() {
    this.modalController.dismiss();
  }

  downloadImage() {
    const link = document.createElement('a');
    link.href = this.imageDataUrl;
    link.download = this.filename || 'document.jpg';
    link.click();
  }
}