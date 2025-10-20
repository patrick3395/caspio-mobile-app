import { Component, Input, ViewChild, ElementRef } from '@angular/core';
import { ModalController, AlertController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-add-custom-visual-modal',
  templateUrl: './add-custom-visual-modal.component.html',
  styleUrls: ['./add-custom-visual-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class AddCustomVisualModalComponent {
  @Input() kind: string = 'Comment'; // Comment, Limitation, or Deficiency
  @Input() category: string = '';
  @ViewChild('fileInput', { static: false }) fileInput?: ElementRef<HTMLInputElement>;

  name: string = '';
  description: string = '';
  selectedFiles: File[] = [];
  photoPreviewUrls: string[] = [];

  constructor(
    private modalController: ModalController,
    private alertController: AlertController
  ) {}

  // Trigger file input
  async addPhotos() {
    if (this.fileInput) {
      this.fileInput.nativeElement.click();
    }
  }

  // Handle file selection
  async onFileSelected(event: any) {
    const files = event.target.files;
    if (files && files.length > 0) {
      // Add new files to the array
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        this.selectedFiles.push(file);

        // Create preview URL
        const reader = new FileReader();
        reader.onload = (e: any) => {
          this.photoPreviewUrls.push(e.target.result);
        };
        reader.readAsDataURL(file);
      }

      // Clear the input so the same file can be selected again
      event.target.value = '';
    }
  }

  // Remove a photo
  removePhoto(index: number) {
    this.selectedFiles.splice(index, 1);
    this.photoPreviewUrls.splice(index, 1);
  }

  // Dismiss modal without saving
  async dismiss() {
    await this.modalController.dismiss();
  }

  // Save and close modal
  async save() {
    if (!this.name || !this.name.trim()) {
      const alert = await this.alertController.create({
        header: 'Name Required',
        message: 'Please enter a name for this item.',
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    // Return the data
    this.modalController.dismiss({
      name: this.name.trim(),
      description: this.description.trim(),
      files: this.selectedFiles
    });
  }
}
