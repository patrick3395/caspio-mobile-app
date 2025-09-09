import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { CaspioService } from '../../services/caspio.service';
import { ToastController, LoadingController, AlertController, ActionSheetController, ModalController, Platform } from '@ionic/angular';
import { CameraService } from '../../services/camera.service';
import { ImageCompressionService } from '../../services/image-compression.service';
import { CacheService } from '../../services/cache.service';
import { PhotoViewerComponent } from '../../components/photo-viewer/photo-viewer.component';
// import { PhotoAnnotatorComponent } from '../../components/photo-annotator/photo-annotator.component';
import { FabricPhotoAnnotatorComponent } from '../../components/fabric-photo-annotator/fabric-photo-annotator.component';
import { PdfPreviewComponent } from '../../components/pdf-preview/pdf-preview.component';
import { PdfGeneratorService } from '../../services/pdf-generator.service';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
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
  
  // Track field completion
  fieldCompletion: { [key: string]: number } = {
    structural: 0,
    elevation: 0
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
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
    private cache: CacheService
  ) {}

  async ngOnInit() {
    // Get project ID from route params
    this.projectId = this.route.snapshot.paramMap.get('projectId') || '';
    this.serviceId = this.route.snapshot.paramMap.get('serviceId') || '';
    
    console.log('Engineers Foundation Evaluation initialized:', {
      projectId: this.projectId,
      serviceId: this.serviceId
    });
    
    // Load all data in parallel for faster initialization
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
    } catch (error) {
      console.error('Error loading template data:', error);
    }
  }
  
  ngAfterViewInit() {
    // ViewChild ready
  }
  
  // Page re-entry - photos now use base64 URLs so no refresh needed
  async ionViewWillEnter() {
    console.log('ionViewWillEnter - page re-entered');
    
    // Photos now use base64 data URLs like Structural section
    // No need to refresh URLs as they don't expire
  }

  ngOnDestroy() {
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
  }
  
  async loadProjectData() {
    if (!this.projectId) return;
    
    try {
      this.projectData = await this.caspioService.getProject(this.projectId).toPromise();
      console.log('Project data loaded:', this.projectData);
      
      // Type information is now loaded from Service data which has the correct TypeID
    } catch (error) {
      console.error('Error loading project data:', error);
      await this.showToast('Failed to load project data', 'danger');
    }
  }
  
  async loadTypeInfo(typeId: string) {
    try {
      const typeData = await this.caspioService.getType(typeId).toPromise();
      if (typeData?.TypeShort) {
        this.typeShort = typeData.TypeShort;
        console.log('Type information loaded:', this.typeShort);
      }
    } catch (error) {
      console.error('Error loading type info:', error);
      // Keep default value if load fails
    }
  }
  
  async loadServiceData() {
    if (!this.serviceId) {
      console.log('⚠️ No serviceId available for loading service data');
      return;
    }
    
    console.log(`🔍 Loading service data for ServiceID: ${this.serviceId}`);
    
    try {
      // Load service data from Services table
      const serviceResponse = await this.caspioService.getService(this.serviceId).toPromise();
      if (serviceResponse) {
        this.serviceData = serviceResponse;
        console.log('Service data loaded:', this.serviceData);
        
        // Load type information using TypeID from service data
        if (this.serviceData?.TypeID) {
          await this.loadTypeInfo(this.serviceData.TypeID);
        }
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
        Notes: this.serviceData.Notes || ''
      };
    }
  }
  
  async loadRoomTemplates() {
    try {
      const allTemplates = await this.caspioService.getServicesRoomTemplates().toPromise();
      
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
          const existingRooms = await this.caspioService.getServicesRooms(this.serviceId).toPromise();
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
                  
                  // Load FDF photos if they exist
                  const fdfPhotos: any = {};
                  if (room.FDFPhotoTop) {
                    fdfPhotos.top = true;
                    // Generate URL for display
                    const token = await this.caspioService.getValidToken();
                    const account = this.caspioService.getAccountID();
                    fdfPhotos.topUrl = `https://${account}.caspio.com/rest/v2/files${room.FDFPhotoTop}?access_token=${token}`;
                  }
                  if (room.FDFPhotoBottom) {
                    fdfPhotos.bottom = true;
                    const token = await this.caspioService.getValidToken();
                    const account = this.caspioService.getAccountID();
                    fdfPhotos.bottomUrl = `https://${account}.caspio.com/rest/v2/files${room.FDFPhotoBottom}?access_token=${token}`;
                  }
                  if (room.FDFPhotoThreshold) {
                    fdfPhotos.threshold = true;
                    const token = await this.caspioService.getValidToken();
                    const account = this.caspioService.getAccountID();
                    fdfPhotos.thresholdUrl = `https://${account}.caspio.com/rest/v2/files${room.FDFPhotoThreshold}?access_token=${token}`;
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
      this.weatherConditionsOptions = ['Clear', 'Partly Cloudy', 'Cloudy', 'Light Rain', 'Heavy Rain', 'Windy', 'Foggy'];
      this.outdoorTemperatureOptions = ['60°F', '65°F', '70°F', '75°F', '80°F', '85°F', '90°F', '95°F', '100°F'];
      this.occupancyFurnishingsOptions = ['Occupied - Furnished', 'Occupied - Unfurnished', 'Vacant - Furnished', 'Vacant - Unfurnished'];
      this.inAttendanceOptions = ['Owner', 'Occupant', 'Agent', 'Builder', 'Other'];
      this.firstFoundationTypeOptions = ['Slab on Grade', 'Pier and Beam', 'Basement', 'Crawl Space'];
      this.secondFoundationTypeOptions = ['Slab on Grade', 'Pier and Beam', 'Basement', 'Crawl Space', 'None'];
      this.thirdFoundationTypeOptions = ['Slab on Grade', 'Pier and Beam', 'Basement', 'Crawl Space', 'None'];
      this.secondFoundationRoomsOptions = ['Living Room', 'Kitchen', 'Master Bedroom', 'Bathroom', 'Other'];
      this.thirdFoundationRoomsOptions = ['Living Room', 'Kitchen', 'Master Bedroom', 'Bathroom', 'Other'];
      this.ownerOccupantInterviewOptions = ['Yes', 'No', 'Not Available'];
      
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
              const aNum = parseFloat(a.replace(/['"]/g, ''));
              const bNum = parseFloat(b.replace(/['"]/g, ''));
              
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
        
        console.log('TypeOfBuilding options:', this.typeOfBuildingOptions);
        console.log('Style options:', this.styleOptions);
        
        // Add default options if none found in database
        if (this.typeOfBuildingOptions.length === 0) {
          this.typeOfBuildingOptions = ['Single Family', 'Multi-Family', 'Commercial', 'Industrial'];
        }
        if (this.styleOptions.length === 0) {
          this.styleOptions = ['Ranch', 'Two Story', 'Split Level', 'Bi-Level', 'Tri-Level'];
        }
      }
    } catch (error) {
      console.error('Error loading project dropdown options:', error);
      // Set default options on error
      this.typeOfBuildingOptions = ['Single Family', 'Multi-Family', 'Commercial', 'Industrial'];
      this.styleOptions = ['Ranch', 'Two Story', 'Split Level', 'Bi-Level', 'Tri-Level'];
    }
  }
  
  // Get FDF options for a specific room
  getFDFOptionsForRoom(roomName: string): string[] {
    // Check if room-specific options exist
    if (this.roomFdfOptions[roomName] && this.roomFdfOptions[roomName].length > 0) {
      return this.roomFdfOptions[roomName];
    }
    // Fall back to default options
    return this.fdfOptions;
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
      
      // Trigger file input to show native iOS picker (Photo Library, Take Photo, Choose Files)
      setTimeout(() => {
        if (this.fileInput && this.fileInput.nativeElement) {
          this.fileInput.nativeElement.click();
        } else {
          console.error('File input not available');
          this.showToast('File input not available', 'danger');
          this.currentFDFPhotoContext = null;
        }
      }, 100);
      
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
      
      const token = await this.caspioService.getValidToken();
      const account = this.caspioService.getAccountID();
      
      const uploadResponse = await fetch(`https://${account}.caspio.com/rest/v2/files`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: uploadFormData
      });
      
      const uploadResult = await uploadResponse.json();
      const filePath = `/${uploadResult.Name}`;
      
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
      
      // Create preview URL from file
      const photoUrl = URL.createObjectURL(file);
      this.roomElevationData[roomName].fdfPhotos[`${photoKey}Url`] = photoUrl;
      
      await this.showToast(`${photoType} photo saved`, 'success');
      
    } catch (error) {
      console.error(`Error processing FDF ${photoType} photo:`, error);
      await this.showToast(`Failed to save ${photoType} photo`, 'danger');
    } finally {
      // Clear context
      this.currentFDFPhotoContext = null;
    }
  }
  
  // View FDF photo in modal
  async viewFDFPhoto(roomName: string, photoType: 'Top' | 'Bottom' | 'Threshold') {
    const photoKey = photoType.toLowerCase();
    const photoUrl = this.roomElevationData[roomName]?.fdfPhotos?.[`${photoKey}Url`];
    
    if (photoUrl) {
      const modal = await this.modalController.create({
        component: PhotoViewerComponent,
        componentProps: {
          photos: [{ url: photoUrl, caption: `FDF ${photoType} - ${roomName}` }],
          initialIndex: 0
        },
        cssClass: 'photo-viewer-modal'
      });
      
      await modal.present();
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
      
      // Check if point record exists, create if not
      const pointKey = `${roomName}_${point.name}`;
      let pointId = this.roomPointIds[pointKey];
      
      if (!pointId) {
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
      
      // Use the EXACT same method as Structural section - set context and trigger file input
      this.currentRoomPointContext = { 
        roomName, 
        point, 
        pointId, 
        roomId 
      };
      
      // Trigger file input with small delay to ensure UI is ready
      setTimeout(() => {
        if (this.fileInput && this.fileInput.nativeElement) {
          this.fileInput.nativeElement.click();
        } else {
          console.error('File input not available');
          this.showToast('File input not available', 'danger');
          this.currentRoomPointContext = null;
        }
      }, 100);
      
    } catch (error) {
      console.error('Error in capturePhotoForPoint:', error);
      await this.showToast('Failed to capture photo', 'danger');
    }
  }
  
  // Load existing room points and their photos
  async loadExistingRoomPoints(roomId: string, roomName: string) {
    try {
      // Get all points for this room
      const points = await this.caspioService.getServicesRoomsPoints(roomId).toPromise();
      
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
              const photos = await this.caspioService.getServicesRoomsAttachments(actualPointId).toPromise();
              if (photos && photos.length > 0) {
                elevationPoint.photoCount = photos.length;
                
                // Process photos to get base64 URLs like Structural section does
                elevationPoint.photos = await Promise.all(photos.map(async (photo: any) => {
                  const photoPath = photo.Photo || '';
                  let photoUrl = '';
                  let thumbnailUrl = '';
                  
                  if (photoPath) {
                    try {
                      // Use the same method as Structural section - fetch as base64 data URL
                      console.log(`Fetching room photo from Files API: ${photoPath}`);
                      const imageData = await this.caspioService.getImageFromFilesAPI(photoPath).toPromise();
                      
                      if (imageData && imageData.startsWith('data:')) {
                        photoUrl = imageData;
                        thumbnailUrl = imageData;
                      } else {
                        // Fallback to SVG if fetch fails
                        photoUrl = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#e0e0e0"/><text x="75" y="50" text-anchor="middle" fill="#666" font-size="14">📷 Photo</text></svg>');
                        thumbnailUrl = photoUrl;
                      }
                    } catch (err) {
                      console.error('Error fetching room photo:', err);
                      // Fallback to SVG on error
                      photoUrl = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#e0e0e0"/><text x="75" y="50" text-anchor="middle" fill="#666" font-size="14">📷 Photo</text></svg>');
                      thumbnailUrl = photoUrl;
                    }
                  }
                  
                  return {
                    url: photoUrl,
                    thumbnailUrl: thumbnailUrl,
                    annotation: photo.Annotation || '',
                    attachId: photo.AttachID || photo.PK_ID,
                    originalPath: photoPath,
                    filePath: photoPath  // Keep for compatibility
                  };
                }));
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
  
  // Capture another room photo using camera service directly
  private async captureAnotherRoomPhoto(roomName: string, point: any, pointId: string) {
    try {
      // Use camera service directly (like Structural section)
      const photo = await this.cameraService.takePicture();
      
      if (!photo || !photo.dataUrl) {
        console.log('No photo captured');
        return;
      }
      
      // Convert base64 to File
      const fileName = `room_point_${pointId}_${Date.now()}.jpg`;
      const file = await this.cameraService.base64ToFile(photo.dataUrl, fileName);
      
      if (!file) {
        await this.showToast('Failed to process photo', 'danger');
        return;
      }
      
      // Create preview
      const photoUrl = URL.createObjectURL(file);
      
      // Add to UI immediately with uploading flag
      if (!point.photos) {
        point.photos = [];
      }
      
      const photoEntry: any = {
        url: photoUrl,
        thumbnailUrl: photoUrl,
        annotation: '',
        uploading: true,
        file: file,
        attachId: null
      };
      
      point.photos.push(photoEntry);
      point.photoCount = point.photos.length;
      
      // Upload in background
      this.uploadPhotoToRoomPointFromFile(pointId, file, point.name)
        .then(async (response) => {
          photoEntry.uploading = false;
          photoEntry.attachId = response?.AttachID || response?.PK_ID;
          
          // Store original path and fetch as base64 for preview
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
          
          console.log(`Photo uploaded for point ${point.name}, AttachID: ${photoEntry.attachId}`);
        })
        .catch((err) => {
          console.error('Failed to upload photo:', err);
          // Remove failed photo from UI
          const index = point.photos.indexOf(photoEntry);
          if (index > -1) {
            point.photos.splice(index, 1);
            point.photoCount = point.photos.length;
          }
          this.showToast('Failed to upload photo', 'danger');
        });
      
      // Ask if they want another photo immediately - dialog shows instantly
      const continueAlert = await this.alertController.create({
        cssClass: 'compact-photo-selector photo-upload-dialog',
        backdropDismiss: false,
        buttons: [
          {
            text: 'Done',
            role: 'done',
            cssClass: 'done-button'
          },
          {
            text: 'Take Another Photo',
            role: 'another',
            cssClass: 'action-button',
            handler: async () => {
              // Recursively call to capture another photo
              setTimeout(async () => {
                await this.captureAnotherRoomPhoto(roomName, point, pointId);
              }, 100);
              return true;
            }
          }
        ]
      });
      
      await continueAlert.present();
      
    } catch (error) {
      console.error('Error capturing room photo:', error);
      await this.showToast('Failed to capture photo', 'danger');
    }
  }
  
  // Handle file selection for room points (exact copy of visual method)
  private async handleRoomPointFileSelect(files: FileList) {
    try {
      const { roomName, point, pointId, roomId } = this.currentRoomPointContext;
      
      console.log(`Handling ${files.length} file(s) for room point: ${point.name}`);
      
      // Show non-blocking toast
      const uploadMessage = files.length > 1 
        ? `Uploading ${files.length} photos...`
        : 'Uploading photo...';
      await this.showToast(uploadMessage, 'info');
      
      let uploadSuccessCount = 0;
      const uploadPromises = [];
      
      // Process each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Create preview immediately
        const photoUrl = URL.createObjectURL(file);
        
        // Add to UI immediately with uploading flag
        if (!point.photos) {
          point.photos = [];
        }
        
        const photoEntry: any = {
          url: photoUrl,
          thumbnailUrl: photoUrl,
          annotation: '',
          uploading: true,
          file: file,
          attachId: null  // Initialize attachId property
        };
        
        point.photos.push(photoEntry);
        point.photoCount = point.photos.length;
        
        // Upload in background
        const uploadPromise = this.uploadPhotoToRoomPointFromFile(pointId, file, point.name)
          .then(async (response) => {
            photoEntry.uploading = false;
            // Store the attachment ID for annotation updates
            photoEntry.attachId = response?.AttachID || response?.PK_ID;
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
      
      // Don't show "Take Another Photo" prompt for file input selections
      // The native file picker already allows multiple selection
      // This prompt should only appear when using the camera service directly
      
      // Wait for all uploads to complete regardless of count
      await Promise.all(uploadPromises);
        
      if (uploadSuccessCount === 0) {
        await this.showToast('Failed to upload photos', 'danger');
      }
      
    } catch (error) {
      console.error('Error handling room point files:', error);
      await this.showToast('Failed to process photos', 'danger');
    } finally {
      // Reset file input
      if (this.fileInput && this.fileInput.nativeElement) {
        this.fileInput.nativeElement.value = '';
      }
      this.currentRoomPointContext = null;
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
  
  // Upload photo from File object to Services_Rooms_Points_Attach (matching visual method)
  async uploadPhotoToRoomPointFromFile(pointId: string, file: File, pointName: string) {
    try {
      const pointIdNum = parseInt(pointId, 10);
      
      // COMPRESS the file before upload
      const compressedFile = await this.imageCompression.compressImage(file, {
        maxSizeMB: 1.5,
        maxWidthOrHeight: 1920,
        useWebWorker: true
      }) as File;
      
      // Directly proceed with upload and return the response
      const response = await this.performRoomPointPhotoUpload(pointIdNum, compressedFile, pointName);
      return response;  // Return response so we can get AttachID
      
    } catch (error) {
      console.error('Error in uploadPhotoToRoomPointFromFile:', error);
      throw error;
    }
  }
  
  // Perform the actual room point photo upload (matching visual method)
  private async performRoomPointPhotoUpload(pointIdNum: number, photo: File, pointName: string) {
    try {
      console.log('📦 Using two-step upload for room point photo');
      
      // Use the new two-step method that matches visual upload
      const response = await this.caspioService.createServicesRoomsPointsAttachWithFile(
        pointIdNum,
        '', // Annotation blank as requested
        photo
      ).toPromise();
      
      console.log('✅ Room point photo uploaded successfully:', response);
      
      return response;  // Return the response with AttachID
      
    } catch (error: any) {
      console.error('❌ Failed to upload room point photo:', error);
      
      // Just show simple error toast
      await this.showToast('Failed to upload photo', 'danger');
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
          await this.showToast('Failed to create room', 'danger');
          this.selectedRooms[roomName] = false;
        }
      } catch (error: any) {
        console.error('Error toggling room selection:', error);
        await this.showToast('Failed to update room selection', 'danger');
        this.selectedRooms[roomName] = false;
        if (event && event.target) {
          event.target.checked = false; // Revert checkbox visually on error
        }
      } finally {
        this.savingRooms[roomName] = false;
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
        
        // Create room directly
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
      console.error('Error adding room template:', error);
      await this.showToast('Failed to add room', 'danger');
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
              try {
                const pointData = {
                  RoomID: parseInt(roomId),
                  PointName: pointName
                };
                
                const response = await this.caspioService.createServicesRoomsPoint(pointData).toPromise();
                if (response && (response.PointID || response.PK_ID)) {
                  const pointId = response.PointID || response.PK_ID;
                  const pointKey = `${roomName}_${pointName}`;
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
    await this.loadExistingVisualSelections();
    
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
  
  async loadExistingVisualSelections() {
    console.log('=====================================');
    console.log('📥 LOADING EXISTING VISUAL SELECTIONS');
    console.log('=====================================');
    console.log('   ServiceID:', this.serviceId);
    
    if (!this.serviceId) {
      console.log('❌ No ServiceID - skipping load');
      return;
    }
    
    try {
      console.log('⏳ Fetching from Services_Visuals table...');
      const existingVisuals = await this.caspioService.getServicesVisualsByServiceId(this.serviceId).toPromise();
      console.log('📋 Existing visuals loaded:', existingVisuals);
      console.log('   Count:', existingVisuals?.length || 0);
      
      // Mark items as selected based on existing records
      if (existingVisuals && Array.isArray(existingVisuals)) {
        existingVisuals.forEach(visual => {
          console.log('🔍 Processing visual:', visual);
          
          // Find matching template by Name and Category
          if (visual.Category && visual.Name) {
            // Find the template that matches this visual
            const matchingTemplate = this.visualTemplates.find(t => 
              t.Category === visual.Category && 
              t.Name === visual.Name
            );
            
            if (matchingTemplate) {
              const key = `${visual.Category}_${matchingTemplate.PK_ID}`;
              console.log('✅ Found matching template, marking as selected:', key);
              console.log('   Template PK_ID:', matchingTemplate.PK_ID);
              console.log('   Visual Name:', visual.Name);
              this.selectedItems[key] = true;
              
              // Store the visual record ID
              const visualId = visual.VisualID || visual.PK_ID || visual.id;
              
              // Store in tracking object for photo uploads - ALWAYS as string
              this.visualRecordIds[key] = String(visualId);
              
              // Update the text and selectedOptions in organizedData based on AnswerType
              const updateItemData = (items: any[]) => {
                const item = items.find(i => i.id === matchingTemplate.PK_ID);
                if (item) {
                  // Check if Answers field exists (for AnswerType 1 and 2)
                  const hasAnswersField = visual.Answers !== undefined && visual.Answers !== null && visual.Answers !== '';
                  
                  // For Yes/No questions (AnswerType 1)
                  if (item.answerType === 1) {
                    if (hasAnswersField) {
                      // Use Answers field for the answer
                      item.answer = visual.Answers;
                      item.text = visual.Text || item.originalText || ''; // Preserve original text
                    } else if (visual.Text === 'Yes' || visual.Text === 'No') {
                      // Fallback to old method if Answers field not populated
                      item.answer = visual.Text;
                      item.text = item.originalText || '';
                    }
                  }
                  // For multi-select questions (AnswerType 2)
                  else if (item.answerType === 2) {
                    if (hasAnswersField) {
                      // Parse comma-delimited answers
                      item.selectedOptions = visual.Answers.split(',').map((s: string) => s.trim());
                      item.text = visual.Text || item.originalText || ''; // Preserve original text
                    } else if (visual.Text) {
                      // Fallback to old method if Answers field not populated
                      item.selectedOptions = visual.Text.split(',').map((s: string) => s.trim());
                    }
                  }
                  // For text questions (AnswerType 0 or undefined)
                  else {
                    item.text = visual.Text || '';
                  }
                }
              };
              
              // Update in the appropriate section
              if (this.organizedData[visual.Category]) {
                updateItemData(this.organizedData[visual.Category].comments);
                updateItemData(this.organizedData[visual.Category].limitations);
                updateItemData(this.organizedData[visual.Category].deficiencies);
              }
              
              console.log('📌 Stored visual ID:', visualId, 'for key:', key, 'Type:', typeof this.visualRecordIds[key]);
              console.log('📋 Updated selectedItems:', this.selectedItems);
            } else {
              console.log('⚠️ No matching template found for:', visual.Name);
            }
          }
        });
      }
      
      console.log('✅ Visual selections restored:', this.selectedItems);
      console.log('📌 Visual record IDs:', this.visualRecordIds);
      
      // Add a small delay to ensure visual IDs are properly set
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Load existing photos for these visuals
      console.log('📸 About to load existing photos...');
      await this.loadExistingPhotos();
      console.log('📸 Finished loading existing photos');
    } catch (error) {
      console.error('Error loading existing visual selections:', error);
    }
  }
  
  toggleSection(section: string) {
    this.expandedSections[section] = !this.expandedSections[section];
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
    if (event.detail.value) {
      // Store the expanded accordion value
      this.expandedAccordions = Array.isArray(event.detail.value) 
        ? event.detail.value 
        : [event.detail.value];
    } else {
      this.expandedAccordions = [];
    }
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
        const structuralFields = ['foundationType', 'foundationCondition', 'structuralObservations'];
        const filledStructural = structuralFields.filter(field => this.formData[field]).length;
        return Math.round((filledStructural / structuralFields.length) * 100);
        
      case 'elevation':
        const hasRoomData = Object.keys(this.roomElevationData).length > 0;
        return hasRoomData ? 100 : 0;
        
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
  
  // View room photo with viewer modal
  async viewRoomPhoto(photo: any, roomName: string, point: any) {
    try {
      // Use the photo URL directly (it's already base64 or a proper URL)
      const photoUrl = photo.url || photo.thumbnailUrl || 'assets/img/photo-placeholder.png';
      
      const modal = await this.modalController.create({
        component: PhotoViewerComponent,
        componentProps: {
          photoUrl: photoUrl,
          photoName: `${roomName} - ${point.name}`,
          photoCaption: photo.annotation || '',
          showAnnotation: true,
          captionEditable: true,
          photoData: photo
        }
      });
      
      await modal.present();
      
      const { data } = await modal.onDidDismiss();
      if (data && data.updatedCaption !== undefined) {
        photo.annotation = data.updatedCaption;
        await this.saveRoomPhotoCaption(photo, roomName, point);
      }
    } catch (error) {
      console.error('Error viewing room photo:', error);
    }
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
  
  // View elevation photo in modal (legacy redirect)
  async viewElevationPhoto(photo: any) {
    console.log('Viewing elevation photo:', photo);
    
    // Use the PhotoViewerComponent directly since we don't have category/itemId context
    if (photo && (photo.url || photo.filePath)) {
      const modal = await this.modalController.create({
        component: PhotoViewerComponent,
        componentProps: {
          photo: {
            ...photo,
            Photo: photo.filePath || photo.url
          }
        },
        cssClass: 'photo-viewer-modal'
      });
      await modal.present();
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

  async generatePDF() {
    // Validate all required Project Information fields before generating PDF
    const requiredProjectFields = ['ClientName', 'AgentName', 'InspectorName', 
                                    'YearBuilt', 'SquareFeet', 'TypeOfBuilding', 'Style'];
    const requiredServiceFields = ['InAttendance', 'OccupancyFurnishings', 'WeatherConditions', 'OutdoorTemperature'];
    
    const missingProjectFields = requiredProjectFields.filter(field => !this.projectData[field]);
    const missingServiceFields = requiredServiceFields.filter(field => !this.serviceData[field]);
    
    if (missingProjectFields.length > 0 || missingServiceFields.length > 0) {
      const allMissing = [...missingProjectFields, ...missingServiceFields];
      await this.showToast(`Please fill in all required fields before generating PDF: ${allMissing.join(', ')}`, 'warning');
      
      // Scroll to Project Information section if there are missing fields
      const projectSection = document.querySelector('.section-card');
      if (projectSection) {
        projectSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    
    // Create a single loading indicator that stays until PDF is ready
    const loading = await this.loadingController.create({
      message: 'Loading PDF...',
      spinner: 'crescent',
      backdropDismiss: false
    });
    await loading.present();

    try {
      // Check if we have cached PDF data (valid for 5 minutes)
      const cacheKey = this.cache.getApiCacheKey('pdf_data', { 
        serviceId: this.serviceId,
        timestamp: Math.floor(Date.now() / 300000) // 5-minute blocks
      });
      
      let structuralSystemsData, elevationPlotData, projectInfo;
      const cachedData = this.cache.get(cacheKey);
      
      if (cachedData) {
        console.log('📦 Using cached PDF data');
        ({ structuralSystemsData, elevationPlotData, projectInfo } = cachedData);
      } else {
        // Load all data in parallel for maximum speed
        console.log('⚡ Loading PDF data in parallel...');
        const startTime = Date.now();
        
        // Execute all data fetching in parallel
        const [projectData, structuralData, elevationData] = await Promise.all([
          this.prepareProjectInfo(),
          this.prepareStructuralSystemsData(),
          this.prepareElevationPlotData()
        ]);
        
        projectInfo = projectData;
        structuralSystemsData = structuralData;
        elevationPlotData = elevationData;
        
        console.log(`✅ All data loaded in ${Date.now() - startTime}ms`);
        
        // Cache the prepared data
        this.cache.set(cacheKey, {
          structuralSystemsData,
          elevationPlotData,
          projectInfo
        }, this.cache.CACHE_TIMES.MEDIUM);
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
      
      // Now open the modal with all data ready
      const modal = await this.modalController.create({
        component: PdfPreviewComponent,
        componentProps: {
          projectData: projectInfo,
          structuralData: structuralSystemsData,
          elevationData: elevationPlotData,
          serviceData: this.serviceData,
          loadingController: loading  // Pass the loading controller to the modal
        },
        cssClass: 'fullscreen-modal'
      });
      
      // Present the modal first, then let the PDF component dismiss the loader when ready
      await modal.present();
      
    } catch (error) {
      console.error('Error preparing preview:', error);
      await loading.dismiss();
      await this.showToast('Failed to prepare preview', 'danger');
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
  
  showSaveStatus(message: string, type: 'info' | 'success' | 'error') {
    this.saveStatus = message;
    this.saveStatusType = type;
    
    setTimeout(() => {
      this.saveStatus = '';
    }, 3000);
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
    console.log('🔄 TOGGLE ITEM SELECTION CALLED');
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
    
    console.log('✅ Item toggled:', key, 'New state:', this.selectedItems[key]);
    
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
    
    // Find the template data first
    const template = this.visualTemplates.find(t => t.PK_ID === templateId);
    if (!template) {
      console.error('Template not found:', templateId);
      return;
    }
    
    // Check if this visual already exists
    const key = `${category}_${templateId}`;
    if (this.visualRecordIds[key]) {
      return;
    }
    
    // Also check if it exists in the database but wasn't loaded yet
    try {
      const existingVisuals = await this.caspioService.getServicesVisualsByServiceId(this.serviceId).toPromise();
      if (existingVisuals) {
        const exists = existingVisuals.find((v: any) => 
          v.Category === category && 
          v.Name === template.Name
        );
        if (exists) {
          const existingId = exists.VisualID || exists.PK_ID || exists.id;
          this.visualRecordIds[key] = String(existingId);
          return;
        }
      }
    } catch (error) {
      console.error('Error checking for existing visual:', error);
    }
    
    // Convert ServiceID to number (Caspio expects Integer type)
    const serviceIdNum = parseInt(this.serviceId, 10);
    if (isNaN(serviceIdNum)) {
      console.error('Invalid ServiceID - not a number:', this.serviceId);
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
        textValue = item.originalText || template.Text || '';
      }
      // For AnswerType 1 (Yes/No), store the answer in Answers field
      else if (item.answerType === 1 && item.answer) {
        answers = item.answer;
        textValue = item.originalText || template.Text || '';
      }
      // For AnswerType 2 (multi-select), store comma-delimited answers
      else if (item.answerType === 2 && item.selectedOptions && item.selectedOptions.length > 0) {
        answers = item.selectedOptions.join(', ');
        textValue = item.originalText || template.Text || '';
      }
      // For AnswerType 0 or undefined (text), use the text field as is
      else {
        textValue = item.text || template.Text || '';
      }
    }
    
    // ONLY include the columns that exist in Services_Visuals table
    const visualData: ServicesVisualRecord = {
      ServiceID: serviceIdNum,
      Category: category || '',
      Kind: template.Kind || '',
      Name: template.Name || '',
      Text: textValue,
      Notes: ''
    };
    
    // Add Answers field if there are answers to store
    if (answers) {
      visualData.Answers = answers;
    }
    
    try {
      const response = await this.caspioService.createServicesVisual(visualData).toPromise();
      
      // Handle response to get the Visual ID
      let visualId: any;
      if (Array.isArray(response) && response.length > 0) {
        visualId = response[0].VisualID || response[0].PK_ID || response[0].id;
      } else if (response && typeof response === 'object') {
        if (response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
          visualId = response.Result[0].VisualID || response.Result[0].PK_ID || response.Result[0].id;
        } else {
          visualId = response.VisualID || response.PK_ID || response.id;
        }
      } else {
        visualId = response;
      }
      
      // Store the visual ID for future reference
      const recordKey = `visual_${category}_${templateId}`;
      localStorage.setItem(recordKey, String(visualId));
      this.visualRecordIds[`${category}_${templateId}`] = String(visualId);
      
    } catch (error: any) {
      console.error('Error saving visual:', error);
      await this.showToast('Failed to save visual', 'danger');
    }
  }
  
  // Remove visual selection from Services_Visuals table
  async removeVisualSelection(category: string, templateId: string) {
    // Check if we have a stored record ID
    const recordKey = `visual_${category}_${templateId}`;
    const recordId = localStorage.getItem(recordKey);
    
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
          <strong style="color: blue;">🔍 MULTI-SELECT CHANGE TRIGGERED</strong><br><br>
          
          <strong>Category:</strong> ${category}<br>
          <strong>Item Name:</strong> ${item.name}<br>
          <strong>Item ID:</strong> ${item.id}<br>
          <strong>Selected Options:</strong> <span style="color: green; font-weight: bold;">${item.selectedOptions?.join(', ') || 'NONE'}</span><br>
          <strong>Answers Text:</strong> ${answersText || 'EMPTY'}<br>
          <strong>Key:</strong> ${key}<br><br>
          
          <strong>Current State:</strong><br>
          • Existing Visual ID: ${this.visualRecordIds[key] || 'NONE - Will Create New'}<br>
          • Is Selected: ${this.selectedItems[key] ? 'YES' : 'NO'}<br>
          • Original Text: ${item.originalText || 'Not stored'}<br>
          • Current Text: ${item.text || 'Empty'}<br><br>
          
          <strong>Service Info:</strong><br>
          • Service ID: ${this.serviceId || 'MISSING!'}<br>
          • Project ID: ${this.projectId}<br><br>
          
          <strong>Dropdown Options Available:</strong><br>
          ${item.dropdownOptions ? item.dropdownOptions.join(', ') : 'No options loaded'}<br><br>
          
          <strong style="color: red;">ACTION TO TAKE:</strong><br>
          ${this.visualRecordIds[key] ? 
            '✓ UPDATE existing record (VisualID: ' + this.visualRecordIds[key] + ')' : 
            (answersText ? '➕ CREATE new Services_Visuals record' : '⚠️ No action - no selections')}<br>
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
            console.log('✅ Updated Services_Visuals Answers field with selections');
            
            // Show success debug
            const successAlert = await this.alertController.create({
              header: 'UPDATE SUCCESS',
              message: `
                <div style="font-family: monospace; font-size: 12px;">
                  <strong style="color: green;">✅ SUCCESSFULLY UPDATED</strong><br><br>
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
                  <strong style="color: red;">❌ UPDATE ERROR</strong><br><br>
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
                <strong style="color: blue;">➕ CREATING Services_Visuals</strong><br><br>
                
                <strong>Data to Send:</strong><br>
                • ServiceID: ${this.serviceId}<br>
                • Category: ${category}<br>
                • Name: ${item.name}<br>
                • Text: ${item.text}<br>
                • Answers: ${answersText}<br>
                • Kind: ${item.kind || 'Comment'}<br><br>
                
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
                  '<strong style="color: green;">✅ RECORD CREATED</strong><br><br>New Visual ID: ' + newVisualId :
                  '<strong style="color: red;">❌ NO RECORD CREATED</strong><br><br>Check saveVisualSelection method!'}
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
            <strong style="color: red;">❌ ERROR OCCURRED</strong><br><br>
            
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
    console.log('🔍 SAVING VISUAL TO SERVICES_VISUALS');
    console.log('=====================================');
    
    if (!this.serviceId) {
      console.error('❌ No ServiceID available for saving visual');
      return;
    }
    
    console.log('📋 Input Parameters:');
    console.log('   Category:', category);
    console.log('   TemplateID:', templateId);
    console.log('   ServiceID:', this.serviceId);
    
    // Find the template data first
    const template = this.visualTemplates.find(t => t.PK_ID === templateId);
    if (!template) {
      console.error('❌ Template not found:', templateId);
      return;
    }
    
    // Check if this visual already exists
    const key = `${category}_${templateId}`;
    if (this.visualRecordIds[key]) {
      console.log('⚠️ Visual already exists with ID:', this.visualRecordIds[key]);
      console.log('   Skipping duplicate save');
      return;
    }
    
    // Also check if it exists in the database but wasn't loaded yet
    try {
      const existingVisuals = await this.caspioService.getServicesVisualsByServiceId(this.serviceId).toPromise();
      if (existingVisuals) {
        const exists = existingVisuals.find((v: any) => 
          v.Category === category && 
          v.Name === template.Name
        );
        if (exists) {
          console.log('⚠️ Visual already exists in database:', exists);
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
    
    console.log('📄 Template Found:', template);
    
    // Convert ServiceID to number (Caspio expects Integer type)
    const serviceIdNum = parseInt(this.serviceId, 10);
    if (isNaN(serviceIdNum)) {
      console.error('❌ Invalid ServiceID - not a number:', this.serviceId);
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
        console.log('📝 Using answerToSave:', answers);
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
      console.log('⏳ Calling caspioService.createServicesVisual...');
      const response = await this.caspioService.createServicesVisual(visualData).toPromise();
      console.log('✅ Visual saved to Services_Visuals:', response);
      console.log('✅ Response details:', JSON.stringify(response, null, 2));
      
      // Skip debug popup for faster performance
      // await this.showVisualCreationDebug(category, templateId, response);
      
      // Check if response exists (even if empty, it might mean success)
      // Caspio sometimes returns empty response on successful POST
      if (response === undefined || response === null || response === '') {
        console.log('⚠️ Empty response received - treating as success (common with Caspio)');
        // Generate a temporary ID for tracking
        const tempId = `temp_${Date.now()}`;
        const recordKey = `visual_${category}_${templateId}`;
        localStorage.setItem(recordKey, tempId);
        this.visualRecordIds[`${category}_${templateId}`] = String(tempId);
        
        // Query the table to get the actual VisualID
        setTimeout(async () => {
          await this.refreshVisualId(category, templateId);
        }, 1000);
        
        console.log('✅ Visual appears to be saved (will verify)');
        return; // Exit successfully
      }
      
      // Store the record ID for potential deletion later
      // Response should have the created record
      let visualId: any;
      
      // If response is an array, get the first item
      // IMPORTANT: Use VisualID, not PK_ID for Services_Visuals table
      if (Array.isArray(response) && response.length > 0) {
        visualId = response[0].VisualID || response[0].PK_ID || response[0].id;
        console.log('📋 Response was array, extracted ID from first item:', visualId);
        console.log('   - VisualID:', response[0].VisualID, '(preferred)');
        console.log('   - PK_ID:', response[0].PK_ID, '(not used if VisualID exists)');
      } else if (response && typeof response === 'object') {
        // If response has Result array (Caspio pattern)
        if (response.Result && Array.isArray(response.Result) && response.Result.length > 0) {
          visualId = response.Result[0].VisualID || response.Result[0].PK_ID || response.Result[0].id;
          console.log('📋 Response had Result array, extracted ID:', visualId);
          console.log('   - VisualID:', response.Result[0].VisualID, '(preferred)');
          console.log('   - PK_ID:', response.Result[0].PK_ID, '(not used if VisualID exists)');
        } else {
          // Direct object response
          visualId = response.VisualID || response.PK_ID || response.id;
          console.log('📋 Response was object, extracted ID:', visualId);
          console.log('   - VisualID:', response.VisualID, '(preferred)');
          console.log('   - PK_ID:', response.PK_ID, '(not used if VisualID exists)');
        }
      } else {
        // Response might be the ID itself
        visualId = response;
        console.log('📋 Response was ID directly:', visualId);
      }
      
      console.log('🔍 Full response object:', JSON.stringify(response, null, 2));
      console.log('🔍 Extracted VisualID:', visualId);
      
      const recordKey = `visual_${category}_${templateId}`;
      localStorage.setItem(recordKey, String(visualId));
      
      // Store in our tracking object for photo uploads
      this.visualRecordIds[`${category}_${templateId}`] = String(visualId);
      console.log('📌 Visual Record ID stored:', visualId, 'for key:', `${category}_${templateId}`);
      
    } catch (error: any) {
      console.error('⚠️ Error during save (checking if actually failed):', error);
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
            <strong style="color: red;">❌ FAILED TO SAVE VISUAL</strong><br><br>
            
            <strong>Data Sent:</strong><br>
            • ServiceID: ${visualData.ServiceID}<br>
            • Category: ${visualData.Category}<br>
            • Kind: ${visualData.Kind}<br>
            • Name: ${visualData.Name}<br>
            • Text: ${visualData.Text?.substring(0, 50)}...<br>
            • Notes: ${visualData.Notes}<br><br>
            
            <strong>Error Details:</strong><br>
            • Status: ${error?.status || 'No status'}<br>
            • Status Text: ${error?.statusText || 'Unknown'}<br>
            • Message: ${error?.message || 'No message'}<br><br>
            
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
        console.log('✅ Request was successful (status 2xx) - ignoring response parsing error');
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
        console.error('⚠️ 400 Bad Request - Check column names and data types');
        console.error('Expected columns: ServiceID (Integer), Category (Text), Kind (Text), Name (Text), Notes (Text)');
      } else if (!error?.status) {
        console.log('⚠️ No status code - might be a response parsing issue, checking table...');
        // Try to verify if it was actually saved
        setTimeout(async () => {
          const saved = await this.verifyVisualSaved(category, templateId);
          if (saved) {
            console.log('✅ Verified: Visual was actually saved');
            // Success toast removed per user request
          } else {
            console.error('❌ Verified: Visual was NOT saved');
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
        console.log('✅ Visual removed from Services_Visuals');
        localStorage.removeItem(recordKey);
      } catch (error) {
        console.error('❌ Failed to remove visual:', error);
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
      // Yes/No toggle
      inputs.push({
        name: 'description',
        type: 'radio',
        label: 'Yes',
        value: 'Yes',
        checked: item.text === 'Yes'
      });
      inputs.push({
        name: 'description',
        type: 'radio',
        label: 'No',
        value: 'No',
        checked: item.text === 'No'
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
      header: 'View Details' + (item.required ? ' (Required)' : ''),
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
    this.fileInput.nativeElement.click();
  }
  
  // New method to capture photo from camera
  async capturePhotoFromCamera(category: string, itemId: string, item: any) {
    // Not used anymore - we use addAnotherPhoto instead which triggers file input
    // Keeping for backward compatibility
    await this.addAnotherPhoto(category, itemId);
  }
  
  // Multiple photo capture session with proper confirmation
  private async startMultiPhotoCapture(visualId: string, key: string, category: string, itemId: string) {
    const capturedPhotos: File[] = [];
    let keepCapturing = true;
    let photoCounter = 0;
    
    while (keepCapturing) {
      let currentFile: File | null = null;
      let retakePhoto = true;
      
      // Keep retaking until user is satisfied with the photo
      while (retakePhoto) {
        try {
          // Use native Camera API directly
          const photo = await this.cameraService.takePicture();
          
          if (!photo) {
            // User cancelled or error occurred
            await this.showToast('Camera cancelled or failed', 'warning');
            keepCapturing = false;
            retakePhoto = false;
            break;
          }
          
          // Convert base64 to File object
          const fileName = `photo_${Date.now()}.jpg`;
          currentFile = await this.cameraService.base64ToFile(photo.dataUrl || '', fileName);
          
          if (!currentFile) {
            await this.showToast('Failed to process photo', 'danger');
            continue;
          }
          
          // Now we have the photo as a File object, show preview
          
          if (currentFile) {
            // Immediately accept the photo and show options
            photoCounter++;
            capturedPhotos.push(currentFile);
            retakePhoto = false; // Accept photo immediately
            
            // Upload in background
            this.uploadPhotoForVisual(visualId, currentFile, key, true)
              .then(() => {
                console.log(`Photo ${photoCounter} uploaded`);
              })
              .catch(err => {
                this.showToast(`Failed to upload photo ${photoCounter}`, 'danger');
              });
            
            // Ask if user wants to take another photo
            const continueAlert = await this.alertController.create({
              cssClass: 'compact-photo-selector',
              buttons: [
                {
                  text: 'Take Another Photo',
                  cssClass: 'action-button',
                  handler: () => {
                    keepCapturing = true;
                    return true;
                  }
                },
                {
                  text: 'Done',
                  cssClass: 'done-button',
                  handler: () => {
                    keepCapturing = false;
                    return true;
                  }
                }
              ],
              backdropDismiss: false
            });
            
            await continueAlert.present();
            await continueAlert.onDidDismiss();
          } else {
            // User cancelled camera
            await this.showToast('❌ Camera cancelled', 'warning');
            retakePhoto = false;
            keepCapturing = false;
          }
        } catch (error) {
          console.error('❌ Error capturing photo:', error);
          await this.showToast('Failed to capture photo', 'danger');
          retakePhoto = false;
          keepCapturing = false;
        }
      }
    }
    
    // Log capture summary
    console.log(`Photo capture session complete: ${capturedPhotos.length} photo(s)`)
  }
  
  // Camera button handler - allows multiple photo capture
  async takePhotoForVisual(category: string, itemId: string, event?: Event) {
    // Debug alert to confirm button was clicked
    const clickDebug = await this.alertController.create({
      header: '🔍 DEBUG: Camera Button',
      message: `Button clicked for ${category} / ${itemId}`,
      buttons: ['Continue']
    });
    await clickDebug.present();
    await clickDebug.onDidDismiss();
    
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
        header: '⚠️ Visual Not Saved',
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
    
    // Debug before starting multi-photo
    const preStartDebug = await this.alertController.create({
      header: '🎬 Starting Multi-Photo',
      message: `VisualID: ${visualId}\nKey: ${key}\nCategory: ${category}`,
      buttons: ['Start']
    });
    await preStartDebug.present();
    await preStartDebug.onDidDismiss();
    
    // Start multiple photo capture session
    await this.startMultiPhotoCapture(visualId, key, category, itemId);
    return; // Skip the old single-photo logic below
    
    // DETAILED DEBUGGING
    console.log('🔍 DEBUGGING FILE INPUT:');
    console.log('1. this.fileInput exists?', !!this.fileInput);
    console.log('2. this.fileInput object:', this.fileInput);
    
    if (this.fileInput) {
      console.log('3. nativeElement exists?', !!this.fileInput.nativeElement);
      console.log('4. nativeElement:', this.fileInput.nativeElement);
      
      if (this.fileInput.nativeElement) {
        console.log('5. Element type:', this.fileInput.nativeElement.tagName);
        console.log('6. Element id:', this.fileInput.nativeElement.id);
        console.log('7. Element display:', window.getComputedStyle(this.fileInput.nativeElement).display);
        
        // Try to find the element directly in DOM
        const directElement = document.querySelector('input[type="file"]');
        console.log('8. Direct DOM query found:', !!directElement);
        
        if (directElement) {
          console.log('9. Using direct element instead');
          this.currentUploadContext = { visualId, key, category, itemId };
          (directElement as HTMLInputElement).click();
          console.log('10. Clicked direct element');
        } else {
          // Try original way
          this.currentUploadContext = { visualId, key, category, itemId };
          this.fileInput.nativeElement.click();
          console.log('11. Clicked via ViewChild');
        }
      } else {
        console.error('❌ nativeElement is null/undefined');
        await this.showToast('File input not available', 'danger');
      }
    } else {
      console.error('❌ fileInput ViewChild is null/undefined');
      await this.showToast('Camera not initialized', 'danger');
    }
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
      console.log(`📸 ${files.length} file(s) selected`);
      
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
        
        // Track upload results
        let uploadSuccessCount = 0;
        
        // Upload all photos directly without annotation popup
        const uploadPromises = fileArray.map((file, index) => 
          this.uploadPhotoForVisual(visualId, file, key, true)
            .then(() => {
              console.log(`✅ File ${index + 1} uploaded successfully`);
              return { success: true, error: null };
            })
            .catch((error) => {
              console.error(`❌ Failed to upload file ${index + 1}:`, error);
              return { success: false, error };
            })
        );
        
        // Wait for all uploads to complete
        const results = await Promise.all(uploadPromises);
        
        // Count successes and failures
        uploadSuccessCount = results.filter((r: { success: boolean }) => r.success).length;
        const failCount = results.filter((r: { success: boolean }) => !r.success).length;
        
        // Show result message
        if (failCount === 0) {
          // Success toast removed per user request - photos uploaded successfully
        } else if (uploadSuccessCount > 0) {
          await this.showToast(
            `Uploaded ${uploadSuccessCount} of ${files.length} photos. ${failCount} failed.`,
            'warning'
          );
        } else {
          await this.showToast('Failed to upload photos', 'danger');
        }
        
        // Show "Take Another Photo" prompt only if:
        // 1. Single file was uploaded successfully
        // 2. We were expecting a camera photo (user clicked camera button specifically)
        // This avoids showing the prompt for Photo Library selections
        if (files.length === 1 && uploadSuccessCount === 1 && this.expectingCameraPhoto) {
          const continueAlert = await this.alertController.create({
            cssClass: 'compact-photo-selector',
            buttons: [
              {
                text: 'Take Another Photo',
                cssClass: 'action-button',
                handler: async () => {
                  // Continue expecting camera photos
                  this.expectingCameraPhoto = true;
                  this.currentUploadContext = { category, itemId, action: 'add' };
                  this.fileInput.nativeElement.click();
                  return true;
                }
              },
              {
                text: 'Done',
                cssClass: 'done-button',
                handler: () => {
                  this.expectingCameraPhoto = false;
                  return true;
                }
              }
            ],
            backdropDismiss: false
          });
          
          await continueAlert.present();
        }
        
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
      console.error('❌ Error handling files:', error);
      await this.showToast('Failed to upload files', 'danger');
    } finally {
      // Reset file input and camera flag
      if (this.fileInput && this.fileInput.nativeElement) {
        this.fileInput.nativeElement.value = '';
        // Ensure capture attribute is removed for next use
        this.fileInput.nativeElement.removeAttribute('capture');
      }
      this.currentUploadContext = null;
      // Reset camera flag unless user chose "Take Another Photo"
      // (flag is maintained in the handler if user continues)
      if (!this.expectingCameraPhoto) {
        this.expectingCameraPhoto = false;
      }
    }
  }
  
  // DEPRECATED - Keeping for reference
  private async capturePhoto(visualId: string, key: string) {
    try {
      console.log('📸 Opening camera for visual:', visualId);
      
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
        console.log('📸 Photo captured:', file.name);
        await this.uploadPhotoForVisual(visualId, file, key);
      }
    } catch (error) {
      console.error('❌ Error capturing photo:', error);
      await this.showToast('Failed to capture photo', 'danger');
    }
  }
  
  // Select from gallery
  private async selectFromGallery(visualId: string, key: string) {
    try {
      console.log('🖼️ Opening gallery for visual:', visualId);
      
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
        console.log('🖼️ Image selected:', file.name);
        await this.uploadPhotoForVisual(visualId, file, key);
      }
    } catch (error) {
      console.error('❌ Error selecting from gallery:', error);
      await this.showToast('Failed to select image', 'danger');
    }
  }
  
  // Select document
  private async selectDocument(visualId: string, key: string) {
    try {
      console.log('📄 Opening document picker for visual:', visualId);
      
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
        console.log('📄 Document selected:', file.name);
        await this.uploadPhotoForVisual(visualId, file, key);
      }
    } catch (error) {
      console.error('❌ Error selecting document:', error);
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
    return { file: photo, annotationData: null, originalFile: photo };
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
    
    // Use the ID from visualRecordIds to ensure consistency
    const actualVisualId = this.visualRecordIds[key] || visualId;
    
    // INSTANTLY show preview with object URL
    if (actualVisualId && actualVisualId !== 'undefined') {
      if (!this.visualPhotos[actualVisualId]) {
        this.visualPhotos[actualVisualId] = [];
      }
      
      // Create instant preview
      const objectUrl = URL.createObjectURL(photo);
      const tempId = `temp_${Date.now()}_${Math.random()}`;
      const photoData: any = {
        AttachID: tempId,
        id: tempId,
        name: photo.name,
        url: objectUrl,
        thumbnailUrl: objectUrl,
        isObjectUrl: true,
        uploading: true, // Flag to show it's uploading
        hasAnnotations: false,
        annotations: null
      };
      
      // Add immediately for instant feedback
      this.visualPhotos[actualVisualId].push(photoData);
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
          Photo: `[File: ${photo.name}]`
        },
        fileInfo: {
          name: photo.name,
          size: `${(photo.size / 1024).toFixed(2)} KB`,
          type: photo.type || 'unknown'
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
            <strong style="color: red;">🔍 DEBUG INFO:</strong><br>
            • Key: ${dataToSend.debug.key}<br>
            • Raw VisualID param: ${dataToSend.debug.rawVisualId}<br>
            • Stored for this key: ${dataToSend.debug.storedForKey}<br>
            • Using VisualID: <strong style="color: blue;">${dataToSend.debug.actualVisualId}</strong><br>
            • Parsed Number: <strong style="color: blue;">${dataToSend.debug.parsedNumber}</strong><br><br>
            
            <strong>All Stored Visual IDs:</strong><br>
            <div style="max-height: 100px; overflow-y: auto; background: #f0f0f0; padding: 5px;">
              ${dataToSend.debug.allStoredIds || 'None'}
            </div><br>
            
            <strong>Table:</strong> ${dataToSend.table}<br><br>
            
            <strong>Fields to Send:</strong><br>
            • VisualID: <strong style="color: red;">${dataToSend.fields.VisualID}</strong> (Integer)<br>
            • Annotation: "${dataToSend.fields.Annotation}" (Text)<br>
            • Photo: Will store file path after upload<br><br>
            
            <strong>File Info:</strong><br>
            • Name: ${dataToSend.fileInfo.name}<br>
            • Size: ${dataToSend.fileInfo.size}<br>
            • Type: ${dataToSend.fileInfo.type}<br><br>
            
            <strong>Upload Process:</strong><br>
            ${dataToSend.process.map(step => `• ${step}`).join('<br>')}
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
              await this.performVisualPhotoUpload(visualIdNum, photo, key, false, annotationData, originalPhoto);
            }
          }
        ]
      });
      
        await alert.present();
      } else {
        // For batch uploads, proceed directly without popup
        await this.performVisualPhotoUpload(visualIdNum, photo, key, true, annotationData, originalPhoto);
      }
      
    } catch (error) {
      console.error('❌ Failed to prepare upload:', error);
      await this.showToast('Failed to prepare photo upload', 'danger');
    }
  }
  
  // Separate method to perform the actual upload
  private async performVisualPhotoUpload(visualIdNum: number, photo: File, key: string, isBatchUpload: boolean = false, annotationData: any = null, originalPhoto: File | null = null) {
    try {
      // Prepare the Drawings field data (annotation JSON)
      const drawingsData = annotationData ? JSON.stringify(annotationData) : '';
      
      // CRITICAL DEBUG: Log what we're actually uploading
      console.log('🔍 CRITICAL: Photo upload parameters:');
      console.log('  originalPhoto exists:', !!originalPhoto);
      console.log('  originalPhoto name:', originalPhoto?.name || 'N/A');
      console.log('  photo name:', photo.name);
      console.log('  has annotationData:', !!annotationData);
      console.log('  UPLOADING:', originalPhoto ? originalPhoto.name : photo.name);
      
      // Using EXACT same approach as working Required Documents upload
      const response = await this.caspioService.createServicesVisualsAttachWithFile(
        visualIdNum, 
        '', // Annotation field stays blank
        originalPhoto || photo,  // Upload ORIGINAL if available
        drawingsData, // Pass the annotation JSON to Drawings field
        undefined // No longer needed
      ).toPromise();
      
      console.log('✅ Photo uploaded successfully:', response);
      
      // Update the temporary photo with real data
      const actualVisualId = String(this.visualRecordIds[key]);
      
      if (actualVisualId && actualVisualId !== 'undefined' && this.visualPhotos[actualVisualId]) {
        // Find the temp photo and update it with real data
        const photos = this.visualPhotos[actualVisualId];
        const tempPhotoIndex = photos.findIndex((p: any) => p.uploading === true && p.name === photo.name);
        
        if (tempPhotoIndex !== -1) {
          // Update the temp photo with real data
          photos[tempPhotoIndex] = {
            ...photos[tempPhotoIndex],
            AttachID: response?.AttachID || response?.PK_ID || response?.id,
            id: response?.AttachID || response?.PK_ID || response?.id,
            Photo: response?.Photo || '',
            filePath: response?.Photo || '',
            uploading: false // Remove uploading flag
            // Keep the object URL for preview
          };
        }
      }
      
      // No need to restore states - the UI should remain unchanged
      
    } catch (error) {
      console.error('❌ Failed to upload photo:', error);
      
      // Remove the failed temp photo from display
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
    const visualId = String(this.visualRecordIds[key]); // Ensure string
    const photos = visualId && visualId !== 'undefined' && this.visualPhotos[visualId] ? this.visualPhotos[visualId] : [];
    
    // Removed console logging for performance
    
    return photos;
  }
  
  // Handle image loading errors
  handleImageError(event: any, photo: any) {
    console.log('⚠️ [v1.4.303] Image failed to load:', {
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
      console.log('🔄 [v1.4.303] Attempting to use original base64 URL');
      const target = event.target as HTMLImageElement;
      target.src = photo.url;
      return;
    }
    
    // Otherwise use SVG fallback
    console.log('🎨 [v1.4.303] Using SVG fallback');
    const target = event.target as HTMLImageElement;
    target.src = 'data:image/svg+xml;base64,' + btoa(`
      <svg width="150" height="100" xmlns="http://www.w3.org/2000/svg">
        <rect width="150" height="100" fill="#f0f0f0"/>
        <text x="75" y="45" text-anchor="middle" fill="#999" font-family="Arial" font-size="14">📷</text>
        <text x="75" y="65" text-anchor="middle" fill="#999" font-family="Arial" font-size="11">Photo</text>
      </svg>
    `);
  }
  
  // Add custom visual comment
  async addCustomVisual(category: string, kind: string) {
    const alert = await this.alertController.create({
      header: `Add ${kind}`,
      inputs: [
        {
          name: 'name',
          type: 'text',
          placeholder: 'Enter title/name',
          attributes: {
            required: true
          }
        },
        {
          name: 'description',
          type: 'textarea',
          placeholder: 'Enter description (optional)',
          attributes: {
            rows: 4
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
            if (!data.name || !data.name.trim()) {
              await this.showToast('Please enter a name', 'warning');
              return false;
            }
            
            // Create the visual without photos initially
            await this.createCustomVisualWithPhotos(category, kind, data.name, data.description || '', null);
            
            return true;
          }
        }
      ]
    });
    
    await alert.present();
  }
  
  // Create custom visual with photos
  async createCustomVisualWithPhotos(category: string, kind: string, name: string, text: string, files: FileList | null) {
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
        // Create the visual record
        const response = await this.caspioService.createServicesVisual(visualData).toPromise();
        console.log('✅ Custom visual created:', response);
        
        // Use VisualID from response
        const visualId = response?.VisualID || response?.PK_ID;
        if (!visualId) {
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
        
      } catch (error) {
        console.error('Error creating custom visual:', error);
        await loading.dismiss();
        await this.showToast('Failed to add visual', 'danger');
      }
    } catch (error) {
      console.error('Error in createCustomVisualWithPhotos:', error);
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
        console.log('✅ Custom visual created:', response);
        
        // Show debug popup with the response
        const debugAlert = await this.alertController.create({
          header: 'Custom Visual Creation Response',
          message: `
            <div style="text-align: left; font-family: monospace; font-size: 12px;">
              <strong style="color: green;">✅ VISUAL CREATED SUCCESSFULLY</strong><br><br>
              
              <strong>Response from Caspio:</strong><br>
              <div style="background: #f0f0f0; padding: 10px; border-radius: 5px; max-height: 200px; overflow-y: auto;">
                ${JSON.stringify(response, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
              </div><br>
              
              <strong style="color: blue;">Key Fields:</strong><br>
              • VisualID (PRIMARY): <strong style="color: green;">${response?.VisualID || 'NOT FOUND'}</strong><br>
              • PK_ID: ${response?.PK_ID || 'N/A'}<br>
              • ServiceID: ${response?.ServiceID || 'N/A'}<br>
              • Category: ${response?.Category || 'N/A'}<br>
              • Kind: ${response?.Kind || 'N/A'}<br>
              • Name: ${response?.Name || 'N/A'}<br><br>
              
              <strong>Will be stored as:</strong><br>
              • Key: ${category}_${response?.VisualID || response?.PK_ID || Date.now()}<br>
              • VisualID for photos: <strong style="color: green;">${response?.VisualID || response?.PK_ID || 'MISSING!'}</strong>
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
        console.log('📌 Stored VisualID for photos:', {
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
  async updatePhotoAttachment(attachId: string, file: File, annotations?: any, originalFile?: File): Promise<void> {
    try {
      console.log('🔍 updatePhotoAttachment called with:');
      console.log('  attachId:', attachId);
      console.log('  attachId type:', typeof attachId);
      console.log('  file:', file.name);
      console.log('  annotations:', annotations);
      console.log('  has originalFile:', !!originalFile);
      
      // Update annotations without debug popups
      
      // IMPORTANT: We do NOT upload the annotated file anymore!
      // We only save the annotation JSON data to the Drawings field
      // The Photo field must remain pointing to the original image
      
      // Update the attachment record - ONLY update Drawings field, NOT Photo field
      const updateData: any = {};
      
      // Add annotations to Drawings field if provided
      if (annotations) {
        // Prepare the drawings data with annotations
        let drawingsObj = annotations;
        
        // If annotations is already a string, parse it
        if (typeof annotations === 'string') {
          try {
            drawingsObj = JSON.parse(annotations);
          } catch (e) {
            drawingsObj = { annotations: annotations };
          }
        }
        
        // Store ONLY the annotation data in Drawings field
        // Do NOT include any file paths since we're not uploading files
        updateData.Drawings = JSON.stringify(drawingsObj);
        console.log('📝 Storing ONLY annotations in Drawings field (NO file uploads):', updateData.Drawings);
      }
      
      // Send update request without debug popup
      
      const updateResult = await this.caspioService.updateServiceVisualsAttach(attachId, updateData).toPromise();
      
      console.log('✅ Photo attachment updated successfully');
    } catch (error: any) {
      console.error('❌ Failed to update photo attachment:', error);
      
      // Log error without debug popup
      
      throw error;
    }
  }
  
  // Quick annotate - open annotator directly
  async quickAnnotate(photo: any, category: string, itemId: string) {
    try {
      const imageUrl = photo.url || photo.thumbnailUrl || 'assets/img/photo-placeholder.png';
      const photoName = photo.name || 'Photo';
      
      // Parse existing annotations if available
      let existingAnnotations = [];
      if (photo.annotations) {
        try {
          existingAnnotations = typeof photo.annotations === 'string' 
            ? JSON.parse(photo.annotations) 
            : photo.annotations;
        } catch (e) {
          console.log('Failed to parse annotations:', e);
        }
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
              // Get the original file if provided
              let originalFile = null;
              if (data.originalBlob) {
                originalFile = data.originalBlob instanceof File 
                  ? data.originalBlob 
                  : new File([data.originalBlob], `original_${photoName}`, { type: 'image/jpeg' });
              }
              
              // Update the existing attachment with annotations
              await this.updatePhotoAttachment(photo.AttachID || photo.id, annotatedFile, annotationsData, originalFile);
            
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
                // Store annotations in the photo object
                if (annotationsData) {
                  this.visualPhotos[visualId][photoIndex].annotations = annotationsData;
                }
              }
              
              // Trigger change detection
              this.changeDetectorRef.detectChanges();
              
              await this.showToast('Annotations saved', 'success');
            } catch (error) {
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
      console.log('👁️ Viewing photo:', photo);
      
      const imageUrl = photo.url || photo.thumbnailUrl || 'assets/img/photo-placeholder.png';
      const photoName = photo.name || 'Photo';
      const key = `${category}_${itemId}`;
      const visualId = this.visualRecordIds[key];
      
      // CRITICAL FIX: Always pass the ORIGINAL URL to the viewer
      // Use originalUrl if available (from previous annotation), otherwise use url
      const originalImageUrl = photo.originalUrl || photo.url || imageUrl;
      
      // ENHANCED: Open annotation window directly instead of photo viewer
      const modal = await this.modalController.create({
        component: FabricPhotoAnnotatorComponent,
        componentProps: {
          imageUrl: originalImageUrl,  // Always use original, not display URL
          existingAnnotations: photo.annotations || photo.annotationsData,  // Pass existing annotations
          photoData: photo,
          isReEdit: !!photo.originalUrl  // Flag to indicate we're re-editing
        },
        cssClass: 'fullscreen-modal'
      });
      
      await modal.present();
      
      // Handle annotated photo returned from annotator
      const { data } = await modal.onDidDismiss();
      
      if (data && data.annotatedBlob) {
        // Update the existing photo instead of creating new
        const annotatedFile = new File([data.annotatedBlob], photoName, { type: 'image/jpeg' });
        const annotationsData = data.annotationData || data.annotationsData;
        
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
            await this.updatePhotoAttachment(photo.AttachID || photo.id, annotatedFile, annotationsData, originalFile);
            
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
              
              // Keep the original URL intact in the url field
              // DO NOT change this.visualPhotos[visualId][photoIndex].url!
              
              // Store annotations in the photo object
              if (annotationsData) {
                this.visualPhotos[visualId][photoIndex].annotations = annotationsData;
              }
              
              console.log(`📸 [v1.4.303] Photo URLs after annotation:`);
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
                  await this.caspioService.deleteServiceVisualsAttach(attachId).toPromise();
                  
                  // Remove from local array
                  const visualId = this.visualRecordIds[`${category}_${itemId}`];
                  if (visualId && this.visualPhotos[visualId]) {
                    this.visualPhotos[visualId] = this.visualPhotos[visualId].filter(
                      (p: any) => (p.AttachID || p.id) !== attachId
                    );
                  }
                  
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
    // Skip custom action sheet and go directly to native file input
    // This will show the native iOS popup with Photo Library, Take Photo, Choose File
    this.currentUploadContext = { 
      category, 
      itemId,
      action: 'add'
    };
    
    // Set flag if we're expecting a camera photo
    // Note: We can't force camera on iOS file input, but we can track the intent
    this.expectingCameraPhoto = forceCamera;
    
    // Ensure the file input has proper attributes but don't force camera-only
    if (this.fileInput && this.fileInput.nativeElement) {
      const input = this.fileInput.nativeElement;
      // Don't set capture attribute - this ensures iOS shows all options
      // (Photo Library, Take Photo, Choose File)
      input.removeAttribute('capture'); 
      input.setAttribute('accept', 'image/*');
    }
    
    this.fileInput.nativeElement.click();
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
      const visuals = await this.caspioService.getServicesVisualsByServiceId(this.serviceId).toPromise();
      
      if (visuals && Array.isArray(visuals)) {
        const templateName = this.categoryData[category]?.[templateId]?.name;
        const found = visuals.some(v => 
          v.Category === category && 
          v.Name === templateName
        );
        
        if (found) {
          console.log('✅ Visual found in table - it was saved!');
          // Also refresh the ID
          await this.refreshVisualId(category, templateId);
          return true;
        }
      }
      console.log('❌ Visual not found in table');
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
      const visuals = await this.caspioService.getServicesVisualsByServiceId(this.serviceId).toPromise();
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
          <strong style="color: red;">🔍 VISUAL CREATION RESPONSE:</strong><br><br>
          
          <strong>Key:</strong> ${key}<br>
          <strong>Category:</strong> ${category}<br>
          <strong>Template ID:</strong> ${templateId}<br><br>
          
          <strong>Response Type:</strong> ${responseType}<br>
          <strong>Raw Response:</strong><br>
          <div style="background: #f0f0f0; padding: 5px; max-height: 150px; overflow-y: auto;">
            ${JSON.stringify(response, null, 2)}
          </div><br>
          
          <strong style="color: red;">⚠️ ID FIELDS FROM RESPONSE:</strong><br>
          • <strong>VisualID:</strong> ${visualIdFromResponse} <span style="color: green;">(✓ CORRECT - USE THIS)</span><br>
          • <strong>PK_ID:</strong> ${pkId} <span style="color: red;">(✗ WRONG - DO NOT USE)</span><br><br>
          
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
      console.log('🔄 Refreshing Visual ID for:', category, templateId);
      const visuals = await this.caspioService.getServicesVisualsByServiceId(this.serviceId).toPromise();
      
      console.log('📋 Retrieved visuals from database:', visuals);
      
      if (visuals && Array.isArray(visuals)) {
        // Find the visual we just created
        const templateName = this.categoryData[category]?.[templateId]?.name;
        console.log('🔍 Looking for visual with Category:', category, 'and Name:', templateName);
        
        const ourVisual = visuals.find(v => 
          v.Category === category && 
          v.Name === templateName
        );
        
        if (ourVisual) {
          console.log('✅ Found our visual:', ourVisual);
          const visualId = ourVisual.VisualID || ourVisual.PK_ID || ourVisual.id;
          const recordKey = `visual_${category}_${templateId}`;
          localStorage.setItem(recordKey, String(visualId));
          this.visualRecordIds[`${category}_${templateId}`] = String(visualId);
          console.log('✅ Visual ID refreshed:', visualId, 'for key:', `${category}_${templateId}`);
        } else {
          console.log('⚠️ Could not find visual with Category:', category, 'and Name:', templateName);
          console.log('Available visuals:', visuals.map(v => ({ Category: v.Category, Name: v.Name, ID: v.VisualID || v.PK_ID })));
        }
      }
    } catch (error) {
      console.error('Failed to refresh visual ID:', error);
    }
  }
  
  // Load existing photos for visuals
  async loadExistingPhotos() {
    console.log('🔄 Loading existing photos for all visuals...');
    console.log('Visual IDs to load:', this.visualRecordIds);
    console.log('Current visualPhotos state:', this.visualPhotos);
    
    for (const key in this.visualRecordIds) {
      const rawVisualId = this.visualRecordIds[key];
      const visualId = String(rawVisualId); // Ensure string consistency
      if (visualId && visualId !== 'undefined' && !visualId.startsWith('temp_')) {
        try {
          console.log(`📥 Fetching photos for visual ${visualId} (${key})`);
          const photos = await this.caspioService.getServiceVisualsAttachByVisualId(rawVisualId).toPromise();
          console.log(`Found ${photos?.length || 0} photos for visual ${visualId}:`, photos);
          
          if (photos && photos.length > 0) {
            // Process photos to add preview URLs
            const processedPhotos = await Promise.all(photos.map(async (photo: any) => {
              console.log('Processing photo:', photo);
              
              // Parse the Drawings field for annotation data (where annotations are stored)
              let annotationData = null;
              if (photo.Drawings) {
                try {
                  annotationData = typeof photo.Drawings === 'string' ? JSON.parse(photo.Drawings) : photo.Drawings;
                  console.log('📝 Parsed annotation data from Drawings field');
                } catch (e) {
                  console.log('⚠️ Could not parse Drawings field:', e);
                }
              }
              
              // Initialize photoData with undefined URLs (not empty strings)
              const photoData: any = {
                ...photo,
                name: photo.Photo || 'Photo',
                Photo: photo.Photo || '', // Keep the original Photo path
                caption: photo.Annotation || '',  // Caption from Annotation field
                annotations: annotationData,  // CRITICAL: Load from Drawings field, not Annotation
                annotationsData: annotationData,  // Also store with 's' for compatibility
                hasAnnotations: !!annotationData,
                // CRITICAL: Set to undefined, not empty string, so template can fall back properly
                url: undefined,
                thumbnailUrl: undefined,
                displayUrl: undefined
              };
              
              // If we have a Photo field with a file path, try to fetch it
              if (photo.Photo && typeof photo.Photo === 'string') {
                photoData.filePath = photo.Photo;
                photoData.hasPhoto = true;
                
                try {
                  console.log(`🖼️ [v1.4.303] Fetching image from Files API for: ${photo.Photo}`);
                  const imageData = await this.caspioService.getImageFromFilesAPI(photo.Photo).toPromise();
                  
                  if (imageData && typeof imageData === 'string' && imageData.startsWith('data:')) {
                    console.log('✅ [v1.4.303] Image data received, valid base64');
                    // Set both url and thumbnailUrl to the base64 data
                    photoData.url = imageData;
                    photoData.thumbnailUrl = imageData;
                    // Don't set displayUrl - let it remain undefined
                  } else if (imageData) {
                    console.log('⚠️ [v1.4.303] Image data received but not base64:', typeof imageData, imageData?.substring?.(0, 50));
                    // Try to handle other data formats
                    if (typeof imageData === 'object' && (imageData as any).data) {
                      // Handle potential object response
                      photoData.url = (imageData as any).data;
                      photoData.thumbnailUrl = (imageData as any).data;
                    } else {
                      // Use fallback
                      console.log('⚠️ [v1.4.303] Using SVG fallback due to invalid format');
                      photoData.url = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#e0e0e0"/><text x="75" y="50" text-anchor="middle" fill="#666" font-size="14">📷 Photo</text></svg>');
                      photoData.thumbnailUrl = photoData.url;
                    }
                  } else {
                    console.log('⚠️ [v1.4.303] No image data returned, using fallback');
                    // Use a simple base64 encoded SVG as fallback
                    photoData.url = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#e0e0e0"/><text x="75" y="50" text-anchor="middle" fill="#666" font-size="14">📷 Photo</text></svg>');
                    photoData.thumbnailUrl = photoData.url;
                  }
                } catch (err) {
                  console.error('❌ [v1.4.303] Error fetching image:', err);
                  // Use simple SVG fallback
                  photoData.url = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#e0e0e0"/><text x="75" y="50" text-anchor="middle" fill="#666" font-size="14">📷 Photo</text></svg>');
                  photoData.thumbnailUrl = photoData.url;
                }
              } else {
                console.log('⚠️ [v1.4.303] No Photo field or not a string:', photo.Photo);
                // No photo exists - keep URLs as undefined
                photoData.hasPhoto = false;
              }
              
              console.log('[v1.4.303] Photo data processed:', {
                name: photoData.name,
                hasUrl: !!photoData.url,
                hasAnnotations: photoData.hasAnnotations,
                filePath: photoData.filePath
              });
              
              // If we have annotations, we could recreate the annotated preview here
              // But for now, we'll just use the original image and let the user see
              // the annotations indicator to know they can click to edit
              
              return photoData;
            }));
            
            // Store photos using the same ID format - ensure string consistency
            this.visualPhotos[visualId] = processedPhotos;
            console.log(`📸 Loaded ${processedPhotos.length} photos for visual ${visualId}, stored in visualPhotos`);
            console.log(`Photos stored at visualPhotos[${visualId}]:`, {
              visualId,
              visualIdType: typeof visualId,
              photos: processedPhotos,
              keyForThisVisual: key
            });
          } else {
            console.log(`No photos found for visual ${visualId}`);
          }
        } catch (error) {
          console.error(`Failed to load photos for visual ${visualId}:`, error);
        }
      }
    }
    
    // Log final state (reduced logging)
    console.log('Photos loaded for', Object.keys(this.visualPhotos).filter(k => this.visualPhotos[k]?.length > 0).length, 'visuals');
  }
  
  // Create a placeholder image
  private createPlaceholderImage(): string {
    const canvas = document.createElement('canvas');
    canvas.width = 150; // Match new preview size
    canvas.height = 100; // Match new preview size
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, 150, 100);
      ctx.fillStyle = '#999';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Photo', 75, 45);
      ctx.fillText('Loading...', 75, 60);
    }
    return canvas.toDataURL();
  }
  
  // Create a generic photo placeholder (for existing photos)
  private createGenericPhotoPlaceholder(): string {
    const canvas = document.createElement('canvas');
    canvas.width = 150;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Light blue background
      ctx.fillStyle = '#e3f2fd';
      ctx.fillRect(0, 0, 150, 100);
      
      // Draw a simple camera icon
      ctx.fillStyle = '#1976d2';
      // Camera body
      ctx.fillRect(55, 40, 40, 30);
      // Camera lens
      ctx.beginPath();
      ctx.arc(75, 55, 8, 0, 2 * Math.PI);
      ctx.fill();
      // Flash
      ctx.fillRect(65, 35, 20, 5);
      
      // Text
      ctx.fillStyle = '#666';
      ctx.font = '11px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Click to view', 75, 85);
    }
    return canvas.toDataURL();
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
    
    this.showSaveStatus(`Saving ${fieldName}...`, 'info');
    
    // Update the Projects table directly
    this.caspioService.updateProject(this.projectId, { [fieldName]: value }).subscribe({
      next: () => {
        this.showSaveStatus(`${fieldName} saved`, 'success');
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
      console.error(`⚠️ Cannot save ${fieldName} - No ServiceID! ServiceID is: ${this.serviceId}`);
      return;
    }
    
    console.log(`🔍 Services Table Update:`, {
      serviceId: this.serviceId,
      field: fieldName,
      newValue: value,
      updateData: { [fieldName]: value }
    });
    
    this.showSaveStatus(`Saving ${fieldName}...`, 'info');
    
    // Update the Services table directly
    this.caspioService.updateService(this.serviceId, { [fieldName]: value }).subscribe({
      next: (response) => {
        this.showSaveStatus(`${fieldName} saved`, 'success');
        console.log(`✅ SUCCESS: ${fieldName} updated!`, response);
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
            
            photoFetches.push(this.getVisualPhotos(actualVisualId));
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
            
            photoFetches.push(this.getVisualPhotos(actualVisualId));
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
            
            photoFetches.push(this.getVisualPhotos(actualVisualId));
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
        notes: roomData.notes,
        points: [],
        photos: []
      };
      
      // Fetch actual points from Services_Rooms_Points table
      if (roomId) {
        console.log(`Fetching points for room ${roomName} (RoomID: ${roomId})`);
        
        try {
          // Get all points for this room from the database
          const dbPoints = await this.caspioService.getServicesRoomsPoints(roomId).toPromise();
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
                this.caspioService.getServicesRoomsAttachments(pointId).toPromise()
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
    return result;
  }

  async getVisualPhotos(visualId: string) {
    // Get photos for a specific visual from Services_Visuals_Attach
    const photos = this.visualPhotos[visualId] || [];
    
    console.log(`📸 Getting photos for visual ${visualId}:`, photos.length);
    
    // Use the cache service for better performance across sessions
    const cacheKey = this.cache.getApiCacheKey('visual_photos', { visualId });
    const cachedPhotos = this.cache.get(cacheKey);
    if (cachedPhotos) {
      console.log(`✅ Using cached photos for visual ${visualId}`);
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
              console.log(`✅ Photo converted and cached for visual ${visualId}`);
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
      console.log(`📸 Fetching photos for room ${roomId}`);
      
      // First get all points for this room
      const points = await this.caspioService.getServicesRoomsPoints(roomId).toPromise();
      
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
      const attachments = await this.caspioService.getServicesRoomsAttachments(pointIds).toPromise();
      
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
              console.log(`✅ Room photo converted to base64`);
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
        
        processedPhotos.push({
          url: finalUrl,
          caption: attach.Annotation || (point ? `${point.PointName}: ${point.PointValue}` : ''),
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
      console.log('📊 Fetching all visuals from database for ServiceID:', this.serviceId);
      
      // Fetch all Services_Visuals records for this service
      const visuals = await this.caspioService.getServicesVisualsByServiceId(this.serviceId).toPromise();
      
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
          this.caspioService.getServiceVisualsAttachByVisualId(visual.VisualID).toPromise()
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
                console.log(`📝 Loaded annotation data for AttachID ${att.AttachID}:`, annotationData);
              } catch (e) {
                console.log(`⚠️ Could not parse Drawings field for AttachID ${att.AttachID}`);
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
      
      console.log('✅ Database fetch complete. Visual photos:', this.visualPhotos);
    } catch (error) {
      console.error('❌ Error fetching visuals from database:', error);
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
