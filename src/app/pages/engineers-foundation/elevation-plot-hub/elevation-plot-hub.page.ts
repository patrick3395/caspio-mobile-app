import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { EngineersFoundationStateService } from '../services/engineers-foundation-state.service';
import { EngineersFoundationDataService } from '../engineers-foundation-data.service';
import { CaspioService } from '../../../services/caspio.service';
import { OperationsQueueService } from '../../../services/operations-queue.service';

interface RoomTemplate {
  RoomName: string;
  TemplateID: string | number;
  PK_ID?: string | number;
  PointCount: number;
  Auto?: string | boolean | number;
  [key: string]: any; // For Point1Name, Point2Name, etc.
}

interface RoomDisplayData extends RoomTemplate {
  isSelected: boolean;
  isSaving: boolean;
  efeId?: string;
}

@Component({
  selector: 'app-elevation-plot-hub',
  templateUrl: './elevation-plot-hub.page.html',
  styleUrls: ['./elevation-plot-hub.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class ElevationPlotHubPage implements OnInit {
  projectId: string = '';
  serviceId: string = '';
  roomTemplates: RoomDisplayData[] = [];
  selectedRooms: { [roomName: string]: boolean } = {};
  efeRecordIds: { [roomName: string]: string } = {};
  savingRooms: { [roomName: string]: boolean } = {};
  renamingRooms: { [roomName: string]: boolean } = {};
  roomElevationData: { [roomName: string]: any } = {};
  roomOperationIds: { [roomName: string]: string } = {};
  loading: boolean = true; // Track loading state

  allRoomTemplates: RoomTemplate[] = [];

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private stateService: EngineersFoundationStateService,
    private foundationData: EngineersFoundationDataService,
    private caspioService: CaspioService,
    private alertController: AlertController,
    private toastController: ToastController,
    private changeDetectorRef: ChangeDetectorRef,
    public operationsQueue: OperationsQueueService
  ) {}

  async ngOnInit() {
    console.log('========================================');
    console.log('[ElevationPlotHub] ngOnInit - Starting Route Debug');
    console.log('========================================');

    // Debug route hierarchy
    console.log('[ElevationPlotHub] Current route URL:', this.route.snapshot.url);
    console.log('[ElevationPlotHub] Current route params:', this.route.snapshot.params);

    if (this.route.parent) {
      console.log('[ElevationPlotHub] Parent route URL:', this.route.parent.snapshot.url);
      console.log('[ElevationPlotHub] Parent route params:', this.route.parent.snapshot.params);
      console.log('[ElevationPlotHub] Parent route paramMap keys:', Array.from(this.route.parent.snapshot.paramMap.keys));

      if (this.route.parent.parent) {
        console.log('[ElevationPlotHub] Parent.Parent route URL:', this.route.parent.parent.snapshot.url);
        console.log('[ElevationPlotHub] Parent.Parent route params:', this.route.parent.parent.snapshot.params);
        console.log('[ElevationPlotHub] Parent.Parent route paramMap keys:', Array.from(this.route.parent.parent.snapshot.paramMap.keys));
      }
    }

    // Get IDs from parent.parent route using SNAPSHOT (not subscription)
    // Route structure: /engineers-foundation/:projectId/:serviceId/elevation (hub is at empty path '')
    // So: parent = 'elevation', parent.parent = 'engineers-foundation' with params
    if (this.route.parent?.parent) {
      this.projectId = this.route.parent.parent.snapshot.paramMap.get('projectId') || '';
      this.serviceId = this.route.parent.parent.snapshot.paramMap.get('serviceId') || '';
      console.log('[ElevationPlotHub] Retrieved from parent.parent snapshot - ProjectId:', this.projectId, 'ServiceId:', this.serviceId);
    }

    // Fallback: try parent snapshot
    if (!this.projectId || !this.serviceId) {
      if (this.route.parent) {
        this.projectId = this.route.parent.snapshot.paramMap.get('projectId') || this.projectId;
        this.serviceId = this.route.parent.snapshot.paramMap.get('serviceId') || this.serviceId;
        console.log('[ElevationPlotHub] Fallback to parent snapshot - ProjectId:', this.projectId, 'ServiceId:', this.serviceId);
      }
    }

    // Second fallback: try direct snapshot
    if (!this.projectId || !this.serviceId) {
      this.projectId = this.route.snapshot.paramMap.get('projectId') || this.projectId;
      this.serviceId = this.route.snapshot.paramMap.get('serviceId') || this.serviceId;
      console.log('[ElevationPlotHub] Fallback to direct snapshot - ProjectId:', this.projectId, 'ServiceId:', this.serviceId);
    }

    console.log('\n[ElevationPlotHub] FINAL VALUES:');
    console.log('  - ProjectId:', this.projectId);
    console.log('  - ServiceId:', this.serviceId);
    console.log('========================================\n');

    if (!this.serviceId || !this.projectId) {
      console.error('[ElevationPlotHub] ERROR: Missing required IDs!');
      await this.showToast(`Error: Missing service or project ID. ServiceID: ${this.serviceId}, ProjectID: ${this.projectId}`, 'danger');
      return;
    }

    await this.loadRoomTemplates();
  }

  async navigateToRoom(room: RoomDisplayData, event?: Event) {
    console.log('[ElevationPlotHub] navigateToRoom called for room:', room.RoomName);
    console.log('  - Room isSelected:', room.isSelected);
    console.log('  - Current ServiceId:', this.serviceId);
    console.log('  - Current ProjectId:', this.projectId);

    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }

    // If room is not selected, create it first
    if (!room.isSelected) {
      console.log('[ElevationPlotHub] Room not selected, creating it first...');
      await this.createAndNavigateToRoom(room.RoomName);
    } else {
      // Room is already selected, just navigate
      console.log('[ElevationPlotHub] Room already selected, navigating directly...');
      this.router.navigate(['room', room.RoomName], { relativeTo: this.route });
    }
  }

  private async createAndNavigateToRoom(roomName: string) {
    console.log('[ElevationPlotHub] createAndNavigateToRoom called for room:', roomName);
    console.log('  - Current ServiceId:', this.serviceId);
    console.log('  - ServiceId type:', typeof this.serviceId);

    // Validate ServiceID
    const serviceIdNum = parseInt(this.serviceId, 10);
    console.log('  - Parsed ServiceId as number:', serviceIdNum);
    console.log('  - Is NaN?:', isNaN(serviceIdNum));

    if (!this.serviceId || isNaN(serviceIdNum)) {
      console.error('[ElevationPlotHub] ERROR: Invalid ServiceID!');
      console.error('  - ServiceId value:', this.serviceId);
      console.error('  - ServiceId is empty?:', !this.serviceId);
      console.error('  - ServiceId is NaN?:', isNaN(serviceIdNum));
      await this.showToast(`Error: Invalid ServiceID (${this.serviceId}). Ensure you have the correct service ID.`, 'danger');
      return;
    }

    // Build room data
    const roomData: any = {
      ServiceID: serviceIdNum,
      RoomName: roomName
    };

    // Include TemplateID to link back to template
    if (this.roomElevationData[roomName] && this.roomElevationData[roomName].templateId) {
      roomData.TemplateID = this.roomElevationData[roomName].templateId;
    }

    // OPTIMISTIC UI: Immediately show room as selected with temp ID
    this.selectedRooms[roomName] = true;
    this.efeRecordIds[roomName] = `temp_${Date.now()}`;
    this.savingRooms[roomName] = true;

    // Update room display data
    const roomIndex = this.roomTemplates.findIndex(r => r.RoomName === roomName);
    if (roomIndex >= 0) {
      this.roomTemplates[roomIndex].isSelected = true;
      this.roomTemplates[roomIndex].isSaving = true;
    }

    this.changeDetectorRef.detectChanges();

    try {
      // Create room in database
      const response = await this.caspioService.createServicesEFE(roomData).toPromise();
      // Use EFEID field - this is what links to Services_EFE_Points
      const roomId = response?.EFEID || response?.PK_ID || response?.id;

      if (roomId) {
        this.efeRecordIds[roomName] = roomId;
        this.savingRooms[roomName] = false;

        if (roomIndex >= 0) {
          this.roomTemplates[roomIndex].isSaving = false;
          this.roomTemplates[roomIndex].efeId = roomId;
        }

        this.changeDetectorRef.detectChanges();

        // Navigate to room detail page
        this.router.navigate(['room', roomName], { relativeTo: this.route });
      } else {
        throw new Error('No room ID returned from creation');
      }
    } catch (error) {
      console.error('Error creating room:', error);

      // Revert optimistic UI
      this.selectedRooms[roomName] = false;
      delete this.efeRecordIds[roomName];
      this.savingRooms[roomName] = false;

      if (roomIndex >= 0) {
        this.roomTemplates[roomIndex].isSelected = false;
        this.roomTemplates[roomIndex].isSaving = false;
      }

      this.changeDetectorRef.detectChanges();
      await this.showToast(`Failed to create room "${roomName}"`, 'danger');
    }
  }

  async renameRoom(oldRoomName: string, event: Event) {
    // CRITICAL: Stop all event propagation to prevent checkbox toggle
    if (event) {
      event.stopPropagation();
      event.stopImmediatePropagation();
      event.preventDefault();
    }

    console.log('[Rename Room] Starting rename for:', oldRoomName);

    // CRITICAL: Set flag to block checkbox toggles during rename
    this.renamingRooms[oldRoomName] = true;
    console.log('[Rename Room] Set renamingRooms flag for:', oldRoomName);

    // DETACH change detection to prevent checkbox from firing during rename
    this.changeDetectorRef.detach();
    console.log('[Rename Room] Detached change detection');

    const alert = await this.alertController.create({
      header: 'Rename Room',
      cssClass: 'custom-other-alert',
      inputs: [
        {
          name: 'newRoomName',
          type: 'text',
          placeholder: 'Enter custom value...',
          value: oldRoomName
        }
      ],
      buttons: [
        {
          text: 'CANCEL',
          role: 'cancel'
        },
        {
          text: 'SAVE',
          handler: async (data) => {
            const newRoomName = data.newRoomName?.trim();

            if (!newRoomName) {
              await this.showToast('Room name cannot be empty', 'warning');
              return false;
            }

            if (newRoomName === oldRoomName) {
              return true; // No change needed
            }

            // Check if new name already exists
            const existingRoom = this.roomTemplates.find(r => r.RoomName === newRoomName);
            if (existingRoom) {
              await this.showToast('A room with this name already exists', 'warning');
              return false;
            }

            const roomIndex = this.roomTemplates.findIndex(r => r.RoomName === oldRoomName);
            const roomId = this.efeRecordIds[oldRoomName];
            const roomIdStr = String(roomId || ''); // Convert to string for .startsWith() check

            // CRITICAL: Verify this room belongs to the current service
            if (!roomId || roomId === '__pending__' || roomIdStr.startsWith('temp_')) {
              await this.showToast('Cannot rename room: Room not yet saved to database', 'warning');
              return false;
            }

            // Double-check we have the right room by loading it from database
            try {
              console.log('[Rename Room] Verifying room belongs to current service...');
              const existingRooms = await this.foundationData.getEFEByService(this.serviceId, true);
              const roomToRename = existingRooms.find(r => r.EFEID === roomId);

              if (!roomToRename) {
                console.error('[Rename Room] Room not found in current service!');
                console.error('[Rename Room] Looking for EFEID:', roomId, 'in service:', this.serviceId);
                await this.showToast('Error: Room does not belong to this service', 'danger');
                return false;
              }

              if (roomToRename.RoomName !== oldRoomName) {
                console.warn('[Rename Room] Room name mismatch in database');
                console.warn('[Rename Room] Expected:', oldRoomName, 'Got:', roomToRename.RoomName);
              }

              console.log('[Rename Room] Verified room:', roomToRename.RoomName, 'EFEID:', roomToRename.EFEID, 'ServiceID:', roomToRename.ServiceID);

              // Update database using the verified EFEID
              console.log('[Rename Room] Updating database for room:', oldRoomName, 'to:', newRoomName);
              const updateData = { RoomName: newRoomName };
              // Use updateServicesEFEByEFEID which uses EFEID in the where clause (not PK_ID)
              await this.caspioService.updateServicesEFEByEFEID(roomId, updateData).toPromise();
              console.log('[Rename Room] Database update successful for EFEID:', roomId);
            } catch (error) {
              console.error('[Rename Room] Database update FAILED:', error);
              await this.showToast('Failed to update room name in database', 'danger');
              return false;
            }

            // ATOMIC UPDATE: Create all new dictionary entries FIRST, then delete old ones
            // This ensures there's never a moment where the room appears unselected
            console.log('[Rename Room] Updating all local state dictionaries atomically...');

            // CRITICAL: Set rename flag for new name too to block any checkbox events
            this.renamingRooms[newRoomName] = true;

            // Step 1: ADD new entries (don't delete old ones yet)
            if (this.efeRecordIds[oldRoomName]) {
              this.efeRecordIds[newRoomName] = this.efeRecordIds[oldRoomName];
            }
            if (this.selectedRooms[oldRoomName]) {
              this.selectedRooms[newRoomName] = this.selectedRooms[oldRoomName];
            }
            if (this.savingRooms[oldRoomName]) {
              this.savingRooms[newRoomName] = this.savingRooms[oldRoomName];
            }
            if (this.roomElevationData[oldRoomName]) {
              this.roomElevationData[newRoomName] = this.roomElevationData[oldRoomName];
            }

            console.log('[Rename Room] Created new entries. selectedRooms:', Object.keys(this.selectedRooms));

            // Step 2: UPDATE the roomTemplates array (this is what Angular watches)
            if (roomIndex >= 0) {
              // Create a NEW object reference to force Angular to recognize the change
              this.roomTemplates[roomIndex] = {
                ...this.roomTemplates[roomIndex],
                RoomName: newRoomName
              };
              console.log('[Rename Room] Updated roomTemplates array with new object reference');
            }

            // Step 3: NOW delete old entries (while change detection is still detached)
            setTimeout(() => {
              delete this.efeRecordIds[oldRoomName];
              delete this.selectedRooms[oldRoomName];
              delete this.savingRooms[oldRoomName];
              delete this.roomElevationData[oldRoomName];
              console.log('[Rename Room] Deleted old entries after timeout');
            }, 100);

            // Clear rename flag for both old and new names (be extra safe)
            delete this.renamingRooms[oldRoomName];
            delete this.renamingRooms[newRoomName];

            // Step 4: Re-attach change detection and force update
            this.changeDetectorRef.reattach();
            this.changeDetectorRef.detectChanges();
            console.log('[Rename Room] Re-attached change detection and updated UI');

            // Toast removed per user request
            return true;
          }
        }
      ]
    });

    await alert.present();
    const result = await alert.onDidDismiss();

    // CRITICAL: Clear rename flags and re-attach change detection after alert dismissed
    // Clear flag for old name and potentially new name (in case user typed something before cancelling)
    const allRoomNames = Object.keys(this.renamingRooms);
    allRoomNames.forEach(name => delete this.renamingRooms[name]);
    console.log('[Rename Room] Cleared all renamingRooms flags:', allRoomNames);

    // Re-attach change detection if it was detached (in case user cancelled)
    try {
      this.changeDetectorRef.reattach();
      this.changeDetectorRef.detectChanges();
      console.log('[Rename Room] Re-attached change detection after alert dismissed');
    } catch (e) {
      // Already attached, that's fine
      console.log('[Rename Room] Change detection already attached');
    }
  }

  async moveRoomUp(roomName: string, event: Event) {
    if (event) {
      event.stopPropagation();
      event.stopImmediatePropagation();
      event.preventDefault();
    }

    const currentIndex = this.roomTemplates.findIndex(r => r.RoomName === roomName);
    if (currentIndex > 0) {
      // Swap with the room above
      const temp = this.roomTemplates[currentIndex];
      this.roomTemplates[currentIndex] = this.roomTemplates[currentIndex - 1];
      this.roomTemplates[currentIndex - 1] = temp;
      this.changeDetectorRef.detectChanges();
    }
  }

  async moveRoomDown(roomName: string, event: Event) {
    if (event) {
      event.stopPropagation();
      event.stopImmediatePropagation();
      event.preventDefault();
    }

    const currentIndex = this.roomTemplates.findIndex(r => r.RoomName === roomName);
    if (currentIndex >= 0 && currentIndex < this.roomTemplates.length - 1) {
      // Swap with the room below
      const temp = this.roomTemplates[currentIndex];
      this.roomTemplates[currentIndex] = this.roomTemplates[currentIndex + 1];
      this.roomTemplates[currentIndex + 1] = temp;
      this.changeDetectorRef.detectChanges();
    }
  }

  async deleteRoom(roomName: string, event: Event) {
    if (event) {
      event.stopPropagation();
      event.stopImmediatePropagation();
      event.preventDefault();
    }

    const confirmAlert = await this.alertController.create({
      header: 'Confirm Delete',
      message: `Are you sure you want to delete "${roomName}"? This will delete all photos and data for this room.`,
      cssClass: 'custom-document-alert',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Delete',
          cssClass: 'alert-button-danger',
          handler: () => {
            // Return false to prevent auto-dismiss, then handle deletion and manual dismiss
            this.removeRoom(roomName).then(() => {
              confirmAlert.dismiss();
            }).catch(() => {
              confirmAlert.dismiss();
            });
            return false; // Prevent auto-dismiss
          }
        }
      ]
    });

    await confirmAlert.present();
  }

  private async removeRoom(roomName: string) {
    console.log('[ElevationPlotHub] removeRoom called for:', roomName);
    this.savingRooms[roomName] = true;
    const roomId = this.efeRecordIds[roomName];
    const roomIdStr = String(roomId || ''); // Convert to string for .startsWith() check
    console.log('[ElevationPlotHub] EFEID:', roomId);

    if (roomId && roomId !== '__pending__' && !roomIdStr.startsWith('temp_')) {
      try {
        console.log('[ElevationPlotHub] Deleting room from database...');
        // Delete the room from Services_EFE table using EFEID
        await this.caspioService.deleteServicesEFEByEFEID(roomId).toPromise();
        console.log('[ElevationPlotHub] Room deleted from database successfully');

        // Update local state - mark as unselected
        delete this.efeRecordIds[roomName];
        this.selectedRooms[roomName] = false;

        // Update room display data to show as unselected
        const roomIndex = this.roomTemplates.findIndex(r => r.RoomName === roomName);
        if (roomIndex >= 0) {
          this.roomTemplates[roomIndex].isSelected = false;
          this.roomTemplates[roomIndex].isSaving = false;
          this.roomTemplates[roomIndex].efeId = undefined;
          console.log('[ElevationPlotHub] Marked room as unselected in UI');
        }

        // Clear room elevation data (reset to template defaults)
        if (this.roomElevationData[roomName]) {
          if (this.roomElevationData[roomName].elevationPoints) {
            this.roomElevationData[roomName].elevationPoints.forEach((point: any) => {
              point.photos = [];
              point.photoCount = 0;
            });
          }
          this.roomElevationData[roomName].fdf = '';
          this.roomElevationData[roomName].notes = '';
          this.roomElevationData[roomName].location = '';
          this.roomElevationData[roomName].fdfPhotos = {};
        }

        console.log('[ElevationPlotHub] Local state updated');
        // Toast removed per user request
      } catch (error) {
        console.error('[ElevationPlotHub] Error deleting room:', error);
        await this.showToast('Failed to delete room', 'danger');
        throw error; // Re-throw to trigger the catch in the handler
      }
    } else {
      console.warn('[ElevationPlotHub] Room ID not valid for deletion:', { roomId, roomName });
    }

    this.savingRooms[roomName] = false;
    this.changeDetectorRef.detectChanges();
    console.log('[ElevationPlotHub] removeRoom completed');
  }

  isBaseStation(roomName: string): boolean {
    return roomName.toLowerCase() === 'base station';
  }

  private async loadRoomTemplates() {
    try {
      const allTemplates = await this.foundationData.getEFETemplates();

      if (allTemplates && allTemplates.length > 0) {
        this.allRoomTemplates = allTemplates.map((template: any) => ({ ...template }));

        // Filter templates where Auto = 'Yes'
        const autoTemplates = allTemplates.filter((template: any) =>
          template.Auto === 'Yes' || template.Auto === true || template.Auto === 1
        );

        // Initialize room elevation data for each template
        autoTemplates.forEach((template: any) => {
          if (template.RoomName && !this.roomElevationData[template.RoomName]) {
            const elevationPoints: any[] = [];

            // Extract elevation points from Point1Name, Point2Name, etc.
            for (let i = 1; i <= 20; i++) {
              const pointColumnName = `Point${i}Name`;
              const pointName = template[pointColumnName];

              if (pointName && pointName.trim() !== '') {
                elevationPoints.push({
                  pointNumber: i,
                  name: pointName,
                  value: '',
                  photo: null,
                  photos: [],
                  photoCount: 0
                });
              }
            }

            this.roomElevationData[template.RoomName] = {
              roomName: template.RoomName,
              templateId: template.TemplateID || template.PK_ID,
              elevationPoints: elevationPoints,
              pointCount: template.PointCount || elevationPoints.length,
              notes: '',
              fdf: '',
              location: '',
              fdfPhotos: {}
            };
          }
        });

        // Load existing rooms from database
        if (this.serviceId) {
          const existingRooms = await this.foundationData.getEFEByService(this.serviceId, true);

          // Build room templates list
          const roomsToDisplay: RoomTemplate[] = [...autoTemplates];

          if (existingRooms && existingRooms.length > 0) {
            for (const room of existingRooms) {
              const roomName = room.RoomName;
              // Use EFEID field, NOT PK_ID - EFEID is what links to Services_EFE_Points
              const roomId = room.EFEID;
              const templateId = room.TemplateID;

              // Find matching template
              const templateIdNum = typeof templateId === 'string' ? parseInt(templateId, 10) : templateId;
              let template = null;

              if (templateId) {
                template = this.allRoomTemplates.find((t: any) =>
                  t.TemplateID == templateIdNum || t.PK_ID == templateIdNum
                );
              }

              if (!template) {
                template = autoTemplates.find((t: any) => t.RoomName === roomName);
              }

              if (template) {
                // If room was renamed, replace at original index to preserve order
                if (template.RoomName !== roomName) {
                  const originalIndex = roomsToDisplay.findIndex((t: any) =>
                    (t.TemplateID == templateIdNum || t.PK_ID == templateIdNum) && t.RoomName === template.RoomName
                  );
                  if (originalIndex >= 0) {
                    // Replace at the same index to preserve order
                    roomsToDisplay[originalIndex] = { ...template, RoomName: roomName };
                  } else {
                    // Original not found, check if renamed room already exists
                    const existingRoomIndex = roomsToDisplay.findIndex((t: any) => t.RoomName === roomName);
                    if (existingRoomIndex < 0) {
                      roomsToDisplay.push({ ...template, RoomName: roomName });
                    }
                  }
                } else {
                  // Room not renamed, just ensure it's in the list
                  const existingRoomIndex = roomsToDisplay.findIndex((t: any) => t.RoomName === roomName);
                  if (existingRoomIndex < 0) {
                    roomsToDisplay.push({ ...template, RoomName: roomName });
                  }
                }
              }

              // Mark room as selected
              if (roomName && roomId) {
                this.selectedRooms[roomName] = true;
                this.efeRecordIds[roomName] = roomId;

                // Initialize room elevation data if not present
                if (!this.roomElevationData[roomName] && template) {
                  const elevationPoints: any[] = [];

                  for (let i = 1; i <= 20; i++) {
                    const pointColumnName = `Point${i}Name`;
                    const pointName = template[pointColumnName];

                    if (pointName && pointName.trim() !== '') {
                      elevationPoints.push({
                        pointNumber: i,
                        name: pointName,
                        value: '',
                        photo: null,
                        photos: [],
                        photoCount: 0
                      });
                    }
                  }

                  this.roomElevationData[roomName] = {
                    roomName: roomName,
                    templateId: template.TemplateID || template.PK_ID,
                    elevationPoints: elevationPoints,
                    pointCount: template.PointCount || elevationPoints.length,
                    notes: room.Notes || '',
                    fdf: room.FDF || '',
                    location: room.Location || '',
                    fdfPhotos: {}
                  };
                }
              }
            }
          }

          // Convert to display format
          this.roomTemplates = roomsToDisplay.map(template => ({
            ...template,
            isSelected: !!this.selectedRooms[template.RoomName],
            isSaving: !!this.savingRooms[template.RoomName],
            efeId: this.efeRecordIds[template.RoomName]
          }));
        } else {
          // No service ID, just show auto templates as unselected
          this.roomTemplates = autoTemplates.map(template => ({
            ...template,
            isSelected: false,
            isSaving: false
          }));
        }
      }

      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('Error loading room templates:', error);
      await this.showToast('Failed to load room templates', 'danger');
    } finally {
      this.loading = false;
      this.changeDetectorRef.detectChanges();
    }
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
}
