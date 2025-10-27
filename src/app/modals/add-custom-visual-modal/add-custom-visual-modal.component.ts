import { Component, Input, ViewChild, ElementRef } from '@angular/core';
import { ModalController, AlertController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

// Processed photo data structure matching the main page
interface ProcessedPhoto {
  file: File;
  previewUrl: string;
  annotationData?: any;
  originalFile?: File;
  caption: string;
  hasAnnotations: boolean;
}

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
  processedPhotos: ProcessedPhoto[] = [];

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

  // Handle file selection - open photo editor for each file
  async onFileSelected(event: any) {
    const files = event.target.files;
    if (files && files.length > 0) {
      // Process each file through the photo editor
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await this.processPhoto(file);
      }

      // Clear the input so the same file can be selected again
      event.target.value = '';
    }
  }

  // Process photo through annotation editor
  async processPhoto(file: File) {
    try {
      // Dynamically import the photo annotator
      const { FabricPhotoAnnotatorComponent } = await import('../../modals/fabric-photo-annotator/fabric-photo-annotator.component');

      const modal = await this.modalController.create({
        component: FabricPhotoAnnotatorComponent,
        componentProps: {
          imageFile: file
        },
        cssClass: 'fullscreen-modal'
      });

      await modal.present();
      const { data } = await modal.onDidDismiss();

      if (data && data.blob) {
        // Photo was annotated/edited
        const annotatedFile = new File([data.blob], file.name, { type: 'image/jpeg' });
        const previewUrl = URL.createObjectURL(data.blob);

        this.processedPhotos.push({
          file: annotatedFile,
          previewUrl: previewUrl,
          annotationData: data.annotationData || data.annotationsData,
          originalFile: file,
          caption: data.caption || '',
          hasAnnotations: !!(data.annotationData || data.annotationsData)
        });
      } else {
        // User cancelled - add original photo without annotations
        const previewUrl = URL.createObjectURL(file);
        this.processedPhotos.push({
          file: file,
          previewUrl: previewUrl,
          annotationData: null,
          originalFile: undefined,
          caption: '',
          hasAnnotations: false
        });
      }
    } catch (error) {
      console.error('Error processing photo:', error);
      // Still add the photo even if annotation fails
      const previewUrl = URL.createObjectURL(file);
      this.processedPhotos.push({
        file: file,
        previewUrl: previewUrl,
        annotationData: null,
        originalFile: undefined,
        caption: '',
        hasAnnotations: false
      });
    }
  }

  // Edit photo annotations
  async editPhoto(index: number) {
    const photo = this.processedPhotos[index];
    const fileToEdit = photo.originalFile || photo.file;

    try {
      const { FabricPhotoAnnotatorComponent } = await import('../../modals/fabric-photo-annotator/fabric-photo-annotator.component');

      const modal = await this.modalController.create({
        component: FabricPhotoAnnotatorComponent,
        componentProps: {
          imageFile: fileToEdit,
          existingAnnotations: photo.annotationData,
          existingCaption: photo.caption
        },
        cssClass: 'fullscreen-modal'
      });

      await modal.present();
      const { data } = await modal.onDidDismiss();

      if (data && data.blob) {
        // Update with new annotations
        const annotatedFile = new File([data.blob], photo.file.name, { type: 'image/jpeg' });

        // Revoke old preview URL
        URL.revokeObjectURL(photo.previewUrl);

        const previewUrl = URL.createObjectURL(data.blob);

        this.processedPhotos[index] = {
          file: annotatedFile,
          previewUrl: previewUrl,
          annotationData: data.annotationData || data.annotationsData,
          originalFile: photo.originalFile || fileToEdit,
          caption: data.caption || '',
          hasAnnotations: !!(data.annotationData || data.annotationsData)
        };
      }
    } catch (error) {
      console.error('Error editing photo:', error);
    }
  }

  // Open caption editor
  async editCaption(index: number) {
    const photo = this.processedPhotos[index];

    const alert = await this.alertController.create({
      header: 'Edit Caption',
      inputs: [
        {
          name: 'caption',
          type: 'textarea',
          placeholder: 'Enter caption',
          value: photo.caption
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
            this.processedPhotos[index].caption = data.caption || '';
          }
        }
      ]
    });

    await alert.present();
  }

  // Remove a photo
  removePhoto(index: number) {
    // Revoke the object URL to free memory
    URL.revokeObjectURL(this.processedPhotos[index].previewUrl);
    this.processedPhotos.splice(index, 1);
  }

  // Dismiss modal without saving
  async dismiss() {
    // Clean up object URLs
    this.processedPhotos.forEach(photo => {
      URL.revokeObjectURL(photo.previewUrl);
    });
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

    // Return the data with processed photos
    this.modalController.dismiss({
      name: this.name.trim(),
      description: this.description.trim(),
      files: this.processedPhotos.map(p => p.file),
      processedPhotos: this.processedPhotos // Include full photo data
    });
  }
}
