import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { CaspioService } from '../../../../services/caspio.service';
import { EngineersFoundationDataService } from '../../engineers-foundation-data.service';
import { OfflineDataCacheService } from '../../../../services/offline-data-cache.service';
import { OfflineTemplateService } from '../../../../services/offline-template.service';
import { IndexedDbService } from '../../../../services/indexed-db.service';

@Component({
  selector: 'app-structural-systems-hub',
  templateUrl: './structural-systems-hub.page.html',
  styleUrls: ['./structural-systems-hub.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class StructuralSystemsHubPage implements OnInit, OnDestroy {
  projectId: string = '';
  serviceId: string = '';
  categories: { name: string; deficiencyCount: number }[] = [];
  loading: boolean = true;
  serviceData: any = {};
  
  private cacheInvalidationSubscription?: Subscription;
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
    private indexedDb: IndexedDbService
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
  }

  ngOnDestroy() {
    if (this.cacheInvalidationSubscription) {
      this.cacheInvalidationSubscription.unsubscribe();
    }
    if (this.cacheInvalidationDebounceTimer) {
      clearTimeout(this.cacheInvalidationDebounceTimer);
    }
  }

  private async loadData() {
    console.log('[StructuralHub] loadData() starting...');
    
    // Read templates ONCE and reuse
    const cachedTemplates = await this.indexedDb.getCachedTemplates('visual');
    const hasCachedTemplates = cachedTemplates && cachedTemplates.length > 0;
    
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

      // Get deficiency counts - ONE IndexedDB read, no pending requests needed
      const deficiencyCounts = await this.getDeficiencyCountsFast();

      this.categories = categoriesOrder.map(cat => ({
        name: cat,
        deficiencyCount: deficiencyCounts[cat] || 0
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
   * Fast deficiency count - reads ONLY cached visuals, skips pending requests
   * For category display, we don't need pending items (they're still syncing)
   */
  private async getDeficiencyCountsFast(): Promise<{ [category: string]: number }> {
    try {
      // ONE IndexedDB read - directly get cached visuals, no pending request check
      const visuals = await this.indexedDb.getCachedServiceData(this.serviceId, 'visuals') || [];

      const counts: { [category: string]: number } = {};

      visuals.forEach((visual: any) => {
        const kind = visual.Kind || '';
        const category = visual.Category || '';

        // Only count Deficiency items that are NOT hidden
        if (kind === 'Deficiency' && category && !String(visual.Notes || '').startsWith('HIDDEN')) {
          counts[category] = (counts[category] || 0) + 1;
        }
      });

      return counts;
    } catch (error) {
      console.error('[StructuralHub] Error counting deficiencies:', error);
      return {};
    }
  }

  // Keep old method for compatibility but mark as unused
  private async getDeficiencyCountsByCategory(): Promise<{ [category: string]: number }> {
    return this.getDeficiencyCountsFast();
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
