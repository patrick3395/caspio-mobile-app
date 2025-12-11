import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { CaspioService } from '../../../../services/caspio.service';
import { EngineersFoundationDataService } from '../../engineers-foundation-data.service';
import { OfflineDataCacheService } from '../../../../services/offline-data-cache.service';
import { OfflineTemplateService } from '../../../../services/offline-template.service';
import { BackgroundSyncService } from '../../../../services/background-sync.service';

@Component({
  selector: 'app-structural-systems-hub',
  templateUrl: './structural-systems-hub.page.html',
  styleUrls: ['./structural-systems-hub.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class StructuralSystemsHubPage implements OnInit {
  projectId: string = '';
  serviceId: string = '';
  categories: { name: string; deficiencyCount: number }[] = [];
  loading: boolean = true;
  serviceData: any = {};

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private caspioService: CaspioService,
    private changeDetectorRef: ChangeDetectorRef,
    private foundationData: EngineersFoundationDataService,
    private offlineCache: OfflineDataCacheService,
    private offlineTemplate: OfflineTemplateService,
    private backgroundSync: BackgroundSyncService
  ) {}

  async ngOnInit() {
    // Get IDs from parent route snapshot immediately (for offline reliability)
    const parentParams = this.route.parent?.parent?.snapshot?.params;
    if (parentParams) {
      this.projectId = parentParams['projectId'] || '';
      this.serviceId = parentParams['serviceId'] || '';
      console.log('[StructuralHub] Got params from snapshot:', this.projectId, this.serviceId);

      if (this.projectId && this.serviceId) {
        this.loadData();
      }
    }

    // Also subscribe to param changes (for dynamic updates)
    this.route.parent?.parent?.params.subscribe(params => {
      const newProjectId = params['projectId'];
      const newServiceId = params['serviceId'];

      // Only reload if IDs changed
      if (newProjectId !== this.projectId || newServiceId !== this.serviceId) {
        this.projectId = newProjectId;
        this.serviceId = newServiceId;
        console.log('[StructuralHub] ProjectId:', this.projectId, 'ServiceId:', this.serviceId);

        if (this.projectId && this.serviceId) {
          this.loadData();
        } else {
          console.error('[StructuralHub] Missing projectId or serviceId');
          this.loading = false;
        }
      }
    });
  }

  private async loadData() {
    this.loading = true;

    try {
      // OFFLINE-FIRST: Load service data from IndexedDB cache first
      console.log(`[StructuralHub] Loading service data for serviceId=${this.serviceId}`);
      let service = await this.offlineTemplate.getService(this.serviceId);

      if (service) {
        console.log('[StructuralHub] Loaded service from IndexedDB cache, StructStat =', service.StructStat);
        this.serviceData = service;
      } else {
        // Fallback to API if not in cache
        console.log('[StructuralHub] Service not in cache, fetching from API...');
        try {
          const apiService = await this.caspioService.getService(this.serviceId).toPromise();
          if (apiService) {
            this.serviceData = apiService;
            console.log('[StructuralHub] Loaded from API, StructStat =', apiService.StructStat);
          }
        } catch (error) {
          console.error('[StructuralHub] Error loading service from API:', error);
        }
      }

      this.changeDetectorRef.detectChanges();

      // Always load categories - works offline via cache
      await this.loadCategories();
    } catch (error) {
      console.error('[StructuralHub] Error in loadData:', error);
    } finally {
      this.loading = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  private async loadCategories() {
    try {
      // Get all templates using offline cache (falls back to cached data when offline)
      const allTemplates = await this.offlineCache.getVisualsTemplates();
      console.log('[StructuralHub] All templates loaded:', allTemplates?.length || 0);

      // Filter for TypeID === 1 (handle both string and number)
      const visualTemplates = (allTemplates || []).filter((template: any) => {
        const typeId = template.TypeID;
        return typeId === 1 || typeId === '1';
      });

      console.log('[StructuralHub] Visual templates (TypeID=1):', visualTemplates.length);
      if (allTemplates && allTemplates.length > 0) {
        console.log('[StructuralHub] Sample template TypeIDs:', allTemplates.slice(0, 3).map((t: any) => ({ TypeID: t.TypeID, type: typeof t.TypeID })));
      }

      // Extract unique categories in order
      const categoriesSet = new Set<string>();
      const categoriesOrder: string[] = [];

      visualTemplates.forEach((template: any) => {
        if (template.Category && !categoriesSet.has(template.Category)) {
          categoriesSet.add(template.Category);
          categoriesOrder.push(template.Category);
        }
      });

      console.log('[StructuralHub] Found', categoriesOrder.length, 'unique categories:', categoriesOrder);

      // Get deficiency counts for each category from saved visuals
      const deficiencyCounts = await this.getDeficiencyCountsByCategory();

      this.categories = categoriesOrder.map(cat => ({
        name: cat,
        deficiencyCount: deficiencyCounts[cat] || 0
      }));

      console.log('[StructuralHub] Categories loaded:', this.categories.length, this.categories.map(c => c.name));
      this.changeDetectorRef.detectChanges();

    } catch (error) {
      console.error('[StructuralHub] Error loading categories:', error);
    }
  }

  private async getDeficiencyCountsByCategory(): Promise<{ [category: string]: number }> {
    try {
      // Load all existing visuals for this service (merged with offline pending)
      const visuals = await this.offlineCache.getVisualsByService(this.serviceId);

      console.log('[StructuralHub] Counting deficiencies from', visuals.length, 'visuals');

      // Count deficiencies by category
      const counts: { [category: string]: number } = {};

      visuals.forEach((visual: any) => {
        const kind = visual.Kind || '';
        const category = visual.Category || '';

        // Only count items marked as "Deficiency"
        if (kind === 'Deficiency' && category) {
          counts[category] = (counts[category] || 0) + 1;
        }
      });

      return counts;
    } catch (error) {
      console.error('[StructuralHub] Error counting deficiencies:', error);
      return {};
    }
  }

  navigateToCategory(categoryName: string) {
    this.router.navigate(['category', categoryName], { relativeTo: this.route });
  }

  isStructuralSystemsDisabled(): boolean {
    return this.serviceData.StructStat === 'Provided in Home Inspection Report';
  }

  getCategoryIcon(categoryName: string): string {
    const iconMap: { [key: string]: string } = {
      'Foundations': 'reorder-four-outline',
      'Grading and Drainage': 'water-outline',
      'General Conditions': 'document-text-outline',
      'Roof Structure': 'home-outline',
      'Floor Framing': 'grid-outline',
      'Wall Framing': 'apps-outline',
      'Attic': 'triangle-outline',
      'Crawlspace': 'arrow-down-outline',
      'Crawlspaces': 'arrow-down-outline',
      'Walls (Interior and Exterior)': 'albums-outline',
      'Ceilings and Floors': 'layers-outline',
      'Doors (Interior and Exterior)': 'enter-outline',
      'Windows': 'scan-outline',
      'Other': 'ellipsis-horizontal-circle-outline',
      'Basements': 'cube-outline'
    };

    return iconMap[categoryName] || 'construct-outline';
  }

  onStructuralSystemsStatusChange(value: string) {
    // Store in local serviceData
    this.serviceData.StructStat = value;

    // Trigger change detection for conditional content visibility
    this.changeDetectorRef.detectChanges();

    // Save to Services table using the database column name "StructStat"
    this.autoSaveServiceField('StructStat', value);
  }

  private async autoSaveServiceField(fieldName: string, value: any) {
    if (!this.serviceId) {
      console.error('[StructuralHub] Cannot save: serviceId is missing');
      return;
    }

    console.log(`[StructuralHub] Saving service field ${fieldName}:`, value);

    // 1. Update local data immediately
    this.serviceData[fieldName] = value;

    // 2. Update IndexedDB cache immediately (offline-first)
    try {
      await this.offlineTemplate.updateService(this.serviceId, { [fieldName]: value });
      console.log(`[StructuralHub] ${fieldName} saved to IndexedDB`);
    } catch (error) {
      console.error(`[StructuralHub] Error saving ${fieldName} to IndexedDB:`, error);
    }

    // 3. Trigger background sync (will push to server when online)
    this.backgroundSync.triggerSync();
  }
}
