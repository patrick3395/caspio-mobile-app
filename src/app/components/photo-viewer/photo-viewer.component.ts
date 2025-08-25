import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { PhotoAnnotatorComponent } from '../photo-annotator/photo-annotator.component';

@Component({
  selector: 'app-photo-viewer',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <ion-header>
      <ion-toolbar style="--background: #F15A27;">
        <ion-title style="color: white;">{{ photoName }}</ion-title>
        <ion-buttons slot="start" *ngIf="canAnnotate">
          <ion-button (click)="openAnnotator()" style="color: white;">
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
        <img [src]="photoUrl" [alt]="photoName" />
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
  `]
})
export class PhotoViewerComponent {
  @Input() photoUrl: string = '';
  @Input() photoName: string = '';
  @Input() canAnnotate: boolean = false;
  @Input() visualId: string = '';
  @Input() categoryKey: string = '';
  @Input() photoData: any = null;

  constructor(private modalController: ModalController) {}

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

  dismiss() {
    this.modalController.dismiss();
  }
}