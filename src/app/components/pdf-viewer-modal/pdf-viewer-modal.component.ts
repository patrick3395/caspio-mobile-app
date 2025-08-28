import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';

@Component({
  selector: 'app-pdf-viewer-modal',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <ion-header>
      <ion-toolbar style="--background: #F15A27;">
        <ion-title style="color: white;">PDF Ready - v1.4.154 DEBUG</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()" fill="clear" style="color: white;">
            <ion-icon name="close" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar style="--background: #ff0000;">
        <ion-title style="color: white; text-align: center; font-size: 14px;">
          🚨 ELEVATION PLOT UPDATE v1.4.154 - THIS CONFIRMS YOU'RE SEEING THE UPDATED CODE 🚨
        </ion-title>
      </ion-toolbar>
    </ion-header>
    
    <ion-content>
      <div class="pdf-preview-container">
        <div class="pdf-icon">
          <ion-icon name="document-text-outline"></ion-icon>
        </div>
        <h2>PDF Generated Successfully</h2>
        <p class="filename">{{ fileName }}</p>
        <p class="info">Your PDF report has been generated with all selected items, photos, and measurements.</p>
        
        <div class="action-buttons">
          <ion-button expand="block" color="primary" (click)="downloadPDF()">
            <ion-icon name="download-outline" slot="start"></ion-icon>
            Download PDF
          </ion-button>
          <ion-button expand="block" color="medium" (click)="shareOrOpen()">
            <ion-icon name="share-outline" slot="start"></ion-icon>
            Share / Open in...
          </ion-button>
        </div>
        
        <div class="pdf-contents">
          <h3>PDF Contents Include:</h3>
          <ion-list>
            <ion-item lines="none">
              <ion-icon name="checkmark-circle" slot="start" color="success"></ion-icon>
              <ion-label>Project Details & Cover Page</ion-label>
            </ion-item>
            <ion-item lines="none">
              <ion-icon name="checkmark-circle" slot="start" color="success"></ion-icon>
              <ion-label>Structural Systems Selections</ion-label>
            </ion-item>
            <ion-item lines="none">
              <ion-icon name="checkmark-circle" slot="start" color="success"></ion-icon>
              <ion-label>Elevation Plot Measurements</ion-label>
            </ion-item>
            <ion-item lines="none">
              <ion-icon name="checkmark-circle" slot="start" color="success"></ion-icon>
              <ion-label>Associated Photos</ion-label>
            </ion-item>
          </ion-list>
        </div>
      </div>
    </ion-content>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }
    ion-content {
      --background: #f9f9f9;
    }
    .pdf-preview-container {
      padding: 24px;
      text-align: center;
      max-width: 500px;
      margin: 0 auto;
    }
    .pdf-icon {
      font-size: 80px;
      color: #F15A27;
      margin-bottom: 16px;
    }
    h2 {
      font-size: 24px;
      font-weight: 600;
      color: #333;
      margin: 16px 0;
    }
    .filename {
      font-size: 14px;
      color: #666;
      background: #f0f0f0;
      padding: 8px 12px;
      border-radius: 8px;
      margin: 8px 0;
      word-break: break-all;
    }
    .info {
      color: #666;
      font-size: 15px;
      line-height: 1.4;
      margin: 16px 0 24px;
    }
    .action-buttons {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 32px;
    }
    .pdf-contents {
      background: white;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
      text-align: left;
    }
    .pdf-contents h3 {
      font-size: 16px;
      font-weight: 600;
      color: #333;
      margin-bottom: 12px;
    }
    ion-list {
      background: transparent;
    }
    ion-item {
      --background: transparent;
      --padding-start: 0;
      font-size: 14px;
    }
    ion-item ion-icon[slot="start"] {
      margin-right: 12px;
      font-size: 20px;
    }
  `]
})
export class PDFViewerModal {
  @Input() pdfBlob!: Blob;
  @Input() fileName!: string;
  @Input() projectId!: string;

  constructor(
    private modalController: ModalController
  ) {}

  downloadPDF() {
    // Create a download link for mobile
    const blobUrl = URL.createObjectURL(this.pdfBlob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = this.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Clean up after a short delay
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 100);
  }

  async shareOrOpen() {
    // Try to use native sharing if available
    if ((window as any).navigator && (window as any).navigator.share) {
      try {
        const file = new File([this.pdfBlob], this.fileName, { type: 'application/pdf' });
        await (window as any).navigator.share({
          files: [file],
          title: 'EFE Report',
          text: 'Engineers Foundation Evaluation Report'
        });
      } catch (err) {
        console.log('Share failed, falling back to download', err);
        this.downloadPDF();
      }
    } else {
      // Fall back to download
      this.downloadPDF();
    }
  }

  dismiss() {
    this.modalController.dismiss();
  }
}