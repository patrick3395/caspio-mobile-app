import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, Router } from '@angular/router';
import { CaspioService } from '../../services/caspio.service';
import { ToastController, LoadingController, AlertController, ActionSheetController, ModalController, Platform } from '@ionic/angular';
import { CameraService } from '../../services/camera.service';
import { PhotoViewerComponent } from '../../components/photo-viewer/photo-viewer.component';
import { PhotoAnnotatorComponent } from '../../components/photo-annotator/photo-annotator.component';
import { PdfPreviewComponent } from '../../components/pdf-preview/pdf-preview.component';
import jsPDF from 'jspdf';


interface ServicesVisualRecord {
  ServiceID: number;  // Changed to number to match Integer type in Caspio
  Category: string;
  Kind: string;  // Changed from Type to Kind
  Name: string;
  Text: string;  // The full text content
  Notes: string;  // Made required, will send empty string if not provided
}

@Component({
  selector: 'app-engineers-foundation',
  templateUrl: './engineers-foundation.page.html',
  styleUrls: ['./engineers-foundation.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule]
})
export class EngineersFoundationPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  
  projectId: string = '';
  serviceId: string = '';
  projectData: any = null;
  serviceData: any = {}; // Store Services table data
  currentUploadContext: any = null;
  currentRoomPointContext: any = null;  // For room photo uploads
  uploadingPhotos: { [key: string]: number } = {}; // Track uploads per visual
  
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
  
  // Form data for the template
  formData: any = {
    // Additional fields to be added based on requirements
  };
  
  // Room templates for elevation plot
  roomTemplates: any[] = [];
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
    private platform: Platform
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
        this.loadServicesDropdownOptions()
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
    
    // Dismiss any loading indicators from navigation
    try {
      const topLoader = await this.loadingController.getTop();
      if (topLoader) {
        await topLoader.dismiss();
      }
    } catch (error) {
      // Ignore errors if no loading to dismiss
    }
    
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
    } catch (error) {
      console.error('Error loading project data:', error);
      await this.showToast('Failed to load project data', 'danger');
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
            const elevationPoint = this.roomElevationData[roomName].elevationPoints.find(
              (p: any) => p.name === point.PointName
            );
            
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
      const file = this.cameraService.base64ToFile(photo.dataUrl, fileName);
      
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
      
      // If only one photo, show dialog immediately while upload happens in background
      if (files.length === 1) {
        // Show dialog immediately, don't wait for upload
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
                  // Use camera service directly like Structural section
                  setTimeout(async () => {
                    await this.captureAnotherRoomPhoto(roomName, point, pointId);
                  }, 100);
                  return true;
                }
              }
            ]
          });
          
          await continueAlert.present();
      } else {
        // For multiple files, wait for uploads to complete
        await Promise.all(uploadPromises);
        
        if (uploadSuccessCount === 0) {
          await this.showToast('Failed to upload photos', 'danger');
        }
      }
      
      // Handle remaining uploads in background if single file
      if (files.length === 1) {
        Promise.all(uploadPromises).then(() => {
          console.log('Background upload complete');
        }).catch(err => {
          console.error('Background upload error:', err);
        });
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
      
      // Generate filename
      const timestamp = new Date().getTime();
      const fileName = `room_point_${pointId}_${timestamp}.jpg`;
      
      // Upload to Caspio Files API
      const formData = new FormData();
      formData.append('file', blob, fileName);
      
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
      
      // Directly proceed with upload and return the response
      const response = await this.performRoomPointPhotoUpload(pointIdNum, file, pointName);
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
          const templateData = {
            id: template.PK_ID,
            name: template.Name,
            text: template.Text || '',
            kind: template.Kind, // Changed from Type to Kind
            category: template.Category
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
    // Use requestAnimationFrame for smooth animation
    requestAnimationFrame(() => {
      this.expandedSections[section] = !this.expandedSections[section];
    });
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
    
    const loading = await this.loadingController.create({
      message: 'Loading inspection data from database...',
      spinner: 'crescent'
    });
    await loading.present();

    try {
      // Fetch all visual records and attachments from the database
      await this.fetchAllVisualsFromDatabase();
      
      // Prepare data for the preview
      const structuralSystemsData = await this.prepareStructuralSystemsData();
      const elevationPlotData = await this.prepareElevationPlotData();
      const projectInfo = await this.prepareProjectInfo();
      
      await loading.dismiss();
      
      // Open the preview modal
      const modal = await this.modalController.create({
        component: PdfPreviewComponent,
        componentProps: {
          projectData: projectInfo,
          structuralData: structuralSystemsData,
          elevationData: elevationPlotData,
          serviceData: this.serviceData
        },
        cssClass: 'fullscreen-modal'
      });
      
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
    // Calculate project details completion percentage
    const requiredFields = ['foundationType', 'foundationCondition'];
    let completed = 0;
    
    requiredFields.forEach(field => {
      if (this.formData[field] && this.formData[field] !== '') {
        completed++;
      }
    });
    
    return Math.round((completed / requiredFields.length) * 100);
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
  
  // Save visual selection to Services_Visuals table
  async saveVisualSelection(category: string, templateId: string) {
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
    
    // ONLY include the columns that exist in Services_Visuals table
    const visualData: ServicesVisualRecord = {
      ServiceID: serviceIdNum,  // Integer type in Caspio
      Category: category || '',   // Text(255) in Caspio
      Kind: template.Kind || '',  // Text(255) in Caspio - was Type, now Kind
      Name: template.Name || '',  // Text(255) in Caspio
      Text: template.Text || '',   // Text field in Caspio - the full text content
      Notes: ''                    // Text(255) in Caspio - empty for now
    };
    
    console.log('📤 DATA BEING SENT TO SERVICES_VISUALS TABLE:');
    console.log('=====================================');
    console.log('COLUMN MAPPING TO SERVICES_VISUALS TABLE:');
    console.log('   ServiceID (Integer):', visualData.ServiceID, typeof visualData.ServiceID);
    console.log('   Category (Text 255):', visualData.Category);
    console.log('   Kind (Text 255):', visualData.Kind);
    console.log('   Name (Text 255):', visualData.Name);
    console.log('   Text (Text field):', visualData.Text);
    console.log('   Notes (Text 255):', visualData.Notes);
    console.log('=====================================');
    console.log('📦 Full visualData object being sent:', JSON.stringify(visualData, null, 2));
    console.log('📌 Template info for reference (not sent):', {
      TemplateID: templateId,
      Text: template.Text
    });
    
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
  
  // Remove visual selection from Services_Visuals table
  async removeVisualSelection(category: string, templateId: string) {
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
  isItemSelected(category: string, itemId: string): boolean {
    return this.selectedItems[`${category}_${itemId}`] || false;
  }

  // Helper methods for PDF generation - check selection by visual ID
  isCommentSelected(category: string, visualId: string): boolean {
    // Check if this comment visual is selected using the same format as toggleItemSelection
    const key = `${category}_${visualId}`;
    return this.selectedItems[key] || false;
  }

  isLimitationSelected(category: string, visualId: string): boolean {
    // Check if this limitation visual is selected using the same format as toggleItemSelection
    const key = `${category}_${visualId}`;
    return this.selectedItems[key] || false;
  }

  isDeficiencySelected(category: string, visualId: string): boolean {
    // Check if this deficiency visual is selected using the same format as toggleItemSelection
    const key = `${category}_${visualId}`;
    return this.selectedItems[key] || false;
  }

  // Get photo count for a visual ID
  getVisualPhotoCount(visualId: string): number {
    // Find photos associated with this visual ID
    const photos = this.visualPhotos[visualId] || [];
    return photos.length;
  }
  
  // Check if item is being saved
  isItemSaving(category: string, itemId: string): boolean {
    return this.savingItems[`${category}_${itemId}`] || false;
  }
  
  // Show full text in sleek editor modal
  async showFullText(item: any) {
    const alert = await this.alertController.create({
      header: 'View Details',
      cssClass: 'text-editor-modal',
      inputs: [
        {
          name: 'title',
          type: 'text',
          placeholder: 'Title',
          value: item.name || '',
          cssClass: 'editor-title-input'
        },
        {
          name: 'description',
          type: 'textarea',
          placeholder: 'Description',
          value: item.text || '',
          cssClass: 'editor-text-input',
          attributes: {
            rows: 8
          }
        }
      ],
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
          currentFile = this.cameraService.base64ToFile(photo.dataUrl || '', fileName);
          
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
        
        // If only one photo was uploaded (likely from Take Photo), offer to take more
        if (files.length === 1 && uploadSuccessCount === 1) {
          // Trigger the multi-photo capture loop immediately
            const continueAlert = await this.alertController.create({
              cssClass: 'compact-photo-selector',
              buttons: [
                {
                  text: 'Take Another Photo',
                  cssClass: 'action-button',
                  handler: async () => {
                    // Start multi-photo capture
                    await this.startMultiPhotoCapture(visualId, key, category, itemId);
                    return true;
                  }
                },
                {
                  text: 'Done',
                  cssClass: 'done-button',
                  handler: () => {
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
      // Reset file input
      if (this.fileInput && this.fileInput.nativeElement) {
        this.fileInput.nativeElement.value = '';
      }
      this.currentUploadContext = null;
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
  
  // Annotate photo before upload
  async annotatePhoto(photo: File): Promise<File> {
    const modal = await this.modalController.create({
      component: PhotoAnnotatorComponent,
      componentProps: {
        imageFile: photo
      },
      cssClass: 'fullscreen-modal'
    });
    
    await modal.present();
    const { data } = await modal.onDidDismiss();
    
    if (data && data instanceof Blob) {
      // Convert blob to File with same name
      return new File([data], photo.name, { type: 'image/jpeg' });
    }
    
    // Return original photo if annotation was cancelled
    return photo;
  }
  
  // Upload photo to Service_Visuals_Attach - EXACT same approach as working Attach table
  async uploadPhotoForVisual(visualId: string, photo: File, key: string, isBatchUpload: boolean = false) {
    // Extract category from key (format: category_itemId)
    const category = key.split('_')[0];
    
    // Ensure the accordion for this category stays expanded
    if (!this.expandedAccordions.includes(category)) {
      this.expandedAccordions.push(category);
      if (this.visualAccordionGroup) {
        this.visualAccordionGroup.value = this.expandedAccordions;
      }
    }
    
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
        uploading: true // Flag to show it's uploading
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
              await this.performVisualPhotoUpload(visualIdNum, photo, key, false);
            }
          }
        ]
      });
      
        await alert.present();
      } else {
        // For batch uploads, proceed directly without popup
        await this.performVisualPhotoUpload(visualIdNum, photo, key, true);
      }
      
    } catch (error) {
      console.error('❌ Failed to prepare upload:', error);
      await this.showToast('Failed to prepare photo upload', 'danger');
    }
  }
  
  // Separate method to perform the actual upload
  private async performVisualPhotoUpload(visualIdNum: number, photo: File, key: string, isBatchUpload: boolean = false) {
    try {
      // Using EXACT same approach as working Required Documents upload
      const response = await this.caspioService.createServicesVisualsAttachWithFile(
        visualIdNum, 
        '', // Annotation blank for now as requested
        photo
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
    console.log('⚠️ Image failed to load:', photo.name, photo.filePath);
    // Replace with a simple inline SVG as fallback
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
  
  // Update existing photo attachment
  async updatePhotoAttachment(attachId: string, file: File): Promise<void> {
    try {
      console.log('🔍 updatePhotoAttachment called with:');
      console.log('  attachId:', attachId);
      console.log('  attachId type:', typeof attachId);
      console.log('  file:', file.name);
      
      // Debug popup - show what we're about to do
      const debugAlert1 = await this.alertController.create({
        header: 'Photo Update Debug - Step 1',
        message: `
          <div style="text-align: left; font-family: monospace; font-size: 12px;">
            <strong style="color: blue;">📤 ATTEMPTING TO UPDATE PHOTO</strong><br><br>
            
            <strong>Attachment ID:</strong> ${attachId}<br>
            <strong>Attachment ID Type:</strong> ${typeof attachId}<br>
            <strong>Attachment ID Length:</strong> ${attachId?.length || 0}<br>
            <strong>File Name:</strong> ${file.name}<br>
            <strong>File Size:</strong> ${(file.size / 1024).toFixed(2)} KB<br>
            <strong>File Type:</strong> ${file.type}<br><br>
            
            <strong>Process:</strong><br>
            1. Upload new file to Files API<br>
            2. Update Services_Visuals_Attach record<br>
            3. Replace Photo field with new path<br><br>
            
            <strong style="color: orange;">Next: Uploading file to Caspio Files API...</strong>
          </div>
        `,
        buttons: ['Continue']
      });
      await debugAlert1.present();
      await debugAlert1.onDidDismiss();
      
      // First upload the new file
      let uploadResult: any;
      try {
        console.log('🔄 Attempting file upload...');
        uploadResult = await this.caspioService.uploadFile(file).toPromise();
        console.log('✅ Upload result:', uploadResult);
        
        // Debug popup - show upload result
        const debugAlert2 = await this.alertController.create({
          header: 'Photo Update Debug - Step 2',
          message: `
            <div style="text-align: left; font-family: monospace; font-size: 12px;">
              <strong style="color: green;">✅ FILE UPLOADED SUCCESSFULLY</strong><br><br>
              
              <strong>Upload Result:</strong><br>
              <div style="background: #f0f0f0; padding: 10px; border-radius: 5px; max-height: 300px; overflow-y: auto;">
                ${JSON.stringify(uploadResult, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
              </div><br>
              
              <strong>File Name from API:</strong> ${uploadResult?.Name || 'NOT FOUND'}<br>
              <strong>Alternative names checked:</strong><br>
              • result.Name: ${uploadResult?.Name || 'undefined'}<br>
              • result.name: ${uploadResult?.name || 'undefined'}<br>
              • result.FileName: ${uploadResult?.FileName || 'undefined'}<br>
              • result.fileName: ${uploadResult?.fileName || 'undefined'}<br><br>
              
              <strong>File Path to Store:</strong> /${uploadResult?.Name || 'unknown'}<br><br>
              
              <strong style="color: orange;">Next: Updating attachment record...</strong>
            </div>
          `,
          buttons: ['Continue']
        });
        await debugAlert2.present();
        await debugAlert2.onDidDismiss();
        
      } catch (uploadError: any) {
        console.error('❌ File upload failed:', uploadError);
        
        // Show detailed error popup
        const errorAlert = await this.alertController.create({
          header: 'Photo Update Debug - Upload Error',
          message: `
            <div style="text-align: left; font-family: monospace; font-size: 12px;">
              <strong style="color: red;">❌ FILE UPLOAD FAILED</strong><br><br>
              
              <strong>Error Message:</strong> ${uploadError?.message || 'Unknown error'}<br><br>
              
              <strong>Error Details:</strong><br>
              <div style="background: #ffe0e0; padding: 10px; border-radius: 5px; max-height: 200px; overflow-y: auto;">
                ${JSON.stringify(uploadError, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
              </div><br>
              
              <strong>File attempted:</strong> ${file.name}<br>
              <strong>File size:</strong> ${(file.size / 1024).toFixed(2)} KB<br>
              <strong>File type:</strong> ${file.type}<br><br>
              
              <strong style="color: orange;">Check console for more details</strong>
            </div>
          `,
          buttons: ['OK']
        });
        await errorAlert.present();
        throw uploadError;
      }
      
      if (!uploadResult || !uploadResult.Name) {
        throw new Error('File upload failed - no Name returned');
      }
      
      // Update the attachment record with new file path
      const updateData = {
        Photo: `/${uploadResult.Name}`
      };
      
      // Debug popup - show update request
      const debugAlert3 = await this.alertController.create({
        header: 'Photo Update Debug - Step 3',
        message: `
          <div style="text-align: left; font-family: monospace; font-size: 12px;">
            <strong style="color: blue;">📝 UPDATING ATTACHMENT RECORD</strong><br><br>
            
            <strong>Table:</strong> Services_Visuals_Attach<br>
            <strong>Where:</strong> AttachID = ${attachId}<br><br>
            
            <strong>Update Data:</strong><br>
            <div style="background: #f0f0f0; padding: 10px; border-radius: 5px;">
              ${JSON.stringify(updateData, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
            </div><br>
            
            <strong>API Endpoint:</strong><br>
            PUT /tables/Services_Visuals_Attach/records?q.where=AttachID=${attachId}<br><br>
            
            <strong style="color: orange;">Sending update request...</strong>
          </div>
        `,
        buttons: ['Send Update']
      });
      await debugAlert3.present();
      await debugAlert3.onDidDismiss();
      
      const updateResult = await this.caspioService.updateServiceVisualsAttach(attachId, updateData).toPromise();
      
      // Debug popup - show update result
      const debugAlert4 = await this.alertController.create({
        header: 'Photo Update Debug - Complete',
        message: `
          <div style="text-align: left; font-family: monospace; font-size: 12px;">
            <strong style="color: green;">✅ UPDATE COMPLETE</strong><br><br>
            
            <strong>Update Response:</strong><br>
            <div style="background: #f0f0f0; padding: 10px; border-radius: 5px; max-height: 200px; overflow-y: auto;">
              ${JSON.stringify(updateResult, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
            </div><br>
            
            <strong>Photo attachment updated successfully!</strong>
          </div>
        `,
        buttons: ['OK']
      });
      await debugAlert4.present();
      
      console.log('✅ Photo attachment updated successfully');
    } catch (error: any) {
      console.error('❌ Failed to update photo attachment:', error);
      
      // Debug popup - show error
      const errorAlert = await this.alertController.create({
        header: 'Photo Update Error',
        message: `
          <div style="text-align: left; font-family: monospace; font-size: 12px;">
            <strong style="color: red;">❌ UPDATE FAILED</strong><br><br>
            
            <strong>Error Message:</strong><br>
            ${error?.message || 'Unknown error'}<br><br>
            
            <strong>Error Details:</strong><br>
            <div style="background: #ffe0e0; padding: 10px; border-radius: 5px; max-height: 200px; overflow-y: auto;">
              ${JSON.stringify(error, null, 2).replace(/\n/g, '<br>').replace(/ /g, '&nbsp;')}
            </div><br>
            
            <strong>Attachment ID:</strong> ${attachId}<br>
            <strong>File Name:</strong> ${file?.name || 'N/A'}<br>
          </div>
        `,
        buttons: ['OK']
      });
      await errorAlert.present();
      
      throw error;
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
      
      // Open enhanced photo viewer with annotation option
      const modal = await this.modalController.create({
        component: PhotoViewerComponent,
        componentProps: {
          photoUrl: imageUrl,
          photoName: photoName,
          photoCaption: photo.caption || '',
          canAnnotate: true,
          visualId: visualId,
          categoryKey: key,
          photoData: photo  // Pass the photo object for update
        },
        cssClass: 'photo-viewer-modal'
      });
      
      await modal.present();
      
      // Handle annotated photo or updated caption if returned
      const { data } = await modal.onDidDismiss();
      
      if (data && data.updatedCaption !== undefined) {
        // Caption was updated
        photo.caption = data.updatedCaption;
        await this.saveCaption(photo, category, itemId);
        this.changeDetectorRef.detectChanges();
      } else if (data && data.annotatedBlob) {
        // Update the existing photo instead of creating new
        const annotatedFile = new File([data.annotatedBlob], photoName, { type: 'image/jpeg' });
        
        if (photo.AttachID || photo.id) {
          // Removed loading screen to allow debug popups to be visible
          
          try {
            // Update the existing attachment
            await this.updatePhotoAttachment(photo.AttachID || photo.id, annotatedFile);
            
            // Update the local photo data
            const photoIndex = this.visualPhotos[visualId]?.findIndex(
              (p: any) => (p.AttachID || p.id) === (photo.AttachID || photo.id)
            );
            
            if (photoIndex !== -1 && this.visualPhotos[visualId]) {
              // Update the photo URL with the new blob
              const newUrl = URL.createObjectURL(data.annotatedBlob);
              this.visualPhotos[visualId][photoIndex].url = newUrl;
              this.visualPhotos[visualId][photoIndex].thumbnailUrl = newUrl;
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
  async addAnotherPhoto(category: string, itemId: string) {
    // Skip custom action sheet and go directly to native file input
    // This will show the native iOS popup with Photo Library, Take Photo, Choose File
    this.currentUploadContext = { 
      category, 
      itemId,
      action: 'add'
    };
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
  
  // Verify if visual was actually saved
  async verifyVisualSaved(category: string, templateId: string): Promise<boolean> {
    try {
      console.log('🔍 Verifying if visual was saved...');
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
              const photoData = {
                ...photo,
                name: photo.Photo || 'Photo',
                Photo: photo.Photo || '', // Keep the original Photo path
                caption: photo.Annotation || '',  // Load existing caption from Annotation field
                url: '',
                thumbnailUrl: ''
              };
              
              // If we have a Photo field with a file path, try to fetch it
              if (photo.Photo && typeof photo.Photo === 'string') {
                photoData.filePath = photo.Photo;
                photoData.hasPhoto = true;
                
                try {
                  console.log(`🖼️ Fetching image from Files API for: ${photo.Photo}`);
                  const imageData = await this.caspioService.getImageFromFilesAPI(photo.Photo).toPromise();
                  
                  if (imageData && imageData.startsWith('data:')) {
                    console.log('✅ Image data received, valid base64, length:', imageData.length);
                    photoData.url = imageData;
                    photoData.thumbnailUrl = imageData;
                  } else {
                    console.log('⚠️ Invalid image data, using fallback');
                    // Use a simple base64 encoded SVG as fallback
                    photoData.url = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#e0e0e0"/><text x="75" y="50" text-anchor="middle" fill="#666" font-size="14">📷 Photo</text></svg>');
                    photoData.thumbnailUrl = photoData.url;
                  }
                } catch (err) {
                  console.error('❌ Error fetching image:', err);
                  // Use simple SVG fallback
                  photoData.url = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="#e0e0e0"/><text x="75" y="50" text-anchor="middle" fill="#666" font-size="14">📷 Photo</text></svg>');
                  photoData.thumbnailUrl = photoData.url;
                }
              } else {
                console.log('⚠️ No Photo field or not a string:', photo.Photo);
                // No photo exists
                photoData.url = '';
                photoData.thumbnailUrl = '';
                photoData.hasPhoto = false;
              }
              
              console.log('Photo data processed:', {
                name: photoData.name,
                hasUrl: !!photoData.url,
                urlLength: photoData.url?.length,
                filePath: photoData.filePath
              });
              
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
    
    // Trigger auto-save to Services table
    this.autoSaveServiceField(fieldName, value);
  }
  
  // Auto-save project field to Caspio Projects table
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
    const primaryPhoto = this.projectData?.PrimaryPhoto || null;
    
    return {
      projectId: this.projectId,
      primaryPhoto: primaryPhoto,
      address: this.projectData?.Address || '',
      city: this.projectData?.City || '',
      state: this.projectData?.State || '',
      zip: this.projectData?.Zip || '',
      fullAddress: `${this.projectData?.Address || ''}, ${this.projectData?.City || ''}, ${this.projectData?.State || ''} ${this.projectData?.Zip || ''}`,
      clientName: this.projectData?.ClientName || this.projectData?.Owner || '',
      inspectionDate: this.formatDate(this.serviceData?.DateOfInspection || new Date().toISOString()),
      buildingType: this.formData.foundationType || 'Post-Tension',
      weatherConditions: this.serviceData?.WeatherConditions || 'Clear',
      temperature: this.serviceData?.Temperature || '75°F',
      inspectorName: 'Inspector Name',
      inspectorPhone: '936-202-8013',
      inspectorEmail: 'info@noblepropertyinspections.com',
      licenseNumber: '12345'
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
      
      // Process comments
      if (categoryData.comments) {
        for (const comment of categoryData.comments) {
          if (this.isCommentSelected(category, comment.VisualID)) {
            const photos = await this.getVisualPhotos(comment.VisualID);
            categoryResult.comments.push({
              name: comment.Name || comment.name,
              text: comment.Text || comment.text,
              visualId: comment.VisualID,
              photos: photos
            });
          }
        }
      }
      
      // Process limitations
      if (categoryData.limitations) {
        for (const limitation of categoryData.limitations) {
          if (this.isLimitationSelected(category, limitation.VisualID)) {
            const photos = await this.getVisualPhotos(limitation.VisualID);
            categoryResult.limitations.push({
              name: limitation.Name || limitation.name,
              text: limitation.Text || limitation.text,
              visualId: limitation.VisualID,
              photos: photos
            });
          }
        }
      }
      
      // Process deficiencies
      if (categoryData.deficiencies) {
        for (const deficiency of categoryData.deficiencies) {
          if (this.isDeficiencySelected(category, deficiency.VisualID)) {
            const photos = await this.getVisualPhotos(deficiency.VisualID);
            categoryResult.deficiencies.push({
              name: deficiency.Name || deficiency.name,
              text: deficiency.Text || deficiency.text,
              visualId: deficiency.VisualID,
              photos: photos
            });
          }
        }
      }
      
      // Only add category if it has selected items
      if (categoryResult.comments.length > 0 || 
          categoryResult.limitations.length > 0 || 
          categoryResult.deficiencies.length > 0) {
        result.push(categoryResult);
      }
    }
    
    return result;
  }

  async prepareElevationPlotData() {
    const result = [];
    
    for (const roomName of Object.keys(this.selectedRooms)) {
      if (!this.selectedRooms[roomName]) continue;
      
      const roomData = this.roomElevationData[roomName];
      if (!roomData) continue;
      
      const roomResult: any = {
        name: roomName,
        fdf: roomData.fdf,
        notes: roomData.notes,
        points: [],
        photos: []
      };
      
      // Process elevation points
      if (roomData.elevationPoints) {
        for (const point of roomData.elevationPoints) {
          if (point.value) {
            roomResult.points.push({
              name: point.name,
              value: point.value,
              photoCount: point.photoCount || 0
            });
          }
        }
      }
      
      // Get room photos if any
      const roomId = roomData.roomId;
      if (roomId) {
        const photos = await this.getRoomPhotos(roomId);
        roomResult.photos = photos;
      }
      
      result.push(roomResult);
    }
    
    return result;
  }

  async getVisualPhotos(visualId: string) {
    // Get photos for a specific visual from Services_Visuals_Attach
    const photos = this.visualPhotos[visualId] || [];
    const account = this.caspioService.getAccountID();
    const token = this.caspioService.getCurrentToken() || '';
    
    console.log(`📸 Getting photos for visual ${visualId}:`, photos.length);
    
    return photos.map((photo: any) => {
      let photoUrl = photo.Photo || photo.url || '';
      
      // If it's a Caspio file path (starts with /), convert to full URL
      if (photoUrl && photoUrl.startsWith('/')) {
        photoUrl = `https://${account}.caspio.com/rest/v2/files${photoUrl}?access_token=${token}`;
        console.log(`Converted Caspio path to URL: ${photoUrl}`);
      } else if (photoUrl && photoUrl.startsWith('blob:')) {
        // Keep blob URLs as-is for local preview
        console.log(`Keeping blob URL: ${photoUrl}`);
      }
      
      return {
        url: photoUrl,
        caption: photo.Annotation || '',
        attachId: photo.AttachID || photo.id || ''
      };
    });
  }

  async getRoomPhotos(roomId: string) {
    // Get photos for a specific room
    // This would need to be implemented based on your photo storage
    return [];
  }

  async fetchAllVisualsFromDatabase() {
    try {
      console.log('📊 Fetching all visuals from database for ServiceID:', this.serviceId);
      
      // Fetch all Services_Visuals records for this service
      const visualsResponse = await this.caspioService.getVisualsForService(this.serviceId).toPromise();
      
      const visuals = visualsResponse || [];
      console.log(`Found ${visuals.length} visual records`);
      
      // Clear and rebuild the visualPhotos mapping
      this.visualPhotos = {};
      
      // For each visual, fetch its attachments
      for (const visual of visuals) {
        const visualId = visual.VisualID;
        
        if (visualId) {
          // Fetch attachments for this visual
          const attachments = await this.caspioService.getVisualAttachments(visualId).toPromise();
          
          console.log(`Visual ${visualId} has ${attachments.length} attachments`);
          
          // Store the attachments in our mapping
          this.visualPhotos[visualId] = attachments.map((att: any) => ({
            Photo: att.Photo,
            Annotation: att.Annotation,
            AttachID: att.AttachID || att.PK_ID
          }));
          
          // Also update the visual in our organized data if it exists
          this.updateVisualInOrganizedData(visual);
        }
      }
      
      console.log('✅ Database fetch complete. Visual photos:', this.visualPhotos);
    } catch (error) {
      console.error('❌ Error fetching visuals from database:', error);
      await this.showToast('Error loading inspection data. Some images may not appear.', 'warning');
    }
  }

  updateVisualInOrganizedData(visual: any) {
    const category = visual.Category;
    const kind = visual.Kind?.toLowerCase();
    
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
      this.selectedItems[key] = true;
      console.log(`Marked as selected from database: ${key}`);
    }
  }
}