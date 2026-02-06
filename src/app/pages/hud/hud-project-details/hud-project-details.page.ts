import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, ViewWillEnter } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { HudStateService, ProjectData } from '../services/hud-state.service';
import { CaspioService } from '../../../services/caspio.service';
import { OfflineService } from '../../../services/offline.service';
import { IndexedDbService } from '../../../services/indexed-db.service';
import { BackgroundSyncService } from '../../../services/background-sync.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { environment } from '../../../../environments/environment';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-hud-project-details',
  templateUrl: './hud-project-details.page.html',
  styleUrls: ['./hud-project-details.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class HudProjectDetailsPage implements OnInit, OnDestroy, ViewWillEnter {
  projectId: string = '';
  serviceId: string = '';
  projectData: any = {};  // Use any to match original structure
  serviceData: any = {};  // Add serviceData for Services table fields
  
  // Lifecycle and sync tracking
  private initialLoadComplete: boolean = false;
  private serviceDataSyncSubscription?: Subscription;

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
    // U+00B0 (�), U+02DA (�), U+00BA (�) all become �
    return str.trim()
      .replace(/[\u02DA\u00BA]/g, '�')  // Ring above and masculine ordinal to degree
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
    private stateService: HudStateService,
    private caspioService: CaspioService,
    private toastController: ToastController,
    private offlineService: OfflineService,
    private changeDetectorRef: ChangeDetectorRef,
    private indexedDb: IndexedDbService,
    private backgroundSync: BackgroundSyncService,
    private offlineTemplate: OfflineTemplateService
  ) {}

  async ngOnInit() {

    // Get IDs from parent route snapshot immediately (for offline reliability)
    const parentParams = this.route.parent?.snapshot?.params;
    if (parentParams) {
      this.projectId = parentParams['projectId'] || '';
      this.serviceId = parentParams['serviceId'] || '';

      if (this.projectId && this.serviceId) {
        await this.loadData();
        
        // CRITICAL: Load dropdown options AFTER data is loaded
        // This ensures "Other" values are properly detected and text fields populated
        await this.loadDropdownOptions();
        await this.loadProjectDropdownOptions();
      }
    }

    // Also subscribe to param changes (for dynamic updates)
    this.route.parent?.params.subscribe(async params => {
      const newProjectId = params['projectId'];
      const newServiceId = params['serviceId'];

      // Only reload if IDs changed
      if (newProjectId !== this.projectId || newServiceId !== this.serviceId) {
        this.projectId = newProjectId;
        this.serviceId = newServiceId;
        await this.loadData();
        
        // CRITICAL: Reload dropdown options after data loads
        await this.loadDropdownOptions();
        await this.loadProjectDropdownOptions();
      } else {
      }
    });

    // Subscribe to sync events for real-time updates
    this.subscribeToSyncEvents();
    
    // Mark initial load as complete
    this.initialLoadComplete = true;
  }

  /**
   * Ionic lifecycle hook - called when navigating back to this page
   * Ensures data is refreshed when returning from other pages
   */
  async ionViewWillEnter() {
    
    // Only reload if initial load is complete and we have IDs
    if (this.initialLoadComplete && this.projectId && this.serviceId) {
      await this.loadData();
    }
  }

  /**
   * Subscribe to background sync events for real-time UI updates
   * MOBILE ONLY: Not needed in web mode since we save directly to API
   */
  private subscribeToSyncEvents(): void {
    // WEBAPP MODE: Skip sync event subscription - not needed with direct API calls
    if (environment.isWeb) {
      return;
    }

    // MOBILE MODE: Subscribe to service data sync completion
    // This fires when local changes to project/service data are synced to the server
    this.serviceDataSyncSubscription = this.backgroundSync.serviceDataSyncComplete$.subscribe(event => {
      if (event.serviceId === this.serviceId || event.projectId === this.projectId) {
        if (this.initialLoadComplete) {
          this.loadData();
        }
      }
    });
  }

  ngOnDestroy() {
    // Cleanup subscriptions
    if (this.serviceDataSyncSubscription) {
      this.serviceDataSyncSubscription.unsubscribe();
    }
  }

  private loadDataCallCount = 0;

  private async loadData() {
    this.loadDataCallCount++;
    const callNum = this.loadDataCallCount;

    try {
      // OFFLINE-FIRST: Try IndexedDB first for both project and service data
      await Promise.all([
        this.loadProjectData(),
        this.loadServiceData()
      ]);
    } catch (error) {
      console.error(`[ProjectDetails] loadData() #${callNum}: ERROR:`, error);
    }
  }

  private async loadProjectData() {
    let project: any = null;

    // WEBAPP MODE: Load directly from API (no IndexedDB caching)
    if (environment.isWeb) {
      try {
        project = await firstValueFrom(this.caspioService.getProject(this.projectId, false));
      } catch (error) {
        console.error('[ProjectDetails] WEBAPP: Error loading project from API:', error);
        return;
      }
    } else {
      // MOBILE MODE: Try IndexedDB first - this is the source of truth for offline-first
      project = await this.offlineTemplate.getProject(this.projectId);

      if (project) {
      } else {
        // Only fetch from API if IndexedDB has nothing at all
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
    let service: any = null;

    // WEBAPP MODE: Load directly from API (no IndexedDB caching)
    if (environment.isWeb) {
      try {
        service = await firstValueFrom(this.caspioService.getService(this.serviceId, false));
      } catch (error) {
        console.error('[ProjectDetails] WEBAPP: Error loading service from API:', error);
        return;
      }
    } else {
      // MOBILE MODE: Try IndexedDB first - this is the source of truth for offline-first
      service = await this.offlineTemplate.getService(this.serviceId);


      if (service) {
      } else {
        // Only fetch from API if IndexedDB has nothing at all
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
    }

    this.serviceData = service || {};
    if (!service || Object.keys(service).length === 0) {
      console.error('[ProjectDetails] ?? WARNING: serviceData set to EMPTY! service was:', service);
      console.trace('[ProjectDetails] Stack trace for empty serviceData:');
    }

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

    this.changeDetectorRef.detectChanges();
  }

  // Load dropdown options from Services_Drop table
  private async loadDropdownOptions() {
    try {
      let servicesDropData: any[] = [];

      // WEBAPP MODE: Load directly from API
      if (environment.isWeb) {
        servicesDropData = await firstValueFrom(this.caspioService.getServicesDrop()) || [];
      } else {
        // MOBILE MODE: Use OfflineTemplateService which reads from IndexedDB
        servicesDropData = await this.offlineTemplate.getServicesDrop();
      }
      
      // Debug: Log all unique ServicesName values to see what's available
      if (servicesDropData && servicesDropData.length > 0) {
        const uniqueServiceNames = [...new Set(servicesDropData.map((row: any) => row.ServicesName))];
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
          // Handle current value - normalize to match option OR show as "Other"
          if (currentValue && currentValue !== 'Other') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.weatherConditionsOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              this.serviceData.WeatherConditions = matchingOption;
            } else if (!matchingOption) {
              // Value not in options - show "Other" and populate text field
              this.weatherConditionsOtherValue = currentValue;
              this.serviceData.WeatherConditions = 'Other';
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
          // Handle current value - normalize to match option OR show as "Other"
          if (currentValue && currentValue !== 'Other') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.outdoorTemperatureOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              this.serviceData.OutdoorTemperature = matchingOption;
            } else if (!matchingOption) {
              // Value not in options - show "Other" and populate text field
              this.outdoorTemperatureOtherValue = currentValue;
              this.serviceData.OutdoorTemperature = 'Other';
            }
          }

          // Reorder to put "30�F -" first (if it exists)
          const thirtyBelowIndex = this.outdoorTemperatureOptions.findIndex(opt =>
            opt.includes('30') && opt.includes('-') && !opt.includes('to')
          );
          if (thirtyBelowIndex > 0) {
            const thirtyBelowOption = this.outdoorTemperatureOptions.splice(thirtyBelowIndex, 1)[0];
            this.outdoorTemperatureOptions.unshift(thirtyBelowOption);
          }

          // Ensure "100+" comes after "90-100" (not before it)
          const hundredPlusIndex = this.outdoorTemperatureOptions.findIndex(opt => opt.includes('100+') || opt.includes('100 +'));
          const ninetyToHundredIndex = this.outdoorTemperatureOptions.findIndex(opt => opt.includes('90') && opt.includes('100') && !opt.includes('+'));
          if (hundredPlusIndex >= 0 && ninetyToHundredIndex >= 0 && hundredPlusIndex < ninetyToHundredIndex) {
            const hundredPlusOption = this.outdoorTemperatureOptions.splice(hundredPlusIndex, 1)[0];
            // Find the new index of 90-100 after splice
            const newNinetyIndex = this.outdoorTemperatureOptions.findIndex(opt => opt.includes('90') && opt.includes('100') && !opt.includes('+'));
            this.outdoorTemperatureOptions.splice(newNinetyIndex + 1, 0, hundredPlusOption);
          }
        }

        // Set Occupancy Furnishings options
        if (optionsByService['OccupancyFurnishings'] && optionsByService['OccupancyFurnishings'].length > 0) {
          const currentValue = this.serviceData?.OccupancyFurnishings;
          this.occupancyFurnishingsOptions = optionsByService['OccupancyFurnishings'];
          if (!this.occupancyFurnishingsOptions.includes('Other')) {
            this.occupancyFurnishingsOptions.push('Other');
          }
          // Handle current value - normalize to match option OR show as "Other"
          if (currentValue && currentValue !== 'Other') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.occupancyFurnishingsOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              this.serviceData.OccupancyFurnishings = matchingOption;
            } else if (!matchingOption) {
              // Value not in options - show "Other" and populate text field
              this.occupancyFurnishingsOtherValue = currentValue;
              this.serviceData.OccupancyFurnishings = 'Other';
            }
          }
        }

        // Set InAttendance options (multi-select - preserve current selections)
        if (optionsByService['InAttendance'] && optionsByService['InAttendance'].length > 0) {
          this.inAttendanceOptions = optionsByService['InAttendance'];
          // Normalize selections to match API options, or add if truly missing
          if (this.inAttendanceSelections && this.inAttendanceSelections.length > 0) {
            this.inAttendanceSelections = this.inAttendanceSelections.map(selection => {
              if (!selection || selection === 'Other' || selection === 'None') return selection;
              const normalizedSelection = this.normalizeForComparison(selection);
              const matchingOption = this.inAttendanceOptions.find(opt =>
                this.normalizeForComparison(opt) === normalizedSelection
              );
              if (matchingOption) {
                if (matchingOption !== selection) {
                }
                return matchingOption;
              } else {
                // Add missing selection to options (custom values added via Other)
                this.inAttendanceOptions.push(selection);
                return selection;
              }
            });
          }
          // Sort options alphabetically, keeping "None" and "Other" at the end
          this.inAttendanceOptions = this.inAttendanceOptions
            .filter(opt => opt !== 'Other' && opt !== 'None')
            .sort((a, b) => a.localeCompare(b));
          // Add "None" and "Other" at the end (in that order)
          this.inAttendanceOptions.push('None');
          this.inAttendanceOptions.push('Other');
        }

        // Set FirstFoundationType options
        if (optionsByService['FirstFoundationType'] && optionsByService['FirstFoundationType'].length > 0) {
          const currentValue = this.serviceData?.FirstFoundationType;
          this.firstFoundationTypeOptions = optionsByService['FirstFoundationType'];
          if (!this.firstFoundationTypeOptions.includes('Other')) {
            this.firstFoundationTypeOptions.push('Other');
          }
          // Handle current value - normalize to match option OR show as "Other"
          if (currentValue && currentValue !== 'Other') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.firstFoundationTypeOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              this.serviceData.FirstFoundationType = matchingOption;
            } else if (!matchingOption) {
              // Value not in options - show "Other" and populate text field
              this.firstFoundationTypeOtherValue = currentValue;
              this.serviceData.FirstFoundationType = 'Other';
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
          // Handle current value - normalize to match option OR show as "Other"
          if (currentValue && currentValue !== 'Other' && currentValue !== 'None' && currentValue !== '') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.secondFoundationTypeOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              this.serviceData.SecondFoundationType = matchingOption;
            } else if (!matchingOption) {
              // Value not in options - show "Other" and populate text field
              this.secondFoundationTypeOtherValue = currentValue;
              this.serviceData.SecondFoundationType = 'Other';
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
          // Handle current value - normalize to match option OR show as "Other"
          if (currentValue && currentValue !== 'Other' && currentValue !== 'None' && currentValue !== '') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.thirdFoundationTypeOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              this.serviceData.ThirdFoundationType = matchingOption;
            } else if (!matchingOption) {
              // Value not in options - show "Other" and populate text field
              this.thirdFoundationTypeOtherValue = currentValue;
              this.serviceData.ThirdFoundationType = 'Other';
            }
          }
        }

        // Set SecondFoundationRooms options (multi-select - fall back to room options if not available)
        const secondFoundationRoomsSource = optionsByService['SecondFoundationRooms'] || optionsByService['FoundationRooms'] || optionsByService['ThirdFoundationRooms'];
        if (secondFoundationRoomsSource && secondFoundationRoomsSource.length > 0) {
          this.secondFoundationRoomsOptions = [...secondFoundationRoomsSource]; // Clone
          // Normalize selections to match API options, or add if truly missing
          if (this.secondFoundationRoomsSelections && this.secondFoundationRoomsSelections.length > 0) {
            this.secondFoundationRoomsSelections = this.secondFoundationRoomsSelections.map(selection => {
              if (!selection || selection === 'Other' || selection === 'None') return selection;
              const normalizedSelection = this.normalizeForComparison(selection);
              const matchingOption = this.secondFoundationRoomsOptions.find(opt =>
                this.normalizeForComparison(opt) === normalizedSelection
              );
              if (matchingOption) {
                if (matchingOption !== selection) {
                }
                return matchingOption;
              } else {
                // Add missing selection to options (custom values added via Other)
                this.secondFoundationRoomsOptions.push(selection);
                return selection;
              }
            });
          }
          // Sort options alphabetically, keeping "None" and "Other" at the end
          this.secondFoundationRoomsOptions = this.secondFoundationRoomsOptions
            .filter(opt => opt !== 'Other' && opt !== 'None')
            .sort((a, b) => a.localeCompare(b));
          // Add "None" and "Other" at the end (in that order)
          this.secondFoundationRoomsOptions.push('None');
          this.secondFoundationRoomsOptions.push('Other');
        }

        // Set ThirdFoundationRooms options (multi-select - fall back to room options if not available)
        const thirdFoundationRoomsSource = optionsByService['ThirdFoundationRooms'] || optionsByService['FoundationRooms'] || optionsByService['SecondFoundationRooms'];
        if (thirdFoundationRoomsSource && thirdFoundationRoomsSource.length > 0) {
          this.thirdFoundationRoomsOptions = [...thirdFoundationRoomsSource]; // Clone
          // Normalize selections to match API options, or add if truly missing
          if (this.thirdFoundationRoomsSelections && this.thirdFoundationRoomsSelections.length > 0) {
            this.thirdFoundationRoomsSelections = this.thirdFoundationRoomsSelections.map(selection => {
              if (!selection || selection === 'Other' || selection === 'None') return selection;
              const normalizedSelection = this.normalizeForComparison(selection);
              const matchingOption = this.thirdFoundationRoomsOptions.find(opt =>
                this.normalizeForComparison(opt) === normalizedSelection
              );
              if (matchingOption) {
                if (matchingOption !== selection) {
                }
                return matchingOption;
              } else {
                // Add missing selection to options (custom values added via Other)
                this.thirdFoundationRoomsOptions.push(selection);
                return selection;
              }
            });
          }
          // Sort options alphabetically, keeping "None" and "Other" at the end
          this.thirdFoundationRoomsOptions = this.thirdFoundationRoomsOptions
            .filter(opt => opt !== 'Other' && opt !== 'None')
            .sort((a, b) => a.localeCompare(b));
          // Add "None" and "Other" at the end (in that order)
          this.thirdFoundationRoomsOptions.push('None');
          this.thirdFoundationRoomsOptions.push('Other');
        }

        // Set OwnerOccupantInterview options
        if (optionsByService['OwnerOccupantInterview'] && optionsByService['OwnerOccupantInterview'].length > 0) {
          const currentValue = this.serviceData?.OwnerOccupantInterview;
          this.ownerOccupantInterviewOptions = optionsByService['OwnerOccupantInterview'];
          if (!this.ownerOccupantInterviewOptions.includes('Other')) {
            this.ownerOccupantInterviewOptions.push('Other');
          }
          // Handle current value - normalize to match option OR show as "Other"
          if (currentValue && currentValue !== 'Other') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.ownerOccupantInterviewOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              this.serviceData.OwnerOccupantInterview = matchingOption;
            } else if (!matchingOption) {
              // Value not in options - show "Other" and populate text field
              this.ownerOccupantInterviewOtherValue = currentValue;
              this.serviceData.OwnerOccupantInterview = 'Other';
            }
          }
        }
        this.changeDetectorRef.detectChanges();
      }
    } catch (error) {
      console.error('Error loading Services_Drop options:', error);
      // Keep default options on error
    }
  }

  // Load dropdown options from Projects_Drop table
  private async loadProjectDropdownOptions() {
    try {
      let dropdownData: any[] = [];

      // WEBAPP MODE: Load directly from API
      if (environment.isWeb) {
        dropdownData = await firstValueFrom(this.caspioService.getProjectsDrop()) || [];
      } else {
        // MOBILE MODE: Use OfflineTemplateService which reads from IndexedDB
        dropdownData = await this.offlineTemplate.getProjectsDrop();
      }

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

        // Handle TypeOfBuilding: if value is not in options, show "Other" with the value in text field
        if (this.projectData.TypeOfBuilding &&
            this.projectData.TypeOfBuilding !== 'Other' &&
            !this.optionsIncludeNormalized(this.typeOfBuildingOptions, this.projectData.TypeOfBuilding)) {
          // Store the custom value in the Other text field
          this.typeOfBuildingOtherValue = this.projectData.TypeOfBuilding;
          // Set dropdown to "Other"
          this.projectData.TypeOfBuilding = 'Other';
        }

        // Handle Style: if value is not in options, show "Other" with the value in text field
        if (this.projectData.Style &&
            this.projectData.Style !== 'Other' &&
            !this.optionsIncludeNormalized(this.styleOptions, this.projectData.Style)) {
          // Store the custom value in the Other text field
          this.styleOtherValue = this.projectData.Style;
          // Set dropdown to "Other"
          this.projectData.Style = 'Other';
        }

        this.changeDetectorRef.detectChanges();
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
    return this.inAttendanceSelections.includes(option);
  }

  async onInAttendanceToggle(option: string, event: any) {
    if (!this.inAttendanceSelections) {
      this.inAttendanceSelections = [];
    }

    if (event.detail.checked) {
      if (option === 'None') {
        // "None" is mutually exclusive - clear all other selections
        this.inAttendanceSelections = ['None'];
        this.inAttendanceOtherValue = '';
      } else {
        // Remove "None" if selecting any other option
        const noneIndex = this.inAttendanceSelections.indexOf('None');
        if (noneIndex > -1) {
          this.inAttendanceSelections.splice(noneIndex, 1);
        }
        if (!this.inAttendanceSelections.includes(option)) {
          this.inAttendanceSelections.push(option);
        }
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
      // Just select it if not already selected
      if (!this.inAttendanceSelections.includes(customValue)) {
        this.inAttendanceSelections.push(customValue);
      }
    } else {
      // Add the custom value to options (before None and Other)
      const noneIndex = this.inAttendanceOptions.indexOf('None');
      if (noneIndex > -1) {
        this.inAttendanceOptions.splice(noneIndex, 0, customValue);
      } else {
        // Fallback: add before Other
        const otherIndex = this.inAttendanceOptions.indexOf('Other');
        if (otherIndex > -1) {
          this.inAttendanceOptions.splice(otherIndex, 0, customValue);
        } else {
          this.inAttendanceOptions.push(customValue);
        }
      }

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

  // Second Foundation Rooms multi-select methods
  isSecondFoundationRoomsSelected(option: string): boolean {
    if (!this.secondFoundationRoomsSelections || !Array.isArray(this.secondFoundationRoomsSelections)) {
      return false;
    }
    return this.secondFoundationRoomsSelections.includes(option);
  }

  async onSecondFoundationRoomsToggle(option: string, event: any) {
    if (!this.secondFoundationRoomsSelections) {
      this.secondFoundationRoomsSelections = [];
    }

    if (event.detail.checked) {
      if (option === 'None') {
        // "None" is mutually exclusive - clear all other selections
        this.secondFoundationRoomsSelections = ['None'];
        this.secondFoundationRoomsOtherValue = '';
      } else {
        // Remove "None" if selecting any other option
        const noneIndex = this.secondFoundationRoomsSelections.indexOf('None');
        if (noneIndex > -1) {
          this.secondFoundationRoomsSelections.splice(noneIndex, 1);
        }
        if (!this.secondFoundationRoomsSelections.includes(option)) {
          this.secondFoundationRoomsSelections.push(option);
        }
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
    if (!this.thirdFoundationRoomsSelections || !Array.isArray(this.thirdFoundationRoomsSelections)) {
      return false;
    }
    return this.thirdFoundationRoomsSelections.includes(option);
  }

  async onThirdFoundationRoomsToggle(option: string, event: any) {
    if (!this.thirdFoundationRoomsSelections) {
      this.thirdFoundationRoomsSelections = [];
    }

    if (event.detail.checked) {
      if (option === 'None') {
        // "None" is mutually exclusive - clear all other selections
        this.thirdFoundationRoomsSelections = ['None'];
        this.thirdFoundationRoomsOtherValue = '';
      } else {
        // Remove "None" if selecting any other option
        const noneIndex = this.thirdFoundationRoomsSelections.indexOf('None');
        if (noneIndex > -1) {
          this.thirdFoundationRoomsSelections.splice(noneIndex, 1);
        }
        if (!this.thirdFoundationRoomsSelections.includes(option)) {
          this.thirdFoundationRoomsSelections.push(option);
        }
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

  // "Other" value change handlers for dropdowns
  // Keep dropdown as "Other" and save custom value to database
  // CRITICAL: Don't use autoSaveProjectField as it updates the dropdown value
  async onTypeOfBuildingOtherChange() {
    if (this.typeOfBuildingOtherValue && this.typeOfBuildingOtherValue.trim()) {
      const customValue = this.typeOfBuildingOtherValue.trim();
      // Save custom value to database WITHOUT updating dropdown
      await this.saveOtherValueToDatabase('project', 'TypeOfBuilding', customValue);
    }
  }

  async onStyleOtherChange() {
    if (this.styleOtherValue && this.styleOtherValue.trim()) {
      const customValue = this.styleOtherValue.trim();
      // Save custom value to database WITHOUT updating dropdown
      await this.saveOtherValueToDatabase('project', 'Style', customValue);
    }
  }

  async onOccupancyFurnishingsOtherChange() {
    if (this.occupancyFurnishingsOtherValue && this.occupancyFurnishingsOtherValue.trim()) {
      const customValue = this.occupancyFurnishingsOtherValue.trim();
      // Save custom value to database WITHOUT updating dropdown
      await this.saveOtherValueToDatabase('service', 'OccupancyFurnishings', customValue);
    }
  }

  async onWeatherConditionsOtherChange() {
    if (this.weatherConditionsOtherValue && this.weatherConditionsOtherValue.trim()) {
      const customValue = this.weatherConditionsOtherValue.trim();
      // Save custom value to database WITHOUT updating dropdown
      await this.saveOtherValueToDatabase('service', 'WeatherConditions', customValue);
    }
  }

  async onOutdoorTemperatureOtherChange() {
    if (this.outdoorTemperatureOtherValue && this.outdoorTemperatureOtherValue.trim()) {
      const customValue = this.outdoorTemperatureOtherValue.trim();
      // Save custom value to database WITHOUT updating dropdown
      await this.saveOtherValueToDatabase('service', 'OutdoorTemperature', customValue);
    }
  }

  async onFirstFoundationTypeOtherChange() {
    if (this.firstFoundationTypeOtherValue && this.firstFoundationTypeOtherValue.trim()) {
      const customValue = this.firstFoundationTypeOtherValue.trim();
      // Save custom value to database WITHOUT updating dropdown
      await this.saveOtherValueToDatabase('service', 'FirstFoundationType', customValue);
    }
  }

  async onSecondFoundationTypeOtherChange() {
    if (this.secondFoundationTypeOtherValue && this.secondFoundationTypeOtherValue.trim()) {
      const customValue = this.secondFoundationTypeOtherValue.trim();
      // Save custom value to database WITHOUT updating dropdown
      await this.saveOtherValueToDatabase('service', 'SecondFoundationType', customValue);
    }
  }

  async onThirdFoundationTypeOtherChange() {
    if (this.thirdFoundationTypeOtherValue && this.thirdFoundationTypeOtherValue.trim()) {
      const customValue = this.thirdFoundationTypeOtherValue.trim();
      // Save custom value to database WITHOUT updating dropdown
      await this.saveOtherValueToDatabase('service', 'ThirdFoundationType', customValue);
    }
  }

  async onOwnerOccupantInterviewOtherChange() {
    if (this.ownerOccupantInterviewOtherValue && this.ownerOccupantInterviewOtherValue.trim()) {
      const customValue = this.ownerOccupantInterviewOtherValue.trim();
      // Save custom value to database WITHOUT updating dropdown
      await this.saveOtherValueToDatabase('service', 'OwnerOccupantInterview', customValue);
    }
  }

  /**
   * Save "Other" custom value to database WITHOUT updating the dropdown display
   * This keeps the dropdown showing "Other" while saving the actual custom value
   */
  private async saveOtherValueToDatabase(tableType: 'project' | 'service', fieldName: string, value: string) {

    // WEBAPP MODE: Save directly to API
    if (environment.isWeb) {
      try {
        if (tableType === 'project') {
          if (!this.projectId || this.projectId === 'new') return;
          // Use PK_ID from loaded project data for API updates (matches mobile app pattern)
          const projectIdForUpdate = this.projectData?.PK_ID || this.projectId;
          await firstValueFrom(this.caspioService.updateProject(projectIdForUpdate, { [fieldName]: value }));
        } else {
          if (!this.serviceId || this.serviceId === 'new') return;
          await firstValueFrom(this.caspioService.updateService(this.serviceId, { [fieldName]: value }));
        }
        this.showSaveStatus(`${fieldName} saved`, 'success');
      } catch (error) {
        console.error(`[ProjectDetails] WEBAPP: Error saving Other value to API:`, error);
        this.showSaveStatus(`Error saving ${fieldName}`, 'error');
      }
      return;
    }

    // MOBILE MODE: Save to IndexedDB, sync later
    if (tableType === 'project') {
      if (!this.projectId || this.projectId === 'new') return;

      // Save to IndexedDB (actual value, not "Other")
      try {
        await this.offlineTemplate.updateProject(this.projectId, { [fieldName]: value });
      } catch (error) {
        console.error(`[ProjectDetails] Error saving Other value to IndexedDB:`, error);
      }
    } else {
      if (!this.serviceId || this.serviceId === 'new') return;

      // Save to IndexedDB (actual value, not "Other")
      try {
        await this.offlineTemplate.updateService(this.serviceId, { [fieldName]: value });
      } catch (error) {
        console.error(`[ProjectDetails] Error saving Other value to IndexedDB:`, error);
      }
    }

    // Show status and trigger sync
    const isOnline = this.offlineService.isOnline();
    if (isOnline) {
      this.showSaveStatus(`${fieldName} saved`, 'success');
    } else {
      this.showSaveStatus(`${fieldName} saved offline`, 'success');
    }
    // Sync will happen on next 60-second interval (batched sync)
  }

  // Auto-save to Projects table
  private async autoSaveProjectField(fieldName: string, value: any) {
    if (!this.projectId || this.projectId === 'new') return;


    // Update local data immediately (for instant UI feedback)
    this.projectData[fieldName] = value;

    // WEBAPP MODE: Save directly to API
    if (environment.isWeb) {
      try {
        // Use PK_ID from loaded project data for API updates (matches mobile app pattern)
        const projectIdForUpdate = this.projectData?.PK_ID || this.projectId;
        await firstValueFrom(this.caspioService.updateProject(projectIdForUpdate, { [fieldName]: value }));
        this.showSaveStatus(`${fieldName} saved`, 'success');
      } catch (error) {
        console.error(`[ProjectDetails] WEBAPP: Error saving to API:`, error);
        this.showSaveStatus(`Error saving ${fieldName}`, 'error');
      }
      return;
    }

    // MOBILE MODE: Update IndexedDB cache, sync later
    try {
      await this.offlineTemplate.updateProject(this.projectId, { [fieldName]: value });
    } catch (error) {
      console.error(`[ProjectDetails] Error saving to IndexedDB:`, error);
    }

    // Show appropriate status message
    const isOnline = this.offlineService.isOnline();
    if (isOnline) {
      this.showSaveStatus(`${fieldName} saved`, 'success');
    } else {
      this.showSaveStatus(`${fieldName} saved offline`, 'success');
    }

    // Sync will happen on next 60-second interval (batched sync)
  }

  // Auto-save to Services table
  private async autoSaveServiceField(fieldName: string, value: any) {

    if (!this.serviceId) {
      console.error(`Cannot save ${fieldName} - No ServiceID! ServiceID is: ${this.serviceId}`);
      return;
    }


    // Update local data immediately (for instant UI feedback)
    this.serviceData[fieldName] = value;

    // WEBAPP MODE: Save directly to API
    if (environment.isWeb) {
      try {
        await firstValueFrom(this.caspioService.updateService(this.serviceId, { [fieldName]: value }));
        this.showSaveStatus(`${fieldName} saved`, 'success');
      } catch (error) {
        console.error(`[ProjectDetails] WEBAPP: Error saving to API:`, error);
        this.showSaveStatus(`Error saving ${fieldName}`, 'error');
      }
      return;
    }

    // MOBILE MODE: Update IndexedDB cache, sync later
    try {
      await this.offlineTemplate.updateService(this.serviceId, { [fieldName]: value });
    } catch (error) {
      console.error(`[ProjectDetails] Error saving to IndexedDB:`, error);
    }

    // Show appropriate status message
    const isOnline = this.offlineService.isOnline();
    if (isOnline) {
      this.showSaveStatus(`${fieldName} saved`, 'success');
    } else {
      this.showSaveStatus(`${fieldName} saved offline`, 'success');
    }

    // Sync will happen on next 60-second interval (batched sync)
  }

  showSaveStatus(message: string, type: 'info' | 'success' | 'error') {
    this.saveStatus = message;
    this.saveStatusType = type;

    setTimeout(() => {
      this.saveStatus = '';
    }, 3000);
  }

  async showToast(message: string, color: string = 'primary') {
    if (color === 'success' || color === 'info') return;
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }
}
