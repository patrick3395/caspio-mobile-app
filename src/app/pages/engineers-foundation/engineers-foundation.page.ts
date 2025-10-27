﻿import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { CaspioService } from '../../services/caspio.service';
import { OfflineService } from '../../services/offline.service';
import { ToastController, LoadingController, AlertController, ActionSheetController, ModalController, Platform, NavController } from '@ionic/angular';
import { CameraService } from '../../services/camera.service';
import { ImageCompressionService } from '../../services/image-compression.service';
import { CacheService } from '../../services/cache.service';
import { PhotoViewerComponent } from '../../components/photo-viewer/photo-viewer.component';
// import { PhotoAnnotatorComponent } from '../../components/photo-annotator/photo-annotator.component';
import { FabricPhotoAnnotatorComponent } from '../../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { PdfGeneratorService } from '../../services/pdf-generator.service';
import { PlatformDetectionService } from '../../services/platform-detection.service';
import { compressAnnotationData, decompressAnnotationData, EMPTY_COMPRESSED_ANNOTATIONS } from '../../utils/annotation-utils';
import { HelpModalComponent } from '../../components/help-modal/help-modal.component';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { firstValueFrom, Subscription } from 'rxjs';
import { EngineersFoundationDataService } from './engineers-foundation-data.service';

type PdfPreviewCtor = typeof import('../../components/pdf-preview/pdf-preview.component')['PdfPreviewComponent'];
// jsPDF is now lazy-loaded via PdfGeneratorService


interface ServicesVisualRecord {
  ServiceID: number;  // Changed to number to match Integer type in Caspio
  Category: string;
  Kind: string;  // Changed from Type to Kind
  Name: string;
  Text: string;  // The full text content
  Notes: string;  // Made required, will send empty string if not provided
  Answers?: string;  // Optional field for storing Yes/No or comma-delimited multi-select answers
}

interface PendingPhotoUpload {
  file: File;
  annotationData?: any;
  originalPhoto?: File | null;
  isBatchUpload: boolean;
  tempId: string;
  visualId?: string;
  timestamp?: number;
  caption?: string; // Caption from photo editor
}


function hasAnnotationObjects(data: any): boolean {
  if (!data) {
    return false;
  }

  let parsed = data;
  if (typeof data === 'string') {
    const raw = data.startsWith('COMPRESSED_V3:') ? data.substring('COMPRESSED_V3:'.length) : data;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false;
    }
  }

  const objects = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.objects)
      ? parsed.objects
      : [];

  return objects.length > 0;
}

interface PendingVisualCreate {
  category: string;
  templateId: string;
  data: ServicesVisualRecord;
}

@Component({
  selector: 'app-engineers-foundation',
  templateUrl: './engineers-foundation.page.html',
  styleUrls: ['./engineers-foundation.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush  // PERFORMANCE: OnPush for optimized change detection
})
export class EngineersFoundationPage implements OnInit, AfterViewInit, OnDestroy {
  // Build cache fix: v1.4.247 - Fixed class structure, removed orphaned code
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('structuralStatusSelect') structuralStatusSelect?: ElementRef<HTMLSelectElement>;
  
  projectId: string = '';
  serviceId: string = '';
  projectData: any = null;
  serviceData: any = {}; // Store Services table data
  hasChangesAfterLastFinalization: boolean = false; // Track if changes made since last Update/Finalize
  currentUploadContext: any = null;
  currentRoomPointContext: any = null;  // For room photo uploads
  currentFDFPhotoContext: any = null;  // For FDF photo uploads
  skipElevationAnnotation: boolean = false;  // Skip annotation for elevation plot photos
  uploadingPhotos: { [key: string]: number } = {}; // Track uploads per visual
  expectingCameraPhoto: boolean = false; // Track if we're expecting a camera photo
  private readonly photoPlaceholder = 'assets/img/photo-placeholder.svg';
  private thumbnailCache = new Map<string, Promise<string | null>>();
  
  // Note: Removed memoization caches - direct lookups are already fast enough
  // and proper unique cache keys were causing complexity issues
  
  private templateLoader?: HTMLIonAlertElement;
  private _loggedPhotoKeys?: Set<string>; // Track which photo keys have been logged to reduce console spam
  private templateLoaderPresented = false;
  private templateLoadStart = 0;
  private readonly templateLoaderMinDuration = 1000;
  private photoHydrationPromise: Promise<void> | null = null;
  private waitingForPhotoHydration = false;
  private structuralStatusMirror?: HTMLSpanElement;
  private structuralWidthRaf?: number;

  private restoreScrollPosition(target: number, attempts = 3): void {
    if (attempts <= 0) {
      return;
    }
    requestAnimationFrame(() => {
      window.scrollTo(0, target);
      this.restoreScrollPosition(target, attempts - 1);
    });
  }

  private getValidAttachIdFromPhoto(photo: any): string | null {
    if (!photo) {
      return null;
    }
    const candidates = [
      photo.AttachID,
      photo.attachId,
      photo.id
    ];
    for (const candidate of candidates) {
      if (candidate === undefined || candidate === null) {
        continue;
      }
      const value = String(candidate);
      if (!value || value === 'undefined' || value === 'null' || value.startsWith('temp_')) {
        continue;
      }
      return value;
    }
    return null;
  }

  private getLatestPhotoRecord(visualId: string | undefined, key: string, photo: any): any {
    const pools: any[][] = [];
    if (visualId) {
      pools.push(this.visualPhotos[visualId] || []);
    }
    pools.push(this.visualPhotos[key] || []);

    for (const photos of pools) {
      const match = photos.find((p: any) => {
        if (!p) {
          return false;
        }
        if (p === photo) {
          return true;
        }
        const pAttachId = this.getValidAttachIdFromPhoto(p);
        const photoAttachId = this.getValidAttachIdFromPhoto(photo);
        if (pAttachId && photoAttachId && pAttachId === photoAttachId) {
          return true;
        }
        if (photo?.attachId && pAttachId && pAttachId === String(photo.attachId)) {
          return true;
        }
        if (photo?.AttachID && pAttachId && pAttachId === String(photo.AttachID)) {
          return true;
        }
        if (photo?.filePath && p?.filePath && p.filePath === photo.filePath) {
          return true;
        }
        if (photo?.Photo && p?.Photo && p.Photo === photo.Photo) {
          return true;
        }
        if (photo?.url && p?.url && p.url === photo.url && p.uploading === photo.uploading) {
          return true;
        }
        if (photo?.name && p?.name && p.name === photo.name && p.uploading === photo.uploading) {
          return true;
        }
        return false;
      });
      if (match) {
        return match;
      }
    }
    return photo;
  }
  // PDF generation state
  isPDFGenerating: boolean = false;
  pdfGenerationAttempts: number = 0;
  private autoPdfRequested = false;
  private viewInitialized = false;
  private dataInitialized = false;
  private isFirstLoad = true; // Prevent ionViewWillEnter from reloading on initial page load
  private pdfPreviewComponent?: PdfPreviewCtor;
  private subscriptions = new Subscription();
  private pendingVisualKeys: Set<string> = new Set();
  private pendingPhotoUploads: { [key: string]: PendingPhotoUpload[] } = {};
  private pendingVisualCreates: { [key: string]: PendingVisualCreate } = {};
  private pendingRoomCreates: { [roomName: string]: any } = {}; // Queue room creation when offline
  private pendingPointCreates: { [key: string]: any } = {}; // Queue point creation with room dependency
  
  // Memory cleanup tracking
  private canvasCleanup: (() => void)[] = [];
  private timers: any[] = [];
  private intervals: any[] = [];

  // Helper methods for memory management
  private trackTimer(timer: any): any {
    this.timers.push(timer);
    return timer;
  }

  private trackInterval(interval: any): any {
    this.intervals.push(interval);
    return interval;
  }

  private addCanvasCleanup(cleanup: () => void): void {
    this.canvasCleanup.push(cleanup);
  }
  
  // Categories from Services_Visuals_Templates
  visualCategories: string[] = [];
  visualTemplates: any[] = [];
  expandedCategories: { [key: string]: boolean } = {};
  categoryData: { [key: string]: any } = {};
  
  // Organized by Type within each Category
  organizedData: { [category: string]: { 
    comments: any[], 
    limitations: any[], 
    deficiencies: any[] 
  }} = {};
  
  // Track selected items
  selectedItems: { [key: string]: boolean } = {};
  
  // Track saving state for items
  savingItems: { [key: string]: boolean } = {};
  
  // Track visual record IDs from Services_Visuals table
  visualRecordIds: { [key: string]: string } = {};
  
  // Track photos for each visual
  visualPhotos: { [visualId: string]: any[] } = {};
  
  // Photo loading optimization
  photoLoadQueue: { visualId: string; photoIndex: number; photo: any }[] = [];
  isLoadingPhotos: boolean = false;
  visibleVisuals: Set<string> = new Set(); // Track which visuals are visible
  photoLoadBatchSize: number = 3; // Load 3 photos at a time
  private readonly photoLoadConcurrency = 4;
  
  // Type information for the header
  typeShort: string = 'Foundation Evaluation';
  typeFull: string = "EFE - Engineer's Foundation Evaluation";
  
  // Dropdown options for AnswerType 2 from Services_Visuals_Drop
  visualDropdownOptions: { [templateId: string]: string[] } = {};
  
  // Form data for the template
  formData: any = {
    // Additional fields to be added based on requirements
  };
  
  // Room templates for elevation plot
  roomTemplates: any[] = [];
  availableRoomTemplates: any[] = []; // v1.4.65 - Available room templates
  allRoomTemplates: any[] = []; // Store all templates for manual addition
  roomElevationData: { [roomName: string]: any } = {};
  selectedRooms: { [roomName: string]: boolean } = {};
  efeRecordIds: { [roomName: string]: string } = {}; // Track Services_EFE IDs
  savingRooms: { [roomName: string]: boolean } = {};
  renamingRooms: { [roomName: string]: boolean } = {}; // Track rooms being renamed to prevent checkbox toggles
  efePointIds: { [key: string]: string } = {}; // Track Services_EFE_Points IDs
  expandedRooms: { [roomName: string]: boolean } = {}; // Track room expansion state
  roomNotesDebounce: { [roomName: string]: any } = {}; // Track note update debounce timers
  currentRoomPointCapture: any = null; // Store current capture context
  
  // FDF dropdown options from Services_EFE_Drop table - mapped by room name
  fdfOptions: string[] = [];
  roomFdfOptions: { [roomName: string]: string[] } = {};
  
  // Services dropdown options from Services_Drop table
  weatherConditionsOptions: string[] = [];
  outdoorTemperatureOptions: string[] = [];
  occupancyFurnishingsOptions: string[] = [];
  inAttendanceOptions: string[] = [];
  inAttendanceSelections: string[] = []; // Multi-select array for In Attendance
  inAttendanceOtherValue: string = ''; // Custom value for "Other" option
  firstFoundationTypeOptions: string[] = [];
  secondFoundationTypeOptions: string[] = [];
  thirdFoundationTypeOptions: string[] = [];
  secondFoundationRoomsOptions: string[] = [];
  secondFoundationRoomsSelections: string[] = []; // Multi-select array
  secondFoundationRoomsOtherValue: string = ''; // Custom value for "Other"
  thirdFoundationRoomsOptions: string[] = [];
  thirdFoundationRoomsSelections: string[] = []; // Multi-select array
  thirdFoundationRoomsOtherValue: string = ''; // Custom value for "Other"
  ownerOccupantInterviewOptions: string[] = [];
  
  // Project dropdown options from Projects_Drop table
  typeOfBuildingOptions: string[] = [];
  styleOptions: string[] = [];

  // Custom "Other" values storage
  customOtherValues: { [fieldName: string]: string } = {};

  // UI state
  expandedSections: { [key: string]: boolean } = {
    project: false,  // Project Details collapsed by default
    structural: false,  // Structural Systems collapsed by default
    elevation: false
  };
  
  // Back to top button state
  showBackToTop = true; // Always show the button
  
  // Track which accordion categories are expanded
  expandedAccordions: string[] = [];
  @ViewChild('visualAccordionGroup') visualAccordionGroup: any;
  
  saveStatus: string = '';
  saveStatusType: 'info' | 'success' | 'error' = 'info';

  // Offline sync state
  isOnline: boolean = true;
  manualOffline: boolean = false;
  showOfflineBanner: boolean = false;
  offlineMessage: string = '';
  queuedChanges: number = 0;
  queuedChangesLabel: string = '';

  // Track field completion
  fieldCompletion: { [key: string]: number } = {
    structural: 0,
    elevation: 0
  };

  private async loadPdfPreview(): Promise<PdfPreviewCtor> {
    if (!this.pdfPreviewComponent) {
      const module = await import('../../components/pdf-preview/pdf-preview.component');
      this.pdfPreviewComponent = module.PdfPreviewComponent;
    }
    return this.pdfPreviewComponent;
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private navController: NavController,
    private location: Location,
    private caspioService: CaspioService,
    private toastController: ToastController,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private actionSheetController: ActionSheetController,
    private modalController: ModalController,
    private changeDetectorRef: ChangeDetectorRef,
    private cameraService: CameraService,
    private imageCompression: ImageCompressionService,
    private platformIonic: Platform,
    public platform: PlatformDetectionService,
    private pdfGenerator: PdfGeneratorService,
    private cache: CacheService,
    private offlineService: OfflineService,
    private foundationData: EngineersFoundationDataService
  ) {}

  async ngOnInit() {
    console.log('[ngOnInit] ========== START ==========');
    // Get project ID from route params
    this.projectId = this.route.snapshot.paramMap.get('projectId') || '';
    this.serviceId = this.route.snapshot.paramMap.get('serviceId') || '';
    
    console.log('[ngOnInit] ProjectId from route:', this.projectId);
    console.log('[ngOnInit] ServiceId from route:', this.serviceId);
    console.log('[ngOnInit] isFirstLoad:', this.isFirstLoad);

    this.isOnline = this.offlineService.isOnline();
    this.manualOffline = this.offlineService.isManualOffline();
    this.updateOfflineBanner();

    this.subscriptions.add(
      this.offlineService.getOnlineStatus().subscribe(status => {
        this.isOnline = status;
        this.updateOfflineBanner();
        if (status) {
          setTimeout(() => this.updateQueueStatus(), 300);
          this.refreshPendingVisuals().catch(error => {
            console.error('Failed to refresh pending visuals:', error);
          });
        }
      })
    );

    this.subscriptions.add(
      this.offlineService.getManualOfflineStatus().subscribe(manual => {
        this.manualOffline = manual;
        this.updateOfflineBanner();
      })
    );

    const openPdfParam = this.route.snapshot.queryParamMap.get('openPdf');
    this.autoPdfRequested = (openPdfParam || '').toLowerCase() === '1' || (openPdfParam || '').toLowerCase() === 'true';

    // Debug logging removed - v1.4.316

    // Load all data in parallel for faster initialization
    console.log('[ngOnInit] About to call presentTemplateLoader()');
    await this.presentTemplateLoader();
    console.log('[ngOnInit] presentTemplateLoader() completed');

    try {
      console.log('[ngOnInit] Starting Promise.all data loading...');
      await Promise.all([
        this.loadProjectData(),
        this.loadVisualCategories(),
        this.loadRoomTemplates(),
        this.loadFDFOptions(),
        this.loadProjectDropdownOptions(),
        this.loadServicesDropdownOptions(),
        this.loadVisualDropdownOptions()
      ]);
      console.log('[ngOnInit] Promise.all completed');
      
      // Then load any existing template data (including visual selections)
      console.log('[ngOnInit] Starting loadExistingData...');
      await this.loadExistingData();
      console.log('[ngOnInit] loadExistingData completed');
      this.dataInitialized = true;
      this.tryAutoOpenPdf();
    } catch (error) {
      console.error('Error loading template data:', error);
    } finally {
      console.log('[ngOnInit] About to dismiss loader and set isFirstLoad = false');
      await this.dismissTemplateLoader();
      this.isFirstLoad = false; // Mark first load as complete
      console.log('[ngOnInit] ========== END ==========');
    }
  }
  
  ngAfterViewInit() {
    this.viewInitialized = true;
    this.tryAutoOpenPdf();
    // ViewChild ready
    // Ensure buttons are enabled on page load
    this.ensureButtonsEnabled();
    // Add direct event listeners as fallback
    this.addButtonEventListeners();
  }

  private tryAutoOpenPdf(): void {
    if (!this.autoPdfRequested || !this.viewInitialized || !this.dataInitialized) {
      return;
    }

    if (this.photoHydrationPromise) {
      if (!this.waitingForPhotoHydration) {
        this.waitingForPhotoHydration = true;
        this.photoHydrationPromise.finally(() => {
          this.waitingForPhotoHydration = false;
          this.tryAutoOpenPdf();
        });
      }
      return;
    }

    this.autoPdfRequested = false;
    setTimeout(() => {
      this.generatePDF().catch(error => {
        console.error('[AutoPDF] Failed to generate PDF automatically:', error);
      });
    }, 300);
  }

  // Add direct event listeners to buttons as fallback
  addButtonEventListeners() {
    // Angular (click) binding should handle button clicks
    // No need for manual DOM listeners which can cause double-firing
    console.log('[Button Listeners] Using Angular click bindings - no manual listeners needed');
  }

  // Bound methods for event listeners
  private handleBackClick = (event?: Event) => {
    console.log('[Back Button] Click detected!');
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.goBack();
  }

  private handlePDFClickBound = (event: Event) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.generatePDF(event);
  }

  // Ensure buttons are not stuck in disabled state
  ensureButtonsEnabled() {
    // Reset PDF generation flag
    this.isPDFGenerating = false;

    // Enable PDF button after a brief delay to ensure DOM is ready
    setTimeout(() => {
      const pdfButton = document.querySelector('.pdf-header-button') as HTMLButtonElement;
      if (pdfButton) {
        pdfButton.disabled = false;
        pdfButton.style.pointerEvents = 'auto';
        pdfButton.style.opacity = '1';
      }
    }, 100);
  }
  
  // Page re-entry - photos now use base64 URLs so no refresh needed
  async ionViewWillEnter() {
    console.log('==========================================');
    console.log('[Lifecycle] ionViewWillEnter CALLED');
    console.log('[Lifecycle] isFirstLoad:', this.isFirstLoad);
    console.log('[Lifecycle] ServiceID:', this.serviceId);
    console.log('[Lifecycle] Current selectedRooms:', Object.keys(this.selectedRooms));
    console.log('[Lifecycle] Current selectedItems:', Object.keys(this.selectedItems).length);
    console.log('==========================================');

    // Re-add button listeners in case they were removed
    this.addButtonEventListeners();

    // Skip data reload on first load - ngOnInit already handles it
    // Only reload when returning to the page after navigating away
    if (this.isFirstLoad) {
      console.log('[Lifecycle] Skipping data reload on first load - handled by ngOnInit');
      return;
    }

    // CRITICAL: Clear all caches to force fresh data load from Caspio
    // This prevents stale cached data from being displayed when returning to the page
    console.log('[Lifecycle] Clearing all data caches...');
    this.foundationData.clearAllCaches();

    // CRITICAL FIX: Reload existing selections when returning to the page
    // This ensures data persists when navigating back and forth
    if (this.serviceId) {
      try {
        console.log('[Lifecycle] Starting data reload...');

        // Reload project and service data (including all form fields)
        await this.loadProjectData();
        console.log('[Lifecycle] After loadProjectData - Project fields reloaded');

        await this.loadServiceData();
        console.log('[Lifecycle] After loadServiceData - Service fields reloaded');

        await this.loadRoomTemplates(); // Reload room selections and data
        console.log('[Lifecycle] After loadRoomTemplates - selectedRooms:', Object.keys(this.selectedRooms));

        await this.loadExistingVisualSelections({ awaitPhotos: true }); // Reload visual selections
        console.log('[Lifecycle] After loadExistingVisualSelections - selectedItems:', Object.keys(this.selectedItems).length);

        console.log('[Lifecycle] Data reload COMPLETE');
      } catch (error) {
        console.error('[Lifecycle] ERROR during data reload:', error);
        // Show toast to make it visible
        this.showToast('Error loading data: ' + (error as any).message, 'danger');
      }
    } else {
      console.warn('[Lifecycle] No serviceId - skipping data reload');
    }
  }

  ngOnDestroy() {
    // Unsubscribe from all observables
    this.subscriptions.unsubscribe();

    // Clean up timers
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    
    // Clean up all tracked timers and intervals
    this.timers.forEach(timer => clearTimeout(timer));
    this.intervals.forEach(interval => clearInterval(interval));
    this.timers = [];
    this.intervals = [];
    
    // Clean up canvas elements
    this.canvasCleanup.forEach(cleanup => cleanup());
    this.canvasCleanup = [];
    
    // Clean up object URLs to prevent memory leaks
    Object.values(this.visualPhotos).forEach((photos: any) => {
      if (Array.isArray(photos)) {
        photos.forEach((photo: any) => {
          if (photo.isObjectUrl && photo.url) {
            URL.revokeObjectURL(photo.url);
          }
        });
      }
    });
    
    // Clear large data structures to prevent memory leaks
    this.visualPhotos = {};
    this.roomElevationData = {};
    this.roomTemplates = [];
    this.organizedData = {};
    this.categoryData = {};
    this.visualCategories = [];
    this.visualTemplates = [];
    this.expandedCategories = {};
    this.selectedItems = {};
    this.savingItems = {};
    this.selectedRooms = {};
    this.expandedRooms = {};
    this.efeRecordIds = {};
    this.savingRooms = {};

    // Clear pending operations
    this.formData = {};
    this.pendingPhotoUploads = {};
    this.pendingVisualCreates = {};
    this.pendingRoomCreates = {};
    this.pendingPointCreates = {};
    this.pendingVisualKeys.clear();

    // Clear thumbnail cache
    this.thumbnailCache.clear();

    // Clean up DOM elements
    if (this.structuralWidthRaf) {
      cancelAnimationFrame(this.structuralWidthRaf);
      this.structuralWidthRaf = undefined;
    }
    if (this.structuralStatusMirror?.parentElement) {
      this.structuralStatusMirror.parentElement.removeChild(this.structuralStatusMirror);
    }
    this.structuralStatusMirror = undefined;

    // Clear template loader
    if (this.templateLoader) {
      this.templateLoader.dismiss();
      this.templateLoader = undefined;
    }
  }

  // ========== PERFORMANCE: TrackBy Functions for ngFor Optimization ==========
  // These prevent unnecessary DOM re-renders by tracking items by unique identifiers
  
  trackByCategory(index: number, category: string): string {
    return category;
  }

  trackByItemId(index: number, item: any): any {
    return item.id || item.TemplateID || item.ItemID || index;
  }

  trackByPhotoId(index: number, photo: any): any {
    return photo.AttachID || photo.id || photo.PK_ID || index;
  }

  trackByRoomName(index: number, room: any): string {
    return room.RoomName || room.roomName || index.toString();
  }

  trackByPointName(index: number, point: any): string {
    return point.name || point.PointName || index.toString();
  }

  trackByOption(index: number, option: string): string {
    return option;
  }

  trackByVisualKey(index: number, item: any): string {
    // For visual items, use category_itemId as unique key
    return item.key || `${item.category}_${item.id}` || index.toString();
  }

  // ========== End TrackBy Functions ==========

  private navigateBackToProject(): void {
    if (this.projectId) {
      void this.router.navigate(['/project', this.projectId], { replaceUrl: true });
    } else {
      void this.router.navigate(['/tabs/active-projects'], { replaceUrl: true });
    }
  }

  // Navigation method for back button
  goBack(event?: Event) {
    console.log('='.repeat(50));
    console.log('[goBack] CALLED!');
    console.log('[goBack] Event:', event);
    console.log('[goBack] Platform:', this.platform.isWeb() ? 'Web' : 'Mobile');
    console.log('[goBack] ProjectId:', this.projectId);
    console.log('[goBack] ServiceId:', this.serviceId);
    console.log('='.repeat(50));
    
    // Prevent default and stop propagation
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    // Method 1: Use Location.back() - this is the simplest and most reliable way
    try {
      this.location.back();
      return;
    } catch (error) {
      console.error('[goBack] Location.back() failed:', error);
    }

    // Fallback to manual navigation if location.back() fails
    if (this.projectId) {
      void this.router.navigate(['/project', this.projectId], { replaceUrl: true });
    } else {
      void this.router.navigate(['/tabs/active-projects'], { replaceUrl: true });
    }
  }

  async loadProjectData() {
    if (!this.projectId) return;

    try {
      this.projectData = await this.foundationData.getProject(this.projectId);

      // Format numeric fields after loading
      this.formatSquareFeet();
      this.formatYearBuilt();

      // Check for custom values and add them to dropdown options
      this.loadCustomValuesIntoDropdowns();
      
      // Parse multi-select fields
      this.parseInAttendanceField();
      this.parseSecondFoundationRoomsField();
      this.parseThirdFoundationRoomsField();

      // Type information is now loaded from Service data which has the correct TypeID
    } catch (error) {
      console.error('Error loading project data:', error);
      await this.showToast('Failed to load project data', 'danger');
    }
  }
  
  async loadTypeInfo(typeId: string) {
    try {
      const typeData = await this.foundationData.getType(typeId);
      
      if (typeData?.TypeShort) {
        this.typeShort = typeData.TypeShort;
      }

      if (typeData?.TypeName) {
        // Add EFE prefix if not already present
        const typeName = typeData.TypeName;
        if (typeName.includes('Engineer') && typeName.includes('Foundation')) {
          this.typeFull = typeName.startsWith('EFE - ') ? typeName : `EFE - ${typeName}`;
        } else {
          this.typeFull = typeName;
        }
      } else {
        this.typeFull = this.typeShort;
      }

      // Force change detection to update the view
      this.changeDetectorRef.detectChanges();
        
      if (!typeData?.TypeShort) {
        console.warn('ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â TypeShort not found in type data:', typeData);
        
        // TypeShort not found in response
      }
    } catch (error: any) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error loading type info:', error);
      // Keep default value if load fails
      
      // Get detailed error information
      let errorDetails = '';
      if (error?.error) {
        errorDetails = typeof error.error === 'string' ? error.error : JSON.stringify(error.error, null, 2);
      } else if (error?.message) {
        errorDetails = error.message;
      } else {
        errorDetails = JSON.stringify(error, null, 2);
      }
      // Error loading type - using default
    }
  }
  
  async loadServiceData() {
    if (!this.serviceId) {
      return;
    }

    try {
      // Load service data from Services table
      const serviceResponse = await this.foundationData.getService(this.serviceId);
      if (serviceResponse) {
        this.serviceData = serviceResponse;

        // Set ReportFinalized flag based on Status field
        if (serviceResponse.Status === 'Finalized' || serviceResponse.Status === 'Updated') {
          this.serviceData.ReportFinalized = true;
        } else {
          this.serviceData.ReportFinalized = false;
        }

        // Initialize change tracking - no changes yet since we just loaded from database
        this.hasChangesAfterLastFinalization = false;
        console.log('[LoadService] Initialized hasChangesAfterLastFinalization to false');
        console.log('[LoadService] Service Status:', this.serviceData.Status);
        console.log('[LoadService] ReportFinalized:', this.serviceData.ReportFinalized);

        // Map database column StructStat to UI property StructuralSystemsStatus
        if (serviceResponse.StructStat) {
          this.serviceData.StructuralSystemsStatus = serviceResponse.StructStat;
        } else {
          this.serviceData.StructuralSystemsStatus = '';
        }
        
        // TypeID loaded from service data
        
        // Load type information using TypeID from service data
        if (this.serviceData?.TypeID) {
          await this.loadTypeInfo(this.serviceData.TypeID);
        } else {
          console.warn('ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No TypeID found in service data');
        }

        this.loadCustomValuesIntoDropdowns();
        this.parseInAttendanceField();
        this.parseSecondFoundationRoomsField();
        this.parseThirdFoundationRoomsField();
      } else {
        console.warn('ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No service response received');
      }
    } catch (error) {
      console.error('Error loading service data:', error);
      // Initialize with default values if service doesn't exist yet
      this.serviceData = {
        ServiceID: this.serviceId,
        ProjectID: this.projectId,
        TypeID: this.serviceData.TypeID || '',
        DateOfInspection: this.serviceData.DateOfInspection || '',
        DateOfRequest: this.serviceData.DateOfRequest || '',
        InAttendance: this.serviceData.InAttendance || '',
        WeatherConditions: this.serviceData.WeatherConditions || '',
        OutdoorTemperature: this.serviceData.OutdoorTemperature || '',
        OccupancyFurnishings: this.serviceData.OccupancyFurnishings || '',
        FirstFoundationType: this.serviceData.FirstFoundationType || '',
        SecondFoundationType: this.serviceData.SecondFoundationType || '',
        SecondFoundationRooms: this.serviceData.SecondFoundationRooms || '',
        ThirdFoundationType: this.serviceData.ThirdFoundationType || '',
        ThirdFoundationRooms: this.serviceData.ThirdFoundationRooms || '',
        OwnerOccupantInterview: this.serviceData.OwnerOccupantInterview || '',
        StructuralSystemsStatus: this.serviceData.StructuralSystemsStatus || '',
        Notes: this.serviceData.Notes || '',
        Status: '',
        ReportFinalized: false
      };
    }
  }
  
  async loadRoomTemplates() {
    try {
      console.log('[loadRoomTemplates] START - Current selectedRooms:', Object.keys(this.selectedRooms));

      const allTemplates = await this.foundationData.getEFETemplates();
      console.log('[loadRoomTemplates] Fetched templates:', allTemplates?.length);

      if (allTemplates && allTemplates.length > 0) {
        // Store all templates for manual addition
        this.allRoomTemplates = allTemplates;

        // Filter templates where Auto = 'Yes'
        const autoTemplates = allTemplates.filter((template: any) =>
          template.Auto === 'Yes' || template.Auto === true || template.Auto === 1
        );
        console.log('[loadRoomTemplates] Auto templates:', autoTemplates.length);

        // IMPORTANT: Start with auto templates but preserve existing manually added rooms
        // DON'T immediately overwrite - we'll rebuild the full list below
        const baseTemplates = [...autoTemplates];
        this.availableRoomTemplates = [...autoTemplates]; // v1.4.65 - populate available templates
        
        // Initialize room elevation data for each template (but don't create in Services_EFE yet)
        autoTemplates.forEach((template: any) => {
          if (template.RoomName && !this.roomElevationData[template.RoomName]) {
            // Extract elevation points from Point1Name, Point2Name, etc.
            const elevationPoints: any[] = [];
            
            // Check for up to 20 point columns
            for (let i = 1; i <= 20; i++) {
              const pointColumnName = `Point${i}Name`;
              const pointName = template[pointColumnName];
              
              if (pointName && pointName.trim() !== '') {
                elevationPoints.push({
                  pointNumber: i,
                  name: pointName,
                  value: '',  // User will input the elevation value
                  photo: null
                });
              }
            }
            
            this.roomElevationData[template.RoomName] = {
              roomName: template.RoomName,
              templateId: template.TemplateID || template.PK_ID, // Use TemplateID field first
              elevationPoints: elevationPoints,
              pointCount: template.PointCount || elevationPoints.length,
              notes: '',
              fdf: '' // Initialize FDF with empty for "-- Select --"
            };
          }
        });
        
        // Load existing Services_EFE for this service to check which are already selected
        if (this.serviceId) {
          console.log('[EFE Load] Fetching existing rooms for ServiceID:', this.serviceId);
          // CRITICAL: Force refresh to bypass cache and get latest room data
          const existingRooms = await this.foundationData.getEFEByService(this.serviceId, true);
          console.log('[EFE Load] ===== DATABASE RETURNED ROOMS =====');
          console.log('[EFE Load] Found existing rooms count:', existingRooms.length);
          existingRooms.forEach((room: any, index: number) => {
            console.log(`[EFE Load] Room ${index + 1}: RoomName="${room.RoomName}", EFEID=${room.EFEID}, TemplateID=${room.TemplateID}`);
          });
          console.log('[EFE Load] ===== END DATABASE ROOMS =====');

          if (existingRooms && existingRooms.length > 0) {
            // Build the complete room templates list including saved rooms
            const roomsToDisplay: any[] = [...baseTemplates];
            console.log('[EFE Load] ===== BASE TEMPLATES =====');
            console.log('[EFE Load] Base templates count:', roomsToDisplay.length);
            roomsToDisplay.forEach((template: any, index: number) => {
              console.log(`[EFE Load] Base Template ${index + 1}: RoomName="${template.RoomName}", TemplateID=${template.TemplateID || template.PK_ID}`);
            });
            console.log('[EFE Load] ===== END BASE TEMPLATES =====');

            // Now we can use the RoomName field directly
            for (const room of existingRooms) {
              const roomName = room.RoomName;
              // Use EFEID field, NOT PK_ID - EFEID is what links to Services_EFE_Points
              const roomId = room.EFEID;
              const templateId = room.TemplateID; // Use TemplateID to match templates

              console.log('[EFE Load] ===== PROCESSING ROOM =====');
              console.log('[EFE Load] Room from DB: RoomName="' + roomName + '", EFEID=' + roomId + ', TemplateID=' + templateId);

              // Find matching template by TemplateID first (handles renamed rooms), fallback to RoomName
              let template = null;
              let matchedByTemplateId = false;
              
              // CRITICAL FIX: Convert templateId to number for comparison (declare at higher scope)
              // Database returns string but templates have numeric TemplateID
              const templateIdNum = typeof templateId === 'string' ? parseInt(templateId, 10) : templateId;
              
              if (templateId) {
                console.log('[EFE Load] Searching for template with TemplateID:', templateId, '(converted to:', templateIdNum, ')');
                
                // Try to find by TemplateID (works even if room was renamed)
                // Use == for loose equality to handle type differences
                template = this.allRoomTemplates.find((t: any) => 
                  t.TemplateID == templateIdNum || t.PK_ID == templateIdNum
                );
                
                if (template) {
                  matchedByTemplateId = true;
                  console.log('[EFE Load] ✓ Found template by TemplateID:', template.RoomName, 'TemplateID=', template.TemplateID);
                } else {
                  console.log('[EFE Load] ✗ No template found for TemplateID:', templateIdNum);
                }
              }
              
              // Fallback: try to match by RoomName for backward compatibility
              if (!template) {
                template = baseTemplates.find((t: any) => t.RoomName === roomName);
                
                // If not in auto templates, check all templates (for manually added rooms)
                if (!template) {
                  // Extract base name by removing number suffix if present
                  const baseName = roomName.replace(/ #\d+$/, '');
                  template = this.allRoomTemplates.find((t: any) => t.RoomName === baseName);
                }
                
                if (template) {
                  console.log('[EFE Load] Found template by RoomName (fallback):', template.RoomName);
                }
              }

              // If found, handle adding/updating in roomsToDisplay
              if (template) {
                console.log('[EFE Load] Template found! Original template RoomName="' + template.RoomName + '", TemplateID=' + (template.TemplateID || template.PK_ID));
                console.log('[EFE Load] Matched by TemplateID?', matchedByTemplateId);
                console.log('[EFE Load] Room name changed?', template.RoomName !== roomName);
                
                // CRITICAL: If matched by TemplateID and room was renamed, remove the original template first
                if (matchedByTemplateId && template.RoomName !== roomName) {
                  console.log('[EFE Load] *** ROOM WAS RENAMED ***');
                  console.log('[EFE Load] Original template name:', template.RoomName);
                  console.log('[EFE Load] New room name from DB:', roomName);
                  
                  // Room was renamed - remove the original template from roomsToDisplay
                  // CRITICAL FIX: Use the converted number for comparison
                  const originalIndex = roomsToDisplay.findIndex((t: any) => 
                    (t.TemplateID == templateIdNum || t.PK_ID == templateIdNum) && t.RoomName === template.RoomName
                  );
                  console.log('[EFE Load] Looking for original template in roomsToDisplay, found at index:', originalIndex);
                  
                  if (originalIndex >= 0) {
                    console.log('[EFE Load] REMOVING original template:', template.RoomName);
                    roomsToDisplay.splice(originalIndex, 1);
                    console.log('[EFE Load] roomsToDisplay count after removal:', roomsToDisplay.length);
                  } else {
                    console.log('[EFE Load] WARNING: Original template not found in roomsToDisplay!');
                  }
                }
                
                // Add the room with its saved name if not already present
                const existingRoomIndex = roomsToDisplay.findIndex((t: any) => t.RoomName === roomName);
                console.log('[EFE Load] Checking if renamed room already in display list, found at index:', existingRoomIndex);
                
                if (existingRoomIndex >= 0) {
                  // Room already exists in display list - mark it as selected
                  console.log('[EFE Load] Room already in display list, marking as selected:', roomName);
                  roomsToDisplay[existingRoomIndex].selected = true;
                } else {
                  console.log('[EFE Load] ADDING renamed room to display:', roomName);
                  // Create a new template object with the saved room name AND mark as selected
                  const roomToAdd = { ...template, RoomName: roomName, selected: true };
                  roomsToDisplay.push(roomToAdd);
                  console.log('[EFE Load] roomsToDisplay count after adding:', roomsToDisplay.length);
                }
              } else {
                console.log('[EFE Load] ERROR: No template found for this room!');
              }
              console.log('[EFE Load] ===== END PROCESSING ROOM =====');
              
              if (!template) {
                console.warn('[EFE Load] No template found for room:', roomName, 'TemplateID:', templateId);
              }
              
              if (roomName && roomId) {
                console.log('[EFE Load] Marking room as selected:', roomName, 'EFEID:', roomId);
                this.selectedRooms[roomName] = true;
                this.expandedRooms[roomName] = false; // Start collapsed
                this.efeRecordIds[roomName] = roomId;
                console.log('[EFE Load] selectedRooms state:', JSON.stringify(this.selectedRooms));
                
                // Initialize room elevation data if not present
                if (!this.roomElevationData[roomName] && template) {
                  const elevationPoints: any[] = [];
                  
                  // Check for up to 20 point columns
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
                    templateId: template.TemplateID || template.PK_ID, // Use TemplateID field first
                    elevationPoints: elevationPoints,
                    pointCount: template.PointCount || elevationPoints.length,
                    notes: '',
                    fdf: ''
                  };
                }
                
                // Load existing FDF and Notes values if present
                if (this.roomElevationData[roomName]) {
                  if (room.FDF) {
                    this.roomElevationData[roomName].fdf = room.FDF;
                  }
                  if (room.Notes) {
                    this.roomElevationData[roomName].notes = room.Notes;
                  }
                  
                  // Load FDF photos if they exist - fetch as base64 like other photos
                  const fdfPhotos: any = {};
                  
                  if (room.FDFPhotoTop) {
                    fdfPhotos.top = true;
                    fdfPhotos.topPath = room.FDFPhotoTop;
                    // Load caption and drawings from new fields (following measurement photo pattern)
                    fdfPhotos.topCaption = room.FDFTopAnnotation || '';
                    fdfPhotos.topDrawings = room.FDFTopDrawings || null;

                    try {
                      // Fetch the image as base64 data URL
                      const imageData = await this.foundationData.getImage(room.FDFPhotoTop);

                      if (imageData && imageData.startsWith('data:')) {
                        fdfPhotos.topUrl = imageData;
                      } else {
                        // Don't use placeholder, keep the path for on-demand loading
                        console.warn(`[v1.4.427] FDF Top - No base64 data, will fetch on demand`);
                        fdfPhotos.topUrl = null; // Don't set placeholder
                      }
                    } catch (err: any) {
                      console.error(`[v1.4.427] FDF Top - Load error:`, err?.message || err);
                      // Don't use placeholder, keep the path for on-demand loading
                      fdfPhotos.topUrl = null;
                    }
                  }
                  if (room.FDFPhotoBottom) {
                    fdfPhotos.bottom = true;
                    fdfPhotos.bottomPath = room.FDFPhotoBottom;
                    // Load caption and drawings from new fields (following measurement photo pattern)
                    fdfPhotos.bottomCaption = room.FDFBottomAnnotation || '';
                    fdfPhotos.bottomDrawings = room.FDFBottomDrawings || null;

                    try {
                      const imageData = await this.foundationData.getImage(room.FDFPhotoBottom);

                      if (imageData && imageData.startsWith('data:')) {
                        fdfPhotos.bottomUrl = imageData;
                      } else {
                        console.warn(`[v1.4.427] FDF Bottom - No base64 data, will fetch on demand`);
                        fdfPhotos.bottomUrl = null;
                      }
                    } catch (err: any) {
                      console.error(`[v1.4.427] FDF Bottom - Load error:`, err?.message || err);
                      fdfPhotos.bottomUrl = null;
                    }
                  }
                  if (room.FDFPhotoThreshold) {
                    fdfPhotos.threshold = true;
                    fdfPhotos.thresholdPath = room.FDFPhotoThreshold;
                    // Load caption and drawings from new fields (following measurement photo pattern)
                    fdfPhotos.thresholdCaption = room.FDFThresholdAnnotation || '';
                    fdfPhotos.thresholdDrawings = room.FDFThresholdDrawings || null;

                    try {
                      const imageData = await this.foundationData.getImage(room.FDFPhotoThreshold);

                      if (imageData && imageData.startsWith('data:')) {
                        fdfPhotos.thresholdUrl = imageData;
                      } else {
                        console.warn(`[v1.4.427] FDF Threshold - No base64 data, will fetch on demand`);
                        fdfPhotos.thresholdUrl = null;
                      }
                    } catch (err: any) {
                      console.error(`[v1.4.427] FDF Threshold - Load error:`, err?.message || err);
                      fdfPhotos.thresholdUrl = null;
                    }
                  }
                  
                  if (Object.keys(fdfPhotos).length > 0) {
                    this.roomElevationData[roomName].fdfPhotos = fdfPhotos;
                  }
                }
                
                // Load existing room points for this room
                this.loadExistingRoomPoints(roomId, roomName);
              }
            }

            // NOW set roomTemplates with the complete list (auto + saved rooms)
            console.log('[EFE Load] ===== FINAL ROOMS TO DISPLAY =====');
            console.log('[EFE Load] roomsToDisplay count before assignment:', roomsToDisplay.length);
            roomsToDisplay.forEach((room: any, index: number) => {
              console.log(`[EFE Load] Final Room ${index + 1}: RoomName="${room.RoomName}", selected=${room.selected}, TemplateID=${room.TemplateID || room.PK_ID}`);
            });
            console.log('[EFE Load] ===== END FINAL ROOMS =====');
            
            // Sort rooms: checked rooms at the top (alphabetically), then unchecked rooms (alphabetically)
            roomsToDisplay.sort((a: any, b: any) => {
              const aSelected = this.selectedRooms[a.RoomName] || a.selected || false;
              const bSelected = this.selectedRooms[b.RoomName] || b.selected || false;
              
              // If one is selected and the other isn't, selected comes first
              if (aSelected && !bSelected) return -1;
              if (!aSelected && bSelected) return 1;
              
              // Both have same selection state, sort alphabetically by RoomName
              return a.RoomName.localeCompare(b.RoomName);
            });
            
            console.log('[EFE Load] Rooms sorted: checked at top, alphabetically');
            
            this.roomTemplates = roomsToDisplay;
            
            // CRITICAL: Verify and synchronize room.selected with selectedRooms dictionary
            this.roomTemplates.forEach((room: any) => {
              if (this.selectedRooms[room.RoomName]) {
                room.selected = true; // Ensure room object has selected property
                console.log('[EFE Load] Verified room as selected:', room.RoomName);
              }
            });
            
            console.log('[EFE Load] Final roomTemplates count:', this.roomTemplates.length);
            console.log('[EFE Load] Final selectedRooms:', Object.keys(this.selectedRooms));
          } else {
            // No existing rooms - just use auto templates, sorted alphabetically
            baseTemplates.sort((a: any, b: any) => a.RoomName.localeCompare(b.RoomName));
            this.roomTemplates = baseTemplates;
            console.log('[EFE Load] No existing rooms - using auto templates only (sorted alphabetically)');
          }
        } else {
          // No serviceId - just use auto templates, sorted alphabetically
          baseTemplates.sort((a: any, b: any) => a.RoomName.localeCompare(b.RoomName));
          this.roomTemplates = baseTemplates;
          console.log('[EFE Load] No serviceId - using auto templates only (sorted alphabetically)');
        }
      } else {
        this.roomTemplates = [];
        console.log('[EFE Load] No templates available');
      }
    } catch (error: any) {
      console.error('Error loading room templates (non-critical):', error);
      this.roomTemplates = [];
      // Don't reset roomElevationData if it already has data
      if (!this.roomElevationData || Object.keys(this.roomElevationData).length === 0) {
        this.roomElevationData = {};
      }
    }
  }
  
  // Load dropdown options from Services_Drop table
  async loadServicesDropdownOptions() {
    try {
      
      // Set default options first
      this.weatherConditionsOptions = ['Clear', 'Partly Cloudy', 'Cloudy', 'Light Rain', 'Heavy Rain', 'Windy', 'Foggy', 'Other'];
      this.outdoorTemperatureOptions = ['30°F -', '30°F to 60°F', '60°F to 70°F', '70°F to 80°F', '80°F to 90°F', '100°F+', 'Other'];
      this.occupancyFurnishingsOptions = ['Occupied - Furnished', 'Occupied - Unfurnished', 'Vacant - Furnished', 'Vacant - Unfurnished', 'Other'];
      this.inAttendanceOptions = ['Owner', 'Occupant', 'Agent', 'Builder', 'Other'];
      this.firstFoundationTypeOptions = ['Slab on Grade', 'Pier and Beam', 'Basement', 'Crawl Space', 'Other'];
      this.secondFoundationTypeOptions = ['Slab on Grade', 'Pier and Beam', 'Basement', 'Crawl Space', 'None', 'Other'];
      this.thirdFoundationTypeOptions = ['Slab on Grade', 'Pier and Beam', 'Basement', 'Crawl Space', 'None', 'Other'];
      this.secondFoundationRoomsOptions = ['Living Room', 'Kitchen', 'Master Bedroom', 'Bathroom', 'Other'];
      this.thirdFoundationRoomsOptions = ['Living Room', 'Kitchen', 'Master Bedroom', 'Bathroom', 'Other'];
      this.ownerOccupantInterviewOptions = ['Yes', 'No', 'Not Available', 'Other'];
      
      // Load from Services_Drop table
      const servicesDropData = await this.caspioService.getServicesDrop().toPromise();
      
      if (servicesDropData && servicesDropData.length > 0) {
        
        // Group by ServicesName
        const optionsByService: { [serviceName: string]: string[] } = {};
        
        servicesDropData.forEach((row: any) => {
          const serviceName = row.ServicesName || '';
          const dropdown = row.Dropdown || '';
          
          if (serviceName && dropdown) {
            if (!optionsByService[serviceName]) {
              optionsByService[serviceName] = [];
            }
            if (!optionsByService[serviceName].includes(dropdown)) {
              optionsByService[serviceName].push(dropdown);
            }
          }
        });
        
        // Set Weather Conditions options
        if (optionsByService['WeatherConditions'] && optionsByService['WeatherConditions'].length > 0) {
          this.weatherConditionsOptions = optionsByService['WeatherConditions'];
          if (!this.weatherConditionsOptions.includes('Other')) {
            this.weatherConditionsOptions.push('Other');
          }
        }

        // Set Outdoor Temperature options
        if (optionsByService['OutdoorTemperature'] && optionsByService['OutdoorTemperature'].length > 0) {
          this.outdoorTemperatureOptions = optionsByService['OutdoorTemperature'];
          if (!this.outdoorTemperatureOptions.includes('Other')) {
            this.outdoorTemperatureOptions.push('Other');
          }
          
          // Reorder to put "30°F -" first (if it exists)
          const thirtyBelowIndex = this.outdoorTemperatureOptions.findIndex(opt => 
            opt.includes('30') && opt.includes('-') && !opt.includes('to')
          );
          if (thirtyBelowIndex > 0) {
            const thirtyBelowOption = this.outdoorTemperatureOptions.splice(thirtyBelowIndex, 1)[0];
            this.outdoorTemperatureOptions.unshift(thirtyBelowOption);
          }
        }

        // Set Occupancy Furnishings options
        if (optionsByService['OccupancyFurnishings'] && optionsByService['OccupancyFurnishings'].length > 0) {
          this.occupancyFurnishingsOptions = optionsByService['OccupancyFurnishings'];
          if (!this.occupancyFurnishingsOptions.includes('Other')) {
            this.occupancyFurnishingsOptions.push('Other');
          }
        }

        // Set InAttendance options
        if (optionsByService['InAttendance'] && optionsByService['InAttendance'].length > 0) {
          this.inAttendanceOptions = optionsByService['InAttendance'];
          if (!this.inAttendanceOptions.includes('Other')) {
            this.inAttendanceOptions.push('Other');
          }
        }

        // Set FirstFoundationType options
        if (optionsByService['FirstFoundationType'] && optionsByService['FirstFoundationType'].length > 0) {
          this.firstFoundationTypeOptions = optionsByService['FirstFoundationType'];
          if (!this.firstFoundationTypeOptions.includes('Other')) {
            this.firstFoundationTypeOptions.push('Other');
          }
        }

        // Set SecondFoundationType options
        if (optionsByService['SecondFoundationType'] && optionsByService['SecondFoundationType'].length > 0) {
          this.secondFoundationTypeOptions = optionsByService['SecondFoundationType'];
          if (!this.secondFoundationTypeOptions.includes('Other')) {
            this.secondFoundationTypeOptions.push('Other');
          }
        }

        // Set ThirdFoundationType options
        if (optionsByService['ThirdFoundationType'] && optionsByService['ThirdFoundationType'].length > 0) {
          this.thirdFoundationTypeOptions = optionsByService['ThirdFoundationType'];
          if (!this.thirdFoundationTypeOptions.includes('Other')) {
            this.thirdFoundationTypeOptions.push('Other');
          }
        }

        // Set SecondFoundationRooms options
        if (optionsByService['SecondFoundationRooms'] && optionsByService['SecondFoundationRooms'].length > 0) {
          this.secondFoundationRoomsOptions = optionsByService['SecondFoundationRooms'];
          if (!this.secondFoundationRoomsOptions.includes('Other')) {
            this.secondFoundationRoomsOptions.push('Other');
          }
        }

        // Set ThirdFoundationRooms options
        if (optionsByService['ThirdFoundationRooms'] && optionsByService['ThirdFoundationRooms'].length > 0) {
          this.thirdFoundationRoomsOptions = optionsByService['ThirdFoundationRooms'];
          if (!this.thirdFoundationRoomsOptions.includes('Other')) {
            this.thirdFoundationRoomsOptions.push('Other');
          }
        }

        // Set OwnerOccupantInterview options
        if (optionsByService['OwnerOccupantInterview'] && optionsByService['OwnerOccupantInterview'].length > 0) {
          this.ownerOccupantInterviewOptions = optionsByService['OwnerOccupantInterview'];
          if (!this.ownerOccupantInterviewOptions.includes('Other')) {
            this.ownerOccupantInterviewOptions.push('Other');
          }
        }
      }
    } catch (error) {
      console.error('Error loading Services_Drop options:', error);
      // Keep default options on error
    }
  }
  
  // Load FDF options from Services_EFE_Drop table
  async loadFDFOptions() {
    try {
      const dropdownData = await this.caspioService.getServicesEFEDrop().toPromise();
      
      if (dropdownData && dropdownData.length > 0) {
        // Extract unique dropdown values and filter out invalid entries
        const options = dropdownData
          .map((row: any) => row.Dropdown)
          .filter((val: any) => {
            if (!val) return false;
            
            // Filter out concatenated strings (containing multiple values)
            // Valid entries should be short (less than 30 characters typically)
            if (val.length > 50) return false;
            
            // Filter out entries that have multiple quotes or multiple parentheses
            const quoteCount = (val.match(/"/g) || []).length;
            if (quoteCount > 2) return false; // Valid entries like +0.4" have max 1 quote
            
            return true;
          });
        
        // Sort with special ordering
        this.fdfOptions = options.sort((a: string, b: string) => {
          // "Same Elevation (0.0)" always first
          if (a.includes('Same Elevation') && a.includes('0.0')) return -1;
          if (b.includes('Same Elevation') && b.includes('0.0')) return 1;
          
          // "Same Flooring (0.0)" always second
          if (a.includes('Same Flooring') && a.includes('0.0')) return -1;
          if (b.includes('Same Flooring') && b.includes('0.0')) return 1;
          
          // Extract numbers from strings for numerical sorting
          const numA = parseFloat(a.match(/[\d.]+/)?.[0] || '999');
          const numB = parseFloat(b.match(/[\d.]+/)?.[0] || '999');
          
          // Sort by numbers in ascending order
          return numA - numB;
        });
      } else {
        // Fallback to hardcoded options if database is empty
        this.fdfOptions = [
          'Same Elevation (0.0)',
          'Same Flooring (0.0)',
          'None',
          '1/4"',
          '1/2"',
          '3/4"',
          '1"',
          '1.25"',
          '1.5"',
          '2"',
          'Other'
        ];
      }
    } catch (error) {
      console.error('Error loading FDF options:', error);
      // Use fallback options on error
      this.fdfOptions = [
        'Same Elevation (0.0)',
        'Same Flooring (0.0)',
        'None',
        '1/4"',
        '1/2"',
        '3/4"',
        '1"',
        '1.25"',
        '1.5"',
        '2"',
        'Other'
      ];
    }
  }
  
  // Load dropdown options for visual templates from Services_Visuals_Drop table
  async loadVisualDropdownOptions() {
    try {
      const dropdownData = await this.caspioService.getServicesVisualsDrop().toPromise();
      
      console.log('[Dropdown Options] Loaded dropdown data:', dropdownData?.length || 0, 'rows');
      
      if (dropdownData && dropdownData.length > 0) {
        // Group dropdown options by TemplateID
        dropdownData.forEach((row: any) => {
          const templateId = String(row.TemplateID); // Convert to string for consistency
          const dropdownValue = row.Dropdown;
          
          if (templateId && dropdownValue) {
            if (!this.visualDropdownOptions[templateId]) {
              this.visualDropdownOptions[templateId] = [];
            }
            // Add unique dropdown values for this template
            if (!this.visualDropdownOptions[templateId].includes(dropdownValue)) {
              this.visualDropdownOptions[templateId].push(dropdownValue);
            }
          }
        });
        
        console.log('[Dropdown Options] Grouped by TemplateID:', Object.keys(this.visualDropdownOptions).length, 'templates have options');
        
        // Log details about what dropdown options are available for each TemplateID
        Object.entries(this.visualDropdownOptions).forEach(([templateId, options]) => {
          // Add "Other" option to all multi-select dropdowns if not already present
          const optionsArray = options as string[];
          if (!optionsArray.includes('Other')) {
            optionsArray.push('Other');
          }
          console.log(`[Dropdown Options] TemplateID ${templateId}: ${optionsArray.length} options -`, optionsArray.join(', '));
        });
      } else {
        console.warn('[Dropdown Options] No dropdown data received from API');
      }
    } catch (error) {
      console.error('[Dropdown Options] Error loading dropdown options:', error);
      // Continue without dropdown options - they're optional
    }
  }
  
  // Load project dropdown options from Projects_Drop table
  async loadProjectDropdownOptions() {
    try {
      const dropdownData = await this.caspioService.getProjectsDrop().toPromise();
      
      if (dropdownData && dropdownData.length > 0) {
        // Initialize arrays for each field type
        const typeOfBuildingSet = new Set<string>();
        const styleSet = new Set<string>();
        
        // Process each row
        dropdownData.forEach((row: any) => {
          if (row.ProjectsName === 'TypeOfBuilding' && row.Dropdown) {
            typeOfBuildingSet.add(row.Dropdown);
          } else if (row.ProjectsName === 'Style' && row.Dropdown) {
            styleSet.add(row.Dropdown);
          }
        });
        
        // Convert sets to arrays (removes duplicates automatically)
        this.typeOfBuildingOptions = Array.from(typeOfBuildingSet).sort();
        this.styleOptions = Array.from(styleSet).sort();

        // Add "Other" option to all dropdown arrays
        if (!this.typeOfBuildingOptions.includes('Other')) {
          this.typeOfBuildingOptions.push('Other');
        }
        if (!this.styleOptions.includes('Other')) {
          this.styleOptions.push('Other');
        }

        // Add default options if none found in database
        if (this.typeOfBuildingOptions.length === 0) {
          this.typeOfBuildingOptions = ['Single Family', 'Multi-Family', 'Commercial', 'Industrial', 'Other'];
        }
        if (this.styleOptions.length === 0) {
          this.styleOptions = ['Ranch', 'Two Story', 'Split Level', 'Bi-Level', 'Tri-Level', 'Other'];
        }
      }
    } catch (error) {
      console.error('Error loading project dropdown options:', error);
      // Set default options on error
      this.typeOfBuildingOptions = ['Single Family', 'Multi-Family', 'Commercial', 'Industrial', 'Other'];
      this.styleOptions = ['Ranch', 'Two Story', 'Split Level', 'Bi-Level', 'Tri-Level', 'Other'];
    }
  }
  
  // Get FDF options for a specific room
  getFDFOptionsForRoom(roomName: string): string[] {
    // Always return the same hardcoded options for all rooms
    return [...this.fdfOptions];
  }
  
  // Handle FDF selection change
  async onFDFChange(roomName: string) {
    const roomId = this.efeRecordIds[roomName];
    if (!roomId) {
      await this.showToast('Room must be saved first', 'warning');
      return;
    }

    try {
      const fdfValue = this.roomElevationData[roomName].fdf;

      // If "Other" is selected, show popup to enter custom value
      if (fdfValue === 'Other') {
        const previousValue = this.customOtherValues['FDF_' + roomName] || '';
        await this.showFDFOtherPopup(roomName, previousValue);
        return;
      }

      // Update Services_EFE record with FDF value using EFEID field
      const updateData = { FDF: fdfValue };
      const query = `EFEID=${roomId}`;

      await this.caspioService.put(`/tables/Services_EFE/records?q.where=${encodeURIComponent(query)}`, updateData).toPromise();
    } catch (error) {
      console.error('Error updating FDF:', error);
      await this.showToast('Failed to update FDF', 'danger');
    }

    this.loadCustomValuesIntoDropdowns();
  }

  // Show popup for FDF "Other" custom value
  async showFDFOtherPopup(roomName: string, previousValue?: string): Promise<void> {
    const alert = await this.alertController.create({
      header: `FDF for ${roomName}`,
      message: 'Please enter a custom FDF value:',
      inputs: [
        {
          name: 'customValue',
          type: 'text',
          placeholder: 'Enter custom FDF value...',
          value: previousValue || ''
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          handler: () => {
            // Revert dropdown to previous value if they cancel
            this.roomElevationData[roomName].fdf = previousValue || '';
          }
        },
        {
          text: 'Save',
          handler: async (data) => {
            const customValue = data.customValue?.trim();

            if (!customValue) {
              // If empty, revert to previous value
              this.roomElevationData[roomName].fdf = previousValue || '';
              return;
            }

            const roomId = this.efeRecordIds[roomName];
            if (!roomId) {
              await this.showToast('Room must be saved first', 'warning');
              return;
            }

            try {

              // Store in customOtherValues
              this.customOtherValues['FDF_' + roomName] = customValue;

              // Add custom value to FDF options if not already there
              if (!this.fdfOptions.includes(customValue)) {
                const otherIndex = this.fdfOptions.indexOf('Other');
                if (otherIndex > -1) {
                  this.fdfOptions.splice(otherIndex, 0, customValue);
                } else {
                  this.fdfOptions.push(customValue);
                }
              }

              // Update Services_EFE record with custom FDF value
              const updateData = { FDF: customValue };
              const query = `EFEID=${roomId}`;

              await this.caspioService.put(`/tables/Services_EFE/records?q.where=${encodeURIComponent(query)}`, updateData).toPromise();

              // Update local data - this will now show the custom value in the dropdown
              this.roomElevationData[roomName].fdf = customValue;

              // Force change detection to update the UI
              this.changeDetectorRef.detectChanges();
            } catch (error) {
              console.error('Error updating custom FDF:', error);
              await this.showToast('Failed to update FDF', 'danger');
            }
          }
        }
      ]
    });

    await alert.present();
  }

  // Handle taking FDF photos (Top, Bottom, Threshold) - using file input like room points
  async takeFDFPhoto(roomName: string, photoType: 'Top' | 'Bottom' | 'Threshold', source: 'camera' | 'library' | 'system' = 'system') {
    const roomId = this.efeRecordIds[roomName];
    if (!roomId) {
      await this.showToast('Please save the room first', 'warning');
      return;
    }

    try {
      // Set context for FDF photo
      this.currentFDFPhotoContext = {
        roomName,
        photoType,
        roomId
      };

      this.triggerFileInput(source, { allowMultiple: false });

    } catch (error) {
      console.error(`Error initiating FDF ${photoType} photo:`, error);
      await this.showToast(`Failed to initiate ${photoType} photo`, 'danger');
      this.currentFDFPhotoContext = null;
    }
  }
  
  // Process FDF photo after file selection
  async processFDFPhoto(file: File) {
    if (!this.currentFDFPhotoContext) {
      console.error('No FDF photo context');
      return;
    }
    
    const { roomName, photoType, roomId } = this.currentFDFPhotoContext;
    const photoKey = photoType.toLowerCase();
    
    try {
      // Initialize fdfPhotos structure if needed
      if (!this.roomElevationData[roomName].fdfPhotos) {
        this.roomElevationData[roomName].fdfPhotos = {};
      }
      
      // Set uploading flag to show loading spinner
      this.roomElevationData[roomName].fdfPhotos[`${photoKey}Uploading`] = true;
      
      // Compress the image if needed
      const compressedFile = await this.imageCompression.compressImage(file);
      
      // Create a blob URL from the compressed file for immediate display preview
      const blobUrl = URL.createObjectURL(compressedFile);
      this.roomElevationData[roomName].fdfPhotos[photoKey] = true;
      this.roomElevationData[roomName].fdfPhotos[`${photoKey}Url`] = blobUrl;
      
      // Trigger change detection to show preview with loading spinner
      this.changeDetectorRef.detectChanges();
      
      // Upload to Caspio Files API
      const uploadFormData = new FormData();
      const fileName = `FDF_${photoType}_${roomName}_${Date.now()}.jpg`;
      uploadFormData.append('file', compressedFile, fileName);
      
      const token = await firstValueFrom(this.caspioService.getValidToken());
      const account = this.caspioService.getAccountID();
      
      const uploadResponse = await fetch(`https://${account}.caspio.com/rest/v2/files`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: uploadFormData
      });
      
      const uploadResult = await uploadResponse.json();

      // [v1.4.402] FDF Photo Fix: Handle API response structure properly
      // The Files API returns {"Name": "filename.jpg"} or {"Result": {"Name": "filename.jpg"}}
      const uploadedFileName = uploadResult.Name || uploadResult.Result?.Name || fileName;
      const filePath = `/${uploadedFileName}`;
      
      // Update the appropriate column in Services_EFE
      const columnName = `FDFPhoto${photoType}`;
      const updateData: any = {};
      updateData[columnName] = filePath;
      
      const query = `EFEID=${roomId}`;
      await this.caspioService.put(`/tables/Services_EFE/records?q.where=${encodeURIComponent(query)}`, updateData).toPromise();
      
      // Store the photo data in local state
      this.roomElevationData[roomName].fdfPhotos[`${photoKey}Path`] = filePath;
      
      // Initialize caption and drawings fields for new photos (following measurement photo pattern)
      this.roomElevationData[roomName].fdfPhotos[`${photoKey}Caption`] = '';
      this.roomElevationData[roomName].fdfPhotos[`${photoKey}Drawings`] = null;

      // Then try to load from Caspio for permanent storage
      try {
        const imageData = await this.caspioService.getImageFromFilesAPI(filePath).toPromise();
        if (imageData && imageData.startsWith('data:')) {
          // Replace blob URL with base64 for permanent storage
          this.roomElevationData[roomName].fdfPhotos[`${photoKey}Url`] = imageData;

          // Revoke the blob URL since we have base64 now
          URL.revokeObjectURL(blobUrl);
        } else {
          console.warn(`[v1.4.421] FDF ${photoType} - Invalid base64 data, keeping blob URL`);
        }
      } catch (err) {
        console.error(`[v1.4.421] FDF ${photoType} - Error loading base64, keeping blob URL:`, err);
        // Keep the blob URL since base64 failed
      }
      
      // Clear uploading flag - upload complete
      this.roomElevationData[roomName].fdfPhotos[`${photoKey}Uploading`] = false;
      
      // Trigger change detection to hide loading spinner
      this.changeDetectorRef.detectChanges();

    } catch (error: any) {
      console.error(`[v1.4.402] Error processing FDF ${photoType} photo:`, error);
      const errorMsg = error?.message || error?.toString() || 'Unknown error';
      await this.showToast(`Failed to save FDF ${photoType} photo: ${errorMsg}`, 'danger');
      
      // Clear uploading flag on error
      if (this.roomElevationData[roomName]?.fdfPhotos) {
        this.roomElevationData[roomName].fdfPhotos[`${photoKey}Uploading`] = false;
        // Also clear the photo if upload failed
        delete this.roomElevationData[roomName].fdfPhotos[photoKey];
        delete this.roomElevationData[roomName].fdfPhotos[`${photoKey}Url`];
      }
      
      // Trigger change detection to update UI
      this.changeDetectorRef.detectChanges();
    } finally {
      // Clear context
      this.currentFDFPhotoContext = null;
    }
  }
  
  // View FDF photo in a simple modal
  async viewFDFPhoto(roomName: string, photoType: 'Top' | 'Bottom' | 'Threshold') {
    try {
      const viewableUrl = await this.resolveFdfPhotoUrl(roomName, photoType);

      if (!viewableUrl) {
        console.warn(`[FDF Photos] No viewable URL for ${roomName} ${photoType}`);
        await this.showToast('Photo not available', 'warning');
        return;
      }

      const modal = await this.modalController.create({
        component: PhotoViewerComponent,
        componentProps: {
          photoUrl: viewableUrl,
          photoName: `FDF ${photoType} - ${roomName}`,
          canAnnotate: false,
          photoData: null,
          photoCaption: '',
          enableCaption: false
        },
        cssClass: 'photo-viewer-modal'
      });

      await modal.present();
    } catch (error) {
      console.error(`[FDF Photos] Error opening photo viewer for ${roomName} ${photoType}:`, error);
      await this.showToast('Failed to open photo viewer', 'danger');
    }
  }

  private async resolveFdfPhotoUrl(roomName: string, photoType: 'Top' | 'Bottom' | 'Threshold'): Promise<string | null> {
    const roomData = this.roomElevationData[roomName];
    const photoKey = photoType.toLowerCase();

    if (!roomData?.fdfPhotos || !roomData.fdfPhotos[photoKey]) {
      return null;
    }

    const fdfPhotos = roomData.fdfPhotos;
    const storedUrl = fdfPhotos[`${photoKey}Url`];

    if (storedUrl && !storedUrl.includes('photo-placeholder.png') && !storedUrl.startsWith('blob:')) {
      return storedUrl;
    }

    const columnName = `FDFPhoto${photoType}`;
    let photoPath: string | null = fdfPhotos[`${photoKey}Path`] || null;

    if (!photoPath) {
      const roomId = this.efeRecordIds[roomName];
      if (roomId) {
        try {
          const rooms = await firstValueFrom(this.caspioService.getServicesEFE(this.serviceId));
          const numericRoomId = Number(roomId);
          const roomRecord = rooms?.find((room: any) => Number(room.EFEID) === numericRoomId);

          if (roomRecord?.[columnName]) {
            photoPath = roomRecord[columnName];
            fdfPhotos[`${photoKey}Path`] = photoPath;
          }
        } catch (error) {
          console.error(`[FDF Photos] Failed to load Services_EFE data for ${roomName}:`, error);
        }
      }
    }

    if (!photoPath || photoPath === '/undefined') {
      return null;
    }

    const normalizedPath = photoPath.startsWith('/') ? photoPath : `/${photoPath}`;

    try {
      const imageData = await firstValueFrom(this.caspioService.getImageFromFilesAPI(normalizedPath));
      if (imageData && imageData.startsWith('data:')) {
        fdfPhotos[`${photoKey}Url`] = imageData;
        return imageData;
      }
    } catch (error) {
      console.error(`[FDF Photos] Base64 fetch failed for ${roomName} ${photoType}:`, error);
    }

    try {
      const token = await firstValueFrom(this.caspioService.getValidToken());
      const account = this.caspioService.getAccountID();
      const fallbackUrl = `https://${account}.caspio.com/rest/v2/files${normalizedPath}?access_token=${token}`;
      fdfPhotos[`${photoKey}Url`] = fallbackUrl;
      return fallbackUrl;
    } catch (tokenError) {
      console.error(`[FDF Photos] Fallback URL creation failed for ${roomName} ${photoType}:`, tokenError);
    }

    return null;
  }

  // Annotate FDF photo (opens photo annotator like Structural Systems)
  async annotateFDFPhoto(roomName: string, photoType: 'Top' | 'Bottom' | 'Threshold') {
    try {
      const viewableUrl = await this.resolveFdfPhotoUrl(roomName, photoType);

      if (!viewableUrl) {
        console.warn(`[FDF Photos] No viewable URL for ${roomName} ${photoType}`);
        await this.showToast('Photo not available', 'warning');
        return;
      }

      const photoKey = photoType.toLowerCase();
      const roomData = this.roomElevationData[roomName];
      const fdfPhotos = roomData?.fdfPhotos || {};

      // Get any existing annotations from multiple sources (like measurement photos)
      let existingAnnotations = null;
      const drawingsData = fdfPhotos[`${photoKey}Drawings`];
      const attachId = fdfPhotos[`${photoKey}AttachId`];
      
      console.log(`[FDF DEBUG] Loading annotations for ${roomName} ${photoType}`);
      console.log(`[FDF DEBUG] Drawings data:`, drawingsData);
      console.log(`[FDF DEBUG] AttachID:`, attachId);
      
      // Try to load annotations from different sources
      const annotationSources = [
        drawingsData,
        fdfPhotos[`${photoKey}Annotations`],
        fdfPhotos[`${photoKey}AnnotationsData`]
      ];
      
      for (const source of annotationSources) {
        if (source) {
          try {
            if (typeof source === 'string') {
              existingAnnotations = decompressAnnotationData(source);
            } else {
              existingAnnotations = source;
            }
            
            if (existingAnnotations) {
              console.log(`[FDF DEBUG] Loaded existing annotations:`, existingAnnotations);
              break;
            }
          } catch (e) {
            console.error(`[FDF DEBUG] Failed to decompress annotations from source:`, e);
          }
        }
      }

      // Get existing caption for this FDF photo
      const existingCaption = this.getFdfPhotoCaption(roomName, photoType);
      console.log(`[FDF DEBUG] Existing caption for ${photoType}:`, existingCaption);

      // Open annotation modal
      const modal = await this.modalController.create({
        component: FabricPhotoAnnotatorComponent,
        componentProps: {
          imageUrl: viewableUrl,
          existingAnnotations: existingAnnotations,
          existingCaption: existingCaption || '', // CRITICAL: Pass existing caption to photo editor
          photoData: {
            name: `FDF ${photoType} - ${roomName}`,
            roomName: roomName,
            photoType: photoType,
            caption: existingCaption || '' // Also include in photoData
          },
          isReEdit: !!existingAnnotations
        },
        cssClass: 'fullscreen-modal'
      });

      await modal.present();

      // Handle annotated photo returned from annotator
      const { data } = await modal.onDidDismiss();

      if (data && data.annotatedBlob) {
        // Get annotation data
        let annotationsData = data.annotationData || data.annotationsData;

        // Store annotations in local data (following measurement photo pattern)
        if (annotationsData) {
          const compressedAnnotations = compressAnnotationData(annotationsData);
          const drawingsField = `${photoKey}Drawings`;
          fdfPhotos[drawingsField] = compressedAnnotations; // Store in local drawings field
        }

        console.log(`[FDF DEBUG] Starting annotation save for ${roomName} ${photoType}`);
        console.log(`[FDF DEBUG] Annotations data:`, annotationsData);
        console.log(`[FDF DEBUG] AttachID available:`, attachId);

        // ENHANCED: Use attachment-based approach if AttachID exists (like measurement photos)
        if (attachId) {
          console.log(`[FDF DEBUG] Using attachment-based approach with AttachID:`, attachId);
          try {
            const annotatedFile = new File([data.annotatedBlob], `FDF_${photoType}_${roomName}`, { type: 'image/jpeg' });
            
            // Get the original file if provided  
            let originalFile = null;
            if (data.originalBlob) {
              originalFile = data.originalBlob instanceof File 
                ? data.originalBlob 
                : new File([data.originalBlob], `original_FDF_${photoType}_${roomName}`, { type: 'image/jpeg' });
            }

            // Use the same method as measurement photos
            await this.updatePhotoAttachment(attachId, annotatedFile, annotationsData, originalFile, data.caption);
            console.log(`[FDF DEBUG] Successfully saved using attachment method`);
            
            // CRITICAL: Update local display to show annotated image and caption
            this.updateFdfPhotoDisplay(roomName, photoType, data.annotatedBlob, annotationsData, data.caption);
            
            await this.showToast('Annotation saved', 'success');
            return; // Exit early since we successfully saved
          } catch (error) {
            console.error(`[FDF DEBUG] Attachment method failed, falling back to Services_EFE:`, error);
            // Continue to Services_EFE approach below
          }
        }

        // FALLBACK: Update the FDF photo in Services_EFE table
        const roomId = this.efeRecordIds[roomName];
        console.log(`[FDF DEBUG] Using Services_EFE approach`);
        console.log(`[FDF DEBUG] Room ID:`, roomId);
        
        if (roomId) {
          try {
            // Compress annotations before saving
            const compressedAnnotations = annotationsData ? compressAnnotationData(annotationsData) : null;
            console.log(`[FDF DEBUG] Compressed annotations:`, compressedAnnotations);

            // Update database with photo and annotations using correct column names
            const updateData: any = {};
            const drawingsColumnName = `FDF${photoType}Drawings`; // FIXED: Correct column name format
            const annotationColumnName = `FDF${photoType}Annotation`; // ADDED: For captions
            
            console.log(`[FDF SAVE DEBUG] PhotoType received:`, photoType);
            console.log(`[FDF SAVE DEBUG] Generated Drawings column:`, drawingsColumnName);
            console.log(`[FDF SAVE DEBUG] Generated Annotation column:`, annotationColumnName);
            console.log(`[FDF SAVE DEBUG] Expected: FDFBottomDrawings and FDFBottomAnnotation for Bottom`);
            
            // Save annotation graphics to Drawings field (like measurement photos)
            if (compressedAnnotations) {
              updateData[drawingsColumnName] = compressedAnnotations;
              console.log(`[FDF SAVE DEBUG] Added drawings to update data`);
            }
            
            // ADDED: Save caption to Annotation field  
            // Use caption from photo editor if available, otherwise use current local state
            const captionToSave = data.caption !== undefined ? data.caption : this.getFdfPhotoCaption(roomName, photoType);
            if (captionToSave !== undefined) {
              updateData[annotationColumnName] = captionToSave;
              console.log(`[FDF SAVE DEBUG] Saving caption to database:`, captionToSave);
            }

            console.log(`[FDF SAVE DEBUG] Final update data:`, JSON.stringify(updateData, null, 2));
            console.log(`[FDF SAVE DEBUG] Room ID for update:`, roomId);

            // Try to update Services_EFE table with FDF annotation data
            try {
              const result = await this.caspioService.updateServicesEFEByEFEID(roomId, updateData).toPromise();
              console.log(`[FDF DEBUG] Update result:`, result);

              // CRITICAL: Update local display to show annotated image and caption
              this.updateFdfPhotoDisplay(roomName, photoType, data.annotatedBlob, annotationsData, data.caption);

              // Mark that changes have been made (enables Update button)
              this.markReportChanged();

              await this.showToast('Annotation saved', 'success');
            } catch (updateError) {
              console.error(`[FDF DEBUG] Services_EFE update failed:`, updateError);
              
              // FALLBACK: Try to store FDF photo as attachment and use updatePhotoAttachment
              console.log(`[FDF DEBUG] Attempting fallback: Create attachment record for FDF photo`);
              
              try {
                // Check if FDF photo has an attachment ID we can use
                const photoKey = photoType.toLowerCase();
                const photoPath = fdfPhotos[`${photoKey}Path`];
                
                if (photoPath) {
                  // Create an attachment record for the FDF photo so we can store annotations
                  const attachmentData = {
                    ServiceID: this.serviceId,
                    TypeID: 7, // FDF photos type
                    Attachment: photoPath,
                    Link: `FDF ${photoType} - ${roomName}`,
                    Annotation: compressedAnnotations || ''
                  };
                  
                  console.log(`[FDF DEBUG] Creating attachment record:`, attachmentData);
                  const attachResult = await this.caspioService.createAttachment(attachmentData).toPromise();
                  console.log(`[FDF DEBUG] Attachment created:`, attachResult);
                  
                  // Store the AttachID for future reference
                  const attachId = attachResult?.Result?.[0]?.AttachID || attachResult?.AttachID;
                  if (attachId) {
                    fdfPhotos[`${photoKey}AttachId`] = attachId;
                    console.log(`[FDF DEBUG] Stored AttachID for future use:`, attachId);
                  }
                  
                  // CRITICAL: Update local display to show annotated image and caption
                  this.updateFdfPhotoDisplay(roomName, photoType, data.annotatedBlob, annotationsData, data.caption);
                  
                  await this.showToast('Annotation saved (fallback method)', 'success');
                } else {
                  throw new Error('No photo path available for fallback');
                }
              } catch (fallbackError) {
                console.error(`[FDF DEBUG] Fallback method also failed:`, fallbackError);
                await this.showToast('Failed to save annotation - please try again', 'danger');
              }
            }
          } catch (error) {
            console.error('[FDF DEBUG] Error saving FDF annotation:', error);
            console.error('[FDF DEBUG] Error details:', JSON.stringify(error, null, 2));
            await this.showToast('Failed to save annotation', 'danger');
          }
        } else {
          console.error(`[FDF DEBUG] No room ID found for room: ${roomName}`);
          console.error(`[FDF DEBUG] Available room IDs:`, this.efeRecordIds);
        }
      }
    } catch (error) {
      console.error(`[FDF Photos] Error opening annotator for ${roomName} ${photoType}:`, error);
      await this.showToast('Failed to open annotator', 'danger');
    }
  }

  // Delete FDF photo
  async deleteFDFPhoto(roomName: string, photoType: 'Top' | 'Bottom' | 'Threshold', event: Event) {
    event.stopPropagation();
    
    const alert = await this.alertController.create({
      header: 'Delete Photo',
      message: `Are you sure you want to delete the ${photoType} photo?`,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          cssClass: 'alert-button-cancel'
        },
        {
          text: 'Delete',
          cssClass: 'alert-button-confirm',
          handler: async () => {
            try {
              const roomId = this.efeRecordIds[roomName];
              if (roomId) {
                // Clear the photo, annotation, and drawings columns in Services_EFE (following measurement photo pattern)
                const columnName = `FDFPhoto${photoType}`;
                const annotationColumnName = `FDFPhoto${photoType}Annotation`;
                const drawingsColumnName = `FDFPhoto${photoType}Drawings`;
                
                const updateData: any = {};
                updateData[columnName] = null; // Clear photo path
                updateData[annotationColumnName] = null; // Clear caption
                updateData[drawingsColumnName] = null; // Clear annotation graphics
                
                await this.caspioService.updateServicesEFEByEFEID(roomId, updateData).toPromise();
              }
              
              // Clear from local state (including caption, path, and drawings)
              const photoKey = photoType.toLowerCase();
              if (this.roomElevationData[roomName]?.fdfPhotos) {
                delete this.roomElevationData[roomName].fdfPhotos[photoKey];
                delete this.roomElevationData[roomName].fdfPhotos[`${photoKey}Path`];
                delete this.roomElevationData[roomName].fdfPhotos[`${photoKey}Url`];
                delete this.roomElevationData[roomName].fdfPhotos[`${photoKey}Caption`]; // Clear caption
                delete this.roomElevationData[roomName].fdfPhotos[`${photoKey}Drawings`]; // Clear drawings
              }

              // No success toast - silent delete
            } catch (error) {
              console.error(`Error deleting FDF ${photoType} photo:`, error);
              await this.showToast(`Failed to delete ${photoType} photo`, 'danger');
            }
          }
        }
      ],
      cssClass: 'custom-document-alert'
    });
    
    await alert.present();
  }
  
  // Handle elevation value change for a point
  async onElevationChange(roomName: string, point: any) {
    try {
      // Save the elevation value to the database
      const pointKey = `${roomName}_${point.name}`;
      const pointId = this.efePointIds[pointKey];
      
      if (pointId) {
        const updateData = {
          Elevation: point.elevation || 0
        };
        
        await this.caspioService.updateServicesEFEPoint(pointId, updateData).toPromise();
      }
    } catch (error) {
      console.error('Error updating elevation:', error);
      await this.showToast('Failed to update elevation', 'danger');
    }
  }
  
  // Delete an elevation point
  async deleteElevationPoint(roomName: string, point: any) {
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
          role: 'destructive',
          handler: async () => {
            try {
              const pointKey = `${roomName}_${point.name}`;
              const pointId = this.efePointIds[pointKey];

              // Delete all associated photos first
              if (point.photos && point.photos.length > 0) {
                console.log(`[Delete Point] Deleting ${point.photos.length} photos for point ${point.name}`);
                for (const photo of point.photos) {
                  if (photo.attachId) {
                    try {
                      await this.caspioService.deleteServicesEFEPointsAttach(photo.attachId).toPromise();
                      console.log(`[Delete Point] Deleted photo with attachId ${photo.attachId}`);
                    } catch (photoError) {
                      console.error(`[Delete Point] Failed to delete photo ${photo.attachId}:`, photoError);
                      // Continue deleting other photos even if one fails
                    }
                  }
                }
              }

              // Delete point from Services_EFE_Points table
              if (pointId && pointId !== '__pending__') {
                await this.caspioService.deleteServicesEFEPoint(pointId).toPromise();
                delete this.efePointIds[pointKey];
                console.log(`[Delete Point] Deleted point ${point.name} with ID ${pointId}`);
              }

              // Remove from local data
              if (this.roomElevationData[roomName]?.elevationPoints) {
                const index = this.roomElevationData[roomName].elevationPoints.findIndex(
                  (p: any) => p.name === point.name
                );
                if (index > -1) {
                  this.roomElevationData[roomName].elevationPoints.splice(index, 1);
                }
              }

              // Trigger change detection to update the view
              this.changeDetectorRef.detectChanges();

              await this.showToast('Point deleted', 'success');
            } catch (error) {
              console.error('Error deleting point:', error);
              await this.showToast('Failed to delete point', 'danger');
            }
          }
        }
      ]
    });

    await alert.present();
  }
  
  // Ensure FDF photos structure exists for a room
  private ensureFdfPhotosStructure(roomName: string): void {
    if (!this.roomElevationData[roomName]) {
      this.roomElevationData[roomName] = {};
    }
    if (!this.roomElevationData[roomName].fdfPhotos) {
      this.roomElevationData[roomName].fdfPhotos = {};
    }
  }

  // Get FDF photo caption with structure initialization
  getFdfPhotoCaption(roomName: string, photoType: 'Top' | 'Bottom' | 'Threshold'): string {
    this.ensureFdfPhotosStructure(roomName);
    const photoKey = photoType.toLowerCase() + 'Caption';
    return this.roomElevationData[roomName].fdfPhotos[photoKey] || '';
  }

  // Set FDF photo caption with structure initialization
  setFdfPhotoCaption(roomName: string, photoType: 'Top' | 'Bottom' | 'Threshold', value: string): void {
    this.ensureFdfPhotosStructure(roomName);
    const photoKey = photoType.toLowerCase() + 'Caption';
    this.roomElevationData[roomName].fdfPhotos[photoKey] = value;
  }

  // Update FDF photo display to show annotated image (like measurement photos)
  private updateFdfPhotoDisplay(roomName: string, photoType: 'Top' | 'Bottom' | 'Threshold', annotatedBlob: Blob, annotationsData?: any, caption?: string): void {
    console.log(`[FDF DEBUG] Updating display for ${roomName} ${photoType}`);
    console.log(`[FDF DEBUG] Caption from editor:`, caption);
    
    this.ensureFdfPhotosStructure(roomName);
    const photoKey = photoType.toLowerCase();
    const fdfPhotos = this.roomElevationData[roomName].fdfPhotos;
    
    // Store original URL if not already stored
    const currentUrl = fdfPhotos[`${photoKey}Url`];
    if (currentUrl && !fdfPhotos[`${photoKey}OriginalUrl`]) {
      fdfPhotos[`${photoKey}OriginalUrl`] = currentUrl;
      console.log(`[FDF DEBUG] Stored original URL for ${photoType}`);
    }
    
    // Create blob URL for annotated image
    const annotatedUrl = URL.createObjectURL(annotatedBlob);
    console.log(`[FDF DEBUG] Created annotated URL: ${annotatedUrl}`);
    
    // Update display URLs to show annotated version
    fdfPhotos[`${photoKey}Url`] = annotatedUrl;
    fdfPhotos[`${photoKey}DisplayUrl`] = annotatedUrl;
    fdfPhotos[`${photoKey}HasAnnotations`] = true;
    
    // CRITICAL: Update caption from photo editor
    if (caption !== undefined) {
      const captionKey = `${photoKey}Caption`;
      fdfPhotos[captionKey] = caption;
      console.log(`[FDF DEBUG] Updated caption for ${photoType}:`, caption);
    }
    
    // Store annotations data locally
    if (annotationsData) {
      fdfPhotos[`${photoKey}Annotations`] = annotationsData;
      fdfPhotos[`${photoKey}DrawingsData`] = typeof annotationsData === 'object' 
        ? JSON.stringify(annotationsData) 
        : annotationsData;
    }
    
    console.log(`[FDF DEBUG] Updated FDF photo display for ${roomName} ${photoType}`);
    
    // Force change detection to update UI immediately
    this.changeDetectorRef.detectChanges();
    
    // Additional UI update after slight delay
    setTimeout(() => {
      this.changeDetectorRef.detectChanges();
      console.log(`[FDF DEBUG] Forced UI update for ${roomName} ${photoType}`);
    }, 100);
  }

  // Calculate maximum elevation differential for a room
  getRoomMaxDifferential(roomName: string): number | null {
    const roomData = this.roomElevationData[roomName];
    if (!roomData || !roomData.elevationPoints || roomData.elevationPoints.length === 0) {
      return null;
    }
    
    const elevations = roomData.elevationPoints
      .map((p: any) => p.elevation)
      .filter((e: any) => e !== null && e !== undefined && !isNaN(e));
    
    if (elevations.length === 0) {
      return null;
    }
    
    const max = Math.max(...elevations);
    const min = Math.min(...elevations);
    return max - min;
  }
  
  // Get a specific photo by type (Location or Measurement) for a point
  // PERFORMANCE NOTE: No caching needed - find() on 1-2 photo array is already ultra-fast
  getPointPhotoByType(point: any, photoType: 'Location' | 'Measurement'): any {
    if (!point.photos || point.photos.length === 0) {
      return null;
    }
    
    // Look for photo with matching photoType property (new) or annotation prefix (legacy)
    const typedPhoto = point.photos.find((photo: any) => 
      (photo.photoType === photoType) ||
      (photo.annotation && photo.annotation.startsWith(`${photoType}:`))
    );
    
    if (typedPhoto) {
      return typedPhoto;
    }
    
    // Backward compatibility: For existing photos without type prefix or photoType property
    // First photo without prefix = Location, second = Measurement
    const untypedPhotos = point.photos.filter((photo: any) => 
      !photo.photoType && (!photo.annotation || (!photo.annotation.startsWith('Location:') && !photo.annotation.startsWith('Measurement:')))
    );
    
    if (untypedPhotos.length > 0) {
      if (photoType === 'Location') {
        return untypedPhotos[0];
      } else if (photoType === 'Measurement' && untypedPhotos.length > 1) {
        return untypedPhotos[1];
      }
    }
    
    return null;
  }

  // Capture photo for room elevation point with specific type (Location or Measurement)
  async capturePointPhoto(roomName: string, point: any, photoType: 'Location' | 'Measurement', event?: Event, source: 'camera' | 'library' | 'system' = 'system') {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }

    try {
      const roomId = this.efeRecordIds[roomName];
      if (!roomId) {
        await this.showToast('Please save the room first', 'warning');
        return;
      }

      // If room is pending, cannot take photos yet
      if (roomId === '__pending__') {
        await this.showToast('Room is queued for creation. Please enable Auto-Save first.', 'warning');
        return;
      }

      // Get point ID - should already exist from pre-creation
      const pointKey = `${roomName}_${point.name}`;
      let pointId = this.efePointIds[pointKey];

      if (!pointId || pointId === '__pending__') {
        // If offline, cannot proceed
        if (this.manualOffline) {
          await this.showToast('Please enable Auto-Save to take photos', 'warning');
          return;
        }

        // Point doesn't exist yet (e.g., custom point added manually)
        // Create it now - this should be rare since template points are pre-created
        console.log(`[Photo Capture] Point ${point.name} not pre-created, creating now...`);

        const pointData = {
          EFEID: parseInt(roomId),
          PointName: point.name
        };
        const createResponse = await this.caspioService.createServicesEFEPoint(pointData).toPromise();

        // Use PointID from response, NOT PK_ID!
        if (createResponse && (createResponse.PointID || createResponse.PK_ID)) {
          pointId = createResponse.PointID || createResponse.PK_ID;
          this.efePointIds[pointKey] = pointId;
          console.log(`[Photo Capture] Created point ${point.name} with ID ${pointId}`);
        } else {
          throw new Error('Failed to create point record');
        }
      }

      // Check if this photo type already exists
      const existingPhoto = this.getPointPhotoByType(point, photoType);
      if (existingPhoto) {
        const alert = await this.alertController.create({
          header: 'Replace Photo',
          message: `A ${photoType} photo already exists for this point. Replace it?`,
          buttons: [
            {
              text: 'Cancel',
              role: 'cancel'
            },
            {
              text: 'Replace',
              handler: async () => {
                // Delete the existing photo first
                await this.deleteRoomPhoto(existingPhoto, roomName, point, true);
                // Then capture new one
                this.currentRoomPointContext = {
                  roomName,
                  point,
                  pointId,
                  roomId,
                  photoType  // Store the photo type
                };
                // Set flag to skip annotation for elevation plot photos
                this.skipElevationAnnotation = true;
                this.triggerFileInput(source, { allowMultiple: false });
              }
            }
          ]
        });
        await alert.present();
        return;
      }

      this.currentRoomPointContext = {
        roomName,
        point,
        pointId,
        roomId,
        photoType  // Store the photo type
      };

      // Set flag to skip annotation for elevation plot photos
      this.skipElevationAnnotation = true;

      this.triggerFileInput(source, { allowMultiple: false });

    } catch (error) {
      console.error('Error in capturePointPhoto:', error);
      await this.showToast('Failed to capture photo', 'danger');
    }
  }
  
  // Load existing room points and their photos
  async loadExistingRoomPoints(roomId: string, roomName: string) {
    try {
      
      // Get all points for this room
      const points = await this.foundationData.getEFEPoints(roomId);
      
      if (points && points.length > 0) {
        for (const point of points) {
          // Use PointID as the primary ID field, fallback to PK_ID
          const pointId = point.PointID || point.PK_ID;
          const pointKey = `${roomName}_${point.PointName}`;
          
          // Store the point ID for future reference
          this.efePointIds[pointKey] = pointId;
          
          // Find the corresponding point in roomElevationData and mark it as having photos
          if (this.roomElevationData[roomName]?.elevationPoints) {
            let elevationPoint = this.roomElevationData[roomName].elevationPoints.find(
              (p: any) => p.name === point.PointName
            );
            
            // If this point doesn't exist in the template, it's a custom point - add it
            if (!elevationPoint) {
              elevationPoint = {
                name: point.PointName,
                value: '',
                photo: null,
                photos: [],
                photoCount: 0,
                isCustom: true  // Mark as custom point
              };
              this.roomElevationData[roomName].elevationPoints.push(elevationPoint);
            }
            
            // Ensure photos array exists
            if (!elevationPoint.photos) {
              elevationPoint.photos = [];
            }
            
            if (elevationPoint) {
              // Get photo count for this point - use the correct PointID
              const actualPointId = point.PointID || pointId;
              const photos = await this.foundationData.getEFEAttachments(actualPointId);
              if (photos && photos.length > 0) {
                elevationPoint.photoCount = photos.length;
                
                // Process photos SEQUENTIALLY to avoid cache issues
                const processedPhotos = [];
                for (let photoIndex = 0; photoIndex < photos.length; photoIndex++) {
                  const photo = photos[photoIndex];
                  const photoPath = photo.Photo || '';
                  let photoUrl = '';
                  let thumbnailUrl = '';
                  
                  if (photoPath && photoPath !== '') {
                    try {
                      // [v1.4.391] Enhanced cache-busting for Elevation photos to prevent duplication
                      const timestamp = Date.now();
                      const uniqueId = `${photoIndex}_${timestamp}_${Math.random().toString(36).substring(2, 8)}`;

                      // [v1.4.391] Increased delay to ensure each fetch is truly separate
                      if (photoIndex > 0) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                      }

                      // [v1.4.391] Fetch the image - cache is already disabled in service
                      const imageData = await this.caspioService.getImageFromFilesAPI(photoPath).toPromise();

                      if (imageData && imageData.startsWith('data:')) {
                        // [v1.4.391] Log data characteristics to verify uniqueness
                        const dataLength = imageData.length;
                        const dataPreview = imageData.substring(0, 100) + '...' + imageData.substring(imageData.length - 50);

                        photoUrl = imageData;
                        thumbnailUrl = imageData;
                      } else {
                        // Fallback to SVG if fetch fails - make it unique per photo
                        photoUrl = 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#e0e0e0"/><text x="75" y="50" text-anchor="middle" fill="#666" font-size="14">ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â· Photo ${photoIndex + 1}</text></svg>`);
                        thumbnailUrl = photoUrl;
                      }
                    } catch (err) {
                      console.error(`[Photo ${photoIndex + 1}] Error fetching:`, err);
                      // Fallback to SVG on error - make it unique
                      photoUrl = 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#e0e0e0"/><text x="75" y="50" text-anchor="middle" fill="#666" font-size="14">ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â· Error ${photoIndex + 1}</text></svg>`);
                      thumbnailUrl = photoUrl;
                    }
                  } else {
                    photoUrl = 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#e0e0e0"/><text x="75" y="50" text-anchor="middle" fill="#666" font-size="14">ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â· No Path ${photoIndex + 1}</text></svg>`);
                    thumbnailUrl = photoUrl;
                  }
                  
                  // Load annotations from Drawings field, not Annotation
                  let annotationData = null;
                  if (photo.Drawings) {
                    try {
                      annotationData = decompressAnnotationData(photo.Drawings);
                    } catch (e) {
                    }
                  }
                  
                  // Determine photoType from annotation prefix (for legacy photos)
                  const annotation = photo.Annotation || '';
                  let photoType = undefined;
                  if (annotation.startsWith('Location:')) {
                    photoType = 'Location';
                  } else if (annotation.startsWith('Measurement:')) {
                    photoType = 'Measurement';
                  }
                  
                  const photoResult = {
                    url: photoUrl,
                    thumbnailUrl: thumbnailUrl,
                    displayUrl: photoUrl,  // Add displayUrl for consistency
                    originalUrl: photoUrl,  // Store original for re-editing
                    photoType: photoType,  // Store photoType for identification
                    annotation: annotation,  // Load annotation to identify photo type (Location: or Measurement:)
                    caption: this.extractCaptionFromAnnotation(annotation), // Extract caption without photoType prefix
                    annotations: annotationData,
                    rawDrawingsString: photo.Drawings,
                    hasAnnotations: !!annotationData,
                    attachId: photo.AttachID || photo.PK_ID,
                    AttachID: photo.AttachID || photo.PK_ID,  // Also store as AttachID
                    id: photo.AttachID || photo.PK_ID,  // And as id for compatibility
                    originalPath: photoPath,
                    filePath: photoPath,  // Keep for compatibility
                    name: `Photo ${photoIndex + 1}`
                  };
                  
                  processedPhotos.push(photoResult);
                }
                
                elevationPoint.photos = processedPhotos;
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error loading room points:', error);
    }
  }
  
  // Handle file selection for room points with annotation support (matching Structural Systems)
  private async handleRoomPointFileSelect(files: FileList) {
    try {
      const { roomName, point, pointId, roomId } = this.currentRoomPointContext;
      
      let uploadSuccessCount = 0;
      const uploadPromises = [];
      
      // Process each file with annotation support (matching Structural Systems pattern)
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // If this is a single camera photo, open annotator first
        let annotatedResult: { file: File; annotationData?: any; originalFile?: File; caption?: string };
        
        if (files.length === 1 && !this.skipElevationAnnotation) {
          const isCameraFlow = this.expectingCameraPhoto || this.isLikelyCameraCapture(file);

          if (isCameraFlow) {
            annotatedResult = await this.annotatePhoto(file);

            const continueAlert = await this.alertController.create({
              cssClass: 'compact-photo-selector',
              buttons: [
                {
                  text: 'Take Another Photo',
                cssClass: 'action-button',
                handler: () => {
                  this.currentRoomPointContext = { roomName, point, pointId, roomId };
                  this.triggerFileInput('camera', { allowMultiple: false });
                  return true;
                }
              },
              {
                text: 'Done',
                cssClass: 'done-button',
                handler: () => {
                  this.expectingCameraPhoto = false;
                  this.setFileInputMode('library', { allowMultiple: true });
                  return true;
                }
              }
            ],
            backdropDismiss: false
          });

            await continueAlert.present();
          } else {
            annotatedResult = {
              file,
              annotationData: null,
              originalFile: undefined,
              caption: ''
            };
            this.expectingCameraPhoto = false;
          }
        } else {
          // Multiple files, non-camera selection, or elevation plot photos - no automatic annotation
          annotatedResult = {
            file: file,
            annotationData: null,
            originalFile: undefined,
            caption: ''
          };
          this.expectingCameraPhoto = false;
          this.skipElevationAnnotation = false; // Reset flag after skipping
        }
        
        // Create preview immediately
        const photoUrl = URL.createObjectURL(annotatedResult.file);
        
        // Add to UI immediately with uploading flag
        if (!point.photos) {
          point.photos = [];
        }
        
        // Check if we should replace an existing photo of this type
        // Look for photos by photoType property (new) or annotation prefix (legacy)
        const existingPhotoIndex = point.photos.findIndex((p: any) => 
          (p.photoType === this.currentRoomPointContext.photoType) ||
          (p.annotation && p.annotation.startsWith(`${this.currentRoomPointContext.photoType}:`))
        );
        
        const photoEntry: any = {
          url: photoUrl,
          thumbnailUrl: photoUrl,
          photoType: this.currentRoomPointContext.photoType, // Store photoType for identification
          annotation: annotatedResult.caption || '', // Use caption from photo editor
          caption: annotatedResult.caption || '', // Use caption from photo editor
          uploading: true,
          file: annotatedResult.file,
          originalFile: annotatedResult.originalFile,
          annotationData: annotatedResult.annotationData,
          attachId: null  // Initialize attachId property
        };
        
        if (existingPhotoIndex >= 0) {
          // Replace existing photo of this type
          point.photos[existingPhotoIndex] = photoEntry;
        } else {
          // Add new photo
          point.photos.push(photoEntry);
        }
        point.photoCount = point.photos.length;
        
        // PERFORMANCE: Trigger change detection with OnPush strategy
        this.changeDetectorRef.detectChanges();
        
        // Upload in background with annotation data including photoType
        const uploadPromise = this.uploadPhotoToRoomPointFromFile(pointId, annotatedResult.file, point.name, annotatedResult.annotationData, this.currentRoomPointContext.photoType)
          .then(async (response) => {
            photoEntry.uploading = false;
            // Store the attachment ID for annotation updates
            photoEntry.attachId = response?.AttachID || response?.PK_ID;
            photoEntry.hasAnnotations = !!annotatedResult.annotationData;
            // Store the original path for URL reconstruction later
            if (response?.Photo) {
              photoEntry.originalPath = response.Photo;
              
              // Fetch the image as base64 like we do when loading
              try {
                const imageData = await this.caspioService.getImageFromFilesAPI(response.Photo).toPromise();
                if (imageData && imageData.startsWith('data:')) {
                  photoEntry.url = imageData;
                  photoEntry.thumbnailUrl = imageData;
                }
              } catch (err) {
                console.error('Error fetching uploaded image as base64:', err);
                // Keep the blob URL as fallback
              }
            }
            
            // PERFORMANCE: Trigger change detection with OnPush strategy
            this.changeDetectorRef.detectChanges();
            
            uploadSuccessCount++;
            return response;
          })
          .catch((err) => {
            console.error(`Failed to upload photo ${i + 1}:`, err);
            // Remove failed photo from UI
            const index = point.photos.indexOf(photoEntry);
            if (index > -1) {
              point.photos.splice(index, 1);
              point.photoCount = point.photos.length;
            }
          });
        
        uploadPromises.push(uploadPromise);
      }
      
      // Don't wait for uploads - monitor them in background (like Structural Systems)
      Promise.all(uploadPromises).then(results => {
        // Only show toast if there were failures
        if (uploadSuccessCount === 0 && results.length > 0) {
          this.showToast('Failed to upload photos', 'danger');
        }
      });
      
    } catch (error) {
      console.error('Error handling room point files:', error);
      await this.showToast('Failed to process photos', 'danger');
    } finally {
      // Reset file input only if not continuing with camera
      if (!this.expectingCameraPhoto) {
        if (this.fileInput && this.fileInput.nativeElement) {
          this.fileInput.nativeElement.value = '';
          // Restore attributes to default state
          this.fileInput.nativeElement.setAttribute('multiple', 'true');
          this.fileInput.nativeElement.removeAttribute('capture');
        }
        this.currentRoomPointContext = null;
      } else {
        // Keep the context if expecting more photos
        // File input will be cleared on next selection
        if (this.fileInput && this.fileInput.nativeElement) {
          this.fileInput.nativeElement.value = '';
        }
      }
    }
  }
  
  // Helper method to capture photo using native file input (DEPRECATED - kept for legacy)
  private async capturePhotoNative(): Promise<File | null> {
    return new Promise((resolve, reject) => {
      try {
        // Use the ViewChild file input (same as visuals which work)
        if (this.fileInput && this.fileInput.nativeElement) {
          const input = this.fileInput.nativeElement;
          
          // Store the original attributes
          const originalAccept = input.accept;
          const originalMultiple = input.multiple;
          
          // Configure for single photo capture - iOS will show camera/gallery options
          input.accept = 'image/*';
          input.multiple = false;
          input.value = ''; // Clear any previous value
          
          // Set up one-time change listener
          const handleChange = (e: any) => {
            const file = e.target.files?.[0];
            
            // Restore original attributes
            input.accept = originalAccept;
            input.multiple = originalMultiple;
            
            // Remove listener
            input.removeEventListener('change', handleChange);
            
            if (file) {
              resolve(file);
            } else {
              resolve(null);
            }
          };
          
          // Add the change listener
          input.addEventListener('change', handleChange);
          
          // Trigger the file input click - this will open iOS camera/gallery selector
          input.click();
          
        } else {
          console.error('fileInput ViewChild is null, cannot capture photo');
          reject(new Error('File input not available'));
        }
        
      } catch (error) {
        console.error('Error in capturePhotoNative:', error);
        reject(error);
      }
    });
  }
  
  // Process the captured photo for room point
  async processRoomPointPhoto(base64Image: string) {
    try {
      if (!this.currentRoomPointContext) {
        throw new Error('No capture context');
      }
      
      const { roomName, point, roomId, photoType } = this.currentRoomPointContext;
      
      // Check if point record exists, create if not
      const pointKey = `${roomName}_${point.name}`;
      let pointId = this.efePointIds[pointKey];
      
      if (!pointId) {
        // Create Services_EFE_Points record
        const pointData = {
          EFEID: parseInt(roomId),
          PointName: point.name
        };
        
        const createResponse = await this.caspioService.createServicesEFEPoint(pointData).toPromise();
        
        // Use PointID from response, NOT PK_ID!
        if (createResponse && (createResponse.PointID || createResponse.PK_ID)) {
          pointId = createResponse.PointID || createResponse.PK_ID;
          this.efePointIds[pointKey] = pointId;
        } else {
          throw new Error('Failed to create point record');
        }
      }
      
      // Upload photo to Services_EFE_Attach with blank annotation (user can add their own caption)
      const annotation = '';
      await this.uploadPhotoToRoomPoint(pointId, base64Image, point.name, annotation);
      
      // Update UI to show photo
      if (!point.photos) {
        point.photos = [];
      }
      point.photos.push({
        url: base64Image,
        thumbnailUrl: base64Image,
        displayUrl: base64Image,  // Add displayUrl for consistency
        photoType: photoType,  // Store photoType for identification
        annotation: annotation
      });
      point.photoCount = point.photos.length;
      
      // Trigger change detection to update UI
      this.changeDetectorRef.detectChanges();
      
      // Show success toast
      await this.showToast(`${photoType} photo captured`, 'success');
      
    } catch (error) {
      console.error('Error processing room point photo:', error);
      await this.showToast('Failed to process photo', 'danger');
    }
  }
  
  // Upload photo to Services_EFE_Attach
  async uploadPhotoToRoomPoint(pointId: string, base64Image: string, pointName: string, annotation: string = '') {
    try {
      // Convert base64 to blob
      const response = await fetch(base64Image);
      const blob = await response.blob();
      
      // COMPRESS the image before upload - OPTIMIZED for faster uploads
      const compressedBlob = await this.imageCompression.compressImage(blob, {
        maxSizeMB: 0.8,  // Reduced from 1.5MB for faster uploads
        maxWidthOrHeight: 1280,  // Reduced from 1920px - sufficient for reports
        useWebWorker: true
      });
      
      // Generate filename
      const timestamp = new Date().getTime();
      const fileName = `room_point_${pointId}_${timestamp}.jpg`;
      
      // Upload to Caspio Files API
      const formData = new FormData();
      formData.append('file', compressedBlob, fileName);
      
      const token = await this.caspioService.getValidToken().toPromise();
      const account = this.caspioService.getAccountID();
      
      const uploadResponse = await fetch(`https://${account}.caspio.com/rest/v2/files`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      
      const uploadResult = await uploadResponse.json();
      
      if (!uploadResult?.Name) {
        throw new Error('File upload failed');
      }
      
      // Create Services_EFE_Attach record
      const attachData = {
        PointID: parseInt(pointId),
        Photo: `/${uploadResult.Name}`,
        Annotation: annotation
      };
      
      await this.caspioService.createServicesEFEAttach(attachData).toPromise();
      
    } catch (error) {
      console.error('Error uploading room point photo:', error);
      throw error;
    }
  }
  
  // Upload photo from File object to Services_EFE_Points_Attach with annotation support
  async uploadPhotoToRoomPointFromFile(pointId: string, file: File, pointName: string, annotationData: any = null, photoType?: string) {
    try {
      const pointIdNum = parseInt(pointId, 10);
      
      // COMPRESS the file before upload - OPTIMIZED for faster uploads
      const compressedFile = await this.imageCompression.compressImage(file, {
        maxSizeMB: 0.8,  // Reduced from 1.5MB for faster uploads
        maxWidthOrHeight: 1280,  // Reduced from 1920px - sufficient for reports
        useWebWorker: true
      }) as File;
      
      // Directly proceed with upload and return the response
      const response = await this.performRoomPointPhotoUpload(pointIdNum, compressedFile, pointName, annotationData, photoType);
      return response;  // Return response so we can get AttachID
      
    } catch (error) {
      console.error('Error in uploadPhotoToRoomPointFromFile:', error);
      throw error;
    }
  }
  
  // Perform the actual room point photo upload with annotation support
  private async performRoomPointPhotoUpload(pointIdNum: number, photo: File, pointName: string, annotationData: any = null, photoType?: string) {
    try {
      
      // Process annotation data for Drawings field (same as Structural Systems)
      let drawingsData = '';
      if (annotationData && annotationData !== null) {
        // Check if there are actual annotation objects
        let hasActualAnnotations = false;
        
        if (typeof annotationData === 'object' && annotationData.objects && Array.isArray(annotationData.objects)) {
          // Check if there are any actual drawing objects (not empty)
          hasActualAnnotations = annotationData.objects.length > 0;
        } else if (typeof annotationData === 'string' && annotationData.length > 2) {
          // If it's a string, check it's not just empty JSON
          hasActualAnnotations = annotationData !== '{}' && annotationData !== '[]' && annotationData !== '""';
        }
        
        if (hasActualAnnotations) {
          if (typeof annotationData === 'string') {
            drawingsData = annotationData;
          } else if (typeof annotationData === 'object') {
            // Convert object to JSON string for storage
            drawingsData = JSON.stringify(annotationData);
          }
          // Compress if needed (matching Structural Systems logic)
          if (drawingsData && drawingsData.length > 0) {
            drawingsData = compressAnnotationData(drawingsData, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });
          }
        }
      }
      if (!drawingsData) {
        drawingsData = EMPTY_COMPRESSED_ANNOTATIONS;
      }
      
      // Removed debug popup for seamless upload experience
      /* const debugAlert = await this.alertController.create({
        header: 'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG: Elevation Photo Upload',
        message: `
          <div style="font-family: monospace; font-size: 11px; text-align: left;">
            <strong style="color: blue;">UPLOAD PARAMETERS</strong><br><br>
            
            <strong>Point Info:</strong><br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Point ID: ${pointIdNum}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Point Name: ${pointName}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Point ID Type: ${typeof pointIdNum}<br><br>
            
            <strong>Photo Info:</strong><br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ File Name: ${photo.name}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ File Size: ${photo.size} bytes<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ File Type: ${photo.type}<br><br>
            
            <strong>Annotation Data:</strong><br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Has Annotations: ${!!annotationData}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Drawings Data Length: ${drawingsData.length}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Drawings Preview: ${drawingsData ? drawingsData.substring(0, 100) + '...' : 'None'}<br><br>
            
            <strong>API Call:</strong><br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Method: createServicesEFEPointsAttachWithFile<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Table: Services_EFE_Points_Attach<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Parameters: (${pointIdNum}, "${drawingsData.substring(0, 50)}...", File)<br><br>
            
            <strong style="color: orange;">Note:</strong> We're using the SAME API method as before,<br>
            just now passing annotation data to the Drawings field.
          </div>
        `,
        buttons: [
          {
            text: 'Continue Upload',
            handler: () => true
          },
          {
            text: 'Cancel',
            role: 'cancel',
            handler: () => {
              throw new Error('Upload cancelled by user');
            }
          }
        ]
      });
      await debugAlert.present();
      const { role } = await debugAlert.onDidDismiss();
      
      if (role === 'cancel') {
        throw new Error('Upload cancelled by user');
      } */
      
      // Use the new two-step method that matches visual upload (debug popups removed)
      const response = await this.caspioService.createServicesEFEPointsAttachWithFile(
        pointIdNum,
        drawingsData, // Pass annotation data to Drawings field
        photo,
        photoType // CRITICAL: Pass photoType for Annotation field
      ).toPromise();
      
      // Success popup removed for cleaner user experience
      
      return response;  // Return the response with AttachID
      
    } catch (error: any) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Failed to upload room point photo:', error);
      
      // Show detailed error debug popup
      const errorAlert = await this.alertController.create({
        header: 'ÃƒÂ¢Ã‚ÂÃ…â€™ Upload Failed',
        message: `
          <div style="font-family: monospace; font-size: 11px; text-align: left;">
            <strong style="color: red;">ERROR DETAILS</strong><br><br>
            
            <strong>Error Message:</strong><br>
            ${error?.message || 'Unknown error'}<br><br>
            
            <strong>Error Object:</strong><br>
            ${JSON.stringify(error, null, 2).substring(0, 500)}<br><br>
            
            <strong>Upload Parameters Were:</strong><br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Point ID: ${pointIdNum}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Point Name: ${pointName}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ File: ${photo?.name} (${photo?.size} bytes)<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Annotations: ${annotationData ? 'Yes' : 'No'}<br><br>
            
            <strong>Possible Issues:</strong><br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Check if PointID ${pointIdNum} exists<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Check if Drawings field accepts the data<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Check network/API connection
          </div>
        `,
        buttons: ['OK']
      });
      await errorAlert.present();
      
      throw error;
    }
  }
  
  // Toggle room selection - create or remove from Services_EFE
  async toggleRoomSelection(roomName: string, event?: any) {
    console.log('[Toggle Room] Called for:', roomName, 'Event:', event);
    
    // CRITICAL: Prevent checkbox toggles during rename operations
    if (this.renamingRooms[roomName]) {
      console.log('[Toggle Room] BLOCKED - Room is being renamed');
      if (event && event.target) {
        event.target.checked = this.selectedRooms[roomName]; // Revert to current state
      }
      return;
    }
    
    // Only proceed if this is a real checkbox change event
    if (!event || !event.detail || typeof event.detail.checked === 'undefined') {
      console.log('[Toggle Room] BLOCKED - Not a valid checkbox event');
      return;
    }
    
    const wasSelected = this.selectedRooms[roomName];
    const isSelected = event.detail.checked; // Use the event's checked value instead of toggling
    
    console.log('[Toggle Room] wasSelected:', wasSelected, 'isSelected:', isSelected);
    
    // If deselecting, ask for confirmation first
    if (wasSelected && !isSelected) {
      // Show confirmation dialog BEFORE changing state
      const confirmAlert = await this.alertController.create({
        header: 'Confirm Remove Room',
        message: `Are you sure you want to remove "${roomName}"? This will delete all photos and data for this room.`,
        cssClass: 'custom-document-alert',
        buttons: [
          {
            text: 'CANCEL',
            role: 'cancel',
            cssClass: 'alert-button-cancel',
            handler: () => {
              // User cancelled - revert the checkbox state
              event.target.checked = true; // Revert the checkbox visually
              this.selectedRooms[roomName] = true; // Keep it selected in our model
              return true;
            }
          },
          {
            text: 'REMOVE',
            cssClass: 'alert-button-save',
            handler: async () => {
              // User confirmed - proceed with deletion
              event.target.checked = false; // Keep unchecked
              await this.removeRoom(roomName);
              return true;
            }
          }
        ],
        backdropDismiss: false // Prevent dismissing by clicking backdrop
      });
      
      await confirmAlert.present();
      const { role } = await confirmAlert.onDidDismiss();
      
      // If dismissed by backdrop or escape (shouldn't happen with backdropDismiss: false)
      if (role !== 'cancel' && role !== undefined) {
        // Revert checkbox if not explicitly cancelled or confirmed
        event.target.checked = true;
        this.selectedRooms[roomName] = true;
      }
      return; // Exit early - handlers will manage the state
    }
    
    // If selecting, check if room already exists before creating
    if (isSelected) {
      // Check if we already have a record ID for this room
      if (this.efeRecordIds[roomName]) {
        this.selectedRooms[roomName] = true;
        this.expandedRooms[roomName] = false;
        return; // Room already exists, just update UI state
      }
      
      this.savingRooms[roomName] = true;
      
      try {
        // Create room in Services_EFE
        const serviceIdNum = parseInt(this.serviceId, 10);
        
        // Validate ServiceID
        if (!this.serviceId || isNaN(serviceIdNum)) {
          await this.showToast(`Error: Invalid ServiceID (${this.serviceId})`, 'danger');
          this.savingRooms[roomName] = false;
          return;
        }
        
        // Send ServiceID, RoomName, and TemplateID (critical for matching after renames)
        const roomData: any = {
          ServiceID: serviceIdNum,
          RoomName: roomName
        };
        
        // Include TemplateID to link back to template (critical for room name changes)
        if (this.roomElevationData[roomName] && this.roomElevationData[roomName].templateId) {
          roomData.TemplateID = this.roomElevationData[roomName].templateId;
        }
        
        // Include FDF and Notes if they exist
        if (this.roomElevationData[roomName]) {
          if (this.roomElevationData[roomName].fdf) {
            roomData.FDF = this.roomElevationData[roomName].fdf;
          }
          if (this.roomElevationData[roomName].notes) {
            roomData.Notes = this.roomElevationData[roomName].notes;
          }
        }

        // Check if offline mode is enabled
        if (this.manualOffline) {
          this.pendingRoomCreates[roomName] = roomData;
          this.selectedRooms[roomName] = true;
          this.expandedRooms[roomName] = true;
          this.efeRecordIds[roomName] = '__pending__';
          this.savingRooms[roomName] = false;
          this.changeDetectorRef.detectChanges();
          return;
        }

        // Create room directly without debug popup
        try {
          const response = await this.caspioService.createServicesEFE(roomData).toPromise();
          
          if (response) {
            // Use EFEID from the response, NOT PK_ID
            const roomId = response.EFEID || response.roomId;
            if (!roomId) {
              console.error('No EFEID in response:', response);
              throw new Error('EFEID not found in response');
            }
            this.efeRecordIds[roomName] = roomId;
            this.selectedRooms[roomName] = true;
            this.expandedRooms[roomName] = true;

            // Pre-create all elevation points to eliminate lag when taking photos
            await this.createElevationPointsForRoom(roomName, roomId);
          }
        } catch (err: any) {
          console.error('Room creation error:', err);
          if (!this.manualOffline) {
            await this.showToast('Failed to create room', 'danger');
          }
          this.selectedRooms[roomName] = false;
        }
      } catch (error: any) {
        console.error('Error toggling room selection:', error);
        if (!this.manualOffline) {
          await this.showToast('Failed to update room selection', 'danger');
        }
        this.selectedRooms[roomName] = false;
        if (event && event.target) {
          event.target.checked = false; // Revert checkbox visually on error
        }
      } finally {
        this.savingRooms[roomName] = false;
        // Trigger change detection to update completion percentage
        this.changeDetectorRef.detectChanges();
      }
    }
  }

  // Pre-create all elevation points for a room to eliminate lag when taking photos
  async createElevationPointsForRoom(roomName: string, roomId: string): Promise<void> {
    try {
      // Skip if offline mode
      if (this.manualOffline || roomId === '__pending__') {
        console.log(`[Pre-create Points] Skipping for ${roomName} - offline mode`);
        return;
      }

      // Get elevation points from room data
      const roomData = this.roomElevationData[roomName];
      if (!roomData || !roomData.elevationPoints || roomData.elevationPoints.length === 0) {
        console.log(`[Pre-create Points] No points found for ${roomName}`);
        return;
      }

      console.log(`[Pre-create Points] Creating ${roomData.elevationPoints.length} points for ${roomName}`);

      // Create all points in parallel for speed
      const pointCreationPromises = roomData.elevationPoints.map(async (point: any) => {
        const pointKey = `${roomName}_${point.name}`;

        // Skip if point already exists
        if (this.efePointIds[pointKey]) {
          console.log(`[Pre-create Points] Point ${point.name} already exists, skipping`);
          return;
        }

        try {
          // Check if point already exists in database
          const existingPoint = await this.caspioService.checkEFEPointExists(roomId, point.name).toPromise();

          if (existingPoint) {
            // Point already exists, use its PointID
            const pointId = existingPoint.PointID || existingPoint.PK_ID;
            this.efePointIds[pointKey] = pointId;
            console.log(`[Pre-create Points] Found existing point ${point.name} with ID ${pointId}`);
          } else {
            // Create new Services_EFE_Points record
            const pointData = {
              EFEID: parseInt(roomId),
              PointName: point.name
            };
            const createResponse = await this.caspioService.createServicesEFEPoint(pointData).toPromise();

            if (createResponse && (createResponse.PointID || createResponse.PK_ID)) {
              const pointId = createResponse.PointID || createResponse.PK_ID;
              this.efePointIds[pointKey] = pointId;
              console.log(`[Pre-create Points] Created point ${point.name} with ID ${pointId}`);
            } else {
              console.error(`[Pre-create Points] Failed to get PointID for ${point.name}`, createResponse);
            }
          }
        } catch (error) {
          console.error(`[Pre-create Points] Error creating point ${point.name}:`, error);
          // Continue with other points even if one fails
        }
      });

      // Wait for all points to be created
      await Promise.all(pointCreationPromises);
      console.log(`[Pre-create Points] Completed for ${roomName}`);

    } catch (error) {
      console.error(`[Pre-create Points] Error creating points for ${roomName}:`, error);
      // Don't throw - allow room creation to succeed even if point creation has issues
    }
  }

  // Remove room from Services_EFE
  async removeRoom(roomName: string) {
    this.savingRooms[roomName] = true;
    const roomId = this.efeRecordIds[roomName];
    
    if (roomId) {
      try {
        // Delete the room from Services_EFE table
        await this.caspioService.deleteServicesEFE(roomId).toPromise();
        delete this.efeRecordIds[roomName];
        this.selectedRooms[roomName] = false;
        
        // Don't delete the room elevation data structure, just reset it
        // This preserves the elevation points and configuration
        if (this.roomElevationData[roomName]) {
          // Clear photos but keep the structure
          if (this.roomElevationData[roomName].elevationPoints) {
            this.roomElevationData[roomName].elevationPoints.forEach((point: any) => {
              point.photos = [];
              point.photoCount = 0;
            });
          }
          // Reset FDF to default
          this.roomElevationData[roomName].fdf = '';
        }
      } catch (error) {
        console.error('Error deleting room:', error);
        await this.showToast('Failed to remove room', 'danger');
        // Don't revert UI state since user intended to delete
      }
    }
    
    this.savingRooms[roomName] = false;
    // Trigger change detection to update completion percentage
    this.changeDetectorRef.detectChanges();
  }

  isRoomSelected(roomName: string): boolean {
    return !!this.selectedRooms[roomName];
  }
  
  isRoomSaving(roomName: string): boolean {
    return !!this.savingRooms[roomName];
  }
  
  // Get list of selected rooms
  getSelectedRooms(): any[] {
    return this.roomTemplates.filter(room => 
      room.selected || this.selectedRooms[room.RoomName]
    );
  }
  
  // Get room index in array
  getRoomIndex(roomName: string): number {
    return this.roomTemplates.findIndex(room => room.RoomName === roomName);
  }
  
  // Move room up in the list
  async moveRoomUp(roomName: string, event: Event) {
    // CRITICAL: Stop all event propagation to prevent checkbox toggle
    if (event) {
      event.stopPropagation();
      event.stopImmediatePropagation();
      event.preventDefault();
    }
    
    const currentIndex = this.getRoomIndex(roomName);
    if (currentIndex > 0) {
      // Swap with the room above
      const temp = this.roomTemplates[currentIndex];
      this.roomTemplates[currentIndex] = this.roomTemplates[currentIndex - 1];
      this.roomTemplates[currentIndex - 1] = temp;
      
      // Trigger change detection
      this.changeDetectorRef.detectChanges();
    }
  }
  
  // Move room down in the list
  async moveRoomDown(roomName: string, event: Event) {
    // CRITICAL: Stop all event propagation to prevent checkbox toggle
    if (event) {
      event.stopPropagation();
      event.stopImmediatePropagation();
      event.preventDefault();
    }
    
    const currentIndex = this.getRoomIndex(roomName);
    if (currentIndex >= 0 && currentIndex < this.roomTemplates.length - 1) {
      // Swap with the room below
      const temp = this.roomTemplates[currentIndex];
      this.roomTemplates[currentIndex] = this.roomTemplates[currentIndex + 1];
      this.roomTemplates[currentIndex + 1] = temp;
      
      // Trigger change detection
      this.changeDetectorRef.detectChanges();
    }
  }
  
  // Rename a room
  async renameRoom(oldRoomName: string, event: Event) {
    // CRITICAL: Stop all event propagation to prevent checkbox toggle
    if (event) {
      event.stopPropagation();
      event.stopImmediatePropagation();
      event.preventDefault();
    }
    
    console.log('[Rename Room] Starting rename for:', oldRoomName);
    console.log('[Rename Room] Event:', event);
    
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
            
            const roomIndex = this.getRoomIndex(oldRoomName);
            const roomId = this.efeRecordIds[oldRoomName];
            
            // CRITICAL: Verify this room belongs to the current service
            if (!roomId || roomId === '__pending__') {
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

              // Mark that changes have been made (enables Update button)
              this.markReportChanged();
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
            if (this.expandedRooms[oldRoomName]) {
              this.expandedRooms[newRoomName] = this.expandedRooms[oldRoomName];
            }
            if (this.savingRooms[oldRoomName]) {
              this.savingRooms[newRoomName] = this.savingRooms[oldRoomName];
            }
            if (this.roomElevationData[oldRoomName]) {
              this.roomElevationData[newRoomName] = this.roomElevationData[oldRoomName];
            }
            
            console.log('[Rename Room] Created new entries. selectedRooms:', Object.keys(this.selectedRooms));
            
            // Update efePointIds for all points
            const pointKeysToUpdate = Object.keys(this.efePointIds).filter(key => key.startsWith(oldRoomName + '_'));
            pointKeysToUpdate.forEach(oldKey => {
              const pointName = oldKey.substring((oldRoomName + '_').length);
              const newKey = `${newRoomName}_${pointName}`;
              this.efePointIds[newKey] = this.efePointIds[oldKey];
            });
            
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
              delete this.expandedRooms[oldRoomName];
              delete this.savingRooms[oldRoomName];
              delete this.roomElevationData[oldRoomName];
              pointKeysToUpdate.forEach(oldKey => {
                delete this.efePointIds[oldKey];
              });
              console.log('[Rename Room] Deleted old entries after timeout');
            }, 100);
            
            // Clear rename flag for both old and new names (be extra safe)
            delete this.renamingRooms[oldRoomName];
            delete this.renamingRooms[newRoomName];
            
            // Step 4: Re-attach change detection and force update
            this.changeDetectorRef.reattach();
            this.changeDetectorRef.detectChanges();
            console.log('[Rename Room] Re-attached change detection and updated UI');
            
            await this.showToast(`Room renamed to "${newRoomName}"`, 'success');
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
  
  // Handle room selection change from checkbox
  async onRoomSelectionChange(room: any) {
    // Update the selected state in our tracking object
    if (room.selected) {
      this.selectedRooms[room.RoomName] = true;
      // Create room in database if needed
      await this.toggleRoomSelection(room.RoomName, { detail: { checked: true } });
    } else {
      // Call toggleRoomSelection which handles deselection confirmation
      await this.toggleRoomSelection(room.RoomName, { detail: { checked: false } });
    }
  }
  
  // Check if room is expanded
  isRoomExpanded(roomName: string): boolean {
    // Default to collapsed
    if (this.expandedRooms[roomName] === undefined) {
      this.expandedRooms[roomName] = false;
    }
    return this.expandedRooms[roomName] || false;
  }
  
  // Toggle room expansion
  toggleRoomExpanded(roomName: string) {
    if (this.isRoomSelected(roomName)) {
      this.expandedRooms[roomName] = !this.expandedRooms[roomName];
    }
  }
  
  // Handle expand/collapse icon click with proper event handling
  handleRoomExpandClick(roomName: string, event: Event) {
    // Stop all propagation to prevent triggering checkbox or other handlers
    if (event) {
      event.stopPropagation();
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    
    // Only toggle expansion, never trigger selection
    if (this.isRoomSelected(roomName)) {
      this.expandedRooms[roomName] = !this.expandedRooms[roomName];
    }
    
    return false; // Extra prevention of event bubbling
  }
  
  // Handle room label click - expand/collapse if selected, do nothing if not
  handleRoomLabelClick(roomName: string, event: Event) {
    event.stopPropagation();
    event.preventDefault();

    // Only toggle expansion if room is already selected
    if (this.isRoomSelected(roomName)) {
      this.toggleRoomExpanded(roomName);
    }
    // If room is not selected, do nothing (don't select it)
  }

  // Handle room header click - add room if not selected, expand/collapse if selected
  async handleRoomHeaderClick(roomName: string, event: Event) {
    // Prevent clicks on action buttons or checkbox from bubbling
    const target = event.target as HTMLElement;

    // Check if click is on an action button or checkbox
    if (target.closest('.room-action-btn') ||
        target.closest('ion-checkbox') ||
        target.closest('.room-actions-external') ||
        target.closest('ion-icon[name*="chevron"]')) {
      return; // Don't handle header click for these elements
    }

    event.stopPropagation();
    event.preventDefault();

    // CRITICAL: Prevent checkbox toggles during rename operations
    if (this.renamingRooms[roomName]) {
      console.log('[Header Click] BLOCKED - Room is being renamed');
      return;
    }

    if (this.isRoomSelected(roomName)) {
      // Room is already selected, toggle expansion
      this.toggleRoomExpanded(roomName);
    } else {
      // Room is not selected, select it (add it)
      const fakeEvent = {
        detail: { checked: true },
        target: null
      };
      await this.toggleRoomSelection(roomName, fakeEvent);
    }
  }

  // Handle checkbox change - only for deletion (unchecking)
  async handleRoomCheckboxChange(roomName: string, event: any) {
    // CRITICAL: Prevent checkbox toggles during rename operations
    if (this.renamingRooms[roomName]) {
      console.log('[Checkbox] BLOCKED - Room is being renamed');
      if (event && event.target) {
        event.target.checked = this.selectedRooms[roomName]; // Revert to current state
      }
      return;
    }

    const isChecked = event.detail.checked;
    const wasSelected = this.selectedRooms[roomName];

    console.log('[Checkbox Change] Room:', roomName, 'Was selected:', wasSelected, 'Is checked:', isChecked);

    // Only handle unchecking (deletion)
    if (wasSelected && !isChecked) {
      // User is unchecking - show delete confirmation
      await this.toggleRoomSelection(roomName, event);
    } else if (!wasSelected && isChecked) {
      // User is checking - this should not happen since header click handles addition
      // But if it does, revert the checkbox
      console.log('[Checkbox] BLOCKED - Use header click to add room');
      if (event && event.target) {
        event.target.checked = false;
      }
    }
  }

  private setFileInputMode(source: 'camera' | 'library' | 'system', options: { allowMultiple?: boolean; capture?: string } = {}): boolean {
    if (!this.fileInput || !this.fileInput.nativeElement) {
      console.error('File input not available');
      void this.showToast('File input not available', 'danger');
      return false;
    }

    const input = this.fileInput.nativeElement;
    input.setAttribute('accept', 'image/*');

    if (source === 'camera') {
      this.expectingCameraPhoto = true;
      input.setAttribute('capture', options.capture ?? 'environment');
      input.removeAttribute('multiple');
    } else if (source === 'system') {
      this.expectingCameraPhoto = false;
      input.removeAttribute('capture');
      if (options.allowMultiple === false) {
        input.removeAttribute('multiple');
      } else {
        input.setAttribute('multiple', 'true');
      }
    } else {
      this.expectingCameraPhoto = false;
      input.removeAttribute('capture');
      if (options.allowMultiple === false) {
        input.removeAttribute('multiple');
      } else {
        input.setAttribute('multiple', 'true');
      }
    }

    return true;
  }

  private triggerFileInput(source: 'camera' | 'library' | 'system', options: { allowMultiple?: boolean; capture?: string } = {}): void {
    if (!this.setFileInputMode(source, options)) {
      return;
    }

    const input = this.fileInput!.nativeElement as HTMLInputElement;
    input.value = '';

    setTimeout(() => {
      input.click();
    }, 100);
  }

  private isLikelyCameraCapture(file: File): boolean {
    const now = Date.now();
    const delta = Math.abs(now - file.lastModified);
    return delta < 15000;
  }

  // Show room selection dialog
  // Check if a room is a Base Station (including numbered variants like "Base Station #2")
  isBaseStation(roomName: string): boolean {
    if (!roomName) return false;
    // Match "Base Station" or "Base Station #2", "Base Station #3", etc.
    return roomName === 'Base Station' || roomName.startsWith('Base Station #');
  }

  // Add Base Station specifically
  async addBaseStation() {
    console.log('Adding Base Station, allRoomTemplates:', this.allRoomTemplates.map(r => r.RoomName));
    
    // Find Base Station template - should always exist
    let baseStationTemplate = this.allRoomTemplates.find(r => r.RoomName === 'Base Station');
    
    if (!baseStationTemplate) {
      console.error('Base Station not found in allRoomTemplates, checking alternatives');
      
      // Try case-insensitive search
      baseStationTemplate = this.allRoomTemplates.find(r => 
        r.RoomName?.toLowerCase() === 'base station'
      );
      
      if (!baseStationTemplate) {
        console.error('Available templates:', this.allRoomTemplates);
        await this.showToast('Base Station template not found. Please refresh the page.', 'warning');
        return;
      }
    }
    
    // Clone the template to avoid any reference issues
    const templateCopy = JSON.parse(JSON.stringify(baseStationTemplate));
    await this.addRoomTemplate(templateCopy);
  }

  // Check if FDF photos should be shown for a room
  shouldShowFDFPhotos(roomName: string): boolean {
    if (!this.roomElevationData[roomName]) return false;
    
    const fdfValue = this.roomElevationData[roomName].fdf;
    
    // Hide photos for these values (checking for both old and new formats)
    const hideValues = [
      '',  // Empty string when "-- Select --" is chosen
      'None', 
      'Same Elevation, Same Flooring', 
      'Same Elevation',
      'Same Elevation (0.0)',
      'Same Flooring (0.0)',
      'Same Flooring and Elevation'
    ];
    
    return !hideValues.includes(fdfValue);
  }

  async showAddRoomDialog() {
    try {
      // Show ALL room templates, allowing duplicates
      const availableRooms = this.allRoomTemplates;
      
      if (availableRooms.length === 0) {
        await this.showToast('No room templates available', 'info');
        return;
      }
      
      // Create buttons for each available room
      const buttons = availableRooms.map(room => ({
        text: room.RoomName,
        handler: () => {
          this.addRoomTemplate(room);
        }
      }));
      
      // Add cancel button with proper typing
      buttons.push({
        text: 'Cancel',
        handler: () => {
        }
      });
      
      const actionSheet = await this.actionSheetController.create({
        header: 'Select Room to Add',
        buttons: buttons,
        cssClass: 'room-selection-sheet'
      });
      
      await actionSheet.present();
    } catch (error) {
      console.error('Error showing room selection:', error);
      await this.showToast('Failed to show room selection', 'danger');
    }
  }
  
  // Add a room template to the list
  async addRoomTemplate(template: any) {
    try {
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
          // Rename the existing unnumbered room to #1
          const existingRoom = existingWithBaseName[0];
          const oldName = existingRoom.RoomName;
          existingRoom.RoomName = `${baseName} #1`;

          // Update all related data structures
          if (this.roomElevationData[oldName]) {
            this.roomElevationData[`${baseName} #1`] = this.roomElevationData[oldName];
            delete this.roomElevationData[oldName];
          }
          if (this.selectedRooms[oldName] !== undefined) {
            this.selectedRooms[`${baseName} #1`] = this.selectedRooms[oldName];
            delete this.selectedRooms[oldName];
          }
          if (this.efeRecordIds[oldName]) {
            this.efeRecordIds[`${baseName} #1`] = this.efeRecordIds[oldName];
            delete this.efeRecordIds[oldName];
          }
          if (this.expandedRooms[oldName]) {
            this.expandedRooms[`${baseName} #1`] = this.expandedRooms[oldName];
            delete this.expandedRooms[oldName];
          }

          // CRITICAL: Trigger change detection to show renamed room immediately
          this.changeDetectorRef.detectChanges();

          nextNumber = 2; // The new room will be #2
        }
        
        roomName = `${baseName} #${nextNumber}`;
      }
      
      // Create a NEW template object (don't modify the original from allRoomTemplates)
      const roomToAdd = { ...template, RoomName: roomName };

      // Add to room templates list
      this.roomTemplates.push(roomToAdd);

      // CRITICAL: Trigger change detection so room appears immediately in UI
      this.changeDetectorRef.detectChanges();

      // Initialize room elevation data using the numbered room name
      if (roomName && !this.roomElevationData[roomName]) {
        // Extract elevation points from Point1Name, Point2Name, etc.
        const elevationPoints: any[] = [];
        
        // Check for up to 20 point columns
        for (let i = 1; i <= 20; i++) {
          const pointColumnName = `Point${i}Name`;
          const pointName = template[pointColumnName];
          
          if (pointName && pointName.trim() !== '') {
            elevationPoints.push({
              pointNumber: i,
              name: pointName,
              value: '',  // User will input the elevation value
              photo: null,
              photos: [],  // Initialize photos array
              photoCount: 0
            });
          }
        }
        
        this.roomElevationData[roomName] = {
          templateId: template.TemplateID || template.PK_ID,
          elevationPoints: elevationPoints,
          fdf: '',  // Default FDF value (empty for "-- Select --")
          notes: ''  // Room-specific notes
        };
      }
      
      // Automatically expand the elevation section to show the new room
      this.expandedSections['elevation'] = true;
      this.markSpacerHeightDirty();
      
      // Automatically select the room (create Services_EFE record)
      this.savingRooms[roomName] = true;

      // Validate ServiceID first
      const serviceIdNum = parseInt(this.serviceId, 10);
      if (!this.serviceId || isNaN(serviceIdNum)) {
        await this.showToast(`Error: Invalid ServiceID (${this.serviceId})`, 'danger');
        this.savingRooms[roomName] = false;
        // Remove from templates if validation failed
        const index = this.roomTemplates.findIndex(r => r.RoomName === roomName);
        if (index > -1) {
          this.roomTemplates.splice(index, 1);
        }
        return;
      }

      // Prepare room data
      const roomData: any = {
        ServiceID: serviceIdNum,
        RoomName: roomName
      };

      // Include FDF and Notes if they exist
      if (this.roomElevationData[roomName]) {
        if (this.roomElevationData[roomName].fdf) {
          roomData.FDF = this.roomElevationData[roomName].fdf;
        }
        if (this.roomElevationData[roomName].notes) {
          roomData.Notes = this.roomElevationData[roomName].notes;
        }
      }

      // Check if offline mode is enabled - handle BEFORE try-catch
      if (this.manualOffline) {
        this.pendingRoomCreates[roomName] = roomData;
        this.selectedRooms[roomName] = true;
        this.expandedRooms[roomName] = true;
        this.efeRecordIds[roomName] = '__pending__'; // Mark as pending
        this.savingRooms[roomName] = false;
        // CRITICAL: Trigger change detection to show offline room immediately
        this.changeDetectorRef.detectChanges();
        return; // Exit early - room is ready for use
      }

      // Only wrap API call in try-catch (not the offline logic)
      try {
        // Create room directly when online
        const response = await this.caspioService.createServicesEFE(roomData).toPromise();

        if (response) {
          // Use EFEID from the response, NOT PK_ID
          const roomId = response.EFEID || response.roomId;
          if (!roomId) {
            console.error('No EFEID in response:', response);
            throw new Error('EFEID not found in response');
          }
          this.efeRecordIds[roomName] = roomId;
          this.selectedRooms[roomName] = true;
          this.expandedRooms[roomName] = true;

          // Pre-create all elevation points to eliminate lag when taking photos
          await this.createElevationPointsForRoom(roomName, roomId);

          // CRITICAL: Trigger change detection to update UI after room creation
          this.changeDetectorRef.detectChanges();
        }
      } catch (error: any) {
        console.error('Room creation error:', error);
        await this.showToast('Failed to create room in database', 'danger');
        // Remove from templates if failed to create
        const index = this.roomTemplates.findIndex(r => r.RoomName === roomName);
        if (index > -1) {
          this.roomTemplates.splice(index, 1);
        }
        // CRITICAL: Trigger change detection to update UI after removing failed room
        this.changeDetectorRef.detectChanges();
      } finally {
        this.savingRooms[roomName] = false;
        // CRITICAL: Trigger final change detection to clear saving state
        this.changeDetectorRef.detectChanges();
      }

      // Success toast removed per user request
    } catch (error) {
      console.error('Error in addRoomTemplate:', error);
      // Only show error toast if NOT in offline mode
      if (!this.manualOffline) {
        await this.showToast('Failed to add room', 'danger');
      }
    }
  }
  
  // Add custom point to room
  // v1.4.65 compatibility - addElevationPoint alias
  async addElevationPoint(roomName: string) {
    return this.addCustomPoint(roomName);
  }

  async addCustomPoint(roomName: string) {
    const alert = await this.alertController.create({
      cssClass: 'custom-document-alert',
      header: 'Add Measurement',
      inputs: [
        {
          name: 'pointName',
          type: 'text',
          placeholder: 'Enter measurement name',
          attributes: {
            maxlength: 100
          }
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
            if (!data.pointName || data.pointName.trim() === '') {
              await this.showToast('Please enter a measurement name', 'warning');
              return false;
            }
            
            const pointName = data.pointName.trim();
            
            // Check if point already exists
            if (this.roomElevationData[roomName]?.elevationPoints) {
              const exists = this.roomElevationData[roomName].elevationPoints.some(
                (p: any) => p.name.toLowerCase() === pointName.toLowerCase()
              );
              
              if (exists) {
                await this.showToast('This measurement already exists', 'warning');
                return false;
              }
            }
            
            // Add the point to the room's elevation points
            if (!this.roomElevationData[roomName]) {
              this.roomElevationData[roomName] = {
                elevationPoints: [],
                fdf: 'None',
                notes: ''
              };
            }
            
            if (!this.roomElevationData[roomName].elevationPoints) {
              this.roomElevationData[roomName].elevationPoints = [];
            }
            
            // Add the new point
            const newPoint = {
              name: pointName,
              photoCount: 0,
              photos: []
            };
            
            this.roomElevationData[roomName].elevationPoints.push(newPoint);
            
            // Create the point in the database if room is already saved
            const roomId = this.efeRecordIds[roomName];
            if (roomId) {
              const pointKey = `${roomName}_${pointName}`;

              // Check if room is pending or if offline mode is enabled
              if (roomId === '__pending__' || this.manualOffline) {
                this.pendingPointCreates[pointKey] = {
                  roomName,
                  pointName,
                  dependsOnRoom: roomName // Track dependency
                };
                this.efePointIds[pointKey] = '__pending__';
              } else {
                try {
                  const pointData = {
                    EFEID: parseInt(roomId),
                    PointName: pointName
                  };

                  const response = await this.caspioService.createServicesEFEPoint(pointData).toPromise();
                  if (response && (response.PointID || response.PK_ID)) {
                    const pointId = response.PointID || response.PK_ID;
                    this.efePointIds[pointKey] = pointId;
                  }
                } catch (error) {
                  console.error('Error creating custom point:', error);
                  await this.showToast('Failed to create point', 'danger');
                  // Remove from UI if creation failed
                  const index = this.roomElevationData[roomName].elevationPoints.findIndex(
                    (p: any) => p.name === pointName
                  );
                  if (index > -1) {
                    this.roomElevationData[roomName].elevationPoints.splice(index, 1);
                  }
                  return false;
                }
              }
            }
            return true;
          }
        }
      ]
    });
    
    await alert.present();
  }

  async loadVisualCategories() {
    try {
      // Get all templates - filter by TypeID = 1 for Foundation Evaluation
      const allTemplates = await this.caspioService.getServicesVisualsTemplates().toPromise();
      
      // Filter templates for TypeID = 1 (Foundation Evaluation)
      this.visualTemplates = (allTemplates || []).filter(template => template.TypeID === 1);
      
      // Extract unique categories in order they appear
      const categoriesSet = new Set<string>();
      const categoriesOrder: string[] = [];
      
      this.visualTemplates.forEach(template => {
        if (template.Category && !categoriesSet.has(template.Category)) {
          categoriesSet.add(template.Category);
          categoriesOrder.push(template.Category);
        }
      });
      
      // Use the order they appear in the table, not alphabetical
      this.visualCategories = categoriesOrder;
      
      // Initialize organized data structure for each category
      this.visualCategories.forEach(category => {
        this.expandedCategories[category] = false;
        this.categoryData[category] = {};
        
        // Initialize organized structure
        this.organizedData[category] = {
          comments: [],
          limitations: [],
          deficiencies: []
        };
        
        // Get all templates for this category
        const categoryTemplates = this.visualTemplates.filter(t => t.Category === category);
        
        // Organize templates by Type
        categoryTemplates.forEach(template => {
          // Log template details for AnswerType 2 items
          if (template.AnswerType === 2) {
          }
          
          const templateData: any = {
            id: template.PK_ID,
            name: template.Name,
            text: template.Text || '',
            originalText: template.Text || '', // Preserve original text for display
            answer: '', // Separate field for Yes/No answer
            kind: template.Kind, // Changed from Type to Kind
            category: template.Category,
            answerType: template.AnswerType || 0, // 0 = text, 1 = Yes/No, 2 = dropdown
            required: template.Required || false,
            templateId: String(template.TemplateID || template.PK_ID), // CRITICAL FIX: Use TemplateID field (268) not PK_ID (496) for dropdown lookup!
            selectedOptions: [] // For multi-select (AnswerType 2)
          };
          
          // Debug logging for AnswerType 2 items (multi-select dropdowns)
          if (template.AnswerType === 2) {
            console.log(`[Template Load] Multi-select item: "${template.Name}" - PK_ID: ${template.PK_ID}, TemplateID: ${template.TemplateID}, Using for dropdown: ${templateData.templateId}`);
          }
          
          // Initialize selection state
          this.selectedItems[`${category}_${template.PK_ID}`] = false;
          
          // Sort into appropriate Kind section (was Type, now Kind)
          const kindStr = String(template.Kind || '').toLowerCase();
          if (kindStr.includes('comment')) {
            this.organizedData[category].comments.push(templateData);
          } else if (kindStr.includes('limitation')) {
            this.organizedData[category].limitations.push(templateData);
          } else if (kindStr.includes('deficienc')) {
            this.organizedData[category].deficiencies.push(templateData);
          } else {
            // Default to comments if kind is unclear
            this.organizedData[category].comments.push(templateData);
          }
          
          // Keep old structure for compatibility
          this.categoryData[category][template.PK_ID] = {
            templateId: template.PK_ID,
            name: template.Name,
            text: template.Text,
            kind: template.Kind, // Changed from Type to Kind
            selected: false,
            value: '',
            notes: ''
          };
        });
      });
    } catch (error) {
      console.error('Error loading visual categories:', error);
      await this.showToast('Failed to load template categories', 'warning');
    }
  }
  
  async loadExistingData() {
    // Load existing service data
    await this.loadServiceData();
    
    // Load existing visual selections from Services_Visuals table
    await this.loadExistingVisualSelections({ awaitPhotos: false });
    
    // TODO: Load existing template data from Service_EFE table
    // This will be implemented based on your Caspio table structure
    
    // For now, check localStorage for draft data
    const draftKey = `efe_template_${this.projectId}_${this.serviceId}`;
    const draftData = localStorage.getItem(draftKey);
    
    if (draftData) {
      try {
        const parsed = JSON.parse(draftData);
        this.formData = { ...this.formData, ...parsed.formData };
      } catch (error) {
        console.error('Error loading draft data:', error);
      }
    }
  }
  
  async loadExistingVisualSelections(options?: { awaitPhotos?: boolean }): Promise<void> {
    const awaitPhotos = options?.awaitPhotos !== false;

    if (!this.serviceId) {
      console.warn('[Visual Load] No serviceId provided');
      return;
    }

    try {
      console.log('[Visual Load] Fetching existing visuals for ServiceID:', this.serviceId);
      const existingVisuals = await this.foundationData.getVisualsByService(this.serviceId);
      console.log('[Visual Load] Found existing visuals:', existingVisuals.length, existingVisuals);

      if (existingVisuals && Array.isArray(existingVisuals)) {
        existingVisuals.forEach(visual => {
          if (visual.Category && visual.Name) {
            const matchingTemplate = this.visualTemplates.find(t =>
              t.Category === visual.Category &&
              t.Name === visual.Name
            );

            if (matchingTemplate) {
              // CRITICAL FIX: Use VisualID (unique record ID) for key to ensure each visual gets unique photos
              const visualId = visual.VisualID || visual.PK_ID || visual.id;
              const key = visual.Category + "_" + visualId;
              console.log('[Visual Load] Marking visual as selected:', key, 'VisualID:', visualId);
              this.selectedItems[key] = true;
              this.visualRecordIds[key] = String(visualId);
              console.log('[Visual Load] selectedItems state:', Object.keys(this.selectedItems).length, 'items selected');

              // CRITICAL FIX: Create NEW item instances for each visual record from database
              // This ensures each visual (even duplicates of same template) has its own photos
              const updateOrCreateItemData = (items: any[]) => {
                // Check if this visual was already loaded (by visualId)
                const existingItem = items.find(i => i.id === visualId);
                if (existingItem) {
                  // Already loaded, skip
                  return;
                }
                
                // Find the template item to use as base
                const templateItem = items.find(i => i.id === matchingTemplate.PK_ID);
                if (!templateItem) {
                  return;
                }
                
                // Check if this is the first visual using this template
                const isFirstInstance = !items.some(i => i.templateId === matchingTemplate.PK_ID);
                
                if (isFirstInstance) {
                  // First instance: update the template item in-place (backward compatibility)
                  templateItem.id = visualId;
                  templateItem.templateId = String(matchingTemplate.TemplateID || matchingTemplate.PK_ID); // CRITICAL: Use TemplateID field for dropdown lookup!
                  const item = templateItem;  // Use template item

                const hasAnswersField = visual.Answers !== undefined && visual.Answers !== null && visual.Answers !== "";

                if (item.answerType === 1) {
                  if (hasAnswersField) {
                    item.answer = visual.Answers;
                    item.text = visual.Text || item.originalText || "";
                  } else if (visual.Text === "Yes" || visual.Text === "No") {
                    item.answer = visual.Text;
                    item.text = item.originalText || "";
                  }
                } else if (item.answerType === 2) {
                  if (hasAnswersField) {
                    item.selectedOptions = visual.Answers.split(",").map((s: string) => s.trim());
                    item.text = visual.Text || item.originalText || "";
                  } else if (visual.Text) {
                    item.selectedOptions = visual.Text.split(",").map((s: string) => s.trim());
                  }

                  // CRITICAL FIX: Extract custom "Other" value (supports both old "Other: value" and new "value" formats)
                  if (item.selectedOptions) {
                    // Find any custom values (not in the predefined dropdown list)
                    const dropdownOptions = this.visualDropdownOptions[item.templateId] || [];
                    const customValues = item.selectedOptions.filter((opt: string) => 
                      !dropdownOptions.includes(opt) && opt !== 'Other'
                    );
                    
                    if (customValues.length > 0) {
                      // Store the custom value and add "Other" to selectedOptions
                      item.otherValue = customValues[0];
                      // Replace custom value with "Other" in array for checkbox consistency
                      const customIndex = item.selectedOptions.indexOf(customValues[0]);
                      if (customIndex > -1) {
                        item.selectedOptions[customIndex] = 'Other';
                      }
                    }
                    
                    // Also handle legacy format "Other: value"
                    const legacyOther = item.selectedOptions.find((opt: string) => opt.startsWith('Other: '));
                    if (legacyOther) {
                      item.otherValue = legacyOther.substring(7);
                      const index = item.selectedOptions.indexOf(legacyOther);
                      item.selectedOptions[index] = 'Other';
                    }
                  }
                } else {
                  item.text = visual.Text || "";
                  }
                } else {
                  // Subsequent instance: create NEW item (duplicate of same template)
                  const newItem = {
                    ...templateItem,
                    id: visualId,
                    templateId: String(matchingTemplate.TemplateID || matchingTemplate.PK_ID), // CRITICAL: Use TemplateID field for dropdown lookup!
                    visualRecordId: visualId
                  };
                  
                  const hasAnswersField = visual.Answers !== undefined && visual.Answers !== null && visual.Answers !== "";

                  if (newItem.answerType === 1) {
                    if (hasAnswersField) {
                      newItem.answer = visual.Answers;
                      newItem.text = visual.Text || newItem.originalText || "";
                    } else if (visual.Text === "Yes" || visual.Text === "No") {
                      newItem.answer = visual.Text;
                      newItem.text = newItem.originalText || "";
                    }
                  } else if (newItem.answerType === 2) {
                    if (hasAnswersField) {
                      newItem.selectedOptions = visual.Answers.split(",").map((s: string) => s.trim());
                      newItem.text = visual.Text || newItem.originalText || "";
                    } else if (visual.Text) {
                      newItem.selectedOptions = visual.Text.split(",").map((s: string) => s.trim());
                    }

                    // CRITICAL FIX: Extract custom "Other" value (supports both old "Other: value" and new "value" formats)
                    if (newItem.selectedOptions) {
                      // Find any custom values (not in the predefined dropdown list)
                      const dropdownOptions = this.visualDropdownOptions[newItem.templateId] || [];
                      const customValues = newItem.selectedOptions.filter((opt: string) => 
                        !dropdownOptions.includes(opt) && opt !== 'Other'
                      );
                      
                      if (customValues.length > 0) {
                        // Store the custom value and add "Other" to selectedOptions
                        newItem.otherValue = customValues[0];
                        // Replace custom value with "Other" in array for checkbox consistency
                        const customIndex = newItem.selectedOptions.indexOf(customValues[0]);
                        if (customIndex > -1) {
                          newItem.selectedOptions[customIndex] = 'Other';
                        }
                      }
                      
                      // Also handle legacy format "Other: value"
                      const legacyOther = newItem.selectedOptions.find((opt: string) => opt.startsWith('Other: '));
                      if (legacyOther) {
                        newItem.otherValue = legacyOther.substring(7);
                        const index = newItem.selectedOptions.indexOf(legacyOther);
                        newItem.selectedOptions[index] = 'Other';
                      }
                    }
                  } else {
                    newItem.text = visual.Text || "";
                  }
                  
                  // Add the new instance to the array
                  items.push(newItem);
                  console.log(`[Visual Load] Created duplicate instance of template ${matchingTemplate.PK_ID} with VisualID ${visualId}`);
                }
              };

              if (this.organizedData[visual.Category]) {
                updateOrCreateItemData(this.organizedData[visual.Category].comments);
                updateOrCreateItemData(this.organizedData[visual.Category].limitations);
                updateOrCreateItemData(this.organizedData[visual.Category].deficiencies);
              }
            }
          }
        });
      }

      await new Promise(resolve => setTimeout(resolve, 500));
      const photosPromise = this.loadExistingPhotos();

      if (awaitPhotos) {
        await photosPromise;
      } else {
        this.photoHydrationPromise = photosPromise.finally(() => {
          this.photoHydrationPromise = null;
        });
      }
    } catch (error) {
      console.error('Error loading existing visual selections:', error);
    }
  }

  toggleSection(section: string) {
    // PERFORMANCE OPTIMIZATION: Use OnPush-compatible state management
    this.expandedSections = {
      ...this.expandedSections,
      [section]: !this.expandedSections[section]
    };
    
    // PERFORMANCE: Mark cached values as dirty when sections change
    this.markSpacerHeightDirty();
    
    // CRITICAL: Detach change detection during DOM-heavy operations to prevent lag
    this.changeDetectorRef.detach();
    
    // Use RAF to ensure smooth animation and re-attach change detection
    requestAnimationFrame(() => {
      this.changeDetectorRef.reattach();
      this.changeDetectorRef.detectChanges();
    });
  }

  // Check if Structural Systems section should be disabled
  isStructuralSystemsDisabled(): boolean {
    return this.serviceData.StructuralSystemsStatus === 'Provided in Home Inspection Report';
  }

  // PERFORMANCE FIX: Dedicated handler for Structural Systems header click
  // Ensures header is clickable anywhere except the dropdown
  onStructuralHeaderClick(event: Event): void {
    // Don't toggle if disabled
    if (this.isStructuralSystemsDisabled()) {
      return;
    }
    
    // Check if click came from the dropdown (shouldn't happen due to stopPropagation, but safety check)
    const target = event.target as HTMLElement;
    if (target.tagName === 'SELECT' || target.closest('select') || target.closest('.structural-status-subtitle')) {
      return; // Don't toggle if clicking on dropdown
    }
    
    // Toggle the section
    this.toggleSection('structural');
  }

  // Show popup to enter custom "Other" value
  async showOtherInputPopup(fieldName: string, fieldLabel: string, previousValue?: string): Promise<void> {
    const alert = await this.alertController.create({
      header: fieldLabel,
      cssClass: 'custom-other-alert',
      inputs: [
        {
          name: 'customValue',
          type: 'text',
          placeholder: 'Enter custom value...',
          value: previousValue || this.customOtherValues[fieldName] || ''
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          handler: () => {
            // Revert dropdown to previous value if they cancel
            const serviceFields = ['InAttendance', 'WeatherConditions', 'OutdoorTemperature', 'OccupancyFurnishings',
                                   'FirstFoundationType', 'SecondFoundationType', 'ThirdFoundationType',
                                   'SecondFoundationRooms', 'ThirdFoundationRooms', 'OwnerOccupantInterview'];
            const projectFields = ['TypeOfBuilding', 'Style'];

            if (serviceFields.includes(fieldName)) {
              this.serviceData[fieldName] = previousValue || '';
            } else if (projectFields.includes(fieldName)) {
              this.projectData[fieldName] = previousValue || '';
            }
          }
        },
        {
          text: 'Save',
          handler: (data) => {
            const customValue = data.customValue?.trim();

            if (!customValue) {
              // If empty, revert to previous value
              const serviceFields = ['InAttendance', 'WeatherConditions', 'OutdoorTemperature', 'OccupancyFurnishings',
                                     'FirstFoundationType', 'SecondFoundationType', 'ThirdFoundationType',
                                     'SecondFoundationRooms', 'ThirdFoundationRooms', 'OwnerOccupantInterview'];
              const projectFields = ['TypeOfBuilding', 'Style'];

              if (serviceFields.includes(fieldName)) {
                this.serviceData[fieldName] = previousValue || '';
              } else if (projectFields.includes(fieldName)) {
                this.projectData[fieldName] = previousValue || '';
              }
              return true;
            }

            // Process the custom value AFTER alert dismisses to avoid dropdown staying open
            setTimeout(async () => {
              // Close any open select dropdowns by blurring the active element (mobile fix)
              const activeElement = document.activeElement as HTMLElement;
              if (activeElement && activeElement.tagName === 'SELECT') {
                activeElement.blur();
              }

              // Store in customOtherValues
              this.customOtherValues[fieldName] = customValue;

              // Determine if this is a service field or project field
              const serviceFields = ['InAttendance', 'WeatherConditions', 'OutdoorTemperature', 'OccupancyFurnishings',
                                     'FirstFoundationType', 'SecondFoundationType', 'ThirdFoundationType',
                                     'SecondFoundationRooms', 'ThirdFoundationRooms', 'OwnerOccupantInterview'];
              const projectFields = ['TypeOfBuilding', 'Style'];

              // IMPORTANT: Add to dropdown FIRST, then set the field value
              this.addCustomOptionToDropdown(fieldName, customValue);

              // Update the local field value with custom text and save
              if (serviceFields.includes(fieldName)) {
                this.serviceData[fieldName] = customValue;
                await this.onServiceFieldChange(fieldName, customValue);
              } else if (projectFields.includes(fieldName)) {
                this.projectData[fieldName] = customValue;
                await this.onProjectFieldChange(fieldName, customValue);
              }

              // Force change detection to update the UI
              this.changeDetectorRef.detectChanges();
              
              // Additional blur to ensure dropdown closes on mobile
              setTimeout(() => {
                const selectElements = document.querySelectorAll('select');
                selectElements.forEach(select => {
                  if (select.value === customValue || select.name === fieldName) {
                    select.blur();
                  }
                });
              }, 100);
            }, 200);

            return true; // Close alert immediately
          }
        }
      ]
    });

    await alert.present();
  }

  // Add custom value to dropdown options so it displays correctly
  addCustomOptionToDropdown(fieldName: string, customValue: string) {
    const addOption = (options: string[] | undefined): string[] | undefined => {
      if (!options) {
        return options;
      }
      if (options.includes(customValue)) {
        return options;
      }
      const updated = [...options];
      const otherIndex = updated.indexOf('Other');
      if (otherIndex > -1) {
        updated.splice(otherIndex, 0, customValue);
      } else {
        updated.push(customValue);
      }
      return updated;
    };

    switch (fieldName) {
      case 'InAttendance':
        this.inAttendanceOptions = addOption(this.inAttendanceOptions) || [];
        break;
      case 'WeatherConditions':
        this.weatherConditionsOptions = addOption(this.weatherConditionsOptions) || [];
        break;
      case 'OutdoorTemperature':
        this.outdoorTemperatureOptions = addOption(this.outdoorTemperatureOptions) || [];
        break;
      case 'OccupancyFurnishings':
        this.occupancyFurnishingsOptions = addOption(this.occupancyFurnishingsOptions) || [];
        break;
      case 'FirstFoundationType':
        this.firstFoundationTypeOptions = addOption(this.firstFoundationTypeOptions) || [];
        break;
      case 'SecondFoundationType':
        this.secondFoundationTypeOptions = addOption(this.secondFoundationTypeOptions) || [];
        break;
      case 'ThirdFoundationType':
        this.thirdFoundationTypeOptions = addOption(this.thirdFoundationTypeOptions) || [];
        break;
      case 'SecondFoundationRooms':
        this.secondFoundationRoomsOptions = addOption(this.secondFoundationRoomsOptions) || [];
        break;
      case 'ThirdFoundationRooms':
        this.thirdFoundationRoomsOptions = addOption(this.thirdFoundationRoomsOptions) || [];
        break;
      case 'OwnerOccupantInterview':
        this.ownerOccupantInterviewOptions = addOption(this.ownerOccupantInterviewOptions) || [];
        break;
      case 'TypeOfBuilding':
        this.typeOfBuildingOptions = addOption(this.typeOfBuildingOptions) || [];
        break;
      case 'Style':
        this.styleOptions = addOption(this.styleOptions) || [];
        break;
      default:
        break;
    }
  }

  // Load custom values from database into dropdown options (called after loading data)
  loadCustomValuesIntoDropdowns() {
    // CRITICAL FIX: Exclude multi-select fields (InAttendance, SecondFoundationRooms, ThirdFoundationRooms)
    // They handle their own custom values via parseXXXField() methods
    const fieldMappings = [
      { fieldName: 'WeatherConditions', dataSource: this.serviceData, options: this.weatherConditionsOptions },
      { fieldName: 'OutdoorTemperature', dataSource: this.serviceData, options: this.outdoorTemperatureOptions },
      { fieldName: 'OccupancyFurnishings', dataSource: this.serviceData, options: this.occupancyFurnishingsOptions },
      { fieldName: 'FirstFoundationType', dataSource: this.serviceData, options: this.firstFoundationTypeOptions },
      { fieldName: 'SecondFoundationType', dataSource: this.serviceData, options: this.secondFoundationTypeOptions },
      { fieldName: 'ThirdFoundationType', dataSource: this.serviceData, options: this.thirdFoundationTypeOptions },
      { fieldName: 'OwnerOccupantInterview', dataSource: this.serviceData, options: this.ownerOccupantInterviewOptions },
      { fieldName: 'TypeOfBuilding', dataSource: this.projectData, options: this.typeOfBuildingOptions },
      { fieldName: 'Style', dataSource: this.projectData, options: this.styleOptions }
    ];

    fieldMappings.forEach(mapping => {
      const value = mapping.dataSource?.[mapping.fieldName];
      if (value && value.trim() !== '') {
        this.customOtherValues[mapping.fieldName] = value;
        this.addCustomOptionToDropdown(mapping.fieldName, value);
        mapping.dataSource[mapping.fieldName] = value;
      }
    });
  }

  // Handle Structural Systems status change
  onStructuralSystemsStatusChange(value: string) {

    // Store in local serviceData with the UI property name
    this.serviceData.StructuralSystemsStatus = value;

    // No need to collapse section - it's always visible now
    // Just trigger change detection for conditional content visibility
    this.changeDetectorRef.detectChanges();

    // Save to Services table using the correct database column name "StructStat"
    this.autoSaveServiceField('StructStat', value);
  }

  private queueStructuralStatusWidthUpdate(): void {
    if (typeof window === 'undefined') {
      return;
    }
    if (this.structuralWidthRaf) {
      cancelAnimationFrame(this.structuralWidthRaf);
    }
    this.structuralWidthRaf = requestAnimationFrame(() => {
      this.structuralWidthRaf = undefined;
      this.updateStructuralStatusWidth();
    });
  }

  private updateStructuralStatusWidth(): void {
    const selectEl = this.structuralStatusSelect?.nativeElement;
    if (!selectEl || typeof window === 'undefined') {
      return;
    }

    const computed = window.getComputedStyle(selectEl);
    const mirror = this.ensureStructuralStatusMirror(computed);

    const selectedOption = selectEl.selectedOptions?.[0] ?? selectEl.options[selectEl.selectedIndex];
    const fallbackText = selectEl.options.length > 0 ? selectEl.options[0].text : 'Select Status';
    const labelText = (selectedOption?.text ?? fallbackText ?? '').trim() || fallbackText;
    mirror.textContent = labelText;

    const paddingLeft = parseFloat(computed.paddingLeft || '0');
    const paddingRight = parseFloat(computed.paddingRight || '0');
    const extraSpace = paddingLeft + paddingRight + 36;
    const desiredWidth = mirror.getBoundingClientRect().width + extraSpace;
    const minWidth = 170;
    const maxWidth = 240;
    const containerWidth = selectEl.parentElement?.clientWidth ?? maxWidth;
    const availableWidth = Math.max(minWidth, Math.min(containerWidth, maxWidth));
    const finalWidth = Math.min(Math.max(desiredWidth, minWidth), availableWidth);

    selectEl.style.whiteSpace = 'normal';
    selectEl.style.lineHeight = '1.35';
    selectEl.style.width = `${finalWidth}px`;
    selectEl.style.minWidth = `${minWidth}px`;
    selectEl.style.maxWidth = `${availableWidth}px`;
  }

  private ensureStructuralStatusMirror(computed: CSSStyleDeclaration): HTMLSpanElement {
    if (!this.structuralStatusMirror || !document.body.contains(this.structuralStatusMirror)) {
      this.structuralStatusMirror = document.createElement('span');
      Object.assign(this.structuralStatusMirror.style, {
        position: 'absolute',
        visibility: 'hidden',
        whiteSpace: 'pre-line',
        pointerEvents: 'none',
        opacity: '0',
        zIndex: '-1'
      });
      document.body.appendChild(this.structuralStatusMirror);
    }

    const mirror = this.structuralStatusMirror;
    mirror.style.font = computed.font || `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} / ${computed.lineHeight} ${computed.fontFamily}`;
    mirror.style.fontSize = computed.fontSize;
    mirror.style.fontFamily = computed.fontFamily;
    mirror.style.fontWeight = computed.fontWeight;
    mirror.style.letterSpacing = computed.letterSpacing;
    mirror.style.whiteSpace = 'pre-line';

    return mirror;
  }

  scrollToSection(section: string) {
    // Find the section header element
    const sectionElement = document.querySelector(`.section-header[data-section="${section}"]`);
    if (sectionElement) {
      // Scroll to the element with smooth behavior and a small offset from the top
      sectionElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      
      // Optionally collapse the section after scrolling
      setTimeout(() => {
        this.expandedSections[section] = false;
        this.markSpacerHeightDirty();
      }, 500);
    }
  }
  
  // PERFORMANCE OPTIMIZED: Cache spacer height to avoid repeated calculations
  private cachedSpacerHeight: number = 20;
  private spacerHeightDirty: boolean = true;
  
  getBottomSpacerHeight(): number {
    // OPTIMIZATION: Only recalculate when sections change
    if (!this.spacerHeightDirty) {
      return this.cachedSpacerHeight;
    }
    
    // Quick check without complex operations
    const hasExpandedSection = Object.values(this.expandedSections).some(expanded => expanded);
    
    // SIMPLIFIED: Static spacing based on expanded state
    // Removed complex DOM queries and loops for performance
    this.cachedSpacerHeight = hasExpandedSection ? 50 : 20;
    this.spacerHeightDirty = false;
    
    return this.cachedSpacerHeight;
  }
  
  // PERFORMANCE: Mark spacer height as dirty when sections change
  private markSpacerHeightDirty(): void {
    this.spacerHeightDirty = true;
  }

  // PERFORMANCE OPTIMIZED: Throttled scroll to section with minimal DOM queries
  private scrollThrottleTimeout: any = null;
  
  scrollToCurrentSectionTop() {
    // CRITICAL: Throttle scroll operations to prevent excessive calls
    if (this.scrollThrottleTimeout) {
      clearTimeout(this.scrollThrottleTimeout);
    }
    
    this.scrollThrottleTimeout = setTimeout(() => {
      this.performOptimizedScroll();
    }, 100); // Throttle to 100ms max frequency
  }
  
  private performOptimizedScroll() {
    // SIMPLIFIED: Removed heavy DOM calculations for performance
    // Just scroll to the first expanded section without complex position calculations
    const expandedSection = Object.keys(this.expandedSections).find(key => this.expandedSections[key]);
    
    if (expandedSection) {
      const sectionElement = document.querySelector(`[data-section="${expandedSection}"]`);
      if (sectionElement) {
        sectionElement.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'start',
          inline: 'nearest'
        });
      }
    } else {
      // No sections expanded, scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
  
  
  // TrackBy functions moved to top of class (lines ~676-703) for better organization
  
  // PERFORMANCE OPTIMIZED: Track which accordions are expanded
  onAccordionChange(event: any) {
    // OPTIMIZATION: Reduce scroll manipulation frequency
    const currentScrollY = window.scrollY;
    let needsScrollRestore = false;

    // Check if the accordion state actually changed to avoid unnecessary operations
    const newValue = event.detail.value;
    const newExpandedAccordions = newValue
      ? (Array.isArray(newValue) ? newValue : [newValue])
      : [];

    // Only proceed if there's an actual change
    if (JSON.stringify(this.expandedAccordions.sort()) !== JSON.stringify(newExpandedAccordions.sort())) {
      this.expandedAccordions = newExpandedAccordions;
      needsScrollRestore = true;
      this.markSpacerHeightDirty(); // Mark cache as dirty
    }

    // OPTIMIZATION: Only restore scroll if there was actually a change (mobile only - skip on webapp)
    if (needsScrollRestore && !this.platform.isWeb()) {
      console.log('[SCROLL DEBUG] Restoring scroll position (mobile only):', currentScrollY);
      // Use RAF for smoother scroll restoration
      requestAnimationFrame(() => {
        if (Math.abs(window.scrollY - currentScrollY) > 5) { // Only restore if scroll changed significantly
          window.scrollTo(0, currentScrollY);
        }
      });
    } else if (needsScrollRestore && this.platform.isWeb()) {
      console.log('[SCROLL DEBUG] Skipping scroll restoration for webapp');
    }
  }
  
  onRoomAccordionChange(event: any) {
    const roomName = event.detail.value;
    
    if (roomName && !this.isRoomSelected(roomName)) {
      // Auto-select room when accordion is expanded
      this.toggleRoomSelection(roomName, { detail: { checked: true } });
    }
  }
  
  // Ensure accordion values are synced without causing UI flicker
  private restoreAccordionState() {
    // Simply ensure accordion values are set if needed
    if (this.visualAccordionGroup && this.expandedAccordions.length > 0) {
      this.visualAccordionGroup.value = this.expandedAccordions;
    }
    // No need to mess with expandedSections - they should maintain their state naturally
  }
  
  getSectionCompletion(section: string): number {
    // Calculate completion percentage based on filled fields
    switch(section) {
      case 'structural':
        // If status is "Provided in Home Inspection Report", section is considered 100% complete
        if (this.serviceData.StructuralSystemsStatus === 'Provided in Home Inspection Report') {
          return 100;
        }

        // Count all required items across all categories
        let totalRequired = 0;
        let completedRequired = 0;

        // Iterate through all categories
        for (const category of this.visualCategories) {
          if (!this.organizedData[category]) continue;

          // Check all sections (comments, limitations, deficiencies)
          const sections: ('comments' | 'limitations' | 'deficiencies')[] = ['comments', 'limitations', 'deficiencies'];

          for (const sectionType of sections) {
            const items = this.organizedData[category][sectionType] || [];

            for (const item of items) {
              // Only count required items
              if (item.required) {
                totalRequired++;

                // Check if this required item has been answered
                const key = `${category}_${item.id}`;

                // For Yes/No questions (AnswerType 1)
                if (item.answerType === 1) {
                  if (item.answer === 'Yes' || item.answer === 'No') {
                    completedRequired++;
                  }
                }
                // For multi-select questions (AnswerType 2)
                else if (item.answerType === 2) {
                  if (item.selectedOptions && item.selectedOptions.length > 0) {
                    completedRequired++;
                  }
                }
                // For text questions (AnswerType 0 or undefined)
                else {
                  // Check if item is selected (checkbox checked)
                  if (this.selectedItems[key]) {
                    completedRequired++;
                  }
                }
              }
            }
          }
        }

        // Return percentage, or 0 if no required fields
        if (totalRequired === 0) return 0;
        return Math.round((completedRequired / totalRequired) * 100);

      case 'elevation':
        // Base Station is required for 100% completion
        const baseStationSelected = this.selectedRooms['Base Station'] === true;

        // Check if we have at least one other room selected (besides Base Station)
        const otherRoomsSelected = Object.keys(this.selectedRooms).filter(
          room => room !== 'Base Station' && this.selectedRooms[room] === true
        ).length > 0;

        // Calculate completion: Base Station is 50%, having at least one other room is another 50%
        let elevationCompletion = 0;
        if (baseStationSelected) {
          elevationCompletion = 50;
          if (otherRoomsSelected) {
            elevationCompletion = 100;
          }
        }

        return elevationCompletion;

      default:
        return 0;
    }
  }
  
  
  // Room elevation helper methods
  private saveDebounceTimer: any;
  
  async onRoomNotesChange(roomName: string) {
    const roomId = this.efeRecordIds[roomName];
    if (!roomId) {
      // Room not saved yet, just save to draft
      if (this.saveDebounceTimer) {
        clearTimeout(this.saveDebounceTimer);
      }
      this.saveDebounceTimer = setTimeout(() => {
        this.saveDraft();
      }, 1000);
      return;
    }
    
    // Debounce the update
    if (this.roomNotesDebounce[roomName]) {
      clearTimeout(this.roomNotesDebounce[roomName]);
    }
    
    this.roomNotesDebounce[roomName] = setTimeout(async () => {
      try {
        const notes = this.roomElevationData[roomName].notes || '';
        
        // Update Services_EFE record with Notes using EFEID field
        const updateData = { Notes: notes };
        const query = `EFEID=${roomId}`;
        
        await this.caspioService.put(`/tables/Services_EFE/records?q.where=${encodeURIComponent(query)}`, updateData).toPromise();
        // Don't show toast for notes to avoid interrupting user typing
      } catch (error) {
        console.error('Error updating room notes:', error);
      }
      
      // Also save to draft
      this.saveDraft();
      delete this.roomNotesDebounce[roomName];
    }, 1500); // Wait 1.5 seconds after user stops typing
  }

  // Handle elevation point value change
  onElevationPointChange(roomName: string, point: any) {
    
    // Save to draft after a delay
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDraft();
    }, 1000);
  }

  // Take photo for elevation point
  async takePhotoForElevationPoint(roomName: string, point: any, event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    try {
      // Initialize photos array if needed
      if (!point.photos) {
        point.photos = [];
      }
      
      // Create file input for camera
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'camera' as any;
      input.multiple = true; // Allow multiple photos
      
      const filesSelected = new Promise<FileList | null>((resolve) => {
        input.onchange = (event: any) => {
          resolve(event.target?.files || null);
        };
      });
      
      input.click();
      
      const files = await filesSelected;
      if (files && files.length > 0) {
        // Convert files to preview URLs
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const objectUrl = URL.createObjectURL(file);
          
          point.photos.push({
            file: file,
            url: objectUrl,
            thumbnailUrl: objectUrl,
            name: file.name,
            isObjectUrl: true
          });
        }
        
        // Update photo count
        point.photoCount = point.photos.length;
        
        // PERFORMANCE: Trigger change detection with OnPush strategy
        this.changeDetectorRef.detectChanges();
        
        // Success toast removed per user request
        
        // TODO: Upload to Caspio when saving
        this.saveDraft();
      }
    } catch (error) {
      console.error('Error taking photo for elevation point:', error);
      await this.showToast('Failed to capture photo', 'danger');
    }
  }

  // Helper method to construct Caspio file URL
  async getCaspioFileUrl(filePath: string): Promise<string> {
    if (!filePath) return '';
    
    // If it's already a full URL or blob URL, return as is
    if (filePath.startsWith('http') || filePath.startsWith('blob:')) {
      return filePath;
    }
    
    const account = this.caspioService.getAccountID();
    const token = await this.caspioService.getValidToken().toPromise();
    
    // Ensure path starts with /
    const path = filePath.startsWith('/') ? filePath : `/${filePath}`;
    return `https://${account}.caspio.com/rest/v2/files${path}?access_token=${token}`;
  }
  
  // View room photo with annotation support (redirects to viewElevationPhoto)
  async viewRoomPhoto(photo: any, roomName: string, point: any) {
    // Use the new annotation-enabled viewElevationPhoto method
    await this.viewElevationPhoto(photo, roomName, point);
  }
  
  // Save room photo caption/annotation
  async saveRoomPhotoCaption(photo: any, roomName: string, point: any) {
    try {
      
      // Update Services_EFE_Points_Attach record with annotation
      if (photo.attachId && photo.annotation !== undefined) {
        // Update the annotation in the database
        const updateData = { Annotation: photo.annotation || '' };
        await this.caspioService.updateServicesEFEPointsAttach(photo.attachId, updateData).toPromise();
      }
      
      // Don't show toast for every blur event
    } catch (error) {
      console.error('Error saving room photo caption:', error);
      // Don't show error toast for every blur
    }
  }
  
  // Delete room photo
  async deleteRoomPhoto(photo: any, roomName: string, point: any, silent: boolean = false) {
    try {
      // Skip confirmation if silent deletion (used when replacing photos)
      if (silent) {
        try {
                // Delete from Services_EFE_Points_Attach table if attachId exists
                if (photo.attachId) {
                  await this.caspioService.deleteServicesEFEPointsAttach(photo.attachId).toPromise();
                }
                
                // Remove from point's photos array
                if (point.photos) {
                  const index = point.photos.indexOf(photo);
                  if (index > -1) {
                    point.photos.splice(index, 1);
                    point.photoCount = point.photos.length;
                  }
                }
              } catch (error) {
                console.error('Error deleting room photo:', error);
                if (!silent) {
                  await this.showToast('Failed to delete photo', 'danger');
                }
              }
        return;
      }
      
      // Confirm deletion if not silent
      const alert = await this.alertController.create({
        header: 'Delete Photo',
        message: 'Are you sure you want to delete this photo?',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            cssClass: 'alert-button-cancel'
          },
          {
            text: 'Delete',
            cssClass: 'alert-button-confirm',
            handler: async () => {
              try {
                // Delete from database if attachId exists
                if (photo.attachId) {
                  await this.caspioService.deleteServicesEFEPointsAttach(photo.attachId).toPromise();
                }
                
                // Remove from UI
                if (point.photos) {
                  const index = point.photos.indexOf(photo);
                  if (index > -1) {
                    point.photos.splice(index, 1);
                    point.photoCount = point.photos.length;
                  }
                }
              } catch (error) {
                console.error('Error deleting room photo:', error);
                await this.showToast('Failed to delete photo', 'danger');
              }
            }
          }
        ],
        cssClass: 'custom-document-alert'
      });
      
      await alert.present();
    } catch (error) {
      console.error('Error in deleteRoomPhoto:', error);
    }
  }
  
  // Update room point photo attachment with annotations (similar to updatePhotoAttachment for Structural Systems)
  async updateRoomPointPhotoAttachment(attachId: string, file: File, annotations?: any, originalFile?: File, caption?: string): Promise<void> {
    try {
      
      // Validate attachId
      if (!attachId || attachId === 'undefined' || attachId === 'null') {
        console.error('Invalid AttachID for room point photo:', attachId);
        await this.showToast('Cannot update photo: Invalid attachment ID', 'danger');
        return;
      }
      
      // Prepare update data with Drawings and Annotation fields
      const updateData: any = {};
      
      // Save caption to Annotation field (without photoType prefix)
      if (caption !== undefined) {
        updateData.Annotation = caption || '';
      }
      
      // Process annotation data for Drawings field
      if (annotations) {
        let drawingsData = '';
        
        if (typeof annotations === 'string') {
          drawingsData = annotations;
        } else if (typeof annotations === 'object') {
          // Convert to JSON string
          try {
            drawingsData = JSON.stringify(annotations);
          } catch (e) {
            console.error('Failed to stringify annotations:', e);
            drawingsData = '';
          }
        }
        
        // Compress if needed
        if (drawingsData) {
          drawingsData = compressAnnotationData(drawingsData, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });
          updateData.Drawings = drawingsData;
        }
      }
      
      // Update the Services_EFE_Points_Attach record
      if (Object.keys(updateData).length > 0) {
        await this.caspioService.updateServicesEFEPointsAttach(attachId, updateData).toPromise();
      }
      
    } catch (error) {
      console.error('Error updating room point photo attachment:', error);
      await this.showToast('Failed to update photo annotations', 'danger');
      throw error;
    }
  }
  
  // View elevation photo with annotation support (matching Structural Systems)
  async viewElevationPhoto(photo: any, roomName?: string, point?: any) {
    
    try {
      // Validate photo has an ID
      if (!photo.attachId && !photo.AttachID && !photo.id) {
        console.error('Photo missing AttachID:', photo);
        await this.showToast('Cannot edit photo: Missing attachment ID', 'danger');
        return;
      }
      
      const attachId = photo.attachId || photo.AttachID || photo.id;
      
      // Try to get a valid image URL
      let imageUrl = photo.url || photo.thumbnailUrl || photo.displayUrl;
      
      // If no valid URL and we have a file path, try to fetch it
      if ((!imageUrl || imageUrl === 'assets/img/photo-placeholder.png') && photo.filePath) {
        try {
          const fetchedImage = await this.caspioService.getImageFromFilesAPI(photo.filePath).toPromise();
          if (fetchedImage && fetchedImage.startsWith('data:')) {
            imageUrl = fetchedImage;
            // Update the photo object for future use
            photo.url = fetchedImage;
            photo.originalUrl = fetchedImage;
          }
        } catch (err) {
          console.error('Failed to fetch image from file path:', err);
        }
      }
      
      // Fallback to placeholder if still no URL
      if (!imageUrl) {
        imageUrl = 'assets/img/photo-placeholder.png';
      }
      
      const photoName = photo.name || 'Elevation Photo';
      
      // Use original URL if available (for re-editing annotations)
      const originalImageUrl = photo.originalUrl || photo.url || imageUrl;
      
      // Parse existing annotations (matching Structural Systems logic)
      let existingAnnotations = null;
      const annotationSources = [
        photo.rawDrawingsString,
        photo.annotations,
        photo.annotationData,
        photo.Drawings
      ];
      
      for (const source of annotationSources) {
        if (source) {
          try {
            if (typeof source === 'string') {
              existingAnnotations = decompressAnnotationData(source);
            } else {
              existingAnnotations = source;
            }
            
            if (existingAnnotations) {
              break;
            }
          } catch (e) {
          }
        }
      }
      
      // Get existing caption from photo object
      const rawCaption = photo.caption || photo.Annotation || '';
      const existingCaption = this.extractCaptionFromAnnotation(rawCaption);
      console.log(`[MEASUREMENT DEBUG] Raw caption:`, rawCaption);
      console.log(`[MEASUREMENT DEBUG] Cleaned caption:`, existingCaption);

      // Open annotation modal directly (matching Structural Systems)
      const modal = await this.modalController.create({
        component: FabricPhotoAnnotatorComponent,
        componentProps: {
          imageUrl: originalImageUrl,
          existingAnnotations: existingAnnotations,
          existingCaption: existingCaption, // CRITICAL: Pass cleaned caption to photo editor
          photoData: {
            ...photo,
            AttachID: attachId,
            id: attachId,
            caption: existingCaption // Ensure caption is in photoData
          }
        },
        cssClass: 'fullscreen-modal'
      });
      
      await modal.present();
      const { data } = await modal.onDidDismiss();
      
      if (data && data.annotatedBlob) {
        // Update the photo with new annotations
        const annotatedFile = new File([data.annotatedBlob], photoName, { type: 'image/jpeg' });
        const annotationsData = data.annotationData || data.annotationsData;
        
        // Get original file if provided
        let originalFile = null;
        if (data.originalBlob) {
          originalFile = data.originalBlob instanceof File 
            ? data.originalBlob 
            : new File([data.originalBlob], `original_${photoName}`, { type: 'image/jpeg' });
        }
        
        // Update the attachment with new annotations and caption
        await this.updateRoomPointPhotoAttachment(attachId, annotatedFile, annotationsData, originalFile, data.caption);
        
        // Update local photo data
        if (point && point.photos) {
          const photoIndex = point.photos.findIndex((p: any) => 
            (p.attachId || p.AttachID || p.id) === attachId
          );
          
          if (photoIndex !== -1) {
            // Store original URL if not already stored
            if (!point.photos[photoIndex].originalUrl) {
              point.photos[photoIndex].originalUrl = point.photos[photoIndex].url;
            }
            
            // Update display URL with annotated version
            const newUrl = URL.createObjectURL(data.annotatedBlob);
            point.photos[photoIndex].displayUrl = newUrl;
            point.photos[photoIndex].hasAnnotations = true;
            
            // Update caption from editor (without photoType prefix)
            if (data.caption !== undefined) {
              point.photos[photoIndex].caption = data.caption;
            }
            
            // Store annotations data
            if (annotationsData) {
              point.photos[photoIndex].annotations = annotationsData;
              point.photos[photoIndex].rawDrawingsString = typeof annotationsData === 'object' 
                ? JSON.stringify(annotationsData) 
                : annotationsData;
            }
            
            // CRITICAL FIX: Force immediate UI update by updating the main photo URL
            // This ensures the annotated version shows in thumbnail immediately
            point.photos[photoIndex].url = newUrl;
            point.photos[photoIndex].thumbnailUrl = newUrl;
          }
        }
        
        // [WEBAPP FIX] Prevent scroll jumping during change detection
        const currentScroll = window.scrollY;
        
        // Trigger change detection and force UI refresh for annotations
        this.changeDetectorRef.detectChanges();
        
        // [WEBAPP FIX] Immediately restore scroll after first change detection
        if (this.platform.isWeb()) {
          window.scrollTo(0, currentScroll);
        }
        
        // Additional UI update - force template refresh for annotation visibility
        setTimeout(() => {
          const scrollBeforeUpdate = window.scrollY;
          this.changeDetectorRef.detectChanges();
          
          // [WEBAPP FIX] Restore scroll after second change detection
          if (this.platform.isWeb()) {
            window.scrollTo(0, scrollBeforeUpdate);
          }
        }, 100);
      }
      
    } catch (error) {
      console.error('Error viewing elevation photo:', error);
      await this.showToast('Failed to view photo', 'danger');
    }
  }
  
  // Save and submit functions
  saveDraft() {
    try {
      // Save to localStorage as draft (non-async version for auto-save)
      const draftKey = `efe_template_${this.projectId}_${this.serviceId}`;
      const draftData = {
        formData: this.formData,
        // Removed roomElevationData to prevent memory issues
        savedAt: new Date().toISOString()
      };
      
      localStorage.setItem(draftKey, JSON.stringify(draftData));
    } catch (error) {
      console.error('Error saving draft:', error);
    }
  }

  async saveTemplate() {
    // Save to localStorage as draft
    this.saveDraft();
    this.showSaveStatus('Draft saved locally', 'success');
    await this.showToast('Template saved as draft', 'success');
  }
  
  async submitTemplate() {
    // Validate all required Project Information fields
    const requiredProjectFields = ['ClientName', 'InspectorName',
                                    'YearBuilt', 'SquareFeet', 'TypeOfBuilding', 'Style'];
    const requiredServiceFields = ['InAttendance', 'OccupancyFurnishings', 'WeatherConditions', 'OutdoorTemperature', 'StructuralSystemsStatus'];

    const missingProjectFields = requiredProjectFields.filter(field => !this.projectData[field]);
    const missingServiceFields = requiredServiceFields.filter(field => !this.serviceData[field]);
    
    if (missingProjectFields.length > 0 || missingServiceFields.length > 0) {
      const allMissing = [...missingProjectFields, ...missingServiceFields];
      await this.showToast(`Please fill in all required fields: ${allMissing.join(', ')}`, 'warning');
      
      // Scroll to Project Information section if there are missing fields
      const projectSection = document.querySelector('.section-card');
      if (projectSection) {
        projectSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }

    const loading = await this.loadingController.create({
      message: 'Submitting evaluation...'
    });
    await loading.present();
    
    try {
      // TODO: Submit to Caspio Service_EFE table
      // This will be implemented based on your specific requirements
      
      const submitData = {
        ProjectID: this.projectId,
        ServiceID: this.serviceId,
        ...this.formData,
        SubmittedAt: new Date().toISOString()
      };
      
      // For now, just simulate success
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      await loading.dismiss();
      await this.showToast('Evaluation submitted successfully', 'success');
      
      // Clear draft
      const draftKey = `efe_template_${this.projectId}_${this.serviceId}`;
      localStorage.removeItem(draftKey);

      // Navigate back
      this.router.navigate(['/project', this.projectId]);
      
    } catch (error) {
      console.error('Error submitting template:', error);
      await loading.dismiss();
      await this.showToast('Failed to submit evaluation', 'danger');
    }
  }

  async finalizeReport() {
    const incompleteAreas: string[] = [];

    // Check required Project Information fields
    const requiredProjectFields = {
      'ClientName': 'Client Name',
      'InspectorName': 'Inspector Name',
      'YearBuilt': 'Year Built',
      'SquareFeet': 'Square Feet',
      'TypeOfBuilding': 'Building Type',
      'Style': 'Style'
    };

    Object.entries(requiredProjectFields).forEach(([field, label]) => {
      if (!this.projectData[field]) {
        incompleteAreas.push(`Project Information: ${label}`);
      }
    });

    // Check required Service fields
    const requiredServiceFields = {
      'InAttendance': 'In Attendance',
      'OccupancyFurnishings': 'Occupancy/Furnishings',
      'WeatherConditions': 'Weather Conditions',
      'OutdoorTemperature': 'Outdoor Temperature',
      'StructuralSystemsStatus': 'Structural Systems Status'
    };

    Object.entries(requiredServiceFields).forEach(([field, label]) => {
      if (!this.serviceData[field]) {
        incompleteAreas.push(`Project Information: ${label}`);
      }
    });

    // Check required visual items across all categories
    // Skip if Structural Systems status is "Provided in Home Inspection Report"
    const skipStructuralSystems = this.serviceData.StructuralSystemsStatus === 'Provided in Home Inspection Report';

    if (!skipStructuralSystems) {
      for (const category of this.visualCategories) {
        if (!this.organizedData[category]) continue;

        const sections: ('comments' | 'limitations' | 'deficiencies')[] = ['comments', 'limitations', 'deficiencies'];

        for (const sectionType of sections) {
          const items = this.organizedData[category][sectionType] || [];

          for (const item of items) {
            if (item.required) {
              const key = `${category}_${item.id}`;
              let isComplete = false;

              // For Yes/No questions (AnswerType 1)
              if (item.answerType === 1) {
                isComplete = item.answer === 'Yes' || item.answer === 'No';
              }
              // For multi-select questions (AnswerType 2)
              else if (item.answerType === 2) {
                isComplete = item.selectedOptions && item.selectedOptions.length > 0;
              }
              // For text questions (AnswerType 0 or undefined)
              else {
                isComplete = this.selectedItems[key] === true;
              }

              if (!isComplete) {
                const sectionLabel = sectionType.charAt(0).toUpperCase() + sectionType.slice(1);
                incompleteAreas.push(`${category} - ${sectionLabel}: ${item.name || item.text || 'Unnamed item'}`);
              }
            }
          }
        }
      }
    }

    // Check Base Station requirement for elevation plot
    const baseStationSelected = this.selectedRooms['Base Station'] === true;
    if (!baseStationSelected) {
      incompleteAreas.push('Elevation Plot: Base Station (required)');
    }

    // Check that all selected rooms (except Base Station) have FDF answered
    for (const roomName in this.selectedRooms) {
      if (this.selectedRooms[roomName] === true && !this.isBaseStation(roomName)) {
        const roomData = this.roomElevationData[roomName];
        if (!roomData || !roomData.fdf || roomData.fdf === '' || roomData.fdf === '-- Select --') {
          incompleteAreas.push(`Elevation Plot - ${roomName}: FDF (Flooring Difference Factor) required`);
        }
      }
    }

    // Show results
    if (incompleteAreas.length > 0) {
      const alert = await this.alertController.create({
        header: 'Incomplete Required Fields',
        message: `The following required fields are not complete:\n\n${incompleteAreas.map(area => `• ${area}`).join('\n')}`,
        cssClass: 'finalize-alert',
        buttons: ['OK']
      });
      await alert.present();
    } else {
      // Check if this is an update or initial finalization
      const isUpdate = this.isReportFinalized();
      const buttonText = isUpdate ? 'Update' : 'Finalize';
      const headerText = isUpdate ? 'Report Ready to Update' : 'Report Complete';
      const messageText = isUpdate
        ? 'All required fields have been completed. Your report is ready to be updated.'
        : 'All required fields have been completed. Your report is ready to be finalized.';

      const alert = await this.alertController.create({
        header: headerText,
        message: messageText,
        cssClass: 'finalize-alert',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel'
          },
          {
            text: buttonText,
            handler: () => {
              this.markReportAsFinalized();
            }
          }
        ]
      });
      await alert.present();
    }
  }

  /**
   * Mark that changes have been made to the report (enables Update button)
   */
  markReportChanged() {
    this.hasChangesAfterLastFinalization = true;
    console.log('[markReportChanged] Set hasChangesAfterLastFinalization to TRUE');
    this.changeDetectorRef.detectChanges();
  }

  /**
   * Check if report has been finalized (shows "Update" button text)
   */
  isReportFinalized(): boolean {
    const result = this.serviceData?.Status === 'Finalized' ||
                   this.serviceData?.Status === 'Updated' ||
                   this.serviceData?.Status === 'Under Review';
    console.log('[isReportFinalized] Current Status:', this.serviceData?.Status, 'Result:', result);
    return result;
  }

  /**
   * Check if Finalize/Update button should be enabled
   */
  canFinalizeReport(): boolean {
    // First check: all required fields must be filled
    if (!this.areAllRequiredFieldsFilled()) {
      console.log('[canFinalizeReport] Required fields not filled');
      return false;
    }

    // If report has been finalized/updated before, only enable if changes have been made
    if (this.isReportFinalized()) {
      console.log('[canFinalizeReport] Report is finalized, hasChanges:', this.hasChangesAfterLastFinalization);
      return this.hasChangesAfterLastFinalization;
    }

    // For initial finalization, enable if required fields are filled
    console.log('[canFinalizeReport] First finalization - enabled');
    return true;
  }

  async markReportAsFinalized() {
    const isFirstFinalization = this.serviceData.Status !== 'Finalized' &&
                                 this.serviceData.Status !== 'Updated' &&
                                 this.serviceData.Status !== 'Under Review';
    
    const loading = await this.loadingController.create({
      message: isFirstFinalization ? 'Finalizing report...' : 'Updating report...'
    });
    await loading.present();

    try {
      // Update the Services table
      const currentDateTime = new Date().toISOString();
      const updateData: any = {
        StatusDateTime: currentDateTime,  // Always update to track when report was last modified
        Status: 'Finalized'  // Set to Finalized so services table shows orange button
      };

      console.log('[EngFoundation] Finalizing report with PK_ID:', this.serviceId);
      console.log('[EngFoundation] ProjectId:', this.projectId);
      console.log('[EngFoundation] Is first finalization:', isFirstFinalization);
      console.log('[EngFoundation] Update data:', updateData);

      // Update the Services table using PK_ID (this.serviceId is actually PK_ID)
      const response = await this.caspioService.updateService(this.serviceId, updateData).toPromise();
      console.log('[EngFoundation] API Response:', response);

      // Update local state
      this.serviceData.StatusDateTime = currentDateTime;
      this.serviceData.Status = 'Finalized';
      this.serviceData.ReportFinalized = true;

      // Reset change tracking - button should be grayed out until next change
      this.hasChangesAfterLastFinalization = false;
      console.log('[EngFoundation] Reset hasChangesAfterLastFinalization to false after update');

      // Trigger change detection to update button state
      this.changeDetectorRef.detectChanges();

      console.log('[EngFoundation] Report finalized successfully');

      await loading.dismiss();

      // Show success message
      const successMessage = isFirstFinalization 
        ? 'Report finalized successfully' 
        : 'Report updated successfully';
      await this.showToast(successMessage, 'success');

      // Navigate back using Location.back() to avoid route activation conflicts
      console.log('[EngFoundation] Navigating back to project detail...');
      
      // Use setTimeout to ensure toast is shown before navigation
      setTimeout(() => {
        this.location.back();
      }, 500);

    } catch (error) {
      console.error('Error finalizing report:', error);
      await loading.dismiss();
      await this.showToast('Failed to finalize report', 'danger');
    }
  }

  // Check if all required fields are filled (used for button styling)
  areAllRequiredFieldsFilled(): boolean {
    // Check required Project Information fields
    const requiredProjectFields = {
      'ClientName': 'Client Name',
      'InspectorName': 'Inspector Name',
      'YearBuilt': 'Year Built',
      'SquareFeet': 'Square Feet',
      'TypeOfBuilding': 'Building Type',
      'Style': 'Style'
    };

    for (const field of Object.keys(requiredProjectFields)) {
      if (!this.projectData[field]) {
        return false;
      }
    }

    // Check required Service fields
    const requiredServiceFields = {
      'InAttendance': 'In Attendance',
      'OccupancyFurnishings': 'Occupancy/Furnishings',
      'WeatherConditions': 'Weather Conditions',
      'OutdoorTemperature': 'Outdoor Temperature',
      'StructuralSystemsStatus': 'Structural Systems Status'
    };

    for (const field of Object.keys(requiredServiceFields)) {
      if (!this.serviceData[field]) {
        return false;
      }
    }

    // Check required visual items across all categories
    // Skip if Structural Systems status is "Provided in Home Inspection Report"
    const skipStructuralSystems = this.serviceData.StructuralSystemsStatus === 'Provided in Home Inspection Report';

    if (!skipStructuralSystems) {
      for (const category of this.visualCategories) {
        if (!this.organizedData[category]) continue;

        const sections: ('comments' | 'limitations' | 'deficiencies')[] = ['comments', 'limitations', 'deficiencies'];

        for (const sectionType of sections) {
          const items = this.organizedData[category][sectionType] || [];

          for (const item of items) {
            if (item.required) {
              const key = `${category}_${item.id}`;
              let isComplete = false;

              // For Yes/No questions (AnswerType 1)
              if (item.answerType === 1) {
                isComplete = item.answer === 'Yes' || item.answer === 'No';
              }
              // For multi-select questions (AnswerType 2)
              else if (item.answerType === 2) {
                isComplete = item.selectedOptions && item.selectedOptions.length > 0;
              }
              // For text questions (AnswerType 0 or undefined)
              else {
                isComplete = this.selectedItems[key] === true;
              }

              if (!isComplete) {
                return false;
              }
            }
          }
        }
      }
    }

    // Check Base Station requirement for elevation plot
    const baseStationSelected = this.selectedRooms['Base Station'] === true;
    if (!baseStationSelected) {
      return false;
    }

    // Check that all selected rooms (except Base Station) have FDF answered
    for (const roomName in this.selectedRooms) {
      if (this.selectedRooms[roomName] === true && !this.isBaseStation(roomName)) {
        const roomData = this.roomElevationData[roomName];
        if (!roomData || !roomData.fdf || roomData.fdf === '' || roomData.fdf === '-- Select --') {
          return false;
        }
      }
    }

    // All required fields are filled
    return true;
  }

  // Prevent touch event bubbling
  preventTouch(event: TouchEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  // v1.4.389 - Simple test method for PDF button
  async testPDFButton() {
    try {
      // Show multiple alerts to ensure something happens

      // Show debug info
      const debugInfo = `
        Service ID: ${this.serviceId || 'MISSING'}
        Project ID: ${this.projectId || 'MISSING'}
        Has Loading Controller: ${!!this.loadingController}
        Has Modal Controller: ${!!this.modalController}
      `;
      alert(debugInfo);

      // Try to call generatePDF
      await this.generatePDF();
    } catch (error) {
      console.error('[v1.4.389] Error in testPDFButton:', error);
      alert(`Error: ${error}`);
    }
  }

  // v1.4.389 - Ensure PDF button is properly wired up
  ensurePDFButtonWorks() {
    const pdfButton = document.querySelector('.pdf-header-button') as HTMLButtonElement;
    if (pdfButton) {

      // Remove any existing listeners first
      const newButton = pdfButton.cloneNode(true) as HTMLButtonElement;
      pdfButton.parentNode?.replaceChild(newButton, pdfButton);

      // Add direct event listener
      newButton.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Show immediate feedback
        try {
          await this.generatePDF();
        } catch (error) {
          console.error('[v1.4.389] Error in direct listener:', error);
          await this.showToast(`Error: ${error}`, 'danger');
        }
      });

      // Also add touch listener for mobile
      newButton.addEventListener('touchend', async (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    } else {
      console.error('[v1.4.389] PDF button not found in DOM!');

      // Try to find it by other means
      const allButtons = document.querySelectorAll('button');
      allButtons.forEach((btn, index) => {
        if (btn.textContent?.includes('PDF')) {
        }
      });
    }
  }

  // Add ionViewDidEnter hook to ensure button is ready
  ionViewDidEnter() {
    setTimeout(() => {
      this.ensurePDFButtonWorks();
    }, 500);
  }

  // New handler for PDF button click
  async handlePDFClick(event: Event) {

    // Add comprehensive debugging
    try {

      // Prevent all default behaviors immediately
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      // Call the actual PDF generation directly
      await this.generatePDF();
    } catch (error) {
      console.error('[v1.4.388] Error in handlePDFClick:', error);
      console.error('[v1.4.402] PDF Click Error:', error);
    }
  }

  async generatePDF(event?: Event) {

    // CRITICAL: Prevent any default behavior that might cause reload
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      // Additional prevention for touch events
      if (event instanceof TouchEvent) {
        event.preventDefault();
      }

      // Prevent any form submission if button is inside a form
      const target = event.target as HTMLElement;
      const form = target.closest('form');
      if (form) {
        form.onsubmit = (e) => { e.preventDefault(); return false; };
      }
    }

    // Prevent multiple simultaneous PDF generation attempts
    if (this.isPDFGenerating) {
      return;
    }
    
    // Set flag immediately to prevent any double clicks
    this.isPDFGenerating = true;

    // Disable the PDF button visually - check for both possible button selectors
    const pdfButton = (document.querySelector('.pdf-header-button') || document.querySelector('.pdf-fab')) as HTMLElement;
    if (pdfButton) {
      if (pdfButton instanceof HTMLButtonElement) {
        pdfButton.disabled = true;
      }
      pdfButton.style.pointerEvents = 'none';
      pdfButton.style.opacity = '0.6';
    } else {
    }

    // Track generation attempts for debugging
    this.pdfGenerationAttempts++;
    
    try {
      // CRITICAL FIX: Ensure we have our IDs before proceeding
      if (!this.serviceId || !this.projectId) {
        console.error('[v1.4.390] Missing service/project ID, attempting recovery');

        // Try to recover IDs from route if possible
        const routeServiceId = this.route.snapshot.paramMap.get('serviceId');
        const routeProjectId = this.route.snapshot.paramMap.get('projectId');

        if (routeServiceId && routeProjectId) {
          this.serviceId = routeServiceId;
          this.projectId = routeProjectId;
        } else {
          console.error('[v1.4.390] ERROR: No service/project IDs available!');
          this.isPDFGenerating = false;
          if (pdfButton) {
            if (pdfButton instanceof HTMLButtonElement) {
              pdfButton.disabled = false;
            }
            pdfButton.style.pointerEvents = 'auto';
            pdfButton.style.opacity = '1';
          }
          return;
        }
      } else {
      }

    let loading: any = null;
    try {
      loading = await this.alertController.create({
        header: 'Loading Report',
        message: 'Preparing your PDF report...',
        buttons: [
          {
            text: 'Cancel',
            handler: () => {
              this.isPDFGenerating = false;
              return true;
            }
          }
        ],
        backdropDismiss: false,
        cssClass: 'template-loading-alert'
      });
      await loading.present();
    } catch (loadingError) {
      console.error('[v1.4.390] Error creating/presenting loading:', loadingError);
      // Continue without loading indicator
    }

    try {
      // Check if we have cached PDF data (valid for 5 minutes)
      const cacheKey = this.cache.getApiCacheKey('pdf_data', { 
        serviceId: this.serviceId,
        timestamp: Math.floor(Date.now() / 300000) // 5-minute blocks
      });
      
      let structuralSystemsData, elevationPlotData, projectInfo;
      const cachedData = this.cache.get(cacheKey);
      
      if (cachedData) {
        ({ structuralSystemsData, elevationPlotData, projectInfo } = cachedData);
      } else {
        const startTime = Date.now();
        
        try {
          // Wrap data preparation in try-catch to prevent any reload on error
          // Execute all data fetching in parallel with individual error handling
          const [projectData, structuralData, elevationData] = await Promise.all([
            this.prepareProjectInfo().catch(err => {
              console.error('[v1.4.338] Error in prepareProjectInfo:', err);
              // Return minimal valid data structure
              return {
                projectId: this.projectId,
                serviceId: this.serviceId,
                address: this.projectData?.Address || '',
                clientName: this.projectData?.ClientName || '',
                projectData: this.projectData,
                serviceData: this.serviceData
              };
            }),
            this.prepareStructuralSystemsData().catch(err => {
              console.error('[v1.4.338] Error in prepareStructuralSystemsData:', err);
              return []; // Return empty array instead of failing
            }),
            this.prepareElevationPlotData().catch(err => {
              console.error('[v1.4.338] Error in prepareElevationPlotData:', err);
              return []; // Return empty array instead of failing
            })
          ]);
          
          projectInfo = projectData;
          structuralSystemsData = structuralData;
          elevationPlotData = elevationData;
          
          // Cache the prepared data
          this.cache.set(cacheKey, {
            structuralSystemsData,
            elevationPlotData,
            projectInfo
          }, this.cache.CACHE_TIMES.MEDIUM);
        } catch (dataError) {
          console.error('[v1.4.338] Fatal error loading PDF data:', dataError);
          // Use fallback empty data to prevent reload
          projectInfo = {
            projectId: this.projectId,
            serviceId: this.serviceId,
            address: this.projectData?.Address || '',
            clientName: this.projectData?.ClientName || '',
            projectData: this.projectData,
            serviceData: this.serviceData
          };
          structuralSystemsData = [];
          elevationPlotData = [];
        }
      }
      
      // Preload primary photo if it exists (do this separately as it's optional)
      if (projectInfo?.primaryPhoto && typeof projectInfo.primaryPhoto === 'string' && projectInfo.primaryPhoto.startsWith('/')) {
        try {
          const imageData = await this.caspioService.getImageFromFilesAPI(projectInfo.primaryPhoto).toPromise();
          if (imageData && imageData.startsWith('data:')) {
            projectInfo.primaryPhotoBase64 = imageData;
          }
        } catch (error) {
          console.error('Error preloading primary photo:', error);
          // Don't fail the whole PDF generation if photo fails
        }
      }

      const PdfPreviewComponent = await this.loadPdfPreview();

      // Check if PdfPreviewComponent is available
      if (!PdfPreviewComponent) {
        console.error('[v1.4.390] PdfPreviewComponent is not available!');
        throw new Error('PdfPreviewComponent not available');
      }

      let modal;
      try {

        modal = await this.modalController.create({
          component: PdfPreviewComponent,
          componentProps: {
            projectData: projectInfo,
            structuralData: structuralSystemsData,
            elevationData: elevationPlotData,
            serviceData: {
              ...this.serviceData,
              serviceName: 'EFE - Engineer\'s Foundation Evaluation' // Override with EFE prefix for webapp
            }
          },
          cssClass: 'fullscreen-modal',
          animated: this.pdfGenerationAttempts > 1, // Disable animation on first attempt
          mode: 'ios', // Force iOS mode for consistency
          backdropDismiss: false // Prevent accidental dismissal
        });
      } catch (modalCreateError) {
        console.error('[v1.4.390] Error creating modal:', modalCreateError);
        throw modalCreateError;
      }
      
      // Wait a moment before presenting to ensure DOM is ready
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Present the modal with error handling
      try {
        await modal.present();
        
        // Dismiss loading after modal is presented
        // Add a small delay to ensure smooth transition
        setTimeout(async () => {
          try {
            if (loading) await loading.dismiss();
          } catch (dismissError) {
          }
        }, 300);
        
      } catch (modalError) {
        console.error('[v1.4.338] Error presenting modal:', modalError);
        // Try to dismiss loading on error
        try {
          if (loading) await loading.dismiss();
        } catch (dismissError) {
        }
        throw modalError;
      }
      
      // Wait for modal to be dismissed before re-enabling button
      modal.onDidDismiss().then(() => {
        // Re-enable the PDF button
        const pdfBtn = (document.querySelector('.pdf-header-button') || document.querySelector('.pdf-fab')) as HTMLElement;
        if (pdfBtn) {
          if (pdfBtn instanceof HTMLButtonElement) {
            pdfBtn.disabled = false;
          }
          pdfBtn.style.pointerEvents = 'auto';
          pdfBtn.style.opacity = '1';
        }
        // Reset the generation flag after modal is dismissed
        this.isPDFGenerating = false;
      });
      
    } catch (error) {
      console.error('[v1.4.388] Error preparing preview:', error);

      // Show detailed error with stack trace in alert
      const errorDetails = error instanceof Error ?
        `Message: ${error.message}\n\nStack: ${error.stack}` :
        `Error: ${JSON.stringify(error)}`;

      const alert = await this.alertController.create({
        header: 'PDF Generation Error',
        message: `
          <div style="font-family: monospace; font-size: 12px;">
            <p style="color: red; font-weight: bold;">Failed to generate PDF</p>
            <textarea
              style="width: 100%; height: 200px; font-size: 10px; margin-top: 10px;"
              readonly>${errorDetails}</textarea>
          </div>
        `,
        buttons: ['OK']
      });
      await alert.present();

      // Reset the generation flag on error
      this.isPDFGenerating = false;

      // Re-enable the PDF button - check for both possible button selectors
      const pdfButton = (document.querySelector('.pdf-header-button') || document.querySelector('.pdf-fab')) as HTMLElement;
      if (pdfButton) {
        if (pdfButton instanceof HTMLButtonElement) {
          pdfButton.disabled = false;
        }
        pdfButton.style.pointerEvents = 'auto';
        pdfButton.style.opacity = '1';
      }

      try {
        if (loading) await loading.dismiss();
      } catch (e) {
      }

      // Show more detailed error message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.showToast(`Failed to prepare preview: ${errorMessage}`, 'danger');
    }
  } catch (error) {
    // Outer catch for the main try block
    console.error('[v1.4.338] Outer error in generatePDF:', error);
    this.isPDFGenerating = false;
    
    // Re-enable the PDF button - check for both possible button selectors
    const pdfButton = (document.querySelector('.pdf-header-button') || document.querySelector('.pdf-fab')) as HTMLElement;
    if (pdfButton) {
      if (pdfButton instanceof HTMLButtonElement) {
        pdfButton.disabled = false;
      }
      pdfButton.style.pointerEvents = 'auto';
      pdfButton.style.opacity = '1';
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[v1.4.402] Failed to generate PDF:', errorMessage);
    }
  }
  
  // Utility functions
  formatDate(dateString: string): string {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString();
    } catch {
      return dateString;
    }
  }

  private updateOfflineBanner(): void {
    // Disabled - no banners needed, just the bottom toggle button
    this.showOfflineBanner = false;
    this.offlineMessage = '';
    this.queuedChanges = 0;
    this.queuedChangesLabel = '';
  }

  private updateQueueStatus(): void {
    const status = this.offlineService.getQueueStatus();
    this.queuedChanges = status.count;
    if (this.queuedChanges > 0) {
      this.queuedChangesLabel = this.queuedChanges === 1
        ? '1 change waiting to sync'
        : `${this.queuedChanges} changes waiting to sync`;
    } else {
      this.queuedChangesLabel = '';
    }
  }

  private async refreshPendingVisuals(): Promise<void> {
    await this.processPendingVisualCreates();

    const pendingEntries = Object.entries(this.visualRecordIds)
      .filter(([, value]) => value === '__pending__');

    for (const [key] of pendingEntries) {
      const separatorIndex = key.lastIndexOf('_');
      if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
        continue;
      }

      const category = key.substring(0, separatorIndex);
      const templateId = key.substring(separatorIndex + 1);

      if (category && templateId) {
        await this.refreshVisualId(category, templateId);
      }

      if (this.pendingPhotoUploads[key] && this.pendingPhotoUploads[key].length > 0) {
        await this.processPendingPhotoUploadsForKey(key);
      }
    }
  }

  private async processPendingPhotoUploadsForKey(key: string): Promise<void> {
    const pendingUploads = this.pendingPhotoUploads[key];
    const visualId = this.visualRecordIds[key];

    if (!pendingUploads || pendingUploads.length === 0) {
      return;
    }

    if (!visualId || visualId === '__pending__') {
      return;
    }

    const visualIdNum = parseInt(visualId, 10);
    if (isNaN(visualIdNum)) {
      console.warn('[v1.4.530] Pending photo uploads waiting for numeric VisualID. Current value:', visualId);
      return;
    }

    const uploads = [...pendingUploads];
    delete this.pendingPhotoUploads[key];

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < uploads.length; i++) {
      const upload = uploads[i];

      const keyPhotos = this.visualPhotos[key] || [];
      const photoIndex = keyPhotos.findIndex((p: any) => p.id === upload.tempId);

      if (photoIndex !== -1) {
        keyPhotos[photoIndex].uploading = true;
        keyPhotos[photoIndex].queued = false;
      } else {
        console.warn(`[v1.4.530]   Photo not found in visualPhotos[${key}]`);
      }

      try {
        await this.performVisualPhotoUpload(
          visualIdNum,
          upload.file,
          key,
          upload.isBatchUpload,
          upload.annotationData,
          upload.originalPhoto || null,
          upload.tempId,
          upload.caption || '' // Pass caption from pending upload
        );
        successCount++;
      } catch (error) {
        failCount++;
        console.error(`[v1.4.530]   âŒ Failed to upload photo ${i + 1}:`, error);
        if (photoIndex !== -1) {
          keyPhotos[photoIndex].uploading = false;
          keyPhotos[photoIndex].queued = false;
          keyPhotos[photoIndex].failed = true;
        }
      }
    }

    // Only show error message if there were failures
    if (failCount > 0) {
      await this.showToast(`${failCount} photo(s) failed to sync`, 'danger');
    }
  }

  private async processPendingVisualCreates(): Promise<void> {
    if (this.offlineService.isManualOffline() || !this.offlineService.isOnline()) {
      return;
    }

    const entries = Object.entries(this.pendingVisualCreates);
    for (const [key, pending] of entries) {
      if (this.offlineService.isManualOffline() || !this.offlineService.isOnline()) {
        break;
      }

      if (this.visualRecordIds[key] && this.visualRecordIds[key] !== '__pending__') {
        delete this.pendingVisualCreates[key];
        continue;
      }

      try {
        this.pendingVisualKeys.add(key);
        this.visualRecordIds[key] = '__pending__';
        localStorage.setItem(`visual_${pending.category}_${pending.templateId}`, '__pending__');
        await this.createVisualRecord(key, pending.category, pending.templateId, pending.data);
        delete this.pendingVisualCreates[key];
      } catch (error) {
        console.error('Failed to sync queued visual for', key, error);
        await this.showToast('Queued visual failed to sync. Please retry.', 'danger');
        break;
      } finally {
        this.pendingVisualKeys.delete(key);
      }
    }
  }

  private async createVisualRecord(
    key: string,
    category: string,
    templateId: string,
    visualData: ServicesVisualRecord
  ): Promise<void> {
    let visualId: string | null = null;

    try {
      const response = await this.caspioService.createServicesVisual(visualData).toPromise();

      if (Array.isArray(response) && response.length > 0) {
        visualId = String(response[0].VisualID || response[0].PK_ID || response[0].id || '');
      } else if (response && typeof response === 'object') {
        if (response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
          visualId = String(response.Result[0].VisualID || response.Result[0].PK_ID || response.Result[0].id || '');
        } else {
          visualId = String(response.VisualID || response.PK_ID || response.id || '');
        }
      } else if (response) {
        visualId = String(response);
      }
    } catch (error) {
      delete this.visualRecordIds[key];
      localStorage.removeItem(`visual_${category}_${templateId}`);
      throw error;
    }

    if (visualId && visualId !== 'undefined' && visualId !== 'null' && visualId !== '') {
      this.visualRecordIds[key] = visualId;

      // Mark that changes have been made (enables Update button)
      this.markReportChanged();
      localStorage.setItem(`visual_${category}_${templateId}`, visualId);
      delete this.pendingVisualCreates[key];
      await this.processPendingPhotoUploadsForKey(key);
    } else {
      // Keep pending marker and try to refresh later
      setTimeout(() => this.refreshVisualId(category, templateId), 2000);
    }
  }

  toggleManualOffline(): void {
    const newState = !this.manualOffline;
    const wasOffline = this.manualOffline;
    this.offlineService.setManualOffline(newState);
    this.manualOffline = newState;
    this.updateOfflineBanner();

    // If turning auto-save back ON, process ALL pending items
    if (wasOffline && !newState) {
      this.processPendingRoomsAndPoints();
      this.processAllPendingVisuals();
    }
    // No toast needed - button state is self-explanatory
  }

  /**
   * Process all pending visual creations and photo uploads
   * Called when auto-sync is turned back on
   */
  private async processAllPendingVisuals(): Promise<void> {

    // First, create any pending visual records
    await this.processPendingVisualCreates();

    // Then, process any pending photo uploads for visuals that now have IDs
    const keys = Object.keys(this.pendingPhotoUploads);
    const keysProcessed: string[] = [];

    for (const key of keys) {
      const visualId = this.visualRecordIds[key];

      if (visualId && visualId !== '__pending__') {
        await this.processPendingPhotoUploadsForKey(key);
        keysProcessed.push(key);
      } else {
      }
    }

    // CRITICAL: Reload photos from database to get real AttachIDs
    if (keysProcessed.length > 0) {

      for (const key of keysProcessed) {
        const visualId = this.visualRecordIds[key];
        if (visualId && visualId !== '__pending__') {
          try {
            await this.loadPhotosForVisualByKey(key, visualId, visualId);
          } catch (error) {
            console.error(`[v1.4.533] Failed to reload photos for ${key}:`, error);
          }
        }
      }
    }

    // Success - no toast needed
  }

  /**
   * Process pending room and point creations in the correct order
   * Rooms must be created first, then their associated points
   */
  private async processPendingRoomsAndPoints(): Promise<void> {
    try {
      // Step 1: Create all pending rooms first
      const roomNames = Object.keys(this.pendingRoomCreates);
      if (roomNames.length > 0) {

        for (const roomName of roomNames) {
          const roomData = this.pendingRoomCreates[roomName];
          try {
            const response = await this.caspioService.createServicesEFE(roomData).toPromise();

            if (response) {
              const roomId = response.EFEID || response.roomId;
              if (roomId) {
                this.efeRecordIds[roomName] = roomId;
                delete this.pendingRoomCreates[roomName];
              }
            }
          } catch (error) {
            console.error(`âŒ [v1.4.504] Failed to create room ${roomName}:`, error);
            await this.showToast(`Failed to create room: ${roomName}`, 'danger');
          }
        }
      }

      // Step 2: Create pending points for rooms that now have IDs
      const pointKeys = Object.keys(this.pendingPointCreates);
      if (pointKeys.length > 0) {

        for (const pointKey of pointKeys) {
          const pointInfo = this.pendingPointCreates[pointKey];
          const roomId = this.efeRecordIds[pointInfo.roomName];

          // Only create point if room was successfully created
          if (roomId && roomId !== '__pending__') {
            try {
              const pointData = {
                EFEID: parseInt(roomId),
                PointName: pointInfo.pointName
              };
              const response = await this.caspioService.createServicesEFEPoint(pointData).toPromise();

              if (response && (response.PointID || response.PK_ID)) {
                const pointId = response.PointID || response.PK_ID;
                this.efePointIds[pointKey] = pointId;
                delete this.pendingPointCreates[pointKey];
              }
            } catch (error) {
              console.error(`âŒ [v1.4.504] Failed to create point ${pointInfo.pointName}:`, error);
              await this.showToast(`Failed to create point: ${pointInfo.pointName}`, 'danger');
            }
          } else {
            console.warn(`[v1.4.504] Skipping point ${pointInfo.pointName} - room ${pointInfo.roomName} not yet created`);
          }
        }
      }

      if (roomNames.length > 0 || pointKeys.length > 0) {
        await this.showToast('Queued rooms and points created successfully', 'success');
      }

    } catch (error) {
      console.error('[v1.4.504] Error processing pending rooms and points:', error);
      await this.showToast('Some items failed to sync', 'danger');
    }
  }

  showSaveStatus(message: string, type: 'info' | 'success' | 'error') {
    // Disabled - no save status banner needed
    // this.saveStatus = message;
    // this.saveStatusType = type;

    setTimeout(() => {
      this.saveStatus = '';
    }, 3000);
  }
  
  // v1.4.343: Show debug data in a copyable format when clipboard fails
  async showCopyableDebugData(debugText: string) {
    const alert = await this.alertController.create({
      header: 'ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã¢â‚¬Â¹ Debug Data (Select & Copy)',
      message: `
        <div style="font-family: monospace; font-size: 11px;">
          <p style="color: orange; margin-bottom: 10px;">
            ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Clipboard copy failed. Please manually select and copy the text below:
          </p>
          <textarea 
            style="width: 100%; 
                   height: 300px; 
                   font-family: monospace; 
                   font-size: 10px; 
                   border: 1px solid #ccc; 
                   padding: 8px;
                   background: #f5f5f5;"
            readonly
            onclick="this.select(); this.setSelectionRange(0, 999999);"
          >${debugText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
          <p style="color: #666; margin-top: 10px; font-size: 10px;">
            Tap the text area above to select all text, then use your device's copy function.
          </p>
        </div>
      `,
      buttons: [
        {
          text: 'Done',
          role: 'cancel'
        }
      ]
    });
    await alert.present();
  }

  async showToast(message: string, color: string = 'primary') {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  async openHelp(helpId: number, title: string) {
    const modal = await this.modalController.create({
      component: HelpModalComponent,
      componentProps: {
        helpId: helpId,
        title: title
      },
      cssClass: 'help-modal'
    });
    await modal.present();
  }

  async showDebugAlert(title: string, message: string) {
    const alert = await this.alertController.create({
      header: title,
      message: message.replace(/\n/g, '<br>'),
      buttons: [
        {
          text: 'Copy Debug Info',
          handler: () => {
            // Copy to clipboard
            const textToCopy = message.replace(/<br>/g, '\n');
            if (navigator.clipboard) {
              navigator.clipboard.writeText(textToCopy);
            }
            return false; // Keep alert open
          }
        },
        {
          text: 'OK',
          role: 'cancel'
        }
      ]
    });
    await alert.present();
  }
  
  // Helper methods for template
  getTemplatesForCategory(category: string): any[] {
    return this.visualTemplates.filter(t => t.Category === category);
  }
  
  getTemplatesCountForCategory(category: string): number {
    return this.visualTemplates.filter(t => t.Category === category).length;
  }

  // Get count of deficiencies for a category
  getDeficienciesCountForCategory(category: string): number {
    if (!this.organizedData[category] || !this.organizedData[category].deficiencies) {
      return 0;
    }
    // Only count selected deficiencies
    return this.organizedData[category].deficiencies.filter(item => {
      const key = `${category}_${item.id}`;
      return this.selectedItems[key] === true;
    }).length;
  }

  getProjectCompletion(): number {
    // Calculate project details completion percentage for required fields only
    
    // Required fields from projectData
    const requiredProjectFields = [
      'ClientName',
      'InspectorName',
      'YearBuilt',
      'SquareFeet',
      'TypeOfBuilding',
      'Style'
    ];
    
    // Required fields from serviceData
    const requiredServiceFields = [
      'InAttendance',
      'OccupancyFurnishings',
      'WeatherConditions',
      'OutdoorTemperature',
      'StructuralSystemsStatus'
    ];

    let totalRequired = requiredProjectFields.length + requiredServiceFields.length;
    let completed = 0;

    // Check projectData required fields
    requiredProjectFields.forEach(field => {
      if (this.projectData[field] && this.projectData[field] !== '') {
        completed++;
      }
    });

    // Check serviceData required fields
    requiredServiceFields.forEach(field => {
      if (this.serviceData[field] && this.serviceData[field] !== '') {
        completed++;
      }
    });
    
    return Math.round((completed / totalRequired) * 100);
  }
  
  // Toggle item selection
  async toggleItemSelection(category: string, itemId: string) {
    
    const key = `${category}_${itemId}`;
    const wasSelected = this.selectedItems[key];
    
    // Set saving state
    this.savingItems[key] = true;
    
    this.selectedItems[key] = !wasSelected;
    
    // Update the categoryData as well
    if (this.categoryData[category] && this.categoryData[category][itemId]) {
      this.categoryData[category][itemId].selected = this.selectedItems[key];
    }
    
    try {
      // Save or remove from Services_Visuals table
      if (this.selectedItems[key]) {
        // Item was selected - save to Services_Visuals
        await this.saveVisualSelection(category, itemId);
        // Success toast removed per user request
      } else {
        // Item was deselected - remove from Services_Visuals if exists
        await this.removeVisualSelection(category, itemId);
      }
    } finally {
      // Clear saving state
      this.savingItems[key] = false;
      // Trigger change detection to update completion percentage
      this.changeDetectorRef.detectChanges();
    }
  }

  // Handle Yes/No answer change
  async onAnswerChange(category: string, item: any) {
    const key = `${category}_${item.id}`;
    this.savingItems[key] = true;
    
    try {
      const existingVisualId = this.visualRecordIds[key];
      
      if (item.answer === 'Yes' || item.answer === 'No') {
        if (existingVisualId) {
          // Update existing record - only update the Answers field
          const updateData = { Answers: item.answer };
          await this.caspioService.updateServicesVisual(existingVisualId, updateData).toPromise();
        } else {
          // Create new record with answer in Answers field
          item.answerToSave = item.answer;
          item.text = item.originalText || item.text;
          this.selectedItems[key] = true;
          await this.saveVisualSelection(category, item.id);
        }
      } else if (item.answer === '') {
        // If cleared and record exists, update to remove answer
        if (existingVisualId) {
          const updateData = { Answers: '' };
          await this.caspioService.updateServicesVisual(existingVisualId, updateData).toPromise();
        }
        item.text = item.originalText;
      }
    } catch (error) {
      console.error('Error handling answer change:', error);
      await this.showToast('Failed to save answer', 'danger');
    } finally {
      this.savingItems[key] = false;
      // Trigger change detection to update completion percentage
      this.changeDetectorRef.detectChanges();
    }
  }
  
  // Handle multi-select change
  async onMultiSelectChange(category: string, item: any) {
    const key = `${category}_${item.id}`;
    this.savingItems[key] = true;
    const answersText = item.selectedOptions ? item.selectedOptions.join(', ') : '';
    
    try {
      const existingVisualId = this.visualRecordIds[key];
      
      if (item.selectedOptions && item.selectedOptions.length > 0) {
        if (existingVisualId) {
          // Update existing record - only update the Answers field
          const updateData = { Answers: answersText };
          await this.caspioService.updateServicesVisual(existingVisualId, updateData).toPromise();
        } else {
          // Create new record with selections in Answers field
          item.answerToSave = answersText;
          item.text = item.originalText || item.text;
          this.selectedItems[key] = true;
          await this.saveVisualSelection(category, item.id);
        }
      } else {
        // If no options selected and record exists, clear the answers
        if (existingVisualId) {
          const updateData = { Answers: '' };
          await this.caspioService.updateServicesVisual(existingVisualId, updateData).toPromise();
        }
        item.text = item.originalText || '';
      }
    } catch (error) {
      console.error('Error handling multi-select change:', error);
      await this.showToast('Failed to save selections', 'danger');
    } finally {
      this.savingItems[key] = false;
      // Trigger change detection to update completion percentage
      this.changeDetectorRef.detectChanges();
    }
  }
  
  // Check if an option is selected for a multi-select item
  isOptionSelectedV1(item: any, option: string): boolean {
    if (!item.selectedOptions || !Array.isArray(item.selectedOptions)) {
      return false;
    }
    
    // CRITICAL FIX: Check for "Other" - either explicit or via otherValue
    if (option === 'Other') {
      // Check if "Other" is in the array OR if there's a custom otherValue
      return item.selectedOptions.includes('Other') || (item.otherValue && item.otherValue.trim().length > 0);
    }
    
    return item.selectedOptions.includes(option);
  }
  
  // DEBUG: Helper to check why options aren't showing
  getDropdownDebugInfo(item: any): string {
    const options = this.visualDropdownOptions[item.templateId];
    return `TemplateID: ${item.templateId}, HasOptions: ${!!options}, Count: ${options?.length || 0}, Options: ${options?.join(', ') || 'NONE'}`;
  }
  
  // ========== In Attendance Multi-Select Methods ==========
  
  // Check if an option is selected in In Attendance
  isInAttendanceSelected(option: string): boolean {
    if (!this.inAttendanceSelections || !Array.isArray(this.inAttendanceSelections)) {
      return false;
    }
    
    // Check for "Other" - either explicit or via otherValue
    if (option === 'Other') {
      return this.inAttendanceSelections.includes('Other') || 
             !!(this.inAttendanceOtherValue && this.inAttendanceOtherValue.trim().length > 0);
    }
    
    return this.inAttendanceSelections.includes(option);
  }
  
  // Handle toggling an option in In Attendance
  async onInAttendanceToggle(option: string, event: any) {
    // Initialize selections array if not present
    if (!this.inAttendanceSelections) {
      this.inAttendanceSelections = [];
    }
    
    if (event.detail.checked) {
      // Add option if not already present
      if (!this.inAttendanceSelections.includes(option)) {
        this.inAttendanceSelections.push(option);
      }
    } else {
      // Remove option
      const index = this.inAttendanceSelections.indexOf(option);
      if (index > -1) {
        this.inAttendanceSelections.splice(index, 1);
      }
      // If unchecking "Other", clear the custom value
      if (option === 'Other') {
        this.inAttendanceOtherValue = '';
      }
    }
    
    // Convert to comma-delimited string and save
    await this.saveInAttendanceSelections();
  }
  
  // Handle custom "Other" input for In Attendance
  async onInAttendanceOtherChange() {
    // Ensure "Other" is in selections when there's a custom value
    if (this.inAttendanceOtherValue && this.inAttendanceOtherValue.trim()) {
      if (!this.inAttendanceSelections) {
        this.inAttendanceSelections = [];
      }
      const otherIndex = this.inAttendanceSelections.indexOf('Other');
      if (otherIndex > -1) {
        // Replace "Other" with the actual custom value
        this.inAttendanceSelections[otherIndex] = this.inAttendanceOtherValue.trim();
      } else {
        // Check if there's already a custom value and replace it
        const customIndex = this.inAttendanceSelections.findIndex((opt: string) => 
          opt !== 'Other' && !this.inAttendanceOptions.includes(opt)
        );
        if (customIndex > -1) {
          this.inAttendanceSelections[customIndex] = this.inAttendanceOtherValue.trim();
        } else {
          // Add the custom value
          this.inAttendanceSelections.push(this.inAttendanceOtherValue.trim());
        }
      }
    } else {
      // If custom value is cleared, revert to just "Other"
      const customIndex = this.inAttendanceSelections.findIndex((opt: string) => 
        opt !== 'Other' && !this.inAttendanceOptions.includes(opt)
      );
      if (customIndex > -1) {
        this.inAttendanceSelections[customIndex] = 'Other';
      }
    }
    
    // Save the updated selections
    await this.saveInAttendanceSelections();
  }
  
  // Save In Attendance selections
  async saveInAttendanceSelections() {
    // Convert array to comma-delimited string
    const attendanceText = this.inAttendanceSelections.join(', ');
    
    // Save to serviceData.InAttendance field
    this.serviceData.InAttendance = attendanceText;
    
    // Save to database
    await this.onServiceFieldChange('InAttendance', attendanceText);
    
    // Trigger change detection
    this.changeDetectorRef.detectChanges();
  }
  
  // Parse In Attendance field from database (comma-delimited string to array)
  parseInAttendanceField() {
    if (!this.serviceData.InAttendance || !this.serviceData.InAttendance.trim()) {
      this.inAttendanceSelections = [];
      this.inAttendanceOtherValue = '';
      return;
    }
    
    // Split comma-delimited string into array
    const selections = this.serviceData.InAttendance.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    
    // Find any custom values (not in the predefined options list)
    const customValues = selections.filter((opt: string) => 
      !this.inAttendanceOptions.includes(opt) && opt !== 'Other'
    );
    
    if (customValues.length > 0) {
      // Store the custom value and add "Other" to selections
      this.inAttendanceOtherValue = customValues[0];
      // Replace custom value with "Other" in array for checkbox
      this.inAttendanceSelections = selections.map((opt: string) => 
        customValues.includes(opt) ? 'Other' : opt
      );
    } else {
      this.inAttendanceSelections = selections;
      this.inAttendanceOtherValue = '';
    }
    
    console.log('[In Attendance] Parsed field:', {
      raw: this.serviceData.InAttendance,
      selections: this.inAttendanceSelections,
      otherValue: this.inAttendanceOtherValue
    });
  }
  
  // ========== End In Attendance Multi-Select Methods ==========
  
  // ========== Second Foundation Rooms Multi-Select Methods ==========
  
  isSecondFoundationRoomsSelected(option: string): boolean {
    if (!this.secondFoundationRoomsSelections || !Array.isArray(this.secondFoundationRoomsSelections)) {
      return false;
    }
    if (option === 'Other') {
      return this.secondFoundationRoomsSelections.includes('Other') || 
             !!(this.secondFoundationRoomsOtherValue && this.secondFoundationRoomsOtherValue.trim().length > 0);
    }
    return this.secondFoundationRoomsSelections.includes(option);
  }
  
  async onSecondFoundationRoomsToggle(option: string, event: any) {
    if (!this.secondFoundationRoomsSelections) {
      this.secondFoundationRoomsSelections = [];
    }
    
    if (event.detail.checked) {
      if (!this.secondFoundationRoomsSelections.includes(option)) {
        this.secondFoundationRoomsSelections.push(option);
      }
    } else {
      const index = this.secondFoundationRoomsSelections.indexOf(option);
      if (index > -1) {
        this.secondFoundationRoomsSelections.splice(index, 1);
      }
      if (option === 'Other') {
        this.secondFoundationRoomsOtherValue = '';
      }
    }
    
    await this.saveSecondFoundationRoomsSelections();
  }
  
  async onSecondFoundationRoomsOtherChange() {
    if (this.secondFoundationRoomsOtherValue && this.secondFoundationRoomsOtherValue.trim()) {
      if (!this.secondFoundationRoomsSelections) {
        this.secondFoundationRoomsSelections = [];
      }
      const otherIndex = this.secondFoundationRoomsSelections.indexOf('Other');
      if (otherIndex > -1) {
        this.secondFoundationRoomsSelections[otherIndex] = this.secondFoundationRoomsOtherValue.trim();
      } else {
        const customIndex = this.secondFoundationRoomsSelections.findIndex((opt: string) => 
          opt !== 'Other' && !this.secondFoundationRoomsOptions.includes(opt)
        );
        if (customIndex > -1) {
          this.secondFoundationRoomsSelections[customIndex] = this.secondFoundationRoomsOtherValue.trim();
        } else {
          this.secondFoundationRoomsSelections.push(this.secondFoundationRoomsOtherValue.trim());
        }
      }
    } else {
      const customIndex = this.secondFoundationRoomsSelections.findIndex((opt: string) => 
        opt !== 'Other' && !this.secondFoundationRoomsOptions.includes(opt)
      );
      if (customIndex > -1) {
        this.secondFoundationRoomsSelections[customIndex] = 'Other';
      }
    }
    
    await this.saveSecondFoundationRoomsSelections();
  }
  
  async saveSecondFoundationRoomsSelections() {
    const roomsText = this.secondFoundationRoomsSelections.join(', ');
    this.serviceData.SecondFoundationRooms = roomsText;
    await this.onServiceFieldChange('SecondFoundationRooms', roomsText);
    this.changeDetectorRef.detectChanges();
  }
  
  parseSecondFoundationRoomsField() {
    if (!this.serviceData.SecondFoundationRooms || !this.serviceData.SecondFoundationRooms.trim()) {
      this.secondFoundationRoomsSelections = [];
      this.secondFoundationRoomsOtherValue = '';
      return;
    }
    
    const selections = this.serviceData.SecondFoundationRooms.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    const customValues = selections.filter((opt: string) => 
      !this.secondFoundationRoomsOptions.includes(opt) && opt !== 'Other'
    );
    
    if (customValues.length > 0) {
      this.secondFoundationRoomsOtherValue = customValues[0];
      this.secondFoundationRoomsSelections = selections.map((opt: string) => 
        customValues.includes(opt) ? 'Other' : opt
      );
    } else {
      this.secondFoundationRoomsSelections = selections;
      this.secondFoundationRoomsOtherValue = '';
    }
  }
  
  // ========== End Second Foundation Rooms Multi-Select Methods ==========
  
  // ========== Third Foundation Rooms Multi-Select Methods ==========
  
  isThirdFoundationRoomsSelected(option: string): boolean {
    if (!this.thirdFoundationRoomsSelections || !Array.isArray(this.thirdFoundationRoomsSelections)) {
      return false;
    }
    if (option === 'Other') {
      return this.thirdFoundationRoomsSelections.includes('Other') || 
             !!(this.thirdFoundationRoomsOtherValue && this.thirdFoundationRoomsOtherValue.trim().length > 0);
    }
    return this.thirdFoundationRoomsSelections.includes(option);
  }
  
  async onThirdFoundationRoomsToggle(option: string, event: any) {
    if (!this.thirdFoundationRoomsSelections) {
      this.thirdFoundationRoomsSelections = [];
    }
    
    if (event.detail.checked) {
      if (!this.thirdFoundationRoomsSelections.includes(option)) {
        this.thirdFoundationRoomsSelections.push(option);
      }
    } else {
      const index = this.thirdFoundationRoomsSelections.indexOf(option);
      if (index > -1) {
        this.thirdFoundationRoomsSelections.splice(index, 1);
      }
      if (option === 'Other') {
        this.thirdFoundationRoomsOtherValue = '';
      }
    }
    
    await this.saveThirdFoundationRoomsSelections();
  }
  
  async onThirdFoundationRoomsOtherChange() {
    if (this.thirdFoundationRoomsOtherValue && this.thirdFoundationRoomsOtherValue.trim()) {
      if (!this.thirdFoundationRoomsSelections) {
        this.thirdFoundationRoomsSelections = [];
      }
      const otherIndex = this.thirdFoundationRoomsSelections.indexOf('Other');
      if (otherIndex > -1) {
        this.thirdFoundationRoomsSelections[otherIndex] = this.thirdFoundationRoomsOtherValue.trim();
      } else {
        const customIndex = this.thirdFoundationRoomsSelections.findIndex((opt: string) => 
          opt !== 'Other' && !this.thirdFoundationRoomsOptions.includes(opt)
        );
        if (customIndex > -1) {
          this.thirdFoundationRoomsSelections[customIndex] = this.thirdFoundationRoomsOtherValue.trim();
        } else {
          this.thirdFoundationRoomsSelections.push(this.thirdFoundationRoomsOtherValue.trim());
        }
      }
    } else {
      const customIndex = this.thirdFoundationRoomsSelections.findIndex((opt: string) => 
        opt !== 'Other' && !this.thirdFoundationRoomsOptions.includes(opt)
      );
      if (customIndex > -1) {
        this.thirdFoundationRoomsSelections[customIndex] = 'Other';
      }
    }
    
    await this.saveThirdFoundationRoomsSelections();
  }
  
  async saveThirdFoundationRoomsSelections() {
    const roomsText = this.thirdFoundationRoomsSelections.join(', ');
    this.serviceData.ThirdFoundationRooms = roomsText;
    await this.onServiceFieldChange('ThirdFoundationRooms', roomsText);
    this.changeDetectorRef.detectChanges();
  }
  
  parseThirdFoundationRoomsField() {
    if (!this.serviceData.ThirdFoundationRooms || !this.serviceData.ThirdFoundationRooms.trim()) {
      this.thirdFoundationRoomsSelections = [];
      this.thirdFoundationRoomsOtherValue = '';
      return;
    }
    
    const selections = this.serviceData.ThirdFoundationRooms.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    const customValues = selections.filter((opt: string) => 
      !this.thirdFoundationRoomsOptions.includes(opt) && opt !== 'Other'
    );
    
    if (customValues.length > 0) {
      this.thirdFoundationRoomsOtherValue = customValues[0];
      this.thirdFoundationRoomsSelections = selections.map((opt: string) => 
        customValues.includes(opt) ? 'Other' : opt
      );
    } else {
      this.thirdFoundationRoomsSelections = selections;
      this.thirdFoundationRoomsOtherValue = '';
    }
  }
  
  // ========== End Third Foundation Rooms Multi-Select Methods ==========
  
  // Handle toggling an option in multi-select
  async onOptionToggle(category: string, item: any, option: string, event: any) {
    // Initialize selectedOptions if not present
    if (!item.selectedOptions) {
      item.selectedOptions = [];
    }
    
    if (event.detail.checked) {
      // Add option if not already present
      if (!item.selectedOptions.includes(option)) {
        item.selectedOptions.push(option);
      }
    } else {
      // Remove option
      const index = item.selectedOptions.indexOf(option);
      if (index > -1) {
        item.selectedOptions.splice(index, 1);
      }
    }
    
    // Update the text field and save
    await this.onMultiSelectChange(category, item);
  }

  // Handle custom "Other" input for multi-select
  async onMultiSelectOtherChange(category: string, item: any) {
    // CRITICAL FIX: Save just the custom value, not "Other: value"
    if (item.otherValue && item.otherValue.trim()) {
      const otherIndex = item.selectedOptions.indexOf('Other');
      if (otherIndex > -1) {
        // Replace "Other" with the actual custom value
        item.selectedOptions[otherIndex] = item.otherValue.trim();
      } else {
        // Check if there's already a custom value and replace it
        const customOtherIndex = item.selectedOptions.findIndex((opt: string) => 
          opt !== 'Other' && !this.visualDropdownOptions[item.templateId]?.includes(opt)
        );
        if (customOtherIndex > -1) {
          item.selectedOptions[customOtherIndex] = item.otherValue.trim();
        } else {
          // Add the custom value if not present
          item.selectedOptions.push(item.otherValue.trim());
        }
      }
    } else {
      // If custom value is cleared, revert to just "Other"
      const customOtherIndex = item.selectedOptions.findIndex((opt: string) => 
        opt !== 'Other' && !this.visualDropdownOptions[item.templateId]?.includes(opt)
      );
      if (customOtherIndex > -1) {
        item.selectedOptions[customOtherIndex] = 'Other';
      }
    }

    // Save the updated selections
    await this.onMultiSelectChange(category, item);
  }

  // Save visual selection to Services_Visuals table
  async saveVisualSelection(category: string, templateId: string) {
    if (!this.serviceId) {
      console.error('No ServiceID available for saving visual');
      return;
    }

    const key = `${category}_${templateId}`;
    if (this.visualRecordIds[key] && this.visualRecordIds[key] !== '__pending__') {
      return;
    }

    if (this.pendingVisualKeys.has(key) && this.visualRecordIds[key] !== '__pending__') {
      return;
    }

    this.pendingVisualKeys.add(key);

    try {
      const template = this.visualTemplates.find(t => t.PK_ID === templateId);
      if (!template) {
        console.error('Template not found:', templateId);
        return;
      }

      const recordKey = `visual_${category}_${templateId}`;

      try {
        const existingVisuals = await this.foundationData.getVisualsByService(this.serviceId);
        if (existingVisuals) {
          const exists = existingVisuals.find((v: any) =>
            v.Category === category &&
            v.Name === template.Name
          );
          if (exists) {
            const existingId = exists.VisualID || exists.PK_ID || exists.id;
            this.visualRecordIds[key] = String(existingId);
            localStorage.setItem(recordKey, String(existingId));
            await this.processPendingPhotoUploadsForKey(key);
            return;
          }
        }
      } catch (error) {
        console.error('Error checking for existing visual:', error);
      }

      const serviceIdNum = parseInt(this.serviceId, 10);
      if (isNaN(serviceIdNum)) {
        console.error('Invalid ServiceID - not a number:', this.serviceId);
        await this.showToast('Invalid Service ID', 'danger');
        return;
      }

      let answers = '';
      let textValue = template.Text || '';

      const findItem = (items: any[]) => items.find(i => i.id === templateId);
      let item = null;
      if (this.organizedData[category]) {
        item = findItem(this.organizedData[category].comments) ||
               findItem(this.organizedData[category].limitations) ||
               findItem(this.organizedData[category].deficiencies);
      }

      if (item) {
        if (item.answerToSave) {
          answers = item.answerToSave;
          textValue = item.originalText || template.Text || '';
        } else if (item.answerType === 1 && item.answer) {
          answers = item.answer;
          textValue = item.originalText || template.Text || '';
        } else if (item.answerType === 2 && item.selectedOptions && item.selectedOptions.length > 0) {
          answers = item.selectedOptions.join(', ');
          textValue = item.originalText || template.Text || '';
        } else {
          textValue = item.text || template.Text || '';
        }
      }

      const visualData: ServicesVisualRecord = {
        ServiceID: serviceIdNum,
        Category: category || '',
        Kind: template.Kind || '',
        Name: template.Name || '',
        Text: textValue,
        Notes: ''
      };

      if (answers) {
        visualData.Answers = answers;
      }

      const currentlyOnline = this.offlineService.isOnline();
      const manualOffline = this.offlineService.isManualOffline();

      this.visualRecordIds[key] = '__pending__';
      localStorage.setItem(recordKey, '__pending__');

      if (!currentlyOnline || manualOffline) {
        this.pendingVisualCreates[key] = {
          category,
          templateId,
          data: visualData
        };
        this.showToast('Visual queued and will save when auto-sync resumes.', 'warning');
        return;
      }

      await this.createVisualRecord(key, category, templateId, visualData);
    } catch (error) {
      console.error('Error saving visual:', error);
      await this.showToast('Failed to save visual', 'danger');
    } finally {
      this.pendingVisualKeys.delete(key);
    }
  }
  
  // Remove visual selection from Services_Visuals table
  async removeVisualSelection(category: string, templateId: string) {
    // Check if we have a stored record ID
    const recordKey = `visual_${category}_${templateId}`;
    const recordId = localStorage.getItem(recordKey);
    const key = `${category}_${templateId}`;
    delete this.visualRecordIds[key];
    delete this.pendingPhotoUploads[key];
    delete this.pendingVisualCreates[key];

    if (recordId === '__pending__') {
      // Pending create was never synced; just clear the placeholder
      localStorage.removeItem(recordKey);
      this.pendingVisualKeys.delete(key);
      return;
    }

    if (recordId) {
      try {
        await this.caspioService.deleteServicesVisual(recordId).toPromise();
        localStorage.removeItem(recordKey);
      } catch (error) {
        console.error('Failed to remove visual:', error);
      }
    }
  }
  
  // Check if item is selected
  isItemSelected(category: string, itemId: string): boolean {
    return this.selectedItems[`${category}_${itemId}`] || false;
  }

  // Helper methods for PDF generation - check selection by visual ID
  isCommentSelected(category: string, visualId: string): boolean {
    const key = `${category}_${visualId}`;
    return this.selectedItems[key] || false;
  }

  isLimitationSelected(category: string, visualId: string): boolean {
    const key = `${category}_${visualId}`;
    return this.selectedItems[key] || false;
  }

  isDeficiencySelected(category: string, visualId: string): boolean {
    const key = `${category}_${visualId}`;
    return this.selectedItems[key] || false;
  }

  // Get photo count for a visual ID
  getVisualPhotoCount(visualId: string): number {
    const photos = this.visualPhotos[visualId] || [];
    return photos.length;
  }
  
  // Handle multi-select change
  async onMultiSelectChangeDebug(category: string, item: any) {
    
    const key = `${category}_${item.id}`;
    this.savingItems[key] = true;
    
    // Convert array to comma-delimited string for Answers field
    const answersText = item.selectedOptions ? item.selectedOptions.join(', ') : '';
    
    // Show debug popup at start
    const debugAlert = await this.alertController.create({
      header: 'AnswerType 2 Debug - START',
      message: `
        <div style="text-align: left; font-family: monospace; font-size: 12px;">
          <strong style="color: blue;">ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â MULTI-SELECT CHANGE TRIGGERED</strong><br><br>
          
          <strong>Category:</strong> ${category}<br>
          <strong>Item Name:</strong> ${item.name}<br>
          <strong>Item ID:</strong> ${item.id}<br>
          <strong>Selected Options:</strong> <span style="color: green; font-weight: bold;">${item.selectedOptions?.join(', ') || 'NONE'}</span><br>
          <strong>Answers Text:</strong> ${answersText || 'EMPTY'}<br>
          <strong>Key:</strong> ${key}<br><br>
          
          <strong>Current State:</strong><br>
          ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Existing Visual ID: ${this.visualRecordIds[key] || 'NONE - Will Create New'}<br>
          ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Is Selected: ${this.selectedItems[key] ? 'YES' : 'NO'}<br>
          ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Original Text: ${item.originalText || 'Not stored'}<br>
          ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Current Text: ${item.text || 'Empty'}<br><br>
          
          <strong>Service Info:</strong><br>
          ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Service ID: ${this.serviceId || 'MISSING!'}<br>
          ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Project ID: ${this.projectId}<br><br>
          
          <strong>Dropdown Options Available:</strong><br>
          ${item.dropdownOptions ? item.dropdownOptions.join(', ') : 'No options loaded'}<br><br>
          
          <strong style="color: red;">ACTION TO TAKE:</strong><br>
          ${this.visualRecordIds[key] ? 
            'ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ UPDATE existing record (VisualID: ' + this.visualRecordIds[key] + ')' : 
            (answersText ? 'ÃƒÂ¢Ã…Â¾Ã¢â‚¬Â¢ CREATE new Services_Visuals record' : 'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No action - no selections')}<br>
        </div>
      `,
      buttons: ['Continue'],
      cssClass: 'wide-alert'
    });
    await debugAlert.present();
    await debugAlert.onDidDismiss();
    
    try {
      // Check if visual already exists
      const existingVisualId = this.visualRecordIds[key];
      
      if (item.selectedOptions && item.selectedOptions.length > 0) {
        if (existingVisualId) {
          const updateData = {
            Answers: answersText
          };
          
          try {
            await this.caspioService.updateServicesVisual(existingVisualId, updateData).toPromise();
            
            // Show success debug
            const successAlert = await this.alertController.create({
              header: 'UPDATE SUCCESS',
              message: `
                <div style="font-family: monospace; font-size: 12px;">
                  <strong style="color: green;">ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ SUCCESSFULLY UPDATED</strong><br><br>
                  Visual ID: ${existingVisualId}<br>
                  Answers: ${answersText}<br>
                </div>
              `,
              buttons: ['OK']
            });
            await successAlert.present();
          } catch (updateError: any) {
            const errorAlert = await this.alertController.create({
              header: 'UPDATE FAILED',
              message: `
                <div style="font-family: monospace; font-size: 12px;">
                  <strong style="color: red;">ÃƒÂ¢Ã‚ÂÃ…â€™ UPDATE ERROR</strong><br><br>
                  ${updateError?.message || updateError}<br>
                </div>
              `,
              buttons: ['OK']
            });
            await errorAlert.present();
            throw updateError;
          }
        } else {
          
          // Store answers in item for saveVisualSelection to use
          item.answerToSave = answersText;
          
          // Preserve original text, don't overwrite with selections
          item.text = item.originalText || item.text;
          // Mark as selected
          this.selectedItems[key] = true;
          
          // Show creation debug
          const createAlert = await this.alertController.create({
            header: 'CREATING NEW RECORD',
            message: `
              <div style="font-family: monospace; font-size: 12px;">
                <strong style="color: blue;">ÃƒÂ¢Ã…Â¾Ã¢â‚¬Â¢ CREATING Services_Visuals</strong><br><br>
                
                <strong>Data to Send:</strong><br>
                ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ServiceID: ${this.serviceId}<br>
                ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Category: ${category}<br>
                ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Name: ${item.name}<br>
                ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Text: ${item.text}<br>
                ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Answers: ${answersText}<br>
                ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Kind: ${item.kind || 'Comment'}<br><br>
                
                Calling saveVisualSelection...
              </div>
            `,
            buttons: ['Continue']
          });
          await createAlert.present();
          await createAlert.onDidDismiss();
          
          // Save will now include the Answers field
          await this.saveVisualSelection(category, item.id);
          
          // Check if it was created
          const newVisualId = this.visualRecordIds[key];
          const resultAlert = await this.alertController.create({
            header: newVisualId ? 'CREATION SUCCESS' : 'CREATION FAILED',
            message: `
              <div style="font-family: monospace; font-size: 12px;">
                ${newVisualId ? 
                  '<strong style="color: green;">ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ RECORD CREATED</strong><br><br>New Visual ID: ' + newVisualId :
                  '<strong style="color: red;">ÃƒÂ¢Ã‚ÂÃ…â€™ NO RECORD CREATED</strong><br><br>Check saveVisualSelection method!'}
              </div>
            `,
            buttons: ['OK']
          });
          await resultAlert.present();
        }
      } else {
        // If no options selected and record exists, clear the answers
        if (existingVisualId) {
          const updateData = {
            Answers: ''
          };
          await this.caspioService.updateServicesVisual(existingVisualId, updateData).toPromise();
          
          const clearAlert = await this.alertController.create({
            header: 'CLEARED ANSWERS',
            message: `
              <div style="font-family: monospace; font-size: 12px;">
                Cleared answers from Visual ID: ${existingVisualId}
              </div>
            `,
            buttons: ['OK']
          });
          await clearAlert.present();
          // Don't remove the record, just clear the answers
        } else {
          const noActionAlert = await this.alertController.create({
            header: 'NO ACTION TAKEN',
            message: `
              <div style="font-family: monospace; font-size: 12px;">
                No selections and no existing record.<br>
                Nothing to save or update.
              </div>
            `,
            buttons: ['OK']
          });
          await noActionAlert.present();
        }
        // Clear selection state
        item.text = item.originalText || '';
      }
    } catch (error: any) {
      console.error('Error handling multi-select change:', error);
      
      // Show error debug
      const errorAlert = await this.alertController.create({
        header: 'MULTI-SELECT ERROR',
        message: `
          <div style="font-family: monospace; font-size: 12px;">
            <strong style="color: red;">ÃƒÂ¢Ã‚ÂÃ…â€™ ERROR OCCURRED</strong><br><br>
            
            <strong>Error:</strong><br>
            ${error?.message || error}<br><br>
            
            <strong>Stack:</strong><br>
            <div style="max-height: 200px; overflow-y: auto; background: #ffe0e0; padding: 5px;">
              ${error?.stack || 'No stack trace'}
            </div>
          </div>
        `,
        buttons: ['OK']
      });
      await errorAlert.present();
      
      await this.showToast('Failed to save selections', 'danger');
    } finally {
      this.savingItems[key] = false;
      // Trigger change detection to update completion percentage
      this.changeDetectorRef.detectChanges();
    }
  }
  
  
  
  
  
  
  
  
  
  // Check if item is being saved
  isItemSaving(category: string, itemId: string): boolean {
    return this.savingItems[`${category}_${itemId}`] || false;
  }
  
  // Show full text in sleek editor modal - now handles different AnswerTypes
  async showFullText(item: any) {
    // Build inputs based on AnswerType
    const inputs: any[] = [
      {
        name: 'title',
        type: 'text',
        placeholder: 'Title' + (item.required ? ' *' : ''),
        value: item.name || '',
        cssClass: 'editor-title-input'
      }
    ];
    
    // Add appropriate input based on AnswerType
    if (item.answerType === 1) {
      // Yes/No toggle - use originalText for display text
      const currentText = item.originalText || item.text || '';

      // Add a read-only textarea showing the original text
      if (currentText) {
        inputs.push({
          name: 'originalDescription',
          type: 'textarea',
          placeholder: 'Description',
          value: currentText,
          cssClass: 'editor-text-input',
          attributes: {
            rows: 6,
            readonly: true
          }
        });
      }

      // Add Yes/No radio buttons for the answer
      inputs.push({
        name: 'answer',
        type: 'radio',
        label: 'Yes',
        value: 'Yes',
        checked: item.answer === 'Yes'
      });
      inputs.push({
        name: 'answer',
        type: 'radio',
        label: 'No',
        value: 'No',
        checked: item.answer === 'No'
      });
    } else if (item.answerType === 2) {
      // Dropdown from Services_Visuals_Drop
      const options = this.visualDropdownOptions[item.templateId] || [];
      if (options.length > 0) {
        // Add each option as a radio button
        options.forEach(option => {
          inputs.push({
            name: 'description',
            type: 'radio',
            label: option,
            value: option,
            checked: item.text === option
          });
        });
      } else {
        // Fallback to text if no options available
        inputs.push({
          name: 'description',
          type: 'textarea',
          placeholder: 'Description' + (item.required ? ' *' : ''),
          value: item.text || '',
          cssClass: 'editor-text-input',
          attributes: {
            rows: 8
          }
        });
      }
    } else {
      // Default text input (AnswerType 0 or undefined)
      inputs.push({
        name: 'description',
        type: 'textarea',
        placeholder: 'Description' + (item.required ? ' *' : ''),
        value: item.text || '',
        cssClass: 'editor-text-input',
        attributes: {
          rows: 8
        }
      });
    }
    
    const alert = await this.alertController.create({
      header: 'Edit Statement' + (item.required ? ' (Required)' : ''),
      cssClass: 'text-editor-modal',
      inputs: inputs,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel',
          cssClass: 'editor-cancel-btn'
        },
        {
          text: 'Save',
          cssClass: 'editor-save-btn',
          handler: (data) => {
            // For AnswerType 1 (Yes/No), validate answer field instead of description
            if (item.answerType === 1) {
              if (item.required && (!data.title || !data.answer)) {
                this.showToast('Please fill in all required fields', 'warning');
                return false;
              }

              // Update the item with new values
              if (data.title !== item.name || data.answer !== item.answer) {
                item.name = data.title;
                item.answer = data.answer;
                this.saveTemplate(); // Auto-save the changes
                // Success toast removed per user request
              }
            } else {
              // For other types, use description field
              if (item.required && (!data.title || !data.description)) {
                this.showToast('Please fill in all required fields', 'warning');
                return false;
              }

              // Update the item with new values
              if (data.title !== item.name || data.description !== item.text) {
                item.name = data.title;
                item.text = data.description;
                this.saveTemplate(); // Auto-save the changes
                // Success toast removed per user request
              }
            }
            return true;
          }
        }
      ]
    });
    await alert.present();
  }
  
  // EXACT COPY OF uploadDocument from project-detail
  async uploadDocument(category: string, itemId: string, item: any) {
    // Skip custom action sheet and go directly to native file input
    // This will show the native iOS popup with Photo Library, Take Photo, Choose File
    this.currentUploadContext = { category, itemId, item, action: 'upload' };
    this.triggerFileInput('system', { allowMultiple: true });
  }
  
  // New method to capture photo from camera
  async capturePhotoFromCamera(category: string, itemId: string, item: any) {
    // Not used anymore - we use addAnotherPhoto instead which triggers file input
    // Keeping for backward compatibility
    await this.addAnotherPhoto(category, itemId);
  }
  
  // Camera button handler - allows multiple photo capture
  async takePhotoForVisual(category: string, itemId: string, event?: Event) {
    // Prevent event bubbling
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    const key = `${category}_${itemId}`;
    let visualId = this.visualRecordIds[key];
    
    if (!visualId) {
      // Debug popup showing why camera won't open
      const noIdAlert = await this.alertController.create({
        header: 'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Visual Not Saved',
        message: 'Please check the box next to this item to save it first, then try the camera again.',
        buttons: ['OK']
      });
      await noIdAlert.present();
      return;
    }
    
    // Check if it's a temp ID
    if (visualId.startsWith('temp_')) {
      await this.showToast('Visual saving... please wait', 'info');
      await this.refreshVisualId(category, itemId);
      const updatedId = this.visualRecordIds[key];
      if (updatedId && !updatedId.startsWith('temp_')) {
        visualId = updatedId;
      } else {
        await this.showToast('Please wait for visual to finish saving', 'warning');
        return;
      }
    }
    
    this.currentUploadContext = { category, itemId, action: 'add' };
    this.triggerFileInput('system', { allowMultiple: true });
  }
  
  // Handle file selection from the hidden input (supports multiple files)
  async handleFileSelect(event: any) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    // Check if this is for FDF photos
    if (this.currentFDFPhotoContext) {
      // Handle single FDF photo
      if (files.length > 0) {
        await this.processFDFPhoto(files[0]);
      }
      // Clear file input
      if (this.fileInput && this.fileInput.nativeElement) {
        this.fileInput.nativeElement.value = '';
      }
      return;
    }
    
    // Check if this is for room points or visuals
    if (this.currentRoomPointContext) {
      await this.handleRoomPointFileSelect(files);
      return;
    }
    
    if (!this.currentUploadContext) return;
    
    const { category, itemId, item } = this.currentUploadContext;
    
    // Removed uploading in background toast per user request
    
    try {
      
      // Get or create visual ID
      const key = `${category}_${itemId}`;
      let visualId = this.visualRecordIds[key];
      
      // Track that we're uploading for this visual
      this.uploadingPhotos[key] = (this.uploadingPhotos[key] || 0) + files.length;
      
      if (!visualId) {
        // Need to save the visual first
        await this.saveVisualSelection(category, itemId);
        visualId = this.visualRecordIds[key];
      }
      
      if (visualId) {
        // Convert FileList to File array properly
        const fileArray: File[] = [];
        for (let i = 0; i < files.length; i++) {
          fileArray.push(files[i]);
        }
        
        // Process files with annotation for camera photos
        const processedFiles: Array<{ file: File; annotationData?: any; originalFile?: File; caption?: string }> = [];
        
        // If single camera photo, open annotator first
        if (files.length === 1) {
          const isCameraFlow = this.expectingCameraPhoto || this.isLikelyCameraCapture(fileArray[0]);

          if (isCameraFlow) {
            const annotatedResult = await this.annotatePhoto(fileArray[0]);
            processedFiles.push(annotatedResult);

            const continueAlert = await this.alertController.create({
              header: 'What would you like to do next?',
              cssClass: 'custom-document-alert',
              buttons: [
                {
                  text: 'TAKE ANOTHER PHOTO',
                cssClass: 'alert-button-cancel',
                handler: () => {
                  this.currentUploadContext = { category, itemId, item, action: 'add' };
                  this.triggerFileInput('camera', { allowMultiple: false });
                  return true;
                }
              },
              {
                text: 'DONE',
                cssClass: 'alert-button-save',
                handler: () => {
                  this.expectingCameraPhoto = false;
                  this.setFileInputMode('library', { allowMultiple: true });
                  return true;
                }
              }
            ],
            backdropDismiss: false
          });

            await continueAlert.present();
          } else {
            processedFiles.push({
              file: fileArray[0],
              annotationData: null,
              originalFile: undefined,
              caption: ''
            });
            this.expectingCameraPhoto = false;
          }
        } else {
          // Multiple files or non-camera - no automatic annotation
          for (const file of fileArray) {
            processedFiles.push({ file, annotationData: null, originalFile: undefined, caption: '' });
          }
        }
        
        // Start uploads in background (don't await)
        const uploadPromises = processedFiles.map((processedFile, index) => 
          this.uploadPhotoForVisual(visualId, processedFile.file, key, true, processedFile.annotationData, processedFile.originalFile, processedFile.caption)
            .then(() => {
              return { success: true, error: null };
            })
            .catch((error) => {
              console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ Failed to upload file ${index + 1}:`, error);
              return { success: false, error };
            })
        );
        
        // Monitor uploads in background without blocking
        Promise.all(uploadPromises).then(results => {
          // Count successes and failures
          const uploadSuccessCount = results.filter((r: { success: boolean }) => r.success).length;
          const failCount = results.filter((r: { success: boolean }) => !r.success).length;
          
          // Show result message only if there were failures
          if (failCount > 0 && uploadSuccessCount > 0) {
            this.showToast(
              `Uploaded ${uploadSuccessCount} of ${files.length} photos. ${failCount} failed.`,
              'warning'
            );
          } else if (failCount > 0 && uploadSuccessCount === 0) {
            this.showToast('Failed to upload photos', 'danger');
          }
        });
        
        // No need to restore states - the UI should remain unchanged
        
        // Photos are already added with proper previews during upload
        // Removed change detection to improve performance
        
        // Clear upload tracking
        this.uploadingPhotos[key] = Math.max(0, (this.uploadingPhotos[key] || 0) - files.length);
        if (this.uploadingPhotos[key] === 0) {
          delete this.uploadingPhotos[key];
        }

        // Mark that changes have been made (enables Update button)
        this.markReportChanged();

        // Removed change detection to improve performance
      }
    } catch (error) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error handling files:', error);
      await this.showToast('Failed to upload files', 'danger');
    } finally {
      // Reset file input 
      if (this.fileInput && this.fileInput.nativeElement) {
        this.fileInput.nativeElement.value = '';
        // Only reset attributes if we're not continuing with camera
        if (!this.expectingCameraPhoto) {
          // Ensure capture attribute is removed and multiple is restored
          this.fileInput.nativeElement.removeAttribute('capture');
          this.fileInput.nativeElement.setAttribute('multiple', 'true');
        }
      }
      // Only clear context if not continuing with camera
      if (!this.expectingCameraPhoto) {
        this.currentUploadContext = null;
      }
    }
  }
  
  // DEPRECATED - Keeping for reference
  private async capturePhoto(visualId: string, key: string) {
    try {
      
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.capture = 'camera' as any; // Force camera
      
      const fileSelected = new Promise<File | null>((resolve) => {
        input.onchange = (event: any) => {
          const file = event.target?.files?.[0];
          resolve(file || null);
        };
      });
      
      input.click();
      
      const file = await fileSelected;
      if (file) {
        await this.uploadPhotoForVisual(visualId, file, key);
      }
    } catch (error) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error capturing photo:', error);
      await this.showToast('Failed to capture photo', 'danger');
    }
  }
  
  // Select from gallery
  private async selectFromGallery(visualId: string, key: string) {
    try {
      
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      // No capture attribute for gallery
      
      const fileSelected = new Promise<File | null>((resolve) => {
        input.onchange = (event: any) => {
          const file = event.target?.files?.[0];
          resolve(file || null);
        };
      });
      
      input.click();
      
      const file = await fileSelected;
      if (file) {
        await this.uploadPhotoForVisual(visualId, file, key);
      }
    } catch (error) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error selecting from gallery:', error);
      await this.showToast('Failed to select image', 'danger');
    }
  }
  
  // Select document
  private async selectDocument(visualId: string, key: string) {
    try {
      
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg';
      
      const fileSelected = new Promise<File | null>((resolve) => {
        input.onchange = (event: any) => {
          const file = event.target?.files?.[0];
          resolve(file || null);
        };
      });
      
      input.click();
      
      const file = await fileSelected;
      if (file) {
        await this.uploadPhotoForVisual(visualId, file, key);
      }
    } catch (error) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error selecting document:', error);
      await this.showToast('Failed to select document', 'danger');
    }
  }
  
  // Annotate photo before upload - returns object with file, annotation data, and caption
  async annotatePhoto(photo: File): Promise<{ file: File, annotationData?: any, originalFile?: File, caption?: string }> {
    const modal = await this.modalController.create({
      component: FabricPhotoAnnotatorComponent,
      componentProps: {
        imageFile: photo
      },
      cssClass: 'fullscreen-modal'
    });

    await modal.present();
    const { data } = await modal.onDidDismiss();

    if (data && data.blob) {
      // Handle new Fabric.js annotator response with annotation data and caption
      const annotatedFile = new File([data.blob], photo.name, { type: 'image/jpeg' });
      return {
        file: annotatedFile,
        annotationData: data.annotationData || data.annotationsData, // Get the Fabric.js JSON
        originalFile: photo, // Keep reference to original for future re-editing
        caption: data.caption || '' // CRITICAL: Include caption from photo editor
      };
    }

    // Return original photo if annotation was cancelled
    return { file: photo, annotationData: null, originalFile: undefined, caption: '' };
  }
  
  // Upload photo to Service_Visuals_Attach - EXACT same approach as working Attach table
  async uploadPhotoForVisual(visualId: string, photo: File, key: string, isBatchUpload: boolean = false, annotationData: any = null, originalPhoto: File | null = null, caption: string = '') {
    // Extract category from key (format: category_itemId)
    const category = key.split('_')[0];
    
    // Ensure the accordion for this category stays expanded
    if (!this.expandedAccordions.includes(category)) {
      this.expandedAccordions.push(category);
      if (this.visualAccordionGroup) {
        this.visualAccordionGroup.value = this.expandedAccordions;
      }
    }
    
    // COMPRESS the photo before upload - OPTIMIZED for faster uploads
    const compressedPhoto = await this.imageCompression.compressImage(photo, {
      maxSizeMB: 0.8,  // Reduced from 1.5MB for faster uploads
      maxWidthOrHeight: 1280,  // Reduced from 1920px - sufficient for reports
      useWebWorker: true
    }) as File;

    const uploadFile = compressedPhoto || photo;

    // Use the ID from visualRecordIds to ensure consistency
    const actualVisualId = this.visualRecordIds[key] || visualId;
    const isPendingVisual = !actualVisualId || actualVisualId === '__pending__';

    // INSTANTLY show preview with object URL
    let tempId: string | undefined;

    if (actualVisualId && actualVisualId !== 'undefined') {
      // [v1.4.387] ONLY store photos by KEY for consistency
      if (!this.visualPhotos[key]) {
        this.visualPhotos[key] = [];
      }
      
      // Create instant preview
      const objectUrl = URL.createObjectURL(photo);
      tempId = `temp_${Date.now()}_${Math.random()}`;
      const photoData: any = {
        AttachID: tempId,
        id: tempId,
        name: photo.name,
        url: objectUrl,
        thumbnailUrl: objectUrl,
        isObjectUrl: true,
        uploading: !isPendingVisual,
        queued: isPendingVisual,
        hasAnnotations: !!annotationData,
        annotations: annotationData || null,
        caption: caption || '', // Store caption in photo data
        annotation: caption || '' // Also store as annotation field for Caspio
      };
      this.visualPhotos[key].push(photoData);
      
      // PERFORMANCE: Trigger change detection with OnPush strategy
      this.changeDetectorRef.detectChanges();

      if (isPendingVisual) {
        if (!this.pendingPhotoUploads[key]) {
          this.pendingPhotoUploads[key] = [];
        }

        this.pendingPhotoUploads[key].push({
          file: uploadFile,
          annotationData,
          originalPhoto,
          isBatchUpload,
          tempId,
          caption: caption || '' // Store caption for later upload
        });

        this.showToast('Auto-save is paused. Photo queued and will upload when syncing resumes.', 'warning');
        return;
      }
    }

    // Now do the actual upload in background
    try {
      // Parse visualId to number as required by the service
      const visualIdNum = parseInt(actualVisualId, 10);
      
      if (isNaN(visualIdNum)) {
        throw new Error(`Invalid VisualID: ${actualVisualId}`);
      }
      
      // Prepare debug information
      const allVisualIds = Object.entries(this.visualRecordIds)
        .map(([k, v]) => `${k}: ${v}`)
        .join('<br>');
      
      // Prepare the data that will be sent
      const dataToSend = {
        table: 'Services_Visuals_Attach',
        fields: {
          VisualID: visualIdNum,
          Annotation: caption || '', // Use caption from photo editor
          Photo: `[File: ${uploadFile.name}]`
        },
        fileInfo: {
          name: uploadFile.name,
          size: `${(uploadFile.size / 1024).toFixed(2)} KB`,
          type: uploadFile.type || 'unknown'
        },
        process: [
          '1. Upload file to Files API',
          '2. Create record with VisualID and Annotation (without Photo)',
          '3. Update record with Photo field containing file path'
        ],
        debug: {
          key: key,
          rawVisualId: visualId,
          actualVisualId: actualVisualId,
          parsedNumber: visualIdNum,
          storedForKey: this.visualRecordIds[key],
          allStoredIds: allVisualIds
        }
      };
      
      // Show popup with data to be sent (skip for batch uploads)
      // [v1.4.574] CRITICAL FIX: Removed duplicate upload call here
      // Was calling performVisualPhotoUpload TWICE - once here and once in else block below
      // await this.performVisualPhotoUpload(visualIdNum, uploadFile, key, isBatchUpload, annotationData, originalPhoto, tempId);

      if (false && !isBatchUpload) {
        const alert = await this.alertController.create({
          header: 'Services_Visuals_Attach Upload Debug',
        message: `
          <div style="text-align: left; font-family: monospace; font-size: 12px;">
            <strong style="color: red;">ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â DEBUG INFO:</strong><br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Key: ${dataToSend.debug.key}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Raw VisualID param: ${dataToSend.debug.rawVisualId}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Stored for this key: ${dataToSend.debug.storedForKey}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Using VisualID: <strong style="color: blue;">${dataToSend.debug.actualVisualId}</strong><br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Parsed Number: <strong style="color: blue;">${dataToSend.debug.parsedNumber}</strong><br><br>
            
            <strong>All Stored Visual IDs:</strong><br>
            <div style="max-height: 100px; overflow-y: auto; background: #f0f0f0; padding: 5px;">
              ${dataToSend.debug.allStoredIds || 'None'}
            </div><br>
            
            <strong>Table:</strong> ${dataToSend.table}<br><br>
            
            <strong>Fields to Send:</strong><br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ VisualID: <strong style="color: red;">${dataToSend.fields.VisualID}</strong> (Integer)<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Annotation: "${dataToSend.fields.Annotation}" (Text)<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Photo: Will store file path after upload<br><br>
            
            <strong>File Info:</strong><br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Name: ${dataToSend.fileInfo.name}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Size: ${dataToSend.fileInfo.size}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Type: ${dataToSend.fileInfo.type}<br><br>
            
            <strong>Upload Process:</strong><br>
            ${dataToSend.process.map(step => `ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ${step}`).join('<br>')}
          </div>
        `,
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel'
          },
          {
            text: 'Upload',
            handler: async () => {
              // Proceed with upload
              await this.performVisualPhotoUpload(visualIdNum, uploadFile, key, false, annotationData, originalPhoto, tempId, caption);
            }
          }
        ]
      });

        await alert.present();
      } else {
        // For batch uploads, proceed directly without popup
        await this.performVisualPhotoUpload(visualIdNum, uploadFile, key, true, annotationData, originalPhoto, tempId, caption);
      }

    } catch (error) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Failed to prepare upload:', error);
      await this.showToast('Failed to prepare photo upload', 'danger');
    }
  }
  
  // Separate method to perform the actual upload
  private async performVisualPhotoUpload(
    visualIdNum: number,
    photo: File,
    key: string,
    isBatchUpload: boolean = false,
    annotationData: any = null,
    originalPhoto: File | null = null,
    tempPhotoId?: string,
    caption: string = ''
  ) {
    // [v1.4.571] Generate unique upload ID to track duplicates
    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      
      // Prepare the Drawings field data (annotation JSON)
      // [v1.4.573] FIX: Only pass drawings data if annotations actually exist
      // Passing EMPTY_COMPRESSED_ANNOTATIONS when there are no annotations causes duplicate uploads
      let drawingsData = annotationData ? JSON.stringify(annotationData) : undefined;
      
      // Using EXACT same approach as working Required Documents upload
      let response;
      try {
        response = await this.caspioService.createServicesVisualsAttachWithFile(
          visualIdNum,
          caption || '', // Use caption from photo editor
          photo,  // Upload the photo (annotated or original)
          drawingsData, // Pass the annotation JSON to Drawings field
          originalPhoto || undefined // Pass original photo if we have annotations
        ).toPromise();
      } catch (uploadError: any) {
        console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Upload failed:', uploadError);
        
        // Show detailed error popup
        const errorDetails = {
          message: uploadError?.message || 'Unknown error',
          status: uploadError?.status || 'N/A',
          statusText: uploadError?.statusText || 'N/A',
          error: uploadError?.error || {},
          visualId: visualIdNum,
          fileName: photo.name,
          fileSize: photo.size,
          hasAnnotations: !!annotationData,
          timestamp: new Date().toISOString()
        };

        // Show simple error toast instead of detailed popup
        await this.showToast('Failed to upload photo', 'danger');

//         const errorAlert = await this.alertController.create({
//           header: 'ÃƒÂ¢Ã‚ÂÃ…â€™ Structural Systems Upload Failed',
//           message: `
//             <div style="text-align: left; font-size: 12px;">
//               <strong style="color: red;">Error Details:</strong><br>
//               Message: ${errorDetails.message}<br>
//               Status: ${errorDetails.status}<br>
//               Status Text: ${errorDetails.statusText}<br><br>
//               
//               <strong>Request Info:</strong><br>
//               VisualID: ${errorDetails.visualId}<br>
//               File: ${errorDetails.fileName}<br>
//               Size: ${(errorDetails.fileSize / 1024).toFixed(2)} KB<br>
//               Has Annotations: ${errorDetails.hasAnnotations}<br><br>
//               
//               <strong>API Response:</strong><br>
//               <div style="max-height: 100px; overflow-y: auto; background: #f0f0f0; padding: 5px; font-family: monospace;">
//                 ${JSON.stringify(errorDetails.error, null, 2)}
//               </div><br>
//               
//               <strong>Time:</strong> ${errorDetails.timestamp}
//             </div>
//           `,
//           buttons: [
//             {
//               text: 'Copy Error Details',
//               handler: () => {
//                 const errorText = JSON.stringify(errorDetails, null, 2);
//                 if (navigator.clipboard) {
//                   navigator.clipboard.writeText(errorText);
//                   this.showToast('Error details copied to clipboard', 'success');
//                 }
//               }
//             },
//             {
//               text: 'OK',
//               role: 'cancel'
//             }
//           ]
//         });
//         
//         await errorAlert.present();
        throw uploadError; // Re-throw to handle in outer catch
      }
      
      // [v1.4.388 FIX] Update photo directly in key-based storage where it was added
      // The temp photo is stored in visualPhotos[key], not visualPhotos[actualVisualId]
      const keyPhotos = this.visualPhotos[key] || [];
      let tempPhotoIndex = -1;

      if (tempPhotoId) {
        tempPhotoIndex = keyPhotos.findIndex((p: any) => p.id === tempPhotoId || p.AttachID === tempPhotoId);
      }

      if (tempPhotoIndex === -1) {
        tempPhotoIndex = keyPhotos.findIndex((p: any) => p.uploading === true && p.name === photo.name);
      }

      if (tempPhotoIndex !== -1) {
        // Load the actual image from API instead of keeping blob URL
        const filePath = response?.Photo || '';
        let imageUrl = keyPhotos[tempPhotoIndex].url; // Default to blob URL

        if (filePath) {
          try {
            const imageData = await this.caspioService.getImageFromFilesAPI(filePath).toPromise();
            if (imageData && imageData.startsWith('data:')) {
              imageUrl = imageData;
            }
          } catch (err) {
            console.error(`[v1.4.388] Failed to load uploaded image, keeping blob URL:`, err);
          }
        }

        // Update the temp photo with real data
        keyPhotos[tempPhotoIndex] = {
          ...keyPhotos[tempPhotoIndex],
          AttachID: response?.AttachID || response?.PK_ID || response?.id,
          id: response?.AttachID || response?.PK_ID || response?.id,
          Photo: filePath,
          filePath: filePath,
          url: imageUrl,
          thumbnailUrl: imageUrl,
          displayUrl: keyPhotos[tempPhotoIndex].hasAnnotations ? undefined : imageUrl,
          originalUrl: imageUrl,
          uploading: false // Remove uploading flag
        };
        
        // PERFORMANCE: Trigger change detection with OnPush strategy
        this.changeDetectorRef.detectChanges();

        // Also update in visualId-based storage for backward compatibility
        const actualVisualId = String(this.visualRecordIds[key]);
        if (actualVisualId && actualVisualId !== 'undefined') {
          if (!this.visualPhotos[actualVisualId]) {
            this.visualPhotos[actualVisualId] = [];
          }
          // Add or update the photo in visualId storage
          const visualIdPhotos = this.visualPhotos[actualVisualId];
          const visualIdPhotoIndex = visualIdPhotos.findIndex((p: any) => p.name === photo.name);
          if (visualIdPhotoIndex !== -1) {
            visualIdPhotos[visualIdPhotoIndex] = keyPhotos[tempPhotoIndex];
          } else {
            visualIdPhotos.push(keyPhotos[tempPhotoIndex]);
          }
        }
      } else {
        console.error(`[v1.4.388] ERROR: Could not find temp photo to update in key storage: ${key}`);
        console.error(`  Looking for photo: ${photo.name}`);
        console.error(`  Photos in key storage: ${keyPhotos.length}`);
        keyPhotos.forEach((p: any, i: number) => {
          console.error(`    Photo ${i}: ${p.name}, uploading: ${p.uploading}`);
        });
      }
      
      // No need to restore states - the UI should remain unchanged
      
    } catch (error) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Failed to upload photo:', error);
      
      // [v1.4.388 FIX] Remove the failed temp photo from key-based storage where it was added
      const keyPhotos = this.visualPhotos[key];
      if (keyPhotos) {
        const tempPhotoIndex = keyPhotos.findIndex((p: any) => p.uploading === true && p.name === photo.name);
        if (tempPhotoIndex !== -1) {
          keyPhotos.splice(tempPhotoIndex, 1);
        }
      }

      // Also remove from visualId storage if it exists there
      const actualVisualId = String(this.visualRecordIds[key]);
      if (actualVisualId && this.visualPhotos[actualVisualId]) {
        const photos = this.visualPhotos[actualVisualId];
        const tempPhotoIndex = photos.findIndex((p: any) => p.uploading === true && p.name === photo.name);
        if (tempPhotoIndex !== -1) {
          photos.splice(tempPhotoIndex, 1);
        }
      }
      
      if (!isBatchUpload) {
        await this.showToast('Failed to upload photo', 'danger');
      } else {
        throw error; // Re-throw for batch handler to catch
      }
    }
  }
  
  // Get photo count for a visual
  getPhotoCount(category: string, itemId: string): number {
    const key = `${category}_${itemId}`;
    const visualId = String(this.visualRecordIds[key]); // Ensure string
    const count = visualId && visualId !== 'undefined' && this.visualPhotos[visualId] ? this.visualPhotos[visualId].length : 0;
    
    // Removed console logging for performance
    
    return count;
  }
  
  // Check if photos are currently uploading for a visual
  isUploadingPhotos(category: string, itemId: string): boolean {
    const key = `${category}_${itemId}`;
    return (this.uploadingPhotos[key] || 0) > 0;
  }
  
  // Get number of photos being uploaded
  getUploadingCount(category: string, itemId: string): number {
    const key = `${category}_${itemId}`;
    return this.uploadingPhotos[key] || 0;
  }
  
  // Get photos for a visual
  getPhotosForVisual(category: string, itemId: string): any[] {
    const key = `${category}_${itemId}`;
    
    // [v1.4.387] ONLY use key-based storage for consistency
    const photos = this.visualPhotos[key] || [];
    if (photos.length > 0) {
      // Only log once per key to reduce console spam
      if (!this._loggedPhotoKeys) this._loggedPhotoKeys = new Set();
      if (!this._loggedPhotoKeys.has(key)) {
        this._loggedPhotoKeys.add(key);
        console.log(`[STRUCTURAL DEBUG] Photos for ${key}:`, 
          photos.map(p => ({ 
            AttachID: p.AttachID,
            hasUrl: !!p.url,
            urlType: p.url?.startsWith('data:') ? 'base64' : p.url?.startsWith('blob:') ? 'blob' : 'none',
            hasThumbnail: !!p.thumbnailUrl,
            thumbnailType: p.thumbnailUrl?.startsWith('data:') ? 'base64' : p.thumbnailUrl?.startsWith('blob:') ? 'blob' : 'placeholder',
            hasDisplay: !!p.displayUrl,
            displayType: p.displayUrl?.startsWith('data:') ? 'base64' : p.displayUrl?.startsWith('blob:') ? 'blob' : 'none',
            caption: p.caption,
            // Show first 50 chars of actual URL for debugging
            urlPreview: p.displayUrl?.substring(0, 50) || p.thumbnailUrl?.substring(0, 50) || p.url?.substring(0, 50)
          }))
        );
      }
    }
    
    return photos;
  }
  
  // Handle image loading errors
  handleImageError(event: any, photo: any) {
    
    // If this is a blob URL that expired, try to use the original URL
    if (photo.url && photo.url.startsWith('data:')) {
      const target = event.target as HTMLImageElement;
      target.src = photo.url;
      return;
    }
    const target = event.target as HTMLImageElement;
    target.src = 'data:image/svg+xml;base64,' + btoa(`
      <svg width="150" height="100" xmlns="http://www.w3.org/2000/svg">
        <rect width="150" height="100" fill="#f0f0f0"/>
        <text x="75" y="45" text-anchor="middle" fill="#999" font-family="Arial" font-size="14">ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â·</text>
        <text x="75" y="65" text-anchor="middle" fill="#999" font-family="Arial" font-size="11">Photo</text>
      </svg>
    `);
  }
  
  // Add custom visual comment with photo support
  async addCustomVisual(category: string, kind: string) {
    // Dynamically import the modal component
    const { AddCustomVisualModalComponent } = await import('../../modals/add-custom-visual-modal/add-custom-visual-modal.component');

    const modal = await this.modalController.create({
      component: AddCustomVisualModalComponent,
      componentProps: {
        kind: kind,
        category: category
      }
    });

    await modal.present();

    const { data } = await modal.onDidDismiss();

    if (data && data.name) {
      // Get processed photos with annotation data and captions
      const processedPhotos = data.processedPhotos || [];
      const files = data.files && data.files.length > 0 ? data.files : null;

      // Create the visual with photos
      await this.createCustomVisualWithPhotos(category, kind, data.name, data.description || '', files, processedPhotos);
    }
  }
  
  // Create custom visual with photos
  async createCustomVisualWithPhotos(category: string, kind: string, name: string, text: string, files: FileList | File[] | null, processedPhotos: any[] = []) {
    try {
      const serviceId = this.serviceId;
      if (!serviceId) {
        await this.showToast('Service ID not found', 'danger');
        return;
      }

      const serviceIdNum = parseInt(serviceId, 10);
      if (isNaN(serviceIdNum)) {
        await this.showToast('Invalid Service ID', 'danger');
        return;
      }

      const visualData: ServicesVisualRecord = {
        ServiceID: serviceIdNum,
        Category: category,
        Kind: kind,
        Name: name,
        Text: text,
        Notes: ''
      };

      // Check offline mode BEFORE making API calls
      const currentlyOnline = this.offlineService.isOnline();
      const manualOffline = this.offlineService.isManualOffline();

      // Generate a temporary ID for the custom visual
      const tempId = `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const key = `${category}_${tempId}`;

      // If offline, queue the visual creation
      if (!currentlyOnline || manualOffline) {
        // Add to local data structure immediately with temp ID
        if (!this.organizedData[category]) {
          this.organizedData[category] = {
            comments: [],
            limitations: [],
            deficiencies: []
          };
        }

        const customItem = {
          id: tempId,
          name: name,
          text: text,
          isCustom: true
        };

        // Add to appropriate array
        const kindKey = kind.toLowerCase() + 's';
        if (kindKey === 'comments') {
          this.organizedData[category].comments.push(customItem);
        } else if (kindKey === 'limitations') {
          this.organizedData[category].limitations.push(customItem);
        } else if (kindKey === 'deficiencys' || kindKey === 'deficiencies') {
          this.organizedData[category].deficiencies.push(customItem);
        }

        // Mark as pending
        this.visualRecordIds[key] = '__pending__';
        this.selectedItems[key] = true;

        // Queue for later creation
        this.pendingVisualCreates[key] = {
          category,
          templateId: tempId,
          data: visualData
        };

        // Update categoryData
        if (!this.categoryData[category]) {
          this.categoryData[category] = {};
        }
        this.categoryData[category][tempId] = {
          selected: true,
          ...customItem
        };

        // Handle photos if provided - store as base64 for offline mode
        if (files && files.length > 0) {
          const photoPromises: Promise<any>[] = [];

          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const promise = new Promise<void>((resolve) => {
              const reader = new FileReader();
              reader.onload = (e: any) => {
                const base64Image = e.target.result;

                // Store photo in visualPhotos with key for later upload
                if (!this.visualPhotos[key]) {
                  this.visualPhotos[key] = [];
                }

                this.visualPhotos[key].push({
                  url: base64Image,
                  thumbnailUrl: base64Image,
                  file: file, // Keep original file for upload later
                  pending: true
                });

                resolve();
              };
              reader.readAsDataURL(file);
            });
            photoPromises.push(promise);
          }

          // Wait for all photos to be converted to base64
          await Promise.all(photoPromises);

          // Store files for later upload
          if (!this.pendingPhotoUploads) {
            this.pendingPhotoUploads = {};
          }
          if (!this.pendingPhotoUploads[key]) {
            this.pendingPhotoUploads[key] = [];
          }

          for (const file of Array.from(files)) {
            this.pendingPhotoUploads[key].push({
              file: file,
              visualId: '__pending__',
              timestamp: Date.now(),
              isBatchUpload: files.length > 1,
              tempId: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            });
          }
        }

        this.changeDetectorRef.detectChanges();
        await this.showToast('Visual queued and will save when auto-sync resumes.', 'warning');
        return;
      }

      // Online mode - proceed with API call
      try {
        // Create the visual record using the EXACT same pattern as createVisualRecord (line 4742)
        const response = await this.caspioService.createServicesVisual(visualData).toPromise();

        // Extract VisualID using the SAME logic as line 4744-4754
        let visualId: string | null = null;

        if (Array.isArray(response) && response.length > 0) {
          visualId = String(response[0].VisualID || response[0].PK_ID || response[0].id || '');
        } else if (response && typeof response === 'object') {
          if (response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
            visualId = String(response.Result[0].VisualID || response.Result[0].PK_ID || response.Result[0].id || '');
          } else {
            visualId = String(response.VisualID || response.PK_ID || response.id || '');
          }
        } else if (response) {
          visualId = String(response);
        }

        if (!visualId || visualId === 'undefined' || visualId === 'null' || visualId === '') {
          throw new Error('No VisualID returned from server');
        }
        
        // Add to local data structure
        if (!this.organizedData[category]) {
          this.organizedData[category] = {
            comments: [],
            limitations: [],
            deficiencies: []
          };
        }
        
        const customItem = {
          id: visualId.toString(),
          name: name,
          text: text,
          isCustom: true
        };
        
        // Add to appropriate array
        const kindKey = kind.toLowerCase() + 's';
        if (kindKey === 'comments') {
          this.organizedData[category].comments.push(customItem);
        } else if (kindKey === 'limitations') {
          this.organizedData[category].limitations.push(customItem);
        } else if (kindKey === 'deficiencys' || kindKey === 'deficiencies') {
          this.organizedData[category].deficiencies.push(customItem);
        }
        
        // Store the visual ID for photo uploads
        const key = `${category}_${customItem.id}`;
        this.visualRecordIds[key] = String(visualId);
        
        // Mark as selected
        this.selectedItems[key] = true;
        
        // Update categoryData
        if (!this.categoryData[category]) {
          this.categoryData[category] = {};
        }
        this.categoryData[category][customItem.id] = {
          selected: true,
          ...customItem
        };

        // Upload photos if provided - in background without blocking UI
        if (files && files.length > 0) {
          // Start uploads in background (don't await)
          const uploadPromises = Array.from(files).map((file, index) => {
            // Get annotation data and caption for this photo from processedPhotos
            const photoData = processedPhotos[index] || {};
            const annotationData = photoData.annotationData || null;
            const originalFile = photoData.originalFile || null;
            const caption = photoData.caption || '';

            return this.uploadPhotoForVisual(String(visualId), file, key, true, annotationData, originalFile, caption)
              .then(() => {
                return { success: true, error: null };
              })
              .catch((error) => {
                console.error(`Failed to upload file ${index + 1}:`, error);
                return { success: false, error };
              });
          });

          // Monitor uploads in background without blocking
          Promise.all(uploadPromises).then(results => {
            // Count successes and failures
            const uploadSuccessCount = results.filter((r: { success: boolean }) => r.success).length;
            const failCount = results.filter((r: { success: boolean }) => !r.success).length;

            // Show result message only if there were failures
            if (failCount > 0 && uploadSuccessCount > 0) {
              this.showToast(
                `Uploaded ${uploadSuccessCount} of ${files.length} photos. ${failCount} failed.`,
                'warning'
              );
            } else if (failCount > 0 && uploadSuccessCount === 0) {
              this.showToast('Failed to upload photos', 'danger');
            }
            // Success case: no toast shown per user request
          });
        }
        
        // Trigger change detection
        this.changeDetectorRef.detectChanges();

        // Return the created item info for photo upload
        return {
          itemId: customItem.id,
          visualId: String(visualId),
          key: key
        };

      } catch (error: any) {
        console.error('âŒ Error creating custom visual:', error);
        console.error('Error details:', {
          message: error?.message,
          status: error?.status,
          error: error?.error,
          full: error
        });

        // Show more detailed error message
        const errorMsg = error?.error?.Message || error?.message || 'Failed to add visual';
        await this.showToast(errorMsg, 'danger');
        return null;
      }
    } catch (error) {
      console.error('Error in createCustomVisualWithPhotos:', error);
      return null;
    }
  }
  
  // Create custom visual in database (original method kept for backward compatibility)
  async createCustomVisual(category: string, kind: string, name: string, text: string) {
    try {
      const serviceId = this.serviceId;
      if (!serviceId) {
        await this.showToast('Service ID not found', 'danger');
        return;
      }
      
      const serviceIdNum = parseInt(serviceId, 10);
      if (isNaN(serviceIdNum)) {
        await this.showToast('Invalid Service ID', 'danger');
        return;
      }
      
      const visualData: ServicesVisualRecord = {
        ServiceID: serviceIdNum,
        Category: category,
        Kind: kind,
        Name: name,
        Text: text,
        Notes: ''
      };
      
      const loading = await this.loadingController.create({
        message: 'Adding visual...'
      });
      await loading.present();
      
      try {
        const response = await this.caspioService.createServicesVisual(visualData).toPromise();
        
        // Show debug popup with the response
        const debugAlert = await this.alertController.create({
          header: 'Custom Visual Creation Response',
          message: `
            <div style="text-align: left; font-family: monospace; font-size: 12px;">
              <strong style="color: green;">ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦ VISUAL CREATED SUCCESSFULLY</strong><br><br>
              
              <strong>Response from Caspio:</strong><br>
              <div style="background: #f0f0f0; padding: 10px; border-radius: 5px; max-height: 200px; overflow-y: auto;">
                ${JSON.stringify(response, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
              </div><br>
              
              <strong style="color: blue;">Key Fields:</strong><br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ VisualID (PRIMARY): <strong style="color: green;">${response?.VisualID || 'NOT FOUND'}</strong><br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ PK_ID: ${response?.PK_ID || 'N/A'}<br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ ServiceID: ${response?.ServiceID || 'N/A'}<br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Category: ${response?.Category || 'N/A'}<br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Kind: ${response?.Kind || 'N/A'}<br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Name: ${response?.Name || 'N/A'}<br><br>
              
              <strong>Will be stored as:</strong><br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Key: ${category}_${response?.VisualID || response?.PK_ID || Date.now()}<br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ VisualID for photos: <strong style="color: green;">${response?.VisualID || response?.PK_ID || 'MISSING!'}</strong>
            </div>
          `,
          cssClass: 'debug-alert-wide',
          buttons: ['OK']
        });
        await debugAlert.present();
        
        // Add to local data structure
        if (!this.organizedData[category]) {
          this.organizedData[category] = {
            comments: [],
            limitations: [],
            deficiencies: []
          };
        }
        
        // Determine which array to add to based on kind
        const kindKey = kind.toLowerCase() + 's'; // comments, limitations, deficiencies
        
        // Use VisualID from response, NOT PK_ID
        const visualId = response?.VisualID || response?.PK_ID || Date.now().toString();
        const customItem = {
          id: visualId.toString(), // Convert to string for consistency
          name: name,
          text: text,
          isCustom: true
        };
        
        if (kindKey === 'comments') {
          this.organizedData[category].comments.push(customItem);
        } else if (kindKey === 'limitations') {
          this.organizedData[category].limitations.push(customItem);
        } else if (kindKey === 'deficiencys' || kindKey === 'deficiencies') {
          this.organizedData[category].deficiencies.push(customItem);
        }
        
        // Store the visual ID for photo uploads - use VisualID from response!
        const key = `${category}_${customItem.id}`;
        this.visualRecordIds[key] = String(response?.VisualID || response?.PK_ID || customItem.id);
        
        // Mark as selected (use selectedItems, not selectedVisuals)
        this.selectedItems[key] = true;
        
        // Also update categoryData for consistency
        if (!this.categoryData[category]) {
          this.categoryData[category] = {};
        }
        this.categoryData[category][customItem.id] = {
          selected: true,
          ...customItem
        };
        
        await loading.dismiss();
        // Trigger change detection
        this.changeDetectorRef.detectChanges();
        
      } catch (error) {
        console.error('Error creating custom visual:', error);
        await loading.dismiss();
        await this.showToast('Failed to add visual', 'danger');
      }
    } catch (error) {
      console.error('Error in createCustomVisual:', error);
    }
  }
  
  // Update existing photo attachment with optional annotations
  async updatePhotoAttachment(attachId: string, file: File, annotations?: any, originalFile?: File, caption?: string): Promise<void> {
    try {
      
      // CRITICAL: Check if attachId is valid
      if (!attachId || attachId === 'undefined' || attachId === 'null') {
        console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Invalid AttachID:', attachId);
        
        // Show debug popup with detailed error info
        const alert = await this.alertController.create({
          header: 'ÃƒÂ¢Ã‚ÂÃ…â€™ Debug: Invalid AttachID',
          message: `
            <div style="font-family: monospace; font-size: 12px; text-align: left;">
              <strong style="color: red;">FAILED TO UPDATE - Invalid AttachID</strong><br><br>
              
              <strong>AttachID Value:</strong> "${attachId}"<br>
              <strong>AttachID Type:</strong> ${typeof attachId}<br>
              <strong>Is Undefined:</strong> ${attachId === undefined}<br>
              <strong>Is Null:</strong> ${attachId === null}<br>
              <strong>Is 'undefined' string:</strong> ${attachId === 'undefined'}<br>
              <strong>Is 'null' string:</strong> ${attachId === 'null'}<br>
              <strong>Is Empty:</strong> ${!attachId}<br><br>
              
              <strong>File Info:</strong><br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Name: ${file?.name || 'N/A'}<br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Size: ${file?.size || 0} bytes<br><br>
              
              <strong>Has Annotations:</strong> ${!!annotations}<br>
              <strong>Has Original File:</strong> ${!!originalFile}<br><br>
              
              <strong style="color: orange;">This error typically occurs when:</strong><br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Photo was loaded but AttachID wasn't preserved<br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Photo object is missing ID fields<br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Database didn't return AttachID<br><br>
              
              <strong>Stack Trace:</strong><br>
              ${new Error().stack?.split('\n').slice(0, 5).join('<br>')}
            </div>
          `,
          buttons: [
            {
              text: 'Copy Debug Info',
              handler: () => {
                const debugText = `Invalid AttachID Debug:
AttachID: "${attachId}"
Type: ${typeof attachId}
File: ${file?.name}
Has Annotations: ${!!annotations}`;
                navigator.clipboard.writeText(debugText);
                return false;
              }
            },
            { text: 'OK', role: 'cancel' }
          ]
        });
        await alert.present();
        
        throw new Error('Cannot update photo: Invalid AttachID');
      }
      
      // Update annotations - NOW WITH DEBUG POPUP
      
      // IMPORTANT: We do NOT upload the annotated file anymore!
      // We only save the annotation JSON data to the Drawings field
      // The Photo field must remain pointing to the original image
      
      // Update the attachment record - ONLY update Drawings field, NOT Photo field
      const updateData: any = {};
      if (annotations && typeof annotations === 'object') {
        if ('objects' in annotations) {
        } else if (Array.isArray(annotations)) {
        } else {
        }
      } else if (typeof annotations === 'string') {
      }
      
      // Add annotations to Drawings field if provided
      if (annotations) {
        // CRITICAL FIX v1.4.341: Caspio Drawings field is TEXT type
        // Handle blob URLs and ensure proper JSON formatting
        let drawingsData = '';
        
        // v1.4.351 DEBUG: Log EXACTLY what we're receiving
        // Fabric.js returns an object with 'objects' and 'version' properties
        if (annotations && typeof annotations === 'object' && 'objects' in annotations) {
          
          // This is a Fabric.js canvas export - stringify it DIRECTLY
          // The toJSON() method from Fabric.js already returns the COMPLETE canvas state
          try {
            // v1.4.351: The annotations from canvas.toJSON() are the COMPLETE state
            drawingsData = JSON.stringify(annotations);
            
            // v1.4.342: Validate the JSON is parseable
            try {
              const testParse = JSON.parse(drawingsData);
            } catch (e) {
              console.error('  ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Warning: JSON validation failed, but continuing');
            }
          } catch (e) {
            console.error('  ÃƒÂ¢Ã‚ÂÃ…â€™ Failed to stringify Fabric.js object:', e);
            // Try to create a minimal representation
            drawingsData = JSON.stringify({ objects: [], version: annotations.version || '5.3.0' });
          }
        } else if (annotations === null || annotations === undefined) {
          // Don't set drawingsData at all - let it remain undefined
        } else if (typeof annotations === 'string') {
          // Already a string - validate and clean it
          drawingsData = annotations;
          
          // Check if it contains blob URLs and if it's valid JSON
          try {
            if (drawingsData.startsWith('{') || drawingsData.startsWith('[')) {
              const parsed = JSON.parse(drawingsData);
              
              // Check for blob URLs in backgroundImage
              if (parsed.backgroundImage?.src?.startsWith('blob:')) {
                // Note: blob URLs become invalid after reload, but we still save them
                // The annotation system should handle missing background images gracefully
              }
              
              // Re-stringify to ensure consistent formatting
              drawingsData = JSON.stringify(parsed);
            }
          } catch (e) {
            // Keep the string as-is if it's not JSON
          }
        } else if (typeof annotations === 'object') {
          // Object - needs stringification
          try {
            // Check for blob URLs before stringifying
            if (annotations.backgroundImage?.src?.startsWith('blob:')) {
            }
            
            // CRITICAL FIX v1.4.336: Special handling for array of annotation objects
            // When reloading, annotations come back as an array of objects
            if (Array.isArray(annotations)) {
              
              // Clean each annotation object
              const cleanedAnnotations = annotations.map(ann => {
                // Remove any non-serializable properties
                const cleaned: any = {};
                for (const key in ann) {
                  const value = ann[key];
                  if (typeof value !== 'function' && 
                      !(value instanceof HTMLElement) &&
                      key !== 'canvas' && 
                      key !== 'ctx' &&
                      key !== 'fabric') {
                    cleaned[key] = value;
                  }
                }
                return cleaned;
              });
              
              drawingsData = JSON.stringify(cleanedAnnotations);
            } else {
              // Single object - use replacer to handle circular refs
              drawingsData = JSON.stringify(annotations, (key, value) => {
                // Skip any function properties
                if (typeof value === 'function') {
                  return undefined;
                }
                // Skip any DOM elements
                if (value instanceof HTMLElement) {
                  return undefined;
                }
                // Skip canvas-related properties
                if (key === 'canvas' || key === 'ctx' || key === 'fabric') {
                  return undefined;
                }
                // Handle undefined values
                if (value === undefined) {
                  return null;
                }
                return value;
              });
            }
          } catch (e) {
            console.error('  ÃƒÂ¢Ã‚ÂÃ…â€™ Failed to stringify:', e);
            // Try to create a simple representation
            try {
              drawingsData = JSON.stringify({ error: 'Could not serialize', type: typeof annotations });
            } catch (e2) {
              drawingsData = '';
            }
          }
        } else {
          // Other type - convert to string
          drawingsData = String(annotations);
        }
        
        // CRITICAL: Final validation before adding to updateData
        if (drawingsData && drawingsData !== '{}' && drawingsData !== '[]') {
          // v1.4.341: CRITICAL - Additional cleaning for Caspio compatibility
          const originalLength = drawingsData.length;
          
          // Remove problematic characters that Caspio might reject
          drawingsData = drawingsData
            .replace(/\u0000/g, '') // Remove null bytes
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars except tab, newline, carriage return
            .replace(/undefined/g, 'null'); // Replace 'undefined' strings with 'null'
          
          // v1.4.346 FIX: Compress data if it's too large - THIS IS THE COMPLETE DATA
          try {
            const parsed = JSON.parse(drawingsData);
            
            // Re-stringify to ensure clean JSON format
            drawingsData = JSON.stringify(parsed, (key, value) => {
              // Replace undefined with null for valid JSON
              return value === undefined ? null : value;
            });
            
            // COMPRESS if needed to fit in 64KB TEXT field
            const originalSize = drawingsData.length;
            drawingsData = compressAnnotationData(drawingsData, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });
            
            if (originalSize !== drawingsData.length) {
              
              // DEBUG: Show what's in the compressed data
              try {
                const compressedParsed = decompressAnnotationData(drawingsData);
              } catch (e) {
                console.error('  [v1.4.351] Could not parse compressed data for debug');
              }
            }
            
            // Final size check
            if (drawingsData.length > 64000) {
              console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ [v1.4.346] Canvas too complex:', drawingsData.length, 'bytes');
              console.error('  The CURRENT canvas state exceeds 64KB even after compression');
              console.error('  This is NOT an accumulation issue - the canvas has too many annotations');
              
              // Show error to user
              const alert = await this.alertController.create({
                header: 'ÃƒÂ¢Ã‚ÂÃ…â€™ Annotation Too Complex',
                message: `
                  <div style="font-family: monospace; font-size: 12px;">
                    <strong>The annotation data is too large to save.</strong><br><br>
                    
                    Data size: ${drawingsData.length.toLocaleString()} bytes<br>
                    Maximum: 64,000 bytes<br><br>
                    
                    <strong>Solutions:</strong><br>
                    ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Reduce the number of annotations<br>
                    ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Use simpler shapes (lines instead of complex paths)<br>
                    ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Clear and redraw with fewer strokes<br>
                  </div>
                `,
                buttons: ['OK']
              });
              await alert.present();
              throw new Error('Annotation data exceeds 64KB limit');
            }
          } catch (e) {
            if (e instanceof Error && e.message.includes('64KB')) {
              throw e; // Re-throw size limit errors
            }
            console.warn('  ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Could not re-parse for cleaning, using as-is');
          }
          
          if (originalLength !== drawingsData.length) {
          }
          
          // CRITICAL: Ensure it's definitely a string
          if (typeof drawingsData !== 'string') {
            console.error('  ÃƒÂ¢Ã‚ÂÃ…â€™ CRITICAL ERROR: drawingsData is not a string after processing!');
            console.error('    Type:', typeof drawingsData);
            console.error('    Value:', drawingsData);
            drawingsData = String(drawingsData);
          }
          
            // Set the Drawings field
          updateData.Drawings = drawingsData;
        } else {
          updateData.Drawings = EMPTY_COMPRESSED_ANNOTATIONS;
        }
      } else {
        updateData.Drawings = EMPTY_COMPRESSED_ANNOTATIONS;
      }
      // v1.4.351: Enhanced debug popup to show annotation details
      let annotationSummary = 'N/A';
      if (updateData.Drawings) {
        try {
          const tempParsed = decompressAnnotationData(updateData.Drawings);
          if (tempParsed && tempParsed.objects) {
            annotationSummary = `${tempParsed.objects.length} objects: ${tempParsed.objects.map((o: any) => o.type).join(', ')}`;
          }
        } catch (e) {
          annotationSummary = 'Could not parse';
        }
      }
      
      // Debug popup removed - proceeding directly with update
      /* const debugAlert = await this.alertController.create({
        header: 'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â [v1.4.351] Debug: Annotation Update',
        message: `
          <div style="font-family: monospace; font-size: 12px; text-align: left;">
            <strong style="color: blue;">UPDATE ATTACHMENT - v1.4.351</strong><br><br>
            
            <strong>AttachID:</strong> <span style="color: green;">${attachId}</span><br>
            <strong>AttachID Type:</strong> ${typeof attachId}<br><br>
            
            <strong>Update Data:</strong><br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Drawings field: ${updateData.Drawings ? 'YES' : 'NO'}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Drawings type: ${typeof updateData.Drawings}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Drawings is string: ${typeof updateData.Drawings === 'string'}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Drawings length: ${updateData.Drawings?.length || 0} chars<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Annotations: ${annotationSummary}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Drawings preview: ${updateData.Drawings ? updateData.Drawings.substring(0, 100) + '...' : 'N/A'}<br><br>
            
            <strong>File Info:</strong><br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Name: ${file?.name || 'N/A'}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Size: ${file?.size || 0} bytes<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Type: ${file?.type || 'N/A'}<br><br>
            
            <strong>Original File:</strong> ${originalFile ? originalFile.name : 'None'}<br><br>
            
            <strong>API Call:</strong><br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Table: Services_Visuals_Attach<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Method: PUT (update)<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Where: AttachID=${attachId}<br><br>
            
            <strong style="color: orange;">What happens next:</strong><br>
            1. Update Services_Visuals_Attach.Drawings field<br>
            2. Photo field remains unchanged (keeps original)<br>
            3. Annotations stored as JSON for re-editing<br>
          </div>
        `,
        buttons: [
          {
            text: 'Copy Debug',
            handler: () => {
              const debugText = `Update Attachment Debug:
AttachID: ${attachId}
Type: ${typeof attachId}
File: ${file?.name}
Has Drawings: ${!!updateData.Drawings}
Original File: ${originalFile?.name || 'None'}`;
              navigator.clipboard.writeText(debugText);
              return false;
            }
          },
          {
            text: 'Cancel Update',
            role: 'cancel',
            handler: () => {
              throw new Error('Update cancelled by user');
            }
          },
          {
            text: 'Continue',
            handler: async () => {
              // Continue with the update
              return true;
            }
          }
        ]
      });
      
      await debugAlert.present();
      const { role } = await debugAlert.onDidDismiss();
      
      if (role === 'cancel') {
        throw new Error('Update cancelled by user');
      } */

      // Add caption to updateData if provided
      if (caption !== undefined) {
        updateData.Annotation = caption;
      }

      // CRITICAL: Check if we have any data to update
      if (Object.keys(updateData).length === 0) {
        console.warn('ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â No data to update - updateData is empty');
        // Toast removed - silent return
        return;
      }
      
      // CRITICAL: Ensure Drawings field is properly formatted
      if (updateData.Drawings !== undefined) {
        // Make absolutely sure it's a string
        if (typeof updateData.Drawings !== 'string') {
          console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ CRITICAL: Drawings field is not a string!');
          console.error('  Type:', typeof updateData.Drawings);
          console.error('  Value:', updateData.Drawings);
          // Convert to string as last resort
          try {
            updateData.Drawings = JSON.stringify(updateData.Drawings);
          } catch (e) {
            console.error('  Failed to convert:', e);
            delete updateData.Drawings; // Remove the field if we can't convert it
          }
        }
        
        // Check for extremely long strings that might cause issues
        if (updateData.Drawings && updateData.Drawings.length > 50000) {
          console.warn('ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â WARNING: Drawings field is very long:', updateData.Drawings.length, 'characters');
          console.warn('  This might cause issues with Caspio');
        }
      }
      
      // Check each field in updateData
      for (const key in updateData) {
        const value = updateData[key];
        
        // CRITICAL: Ensure all values are strings for Caspio TEXT fields
        if (typeof value !== 'string' && value !== null && value !== undefined) {
          console.error(`ÃƒÂ¢Ã‚ÂÃ…â€™ Field "${key}" is not a string! Type: ${typeof value}`);
          // Convert to string if possible
          updateData[key] = String(value);
        }
      }
      
      // v1.4.327: Show debug info in alert for mobile app (no console)
      if (updateData.Drawings) {
        const drawingsInfo = {
          length: updateData.Drawings.length,
          type: typeof updateData.Drawings,
          first300: updateData.Drawings.substring(0, 300),
          last200: updateData.Drawings.substring(Math.max(0, updateData.Drawings.length - 200)),
          containsBlob: updateData.Drawings.includes('blob:'),
          containsEscapedQuotes: updateData.Drawings.includes('\\"'),
          containsDoubleBackslash: updateData.Drawings.includes('\\\\')
        };
        
        // Debug alert removed - proceeding directly
        /* const preUpdateDebug = await this.alertController.create({
          header: 'ÃƒÂ°Ã…Â¸Ã¢â‚¬Å“Ã‚Â¤ Debug: About to Update',
          message: `
            <div style="font-family: monospace; font-size: 10px; text-align: left;">
              <strong style="color: blue;">PRE-UPDATE DATA CHECK</strong><br><br>
              
              <strong>AttachID:</strong> ${attachId} (${typeof attachId})<br><br>
              
              <strong>Drawings Field Analysis:</strong><br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Length: <span style="color: ${drawingsInfo.length > 10000 ? 'red' : drawingsInfo.length > 5000 ? 'orange' : 'green'};">${drawingsInfo.length} chars</span><br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Type: ${drawingsInfo.type}<br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Contains blob URL: <span style="color: ${drawingsInfo.containsBlob ? 'orange' : 'green'};">${drawingsInfo.containsBlob ? 'YES ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â' : 'NO ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦'}</span><br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Escaped quotes: ${drawingsInfo.containsEscapedQuotes ? 'YES ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â' : 'NO'}<br>
              ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Double backslash: <span style="color: ${drawingsInfo.containsDoubleBackslash ? 'red' : 'green'};">${drawingsInfo.containsDoubleBackslash ? 'YES ÃƒÂ¢Ã‚ÂÃ…â€™' : 'NO ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦'}</span><br><br>
              
              <strong>First 300 chars:</strong><br>
              <div style="background: #f0f0f0; padding: 5px; font-size: 9px; overflow-wrap: break-word; max-height: 100px; overflow-y: auto;">
                ${drawingsInfo.first300.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
              </div><br>
              
              <strong>Last 200 chars:</strong><br>
              <div style="background: #f0f0f0; padding: 5px; font-size: 9px; overflow-wrap: break-word; max-height: 100px; overflow-y: auto;">
                ${drawingsInfo.last200.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
              </div><br>
              
              <strong style="color: orange;">Potential Issues:</strong><br>
              ${drawingsInfo.length > 10000 ? 'ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Very long string (>10KB)<br>' : ''}
              ${drawingsInfo.containsBlob ? 'ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Contains blob URLs (invalid after reload)<br>' : ''}
              ${drawingsInfo.containsDoubleBackslash ? 'ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Double-escaped backslashes detected<br>' : ''}
            </div>
          `,
          buttons: [
            {
              text: 'Copy Full Data',
              handler: async () => {
                const debugText = `AttachID: ${attachId}\nDrawings Length: ${drawingsInfo.length}\nFull Drawings:\n${updateData.Drawings}`;
                
                // v1.4.343: Enhanced clipboard handling for mobile
                try {
                  // Method 1: Try Clipboard API first
                  if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(debugText);
                    // Toast removed - silent copy
                  } else {
                    throw new Error('Clipboard API not available');
                  }
                } catch (e) {
                  // Method 2: Fallback using textarea
                  const textarea = document.createElement('textarea');
                  textarea.value = debugText;
                  textarea.style.position = 'fixed';
                  textarea.style.left = '0';
                  textarea.style.top = '0';
                  textarea.style.opacity = '0';
                  textarea.style.zIndex = '9999';
                  document.body.appendChild(textarea);
                  
                  // iOS specific handling
                  const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
                  if (isiOS) {
                    const range = document.createRange();
                    range.selectNodeContents(textarea);
                    const selection = window.getSelection();
                    selection?.removeAllRanges();
                    selection?.addRange(range);
                    textarea.setSelectionRange(0, 999999);
                  } else {
                    textarea.select();
                  }
                  
                  try {
                    const successful = document.execCommand('copy');
                    if (successful) {
                      // Toast removed - silent copy
                    } else {
                      // Method 3: Show data in a selectable text field
                      await this.showCopyableDebugData(debugText);
                    }
                  } catch (e2) {
                    // Method 3: Show data in a selectable text field
                    await this.showCopyableDebugData(debugText);
                  } finally {
                    document.body.removeChild(textarea);
                  }
                }
                return false;
              }
            },
            {
              text: 'Cancel',
              role: 'cancel'
            },
            {
              text: 'Send Update',
              cssClass: 'primary',
              handler: () => true
            }
          ]
        });
        
        await preUpdateDebug.present();
        const { role } = await preUpdateDebug.onDidDismiss();
        
        if (role === 'cancel') {
          await this.showToast('Update cancelled by user', 'warning');
          return;
        } */
      }
      
      // Send update request
      const updateResult = await this.caspioService.updateServiceVisualsAttach(attachId, updateData).toPromise();
      
      // CRITICAL FIX: Store the actual saved Drawings data (might be compressed)
      // This ensures rawDrawingsString matches what's in the database
      if (updateData.Drawings) {
        // Find and update the photo in visualPhotos to keep local state in sync
        for (const visualId in this.visualPhotos) {
          const photos = this.visualPhotos[visualId];
          if (photos && Array.isArray(photos)) {
            const photoIndex = photos.findIndex((p: any) => 
              (p.AttachID || p.id) === attachId
            );
            if (photoIndex !== -1) {
              // Update rawDrawingsString with what we just saved
              photos[photoIndex].rawDrawingsString = updateData.Drawings;
              break;
            }
          }
        }
      }
      
      // Success toast removed - silent update
    } catch (error: any) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Failed to update photo attachment:', error);
      
      // Show detailed error debug popup
      const errorAlert = await this.alertController.create({
        header: 'ÃƒÂ¢Ã‚ÂÃ…â€™ Update Failed - Error Details',
        message: `
          <div style="font-family: monospace; font-size: 11px; text-align: left;">
            <strong style="color: red;">UPDATE FAILED - DETAILED ERROR</strong><br><br>
            
            <strong>Error Message:</strong><br>
            <span style="color: red;">${error?.message || 'Unknown error'}</span><br><br>
            
            <strong>Error Type:</strong> ${error?.name || typeof error}<br>
            <strong>Error Code:</strong> ${error?.code || 'N/A'}<br>
            <strong>Status:</strong> ${error?.status || 'N/A'}<br><br>
            
            <strong>Request Details:</strong><br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ AttachID Used: ${attachId}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ AttachID Type: ${typeof attachId}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Has Annotations: ${!!annotations}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ File Name: ${file?.name || 'N/A'}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ File Size: ${file?.size || 'N/A'} bytes<br><br>
            
            <strong>Response Info:</strong><br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Status Text: ${error?.statusText || 'N/A'}<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Response Body: ${JSON.stringify(error?.error || error?.response || {}, null, 2).substring(0, 300)}...<br><br>
            
            <strong>Stack Trace:</strong><br>
            <pre style="font-size: 10px; overflow-x: auto;">${error?.stack?.substring(0, 500) || 'No stack trace'}</pre><br>
            
            <strong style="color: orange;">Common Causes:</strong><br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Invalid AttachID (record doesn't exist)<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ API token expired<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Network connectivity issue<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Caspio API error<br>
            ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ Missing permissions<br><br>
            
            <strong>Full Error Object:</strong><br>
            <pre style="font-size: 9px; overflow-x: auto; max-height: 150px;">${JSON.stringify(error, null, 2).substring(0, 1000)}</pre>
          </div>
        `,
        buttons: [
          {
            text: 'Copy Error Details',
            handler: async () => {
              const errorText = `Update Failed Error:
Message: ${error?.message}
AttachID: ${attachId}
Type: ${typeof attachId}
Status: ${error?.status}
Response: ${JSON.stringify(error?.error || error?.response || {})}
Stack: ${error?.stack}`;
              
              // v1.4.343: Enhanced clipboard handling for mobile
              try {
                // Method 1: Try Clipboard API first
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  await navigator.clipboard.writeText(errorText);
                  // Toast removed - silent copy
                } else {
                  throw new Error('Clipboard API not available');
                }
              } catch (e) {
                // Method 2: Fallback using textarea
                const textarea = document.createElement('textarea');
                textarea.value = errorText;
                textarea.style.position = 'fixed';
                textarea.style.left = '0';
                textarea.style.top = '0';
                textarea.style.opacity = '0';
                textarea.style.zIndex = '9999';
                document.body.appendChild(textarea);
                
                // iOS specific handling
                const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
                if (isiOS) {
                  const range = document.createRange();
                  range.selectNodeContents(textarea);
                  const selection = window.getSelection();
                  selection?.removeAllRanges();
                  selection?.addRange(range);
                  textarea.setSelectionRange(0, 999999);
                } else {
                  textarea.select();
                }
                
                try {
                  const successful = document.execCommand('copy');
                  if (successful) {
                    // Toast removed - silent copy
                  } else {
                    // Method 3: Show data in a selectable text field
                    await this.showCopyableDebugData(errorText);
                  }
                } catch (e2) {
                  // Method 3: Show data in a selectable text field
                  await this.showCopyableDebugData(errorText);
                } finally {
                  document.body.removeChild(textarea);
                }
              }
              return false;
            }
          },
          { text: 'OK', role: 'cancel' }
        ]
      });
      await errorAlert.present();
      
      throw error;
    }
  }
  
  // Quick annotate - open annotator directly
  async quickAnnotate(photo: any, category: string, itemId: string) {
    try {
      const key = `${category}_${itemId}`;
      const visualId = this.visualRecordIds[key];
      const latestPhoto = this.getLatestPhotoRecord(visualId, key, photo);

      if (!latestPhoto) {
        await this.showToast('Cannot edit photo right now. Please try again.', 'warning');
        return;
      }

      if (latestPhoto.uploading || latestPhoto.queued) {
        await this.showToast('Photo is still uploading. Please try again once it finishes.', 'warning');
        return;
      }

      const attachId = this.getValidAttachIdFromPhoto(latestPhoto);
      if (!attachId) {
        await this.showToast('Photo is still processing. Please try again in a moment.', 'warning');
        return;
      }

      const imageUrl = latestPhoto.url || latestPhoto.thumbnailUrl || 'assets/img/photo-placeholder.png';
      const photoName = latestPhoto.name || 'Photo';
      // Save scroll position before opening modal (only for mobile)
      const scrollPosition = this.platform.isWeb() ? 0 : (window.scrollY || document.documentElement.scrollTop);

      let existingAnnotations: any = null;
      const annotationSources = [
        latestPhoto.annotations,
        latestPhoto.annotationsData,
        latestPhoto.rawDrawingsString,
        latestPhoto.Drawings
      ];

      for (const source of annotationSources) {
        if (!source) {
          continue;
        }
        try {
          if (typeof source === 'string') {
            existingAnnotations = decompressAnnotationData(source);
          } else {
            existingAnnotations = source;
          }
          if (existingAnnotations) {
            break;
          }
        } catch {
          // Ignore parse errors
        }
      }

      if (existingAnnotations && !existingAnnotations.objects && Array.isArray(existingAnnotations)) {
        existingAnnotations = {
          version: '6.7.1',
          objects: existingAnnotations
        };
      }

      const modal = await this.modalController.create({
        component: FabricPhotoAnnotatorComponent,
        componentProps: {
          imageUrl,
          existingAnnotations,
          photoData: {
            ...latestPhoto,
            AttachID: attachId,
            id: attachId
          }
        },
        cssClass: 'fullscreen-modal'
      });

      await modal.present();
      const { data } = await modal.onDidDismiss();

      if (!data) {
        // Restore scroll if user cancels (mobile only)
        if (!this.platform.isWeb()) {
          this.restoreScrollPosition(scrollPosition);
        }
        return;
      }

      const annotatedBlob = data.blob || data.annotatedBlob;
      const annotationsData = data.annotationData || data.annotationsData;

      if (!annotatedBlob) {
        return;
      }

      const annotatedFile = new File([annotatedBlob], photoName, { type: 'image/jpeg' });
      let originalFile = null;
      if (data.originalBlob) {
        originalFile = data.originalBlob instanceof File
          ? data.originalBlob
          : new File([data.originalBlob], `original_${photoName}`, { type: 'image/jpeg' });
      }

      await this.updatePhotoAttachment(attachId, annotatedFile, annotationsData, originalFile, data.caption);

      const updateTargetPhoto = (photoList: any[] | undefined) => {
        if (!photoList) {
          return false;
        }
        const photoIndex = photoList.findIndex(
          (p: any) => this.getValidAttachIdFromPhoto(p) === attachId
        );

        if (photoIndex === -1) {
          return false;
        }

        const newUrl = URL.createObjectURL(annotatedBlob);
        const targetPhoto = photoList[photoIndex];

        if (!targetPhoto.originalUrl) {
          targetPhoto.originalUrl = targetPhoto.url;
        }

        targetPhoto.displayUrl = newUrl;
        if (!targetPhoto.thumbnailUrl || targetPhoto.thumbnailUrl.startsWith('blob:')) {
          targetPhoto.thumbnailUrl = newUrl;
        }
        targetPhoto.hasAnnotations = !!annotationsData;
        
        // CRITICAL FIX: Update main URL for immediate thumbnail display
        targetPhoto.url = newUrl;

        if (data.caption !== undefined) {
          targetPhoto.caption = data.caption;
          targetPhoto.Annotation = data.caption;
        }

        if (annotationsData) {
          targetPhoto.annotations = annotationsData;
          targetPhoto.rawDrawingsString = typeof annotationsData === 'object'
            ? JSON.stringify(annotationsData)
            : annotationsData;
        }

        return true;
      };

      const updated = updateTargetPhoto(this.visualPhotos[visualId]);
      if (!updated) {
        updateTargetPhoto(this.visualPhotos[key]);
      }

      // [WEBAPP FIX] Prevent scroll jumping during change detection
      const currentScroll = window.scrollY;
      this.changeDetectorRef.detectChanges();
      
      // [WEBAPP FIX] Immediately restore scroll after change detection on webapp
      if (this.platform.isWeb()) {
        window.scrollTo(0, currentScroll);
      }
      
      // Restore scroll position after update (mobile only)
      if (!this.platform.isWeb()) {
        this.restoreScrollPosition(scrollPosition);
      }

    } catch (error) {
      console.error('Error in quickAnnotate:', error);
      await this.showToast('Failed to open annotator', 'danger');
    }
  }


  // View photo - open viewer with integrated annotation
  async viewPhoto(photo: any, category: string, itemId: string) {
    try {
      const key = `${category}_${itemId}`;
      const visualId = this.visualRecordIds[key];
      const latestPhoto = this.getLatestPhotoRecord(visualId, key, photo);
      if (!latestPhoto) {
        await this.showToast('Cannot edit photo right now. Please try again.', 'warning');
        return;
      }

      if (latestPhoto.uploading || latestPhoto.queued) {
        await this.showToast('Photo is still uploading. Please try again once it finishes.', 'warning');
        return;
      }

      const attachId = this.getValidAttachIdFromPhoto(latestPhoto);
      if (!attachId) {
        await this.showToast('Photo is still processing. Please try again in a moment.', 'warning');
        return;
      }

      photo = latestPhoto;
      const imageUrl = photo.url || photo.thumbnailUrl || 'assets/img/photo-placeholder.png';
      const photoName = photo.name || 'Photo';
      
      // CRITICAL FIX v1.4.340: Always use the original URL (base image without annotations)
      // The originalUrl is set during loadExistingPhotos
      const originalImageUrl = photo.originalUrl || photo.url || imageUrl;
      
      // v1.4.345: Parse and decompress existing annotations
      let existingAnnotations = null;
      const annotationSources = [
        photo.rawDrawingsString,
        photo.annotations,
        photo.annotationsData,
        photo.Drawings
      ];
      
      for (const source of annotationSources) {
        if (source) {
          try {
            if (typeof source === 'string') {
              existingAnnotations = decompressAnnotationData(source);
            } else {
              existingAnnotations = source;
            }
            
            if (existingAnnotations) {
              break;
            }
          } catch (e) {
          }
        }
      }
      
      // Save scroll position before opening modal (only for mobile)
      const scrollPosition = this.platform.isWeb() ? 0 : (window.scrollY || document.documentElement.scrollTop);

      // Get existing caption from photo object
      const existingCaption = photo.caption || photo.Annotation || '';
      console.log(`[STRUCTURAL DEBUG] Existing caption:`, existingCaption);

      // ENHANCED: Open annotation window directly instead of photo viewer
      const modal = await this.modalController.create({
        component: FabricPhotoAnnotatorComponent,
        componentProps: {
          imageUrl: originalImageUrl,  // Always use original, not display URL
          // v1.4.345: Pass properly decompressed annotations
          existingAnnotations: existingAnnotations,
          existingCaption: existingCaption, // CRITICAL: Pass existing caption to photo editor
          photoData: {
            ...photo,
            AttachID: attachId,
            id: attachId,
            caption: existingCaption, // Ensure caption is available
            rawDrawingsString: photo.rawDrawingsString // v1.4.341: Pass the raw string
          },
          isReEdit: !!existingAnnotations  // Flag to indicate we're re-editing
        },
        cssClass: 'fullscreen-modal'
      });

      await modal.present();

      // Handle annotated photo returned from annotator
      const { data } = await modal.onDidDismiss();

      if (data && data.annotatedBlob) {
        // Update the existing photo instead of creating new
        const annotatedFile = new File([data.annotatedBlob], photoName, { type: 'image/jpeg' });
        
        // v1.4.342 CRITICAL FIX: Handle annotation data properly
        // The modal returns a Fabric.js JSON object from canvas.toJSON()
        let annotationsData = data.annotationData || data.annotationsData;
        
        // v1.4.342: Convert to string if it's an object (which it should be)
        if (annotationsData && typeof annotationsData === 'object') {
          // The updatePhotoAttachment will handle the stringification properly
          // Just pass the object as-is
        }
        
        // Get the original file if provided
        let originalFile = null;
        if (data.originalBlob) {
          originalFile = data.originalBlob instanceof File 
            ? data.originalBlob 
            : new File([data.originalBlob], `original_${photoName}`, { type: 'image/jpeg' });
        }
        
        if (attachId) {
          // Removed loading screen to allow debug popups to be visible
          
          try {
            // Update the existing attachment with annotations and original
            await this.updatePhotoAttachment(attachId, annotatedFile, annotationsData, originalFile, data.caption);
            
            // CRITICAL FIX: Use key instead of visualId to access photos array
            // Photos are stored by key (category_itemId), not by visualId
            const photoIndex = this.visualPhotos[key]?.findIndex(
              (p: any) => this.getValidAttachIdFromPhoto(p) === attachId
            );
            
            if (photoIndex !== -1 && this.visualPhotos[key]) {
              // CRITICAL FIX: Store original URL before updating display
              if (!this.visualPhotos[key][photoIndex].originalUrl) {
                // Save the original URL on first annotation
                this.visualPhotos[key][photoIndex].originalUrl = this.visualPhotos[key][photoIndex].url;
              }
              
              // Update ONLY the display URL with annotated version for preview
              // NOTE: Blob URLs are temporary and won't persist across page reloads
              const newUrl = URL.createObjectURL(data.annotatedBlob);
              this.visualPhotos[key][photoIndex].displayUrl = newUrl;
              
              // Keep thumbnailUrl as base64 if it exists and is valid
              // Only update if it's placeholder, blob, or undefined
              const currentThumbnail = this.visualPhotos[key][photoIndex].thumbnailUrl;
              const isPlaceholder = currentThumbnail === this.photoPlaceholder || currentThumbnail?.includes('photo-placeholder');
              const isBlob = currentThumbnail?.startsWith('blob:');
              const isValidBase64 = currentThumbnail?.startsWith('data:');
              
              if (!currentThumbnail || isPlaceholder || isBlob || !isValidBase64) {
                // If we have a valid base64 url, keep it; otherwise use blob
                const validUrl = this.visualPhotos[key][photoIndex].url;
                if (validUrl && validUrl.startsWith('data:')) {
                  // Keep the existing valid base64 thumbnailUrl
                  this.visualPhotos[key][photoIndex].thumbnailUrl = validUrl;
                } else {
                  // Use blob URL temporarily
                  this.visualPhotos[key][photoIndex].thumbnailUrl = newUrl;
                }
              }
              // If thumbnailUrl already has valid base64 data, keep it
              
              this.visualPhotos[key][photoIndex].hasAnnotations = true;
              
              // DO NOT overwrite the url field with blob URL - keep original base64/file path
              // The displayUrl will show the annotated version

              // Update caption if provided
              if (data.caption !== undefined) {
                this.visualPhotos[key][photoIndex].caption = data.caption;
                this.visualPhotos[key][photoIndex].Annotation = data.caption;
              }

              // Store annotations in the photo object
              if (annotationsData) {
                this.visualPhotos[key][photoIndex].annotations = annotationsData;
                // CRITICAL FIX: Also update rawDrawingsString so annotations persist on re-edit
                // The updatePhotoAttachment method saves to Drawings field, so we need to mirror that here
                if (typeof annotationsData === 'object') {
                  this.visualPhotos[key][photoIndex].rawDrawingsString = JSON.stringify(annotationsData);
                } else {
                  this.visualPhotos[key][photoIndex].rawDrawingsString = annotationsData;
                }
              }
            }
            
            // Success toast removed per user request

            // [WEBAPP FIX] On webapp, prevent scroll jumping during change detection
            const currentScroll = window.scrollY;
            
            // Trigger change detection with delay for annotation visibility
            this.changeDetectorRef.detectChanges();
            
            // [WEBAPP FIX] Immediately restore scroll position after first change detection
            if (this.platform.isWeb()) {
              window.scrollTo(0, currentScroll);
            }
            
            // Additional UI update - force template refresh for annotation visibility
            setTimeout(() => {
              const scrollBeforeUpdate = window.scrollY;
              this.changeDetectorRef.detectChanges();
              
              // [WEBAPP FIX] Restore scroll after second change detection
              if (this.platform.isWeb()) {
                window.scrollTo(0, scrollBeforeUpdate);
              }
            }, 100);
            
            // [v1.4.576] Restore scroll position AFTER ALL change detection completes (mobile only)
            if (!this.platform.isWeb()) {
              setTimeout(() => {
                this.restoreScrollPosition(scrollPosition);
              }, 200); // Increased delay to ensure all DOM updates and animations are complete
            }
          } catch (error) {
            await this.showToast('Failed to update photo', 'danger');
          }
        }
      } else {
        // Restore scroll if user cancels (no data returned) - mobile only
        // Skip scroll restoration on webapp to prevent unwanted autoscrolling
        if (!this.platform.isWeb()) {
          setTimeout(() => {
            this.restoreScrollPosition(scrollPosition);
          }, 200);
        }
      }

    } catch (error) {
      console.error('Error viewing photo:', error);
      await this.showToast('Failed to view photo', 'danger');
    }
  }
  
  // Delete existing photo
  async deletePhoto(photo: any, category: string, itemId: string) {
    try {
      const alert = await this.alertController.create({
        header: 'Delete Photo',
        message: 'Are you sure you want to delete this photo?',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            cssClass: 'alert-button-cancel'
          },
          {
            text: 'Delete',
            cssClass: 'alert-button-confirm',
            handler: () => {
              // Return false to prevent auto-dismiss, dismiss manually after delete
              // This prevents the handler from blocking the alert dismissal
              setTimeout(async () => {
                const loading = await this.loadingController.create({
                  message: 'Deleting photo...'
                });
                await loading.present();
                
                try {
                  const attachId = photo.AttachID || photo.id;
                  const key = `${category}_${itemId}`;
                  
                  // Delete from database
                  await this.caspioService.deleteServiceVisualsAttach(attachId).toPromise();
                  
                  // [v1.4.387] Remove from KEY-BASED storage
                  if (this.visualPhotos[key]) {
                    this.visualPhotos[key] = this.visualPhotos[key].filter(
                      (p: any) => (p.AttachID || p.id) !== attachId
                    );
                  }
                  
                  // Force UI update
                  this.changeDetectorRef.detectChanges();
                  
                  await loading.dismiss();
                  // Success toast removed per user request
                } catch (error) {
                  await loading.dismiss();
                  console.error('Failed to delete photo:', error);
                  await this.showToast('Failed to delete photo', 'danger');
                }
              }, 100);
              
              return true; // Allow alert to dismiss immediately
            }
          }
        ],
        cssClass: 'custom-document-alert'
      });
      
      await alert.present();
    } catch (error) {
      console.error('Error in deletePhoto:', error);
      await this.showToast('Failed to delete photo', 'danger');
    }
  }
  
  // Add another photo - triggers multi-photo capture
  async addAnotherPhoto(category: string, itemId: string, forceCamera: boolean = false) {
    this.currentUploadContext = {
      category,
      itemId,
      action: 'add'
    };

    if (forceCamera) {
      this.triggerFileInput('camera', { allowMultiple: false });
      return;
    }

    this.triggerFileInput('system', { allowMultiple: true });
  }

  // Add photo directly from camera (structural systems)
  async addPhotoFromCamera(category: string, itemId: string) {
    this.currentUploadContext = {
      category,
      itemId,
      action: 'add'
    };
    this.triggerFileInput('camera', { allowMultiple: false });
  }

  // Add photo from gallery (structural systems)
  async addPhotoFromGallery(category: string, itemId: string) {
    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Photos
      });

      if (image.webPath) {
        // Convert the image to a File object
        const response = await fetch(image.webPath);
        const blob = await response.blob();
        const file = new File([blob], `gallery-${Date.now()}.jpg`, { type: 'image/jpeg' });

        // Set context and process the file
        this.currentUploadContext = {
          category,
          itemId,
          action: 'add'
        };

        // Get or create visual ID
        const key = `${category}_${itemId}`;
        let visualId = this.visualRecordIds[key];

        if (!visualId) {
          await this.saveVisualSelection(category, itemId);
          visualId = this.visualRecordIds[key];
        }

        if (visualId) {
          // Process the file (no annotation for gallery selections)
          const processedFile = {
            file: file,
            annotationData: null,
            originalFile: undefined,
            caption: ''
          };

          // Upload the photo
          await this.uploadPhotoForVisual(visualId, processedFile.file, key, true, processedFile.annotationData, processedFile.originalFile, processedFile.caption);
          this.markReportChanged();
        }

        this.currentUploadContext = null;
      }
    } catch (error) {
      if (error !== 'User cancelled photos app') {
        console.error('Error selecting photo from gallery:', error);
        await this.showToast('Failed to select photo', 'danger');
      }
    }
  }

  // Take FDF photo directly from camera
  async takeFDFPhotoCamera(roomName: string, photoType: 'Top' | 'Bottom' | 'Threshold') {
    await this.takeFDFPhoto(roomName, photoType, 'camera');
  }

  // Take FDF photo from gallery
  async takeFDFPhotoGallery(roomName: string, photoType: 'Top' | 'Bottom' | 'Threshold') {
    const roomId = this.efeRecordIds[roomName];
    if (!roomId) {
      await this.showToast('Please save the room first', 'warning');
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
        // Convert the image to a File object
        const response = await fetch(image.webPath);
        const blob = await response.blob();
        const file = new File([blob], `gallery-${Date.now()}.jpg`, { type: 'image/jpeg' });

        // Set FDF context
        this.currentFDFPhotoContext = {
          roomName,
          photoType,
          roomId
        };

        // Process the FDF photo
        await this.processFDFPhoto(file);
        this.currentFDFPhotoContext = null;
      }
    } catch (error) {
      if (error !== 'User cancelled photos app') {
        console.error('Error selecting FDF photo from gallery:', error);
        await this.showToast('Failed to select photo', 'danger');
      }
    }
  }

  // Capture point photo directly from camera
  async capturePointPhotoCamera(roomName: string, point: any, photoType: 'Location' | 'Measurement', event?: Event) {
    await this.capturePointPhoto(roomName, point, photoType, event, 'camera');
  }

  // Capture point photo from gallery
  async capturePointPhotoGallery(roomName: string, point: any, photoType: 'Location' | 'Measurement', event?: Event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }

    try {
      const roomId = this.efeRecordIds[roomName];
      if (!roomId) {
        await this.showToast('Please save the room first', 'warning');
        return;
      }

      if (roomId === '__pending__') {
        await this.showToast('Room is queued for creation. Please enable Auto-Save first.', 'warning');
        return;
      }

      const pointKey = `${roomName}_${point.name}`;
      let pointId = this.efePointIds[pointKey];

      if (!pointId || pointId === '__pending__') {
        if (this.manualOffline) {
          await this.showToast('Please enable Auto-Save to take photos', 'warning');
          return;
        }

        const pointData = {
          EFEID: parseInt(roomId),
          PointName: point.name
        };
        const createResponse = await this.caspioService.createServicesEFEPoint(pointData).toPromise();

        if (createResponse && (createResponse.PointID || createResponse.PK_ID)) {
          pointId = createResponse.PointID || createResponse.PK_ID;
          this.efePointIds[pointKey] = pointId;
        } else {
          throw new Error('Failed to create point record');
        }
      }

      // Check if this photo type already exists
      const existingPhoto = this.getPointPhotoByType(point, photoType);
      if (existingPhoto) {
        const alert = await this.alertController.create({
          header: 'Replace Photo',
          message: `A ${photoType} photo already exists for this point. Replace it?`,
          buttons: [
            {
              text: 'Cancel',
              role: 'cancel'
            },
            {
              text: 'Replace',
              handler: async () => {
                await this.deleteRoomPhoto(existingPhoto, roomName, point, true);
                await this.selectAndProcessGalleryPhotoForPoint(roomName, point, pointId, roomId, photoType);
              }
            }
          ]
        });
        await alert.present();
        return;
      }

      await this.selectAndProcessGalleryPhotoForPoint(roomName, point, pointId, roomId, photoType);

    } catch (error) {
      console.error('Error in capturePointPhotoGallery:', error);
      await this.showToast('Failed to select photo', 'danger');
    }
  }

  // Helper method to select and process gallery photo for elevation point
  private async selectAndProcessGalleryPhotoForPoint(roomName: string, point: any, pointId: string, roomId: string, photoType: 'Location' | 'Measurement') {
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
        const file = new File([blob], `gallery-${Date.now()}.jpg`, { type: 'image/jpeg' });

        // Process the file without annotation (gallery selection)
        const photoUrl = URL.createObjectURL(file);

        if (!point.photos) {
          point.photos = [];
        }

        // Check if we should replace an existing photo of this type
        const existingPhotoIndex = point.photos.findIndex((p: any) =>
          (p.photoType === photoType) ||
          (p.annotation && p.annotation.startsWith(`${photoType}:`))
        );

        const photoEntry: any = {
          url: photoUrl,
          thumbnailUrl: photoUrl,
          photoType: photoType,
          annotation: '',
          caption: '',
          uploading: true,
          file: file,
          originalFile: undefined,
          annotationData: null,
          attachId: null
        };

        if (existingPhotoIndex >= 0) {
          point.photos[existingPhotoIndex] = photoEntry;
        } else {
          point.photos.push(photoEntry);
        }

        this.changeDetectorRef.detectChanges();

        // Upload the photo
        try {
          const compressedFile = await this.imageCompression.compressImage(file);
          const uploadFormData = new FormData();
          const fileName = `EFE_${roomName}_${point.name}_${photoType}_${Date.now()}.jpg`;
          uploadFormData.append('file', compressedFile, fileName);

          const token = await firstValueFrom(this.caspioService.getValidToken());
          const account = this.caspioService.getAccountID();

          const uploadResponse = await fetch(`https://${account}.caspio.com/rest/v2/files`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` },
            body: uploadFormData
          });

          const uploadResult = await uploadResponse.json();
          const uploadedFileName = uploadResult.Name || uploadResult.Result?.Name || fileName;
          const filePath = `/${uploadedFileName}`;

          // Create attachment record with correct field name
          const attachData = {
            PointID: parseInt(pointId),
            Photo: filePath,  // Use "Photo" field, not "FilePath"
            Annotation: '' // Initialize as blank (user can add caption later)
          };

          const attachResponse: any = await this.caspioService.post('/tables/Services_EFE_Points_Attach/records?response=rows', attachData).toPromise();

          // Handle the Result array structure
          const createdRecord = attachResponse?.Result?.[0] || attachResponse;

          if (createdRecord && createdRecord.AttachID) {
            photoEntry.attachId = createdRecord.AttachID;
            photoEntry.AttachID = createdRecord.AttachID;
            photoEntry.filePath = filePath;

            const imageData = await this.caspioService.getImageFromFilesAPI(filePath).toPromise();
            if (imageData && imageData.startsWith('data:')) {
              photoEntry.url = imageData;
              photoEntry.thumbnailUrl = imageData;
              URL.revokeObjectURL(photoUrl);
            }
          }

          photoEntry.uploading = false;
          this.changeDetectorRef.detectChanges();
          this.markReportChanged();

        } catch (uploadError) {
          console.error('Error uploading gallery photo:', uploadError);
          photoEntry.uploading = false;
          await this.showToast('Failed to upload photo', 'danger');
          const photoIndex = point.photos.indexOf(photoEntry);
          if (photoIndex >= 0) {
            point.photos.splice(photoIndex, 1);
          }
          this.changeDetectorRef.detectChanges();
        }
      }
    } catch (error) {
      if (error !== 'User cancelled photos app') {
        throw error;
      }
    }
  }
  
  // Save caption to the Annotation field in Services_Visuals_Attach table
  async saveCaption(photo: any, category: string, itemId: string) {
    try {
      // Only save if there's an AttachID and the caption has changed
      if (!photo.AttachID) {
        console.warn('No AttachID for photo, cannot save caption');
        return;
      }

      // Update the Services_Visuals_Attach record with the new caption
      const updateData = {
        Annotation: photo.caption || ''  // Save caption or empty string
      };

      await this.caspioService.updateServicesVisualsAttach(photo.AttachID, updateData).toPromise();

      // CRITICAL: Update Annotation field locally to match what was saved
      photo.Annotation = photo.caption || '';

      // Trigger change detection to update the view
      this.changeDetectorRef.detectChanges();

      // Success toast removed per user request
    } catch (error) {
      console.error('Error saving caption:', error);
    }
  }
  
  // Extract caption text from annotation field (removes "Location:" or "Measurement:" prefix)
  private extractCaptionFromAnnotation(annotation: string): string {
    if (!annotation) return '';
    
    // Remove "Location:" or "Measurement:" prefix if present
    if (annotation.startsWith('Location:')) {
      return annotation.substring('Location:'.length).trim();
    }
    if (annotation.startsWith('Measurement:')) {
      return annotation.substring('Measurement:'.length).trim();
    }
    
    // Return as-is if no prefix found
    return annotation;
  }

  // Save caption for room point photos (Location/Measurement in Elevation Plot)
  async saveRoomPointCaption(photo: any, roomName: string, point: any) {
    try {
      // Only save if there's an AttachID
      if (!photo || !photo.attachId) {
        console.warn('No AttachID for room point photo, cannot save caption');
        return;
      }

      // Update the Services_EFE_Points_Attach record with the new caption
      // Save just the caption text, not the photoType prefix
      const updateData = {
        Annotation: photo.caption || ''  // Save caption or empty string
      };

      await this.caspioService.updateServicesEFEPointsAttach(photo.attachId, updateData).toPromise();

      // CRITICAL: Update Annotation field locally to match what was saved
      photo.Annotation = photo.caption || '';

      console.log(`Caption saved for ${roomName} - ${point.name}: "${photo.caption}"`);

      // Trigger change detection to update the view
      this.changeDetectorRef.detectChanges();

    } catch (error) {
      console.error('Error saving room point caption:', error);
      await this.showToast('Failed to save caption', 'danger');
    }
  }
  
  // Save caption for FDF photos (Top, Bottom, Threshold in Elevation Plot)
  async saveFDFCaption(roomName: string, photoType: 'Top' | 'Bottom' | 'Threshold', caption: string) {
    try {
      const roomId = this.efeRecordIds[roomName];
      if (!roomId) {
        console.warn('No EFEID for FDF photo, cannot save caption');
        return;
      }

      // FIXED: Use the correct annotation field name for this FDF photo type
      const annotationColumnName = `FDF${photoType}Annotation`; // Correct format: FDFTopAnnotation, etc.
      const updateData: any = {};
      updateData[annotationColumnName] = caption || '';  // Save caption or empty string

      await this.caspioService.updateServicesEFEByEFEID(roomId, updateData).toPromise();

      console.log(`FDF ${photoType} caption saved for ${roomName}: "${caption}"`);

      // Trigger change detection to update the view
      this.changeDetectorRef.detectChanges();

    } catch (error) {
      console.error('Error saving FDF caption:', error);
      await this.showToast('Failed to save caption', 'danger');
    }
  }

  // Cached preset buttons HTML - built once for performance
  private presetButtonsHtml: string = (() => {
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

    let html = '<div class="preset-buttons-container">';
    presetButtons.forEach(row => {
      html += '<div class="preset-row">';
      row.forEach(label => {
        html += `<button type="button" class="preset-btn" data-text="${label}">${label}</button>`;
      });
      html += '</div>';
    });
    html += '</div>';
    return html;
  })();

  // Open caption popup for general photos
  async openCaptionPopup(photo: any, category: string, itemId: string) {
    const tempCaption = photo.caption || '';

    const alert = await this.alertController.create({
      header: 'Photo Caption',
      cssClass: 'caption-popup-alert',
      message: ' ',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Save',
          handler: () => {
            const input = document.getElementById('captionInput') as HTMLInputElement;
            const newCaption = input?.value || '';
            // Optimistic update - update UI immediately
            photo.caption = newCaption;
            // Save in background without blocking
            this.saveCaption(photo, category, itemId);
            return true;
          }
        }
      ]
    });

    await alert.present();

    // Use requestAnimationFrame for faster rendering
    requestAnimationFrame(() => {
      const alertElement = document.querySelector('.caption-popup-alert .alert-message');
      if (!alertElement) return;

      alertElement.innerHTML = `
        <div class="caption-popup-content">
          <div class="caption-input-container">
            <input type="text" id="captionInput" class="caption-text-input"
                   placeholder="Enter caption..."
                   value="${tempCaption.replace(/"/g, '&quot;')}"
                   maxlength="255" />
            <button type="button" id="undoCaptionBtn" class="undo-caption-btn" title="Undo Last Word">
              <ion-icon name="backspace-outline"></ion-icon>
            </button>
          </div>
          ${this.presetButtonsHtml}
        </div>
      `;

      const captionInput = document.getElementById('captionInput') as HTMLInputElement;
      const undoBtn = document.getElementById('undoCaptionBtn') as HTMLButtonElement;
      const container = alertElement.querySelector('.preset-buttons-container');

      // Use event delegation for better performance
      if (container && captionInput) {
        container.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target.classList.contains('preset-btn')) {
            e.preventDefault();
            e.stopPropagation();
            const text = target.getAttribute('data-text');
            if (text) {
              captionInput.value = captionInput.value + text + ' ';
              // Don't focus input to prevent keyboard popup on mobile
              // CRITICAL: Remove focus from button immediately to prevent orange highlight on mobile
              (target as HTMLButtonElement).blur();
            }
          }
        });
      }

      // Add undo button handler
      if (undoBtn && captionInput) {
        undoBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const currentValue = captionInput.value || '';
          if (currentValue.trim() === '') return;
          const words = currentValue.trim().split(' ');
          if (words.length > 0) words.pop();
          captionInput.value = words.join(' ');
          if (captionInput.value.length > 0) captionInput.value += ' ';
        });
      }
    });
  }

  // Open caption popup for FDF photos
  async openFDFCaptionPopup(roomName: string, photoType: 'Top' | 'Bottom' | 'Threshold') {
    const tempCaption = this.getFdfPhotoCaption(roomName, photoType);

    const alert = await this.alertController.create({
      header: 'Photo Caption',
      cssClass: 'caption-popup-alert',
      message: ' ',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Save',
          handler: () => {
            const input = document.getElementById('captionInput') as HTMLInputElement;
            const newCaption = input?.value || '';
            // Optimistic update - update UI immediately
            this.setFdfPhotoCaption(roomName, photoType, newCaption);
            // CRITICAL: Trigger change detection immediately to update the view
            // This is necessary because the template calls getFdfPhotoCaption() which returns a fresh value
            this.changeDetectorRef.detectChanges();
            // Save in background
            this.saveFDFCaption(roomName, photoType, newCaption);
            return true;
          }
        }
      ]
    });

    await alert.present();

    requestAnimationFrame(() => {
      const alertElement = document.querySelector('.caption-popup-alert .alert-message');
      if (!alertElement) return;

      alertElement.innerHTML = `
        <div class="caption-popup-content">
          <div class="caption-input-container">
            <input type="text" id="captionInput" class="caption-text-input"
                   placeholder="Enter caption..."
                   value="${tempCaption.replace(/"/g, '&quot;')}"
                   maxlength="255" />
            <button type="button" id="undoCaptionBtn" class="undo-caption-btn" title="Undo Last Word">
              <ion-icon name="backspace-outline"></ion-icon>
            </button>
          </div>
          ${this.presetButtonsHtml}
        </div>
      `;

      const captionInput = document.getElementById('captionInput') as HTMLInputElement;
      const undoBtn = document.getElementById('undoCaptionBtn') as HTMLButtonElement;
      const container = alertElement.querySelector('.preset-buttons-container');

      if (container && captionInput) {
        container.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target.classList.contains('preset-btn')) {
            e.preventDefault();
            e.stopPropagation();
            const text = target.getAttribute('data-text');
            if (text) {
              captionInput.value = captionInput.value + text + ' ';
              // Don't focus input to prevent keyboard popup on mobile
              // CRITICAL: Remove focus from button immediately to prevent orange highlight on mobile
              (target as HTMLButtonElement).blur();
            }
          }
        });
      }

      // Add undo button handler
      if (undoBtn && captionInput) {
        undoBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const currentValue = captionInput.value || '';
          if (currentValue.trim() === '') return;
          const words = currentValue.trim().split(' ');
          if (words.length > 0) words.pop();
          captionInput.value = words.join(' ');
          if (captionInput.value.length > 0) captionInput.value += ' ';
        });
      }
    });
  }

  // Open caption popup for room point photos
  async openRoomPointCaptionPopup(photo: any, roomName: string, point: any) {
    const tempCaption = photo.caption || '';

    const alert = await this.alertController.create({
      header: 'Photo Caption',
      cssClass: 'caption-popup-alert',
      message: ' ',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Save',
          handler: () => {
            const input = document.getElementById('captionInput') as HTMLInputElement;
            const newCaption = input?.value || '';
            // Optimistic update
            photo.caption = newCaption;
            // CRITICAL: Trigger change detection immediately to update the view
            // This is necessary because the template calls getPointPhotoByType() which returns a fresh reference
            this.changeDetectorRef.detectChanges();
            // Save in background
            this.saveRoomPointCaption(photo, roomName, point);
            return true;
          }
        }
      ]
    });

    await alert.present();

    requestAnimationFrame(() => {
      const alertElement = document.querySelector('.caption-popup-alert .alert-message');
      if (!alertElement) return;

      alertElement.innerHTML = `
        <div class="caption-popup-content">
          <div class="caption-input-container">
            <input type="text" id="captionInput" class="caption-text-input"
                   placeholder="Enter caption..."
                   value="${tempCaption.replace(/"/g, '&quot;')}"
                   maxlength="255" />
            <button type="button" id="undoCaptionBtn" class="undo-caption-btn" title="Undo Last Word">
              <ion-icon name="backspace-outline"></ion-icon>
            </button>
          </div>
          ${this.presetButtonsHtml}
        </div>
      `;

      const captionInput = document.getElementById('captionInput') as HTMLInputElement;
      const undoBtn = document.getElementById('undoCaptionBtn') as HTMLButtonElement;
      const container = alertElement.querySelector('.preset-buttons-container');

      if (container && captionInput) {
        container.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target.classList.contains('preset-btn')) {
            e.preventDefault();
            e.stopPropagation();
            const text = target.getAttribute('data-text');
            if (text) {
              captionInput.value = captionInput.value + text + ' ';
              // Don't focus input to prevent keyboard popup on mobile
              // CRITICAL: Remove focus from button immediately to prevent orange highlight on mobile
              (target as HTMLButtonElement).blur();
            }
          }
        });
      }

      // Add undo button handler
      if (undoBtn && captionInput) {
        undoBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const currentValue = captionInput.value || '';
          if (currentValue.trim() === '') return;
          const words = currentValue.trim().split(' ');
          if (words.length > 0) words.pop();
          captionInput.value = words.join(' ');
          if (captionInput.value.length > 0) captionInput.value += ' ';
        });
      }
    });
  }

  // Open caption popup for room photos (in Elevation Plot - old style)
  async openRoomPhotoCaptionPopup(photo: any, roomName: string, point: any) {
    const tempCaption = photo.caption || '';

    const alert = await this.alertController.create({
      header: 'Photo Caption',
      cssClass: 'caption-popup-alert',
      message: ' ',
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Save',
          handler: () => {
            const input = document.getElementById('captionInput') as HTMLInputElement;
            const newCaption = input?.value || '';
            // Optimistic update
            photo.caption = newCaption;
            // CRITICAL: Trigger change detection immediately to update the view
            this.changeDetectorRef.detectChanges();
            // Save in background
            this.saveRoomPhotoCaption(photo, roomName, point);
            return true;
          }
        }
      ]
    });

    await alert.present();

    requestAnimationFrame(() => {
      const alertElement = document.querySelector('.caption-popup-alert .alert-message');
      if (!alertElement) return;

      alertElement.innerHTML = `
        <div class="caption-popup-content">
          <div class="caption-input-container">
            <input type="text" id="captionInput" class="caption-text-input"
                   placeholder="Enter caption..."
                   value="${tempCaption.replace(/"/g, '&quot;')}"
                   maxlength="255" />
            <button type="button" id="undoCaptionBtn" class="undo-caption-btn" title="Undo Last Word">
              <ion-icon name="backspace-outline"></ion-icon>
            </button>
          </div>
          ${this.presetButtonsHtml}
        </div>
      `;

      const captionInput = document.getElementById('captionInput') as HTMLInputElement;
      const undoBtn = document.getElementById('undoCaptionBtn') as HTMLButtonElement;
      const container = alertElement.querySelector('.preset-buttons-container');

      if (container && captionInput) {
        container.addEventListener('click', (e) => {
          const target = e.target as HTMLElement;
          if (target.classList.contains('preset-btn')) {
            e.preventDefault();
            e.stopPropagation();
            const text = target.getAttribute('data-text');
            if (text) {
              captionInput.value = captionInput.value + text + ' ';
              // Don't focus input to prevent keyboard popup on mobile
              // CRITICAL: Remove focus from button immediately to prevent orange highlight on mobile
              (target as HTMLButtonElement).blur();
            }
          }
        });
      }

      // Add undo button handler
      if (undoBtn && captionInput) {
        undoBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const currentValue = captionInput.value || '';
          if (currentValue.trim() === '') return;
          const words = currentValue.trim().split(' ');
          if (words.length > 0) words.pop();
          captionInput.value = words.join(' ');
          if (captionInput.value.length > 0) captionInput.value += ' ';
        });
      }
    });
  }
  
  // Verify if visual was actually saved - v1.4.225 - FORCE REBUILD
  async verifyVisualSaved(category: string, templateId: string): Promise<boolean> {
    try {
      const visuals = await this.foundationData.getVisualsByService(this.serviceId);
      
      if (visuals && Array.isArray(visuals)) {
        const templateName = this.categoryData[category]?.[templateId]?.name;
        const found = visuals.some(v => 
          v.Category === category && 
          v.Name === templateName
        );
        
        if (found) {
          // Also refresh the ID
          await this.refreshVisualId(category, templateId);
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('Error verifying visual:', error);
      return false;
    }
  }
  
  // Show debug popup for visual creation
  async showVisualCreationDebug(category: string, templateId: string, response: any) {
    const key = `${category}_${templateId}`;
    
    // Extract ID from response
    let extractedId = 'Unknown';
    let responseType = 'Unknown';
    
    let pkId = 'N/A';
    let visualIdFromResponse = 'N/A';
    
    if (response === undefined || response === null || response === '') {
      responseType = 'Empty/Null Response';
      extractedId = 'Will generate temp ID';
    } else if (Array.isArray(response) && response.length > 0) {
      responseType = 'Array Response';
      visualIdFromResponse = response[0].VisualID || 'Not found';
      pkId = response[0].PK_ID || 'Not found';
      extractedId = response[0].VisualID || response[0].PK_ID || response[0].id || 'Not found in array';
    } else if (response && typeof response === 'object') {
      if (response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
        responseType = 'Object with Result array';
        visualIdFromResponse = response.Result[0].VisualID || 'Not found';
        pkId = response.Result[0].PK_ID || 'Not found';
        extractedId = response.Result[0].VisualID || response.Result[0].PK_ID || response.Result[0].id || 'Not found in Result';
      } else {
        responseType = 'Direct Object';
        visualIdFromResponse = response.VisualID || 'Not found';
        pkId = response.PK_ID || 'Not found';
        extractedId = response.VisualID || response.PK_ID || response.id || 'Not found in object';
      }
    } else {
      responseType = 'Direct ID';
      extractedId = response;
    }
    
    // Get all existing visuals for comparison
    let existingVisuals: Array<{id: any, name: string, category: string}> = [];
    try {
      const visuals = await this.foundationData.getVisualsByService(this.serviceId);
      if (visuals && Array.isArray(visuals)) {
        existingVisuals = visuals.map(v => ({
          id: v.VisualID || v.PK_ID || v.id,
          name: v.Name,
          category: v.Category
        }));
      }
    } catch (e) {
      console.error('Failed to get existing visuals:', e);
    }
    
    const existingVisualsHtml = existingVisuals
      .map(v => `ID: ${v.id} - ${v.category}/${v.name}`)
      .join('<br>') || 'None found';
    
    const alert = await this.alertController.create({
      header: 'Visual Creation Debug',
      message: `
        <div style="font-family: monospace; font-size: 12px;">
          <strong style="color: red;">ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â VISUAL CREATION RESPONSE:</strong><br><br>
          
          <strong>Key:</strong> ${key}<br>
          <strong>Category:</strong> ${category}<br>
          <strong>Template ID:</strong> ${templateId}<br><br>
          
          <strong>Response Type:</strong> ${responseType}<br>
          <strong>Raw Response:</strong><br>
          <div style="background: #f0f0f0; padding: 5px; max-height: 150px; overflow-y: auto;">
            ${JSON.stringify(response, null, 2)}
          </div><br>
          
          <strong style="color: red;">ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â ID FIELDS FROM RESPONSE:</strong><br>
          ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ <strong>VisualID:</strong> ${visualIdFromResponse} <span style="color: green;">(ÃƒÂ¢Ã…â€œÃ¢â‚¬Å“ CORRECT - USE THIS)</span><br>
          ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢ <strong>PK_ID:</strong> ${pkId} <span style="color: red;">(ÃƒÂ¢Ã…â€œÃ¢â‚¬â€ WRONG - DO NOT USE)</span><br><br>
          
          <strong style="color: blue;">Using ID:</strong> ${extractedId}<br>
          <strong>Will Store As:</strong> ${this.visualRecordIds[key] || 'Not yet stored'}<br><br>
          
          <strong>Existing Visuals in Database:</strong><br>
          <div style="background: #f0f0f0; padding: 5px; max-height: 100px; overflow-y: auto;">
            ${existingVisualsHtml}
          </div><br>
          
          <strong>Current visualRecordIds:</strong><br>
          <div style="background: #f0f0f0; padding: 5px; max-height: 100px; overflow-y: auto;">
            ${Object.entries(this.visualRecordIds).map(([k, v]) => `${k}: ${v}`).join('<br>') || 'None'}
          </div>
        </div>
      `,
      buttons: ['OK']
    });
    
    await alert.present();
  }
  
  // Refresh visual ID after save
  async refreshVisualId(category: string, templateId: string) {
    try {
      const visuals = await this.foundationData.getVisualsByService(this.serviceId);
      
      if (visuals && Array.isArray(visuals)) {
        // Find the visual we just created
        const templateName = this.categoryData[category]?.[templateId]?.name;
        
        const ourVisual = visuals.find(v => 
          v.Category === category && 
          v.Name === templateName
        );
        
        if (ourVisual) {
          const visualId = ourVisual.VisualID || ourVisual.PK_ID || ourVisual.id;
          const recordKey = `visual_${category}_${templateId}`;
          localStorage.setItem(recordKey, String(visualId));
          this.visualRecordIds[`${category}_${templateId}`] = String(visualId);
          await this.processPendingPhotoUploadsForKey(`${category}_${templateId}`);
        } else {
        }
      }
    } catch (error) {
      console.error('Failed to refresh visual ID:', error);
    }
  }
  
  // Load existing photos for visuals - FIXED TO PREVENT DUPLICATION
  async loadExistingPhotos() {
    const startTime = performance.now();

    // [PHOTO FIX] Load photos using unique VisualID-based keys
    // Each visual record now has its own unique key, preventing photo cross-contamination
    const loadPromises = Object.keys(this.visualRecordIds).map(key => {
      const rawVisualId = this.visualRecordIds[key];
      const visualId = String(rawVisualId);

      if (visualId && visualId !== 'undefined' && !visualId.startsWith('temp_')) {
        return this.loadPhotosForVisualByKey(key, visualId, rawVisualId);
      }
      return Promise.resolve();
    });

    // Wait for all photos to load in parallel
    await Promise.all(loadPromises);

    const elapsed = performance.now() - startTime;
    console.log(`[PHOTO FIX] Loaded photos for ${Object.keys(this.visualRecordIds).length} items in ${elapsed.toFixed(0)}ms`);
    this.changeDetectorRef.detectChanges(); // Single change detection after all photos loaded
  }
  
  // [v1.4.386] Load photos for a visual and store by KEY for uniqueness
  private async loadPhotosForVisualByKey(key: string, visualId: string, rawVisualId: any): Promise<void> {
    try {
      const attachments = await this.foundationData.getVisualAttachments(rawVisualId);

      if (!Array.isArray(attachments) || attachments.length === 0) {
        this.visualPhotos[key] = [];
        return;
      }
      // [v1.4.488] Change detection moved to end of loadExistingPhotos for better performance
      const photoRecords = attachments.map(att => this.buildPhotoRecord(att));

      // [v1.4.569] Deduplicate photos by AttachID to prevent duplicates
      const seenAttachIds = new Set<string>();
      const uniquePhotoRecords = photoRecords.filter(record => {
        const attachId = String(record.AttachID || record.PK_ID || record.id);
        if (seenAttachIds.has(attachId)) {
          console.warn(`[v1.4.569] Duplicate photo detected and removed: AttachID ${attachId} for KEY ${key}`);
          return false;
        }
        seenAttachIds.add(attachId);
        return true;
      });
      console.log(`[STRUCTURAL DEBUG] Loaded ${uniquePhotoRecords.length} photo records for KEY: ${key}`);

      // CRITICAL FIX: Hydrate photos BEFORE assigning to visualPhotos
      // This ensures OnPush change detection sees photos with actual URLs, not placeholders
      await this.hydratePhotoRecords(uniquePhotoRecords);
      
      console.log(`[STRUCTURAL DEBUG] Hydrated photos for KEY: ${key}`, uniquePhotoRecords.map(p => ({ 
        AttachID: p.AttachID, 
        hasUrl: !!p.url, 
        hasThumbnail: !!p.thumbnailUrl, 
        hasDisplay: !!p.displayUrl 
      })));
      
      // NOW assign to visualPhotos AFTER hydration completes
      this.visualPhotos[key] = uniquePhotoRecords;
      
      // Trigger change detection with OnPush strategy
      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error(`[v1.4.387] Failed to load photos for KEY ${key}:`, error);
      this.visualPhotos[key] = [];
    }
  }

  private buildPhotoRecord(attachment: any): any {
    let annotationData = null;
    const rawDrawingsString = attachment.Drawings;

    if (attachment.Drawings) {
      try {
        annotationData = decompressAnnotationData(attachment.Drawings);
      } catch {
        // Ignore parse errors and proceed without annotations
      }
    }

    const filePath = typeof attachment.Photo === 'string' ? attachment.Photo : '';
    const attachId = attachment.AttachID || attachment.PK_ID || attachment.id;

    return {
      ...attachment,
      name: `Photo_${attachId}`,  // CRITICAL FIX: Use AttachID for unique naming, not filename
      Photo: filePath,
      caption: attachment.Annotation || '',
      annotations: annotationData,
      annotationsData: annotationData,
      hasAnnotations: !!annotationData,
      rawDrawingsString,
      AttachID: attachId,
      id: attachId,
      PK_ID: attachment.PK_ID || attachment.AttachID || attachment.id,
      VisualID: attachment.VisualID,  // Keep VisualID for debugging
      url: undefined,
      thumbnailUrl: this.photoPlaceholder,
      displayUrl: undefined,
      originalUrl: undefined,
      filePath,
      hasPhoto: !!filePath
    };
  }

  private async hydratePhotoRecords(records: any[]): Promise<void> {
    if (!records.length) {
      return;
    }

    const concurrency = Math.min(this.photoLoadConcurrency, records.length);
    if (concurrency <= 0) {
      return;
    }

    let currentIndex = 0;

    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = currentIndex++;
        if (index >= records.length) {
          break;
        }

        const record = records[index];

        if (!record.hasPhoto || !record.filePath) {
          record.thumbnailUrl = this.photoPlaceholder;
          continue;
        }

        // CRITICAL FIX: Fetch photo using AttachID as unique identifier
        // Multiple photos can have the same filename, so we must use AttachID
        const attachId = record.AttachID || record.id || record.PK_ID;
        const imageData = await this.fetchPhotoBase64(record.filePath, attachId);

        if (imageData) {
          record.url = imageData;
          record.originalUrl = imageData;
          record.thumbnailUrl = imageData;
          record.displayUrl = imageData;  // Always set displayUrl, regardless of annotations
        } else {
          record.thumbnailUrl = this.photoPlaceholder;
          record.displayUrl = this.photoPlaceholder;
        }
      }
    });

    await Promise.all(workers);
    this.changeDetectorRef.detectChanges();
  }

  private fetchPhotoBase64(photoPath: string, attachId?: string | number): Promise<string | null> {
    if (!photoPath || typeof photoPath !== 'string') {
      return Promise.resolve(null);
    }

    // CRITICAL FIX: Use AttachID as cache key instead of photoPath
    // Multiple photos can have the same filename but different AttachIDs
    const cacheKey = attachId ? `attachId_${attachId}` : photoPath;

    if (!this.thumbnailCache.has(cacheKey)) {
      const loader = this.caspioService.getImageFromFilesAPI(photoPath).toPromise()
        .then(imageData => {
          if (imageData && typeof imageData === 'string' && imageData.startsWith('data:')) {
            return imageData;
          }
          return null;
        })
        .catch(error => {
          console.error(`Failed to load image for AttachID ${attachId}:`, error);
          return null;
        })
        .then(result => {
          if (result === null) {
            this.thumbnailCache.delete(cacheKey);
          }
          return result;
        });

      this.thumbnailCache.set(cacheKey, loader);
    }

    return this.thumbnailCache.get(cacheKey)!;
  }

  private async presentTemplateLoader(message: string = 'Loading Report'): Promise<void> {
    console.log('[presentTemplateLoader] Called with message:', message);
    console.log('[presentTemplateLoader] templateLoaderPresented:', this.templateLoaderPresented);
    
    if (this.templateLoaderPresented) {
      console.log('[presentTemplateLoader] Loader already presented, returning early');
      return;
    }

    this.templateLoadStart = Date.now();
    console.log('[presentTemplateLoader] Creating alert controller...');

    try {
      // Create loading popup with cancel button
      this.templateLoader = await this.alertController.create({
        header: message,
        buttons: [
          {
            text: 'Cancel',
            handler: async () => {
              await this.handleLoadingCancel();
            }
          }
        ],
        backdropDismiss: false,
        cssClass: 'template-loading-alert'
      });

      if (this.templateLoader) {
        console.log('[presentTemplateLoader] Presenting loader...');
        await this.templateLoader.present();
        this.templateLoaderPresented = true;
        console.log('[presentTemplateLoader] Loader presented successfully');
      }

    } catch (error) {
      console.error('[TemplateLoader] Failed to present loading overlay:', error);
      this.templateLoaderPresented = false;
    }
  }

  private async handleLoadingCancel(): Promise<void> {

    if (this.templateLoader) {
      await this.templateLoader.dismiss();
      this.templateLoaderPresented = false;
    }

    if (this.platform.isWeb()) {
      this.navigateBackToProject();
      return;
    }

    await this.navController.back();
  }

  private async dismissTemplateLoader(): Promise<void> {
    console.log('[dismissTemplateLoader] Called');
    console.log('[dismissTemplateLoader] templateLoaderPresented:', this.templateLoaderPresented);
    
    if (!this.templateLoaderPresented) {
      console.log('[dismissTemplateLoader] No loader to dismiss, returning early');
      return;
    }

    const elapsed = Date.now() - this.templateLoadStart;
    const remaining = this.templateLoaderMinDuration - elapsed;
    console.log('[dismissTemplateLoader] Elapsed:', elapsed, 'ms, Remaining:', remaining, 'ms');

    if (remaining > 0) {
      console.log('[dismissTemplateLoader] Waiting for minimum duration...');
      await new Promise(resolve => setTimeout(resolve, remaining));
    }

    try {
      console.log('[dismissTemplateLoader] Dismissing loader...');
      await this.templateLoader?.dismiss();
      console.log('[dismissTemplateLoader] Loader dismissed successfully');
    } catch (error) {
      console.warn('[TemplateLoader] Failed to dismiss loading overlay:', error);
    } finally {
      this.templateLoaderPresented = false;
      this.templateLoader = undefined;
      console.log('[dismissTemplateLoader] Cleanup complete');
    }
  }

  // Keep the old method for backward compatibility
  private async loadPhotosForVisual(visualId: string, rawVisualId: any): Promise<void> {
    await this.loadPhotosForVisualByKey(String(visualId), String(visualId), rawVisualId);
  }

  // Handle Year Built changes - restrict to 4 digits
  onYearBuiltChange(value: string) {
    // Remove non-numeric characters
    const numericValue = value.replace(/\D/g, '');

    // Limit to 4 digits
    const limitedValue = numericValue.slice(0, 4);

    // Update the model
    this.projectData.YearBuilt = limitedValue;

    // Save and trigger auto-save
    this.onProjectFieldChange('YearBuilt', limitedValue);
  }

  // Format Year Built on blur
  formatYearBuilt() {
    if (this.projectData.YearBuilt) {
      // Ensure it's exactly 4 digits or empty
      const year = this.projectData.YearBuilt.replace(/\D/g, '').slice(0, 4);
      this.projectData.YearBuilt = year;
    }
  }

  // Handle Square Feet changes - restrict to numbers only
  onSquareFeetChange(value: string) {
    // Remove non-numeric characters and commas
    const numericValue = value.replace(/[^\d]/g, '');

    // Update the model without commas (for internal storage)
    this.projectData.SquareFeet = numericValue;

    // Save and trigger auto-save
    this.onProjectFieldChange('SquareFeet', numericValue);
  }

  // Format Square Feet with commas on blur
  formatSquareFeet() {
    if (this.projectData.SquareFeet) {
      // Remove any existing commas
      const numericValue = this.projectData.SquareFeet.replace(/[^\d]/g, '');

      // Add commas
      const formattedValue = numericValue.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

      // Update the display value
      this.projectData.SquareFeet = formattedValue;
    }
  }

  // Handle project field changes
  async onProjectFieldChange(fieldName: string, value: any) {

    // If "Other" is selected, show popup to enter custom value
    if (value === 'Other') {
      const fieldLabels: { [key: string]: string } = {
        'TypeOfBuilding': 'Building Type',
        'Style': 'Style'
      };
      const previousValue = this.customOtherValues[fieldName] || '';
      await this.showOtherInputPopup(fieldName, fieldLabels[fieldName] || fieldName, previousValue);
      return; // The popup handler will call this method again with the custom value
    }

    // Update the project data
    if (this.projectData) {
      this.projectData[fieldName] = value;
    }

    // Save to localStorage for persistence across all services
    const projectDataKey = `projectData_${this.projectId}`;
    localStorage.setItem(projectDataKey, JSON.stringify(this.projectData));

    // Update progress tracking
    this.updateProgressTracking();

    // Trigger auto-save to Projects table
    this.autoSaveProjectField(fieldName, value);
  }
  
  // Handle service field changes
  async onServiceFieldChange(fieldName: string, value: any) {
    console.log('[onServiceFieldChange] Field:', fieldName, 'Value:', value);

    // Mark that changes have been made (enables Update button) - do this FIRST
    this.markReportChanged();

    // CRITICAL FIX: Skip "Other" popup for multi-select fields (they have inline inputs)
    const multiSelectFields = ['InAttendance', 'SecondFoundationRooms', 'ThirdFoundationRooms'];
    const isMultiSelect = multiSelectFields.includes(fieldName);

    // If "Other" is selected AND not a multi-select field, show popup to enter custom value
    if (value === 'Other' && !isMultiSelect) {
      const fieldLabels: { [key: string]: string } = {
        'WeatherConditions': 'Weather Conditions',
        'OutdoorTemperature': 'Outdoor Temperature',
        'OccupancyFurnishings': 'Occupancy Status',
        'FirstFoundationType': 'First Foundation Type',
        'SecondFoundationType': 'Second Foundation Type',
        'ThirdFoundationType': 'Third Foundation Type',
        'OwnerOccupantInterview': 'Owner/Occupant Interview'
      };
      const previousValue = this.customOtherValues[fieldName] || '';
      await this.showOtherInputPopup(fieldName, fieldLabels[fieldName] || fieldName, previousValue);
      return; // The popup handler will call this method again with the custom value
    }

    // Update the service data
    this.serviceData[fieldName] = value;

    // Save to localStorage for persistence
    const serviceDataKey = `serviceData_${this.serviceId}`;
    localStorage.setItem(serviceDataKey, JSON.stringify(this.serviceData));

    // Update progress tracking
    this.updateProgressTracking();

    // Trigger auto-save to Services table
    this.autoSaveServiceField(fieldName, value);
  }
  
  // Auto-save project field to Caspio Projects table
  private updateProgressTracking() {
    // Calculate and save progress for each section
    const projectProgress = this.getProjectCompletion();
    const structuralProgress = this.getSectionCompletion('structural');
    const elevationProgress = this.getSectionCompletion('elevation');
    
    // Save to localStorage for the project detail page to read
    const storageKey = `template_progress_${this.projectId}_${this.serviceId}`;
    const progressData = {
      project: projectProgress,
      structural: structuralProgress,
      elevation: elevationProgress,
      timestamp: Date.now()
    };
    
    localStorage.setItem(storageKey, JSON.stringify(progressData));
  }
  
  private autoSaveProjectField(fieldName: string, value: any) {
    if (!this.projectId || this.projectId === 'new') return;

    const isCurrentlyOnline = this.offlineService.isOnline();
    const manualOfflineMode = this.offlineService.isManualOffline();

    if (isCurrentlyOnline) {
      this.showSaveStatus(`Saving ${fieldName}...`, 'info');
    } else {
      const queuedMessage = manualOfflineMode
        ? `${fieldName} queued (manual offline mode)`
        : `${fieldName} queued until connection returns`;
      this.showSaveStatus(queuedMessage, 'info');
    }

    // Update the Projects table directly
    this.caspioService.updateProject(this.projectId, { [fieldName]: value }).subscribe({
      next: () => {
        if (this.offlineService.isOnline()) {
          this.showSaveStatus(`${fieldName} saved`, 'success');
        } else {
          this.updateOfflineBanner();
        }
      },
      error: (error) => {
        console.error(`Error saving project field ${fieldName}:`, error);
        this.showSaveStatus(`Failed to save ${fieldName}`, 'error');
      }
    });
  }
  
  // Auto-save service field to Caspio Services table  
  private autoSaveServiceField(fieldName: string, value: any) {
    if (!this.serviceId) {
      console.error(`ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â Cannot save ${fieldName} - No ServiceID! ServiceID is: ${this.serviceId}`);
      return;
    }

    const isCurrentlyOnline = this.offlineService.isOnline();
    const manualOfflineMode = this.offlineService.isManualOffline();

    if (isCurrentlyOnline) {
      this.showSaveStatus(`Saving ${fieldName}...`, 'info');
    } else {
      const queuedMessage = manualOfflineMode
        ? `${fieldName} queued (manual offline mode)`
        : `${fieldName} queued until connection returns`;
      this.showSaveStatus(queuedMessage, 'info');
    }

    // Update the Services table directly
    this.caspioService.updateService(this.serviceId, { [fieldName]: value }).subscribe({
      next: (response) => {
        if (this.offlineService.isOnline()) {
          this.showSaveStatus(`${fieldName} saved`, 'success');
        } else {
          this.updateOfflineBanner();
        }
      },
      error: (error) => {
        console.error(`Error saving service field ${fieldName}:`, error);
        this.showSaveStatus(`Failed to save ${fieldName}`, 'error');
      }
    });
  }


  // Helper methods for PDF preview
  async prepareProjectInfo() {
    // Get the primary photo - handle if it's already loaded as base64 or is a file path
    let primaryPhoto = this.projectData?.PrimaryPhoto || null;
    
    // If primaryPhoto is a Caspio file path, pass it as-is (PDF component will load it)
    // If it's already base64 or a URL, pass it as-is
    
    // Combine all the actual form data from projectData and serviceData
    return {
      // Project identifiers
      projectId: this.projectId,
      serviceId: this.serviceId,
      primaryPhoto: primaryPhoto,
      primaryPhotoBase64: null as string | null, // Will be populated if preloaded
      
      // Property address
      address: this.projectData?.Address || '',
      city: this.projectData?.City || '',
      state: this.projectData?.State || '',
      zip: this.projectData?.Zip || '',
      fullAddress: `${this.projectData?.Address || ''}, ${this.projectData?.City || ''}, ${this.projectData?.State || ''} ${this.projectData?.Zip || ''}`,
      
      // People & Roles (from actual form inputs)
      clientName: this.projectData?.ClientName || this.projectData?.Owner || '',
      agentName: this.projectData?.AgentName || '',
      inspectorName: this.projectData?.InspectorName || '',
      inAttendance: this.serviceData?.InAttendance || '',
      
      // Property Details (from actual form inputs)
      yearBuilt: this.projectData?.YearBuilt || '',
      squareFeet: this.projectData?.SquareFeet || '',
      typeOfBuilding: this.projectData?.TypeOfBuilding || '',
      style: this.projectData?.Style || '',
      occupancyFurnishings: this.serviceData?.OccupancyFurnishings || '',
      
      // Environmental Conditions (from actual form inputs)
      weatherConditions: this.serviceData?.WeatherConditions || '',
      outdoorTemperature: this.serviceData?.OutdoorTemperature || '',
      
      // Foundation Details (from actual form inputs)
      firstFoundationType: this.serviceData?.FirstFoundationType || '',
      secondFoundationType: this.serviceData?.SecondFoundationType || '',
      secondFoundationRooms: this.serviceData?.SecondFoundationRooms || '',
      thirdFoundationType: this.serviceData?.ThirdFoundationType || '',
      thirdFoundationRooms: this.serviceData?.ThirdFoundationRooms || '',
      
      // Additional Information
      ownerOccupantInterview: this.serviceData?.OwnerOccupantInterview || '',
      
      // Inspection Details
      inspectionDate: this.formatDate(this.serviceData?.DateOfInspection || new Date().toISOString()),
      
      // Company information (keep these as defaults for now)
      inspectorPhone: '936-202-8013',
      inspectorEmail: 'info@noblepropertyinspections.com',
      companyName: 'Noble Property Inspections',
      
      // All raw data for debugging
      projectData: this.projectData,
      serviceData: this.serviceData
    };
  }

  async prepareStructuralSystemsData() {
    
    const result = [];
    
    for (const category of this.visualCategories) {
      const categoryData = this.organizedData[category];
      if (!categoryData) continue;
      
      const categoryResult: any = {
        name: category,
        comments: [],
        limitations: [],
        deficiencies: []
      };
      
      // Collect all photo fetch promises for parallel execution
      const photoFetches: Promise<any>[] = [];
      const photoMappings: { type: string, item: any, index: number }[] = [];
      
      // Process comments - collect promises
      if (categoryData.comments) {
        categoryData.comments.forEach((comment: any, index: number) => {
          // Use comment.id which is the template PK_ID
          const visualId = comment.id || comment.VisualID;
          const isSelected = this.isCommentSelected(category, visualId);
          if (isSelected) {
            // Get the actual visual record ID for photo fetching
            const recordKey = `${category}_${visualId}`;
            const actualVisualId = this.visualRecordIds[recordKey] || visualId;
            
            // Prepare the text to display based on answerType
            let displayText = comment.Text || comment.text;
            let answers = '';
            
            // For AnswerType 1 (Yes/No), include the answer
            if (comment.answerType === 1 && comment.answer) {
              answers = comment.answer;
              // Keep original text and add answer separately
              displayText = comment.originalText || comment.text || '';
            }
            // For AnswerType 2 (multi-select), include selected options
            else if (comment.answerType === 2 && comment.selectedOptions && comment.selectedOptions.length > 0) {
              answers = comment.selectedOptions.join(', ');
              // Keep original text and add answers separately
              displayText = comment.originalText || comment.text || '';
            }
            // For AnswerType 0 or undefined (text), use the text as is
            else {
              displayText = comment.text || '';
            }
            
            photoFetches.push(this.getVisualPhotos(actualVisualId, category, visualId));
            photoMappings.push({
              type: 'comments',
              item: {
                name: comment.Name || comment.name,
                text: displayText,
                answers: answers, // Add answers field for PDF display
                answerType: comment.answerType,
                visualId: actualVisualId
              },
              index: photoFetches.length - 1
            });
          }
        });
      }
      
      // Process limitations - collect promises
      if (categoryData.limitations) {
        categoryData.limitations.forEach((limitation: any, index: number) => {
          // Use limitation.id which is the template PK_ID
          const visualId = limitation.id || limitation.VisualID;
          if (this.isLimitationSelected(category, visualId)) {
            // Get the actual visual record ID for photo fetching
            const recordKey = `${category}_${visualId}`;
            const actualVisualId = this.visualRecordIds[recordKey] || visualId;
            
            // Prepare the text to display based on answerType
            let displayText = limitation.Text || limitation.text;
            let answers = '';
            
            // For AnswerType 1 (Yes/No), include the answer
            if (limitation.answerType === 1 && limitation.answer) {
              answers = limitation.answer;
              // Keep original text and add answer separately
              displayText = limitation.originalText || limitation.text || '';
            }
            // For AnswerType 2 (multi-select), include selected options
            else if (limitation.answerType === 2 && limitation.selectedOptions && limitation.selectedOptions.length > 0) {
              answers = limitation.selectedOptions.join(', ');
              // Keep original text and add answers separately
              displayText = limitation.originalText || limitation.text || '';
            }
            // For AnswerType 0 or undefined (text), use the text as is
            else {
              displayText = limitation.text || '';
            }
            
            photoFetches.push(this.getVisualPhotos(actualVisualId, category, visualId));
            photoMappings.push({
              type: 'limitations',
              item: {
                name: limitation.Name || limitation.name,
                text: displayText,
                answers: answers, // Add answers field for PDF display
                answerType: limitation.answerType,
                visualId: actualVisualId
              },
              index: photoFetches.length - 1
            });
          }
        });
      }
      
      // Process deficiencies - collect promises
      if (categoryData.deficiencies) {
        categoryData.deficiencies.forEach((deficiency: any, index: number) => {
          // Use deficiency.id which is the template PK_ID
          const visualId = deficiency.id || deficiency.VisualID;
          if (this.isDeficiencySelected(category, visualId)) {
            // Get the actual visual record ID for photo fetching
            const recordKey = `${category}_${visualId}`;
            const actualVisualId = this.visualRecordIds[recordKey] || visualId;
            
            // Prepare the text to display based on answerType
            let displayText = deficiency.Text || deficiency.text;
            let answers = '';
            
            // For AnswerType 1 (Yes/No), include the answer
            if (deficiency.answerType === 1 && deficiency.answer) {
              answers = deficiency.answer;
              // Keep original text and add answer separately
              displayText = deficiency.originalText || deficiency.text || '';
            }
            // For AnswerType 2 (multi-select), include selected options
            else if (deficiency.answerType === 2 && deficiency.selectedOptions && deficiency.selectedOptions.length > 0) {
              answers = deficiency.selectedOptions.join(', ');
              // Keep original text and add answers separately
              displayText = deficiency.originalText || deficiency.text || '';
            }
            // For AnswerType 0 or undefined (text), use the text as is
            else {
              displayText = deficiency.text || '';
            }
            
            photoFetches.push(this.getVisualPhotos(actualVisualId, category, visualId));
            photoMappings.push({
              type: 'deficiencies',
              item: {
                name: deficiency.Name || deficiency.name,
                text: displayText,
                answers: answers, // Add answers field for PDF display
                answerType: deficiency.answerType,
                visualId: actualVisualId
              },
              index: photoFetches.length - 1
            });
          }
        });
      }
      
      // Fetch all photos in parallel
      const allPhotos = await Promise.all(photoFetches);
      
      // Map photos back to their items
      photoMappings.forEach(mapping => {
        const photos = allPhotos[mapping.index];
        const itemWithPhotos = { ...mapping.item, photos };
        categoryResult[mapping.type].push(itemWithPhotos);
      });
      
      // Only add category if it has selected items
      if (categoryResult.comments.length > 0 || 
          categoryResult.limitations.length > 0 || 
          categoryResult.deficiencies.length > 0) {
        result.push(categoryResult);
      }
    }
    
    // Show debug info about what's being included in PDF
    const totalItems = result.reduce((sum, cat) => 
      sum + cat.comments.length + cat.limitations.length + cat.deficiencies.length, 0);
    
    // Don't show toast messages - just log for debugging
    if (totalItems === 0) {
    } else {
    }
    
    return result;
  }

  async prepareElevationPlotData() {
    const result = [];
    
    // Collect all rooms to process
    const roomsToProcess = Object.keys(this.selectedRooms).filter(roomName => 
      this.selectedRooms[roomName] && this.roomElevationData[roomName]
    );
    
    // Process all rooms in parallel
    const roomPromises = roomsToProcess.map(async (roomName) => {
      const roomData = this.roomElevationData[roomName];
      const roomId = roomData.roomId || this.efeRecordIds[roomName];
      
      const roomResult: any = {
        name: roomName,
        fdf: roomData.fdf,
        fdfPhotos: roomData.fdfPhotos || {}, // Include FDF photos from room data
        notes: roomData.notes,
        points: [],
        photos: []
      };
      
      // Fetch FDF photos from Services_EFE table and convert to base64
      if (roomId) {
        try {
          // Get the room record to fetch FDF photo paths
          const query = `EFEID=${roomId}`;
          const roomResponse = await this.caspioService.get(`/tables/Services_EFE/records?q.where=${encodeURIComponent(query)}`).toPromise();
          const roomRecords = (roomResponse as any)?.Result || [];

          if (roomRecords && roomRecords.length > 0) {
            const roomRecord = roomRecords[0];
            const fdfPhotosData: any = {};

            // Process each FDF photo type with new annotation fields
            const fdfPhotoTypes = [
              { field: 'FDFPhotoTop', key: 'top', annotationField: 'FDFTopAnnotation', drawingsField: 'FDFTopDrawings' },
              { field: 'FDFPhotoBottom', key: 'bottom', annotationField: 'FDFBottomAnnotation', drawingsField: 'FDFBottomDrawings' },
              { field: 'FDFPhotoThreshold', key: 'threshold', annotationField: 'FDFThresholdAnnotation', drawingsField: 'FDFThresholdDrawings' }
            ];
            
            for (const photoType of fdfPhotoTypes) {
              const photoPath = roomRecord[photoType.field];

              if (photoPath) {
                // Convert Caspio file path to base64
                if (photoPath.startsWith('/')) {
                  try {
                    
                    const base64Data = await this.caspioService.getImageFromFilesAPI(photoPath).toPromise();
                    if (base64Data && base64Data.startsWith('data:')) {
                      fdfPhotosData[photoType.key] = true;
                      fdfPhotosData[`${photoType.key}Url`] = base64Data;
                      // Load caption and drawings from new fields (following measurement photo pattern)
                      fdfPhotosData[`${photoType.key}Caption`] = roomRecord[photoType.annotationField] || '';
                      fdfPhotosData[`${photoType.key}Drawings`] = roomRecord[photoType.drawingsField] || null;
                    } else {
                      console.error(`[FDF Photos v1.4.327] Invalid base64 data for ${photoType.key}`);
                    }
                  } catch (error) {
                    console.error(`[FDF Photos v1.4.327] Failed to convert FDF ${photoType.key} photo:`, error);
                    
                    // Try to use token-based URL as fallback
                    const token = await firstValueFrom(this.caspioService.getValidToken());
                    const account = this.caspioService.getAccountID();
                    fdfPhotosData[photoType.key] = true;
                    fdfPhotosData[`${photoType.key}Url`] = `https://${account}.caspio.com/rest/v2/files${photoPath}?access_token=${token}`;
                    // Load caption and drawings even in fallback case
                    fdfPhotosData[`${photoType.key}Caption`] = roomRecord[photoType.annotationField] || '';
                    fdfPhotosData[`${photoType.key}Drawings`] = roomRecord[photoType.drawingsField] || null;
                  }
                } else {
                }
              } else {
              }
            }
            
            // Merge with existing fdfPhotos (in case they were already loaded)
            roomResult.fdfPhotos = { ...roomResult.fdfPhotos, ...fdfPhotosData };
          } else {
          }
          
        } catch (error) {
          console.error(`[FDF Photos v1.4.327] Error fetching FDF photos for room ${roomName}:`, error);
        }
        
        try {
          // Get all points for this room from the database
          const dbPoints = await this.foundationData.getEFEPoints(roomId);
          
          // Collect all attachment fetches and image conversions
          const pointPromises = [];
          const pointDataMap = new Map();
          
          // First, fetch all attachments in parallel
          for (const dbPoint of (dbPoints || [])) {
            const pointId = dbPoint.PointID || dbPoint.PK_ID;
            const pointName = dbPoint.PointName;
            
            // Find the matching point in local data to get the value
            const localPoint = roomData.elevationPoints?.find((p: any) => p.name === pointName);
            const pointValue = localPoint?.value || '';
            
            const pointData: any = {
              name: pointName,
              value: pointValue,
              pointId: pointId,
              photos: []
            };
            
            pointDataMap.set(pointId, pointData);
            
            // Fetch attachments for this specific point
            if (pointId) {
              pointPromises.push(
                this.foundationData.getEFEAttachments(pointId)
                  .then(attachments => ({ pointId, attachments }))
                  .catch(error => {
                    console.error(`Failed to fetch attachments for point ${pointName}:`, error);
                    return { pointId, attachments: [] };
                  })
              );
            }
          }
          
          // Wait for all attachment fetches
          const allAttachmentResults = await Promise.all(pointPromises);
          
          // Now collect all image conversion promises
          const imagePromises = [];
          const imageMapping = [];
          
          for (const { pointId, attachments } of allAttachmentResults) {
            const pointData = pointDataMap.get(pointId);
            if (!pointData) continue;
            
            for (const attachment of (attachments || [])) {
              let photoUrl = attachment.Photo || '';
              
              // Convert Caspio file paths to base64
              if (photoUrl && photoUrl.startsWith('/')) {
                const mappingIndex = imagePromises.length;
                imageMapping.push({
                  pointData,
                  attachment,
                  mappingIndex
                });
                
                imagePromises.push(
                  this.caspioService.getImageFromFilesAPI(photoUrl).toPromise()
                    .then(base64Data => {
                      if (base64Data && base64Data.startsWith('data:')) {
                        return base64Data;
                      }
                      return photoUrl; // Fallback to original
                    })
                    .catch(error => {
                      console.error(`Failed to convert photo:`, error);
                      return photoUrl; // Fallback to original
                    })
                );
              } else {
                // Non-Caspio URLs can be added directly
                pointData.photos.push({
                  url: photoUrl,
                  annotation: attachment.Annotation || '',
                  attachId: attachment.AttachID || attachment.PK_ID
                });
              }
            }
          }
          
          // Convert all images in parallel
          if (imagePromises.length > 0) {
            const convertedImages = await Promise.all(imagePromises);
            
            // Map converted images back to their points
            for (const mapping of imageMapping) {
              const convertedUrl = convertedImages[mapping.mappingIndex];
              mapping.pointData.photos.push({
                url: convertedUrl,
                annotation: mapping.attachment.Annotation || '',
                attachId: mapping.attachment.AttachID || mapping.attachment.PK_ID
              });
            }
          }
          
          // Add all points to room result
          for (const pointData of pointDataMap.values()) {
            if (pointData.value || pointData.photos.length > 0) {
              roomResult.points.push(pointData);
            }
          }
          
          // Also include local points that might not be in database yet
          if (roomData.elevationPoints) {
            for (const localPoint of roomData.elevationPoints) {
              // Check if we already processed this point from database
              const existingPoint = roomResult.points.find((p: any) => p.name === localPoint.name);
              
              if (!existingPoint && localPoint.value) {
                // This is a local point not yet saved to database
                roomResult.points.push({
                  name: localPoint.name,
                  value: localPoint.value,
                  photos: localPoint.photos || []
                });
              }
            }
          }
        } catch (error) {
          console.error(`Error fetching elevation data for room ${roomName}:`, error);
        }
      }
      
      return roomResult;
    });
    
    // Wait for all rooms to be processed in parallel
    const allRoomResults = await Promise.all(roomPromises);
    
    // Add all non-empty room results
    for (const roomResult of allRoomResults) {
      if (roomResult && (roomResult.points.length > 0 || roomResult.fdf || roomResult.notes)) {
        result.push(roomResult);
      }
    }
    result.forEach(room => {
      if (room.fdfPhotos && Object.keys(room.fdfPhotos).length > 0) {
      } else {
      }
    });
    
    return result;
  }

  async getVisualPhotos(visualId: string, category?: string, itemId?: string) {
    // v1.4.390 - Fix: Use key-based photo retrieval to match storage method
    // Try to get photos using the full key first (as per v1.4.386 fix)
    let photos = [];

    if (category && itemId) {
      const fullKey = `${category}_${itemId}`;
      photos = this.visualPhotos[fullKey] || [];
    }

    // Fallback to visualId if no photos found with key
    if (photos.length === 0) {
      photos = this.visualPhotos[visualId] || [];
    }
    
    // Use the cache service for better performance across sessions
    const cacheKey = this.cache.getApiCacheKey('visual_photos', { visualId });
    const cachedPhotos = this.cache.get(cacheKey);
    if (cachedPhotos) {
      return cachedPhotos;
    }
    
    // Convert all photos to base64 for PDF compatibility - in parallel
    const photoPromises = photos.map(async (photo) => {
      // Prioritize displayUrl (annotated) over regular url
      let photoUrl = photo.displayUrl || photo.Photo || photo.url || '';
      let finalUrl = photoUrl;
      
      // If it's a Caspio file path (starts with /), convert to base64
      if (photoUrl && photoUrl.startsWith('/')) {
        // Check individual photo cache first
        const photoCacheKey = this.cache.getApiCacheKey('photo_base64', { path: photoUrl });
        const cachedBase64 = this.cache.get(photoCacheKey);
        
        if (cachedBase64) {
          finalUrl = cachedBase64;
        } else {
          try {
            const base64Data = await this.caspioService.getImageFromFilesAPI(photoUrl).toPromise();
            
            if (base64Data && base64Data.startsWith('data:')) {
              finalUrl = base64Data;
              // Cache individual photo for reuse
              this.cache.set(photoCacheKey, base64Data, this.cache.CACHE_TIMES.LONG);
            } else {
              console.error(`Failed to convert photo to base64: ${photoUrl}`);
              finalUrl = 'assets/img/photo-placeholder.svg';
            }
          } catch (error) {
            console.error(`Error converting photo for visual ${visualId}:`, error);
            finalUrl = 'assets/img/photo-placeholder.svg';
          }
        }
      } else if (photoUrl && (photoUrl.startsWith('blob:') || photoUrl.startsWith('data:'))) {
        finalUrl = photoUrl;
      }
      
      // Return the photo object with the appropriate URLs
      // If photo already has a displayUrl (annotated), it should be preserved as finalUrl
      return {
        url: photo.url || finalUrl, // Original URL
        displayUrl: finalUrl, // This will be the annotated version if it exists, otherwise the original
        caption: photo.Annotation || '',
        attachId: photo.AttachID || photo.id || '',
        hasAnnotations: photo.hasAnnotations || false
      };
    });
    
    // Wait for all photo processing to complete in parallel
    const processedPhotos = await Promise.all(photoPromises);
    
    // Cache the processed photos using the cache service
    this.cache.set(cacheKey, processedPhotos, this.cache.CACHE_TIMES.LONG);
    
    return processedPhotos;
  }

  async getRoomPhotos(roomId: string) {
    // Get photos for a specific room from Services_EFE_Points and Services_EFE_Points_Attach
    try {
      
      // First get all points for this room
      const points = await this.foundationData.getEFEPoints(roomId);
      
      if (!points || points.length === 0) {
        return [];
      }
      
      // Get all point IDs
      const pointIds = points.map((p: any) => p.PointID || p.PK_ID).filter(id => id);
      
      if (pointIds.length === 0) {
        return [];
      }
      
      // Fetch all attachments for these points
      const attachments = await this.foundationData.getEFEAttachments(pointIds);
      
      if (!attachments || attachments.length === 0) {
        return [];
      }
      
      // Format photos for display and convert to base64 for PDF
      const processedPhotos = [];
      
      for (const attach of attachments) {
        let photoUrl = attach.Photo || '';
        let finalUrl = photoUrl;
        
        // Convert Caspio file paths to base64
        if (photoUrl && photoUrl.startsWith('/')) {
          try {
            const base64Data = await this.caspioService.getImageFromFilesAPI(photoUrl).toPromise();
            
            if (base64Data && base64Data.startsWith('data:')) {
              finalUrl = base64Data;
            } else {
              console.error(`Failed to convert room photo to base64: ${photoUrl}`);
              finalUrl = 'assets/img/photo-placeholder.svg';
            }
          } catch (error) {
            console.error(`Error converting room photo:`, error);
            finalUrl = 'assets/img/photo-placeholder.svg';
          }
        } else if (photoUrl && (photoUrl.startsWith('blob:') || photoUrl.startsWith('data:'))) {
          // Keep blob and data URLs as-is
          finalUrl = photoUrl;
        }
        
        // Find the corresponding point for this attachment
        const point = points.find((p: any) => 
          (p.PointID === attach.PointID) || (p.PK_ID === attach.PointID)
        );
        
        // Load annotations from Drawings field
        let annotationData = null;
        if (attach.Drawings) {
          try {
            annotationData = decompressAnnotationData(attach.Drawings);
          } catch (e) {
          }
        }
        
        processedPhotos.push({
          url: finalUrl,
          caption: '',  // Don't use Annotation field
          annotations: annotationData,
          rawDrawingsString: attach.Drawings,
          hasAnnotations: !!annotationData,
          pointName: point?.PointName || '',
          pointValue: point?.PointValue || '',
          attachId: attach.AttachID || attach.PK_ID
        });
      }
      
      return processedPhotos;
      
    } catch (error) {
      console.error(`Error fetching room photos for ${roomId}:`, error);
      return [];
    }
  }

  async fetchAllVisualsFromDatabase() {
    try {
      
      // Fetch all Services_Visuals records for this service
      const visuals = await this.foundationData.getVisualsByService(this.serviceId);
      
      // Check if visuals is defined and is an array
      if (!visuals || !Array.isArray(visuals)) {
        return;
      }
      
      // Clear and rebuild the visualPhotos mapping
      this.visualPhotos = {};
      
      // Fetch all attachments in parallel for better performance
      const attachmentPromises = visuals
        .filter(visual => visual.VisualID)
        .map(visual => 
          this.foundationData.getVisualAttachments(visual.VisualID)
            .then(attachments => ({ visualId: visual.VisualID, attachments }))
            .catch(error => {
              console.error(`Error fetching attachments for visual ${visual.VisualID}:`, error);
              return { visualId: visual.VisualID, attachments: [] };
            })
        );
      
      const attachmentResults = await Promise.all(attachmentPromises);
      
      // Process the results
      for (const result of attachmentResults) {
        const { visualId, attachments } = result;
        
        // Check if attachments is defined and is an array
        if (!attachments || !Array.isArray(attachments)) {
          this.visualPhotos[visualId] = [];
        } else {
          
          // Store the attachments in our mapping
          this.visualPhotos[visualId] = attachments.map((att: any) => {
            // Parse Drawings field if it contains annotation JSON
            let annotationData = null;
            let originalFilePath = null;
            
            if (att.Drawings) {
              try {
                const drawingsData = JSON.parse(att.Drawings);
                annotationData = drawingsData;
                originalFilePath = drawingsData.originalFilePath || null;
              } catch (e) {
              }
            }
            
            return {
              Photo: att.Photo,
              Annotation: att.Annotation,
              Drawings: att.Drawings,  // Store raw Drawings field
              annotations: annotationData,  // Store parsed annotation JSON
              annotationsData: annotationData,  // Also store as annotationsData for compatibility
              originalFilePath: originalFilePath,  // Store path to original image if available
              hasAnnotations: !!annotationData,
              AttachID: att.AttachID || att.PK_ID
            };
          });
        }
      }
      
      // Also update visuals in organized data if needed
      for (const visual of visuals) {
        if (visual.VisualID) {
          this.updateVisualInOrganizedData(visual);
        }
      }
    } catch (error) {
      console.error('ÃƒÂ¢Ã‚ÂÃ…â€™ Error fetching visuals from database:', error);
      await this.showToast('Error loading inspection data. Some images may not appear.', 'warning');
    }
  }

  private updateVisualInOrganizedData(visual: any): void {
    const category: string = visual.Category;
    const kind: string | undefined = visual.Kind?.toLowerCase();
    
    if (!this.organizedData[category]) {
      this.organizedData[category] = {
        comments: [],
        limitations: [],
        deficiencies: []
      };
    }
    
    // Check if this visual already exists in our organized data
    let found = false;
    
    if (kind === 'comment' && this.organizedData[category].comments) {
      const existing = this.organizedData[category].comments.find((c: any) => c.VisualID === visual.VisualID);
      if (existing) {
        // Update with database values
        existing.Text = visual.Text || existing.Text;
        existing.Notes = visual.Notes || existing.Notes;
        found = true;
      }
    } else if (kind === 'limitation' && this.organizedData[category].limitations) {
      const existing = this.organizedData[category].limitations.find((l: any) => l.VisualID === visual.VisualID);
      if (existing) {
        existing.Text = visual.Text || existing.Text;
        existing.Notes = visual.Notes || existing.Notes;
        found = true;
      }
    } else if (kind === 'deficiency' && this.organizedData[category].deficiencies) {
      const existing = this.organizedData[category].deficiencies.find((d: any) => d.VisualID === visual.VisualID);
      if (existing) {
        existing.Text = visual.Text || existing.Text;
        existing.Notes = visual.Notes || existing.Notes;
        found = true;
      }
    }
    
    // If not found in organized data but exists in database, mark it as selected
    if (!found && visual.VisualID) {
      const key = `${category}-${kind}-${visual.VisualID}`;
      if (this.selectedItems) {
        this.selectedItems[key] = true;
      }
    }
  }
}

