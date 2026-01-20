import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
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
import { IndexedDbService, LocalImage } from '../../../services/indexed-db.service';
import { BackgroundSyncService } from '../../../services/background-sync.service';
import { LocalImageService } from '../../../services/local-image.service';
import { firstValueFrom, Subscription } from 'rxjs';
import { compressAnnotationData, decompressAnnotationData, EMPTY_COMPRESSED_ANNOTATIONS } from '../../../utils/annotation-utils';
import { environment } from '../../../../environments/environment';
import { HelpModalComponent } from '../../../components/help-modal/help-modal.component';
import { db, EfeField, EfePoint } from '../../../services/caspio-db';
import { EfeFieldRepoService } from '../../../services/efe-field-repo.service';
import { HasUnsavedChanges } from '../../../services/unsaved-changes.service';

@Component({
  selector: 'app-room-elevation',
  templateUrl: './room-elevation.page.html',
  styleUrls: ['./room-elevation.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class RoomElevationPage implements OnInit, OnDestroy, ViewWillEnter, HasUnsavedChanges {
  // Debug flag - set to true for verbose logging
  private readonly DEBUG = false;
  
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
  
  // Track loading state for points
  isLoadingPoints: boolean = true;

  // Background upload subscriptions
  private uploadSubscription?: Subscription;
  private taskSubscription?: Subscription;
  private cacheInvalidationSubscription?: Subscription;
  private photoSyncSubscription?: Subscription;
  private efePhotoSyncSubscription?: Subscription;  // For EFE point photos
  private backgroundRefreshSubscription?: Subscription;  // For background refresh events
  private cacheInvalidationDebounceTimer: any = null;
  private isReloadingAfterSync = false;
  private localOperationCooldown = false;
  private localOperationCooldownTimer: any = null;  // Timer for cooldown management
  private initialLoadComplete: boolean = false;  // Track if initial load is complete

  // Track if we need to reload after sync completes
  private pendingSyncReload = false;
  private syncStatusSubscription?: Subscription;
  private localImageStatusSubscription?: Subscription;  // For LocalImage status changes (sync transitions)
  private efeRoomSyncSubscription?: Subscription;  // TASK 3 FIX: For EFE room sync (updates roomId)
  
  // Track last loaded IDs to detect when navigation requires fresh data
  private lastLoadedRoomId: string = '';

  // ===== BULK CACHED DATA (ONE IndexedDB read per type) =====
  // Pre-loaded at room load to eliminate N+1 reads
  private bulkCachedPhotosMap: Map<string, string> = new Map();
  private bulkAnnotatedImagesMap: Map<string, string> = new Map();
  private cacheLoadPromise: Promise<void> = Promise.resolve();

  // ===== PHOTO PRESERVATION (prevents disappearing during sync/reload) =====
  // These maps preserve photos BEFORE roomData is cleared, then restore them
  private preservedPhotosByPointName: Map<string, any[]> = new Map();
  private preservedPhotosByPointId: Map<string, any[]> = new Map();
  private preservedFdfPhotos: any = null;

  // ===== DELETED PHOTO TRACKING (prevents re-adding deleted photos during sync) =====
  // Track deleted photo IDs so they don't reappear from preservation maps or LocalImages
  private deletedPointPhotoIds: Set<string> = new Set();

  // ===== LIVE QUERY SUPPORT (matches structural-systems pattern) =====
  // This subscription keeps the UI updated when LocalImages change without requiring full reload
  private localImagesSubscription?: Subscription;
  private fdfLocalImagesSubscription?: Subscription;  // FDF photos need separate subscription
  private bulkLocalImagesMap: Map<string, LocalImage[]> = new Map();
  
  // ===== DEXIE-FIRST: EfeField subscription for instant room loading =====
  private efeFieldSubscription?: Subscription;
  private efeFieldSeeded: boolean = false;
  
  // Lazy image loading - photos only load when user clicks to expand a point
  expandedPoints: { [pointId: string]: boolean } = {};

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
    private backgroundSync: BackgroundSyncService,
    private localImageService: LocalImageService,
    private ngZone: NgZone,
    private efeFieldRepo: EfeFieldRepoService
  ) {}

  // WEBAPP MODE flag for easy checking
  private get isWebappMode(): boolean {
    return environment.isWeb;
  }

  async ngOnInit() {
    console.time('[RoomElevation] ngOnInit total');
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

    // DEXIE-FIRST: Use initializeFromDexie() for instant loading from Dexie
    // Falls back to loadRoomData() if room not in Dexie yet
    await this.initializeFromDexie();
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

          // ALWAYS display from LocalImages table - never swap displayUrl to remote URLs
          // Sync happens in background, but UI always shows local blob until finalization
          // Only update metadata and cache the remote image for persistence
          if (photoUrl) {
            photo.loading = false;

            // DEXIE-FIRST: Cache photo pointer instead of fetching from S3
            // The local blob is source of truth - just create pointer for attachId
            try {
              const localImage = await this.localImageService.getImage(String(event.tempFileId));
              if (localImage?.localBlobId && realAttachId) {
                // Use pointer storage (saves ~930KB by not fetching S3)
                await this.indexedDb.cachePhotoPointer(String(realAttachId), this.serviceId, localImage.localBlobId, s3Key || '');
                console.log('[RoomElevation PHOTO SYNC] ✅ Cached photo pointer (Dexie-first):', realAttachId, '-> blobId:', localImage.localBlobId);
              } else if (photoUrl && realAttachId) {
                // FALLBACK: Fetch from S3 if no local blob (legacy)
                let imageUrl = photoUrl;
                if (s3Key && this.caspioService.isS3Key(s3Key)) {
                  imageUrl = await this.caspioService.getS3FileUrl(s3Key);
                }
                const dataUrl = await this.fetchS3ImageAsDataUrl(imageUrl);
                photo.url = dataUrl;
                await this.indexedDb.cachePhoto(String(realAttachId), this.serviceId, dataUrl, s3Key || '');
                console.log('[RoomElevation PHOTO SYNC] ✅ Server image cached (legacy fallback)');
              }
            } catch (err) {
              console.warn('[RoomElevation PHOTO SYNC] Failed to cache photo:', err);
              photo.url = photoUrl;
            }
          }

          // CRITICAL: Transfer cached annotated pointer from temp ID to real ID
          // STORAGE OPTIMIZED: Use pointer instead of duplicating full image data
          if (hasExistingAnnotations && originalTempId && realAttachId) {
            console.log('[RoomElevation PHOTO SYNC] Transferring annotated pointer from temp ID to real ID:', originalTempId, '->', realAttachId);
            try {
              const localImage = await this.localImageService.getImage(String(event.tempFileId));
              if (localImage?.localBlobId) {
                // DEXIE-FIRST: Create pointer for realAttachId pointing to same blob
                await this.indexedDb.cacheAnnotatedPointer(String(realAttachId), localImage.localBlobId);
                console.log('[RoomElevation PHOTO SYNC] ✅ Annotated pointer transferred:', realAttachId, '-> blobId:', localImage.localBlobId);

                // Update in-memory map - get the actual data URL for display
                const dataUrl = await this.indexedDb.getCachedAnnotatedImage(String(realAttachId));
                if (dataUrl) {
                  this.bulkAnnotatedImagesMap.set(String(realAttachId), dataUrl);
                  this.bulkAnnotatedImagesMap.delete(String(originalTempId));
                }
              } else {
                // FALLBACK: Legacy path - copy the full data
                const cachedAnnotatedImage = await this.indexedDb.getCachedAnnotatedImage(String(originalTempId));
                if (cachedAnnotatedImage) {
                  const response = await fetch(cachedAnnotatedImage);
                  const blob = await response.blob();
                  const base64 = await this.indexedDb.cacheAnnotatedImage(String(realAttachId), blob);
                  if (base64) {
                    this.bulkAnnotatedImagesMap.set(String(realAttachId), base64);
                    this.bulkAnnotatedImagesMap.delete(String(originalTempId));
                  }
                  console.log('[RoomElevation PHOTO SYNC] ✅ Annotated image transferred (legacy):', realAttachId);
                }
              }
            } catch (transferErr) {
              console.warn('[RoomElevation PHOTO SYNC] Failed to transfer annotated cache:', transferErr);
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
            
            // ALWAYS display from LocalImages table - never swap displayUrl to remote URLs
            // Sync happens in background, but UI always shows local blob until finalization
            if (photoUrl) {
              try {
                let imageUrl = photoUrl;
                if (s3Key && this.caspioService.isS3Key(s3Key)) {
                  imageUrl = await this.caspioService.getS3FileUrl(s3Key);
                }
                const dataUrl = await this.fetchS3ImageAsDataUrl(imageUrl);
                fdfPhotos[`${key}Url`] = dataUrl; // Store for reference, but displayUrl unchanged

                // Cache the photo for persistence (used after local blob is pruned)
                await this.indexedDb.cachePhoto(cacheId, this.serviceId, dataUrl, s3Key || '');
                console.log('[RoomElevation PHOTO SYNC] ✅ FDF server image cached (displayUrl unchanged - staying with LocalImages)');
              } catch (err) {
                fdfPhotos[`${key}Url`] = photoUrl;
                console.warn('[RoomElevation PHOTO SYNC] Failed to cache FDF remote image:', err);
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
    // ALWAYS display from LocalImages table - never swap displayUrl to remote URLs
    this.efePhotoSyncSubscription = this.backgroundSync.efePhotoUploadComplete$.subscribe(async (event) => {
      console.log('[RoomElevation EFE PHOTO SYNC] EFE photo upload completed:', event.tempFileId);

      const realAttachId = event.result?.AttachID || event.result?.PK_ID;
      const s3Key = event.result?.Attachment || event.result?.Photo;

      // Find the photo in our elevationPoints by temp file ID
      for (const point of this.roomData?.elevationPoints || []) {
        const photoIndex = point.photos?.findIndex((p: any) =>
          String(p._tempId) === String(event.tempFileId) ||
          String(p.attachId) === String(event.tempFileId)
        );

        if (photoIndex >= 0 && photoIndex !== undefined) {
          console.log('[RoomElevation EFE PHOTO SYNC] Found EFE photo at point:', point.name, 'index:', photoIndex);

          const existingPhoto = point.photos[photoIndex];

          // Cache the remote image for persistence (used after local blob is pruned)
          // but do NOT update displayUrl - it stays as local blob from LocalImages
          let cachedUrl = existingPhoto.url;
          try {
            const cachedBase64 = await this.indexedDb.getCachedPhoto(String(realAttachId));
            if (cachedBase64) {
              cachedUrl = cachedBase64;
              console.log('[RoomElevation EFE PHOTO SYNC] ✅ Found cached base64');
            } else if (s3Key && this.offlineService.isOnline()) {
              // FALLBACK: Cache wasn't ready yet, fetch from S3 and cache for persistence
              console.log('[RoomElevation EFE PHOTO SYNC] Cache miss, fetching from S3 for persistence...');
              try {
                const s3Url = await this.caspioService.getS3FileUrl(s3Key);
                cachedUrl = await this.fetchS3ImageAsDataUrl(s3Url);
                // Cache it for next time
                await this.indexedDb.cachePhoto(String(realAttachId), this.serviceId, cachedUrl, s3Key);
                console.log('[RoomElevation EFE PHOTO SYNC] ✅ Fetched and cached from S3');
              } catch (s3Err) {
                console.warn('[RoomElevation EFE PHOTO SYNC] S3 fetch failed:', s3Err);
              }
            }
          } catch (err) {
            console.warn('[RoomElevation EFE PHOTO SYNC] Failed to get cached image:', err);
          }

          // Update photo metadata - preserve displayUrl (local blob from LocalImages)
          // CRITICAL: Preserve caption - it may have been set locally before sync
          const serverCaption = event.result?.Annotation || event.result?.Caption || '';
          const localCaption = existingPhoto.caption || existingPhoto.Annotation || '';
          const finalCaption = localCaption || serverCaption;

          point.photos[photoIndex] = {
            ...existingPhoto,
            attachId: realAttachId,
            url: cachedUrl,  // Store cached URL for reference
            // displayUrl: unchanged - stays as local blob from LocalImages table
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
          console.log('[RoomElevation EFE PHOTO SYNC] Updated EFE photo with real ID:', realAttachId, '(displayUrl unchanged - staying with LocalImages)');
          break;
        }
      }
    });

    // TASK 3 FIX: Subscribe to EFE room sync completions
    // This updates this.roomId when a room syncs from temp_xxx to real ID
    // Critical for FDF captions which use roomId as attachId
    this.efeRoomSyncSubscription = this.backgroundSync.efeRoomSyncComplete$.subscribe((event) => {
      // Check if this is our room
      if (String(this.roomId) === String(event.tempId)) {
        console.log(`[RoomElevation] Room synced! Updating roomId: ${event.tempId} -> ${event.realId}`);
        this.roomId = String(event.realId);
        this.lastLoadedRoomId = this.roomId;
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

      // CRITICAL: Skip reload during active sync - images would disappear
      const syncStatus = this.backgroundSync.syncStatus$.getValue();
      if (syncStatus.isSyncing) {
        console.log('[RoomElevation] Skipping cache invalidation - sync in progress, will reload after sync completes');
        this.pendingSyncReload = true;
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

        // Debounce: wait 100ms before reloading to batch multiple rapid events
        // Reduced from 500ms for faster UI response after sync
        this.cacheInvalidationDebounceTimer = setTimeout(() => {
          console.log('[RoomElevation] Cache invalidated (debounced), reloading elevation data...');
          this.reloadElevationDataAfterSync();
        }, 100);
      }
    });

    // Subscribe to sync status changes - reload AFTER sync completes (not during)
    this.syncStatusSubscription = this.backgroundSync.syncStatus$.subscribe((status) => {
      // When sync finishes and we have a pending reload, do it now
      if (!status.isSyncing && this.pendingSyncReload) {
        console.log('[RoomElevation] Sync finished, now reloading elevation data...');
        this.pendingSyncReload = false;
        // Small delay to ensure all sync operations are fully complete
        setTimeout(() => {
          this.reloadElevationDataAfterSync();
        }, 300);
      }
    });

    // Subscribe to background refresh completion for EFE points data
    this.backgroundRefreshSubscription = this.offlineTemplate.backgroundRefreshComplete$.subscribe(event => {
      if (event.serviceId === this.serviceId &&
          (event.dataType === 'efe_points' || event.dataType === 'efe_point_attachments')) {
        console.log('[RoomElevation] Background refresh complete for:', event.dataType);

        // CRITICAL FIX: Skip reload during active sync - defer until sync completes
        // This prevents photos from disappearing during sync
        const syncStatus = this.backgroundSync.syncStatus$.getValue();
        if (syncStatus.isSyncing) {
          console.log('[RoomElevation] Skipping background refresh reload - sync in progress, will reload after sync completes');
          this.pendingSyncReload = true;
          return;
        }

        // Debounce with same timer to prevent duplicate reloads
        // Reduced from 500ms to 100ms for faster UI response
        if (this.cacheInvalidationDebounceTimer) {
          clearTimeout(this.cacheInvalidationDebounceTimer);
        }
        this.cacheInvalidationDebounceTimer = setTimeout(() => {
          if (this.initialLoadComplete && !this.localOperationCooldown) {
            this.reloadElevationDataAfterSync();
          }
        }, 100);
      }
    });

    // TASK 1 FIX: Subscribe to LocalImage status changes to handle sync transitions
    // SILENT SYNC PATTERN (matches structural-systems): Never show uploading spinners
    // Photos display from cache immediately, sync happens invisibly in background
    this.localImageStatusSubscription = this.localImageService.statusChange$.subscribe(async (event) => {
      console.log('[RoomElevation] LocalImage status changed:', event.imageId, event.oldStatus, '->', event.newStatus);

      // Find and update the corresponding photo in elevation points
      if (this.roomData?.elevationPoints) {
        for (const point of this.roomData.elevationPoints) {
          if (!point.photos) continue;

          for (const photo of point.photos as any[]) {
            // Match by imageId, localImageId, or attachId
            const photoId = photo.imageId || photo.localImageId || photo.attachId || photo._tempId;
            if (photoId === event.imageId || photo.attachId === event.attachId) {
              // SILENT SYNC: Update metadata but NEVER show uploading spinner
              // This matches structural-systems pattern where photos always display without indicators
              if (event.newStatus === 'uploading') {
                // SILENT SYNC: Don't set uploading=true, photo appears normal
                photo.uploading = false;
                photo.queued = false;
              } else if (event.newStatus === 'uploaded' || event.newStatus === 'verified') {
                photo.uploading = false;
                photo.queued = false;
                photo.isPending = false;

                // If we got a real attachId from the sync, update it
                if (event.attachId && !String(photo.attachId || '').startsWith('temp_')) {
                  photo.attachId = event.attachId;
                  photo.AttachID = event.attachId;
                }
              } else if (event.newStatus === 'queued') {
                photo.uploading = false;
                photo.queued = false; // SILENT SYNC: Don't show queued indicator either
              } else if (event.newStatus === 'failed') {
                photo.uploading = false;
                photo.queued = false;
                photo.failed = true;
              }

              // CRITICAL: Never clear displayUrl during status transitions
              // The blob URL should remain valid until explicitly replaced

              this.changeDetectorRef.detectChanges();
              console.log('[RoomElevation] Updated photo status (silent sync):', photoId, '->', event.newStatus);
              break;
            }
          }
        }
      }

      // Also update FDF photos if applicable - SILENT SYNC pattern
      if (this.roomData?.fdfPhotos) {
        const fdfPhotos = this.roomData.fdfPhotos;
        for (const photoType of ['top', 'bottom', 'threshold']) {
          const imageId = fdfPhotos[`${photoType}ImageId`];
          if (imageId === event.imageId) {
            // SILENT SYNC: Never show uploading spinner for FDF photos either
            fdfPhotos[`${photoType}Uploading`] = false;
            // CRITICAL: Never clear displayUrl
            this.changeDetectorRef.detectChanges();
            console.log('[RoomElevation] Updated FDF photo status (silent sync):', photoType, '->', event.newStatus);
            break;
          }
        }
      }
    });

    // TASK 1 FIX: Subscribe to live LocalImages changes (matches structural-systems pattern)
    // This keeps the UI updated when LocalImages are added/modified without requiring full reload
    this.subscribeToLocalImagesChanges();

    // Mark initial load as complete
    this.initialLoadComplete = true;
    console.timeEnd('[RoomElevation] ngOnInit total');
  }

  /**
   * Subscribe to LiveQuery for LocalImages changes (matches structural-systems pattern)
   * When LocalImages are added or updated, the UI is updated immediately without full reload
   */
  private subscribeToLocalImagesChanges(): void {
    // Unsubscribe from previous subscriptions if they exist
    if (this.localImagesSubscription) {
      this.localImagesSubscription.unsubscribe();
    }
    if (this.fdfLocalImagesSubscription) {
      this.fdfLocalImagesSubscription.unsubscribe();
    }

    if (!this.serviceId) {
      console.log('[RoomElevation] No serviceId, skipping LocalImages subscription');
      return;
    }

    console.log('[RoomElevation] Subscribing to LocalImages changes for service:', this.serviceId);

    // Subscribe to all LocalImages for this service (efe_point entity type)
    this.localImagesSubscription = db.liveLocalImages$(this.serviceId, 'efe_point').subscribe(
      async (localImages) => {
        console.log('[RoomElevation] LiveQuery - LocalImages updated:', localImages.length, 'images');

        // Update bulkLocalImagesMap reactively
        this.updateBulkLocalImagesMap(localImages);

        // ANNOTATION FIX: Reload annotated images cache to ensure annotations persist
        await this.reloadAnnotatedImagesCache();

        // CRITICAL: Update in-memory photos with fresh displayUrls from LocalImages
        // This prevents photos from disappearing when sync status changes
        this.refreshPhotosFromLocalImages(localImages);

        // Trigger change detection to update UI
        this.changeDetectorRef.detectChanges();
      },
      (error) => {
        console.error('[RoomElevation] Error in LocalImages subscription:', error);
      }
    );

    // FIX: Also subscribe to FDF entity type to keep FDF photos visible during sync
    // This matches the pattern used for elevation points above
    this.fdfLocalImagesSubscription = db.liveLocalImages$(this.serviceId, 'fdf').subscribe(
      async (localImages) => {
        console.log('[RoomElevation] LiveQuery - FDF LocalImages updated:', localImages.length, 'images');

        // ANNOTATION FIX: Reload annotated images cache to ensure annotations persist
        await this.reloadAnnotatedImagesCache();

        // CRITICAL: Update FDF photos with fresh displayUrls from LocalImages
        // This prevents FDF photos from disappearing when sync status changes
        this.refreshFdfPhotosFromLocalImages(localImages);

        // Trigger change detection to update UI
        this.changeDetectorRef.detectChanges();
      },
      (error) => {
        console.error('[RoomElevation] Error in FDF LocalImages subscription:', error);
      }
    );
  }

  /**
   * Update bulkLocalImagesMap from liveQuery results
   * Groups LocalImages by entityId (pointId) for efficient lookup
   */
  private updateBulkLocalImagesMap(localImages: LocalImage[]): void {
    // Clear existing map
    this.bulkLocalImagesMap.clear();

    // Group LocalImages by entityId (pointId)
    for (const img of localImages) {
      if (!img.entityId) continue;

      const entityId = String(img.entityId);
      if (!this.bulkLocalImagesMap.has(entityId)) {
        this.bulkLocalImagesMap.set(entityId, []);
      }
      this.bulkLocalImagesMap.get(entityId)!.push(img);
    }

    console.log('[RoomElevation] Updated bulkLocalImagesMap with', this.bulkLocalImagesMap.size, 'point groups');
  }

  /**
   * Refresh in-memory photos from LocalImages (prevents disappearing during sync)
   * This is the key fix - when LocalImages change, we update displayUrls without reload
   */
  private async refreshPhotosFromLocalImages(localImages: LocalImage[]): Promise<void> {
    if (!this.roomData?.elevationPoints) return;

    for (const localImage of localImages) {
      // Find matching point
      const pointId = localImage.entityId;
      const point = this.roomData.elevationPoints.find((p: any) =>
        String(p.pointId) === String(pointId)
      );

      if (!point || !point.photos) continue;

      // Find matching photo in point's photos array
      for (const photo of point.photos) {
        const isMatch =
          photo.imageId === localImage.imageId ||
          photo.localImageId === localImage.imageId ||
          (localImage.attachId && String(photo.attachId) === String(localImage.attachId));

        if (isMatch) {
          // CRITICAL: Update the displayUrl from the LocalImage
          // This ensures the photo stays visible even if blob URL was invalidated
          try {
            // ANNOTATION FIX: Invalidate display URL cache to force re-evaluation
            // This ensures annotated images are properly shown after sync
            this.localImageService.invalidateDisplayUrlCache(localImage.imageId);

            // ANNOTATION FIX: Check bulkAnnotatedImagesMap FIRST for cached annotated images
            // This handles cases where the LocalImage.drawings field isn't properly set
            const hasAnnotations = !!(localImage.drawings && localImage.drawings.length > 10);
            let freshUrl: string | null = null;

            // Try to get annotated image from in-memory cache first
            const cachedAnnotated = this.bulkAnnotatedImagesMap.get(localImage.imageId)
              || (localImage.attachId ? this.bulkAnnotatedImagesMap.get(String(localImage.attachId)) : null);

            if (cachedAnnotated) {
              freshUrl = cachedAnnotated;
              console.log('[RoomElevation] Using cached ANNOTATED image for refresh:', localImage.imageId);
            } else {
              // Fall back to getDisplayUrl which checks IndexedDB
              freshUrl = await this.localImageService.getDisplayUrl(localImage);
            }

            if (freshUrl && freshUrl !== 'assets/img/photo-placeholder.png') {
              // Only update if we got a valid URL and current one is invalid
              const currentUrl = photo.displayUrl;
              const needsUpdate = !currentUrl ||
                currentUrl === 'assets/img/photo-placeholder.png' ||
                currentUrl.includes('placeholder') ||
                (currentUrl.startsWith('blob:') && !await this.isValidBlobUrl(currentUrl));

              if (needsUpdate) {
                console.log('[RoomElevation] Refreshing displayUrl for photo:', localImage.imageId);
                photo.displayUrl = freshUrl;
                photo.url = freshUrl;
                photo.thumbnailUrl = freshUrl;
              }

              // SILENT SYNC: Don't show uploading indicators (matches Structural Systems pattern)
              // Photos should display normally from cache without spinners
              photo.uploading = false;
              photo.queued = false;
              photo.isPending = localImage.status !== 'verified';

              // ANNOTATION FIX: Update hasAnnotations and drawings from LocalImage
              if (localImage.drawings) {
                photo.drawings = localImage.drawings;
                photo.hasAnnotations = hasAnnotations;
              }

              // Update attachId if LocalImage has a real one
              if (localImage.attachId && !String(localImage.attachId).startsWith('img_')) {
                photo.attachId = localImage.attachId;
                photo.AttachID = localImage.attachId;
              }
            }
          } catch (e) {
            console.warn('[RoomElevation] Error refreshing displayUrl for:', localImage.imageId, e);
          }
          break;
        }
      }
    }
  }

  /**
   * Check if a blob URL is still valid
   */
  private async isValidBlobUrl(url: string): Promise<boolean> {
    if (!url || !url.startsWith('blob:')) return false;
    try {
      const response = await fetch(url, { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Refresh FDF photos from LocalImages (prevents disappearing during sync)
   * This is the key fix - when FDF LocalImages change, we update displayUrls without reload
   */
  private async refreshFdfPhotosFromLocalImages(localImages: LocalImage[]): Promise<void> {
    if (!this.roomData?.fdfPhotos) return;

    const fdfPhotos = this.roomData.fdfPhotos;

    for (const localImage of localImages) {
      // Only process FDF images for this room
      const entityId = String(localImage.entityId);
      let isMatch = entityId === String(this.roomId);

      // FDF FIX: Handle temp<->real ID mappings in both directions
      if (!isMatch) {
        // Case 1: Image has temp entityId, check if it maps to our real roomId
        if (entityId.startsWith('temp_')) {
          try {
            const realId = await this.indexedDb.getRealId(entityId);
            if (realId === this.roomId) {
              isMatch = true;
            }
          } catch {
            // Mapping not found
          }
        }

        // Case 2: Our roomId is temp, check if it maps to image's real entityId
        if (!isMatch && String(this.roomId).startsWith('temp_')) {
          try {
            const realRoomId = await this.indexedDb.getRealId(this.roomId);
            if (realRoomId === entityId) {
              isMatch = true;
            }
          } catch {
            // Mapping not found
          }
        }
      }

      if (!isMatch) continue;

      // Determine which photo slot this belongs to (top, bottom, threshold)
      // FDF FIX: Use same mapping logic as populateFdfPhotosFromLocalImages
      const photoType = localImage.photoType || 'Top';
      let photoKey = '';
      if (photoType.includes('Top') && photoType.includes('Details')) {
        photoKey = 'topDetails';
      } else if (photoType.includes('Bottom') && photoType.includes('Details')) {
        photoKey = 'bottomDetails';
      } else if (photoType.includes('Top')) {
        photoKey = 'top';
      } else if (photoType.includes('Bottom')) {
        photoKey = 'bottom';
      } else if (photoType.includes('Threshold')) {
        photoKey = 'threshold';
      }

      if (!photoKey) continue;  // Skip unknown photo types

      // DEXIE-FIRST: Always update the displayUrl from the LocalImage
      // The LocalImage blob is the source of truth - always use it if available
      try {
        // ANNOTATION FIX: Invalidate display URL cache to force re-evaluation
        this.localImageService.invalidateDisplayUrlCache(localImage.imageId);

        // ANNOTATION FIX: Check bulkAnnotatedImagesMap FIRST for cached annotated images
        let freshUrl: string | null = null;
        const cachedAnnotated = this.bulkAnnotatedImagesMap.get(localImage.imageId)
          || (localImage.attachId ? this.bulkAnnotatedImagesMap.get(String(localImage.attachId)) : null);

        if (cachedAnnotated) {
          freshUrl = cachedAnnotated;
          console.log('[RoomElevation] Using cached ANNOTATED FDF image for refresh:', photoKey, localImage.imageId);
        } else {
          // Fall back to getDisplayUrl which checks IndexedDB
          freshUrl = await this.localImageService.getDisplayUrl(localImage);
        }

        if (freshUrl && freshUrl !== 'assets/img/photo-placeholder.png') {
          // DEXIE-FIRST: Always apply fresh URL from LocalImages (source of truth)
          console.log('[RoomElevation] Refreshing FDF displayUrl for:', photoKey, localImage.imageId);
          fdfPhotos[photoKey] = true;
          fdfPhotos[`${photoKey}Url`] = freshUrl;
          fdfPhotos[`${photoKey}DisplayUrl`] = freshUrl;

          // SILENT SYNC: Don't show uploading indicators (matches Structural Systems pattern)
          fdfPhotos[`${photoKey}Loading`] = false;
          fdfPhotos[`${photoKey}Uploading`] = false;
          fdfPhotos[`${photoKey}Queued`] = false;

          // Update imageId and localBlobId for tracking
          fdfPhotos[`${photoKey}ImageId`] = localImage.imageId;
          fdfPhotos[`${photoKey}LocalBlobId`] = localImage.localBlobId;
          fdfPhotos[`${photoKey}IsLocalFirst`] = true;

          // Update attachId if LocalImage has a real one
          if (localImage.attachId && !String(localImage.attachId).startsWith('img_')) {
            fdfPhotos[`${photoKey}AttachId`] = localImage.attachId;
          }

          // Update caption and drawings if present
          if (localImage.caption) {
            fdfPhotos[`${photoKey}Caption`] = localImage.caption;
          }
          if (localImage.drawings) {
            fdfPhotos[`${photoKey}Drawings`] = localImage.drawings;
            fdfPhotos[`${photoKey}HasAnnotations`] = localImage.drawings.length > 10;
          }
        }
      } catch (e) {
        console.warn('[RoomElevation] Error refreshing FDF displayUrl for:', photoKey, localImage.imageId, e);
      }
    }
  }

  /**
   * Ionic lifecycle hook - called when navigating back to this page
   * Uses smart skip logic to avoid redundant reloads while ensuring new data always appears
   */
  async ionViewWillEnter() {
    console.time('[RoomElevation] ionViewWillEnter');

    // Only process if initial load is complete and we have required IDs
    if (!this.initialLoadComplete || !this.roomId) {
      console.timeEnd('[RoomElevation] ionViewWillEnter');
      return;
    }

    const sectionKey = `${this.serviceId}_room_${this.roomName}`;

    // Check if we have data in memory and if section is dirty
    const hasDataInMemory = this.roomData && (this.roomData.elevationPoints?.length > 0 || this.roomData.fdfPhotos);
    const isDirty = this.backgroundSync.isSectionDirty(sectionKey);

    // CRITICAL: Check if room has changed (navigating from project details to different room)
    const roomChanged = this.lastLoadedRoomId !== this.roomId;

    // TASK 1 FIX: Check if sync is in progress - avoid full reloads during sync to prevent photo disappearing
    const syncStatus = this.backgroundSync.syncStatus$.getValue();
    const syncInProgress = syncStatus.isSyncing;

    console.log(`[RoomElevation] ionViewWillEnter - hasData: ${!!hasDataInMemory}, isDirty: ${isDirty}, roomChanged: ${roomChanged}, syncInProgress: ${syncInProgress}`);

    // ALWAYS reload if:
    // 1. First load (no data in memory)
    // 2. Room has changed (navigating from project details)
    // But SKIP reload if sync is in progress and we have data - just refresh local state
    if (!hasDataInMemory || roomChanged) {
      console.log('[RoomElevation] Reloading data - no data or room changed');
      await this.loadRoomData();
      this.backgroundSync.clearSectionDirty(sectionKey);
    } else if (isDirty && !syncInProgress) {
      // Section is dirty but sync is NOT in progress - safe to reload
      console.log('[RoomElevation] Reloading data - section dirty and sync not in progress');
      await this.loadRoomData();
      this.backgroundSync.clearSectionDirty(sectionKey);
    } else if (isDirty && syncInProgress) {
      // TASK 1 FIX: Section is dirty but sync IS in progress
      // DON'T do full reload - it would cause photos to disappear
      // Just refresh local state (blob URLs) and defer full reload until sync completes
      console.log('[RoomElevation] Sync in progress - refreshing local state only, deferring full reload');
      this.pendingSyncReload = true;  // Will reload after sync completes
      await this.refreshLocalState();
    } else {
      // SKIP FULL RELOAD but refresh local state (blob URLs, pending captions/drawings)
      // This ensures images don't disappear when navigating back to this page
      console.log('[RoomElevation] Refreshing local images and pending captions');
      await this.refreshLocalState();
    }
    console.timeEnd('[RoomElevation] ionViewWillEnter');
  }

  /**
   * Check if there are unsaved changes (for route guard)
   * Only checks on web platform - returns true if notes are pending save (debounce timer active)
   */
  hasUnsavedChanges(): boolean {
    if (!environment.isWeb) return false;

    // Check if there's a pending notes save (debounce timer is active)
    return this.notesDebounceTimer !== null;
  }

  /**
   * Refresh local state without full reload
   * Called when navigating back to page with cached data
   * - Regenerates blob URLs for LocalImages (they may have been invalidated)
   * - Merges pending captions/drawings into photo arrays
   */
  private async refreshLocalState(): Promise<void> {
    // 1. Get all LocalImages for this service (EFE points + FDF)
    const localEFEImages = await this.localImageService.getImagesForService(this.serviceId, 'efe_point');
    let localFDFImages = await this.localImageService.getImagesForEntity('fdf', this.roomId);

    // TASK 1 FIX: Also get FDF photos stored with temp IDs that map to this real room ID
    if (!String(this.roomId).startsWith('temp_')) {
      try {
        const allFDFImages = await this.indexedDb.getLocalImagesForService(this.serviceId, 'fdf');
        for (const img of allFDFImages) {
          // BUGFIX: Convert entityId to string to handle numeric IDs from database
          if (String(img.entityId).startsWith('temp_')) {
            const realId = await this.indexedDb.getRealId(img.entityId);
            if (realId === this.roomId && !localFDFImages.some(e => e.imageId === img.imageId)) {
              localFDFImages.push(img);
            }
          }
        }
      } catch (e) {
        console.warn('[RoomElevation] Error in refreshLocalState temp ID lookup:', e);
      }
    }

    const allLocalImages = [...localEFEImages, ...localFDFImages];

    // 2. Build lookup map of LocalImages by imageId for fallback URL resolution
    const localImageMap = new Map<string, any>();
    for (const img of allLocalImages) {
      localImageMap.set(img.imageId, img);
    }

    // 3. Regenerate blob URLs from IndexedDB (only works for images with local blobs)
    const urlMap = await this.localImageService.refreshBlobUrlsForImages(allLocalImages);

    // 4. Update FDF photos (object with keys like 'top', 'topUrl', etc.)
    if (this.roomData?.fdfPhotos) {
      const fdfPhotos = this.roomData.fdfPhotos;

      for (const photoType of ['top', 'bottom', 'threshold']) {
        const imageId = fdfPhotos[`${photoType}ImageId`];
        if (imageId && fdfPhotos[`${photoType}IsLocalFirst`]) {
          let newUrl = urlMap.get(imageId);

          // TASK 1 FIX: If no blob URL, try getDisplayUrl which handles pruned blobs
          // This uses cached base64 or signed S3 URL as fallback
          if (!newUrl) {
            const localImage = localImageMap.get(imageId);
            if (localImage) {
              try {
                newUrl = await this.localImageService.getDisplayUrl(localImage);
              } catch (e) {
                console.warn(`[RoomElevation] Failed to get FDF ${photoType} displayUrl:`, e);
              }
            }
          }

          if (newUrl) {
            fdfPhotos[`${photoType}Url`] = newUrl;
            fdfPhotos[`${photoType}DisplayUrl`] = newUrl;
            console.log(`[RoomElevation] Refreshed FDF ${photoType} URL from LocalImage:`, imageId);
          }
        }
      }
    }

    // 5. Update elevation point photos
    // TASK 1 FIX: Refresh ALL photos with LocalImage IDs, not just those with isLocalImage flag
    // This ensures photos persist through navigation during sync even after flags change
    if (this.roomData?.elevationPoints) {
      for (const point of this.roomData.elevationPoints) {
        if (point.photos) {
          for (const photo of point.photos as any[]) {
            const imageId = photo.localImageId || photo.imageId;
            if (imageId) {
              let newUrl = urlMap.get(imageId);

              // TASK 1 FIX: If no blob URL, try getDisplayUrl which handles pruned blobs
              // This uses cached base64 or signed S3 URL as fallback
              if (!newUrl) {
                const localImage = localImageMap.get(imageId);
                if (localImage) {
                  try {
                    newUrl = await this.localImageService.getDisplayUrl(localImage);
                  } catch (e) {
                    console.warn(`[RoomElevation] Failed to get photo displayUrl for ${imageId}:`, e);
                  }
                }
              }

              if (newUrl) {
                photo.displayUrl = newUrl;
                photo.url = newUrl;
                photo.thumbnailUrl = newUrl;
                console.log(`[RoomElevation] Refreshed photo URL for imageId: ${imageId}`);
              }
            }
          }
        }
      }
    }

    // 6. Merge any pending captions/drawings
    await this.mergePendingCaptions();

    // 7. TASK 1 FIX: Update class-level preservation maps for subsequent reloads
    // This ensures photos survive through reloadElevationDataAfterSync() calls
    // Without this, photos could disappear when sync completes and triggers reload
    if (this.roomData?.elevationPoints) {
      for (const point of this.roomData.elevationPoints) {
        if (point.photos && point.photos.length > 0) {
          const photosToPreserve = point.photos.filter((p: any) =>
            p.displayUrl &&
            p.displayUrl !== 'assets/img/photo-placeholder.png' &&
            !p.displayUrl.includes('placeholder')
          );
          if (photosToPreserve.length > 0) {
            const photosCopy = photosToPreserve.map((p: any) => ({ ...p }));
            this.preservedPhotosByPointName.set(point.name, photosCopy);
            if (point.pointId) {
              this.preservedPhotosByPointId.set(String(point.pointId), photosCopy);
            }
          }
        }
      }
      console.log(`[RoomElevation] Updated preservation maps: ${this.preservedPhotosByPointName.size} points`);
    }

    console.log('[RoomElevation] Local state refreshed - URLs regenerated, captions merged');
  }

  /**
   * Merge pending captions and drawings into in-memory photo arrays
   * This ensures caption/annotation edits persist through navigation
   */
  private async mergePendingCaptions(): Promise<void> {
    const pendingCaptions = await this.indexedDb.getPendingCaptions();

    if (!pendingCaptions || pendingCaptions.length === 0) return;

    // Build lookup map: attachId -> pending caption data
    const captionMap = new Map<string, { caption: string; drawings: string }>();
    for (const pc of pendingCaptions) {
      if (pc.status === 'pending' || pc.status === 'syncing') {
        captionMap.set(pc.attachId, { caption: pc.caption || '', drawings: pc.drawings || '' });
      }
    }

    // Update FDF photos with pending captions
    if (this.roomData?.fdfPhotos) {
      for (const photo of this.roomData.fdfPhotos as any[]) {
        const attachId = photo.AttachID || photo.localImageId;
        const pending = captionMap.get(attachId);
        if (pending) {
          if (pending.caption !== undefined) {
            photo.caption = pending.caption;
          }
          if (pending.drawings !== undefined) {
            photo.Drawings = pending.drawings;
            photo.hasAnnotations = !!(pending.drawings && pending.drawings.length > 100);
          }
        }
      }
    }

    // Update elevation point photos with pending captions
    if (this.roomData?.elevationPoints) {
      for (const point of this.roomData.elevationPoints) {
        if (point.photos) {
          for (const photo of point.photos as any[]) {
            // Check all possible ID fields for local-first and legacy photos
            const possibleIds = [
              photo.AttachID,
              photo.attachId,
              photo.localImageId,
              photo.imageId,
              photo._tempId,
              photo._pendingFileId
            ].filter(id => id);

            // Find matching pending caption using any of the IDs
            let pending = null;
            for (const id of possibleIds) {
              pending = captionMap.get(String(id));
              if (pending) break;
            }

            if (pending) {
              if (pending.caption !== undefined) {
                photo.caption = pending.caption;
              }
              if (pending.drawings !== undefined) {
                photo.Drawings = pending.drawings;
                photo.hasAnnotations = !!(pending.drawings && pending.drawings.length > 100);
              }
            }
          }
        }
      }
    }
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

      // CRITICAL FIX: Preserve ALL existing photos BEFORE reloading
      // This prevents photos from disappearing during sync - matching structural-category pattern
      const syncStatus = this.backgroundSync.syncStatus$.getValue();
      const syncInProgress = syncStatus.isSyncing;

      // Build maps of ALL existing photos by point name AND point ID
      // This ensures photos are preserved even if point IDs change during sync
      const preservedPhotosByPointName = new Map<string, any[]>();
      const preservedPhotosByPointId = new Map<string, any[]>();

      if (this.roomData?.elevationPoints) {
        for (const point of this.roomData.elevationPoints) {
          if (point.photos && point.photos.length > 0) {
            // Deep copy photos to prevent mutation issues
            const photosCopy = point.photos.map((p: any) => ({ ...p }));

            // Preserve by name (always)
            preservedPhotosByPointName.set(point.name, photosCopy);

            // Also preserve by point ID if available
            if (point.pointId) {
              preservedPhotosByPointId.set(String(point.pointId), photosCopy);
            }

            console.log(`[RoomElevation] Preserving ${photosCopy.length} photos for point "${point.name}" (ID: ${point.pointId}, sync: ${syncInProgress})`);
          }
        }
      }
      console.log(`[RoomElevation] Preserved photos for ${preservedPhotosByPointName.size} points`);

      // FAST LOAD FIX: Reload photo caches first for instant display
      const [cachedPhotos, annotatedImages] = await Promise.all([
        this.indexedDb.getAllCachedPhotosForService(this.serviceId),
        this.indexedDb.getAllCachedAnnotatedImagesForService()
      ]);
      this.bulkCachedPhotosMap = cachedPhotos;
      this.bulkAnnotatedImagesMap = annotatedImages;
      console.log(`[RoomElevation] Reloaded caches: ${cachedPhotos.size} photos, ${annotatedImages.size} annotations`);

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

      // CRITICAL: Also load pending photos from IndexedDB (photos not yet synced)
      // This ensures photos added offline don't disappear during reload
      const pendingPhotosMap = await this.indexedDb.getAllPendingPhotosGroupedByPoint();
      console.log('[RoomElevation] Reloaded pending photos map with', pendingPhotosMap.size, 'points');

      // CRITICAL FIX: Load LocalImages for this service (new local-first image system)
      // This ensures photos persist through navigation and sync - matching structural-category pattern
      const allLocalImages = await this.localImageService.getImagesForService(this.serviceId, 'efe_point');

      // Build LocalImages map with BIDIRECTIONAL temp ID <-> real ID mapping
      const bulkLocalImagesMap = new Map<string, any[]>();
      for (const img of allLocalImages) {
        // BUGFIX: Convert entityId to string to handle numeric IDs from database
        const entityId = String(img.entityId);

        // Add by original entityId
        if (!bulkLocalImagesMap.has(entityId)) {
          bulkLocalImagesMap.set(entityId, []);
        }
        bulkLocalImagesMap.get(entityId)!.push(img);

        // CRITICAL: Also add by resolved real ID if entityId is a temp ID
        if (entityId.startsWith('temp_')) {
          const realId = await this.indexedDb.getRealId(entityId);
          if (realId && realId !== entityId) {
            if (!bulkLocalImagesMap.has(realId)) {
              bulkLocalImagesMap.set(realId, []);
            }
            const existing = bulkLocalImagesMap.get(realId)!;
            if (!existing.some((e: any) => e.imageId === img.imageId)) {
              existing.push(img);
            }
          }
        }
      }
      console.log(`[RoomElevation] Reloaded ${allLocalImages.length} LocalImages for ${bulkLocalImagesMap.size} points`);

      // TASK 1 FIX: Update class-level bulkLocalImagesMap so liveQuery updates work correctly
      this.bulkLocalImagesMap = bulkLocalImagesMap;

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

            // CRITICAL FIX: Restore preserved photos if point.photos was cleared
            // This ensures photos captured before reload are not lost
            const pointIdStr = String(realId);
            if (!localPoint.photos || localPoint.photos.length === 0) {
              // Try to restore from preserved photos (by name first, then by ID)
              const preservedByName = preservedPhotosByPointName.get(pointName);
              const preservedById = preservedPhotosByPointId.get(pointIdStr);
              const preserved = preservedByName || preservedById;
              if (preserved && preserved.length > 0) {
                localPoint.photos = [...preserved];
                // TASK 1 FIX: Regenerate blob URLs for preserved photos that may have expired
                // This ensures photos don't disappear when navigating back during sync
                for (const photo of localPoint.photos) {
                  const imageId = photo.localImageId || photo.imageId;
                  if (imageId && (photo.isLocalImage || photo.isLocalFirst)) {
                    // Find matching LocalImage
                    const localImagesForPoint = bulkLocalImagesMap.get(pointIdStr) || [];
                    const matchingLocalImage = localImagesForPoint.find((li: any) => li.imageId === imageId);
                    if (matchingLocalImage) {
                      const freshUrl = await this.localImageService.getDisplayUrl(matchingLocalImage);
                      if (freshUrl && freshUrl !== 'assets/img/photo-placeholder.png') {
                        photo.displayUrl = freshUrl;
                        photo.url = freshUrl;
                        photo.thumbnailUrl = freshUrl;
                        console.log(`[RoomElevation] ✅ Refreshed blob URL for preserved photo ${imageId}`);
                      }
                    }
                  }
                }
                console.log(`[RoomElevation] ✅ Restored ${preserved.length} preserved photos for point "${pointName}"`);
              } else {
                // BULLETPROOF FIX: Try bulkLocalImagesMap as last resort
                const localImagesForPoint = bulkLocalImagesMap.get(pointIdStr) || [];
                if (localImagesForPoint.length > 0) {
                  localPoint.photos = [];
                  for (const localImg of localImagesForPoint) {
                    // TASK 1 FIX: Add photo UNCONDITIONALLY even with placeholder URL
                    // Matches category-detail pattern - placeholder will be updated via liveQuery
                    let displayUrl = 'assets/img/photo-placeholder.png';
                    try {
                      displayUrl = await this.localImageService.getDisplayUrl(localImg);
                    } catch (e) {
                      console.warn('[RoomElevation] Failed to get LocalImage displayUrl:', e);
                    }

                    // ANNOTATION FIX: Check for cached annotated image for thumbnail display
                    const hasAnnotations = !!(localImg.drawings && localImg.drawings.length > 10);
                    let thumbnailUrl = displayUrl;
                    if (hasAnnotations) {
                      const cachedAnnotated = this.bulkAnnotatedImagesMap.get(localImg.imageId)
                        || (localImg.attachId ? this.bulkAnnotatedImagesMap.get(localImg.attachId) : null);
                      if (cachedAnnotated) {
                        thumbnailUrl = cachedAnnotated;
                      }
                    }

                    localPoint.photos.push({
                      imageId: localImg.imageId,
                      localImageId: localImg.imageId,
                      attachId: localImg.attachId || localImg.imageId,
                      photoType: localImg.photoType || 'Measurement',
                      url: displayUrl,
                      displayUrl: thumbnailUrl,  // Use annotated if available
                      thumbnailUrl: thumbnailUrl,
                      caption: localImg.caption || '',
                      drawings: localImg.drawings || null,
                      hasAnnotations: hasAnnotations,
                      uploading: false,  // SILENT SYNC: Never show spinner
                      queued: false,     // SILENT SYNC: Never show queued indicator
                      isPending: localImg.status !== 'verified',
                      isLocalImage: true,
                      isLocalFirst: true,
                      _tempId: localImg.imageId,
                    });
                    console.log(`[RoomElevation] BULLETPROOF: Restored photo from LocalImage ${localImg.imageId} for point "${pointName}" (displayUrl: ${displayUrl.substring(0, 50)}...)`);
                  }
                } else {
                  localPoint.photos = [];
                }
              }
            }

            // CRITICAL: Reload photos for this point
            const pointAttachments = attachments.filter((att: any) => String(att.PointID) === pointIdStr);
            console.log(`[RoomElevation] Found ${pointAttachments.length} attachments for point "${pointName}"`);

            // Build a comprehensive set of existing photo IDs to avoid duplicates
            // CRITICAL FIX: Include ALL possible ID fields (attachId, imageId, _tempId, localImageId)
            const existingPhotoIds = new Set<string>();
            for (const p of (localPoint.photos || [])) {
              if (p.attachId) existingPhotoIds.add(String(p.attachId));
              if (p.imageId) existingPhotoIds.add(String(p.imageId));
              if (p._tempId) existingPhotoIds.add(String(p._tempId));
              if (p.localImageId) existingPhotoIds.add(String(p.localImageId));
              if (p.AttachID) existingPhotoIds.add(String(p.AttachID));
            }

            for (const attach of pointAttachments) {
              const attachIdStr = String(attach.AttachID || attach.PK_ID);

              // TASK 1 FIX: Check if this server attachment matches any LocalImage we have
              // This handles the case where photo was captured with imageId, then synced to get real attachId
              // The in-memory photo still has imageId as attachId, but server has the real attachId
              let matchingImageId: string | null = null;
              const localImagesForPoint = this.bulkLocalImagesMap.get(pointIdStr) || [];
              for (const localImg of localImagesForPoint) {
                if (localImg.attachId === attachIdStr) {
                  matchingImageId = localImg.imageId;
                  break;
                }
              }

              // Check if we already have this photo (by direct ID match OR via LocalImage mapping)
              const alreadyExists = existingPhotoIds.has(attachIdStr) ||
                (matchingImageId && existingPhotoIds.has(matchingImageId));

              if (alreadyExists) {
                // Find the existing photo - check all possible ID matches
                let existingPhoto = localPoint.photos.find((p: any) =>
                  String(p.attachId) === attachIdStr ||
                  String(p.imageId) === attachIdStr ||
                  (matchingImageId && (
                    String(p.imageId) === matchingImageId ||
                    String(p.localImageId) === matchingImageId ||
                    String(p.attachId) === matchingImageId
                  ))
                );

                if (existingPhoto) {
                  // CRITICAL: Update attachId to the real server ID so future matches work
                  if (existingPhoto.attachId !== attachIdStr) {
                    console.log(`[RoomElevation] Updating photo attachId: ${existingPhoto.attachId} -> ${attachIdStr}`);
                    existingPhoto.attachId = attachIdStr;
                    existingPhoto.AttachID = attachIdStr;
                  }

                  // If photo has a valid displayUrl, keep it - DON'T replace
                  // BULLETPROOF: Any displayUrl that isn't a placeholder is valid
                  // Matches category-detail.page.ts pattern at line 1071-1073
                  const hasValidDisplayUrl = existingPhoto.displayUrl &&
                    existingPhoto.displayUrl !== 'assets/img/photo-placeholder.png' &&
                    !existingPhoto.displayUrl.includes('placeholder') &&
                    !existingPhoto.loading;

                  // If photo is still loading/placeholder AND doesn't have local blob, try to load from S3
                  if (!hasValidDisplayUrl && (existingPhoto.loading || existingPhoto.url === 'assets/img/photo-placeholder.png')) {
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
              
              // Add new photo from server - check cache FIRST for fast display
              const photoType = attach.Type || attach.photoType || 'Measurement';
              // EMPTY_COMPRESSED_ANNOTATIONS is imported from annotation-utils

              // FAST LOAD FIX: Check bulk cache FIRST before setting placeholder
              let cachedDisplayUrl: string | null = null;

              // Check for cached ANNOTATED image first
              // TASK 3 FIX: Check both attachId AND localImageId for local-first photos
              const attachLocalImageId = attach.localImageId || attach.imageId;
              const cachedAnnotatedImage = this.bulkAnnotatedImagesMap.get(attachIdStr)
                || (attachLocalImageId ? this.bulkAnnotatedImagesMap.get(String(attachLocalImageId)) : null);

              if (cachedAnnotatedImage) {
                cachedDisplayUrl = cachedAnnotatedImage;
                console.log(`[RoomElevation] ✅ Using cached ANNOTATED image for new photo ${attachIdStr}`);
              }

              // Check bulk cached photo if no annotated version
              if (!cachedDisplayUrl) {
                const cachedImage = this.bulkCachedPhotosMap.get(attachIdStr);
                if (cachedImage) {
                  cachedDisplayUrl = cachedImage;
                  console.log(`[RoomElevation] ✅ Using cached image for new photo ${attachIdStr}`);
                }
              }

              const photoData: any = {
                attachId: attach.AttachID || attach.PK_ID,
                photoType: photoType,
                url: cachedDisplayUrl || 'assets/img/photo-placeholder.png',
                displayUrl: cachedDisplayUrl || 'assets/img/photo-placeholder.png',
                caption: attach.Annotation || '',
                drawings: attach.Drawings || null,
                hasAnnotations: !!(attach.Drawings && attach.Drawings !== 'null' && attach.Drawings !== '' && attach.Drawings !== EMPTY_COMPRESSED_ANNOTATIONS),
                path: attach.Attachment || attach.Photo || null,
                Attachment: attach.Attachment,
                Photo: attach.Photo,
                uploading: false,
                loading: !cachedDisplayUrl  // Only loading if no cache
              };

              // Ensure photos array exists
              if (!localPoint.photos) {
                localPoint.photos = [];
              }

              localPoint.photos.push(photoData);
              existingPhotoIds.add(attachIdStr);

              // Only fetch from remote if NOT cached
              const s3Key = attach.Attachment || attach.Photo;
              if (s3Key && !cachedDisplayUrl) {
                this.loadPointPhotoImage(s3Key, photoData).catch(err => {
                  console.warn('[RoomElevation] Failed to load new photo:', err);
                });
              }
            }
          }
        }
      }

      // CRITICAL: Merge pending photos into local points
      // This ensures photos added offline persist during reload
      if (this.roomData?.elevationPoints && pendingPhotosMap.size > 0) {
        for (const point of this.roomData.elevationPoints) {
          const pointIdStr = String(point.pointId);
          const pendingPhotos = pendingPhotosMap.get(pointIdStr);

          if (pendingPhotos && pendingPhotos.length > 0) {
            console.log(`[RoomElevation] Merging ${pendingPhotos.length} pending photos for point "${point.name}"`);

            // Build comprehensive set of existing photo IDs to avoid duplicates
            // CRITICAL FIX: Include ALL possible ID fields
            const existingPhotoIds = new Set<string>();
            for (const p of (point.photos || [])) {
              if (p.attachId) existingPhotoIds.add(String(p.attachId));
              if (p.imageId) existingPhotoIds.add(String(p.imageId));
              if (p._tempId) existingPhotoIds.add(String(p._tempId));
              if (p.localImageId) existingPhotoIds.add(String(p.localImageId));
              if (p.AttachID) existingPhotoIds.add(String(p.AttachID));
              if (p._pendingFileId) existingPhotoIds.add(String(p._pendingFileId));
            }

            for (const pendingPhoto of pendingPhotos) {
              const pendingAttachId = String(pendingPhoto.AttachID || pendingPhoto._pendingFileId);

              // Skip if already exists (check multiple ID fields)
              if (existingPhotoIds.has(pendingAttachId)) {
                continue;
              }

              // CRITICAL: Prioritize url (fresh blob URL from IndexedDB) over stored displayUrl
              let displayUrl = pendingPhoto.url || pendingPhoto.displayUrl || pendingPhoto.thumbnailUrl;

              // PERFORMANCE FIX: Use bulk map (O(1) lookup) instead of individual IndexedDB calls
              // TASK 3 FIX: Check both pendingAttachId AND localImageId for local-first photos
              const pendingLocalImageId = pendingPhoto.localImageId || pendingPhoto.imageId;
              const cachedAnnotatedImage = this.bulkAnnotatedImagesMap.get(pendingAttachId)
                || (pendingLocalImageId ? this.bulkAnnotatedImagesMap.get(String(pendingLocalImageId)) : null);
              if (cachedAnnotatedImage) {
                displayUrl = cachedAnnotatedImage;
              }

              const pendingPhotoData: any = {
                attachId: pendingAttachId,
                // CRITICAL: Set imageId and localImageId for LocalImage matching
                imageId: pendingPhoto.imageId || pendingLocalImageId,
                localImageId: pendingPhoto.localImageId || pendingLocalImageId,
                photoType: pendingPhoto.Type || pendingPhoto.photoType || 'Measurement',
                url: pendingPhoto.url || displayUrl,
                displayUrl: displayUrl,
                caption: pendingPhoto.caption || pendingPhoto.Annotation || '',
                drawings: pendingPhoto.Drawings || pendingPhoto.drawings || null,
                hasAnnotations: !!(pendingPhoto.Drawings || pendingPhoto.drawings),
                uploading: false,
                queued: true,
                isPending: true,
                _tempId: pendingAttachId,
              };

              if (!point.photos) {
                point.photos = [];
              }
              point.photos.push(pendingPhotoData);
              console.log(`[RoomElevation] Added pending photo ${pendingAttachId} to point "${point.name}"`);
            }
          }
        }
      }

      // CRITICAL FIX: Merge LocalImages into local points
      // This ensures photos from the new local-first system persist during reload
      if (this.roomData?.elevationPoints && bulkLocalImagesMap.size > 0) {
        for (const point of this.roomData.elevationPoints) {
          const pointIdStr = String(point.pointId);

          // CRITICAL FIX: Also check for LocalImages by point name (via preserved mapping)
          // This handles the case where pointId changed during sync
          let localImagesForPoint = bulkLocalImagesMap.get(pointIdStr) || [];

          // If no images found by ID, try by temp ID mapping
          if (localImagesForPoint.length === 0 && point.name) {
            // Check if we have preserved photos that might have LocalImage references
            const preserved = preservedPhotosByPointName.get(point.name);
            if (preserved) {
              // Look for LocalImages that match any of the preserved photo IDs
              for (const preservedPhoto of preserved) {
                if (preservedPhoto.localImageId || preservedPhoto.imageId) {
                  const lookupId = preservedPhoto.localImageId || preservedPhoto.imageId;
                  // Search all LocalImages for this ID
                  const mapEntries = Array.from(bulkLocalImagesMap.entries());
                  for (let i = 0; i < mapEntries.length; i++) {
                    const images = mapEntries[i][1];
                    const match = images.find((img: any) => img.imageId === lookupId);
                    if (match && !localImagesForPoint.includes(match)) {
                      localImagesForPoint.push(match);
                    }
                  }
                }
              }
            }
          }

          if (localImagesForPoint.length > 0) {
            console.log(`[RoomElevation] Merging ${localImagesForPoint.length} LocalImages for point "${point.name}"`);

            // Build comprehensive set of existing photo IDs to avoid duplicates
            const existingPhotoIds = new Set<string>();
            for (const p of (point.photos || [])) {
              if (p.attachId) existingPhotoIds.add(String(p.attachId));
              if (p.imageId) existingPhotoIds.add(String(p.imageId));
              if (p._tempId) existingPhotoIds.add(String(p._tempId));
              if (p.localImageId) existingPhotoIds.add(String(p.localImageId));
              if (p.AttachID) existingPhotoIds.add(String(p.AttachID));
              if (p._pendingFileId) existingPhotoIds.add(String(p._pendingFileId));
            }

            for (const localImage of localImagesForPoint) {
              const imageId = localImage.imageId;

              // Skip if already added (check all possible ID fields)
              if (existingPhotoIds.has(imageId)) {
                console.log(`[RoomElevation] Skipping duplicate LocalImage: ${imageId}`);
                continue;
              }
              if (localImage.attachId && existingPhotoIds.has(String(localImage.attachId))) {
                console.log(`[RoomElevation] Skipping duplicate LocalImage by attachId: ${localImage.attachId}`);
                continue;
              }

              // Get display URL from LocalImageService
              let displayUrl = 'assets/img/photo-placeholder.png';
              try {
                displayUrl = await this.localImageService.getDisplayUrl(localImage);
              } catch (e) {
                console.warn('[RoomElevation] Failed to get LocalImage displayUrl:', e);
              }

              // ANNOTATION FIX: Check for cached annotated image for thumbnail display
              const hasAnnotations = !!(localImage.drawings && localImage.drawings.length > 10);
              let thumbnailUrl = displayUrl;
              if (hasAnnotations) {
                const cachedAnnotated = this.bulkAnnotatedImagesMap.get(localImage.imageId)
                  || (localImage.attachId ? this.bulkAnnotatedImagesMap.get(String(localImage.attachId)) : null);
                if (cachedAnnotated) {
                  thumbnailUrl = cachedAnnotated;
                }
              }

              const localPhotoData: any = {
                imageId: localImage.imageId,
                AttachID: localImage.attachId || localImage.imageId,
                attachId: localImage.attachId || localImage.imageId,
                localImageId: localImage.imageId,
                localBlobId: localImage.localBlobId,
                photoType: localImage.photoType || 'Measurement',
                Type: localImage.photoType || 'Measurement',
                url: displayUrl,
                displayUrl: thumbnailUrl,  // Use annotated if available
                thumbnailUrl: thumbnailUrl,
                caption: localImage.caption || '',
                Annotation: localImage.caption || '',
                drawings: localImage.drawings || null,
                Drawings: localImage.drawings || null,
                hasAnnotations: hasAnnotations,
                uploading: false,
                queued: false,
                isPending: localImage.status !== 'verified',
                isLocalImage: true,
                isLocalFirst: true,
                _tempId: localImage.imageId,
              };

              if (!point.photos) {
                point.photos = [];
              }
              point.photos.push(localPhotoData);
              console.log(`[RoomElevation] Added LocalImage ${imageId} to point "${point.name}"`);
            }
          }
        }
      }

      this.changeDetectorRef.detectChanges();
      console.log('[RoomElevation] Elevation data reload complete');

      // TASK 1 FIX: Update class-level preservation maps after successful reload
      // This ensures photos survive subsequent navigations and reloads
      if (this.roomData?.elevationPoints) {
        for (const point of this.roomData.elevationPoints) {
          if (point.photos && point.photos.length > 0) {
            const photosWithUrls = point.photos.filter((p: any) =>
              p.displayUrl &&
              p.displayUrl !== 'assets/img/photo-placeholder.png' &&
              !p.displayUrl.includes('placeholder')
            );
            if (photosWithUrls.length > 0) {
              const photosCopy = photosWithUrls.map((p: any) => ({ ...p }));
              this.preservedPhotosByPointName.set(point.name, photosCopy);
              if (point.pointId) {
                this.preservedPhotosByPointId.set(String(point.pointId), photosCopy);
              }
            }
          }
        }
        console.log(`[RoomElevation] Updated preservation maps after reload: ${this.preservedPhotosByPointName.size} points`);
      }

      // Set cooldown to prevent rapid re-invalidations
      this.startLocalOperationCooldown();

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
    if (this.localOperationCooldownTimer) {
      clearTimeout(this.localOperationCooldownTimer);
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
    if (this.syncStatusSubscription) {
      this.syncStatusSubscription.unsubscribe();
    }
    if (this.efeRoomSyncSubscription) {
      this.efeRoomSyncSubscription.unsubscribe();
    }
    if (this.backgroundRefreshSubscription) {
      this.backgroundRefreshSubscription.unsubscribe();
    }
    if (this.localImageStatusSubscription) {
      this.localImageStatusSubscription.unsubscribe();
    }
    if (this.localImagesSubscription) {
      this.localImagesSubscription.unsubscribe();
    }
    if (this.fdfLocalImagesSubscription) {
      this.fdfLocalImagesSubscription.unsubscribe();
    }
    // DEXIE-FIRST: Clean up EfeField subscription
    if (this.efeFieldSubscription) {
      this.efeFieldSubscription.unsubscribe();
    }

    // NOTE: We intentionally do NOT revoke blob URLs here anymore.
    // Revoking causes images to disappear when navigating back to this page
    // because ionViewWillEnter may skip reload if data appears cached.
    // Blob URLs are now properly cleaned up when LocalImages are pruned after sync.
    // See refreshLocalState() for how we regenerate URLs on page return.

    console.log('[ROOM ELEVATION] Component destroyed, but uploads continue in background');
  }

  /**
   * Start local operation cooldown to prevent cache invalidation during photo operations
   * TASK 1 FIX: Matches category-detail.page.ts pattern - prevents images from disappearing
   * during sync status changes by blocking reload triggers
   */
  private startLocalOperationCooldown(): void {
    console.log('[RoomElevation] Starting local operation cooldown (2s)');

    // Clear any existing timer
    if (this.localOperationCooldownTimer) {
      clearTimeout(this.localOperationCooldownTimer);
    }

    this.localOperationCooldown = true;
    this.localOperationCooldownTimer = setTimeout(() => {
      this.localOperationCooldown = false;
      console.log('[RoomElevation] Local operation cooldown ended');
    }, 2000); // 2 second cooldown after local operation
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

  /**
   * DEXIE-FIRST: Initialize room data from Dexie for instant loading
   * This replaces the slow loadRoomData() -> foundationData.getEFEByService() flow
   * with direct Dexie reads that are instant.
   */
  /**
   * DEXIE-FIRST: Initialize room-elevation page from Dexie only
   *
   * Key principles:
   * - ALL data comes from Dexie (no API calls here)
   * - Points already have tempPointIds (created when room was added)
   * - Instant display - no loading spinners
   * - Photos loaded from LocalImages separately
   */
  private async initializeFromDexie(): Promise<void> {
    console.time('[RoomElevation] initializeFromDexie');
    console.log('[RoomElevation] DEXIE-FIRST: Loading from Dexie only');
    console.log('[RoomElevation] serviceId:', this.serviceId, 'roomName:', this.roomName);

    // Unsubscribe from previous subscription if exists
    if (this.efeFieldSubscription) {
      this.efeFieldSubscription.unsubscribe();
    }

    // 1. Read from Dexie (ONLY source of truth)
    let field: EfeField | undefined;
    try {
      field = await this.efeFieldRepo.getFieldByRoom(this.serviceId, this.roomName);
    } catch (err: any) {
      console.error('[RoomElevation] Dexie read error:', err);
      this.loading = false;
      return;
    }

    if (!field) {
      // Room not in Dexie - this indicates a bug in the flow
      console.error('[RoomElevation] DEXIE-FIRST ERROR: Room not found in Dexie - flow bug');
      this.loading = false;
      return;
    }

    console.log('[RoomElevation] DEXIE-FIRST: Room found in Dexie');

    // 2. Set roomId from Dexie (prefer real ID, fallback to temp)
    this.roomId = field.efeId || field.tempEfeId || '';
    this.lastLoadedRoomId = this.roomId;

    // 2.5 CRITICAL: Check if points need tempPointIds created
    // This handles rooms seeded from templates where points have no IDs yet
    const pointsNeedIds = field.elevationPoints.some(p => !p.pointId && !p.tempPointId);
    if (pointsNeedIds && this.roomId) {
      console.log('[RoomElevation] Points need tempPointIds - creating now');

      try {
        // Create tempPointIds and queue points for sync
        const createdPoints = await this.efeFieldRepo.createPointRecordsForRoom(
          this.serviceId,
          this.roomName,
          this.roomId,
          this.foundationData
        );
        console.log('[RoomElevation] Created', createdPoints.length, 'points with tempPointIds');

        // Reload field from Dexie to get updated points
        const updatedField = await this.efeFieldRepo.getFieldByRoom(this.serviceId, this.roomName);
        if (updatedField) {
          field = updatedField;
        }
      } catch (err: any) {
        console.error('[RoomElevation] Failed to create tempPointIds:', err);
      }
    }

    // 3. Populate roomData DIRECTLY from Dexie
    // Points should now have IDs (temp or real)
    this.roomData = {
      roomName: field.roomName,
      templateId: field.templateId,
      notes: field.notes || '',
      fdf: field.fdf || '',
      location: field.location || '',
      elevationPoints: field.elevationPoints.map(ep => ({
        name: ep.name,
        pointId: ep.pointId || ep.tempPointId,  // Use real or temp ID
        pointNumber: ep.pointNumber,
        value: ep.value || '',
        photos: [],  // Will be populated from LocalImages
        expanded: false
      })),
      fdfPhotos: {
        top: field.fdfPhotos?.['top']?.hasPhoto || field.fdfPhotos?.['top'] || null,
        bottom: field.fdfPhotos?.['bottom']?.hasPhoto || field.fdfPhotos?.['bottom'] || null,
        topDetails: field.fdfPhotos?.['topDetails']?.hasPhoto || field.fdfPhotos?.['topDetails'] || null,
        bottomDetails: field.fdfPhotos?.['bottomDetails']?.hasPhoto || field.fdfPhotos?.['bottomDetails'] || null,
        threshold: field.fdfPhotos?.['threshold']?.hasPhoto || field.fdfPhotos?.['threshold'] || null,
        // DEXIE-FIRST: Load captions from efeFields.fdfPhotos
        topCaption: field.fdfPhotos?.['top']?.caption || '',
        bottomCaption: field.fdfPhotos?.['bottom']?.caption || '',
        thresholdCaption: field.fdfPhotos?.['threshold']?.caption || '',
        // Load imageIds for LocalImage lookups
        topImageId: field.fdfPhotos?.['top']?.imageId || null,
        bottomImageId: field.fdfPhotos?.['bottom']?.imageId || null,
        thresholdImageId: field.fdfPhotos?.['threshold']?.imageId || null
      }
    };

    // 4. All points have IDs (temp or real) - buttons should be enabled
    this.isLoadingPoints = false;
    this.loading = false;
    this.changeDetectorRef.detectChanges();

    // 5. Load photos from LocalImages (separate from point data)
    await this.populatePhotosFromLocalImages();

    // 6. Subscribe to liveQuery for reactive updates
    this.efeFieldSubscription = this.efeFieldRepo
      .getFieldByRoom$(this.serviceId, this.roomName)
      .subscribe({
        next: (updatedField) => {
          if (!updatedField) return;

          console.log('[RoomElevation] liveQuery update received');

          // Update metadata from liveQuery
          if (this.roomData) {
            this.roomData.notes = updatedField.notes || this.roomData.notes;
            this.roomData.fdf = updatedField.fdf || this.roomData.fdf;
            this.roomData.location = updatedField.location || this.roomData.location;

            // Update point values, names, and IDs from Dexie
            for (const efePoint of updatedField.elevationPoints) {
              const existingPoint = this.roomData.elevationPoints.find(
                (p: any) => p.pointNumber === efePoint.pointNumber
              );
              if (existingPoint) {
                // DEXIE-FIRST: Update name from Dexie (for renamed points)
                if (efePoint.name && existingPoint.name !== efePoint.name) {
                  console.log(`[RoomElevation] Point ${efePoint.pointNumber} name updated: "${existingPoint.name}" → "${efePoint.name}"`);
                  existingPoint.name = efePoint.name;
                }
                if (efePoint.value) existingPoint.value = efePoint.value;
                // Update pointId if it changed (temp → real after sync)
                if (efePoint.pointId && existingPoint.pointId !== efePoint.pointId) {
                  console.log(`[RoomElevation] Point ${efePoint.pointNumber} ID updated: ${existingPoint.pointId} → ${efePoint.pointId}`);
                  existingPoint.pointId = efePoint.pointId;
                }
              }
            }
          }

          // Update roomId if it changed (temp → real after sync)
          if (updatedField.efeId && this.roomId !== updatedField.efeId) {
            console.log(`[RoomElevation] RoomId updated: ${this.roomId} → ${updatedField.efeId}`);
            this.roomId = updatedField.efeId;
            this.lastLoadedRoomId = this.roomId;
          }

          this.changeDetectorRef.detectChanges();
        },
        error: (err) => {
          console.error('[RoomElevation] liveQuery error (non-fatal):', err);
          // Non-fatal: we already have data from initial read
        }
      });

    // Mark initial load complete
    this.initialLoadComplete = true;
    this.changeDetectorRef.detectChanges();
    console.timeEnd('[RoomElevation] initializeFromDexie');
  }

  /**
   * DEXIE-FIRST: Load photos from LocalImages table
   * Matches photos to elevation points by entityId (which can be temp or real pointId)
   */
  private async populatePhotosFromLocalImages(): Promise<void> {
    if (!this.roomData?.elevationPoints) {
      console.log('[RoomElevation] No elevation points to populate photos for');
      return;
    }

    console.log('[RoomElevation] populatePhotosFromLocalImages - Loading photos from LocalImages');

    try {
      // Get all LocalImages for this service's elevation points
      const allLocalImages = await this.localImageService.getImagesForService(this.serviceId, 'efe_point');
      console.log(`[RoomElevation] Found ${allLocalImages.length} LocalImages for efe_point`);

      // Group LocalImages by entityId (pointId)
      const localImagesMap = new Map<string, any[]>();
      for (const img of allLocalImages) {
        if (!img.entityId) continue;

        const entityId = String(img.entityId);

        // Add by original entityId
        if (!localImagesMap.has(entityId)) {
          localImagesMap.set(entityId, []);
        }
        localImagesMap.get(entityId)!.push(img);

        // Also add by resolved real ID if entityId is a temp ID
        // This ensures photos show after the parent point syncs
        if (entityId.startsWith('temp_')) {
          const realId = await this.indexedDb.getRealId(entityId);
          if (realId && realId !== entityId) {
            if (!localImagesMap.has(realId)) {
              localImagesMap.set(realId, []);
            }
            const existing = localImagesMap.get(realId)!;
            if (!existing.some((e: any) => e.imageId === img.imageId)) {
              existing.push(img);
            }
          }
        }
      }

      // Update class-level map for liveQuery updates
      this.bulkLocalImagesMap = localImagesMap;
      console.log(`[RoomElevation] Built LocalImagesMap with ${localImagesMap.size} point groups`);

      // Populate photos for each elevation point
      for (const point of this.roomData.elevationPoints) {
        const pointId = point.pointId;
        if (!pointId) continue;

        const pointIdStr = String(pointId);

        // Check for LocalImages by pointId
        let localImagesForPoint = localImagesMap.get(pointIdStr) || [];

        // FIX: If pointId is a temp ID, resolve to real ID and look up by that
        // This handles the case where point synced (photos have real entityId)
        // but EfeField wasn't updated with the real pointId yet
        if (localImagesForPoint.length === 0 && pointIdStr.startsWith('temp_')) {
          const resolvedRealId = await this.indexedDb.getRealId(pointIdStr);
          if (resolvedRealId && resolvedRealId !== pointIdStr) {
            localImagesForPoint = localImagesMap.get(resolvedRealId) || [];
            if (localImagesForPoint.length > 0) {
              console.log(`[RoomElevation] Resolved temp ID ${pointIdStr} -> ${resolvedRealId}, found ${localImagesForPoint.length} photos`);
            }
          }
        }

        // Also check by temp-to-real mapping (if pointId is real but photos have temp entityId)
        if (localImagesForPoint.length === 0) {
          // Check if there's a temp ID that maps to this real ID
          for (const [tempId, images] of localImagesMap.entries()) {
            if (tempId.startsWith('temp_')) {
              const mappedRealId = await this.indexedDb.getRealId(tempId);
              if (mappedRealId === pointIdStr) {
                localImagesForPoint = images;
                break;
              }
            }
          }
        }

        if (localImagesForPoint.length === 0) continue;

        console.log(`[RoomElevation] Found ${localImagesForPoint.length} photos for point ${point.name} (${pointIdStr})`);

        // Convert LocalImages to photo objects
        point.photos = [];
        for (const localImage of localImagesForPoint) {
          // Get display URL
          let displayUrl = 'assets/img/photo-placeholder.png';
          try {
            displayUrl = await this.localImageService.getDisplayUrl(localImage);
          } catch (e) {
            console.warn('[RoomElevation] Failed to get LocalImage displayUrl:', e);
          }

          point.photos.push({
            imageId: localImage.imageId,
            attachId: localImage.attachId || localImage.imageId,
            photoType: localImage.photoType || 'Measurement',
            displayUrl,
            url: displayUrl,
            caption: localImage.caption || '',
            annotations: localImage.annotations || null,
            isLocalImage: true,
            isLocalFirst: true,
            localImageId: localImage.imageId,
            syncStatus: localImage.syncStatus || 'pending'
          });
        }
      }

      // Also load FDF photos if any
      await this.populateFdfPhotosFromLocalImages(localImagesMap);

      console.log('[RoomElevation] populatePhotosFromLocalImages - Complete');
    } catch (error) {
      console.error('[RoomElevation] Error loading photos from LocalImages:', error);
    }
  }

  /**
   * DEXIE-FIRST: Load FDF photos from LocalImages
   */
  private async populateFdfPhotosFromLocalImages(localImagesMap?: Map<string, any[]>): Promise<void> {
    if (!this.roomData?.fdfPhotos || !this.roomId) return;

    // FDF FIX: The localImagesMap only contains efe_point images keyed by pointId
    // FDF images have a different entityType ('fdf') and are keyed by roomId
    // So we must ALWAYS fetch FDF images separately - the map doesn't contain them
    let fdfImages: any[] = [];
    const allFdfImages = await this.localImageService.getImagesForService(this.serviceId, 'fdf');
    fdfImages = allFdfImages.filter((img: any) => String(img.entityId) === String(this.roomId));

    // Also check for FDF photos with temp roomId that maps to current real roomId
    if (!String(this.roomId).startsWith('temp_')) {
      for (const img of allFdfImages) {
        if (String(img.entityId).startsWith('temp_')) {
          try {
            const realId = await this.indexedDb.getRealId(img.entityId);
            if (realId === this.roomId && !fdfImages.some(f => f.imageId === img.imageId)) {
              fdfImages.push(img);
              console.log(`[RoomElevation] Found FDF photo via temp->real mapping: ${img.imageId}`);
            }
          } catch (e) {
            // Ignore mapping errors
          }
        }
      }
    }

    console.log(`[RoomElevation] populateFdfPhotosFromLocalImages: Found ${fdfImages.length} FDF images for room ${this.roomId}`);

    for (const localImage of fdfImages) {
      const photoType = localImage.photoType as string;
      if (!photoType) continue;

      // Map photoType to fdfPhotos key
      let fdfKey = '';
      if (photoType.includes('Top') && photoType.includes('Details')) {
        fdfKey = 'topDetails';
      } else if (photoType.includes('Bottom') && photoType.includes('Details')) {
        fdfKey = 'bottomDetails';
      } else if (photoType.includes('Top')) {
        fdfKey = 'top';
      } else if (photoType.includes('Bottom')) {
        fdfKey = 'bottom';
      } else if (photoType.includes('Threshold')) {
        fdfKey = 'threshold';
      }

      if (!fdfKey) continue;

      let displayUrl = 'assets/img/photo-placeholder.png';
      try {
        displayUrl = await this.localImageService.getDisplayUrl(localImage);
      } catch (e) {
        console.warn('[RoomElevation] Failed to get FDF LocalImage displayUrl:', e);
      }

      // Update fdfPhotos - set ALL properties to match loadLocalFDFPhotos pattern
      const fdfPhotos = this.roomData.fdfPhotos as any;
      fdfPhotos[fdfKey] = true;
      fdfPhotos[`${fdfKey}Url`] = displayUrl;
      fdfPhotos[`${fdfKey}DisplayUrl`] = displayUrl;
      fdfPhotos[`${fdfKey}Caption`] = localImage.caption || fdfPhotos[`${fdfKey}Caption`] || '';
      fdfPhotos[`${fdfKey}Drawings`] = localImage.drawings || fdfPhotos[`${fdfKey}Drawings`] || null;
      fdfPhotos[`${fdfKey}Loading`] = false;
      fdfPhotos[`${fdfKey}Uploading`] = false;
      fdfPhotos[`${fdfKey}Queued`] = false;
      fdfPhotos[`${fdfKey}ImageId`] = localImage.imageId;
      fdfPhotos[`${fdfKey}LocalBlobId`] = localImage.localBlobId;
      fdfPhotos[`${fdfKey}IsLocalFirst`] = true;
      fdfPhotos[`${fdfKey}HasAnnotations`] = !!(localImage.drawings && localImage.drawings.length > 10);

      console.log(`[RoomElevation] ✅ Loaded FDF ${fdfKey} from LocalImages: ${localImage.imageId}`);
    }
  }

  private async loadRoomData() {
    console.log('[RoomElevation] loadRoomData() called');
    console.log('  - ServiceId:', this.serviceId);
    console.log('  - RoomName:', this.roomName);

    // OFFLINE-FIRST: Don't show loading spinner if we have cached data
    // Data is already cached by the container's template download
    // Only show loading for first-time fetches (no cache)
    try {
      // Pre-load photo caches in parallel (non-blocking for room data)
      // Photo loading will await this promise before checking caches
      this.cacheLoadPromise = this.preloadPhotoCaches();

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
        this.goBack();
        return;
      }

      this.roomId = room.EFEID;
      console.log('[RoomElevation] Room ID set to:', this.roomId);
      console.log('[RoomElevation] Room TemplateID from database:', room.TemplateID);
      console.log('[RoomElevation] Room FDF value from database:', room.FDF);
      console.log('[RoomElevation] Room full record:', room);

      // CRITICAL FIX: Preserve existing photos BEFORE clearing roomData
      // This prevents photos from disappearing during reloads/sync - matches category-detail pattern
      const syncStatus = this.backgroundSync.syncStatus$.getValue();
      const syncInProgress = syncStatus.isSyncing;

      // Preserve elevation point photos by point name AND point ID
      this.preservedPhotosByPointName = new Map<string, any[]>();
      this.preservedPhotosByPointId = new Map<string, any[]>();

      if (this.roomData?.elevationPoints) {
        for (const point of this.roomData.elevationPoints) {
          if (point.photos && point.photos.length > 0) {
            // TASK 1 FIX: ALWAYS preserve ALL photos with ANY identifier
            // This is the key fix - we NEVER want photos to disappear
            // Previously this was conditional on syncInProgress which caused photos to vanish
            const photosToPreserve = point.photos.filter((p: any) =>
              p.attachId ||         // Synced photos have real attachId
              p.imageId ||          // LocalImage system photos
              p.localImageId ||     // LocalImage reference
              p._pendingFileId ||   // Legacy pending system
              p._tempId ||          // Temp ID reference
              p.uploading ||        // Currently uploading
              p.queued ||           // Queued for upload
              p.isLocalImage ||     // LocalImage flag
              p.isLocalFirst ||     // Local-first flag
              (p.displayUrl && p.displayUrl !== 'assets/img/photo-placeholder.png')  // Has any real URL
            );

            if (photosToPreserve.length > 0) {
              // Deep copy photos to prevent mutation issues
              const photosCopy = photosToPreserve.map((p: any) => ({ ...p }));

              // Preserve by point name
              this.preservedPhotosByPointName.set(point.name, photosCopy);

              // Also preserve by point ID if available
              if (point.pointId) {
                this.preservedPhotosByPointId.set(String(point.pointId), photosCopy);
              }

              console.log(`[RoomElevation] PRESERVED ${photosCopy.length} photos for point "${point.name}" (ID: ${point.pointId})`);
            }
          }
        }
      }
      console.log(`[RoomElevation] Total preserved: ${this.preservedPhotosByPointName.size} points with photos`);

      // Preserve FDF photos
      this.preservedFdfPhotos = this.roomData?.fdfPhotos ? { ...this.roomData.fdfPhotos } : null;
      if (this.preservedFdfPhotos) {
        console.log('[RoomElevation] Preserved FDF photos state');
      }

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

      // PERFORMANCE: Load FDF photos and elevation points IN PARALLEL
      // This eliminates the 3-second lag by not waiting for FDF photos before loading points
      this.isLoadingPoints = true;
      this.changeDetectorRef.detectChanges(); // Show loading state immediately
      
      await Promise.all([
        this.loadFDFPhotos(room),
        this.loadElevationPoints()
      ]);
      
      this.isLoadingPoints = false;
      this.changeDetectorRef.detectChanges();
    } catch (error: any) {
      console.error('Error loading room data:', error);
    }
    
    // Track last loaded room ID to detect context changes on re-entry
    this.lastLoadedRoomId = this.roomId;
    
    // OFFLINE-FIRST: No loading spinner management needed - data from IndexedDB is instant
  }

  /**
   * Pre-load cached photos and annotated images
   * This ensures synced images display instantly without S3 fetches
   * MUST be awaited before loading photos for fast cache hits
   */
  private async preloadPhotoCaches(): Promise<void> {
    try {
      const cacheLoadStart = Date.now();
      const [cachedPhotos, annotatedImages] = await Promise.all([
        this.indexedDb.getAllCachedPhotosForService(this.serviceId),
        this.indexedDb.getAllCachedAnnotatedImagesForService()
      ]);

      this.bulkCachedPhotosMap = cachedPhotos;
      this.bulkAnnotatedImagesMap = annotatedImages;

      console.log(`[RoomElevation] Pre-loaded ${cachedPhotos.size} photos, ${annotatedImages.size} annotations in ${Date.now() - cacheLoadStart}ms`);
    } catch (error) {
      console.warn('[RoomElevation] Failed to pre-load caches:', error);
      // Not critical - photos will load on-demand as fallback
    }
  }

  /**
   * ANNOTATION FIX: Reload only the annotated images cache
   * Called when LocalImages change to ensure fresh annotated images are used
   */
  private async reloadAnnotatedImagesCache(): Promise<void> {
    try {
      const annotatedImages = await this.indexedDb.getAllCachedAnnotatedImagesForService();
      this.bulkAnnotatedImagesMap = annotatedImages;
      console.log(`[RoomElevation] Reloaded ${annotatedImages.size} annotated images cache`);
    } catch (error) {
      console.warn('[RoomElevation] Failed to reload annotated images cache:', error);
    }
  }

  private async loadFDFPhotos(room: any) {
    const fdfPhotos = this.roomData.fdfPhotos;
    // EMPTY_COMPRESSED_ANNOTATIONS is imported from annotation-utils

    // CRITICAL FIX: Check if we have preserved FDF photos with local blob/data URLs
    // During sync, we should preserve these URLs instead of resetting to placeholders
    const preserved = this.preservedFdfPhotos;
    const syncStatus = this.backgroundSync.syncStatus$.getValue();
    const syncInProgress = syncStatus.isSyncing;

    // Helper function to check if a URL is a local blob or data URL worth preserving
    const hasValidLocalUrl = (url: string | null) => url && (url.startsWith('blob:') || url.startsWith('data:'));

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
      // DEXIE-FIRST: Preserve existing caption (from Dexie) over backend data
      fdfPhotos.topCaption = fdfPhotos.topCaption || room.FDFTopAnnotation || '';
      fdfPhotos.topDrawings = fdfPhotos.topDrawings || room.FDFTopDrawings || null;
      fdfPhotos.topHasAnnotations = !!(room.FDFTopDrawings && room.FDFTopDrawings !== 'null' && room.FDFTopDrawings !== '' && room.FDFTopDrawings !== EMPTY_COMPRESSED_ANNOTATIONS);

      // CRITICAL FIX: If we have a preserved local URL, use it instead of placeholder
      if (preserved && hasValidLocalUrl(preserved.topDisplayUrl)) {
        fdfPhotos.topUrl = preserved.topUrl;
        fdfPhotos.topDisplayUrl = preserved.topDisplayUrl;
        fdfPhotos.topLoading = false;
        fdfPhotos.topIsLocalFirst = preserved.topIsLocalFirst;
        fdfPhotos.topImageId = preserved.topImageId;
        console.log('[RoomElevation] ✅ Restored preserved FDF top photo URL');
      } else {
        fdfPhotos.topLoading = true; // Skeleton state
        fdfPhotos.topUrl = 'assets/img/photo-placeholder.png'; // Placeholder
        fdfPhotos.topDisplayUrl = 'assets/img/photo-placeholder.png';

        // Load actual image in background - PREFER S3 key
        this.loadFDFPhotoImage(topS3Key || topLegacyPath, 'top').catch(err => {
          console.error('Error loading top photo:', err);
        });
      }
    } else if (preserved && hasValidLocalUrl(preserved.topDisplayUrl)) {
      // No S3 key but we have a local photo - restore it
      fdfPhotos.top = true;
      fdfPhotos.topUrl = preserved.topUrl;
      fdfPhotos.topDisplayUrl = preserved.topDisplayUrl;
      fdfPhotos.topLoading = false;
      fdfPhotos.topIsLocalFirst = preserved.topIsLocalFirst;
      fdfPhotos.topImageId = preserved.topImageId;
      fdfPhotos.topCaption = preserved.topCaption || '';
      fdfPhotos.topDrawings = preserved.topDrawings || null;
      fdfPhotos.topHasAnnotations = preserved.topHasAnnotations;
      console.log('[RoomElevation] ✅ Restored local-only FDF top photo');
    }

    // Load Bottom photo metadata - PREFER S3 Attachment column over legacy Files API path
    // Column names: FDFPhotoBottom (legacy path), FDFPhotoBottomAttachment (S3), FDFBottomAnnotation, FDFBottomDrawings
    const bottomS3Key = room.FDFPhotoBottomAttachment;
    const bottomLegacyPath = room.FDFPhotoBottom;
    if (bottomS3Key || bottomLegacyPath) {
      fdfPhotos.bottom = true;
      fdfPhotos.bottomPath = bottomLegacyPath;
      fdfPhotos.bottomAttachment = bottomS3Key;
      // DEXIE-FIRST: Preserve existing caption (from Dexie) over backend data
      fdfPhotos.bottomCaption = fdfPhotos.bottomCaption || room.FDFBottomAnnotation || '';
      fdfPhotos.bottomDrawings = fdfPhotos.bottomDrawings || room.FDFBottomDrawings || null;
      fdfPhotos.bottomHasAnnotations = !!(room.FDFBottomDrawings && room.FDFBottomDrawings !== 'null' && room.FDFBottomDrawings !== '' && room.FDFBottomDrawings !== EMPTY_COMPRESSED_ANNOTATIONS);

      // CRITICAL FIX: If we have a preserved local URL, use it instead of placeholder
      if (preserved && hasValidLocalUrl(preserved.bottomDisplayUrl)) {
        fdfPhotos.bottomUrl = preserved.bottomUrl;
        fdfPhotos.bottomDisplayUrl = preserved.bottomDisplayUrl;
        fdfPhotos.bottomLoading = false;
        fdfPhotos.bottomIsLocalFirst = preserved.bottomIsLocalFirst;
        fdfPhotos.bottomImageId = preserved.bottomImageId;
        console.log('[RoomElevation] ✅ Restored preserved FDF bottom photo URL');
      } else {
        fdfPhotos.bottomLoading = true; // Skeleton state
        fdfPhotos.bottomUrl = 'assets/img/photo-placeholder.png';
        fdfPhotos.bottomDisplayUrl = 'assets/img/photo-placeholder.png';

        // Load actual image in background - PREFER S3 key
        this.loadFDFPhotoImage(bottomS3Key || bottomLegacyPath, 'bottom').catch(err => {
          console.error('Error loading bottom photo:', err);
        });
      }
    } else if (preserved && hasValidLocalUrl(preserved.bottomDisplayUrl)) {
      // No S3 key but we have a local photo - restore it
      fdfPhotos.bottom = true;
      fdfPhotos.bottomUrl = preserved.bottomUrl;
      fdfPhotos.bottomDisplayUrl = preserved.bottomDisplayUrl;
      fdfPhotos.bottomLoading = false;
      fdfPhotos.bottomIsLocalFirst = preserved.bottomIsLocalFirst;
      fdfPhotos.bottomImageId = preserved.bottomImageId;
      fdfPhotos.bottomCaption = preserved.bottomCaption || '';
      fdfPhotos.bottomDrawings = preserved.bottomDrawings || null;
      fdfPhotos.bottomHasAnnotations = preserved.bottomHasAnnotations;
      console.log('[RoomElevation] ✅ Restored local-only FDF bottom photo');
    }

    // Load Threshold (Location) photo metadata - PREFER S3 Attachment column over legacy Files API path
    // Column names: FDFPhotoThreshold (legacy path), FDFPhotoThresholdAttachment (S3), FDFThresholdAnnotation, FDFThresholdDrawings
    const thresholdS3Key = room.FDFPhotoThresholdAttachment;
    const thresholdLegacyPath = room.FDFPhotoThreshold;
    if (thresholdS3Key || thresholdLegacyPath) {
      fdfPhotos.threshold = true;
      fdfPhotos.thresholdPath = thresholdLegacyPath;
      fdfPhotos.thresholdAttachment = thresholdS3Key;
      // DEXIE-FIRST: Preserve existing caption (from Dexie) over backend data
      fdfPhotos.thresholdCaption = fdfPhotos.thresholdCaption || room.FDFThresholdAnnotation || '';
      fdfPhotos.thresholdDrawings = fdfPhotos.thresholdDrawings || room.FDFThresholdDrawings || null;
      fdfPhotos.thresholdHasAnnotations = !!(room.FDFThresholdDrawings && room.FDFThresholdDrawings !== 'null' && room.FDFThresholdDrawings !== '' && room.FDFThresholdDrawings !== EMPTY_COMPRESSED_ANNOTATIONS);

      // CRITICAL FIX: If we have a preserved local URL, use it instead of placeholder
      if (preserved && hasValidLocalUrl(preserved.thresholdDisplayUrl)) {
        fdfPhotos.thresholdUrl = preserved.thresholdUrl;
        fdfPhotos.thresholdDisplayUrl = preserved.thresholdDisplayUrl;
        fdfPhotos.thresholdLoading = false;
        fdfPhotos.thresholdIsLocalFirst = preserved.thresholdIsLocalFirst;
        fdfPhotos.thresholdImageId = preserved.thresholdImageId;
        console.log('[RoomElevation] ✅ Restored preserved FDF threshold photo URL');
      } else {
        fdfPhotos.thresholdLoading = true; // Skeleton state
        fdfPhotos.thresholdUrl = 'assets/img/photo-placeholder.png';
        fdfPhotos.thresholdDisplayUrl = 'assets/img/photo-placeholder.png';

        // Load actual image in background - PREFER S3 key
        this.loadFDFPhotoImage(thresholdS3Key || thresholdLegacyPath, 'threshold').catch(err => {
          console.error('Error loading threshold photo:', err);
        });
      }
    } else if (preserved && hasValidLocalUrl(preserved.thresholdDisplayUrl)) {
      // No S3 key but we have a local photo - restore it
      fdfPhotos.threshold = true;
      fdfPhotos.thresholdUrl = preserved.thresholdUrl;
      fdfPhotos.thresholdDisplayUrl = preserved.thresholdDisplayUrl;
      fdfPhotos.thresholdLoading = false;
      fdfPhotos.thresholdIsLocalFirst = preserved.thresholdIsLocalFirst;
      fdfPhotos.thresholdImageId = preserved.thresholdImageId;
      fdfPhotos.thresholdCaption = preserved.thresholdCaption || '';
      fdfPhotos.thresholdDrawings = preserved.thresholdDrawings || null;
      fdfPhotos.thresholdHasAnnotations = preserved.thresholdHasAnnotations;
      console.log('[RoomElevation] ✅ Restored local-only FDF threshold photo');
    }
    
    // WEBAPP MODE: Skip local photo loading - only use server data
    if (!this.isWebappMode) {
      // Also restore any pending FDF photo uploads from IndexedDB (legacy system)
      await this.restorePendingFDFPhotos();

      // CRITICAL: Also load FDF photos from LocalImageService (new local-first system)
      await this.loadLocalFDFPhotos();
    } else {
      console.log('[RoomElevation] WEBAPP MODE: Skipping local FDF photo loading - using server data only');
    }
  }

  // Load FDF photos from LocalImageService (new local-first system)
  private async loadLocalFDFPhotos() {
    // WEBAPP MODE: Skip local photo loading
    if (this.isWebappMode) {
      console.log('[RoomElevation] WEBAPP MODE: Skipping loadLocalFDFPhotos');
      return;
    }

    try {
      const fdfPhotos = this.roomData.fdfPhotos;

      // TASK 1 FIX: Get FDF photos by both real room ID AND any temp IDs that map to this room
      // This handles the case where FDF photos were captured with temp room ID before room synced
      let localFDFImages = await this.localImageService.getImagesForEntity('fdf', this.roomId);

      // Also check for photos stored with temp IDs that map to this real room ID
      if (!String(this.roomId).startsWith('temp_')) {
        try {
          // Get all FDF images for the service and filter by temp ID mapping
          const allFDFImages = await this.indexedDb.getLocalImagesForService(this.serviceId, 'fdf');
          for (const img of allFDFImages) {
            // If image entityId is a temp ID, check if it maps to current roomId
            // BUGFIX: Convert entityId to string to handle numeric IDs from database
            if (String(img.entityId).startsWith('temp_')) {
              const realId = await this.indexedDb.getRealId(img.entityId);
              if (realId === this.roomId) {
                // Avoid duplicates
                if (!localFDFImages.some(existing => existing.imageId === img.imageId)) {
                  localFDFImages.push(img);
                  console.log(`[RoomElevation] Found FDF photo via temp->real mapping: ${img.imageId} (${img.entityId} -> ${this.roomId})`);
                }
              }
            }
          }
        } catch (e) {
          console.warn('[RoomElevation] Error checking temp ID mappings for FDF photos:', e);
        }
      }

      console.log(`[RoomElevation] Found ${localFDFImages.length} LocalImage FDF photos for room ${this.roomId} (including temp ID mappings)`);

      for (const localImage of localFDFImages) {
        const photoType = localImage.photoType || 'Top';  // Default to Top if not specified
        const photoKey = photoType.toLowerCase();

        // DEXIE-FIRST FIX: ALWAYS apply LocalImage data if the image exists and has local blob
        // The local blob is the source of truth - we keep it even after sync (verified status)
        // This ensures FDF photos persist after syncing and on reload
        const hasLocalBlob = !!localImage.localBlobId;

        // In Dexie-first mode, always use LocalImage if it has a blob - regardless of sync status
        if (hasLocalBlob) {
          // Get display URL
          // TASK 1 FIX: Set photo UNCONDITIONALLY even with placeholder URL
          // Matches category-detail pattern - placeholder will be updated via liveQuery
          let displayUrl = 'assets/img/photo-placeholder.png';
          try {
            displayUrl = await this.localImageService.getDisplayUrl(localImage);
          } catch (e) {
            console.warn('[RoomElevation] Failed to get LocalImage FDF displayUrl:', e);
          }

          // Set the FDF photo data (even with placeholder - will update via liveQuery)
          fdfPhotos[photoKey] = true;
          fdfPhotos[`${photoKey}Url`] = displayUrl;
          fdfPhotos[`${photoKey}DisplayUrl`] = displayUrl;
          fdfPhotos[`${photoKey}Caption`] = localImage.caption || fdfPhotos[`${photoKey}Caption`] || '';
          fdfPhotos[`${photoKey}Drawings`] = localImage.drawings || fdfPhotos[`${photoKey}Drawings`] || null;
          fdfPhotos[`${photoKey}Loading`] = false;
          fdfPhotos[`${photoKey}Uploading`] = false;
          fdfPhotos[`${photoKey}Queued`] = false;
          fdfPhotos[`${photoKey}ImageId`] = localImage.imageId;
          fdfPhotos[`${photoKey}LocalBlobId`] = localImage.localBlobId;
          fdfPhotos[`${photoKey}IsLocalFirst`] = true;
          fdfPhotos[`${photoKey}HasAnnotations`] = !!(localImage.drawings && localImage.drawings.length > 10);

          console.log(`[RoomElevation] ✅ Loaded local FDF ${photoType} photo: ${localImage.imageId} (status: ${localImage.status}, displayUrl: ${displayUrl.substring(0, 50)}...)`);
        }
      }

      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('[RoomElevation] Error loading local FDF photos:', error);
    }
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

  /**
   * Load FDF photo image with two-field approach for robust UI transitions
   * Priority: cached annotated > cached base > remote (with preload)
   * Never changes displayUrl until new source is verified loadable
   */
  private async loadFDFPhotoImage(photoPathOrS3Key: string, photoKey: string) {
    const fdfPhotos = this.roomData.fdfPhotos;
    const cacheId = `fdf_${this.roomId}_${photoKey}`;
    const isS3Key = this.caspioService.isS3Key(photoPathOrS3Key);
    
    console.log(`[FDF Photo] Loading ${photoKey} image, isS3Key: ${isS3Key}`);
    
    // TWO-FIELD APPROACH: Set display state
    let displayState: 'local' | 'cached' | 'remote_loading' | 'remote' = 'remote';
    
    try {
      await this.cacheLoadPromise;
      
      // Check for cached ANNOTATED image first
      const cachedAnnotatedImage = this.bulkAnnotatedImagesMap.get(cacheId);

      if (cachedAnnotatedImage) {
        console.log(`[FDF Photo] ✅ Using bulk cached ANNOTATED ${photoKey} image`);
        fdfPhotos[`${photoKey}Url`] = cachedAnnotatedImage;
        fdfPhotos[`${photoKey}DisplayUrl`] = cachedAnnotatedImage;
        fdfPhotos[`${photoKey}DisplayState`] = 'cached';
        fdfPhotos[`${photoKey}Loading`] = false;
        this.changeDetectorRef.detectChanges();
        return;
      }
      
      // Check bulk cached photo
      const cachedImage = this.bulkCachedPhotosMap.get(cacheId);
      if (cachedImage) {
        console.log(`[FDF Photo] ✅ Using bulk cached ${photoKey} image`);
        fdfPhotos[`${photoKey}Url`] = cachedImage;
        fdfPhotos[`${photoKey}DisplayUrl`] = cachedImage;
        fdfPhotos[`${photoKey}DisplayState`] = 'cached';
        fdfPhotos[`${photoKey}Loading`] = false;
        this.changeDetectorRef.detectChanges();
        return;
      }

      // If offline and no cache, use placeholder
      if (!this.offlineService.isOnline()) {
        console.log(`[FDF Photo] Offline and no cache for ${photoKey}, using placeholder`);
        fdfPhotos[`${photoKey}Url`] = 'assets/img/photo-placeholder.png';
        fdfPhotos[`${photoKey}DisplayUrl`] = 'assets/img/photo-placeholder.png';
        fdfPhotos[`${photoKey}DisplayState`] = 'remote';
        fdfPhotos[`${photoKey}Loading`] = false;
        this.changeDetectorRef.detectChanges();
        return;
      }

      // Mark as loading - keep current displayUrl if valid
      fdfPhotos[`${photoKey}DisplayState`] = 'remote_loading';
      fdfPhotos[`${photoKey}Loading`] = true;
      this.changeDetectorRef.detectChanges();

      // Fetch from remote with preload
      let imageData: string | null = null;
      
      if (isS3Key) {
        console.log(`[FDF Photo] Fetching S3 image for ${photoKey}:`, photoPathOrS3Key);
        try {
          const s3Url = await this.caspioService.getS3FileUrl(photoPathOrS3Key);
          
          // Preload before transitioning
          const preloaded = await this.preloadImage(s3Url);
          if (preloaded) {
            imageData = await this.fetchS3ImageAsDataUrl(s3Url);
          }
        } catch (err) {
          console.warn(`[FDF Photo] S3 fetch failed for ${photoKey}:`, err);
        }
      }
      
      if (!imageData && !isS3Key) {
        imageData = await this.foundationData.getImage(photoPathOrS3Key);
      }
      
      if (imageData) {
        // Only update UI after successful fetch
        fdfPhotos[`${photoKey}Url`] = imageData;
        fdfPhotos[`${photoKey}DisplayUrl`] = imageData;
        fdfPhotos[`${photoKey}DisplayState`] = 'cached';
        fdfPhotos[`${photoKey}Loading`] = false;
        
        await this.indexedDb.cachePhoto(cacheId, this.serviceId, imageData, photoPathOrS3Key);
        console.log(`[FDF Photo] ✅ Loaded and cached ${photoKey} image`);
        
        this.changeDetectorRef.detectChanges();
      } else {
        throw new Error('No image data returned');
      }
    } catch (error) {
      console.error(`[FDF Photo] Error loading ${photoKey} image:`, error);
      // Keep placeholder but mark as remote (failed)
      fdfPhotos[`${photoKey}Url`] = 'assets/img/photo-placeholder.png';
      fdfPhotos[`${photoKey}DisplayUrl`] = 'assets/img/photo-placeholder.png';
      fdfPhotos[`${photoKey}DisplayState`] = 'remote';
      fdfPhotos[`${photoKey}Loading`] = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * Load elevation point photo image with two-field approach
   * Priority: local blob > cached annotated > cached base > remote (with preload)
   * Never changes displayUrl until new source is verified loadable
   */
  private async loadPointPhotoImage(photoPath: string, photoData: any) {
    const attachId = String(photoData.attachId);
    const s3Key = photoData.Attachment || photoPath;
    
    // TWO-FIELD APPROACH: Set initial display state
    photoData.displayState = 'remote';
    
    try {
      await this.cacheLoadPromise;
      
      // Check for local pending blob first (highest priority)
      try {
        const localBlobUrl = await this.indexedDb.getPhotoBlobUrl(attachId);
        if (localBlobUrl) {
          if (this.DEBUG) console.log(`[Point Photo] ✅ Using local blob for ${attachId}`);
          photoData.url = localBlobUrl;
          photoData.displayUrl = localBlobUrl;
          photoData.displayState = 'local';
          photoData.localBlobKey = attachId;
          photoData.loading = false;
          this.changeDetectorRef.detectChanges();
          return;
        }
      } catch (e) { /* ignore */ }
      
      // Check for cached ANNOTATED image
      // TASK 3 FIX: Check both attachId AND localImageId for local-first photos
      // Annotations may be cached under localImageId before photo is synced to get real attachId
      const localImageId = photoData.localImageId || photoData.imageId;
      const cachedAnnotatedImage = this.bulkAnnotatedImagesMap.get(attachId)
        || (localImageId ? this.bulkAnnotatedImagesMap.get(String(localImageId)) : null);
      if (cachedAnnotatedImage) {
        if (this.DEBUG) console.log(`[Point Photo] ✅ Using bulk cached ANNOTATED image for ${attachId} (or localImageId: ${localImageId})`);
        photoData.url = cachedAnnotatedImage;
        photoData.displayUrl = cachedAnnotatedImage;
        photoData.displayState = 'cached';
        photoData.loading = false;
        photoData.hasAnnotations = true;
        this.changeDetectorRef.detectChanges();
        return;
      }
      
      // Check bulk cached photo
      const cachedImage = this.bulkCachedPhotosMap.get(attachId);
      if (cachedImage) {
        if (this.DEBUG) console.log(`[Point Photo] Using bulk cached image for ${attachId}`);
        photoData.url = cachedImage;
        photoData.displayUrl = cachedImage;
        photoData.displayState = 'cached';
        photoData.loading = false;
        this.changeDetectorRef.detectChanges();
        return;
      }

      // If offline and no cache, use placeholder
      if (!this.offlineService.isOnline()) {
        if (this.DEBUG) console.log(`[Point Photo] Offline and no cache for ${attachId}, using placeholder`);
        photoData.url = 'assets/img/photo-placeholder.png';
        photoData.displayUrl = 'assets/img/photo-placeholder.png';
        photoData.displayState = 'remote';
        photoData.loading = false;
        this.changeDetectorRef.detectChanges();
        return;
      }

      // Mark as loading, keep current displayUrl if valid
      photoData.displayState = 'remote_loading';
      photoData.loading = true;
      this.changeDetectorRef.detectChanges();

      // Fetch from remote with preload
      let imageData: string | null = null;
      
      if (s3Key && this.caspioService.isS3Key(s3Key)) {
        if (this.DEBUG) console.log(`[Point Photo] Fetching S3 image for ${attachId}:`, s3Key);
        try {
          const s3Url = await this.caspioService.getS3FileUrl(s3Key);
          
          // Preload before transitioning
          const preloaded = await this.preloadImage(s3Url);
          if (preloaded) {
            imageData = await this.fetchS3ImageAsDataUrl(s3Url);
          }
        } catch (err) {
          if (this.DEBUG) console.warn(`[Point Photo] S3 fetch failed for ${attachId}:`, err);
        }
      }
      
      if (!imageData && photoPath && !this.caspioService.isS3Key(photoPath)) {
        imageData = await this.foundationData.getImage(photoPath);
      }
      
      if (imageData) {
        // Only update UI after successful fetch
        photoData.url = imageData;
        photoData.displayUrl = imageData;
        photoData.displayState = 'cached';
        photoData.loading = false;
        
        if (attachId && !String(attachId).startsWith('temp_')) {
          await this.indexedDb.cachePhoto(attachId, this.serviceId, imageData, s3Key || photoPath);
          if (this.DEBUG) console.log(`[Point Photo] ✅ Loaded and cached image for ${attachId}`);
        }
        
        this.changeDetectorRef.detectChanges();
      } else {
        // Keep placeholder
        photoData.url = 'assets/img/photo-placeholder.png';
        photoData.displayUrl = 'assets/img/photo-placeholder.png';
        photoData.displayState = 'remote';
        photoData.loading = false;
        this.changeDetectorRef.detectChanges();
      }
    } catch (error) {
      console.error(`[Point Photo] Error loading image:`, error);
      photoData.url = 'assets/img/photo-placeholder.png';
      photoData.displayUrl = 'assets/img/photo-placeholder.png';
      photoData.displayState = 'remote';
      photoData.loading = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * Preload an image to verify it's loadable before switching
   */
  private preloadImage(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
      setTimeout(() => resolve(false), 30000);
    });
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

      // WEBAPP MODE: Skip local data loading - only use server data
      let pendingPhotosMap = new Map<string, any[]>();
      let bulkLocalImagesMap = new Map<string, LocalImage[]>();

      if (!this.isWebappMode) {
        // MOBILE MODE: Load local data
        // CRITICAL: Get ALL pending photos grouped by point in ONE IndexedDB call
        // This avoids N+1 reads when processing each point (matches structural systems pattern)
        pendingPhotosMap = await this.indexedDb.getAllPendingPhotosGroupedByPoint();
        console.log('[RoomElevation] Pending photos map has', pendingPhotosMap.size, 'points with pending photos');

        // NEW: Load LocalImages for EFE points (new local-first image system)
        // This ensures photos persist through navigation before sync completes
        const allLocalImages = await this.localImageService.getImagesForService(this.serviceId, 'efe_point');

        // Group LocalImages by entityId (pointId) for fast lookup
        // Also resolve temp IDs to real IDs for photos captured before point synced
        for (const img of allLocalImages) {
          // BUGFIX: Convert entityId to string to handle numeric IDs from database
          const entityId = String(img.entityId);

          // Add by original entityId
          if (!bulkLocalImagesMap.has(entityId)) {
            bulkLocalImagesMap.set(entityId, []);
          }
          bulkLocalImagesMap.get(entityId)!.push(img);

          // CRITICAL: Also add by resolved real ID if entityId is a temp ID
          // This ensures photos show after the parent point syncs but before the photo syncs
          if (entityId.startsWith('temp_')) {
            const realId = await this.indexedDb.getRealId(entityId);
            if (realId && realId !== entityId) {
              if (!bulkLocalImagesMap.has(realId)) {
                bulkLocalImagesMap.set(realId, []);
              }
              // Avoid duplicates
              const existing = bulkLocalImagesMap.get(realId)!;
              if (!existing.some(e => e.imageId === img.imageId)) {
                existing.push(img);
              }
            }
          }
        }
        console.log(`[RoomElevation] Loaded ${allLocalImages.length} LocalImages for ${bulkLocalImagesMap.size} points (with temp ID resolution)`);

        // TASK 1 FIX: Update class-level bulkLocalImagesMap so liveQuery updates work correctly
        // The local variable is used during initial load, but the class property is needed
        // for refreshPhotosFromLocalImages() to find the right photos when status changes
        this.bulkLocalImagesMap = bulkLocalImagesMap;
      } else {
        console.log('[RoomElevation] WEBAPP MODE: Skipping local image loading - using server data only');
      }

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

      // CRITICAL FIX: Check sync status to preserve photos during sync
      const syncStatus = this.backgroundSync.syncStatus$.getValue();
      const syncInProgress = syncStatus.isSyncing;

      // CRITICAL FIX: Use class-level preserved photos (saved in loadRoomData BEFORE clearing)
      // The local maps were always empty because roomData.elevationPoints was already cleared
      // by the time this function runs. Now we use this.preservedPhotosByPointName and
      // this.preservedPhotosByPointId which are populated BEFORE roomData is reinitialized.
      console.log(`[RoomElevation] Using preserved photos: ${this.preservedPhotosByPointName.size} points by name, ${this.preservedPhotosByPointId.size} points by ID (sync in progress: ${syncInProgress})`);

      // TASK 1 FIX: During sync, also preserve photos from current roomData.elevationPoints
      // This handles the case where sync starts AFTER initial load - photos would be in memory
      // but not in the class-level preservation maps (which are populated in loadRoomData)
      if (syncInProgress && this.roomData?.elevationPoints) {
        for (const point of this.roomData.elevationPoints) {
          if (point.photos && point.photos.length > 0) {
            const existingPreserved = this.preservedPhotosByPointName.get(point.name) || [];
            for (const photo of point.photos) {
              const photoId = photo.attachId || photo.imageId || photo._tempId;
              const alreadyPreserved = existingPreserved.some((p: any) =>
                (p.attachId && String(p.attachId) === String(photoId)) ||
                (p.imageId && String(p.imageId) === String(photoId)) ||
                (p._tempId && String(p._tempId) === String(photoId))
              );
              if (!alreadyPreserved) {
                existingPreserved.push({ ...photo });
              }
            }
            this.preservedPhotosByPointName.set(point.name, existingPreserved);
            if (point.pointId) {
              this.preservedPhotosByPointId.set(String(point.pointId), existingPreserved);
            }
          }
        }
        console.log(`[RoomElevation] SYNC IN PROGRESS - augmented preservation maps with current photos`);
      }

      for (const templatePoint of templatePoints) {
        console.log(`\n[RoomElevation] --- Processing template point: "${templatePoint.name}" ---`);

        // Find matching existing point by name
        const existingPoint = existingPoints?.find((p: any) => p.PointName === templatePoint.name);
        console.log(`[RoomElevation]   Existing point in DB:`, existingPoint ? `Yes (ID: ${existingPoint.PointID})` : 'No');

        // CRITICAL FIX: Use class-level preserved photos instead of empty local maps
        // Try by name first, then by point ID - ensures photos aren't lost if names change
        const pointId = existingPoint ? (existingPoint.PointID || existingPoint.PK_ID) : null;
        let preservedPhotos: any[] = [];
        if (this.preservedPhotosByPointName.has(templatePoint.name)) {
          preservedPhotos = this.preservedPhotosByPointName.get(templatePoint.name) || [];
          console.log(`[RoomElevation]   ✅ Restored ${preservedPhotos.length} preserved photos by point name`);
        } else if (pointId && this.preservedPhotosByPointId.has(String(pointId))) {
          preservedPhotos = this.preservedPhotosByPointId.get(String(pointId)) || [];
          console.log(`[RoomElevation]   ✅ Restored ${preservedPhotos.length} preserved photos by point ID`);
        }

        // TASK 1 FIX: ALWAYS preserve photos with valid displayUrls, not just during sync
        // This is the key fix - photos should NEVER disappear during any reload
        // BULLETPROOF: Any displayUrl that isn't a placeholder is considered valid
        // Matches category-detail.page.ts pattern at line 1071-1073
        const hasValidPreservedPhotos = preservedPhotos.some((p: any) =>
          p.displayUrl &&
          p.displayUrl !== 'assets/img/photo-placeholder.png' &&
          !p.displayUrl.includes('placeholder') &&
          !p.loading
        );

        // CRITICAL: Skip database merge if we have valid preserved photos with local blob URLs
        // This prevents the "disappearing during sync" issue by always prioritizing local photos
        // The local photos have the actual image data - database records may not yet have S3 URLs
        const skipDatabasePhotos = hasValidPreservedPhotos;
        if (skipDatabasePhotos) {
          console.log(`[RoomElevation]   PRESERVING local photos with valid displayUrls, skipping database merge`);
        }

        const pointData: any = {
          pointNumber: templatePoint.pointNumber,
          name: templatePoint.name,
          pointId: pointId,
          value: existingPoint ? (existingPoint.Elevation || '') : '',
          photos: [...preservedPhotos]  // Start with preserved photos
        };

        // BULLETPROOF FIX: If no preserved photos, check bulkLocalImagesMap for this point
        // This handles the case where preservation maps were empty but LocalImages exist
        // Matches category-detail pattern of NEVER losing photos
        if (pointData.photos.length === 0 && pointId) {
          const localImagesForPoint = bulkLocalImagesMap.get(String(pointId)) || [];
          for (const localImg of localImagesForPoint) {
            // DEXIE-FIRST FIX: Skip deleted photos from LocalImages
            const localImgAttachId = localImg.attachId ? String(localImg.attachId) : null;
            const compositeKey = `${pointId}:${localImg.photoType || 'Measurement'}`;
            if (this.deletedPointPhotoIds.has(localImg.imageId) ||
                this.deletedPointPhotoIds.has(localImgAttachId || '') ||
                this.deletedPointPhotoIds.has(compositeKey)) {
              console.log(`[RoomElevation]   Skipping deleted LocalImage: ${localImg.imageId} (compositeKey: ${compositeKey})`);
              continue;
            }

            // Check if we already have this photo
            const alreadyHas = pointData.photos.some((p: any) =>
              String(p.imageId) === localImg.imageId ||
              String(p.localImageId) === localImg.imageId
            );
            if (!alreadyHas) {
              // Get displayUrl from LocalImage
              // TASK 1 FIX: Add photo UNCONDITIONALLY even with placeholder URL
              // Matches category-detail pattern - placeholder will be updated via liveQuery when URL becomes available
              let displayUrl = 'assets/img/photo-placeholder.png';
              try {
                displayUrl = await this.localImageService.getDisplayUrl(localImg);
              } catch (e) {
                console.warn('[RoomElevation] Failed to get LocalImage displayUrl:', e);
              }

              // ANNOTATION FIX: Check for cached annotated image for thumbnail display
              const hasAnnotations = !!(localImg.drawings && localImg.drawings.length > 10);
              let thumbnailUrl = displayUrl;
              if (hasAnnotations) {
                const cachedAnnotated = this.bulkAnnotatedImagesMap.get(localImg.imageId)
                  || (localImg.attachId ? this.bulkAnnotatedImagesMap.get(String(localImg.attachId)) : null);
                if (cachedAnnotated) {
                  thumbnailUrl = cachedAnnotated;
                }
              }

              const localPhotoData = {
                imageId: localImg.imageId,
                localImageId: localImg.imageId,
                attachId: localImg.attachId || localImg.imageId,
                photoType: localImg.photoType || 'Measurement',
                url: displayUrl,
                displayUrl: thumbnailUrl,  // Use annotated if available
                thumbnailUrl: thumbnailUrl,
                caption: localImg.caption || '',
                drawings: localImg.drawings || null,
                hasAnnotations: hasAnnotations,
                uploading: false,  // SILENT SYNC: Never show spinner
                queued: false,     // SILENT SYNC: Never show queued indicator
                isPending: localImg.status !== 'verified',
                isLocalImage: true,
                isLocalFirst: true,
                _tempId: localImg.imageId,
              };
              pointData.photos.push(localPhotoData);
              console.log(`[RoomElevation] BULLETPROOF: Restored photo from LocalImage ${localImg.imageId} for point "${pointData.name}" (displayUrl: ${displayUrl.substring(0, 50)}...)`);
            }
          }
        }

        // If point exists in database, load its photos (unless in sync mode with valid preserved photos)
        if (existingPoint && !skipDatabasePhotos) {
          const dbPointId = existingPoint.PointID || existingPoint.PK_ID;
          const pointIdStr = String(dbPointId);
          // CRITICAL FIX: Use String() conversion to avoid type mismatch when comparing IDs
          const pointAttachments = attachments.filter((att: any) => String(att.PointID) === pointIdStr);
          console.log(`[RoomElevation]   Found ${pointAttachments.length} attachments for this point (ID: ${pointIdStr})`);

          // Process each attachment
          for (const attach of pointAttachments) {
            // CRITICAL: Database column is "Type", not "PhotoType"
            const photoType = attach.Type || attach.photoType || 'Measurement';
            const attachIdStr = String(attach.AttachID || attach.PK_ID);
            console.log(`[RoomElevation]     Processing attachment: Type=${photoType}, Photo=${attach.Photo}, isPending=${attach.isPending}, ID=${attachIdStr}`);

            // TASK 1 FIX: Check if server attachment matches any LocalImage by attachId
            // This handles photos that were captured with imageId then synced to get real attachId
            let matchingImageId: string | null = null;
            const localImagesForPoint = bulkLocalImagesMap.get(pointIdStr) || [];
            for (const localImg of localImagesForPoint) {
              if (localImg.attachId === attachIdStr) {
                matchingImageId = localImg.imageId;
                break;
              }
            }

            // CRITICAL FIX: Check for duplicate before adding (direct ID OR via LocalImage mapping)
            const alreadyExists = pointData.photos.some((p: any) =>
              String(p.attachId) === attachIdStr ||
              String(p.imageId) === attachIdStr ||
              (matchingImageId && (
                String(p.imageId) === matchingImageId ||
                String(p.localImageId) === matchingImageId ||
                String(p.attachId) === matchingImageId
              ))
            );

            if (alreadyExists) {
              console.log(`[RoomElevation]     Skipping duplicate attachment: ${attachIdStr} (matched via ${matchingImageId || 'direct ID'})`);
              // CRITICAL: Update the photo's attachId to the real server ID if needed
              const existingPhoto = pointData.photos.find((p: any) =>
                String(p.attachId) === attachIdStr ||
                String(p.imageId) === attachIdStr ||
                (matchingImageId && (
                  String(p.imageId) === matchingImageId ||
                  String(p.localImageId) === matchingImageId
                ))
              );
              if (existingPhoto && existingPhoto.attachId !== attachIdStr) {
                console.log(`[RoomElevation]     Updating photo attachId: ${existingPhoto.attachId} -> ${attachIdStr}`);
                existingPhoto.attachId = attachIdStr;
                existingPhoto.AttachID = attachIdStr;
              }
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

            // EMPTY_COMPRESSED_ANNOTATIONS is imported from annotation-utils
            // attachIdStr already declared at line 1875

            // FAST LOAD FIX: Check bulk cache FIRST before setting placeholder
            // This matches structural-category pattern for instant photo display
            let cachedDisplayUrl: string | null = null;
            let displayState: 'local' | 'cached' | 'remote_loading' | 'remote' = 'remote';

            // Check for cached ANNOTATED image first (highest priority after local blob)
            // TASK 3 FIX: Check both attachId AND localImageId for local-first photos
            const attachLocalImgId = attach.localImageId || attach.imageId;
            const cachedAnnotatedImage = this.bulkAnnotatedImagesMap.get(attachIdStr)
              || (attachLocalImgId ? this.bulkAnnotatedImagesMap.get(String(attachLocalImgId)) : null);
            if (cachedAnnotatedImage) {
              cachedDisplayUrl = cachedAnnotatedImage;
              displayState = 'cached';
              console.log(`[RoomElevation]       ✅ Using cached ANNOTATED image for ${attachIdStr}`);
            }

            // Check bulk cached photo if no annotated version
            if (!cachedDisplayUrl) {
              const cachedImage = this.bulkCachedPhotosMap.get(attachIdStr);
              if (cachedImage) {
                cachedDisplayUrl = cachedImage;
                displayState = 'cached';
                console.log(`[RoomElevation]       ✅ Using cached image for ${attachIdStr}`);
              }
            }

            const photoData: any = {
              attachId: attach.AttachID || attach.PK_ID,
              photoType: photoType,
              url: cachedDisplayUrl || 'assets/img/photo-placeholder.png',
              displayUrl: cachedDisplayUrl || 'assets/img/photo-placeholder.png',
              displayState: displayState,
              caption: attach.Annotation || '',
              Annotation: attach.Annotation || '',
              drawings: attach.Drawings || null,
              Drawings: attach.Drawings || null,
              hasAnnotations: !!(attach.Drawings && attach.Drawings !== 'null' && attach.Drawings !== '' && attach.Drawings !== EMPTY_COMPRESSED_ANNOTATIONS),
              path: attach.Attachment || attach.Photo || null,
              Attachment: attach.Attachment,
              Photo: attach.Photo,
              uploading: false,
              loading: !cachedDisplayUrl,  // Only loading if no cache
              _localUpdate: attach._localUpdate || false,
            };

            pointData.photos.push(photoData);

            // Only fetch from remote if NOT cached
            const hasS3Key = attach.Attachment && this.caspioService.isS3Key(attach.Attachment);
            const hasPhotoPath = !!attach.Photo;

            if ((hasS3Key || hasPhotoPath) && !cachedDisplayUrl) {
              photoData.needsLoad = true;
              photoData.path = attach.Photo || attach.Attachment;
              console.log(`[RoomElevation]       Photo needs remote load (S3: ${hasS3Key})`);
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
            // CRITICAL: Prioritize url (fresh blob URL from IndexedDB) over stored displayUrl
            // getAllPendingPhotosGroupedByPoint() generates fresh blob URLs and sets them to url
            let displayUrl = pendingPhoto.url || pendingPhoto.displayUrl || pendingPhoto.thumbnailUrl;
            let hasAnnotations = !!(pendingPhoto.Drawings || pendingPhoto.drawings);

            // PERFORMANCE FIX: Use bulk map (O(1) lookup) instead of individual IndexedDB calls
            // This matches the category-detail pattern for fast image loading
            // TASK 3 FIX: Check both photoId AND localImageId for local-first photos
            const pendingPhotoLocalImageId = pendingPhoto.localImageId || pendingPhoto.imageId;
            const cachedAnnotatedImage = this.bulkAnnotatedImagesMap.get(photoId)
              || (pendingPhotoLocalImageId ? this.bulkAnnotatedImagesMap.get(String(pendingPhotoLocalImageId)) : null);
            if (cachedAnnotatedImage) {
              console.log('[RoomElevation] ✅ Using bulk cached annotated image for pending photo:', photoId);
              displayUrl = cachedAnnotatedImage;
              hasAnnotations = true;
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
        
        // CRITICAL: Add LocalImages from the new local-first system
        // This ensures photos captured via LocalImageService persist through page reload
        const localImagesForPoint = bulkLocalImagesMap.get(pointIdStr) || [];
        if (localImagesForPoint.length > 0) {
          console.log(`[RoomElevation]   Adding ${localImagesForPoint.length} LocalImages for point ${pointIdStr}`);
          
          for (const localImage of localImagesForPoint) {
            // Skip if already added (by imageId or attachId)
            const alreadyExists = pointData.photos.some((p: any) => 
              String(p.attachId) === localImage.imageId ||
              String(p.imageId) === localImage.imageId ||
              String(p.localImageId) === localImage.imageId ||
              (localImage.attachId && String(p.attachId) === localImage.attachId)
            );
            
            if (alreadyExists) {
              console.log(`[RoomElevation]     Skipping duplicate LocalImage: ${localImage.imageId}`);
              continue;
            }
            
            // Get display URL from LocalImageService
            let displayUrl = 'assets/img/photo-placeholder.png';
            try {
              displayUrl = await this.localImageService.getDisplayUrl(localImage);
            } catch (e) {
              console.warn('[RoomElevation] Failed to get LocalImage displayUrl:', e);
            }

            // ANNOTATION FIX: Check for cached annotated image for thumbnail display
            const hasAnnotations = !!(localImage.drawings && localImage.drawings.length > 10);
            let thumbnailUrl = displayUrl;
            if (hasAnnotations) {
              const cachedAnnotated = this.bulkAnnotatedImagesMap.get(localImage.imageId)
                || (localImage.attachId ? this.bulkAnnotatedImagesMap.get(String(localImage.attachId)) : null);
              if (cachedAnnotated) {
                thumbnailUrl = cachedAnnotated;
              }
            }

            const localPhotoData: any = {
              imageId: localImage.imageId,
              AttachID: localImage.attachId || localImage.imageId,
              attachId: localImage.attachId || localImage.imageId,
              localImageId: localImage.imageId,
              localBlobId: localImage.localBlobId,
              photoType: localImage.photoType || 'Measurement',  // Use stored photoType!
              Type: localImage.photoType || 'Measurement',
              url: displayUrl,
              displayUrl: thumbnailUrl,  // Use annotated if available
              thumbnailUrl: thumbnailUrl,
              caption: localImage.caption || '',
              Annotation: localImage.caption || '',
              drawings: localImage.drawings || null,
              Drawings: localImage.drawings || null,
              hasAnnotations: hasAnnotations,
              uploading: false,         // SILENT SYNC
              queued: false,            // SILENT SYNC
              isPending: localImage.status !== 'verified',
              isLocalImage: true,
              isLocalFirst: true,
              _tempId: localImage.imageId,
            };
            pointData.photos.push(localPhotoData);
            console.log(`[RoomElevation]     Added LocalImage: ${localImage.imageId}, photoType: ${localImage.photoType}`);
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

              // EMPTY_COMPRESSED_ANNOTATIONS is imported from annotation-utils
              const photoData: any = {
                attachId: attach.AttachID || attach.PK_ID,
                photoType: photoType,
                url: null,
                displayUrl: null,
                caption: attach.Annotation || '',
                drawings: attach.Drawings || null,
                hasAnnotations: !!(attach.Drawings && attach.Drawings !== 'null' && attach.Drawings !== '' && attach.Drawings !== EMPTY_COMPRESSED_ANNOTATIONS && !attach.Drawings.startsWith('H4sI')),
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

              // LAZY LOADING: Photo loaded on-demand when user expands point
              if (hasS3Key || hasPhotoPath) {
                photoData.needsLoad = true;
                photoData.path = attach.Photo || attach.Attachment;
              }
            }

            // CRITICAL: Add LocalImages for custom points too
            const customPointIdStr = String(pointId);
            const localImagesForCustomPoint = bulkLocalImagesMap.get(customPointIdStr) || [];
            if (localImagesForCustomPoint.length > 0) {
              console.log(`[RoomElevation]     Adding ${localImagesForCustomPoint.length} LocalImages for custom point ${customPointIdStr}`);
              
              for (const localImage of localImagesForCustomPoint) {
                // Skip if already added
                const alreadyExists = customPointData.photos.some((p: any) => 
                  String(p.imageId) === localImage.imageId ||
                  String(p.localImageId) === localImage.imageId
                );
                
                if (alreadyExists) continue;

                let displayUrl = 'assets/img/photo-placeholder.png';
                try {
                  displayUrl = await this.localImageService.getDisplayUrl(localImage);
                } catch (e) {
                  console.warn('[RoomElevation] Failed to get LocalImage displayUrl:', e);
                }

                // ANNOTATION FIX: Check for cached annotated image for thumbnail display
                const hasAnnotations = !!(localImage.drawings && localImage.drawings.length > 10);
                let thumbnailUrl = displayUrl;
                if (hasAnnotations) {
                  const cachedAnnotated = this.bulkAnnotatedImagesMap.get(localImage.imageId)
                    || (localImage.attachId ? this.bulkAnnotatedImagesMap.get(String(localImage.attachId)) : null);
                  if (cachedAnnotated) {
                    thumbnailUrl = cachedAnnotated;
                  }
                }

                customPointData.photos.push({
                  imageId: localImage.imageId,
                  AttachID: localImage.attachId || localImage.imageId,
                  attachId: localImage.attachId || localImage.imageId,
                  localImageId: localImage.imageId,
                  localBlobId: localImage.localBlobId,
                  photoType: localImage.photoType || 'Measurement',
                  Type: localImage.photoType || 'Measurement',
                  url: displayUrl,
                  displayUrl: thumbnailUrl,  // Use annotated if available
                  thumbnailUrl: thumbnailUrl,
                  caption: localImage.caption || '',
                  drawings: localImage.drawings || null,
                  hasAnnotations: hasAnnotations,
                  uploading: false,
                  queued: false,
                  isPending: localImage.status !== 'verified',
                  isLocalImage: true,
                  isLocalFirst: true,
                });
              }
            }

            console.log(`[RoomElevation]     âœ" Custom point "${existingPoint.PointName}" added:`, {
              pointId: customPointData.pointId,
              value: customPointData.value,
              photoCount: customPointData.photos.length
            });

            this.roomData.elevationPoints.push(customPointData);
          }
        }
      }
      console.log('[RoomElevation] âœ" Custom points check complete');

      // STEP 7 (NEW): Merge pending caption updates into all loaded photos
      // This ensures captions added after photo creation are visible on page reload
      await this.mergePendingCaptionsIntoPointPhotos();

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

  /**
   * Merge pending caption updates into all point photos
   * CRITICAL: This ensures captions added mid-sync or after photo creation are visible
   * Pending captions take precedence over cached values
   */
  private async mergePendingCaptionsIntoPointPhotos(): Promise<void> {
    try {
      // Collect all possible photo IDs from all points (including local-first IDs)
      const allAttachIds: string[] = [];
      for (const point of this.roomData.elevationPoints) {
        if (point.photos && point.photos.length > 0) {
          for (const photo of point.photos) {
            // Collect all possible ID fields for local-first and legacy photos
            if (photo.attachId) allAttachIds.push(String(photo.attachId));
            if (photo.AttachID) allAttachIds.push(String(photo.AttachID));
            if (photo.localImageId) allAttachIds.push(String(photo.localImageId));
            if (photo.imageId) allAttachIds.push(String(photo.imageId));
            if (photo._tempId) allAttachIds.push(String(photo._tempId));
            if (photo._pendingFileId) allAttachIds.push(String(photo._pendingFileId));
          }
        }
      }

      // Remove duplicates
      const uniqueAttachIds = [...new Set(allAttachIds)];

      if (uniqueAttachIds.length === 0) {
        return;
      }

      // Fetch pending captions for all photo attachIds
      const pendingCaptions = await this.indexedDb.getPendingCaptionsForAttachments(uniqueAttachIds);

      if (pendingCaptions.length === 0) {
        return;
      }

      console.log(`[MERGE CAPTIONS] Merging ${pendingCaptions.length} pending captions into ${uniqueAttachIds.length} photo IDs`);

      // Build lookup map for faster matching
      const captionMap = new Map<string, any>();
      for (const pc of pendingCaptions) {
        captionMap.set(pc.attachId, pc);
      }

      // Apply pending captions to matching photos
      for (const point of this.roomData.elevationPoints) {
        if (!point.photos) continue;

        for (const photo of point.photos) {
          // Check all possible ID fields for local-first and legacy photos
          const possibleIds = [
            photo.attachId,
            photo.AttachID,
            photo.localImageId,
            photo.imageId,
            photo._tempId,
            photo._pendingFileId
          ].filter(id => id).map(id => String(id));

          // Find matching pending caption using any of the IDs
          let pendingCaption = null;
          let matchedId = '';
          for (const id of possibleIds) {
            pendingCaption = captionMap.get(id);
            if (pendingCaption) {
              matchedId = id;
              break;
            }
          }

          if (pendingCaption) {
            // Update caption if pending
            if (pendingCaption.caption !== undefined) {
              console.log(`[MERGE CAPTIONS] Applying caption to photo ${matchedId}: "${pendingCaption.caption?.substring(0, 30)}..."`);
              photo.caption = pendingCaption.caption;
              photo.Annotation = pendingCaption.caption;
            }

            // Update drawings if pending
            if (pendingCaption.drawings !== undefined) {
              console.log(`[MERGE CAPTIONS] Applying drawings to photo ${matchedId}`);
              photo.drawings = pendingCaption.drawings;
              photo.Drawings = pendingCaption.drawings;
              photo.hasAnnotations = !!pendingCaption.drawings;
            }
          }
        }
      }
    } catch (error) {
      console.error('[MERGE CAPTIONS] Error merging pending captions:', error);
      // Don't fail the load - captions will sync later
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

      // DEXIE-FIRST: Update Dexie efeFields immediately for instant persistence
      await this.efeFieldRepo.setRoomFdf(this.serviceId, this.roomName, this.roomData.fdf);

      // CRITICAL: Always update local IndexedDB cache first for offline-first behavior
      // This ensures the FDF value persists even if offline
      await this.updateLocalEFECache({ FDF: this.roomData.fdf });

      // TASK 2 FIX: ALWAYS queue FDF updates for sync - this makes them visible in sync modal
      // This matches the workflow for all other operations (images, notes, etc.)
      if (isTempId) {
        // Queue for background sync - room not synced yet
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=DEFERRED`,
          method: 'PUT',
          data: { FDF: this.roomData.fdf, _tempEfeId: this.roomId, RoomName: this.roomName },
          dependencies: [this.roomId],
          status: 'pending',
          priority: 'normal',
          serviceId: this.serviceId
        });
        console.log('[RoomElevation] FDF update queued for sync (room not yet synced)');
      } else {
        // TASK 2 FIX: Queue for background sync (visible in sync modal) instead of direct API call
        // This ensures FDF changes appear in the sync queue like all other operations
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=${id}`,
          method: 'PUT',
          data: { FDF: this.roomData.fdf, RoomName: this.roomName },
          dependencies: [],
          status: 'pending',
          priority: 'normal',
          serviceId: this.serviceId
        });
        console.log('[RoomElevation] FDF update queued for sync');
      }

      // Update sync pending count to show in UI immediately
      await this.backgroundSync.refreshSyncStatus();

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
      
      // CRITICAL FIX: Use String() for comparison to handle type mismatches (number vs string IDs)
      const roomIdStr = String(this.roomId);
      
      // Find and update the current room - also match by RoomName as fallback
      const roomIndex = cachedRooms.findIndex((r: any) => 
        String(r.EFEID) === roomIdStr || 
        String(r.PK_ID) === roomIdStr || 
        String(r._tempId) === roomIdStr ||
        r.RoomName === this.roomName
      );
      
      if (roomIndex >= 0) {
        cachedRooms[roomIndex] = {
          ...cachedRooms[roomIndex],
          ...updates,
          _localUpdate: true  // Mark as having local updates
        };
        
        await this.indexedDb.cacheServiceData(this.serviceId, 'efe_rooms', cachedRooms);
        console.log('[RoomElevation] ✅ Local EFE cache updated with:', updates, 'for room:', this.roomName);
      } else {
        // CRITICAL FIX: Room not in main cache - check if it's a pending (offline-created) room
        // Pending rooms are stored separately in pendingEFEData
        if (roomIdStr.startsWith('temp_')) {
          const updated = await this.indexedDb.updatePendingEFE(roomIdStr, updates);
          if (updated) {
            console.log('[RoomElevation] ✅ Pending EFE room updated with:', updates, 'for temp room:', roomIdStr);
            return;
          }
        }
        
        console.warn('[RoomElevation] ⚠️ Room not found in local cache or pending data. Looking for:', {
          roomId: this.roomId,
          roomName: this.roomName,
          cachedRoomCount: cachedRooms.length
        });
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

      // DEXIE-FIRST: Update Dexie efeFields immediately for instant persistence
      await this.efeFieldRepo.setRoomLocation(this.serviceId, this.roomName, this.roomData.location);

      // CRITICAL: Always update local IndexedDB cache first for offline-first behavior
      await this.updateLocalEFECache({ Location: this.roomData.location });

      // TASK 3 FIX: ALWAYS queue updates for sync - this makes them visible in sync modal
      // This matches the workflow for all other operations
      if (isTempId) {
        // Queue for background sync - room not synced yet
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=DEFERRED`,
          method: 'PUT',
          data: { Location: this.roomData.location, _tempEfeId: this.roomId, RoomName: this.roomName },
          dependencies: [this.roomId],
          status: 'pending',
          priority: 'normal',
          serviceId: this.serviceId
        });
        console.log('[RoomElevation] Location update queued for sync (room not yet synced)');
      } else {
        // Queue for background sync (visible in sync modal) instead of direct API call
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=${id}`,
          method: 'PUT',
          data: { Location: this.roomData.location, RoomName: this.roomName },
          dependencies: [],
          status: 'pending',
          priority: 'normal',
          serviceId: this.serviceId
        });
        console.log('[RoomElevation] Location update queued for sync');
      }

      // Update sync pending count to show in UI immediately
      await this.backgroundSync.refreshSyncStatus();

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

      // DEXIE-FIRST: Update Dexie efeFields immediately for instant persistence
      await this.efeFieldRepo.setRoomNotes(this.serviceId, this.roomName, this.roomData.notes);

      // CRITICAL: Always update local IndexedDB cache first for offline-first behavior
      await this.updateLocalEFECache({ Notes: this.roomData.notes });

      // TASK 3 FIX: ALWAYS queue updates for sync - this makes them visible in sync modal
      // This matches the workflow for all other operations
      if (isTempId) {
        // Queue for background sync - room not synced yet
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=DEFERRED`,
          method: 'PUT',
          data: { Notes: this.roomData.notes, _tempEfeId: this.roomId, RoomName: this.roomName },
          dependencies: [this.roomId],
          status: 'pending',
          priority: 'normal',
          serviceId: this.serviceId
        });
        console.log('[RoomElevation] Notes update queued for sync (room not yet synced)');
      } else {
        // Queue for background sync (visible in sync modal) instead of direct API call
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=${id}`,
          method: 'PUT',
          data: { Notes: this.roomData.notes, RoomName: this.roomName },
          dependencies: [],
          status: 'pending',
          priority: 'normal',
          serviceId: this.serviceId
        });
        console.log('[RoomElevation] Notes update queued for sync');
      }

      // Update sync pending count to show in UI immediately
      await this.backgroundSync.refreshSyncStatus();

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
    // TASK 1 FIX: Start cooldown to prevent cache invalidation during photo capture
    this.startLocalOperationCooldown();

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
    // TASK 1 FIX: Start cooldown to prevent cache invalidation during photo capture
    this.startLocalOperationCooldown();

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

  // Process FDF photo - OFFLINE-FIRST: Uses LocalImageService for local-first handling
  private async processFDFPhoto(file: File, photoType: 'Top' | 'Bottom' | 'Threshold') {
    const photoKey = photoType.toLowerCase();
    const fdfPhotos = this.roomData.fdfPhotos;

    console.log(`[FDF Upload] Processing photo: ${photoType} (LOCAL-FIRST via LocalImageService)`);

    try {
      // Initialize fdfPhotos structure if needed
      if (!fdfPhotos) {
        this.roomData.fdfPhotos = {};
      }

      // Compress the image
      const originalSize = file.size;
      const compressedFile = await this.imageCompression.compressImage(file, {
        maxSizeMB: 0.8,
        maxWidthOrHeight: 1280,
        useWebWorker: true
      }) as File;
      const compressedSize = compressedFile.size;

      // OFFLINE-FIRST: Use LocalImageService for local-first handling
      // CRITICAL: Pass photoType as the last parameter, NOT in caption
      const localImage = await this.localImageService.captureImage(
        compressedFile,
        'fdf',                    // Entity type for FDF photos
        this.roomId,              // Room ID as entity ID
        this.serviceId,
        '',                       // Caption (empty for FDF photos)
        fdfPhotos[`${photoKey}Drawings`] || '',  // Drawings
        photoType                 // photoType (Top/Bottom/Threshold) - stored in LocalImage.photoType
      );

      // Get display URL (local blob URL)
      const displayUrl = await this.localImageService.getDisplayUrl(localImage);

      // Update photo data immediately - SILENT SYNC (no uploading indicators)
      fdfPhotos[photoKey] = true;
      fdfPhotos[`${photoKey}Url`] = displayUrl;
      fdfPhotos[`${photoKey}DisplayUrl`] = displayUrl;
      fdfPhotos[`${photoKey}Caption`] = fdfPhotos[`${photoKey}Caption`] || '';
      fdfPhotos[`${photoKey}Drawings`] = fdfPhotos[`${photoKey}Drawings`] || null;
      fdfPhotos[`${photoKey}Loading`] = false;
      fdfPhotos[`${photoKey}Uploading`] = false;  // SILENT SYNC: No spinner
      fdfPhotos[`${photoKey}Queued`] = false;     // SILENT SYNC: No indicator
      fdfPhotos[`${photoKey}ImageId`] = localImage.imageId;
      fdfPhotos[`${photoKey}LocalBlobId`] = localImage.localBlobId;
      fdfPhotos[`${photoKey}IsLocalFirst`] = true;

      // Trigger change detection to show preview IMMEDIATELY
      this.changeDetectorRef.detectChanges();
      console.log(`[FDF Upload] ✅ Photo captured with LocalImageService:`, localImage.imageId);

    } catch (error: any) {
      console.error(`[FDF Upload] Error processing FDF ${photoType} photo:`, error);

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

      // TASK 3 FIX: Add fallback to queue if direct API call fails
      try {
        await this.caspioService.updateServicesEFEByEFEID(this.roomId, updateData).toPromise();
        console.log(`[FDF Upload S3] Updated room record with S3 key in ${attachmentColumnName}`);
      } catch (apiError) {
        console.warn(`[FDF Upload S3] API update failed, queuing for sync:`, apiError);
        await this.indexedDb.addPendingRequest({
          type: 'UPDATE',
          endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=${this.roomId}`,
          method: 'PUT',
          data: updateData,
          dependencies: [],
          status: 'pending',
          priority: 'high',
          serviceId: this.serviceId
        });
      }

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
      
      // PERFORMANCE FIX: Try bulk map first (O(1) lookup), fall back to IndexedDB if not found
      console.log('[FDF Annotate] Checking bulk cache for:', cacheId);
      let cachedDataUrl = this.bulkCachedPhotosMap.get(cacheId);
      if (!cachedDataUrl) {
        // Fallback to IndexedDB for photos added mid-session
        cachedDataUrl = await this.indexedDb.getCachedPhoto(cacheId) || undefined;
      }
      if (cachedDataUrl && cachedDataUrl.startsWith('data:')) {
        console.log('[FDF Annotate] ✅ Using cached data URL');
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

      if (compressedDrawings && compressedDrawings !== EMPTY_COMPRESSED_ANNOTATIONS && !compressedDrawings.startsWith('H4sI')) {
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

        // CRITICAL FIX: Use TRUE IMMUTABLE pattern - replace entire fdfPhotos object
        // This ensures Angular change detection properly sees the update
        this.roomData.fdfPhotos = {
          ...this.roomData.fdfPhotos,
          [`${photoKey}Drawings`]: compressedDrawings,
          [`${photoKey}Caption`]: data.caption !== undefined ? data.caption : existingCaption,
          [`${photoKey}DisplayUrl`]: newUrl,
          [`${photoKey}HasAnnotations`]: !!annotationsData
        };

        console.log('[FDF SAVE] ✅ Replaced fdfPhotos object with updated', photoKey, 'displayUrl');
        console.log('[FDF SAVE] Updated photo with compressed drawings, length:', compressedDrawings?.length || 0);

        // Force UI update
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
            // DEXIE-FIRST: Delete from Dexie tables first, then queue backend sync
            const photoKey = photoType.toLowerCase();
            const fdfPhotos = this.roomData.fdfPhotos;

            // 1. DEXIE-FIRST: Get the imageId before clearing local state
            const imageId = fdfPhotos[`${photoKey}ImageId`];
            console.log('[FDF Delete] Starting Dexie-first deletion for:', photoKey, 'imageId:', imageId);

            // 2. DEXIE-FIRST: Delete from LocalImages table (source of truth)
            if (imageId) {
              try {
                await this.localImageService.deleteLocalImage(imageId);
                console.log('[FDF Delete] ✅ Deleted from LocalImages:', imageId);
              } catch (localErr) {
                console.warn('[FDF Delete] Error deleting from LocalImages:', localErr);
              }
            }

            // 3. DEXIE-FIRST: Clear FDF photo metadata in efeFields via repo
            try {
              await this.efeFieldRepo.clearFdfPhoto(this.serviceId, this.roomName, photoKey);
              console.log('[FDF Delete] ✅ Cleared fdfPhotos metadata in Dexie:', photoKey);
            } catch (repoErr) {
              console.warn('[FDF Delete] Error clearing fdfPhotos in repo:', repoErr);
            }

            // 4. Clear local in-memory state (UI will also update via liveQuery)
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
            fdfPhotos[`${photoKey}ImageId`] = null;
            fdfPhotos[`${photoKey}LocalBlobId`] = null;

            // Force UI update
            this.changeDetectorRef.detectChanges();

            // 5. Clear cached photo from IndexedDB (legacy cache)
            const cacheId = `fdf_${this.roomId}_${photoKey}`;
            await this.indexedDb.deleteCachedPhoto(cacheId);
            console.log('[FDF Delete] Cleared cached photo from IndexedDB:', cacheId);

            // 6. Queue backend update (clear FDF columns on server)
            const updateData: any = {};
            updateData[`FDFPhoto${photoType}`] = null;
            updateData[`FDFPhoto${photoType}Attachment`] = null;
            updateData[`FDF${photoType}Annotation`] = null;
            updateData[`FDF${photoType}Drawings`] = null;
            // Metadata for sync modal display - identifies this as FDF photo delete
            updateData._displayType = 'FDF_PHOTO_DELETE';
            updateData._photoType = photoType;
            updateData._roomName = this.roomName;

            try {
              // DEXIE-FIRST FIX: Handle temp room IDs properly
              // If roomId is a temp ID, use DEFERRED pattern so background sync can resolve it
              const isTempRoomId = String(this.roomId).startsWith('temp_');
              let apiEndpoint: string;

              if (isTempRoomId) {
                // Use DEFERRED pattern - background sync will resolve temp ID to real ID
                apiEndpoint = `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID=DEFERRED`;
                updateData._tempEfeId = this.roomId;
                console.log('[FDF Delete] Room has temp ID, using DEFERRED pattern:', this.roomId);
              } else {
                apiEndpoint = `/api/caspio-proxy/tables/LPS_Services_EFE/records?q.where=EFEID='${this.roomId}'`;
              }

              if (this.offlineService.isOnline() && !isTempRoomId) {
                // Only try direct API call if we have a real room ID
                try {
                  await this.caspioService.updateServicesEFEByEFEID(this.roomId, updateData).toPromise();
                  console.log('[FDF Delete] ✅ Deleted from backend database');
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
                }
              } else {
                // Offline or temp room ID - queue for background sync
                console.log('[FDF Delete] Queuing delete for sync (offline or temp roomId)');
                await this.indexedDb.addPendingRequest({
                  type: 'UPDATE',
                  endpoint: apiEndpoint,
                  method: 'PUT',
                  data: updateData,
                  dependencies: [],
                  status: 'pending',
                  priority: 'high',
                });
              }

              console.log('[FDF Delete] ✅ Photo deletion complete (Dexie-first)');
            } catch (error) {
              console.error('[FDF Delete] Error queuing backend update:', error);
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
   * DEXIE-FIRST: Save FDF caption to Dexie first, then sync to backend
   */
  private async saveFDFCaption(photoType: 'Top' | 'Bottom' | 'Threshold', newCaption: string): Promise<void> {
    const photoKey = photoType.toLowerCase();
    const fdfPhotos = this.roomData.fdfPhotos;
    const columnName = `FDF${photoType}Annotation`;

    // 1. Update UI immediately
    fdfPhotos[`${photoKey}Caption`] = newCaption;
    this.changeDetectorRef.detectChanges();

    // 2. DEXIE-FIRST: Save caption to Dexie efeFields for persistence across reloads
    await this.efeFieldRepo.setFdfPhotoCaption(this.serviceId, this.roomName, photoKey, newCaption);

    // 3. Update local IndexedDB cache (for legacy compatibility)
    const updateData: any = {};
    updateData[columnName] = newCaption;
    await this.updateLocalEFECache(updateData);

    // 4. Also update LocalImage caption if we have an imageId
    const imageId = fdfPhotos[`${photoKey}ImageId`];
    if (imageId) {
      try {
        await this.localImageService.updateCaptionAndDrawings(imageId, newCaption);
        console.log('[FDF Caption] ✅ Updated LocalImage caption for imageId:', imageId);
      } catch (err) {
        console.warn('[FDF Caption] Could not update LocalImage caption:', err);
      }
    }

    // 5. Queue for backend sync using unified caption system
    try {
      // Get existing drawings (if any) to include in the update
      const existingDrawings = fdfPhotos[`${photoKey}Drawings`] || '';

      // Use unified caption/annotation queue - same as saveFDFAnnotationToDatabase
      await this.foundationData.queueCaptionAndAnnotationUpdate(
        this.roomId,  // Use roomId as attachId - FDF data is on EFE room record
        newCaption,
        existingDrawings,
        'fdf',
        {
          serviceId: this.serviceId,
          pointId: photoType  // photoType (Top/Bottom/Threshold) passed as pointId for FDF sync handler
        }
      );
      console.log('[FDF Caption] ✅ Queued for sync via unified system, roomId:', this.roomId, 'photoType:', photoType);
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
    let showError = false;

    const createAlert = async () => {
      const alert = await this.alertController.create({
        header: 'Add Measurement',
        message: showError ? 'Name is required to save the point' : undefined,
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
                // Show error message by recreating the alert
                showError = true;
                alert.dismiss().then(() => createAlert());
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
        cssClass: showError ? 'custom-document-alert add-point-error' : 'custom-document-alert'
      });

      await alert.present();
    };

    await createAlert();
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
        // DEXIE-FIRST: Save custom point to Dexie for persistence across page reloads
        // This returns the assigned pointNumber for the new point
        const assignedPointNumber = await this.efeFieldRepo.addCustomPoint(
          this.serviceId,
          this.roomName,
          pointName,
          response._tempId || null,
          response._tempId ? null : pointId  // Real pointId only if not a temp ID
        );

        // Add to local array with offline sync status and assigned pointNumber
        this.roomData.elevationPoints.push({
          pointId: pointId,
          pointNumber: assignedPointNumber,
          name: pointName,
          value: '',
          photos: [],
          _tempId: response._tempId,
          _syncing: response._syncing
        });

        this.changeDetectorRef.detectChanges();
        console.log(`[RoomElevation] Point "${pointName}" created with ID: ${pointId}, pointNumber: ${assignedPointNumber}${response._tempId ? ' (pending sync)' : ''}`);
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
          text: 'Save',
          handler: (data) => {
            const newName = data.pointName?.trim();

            if (!newName) {
              return false; // Keep alert open
            }

            if (newName === point.name) {
              return true; // No change needed, close alert
            }

            // Return the data for processing after dismiss
            return { values: { newName } };
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
    
    const result = await alert.onDidDismiss();
    
    // Process save after alert is dismissed
    if (result.role !== 'cancel' && result.data?.values?.newName) {
      const newName = result.data.values.newName;
      try {
        // 1. Update UI immediately
        point.name = newName;
        this.changeDetectorRef.detectChanges();

        // 2. DEXIE-FIRST: Save to Dexie efeFields for persistence across reloads
        await this.efeFieldRepo.setPointName(this.serviceId, this.roomName, point.pointNumber, newName);

        // 3. Update local cache (for legacy compatibility)
        await this.updateLocalEFECache({ elevationPoints: this.roomData.elevationPoints });

        // 4. Queue for backend sync
        const isTempId = String(point.pointId).startsWith('temp_');

        if (isTempId) {
          // Point not synced yet - queue update with dependency
          await this.indexedDb.addPendingRequest({
            type: 'UPDATE',
            endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE_Points/records?q.where=PointID=DEFERRED`,
            method: 'PUT',
            data: { PointName: newName, _tempPointId: point.pointId },
            dependencies: [point.pointId],
            status: 'pending',
            priority: 'normal',
            serviceId: this.serviceId
          });
        } else {
          // Point already synced - queue direct update
          await this.indexedDb.addPendingRequest({
            type: 'UPDATE',
            endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE_Points/records?q.where=PointID=${point.pointId}`,
            method: 'PUT',
            data: { PointName: newName },
            dependencies: [],
            status: 'pending',
            priority: 'normal',
            serviceId: this.serviceId
          });
        }

        // Refresh sync status to show in UI
        await this.backgroundSync.refreshSyncStatus();

        console.log('[RoomElevation] Point name update saved to Dexie and queued for sync');
      } catch (error) {
        console.error('Error updating point name:', error);
      }
    }
  }

  async deleteElevationPoint(point: any) {
    const alert = await this.alertController.create({
      header: 'Delete Point',
      message: `Are you sure you want to delete "${point.name}"? This will also delete all associated photos.`,
      buttons: [
        {
          text: 'Delete',
          role: 'destructive'
        },
        {
          text: 'Cancel',
          role: 'cancel'
        }
      ],
      cssClass: 'custom-document-alert'
    });

    await alert.present();
    
    const result = await alert.onDidDismiss();
    
    // Only process if user clicked Delete
    if (result.role === 'destructive') {
      try {
        // TASK 3 FIX: Use sync queue pattern instead of direct API calls
        // This ensures operations work offline and appear in sync queue
        const isTempPointId = String(point.pointId).startsWith('temp_');

        // Queue photo deletions first
        if (point.photos && point.photos.length > 0) {
          for (const photo of point.photos) {
            if (photo.attachId) {
              const isTempAttachId = String(photo.attachId).startsWith('temp_');

              if (isTempAttachId) {
                // Photo not synced yet - queue deletion with dependency
                await this.indexedDb.addPendingRequest({
                  type: 'DELETE',
                  endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE_Points_Attach/records?q.where=AttachID=DEFERRED`,
                  method: 'DELETE',
                  data: { _tempAttachId: photo.attachId },
                  dependencies: [photo.attachId],
                  status: 'pending',
                  priority: 'normal',
                  serviceId: this.serviceId
                });
              } else {
                // Photo already synced - queue direct deletion
                await this.indexedDb.addPendingRequest({
                  type: 'DELETE',
                  endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE_Points_Attach/records?q.where=AttachID=${photo.attachId}`,
                  method: 'DELETE',
                  data: {},
                  dependencies: [],
                  status: 'pending',
                  priority: 'normal',
                  serviceId: this.serviceId
                });
              }

              // Clean up local image cache
              if (photo.localKey) {
                await this.localImageService.deleteLocalImage(photo.localKey);
              }
            }
          }
        }

        // Queue point deletion (after photos in queue)
        if (isTempPointId) {
          // Point not synced yet - queue deletion with dependency
          await this.indexedDb.addPendingRequest({
            type: 'DELETE',
            endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE_Points/records?q.where=PointID=DEFERRED`,
            method: 'DELETE',
            data: { _tempPointId: point.pointId },
            dependencies: [point.pointId],
            status: 'pending',
            priority: 'normal',
            serviceId: this.serviceId
          });
        } else {
          // Point already synced - queue direct deletion
          await this.indexedDb.addPendingRequest({
            type: 'DELETE',
            endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE_Points/records?q.where=PointID=${point.pointId}`,
            method: 'DELETE',
            data: {},
            dependencies: [],
            status: 'pending',
            priority: 'normal',
            serviceId: this.serviceId
          });
        }

        // Remove from local array immediately
        const index = this.roomData.elevationPoints.findIndex((p: any) => p.pointId === point.pointId);
        if (index >= 0) {
          this.roomData.elevationPoints.splice(index, 1);
        }

        // DEXIE-FIRST: Remove point from Dexie so deletion persists across page reloads
        await this.efeFieldRepo.removePoint(
          this.serviceId,
          this.roomName,
          { pointId: point.pointId, pointNumber: point.pointNumber }
        );

        // Update local cache (legacy)
        await this.updateLocalEFECache({ elevationPoints: this.roomData.elevationPoints });

        // Refresh sync status to show in UI
        await this.backgroundSync.refreshSyncStatus();

        this.changeDetectorRef.detectChanges();
        console.log('[RoomElevation] Point and photo deletions queued for sync');
      } catch (error) {
        console.error('Error deleting point:', error);
      }
    }
  }

  // Point Photo Methods
  async capturePointPhotoCamera(point: any, photoType: 'Measurement' | 'Location', event: Event) {
    event.stopPropagation();

    // TASK 1 FIX: Start cooldown to prevent cache invalidation during photo capture
    // This prevents images from disappearing when sync status changes
    this.startLocalOperationCooldown();

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

    // TASK 1 FIX: Start cooldown to prevent cache invalidation during photo capture
    // This prevents images from disappearing when sync status changes
    this.startLocalOperationCooldown();

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
      const originalSize = file.size;
      const compressedFile = await this.imageCompression.compressImage(file, {
        maxSizeMB: 0.4,
        maxWidthOrHeight: 1024,
        useWebWorker: true
      }) as File;
      const compressedSize = compressedFile.size;

      // OFFLINE-FIRST: Use foundationData.uploadEFEPointPhoto which handles both
      // online (immediate upload) and offline (IndexedDB queue) scenarios
      // TASK 1 FIX: Pass serviceId so LocalImages can be found by getImagesForService()
      // Without serviceId, photos would be stored with serviceId='' but queried with actual serviceId
      const result = await this.foundationData.uploadEFEPointPhoto(
        point.pointId,
        compressedFile,
        photoType,
        '', // No drawings initially
        this.serviceId  // CRITICAL: Pass serviceId for LocalImage lookup
      );

      console.log(`[Point Photo] Photo ${photoType} processed for point ${point.pointName}:`, result);

      // Update local state with result
      if (result) {
        // CRITICAL: Set imageId and localImageId for LocalImage system matching
        // These are the stable UUIDs that never change - essential for refreshPhotosFromLocalImages()
        existingPhoto.imageId = result.imageId;
        existingPhoto.localImageId = result.imageId;

        // CRITICAL: Preserve all ID fields for annotation lookups
        existingPhoto.AttachID = result.AttachID || result._tempId || tempPhotoId;
        existingPhoto.attachId = result.attachId || result.AttachID || result._tempId || tempPhotoId;
        existingPhoto._tempId = result._tempId || tempPhotoId;
        existingPhoto._pendingFileId = result._pendingFileId || result._tempId || tempPhotoId;
        existingPhoto.isPending = !!result._syncing || !!result.isPending;

        // CRITICAL: Update displayUrl to use persisted blob URL from IndexedDB
        // This URL survives page reload unlike the temporary webPath from camera
        const persistedUrl = result.url || result.Photo;
        if (persistedUrl) {
          existingPhoto.url = persistedUrl;
          existingPhoto.displayUrl = persistedUrl;
        }

        // Check if this is a local-first photo (not yet synced to server)
        // Local-first photos have status='local_only' or isLocalFirst=true
        const isLocalFirstPhoto = result.isLocalFirst || result.status === 'local_only' || result._syncing;

        if (isLocalFirstPhoto) {
          // Local-first: photo is stored locally and queued for background sync
          existingPhoto.uploading = false;
          existingPhoto.queued = true;
          // Display URL is already set from the blob stored in IndexedDB
          console.log(`[Point Photo] Photo stored locally for background sync, imageId:`, existingPhoto.imageId);
        } else {
          // Online upload completed - photo was synced immediately
          existingPhoto.uploading = false;
          existingPhoto.queued = false;

          // Load the uploaded photo URL from server
          if (result.Photo && !result.Photo.startsWith('blob:')) {
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

    } catch (error: any) {
      console.error('Error processing point photo:', error);

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
      
      // PERFORMANCE FIX: Try bulk map first (O(1) lookup), fall back to IndexedDB if not found
      const attachId = photo.attachId;
      if (attachId) {
        console.log('[Point Annotate] Checking bulk cache for:', attachId);
        let cachedDataUrl = this.bulkCachedPhotosMap.get(attachId);
        if (!cachedDataUrl) {
          // Fallback to IndexedDB for photos added mid-session
          cachedDataUrl = await this.indexedDb.getCachedPhoto(attachId) || undefined;
        }
        if (cachedDataUrl && cachedDataUrl.startsWith('data:')) {
          console.log('[Point Annotate] ✅ Using cached data URL');
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

      if (compressedDrawings && compressedDrawings !== EMPTY_COMPRESSED_ANNOTATIONS && !compressedDrawings.startsWith('H4sI')) {
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

        // CRITICAL FIX: Use TRUE IMMUTABLE pattern - replace entire photo object in array
        // This ensures Angular change detection properly sees the update
        const photoIndex = point.photos.findIndex((p: any) => 
          p.attachId === photo.attachId || 
          p._tempId === photo._tempId ||
          p._pendingFileId === photo._pendingFileId
        );
        
        if (photoIndex >= 0) {
          // Replace the entire photo object in the array (immutable update)
          point.photos[photoIndex] = {
            ...photo,
            drawings: savedCompressedDrawings,
            caption: data.caption !== undefined ? data.caption : existingCaption,
            displayUrl: newUrl,
            thumbnailUrl: newUrl,  // ANNOTATION FIX: Update thumbnail to show annotations
            hasAnnotations: !!annotationsData,
            Drawings: savedCompressedDrawings,
            _localUpdate: true
          };
          console.log('[Point SAVE] ✅ Replaced photo object in array at index:', photoIndex);
        } else {
          // Fallback: mutate existing object
          photo.drawings = savedCompressedDrawings;
          photo.caption = data.caption !== undefined ? data.caption : existingCaption;
          photo.displayUrl = newUrl;
          photo.thumbnailUrl = newUrl;  // ANNOTATION FIX: Update thumbnail to show annotations
          photo.hasAnnotations = !!annotationsData;
          console.log('[Point SAVE] ⚠️ Photo not found in array, mutated existing object');
        }

        console.log('[Point SAVE] Updated photo with compressed drawings, length:', savedCompressedDrawings?.length || 0);

        // Force UI update
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
            // DEXIE-FIRST: Immediate UI update, then delete from Dexie tables
            try {
              // Remove from local array IMMEDIATELY (optimistic update)
              // DELETE FIX: Check multiple identifiers - local photos may not have attachId yet
              let index = point.photos.findIndex((p: any) =>
                (photo.attachId && p.attachId === photo.attachId) ||
                (photo.imageId && p.imageId === photo.imageId) ||
                (photo.localImageId && p.localImageId === photo.localImageId) ||
                (photo.imageId && p.localImageId === photo.imageId) ||
                (photo.localImageId && p.imageId === photo.localImageId)
              );

              // DEXIE-FIRST FIX: Fallback to photoType match if ID-based search fails
              // This handles cases where photo IDs aren't populated yet
              if (index < 0 && photo.photoType) {
                index = point.photos.findIndex((p: any) => p.photoType === photo.photoType);
                if (index >= 0) {
                  console.log('[Point Photo] Found by photoType fallback:', photo.photoType);
                }
              }

              // DEXIE-FIRST FIX: Last resort - find by object reference
              if (index < 0) {
                index = point.photos.indexOf(photo);
                if (index >= 0) {
                  console.log('[Point Photo] Found by object reference');
                }
              }

              if (index >= 0) {
                point.photos.splice(index, 1);
                console.log('[Point Photo] ✅ Removed from UI array at index:', index);
              } else {
                console.warn('[Point Photo] Could not find photo in array to remove:', photo);
                // DEXIE-FIRST FIX: Force clear the array for this photoType as last resort
                if (photo.photoType) {
                  point.photos = point.photos.filter((p: any) => p.photoType !== photo.photoType);
                  console.log('[Point Photo] Force-filtered photos by photoType:', photo.photoType);
                }
              }

              // DEXIE-FIRST FIX: Track deleted photo IDs to prevent re-adding during sync/reload
              // Add all possible identifiers for this photo to the tracking set
              const imageId = photo.imageId || photo.localImageId;
              if (imageId) {
                this.deletedPointPhotoIds.add(imageId);
                console.log('[Point Photo] Added to deletedPointPhotoIds:', imageId);
              }
              if (photo.attachId) {
                this.deletedPointPhotoIds.add(String(photo.attachId));
                console.log('[Point Photo] Added attachId to deletedPointPhotoIds:', photo.attachId);
              }
              if (photo._tempId) {
                this.deletedPointPhotoIds.add(String(photo._tempId));
              }
              // DEXIE-FIRST FIX: Also track by composite key (pointId:photoType) as fallback
              // This handles cases where photo has no IDs yet
              const pointIdForTracking = point.pointId || point.tempPointId;
              if (pointIdForTracking && photo.photoType) {
                const compositeKey = `${pointIdForTracking}:${photo.photoType}`;
                this.deletedPointPhotoIds.add(compositeKey);
                console.log('[Point Photo] Added composite key to deletedPointPhotoIds:', compositeKey);
              }

              // DEXIE-FIRST FIX: Remove from preservation maps so photo doesn't reappear
              // These maps are used during sync/reload to restore photos
              const pointName = point.name;
              const pointId = point.pointId;
              if (pointName && this.preservedPhotosByPointName.has(pointName)) {
                const preserved = this.preservedPhotosByPointName.get(pointName) || [];
                const filteredPreserved = preserved.filter((p: any) => {
                  const pImageId = p.imageId || p.localImageId;
                  const pAttachId = p.attachId ? String(p.attachId) : null;
                  const pTempId = p._tempId ? String(p._tempId) : null;
                  const pCompositeKey = pointIdForTracking && p.photoType ? `${pointIdForTracking}:${p.photoType}` : null;
                  return !this.deletedPointPhotoIds.has(pImageId) &&
                         !this.deletedPointPhotoIds.has(pAttachId || '') &&
                         !this.deletedPointPhotoIds.has(pTempId || '') &&
                         !this.deletedPointPhotoIds.has(pCompositeKey || '');
                });
                this.preservedPhotosByPointName.set(pointName, filteredPreserved);
                console.log(`[Point Photo] Updated preservedPhotosByPointName for "${pointName}": ${preserved.length} -> ${filteredPreserved.length}`);
              }
              if (pointId && this.preservedPhotosByPointId.has(String(pointId))) {
                const preserved = this.preservedPhotosByPointId.get(String(pointId)) || [];
                const filteredPreserved = preserved.filter((p: any) => {
                  const pImageId = p.imageId || p.localImageId;
                  const pAttachId = p.attachId ? String(p.attachId) : null;
                  const pTempId = p._tempId ? String(p._tempId) : null;
                  const pCompositeKey = pointId && p.photoType ? `${pointId}:${p.photoType}` : null;
                  return !this.deletedPointPhotoIds.has(pImageId) &&
                         !this.deletedPointPhotoIds.has(pAttachId || '') &&
                         !this.deletedPointPhotoIds.has(pTempId || '') &&
                         !this.deletedPointPhotoIds.has(pCompositeKey || '');
                });
                this.preservedPhotosByPointId.set(String(pointId), filteredPreserved);
                console.log(`[Point Photo] Updated preservedPhotosByPointId for "${pointId}": ${preserved.length} -> ${filteredPreserved.length}`);
              }

              // Force UI update first
              this.changeDetectorRef.detectChanges();

              // DEXIE-FIRST: Delete from LocalImages table (the source of truth)
              // imageId already defined above for tracking deleted photos
              if (imageId) {
                try {
                  await this.localImageService.deleteLocalImage(imageId);
                  console.log('[Point Photo] ✅ Deleted from LocalImages:', imageId);

                  // DELETE FIX: Also clear cached photos/annotations by imageId
                  // Local-first photos may be cached by imageId, not attachId
                  // deleteCachedPhoto deletes both regular and annotated versions
                  await this.indexedDb.deleteCachedPhoto(imageId);

                  // Clear from in-memory caches
                  this.bulkCachedPhotosMap.delete(imageId);
                  this.bulkAnnotatedImagesMap.delete(imageId);
                } catch (e) {
                  console.warn('[Point Photo] Failed to delete from LocalImages:', e);
                }
              }

              // DEXIE-FIRST: Update photoCount in efeFields.elevationPoints
              // This ensures the Dexie state reflects the deletion
              try {
                const newPhotoCount = point.photos?.length || 0;
                await this.efeFieldRepo.updatePointPhotoCount(
                  this.serviceId,
                  this.roomName,
                  point.pointNumber,
                  newPhotoCount
                );
                console.log('[Point Photo] ✅ Updated Dexie photoCount:', newPhotoCount);
              } catch (repoErr) {
                console.warn('[Point Photo] Failed to update Dexie photoCount:', repoErr);
              }

              if (photo.attachId) {
                // Clear cached photo IMAGE from IndexedDB by attachId
                // deleteCachedPhoto deletes both regular and annotated versions
                await this.indexedDb.deleteCachedPhoto(String(photo.attachId));

                // Clear from in-memory caches by attachId
                this.bulkCachedPhotosMap.delete(String(photo.attachId));
                this.bulkAnnotatedImagesMap.delete(String(photo.attachId));

                // Remove from cached ATTACHMENTS LIST in IndexedDB
                await this.indexedDb.removeAttachmentFromCache(String(photo.attachId), 'efe_point_attachments');

                // Delete from database - always queue to ensure reliable sync
                if (!String(photo.attachId).startsWith('temp_') && !String(photo.attachId).startsWith('img_')) {
                  console.log('[Point Photo] Queuing delete for sync:', photo.attachId);
                  await this.indexedDb.addPendingRequest({
                    type: 'DELETE',
                    endpoint: `/api/caspio-proxy/tables/LPS_Services_EFE_Points_Attach/records?q.where=AttachID=${photo.attachId}`,
                    method: 'DELETE',
                    data: { attachId: photo.attachId },
                    dependencies: [],
                    status: 'pending',
                    priority: 'high',
                  });
                  // Sync will happen on next 60-second interval (batched sync)
                }

                console.log('[Point Photo] Photo removed successfully');
              }

              // Clear the in-memory attachments cache
              this.foundationData.clearEFEAttachmentsCache();

              // DEXIE-FIRST: Final UI update to ensure photo is visually removed
              this.changeDetectorRef.detectChanges();
              console.log('[Point Photo] ✅ Deletion complete (Dexie-first). Photos remaining:', point.photos?.length || 0);
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
   * Uses unified caption queue to ensure captions are NEVER lost during sync operations
   */
  private async savePointCaption(photo: any, newCaption: string): Promise<void> {
    try {
      // 1. Update local UI state immediately
      photo.caption = newCaption;
      photo.Annotation = newCaption;
      photo._localUpdate = true;
      this.changeDetectorRef.detectChanges();

      // CRITICAL: For local-first images, update the LocalImage record directly
      // This ensures captions persist through navigation and page reloads
      // (Matches category-detail.page.ts pattern)
      const isLocalFirst = photo.isLocalFirst || photo.isLocalImage;
      const localImageId = photo.localImageId || photo.imageId;

      if (isLocalFirst && localImageId) {
        this.localImageService.updateCaptionAndDrawings(localImageId, newCaption).catch((e: any) => {
          console.warn('[Point Caption] Failed to update LocalImage caption:', e);
        });
      }

      // 2. Get the attachment ID (could be temp or real)
      // For local-first images, use localImageId (will be resolved to real attachId by sync worker)
      // Check all possible property names that might hold the ID
      const attachId = isLocalFirst && localImageId
        ? localImageId  // Will be resolved to real attachId by sync worker
        : String(
            photo._pendingFileId ||
            photo._tempId ||
            photo.attachId ||
            photo.AttachID ||
            ''
          );

      if (!attachId) {
        console.error('[Point Caption] ❌ No attachId found for photo:', photo);
        return;
      }

      console.log(`[Point Caption] Saving caption for attachId: ${attachId}`);
      
      // 3. Find the point ID for cache lookup
      let pointId: string | undefined;
      for (const p of this.elevationPoints) {
        const foundPhoto = p.photos?.find((ph: any) => 
          String(ph.attachId) === attachId || 
          String(ph.AttachID) === attachId ||
          String(ph._tempId) === attachId ||
          String(ph._pendingFileId) === attachId
        );
        if (foundPhoto && p.pointId) {
          pointId = String(p.pointId);
          console.log(`[Point Caption] Found point ID: ${pointId} for attachId: ${attachId}`);
          break;
        }
      }
      
      if (!pointId) {
        console.warn(`[Point Caption] ⚠️ Could not find point ID for attachId: ${attachId}, proceeding anyway`);
      }
      
      // 4. ALWAYS queue the caption update using the unified method
      // This works for both temp IDs and real IDs, online and offline
      await this.foundationData.queueCaptionUpdate(
        attachId,
        newCaption,
        'efe_point',
        {
          serviceId: this.serviceId,
          pointId: pointId
        }
      );
      
      console.log(`[Point Caption] ✅ Caption queued for sync: ${attachId}`);
      
    } catch (error) {
      console.error('[Point Caption] ❌ Error saving caption:', error);
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

  // ===== LAZY IMAGE LOADING METHODS =====

  /**
   * Check if photos are expanded for a point
   */
  isPointPhotosExpanded(pointId: string): boolean {
    return this.expandedPoints[pointId] === true;
  }

  /**
   * Toggle photo expansion for a point - expands and loads photos on first click
   */
  togglePointPhotoExpansion(point: any): void {
    const pointId = String(point.pointId || point.id);
    
    if (this.expandedPoints[pointId]) {
      // Collapse
      this.expandedPoints[pointId] = false;
    } else {
      // Expand and load photos that haven't been loaded yet
      this.expandedPoints[pointId] = true;
      
      // LAZY LOADING: Load photos on-demand when expanded
      if (point.photos && point.photos.length > 0) {
        for (const photo of point.photos) {
          if (photo.needsLoad && photo.path) {
            photo.loading = true;
            this.loadPointPhotoImage(photo.path, photo).then(() => {
              photo.needsLoad = false;
              photo.loading = false;
              this.changeDetectorRef.detectChanges();
            }).catch(err => {
              console.warn('[RoomElevation] Failed to load photo on expand:', err);
              photo.loading = false;
              this.changeDetectorRef.detectChanges();
            });
          }
        }
      }
    }
    
    this.changeDetectorRef.detectChanges();
  }

  /**
   * Get photo count for a point (Measurement + Location)
   */
  getPointPhotoCount(point: any): number {
    let count = 0;
    if (this.getPointPhotoByType(point, 'Measurement')) count++;
    if (this.getPointPhotoByType(point, 'Location')) count++;
    return count;
  }

  /**
   * Expand photos for a point
   */
  expandPointPhotos(point: any): void {
    const pointId = String(point.pointId || point.id);
    this.expandedPoints[pointId] = true;
    this.changeDetectorRef.detectChanges();
  }

  /**
   * Collapse photos for a point
   */
  collapsePointPhotos(point: any): void {
    const pointId = String(point.pointId || point.id);
    this.expandedPoints[pointId] = false;
    this.changeDetectorRef.detectChanges();
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
    // EMPTY_COMPRESSED_ANNOTATIONS is imported from annotation-utils - uses proper JSON format, not gzip

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

    // TASK 2 FIX: Always queue FDF annotation updates through unified queue system
    // This ensures annotations appear in sync queue icon (matching point photos behavior)
    // FDF uses roomId as the "attachId" since FDF data is stored on the EFE room record
    // The photoType is passed in pointId for the background sync handler to use

    // Queue the FDF annotation update using unified method
    // This handles both temp IDs and real IDs, online and offline
    await this.foundationData.queueCaptionAndAnnotationUpdate(
      roomId,  // Use roomId as attachId - FDF data is on EFE room record
      caption || '',
      drawingsData,
      'fdf',
      {
        serviceId: this.serviceId,
        pointId: photoType  // photoType (Top/Bottom/Threshold) passed as pointId for FDF sync handler
      }
    );
    console.log('[SAVE FDF] ✅ FDF annotation queued for sync, roomId:', roomId, 'photoType:', photoType);

    // CRITICAL FIX: Cache the annotated image blob for thumbnail display on reload
    if (annotatedBlob && annotatedBlob.size > 0) {
      try {
        const cacheId = `fdf_${roomId}_${photoType.toLowerCase()}`;
        const base64 = await this.indexedDb.cacheAnnotatedImage(cacheId, annotatedBlob);
        console.log('[SAVE FDF] ✅ Annotated image blob cached:', cacheId);
        // Update in-memory map so same-session navigation shows the annotation
        if (base64) {
          this.bulkAnnotatedImagesMap.set(cacheId, base64);
        }

        // DEXIE-FIRST FIX: Update LocalImages.drawings to trigger liveQuery
        // Get the FDF photo's LocalImage ID from fdfPhotos
        const photoKey = photoType.toLowerCase();
        const fdfImageId = this.roomData?.fdfPhotos?.[`${photoKey}ImageId`];
        if (fdfImageId && base64) {
          // Also cache under imageId for LocalImage lookup
          await this.indexedDb.cacheAnnotatedImage(fdfImageId, annotatedBlob);
          this.bulkAnnotatedImagesMap.set(fdfImageId, base64);

          await this.localImageService.updateCaptionAndDrawings(fdfImageId, undefined, drawingsData);
          console.log('[SAVE FDF] ✅ Updated LocalImages.drawings for liveQuery trigger:', fdfImageId);
        }
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
          // EMPTY_COMPRESSED_ANNOTATIONS is imported from annotation-utils - uses proper JSON format, not gzip
          drawingsData = compressAnnotationData(drawingsData, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });

          console.log(`[SAVE] Compressed annotations: ${originalSize} â†' ${drawingsData.length} bytes`);

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
        // Empty annotations - use proper JSON format from annotation-utils
        updateData.Drawings = EMPTY_COMPRESSED_ANNOTATIONS;
      }
    } else {
      // No annotations provided - use proper JSON format from annotation-utils
      updateData.Drawings = EMPTY_COMPRESSED_ANNOTATIONS;
    }

    console.log('[SAVE] Saving annotations to database:', {
      attachId,
      hasDrawings: !!updateData.Drawings,
      drawingsLength: updateData.Drawings?.length || 0,
      caption: caption || '(empty)'
    });

    // Find the pointId for this attachment (needed for cache update and queue)
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

    // CRITICAL: Update IndexedDB cache FIRST (offline-first pattern)
    // This ensures annotations persist locally even if API call fails
    try {
      // CRITICAL FIX: Check for local-first photos first (imageId from LocalImageService)
      const localImageId = foundPhoto?.localImageId || foundPhoto?.imageId;
      if (localImageId && (foundPhoto?.isLocalFirst || foundPhoto?.isLocalImage)) {
        // This is a local-first photo - update LocalImage record directly
        console.log('[SAVE] Updating annotations for local-first photo:', localImageId);
        await this.localImageService.updateCaptionAndDrawings(
          localImageId,
          updateData.Annotation || caption,
          updateData.Drawings
        );
        console.log('[SAVE] ✅ LocalImage record updated with drawings:', localImageId);
        if (foundPhoto) {
          foundPhoto._localUpdate = true;
        }
      } else if (String(attachId).startsWith('temp_') || (foundPhoto && foundPhoto.isPending)) {
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
          const base64 = await this.indexedDb.cacheAnnotatedImage(String(attachId), annotatedBlob);
          console.log('[SAVE] ✅ EFE Annotated image blob cached for thumbnail display:', attachId);
          // Update in-memory map so same-session navigation shows the annotation
          if (base64) {
            this.bulkAnnotatedImagesMap.set(String(attachId), base64);
          }

          // CRITICAL FIX: Also cache under imageId if it's different (local-first photos)
          // This ensures annotations are found before sync when attachId is still imageId
          const localImageId = foundPhoto?.localImageId || foundPhoto?.imageId;
          if (localImageId && localImageId !== String(attachId)) {
            await this.indexedDb.cacheAnnotatedImage(localImageId, annotatedBlob);
            if (base64) {
              this.bulkAnnotatedImagesMap.set(localImageId, base64);
            }
            console.log('[SAVE] ✅ Also cached under localImageId:', localImageId);
          }

          // DEXIE-FIRST FIX: Update LocalImages.drawings to trigger liveQuery
          // This makes localImages the source of truth and triggers UI refresh
          if (localImageId) {
            await this.localImageService.updateCaptionAndDrawings(localImageId, undefined, updateData.Drawings);
            console.log('[SAVE] ✅ Updated LocalImages.drawings for liveQuery trigger:', localImageId);
          }
        } catch (annotCacheErr) {
          console.warn('[SAVE] Failed to cache EFE annotated image blob:', annotCacheErr);
        }
      }
    } catch (cacheError) {
      console.warn('[SAVE] Failed to update IndexedDB cache:', cacheError);
      // Continue anyway - still queue for sync
    }

    // Queue the annotation update using the correct attachId
    // For local-first photos that have synced, use the real Caspio attachId
    let syncAttachId = attachId;
    const localImageId = foundPhoto?.localImageId || foundPhoto?.imageId;

    if (localImageId && (foundPhoto?.isLocalFirst || foundPhoto?.isLocalImage)) {
      // Check if this local-first photo has already synced (has real Caspio ID)
      try {
        const localImage = await this.indexedDb.getLocalImage(localImageId);
        if (localImage?.attachId && !String(localImage.attachId).startsWith('img_') && !String(localImage.attachId).startsWith('temp_')) {
          // Photo was synced - use the real attachId for queueing annotation update
          syncAttachId = localImage.attachId;
          console.log('[SAVE] Local-first photo already synced, using real attachId for queue:', syncAttachId);
        }
      } catch (e) {
        console.warn('[SAVE] Could not check LocalImage sync status:', e);
      }
    }

    await this.foundationData.queueCaptionAndAnnotationUpdate(
      syncAttachId,
      caption || '',
      updateData.Drawings,
      'efe_point',
      {
        serviceId: this.serviceId,
        pointId: pointIdForCache || undefined
      }
    );
    console.log('[SAVE] ✅ EFE annotation queued for sync:', syncAttachId);

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
    // Point must have a pointId (real or temp) to enable photo buttons
    // STEP 5.5 in loadElevationPoints() auto-creates points and assigns IDs
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

  async openHelp(helpId: number, helpTitle: string) {
    const modal = await this.modalController.create({
      component: HelpModalComponent,
      componentProps: {
        helpId: helpId,
        title: helpTitle
      },
      cssClass: 'help-modal'
    });
    await modal.present();
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
            },
            {
              text: 'Cancel',
              role: 'cancel',
              handler: () => {
                resolve(null);
                return true;
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

  /**
   * Handle image load success
   */
  handleImageLoad(event: Event, photo: any): void {
    const img = event.target as HTMLImageElement;
    if (!img) return;

    // Mark as successfully loaded
    photo.loading = false;
    photo.displayState = 'loaded';
  }

  /**
   * Handle image load error - recover using cached annotated image
   * CRITICAL: This prevents annotations from disappearing when blob URLs become invalid
   */
  async handleImageError(event: Event, photo: any): Promise<void> {
    const img = event.target as HTMLImageElement;
    if (!img) return;

    console.warn('[IMAGE ERROR] Failed to load:', photo.attachId || photo.imageId, 'url:', img.src?.substring(0, 50));

    // Don't retry if already showing placeholder
    if (img.src === 'assets/img/photo-placeholder.png' || img.src.endsWith('photo-placeholder.png')) {
      return;
    }

    // Track retry attempts to prevent infinite loops
    if (!photo._retryCount) {
      photo._retryCount = 0;
    }
    photo._retryCount++;

    if (photo._retryCount > 2) {
      console.warn('[IMAGE ERROR] Max retries reached, showing placeholder');
      img.src = 'assets/img/photo-placeholder.png';
      photo.displayUrl = 'assets/img/photo-placeholder.png';
      photo.loading = false;
      return;
    }

    // Try fallback chain
    try {
      // CRITICAL: Check for cached annotated image FIRST to preserve annotations in thumbnails
      const attachId = String(photo.attachId || photo.AttachID || photo.id || '');
      const localImageId = photo.localImageId || photo.imageId;

      // Try annotated image from in-memory map first (fastest)
      let annotatedImage = this.bulkAnnotatedImagesMap.get(attachId);
      if (!annotatedImage && localImageId) {
        annotatedImage = this.bulkAnnotatedImagesMap.get(localImageId);
      }

      // If not in memory, try to get from IndexedDB cache
      if (!annotatedImage && (photo.hasAnnotations || photo.Drawings || photo.drawings)) {
        try {
          annotatedImage = await this.indexedDb.getCachedAnnotatedImage(attachId) || undefined;
          if (!annotatedImage && localImageId) {
            annotatedImage = await this.indexedDb.getCachedAnnotatedImage(localImageId) || undefined;
          }
          // Store in memory map for future use
          if (annotatedImage) {
            this.bulkAnnotatedImagesMap.set(attachId || localImageId, annotatedImage);
          }
        } catch (e) {
          console.warn('[IMAGE ERROR] Failed to get cached annotated image:', e);
        }
      }

      if (annotatedImage) {
        console.log('[IMAGE ERROR] Using cached ANNOTATED image:', attachId || localImageId);
        img.src = annotatedImage;
        photo.displayUrl = annotatedImage;
        photo.thumbnailUrl = annotatedImage;
        return;
      }

      // Fallback 1: Try LocalImage system
      if (photo.isLocalImage || photo.localImageId || photo.imageId) {
        const localImage = await this.indexedDb.getLocalImage(localImageId);

        if (localImage) {
          const fallbackUrl = await this.localImageService.getDisplayUrl(localImage);
          if (fallbackUrl && fallbackUrl !== 'assets/img/photo-placeholder.png') {
            console.log('[IMAGE ERROR] Using LocalImage fallback:', localImageId);
            img.src = fallbackUrl;
            photo.displayUrl = fallbackUrl;
            photo.url = fallbackUrl;
            photo.thumbnailUrl = fallbackUrl;
            return;
          }
        }
      }

      // Fallback 2: Try cached photo by attachId
      if (attachId && !attachId.startsWith('temp_') && !attachId.startsWith('img_')) {
        const cached = await this.indexedDb.getCachedPhoto(attachId);
        if (cached) {
          console.log('[IMAGE ERROR] Using cached photo fallback:', attachId);
          img.src = cached;
          photo.displayUrl = cached;
          photo.url = cached;
          photo.thumbnailUrl = cached;
          return;
        }
      }

      // Fallback 3: Placeholder
      console.log('[IMAGE ERROR] No fallback available, showing placeholder');
      img.src = 'assets/img/photo-placeholder.png';
      photo.displayUrl = 'assets/img/photo-placeholder.png';
      photo.loading = false;

    } catch (err) {
      console.error('[IMAGE ERROR] Fallback failed:', err);
      img.src = 'assets/img/photo-placeholder.png';
      photo.displayUrl = 'assets/img/photo-placeholder.png';
      photo.loading = false;
    }
  }
}
