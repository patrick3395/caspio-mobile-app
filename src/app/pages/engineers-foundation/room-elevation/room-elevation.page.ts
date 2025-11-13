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
  loading: boolean = true;

  // FDF dropdown options
  fdfOptions: string[] = [];

  // Notes debounce timer
  notesDebounceTimer: any = null;

  // Track saving state
  isSavingNotes: boolean = false;
  isSavingFdf: boolean = false;
  isSavingLocation: boolean = false;

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
    private imageCompression: ImageCompressionService
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
      await this.showToast(`Error: Missing service or project ID. ServiceID: ${this.serviceId}, ProjectID: ${this.projectId}`, 'danger');
      this.loading = false;
      return;
    }

    // Additional validation for serviceId as number
    const serviceIdNum = parseInt(this.serviceId, 10);
    if (isNaN(serviceIdNum)) {
      console.error('[RoomElevation] ERROR: ServiceId is not a valid number:', this.serviceId);
      await this.showToast(`Error: Invalid ServiceID (${this.serviceId}). Ensure you have the correct service ID.`, 'danger');
      this.loading = false;
      return;
    }

    console.log('[RoomElevation] Validation passed. Loading room data...');

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
    console.log('[RoomElevation] loadRoomData() called');
    console.log('  - ServiceId:', this.serviceId);
    console.log('  - RoomName:', this.roomName);

    this.loading = true;
    try {
      // Load room record from Services_EFE
      console.log('[RoomElevation] Calling foundationData.getEFEByService with serviceId:', this.serviceId);
      const rooms = await this.foundationData.getEFEByService(this.serviceId, true);
      console.log('[RoomElevation] getEFEByService returned', rooms?.length || 0, 'rooms');
      console.log('[RoomElevation] Rooms:', rooms);

      const room = rooms.find((r: any) => r.RoomName === this.roomName);
      console.log('[RoomElevation] Found room matching name "' + this.roomName + '":', room);

      if (!room) {
        console.error('[RoomElevation] ERROR: Room not found with name:', this.roomName);
        console.error('[RoomElevation] Available room names:', rooms.map((r: any) => r.RoomName));
        await this.showToast('Room not found', 'danger');
        this.goBack();
        return;
      }

      this.roomId = room.EFEID;
      console.log('[RoomElevation] Room ID set to:', this.roomId);
      console.log('[RoomElevation] Room TemplateID from database:', room.TemplateID);
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
      await this.showToast('Failed to load room data', 'danger');
    } finally {
      this.loading = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  private async loadFDFPhotos(room: any) {
    const fdfPhotos = this.roomData.fdfPhotos;

    // Load Top photo
    if (room.FDFPhotoTop) {
      fdfPhotos.top = true;
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
      fdfPhotos.bottom = true;
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
      fdfPhotos.threshold = true;
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
        console.error('[RoomElevation] ❌ ERROR: No TemplateID found for room!');
        console.error('[RoomElevation] roomData structure:', JSON.stringify(this.roomData, null, 2));
        return;
      }

      // Load all templates
      console.log('[RoomElevation] Calling foundationData.getEFETemplates()...');
      const allTemplates = await this.foundationData.getEFETemplates();
      console.log('[RoomElevation] ✓ Loaded', allTemplates?.length || 0, 'templates from LPS_Services_EFE_Templates');

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
        console.error('[RoomElevation] ❌ ERROR: Template not found for TemplateID:', templateIdNum);
        console.error('[RoomElevation] Available templates:', allTemplates.map((t: any) => ({ TemplateID: t.TemplateID, PK_ID: t.PK_ID, RoomName: t.RoomName })));
        return;
      }

      console.log('[RoomElevation] ✓ Found matching template:', template.RoomName);
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
          console.log(`[RoomElevation]     ✓ Added point #${i}: "${pointName}"`);
        }
      }

      console.log('[RoomElevation] ✓ Template has', templatePoints.length, 'predefined points');
      console.log('[RoomElevation] Template points:', templatePoints.map(p => p.name));

      // STEP 3: Load existing points from Services_EFE_Points
      console.log('\n[RoomElevation] STEP 3: Loading existing points from Services_EFE_Points...');
      console.log('[RoomElevation] Calling getServicesEFEPoints with roomId:', this.roomId);

      let existingPoints: any[] = [];
      try {
        existingPoints = await this.caspioService.getServicesEFEPoints(this.roomId).toPromise() || [];
        console.log('[RoomElevation] ✓ Found', existingPoints?.length || 0, 'existing points in database');
        if (existingPoints && existingPoints.length > 0) {
          console.log('[RoomElevation] Existing points:', existingPoints.map((p: any) => ({
            PointID: p.PointID,
            PointName: p.PointName,
            Elevation: p.Elevation
          })));
        }
      } catch (error) {
        console.error('[RoomElevation] ❌ Error loading existing points:', error);
      }

      // STEP 4: Load all attachments for existing points
      console.log('\n[RoomElevation] STEP 4: Loading attachments...');
      let attachments: any[] = [];
      if (existingPoints && existingPoints.length > 0) {
        const pointIds = existingPoints.map((p: any) => p.PointID || p.PK_ID).filter(id => id);
        console.log('[RoomElevation] Point IDs to fetch attachments for:', pointIds);

        if (pointIds.length > 0) {
          try {
            attachments = await this.foundationData.getEFEAttachments(pointIds);
            console.log('[RoomElevation] ✓ Loaded', attachments?.length || 0, 'attachments from Services_EFE_Points_Attach');
            if (attachments && attachments.length > 0) {
              console.log('[RoomElevation] Attachments:', attachments.map((a: any) => ({
                AttachID: a.AttachID,
                PointID: a.PointID,
                PhotoType: a.PhotoType,
                Photo: a.Photo
              })));
            }
          } catch (error) {
            console.error('[RoomElevation] ❌ Error loading attachments:', error);
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
          const pointAttachments = attachments.filter((att: any) => att.PointID === pointId);
          console.log(`[RoomElevation]   Found ${pointAttachments.length} attachments for this point`);

          // Process each attachment
          for (const attach of pointAttachments) {
            const photoType = attach.PhotoType || 'Measurement';
            console.log(`[RoomElevation]     Processing attachment: Type=${photoType}, Photo=${attach.Photo}`);

            const photoData: any = {
              attachId: attach.AttachID || attach.PK_ID,
              photoType: photoType,
              url: null,
              displayUrl: null,
              caption: attach.Annotation || '',
              drawings: attach.Drawings || null,
              hasAnnotations: !!(attach.Drawings && attach.Drawings !== 'null'),
              path: attach.Photo || null,
              uploading: false
            };

            // Load the photo image if path exists
            if (attach.Photo) {
              try {
                const imageData = await this.foundationData.getImage(attach.Photo);
                if (imageData) {
                  photoData.url = imageData;
                  photoData.displayUrl = imageData;
                  console.log(`[RoomElevation]       ✓ Loaded photo image`);
                }
              } catch (error) {
                console.error(`[RoomElevation]       ❌ Error loading photo:`, error);
              }
            }

            pointData.photos.push(photoData);
          }
        }

        console.log(`[RoomElevation]   ✓ Point "${templatePoint.name}" complete:`, {
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

            const newPointData = {
              EFEID: parseInt(this.roomId, 10),
              PointName: point.name
            };

            console.log('[RoomElevation]     Request data:', newPointData);

            const response = await this.caspioService.createServicesEFEPoint(newPointData).toPromise();
            console.log('[RoomElevation]     Response received:', response);

            const newPointId = response?.PointID || response?.PK_ID;

            if (newPointId) {
              point.pointId = newPointId;
              console.log(`[RoomElevation]     ✓ Created with PointID: ${newPointId}`);
              console.log(`[RoomElevation]     Point now has pointId:`, point.pointId);
            } else {
              console.error(`[RoomElevation]     ❌ Failed to get PointID from response:`, response);
            }
          } catch (error) {
            console.error(`[RoomElevation]     ❌ Error creating point "${point.name}":`, error);
            console.error('[RoomElevation]     Error details:', error);
          }
        }

        // Trigger change detection after creating all points
        console.log('[RoomElevation] Triggering change detection after point creation...');
        this.changeDetectorRef.detectChanges();
      }
      console.log('[RoomElevation] ✓ Auto-creation complete');
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
            const pointAttachments = attachments.filter((att: any) => att.PointID === pointId);
            console.log(`[RoomElevation]     Found ${pointAttachments.length} attachments for custom point`);

            for (const attach of pointAttachments) {
              const photoType = attach.PhotoType || 'Measurement';
              console.log(`[RoomElevation]       Processing attachment: Type=${photoType}`);

              const photoData: any = {
                attachId: attach.AttachID || attach.PK_ID,
                photoType: photoType,
                url: null,
                displayUrl: null,
                caption: attach.Annotation || '',
                drawings: attach.Drawings || null,
                hasAnnotations: !!(attach.Drawings && attach.Drawings !== 'null'),
                path: attach.Photo || null,
                uploading: false
              };

              // Load the photo image if path exists
              if (attach.Photo) {
                try {
                  const imageData = await this.foundationData.getImage(attach.Photo);
                  if (imageData) {
                    photoData.url = imageData;
                    photoData.displayUrl = imageData;
                    console.log(`[RoomElevation]         ✓ Loaded photo image`);
                  }
                } catch (error) {
                  console.error(`[RoomElevation]         ❌ Error loading photo:`, error);
                }
              }

              customPointData.photos.push(photoData);
            }

            console.log(`[RoomElevation]     ✓ Custom point "${existingPoint.PointName}" added:`, {
              pointId: customPointData.pointId,
              value: customPointData.value,
              photoCount: customPointData.photos.length
            });

            this.roomData.elevationPoints.push(customPointData);
          }
        }
      }
      console.log('[RoomElevation] ✓ Custom points check complete');

      console.log('\n========================================');
      console.log('[RoomElevation] *** LOAD ELEVATION POINTS - COMPLETE ***');
      console.log('[RoomElevation] Total elevation points:', this.roomData.elevationPoints.length);
      console.log('[RoomElevation] Final elevationPoints array:', this.roomData.elevationPoints);
      console.log('========================================\n');

      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('[RoomElevation] ❌❌❌ CRITICAL ERROR in loadElevationPoints:', error);
      console.error('[RoomElevation] Error stack:', error);
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
      // For now, we'll just keep the local preview
      // TODO: Implement proper file upload to Caspio
      // The file upload needs to use Files API or form data upload
      fdfPhotos[photoKey] = true; // Mark as having a photo
      fdfPhotos[`${photoKey}Path`] = webPath;

      await this.showToast('Photo saved locally (upload to be implemented)', 'warning');
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
                EFEID: parseInt(this.roomId, 10),
                PointName: data.pointName.trim()
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
        const photoResponse = await this.caspioService.createServicesEFEPointsAttachRecord(point.pointId, '', photoType).toPromise();
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

  // Additional methods for template
  trackByPointName(index: number, point: any): any {
    return point.pointId; // Use pointId for tracking, not name
  }

  trackByOption(index: number, option: string): any {
    return option;
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
}
