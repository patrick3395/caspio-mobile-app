import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'app-pdf-viewer-modal',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-title>PDF Preview</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="downloadPDF()" fill="clear">
            <ion-icon name="download-outline" slot="icon-only"></ion-icon>
          </ion-button>
          <ion-button (click)="dismiss()" fill="clear">
            <ion-icon name="close" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    
    <ion-content>
      <iframe 
        [src]="safePdfUrl" 
        style="width: 100%; height: 100%; border: none;">
      </iframe>
    </ion-content>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }
    ion-content {
      --background: #f0f0f0;
    }
  `]
})
export class PDFViewerModal {
  @Input() pdfUrl!: string;
  @Input() fileName!: string;
  @Input() projectId!: string;
  
  safePdfUrl!: SafeResourceUrl;

  constructor(
    private modalController: ModalController,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    // Sanitize the blob URL for iframe use
    this.safePdfUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.pdfUrl);
  }

  downloadPDF() {
    // Create a download link
    const link = document.createElement('a');
    link.href = this.pdfUrl;
    link.download = this.fileName;
    link.click();
  }

  dismiss() {
    this.modalController.dismiss();
  }

  ngOnDestroy() {
    // Clean up the blob URL
    if (this.pdfUrl) {
      URL.revokeObjectURL(this.pdfUrl);
    }
  }
}