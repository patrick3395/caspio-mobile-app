import { Component, Input, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, LoadingController, Platform, AlertController, ToastController } from '@ionic/angular';
import { PDFViewerModal } from '../pdf-viewer-modal/pdf-viewer-modal.component';
import { PhotoViewerComponent } from '../photo-viewer/photo-viewer.component';
import { firstValueFrom } from 'rxjs';
import { CaspioService } from '../../services/caspio.service';
// jsPDF is now lazy-loaded when needed

// Type definition for jsPDF to avoid TypeScript errors
type jsPDF = any;

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
  imageCache: Map<string, string> = new Map();
  primaryPhotoData: string | null = null;
  primaryPhotoLoading: boolean = false;
  contentReady = false;  // Made public for template access
  imagesLoading: number = 0;

  constructor(
    private modalController: ModalController,
    private loadingController: LoadingController,
    private platform: Platform,
    private caspioService: CaspioService,
    private alertController: AlertController,
    private toastController: ToastController
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
      console.log('[PDF Print] beforeprint event fired');
      this.preparePrintView();
    });

    // Listen for afterprint to clean up
    window.addEventListener('afterprint', () => {
      console.log('[PDF Print] afterprint event fired');
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

    console.log('[PDF Print] Forced visibility on elements');
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
      console.log('[PDF Preview] Using HTTP/blob URL:', photoPath.substring(0, 100));
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
      message: 'Generating PDF from preview...',
      buttons: [
        {
          text: 'Cancel',
          handler: () => {
            return true; // Allow dismissal
          }
        }
      ],
      backdropDismiss: false,
      cssClass: 'template-loading-alert'
    });
    await loading.present();

    try {
      // Ensure content is ready
      this.contentReady = true;
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get all page elements
      const pages = document.querySelectorAll('.pdf-page');
      if (!pages || pages.length === 0) {
        throw new Error('No PDF pages found');
      }

      console.log('[PDF] Found', pages.length, 'pages to process');

      // Load libraries
      const jsPDFModule = await import('jspdf');
      const jsPDF = jsPDFModule.default || jsPDFModule;
      const html2canvas = (await import('html2canvas')).default;

      // Create PDF
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'letter',
        compress: true
      }) as any;

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // Process each page individually
      for (let i = 0; i < pages.length; i++) {
        const pageElement = pages[i] as HTMLElement;

        // Update progress
        loading.message = `Processing page ${i + 1} of ${pages.length}...`;

        console.log(`[PDF] Processing page ${i + 1}/${pages.length}`);

        try {
          // Extract text content from the page BEFORE converting to image
          const textContent = this.extractTextFromElement(pageElement);
          console.log(`[PDF] Extracted ${textContent.length} text elements from page ${i + 1}`);

          // Scroll the original page into view first to ensure images are loaded
          pageElement.scrollIntoView({ behavior: 'auto', block: 'start' });

          // Wait longer for images to load in the original before cloning
          await new Promise(resolve => setTimeout(resolve, 800));

          // Clone the page element to avoid modal issues
          const clone = pageElement.cloneNode(true) as HTMLElement;

          // Get the computed dimensions from the original element
          const originalWidth = pageElement.offsetWidth;
          const originalHeight = pageElement.offsetHeight;

          // Check if this is the cover page (has special flex layout)
          const isCoverPage = pageElement.classList.contains('cover-page');

          // Style the clone to be visible but off-screen with exact dimensions
          clone.style.position = 'fixed';
          clone.style.left = '0';
          clone.style.top = '0';
          clone.style.width = originalWidth + 'px';
          clone.style.minWidth = originalWidth + 'px';
          clone.style.maxWidth = originalWidth + 'px';
          clone.style.zIndex = '-9999';
          clone.style.opacity = '1';
          clone.style.visibility = 'visible';
          clone.style.overflow = 'visible';

          // For cover page, preserve flex layout; otherwise use block
          if (isCoverPage) {
            clone.style.display = 'flex';
            clone.style.flexDirection = 'column';
            clone.style.minHeight = originalHeight + 'px';
          } else {
            clone.style.display = 'block';
            clone.style.height = originalHeight + 'px';
          }

          // Append to body (outside modal)
          document.body.appendChild(clone);

          // For cover page, ensure the photo container and image maintain their exact size
          if (isCoverPage) {
            const originalPhotoContainer = pageElement.querySelector('.property-photo-container') as HTMLElement;
            const clonedPhotoContainer = clone.querySelector('.property-photo-container') as HTMLElement;

            if (originalPhotoContainer && clonedPhotoContainer) {
              const containerHeight = originalPhotoContainer.offsetHeight;
              clonedPhotoContainer.style.minHeight = containerHeight + 'px';
              clonedPhotoContainer.style.height = containerHeight + 'px';

              // Set the image to its exact rendered size (not max size)
              const originalImg = originalPhotoContainer.querySelector('img') as HTMLElement;
              const clonedImg = clonedPhotoContainer.querySelector('img') as HTMLElement;

              if (originalImg && clonedImg) {
                // Get the actual rendered dimensions of the original image
                const imgWidth = originalImg.offsetWidth;
                const imgHeight = originalImg.offsetHeight;

                // Get natural (source) image dimensions
                const naturalWidth = (originalImg as HTMLImageElement).naturalWidth;
                const naturalHeight = (originalImg as HTMLImageElement).naturalHeight;

                console.log(`[PDF] Original cover image rendered size: ${imgWidth}x${imgHeight}`);
                console.log(`[PDF] Original cover image natural size: ${naturalWidth}x${naturalHeight}`);
                console.log(`[PDF] Original cover image aspect ratio: ${(naturalWidth/naturalHeight).toFixed(2)}, rendered ratio: ${(imgWidth/imgHeight).toFixed(2)}`);

                // Use the natural image dimensions to preserve aspect ratio
                // Scale to match the rendered width
                const scale = imgWidth / naturalWidth;
                const scaledHeight = naturalHeight * scale;

                console.log(`[PDF] Scaling image by ${scale.toFixed(2)}, target size: ${imgWidth}x${scaledHeight}`);

                // Set dimensions maintaining proper aspect ratio
                clonedImg.style.width = imgWidth + 'px';
                clonedImg.style.height = scaledHeight + 'px';
                clonedImg.style.maxWidth = 'none';
                clonedImg.style.maxHeight = 'none';
                clonedImg.style.objectFit = 'contain'; // Keep contain to preserve aspect ratio
                clonedImg.style.display = 'block';
              }
            }
          } else {
            // CRITICAL FIX: For non-cover pages, fix aspect ratio for ALL images
            // This prevents stretching in the exported PDF
            const allImages = clone.querySelectorAll('img');
            let fixedImageCount = 0;

            allImages.forEach((img: HTMLImageElement) => {
              // Skip if image hasn't loaded yet
              if (!img.complete || img.naturalWidth === 0) {
                return;
              }

              const naturalWidth = img.naturalWidth;
              const naturalHeight = img.naturalHeight;
              const aspectRatio = naturalWidth / naturalHeight;

              // Get the current container width (respects grid layout)
              const containerWidth = img.offsetWidth || img.parentElement?.offsetWidth || 0;

              if (containerWidth > 0) {
                // Calculate height that maintains aspect ratio
                const correctHeight = containerWidth / aspectRatio;

                // Force exact dimensions to prevent stretching
                img.style.width = containerWidth + 'px';
                img.style.height = correctHeight + 'px';
                img.style.maxWidth = 'none';
                img.style.maxHeight = 'none';
                img.style.objectFit = 'contain';
                img.style.display = 'block';

                fixedImageCount++;
              }
            });

            if (fixedImageCount > 0) {
              console.log(`[PDF] Fixed aspect ratio for ${fixedImageCount} images on page ${i + 1}`);
            }
          }

          // Ensure all images are loaded in the clone
          const images = clone.querySelectorAll('img');
          const imageCount = images.length;
          console.log(`[PDF] Page ${i + 1} has ${imageCount} images`);

          // Wait for all images to load (don't force reload if already loaded)
          let loadedCount = 0;
          let failedCount = 0;

          await Promise.all(
            Array.from(images).map((img: HTMLImageElement, idx) => {
              // Check if image is already properly loaded
              if (img.complete && img.naturalWidth > 0) {
                loadedCount++;
                return Promise.resolve();
              }

              // If not loaded, wait for it to load
              return new Promise((resolve) => {
                img.onload = () => {
                  loadedCount++;
                  resolve(true);
                };
                img.onerror = () => {
                  failedCount++;
                  console.warn(`[PDF] Image ${idx + 1}/${imageCount} failed: ${img.src.substring(0, 100)}`);
                  resolve(true);
                };
                // Timeout after 3 seconds per image
                setTimeout(() => {
                  console.warn(`[PDF] Image ${idx + 1}/${imageCount} timeout: ${img.src.substring(0, 100)}`);
                  resolve(true);
                }, 3000);
              });
            })
          );

          console.log(`[PDF] Page ${i + 1}: ${loadedCount}/${imageCount} images loaded, ${failedCount} failed`);

          // Wait for render
          await new Promise(resolve => setTimeout(resolve, 300));

          // Log cloned image size after render for cover page
          if (isCoverPage) {
            const clonedImg = clone.querySelector('.property-photo-container img') as HTMLElement;
            if (clonedImg) {
              console.log(`[PDF] Cloned image size after render: ${clonedImg.offsetWidth}x${clonedImg.offsetHeight}`);
            }
          }

          // Capture the cloned element - special handling for cover page
          const canvas = await html2canvas(clone, {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#ffffff',
            logging: false,
            width: originalWidth,
            // Only set height for non-cover pages to prevent stretching
            ...(isCoverPage ? {} : { height: originalHeight })
          });

          console.log(`[PDF] Canvas size for page ${i + 1}: ${canvas.width}x${canvas.height}`);

          // Remove the clone
          document.body.removeChild(clone);

          if (canvas.width === 0 || canvas.height === 0) {
            console.warn(`[PDF] Page ${i + 1} has zero dimensions, skipping`);
            continue;
          }

          // Convert canvas to image
          const imgData = canvas.toDataURL('image/jpeg', 0.95);

          // Calculate dimensions to fit page
          const imgWidth = pageWidth;
          const imgHeight = (canvas.height * pageWidth) / canvas.width;

          // Check if content exceeds page height and needs to be split
          if (imgHeight > pageHeight) {
            console.log(`[PDF] Page ${i + 1} content is too tall (${imgHeight}mm > ${pageHeight}mm), splitting across multiple pages`);

            // Calculate how many PDF pages we need
            const numPages = Math.ceil(imgHeight / pageHeight);
            console.log(`[PDF] Splitting into ${numPages} pages`);

            // Split the canvas into multiple pages
            for (let pageIdx = 0; pageIdx < numPages; pageIdx++) {
              // Add new page for all except first
              if (i > 0 || pageIdx > 0) {
                pdf.addPage();
              }

              // Calculate the source Y position in the canvas (in pixels)
              const sourceY = (pageIdx * pageHeight * canvas.width) / imgWidth;
              const sourceHeight = Math.min((pageHeight * canvas.width) / imgWidth, canvas.height - sourceY);

              // Create a temporary canvas for this slice
              const sliceCanvas = document.createElement('canvas');
              sliceCanvas.width = canvas.width;
              sliceCanvas.height = sourceHeight;
              const sliceCtx = sliceCanvas.getContext('2d');

              if (sliceCtx) {
                // Draw the slice from the main canvas
                sliceCtx.drawImage(canvas, 0, sourceY, canvas.width, sourceHeight, 0, 0, canvas.width, sourceHeight);

                // Convert slice to image
                const sliceImgData = sliceCanvas.toDataURL('image/jpeg', 0.95);

                // Calculate the height for this slice in PDF units
                const sliceImgHeight = (sourceHeight * pageWidth) / canvas.width;

                // Add the slice to PDF
                pdf.addImage(sliceImgData, 'JPEG', 0, 0, imgWidth, sliceImgHeight);

                // Add text layer for this slice (proportional to the slice)
                const sliceRatio = pageIdx / numPages;
                const sliceTextContent = this.filterTextForSlice(textContent, sliceRatio, 1 / numPages, imgHeight);
                this.addTextLayer(pdf, sliceTextContent, pageWidth, sliceImgHeight);

                console.log(`[PDF] Added page ${i + 1}-${pageIdx + 1} (${imgWidth}mm x ${sliceImgHeight}mm) with text layer`);
              }
            }
          } else {
            // Content fits on one page
            // Add new page for all except first
            if (i > 0) {
              pdf.addPage();
            }

            // Add image to PDF
            pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);

            // Add invisible text layer for text extraction (OCR-like functionality)
            this.addTextLayer(pdf, textContent, pageWidth, imgHeight);

            console.log(`[PDF] Added page ${i + 1} (${imgWidth}mm x ${imgHeight}mm) with text layer`);
          }

        } catch (pageError) {
          console.error(`[PDF] Error processing page ${i + 1}:`, pageError);
          // Continue with next page
        }
      }

      // Generate filename
      const projectId = this.projectData?.projectId || 'draft';
      const clientName = (this.projectData?.clientName || 'Client').replace(/[^a-z0-9]/gi, '_');
      const date = new Date().toISOString().split('T')[0];
      const fileName = `EFE_Report_${clientName}_${projectId}_${date}.pdf`;

      console.log('[PDF] Saving PDF...');

      // Save the PDF
      pdf.save(fileName);

      console.log('[PDF] PDF generated successfully');

      await loading.dismiss();
      await this.showToast('PDF downloaded successfully!', 'success');

    } catch (error) {
      console.error('[PDF] Error generating PDF:', error);
      await loading.dismiss();
      await this.showToast('Failed to download PDF: ' + (error as Error).message, 'danger');
    }
  }

  /**
   * Downloads the PDF file to the user's device
   * Works for both web browsers and mobile devices
   */
  private async downloadPDF(pdf: any, fileName: string): Promise<void> {
    const isMobile = this.platform.is('ios') || this.platform.is('android');

    if (isMobile) {
      // For mobile: Create blob and trigger download via anchor element
      const pdfBlob = pdf.output('blob');
      const blobUrl = URL.createObjectURL(pdfBlob);

      // Create a temporary anchor element
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      link.style.display = 'none';

      // Add to DOM, click, and remove
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up the blob URL after a delay
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 100);

      console.log('[PDF Download] Mobile download triggered:', fileName);
    } else {
      // For web browsers: Use jsPDF's built-in save method
      pdf.save(fileName);
      console.log('[PDF Download] Web download triggered:', fileName);
    }
  }

  private async addCoverPage(pdf: jsPDF, pageWidth: number, pageHeight: number, margin: number) {
    const serviceName = this.serviceData?.serviceName || 'EFE - Engineer\'s Foundation Evaluation';
    const companyName = this.projectData?.companyName || 'Noble Property Inspections';
    const address = this.projectData?.address || 'Property Address';
    const city = this.projectData?.city || 'City';
    const state = this.projectData?.state || 'ST';
    const zip = this.projectData?.zip || '00000';
    const cityStateZip = `${city}, ${state} ${zip}`;
    const clientName = this.projectData?.clientName || 'Client';
    const agentName = this.projectData?.agentName || 'N/A';
    const reportDate = this.getFormattedDate(this.projectData?.inspectionDate);

    pdf.setTextColor(34, 34, 34);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(26);
    pdf.text(serviceName, pageWidth / 2, 48, { align: 'center' });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(12);
    pdf.text(`Prepared by ${companyName}`, pageWidth / 2, 64, { align: 'center' });

    let imageBottom = 64;

    try {
      const primaryPhotoUrl = this.getPrimaryPhotoUrl();
      if (primaryPhotoUrl && !primaryPhotoUrl.includes('placeholder')) {
        const imgData = await this.loadImage(primaryPhotoUrl);
        if (imgData) {
          const imgWidth = 175;  // Increased from 165mm to 175mm
          const imgHeight = 117; // Increased from 110mm to 117mm
          const imageTop = 78;
          pdf.addImage(imgData, 'JPEG', (pageWidth - imgWidth) / 2, imageTop, imgWidth, imgHeight);
          imageBottom = imageTop + imgHeight;
        }
      }
    } catch (error) {
    }

    const boxY = imageBottom + 24;
    const boxHeight = 68; // Increased from 58 to accommodate Agent field
    pdf.setDrawColor(220, 220, 220);
    pdf.setLineWidth(0.6);
    pdf.rect(margin, boxY, pageWidth - (margin * 2), boxHeight, 'S');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.text(address, pageWidth / 2, boxY + 14, { align: 'center' });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    pdf.text(cityStateZip, pageWidth / 2, boxY + 26, { align: 'center' });
    pdf.text(`Client: ${clientName}`, pageWidth / 2, boxY + 40, { align: 'center' });
    pdf.text(`Agent: ${agentName}`, pageWidth / 2, boxY + 52, { align: 'center' });
    pdf.text(`Date: ${reportDate}`, pageWidth / 2, boxY + 64, { align: 'center' });
  }

  private async addDeficiencySummary(pdf: jsPDF, margin: number, contentWidth: number, pageNum: number) {
    this.addPageHeader(pdf, 'DEFICIENCY SUMMARY', margin);
    this.addPageFooter(pdf, pageNum);
    
    let yPos = 60;
    
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'normal');
    
    if (this.structuralData && this.structuralData.length > 0) {
      this.structuralData.forEach(category => {
        const deficiencyCount = category.deficiencies?.length || 0;
        const defectText = deficiencyCount !== 1 ? 'Defects' : 'Defect';
        
        pdf.setFont('helvetica', 'bold');
        pdf.text(`${category.name}:`, margin, yPos);
        
        pdf.setFont('helvetica', 'normal');
        pdf.text(`${deficiencyCount} ${defectText} Found`, margin + 100, yPos);
        
        yPos += 10;
      });
      
      // Add total
      yPos += 5;
      const totalDeficiencies = this.getTotalDeficiencyCount();
      const totalDefectText = totalDeficiencies !== 1 ? 'Defects' : 'Defect';
      
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(14);
      pdf.text('Total:', margin, yPos);
      pdf.text(`${totalDeficiencies} Total ${totalDefectText}`, margin + 100, yPos);
    }
  }

  private addTableOfContents(pdf: jsPDF, margin: number, contentWidth: number, pageNum: number) {
    this.addPageHeader(pdf, 'TABLE OF CONTENTS', margin);
    this.addPageFooter(pdf, pageNum);
    
    let yPos = 50;
    let currentPage = 4;
    
    const tocItems = [
      { title: '1. Executive Summary', page: 2 },
      { title: '2. Project Information', page: 4 },
      { title: '3. Service Details', page: 5 },
    ];
    
    // Add structural systems sections
    if (this.structuralData && this.structuralData.length > 0) {
      this.structuralData.forEach((category, index) => {
        tocItems.push({
          title: `${4 + index}. ${category.name}`,
          page: 6 + index
        });
        currentPage = 6 + index;
      });
    }
    
    // Add elevation plot if exists
    if (this.elevationData && this.elevationData.length > 0) {
      currentPage++;
      tocItems.push({
        title: `${tocItems.length + 1}. Elevation Plot Data`,
        page: currentPage
      });
    }
    
    // Add photo gallery if exists
    if (this.hasPhotos()) {
      currentPage++;
      tocItems.push({
        title: `${tocItems.length + 1}. Appendix: Photo Documentation`,
        page: currentPage
      });
    }
    
    // Render TOC with dotted lines
    pdf.setFontSize(12);
    tocItems.forEach(item => {
      pdf.setFont('helvetica', 'normal');
      pdf.text(item.title, margin, yPos);
      
      // Add dotted line
      const titleWidth = pdf.getTextWidth(item.title);
      const pageText = item.page.toString();
      const pageWidth = pdf.getTextWidth(pageText);
      const dotStart = margin + titleWidth + 5;
      const dotEnd = margin + contentWidth - pageWidth - 5;
      
      pdf.setLineDashPattern([1, 2], 0);
      pdf.line(dotStart, yPos - 1, dotEnd, yPos - 1);
      pdf.setLineDashPattern([], 0);
      
      pdf.text(pageText, margin + contentWidth - pageWidth, yPos);
      yPos += 8;
    });
  }

  private async addProjectInformation(pdf: jsPDF, margin: number, contentWidth: number, pageNum: number) {
    this.addPageHeader(pdf, 'PROJECT INFORMATION', margin);
    this.addPageFooter(pdf, pageNum);
    
    let yPos = 50;
    
    // Create information grid
    const projectInfo = [
      { label: 'Project ID', value: this.projectData?.projectId || 'N/A' },
      { label: 'Property Address', value: this.projectData?.fullAddress || 'N/A' },
      { label: 'Client Name', value: this.projectData?.clientName || 'N/A' },
      { label: 'Agent Name', value: this.projectData?.agentName || 'N/A' },
      { label: 'Inspector Name', value: this.projectData?.inspectorName || 'N/A' },
      { label: 'Year Built', value: this.projectData?.yearBuilt || 'N/A' },
      { label: 'Square Feet', value: this.projectData?.squareFeet || 'N/A' },
      { label: 'Type of Building', value: this.projectData?.typeOfBuilding || 'Single Family' },
      { label: 'Building Style', value: this.projectData?.style || 'N/A' },
      { label: 'Foundation Type', value: this.projectData?.buildingType || 'Post-Tension' }
    ];
    
    // Use autoTable for better formatting
    const tableData = projectInfo.map(item => [item.label, item.value]);
    
    (pdf as any).autoTable({
      startY: yPos,
      head: [],
      body: tableData,
      theme: 'plain',
      styles: {
        fontSize: 11,
        cellPadding: 5
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 50 },
        1: { cellWidth: 'auto' }
      },
      margin: { left: margin, right: margin }
    });
  }

  private async addServiceDetails(pdf: jsPDF, margin: number, contentWidth: number, pageNum: number) {
    this.addPageHeader(pdf, 'SERVICE & INSPECTION DETAILS', margin);
    this.addPageFooter(pdf, pageNum);
    
    let yPos = 50;
    
    const serviceInfo = [
      { label: 'Date of Inspection', value: this.getFormattedDate(this.serviceData?.DateOfInspection) },
      { label: 'Date of Request', value: this.getFormattedDate(this.serviceData?.DateOfRequest) },
      { label: 'Weather Conditions', value: this.serviceData?.WeatherConditions || 'Clear' },
      { label: 'Outdoor Temperature', value: this.serviceData?.OutdoorTemperature || '75°F' },
      { label: 'In Attendance', value: this.serviceData?.InAttendance || 'Owner' },
      { label: 'Occupancy/Furnishings', value: this.serviceData?.OccupancyFurnishings || 'Occupied/Furnished' }
    ];
    
    // Foundation Types
    if (this.serviceData?.FirstFoundationType) {
      serviceInfo.push({ label: 'Primary Foundation Type', value: this.serviceData.FirstFoundationType });
    }
    if (this.serviceData?.SecondFoundationType) {
      serviceInfo.push({ 
        label: 'Secondary Foundation Type', 
        value: `${this.serviceData.SecondFoundationType}${this.serviceData.SecondFoundationRooms ? ` (${this.serviceData.SecondFoundationRooms})` : ''}`
      });
    }
    if (this.serviceData?.ThirdFoundationType) {
      serviceInfo.push({ 
        label: 'Additional Foundation Type', 
        value: `${this.serviceData.ThirdFoundationType}${this.serviceData.ThirdFoundationRooms ? ` (${this.serviceData.ThirdFoundationRooms})` : ''}`
      });
    }
    
    if (this.serviceData?.OwnerOccupantInterview) {
      serviceInfo.push({ label: 'Owner/Occupant Interview', value: this.serviceData.OwnerOccupantInterview });
    }
    
    const tableData = serviceInfo.map(item => [item.label, item.value]);
    
    (pdf as any).autoTable({
      startY: yPos,
      head: [],
      body: tableData,
      theme: 'plain',
      styles: {
        fontSize: 11,
        cellPadding: 5
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 60 },
        1: { cellWidth: 'auto' }
      },
      margin: { left: margin, right: margin }
    });
    
    // Add notes if available
    if (this.serviceData?.Notes) {
      const finalY = (pdf as any).lastAutoTable.finalY + 15;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.text('Service Notes:', margin, finalY);
      
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      const notes = pdf.splitTextToSize(this.serviceData.Notes, contentWidth);
      pdf.text(notes, margin, finalY + 8);
    }
  }

  private async addStructuralSystemsSection(pdf: jsPDF, category: any, margin: number, contentWidth: number, pageNum: number, pageHeight: number) {
    this.addPageHeader(pdf, category.name.toUpperCase(), margin);
    this.addPageFooter(pdf, pageNum);
    
    let yPos = 50;
    const maxY = pageHeight - 200; // MASSIVE bottom margin for white space (200mm = ~7.9 inches)
    
    // Comments Section
    if (category.comments && category.comments.length > 0) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(14);
      pdf.setFillColor(241, 90, 39);
      pdf.rect(margin - 2, yPos - 5, contentWidth + 4, 8, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.text('COMMENTS', margin, yPos);
      pdf.setTextColor(51, 51, 51);
      yPos += 12;
      
      for (const item of category.comments) {
        if (yPos > maxY - 30) { // Check for page break with extra margin
          pdf.addPage();
          pageNum++;
          this.addPageHeader(pdf, category.name.toUpperCase() + ' (CONTINUED)', margin);
          this.addPageFooter(pdf, pageNum);
          yPos = 50;
        }
        
        yPos = await this.addEnhancedVisualItem(pdf, item, margin, contentWidth, yPos, maxY);
      }
    }
    
    // Limitations Section
    if (category.limitations && category.limitations.length > 0) {
      if (yPos > maxY - 30) { // Check for page break with extra margin
        pdf.addPage();
        pageNum++;
        this.addPageHeader(pdf, category.name.toUpperCase() + ' (CONTINUED)', margin);
        this.addPageFooter(pdf, pageNum);
        yPos = 50;
      }
      
      yPos += 10;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(14);
      pdf.setFillColor(255, 193, 7);
      pdf.rect(margin - 2, yPos - 5, contentWidth + 4, 8, 'F');
      pdf.setTextColor(51, 51, 51);
      pdf.text('LIMITATIONS', margin, yPos);
      yPos += 12;
      
      for (const item of category.limitations) {
        if (yPos > maxY - 30) { // Check for page break with extra margin
          pdf.addPage();
          pageNum++;
          this.addPageHeader(pdf, category.name.toUpperCase() + ' (CONTINUED)', margin);
          this.addPageFooter(pdf, pageNum);
          yPos = 50;
        }
        
        yPos = await this.addEnhancedVisualItem(pdf, item, margin, contentWidth, yPos, maxY);
      }
    }
    
    // Deficiencies Section
    if (category.deficiencies && category.deficiencies.length > 0) {
      if (yPos > maxY - 30) { // Check for page break with extra margin
        pdf.addPage();
        pageNum++;
        this.addPageHeader(pdf, category.name.toUpperCase() + ' (CONTINUED)', margin);
        this.addPageFooter(pdf, pageNum);
        yPos = 50;
      }
      
      yPos += 10;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(14);
      pdf.setFillColor(220, 53, 69);
      pdf.rect(margin - 2, yPos - 5, contentWidth + 4, 8, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.text('DEFICIENCIES', margin, yPos);
      pdf.setTextColor(51, 51, 51);
      yPos += 12;
      
      for (const item of category.deficiencies) {
        if (yPos > maxY - 30) { // Check for page break with extra margin
          pdf.addPage();
          pageNum++;
          this.addPageHeader(pdf, category.name.toUpperCase() + ' (CONTINUED)', margin);
          this.addPageFooter(pdf, pageNum);
          yPos = 50;
        }
        
        yPos = await this.addEnhancedVisualItem(pdf, item, margin, contentWidth, yPos, maxY);
      }
    }
    
    return pageNum;
  }

  private async addVisualItem(pdf: jsPDF, item: any, margin: number, contentWidth: number, yPos: number, maxY: number): Promise<number> {
    // Item title
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text(`• ${item.name}`, margin + 3, yPos);
    yPos += 6;
    
    // Item text/description
    if (item.text) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      const lines = pdf.splitTextToSize(item.text, contentWidth - 10);
      pdf.text(lines, margin + 8, yPos);
      yPos += lines.length * 4 + 2;
    }
    
    // Display answers for AnswerType 1 and 2
    if (item.answers) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(0, 0, 0); // Black color for answers
      pdf.text(item.answers, margin + 8, yPos);
      yPos += 6;
    }
    
    // Photos
    if (item.photos && item.photos.length > 0) {
      yPos += 5;
      const photoWidth = 75;  // Much bigger - increased from 40
      const photoHeight = 56; // Much bigger - increased from 30, maintaining aspect ratio
      const photosPerRow = 2; // Always 2 photos per row
      const gap = 10;
      
      for (let i = 0; i < item.photos.length; i++) {
        const photo = item.photos[i];
        const col = i % photosPerRow;
        const xPos = margin + (col * (photoWidth + gap));
        
        if (col === 0 && i > 0) {
          yPos += photoHeight + 15; // Increased gap between rows
        }
        
        try {
          const imgUrl = this.getPhotoUrl(photo);
          const imgData = await this.loadImage(imgUrl);
          if (imgData) {
            pdf.addImage(imgData, 'JPEG', xPos, yPos, photoWidth, photoHeight);
            
            // Add caption if available
            if (photo.caption) {
              pdf.setFontSize(8);
              pdf.setFont('helvetica', 'italic');
              const caption = photo.caption.substring(0, 40) + (photo.caption.length > 40 ? '...' : '');
              pdf.text(caption, xPos, yPos + photoHeight + 3);
            }
          }
        } catch (error) {
        }
      }
      
      yPos += photoHeight + 15; // Increased gap after photos
    }
    
    yPos += 5;
    return yPos;
  }

  private async addEnhancedVisualItem(pdf: jsPDF, item: any, margin: number, contentWidth: number, yPos: number, maxY: number): Promise<number> {
    // Add border and background for each item
    const itemStartY = yPos;
    
    // Item title with better formatting
    pdf.setFillColor(248, 249, 250);
    pdf.rect(margin - 2, yPos - 5, contentWidth + 4, 8, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(51, 51, 51);
    pdf.text(`${item.name}`, margin + 2, yPos);
    yPos += 8;
    
    // Item text with proper wrapping
    if (item.text) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(73, 80, 87);
      const lines = pdf.splitTextToSize(item.text, contentWidth - 10);
      pdf.text(lines, margin + 5, yPos);
      yPos += lines.length * 4 + 4;
    }
    
    // Display answers for AnswerType 1 and 2
    if (item.answers) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.setTextColor(0, 0, 0); // Black color for answers
      pdf.text(item.answers, margin + 5, yPos);
      yPos += 6;
    }
    
    // Enhanced photo display
    if (item.photos && item.photos.length > 0) {
      yPos += 3;
      
      // Larger, clearer photos for professional look
      const photoWidth = 60;  // Increased size
      const photoHeight = 45; // Increased size
      const photosPerRow = 3; // Fixed 3 per row for consistency
      const spacing = (contentWidth - (photosPerRow * photoWidth)) / (photosPerRow - 1);
      
      for (let i = 0; i < item.photos.length; i++) {
        const photo = item.photos[i];
        const col = i % photosPerRow;
        const xPos = margin + (col * (photoWidth + spacing));
        
        if (col === 0 && i > 0) {
          yPos += photoHeight + 12;
          
          // Check for page break
          if (yPos > maxY - photoHeight - 20) { // Check photo fits with extra margin
            return yPos; // Let the parent method handle page break
          }
        }
        
        try {
          const imgUrl = this.getPhotoUrl(photo);
          const imgData = await this.loadImage(imgUrl);
          
          if (imgData) {
            // Add shadow effect
            pdf.setFillColor(200, 200, 200);
            pdf.rect(xPos + 1, yPos + 1, photoWidth, photoHeight, 'F');
            
            // Add the image
            pdf.addImage(imgData, 'JPEG', xPos, yPos, photoWidth, photoHeight);
            
            // Add border
            pdf.setDrawColor(180, 180, 180);
            pdf.setLineWidth(0.5);
            pdf.rect(xPos, yPos, photoWidth, photoHeight, 'S');
            
            // Add photo number and caption
            if (photo.caption || i >= 0) {
              pdf.setFillColor(0, 0, 0, 0.7);
              pdf.rect(xPos, yPos + photoHeight - 8, photoWidth, 8, 'F');
              pdf.setFont('helvetica', 'normal');
              pdf.setFontSize(8);
              pdf.setTextColor(255, 255, 255);
              const caption = photo.caption ? 
                `Photo ${i + 1}: ${photo.caption.substring(0, 25)}${photo.caption.length > 25 ? '...' : ''}` :
                `Photo ${i + 1}`;
              pdf.text(caption, xPos + 2, yPos + photoHeight - 2);
            }
          } else {
            // Show placeholder for missing images
            pdf.setFillColor(240, 240, 240);
            pdf.rect(xPos, yPos, photoWidth, photoHeight, 'F');
            pdf.setDrawColor(180, 180, 180);
            pdf.rect(xPos, yPos, photoWidth, photoHeight, 'S');
            pdf.setFont('helvetica', 'italic');
            pdf.setFontSize(9);
            pdf.setTextColor(150, 150, 150);
            pdf.text('Image not available', xPos + photoWidth/2, yPos + photoHeight/2, { align: 'center' });
          }
        } catch (error) {
          console.error('Error loading photo:', error);
          // Add placeholder
          pdf.setFillColor(240, 240, 240);
          pdf.rect(xPos, yPos, photoWidth, photoHeight, 'F');
        }
      }
      
      yPos += photoHeight + 15;
    }
    
    // Add separator line
    pdf.setDrawColor(220, 220, 220);
    pdf.setLineWidth(0.2);
    pdf.line(margin, yPos - 2, margin + contentWidth, yPos - 2);
    
    yPos += 5;
    return yPos;
  }

  private addContinuationHeader(pdf: jsPDF, categoryName: string, margin: number, pageNum: number) {
    const headerHeight = 12;
    pdf.setFillColor(241, 90, 39);
    pdf.rect(0, margin - 5, pdf.internal.pageSize.getWidth(), headerHeight, 'F');
    
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text(`${categoryName.toUpperCase()} (CONTINUED)`, margin, margin + 2);
    
    pdf.setFontSize(10);
    pdf.text(`Page ${pageNum}`, pdf.internal.pageSize.getWidth() - margin, margin + 2, { align: 'right' });
    
    pdf.setTextColor(51, 51, 51);
  }

  private async addElevationPlotSection(pdf: jsPDF, margin: number, contentWidth: number, pageNum: number, pageHeight: number, pageWidth: number = 215.9) {
    this.addPageHeader(pdf, 'ELEVATION PLOT DATA', margin);
    this.addPageFooter(pdf, pageNum);
    
    let yPos = 50;
    const maxY = pageHeight - 200; // MASSIVE bottom margin for white space (200mm = ~7.9 inches)
    
    // Section header description
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    pdf.setTextColor(73, 80, 87);
    pdf.text('Foundation elevation measurements and observations', margin, yPos);
    yPos += 10;
    
    // MAIN ELEVATION MEASUREMENTS SECTION - styled like Structural Systems Comments section
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.setFillColor(241, 90, 39);  // Orange like Comments header
    pdf.rect(margin - 2, yPos - 5, contentWidth + 4, 8, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.text('ELEVATION MEASUREMENTS', margin, yPos);
    pdf.setTextColor(51, 51, 51);
    yPos += 12;
    
    // Process each room as a visual item - EXACTLY like structural systems
    for (const room of this.elevationData) {
      if (yPos > maxY - 30) { // Check for page break with extra margin
        pdf.addPage();
        pageNum++;
        this.addPageHeader(pdf, 'ELEVATION PLOT DATA (CONTINUED)', margin);
        this.addPageFooter(pdf, pageNum);
        yPos = 50;
      }
      
      // Create a visual item object to pass to the enhanced visual item method
      const roomItem = {
        name: room.name,
        text: this.buildRoomDescriptionText(room),
        photos: this.getAllRoomPhotos(room)
      };
      
      yPos = await this.addEnhancedVisualItem(pdf, roomItem, margin, contentWidth, yPos, maxY);
    }
    
    return pageNum;
  }
  
  private buildRoomDescriptionText(room: any): string {
    let text = '';
    
    // Add FDF if present
    if (room.fdf && room.fdf !== 'None') {
      text += `Floor Differential Factor: ${room.fdf}\n`;
    }
    
    // Add measurement points
    if (room.points && room.points.length > 0) {
      text += `Measurements taken at ${room.points.length} points:\n`;
      room.points.forEach((point: any) => {
        const value = point.value ? `${point.value}"` : 'Pending';
        text += `• ${point.name}: ${value}`;
        if (point.photos && point.photos.length > 0) {
          text += ` (${point.photos.length} photo${point.photos.length > 1 ? 's' : ''})`;
        }
        text += '\n';
      });
    }
    
    // Add notes if present
    if (room.notes && room.notes.trim()) {
      text += `\nNotes: ${room.notes}`;
    }
    
    return text.trim();
  }
  
  private getAllRoomPhotos(room: any): any[] {
    const allPhotos: any[] = [];
    
    // Collect all photos from all points in the room
    if (room.points) {
      room.points.forEach((point: any) => {
        if (point.photos && point.photos.length > 0) {
          point.photos.forEach((photo: any) => {
            allPhotos.push({
              ...photo,
              caption: photo.caption || `${point.name} - ${point.value ? point.value + '"' : 'N/A'}`
            });
          });
        }
      });
    }
    
    // Add any room-level photos
    if (room.photos) {
      room.photos.forEach((photo: any) => {
        allPhotos.push({
          ...photo,
          caption: photo.caption || `${room.name} - Room Photo`
        });
      });
    }
    
    return allPhotos;
  }

  private async addPhotoGallery(pdf: jsPDF, margin: number, contentWidth: number, pageNum: number, pageHeight: number) {
    this.addPageHeader(pdf, 'APPENDIX: PHOTO DOCUMENTATION', margin);
    this.addPageFooter(pdf, pageNum);
    
    let yPos = 50;
    const maxY = pageHeight - 200; // MASSIVE bottom margin for white space (200mm = ~7.9 inches)
    const photoWidth = 60;
    const photoHeight = 45;
    const photosPerRow = Math.floor(contentWidth / (photoWidth + 10));
    
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text('Complete photographic documentation of all findings and observations.', margin, yPos);
    yPos += 15;
    
    let photoCount = 0;
    const allPhotos = this.getAllPhotos();
    
    for (const photoItem of allPhotos) {
      const col = photoCount % photosPerRow;
      const xPos = margin + (col * (photoWidth + 10));
      
      if (col === 0 && photoCount > 0) {
        yPos += photoHeight + 15;
      }
      
      if (yPos > maxY - photoHeight - 20) { // Check photo fits with extra margin
        pdf.addPage();
        pageNum++;
        this.addPageHeader(pdf, 'APPENDIX: PHOTO DOCUMENTATION (CONTINUED)', margin);
        this.addPageFooter(pdf, pageNum);
        yPos = 50;
      }
      
      try {
        const imgUrl = this.getPhotoUrl(photoItem.photo);
        const imgData = await this.loadImage(imgUrl);
        if (imgData) {
          pdf.addImage(imgData, 'JPEG', xPos, yPos, photoWidth, photoHeight);
          
          // Add photo caption
          pdf.setFontSize(8);
          pdf.setFont('helvetica', 'normal');
          const caption = `${photoItem.category} - ${photoItem.type}`;
          pdf.text(caption, xPos, yPos + photoHeight + 3);
          
          if (photoItem.photo.caption) {
            const photoCaption = photoItem.photo.caption.substring(0, 40) + (photoItem.photo.caption.length > 40 ? '...' : '');
            pdf.setFont('helvetica', 'italic');
            pdf.text(photoCaption, xPos, yPos + photoHeight + 7);
          }
        }
      } catch (error) {
      }
      
      photoCount++;
    }
    
    return pageNum;
  }

  private addPageHeader(pdf: jsPDF, title: string, margin: number) {
    const pageWidth = pdf.internal.pageSize.getWidth();
    
    // Header line
    pdf.setDrawColor(241, 90, 39);
    pdf.setLineWidth(2);
    pdf.line(margin, 25, pageWidth - margin, 25);
    
    // Title
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.setTextColor(51, 51, 51);
    pdf.text(title, margin, 20);
    
    // Date
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(100, 100, 100);
    pdf.text(this.getCurrentDate(), pageWidth - margin, 20, { align: 'right' });
  }

  private addPageFooter(pdf: jsPDF, pageNum: number) {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    
    // Footer line - positioned EXTREMELY high for massive bottom white space
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.5);
    pdf.line(20, pageHeight - 150, pageWidth - 20, pageHeight - 150);
    
    // Company name - moved up 100mm higher than original
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(100, 100, 100);
    pdf.text('Noble Property Inspections LLC', 20, pageHeight - 140);
    
    // Page number - moved up 100mm higher than original
    pdf.text(`Page ${pageNum}`, pageWidth - 20, pageHeight - 140, { align: 'right' });
  }

  private async loadImage(url: string): Promise<string | null> {
    // Check cache first
    if (this.imageCache.has(url)) {
      return this.imageCache.get(url) || null;
    }
    
    try {

      let caspioFilePath: string | null = null;
      if (url && url.startsWith('/')) {
        caspioFilePath = url;
      } else if (url) {
        const match = url.match(/\/rest\/v2\/files(\/[^?]+)/i);
        if (match && match[1]) {
          caspioFilePath = match[1];
        } else if (!url.startsWith('http') && !url.startsWith('data:') && !url.startsWith('assets/')) {
          caspioFilePath = url.startsWith('/') ? url : `/${url}`;
        }
      }

      if (caspioFilePath) {
        try {
          const imageData = await firstValueFrom(this.caspioService.getImageFromFilesAPI(caspioFilePath));
          if (imageData && imageData.startsWith('data:')) {
            this.imageCache.set(url, imageData);
            if (caspioFilePath) {
              this.imageCache.set(caspioFilePath, imageData);
            }
            return imageData;
          }
        } catch (filesApiError) {
          console.error('Failed to load image via Files API:', filesApiError);
        }
      }
      
      // Handle different types of URLs
      if (url.includes('blob:')) {
        // Handle blob URLs directly
        return await this.convertBlobUrlToDataUrl(url);
      }
      
      // For Caspio images with access token, fetch the image as blob first
      if (url.includes('caspio.com') && url.includes('access_token')) {
        try {
          
          // Fetch the image with proper headers
          const response = await fetch(url, {
            method: 'GET',
            mode: 'cors',
            credentials: 'omit'
          });
          
          if (!response.ok) {
            console.error('Failed to fetch image:', response.status, response.statusText);
            // Try to refresh token and retry once
            const token = await firstValueFrom(this.caspioService.getValidToken());
            if (token) {
              const newUrl = url.replace(/access_token=[^&]+/, `access_token=${token}`);
              const retryResponse = await fetch(newUrl, {
                method: 'GET',
                mode: 'cors',
                credentials: 'omit'
              });
              
              if (retryResponse.ok) {
                const blob = await retryResponse.blob();
                return await this.blobToDataURL(blob);
              }
            }
            return null;
          }
          
          const blob = await response.blob();
          const dataUrl = await this.blobToDataURL(blob);
          
          // Cache the result
          this.imageCache.set(url, dataUrl);
          
          return dataUrl;
        } catch (fetchError) {
          console.error('Error fetching Caspio image:', fetchError);
          
          // Show debug info only in development
          return null;
        }
      }
      
      // For blob URLs or other sources
      return new Promise((resolve, reject) => {
        const img = new Image();
        
        // Only set crossOrigin for non-blob URLs
        if (!url.startsWith('blob:')) {
          img.crossOrigin = 'anonymous';
        }
        
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            // Limit size for PDF performance
            const maxWidth = 800;
            const maxHeight = 600;
            let width = img.width;
            let height = img.height;
            
            if (width > maxWidth || height > maxHeight) {
              const ratio = Math.min(maxWidth / width, maxHeight / height);
              width *= ratio;
              height *= ratio;
            }
            
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img, 0, 0, width, height);
              const dataUrl = canvas.toDataURL('image/jpeg', 0.7); // Slightly lower quality for smaller file
              this.imageCache.set(url, dataUrl);
              resolve(dataUrl);
            } else {
              console.error('Could not get canvas context');
              resolve(null);
            }
          } catch (canvasError) {
            console.error('Error processing image:', canvasError);
            resolve(null);
          }
        };
        
        img.onerror = (error) => {
          console.error('Failed to load image:', url, error);
          resolve(null);
        };
        
        img.src = url;
        
        // Timeout after 10 seconds (increased for larger images)
        setTimeout(() => {
          console.warn('Image load timeout:', url);
          resolve(null);
        }, 10000);
      });
    } catch (error) {
      console.error('Error loading image:', error);
      return null;
    }
  }
  
  private async convertBlobUrlToDataUrl(blobUrl: string): Promise<string | null> {
    try {
      const response = await fetch(blobUrl);
      const blob = await response.blob();
      return await this.blobToDataURL(blob);
    } catch (error) {
      console.error('Error converting blob URL:', error);
      return null;
    }
  }

  private blobToDataURL(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  
  private async showDebugAlert(title: string, message: string) {
    // Only show debug alerts in development mode
    if (window.location.hostname === 'localhost') {
      const alert = await this.alertController.create({
        header: `DEBUG: ${title}`,
        message: message.replace(/\s+/g, ' ').trim(),
        buttons: ['OK']
      });
      await alert.present();
    }
  }
  
  private async showToast(message: string, color: string = 'primary') {
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

  /**
   * Extracts text content from an HTML element along with position information
   * This allows us to create a searchable text layer in the PDF
   */
  private extractTextFromElement(element: HTMLElement): Array<{text: string, x: number, y: number, fontSize: number}> {
    const textElements: Array<{text: string, x: number, y: number, fontSize: number}> = [];
    const elementRect = element.getBoundingClientRect();

    // Recursively extract text from all text nodes
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null
    );

    let node;
    while (node = walker.nextNode()) {
      const textContent = node.textContent?.trim();
      if (textContent && textContent.length > 0) {
        const parent = node.parentElement;
        if (parent) {
          const rect = parent.getBoundingClientRect();
          const computedStyle = window.getComputedStyle(parent);
          const fontSize = parseFloat(computedStyle.fontSize) || 12;

          // Calculate position relative to the page element
          const relativeX = rect.left - elementRect.left;
          const relativeY = rect.top - elementRect.top;

          textElements.push({
            text: textContent,
            x: relativeX,
            y: relativeY,
            fontSize: fontSize
          });
        }
      }
    }

    return textElements;
  }

  /**
   * Adds an invisible text layer to the PDF page for text extraction
   * The text is rendered in white (invisible on white background) but still extractable
   */
  private addTextLayer(
    pdf: any,
    textContent: Array<{text: string, x: number, y: number, fontSize: number}>,
    pageWidth: number,
    pageHeight: number
  ): void {
    // Combine all text into a single block for better extraction
    // This is more reliable than trying to position each piece of text
    const allText = textContent.map(item => item.text).join(' ');

    if (allText.length === 0) {
      return; // No text to add
    }

    // Set text to white (invisible on white background but extractable by PDF readers)
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(1); // Very small font size so it doesn't interfere visually

    // Add all text at the top-left corner of the page
    // This makes it extractable but doesn't interfere with the visual appearance
    const margin = 0.1; // Very small margin
    const textWidth = pageWidth - (margin * 2);

    try {
      // Split text into lines that fit the page width
      const lines = pdf.splitTextToSize(allText, textWidth);

      // Add the text (it will be white on white, so invisible)
      pdf.text(lines, margin, margin);

      console.log(`[PDF] Added ${allText.length} characters of extractable text to page`);
    } catch (err) {
      console.warn('[PDF] Failed to add text layer:', err);
    }

    // Reset text color for any subsequent visible text
    pdf.setTextColor(0, 0, 0);
  }

  /**
   * Filters text content for a specific slice when page is split
   */
  private filterTextForSlice(
    textContent: Array<{text: string, x: number, y: number, fontSize: number}>,
    sliceStart: number,
    sliceHeight: number,
    totalHeight: number
  ): Array<{text: string, x: number, y: number, fontSize: number}> {
    const startY = sliceStart * totalHeight;
    const endY = (sliceStart + sliceHeight) * totalHeight;

    return textContent
      .filter(item => item.y >= startY && item.y < endY)
      .map(item => ({
        ...item,
        y: item.y - startY // Adjust Y position relative to slice
      }));
  }
}


