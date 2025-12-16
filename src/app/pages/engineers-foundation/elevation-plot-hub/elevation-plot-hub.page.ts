import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { AlertController, ToastController, ActionSheetController } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { EngineersFoundationStateService } from '../services/engineers-foundation-state.service';
import { EngineersFoundationDataService } from '../engineers-foundation-data.service';
import { CaspioService } from '../../../services/caspio.service';
import { OperationsQueueService } from '../../../services/operations-queue.service';
import { BackgroundSyncService } from '../../../services/background-sync.service';

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
export class ElevationPlotHubPage implements OnInit, OnDestroy {
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

  // Subscriptions for offline sync events
  private roomSyncSubscription?: Subscription;
  private cacheInvalidationSubscription?: Subscription;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private stateService: EngineersFoundationStateService,
    private foundationData: EngineersFoundationDataService,
    private caspioService: CaspioService,
    private alertController: AlertController,
    private toastController: ToastController,
    private actionSheetController: ActionSheetController,
    private changeDetectorRef: ChangeDetectorRef,
    public operationsQueue: OperationsQueueService,
    private backgroundSync: BackgroundSyncService
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
      // Toast removed per user request
      // await this.showToast(`Error: Missing service or project ID. ServiceID: ${this.serviceId}, ProjectID: ${this.projectId}`, 'danger');
      return;
    }

    // Subscribe to EFE room sync completions (for offline-first support)
    this.subscribeToSyncEvents();

    await this.loadRoomTemplates();
  }

  /**
   * Subscribe to background sync events to update UI when offline rooms sync
   */
  private subscribeToSyncEvents(): void {
    this.roomSyncSubscription = this.backgroundSync.efeRoomSyncComplete$.subscribe(event => {
      console.log('[ElevationPlotHub] Room sync complete event:', event);

      // Find the room with the temp ID and update with real ID
      const roomName = Object.keys(this.efeRecordIds).find(
        name => this.efeRecordIds[name] === event.tempId
      );

      if (roomName) {
        console.log('[ElevationPlotHub] Updating room', roomName, 'with real ID:', event.realId);

        // Update with real ID
        this.efeRecordIds[roomName] = String(event.realId);
        this.savingRooms[roomName] = false;

        // Update in roomTemplates array
        const roomIndex = this.roomTemplates.findIndex(r => r.RoomName === roomName);
        if (roomIndex >= 0) {
          this.roomTemplates[roomIndex].isSaving = false;
          this.roomTemplates[roomIndex].efeId = String(event.realId);
        }

        this.changeDetectorRef.detectChanges();
      }
    });

    // Subscribe to cache invalidation to reload rooms when data syncs
    this.cacheInvalidationSubscription = this.foundationData.cacheInvalidated$.subscribe(event => {
      if (!event.serviceId || event.serviceId === this.serviceId) {
        console.log('[ElevationPlotHub] Cache invalidated, reloading room list...');
        this.reloadRoomsAfterSync();
      }
    });
  }

  /**
   * Reload rooms after sync to update with real IDs and latest data
   */
  private async reloadRoomsAfterSync(): Promise<void> {
    try {
      console.log('[ElevationPlotHub] Reloading rooms after sync...');
      
      // Get fresh EFE rooms from IndexedDB (already updated by BackgroundSyncService)
      const existingRooms = await this.foundationData.getEFERooms(this.serviceId);
      console.log('[ElevationPlotHub] Got', existingRooms?.length || 0, 'rooms from IndexedDB');
      
      // Update our room data with fresh server data
      if (existingRooms) {
        for (const serverRoom of existingRooms) {
          const roomName = serverRoom.RoomName;
          const realId = serverRoom.EFEID || serverRoom.PK_ID;
          
          // Update efeRecordIds map
          this.efeRecordIds[roomName] = String(realId);
          this.selectedRooms[roomName] = true;
          this.savingRooms[roomName] = false;
          
          // Update roomTemplates array
          const roomTemplate = this.roomTemplates.find(r => r.RoomName === roomName);
          if (roomTemplate) {
            roomTemplate.isSelected = true;
            roomTemplate.isSaving = false;
            roomTemplate.efeId = String(realId);
          }
        }
      }
      
      this.changeDetectorRef.detectChanges();
      console.log('[ElevationPlotHub] Room reload complete');
      
    } catch (error) {
      console.error('[ElevationPlotHub] Error reloading rooms:', error);
    }
  }

  ngOnDestroy(): void {
    if (this.roomSyncSubscription) {
      this.roomSyncSubscription.unsubscribe();
    }
    if (this.cacheInvalidationSubscription) {
      this.cacheInvalidationSubscription.unsubscribe();
    }
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

    // Set Organization to be at the end of the list
    const nextOrganization = this.getNextOrganizationNumber();
    roomData.Organization = nextOrganization;
    console.log('[Create Room] Setting Organization to:', nextOrganization);

    // Update room display data
    const roomIndex = this.roomTemplates.findIndex(r => r.RoomName === roomName);

    try {
      // OFFLINE-FIRST: Use foundationData.createEFERoom() which handles IndexedDB queuing
      const response = await this.foundationData.createEFERoom(roomData);
      // Response may contain temp ID (temp_efe_xxx) or real EFEID
      const roomId = response?.EFEID || response?._tempId || response?.PK_ID;

      console.log('[Create Room] Room created with ID:', roomId, response._tempId ? '(temp)' : '(real)');

      // Update local state
      this.selectedRooms[roomName] = true;
      this.efeRecordIds[roomName] = roomId;
      this.savingRooms[roomName] = !!response._syncing; // True if pending sync

      if (roomIndex >= 0) {
        this.roomTemplates[roomIndex].isSelected = true;
        this.roomTemplates[roomIndex].isSaving = !!response._syncing;
        this.roomTemplates[roomIndex].efeId = roomId;
      }

      this.changeDetectorRef.detectChanges();

      // Navigate to room detail page (works with temp ID too)
      this.router.navigate(['room', roomName], { relativeTo: this.route });
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
              // Toast removed per user request
              // await this.showToast('Room name cannot be empty', 'warning');
              return false;
            }

            if (newRoomName === oldRoomName) {
              return true; // No change needed
            }

            // Check if new name already exists
            const existingRoom = this.roomTemplates.find(r => r.RoomName === newRoomName);
            if (existingRoom) {
              // Toast removed per user request
              // await this.showToast('A room with this name already exists', 'warning');
              return false;
            }

            const roomIndex = this.roomTemplates.findIndex(r => r.RoomName === oldRoomName);
            const roomId = this.efeRecordIds[oldRoomName];
            const roomIdStr = String(roomId || ''); // Convert to string for .startsWith() check

            // CRITICAL: Verify this room belongs to the current service
            if (!roomId || roomId === '__pending__' || roomIdStr.startsWith('temp_')) {
              // Toast removed per user request
              // await this.showToast('Cannot rename room: Room not yet saved to database', 'warning');
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
                // Toast removed per user request
                // await this.showToast('Error: Room does not belong to this service', 'danger');
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
              // Toast removed per user request
              // await this.showToast('Failed to update room name in database', 'danger');
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


  async duplicateRoom(roomName: string, event: Event) {
    if (event) {
      event.stopPropagation();
      event.stopImmediatePropagation();
      event.preventDefault();
    }

    console.log('[Duplicate Room] Starting duplication for:', roomName);

    // Find the room template to duplicate
    const roomToDuplicate = this.roomTemplates.find(r => r.RoomName === roomName);
    if (!roomToDuplicate) {
      console.error('[Duplicate Room] Room not found:', roomName);
      // Toast removed per user request
      // await this.showToast('Room not found', 'danger');
      return;
    }

    // Generate a unique name with incremented number
    const newRoomName = this.generateUniqueDuplicateName(roomName);
    console.log('[Duplicate Room] Generated new name:', newRoomName);

    // Validate ServiceID
    const serviceIdNum = parseInt(this.serviceId, 10);
    if (!this.serviceId || isNaN(serviceIdNum)) {
      console.error('[Duplicate Room] ERROR: Invalid ServiceID!');
      // Toast removed per user request
      // await this.showToast('Error: Invalid ServiceID', 'danger');
      return;
    }

    try {
      // Get the template for this room
      let templateId = roomToDuplicate.TemplateID || roomToDuplicate.PK_ID;
      
      // If no templateId from room, try to get it from roomElevationData
      if (!templateId && this.roomElevationData[roomName]) {
        templateId = this.roomElevationData[roomName].templateId;
      }

      // Create room elevation data for the new room (copy from original)
      if (this.roomElevationData[roomName]) {
        const originalData = this.roomElevationData[roomName];
        this.roomElevationData[newRoomName] = {
          roomName: newRoomName,
          templateId: originalData.templateId,
          elevationPoints: originalData.elevationPoints.map((point: any) => ({
            pointNumber: point.pointNumber,
            name: point.name,
            value: '',
            photo: null,
            photos: [],
            photoCount: 0
          })),
          pointCount: originalData.pointCount,
          notes: '',
          fdf: '',
          location: '',
          fdfPhotos: {}
        };
      }

      // Get the organization number of the original room and set duplicate to be right after it
      const originalRoomOrg = roomToDuplicate['Organization'] || 0;
      const newOrganization = this.getInsertAfterOrganizationNumber(originalRoomOrg);
      
      // Create the new room in database
      const roomData: any = {
        ServiceID: serviceIdNum,
        RoomName: newRoomName,
        Organization: newOrganization
      };

      if (templateId) {
        roomData.TemplateID = templateId;
      }

      console.log('[Duplicate Room] Creating room in database:', roomData);
      console.log('[Duplicate Room] Original Organization:', originalRoomOrg, '→ New Organization:', newOrganization);

      // OPTIMISTIC UI: Add the new room to the list immediately right after the original
      const newRoom: RoomDisplayData = {
        ...roomToDuplicate,
        RoomName: newRoomName,
        Organization: newOrganization,
        isSelected: true,
        isSaving: true
      };
      
      // Find the index of the original room and insert the duplicate right after it
      const originalRoomIndex = this.roomTemplates.findIndex(r => r.RoomName === roomName);
      if (originalRoomIndex >= 0) {
        this.roomTemplates.splice(originalRoomIndex + 1, 0, newRoom);
      } else {
        // Fallback: add to end if original not found
        this.roomTemplates.push(newRoom);
      }
      
      this.selectedRooms[newRoomName] = true;
      this.efeRecordIds[newRoomName] = `temp_${Date.now()}`;
      this.savingRooms[newRoomName] = true;
      this.changeDetectorRef.detectChanges();

      // Create room in database
      const response = await this.caspioService.createServicesEFE(roomData).toPromise();
      const roomId = response?.EFEID || response?.PK_ID || response?.id;

      if (roomId) {
        // Update with real ID
        this.efeRecordIds[newRoomName] = roomId;
        this.savingRooms[newRoomName] = false;

        const roomIndex = this.roomTemplates.findIndex(r => r.RoomName === newRoomName);
        if (roomIndex >= 0) {
          this.roomTemplates[roomIndex].isSaving = false;
          this.roomTemplates[roomIndex].efeId = roomId;
        }

        this.changeDetectorRef.detectChanges();
        // Toast removed per user request
        // await this.showToast(`Room "${newRoomName}" created successfully`, 'success');
        console.log('[Duplicate Room] Room duplicated successfully:', newRoomName, 'EFEID:', roomId);
      } else {
        throw new Error('No room ID returned from creation');
      }
    } catch (error) {
      console.error('[Duplicate Room] Error duplicating room:', error);

      // Revert optimistic UI
      this.selectedRooms[newRoomName] = false;
      delete this.efeRecordIds[newRoomName];
      this.savingRooms[newRoomName] = false;
      delete this.roomElevationData[newRoomName];

      // Remove from roomTemplates list
      const roomIndex = this.roomTemplates.findIndex(r => r.RoomName === newRoomName);
      if (roomIndex >= 0) {
        this.roomTemplates.splice(roomIndex, 1);
      }

      this.changeDetectorRef.detectChanges();
      // Toast removed per user request
      // await this.showToast(`Failed to duplicate room "${roomName}"`, 'danger');
    }
  }

  /**
   * Generate a unique name for duplicated room with incremented number
   * Examples:
   *   "Bedroom" -> "Bedroom #2"
   *   "Bedroom #2" -> "Bedroom #3"
   *   "Living Room" -> "Living Room #2"
   */
  private generateUniqueDuplicateName(originalName: string): string {
    // Extract base name and current number if exists
    const numberMatch = originalName.match(/^(.+?)\s*#(\d+)$/);
    let baseName: string;
    let startNumber: number;

    if (numberMatch) {
      // Already has a number, e.g., "Bedroom #2"
      baseName = numberMatch[1].trim();
      startNumber = parseInt(numberMatch[2], 10) + 1;
    } else {
      // No number yet, e.g., "Bedroom"
      baseName = originalName.trim();
      startNumber = 2;
    }

    // Find the highest number used for this base name
    let maxNumber = startNumber - 1;
    for (const room of this.roomTemplates) {
      const roomNumberMatch = room.RoomName.match(new RegExp(`^${this.escapeRegex(baseName)}\\s*#(\\d+)$`));
      if (roomNumberMatch) {
        const num = parseInt(roomNumberMatch[1], 10);
        if (num > maxNumber) {
          maxNumber = num;
        }
      }
    }

    // Generate new unique name
    let newNumber = maxNumber + 1;
    let newName = `${baseName} #${newNumber}`;

    // Ensure the name is truly unique (shouldn't happen, but safety check)
    while (this.roomTemplates.some(r => r.RoomName === newName)) {
      newNumber++;
      newName = `${baseName} #${newNumber}`;
    }

    return newName;
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get the next available organization number (for adding new rooms at the end)
   */
  private getNextOrganizationNumber(): number {
    let maxOrg = 0;
    
    // Find the highest organization number currently in use
    for (const room of this.roomTemplates) {
      const org = room['Organization'] || 0;
      if (org > maxOrg) {
        maxOrg = org;
      }
    }
    
    // Return next number
    return maxOrg + 1;
  }

  /**
   * Get the organization number for inserting a room right after a specific organization
   * This shifts all subsequent rooms' organization numbers up by 1
   */
  private getInsertAfterOrganizationNumber(afterOrganization: number): number {
    const newOrg = afterOrganization + 1;
    
    // Shift all rooms with organization >= newOrg up by 1
    // This happens in-memory for immediate UI update
    for (const room of this.roomTemplates) {
      if (room['Organization'] && room['Organization'] >= newOrg) {
        const oldOrg = room['Organization'];
        room['Organization'] = room['Organization'] + 1;
        
        // Update in database
        const roomId = this.efeRecordIds[room.RoomName];
        if (roomId && !String(roomId).startsWith('temp_')) {
          this.caspioService.updateServicesEFEByEFEID(roomId, { Organization: room['Organization'] })
            .toPromise()
            .then(() => {
              console.log(`[Organization] Shifted room "${room.RoomName}" from ${oldOrg} to ${room['Organization']}`);
            })
            .catch(err => {
              console.error(`[Organization] Failed to shift room "${room.RoomName}":`, err);
            });
        }
      }
    }
    
    return newOrg;
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
        },
        {
          text: 'Cancel',
          role: 'cancel'
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
        // Toast removed per user request
        // await this.showToast('Failed to delete room', 'danger');
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
    // Check for "Base Station" and duplicates like "Base Station #2", "Base Station #3", etc.
    return roomName.toLowerCase().startsWith('base station');
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
                // Check if this is a duplicated room (has " #N" pattern) or a renamed room
                const isDuplicate = /\s+#\d+$/.test(roomName);
                
                if (template.RoomName !== roomName) {
                  if (isDuplicate) {
                    // This is a duplicated room - ADD it to the list, don't replace the original
                    const existingRoomIndex = roomsToDisplay.findIndex((t: any) => t.RoomName === roomName);
                    if (existingRoomIndex < 0) {
                      // Add duplicate room to the list with Organization from database
                      roomsToDisplay.push({ ...template, RoomName: roomName, Organization: room.Organization });
                    }
                  } else {
                    // This is a renamed room - REPLACE the original template
                    const originalIndex = roomsToDisplay.findIndex((t: any) =>
                      (t.TemplateID == templateIdNum || t.PK_ID == templateIdNum) && t.RoomName === template.RoomName
                    );
                    if (originalIndex >= 0) {
                      // Replace at the same index to preserve order with Organization from database
                      roomsToDisplay[originalIndex] = { ...template, RoomName: roomName, Organization: room.Organization };
                    } else {
                      // Original not found, check if renamed room already exists
                      const existingRoomIndex = roomsToDisplay.findIndex((t: any) => t.RoomName === roomName);
                      if (existingRoomIndex < 0) {
                        roomsToDisplay.push({ ...template, RoomName: roomName, Organization: room.Organization });
                      }
                    }
                  }
                } else {
                  // Room not renamed or duplicated, just ensure it's in the list
                  const existingRoomIndex = roomsToDisplay.findIndex((t: any) => t.RoomName === roomName);
                  if (existingRoomIndex < 0) {
                    roomsToDisplay.push({ ...template, RoomName: roomName, Organization: room.Organization });
                  } else {
                    // Update Organization if room already exists in display list
                    roomsToDisplay[existingRoomIndex]['Organization'] = room.Organization;
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

          // Sort by Organization field (ascending)
          // Rooms without Organization go to the end
          this.roomTemplates.sort((a, b) => {
            const orgA = a['Organization'] !== undefined && a['Organization'] !== null ? a['Organization'] : 999999;
            const orgB = b['Organization'] !== undefined && b['Organization'] !== null ? b['Organization'] : 999999;
            return orgA - orgB;
          });
          
          console.log('[Load Rooms] Sorted rooms by Organization:', this.roomTemplates.map(r => ({ name: r.RoomName, org: r['Organization'] })));
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
      // Toast removed per user request
      // await this.showToast('Failed to load room templates', 'danger');
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

  /**
   * Show dialog to select a room template to add
   */
  async showAddRoomDialog() {
    try {
      // Show ALL room templates except Base Station variants, allowing duplicates
      const availableRooms = this.allRoomTemplates.filter(room =>
        room.RoomName !== 'Base Station' &&
        room.RoomName !== '2nd Base Station' &&
        room.RoomName !== '3rd Base Station'
      );
      
      if (availableRooms.length === 0) {
        // Toast removed per user request
        // await this.showToast('No room templates available', 'info');
        return;
      }
      
      // Create buttons for each available room
      const buttons = availableRooms.map(room => ({
        text: room.RoomName,
        handler: () => {
          this.addRoomTemplate(room);
        }
      }));
      
      // Add cancel button
      buttons.push({
        text: 'Cancel',
        handler: () => {
          // Do nothing
        }
      });
      
      const actionSheet = await this.actionSheetController.create({
        header: 'Select Room to Add',
        buttons: buttons,
        cssClass: 'room-selection-sheet'
      });
      
      await actionSheet.present();
    } catch (error) {
      console.error('[Add Room] Error showing room selection:', error);
      // Toast removed per user request
      // await this.showToast('Failed to show room selection', 'danger');
    }
  }

  /**
   * Add a room template to the list
   * Handles automatic numbering when adding duplicates
   */
  async addRoomTemplate(template: any) {
    try {
      console.log('[Add Room] Adding room template:', template.RoomName);
      
      // Get the base name from the original template (never modify the original)
      const baseName = template.RoomName;
      
      // Check existing rooms for this base name (both numbered and unnumbered)
      const existingWithBaseName = this.roomTemplates.filter(room => {
        // Extract base name by removing number suffix if present
        const roomBaseName = room.RoomName.replace(/ #\d+$/, '');
        return roomBaseName === baseName;
      });
      
      // Determine the room name with proper numbering
      let roomName = baseName;
      if (existingWithBaseName.length > 0) {
        // Find existing numbers
        const existingNumbers: number[] = [];
        existingWithBaseName.forEach(room => {
          if (room.RoomName === baseName) {
            existingNumbers.push(1); // Unnumbered room counts as #1
          } else {
            const match = room.RoomName.match(/ #(\d+)$/);
            if (match) {
              existingNumbers.push(parseInt(match[1]));
            }
          }
        });
        
        // Find the next available number
        let nextNumber = 1;
        while (existingNumbers.includes(nextNumber)) {
          nextNumber++;
        }
        
        // If this is the second occurrence, rename the first one
        if (existingWithBaseName.length === 1 && existingWithBaseName[0].RoomName === baseName) {
          console.log('[Add Room] Renaming first occurrence to #1');
          
          // Rename the existing unnumbered room to #1
          const existingRoom = existingWithBaseName[0];
          const oldName = existingRoom.RoomName;
          const newName = `${baseName} #1`;
          
          // Update in database first
          const roomId = this.efeRecordIds[oldName];
          if (roomId && !String(roomId).startsWith('temp_')) {
            try {
              await this.caspioService.updateServicesEFEByEFEID(roomId, { RoomName: newName }).toPromise();
              console.log('[Add Room] Updated room name in database:', oldName, '→', newName);
            } catch (error) {
              console.error('[Add Room] Failed to update room name in database:', error);
              // Toast removed per user request
              // await this.showToast('Failed to rename existing room', 'danger');
              return;
            }
          }
          
          // Update the room object
          existingRoom.RoomName = newName;

          // Update all related data structures
          if (this.roomElevationData[oldName]) {
            this.roomElevationData[newName] = this.roomElevationData[oldName];
            delete this.roomElevationData[oldName];
          }
          if (this.selectedRooms[oldName] !== undefined) {
            this.selectedRooms[newName] = this.selectedRooms[oldName];
            delete this.selectedRooms[oldName];
          }
          if (this.efeRecordIds[oldName]) {
            this.efeRecordIds[newName] = this.efeRecordIds[oldName];
            delete this.efeRecordIds[oldName];
          }
          if (this.savingRooms[oldName]) {
            this.savingRooms[newName] = this.savingRooms[oldName];
            delete this.savingRooms[oldName];
          }

          this.changeDetectorRef.detectChanges();
          nextNumber = 2; // The new room will be #2
        }
        
        roomName = `${baseName} #${nextNumber}`;
      }
      
      console.log('[Add Room] Final room name:', roomName);
      
      // Create room elevation data
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
      
      this.roomElevationData[roomName] = {
        roomName: roomName,
        templateId: template.TemplateID || template.PK_ID,
        elevationPoints: elevationPoints,
        pointCount: template.PointCount || elevationPoints.length,
        notes: '',
        fdf: '',
        location: '',
        fdfPhotos: {}
      };
      
      // Validate ServiceID
      const serviceIdNum = parseInt(this.serviceId, 10);
      if (!this.serviceId || isNaN(serviceIdNum)) {
        console.error('[Add Room] ERROR: Invalid ServiceID!');
        // Toast removed per user request
        // await this.showToast(`Error: Invalid ServiceID (${this.serviceId})`, 'danger');
        return;
      }

      // Prepare room data
      const roomData: any = {
        ServiceID: serviceIdNum,
        RoomName: roomName
      };

      // Include TemplateID to link back to template
      if (template.TemplateID || template.PK_ID) {
        roomData.TemplateID = template.TemplateID || template.PK_ID;
      }

      // Set Organization to be at the end of the list
      const nextOrganization = this.getNextOrganizationNumber();
      roomData.Organization = nextOrganization;
      console.log('[Add Room] Setting Organization to:', nextOrganization);

      // OPTIMISTIC UI: Create new room object and add to display list
      const newRoom: RoomDisplayData = {
        ...template,
        RoomName: roomName,
        Organization: nextOrganization,
        isSelected: true,
        isSaving: true
      };
      
      this.roomTemplates.push(newRoom);
      this.selectedRooms[roomName] = true;
      this.efeRecordIds[roomName] = `temp_${Date.now()}`;
      this.savingRooms[roomName] = true;
      this.changeDetectorRef.detectChanges();

      try {
        // Create room in database
        const response = await this.caspioService.createServicesEFE(roomData).toPromise();
        const roomId = response?.EFEID || response?.PK_ID || response?.id;

        if (roomId) {
          this.efeRecordIds[roomName] = roomId;
          this.savingRooms[roomName] = false;

          const roomIndex = this.roomTemplates.findIndex(r => r.RoomName === roomName);
          if (roomIndex >= 0) {
            this.roomTemplates[roomIndex].isSaving = false;
            this.roomTemplates[roomIndex].efeId = roomId;
          }

          this.changeDetectorRef.detectChanges();
          // Toast removed per user request
          console.log('[Add Room] Room created successfully:', roomName, 'EFEID:', roomId);
        } else {
          throw new Error('No room ID returned from creation');
        }
      } catch (error) {
        console.error('[Add Room] Error creating room:', error);

        // Revert optimistic UI
        this.selectedRooms[roomName] = false;
        delete this.efeRecordIds[roomName];
        this.savingRooms[roomName] = false;
        delete this.roomElevationData[roomName];

        // Remove from roomTemplates list
        const roomIndex = this.roomTemplates.findIndex(r => r.RoomName === roomName);
        if (roomIndex >= 0) {
          this.roomTemplates.splice(roomIndex, 1);
        }

        this.changeDetectorRef.detectChanges();
        // Toast removed per user request
        // await this.showToast(`Failed to create room "${roomName}"`, 'danger');
      }
    } catch (error) {
      console.error('[Add Room] Error in addRoomTemplate:', error);
      // Toast removed per user request
      // await this.showToast('Failed to add room', 'danger');
    }
  }
}
