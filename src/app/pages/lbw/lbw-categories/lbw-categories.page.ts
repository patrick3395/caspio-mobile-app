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
  commentCount: number;
  limitationCount: number;
  deficiencyCount: number;
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

  async ionViewWillEnter() {
    // WEBAPP: Reload categories to refresh counts when returning to this page
    if (environment.isWeb && this.serviceId) {
      this.loading = false;
      await this.loadCategories();
    }
  }

  async loadCategories() {
    try {
      console.log('[LBW Categories] Loading categories from LPS_Services_LBW_Templates...');

      // Load templates and existing LBW records in parallel
      const [templates, existingRecords] = await Promise.all([
        this.caspioService.getServicesLBWTemplates().toPromise(),
        this.caspioService.getServicesLBWByServiceId(this.serviceId).toPromise()
      ]);

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

      // Count existing records by category and kind (excluding hidden items)
      const kindCounts: { [category: string]: { comments: number; limitations: number; deficiencies: number } } = {};

      console.log('[LBW Categories] Existing records count:', (existingRecords || []).length);
      if (existingRecords && existingRecords.length > 0) {
        console.log('[LBW Categories] Sample record:', existingRecords[0]);
      }

      (existingRecords || []).forEach((record: any) => {
        const category = record.Category || '';
        const kind = record.Kind || '';
        // Use startsWith for hidden check (consistent with category-detail page)
        const isHidden = record.Notes && String(record.Notes).startsWith('HIDDEN');

        if (!category || isHidden) return;

        if (!kindCounts[category]) {
          kindCounts[category] = { comments: 0, limitations: 0, deficiencies: 0 };
        }

        if (kind === 'Comment') {
          kindCounts[category].comments += 1;
        } else if (kind === 'Limitation') {
          kindCounts[category].limitations += 1;
        } else if (kind === 'Deficiency') {
          kindCounts[category].deficiencies += 1;
        }
      });

      console.log('[LBW Categories] Kind counts by category:', kindCounts);

      // Create category cards in database order (not alphabetically sorted)
      this.categories = categoriesOrder.map(title => ({
        title,
        icon: 'construct-outline',
        count: categoryCounts.get(title) || 0,
        commentCount: kindCounts[title]?.comments || 0,
        limitationCount: kindCounts[title]?.limitations || 0,
        deficiencyCount: kindCounts[title]?.deficiencies || 0
      }));

      console.log('[LBW Categories] Loaded categories with counts:', this.categories);
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

