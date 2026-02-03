import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { liveQuery } from 'dexie';
import { CaspioService } from '../../../../services/caspio.service';
import { EngineersFoundationDataService } from '../../engineers-foundation-data.service';
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
  
  private visualFieldsSubscription?: Subscription;  // DEXIE-FIRST: liveQuery subscription
  private initialLoadComplete: boolean = false;
  private cachedTemplates: any[] = [];  // Cache templates for instant category extraction
  private isDestroyed: boolean = false;  // Guard for async operations

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private caspioService: CaspioService,
    private changeDetectorRef: ChangeDetectorRef,
    private foundationData: EngineersFoundationDataService,
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

    // NOTE: Cache invalidation subscriptions removed - liveQuery handles reactive updates automatically
  }

  /**
   * Ionic lifecycle hook - called when navigating back to this page
   * DEXIE-FIRST: liveQuery handles reactive updates, no manual reload needed
   */
  async ionViewWillEnter() {
    console.log('[StructuralHub] ionViewWillEnter - liveQuery handles counts automatically');

    // Ensure liveQuery subscription is active (may have been cleaned up)
    if (this.initialLoadComplete && this.serviceId && !this.visualFieldsSubscription) {
      this.subscribeToVisualFieldsChanges();
    }
  }

  ngOnDestroy() {
    // Set flag FIRST to prevent async operations from crashing
    this.isDestroyed = true;

    // DEXIE-FIRST: Clean up liveQuery subscription
    if (this.visualFieldsSubscription) {
      this.visualFieldsSubscription.unsubscribe();
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

    // ========================================
    // DEXIE-FIRST: Instant loading pattern
    // Show UI immediately, subscribe to liveQuery for reactive updates
    // ========================================

    // CRITICAL: Set loading=false IMMEDIATELY to prevent loading screen flash
    // Data will populate via liveQuery as it becomes available
    this.loading = false;
    this.isOnline = this.offlineService.isOnline();
    this.changeDetectorRef.detectChanges();
    console.log('[StructuralHub] ✅ Loading set to false immediately');

    // Read templates and service data (these are fast IndexedDB reads)
    const [templates, cachedService] = await Promise.all([
      this.indexedDb.getCachedTemplates('visual'),
      this.offlineTemplate.getService(this.serviceId)
    ]);

    // Guard after async
    if (this.isDestroyed) return;

    this.cachedTemplates = templates || [];

    if (cachedService) {
      this.serviceData = cachedService;
      console.log('[StructuralHub] ✅ Service loaded from cache');
    }

    // Extract categories from templates (pure CPU operation)
    if (this.cachedTemplates.length > 0) {
      this.extractCategoriesFromTemplates();
    }

    this.initialLoadComplete = true;
    this.changeDetectorRef.detectChanges();
    console.log('[StructuralHub] ✅ Data loaded');

    // DEXIE-FIRST: Subscribe to liveQuery for reactive count updates
    // This automatically updates counts when visualFields change
    this.subscribeToVisualFieldsChanges();

    // Check for pending sync items (non-blocking)
    this.indexedDb.getPendingRequests().then(pendingRequests => {
      this.hasPendingSync = pendingRequests.some(r =>
        r.endpoint.includes('Services_Visuals') && r.status === 'pending'
      );
      this.changeDetectorRef.detectChanges();
    });

    // Load service from API if not cached (non-blocking)
    if (!cachedService) {
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
  }

  /**
   * DEXIE-FIRST: Extract categories from cached templates (instant - CPU only)
   */
  private extractCategoriesFromTemplates() {
    // Filter for visual templates (TypeID=1)
    const visualTemplates = this.cachedTemplates.filter((t: any) => t.TypeID === 1);
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

    // Initialize categories with zero counts (liveQuery will update counts)
    this.categories = categoriesOrder.map(cat => ({
      name: cat,
      commentCount: 0,
      limitationCount: 0,
      deficiencyCount: 0
    }));

    this.isEmpty = this.categories.length === 0;
    console.log('[StructuralHub] ✅ Categories extracted:', this.categories.length);
  }

  /**
   * DEXIE-FIRST: Subscribe to visualFields liveQuery for reactive count updates
   * Automatically updates category counts when fields are added/modified/removed
   */
  private subscribeToVisualFieldsChanges() {
    if (!this.serviceId) return;

    // Unsubscribe from existing subscription
    if (this.visualFieldsSubscription) {
      this.visualFieldsSubscription.unsubscribe();
    }

    // Create liveQuery observable for visualFields
    const visualFields$ = liveQuery(() =>
      db.visualFields
        .where('serviceId')
        .equals(this.serviceId)
        .toArray()
    );

    // Subscribe to reactive updates
    this.visualFieldsSubscription = visualFields$.subscribe({
      next: (visualFields: any[]) => {
        // Guard against processing after destruction
        if (this.isDestroyed) return;

        console.log('[StructuralHub] DEXIE-FIRST: liveQuery update -', visualFields.length, 'fields');

        // Calculate counts per category from visualFields
        const counts: { [category: string]: { comments: number; limitations: number; deficiencies: number } } = {};

        visualFields.forEach((field: any) => {
          // Only count SELECTED items
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

        // Update category counts (keep existing categories, just update counts)
        this.categories.forEach(cat => {
          cat.commentCount = counts[cat.name]?.comments || 0;
          cat.limitationCount = counts[cat.name]?.limitations || 0;
          cat.deficiencyCount = counts[cat.name]?.deficiencies || 0;
        });

        // Safe change detection
        try {
          this.changeDetectorRef.detectChanges();
        } catch (err) {
          console.warn('[StructuralHub] detectChanges failed:', err);
        }
      },
      error: (err: any) => {
        console.error('[StructuralHub] DEXIE-FIRST: liveQuery error:', err);
      }
    });
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

  // NOTE: loadCategoriesFromTemplates, loadCategories, getCategoryCountsFast removed
  // DEXIE-FIRST: liveQuery subscription in subscribeToVisualFieldsChanges() handles all reactive updates

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
      if (environment.isWeb) {
        // WEBAPP: Direct API call
        await this.caspioService.updateService(this.serviceId, updateData).toPromise();
        console.log(`[StructuralHub] WEBAPP: Successfully saved ${fieldName} to API`);
      } else {
        // MOBILE: Use OfflineTemplateService to save to IndexedDB and queue for sync
        await this.offlineTemplate.updateService(this.serviceId, updateData);
        console.log(`[StructuralHub] MOBILE: Successfully saved ${fieldName} to IndexedDB`);
      }
    } catch (error) {
      console.error(`[StructuralHub] Error saving ${fieldName}:`, error);
    }
  }
}
