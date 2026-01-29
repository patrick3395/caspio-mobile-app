import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { CaspioService } from '../../../services/caspio.service';
import { environment } from '../../../../environments/environment';

interface CategoryCard {
  title: string;
  icon: string;
  count: number;
}

@Component({
  selector: 'app-lbw-categories',
  templateUrl: './lbw-categories.page.html',
  styleUrls: ['./lbw-categories.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class LbwCategoriesPage implements OnInit {
  categories: CategoryCard[] = [];
  projectId: string = '';
  serviceId: string = '';
  loading: boolean = true;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private caspioService: CaspioService
  ) {}

  async ngOnInit() {
    // Get IDs from parent route (container level)
    this.route.parent?.params.subscribe(async params => {
      console.log('[LBW Categories] Route params from parent:', params);
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];

      if (!this.projectId || !this.serviceId) {
        console.error('[LBW Categories] Missing projectId or serviceId');
        this.loading = false;
        return;
      }

      await this.loadCategories();
      this.loading = false;
    });
  }

  ionViewWillEnter() {
    // WEBAPP: Clear loading state when returning to this page
    if (environment.isWeb) {
      this.loading = false;
    }
  }

  async loadCategories() {
    try {
      console.log('[LBW Categories] Loading categories from LPS_Services_LBW_Templates...');
      const templates = await this.caspioService.getServicesLBWTemplates().toPromise();
      
      // Extract unique categories in order they appear (preserve database order)
      const categoriesSet = new Set<string>();
      const categoriesOrder: string[] = [];
      const categoryCounts = new Map<string, number>();
      
      (templates || []).forEach((template: any) => {
        if (template.Category && !categoriesSet.has(template.Category)) {
          categoriesSet.add(template.Category);
          categoriesOrder.push(template.Category);
        }
        // Count items per category
        if (template.Category) {
          const count = categoryCounts.get(template.Category) || 0;
          categoryCounts.set(template.Category, count + 1);
        }
      });

      // Create category cards in database order (not alphabetically sorted)
      this.categories = categoriesOrder.map(title => ({
        title,
        icon: 'construct-outline',
        count: categoryCounts.get(title) || 0
      }));

      console.log('[LBW Categories] Loaded categories in order:', this.categories);
    } catch (error) {
      console.error('[LBW Categories] Error loading categories:', error);
    }
  }

  navigateToCategory(category: CategoryCard) {
    console.log('[LBW Categories] Navigating to category:', category.title);
    this.router.navigate(['..', 'category', category.title], { relativeTo: this.route });
  }

  getCategoryIcon(categoryName: string): string {
    // Map category names to icons - matching EFE structural-systems-hub pattern
    const iconMap: { [key: string]: string } = {
      'Target wall': 'build-outline',
      'Target Wall': 'build-outline',
      '1st Floor above': 'document-text-outline',
      'Attic and roof above': 'document-text-outline',
      '1st Floor below': 'document-text-outline',
      'Basement': 'cube-outline',
      'Foundation below': 'document-text-outline',
      'Conclusion': 'document-text-outline',
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

    return iconMap[categoryName] || 'document-text-outline';
  }
}

