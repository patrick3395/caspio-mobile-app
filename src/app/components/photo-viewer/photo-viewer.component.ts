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
      background: linear-gradient(135deg, rgba(240, 240, 245, 0.98), rgba(250, 250, 252, 0.98));
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      border-radius: 12px;
    }

    .close-btn {
      position: absolute;
      top: 10px;
      right: 10px;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.1);
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 10;
      transition: background 0.2s ease;
    }

    .close-btn:hover {
      background: rgba(0, 0, 0, 0.2);
    }

    .close-btn ion-icon {
      font-size: 24px;
      color: #333;
    }

    .photo-container {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      max-height: calc(100% - 60px);
    }

    img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 8px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
      cursor: pointer;
    }

    .caption-display {
      position: absolute;
      bottom: 15px;
      left: 20px;
      right: 20px;
      background: rgba(255, 255, 255, 0.95);
      color: #333;
      padding: 10px 15px;
      border-radius: 8px;
      font-size: 13px;
      text-align: center;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(0, 0, 0, 0.1);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }

    .caption-display p {
      margin: 0;
      line-height: 1.4;
      font-weight: 500;
    }

    @media (max-width: 768px) {
      .compact-photo-viewer {
        padding: 15px;
      }

      .caption-display {
        font-size: 12px;
        padding: 8px 12px;
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
