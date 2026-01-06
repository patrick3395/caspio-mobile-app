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
import { BackgroundPhotoUploadService } from '../../../services/background-photo-upload.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { OfflineService } from '../../../services/offline.service';
import { IndexedDbService } from '../../../services/indexed-db.service';
import { BackgroundSyncService } from '../../../services/background-sync.service';
import { firstValueFrom, Subscription } from 'rxjs';
import { compressAnnotationData, decompressAnnotationData } from '../../../utils/annotation-utils';
import { environment } from '../../../../environments/environment';

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
  loading: boolean = false;  // OFFLINE-FIRST: Start with no loading spinner (data from IndexedDB is instant)

  // FDF dropdown options
  fdfOptions: string[] = [];

  // Notes debounce timer
  notesDebounceTimer: any = null;

  // Track saving state
  isSavingNotes: boolean = false;
  isSavingFdf: boolean = false;
  isSavingLocation: boolean = false;

  // Background upload subscriptions
  private uploadSubscription?: Subscription;
  private taskSubscription?: Subscription;
  private cacheInvalidationSubscription?: Subscription;
  private photoSyncSubscription?: Subscription;
  private efePhotoSyncSubscription?: Subscription;  // For EFE point photos
  private cacheInvalidationDebounceTimer: any = null;
  private isReloadingAfterSync = false;
  private localOperationCooldown = false;

  // Convenience getters for template
  get fdfPhotos() {
    return this.roomData?.fdfPhotos || {};
  }

  get elevationPoints() {
    return this.roomData?.elevationPoints || [];
  }

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
    private imageCompression: ImageCompressionService,
    private backgroundUploadService: BackgroundPhotoUploadService,
    private offlineTemplate: OfflineTemplateService,
    private offlineService: OfflineService,
    private indexedDb: IndexedDbService,
    private backgroundSync: BackgroundSyncService
  ) {}

  async ngOnInit() {
    console.log('========================================');
    console.log('[RoomElevation] ngOnInit - Starting Route Debug');
    console.log('========================================');

    // Debug current route
    console.log('[RoomElevation] Current route snapshot URL:', this.route.snapshot.url);
    console.log('[RoomElevation] Current route params:', this.route.snapshot.params);
    console.log('[RoomElevation] Current route paramMap keys:', Array.from(this.route.snapshot.paramMap.keys));

    // Debug parent routes
    let routeLevel = 0;
    let currentRoute: any = this.route;
    while (currentRoute) {
      console.log(`[RoomElevation] Route Level ${routeLevel}:`, {
        url: currentRoute.snapshot?.url,
        params: currentRoute.snapshot?.params,
        paramMapKeys: currentRoute.snapshot?.paramMap ? Array.from(currentRoute.snapshot.paramMap.keys) : [],
        routeConfig: currentRoute.snapshot?.routeConfig?.path
      });
      currentRoute = currentRoute.parent;
      routeLevel++;
    }

    // Try to get IDs from different route levels
    console.log('\n[RoomElevation] Attempting to retrieve IDs from route hierarchy...\n');

    // Method 1: Direct from current route
    let tempProjectId = this.route.snapshot.paramMap.get('projectId');
    let tempServiceId = this.route.snapshot.paramMap.get('serviceId');
    console.log('[Method 1 - Direct] ProjectId:', tempProjectId, 'ServiceId:', tempServiceId);

    // Method 2: From parent
    if (this.route.parent) {
      tempProjectId = this.route.parent.snapshot.paramMap.get('projectId');
      tempServiceId = this.route.parent.snapshot.paramMap.get('serviceId');
      console.log('[Method 2 - Parent] ProjectId:', tempProjectId, 'ServiceId:', tempServiceId);
    }

    // Method 3: From parent.parent
    if (this.route.parent?.parent) {
      tempProjectId = this.route.parent.parent.snapshot.paramMap.get('projectId');
      tempServiceId = this.route.parent.parent.snapshot.paramMap.get('serviceId');
      console.log('[Method 3 - Parent.Parent] ProjectId:', tempProjectId, 'ServiceId:', tempServiceId);
    }

    // Method 4: From parent.parent.parent (just in case)
    if (this.route.parent?.parent?.parent) {
      tempProjectId = this.route.parent.parent.parent.snapshot.paramMap.get('projectId');
      tempServiceId = this.route.parent.parent.parent.snapshot.paramMap.get('serviceId');
      console.log('[Method 4 - Parent.Parent.Parent] ProjectId:', tempProjectId, 'ServiceId:', tempServiceId);
    }

    // Method 5: Try to get from route state
    const navigation = this.router.getCurrentNavigation();
    console.log('[Method 5 - Router Navigation State]:', navigation?.extras?.state);

    // Method 6: Try subscription approach
    this.route.parent?.parent?.params.subscribe(params => {
      console.log('[Method 6 - Parent.Parent Subscription] Params:', params);
      if (params['projectId']) tempProjectId = params['projectId'];
      if (params['serviceId']) tempServiceId = params['serviceId'];
    });

    // Use the most reliable method (parent.parent seems correct based on route structure)
    let currentRouteForIds = this.route.parent?.parent;
    if (currentRouteForIds) {
      this.projectId = currentRouteForIds.snapshot.paramMap.get('projectId') || '';
      this.serviceId = currentRouteForIds.snapshot.paramMap.get('serviceId') || '';
      console.log('\n[Selected] Using parent.parent - ProjectId:', this.projectId, 'ServiceId:', this.serviceId);
    }

    // Fallback: try to get from snapshot if not found
    if (!this.projectId || !this.serviceId) {
      this.projectId = this.route.snapshot.paramMap.get('projectId') || this.projectId;
      this.serviceId = this.route.snapshot.paramMap.get('serviceId') || this.serviceId;
      console.log('[Fallback] Using direct snapshot - ProjectId:', this.projectId, 'ServiceId:', this.serviceId);
    }

    // Get room name from route params
    this.roomName = this.route.snapshot.paramMap.get('roomName') || '';

    // Check if we're on the base-station route
    if (this.route.snapshot.url.some(segment => segment.path === 'base-station')) {
      this.roomName = 'Base Station';
    }

    console.log('\n[RoomElevation] FINAL VALUES:');
    console.log('  - ProjectId:', this.projectId);
    console.log('  - ServiceId:', this.serviceId);
    console.log('  - RoomName:', this.roomName);
    console.log('========================================\n');

    // Validate we have required IDs
    if (!this.serviceId || !this.projectId) {
      console.error('[RoomElevation] ERROR: Missing required IDs!');
      console.error('  - ServiceId is:', this.serviceId === '' ? 'empty string' : this.serviceId || 'undefined/null');
      console.error('  - ProjectId is:', this.projectId === '' ? 'empty string' : this.projectId || 'undefined/null');
      // Toast removed per user request
      // await this.showToast(`Error: Missing service or project ID. ServiceID: ${this.serviceId}, ProjectID: ${this.projectId}`, 'danger');
      this.loading = false;
      return;
    }

    // Additional validation for serviceId as number
    const serviceIdNum = parseInt(this.serviceId, 10);
    if (isNaN(serviceIdNum)) {
      console.error('[RoomElevation] ERROR: ServiceId is not a valid number:', this.serviceId);
      // Toast removed per user request
      // await this.showToast(`Error: Invalid ServiceID (${this.serviceId}). Ensure you have the correct service ID.`, 'danger');
      this.loading = false;
      return;
    }

    console.log('[RoomElevation] Validation passed. Loading room data...');

    await this.loadRoomData();
    await this.loadFDFOptions();

    // Subscribe to background sync photo upload completions
    // This handles the case where photos are uploaded via IndexedDB queue (offline -> online)
    this.photoSyncSubscription = this.backgroundSync.photoUploadComplete$.subscribe(async (event) => {
      console.log('[RoomElevation PHOTO SYNC] Photo upload completed:', event.tempFileId);
      
      // Extract data from the result object
      const realAttachId = event.result?.AttachID;
      const photoUrl = event.result?.Photo || event.result?.Attachment;
      const s3Key = event.result?.Attachment;

      // Find the photo in our elevationPoints by temp file ID
      for (const point of this.roomData?.elevationPoints || []) {
        const photoIndex = point.photos?.findIndex((p: any) =>
          String(p._tempId) === String(event.tempFileId) ||
          String(p.attachId) === String(event.tempFileId)
        );

        if (photoIndex >= 0 && photoIndex !== undefined) {
          const photo = point.photos[photoIndex];
          const originalTempId = photo._tempId || photo.attachId;
          console.log('[RoomElevation PHOTO SYNC] Found matching photo at point:', point.name, 'index:', photoIndex);

          // CRITICAL: Check if user added annotations while photo was uploading
          const hasExistingAnnotations = photo.hasAnnotations || 
            photo.Drawings || 
            photo.drawings ||
            (photo.displayUrl && photo.displayUrl.startsWith('blob:') && photo.displayUrl !== photo.url);

          // Update the photo with real AttachID and URL
          photo.attachId = realAttachId;
          photo._tempId = undefined;
          photo._pendingFileId = undefined;
          photo.isPending = false;
          photo.queued = false;
          photo.uploading = false;

          // If we have a URL, update it - but PRELOAD first for seamless transition
          if (photoUrl) {
            // CRITICAL: Keep showing local blob URL while preloading server image
            // This prevents broken images during the transition
            const originalDisplayUrl = photo.displayUrl;
            
            // Get S3 URL and fetch as data URL for canvas compatibility
            try {
              let imageUrl = photoUrl;
              if (s3Key && this.caspioService.isS3Key(s3Key)) {
                imageUrl = await this.caspioService.getS3FileUrl(s3Key);
              }
              
              // PRELOAD: Fetch the server image as data URL before switching
              const dataUrl = await this.fetchS3ImageAsDataUrl(imageUrl);
              
              // Only update URL after successful preload - ensures no broken images
              photo.url = dataUrl;
              // CRITICAL: Preserve displayUrl if user added annotations while uploading
              if (!hasExistingAnnotations) {
                photo.displayUrl = dataUrl;
              }
              photo.loading = false;
              
              // Cache the photo
              if (realAttachId) {
                await this.indexedDb.cachePhoto(String(realAttachId), this.serviceId, dataUrl, s3Key || '');
              }
              
              console.log('[RoomElevation PHOTO SYNC] ✅ Server image preloaded and cached successfully');
            } catch (err) {
              console.warn('[RoomElevation PHOTO SYNC] Failed to fetch as data URL, keeping local blob:', err);
              // CRITICAL: Keep showing the original local blob URL on error
              // This ensures the image doesn't break
              if (!hasExistingAnnotations && originalDisplayUrl) {
                photo.displayUrl = originalDisplayUrl;
              }
              photo.url = photoUrl;
            }
          }
          
          // CRITICAL: Transfer cached annotated image from temp ID to real ID
          // This ensures annotations are preserved through the sync process
          if (hasExistingAnnotations && originalTempId && realAttachId) {
            console.log('[RoomElevation PHOTO SYNC] Transferring cached annotated image from temp ID to real ID:', originalTempId, '->', realAttachId);
            try {
              const cachedAnnotatedImage = await this.indexedDb.getCachedAnnotatedImage(String(originalTempId));
              if (cachedAnnotatedImage) {
                // Re-cache with real ID
                const response = await fetch(cachedAnnotatedImage);
                const blob = await response.blob();
                await this.indexedDb.cacheAnnotatedImage(String(realAttachId), blob);
                console.log('[RoomElevation PHOTO SYNC] ✅ Annotated image transferred to real AttachID:', realAttachId);
              }
            } catch (transferErr) {
              console.warn('[RoomElevation PHOTO SYNC] Failed to transfer annotated image cache:', transferErr);
            }
          }

          this.changeDetectorRef.detectChanges();
          console.log('[RoomElevation PHOTO SYNC] Updated photo with real ID:', realAttachId, 'annotations preserved:', hasExistingAnnotations);
          break;
        }
      }
      
      // Also check FDF photos
      const fdfPhotos = this.roomData?.fdfPhotos;
      if (fdfPhotos) {
        for (const key of ['top', 'bottom', 'topDetails', 'bottomDetails']) {
          const photo = fdfPhotos[key];
          if (photo && (String(photo._tempId) === String(event.tempFileId) || String(photo.attachId) === String(event.tempFileId))) {
            const originalTempId = photo._tempId || photo.attachId;
            console.log('[RoomElevation PHOTO SYNC] Found matching FDF photo:', key);
            
            // Check if user added annotations while photo was uploading
            const cacheId = `fdf_${this.roomId}_${key}`;
            const hasExistingAnnotations = fdfPhotos[`${key}HasAnnotations`] ||
              (fdfPhotos[`${key}DisplayUrl`] && fdfPhotos[`${key}DisplayUrl`].startsWith('blob:'));
            
            photo.attachId = realAttachId;
            photo._tempId = undefined;
            photo.isPending = false;
            
            if (photoUrl) {
              try {
                let imageUrl = photoUrl;
                if (s3Key && this.caspioService.isS3Key(s3Key)) {
                  imageUrl = await this.caspioService.getS3FileUrl(s3Key);
                }
                const dataUrl = await this.fetchS3ImageAsDataUrl(imageUrl);
                fdfPhotos[`${key}Url`] = dataUrl;
                // CRITICAL: Preserve displayUrl if user added annotations while uploading
                if (!hasExistingAnnotations) {
                  fdfPhotos[`${key}DisplayUrl`] = dataUrl;
                }
                
                // Cache the photo
                await this.indexedDb.cachePhoto(cacheId, this.serviceId, dataUrl, s3Key || '');
              } catch (err) {
                fdfPhotos[`${key}Url`] = photoUrl;
                if (!hasExistingAnnotations) {
                  fdfPhotos[`${key}DisplayUrl`] = photoUrl;
                }
              }
            }
            
            // CRITICAL: Transfer cached annotated image if exists
            if (hasExistingAnnotations && originalTempId) {
              const tempCacheId = `fdf_${this.roomId}_${key}`;
              try {
                const cachedAnnotatedImage = await this.indexedDb.getCachedAnnotatedImage(tempCacheId);
                if (cachedAnnotatedImage) {
                  console.log('[RoomElevation PHOTO SYNC] ✅ FDF annotated image already cached for:', cacheId);
                }
              } catch (transferErr) {
                console.warn('[RoomElevation PHOTO SYNC] Error checking FDF annotated cache:', transferErr);
              }
            }
            
            this.changeDetectorRef.detectChanges();
            break;
          }
        }
      }
    });

    // Subscribe to EFE photo upload completions (for elevation point photos)
    // This handles seamless URL transition from blob URL to cached base64
    this.efePhotoSyncSubscription = this.backgroundSync.efePhotoUploadComplete$.subscribe(async (event) => {
      console.log('[RoomElevation EFE PHOTO SYNC] EFE photo upload completed:', event.tempFileId);
      
      const realAttachId = event.result?.AttachID || event.result?.PK_ID;
      const s3Key = event.result?.Attachment;
      
      // Find the photo in our elevationPoints by temp file ID
      for (const point of this.roomData?.elevationPoints || []) {
        const photoIndex = point.photos?.findIndex((p: any) =>
          String(p._tempId) === String(event.tempFileId) ||
          String(p.attachId) === String(event.tempFileId)
        );
        
        if (photoIndex >= 0 && photoIndex !== undefined) {
          console.log('[RoomElevation EFE PHOTO SYNC] Found EFE photo at point:', point.name, 'index:', photoIndex);
          
          // SEAMLESS SWAP: Get the cached base64 (already downloaded by BackgroundSyncService)
          let newImageUrl = point.photos[photoIndex].displayUrl || point.photos[photoIndex].url;
          const s3Key = event.result?.Attachment || event.result?.Photo;
          
          try {
            const cachedBase64 = await this.indexedDb.getCachedPhoto(String(realAttachId));
            if (cachedBase64) {
              newImageUrl = cachedBase64;
              console.log('[RoomElevation EFE PHOTO SYNC] ✅ Seamless swap to cached base64');
            } else if (s3Key && this.offlineService.isOnline()) {
              // FALLBACK: Cache wasn't ready yet, fetch from S3 directly
              console.log('[RoomElevation EFE PHOTO SYNC] Cache miss, fetching from S3...');
              try {
                const s3Url = await this.caspioService.getS3FileUrl(s3Key);
                newImageUrl = await this.fetchS3ImageAsDataUrl(s3Url);
                // Cache it for next time
                await this.indexedDb.cachePhoto(String(realAttachId), this.serviceId, newImageUrl, s3Key);
                console.log('[RoomElevation EFE PHOTO SYNC] ✅ Fetched and cached from S3');
              } catch (s3Err) {
                console.warn('[RoomElevation EFE PHOTO SYNC] S3 fetch failed:', s3Err);
              }
            }
          } catch (err) {
            console.warn('[RoomElevation EFE PHOTO SYNC] Failed to get cached image:', err);
          }
          
          // Update photo metadata without flicker
          // CRITICAL: Preserve caption - it may have been set locally before sync
          const existingPhoto = point.photos[photoIndex];
          const serverCaption = event.result?.Annotation || event.result?.Caption || '';
          const localCaption = existingPhoto.caption || existingPhoto.Annotation || '';
          const finalCaption = localCaption || serverCaption;
          
          point.photos[photoIndex] = {
            ...existingPhoto,
            attachId: realAttachId,
            url: newImageUrl,
            displayUrl: newImageUrl,
            caption: finalCaption,  // CRITICAL: Preserve caption
            Annotation: finalCaption,  // Also set Caspio field
            _tempId: undefined,
            _pendingFileId: undefined,
            _localUpdate: false,  // Clear local update flag - sync is complete
            isPending: false,
            queued: false,
            uploading: false,
            loading: false
          };
          
          this.changeDetectorRef.detectChanges();
          console.log('[RoomElevation EFE PHOTO SYNC] Updated EFE photo with real ID:', realAttachId);
          break;
        }
      }
    });

    // Subscribe to cache invalidation events - reload data when sync completes
    // CRITICAL: Debounce to prevent multiple rapid reloads
    this.cacheInvalidationSubscription = this.foundationData.cacheInvalidated$.subscribe(event => {
      // Skip if in local operation cooldown (prevents flash when syncing)
      if (this.localOperationCooldown) {
        console.log('[RoomElevation] Skipping cache invalidation - in local operation cooldown');
        return;
      }
      
      if (!event.serviceId || event.serviceId === this.serviceId) {
        // Clear any existing debounce timer
        if (this.cacheInvalidationDebounceTimer) {
          clearTimeout(this.cacheInvalidationDebounceTimer);
        }
        
        // Skip if already reloading
        if (this.isReloadingAfterSync) {
          console.log('[RoomElevation] Skipping - already reloading');
          return;
        }
        
        // Debounce: wait 500ms before reloading to batch multiple rapid events
        this.cacheInvalidationDebounceTimer = setTimeout(() => {
          console.log('[RoomElevation] Cache invalidated (debounced), reloading elevation data...');
          this.reloadElevationDataAfterSync();
        }, 500);
      }
    });
  }

  /**
   * Reload elevation data after a sync event
   * ENHANCED: Also reloads attachments to ensure photos persist
   */
  private async reloadElevationDataAfterSync(): Promise<void> {
    // Prevent concurrent reloads
    if (this.isReloadingAfterSync) {
      console.log('[RoomElevation] Skipping - already reloading');
      return;
    }
    
    this.isReloadingAfterSync = true;
    try {
      console.log('[RoomElevation] Reloading points and attachments after sync...');
      
      // Reload points from fresh IndexedDB data
      const existingPoints = await this.foundationData.getEFEPoints(this.roomId);
      console.log('[RoomElevation] Reloaded', existingPoints?.length || 0, 'points from IndexedDB');
      
      // Get point IDs for attachment loading
      const pointIds = existingPoints?.map((p: any) => p.PointID || p.PK_ID).filter((id: any) => id) || [];
      
      // Reload attachments
      let attachments: any[] = [];
      if (pointIds.length > 0) {
        try {
          attachments = await this.foundationData.getEFEAttachments(pointIds);
          console.log('[RoomElevation] Reloaded', attachments?.length || 0, 'attachments from IndexedDB');
        } catch (err) {
          console.warn('[RoomElevation] Failed to reload attachments:', err);
        }
      }
      
      // Update our local points array with fresh data
      if (this.roomData?.elevationPoints && existingPoints) {
        for (const serverPoint of existingPoints) {
          const pointName = serverPoint.PointName;
          const localPoint = this.roomData.elevationPoints.find((p: any) => p.name === pointName);
          
          if (localPoint) {
            // Update with server data (real ID)
            const realId = serverPoint.PointID || serverPoint.PK_ID;
            console.log(`[RoomElevation] Updating point "${pointName}" with real ID: ${realId}`);
            localPoint.pointId = realId;
            localPoint.value = serverPoint.Elevation || localPoint.value || '';
            delete localPoint._tempId;
            delete localPoint._localOnly;
            delete localPoint._syncing;
            
            // CRITICAL: Reload photos for this point
            const pointIdStr = String(realId);
            const pointAttachments = attachments.filter((att: any) => String(att.PointID) === pointIdStr);
            console.log(`[RoomElevation] Found ${pointAttachments.length} attachments for point "${pointName}"`);
            
            // Build a set of existing photo IDs to avoid duplicates
            const existingPhotoIds = new Set(
              (localPoint.photos || []).map((p: any) => String(p.attachId))
            );
            
            for (const attach of pointAttachments) {
              const attachIdStr = String(attach.AttachID || attach.PK_ID);
              
              // Check if we already have this photo
              if (existingPhotoIds.has(attachIdStr)) {
                // Update existing photo with server data if needed
                const existingPhoto = localPoint.photos.find((p: any) => String(p.attachId) === attachIdStr);
                if (existingPhoto) {
                  // If photo is still loading/placeholder, try to load the actual image
                  if (existingPhoto.loading || existingPhoto.url === 'assets/img/photo-placeholder.png') {
                    const s3Key = attach.Attachment || attach.Photo;
                    if (s3Key && this.caspioService.isS3Key(s3Key)) {
                      this.loadPointPhotoImage(s3Key, existingPhoto).catch(err => {
                        console.warn('[RoomElevation] Failed to reload photo:', err);
                      });
                    }
                  }
                }
                continue;
              }
              
              // Add new photo from server
              const photoType = attach.Type || attach.photoType || 'Measurement';
              const EMPTY_COMPRESSED_ANNOTATIONS = 'H4sIAAAAAAAAA6tWKkktLlGyUlAqS8wpTtVRKi1OLYrPTFGyUqoFAJRGGIYcAAAA';
              const photoData: any = {
                attachId: attach.AttachID || attach.PK_ID,
                photoType: photoType,
                url: 'assets/img/photo-placeholder.png',
                displayUrl: 'assets/img/photo-placeholder.png',
                caption: attach.Annotation || '',
                drawings: attach.Drawings || null,
                hasAnnotations: !!(attach.Drawings && attach.Drawings !== 'null' && attach.Drawings !== '' && attach.Drawings !== EMPTY_COMPRESSED_ANNOTATIONS),
                path: attach.Attachment || attach.Photo || null,
                Attachment: attach.Attachment,
                Photo: attach.Photo,
                uploading: false,
                loading: true
              };
              
              // Ensure photos array exists
              if (!localPoint.photos) {
                localPoint.photos = [];
              }
              
              localPoint.photos.push(photoData);
              existingPhotoIds.add(attachIdStr);
              
              // Load the actual image in background
              const s3Key = attach.Attachment || attach.Photo;
              if (s3Key) {
                this.loadPointPhotoImage(s3Key, photoData).catch(err => {
                  console.warn('[RoomElevation] Failed to load new photo:', err);
                });
              }
            }
          }
        }
      }
      
      this.changeDetectorRef.detectChanges();
      console.log('[RoomElevation] Elevation data reload complete');
      
      // Set cooldown to prevent rapid re-invalidations
      this.localOperationCooldown = true;
      setTimeout(() => {
        this.localOperationCooldown = false;
      }, 2000);
      
    } catch (error) {
      console.error('[RoomElevation] Error reloading elevation data:', error);
    } finally {
      this.isReloadingAfterSync = false;
    }
  }

  ngOnDestroy() {
    // Clean up debounce timers
    if (this.notesDebounceTimer) {
      clearTimeout(this.notesDebounceTimer);
    }
    if (this.cacheInvalidationDebounceTimer) {
      clearTimeout(this.cacheInvalidationDebounceTimer);
    }

    // Clean up upload subscriptions - but uploads will continue in background service
    if (this.uploadSubscription) {
      this.uploadSubscription.unsubscribe();
    }
    if (this.taskSubscription) {
      this.taskSubscription.unsubscribe();
    }
    if (this.cacheInvalidationSubscription) {
      this.cacheInvalidationSubscription.unsubscribe();
    }
    if (this.photoSyncSubscription) {
      this.photoSyncSubscription.unsubscribe();
    }
    if (this.efePhotoSyncSubscription) {
      this.efePhotoSyncSubscription.unsubscribe();
    }
    console.log('[ROOM ELEVATION] Component destroyed, but uploads continue in background');
  }

  goBack() {
    this.router.navigate(['..'], { relativeTo: this.route });
  }

  isBaseStation(): boolean {
    // Check for "Base Station" and duplicates like "Base Station #2", "Base Station #3", etc.
    return this.roomName.toLowerCase().startsWith('base station');
  }

  isGarage(): boolean {
    return this.roomName.toLowerCase().includes('garage');
  }

  shouldShowFDFPhotos(): boolean {
    // Only show FDF photos if "Different Elevation" is selected
    return this.roomData?.fdf === 'Different Elevation';
  }

  private async loadRoomData() {
    console.log('[RoomElevation] loadRoomData() called');
    console.log('  - ServiceId:', this.serviceId);
    console.log('  - RoomName:', this.roomName);

    // OFFLINE-FIRST: Don't show loading spinner if we have cached data
    // Data is already cached by the container's template download
    // Only show loading for first-time fetches (no cache)
    try {
      // Load room record from Services_EFE (reads from IndexedDB immediately)
      console.log('[RoomElevation] Calling foundationData.getEFEByService with serviceId:', this.serviceId);
      const rooms = await this.foundationData.getEFEByService(this.serviceId, true);
      console.log('[RoomElevation] getEFEByService returned', rooms?.length || 0, 'rooms');
      console.log('[RoomElevation] Rooms:', rooms);

      const room = rooms.find((r: any) => r.RoomName === this.roomName);
      console.log('[RoomElevation] Found room matching name "' + this.roomName + '":', room);

      if (!room) {
        console.error('[RoomElevation] ERROR: Room not found with name:', this.roomName);
        console.error('[RoomElevation] Available room names:', rooms.map((r: any) => r.RoomName));
        // Toast removed per user request
        // await this.showToast('Room not found', 'danger');
        this.goBack();
        return;
      }

      this.roomId = room.EFEID;
      console.log('[RoomElevation] Room ID set to:', this.roomId);
      console.log('[RoomElevation] Room TemplateID from database:', room.TemplateID);
      console.log('[RoomElevation] Room FDF value from database:', room.FDF);
      console.log('[RoomElevation] Room full record:', room);

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
      // Toast removed per user request
      // await this.showToast('Failed to load room data', 'danger');
    }
    // OFFLINE-FIRST: No loading spinner management needed - data from IndexedDB is instant
  }

  private async loadFDFPhotos(room: any) {
    const fdfPhotos = this.roomData.fdfPhotos;
    const EMPTY_COMPRESSED_ANNOTATIONS = 'H4sIAAAAAAAAA6tWKkktLlGyUlAqS8wpTtVRKi1OLYrPTFGyUqoFAJRGGIYcAAAA';

    // CRITICAL: Load photo metadata IMMEDIATELY (don't wait for images)
    // This allows skeletons to show while images load in background

    // Load Top photo metadata - PREFER S3 Attachment column over legacy Files API path
    // Column names: FDFPhotoTop (legacy path), FDFPhotoTopAttachment (S3), FDFTopAnnotation, FDFTopDrawings
    const topS3Key = room.FDFPhotoTopAttachment;
    const topLegacyPath = room.FDFPhotoTop;
    if (topS3Key || topLegacyPath) {
      fdfPhotos.top = true;
      fdfPhotos.topPath = topLegacyPath;
      fdfPhotos.topAttachment = topS3Key;
      fdfPhotos.topCaption = room.FDFTopAnnotation || '';
      fdfPhotos.topDrawings = room.FDFTopDrawings || null;
      fdfPhotos.topLoading = true; // Skeleton state
      fdfPhotos.topUrl = 'assets/img/photo-placeholder.png'; // Placeholder
      fdfPhotos.topDisplayUrl = 'assets/img/photo-placeholder.png';
      fdfPhotos.topHasAnnotations = !!(room.FDFTopDrawings && room.FDFTopDrawings !== 'null' && room.FDFTopDrawings !== '' && room.FDFTopDrawings !== EMPTY_COMPRESSED_ANNOTATIONS);

      // Load actual image in background - PREFER S3 key
      this.loadFDFPhotoImage(topS3Key || topLegacyPath, 'top').catch(err => {
        console.error('Error loading top photo:', err);
      });
    }

    // Load Bottom photo metadata - PREFER S3 Attachment column over legacy Files API path
    // Column names: FDFPhotoBottom (legacy path), FDFPhotoBottomAttachment (S3), FDFBottomAnnotation, FDFBottomDrawings
    const bottomS3Key = room.FDFPhotoBottomAttachment;
    const bottomLegacyPath = room.FDFPhotoBottom;
    if (bottomS3Key || bottomLegacyPath) {
      fdfPhotos.bottom = true;
      fdfPhotos.bottomPath = bottomLegacyPath;
      fdfPhotos.bottomAttachment = bottomS3Key;
      fdfPhotos.bottomCaption = room.FDFBottomAnnotation || '';
      fdfPhotos.bottomDrawings = room.FDFBottomDrawings || null;
      fdfPhotos.bottomLoading = true; // Skeleton state
      fdfPhotos.bottomUrl = 'assets/img/photo-placeholder.png';
      fdfPhotos.bottomDisplayUrl = 'assets/img/photo-placeholder.png';
      fdfPhotos.bottomHasAnnotations = !!(room.FDFBottomDrawings && room.FDFBottomDrawings !== 'null' && room.FDFBottomDrawings !== '' && room.FDFBottomDrawings !== EMPTY_COMPRESSED_ANNOTATIONS);

      // Load actual image in background - PREFER S3 key
      this.loadFDFPhotoImage(bottomS3Key || bottomLegacyPath, 'bottom').catch(err => {
        console.error('Error loading bottom photo:', err);
      });
    }

    // Load Threshold (Location) photo metadata - PREFER S3 Attachment column over legacy Files API path
    // Column names: FDFPhotoThreshold (legacy path), FDFPhotoThresholdAttachment (S3), FDFThresholdAnnotation, FDFThresholdDrawings
    const thresholdS3Key = room.FDFPhotoThresholdAttachment;
    const thresholdLegacyPath = room.FDFPhotoThreshold;
    if (thresholdS3Key || thresholdLegacyPath) {
      fdfPhotos.threshold = true;
      fdfPhotos.thresholdPath = thresholdLegacyPath;
      fdfPhotos.thresholdAttachment = thresholdS3Key;
      fdfPhotos.thresholdCaption = room.FDFThresholdAnnotation || '';
      fdfPhotos.thresholdDrawings = room.FDFThresholdDrawings || null;
      fdfPhotos.thresholdLoading = true; // Skeleton state
      fdfPhotos.thresholdUrl = 'assets/img/photo-placeholder.png';
      fdfPhotos.thresholdDisplayUrl = 'assets/img/photo-placeholder.png';
      fdfPhotos.thresholdHasAnnotations = !!(room.FDFThresholdDrawings && room.FDFThresholdDrawings !== 'null' && room.FDFThresholdDrawings !== '' && room.FDFThresholdDrawings !== EMPTY_COMPRESSED_ANNOTATIONS);

      // Load actual image in background - PREFER S3 key
      this.loadFDFPhotoImage(thresholdS3Key || thresholdLegacyPath, 'threshold').catch(err => {
        console.error('Error loading threshold photo:', err);
      });
    }
    
    // Also restore any pending FDF photo uploads from IndexedDB
    await this.restorePendingFDFPhotos();
  }
  
  // Restore pending FDF photo uploads from IndexedDB
  private async restorePendingFDFPhotos() {
    try {
      const pendingRequests = await this.indexedDb.getPendingRequests();
      // Filter for FDF photo uploads - marked with isFDFPhoto in data
      // CRITICAL FIX: Check both direct room ID match AND temp-to-real ID mapping
      // This handles the case where FDF photo was taken with temp room ID but room now has real ID
      const fdfRequests: any[] = [];
      for (const r of pendingRequests) {
        if (r.type === 'UPLOAD_FILE' && r.data?.isFDFPhoto === true) {
          const storedRoomId = String(r.data?.roomId || '');
          
          // Direct match
          if (storedRoomId === this.roomId) {
            fdfRequests.push(r);
            continue;
          }
          
          // Check temp-to-real room ID mapping
          // If the stored roomId was a temp ID that maps to current real roomId
          if (storedRoomId.startsWith('temp_') && !String(this.roomId).startsWith('temp_')) {
            try {
              const mappedRealId = await this.indexedDb.getRealId(storedRoomId);
              if (mappedRealId === this.roomId) {
                console.log(`[FDF Restore] ✅ Matched pending FDF photo via temp->real room mapping: ${storedRoomId} -> ${this.roomId}`);
                fdfRequests.push(r);
              }
            } catch (err) {
              // Ignore mapping errors
            }
          }
        }
      }
      
      for (const req of fdfRequests) {
        const photoType = req.data?.photoType as 'Top' | 'Bottom' | 'Threshold';
        const tempFileId = req.data?.tempFileId;
        
        if (!photoType || !tempFileId) continue;
        
        const photoKey = photoType.toLowerCase();
        const fdfPhotos = this.roomData.fdfPhotos;
        
        // Check if we already have this photo loaded
        if (fdfPhotos[photoKey] && !fdfPhotos[`${photoKey}Queued`]) {
          continue;
        }
        
        // Try to load the stored photo data
        const storedData = await this.indexedDb.getStoredPhotoData(tempFileId);
        if (storedData?.file) {
          console.log(`[FDF Restore] Restoring pending ${photoType} photo from IndexedDB`);
          
          // Convert to base64 for display
          const base64Image = await this.convertFileToBase64(storedData.file);
          
          fdfPhotos[photoKey] = true;
          fdfPhotos[`${photoKey}Url`] = base64Image;
          fdfPhotos[`${photoKey}DisplayUrl`] = base64Image;
          fdfPhotos[`${photoKey}TempId`] = tempFileId;
          fdfPhotos[`${photoKey}Queued`] = true;  // Show queued badge instead of spinner
          fdfPhotos[`${photoKey}Uploading`] = false;  // CRITICAL: No spinner - photo appears instantly (offline-first)
          fdfPhotos[`${photoKey}Loading`] = false;  // CRITICAL: Clear loading to show the photo immediately
          
          this.changeDetectorRef.detectChanges();
          
          // If online, trigger upload
          if (this.offlineService.isOnline()) {
            this.uploadFDFPhotoToS3(photoType, storedData.file, tempFileId).catch(err => {
              console.error(`[FDF Restore] Failed to upload restored ${photoType} photo:`, err);
            });
          }
        }
      }
    } catch (error) {
      console.error('[FDF Restore] Error restoring pending photos:', error);
    }
  }

  // New helper method to load FDF photo images in background (OFFLINE-FIRST)
  // Supports both S3 keys and legacy Caspio Files API paths
  private async loadFDFPhotoImage(photoPathOrS3Key: string, photoKey: string) {
    const fdfPhotos = this.roomData.fdfPhotos;
    // Use room ID + photoKey as cache ID for FDF photos
    const cacheId = `fdf_${this.roomId}_${photoKey}`;
    const isS3Key = this.caspioService.isS3Key(photoPathOrS3Key);
    
    console.log(`[FDF Photo] Loading ${photoKey} image, isS3Key: ${isS3Key}, path: ${photoPathOrS3Key?.substring(0, 50)}`);
    
    try {
      // CRITICAL FIX: Check for cached ANNOTATED image first (has drawings on it)
      const cachedAnnotatedImage = await this.indexedDb.getCachedAnnotatedImage(cacheId);
      if (cachedAnnotatedImage) {
        console.log(`[FDF Photo] ✅ Using cached ANNOTATED ${photoKey} image`);
        fdfPhotos[`${photoKey}Url`] = cachedAnnotatedImage;
        fdfPhotos[`${photoKey}DisplayUrl`] = cachedAnnotatedImage;
        fdfPhotos[`${photoKey}Loading`] = false;
        this.changeDetectorRef.detectChanges();
        return;
      }
      
      // OFFLINE-FIRST: Check IndexedDB cached photo (base image without annotations)
      const cachedImage = await this.indexedDb.getCachedPhoto(cacheId);
      if (cachedImage) {
        console.log(`[FDF Photo] Using cached ${photoKey} image`);
        fdfPhotos[`${photoKey}Url`] = cachedImage;
        fdfPhotos[`${photoKey}DisplayUrl`] = cachedImage;
        fdfPhotos[`${photoKey}Loading`] = false;
        this.changeDetectorRef.detectChanges();
        return;
      }

      // If offline and no cache, use placeholder
      if (!this.offlineService.isOnline()) {
        console.log(`[FDF Photo] Offline and no cache for ${photoKey}, using placeholder`);
        fdfPhotos[`${photoKey}Url`] = 'assets/img/photo-placeholder.png';
        fdfPhotos[`${photoKey}DisplayUrl`] = 'assets/img/photo-placeholder.png';
        fdfPhotos[`${photoKey}Loading`] = false;
        this.changeDetectorRef.detectChanges();
        return;
      }

      // Online - fetch from API and cache
      let imageData: string | null = null;
      
      // Check if this is an S3 key - use XMLHttpRequest to fetch as data URL
      if (isS3Key) {
        console.log(`[FDF Photo] Fetching S3 image for ${photoKey}:`, photoPathOrS3Key);
        try {
          const s3Url = await this.caspioService.getS3FileUrl(photoPathOrS3Key);
          imageData = await this.fetchS3ImageAsDataUrl(s3Url);
        } catch (err) {
          console.warn(`[FDF Photo] S3 fetch failed for ${photoKey}, trying fallback:`, err);
        }
      }
      
      // Fallback to Caspio Files API for non-S3 paths (legacy)
      if (!imageData && !isS3Key) {
        imageData = await this.foundationData.getImage(photoPathOrS3Key);
      }
      
      if (imageData) {
        fdfPhotos[`${photoKey}Url`] = imageData;
        fdfPhotos[`${photoKey}DisplayUrl`] = imageData;
        fdfPhotos[`${photoKey}Loading`] = false;
        
        // Cache for offline use
        await this.indexedDb.cachePhoto(cacheId, this.serviceId, imageData, photoPathOrS3Key);
        console.log(`[FDF Photo] Loaded and cached ${photoKey} image`);
        
        this.changeDetectorRef.detectChanges();
      } else {
        throw new Error('No image data returned');
      }
    } catch (error) {
      console.error(`[FDF Photo] Error loading ${photoKey} image:`, error);
      fdfPhotos[`${photoKey}Url`] = 'assets/img/photo-placeholder.png';
      fdfPhotos[`${photoKey}DisplayUrl`] = 'assets/img/photo-placeholder.png';
      fdfPhotos[`${photoKey}Loading`] = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  // New helper method to load elevation point photo images in background (OFFLINE-FIRST)
  private async loadPointPhotoImage(photoPath: string, photoData: any) {
    const attachId = String(photoData.attachId);
    // Also check if we have an S3 key in the Attachment field
    const s3Key = photoData.Attachment || photoPath;
    
    try {
      // CRITICAL FIX: Check for cached ANNOTATED image first (has drawings on it)
      const cachedAnnotatedImage = await this.indexedDb.getCachedAnnotatedImage(attachId);
      if (cachedAnnotatedImage) {
        console.log(`[Point Photo] ✅ Using cached ANNOTATED image for ${attachId}`);
        photoData.url = cachedAnnotatedImage;
        photoData.displayUrl = cachedAnnotatedImage;
        photoData.loading = false;
        photoData.hasAnnotations = true;
        this.changeDetectorRef.detectChanges();
        return;
      }
      
      // OFFLINE-FIRST: Check IndexedDB cached photo (base image without annotations)
      const cachedImage = await this.indexedDb.getCachedPhoto(attachId);
      if (cachedImage) {
        console.log(`[Point Photo] Using cached image for ${attachId}`);
        photoData.url = cachedImage;
        photoData.displayUrl = cachedImage;
        photoData.loading = false;
        this.changeDetectorRef.detectChanges();
        return;
      }

      // If offline and no cache, use placeholder
      if (!this.offlineService.isOnline()) {
        console.log(`[Point Photo] Offline and no cache for ${attachId}, using placeholder`);
        photoData.url = 'assets/img/photo-placeholder.png';
        photoData.displayUrl = 'assets/img/photo-placeholder.png';
        photoData.loading = false;
        this.changeDetectorRef.detectChanges();
        return;
      }

      // Online - fetch from API and cache
      let imageData: string | null = null;
      
      // Check if this is an S3 key - use XMLHttpRequest to fetch as data URL
      if (s3Key && this.caspioService.isS3Key(s3Key)) {
        console.log(`[Point Photo] Fetching S3 image for ${attachId}:`, s3Key);
        try {
          const s3Url = await this.caspioService.getS3FileUrl(s3Key);
          imageData = await this.fetchS3ImageAsDataUrl(s3Url);
        } catch (err) {
          console.warn(`[Point Photo] S3 fetch failed for ${attachId}, trying fallback:`, err);
        }
      }
      
      // Fallback to Caspio Files API for non-S3 paths
      if (!imageData && photoPath && !this.caspioService.isS3Key(photoPath)) {
        imageData = await this.foundationData.getImage(photoPath);
      }
      
      if (imageData) {
        photoData.url = imageData;
        photoData.displayUrl = imageData;
        photoData.loading = false;
        
        // Cache for offline use
        if (attachId && !attachId.startsWith('temp_')) {
          await this.indexedDb.cachePhoto(attachId, this.serviceId, imageData, s3Key || photoPath);
          console.log(`[Point Photo] Loaded and cached image for ${attachId}`);
        }
        
        this.changeDetectorRef.detectChanges();
      }
    } catch (error) {
      console.error(`[Point Photo] Error loading image:`, error);
      photoData.url = 'assets/img/photo-placeholder.png';
      photoData.displayUrl = 'assets/img/photo-placeholder.png';
      photoData.loading = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  private async loadElevationPoints() {
    console.log('========================================');
    console.log('[RoomElevation] *** LOAD ELEVATION POINTS - START ***');
    console.log('========================================');
    console.log('[RoomElevation] RoomID:', this.roomId);
    console.log('[RoomElevation] RoomName:', this.roomName);
    console.log('[RoomElevation] Current roomData:', this.roomData);

    try {
      // STEP 1: Load the template to get point names (Point1Name, Point2Name, etc.)
      console.log('\n[RoomElevation] STEP 1: Loading template...');
      const templateId = this.roomData?.templateId;
      console.log('[RoomElevation] TemplateID from roomData:', templateId);
      console.log('[RoomElevation] TemplateID type:', typeof templateId);

      // Convert templateId to number (matches original code behavior)
      // Database may return string but templates have numeric TemplateID
      const templateIdNum = typeof templateId === 'string' ? parseInt(templateId, 10) : templateId;
      console.log('[RoomElevation] TemplateID converted to number:', templateIdNum);

      if (!templateId) {
        console.error('[RoomElevation] âŒ ERROR: No TemplateID found for room!');
        console.error('[RoomElevation] roomData structure:', JSON.stringify(this.roomData, null, 2));
        return;
      }

      // Load all templates
      console.log('[RoomElevation] Calling foundationData.getEFETemplates()...');
      const allTemplates = await this.foundationData.getEFETemplates();
      console.log('[RoomElevation] âœ“ Loaded', allTemplates?.length || 0, 'templates from LPS_Services_EFE_Templates');

      if (allTemplates && allTemplates.length > 0) {
        console.log('[RoomElevation] Sample template structure:', allTemplates[0]);
        console.log('[RoomElevation] All template IDs:', allTemplates.map((t: any) => ({ TemplateID: t.TemplateID, PK_ID: t.PK_ID, RoomName: t.RoomName })));
      }

      // Find the matching template
      console.log(`[RoomElevation] Searching for template with TemplateID=${templateIdNum}...`);
      const template = allTemplates.find((t: any) => {
        const matches = t.TemplateID == templateIdNum || t.PK_ID == templateIdNum;
        console.log(`  - Checking template: TemplateID=${t.TemplateID}, PK_ID=${t.PK_ID}, RoomName="${t.RoomName}", Matches=${matches}`);
        return matches;
      });

      if (!template) {
        console.error('[RoomElevation] âŒ ERROR: Template not found for TemplateID:', templateIdNum);
        console.error('[RoomElevation] Available templates:', allTemplates.map((t: any) => ({ TemplateID: t.TemplateID, PK_ID: t.PK_ID, RoomName: t.RoomName })));
        return;
      }

      console.log('[RoomElevation] âœ“ Found matching template:', template.RoomName);
      console.log('[RoomElevation] Template full data:', template);

      // STEP 2: Extract elevation points from template (Point1Name through Point20Name)
      console.log('\n[RoomElevation] STEP 2: Extracting elevation points from template...');
      const templatePoints: any[] = [];
      for (let i = 1; i <= 20; i++) {
        const pointColumnName = `Point${i}Name`;
        const pointName = template[pointColumnName];

        console.log(`[RoomElevation]   ${pointColumnName}: "${pointName}"`);

        if (pointName && pointName.trim() !== '') {
          templatePoints.push({
            pointNumber: i,
            name: pointName,
            pointId: null,  // Will be filled if point exists in database
            value: '',
            photos: []
          });
          console.log(`[RoomElevation]     âœ“ Added point #${i}: "${pointName}"`);
        }
      }

      console.log('[RoomElevation] âœ“ Template has', templatePoints.length, 'predefined points');
      console.log('[RoomElevation] Template points:', templatePoints.map(p => p.name));

      // STEP 3: Load existing points from Services_EFE_Points
      console.log('\n[RoomElevation] STEP 3: Loading existing points from Services_EFE_Points...');
      console.log('[RoomElevation] Calling getServicesEFEPoints with roomId:', this.roomId);

      let existingPoints: any[] = [];
      try {
        // OFFLINE-FIRST: Use foundationData which reads from IndexedDB first
        existingPoints = await this.foundationData.getEFEPoints(this.roomId) || [];
        console.log('[RoomElevation] âœ“ Found', existingPoints?.length || 0, 'existing points in database');
        if (existingPoints && existingPoints.length > 0) {
          console.log('[RoomElevation] Existing points:', existingPoints.map((p: any) => ({
            PointID: p.PointID,
            PointName: p.PointName,
            Elevation: p.Elevation
          })));
        }
      } catch (error) {
        console.error('[RoomElevation] âŒ Error loading existing points:', error);
      }

      // STEP 4: Load all attachments for existing points
      console.log('\n[RoomElevation] STEP 4: Loading attachments...');
      let attachments: any[] = [];
      
      // CRITICAL: Get ALL pending photos grouped by point in ONE IndexedDB call
      // This avoids N+1 reads when processing each point (matches structural systems pattern)
      const pendingPhotosMap = await this.indexedDb.getAllPendingPhotosGroupedByPoint();
      console.log('[RoomElevation] Pending photos map has', pendingPhotosMap.size, 'points with pending photos');
      
      if (existingPoints && existingPoints.length > 0) {
        const pointIds = existingPoints.map((p: any) => p.PointID || p.PK_ID).filter(id => id);
        console.log('[RoomElevation] Point IDs to fetch attachments for:', pointIds);

        if (pointIds.length > 0) {
          try {
            attachments = await this.foundationData.getEFEAttachments(pointIds);
            console.log('[RoomElevation] âœ“ Loaded', attachments?.length || 0, 'attachments from Services_EFE_Points_Attach');
            if (attachments && attachments.length > 0) {
              console.log('[RoomElevation] Attachments:', attachments.map((a: any) => ({
                AttachID: a.AttachID,
                PointID: a.PointID,
                PhotoType: a.PhotoType,
                Photo: a.Photo
              })));
            }
          } catch (error) {
            console.error('[RoomElevation] âŒ Error loading attachments:', error);
          }
        }
      } else {
        console.log('[RoomElevation] No existing points, skipping attachment loading');
      }

      // STEP 5: Merge template points with existing database points
      console.log('\n[RoomElevation] STEP 5: Merging template points with database data...');
      console.log('[RoomElevation] Processing', templatePoints.length, 'template points...');

      for (const templatePoint of templatePoints) {
        console.log(`\n[RoomElevation] --- Processing template point: "${templatePoint.name}" ---`);

        // Find matching existing point by name
        const existingPoint = existingPoints?.find((p: any) => p.PointName === templatePoint.name);
        console.log(`[RoomElevation]   Existing point in DB:`, existingPoint ? `Yes (ID: ${existingPoint.PointID})` : 'No');

        const pointData: any = {
          pointNumber: templatePoint.pointNumber,
          name: templatePoint.name,
          pointId: existingPoint ? (existingPoint.PointID || existingPoint.PK_ID) : null,
          value: existingPoint ? (existingPoint.Elevation || '') : '',
          photos: []
        };

        // If point exists in database, load its photos
        if (existingPoint) {
          const pointId = existingPoint.PointID || existingPoint.PK_ID;
          const pointIdStr = String(pointId);
          // CRITICAL FIX: Use String() conversion to avoid type mismatch when comparing IDs
          const pointAttachments = attachments.filter((att: any) => String(att.PointID) === pointIdStr);
          console.log(`[RoomElevation]   Found ${pointAttachments.length} attachments for this point (ID: ${pointIdStr})`);

          // Process each attachment
          for (const attach of pointAttachments) {
            // CRITICAL: Database column is "Type", not "PhotoType"
            const photoType = attach.Type || attach.photoType || 'Measurement';
            const attachIdStr = String(attach.AttachID || attach.PK_ID);
            console.log(`[RoomElevation]     Processing attachment: Type=${photoType}, Photo=${attach.Photo}, isPending=${attach.isPending}, ID=${attachIdStr}`);
            
            // CRITICAL FIX: Check for duplicate before adding - use String() conversion for consistent comparison
            const alreadyExists = pointData.photos.some((p: any) => 
              String(p.attachId) === attachIdStr
            );
            
            if (alreadyExists) {
              console.log(`[RoomElevation]     Skipping duplicate attachment: ${attachIdStr}`);
              continue;
            }
            
            // Check if this is a pending photo (uploaded offline, not yet synced)
            if (attach.isPending || attach.queued) {
              console.log(`[RoomElevation]     Adding pending photo with blob URL: ${photoType}`);
              const pendingPhotoData: any = {
                attachId: attach.AttachID || attach._pendingFileId,
                photoType: photoType,
                url: attach.displayUrl || attach.url || attach.thumbnailUrl,
                displayUrl: attach.displayUrl || attach.url || attach.thumbnailUrl,
                caption: attach.Annotation || '',
                drawings: attach.Drawings || attach.drawings || null,
                hasAnnotations: !!(attach.Drawings || attach.drawings),
                uploading: false,
                queued: true,
                isPending: true,
                _tempId: attach.AttachID || attach._pendingFileId,
              };
              pointData.photos.push(pendingPhotoData);
              continue;
            }

            const EMPTY_COMPRESSED_ANNOTATIONS = 'H4sIAAAAAAAAA6tWKkktLlGyUlAqS8wpTtVRKi1OLYrPTFGyUqoFAJRGGIYcAAAA';
            const photoData: any = {
              attachId: attach.AttachID || attach.PK_ID,
              photoType: photoType,
              url: null,
              displayUrl: null,
              caption: attach.Annotation || '',
              Annotation: attach.Annotation || '',
              drawings: attach.Drawings || null,
              Drawings: attach.Drawings || null,
              hasAnnotations: !!(attach.Drawings && attach.Drawings !== 'null' && attach.Drawings !== '' && attach.Drawings !== EMPTY_COMPRESSED_ANNOTATIONS),
              path: attach.Attachment || attach.Photo || null,
              Attachment: attach.Attachment,
              Photo: attach.Photo,
              uploading: false,
              _localUpdate: attach._localUpdate || false,
            };

            // Set loading state for all photos
            const hasS3Key = attach.Attachment && this.caspioService.isS3Key(attach.Attachment);
            const hasPhotoPath = !!attach.Photo;
            
            if (hasS3Key || hasPhotoPath) {
              photoData.url = 'assets/img/photo-placeholder.png';
              photoData.displayUrl = 'assets/img/photo-placeholder.png';
              photoData.loading = true;
              console.log(`[RoomElevation]       Setting photo to loading state (S3: ${hasS3Key})`);
            }

            pointData.photos.push(photoData);

            // Load the actual image in background (non-blocking)
            // CRITICAL FIX: Always use loadPointPhotoImage which fetches as data URL and caches
            // This ensures fabric.js can use the image without CORS issues
            if (hasS3Key || hasPhotoPath) {
              this.loadPointPhotoImage(attach.Photo || attach.Attachment, photoData).catch(err => {
                console.error(`[RoomElevation]       âŒ Error loading photo:`, err);
              });
            }
          }
        }
        
        // CRITICAL: Add pending photos from the pre-grouped map (ONE IndexedDB read total)
        // This matches the structural systems pattern for performance
        const pointIdStr = String(pointData.pointId);
        let pendingPhotos = pendingPhotosMap.get(pointIdStr) || [];
        
        // CRITICAL FIX: If no pending photos found by real ID, check for temp ID mappings
        // This handles the case where:
        // 1. Photo was taken for a point with temp ID (temp_point_xxx)
        // 2. Page was reloaded
        // 3. Point now has a real ID from server (123)
        // 4. Pending photo is still stored with temp point ID in IndexedDB
        if (pendingPhotos.length === 0 && pointIdStr && !pointIdStr.startsWith('temp_')) {
          // This point has a real ID - check if any pending photos were stored with a temp ID
          // that maps to this real ID
          const mapEntries = Array.from(pendingPhotosMap.entries());
          for (let i = 0; i < mapEntries.length; i++) {
            const tempPointId = mapEntries[i][0];
            const photos = mapEntries[i][1];
            if (tempPointId.startsWith('temp_point_') || tempPointId.startsWith('temp_')) {
              try {
                const mappedRealId = await this.indexedDb.getRealId(tempPointId);
                if (mappedRealId === pointIdStr) {
                  pendingPhotos = photos;
                  console.log(`[RoomElevation] ✅ Found pending photos via temp->real mapping: ${tempPointId} -> ${pointIdStr}`);
                  break;
                }
              } catch (mappingErr) {
                console.warn(`[RoomElevation] Error checking temp ID mapping for ${tempPointId}:`, mappingErr);
              }
            }
          }
        }
        
        if (pendingPhotos.length > 0) {
          console.log(`[RoomElevation]   Adding ${pendingPhotos.length} pending photos for point ${pointIdStr}`);
          for (const pendingPhoto of pendingPhotos) {
            const pendingAttachId = String(pendingPhoto.AttachID || pendingPhoto._pendingFileId);
            
            // CRITICAL FIX: Check for duplicate before adding - use String() conversion for consistent comparison
            const alreadyExists = pointData.photos.some((p: any) => 
              String(p.attachId) === pendingAttachId || 
              String(p._tempId) === pendingAttachId
            );
            
            if (alreadyExists) {
              console.log(`[RoomElevation]     Skipping duplicate pending photo: ${pendingAttachId}`);
              continue;
            }
            
            const photoId = pendingPhoto.AttachID || pendingPhoto._pendingFileId;
            let displayUrl = pendingPhoto.displayUrl || pendingPhoto.url || pendingPhoto.thumbnailUrl;
            let hasAnnotations = !!(pendingPhoto.Drawings || pendingPhoto.drawings);
            
            // CRITICAL FIX: Check for cached annotated image
            // This ensures annotations show in thumbnails for pending photos on reload
            try {
              const cachedAnnotatedImage = await this.indexedDb.getCachedAnnotatedImage(photoId);
              if (cachedAnnotatedImage) {
                console.log('[RoomElevation] ✅ Found cached annotated image for pending photo:', photoId);
                displayUrl = cachedAnnotatedImage;
                hasAnnotations = true;
              }
            } catch (cacheErr) {
              console.warn('[RoomElevation] Error checking cached annotated image:', cacheErr);
            }
            
            const pendingPhotoData: any = {
              attachId: photoId,
              photoType: pendingPhoto.Type || pendingPhoto.photoType || 'Measurement',
              url: pendingPhoto.url || pendingPhoto.thumbnailUrl || displayUrl,
              displayUrl: displayUrl,
              caption: pendingPhoto.caption || pendingPhoto.Annotation || pendingPhoto.annotation || '',
              Annotation: pendingPhoto.caption || pendingPhoto.Annotation || pendingPhoto.annotation || '',
              drawings: pendingPhoto.Drawings || pendingPhoto.drawings || null,
              Drawings: pendingPhoto.Drawings || pendingPhoto.drawings || null,
              hasAnnotations: hasAnnotations,
              uploading: false,
              queued: true,
              isPending: true,
              _tempId: photoId,
              _localUpdate: !!(pendingPhoto.Drawings || pendingPhoto.drawings || pendingPhoto.caption),
            };
            pointData.photos.push(pendingPhotoData);
          }
        }

        console.log(`[RoomElevation] Point "${templatePoint.name}" complete:`, {
          pointId: pointData.pointId,
          value: pointData.value,
          photoCount: pointData.photos.length
        });

        this.roomData.elevationPoints.push(pointData);
      }

      // STEP 5.5: Auto-create database records for template points that don't exist yet
      // This ensures points have a pointId so photo buttons are enabled
      console.log('\n[RoomElevation] STEP 5.5: Auto-creating missing point records in database...');
      console.log('[RoomElevation] Current roomId:', this.roomId);
      console.log('[RoomElevation] Total points in elevationPoints array:', this.roomData.elevationPoints.length);

      const pointsNeedingCreation = this.roomData.elevationPoints.filter((p: any) => !p.pointId);
      console.log(`[RoomElevation] Found ${pointsNeedingCreation.length} points without database records`);

      if (pointsNeedingCreation.length > 0) {
        console.log('[RoomElevation] Points needing creation:', pointsNeedingCreation.map((p: any) => ({ name: p.name, pointId: p.pointId })));

        for (const point of pointsNeedingCreation) {
          try {
            console.log(`[RoomElevation]   Creating database record for: "${point.name}"...`);

            // For temp room IDs, pass the temp ID as EFEID for dependency resolution
            // For real room IDs, parse as integer for the API
            const isTempRoom = String(this.roomId).startsWith('temp_');
            const newPointData = {
              EFEID: isTempRoom ? this.roomId : parseInt(this.roomId, 10),
              PointName: point.name
            };

            console.log('[RoomElevation]     Request data:', newPointData, 'isTempRoom:', isTempRoom);

            // OFFLINE-FIRST: Use foundationData.createEFEPoint which queues for background sync
            const response = await this.foundationData.createEFEPoint(newPointData, isTempRoom ? this.roomId : undefined);
            console.log('[RoomElevation]     Response received:', response);

            const newPointId = response?.PointID || response?.PK_ID || response?._tempId;

            if (newPointId) {
              point.pointId = newPointId;
              point._tempId = response._tempId;
              point._syncing = response._syncing;
              console.log(`[RoomElevation]     âœ“ Created with PointID: ${newPointId}`);
              console.log(`[RoomElevation]     Point now has pointId:`, point.pointId);
            } else {
              console.error(`[RoomElevation]     âŒ Failed to get PointID from response:`, response);
            }
          } catch (error) {
            console.error(`[RoomElevation]     âŒ Error creating point "${point.name}":`, error);
            console.error('[RoomElevation]     Error details:', error);
          }
        }

        // Trigger change detection after creating all points
        console.log('[RoomElevation] Triggering change detection after point creation...');
        this.changeDetectorRef.detectChanges();
      }
      console.log('[RoomElevation] âœ“ Auto-creation complete');
      console.log('[RoomElevation] Final point status:', this.roomData.elevationPoints.map((p: any) => ({
        name: p.name,
        pointId: p.pointId,
        isReady: !!p.pointId
      })));

      // STEP 6: Add any custom points from database that weren't in the template
      // This matches the original behavior where custom points are added dynamically
      console.log('\n[RoomElevation] STEP 6: Checking for custom points not in template...');
      if (existingPoints && existingPoints.length > 0) {
        for (const existingPoint of existingPoints) {
          const pointId = existingPoint.PointID || existingPoint.PK_ID;

          // Check if this point was already added from template
          const alreadyAdded = this.roomData.elevationPoints.find(
            (p: any) => p.pointId === pointId
          );

          if (!alreadyAdded) {
            console.log(`[RoomElevation]   Found custom point not in template: "${existingPoint.PointName}"`);

            // This is a custom point not in the template - add it
            const customPointData: any = {
              pointNumber: null,
              name: existingPoint.PointName,
              pointId: pointId,
              value: existingPoint.Elevation || '',
              photos: [],
              isCustom: true
            };

            // Load photos for custom point
            const pointIdStr = String(pointId);
            // CRITICAL FIX: Use String() conversion to avoid type mismatch when comparing IDs
            const pointAttachments = attachments.filter((att: any) => String(att.PointID) === pointIdStr);
            console.log(`[RoomElevation]     Found ${pointAttachments.length} attachments for custom point (ID: ${pointIdStr})`);

            for (const attach of pointAttachments) {
              // CRITICAL: Database column is "Type", not "PhotoType"
              const photoType = attach.Type || 'Measurement';
              const attachIdStr = String(attach.AttachID || attach.PK_ID);
              console.log(`[RoomElevation]       Processing attachment: Type=${photoType}, ID=${attachIdStr}`);

              // CRITICAL FIX: Check for duplicate before adding - use String() conversion for consistent comparison
              const alreadyExists = customPointData.photos.some((p: any) => 
                String(p.attachId) === attachIdStr
              );
              
              if (alreadyExists) {
                console.log(`[RoomElevation]       Skipping duplicate attachment: ${attachIdStr}`);
                continue;
              }

              const EMPTY_COMPRESSED_ANNOTATIONS = 'H4sIAAAAAAAAA6tWKkktLlGyUlAqS8wpTtVRKi1OLYrPTFGyUqoFAJRGGIYcAAAA';
              const photoData: any = {
                attachId: attach.AttachID || attach.PK_ID,
                photoType: photoType,
                url: null,
                displayUrl: null,
                caption: attach.Annotation || '',
                drawings: attach.Drawings || null,
                hasAnnotations: !!(attach.Drawings && attach.Drawings !== 'null' && attach.Drawings !== '' && attach.Drawings !== EMPTY_COMPRESSED_ANNOTATIONS),
                path: attach.Attachment || attach.Photo || null,
                Attachment: attach.Attachment,
                Photo: attach.Photo,
                uploading: false
              };

              // Set loading state for all photos
              const hasS3Key = attach.Attachment && this.caspioService.isS3Key(attach.Attachment);
              const hasPhotoPath = !!attach.Photo;
              
              if (hasS3Key || hasPhotoPath) {
                photoData.url = 'assets/img/photo-placeholder.png';
                photoData.displayUrl = 'assets/img/photo-placeholder.png';
                photoData.loading = true;
                console.log(`[RoomElevation]         Setting photo to loading state (S3: ${hasS3Key})`);
              }

              customPointData.photos.push(photoData);

              // Load the actual image in background (non-blocking)
              // CRITICAL FIX: Always use loadPointPhotoImage which fetches as data URL and caches
              // This ensures fabric.js can use the image without CORS issues
              if (hasS3Key || hasPhotoPath) {
                this.loadPointPhotoImage(attach.Photo || attach.Attachment, photoData).catch(err => {
                  console.error(`[RoomElevation]         âŒ Error loading photo:`, err);
                });
              }
            }

            console.log(`[RoomElevation]     âœ“ Custom point "${existingPoint.PointName}" added:`, {
              pointId: customPointData.pointId,
              value: customPointData.value,
              photoCount: customPointData.photos.length
            });

            this.roomData.elevationPoints.push(customPointData);
          }
        }
      }
      console.log('[RoomElevation] âœ“ Custom points check complete');

      console.log('\n========================================');
      console.log('[RoomElevation] *** LOAD ELEVATION POINTS - COMPLETE ***');
      console.log('[RoomElevation] Total elevation points:', this.roomData.elevationPoints.length);
      console.log('[RoomElevation] Final elevationPoints array:', this.roomData.elevationPoints);
      console.log('========================================\n');

      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('[RoomElevation] âŒâŒâŒ CRITICAL ERROR in loadElevationPoints:', error);
      console.error('[RoomElevation] Error stack:', error);
    }
  }

  private async loadFDFOptions() {
    try {
      console.log('[RoomElevation] Loading FDF options (OFFLINE-FIRST)...');
      // OFFLINE-FIRST: Use offlineTemplate which reads from IndexedDB first
      const options = await this.offlineTemplate.getEFEDropOptions();
      console.log('[RoomElevation] FDF options loaded:', options?.length || 0, 'options');
      console.log('[RoomElevation] Options type:', typeof options);
      console.log('[RoomElevation] Options is array?', Array.isArray(options));
      console.log('[RoomElevation] Options length:', options?.length);

      if (options && options.length > 0) {
        console.log('[RoomElevation] First option:', options[0]);
        console.log('[RoomElevation] Keys in first option:', Object.keys(options[0]));

        // Try to extract FDF values from all possible field names
        const possibleFieldNames = ['Dropdown', 'FDF', 'fdf', 'Fdf', 'Value', 'value', 'Name', 'name', 'Option', 'option'];
        let extractedOptions: string[] = [];

        for (const fieldName of possibleFieldNames) {
          const testOptions = options.map((opt: any) => opt[fieldName]).filter((val: any) => val && typeof val === 'string' && val.trim() !== '');
          if (testOptions.length > 0) {
            console.log(`[RoomElevation] Found ${testOptions.length} options using field name: ${fieldName}`);
            extractedOptions = testOptions;
            break;
          }
        }

        if (extractedOptions.length > 0) {
          this.fdfOptions = extractedOptions;
          console.log('[RoomElevation] Successfully loaded FDF options:', this.fdfOptions);
          console.log('[RoomElevation] FDF options count:', this.fdfOptions.length);
        } else {
          console.error('[RoomElevation] Could not extract FDF options from any known field name');
          console.error('[RoomElevation] Available fields in first record:', Object.keys(options[0]));
          // Fallback: try to get any string values
          const allStringValues = Object.entries(options[0])
            .filter(([key, value]) => typeof value === 'string' && value.trim() !== '')
            .map(([key, value]) => `${key}: ${value}`);
          console.error('[RoomElevation] String values in first record:', allStringValues);
        }

        // Trigger change detection
        this.changeDetectorRef.detectChanges();
      } else {
        console.warn('[RoomElevation] No FDF options returned from database or empty array');
        console.warn('[RoomElevation] Options value:', options);
        console.warn('[RoomElevation] Options === null?', options === null);
        console.warn('[RoomElevation] Options === undefined?', options === undefined);
        console.warn('[RoomElevation] Options === []?', JSON.stringify(options) === '[]');
      }
    } catch (error) {
      console.error('[RoomElevation] Error loading FDF options:', error);
      console.error('[RoomElevation] Error stack:', error);
    }
  }

  // ============================================
  // TEMP ID RESOLUTION HELPER
  // ============================================

  /**
   * Resolve room ID - handles temp IDs by checking if real ID is available
   * Returns the ID to use and whether it's still a temp ID
   */
  private async resolveRoomId(): Promise<{ id: string; isTempId: boolean }> {
    if (!this.roomId) {
      throw new Error('No room ID available');
    }

    if (!String(this.roomId).startsWith('temp_')) {
      return { id: this.roomId, isTempId: false };
    }

    // Try to resolve real ID from IndexedDB
    const realId = await this.indexedDb.getRealId(this.roomId);
    if (realId) {
      console.log('[RoomElevation] Resolved temp ID to real ID:', this.roomId, '->', realId);
      // Update local roomId reference for future calls
      this.roomId = realId;
      return { id: realId, isTempId: false };
    }

    console.log('[RoomElevation] Room still has temp ID, update will be queued:', this.roomId);
    return { id: this.roomId, isTempId: true };
  }

  // FDF Methods
  async onFDFChange() {
    if (!this.roomId) return;

    this.isSavingFdf = true;
    try {
      const { id, isTempId } = await this.resolveRoomId();

      // CRITICAL: Always update local IndexedDB cache first for offline-first behavior
      // This ensures the FDF value persists even if offline
      await this.updateLocalEFECache({ FDF: this.roomData.fdf });

      if (isTempId) {
        // Queue for background sync - room not synced yet
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=DEFERRED`,
          method: 'PUT',
          data: { FDF: this.roomData.fdf, _tempEfeId: this.roomId },
          dependencies: [this.roomId],
          status: 'pending',
          priority: 'normal'
        });
        console.log('[RoomElevation] FDF update queued for sync (room not yet synced)');
        return;
      }

      // Check if online - if offline, queue for background sync
      if (!this.offlineService.isOnline()) {
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=${id}`,
          method: 'PUT',
          data: { FDF: this.roomData.fdf },
          dependencies: [],
          status: 'pending',
          priority: 'normal'
        });
        console.log('[RoomElevation] FDF update queued for sync (offline)');
        return;
      }

      // Online with real ID - make direct API call
      try {
        await this.caspioService.updateServicesEFEByEFEID(id, { FDF: this.roomData.fdf }).toPromise();
        console.log('[RoomElevation] FDF saved to server');
      } catch (apiError) {
        // API call failed (network error, etc.) - queue for background sync
        console.warn('[RoomElevation] FDF API call failed, queuing for sync:', apiError);
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=${id}`,
          method: 'PUT',
          data: { FDF: this.roomData.fdf },
          dependencies: [],
          status: 'pending',
          priority: 'normal'
        });
      }
    } catch (error) {
      console.error('Error saving FDF:', error);
    } finally {
      this.isSavingFdf = false;
      this.changeDetectorRef.detectChanges();
    }
  }
  
  /**
   * Update local IndexedDB cache for EFE room data
   * This ensures offline changes are persisted locally
   */
  private async updateLocalEFECache(updates: any): Promise<void> {
    try {
      // Get current cached rooms for this service
      const cachedRooms = await this.indexedDb.getCachedServiceData(this.serviceId, 'efe_rooms') || [];
      
      // Find and update the current room
      const roomIndex = cachedRooms.findIndex((r: any) => 
        r.EFEID === this.roomId || r.PK_ID === this.roomId || r._tempId === this.roomId
      );
      
      if (roomIndex >= 0) {
        cachedRooms[roomIndex] = {
          ...cachedRooms[roomIndex],
          ...updates,
          _localUpdate: true  // Mark as having local updates
        };
        
        await this.indexedDb.cacheServiceData(this.serviceId, 'efe_rooms', cachedRooms);
        console.log('[RoomElevation] Local EFE cache updated with:', updates);
      } else {
        console.warn('[RoomElevation] Room not found in local cache, cannot update');
      }
    } catch (error) {
      console.error('[RoomElevation] Error updating local EFE cache:', error);
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
      const { id, isTempId } = await this.resolveRoomId();

      // CRITICAL: Always update local IndexedDB cache first for offline-first behavior
      await this.updateLocalEFECache({ Location: this.roomData.location });

      if (isTempId) {
        // Queue for background sync - room not synced yet
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=DEFERRED`,
          method: 'PUT',
          data: { Location: this.roomData.location, _tempEfeId: this.roomId },
          dependencies: [this.roomId],
          status: 'pending',
          priority: 'normal'
        });
        console.log('[RoomElevation] Location update queued for sync (room not yet synced)');
        return;
      }

      // Check if online - if offline, queue for background sync
      if (!this.offlineService.isOnline()) {
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=${id}`,
          method: 'PUT',
          data: { Location: this.roomData.location },
          dependencies: [],
          status: 'pending',
          priority: 'normal'
        });
        console.log('[RoomElevation] Location update queued for sync (offline)');
        return;
      }

      // Online with real ID - make direct API call
      try {
        await this.caspioService.updateServicesEFEByEFEID(id, { Location: this.roomData.location }).toPromise();
        console.log('[RoomElevation] Location saved to server');
      } catch (apiError) {
        console.warn('[RoomElevation] Location API call failed, queuing for sync:', apiError);
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=${id}`,
          method: 'PUT',
          data: { Location: this.roomData.location },
          dependencies: [],
          status: 'pending',
          priority: 'normal'
        });
      }
    } catch (error) {
      console.error('Error saving location:', error);
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
      const { id, isTempId } = await this.resolveRoomId();

      // CRITICAL: Always update local IndexedDB cache first for offline-first behavior
      await this.updateLocalEFECache({ Notes: this.roomData.notes });

      if (isTempId) {
        // Queue for background sync - room not synced yet
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=DEFERRED`,
          method: 'PUT',
          data: { Notes: this.roomData.notes, _tempEfeId: this.roomId },
          dependencies: [this.roomId],
          status: 'pending',
          priority: 'normal'
        });
        console.log('[RoomElevation] Notes update queued for sync (room not yet synced)');
        return;
      }

      // Check if online - if offline, queue for background sync
      if (!this.offlineService.isOnline()) {
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=${id}`,
          method: 'PUT',
          data: { Notes: this.roomData.notes },
          dependencies: [],
          status: 'pending',
          priority: 'normal'
        });
        console.log('[RoomElevation] Notes update queued for sync (offline)');
        return;
      }

      // Online with real ID - make direct API call
      try {
        await this.caspioService.updateServicesEFEByEFEID(id, { Notes: this.roomData.notes }).toPromise();
        console.log('[RoomElevation] Notes saved to server');
      } catch (apiError) {
        console.warn('[RoomElevation] Notes API call failed, queuing for sync:', apiError);
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=${id}`,
          method: 'PUT',
          data: { Notes: this.roomData.notes },
          dependencies: [],
          status: 'pending',
          priority: 'normal'
        });
      }
    } catch (error) {
      console.error('Error saving notes:', error);
    } finally {
      this.isSavingNotes = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  // FDF Photo Methods
  // Take FDF photo from camera - EXACT implementation from engineers-foundation
  async takeFDFPhotoCamera(photoType: 'Top' | 'Bottom' | 'Threshold') {
    if (!this.roomId) {
      // Toast removed per user request
      // await this.showToast('Please save the room first', 'warning');
      return;
    }

    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera
      });

      if (image.webPath) {
        const response = await fetch(image.webPath);
        const blob = await response.blob();
        const file = new File([blob], `fdf-${photoType.toLowerCase()}-${Date.now()}.jpg`, { type: 'image/jpeg' });

        await this.processFDFPhoto(file, photoType);
      }
    } catch (error) {
      if (error !== 'User cancelled photos app') {
        console.error('Error taking camera photo:', error);
        // Toast removed per user request
        // await this.showToast('Failed to capture photo', 'danger');
      }
    }
  }

  // Take FDF photo from gallery - EXACT implementation from engineers-foundation
  async takeFDFPhotoGallery(photoType: 'Top' | 'Bottom' | 'Threshold') {
    if (!this.roomId) {
      // Toast removed per user request
      // await this.showToast('Please save the room first', 'warning');
      return;
    }

    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Photos
      });

      if (image.webPath) {
        const response = await fetch(image.webPath);
        const blob = await response.blob();
        const file = new File([blob], `fdf-${photoType.toLowerCase()}-${Date.now()}.jpg`, { type: 'image/jpeg' });

        await this.processFDFPhoto(file, photoType);
      }
    } catch (error) {
      if (error !== 'User cancelled photos app') {
        console.error('Error selecting gallery photo:', error);
        // Toast removed per user request
        // await this.showToast('Failed to select photo', 'danger');
      }
    }
  }

  // Process FDF photo - OFFLINE-FIRST: Show immediately, upload in background via S3
  private async processFDFPhoto(file: File, photoType: 'Top' | 'Bottom' | 'Threshold') {
    const photoKey = photoType.toLowerCase();
    const fdfPhotos = this.roomData.fdfPhotos;

    console.log(`[FDF Upload S3] Processing photo: ${photoType} (offline-first)`);

    try {
      // Initialize fdfPhotos structure if needed
      if (!fdfPhotos) {
        this.roomData.fdfPhotos = {};
      }

      // Revoke old blob URL if it exists (prevent memory leaks)
      const oldUrl = fdfPhotos[`${photoKey}Url`];
      if (oldUrl && oldUrl.startsWith('blob:')) {
        URL.revokeObjectURL(oldUrl);
        console.log(`[FDF Upload S3] Revoked old blob URL for ${photoType}`);
      }

      // CRITICAL: Create blob URL FIRST for INSTANT display (synchronous, no delay)
      const blobUrl = URL.createObjectURL(file);
      
      // Create temp ID for tracking
      const tempId = `temp_fdf_${photoType.toLowerCase()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Set photo data immediately - NO loading spinner, NO uploading spinner - instant display
      fdfPhotos[photoKey] = true;
      fdfPhotos[`${photoKey}Url`] = blobUrl;
      fdfPhotos[`${photoKey}DisplayUrl`] = blobUrl;
      fdfPhotos[`${photoKey}Caption`] = fdfPhotos[`${photoKey}Caption`] || '';
      fdfPhotos[`${photoKey}Drawings`] = fdfPhotos[`${photoKey}Drawings`] || null;
      fdfPhotos[`${photoKey}Loading`] = false;  // CRITICAL: Clear loading to show the photo
      fdfPhotos[`${photoKey}Uploading`] = false; // CRITICAL: No spinner - photo appears instantly (offline-first)
      fdfPhotos[`${photoKey}TempId`] = tempId;
      fdfPhotos[`${photoKey}Queued`] = true;  // Show queued badge instead of spinner

      // Trigger change detection to show preview IMMEDIATELY
      this.changeDetectorRef.detectChanges();
      console.log(`[FDF Upload S3] Photo displayed INSTANTLY with blob URL, temp ID: ${tempId}`);
      
      // Convert to base64 in background for IndexedDB storage (non-blocking)
      const base64Image = await this.convertFileToBase64(file);
      
      // Update URLs to base64 for better persistence (blob URLs don't survive page reload)
      fdfPhotos[`${photoKey}Url`] = base64Image;
      fdfPhotos[`${photoKey}DisplayUrl`] = base64Image;
      this.changeDetectorRef.detectChanges();

      // Store file in IndexedDB for persistence across page navigations
      await this.indexedDb.storePhotoFile(
        tempId,
        file,
        this.roomId,
        fdfPhotos[`${photoKey}Caption`] || '',
        fdfPhotos[`${photoKey}Drawings`] || ''
      );
      console.log(`[FDF Upload S3] Stored file in IndexedDB for background upload`);

      // Queue the upload as a pending request for background sync
      // Use UPLOAD_FILE type with FDF metadata in data field
      await this.indexedDb.addPendingRequest({
        type: 'UPLOAD_FILE',
        endpoint: `FDF_PHOTO_${photoType}_${this.roomId}`,
        method: 'POST',
        data: {
          roomId: this.roomId,
          photoType: photoType,
          tempFileId: tempId,
          isFDFPhoto: true  // Marker to identify FDF photo uploads
        },
        dependencies: [],  // No dependencies for FDF photo uploads
        status: 'pending',
        priority: 'high'
      });
      console.log(`[FDF Upload S3] Queued upload request for background sync`);

      // If online, trigger immediate upload
      if (this.offlineService.isOnline()) {
        console.log(`[FDF Upload S3] Online - triggering immediate upload`);
        this.uploadFDFPhotoToS3(photoType, file, tempId).catch(err => {
          console.error(`[FDF Upload S3] Background upload failed:`, err);
        });
      } else {
        console.log(`[FDF Upload S3] Offline - upload will happen when online`);
      }

    } catch (error: any) {
      console.error(`[FDF Upload S3] Error processing FDF ${photoType} photo:`, error);

      // Clear photo on error
      fdfPhotos[`${photoKey}Uploading`] = false;
      fdfPhotos[`${photoKey}Queued`] = false;
      delete fdfPhotos[photoKey];
      delete fdfPhotos[`${photoKey}Url`];
      delete fdfPhotos[`${photoKey}DisplayUrl`];

      this.changeDetectorRef.detectChanges();
    }
  }

  // Upload FDF photo to S3 - mirrors other photo uploads in the application
  private async uploadFDFPhotoToS3(photoType: 'Top' | 'Bottom' | 'Threshold', file: File, tempId: string): Promise<any> {
    console.log(`[FDF Upload S3] Starting S3 upload for ${photoType}`);

    if (!this.roomId) {
      throw new Error(`Room not ready for upload`);
    }

    const photoKey = photoType.toLowerCase();
    const fdfPhotos = this.roomData.fdfPhotos;

    try {
      // Compress the image
      const compressedFile = await this.imageCompression.compressImage(file);
      console.log(`[FDF Upload S3] Compressed ${photoType} image`);

      // Generate unique filename for S3
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 8);
      const fileExt = file.name.split('.').pop() || 'jpg';
      const uniqueFilename = `fdf_${photoType.toLowerCase()}_${this.roomId}_${timestamp}_${randomId}.${fileExt}`;

      // Upload to S3 via API Gateway
      const formData = new FormData();
      formData.append('file', compressedFile, uniqueFilename);
      formData.append('tableName', 'LPS_Services_EFE');
      formData.append('attachId', this.roomId);

      const uploadUrl = `${environment.apiGatewayUrl}/api/s3/upload`;
      console.log(`[FDF Upload S3] Uploading to S3: ${uploadUrl}`);
      
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        body: formData
      });

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error(`[FDF Upload S3] S3 upload failed:`, errorText);
        throw new Error('Failed to upload file to S3: ' + errorText);
      }

      const uploadResult = await uploadResponse.json();
      const s3Key = uploadResult.s3Key;
      console.log(`[FDF Upload S3] Uploaded to S3 with key: ${s3Key}`);

      // Update the room record with S3 key in the new Attachment column
      const attachmentColumnName = `FDFPhoto${photoType}Attachment`;
      const updateData: any = {};
      updateData[attachmentColumnName] = s3Key;

      await this.caspioService.updateServicesEFEByEFEID(this.roomId, updateData).toPromise();
      console.log(`[FDF Upload S3] Updated room record with S3 key in ${attachmentColumnName}`);

      // Update local state - clear uploading flags
      fdfPhotos[`${photoKey}Uploading`] = false;
      fdfPhotos[`${photoKey}Queued`] = false;
      fdfPhotos[`${photoKey}Path`] = s3Key;
      fdfPhotos[`${photoKey}Attachment`] = s3Key;
      delete fdfPhotos[`${photoKey}TempId`];

      // Remove from pending requests
      const pendingRequests = await this.indexedDb.getPendingRequests();
      for (const req of pendingRequests) {
        if (req.type === 'UPLOAD_FILE' && req.data?.isFDFPhoto && req.data?.tempFileId === tempId) {
          await this.indexedDb.removePendingRequest(req.requestId);
          console.log(`[FDF Upload S3] Removed pending request for ${tempId}`);
        }
      }

      // Note: Stored photo data in IndexedDB will be cleaned up automatically by storePhotoFile
      // when overwritten, or can be cleaned up separately if needed
      console.log(`[FDF Upload S3] Upload complete for ${tempId}`);

      this.changeDetectorRef.detectChanges();
      console.log(`[FDF Upload S3] Completed ${photoType}`);

      return { s3Key, success: true };
    } catch (error) {
      console.error(`[FDF Upload S3] Error uploading ${photoType}:`, error);
      // Don't clear the photo - it's still displayed and queued for retry
      fdfPhotos[`${photoKey}Uploading`] = false;
      this.changeDetectorRef.detectChanges();
      throw error;
    }
  }

  // Helper method to convert File or Blob to base64 string
  private async convertFileToBase64(file: File | Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        const base64Image = e.target.result;
        resolve(base64Image);
      };
      reader.onerror = (error) => {
        reject(error);
      };
      reader.readAsDataURL(file);
    });
  }

  async annotateFDFPhoto(photoType: 'Top' | 'Bottom' | 'Threshold') {
    const photoKey = photoType.toLowerCase();
    const fdfPhotos = this.roomData.fdfPhotos;

    try {
      // CRITICAL FIX: Wait for photo to load if still loading
      if (fdfPhotos[`${photoKey}Loading`]) {
        console.log('[FDF Annotate] Photo still loading, waiting...');
        const startTime = Date.now();
        while (fdfPhotos[`${photoKey}Loading`] && (Date.now() - startTime) < 10000) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (fdfPhotos[`${photoKey}Loading`]) {
          console.warn('[FDF Annotate] Photo loading timed out');
        }
      }

      // CRITICAL FIX: Get image as data URL to avoid CORS issues in Fabric.js canvas
      let photoUrl = fdfPhotos[`${photoKey}Url`];
      const s3Key = fdfPhotos[`${photoKey}Path`];
      const cacheId = `fdf_${this.roomId}_${photoKey}`;
      
      // ALWAYS try IndexedDB cache first - it stores data URLs which work with canvas
      console.log('[FDF Annotate] Checking IndexedDB cache for:', cacheId);
      const cachedDataUrl = await this.indexedDb.getCachedPhoto(cacheId);
      if (cachedDataUrl && cachedDataUrl.startsWith('data:')) {
        console.log('[FDF Annotate] ✅ Using cached data URL from IndexedDB');
        photoUrl = cachedDataUrl;
      }
      
      // If still no valid data URL and we have an S3 path, fetch and cache it
      if ((!photoUrl || photoUrl === 'assets/img/photo-placeholder.png' || photoUrl.startsWith('https://')) && s3Key) {
        if (this.caspioService.isS3Key(s3Key)) {
          console.log('[FDF Annotate] Fetching S3 image as data URL via XMLHttpRequest:', s3Key);
          try {
            // Get pre-signed S3 URL first
            const s3Url = await this.caspioService.getS3FileUrl(s3Key);
            
            // Fetch image as base64 data URL using XMLHttpRequest (avoids CORS issues with fabric.js canvas)
            photoUrl = await this.fetchS3ImageAsDataUrl(s3Url);
            
            if (photoUrl && photoUrl.startsWith('data:')) {
              fdfPhotos[`${photoKey}Url`] = photoUrl;
              fdfPhotos[`${photoKey}DisplayUrl`] = photoUrl;
              // Cache for future use
              await this.indexedDb.cachePhoto(cacheId, this.serviceId, photoUrl, s3Key);
              console.log('[FDF Annotate] ✅ Got data URL via XMLHttpRequest');
            }
          } catch (err) {
            console.error('[FDF Annotate] Failed to fetch S3 image:', err);
          }
        }
      }

      if (!photoUrl || photoUrl === 'assets/img/photo-placeholder.png') {
        console.warn('[FDF Annotate] No valid image URL available');
        return;
      }
      // CRITICAL: Decompress existing annotations before opening modal - EXACT pattern from structural-systems
      let existingAnnotations: any = null;
      const compressedDrawings = fdfPhotos[`${photoKey}Drawings`];

      if (compressedDrawings && compressedDrawings !== 'H4sIAAAAAAAAA6tWKkktLlGyUlAqS8wpTtVRKi1OLYrPTFGyUqoFAJRGGIYcAAAA') {
        try {
          console.log('[FDF Annotate] Decompressing existing annotations, length:', compressedDrawings.length);
          // Using static import for offline support
          existingAnnotations = decompressAnnotationData(compressedDrawings);
          console.log('[FDF Annotate] Decompressed annotations:', existingAnnotations ? 'SUCCESS' : 'FAILED');
          if (existingAnnotations && existingAnnotations.objects) {
            console.log('[FDF Annotate] Found', existingAnnotations.objects.length, 'annotation objects');
          }
        } catch (e) {
          console.error('[FDF Annotate] Error decompressing annotations:', e);
        }
      }

      const existingCaption = fdfPhotos[`${photoKey}Caption`] || '';

      // Open FabricPhotoAnnotatorComponent - EXACT pattern from structural-systems
      const modal = await this.modalController.create({
        component: FabricPhotoAnnotatorComponent,
        componentProps: {
          imageUrl: photoUrl,
          existingAnnotations: existingAnnotations,
          existingCaption: existingCaption,
          photoData: {
            id: `fdf_${photoType}`,
            caption: existingCaption
          },
          isReEdit: !!existingAnnotations
        },
        cssClass: 'fullscreen-modal'
      });

      await modal.present();
      const { data } = await modal.onWillDismiss();

      if (!data) {
        // User cancelled
        return;
      }

      if (data && data.annotatedBlob) {
        // Update photo with new annotations - EXACT pattern from structural-systems
        const annotatedBlob = data.blob || data.annotatedBlob;
        const annotationsData = data.annotationData || data.annotationsData;

        // Save annotations to database FIRST
        const compressedDrawings = await this.saveFDFAnnotationToDatabase(
          this.roomId,
          photoType,
          annotatedBlob,
          annotationsData,
          data.caption || ''
        );

        // CRITICAL: Create blob URL for the annotated image (for display only)
        const newUrl = URL.createObjectURL(annotatedBlob);

        // Update local state with IMMUTABLE pattern - EXACT from structural-systems
        fdfPhotos[`${photoKey}Drawings`] = compressedDrawings;
        fdfPhotos[`${photoKey}Caption`] = data.caption !== undefined ? data.caption : existingCaption;
        fdfPhotos[`${photoKey}DisplayUrl`] = newUrl;
        fdfPhotos[`${photoKey}HasAnnotations`] = !!annotationsData;

        console.log('[FDF SAVE] Updated photo with compressed drawings, length:', compressedDrawings?.length || 0);

        this.changeDetectorRef.detectChanges();
        // Toast removed per user request
        // await this.showToast('Annotation saved', 'success');
      }
    } catch (error) {
      console.error('Error annotating photo:', error);
      // Toast removed per user request
      // await this.showToast('Failed to save annotation', 'danger');
    }
  }

  async deleteFDFPhoto(photoType: 'Top' | 'Bottom' | 'Threshold', event: Event) {
    event.stopPropagation();

    const alert = await this.alertController.create({
      header: 'Delete Photo',
      message: `Are you sure you want to delete the ${photoType} photo?`,
      buttons: [
        {
          text: 'Delete',
          handler: async () => {
            // OFFLINE-FIRST: Immediate UI update, queue delete for sync if offline
            const photoKey = photoType.toLowerCase();
            
            // Clear local state IMMEDIATELY (optimistic update)
            const fdfPhotos = this.roomData.fdfPhotos;
            fdfPhotos[`${photoKey}`] = null;
            fdfPhotos[`${photoKey}Url`] = null;
            fdfPhotos[`${photoKey}DisplayUrl`] = null;
            fdfPhotos[`${photoKey}Path`] = null;
            fdfPhotos[`${photoKey}Attachment`] = null;
            fdfPhotos[`${photoKey}Caption`] = '';
            fdfPhotos[`${photoKey}Drawings`] = null;
            fdfPhotos[`${photoKey}HasAnnotations`] = false;
            fdfPhotos[`${photoKey}Loading`] = false;
            fdfPhotos[`${photoKey}Uploading`] = false;

            // Force UI update first
            this.changeDetectorRef.detectChanges();

            // Clear cached photo from IndexedDB
            const cacheId = `fdf_${this.roomId}_${photoKey}`;
            await this.indexedDb.deleteCachedPhoto(cacheId);
            console.log('[FDF Delete] Cleared cached photo from IndexedDB:', cacheId);

            // CRITICAL: Clear all related columns
            const updateData: any = {};
            updateData[`FDFPhoto${photoType}`] = null;
            updateData[`FDFPhoto${photoType}Attachment`] = null;
            updateData[`FDF${photoType}Annotation`] = null;
            updateData[`FDF${photoType}Drawings`] = null;

            try {
              // Delete from database (or queue for sync if offline)
              const apiEndpoint = `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID='${this.roomId}'`;
              
              if (this.offlineService.isOnline()) {
                try {
                  await this.caspioService.updateServicesEFEByEFEID(this.roomId, updateData).toPromise();
                  console.log('[FDF Delete] Deleted from database');
                } catch (apiError) {
                  console.warn('[FDF Delete] API delete failed, queuing for sync:', apiError);
                  await this.indexedDb.addPendingRequest({
                    type: 'UPDATE',
                    endpoint: apiEndpoint,
                    method: 'PUT',
                    data: updateData,
                    dependencies: [],
                    status: 'pending',
                    priority: 'high',
                  });
                  this.backgroundSync.triggerSync();
                }
              } else {
                console.log('[FDF Delete] Offline - queuing delete for sync');
                await this.indexedDb.addPendingRequest({
                  type: 'UPDATE',
                  endpoint: apiEndpoint,
                  method: 'PUT',
                  data: updateData,
                  dependencies: [],
                  status: 'pending',
                  priority: 'high',
                });
                this.backgroundSync.triggerSync();
              }
              
              console.log('[FDF Delete] Photo removed successfully');
            } catch (error) {
              console.error('Error deleting photo:', error);
            }
          }
        },
        {
          text: 'Cancel',
          role: 'cancel'
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
    const currentCaption = fdfPhotos[`${photoKey}Caption`] || '';

    try {
      // Use the full caption editor with preset buttons (matching FabricPhotoAnnotatorComponent)
      const newCaption = await this.openCaptionEditorPopup(currentCaption);
      
      if (newCaption !== null) { // User didn't cancel
        // OFFLINE-FIRST: Save caption using the common method
        await this.saveFDFCaption(photoType, newCaption);
      }
    } catch (chunkError: any) {
      // Handle ChunkLoadError - use native prompt as fallback
      console.error('[FDF Caption] Failed to create alert, using native fallback:', chunkError);
      
      const newCaption = window.prompt(`Enter caption for ${photoType} photo:`, currentCaption);
      
      if (newCaption !== null) {
        // OFFLINE-FIRST: Save caption using the common method
        await this.saveFDFCaption(photoType, newCaption);
      }
    }
  }

  /**
   * OFFLINE-FIRST: Save FDF caption locally first, then sync to backend
   */
  private async saveFDFCaption(photoType: 'Top' | 'Bottom' | 'Threshold', newCaption: string): Promise<void> {
    const photoKey = photoType.toLowerCase();
    const fdfPhotos = this.roomData.fdfPhotos;
    const columnName = `FDF${photoType}Annotation`;

    // 1. Update UI immediately
    fdfPhotos[`${photoKey}Caption`] = newCaption;
    this.changeDetectorRef.detectChanges();

    // 2. Update local IndexedDB cache
    const updateData: any = {};
    updateData[columnName] = newCaption;
    await this.updateLocalEFECache(updateData);

    // 3. Queue for backend sync
    try {
      const { id, isTempId } = await this.resolveRoomId();

      if (isTempId || !this.offlineService.isOnline()) {
        // Offline or temp room - queue for background sync
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: isTempId 
            ? `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=DEFERRED`
            : `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=${id}`,
          method: 'PUT',
          data: isTempId ? { ...updateData, _tempEfeId: this.roomId } : updateData,
          dependencies: isTempId ? [this.roomId] : [],
          status: 'pending',
          priority: 'normal'
        });
        console.log('[FDF Caption] Queued for sync');
      } else {
        // Online with real ID - try direct API call
        try {
          await this.caspioService.updateServicesEFEByEFEID(id, updateData).toPromise();
          console.log('[FDF Caption] Saved to server');
        } catch (apiError) {
          // API failed - queue for background sync
          console.warn('[FDF Caption] API call failed, queuing for sync:', apiError);
          await this.indexedDb.addPendingRequest({
            type: 'UPDATE',
            endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=${id}`,
            method: 'PUT',
            data: updateData,
            dependencies: [],
            status: 'pending',
            priority: 'normal'
          });
        }
      }
    } catch (error) {
      console.error('[FDF Caption] Error:', error);
    }
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
          text: 'Add',
          handler: (data) => {
            if (!data.pointName || !data.pointName.trim()) {
              this.showToast('Please enter a measurement name', 'warning');
              return false;
            }

            // Close the alert immediately and handle the operation in background
            this.handleAddPoint(data.pointName.trim());
            return true;
          }
        },
        {
          text: 'Cancel',
          role: 'cancel'
        }
      ],
      cssClass: 'custom-document-alert'
    });

    await alert.present();
  }

  private async handleAddPoint(pointName: string) {
    try {
      // OFFLINE-FIRST: Use foundationData.createEFEPoint which queues for background sync
      // For temp room IDs, pass the temp ID as EFEID for dependency resolution
      // For real room IDs, parse as integer for the API
      const isTempRoom = String(this.roomId).startsWith('temp_');
      const pointData = {
        EFEID: isTempRoom ? this.roomId : parseInt(this.roomId, 10),
        PointName: pointName
      };

      const response = await this.foundationData.createEFEPoint(
        pointData,
        isTempRoom ? this.roomId : undefined
      );
      const pointId = response?.PointID || response?.PK_ID || response?._tempId;

      if (pointId) {
        // Add to local array with offline sync status
        this.roomData.elevationPoints.push({
          pointId: pointId,
          name: pointName,
          value: '',
          photos: [],
          _tempId: response._tempId,
          _syncing: response._syncing
        });

        this.changeDetectorRef.detectChanges();
        console.log(`[RoomElevation] Point "${pointName}" created with ID: ${pointId}${response._tempId ? ' (pending sync)' : ''}`);
      }
    } catch (error) {
      console.error('Error adding point:', error);
      // Toast removed per user request
      // await this.showToast('Failed to add measurement', 'danger');
    }
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
              // Toast removed per user request
              // await this.showToast('Point name cannot be empty', 'warning');
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
              // Toast removed per user request
              // await this.showToast('Failed to update point name', 'danger');
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
              // Toast removed per user request
            } catch (error) {
              console.error('Error deleting point:', error);
              // Toast removed per user request
              // await this.showToast('Failed to delete point', 'danger');
            }
          }
        },
        {
          text: 'Cancel',
          role: 'cancel'
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
        // Toast removed per user request
        // await this.showToast('Failed to capture photo', 'danger');
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
        // Toast removed per user request
        // await this.showToast('Failed to select photo', 'danger');
      }
    }
  }

  private async processPointPhoto(webPath: string, point: any, photoType: 'Measurement' | 'Location') {
    try {
      // Convert to File
      const response = await fetch(webPath);
      const blob = await response.blob();
      const file = new File([blob], `point-${photoType.toLowerCase()}-${Date.now()}.jpg`, { type: 'image/jpeg' });

      // Check actual offline status
      const isActuallyOffline = !this.offlineService.isOnline();
      const isPointTempId = String(point.pointId).startsWith('temp_');
      const isOfflineMode = isActuallyOffline || isPointTempId;

      console.log(`[Point Photo] isActuallyOffline: ${isActuallyOffline}, isOfflineMode: ${isOfflineMode}`);

      // Find existing photo or create new one
      let existingPhoto = point.photos.find((p: any) => p.photoType === photoType);

      // Generate temp ID for tracking
      const tempPhotoId = `temp_efe_photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      if (existingPhoto) {
        // Update existing photo - NEVER show spinner, photo appears immediately
        existingPhoto.uploading = false;
        existingPhoto.queued = isOfflineMode;
        existingPhoto._backgroundSync = true;  // Silent background sync
        existingPhoto.url = webPath;
        existingPhoto.displayUrl = webPath;
        existingPhoto.originalUrl = webPath;
        // CRITICAL: Set all ID fields for annotation lookups
        existingPhoto.AttachID = tempPhotoId;
        existingPhoto.attachId = tempPhotoId;
        existingPhoto._pendingFileId = tempPhotoId;
        existingPhoto._tempId = tempPhotoId;
        existingPhoto.isPending = true;
      } else {
        // Add new photo placeholder - NEVER show spinner, photo appears immediately
        // CRITICAL: Include ALL required fields for annotation save to work
        existingPhoto = {
          photoType: photoType,
          uploading: false,  // NEVER show spinner
          queued: isOfflineMode,  // Show queued badge if offline
          _backgroundSync: true,  // Silent background sync
          url: webPath,
          displayUrl: webPath,
          originalUrl: webPath,
          caption: '',
          Annotation: '',
          drawings: null,
          Drawings: '',
          hasAnnotations: false,
          // CRITICAL: All ID fields for annotation lookups
          AttachID: tempPhotoId,
          attachId: tempPhotoId,
          _pendingFileId: tempPhotoId,
          _tempId: tempPhotoId,
          isPending: true
        };
        point.photos.push(existingPhoto);
      }

      this.changeDetectorRef.detectChanges();

      // Compress image before storing/uploading
      const compressedFile = await this.imageCompression.compressImage(file, {
        maxSizeMB: 0.4,
        maxWidthOrHeight: 1024,
        useWebWorker: true
      }) as File;

      // OFFLINE-FIRST: Use foundationData.uploadEFEPointPhoto which handles both
      // online (immediate upload) and offline (IndexedDB queue) scenarios
      const result = await this.foundationData.uploadEFEPointPhoto(
        point.pointId,
        compressedFile,
        photoType,
        '' // No drawings initially
      );

      console.log(`[Point Photo] Photo ${photoType} processed for point ${point.pointName}:`, result);

      // Update local state with result
      if (result) {
        // CRITICAL: Preserve all ID fields for annotation lookups
        existingPhoto.AttachID = result.AttachID || result._tempId || tempPhotoId;
        existingPhoto.attachId = result.attachId || result.AttachID || result._tempId || tempPhotoId;
        existingPhoto._tempId = result._tempId || tempPhotoId;
        existingPhoto._pendingFileId = result._pendingFileId || result._tempId || tempPhotoId;
        existingPhoto.isPending = !!result._syncing || !!result.isPending;
        
        // If offline (result has _syncing flag), photo is queued - don't clear uploading yet
        if (result._syncing) {
          existingPhoto.uploading = false;
          existingPhoto.queued = true;
          console.log(`[Point Photo] Photo queued for sync (offline mode), _pendingFileId:`, existingPhoto._pendingFileId);
        } else {
          // Online upload completed
          existingPhoto.uploading = false;
          existingPhoto.queued = false;
          
          // Load the uploaded photo URL
          if (result.Photo) {
            existingPhoto.path = result.Photo;
            const imageData = await this.foundationData.getImage(result.Photo);
            if (imageData) {
              existingPhoto.url = imageData;
              existingPhoto.displayUrl = imageData;
            }
          }
        }
        
        // Clear cache to ensure fresh data
        this.foundationData.clearEFEAttachmentsCache();
      }
      
      this.changeDetectorRef.detectChanges();
      console.log(`[Point Photo] Photo ${photoType} for point ${point.pointName} processed successfully`);

    } catch (error) {
      console.error('Error processing point photo:', error);
      // Toast removed per user request
      // await this.showToast('Failed to upload photo', 'danger');

      // Remove uploading/queued state on error
      const existingPhoto = point.photos.find((p: any) => p.photoType === photoType);
      if (existingPhoto) {
        existingPhoto.uploading = false;
        existingPhoto.queued = false;
        existingPhoto._backgroundSync = false;
        existingPhoto.uploadFailed = true;
      }
      this.changeDetectorRef.detectChanges();
    }
  }

  async annotatePointPhoto(point: any, photo: any) {
    try {
      // CRITICAL FIX: Wait for photo to load if still loading
      if (photo.loading) {
        console.log('[Point Annotate] Photo still loading, waiting...');
        // Wait for loading to complete (poll every 100ms, timeout after 10s)
        const startTime = Date.now();
        while (photo.loading && (Date.now() - startTime) < 10000) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (photo.loading) {
          console.warn('[Point Annotate] Photo loading timed out');
        }
      }

      // CRITICAL FIX: Get image as data URL to avoid CORS issues in Fabric.js canvas
      let imageUrl = photo.url || photo.displayUrl;
      
      // ALWAYS try IndexedDB cache first - it stores data URLs which work with canvas
      const attachId = photo.attachId;
      if (attachId) {
        console.log('[Point Annotate] Checking IndexedDB cache for:', attachId);
        const cachedDataUrl = await this.indexedDb.getCachedPhoto(attachId);
        if (cachedDataUrl && cachedDataUrl.startsWith('data:')) {
          console.log('[Point Annotate] ✅ Using cached data URL from IndexedDB');
          imageUrl = cachedDataUrl;
        }
      }
      
      // If still no valid data URL and we have a path, fetch and cache it
      if (!imageUrl || imageUrl === 'assets/img/photo-placeholder.png' || imageUrl.startsWith('https://')) {
        const s3Key = photo.Attachment || photo.path;
        
        // For S3 images, fetch via XMLHttpRequest to get data URL (avoids CORS issues with fabric.js canvas)
        if (s3Key && this.caspioService.isS3Key(s3Key)) {
          console.log('[Point Annotate] Fetching S3 image as data URL via XMLHttpRequest:', s3Key);
          try {
            // Get pre-signed S3 URL first
            const s3Url = await this.caspioService.getS3FileUrl(s3Key);
            
            // Fetch image as base64 data URL using XMLHttpRequest (same pattern as offline-template.service.ts)
            // This avoids CORS issues because XMLHttpRequest can load the blob without CORS headers affecting canvas
            imageUrl = await this.fetchS3ImageAsDataUrl(s3Url);
            
            if (imageUrl && imageUrl.startsWith('data:')) {
              photo.url = imageUrl;
              photo.displayUrl = imageUrl;
              // Cache for future use
              if (attachId) {
                await this.indexedDb.cachePhoto(attachId, this.serviceId, imageUrl, s3Key);
              }
              console.log('[Point Annotate] ✅ Got data URL via XMLHttpRequest');
            }
          } catch (err) {
            console.error('[Point Annotate] Failed to fetch S3 image:', err);
          }
        }
        
      }

      if (!imageUrl || imageUrl === 'assets/img/photo-placeholder.png') {
        console.warn('[Point Annotate] No valid image URL available');
        return;
      }
      // CRITICAL: Decompress existing annotations before opening modal - EXACT pattern from structural-systems
      let existingAnnotations: any = null;
      const compressedDrawings = photo.drawings;

      if (compressedDrawings && compressedDrawings !== 'H4sIAAAAAAAAA6tWKkktLlGyUlAqS8wpTtVRKi1OLYrPTFGyUqoFAJRGGIYcAAAA') {
        try {
          console.log('[Point Annotate] Decompressing existing annotations, length:', compressedDrawings.length);
          // Using static import for offline support
          existingAnnotations = decompressAnnotationData(compressedDrawings);
          console.log('[Point Annotate] Decompressed annotations:', existingAnnotations ? 'SUCCESS' : 'FAILED');
          if (existingAnnotations && existingAnnotations.objects) {
            console.log('[Point Annotate] Found', existingAnnotations.objects.length, 'annotation objects');
          }
        } catch (e) {
          console.error('[Point Annotate] Error decompressing annotations:', e);
        }
      }

      const existingCaption = photo.caption || '';

      // Open FabricPhotoAnnotatorComponent - EXACT pattern from structural-systems
      const modal = await this.modalController.create({
        component: FabricPhotoAnnotatorComponent,
        componentProps: {
          imageUrl: imageUrl,  // Use the fetched/verified URL
          existingAnnotations: existingAnnotations,
          existingCaption: existingCaption,
          photoData: {
            ...photo,
            AttachID: attachId,
            id: attachId,
            caption: existingCaption
          },
          isReEdit: !!existingAnnotations
        },
        cssClass: 'fullscreen-modal'
      });

      await modal.present();
      const { data } = await modal.onWillDismiss();

      if (!data) {
        // User cancelled
        return;
      }

      if (data && data.annotatedBlob) {
        // Update photo with new annotations - EXACT pattern from structural-systems
        const annotatedBlob = data.blob || data.annotatedBlob;
        const annotationsData = data.annotationData || data.annotationsData;

        // Save annotations to database FIRST
        const savedCompressedDrawings = await this.saveAnnotationToDatabase(
          attachId,
          annotatedBlob,
          annotationsData,
          data.caption || ''
        );

        // CRITICAL: Create blob URL for the annotated image (for display only)
        const newUrl = URL.createObjectURL(annotatedBlob);

        // Update local state with IMMUTABLE pattern - EXACT from structural-systems
        photo.drawings = savedCompressedDrawings;
        photo.caption = data.caption !== undefined ? data.caption : existingCaption;
        photo.displayUrl = newUrl;
        photo.hasAnnotations = !!annotationsData;

        console.log('[Point SAVE] Updated photo with compressed drawings, length:', savedCompressedDrawings?.length || 0);

        this.changeDetectorRef.detectChanges();
        // Toast removed per user request
        // await this.showToast('Annotation saved', 'success');
      }
    } catch (error) {
      console.error('Error annotating photo:', error);
      // Toast removed per user request
      // await this.showToast('Failed to save annotation', 'danger');
    }
  }

  async deletePointPhoto(point: any, photo: any, event: Event) {
    event.stopPropagation();

    const alert = await this.alertController.create({
      header: 'Delete Photo',
      message: 'Are you sure you want to delete this photo?',
      buttons: [
        {
          text: 'Delete',
          handler: async () => {
            // OFFLINE-FIRST: Immediate UI update, queue delete for sync if offline
            try {
              // Remove from local array IMMEDIATELY (optimistic update)
              const index = point.photos.findIndex((p: any) => p.attachId === photo.attachId);
              if (index >= 0) {
                point.photos.splice(index, 1);
              }

              // Force UI update first
              this.changeDetectorRef.detectChanges();

              if (photo.attachId) {
                // Clear cached photo IMAGE from IndexedDB
                await this.indexedDb.deleteCachedPhoto(String(photo.attachId));
                
                // Remove from cached ATTACHMENTS LIST in IndexedDB
                await this.indexedDb.removeAttachmentFromCache(String(photo.attachId), 'efe_point_attachments');

                // Delete from database (or queue for sync if offline)
                if (!String(photo.attachId).startsWith('temp_')) {
                  if (this.offlineService.isOnline()) {
                    try {
                      await this.caspioService.deleteServicesEFEPointsAttach(photo.attachId).toPromise();
                      console.log('[Point Photo] Deleted from database:', photo.attachId);
                    } catch (apiError) {
                      console.warn('[Point Photo] API delete failed, queuing for sync:', apiError);
                      await this.indexedDb.addPendingRequest({
                        type: 'DELETE',
                        endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE_Points_Attach/records?q.where=AttachID=${photo.attachId}`,
                        method: 'DELETE',
                        data: { attachId: photo.attachId },
                        dependencies: [],
                        status: 'pending',
                        priority: 'high',
                      });
                      this.backgroundSync.triggerSync();
                    }
                  } else {
                    console.log('[Point Photo] Offline - queuing delete for sync:', photo.attachId);
                    await this.indexedDb.addPendingRequest({
                      type: 'DELETE',
                      endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE_Points_Attach/records?q.where=AttachID=${photo.attachId}`,
                      method: 'DELETE',
                      data: { attachId: photo.attachId },
                      dependencies: [],
                      status: 'pending',
                      priority: 'high',
                    });
                    this.backgroundSync.triggerSync();
                  }
                }
                
                console.log('[Point Photo] Photo removed successfully');
              }

              // Clear the in-memory attachments cache
              this.foundationData.clearEFEAttachmentsCache();
            } catch (error) {
              console.error('Error deleting photo:', error);
            }
          }
        },
        {
          text: 'Cancel',
          role: 'cancel'
        }
      ],
      cssClass: 'custom-document-alert'
    });

    await alert.present();
  }

  async openPointCaptionPopup(point: any, photo: any, event: Event) {
    event.stopPropagation();
    const currentCaption = photo.caption || '';

    try {
      // Use the full caption editor with preset buttons (matching FabricPhotoAnnotatorComponent)
      const newCaption = await this.openCaptionEditorPopup(currentCaption);
      
      if (newCaption !== null) { // User didn't cancel
        await this.savePointCaption(photo, newCaption);
      }
    } catch (chunkError: any) {
      // Handle ChunkLoadError - use native prompt as fallback
      console.error('[Point Caption] Failed to create alert, using native fallback:', chunkError);
      
      const newCaption = window.prompt(`Enter caption for ${photo.photoType} photo:`, currentCaption);
      
      if (newCaption !== null) {
        await this.savePointCaption(photo, newCaption);
      }
    }
  }

  /**
   * Helper method to save point photo caption
   */
  private async savePointCaption(photo: any, newCaption: string): Promise<void> {
    try {
      const updateData = { Annotation: newCaption };
      
      // Update local state immediately
      photo.caption = newCaption;
      this.changeDetectorRef.detectChanges();
      
      // CRITICAL: Check if photo is still syncing (uploading, has temp ID, or has pending file ID)
      const isSyncing = photo.uploading || photo._syncing || photo.isPending || photo.queued ||
                       photo._pendingFileId || String(photo.attachId || '').startsWith('temp_');
      
      if (isSyncing) {
        // CRITICAL FIX: For syncing photos, use updatePendingPhotoData for reliable caption update
        const pendingFileId = photo._pendingFileId || photo._tempId || photo.attachId;
        console.log('[Point Caption] Photo is syncing, updating IndexedDB caption:', pendingFileId);
        
        const updated = await this.indexedDb.updatePendingPhotoData(pendingFileId, { caption: newCaption });
        if (updated) {
          console.log('[Point Caption] ✅ Updated IndexedDB with caption for syncing photo:', pendingFileId);
        } else {
          console.warn('[Point Caption] Could not find pending photo in IndexedDB:', pendingFileId);
        }
        photo._localUpdate = true;
        return; // Don't try to save to server for temp IDs
      }
      
      // Update IndexedDB cache for non-temp photos
      if (photo.attachId && !String(photo.attachId).startsWith('temp_')) {
        for (const p of this.elevationPoints) {
          const foundPhoto = p.photos?.find((ph: any) => String(ph.attachId) === String(photo.attachId));
          if (foundPhoto && p.pointId && !String(p.pointId).startsWith('temp_')) {
            const cached = await this.indexedDb.getCachedServiceData(String(p.pointId), 'efe_point_attachments') || [];
            const updated = cached.map((att: any) => 
              String(att.AttachID) === String(photo.attachId) 
                ? { ...att, Annotation: newCaption, _localUpdate: true }
                : att
            );
            await this.indexedDb.cacheServiceData(String(p.pointId), 'efe_point_attachments', updated);
            break;
          }
        }
      }
      
      // Try API if online, queue if offline
      if (this.offlineService.isOnline()) {
        await this.caspioService.updateServicesEFEPointsAttach(photo.attachId, updateData).toPromise();
      } else {
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE_Points_Attach/records?q.where=AttachID=${photo.attachId}`,
          method: 'PUT',
          data: updateData,
          dependencies: [],
          status: 'pending',
          priority: 'normal',
        });
        this.backgroundSync.triggerSync();
      }
    } catch (error) {
      console.error('Error saving caption:', error);
    }
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

  // Additional methods for template
  trackByPointName(index: number, point: any): any {
    return point.pointId; // Use pointId for tracking, not name
  }

  trackByOption(index: number, option: string): any {
    return option;
  }

  /**
   * Save FDF photo annotation data to database - EXACT implementation from structural-systems category-detail
   * @param roomId The room EFEID
   * @param photoType The photo type ('Top', 'Bottom', or 'Threshold')
   * @param annotatedBlob The annotated image blob
   * @param annotationsData The raw annotation data from Fabric.js
   * @param caption The photo caption
   * @returns The compressed drawings string that was saved
   */
  private async saveFDFAnnotationToDatabase(roomId: string, photoType: string, annotatedBlob: Blob, annotationsData: any, caption: string): Promise<string> {
    // Using static import for offline support

    // CRITICAL: Process annotation data EXACTLY like structural-systems
    let drawingsData = '';
    const EMPTY_COMPRESSED_ANNOTATIONS = 'H4sIAAAAAAAAA6tWKkktLlGyUlAqS8wpTtVRKi1OLYrPTFGyUqoFAJRGGIYcAAAA';

    // Add annotations to Drawings field if provided
    if (annotationsData) {
      // Handle Fabric.js canvas export (object with 'objects' and 'version' properties)
      if (annotationsData && typeof annotationsData === 'object' && 'objects' in annotationsData) {
        // This is a Fabric.js canvas export - stringify it DIRECTLY
        try {
          drawingsData = JSON.stringify(annotationsData);
        } catch (e) {
          console.error('[SAVE FDF] Failed to stringify Fabric.js object:', e);
          drawingsData = JSON.stringify({ objects: [], version: annotationsData.version || '5.3.0' });
        }
      } else if (typeof annotationsData === 'string') {
        drawingsData = annotationsData;
      } else if (typeof annotationsData === 'object') {
        try {
          drawingsData = JSON.stringify(annotationsData);
        } catch (e) {
          console.error('[SAVE FDF] Failed to stringify annotations:', e);
          drawingsData = '';
        }
      }

      // CRITICAL: Final validation and compression
      if (drawingsData && drawingsData !== '{}' && drawingsData !== '[]') {
        // Clean the data
        drawingsData = drawingsData
          .replace(/\u0000/g, '')
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
          .replace(/undefined/g, 'null');

        // COMPRESS the data
        try {
          const parsed = JSON.parse(drawingsData);
          drawingsData = JSON.stringify(parsed, (key, value) => value === undefined ? null : value);

          const originalSize = drawingsData.length;
          drawingsData = compressAnnotationData(drawingsData, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });

          console.log(`[SAVE FDF] Compressed annotations: ${originalSize} â†’ ${drawingsData.length} bytes`);

          if (drawingsData.length > 64000) {
            console.error('[SAVE FDF] Annotation data exceeds 64KB limit:', drawingsData.length, 'bytes');
            throw new Error('Annotation data exceeds 64KB limit');
          }
        } catch (e: any) {
          if (e?.message?.includes('64KB')) {
            throw e;
          }
          console.warn('[SAVE FDF] Could not re-parse for cleaning, using as-is');
        }
      } else {
        drawingsData = EMPTY_COMPRESSED_ANNOTATIONS;
      }
    } else {
      drawingsData = EMPTY_COMPRESSED_ANNOTATIONS;
    }

    // Build update object with dynamic column names
    // CRITICAL: Column names are FDF{Type}Drawings and FDF{Type}Annotation (not FDFPhoto{Type}...)
    const updateData: any = {};
    updateData[`FDF${photoType}Drawings`] = drawingsData;
    updateData[`FDF${photoType}Annotation`] = caption || '';

    console.log('[SAVE FDF] Saving annotations to database:', {
      roomId,
      photoType,
      hasDrawings: !!drawingsData,
      drawingsLength: drawingsData?.length || 0,
      caption: caption || '(empty)'
    });

    // CRITICAL: Handle temp IDs - resolve to real ID or queue for sync
    let resolvedRoomId = roomId;
    if (String(roomId).startsWith('temp_')) {
      const realId = await this.indexedDb.getRealId(roomId);
      if (realId) {
        console.log('[SAVE FDF] Resolved temp ID to real ID:', roomId, '->', realId);
        resolvedRoomId = realId;
      } else {
        // Queue for background sync - room not synced yet
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=DEFERRED`,
          method: 'PUT',
          data: { ...updateData, _tempEfeId: roomId },
          dependencies: [roomId],
          status: 'pending',
          priority: 'normal'
        });
        console.log('[SAVE FDF] FDF annotation update queued for sync (room not yet synced)');
        return drawingsData;
      }
    }

    // Save BOTH Annotation and Drawings fields in a single call
    await this.caspioService.updateServicesEFEByEFEID(resolvedRoomId, updateData).toPromise();

    console.log('[SAVE FDF] Successfully saved caption and drawings for room:', resolvedRoomId);

    // CRITICAL FIX: Cache the annotated image blob for thumbnail display on reload
    if (annotatedBlob && annotatedBlob.size > 0) {
      try {
        const cacheId = `fdf_${roomId}_${photoType.toLowerCase()}`;
        await this.indexedDb.cacheAnnotatedImage(cacheId, annotatedBlob);
        console.log('[SAVE FDF] ✅ Annotated image blob cached:', cacheId);
      } catch (annotCacheErr) {
        console.warn('[SAVE FDF] Failed to cache annotated image blob:', annotCacheErr);
      }
    }

    // Return the compressed drawings string
    return drawingsData;
  }

  /**
   * Save annotation data to database - EXACT implementation from structural-systems category-detail
   * @param attachId The attachment ID from Services_EFE_Points_Attach
   * @param annotatedBlob The annotated image blob
   * @param annotationsData The raw annotation data from Fabric.js
   * @param caption The photo caption
   * @returns The compressed drawings string that was saved
   */
  private async saveAnnotationToDatabase(attachId: string, annotatedBlob: Blob, annotationsData: any, caption: string): Promise<string> {
    // Using static import for offline support

    // CRITICAL: Process annotation data EXACTLY like structural-systems
    // Build the updateData object with Annotation and Drawings fields
    const updateData: any = {
      Annotation: caption || ''
    };

    // Add annotations to Drawings field if provided
    if (annotationsData) {
      let drawingsData = '';

      // Handle Fabric.js canvas export (object with 'objects' and 'version' properties)
      if (annotationsData && typeof annotationsData === 'object' && 'objects' in annotationsData) {
        // This is a Fabric.js canvas export - stringify it DIRECTLY
        // The toJSON() method from Fabric.js already returns the COMPLETE canvas state
        try {
          drawingsData = JSON.stringify(annotationsData);

          // Validate the JSON is parseable
          try {
            const testParse = JSON.parse(drawingsData);
          } catch (e) {
            console.warn('[SAVE] JSON validation failed, but continuing');
          }
        } catch (e) {
          console.error('[SAVE] Failed to stringify Fabric.js object:', e);
          // Try to create a minimal representation
          drawingsData = JSON.stringify({ objects: [], version: annotationsData.version || '5.3.0' });
        }
      } else if (typeof annotationsData === 'string') {
        // Already a string - use it
        drawingsData = annotationsData;
      } else if (typeof annotationsData === 'object') {
        // Other object - stringify it
        try {
          drawingsData = JSON.stringify(annotationsData);
        } catch (e) {
          console.error('[SAVE] Failed to stringify annotations:', e);
          drawingsData = '';
        }
      }

      // CRITICAL: Final validation and compression
      if (drawingsData && drawingsData !== '{}' && drawingsData !== '[]') {
        // Clean the data
        const originalLength = drawingsData.length;

        // Remove problematic characters that Caspio might reject
        drawingsData = drawingsData
          .replace(/\u0000/g, '') // Remove null bytes
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars
          .replace(/undefined/g, 'null'); // Replace 'undefined' strings with 'null'

        // COMPRESS the data to fit in 64KB TEXT field
        try {
          const parsed = JSON.parse(drawingsData);

          // Re-stringify to ensure clean JSON format
          drawingsData = JSON.stringify(parsed, (key, value) => {
            // Replace undefined with null for valid JSON
            return value === undefined ? null : value;
          });

          // COMPRESS (this is the key step!)
          const originalSize = drawingsData.length;
          const EMPTY_COMPRESSED_ANNOTATIONS = 'H4sIAAAAAAAAA6tWKkktLlGyUlAqS8wpTtVRKi1OLYrPTFGyUqoFAJRGGIYcAAAA';
          drawingsData = compressAnnotationData(drawingsData, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });

          console.log(`[SAVE] Compressed annotations: ${originalSize} â†’ ${drawingsData.length} bytes`);

          // Final size check
          if (drawingsData.length > 64000) {
            console.error('[SAVE] Annotation data exceeds 64KB limit:', drawingsData.length, 'bytes');
            throw new Error('Annotation data exceeds 64KB limit');
          }
        } catch (e: any) {
          if (e?.message?.includes('64KB')) {
            throw e; // Re-throw size limit errors
          }
          console.warn('[SAVE] Could not re-parse for cleaning, using as-is');
        }

        // Set the Drawings field with COMPRESSED data
        updateData.Drawings = drawingsData;
      } else {
        // Empty annotations
        updateData.Drawings = 'H4sIAAAAAAAAA6tWKkktLlGyUlAqS8wpTtVRKi1OLYrPTFGyUqoFAJRGGIYcAAAA';
      }
    } else {
      // No annotations provided
      updateData.Drawings = 'H4sIAAAAAAAAA6tWKkktLlGyUlAqS8wpTtVRKi1OLYrPTFGyUqoFAJRGGIYcAAAA';
    }

    console.log('[SAVE] Saving annotations to database:', {
      attachId,
      hasDrawings: !!updateData.Drawings,
      drawingsLength: updateData.Drawings?.length || 0,
      caption: caption || '(empty)'
    });

    // CRITICAL: Update IndexedDB cache FIRST (offline-first pattern)
    // This ensures annotations persist locally even if API call fails
    try {
      // Find the pointId for this attachment
      let pointIdForCache: string | null = null;
      let foundPhoto: any = null;
      for (const point of this.elevationPoints) {
        const photo = point.photos?.find((p: any) => String(p.attachId) === String(attachId));
        if (photo) {
          pointIdForCache = String(point.pointId);
          foundPhoto = photo;
          break;
        }
      }

      // CRITICAL FIX: Handle TEMP photos differently - use updatePendingPhotoData for reliable update
      if (String(attachId).startsWith('temp_') || (foundPhoto && foundPhoto.isPending)) {
        // This is a syncing photo - use the dedicated method to update caption/drawings
        console.log('[SAVE] Updating annotations for temp/pending photo:', attachId);
        
        const pendingFileId = foundPhoto?._pendingFileId || foundPhoto?._tempId || attachId;
        const updated = await this.indexedDb.updatePendingPhotoData(pendingFileId, {
          caption: caption || '',
          drawings: updateData.Drawings
        });
        
        if (updated) {
          console.log('[SAVE] ✅ Updated pending EFE photo with annotations in IndexedDB:', pendingFileId);
          if (foundPhoto) {
            foundPhoto._localUpdate = true;
          }
        } else {
          console.warn('[SAVE] Could not find stored photo data for temp photo:', pendingFileId);
        }
      } else if (pointIdForCache && !pointIdForCache.startsWith('temp_')) {
        // Get existing cached attachments and update
        const cachedAttachments = await this.indexedDb.getCachedServiceData(pointIdForCache, 'efe_point_attachments') || [];
        const updatedAttachments = cachedAttachments.map((att: any) => {
          if (String(att.AttachID) === String(attachId)) {
            return {
              ...att,
              Annotation: updateData.Annotation,
              Drawings: updateData.Drawings,
              _localUpdate: true,
              _updatedAt: Date.now()
            };
          }
          return att;
        });
        await this.indexedDb.cacheServiceData(pointIdForCache, 'efe_point_attachments', updatedAttachments);
        console.log('[SAVE] ✅ EFE Annotation saved to IndexedDB cache for point', pointIdForCache);
      }
      
      // CRITICAL FIX: Cache the annotated image blob for thumbnail display on reload
      // This ensures annotations are visible in thumbnails after page reload
      if (annotatedBlob && annotatedBlob.size > 0) {
        try {
          await this.indexedDb.cacheAnnotatedImage(String(attachId), annotatedBlob);
          console.log('[SAVE] ✅ EFE Annotated image blob cached for thumbnail display:', attachId);
        } catch (annotCacheErr) {
          console.warn('[SAVE] Failed to cache EFE annotated image blob:', annotCacheErr);
        }
      }
    } catch (cacheError) {
      console.warn('[SAVE] Failed to update IndexedDB cache:', cacheError);
      // Continue anyway - still try API
    }

    // OFFLINE-FIRST: Queue the update for background sync
    const isOffline = !this.offlineService.isOnline();
    
    if (isOffline) {
      // Queue for later sync
      await this.indexedDb.addPendingRequest({
        type: 'UPDATE',
        endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE_Points_Attach/records?q.where=AttachID=${attachId}`,
        method: 'PUT',
        data: updateData,
        dependencies: [],
        status: 'pending',
        priority: 'normal',
      });
      console.log('[SAVE] ⏳ EFE Annotation queued for sync (offline):', attachId);
      this.backgroundSync.triggerSync(); // Will sync when back online
    } else {
      // Online - try API call, queue on failure
      try {
        await this.caspioService.updateServicesEFEPointsAttach(attachId, updateData).toPromise();
        console.log('[SAVE] ✅ Successfully saved EFE caption and drawings via API for AttachID:', attachId);
      } catch (apiError) {
        console.warn('[SAVE] API call failed, queuing for retry:', apiError);
        // Queue for retry
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE_Points_Attach/records?q.where=AttachID=${attachId}`,
          method: 'PUT',
          data: updateData,
          dependencies: [],
          status: 'pending',
          priority: 'high',
        });
        this.backgroundSync.triggerSync();
      }
    }

    // CRITICAL: Clear the attachments cache to ensure annotations appear after navigation
    this.foundationData.clearEFEAttachmentsCache();
    console.log('[SAVE] Cleared EFE attachments cache after saving annotations');

    // Return the compressed drawings string so caller can update local photo object
    return updateData.Drawings;
  }

  isRoomReady(): boolean {
    return !!this.roomId && !this.loading;
  }

  isPointReady(point: any): boolean {
    return !!point.pointId;
  }

  isPointPending(point: any): boolean {
    return false; // Can be enhanced later for upload progress
  }

  getPointPhotoByType(point: any, photoType: string): any {
    return this.getPointPhoto(point, photoType);
  }

  viewRoomPhoto(photo: any, point: any) {
    // This would open a photo viewer modal
    // For now, we can just annotate it
    this.annotatePointPhoto(point, photo);
  }

  deleteRoomPhoto(photo: any, point: any) {
    this.deletePointPhoto(point, photo, new Event('click'));
  }

  openRoomPointCaptionPopup(photo: any, point: any, event: Event) {
    this.openPointCaptionPopup(point, photo, event);
  }

  addCustomPoint() {
    this.addElevationPoint();
  }

  onRoomNotesChange() {
    this.onNotesChange();
  }

  openHelp(helpId: number, helpTitle: string) {
    // Help system - can be implemented later
    console.log(`Help requested for ${helpTitle}`);
  }

  /**
   * Open the full caption editor popup with preset buttons
   * Matches the FabricPhotoAnnotatorComponent.openCaptionPopup() pattern
   * Returns the new caption or null if cancelled
   */
  private async openCaptionEditorPopup(currentCaption: string): Promise<string | null> {
    return new Promise(async (resolve) => {
      // Escape HTML to prevent injection
      const escapeHtml = (text: string) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      };

      const tempCaption = escapeHtml(currentCaption || '');

      // Define preset location buttons - 3 columns layout (matching FabricPhotoAnnotatorComponent)
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

      // CRITICAL: Wrap alertController.create in try-catch to handle ChunkLoadError
      let alert: any;
      try {
        alert = await this.alertController.create({
          header: 'Photo Caption',
          cssClass: 'caption-popup-alert',
          message: ' ', // Empty space to prevent Ionic from hiding the message area
          buttons: [
            {
              text: 'Cancel',
              role: 'cancel',
              handler: () => {
                resolve(null);
                return true;
              }
            },
            {
              text: 'Save',
              handler: () => {
                try {
                  const input = document.getElementById('captionInput') as HTMLInputElement;
                  resolve(input?.value || '');
                  return true;
                } catch (error) {
                  console.error('Error saving caption:', error);
                  resolve(null);
                  return true;
                }
              }
            }
          ]
        });
      } catch (chunkError: any) {
        // Handle ChunkLoadError - fall back to native prompt
        console.error('[Caption Editor] ChunkLoadError, using native fallback:', chunkError);
        const newCaption = window.prompt('Enter caption:', currentCaption);
        resolve(newCaption);
        return;
      }

      await alert.present();

      // Inject HTML content immediately after presentation
      setTimeout(() => {
        try {
          const alertElement = document.querySelector('.caption-popup-alert .alert-message');
          if (!alertElement) {
            resolve(null);
            return;
          }

          // Build the full HTML content
          const htmlContent = `
            <div class="caption-popup-content">
              <div class="caption-input-container">
                <input type="text" id="captionInput" class="caption-text-input"
                       placeholder="Enter caption..."
                       value="${tempCaption}"
                       maxlength="255" />
                <button type="button" id="undoCaptionBtn" class="undo-caption-btn" title="Undo Last Word">
                  <ion-icon name="backspace-outline"></ion-icon>
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
                    // Remove focus from button immediately
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
                  captionInput.value = words.length > 0 ? words.join(' ') + ' ' : '';
                }
              } catch (error) {
                console.error('Error handling undo button click:', error);
              }
            });
          }
        } catch (error) {
          console.error('Error setting up caption popup:', error);
        }
      }, 100);
    });
  }

  /**
   * Fetch S3 image as base64 data URL using XMLHttpRequest
   * This approach avoids CORS issues with fabric.js canvas because:
   * 1. XMLHttpRequest loads the image as a blob (not affected by canvas taint rules)
   * 2. We convert the blob to base64 data URL which is always same-origin
   * Same pattern as offline-template.service.ts fetchImageAsBase64()
   */
  private fetchS3ImageAsDataUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      xhr.timeout = 30000; // 30 second timeout
      
      xhr.onload = () => {
        if (xhr.status === 200) {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('FileReader error'));
          reader.readAsDataURL(xhr.response);
        } else {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      };
      
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.ontimeout = () => reject(new Error('Request timeout'));
      xhr.send();
    });
  }
}
