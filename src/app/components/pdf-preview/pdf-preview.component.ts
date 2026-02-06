import { Component, Input, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, Platform, AlertController, ToastController } from '@ionic/angular';
import { PhotoViewerComponent } from '../photo-viewer/photo-viewer.component';
import { CaspioService } from '../../services/caspio.service';
import { PdfDocumentBuilderService } from '../../services/pdf/pdf-document-builder.service';
import { TABLE_LAYOUTS } from '../../services/pdf/pdf-styles';

@Component({
  selector: 'app-pdf-preview',
  standalone: true,
  imports: [CommonModule, IonicModule],
  providers: [CaspioService],
  templateUrl: './pdf-preview.component.html',
  styleUrls: ['./pdf-preview.component.scss']
})
export class PdfPreviewComponent implements OnInit, AfterViewInit {
  @Input() projectData: any;
  @Input() structuralData: any[] = [];
  @Input() elevationData: any[] = [];
  @Input() serviceData: any = {};
  
  hasElevationData = false;
  primaryPhotoData: string | null = null;
  primaryPhotoLoading: boolean = false;
  contentReady = false;  // Made public for template access
  imagesLoading: number = 0;

  constructor(
    private modalController: ModalController,
    private platform: Platform,
    private caspioService: CaspioService,
    private alertController: AlertController,
    private toastController: ToastController,
    private pdfBuilder: PdfDocumentBuilderService
  ) {}

  async ngOnInit() {
    // Start with content not ready
    this.contentReady = false;

    this.hasElevationData = this.elevationData && this.elevationData.length > 0;

    // Process FDF photos in elevation data if needed
    if (this.elevationData && this.elevationData.length > 0) {
      this.elevationData.forEach(room => {
        // FDF photos will be processed during PDF generation
      });
    }

    // Check if primary photo was preloaded
    if (this.projectData?.primaryPhotoBase64) {
      this.primaryPhotoData = this.projectData.primaryPhotoBase64;
    } else {
      // Load primary photo if it's a Caspio file
      await this.loadPrimaryPhotoIfNeeded();
    }

    // Wait a moment for Angular to render the template
    setTimeout(() => {
      this.contentReady = true;
    }, 500);

    // Add print event listeners to force visibility
    this.setupPrintListeners();
  }

  private setupPrintListeners() {
    // Listen for beforeprint event to force visibility
    window.addEventListener('beforeprint', () => {
      this.preparePrintView();
    });

    // Listen for afterprint to clean up
    window.addEventListener('afterprint', () => {
    });
  }

  private preparePrintView() {
    // Force everything to be visible
    this.contentReady = true;

    // Get all key elements and force them visible
    const elementsToShow = [
      '.pdf-container',
      '.pdf-page',
      'ion-content',
      '.pdf-preview-content'
    ];

    elementsToShow.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el: any) => {
        el.style.opacity = '1';
        el.style.visibility = 'visible';
        el.style.display = 'block';
      });
    });

  }
  
  async ngAfterViewInit() {
    // Additional check to ensure content is ready after view init
    if (!this.contentReady) {
      setTimeout(() => {
        this.contentReady = true;
      }, 1000);
    }
  }
  
  // Removed loading dismiss methods - loading is now handled in parent component
  
  async loadPrimaryPhotoIfNeeded() {
    if (!this.projectData?.primaryPhoto) {
      return;
    }
    
    const primaryPhoto = this.projectData.primaryPhoto;
    
    // If it's a Caspio file path (starts with /), load it as base64
    if (typeof primaryPhoto === 'string' && primaryPhoto.startsWith('/')) {
      this.primaryPhotoLoading = true;
      try {
        const imageData = await this.caspioService.getImageFromFilesAPI(primaryPhoto).toPromise();
        
        if (imageData && imageData.startsWith('data:')) {
          this.primaryPhotoData = imageData;
        } else {
          console.error('Failed to load primary photo - invalid data received');
        }
      } catch (error) {
        console.error('Error loading primary photo:', error);
        // Fall back to placeholder
        this.primaryPhotoData = 'assets/img/project-placeholder.svg';
      } finally {
        this.primaryPhotoLoading = false;
      }
    } else if (typeof primaryPhoto === 'string' && (primaryPhoto.startsWith('data:') || primaryPhoto.startsWith('http'))) {
      // Already a usable URL or data URL
      this.primaryPhotoData = primaryPhoto;
    } else {
      this.primaryPhotoData = 'assets/img/project-placeholder.svg';
    }
  }

  getCurrentDate(): string {
    return new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }
  
  getFormattedDate(dateString?: string): string {
    if (!dateString) return this.getCurrentDate();
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    } catch {
      return dateString;
    }
  }
  
  getPrimaryPhotoUrl(): string {
    // If we have loaded base64 data, use it
    if (this.primaryPhotoData) {
      return this.primaryPhotoData;
    }
    
    // If photo is still loading, return loading placeholder
    if (this.primaryPhotoLoading) {
      return 'assets/img/photo-loading.svg';
    }
    
    // Default placeholder if no photo
    return 'assets/img/project-placeholder.svg';
  }

  getAttachmentUrl(photoPath: string): string {
    if (!photoPath) {
      return 'assets/img/photo-placeholder.svg';
    }
    
    if (photoPath.startsWith('/')) {
      const account = this.caspioService.getAccountID();
      const token = this.caspioService.getCurrentToken() || '';
      return `https://${account}.caspio.com/rest/v2/files${photoPath}?access_token=${token}`;
    }
    
    return photoPath;
  }
  
  getPhotoUrl(photo: any): string {
    if (!photo) {
      console.warn('[PDF Preview] getPhotoUrl called with null/undefined photo');
      return 'assets/img/photo-placeholder.svg';
    }

    // Prioritize displayUrl (annotated version) over regular url, matching the thumbnail behavior
    const photoPath = photo.displayUrl || photo.url || photo.Photo || photo.Attachment || photo.filePath || photo;

    // Log the photo path for debugging mobile issues
    if (typeof photoPath !== 'string') {
      console.warn('[PDF Preview] Photo path is not a string:', photoPath);
      return 'assets/img/photo-placeholder.svg';
    }

    // Data URL (base64) - this is the preferred format
    if (photoPath.startsWith('data:')) {
      // Validate base64 length to ensure it's not corrupted
      if (photoPath.length < 100) {
        console.warn('[PDF Preview] Base64 URL seems too short:', photoPath.substring(0, 50));
        return 'assets/img/photo-placeholder.svg';
      }
      return photoPath;
    }

    // Already a full URL or blob URL
    if (photoPath.startsWith('http') || photoPath.startsWith('blob:')) {
      return photoPath;
    }

    // Caspio file path - WARNING: This shouldn't happen if conversion worked
    if (photoPath.startsWith('/')) {
      console.warn('[PDF Preview] Using Caspio file path (base64 conversion may have failed):', photoPath);
      const account = this.caspioService.getAccountID();
      const token = this.caspioService.getCurrentToken() || '';

      if (!token) {
        console.error('[PDF Preview] No token available for Caspio file path');
        return 'assets/img/photo-placeholder.svg';
      }

      const photoUrl = `https://${account}.caspio.com/rest/v2/files${photoPath}?access_token=${token}`;
      return photoUrl;
    }

    console.warn('[PDF Preview] Unknown photo path format:', photoPath.substring(0, 50));
    return photoPath || 'assets/img/photo-placeholder.svg';
  }

  getElevationPageNumber(): number {
    return this.structuralData?.length ? 6 + Math.ceil(this.structuralData.length / 2) : 6;
  }

  getTotalMeasurements(): number {
    if (!this.elevationData) return 0;
    return this.elevationData.reduce((total, room) => {
      // Count all points, not just those with values, as they represent measurement locations
      const pointCount = room.points ? room.points.length : 0;
      return total + pointCount;
    }, 0);
  }

  getTotalElevationPhotos(): number {
    if (!this.elevationData) return 0;
    return this.elevationData.reduce((total, room) => {
      const roomPhotos = room.photos ? room.photos.length : 0;
      const pointPhotos = room.points ? room.points.reduce((sum: number, point: any) => {
        // Count actual photos array if available, otherwise use photoCount
        const photoCount = point.photos ? point.photos.length : (point.photoCount || 0);
        return sum + photoCount;
      }, 0) : 0;
      return total + roomPhotos + pointPhotos;
    }, 0);
  }

  async generatePDF() {
    const loading = await this.alertController.create({
      header: 'Downloading Report',
      message: 'Building PDF document...',
      buttons: [{ text: 'Cancel', handler: () => true }],
      backdropDismiss: false,
      cssClass: 'template-loading-alert'
    });
    await loading.present();

    try {
      loading.message = 'Loading PDF library...';
      const pdfMakeModule = await import('pdfmake/build/pdfmake');
      const pdfMake = pdfMakeModule.default || pdfMakeModule;
      const pdfFontsModule: any = await import('pdfmake/build/vfs_fonts');
      const pdfFonts = pdfFontsModule.default || pdfFontsModule;
      (pdfMake as any).vfs = pdfFonts.pdfMake?.vfs || pdfFonts.vfs || pdfFonts;

      loading.message = 'Building document...';
      const docDefinition = await this.pdfBuilder.buildDocument(
        this.projectData,
        this.structuralData,
        this.elevationData,
        this.serviceData
      );

      // Register custom table layouts
      (pdfMake as any).tableLayouts = TABLE_LAYOUTS;

      loading.message = 'Generating PDF file...';
      const projectId = this.projectData?.projectId || 'draft';
      const clientName = (this.projectData?.clientName || 'Client').replace(/[^a-z0-9]/gi, '_');
      const date = new Date().toISOString().split('T')[0];
      const fileName = `EFE_Report_${clientName}_${projectId}_${date}.pdf`;

      (pdfMake as any).createPdf(docDefinition).download(fileName);

      await loading.dismiss();
      await this.showToast('PDF downloaded successfully!', 'success');
    } catch (error) {
      console.error('[PDF] Error generating PDF:', error);
      await loading.dismiss();
      await this.showToast('Failed to download PDF: ' + (error as Error).message, 'danger');
    }
  }
  
  private async showToast(message: string, color: string = 'primary') {
    if (color === 'success' || color === 'info') return;
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  private hasPhotos(): boolean {
    let hasPhotos = false;
    
    if (this.structuralData) {
      this.structuralData.forEach(category => {
        ['comments', 'limitations', 'deficiencies'].forEach(type => {
          if (category[type]) {
            category[type].forEach((item: any) => {
              if (item.photos && item.photos.length > 0) {
                hasPhotos = true;
              }
            });
          }
        });
      });
    }
    
    if (this.elevationData) {
      this.elevationData.forEach(room => {
        if (room.photos && room.photos.length > 0) {
          hasPhotos = true;
        }
      });
    }
    
    return hasPhotos;
  }

  countVisualFindings(): number {
    let count = 0;
    
    if (this.structuralData) {
      this.structuralData.forEach(category => {
        count += (category.comments?.length || 0);
        count += (category.limitations?.length || 0);
        count += (category.deficiencies?.length || 0);
      });
    }
    
    return count;
  }

  getDeficiencyCount(category: any): number {
    return category?.deficiencies?.length || 0;
  }

  getTotalDeficiencyCount(): number {
    let total = 0;
    if (this.structuralData) {
      this.structuralData.forEach(category => {
        total += (category.deficiencies?.length || 0);
      });
    }
    return total;
  }

  countTotalPhotos(): number {
    let count = 0;
    
    if (this.structuralData) {
      this.structuralData.forEach(category => {
        ['comments', 'limitations', 'deficiencies'].forEach(type => {
          if (category[type]) {
            category[type].forEach((item: any) => {
              count += (item.photos?.length || 0);
            });
          }
        });
      });
    }
    
    if (this.elevationData) {
      this.elevationData.forEach(room => {
        count += (room.photos?.length || 0);
        room.points?.forEach((point: any) => {
          count += (point.photoCount || 0);
        });
      });
    }
    
    return count;
  }

  private getAllPhotos(): any[] {
    const photos: any[] = [];
    
    if (this.structuralData) {
      this.structuralData.forEach(category => {
        ['comments', 'limitations', 'deficiencies'].forEach(type => {
          if (category[type]) {
            category[type].forEach((item: any) => {
              if (item.photos) {
                item.photos.forEach((photo: any) => {
                  photos.push({
                    category: category.name,
                    type: type,
                    item: item.name,
                    photo: photo
                  });
                });
              }
            });
          }
        });
      });
    }
    
    if (this.elevationData) {
      this.elevationData.forEach(room => {
        if (room.photos) {
          room.photos.forEach((photo: any) => {
            photos.push({
              category: 'Elevation Plot',
              type: room.name,
              item: 'Room Photo',
              photo: photo
            });
          });
        }
      });
    }
    
    return photos;
  }

  dismiss() {
    this.modalController.dismiss();
  }

  /**
   * Opens a photo in compact popup viewer
   * @param photoUrl - The URL or data URL of the photo to view
   * @param caption - Optional caption for the photo
   */
  async openPhotoViewer(photoUrl: string, caption?: string) {
    const modal = await this.modalController.create({
      component: PhotoViewerComponent,
      componentProps: {
        photoUrl: photoUrl,
        photoCaption: caption,
        canAnnotate: false,
        enableCaption: !!caption
      },
      cssClass: 'compact-photo-modal',
      backdropDismiss: true,
      showBackdrop: true
    });

    await modal.present();
  }

  handleImageError(event: any) {
    const failedSrc = event.target.src;
    const srcType = failedSrc.startsWith('data:') ? 'base64' :
                    failedSrc.startsWith('http') ? 'http' :
                    failedSrc.startsWith('blob:') ? 'blob' :
                    failedSrc.startsWith('/') ? 'path' : 'unknown';

    console.error('[PDF Preview] Image failed to load:', {
      type: srcType,
      length: failedSrc.length,
      preview: failedSrc.substring(0, 100),
      platform: this.platform.is('ios') ? 'iOS' : this.platform.is('android') ? 'Android' : 'Web'
    });

    // Don't replace if it's already the placeholder
    if (!failedSrc.includes('project-placeholder.svg') && !failedSrc.includes('photo-placeholder.svg')) {
      event.target.src = 'assets/img/photo-placeholder.svg';
    }
    event.target.classList.remove('loading');
    this.primaryPhotoLoading = false;

    // Decrement loading counter and check if we should dismiss
    if (this.imagesLoading > 0) {
      this.imagesLoading--;
      this.checkAndDismissLoading();
    }
  }
  
  handleImageLoad(event: any) {
    event.target.classList.remove('loading');
    this.primaryPhotoLoading = false;
    
    // Decrement loading counter and check if we should dismiss
    if (this.imagesLoading > 0) {
      this.imagesLoading--;
      this.checkAndDismissLoading();
    }
  }
  
  private checkAndDismissLoading() {
    // Placeholder method to check and dismiss loading if needed
    // Can be implemented later if loading state management is required
  }

}


