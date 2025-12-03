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

  async loadCategories() {
    try {
      console.log('[LBW Categories] Loading categories from LPS_Services_LBW_Templates...');
      const templates = await this.caspioService.getServicesLBWTemplates().toPromise();
      
      // Extract unique categories and count items
      const categoryMap = new Map<string, number>();
      (templates || []).forEach((template: any) => {
        if (template.Category) {
          const count = categoryMap.get(template.Category) || 0;
          categoryMap.set(template.Category, count + 1);
        }
      });

      // Create category cards
      this.categories = Array.from(categoryMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([title, count]) => ({
          title,
          icon: 'construct-outline',
          count
        }));

      console.log('[LBW Categories] Loaded categories:', this.categories);
    } catch (error) {
      console.error('[LBW Categories] Error loading categories:', error);
    }
  }

  navigateToCategory(category: CategoryCard) {
    console.log('[LBW Categories] Navigating to category:', category.title);
    this.router.navigate(['..', 'category', category.title], { relativeTo: this.route });
  }
}

