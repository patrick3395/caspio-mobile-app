import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';

@Component({
  selector: 'app-photo-viewer',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ photoName }}</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">
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
  `]
})
export class PhotoViewerComponent {
  @Input() photoUrl: string = '';
  @Input() photoName: string = '';

  constructor(private modalController: ModalController) {}

  dismiss() {
    this.modalController.dismiss();
  }
}