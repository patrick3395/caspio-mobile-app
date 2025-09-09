import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, AlertController } from '@ionic/angular';
import { FabricPhotoAnnotatorComponent } from '../fabric-photo-annotator/fabric-photo-annotator.component';

@Component({
  selector: 'app-photo-viewer',
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  template: `
    <ion-header>
      <ion-toolbar style="--background: #F15A27;">
        <ion-title style="color: white;">Photo Viewer</ion-title>
        <ion-buttons slot="start">
          <ion-button (click)="openAnnotator()" style="color: white;" *ngIf="canAnnotate">
            <ion-icon name="brush-outline" slot="icon-only"></ion-icon>
            <span style="margin-left: 5px;">Annotate</span>
          </ion-button>
        </ion-buttons>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()" style="color: white;">
            <ion-icon name="close" slot="icon-only"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="photo-viewer-content">
      <div class="photo-container">
        <img [src]="displayPhotoUrl || photoUrl" alt="Photo" />
      </div>
      <!-- Caption button at bottom center -->
      <div class="caption-button-container">
        <ion-button (click)="addCaption()" fill="solid" color="primary">
          {{ photoCaption ? 'Edit Caption' : 'Add Caption' }}
        </ion-button>
      </div>
      <!-- Caption display -->
      <div class="caption-display" *ngIf="photoCaption">
        <ion-icon name="chatbox-ellipses-outline"></ion-icon>
        <span>{{ photoCaption }}</span>
      </div>
    </ion-content>
  `,
  styles: [`
    .photo-viewer-content {
      --background: #000;
      position: relative;
    }
    .photo-container {
      width: 100%;
      height: calc(100% - 120px); /* Leave space for caption button and display */
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    ion-toolbar ion-button {
      --padding-start: 8px;
      --padding-end: 8px;
    }
    ion-toolbar ion-button span {
      font-size: 14px;
      font-weight: 500;
    }
    .caption-button-container {
      position: fixed;
      bottom: 70px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 100;
    }
    .caption-button-container ion-button {
      --background: #F15A27;
      --background-hover: #d44e20;
      --border-radius: 25px;
      --padding-start: 20px;
      --padding-end: 20px;
      --padding-top: 10px;
      --padding-bottom: 10px;
      font-weight: 600;
      font-size: 14px;
      box-shadow: 0 4px 15px rgba(241, 90, 39, 0.5);
    }
    .caption-display {
      position: fixed;
      bottom: 10px;
      left: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      z-index: 100;
      max-width: calc(100% - 40px);
    }
    .caption-display ion-icon {
      font-size: 18px;
      color: #F15A27;
      flex-shrink: 0;
    }
    .caption-display span {
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `]
})
export class PhotoViewerComponent implements OnInit {
  @Input() photoUrl: string = '';
  @Input() photoName: string = '';
  @Input() canAnnotate: boolean = false;
  @Input() visualId: string = '';
  @Input() categoryKey: string = '';
  @Input() photoData: any = null;
  @Input() photoCaption: string = '';
  @Input() existingAnnotations: any[] = [];
  
  // Keep track of original image URL separately from display URL
  private originalPhotoUrl: string = '';
  private displayPhotoUrl: string = '';  // What we show (may be annotated)

  constructor(
    private modalController: ModalController,
    private alertController: AlertController
  ) {}

  ngOnInit() {
    // Store the original URL when component initializes
    this.originalPhotoUrl = this.photoUrl;
    this.displayPhotoUrl = this.photoUrl;
  }
  
  async openAnnotator() {
    // Get existing annotations from photoData if available
    const annotations = this.photoData?.annotations || this.photoData?.annotationsData || this.existingAnnotations || [];
    
    // CRITICAL FIX: Always use the ORIGINAL image URL, not the annotated one
    // This prevents double annotations (baked + objects)
    const imageToAnnotate = this.originalPhotoUrl || this.photoUrl; // Use original, not display URL
    
    console.log('📝 [PhotoViewer] Opening annotator with:');
    console.log('  - photoData:', this.photoData);
    console.log('  - annotations from photoData:', this.photoData?.annotations);
    console.log('  - annotationsData from photoData:', this.photoData?.annotationsData);
    console.log('  - originalFilePath:', this.photoData?.originalFilePath);
    console.log('  - Using image URL:', imageToAnnotate);
    console.log('  - existingAnnotations prop:', this.existingAnnotations);
    console.log('  - Final annotations to pass:', annotations);
    
    // Open the annotation modal with existing annotations
    const annotationModal = await this.modalController.create({
      component: FabricPhotoAnnotatorComponent,
      componentProps: {
        imageUrl: imageToAnnotate,  // Use original image if available
        existingAnnotations: annotations,
        photoData: this.photoData,
        isReEdit: !!this.photoData?.originalFilePath  // Flag to indicate we're re-editing
      },
      cssClass: 'fullscreen-modal'
    });
    
    await annotationModal.present();
    const { data } = await annotationModal.onDidDismiss();
    
    if (data) {
      if (data.annotatedBlob) {
        // CRITICAL FIX: Update DISPLAY URL only, keep original intact
        this.displayPhotoUrl = URL.createObjectURL(data.annotatedBlob);
        // DO NOT update this.photoUrl or this.originalPhotoUrl!
        
        // Store annotations back in photoData for persistence
        if (this.photoData) {
          this.photoData.annotations = data.annotationData || data.annotationsData;
          console.log('💾 [PhotoViewer] Stored annotations in photoData:', this.photoData.annotations);
          console.log('🔍 [v1.4.259] Original URL preserved:', this.originalPhotoUrl);
          console.log('🖼️ [v1.4.259] Display URL updated to annotated version');
        }
        
        // Return the annotated blob and annotations data to parent
        this.modalController.dismiss({
          annotatedBlob: data.annotatedBlob,
          annotationsData: data.annotationsData || data.annotationData,
          annotationData: data.annotationsData || data.annotationData,  // Include both for compatibility
          photoData: this.photoData,
          originalBlob: data.originalBlob  // Pass through original if available
        });
      } else if (data instanceof Blob) {
        // Legacy support
        this.displayPhotoUrl = URL.createObjectURL(data);
        this.modalController.dismiss({
          annotatedBlob: data,
          photoData: this.photoData
        });
      }
    }
  }

  async addCaption() {
    const alert = await this.alertController.create({
      header: 'Add Caption',
      inputs: [
        {
          name: 'caption',
          type: 'text',
          placeholder: 'Enter caption...',
          value: this.photoCaption || '',
          attributes: {
            maxlength: 255
          }
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Save',
          handler: (data) => {
            if (data.caption !== undefined) {
              this.photoCaption = data.caption;
              // Return the updated caption to parent
              this.modalController.dismiss({
                updatedCaption: data.caption,
                photoData: this.photoData
              });
            }
          }
        }
      ]
    });

    await alert.present();
  }

  dismiss() {
    this.modalController.dismiss();
  }
  
  // Helper method to construct the full image URL from Caspio file path
  private async getImageUrl(filePath: string): Promise<string> {
    // If it's already a full URL, return it
    if (filePath.startsWith('http')) {
      return filePath;
    }
    
    // Construct Caspio file URL
    // You may need to adjust this based on your Caspio configuration
    const baseUrl = 'https://c7esh782.caspio.com/dp/95678000'; // Update with your actual Caspio base URL
    return `${baseUrl}/files${filePath}`;
  }
}