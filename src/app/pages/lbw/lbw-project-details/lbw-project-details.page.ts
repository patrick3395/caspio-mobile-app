import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { LbwStateService, LbwProjectData } from '../services/lbw-state.service';
import { CaspioService } from '../../../services/caspio.service';
import { OfflineService } from '../../../services/offline.service';

@Component({
  selector: 'app-lbw-project-details',
  templateUrl: './lbw-project-details.page.html',
  styleUrls: ['./lbw-project-details.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class LbwProjectDetailsPage implements OnInit {
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
    private stateService: LbwStateService,
    private caspioService: CaspioService,
    private toastController: ToastController,
    private offlineService: OfflineService,
    private changeDetectorRef: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    // Load dropdown options from database tables
    await this.loadDropdownOptions();
    await this.loadProjectDropdownOptions();

    // Get IDs from parent route
    this.route.parent?.params.subscribe(params => {
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];

      // Load project and service data
      this.loadData();
    });
  }

  private async loadData() {
    try {
      // Load project data
      this.caspioService.getProject(this.projectId).subscribe({
        next: (project) => {
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
        },
        error: (error) => {
          console.error('Error loading project:', error);
        }
      });

      // Load service data
      this.caspioService.getService(this.serviceId).subscribe({
        next: async (service) => {
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
          // Don't filter out custom values - loadDropdownOptions() will add them to options
          if (this.serviceData.InAttendance) {
            this.inAttendanceSelections = this.serviceData.InAttendance.split(',').map((s: string) => s.trim()).filter((s: string) => s);
          }

          if (this.serviceData.SecondFoundationRooms) {
            this.secondFoundationRoomsSelections = this.serviceData.SecondFoundationRooms.split(',').map((s: string) => s.trim()).filter((s: string) => s);
          }

          if (this.serviceData.ThirdFoundationRooms) {
            this.thirdFoundationRoomsSelections = this.serviceData.ThirdFoundationRooms.split(',').map((s: string) => s.trim()).filter((s: string) => s);
          }

          // Reload dropdown options to restore custom values to the options arrays
          await this.loadDropdownOptions();

          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          console.error('Error loading service:', error);
        }
      });
    } catch (error) {
      console.error('Error in loadData:', error);
    }
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
        }

        // Set Occupancy Furnishings options
        if (optionsByService['OccupancyFurnishings'] && optionsByService['OccupancyFurnishings'].length > 0) {
          this.occupancyFurnishingsOptions = optionsByService['OccupancyFurnishings'];
          if (!this.occupancyFurnishingsOptions.includes('Other')) {
            this.occupancyFurnishingsOptions.push('Other');
          }
        }

        // Set InAttendance options (multi-select - preserve custom selections)
        if (optionsByService['InAttendance'] && optionsByService['InAttendance'].length > 0) {
          this.inAttendanceOptions = optionsByService['InAttendance'];
          // Restore custom values from saved selections
          if (this.inAttendanceSelections && this.inAttendanceSelections.length > 0) {
            this.inAttendanceSelections.forEach(selection => {
              if (selection && selection !== 'Other' && selection !== 'None' && !this.inAttendanceOptions.includes(selection)) {
                // Add missing custom selection to options
                console.log(`[LBW ProjectDetails] Adding missing InAttendance selection to options: "${selection}"`);
                this.inAttendanceOptions.push(selection);
              }
            });
          }
          // Sort options alphabetically, keeping "None" and "Other" at the end
          this.inAttendanceOptions = this.inAttendanceOptions
            .filter(opt => opt !== 'Other' && opt !== 'None')
            .sort((a, b) => a.localeCompare(b));
          if (!this.inAttendanceOptions.includes('None')) {
            this.inAttendanceOptions.push('None');
          }
          this.inAttendanceOptions.push('Other');
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

        // Set SecondFoundationRooms options (multi-select - preserve custom selections)
        if (optionsByService['SecondFoundationRooms'] && optionsByService['SecondFoundationRooms'].length > 0) {
          this.secondFoundationRoomsOptions = optionsByService['SecondFoundationRooms'];
          // Restore custom values from saved selections
          if (this.secondFoundationRoomsSelections && this.secondFoundationRoomsSelections.length > 0) {
            this.secondFoundationRoomsSelections.forEach(selection => {
              if (selection && selection !== 'Other' && selection !== 'None' && !this.secondFoundationRoomsOptions.includes(selection)) {
                // Add missing custom selection to options
                console.log(`[LBW ProjectDetails] Adding missing SecondFoundationRooms selection to options: "${selection}"`);
                this.secondFoundationRoomsOptions.push(selection);
              }
            });
          }
          // Sort options alphabetically, keeping "None" and "Other" at the end
          this.secondFoundationRoomsOptions = this.secondFoundationRoomsOptions
            .filter(opt => opt !== 'Other' && opt !== 'None')
            .sort((a, b) => a.localeCompare(b));
          if (!this.secondFoundationRoomsOptions.includes('None')) {
            this.secondFoundationRoomsOptions.push('None');
          }
          this.secondFoundationRoomsOptions.push('Other');
        }

        // Set ThirdFoundationRooms options (multi-select - preserve custom selections)
        if (optionsByService['ThirdFoundationRooms'] && optionsByService['ThirdFoundationRooms'].length > 0) {
          this.thirdFoundationRoomsOptions = optionsByService['ThirdFoundationRooms'];
          // Restore custom values from saved selections
          if (this.thirdFoundationRoomsSelections && this.thirdFoundationRoomsSelections.length > 0) {
            this.thirdFoundationRoomsSelections.forEach(selection => {
              if (selection && selection !== 'Other' && selection !== 'None' && !this.thirdFoundationRoomsOptions.includes(selection)) {
                // Add missing custom selection to options
                console.log(`[LBW ProjectDetails] Adding missing ThirdFoundationRooms selection to options: "${selection}"`);
                this.thirdFoundationRoomsOptions.push(selection);
              }
            });
          }
          // Sort options alphabetically, keeping "None" and "Other" at the end
          this.thirdFoundationRoomsOptions = this.thirdFoundationRoomsOptions
            .filter(opt => opt !== 'Other' && opt !== 'None')
            .sort((a, b) => a.localeCompare(b));
          if (!this.thirdFoundationRoomsOptions.includes('None')) {
            this.thirdFoundationRoomsOptions.push('None');
          }
          this.thirdFoundationRoomsOptions.push('Other');
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
    }
  }

  // Load dropdown options from Projects_Drop table
  private async loadProjectDropdownOptions() {
    try {
      const dropdownData = await this.caspioService.getProjectsDrop().toPromise();

      if (dropdownData && dropdownData.length > 0) {
        const typeOfBuildingSet = new Set<string>();
        const styleSet = new Set<string>();

        dropdownData.forEach((row: any) => {
          if (row.ProjectsName === 'TypeOfBuilding' && row.Dropdown) {
            typeOfBuildingSet.add(row.Dropdown);
          } else if (row.ProjectsName === 'Style' && row.Dropdown) {
            styleSet.add(row.Dropdown);
          }
        });

        this.typeOfBuildingOptions = Array.from(typeOfBuildingSet).sort();
        this.styleOptions = Array.from(styleSet).sort();

        if (!this.typeOfBuildingOptions.includes('Other')) {
          this.typeOfBuildingOptions.push('Other');
        }
        if (!this.styleOptions.includes('Other')) {
          this.styleOptions.push('Other');
        }
      }
    } catch (error) {
      console.error('Error loading Projects_Drop options:', error);
    }
  }

  // Year Built handlers
  onYearBuiltChange(value: string) {
    const cleaned = value.replace(/[^0-9]/g, '');
    this.projectData.YearBuilt = cleaned;
    this.autoSaveProjectField('YearBuilt', cleaned);
  }

  formatYearBuilt() {
    if (this.projectData.YearBuilt) {
      const year = this.projectData.YearBuilt.replace(/[^0-9]/g, '');
      if (year.length === 4) {
        this.projectData.YearBuilt = year;
        this.autoSaveProjectField('YearBuilt', year);
      }
    }
  }

  // Square Feet handlers
  onSquareFeetChange(value: string) {
    const cleaned = value.replace(/[^0-9,]/g, '');
    this.projectData.SquareFeet = cleaned;
    this.autoSaveProjectField('SquareFeet', cleaned);
  }

  formatSquareFeet() {
    if (this.projectData.SquareFeet) {
      const number = this.projectData.SquareFeet.replace(/,/g, '');
      if (number) {
        const formatted = parseInt(number, 10).toLocaleString('en-US');
        this.projectData.SquareFeet = formatted;
      }
    }
  }

  // Project field change handler
  async onProjectFieldChange(fieldName: string, value: any) {
    if (value === 'Other') {
      return;
    }

    this.projectData[fieldName] = value;
    this.autoSaveProjectField(fieldName, value);
  }

  // Service field change handler
  async onServiceFieldChange(fieldName: string, value: any) {
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

  async addInAttendanceOther() {
    const customValue = this.inAttendanceOtherValue?.trim();
    if (!customValue) {
      return;
    }

    // Remove "None" if adding a custom value (mutually exclusive)
    const noneIndex = this.inAttendanceSelections.indexOf('None');
    if (noneIndex > -1) {
      this.inAttendanceSelections.splice(noneIndex, 1);
    }

    // Check if this value already exists in options
    if (this.inAttendanceOptions.includes(customValue)) {
      console.log(`[LBW ProjectDetails] InAttendance option "${customValue}" already exists`);
      // Just select it if not already selected
      if (!this.inAttendanceSelections.includes(customValue)) {
        this.inAttendanceSelections.push(customValue);
      }
    } else {
      // Add the custom value to options (before None and Other)
      const noneOptIndex = this.inAttendanceOptions.indexOf('None');
      if (noneOptIndex > -1) {
        this.inAttendanceOptions.splice(noneOptIndex, 0, customValue);
      } else {
        // Fallback: add before Other
        const otherIndex = this.inAttendanceOptions.indexOf('Other');
        if (otherIndex > -1) {
          this.inAttendanceOptions.splice(otherIndex, 0, customValue);
        } else {
          this.inAttendanceOptions.push(customValue);
        }
      }
      console.log(`[LBW ProjectDetails] Added custom InAttendance option: "${customValue}"`);

      // Select the new custom value
      if (!this.inAttendanceSelections) {
        this.inAttendanceSelections = [];
      }
      this.inAttendanceSelections.push(customValue);
    }

    // Clear the input field for the next entry
    this.inAttendanceOtherValue = '';

    // Save the updated selections
    await this.saveInAttendance();
    this.changeDetectorRef.detectChanges();
  }

  // Legacy method for blur - only save if there's a pending value
  async onInAttendanceOtherChange() {
    // Only add if there's a value (blur without value should do nothing)
    if (this.inAttendanceOtherValue && this.inAttendanceOtherValue.trim()) {
      await this.addInAttendanceOther();
    }
  }

  private async saveInAttendance() {
    const attendanceText = this.inAttendanceSelections.join(', ');
    this.serviceData.InAttendance = attendanceText;
    await this.autoSaveServiceField('InAttendance', attendanceText);
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

  async addSecondFoundationRoomsOther() {
    const customValue = this.secondFoundationRoomsOtherValue?.trim();
    if (!customValue) {
      return;
    }

    // Remove "None" if adding a custom value (mutually exclusive)
    const noneIndex = this.secondFoundationRoomsSelections.indexOf('None');
    if (noneIndex > -1) {
      this.secondFoundationRoomsSelections.splice(noneIndex, 1);
    }

    // Check if this value already exists in options
    if (this.secondFoundationRoomsOptions.includes(customValue)) {
      console.log(`[LBW ProjectDetails] SecondFoundationRooms option "${customValue}" already exists`);
      // Just select it if not already selected
      if (!this.secondFoundationRoomsSelections.includes(customValue)) {
        this.secondFoundationRoomsSelections.push(customValue);
      }
    } else {
      // Add the custom value to options (before None and Other)
      const noneOptIndex = this.secondFoundationRoomsOptions.indexOf('None');
      if (noneOptIndex > -1) {
        this.secondFoundationRoomsOptions.splice(noneOptIndex, 0, customValue);
      } else {
        const otherIndex = this.secondFoundationRoomsOptions.indexOf('Other');
        if (otherIndex > -1) {
          this.secondFoundationRoomsOptions.splice(otherIndex, 0, customValue);
        } else {
          this.secondFoundationRoomsOptions.push(customValue);
        }
      }
      console.log(`[LBW ProjectDetails] Added custom SecondFoundationRooms option: "${customValue}"`);

      // Select the new custom value
      if (!this.secondFoundationRoomsSelections) {
        this.secondFoundationRoomsSelections = [];
      }
      this.secondFoundationRoomsSelections.push(customValue);
    }

    // Clear the input field for the next entry
    this.secondFoundationRoomsOtherValue = '';

    // Save the updated selections
    await this.saveSecondFoundationRooms();
    this.changeDetectorRef.detectChanges();
  }

  async onSecondFoundationRoomsOtherChange() {
    // Only add if there's a value (blur without value should do nothing)
    if (this.secondFoundationRoomsOtherValue && this.secondFoundationRoomsOtherValue.trim()) {
      await this.addSecondFoundationRoomsOther();
    }
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

  async addThirdFoundationRoomsOther() {
    const customValue = this.thirdFoundationRoomsOtherValue?.trim();
    if (!customValue) {
      return;
    }

    // Remove "None" if adding a custom value (mutually exclusive)
    const noneIndex = this.thirdFoundationRoomsSelections.indexOf('None');
    if (noneIndex > -1) {
      this.thirdFoundationRoomsSelections.splice(noneIndex, 1);
    }

    // Check if this value already exists in options
    if (this.thirdFoundationRoomsOptions.includes(customValue)) {
      console.log(`[LBW ProjectDetails] ThirdFoundationRooms option "${customValue}" already exists`);
      // Just select it if not already selected
      if (!this.thirdFoundationRoomsSelections.includes(customValue)) {
        this.thirdFoundationRoomsSelections.push(customValue);
      }
    } else {
      // Add the custom value to options (before None and Other)
      const noneOptIndex = this.thirdFoundationRoomsOptions.indexOf('None');
      if (noneOptIndex > -1) {
        this.thirdFoundationRoomsOptions.splice(noneOptIndex, 0, customValue);
      } else {
        const otherIndex = this.thirdFoundationRoomsOptions.indexOf('Other');
        if (otherIndex > -1) {
          this.thirdFoundationRoomsOptions.splice(otherIndex, 0, customValue);
        } else {
          this.thirdFoundationRoomsOptions.push(customValue);
        }
      }
      console.log(`[LBW ProjectDetails] Added custom ThirdFoundationRooms option: "${customValue}"`);

      // Select the new custom value
      if (!this.thirdFoundationRoomsSelections) {
        this.thirdFoundationRoomsSelections = [];
      }
      this.thirdFoundationRoomsSelections.push(customValue);
    }

    // Clear the input field for the next entry
    this.thirdFoundationRoomsOtherValue = '';

    // Save the updated selections
    await this.saveThirdFoundationRooms();
    this.changeDetectorRef.detectChanges();
  }

  async onThirdFoundationRoomsOtherChange() {
    // Only add if there's a value (blur without value should do nothing)
    if (this.thirdFoundationRoomsOtherValue && this.thirdFoundationRoomsOtherValue.trim()) {
      await this.addThirdFoundationRoomsOther();
    }
  }

  private async saveThirdFoundationRooms() {
    const roomsText = this.thirdFoundationRoomsSelections.join(', ');
    this.serviceData.ThirdFoundationRooms = roomsText;
    await this.autoSaveServiceField('ThirdFoundationRooms', roomsText);
    this.changeDetectorRef.detectChanges();
  }

  // Auto-save to Projects table
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

    // Use PK_ID from loaded project data for API updates (matches mobile app pattern)
    const projectIdForUpdate = this.projectData?.PK_ID || this.projectId;
    this.caspioService.updateProject(projectIdForUpdate, { [fieldName]: value }).subscribe({
      next: () => {
        if (this.offlineService.isOnline()) {
          this.showSaveStatus(`${fieldName} saved`, 'success');
        }
      },
      error: (error) => {
        console.error(`Error saving project field ${fieldName}:`, error);
        this.showSaveStatus(`Failed to save ${fieldName}`, 'error');
      }
    });
  }

  // Auto-save to Services table
  private autoSaveServiceField(fieldName: string, value: any) {
    if (!this.serviceId) {
      console.error(`Cannot save ${fieldName} - No ServiceID! ServiceID is: ${this.serviceId}`);
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

    this.caspioService.updateService(this.serviceId, { [fieldName]: value }).subscribe({
      next: (response) => {
        if (this.offlineService.isOnline()) {
          this.showSaveStatus(`${fieldName} saved`, 'success');
        }
      },
      error: (error) => {
        console.error(`Error saving service field ${fieldName}:`, error);
        this.showSaveStatus(`Failed to save ${fieldName}`, 'error');
      }
    });
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



