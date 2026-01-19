import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, AlertController, ModalController, NavController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { CaspioService } from '../../../../services/caspio.service';
import { FabricPhotoAnnotatorComponent } from '../../../../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { IndexedDbService } from '../../../../services/indexed-db.service';
import { ImageCompressionService } from '../../../../services/image-compression.service';
import { db, VisualField } from '../../../../services/caspio-db';
import { VisualFieldRepoService } from '../../../../services/visual-field-repo.service';
import { LocalImageService } from '../../../../services/local-image.service';
import { EngineersFoundationDataService } from '../../engineers-foundation-data.service';
import { liveQuery } from 'dexie';

interface VisualItem {
  id: string | number;
  templateId: number;
  name: string;
  text: string;
  originalText: string;
  type: string;
  category: string;
  answerType: number;
  required: boolean;
  answer?: string;
  isSelected?: boolean;
  key?: string;
}

interface PhotoItem {
  id: string;
  displayUrl: string;
  caption: string;
  uploading: boolean;
  isLocal: boolean;
}

@Component({
  selector: 'app-visual-detail',
  templateUrl: './visual-detail.page.html',
  styleUrls: ['./visual-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class VisualDetailPage implements OnInit, OnDestroy {
  categoryName: string = '';
  templateId: number = 0;
  projectId: string = '';
  serviceId: string = '';
  visualId: string = '';  // The actual visualId used to store photos

  // Visual item data
  item: VisualItem | null = null;
  loading: boolean = true;
  saving: boolean = false;

  // Editable fields
  editableTitle: string = '';
  editableText: string = '';

  // Photos
  photos: PhotoItem[] = [];
  loadingPhotos: boolean = false;
  uploadingPhotos: boolean = false;

  // Subscriptions
  private routeSubscription?: Subscription;
  private localImagesSubscription?: Subscription;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private navController: NavController,
    private caspioService: CaspioService,
    private toastController: ToastController,
    private alertController: AlertController,
    private modalController: ModalController,
    private changeDetectorRef: ChangeDetectorRef,
    private indexedDb: IndexedDbService,
    private imageCompression: ImageCompressionService,
    private visualFieldRepo: VisualFieldRepoService,
    private localImageService: LocalImageService,
    private foundationData: EngineersFoundationDataService
  ) {}

  ngOnInit() {
    this.loadRouteParams();
  }

  ngOnDestroy() {
    this.routeSubscription?.unsubscribe();
    this.localImagesSubscription?.unsubscribe();
  }

  private loadRouteParams() {
    // Route structure: Container (projectId/serviceId) -> structural -> category/:category -> visual/:templateId
    // From visual-detail, we need to go up multiple levels

    // Get category from parent route params (category/:category level)
    const categoryParams = this.route.parent?.snapshot.params;
    this.categoryName = categoryParams?.['category'] || '';
    console.log('[VisualDetail] Category from route:', this.categoryName);

    // Get project/service IDs from container (go up through structural to container)
    // Try parent?.parent?.parent first (category -> structural -> container)
    let containerParams = this.route.parent?.parent?.parent?.snapshot?.params;
    console.log('[VisualDetail] Container params (p.p.p):', containerParams);

    if (containerParams) {
      this.projectId = containerParams['projectId'] || '';
      this.serviceId = containerParams['serviceId'] || '';
    }

    // Fallback: Try one more level up if needed
    if (!this.projectId || !this.serviceId) {
      containerParams = this.route.parent?.parent?.parent?.parent?.snapshot?.params;
      console.log('[VisualDetail] Container params (p.p.p.p):', containerParams);
      if (containerParams) {
        this.projectId = this.projectId || containerParams['projectId'] || '';
        this.serviceId = this.serviceId || containerParams['serviceId'] || '';
      }
    }

    console.log('[VisualDetail] Final values - Category:', this.categoryName, 'ProjectId:', this.projectId, 'ServiceId:', this.serviceId);

    // Get templateId from current route
    this.routeSubscription = this.route.params.subscribe(params => {
      this.templateId = parseInt(params['templateId'], 10);
      console.log('[VisualDetail] TemplateId from route:', this.templateId);
      this.loadVisualData();
    });
  }

  private async loadVisualData() {
    this.loading = true;

    try {
      // Try to load from Dexie first
      const fields = await db.visualFields
        .where('[serviceId+category]')
        .equals([this.serviceId, this.categoryName])
        .toArray();

      const field = fields.find(f => f.templateId === this.templateId);

      if (field) {
        this.item = this.convertFieldToItem(field);
        this.editableTitle = this.item.name;
        this.editableText = this.item.text;
      }

      // Load photos
      await this.loadPhotos();

    } catch (error) {
      console.error('[VisualDetail] Error loading data:', error);
      await this.showToast('Error loading visual data', 'danger');
    } finally {
      this.loading = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  private convertFieldToItem(field: VisualField): VisualItem {
    return {
      id: field.id || field.templateId,
      templateId: field.templateId,
      name: field.templateName || '',
      text: field.templateText || '',
      originalText: field.templateText || '',
      type: field.kind || '',
      category: field.category || '',
      answerType: field.answerType || 0,
      required: false,
      answer: field.answer,
      isSelected: field.isSelected,
      key: field.key
    };
  }

  private async loadPhotos() {
    this.loadingPhotos = true;

    try {
      // Get the visualId from visualFields - this is how photos are stored
      const fields = await db.visualFields
        .where('[serviceId+category]')
        .equals([this.serviceId, this.categoryName])
        .toArray();

      const field = fields.find(f => f.templateId === this.templateId);

      // The entityId for photos is the visualId (temp_visual_xxx or real VisualID)
      this.visualId = field?.tempVisualId || field?.visualId || String(field?.id) || '';

      if (!this.visualId) {
        console.log('[VisualDetail] No visualId found for templateId:', this.templateId);
        this.photos = [];
        return;
      }

      console.log('[VisualDetail] Loading photos for visualId:', this.visualId);

      // Load local images from IndexedDB using visualId as entityId
      const localImages = await db.localImages
        .where('entityId')
        .equals(this.visualId)
        .toArray();

      console.log('[VisualDetail] Found localImages:', localImages.length);

      // Convert to PhotoItem format
      this.photos = [];

      for (const img of localImages) {
        // Get the blob data if available
        let displayUrl = 'assets/img/photo-placeholder.png';
        if (img.localBlobId) {
          const blob = await db.localBlobs.get(img.localBlobId);
          if (blob) {
            const blobObj = new Blob([blob.data], { type: blob.contentType });
            displayUrl = URL.createObjectURL(blobObj);
          }
        } else if (img.remoteUrl) {
          displayUrl = img.remoteUrl;
        }

        this.photos.push({
          id: img.imageId,
          displayUrl,
          caption: img.caption || '',
          uploading: img.status === 'queued' || img.status === 'uploading',
          isLocal: !img.isSynced
        });
      }

    } catch (error) {
      console.error('[VisualDetail] Error loading photos:', error);
    } finally {
      this.loadingPhotos = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  // ===== SAVE METHODS =====

  async saveAll() {
    const titleChanged = this.item && this.editableTitle !== this.item.name;
    const textChanged = this.item && this.editableText !== this.item.text;

    if (!titleChanged && !textChanged) {
      this.goBack();
      return;
    }

    this.saving = true;
    try {
      // Build update data for both Dexie and Caspio sync
      const dexieUpdate: any = {};
      const caspioUpdate: any = {};

      if (titleChanged) {
        dexieUpdate.templateName = this.editableTitle;
        caspioUpdate.Name = this.editableTitle;
      }

      if (textChanged) {
        dexieUpdate.templateText = this.editableText;
        caspioUpdate.Text = this.editableText;
      }

      // DEXIE-FIRST: Update local Dexie field
      await this.visualFieldRepo.setField(
        this.serviceId,
        this.categoryName,
        this.templateId,
        dexieUpdate
      );
      console.log('[VisualDetail] ✅ Updated Dexie field:', dexieUpdate);

      // Queue update to Caspio for background sync
      if (this.visualId) {
        await this.foundationData.updateVisual(this.visualId, caspioUpdate, this.serviceId);
        console.log('[VisualDetail] ✅ Queued Caspio update:', caspioUpdate);
      }

      // Update local item state
      if (titleChanged && this.item) this.item.name = this.editableTitle;
      if (textChanged && this.item) this.item.text = this.editableText;

    } catch (error) {
      console.error('[VisualDetail] Error saving:', error);
      await this.showToast('Error saving changes', 'danger');
    } finally {
      this.saving = false;
    }

    // Navigate back
    this.goBack();
  }

  async saveTitle() {
    if (!this.item || this.editableTitle === this.item.name) return;

    this.saving = true;
    try {
      // DEXIE-FIRST: Update local Dexie field
      await this.visualFieldRepo.setField(
        this.serviceId,
        this.categoryName,
        this.templateId,
        { templateName: this.editableTitle }
      );
      console.log('[VisualDetail] ✅ Updated title in Dexie');

      // Queue update to Caspio for background sync
      if (this.visualId) {
        await this.foundationData.updateVisual(this.visualId, { Name: this.editableTitle }, this.serviceId);
        console.log('[VisualDetail] ✅ Queued title update to Caspio');
      }

      this.item.name = this.editableTitle;
      await this.showToast('Title saved', 'success');
    } catch (error) {
      console.error('[VisualDetail] Error saving title:', error);
      await this.showToast('Error saving title', 'danger');
    } finally {
      this.saving = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  async saveText() {
    if (!this.item || this.editableText === this.item.text) return;

    this.saving = true;
    try {
      // DEXIE-FIRST: Update local Dexie field
      await this.visualFieldRepo.setField(
        this.serviceId,
        this.categoryName,
        this.templateId,
        { templateText: this.editableText }
      );
      console.log('[VisualDetail] ✅ Updated text in Dexie');

      // Queue update to Caspio for background sync
      if (this.visualId) {
        await this.foundationData.updateVisual(this.visualId, { Text: this.editableText }, this.serviceId);
        console.log('[VisualDetail] ✅ Queued text update to Caspio');
      }

      this.item.text = this.editableText;
      await this.showToast('Description saved', 'success');
    } catch (error) {
      console.error('[VisualDetail] Error saving text:', error);
      await this.showToast('Error saving description', 'danger');
    } finally {
      this.saving = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  // ===== PHOTO METHODS =====

  async addPhotoFromCamera() {
    try {
      const photo = await Camera.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        saveToGallery: false
      });

      if (photo.dataUrl) {
        await this.processAndSavePhoto(photo.dataUrl);
      }
    } catch (error: any) {
      if (error?.message !== 'User cancelled photos app') {
        console.error('[VisualDetail] Camera error:', error);
        await this.showToast('Error taking photo', 'danger');
      }
    }
  }

  async addPhotoFromGallery() {
    try {
      const photo = await Camera.getPhoto({
        quality: 70,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Photos,
        saveToGallery: false
      });

      if (photo.dataUrl) {
        await this.processAndSavePhoto(photo.dataUrl);
      }
    } catch (error: any) {
      if (error?.message !== 'User cancelled photos app') {
        console.error('[VisualDetail] Gallery error:', error);
        await this.showToast('Error selecting photo', 'danger');
      }
    }
  }

  private async processAndSavePhoto(dataUrl: string) {
    this.uploadingPhotos = true;
    this.changeDetectorRef.detectChanges();

    try {
      if (!this.visualId) {
        console.error('[VisualDetail] Cannot save photo - no visualId found');
        await this.showToast('Error: Visual not found', 'danger');
        return;
      }

      // Convert dataUrl to blob then to File
      const response = await fetch(dataUrl);
      const blob = await response.blob();

      // Compress the image
      const compressedBlob = await this.imageCompression.compressImage(blob as File, {
        maxSizeMB: 0.8,
        maxWidthOrHeight: 1280,
        useWebWorker: true
      });

      // Create File object for LocalImageService
      const file = new File([compressedBlob], `photo_${Date.now()}.webp`, {
        type: compressedBlob.type || 'image/webp'
      });

      // DEXIE-FIRST: Use LocalImageService.captureImage() which:
      // 1. Stores blob + metadata atomically
      // 2. Adds to upload outbox for background sync
      // 3. Returns stable imageId for UI
      const localImage = await this.localImageService.captureImage(
        file,
        'visual',
        this.visualId,
        this.serviceId,
        '', // caption
        ''  // drawings
      );

      console.log('[VisualDetail] ✅ Photo captured via LocalImageService:', localImage.imageId);

      // Get display URL from LocalImageService
      const displayUrl = await this.localImageService.getDisplayUrl(localImage);

      // Add to photos array immediately for UI display
      this.photos.unshift({
        id: localImage.imageId,
        displayUrl,
        caption: '',
        uploading: false,  // Silent sync - no spinner
        isLocal: true
      });

      await this.showToast('Photo added', 'success');
    } catch (error) {
      console.error('[VisualDetail] Error processing photo:', error);
      await this.showToast('Error adding photo', 'danger');
    } finally {
      this.uploadingPhotos = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  async deletePhoto(photo: PhotoItem) {
    const alert = await this.alertController.create({
      header: 'Delete Photo',
      message: 'Are you sure you want to delete this photo?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            await this.confirmDeletePhoto(photo);
          }
        }
      ]
    });
    await alert.present();
  }

  private async confirmDeletePhoto(photo: PhotoItem) {
    try {
      // Remove from local array immediately for UI responsiveness
      const index = this.photos.findIndex(p => p.id === photo.id);
      if (index >= 0) {
        this.photos.splice(index, 1);
      }

      // Get localImage data before deletion
      const localImage = await db.localImages.get(photo.id);

      // Delete from IndexedDB (Dexie)
      if (localImage) {
        // Delete blob if exists
        if (localImage.localBlobId) {
          await db.localBlobs.delete(localImage.localBlobId);
        }
        // Delete image record
        await db.localImages.delete(photo.id);
      }

      // DEXIE-FIRST: Queue deletion for background sync if already synced to Caspio
      if (localImage?.attachId) {
        await this.foundationData.deleteVisualPhoto(localImage.attachId);
        console.log('[VisualDetail] ✅ Queued photo deletion to Caspio:', localImage.attachId);
      }

      await this.showToast('Photo deleted', 'success');
      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('[VisualDetail] Error deleting photo:', error);
      await this.showToast('Error deleting photo', 'danger');
    }
  }

  async openCaptionPopup(photo: PhotoItem) {
    const alert = await this.alertController.create({
      header: 'Edit Caption',
      inputs: [
        {
          name: 'caption',
          type: 'text',
          placeholder: 'Enter caption',
          value: photo.caption || ''
        }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: async (data) => {
            await this.saveCaption(photo, data.caption);
          }
        }
      ]
    });
    await alert.present();
  }

  private async saveCaption(photo: PhotoItem, caption: string) {
    try {
      photo.caption = caption;

      // Update in localImages (Dexie)
      await db.localImages.update(photo.id, { caption, updatedAt: Date.now() });

      // Get the localImage to check if it has an attachId (synced to Caspio)
      const localImage = await db.localImages.get(photo.id);
      if (localImage?.attachId) {
        // Queue caption update to Caspio for background sync
        await this.foundationData.queueCaptionAndAnnotationUpdate(
          localImage.attachId,
          caption,
          localImage.drawings || '',
          'visual',
          { serviceId: this.serviceId, visualId: this.visualId }
        );
        console.log('[VisualDetail] ✅ Queued caption update to Caspio:', localImage.attachId);
      }

      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('[VisualDetail] Error saving caption:', error);
      await this.showToast('Error saving caption', 'danger');
    }
  }

  async viewPhoto(photo: PhotoItem) {
    const modal = await this.modalController.create({
      component: FabricPhotoAnnotatorComponent,
      componentProps: {
        imageUrl: photo.displayUrl,
        photoId: photo.id,
        caption: photo.caption,
        entityId: this.visualId,
        entityType: 'visual'
      },
      cssClass: 'fullscreen-modal'
    });

    await modal.present();

    const { data } = await modal.onWillDismiss();
    if (data?.saved) {
      // Refresh photos to get updated annotations
      await this.loadPhotos();
    }
  }

  // ===== NAVIGATION =====

  goBack() {
    // Navigate to parent route (category-detail page)
    this.router.navigate(['..'], { relativeTo: this.route });
  }

  // ===== UTILITIES =====

  private async showToast(message: string, color: 'success' | 'danger' | 'warning' = 'success') {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  trackByPhotoId(index: number, photo: PhotoItem): string {
    return photo.id || index.toString();
  }
}
