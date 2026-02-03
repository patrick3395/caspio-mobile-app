import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { liveQuery } from 'dexie';
import { CaspioService } from '../../../services/caspio.service';
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
  selector: 'app-dte-categories',
  templateUrl: './dte-categories.page.html',
  styleUrls: ['./dte-categories.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class DteCategoriesPage implements OnInit, OnDestroy, ViewWillEnter {
  categories: CategoryCard[] = [];
  projectId: string = '';
  serviceId: string = '';
  loading: boolean = true;

  private dteFieldsSubscription?: Subscription;  // DEXIE-FIRST: liveQuery subscription
  private initialLoadComplete: boolean = false;
  private cachedTemplates: any[] = [];
  private isDestroyed: boolean = false;  // Guard for async operations

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private caspioService: CaspioService,
    private indexedDb: IndexedDbService,
    private changeDetectorRef: ChangeDetectorRef
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

      await this.loadData();
    });
  }

  ionViewWillEnter() {
    console.log('[DTE Categories] ionViewWillEnter - liveQuery handles counts automatically');

    // Ensure liveQuery subscription is active
    if (this.initialLoadComplete && this.serviceId && !this.dteFieldsSubscription) {
      this.subscribeToDteFieldsChanges();
    }
  }

  ngOnDestroy() {
    this.isDestroyed = true;
    if (this.dteFieldsSubscription) {
      this.dteFieldsSubscription.unsubscribe();
    }
  }

  private async loadData() {
    console.log('[DTE Categories] loadData() starting...');

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
    console.log('[DTE Categories] ✅ Loading set to false immediately');

    // Load templates from cache (fast IndexedDB read)
    this.cachedTemplates = await this.indexedDb.getCachedTemplates('dte') || [];

    // Guard after async
    if (this.isDestroyed) return;

    // Extract categories from templates (instant - CPU only)
    if (this.cachedTemplates.length > 0) {
      this.extractCategoriesFromTemplates();
    }

    this.initialLoadComplete = true;
    this.changeDetectorRef.detectChanges();
    console.log('[DTE Categories] ✅ Data loaded');

    // Subscribe to liveQuery for reactive count updates
    this.subscribeToDteFieldsChanges();
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

    console.log('[DTE Categories] ✅ Categories extracted:', this.categories.length);
  }

  /**
   * DEXIE-FIRST: Subscribe to dteFields liveQuery for reactive count updates
   */
  private subscribeToDteFieldsChanges() {
    if (!this.serviceId) return;

    if (this.dteFieldsSubscription) {
      this.dteFieldsSubscription.unsubscribe();
    }

    const dteFields$ = liveQuery(() =>
      db.dteFields
        .where('serviceId')
        .equals(this.serviceId)
        .toArray()
    );

    this.dteFieldsSubscription = dteFields$.subscribe({
      next: (fields: any[]) => {
        // Guard against processing after destruction
        if (this.isDestroyed) return;

        console.log('[DTE Categories] DEXIE-FIRST: liveQuery update -', fields.length, 'fields');

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
          console.warn('[DTE Categories] detectChanges failed:', err);
        }
      },
      error: (err: any) => {
        console.error('[DTE Categories] DEXIE-FIRST: liveQuery error:', err);
      }
    });
  }

  /**
   * WEBAPP: Load categories from API
   */
  private async loadCategoriesFromAPI() {
    try {
      console.log('[DTE Categories] WEBAPP: Loading from API...');
      const templates = await this.caspioService.getServicesDTETemplates().toPromise();

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

      this.categories = categoriesOrder.map(title => ({
        title,
        icon: 'construct-outline',
        count: categoryCounts.get(title) || 0,
        commentCount: 0,
        limitationCount: 0,
        deficiencyCount: 0
      }));

      console.log('[DTE Categories] WEBAPP: Loaded categories:', this.categories.length);
    } catch (error) {
      console.error('[DTE Categories] Error loading categories:', error);
    } finally {
      this.loading = false;
      this.initialLoadComplete = true;
      this.changeDetectorRef.detectChanges();
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

