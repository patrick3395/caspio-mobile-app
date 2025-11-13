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

  async renameRoom(roomName: string, event: Event) {
    if (event) {
      event.stopPropagation();
      event.stopImmediatePropagation();
      event.preventDefault();
    }

    // Prevent rename if room is being saved
    if (this.savingRooms[roomName]) {
      await this.showToast('Please wait for the room to finish saving', 'warning');
      return;
    }

    this.renamingRooms[roomName] = true;

    const alert = await this.alertController.create({
      header: 'Rename Room',
      message: `Enter a new name for "${roomName}":`,
      inputs: [
        {
          name: 'newName',
          type: 'text',
          value: roomName,
          placeholder: 'Room name'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          handler: () => {
            this.renamingRooms[roomName] = false;
          }
        },
        {
          text: 'Save',
          handler: async (data) => {
            const newName = data.newName.trim();
            if (!newName) {
              this.showToast('Room name cannot be empty', 'warning');
              this.renamingRooms[roomName] = false;
              return false;
            }

            if (newName === roomName) {
              this.renamingRooms[roomName] = false;
              return true;
            }

            // Check for duplicate names
            const existingRoom = this.roomTemplates.find(r => r.RoomName === newName);
            if (existingRoom) {
              await this.showToast('A room with this name already exists', 'warning');
              this.renamingRooms[roomName] = false;
              return false;
            }

            const roomId = this.efeRecordIds[roomName];

            if (!roomId || roomId === '__pending__' || roomId.startsWith('temp_')) {
              await this.showToast('Cannot rename room: Room not yet saved to database', 'warning');
              this.renamingRooms[roomName] = false;
              return false;
            }

            try {
              // Update in database
              await this.caspioService.updateServicesEFE(roomId, { RoomName: newName }).toPromise();

              // Update local state
              const roomIndex = this.roomTemplates.findIndex(r => r.RoomName === roomName);
              if (roomIndex >= 0) {
                this.roomTemplates[roomIndex].RoomName = newName;
              }

              // Transfer all data to new name
              this.selectedRooms[newName] = this.selectedRooms[roomName];
              this.efeRecordIds[newName] = this.efeRecordIds[roomName];
              this.roomElevationData[newName] = this.roomElevationData[roomName];

              // Delete old name entries
              delete this.selectedRooms[roomName];
              delete this.efeRecordIds[roomName];
              delete this.roomElevationData[roomName];

              this.renamingRooms[roomName] = false;
              this.changeDetectorRef.detectChanges();

              await this.showToast(`Room renamed to "${newName}"`, 'success');
              return true;
            } catch (error) {
              console.error('Error renaming room:', error);
              await this.showToast('Failed to rename room', 'danger');
              this.renamingRooms[roomName] = false;
              return false;
            }
          }
        }
      ],
      cssClass: 'custom-document-alert'
    });

    await alert.present();
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
    console.log('[ElevationPlotHub] Room ID:', roomId);

    if (roomId && roomId !== '__pending__' && !roomId.startsWith('temp_')) {
      try {
        console.log('[ElevationPlotHub] Deleting room from database...');
        // Delete the room from Services_EFE table
        await this.caspioService.deleteServicesEFE(roomId).toPromise();
        console.log('[ElevationPlotHub] Room deleted from database successfully');

        // Update local state
        delete this.efeRecordIds[roomName];
        this.selectedRooms[roomName] = false;

        // Update room display data
        const roomIndex = this.roomTemplates.findIndex(r => r.RoomName === roomName);
        if (roomIndex >= 0) {
          this.roomTemplates[roomIndex].isSelected = false;
          this.roomTemplates[roomIndex].efeId = undefined;
        }

        // Clear room elevation data
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
        }

        console.log('[ElevationPlotHub] Local state updated');
        await this.showToast(`Room "${roomName}" deleted`, 'success');
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
                // If room was renamed, remove original template and add renamed room
                if (template.RoomName !== roomName) {
                  const originalIndex = roomsToDisplay.findIndex((t: any) =>
                    (t.TemplateID == templateIdNum || t.PK_ID == templateIdNum) && t.RoomName === template.RoomName
                  );
                  if (originalIndex >= 0) {
                    roomsToDisplay.splice(originalIndex, 1);
                  }
                }

                const existingRoomIndex = roomsToDisplay.findIndex((t: any) => t.RoomName === roomName);
                if (existingRoomIndex < 0) {
                  roomsToDisplay.push({ ...template, RoomName: roomName });
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
