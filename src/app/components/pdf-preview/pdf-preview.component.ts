import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, LoadingController, Platform } from '@ionic/angular';
import { PDFViewerModal } from '../pdf-viewer-modal/pdf-viewer-modal.component';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
declare module 'jspdf' {
  interface jsPDF {
    autoTable: any;
  }
}

@Component({
  selector: 'app-pdf-preview',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './pdf-preview.component.html',
  styleUrls: ['./pdf-preview.component.scss']
})
export class PdfPreviewComponent implements OnInit {
  @Input() projectData: any;
  @Input() structuralData: any[] = [];
  @Input() elevationData: any[] = [];
  @Input() serviceData: any = {};
  
  hasElevationData = false;
  imageCache: Map<string, string> = new Map();

  constructor(
    private modalController: ModalController,
    private loadingController: LoadingController,
    private platform: Platform
  ) {}

  ngOnInit() {
    this.hasElevationData = this.elevationData && this.elevationData.length > 0;
    console.log('PDF Preview initialized with data:', {
      projectData: this.projectData,
      structuralDataCount: this.structuralData?.length || 0,
      elevationDataCount: this.elevationData?.length || 0,
      serviceData: this.serviceData
    });
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
    if (!this.projectData?.primaryPhoto) {
      return 'assets/img/project-placeholder.svg';
    }
    
    const photo = this.projectData.primaryPhoto;
    
    if (photo.startsWith('/')) {
      const account = localStorage.getItem('caspioAccount') || '';
      const token = localStorage.getItem('caspioToken') || '';
      return `https://${account}.caspio.com/rest/v2/files${photo}?access_token=${token}`;
    }
    
    return photo;
  }

  getPhotoUrl(photo: any): string {
    if (!photo) return 'assets/img/photo-placeholder.svg';
    
    const photoPath = photo.url || photo.Photo || photo.Attachment || photo;
    
    if (typeof photoPath === 'string' && photoPath.startsWith('/')) {
      const account = localStorage.getItem('caspioAccount') || '';
      const token = localStorage.getItem('caspioToken') || '';
      return `https://${account}.caspio.com/rest/v2/files${photoPath}?access_token=${token}`;
    }
    
    return photoPath || 'assets/img/photo-placeholder.svg';
  }

  getElevationPageNumber(): number {
    return this.structuralData?.length ? 6 + Math.ceil(this.structuralData.length / 2) : 6;
  }

  async generatePDF() {
    const loading = await this.loadingController.create({
      message: 'Generating comprehensive PDF report...',
      cssClass: 'custom-loading'
    });
    await loading.present();

    try {
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'letter'
      });

      let pageNum = 1;
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 20;
      const contentWidth = pageWidth - (margin * 2);

      // Add custom fonts for better appearance
      pdf.setFont('helvetica');

      // Page 1: Professional Cover Page
      await this.addCoverPage(pdf, pageWidth, pageHeight, margin);
      
      // Page 2: Executive Summary
      pdf.addPage();
      pageNum++;
      await this.addExecutiveSummary(pdf, margin, contentWidth, pageNum);

      // Page 3: Table of Contents
      pdf.addPage();
      pageNum++;
      this.addTableOfContents(pdf, margin, contentWidth, pageNum);

      // Page 4-5: Project Information & Service Details
      pdf.addPage();
      pageNum++;
      await this.addProjectInformation(pdf, margin, contentWidth, pageNum);

      pdf.addPage();
      pageNum++;
      await this.addServiceDetails(pdf, margin, contentWidth, pageNum);

      // Pages 6+: Structural Systems with Photos
      if (this.structuralData && this.structuralData.length > 0) {
        for (const category of this.structuralData) {
          pdf.addPage();
          pageNum++;
          await this.addStructuralSystemsSection(pdf, category, margin, contentWidth, pageNum, pageHeight);
        }
      }

      // Elevation Plot Data
      if (this.elevationData && this.elevationData.length > 0) {
        pdf.addPage();
        pageNum++;
        await this.addElevationPlotSection(pdf, margin, contentWidth, pageNum, pageHeight);
      }

      // Appendix: Photo Gallery
      if (this.hasPhotos()) {
        pdf.addPage();
        pageNum++;
        await this.addPhotoGallery(pdf, margin, contentWidth, pageNum, pageHeight);
      }

      // Generate filename with project details
      const projectId = this.projectData?.projectId || 'draft';
      const clientName = (this.projectData?.clientName || 'Client').replace(/[^a-z0-9]/gi, '_');
      const date = new Date().toISOString().split('T')[0];
      const fileName = `EFE_Report_${clientName}_${projectId}_${date}.pdf`;
      
      // Save the PDF as a blob
      const pdfBlob = pdf.output('blob');
      
      await loading.dismiss();
      
      // Open the PDF viewer modal
      const modal = await this.modalController.create({
        component: PDFViewerModal,
        componentProps: {
          pdfBlob: pdfBlob,
          fileName: fileName,
          projectId: projectId
        },
        cssClass: 'pdf-viewer-modal'
      });
      
      await modal.present();
      this.dismiss();
      
    } catch (error) {
      console.error('Error generating PDF:', error);
      await loading.dismiss();
    }
  }

  private async addCoverPage(pdf: jsPDF, pageWidth: number, pageHeight: number, margin: number) {
    // Company branding header
    pdf.setFillColor(241, 90, 39); // Orange brand color
    pdf.rect(0, 0, pageWidth, 40, 'F');
    
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(24);
    pdf.setFont('helvetica', 'bold');
    pdf.text('NOBLE PROPERTY INSPECTIONS', pageWidth / 2, 15, { align: 'center' });
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.text('Professional Engineering Foundation Evaluation', pageWidth / 2, 25, { align: 'center' });
    pdf.text('936-202-8013 | info@noblepropertyinspections.com', pageWidth / 2, 32, { align: 'center' });
    
    // Report title
    pdf.setTextColor(51, 51, 51);
    pdf.setFontSize(20);
    pdf.setFont('helvetica', 'bold');
    pdf.text('ENGINEERS FOUNDATION', pageWidth / 2, 60, { align: 'center' });
    pdf.text('EVALUATION REPORT', pageWidth / 2, 70, { align: 'center' });
    
    // Property photo
    try {
      const primaryPhotoUrl = this.getPrimaryPhotoUrl();
      if (primaryPhotoUrl && !primaryPhotoUrl.includes('placeholder')) {
        const imgData = await this.loadImage(primaryPhotoUrl);
        if (imgData) {
          const imgWidth = 120;
          const imgHeight = 80;
          pdf.addImage(imgData, 'JPEG', (pageWidth - imgWidth) / 2, 85, imgWidth, imgHeight);
        }
      }
    } catch (error) {
      console.log('Primary photo not available');
    }
    
    // Property details box
    const boxY = 180;
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.5);
    pdf.rect(margin, boxY, pageWidth - (margin * 2), 60, 'S');
    
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(51, 51, 51);
    pdf.text(this.projectData?.address || 'Property Address', pageWidth / 2, boxY + 15, { align: 'center' });
    
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'normal');
    const cityStateZip = `${this.projectData?.city || 'City'}, ${this.projectData?.state || 'ST'} ${this.projectData?.zip || '00000'}`;
    pdf.text(cityStateZip, pageWidth / 2, boxY + 25, { align: 'center' });
    
    pdf.setFont('helvetica', 'bold');
    pdf.text('Client: ', margin + 10, boxY + 40);
    pdf.setFont('helvetica', 'normal');
    pdf.text(this.projectData?.clientName || 'Client Name', margin + 30, boxY + 40);
    
    pdf.setFont('helvetica', 'bold');
    pdf.text('Inspection Date: ', margin + 10, boxY + 50);
    pdf.setFont('helvetica', 'normal');
    pdf.text(this.getFormattedDate(this.projectData?.inspectionDate), margin + 45, boxY + 50);
    
    // Inspector information
    const inspectorY = pageHeight - 60;
    pdf.setFillColor(245, 245, 245);
    pdf.rect(0, inspectorY, pageWidth, 60, 'F');
    
    pdf.setTextColor(51, 51, 51);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Inspected By:', pageWidth / 2, inspectorY + 15, { align: 'center' });
    
    pdf.setFont('helvetica', 'normal');
    pdf.text(this.projectData?.inspectorName || 'Inspector Name', pageWidth / 2, inspectorY + 25, { align: 'center' });
    pdf.text(`License #${this.projectData?.licenseNumber || '12345'}`, pageWidth / 2, inspectorY + 35, { align: 'center' });
    pdf.text(this.projectData?.inspectorEmail || 'inspector@noblepropertyinspections.com', pageWidth / 2, inspectorY + 45, { align: 'center' });
  }

  private async addExecutiveSummary(pdf: jsPDF, margin: number, contentWidth: number, pageNum: number) {
    this.addPageHeader(pdf, 'EXECUTIVE SUMMARY', margin);
    this.addPageFooter(pdf, pageNum);
    
    let yPos = 50;
    
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'normal');
    
    const summaryText = [
      'This Engineers Foundation Evaluation Report provides a comprehensive assessment of the structural foundation systems for the property listed herein.',
      '',
      'The evaluation was conducted in accordance with professional engineering standards and includes detailed observations, measurements, and recommendations.',
      '',
      'Key areas of assessment include:'
    ];
    
    summaryText.forEach(line => {
      if (line) {
        const lines = pdf.splitTextToSize(line, contentWidth);
        pdf.text(lines, margin, yPos);
        yPos += lines.length * 5;
      } else {
        yPos += 5;
      }
    });
    
    yPos += 5;
    
    // Key points with bullets
    const keyPoints = [
      'Foundation type and condition assessment',
      'Structural systems evaluation including comments, limitations, and deficiencies',
      'Detailed elevation plot measurements for all inspected areas',
      'Photographic documentation of findings',
      'Professional recommendations for maintenance or repairs'
    ];
    
    pdf.setFont('helvetica', 'normal');
    keyPoints.forEach(point => {
      pdf.text('•', margin + 5, yPos);
      const lines = pdf.splitTextToSize(point, contentWidth - 10);
      pdf.text(lines, margin + 10, yPos);
      yPos += lines.length * 5 + 2;
    });
    
    // Summary statistics
    yPos += 10;
    pdf.setFont('helvetica', 'bold');
    pdf.text('Inspection Summary:', margin, yPos);
    yPos += 10;
    
    pdf.setFont('helvetica', 'normal');
    const stats = [
      `Total Areas Inspected: ${this.structuralData?.length || 0} structural categories`,
      `Rooms Evaluated: ${this.elevationData?.length || 0} rooms with elevation measurements`,
      `Visual Findings: ${this.countVisualFindings()} items documented`,
      `Photos Included: ${this.countTotalPhotos()} photographic records`
    ];
    
    stats.forEach(stat => {
      pdf.text(stat, margin + 5, yPos);
      yPos += 7;
    });
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
    const maxY = pageHeight - 30;
    
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
        if (yPos > maxY - 40) {
          pdf.addPage();
          pageNum++;
          this.addPageHeader(pdf, category.name.toUpperCase() + ' (CONTINUED)', margin);
          this.addPageFooter(pdf, pageNum);
          yPos = 50;
        }
        
        yPos = await this.addVisualItem(pdf, item, margin, contentWidth, yPos, maxY);
      }
    }
    
    // Limitations Section
    if (category.limitations && category.limitations.length > 0) {
      if (yPos > maxY - 40) {
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
        if (yPos > maxY - 40) {
          pdf.addPage();
          pageNum++;
          this.addPageHeader(pdf, category.name.toUpperCase() + ' (CONTINUED)', margin);
          this.addPageFooter(pdf, pageNum);
          yPos = 50;
        }
        
        yPos = await this.addVisualItem(pdf, item, margin, contentWidth, yPos, maxY);
      }
    }
    
    // Deficiencies Section
    if (category.deficiencies && category.deficiencies.length > 0) {
      if (yPos > maxY - 40) {
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
        if (yPos > maxY - 40) {
          pdf.addPage();
          pageNum++;
          this.addPageHeader(pdf, category.name.toUpperCase() + ' (CONTINUED)', margin);
          this.addPageFooter(pdf, pageNum);
          yPos = 50;
        }
        
        yPos = await this.addVisualItem(pdf, item, margin, contentWidth, yPos, maxY);
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
    
    // Photos
    if (item.photos && item.photos.length > 0) {
      yPos += 5;
      const photoWidth = 40;
      const photoHeight = 30;
      const photosPerRow = Math.floor(contentWidth / (photoWidth + 5));
      
      for (let i = 0; i < item.photos.length; i++) {
        const photo = item.photos[i];
        const col = i % photosPerRow;
        const xPos = margin + (col * (photoWidth + 5));
        
        if (col === 0 && i > 0) {
          yPos += photoHeight + 10;
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
              const caption = photo.caption.substring(0, 30) + (photo.caption.length > 30 ? '...' : '');
              pdf.text(caption, xPos, yPos + photoHeight + 3);
            }
          }
        } catch (error) {
          console.log('Photo not available:', error);
        }
      }
      
      yPos += photoHeight + 10;
    }
    
    yPos += 5;
    return yPos;
  }

  private async addElevationPlotSection(pdf: jsPDF, margin: number, contentWidth: number, pageNum: number, pageHeight: number) {
    this.addPageHeader(pdf, 'ELEVATION PLOT DATA', margin);
    this.addPageFooter(pdf, pageNum);
    
    let yPos = 50;
    const maxY = pageHeight - 30;
    
    for (const room of this.elevationData) {
      if (yPos > maxY - 60) {
        pdf.addPage();
        pageNum++;
        this.addPageHeader(pdf, 'ELEVATION PLOT DATA (CONTINUED)', margin);
        this.addPageFooter(pdf, pageNum);
        yPos = 50;
      }
      
      // Room header
      pdf.setFillColor(245, 245, 245);
      pdf.rect(margin - 2, yPos - 5, contentWidth + 4, 10, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(12);
      pdf.setTextColor(51, 51, 51);
      pdf.text(room.name, margin, yPos);
      yPos += 12;
      
      // Room details
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      
      if (room.fdf && room.fdf !== 'None') {
        pdf.setFont('helvetica', 'bold');
        pdf.text('FDF: ', margin + 5, yPos);
        pdf.setFont('helvetica', 'normal');
        pdf.text(room.fdf, margin + 20, yPos);
        yPos += 6;
      }
      
      if (room.notes) {
        pdf.setFont('helvetica', 'bold');
        pdf.text('Notes: ', margin + 5, yPos);
        pdf.setFont('helvetica', 'normal');
        const notes = pdf.splitTextToSize(room.notes, contentWidth - 25);
        pdf.text(notes, margin + 20, yPos);
        yPos += notes.length * 4 + 2;
      }
      
      // Elevation points table
      if (room.points && room.points.length > 0) {
        yPos += 5;
        
        const tableData = room.points.map((point: any) => [
          point.name,
          point.value ? `${point.value}"` : 'N/A',
          point.photoCount > 0 ? `${point.photoCount} photo(s)` : '-'
        ]);
        
        (pdf as any).autoTable({
          startY: yPos,
          head: [['Point', 'Measurement', 'Photos']],
          body: tableData,
          theme: 'striped',
          headStyles: {
            fillColor: [241, 90, 39],
            textColor: 255,
            fontSize: 10
          },
          styles: {
            fontSize: 9,
            cellPadding: 3
          },
          columnStyles: {
            0: { cellWidth: 40 },
            1: { cellWidth: 40, halign: 'center' },
            2: { cellWidth: 'auto', halign: 'center' }
          },
          margin: { left: margin + 5, right: margin }
        });
        
        yPos = (pdf as any).lastAutoTable.finalY + 5;
      }
      
      // Room photos
      if (room.photos && room.photos.length > 0) {
        yPos += 5;
        const photoWidth = 35;
        const photoHeight = 26;
        const photosPerRow = Math.floor((contentWidth - 10) / (photoWidth + 5));
        
        for (let i = 0; i < Math.min(room.photos.length, 4); i++) {
          const photo = room.photos[i];
          const col = i % photosPerRow;
          const xPos = margin + 5 + (col * (photoWidth + 5));
          
          if (col === 0 && i > 0) {
            yPos += photoHeight + 5;
          }
          
          try {
            const imgUrl = this.getPhotoUrl(photo);
            const imgData = await this.loadImage(imgUrl);
            if (imgData) {
              pdf.addImage(imgData, 'JPEG', xPos, yPos, photoWidth, photoHeight);
            }
          } catch (error) {
            console.log('Room photo not available');
          }
        }
        
        yPos += photoHeight + 10;
      }
      
      yPos += 10;
    }
    
    return pageNum;
  }

  private async addPhotoGallery(pdf: jsPDF, margin: number, contentWidth: number, pageNum: number, pageHeight: number) {
    this.addPageHeader(pdf, 'APPENDIX: PHOTO DOCUMENTATION', margin);
    this.addPageFooter(pdf, pageNum);
    
    let yPos = 50;
    const maxY = pageHeight - 30;
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
      
      if (yPos > maxY - photoHeight) {
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
        console.log('Gallery photo not available');
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
    
    // Footer line
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.5);
    pdf.line(20, pageHeight - 20, pageWidth - 20, pageHeight - 20);
    
    // Company name
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(100, 100, 100);
    pdf.text('Noble Property Inspections LLC', 20, pageHeight - 10);
    
    // Page number
    pdf.text(`Page ${pageNum}`, pageWidth - 20, pageHeight - 10, { align: 'right' });
  }

  private async loadImage(url: string): Promise<string | null> {
    // Check cache first
    if (this.imageCache.has(url)) {
      return this.imageCache.get(url) || null;
    }
    
    try {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            this.imageCache.set(url, dataUrl);
            resolve(dataUrl);
          } else {
            resolve(null);
          }
        };
        
        img.onerror = () => {
          console.log('Failed to load image:', url);
          resolve(null);
        };
        
        img.src = url;
        
        // Timeout after 5 seconds
        setTimeout(() => {
          resolve(null);
        }, 5000);
      });
    } catch (error) {
      console.error('Error loading image:', error);
      return null;
    }
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
  
  handleImageError(event: any) {
    console.error('Image failed to load:', event.target.src);
    event.target.src = 'assets/img/photo-placeholder.svg';
    event.target.classList.remove('loading');
  }
  
  handleImageLoad(event: any) {
    event.target.classList.remove('loading');
  }
}