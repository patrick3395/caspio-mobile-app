import { Component, OnInit, OnDestroy, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, LoadingController, AlertController, ModalController, NavController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { CaspioService } from '../../../../services/caspio.service';
import { OfflineService } from '../../../../services/offline.service';
import { CameraService } from '../../../../services/camera.service';
import { ImageCompressionService } from '../../../../services/image-compression.service';
import { EngineersFoundationDataService } from '../../engineers-foundation-data.service';
import { FabricPhotoAnnotatorComponent } from '../../../../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { BackgroundPhotoUploadService } from '../../../../services/background-photo-upload.service';
import { IndexedDbService, LocalImage } from '../../../../services/indexed-db.service';
import { LocalImageService } from '../../../../services/local-image.service';
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
  isSaving?: boolean;
  photos?: any[];
  otherValue?: string;
  key?: string;
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

  // Visual item data
  item: VisualItem | null = null;
  loading: boolean = true;
  saving: boolean = false;

  // Editable fields
  editableTitle: string = '';
  editableText: string = '';

  // Photos
  photos: any[] = [];
  loadingPhotos: boolean = false;
  uploadingPhotos: boolean = false;

  // Hidden file input for camera/gallery
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  // Subscriptions
  private routeSubscription?: Subscription;
  private localImagesSubscription?: Subscription;
  private uploadSubscription?: Subscription;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private navController: NavController,
    private caspioService: CaspioService,
    private toastController: ToastController,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private modalController: ModalController,
    private offlineService: OfflineService,
    private changeDetectorRef: ChangeDetectorRef,
    private cameraService: CameraService,
    private imageCompression: ImageCompressionService,
    private foundationData: EngineersFoundationDataService,
    private backgroundUploadService: BackgroundPhotoUploadService,
    private indexedDb: IndexedDbService,
    private localImageService: LocalImageService,
    private visualFieldRepo: VisualFieldRepoService
  ) {}

  ngOnInit() {
    this.loadRouteParams();
    this.setupSubscriptions();
  }

  ngOnDestroy() {
    this.routeSubscription?.unsubscribe();
    this.localImagesSubscription?.unsubscribe();
    this.uploadSubscription?.unsubscribe();
  }

  private loadRouteParams() {
    // Get project/service IDs from parent route
    const parentParams = this.route.parent?.parent?.snapshot.params;
    this.projectId = parentParams?.['projectId'] || '';
    this.serviceId = parentParams?.['serviceId'] || '';

    // Get category from parent route params
    const parentCategoryParams = this.route.parent?.snapshot.params;
    this.categoryName = parentCategoryParams?.['category'] || '';

    // Get templateId from current route
    this.routeSubscription = this.route.params.subscribe(params => {
      this.templateId = parseInt(params['templateId'], 10);
      this.loadVisualData();
    });
  }

  private setupSubscriptions() {
    // Subscribe to local images for reactive updates
    const entityId = `${this.serviceId}_${this.categoryName}_${this.templateId}`;
    this.localImagesSubscription = new Subscription();

    const observable = liveQuery(() =>
      db.localImages.where('entityId').equals(entityId).toArray()
    );

    const sub = {
      subscribe: (callback: (images: LocalImage[]) => void) => {
        const subscription = observable.subscribe({
          next: (images) => {
            this.updatePhotosFromLocalImages(images);
          }
        });
        return subscription;
      }
    };

    // Subscribe to upload progress
    this.uploadSubscription = this.backgroundUploadService.uploadComplete$.subscribe(
      (result) => {
        if (result.entityId === entityId) {
          this.loadPhotos();
        }
      }
    );
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
      } else {
        // Fallback to loading from API via data service
        await this.loadFromDataService();
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

  private async loadFromDataService() {
    // Get all items and find ours
    const data = await this.foundationData.getStructuralData(this.serviceId, this.categoryName);
    if (data) {
      const allItems = [
        ...(data.comments || []),
        ...(data.limitations || []),
        ...(data.deficiencies || [])
      ];
      this.item = allItems.find((i: any) => i.templateId === this.templateId) || null;
      if (this.item) {
        this.editableTitle = this.item.name;
        this.editableText = this.item.text;
      }
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
    const entityId = `${this.serviceId}_${this.categoryName}_${this.templateId}`;

    try {
      // Load local images from IndexedDB
      const localImages = await db.localImages
        .where('entityId')
        .equals(entityId)
        .toArray();

      // Load cached attachments
      const cachedAttachments = await this.indexedDb.getCachedAttachments(entityId);

      // Merge photos
      this.photos = [];

      // Add local images first
      for (const img of localImages) {
        this.photos.push({
          id: img.imageId,
          localId: img.imageId,
          displayUrl: img.localDataUrl || img.thumbnailUrl,
          thumbnailUrl: img.thumbnailUrl,
          url: img.remoteUrl,
          caption: img.caption || '',
          name: img.fileName,
          uploading: img.uploadStatus === 'pending' || img.uploadStatus === 'uploading',
          hasAnnotations: !!img.annotationData,
          isLocal: true
        });
      }

      // Add remote attachments not already in local
      for (const att of cachedAttachments) {
        const exists = this.photos.some(p => p.id === att.id || p.remoteId === att.id);
        if (!exists) {
          this.photos.push({
            id: att.id,
            remoteId: att.id,
            displayUrl: att.thumbnailUrl || att.url,
            thumbnailUrl: att.thumbnailUrl,
            url: att.url,
            caption: att.caption || '',
            name: att.name,
            uploading: false,
            hasAnnotations: att.hasAnnotations,
            isLocal: false
          });
        }
      }

    } catch (error) {
      console.error('[VisualDetail] Error loading photos:', error);
    } finally {
      this.loadingPhotos = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  private updatePhotosFromLocalImages(images: LocalImage[]) {
    // Update photo list reactively
    for (const img of images) {
      const existingIndex = this.photos.findIndex(p => p.localId === img.imageId);
      if (existingIndex >= 0) {
        // Update existing
        this.photos[existingIndex].displayUrl = img.localDataUrl || img.thumbnailUrl;
        this.photos[existingIndex].uploading = img.uploadStatus === 'pending' || img.uploadStatus === 'uploading';
        this.photos[existingIndex].caption = img.caption || '';
      } else {
        // Add new
        this.photos.unshift({
          id: img.imageId,
          localId: img.imageId,
          displayUrl: img.localDataUrl || img.thumbnailUrl,
          thumbnailUrl: img.thumbnailUrl,
          url: img.remoteUrl,
          caption: img.caption || '',
          name: img.fileName,
          uploading: img.uploadStatus === 'pending' || img.uploadStatus === 'uploading',
          hasAnnotations: !!img.annotationData,
          isLocal: true
        });
      }
    }
    this.changeDetectorRef.detectChanges();
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
        { name: this.editableTitle, templateName: this.editableTitle }
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
        { text: this.editableText, templateText: this.editableText }
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
      // Compress the image
      const compressed = await this.imageCompression.compressImageToDataUrl(dataUrl, {
        maxWidth: 1920,
        maxHeight: 1920,
        quality: 0.7
      });

      // Generate unique ID
      const imageId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const entityId = `${this.serviceId}_${this.categoryName}_${this.templateId}`;

      // Save to local images
      const localImage: LocalImage = {
        imageId,
        entityId,
        entityType: 'structural_visual',
        localDataUrl: compressed,
        thumbnailUrl: compressed,
        fileName: `photo_${Date.now()}.jpg`,
        uploadStatus: 'pending',
        createdAt: new Date().toISOString()
      };

      await db.localImages.add(localImage);

      // Add to photos array immediately
      this.photos.unshift({
        id: imageId,
        localId: imageId,
        displayUrl: compressed,
        thumbnailUrl: compressed,
        caption: '',
        name: localImage.fileName,
        uploading: true,
        hasAnnotations: false,
        isLocal: true
      });

      // Queue for background upload
      await this.backgroundUploadService.queuePhotoUpload({
        imageId,
        entityId,
        entityType: 'structural_visual',
        localDataUrl: compressed,
        projectId: this.projectId,
        serviceId: this.serviceId,
        category: this.categoryName,
        templateId: this.templateId
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

  async deletePhoto(photo: any) {
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

  private async confirmDeletePhoto(photo: any) {
    try {
      // Remove from local array
      const index = this.photos.findIndex(p => p.id === photo.id);
      if (index >= 0) {
        this.photos.splice(index, 1);
      }

      // Delete from IndexedDB if local
      if (photo.isLocal && photo.localId) {
        await db.localImages.where('imageId').equals(photo.localId).delete();
      }

      // Delete from remote if has remote ID (use firstValueFrom to convert Observable to Promise)
      if (photo.remoteId || (!photo.isLocal && photo.id)) {
        const attachmentId = photo.remoteId || photo.id;
        this.caspioService.deleteAttachment(attachmentId).subscribe({
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

  async openCaptionPopup(photo: any) {
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

  private async saveCaption(photo: any, caption: string) {
    try {
      photo.caption = caption;

      // Update in local images if local
      if (photo.isLocal && photo.localId) {
        await db.localImages.where('imageId').equals(photo.localId).modify({ caption });
      }

      // For remote photos, add to pending caption updates
      if (photo.remoteId || (!photo.isLocal && photo.id)) {
        const attachmentId = photo.remoteId || photo.id;
        await this.indexedDb.addPendingCaptionUpdate({
          attachId: attachmentId,
          caption,
          serviceId: this.serviceId,
          entityType: 'structural_visual',
          createdAt: new Date().toISOString(),
          status: 'pending'
        });
      }

      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('[VisualDetail] Error saving caption:', error);
      await this.showToast('Error saving caption', 'danger');
    }
  }

  async viewPhoto(photo: any) {
    const modal = await this.modalController.create({
      component: FabricPhotoAnnotatorComponent,
      componentProps: {
        imageUrl: photo.displayUrl || photo.url,
        photoId: photo.id,
        caption: photo.caption,
        annotations: photo.annotations || null,
        entityId: `${this.serviceId}_${this.categoryName}_${this.templateId}`,
        entityType: 'structural_visual'
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

  // ===== FILE INPUT HANDLER =====

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        await this.processAndSavePhoto(dataUrl);
      };
      reader.readAsDataUrl(file);
    }
    // Reset input
    input.value = '';
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

  trackByPhotoId(index: number, photo: any): string {
    return photo.id || photo.localId || index.toString();
  }
}
