import { Component, Input, ViewChild, ElementRef, OnInit, OnDestroy, HostListener } from '@angular/core';
import { ModalController, AlertController, IonicModule } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { FabricPhotoAnnotatorComponent } from '../../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { environment } from '../../../environments/environment';

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
export class AddCustomVisualModalComponent implements OnInit, OnDestroy {
  @Input() kind: string = 'Comment'; // Comment, Limitation, or Deficiency
  @Input() category: string = '';
  @ViewChild('fileInput', { static: false }) fileInput?: ElementRef<HTMLInputElement>;

  name: string = '';
  description: string = '';
  processedPhotos: ProcessedPhoto[] = [];

  // WEBAPP: Expose isWeb for template to hide camera button
  isWeb = environment.isWeb;
  // Keyboard navigation support (web only) - G2-FORMS-003
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    private modalController: ModalController,
    private alertController: AlertController
  ) {}

  ngOnInit() {
    // Initialize keyboard navigation (web only) - G2-FORMS-003
    if (this.isWeb) {
      this.keydownHandler = (event: KeyboardEvent) => {
        // Escape key closes modal
        if (event.key === 'Escape') {
          // Don't close if we're in an alert or nested modal
          const topAlert = document.querySelector('ion-alert');
          if (topAlert) return;

          event.preventDefault();
          this.dismiss();
        }
      };
      document.addEventListener('keydown', this.keydownHandler);
    }
  }

  ngOnDestroy() {
    // Clean up keyboard handler
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }

  // Apply standard text formatting: capitalize first letter, "i" to "I", capitalize after periods
  private applyTextFormatting(text: string): string {
    if (!text) return text;

    let result = text;

    // Capitalize first character if it's a letter
    if (result.length > 0 && /[a-z]/.test(result[0])) {
      result = result[0].toUpperCase() + result.slice(1);
    }

    // Replace standalone "i" with "I" (surrounded by spaces, punctuation, or at start/end)
    result = result.replace(/(\s|^)i(\s|$|[.,!?;:])/g, '$1I$2');
    result = result.replace(/(\s)i(')/g, '$1I$2'); // Handle contractions like "i'm" -> "I'm"

    // Capitalize after periods (and other sentence-ending punctuation)
    result = result.replace(/([.!?]\s+)([a-z])/g, (match, punctuation, letter) => {
      return punctuation + letter.toUpperCase();
    });

    return result;
  }

  // Handle name input changes
  onNameInput(event: any) {
    const input = event.target;
    const cursorPosition = input.selectionStart || 0;
    const originalLength = this.name?.length || 0;

    // Apply formatting
    const formatted = this.applyTextFormatting(this.name);

    if (formatted !== this.name) {
      this.name = formatted;
      // Restore cursor position, adjusting for any length changes
      const lengthDiff = formatted.length - originalLength;
      setTimeout(() => {
        input.setSelectionRange(cursorPosition + lengthDiff, cursorPosition + lengthDiff);
      }, 0);
    }
  }

  // Handle description input changes
  onDescriptionInput(event: any) {
    const input = event.target;
    const cursorPosition = input.selectionStart || 0;
    const originalLength = this.description?.length || 0;

    // Apply formatting
    const formatted = this.applyTextFormatting(this.description);

    if (formatted !== this.description) {
      this.description = formatted;
      // Restore cursor position, adjusting for any length changes
      const lengthDiff = formatted.length - originalLength;
      setTimeout(() => {
        input.setSelectionRange(cursorPosition + lengthDiff, cursorPosition + lengthDiff);
      }, 0);
    }
  }

  // Select photos from gallery (camera roll) - multi-select without editor
  async addPhotosFromGallery() {
    try {
      // Open gallery/photos to select MULTIPLE images
      const images = await Camera.pickImages({
        quality: 90,
        limit: 0 // 0 = no limit (unlimited selection)
      });

      if (images.photos && images.photos.length > 0) {
        console.log('[ADD MODAL] Selected', images.photos.length, 'photos from gallery');
        
        // Process each selected photo
        for (let i = 0; i < images.photos.length; i++) {
          const photo = images.photos[i];
          if (photo.webPath) {
            // Convert to blob/file
            const response = await fetch(photo.webPath);
            const blob = await response.blob();
            const file = new File([blob], `gallery-${Date.now()}-${i}.jpg`, { type: 'image/jpeg' });

            // Add directly without opening editor
            await this.addPhotoDirectly(file);
          }
        }
      }
    } catch (error) {
      // Check if user cancelled - don't show error for cancellations
      const errorMessage = typeof error === 'string' ? error : (error as any)?.message || '';
      const isCancelled = errorMessage.includes('cancel') ||
                         errorMessage.includes('Cancel') ||
                         errorMessage.includes('User');

      if (!isCancelled) {
        console.error('Error selecting from gallery:', error);
      }
    }
  }

  // Capture photo from camera and open editor
  async addPhotoFromCamera() {
    try {
      // Capture photo with camera
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera
      });

      if (image.webPath) {
        // Convert to blob/file
        const response = await fetch(image.webPath);
        const blob = await response.blob();
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });

        // Process through photo editor
        await this.processPhotoWithEditor(file);
      }
    } catch (error) {
      // Check if user cancelled - don't show error for cancellations
      const errorMessage = typeof error === 'string' ? error : (error as any)?.message || '';
      const isCancelled = errorMessage.includes('cancel') ||
                         errorMessage.includes('Cancel') ||
                         errorMessage.includes('User');

      if (!isCancelled) {
        console.error('Error capturing photo:', error);
      }
    }
  }

  // Handle file selection from gallery - do NOT open editor
  async onFileSelected(event: any) {
    const files = event.target.files;
    if (files && files.length > 0) {
      // Add photos directly without opening editor
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await this.addPhotoDirectly(file);
      }

      // Clear the input so the same file can be selected again
      event.target.value = '';
    }
  }

  // Add photo directly without opening editor
  async addPhotoDirectly(file: File) {
    try {
      const previewUrl = await this.fileToDataUrl(file);

      console.log('[ADD MODAL] Adding photo directly (no editor), preview URL length:', previewUrl.length);

      this.processedPhotos.push({
        file: file,
        previewUrl: previewUrl,
        annotationData: null,
        originalFile: undefined,
        caption: '',
        hasAnnotations: false
      });

      console.log('[ADD MODAL] Total photos:', this.processedPhotos.length);
    } catch (error) {
      console.error('Error adding photo:', error);
    }
  }

  // Process photo through annotation editor (for camera captures)
  async processPhotoWithEditor(file: File) {
    try {
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

        // Use FileReader to create base64 URL (more reliable than blob URLs)
        const previewUrl = await this.fileToDataUrl(data.blob);

        console.log('[ADD MODAL] Photo annotated, preview URL length:', previewUrl.length);

        this.processedPhotos.push({
          file: annotatedFile,
          previewUrl: previewUrl,
          annotationData: data.annotationData || data.annotationsData,
          originalFile: file,
          caption: data.caption || '',
          hasAnnotations: !!(data.annotationData || data.annotationsData)
        });
      } else {
        // User cancelled or no blob - add original photo without annotations
        const previewUrl = await this.fileToDataUrl(file);

        console.log('[ADD MODAL] Using original photo, preview URL length:', previewUrl.length);

        this.processedPhotos.push({
          file: file,
          previewUrl: previewUrl,
          annotationData: null,
          originalFile: undefined,
          caption: '',
          hasAnnotations: false
        });
      }

      console.log('[ADD MODAL] Total photos:', this.processedPhotos.length);
    } catch (error) {
      console.error('Error processing photo:', error);
      // Still add the photo even if annotation fails
      const previewUrl = await this.fileToDataUrl(file);
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

  // Convert File/Blob to base64 data URL
  private fileToDataUrl(file: File | Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Edit photo annotations
  async editPhoto(index: number) {
    const photo = this.processedPhotos[index];
    const fileToEdit = photo.originalFile || photo.file;

    try {
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

        // Use base64 data URL for preview (more reliable than blob URLs)
        const previewUrl = await this.fileToDataUrl(data.blob);

        console.log('[ADD MODAL] Photo re-edited, preview URL length:', previewUrl.length);

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

  // Open caption editor with preset buttons
  async editCaption(index: number) {
    const photo = this.processedPhotos[index];

    try {
      // Escape HTML to prevent injection and errors
      const escapeHtml = (text: string) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      };

      // Create a temporary caption value to work with
      const tempCaption = escapeHtml(photo.caption || '');

      // Define preset location buttons - 3 columns layout (matching category-detail)
      const presetButtons = [
        ['Front', '1st', 'Laundry'],
        ['Left', '2nd', 'Kitchen'],
        ['Right', '3rd', 'Living'],
        ['Back', '4th', 'Dining'],
        ['Top', '5th', 'Bedroom'],
        ['Bottom', 'Floor', 'Bathroom'],
        ['Middle', 'Unit', 'Closet'],
        ['Primary', 'Attic', 'Entry'],
        ['Supply', 'Porch', 'Office'],
        ['Return', 'Deck', 'Garage'],
        ['Staircase', 'Roof', 'Indoor'],
        ['Hall', 'Ceiling', 'Outdoor']
      ];

      // Build custom HTML for the alert with preset buttons
      let buttonsHtml = '<div class="preset-buttons-container">';
      presetButtons.forEach(row => {
        buttonsHtml += '<div class="preset-row">';
        row.forEach(label => {
          buttonsHtml += `<button type="button" class="preset-btn" data-text="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
        });
        buttonsHtml += '</div>';
      });
      buttonsHtml += '</div>';

      const alert = await this.alertController.create({
        header: 'Photo Caption',
        cssClass: 'caption-popup-alert',
        message: ' ', // Empty space to prevent Ionic from hiding the message area
        buttons: [
          {
            text: 'Save',
            handler: () => {
              try {
                const input = document.getElementById('captionInput') as HTMLInputElement;
                const newCaption = input?.value || '';
                this.processedPhotos[index].caption = newCaption;
                return true;
              } catch (error) {
                console.error('Error updating caption:', error);
                return true;
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

      // Inject HTML content immediately after presentation
      setTimeout(() => {
        try {
          const alertElement = document.querySelector('.caption-popup-alert .alert-message');
          if (!alertElement) {
            return;
          }

          // Build the full HTML content with inline styles for mobile app compatibility
          const htmlContent = `
            <div class="caption-popup-content">
              <div class="caption-input-container" style="position: relative; margin-bottom: 16px;">
                <input type="text" id="captionInput" class="caption-text-input"
                       placeholder="Enter caption..."
                       value="${tempCaption}"
                       maxlength="255"
                       style="width: 100%; padding: 14px 54px 14px 14px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; color: #333; background: white; box-sizing: border-box; height: 52px;" />
                <button type="button" id="undoCaptionBtn" class="undo-caption-btn" title="Undo Last Word"
                        style="position: absolute; right: 5px; top: 5px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; z-index: 10;">
                  <ion-icon name="backspace-outline" style="font-size: 20px; color: #666;"></ion-icon>
                </button>
              </div>
              ${buttonsHtml}
            </div>
          `;
          alertElement.innerHTML = htmlContent;

          const captionInput = document.getElementById('captionInput') as HTMLInputElement;
          const undoBtn = document.getElementById('undoCaptionBtn') as HTMLButtonElement;

          // Use event delegation for better performance
          const container = document.querySelector('.caption-popup-alert .preset-buttons-container');
          if (container && captionInput) {
            container.addEventListener('click', (e) => {
              try {
                const target = e.target as HTMLElement;
                const btn = target.closest('.preset-btn') as HTMLElement;
                if (btn) {
                  e.preventDefault();
                  e.stopPropagation();
                  const text = btn.getAttribute('data-text');
                  if (text && captionInput) {
                    // Add text + space to current caption
                    captionInput.value = (captionInput.value || '') + text + ' ';
                    // CRITICAL: Remove focus from button immediately to prevent orange highlight on mobile
                    (btn as HTMLButtonElement).blur();
                  }
                }
              } catch (error) {
                console.error('Error handling preset button click:', error);
              }
            }, { passive: false });
          }

          // Add click handler for undo button
          if (undoBtn && captionInput) {
            undoBtn.addEventListener('click', (e) => {
              try {
                e.preventDefault();
                e.stopPropagation();
                const currentValue = captionInput.value || '';
                if (currentValue.trim() === '') {
                  return;
                }
                // Trim trailing spaces and split by spaces
                const words = currentValue.trim().split(' ');
                // Remove the last word
                if (words.length > 0) {
                  words.pop();
                }
                // Join back and update input
                captionInput.value = words.join(' ');
                // Add trailing space if there are still words
                if (captionInput.value.length > 0) {
                  captionInput.value += ' ';
                }
              } catch (error) {
                console.error('Error handling undo button click:', error);
              }
            });
          }

          // CRITICAL: Add Enter key handler to prevent form submission and provide smooth save
          if (captionInput) {
            captionInput.addEventListener('keydown', (e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                // Find and click the Save button to trigger the save handler
                const saveBtn = document.querySelector('.caption-popup-alert button.alert-button:not([data-role="cancel"])') as HTMLButtonElement;
                if (saveBtn) {
                  saveBtn.click();
                }
              }
            });
          }

          // Focus the input
          if (captionInput) {
            captionInput.focus();
          }
        } catch (error) {
          console.error('Error setting up caption popup:', error);
        }
      }, 100);
    } catch (error) {
      console.error('Error opening caption popup:', error);
    }
  }

  // Remove a photo
  removePhoto(index: number) {
    // Since we're using base64 data URLs now (not blob URLs), no need to revoke
    this.processedPhotos.splice(index, 1);
  }

  // Handle image loading errors
  async onImageError(event: any, index: number) {
    console.error('[ADD MODAL] Image failed to load:', {
      index,
      previewUrl: this.processedPhotos[index]?.previewUrl?.substring(0, 50),
      error: event
    });

    // Try to regenerate the data URL from the file
    const photo = this.processedPhotos[index];
    if (photo && photo.file) {
      console.log('[ADD MODAL] Attempting to regenerate data URL from file');
      try {
        const newUrl = await this.fileToDataUrl(photo.file);
        this.processedPhotos[index].previewUrl = newUrl;
        console.log('[ADD MODAL] New data URL length:', newUrl.length);
      } catch (err) {
        console.error('[ADD MODAL] Failed to regenerate data URL:', err);
      }
    }
  }

  // Dismiss modal without saving
  async dismiss() {
    // Since we're using base64 data URLs now (not blob URLs), no cleanup needed
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
