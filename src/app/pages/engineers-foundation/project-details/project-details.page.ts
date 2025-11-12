import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { EngineersFoundationStateService, ProjectData } from '../services/engineers-foundation-state.service';

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
  projectData: ProjectData = {};

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
  secondFoundationRoomsOptions: string[] = ['Kitchen', 'Living Room', 'Bedroom', 'Bathroom', 'Garage', 'Other'];
  thirdFoundationRoomsOptions: string[] = ['Kitchen', 'Living Room', 'Bedroom', 'Bathroom', 'Garage', 'Other'];
  ownerOccupantInterviewOptions: string[] = ['Yes', 'No', 'Not Available', 'Other'];

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

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private stateService: EngineersFoundationStateService
  ) {}

  ngOnInit() {
    // Get IDs from parent route
    this.route.parent?.params.subscribe(params => {
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];
    });

    // Subscribe to project data from state service
    this.stateService.projectData$.subscribe(data => {
      this.projectData = { ...data };

      // Initialize multi-select arrays from stored comma-separated strings
      if (this.projectData.inAttendance) {
        this.inAttendanceSelections = this.projectData.inAttendance.split(',').map(s => s.trim()).filter(s => s);
      }
      if (this.projectData.secondFoundationRooms) {
        this.secondFoundationRoomsSelections = this.projectData.secondFoundationRooms.map(s => s.trim()).filter(s => s);
      }
      if (this.projectData.thirdFoundationRooms) {
        this.thirdFoundationRoomsSelections = this.projectData.thirdFoundationRooms.map(s => s.trim()).filter(s => s);
      }
    });
  }

  goBack() {
    this.router.navigate(['..'], { relativeTo: this.route });
  }

  // Generic field change handler
  onProjectFieldChange(field: string, value: any) {
    this.stateService.updateProjectData({ [field]: value });
    this.stateService.saveProjectField(field, value);
  }

  // Year Built handlers
  onYearBuiltChange(value: string) {
    // Remove non-numeric characters
    const cleaned = value.replace(/[^0-9]/g, '');
    this.projectData.yearBuilt = cleaned;
    this.onProjectFieldChange('yearBuilt', cleaned);
  }

  formatYearBuilt() {
    if (this.projectData.yearBuilt) {
      // Ensure 4 digits
      const year = this.projectData.yearBuilt.replace(/[^0-9]/g, '');
      if (year.length === 4) {
        this.projectData.yearBuilt = year;
        this.onProjectFieldChange('yearBuilt', year);
      }
    }
  }

  // Square Feet handlers
  onSquareFeetChange(value: string) {
    // Remove non-numeric characters except comma
    const cleaned = value.replace(/[^0-9,]/g, '');
    this.projectData.squareFeet = cleaned;
    this.onProjectFieldChange('squareFeet', cleaned);
  }

  formatSquareFeet() {
    if (this.projectData.squareFeet) {
      // Remove existing commas and add thousands separator
      const number = this.projectData.squareFeet.replace(/,/g, '');
      if (number) {
        const formatted = parseInt(number, 10).toLocaleString('en-US');
        this.projectData.squareFeet = formatted;
        this.onProjectFieldChange('squareFeet', formatted);
      }
    }
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

  onInAttendanceToggle(option: string, event: any) {
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

    this.saveInAttendance();
  }

  onInAttendanceOtherChange() {
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
    this.saveInAttendance();
  }

  private saveInAttendance() {
    const attendanceText = this.inAttendanceSelections.join(', ');
    this.onProjectFieldChange('inAttendance', attendanceText);
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

  onSecondFoundationRoomsToggle(option: string, event: any) {
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

    this.saveSecondFoundationRooms();
  }

  onSecondFoundationRoomsOtherChange() {
    if (this.secondFoundationRoomsOtherValue && this.secondFoundationRoomsOtherValue.trim()) {
      const otherIndex = this.secondFoundationRoomsSelections.indexOf('Other');
      if (otherIndex > -1) {
        this.secondFoundationRoomsSelections[otherIndex] = this.secondFoundationRoomsOtherValue.trim();
      } else {
        this.secondFoundationRoomsSelections.push(this.secondFoundationRoomsOtherValue.trim());
      }
    }
    this.saveSecondFoundationRooms();
  }

  private saveSecondFoundationRooms() {
    this.onProjectFieldChange('secondFoundationRooms', this.secondFoundationRoomsSelections);
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

  onThirdFoundationRoomsToggle(option: string, event: any) {
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

    this.saveThirdFoundationRooms();
  }

  onThirdFoundationRoomsOtherChange() {
    if (this.thirdFoundationRoomsOtherValue && this.thirdFoundationRoomsOtherValue.trim()) {
      const otherIndex = this.thirdFoundationRoomsSelections.indexOf('Other');
      if (otherIndex > -1) {
        this.thirdFoundationRoomsSelections[otherIndex] = this.thirdFoundationRoomsOtherValue.trim();
      } else {
        this.thirdFoundationRoomsSelections.push(this.thirdFoundationRoomsOtherValue.trim());
      }
    }
    this.saveThirdFoundationRooms();
  }

  private saveThirdFoundationRooms() {
    this.onProjectFieldChange('thirdFoundationRooms', this.thirdFoundationRoomsSelections);
  }

  // "Other" value change handlers for dropdowns
  onTypeOfBuildingOtherChange() {
    if (this.typeOfBuildingOtherValue && this.typeOfBuildingOtherValue.trim()) {
      const customValue = this.typeOfBuildingOtherValue.trim();
      this.onProjectFieldChange('buildingType', customValue);
    }
  }

  onStyleOtherChange() {
    if (this.styleOtherValue && this.styleOtherValue.trim()) {
      const customValue = this.styleOtherValue.trim();
      this.onProjectFieldChange('style', customValue);
    }
  }

  onOccupancyFurnishingsOtherChange() {
    if (this.occupancyFurnishingsOtherValue && this.occupancyFurnishingsOtherValue.trim()) {
      const customValue = this.occupancyFurnishingsOtherValue.trim();
      this.onProjectFieldChange('occupancyStatus', customValue);
    }
  }

  onWeatherConditionsOtherChange() {
    if (this.weatherConditionsOtherValue && this.weatherConditionsOtherValue.trim()) {
      const customValue = this.weatherConditionsOtherValue.trim();
      this.onProjectFieldChange('weatherConditions', customValue);
    }
  }

  onOutdoorTemperatureOtherChange() {
    if (this.outdoorTemperatureOtherValue && this.outdoorTemperatureOtherValue.trim()) {
      const customValue = this.outdoorTemperatureOtherValue.trim();
      this.onProjectFieldChange('outdoorTemp', customValue);
    }
  }

  onFirstFoundationTypeOtherChange() {
    if (this.firstFoundationTypeOtherValue && this.firstFoundationTypeOtherValue.trim()) {
      const customValue = this.firstFoundationTypeOtherValue.trim();
      this.onProjectFieldChange('firstFoundationType', customValue);
    }
  }

  onSecondFoundationTypeOtherChange() {
    if (this.secondFoundationTypeOtherValue && this.secondFoundationTypeOtherValue.trim()) {
      const customValue = this.secondFoundationTypeOtherValue.trim();
      this.onProjectFieldChange('secondFoundationType', customValue);
    }
  }

  onThirdFoundationTypeOtherChange() {
    if (this.thirdFoundationTypeOtherValue && this.thirdFoundationTypeOtherValue.trim()) {
      const customValue = this.thirdFoundationTypeOtherValue.trim();
      this.onProjectFieldChange('thirdFoundationType', customValue);
    }
  }

  onOwnerOccupantInterviewOtherChange() {
    if (this.ownerOccupantInterviewOtherValue && this.ownerOccupantInterviewOtherValue.trim()) {
      const customValue = this.ownerOccupantInterviewOtherValue.trim();
      this.onProjectFieldChange('ownerInterview', customValue);
    }
  }
}
