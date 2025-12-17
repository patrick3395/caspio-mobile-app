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

  // Dropdown options - empty by default, populated from LPS_Services_Drop API
  inAttendanceOptions: string[] = [];
  typeOfBuildingOptions: string[] = [];
  styleOptions: string[] = [];
  occupancyFurnishingsOptions: string[] = [];
  weatherConditionsOptions: string[] = [];
  outdoorTemperatureOptions: string[] = [];
  firstFoundationTypeOptions: string[] = [];
  secondFoundationTypeOptions: string[] = [];
  thirdFoundationTypeOptions: string[] = [];
  secondFoundationRoomsOptions: string[] = [];
  thirdFoundationRoomsOptions: string[] = [];
  ownerOccupantInterviewOptions: string[] = [];

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

  /**
   * Normalize string for comparison - handles different degree symbols and whitespace
   */
  private normalizeForComparison(str: string): string {
    if (!str) return '';
    // Replace various degree-like symbols with standard degree
    // U+00B0 (°), U+02DA (˚), U+00BA (º) all become °
    return str.trim()
      .replace(/[\u02DA\u00BA]/g, '°')  // Ring above and masculine ordinal to degree
      .replace(/\s+/g, ' ')              // Normalize whitespace
      .toLowerCase();
  }

  /**
   * Check if options array includes a value (with normalized comparison)
   */
  private optionsIncludeNormalized(options: string[], value: string): boolean {
    const normalizedValue = this.normalizeForComparison(value);
    return options.some(opt => this.normalizeForComparison(opt) === normalizedValue);
  }

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
    console.log('[ProjectDetails] ngOnInit() called');

    // Load dropdown options from database tables (non-blocking for offline support)
    this.loadDropdownOptions();
    this.loadProjectDropdownOptions();

    // Get IDs from parent route snapshot immediately (for offline reliability)
    const parentParams = this.route.parent?.snapshot?.params;
    console.log('[ProjectDetails] parentParams from snapshot:', parentParams);
    if (parentParams) {
      this.projectId = parentParams['projectId'] || '';
      this.serviceId = parentParams['serviceId'] || '';
      console.log('[ProjectDetails] Got params from snapshot:', this.projectId, this.serviceId);

      if (this.projectId && this.serviceId) {
        console.log('[ProjectDetails] Calling loadData() from SNAPSHOT');
        this.loadData();
      }
    }

    // Also subscribe to param changes (for dynamic updates)
    this.route.parent?.params.subscribe(params => {
      console.log('[ProjectDetails] params.subscribe fired with:', params);
      const newProjectId = params['projectId'];
      const newServiceId = params['serviceId'];
      console.log('[ProjectDetails] newProjectId:', newProjectId, 'newServiceId:', newServiceId);
      console.log('[ProjectDetails] current projectId:', this.projectId, 'current serviceId:', this.serviceId);

      // Only reload if IDs changed
      if (newProjectId !== this.projectId || newServiceId !== this.serviceId) {
        console.log('[ProjectDetails] IDs CHANGED - calling loadData() from SUBSCRIPTION');
        this.projectId = newProjectId;
        this.serviceId = newServiceId;
        this.loadData();
      } else {
        console.log('[ProjectDetails] IDs unchanged - NOT reloading');
      }
    });

    // Note: We don't reload on sync complete - IndexedDB already has the correct data
    // The user's changes were saved to IndexedDB when they made them
  }

  ngOnDestroy() {
    // Cleanup if needed
  }

  private loadDataCallCount = 0;

  private async loadData() {
    this.loadDataCallCount++;
    const callNum = this.loadDataCallCount;
    console.log(`[ProjectDetails] ========== loadData() CALL #${callNum} ==========`);
    console.log(`[ProjectDetails] loadData() #${callNum}: projectId=${this.projectId}, serviceId=${this.serviceId}`);

    try {
      // OFFLINE-FIRST: Try IndexedDB first for both project and service data
      await Promise.all([
        this.loadProjectData(),
        this.loadServiceData()
      ]);
      console.log(`[ProjectDetails] loadData() #${callNum}: COMPLETED`);
    } catch (error) {
      console.error(`[ProjectDetails] loadData() #${callNum}: ERROR:`, error);
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

    // NOTE: Don't convert values to "Other" here - the dropdown options haven't loaded yet from API
    // The loadProjectDropdownOptions() will handle adding any missing values to the options arrays
    // Just initialize empty values to empty strings
    if (!this.projectData.TypeOfBuilding) this.projectData.TypeOfBuilding = '';
    if (!this.projectData.Style) this.projectData.Style = '';

    this.changeDetectorRef.detectChanges();
  }

  private async loadServiceData() {
    console.log(`[ProjectDetails] loadServiceData() called for serviceId=${this.serviceId}`);

    // Try IndexedDB first - this is the source of truth for offline-first
    let service = await this.offlineTemplate.getService(this.serviceId);

    console.log(`[ProjectDetails] getService(${this.serviceId}) returned:`, service);
    console.log(`[ProjectDetails] service fields:`, service ? Object.keys(service) : 'null');

    if (service) {
      console.log('[ProjectDetails] Loaded service from IndexedDB cache');
      console.log('[ProjectDetails] FirstFoundationType =', service.FirstFoundationType);
      console.log('[ProjectDetails] OccupancyFurnishings =', service.OccupancyFurnishings);
      console.log('[ProjectDetails] WeatherConditions =', service.WeatherConditions);
    } else {
      // Only fetch from API if IndexedDB has nothing at all
      console.log('[ProjectDetails] Service not in cache, fetching from API...');
      try {
        const freshService = await this.caspioService.getService(this.serviceId, false).toPromise();
        console.log('[ProjectDetails] API returned:', freshService);
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
    if (!service || Object.keys(service).length === 0) {
      console.error('[ProjectDetails] ⚠️ WARNING: serviceData set to EMPTY! service was:', service);
      console.trace('[ProjectDetails] Stack trace for empty serviceData:');
    }
    console.log('[ProjectDetails] this.serviceData set to:', JSON.stringify(this.serviceData).substring(0, 300));

    // NOTE: Don't convert values to "Other" here - the dropdown options haven't loaded yet from API
    // The loadDropdownOptions() will handle adding any missing values to the options arrays
    // Just initialize empty values to empty strings
    if (!this.serviceData.OccupancyFurnishings) this.serviceData.OccupancyFurnishings = '';
    if (!this.serviceData.WeatherConditions) this.serviceData.WeatherConditions = '';
    if (!this.serviceData.OutdoorTemperature) this.serviceData.OutdoorTemperature = '';
    if (!this.serviceData.FirstFoundationType) this.serviceData.FirstFoundationType = '';
    if (!this.serviceData.SecondFoundationType) this.serviceData.SecondFoundationType = '';
    if (!this.serviceData.ThirdFoundationType) this.serviceData.ThirdFoundationType = '';
    if (!this.serviceData.OwnerOccupantInterview) this.serviceData.OwnerOccupantInterview = '';

    // Initialize multi-select arrays from stored comma-separated strings
    // Don't filter out values - loadDropdownOptions() will add them to the options if needed
    if (this.serviceData.InAttendance) {
      this.inAttendanceSelections = this.serviceData.InAttendance.split(',').map((s: string) => s.trim()).filter((s: string) => s);
    }

    if (this.serviceData.SecondFoundationRooms) {
      this.secondFoundationRoomsSelections = this.serviceData.SecondFoundationRooms.split(',').map((s: string) => s.trim()).filter((s: string) => s);
    }

    if (this.serviceData.ThirdFoundationRooms) {
      this.thirdFoundationRoomsSelections = this.serviceData.ThirdFoundationRooms.split(',').map((s: string) => s.trim()).filter((s: string) => s);
    }

    // FINAL STATE LOG
    console.log('[ProjectDetails] loadServiceData COMPLETE - Final serviceData state:');
    console.log('[ProjectDetails]   FirstFoundationType =', this.serviceData.FirstFoundationType);
    console.log('[ProjectDetails]   OccupancyFurnishings =', this.serviceData.OccupancyFurnishings);
    console.log('[ProjectDetails]   WeatherConditions =', this.serviceData.WeatherConditions);
    console.log('[ProjectDetails]   OutdoorTemperature =', this.serviceData.OutdoorTemperature);
    console.log('[ProjectDetails]   InAttendance =', this.serviceData.InAttendance);

    this.changeDetectorRef.detectChanges();
  }

  // Load dropdown options from Services_Drop table (OFFLINE-FIRST)
  private async loadDropdownOptions() {
    console.log('[ProjectDetails] loadDropdownOptions() called');
    try {
      // OFFLINE-FIRST: Use OfflineTemplateService which reads from IndexedDB
      const servicesDropData = await this.offlineTemplate.getServicesDrop();
      console.log('[ProjectDetails] loadDropdownOptions(): got data, servicesDropData.length =', servicesDropData?.length);
      
      // Debug: Log all unique ServicesName values to see what's available
      if (servicesDropData && servicesDropData.length > 0) {
        const uniqueServiceNames = [...new Set(servicesDropData.map((row: any) => row.ServicesName))];
        console.log('[ProjectDetails] Available ServicesName values:', uniqueServiceNames);
      }

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
          const currentValue = this.serviceData?.WeatherConditions;
          this.weatherConditionsOptions = optionsByService['WeatherConditions'];
          if (!this.weatherConditionsOptions.includes('Other')) {
            this.weatherConditionsOptions.push('Other');
          }
          // Handle current value - either normalize to match option or add to options
          if (currentValue && currentValue !== 'Other') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.weatherConditionsOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              console.log(`[ProjectDetails] Normalizing WeatherConditions: "${currentValue}" -> "${matchingOption}"`);
              this.serviceData.WeatherConditions = matchingOption;
            } else if (!matchingOption) {
              console.log(`[ProjectDetails] Adding missing WeatherConditions value to options: "${currentValue}"`);
              this.weatherConditionsOptions.unshift(currentValue);
            }
          }
        }

        // Set Outdoor Temperature options
        if (optionsByService['OutdoorTemperature'] && optionsByService['OutdoorTemperature'].length > 0) {
          const currentValue = this.serviceData?.OutdoorTemperature;
          this.outdoorTemperatureOptions = optionsByService['OutdoorTemperature'];
          if (!this.outdoorTemperatureOptions.includes('Other')) {
            this.outdoorTemperatureOptions.push('Other');
          }
          // Handle current value - either normalize to match option or add to options
          if (currentValue && currentValue !== 'Other') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.outdoorTemperatureOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              // Option exists with different encoding - update value to match
              console.log(`[ProjectDetails] Normalizing OutdoorTemperature: "${currentValue}" -> "${matchingOption}"`);
              this.serviceData.OutdoorTemperature = matchingOption;
            } else if (!matchingOption) {
              // Value truly not in options - add it
              console.log(`[ProjectDetails] Adding missing OutdoorTemperature value to options: "${currentValue}"`);
              this.outdoorTemperatureOptions.unshift(currentValue);
            }
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
          const currentValue = this.serviceData?.OccupancyFurnishings;
          this.occupancyFurnishingsOptions = optionsByService['OccupancyFurnishings'];
          if (!this.occupancyFurnishingsOptions.includes('Other')) {
            this.occupancyFurnishingsOptions.push('Other');
          }
          // Handle current value - either normalize to match option or add to options
          if (currentValue && currentValue !== 'Other') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.occupancyFurnishingsOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              console.log(`[ProjectDetails] Normalizing OccupancyFurnishings: "${currentValue}" -> "${matchingOption}"`);
              this.serviceData.OccupancyFurnishings = matchingOption;
            } else if (!matchingOption) {
              console.log(`[ProjectDetails] Adding missing OccupancyFurnishings value to options: "${currentValue}"`);
              this.occupancyFurnishingsOptions.unshift(currentValue);
            }
          }
        }

        // Set InAttendance options (multi-select - preserve current selections)
        if (optionsByService['InAttendance'] && optionsByService['InAttendance'].length > 0) {
          this.inAttendanceOptions = optionsByService['InAttendance'];
          if (!this.inAttendanceOptions.includes('Other')) {
            this.inAttendanceOptions.push('Other');
          }
          // Normalize selections to match API options, or add if truly missing
          if (this.inAttendanceSelections && this.inAttendanceSelections.length > 0) {
            this.inAttendanceSelections = this.inAttendanceSelections.map(selection => {
              if (!selection || selection === 'Other') return selection;
              const normalizedSelection = this.normalizeForComparison(selection);
              const matchingOption = this.inAttendanceOptions.find(opt =>
                this.normalizeForComparison(opt) === normalizedSelection
              );
              if (matchingOption) {
                if (matchingOption !== selection) {
                  console.log(`[ProjectDetails] Normalizing InAttendance selection: "${selection}" -> "${matchingOption}"`);
                }
                return matchingOption;
              } else {
                // Add missing selection to options (before Other)
                console.log(`[ProjectDetails] Adding missing InAttendance selection to options: "${selection}"`);
                const otherIndex = this.inAttendanceOptions.indexOf('Other');
                if (otherIndex > 0) {
                  this.inAttendanceOptions.splice(otherIndex, 0, selection);
                } else {
                  this.inAttendanceOptions.push(selection);
                }
                return selection;
              }
            });
          }
          // Sort options alphabetically, keeping "Other" at the end
          const otherOption = this.inAttendanceOptions.includes('Other') ? 'Other' : null;
          this.inAttendanceOptions = this.inAttendanceOptions
            .filter(opt => opt !== 'Other')
            .sort((a, b) => a.localeCompare(b));
          if (otherOption) {
            this.inAttendanceOptions.push(otherOption);
          }
        }

        // Set FirstFoundationType options
        if (optionsByService['FirstFoundationType'] && optionsByService['FirstFoundationType'].length > 0) {
          const currentValue = this.serviceData?.FirstFoundationType;
          this.firstFoundationTypeOptions = optionsByService['FirstFoundationType'];
          if (!this.firstFoundationTypeOptions.includes('Other')) {
            this.firstFoundationTypeOptions.push('Other');
          }
          // Handle current value - either normalize to match option or add to options
          if (currentValue && currentValue !== 'Other') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.firstFoundationTypeOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              console.log(`[ProjectDetails] Normalizing FirstFoundationType: "${currentValue}" -> "${matchingOption}"`);
              this.serviceData.FirstFoundationType = matchingOption;
            } else if (!matchingOption) {
              console.log(`[ProjectDetails] Adding missing FirstFoundationType value to options: "${currentValue}"`);
              this.firstFoundationTypeOptions.unshift(currentValue);
            }
          }
        }

        // Set SecondFoundationType options (fall back to FirstFoundationType options if not available)
        const secondFoundationTypeSource = optionsByService['SecondFoundationType'] || optionsByService['FirstFoundationType'];
        if (secondFoundationTypeSource && secondFoundationTypeSource.length > 0) {
          const currentValue = this.serviceData?.SecondFoundationType;
          this.secondFoundationTypeOptions = [...secondFoundationTypeSource]; // Clone to avoid mutation
          if (!this.secondFoundationTypeOptions.includes('Other')) {
            this.secondFoundationTypeOptions.push('Other');
          }
          // Handle current value - either normalize to match option or add to options
          if (currentValue && currentValue !== 'Other' && currentValue !== 'None' && currentValue !== '') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.secondFoundationTypeOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              console.log(`[ProjectDetails] Normalizing SecondFoundationType: "${currentValue}" -> "${matchingOption}"`);
              this.serviceData.SecondFoundationType = matchingOption;
            } else if (!matchingOption) {
              console.log(`[ProjectDetails] Adding missing SecondFoundationType value to options: "${currentValue}"`);
              this.secondFoundationTypeOptions.unshift(currentValue);
            }
          }
        }

        // Set ThirdFoundationType options (fall back to FirstFoundationType options if not available)
        const thirdFoundationTypeSource = optionsByService['ThirdFoundationType'] || optionsByService['FirstFoundationType'];
        if (thirdFoundationTypeSource && thirdFoundationTypeSource.length > 0) {
          const currentValue = this.serviceData?.ThirdFoundationType;
          this.thirdFoundationTypeOptions = [...thirdFoundationTypeSource]; // Clone to avoid mutation
          if (!this.thirdFoundationTypeOptions.includes('Other')) {
            this.thirdFoundationTypeOptions.push('Other');
          }
          // Handle current value - either normalize to match option or add to options
          if (currentValue && currentValue !== 'Other' && currentValue !== 'None' && currentValue !== '') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.thirdFoundationTypeOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              console.log(`[ProjectDetails] Normalizing ThirdFoundationType: "${currentValue}" -> "${matchingOption}"`);
              this.serviceData.ThirdFoundationType = matchingOption;
            } else if (!matchingOption) {
              console.log(`[ProjectDetails] Adding missing ThirdFoundationType value to options: "${currentValue}"`);
              this.thirdFoundationTypeOptions.unshift(currentValue);
            }
          }
        }

        // Set SecondFoundationRooms options (multi-select - fall back to room options if not available)
        const secondFoundationRoomsSource = optionsByService['SecondFoundationRooms'] || optionsByService['FoundationRooms'] || optionsByService['ThirdFoundationRooms'];
        if (secondFoundationRoomsSource && secondFoundationRoomsSource.length > 0) {
          this.secondFoundationRoomsOptions = [...secondFoundationRoomsSource]; // Clone
          if (!this.secondFoundationRoomsOptions.includes('Other')) {
            this.secondFoundationRoomsOptions.push('Other');
          }
          // Normalize selections to match API options, or add if truly missing
          if (this.secondFoundationRoomsSelections && this.secondFoundationRoomsSelections.length > 0) {
            this.secondFoundationRoomsSelections = this.secondFoundationRoomsSelections.map(selection => {
              if (!selection || selection === 'Other') return selection;
              const normalizedSelection = this.normalizeForComparison(selection);
              const matchingOption = this.secondFoundationRoomsOptions.find(opt =>
                this.normalizeForComparison(opt) === normalizedSelection
              );
              if (matchingOption) {
                if (matchingOption !== selection) {
                  console.log(`[ProjectDetails] Normalizing SecondFoundationRooms selection: "${selection}" -> "${matchingOption}"`);
                }
                return matchingOption;
              } else {
                // Add missing selection to options (before Other)
                console.log(`[ProjectDetails] Adding missing SecondFoundationRooms selection to options: "${selection}"`);
                const otherIndex = this.secondFoundationRoomsOptions.indexOf('Other');
                if (otherIndex > 0) {
                  this.secondFoundationRoomsOptions.splice(otherIndex, 0, selection);
                } else {
                  this.secondFoundationRoomsOptions.push(selection);
                }
                return selection;
              }
            });
          }
          // Sort options alphabetically, keeping "Other" at the end
          const otherOption = this.secondFoundationRoomsOptions.includes('Other') ? 'Other' : null;
          this.secondFoundationRoomsOptions = this.secondFoundationRoomsOptions
            .filter(opt => opt !== 'Other')
            .sort((a, b) => a.localeCompare(b));
          if (otherOption) {
            this.secondFoundationRoomsOptions.push(otherOption);
          }
        }

        // Set ThirdFoundationRooms options (multi-select - fall back to room options if not available)
        const thirdFoundationRoomsSource = optionsByService['ThirdFoundationRooms'] || optionsByService['FoundationRooms'] || optionsByService['SecondFoundationRooms'];
        if (thirdFoundationRoomsSource && thirdFoundationRoomsSource.length > 0) {
          this.thirdFoundationRoomsOptions = [...thirdFoundationRoomsSource]; // Clone
          if (!this.thirdFoundationRoomsOptions.includes('Other')) {
            this.thirdFoundationRoomsOptions.push('Other');
          }
          // Normalize selections to match API options, or add if truly missing
          if (this.thirdFoundationRoomsSelections && this.thirdFoundationRoomsSelections.length > 0) {
            this.thirdFoundationRoomsSelections = this.thirdFoundationRoomsSelections.map(selection => {
              if (!selection || selection === 'Other') return selection;
              const normalizedSelection = this.normalizeForComparison(selection);
              const matchingOption = this.thirdFoundationRoomsOptions.find(opt =>
                this.normalizeForComparison(opt) === normalizedSelection
              );
              if (matchingOption) {
                if (matchingOption !== selection) {
                  console.log(`[ProjectDetails] Normalizing ThirdFoundationRooms selection: "${selection}" -> "${matchingOption}"`);
                }
                return matchingOption;
              } else {
                // Add missing selection to options (before Other)
                console.log(`[ProjectDetails] Adding missing ThirdFoundationRooms selection to options: "${selection}"`);
                const otherIndex = this.thirdFoundationRoomsOptions.indexOf('Other');
                if (otherIndex > 0) {
                  this.thirdFoundationRoomsOptions.splice(otherIndex, 0, selection);
                } else {
                  this.thirdFoundationRoomsOptions.push(selection);
                }
                return selection;
              }
            });
          }
          // Sort options alphabetically, keeping "Other" at the end
          const otherOption = this.thirdFoundationRoomsOptions.includes('Other') ? 'Other' : null;
          this.thirdFoundationRoomsOptions = this.thirdFoundationRoomsOptions
            .filter(opt => opt !== 'Other')
            .sort((a, b) => a.localeCompare(b));
          if (otherOption) {
            this.thirdFoundationRoomsOptions.push(otherOption);
          }
        }

        // Set OwnerOccupantInterview options
        if (optionsByService['OwnerOccupantInterview'] && optionsByService['OwnerOccupantInterview'].length > 0) {
          const currentValue = this.serviceData?.OwnerOccupantInterview;
          this.ownerOccupantInterviewOptions = optionsByService['OwnerOccupantInterview'];
          if (!this.ownerOccupantInterviewOptions.includes('Other')) {
            this.ownerOccupantInterviewOptions.push('Other');
          }
          // Handle current value - either normalize to match option or add to options
          if (currentValue && currentValue !== 'Other') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.ownerOccupantInterviewOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              console.log(`[ProjectDetails] Normalizing OwnerOccupantInterview: "${currentValue}" -> "${matchingOption}"`);
              this.serviceData.OwnerOccupantInterview = matchingOption;
            } else if (!matchingOption) {
              console.log(`[ProjectDetails] Adding missing OwnerOccupantInterview value to options: "${currentValue}"`);
              this.ownerOccupantInterviewOptions.unshift(currentValue);
            }
          }
        }
        console.log('[ProjectDetails] loadDropdownOptions(): Options loaded, forcing change detection');
        this.changeDetectorRef.detectChanges();
      }
    } catch (error) {
      console.error('Error loading Services_Drop options:', error);
      // Keep default options on error
    }
  }

  // Load dropdown options from Projects_Drop table (OFFLINE-FIRST)
  private async loadProjectDropdownOptions() {
    try {
      // OFFLINE-FIRST: Use OfflineTemplateService which reads from IndexedDB
      const dropdownData = await this.offlineTemplate.getProjectsDrop();

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

        // Preserve current TypeOfBuilding value if not in API options
        if (this.projectData.TypeOfBuilding &&
            this.projectData.TypeOfBuilding !== 'Other' &&
            !this.optionsIncludeNormalized(this.typeOfBuildingOptions, this.projectData.TypeOfBuilding)) {
          console.log(`[ProjectDetails] Adding missing TypeOfBuilding value to options: "${this.projectData.TypeOfBuilding}"`);
          const otherIndex = this.typeOfBuildingOptions.indexOf('Other');
          if (otherIndex > 0) {
            this.typeOfBuildingOptions.splice(otherIndex, 0, this.projectData.TypeOfBuilding);
          } else {
            this.typeOfBuildingOptions.push(this.projectData.TypeOfBuilding);
          }
        }

        // Preserve current Style value if not in API options
        if (this.projectData.Style &&
            this.projectData.Style !== 'Other' &&
            !this.optionsIncludeNormalized(this.styleOptions, this.projectData.Style)) {
          console.log(`[ProjectDetails] Adding missing Style value to options: "${this.projectData.Style}"`);
          const otherIndex = this.styleOptions.indexOf('Other');
          if (otherIndex > 0) {
            this.styleOptions.splice(otherIndex, 0, this.projectData.Style);
          } else {
            this.styleOptions.push(this.projectData.Style);
          }
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
  // CRITICAL: Must add custom value to options AND update the data field
  async onTypeOfBuildingOtherChange() {
    if (this.typeOfBuildingOtherValue && this.typeOfBuildingOtherValue.trim()) {
      const customValue = this.typeOfBuildingOtherValue.trim();
      
      // Add custom value to options (before "Other")
      if (!this.typeOfBuildingOptions.includes(customValue)) {
        const otherIndex = this.typeOfBuildingOptions.indexOf('Other');
        if (otherIndex > -1) {
          this.typeOfBuildingOptions.splice(otherIndex, 0, customValue);
        } else {
          this.typeOfBuildingOptions.push(customValue);
        }
      }
      
      // Update dropdown to show the custom value
      this.projectData.TypeOfBuilding = customValue;
      
      // Save to database
      this.autoSaveProjectField('TypeOfBuilding', customValue);
      
      // Clear the other input
      this.typeOfBuildingOtherValue = '';
      
      this.changeDetectorRef.detectChanges();
    }
  }

  async onStyleOtherChange() {
    if (this.styleOtherValue && this.styleOtherValue.trim()) {
      const customValue = this.styleOtherValue.trim();
      
      // Add custom value to options (before "Other")
      if (!this.styleOptions.includes(customValue)) {
        const otherIndex = this.styleOptions.indexOf('Other');
        if (otherIndex > -1) {
          this.styleOptions.splice(otherIndex, 0, customValue);
        } else {
          this.styleOptions.push(customValue);
        }
      }
      
      // Update dropdown to show the custom value
      this.projectData.Style = customValue;
      
      // Save to database
      this.autoSaveProjectField('Style', customValue);
      
      // Clear the other input
      this.styleOtherValue = '';
      
      this.changeDetectorRef.detectChanges();
    }
  }

  async onOccupancyFurnishingsOtherChange() {
    if (this.occupancyFurnishingsOtherValue && this.occupancyFurnishingsOtherValue.trim()) {
      const customValue = this.occupancyFurnishingsOtherValue.trim();
      
      // Add custom value to options (before "Other")
      if (!this.occupancyFurnishingsOptions.includes(customValue)) {
        const otherIndex = this.occupancyFurnishingsOptions.indexOf('Other');
        if (otherIndex > -1) {
          this.occupancyFurnishingsOptions.splice(otherIndex, 0, customValue);
        } else {
          this.occupancyFurnishingsOptions.push(customValue);
        }
      }
      
      // Update dropdown to show the custom value
      this.serviceData.OccupancyFurnishings = customValue;
      
      // Save to database
      this.autoSaveServiceField('OccupancyFurnishings', customValue);
      
      // Clear the other input
      this.occupancyFurnishingsOtherValue = '';
      
      this.changeDetectorRef.detectChanges();
    }
  }

  async onWeatherConditionsOtherChange() {
    if (this.weatherConditionsOtherValue && this.weatherConditionsOtherValue.trim()) {
      const customValue = this.weatherConditionsOtherValue.trim();
      
      // Add custom value to options (before "Other")
      if (!this.weatherConditionsOptions.includes(customValue)) {
        const otherIndex = this.weatherConditionsOptions.indexOf('Other');
        if (otherIndex > -1) {
          this.weatherConditionsOptions.splice(otherIndex, 0, customValue);
        } else {
          this.weatherConditionsOptions.push(customValue);
        }
      }
      
      // Update dropdown to show the custom value
      this.serviceData.WeatherConditions = customValue;
      
      // Save to database
      this.autoSaveServiceField('WeatherConditions', customValue);
      
      // Clear the other input
      this.weatherConditionsOtherValue = '';
      
      this.changeDetectorRef.detectChanges();
    }
  }

  async onOutdoorTemperatureOtherChange() {
    if (this.outdoorTemperatureOtherValue && this.outdoorTemperatureOtherValue.trim()) {
      const customValue = this.outdoorTemperatureOtherValue.trim();
      
      // Add custom value to options (before "Other")
      if (!this.outdoorTemperatureOptions.includes(customValue)) {
        const otherIndex = this.outdoorTemperatureOptions.indexOf('Other');
        if (otherIndex > -1) {
          this.outdoorTemperatureOptions.splice(otherIndex, 0, customValue);
        } else {
          this.outdoorTemperatureOptions.push(customValue);
        }
      }
      
      // Update dropdown to show the custom value
      this.serviceData.OutdoorTemperature = customValue;
      
      // Save to database
      this.autoSaveServiceField('OutdoorTemperature', customValue);
      
      // Clear the other input
      this.outdoorTemperatureOtherValue = '';
      
      this.changeDetectorRef.detectChanges();
    }
  }

  async onFirstFoundationTypeOtherChange() {
    if (this.firstFoundationTypeOtherValue && this.firstFoundationTypeOtherValue.trim()) {
      const customValue = this.firstFoundationTypeOtherValue.trim();
      
      // Add custom value to options (before "Other")
      if (!this.firstFoundationTypeOptions.includes(customValue)) {
        const otherIndex = this.firstFoundationTypeOptions.indexOf('Other');
        if (otherIndex > -1) {
          this.firstFoundationTypeOptions.splice(otherIndex, 0, customValue);
        } else {
          this.firstFoundationTypeOptions.push(customValue);
        }
      }
      
      // Update dropdown to show the custom value
      this.serviceData.FirstFoundationType = customValue;
      
      // Save to database
      this.autoSaveServiceField('FirstFoundationType', customValue);
      
      // Clear the other input
      this.firstFoundationTypeOtherValue = '';
      
      this.changeDetectorRef.detectChanges();
    }
  }

  async onSecondFoundationTypeOtherChange() {
    if (this.secondFoundationTypeOtherValue && this.secondFoundationTypeOtherValue.trim()) {
      const customValue = this.secondFoundationTypeOtherValue.trim();
      
      // Add custom value to options (before "Other")
      if (!this.secondFoundationTypeOptions.includes(customValue)) {
        const otherIndex = this.secondFoundationTypeOptions.indexOf('Other');
        if (otherIndex > -1) {
          this.secondFoundationTypeOptions.splice(otherIndex, 0, customValue);
        } else {
          this.secondFoundationTypeOptions.push(customValue);
        }
      }
      
      // Update dropdown to show the custom value
      this.serviceData.SecondFoundationType = customValue;
      
      // Save to database
      this.autoSaveServiceField('SecondFoundationType', customValue);
      
      // Clear the other input
      this.secondFoundationTypeOtherValue = '';
      
      this.changeDetectorRef.detectChanges();
    }
  }

  async onThirdFoundationTypeOtherChange() {
    if (this.thirdFoundationTypeOtherValue && this.thirdFoundationTypeOtherValue.trim()) {
      const customValue = this.thirdFoundationTypeOtherValue.trim();
      
      // Add custom value to options (before "Other")
      if (!this.thirdFoundationTypeOptions.includes(customValue)) {
        const otherIndex = this.thirdFoundationTypeOptions.indexOf('Other');
        if (otherIndex > -1) {
          this.thirdFoundationTypeOptions.splice(otherIndex, 0, customValue);
        } else {
          this.thirdFoundationTypeOptions.push(customValue);
        }
      }
      
      // Update dropdown to show the custom value
      this.serviceData.ThirdFoundationType = customValue;
      
      // Save to database
      this.autoSaveServiceField('ThirdFoundationType', customValue);
      
      // Clear the other input
      this.thirdFoundationTypeOtherValue = '';
      
      this.changeDetectorRef.detectChanges();
    }
  }

  async onOwnerOccupantInterviewOtherChange() {
    if (this.ownerOccupantInterviewOtherValue && this.ownerOccupantInterviewOtherValue.trim()) {
      const customValue = this.ownerOccupantInterviewOtherValue.trim();
      
      // Add custom value to options (before "Other")
      if (!this.ownerOccupantInterviewOptions.includes(customValue)) {
        const otherIndex = this.ownerOccupantInterviewOptions.indexOf('Other');
        if (otherIndex > -1) {
          this.ownerOccupantInterviewOptions.splice(otherIndex, 0, customValue);
        } else {
          this.ownerOccupantInterviewOptions.push(customValue);
        }
      }
      
      // Update dropdown to show the custom value
      this.serviceData.OwnerOccupantInterview = customValue;
      
      // Save to database
      this.autoSaveServiceField('OwnerOccupantInterview', customValue);
      
      // Clear the other input
      this.ownerOccupantInterviewOtherValue = '';
      
      this.changeDetectorRef.detectChanges();
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
    console.log(`[ProjectDetails] autoSaveServiceField(${fieldName}, ${value}) called for serviceId=${this.serviceId}`);

    if (!this.serviceId) {
      console.error(`Cannot save ${fieldName} - No ServiceID! ServiceID is: ${this.serviceId}`);
      return;
    }

    console.log(`[ProjectDetails] Saving service field ${fieldName}:`, value);

    // 1. Update local data immediately (for instant UI feedback)
    this.serviceData[fieldName] = value;
    console.log(`[ProjectDetails] this.serviceData[${fieldName}] set to:`, this.serviceData[fieldName]);

    // 2. Update IndexedDB cache immediately
    try {
      console.log(`[ProjectDetails] Calling offlineTemplate.updateService...`);
      await this.offlineTemplate.updateService(this.serviceId, { [fieldName]: value });
      console.log(`[ProjectDetails] Service field ${fieldName} saved to IndexedDB - SUCCESS`);
    } catch (error) {
      console.error(`[ProjectDetails] Error saving to IndexedDB:`, error);
    }

    // 3. Show appropriate status message
    const isOnline = this.offlineService.isOnline();
    console.log(`[ProjectDetails] isOnline = ${isOnline}`);
    if (isOnline) {
      this.showSaveStatus(`${fieldName} saved`, 'success');
    } else {
      this.showSaveStatus(`${fieldName} saved offline`, 'success');
    }

    // 4. Trigger background sync (will push to server when online)
    console.log(`[ProjectDetails] Triggering background sync...`);
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
