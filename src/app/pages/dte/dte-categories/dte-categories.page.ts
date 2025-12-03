import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { CaspioService } from '../../../services/caspio.service';

interface CategoryCard {
  title: string;
  icon: string;
  count: number;
}

@Component({
  selector: 'app-dte-categories',
  templateUrl: './dte-categories.page.html',
  styleUrls: ['./dte-categories.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class DteCategoriesPage implements OnInit {
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
      console.log('[DTE Categories] Route params from parent:', params);
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];

      if (!this.projectId || !this.serviceId) {
        console.error('[DTE Categories] Missing projectId or serviceId');
        this.loading = false;
        return;
      }
      
      await this.loadCategories();
      this.loading = false;
    });
  }

  async loadCategories() {
    try {
      console.log('[DTE Categories] Loading categories from LPS_Services_DTE_Templates...');
      const templates = await this.caspioService.getServicesDTETemplates().toPromise();
      
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

      console.log('[DTE Categories] Loaded categories in order:', this.categories);
    } catch (error) {
      console.error('[DTE Categories] Error loading categories:', error);
    }
  }

  navigateToCategory(category: CategoryCard) {
    console.log('[DTE Categories] Navigating to category:', category.title);
    this.router.navigate(['..', 'category', category.title], { relativeTo: this.route });
  }

  getCategoryIcon(categoryName: string): string {
    // Map category names to icons
    const iconMap: { [key: string]: string } = {
      'Target wall': 'construct-outline',
      'Foundation': 'business-outline',
      'Structure': 'construct-outline',
      'Default': 'document-text-outline'
    };

    return iconMap[categoryName] || iconMap['Default'];
  }
}

