import { Component, OnInit, OnDestroy, ChangeDetectorRef, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { OfflineService } from '../../../services/offline.service';
import { TemplateConfigService } from '../../../services/template/template-config.service';
import { TemplateConfig } from '../../../services/template/template-config.interface';
import { TEMPLATE_DATA_PROVIDER } from '../../../services/template/template-data-provider.factory';
import { ITemplateDataProvider, VisualRecord } from '../../../services/template/template-data-provider.interface';
import { environment } from '../../../../environments/environment';

interface CategoryCard {
  name: string;
  commentCount: number;
  limitationCount: number;
  deficiencyCount: number;
}

@Component({
  selector: 'app-generic-category-hub',
  templateUrl: './category-hub.page.html',
  styleUrls: ['./category-hub.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class GenericCategoryHubPage implements OnInit, OnDestroy, ViewWillEnter {
  config: TemplateConfig | null = null;
  private configSubscription?: Subscription;

  projectId: string = '';
  serviceId: string = '';
  categories: CategoryCard[] = [];
  loading: boolean = true;
  serviceData: any = {};

  // Standardized UI state flags
  isOnline: boolean = true;
  isEmpty: boolean = false;
  hasPendingSync: boolean = false;

  // WEBAPP: Expose isWeb for template conditionals
  isWeb = environment.isWeb;

  // Cached template state flags (updated when serviceData or config changes)
  showVisualLocationDropdown: boolean = false;
  visualsCompletedHere: boolean = false;
  visualsDisabled: boolean = false;
  showCategories: boolean = true;
  visualLocationFieldValue: string = '';

  private isLoadingCategories: boolean = false;
  private initialLoadComplete: boolean = false;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private changeDetectorRef: ChangeDetectorRef,
    private offlineService: OfflineService,
    private templateConfigService: TemplateConfigService,
    @Inject(TEMPLATE_DATA_PROVIDER) private dataProvider: ITemplateDataProvider
  ) {}

  async ngOnInit() {
    // Subscribe to template config changes
    this.configSubscription = this.templateConfigService.activeConfig$.subscribe(config => {
      this.config = config;
      this.updateCachedState();
      this.changeDetectorRef.detectChanges();
    });

    // Get IDs from parent route snapshot immediately (for offline reliability)
    // Route structure varies: some templates have categories under parent, others under parent.parent
    const parentParams = this.route.parent?.snapshot?.params;
    if (parentParams) {
      this.projectId = parentParams['projectId'] || '';
      this.serviceId = parentParams['serviceId'] || '';
    }

    // Fallback to parent.parent if not found
    if (!this.projectId || !this.serviceId) {
      const grandparentParams = this.route.parent?.parent?.snapshot?.params;
      if (grandparentParams) {
        this.projectId = grandparentParams['projectId'] || '';
        this.serviceId = grandparentParams['serviceId'] || '';
      }
    }

    if (this.projectId && this.serviceId) {
      this.loadData();
    }

    // Subscribe to param changes (for dynamic updates)
    // Check both parent and grandparent for templates with different route structures
    const paramsObservable = this.route.parent?.parent?.params || this.route.parent?.params;
    paramsObservable?.subscribe(params => {
      const newProjectId = params['projectId'];
      const newServiceId = params['serviceId'];

      if (newProjectId && newServiceId && (newProjectId !== this.projectId || newServiceId !== this.serviceId)) {
        this.projectId = newProjectId;
        this.serviceId = newServiceId;
        this.loadData();
      }
    });
  }

  async ionViewWillEnter() {

    // Only reload if initial load is complete and we have IDs
    if (this.initialLoadComplete && this.serviceId) {
      try {
        // Reload service data to get fresh field values (like StructStat)
        const serviceData = await this.dataProvider.getService(this.serviceId);
        this.serviceData = serviceData || {};
        this.updateCachedState();
        this.changeDetectorRef.detectChanges();
      } catch (error) {
        console.error('[CategoryHub] ionViewWillEnter: Error reloading service data:', error);
      }
      await this.loadCategories();
    }
  }

  ngOnDestroy() {
    if (this.configSubscription) {
      this.configSubscription.unsubscribe();
    }
  }

  private async loadData() {
    if (!this.config) {
      console.error('[CategoryHub] No config loaded');
      return;
    }

    this.loading = true;
    this.isOnline = this.offlineService.isOnline();
    this.changeDetectorRef.detectChanges();

    try {
      // Use unified dataProvider for all data operations
      const [serviceData, templates, visualsResult] = await Promise.all([
        this.dataProvider.getService(this.serviceId),
        this.dataProvider.getTemplates(this.config),
        this.dataProvider.getVisuals(this.config, this.serviceId)
      ]);

      this.serviceData = serviceData || {};
      this.hasPendingSync = visualsResult.hasPendingSync;
      this.updateCachedState();

      // Process templates and visuals to build category cards
      await this.processTemplatesAndRecords(templates || [], visualsResult.data || []);

      this.isEmpty = this.categories.length === 0;
    } catch (error) {
      console.error('[CategoryHub] Error loading data:', error);
    } finally {
      this.loading = false;
      this.initialLoadComplete = true;
      this.changeDetectorRef.detectChanges();
    }
  }

  private async loadCategories() {
    if (this.isLoadingCategories || !this.config) {
      return;
    }

    this.isLoadingCategories = true;

    try {
      // Use unified dataProvider for data operations
      const [templates, visualsResult] = await Promise.all([
        this.dataProvider.getTemplates(this.config),
        this.dataProvider.getVisuals(this.config, this.serviceId)
      ]);

      this.hasPendingSync = visualsResult.hasPendingSync;
      await this.processTemplatesAndRecords(templates || [], visualsResult.data || []);
    } catch (error) {
      console.error('[CategoryHub] Error loading categories:', error);
    } finally {
      this.isLoadingCategories = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  private async processTemplatesAndRecords(templates: any[], visuals: VisualRecord[]) {
    if (!this.config) return;

    // Extract unique categories in order they appear
    const categoriesSet = new Set<string>();
    const categoriesOrder: string[] = [];

    templates.forEach((template: any) => {
      if (template.Category && !categoriesSet.has(template.Category)) {
        categoriesSet.add(template.Category);
        categoriesOrder.push(template.Category);
      }
    });


    // Count visuals by category and kind
    const counts: { [category: string]: { comments: number; limitations: number; deficiencies: number } } = {};

    visuals.forEach((visual: VisualRecord) => {
      // VisualRecord already has normalized isSelected property
      if (!visual.isSelected) return;

      const category = visual.category || '';
      const kind = visual.kind || '';

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
  }

  trackByCategoryName(index: number, category: CategoryCard): string {
    return category.name;
  }

  navigateToCategory(categoryName: string) {
    // Navigation pattern depends on route structure:
    // - 'nested': /structural -> /structural/category/:cat (EFE)
    // - 'sibling': /categories -> /category/:cat (LBW, DTE)
    const pattern = this.config?.categoryHubFeatures?.navigationPattern || 'nested';

    if (pattern === 'sibling') {
      // Go up one level, then navigate to category
      this.router.navigate(['..', 'category', categoryName], { relativeTo: this.route });
    } else {
      // Navigate directly to nested category route
      this.router.navigate(['category', categoryName], { relativeTo: this.route });
    }
  }

  /**
   * Recompute cached template state flags.
   * Called when config, serviceData, or visual location changes.
   */
  private updateCachedState(): void {
    this.showVisualLocationDropdown = this.config?.categoryHubFeatures?.hasVisualLocationDropdown || false;

    if (this.config?.categoryHubFeatures?.visualLocationFieldName) {
      this.visualLocationFieldValue = this.serviceData[this.config.categoryHubFeatures.visualLocationFieldName] || '';
    } else {
      this.visualLocationFieldValue = '';
    }

    const completedHereValue = this.config?.categoryHubFeatures?.completedHereValue || 'Completed Here';
    const providedElsewhereValue = this.config?.categoryHubFeatures?.providedElsewhereValue || '';

    this.visualsCompletedHere = this.visualLocationFieldValue === completedHereValue;
    this.visualsDisabled = this.visualLocationFieldValue === providedElsewhereValue;
    this.showCategories = !this.showVisualLocationDropdown || this.visualsCompletedHere;
  }

  onVisualLocationChange(value: string) {

    if (!this.config?.categoryHubFeatures?.visualLocationFieldName) {
      console.error('[CategoryHub] No visualLocationFieldName in config');
      return;
    }

    const fieldName = this.config.categoryHubFeatures.visualLocationFieldName;

    // Store in local serviceData
    this.serviceData[fieldName] = value;

    // Recompute cached state flags and trigger change detection
    this.updateCachedState();
    this.changeDetectorRef.detectChanges();

    // Save to backend
    this.autoSaveServiceField(fieldName, value);
  }

  private async autoSaveServiceField(fieldName: string, value: any) {
    if (!this.serviceId) {
      console.error('[CategoryHub] Cannot save: serviceId is missing');
      return;
    }


    const updateData = { [fieldName]: value };

    try {
      // Use unified dataProvider - handles webapp/mobile differences internally
      await this.dataProvider.updateService(this.serviceId, updateData);

      // Update local serviceData to ensure UI consistency
      this.serviceData[fieldName] = value;
    } catch (error) {
      console.error(`[CategoryHub] Error saving ${fieldName}:`, error);
    }
  }

  // Static icon map - allocated once, not per change detection cycle
  private static readonly CATEGORY_ICON_MAP: { [key: string]: string } = {
    // EFE categories
    'Foundations': 'tablet-landscape-outline',
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
    'Basements': 'cube-outline',
    // LBW categories
    'Target wall': 'build-outline',
    'Target Wall': 'build-outline',
    '1st Floor above': 'document-text-outline',
    'Attic and roof above': 'document-text-outline',
    '1st Floor below': 'document-text-outline',
    'Basement': 'cube-outline',
    'Foundation below': 'document-text-outline',
    'Conclusion': 'document-text-outline',
    // DTE categories
    'Foundation': 'business-outline',
    'Structure': 'construct-outline'
  };

  getCategoryIcon(categoryName: string): string {
    return GenericCategoryHubPage.CATEGORY_ICON_MAP[categoryName] || 'construct-outline';
  }

}
