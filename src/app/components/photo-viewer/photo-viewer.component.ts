import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, AlertController } from '@ionic/angular';
import { PhotoAnnotatorComponent } from '../photo-annotator/photo-annotator.component';

@Component({
  selector: 'app-photo-viewer',
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule],
  template: `
    <ion-header>
      <ion-toolbar style="--background: #F15A27;">
        <ion-title style="color: white;">{{ photoName }}</ion-title>
        <ion-buttons slot="start">
          <ion-button (click)="openAnnotator()" style="color: white;" *ngIf="canAnnotate">
            <ion-icon name="brush-outline" slot="icon-only"></ion-icon>
            <span style="margin-left: 5px;">Annotate</span>
          </ion-button>
          <ion-button (click)="addCaption()" style="color: white;">
            <ion-icon name="text-outline" slot="icon-only"></ion-icon>
            <span style="margin-left: 5px;">Caption</span>
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
        <img [src]="photoUrl" [alt]="photoName" />
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
    }
    .photo-container {
      width: 100%;
      height: 100%;
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
    .caption-display {
      position: absolute;
      bottom: 20px;
      left: 20px;
      right: 20px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 12px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
    }
    .caption-display ion-icon {
      font-size: 18px;
      color: #F15A27;
    }
  `]
})
export class PhotoViewerComponent {
  @Input() photoUrl: string = '';
  @Input() photoName: string = '';
  @Input() canAnnotate: boolean = false;
  @Input() visualId: string = '';
  @Input() categoryKey: string = '';
  @Input() photoData: any = null;
  @Input() photoCaption: string = '';

  constructor(
    private modalController: ModalController,
    private alertController: AlertController
  ) {}

  async openAnnotator() {
    // Open the annotation modal
    const annotationModal = await this.modalController.create({
      component: PhotoAnnotatorComponent,
      componentProps: {
        imageUrl: this.photoUrl
      },
      cssClass: 'fullscreen-modal'
    });
    
    await annotationModal.present();
    const { data } = await annotationModal.onDidDismiss();
    
    if (data && data instanceof Blob) {
      // Update the photo URL to show the new annotated version
      this.photoUrl = URL.createObjectURL(data);
      
      // Return the annotated blob to parent along with photo data
      this.modalController.dismiss({
        annotatedBlob: data,
        photoData: this.photoData
      });
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
}