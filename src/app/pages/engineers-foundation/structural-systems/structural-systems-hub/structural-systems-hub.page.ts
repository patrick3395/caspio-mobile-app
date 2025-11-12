import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { CaspioService } from '../../../../services/caspio.service';

@Component({
  selector: 'app-structural-systems-hub',
  templateUrl: './structural-systems-hub.page.html',
  styleUrls: ['./structural-systems-hub.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
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
    private caspioService: CaspioService
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

      // Get deficiency counts for each category
      // TODO: Load actual deficiency counts from saved visuals
      this.categories = categoriesOrder.map(cat => ({
        name: cat,
        deficiencyCount: 0
      }));

    } catch (error) {
      console.error('Error loading categories:', error);
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
      'Foundations': 'business-outline',
      'Grading and Drainage': 'water-outline',
      'General Conditions': 'document-text-outline',
      'Roof Structure': 'home-outline',
      'Floor Framing': 'grid-outline',
      'Wall Framing': 'apps-outline',
      'Attic': 'triangle-outline',
      'Crawlspace': 'arrow-down-outline',
      'Crawlspaces': 'arrow-down-outline',
      'Walls (Interior and Exterior)': 'square-outline',
      'Ceilings and Floors': 'layers-outline',
      'Doors (Interior and Exterior)': 'enter-outline',
      'Windows': 'stop-outline',
      'Other': 'ellipsis-horizontal-circle-outline',
      'Basements': 'cube-outline'
    };

    return iconMap[categoryName] || 'construct-outline';
  }
}
