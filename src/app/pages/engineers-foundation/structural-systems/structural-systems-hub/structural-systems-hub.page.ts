import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { CaspioService } from '../../../../services/caspio.service';
import { EngineersFoundationDataService } from '../../engineers-foundation-data.service';
import { OfflineDataCacheService } from '../../../../services/offline-data-cache.service';

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
    private offlineCache: OfflineDataCacheService
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
      // Load service data to check StructuralSystemsStatus (non-blocking)
      this.caspioService.getService(this.serviceId).subscribe({
        next: (service) => {
          this.serviceData = service || {};
          this.changeDetectorRef.detectChanges();
        },
        error: (error) => {
          console.error('[StructuralHub] Error loading service (continuing offline):', error);
        }
      });

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
      const visualTemplates = (allTemplates || []).filter((template: any) => template.TypeID === 1);

      console.log('[StructuralHub] Loaded templates:', visualTemplates.length);

      // Extract unique categories in order
      const categoriesSet = new Set<string>();
      const categoriesOrder: string[] = [];

      visualTemplates.forEach((template: any) => {
        if (template.Category && !categoriesSet.has(template.Category)) {
          categoriesSet.add(template.Category);
          categoriesOrder.push(template.Category);
        }
      });

      console.log('[StructuralHub] Found', categoriesOrder.length, 'unique categories');

      // Get deficiency counts for each category from saved visuals
      const deficiencyCounts = await this.getDeficiencyCountsByCategory();

      this.categories = categoriesOrder.map(cat => ({
        name: cat,
        deficiencyCount: deficiencyCounts[cat] || 0
      }));

      console.log('[StructuralHub] Categories loaded:', this.categories.length);

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

  private autoSaveServiceField(fieldName: string, value: any) {
    if (!this.serviceId) {
      console.error('Cannot save: serviceId is missing');
      return;
    }

    console.log(`Saving service field ${fieldName}:`, value);

    const updateData = { [fieldName]: value };

    this.caspioService.updateService(this.serviceId, updateData).subscribe({
      next: () => {
        console.log(`Successfully saved ${fieldName}`);
      },
      error: (error) => {
        console.error(`Error saving ${fieldName}:`, error);
      }
    });
  }
}
