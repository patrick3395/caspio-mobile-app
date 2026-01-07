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
    <div class="compact-photo-viewer">
      <!-- Close button -->
      <button class="close-btn" (click)="dismiss()">
        <ion-icon name="close"></ion-icon>
      </button>

      <!-- Photo container -->
      <div class="photo-container">
        <img [src]="displayPhotoUrl || photoUrl" alt="Photo" (click)="dismiss()" />
      </div>

      <!-- Caption display -->
      <div class="caption-display" *ngIf="photoCaption">
        <p>{{ photoCaption }}</p>
      </div>
    </div>
  `,
  styles: [`
    .compact-photo-viewer {
      position: relative;
      width: 100%;
      height: 100%;
      background: #ffffff;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 15px;
      border-radius: 8px;
      border: 2px solid #e0e0e0;
      box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.05);
    }

    .close-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #f0f0f0;
      border: 1px solid #d0d0d0;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 10;
      transition: all 0.2s ease;
    }

    .close-btn:hover {
      background: #e0e0e0;
      border-color: #b0b0b0;
      transform: scale(1.05);
    }

    .close-btn ion-icon {
      font-size: 20px;
      color: #555;
    }

    .photo-container {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      max-height: calc(100% - 50px);
      padding: 5px;
    }

    img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      border: 1px solid rgba(0, 0, 0, 0.1);
      cursor: pointer;
      transition: transform 0.2s ease;
    }

    img:hover {
      transform: scale(1.01);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
    }

    .caption-display {
      position: absolute;
      bottom: 12px;
      left: 15px;
      right: 15px;
      background: #f8f8f8;
      color: #333;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12px;
      text-align: center;
      border: 1px solid #e0e0e0;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }

    .caption-display p {
      margin: 0;
      line-height: 1.3;
      font-weight: 500;
    }

    @media (max-width: 768px) {
      .compact-photo-viewer {
        padding: 12px;
      }

      .caption-display {
        font-size: 11px;
        padding: 6px 10px;
        bottom: 10px;
      }
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
  @Input() enableCaption: boolean = true;
  
  // Keep track of original image URL separately from display URL
  private originalPhotoUrl: string = '';
  displayPhotoUrl: string = '';  // What we show (may be annotated) - public for template access

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
    const imageToAnnotate = this.originalPhotoUrl || this.photoUrl;
    
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
    if (!this.enableCaption) {
      return;
    }
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
        },
        {
          text: 'Cancel',
          role: 'cancel'
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
