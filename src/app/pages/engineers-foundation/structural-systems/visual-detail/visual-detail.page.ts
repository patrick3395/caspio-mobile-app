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
    private visualFieldRepo: VisualFieldRepoService
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

  async saveTitle() {
    if (!this.item || this.editableTitle === this.item.name) return;

    this.saving = true;
    try {
      // Update in Dexie using setField with a patch
      await this.visualFieldRepo.setField(
        this.serviceId,
        this.categoryName,
        this.templateId,
        { templateName: this.editableTitle }
      );

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
      // Update in Dexie using setField with a patch
      await this.visualFieldRepo.setField(
        this.serviceId,
        this.categoryName,
        this.templateId,
        { templateText: this.editableText }
      );

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

      // Compress the image
      const compressedBlob = await this.imageCompression.compressBase64Image(dataUrl);

      // Generate unique IDs
      const imageId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const blobId = `blob_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const entityId = this.visualId;

      // Convert blob to ArrayBuffer for storage
      const arrayBuffer = await compressedBlob.arrayBuffer();

      // Save blob to localBlobs table
      await db.localBlobs.add({
        blobId,
        data: arrayBuffer,
        sizeBytes: arrayBuffer.byteLength,
        contentType: compressedBlob.type || 'image/webp',
        createdAt: Date.now()
      });

      // Save image metadata to localImages table
      await db.localImages.add({
        imageId,
        entityType: 'visual',
        entityId,
        serviceId: this.serviceId,
        localBlobId: blobId,
        remoteS3Key: null,
        status: 'queued',
        attachId: null,
        isSynced: false,
        remoteUrl: null,
        fileName: `photo_${Date.now()}.webp`,
        fileSize: arrayBuffer.byteLength,
        contentType: compressedBlob.type || 'image/webp',
        caption: '',
        drawings: '',
        photoType: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastError: null,
        localVersion: 1,
        remoteVerifiedAt: null,
        remoteLoadedInUI: false
      });

      // Create display URL
      const displayBlob = new Blob([arrayBuffer], { type: compressedBlob.type });
      const displayUrl = URL.createObjectURL(displayBlob);

      // Add to photos array immediately
      this.photos.unshift({
        id: imageId,
        displayUrl,
        caption: '',
        uploading: true,
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
      // Remove from local array
      const index = this.photos.findIndex(p => p.id === photo.id);
      if (index >= 0) {
        this.photos.splice(index, 1);
      }

      // Delete from IndexedDB
      const localImage = await db.localImages.get(photo.id);
      if (localImage) {
        // Delete blob if exists
        if (localImage.localBlobId) {
          await db.localBlobs.delete(localImage.localBlobId);
        }
        // Delete image record
        await db.localImages.delete(photo.id);
      }

      // Delete from remote if synced
      if (localImage?.attachId) {
        this.caspioService.deleteAttachment(localImage.attachId).subscribe({
          next: () => console.log('[VisualDetail] Attachment deleted from server'),
          error: (err) => console.error('[VisualDetail] Error deleting from server:', err)
        });
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

      // Update in localImages
      await db.localImages.update(photo.id, { caption, updatedAt: Date.now() });

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
    this.navController.back();
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
