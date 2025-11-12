import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { EngineersFoundationStateService, ProjectData } from '../services/engineers-foundation-state.service';
import { CaspioService } from '../../../services/caspio.service';
import { OfflineService } from '../../../services/offline.service';

@Component({
  selector: 'app-project-details',
  templateUrl: './project-details.page.html',
  styleUrls: ['./project-details.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class ProjectDetailsPage implements OnInit {
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
    private changeDetectorRef: ChangeDetectorRef
  ) {}

  async ngOnInit() {
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

          // Ensure dropdown fields have empty string instead of null/undefined for "-- Select --" to show
          if (!this.projectData.Style) {
            this.projectData.Style = '';
          }
          if (!this.projectData.TypeOfBuilding) {
            this.projectData.TypeOfBuilding = '';
          }

          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          console.error('Error loading project:', error);
        }
      });

      // Load service data
      this.caspioService.getService(this.serviceId).subscribe({
        next: (service) => {
          this.serviceData = service || {};

          // Ensure dropdown fields have empty string instead of null/undefined for "-- Select --" to show
          if (!this.serviceData.OccupancyFurnishings) {
            this.serviceData.OccupancyFurnishings = '';
          }
          if (!this.serviceData.WeatherConditions) {
            this.serviceData.WeatherConditions = '';
          }
          if (!this.serviceData.OutdoorTemperature) {
            this.serviceData.OutdoorTemperature = '';
          }
          if (!this.serviceData.FirstFoundationType) {
            this.serviceData.FirstFoundationType = '';
          }
          if (!this.serviceData.SecondFoundationType) {
            this.serviceData.SecondFoundationType = '';
          }
          if (!this.serviceData.ThirdFoundationType) {
            this.serviceData.ThirdFoundationType = '';
          }
          if (!this.serviceData.OwnerOccupantInterview) {
            this.serviceData.OwnerOccupantInterview = '';
          }

          // Initialize multi-select arrays from stored comma-separated strings
          if (this.serviceData.InAttendance) {
            this.inAttendanceSelections = this.serviceData.InAttendance.split(',').map((s: string) => s.trim()).filter((s: string) => s);
          }
          if (this.serviceData.SecondFoundationRooms) {
            this.secondFoundationRoomsSelections = this.serviceData.SecondFoundationRooms.split(',').map((s: string) => s.trim()).filter((s: string) => s);
          }
          if (this.serviceData.ThirdFoundationRooms) {
            this.thirdFoundationRoomsSelections = this.serviceData.ThirdFoundationRooms.split(',').map((s: string) => s.trim()).filter((s: string) => s);
          }

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

  goBack() {
    this.router.navigate(['..'], { relativeTo: this.route });
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

    // Update the Projects table directly
    this.caspioService.updateProject(this.projectId, { [fieldName]: value }).subscribe({
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

    // Update the Services table directly
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
