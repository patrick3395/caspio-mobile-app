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
    // Get IDs from parent route
    this.route.parent?.params.subscribe(params => {
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];

      this.loadData();
    });
  }

  private async loadData() {
    this.loading = true;

    try {
      // Load service data to check StructuralSystemsStatus
      this.caspioService.getService(this.serviceId).subscribe({
        next: async (service) => {
          this.serviceData = service || {};

          // Only load categories if status is "Completed Here"
          if (this.serviceData.StructStat === 'Completed Here') {
            await this.loadCategories();
          }

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

      // Extract unique categories in order
      const categoriesSet = new Set<string>();
      const categoriesOrder: string[] = [];

      visualTemplates.forEach((template: any) => {
        if (template.Category && !categoriesSet.has(template.Category)) {
          categoriesSet.add(template.Category);
          categoriesOrder.push(template.Category);
        }
      });

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

  goBack() {
    this.router.navigate(['..'], { relativeTo: this.route });
  }

  isStructuralSystemsDisabled(): boolean {
    return this.serviceData.StructStat === 'Provided in Home Inspection Report';
  }
}
