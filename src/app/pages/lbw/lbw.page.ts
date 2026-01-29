import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ChangeDetectorRef, ChangeDetectionStrategy, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { CaspioService } from '../../services/caspio.service';
import { OfflineService } from '../../services/offline.service';
import { OfflineTemplateService } from '../../services/offline-template.service';
import { OperationsQueueService } from '../../services/operations-queue.service';
import { ToastController, LoadingController, AlertController, ActionSheetController, ModalController, Platform, NavController } from '@ionic/angular';
import { CameraService } from '../../services/camera.service';
import { ImageCompressionService } from '../../services/image-compression.service';
import { CacheService } from '../../services/cache.service';
import { PhotoViewerComponent } from '../../components/photo-viewer/photo-viewer.component';
// import { PhotoAnnotatorComponent } from '../../components/photo-annotator/photo-annotator.component';
import { FabricPhotoAnnotatorComponent } from '../../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { PdfGeneratorService } from '../../services/pdf-generator.service';
import { PlatformDetectionService } from '../../services/platform-detection.service';
import { FabricService } from '../../services/fabric.service';
import { compressAnnotationData, decompressAnnotationData, EMPTY_COMPRESSED_ANNOTATIONS, renderAnnotationsOnPhoto } from '../../utils/annotation-utils';
import { HelpModalComponent } from '../../components/help-modal/help-modal.component';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { firstValueFrom, Subscription } from 'rxjs';
import { LbwDataService } from './lbw-data.service';
import { environment } from '../../../environments/environment';

type PdfPreviewCtor = typeof import('../../components/pdf-preview/pdf-preview.component')['PdfPreviewComponent'];
// jsPDF is now lazy-loaded via PdfGeneratorService


interface ServicesLbwRecord {
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

interface PendingHudCreate {
  category: string;
  templateId: string;
  data: ServicesLbwRecord;
}

@Component({
  selector: 'app-lbw',
  templateUrl: './lbw.page.html',
  styleUrls: ['./lbw.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush  // PERFORMANCE: OnPush for optimized change detection
})
export class LbwPage implements OnInit, AfterViewInit, OnDestroy {
  // Build cache fix: v1.4.247 - Fixed class structure, removed orphaned code
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  projectId: string = '';
  serviceId: string = '';
  projectData: any = null;
  serviceData: any = {}; // Store Services table data
  hasChangesAfterLastFinalization: boolean = false; // Track if changes made since last Update/Finalize
  currentUploadContext: any = null;
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

  private restoreScrollPosition(target: number, attempts = 3): void {
    // DISABLED: No auto-scrolling per user request
    return;
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
  private pendingVisualCreates: { [key: string]: PendingHudCreate } = {};
  private backgroundUploadQueue: Array<() => Promise<void>> = []; // Queue for background uploads
  private activeUploadCount = 0;
  private readonly maxParallelUploads = 2; // Allow 2 uploads simultaneously
  private contextClearTimer: any = null; // Timer for clearing upload context
  
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
  
  // Categories from Services_LBW_Templates
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
  
  // Track visual record IDs from Services_LBW table
  visualRecordIds: { [key: string]: string } = {};
  
  // Track photos for each visual
  visualPhotos: { [visualId: string]: any[] } = {};

  // Track photo loading state for skeleton loaders
  loadingPhotosByKey: { [key: string]: boolean } = {};
  photoCountsByKey: { [key: string]: number } = {}; // Expected photo count for skeleton loaders

  // Photo loading optimization
  photoLoadQueue: { visualId: string; photoIndex: number; photo: any }[] = [];
  isLoadingPhotos: boolean = false;
  visibleVisuals: Set<string> = new Set(); // Track which visuals are visible
  photoLoadBatchSize: number = 3; // Load 3 photos at a time
  private readonly photoLoadConcurrency = 4;
  
  // Type information for the header
  typeShort: string = 'HUD';
  typeFull: string = "HUD - Housing and Urban Development";

  // Dropdown options for AnswerType 2 from Services_LBW_Drop
  visualDropdownOptions: { [templateId: string]: string[] } = {};

  // Form data for the template
  formData: any = {
    // Additional fields to be added based on requirements
  };

  // Operations queue UI state
  showOperationsDetail = false;

  // Global scroll lock to prevent ANY scroll jumping on webapp
  private scrollLockActive = false;
  private lockedScrollY = 0;
  private lockedScrollX = 0;
  private scrollCheckInterval: any = null;
  private photoRetryInterval: any = null;
  private preClickScrollY = 0;
  private preClickScrollX = 0;

  // Status options from Status table
  statusOptions: any[] = [];
  
  // Services dropdown options from Services_Drop table
  weatherConditionsOptions: string[] = [];
  outdoorTemperatureOptions: string[] = [];
  occupancyFurnishingsOptions: string[] = [];
  inAttendanceOptions: string[] = [];
  inAttendanceSelections: string[] = []; // Multi-select array for In Attendance
  inAttendanceOtherValue: string = ''; // Custom value for "Other" option
  typeOfBuildingOtherValue: string = ''; // Custom value for "Other" option
  styleOtherValue: string = ''; // Custom value for "Other" option
  occupancyFurnishingsOtherValue: string = ''; // Custom value for "Other" option
  weatherConditionsOtherValue: string = ''; // Custom value for "Other" option
  outdoorTemperatureOtherValue: string = ''; // Custom value for "Other" option
  firstFoundationTypeOtherValue: string = ''; // Custom value for "Other" option
  secondFoundationTypeOtherValue: string = ''; // Custom value for "Other" option
  thirdFoundationTypeOtherValue: string = ''; // Custom value for "Other" option
  ownerOccupantInterviewOtherValue: string = ''; // Custom value for "Other" option
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

  // PERFORMANCE: Track which sections have been rendered at least once
  // Allows hybrid approach: *ngIf on first load, CSS hiding after first expansion
  renderedSections: { [key: string]: boolean } = {
    project: false,
    structural: false,
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

  /**
   * Clear PDF cache to ensure fresh data on next PDF view
   * Call this whenever photos, annotations, or captions are added/modified/deleted
   */
  private clearPDFCache(): void {
    // Clear all PDF-related caches
    const patterns = ['pdf_data', 'visual_photos', 'photo_base64', 'photo_annotated'];

    patterns.forEach(pattern => {
      // Clear all cache entries matching this pattern
      // The cache service should handle wildcard deletion
      try {
        // Get all cache keys and delete matching ones
        const allKeys = Object.keys(localStorage).filter(key => key.includes(pattern));
        allKeys.forEach(key => {
          localStorage.removeItem(key);
        });
      } catch (error) {
        console.warn('[Cache] Error clearing cache pattern:', pattern, error);
      }
    });

    console.log('[Cache] PDF cache cleared - next PDF view will show fresh data');
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
    private fabricService: FabricService,
    private cache: CacheService,
    private offlineService: OfflineService,
    private offlineTemplate: OfflineTemplateService,
    private hudData: LbwDataService,
    public operationsQueue: OperationsQueueService,
    private ngZone: NgZone
  ) {
    // CRITICAL FIX: Setup scroll lock mechanism on webapp only
    if (typeof window !== 'undefined') {
      this.setupGlobalScrollLock();
    }
  }

  private setupGlobalScrollLock(): void {
    console.log('[SCROLL LOCK] Setting up global scroll lock');
    
    // Listen for when modals/alerts are about to open
    document.addEventListener('ionModalWillPresent', () => {
      console.log('[SCROLL LOCK] ionModalWillPresent - LOCKING SCROLL');
      this.lockScroll();
    });
    
    document.addEventListener('ionAlertWillPresent', () => {
      console.log('[SCROLL LOCK] ionAlertWillPresent - LOCKING SCROLL');
      this.lockScroll();
    });
    
    // Listen for when modals/alerts close
    document.addEventListener('ionModalDidDismiss', () => {
      console.log('[SCROLL LOCK] ionModalDidDismiss - UNLOCKING SCROLL');
      this.unlockScroll();
    });
    
    document.addEventListener('ionAlertDidDismiss', () => {
      console.log('[SCROLL LOCK] ionAlertDidDismiss - UNLOCKING SCROLL');
      this.unlockScroll();
    });
  }

  private lockScroll(): void {
    // CRITICAL: Get scroll from ion-content, NOT window!
    const ionContent = document.querySelector('ion-content');
    const scrollElement = ionContent?.shadowRoot?.querySelector('.inner-scroll') || 
                          ionContent?.querySelector('.inner-scroll') || 
                          document.documentElement;
    
    this.lockedScrollY = (scrollElement as any)?.scrollTop || window.scrollY;
    this.lockedScrollX = (scrollElement as any)?.scrollLeft || window.scrollX;
    this.scrollLockActive = true;
    
    console.log('[SCROLL LOCK] Locked at Y:', this.lockedScrollY, 'X:', this.lockedScrollX);
    
    // Start monitoring and forcing scroll position on BOTH window and ion-content
    if (this.scrollCheckInterval) {
      clearInterval(this.scrollCheckInterval);
    }
    
    this.scrollCheckInterval = setInterval(() => {
      if (this.scrollLockActive) {
        const currentY = (scrollElement as any)?.scrollTop || window.scrollY;
        const currentX = (scrollElement as any)?.scrollLeft || window.scrollX;
        
        // If scroll position changed, force it back on BOTH
        if (currentY !== this.lockedScrollY || currentX !== this.lockedScrollX) {
          console.log('[SCROLL LOCK] Forcing scroll back from Y:', currentY, 'to Y:', this.lockedScrollY);
          window.scrollTo(this.lockedScrollX, this.lockedScrollY);
          if (scrollElement) {
            (scrollElement as any).scrollTop = this.lockedScrollY;
            (scrollElement as any).scrollLeft = this.lockedScrollX;
          }
        }
      }
    }, 10); // Check every 10ms
  }

  private unlockScroll(): void {
    console.log('-------------------------------------------');
    console.log('[SCROLL LOCK] UNLOCKING - About to restore to Y:', this.lockedScrollY);
    
    // Get ion-content scroll element
    const ionContent = document.querySelector('ion-content');
    const scrollElement = ionContent?.shadowRoot?.querySelector('.inner-scroll') || 
                          ionContent?.querySelector('.inner-scroll') || 
                          document.documentElement;
    
    console.log('[SCROLL LOCK] Current window.scrollY:', window.scrollY);
    console.log('[SCROLL LOCK] Current ion-content scrollTop:', (scrollElement as any)?.scrollTop);
    console.log('-------------------------------------------');
    
    // Stop monitoring
    this.scrollLockActive = false;
    
    if (this.scrollCheckInterval) {
      clearInterval(this.scrollCheckInterval);
      this.scrollCheckInterval = null;
    }
    
    // Restore original position MULTIPLE times on BOTH window and ion-content
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        const currentY = window.scrollY;
        const ionY = (scrollElement as any)?.scrollTop || 0;
        console.log(`[SCROLL LOCK] Restore attempt ${i+1} - Target Y: ${this.lockedScrollY}, window.scrollY: ${currentY}, ion-content scrollTop: ${ionY}`);
        
        window.scrollTo(this.lockedScrollX, this.lockedScrollY);
        if (scrollElement) {
          (scrollElement as any).scrollTop = this.lockedScrollY;
          (scrollElement as any).scrollLeft = this.lockedScrollX;
        }
      }, i * 10);
    }
  }

  async ngOnInit() {
    console.log('[ngOnInit] ========== START ==========');
    // Get project ID from route params
    this.projectId = this.route.snapshot.paramMap.get('projectId') || '';
    this.serviceId = this.route.snapshot.paramMap.get('serviceId') || '';

    console.log('[ngOnInit] ProjectId from route:', this.projectId);
    console.log('[ngOnInit] ServiceId from route:', this.serviceId);
    console.log('[ngOnInit] isFirstLoad:', this.isFirstLoad);

    // Initialize operations queue and register executors
    await this.initializeOperationsQueue();
    
    // Start periodic retry for stuck uploading photos
    this.startPhotoRetryInterval();

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
        this.loadProjectDropdownOptions(),
        this.loadServicesDropdownOptions(),
        this.loadVisualDropdownOptions(),
        this.loadStatusOptions()
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

    // DEBUG: Monitor header for size/style changes
    this.setupHeaderDebugMonitor();
  }

  private setupHeaderDebugMonitor() {
    if (!this.platformIonic.is('mobile')) {
      return; // Only monitor on mobile
    }

    setTimeout(() => {
      const header = document.querySelector('ion-header');
      if (!header) {
        console.error('[DEBUG] No ion-header found');
        return;
      }

      let lastHeight = header.getBoundingClientRect().height;
      let lastPaddingTop = window.getComputedStyle(header).paddingTop;

      console.log(`[DEBUG] Initial header height: ${lastHeight}px, paddingTop: ${lastPaddingTop}`);

      const observer = new MutationObserver(() => {
        const currentHeight = header.getBoundingClientRect().height;
        const currentPaddingTop = window.getComputedStyle(header).paddingTop;

        if (currentHeight !== lastHeight || currentPaddingTop !== lastPaddingTop) {
          const message = `HEADER CHANGED!\nHeight: ${lastHeight}px ? ${currentHeight}px\nPadding-Top: ${lastPaddingTop} ? ${currentPaddingTop}`;
          console.error('[DEBUG]', message);

          // Show alert to user
          this.alertController.create({
            header: 'Debug: Header Changed',
            message: message,
            buttons: ['OK']
          }).then(alert => alert.present());

          lastHeight = currentHeight;
          lastPaddingTop = currentPaddingTop;
        }
      });

      observer.observe(header, {
        attributes: true,
        attributeFilter: ['style', 'class'],
        childList: true,
        subtree: true
      });

      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['style', 'class']
      });

    }, 1000);
  }

  /**
   * Initialize the operations queue and register executors for room/point/photo operations
   */
  private async initializeOperationsQueue(): Promise<void> {
    console.log('[OperationsQueue] Initializing operations queue...');

    // Restore any pending operations from storage
    await this.operationsQueue.restore();

    // Register CREATE_VISUAL executor (Structural Systems)
    this.operationsQueue.setExecutor('CREATE_VISUAL', async (data: any) => {
      console.log('[OperationsQueue] Executing CREATE_VISUAL:', data.Name);
      const response = await this.caspioService.createServicesLBW(data).toPromise();

      if (!response) {
        throw new Error('No response from createServicesVisual');
      }

      const visualId = response.LBWID || response.PK_ID || response.id;
      if (!visualId) {
        console.error('[OperationsQueue] No LBWID in response:', response);
        throw new Error('LBWID not found in response');
      }

      console.log('[OperationsQueue] Visual created successfully:', visualId);
      return { visualId, response };
    });

    // Register UPDATE_VISUAL executor (Structural Systems)
    this.operationsQueue.setExecutor('UPDATE_VISUAL', async (data: any) => {
      console.log('[OperationsQueue] Executing UPDATE_VISUAL:', data.visualId);
      const { visualId, updateData } = data;
      const response = await this.caspioService.updateServicesLBW(visualId, updateData).toPromise();
      console.log('[OperationsQueue] Visual updated successfully');
      return { response };
    });

    // Register DELETE_VISUAL executor (Structural Systems)
    this.operationsQueue.setExecutor('DELETE_VISUAL', async (data: any) => {
      console.log('[OperationsQueue] Executing DELETE_VISUAL:', data.visualId);
      await this.caspioService.deleteServicesLBW(data.visualId).toPromise();
      console.log('[OperationsQueue] Visual deleted successfully');
      return { success: true };
    });

    // Register UPLOAD_VISUAL_PHOTO executor (Structural Systems)
    this.operationsQueue.setExecutor('UPLOAD_VISUAL_PHOTO', async (data: any, onProgress?: (p: number) => void) => {
      console.log('[OperationsQueue] Executing UPLOAD_VISUAL_PHOTO for visual:', data.visualId);

      // Compress the file first
      const compressedFile = await this.imageCompression.compressImage(data.file, {
        maxSizeMB: 0.8,
        maxWidthOrHeight: 1280,
        useWebWorker: true
      }) as File;

      if (onProgress) onProgress(0.3); // 30% after compression

      // Process annotation data
      let drawingsData = '';
      if (data.annotationData && data.annotationData !== null) {
        if (typeof data.annotationData === 'string') {
          drawingsData = data.annotationData;
        } else if (typeof data.annotationData === 'object') {
          drawingsData = JSON.stringify(data.annotationData);
        }
        if (drawingsData && drawingsData.length > 0) {
          drawingsData = compressAnnotationData(drawingsData, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });
        }
      }
      if (!drawingsData) {
        drawingsData = EMPTY_COMPRESSED_ANNOTATIONS;
      }

      if (onProgress) onProgress(0.5); // 50% before upload

      // Upload the photo
      // Function signature: (visualId, annotation, file, drawings?, originalFile?)
      const response = await this.caspioService.createServicesLBWAttachWithFile(
        parseInt(data.visualId, 10),
        data.caption || '',
        compressedFile,
        drawingsData
      ).toPromise();

      if (onProgress) onProgress(1.0); // 100% complete

      console.log('[OperationsQueue] Visual photo uploaded successfully:', response?.AttachID);
      return { attachId: response?.AttachID || response?.PK_ID, response };
    });

    // Register UPLOAD_VISUAL_PHOTO_UPDATE executor (Background photo upload for existing record)
    this.operationsQueue.setExecutor('UPLOAD_VISUAL_PHOTO_UPDATE', async (data: any, onProgress?: (p: number) => void) => {
      console.log('[OperationsQueue] Executing UPLOAD_VISUAL_PHOTO_UPDATE for AttachID:', data.attachId);

      // Compress the file first
      const compressedFile = await this.imageCompression.compressImage(data.file, {
        maxSizeMB: 0.8,
        maxWidthOrHeight: 1280,
        useWebWorker: true
      }) as File;

      if (onProgress) onProgress(0.5); // 50% after compression

      // Upload photo to existing record
      const response = await this.caspioService.updateServicesLBWAttachPhoto(
        data.attachId,
        compressedFile,
        data.originalFile
      ).toPromise();

      if (onProgress) onProgress(1.0); // 100% complete

      console.log('[OperationsQueue] Photo updated successfully for AttachID:', data.attachId);
      return { response };
    });

    console.log('[OperationsQueue] Operations queue initialized successfully');
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
    this.hudData.clearAllCaches();

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
    // Clean up scroll lock
    if (this.scrollCheckInterval) {
      clearInterval(this.scrollCheckInterval);
      this.scrollCheckInterval = null;
    }
    this.scrollLockActive = false;
    
    // Clean up photo retry interval
    if (this.photoRetryInterval) {
      clearInterval(this.photoRetryInterval);
      this.photoRetryInterval = null;
    }

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
    this.organizedData = {};
    this.categoryData = {};
    this.visualCategories = [];
    this.visualTemplates = [];
    this.expandedCategories = {};
    this.selectedItems = {};
    this.savingItems = {};

    // Clear pending operations
    this.formData = {};
    this.pendingPhotoUploads = {};
    this.pendingVisualCreates = {};
    this.pendingVisualKeys.clear();

    // Clear thumbnail cache
    this.thumbnailCache.clear();

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

  trackByPhotoId(index: number, photo: any): string {
    // MUST return stable UUID - NEVER fall back to index (causes re-renders)
    // Priority: imageId (new local-first) > _tempId > AttachID > generated emergency ID
    const stableId = photo.imageId || photo._tempId || photo.AttachID || photo.id || photo.PK_ID;
    if (stableId) {
      return String(stableId);
    }
    // Generate emergency stable ID from available data - never use index
    console.warn('[trackBy] Photo missing stable ID, generating emergency ID:', photo);
    return `photo_${photo.VisualID || photo.LBWID || 'unknown'}_${photo.fileName || photo.Photo || index}`;
  }

      trackByOption(index: number, option: string): string {
    return option;
  }

  // Operations queue helper methods
  getPendingOpsCount(queue: any[]): number {
    return queue.filter(op => op.status === 'pending' || op.status === 'in-progress').length;
  }

  getFailedOpsCount(queue: any[]): number {
    return queue.filter(op => op.status === 'failed').length;
  }

  getQueueProgress(queue: any[]): number {
    if (queue.length === 0) return 1;
    const completed = queue.filter(op => op.status === 'completed').length;
    return completed / queue.length;
  }

  toggleOperationsDetail(): void {
    this.showOperationsDetail = !this.showOperationsDetail;
    this.changeDetectorRef.detectChanges();
  }

  getOperationLabel(type: string): string {
    const labels: { [key: string]: string } = {
      'CREATE_ROOM': 'Creating room',
      'CREATE_POINT': 'Creating point',
      'UPLOAD_PHOTO': 'Uploading photo',
      'UPDATE_ROOM': 'Updating room',
      'DELETE_ROOM': 'Deleting room'
    };
    return labels[type] || type;
  }

  async retryFailedOperation(id: string): Promise<void> {
    console.log(`[Operations] Retrying operation ${id}`);
    await this.operationsQueue.retryOperation(id);
    this.changeDetectorRef.detectChanges();
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
      this.projectData = await this.hudData.getProject(this.projectId);

      // Format numeric fields after loading
      this.formatSquareFeet();
      this.formatYearBuilt();

      // Check for custom values and add them to dropdown options
      this.loadCustomValuesIntoDropdowns();
      
      // Parse multi-select fields
      this.parseInAttendanceField();
      // Removed parseSecondFoundationRoomsField() and parseThirdFoundationRoomsField() - methods deleted

      // Type information is now loaded from Service data which has the correct TypeID
    } catch (error) {
      console.error('Error loading project data:', error);
      await this.showToast('Failed to load project data', 'danger');
    }
  }
  
  async loadTypeInfo(typeId: string) {
    try {
      const typeData = await this.hudData.getType(typeId);
      
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
        console.warn('Ã¢Å¡Â Ã¯Â¸Â TypeShort not found in type data:', typeData);
        
        // TypeShort not found in response
      }
    } catch (error: any) {
      console.error('Ã¢ÂÅ’ Error loading type info:', error);
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
      const serviceResponse = await this.hudData.getService(this.serviceId);
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

        // StructStat field removed from HUD template
        
        // TypeID loaded from service data
        
        // Load type information using TypeID from service data
        if (this.serviceData?.TypeID) {
          await this.loadTypeInfo(this.serviceData.TypeID);
        } else {
          console.warn('Ã¢Å¡Â Ã¯Â¸Â No TypeID found in service data');
        }

        this.loadCustomValuesIntoDropdowns();
        this.parseInAttendanceField();
        // Removed parseSecondFoundationRoomsField() and parseThirdFoundationRoomsField() - methods deleted
      } else {
        console.warn('Ã¢Å¡Â Ã¯Â¸Â No service response received');
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
        Notes: this.serviceData.Notes || '',
        Status: '',
        ReportFinalized: false
      };
    }
  }
  
    
  // Load dropdown options from Services_Drop table
  async loadServicesDropdownOptions() {
    try {
      
      // Set default options first
      this.weatherConditionsOptions = ['Clear', 'Partly Cloudy', 'Cloudy', 'Light Rain', 'Heavy Rain', 'Windy', 'Foggy', 'Other'];
      this.outdoorTemperatureOptions = ['30�F -', '30�F to 60�F', '60�F to 70�F', '70�F to 80�F', '80�F to 90�F', '90�F to 100�F', '100�F+', 'Other'];
      this.occupancyFurnishingsOptions = ['Occupied - Furnished', 'Occupied - Unfurnished', 'Vacant - Furnished', 'Vacant - Unfurnished', 'Other'];
      this.inAttendanceOptions = ['Owner', 'Occupant', 'Agent', 'Builder', 'Other'];
      this.firstFoundationTypeOptions = ['Slab on Grade', 'Pier and Beam', 'Basement', 'Crawl Space', 'Other'];
      this.secondFoundationTypeOptions = ['Slab on Grade', 'Pier and Beam', 'Basement', 'Crawl Space', 'None', 'Other'];
      this.thirdFoundationTypeOptions = ['Slab on Grade', 'Pier and Beam', 'Basement', 'Crawl Space', 'None', 'Other'];
      this.secondFoundationRoomsOptions = ['Living Room', 'Kitchen', 'Master Bedroom', 'Bathroom', 'Other'];
      this.thirdFoundationRoomsOptions = ['Living Room', 'Kitchen', 'Master Bedroom', 'Bathroom', 'Other'];
      this.ownerOccupantInterviewOptions = [
        'Owner/occupant not available for discussion',
        'Owner/occupant not aware of any previous foundation work',
        'Owner/occupant provided the information documented in Support Documents',
        'Owner/occupant is aware of previous work and will email documents asap',
        'Other'
      ];
      
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
          
          // Reorder to put "30�F -" first (if it exists)
          const thirtyBelowIndex = this.outdoorTemperatureOptions.findIndex(opt =>
            opt.includes('30') && opt.includes('-') && !opt.includes('to')
          );
          if (thirtyBelowIndex > 0) {
            const thirtyBelowOption = this.outdoorTemperatureOptions.splice(thirtyBelowIndex, 1)[0];
            this.outdoorTemperatureOptions.unshift(thirtyBelowOption);
          }

          // Ensure "90�F to 100�F" (or similar) comes before "100�F+"
          const ninetyToHundredIndex = this.outdoorTemperatureOptions.findIndex(opt =>
            opt.includes('90') && opt.includes('100')
          );
          const hundredPlusIndex = this.outdoorTemperatureOptions.findIndex(opt =>
            opt.includes('100') && opt.includes('+')
          );

          // If both exist and 100�F+ comes before 90�F to 100�F, swap them
          if (ninetyToHundredIndex > -1 && hundredPlusIndex > -1 && hundredPlusIndex < ninetyToHundredIndex) {
            const ninetyToHundredOption = this.outdoorTemperatureOptions[ninetyToHundredIndex];
            const hundredPlusOption = this.outdoorTemperatureOptions[hundredPlusIndex];
            this.outdoorTemperatureOptions[hundredPlusIndex] = ninetyToHundredOption;
            this.outdoorTemperatureOptions[ninetyToHundredIndex] = hundredPlusOption;
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

  // Load status options from Status table
  async loadStatusOptions() {
    try {
      const response = await this.caspioService.get<any>('/tables/LPS_Status/records').toPromise();
      if (response && response.Result) {
        this.statusOptions = response.Result;
        console.log('[Status] Loaded status options:', this.statusOptions);
      }
    } catch (error) {
      console.error('Error loading status options:', error);
    }
  }

  // Helper method to get Status_Admin value by Status_Client lookup
  getStatusAdminByClient(statusClient: string): string {
    const statusRecord = this.statusOptions.find(s => s.Status_Client === statusClient);
    if (statusRecord && statusRecord.Status_Admin) {
      return statusRecord.Status_Admin;
    }
    // Fallback to Status_Client if Status_Admin not found
    console.warn(`[Status] Status_Admin not found for Status_Client "${statusClient}", using Status_Client as fallback`);
    return statusClient;
  }

  // Helper method to check if current status matches any of the given Status_Client values
  isStatusAnyOf(statusClientValues: string[]): boolean {
    if (!this.serviceData?.Status) {
      return false;
    }
    // Check if current Status matches any Status_Admin values for the given Status_Client values
    for (const clientValue of statusClientValues) {
      const statusRecord = this.statusOptions.find(s => s.Status_Client === clientValue);
      if (statusRecord && statusRecord.Status_Admin === this.serviceData.Status) {
        return true;
      }
      // Also check direct match with Status_Client (for backwards compatibility)
      if (this.serviceData.Status === clientValue) {
        return true;
      }
    }
    return false;
  }
  
  // Load FDF options from Services_EFE_Drop table
    
  // Load dropdown options for visual templates from LPS_Services_LBW_Drop table
  // DEXIE-FIRST: Use cache-first pattern for mobile
  async loadVisualDropdownOptions() {
    try {
      const dropdownData = await this.offlineTemplate.getLbwDropdownOptions();

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
    
  // Handle FDF selection change
    // Show popup for FDF "Other" custom value
    // Handle taking FDF photos (Top, Bottom, Threshold) - using file input like room points
    
  // Process FDF photo after file selection
    
  // View FDF photo in a simple modal
  // Annotate FDF photo (opens photo annotator like Structural Systems)
    // Delete FDF photo
    
  // Handle elevation value change for a point
    // Edit elevation point name
    // Delete an elevation point
    // Ensure FDF photos structure exists for a room
  // Get FDF photo caption with structure initialization
  // Set FDF photo caption with structure initialization
  // Update FDF photo display to show annotated image (like measurement photos)
  // Calculate maximum elevation differential for a room
    
  // Get a specific photo by type (Location or Measurement) for a point
  // PERFORMANCE NOTE: No caching needed - find() on 1-2 photo array is already ultra-fast
    // Capture photo for room elevation point with specific type (Location or Measurement)
    
  // Load existing room points and their photos
    
  // Handle file selection for room points with annotation support (matching Structural Systems)
    
  // QUEUE-BASED UPLOAD: Queue photo upload with proper dependencies on room and point creation
    
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
    
  // Upload photo to Services_EFE_Attach
    
  // Upload photo from File object to Services_EFE_Points_Attach with annotation support
    // Helper to check if error is retryable
  private isRetryableError(error: any): boolean {
    return error.status === 0 ||           // Network error
           error.status === 408 ||          // Timeout
           error.status === 429 ||          // Too many requests
           error.status >= 500 ||           // Server error
           error.name === 'TimeoutError';
  }
  
  // Perform the actual room point photo upload with annotation support - REFACTORED for instant record creation
    
  // Toggle room selection - create or remove from Services_EFE
    /**
   * Queue point creation for a room with dependency on room creation
   */
    /**
   * Ensure room is queued/created - returns room operation ID for dependencies
   * This method is idempotent - safe to call multiple times for same room
   */
    /**
   * Ensure point is queued/created - returns point operation ID for dependencies
   * This method is idempotent - safe to call multiple times for same point
   */
    // Pre-create all elevation points for a room to eliminate lag when taking photos
    // Retry creating a failed point
    // Helper methods for point status
            // Remove room from Services_EFE
      
    
  // Get list of selected rooms
    
  // Get room index in array
    
  // Move room up in the list
    
  // Move room down in the list
    
  // Rename a room
    
  // Handle room selection change from checkbox
    
  // Check if room is expanded
    
  // Toggle room expansion
    
  // Handle expand/collapse icon click with proper event handling
    
  // Handle room label click - expand/collapse if selected, do nothing if not
    // Handle room header click - add room if not selected, expand/collapse if selected
    // Handle checkbox change - for both addition (checking) and deletion (unchecking)
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

    // CRITICAL: Forcefully reset input to allow rapid captures
    // Even if previous upload is still processing in background
    input.value = '';
    input.disabled = false; // Ensure it's not disabled

    // Use minimal delay for faster response
    setTimeout(() => {
      input.click();
    }, 50); // Reduced from 100ms
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

  // Check if a room should show Location FDF photo (Base Station or Bedroom only, not Bathroom)
    // Check if a room is a bedroom or bathroom (for Location field)
  isBedroomOrBathroom(roomName: string): boolean {
    if (!roomName) {
      return false;
    }

    const lowerRoomName = roomName.toLowerCase().trim();

    // Check for bedroom variations with more explicit patterns
    const isBedroom = lowerRoomName.includes('bedroom') ||
                      lowerRoomName.includes('bed room') ||
                      lowerRoomName.includes('bdrm') ||
                      lowerRoomName.includes('primary bed') ||
                      lowerRoomName.includes('master bed') ||
                      /\bbr\s*\d/.test(lowerRoomName) || // BR1, BR 1, etc.
                      /\bbr\b/.test(lowerRoomName); // standalone BR

    // Check for bathroom variations with more explicit patterns
    const isBathroom = lowerRoomName.includes('bathroom') ||
                       lowerRoomName.includes('bath room') ||
                       lowerRoomName.includes('bath') || // Includes "Primary Bath", "Half Bath", etc.
                       lowerRoomName.includes('bth') ||
                       lowerRoomName.includes('primary bath') ||
                       lowerRoomName.includes('master bath') ||
                       /\bba\s*\d/.test(lowerRoomName) || // BA1, BA 1, etc.
                       /\bba\b/.test(lowerRoomName); // standalone BA

    const result = isBedroom || isBathroom;

    // Removed roomElevationData reference - property deleted
    // if (result && this.roomElevationData[roomName] && !this.roomElevationData[roomName].hasOwnProperty('location')) {
    //   this.roomElevationData[roomName].location = '';
    // }

    return result;
  }

  // Check if a room is a Garage (for Type dropdown)
  isGarage(roomName: string): boolean {
    if (!roomName) {
      return false;
    }

    const lowerRoomName = roomName.toLowerCase().trim();
    const isGarage = lowerRoomName.includes('garage');

    // Removed roomElevationData reference - property deleted
    // if (isGarage && this.roomElevationData[roomName] && !this.roomElevationData[roomName].hasOwnProperty('location')) {
    //   this.roomElevationData[roomName].location = '';
    // }

    return isGarage;
  }

  // Add Base Station specifically
  // Add a room template to the list
  // Add custom point to room
  // v1.4.65 compatibility - addElevationPoint alias
  async loadVisualCategories() {
    try {
      // DEXIE-FIRST: Get all LBW templates from cache
      const allTemplates = await this.offlineTemplate.getLbwTemplates();

      // Use all LBW templates (no TypeID filter needed - LBW has its own dedicated table)
      this.visualTemplates = allTemplates || [];

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

        // Sort by OrderID within category (lowest OrderID first)
        categoryTemplates.sort((a, b) => {
          const orderA = a.OrderID || 0;
          const orderB = b.OrderID || 0;
          return orderA - orderB;
        });

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
    
    // Load existing visual selections from Services_LBW table
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
      const existingVisuals = await this.hudData.getVisualsByService(this.serviceId);
      console.log('[Visual Load] Found existing visuals:', existingVisuals.length, existingVisuals);

      if (existingVisuals && Array.isArray(existingVisuals)) {
        existingVisuals.forEach(visual => {
          if (visual.Category && visual.Name) {
            const matchingTemplate = this.visualTemplates.find(t =>
              t.Category === visual.Category &&
              t.Name === visual.Name
            );

            if (matchingTemplate) {
              // CRITICAL FIX: Use LBWID (unique record ID) for key to ensure each visual gets unique photos
              const visualId = visual.LBWID || visual.PK_ID || visual.id;
              const key = visual.Category + "_" + visualId;
              console.log('[Visual Load] Marking visual as selected:', key, 'LBWID:', visualId);
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
                  console.log(`[Visual Load] Created duplicate instance of template ${matchingTemplate.PK_ID} with LBWID ${visualId}`);
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

    // PERFORMANCE: Mark section as rendered on first expansion
    // This enables hybrid rendering: *ngIf prevents initial render, CSS hides after first expansion
    if (this.expandedSections[section] && !this.renderedSections[section]) {
      this.renderedSections = {
        ...this.renderedSections,
        [section]: true
      };
    }

    // PERFORMANCE: Mark cached values as dirty when sections change
    this.markSpacerHeightDirty();

    // IMMEDIATE UPDATE: Trigger change detection immediately for responsive UI
    // Previous detach/RAF approach caused unresponsiveness where users would
    // double-click thinking the first click didn't register
    this.changeDetectorRef.detectChanges();
  }

  // Check if Structural Systems section should be disabled
  // PERFORMANCE FIX: Dedicated handler for Structural Systems header click
  onStructuralHeaderClick(event: Event): void {
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
      { fieldName: 'WeatherConditions', dataSource: this.serviceData, options: this.weatherConditionsOptions, otherValueProp: 'weatherConditionsOtherValue' },
      { fieldName: 'OutdoorTemperature', dataSource: this.serviceData, options: this.outdoorTemperatureOptions, otherValueProp: 'outdoorTemperatureOtherValue' },
      { fieldName: 'OccupancyFurnishings', dataSource: this.serviceData, options: this.occupancyFurnishingsOptions, otherValueProp: 'occupancyFurnishingsOtherValue' },
      { fieldName: 'FirstFoundationType', dataSource: this.serviceData, options: this.firstFoundationTypeOptions, otherValueProp: 'firstFoundationTypeOtherValue' },
      { fieldName: 'SecondFoundationType', dataSource: this.serviceData, options: this.secondFoundationTypeOptions, otherValueProp: 'secondFoundationTypeOtherValue' },
      { fieldName: 'ThirdFoundationType', dataSource: this.serviceData, options: this.thirdFoundationTypeOptions, otherValueProp: 'thirdFoundationTypeOtherValue' },
      { fieldName: 'OwnerOccupantInterview', dataSource: this.serviceData, options: this.ownerOccupantInterviewOptions, otherValueProp: 'ownerOccupantInterviewOtherValue' },
      { fieldName: 'TypeOfBuilding', dataSource: this.projectData, options: this.typeOfBuildingOptions, otherValueProp: 'typeOfBuildingOtherValue' },
      { fieldName: 'Style', dataSource: this.projectData, options: this.styleOptions, otherValueProp: 'styleOtherValue' }
    ];

    fieldMappings.forEach(mapping => {
      const value = mapping.dataSource?.[mapping.fieldName];
      if (value && value.trim() !== '') {
        // Check if value is a custom value (not in predefined options)
        const isCustomValue = !mapping.options.includes(value) && value !== 'Other';

        if (isCustomValue) {
          // Set dropdown to "Other" and populate the inline input field
          this.customOtherValues[mapping.fieldName] = value;
          (this as any)[mapping.otherValueProp] = value;
          mapping.dataSource[mapping.fieldName] = 'Other';
        }
      }
    });
  }

  scrollToSection(section: string) {
    // DISABLED: No auto-scrolling per user request
    return;
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
    // DISABLED: No auto-scrolling per user request
    return;
  }
  
  private performOptimizedScroll() {
    // DISABLED: No auto-scrolling per user request
    return;
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

    // DISABLED: No auto-scrolling per user request
    // All scroll restoration removed
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
        // Removed elevation completion calculation - selectedRooms property deleted
        // Base Station is required for 100% completion
        // const baseStationSelected = this.selectedRooms['Base Station'] === true;

        // Check if we have at least one other room selected (besides Base Station)
        // const otherRoomsSelected = Object.keys(this.selectedRooms).filter(
        //   room => room !== 'Base Station' && this.selectedRooms[room] === true
        // ).length > 0;

        // Calculate completion: Base Station is 50%, having at least one other room is another 50%
        // let elevationCompletion = 0;
        // if (baseStationSelected) {
        //   elevationCompletion = 50;
        //   if (otherRoomsSelected) {
        //     elevationCompletion = 100;
        //   }
        // }

        return 0; // Returning 0 until elevation tracking is reimplemented

      default:
        return 0;
    }
  }
  
  
  // Room elevation helper methods
  private saveDebounceTimer: any;
  
    // Handle elevation point value change
    // Take photo for elevation point
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
    
  // Save room photo caption/annotation
    
  // Delete room photo
    
  // Update room point photo attachment with annotations (similar to updatePhotoAttachment for Structural Systems)
    
  // View elevation photo with annotation support (matching Structural Systems)
    
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
  }
  
  async submitTemplate() {
    // Validate all required Project Information fields
    const requiredProjectFields = ['ClientName', 'InspectorName',
                                    'YearBuilt', 'SquareFeet', 'TypeOfBuilding', 'Style'];
    const requiredServiceFields = ['InAttendance', 'OccupancyFurnishings', 'WeatherConditions', 'OutdoorTemperature'];

    const missingProjectFields = requiredProjectFields.filter(field => !this.projectData[field]);
    const missingServiceFields = requiredServiceFields.filter(field => !this.serviceData[field]);
    
    if (missingProjectFields.length > 0 || missingServiceFields.length > 0) {
      const allMissing = [...missingProjectFields, ...missingServiceFields];
      await this.showToast(`Please fill in all required fields: ${allMissing.join(', ')}`, 'warning');
      
      // DISABLED: No auto-scrolling per user request
      // Removed scroll to Project Information section
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

      // Navigate back - use replaceUrl on web to avoid template staying in browser history
      if (environment.isWeb) {
        this.router.navigate(['/project', this.projectId], { replaceUrl: true });
      } else {
        this.router.navigate(['/project', this.projectId]);
      }

    } catch (error) {
      console.error('Error submitting template:', error);
      await loading.dismiss();
      await this.showToast('Failed to submit evaluation', 'danger');
    }
  }

  async finalizeReport() {
    // CRITICAL: If report is finalized and no changes made, show message
    if (this.isReportFinalized() && !this.hasChangesAfterLastFinalization) {
      const alert = await this.alertController.create({
        header: 'No Changes to Update',
        message: 'There are no changes to update. Make changes to the report to enable the Update button.',
        cssClass: 'custom-document-alert',
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    console.log('[LBW] Starting finalize validation...');
    const incompleteAreas: string[] = [];

    // Helper function to check if a value is empty
    const isEmpty = (value: any): boolean => {
      return value === null || value === undefined || value === '' || 
             (typeof value === 'string' && value.trim() === '') ||
             value === '-- Select --';
    };

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
      const value = this.projectData[field];
      console.log(`[LBW] Checking ${field}:`, value);
      if (isEmpty(value)) {
        incompleteAreas.push(`Project Information: ${label}`);
      }
    });

    // Check required Service fields
    const requiredServiceFields = {
      'InAttendance': 'In Attendance',
      'OccupancyFurnishings': 'Occupancy/Furnishings',
      'WeatherConditions': 'Weather Conditions',
      'OutdoorTemperature': 'Outdoor Temperature'
    };

    Object.entries(requiredServiceFields).forEach(([field, label]) => {
      const value = this.serviceData[field];
      console.log(`[LBW] Checking ${field}:`, value);
      if (isEmpty(value)) {
        incompleteAreas.push(`Service Information: ${label}`);
      }
    });

    // Check required visual items across all categories
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

    // Removed elevation plot validation - selectedRooms and roomElevationData properties deleted
    // Check Base Station requirement for elevation plot
    // const baseStationSelected = this.selectedRooms['Base Station'] === true;
    // if (!baseStationSelected) {
    //   incompleteAreas.push('Elevation Plot: Base Station (required)');
    // }

    // Check that all selected rooms (except Base Station) have FDF answered
    // for (const roomName in this.selectedRooms) {
    //   if (this.selectedRooms[roomName] === true && !this.isBaseStation(roomName)) {
    //     const roomData = this.roomElevationData[roomName];
    //     if (!roomData || !roomData.fdf || roomData.fdf === '' || roomData.fdf === '-- Select --') {
    //       incompleteAreas.push(`Elevation Plot - ${roomName}: FDF (Flooring Difference Factor) required`);
    //     }
    //   }
    // }

    // Show results
    console.log('[LBW] Validation complete. Incomplete areas:', incompleteAreas.length);
    console.log('[LBW] Missing fields:', incompleteAreas);
    
    if (incompleteAreas.length > 0) {
      const alert = await this.alertController.create({
        header: 'Incomplete Required Fields',
        message: `The following required fields are not complete:\n\n${incompleteAreas.map(area => `• ${area}`).join('\n')}`,
        cssClass: 'custom-document-alert',
        buttons: ['OK']
      });
      await alert.present();
      console.log('[LBW] Alert shown with missing fields');
    } else {
      console.log('[LBW] All fields complete, showing confirmation dialog');
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
        cssClass: 'custom-document-alert',
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
   * Uses Status table lookup to check if current status matches Finalized, Updated, or Under Review
   */
  isReportFinalized(): boolean {
    return this.isStatusAnyOf(['Finalized', 'Updated', 'Under Review']);
  }

  /**
   * Check if Finalize/Update button should be enabled
   */
  canFinalizeReport(): boolean {
    // First check: all required fields must be filled
    if (!this.areAllRequiredFieldsFilled()) {
      return false;
    }

    // If report has been finalized/updated before, only enable if changes have been made
    if (this.isReportFinalized()) {
      return this.hasChangesAfterLastFinalization;
    }

    // For initial finalization, enable if required fields are filled
    return true;
  }

  async markReportAsFinalized() {
    // Check if this is first finalization by looking up status values from Status table
    const isFirstFinalization = !this.isStatusAnyOf(['Finalized', 'Updated', 'Under Review']);
    
    const loading = await this.loadingController.create({
      message: isFirstFinalization ? 'Finalizing report...' : 'Updating report...'
    });
    await loading.present();

    try {
      // Update the Services table
      const currentDateTime = new Date().toISOString();
      
      // Get appropriate StatusAdmin value from Status table
      const statusClientValue = isFirstFinalization ? 'Finalized' : 'Updated';
      const statusAdminValue = this.getStatusAdminByClient(statusClientValue);
      
      const updateData: any = {
        StatusDateTime: currentDateTime,  // Always update timestamp to track when report was last modified
        Status: statusAdminValue  // Use StatusAdmin value from Status table
        // NOTE: StatusEng is NOT updated - it remains as "Created" (set when service was first created)
      };

      console.log('[EngFoundation] Finalizing report with PK_ID:', this.serviceId);
      console.log('[EngFoundation] ProjectId:', this.projectId);
      console.log('[EngFoundation] Is first finalization:', isFirstFinalization);
      console.log('[EngFoundation] StatusClient:', statusClientValue, '-> StatusAdmin:', statusAdminValue);
      console.log('[EngFoundation] StatusEng will NOT be updated (remains as "Created")');
      console.log('[EngFoundation] Update data:', updateData);

      // Update the Services table using PK_ID (this.serviceId is actually PK_ID)
      const response = await this.caspioService.updateService(this.serviceId, updateData).toPromise();
      console.log('[EngFoundation] API Response:', response);

      // CRITICAL: Clear all caches so project-detail page loads fresh data
      console.log('[EngFoundation] Clearing all caches for project:', this.projectId);
      this.cache.clearProjectRelatedCaches(this.projectId);
      this.cache.clearByPattern('projects_active');
      this.cache.clearByPattern('projects_all');

      // Update local state
      this.serviceData.StatusDateTime = currentDateTime;
      this.serviceData.Status = statusAdminValue;
      this.serviceData.ReportFinalized = true;

      // Reset change tracking - button should be grayed out until next change
      this.hasChangesAfterLastFinalization = false;
      console.log('[EngFoundation] Reset hasChangesAfterLastFinalization to false after update');

      // Trigger change detection to update button state
      this.changeDetectorRef.detectChanges();

      console.log('[EngFoundation] Report finalized successfully');

      await loading.dismiss();

      // Navigate back to project detail
      console.log('[EngFoundation] Navigating to project detail...');
      console.log('[EngFoundation] ProjectId:', this.projectId, 'ServiceId:', this.serviceId);

      const navigationData = {
        finalizedServiceId: this.serviceId,
        finalizedDate: currentDateTime,
        projectId: this.projectId,
        timestamp: Date.now()
      };
      localStorage.setItem('pendingFinalizedService', JSON.stringify(navigationData));
      console.log('[EngFoundation] Stored navigation data:', navigationData);

      // Use different navigation for web vs mobile
      console.log('[EngFoundation] Platform:', this.platform.isWeb() ? 'Web' : 'Mobile');
      setTimeout(() => {
        if (this.platform.isWeb()) {
          // Web: Use location.back() to avoid outlet activation error
          console.log('[EngFoundation] Web: Using location.back()');
          this.location.back();
        } else {
          // Mobile: Use NavController for proper stack management
          console.log('[EngFoundation] Mobile: Using navController.navigateBack()');
          this.navController.navigateBack(['/project', this.projectId]);
        }
      }, 300);

    } catch (error) {
      console.error('Error finalizing report:', error);
      await loading.dismiss();
      await this.showToast('Failed to finalize report', 'danger');
    }
  }

  // Check if all required fields are filled (used for button styling)
  areAllRequiredFieldsFilled(): boolean {
    // Helper function to check if a value is empty
    const isEmpty = (value: any): boolean => {
      return value === null || value === undefined || value === '' || 
             (typeof value === 'string' && value.trim() === '') ||
             value === '-- Select --';
    };

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
      if (isEmpty(this.projectData[field])) {
        return false;
      }
    }

    // Check required Service fields
    const requiredServiceFields = {
      'InAttendance': 'In Attendance',
      'OccupancyFurnishings': 'Occupancy/Furnishings',
      'WeatherConditions': 'Weather Conditions',
      'OutdoorTemperature': 'Outdoor Temperature'
    };

    for (const field of Object.keys(requiredServiceFields)) {
      if (isEmpty(this.serviceData[field])) {
        return false;
      }
    }

    // Check required visual items across all categories
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

    // Removed elevation plot validation - selectedRooms and roomElevationData properties deleted
    // Check Base Station requirement for elevation plot
    // const baseStationSelected = this.selectedRooms['Base Station'] === true;
    // if (!baseStationSelected) {
    //   return false;
    // }

    // Check that all selected rooms (except Base Station) have FDF answered
    // for (const roomName in this.selectedRooms) {
    //   if (this.selectedRooms[roomName] === true && !this.isBaseStation(roomName)) {
    //     const roomData = this.roomElevationData[roomName];
    //     if (!roomData || !roomData.fdf || roomData.fdf === '' || roomData.fdf === '-- Select --') {
    //       return false;
    //     }
    //   }
    // }

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
      // CRITICAL FIX: Wait for photo hydration and pending saves before generating PDF
      // This ensures all images are loaded and form data is synchronized

      // Step 1: Wait for photo hydration if in progress
      if (this.photoHydrationPromise) {
        console.log('[PDF] Waiting for photo hydration to complete...');
        loading = await this.alertController.create({
          header: 'Loading Photos',
          message: ' ',
          backdropDismiss: false,
          cssClass: 'template-loading-alert'
        });
        await loading.present();

        try {
          await this.photoHydrationPromise;
          console.log('[PDF] Photo hydration completed');
        } catch (error) {
          console.error('[PDF] Photo hydration error:', error);
          // Continue anyway - we'll handle missing photos gracefully
        }

        await loading.dismiss();
        loading = null;
      }

      // Step 2: Wait for any pending saves to complete
      const savingKeys = Object.keys(this.savingItems).filter(key => this.savingItems[key]);
      if (savingKeys.length > 0) {
        console.log('[PDF] Waiting for pending saves to complete:', savingKeys);
        loading = await this.alertController.create({
          header: 'Saving Changes',
          message: ' ',
          backdropDismiss: false,
          cssClass: 'template-loading-alert'
        });
        await loading.present();

        // Wait up to 5 seconds for saves to complete
        const maxWait = 5000;
        const startTime = Date.now();
        while (Object.keys(this.savingItems).some(key => this.savingItems[key])) {
          if (Date.now() - startTime > maxWait) {
            console.warn('[PDF] Timeout waiting for saves, proceeding anyway');
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        console.log('[PDF] Pending saves completed or timed out');

        await loading.dismiss();
        loading = null;
      }

      // Step 3: Process any pending visual creations and photo uploads
      const hasPendingVisuals = Object.keys(this.pendingVisualCreates).length > 0;
      const hasPendingPhotos = Object.keys(this.pendingPhotoUploads).length > 0;

      if (hasPendingVisuals || hasPendingPhotos) {
        console.log('[PDF] Processing pending items before PDF generation');
        loading = await this.alertController.create({
          header: 'Syncing Data',
          message: ' ',
          backdropDismiss: false,
          cssClass: 'template-loading-alert'
        });
        await loading.present();

        try {
          await this.processAllPendingVisuals();
          console.log('[PDF] Pending items processed');
        } catch (error) {
          console.error('[PDF] Error processing pending items:', error);
          // Continue anyway
        }

        await loading.dismiss();
        loading = null;
      }

      // Now show the main loading indicator for PDF preparation
      loading = await this.alertController.create({
        header: 'Loading Report',
        message: ' ',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
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
      
      // CRITICAL: Check if user clicked cancel before continuing
      const { role } = await loading.onDidDismiss();
      if (role === 'cancel') {
        console.log('[PDF] User cancelled PDF generation');
        this.isPDFGenerating = false;
        // Re-enable the PDF button
        const pdfBtn = (document.querySelector('.pdf-header-button') || document.querySelector('.pdf-fab')) as HTMLElement;
        if (pdfBtn) {
          if (pdfBtn instanceof HTMLButtonElement) {
            pdfBtn.disabled = false;
          }
          pdfBtn.style.pointerEvents = 'auto';
          pdfBtn.style.opacity = '1';
        }
        return; // Exit early - don't generate PDF
      }
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

      // PERFORMANCE OPTIMIZED: Use cache on all platforms for much faster loading
      // Cache is invalidated every 5 minutes and contains base64 data that works everywhere
      const isMobile = this.platformIonic.is('ios') || this.platformIonic.is('android');

      let structuralSystemsData, elevationPlotData, projectInfo;
      const cachedData = this.cache.get(cacheKey); // Use cache on all platforms

      if (cachedData) {
        console.log('[PDF Data] ? Using cached PDF data - fast path!');
        ({ structuralSystemsData, elevationPlotData, projectInfo } = cachedData);
      } else {
        console.log('[PDF Data] Loading fresh PDF data...');
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
            // Removed prepareElevationPlotData() - method deleted
            Promise.resolve([]) // Return empty array as placeholder
          ]);
          
          projectInfo = projectData;
          structuralSystemsData = structuralData;
          elevationPlotData = elevationData;

          // Cache the prepared data on all platforms for faster subsequent loads
          this.cache.set(cacheKey, {
            structuralSystemsData,
            elevationPlotData,
            projectInfo
          }, this.cache.CACHE_TIMES.MEDIUM);
          console.log('[PDF Data] Cached PDF data for reuse (5 min expiry)');
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

      // PERFORMANCE OPTIMIZED: Load cover photo and PDF component in parallel
      const [PdfPreviewComponent] = await Promise.all([
        this.loadPdfPreview(),
        // Load primary photo (cover photo) in parallel
        (async () => {
          if (projectInfo?.primaryPhoto && typeof projectInfo.primaryPhoto === 'string') {
            console.log('[PDF] Primary photo field value:', projectInfo.primaryPhoto.substring(0, 100));

            let convertedPhotoData: string | null = null;

            if (projectInfo.primaryPhoto.startsWith('/')) {
              // Caspio file path - convert to base64
              try {
                console.log('[PDF] Converting primary photo from Caspio path to base64...');
                const imageData = await this.caspioService.getImageFromFilesAPI(projectInfo.primaryPhoto).toPromise();
                if (imageData && typeof imageData === 'string' && imageData.startsWith('data:')) {
                  convertedPhotoData = imageData;
                  console.log('[PDF] Primary photo converted successfully (size:', Math.round(imageData.length / 1024), 'KB)');
                } else {
                  console.error('[PDF] Primary photo conversion failed - invalid data returned:', typeof imageData);
                }
              } catch (error) {
                console.error('[PDF] Error converting primary photo:', error);
              }
            } else if (projectInfo.primaryPhoto.startsWith('data:')) {
              console.log('[PDF] Primary photo is already base64, using directly');
              convertedPhotoData = projectInfo.primaryPhoto;
            } else if (projectInfo.primaryPhoto.startsWith('blob:')) {
              console.log('[PDF] Primary photo is blob URL, attempting to convert...');
              try {
                const response = await fetch(projectInfo.primaryPhoto);
                const blob = await response.blob();
                const reader = new FileReader();
                const base64 = await new Promise<string>((resolve, reject) => {
                  reader.onloadend = () => resolve(reader.result as string);
                  reader.onerror = reject;
                  reader.readAsDataURL(blob);
                });
                convertedPhotoData = base64;
                console.log('[PDF] Primary photo blob converted successfully');
              } catch (error) {
                console.error('[PDF] Error converting blob URL:', error);
              }
            } else if (projectInfo.primaryPhoto.startsWith('http')) {
              console.warn('[PDF] Primary photo is HTTP URL (may not work on mobile):', projectInfo.primaryPhoto);
              convertedPhotoData = projectInfo.primaryPhoto;
            } else {
              console.warn('[PDF] Primary photo has unknown format:', projectInfo.primaryPhoto.substring(0, 50));
            }

            // Set both fields so PDF component can use either one
            if (convertedPhotoData) {
              projectInfo.primaryPhotoBase64 = convertedPhotoData;
              projectInfo.primaryPhoto = convertedPhotoData;
              console.log('[PDF] Primary photo ready for PDF rendering');
            } else {
              console.warn('[PDF] Primary photo conversion resulted in null - photo will not appear in PDF');
            }
          } else {
            console.log('[PDF] No primary photo available for this project');
          }
        })()
      ]);

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

      // PERFORMANCE OPTIMIZED: Present modal immediately (no delay needed)
      // Present the modal with error handling
      try {
        await modal.present();

        // Dismiss loading immediately after modal is presented
        setTimeout(async () => {
          try {
            if (loading) await loading.dismiss();
          } catch (dismissError) {
          }
        }, 100); // Reduced from 300ms to 100ms
        
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
    await this.processPendingHudCreates();

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
        console.error(`[v1.4.530]   ❌ Failed to upload photo ${i + 1}:`, error);
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

  private async processPendingHudCreates(): Promise<void> {
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
    visualData: ServicesLbwRecord
  ): Promise<void> {
    let visualId: string | null = null;

    try {
      const response = await this.caspioService.createServicesLBW(visualData).toPromise();

      if (Array.isArray(response) && response.length > 0) {
        visualId = String(response[0].LBWID || response[0].PK_ID || response[0].id || '');
      } else if (response && typeof response === 'object') {
        if (response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
          visualId = String(response.Result[0].LBWID || response.Result[0].PK_ID || response.Result[0].id || '');
        } else {
          visualId = String(response.LBWID || response.PK_ID || response.id || '');
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
      // Removed processPendingRoomsAndPoints() - method deleted
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
    await this.processPendingHudCreates();

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
    /**
   * Start interval to periodically retry photos that are stuck uploading
   */
  private startPhotoRetryInterval(): void {
    // Clear any existing interval
    if (this.photoRetryInterval) {
      clearInterval(this.photoRetryInterval);
    }
    
    // Check every 10 seconds for photos that need retry
    this.photoRetryInterval = setInterval(() => {
      this.retryStuckPhotos();
    }, 10000); // 10 seconds
    
    console.log('[Photo Retry] Periodic retry interval started (every 10 seconds)');
  }

  /**
   * Check for and retry photos that are stuck uploading
   * Called periodically by the retry interval
   */
  private async retryStuckPhotos(): Promise<void> {
    // Removed - roomElevationData, efeRecordIds, efePointIds properties deleted
    // Find all photos that are uploading but don't have an attachId
    // let foundStuckPhotos = false;

    // for (const roomName of Object.keys(this.roomElevationData)) {
    //   const roomData = this.roomElevationData[roomName];
    //   if (!roomData || !roomData.elevationPoints) continue;
    //
    //   for (const point of roomData.elevationPoints) {
    //     if (!point.photos || point.photos.length === 0) continue;
    //
    //     // Find photos that are stuck (uploading but no attachId)
    //     const stuckPhotos = point.photos.filter((photo: any) =>
    //       photo.uploading && !photo.attachId && photo.file
    //     );
    //
    //     if (stuckPhotos.length > 0) {
    //       foundStuckPhotos = true;
    //       console.log(`[Photo Retry] Found ${stuckPhotos.length} stuck photos for ${roomName} - ${point.name}`);
    //
    //       // Check if room and point are ready now
    //       const roomId = this.efeRecordIds[roomName];
    //       const pointKey = `${roomName}_${point.name}`;
    //       const pointId = this.efePointIds[pointKey];
    //
    //       // Only retry if room and point are ready
    //       if (roomId && roomId !== '__pending__' && !String(roomId).startsWith('temp_') &&
    //           pointId && pointId !== '__pending__' && !String(pointId).startsWith('temp_')) {
    //
    //         console.log(`[Photo Retry] Room and point are ready, retrying ${stuckPhotos.length} photos`);
    //
    //         for (const photoEntry of stuckPhotos) {
    //           try {
    //             const annotatedResult = {
    //               file: photoEntry.file,
    //               annotationData: photoEntry.annotationData || null,
    //               originalFile: photoEntry.originalFile,
    //               caption: photoEntry.caption || ''
    //             };
    //
    //             const response = await this.waitForPointIdAndUpload(roomName, point, pointId, annotatedResult, photoEntry);
    //
    //             if (response) {
    //               photoEntry.attachId = response?.AttachID || response?.PK_ID;
    //               console.log(`[Photo Retry] ? Retry successful, AttachID: ${photoEntry.attachId}`);
    //             }
    //           } catch (error) {
    //             console.error(`[Photo Retry] Retry failed:`, error);
    //             // Will retry again on next interval
    //           }
    //         }
    //       } else {
    //         console.log(`[Photo Retry] Room/point not ready yet - waiting (roomId: ${roomId}, pointId: ${pointId})`);
    //       }
    //     }
    //   }
    // }

    // if (!foundStuckPhotos) {
    //   console.log('[Photo Retry] No stuck photos found');
    // }
  }

  /**
   * Retry queued photos for a specific point
   * Called immediately when a point is successfully created
   */
    /**
   * Retry all queued photos for room points
   * Called after rooms and points have been created
   */
  private async retryQueuedPhotos(): Promise<void> {
    // Removed - roomElevationData, efeRecordIds, efePointIds properties deleted
    // console.log('[Retry Queue] Checking for uploading photos to retry...');

    // Find all uploading photos across all rooms
    // for (const roomName of Object.keys(this.roomElevationData)) {
    //   const roomData = this.roomElevationData[roomName];
    //   if (!roomData || !roomData.elevationPoints) continue;
    //
    //   for (const point of roomData.elevationPoints) {
    //     if (!point.photos || point.photos.length === 0) continue;
    //
    //     // Find photos that are still uploading (no attachId yet)
    //     const uploadingPhotos = point.photos.filter((photo: any) => photo.uploading && !photo.attachId && photo.file);
    //
    //     if (uploadingPhotos.length > 0) {
    //       console.log(`[Retry Queue] Found ${uploadingPhotos.length} uploading photos for ${roomName} - ${point.name}`);
    //
    //       for (const photoEntry of uploadingPhotos) {
    //         try {
    //           // Photo is already in uploading state, just retry the upload
    //
    //           // Get current IDs
    //           const roomId = this.efeRecordIds[roomName];
    //           const pointKey = `${roomName}_${point.name}`;
    //           const pointId = this.efePointIds[pointKey];
    //
    //           console.log(`[Retry Queue] Retrying upload for ${pointKey}, roomId: ${roomId}, pointId: ${pointId}`);
    //
    //           // Retry upload
    //           const annotatedResult = {
    //             file: photoEntry.file,
    //             annotationData: photoEntry.annotationData || null,
    //             originalFile: photoEntry.originalFile,
    //             caption: photoEntry.caption || ''
    //           };
    //
    //           const response = await this.waitForPointIdAndUpload(roomName, point, pointId, annotatedResult, photoEntry);
    //
    //           if (response) {
    //             photoEntry.attachId = response?.AttachID || response?.PK_ID;
    //             console.log(`[Retry Queue] ? Upload successful for ${pointKey}`);
    //           }
    //         } catch (error) {
    //           console.error(`[Retry Queue] Failed to retry photo:`, error);
    //           // Photo will remain queued for next retry
    //         }
    //       }
    //     }
    //   }
    // }

    // console.log('[Retry Queue] Retry complete');
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
      header: 'Ã°Å¸â€œâ€¹ Debug Data (Select & Copy)',
      message: `
        <div style="font-family: monospace; font-size: 11px;">
          <p style="color: orange; margin-bottom: 10px;">
            Ã¢Å¡Â Ã¯Â¸Â Clipboard copy failed. Please manually select and copy the text below:
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
      'OutdoorTemperature'
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
      // Save or remove from Services_LBW table
      if (this.selectedItems[key]) {
        // Item was selected - save to Services_LBW
        await this.saveVisualSelection(category, itemId);
        // Success toast removed per user request
      } else {
        // Item was deselected - remove from Services_LBW if exists
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

    const existingVisualId = this.visualRecordIds[key];

    try {

      if (item.answer === 'Yes' || item.answer === 'No') {
        if (existingVisualId && !String(existingVisualId).startsWith('temp_')) {
          // Update existing record with queue
          await this.operationsQueue.enqueue({
            type: 'UPDATE_VISUAL',
            data: {
              visualId: existingVisualId,
              updateData: { Answers: item.answer }
            },
            dedupeKey: `update_visual_${existingVisualId}_${Date.now()}`,
            maxRetries: 3,
            onSuccess: () => {
              console.log(`[Visual Queue] Updated answer for visual ${existingVisualId}`);
              this.savingItems[key] = false;
              this.changeDetectorRef.detectChanges();
            },
            onError: (error: any) => {
              console.error(`[Visual Queue] Failed to update answer:`, error);
              this.showToast('Failed to save answer. It will retry automatically.', 'warning');
              this.savingItems[key] = false;
              this.changeDetectorRef.detectChanges();
            }
          });
        } else {
          // Create new record with answer in Answers field
          item.answerToSave = item.answer;
          item.text = item.originalText || item.text;
          this.selectedItems[key] = true;
          await this.saveVisualSelection(category, item.id);
        }
      } else if (item.answer === '') {
        // If cleared and record exists, update to remove answer
        if (existingVisualId && !String(existingVisualId).startsWith('temp_')) {
          await this.operationsQueue.enqueue({
            type: 'UPDATE_VISUAL',
            data: {
              visualId: existingVisualId,
              updateData: { Answers: '' }
            },
            dedupeKey: `update_visual_${existingVisualId}_${Date.now()}`,
            maxRetries: 3,
            onSuccess: () => {
              console.log(`[Visual Queue] Cleared answer for visual ${existingVisualId}`);
              this.savingItems[key] = false;
              this.changeDetectorRef.detectChanges();
            },
            onError: (error: any) => {
              console.error(`[Visual Queue] Failed to clear answer:`, error);
              this.showToast('Failed to clear answer. It will retry automatically.', 'warning');
              this.savingItems[key] = false;
              this.changeDetectorRef.detectChanges();
            }
          });
        }
        item.text = item.originalText;
      }
    } catch (error) {
      console.error('Error handling answer change:', error);
      await this.showToast('Failed to save answer', 'danger');
    } finally {
      if (!existingVisualId || String(existingVisualId).startsWith('temp_')) {
        this.savingItems[key] = false;
      }
      // Trigger change detection to update completion percentage
      this.changeDetectorRef.detectChanges();
    }
  }
  
  // Handle multi-select change
  async onMultiSelectChange(category: string, item: any) {
    const key = `${category}_${item.id}`;
    this.savingItems[key] = true;
    const answersText = item.selectedOptions ? item.selectedOptions.join(', ') : '';

    const existingVisualId = this.visualRecordIds[key];

    try {

      if (item.selectedOptions && item.selectedOptions.length > 0) {
        if (existingVisualId && !String(existingVisualId).startsWith('temp_')) {
          // Update existing record with queue
          await this.operationsQueue.enqueue({
            type: 'UPDATE_VISUAL',
            data: {
              visualId: existingVisualId,
              updateData: { Answers: answersText }
            },
            dedupeKey: `update_visual_${existingVisualId}_${Date.now()}`,
            maxRetries: 3,
            onSuccess: () => {
              console.log(`[Visual Queue] Updated multi-select for visual ${existingVisualId}`);
              this.savingItems[key] = false;
              this.changeDetectorRef.detectChanges();
            },
            onError: (error: any) => {
              console.error(`[Visual Queue] Failed to update multi-select:`, error);
              this.showToast('Failed to save selections. It will retry automatically.', 'warning');
              this.savingItems[key] = false;
              this.changeDetectorRef.detectChanges();
            }
          });
        } else {
          // Create new record with selections in Answers field
          item.answerToSave = answersText;
          item.text = item.originalText || item.text;
          this.selectedItems[key] = true;
          await this.saveVisualSelection(category, item.id);
        }
      } else {
        // If no options selected and record exists, clear the answers
        if (existingVisualId && !String(existingVisualId).startsWith('temp_')) {
          await this.operationsQueue.enqueue({
            type: 'UPDATE_VISUAL',
            data: {
              visualId: existingVisualId,
              updateData: { Answers: '' }
            },
            dedupeKey: `update_visual_${existingVisualId}_${Date.now()}`,
            maxRetries: 3,
            onSuccess: () => {
              console.log(`[Visual Queue] Cleared multi-select for visual ${existingVisualId}`);
              this.savingItems[key] = false;
              this.changeDetectorRef.detectChanges();
            },
            onError: (error: any) => {
              console.error(`[Visual Queue] Failed to clear multi-select:`, error);
              this.showToast('Failed to clear selections. It will retry automatically.', 'warning');
              this.savingItems[key] = false;
              this.changeDetectorRef.detectChanges();
            }
          });
        }
        item.text = item.originalText || '';
      }
    } catch (error) {
      console.error('Error handling multi-select change:', error);
      await this.showToast('Failed to save selections', 'danger');
    } finally {
      if (!existingVisualId || String(existingVisualId).startsWith('temp_')) {
        this.savingItems[key] = false;
      }
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

  // Handler methods for "Other" option custom inputs
  async onTypeOfBuildingOtherChange() {
    if (this.typeOfBuildingOtherValue && this.typeOfBuildingOtherValue.trim()) {
      const customValue = this.typeOfBuildingOtherValue.trim();
      this.customOtherValues['TypeOfBuilding'] = customValue;
      // Save custom value to database directly, but keep dropdown showing "Other"
      this.autoSaveProjectField('TypeOfBuilding', customValue);
    }
  }

  async onStyleOtherChange() {
    if (this.styleOtherValue && this.styleOtherValue.trim()) {
      const customValue = this.styleOtherValue.trim();
      this.customOtherValues['Style'] = customValue;
      // Save custom value to database directly, but keep dropdown showing "Other"
      this.autoSaveProjectField('Style', customValue);
    }
  }

  async onOccupancyFurnishingsOtherChange() {
    if (this.occupancyFurnishingsOtherValue && this.occupancyFurnishingsOtherValue.trim()) {
      const customValue = this.occupancyFurnishingsOtherValue.trim();
      this.customOtherValues['OccupancyFurnishings'] = customValue;
      // Save custom value to database directly, but keep dropdown showing "Other"
      this.autoSaveServiceField('OccupancyFurnishings', customValue);
    }
  }

  async onWeatherConditionsOtherChange() {
    if (this.weatherConditionsOtherValue && this.weatherConditionsOtherValue.trim()) {
      const customValue = this.weatherConditionsOtherValue.trim();
      this.customOtherValues['WeatherConditions'] = customValue;
      // Save custom value to database directly, but keep dropdown showing "Other"
      this.autoSaveServiceField('WeatherConditions', customValue);
    }
  }

  async onOutdoorTemperatureOtherChange() {
    if (this.outdoorTemperatureOtherValue && this.outdoorTemperatureOtherValue.trim()) {
      const customValue = this.outdoorTemperatureOtherValue.trim();
      this.customOtherValues['OutdoorTemperature'] = customValue;
      // Save custom value to database directly, but keep dropdown showing "Other"
      this.autoSaveServiceField('OutdoorTemperature', customValue);
    }
  }

  async onFirstFoundationTypeOtherChange() {
    if (this.firstFoundationTypeOtherValue && this.firstFoundationTypeOtherValue.trim()) {
      const customValue = this.firstFoundationTypeOtherValue.trim();
      this.customOtherValues['FirstFoundationType'] = customValue;
      // Save custom value to database directly, but keep dropdown showing "Other"
      this.autoSaveServiceField('FirstFoundationType', customValue);
    }
  }

  async onSecondFoundationTypeOtherChange() {
    if (this.secondFoundationTypeOtherValue && this.secondFoundationTypeOtherValue.trim()) {
      const customValue = this.secondFoundationTypeOtherValue.trim();
      this.customOtherValues['SecondFoundationType'] = customValue;
      // Save custom value to database directly, but keep dropdown showing "Other"
      this.autoSaveServiceField('SecondFoundationType', customValue);
    }
  }

  async onThirdFoundationTypeOtherChange() {
    if (this.thirdFoundationTypeOtherValue && this.thirdFoundationTypeOtherValue.trim()) {
      const customValue = this.thirdFoundationTypeOtherValue.trim();
      this.customOtherValues['ThirdFoundationType'] = customValue;
      // Save custom value to database directly, but keep dropdown showing "Other"
      this.autoSaveServiceField('ThirdFoundationType', customValue);
    }
  }

  async onOwnerOccupantInterviewOtherChange() {
    if (this.ownerOccupantInterviewOtherValue && this.ownerOccupantInterviewOtherValue.trim()) {
      const customValue = this.ownerOccupantInterviewOtherValue.trim();
      this.customOtherValues['OwnerOccupantInterview'] = customValue;
      // Save custom value to database directly, but keep dropdown showing "Other"
      this.autoSaveServiceField('OwnerOccupantInterview', customValue);
    }
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
  
    
    
    
    
    
  // ========== End Second Foundation Rooms Multi-Select Methods ==========
  
  // ========== Third Foundation Rooms Multi-Select Methods ==========
  
    
    
    
    
    
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

      // Clear otherValue when "Other" is deselected
      if (option === 'Other') {
        item.otherValue = '';
        // Trigger change detection to hide the input field immediately
        this.changeDetectorRef.detectChanges();
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

  // Save visual selection to Services_LBW table
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
        const existingVisuals = await this.hudData.getVisualsByService(this.serviceId);
        if (existingVisuals) {
          const exists = existingVisuals.find((v: any) =>
            v.Category === category &&
            v.Name === template.Name
          );
          if (exists) {
            const existingId = exists.LBWID || exists.PK_ID || exists.id;
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

      const visualData: ServicesLbwRecord = {
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

      // OPTIMISTIC UI: Immediately assign temp ID
      this.visualRecordIds[key] = `temp_${Date.now()}`;
      this.savingItems[key] = true;
      this.changeDetectorRef.detectChanges();

      // Queue visual creation with retry logic
      const visualOpId = await this.operationsQueue.enqueue({
        type: 'CREATE_VISUAL',
        data: visualData,
        dedupeKey: `visual_${serviceIdNum}_${category}_${template.Name}`,
        maxRetries: 3,
        onSuccess: async (result: any) => {
          console.log(`[Visual Queue] Success for ${template.Name}:`, result.visualId);
          this.visualRecordIds[key] = result.visualId;
          localStorage.setItem(recordKey, result.visualId);
          this.savingItems[key] = false;
          delete this.pendingVisualCreates[key];

          // Process pending photo uploads
          await this.processPendingPhotoUploadsForKey(key);

          this.changeDetectorRef.detectChanges();
        },
        onError: (error: any) => {
          console.error(`[Visual Queue] Failed for ${template.Name}:`, error);
          delete this.visualRecordIds[key];
          delete this.selectedItems[key];
          this.savingItems[key] = false;
          localStorage.removeItem(recordKey);

          this.showToast(`Failed to create visual. It will retry automatically.`, 'warning');
          this.changeDetectorRef.detectChanges();
        }
      });

      console.log(`[Visual Queue] Queued visual creation for ${template.Name}, operation ID: ${visualOpId}`);
    } catch (error) {
      console.error('Error saving visual:', error);
      await this.showToast('Failed to save visual', 'danger');
    } finally {
      this.pendingVisualKeys.delete(key);
    }
  }
  
  // Remove visual selection from Services_LBW table
  async removeVisualSelection(category: string, templateId: string) {
    // Check if we have a stored record ID
    const recordKey = `visual_${category}_${templateId}`;
    const recordId = localStorage.getItem(recordKey);
    const key = `${category}_${templateId}`;
    delete this.visualRecordIds[key];
    delete this.pendingPhotoUploads[key];
    delete this.pendingVisualCreates[key];

    if (recordId === '__pending__' || String(recordId).startsWith('temp_')) {
      // Pending create was never synced or has temp ID; just clear the placeholder
      localStorage.removeItem(recordKey);
      this.pendingVisualKeys.delete(key);
      return;
    }

    if (recordId) {
      // Queue deletion with retry logic
      try {
        await this.operationsQueue.enqueue({
          type: 'DELETE_VISUAL',
          data: { visualId: recordId },
          dedupeKey: 'delete_visual_' + recordId + '_' + Date.now(),
          maxRetries: 3,
          onSuccess: () => {
            console.log('[Visual Queue] Deleted visual:', recordId);
            localStorage.removeItem(recordKey);
            this.changeDetectorRef.detectChanges();
          },
          onError: (error: any) => {
            console.error('[Visual Queue] Failed to delete visual:', error);
            this.showToast('Failed to delete visual. It will retry automatically.', 'warning');
          }
        });
      } catch (error) {
        console.error('Failed to queue visual removal:', error);
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
          <strong style="color: blue;">Ã°Å¸â€Â MULTI-SELECT CHANGE TRIGGERED</strong><br><br>
          
          <strong>Category:</strong> ${category}<br>
          <strong>Item Name:</strong> ${item.name}<br>
          <strong>Item ID:</strong> ${item.id}<br>
          <strong>Selected Options:</strong> <span style="color: green; font-weight: bold;">${item.selectedOptions?.join(', ') || 'NONE'}</span><br>
          <strong>Answers Text:</strong> ${answersText || 'EMPTY'}<br>
          <strong>Key:</strong> ${key}<br><br>
          
          <strong>Current State:</strong><br>
          Ã¢â‚¬Â¢ Existing Visual ID: ${this.visualRecordIds[key] || 'NONE - Will Create New'}<br>
          Ã¢â‚¬Â¢ Is Selected: ${this.selectedItems[key] ? 'YES' : 'NO'}<br>
          Ã¢â‚¬Â¢ Original Text: ${item.originalText || 'Not stored'}<br>
          Ã¢â‚¬Â¢ Current Text: ${item.text || 'Empty'}<br><br>
          
          <strong>Service Info:</strong><br>
          Ã¢â‚¬Â¢ Service ID: ${this.serviceId || 'MISSING!'}<br>
          Ã¢â‚¬Â¢ Project ID: ${this.projectId}<br><br>
          
          <strong>Dropdown Options Available:</strong><br>
          ${item.dropdownOptions ? item.dropdownOptions.join(', ') : 'No options loaded'}<br><br>
          
          <strong style="color: red;">ACTION TO TAKE:</strong><br>
          ${this.visualRecordIds[key] ? 
            'Ã¢Å“â€œ UPDATE existing record (VisualID: ' + this.visualRecordIds[key] + ')' : 
            (answersText ? 'Ã¢Å¾â€¢ CREATE new Services_LBW record' : 'Ã¢Å¡Â Ã¯Â¸Â No action - no selections')}<br>
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
            await this.caspioService.updateServicesLBW(existingVisualId, updateData).toPromise();
            
            // Show success debug
            const successAlert = await this.alertController.create({
              header: 'UPDATE SUCCESS',
              message: `
                <div style="font-family: monospace; font-size: 12px;">
                  <strong style="color: green;">Ã¢Å“â€¦ SUCCESSFULLY UPDATED</strong><br><br>
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
                  <strong style="color: red;">Ã¢ÂÅ’ UPDATE ERROR</strong><br><br>
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
                <strong style="color: blue;">Ã¢Å¾â€¢ CREATING Services_LBW</strong><br><br>
                
                <strong>Data to Send:</strong><br>
                Ã¢â‚¬Â¢ ServiceID: ${this.serviceId}<br>
                Ã¢â‚¬Â¢ Category: ${category}<br>
                Ã¢â‚¬Â¢ Name: ${item.name}<br>
                Ã¢â‚¬Â¢ Text: ${item.text}<br>
                Ã¢â‚¬Â¢ Answers: ${answersText}<br>
                Ã¢â‚¬Â¢ Kind: ${item.kind || 'Comment'}<br><br>
                
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
                  '<strong style="color: green;">Ã¢Å“â€¦ RECORD CREATED</strong><br><br>New Visual ID: ' + newVisualId :
                  '<strong style="color: red;">Ã¢ÂÅ’ NO RECORD CREATED</strong><br><br>Check saveVisualSelection method!'}
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
          await this.caspioService.updateServicesLBW(existingVisualId, updateData).toPromise();
          
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
            <strong style="color: red;">Ã¢ÂÅ’ ERROR OCCURRED</strong><br><br>
            
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

      // Radio buttons removed - Yes/No answer handled separately in UI
    } else if (item.answerType === 2) {
      // Dropdown from Services_LBW_Drop
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
      cssClass: 'custom-document-alert',
      inputs: inputs,
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Save',
          handler: (data) => {
            // For AnswerType 1 (Yes/No), only validate title field
            if (item.answerType === 1) {
              if (item.required && !data.title) {
                this.showToast('Please fill in the title field', 'warning');
                return false;
              }

              // Update the item with new values
              if (data.title !== item.name) {
                item.name = data.title;
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
        header: 'Ã¢Å¡Â Ã¯Â¸Â Visual Not Saved',
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
    
    // Removed FDF photo and room point context checks - properties and methods deleted
    // Check if this is for FDF photos
    // if (this.currentFDFPhotoContext) {
    //   // Handle single FDF photo
    //   if (files.length > 0) {
    //     await this.processFDFPhoto(files[0]);
    //   }
    //   // Clear file input
    //   if (this.fileInput && this.fileInput.nativeElement) {
    //     this.fileInput.nativeElement.value = '';
    //   }
    //   return;
    // }

    // Check if this is for room points or visuals
    // if (this.currentRoomPointContext) {
    //   await this.handleRoomPointFileSelect(files);
    //   return;
    // }
    
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

            // Reset camera flow state after annotation
            this.expectingCameraPhoto = false;
            this.setFileInputMode('library', { allowMultiple: true });
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
              console.error(`Ã¢ÂÅ’ Failed to upload file ${index + 1}:`, error);
              return { success: false, error };
            })
            .finally(() => {
              // Decrement upload counter after each upload completes
              this.uploadingPhotos[key] = Math.max(0, (this.uploadingPhotos[key] || 0) - 1);
              if (this.uploadingPhotos[key] === 0) {
                delete this.uploadingPhotos[key];
              }
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

        // Mark that changes have been made (enables Update button)
        this.markReportChanged();

        // Removed change detection to improve performance
      }
    } catch (error) {
      console.error('Ã¢Â�Å’ Error handling files:', error);
      await this.showToast('Failed to upload files', 'danger');

      // Clear upload tracking on error
      const key = `${category}_${itemId}`;
      this.uploadingPhotos[key] = Math.max(0, (this.uploadingPhotos[key] || 0) - files.length);
      if (this.uploadingPhotos[key] === 0) {
        delete this.uploadingPhotos[key];
      }
    } finally {
      // Reset file input value to allow same file selection
      if (this.fileInput && this.fileInput.nativeElement) {
        this.fileInput.nativeElement.value = '';
      }

      // CRITICAL FIX: Don't clear context immediately - let it persist for rapid captures
      // Context will be cleared on next different action or after a delay
      // Only reset file input attributes if not continuing with camera
      if (!this.expectingCameraPhoto) {
        // Clear any existing timer first
        if (this.contextClearTimer) {
          clearTimeout(this.contextClearTimer);
        }

        // Reset to default state after a short delay to allow rapid captures
        this.contextClearTimer = setTimeout(() => {
          if (this.fileInput && this.fileInput.nativeElement) {
            this.fileInput.nativeElement.removeAttribute('capture');
            this.fileInput.nativeElement.setAttribute('multiple', 'true');
          }
          // Clear context after delay to prevent interference with rapid captures
          this.currentUploadContext = null;
          this.contextClearTimer = null;
        }, 500);
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
      console.error('Ã¢ÂÅ’ Error capturing photo:', error);
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
      console.error('Ã¢ÂÅ’ Error selecting from gallery:', error);
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
      console.error('Ã¢ÂÅ’ Error selecting document:', error);
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
    // CRITICAL FIX: Don't treat temp_ IDs as pending - they're being created and will resolve
    const isPendingVisual = !actualVisualId || actualVisualId === '__pending__' || String(actualVisualId).startsWith('temp_');

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
        throw new Error(`Invalid LBWID: ${actualVisualId}`);
      }

      // Prepare debug information
      const allVisualIds = Object.entries(this.visualRecordIds)
        .map(([k, v]) => `${k}: ${v}`)
        .join('<br>');

      // Prepare the data that will be sent
      const dataToSend = {
        table: 'Services_LBW_Attach',
        fields: {
          LBWID: visualIdNum,
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
          '2. Create record with LBWID and Annotation (without Photo)',
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
          header: 'Services_LBW_Attach Upload Debug',
        message: `
          <div style="text-align: left; font-family: monospace; font-size: 12px;">
            <strong style="color: red;">Ã°Å¸â€Â DEBUG INFO:</strong><br>
            Ã¢â‚¬Â¢ Key: ${dataToSend.debug.key}<br>
            Ã¢â‚¬Â¢ Raw VisualID param: ${dataToSend.debug.rawVisualId}<br>
            Ã¢â‚¬Â¢ Stored for this key: ${dataToSend.debug.storedForKey}<br>
            Ã¢â‚¬Â¢ Using VisualID: <strong style="color: blue;">${dataToSend.debug.actualVisualId}</strong><br>
            Ã¢â‚¬Â¢ Parsed Number: <strong style="color: blue;">${dataToSend.debug.parsedNumber}</strong><br><br>
            
            <strong>All Stored Visual IDs:</strong><br>
            <div style="max-height: 100px; overflow-y: auto; background: #f0f0f0; padding: 5px;">
              ${dataToSend.debug.allStoredIds || 'None'}
            </div><br>
            
            <strong>Table:</strong> ${dataToSend.table}<br><br>
            
            <strong>Fields to Send:</strong><br>
            Ã¢â‚¬Â¢ LBWID: <strong style="color: red;">${dataToSend.fields.LBWID}</strong> (Integer)<br>
            Ã¢â‚¬Â¢ Annotation: "${dataToSend.fields.Annotation}" (Text)<br>
            Ã¢â‚¬Â¢ Photo: Will store file path after upload<br><br>
            
            <strong>File Info:</strong><br>
            Ã¢â‚¬Â¢ Name: ${dataToSend.fileInfo.name}<br>
            Ã¢â‚¬Â¢ Size: ${dataToSend.fileInfo.size}<br>
            Ã¢â‚¬Â¢ Type: ${dataToSend.fileInfo.type}<br><br>
            
            <strong>Upload Process:</strong><br>
            ${dataToSend.process.map(step => `Ã¢â‚¬Â¢ ${step}`).join('<br>')}
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
      console.error('Ã¢ÂÅ’ Failed to prepare upload:', error);
      await this.showToast('Failed to prepare photo upload', 'danger');
    }
  }

  // Process background upload queue with parallel uploads (max 2 at a time)
  private async processBackgroundUploadQueue() {
    // Process uploads while we have space and items in queue
    while (this.activeUploadCount < this.maxParallelUploads && this.backgroundUploadQueue.length > 0) {
      const uploadTask = this.backgroundUploadQueue.shift();
      if (uploadTask) {
        this.activeUploadCount++;

        console.log(`[Background Upload Queue] Starting upload (${this.activeUploadCount}/${this.maxParallelUploads} active, ${this.backgroundUploadQueue.length} queued)`);

        // Fire upload without awaiting - this allows parallel processing
        uploadTask()
          .catch(error => {
            console.error('[Background Upload Queue] Upload failed:', error);
          })
          .finally(() => {
            this.activeUploadCount--;
            console.log(`[Background Upload Queue] Upload completed (${this.activeUploadCount}/${this.maxParallelUploads} active, ${this.backgroundUploadQueue.length} queued)`);

            // Try to process next item in queue
            this.processBackgroundUploadQueue();
          });
      }
    }
  }

  // Separate method to perform the actual upload - REFACTORED for instant record creation
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
      let drawingsData = annotationData ? JSON.stringify(annotationData) : undefined;

      // STEP 1: Create attachment record IMMEDIATELY (no file upload yet)
      // This ensures unique AttachID is assigned instantly
      let response;
      try {
        response = await this.caspioService.createServicesLBWAttachRecord(
          visualIdNum,
          caption || '',
          drawingsData
        ).toPromise();

        console.log(`[Fast Upload] Created record instantly, AttachID: ${response.AttachID}`);

      } catch (createError: any) {
        console.error('Failed to create attachment record:', createError);
        await this.showToast('Failed to create photo record', 'danger');
        throw createError;
      }

      // STEP 2: Queue photo upload in background (serialized to avoid overwhelming API)
      // This allows rapid captures while uploads happen asynchronously ONE AT A TIME
      const attachId = response.AttachID;

      // Add upload task to queue
      this.backgroundUploadQueue.push(async () => {
        console.log(`[Fast Upload] Starting queued upload for AttachID: ${attachId}`);

        try {
          const uploadResponse = await this.caspioService.updateServicesLBWAttachPhoto(
            attachId,
            photo,
            originalPhoto || undefined
          ).toPromise();

          console.log(`[Fast Upload] Photo uploaded for AttachID: ${attachId}`);

          // CRITICAL: Run UI updates inside NgZone to ensure change detection
          this.ngZone.run(async () => {
            // Update the UI with the actual uploaded photo
            const keyPhotos = this.visualPhotos[key] || [];

            // Find photo by attachId (it was updated in Step 3 below)
            const tempPhotoIndex = keyPhotos.findIndex((p: any) => p.AttachID === attachId || p.id === attachId);

            console.log(`[Fast Upload] Found photo at index ${tempPhotoIndex} for AttachID: ${attachId}`);

            if (tempPhotoIndex !== -1) {
              const s3Key = uploadResponse?.Attachment; // S3 key
              const filePath = uploadResponse?.Photo || ''; // Old Caspio path
              let imageUrl = keyPhotos[tempPhotoIndex].url;

              // Check if this is an S3 image
              if (s3Key && this.caspioService.isS3Key(s3Key)) {
                try {
                  console.log('[Fast Upload] ✨ S3 image detected, fetching pre-signed URL...');
                  imageUrl = await this.caspioService.getS3FileUrl(s3Key);
                  console.log('[Fast Upload] ✅ Got S3 pre-signed URL');
                } catch (err) {
                  console.error('[Fast Upload] ❌ Failed to fetch S3 URL:', err);
                  imageUrl = 'assets/img/photo-placeholder.svg';
                }
              }
              // Fallback to old Caspio Files API
              else if (filePath) {
                try {
                  console.log('[Fast Upload] 📁 Caspio Files API path detected');
                  const imageData = await this.caspioService.getImageFromFilesAPI(filePath).toPromise();
                  if (imageData && imageData.startsWith('data:')) {
                    imageUrl = imageData;
                  }
                } catch (err) {
                  console.error('Failed to load uploaded image:', err);
                }
              }

              // Update photo with uploaded data - CLEAR uploading flag
              keyPhotos[tempPhotoIndex] = {
                ...keyPhotos[tempPhotoIndex],
                Photo: filePath,
                Attachment: s3Key,
                filePath: s3Key || filePath,
                url: imageUrl,
                thumbnailUrl: imageUrl,
                uploading: false  // CRITICAL: Clear the uploading flag
              };

              console.log(`[Fast Upload] UI updated, uploading flag cleared for AttachID: ${attachId}`);

              // Force change detection
              this.changeDetectorRef.detectChanges();
            } else {
              console.warn(`[Fast Upload] Could not find photo with AttachID: ${attachId} in visualPhotos[${key}]`);
            }
          });
        } catch (uploadError: any) {
          console.error('Photo upload failed (background):', uploadError);

          // If network error, queue for retry
          if (this.isRetryableError(uploadError)) {
            await this.operationsQueue.enqueue({
              type: 'UPLOAD_VISUAL_PHOTO_UPDATE',
              data: {
                attachId: attachId,
                file: photo,
                originalFile: originalPhoto
              },
              dedupeKey: 'visual_photo_update_' + attachId,
              maxRetries: 3
            });
          }
        }
      });

      // Start processing the queue (won't block - processes in background)
      this.processBackgroundUploadQueue();

      // Return immediately with the created record (photo upload continues in background)
      // This allows rapid photo captures without waiting for upload


      // Update the temp photo entry with the real AttachID immediately
      const keyPhotos = this.visualPhotos[key] || [];
      let tempPhotoIndex = -1;

      if (tempPhotoId) {
        tempPhotoIndex = keyPhotos.findIndex((p: any) => p.id === tempPhotoId || p.AttachID === tempPhotoId);
        console.log(`[Fast Upload] Looking for tempPhotoId: ${tempPhotoId}, found at index: ${tempPhotoIndex}`);
      }

      if (tempPhotoIndex !== -1) {
        // Update with real AttachID immediately
        keyPhotos[tempPhotoIndex] = {
          ...keyPhotos[tempPhotoIndex],
          AttachID: attachId,
          id: attachId,
          uploading: true,  // Still uploading in background
          queued: false  // CRITICAL: Clear queued flag
        };
        console.log(`[Fast Upload] Updated photo at index ${tempPhotoIndex} with AttachID: ${attachId}`);
      } else {
        console.warn(`[Fast Upload] Could not find photo with tempPhotoId: ${tempPhotoId} in visualPhotos[${key}] (${keyPhotos.length} photos)`);
      }

      this.changeDetectorRef.detectChanges();

      // Return immediately with the created record (photo upload continues in background)
      // This allows rapid photo captures without waiting for upload
      return response;

    } catch (error: any) {
      console.error('[performVisualPhotoUpload] ERROR:', error);
      await this.showToast('Failed to create photo record', 'danger');
      throw error;
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

  // [SKELETON] Check if photos are still loading for a visual
  isLoadingPhotosForVisual(category: string, itemId: string): boolean {
    const key = `${category}_${itemId}`;
    return this.loadingPhotosByKey[key] === true;
  }

  // [SKELETON] Get expected photo count for skeleton loaders
  getExpectedPhotoCount(category: string, itemId: string): number {
    const key = `${category}_${itemId}`;
    return this.photoCountsByKey[key] || 0;
  }

  // [SKELETON] Generate array for skeleton loader iteration
  getSkeletonArray(category: string, itemId: string): any[] {
    const count = this.getExpectedPhotoCount(category, itemId);
    return Array(count).fill({ isSkeleton: true });
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
        <text x="75" y="45" text-anchor="middle" fill="#999" font-family="Arial" font-size="14">Ã°Å¸â€œÂ·</text>
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

      const visualData: ServicesLbwRecord = {
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
        const response = await this.caspioService.createServicesLBW(visualData).toPromise();

        // Extract LBWID using the SAME logic as line 4744-4754
        let visualId: string | null = null;

        if (Array.isArray(response) && response.length > 0) {
          visualId = String(response[0].LBWID || response[0].PK_ID || response[0].id || '');
        } else if (response && typeof response === 'object') {
          if (response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
            visualId = String(response.Result[0].LBWID || response.Result[0].PK_ID || response.Result[0].id || '');
          } else {
            visualId = String(response.LBWID || response.PK_ID || response.id || '');
          }
        } else if (response) {
          visualId = String(response);
        }

        if (!visualId || visualId === 'undefined' || visualId === 'null' || visualId === '') {
          throw new Error('No LBWID returned from server');
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
        console.error('❌ Error creating custom visual:', error);
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
      
      const visualData: ServicesLbwRecord = {
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
        const response = await this.caspioService.createServicesLBW(visualData).toPromise();
        
        // Show debug popup with the response
        const debugAlert = await this.alertController.create({
          header: 'Custom Visual Creation Response',
          message: `
            <div style="text-align: left; font-family: monospace; font-size: 12px;">
              <strong style="color: green;">Ã¢Å“â€¦ VISUAL CREATED SUCCESSFULLY</strong><br><br>
              
              <strong>Response from Caspio:</strong><br>
              <div style="background: #f0f0f0; padding: 10px; border-radius: 5px; max-height: 200px; overflow-y: auto;">
                ${JSON.stringify(response, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
              </div><br>
              
              <strong style="color: blue;">Key Fields:</strong><br>
              Ã¢â‚¬Â¢ LBWID (PRIMARY): <strong style="color: green;">${response?.LBWID || 'NOT FOUND'}</strong><br>
              Ã¢â‚¬Â¢ PK_ID: ${response?.PK_ID || 'N/A'}<br>
              Ã¢â‚¬Â¢ ServiceID: ${response?.ServiceID || 'N/A'}<br>
              Ã¢â‚¬Â¢ Category: ${response?.Category || 'N/A'}<br>
              Ã¢â‚¬Â¢ Kind: ${response?.Kind || 'N/A'}<br>
              Ã¢â‚¬Â¢ Name: ${response?.Name || 'N/A'}<br><br>

              <strong>Will be stored as:</strong><br>
              Ã¢â‚¬Â¢ Key: ${category}_${response?.LBWID || response?.PK_ID || Date.now()}<br>
              Ã¢â‚¬Â¢ LBWID for photos: <strong style="color: green;">${response?.LBWID || response?.PK_ID || 'MISSING!'}</strong>
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

        // Use LBWID from response, NOT PK_ID
        const visualId = response?.LBWID || response?.PK_ID || Date.now().toString();
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

        // Store the visual ID for photo uploads - use LBWID from response!
        const key = `${category}_${customItem.id}`;
        this.visualRecordIds[key] = String(response?.LBWID || response?.PK_ID || customItem.id);
        
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
        console.error('Ã¢ÂÅ’ Invalid AttachID:', attachId);
        
        // Show debug popup with detailed error info
        const alert = await this.alertController.create({
          header: 'Ã¢ÂÅ’ Debug: Invalid AttachID',
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
              Ã¢â‚¬Â¢ Name: ${file?.name || 'N/A'}<br>
              Ã¢â‚¬Â¢ Size: ${file?.size || 0} bytes<br><br>
              
              <strong>Has Annotations:</strong> ${!!annotations}<br>
              <strong>Has Original File:</strong> ${!!originalFile}<br><br>
              
              <strong style="color: orange;">This error typically occurs when:</strong><br>
              Ã¢â‚¬Â¢ Photo was loaded but AttachID wasn't preserved<br>
              Ã¢â‚¬Â¢ Photo object is missing ID fields<br>
              Ã¢â‚¬Â¢ Database didn't return AttachID<br><br>
              
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
              console.error('  Ã¢Å¡Â Ã¯Â¸Â Warning: JSON validation failed, but continuing');
            }
          } catch (e) {
            console.error('  Ã¢ÂÅ’ Failed to stringify Fabric.js object:', e);
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
            console.error('  Ã¢ÂÅ’ Failed to stringify:', e);
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
              console.error('Ã¢ÂÅ’ [v1.4.346] Canvas too complex:', drawingsData.length, 'bytes');
              console.error('  The CURRENT canvas state exceeds 64KB even after compression');
              console.error('  This is NOT an accumulation issue - the canvas has too many annotations');
              
              // Show error to user
              const alert = await this.alertController.create({
                header: 'Ã¢ÂÅ’ Annotation Too Complex',
                message: `
                  <div style="font-family: monospace; font-size: 12px;">
                    <strong>The annotation data is too large to save.</strong><br><br>
                    
                    Data size: ${drawingsData.length.toLocaleString()} bytes<br>
                    Maximum: 64,000 bytes<br><br>
                    
                    <strong>Solutions:</strong><br>
                    Ã¢â‚¬Â¢ Reduce the number of annotations<br>
                    Ã¢â‚¬Â¢ Use simpler shapes (lines instead of complex paths)<br>
                    Ã¢â‚¬Â¢ Clear and redraw with fewer strokes<br>
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
            console.warn('  Ã¢Å¡Â Ã¯Â¸Â Could not re-parse for cleaning, using as-is');
          }
          
          if (originalLength !== drawingsData.length) {
          }
          
          // CRITICAL: Ensure it's definitely a string
          if (typeof drawingsData !== 'string') {
            console.error('  Ã¢ÂÅ’ CRITICAL ERROR: drawingsData is not a string after processing!');
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
        header: 'Ã°Å¸â€Â [v1.4.351] Debug: Annotation Update',
        message: `
          <div style="font-family: monospace; font-size: 12px; text-align: left;">
            <strong style="color: blue;">UPDATE ATTACHMENT - v1.4.351</strong><br><br>
            
            <strong>AttachID:</strong> <span style="color: green;">${attachId}</span><br>
            <strong>AttachID Type:</strong> ${typeof attachId}<br><br>
            
            <strong>Update Data:</strong><br>
            Ã¢â‚¬Â¢ Drawings field: ${updateData.Drawings ? 'YES' : 'NO'}<br>
            Ã¢â‚¬Â¢ Drawings type: ${typeof updateData.Drawings}<br>
            Ã¢â‚¬Â¢ Drawings is string: ${typeof updateData.Drawings === 'string'}<br>
            Ã¢â‚¬Â¢ Drawings length: ${updateData.Drawings?.length || 0} chars<br>
            Ã¢â‚¬Â¢ Annotations: ${annotationSummary}<br>
            Ã¢â‚¬Â¢ Drawings preview: ${updateData.Drawings ? updateData.Drawings.substring(0, 100) + '...' : 'N/A'}<br><br>
            
            <strong>File Info:</strong><br>
            Ã¢â‚¬Â¢ Name: ${file?.name || 'N/A'}<br>
            Ã¢â‚¬Â¢ Size: ${file?.size || 0} bytes<br>
            Ã¢â‚¬Â¢ Type: ${file?.type || 'N/A'}<br><br>
            
            <strong>Original File:</strong> ${originalFile ? originalFile.name : 'None'}<br><br>
            
            <strong>API Call:</strong><br>
            Ã¢â‚¬Â¢ Table: Services_LBW_Attach<br>
            Ã¢â‚¬Â¢ Method: PUT (update)<br>
            Ã¢â‚¬Â¢ Where: AttachID=${attachId}<br><br>
            
            <strong style="color: orange;">What happens next:</strong><br>
            1. Update Services_LBW_Attach.Drawings field<br>
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
        console.warn('Ã¢Å¡Â Ã¯Â¸Â No data to update - updateData is empty');
        // Toast removed - silent return
        return;
      }
      
      // CRITICAL: Ensure Drawings field is properly formatted
      if (updateData.Drawings !== undefined) {
        // Make absolutely sure it's a string
        if (typeof updateData.Drawings !== 'string') {
          console.error('Ã¢ÂÅ’ CRITICAL: Drawings field is not a string!');
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
          console.warn('Ã¢Å¡Â Ã¯Â¸Â WARNING: Drawings field is very long:', updateData.Drawings.length, 'characters');
          console.warn('  This might cause issues with Caspio');
        }
      }
      
      // Check each field in updateData
      for (const key in updateData) {
        const value = updateData[key];
        
        // CRITICAL: Ensure all values are strings for Caspio TEXT fields
        if (typeof value !== 'string' && value !== null && value !== undefined) {
          console.error(`Ã¢ÂÅ’ Field "${key}" is not a string! Type: ${typeof value}`);
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
          header: 'Ã°Å¸â€œÂ¤ Debug: About to Update',
          message: `
            <div style="font-family: monospace; font-size: 10px; text-align: left;">
              <strong style="color: blue;">PRE-UPDATE DATA CHECK</strong><br><br>
              
              <strong>AttachID:</strong> ${attachId} (${typeof attachId})<br><br>
              
              <strong>Drawings Field Analysis:</strong><br>
              Ã¢â‚¬Â¢ Length: <span style="color: ${drawingsInfo.length > 10000 ? 'red' : drawingsInfo.length > 5000 ? 'orange' : 'green'};">${drawingsInfo.length} chars</span><br>
              Ã¢â‚¬Â¢ Type: ${drawingsInfo.type}<br>
              Ã¢â‚¬Â¢ Contains blob URL: <span style="color: ${drawingsInfo.containsBlob ? 'orange' : 'green'};">${drawingsInfo.containsBlob ? 'YES Ã¢Å¡Â Ã¯Â¸Â' : 'NO Ã¢Å“â€¦'}</span><br>
              Ã¢â‚¬Â¢ Escaped quotes: ${drawingsInfo.containsEscapedQuotes ? 'YES Ã¢Å¡Â Ã¯Â¸Â' : 'NO'}<br>
              Ã¢â‚¬Â¢ Double backslash: <span style="color: ${drawingsInfo.containsDoubleBackslash ? 'red' : 'green'};">${drawingsInfo.containsDoubleBackslash ? 'YES Ã¢ÂÅ’' : 'NO Ã¢Å“â€¦'}</span><br><br>
              
              <strong>First 300 chars:</strong><br>
              <div style="background: #f0f0f0; padding: 5px; font-size: 9px; overflow-wrap: break-word; max-height: 100px; overflow-y: auto;">
                ${drawingsInfo.first300.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
              </div><br>
              
              <strong>Last 200 chars:</strong><br>
              <div style="background: #f0f0f0; padding: 5px; font-size: 9px; overflow-wrap: break-word; max-height: 100px; overflow-y: auto;">
                ${drawingsInfo.last200.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
              </div><br>
              
              <strong style="color: orange;">Potential Issues:</strong><br>
              ${drawingsInfo.length > 10000 ? 'Ã¢â‚¬Â¢ Very long string (>10KB)<br>' : ''}
              ${drawingsInfo.containsBlob ? 'Ã¢â‚¬Â¢ Contains blob URLs (invalid after reload)<br>' : ''}
              ${drawingsInfo.containsDoubleBackslash ? 'Ã¢â‚¬Â¢ Double-escaped backslashes detected<br>' : ''}
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

      // Clear PDF cache so changes show immediately
      this.clearPDFCache();

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
      console.error('Ã¢ÂÅ’ Failed to update photo attachment:', error);
      
      // Show detailed error debug popup
      const errorAlert = await this.alertController.create({
        header: 'Ã¢ÂÅ’ Update Failed - Error Details',
        message: `
          <div style="font-family: monospace; font-size: 11px; text-align: left;">
            <strong style="color: red;">UPDATE FAILED - DETAILED ERROR</strong><br><br>
            
            <strong>Error Message:</strong><br>
            <span style="color: red;">${error?.message || 'Unknown error'}</span><br><br>
            
            <strong>Error Type:</strong> ${error?.name || typeof error}<br>
            <strong>Error Code:</strong> ${error?.code || 'N/A'}<br>
            <strong>Status:</strong> ${error?.status || 'N/A'}<br><br>
            
            <strong>Request Details:</strong><br>
            Ã¢â‚¬Â¢ AttachID Used: ${attachId}<br>
            Ã¢â‚¬Â¢ AttachID Type: ${typeof attachId}<br>
            Ã¢â‚¬Â¢ Has Annotations: ${!!annotations}<br>
            Ã¢â‚¬Â¢ File Name: ${file?.name || 'N/A'}<br>
            Ã¢â‚¬Â¢ File Size: ${file?.size || 'N/A'} bytes<br><br>
            
            <strong>Response Info:</strong><br>
            Ã¢â‚¬Â¢ Status Text: ${error?.statusText || 'N/A'}<br>
            Ã¢â‚¬Â¢ Response Body: ${JSON.stringify(error?.error || error?.response || {}, null, 2).substring(0, 300)}...<br><br>
            
            <strong>Stack Trace:</strong><br>
            <pre style="font-size: 10px; overflow-x: auto;">${error?.stack?.substring(0, 500) || 'No stack trace'}</pre><br>
            
            <strong style="color: orange;">Common Causes:</strong><br>
            Ã¢â‚¬Â¢ Invalid AttachID (record doesn't exist)<br>
            Ã¢â‚¬Â¢ API token expired<br>
            Ã¢â‚¬Â¢ Network connectivity issue<br>
            Ã¢â‚¬Â¢ Caspio API error<br>
            Ã¢â‚¬Â¢ Missing permissions<br><br>
            
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

      const imageUrl = latestPhoto.url || latestPhoto.thumbnailUrl || 'assets/img/photo-placeholder.svg';
      const photoName = latestPhoto.name || 'Photo';
      // Save scroll position before opening modal (for both mobile and web)
      const scrollPosition = window.scrollY || document.documentElement.scrollTop;

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

      // DISABLED: No auto-scrolling per user request
      // window.scrollTo(0, scrollPosition);

      if (!data) {
        return; // User cancelled
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

      // Trigger change detection to update UI
      this.changeDetectorRef.detectChanges();
      // Note: Scroll already restored immediately after modal.onDidDismiss() at line ~11240

    } catch (error) {
      console.error('Error in quickAnnotate:', error);
      await this.showToast('Failed to open annotator', 'danger');
    }
  }


  // Save scroll position on mousedown (BEFORE click event processes)
  saveScrollBeforePhotoClick(event: Event): void {
    // CRITICAL: Get scroll from ion-content, NOT window!
    const ionContent = document.querySelector('ion-content');
    const scrollElement = ionContent?.shadowRoot?.querySelector('.inner-scroll') || 
                          ionContent?.querySelector('.inner-scroll') || 
                          document.documentElement;
    
    this.preClickScrollY = (scrollElement as any)?.scrollTop || window.scrollY;
    this.preClickScrollX = (scrollElement as any)?.scrollLeft || window.scrollX;
    
    console.log('-------------------------------------------');
    console.log('[MOUSEDOWN] Saved scroll BEFORE click - Y:', this.preClickScrollY);
    console.log('[MOUSEDOWN] window.scrollY:', window.scrollY);
    console.log('[MOUSEDOWN] ion-content scrollTop:', (scrollElement as any)?.scrollTop);
    console.log('[MOUSEDOWN] document.documentElement.scrollTop:', document.documentElement.scrollTop);
    console.log('[MOUSEDOWN] Scroll element:', scrollElement?.tagName || scrollElement?.className);
    console.log('-------------------------------------------');
  }

  // View photo - open viewer with integrated annotation
  async viewPhoto(photo: any, category: string, itemId: string, event?: Event) {
    // CRITICAL: Prevent default and stop propagation FIRST
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
    
    try {
      // CRITICAL: Use pre-click scroll position (saved on mousedown)
      this.lockedScrollY = this.preClickScrollY || window.scrollY;
      this.lockedScrollX = this.preClickScrollX || window.scrollX;
      console.log('[viewPhoto] Using scroll position from mousedown - Y:', this.lockedScrollY);
      console.log('[viewPhoto] Current window.scrollY:', window.scrollY);
      
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
      const imageUrl = photo.url || photo.thumbnailUrl || 'assets/img/photo-placeholder.svg';
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

      // DISABLED: No auto-scrolling per user request - removed ALL scroll manipulation

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
              // CRITICAL FIX: Create NEW photo object for immutable update (OnPush optimization)
              // This prevents full component re-render and scroll jumping
              const newUrl = URL.createObjectURL(data.annotatedBlob);
              const currentPhoto = this.visualPhotos[key][photoIndex];
              
              // Keep thumbnailUrl logic
              const currentThumbnail = currentPhoto.thumbnailUrl;
              const isPlaceholder = currentThumbnail === this.photoPlaceholder || currentThumbnail?.includes('photo-placeholder');
              const isBlob = currentThumbnail?.startsWith('blob:');
              const isValidBase64 = currentThumbnail?.startsWith('data:');
              
              let updatedThumbnail = currentThumbnail;
              if (!currentThumbnail || isPlaceholder || isBlob || !isValidBase64) {
                const validUrl = currentPhoto.url;
                if (validUrl && validUrl.startsWith('data:')) {
                  updatedThumbnail = validUrl;
                } else {
                  updatedThumbnail = newUrl;
                }
              }
              
              // Create NEW photo object (immutable update for OnPush)
              this.visualPhotos[key][photoIndex] = {
                ...currentPhoto,
                originalUrl: currentPhoto.originalUrl || currentPhoto.url,
                displayUrl: newUrl,
                thumbnailUrl: updatedThumbnail,
                hasAnnotations: true,
                caption: data.caption !== undefined ? data.caption : currentPhoto.caption,
                Annotation: data.caption !== undefined ? data.caption : currentPhoto.Annotation,
                annotations: annotationsData || currentPhoto.annotations,
                rawDrawingsString: annotationsData 
                  ? (typeof annotationsData === 'object' ? JSON.stringify(annotationsData) : annotationsData)
                  : currentPhoto.rawDrawingsString
              };
              
              // Create NEW array reference for OnPush change detection
              this.visualPhotos[key] = [...this.visualPhotos[key]];
            }
            
            // Success toast removed per user request

            // Trigger change detection to update UI (OnPush will detect new array reference)
            this.changeDetectorRef.detectChanges();
          } catch (error) {
            await this.showToast('Failed to update photo', 'danger');
          }
        }
      }
      // Note: Scroll already restored immediately after modal.onDidDismiss() at line ~11424

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

                  // Clear PDF cache so deletion shows immediately
                  this.clearPDFCache();

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
    // CRITICAL: Clear any pending context-clearing timer from previous photo
    if (this.contextClearTimer) {
      clearTimeout(this.contextClearTimer);
      this.contextClearTimer = null;
    }

    this.currentUploadContext = {
      category,
      itemId,
      action: 'add'
    };

    this.triggerFileInput('camera', { allowMultiple: false });
  }

  // Add photo from gallery (structural systems) - SUPPORTS MULTIPLE SELECTIONS
  async addPhotoFromGallery(category: string, itemId: string) {
    // Set upload context
    this.currentUploadContext = {
      category,
      itemId,
      action: 'add'
    };

    // Trigger file input with multiple selection enabled
    // This allows users to select multiple photos from their gallery at once
    this.triggerFileInput('system', { allowMultiple: true });
  }

  // Take FDF photo directly from camera
    // Take FDF photo from gallery
    // Capture point photo directly from camera
    // Capture point photo from gallery
    // Helper method to select and process gallery photo for elevation point
    
  // Save caption to the Annotation field in Services_LBW_Attach table
  async saveCaption(photo: any, category: string, itemId: string) {
    try {
      // Only save if there's an AttachID and the caption has changed
      if (!photo.AttachID) {
        console.warn('No AttachID for photo, cannot save caption');
        return;
      }

      // Update the Services_LBW_Attach record with the new caption
      const updateData = {
        Annotation: photo.caption || ''  // Save caption or empty string
      };

      await this.caspioService.updateServicesLBWAttach(photo.AttachID, updateData).toPromise();

      // CRITICAL: Update Annotation field locally to match what was saved
      photo.Annotation = photo.caption || '';

      // Clear PDF cache so changes show immediately
      this.clearPDFCache();

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
    
  // Save caption for FDF photos (Top, Bottom, Threshold in Elevation Plot)
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

  /**
   * Escape HTML characters to prevent XSS (web only)
   */
  private escapeHtml(text: string): string {
    if (!environment.isWeb) return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

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

    // Use requestAnimationFrame for faster rendering (web only with XSS protection)
    if (environment.isWeb) {
      requestAnimationFrame(() => {
        const alertElement = document.querySelector('.caption-popup-alert .alert-message');
        if (!alertElement) return;

        // Escape caption to prevent XSS
        const escapedCaption = this.escapeHtml(tempCaption);

        alertElement.innerHTML = `
          <div class="caption-popup-content">
            <div class="caption-input-container" style="position: relative; margin-bottom: 16px;">
              <input type="text" id="captionInput" class="caption-text-input"
                     placeholder="Enter caption..."
                     value="${escapedCaption}"
                     maxlength="255"
                     style="width: 100%; padding: 14px 54px 14px 14px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; color: #333; background: white; box-sizing: border-box; height: 52px;" />
              <button type="button" id="undoCaptionBtn" class="undo-caption-btn" title="Undo Last Word"
                      style="position: absolute; right: 5px; top: 5px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; z-index: 10;">
                <ion-icon name="backspace-outline" style="font-size: 20px; color: #666;"></ion-icon>
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
      });
    }
  }

  // Open caption popup for FDF photos
    // Open caption popup for room point photos
    // Open caption popup for room photos (in Elevation Plot - old style)
    
  // Verify if visual was actually saved - v1.4.225 - FORCE REBUILD
  async verifyVisualSaved(category: string, templateId: string): Promise<boolean> {
    try {
      const visuals = await this.hudData.getVisualsByService(this.serviceId);
      
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
      visualIdFromResponse = response[0].LBWID || 'Not found';
      pkId = response[0].PK_ID || 'Not found';
      extractedId = response[0].LBWID || response[0].PK_ID || response[0].id || 'Not found in array';
    } else if (response && typeof response === 'object') {
      if (response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
        responseType = 'Object with Result array';
        visualIdFromResponse = response.Result[0].LBWID || 'Not found';
        pkId = response.Result[0].PK_ID || 'Not found';
        extractedId = response.Result[0].LBWID || response.Result[0].PK_ID || response.Result[0].id || 'Not found in Result';
      } else {
        responseType = 'Direct Object';
        visualIdFromResponse = response.LBWID || 'Not found';
        pkId = response.PK_ID || 'Not found';
        extractedId = response.LBWID || response.PK_ID || response.id || 'Not found in object';
      }
    } else {
      responseType = 'Direct ID';
      extractedId = response;
    }

    // Get all existing visuals for comparison
    let existingVisuals: Array<{id: any, name: string, category: string}> = [];
    try {
      const visuals = await this.hudData.getVisualsByService(this.serviceId);
      if (visuals && Array.isArray(visuals)) {
        existingVisuals = visuals.map(v => ({
          id: v.LBWID || v.PK_ID || v.id,
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
          <strong style="color: red;">Ã°Å¸â€Â VISUAL CREATION RESPONSE:</strong><br><br>
          
          <strong>Key:</strong> ${key}<br>
          <strong>Category:</strong> ${category}<br>
          <strong>Template ID:</strong> ${templateId}<br><br>
          
          <strong>Response Type:</strong> ${responseType}<br>
          <strong>Raw Response:</strong><br>
          <div style="background: #f0f0f0; padding: 5px; max-height: 150px; overflow-y: auto;">
            ${JSON.stringify(response, null, 2)}
          </div><br>
          
          <strong style="color: red;">Ã¢Å¡Â Ã¯Â¸Â ID FIELDS FROM RESPONSE:</strong><br>
          Ã¢â‚¬Â¢ <strong>VisualID:</strong> ${visualIdFromResponse} <span style="color: green;">(Ã¢Å“â€œ CORRECT - USE THIS)</span><br>
          Ã¢â‚¬Â¢ <strong>PK_ID:</strong> ${pkId} <span style="color: red;">(Ã¢Å“â€” WRONG - DO NOT USE)</span><br><br>
          
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
      const visuals = await this.hudData.getVisualsByService(this.serviceId);
      
      if (visuals && Array.isArray(visuals)) {
        // Find the visual we just created
        const templateName = this.categoryData[category]?.[templateId]?.name;
        
        const ourVisual = visuals.find(v => 
          v.Category === category && 
          v.Name === templateName
        );
        
        if (ourVisual) {
          const visualId = ourVisual.LBWID || ourVisual.PK_ID || ourVisual.id;
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

    // [SKELETON] First pass: Get photo counts for skeleton loaders
    const countPromises = Object.keys(this.visualRecordIds).map(async key => {
      const rawVisualId = this.visualRecordIds[key];
      const visualId = String(rawVisualId);

      if (visualId && visualId !== 'undefined' && !visualId.startsWith('temp_')) {
        this.loadingPhotosByKey[key] = true; // Mark as loading
        try {
          const attachments = await this.hudData.getVisualAttachments(rawVisualId);
          this.photoCountsByKey[key] = Array.isArray(attachments) ? attachments.length : 0;
        } catch (error) {
          this.photoCountsByKey[key] = 0;
        }
      }
    });

    // Wait for counts, then trigger UI update to show skeleton loaders
    await Promise.all(countPromises);
    this.changeDetectorRef.detectChanges(); // Show skeleton loaders

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
      const attachments = await this.hudData.getVisualAttachments(rawVisualId);

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

      // [SKELETON] Clear loading state when done
      this.loadingPhotosByKey[key] = false;

      // Trigger change detection with OnPush strategy
      this.changeDetectorRef.detectChanges();
    } catch (error) {
      console.error(`[v1.4.387] Failed to load photos for KEY ${key}:`, error);
      this.visualPhotos[key] = [];
      this.loadingPhotosByKey[key] = false; // Clear loading state on error
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
      hasPhoto: !!filePath,
      uploading: false,  // CRITICAL: Explicitly set to false to match newly uploaded photos
      queued: false      // CRITICAL: Explicitly set to false to match newly uploaded photos
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
        message: ' ',
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

    // If "Other" is selected, wait for user to fill in the inline input field
    // The blur handler will call this method again with the custom value
    if (value === 'Other') {
      return; // Don't save yet - wait for inline input
    }

    // Mark that changes have been made (enables Update button)
    this.markReportChanged();

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

    // Skip for multi-select fields (they have inline inputs handled separately)
    const multiSelectFields = ['InAttendance', 'SecondFoundationRooms', 'ThirdFoundationRooms'];
    const isMultiSelect = multiSelectFields.includes(fieldName);

    // If "Other" is selected for single-select dropdowns, wait for inline input
    // The blur handler will call this method again with the custom value
    if (value === 'Other' && !isMultiSelect) {
      return; // Don't save yet - wait for inline input
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
    // Use PK_ID from loaded project data for API updates (matches mobile app pattern)
    const projectIdForUpdate = this.projectData?.PK_ID || this.projectId;
    this.caspioService.updateProject(projectIdForUpdate, { [fieldName]: value }).subscribe({
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
      console.error(`Ã¢Å¡Â Ã¯Â¸Â Cannot save ${fieldName} - No ServiceID! ServiceID is: ${this.serviceId}`);
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
      
      // Property Details (from actual form inputs) - Replace "Other" with custom values
      yearBuilt: this.projectData?.YearBuilt || '',
      squareFeet: this.projectData?.SquareFeet || '',
      typeOfBuilding: this.projectData?.TypeOfBuilding === 'Other' && this.typeOfBuildingOtherValue
        ? this.typeOfBuildingOtherValue
        : (this.projectData?.TypeOfBuilding || ''),
      style: this.projectData?.Style === 'Other' && this.styleOtherValue
        ? this.styleOtherValue
        : (this.projectData?.Style || ''),
      occupancyFurnishings: this.serviceData?.OccupancyFurnishings === 'Other' && this.occupancyFurnishingsOtherValue
        ? this.occupancyFurnishingsOtherValue
        : (this.serviceData?.OccupancyFurnishings || ''),

      // Environmental Conditions (from actual form inputs) - Replace "Other" with custom values
      weatherConditions: this.serviceData?.WeatherConditions === 'Other' && this.weatherConditionsOtherValue
        ? this.weatherConditionsOtherValue
        : (this.serviceData?.WeatherConditions || ''),
      outdoorTemperature: this.serviceData?.OutdoorTemperature === 'Other' && this.outdoorTemperatureOtherValue
        ? this.outdoorTemperatureOtherValue
        : (this.serviceData?.OutdoorTemperature || ''),
      
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
    console.log('[PDF] ========== prepareStructuralSystemsData START ==========');
    console.log('[PDF] ServiceID:', this.serviceId);
    
    const result = [];
    
    // CRITICAL FIX: Fetch data directly from database instead of relying on in-memory state
    // This ensures PDF always shows the latest data, even when selections were made on category detail pages
    console.log('[PDF] Fetching HUD records directly from database (bypassing cache)...');
    const allVisuals = await this.hudData.getVisualsByService(this.serviceId, true); // bypass cache
    
    console.log('[PDF] Total HUD records from database:', allVisuals?.length || 0);
    if (allVisuals && allVisuals.length > 0) {
      console.log('[PDF] Sample record:', JSON.stringify(allVisuals[0], null, 2));
    } else {
      console.warn('[PDF] ?? NO HUD RECORDS FOUND IN DATABASE!');
    }
    
    // Dynamically organize visuals by category from the database
    const organizedFromDb: { [category: string]: { comments: any[], limitations: any[], deficiencies: any[] } } = {};
    const categoryOrder: string[] = [];
    
    for (const visual of allVisuals || []) {
      const category = visual.Category || 'Other';
      const kind = visual.Kind || visual.Type || 'Comment';
      
      // Skip hidden visuals (soft deleted)
      if (visual.Notes && visual.Notes.startsWith('HIDDEN')) {
        console.log('[PDF] Skipping hidden visual:', visual.Name);
        continue;
      }
      
      // Initialize category if not present
      if (!organizedFromDb[category]) {
        organizedFromDb[category] = { comments: [], limitations: [], deficiencies: [] };
        categoryOrder.push(category);
      }
      
      // Add to appropriate type array
      if (kind === 'Comment') {
        organizedFromDb[category].comments.push(visual);
      } else if (kind === 'Limitation') {
        organizedFromDb[category].limitations.push(visual);
      } else if (kind === 'Deficiency') {
        organizedFromDb[category].deficiencies.push(visual);
      } else {
        console.warn('[PDF] Unknown Kind:', kind, 'for visual:', visual.Name, '- defaulting to Comment');
        organizedFromDb[category].comments.push(visual);
      }
    }
    
    console.log('[PDF] Categories found:', categoryOrder);
    console.log('[PDF] Organized data summary:', Object.keys(organizedFromDb).map(cat => 
      `${cat}: ${organizedFromDb[cat].comments.length}C/${organizedFromDb[cat].limitations.length}L/${organizedFromDb[cat].deficiencies.length}D`
    ));
    
    // Process each category from database
    for (const category of categoryOrder) {
      const categoryData = organizedFromDb[category];
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
      
      // Process comments from database
      for (const visual of categoryData.comments) {
        const LBWID = visual.LBWID || visual.PK_ID;
        const displayText = visual.Text || '';
        const answers = visual.Answers || '';
        
        console.log('[PDF] Processing Comment:', visual.Name, 'LBWID:', LBWID);
        
        photoFetches.push(this.getVisualPhotos(LBWID, category, LBWID));
        photoMappings.push({
          type: 'comments',
          item: {
            name: visual.Name || '',
            text: displayText,
            answers: answers,
            visualId: LBWID
          },
          index: photoFetches.length - 1
        });
      }
      
      // Process limitations from database
      for (const visual of categoryData.limitations) {
        const LBWID = visual.LBWID || visual.PK_ID;
        const displayText = visual.Text || '';
        const answers = visual.Answers || '';
        
        console.log('[PDF] Processing Limitation:', visual.Name, 'LBWID:', LBWID);
        
        photoFetches.push(this.getVisualPhotos(LBWID, category, LBWID));
        photoMappings.push({
          type: 'limitations',
          item: {
            name: visual.Name || '',
            text: displayText,
            answers: answers,
            visualId: LBWID
          },
          index: photoFetches.length - 1
        });
      }
      
      // Process deficiencies from database
      for (const visual of categoryData.deficiencies) {
        const LBWID = visual.LBWID || visual.PK_ID;
        const displayText = visual.Text || '';
        const answers = visual.Answers || '';
        
        console.log('[PDF] Processing Deficiency:', visual.Name, 'LBWID:', LBWID);
        
        photoFetches.push(this.getVisualPhotos(LBWID, category, LBWID));
        photoMappings.push({
          type: 'deficiencies',
          item: {
            name: visual.Name || '',
            text: displayText,
            answers: answers,
            visualId: LBWID
          },
          index: photoFetches.length - 1
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
      
      // Only add category if it has items
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

    // MOBILE DEBUG: Show overall photo loading summary
    const isMobile = this.platform.isIOS() || this.platform.isAndroid();
    if (isMobile) {
      // Calculate total photos and failures across all categories
      let totalPhotos = 0;
      let totalSuccessful = 0;
      let totalFailed = 0;

      result.forEach(category => {
        const allItems = [...category.comments, ...category.limitations, ...category.deficiencies];
        allItems.forEach(item => {
          if (item.photos && Array.isArray(item.photos)) {
            totalPhotos += item.photos.length;
            item.photos.forEach((photo: any) => {
              if (photo.conversionSuccess) {
                totalSuccessful++;
              } else {
                totalFailed++;
              }
            });
          }
        });
      });

      if (totalFailed > 0) {
        setTimeout(async () => {
          const alert = await this.alertController.create({
            header: '?? Structural Systems Photos',
            message: `
              <div style="font-family: monospace; font-size: 12px; text-align: left;">
                <strong style="color: ${totalFailed > 0 ? 'orange' : 'green'};">Photo Loading Summary</strong><br><br>

                Total Photos: ${totalPhotos}<br>
                ? Loaded: ${totalSuccessful}<br>
                ? Failed: ${totalFailed}<br><br>

                Success Rate: ${totalPhotos > 0 ? Math.round((totalSuccessful / totalPhotos) * 100) : 0}%<br><br>

                ${totalFailed > 0 ? `<strong style="color: red;">?? Some images failed to load</strong><br>Failed images will show as placeholders in PDF.` : '<strong style="color: green;">? All images loaded successfully!</strong>'}
              </div>
            `,
            buttons: ['OK']
          });
          await alert.present();
        }, 1000); // Delay to allow other alerts to show first
      }
    }

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

    // MOBILE FIX: Clear cache on mobile to ensure fresh base64 data
    // Cache might contain old data with HTTP URLs instead of base64
    const cacheKey = this.cache.getApiCacheKey('visual_photos', { visualId });
    const isMobile = this.platformIonic.is('ios') || this.platformIonic.is('android');

    // PERFORMANCE OPTIMIZED: Use cache on all platforms for faster loading
    // Cache contains base64 data which works on both web and mobile
    const cachedPhotos = this.cache.get(cacheKey);
    if (cachedPhotos && cachedPhotos.length > 0) {
      // Verify cached photos have proper base64 data
      const allValid = cachedPhotos.every((p: any) =>
        p.displayUrl && (p.displayUrl.startsWith('data:') || p.displayUrl.startsWith('blob:'))
      );
      if (allValid) {
        console.log('[PDF Photos] Using cached photos for visualId:', visualId, '(', cachedPhotos.length, 'photos)');
        return cachedPhotos;
      } else {
        console.log('[PDF Photos] Cache invalid, reloading photos');
        this.cache.clear(cacheKey);
      }
    }

    // Load Fabric.js once for all photos to avoid multiple parallel imports
    console.log('[PDF Photos] Loading Fabric.js for annotation rendering...');
    const fabric = await this.fabricService.getFabric();
    console.log('[PDF Photos] Fabric.js loaded, processing', photos.length, 'photos for visual:', visualId);

    // PERFORMANCE OPTIMIZED: Process photos in batches
    // Increased batch sizes for faster PDF generation while maintaining stability
    const BATCH_SIZE = isMobile ? 8 : 15; // Increased from 3/5 for better performance
    const BATCH_DELAY = isMobile ? 50 : 25; // Reduced from 200/100 for faster processing
    const processedPhotos: any[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < photos.length; i += BATCH_SIZE) {
      const batch = photos.slice(i, i + BATCH_SIZE);
      console.log(`[PDF Photos] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(photos.length / BATCH_SIZE)} (${batch.length} photos)`);

      const batchPromises = batch.map(async (photo, batchIndex) => {
      const photoIndex = i + batchIndex;
      const photoName = photo.Annotation || photo.caption || `Photo ${photoIndex + 1}`;

      // Prioritize displayUrl (annotated) over regular url
      let photoUrl = photo.displayUrl || photo.Photo || photo.url || '';
      let finalUrl = photoUrl;
      let conversionSuccess = false;
      let errorDetails = ''; // Store error info for debug popup

      console.log(`[PDF Photos] [${photoIndex + 1}/${photos.length}] Processing "${photoName}"`);
      console.log(`[PDF Photos]   - AttachID: ${photo.AttachID || 'none'}`);
      console.log(`[PDF Photos]   - Photo URL: ${photoUrl?.substring(0, 100) || 'empty'}`);

      // If it's a Caspio file path (starts with /), convert to base64
      if (photoUrl && photoUrl.startsWith('/')) {
        // Check individual photo cache first (skip on mobile)
        const photoCacheKey = this.cache.getApiCacheKey('photo_base64', { path: photoUrl });
        const cachedBase64 = !isMobile ? this.cache.get(photoCacheKey) : null;

        if (cachedBase64) {
          console.log(`[PDF Photos]   - Using cached base64`);
          finalUrl = cachedBase64;
          conversionSuccess = true;
        } else {
          try {
            console.log(`[PDF Photos]   - Converting to base64...`);
            const startTime = Date.now();
            const base64Data = await this.caspioService.getImageFromFilesAPI(photoUrl).toPromise();
            const duration = Date.now() - startTime;

            if (base64Data && base64Data.startsWith('data:')) {
              finalUrl = base64Data;
              conversionSuccess = true;
              console.log(`[PDF Photos]   ? Converted successfully in ${duration}ms (${Math.round(base64Data.length / 1024)}KB)`);
              // Cache individual photo for reuse (web only)
              if (!isMobile) {
                this.cache.set(photoCacheKey, base64Data, this.cache.CACHE_TIMES.LONG);
              }
            } else {
              console.error(`[PDF Photos]   ? Conversion failed: Invalid data returned`);
              console.error(`[PDF Photos]     - Type: ${typeof base64Data}`);
              console.error(`[PDF Photos]     - Length: ${base64Data?.length || 0}`);
              console.error(`[PDF Photos]     - Preview: ${base64Data?.substring(0, 50) || 'empty'}`);
              finalUrl = 'assets/img/photo-placeholder.svg';
              conversionSuccess = false;
              errorDetails = `Invalid data: ${typeof base64Data}, length: ${base64Data?.length || 0}`;
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`[PDF Photos]   ? Error during base64 conversion:`, {
              error: error,
              message: errorMsg,
              photoUrl: photoUrl,
              attachId: photo.AttachID,
              platform: isMobile ? 'mobile' : 'web'
            });
            finalUrl = 'assets/img/photo-placeholder.svg';
            conversionSuccess = false;
            errorDetails = errorMsg;
          }
        }
      } else if (photoUrl && (photoUrl.startsWith('blob:') || photoUrl.startsWith('data:'))) {
        console.log(`[PDF Photos]   - Already data/blob URL`);
        finalUrl = photoUrl;
        conversionSuccess = true;
      } else if (photoUrl && photoUrl.startsWith('http')) {
        console.log(`[PDF Photos]   - HTTP URL (may fail on mobile)`);
        finalUrl = photoUrl;
        conversionSuccess = true;
      } else {
        console.warn(`[PDF Photos]   - Unknown URL format or empty`);
        finalUrl = 'assets/img/photo-placeholder.svg';
        conversionSuccess = false;
        errorDetails = 'Empty or unknown URL format';
      }

      // CRITICAL FIX: Render annotations if Drawings data exists
      // Check both Drawings and rawDrawingsString (rawDrawingsString is from buildPhotoRecord)
      const drawingsData = photo.Drawings || photo.rawDrawingsString;
      if (drawingsData && finalUrl && !finalUrl.includes('placeholder')) {
        console.log('[PDF Photos] Rendering annotations for photo:', {
          photoUrl,
          hasDrawings: !!drawingsData,
          drawingsType: typeof drawingsData,
          drawingsPreview: typeof drawingsData === 'string' ? drawingsData.substring(0, 200) : drawingsData,
          photoHasDrawings: !!photo.Drawings,
          photoHasRawDrawingsString: !!photo.rawDrawingsString
        });
        try {
          // Check cache for annotated version
          const annotatedCacheKey = this.cache.getApiCacheKey('photo_annotated', {
            path: photoUrl,
            drawings: drawingsData.substring(0, 50) // Use first 50 chars as cache key part
          });
          const cachedAnnotated = this.cache.get(annotatedCacheKey);

          if (cachedAnnotated) {
            console.log('[PDF Photos] Using cached annotated photo');
            finalUrl = cachedAnnotated;
          } else {
            console.log('[PDF Photos] Rendering annotations with renderAnnotationsOnPhoto...');
            // Render annotations onto the photo, passing the pre-loaded fabric instance
            const annotatedUrl = await renderAnnotationsOnPhoto(finalUrl, drawingsData, { quality: 0.9, format: 'jpeg', fabric });
            if (annotatedUrl && annotatedUrl !== finalUrl) {
              console.log('[PDF Photos] Annotations rendered successfully');
              finalUrl = annotatedUrl;
              // Cache the annotated version
              this.cache.set(annotatedCacheKey, annotatedUrl, this.cache.CACHE_TIMES.LONG);
            } else {
              console.warn('[PDF Photos] renderAnnotationsOnPhoto returned same URL');
            }
          }
        } catch (renderError) {
          console.error(`[PDF Photos] Error rendering annotations:`, renderError);
          // Continue with original photo if rendering fails
        }
      } else {
        if (!drawingsData) {
          console.log('[PDF Photos] No drawings data for photo:', photoUrl);
        }
      }

        // Track success/failure
        if (conversionSuccess) {
          successCount++;
        } else {
          failureCount++;
        }

        // Return the photo object with the appropriate URLs
        // If photo already has a displayUrl (annotated), it should be preserved as finalUrl
        return {
          url: photo.url || finalUrl, // Original URL
          displayUrl: finalUrl, // This will be the annotated version with drawings rendered
          caption: photo.Annotation || '',
          attachId: photo.AttachID || photo.id || '',
          hasAnnotations: !!drawingsData,
          conversionSuccess: conversionSuccess, // Track if conversion succeeded
          errorDetails: errorDetails // Error message if failed
        };
      });

      // Wait for current batch to complete
      const batchResults = await Promise.all(batchPromises);
      processedPhotos.push(...batchResults);

      console.log(`[PDF Photos] Batch complete: ${successCount} succeeded, ${failureCount} failed so far`);

      // Small delay between batches to allow garbage collection
      if (i + BATCH_SIZE < photos.length) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
      }
    }

    // Final summary
    console.log(`[PDF Photos] ========== SUMMARY ==========`);
    console.log(`[PDF Photos] Visual ID: ${visualId}`);
    console.log(`[PDF Photos] Total photos: ${photos.length}`);
    console.log(`[PDF Photos] Successful: ${successCount}`);
    console.log(`[PDF Photos] Failed: ${failureCount}`);
    console.log(`[PDF Photos] Success rate: ${photos.length > 0 ? Math.round((successCount / photos.length) * 100) : 0}%`);
    console.log(`[PDF Photos] Platform: ${isMobile ? 'Mobile' : 'Web'}`);
    console.log(`[PDF Photos] ============================`);

    // Show debug popup on mobile if there were failures
    if (isMobile && failureCount > 0) {
      const failedPhotos = processedPhotos.filter(p => !p.conversionSuccess);
      const failureDetails = failedPhotos.slice(0, 5).map((p, idx) => {
        const caption = (p.caption || 'No caption').substring(0, 30);
        const url = (p.url || 'No URL').substring(0, 40);
        const error = (p.errorDetails || 'Unknown error').substring(0, 50);
        return `${idx + 1}. ${caption}<br>   ${url}...<br>   <span style="color: red;">Error: ${error}</span>`;
      }).join('<br>');

      setTimeout(async () => {
        const alert = await this.alertController.create({
          header: '?? Photo Failures',
          message: `
            <div style="font-family: monospace; font-size: 10px; text-align: left;">
              <strong>Visual: ${category || 'Unknown'}</strong><br><br>

              <strong style="color: ${failureCount > 0 ? 'red' : 'green'};">Status:</strong><br>
              ? Success: ${successCount}<br>
              ? Failed: ${failureCount}<br>
              Total: ${photos.length}<br>
              Rate: ${photos.length > 0 ? Math.round((successCount / photos.length) * 100) : 0}%<br><br>

              ${failureCount > 0 ? `<strong style="color: red;">Failed Photos (first 5):</strong><br>${failureDetails}<br><br>${failureCount > 5 ? `...and ${failureCount - 5} more` : ''}` : ''}
            </div>
          `,
          buttons: ['OK']
        });
        await alert.present();
      }, 500);
    }

    // Cache the processed photos using the cache service (web only - mobile gets fresh data)
    if (!isMobile) {
      this.cache.set(cacheKey, processedPhotos, this.cache.CACHE_TIMES.LONG);
      console.log('[PDF Photos] Cached processed photos for web use');
    } else {
      console.log('[PDF Photos] Skipping cache on mobile');
    }

    return processedPhotos;
  }

    async fetchAllVisualsFromDatabase() {
    try {
      
      // Fetch all Services_LBW records for this service
      const visuals = await this.hudData.getVisualsByService(this.serviceId);
      
      // Check if visuals is defined and is an array
      if (!visuals || !Array.isArray(visuals)) {
        return;
      }
      
      // Clear and rebuild the visualPhotos mapping
      this.visualPhotos = {};
      
      // Fetch all attachments in parallel for better performance
      const attachmentPromises = visuals
        .filter(visual => visual.LBWID)
        .map(visual =>
          this.hudData.getVisualAttachments(visual.LBWID)
            .then(attachments => ({ visualId: visual.LBWID, attachments }))
            .catch(error => {
              console.error(`Error fetching attachments for visual ${visual.LBWID}:`, error);
              return { visualId: visual.LBWID, attachments: [] };
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
        if (visual.LBWID) {
          this.updateVisualInOrganizedData(visual);
        }
      }
    } catch (error) {
      console.error('Ã¢ÂÅ’ Error fetching visuals from database:', error);
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
      const existing = this.organizedData[category].comments.find((c: any) => c.LBWID === visual.LBWID);
      if (existing) {
        // Update with database values
        existing.Text = visual.Text || existing.Text;
        existing.Notes = visual.Notes || existing.Notes;
        found = true;
      }
    } else if (kind === 'limitation' && this.organizedData[category].limitations) {
      const existing = this.organizedData[category].limitations.find((l: any) => l.LBWID === visual.LBWID);
      if (existing) {
        existing.Text = visual.Text || existing.Text;
        existing.Notes = visual.Notes || existing.Notes;
        found = true;
      }
    } else if (kind === 'deficiency' && this.organizedData[category].deficiencies) {
      const existing = this.organizedData[category].deficiencies.find((d: any) => d.LBWID === visual.LBWID);
      if (existing) {
        existing.Text = visual.Text || existing.Text;
        existing.Notes = visual.Notes || existing.Notes;
        found = true;
      }
    }

    // If not found in organized data but exists in database, mark it as selected
    if (!found && visual.LBWID) {
      const key = `${category}-${kind}-${visual.LBWID}`;
      if (this.selectedItems) {
        this.selectedItems[key] = true;
      }
    }
  }
}





