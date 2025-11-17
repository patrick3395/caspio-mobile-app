import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { CaspioService } from '../../../../services/caspio.service';
import { EngineersFoundationDataService } from '../../engineers-foundation-data.service';

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
    private foundationData: EngineersFoundationDataService
  ) {}

  async ngOnInit() {
    // Get IDs from parent route (container level)
    // Route structure: engineers-foundation/:projectId/:serviceId -> structural -> (hub is here)
    // So we need to go up 2 levels: route.parent.parent
    this.route.parent?.parent?.params.subscribe(params => {
      console.log('Route params from parent.parent:', params);
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];

      console.log('ProjectId:', this.projectId, 'ServiceId:', this.serviceId);

      if (this.projectId && this.serviceId) {
        this.loadData();
      } else {
        console.error('Missing projectId or serviceId');
        this.loading = false;
      }
    });
  }

  private async loadData() {
    this.loading = true;

    try {
      // Load service data to check StructuralSystemsStatus
      this.caspioService.getService(this.serviceId).subscribe({
        next: async (service) => {
          this.serviceData = service || {};

          // Always load categories - just disable if needed
          await this.loadCategories();

          this.loading = false;
        },
        error: (error) => {
          console.error('Error loading service:', error);
          this.loading = false;
        }
      });
    } catch (error) {
      console.error('Error in loadData:', error);
      this.loading = false;
    }
  }

  private async loadCategories() {
    try {
      // Get all templates for TypeID = 1 (Foundation Evaluation)
      const allTemplates = await this.caspioService.getServicesVisualsTemplates().toPromise();
      const visualTemplates = (allTemplates || []).filter((template: any) => template.TypeID === 1);

      console.log('Loaded templates:', visualTemplates.length);

      // Extract unique categories in order
      const categoriesSet = new Set<string>();
      const categoriesOrder: string[] = [];

      visualTemplates.forEach((template: any) => {
        if (template.Category && !categoriesSet.has(template.Category)) {
          categoriesSet.add(template.Category);
          categoriesOrder.push(template.Category);
          console.log('Found category:', template.Category);
        }
      });

      console.log('Total unique categories:', categoriesOrder.length);
      console.log('Categories:', categoriesOrder);

      // Get deficiency counts for each category from saved visuals
      const deficiencyCounts = await this.getDeficiencyCountsByCategory();

      this.categories = categoriesOrder.map(cat => ({
        name: cat,
        deficiencyCount: deficiencyCounts[cat] || 0
      }));

      console.log('Categories with deficiency counts:', this.categories);

    } catch (error) {
      console.error('Error loading categories:', error);
    }
  }

  private async getDeficiencyCountsByCategory(): Promise<{ [category: string]: number }> {
    try {
      // Load all existing visuals for this service
      const visuals = await this.foundationData.getVisualsByService(this.serviceId);
      
      console.log('[Deficiency Count] Found', visuals.length, 'total visuals');

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

      console.log('[Deficiency Count] Counts by category:', counts);

      return counts;
    } catch (error) {
      console.error('Error counting deficiencies:', error);
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
