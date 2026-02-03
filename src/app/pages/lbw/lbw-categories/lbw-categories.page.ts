import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { liveQuery } from 'dexie';
import { CaspioService } from '../../../services/caspio.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { IndexedDbService } from '../../../services/indexed-db.service';
import { db } from '../../../services/caspio-db';
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
export class LbwCategoriesPage implements OnInit, OnDestroy, ViewWillEnter {
  categories: CategoryCard[] = [];
  projectId: string = '';
  serviceId: string = '';
  loading: boolean = true;

  private lbwFieldsSubscription?: Subscription;  // DEXIE-FIRST: liveQuery subscription
  private initialLoadComplete: boolean = false;
  private cachedTemplates: any[] = [];
  private isDestroyed: boolean = false;  // Guard for async operations

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private caspioService: CaspioService,
    private offlineTemplate: OfflineTemplateService,
    private indexedDb: IndexedDbService,
    private changeDetectorRef: ChangeDetectorRef
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

      await this.loadData();
    });
  }

  ionViewWillEnter() {
    console.log('[LBW Categories] ionViewWillEnter - liveQuery handles counts automatically');

    // Ensure liveQuery subscription is active
    if (this.initialLoadComplete && this.serviceId && !this.lbwFieldsSubscription) {
      this.subscribeToLbwFieldsChanges();
    }
  }

  ngOnDestroy() {
    this.isDestroyed = true;
    if (this.lbwFieldsSubscription) {
      this.lbwFieldsSubscription.unsubscribe();
    }
  }

  private async loadData() {
    console.log('[LBW Categories] loadData() starting...');

    // WEBAPP MODE: Load from API
    if (environment.isWeb) {
      await this.loadCategoriesFromAPI();
      return;
    }

    // ========================================
    // DEXIE-FIRST: Instant loading pattern
    // ========================================

    // CRITICAL: Set loading=false IMMEDIATELY to prevent loading screen flash
    this.loading = false;
    this.changeDetectorRef.detectChanges();
    console.log('[LBW Categories] ✅ Loading set to false immediately');

    // Load templates from cache (fast IndexedDB read)
    this.cachedTemplates = await this.indexedDb.getCachedTemplates('lbw') || [];

    // Guard after async
    if (this.isDestroyed) return;

    // Extract categories from templates (instant - CPU only)
    if (this.cachedTemplates.length > 0) {
      this.extractCategoriesFromTemplates();
    }

    this.initialLoadComplete = true;
    this.changeDetectorRef.detectChanges();
    console.log('[LBW Categories] ✅ Data loaded');

    // Subscribe to liveQuery for reactive count updates
    this.subscribeToLbwFieldsChanges();
  }

  /**
   * DEXIE-FIRST: Extract categories from cached templates
   */
  private extractCategoriesFromTemplates() {
    const categoriesSet = new Set<string>();
    const categoriesOrder: string[] = [];
    const categoryCounts = new Map<string, number>();

    this.cachedTemplates.forEach((template: any) => {
      if (template.Category && !categoriesSet.has(template.Category)) {
        categoriesSet.add(template.Category);
        categoriesOrder.push(template.Category);
      }
      if (template.Category) {
        const count = categoryCounts.get(template.Category) || 0;
        categoryCounts.set(template.Category, count + 1);
      }
    });

    // Initialize categories with zero counts (liveQuery will update)
    this.categories = categoriesOrder.map(title => ({
      title,
      icon: 'construct-outline',
      count: categoryCounts.get(title) || 0,
      commentCount: 0,
      limitationCount: 0,
      deficiencyCount: 0
    }));

    console.log('[LBW Categories] ✅ Categories extracted:', this.categories.length);
  }

  /**
   * DEXIE-FIRST: Subscribe to lbwFields liveQuery for reactive count updates
   */
  private subscribeToLbwFieldsChanges() {
    if (!this.serviceId) return;

    if (this.lbwFieldsSubscription) {
      this.lbwFieldsSubscription.unsubscribe();
    }

    const lbwFields$ = liveQuery(() =>
      db.lbwFields
        .where('serviceId')
        .equals(this.serviceId)
        .toArray()
    );

    this.lbwFieldsSubscription = lbwFields$.subscribe({
      next: (fields: any[]) => {
        // Guard against processing after destruction
        if (this.isDestroyed) return;

        console.log('[LBW Categories] DEXIE-FIRST: liveQuery update -', fields.length, 'fields');

        // Calculate counts per category
        const counts: { [category: string]: { comments: number; limitations: number; deficiencies: number } } = {};

        fields.forEach((field: any) => {
          if (!field.isSelected) return;

          const kind = field.kind || '';
          const category = field.category || '';
          if (!category) return;

          if (!counts[category]) {
            counts[category] = { comments: 0, limitations: 0, deficiencies: 0 };
          }

          if (kind === 'Comment') {
            counts[category].comments += 1;
          } else if (kind === 'Limitation') {
            counts[category].limitations += 1;
          } else if (kind === 'Deficiency') {
            counts[category].deficiencies += 1;
          }
        });

        // Update category counts
        this.categories.forEach(cat => {
          cat.commentCount = counts[cat.title]?.comments || 0;
          cat.limitationCount = counts[cat.title]?.limitations || 0;
          cat.deficiencyCount = counts[cat.title]?.deficiencies || 0;
        });

        // Safe change detection
        try {
          this.changeDetectorRef.detectChanges();
        } catch (err) {
          console.warn('[LBW Categories] detectChanges failed:', err);
        }
      },
      error: (err: any) => {
        console.error('[LBW Categories] DEXIE-FIRST: liveQuery error:', err);
      }
    });
  }

  /**
   * WEBAPP: Load categories from API
   */
  private async loadCategoriesFromAPI() {
    try {
      const [templates, existingRecords] = await Promise.all([
        this.offlineTemplate.getLbwTemplates(),
        this.offlineTemplate.getLbwByService(this.serviceId)
      ]);

      const categoriesSet = new Set<string>();
      const categoriesOrder: string[] = [];
      const categoryCounts = new Map<string, number>();

      (templates || []).forEach((template: any) => {
        if (template.Category && !categoriesSet.has(template.Category)) {
          categoriesSet.add(template.Category);
          categoriesOrder.push(template.Category);
        }
        if (template.Category) {
          const count = categoryCounts.get(template.Category) || 0;
          categoryCounts.set(template.Category, count + 1);
        }
      });

      const kindCounts: { [category: string]: { comments: number; limitations: number; deficiencies: number } } = {};

      (existingRecords || []).forEach((record: any) => {
        const category = record.Category || '';
        const kind = record.Kind || '';
        const isHidden = record.Notes && String(record.Notes).startsWith('HIDDEN');

        if (!category || isHidden) return;

        if (!kindCounts[category]) {
          kindCounts[category] = { comments: 0, limitations: 0, deficiencies: 0 };
        }

        if (kind === 'Comment') kindCounts[category].comments += 1;
        else if (kind === 'Limitation') kindCounts[category].limitations += 1;
        else if (kind === 'Deficiency') kindCounts[category].deficiencies += 1;
      });

      this.categories = categoriesOrder.map(title => ({
        title,
        icon: 'construct-outline',
        count: categoryCounts.get(title) || 0,
        commentCount: kindCounts[title]?.comments || 0,
        limitationCount: kindCounts[title]?.limitations || 0,
        deficiencyCount: kindCounts[title]?.deficiencies || 0
      }));

      console.log('[LBW Categories] WEBAPP: Loaded categories:', this.categories.length);
    } catch (error) {
      console.error('[LBW Categories] Error loading categories:', error);
    } finally {
      this.loading = false;
      this.initialLoadComplete = true;
      this.changeDetectorRef.detectChanges();
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

