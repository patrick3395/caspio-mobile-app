import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { CaspioService } from '../../../../services/caspio.service';
import { EngineersFoundationDataService } from '../../engineers-foundation-data.service';
import { OfflineDataCacheService } from '../../../../services/offline-data-cache.service';
import { OfflineTemplateService } from '../../../../services/offline-template.service';
import { IndexedDbService } from '../../../../services/indexed-db.service';
import { OfflineService } from '../../../../services/offline.service';
import { db } from '../../../../services/caspio-db';
import { environment } from '../../../../../environments/environment';

@Component({
  selector: 'app-structural-systems-hub',
  templateUrl: './structural-systems-hub.page.html',
  styleUrls: ['./structural-systems-hub.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class StructuralSystemsHubPage implements OnInit, OnDestroy, ViewWillEnter {
  projectId: string = '';
  serviceId: string = '';
  categories: { name: string; commentCount: number; limitationCount: number; deficiencyCount: number }[] = [];
  loading: boolean = true;
  serviceData: any = {};

  // Standardized UI state flags
  isOnline: boolean = true;
  isEmpty: boolean = false;
  hasPendingSync: boolean = false;

  // WEBAPP: Expose isWeb for template skeleton loader conditionals
  isWeb = environment.isWeb;
  
  private cacheInvalidationSubscription?: Subscription;
  private backgroundRefreshSubscription?: Subscription;
  private cacheInvalidationDebounceTimer: any = null;
  private isLoadingCategories: boolean = false;  // Prevent concurrent loads
  private initialLoadComplete: boolean = false;  // Skip cache invalidation during initial load

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private caspioService: CaspioService,
    private changeDetectorRef: ChangeDetectorRef,
    private foundationData: EngineersFoundationDataService,
    private offlineCache: OfflineDataCacheService,
    private offlineTemplate: OfflineTemplateService,
    private indexedDb: IndexedDbService,
    private offlineService: OfflineService
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

    // Subscribe to cache invalidation events - reload data when sync completes
    // CRITICAL: Debounce to prevent multiple rapid reloads
    this.cacheInvalidationSubscription = this.foundationData.cacheInvalidated$.subscribe(event => {
      // Skip during initial load to prevent race conditions
      if (!this.initialLoadComplete) {
        console.log('[StructuralHub] Skipping cache invalidation - initial load not complete');
        return;
      }
      
      // Skip if already loading categories
      if (this.isLoadingCategories) {
        console.log('[StructuralHub] Skipping cache invalidation - already loading categories');
        return;
      }
      
      if (!event.serviceId || event.serviceId === this.serviceId) {
        // Clear any existing debounce timer
        if (this.cacheInvalidationDebounceTimer) {
          clearTimeout(this.cacheInvalidationDebounceTimer);
        }
        
        // Debounce: wait 500ms before reloading to batch multiple rapid events
        this.cacheInvalidationDebounceTimer = setTimeout(() => {
          console.log('[StructuralHub] Cache invalidated (debounced), reloading deficiency counts...');
          this.loadCategories();
        }, 500);
      }
    });

    // STANDARDIZED: Subscribe to background refresh completion
    // This ensures UI updates when data is refreshed in the background
    this.backgroundRefreshSubscription = this.offlineTemplate.backgroundRefreshComplete$.subscribe(event => {
      if (event.serviceId === this.serviceId && event.dataType === 'visuals') {
        console.log('[StructuralHub] Background refresh complete for visuals, reloading...');
        // Debounce with same timer to prevent duplicate reloads
        if (this.cacheInvalidationDebounceTimer) {
          clearTimeout(this.cacheInvalidationDebounceTimer);
        }
        this.cacheInvalidationDebounceTimer = setTimeout(() => {
          this.loadCategories();
        }, 500);
      }
    });
  }

  /**
   * Ionic lifecycle hook - called when navigating back to this page
   * Ensures deficiency counts are refreshed when returning from category details
   */
  async ionViewWillEnter() {
    console.log('[StructuralHub] ionViewWillEnter - Reloading categories from cache');
    
    // Only reload if initial load is complete and we have IDs
    if (this.initialLoadComplete && this.serviceId) {
      await this.loadCategories();
    }
  }

  ngOnDestroy() {
    if (this.cacheInvalidationSubscription) {
      this.cacheInvalidationSubscription.unsubscribe();
    }
    if (this.backgroundRefreshSubscription) {
      this.backgroundRefreshSubscription.unsubscribe();
    }
    if (this.cacheInvalidationDebounceTimer) {
      clearTimeout(this.cacheInvalidationDebounceTimer);
    }
  }

  private async loadData() {
    console.log('[StructuralHub] loadData() starting...');

    // WEBAPP MODE: Load from API to see synced data from mobile
    if (environment.isWeb) {
      console.log('[StructuralHub] WEBAPP MODE: Loading data from API');
      await this.loadDataFromAPI();
      return;
    }

    // MOBILE MODE: Use cache-first pattern
    // Update online status
    this.isOnline = this.offlineService.isOnline();

    // Read templates ONCE and reuse
    const cachedTemplates = await this.indexedDb.getCachedTemplates('visual');
    const hasCachedTemplates = !!(cachedTemplates && cachedTemplates.length > 0);

    // Read service ONCE and reuse
    const cachedService = await this.offlineTemplate.getService(this.serviceId);

    // Only show loading spinner if we TRULY need to fetch from network
    if (!hasCachedTemplates || !cachedService) {
      this.loading = true;
      this.changeDetectorRef.detectChanges();
    }

    try {
      // Use cached service data directly
      if (cachedService) {
        this.serviceData = cachedService;
        console.log('[StructuralHub] ✅ Service loaded from cache (instant)');
      } else {
        // Fallback to API only if not cached
        this.caspioService.getService(this.serviceId).subscribe({
          next: (service) => {
            this.serviceData = service || {};
            this.changeDetectorRef.detectChanges();
          },
          error: (error) => {
            console.error('[StructuralHub] Error loading service:', error);
          }
        });
      }

      // Load categories - pass templates to avoid re-reading
      await this.loadCategoriesFromTemplates(cachedTemplates || []);

      // Check for pending sync items
      const pendingRequests = await this.indexedDb.getPendingRequests();
      this.hasPendingSync = pendingRequests.some(r =>
        r.endpoint.includes('Services_Visuals') && r.status === 'pending'
      );

      // Update isEmpty status
      this.isEmpty = this.categories.length === 0 && hasCachedTemplates;

      console.log('[StructuralHub] ✅ loadData() completed');
    } catch (error) {
      console.error('[StructuralHub] Error in loadData:', error);
    } finally {
      this.loading = false;
      this.initialLoadComplete = true;
      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * WEBAPP MODE: Load data directly from API to see synced data from mobile
   */
  private async loadDataFromAPI() {
    this.loading = true;
    this.isOnline = true;
    this.changeDetectorRef.detectChanges();

    try {
      // Load service data, templates, and visuals from API
      const [serviceData, templates, visuals] = await Promise.all([
        this.caspioService.getService(this.serviceId, false).toPromise(),
        this.foundationData.getVisualsTemplates(),
        this.foundationData.getVisualsByService(this.serviceId)
      ]);

      // Set service data (contains StructStat field for "Where will you provide visuals")
      this.serviceData = serviceData || {};
      console.log(`[StructuralHub] WEBAPP: Loaded serviceData, StructStat=${this.serviceData.StructStat}`);

      console.log(`[StructuralHub] WEBAPP: Loaded ${templates?.length || 0} templates, ${visuals?.length || 0} visuals from API`);

      // Filter for visual templates (TypeID=1)
      const visualTemplates = (templates || []).filter((t: any) => t.TypeID === 1);

      // Extract unique categories
      const categoriesSet = new Set<string>();
      const categoriesOrder: string[] = [];

      visualTemplates.forEach((template: any) => {
        if (template.Category && !categoriesSet.has(template.Category)) {
          categoriesSet.add(template.Category);
          categoriesOrder.push(template.Category);
        }
      });

      // Count visuals by category and kind from server data
      const counts: { [category: string]: { comments: number; limitations: number; deficiencies: number } } = {};

      (visuals || []).forEach((visual: any) => {
        const category = visual.Category || '';
        const kind = visual.Kind || '';

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

      this.categories = categoriesOrder.map(cat => ({
        name: cat,
        commentCount: counts[cat]?.comments || 0,
        limitationCount: counts[cat]?.limitations || 0,
        deficiencyCount: counts[cat]?.deficiencies || 0
      }));

      this.isEmpty = this.categories.length === 0;
      this.hasPendingSync = false;

      console.log(`[StructuralHub] WEBAPP: ${this.categories.length} categories loaded`);
    } catch (error) {
      console.error('[StructuralHub] WEBAPP: Error loading data:', error);
    } finally {
      this.loading = false;
      this.initialLoadComplete = true;
      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * Load categories directly from provided templates (no extra IndexedDB reads)
   */
  private async loadCategoriesFromTemplates(templates: any[]) {
    if (this.isLoadingCategories) {
      console.log('[StructuralHub] Already loading, skipping');
      return;
    }
    
    this.isLoadingCategories = true;
    
    try {
      // Filter for visual templates (TypeID=1)
      const visualTemplates = templates.filter((t: any) => t.TypeID === 1);
      console.log('[StructuralHub] ✅ Visual templates:', visualTemplates.length);

      // Extract unique categories - pure CPU operation, instant
      const categoriesSet = new Set<string>();
      const categoriesOrder: string[] = [];

      visualTemplates.forEach((template: any) => {
        if (template.Category && !categoriesSet.has(template.Category)) {
          categoriesSet.add(template.Category);
          categoriesOrder.push(template.Category);
        }
      });

      console.log('[StructuralHub] ✅ Categories:', categoriesOrder.length);

      // Get all counts - ONE IndexedDB read, no pending requests needed
      const allCounts = await this.getCategoryCountsFast();

      this.categories = categoriesOrder.map(cat => ({
        name: cat,
        commentCount: allCounts[cat]?.comments || 0,
        limitationCount: allCounts[cat]?.limitations || 0,
        deficiencyCount: allCounts[cat]?.deficiencies || 0
      }));

      this.changeDetectorRef.detectChanges();

    } catch (error) {
      console.error('[StructuralHub] Error loading categories:', error);
    } finally {
      this.isLoadingCategories = false;
    }
  }

  /**
   * Fallback for cache invalidation events - reads templates fresh
   */
  private async loadCategories() {
    const templates = await this.indexedDb.getCachedTemplates('visual') || [];
    await this.loadCategoriesFromTemplates(templates);
  }

  /**
   * DEXIE-FIRST: Fast category counts from visualFields table
   * This includes both synced items AND pending items that haven't synced yet
   * Returns counts for comments, limitations, and deficiencies per category
   */
  private async getCategoryCountsFast(): Promise<{ [category: string]: { comments: number; limitations: number; deficiencies: number } }> {
    try {
      const counts: { [category: string]: { comments: number; limitations: number; deficiencies: number } } = {};

      // DEXIE-FIRST: Read from visualFields table which contains all items (synced + pending)
      // This ensures counts update immediately when items are added, not after sync
      const visualFields = await db.visualFields
        .where('serviceId')
        .equals(this.serviceId)
        .toArray();

      console.log('[StructuralHub] DEXIE-FIRST: Found', visualFields.length, 'visual fields');

      visualFields.forEach((field: any) => {
        // Only count SELECTED items (isSelected = true)
        if (!field.isSelected) {
          return;
        }

        const kind = field.kind || '';
        const category = field.category || '';

        // Skip if no category
        if (!category) {
          return;
        }

        // Initialize category if not exists
        if (!counts[category]) {
          counts[category] = { comments: 0, limitations: 0, deficiencies: 0 };
        }

        // Count by kind
        if (kind === 'Comment') {
          counts[category].comments += 1;
        } else if (kind === 'Limitation') {
          counts[category].limitations += 1;
        } else if (kind === 'Deficiency') {
          counts[category].deficiencies += 1;
        }
      });

      return counts;
    } catch (error) {
      console.error('[StructuralHub] Error counting categories:', error);
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

    // OFFLINE-FIRST: Save to IndexedDB and queue for sync
    this.autoSaveServiceField('StructStat', value);
  }

  private async autoSaveServiceField(fieldName: string, value: any) {
    if (!this.serviceId) {
      console.error('[StructuralHub] Cannot save: serviceId is missing');
      return;
    }

    console.log(`[StructuralHub] Saving service field ${fieldName}:`, value);

    const updateData = { [fieldName]: value };

    try {
      // OFFLINE-FIRST: Use OfflineTemplateService to save to IndexedDB and queue for sync
      await this.offlineTemplate.updateService(this.serviceId, updateData);
      console.log(`[StructuralHub] Successfully saved ${fieldName} to IndexedDB`);
    } catch (error) {
      console.error(`[StructuralHub] Error saving ${fieldName}:`, error);
    }
  }
}
