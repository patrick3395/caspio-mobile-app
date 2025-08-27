import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, LoadingController } from '@ionic/angular';
import jsPDF from 'jspdf';

@Component({
  selector: 'app-pdf-preview',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <ion-header>
      <ion-toolbar style="--background: #F15A27;">
        <ion-title style="color: white;">Report Preview</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="generatePDF()" fill="clear" style="color: white;">
            <ion-icon name="download-outline" slot="start"></ion-icon>
            Generate PDF
          </ion-button>
          <ion-button (click)="dismiss()" fill="clear" style="color: white;">
            <ion-icon name="close" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    
    <ion-content class="pdf-preview-content">
      <div class="pdf-page" id="pdf-content">
        <!-- Cover Page -->
        <div class="page cover-page">
          <div class="company-header">
            <h1>NOBLE PROPERTY INSPECTIONS</h1>
            <p>9362028013</p>
            <p>info@noblepropertyinspections.com</p>
            <p>https://www.noblepropertyinspections.com</p>
          </div>
          
          <h2 class="report-title">ENGINEERS FOUNDATION EVALUATION</h2>
          
          <div class="property-image" *ngIf="projectData?.primaryPhoto">
            <img 
              [src]="getPrimaryPhotoUrl()" 
              alt="Property"
              (error)="handleImageError($event)"
              (load)="handleImageLoad($event)"
              class="loading" />
          </div>
          
          <div class="property-details">
            <h3>{{ projectData?.address || 'Project Address' }}</h3>
            <p>{{ projectData?.city }}, {{ projectData?.state }} {{ projectData?.zip }}</p>
            <p class="client-name">{{ projectData?.clientName || 'Client Name' }}</p>
            <p class="date">{{ projectData?.inspectionDate || getCurrentDate() }}</p>
          </div>
          
          <div class="inspector-info">
            <p>Inspector</p>
            <p><strong>{{ projectData?.inspectorName || 'Inspector Name' }}</strong></p>
            <p>License # {{ projectData?.licenseNumber || '12345' }}</p>
            <p>{{ projectData?.inspectorPhone || '936-202-8013' }}</p>
            <p>{{ projectData?.inspectorEmail || 'info@noblepropertyinspections.com' }}</p>
          </div>
        </div>
        
        <!-- Table of Contents -->
        <div class="page toc-page">
          <h2>TABLE OF CONTENTS</h2>
          <div class="toc-container">
            <div class="toc-item">
              <span>1: Information</span>
              <span class="dots"></span>
              <span>3</span>
            </div>
            <div class="toc-item">
              <span>2: Structural Systems</span>
              <span class="dots"></span>
              <span>5</span>
            </div>
            <div class="toc-item" *ngIf="hasElevationData">
              <span>3: Elevation Plot - Appendix</span>
              <span class="dots"></span>
              <span>{{ getElevationPageNumber() }}</span>
            </div>
          </div>
        </div>
        
        <!-- Information Section -->
        <div class="page content-page">
          <h2>1: INFORMATION</h2>
          
          <div class="section">
            <h3>Information</h3>
            <div class="info-grid">
              <div class="info-item">
                <label>Date of Inspection</label>
                <span>{{ projectData?.inspectionDate || getCurrentDate() }}</span>
              </div>
              <div class="info-item">
                <label>Type of building</label>
                <span>{{ projectData?.buildingType || 'Single Family' }}</span>
              </div>
              <div class="info-item">
                <label>Weather conditions</label>
                <span>{{ projectData?.weatherConditions || 'Clear' }}</span>
              </div>
              <div class="info-item">
                <label>Outdoor temperature</label>
                <span>{{ projectData?.temperature || '75°F' }}</span>
              </div>
              <div class="info-item">
                <label>Inspection address</label>
                <span>{{ projectData?.fullAddress || 'Property Address' }}</span>
              </div>
              <div class="info-item">
                <label>Client's name</label>
                <span>{{ projectData?.clientName || 'Client Name' }}</span>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Structural Systems Section -->
        <div class="page content-page" *ngIf="structuralData && structuralData.length > 0">
          <h2>2: STRUCTURAL SYSTEMS</h2>
          
          <div class="section" *ngFor="let category of structuralData">
            <h3 class="category-header">{{ category.name }}</h3>
            
            <!-- Comments -->
            <div *ngIf="category.comments && category.comments.length > 0" class="subsection">
              <h4>Comments</h4>
              <div *ngFor="let comment of category.comments" class="item-container">
                <div class="item-content">
                  <p class="item-title">{{ comment.name }}</p>
                  <p class="item-text" *ngIf="comment.text">{{ comment.text }}</p>
                </div>
                <div class="photos-grid" *ngIf="comment.photos && comment.photos.length > 0">
                  <div *ngFor="let photo of comment.photos" class="photo-item">
                    <img 
                      [src]="photo.url || 'assets/img/photo-placeholder.svg'" 
                      [alt]="photo.caption || 'Photo'"
                      (error)="handleImageError($event)"
                      (load)="handleImageLoad($event)"
                      class="loading" />
                    <p class="photo-caption" *ngIf="photo.caption">{{ photo.caption }}</p>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Limitations -->
            <div *ngIf="category.limitations && category.limitations.length > 0" class="subsection">
              <h4>Limitations</h4>
              <div *ngFor="let limitation of category.limitations" class="item-container">
                <div class="item-content">
                  <p class="item-title">{{ limitation.name }}</p>
                  <p class="item-text" *ngIf="limitation.text">{{ limitation.text }}</p>
                </div>
                <div class="photos-grid" *ngIf="limitation.photos && limitation.photos.length > 0">
                  <div *ngFor="let photo of limitation.photos" class="photo-item">
                    <img 
                      [src]="photo.url || 'assets/img/photo-placeholder.svg'" 
                      [alt]="photo.caption || 'Photo'"
                      (error)="handleImageError($event)"
                      (load)="handleImageLoad($event)"
                      class="loading" />
                    <p class="photo-caption" *ngIf="photo.caption">{{ photo.caption }}</p>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Deficiencies -->
            <div *ngIf="category.deficiencies && category.deficiencies.length > 0" class="subsection">
              <h4>Deficiencies</h4>
              <div *ngFor="let deficiency of category.deficiencies" class="item-container">
                <div class="item-content">
                  <p class="item-title">{{ deficiency.name }}</p>
                  <p class="item-text" *ngIf="deficiency.text">{{ deficiency.text }}</p>
                </div>
                <div class="photos-grid" *ngIf="deficiency.photos && deficiency.photos.length > 0">
                  <div *ngFor="let photo of deficiency.photos" class="photo-item">
                    <img 
                      [src]="photo.url || 'assets/img/photo-placeholder.svg'" 
                      [alt]="photo.caption || 'Photo'"
                      (error)="handleImageError($event)"
                      (load)="handleImageLoad($event)"
                      class="loading" />
                    <p class="photo-caption" *ngIf="photo.caption">{{ photo.caption }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Elevation Plot Section -->
        <div class="page content-page" *ngIf="elevationData && elevationData.length > 0">
          <h2>3: ELEVATION PLOT - APPENDIX</h2>
          
          <div class="section">
            <h3>Room Measurements</h3>
            
            <div *ngFor="let room of elevationData" class="room-container">
              <h4 class="room-name">{{ room.name }}</h4>
              
              <div class="room-details">
                <div *ngIf="room.fdf && room.fdf !== 'None'" class="detail-row">
                  <label>FDF:</label>
                  <span>{{ room.fdf }}</span>
                </div>
                
                <div *ngIf="room.notes" class="detail-row">
                  <label>Notes:</label>
                  <span>{{ room.notes }}</span>
                </div>
                
                <div *ngIf="room.points && room.points.length > 0" class="elevation-points">
                  <h5>Elevation Points</h5>
                  <table class="elevation-table">
                    <thead>
                      <tr>
                        <th>Point</th>
                        <th>Measurement</th>
                        <th>Photos</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr *ngFor="let point of room.points">
                        <td>{{ point.name }}</td>
                        <td>{{ point.value }}"</td>
                        <td>
                          <span *ngIf="point.photoCount > 0" class="photo-indicator">
                            <ion-icon name="camera"></ion-icon> {{ point.photoCount }}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                
                <div class="photos-grid" *ngIf="room.photos && room.photos.length > 0">
                  <div *ngFor="let photo of room.photos" class="photo-item">
                    <img 
                      [src]="photo.url || 'assets/img/photo-placeholder.svg'" 
                      [alt]="photo.caption || 'Room Photo'"
                      (error)="handleImageError($event)"
                      (load)="handleImageLoad($event)"
                      class="loading" />
                    <p class="photo-caption" *ngIf="photo.caption">{{ photo.caption }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Footer on each page -->
        <div class="page-footer">
          <p>Noble Property Inspections LLC</p>
          <p>Page <span class="page-number"></span> of <span class="total-pages"></span></p>
        </div>
      </div>
    </ion-content>
  `,
  styleUrls: ['./pdf-preview.component.scss']
})
export class PdfPreviewComponent implements OnInit {
  @Input() projectData: any;
  @Input() structuralData: any[] = [];
  @Input() elevationData: any[] = [];
  
  hasElevationData = false;

  constructor(
    private modalController: ModalController,
    private loadingController: LoadingController
  ) {}

  ngOnInit() {
    this.hasElevationData = this.elevationData && this.elevationData.length > 0;
    console.log('PDF Preview initialized with data:', {
      projectData: this.projectData,
      structuralDataCount: this.structuralData?.length || 0,
      elevationDataCount: this.elevationData?.length || 0
    });
  }

  getCurrentDate(): string {
    return new Date().toLocaleDateString();
  }
  
  getPrimaryPhotoUrl(): string {
    if (!this.projectData?.primaryPhoto) {
      return 'assets/img/project-placeholder.svg';
    }
    
    const photo = this.projectData.primaryPhoto;
    
    // If it's a Caspio file path, convert to full URL
    if (photo.startsWith('/')) {
      const account = localStorage.getItem('caspioAccount') || '';
      const token = localStorage.getItem('caspioToken') || '';
      return `https://${account}.caspio.com/rest/v2/files${photo}?access_token=${token}`;
    }
    
    return photo;
  }

  getElevationPageNumber(): number {
    // Calculate based on content
    return 11; // Placeholder
  }

  async generatePDF() {
    const loading = await this.loadingController.create({
      message: 'Generating PDF...',
      cssClass: 'custom-loading'
    });
    await loading.present();

    try {
      // Create PDF from the preview content
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      // Add content to PDF (implementation details would go here)
      // This would convert the HTML preview to PDF pages
      
      const fileName = `EFE_Report_${this.projectData?.projectId || 'draft'}_${new Date().getTime()}.pdf`;
      pdf.save(fileName);
      
      await loading.dismiss();
      this.dismiss();
    } catch (error) {
      console.error('Error generating PDF:', error);
      await loading.dismiss();
    }
  }

  dismiss() {
    this.modalController.dismiss();
  }
  
  handleImageError(event: any) {
    console.error('Image failed to load:', event.target.src);
    // Set a placeholder image
    event.target.src = 'assets/img/photo-placeholder.svg';
    event.target.classList.remove('loading');
  }
  
  handleImageLoad(event: any) {
    // Remove loading class when image loads
    event.target.classList.remove('loading');
  }
}