import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { AlertController, ToastController, ModalController } from '@ionic/angular';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { EngineersFoundationStateService } from '../services/engineers-foundation-state.service';
import { EngineersFoundationDataService } from '../engineers-foundation-data.service';
import { CaspioService } from '../../../services/caspio.service';
import { FabricPhotoAnnotatorComponent } from '../../../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { ImageCompressionService } from '../../../services/image-compression.service';

@Component({
  selector: 'app-room-elevation',
  templateUrl: './room-elevation.page.html',
  styleUrls: ['./room-elevation.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class RoomElevationPage implements OnInit, OnDestroy {
  projectId: string = '';
  serviceId: string = '';
  roomName: string = '';
  roomId: string = '';
  roomData: any = null;

  // FDF dropdown options
  fdfOptions: string[] = [];

  // Notes debounce timer
  notesDebounceTimer: any = null;

  // Track saving state
  isSavingNotes: boolean = false;
  isSavingFdf: boolean = false;
  isSavingLocation: boolean = false;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private stateService: EngineersFoundationStateService,
    private foundationData: EngineersFoundationDataService,
    private caspioService: CaspioService,
    private alertController: AlertController,
    private toastController: ToastController,
    private modalController: ModalController,
    private changeDetectorRef: ChangeDetectorRef,
    private imageCompression: ImageCompressionService
  ) {}

  async ngOnInit() {
    // Get IDs from parent route
    this.route.parent?.parent?.params.subscribe(params => {
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];
    });

    // Get room name from route params or route path
    this.route.params.subscribe(params => {
      // If roomName param exists, use it; otherwise check if we're on base-station route
      if (params['roomName']) {
        this.roomName = params['roomName'];
      }
    });

    // Check if we're on the base-station route
    if (this.route.snapshot.url.some(segment => segment.path === 'base-station')) {
      this.roomName = 'Base Station';
    }

    await this.loadRoomData();
    await this.loadFDFOptions();
  }

  ngOnDestroy() {
    // Clean up debounce timer
    if (this.notesDebounceTimer) {
      clearTimeout(this.notesDebounceTimer);
    }
  }

  goBack() {
    this.router.navigate(['..', '..'], { relativeTo: this.route });
  }

  isBaseStation(): boolean {
    return this.roomName.toLowerCase() === 'base station';
  }

  isGarage(): boolean {
    return this.roomName.toLowerCase().includes('garage');
  }

  private async loadRoomData() {
    try {
      // Load room record from Services_EFE
      const rooms = await this.foundationData.getEFEByService(this.serviceId, true);
      const room = rooms.find((r: any) => r.RoomName === this.roomName);

      if (!room) {
        await this.showToast('Room not found', 'danger');
        this.goBack();
        return;
      }

      this.roomId = room.EFEID;

      // Initialize room data structure
      this.roomData = {
        roomName: this.roomName,
        templateId: room.TemplateID,
        notes: room.Notes || '',
        fdf: room.FDF || '',
        location: room.Location || '',
        elevationPoints: [],
        fdfPhotos: {
          top: null,
          topUrl: null,
          topDisplayUrl: null,
          topUploading: false,
          topHasAnnotations: false,
          topCaption: '',
          topDrawings: null,
          topPath: null,
          bottom: null,
          bottomUrl: null,
          bottomDisplayUrl: null,
          bottomUploading: false,
          bottomHasAnnotations: false,
          bottomCaption: '',
          bottomDrawings: null,
          bottomPath: null,
          threshold: null,
          thresholdUrl: null,
          thresholdDisplayUrl: null,
          thresholdUploading: false,
          thresholdHasAnnotations: false,
          thresholdCaption: '',
          thresholdDrawings: null,
          thresholdPath: null
        }
      };

      // Load FDF photos if they exist
      await this.loadFDFPhotos(room);

      // Load elevation points
      await this.loadElevationPoints();

      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('Error loading room data:', error);
      await this.showToast('Failed to load room data', 'danger');
    }
  }

  private async loadFDFPhotos(room: any) {
    const fdfPhotos = this.roomData.fdfPhotos;

    // Load Top photo
    if (room.FDFPhotoTop) {
      fdfPhotos.topPath = room.FDFPhotoTop;
      fdfPhotos.topCaption = room.FDFPhotoTopAnnotation || '';
      fdfPhotos.topDrawings = room.FDFPhotoTopDrawings || null;
      try {
        const imageData = await this.foundationData.getImage(room.FDFPhotoTop);
        if (imageData) {
          fdfPhotos.topUrl = imageData;
          fdfPhotos.topDisplayUrl = imageData;
          fdfPhotos.topHasAnnotations = !!(room.FDFPhotoTopDrawings && room.FDFPhotoTopDrawings !== 'null');
        }
      } catch (error) {
        console.error('Error loading top photo:', error);
      }
    }

    // Load Bottom photo
    if (room.FDFPhotoBottom) {
      fdfPhotos.bottomPath = room.FDFPhotoBottom;
      fdfPhotos.bottomCaption = room.FDFPhotoBottomAnnotation || '';
      fdfPhotos.bottomDrawings = room.FDFPhotoBottomDrawings || null;
      try {
        const imageData = await this.foundationData.getImage(room.FDFPhotoBottom);
        if (imageData) {
          fdfPhotos.bottomUrl = imageData;
          fdfPhotos.bottomDisplayUrl = imageData;
          fdfPhotos.bottomHasAnnotations = !!(room.FDFPhotoBottomDrawings && room.FDFPhotoBottomDrawings !== 'null');
        }
      } catch (error) {
        console.error('Error loading bottom photo:', error);
      }
    }

    // Load Threshold (Location) photo
    if (room.FDFPhotoThreshold) {
      fdfPhotos.thresholdPath = room.FDFPhotoThreshold;
      fdfPhotos.thresholdCaption = room.FDFPhotoThresholdAnnotation || '';
      fdfPhotos.thresholdDrawings = room.FDFPhotoThresholdDrawings || null;
      try {
        const imageData = await this.foundationData.getImage(room.FDFPhotoThreshold);
        if (imageData) {
          fdfPhotos.thresholdUrl = imageData;
          fdfPhotos.thresholdDisplayUrl = imageData;
          fdfPhotos.thresholdHasAnnotations = !!(room.FDFPhotoThresholdDrawings && room.FDFPhotoThresholdDrawings !== 'null');
        }
      } catch (error) {
        console.error('Error loading threshold photo:', error);
      }
    }
  }

  private async loadElevationPoints() {
    try {
      // Load points from Services_EFE_Points
      const points = await this.caspioService.getServicesEFEPoints(this.roomId).toPromise();

      if (points && points.length > 0) {
        for (const point of points) {
          const pointData = {
            pointId: point.PointID,
            name: point.PointName,
            value: point.Elevation || '',
            photos: []
          };

          // Load photos for this point from Services_EFE_Points_Attach
          try {
            const photos = await this.caspioService.getServicesEFEPointsAttach(point.PointID).toPromise();
            if (photos && photos.length > 0) {
              for (const photo of photos) {
                const photoData: any = {
                  attachId: photo.AttachID,
                  photoType: photo.PhotoType,
                  caption: photo.Annotation || '',
                  drawings: photo.Drawings || null,
                  hasAnnotations: !!(photo.Drawings && photo.Drawings !== 'null'),
                  uploading: false,
                  url: null
                };

                // Load photo from file path
                if (photo.Photo) {
                  try {
                    const imageData = await this.foundationData.getImage(photo.Photo);
                    if (imageData) {
                      photoData.url = imageData;
                    }
                  } catch (error) {
                    console.error('Error loading point photo:', error);
                  }
                }

                pointData.photos.push(photoData);
              }
            }
          } catch (error) {
            console.error('Error loading point photos:', error);
          }

          this.roomData.elevationPoints.push(pointData);
        }
      }

      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('Error loading elevation points:', error);
    }
  }

  private async loadFDFOptions() {
    try {
      const options = await this.caspioService.getServicesEFEDrop().toPromise();
      if (options && options.length > 0) {
        this.fdfOptions = options.map((opt: any) => opt.FDF).filter((fdf: string) => fdf && fdf.trim() !== '');
      }
    } catch (error) {
      console.error('Error loading FDF options:', error);
    }
  }

  // FDF Methods
  async onFDFChange() {
    if (!this.roomId) return;

    this.isSavingFdf = true;
    try {
      await this.caspioService.updateServicesEFE(this.roomId, { FDF: this.roomData.fdf }).toPromise();
    } catch (error) {
      console.error('Error saving FDF:', error);
      await this.showToast('Failed to save FDF', 'danger');
    } finally {
      this.isSavingFdf = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  // Location Methods (Base Station)
  async onLocationChange() {
    // Debounce location changes
    if (this.notesDebounceTimer) {
      clearTimeout(this.notesDebounceTimer);
    }

    this.notesDebounceTimer = setTimeout(async () => {
      await this.saveLocation();
    }, 1000);
  }

  async saveLocation() {
    if (!this.roomId) return;

    this.isSavingLocation = true;
    try {
      await this.caspioService.updateServicesEFE(this.roomId, { Location: this.roomData.location }).toPromise();
    } catch (error) {
      console.error('Error saving location:', error);
      await this.showToast('Failed to save location', 'danger');
    } finally {
      this.isSavingLocation = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  addLocationText(text: string) {
    if (this.roomData.location) {
      this.roomData.location += ', ' + text;
    } else {
      this.roomData.location = text;
    }
    this.saveLocation();
  }

  deleteLastLocationWord() {
    if (!this.roomData.location) return;

    const parts = this.roomData.location.split(',').map((p: string) => p.trim()).filter((p: string) => p);
    if (parts.length > 0) {
      parts.pop();
      this.roomData.location = parts.join(', ');
      this.saveLocation();
    }
  }

  // Notes Methods
  async onNotesChange() {
    // Debounce notes changes
    if (this.notesDebounceTimer) {
      clearTimeout(this.notesDebounceTimer);
    }

    this.notesDebounceTimer = setTimeout(async () => {
      await this.saveNotes();
    }, 1000);
  }

  async saveNotes() {
    if (!this.roomId) return;

    this.isSavingNotes = true;
    try {
      await this.caspioService.updateServicesEFE(this.roomId, { Notes: this.roomData.notes }).toPromise();
    } catch (error) {
      console.error('Error saving notes:', error);
      await this.showToast('Failed to save notes', 'danger');
    } finally {
      this.isSavingNotes = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  // FDF Photo Methods
  async takeFDFPhotoCamera(photoType: 'Top' | 'Bottom' | 'Threshold') {
    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera
      });

      if (image.webPath) {
        await this.processFDFPhoto(image.webPath, photoType);
      }
    } catch (error) {
      if (error !== 'User cancelled photos app') {
        console.error('Error taking camera photo:', error);
        await this.showToast('Failed to capture photo', 'danger');
      }
    }
  }

  async takeFDFPhotoGallery(photoType: 'Top' | 'Bottom' | 'Threshold') {
    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Photos
      });

      if (image.webPath) {
        await this.processFDFPhoto(image.webPath, photoType);
      }
    } catch (error) {
      if (error !== 'User cancelled photos app') {
        console.error('Error selecting gallery photo:', error);
        await this.showToast('Failed to select photo', 'danger');
      }
    }
  }

  private async processFDFPhoto(webPath: string, photoType: 'Top' | 'Bottom' | 'Threshold') {
    const photoKey = photoType.toLowerCase();
    const fdfPhotos = this.roomData.fdfPhotos;

    try {
      // Convert to File
      const response = await fetch(webPath);
      const blob = await response.blob();
      const file = new File([blob], `fdf-${photoKey}-${Date.now()}.jpg`, { type: 'image/jpeg' });

      // Show loading state
      fdfPhotos[`${photoKey}Uploading`] = true;
      fdfPhotos[`${photoKey}Url`] = webPath;
      this.changeDetectorRef.detectChanges();

      // Compress image
      const compressedFile = await this.imageCompression.compressImage(file, {
        maxSizeMB: 0.4,
        maxWidthOrHeight: 1024,
        useWebWorker: true
      }) as File;

      // Upload to database
      const columnName = `FDFPhoto${photoType}`;
      await this.caspioService.updateServicesEFEPhoto(this.roomId, columnName, compressedFile).toPromise();

      // Reload photo
      const updatedRoom = await this.caspioService.getServicesEFEByEFEID(this.roomId).toPromise();
      if (updatedRoom && updatedRoom[columnName]) {
        fdfPhotos[`${photoKey}Path`] = updatedRoom[columnName];
        const imageData = await this.foundationData.getImage(updatedRoom[columnName]);
        if (imageData) {
          fdfPhotos[`${photoKey}Url`] = imageData;
          fdfPhotos[`${photoKey}DisplayUrl`] = imageData;
        }
      }

      await this.showToast('Photo uploaded successfully', 'success');
    } catch (error) {
      console.error('Error processing FDF photo:', error);
      await this.showToast('Failed to upload photo', 'danger');
    } finally {
      fdfPhotos[`${photoKey}Uploading`] = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  async annotateFDFPhoto(photoType: 'Top' | 'Bottom' | 'Threshold') {
    const photoKey = photoType.toLowerCase();
    const fdfPhotos = this.roomData.fdfPhotos;
    const photoUrl = fdfPhotos[`${photoKey}Url`];

    if (!photoUrl) {
      await this.showToast('No photo to annotate', 'warning');
      return;
    }

    try {
      const modal = await this.modalController.create({
        component: FabricPhotoAnnotatorComponent,
        componentProps: {
          imageUrl: photoUrl,
          existingAnnotations: fdfPhotos[`${photoKey}Drawings`],
          caption: fdfPhotos[`${photoKey}Caption`] || ''
        }
      });

      await modal.present();
      const { data } = await modal.onDidDismiss();

      if (data && data.saved) {
        // Save annotation and caption
        const columnName = `FDFPhoto${photoType}`;
        const updateData: any = {};
        updateData[`${columnName}Drawings`] = data.annotationsData || null;
        updateData[`${columnName}Annotation`] = data.caption || '';

        await this.caspioService.updateServicesEFEByEFEID(this.roomId, updateData).toPromise();

        // Update local state
        fdfPhotos[`${photoKey}Drawings`] = data.annotationsData;
        fdfPhotos[`${photoKey}Caption`] = data.caption || '';
        fdfPhotos[`${photoKey}HasAnnotations`] = !!(data.annotationsData && data.annotationsData !== 'null');

        // Update display URL if annotated blob is provided
        if (data.annotatedBlob) {
          const reader = new FileReader();
          reader.onload = (e: any) => {
            fdfPhotos[`${photoKey}DisplayUrl`] = e.target.result;
            this.changeDetectorRef.detectChanges();
          };
          reader.readAsDataURL(data.annotatedBlob);
        }

        this.changeDetectorRef.detectChanges();
        await this.showToast('Annotation saved', 'success');
      }
    } catch (error) {
      console.error('Error annotating photo:', error);
      await this.showToast('Failed to save annotation', 'danger');
    }
  }

  async deleteFDFPhoto(photoType: 'Top' | 'Bottom' | 'Threshold', event: Event) {
    event.stopPropagation();

    const alert = await this.alertController.create({
      header: 'Delete Photo',
      message: `Are you sure you want to delete the ${photoType} photo?`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          handler: async () => {
            const photoKey = photoType.toLowerCase();
            const columnName = `FDFPhoto${photoType}`;
            const updateData: any = {};
            updateData[columnName] = null;
            updateData[`${columnName}Annotation`] = null;
            updateData[`${columnName}Drawings`] = null;

            try {
              await this.caspioService.updateServicesEFEByEFEID(this.roomId, updateData).toPromise();

              // Clear local state
              const fdfPhotos = this.roomData.fdfPhotos;
              fdfPhotos[`${photoKey}`] = null;
              fdfPhotos[`${photoKey}Url`] = null;
              fdfPhotos[`${photoKey}DisplayUrl`] = null;
              fdfPhotos[`${photoKey}Path`] = null;
              fdfPhotos[`${photoKey}Caption`] = '';
              fdfPhotos[`${photoKey}Drawings`] = null;
              fdfPhotos[`${photoKey}HasAnnotations`] = false;

              this.changeDetectorRef.detectChanges();
              await this.showToast('Photo deleted', 'success');
            } catch (error) {
              console.error('Error deleting photo:', error);
              await this.showToast('Failed to delete photo', 'danger');
            }
          }
        }
      ],
      cssClass: 'custom-document-alert'
    });

    await alert.present();
  }

  async openFDFCaptionPopup(photoType: 'Top' | 'Bottom' | 'Threshold', event: Event) {
    event.stopPropagation();

    const photoKey = photoType.toLowerCase();
    const fdfPhotos = this.roomData.fdfPhotos;

    const alert = await this.alertController.create({
      header: `${photoType} Photo Caption`,
      inputs: [
        {
          name: 'caption',
          type: 'textarea',
          value: fdfPhotos[`${photoKey}Caption`] || '',
          placeholder: 'Enter caption'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Save',
          handler: async (data) => {
            const columnName = `FDFPhoto${photoType}Annotation`;
            const updateData: any = {};
            updateData[columnName] = data.caption || '';

            try {
              await this.caspioService.updateServicesEFEByEFEID(this.roomId, updateData).toPromise();
              fdfPhotos[`${photoKey}Caption`] = data.caption || '';
              this.changeDetectorRef.detectChanges();
            } catch (error) {
              console.error('Error saving caption:', error);
              await this.showToast('Failed to save caption', 'danger');
            }
          }
        }
      ],
      cssClass: 'custom-document-alert'
    });

    await alert.present();
  }

  getFdfPhotoCaption(photoType: 'Top' | 'Bottom' | 'Threshold'): string {
    const photoKey = photoType.toLowerCase();
    return this.roomData?.fdfPhotos[`${photoKey}Caption`] || 'Caption';
  }

  // Point Management Methods
  async addElevationPoint() {
    const alert = await this.alertController.create({
      header: 'Add Measurement',
      inputs: [
        {
          name: 'pointName',
          type: 'text',
          placeholder: 'Enter measurement name'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Add',
          handler: async (data) => {
            if (!data.pointName || !data.pointName.trim()) {
              await this.showToast('Please enter a measurement name', 'warning');
              return false;
            }

            try {
              // Create point in database
              const pointData = {
                EFEID: this.roomId,
                PointName: data.pointName.trim(),
                Elevation: 0
              };

              const response = await this.caspioService.createServicesEFEPoint(pointData).toPromise();
              const pointId = response?.PointID || response?.PK_ID;

              if (pointId) {
                // Add to local array
                this.roomData.elevationPoints.push({
                  pointId: pointId,
                  name: data.pointName.trim(),
                  value: '',
                  photos: []
                });

                this.changeDetectorRef.detectChanges();
                await this.showToast('Measurement added', 'success');
              }

              return true;
            } catch (error) {
              console.error('Error adding point:', error);
              await this.showToast('Failed to add measurement', 'danger');
              return false;
            }
          }
        }
      ],
      cssClass: 'custom-document-alert'
    });

    await alert.present();
  }

  async editElevationPointName(point: any) {
    const alert = await this.alertController.create({
      header: 'Edit Point Name',
      inputs: [
        {
          name: 'pointName',
          type: 'text',
          value: point.name,
          placeholder: 'Enter point name'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Save',
          handler: async (data) => {
            const newName = data.pointName?.trim();

            if (!newName) {
              await this.showToast('Point name cannot be empty', 'warning');
              return false;
            }

            if (newName === point.name) {
              return true;
            }

            try {
              await this.caspioService.updateServicesEFEPoint(point.pointId, { PointName: newName }).toPromise();
              point.name = newName;
              this.changeDetectorRef.detectChanges();
              return true;
            } catch (error) {
              console.error('Error updating point name:', error);
              await this.showToast('Failed to update point name', 'danger');
              return false;
            }
          }
        }
      ],
      cssClass: 'custom-document-alert'
    });

    await alert.present();
  }

  async deleteElevationPoint(point: any) {
    const alert = await this.alertController.create({
      header: 'Delete Point',
      message: `Are you sure you want to delete "${point.name}"? This will also delete all associated photos.`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          handler: async () => {
            try {
              // Delete all photos first
              if (point.photos && point.photos.length > 0) {
                for (const photo of point.photos) {
                  if (photo.attachId) {
                    try {
                      await this.caspioService.deleteServicesEFEPointsAttach(photo.attachId).toPromise();
                    } catch (photoError) {
                      console.error('Failed to delete photo:', photoError);
                    }
                  }
                }
              }

              // Delete point
              await this.caspioService.deleteServicesEFEPoint(point.pointId).toPromise();

              // Remove from local array
              const index = this.roomData.elevationPoints.findIndex((p: any) => p.pointId === point.pointId);
              if (index >= 0) {
                this.roomData.elevationPoints.splice(index, 1);
              }

              this.changeDetectorRef.detectChanges();
              await this.showToast('Point deleted', 'success');
            } catch (error) {
              console.error('Error deleting point:', error);
              await this.showToast('Failed to delete point', 'danger');
            }
          }
        }
      ],
      cssClass: 'custom-document-alert'
    });

    await alert.present();
  }

  // Point Photo Methods
  async capturePointPhotoCamera(point: any, photoType: 'Measurement' | 'Location', event: Event) {
    event.stopPropagation();

    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera
      });

      if (image.webPath) {
        await this.processPointPhoto(image.webPath, point, photoType);
      }
    } catch (error) {
      if (error !== 'User cancelled photos app') {
        console.error('Error taking camera photo:', error);
        await this.showToast('Failed to capture photo', 'danger');
      }
    }
  }

  async capturePointPhotoGallery(point: any, photoType: 'Measurement' | 'Location', event: Event) {
    event.stopPropagation();

    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Photos
      });

      if (image.webPath) {
        await this.processPointPhoto(image.webPath, point, photoType);
      }
    } catch (error) {
      if (error !== 'User cancelled photos app') {
        console.error('Error selecting gallery photo:', error);
        await this.showToast('Failed to select photo', 'danger');
      }
    }
  }

  private async processPointPhoto(webPath: string, point: any, photoType: 'Measurement' | 'Location') {
    try {
      // Convert to File
      const response = await fetch(webPath);
      const blob = await response.blob();
      const file = new File([blob], `point-${photoType.toLowerCase()}-${Date.now()}.jpg`, { type: 'image/jpeg' });

      // Find existing photo or create new one
      let existingPhoto = point.photos.find((p: any) => p.photoType === photoType);

      if (existingPhoto) {
        // Mark as uploading
        existingPhoto.uploading = true;
        existingPhoto.url = webPath;
      } else {
        // Add new photo placeholder
        existingPhoto = {
          photoType: photoType,
          uploading: true,
          url: webPath,
          caption: '',
          drawings: null,
          hasAnnotations: false,
          attachId: null
        };
        point.photos.push(existingPhoto);
      }

      this.changeDetectorRef.detectChanges();

      // Compress image
      const compressedFile = await this.imageCompression.compressImage(file, {
        maxSizeMB: 0.4,
        maxWidthOrHeight: 1024,
        useWebWorker: true
      }) as File;

      if (existingPhoto.attachId) {
        // Update existing photo
        await this.caspioService.updateServicesEFEPointsAttachPhoto(existingPhoto.attachId, compressedFile).toPromise();
      } else {
        // Create new photo record
        const photoData = {
          PointID: point.pointId,
          PhotoType: photoType
        };

        const photoResponse = await this.caspioService.createServicesEFEPointsAttach(photoData).toPromise();
        const attachId = photoResponse?.AttachID || photoResponse?.PK_ID;

        if (attachId) {
          existingPhoto.attachId = attachId;

          // Upload photo to the new record
          await this.caspioService.updateServicesEFEPointsAttachPhoto(attachId, compressedFile).toPromise();
        }
      }

      // Reload photo
      const imageData = await this.foundationData.getImage(webPath);
      if (imageData) {
        existingPhoto.url = imageData;
      }

      existingPhoto.uploading = false;
      this.changeDetectorRef.detectChanges();

      await this.showToast('Photo uploaded successfully', 'success');
    } catch (error) {
      console.error('Error processing point photo:', error);
      await this.showToast('Failed to upload photo', 'danger');

      // Remove uploading state
      const existingPhoto = point.photos.find((p: any) => p.photoType === photoType);
      if (existingPhoto) {
        existingPhoto.uploading = false;
      }
      this.changeDetectorRef.detectChanges();
    }
  }

  async annotatePointPhoto(point: any, photo: any) {
    if (!photo.url) {
      await this.showToast('No photo to annotate', 'warning');
      return;
    }

    try {
      const modal = await this.modalController.create({
        component: FabricPhotoAnnotatorComponent,
        componentProps: {
          imageUrl: photo.url,
          existingAnnotations: photo.drawings,
          caption: photo.caption || ''
        }
      });

      await modal.present();
      const { data } = await modal.onDidDismiss();

      if (data && data.saved) {
        // Save annotation and caption
        const updateData: any = {
          Drawings: data.annotationsData || null,
          Annotation: data.caption || ''
        };

        await this.caspioService.updateServicesEFEPointsAttach(photo.attachId, updateData).toPromise();

        // Update local state
        photo.drawings = data.annotationsData;
        photo.caption = data.caption || '';
        photo.hasAnnotations = !!(data.annotationsData && data.annotationsData !== 'null');

        this.changeDetectorRef.detectChanges();
        await this.showToast('Annotation saved', 'success');
      }
    } catch (error) {
      console.error('Error annotating photo:', error);
      await this.showToast('Failed to save annotation', 'danger');
    }
  }

  async deletePointPhoto(point: any, photo: any, event: Event) {
    event.stopPropagation();

    const alert = await this.alertController.create({
      header: 'Delete Photo',
      message: 'Are you sure you want to delete this photo?',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          handler: async () => {
            try {
              if (photo.attachId) {
                await this.caspioService.deleteServicesEFEPointsAttach(photo.attachId).toPromise();
              }

              // Remove from local array
              const index = point.photos.findIndex((p: any) => p.attachId === photo.attachId);
              if (index >= 0) {
                point.photos.splice(index, 1);
              }

              this.changeDetectorRef.detectChanges();
              await this.showToast('Photo deleted', 'success');
            } catch (error) {
              console.error('Error deleting photo:', error);
              await this.showToast('Failed to delete photo', 'danger');
            }
          }
        }
      ],
      cssClass: 'custom-document-alert'
    });

    await alert.present();
  }

  async openPointCaptionPopup(point: any, photo: any, event: Event) {
    event.stopPropagation();

    const alert = await this.alertController.create({
      header: `${photo.photoType} Photo Caption`,
      inputs: [
        {
          name: 'caption',
          type: 'textarea',
          value: photo.caption || '',
          placeholder: 'Enter caption'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Save',
          handler: async (data) => {
            try {
              await this.caspioService.updateServicesEFEPointsAttach(photo.attachId, { Annotation: data.caption || '' }).toPromise();
              photo.caption = data.caption || '';
              this.changeDetectorRef.detectChanges();
            } catch (error) {
              console.error('Error saving caption:', error);
              await this.showToast('Failed to save caption', 'danger');
            }
          }
        }
      ],
      cssClass: 'custom-document-alert'
    });

    await alert.present();
  }

  getPointPhoto(point: any, photoType: string): any {
    return point.photos?.find((p: any) => p.photoType === photoType);
  }

  getPointPhotoCaption(point: any, photoType: string): string {
    const photo = this.getPointPhoto(point, photoType);
    return photo?.caption || 'Caption';
  }

  private async showToast(message: string, color: string = 'primary') {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      position: 'bottom',
      color
    });
    await toast.present();
  }

  trackByPointId(index: number, point: any): any {
    return point.pointId;
  }
}
