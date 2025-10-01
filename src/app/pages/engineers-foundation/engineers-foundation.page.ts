import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ChangeDetectorRef } from '@angular/core';
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
  imports: [CommonModule, FormsModule, IonicModule]
})
export class EngineersFoundationPage implements OnInit, AfterViewInit, OnDestroy {
  // Build cache fix: v1.4.247 - Fixed class structure, removed orphaned code
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  
  projectId: string = '';
  serviceId: string = '';
  projectData: any = null;
  serviceData: any = {}; // Store Services table data
  currentUploadContext: any = null;
  currentRoomPointContext: any = null;  // For room photo uploads
  currentFDFPhotoContext: any = null;  // For FDF photo uploads
  uploadingPhotos: { [key: string]: number } = {}; // Track uploads per visual
  expectingCameraPhoto: boolean = false; // Track if we're expecting a camera photo
  private readonly photoPlaceholder = 'assets/img/photo-placeholder.svg';
  private thumbnailCache = new Map<string, Promise<string | null>>();
  private templateLoader?: HTMLIonLoadingElement | HTMLIonAlertElement;
  private templateLoaderPresented = false;
  private templateLoadStart = 0;
  private readonly templateLoaderMinDuration = 1000;
  private photoHydrationPromise: Promise<void> | null = null;
  private waitingForPhotoHydration = false;
  
  // PDF generation state
  isPDFGenerating: boolean = false;
  pdfGenerationAttempts: number = 0;
  private autoPdfRequested = false;
  private viewInitialized = false;
  private dataInitialized = false;
  private pdfPreviewComponent?: PdfPreviewCtor;
  private subscriptions = new Subscription();
  private pendingVisualKeys: Set<string> = new Set();
  private pendingPhotoUploads: { [key: string]: PendingPhotoUpload[] } = {};
  private pendingVisualCreates: { [key: string]: PendingVisualCreate } = {};
  private pendingRoomCreates: { [roomName: string]: any } = {}; // Queue room creation when offline
  private pendingPointCreates: { [key: string]: any } = {}; // Queue point creation with room dependency
  
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
  roomRecordIds: { [roomName: string]: string } = {}; // Track Services_Rooms IDs
  savingRooms: { [roomName: string]: boolean } = {};
  roomPointIds: { [key: string]: string } = {}; // Track Services_Rooms_Points IDs
  expandedRooms: { [roomName: string]: boolean } = {}; // Track room expansion state
  roomNotesDebounce: { [roomName: string]: any } = {}; // Track note update debounce timers
  currentRoomPointCapture: any = null; // Store current capture context
  
  // FDF dropdown options from Services_Rooms_Drop table - mapped by room name
  fdfOptions: string[] = [];
  roomFdfOptions: { [roomName: string]: string[] } = {};
  
  // Services dropdown options from Services_Drop table
  weatherConditionsOptions: string[] = [];
  outdoorTemperatureOptions: string[] = [];
  occupancyFurnishingsOptions: string[] = [];
  inAttendanceOptions: string[] = [];
  firstFoundationTypeOptions: string[] = [];
  secondFoundationTypeOptions: string[] = [];
  thirdFoundationTypeOptions: string[] = [];
  secondFoundationRoomsOptions: string[] = [];
  thirdFoundationRoomsOptions: string[] = [];
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
    private platform: Platform,
    private pdfGenerator: PdfGeneratorService,
    private cache: CacheService,
    private offlineService: OfflineService,
    private foundationData: EngineersFoundationDataService
  ) {}

  async ngOnInit() {
    // Get project ID from route params
    this.projectId = this.route.snapshot.paramMap.get('projectId') || '';
    this.serviceId = this.route.snapshot.paramMap.get('serviceId') || '';

    console.log('[v1.4.389] Engineers Foundation Evaluation initialized:', {
      projectId: this.projectId,
      serviceId: this.serviceId
    });

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
    await this.presentTemplateLoader();

    try {
      await Promise.all([
        this.loadProjectData(),
        this.loadVisualCategories(),
        this.loadRoomTemplates(),
        this.loadFDFOptions(),
        this.loadProjectDropdownOptions(),
        this.loadServicesDropdownOptions(),
        this.loadVisualDropdownOptions()
      ]);
      
      // Then load any existing template data (including visual selections)
      await this.loadExistingData();
      this.dataInitialized = true;
      this.tryAutoOpenPdf();
    } catch (error) {
      console.error('Error loading template data:', error);
    } finally {
      await this.dismissTemplateLoader();
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
    setTimeout(() => {
      // Add listener to back button using ID
      const backButton = document.getElementById('eng-back-btn') as HTMLElement;
      if (backButton) {
        console.log('[v1.4.400] Adding click listener to back button');
        backButton.removeEventListener('click', this.handleBackClick); // Remove any existing listener
        backButton.addEventListener('click', this.handleBackClick);
        // Also try onclick directly
        (backButton as any).onclick = this.handleBackClick;
      } else {
        console.error('[v1.4.400] Back button not found in DOM');
      }

      // Add listener to PDF button using ID
      const pdfButton = document.getElementById('eng-pdf-btn') as HTMLElement;
      if (pdfButton) {
        pdfButton.removeEventListener('click', this.handlePDFClickBound); // Remove any existing listener
        pdfButton.addEventListener('click', this.handlePDFClickBound);
        // Also try onclick directly
        (pdfButton as any).onclick = this.handlePDFClickBound;
      } else {
        console.error('[v1.4.400] PDF button not found in DOM');
      }
    }, 500); // Wait for DOM to be fully ready
  }

  // Bound methods for event listeners
  private handleBackClick = () => {
    console.log('[v1.4.403] Back button clicked via direct listener');
    console.log('[v1.4.403] Current projectId:', this.projectId);
    console.log('[v1.4.403] Current router url:', this.router.url);
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
    console.log('ionViewWillEnter - page re-entered');
    // Re-add button listeners in case they were removed
    this.addButtonEventListeners();
    
    // Photos now use base64 data URLs like Structural section
    // No need to refresh URLs as they don't expire
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();

    // Clean up timers
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    
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
    
    // Clear any data to prevent memory leaks
    this.visualPhotos = {};
    this.roomElevationData = {};
    this.roomTemplates = [];

    // Force garbage collection hints
    this.formData = {};
    this.pendingPhotoUploads = {};
    this.pendingVisualCreates = {};
  }

  // Navigation method for back button
  goBack() {
    console.log('[goBack] Navigating back from Engineers Foundation, projectId:', this.projectId);

    // Method 1: Use Location.back() - this is the simplest and most reliable way
    try {
      this.location.back();
      console.log('[goBack] Used Location.back() to navigate');
    } catch (error) {
      console.error('[goBack] Location.back() failed:', error);

      // Method 2: Fallback to Router navigation
      if (this.projectId) {
        this.router.navigate(['/project', this.projectId]).then(success => {
          if (success) {
            console.log('[goBack] Router navigation successful');
          } else {
            console.error('[goBack] Router navigation failed');
            // Method 3: Last resort - force navigation with window.location
            window.location.href = `/project/${this.projectId}`;
          }
        });
      } else {
        this.router.navigate(['/tabs/active-projects']);
      }
    }
  }

  async loadProjectData() {
    if (!this.projectId) return;

    try {
      this.projectData = await this.foundationData.getProject(this.projectId);
      console.log('Project data loaded:', this.projectData);

      // Check for custom values and add them to dropdown options
      this.loadCustomValuesIntoDropdowns();

      // Type information is now loaded from Service data which has the correct TypeID
    } catch (error) {
      console.error('Error loading project data:', error);
      await this.showToast('Failed to load project data', 'danger');
    }
  }
  
  async loadTypeInfo(typeId: string) {
    try {
      console.log(`Ã°Å¸â€Â Loading type info for TypeID: ${typeId}`);
      const typeData = await this.foundationData.getType(typeId);
      console.log('Type data response:', typeData);
      
      if (typeData?.TypeShort) {
        this.typeShort = typeData.TypeShort;
        console.log(`Ã¢Å“â€¦ Type information loaded successfully: "${this.typeShort}"`);
        
        // Force change detection to update the view
        this.changeDetectorRef.detectChanges();
        
        // TypeShort loaded successfully
      } else {
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
      console.log('Ã¢Å¡Â Ã¯Â¸Â No serviceId available for loading service data');
      return;
    }
    
    console.log(`Ã°Å¸â€Â Loading service data for ServiceID: ${this.serviceId}`);
    
    try {
      // Load service data from Services table
      const serviceResponse = await this.foundationData.getService(this.serviceId);
      if (serviceResponse) {
        this.serviceData = serviceResponse;
        // Ensure StructuralSystemsStatus is initialized to empty string if null/undefined
        if (!this.serviceData.StructuralSystemsStatus) {
          this.serviceData.StructuralSystemsStatus = '';
        }
        console.log('Service data loaded:', this.serviceData);
        console.log(`Service has TypeID: ${this.serviceData?.TypeID}`);
        
        // TypeID loaded from service data
        
        // Load type information using TypeID from service data
        if (this.serviceData?.TypeID) {
          console.log(`Ã°Å¸â€œâ€¹ Found TypeID in service data: ${this.serviceData.TypeID}`);
          await this.loadTypeInfo(this.serviceData.TypeID);
        } else {
          console.warn('Ã¢Å¡Â Ã¯Â¸Â No TypeID found in service data');
          console.log('Available fields in service data:', Object.keys(this.serviceData || {}));
        }
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
        StructuralSystemsStatus: this.serviceData.StructuralSystemsStatus || '',
        Notes: this.serviceData.Notes || ''
      };
    }
  }
  
  async loadRoomTemplates() {
    try {
      const allTemplates = await this.foundationData.getRoomTemplates();
      
      if (allTemplates && allTemplates.length > 0) {
        // Store all templates for manual addition
        this.allRoomTemplates = allTemplates;
        
        // Filter templates where Auto = 'Yes'
        const autoTemplates = allTemplates.filter((template: any) => 
          template.Auto === 'Yes' || template.Auto === true || template.Auto === 1
        );
        
        this.roomTemplates = autoTemplates;
        this.availableRoomTemplates = [...autoTemplates]; // v1.4.65 - populate available templates
        
        // Initialize room elevation data for each template (but don't create in Services_Rooms yet)
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
              templateId: template.PK_ID || template.TemplateId,
              elevationPoints: elevationPoints,
              pointCount: template.PointCount || elevationPoints.length,
              notes: '',
              fdf: 'None' // Initialize FDF with default value
            };
          }
        });
        
        // Load existing Services_Rooms for this service to check which are already selected
        if (this.serviceId) {
          const existingRooms = await this.foundationData.getRoomsByService(this.serviceId);
          console.log('Existing Services_Rooms records:', existingRooms);
          
          if (existingRooms && existingRooms.length > 0) {
            // Now we can use the RoomName field directly
            for (const room of existingRooms) {
              const roomName = room.RoomName;
              // Use RoomID field, NOT PK_ID - RoomID is what links to Services_Rooms_Points
              const roomId = room.RoomID;
              
              console.log(`Loading room: ${roomName}, RoomID: ${roomId}, PK_ID: ${room.PK_ID}`);
              
              // Find matching template by RoomName - check all templates, not just auto
              let template = autoTemplates.find((t: any) => t.RoomName === roomName);
              
              // If not in auto templates, check all templates (for manually added rooms)
              if (!template) {
                // Extract base name by removing number suffix if present
                const baseName = roomName.replace(/ #\d+$/, '');
                template = this.allRoomTemplates.find((t: any) => t.RoomName === baseName);
                
                // If found, add it to roomTemplates so it displays
                if (template) {
                  // Create a new template object with the numbered name
                  const roomToAdd = { ...template, RoomName: roomName };
                  this.roomTemplates.push(roomToAdd);
                  console.log(`Added manually created room to templates: ${roomName}`);
                }
              }
              
              if (roomName && roomId) {
                this.selectedRooms[roomName] = true;
                this.expandedRooms[roomName] = false; // Start collapsed
                this.roomRecordIds[roomName] = roomId;
                
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
                    templateId: template.PK_ID || template.TemplateId,
                    elevationPoints: elevationPoints,
                    pointCount: template.PointCount || elevationPoints.length,
                    notes: '',
                    fdf: 'None'
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
                  console.log(`[FDF Photos] Checking FDF photos for room: ${roomName}`);
                  console.log(`  FDFPhotoTop: ${room.FDFPhotoTop || 'None'}`);
                  console.log(`  FDFPhotoBottom: ${room.FDFPhotoBottom || 'None'}`);
                  console.log(`  FDFPhotoThreshold: ${room.FDFPhotoThreshold || 'None'}`);
                  
                  if (room.FDFPhotoTop) {
                    fdfPhotos.top = true;
                    fdfPhotos.topPath = room.FDFPhotoTop; // Store the path for later use
                    console.log(`[v1.4.427] FDF Top - Loading from path: ${room.FDFPhotoTop}`);

                    try {
                      // Fetch the image as base64 data URL
                      const imageData = await this.foundationData.getImage(room.FDFPhotoTop);
                      console.log(`[v1.4.427] FDF Top - Received data:`, {
                        hasData: !!imageData,
                        isBase64: imageData?.startsWith('data:'),
                        length: imageData?.length || 0
                      });

                      if (imageData && imageData.startsWith('data:')) {
                        fdfPhotos.topUrl = imageData;
                        console.log(`[v1.4.427] FDF Top - Ã¢Å“â€¦ Base64 loaded successfully`);
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
                    fdfPhotos.bottomPath = room.FDFPhotoBottom; // Store the path
                    console.log(`[v1.4.427] FDF Bottom - Loading from path: ${room.FDFPhotoBottom}`);

                    try {
                      const imageData = await this.foundationData.getImage(room.FDFPhotoBottom);
                      console.log(`[v1.4.427] FDF Bottom - Received data:`, {
                        hasData: !!imageData,
                        isBase64: imageData?.startsWith('data:'),
                        length: imageData?.length || 0
                      });

                      if (imageData && imageData.startsWith('data:')) {
                        fdfPhotos.bottomUrl = imageData;
                        console.log(`[v1.4.427] FDF Bottom - Ã¢Å“â€¦ Base64 loaded successfully`);
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
                    fdfPhotos.thresholdPath = room.FDFPhotoThreshold; // Store the path
                    console.log(`[v1.4.427] FDF Threshold - Loading from path: ${room.FDFPhotoThreshold}`);

                    try {
                      const imageData = await this.foundationData.getImage(room.FDFPhotoThreshold);
                      console.log(`[v1.4.427] FDF Threshold - Received data:`, {
                        hasData: !!imageData,
                        isBase64: imageData?.startsWith('data:'),
                        length: imageData?.length || 0
                      });

                      if (imageData && imageData.startsWith('data:')) {
                        fdfPhotos.thresholdUrl = imageData;
                        console.log(`[v1.4.427] FDF Threshold - Ã¢Å“â€¦ Base64 loaded successfully`);
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
                
                console.log(`Restored room selection: ${roomName} with ID ${roomId}, FDF: ${room.FDF || 'None'}, Notes: ${room.Notes ? 'Yes' : 'No'}`);
                
                // Load existing room points for this room
                this.loadExistingRoomPoints(roomId, roomName);
              }
            }
          }
        }
        
        console.log('Initialized room elevation data:', this.roomElevationData);
      } else {
        console.log('No room templates found in Services_Room_Templates');
        this.roomTemplates = [];
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
      console.log('Loading Services_Drop dropdown options...');
      
      // Set default options first
      this.weatherConditionsOptions = ['Clear', 'Partly Cloudy', 'Cloudy', 'Light Rain', 'Heavy Rain', 'Windy', 'Foggy', 'Other'];
      this.outdoorTemperatureOptions = ['60Ã‚Â°F', '65Ã‚Â°F', '70Ã‚Â°F', '75Ã‚Â°F', '80Ã‚Â°F', '85Ã‚Â°F', '90Ã‚Â°F', '95Ã‚Â°F', '100Ã‚Â°F', 'Other'];
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
        console.log('Services_Drop data loaded:', servicesDropData.length, 'records');
        
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
        
        console.log('Parsed Services_Drop options:', optionsByService);
        
        // Set Weather Conditions options
        if (optionsByService['WeatherConditions'] && optionsByService['WeatherConditions'].length > 0) {
          this.weatherConditionsOptions = optionsByService['WeatherConditions'];
          console.log('Weather Conditions options:', this.weatherConditionsOptions);
        }
        
        // Set Outdoor Temperature options
        if (optionsByService['OutdoorTemperature'] && optionsByService['OutdoorTemperature'].length > 0) {
          this.outdoorTemperatureOptions = optionsByService['OutdoorTemperature'];
          console.log('Outdoor Temperature options:', this.outdoorTemperatureOptions);
        }
        
        // Set Occupancy Furnishings options
        if (optionsByService['OccupancyFurnishings'] && optionsByService['OccupancyFurnishings'].length > 0) {
          this.occupancyFurnishingsOptions = optionsByService['OccupancyFurnishings'];
          console.log('Occupancy Furnishings options:', this.occupancyFurnishingsOptions);
        }
        
        // Set InAttendance options
        if (optionsByService['InAttendance'] && optionsByService['InAttendance'].length > 0) {
          this.inAttendanceOptions = optionsByService['InAttendance'];
          console.log('InAttendance options:', this.inAttendanceOptions);
        }
        
        // Set FirstFoundationType options
        if (optionsByService['FirstFoundationType'] && optionsByService['FirstFoundationType'].length > 0) {
          this.firstFoundationTypeOptions = optionsByService['FirstFoundationType'];
          console.log('FirstFoundationType options:', this.firstFoundationTypeOptions);
        }
        
        // Set SecondFoundationType options
        if (optionsByService['SecondFoundationType'] && optionsByService['SecondFoundationType'].length > 0) {
          this.secondFoundationTypeOptions = optionsByService['SecondFoundationType'];
          console.log('SecondFoundationType options:', this.secondFoundationTypeOptions);
        }
        
        // Set ThirdFoundationType options
        if (optionsByService['ThirdFoundationType'] && optionsByService['ThirdFoundationType'].length > 0) {
          this.thirdFoundationTypeOptions = optionsByService['ThirdFoundationType'];
          console.log('ThirdFoundationType options:', this.thirdFoundationTypeOptions);
        }
        
        // Set SecondFoundationRooms options
        if (optionsByService['SecondFoundationRooms'] && optionsByService['SecondFoundationRooms'].length > 0) {
          this.secondFoundationRoomsOptions = optionsByService['SecondFoundationRooms'];
          console.log('SecondFoundationRooms options:', this.secondFoundationRoomsOptions);
        }
        
        // Set ThirdFoundationRooms options
        if (optionsByService['ThirdFoundationRooms'] && optionsByService['ThirdFoundationRooms'].length > 0) {
          this.thirdFoundationRoomsOptions = optionsByService['ThirdFoundationRooms'];
          console.log('ThirdFoundationRooms options:', this.thirdFoundationRoomsOptions);
        }
        
        // Set OwnerOccupantInterview options
        if (optionsByService['OwnerOccupantInterview'] && optionsByService['OwnerOccupantInterview'].length > 0) {
          this.ownerOccupantInterviewOptions = optionsByService['OwnerOccupantInterview'];
          console.log('OwnerOccupantInterview options:', this.ownerOccupantInterviewOptions);
        }
      }
    } catch (error) {
      console.error('Error loading Services_Drop options:', error);
      // Keep default options on error
    }
  }
  
  // Load FDF options from Services_Rooms_Drop table
  async loadFDFOptions() {
    try {
      // Set default options first
      const defaultOptions = ['None', '1/4"', '1/2"', '3/4"', '1"', '1.25"', '1.5"', '2"'];
      this.fdfOptions = defaultOptions;
      
      // Try to load room-specific options from Services_Rooms_Drop table
      try {
        const dropdownData = await this.caspioService.getServicesRoomsDrop().toPromise();
        
        if (dropdownData && dropdownData.length > 0) {
          // Group dropdown options by RoomName
          const optionsByRoom: { [roomName: string]: string[] } = {};
          
          dropdownData.forEach((row: any) => {
            // Use RoomsName field (with 's')
            const roomName = row.RoomsName || row.RoomName;
            const dropdownValue = row.Dropdown;
            
            if (roomName && dropdownValue) {
              if (!optionsByRoom[roomName]) {
                optionsByRoom[roomName] = [];
              }
              // Add unique dropdown values for this room
              if (!optionsByRoom[roomName].includes(dropdownValue)) {
                optionsByRoom[roomName].push(dropdownValue);
              }
            }
          });
          
          // Store room-specific options
          this.roomFdfOptions = optionsByRoom;
          
          // If there are FDF-specific options, use those as default
          if (optionsByRoom['FDF'] && optionsByRoom['FDF'].length > 0) {
            // Sort FDF options properly (None first, then numeric)
            this.fdfOptions = optionsByRoom['FDF'].sort((a, b) => {
              if (a === 'None') return -1;
              if (b === 'None') return 1;
              
              // Try to parse as numbers for proper numeric sorting
              const quotePattern = /["']/g;
              const aNum = parseFloat(a.replace(quotePattern, ''));
              const bNum = parseFloat(b.replace(quotePattern, ''));
              
              if (!isNaN(aNum) && !isNaN(bNum)) {
                return aNum - bNum;
              }
              return a.localeCompare(b);
            });
          }
          
          console.log('Room-specific FDF options loaded:', this.roomFdfOptions);
          console.log('Default FDF options:', this.fdfOptions);
        }
      } catch (tableError) {
        console.log('Could not load custom FDF options, using defaults:', tableError);
      }
    } catch (error) {
      console.error('Error loading FDF options:', error);
      // Default options on error
      this.fdfOptions = ['None', '1/4"', '1/2"', '3/4"', '1"', '1.25"', '1.5"', '2"'];
    }
  }
  
  // Load dropdown options for visual templates from Services_Visuals_Drop table
  async loadVisualDropdownOptions() {
    try {
      console.log('Loading visual dropdown options from Services_Visuals_Drop...');
      const dropdownData = await this.caspioService.getServicesVisualsDrop().toPromise();
      
      console.log('Services_Visuals_Drop data received:', dropdownData);
      
      if (dropdownData && dropdownData.length > 0) {
        // Group dropdown options by TemplateID
        dropdownData.forEach((row: any) => {
          const templateId = String(row.TemplateID); // Convert to string for consistency
          const dropdownValue = row.Dropdown;
          
          console.log(`Processing dropdown row: TemplateID=${templateId}, Dropdown=${dropdownValue}, Full Row:`, row);
          
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
        
        console.log('Visual dropdown options loaded:', this.visualDropdownOptions);
        console.log('Template IDs with options:', Object.keys(this.visualDropdownOptions));
        
        // Log details about what dropdown options are available for each TemplateID
        Object.entries(this.visualDropdownOptions).forEach(([templateId, options]) => {
          console.log(`TemplateID ${templateId} has ${(options as string[]).length} options:`, options);
        });
      } else {
        console.log('No dropdown data found in Services_Visuals_Drop');
      }
    } catch (error) {
      console.log('Could not load visual dropdown options:', error);
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

        console.log('TypeOfBuilding options:', this.typeOfBuildingOptions);
        console.log('Style options:', this.styleOptions);

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
    // Check if room-specific options exist
    if (this.roomFdfOptions[roomName] && this.roomFdfOptions[roomName].length > 0) {
      const options = [...this.roomFdfOptions[roomName]];
      // Add "Other" if not already present
      if (!options.includes('Other')) {
        options.push('Other');
      }
      return options;
    }
    // Fall back to default options
    const options = [...this.fdfOptions];
    if (!options.includes('Other')) {
      options.push('Other');
    }
    return options;
  }
  
  // Handle FDF selection change
  async onFDFChange(roomName: string) {
    const roomId = this.roomRecordIds[roomName];
    if (!roomId) {
      await this.showToast('Room must be saved first', 'warning');
      return;
    }

    try {
      const fdfValue = this.roomElevationData[roomName].fdf;

      // If "Other" is selected, don't save yet - wait for custom value
      if (fdfValue === 'Other') {
        return;
      }

      // Update Services_Rooms record with FDF value using RoomID field
      const updateData = { FDF: fdfValue };
      const query = `RoomID=${roomId}`;

      await this.caspioService.put(`/tables/Services_Rooms/records?q.where=${encodeURIComponent(query)}`, updateData).toPromise();

      console.log(`Updated FDF for room ${roomName} to ${fdfValue}`);
    } catch (error) {
      console.error('Error updating FDF:', error);
      await this.showToast('Failed to update FDF', 'danger');
    }
  }

  // Handle FDF "Other" custom value change (called on blur)
  async onFDFOtherBlur(roomName: string) {
    const customValue = this.customOtherValues['FDF_' + roomName];

    if (!customValue || !customValue.trim()) {
      console.log(`No custom FDF value entered for ${roomName}`);
      return;
    }

    const roomId = this.roomRecordIds[roomName];
    if (!roomId) {
      await this.showToast('Room must be saved first', 'warning');
      return;
    }

    try {
      console.log(`Saving custom FDF value for ${roomName}: ${customValue}`);

      // Update Services_Rooms record with custom FDF value
      const updateData = { FDF: customValue };
      const query = `RoomID=${roomId}`;

      await this.caspioService.put(`/tables/Services_Rooms/records?q.where=${encodeURIComponent(query)}`, updateData).toPromise();

      console.log(`Updated FDF for room ${roomName} to custom value: ${customValue}`);
    } catch (error) {
      console.error('Error updating custom FDF:', error);
      await this.showToast('Failed to update FDF', 'danger');
    }
  }

  // Handle taking FDF photos (Top, Bottom, Threshold) - using file input like room points
  async takeFDFPhoto(roomName: string, photoType: 'Top' | 'Bottom' | 'Threshold') {
    const roomId = this.roomRecordIds[roomName];
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
      
      this.triggerFileInput('system', { allowMultiple: false });

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
    
    try {
      // Compress the image if needed
      const compressedFile = await this.imageCompression.compressImage(file);
      
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

      console.log(`[v1.4.402] FDF ${photoType} upload response:`, uploadResult);
      console.log(`[v1.4.402] Using filename: ${uploadedFileName}`);
      console.log(`[v1.4.402] File path: ${filePath}`);
      
      // Update the appropriate column in Services_Rooms
      const columnName = `FDFPhoto${photoType}`;
      const updateData: any = {};
      updateData[columnName] = filePath;
      
      const query = `RoomID=${roomId}`;
      await this.caspioService.put(`/tables/Services_Rooms/records?q.where=${encodeURIComponent(query)}`, updateData).toPromise();
      
      // Store the photo URL in local state for display
      if (!this.roomElevationData[roomName].fdfPhotos) {
        this.roomElevationData[roomName].fdfPhotos = {};
      }
      
      const photoKey = photoType.toLowerCase();
      this.roomElevationData[roomName].fdfPhotos[photoKey] = true;
      this.roomElevationData[roomName].fdfPhotos[`${photoKey}Path`] = filePath;

      // [v1.4.421] Load the image as base64 to ensure thumbnails work
      console.log(`[v1.4.421] Loading saved FDF photo as base64: ${filePath}`);

      // First, create a blob URL from the compressed file for immediate display
      const blobUrl = URL.createObjectURL(compressedFile);
      this.roomElevationData[roomName].fdfPhotos[`${photoKey}Url`] = blobUrl;
      console.log(`[v1.4.421] FDF ${photoType} - Set temporary blob URL for immediate display`);

      // Then try to load from Caspio for permanent storage
      try {
        const imageData = await this.caspioService.getImageFromFilesAPI(filePath).toPromise();
        if (imageData && imageData.startsWith('data:')) {
          // Replace blob URL with base64 for permanent storage
          this.roomElevationData[roomName].fdfPhotos[`${photoKey}Url`] = imageData;
          console.log(`[v1.4.421] Ã¢Å“â€¦ FDF ${photoType} - Replaced blob URL with base64 (length: ${imageData.length})`);

          // Revoke the blob URL since we have base64 now
          URL.revokeObjectURL(blobUrl);
        } else {
          console.warn(`[v1.4.421] FDF ${photoType} - Invalid base64 data, keeping blob URL`);
        }
      } catch (err) {
        console.error(`[v1.4.421] FDF ${photoType} - Error loading base64, keeping blob URL:`, err);
        // Keep the blob URL since base64 failed
      }
      
      // [v1.4.402] Show success message with the actual file path
      await this.showToast(`FDF ${photoType} photo saved: ${filePath}`, 'success');

    } catch (error: any) {
      console.error(`[v1.4.402] Error processing FDF ${photoType} photo:`, error);
      const errorMsg = error?.message || error?.toString() || 'Unknown error';
      await this.showToast(`Failed to save FDF ${photoType} photo: ${errorMsg}`, 'danger');
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
      const roomId = this.roomRecordIds[roomName];
      if (roomId) {
        try {
          const rooms = await firstValueFrom(this.caspioService.getServicesRooms(this.serviceId));
          const numericRoomId = Number(roomId);
          const roomRecord = rooms?.find((room: any) => Number(room.RoomID) === numericRoomId);

          if (roomRecord?.[columnName]) {
            photoPath = roomRecord[columnName];
            fdfPhotos[`${photoKey}Path`] = photoPath;
          }
        } catch (error) {
          console.error(`[FDF Photos] Failed to load Services_Rooms data for ${roomName}:`, error);
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
  
  // Delete FDF photo
  async deleteFDFPhoto(roomName: string, photoType: 'Top' | 'Bottom' | 'Threshold', event: Event) {
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
          role: 'destructive',
          handler: async () => {
            try {
              const roomId = this.roomRecordIds[roomName];
              if (roomId) {
                // Clear the photo column in Services_Rooms
                const columnName = `FDFPhoto${photoType}`;
                const updateData: any = {};
                updateData[columnName] = null;
                
                const query = `RoomID=${roomId}`;
                await this.caspioService.put(`/tables/Services_Rooms/records?q.where=${encodeURIComponent(query)}`, updateData).toPromise();
              }
              
              // Clear from local state
              const photoKey = photoType.toLowerCase();
              if (this.roomElevationData[roomName]?.fdfPhotos) {
                delete this.roomElevationData[roomName].fdfPhotos[photoKey];
                delete this.roomElevationData[roomName].fdfPhotos[`${photoKey}Url`];
              }
              
              await this.showToast(`${photoType} photo deleted`, 'success');
            } catch (error) {
              console.error(`Error deleting FDF ${photoType} photo:`, error);
              await this.showToast(`Failed to delete ${photoType} photo`, 'danger');
            }
          }
        }
      ]
    });
    
    await alert.present();
  }
  
  // Handle elevation value change for a point
  async onElevationChange(roomName: string, point: any) {
    try {
      // Save the elevation value to the database
      const pointKey = `${roomName}_${point.name}`;
      const pointId = this.roomPointIds[pointKey];
      
      if (pointId) {
        const updateData = {
          Elevation: point.elevation || 0
        };
        
        await this.caspioService.updateServicesRoomsPoint(pointId, updateData).toPromise();
        console.log(`Updated elevation for ${point.name} to ${point.elevation}`);
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
              // Delete from database if it exists
              const pointKey = `${roomName}_${point.name}`;
              const pointId = this.roomPointIds[pointKey];
              
              if (pointId) {
                await this.caspioService.deleteServicesRoomsPoint(pointId).toPromise();
                delete this.roomPointIds[pointKey];
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
  
  // Capture photo for room elevation point - using EXACT visual method
  async capturePhotoForPoint(roomName: string, point: any, event?: Event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    
    try {
      const roomId = this.roomRecordIds[roomName];
      if (!roomId) {
        await this.showToast('Please save the room first', 'warning');
        return;
      }

      // If room is pending, cannot take photos yet
      if (roomId === '__pending__') {
        await this.showToast('Room is queued for creation. Please enable Auto-Save first.', 'warning');
        return;
      }

      // Check if point record exists, create if not
      const pointKey = `${roomName}_${point.name}`;
      let pointId = this.roomPointIds[pointKey];

      if (!pointId || pointId === '__pending__') {
        // If offline, cannot proceed
        if (this.manualOffline) {
          await this.showToast('Please enable Auto-Save to take photos', 'warning');
          return;
        }

        // Need to create point - do it quickly and silently
        const existingPoint = await this.caspioService.checkRoomPointExists(roomId, point.name).toPromise();

        if (existingPoint) {
          // Point already exists, use its PointID (NOT PK_ID!)
          pointId = existingPoint.PointID || existingPoint.PK_ID;
          this.roomPointIds[pointKey] = pointId;
          console.log(`Using existing point record with PointID: ${pointId}`);
        } else {
          // Create new Services_Rooms_Points record
          const pointData = {
            RoomID: parseInt(roomId),
            PointName: point.name
          };

          console.log('Creating Services_Rooms_Points record:', pointData);
          const createResponse = await this.caspioService.createServicesRoomsPoint(pointData).toPromise();

          // Use PointID from response, NOT PK_ID!
          if (createResponse && (createResponse.PointID || createResponse.PK_ID)) {
            pointId = createResponse.PointID || createResponse.PK_ID;
            this.roomPointIds[pointKey] = pointId;
            console.log(`Created point record with PointID: ${pointId}`);
          } else {
            throw new Error('Failed to create point record');
          }
        }
      }

      this.currentRoomPointContext = {
        roomName,
        point,
        pointId,
        roomId
      };

      this.triggerFileInput('system', { allowMultiple: false });

    } catch (error) {
      console.error('Error in capturePhotoForPoint:', error);
      await this.showToast('Failed to capture photo', 'danger');
    }
  }
  
  // Load existing room points and their photos
  async loadExistingRoomPoints(roomId: string, roomName: string) {
    try {
      // [v1.4.378 FIX] DO NOT clear image cache - it affects other sections
      console.log(`[v1.4.378] Loading photos for room: ${roomName} WITHOUT clearing cache`);
      
      // Get all points for this room
      const points = await this.foundationData.getRoomPoints(roomId);
      
      if (points && points.length > 0) {
        for (const point of points) {
          // Use PointID as the primary ID field, fallback to PK_ID
          const pointId = point.PointID || point.PK_ID;
          const pointKey = `${roomName}_${point.PointName}`;
          
          // Store the point ID for future reference
          this.roomPointIds[pointKey] = pointId;
          console.log(`Loaded existing point: ${point.PointName} with PointID: ${pointId}`);
          
          // Find the corresponding point in roomElevationData and mark it as having photos
          if (this.roomElevationData[roomName]?.elevationPoints) {
            let elevationPoint = this.roomElevationData[roomName].elevationPoints.find(
              (p: any) => p.name === point.PointName
            );
            
            // If this point doesn't exist in the template, it's a custom point - add it
            if (!elevationPoint) {
              console.log(`Found custom point not in template: ${point.PointName}`);
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
            
            if (elevationPoint) {
              // Get photo count for this point - use the correct PointID
              const actualPointId = point.PointID || pointId;
              const photos = await this.foundationData.getRoomAttachments(actualPointId);
              if (photos && photos.length > 0) {
                elevationPoint.photoCount = photos.length;
                
                // Process photos SEQUENTIALLY to avoid cache issues
                const processedPhotos = [];
                for (let photoIndex = 0; photoIndex < photos.length; photoIndex++) {
                  const photo = photos[photoIndex];
                  const photoPath = photo.Photo || '';
                  let photoUrl = '';
                  let thumbnailUrl = '';
                  
                  console.log(`[Photo ${photoIndex + 1}/${photos.length}] Processing for ${point.PointName}:`, {
                    AttachID: photo.AttachID,
                    Photo: photoPath,
                    HasDrawings: !!photo.Drawings,
                    UniqueCheck: `Path ends with: ${photoPath.substring(photoPath.length - 10)}`
                  });
                  
                  if (photoPath && photoPath !== '') {
                    try {
                      // [v1.4.391] Enhanced cache-busting for Elevation photos to prevent duplication
                      const timestamp = Date.now();
                      const uniqueId = `${photoIndex}_${timestamp}_${Math.random().toString(36).substring(2, 8)}`;
                      console.log(`[v1.4.391] Elevation Photo ${photoIndex + 1}/${photos.length}] Fetching with unique ID ${uniqueId}: ${photoPath}`);

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
                        console.log(`[v1.4.391] Photo ${photoIndex + 1}] Got base64, length: ${dataLength}, preview: ${dataPreview}`);

                        photoUrl = imageData;
                        thumbnailUrl = imageData;
                      } else {
                        console.log(`[Photo ${photoIndex + 1}] Invalid/empty image data`);
                        // Fallback to SVG if fetch fails - make it unique per photo
                        photoUrl = 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#e0e0e0"/><text x="75" y="50" text-anchor="middle" fill="#666" font-size="14">Ã°Å¸â€œÂ· Photo ${photoIndex + 1}</text></svg>`);
                        thumbnailUrl = photoUrl;
                      }
                    } catch (err) {
                      console.error(`[Photo ${photoIndex + 1}] Error fetching:`, err);
                      // Fallback to SVG on error - make it unique
                      photoUrl = 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#e0e0e0"/><text x="75" y="50" text-anchor="middle" fill="#666" font-size="14">Ã°Å¸â€œÂ· Error ${photoIndex + 1}</text></svg>`);
                      thumbnailUrl = photoUrl;
                    }
                  } else {
                    console.log(`[Photo ${photoIndex + 1}] No photo path, using placeholder`);
                    photoUrl = 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#e0e0e0"/><text x="75" y="50" text-anchor="middle" fill="#666" font-size="14">Ã°Å¸â€œÂ· No Path ${photoIndex + 1}</text></svg>`);
                    thumbnailUrl = photoUrl;
                  }
                  
                  // Load annotations from Drawings field, not Annotation
                  let annotationData = null;
                  if (photo.Drawings) {
                    try {
                      annotationData = decompressAnnotationData(photo.Drawings);
                    } catch (e) {
                      console.log('Failed to parse Drawings field:', e);
                    }
                  }
                  
                  const photoResult = {
                    url: photoUrl,
                    thumbnailUrl: thumbnailUrl,
                    displayUrl: photoUrl,  // Add displayUrl for consistency
                    originalUrl: photoUrl,  // Store original for re-editing
                    annotation: '',  // Don't use Annotation field anymore
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
                  
                  console.log(`[Photo ${photoIndex + 1}] Created photo result:`, {
                    attachId: photoResult.attachId,
                    hasUrl: !!photoResult.url,
                    urlLength: photoResult.url?.length,
                    urlPreview: photoResult.url?.substring(0, 50),
                    hasAnnotations: photoResult.hasAnnotations
                  });
                  
                  processedPhotos.push(photoResult);
                }
                
                elevationPoint.photos = processedPhotos;
                console.log(`Loaded ${photos.length} photos for point ${point.PointName}`);
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
      
      console.log(`Handling ${files.length} file(s) for room point: ${point.name}`);
      
      let uploadSuccessCount = 0;
      const uploadPromises = [];
      
      // Process each file with annotation support (matching Structural Systems pattern)
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // If this is a single camera photo, open annotator first
        let annotatedResult: { file: File; annotationData?: any; originalFile?: File };
        
        if (files.length === 1) {
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
              originalFile: undefined
            };
            this.expectingCameraPhoto = false;
          }
        } else {
          // Multiple files or non-camera selection - no automatic annotation
          annotatedResult = { 
            file: file, 
            annotationData: null, 
            originalFile: undefined 
          };
        }
        
        // Create preview immediately
        const photoUrl = URL.createObjectURL(annotatedResult.file);
        
        // Add to UI immediately with uploading flag
        if (!point.photos) {
          point.photos = [];
        }
        
        const photoEntry: any = {
          url: photoUrl,
          thumbnailUrl: photoUrl,
          annotation: '',
          uploading: true,
          file: annotatedResult.file,
          originalFile: annotatedResult.originalFile,
          annotationData: annotatedResult.annotationData,
          attachId: null  // Initialize attachId property
        };
        
        point.photos.push(photoEntry);
        point.photoCount = point.photos.length;
        
        // Upload in background with annotation data
        const uploadPromise = this.uploadPhotoToRoomPointFromFile(pointId, annotatedResult.file, point.name, annotatedResult.annotationData)
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
            uploadSuccessCount++;
            console.log(`Photo ${i + 1} uploaded for point ${point.name}, AttachID: ${photoEntry.attachId}`);
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
              console.log(`Photo captured: ${file.name}, Size: ${file.size}`);
              resolve(file);
            } else {
              console.log('No file selected');
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
      if (!this.currentRoomPointCapture) {
        throw new Error('No capture context');
      }
      
      const { roomName, point, roomId } = this.currentRoomPointCapture;
      
      // Check if point record exists, create if not
      const pointKey = `${roomName}_${point.name}`;
      let pointId = this.roomPointIds[pointKey];
      
      if (!pointId) {
        // Create Services_Rooms_Points record
        const pointData = {
          RoomID: parseInt(roomId),
          PointName: point.name
        };
        
        const createResponse = await this.caspioService.createServicesRoomsPoint(pointData).toPromise();
        
        // Use PointID from response, NOT PK_ID!
        if (createResponse && (createResponse.PointID || createResponse.PK_ID)) {
          pointId = createResponse.PointID || createResponse.PK_ID;
          this.roomPointIds[pointKey] = pointId;
          console.log(`processRoomPointPhoto created point with PointID: ${pointId}`);
        } else {
          throw new Error('Failed to create point record');
        }
      }
      
      // Upload photo to Services_Rooms_Attach
      await this.uploadPhotoToRoomPoint(pointId, base64Image, point.name);
      
      // Update UI to show photo
      if (!point.photos) {
        point.photos = [];
      }
      point.photos.push({
        url: base64Image,
        thumbnailUrl: base64Image
      });
      point.photoCount = point.photos.length;
      
      // Offer to take another photo
      const alert = await this.alertController.create({
        header: 'Photo Captured',
        message: 'Would you like to take another photo?',
        cssClass: 'orange-alert',
        buttons: [
          {
            text: 'Done',
            role: 'cancel',
            cssClass: 'secondary'
          },
          {
            text: 'Take Another',
            cssClass: 'primary',
            handler: () => {
              setTimeout(() => {
                this.capturePhotoForPoint(roomName, point);
              }, 500);
            }
          }
        ]
      });
      
      await alert.present();
      
    } catch (error) {
      console.error('Error processing room point photo:', error);
      await this.showToast('Failed to process photo', 'danger');
    }
  }
  
  // Upload photo to Services_Rooms_Attach
  async uploadPhotoToRoomPoint(pointId: string, base64Image: string, pointName: string) {
    try {
      // Convert base64 to blob
      const response = await fetch(base64Image);
      const blob = await response.blob();
      
      // COMPRESS the image before upload
      const compressedBlob = await this.imageCompression.compressImage(blob, {
        maxSizeMB: 1.5,
        maxWidthOrHeight: 1920,
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
      
      // Create Services_Rooms_Attach record
      const attachData = {
        PointID: parseInt(pointId),
        Photo: `/${uploadResult.Name}`,
        Annotation: ''
      };
      
      await this.caspioService.createServicesRoomsAttach(attachData).toPromise();
      
      console.log(`Photo uploaded for point ${pointName}`);
      
    } catch (error) {
      console.error('Error uploading room point photo:', error);
      throw error;
    }
  }
  
  // Upload photo from File object to Services_Rooms_Points_Attach with annotation support
  async uploadPhotoToRoomPointFromFile(pointId: string, file: File, pointName: string, annotationData: any = null) {
    try {
      const pointIdNum = parseInt(pointId, 10);
      
      // COMPRESS the file before upload
      const compressedFile = await this.imageCompression.compressImage(file, {
        maxSizeMB: 1.5,
        maxWidthOrHeight: 1920,
        useWebWorker: true
      }) as File;
      
      // Directly proceed with upload and return the response
      const response = await this.performRoomPointPhotoUpload(pointIdNum, compressedFile, pointName, annotationData);
      return response;  // Return response so we can get AttachID
      
    } catch (error) {
      console.error('Error in uploadPhotoToRoomPointFromFile:', error);
      throw error;
    }
  }
  
  // Perform the actual room point photo upload with annotation support
  private async performRoomPointPhotoUpload(pointIdNum: number, photo: File, pointName: string, annotationData: any = null) {
    try {
      console.log('Ã°Å¸â€œÂ¦ Using two-step upload for room point photo');
      
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
      
      // DEBUG POPUP: Show what we're about to upload
      const debugAlert = await this.alertController.create({
        header: 'Ã°Å¸â€Â DEBUG: Elevation Photo Upload',
        message: `
          <div style="font-family: monospace; font-size: 11px; text-align: left;">
            <strong style="color: blue;">UPLOAD PARAMETERS</strong><br><br>
            
            <strong>Point Info:</strong><br>
            Ã¢â‚¬Â¢ Point ID: ${pointIdNum}<br>
            Ã¢â‚¬Â¢ Point Name: ${pointName}<br>
            Ã¢â‚¬Â¢ Point ID Type: ${typeof pointIdNum}<br><br>
            
            <strong>Photo Info:</strong><br>
            Ã¢â‚¬Â¢ File Name: ${photo.name}<br>
            Ã¢â‚¬Â¢ File Size: ${photo.size} bytes<br>
            Ã¢â‚¬Â¢ File Type: ${photo.type}<br><br>
            
            <strong>Annotation Data:</strong><br>
            Ã¢â‚¬Â¢ Has Annotations: ${!!annotationData}<br>
            Ã¢â‚¬Â¢ Drawings Data Length: ${drawingsData.length}<br>
            Ã¢â‚¬Â¢ Drawings Preview: ${drawingsData ? drawingsData.substring(0, 100) + '...' : 'None'}<br><br>
            
            <strong>API Call:</strong><br>
            Ã¢â‚¬Â¢ Method: createServicesRoomsPointsAttachWithFile<br>
            Ã¢â‚¬Â¢ Table: Services_Rooms_Points_Attach<br>
            Ã¢â‚¬Â¢ Parameters: (${pointIdNum}, "${drawingsData.substring(0, 50)}...", File)<br><br>
            
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
      }
      
      // Use the new two-step method that matches visual upload
      const response = await this.caspioService.createServicesRoomsPointsAttachWithFile(
        pointIdNum,
        drawingsData, // Pass annotation data to Drawings field
        photo
      ).toPromise();
      
      console.log('Ã¢Å“â€¦ Room point photo uploaded successfully with annotations:', response);
      
      // Show success debug
      const successAlert = await this.alertController.create({
        header: 'Ã¢Å“â€¦ Upload Successful',
        message: `
          <div style="font-family: monospace; font-size: 11px;">
            <strong>Response:</strong><br>
            Ã¢â‚¬Â¢ AttachID: ${response?.AttachID || response?.PK_ID || 'N/A'}<br>
            Ã¢â‚¬Â¢ Photo Path: ${response?.Photo || 'N/A'}<br>
            Ã¢â‚¬Â¢ Full Response: ${JSON.stringify(response).substring(0, 200)}...
          </div>
        `,
        buttons: ['OK']
      });
      await successAlert.present();
      
      return response;  // Return the response with AttachID
      
    } catch (error: any) {
      console.error('Ã¢ÂÅ’ Failed to upload room point photo:', error);
      
      // Show detailed error debug popup
      const errorAlert = await this.alertController.create({
        header: 'Ã¢ÂÅ’ Upload Failed',
        message: `
          <div style="font-family: monospace; font-size: 11px; text-align: left;">
            <strong style="color: red;">ERROR DETAILS</strong><br><br>
            
            <strong>Error Message:</strong><br>
            ${error?.message || 'Unknown error'}<br><br>
            
            <strong>Error Object:</strong><br>
            ${JSON.stringify(error, null, 2).substring(0, 500)}<br><br>
            
            <strong>Upload Parameters Were:</strong><br>
            Ã¢â‚¬Â¢ Point ID: ${pointIdNum}<br>
            Ã¢â‚¬Â¢ Point Name: ${pointName}<br>
            Ã¢â‚¬Â¢ File: ${photo?.name} (${photo?.size} bytes)<br>
            Ã¢â‚¬Â¢ Annotations: ${annotationData ? 'Yes' : 'No'}<br><br>
            
            <strong>Possible Issues:</strong><br>
            Ã¢â‚¬Â¢ Check if PointID ${pointIdNum} exists<br>
            Ã¢â‚¬Â¢ Check if Drawings field accepts the data<br>
            Ã¢â‚¬Â¢ Check network/API connection
          </div>
        `,
        buttons: ['OK']
      });
      await errorAlert.present();
      
      throw error;
    }
  }
  
  // Toggle room selection - create or remove from Services_Rooms
  async toggleRoomSelection(roomName: string, event?: any) {
    // Only proceed if this is a real checkbox change event
    if (!event || !event.detail || typeof event.detail.checked === 'undefined') {
      console.log('Ignoring non-checkbox event');
      return;
    }
    
    const wasSelected = this.selectedRooms[roomName];
    const isSelected = event.detail.checked; // Use the event's checked value instead of toggling
    
    // If deselecting, ask for confirmation first
    if (wasSelected && !isSelected) {
      // Show confirmation dialog BEFORE changing state
      const confirmAlert = await this.alertController.create({
        header: 'Confirm Remove Room',
        message: `Are you sure you want to remove "${roomName}"? This will delete all photos and data for this room.`,
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            handler: () => {
              // User cancelled - revert the checkbox state
              event.target.checked = true; // Revert the checkbox visually
              this.selectedRooms[roomName] = true; // Keep it selected in our model
              return true;
            }
          },
          {
            text: 'Remove',
            cssClass: 'danger-button',
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
      if (this.roomRecordIds[roomName]) {
        console.log(`Room ${roomName} already exists with ID ${this.roomRecordIds[roomName]}, not creating duplicate`);
        this.selectedRooms[roomName] = true;
        this.expandedRooms[roomName] = false;
        return; // Room already exists, just update UI state
      }
      
      this.savingRooms[roomName] = true;
      
      try {
        // Create room in Services_Rooms
        const serviceIdNum = parseInt(this.serviceId, 10);
        
        // Validate ServiceID
        if (!this.serviceId || isNaN(serviceIdNum)) {
          await this.showToast(`Error: Invalid ServiceID (${this.serviceId})`, 'danger');
          this.savingRooms[roomName] = false;
          return;
        }
        
        // Send ServiceID and RoomName
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

        // Check if offline mode is enabled
        if (this.manualOffline) {
          console.log(`[Offline] Queuing room selection for ${roomName}`);
          this.pendingRoomCreates[roomName] = roomData;
          this.selectedRooms[roomName] = true;
          this.expandedRooms[roomName] = true;
          this.roomRecordIds[roomName] = '__pending__';
          this.savingRooms[roomName] = false;
          this.changeDetectorRef.detectChanges();
          return;
        }

        // Create room directly without debug popup
        try {
          const response = await this.caspioService.createServicesRoom(roomData).toPromise();
          
          if (response) {
            // Use RoomID from the response, NOT PK_ID
            const roomId = response.RoomID || response.roomId;
            if (!roomId) {
              console.error('No RoomID in response:', response);
              throw new Error('RoomID not found in response');
            }
            this.roomRecordIds[roomName] = roomId;
            this.selectedRooms[roomName] = true;
            this.expandedRooms[roomName] = true; // Expand when newly selected
            console.log(`Room created - Name: ${roomName}, RoomID: ${roomId}`);
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
  
  // Remove room from Services_Rooms
  async removeRoom(roomName: string) {
    this.savingRooms[roomName] = true;
    const roomId = this.roomRecordIds[roomName];
    
    if (roomId) {
      try {
        // Delete the room from Services_Rooms table
        await this.caspioService.deleteServicesRoom(roomId).toPromise();
        delete this.roomRecordIds[roomName];
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
          this.roomElevationData[roomName].fdf = 'None';
        }
        
        console.log(`Room ${roomName} deleted from Services_Rooms table`);
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
          console.log('Room selection cancelled');
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
          if (this.roomRecordIds[oldName]) {
            this.roomRecordIds[`${baseName} #1`] = this.roomRecordIds[oldName];
            delete this.roomRecordIds[oldName];
          }
          if (this.expandedRooms[oldName] !== undefined) {
            this.expandedRooms[`${baseName} #1`] = this.expandedRooms[oldName];
            delete this.expandedRooms[oldName];
          }
          
          nextNumber = 2; // The new room will be #2
        }
        
        roomName = `${baseName} #${nextNumber}`;
      }
      
      // Create a NEW template object (don't modify the original from allRoomTemplates)
      const roomToAdd = { ...template, RoomName: roomName };
      
      // Add to room templates list
      this.roomTemplates.push(roomToAdd);
      
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
          fdf: 'None',  // Default FDF value
          notes: ''  // Room-specific notes
        };
      }
      
      // Automatically expand the elevation section to show the new room
      this.expandedSections['elevation'] = true;
      
      // Automatically select the room (create Services_Rooms record)
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
        // Queue the room creation for later
        console.log(`[v1.4.505] Queuing room creation for ${roomName} (Auto-Save off)`);
        this.pendingRoomCreates[roomName] = roomData;
        this.selectedRooms[roomName] = true;
        this.expandedRooms[roomName] = true;
        this.roomRecordIds[roomName] = '__pending__'; // Mark as pending
        this.savingRooms[roomName] = false;
        // Success - room is queued and ready for points to be added
        console.log(`✅ Room "${roomName}" queued successfully (Auto-Save off)`);
        return; // Exit early - room is ready for use
      }

      // Only wrap API call in try-catch (not the offline logic)
      try {
        // Create room directly when online
        const response = await this.caspioService.createServicesRoom(roomData).toPromise();

        if (response) {
          // Use RoomID from the response, NOT PK_ID
          const roomId = response.RoomID || response.roomId;
          if (!roomId) {
            console.error('No RoomID in response:', response);
            throw new Error('RoomID not found in response');
          }
          this.roomRecordIds[roomName] = roomId;
          this.selectedRooms[roomName] = true;
          this.expandedRooms[roomName] = true; // Expand when newly added
          console.log(`Room created - Name: ${roomName}, RoomID: ${roomId}`);
        }
      } catch (error: any) {
        console.error('Room creation error:', error);
        await this.showToast('Failed to create room in database', 'danger');
        // Remove from templates if failed to create
        const index = this.roomTemplates.findIndex(r => r.RoomName === roomName);
        if (index > -1) {
          this.roomTemplates.splice(index, 1);
        }
      } finally {
        this.savingRooms[roomName] = false;
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
      header: 'Add Custom Point',
      inputs: [
        {
          name: 'pointName',
          type: 'text',
          placeholder: 'Enter point name',
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
              await this.showToast('Please enter a point name', 'warning');
              return false;
            }
            
            const pointName = data.pointName.trim();
            
            // Check if point already exists
            if (this.roomElevationData[roomName]?.elevationPoints) {
              const exists = this.roomElevationData[roomName].elevationPoints.some(
                (p: any) => p.name.toLowerCase() === pointName.toLowerCase()
              );
              
              if (exists) {
                await this.showToast('This point already exists', 'warning');
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
            const roomId = this.roomRecordIds[roomName];
            if (roomId) {
              const pointKey = `${roomName}_${pointName}`;

              // Check if room is pending or if offline mode is enabled
              if (roomId === '__pending__' || this.manualOffline) {
                // Queue the point creation - it depends on the room being created first
                console.log(`[v1.4.504] Queuing point creation for ${pointName} in ${roomName} (Auto-Save off or room pending)`);
                this.pendingPointCreates[pointKey] = {
                  roomName,
                  pointName,
                  dependsOnRoom: roomName // Track dependency
                };
                this.roomPointIds[pointKey] = '__pending__';
              } else {
                try {
                  const pointData = {
                    RoomID: parseInt(roomId),
                    PointName: pointName
                  };

                  const response = await this.caspioService.createServicesRoomsPoint(pointData).toPromise();
                  if (response && (response.PointID || response.PK_ID)) {
                    const pointId = response.PointID || response.PK_ID;
                    this.roomPointIds[pointKey] = pointId;
                    console.log(`Created custom point with PointID: ${pointId}`);
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
            
            console.log(`Added custom point: ${pointName} to room: ${roomName}`);
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
      
      console.log(`Filtered ${this.visualTemplates.length} templates for Foundation Evaluation (TypeID = 1)`);
      
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
      console.log('Categories in original order:', this.visualCategories);
      
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
            console.log(`Template with AnswerType 2: Name="${template.Name}", TemplateID=${template.TemplateID}, PK_ID=${template.PK_ID}`);
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
            templateId: String(template.TemplateID || template.PK_ID), // Use TemplateID field to match Services_Visuals_Drop, fallback to PK_ID
            selectedOptions: [] // For multi-select (AnswerType 2)
          };
          
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
      
      console.log('Visual categories loaded:', this.visualCategories);
      console.log('Organized data:', this.organizedData);
      console.log('Category templates:', this.categoryData);
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
        
        // Skip loading room elevation data to prevent issues
        
        console.log('Draft data loaded from localStorage');
      } catch (error) {
        console.error('Error loading draft data:', error);
      }
    }
  }
  
  async loadExistingVisualSelections(options?: { awaitPhotos?: boolean }): Promise<void> {
    const awaitPhotos = options?.awaitPhotos !== false;
    console.log('=====================================');
    console.log('LOADING EXISTING VISUAL SELECTIONS');
    console.log('=====================================');
    console.log('ServiceID:', this.serviceId);

    if (!this.serviceId) {
      console.log('No ServiceID - skipping load');
      return;
    }

    try {
      console.log('Fetching existing visuals from Services_Visuals...');
      const existingVisuals = await this.foundationData.getVisualsByService(this.serviceId);
      console.log('Existing visuals count:', existingVisuals?.length || 0);

      if (existingVisuals && Array.isArray(existingVisuals)) {
        existingVisuals.forEach(visual => {
          if (visual.Category && visual.Name) {
            const matchingTemplate = this.visualTemplates.find(t =>
              t.Category === visual.Category &&
              t.Name === visual.Name
            );

            if (matchingTemplate) {
              const key = visual.Category + "_" + matchingTemplate.PK_ID;
              this.selectedItems[key] = true;

              const visualId = visual.VisualID || visual.PK_ID || visual.id;
              this.visualRecordIds[key] = String(visualId);

              const updateItemData = (items: any[]) => {
                const item = items.find(i => i.id === matchingTemplate.PK_ID);
                if (!item) {
                  return;
                }

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
                } else {
                  item.text = visual.Text || "";
                }
              };

              if (this.organizedData[visual.Category]) {
                updateItemData(this.organizedData[visual.Category].comments);
                updateItemData(this.organizedData[visual.Category].limitations);
                updateItemData(this.organizedData[visual.Category].deficiencies);
              }
            }
          }
        });
      }

      console.log('Visual selections restored');
      console.log('Visual record IDs:', this.visualRecordIds);

      await new Promise(resolve => setTimeout(resolve, 500));

      console.log('Loading existing photos...');
      const photosPromise = this.loadExistingPhotos();

      if (awaitPhotos) {
        await photosPromise;
        console.log('Finished loading existing photos');
      } else {
        this.photoHydrationPromise = photosPromise.finally(() => {
          console.log('Finished loading existing photos (background)');
          this.photoHydrationPromise = null;
        });
      }
    } catch (error) {
      console.error('Error loading existing visual selections:', error);
    }
  }

  toggleSection(section: string) {
    this.expandedSections[section] = !this.expandedSections[section];
  }

  // Check if Structural Systems section should be disabled
  isStructuralSystemsDisabled(): boolean {
    return this.serviceData.StructuralSystemsStatus === 'Provided in Home Inspection Report';
  }

  // Handle custom "Other" value changes (called on blur, not on every keystroke)
  async onCustomOtherBlur(fieldName: string) {
    const customValue = this.customOtherValues[fieldName];

    if (!customValue || !customValue.trim()) {
      console.log(`No custom value entered for ${fieldName}`);
      return;
    }

    console.log(`Saving custom "Other" value for ${fieldName}: ${customValue}`);

    // Determine if this is a service field or project field
    const serviceFields = ['InAttendance', 'WeatherConditions', 'OutdoorTemperature', 'OccupancyFurnishings',
                           'FirstFoundationType', 'SecondFoundationType', 'ThirdFoundationType',
                           'SecondFoundationRooms', 'ThirdFoundationRooms', 'OwnerOccupantInterview'];
    const projectFields = ['TypeOfBuilding', 'Style'];

    // Update the local field value with custom text (so dropdown shows it)
    if (serviceFields.includes(fieldName)) {
      this.serviceData[fieldName] = customValue;
      // Also add to dropdown options if not already there
      this.addCustomOptionToDropdown(fieldName, customValue);
      await this.onServiceFieldChange(fieldName, customValue);
    } else if (projectFields.includes(fieldName)) {
      this.projectData[fieldName] = customValue;
      // Also add to dropdown options if not already there
      this.addCustomOptionToDropdown(fieldName, customValue);
      await this.onProjectFieldChange(fieldName, customValue);
    }
  }

  // Add custom value to dropdown options so it displays correctly
  addCustomOptionToDropdown(fieldName: string, customValue: string) {
    const dropdownMap: { [key: string]: string[] } = {
      'InAttendance': this.inAttendanceOptions,
      'WeatherConditions': this.weatherConditionsOptions,
      'OutdoorTemperature': this.outdoorTemperatureOptions,
      'OccupancyFurnishings': this.occupancyFurnishingsOptions,
      'FirstFoundationType': this.firstFoundationTypeOptions,
      'SecondFoundationType': this.secondFoundationTypeOptions,
      'ThirdFoundationType': this.thirdFoundationTypeOptions,
      'SecondFoundationRooms': this.secondFoundationRoomsOptions,
      'ThirdFoundationRooms': this.thirdFoundationRoomsOptions,
      'OwnerOccupantInterview': this.ownerOccupantInterviewOptions,
      'TypeOfBuilding': this.typeOfBuildingOptions,
      'Style': this.styleOptions
    };

    const options = dropdownMap[fieldName];
    if (options && !options.includes(customValue)) {
      // Add before "Other" option
      const otherIndex = options.indexOf('Other');
      if (otherIndex > -1) {
        options.splice(otherIndex, 0, customValue);
      } else {
        options.push(customValue);
      }
      console.log(`Added custom value "${customValue}" to ${fieldName} dropdown options`);
    }
  }

  // Load custom values from database into dropdown options (called after loading data)
  loadCustomValuesIntoDropdowns() {
    const fieldMappings = [
      { fieldName: 'InAttendance', dataSource: this.serviceData, options: this.inAttendanceOptions },
      { fieldName: 'WeatherConditions', dataSource: this.serviceData, options: this.weatherConditionsOptions },
      { fieldName: 'OutdoorTemperature', dataSource: this.serviceData, options: this.outdoorTemperatureOptions },
      { fieldName: 'OccupancyFurnishings', dataSource: this.serviceData, options: this.occupancyFurnishingsOptions },
      { fieldName: 'FirstFoundationType', dataSource: this.serviceData, options: this.firstFoundationTypeOptions },
      { fieldName: 'SecondFoundationType', dataSource: this.serviceData, options: this.secondFoundationTypeOptions },
      { fieldName: 'ThirdFoundationType', dataSource: this.serviceData, options: this.thirdFoundationTypeOptions },
      { fieldName: 'SecondFoundationRooms', dataSource: this.serviceData, options: this.secondFoundationRoomsOptions },
      { fieldName: 'ThirdFoundationRooms', dataSource: this.serviceData, options: this.thirdFoundationRoomsOptions },
      { fieldName: 'OwnerOccupantInterview', dataSource: this.serviceData, options: this.ownerOccupantInterviewOptions },
      { fieldName: 'TypeOfBuilding', dataSource: this.projectData, options: this.typeOfBuildingOptions },
      { fieldName: 'Style', dataSource: this.projectData, options: this.styleOptions }
    ];

    fieldMappings.forEach(mapping => {
      const value = mapping.dataSource?.[mapping.fieldName];
      if (value && value.trim() !== '' && !mapping.options.includes(value)) {
        // This is a custom value not in the standard options - add it
        const otherIndex = mapping.options.indexOf('Other');
        if (otherIndex > -1) {
          mapping.options.splice(otherIndex, 0, value);
        } else {
          mapping.options.push(value);
        }
        console.log(`Loaded custom value "${value}" for ${mapping.fieldName}`);
      }
    });
  }

  // Handle Structural Systems status change
  onStructuralSystemsStatusChange(value: string) {
    console.log(`[v1.4.501] Structural Systems status changed: ${value}`);

    // If set to "Provided in Home Inspection Report", collapse the section
    if (value === 'Provided in Home Inspection Report') {
      this.expandedSections['structural'] = false;
    }

    // Call the regular service field change handler
    this.onServiceFieldChange('StructuralSystemsStatus', value);
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
      }, 500);
    }
  }
  
  getBottomSpacerHeight(): number {
    // Check if any section is expanded
    const hasExpandedSection = Object.values(this.expandedSections).some(expanded => expanded);
    
    if (!hasExpandedSection) {
      // If no sections are expanded, minimal spacing
      return 20;
    }
    
    // Check which section is last expanded
    const sectionOrder = ['project', 'grading', 'structural', 'elevationPlot'];
    let lastExpandedSection = '';
    
    for (let i = sectionOrder.length - 1; i >= 0; i--) {
      if (this.expandedSections[sectionOrder[i]]) {
        lastExpandedSection = sectionOrder[i];
        break;
      }
    }
    
    // Adjust spacing based on the last expanded section
    switch (lastExpandedSection) {
      case 'elevationPlot':
        // Elevation plot has Add Room button with its own margin
        return 20;
      case 'structural':
      case 'grading':
      case 'project':
        // Regular sections need more spacing
        return 50;
      default:
        return 30;
    }
  }

  scrollToCurrentSectionTop() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const viewportTop = scrollTop;
    const viewportMiddle = scrollTop + (window.innerHeight / 2);
    
    console.log('Scroll Debug:', {
      scrollTop,
      viewportMiddle,
      expandedSections: this.expandedSections,
      expandedAccordions: this.expandedAccordions
    });
    
    // First check if we're in an expanded accordion item (category within Structural Systems)
    if (this.expandedSections['structural'] && this.expandedAccordions.length > 0) {
      // Get all accordions in the structural section
      const allAccordions = Array.from(document.querySelectorAll('.categories-container ion-accordion'));
      
      console.log('Found accordions:', allAccordions.length);
      
      // Find which expanded accordion we're currently viewing
      let closestAccordion: HTMLElement | null = null;
      let closestDistance = Infinity;
      let foundMatch = false;
      
      for (const accordion of allAccordions) {
        const accordionValue = accordion.getAttribute('value');
        
        // Only check expanded accordions
        if (this.expandedAccordions.includes(accordionValue || '')) {
          const accordionHeader = accordion.querySelector('ion-item[slot="header"]') as HTMLElement;
          const accordionContent = accordion.querySelector('.categories-content') as HTMLElement;
          
          if (accordionHeader) {
            const headerRect = accordionHeader.getBoundingClientRect();
            const accordionTop = headerRect.top + scrollTop;
            
            // Try to get actual content height
            let contentHeight = 0;
            if (accordionContent && accordionContent.offsetHeight > 0) {
              contentHeight = accordionContent.offsetHeight;
            } else {
              // Fallback: look for any content within the accordion
              const anyContent = accordion.querySelector('[slot="content"]') as HTMLElement;
              if (anyContent && anyContent.offsetHeight > 0) {
                contentHeight = anyContent.offsetHeight;
              }
            }
            
            const accordionBottom = accordionTop + headerRect.height + contentHeight;
            
            console.log(`Accordion ${accordionValue}:`, {
              top: accordionTop,
              bottom: accordionBottom,
              contentHeight,
              isInView: viewportMiddle >= accordionTop && viewportMiddle <= accordionBottom
            });
            
            // Check if we're viewing this accordion (viewport middle is within accordion bounds)
            if (viewportMiddle >= accordionTop && viewportMiddle <= accordionBottom) {
              // We're in this accordion!
              console.log(`Found! Scrolling to ${accordionValue}`);
              accordionHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
              foundMatch = true;
              return;
            }
            
            // Track closest accordion as fallback
            const distance = Math.abs(accordionTop - viewportTop);
            if (distance < closestDistance) {
              closestDistance = distance;
              closestAccordion = accordionHeader;
            }
          }
        }
      }
      
      // If we found a close accordion, scroll to it
      if (!foundMatch && closestAccordion) {
        console.log('Using closest accordion as fallback');
        closestAccordion.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    
    // Check if we're in an expanded room (within Elevation Plot)
    if (this.expandedSections['elevation']) {
      const roomAccordions = Array.from(document.querySelectorAll('.room-elevations-container ion-accordion'));
      
      for (let i = 0; i < roomAccordions.length; i++) {
        const roomAccordion = roomAccordions[i] as HTMLElement;
        const roomHeader = roomAccordion.querySelector('ion-item[slot="header"]') as HTMLElement;
        const roomContent = roomAccordion.querySelector('.elevation-content') as HTMLElement;
        
        // Check if room is expanded by checking if content has height
        if (roomHeader && roomContent && roomContent.offsetHeight > 0) {
          const rect = roomHeader.getBoundingClientRect();
          const roomTop = rect.top + scrollTop;
          
          // Find next boundary
          let roomBottom = document.documentElement.scrollHeight;
          if (i < roomAccordions.length - 1) {
            const nextRoom = roomAccordions[i + 1] as HTMLElement;
            const nextRect = nextRoom.getBoundingClientRect();
            roomBottom = nextRect.top + scrollTop;
          }
          
          // Check if we're within this room's bounds
          if (viewportMiddle >= roomTop && viewportMiddle < roomBottom) {
            // Scroll to the room header
            roomHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
          }
        }
      }
    }
    
    // Otherwise, check main sections
    const sections = ['project', 'structural', 'elevation'];
    for (const section of sections) {
      const sectionHeader = document.querySelector(`.section-header[data-section="${section}"]`) as HTMLElement;
      
      if (sectionHeader) {
        const rect = sectionHeader.getBoundingClientRect();
        const sectionTop = rect.top + scrollTop;
        const nextSection = sections[sections.indexOf(section) + 1];
        let sectionBottom = document.documentElement.scrollHeight;
        
        if (nextSection) {
          const nextHeader = document.querySelector(`.section-header[data-section="${nextSection}"]`) as HTMLElement;
          if (nextHeader) {
            const nextRect = nextHeader.getBoundingClientRect();
            sectionBottom = nextRect.top + scrollTop;
          }
        }
        
        // Check if we're within this section's bounds
        if (viewportMiddle >= sectionTop && viewportMiddle < sectionBottom) {
          // Scroll to this section's header
          sectionHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
      }
    }
    
    // If no section found, scroll to top of page
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  
  // TrackBy functions for better list performance
  trackByCategory(index: number, item: any): any {
    return item || index;
  }
  
  trackByTemplateId(index: number, item: any): any {
    return item.TemplateID || index;
  }
  
  trackByRoomName(index: number, item: any): any {
    return item.RoomName || index;
  }
  
  // Track which accordions are expanded
  onAccordionChange(event: any) {
    console.log('Accordion changed:', event.detail.value);

    // Capture scroll position IMMEDIATELY
    const savedScroll = window.scrollY;

    // Create a scroll lock that will override any Ionic scroll attempts
    const scrollLock = () => {
      window.scrollTo(0, savedScroll);
    };

    // Add scroll listener to prevent ANY scrolling during accordion animation
    window.addEventListener('scroll', scrollLock, { passive: false });

    if (event.detail.value) {
      // Store the expanded accordion value
      this.expandedAccordions = Array.isArray(event.detail.value)
        ? event.detail.value
        : [event.detail.value];
    } else {
      this.expandedAccordions = [];
    }

    // Keep scroll locked for the duration of the animation (300ms is Ionic's default)
    setTimeout(() => {
      window.removeEventListener('scroll', scrollLock);
    }, 350);
  }
  
  onRoomAccordionChange(event: any) {
    console.log('Room accordion changed:', event.detail.value);
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
    const roomId = this.roomRecordIds[roomName];
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
        
        // Update Services_Rooms record with Notes using RoomID field
        const updateData = { Notes: notes };
        const query = `RoomID=${roomId}`;
        
        await this.caspioService.put(`/tables/Services_Rooms/records?q.where=${encodeURIComponent(query)}`, updateData).toPromise();
        
        console.log(`Updated Notes for room ${roomName}`);
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
    console.log(`Elevation changed for ${roomName} - ${point.name}: ${point.value}`);
    
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
    
    console.log(`Taking photo for elevation point: ${roomName} - ${point.name}`);
    
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
        
        console.log(`Added ${files.length} photo(s) to ${point.name}. Total: ${point.photoCount}`);
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
      console.log('Save room photo caption:', photo.annotation, 'for', point.name, 'AttachID:', photo.attachId);
      
      // Update Services_Rooms_Points_Attach record with annotation
      if (photo.attachId && photo.annotation !== undefined) {
        // Update the annotation in the database
        const updateData = { Annotation: photo.annotation || '' };
        await this.caspioService.updateServicesRoomsPointsAttach(photo.attachId, updateData).toPromise();
        console.log('Updated attachment', photo.attachId, 'with annotation:', updateData.Annotation);
      }
      
      // Don't show toast for every blur event
    } catch (error) {
      console.error('Error saving room photo caption:', error);
      // Don't show error toast for every blur
    }
  }
  
  // Delete room photo
  async deleteRoomPhoto(photo: any, roomName: string, point: any) {
    try {
      // Confirm deletion
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
            cssClass: 'danger-button',
            handler: async () => {
              try {
                // Delete from Services_Rooms_Points_Attach table if attachId exists
                if (photo.attachId) {
                  await this.caspioService.deleteServicesRoomsPointsAttach(photo.attachId).toPromise();
                  console.log('Deleted room photo attachment:', photo.attachId);
                }
                
                // Remove from point's photos array
                if (point.photos) {
                  const index = point.photos.indexOf(photo);
                  if (index > -1) {
                    point.photos.splice(index, 1);
                    point.photoCount = point.photos.length;
                  }
                }
                
                console.log('Room photo deleted successfully');
              } catch (error) {
                console.error('Error deleting room photo:', error);
                await this.showToast('Failed to delete photo', 'danger');
              }
            }
          }
        ]
      });
      
      await alert.present();
    } catch (error) {
      console.error('Error in deleteRoomPhoto:', error);
    }
  }
  
  // Update room point photo attachment with annotations (similar to updatePhotoAttachment for Structural Systems)
  async updateRoomPointPhotoAttachment(attachId: string, file: File, annotations?: any, originalFile?: File): Promise<void> {
    try {
      console.log('Updating room point photo attachment with annotations:', {
        attachId,
        hasAnnotations: !!annotations,
        hasOriginalFile: !!originalFile
      });
      
      // Validate attachId
      if (!attachId || attachId === 'undefined' || attachId === 'null') {
        console.error('Invalid AttachID for room point photo:', attachId);
        await this.showToast('Cannot update photo: Invalid attachment ID', 'danger');
        return;
      }
      
      // Prepare update data with Drawings field
      const updateData: any = {};
      
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
      
      // Update the Services_Rooms_Points_Attach record
      if (Object.keys(updateData).length > 0) {
        await this.caspioService.updateServicesRoomsPointsAttach(attachId, updateData).toPromise();
        console.log('Room point photo attachment updated successfully');
      }
      
    } catch (error) {
      console.error('Error updating room point photo attachment:', error);
      await this.showToast('Failed to update photo annotations', 'danger');
      throw error;
    }
  }
  
  // View elevation photo with annotation support (matching Structural Systems)
  async viewElevationPhoto(photo: any, roomName?: string, point?: any) {
    console.log('Viewing elevation photo with annotation support:', {
      photo,
      hasUrl: !!photo.url,
      hasThumbnailUrl: !!photo.thumbnailUrl,
      hasOriginalUrl: !!photo.originalUrl,
      hasFilePath: !!photo.filePath,
      attachId: photo.attachId || photo.AttachID || photo.id
    });
    
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
        console.log('No valid URL found, fetching from file path:', photo.filePath);
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
      
      console.log('Using image URLs:', {
        imageUrl,
        originalImageUrl,
        isBase64: imageUrl.startsWith('data:')
      });
      
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
              console.log('Found valid annotations for elevation photo');
              break;
            }
          } catch (e) {
            console.log('Failed to parse annotations:', e);
          }
        }
      }
      
      // Open annotation modal directly (matching Structural Systems)
      const modal = await this.modalController.create({
        component: FabricPhotoAnnotatorComponent,
        componentProps: {
          imageUrl: originalImageUrl,
          existingAnnotations: existingAnnotations,
          photoData: {
            ...photo,
            AttachID: attachId,
            id: attachId
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
        
        // Update the attachment with new annotations
        await this.updateRoomPointPhotoAttachment(attachId, annotatedFile, annotationsData, originalFile);
        
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
            
            // Store annotations data
            if (annotationsData) {
              point.photos[photoIndex].annotations = annotationsData;
              point.photos[photoIndex].rawDrawingsString = typeof annotationsData === 'object' 
                ? JSON.stringify(annotationsData) 
                : annotationsData;
            }
          }
        }
        
        // Trigger change detection
        this.changeDetectorRef.detectChanges();
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
      console.log('Draft saved at', new Date().toLocaleTimeString());
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
    const requiredProjectFields = ['ClientName', 'AgentName', 'InspectorName', 
                                    'YearBuilt', 'SquareFeet', 'TypeOfBuilding', 'Style'];
    const requiredServiceFields = ['InAttendance', 'OccupancyFurnishings', 'WeatherConditions', 'OutdoorTemperature'];
    
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
    
    // Validate other required fields
    if (!this.formData.foundationType || !this.formData.foundationCondition) {
      await this.showToast('Please fill in foundation type and condition', 'warning');
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
      
      console.log('Submitting template data:', submitData);
      
      // For now, just simulate success
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      await loading.dismiss();
      await this.showToast('Evaluation submitted successfully', 'success');
      
      // Clear draft
      const draftKey = `efe_template_${this.projectId}_${this.serviceId}`;
      localStorage.removeItem(draftKey);
      
      // Navigate back
      this.router.navigate(['/project-detail', this.projectId]);
      
    } catch (error) {
      console.error('Error submitting template:', error);
      await loading.dismiss();
      await this.showToast('Failed to submit evaluation', 'danger');
    }
  }

  // Prevent touch event bubbling
  preventTouch(event: TouchEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  // v1.4.389 - Simple test method for PDF button
  async testPDFButton() {
    console.log('[v1.4.389] testPDFButton called!');
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
    console.log('[v1.4.389] Ensuring PDF button works...');
    const pdfButton = document.querySelector('.pdf-header-button') as HTMLButtonElement;
    if (pdfButton) {
      console.log('[v1.4.389] Found PDF button, adding direct listener');

      // Remove any existing listeners first
      const newButton = pdfButton.cloneNode(true) as HTMLButtonElement;
      pdfButton.parentNode?.replaceChild(newButton, pdfButton);

      // Add direct event listener
      newButton.addEventListener('click', async (e) => {
        console.log('[v1.4.389] PDF button clicked via direct listener');
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
        console.log('[v1.4.389] PDF button touched');
        e.preventDefault();
        e.stopPropagation();
      });

      console.log('[v1.4.389] Direct listeners added to PDF button');
    } else {
      console.error('[v1.4.389] PDF button not found in DOM!');

      // Try to find it by other means
      const allButtons = document.querySelectorAll('button');
      console.log('[v1.4.389] Found', allButtons.length, 'buttons total');
      allButtons.forEach((btn, index) => {
        if (btn.textContent?.includes('PDF')) {
          console.log(`[v1.4.389] Found PDF button at index ${index}:`, btn.className);
        }
      });
    }
  }

  // Add ionViewDidEnter hook to ensure button is ready
  ionViewDidEnter() {
    console.log('[v1.4.389] View entered, ensuring PDF button works');
    setTimeout(() => {
      this.ensurePDFButtonWorks();
    }, 500);
  }

  // New handler for PDF button click
  async handlePDFClick(event: Event) {
    console.log('[v1.4.388] PDF button clicked via handlePDFClick');

    // Add comprehensive debugging
    try {
      // Show immediate visual feedback

      // Log current state
      console.log('[v1.4.388] Current state:', {
        serviceId: this.serviceId,
        projectId: this.projectId,
        isPDFGenerating: this.isPDFGenerating,
        hasLoadingController: !!this.loadingController,
        hasModalController: !!this.modalController,
        hasCaspioService: !!this.caspioService,
        projectData: this.projectData ? Object.keys(this.projectData) : 'null',
        serviceData: this.serviceData ? Object.keys(this.serviceData) : 'null'
      });

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
    console.log('[v1.4.402] generatePDF called, projectId:', this.projectId, 'serviceId:', this.serviceId);

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
        console.log('[v1.4.397] Preventing form submission');
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

        console.log('[v1.4.390] Route params:', { routeServiceId, routeProjectId });

        if (routeServiceId && routeProjectId) {
          this.serviceId = routeServiceId;
          this.projectId = routeProjectId;
          console.log('[v1.4.390] Recovered IDs from route:', { serviceId: this.serviceId, projectId: this.projectId });
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
        console.log('[v1.4.390] IDs present:', { serviceId: this.serviceId, projectId: this.projectId });
      }
      
      // Validate all required Project Information fields before generating PDF
    const requiredProjectFields = ['ClientName', 'AgentName', 'InspectorName', 
                                    'YearBuilt', 'SquareFeet', 'TypeOfBuilding', 'Style'];
    const requiredServiceFields = ['InAttendance', 'OccupancyFurnishings', 'WeatherConditions', 'OutdoorTemperature'];
    
    const missingProjectFields = requiredProjectFields.filter(field => !this.projectData[field]);
    const missingServiceFields = requiredServiceFields.filter(field => !this.serviceData[field]);
    
    if (missingProjectFields.length > 0 || missingServiceFields.length > 0) {
      const allMissing = [...missingProjectFields, ...missingServiceFields];
      console.warn('[v1.4.402] Please fill in all required fields before generating PDF:', allMissing.join(', '));
      
      // Scroll to Project Information section if there are missing fields
      const projectSection = document.querySelector('.section-card');
      if (projectSection) {
        projectSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      
      // Reset the generation flag and button state before returning
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
    
    // Create a single loading indicator that stays until PDF is ready
    console.log('[v1.4.390] Creating loading indicator...');

    let loading: any = null;
    try {
      loading = await this.loadingController.create({
        message: 'Loading PDF...',
        spinner: 'crescent',
        backdropDismiss: false
      });
      console.log('[v1.4.390] Loading indicator created successfully');
      await loading.present();
      console.log('[v1.4.390] Loading indicator presented');
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
        console.log('Ã°Å¸â€œÂ¦ Using cached PDF data');
        ({ structuralSystemsData, elevationPlotData, projectInfo } = cachedData);
      } else {
        // Load all data in parallel for maximum speed
        console.log('[v1.4.338] Loading PDF data...');
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
          
          console.log(`[v1.4.338] All data loaded in ${Date.now() - startTime}ms`);
          
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
      
      // Create the modal with animation disabled for first attempt to prevent conflicts
      console.log('[v1.4.390] Creating PDF modal...');

      const PdfPreviewComponent = await this.loadPdfPreview();

      // Check if PdfPreviewComponent is available
      if (!PdfPreviewComponent) {
        console.error('[v1.4.390] PdfPreviewComponent is not available!');
        throw new Error('PdfPreviewComponent not available');
      }

      let modal;
      try {
        console.log('[v1.4.390] Component info:', {
          componentName: PdfPreviewComponent.name,
          componentType: typeof PdfPreviewComponent,
          hasModalController: !!this.modalController
        });

        modal = await this.modalController.create({
          component: PdfPreviewComponent,
          componentProps: {
            projectData: projectInfo,
            structuralData: structuralSystemsData,
            elevationData: elevationPlotData,
            serviceData: this.serviceData
          },
          cssClass: 'fullscreen-modal',
          animated: this.pdfGenerationAttempts > 1, // Disable animation on first attempt
          mode: 'ios', // Force iOS mode for consistency
          backdropDismiss: false // Prevent accidental dismissal
        });
        console.log('[v1.4.390] Modal created successfully');
      } catch (modalCreateError) {
        console.error('[v1.4.390] Error creating modal:', modalCreateError);
        throw modalCreateError;
      }
      
      // Wait a moment before presenting to ensure DOM is ready
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Present the modal with error handling
      try {
        await modal.present();
        console.log('[v1.4.338] Modal presented successfully on attempt #' + this.pdfGenerationAttempts);
        
        // Dismiss loading after modal is presented
        // Add a small delay to ensure smooth transition
        setTimeout(async () => {
          try {
            if (loading) await loading.dismiss();
            console.log('[v1.4.338] Loading dismissed after modal presentation');
          } catch (dismissError) {
            console.log('[v1.4.338] Loading already dismissed');
          }
        }, 300);
        
      } catch (modalError) {
        console.error('[v1.4.338] Error presenting modal:', modalError);
        // Try to dismiss loading on error
        try {
          if (loading) await loading.dismiss();
        } catch (dismissError) {
          console.log('[v1.4.338] Loading already dismissed');
        }
        throw modalError;
      }
      
      // Wait for modal to be dismissed before re-enabling button
      modal.onDidDismiss().then(() => {
        console.log('[v1.4.338] PDF modal dismissed, re-enabling button');
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
      
      console.log('[v1.4.338] PDF generation completed successfully on attempt #' + this.pdfGenerationAttempts);
      
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
        console.log('[v1.4.388] Loading already dismissed');
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
      console.warn('Pending photo uploads waiting for numeric VisualID. Current value:', visualId);
      return;
    }

    const uploads = [...pendingUploads];
    delete this.pendingPhotoUploads[key];

    for (const upload of uploads) {
      const keyPhotos = this.visualPhotos[key] || [];
      const photoIndex = keyPhotos.findIndex((p: any) => p.id === upload.tempId);

      if (photoIndex !== -1) {
        keyPhotos[photoIndex].uploading = true;
        keyPhotos[photoIndex].queued = false;
      }

      try {
        await this.performVisualPhotoUpload(
          visualIdNum,
          upload.file,
          key,
          upload.isBatchUpload,
          upload.annotationData,
          upload.originalPhoto || null,
          upload.tempId
        );
      } catch (error) {
        console.error('Failed to upload queued photo after sync resumed:', error);
        if (photoIndex !== -1) {
          keyPhotos[photoIndex].uploading = false;
          keyPhotos[photoIndex].queued = false;
          keyPhotos[photoIndex].failed = true;
        }
        await this.showToast('Queued photo failed to sync. Please retry.', 'danger');
      }
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

    // If turning auto-save back ON, process pending rooms and points
    if (wasOffline && !newState) {
      console.log('[v1.4.504] Auto-Save enabled - processing pending rooms and points');
      this.processPendingRoomsAndPoints();
    }
    // No toast needed - button state is self-explanatory
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
        console.log(`[v1.4.504] Creating ${roomNames.length} pending rooms...`);

        for (const roomName of roomNames) {
          const roomData = this.pendingRoomCreates[roomName];
          try {
            console.log(`[v1.4.504] Creating room: ${roomName}`);
            const response = await this.caspioService.createServicesRoom(roomData).toPromise();

            if (response) {
              const roomId = response.RoomID || response.roomId;
              if (roomId) {
                this.roomRecordIds[roomName] = roomId;
                delete this.pendingRoomCreates[roomName];
                console.log(`✅ [v1.4.504] Room created: ${roomName}, RoomID: ${roomId}`);
              }
            }
          } catch (error) {
            console.error(`❌ [v1.4.504] Failed to create room ${roomName}:`, error);
            await this.showToast(`Failed to create room: ${roomName}`, 'danger');
          }
        }
      }

      // Step 2: Create pending points for rooms that now have IDs
      const pointKeys = Object.keys(this.pendingPointCreates);
      if (pointKeys.length > 0) {
        console.log(`[v1.4.504] Creating ${pointKeys.length} pending points...`);

        for (const pointKey of pointKeys) {
          const pointInfo = this.pendingPointCreates[pointKey];
          const roomId = this.roomRecordIds[pointInfo.roomName];

          // Only create point if room was successfully created
          if (roomId && roomId !== '__pending__') {
            try {
              const pointData = {
                RoomID: parseInt(roomId),
                PointName: pointInfo.pointName
              };

              console.log(`[v1.4.504] Creating point: ${pointInfo.pointName} for room: ${pointInfo.roomName}`);
              const response = await this.caspioService.createServicesRoomsPoint(pointData).toPromise();

              if (response && (response.PointID || response.PK_ID)) {
                const pointId = response.PointID || response.PK_ID;
                this.roomPointIds[pointKey] = pointId;
                delete this.pendingPointCreates[pointKey];
                console.log(`✅ [v1.4.504] Point created: ${pointInfo.pointName}, PointID: ${pointId}`);
              }
            } catch (error) {
              console.error(`❌ [v1.4.504] Failed to create point ${pointInfo.pointName}:`, error);
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
              this.showToast('Debug info copied to clipboard', 'success');
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
  
  getProjectCompletion(): number {
    // Calculate project details completion percentage for required fields only
    
    // Required fields from projectData
    const requiredProjectFields = [
      'ClientName',
      'AgentName', 
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
    console.log('=====================================');
    console.log('Ã°Å¸â€â€ž TOGGLE ITEM SELECTION CALLED');
    console.log('=====================================');
    console.log('   Category:', category);
    console.log('   ItemID:', itemId);
    
    const key = `${category}_${itemId}`;
    const wasSelected = this.selectedItems[key];
    
    console.log('   Key:', key);
    console.log('   Was Selected:', wasSelected);
    console.log('   Will be Selected:', !wasSelected);
    
    // Set saving state
    this.savingItems[key] = true;
    
    this.selectedItems[key] = !wasSelected;
    
    // Update the categoryData as well
    if (this.categoryData[category] && this.categoryData[category][itemId]) {
      this.categoryData[category][itemId].selected = this.selectedItems[key];
    }
    
    console.log('Ã¢Å“â€¦ Item toggled:', key, 'New state:', this.selectedItems[key]);
    
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
    return item.selectedOptions.includes(option);
  }
  
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
      console.log('Visual create already in progress for', key);
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
    console.log('Multi-select changed (DEBUG):', category, item.name, item.selectedOptions);
    
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
            (answersText ? 'Ã¢Å¾â€¢ CREATE new Services_Visuals record' : 'Ã¢Å¡Â Ã¯Â¸Â No action - no selections')}<br>
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
          // Update existing record - only update the Answers field
          console.log('Updating existing visual with new selections:', answersText);
          const updateData = {
            Answers: answersText
          };
          
          try {
            await this.caspioService.updateServicesVisual(existingVisualId, updateData).toPromise();
            console.log('Ã¢Å“â€¦ Updated Services_Visuals Answers field with selections');
            
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
          // Create new record with selections in Answers field
          console.log('Creating new visual with selections:', answersText);
          
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
                <strong style="color: blue;">Ã¢Å¾â€¢ CREATING Services_Visuals</strong><br><br>
                
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
          console.log('Clearing selections from existing visual');
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
  
  /* DUPLICATE FUNCTION - COMMENTED OUT TO FIX TS2393
  // Check if an option is selected for a multi-select item
  isOptionSelectedV1_DUPLICATE(item: any, option: string): boolean {
    if (!item.selectedOptions || !Array.isArray(item.selectedOptions)) {
      return false;
    }
    return item.selectedOptions.includes(option);
  }
  */
  
  /* DUPLICATE FUNCTION - COMMENTED OUT TO FIX TS2393
  // Handle toggling an option in multi-select
  async onOptionToggle_DUPLICATE(category: string, item: any, option: string, event: any) {
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
  */
  
  /* DUPLICATE FUNCTION - COMMENTED OUT TO FIX TS2393  
  // Save visual selection to Services_Visuals table
  async saveVisualSelection_DUPLICATE(category: string, templateId: string) {
    console.log('=====================================');
    console.log('Ã°Å¸â€Â SAVING VISUAL TO SERVICES_VISUALS');
    console.log('=====================================');
    
    if (!this.serviceId) {
      console.error('Ã¢ÂÅ’ No ServiceID available for saving visual');
      return;
    }
    
    console.log('Ã°Å¸â€œâ€¹ Input Parameters:');
    console.log('   Category:', category);
    console.log('   TemplateID:', templateId);
    
    // Find the template data first
    const template = this.visualTemplates.find(t => t.PK_ID === templateId);
    if (!template) {
      console.error('Ã¢ÂÅ’ Template not found:', templateId);
      return;
    }
    
    // Check if this visual already exists
    const key = `${category}_${templateId}`;
    if (this.visualRecordIds[key]) {
      console.log('Ã¢Å¡Â Ã¯Â¸Â Visual already exists with ID:', this.visualRecordIds[key]);
      console.log('   Skipping duplicate save');
      return;
    }
    
    // Also check if it exists in the database but wasn't loaded yet
    try {
      const existingVisuals = await this.foundationData.getVisualsByService(this.serviceId);
      if (existingVisuals) {
        const exists = existingVisuals.find((v: any) => 
          v.Category === category && 
          v.Name === template.Name
        );
        if (exists) {
          console.log('Ã¢Å¡Â Ã¯Â¸Â Visual already exists in database:', exists);
          // Store the ID for future reference - ALWAYS as string
          const existingId = exists.VisualID || exists.PK_ID || exists.id;
          this.visualRecordIds[key] = String(existingId);
          console.log('   Stored existing ID:', this.visualRecordIds[key], 'Type:', typeof this.visualRecordIds[key]);
          return;
        }
      }
    } catch (error) {
      console.error('Error checking for existing visual:', error);
    }
    
    console.log('Ã°Å¸â€œâ€ž Template Found:', template);
    
    // Convert ServiceID to number (Caspio expects Integer type)
    const serviceIdNum = parseInt(this.serviceId, 10);
    if (isNaN(serviceIdNum)) {
      console.error('Ã¢ÂÅ’ Invalid ServiceID - not a number:', this.serviceId);
      await this.showToast('Invalid Service ID', 'danger');
      return;
    }
    
    // Get the item data to access answerType and answers
    let answers = '';
    let textValue = template.Text || '';
    
    // Find the item in organizedData to get current values
    const findItem = (items: any[]) => items.find(i => i.id === templateId);
    let item = null;
    
    if (this.organizedData[category]) {
      item = findItem(this.organizedData[category].comments) ||
             findItem(this.organizedData[category].limitations) ||
             findItem(this.organizedData[category].deficiencies);
    }
    
    if (item) {
      // Check if we have answerToSave (set by onAnswerChange or onMultiSelectChange)
      if (item.answerToSave) {
        answers = item.answerToSave;
        textValue = item.originalText || template.Text || ''; // Keep original text in Text field
        console.log('Ã°Å¸â€œÂ Using answerToSave:', answers);
      }
      // For AnswerType 1 (Yes/No), store the answer in Answers field
      else if (item.answerType === 1 && item.answer) {
        answers = item.answer; // Will be 'Yes' or 'No'
        textValue = item.originalText || template.Text || ''; // Keep original text in Text field
      }
      // For AnswerType 2 (multi-select), store comma-delimited answers
      else if (item.answerType === 2 && item.selectedOptions && item.selectedOptions.length > 0) {
        answers = item.selectedOptions.join(', ');
        textValue = item.originalText || template.Text || ''; // Keep original text in Text field
      }
      // For AnswerType 0 or undefined (text), use the text field as is
      else {
        textValue = item.text || template.Text || '';
      }
    }
    
    // ONLY include the columns that exist in Services_Visuals table
    const visualData: ServicesVisualRecord = {
      ServiceID: serviceIdNum,  // Integer type in Caspio
      Category: category || '',   // Text(255) in Caspio
      Kind: template.Kind || '',  // Text(255) in Caspio - was Type, now Kind
      Name: template.Name || '',  // Text(255) in Caspio
      Text: textValue,   // Text field in Caspio - the full text content
      Notes: ''                    // Text(255) in Caspio - empty for now
    };
    
    // Add Answers field if there are answers to store
    if (answers) {
      visualData.Answers = answers;
    }
    
    
    try {
      console.log('Ã¢ÂÂ³ Calling caspioService.createServicesVisual...');
      const response = await this.caspioService.createServicesVisual(visualData).toPromise();
      console.log('Ã¢Å“â€¦ Visual saved to Services_Visuals:', response);
      console.log('Ã¢Å“â€¦ Response details:', JSON.stringify(response, null, 2));
      
      // Skip debug popup for faster performance
      // await this.showVisualCreationDebug(category, templateId, response);
      
      // Check if response exists (even if empty, it might mean success)
      // Caspio sometimes returns empty response on successful POST
      if (response === undefined || response === null || response === '') {
        console.log('Ã¢Å¡Â Ã¯Â¸Â Empty response received - treating as success (common with Caspio)');
        // Generate a temporary ID for tracking
        const tempId = `temp_${Date.now()}`;
        const recordKey = `visual_${category}_${templateId}`;
        localStorage.setItem(recordKey, tempId);
        this.visualRecordIds[`${category}_${templateId}`] = String(tempId);
        
        // Query the table to get the actual VisualID
        setTimeout(async () => {
          await this.refreshVisualId(category, templateId);
        }, 1000);
        
        console.log('Ã¢Å“â€¦ Visual appears to be saved (will verify)');
        return; // Exit successfully
      }
      
      // Store the record ID for potential deletion later
      // Response should have the created record
      let visualId: any;
      
      // If response is an array, get the first item
      // IMPORTANT: Use VisualID, not PK_ID for Services_Visuals table
      if (Array.isArray(response) && response.length > 0) {
        visualId = response[0].VisualID || response[0].PK_ID || response[0].id;
        console.log('Ã°Å¸â€œâ€¹ Response was array, extracted ID from first item:', visualId);
        console.log('   - VisualID:', response[0].VisualID, '(preferred)');
        console.log('   - PK_ID:', response[0].PK_ID, '(not used if VisualID exists)');
      } else if (response && typeof response === 'object') {
        // If response has Result array (Caspio pattern)
        if (response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
          visualId = response.Result[0].VisualID || response.Result[0].PK_ID || response.Result[0].id;
          console.log('Ã°Å¸â€œâ€¹ Response had Result array, extracted ID:', visualId);
          console.log('   - VisualID:', response.Result[0].VisualID, '(preferred)');
          console.log('   - PK_ID:', response.Result[0].PK_ID, '(not used if VisualID exists)');
        } else {
          // Direct object response
          visualId = response.VisualID || response.PK_ID || response.id;
          console.log('Ã°Å¸â€œâ€¹ Response was object, extracted ID:', visualId);
          console.log('   - VisualID:', response.VisualID, '(preferred)');
          console.log('   - PK_ID:', response.PK_ID, '(not used if VisualID exists)');
        }
      } else {
        // Response might be the ID itself
        visualId = response;
        console.log('Ã°Å¸â€œâ€¹ Response was ID directly:', visualId);
      }
      
      console.log('Ã°Å¸â€Â Full response object:', JSON.stringify(response, null, 2));
      console.log('Ã°Å¸â€Â Extracted VisualID:', visualId);
      
      const recordKey = `visual_${category}_${templateId}`;
      localStorage.setItem(recordKey, String(visualId));
      
      // Store in our tracking object for photo uploads
      this.visualRecordIds[`${category}_${templateId}`] = String(visualId);
      console.log('Ã°Å¸â€œÅ’ Visual Record ID stored:', visualId, 'for key:', `${category}_${templateId}`);
      
    } catch (error: any) {
      console.error('Ã¢Å¡Â Ã¯Â¸Â Error during save (checking if actually failed):', error);
      console.error('=====================================');
      console.error('ERROR DETAILS:');
      console.error('   Status:', error?.status);
      console.error('   Status Text:', error?.statusText);
      console.error('   Message:', error?.message);
      console.error('   Error Body:', error?.error);
      console.error('=====================================');
      
      // Show debug alert for the error
      const errorAlert = await this.alertController.create({
        header: 'Visual Save Error',
        message: `
          <div style="text-align: left; font-family: monospace; font-size: 12px;">
            <strong style="color: red;">Ã¢ÂÅ’ FAILED TO SAVE VISUAL</strong><br><br>
            
            <strong>Data Sent:</strong><br>
            Ã¢â‚¬Â¢ ServiceID: ${visualData.ServiceID}<br>
            Ã¢â‚¬Â¢ Category: ${visualData.Category}<br>
            Ã¢â‚¬Â¢ Kind: ${visualData.Kind}<br>
            Ã¢â‚¬Â¢ Name: ${visualData.Name}<br>
            Ã¢â‚¬Â¢ Text: ${visualData.Text?.substring(0, 50)}...<br>
            Ã¢â‚¬Â¢ Notes: ${visualData.Notes}<br><br>
            
            <strong>Error Details:</strong><br>
            Ã¢â‚¬Â¢ Status: ${error?.status || 'No status'}<br>
            Ã¢â‚¬Â¢ Status Text: ${error?.statusText || 'Unknown'}<br>
            Ã¢â‚¬Â¢ Message: ${error?.message || 'No message'}<br><br>
            
            <strong>Error Body:</strong><br>
            <div style="background: #ffe0e0; padding: 10px; border-radius: 5px; max-height: 150px; overflow-y: auto;">
              ${JSON.stringify(error?.error || error, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
            </div>
          </div>
        `,
        buttons: ['OK']
      });
      await errorAlert.present();
      
      // Check if it's a real error or just a response parsing issue
      // Status 200-299 means success even if response parsing failed
      if (error?.status >= 200 && error?.status < 300) {
        console.log('Ã¢Å“â€¦ Request was successful (status 2xx) - ignoring response parsing error');
        // Treat as success
        const tempId = `temp_${Date.now()}`;
        const recordKey = `visual_${category}_${templateId}`;
        localStorage.setItem(recordKey, tempId);
        this.visualRecordIds[`${category}_${templateId}`] = String(tempId);
        
        // Try to get the real ID
        setTimeout(async () => {
          await this.refreshVisualId(category, templateId);
        }, 1000);
        
        // Success toast removed per user request
        return; // Keep the checkbox selected
      }
      
      // Check for specific error types
      if (error?.status === 400) {
        console.error('Ã¢Å¡Â Ã¯Â¸Â 400 Bad Request - Check column names and data types');
        console.error('Expected columns: ServiceID (Integer), Category (Text), Kind (Text), Name (Text), Notes (Text)');
      } else if (!error?.status) {
        console.log('Ã¢Å¡Â Ã¯Â¸Â No status code - might be a response parsing issue, checking table...');
        // Try to verify if it was actually saved
        setTimeout(async () => {
          const saved = await this.verifyVisualSaved(category, templateId);
          if (saved) {
            console.log('Ã¢Å“â€¦ Verified: Visual was actually saved');
            // Success toast removed per user request
          } else {
            console.error('Ã¢ÂÅ’ Verified: Visual was NOT saved');
            // Only now revert the selection
            const key = `${category}_${templateId}`;
            this.selectedItems[key] = false;
            if (this.categoryData[category] && this.categoryData[category][templateId]) {
              this.categoryData[category][templateId].selected = false;
            }
          }
        }, 1000);
        return; // Don't revert immediately
      }
      
      await this.showToast('Failed to save selection', 'danger');
      
      // Only revert if we're sure it failed
      if (error?.status >= 400) {
        const key = `${category}_${templateId}`;
        this.selectedItems[key] = false;
        if (this.categoryData[category] && this.categoryData[category][templateId]) {
          this.categoryData[category][templateId].selected = false;
        }
      }
    }
  }
  */
  
  /* DUPLICATE FUNCTIONS - COMMENTED OUT TO FIX TS2393
  // Remove visual selection from Services_Visuals table
  async removeVisualSelection_DUPLICATE(category: string, templateId: string) {
    // Check if we have a stored record ID
    const recordKey = `visual_${category}_${templateId}`;
    const recordId = localStorage.getItem(recordKey);
    
    if (recordId) {
      try {
        await this.caspioService.deleteServicesVisual(recordId).toPromise();
        console.log('Ã¢Å“â€¦ Visual removed from Services_Visuals');
        localStorage.removeItem(recordKey);
      } catch (error) {
        console.error('Ã¢ÂÅ’ Failed to remove visual:', error);
        // Don't show error toast for deletion failures
      }
    }
  }
  
  // Check if item is selected
  isItemSelected_DUPLICATE(category: string, itemId: string): boolean {
    return this.selectedItems[`${category}_${itemId}`] || false;
  }

  // Helper methods for PDF generation - check selection by visual ID
  isCommentSelected_DUPLICATE(category: string, visualId: string): boolean {
    // Check if this comment visual is selected using the same format as toggleItemSelection
    const key = `${category}_${visualId}`;
    return this.selectedItems[key] || false;
  }

  isLimitationSelected_DUPLICATE(category: string, visualId: string): boolean {
    // Check if this limitation visual is selected using the same format as toggleItemSelection
    const key = `${category}_${visualId}`;
    return this.selectedItems[key] || false;
  }

  isDeficiencySelected_DUPLICATE(category: string, visualId: string): boolean {
    // Check if this deficiency visual is selected using the same format as toggleItemSelection
    const key = `${category}_${visualId}`;
    return this.selectedItems[key] || false;
  }

  // Get photo count for a visual ID
  getVisualPhotoCount_DUPLICATE(visualId: string): number {
    // Find photos associated with this visual ID
    const photos = this.visualPhotos[visualId] || [];
    return photos.length;
  }
  */
  
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
        name: 'description',
        type: 'radio',
        label: 'Yes',
        value: 'Yes',
        checked: item.answer === 'Yes'
      });
      inputs.push({
        name: 'description',
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
            // Validate required fields
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
      console.log(`Ã°Å¸â€œÂ¸ ${files.length} file(s) selected`);
      
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
        const processedFiles: Array<{ file: File; annotationData?: any; originalFile?: File }> = [];
        
        // If single camera photo, open annotator first
        if (files.length === 1) {
          const isCameraFlow = this.expectingCameraPhoto || this.isLikelyCameraCapture(fileArray[0]);

          if (isCameraFlow) {
            const annotatedResult = await this.annotatePhoto(fileArray[0]);
            processedFiles.push(annotatedResult);

            const continueAlert = await this.alertController.create({
              cssClass: 'compact-photo-selector',
              buttons: [
                {
                  text: 'Take Another Photo',
                cssClass: 'action-button',
                handler: () => {
                  this.currentUploadContext = { category, itemId, item, action: 'add' };
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
            processedFiles.push({
              file: fileArray[0],
              annotationData: null,
              originalFile: undefined
            });
            this.expectingCameraPhoto = false;
          }
        } else {
          // Multiple files or non-camera - no automatic annotation
          for (const file of fileArray) {
            processedFiles.push({ file, annotationData: null, originalFile: undefined });
          }
        }
        
        // Start uploads in background (don't await)
        const uploadPromises = processedFiles.map((processedFile, index) => 
          this.uploadPhotoForVisual(visualId, processedFile.file, key, true, processedFile.annotationData, processedFile.originalFile)
            .then(() => {
              console.log(`Ã¢Å“â€¦ File ${index + 1} uploaded successfully`);
              return { success: true, error: null };
            })
            .catch((error) => {
              console.error(`Ã¢ÂÅ’ Failed to upload file ${index + 1}:`, error);
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
        
        // Removed change detection to improve performance
      }
    } catch (error) {
      console.error('Ã¢ÂÅ’ Error handling files:', error);
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
      console.log('Ã°Å¸â€œÂ¸ Opening camera for visual:', visualId);
      
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
        console.log('Ã°Å¸â€œÂ¸ Photo captured:', file.name);
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
      console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â Opening gallery for visual:', visualId);
      
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
        console.log('Ã°Å¸â€“Â¼Ã¯Â¸Â Image selected:', file.name);
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
      console.log('Ã°Å¸â€œâ€ž Opening document picker for visual:', visualId);
      
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
        console.log('Ã°Å¸â€œâ€ž Document selected:', file.name);
        await this.uploadPhotoForVisual(visualId, file, key);
      }
    } catch (error) {
      console.error('Ã¢ÂÅ’ Error selecting document:', error);
      await this.showToast('Failed to select document', 'danger');
    }
  }
  
  // Annotate photo before upload - returns object with file and annotation data
  async annotatePhoto(photo: File): Promise<{ file: File, annotationData?: any, originalFile?: File }> {
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
      // Handle new Fabric.js annotator response with annotation data
      const annotatedFile = new File([data.blob], photo.name, { type: 'image/jpeg' });
      return {
        file: annotatedFile,
        annotationData: data.annotationData || data.annotationsData, // Get the Fabric.js JSON
        originalFile: photo // Keep reference to original for future re-editing
      };
    }
    
    // Return original photo if annotation was cancelled
    return { file: photo, annotationData: null, originalFile: undefined };
  }
  
  // Upload photo to Service_Visuals_Attach - EXACT same approach as working Attach table
  async uploadPhotoForVisual(visualId: string, photo: File, key: string, isBatchUpload: boolean = false, annotationData: any = null, originalPhoto: File | null = null) {
    // Extract category from key (format: category_itemId)
    const category = key.split('_')[0];
    
    // Ensure the accordion for this category stays expanded
    if (!this.expandedAccordions.includes(category)) {
      this.expandedAccordions.push(category);
      if (this.visualAccordionGroup) {
        this.visualAccordionGroup.value = this.expandedAccordions;
      }
    }
    
    // COMPRESS the photo before upload
    const compressedPhoto = await this.imageCompression.compressImage(photo, {
      maxSizeMB: 1.5,
      maxWidthOrHeight: 1920,
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
        annotations: annotationData || null
      };

      // [v1.4.387] ONLY add to key-based storage
      console.log(`[v1.4.387] Adding uploaded photo to KEY: ${key}`);
      console.log(`  Filename: ${photo.name}`);
      console.log(`  TempID: ${tempId}`);
      this.visualPhotos[key].push(photoData);

      if (isPendingVisual) {
        if (!this.pendingPhotoUploads[key]) {
          this.pendingPhotoUploads[key] = [];
        }

        this.pendingPhotoUploads[key].push({
          file: uploadFile,
          annotationData,
          originalPhoto,
          isBatchUpload,
          tempId
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
          Annotation: '', // Annotation is blank as requested
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
      if (!isBatchUpload) {
        const alert = await this.alertController.create({
          header: 'Services_Visuals_Attach Upload Debug',
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
            Ã¢â‚¬Â¢ VisualID: <strong style="color: red;">${dataToSend.fields.VisualID}</strong> (Integer)<br>
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
              await this.performVisualPhotoUpload(visualIdNum, uploadFile, key, false, annotationData, originalPhoto, tempId);
            }
          }
        ]
      });

        await alert.present();
      } else {
        // For batch uploads, proceed directly without popup
        await this.performVisualPhotoUpload(visualIdNum, uploadFile, key, true, annotationData, originalPhoto, tempId);
      }

    } catch (error) {
      console.error('Ã¢ÂÅ’ Failed to prepare upload:', error);
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
    tempPhotoId?: string
  ) {
    try {
      // Show debug popup for what we're sending (only for single uploads)
      if (!isBatchUpload) {
        const debugData = {
          visualId: visualIdNum,
          fileName: photo.name,
          fileSize: `${(photo.size / 1024).toFixed(2)} KB`,
          fileType: photo.type,
          hasAnnotations: !!annotationData,
          hasOriginalPhoto: !!originalPhoto,
          originalFileName: originalPhoto?.name || 'None',
          endpoint: 'Services_Visuals_Attach',
          method: 'Files API (2-step upload)'
        };
        
        const debugAlert = await this.alertController.create({
          header: 'Ã°Å¸â€œÂ¤ Structural Systems Upload',
          message: `
            <strong>Sending:</strong><br>
            VisualID: ${debugData.visualId}<br>
            File: ${debugData.fileName}<br>
            Size: ${debugData.fileSize}<br>
            Type: ${debugData.fileType}<br>
            Annotations: ${debugData.hasAnnotations ? 'Yes' : 'No'}<br>
            Original: ${debugData.originalFileName}<br><br>
            <strong>Endpoint:</strong> ${debugData.endpoint}<br>
            <strong>Method:</strong> ${debugData.method}
          `,
          buttons: ['OK']
        });
        
        await debugAlert.present();
        const { role } = await debugAlert.onDidDismiss();
      }
      
      // Prepare the Drawings field data (annotation JSON)
      let drawingsData = annotationData ? JSON.stringify(annotationData) : EMPTY_COMPRESSED_ANNOTATIONS;
      
      // CRITICAL DEBUG: Log what we're actually uploading
      console.log('Ã°Å¸â€Â CRITICAL: Photo upload parameters:');
      console.log('  originalPhoto exists:', !!originalPhoto);
      console.log('  originalPhoto name:', originalPhoto?.name || 'N/A');
      console.log('  photo name:', photo.name);
      console.log('  has annotationData:', !!annotationData);
      console.log('  UPLOADING:', originalPhoto ? originalPhoto.name : photo.name);
      
      // Using EXACT same approach as working Required Documents upload
      let response;
      try {
        response = await this.caspioService.createServicesVisualsAttachWithFile(
          visualIdNum, 
          '', // Annotation field stays blank
          photo,  // Upload the photo (annotated or original)
          drawingsData, // Pass the annotation JSON to Drawings field
          originalPhoto || undefined // Pass original photo if we have annotations
        ).toPromise();
        
        console.log('Ã¢Å“â€¦ Photo uploaded successfully:', response);
      } catch (uploadError: any) {
        console.error('Ã¢ÂÅ’ Upload failed:', uploadError);
        
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
        
        const errorAlert = await this.alertController.create({
          header: 'Ã¢ÂÅ’ Structural Systems Upload Failed',
          message: `
            <div style="text-align: left; font-size: 12px;">
              <strong style="color: red;">Error Details:</strong><br>
              Message: ${errorDetails.message}<br>
              Status: ${errorDetails.status}<br>
              Status Text: ${errorDetails.statusText}<br><br>
              
              <strong>Request Info:</strong><br>
              VisualID: ${errorDetails.visualId}<br>
              File: ${errorDetails.fileName}<br>
              Size: ${(errorDetails.fileSize / 1024).toFixed(2)} KB<br>
              Has Annotations: ${errorDetails.hasAnnotations}<br><br>
              
              <strong>API Response:</strong><br>
              <div style="max-height: 100px; overflow-y: auto; background: #f0f0f0; padding: 5px; font-family: monospace;">
                ${JSON.stringify(errorDetails.error, null, 2)}
              </div><br>
              
              <strong>Time:</strong> ${errorDetails.timestamp}
            </div>
          `,
          buttons: [
            {
              text: 'Copy Error Details',
              handler: () => {
                const errorText = JSON.stringify(errorDetails, null, 2);
                if (navigator.clipboard) {
                  navigator.clipboard.writeText(errorText);
                  this.showToast('Error details copied to clipboard', 'success');
                }
              }
            },
            {
              text: 'OK',
              role: 'cancel'
            }
          ]
        });
        
        await errorAlert.present();
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
            console.log(`[v1.4.388] Loading uploaded image from API: ${filePath}`);
            const imageData = await this.caspioService.getImageFromFilesAPI(filePath).toPromise();
            if (imageData && imageData.startsWith('data:')) {
              imageUrl = imageData; // Use base64 data URL
              console.log(`[v1.4.388] Successfully loaded uploaded image, length: ${imageData.length}`);
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

        console.log(`[v1.4.388] Updated photo in KEY storage: ${key}`);
        console.log(`  AttachID: ${keyPhotos[tempPhotoIndex].AttachID}`);
        console.log(`  Photo path: ${keyPhotos[tempPhotoIndex].Photo}`);
        console.log(`  Uploading flag removed: ${!keyPhotos[tempPhotoIndex].uploading}`);

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
          console.log(`[v1.4.388] Also updated in visualId storage: ${actualVisualId}`);
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
      console.error('Ã¢ÂÅ’ Failed to upload photo:', error);
      
      // [v1.4.388 FIX] Remove the failed temp photo from key-based storage where it was added
      const keyPhotos = this.visualPhotos[key];
      if (keyPhotos) {
        const tempPhotoIndex = keyPhotos.findIndex((p: any) => p.uploading === true && p.name === photo.name);
        if (tempPhotoIndex !== -1) {
          keyPhotos.splice(tempPhotoIndex, 1);
          console.log(`[v1.4.388] Removed failed photo from key storage: ${key}`);
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
    
    // Debug logging
    console.log(`[v1.4.387] getPhotosForVisual:`);
    console.log(`  Key: ${key}`);
    console.log(`  Photos found: ${photos.length}`);
    if (photos.length > 0) {
      photos.forEach((photo: any, index: number) => {
        console.log(`  Photo ${index + 1}: ${photo.Photo || photo.filePath || 'unknown'}, AttachID: ${photo.AttachID || photo.id}`);
      });
    }
    
    return photos;
  }
  
  // Handle image loading errors
  handleImageError(event: any, photo: any) {
    console.log('Ã¢Å¡Â Ã¯Â¸Â [v1.4.303] Image failed to load:', {
      name: photo.name,
      filePath: photo.filePath,
      displayUrl: photo.displayUrl?.substring?.(0, 50),
      thumbnailUrl: photo.thumbnailUrl?.substring?.(0, 50),
      url: photo.url?.substring?.(0, 50),
      hasAnnotations: photo.hasAnnotations,
      attemptedSrc: (event.target as HTMLImageElement).src?.substring?.(0, 50)
    });
    
    // If this is a blob URL that expired, try to use the original URL
    if (photo.url && photo.url.startsWith('data:')) {
      console.log('Ã°Å¸â€â€ž [v1.4.303] Attempting to use original base64 URL');
      const target = event.target as HTMLImageElement;
      target.src = photo.url;
      return;
    }
    
    // Otherwise use SVG fallback
    console.log('Ã°Å¸Å½Â¨ [v1.4.303] Using SVG fallback');
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
      // Convert FileList to array if needed
      const files = data.files && data.files.length > 0 ? data.files : null;

      // Create the visual with photos
      await this.createCustomVisualWithPhotos(category, kind, data.name, data.description || '', files);
    }
  }
  
  // Create custom visual with photos
  async createCustomVisualWithPhotos(category: string, kind: string, name: string, text: string, files: FileList | File[] | null) {
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
        message: 'Creating visual...'
      });
      await loading.present();
      
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
        
        await loading.dismiss();
        
        // Upload photos if provided
        if (files && files.length > 0) {
          const uploadLoading = await this.loadingController.create({
            message: `Uploading ${files.length} file(s)...`
          });
          await uploadLoading.present();
          
          let successCount = 0;
          let failCount = 0;
          
          // Upload each file
          for (let i = 0; i < files.length; i++) {
            try {
              await this.uploadPhotoForVisual(String(visualId), files[i], key, true);
              successCount++;
            } catch (error) {
              console.error(`Failed to upload file ${i + 1}:`, error);
              failCount++;
            }
          }
          
          await uploadLoading.dismiss();
          
          // Show result
          if (failCount === 0) {
            // Success toast removed per user request - visual created with files
          } else if (successCount > 0) {
            await this.showToast(`Visual created. ${successCount} file(s) uploaded, ${failCount} failed`, 'warning');
          } else {
            await this.showToast('Visual created but file uploads failed', 'warning');
          }
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
        await loading.dismiss();

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
        console.log('Ã¢Å“â€¦ Custom visual created:', response);
        
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
              Ã¢â‚¬Â¢ VisualID (PRIMARY): <strong style="color: green;">${response?.VisualID || 'NOT FOUND'}</strong><br>
              Ã¢â‚¬Â¢ PK_ID: ${response?.PK_ID || 'N/A'}<br>
              Ã¢â‚¬Â¢ ServiceID: ${response?.ServiceID || 'N/A'}<br>
              Ã¢â‚¬Â¢ Category: ${response?.Category || 'N/A'}<br>
              Ã¢â‚¬Â¢ Kind: ${response?.Kind || 'N/A'}<br>
              Ã¢â‚¬Â¢ Name: ${response?.Name || 'N/A'}<br><br>
              
              <strong>Will be stored as:</strong><br>
              Ã¢â‚¬Â¢ Key: ${category}_${response?.VisualID || response?.PK_ID || Date.now()}<br>
              Ã¢â‚¬Â¢ VisualID for photos: <strong style="color: green;">${response?.VisualID || response?.PK_ID || 'MISSING!'}</strong>
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
        console.log('Ã°Å¸â€œÅ’ Stored VisualID for photos:', {
          key: key,
          visualId: this.visualRecordIds[key],
          responseVisualID: response?.VisualID,
          responsePK_ID: response?.PK_ID
        });
        
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
      console.log('Ã°Å¸â€Â [v1.4.340] updatePhotoAttachment called with:');
      console.log('  attachId:', attachId);
      console.log('  attachId type:', typeof attachId);
      console.log('  attachId value check:', {
        isUndefined: attachId === undefined,
        isNull: attachId === null,
        isUndefinedString: attachId === 'undefined',
        isNullString: attachId === 'null',
        isEmpty: !attachId,
        actualValue: attachId
      });
      console.log('  file:', file.name);
      console.log('  annotations:', annotations);
      console.log('  has originalFile:', !!originalFile);
      
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
      
      // v1.4.351 DEBUG: Log EVERYTHING about what we're saving
      console.log('Ã°Å¸â€â€ž [v1.4.351] UPDATE PHOTO ATTACHMENT - DEBUG MODE');
      console.log('  AttachID:', attachId);
      console.log('  Received annotations type:', typeof annotations);
      if (annotations && typeof annotations === 'object') {
        if ('objects' in annotations) {
          console.log('  Ã°Å¸Å½Â¨ Fabric.js canvas object detected');
          console.log('  Total objects:', annotations.objects?.length || 0);
          console.log('  Object types:', annotations.objects?.map((o: any) => o.type).join(', '));
        } else if (Array.isArray(annotations)) {
          console.log('  Ã°Å¸â€œÂ¦ Array of annotations detected');
          console.log('  Array length:', annotations.length);
        } else {
          console.log('  Ã¢Ââ€œ Unknown object format');
          console.log('  Keys:', Object.keys(annotations).join(', '));
        }
      } else if (typeof annotations === 'string') {
        console.log('  Ã°Å¸â€œÂ String annotations, length:', annotations.length);
        console.log('  First 200 chars:', annotations.substring(0, 200));
      }
      
      // Add annotations to Drawings field if provided
      if (annotations) {
        // CRITICAL FIX v1.4.341: Caspio Drawings field is TEXT type
        // Handle blob URLs and ensure proper JSON formatting
        let drawingsData = '';
        
        console.log('Ã°Å¸â€Â [v1.4.341] Processing annotations for Drawings field:');
        console.log('  Input type:', typeof annotations);
        console.log('  Input preview:', typeof annotations === 'string' ? annotations.substring(0, 200) : annotations);
        
        // v1.4.351 DEBUG: Log EXACTLY what we're receiving
        // Fabric.js returns an object with 'objects' and 'version' properties
        if (annotations && typeof annotations === 'object' && 'objects' in annotations) {
          console.log('  Ã°Å¸â€œÂ [v1.4.351] DEBUG - Received Fabric.js object:');
          console.log('    Total objects:', annotations.objects?.length || 0);
          console.log('    Object types:', annotations.objects?.map((o: any) => o.type).join(', '));
          console.log('    First 3 objects:', JSON.stringify(annotations.objects?.slice(0, 3), null, 2));
          
          // This is a Fabric.js canvas export - stringify it DIRECTLY
          // The toJSON() method from Fabric.js already returns the COMPLETE canvas state
          try {
            // v1.4.351: The annotations from canvas.toJSON() are the COMPLETE state
            drawingsData = JSON.stringify(annotations);
            console.log('  Ã¢Å“â€¦ [v1.4.351] Stringified complete canvas state:', drawingsData.length, 'bytes');
            
            // v1.4.342: Validate the JSON is parseable
            try {
              const testParse = JSON.parse(drawingsData);
              console.log('  Ã¢Å“â€¦ Validated JSON is parseable, objects:', testParse.objects?.length || 0);
            } catch (e) {
              console.error('  Ã¢Å¡Â Ã¯Â¸Â Warning: JSON validation failed, but continuing');
            }
          } catch (e) {
            console.error('  Ã¢ÂÅ’ Failed to stringify Fabric.js object:', e);
            // Try to create a minimal representation
            drawingsData = JSON.stringify({ objects: [], version: annotations.version || '5.3.0' });
          }
        } else if (annotations === null || annotations === undefined) {
          // Skip null/undefined - DON'T send empty string
          console.log('  Ã¢â€ â€™ Null/undefined, skipping Drawings field');
          // Don't set drawingsData at all - let it remain undefined
        } else if (typeof annotations === 'string') {
          // Already a string - validate and clean it
          drawingsData = annotations;
          console.log('  Ã¢â€ â€™ Already a string, length:', drawingsData.length);
          
          // Check if it contains blob URLs and if it's valid JSON
          try {
            if (drawingsData.startsWith('{') || drawingsData.startsWith('[')) {
              const parsed = JSON.parse(drawingsData);
              console.log('  Ã¢Å“â€œ Valid JSON string');
              
              // Check for blob URLs in backgroundImage
              if (parsed.backgroundImage?.src?.startsWith('blob:')) {
                console.log('  Ã¢Å¡Â Ã¯Â¸Â Contains blob URL in backgroundImage, keeping as-is');
                // Note: blob URLs become invalid after reload, but we still save them
                // The annotation system should handle missing background images gracefully
              }
              
              // Re-stringify to ensure consistent formatting
              drawingsData = JSON.stringify(parsed);
              console.log('  Ã¢Å“â€œ Re-stringified for consistency');
            }
          } catch (e) {
            console.log('  Ã¢Å¡Â Ã¯Â¸Â Not valid JSON or parse error:', e);
            // Keep the string as-is if it's not JSON
          }
        } else if (typeof annotations === 'object') {
          // Object - needs stringification
          try {
            // Check for blob URLs before stringifying
            if (annotations.backgroundImage?.src?.startsWith('blob:')) {
              console.log('  Ã¢Å¡Â Ã¯Â¸Â Object contains blob URL in backgroundImage');
            }
            
            // CRITICAL FIX v1.4.336: Special handling for array of annotation objects
            // When reloading, annotations come back as an array of objects
            if (Array.isArray(annotations)) {
              console.log('  Ã°Å¸â€œâ€¹ Annotations is an array with', annotations.length, 'items');
              
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
              console.log('  Ã¢Å“â€¦ Cleaned and stringified array of annotations');
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
              console.log('  Ã¢â€ â€™ Stringified object with replacer');
            }
            
            console.log('  Result length:', drawingsData.length);
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
          console.log('  Ã¢â€ â€™ Converted to string from type:', typeof annotations);
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
            console.log('  [v1.4.351] DEBUG - Before compression:');
          console.log('    Object count:', parsed.objects?.length || 0);
          console.log('    Object types:', parsed.objects?.map((o: any) => o.type).join(', '));
          console.log('    Data size:', drawingsData.length, 'bytes');
            
            // Re-stringify to ensure clean JSON format
            drawingsData = JSON.stringify(parsed, (key, value) => {
              // Replace undefined with null for valid JSON
              return value === undefined ? null : value;
            });
            
            // COMPRESS if needed to fit in 64KB TEXT field
            const originalSize = drawingsData.length;
            drawingsData = compressAnnotationData(drawingsData, { emptyResult: EMPTY_COMPRESSED_ANNOTATIONS });
            
            if (originalSize !== drawingsData.length) {
              console.log('  [v1.4.351] Compressed from', originalSize, 'to', drawingsData.length, 'bytes');
              
              // DEBUG: Show what's in the compressed data
              try {
                const compressedParsed = decompressAnnotationData(drawingsData);
                console.log('  [v1.4.351] After compression has:', compressedParsed?.objects?.length || 0, 'objects');
                console.log('  [v1.4.351] Compressed object types:', compressedParsed?.objects?.map((o: any) => o.type).join(', '));
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
            console.log('  Ã¢Å¡Â Ã¯Â¸Â Cleaned', originalLength - drawingsData.length, 'characters during final validation');
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
          
          console.log('Ã°Å¸â€™Â¾ [v1.4.315] Final Drawings field data:');
          console.log('  Type:', typeof updateData.Drawings);
          console.log('  Length:', updateData.Drawings.length);
          console.log('  Is string:', typeof updateData.Drawings === 'string');
          console.log('  First 150 chars:', updateData.Drawings.substring(0, 150));
        } else {
          console.log('[v1.4.315] No valid annotation data, applying default Drawings payload');
          updateData.Drawings = EMPTY_COMPRESSED_ANNOTATIONS;
        }
      } else {
        console.log('[v1.4.315] No annotations provided, applying default Drawings payload');
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
            Ã¢â‚¬Â¢ Table: Services_Visuals_Attach<br>
            Ã¢â‚¬Â¢ Method: PUT (update)<br>
            Ã¢â‚¬Â¢ Where: AttachID=${attachId}<br><br>
            
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
              console.log('Update cancelled by user');
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
        console.log('Ã°Å¸â€Å" Adding caption to update:', caption);
      }

      // CRITICAL: Check if we have any data to update
      if (Object.keys(updateData).length === 0) {
        console.warn('Ã¢Å¡Â Ã¯Â¸Â No data to update - updateData is empty');
        // If there's no data to update, just return success
        console.log('Ã¢Å“â€¦ No changes needed, skipping update');
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
            console.log('  Converted to string');
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
      
      // FINAL DATA VALIDATION before sending
      console.log('Ã°Å¸â€Â FINAL UPDATE DATA CHECK:');
      console.log('  updateData:', updateData);
      console.log('  updateData type:', typeof updateData);
      console.log('  Keys:', Object.keys(updateData));
      
      // Check each field in updateData
      for (const key in updateData) {
        const value = updateData[key];
        console.log(`  Field "${key}":`, {
          value: value,
          type: typeof value,
          isString: typeof value === 'string',
          length: value?.length,
          preview: typeof value === 'string' ? value.substring(0, 100) : 'NOT A STRING'
        });
        
        // CRITICAL: Ensure all values are strings for Caspio TEXT fields
        if (typeof value !== 'string' && value !== null && value !== undefined) {
          console.error(`Ã¢ÂÅ’ Field "${key}" is not a string! Type: ${typeof value}`);
          // Convert to string if possible
          updateData[key] = String(value);
          console.log(`  Converted to string: "${updateData[key]}"`);
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
              console.log('Ã¢Å“â€¦ Updated local rawDrawingsString to match database');
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
      // DEBUG: Show what data we have for this photo
      console.log('Ã°Å¸â€Â quickAnnotate called with photo:', photo);
      console.log('  Photo object keys:', Object.keys(photo));
      console.log('  AttachID:', photo.AttachID);
      console.log('  id:', photo.id);
      console.log('  PK_ID:', photo.PK_ID);
      console.log('  Has annotations:', !!photo.annotations);
      
      // Show debug popup with photo data
      const photoDebugAlert = await this.alertController.create({
        header: 'Ã°Å¸â€œÂ¸ Debug: Photo Data',
        message: `
          <div style="font-family: monospace; font-size: 11px; text-align: left;">
            <strong style="color: blue;">PHOTO OBJECT INSPECTION</strong><br><br>
            
            <strong>Identity Fields:</strong><br>
            Ã¢â‚¬Â¢ AttachID: <span style="color: ${photo.AttachID ? 'green' : 'red'}">${photo.AttachID || 'MISSING'}</span><br>
            Ã¢â‚¬Â¢ id: <span style="color: ${photo.id ? 'green' : 'red'}">${photo.id || 'MISSING'}</span><br>
            Ã¢â‚¬Â¢ PK_ID: ${photo.PK_ID || 'N/A'}<br><br>
            
            <strong>Photo Info:</strong><br>
            Ã¢â‚¬Â¢ Name: ${photo.name || 'N/A'}<br>
            Ã¢â‚¬Â¢ Photo field: ${photo.Photo || 'N/A'}<br>
            Ã¢â‚¬Â¢ FilePath: ${photo.filePath || 'N/A'}<br><br>
            
            <strong>URLs:</strong><br>
            Ã¢â‚¬Â¢ url: ${photo.url ? 'YES' : 'NO'}<br>
            Ã¢â‚¬Â¢ thumbnailUrl: ${photo.thumbnailUrl ? 'YES' : 'NO'}<br>
            Ã¢â‚¬Â¢ displayUrl: ${photo.displayUrl ? 'YES' : 'NO'}<br>
            Ã¢â‚¬Â¢ originalUrl: ${photo.originalUrl ? 'YES' : 'NO'}<br><br>
            
            <strong>Annotations:</strong><br>
            Ã¢â‚¬Â¢ Has annotations: ${!!photo.annotations}<br>
            Ã¢â‚¬Â¢ Has annotationsData: ${!!photo.annotationsData}<br>
            Ã¢â‚¬Â¢ Has Drawings: ${!!photo.Drawings}<br>
            Ã¢â‚¬Â¢ Annotation field: ${photo.Annotation || 'empty'}<br><br>
            
            <strong>Category/Item:</strong><br>
            Ã¢â‚¬Â¢ Category: ${category}<br>
            Ã¢â‚¬Â¢ ItemId: ${itemId}<br>
            Ã¢â‚¬Â¢ Key: ${category}_${itemId}<br><br>
            
            <strong style="color: orange;">All Photo Keys:</strong><br>
            ${Object.keys(photo).join(', ')}<br><br>
            
            <strong style="color: red;">CRITICAL:</strong> If AttachID and id are both missing,<br>
            the update will fail!
          </div>
        `,
        buttons: [
          {
            text: 'Copy Full Data',
            handler: () => {
              navigator.clipboard.writeText(JSON.stringify(photo, null, 2));
              return false;
            }
          },
          { text: 'Continue', role: 'cancel' }
        ]
      });
      await photoDebugAlert.present();
      await photoDebugAlert.onDidDismiss();
      
      const imageUrl = photo.url || photo.thumbnailUrl || 'assets/img/photo-placeholder.png';
      const photoName = photo.name || 'Photo';
      
      // Parse existing annotations if available
      let existingAnnotations = null;
      
      // v1.4.345: Try multiple sources for annotations and handle decompression
      const annotationSources = [
        photo.annotations,
        photo.annotationsData,
        photo.rawDrawingsString,
        photo.Drawings
      ];
      
      for (const source of annotationSources) {
        if (source) {
          try {
            console.log('[v1.4.345] Attempting to parse annotations from source:', typeof source);
            if (typeof source === 'string') {
              // Use decompression helper to handle compressed data
              existingAnnotations = decompressAnnotationData(source);
            } else {
              existingAnnotations = source;
            }
            
            if (existingAnnotations) {
              console.log('[v1.4.345] Successfully parsed annotations:', {
                hasObjects: !!existingAnnotations.objects,
                objectCount: existingAnnotations.objects?.length || 0
              });
              break; // Found valid annotations, stop searching
            }
          } catch (e) {
            console.log('Failed to parse annotations from this source:', e);
          }
        }
      }
      
      // Convert to the format expected by FabricPhotoAnnotatorComponent if needed
      if (existingAnnotations && !existingAnnotations.objects && Array.isArray(existingAnnotations)) {
        // If it's an array of annotations, wrap it in Fabric.js format
        existingAnnotations = {
          version: "6.7.1",
          objects: existingAnnotations
        };
      }
      
      // Open annotation modal directly
      const modal = await this.modalController.create({
        component: FabricPhotoAnnotatorComponent,
        componentProps: {
          imageUrl: imageUrl,
          existingAnnotations: existingAnnotations,
          photoData: photo
        },
        cssClass: 'fullscreen-modal'
      });
      
      await modal.present();
      const { data } = await modal.onDidDismiss();
      
      if (data) {
        // Handle new Fabric.js annotator response
        const annotatedBlob = data.blob || data.annotatedBlob;
        const annotationsData = data.annotationData || data.annotationsData;
        
        if (annotatedBlob) {
          // Update the photo with annotations
          const key = `${category}_${itemId}`;
          const visualId = this.visualRecordIds[key];
          const annotatedFile = new File([annotatedBlob], photoName, { type: 'image/jpeg' });
          
          if (photo.AttachID || photo.id) {
            try {
              // DEBUG: Log what we're about to update
              console.log('Ã°Å¸â€Â About to update photo attachment:');
              console.log('  photo object:', photo);
              console.log('  photo.AttachID:', photo.AttachID);
              console.log('  photo.id:', photo.id);
              console.log('  Using ID:', photo.AttachID || photo.id);
              
              // Get the original file if provided
              let originalFile = null;
              if (data.originalBlob) {
                originalFile = data.originalBlob instanceof File 
                  ? data.originalBlob 
                  : new File([data.originalBlob], `original_${photoName}`, { type: 'image/jpeg' });
              }
              
              // CRITICAL: Make sure we have a valid ID
              const attachIdToUse = photo.AttachID || photo.id;
              if (!attachIdToUse || attachIdToUse === 'undefined' || attachIdToUse === 'null') {
                throw new Error(`Invalid AttachID: ${attachIdToUse} (AttachID: ${photo.AttachID}, id: ${photo.id})`);
              }
              
              // DEBUG: Check annotation data type before passing
              console.log('Ã°Å¸â€œÅ  Annotation data before updatePhotoAttachment:');
              console.log('  Type:', typeof annotationsData);
              console.log('  Is object:', annotationsData && typeof annotationsData === 'object');
              console.log('  Is string:', typeof annotationsData === 'string');
              if (typeof annotationsData === 'object') {
                console.log('  Object keys:', Object.keys(annotationsData || {}));
                console.log('  Object preview:', JSON.stringify(annotationsData).substring(0, 200));
              }
              
              // Update the existing attachment with annotations
              await this.updatePhotoAttachment(attachIdToUse, annotatedFile, annotationsData, originalFile, data.caption);
            
              // Update the local photo data
              const photoIndex = this.visualPhotos[visualId]?.findIndex(
                (p: any) => (p.AttachID || p.id) === (photo.AttachID || photo.id)
              );
              
              if (photoIndex !== -1 && this.visualPhotos[visualId]) {
                // Update the photo URL with the new blob
                const newUrl = URL.createObjectURL(data.annotatedBlob);
                this.visualPhotos[visualId][photoIndex].url = newUrl;
                this.visualPhotos[visualId][photoIndex].thumbnailUrl = newUrl;
                this.visualPhotos[visualId][photoIndex].hasAnnotations = true;
                // Update caption if provided
                if (data.caption !== undefined) {
                  this.visualPhotos[visualId][photoIndex].caption = data.caption;
                  this.visualPhotos[visualId][photoIndex].Annotation = data.caption;
                  console.log('Ã°Å¸â€Å" Updated caption in local photo object:', data.caption);
                }
                // Store annotations in the photo object
                if (annotationsData) {
                  this.visualPhotos[visualId][photoIndex].annotations = annotationsData;
                  // CRITICAL FIX: Also update rawDrawingsString so annotations persist on re-edit
                  if (typeof annotationsData === 'object') {
                    this.visualPhotos[visualId][photoIndex].rawDrawingsString = JSON.stringify(annotationsData);
                  } else {
                    this.visualPhotos[visualId][photoIndex].rawDrawingsString = annotationsData;
                  }
                  console.log('Ã¢Å"â€¦ Updated rawDrawingsString for future re-edits in quickAnnotate');
                }
              }
              
              // Trigger change detection
              this.changeDetectorRef.detectChanges();
              
              // Success toast removed - silent save
            } catch (error: any) {
              console.error('Failed to save annotations in quickAnnotate:', error);
              
              // Show detailed error popup
              const saveErrorAlert = await this.alertController.create({
                header: 'Ã¢ÂÅ’ Annotation Save Failed',
                message: `
                  <div style="font-family: monospace; font-size: 11px; text-align: left;">
                    <strong style="color: red;">ANNOTATION SAVE ERROR</strong><br><br>
                    
                    <strong>Error:</strong> ${error?.message || 'Unknown error'}<br><br>
                    
                    <strong>Photo Details:</strong><br>
                    Ã¢â‚¬Â¢ AttachID: ${photo.AttachID || 'MISSING'}<br>
                    Ã¢â‚¬Â¢ id: ${photo.id || 'MISSING'}<br>
                    Ã¢â‚¬Â¢ Name: ${photo.name || 'N/A'}<br><br>
                    
                    <strong>Annotation Data:</strong><br>
                    Ã¢â‚¬Â¢ Has annotations: ${!!annotationsData}<br>
                    Ã¢â‚¬Â¢ Original file provided: false<br><br>
                    
                    <strong style="color: orange;">Debug Info:</strong><br>
                    Ã¢â‚¬Â¢ Visual ID: ${visualId}<br>
                    Ã¢â‚¬Â¢ Key: ${category}_${itemId}<br>
                    Ã¢â‚¬Â¢ Photo Index: 0<br><br>
                    
                    <strong>Error Details:</strong><br>
                    ${JSON.stringify(error, null, 2).substring(0, 500)}
                  </div>
                `,
                buttons: ['OK']
              });
              await saveErrorAlert.present();
              
              await this.showToast('Failed to save annotations', 'danger');
            }
          }
        }
      }
    } catch (error) {
      console.error('Error in quickAnnotate:', error);
      await this.showToast('Failed to open annotator', 'danger');
    }
  }
  
  // View photo - open viewer with integrated annotation
  async viewPhoto(photo: any, category: string, itemId: string) {
    try {
      console.log('Ã°Å¸â€˜ÂÃ¯Â¸Â [v1.4.340] Viewing photo:', {
        name: photo.name,
        hasAttachID: !!photo.AttachID,
        AttachID: photo.AttachID,
        hasAnnotations: photo.hasAnnotations,
        hasOriginalUrl: !!photo.originalUrl
      });
      
      // v1.4.340: Validate AttachID before proceeding
      if (!photo.AttachID && !photo.id) {
        console.error('Ã¢ÂÅ’ [v1.4.340] Photo missing AttachID:', photo);
        await this.showToast('Cannot edit photo: Missing attachment ID', 'danger');
        return;
      }
      
      const imageUrl = photo.url || photo.thumbnailUrl || 'assets/img/photo-placeholder.png';
      const photoName = photo.name || 'Photo';
      const key = `${category}_${itemId}`;
      const visualId = this.visualRecordIds[key];
      
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
            console.log('[v1.4.345] Parsing annotations in viewPhoto:', typeof source);
            if (typeof source === 'string') {
              existingAnnotations = decompressAnnotationData(source);
            } else {
              existingAnnotations = source;
            }
            
            if (existingAnnotations) {
              console.log('[v1.4.345] Found valid annotations in viewPhoto');
              break;
            }
          } catch (e) {
            console.log('Failed to parse in viewPhoto:', e);
          }
        }
      }
      
      // ENHANCED: Open annotation window directly instead of photo viewer
      const modal = await this.modalController.create({
        component: FabricPhotoAnnotatorComponent,
        componentProps: {
          imageUrl: originalImageUrl,  // Always use original, not display URL
          // v1.4.345: Pass properly decompressed annotations
          existingAnnotations: existingAnnotations,
          photoData: {
            ...photo,
            AttachID: photo.AttachID || photo.id, // v1.4.340: Ensure AttachID is passed
            id: photo.AttachID || photo.id, // Ensure both fields are set
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
        
        // v1.4.342: IMPORTANT - The modal returns a Fabric.js JSON object, NOT a string
        // We need to stringify it before saving to Caspio
        console.log('Ã°Å¸â€œÂ [v1.4.342] Annotation data received from modal:', {
          type: typeof annotationsData,
          hasObjects: annotationsData && typeof annotationsData === 'object' && 'objects' in annotationsData,
          objectCount: annotationsData?.objects?.length || 0,
          isString: typeof annotationsData === 'string',
          isArray: Array.isArray(annotationsData)
        });
        
        // v1.4.342: Convert to string if it's an object (which it should be)
        if (annotationsData && typeof annotationsData === 'object') {
          console.log('Ã°Å¸â€œâ€¹ [v1.4.342] Converting Fabric.js object to string for storage');
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
        
        if (photo.AttachID || photo.id) {
          // Removed loading screen to allow debug popups to be visible
          
          try {
            // Update the existing attachment with annotations and original
            await this.updatePhotoAttachment(photo.AttachID || photo.id, annotatedFile, annotationsData, originalFile, data.caption);
            
            // Update the local photo data
            const photoIndex = this.visualPhotos[visualId]?.findIndex(
              (p: any) => (p.AttachID || p.id) === (photo.AttachID || photo.id)
            );
            
            if (photoIndex !== -1 && this.visualPhotos[visualId]) {
              // CRITICAL FIX: Store original URL before updating display
              if (!this.visualPhotos[visualId][photoIndex].originalUrl) {
                // Save the original URL on first annotation
                this.visualPhotos[visualId][photoIndex].originalUrl = this.visualPhotos[visualId][photoIndex].url;
              }
              
              // Update ONLY the display URL with annotated version for preview
              // NOTE: Blob URLs are temporary and won't persist across page reloads
              const newUrl = URL.createObjectURL(data.annotatedBlob);
              this.visualPhotos[visualId][photoIndex].displayUrl = newUrl;
              // Don't overwrite thumbnailUrl if it has base64 data - only set if undefined
              if (!this.visualPhotos[visualId][photoIndex].thumbnailUrl ||
                  this.visualPhotos[visualId][photoIndex].thumbnailUrl.startsWith('blob:')) {
                this.visualPhotos[visualId][photoIndex].thumbnailUrl = newUrl;
              }
              this.visualPhotos[visualId][photoIndex].hasAnnotations = true;

              // Update caption if provided
              if (data.caption !== undefined) {
                this.visualPhotos[visualId][photoIndex].caption = data.caption;
                this.visualPhotos[visualId][photoIndex].Annotation = data.caption;
                console.log('Ã°Å¸â€Å" Updated caption in local photo object (viewPhoto):', data.caption);
              }

              // Keep the original URL intact in the url field
              // DO NOT change this.visualPhotos[visualId][photoIndex].url!

              // Store annotations in the photo object
              if (annotationsData) {
                this.visualPhotos[visualId][photoIndex].annotations = annotationsData;
                // CRITICAL FIX: Also update rawDrawingsString so annotations persist on re-edit
                // The updatePhotoAttachment method saves to Drawings field, so we need to mirror that here
                if (typeof annotationsData === 'object') {
                  this.visualPhotos[visualId][photoIndex].rawDrawingsString = JSON.stringify(annotationsData);
                } else {
                  this.visualPhotos[visualId][photoIndex].rawDrawingsString = annotationsData;
                }
                console.log('Ã¢Å"â€¦ Updated rawDrawingsString for future re-edits');
              }
              
              console.log(`Ã°Å¸â€œÂ¸ [v1.4.303] Photo URLs after annotation:`);
              console.log(`  Original URL preserved:`, this.visualPhotos[visualId][photoIndex].originalUrl || this.visualPhotos[visualId][photoIndex].url);
              console.log(`  Display URL (annotated blob):`, this.visualPhotos[visualId][photoIndex].displayUrl?.substring?.(0, 50));
              console.log(`  Thumbnail URL:`, this.visualPhotos[visualId][photoIndex].thumbnailUrl?.substring?.(0, 50));
              console.log(`  Base URL (should be base64):`, this.visualPhotos[visualId][photoIndex].url?.substring?.(0, 50));
            }
            
            // Success toast removed per user request
            
            // Trigger change detection
            this.changeDetectorRef.detectChanges();
          } catch (error) {
            await this.showToast('Failed to update photo', 'danger');
          }
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
            role: 'cancel'
          },
          {
            text: 'Delete',
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
                  
                  console.log(`[v1.4.387] Deleting photo:`);
                  console.log(`  AttachID: ${attachId}`);
                  console.log(`  Key: ${key}`);
                  console.log(`  Photos before delete: ${this.visualPhotos[key]?.length || 0}`);
                  
                  // Delete from database
                  await this.caspioService.deleteServiceVisualsAttach(attachId).toPromise();
                  
                  // [v1.4.387] Remove from KEY-BASED storage
                  if (this.visualPhotos[key]) {
                    this.visualPhotos[key] = this.visualPhotos[key].filter(
                      (p: any) => (p.AttachID || p.id) !== attachId
                    );
                    console.log(`  Photos after delete: ${this.visualPhotos[key].length}`);
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
        ]
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
      
      // Success toast removed per user request
      
    } catch (error) {
      console.error('Error saving caption:', error);
      await this.showToast('Failed to save caption', 'danger');
    }
  }
  
  // Verify if visual was actually saved - v1.4.225 - FORCE REBUILD
  async verifyVisualSaved(category: string, templateId: string): Promise<boolean> {
    try {
      console.log('[v1.4.225] Verifying if visual was saved - REBUILD FORCED...');
      const visuals = await this.foundationData.getVisualsByService(this.serviceId);
      
      if (visuals && Array.isArray(visuals)) {
        const templateName = this.categoryData[category]?.[templateId]?.name;
        const found = visuals.some(v => 
          v.Category === category && 
          v.Name === templateName
        );
        
        if (found) {
          console.log('Ã¢Å“â€¦ Visual found in table - it was saved!');
          // Also refresh the ID
          await this.refreshVisualId(category, templateId);
          return true;
        }
      }
      console.log('Ã¢ÂÅ’ Visual not found in table');
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
      console.log('Ã°Å¸â€â€ž Refreshing Visual ID for:', category, templateId);
      const visuals = await this.foundationData.getVisualsByService(this.serviceId);
      
      console.log('Ã°Å¸â€œâ€¹ Retrieved visuals from database:', visuals);
      
      if (visuals && Array.isArray(visuals)) {
        // Find the visual we just created
        const templateName = this.categoryData[category]?.[templateId]?.name;
        console.log('Ã°Å¸â€Â Looking for visual with Category:', category, 'and Name:', templateName);
        
        const ourVisual = visuals.find(v => 
          v.Category === category && 
          v.Name === templateName
        );
        
        if (ourVisual) {
          console.log('Ã¢Å“â€¦ Found our visual:', ourVisual);
          const visualId = ourVisual.VisualID || ourVisual.PK_ID || ourVisual.id;
          const recordKey = `visual_${category}_${templateId}`;
          localStorage.setItem(recordKey, String(visualId));
          this.visualRecordIds[`${category}_${templateId}`] = String(visualId);
          console.log('Ã¢Å“â€¦ Visual ID refreshed:', visualId, 'for key:', `${category}_${templateId}`);
          await this.processPendingPhotoUploadsForKey(`${category}_${templateId}`);
        } else {
          console.log('Ã¢Å¡Â Ã¯Â¸Â Could not find visual with Category:', category, 'and Name:', templateName);
          console.log('Available visuals:', visuals.map(v => ({ Category: v.Category, Name: v.Name, ID: v.VisualID || v.PK_ID })));
        }
      }
    } catch (error) {
      console.error('Failed to refresh visual ID:', error);
    }
  }
  
  // Load existing photos for visuals - FIXED TO PREVENT DUPLICATION
  async loadExistingPhotos() {
    console.log('🔄 [v1.4.488] Loading Structural Systems photos in parallel...');
    const startTime = performance.now();

    // [v1.4.386] Check for duplicate visualIds
    const visualIdToKeys: { [visualId: string]: string[] } = {};
    for (const key in this.visualRecordIds) {
      const visualId = String(this.visualRecordIds[key]);
      if (!visualIdToKeys[visualId]) {
        visualIdToKeys[visualId] = [];
      }
      visualIdToKeys[visualId].push(key);
    }

    // Log any duplicate visualIds
    for (const visualId in visualIdToKeys) {
      if (visualIdToKeys[visualId].length > 1) {
        console.warn(`[v1.4.488] WARNING: VisualID ${visualId} is used by multiple keys:`, visualIdToKeys[visualId]);
      }
    }

    // [v1.4.488] PERFORMANCE FIX: Load all photos in parallel instead of sequential
    // Removed 50ms delay between each visual - saves 1-2 seconds
    const loadPromises = Object.keys(this.visualRecordIds).map(key => {
      const rawVisualId = this.visualRecordIds[key];
      const visualId = String(rawVisualId);

      if (visualId && visualId !== 'undefined' && !visualId.startsWith('temp_')) {
        console.log(`[v1.4.488] Queuing photos for key: ${key}, visualId: ${visualId}`);
        return this.loadPhotosForVisualByKey(key, visualId, rawVisualId);
      }
      return Promise.resolve();
    });

    // Wait for all photos to load in parallel
    await Promise.all(loadPromises);

    const elapsed = performance.now() - startTime;
    console.log(`✅ [v1.4.488] All Structural Systems photos loaded in ${elapsed.toFixed(0)}ms`);
    this.changeDetectorRef.detectChanges(); // Single change detection after all photos loaded
  }
  
  // [v1.4.386] Load photos for a visual and store by KEY for uniqueness
  private async loadPhotosForVisualByKey(key: string, visualId: string, rawVisualId: any): Promise<void> {
    try {
      console.log(`[v1.4.386] Loading photos for KEY: ${key}, VisualID: ${visualId}`);
      const attachments = await this.foundationData.getVisualAttachments(rawVisualId);

      if (!Array.isArray(attachments) || attachments.length === 0) {
        this.visualPhotos[key] = [];
        console.log(`[v1.4.387] No photos found for KEY: ${key}`);
        return;
      }

      console.log(`[v1.4.386] Found ${attachments.length} photos for KEY ${key} (VisualID ${visualId})`);
      // [v1.4.488] Change detection moved to end of loadExistingPhotos for better performance
      const photoRecords = attachments.map(att => this.buildPhotoRecord(att));
      this.visualPhotos[key] = photoRecords;
      this.changeDetectorRef.detectChanges();

      await this.hydratePhotoRecords(photoRecords);
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

    return {
      ...attachment,
      name: filePath || 'Photo',
      Photo: filePath,
      caption: attachment.Annotation || '',
      annotations: annotationData,
      annotationsData: annotationData,
      hasAnnotations: !!annotationData,
      rawDrawingsString,
      AttachID: attachment.AttachID || attachment.PK_ID || attachment.id,
      id: attachment.AttachID || attachment.PK_ID || attachment.id,
      PK_ID: attachment.PK_ID || attachment.AttachID || attachment.id,
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

        const imageData = await this.fetchPhotoBase64(record.filePath);

        if (imageData) {
          record.url = imageData;
          record.originalUrl = imageData;
          record.thumbnailUrl = imageData;
          if (!record.hasAnnotations) {
            record.displayUrl = imageData;
          }
        } else {
          record.thumbnailUrl = this.photoPlaceholder;
        }
      }
    });

    await Promise.all(workers);
    this.changeDetectorRef.detectChanges();
  }

  private fetchPhotoBase64(photoPath: string): Promise<string | null> {
    if (!photoPath || typeof photoPath !== 'string') {
      return Promise.resolve(null);
    }

    if (!this.thumbnailCache.has(photoPath)) {
      const loader = this.caspioService.getImageFromFilesAPI(photoPath).toPromise()
        .then(imageData => {
          if (imageData && typeof imageData === 'string' && imageData.startsWith('data:')) {
            return imageData;
          }
          console.error(`[v1.4.386] Invalid image data for ${photoPath}`);
          return null;
        })
        .catch(error => {
          console.error(`[v1.4.386] Failed to load image for ${photoPath}:`, error);
          return null;
        })
        .then(result => {
          if (result === null) {
            this.thumbnailCache.delete(photoPath);
          }
          return result;
        });

      this.thumbnailCache.set(photoPath, loader);
    }

    return this.thumbnailCache.get(photoPath)!;
  }

  private async presentTemplateLoader(message: string = 'Loading Report'): Promise<void> {
    if (this.templateLoaderPresented) {
      return;
    }

    this.templateLoadStart = Date.now();

    try {
      // Create loading popup with cancel button
      this.templateLoader = await this.alertController.create({
        header: message,
        message: 'Loading report data...',
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
        await this.templateLoader.present();
        this.templateLoaderPresented = true;
      }

    } catch (error) {
      console.error('[TemplateLoader] Failed to present loading overlay:', error);
      this.templateLoaderPresented = false;
    }
  }

  private async handleLoadingCancel(): Promise<void> {
    console.log('Template loading cancelled by user');

    // Dismiss the loader
    if (this.templateLoader) {
      await this.templateLoader.dismiss();
      this.templateLoaderPresented = false;
    }

    // Navigate back
    await this.navController.back();

    // Show cancellation message
    const toast = await this.toastController.create({
      message: 'Template loading cancelled',
      duration: 2000,
      position: 'top',
      color: 'warning'
    });
    await toast.present();
  }

  private async dismissTemplateLoader(): Promise<void> {
    if (!this.templateLoaderPresented) {
      return;
    }

    const elapsed = Date.now() - this.templateLoadStart;
    const remaining = this.templateLoaderMinDuration - elapsed;

    if (remaining > 0) {
      await new Promise(resolve => setTimeout(resolve, remaining));
    }

    try {
      await this.templateLoader?.dismiss();
    } catch (error) {
      console.warn('[TemplateLoader] Failed to dismiss loading overlay:', error);
    } finally {
      this.templateLoaderPresented = false;
      this.templateLoader = undefined;
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
  onProjectFieldChange(fieldName: string, value: any) {
    console.log(`Project field changed: ${fieldName} = ${value}`);

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
  onServiceFieldChange(fieldName: string, value: any) {
    console.log(`Service field changed: ${fieldName} = ${value}`);
    
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
    console.log('Progress updated:', progressData);
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
      console.error(`Ã¢Å¡Â Ã¯Â¸Â Cannot save ${fieldName} - No ServiceID! ServiceID is: ${this.serviceId}`);
      return;
    }
    
    console.log(`Ã°Å¸â€Â Services Table Update:`, {
      serviceId: this.serviceId,
      field: fieldName,
      newValue: value,
      updateData: { [fieldName]: value }
    });

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
          console.log(`Ã¢Å“â€¦ SUCCESS: ${fieldName} updated!`, response);
        } else {
          console.log(`Ã¢â€žÂ¹Ã¯Â¸Â ${fieldName} queued for sync (offline mode).`);
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
    
    // Log what we're getting from the project
    console.log('PrepareProjectInfo - PrimaryPhoto value:', primaryPhoto);
    console.log('PrepareProjectInfo - Full projectData:', this.projectData);
    
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
    console.log('=== PREPARING STRUCTURAL SYSTEMS DATA FOR PDF ===');
    console.log('Selected items:', this.selectedItems);
    console.log('Visual record IDs:', this.visualRecordIds);
    console.log('Organized data:', this.organizedData);
    
    const result = [];
    
    for (const category of this.visualCategories) {
      const categoryData = this.organizedData[category];
      if (!categoryData) continue;
      
      console.log(`Processing category: ${category}`, categoryData);
      
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
          console.log(`Comment "${comment.name}" (${visualId}) selected: ${isSelected}`);
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
        console.log(`Added category ${category} with:`, {
          comments: categoryResult.comments.length,
          limitations: categoryResult.limitations.length,
          deficiencies: categoryResult.deficiencies.length
        });
      }
    }
    
    // Show debug info about what's being included in PDF
    const totalItems = result.reduce((sum, cat) => 
      sum + cat.comments.length + cat.limitations.length + cat.deficiencies.length, 0);
    
    console.log('=== STRUCTURAL SYSTEMS DATA PREPARED ===');
    console.log(`Total categories: ${result.length}`);
    console.log(`Total visual items: ${totalItems}`);
    console.log('Result:', result);
    
    // Don't show toast messages - just log for debugging
    if (totalItems === 0) {
      console.log('No structural visuals selected for PDF');
    } else {
      console.log(`Including ${totalItems} structural visuals in PDF`);
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
      const roomId = roomData.roomId || this.roomRecordIds[roomName];
      
      const roomResult: any = {
        name: roomName,
        fdf: roomData.fdf,
        fdfPhotos: roomData.fdfPhotos || {}, // Include FDF photos from room data
        notes: roomData.notes,
        points: [],
        photos: []
      };
      
      // Fetch FDF photos from Services_Rooms table and convert to base64
      if (roomId) {
        try {
          // Get the room record to fetch FDF photo paths
          const query = `RoomID=${roomId}`;
          const roomResponse = await this.caspioService.get(`/tables/Services_Rooms/records?q.where=${encodeURIComponent(query)}`).toPromise();
          const roomRecords = (roomResponse as any)?.Result || [];

          if (roomRecords && roomRecords.length > 0) {
            const roomRecord = roomRecords[0];
            const fdfPhotosData: any = {};

            // Process each FDF photo type
            const fdfPhotoTypes = [
              { field: 'FDFPhotoTop', key: 'top' },
              { field: 'FDFPhotoBottom', key: 'bottom' },
              { field: 'FDFPhotoThreshold', key: 'threshold' }
            ];

            console.log(`[FDF Photos v1.4.327] Room ${roomName} record:`, roomRecord);
            
            for (const photoType of fdfPhotoTypes) {
              const photoPath = roomRecord[photoType.field];
              console.log(`[FDF Photos v1.4.327] Checking ${photoType.field}: ${photoPath}`);

              if (photoPath) {
                // Convert Caspio file path to base64
                if (photoPath.startsWith('/')) {
                  try {
                    console.log(`[FDF Photos v1.4.327] Converting ${photoType.key} photo from path: ${photoPath}`);
                    
                    const base64Data = await this.caspioService.getImageFromFilesAPI(photoPath).toPromise();
                    if (base64Data && base64Data.startsWith('data:')) {
                      fdfPhotosData[photoType.key] = true;
                      fdfPhotosData[`${photoType.key}Url`] = base64Data;
                      console.log(`[FDF Photos v1.4.327] Successfully converted ${photoType.key} photo to base64`);
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
                    console.log(`[FDF Photos v1.4.327] Using fallback URL for ${photoType.key}`);
                  }
                } else {
                  console.log(`[FDF Photos v1.4.327] Photo path doesn't start with / for ${photoType.key}: ${photoPath}`);
                }
              } else {
                console.log(`[FDF Photos v1.4.327] No photo found for ${photoType.field}`);
              }
            }
            
            // Merge with existing fdfPhotos (in case they were already loaded)
            roomResult.fdfPhotos = { ...roomResult.fdfPhotos, ...fdfPhotosData };
            console.log(`[FDF Photos v1.4.327] Final fdfPhotos for room ${roomName}:`, roomResult.fdfPhotos);
          } else {
            console.log(`[FDF Photos v1.4.327] No room records found for RoomID ${roomId}`);
          }
          
        } catch (error) {
          console.error(`[FDF Photos v1.4.327] Error fetching FDF photos for room ${roomName}:`, error);
        }
        
        console.log(`Fetching points for room ${roomName} (RoomID: ${roomId})`);
        
        try {
          // Get all points for this room from the database
          const dbPoints = await this.foundationData.getRoomPoints(roomId);
          console.log(`Found ${dbPoints?.length || 0} points in database for room ${roomName}`);
          
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
                this.foundationData.getRoomAttachments(pointId)
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
            console.log(`Converting ${imagePromises.length} images for room ${roomName}...`);
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
    
    console.log(`Prepared elevation data for ${result.length} rooms`);
    
    // Debug log FDF photos in final result
    console.log('[FDF Photos] Final elevation data with FDF photos:');
    result.forEach(room => {
      if (room.fdfPhotos && Object.keys(room.fdfPhotos).length > 0) {
        console.log(`[FDF Photos] Room ${room.name} has FDF photos:`, room.fdfPhotos);
      } else {
        console.log(`[FDF Photos] Room ${room.name} has no FDF photos`);
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
      console.log(`Ã°Å¸â€œÂ¸ Getting photos for key ${fullKey}:`, photos.length);
    }

    // Fallback to visualId if no photos found with key
    if (photos.length === 0) {
      photos = this.visualPhotos[visualId] || [];
      console.log(`Ã°Å¸â€œÂ¸ Fallback: Getting photos for visual ${visualId}:`, photos.length);
    }
    
    // Use the cache service for better performance across sessions
    const cacheKey = this.cache.getApiCacheKey('visual_photos', { visualId });
    const cachedPhotos = this.cache.get(cacheKey);
    if (cachedPhotos) {
      console.log(`Ã¢Å“â€¦ Using cached photos for visual ${visualId}`);
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
            console.log(`Converting Caspio path to base64: ${photoUrl}`);
            const base64Data = await this.caspioService.getImageFromFilesAPI(photoUrl).toPromise();
            
            if (base64Data && base64Data.startsWith('data:')) {
              finalUrl = base64Data;
              // Cache individual photo for reuse
              this.cache.set(photoCacheKey, base64Data, this.cache.CACHE_TIMES.LONG);
              console.log(`Ã¢Å“â€¦ Photo converted and cached for visual ${visualId}`);
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
        // Keep blob and data URLs as-is
        console.log(`Keeping existing URL format: ${photoUrl.substring(0, 50)}...`);
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
    // Get photos for a specific room from Services_Rooms_Points and Services_Rooms_Points_Attach
    try {
      console.log(`Ã°Å¸â€œÂ¸ Fetching photos for room ${roomId}`);
      
      // First get all points for this room
      const points = await this.foundationData.getRoomPoints(roomId);
      
      if (!points || points.length === 0) {
        console.log(`No points found for room ${roomId}`);
        return [];
      }
      
      // Get all point IDs
      const pointIds = points.map((p: any) => p.PointID || p.PK_ID).filter(id => id);
      
      if (pointIds.length === 0) {
        console.log(`No valid point IDs found for room ${roomId}`);
        return [];
      }
      
      // Fetch all attachments for these points
      const attachments = await this.foundationData.getRoomAttachments(pointIds);
      
      if (!attachments || attachments.length === 0) {
        console.log(`No attachments found for room ${roomId} points`);
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
            console.log(`Converting room photo to base64: ${photoUrl}`);
            const base64Data = await this.caspioService.getImageFromFilesAPI(photoUrl).toPromise();
            
            if (base64Data && base64Data.startsWith('data:')) {
              finalUrl = base64Data;
              console.log(`Ã¢Å“â€¦ Room photo converted to base64`);
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
            console.log('Failed to parse Drawings in room photos:', e);
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
      console.log('Ã°Å¸â€œÅ  Fetching all visuals from database for ServiceID:', this.serviceId);
      
      // Fetch all Services_Visuals records for this service
      const visuals = await this.foundationData.getVisualsByService(this.serviceId);
      
      // Check if visuals is defined and is an array
      if (!visuals || !Array.isArray(visuals)) {
        console.log('No visuals found for this service');
        return;
      }
      
      console.log(`Found ${visuals.length} visual records`);
      
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
          console.log(`Visual ${visualId} has no attachments`);
          this.visualPhotos[visualId] = [];
        } else {
          console.log(`Visual ${visualId} has ${attachments.length} attachments`);
          
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
                console.log(`Ã°Å¸â€œÂ Loaded annotation data for AttachID ${att.AttachID}:`, annotationData);
              } catch (e) {
                console.log(`Ã¢Å¡Â Ã¯Â¸Â Could not parse Drawings field for AttachID ${att.AttachID}`);
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
      
      console.log('Ã¢Å“â€¦ Database fetch complete. Visual photos:', this.visualPhotos);
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
        console.log(`Marked as selected from database: ${key}`);
      }
    }
  }
}



