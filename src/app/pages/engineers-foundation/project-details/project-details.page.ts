import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { EngineersFoundationStateService, ProjectData } from '../services/engineers-foundation-state.service';
import { CaspioService } from '../../../services/caspio.service';
import { OfflineService } from '../../../services/offline.service';
import { IndexedDbService } from '../../../services/indexed-db.service';
import { BackgroundSyncService } from '../../../services/background-sync.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';

@Component({
  selector: 'app-project-details',
  templateUrl: './project-details.page.html',
  styleUrls: ['./project-details.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class ProjectDetailsPage implements OnInit, OnDestroy {
  projectId: string = '';
  serviceId: string = '';
  projectData: any = {};  // Use any to match original structure
  serviceData: any = {};  // Add serviceData for Services table fields

  // Dropdown options
  inAttendanceOptions: string[] = ['Owner', 'Occupant', 'Agent', 'Builder', 'Other'];
  typeOfBuildingOptions: string[] = ['Single Family', 'Multi-Family', 'Commercial', 'Other'];
  styleOptions: string[] = ['Ranch', 'Two Story', 'Split Level', 'Bi-Level', 'Tri-Level', 'Other'];
  occupancyFurnishingsOptions: string[] = ['Occupied - Furnished', 'Occupied - Unfurnished', 'Vacant - Furnished', 'Vacant - Unfurnished', 'Other'];
  weatherConditionsOptions: string[] = ['Clear', 'Partly Cloudy', 'Cloudy', 'Light Rain', 'Heavy Rain', 'Windy', 'Foggy', 'Other'];
  outdoorTemperatureOptions: string[] = ['30°F -', '30°F to 60°F', '60°F to 70°F', '70°F to 80°F', '80°F to 90°F', '90°F to 100°F', '100°F+', 'Other'];
  firstFoundationTypeOptions: string[] = ['Slab on Grade', 'Pier and Beam', 'Basement', 'Crawl Space', 'Other'];
  secondFoundationTypeOptions: string[] = ['Slab on Grade', 'Pier and Beam', 'Basement', 'Crawl Space', 'None', 'Other'];
  thirdFoundationTypeOptions: string[] = ['Slab on Grade', 'Pier and Beam', 'Basement', 'Crawl Space', 'None', 'Other'];
  secondFoundationRoomsOptions: string[] = ['Living Room', 'Kitchen', 'Master Bedroom', 'Bathroom', 'Other'];
  thirdFoundationRoomsOptions: string[] = ['Living Room', 'Kitchen', 'Master Bedroom', 'Bathroom', 'Other'];
  ownerOccupantInterviewOptions: string[] = [
    'Owner/occupant not available for discussion',
    'Owner/occupant not aware of any previous foundation work',
    'Owner/occupant provided the information documented in Support Documents',
    'Owner/occupant is aware of previous work and will email documents asap',
    'Other'
  ];

  // Multi-select arrays
  inAttendanceSelections: string[] = [];
  secondFoundationRoomsSelections: string[] = [];
  thirdFoundationRoomsSelections: string[] = [];

  // "Other" value properties
  inAttendanceOtherValue: string = '';
  typeOfBuildingOtherValue: string = '';
  styleOtherValue: string = '';
  occupancyFurnishingsOtherValue: string = '';
  weatherConditionsOtherValue: string = '';
  outdoorTemperatureOtherValue: string = '';
  firstFoundationTypeOtherValue: string = '';
  secondFoundationTypeOtherValue: string = '';
  thirdFoundationTypeOtherValue: string = '';
  secondFoundationRoomsOtherValue: string = '';
  thirdFoundationRoomsOtherValue: string = '';
  ownerOccupantInterviewOtherValue: string = '';

  // Save status
  saveStatus: string = '';
  saveStatusType: 'info' | 'success' | 'error' = 'info';

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private stateService: EngineersFoundationStateService,
    private caspioService: CaspioService,
    private toastController: ToastController,
    private offlineService: OfflineService,
    private changeDetectorRef: ChangeDetectorRef,
    private indexedDb: IndexedDbService,
    private backgroundSync: BackgroundSyncService,
    private offlineTemplate: OfflineTemplateService
  ) {}

  async ngOnInit() {
    // Load dropdown options from database tables (non-blocking for offline support)
    this.loadDropdownOptions();
    this.loadProjectDropdownOptions();

    // Get IDs from parent route snapshot immediately (for offline reliability)
    const parentParams = this.route.parent?.snapshot?.params;
    if (parentParams) {
      this.projectId = parentParams['projectId'] || '';
      this.serviceId = parentParams['serviceId'] || '';
      console.log('[ProjectDetails] Got params from snapshot:', this.projectId, this.serviceId);

      if (this.projectId && this.serviceId) {
        this.loadData();
      }
    }

    // Also subscribe to param changes (for dynamic updates)
    this.route.parent?.params.subscribe(params => {
      const newProjectId = params['projectId'];
      const newServiceId = params['serviceId'];

      // Only reload if IDs changed
      if (newProjectId !== this.projectId || newServiceId !== this.serviceId) {
        this.projectId = newProjectId;
        this.serviceId = newServiceId;
        this.loadData();
      }
    });

    // Note: We don't reload on sync complete - IndexedDB already has the correct data
    // The user's changes were saved to IndexedDB when they made them
  }

  ngOnDestroy() {
    // Cleanup if needed
  }

  private async loadData() {
    console.log('[ProjectDetails] Loading data (OFFLINE-FIRST)...');

    try {
      // OFFLINE-FIRST: Try IndexedDB first for both project and service data
      await Promise.all([
        this.loadProjectData(),
        this.loadServiceData()
      ]);
    } catch (error) {
      console.error('[ProjectDetails] Error in loadData:', error);
    }
  }

  private async loadProjectData() {
    // Try IndexedDB first - this is the source of truth for offline-first
    let project = await this.offlineTemplate.getProject(this.projectId);

    if (project) {
      console.log('[ProjectDetails] Loaded project from IndexedDB cache');
    } else {
      // Only fetch from API if IndexedDB has nothing at all
      console.log('[ProjectDetails] Project not in cache, fetching from API...');
      try {
        const freshProject = await this.caspioService.getProject(this.projectId, false).toPromise();
        if (freshProject) {
          await this.indexedDb.cacheProjectRecord(this.projectId, freshProject);
          project = freshProject;
        }
      } catch (error) {
        console.error('[ProjectDetails] Error loading project from API:', error);
        return;
      }
    }

    this.projectData = project || {};

    // Check if TypeOfBuilding is a custom value (not in predefined options)
    if (this.projectData.TypeOfBuilding) {
      if (!this.typeOfBuildingOptions.includes(this.projectData.TypeOfBuilding)) {
        this.typeOfBuildingOtherValue = this.projectData.TypeOfBuilding;
        this.projectData.TypeOfBuilding = 'Other';
      }
    } else {
      this.projectData.TypeOfBuilding = '';
    }

    // Check if Style is a custom value (not in predefined options)
    if (this.projectData.Style) {
      if (!this.styleOptions.includes(this.projectData.Style)) {
        this.styleOtherValue = this.projectData.Style;
        this.projectData.Style = 'Other';
      }
    } else {
      this.projectData.Style = '';
    }

    this.changeDetectorRef.detectChanges();
  }

  private async loadServiceData() {
    // Try IndexedDB first - this is the source of truth for offline-first
    let service = await this.offlineTemplate.getService(this.serviceId);

    if (service) {
      console.log('[ProjectDetails] Loaded service from IndexedDB cache');
    } else {
      // Only fetch from API if IndexedDB has nothing at all
      console.log('[ProjectDetails] Service not in cache, fetching from API...');
      try {
        const freshService = await this.caspioService.getService(this.serviceId, false).toPromise();
        if (freshService) {
          await this.indexedDb.cacheServiceRecord(this.serviceId, freshService);
          service = freshService;
        }
      } catch (error) {
        console.error('[ProjectDetails] Error loading service from API:', error);
        return;
      }
    }

    this.serviceData = service || {};

    // Check if OccupancyFurnishings is a custom value
    if (this.serviceData.OccupancyFurnishings) {
      if (!this.occupancyFurnishingsOptions.includes(this.serviceData.OccupancyFurnishings)) {
        this.occupancyFurnishingsOtherValue = this.serviceData.OccupancyFurnishings;
        this.serviceData.OccupancyFurnishings = 'Other';
      }
    } else {
      this.serviceData.OccupancyFurnishings = '';
    }

    // Check if WeatherConditions is a custom value
    if (this.serviceData.WeatherConditions) {
      if (!this.weatherConditionsOptions.includes(this.serviceData.WeatherConditions)) {
        this.weatherConditionsOtherValue = this.serviceData.WeatherConditions;
        this.serviceData.WeatherConditions = 'Other';
      }
    } else {
      this.serviceData.WeatherConditions = '';
    }

    // Check if OutdoorTemperature is a custom value
    if (this.serviceData.OutdoorTemperature) {
      if (!this.outdoorTemperatureOptions.includes(this.serviceData.OutdoorTemperature)) {
        this.outdoorTemperatureOtherValue = this.serviceData.OutdoorTemperature;
        this.serviceData.OutdoorTemperature = 'Other';
      }
    } else {
      this.serviceData.OutdoorTemperature = '';
    }

    // Check if FirstFoundationType is a custom value
    if (this.serviceData.FirstFoundationType) {
      if (!this.firstFoundationTypeOptions.includes(this.serviceData.FirstFoundationType)) {
        this.firstFoundationTypeOtherValue = this.serviceData.FirstFoundationType;
        this.serviceData.FirstFoundationType = 'Other';
      }
    } else {
      this.serviceData.FirstFoundationType = '';
    }

    // Check if SecondFoundationType is a custom value
    if (this.serviceData.SecondFoundationType) {
      if (!this.secondFoundationTypeOptions.includes(this.serviceData.SecondFoundationType)) {
        this.secondFoundationTypeOtherValue = this.serviceData.SecondFoundationType;
        this.serviceData.SecondFoundationType = 'Other';
      }
    } else {
      this.serviceData.SecondFoundationType = '';
    }

    // Check if ThirdFoundationType is a custom value
    if (this.serviceData.ThirdFoundationType) {
      if (!this.thirdFoundationTypeOptions.includes(this.serviceData.ThirdFoundationType)) {
        this.thirdFoundationTypeOtherValue = this.serviceData.ThirdFoundationType;
        this.serviceData.ThirdFoundationType = 'Other';
      }
    } else {
      this.serviceData.ThirdFoundationType = '';
    }

    // Check if OwnerOccupantInterview is a custom value
    if (this.serviceData.OwnerOccupantInterview) {
      if (!this.ownerOccupantInterviewOptions.includes(this.serviceData.OwnerOccupantInterview)) {
        this.ownerOccupantInterviewOtherValue = this.serviceData.OwnerOccupantInterview;
        this.serviceData.OwnerOccupantInterview = 'Other';
      }
    } else {
      this.serviceData.OwnerOccupantInterview = '';
    }

    // Initialize multi-select arrays from stored comma-separated strings
    if (this.serviceData.InAttendance) {
      this.inAttendanceSelections = this.serviceData.InAttendance.split(',').map((s: string) => s.trim()).filter((s: string) => s);

      const customValues = this.inAttendanceSelections.filter((val: string) =>
        !this.inAttendanceOptions.includes(val)
      );
      if (customValues.length > 0) {
        this.inAttendanceOtherValue = customValues.join(', ');
        this.inAttendanceSelections = this.inAttendanceSelections.filter((val: string) =>
          this.inAttendanceOptions.includes(val) || val === 'Other'
        );
        if (!this.inAttendanceSelections.includes('Other')) {
          this.inAttendanceSelections.push('Other');
        }
      }
    }

    if (this.serviceData.SecondFoundationRooms) {
      this.secondFoundationRoomsSelections = this.serviceData.SecondFoundationRooms.split(',').map((s: string) => s.trim()).filter((s: string) => s);

      const customValues = this.secondFoundationRoomsSelections.filter((val: string) =>
        !this.secondFoundationRoomsOptions.includes(val)
      );
      if (customValues.length > 0) {
        this.secondFoundationRoomsOtherValue = customValues.join(', ');
        this.secondFoundationRoomsSelections = this.secondFoundationRoomsSelections.filter((val: string) =>
          this.secondFoundationRoomsOptions.includes(val) || val === 'Other'
        );
        if (!this.secondFoundationRoomsSelections.includes('Other')) {
          this.secondFoundationRoomsSelections.push('Other');
        }
      }
    }

    if (this.serviceData.ThirdFoundationRooms) {
      this.thirdFoundationRoomsSelections = this.serviceData.ThirdFoundationRooms.split(',').map((s: string) => s.trim()).filter((s: string) => s);

      const customValues = this.thirdFoundationRoomsSelections.filter((val: string) =>
        !this.thirdFoundationRoomsOptions.includes(val)
      );
      if (customValues.length > 0) {
        this.thirdFoundationRoomsOtherValue = customValues.join(', ');
        this.thirdFoundationRoomsSelections = this.thirdFoundationRoomsSelections.filter((val: string) =>
          this.thirdFoundationRoomsOptions.includes(val) || val === 'Other'
        );
        if (!this.thirdFoundationRoomsSelections.includes('Other')) {
          this.thirdFoundationRoomsSelections.push('Other');
        }
      }
    }

    this.changeDetectorRef.detectChanges();
  }

  // Load dropdown options from Services_Drop table
  private async loadDropdownOptions() {
    try {
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

  // Load dropdown options from Projects_Drop table
  private async loadProjectDropdownOptions() {
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
      }
    } catch (error) {
      console.error('Error loading Projects_Drop options:', error);
      // Keep default options on error
    }
  }

  // Year Built handlers
  onYearBuiltChange(value: string) {
    // Remove non-numeric characters
    const cleaned = value.replace(/[^0-9]/g, '');
    this.projectData.YearBuilt = cleaned;
    this.autoSaveProjectField('YearBuilt', cleaned);
  }

  formatYearBuilt() {
    if (this.projectData.YearBuilt) {
      // Ensure 4 digits
      const year = this.projectData.YearBuilt.replace(/[^0-9]/g, '');
      if (year.length === 4) {
        this.projectData.YearBuilt = year;
        this.autoSaveProjectField('YearBuilt', year);
      }
    }
  }

  // Square Feet handlers
  onSquareFeetChange(value: string) {
    // Remove non-numeric characters except comma
    const cleaned = value.replace(/[^0-9,]/g, '');
    this.projectData.SquareFeet = cleaned;
    this.autoSaveProjectField('SquareFeet', cleaned);
  }

  formatSquareFeet() {
    if (this.projectData.SquareFeet) {
      // Remove existing commas and add thousands separator
      const number = this.projectData.SquareFeet.replace(/,/g, '');
      if (number) {
        const formatted = parseInt(number, 10).toLocaleString('en-US');
        this.projectData.SquareFeet = formatted;
      }
    }
  }

  // Project field change handler (for Projects table)
  async onProjectFieldChange(fieldName: string, value: any) {
    // If "Other" is selected, wait for user to fill in the inline input field
    if (value === 'Other') {
      return;
    }

    this.projectData[fieldName] = value;
    this.autoSaveProjectField(fieldName, value);
  }

  // Service field change handler (for Services table)
  async onServiceFieldChange(fieldName: string, value: any) {
    // If "Other" is selected, wait for user to fill in the inline input field
    if (value === 'Other') {
      return;
    }

    this.serviceData[fieldName] = value;
    this.autoSaveServiceField(fieldName, value);
  }

  // In Attendance multi-select methods
  isInAttendanceSelected(option: string): boolean {
    if (!this.inAttendanceSelections || !Array.isArray(this.inAttendanceSelections)) {
      return false;
    }
    if (option === 'Other') {
      return this.inAttendanceSelections.includes('Other') ||
             !!(this.inAttendanceOtherValue && this.inAttendanceOtherValue.trim().length > 0);
    }
    return this.inAttendanceSelections.includes(option);
  }

  async onInAttendanceToggle(option: string, event: any) {
    if (!this.inAttendanceSelections) {
      this.inAttendanceSelections = [];
    }

    if (event.detail.checked) {
      if (!this.inAttendanceSelections.includes(option)) {
        this.inAttendanceSelections.push(option);
      }
    } else {
      const index = this.inAttendanceSelections.indexOf(option);
      if (index > -1) {
        this.inAttendanceSelections.splice(index, 1);
      }
      if (option === 'Other') {
        this.inAttendanceOtherValue = '';
      }
    }

    await this.saveInAttendance();
  }

  async onInAttendanceOtherChange() {
    if (this.inAttendanceOtherValue && this.inAttendanceOtherValue.trim()) {
      if (!this.inAttendanceSelections) {
        this.inAttendanceSelections = [];
      }
      const otherIndex = this.inAttendanceSelections.indexOf('Other');
      if (otherIndex > -1) {
        this.inAttendanceSelections[otherIndex] = this.inAttendanceOtherValue.trim();
      } else {
        const customIndex = this.inAttendanceSelections.findIndex((opt: string) =>
          opt !== 'Other' && !this.inAttendanceOptions.includes(opt)
        );
        if (customIndex > -1) {
          this.inAttendanceSelections[customIndex] = this.inAttendanceOtherValue.trim();
        } else {
          this.inAttendanceSelections.push(this.inAttendanceOtherValue.trim());
        }
      }
    } else {
      const customIndex = this.inAttendanceSelections.findIndex((opt: string) =>
        opt !== 'Other' && !this.inAttendanceOptions.includes(opt)
      );
      if (customIndex > -1) {
        this.inAttendanceSelections[customIndex] = 'Other';
      }
    }
    await this.saveInAttendance();
  }

  private async saveInAttendance() {
    const attendanceText = this.inAttendanceSelections.join(', ');
    this.serviceData.InAttendance = attendanceText;
    await this.autoSaveServiceField('InAttendance', attendanceText);
    this.changeDetectorRef.detectChanges();
  }

  // Second Foundation Rooms multi-select methods
  isSecondFoundationRoomsSelected(option: string): boolean {
    if (!this.secondFoundationRoomsSelections) {
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

    await this.saveSecondFoundationRooms();
  }

  async onSecondFoundationRoomsOtherChange() {
    if (this.secondFoundationRoomsOtherValue && this.secondFoundationRoomsOtherValue.trim()) {
      const otherIndex = this.secondFoundationRoomsSelections.indexOf('Other');
      if (otherIndex > -1) {
        this.secondFoundationRoomsSelections[otherIndex] = this.secondFoundationRoomsOtherValue.trim();
      } else {
        this.secondFoundationRoomsSelections.push(this.secondFoundationRoomsOtherValue.trim());
      }
    }
    await this.saveSecondFoundationRooms();
  }

  private async saveSecondFoundationRooms() {
    const roomsText = this.secondFoundationRoomsSelections.join(', ');
    this.serviceData.SecondFoundationRooms = roomsText;
    await this.autoSaveServiceField('SecondFoundationRooms', roomsText);
    this.changeDetectorRef.detectChanges();
  }

  // Third Foundation Rooms multi-select methods
  isThirdFoundationRoomsSelected(option: string): boolean {
    if (!this.thirdFoundationRoomsSelections) {
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

    await this.saveThirdFoundationRooms();
  }

  async onThirdFoundationRoomsOtherChange() {
    if (this.thirdFoundationRoomsOtherValue && this.thirdFoundationRoomsOtherValue.trim()) {
      const otherIndex = this.thirdFoundationRoomsSelections.indexOf('Other');
      if (otherIndex > -1) {
        this.thirdFoundationRoomsSelections[otherIndex] = this.thirdFoundationRoomsOtherValue.trim();
      } else {
        this.thirdFoundationRoomsSelections.push(this.thirdFoundationRoomsOtherValue.trim());
      }
    }
    await this.saveThirdFoundationRooms();
  }

  private async saveThirdFoundationRooms() {
    const roomsText = this.thirdFoundationRoomsSelections.join(', ');
    this.serviceData.ThirdFoundationRooms = roomsText;
    await this.autoSaveServiceField('ThirdFoundationRooms', roomsText);
    this.changeDetectorRef.detectChanges();
  }

  // "Other" value change handlers for dropdowns
  async onTypeOfBuildingOtherChange() {
    if (this.typeOfBuildingOtherValue && this.typeOfBuildingOtherValue.trim()) {
      const customValue = this.typeOfBuildingOtherValue.trim();
      this.autoSaveProjectField('TypeOfBuilding', customValue);
    }
  }

  async onStyleOtherChange() {
    if (this.styleOtherValue && this.styleOtherValue.trim()) {
      const customValue = this.styleOtherValue.trim();
      this.autoSaveProjectField('Style', customValue);
    }
  }

  async onOccupancyFurnishingsOtherChange() {
    if (this.occupancyFurnishingsOtherValue && this.occupancyFurnishingsOtherValue.trim()) {
      const customValue = this.occupancyFurnishingsOtherValue.trim();
      this.autoSaveServiceField('OccupancyFurnishings', customValue);
    }
  }

  async onWeatherConditionsOtherChange() {
    if (this.weatherConditionsOtherValue && this.weatherConditionsOtherValue.trim()) {
      const customValue = this.weatherConditionsOtherValue.trim();
      this.autoSaveServiceField('WeatherConditions', customValue);
    }
  }

  async onOutdoorTemperatureOtherChange() {
    if (this.outdoorTemperatureOtherValue && this.outdoorTemperatureOtherValue.trim()) {
      const customValue = this.outdoorTemperatureOtherValue.trim();
      this.autoSaveServiceField('OutdoorTemperature', customValue);
    }
  }

  async onFirstFoundationTypeOtherChange() {
    if (this.firstFoundationTypeOtherValue && this.firstFoundationTypeOtherValue.trim()) {
      const customValue = this.firstFoundationTypeOtherValue.trim();
      this.autoSaveServiceField('FirstFoundationType', customValue);
    }
  }

  async onSecondFoundationTypeOtherChange() {
    if (this.secondFoundationTypeOtherValue && this.secondFoundationTypeOtherValue.trim()) {
      const customValue = this.secondFoundationTypeOtherValue.trim();
      this.autoSaveServiceField('SecondFoundationType', customValue);
    }
  }

  async onThirdFoundationTypeOtherChange() {
    if (this.thirdFoundationTypeOtherValue && this.thirdFoundationTypeOtherValue.trim()) {
      const customValue = this.thirdFoundationTypeOtherValue.trim();
      this.autoSaveServiceField('ThirdFoundationType', customValue);
    }
  }

  async onOwnerOccupantInterviewOtherChange() {
    if (this.ownerOccupantInterviewOtherValue && this.ownerOccupantInterviewOtherValue.trim()) {
      const customValue = this.ownerOccupantInterviewOtherValue.trim();
      this.autoSaveServiceField('OwnerOccupantInterview', customValue);
    }
  }

  // Auto-save to Projects table (OFFLINE-FIRST)
  private async autoSaveProjectField(fieldName: string, value: any) {
    if (!this.projectId || this.projectId === 'new') return;

    console.log(`[ProjectDetails] Saving project field ${fieldName}:`, value);

    // 1. Update local data immediately (for instant UI feedback)
    this.projectData[fieldName] = value;

    // 2. Update IndexedDB cache immediately
    try {
      await this.offlineTemplate.updateProject(this.projectId, { [fieldName]: value });
      console.log(`[ProjectDetails] Project field ${fieldName} saved to IndexedDB`);
    } catch (error) {
      console.error(`[ProjectDetails] Error saving to IndexedDB:`, error);
    }

    // 3. Show appropriate status message
    const isOnline = this.offlineService.isOnline();
    if (isOnline) {
      this.showSaveStatus(`${fieldName} saved`, 'success');
    } else {
      this.showSaveStatus(`${fieldName} saved offline`, 'success');
    }

    // 4. Trigger background sync (will push to server when online)
    this.backgroundSync.triggerSync();
  }

  // Auto-save to Services table (OFFLINE-FIRST)
  private async autoSaveServiceField(fieldName: string, value: any) {
    if (!this.serviceId) {
      console.error(`Cannot save ${fieldName} - No ServiceID! ServiceID is: ${this.serviceId}`);
      return;
    }

    console.log(`[ProjectDetails] Saving service field ${fieldName}:`, value);

    // 1. Update local data immediately (for instant UI feedback)
    this.serviceData[fieldName] = value;

    // 2. Update IndexedDB cache immediately
    try {
      await this.offlineTemplate.updateService(this.serviceId, { [fieldName]: value });
      console.log(`[ProjectDetails] Service field ${fieldName} saved to IndexedDB`);
    } catch (error) {
      console.error(`[ProjectDetails] Error saving to IndexedDB:`, error);
    }

    // 3. Show appropriate status message
    const isOnline = this.offlineService.isOnline();
    if (isOnline) {
      this.showSaveStatus(`${fieldName} saved`, 'success');
    } else {
      this.showSaveStatus(`${fieldName} saved offline`, 'success');
    }

    // 4. Trigger background sync (will push to server when online)
    this.backgroundSync.triggerSync();
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
}
