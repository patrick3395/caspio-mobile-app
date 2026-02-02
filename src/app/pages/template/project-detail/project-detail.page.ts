import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ToastController, ViewWillEnter } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { CaspioService } from '../../../services/caspio.service';
import { OfflineService } from '../../../services/offline.service';
import { IndexedDbService } from '../../../services/indexed-db.service';
import { BackgroundSyncService } from '../../../services/background-sync.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { TemplateConfigService } from '../../../services/template/template-config.service';
import { TemplateConfig } from '../../../services/template/template-config.interface';
import { environment } from '../../../../environments/environment';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-generic-project-detail',
  templateUrl: './project-detail.page.html',
  styleUrls: ['./project-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class GenericProjectDetailPage implements OnInit, OnDestroy, ViewWillEnter {
  // Template config
  config: TemplateConfig | null = null;
  private configSubscription?: Subscription;

  projectId: string = '';
  serviceId: string = '';
  projectData: any = {};
  serviceData: any = {};

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
    return str.trim()
      .replace(/[\u02DA\u00BA]/g, '°')
      .replace(/\s+/g, ' ')
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
    private caspioService: CaspioService,
    private toastController: ToastController,
    private offlineService: OfflineService,
    private changeDetectorRef: ChangeDetectorRef,
    private indexedDb: IndexedDbService,
    private backgroundSync: BackgroundSyncService,
    private offlineTemplate: OfflineTemplateService,
    private templateConfigService: TemplateConfigService
  ) {}

  async ngOnInit() {
    console.log('[GenericProjectDetail] ngOnInit() called');

    // Subscribe to template config changes
    this.configSubscription = this.templateConfigService.activeConfig$.subscribe(config => {
      this.config = config;
      console.log('[GenericProjectDetail] Config loaded for template:', config.id);
    });

    // Get IDs from parent route snapshot immediately (for offline reliability)
    const parentParams = this.route.parent?.snapshot?.params;
    console.log('[GenericProjectDetail] parentParams from snapshot:', parentParams);
    if (parentParams) {
      this.projectId = parentParams['projectId'] || '';
      this.serviceId = parentParams['serviceId'] || '';
      console.log('[GenericProjectDetail] Got params from snapshot:', this.projectId, this.serviceId);

      if (this.projectId && this.serviceId) {
        console.log('[GenericProjectDetail] Calling loadData() from SNAPSHOT');
        await this.loadData();

        // Load dropdown options AFTER data is loaded
        await this.loadDropdownOptions();
        await this.loadProjectDropdownOptions();
      }
    }

    // Subscribe to param changes (for dynamic updates)
    this.route.parent?.params.subscribe(async params => {
      console.log('[GenericProjectDetail] params.subscribe fired with:', params);
      const newProjectId = params['projectId'];
      const newServiceId = params['serviceId'];

      if (newProjectId !== this.projectId || newServiceId !== this.serviceId) {
        console.log('[GenericProjectDetail] IDs CHANGED - calling loadData() from SUBSCRIPTION');
        this.projectId = newProjectId;
        this.serviceId = newServiceId;
        await this.loadData();

        await this.loadDropdownOptions();
        await this.loadProjectDropdownOptions();
      }
    });

    // Subscribe to sync events for real-time updates
    this.subscribeToSyncEvents();

    this.initialLoadComplete = true;
  }

  async ionViewWillEnter() {
    console.log('[GenericProjectDetail] ionViewWillEnter - Reloading data from cache');

    if (this.initialLoadComplete && this.projectId && this.serviceId) {
      await this.loadData();
    }
  }

  private subscribeToSyncEvents(): void {
    // WEBAPP MODE: Skip sync event subscription
    if (environment.isWeb) {
      console.log('[GenericProjectDetail] WEBAPP MODE: Skipping sync event subscription');
      return;
    }

    // MOBILE MODE: Subscribe to service data sync completion
    this.serviceDataSyncSubscription = this.backgroundSync.serviceDataSyncComplete$.subscribe(event => {
      if (event.serviceId === this.serviceId || event.projectId === this.projectId) {
        console.log('[GenericProjectDetail] Service/project data synced, reloading...');
        if (this.initialLoadComplete) {
          this.loadData();
        }
      }
    });
  }

  ngOnDestroy() {
    if (this.serviceDataSyncSubscription) {
      this.serviceDataSyncSubscription.unsubscribe();
    }
    if (this.configSubscription) {
      this.configSubscription.unsubscribe();
    }
  }

  private loadDataCallCount = 0;

  private async loadData() {
    this.loadDataCallCount++;
    const callNum = this.loadDataCallCount;
    console.log(`[GenericProjectDetail] ========== loadData() CALL #${callNum} ==========`);

    try {
      await Promise.all([
        this.loadProjectData(),
        this.loadServiceData()
      ]);
      console.log(`[GenericProjectDetail] loadData() #${callNum}: COMPLETED`);
    } catch (error) {
      console.error(`[GenericProjectDetail] loadData() #${callNum}: ERROR:`, error);
    }
  }

  private async loadProjectData() {
    let project: any = null;

    if (environment.isWeb) {
      console.log('[GenericProjectDetail] WEBAPP MODE: Loading project directly from API');
      try {
        project = await firstValueFrom(this.caspioService.getProject(this.projectId, false));
      } catch (error) {
        console.error('[GenericProjectDetail] WEBAPP: Error loading project from API:', error);
        return;
      }
    } else {
      project = await this.offlineTemplate.getProject(this.projectId);

      if (project) {
        console.log('[GenericProjectDetail] Loaded project from IndexedDB cache');
      } else {
        console.log('[GenericProjectDetail] Project not in cache, fetching from API...');
        try {
          const freshProject = await this.caspioService.getProject(this.projectId, false).toPromise();
          if (freshProject) {
            await this.indexedDb.cacheProjectRecord(this.projectId, freshProject);
            project = freshProject;
          }
        } catch (error) {
          console.error('[GenericProjectDetail] Error loading project from API:', error);
          return;
        }
      }
    }

    this.projectData = project || {};
    if (!this.projectData.TypeOfBuilding) this.projectData.TypeOfBuilding = '';
    if (!this.projectData.Style) this.projectData.Style = '';

    this.changeDetectorRef.detectChanges();
  }

  private async loadServiceData() {
    console.log(`[GenericProjectDetail] loadServiceData() called for serviceId=${this.serviceId}`);
    let service: any = null;

    if (environment.isWeb) {
      console.log('[GenericProjectDetail] WEBAPP MODE: Loading service directly from API');
      try {
        service = await firstValueFrom(this.caspioService.getService(this.serviceId, false));
      } catch (error) {
        console.error('[GenericProjectDetail] WEBAPP: Error loading service from API:', error);
        return;
      }
    } else {
      service = await this.offlineTemplate.getService(this.serviceId);

      if (service) {
        console.log('[GenericProjectDetail] Loaded service from IndexedDB cache');
      } else {
        console.log('[GenericProjectDetail] Service not in cache, fetching from API...');
        try {
          const freshService = await this.caspioService.getService(this.serviceId, false).toPromise();
          if (freshService) {
            await this.indexedDb.cacheServiceRecord(this.serviceId, freshService);
            service = freshService;
          }
        } catch (error) {
          console.error('[GenericProjectDetail] Error loading service from API:', error);
          return;
        }
      }
    }

    this.serviceData = service || {};

    if (!this.serviceData.OccupancyFurnishings) this.serviceData.OccupancyFurnishings = '';
    if (!this.serviceData.WeatherConditions) this.serviceData.WeatherConditions = '';
    if (!this.serviceData.OutdoorTemperature) this.serviceData.OutdoorTemperature = '';
    if (!this.serviceData.FirstFoundationType) this.serviceData.FirstFoundationType = '';
    if (!this.serviceData.SecondFoundationType) this.serviceData.SecondFoundationType = '';
    if (!this.serviceData.ThirdFoundationType) this.serviceData.ThirdFoundationType = '';
    if (!this.serviceData.OwnerOccupantInterview) this.serviceData.OwnerOccupantInterview = '';

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
  }

  // Load dropdown options from Services_Drop table
  private async loadDropdownOptions() {
    console.log('[GenericProjectDetail] loadDropdownOptions() called');
    try {
      let servicesDropData: any[] = [];

      if (environment.isWeb) {
        console.log('[GenericProjectDetail] WEBAPP MODE: Loading Services_Drop directly from API');
        servicesDropData = await firstValueFrom(this.caspioService.getServicesDrop()) || [];
      } else {
        servicesDropData = await this.offlineTemplate.getServicesDrop();
      }

      if (servicesDropData && servicesDropData.length > 0) {
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
          if (currentValue && currentValue !== 'Other') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.weatherConditionsOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              this.serviceData.WeatherConditions = matchingOption;
            } else if (!matchingOption) {
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
          if (currentValue && currentValue !== 'Other') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.outdoorTemperatureOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              this.serviceData.OutdoorTemperature = matchingOption;
            } else if (!matchingOption) {
              this.outdoorTemperatureOtherValue = currentValue;
              this.serviceData.OutdoorTemperature = 'Other';
            }
          }

          // Reorder to put "30°F -" first
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
          if (currentValue && currentValue !== 'Other') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.occupancyFurnishingsOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              this.serviceData.OccupancyFurnishings = matchingOption;
            } else if (!matchingOption) {
              this.occupancyFurnishingsOtherValue = currentValue;
              this.serviceData.OccupancyFurnishings = 'Other';
            }
          }
        }

        // Set InAttendance options (multi-select)
        if (optionsByService['InAttendance'] && optionsByService['InAttendance'].length > 0) {
          this.inAttendanceOptions = optionsByService['InAttendance'];
          if (this.inAttendanceSelections && this.inAttendanceSelections.length > 0) {
            this.inAttendanceSelections = this.inAttendanceSelections.map(selection => {
              if (!selection || selection === 'Other' || selection === 'None') return selection;
              const normalizedSelection = this.normalizeForComparison(selection);
              const matchingOption = this.inAttendanceOptions.find(opt =>
                this.normalizeForComparison(opt) === normalizedSelection
              );
              if (matchingOption) {
                return matchingOption;
              } else {
                this.inAttendanceOptions.push(selection);
                return selection;
              }
            });
          }
          this.inAttendanceOptions = this.inAttendanceOptions
            .filter(opt => opt !== 'Other' && opt !== 'None')
            .sort((a, b) => a.localeCompare(b));
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
          if (currentValue && currentValue !== 'Other') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.firstFoundationTypeOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              this.serviceData.FirstFoundationType = matchingOption;
            } else if (!matchingOption) {
              this.firstFoundationTypeOtherValue = currentValue;
              this.serviceData.FirstFoundationType = 'Other';
            }
          }
        }

        // Set SecondFoundationType options
        const secondFoundationTypeSource = optionsByService['SecondFoundationType'] || optionsByService['FirstFoundationType'];
        if (secondFoundationTypeSource && secondFoundationTypeSource.length > 0) {
          const currentValue = this.serviceData?.SecondFoundationType;
          this.secondFoundationTypeOptions = [...secondFoundationTypeSource];
          if (!this.secondFoundationTypeOptions.includes('Other')) {
            this.secondFoundationTypeOptions.push('Other');
          }
          if (currentValue && currentValue !== 'Other' && currentValue !== 'None' && currentValue !== '') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.secondFoundationTypeOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              this.serviceData.SecondFoundationType = matchingOption;
            } else if (!matchingOption) {
              this.secondFoundationTypeOtherValue = currentValue;
              this.serviceData.SecondFoundationType = 'Other';
            }
          }
        }

        // Set ThirdFoundationType options
        const thirdFoundationTypeSource = optionsByService['ThirdFoundationType'] || optionsByService['FirstFoundationType'];
        if (thirdFoundationTypeSource && thirdFoundationTypeSource.length > 0) {
          const currentValue = this.serviceData?.ThirdFoundationType;
          this.thirdFoundationTypeOptions = [...thirdFoundationTypeSource];
          if (!this.thirdFoundationTypeOptions.includes('Other')) {
            this.thirdFoundationTypeOptions.push('Other');
          }
          if (currentValue && currentValue !== 'Other' && currentValue !== 'None' && currentValue !== '') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.thirdFoundationTypeOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              this.serviceData.ThirdFoundationType = matchingOption;
            } else if (!matchingOption) {
              this.thirdFoundationTypeOtherValue = currentValue;
              this.serviceData.ThirdFoundationType = 'Other';
            }
          }
        }

        // Set SecondFoundationRooms options (multi-select)
        const secondFoundationRoomsSource = optionsByService['SecondFoundationRooms'] || optionsByService['FoundationRooms'] || optionsByService['ThirdFoundationRooms'];
        if (secondFoundationRoomsSource && secondFoundationRoomsSource.length > 0) {
          this.secondFoundationRoomsOptions = [...secondFoundationRoomsSource];
          if (this.secondFoundationRoomsSelections && this.secondFoundationRoomsSelections.length > 0) {
            this.secondFoundationRoomsSelections = this.secondFoundationRoomsSelections.map(selection => {
              if (!selection || selection === 'Other' || selection === 'None') return selection;
              const normalizedSelection = this.normalizeForComparison(selection);
              const matchingOption = this.secondFoundationRoomsOptions.find(opt =>
                this.normalizeForComparison(opt) === normalizedSelection
              );
              if (matchingOption) {
                return matchingOption;
              } else {
                this.secondFoundationRoomsOptions.push(selection);
                return selection;
              }
            });
          }
          this.secondFoundationRoomsOptions = this.secondFoundationRoomsOptions
            .filter(opt => opt !== 'Other' && opt !== 'None')
            .sort((a, b) => a.localeCompare(b));
          this.secondFoundationRoomsOptions.push('None');
          this.secondFoundationRoomsOptions.push('Other');
        }

        // Set ThirdFoundationRooms options (multi-select)
        const thirdFoundationRoomsSource = optionsByService['ThirdFoundationRooms'] || optionsByService['FoundationRooms'] || optionsByService['SecondFoundationRooms'];
        if (thirdFoundationRoomsSource && thirdFoundationRoomsSource.length > 0) {
          this.thirdFoundationRoomsOptions = [...thirdFoundationRoomsSource];
          if (this.thirdFoundationRoomsSelections && this.thirdFoundationRoomsSelections.length > 0) {
            this.thirdFoundationRoomsSelections = this.thirdFoundationRoomsSelections.map(selection => {
              if (!selection || selection === 'Other' || selection === 'None') return selection;
              const normalizedSelection = this.normalizeForComparison(selection);
              const matchingOption = this.thirdFoundationRoomsOptions.find(opt =>
                this.normalizeForComparison(opt) === normalizedSelection
              );
              if (matchingOption) {
                return matchingOption;
              } else {
                this.thirdFoundationRoomsOptions.push(selection);
                return selection;
              }
            });
          }
          this.thirdFoundationRoomsOptions = this.thirdFoundationRoomsOptions
            .filter(opt => opt !== 'Other' && opt !== 'None')
            .sort((a, b) => a.localeCompare(b));
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
          if (currentValue && currentValue !== 'Other') {
            const normalizedCurrentValue = this.normalizeForComparison(currentValue);
            const matchingOption = this.ownerOccupantInterviewOptions.find(opt =>
              this.normalizeForComparison(opt) === normalizedCurrentValue
            );
            if (matchingOption && matchingOption !== currentValue) {
              this.serviceData.OwnerOccupantInterview = matchingOption;
            } else if (!matchingOption) {
              this.ownerOccupantInterviewOtherValue = currentValue;
              this.serviceData.OwnerOccupantInterview = 'Other';
            }
          }
        }

        this.changeDetectorRef.detectChanges();
      }
    } catch (error) {
      console.error('Error loading Services_Drop options:', error);
    }
  }

  // Load dropdown options from Projects_Drop table
  private async loadProjectDropdownOptions() {
    try {
      let dropdownData: any[] = [];

      if (environment.isWeb) {
        console.log('[GenericProjectDetail] WEBAPP MODE: Loading Projects_Drop directly from API');
        dropdownData = await firstValueFrom(this.caspioService.getProjectsDrop()) || [];
      } else {
        dropdownData = await this.offlineTemplate.getProjectsDrop();
      }

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

        // Handle TypeOfBuilding: if value is not in options, show "Other"
        if (this.projectData.TypeOfBuilding &&
            this.projectData.TypeOfBuilding !== 'Other' &&
            !this.optionsIncludeNormalized(this.typeOfBuildingOptions, this.projectData.TypeOfBuilding)) {
          this.typeOfBuildingOtherValue = this.projectData.TypeOfBuilding;
          this.projectData.TypeOfBuilding = 'Other';
        }

        // Handle Style: if value is not in options, show "Other"
        if (this.projectData.Style &&
            this.projectData.Style !== 'Other' &&
            !this.optionsIncludeNormalized(this.styleOptions, this.projectData.Style)) {
          this.styleOtherValue = this.projectData.Style;
          this.projectData.Style = 'Other';
        }

        this.changeDetectorRef.detectChanges();
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
    return this.inAttendanceSelections.includes(option);
  }

  async onInAttendanceToggle(option: string, event: any) {
    if (!this.inAttendanceSelections) {
      this.inAttendanceSelections = [];
    }

    if (event.detail.checked) {
      if (option === 'None') {
        this.inAttendanceSelections = ['None'];
        this.inAttendanceOtherValue = '';
      } else {
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

    const noneIndex = this.inAttendanceSelections.indexOf('None');
    if (noneIndex > -1) {
      this.inAttendanceSelections.splice(noneIndex, 1);
    }

    if (this.inAttendanceOptions.includes(customValue)) {
      if (!this.inAttendanceSelections.includes(customValue)) {
        this.inAttendanceSelections.push(customValue);
      }
    } else {
      const noneOptIndex = this.inAttendanceOptions.indexOf('None');
      if (noneOptIndex > -1) {
        this.inAttendanceOptions.splice(noneOptIndex, 0, customValue);
      } else {
        const otherIndex = this.inAttendanceOptions.indexOf('Other');
        if (otherIndex > -1) {
          this.inAttendanceOptions.splice(otherIndex, 0, customValue);
        } else {
          this.inAttendanceOptions.push(customValue);
        }
      }
      if (!this.inAttendanceSelections) {
        this.inAttendanceSelections = [];
      }
      this.inAttendanceSelections.push(customValue);
    }

    this.inAttendanceOtherValue = '';
    await this.saveInAttendance();
    this.changeDetectorRef.detectChanges();
  }

  async onInAttendanceOtherChange() {
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
        this.secondFoundationRoomsSelections = ['None'];
        this.secondFoundationRoomsOtherValue = '';
      } else {
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

    const noneIndex = this.secondFoundationRoomsSelections.indexOf('None');
    if (noneIndex > -1) {
      this.secondFoundationRoomsSelections.splice(noneIndex, 1);
    }

    if (this.secondFoundationRoomsOptions.includes(customValue)) {
      if (!this.secondFoundationRoomsSelections.includes(customValue)) {
        this.secondFoundationRoomsSelections.push(customValue);
      }
    } else {
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
      if (!this.secondFoundationRoomsSelections) {
        this.secondFoundationRoomsSelections = [];
      }
      this.secondFoundationRoomsSelections.push(customValue);
    }

    this.secondFoundationRoomsOtherValue = '';
    await this.saveSecondFoundationRooms();
    this.changeDetectorRef.detectChanges();
  }

  async onSecondFoundationRoomsOtherChange() {
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
        this.thirdFoundationRoomsSelections = ['None'];
        this.thirdFoundationRoomsOtherValue = '';
      } else {
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

    const noneIndex = this.thirdFoundationRoomsSelections.indexOf('None');
    if (noneIndex > -1) {
      this.thirdFoundationRoomsSelections.splice(noneIndex, 1);
    }

    if (this.thirdFoundationRoomsOptions.includes(customValue)) {
      if (!this.thirdFoundationRoomsSelections.includes(customValue)) {
        this.thirdFoundationRoomsSelections.push(customValue);
      }
    } else {
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
      if (!this.thirdFoundationRoomsSelections) {
        this.thirdFoundationRoomsSelections = [];
      }
      this.thirdFoundationRoomsSelections.push(customValue);
    }

    this.thirdFoundationRoomsOtherValue = '';
    await this.saveThirdFoundationRooms();
    this.changeDetectorRef.detectChanges();
  }

  async onThirdFoundationRoomsOtherChange() {
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

  // "Other" value change handlers
  async onTypeOfBuildingOtherChange() {
    if (this.typeOfBuildingOtherValue && this.typeOfBuildingOtherValue.trim()) {
      const customValue = this.typeOfBuildingOtherValue.trim();
      await this.saveOtherValueToDatabase('project', 'TypeOfBuilding', customValue);
    }
  }

  async onStyleOtherChange() {
    if (this.styleOtherValue && this.styleOtherValue.trim()) {
      const customValue = this.styleOtherValue.trim();
      await this.saveOtherValueToDatabase('project', 'Style', customValue);
    }
  }

  async onOccupancyFurnishingsOtherChange() {
    if (this.occupancyFurnishingsOtherValue && this.occupancyFurnishingsOtherValue.trim()) {
      const customValue = this.occupancyFurnishingsOtherValue.trim();
      await this.saveOtherValueToDatabase('service', 'OccupancyFurnishings', customValue);
    }
  }

  async onWeatherConditionsOtherChange() {
    if (this.weatherConditionsOtherValue && this.weatherConditionsOtherValue.trim()) {
      const customValue = this.weatherConditionsOtherValue.trim();
      await this.saveOtherValueToDatabase('service', 'WeatherConditions', customValue);
    }
  }

  async onOutdoorTemperatureOtherChange() {
    if (this.outdoorTemperatureOtherValue && this.outdoorTemperatureOtherValue.trim()) {
      const customValue = this.outdoorTemperatureOtherValue.trim();
      await this.saveOtherValueToDatabase('service', 'OutdoorTemperature', customValue);
    }
  }

  async onFirstFoundationTypeOtherChange() {
    if (this.firstFoundationTypeOtherValue && this.firstFoundationTypeOtherValue.trim()) {
      const customValue = this.firstFoundationTypeOtherValue.trim();
      await this.saveOtherValueToDatabase('service', 'FirstFoundationType', customValue);
    }
  }

  async onSecondFoundationTypeOtherChange() {
    if (this.secondFoundationTypeOtherValue && this.secondFoundationTypeOtherValue.trim()) {
      const customValue = this.secondFoundationTypeOtherValue.trim();
      await this.saveOtherValueToDatabase('service', 'SecondFoundationType', customValue);
    }
  }

  async onThirdFoundationTypeOtherChange() {
    if (this.thirdFoundationTypeOtherValue && this.thirdFoundationTypeOtherValue.trim()) {
      const customValue = this.thirdFoundationTypeOtherValue.trim();
      await this.saveOtherValueToDatabase('service', 'ThirdFoundationType', customValue);
    }
  }

  async onOwnerOccupantInterviewOtherChange() {
    if (this.ownerOccupantInterviewOtherValue && this.ownerOccupantInterviewOtherValue.trim()) {
      const customValue = this.ownerOccupantInterviewOtherValue.trim();
      await this.saveOtherValueToDatabase('service', 'OwnerOccupantInterview', customValue);
    }
  }

  private async saveOtherValueToDatabase(tableType: 'project' | 'service', fieldName: string, value: string) {
    console.log(`[GenericProjectDetail] Saving Other value for ${fieldName}: "${value}"`);

    if (environment.isWeb) {
      try {
        if (tableType === 'project') {
          if (!this.projectId || this.projectId === 'new') return;
          const projectIdForUpdate = this.projectData?.PK_ID || this.projectId;
          await firstValueFrom(this.caspioService.updateProject(projectIdForUpdate, { [fieldName]: value }));
          console.log(`[GenericProjectDetail] WEBAPP: Project Other value ${fieldName} saved to API`);
        } else {
          if (!this.serviceId || this.serviceId === 'new') return;
          await firstValueFrom(this.caspioService.updateService(this.serviceId, { [fieldName]: value }));
          console.log(`[GenericProjectDetail] WEBAPP: Service Other value ${fieldName} saved to API`);
        }
        this.showSaveStatus(`${fieldName} saved`, 'success');
      } catch (error) {
        console.error(`[GenericProjectDetail] WEBAPP: Error saving Other value to API:`, error);
        this.showSaveStatus(`Error saving ${fieldName}`, 'error');
      }
      return;
    }

    // MOBILE MODE
    if (tableType === 'project') {
      if (!this.projectId || this.projectId === 'new') return;
      try {
        await this.offlineTemplate.updateProject(this.projectId, { [fieldName]: value });
      } catch (error) {
        console.error(`[GenericProjectDetail] Error saving Other value to IndexedDB:`, error);
      }
    } else {
      if (!this.serviceId || this.serviceId === 'new') return;
      try {
        await this.offlineTemplate.updateService(this.serviceId, { [fieldName]: value });
      } catch (error) {
        console.error(`[GenericProjectDetail] Error saving Other value to IndexedDB:`, error);
      }
    }

    const isOnline = this.offlineService.isOnline();
    if (isOnline) {
      this.showSaveStatus(`${fieldName} saved`, 'success');
    } else {
      this.showSaveStatus(`${fieldName} saved offline`, 'success');
    }
  }

  private async autoSaveProjectField(fieldName: string, value: any) {
    if (!this.projectId || this.projectId === 'new') return;

    console.log(`[GenericProjectDetail] Saving project field ${fieldName}:`, value);
    this.projectData[fieldName] = value;

    if (environment.isWeb) {
      try {
        const projectIdForUpdate = this.projectData?.PK_ID || this.projectId;
        await firstValueFrom(this.caspioService.updateProject(projectIdForUpdate, { [fieldName]: value }));
        console.log(`[GenericProjectDetail] WEBAPP: Project field ${fieldName} saved to API`);
        this.showSaveStatus(`${fieldName} saved`, 'success');
      } catch (error) {
        console.error(`[GenericProjectDetail] WEBAPP: Error saving to API:`, error);
        this.showSaveStatus(`Error saving ${fieldName}`, 'error');
      }
      return;
    }

    // MOBILE MODE
    try {
      await this.offlineTemplate.updateProject(this.projectId, { [fieldName]: value });
    } catch (error) {
      console.error(`[GenericProjectDetail] Error saving to IndexedDB:`, error);
    }

    const isOnline = this.offlineService.isOnline();
    if (isOnline) {
      this.showSaveStatus(`${fieldName} saved`, 'success');
    } else {
      this.showSaveStatus(`${fieldName} saved offline`, 'success');
    }
  }

  private async autoSaveServiceField(fieldName: string, value: any) {
    if (!this.serviceId) {
      console.error(`Cannot save ${fieldName} - No ServiceID!`);
      return;
    }

    console.log(`[GenericProjectDetail] Saving service field ${fieldName}:`, value);
    this.serviceData[fieldName] = value;

    if (environment.isWeb) {
      try {
        await firstValueFrom(this.caspioService.updateService(this.serviceId, { [fieldName]: value }));
        console.log(`[GenericProjectDetail] WEBAPP: Service field ${fieldName} saved to API`);
        this.showSaveStatus(`${fieldName} saved`, 'success');
      } catch (error) {
        console.error(`[GenericProjectDetail] WEBAPP: Error saving to API:`, error);
        this.showSaveStatus(`Error saving ${fieldName}`, 'error');
      }
      return;
    }

    // MOBILE MODE
    try {
      await this.offlineTemplate.updateService(this.serviceId, { [fieldName]: value });
    } catch (error) {
      console.error(`[GenericProjectDetail] Error saving to IndexedDB:`, error);
    }

    const isOnline = this.offlineService.isOnline();
    if (isOnline) {
      this.showSaveStatus(`${fieldName} saved`, 'success');
    } else {
      this.showSaveStatus(`${fieldName} saved offline`, 'success');
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
}
