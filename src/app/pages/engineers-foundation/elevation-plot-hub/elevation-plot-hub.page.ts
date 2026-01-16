import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { AlertController, ToastController, ActionSheetController } from '@ionic/angular';
import { Subscription, filter } from 'rxjs';
import { EngineersFoundationStateService } from '../services/engineers-foundation-state.service';
import { EngineersFoundationDataService } from '../engineers-foundation-data.service';
import { CaspioService } from '../../../services/caspio.service';
import { OperationsQueueService } from '../../../services/operations-queue.service';
import { BackgroundSyncService } from '../../../services/background-sync.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { OfflineService } from '../../../services/offline.service';
import { IndexedDbService } from '../../../services/indexed-db.service';
import { SmartSyncService } from '../../../services/smart-sync.service';
import { EfeFieldRepoService } from '../../../services/efe-field-repo.service';
import { EfeField, EfePoint, db } from '../../../services/caspio-db';

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
export class ElevationPlotHubPage implements OnInit, OnDestroy, ViewWillEnter {
  // Debug flag - set to true for verbose logging
  private readonly DEBUG = false;
  
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
  private backgroundRefreshSubscription?: Subscription;
  private routerSubscription?: Subscription;
  private cacheInvalidationDebounceTimer: any = null;

  // Track if initial load is complete (for router-based reload detection)
  private initialLoadComplete: boolean = false;

  // Dexie-first: Reactive subscription to efeFields for instant page rendering
  private efeFieldsSubscription?: Subscription;
  private efeFieldsSeeded: boolean = false;

  // Track last navigated room for inserting new rooms after it
  private lastNavigatedRoom: string | null = null;
  
  // Standardized UI state flags
  isOnline: boolean = true;
  isEmpty: boolean = false;
  hasPendingSync: boolean = false;

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
    private backgroundSync: BackgroundSyncService,
    private offlineTemplate: OfflineTemplateService,
    private offlineService: OfflineService,
    private indexedDb: IndexedDbService,
    private smartSync: SmartSyncService,
    private efeFieldRepo: EfeFieldRepoService
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

    // Register with SmartSync for hourly refresh
    this.smartSync.registerActiveService(this.serviceId);

    // Update online status
    this.isOnline = this.offlineService.isOnline();

    // Subscribe to EFE room sync completions (for offline-first support)
    this.subscribeToSyncEvents();

    // Subscribe to router events to detect navigation back to this page
    // This is more reliable than ionViewWillEnter with standard Angular router
    this.subscribeToRouterEvents();

    // CRITICAL: Ensure EFE data is cached before loading room templates
    // This follows the standardized cache-first pattern
    await this.ensureEFEDataCached();

    // ===== DEXIE-FIRST: Initialize EFE fields and subscribe to reactive updates =====
    await this.initializeEfeFields();

    // Mark initial load as complete
    this.initialLoadComplete = true;
  }

  // ============================================================================
  // DEXIE-FIRST: REACTIVE DATA INITIALIZATION
  // ============================================================================

  /**
   * Initialize EFE fields for this service using Dexie-first architecture
   * 1. Seed templates into efeFields (if not already seeded)
   * 2. Merge existing rooms (user selections)
   * 3. Subscribe to reactive updates (liveQuery)
   */
  private async initializeEfeFields(): Promise<void> {
    console.time('[ElevationPlotHub] initializeEfeFields');
    console.log('[ElevationPlotHub] Initializing EFE fields (Dexie-first)...');

    // Unsubscribe from previous subscription if service changed
    if (this.efeFieldsSubscription) {
      this.efeFieldsSubscription.unsubscribe();
      this.efeFieldsSubscription = undefined;
    }

    // Check if fields exist for this service
    const hasFields = await this.efeFieldRepo.hasFieldsForService(this.serviceId);

    if (!hasFields) {
      console.log('[ElevationPlotHub] No fields found, seeding from templates...');

      // Get templates from cache
      const templates = await this.indexedDb.getCachedTemplates('efe') || [];

      if (templates.length === 0) {
        console.warn('[ElevationPlotHub] No templates in cache, falling back to loadRoomTemplates...');
        this.loading = true;
        this.changeDetectorRef.detectChanges();
        // Fall back to old loadRoomTemplates() for initial template fetch
        await this.loadRoomTemplates();
        console.timeEnd('[ElevationPlotHub] initializeEfeFields');
        return;
      }

      // Seed templates into efeFields
      await this.efeFieldRepo.seedFromTemplates(this.serviceId, templates);

      // Store all templates for later use (e.g., add room dialog)
      this.allRoomTemplates = templates.map((t: any) => ({ ...t }));

      // Get existing rooms and merge selections
      const existingRooms = await this.indexedDb.getCachedServiceData(this.serviceId, 'efe_rooms') || [];
      await this.efeFieldRepo.mergeExistingRooms(this.serviceId, existingRooms as any[]);

      console.log('[ElevationPlotHub] Seeding complete');
    } else {
      console.log('[ElevationPlotHub] Fields already exist, using cached data');
      // Still need to load templates for add room dialog
      const templates = await this.indexedDb.getCachedTemplates('efe') || [];
      this.allRoomTemplates = templates.map((t: any) => ({ ...t }));
    }

    // Subscribe to reactive updates - this will trigger UI render
    this.efeFieldsSubscription = this.efeFieldRepo
      .getFieldsForService$(this.serviceId)
      .subscribe({
        next: (fields) => {
          console.log(`[ElevationPlotHub] Received ${fields.length} fields from liveQuery`);
          this.convertFieldsToRoomTemplates(fields);
          this.loading = false;
          this.changeDetectorRef.detectChanges();
        },
        error: (err) => {
          console.error('[ElevationPlotHub] Error in efeFields subscription:', err);
          this.loading = false;
          this.changeDetectorRef.detectChanges();
        }
      });

    this.efeFieldsSeeded = true;
    console.timeEnd('[ElevationPlotHub] initializeEfeFields');
  }

  /**
   * Convert EfeField[] from Dexie to roomTemplates structure for rendering
   */
  private convertFieldsToRoomTemplates(fields: EfeField[]): void {
    // Reset dictionaries
    this.selectedRooms = {};
    this.efeRecordIds = {};

    // Sort by organization
    const sortedFields = [...fields].sort((a, b) => {
      const orgA = a.organization ?? 999999;
      const orgB = b.organization ?? 999999;
      return orgA - orgB;
    });

    // Convert to RoomDisplayData
    this.roomTemplates = sortedFields.map(field => {
      // Update dictionaries
      this.selectedRooms[field.roomName] = field.isSelected;
      if (field.efeId || field.tempEfeId) {
        this.efeRecordIds[field.roomName] = field.efeId || field.tempEfeId || '';
      }

      // Store elevation data for navigation
      if (!this.roomElevationData[field.roomName]) {
        this.roomElevationData[field.roomName] = {
          roomName: field.roomName,
          templateId: field.templateId,
          elevationPoints: field.elevationPoints.map(p => ({
            pointNumber: p.pointNumber,
            name: p.name,
            value: p.value,
            photo: null,
            photos: [],
            photoCount: p.photoCount
          })),
          pointCount: field.pointCount,
          notes: field.notes,
          fdf: field.fdf,
          location: field.location,
          fdfPhotos: field.fdfPhotos
        };
      }

      return {
        RoomName: field.roomName,
        TemplateID: field.templateId,
        PK_ID: field.templateId,
        PointCount: field.pointCount,
        Organization: field.organization,
        isSelected: field.isSelected,
        isSaving: !!this.savingRooms[field.roomName],
        efeId: field.efeId || field.tempEfeId || undefined
      } as RoomDisplayData;
    });

    // Update UI state flags
    this.isEmpty = this.roomTemplates.length === 0;

    console.log(`[ElevationPlotHub] Converted ${this.roomTemplates.length} room templates`);
  }

  /**
   * Ionic lifecycle hook - called every time the view is about to become active
   * DEXIE-FIRST: With reactive subscriptions, we don't need to reload on every view enter
   * The liveQuery subscription automatically updates the UI when data changes
   */
  async ionViewWillEnter() {
    // Update online status
    this.isOnline = this.offlineService.isOnline();

    // Only process if initial load is complete and we have required IDs
    if (!this.initialLoadComplete || !this.serviceId) {
      return;
    }

    const sectionKey = `${this.serviceId}_elevation`;
    const isDirty = this.backgroundSync.isSectionDirty(sectionKey);

    console.log(`[ElevationPlotHub] ionViewWillEnter - isDirty: ${isDirty}, efeFieldsSeeded: ${this.efeFieldsSeeded}`);

    // DEXIE-FIRST: If we have a reactive subscription, we don't need to reload
    // The liveQuery will automatically update the UI when Dexie data changes
    if (this.efeFieldsSeeded && this.efeFieldsSubscription) {
      // Only resync from cache if section is dirty (backend data changed)
      if (isDirty) {
        console.log('[ElevationPlotHub] Section dirty, merging new data from cache...');
        const existingRooms = await this.indexedDb.getCachedServiceData(this.serviceId, 'efe_rooms') || [];
        await this.efeFieldRepo.mergeExistingRooms(this.serviceId, existingRooms as any[]);
        this.backgroundSync.clearSectionDirty(sectionKey);
      }
      // CRITICAL: Ensure loading is false when returning with existing subscription
      // The liveQuery won't emit again if data hasn't changed, so we must clear loading here
      this.loading = false;
      this.changeDetectorRef.detectChanges();
      console.log('[ElevationPlotHub] Using reactive Dexie subscription - no reload needed');
      return;
    }

    // Fallback: If no subscription, initialize
    await this.initializeEfeFields();
    this.backgroundSync.clearSectionDirty(sectionKey);
  }
  
  /**
   * Subscribe to Angular router events to detect navigation
   * Uses smart skip logic to avoid redundant reloads
   */
  private subscribeToRouterEvents(): void {
    this.routerSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(async (event: NavigationEnd) => {
        // Check if we navigated back to this page (elevation hub)
        const isElevationHub = event.urlAfterRedirects.endsWith('/elevation') || 
                               event.urlAfterRedirects.includes('/elevation?');
        
        if (isElevationHub && this.initialLoadComplete && this.serviceId) {
          // Update online status
          this.isOnline = this.offlineService.isOnline();
          
          const sectionKey = `${this.serviceId}_elevation`;
          const hasDataInMemory = this.roomTemplates && this.roomTemplates.length > 0;
          const isDirty = this.backgroundSync.isSectionDirty(sectionKey);
          
          console.log(`[ElevationPlotHub] Router nav - hasData: ${hasDataInMemory}, isDirty: ${isDirty}`);
          
          // Only reload if data changed or not in memory
          if (!hasDataInMemory || isDirty) {
            console.log('[ElevationPlotHub] Router navigation - reloading rooms');
            await this.loadRoomTemplates();
            this.backgroundSync.clearSectionDirty(sectionKey);
          } else {
            console.log('[ElevationPlotHub] Router navigation - skipping reload');
            // CRITICAL: Ensure loading is false even when skipping reload
            this.loading = false;
            this.changeDetectorRef.detectChanges();
          }
        }
      });
  }

  /**
   * STANDARDIZED PATTERN: Ensure EFE data is cached before rendering
   * This prevents the "rooms not showing" issue on first load
   * 
   * 1. Verify EFE templates exist (room definitions)
   * 2. Verify EFE rooms for this service are cached
   * 3. If cache empty + online: fetch synchronously (blocking)
   */
  private async ensureEFEDataCached(): Promise<void> {
    if (!this.serviceId) return;

    console.log('[ElevationPlotHub] ensureEFEDataCached() - Verifying cache...');

    // Step 1: Ensure EFE templates (room definitions) are cached
    const efeTemplates = await this.indexedDb.getCachedTemplates('efe');
    if (!efeTemplates || efeTemplates.length === 0) {
      console.log('[ElevationPlotHub] EFE templates not cached, fetching...');
      await this.offlineTemplate.ensureEFETemplatesReady();
    } else {
      console.log(`[ElevationPlotHub] ✅ EFE templates already cached: ${efeTemplates.length}`);
    }

    // Step 2: Ensure EFE rooms for this service are cached
    // getEFERooms already implements the cache-first pattern with blocking fetch
    const efeRooms = await this.indexedDb.getCachedServiceData(this.serviceId, 'efe_rooms');
    if (!efeRooms || efeRooms.length === 0) {
      console.log('[ElevationPlotHub] EFE rooms not cached, will be fetched by loadRoomTemplates...');
      // Don't fetch here - let loadRoomTemplates handle it through getEFEByService
      // This avoids duplicate API calls
    } else {
      console.log(`[ElevationPlotHub] ✅ EFE rooms already cached: ${efeRooms.length}`);
    }

    // Step 3: Check for pending sync items
    const pendingRequests = await this.indexedDb.getPendingRequests();
    this.hasPendingSync = pendingRequests.some(r => 
      r.endpoint.includes('Services_EFE') && r.status === 'pending'
    );
    
    console.log('[ElevationPlotHub] ensureEFEDataCached() complete');
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
    // CRITICAL: Debounce to prevent multiple rapid reloads
    this.cacheInvalidationSubscription = this.foundationData.cacheInvalidated$.subscribe(event => {
      if (!event.serviceId || event.serviceId === this.serviceId) {
        // Clear any existing debounce timer
        if (this.cacheInvalidationDebounceTimer) {
          clearTimeout(this.cacheInvalidationDebounceTimer);
        }
        
        // Debounce: wait 500ms before reloading to batch multiple rapid events
        this.cacheInvalidationDebounceTimer = setTimeout(() => {
          console.log('[ElevationPlotHub] Cache invalidated (debounced), reloading room list...');
          this.reloadRoomsAfterSync();
        }, 500);
      }
    });

    // STANDARDIZED: Subscribe to background refresh completion
    // This ensures UI updates when data is refreshed in the background
    this.backgroundRefreshSubscription = this.offlineTemplate.backgroundRefreshComplete$.subscribe(event => {
      if (event.serviceId === this.serviceId && event.dataType === 'efe_rooms') {
        console.log('[ElevationPlotHub] Background refresh complete for EFE rooms, reloading...');
        // Debounce with same timer to prevent duplicate reloads
        if (this.cacheInvalidationDebounceTimer) {
          clearTimeout(this.cacheInvalidationDebounceTimer);
        }
        this.cacheInvalidationDebounceTimer = setTimeout(() => {
          this.reloadRoomsAfterSync();
        }, 500);
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
      const existingRooms = await this.foundationData.getEFEByService(this.serviceId, true);
      console.log('[ElevationPlotHub] Got', existingRooms?.length || 0, 'rooms from IndexedDB');

      // DEXIE-FIRST: Merge fresh server data into Dexie
      // The liveQuery subscription will automatically update the UI
      if (existingRooms && existingRooms.length > 0) {
        await this.efeFieldRepo.mergeExistingRooms(this.serviceId, existingRooms);
        console.log('[ElevationPlotHub] ✅ Merged rooms into Dexie efeFields');
      }

      // Also update local state for immediate feedback (in case subscription is slow)
      if (existingRooms) {
        for (const serverRoom of existingRooms) {
          const roomName = serverRoom.RoomName;
          // CRITICAL: Handle pending rooms with _tempId as well as synced rooms
          const roomId = serverRoom.EFEID || serverRoom.PK_ID || serverRoom._tempId;

          if (!roomName || !roomId) continue;

          // Update efeRecordIds map
          this.efeRecordIds[roomName] = String(roomId);
          this.selectedRooms[roomName] = true;
          this.savingRooms[roomName] = false;

          // Update roomTemplates array
          const roomTemplate = this.roomTemplates.find(r => r.RoomName === roomName);
          if (roomTemplate) {
            roomTemplate.isSelected = true;
            roomTemplate.isSaving = false;
            roomTemplate.efeId = String(roomId);
          }
        }
      }

      // CRITICAL FIX: Reset loading state after sync reload
      // Without this, the hub hangs on loading spinner forever after sync completes
      this.loading = false;
      this.changeDetectorRef.detectChanges();
      console.log('[ElevationPlotHub] Room reload complete');

    } catch (error) {
      console.error('[ElevationPlotHub] Error reloading rooms:', error);
      // CRITICAL: Ensure loading is reset even on error
      this.loading = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  ngOnDestroy(): void {
    // Unregister from SmartSync
    if (this.serviceId) {
      this.smartSync.unregisterActiveService(this.serviceId);
    }

    // Clean up Dexie-first subscription
    if (this.efeFieldsSubscription) {
      this.efeFieldsSubscription.unsubscribe();
    }

    if (this.roomSyncSubscription) {
      this.roomSyncSubscription.unsubscribe();
    }
    if (this.cacheInvalidationSubscription) {
      this.cacheInvalidationSubscription.unsubscribe();
    }
    if (this.backgroundRefreshSubscription) {
      this.backgroundRefreshSubscription.unsubscribe();
    }
    if (this.routerSubscription) {
      this.routerSubscription.unsubscribe();
    }
    if (this.cacheInvalidationDebounceTimer) {
      clearTimeout(this.cacheInvalidationDebounceTimer);
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

    // Track last navigated room for new room insertion positioning
    this.lastNavigatedRoom = room.RoomName;

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

      // DEXIE-FIRST: Update Dexie immediately so liveQuery triggers UI update
      const elevationPoints: EfePoint[] = this.roomElevationData[roomName]?.elevationPoints?.map((p: any) => ({
        pointNumber: p.pointNumber,
        pointId: null,
        tempPointId: null,
        name: p.name,
        value: p.value || '',
        photoCount: p.photoCount || 0
      })) || [];

      await this.efeFieldRepo.setRoomSelected(
        this.serviceId,
        roomName,
        true,
        response?._tempId ? null : roomId,  // efeId only if real
        response?._tempId ? roomId : null   // tempEfeId if temp
      );

      // Update organization in Dexie
      await this.efeFieldRepo.setRoomOrganization(this.serviceId, roomName, nextOrganization);

      // Update local state for immediate UI feedback
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

    // Pre-check if room can be renamed (synchronous validation)
    const roomId = this.efeRecordIds[oldRoomName];
    const roomIdStr = String(roomId || '');
    const canRename = roomId && roomId !== '__pending__' && !roomIdStr.startsWith('temp_');

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
          text: 'SAVE',
          handler: (data) => {
            const newRoomName = data.newRoomName?.trim();

            if (!newRoomName) {
              return false; // Keep alert open
            }

            if (newRoomName === oldRoomName) {
              return true; // No change needed
            }

            // Check if new name already exists
            const existingRoom = this.roomTemplates.find(r => r.RoomName === newRoomName);
            if (existingRoom) {
              return false; // Keep alert open
            }

            // CRITICAL: Verify this room belongs to the current service
            if (!canRename) {
              return false; // Keep alert open
            }

            // Return the data for processing after dismiss
            return { values: { newRoomName } };
          }
        },
        {
          text: 'CANCEL',
          role: 'cancel'
        }
      ]
    });

    await alert.present();
    const result = await alert.onDidDismiss();

    // Process save after alert is dismissed
    if (result.role !== 'cancel' && result.data?.values?.newRoomName) {
      const newRoomName = result.data.values.newRoomName;
      
      // DETACH change detection to prevent checkbox from firing during rename
      this.changeDetectorRef.detach();
      console.log('[Rename Room] Detached change detection');

      try {
        console.log('[Rename Room] Verifying room belongs to current service...');
        const existingRooms = await this.foundationData.getEFEByService(this.serviceId, true);
        const roomToRename = existingRooms.find(r => r.EFEID === roomId);

        if (!roomToRename) {
          console.error('[Rename Room] Room not found in current service!');
          console.error('[Rename Room] Looking for EFEID:', roomId, 'in service:', this.serviceId);
        } else {
          if (roomToRename.RoomName !== oldRoomName) {
            console.warn('[Rename Room] Room name mismatch in database');
            console.warn('[Rename Room] Expected:', oldRoomName, 'Got:', roomToRename.RoomName);
          }

          console.log('[Rename Room] Verified room:', roomToRename.RoomName, 'EFEID:', roomToRename.EFEID, 'ServiceID:', roomToRename.ServiceID);

          // Update database using the verified EFEID
          console.log('[Rename Room] Updating database for room:', oldRoomName, 'to:', newRoomName);
          const updateData = { RoomName: newRoomName };
          await this.caspioService.updateServicesEFEByEFEID(roomId, updateData).toPromise();
          console.log('[Rename Room] Database update successful for EFEID:', roomId);

          // DEXIE-FIRST: Rename room in Dexie (liveQuery will update UI)
          await this.efeFieldRepo.renameRoom(this.serviceId, oldRoomName, newRoomName);
          console.log('[Rename Room] Updated Dexie efeFields');

          // ATOMIC UPDATE: Create all new dictionary entries FIRST, then delete old ones
          console.log('[Rename Room] Updating all local state dictionaries atomically...');

          // CRITICAL: Set rename flag for new name too to block any checkbox events
          this.renamingRooms[newRoomName] = true;

          const roomIndex = this.roomTemplates.findIndex(r => r.RoomName === oldRoomName);

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
            this.roomTemplates[roomIndex] = {
              ...this.roomTemplates[roomIndex],
              RoomName: newRoomName
            };
            console.log('[Rename Room] Updated roomTemplates array with new object reference');
          }

          // Step 3: NOW delete old entries
          setTimeout(() => {
            delete this.efeRecordIds[oldRoomName];
            delete this.selectedRooms[oldRoomName];
            delete this.savingRooms[oldRoomName];
            delete this.roomElevationData[oldRoomName];
            console.log('[Rename Room] Deleted old entries after timeout');
          }, 100);

          // Clear rename flag for both old and new names
          delete this.renamingRooms[oldRoomName];
          delete this.renamingRooms[newRoomName];
        }
      } catch (error) {
        console.error('[Rename Room] Database update FAILED:', error);
      }
    }

    // CRITICAL: Clear rename flags and re-attach change detection after processing
    const allRoomNames = Object.keys(this.renamingRooms);
    allRoomNames.forEach(name => delete this.renamingRooms[name]);
    console.log('[Rename Room] Cleared all renamingRooms flags:', allRoomNames);

    // Re-attach change detection
    try {
      this.changeDetectorRef.reattach();
      this.changeDetectorRef.detectChanges();
      console.log('[Rename Room] Re-attached change detection after processing');
    } catch (e) {
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

        // CRITICAL FIX: Update IndexedDB cache to remove the deleted room
        // This prevents the room from reappearing when cache is reloaded by background refresh
        try {
          const cachedRooms = await this.indexedDb.getCachedServiceData(this.serviceId, 'efe_rooms') || [];
          const updatedRooms = cachedRooms.filter((room: any) => {
            const cachedRoomId = String(room.EFEID || room.PK_ID || '');
            return cachedRoomId !== String(roomId);
          });
          await this.indexedDb.cacheServiceData(this.serviceId, 'efe_rooms', updatedRooms);
          console.log('[ElevationPlotHub] ✅ Updated IndexedDB cache - removed room from efe_rooms');
        } catch (cacheError) {
          console.warn('[ElevationPlotHub] Failed to update IndexedDB cache:', cacheError);
          // Continue anyway - the API deletion succeeded
        }

        // DEXIE-FIRST: Mark room as deleted/unselected in Dexie (liveQuery will update UI)
        await this.efeFieldRepo.deleteRoom(this.serviceId, roomName);
        console.log('[ElevationPlotHub] ✅ Updated Dexie efeFields - room unselected');

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
      // DEFENSIVE: Preserve existing roomTemplates in case load fails
      const previousRoomTemplates = [...this.roomTemplates];
      
      const allTemplates = await this.foundationData.getEFETemplates();
      
      // Load existing rooms from database FIRST
      // This ensures we can display rooms even if templates fail
      let existingRooms: any[] = [];
      if (this.serviceId) {
        existingRooms = await this.foundationData.getEFEByService(this.serviceId, true);
        console.log(`[ElevationPlotHub] Loaded ${existingRooms?.length || 0} existing rooms from cache`);
      }

      // FALLBACK: If templates are empty but we have cached rooms, display rooms directly
      if (!allTemplates || allTemplates.length === 0) {
        console.warn('[ElevationPlotHub] ⚠️ Templates empty - attempting fallback to cached rooms');
        
        if (existingRooms && existingRooms.length > 0) {
          console.log('[ElevationPlotHub] ✅ Using cached rooms directly (templates unavailable)');
          
          // Build room display directly from cached room data
          this.roomTemplates = existingRooms.map((room: any) => {
            const roomName = room.RoomName;
            const effectiveRoomId = room.EFEID || room.PK_ID || room._tempId;
            
            // Mark as selected
            this.selectedRooms[roomName] = true;
            this.efeRecordIds[roomName] = String(effectiveRoomId);
            
            return {
              RoomName: roomName,
              TemplateID: room.TemplateID || 0,
              PK_ID: room.PK_ID || effectiveRoomId,
              PointCount: room.PointCount || 0,
              Organization: room.Organization,
              isSelected: true,
              isSaving: !!this.savingRooms[roomName],
              efeId: String(effectiveRoomId),
              _tempId: room._tempId,
              _localOnly: room._localOnly,
            };
          });
          
          // Sort by Organization
          this.roomTemplates.sort((a, b) => {
            const orgA = a['Organization'] !== undefined && a['Organization'] !== null ? a['Organization'] : 999999;
            const orgB = b['Organization'] !== undefined && b['Organization'] !== null ? b['Organization'] : 999999;
            return orgA - orgB;
          });
          
          console.log(`[ElevationPlotHub] Fallback: displayed ${this.roomTemplates.length} rooms from cache`);
        } else if (previousRoomTemplates.length > 0) {
          // ULTRA FALLBACK: Keep previous room templates if they exist
          console.warn('[ElevationPlotHub] ⚠️ No templates and no cached rooms - keeping previous state');
          this.roomTemplates = previousRoomTemplates;
        } else {
          console.error('[ElevationPlotHub] ❌ No templates, no cached rooms, no previous state - empty display');
          this.roomTemplates = [];
        }
        
        // Update UI state flags and exit
        this.isEmpty = this.roomTemplates.length === 0;
        this.isOnline = this.offlineService.isOnline();
        this.loading = false; // CRITICAL: Reset loading flag before early return
        this.changeDetectorRef.detectChanges();
        return;
      }

      // Normal flow: Templates are available
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

      // Build room templates list
      if (this.serviceId) {
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
            
            // FALLBACK: If no template found, create a minimal template from room data
            if (!template) {
              console.log(`[ElevationPlotHub] Creating fallback template for room: ${roomName}`);
              template = {
                RoomName: roomName,
                TemplateID: templateId || 0,
                PK_ID: room.PK_ID || room._tempId,
                PointCount: room.PointCount || 0,
                Auto: 'Yes'
              };
            }

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

            // Mark room as selected
            // CRITICAL: Also handle pending rooms with _tempId
            const effectiveRoomId = roomId || room.PK_ID || room._tempId;
            if (roomName && effectiveRoomId) {
              this.selectedRooms[roomName] = true;
              this.efeRecordIds[roomName] = String(effectiveRoomId);

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

      // Update UI state flags
      this.isEmpty = this.roomTemplates.length === 0;
      this.isOnline = this.offlineService.isOnline();
      
      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error('Error loading room templates:', error);
      // DEFENSIVE: Don't clear existing rooms on error
      if (this.roomTemplates.length === 0) {
        // Only try to load from cache if we have nothing displayed
        try {
          const cachedRooms = await this.indexedDb.getCachedServiceData(this.serviceId, 'efe_rooms');
          if (cachedRooms && cachedRooms.length > 0) {
            console.log('[ElevationPlotHub] Error recovery: Loading from cache');
            this.roomTemplates = cachedRooms.map((room: any) => ({
              RoomName: room.RoomName,
              TemplateID: room.TemplateID || 0,
              PK_ID: room.PK_ID || room._tempId,
              PointCount: room.PointCount || 0,
              Organization: room.Organization,
              isSelected: true,
              isSaving: false,
              efeId: String(room.EFEID || room.PK_ID || room._tempId),
            }));
          }
        } catch (cacheError) {
          console.error('[ElevationPlotHub] Cache recovery failed:', cacheError);
        }
      }
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

      // Determine insertion position based on last navigated room
      let insertIndex = 0;
      let newOrganization = 0;

      if (this.lastNavigatedRoom) {
        const lastRoomIndex = this.roomTemplates.findIndex(r => r.RoomName === this.lastNavigatedRoom);
        if (lastRoomIndex >= 0) {
          // Insert after the last navigated room
          insertIndex = lastRoomIndex + 1;
          const lastRoomOrg = this.roomTemplates[lastRoomIndex]['Organization'] ?? 0;
          // Set organization to be just after the last room
          newOrganization = lastRoomOrg + 1;
          console.log(`[Add Room] Inserting after "${this.lastNavigatedRoom}" at index ${insertIndex}, org=${newOrganization}`);
        }
      } else {
        console.log('[Add Room] No last navigated room, inserting at top');
      }

      roomData.Organization = newOrganization;

      // OPTIMISTIC UI: Create new room object and add to display list
      const newRoom: RoomDisplayData = {
        ...template,
        RoomName: roomName,
        Organization: newOrganization,
        isSelected: true,
        isSaving: true
      };

      // Insert at the calculated position
      if (insertIndex === 0) {
        this.roomTemplates.unshift(newRoom);  // Add to top if no last room
      } else {
        this.roomTemplates.splice(insertIndex, 0, newRoom);  // Insert after last navigated room
      }

      // Update lastNavigatedRoom so next added room chains after this one
      this.lastNavigatedRoom = roomName;

      this.selectedRooms[roomName] = true;
      const tempEfeId = `temp_efe_${Date.now()}`;
      this.efeRecordIds[roomName] = tempEfeId;
      this.savingRooms[roomName] = true;
      this.changeDetectorRef.detectChanges();

      // DEXIE-FIRST: Add/update room in Dexie with tempEfeId
      // This ensures room-elevation page can load instantly from Dexie
      // Use addRoom() which handles both new rooms (like "Bedroom #2") and existing template rooms
      try {
        // Convert elevationPoints to EfePoint format for Dexie
        const efePoints: EfePoint[] = elevationPoints.map((ep: any) => ({
          pointNumber: ep.pointNumber,
          pointId: null,
          tempPointId: null,  // Will be set by createPointRecordsForRoom
          name: ep.name,
          value: '',
          photoCount: 0
        }));

        // Add room to Dexie (creates new or updates existing)
        await this.efeFieldRepo.addRoom(
          this.serviceId,
          roomName,
          template.TemplateID || template.PK_ID,
          newOrganization,  // Insert after last navigated room
          null,  // efeId not yet known
          tempEfeId,
          efePoints
        );
        console.log('[Add Room] Added room to Dexie with tempEfeId:', tempEfeId);

        // DEXIE-FIRST: Create ALL elevation points with tempPointIds NOW
        // This ensures all buttons are enabled when entering room-elevation
        const createdPoints = await this.efeFieldRepo.createPointRecordsForRoom(
          this.serviceId,
          roomName,
          tempEfeId,
          this.foundationData  // Pass foundationData for queueing points
        );
        console.log('[Add Room] Created', createdPoints.length, 'elevation points with temp IDs');
      } catch (dexieError) {
        console.error('[Add Room] Dexie update error (non-fatal):', dexieError);
        // Continue - room will still be created in backend
      }

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

          // DEXIE-FIRST: Update Dexie with real efeId
          try {
            await this.efeFieldRepo.updateEfeId(this.serviceId, roomName, String(roomId));
            console.log('[Add Room] Updated Dexie with real efeId:', roomId);
          } catch (dexieError) {
            console.error('[Add Room] Failed to update Dexie with real efeId:', dexieError);
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

        // DEXIE-FIRST: Revert Dexie changes on failure
        try {
          await this.efeFieldRepo.deleteRoom(this.serviceId, roomName);
          console.log('[Add Room] Reverted Dexie room on failure');
        } catch (dexieError) {
          console.error('[Add Room] Failed to revert Dexie:', dexieError);
        }

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
