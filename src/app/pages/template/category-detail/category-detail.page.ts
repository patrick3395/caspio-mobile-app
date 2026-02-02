import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { IonicModule, ToastController, LoadingController, AlertController, ModalController } from '@ionic/angular';
import { Subject, Subscription } from 'rxjs';
import { takeUntil, debounceTime, filter } from 'rxjs/operators';

import { environment } from '../../../../environments/environment';
import { TemplateConfig } from '../../../services/template/template-config.interface';
import { TemplateConfigService } from '../../../services/template/template-config.service';
import { TemplateDataAdapter } from '../../../services/template/template-data-adapter.service';
import { IndexedDbService } from '../../../services/indexed-db.service';
import { BackgroundSyncService } from '../../../services/background-sync.service';
import { PhotoHandlerService, PhotoCaptureConfig, ViewPhotoConfig, ViewPhotoResult, StandardPhotoEntry } from '../../../services/photo-handler.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { CaspioService } from '../../../services/caspio.service';
import { HudDataService } from '../../hud/hud-data.service';
import { LbwDataService } from '../../lbw/lbw-data.service';
import { DteDataService } from '../../dte/dte-data.service';
import { EngineersFoundationDataService } from '../../engineers-foundation/engineers-foundation-data.service';
import { HasUnsavedChanges } from '../../../services/unsaved-changes.service';
import { firstValueFrom } from 'rxjs';

/**
 * Visual item interface for category detail pages
 */
interface VisualItem {
  id: string | number;
  templateId: number;
  name: string;
  text: string;
  originalText: string;
  type: string;
  category: string;
  answerType: number;
  required: boolean;
  answer?: string;
  isSelected?: boolean;
  isSaving?: boolean;
  photos?: any[];
  otherValue?: string;
  key?: string;
}

/**
 * Organized data structure for the three sections
 */
interface OrganizedData {
  comments: VisualItem[];
  limitations: VisualItem[];
  deficiencies: VisualItem[];
}

/**
 * Debug log entry
 */
interface DebugLogEntry {
  time: string;
  type: string;
  message: string;
}

/**
 * GenericCategoryDetailPage - Unified category detail page for all templates
 *
 * This component consolidates the HUD, EFE, LBW, and DTE category detail pages
 * into a single config-driven implementation. It uses:
 * - TemplateConfigService for auto-detecting which template is active
 * - TemplateDataAdapter for config-driven data operations
 * - Config-driven feature flags for template-specific behavior
 */
@Component({
  selector: 'app-generic-category-detail',
  templateUrl: './category-detail.page.html',
  styleUrls: ['./category-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class GenericCategoryDetailPage implements OnInit, OnDestroy, HasUnsavedChanges {
  // ==================== Template Config ====================
  config: TemplateConfig | null = null;

  // ==================== Route Parameters ====================
  projectId: string = '';
  serviceId: string = '';
  actualServiceId: string = '';
  categoryName: string = '';

  // ==================== UI State ====================
  loading: boolean = true;
  isRefreshing: boolean = false;
  searchTerm: string = '';
  isWeb = environment.isWeb;

  // ==================== Data State ====================
  organizedData: OrganizedData = { comments: [], limitations: [], deficiencies: [] };
  visualDropdownOptions: { [templateId: number]: string[] } = {};
  selectedItems: { [key: string]: boolean } = {};
  savingItems: { [key: string]: boolean } = {};

  // ==================== Photo State ====================
  visualPhotos: { [key: string]: any[] } = {};
  visualRecordIds: { [key: string]: string } = {};
  uploadingPhotosByKey: { [key: string]: boolean } = {};
  loadingPhotosByKey: { [key: string]: boolean } = {};
  photoCountsByKey: { [key: string]: number } = {};
  expandedPhotos: { [key: string]: boolean } = {};
  bulkAnnotatedImagesMap: Map<string, string> = new Map();

  // ==================== Accordion State ====================
  expandedSections: Set<string> = new Set(['information', 'limitations', 'deficiencies']);

  // ==================== Debug State ====================
  debugLogs: DebugLogEntry[] = [];
  showDebugPopup: boolean = false;

  // ==================== Subscriptions ====================
  private destroy$ = new Subject<void>();
  private configSubscription?: Subscription;
  private syncSubscription?: Subscription;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private changeDetectorRef: ChangeDetectorRef,
    private ngZone: NgZone,
    private toastController: ToastController,
    private loadingController: LoadingController,
    private alertController: AlertController,
    private modalController: ModalController,
    private templateConfigService: TemplateConfigService,
    private dataAdapter: TemplateDataAdapter,
    private indexedDb: IndexedDbService,
    private backgroundSync: BackgroundSyncService,
    private photoHandler: PhotoHandlerService,
    private offlineTemplate: OfflineTemplateService,
    private caspioService: CaspioService,
    private hudData: HudDataService,
    private lbwData: LbwDataService,
    private dteData: DteDataService,
    private efeData: EngineersFoundationDataService
  ) {}

  // ==================== Lifecycle ====================

  ngOnInit(): void {
    this.logDebug('INIT', 'GenericCategoryDetailPage initializing');

    // Subscribe to config changes
    this.configSubscription = this.templateConfigService.activeConfig$
      .pipe(takeUntil(this.destroy$))
      .subscribe(config => {
        this.config = config;
        this.logDebug('CONFIG', `Config loaded for template: ${config.id}`);
        this.loadRouteParams();
      });
  }

  ionViewWillEnter(): void {
    this.logDebug('VIEW', 'ionViewWillEnter called');
    if (this.config && !this.loading) {
      // Refresh data on page re-entry
      this.loadData();
    }
  }

  ngOnDestroy(): void {
    this.logDebug('DESTROY', 'GenericCategoryDetailPage destroying');
    this.destroy$.next();
    this.destroy$.complete();
    this.configSubscription?.unsubscribe();
    this.syncSubscription?.unsubscribe();
  }

  // ==================== HasUnsavedChanges ====================

  hasUnsavedChanges(): boolean {
    // Check if any items are currently saving
    return Object.values(this.savingItems).some(saving => saving);
  }

  // ==================== Route Loading ====================

  private loadRouteParams(): void {
    // Get route params - need to traverse up the route tree
    // Route structure: template/:projectId/:serviceId/category/:category
    // or: template/:projectId/:serviceId/structural/category/:category (for EFE)

    const currentParams = this.route.snapshot?.params || {};
    this.categoryName = currentParams['category'] || '';

    // Traverse up to find projectId and serviceId
    let currentRoute = this.route.snapshot;
    while (currentRoute) {
      if (currentRoute.params['projectId']) {
        this.projectId = currentRoute.params['projectId'];
      }
      if (currentRoute.params['serviceId']) {
        this.serviceId = currentRoute.params['serviceId'];
      }
      currentRoute = currentRoute.parent as any;
    }

    this.logDebug('ROUTE', `Loaded params: projectId=${this.projectId}, serviceId=${this.serviceId}, category=${this.categoryName}`);

    if (this.serviceId && this.categoryName) {
      this.loadData();
    } else {
      this.logDebug('ERROR', `Missing required params - serviceId: ${this.serviceId}, category: ${this.categoryName}`);
      this.loading = false;
    }
  }

  // ==================== Data Loading ====================

  private async loadData(): Promise<void> {
    if (!this.config) {
      this.logDebug('ERROR', 'Cannot load data - config not available');
      return;
    }

    this.loading = true;
    this.logDebug('LOAD', `Loading data for ${this.config.id} category: ${this.categoryName}`);

    try {
      // Resolve actualServiceId if needed
      if (this.config.categoryDetailFeatures.hasActualServiceId) {
        this.logDebug('LOAD', `Resolving actualServiceId (hasActualServiceId=true)...`);
        await this.resolveActualServiceId();
        this.logDebug('LOAD', `Resolved: actualServiceId=${this.actualServiceId}, routeServiceId=${this.serviceId}`);
      } else {
        this.actualServiceId = this.serviceId;
        this.logDebug('LOAD', `Using route serviceId directly: ${this.serviceId}`);
      }

      // Load templates and visuals using the appropriate service based on config
      const { templates, visuals } = await this.loadTemplatesAndVisuals();
      this.logDebug('LOAD', `Loaded ${templates.length} templates, ${visuals.length} visuals`);

      if (templates.length === 0) {
        this.logDebug('WARN', 'No templates loaded - check API connection');
      }

      // Build visual record map
      this.buildVisualRecordMap(visuals);

      // Load dropdown options if template uses dynamic dropdowns
      if (this.config.features.dynamicDropdowns) {
        await this.loadDropdownOptions();
      }

      // Organize items into sections
      this.organizeItems(templates, visuals);

      // Load photo counts
      await this.loadPhotoCounts();

      // Load cached annotated images for thumbnail display
      await this.loadCachedAnnotatedImages();

      this.loading = false;
      this.changeDetectorRef.detectChanges();
      this.logDebug('LOAD', 'Data loading complete');

    } catch (error) {
      this.logDebug('ERROR', `Data loading failed: ${error}`);
      this.loading = false;
      await this.showToast('Failed to load data. Please try again.', 'danger');
    }
  }

  private async resolveActualServiceId(): Promise<void> {
    // For HUD/EFE, the route serviceId is PK_ID but we need ServiceID field
    // Query the services table to get the actual ServiceID value
    try {
      let serviceRecord: any = null;

      // Use the appropriate data service based on template type
      switch (this.config?.id) {
        case 'hud':
          serviceRecord = await this.hudData.getService(this.serviceId);
          break;
        case 'efe':
          serviceRecord = await this.efeData.getService(this.serviceId);
          break;
        case 'lbw':
          serviceRecord = await this.lbwData.getService(this.serviceId);
          break;
        case 'dte':
          serviceRecord = await this.dteData.getService(this.serviceId);
          break;
      }

      if (serviceRecord) {
        this.logDebug('SERVICE', `Service record loaded: PK_ID=${serviceRecord.PK_ID}, ServiceID=${serviceRecord.ServiceID}`);
        this.actualServiceId = String(serviceRecord.ServiceID || this.serviceId);
      } else {
        this.logDebug('WARN', 'Could not load service record, using route serviceId');
        this.actualServiceId = this.serviceId;
      }
    } catch (error) {
      this.logDebug('ERROR', `Failed to resolve actualServiceId: ${error}`);
      this.actualServiceId = this.serviceId;
    }
  }

  /**
   * Load templates and visuals using the appropriate service based on template type
   */
  private async loadTemplatesAndVisuals(): Promise<{ templates: any[]; visuals: any[] }> {
    if (!this.config) {
      this.logDebug('ERROR', 'loadTemplatesAndVisuals called without config');
      return { templates: [], visuals: [] };
    }

    const serviceId = this.actualServiceId || this.serviceId;
    this.logDebug('LOAD', `Loading for ${this.config.id}, serviceId=${serviceId}, category=${this.categoryName}`);

    switch (this.config.id) {
      case 'hud':
        // HUD: Use OfflineTemplateService for templates, HudDataService for visuals
        // HUD loads ALL templates (no category filter) since HUD shows all on one page
        this.logDebug('LOAD', 'Loading HUD templates and visuals...');
        const [hudTemplates, hudVisuals] = await Promise.all([
          this.offlineTemplate.ensureHudTemplatesReady(),
          this.hudData.getHudByService(serviceId)
        ]);
        this.logDebug('LOAD', `HUD: ${hudTemplates?.length || 0} templates, ${hudVisuals?.length || 0} visuals`);
        if (hudTemplates?.length > 0) {
          this.logDebug('DEBUG', `First HUD template: ${JSON.stringify({ Name: hudTemplates[0].Name, Kind: hudTemplates[0].Kind, TemplateID: hudTemplates[0].TemplateID })}`);
        }
        return { templates: hudTemplates || [], visuals: hudVisuals || [] };

      case 'efe':
        // EFE: Use OfflineTemplateService for templates, EfeDataService for visuals
        this.logDebug('LOAD', 'Loading EFE templates and visuals...');
        const [efeTemplates, efeVisuals] = await Promise.all([
          this.offlineTemplate.ensureVisualTemplatesReady(),
          this.efeData.getVisualsByService(serviceId)
        ]);
        this.logDebug('LOAD', `EFE raw: ${efeTemplates?.length || 0} templates, ${efeVisuals?.length || 0} visuals`);
        // EFE: Filter templates by category (route param is actual category)
        const filteredEfeTemplates = (efeTemplates || []).filter((t: any) => t.Category === this.categoryName);
        const filteredEfeVisuals = (efeVisuals || []).filter((v: any) => v.Category === this.categoryName);
        this.logDebug('LOAD', `EFE filtered (category=${this.categoryName}): ${filteredEfeTemplates.length} templates, ${filteredEfeVisuals.length} visuals`);
        return { templates: filteredEfeTemplates, visuals: filteredEfeVisuals };

      case 'lbw':
        // LBW: Use OfflineTemplateService for templates, LbwDataService for visuals
        this.logDebug('LOAD', 'Loading LBW templates and visuals...');
        const [lbwTemplates, lbwVisuals] = await Promise.all([
          this.offlineTemplate.getLbwTemplates(),
          this.lbwData.getVisualsByService(serviceId)
        ]);
        this.logDebug('LOAD', `LBW raw: ${lbwTemplates?.length || 0} templates, ${lbwVisuals?.length || 0} visuals`);
        // LBW: Filter templates by category
        const filteredLbwTemplates = (lbwTemplates || []).filter((t: any) => t.Category === this.categoryName);
        const filteredLbwVisuals = (lbwVisuals || []).filter((v: any) => v.Category === this.categoryName);
        this.logDebug('LOAD', `LBW filtered (category=${this.categoryName}): ${filteredLbwTemplates.length} templates, ${filteredLbwVisuals.length} visuals`);
        return { templates: filteredLbwTemplates, visuals: filteredLbwVisuals };

      case 'dte':
        // DTE: Use CaspioService directly for templates (no OfflineTemplateService method)
        // DTE: Use DteDataService for visuals
        this.logDebug('LOAD', 'Loading DTE templates and visuals...');
        const [dteTemplates, dteVisuals] = await Promise.all([
          firstValueFrom(this.caspioService.getServicesDTETemplates()),
          this.dteData.getVisualsByService(serviceId)
        ]);
        this.logDebug('LOAD', `DTE raw: ${dteTemplates?.length || 0} templates, ${dteVisuals?.length || 0} visuals`);
        // DTE: Filter templates by category
        const filteredDteTemplates = (dteTemplates || []).filter((t: any) => t.Category === this.categoryName);
        const filteredDteVisuals = (dteVisuals || []).filter((v: any) => v.Category === this.categoryName);
        this.logDebug('LOAD', `DTE filtered (category=${this.categoryName}): ${filteredDteTemplates.length} templates, ${filteredDteVisuals.length} visuals`);
        return { templates: filteredDteTemplates, visuals: filteredDteVisuals };

      default:
        this.logDebug('ERROR', `Unknown template type: ${this.config.id}`);
        return { templates: [], visuals: [] };
    }
  }

  private buildVisualRecordMap(visuals: any[]): void {
    if (!this.config) return;

    const config = this.config;
    this.logDebug('MAP', `Building visual record map from ${visuals.length} visuals`);

    for (const visual of visuals) {
      const templateId: string | number = visual[config.templateIdFieldName] || visual.TemplateID;
      const visualId: string | number = visual[config.idFieldName] || visual.PK_ID;
      // IMPORTANT: Always use this.categoryName for consistent keys
      // The visual.Category should match this.categoryName since we filter by category
      const category: string = this.categoryName;

      if (templateId) {
        const key = `${category}_${templateId}`;
        this.visualRecordIds[key] = String(visualId);
        this.selectedItems[key] = visual.Notes !== 'HIDDEN';
        this.logDebug('MAP', `Mapped: ${key} -> visualId=${visualId}`);
      }
    }

    this.logDebug('MAP', `Built ${Object.keys(this.visualRecordIds).length} visual record mappings`);
  }

  private async loadDropdownOptions(): Promise<void> {
    if (!this.config) return;

    const optionsMap = await this.dataAdapter.getDropdownOptionsForCategoryWithConfig(
      this.config,
      this.categoryName
    );

    optionsMap.forEach((options, templateId) => {
      this.visualDropdownOptions[templateId] = options;
    });
  }

  private organizeItems(templates: any[], visuals: any[]): void {
    const comments: VisualItem[] = [];
    const limitations: VisualItem[] = [];
    const deficiencies: VisualItem[] = [];

    // Create visual items from templates
    for (const template of templates) {
      const templateId = template.TemplateID || template.PK_ID;
      const key = `${this.categoryName}_${templateId}`;

      // Find matching visual record if exists
      const visual = visuals.find(v => {
        const vTemplateId = v[this.config!.templateIdFieldName] || v.TemplateID;
        return String(vTemplateId) === String(templateId);
      });

      const item: VisualItem = {
        id: visual ? (visual[this.config!.idFieldName] || visual.PK_ID) : templateId,
        templateId: templateId,
        name: visual?.Name || template.Name || '',
        text: visual?.Text || template.Text || '',
        originalText: template.Text || '',
        type: template.Kind || 'Comment',
        category: this.categoryName,
        answerType: template.AnswerType || 0,
        required: template.Required === 1 || template.Required === true,
        answer: visual?.Answer || '',
        isSelected: this.selectedItems[key] || false,
        otherValue: visual?.Notes || '',
        key: key
      };

      // Organize by type
      switch (item.type) {
        case 'Limitation':
          limitations.push(item);
          break;
        case 'Deficiency':
          deficiencies.push(item);
          break;
        default:
          comments.push(item);
      }
    }

    this.organizedData = { comments, limitations, deficiencies };
    this.logDebug('ORGANIZE', `Organized: ${comments.length} comments, ${limitations.length} limitations, ${deficiencies.length} deficiencies`);
  }

  private async loadPhotoCounts(): Promise<void> {
    // Load photo counts for all items that have visual records
    const visualKeys = Object.keys(this.visualRecordIds);
    this.logDebug('PHOTO', `Loading photo counts for ${visualKeys.length} visual records`);

    for (const key of visualKeys) {
      const visualId = this.visualRecordIds[key];
      if (visualId && !visualId.startsWith('temp_')) {
        try {
          const attachments = await this.dataAdapter.getAttachmentsWithConfig(this.config!, visualId);
          this.photoCountsByKey[key] = attachments.length;
          if (attachments.length > 0) {
            this.logDebug('PHOTO', `${key}: ${attachments.length} photos`);
          }
        } catch (error) {
          this.logDebug('ERROR', `Failed to load photo count for ${key}: ${error}`);
          this.photoCountsByKey[key] = 0;
        }
      }
    }

    const totalPhotos = Object.values(this.photoCountsByKey).reduce((sum, count) => sum + count, 0);
    this.logDebug('PHOTO', `Total photos loaded: ${totalPhotos}`);
  }

  /**
   * Load cached annotated images from IndexedDB for thumbnail display
   */
  private async loadCachedAnnotatedImages(): Promise<void> {
    try {
      const annotatedImages = await this.indexedDb.getAllCachedAnnotatedImagesForService(this.serviceId);
      this.bulkAnnotatedImagesMap = annotatedImages;
      this.logDebug('PHOTO', `Loaded ${annotatedImages.size} cached annotated images`);
    } catch (error) {
      this.logDebug('ERROR', `Failed to load cached annotated images: ${error}`);
      this.bulkAnnotatedImagesMap = new Map();
    }
  }

  // ==================== Search ====================

  onSearchChange(): void {
    // Debounce is handled by Angular's ngModel
    this.changeDetectorRef.detectChanges();
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.changeDetectorRef.detectChanges();
  }

  filterItems(items: VisualItem[]): VisualItem[] {
    if (!this.searchTerm) return items;

    const term = this.searchTerm.toLowerCase();
    return items.filter(item =>
      item.name.toLowerCase().includes(term) ||
      item.text.toLowerCase().includes(term)
    );
  }

  highlightText(text: string): string {
    if (!this.searchTerm || !text) return text;

    const escapedTerm = this.searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedTerm})`, 'gi');
    return text.replace(regex, '<span class="highlight">$1</span>');
  }

  // ==================== Accordion State ====================

  toggleSection(section: string): void {
    if (this.expandedSections.has(section)) {
      this.expandedSections.delete(section);
    } else {
      this.expandedSections.add(section);
    }
  }

  isSectionExpanded(section: string): boolean {
    return this.expandedSections.has(section);
  }

  // ==================== Item Selection ====================

  isItemSelected(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.selectedItems[key] || false;
  }

  async toggleItemSelection(category: string, itemId: string | number): Promise<void> {
    const key = `${category}_${itemId}`;
    const newState = !this.selectedItems[key];
    this.selectedItems[key] = newState;

    this.logDebug('SELECT', `Item ${key} selection: ${newState}`);

    // TODO: Implement save logic - create or update visual record
    // For now, just update local state
    this.changeDetectorRef.detectChanges();
  }

  isItemSaving(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.savingItems[key] || false;
  }

  // ==================== Answer Handling ====================

  async onAnswerChange(category: string, item: VisualItem): Promise<void> {
    const key = `${category}_${item.templateId}`;
    this.logDebug('ANSWER', `Answer changed for ${key}: ${item.answer}`);

    this.savingItems[key] = true;
    this.changeDetectorRef.detectChanges();

    try {
      // TODO: Implement save logic - update visual record with new answer
      await this.simulateApiCall();

      // Update selection state based on answer
      this.selectedItems[key] = !!item.answer;

    } catch (error) {
      this.logDebug('ERROR', `Failed to save answer: ${error}`);
      await this.showToast('Failed to save answer', 'danger');
    } finally {
      this.savingItems[key] = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  // ==================== Multi-Select Handling ====================

  getDropdownOptions(templateId: number): string[] {
    return this.visualDropdownOptions[templateId] || [];
  }

  isOptionSelected(item: VisualItem, option: string): boolean {
    if (!item.answer) return false;
    const selectedOptions = item.answer.split(',').map(o => o.trim());
    return selectedOptions.includes(option);
  }

  async onOptionToggle(category: string, item: VisualItem, option: string, event: any): Promise<void> {
    const isChecked = event.detail.checked;
    let selectedOptions = item.answer ? item.answer.split(',').map(o => o.trim()).filter(o => o) : [];

    if (isChecked) {
      // Handle "None" being mutually exclusive
      if (option === 'None') {
        selectedOptions = ['None'];
      } else {
        selectedOptions = selectedOptions.filter(o => o !== 'None');
        if (!selectedOptions.includes(option)) {
          selectedOptions.push(option);
        }
      }
    } else {
      selectedOptions = selectedOptions.filter(o => o !== option);
      if (option === 'Other') {
        item.otherValue = '';
      }
    }

    item.answer = selectedOptions.join(', ');

    // Auto-select item when any option is checked
    const key = `${category}_${item.templateId}`;
    this.selectedItems[key] = selectedOptions.length > 0;

    this.logDebug('OPTION', `Options for ${key}: ${item.answer}`);

    // TODO: Implement save logic
    this.changeDetectorRef.detectChanges();
  }

  async addMultiSelectOther(category: string, item: VisualItem): Promise<void> {
    if (!item.otherValue?.trim()) return;

    const customValue = item.otherValue.trim();
    let selectedOptions = item.answer ? item.answer.split(',').map(o => o.trim()).filter(o => o) : [];

    if (!selectedOptions.includes(customValue)) {
      selectedOptions.push(customValue);
      item.answer = selectedOptions.join(', ');
    }

    item.otherValue = '';
    this.logDebug('OTHER', `Added custom value: ${customValue}`);

    // TODO: Implement save logic
    this.changeDetectorRef.detectChanges();
  }

  // ==================== Photo Handling ====================

  getPhotosForVisual(category: string, itemId: string | number): any[] {
    const key = `${category}_${itemId}`;
    return this.visualPhotos[key] || [];
  }

  getTotalPhotoCount(category: string, itemId: string | number): number {
    const key = `${category}_${itemId}`;
    return this.photoCountsByKey[key] || this.getPhotosForVisual(category, itemId).length;
  }

  isPhotosExpanded(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.expandedPhotos[key] || false;
  }

  togglePhotoExpansion(category: string, itemId: string | number): void {
    const key = `${category}_${itemId}`;
    this.expandedPhotos[key] = !this.expandedPhotos[key];

    if (this.expandedPhotos[key] && !this.visualPhotos[key]) {
      this.loadPhotosForVisual(category, itemId);
    }
  }

  private async loadPhotosForVisual(category: string, itemId: string | number): Promise<void> {
    const key = `${category}_${itemId}`;
    const visualId = this.visualRecordIds[key];

    this.logDebug('PHOTO', `loadPhotosForVisual called: key=${key}, visualId=${visualId}`);

    if (!visualId || !this.config) {
      this.logDebug('PHOTO', `Skipping photo load - visualId=${visualId}, config=${!!this.config}`);
      return;
    }

    this.loadingPhotosByKey[key] = true;
    this.changeDetectorRef.detectChanges();

    try {
      const attachments = await this.dataAdapter.getAttachmentsWithConfig(this.config, visualId);
      this.logDebug('PHOTO', `Loaded ${attachments.length} attachments for visualId=${visualId}`);

      if (attachments.length > 0) {
        this.logDebug('PHOTO', `First attachment fields: ${Object.keys(attachments[0]).join(', ')}`);
        this.logDebug('PHOTO', `First attachment: Attachment=${attachments[0].Attachment?.substring(0, 50)}, S3ImageUrl=${attachments[0].S3ImageUrl?.substring(0, 50)}`);
      }

      // Process attachments with S3 URL handling
      const photos = [];
      for (const att of attachments) {
        // Try multiple possible field names for the photo URL/key
        // Note: S3 key is stored in 'Attachment' field, not 'Photo' or 'S3ImageUrl'
        const rawPhotoValue = att.Attachment || att.Photo || att.S3ImageUrl || att.ImageUrl || att.url;
        const attachId = String(att.AttachID || att.PK_ID);

        let originalUrl = rawPhotoValue || 'assets/img/photo-placeholder.svg';
        let displayUrl = originalUrl;

        // WEBAPP: Get S3 signed URL if needed
        if (this.isWeb && originalUrl && originalUrl !== 'assets/img/photo-placeholder.svg') {
          originalUrl = await this.getSignedUrlIfNeeded(rawPhotoValue);
          displayUrl = originalUrl;
        }

        // Check for cached annotated thumbnail
        const hasDrawings = !!(att.Drawings && att.Drawings.length > 10);
        if (hasDrawings) {
          const cachedAnnotated = this.bulkAnnotatedImagesMap.get(attachId);
          if (cachedAnnotated) {
            displayUrl = cachedAnnotated;
            this.logDebug('ANNOTATED', `Using cached annotated thumbnail for ${attachId}`);
          }
        }

        photos.push({
          id: att.AttachID || att.PK_ID,
          AttachID: att.AttachID || att.PK_ID,
          url: rawPhotoValue,
          originalUrl: originalUrl,
          displayUrl: displayUrl,
          thumbnailUrl: displayUrl,
          caption: att.Annotation || att.Caption || '',
          Annotation: att.Annotation || att.Caption || '',
          name: att.Name || '',
          Drawings: att.Drawings || '',
          hasAnnotations: hasDrawings,
          uploading: false,
          loading: false
        });
      }

      this.visualPhotos[key] = photos;
      this.photoCountsByKey[key] = photos.length;
      this.logDebug('PHOTO', `Processed ${photos.length} photos for ${key}`);
    } catch (error) {
      this.logDebug('ERROR', `Failed to load photos for ${key}: ${error}`);
      this.visualPhotos[key] = [];
    } finally {
      this.loadingPhotosByKey[key] = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  /**
   * Convert S3 key or URL to a signed URL if needed
   */
  private async getSignedUrlIfNeeded(url: string): Promise<string> {
    if (!url || url === 'assets/img/photo-placeholder.svg') {
      return url;
    }

    try {
      // Check if it's an S3 key (starts with 'uploads/')
      const isS3Key = url.startsWith('uploads/');

      // Check if it's a full S3 URL
      const isFullS3Url = url.startsWith('https://') &&
                          url.includes('.s3.') &&
                          url.includes('amazonaws.com');

      if (isS3Key) {
        // S3 key like 'uploads/path/file.jpg' - get signed URL
        this.logDebug('PHOTO', `Getting signed URL for S3 key: ${url.substring(0, 50)}`);
        const signedUrl = await this.caspioService.getS3FileUrl(url);
        return signedUrl || url;
      } else if (isFullS3Url) {
        // Full S3 URL - extract key and get signed URL
        const urlObj = new URL(url);
        const s3Key = urlObj.pathname.substring(1); // Remove leading '/'
        if (s3Key && s3Key.startsWith('uploads/')) {
          this.logDebug('PHOTO', `Getting signed URL for extracted key: ${s3Key.substring(0, 50)}`);
          const signedUrl = await this.caspioService.getS3FileUrl(s3Key);
          return signedUrl || url;
        }
      }

      // Return as-is if not S3
      return url;
    } catch (error) {
      this.logDebug('WARN', `Could not get signed URL: ${error}`);
      return url;
    }
  }

  isLoadingPhotosForVisual(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.loadingPhotosByKey[key] || false;
  }

  isUploadingPhotos(category: string, itemId: string | number): boolean {
    const key = `${category}_${itemId}`;
    return this.uploadingPhotosByKey[key] || false;
  }

  getUploadingCount(category: string, itemId: string | number): number {
    const photos = this.getPhotosForVisual(category, itemId);
    return photos.filter(p => p.uploading).length;
  }

  getSkeletonArray(category: string, itemId: string | number): number[] {
    const count = this.photoCountsByKey[`${category}_${itemId}`] || 3;
    return Array(Math.min(count, 6)).fill(0);
  }

  async addPhotoFromCamera(category: string, itemId: string | number): Promise<void> {
    this.logDebug('PHOTO', `Camera capture for ${category}_${itemId}`);

    if (!this.config) {
      await this.showToast('Configuration not loaded', 'danger');
      return;
    }

    const key = `${category}_${itemId}`;

    // Get or create visual record first
    let visualId: string | null | undefined = this.visualRecordIds[key];
    if (!visualId) {
      visualId = await this.ensureVisualRecordExists(category, itemId);
      if (!visualId) {
        this.logDebug('ERROR', 'Failed to create visual record for photo');
        await this.showToast('Failed to create record for photo', 'danger');
        return;
      }
    }

    // Initialize photo array if needed
    if (!this.visualPhotos[key]) {
      this.visualPhotos[key] = [];
    }

    // Configure and call PhotoHandlerService
    const captureConfig: PhotoCaptureConfig = {
      entityType: this.config.entityType as any,
      entityId: String(visualId),
      serviceId: this.serviceId,
      category,
      itemId,
      onTempPhotoAdded: (photo: StandardPhotoEntry) => {
        this.logDebug('PHOTO', `Temp photo added: ${photo.imageId}`);
        this.visualPhotos[key].push(photo);
        this.photoCountsByKey[key] = this.visualPhotos[key].length;
        this.expandedPhotos[key] = true;
        this.changeDetectorRef.detectChanges();
      },
      onUploadComplete: (photo: StandardPhotoEntry, tempId: string) => {
        this.logDebug('PHOTO', `Upload complete: ${photo.imageId}, was: ${tempId}`);
        // Replace temp photo with uploaded photo
        const photoIndex = this.visualPhotos[key].findIndex(p =>
          p.imageId === tempId || p.AttachID === tempId || p.id === tempId
        );
        if (photoIndex >= 0) {
          this.visualPhotos[key][photoIndex] = photo;
        }
        this.changeDetectorRef.detectChanges();
      },
      onUploadFailed: (tempId: string, error: any) => {
        this.logDebug('ERROR', `Upload failed for ${tempId}: ${error}`);
        // Keep the photo but mark as failed
        const photoIndex = this.visualPhotos[key].findIndex(p =>
          p.imageId === tempId || p.AttachID === tempId || p.id === tempId
        );
        if (photoIndex >= 0) {
          this.visualPhotos[key][photoIndex].uploadFailed = true;
        }
        this.changeDetectorRef.detectChanges();
      },
      onExpandPhotos: () => {
        this.expandedPhotos[key] = true;
        this.changeDetectorRef.detectChanges();
      }
    };

    await this.photoHandler.captureFromCamera(captureConfig);
  }

  async addPhotoFromGallery(category: string, itemId: string | number): Promise<void> {
    this.logDebug('PHOTO', `Gallery select for ${category}_${itemId}`);

    if (!this.config) {
      await this.showToast('Configuration not loaded', 'danger');
      return;
    }

    const key = `${category}_${itemId}`;

    // Get or create visual record first
    let visualId: string | null | undefined = this.visualRecordIds[key];
    if (!visualId) {
      visualId = await this.ensureVisualRecordExists(category, itemId);
      if (!visualId) {
        this.logDebug('ERROR', 'Failed to create visual record for photo');
        await this.showToast('Failed to create record for photo', 'danger');
        return;
      }
    }

    // Initialize photo array if needed
    if (!this.visualPhotos[key]) {
      this.visualPhotos[key] = [];
    }

    // Configure and call PhotoHandlerService
    const captureConfig: PhotoCaptureConfig = {
      entityType: this.config.entityType as any,
      entityId: String(visualId),
      serviceId: this.serviceId,
      category,
      itemId,
      skipAnnotator: true, // Gallery photos don't go through annotator by default
      onTempPhotoAdded: (photo: StandardPhotoEntry) => {
        this.logDebug('PHOTO', `Gallery photo added: ${photo.imageId}`);
        this.visualPhotos[key].push(photo);
        this.photoCountsByKey[key] = this.visualPhotos[key].length;
        this.expandedPhotos[key] = true;
        this.changeDetectorRef.detectChanges();
      },
      onUploadComplete: (photo: StandardPhotoEntry, tempId: string) => {
        this.logDebug('PHOTO', `Gallery upload complete: ${photo.imageId}`);
        const photoIndex = this.visualPhotos[key].findIndex(p =>
          p.imageId === tempId || p.AttachID === tempId || p.id === tempId
        );
        if (photoIndex >= 0) {
          this.visualPhotos[key][photoIndex] = photo;
        }
        this.changeDetectorRef.detectChanges();
      },
      onUploadFailed: (tempId: string, error: any) => {
        this.logDebug('ERROR', `Gallery upload failed for ${tempId}: ${error}`);
        const photoIndex = this.visualPhotos[key].findIndex(p =>
          p.imageId === tempId || p.AttachID === tempId || p.id === tempId
        );
        if (photoIndex >= 0) {
          this.visualPhotos[key][photoIndex].uploadFailed = true;
        }
        this.changeDetectorRef.detectChanges();
      },
      onExpandPhotos: () => {
        this.expandedPhotos[key] = true;
        this.changeDetectorRef.detectChanges();
      }
    };

    await this.photoHandler.captureFromGallery(captureConfig);
  }

  async viewPhoto(photo: any, category: string, itemId: string | number, event?: Event): Promise<void> {
    this.logDebug('PHOTO', `View photo: ${photo.id || photo.AttachID}`);

    if (!this.config) return;

    const key = `${category}_${itemId}`;

    // Configure view photo
    const viewConfig: ViewPhotoConfig = {
      photo: photo,
      entityType: this.config.entityType as any,
      onSaveAnnotation: async (id: string, compressedDrawings: string, caption: string) => {
        this.logDebug('PHOTO', `Saving annotation for ${id}`);
        try {
          // Save annotation via adapter
          await this.dataAdapter.updateAttachmentWithConfig(this.config!, id, {
            Drawings: compressedDrawings,
            Annotation: caption
          });
          this.logDebug('PHOTO', 'Annotation saved successfully');
        } catch (error) {
          this.logDebug('ERROR', `Failed to save annotation: ${error}`);
          throw error;
        }
      },
      onUpdatePhoto: (result: ViewPhotoResult) => {
        this.logDebug('PHOTO', `Photo updated: ${result.photoId}`);
        // Update photo in local array
        const photos = this.visualPhotos[key] || [];
        const photoIndex = photos.findIndex(p =>
          (p.AttachID || p.id || p.imageId) === result.photoId
        );
        if (photoIndex >= 0) {
          photos[photoIndex].caption = result.caption;
          photos[photoIndex].Annotation = result.caption;
          photos[photoIndex].Drawings = result.compressedDrawings;
          photos[photoIndex].hasAnnotations = result.hasAnnotations;
          if (result.annotatedUrl) {
            photos[photoIndex].displayUrl = result.annotatedUrl;
            photos[photoIndex].thumbnailUrl = result.annotatedUrl;
            // Cache annotated URL in memory map for persistence
            this.bulkAnnotatedImagesMap.set(String(result.photoId), result.annotatedUrl);
            this.logDebug('ANNOTATED', `Cached annotated thumbnail for ${result.photoId}`);
          }
          this.changeDetectorRef.detectChanges();
        }
      }
    };

    await this.photoHandler.viewExistingPhoto(viewConfig);
  }

  async deletePhoto(photo: any, category: string, itemId: string | number): Promise<void> {
    const key = `${category}_${itemId}`;
    const photoId = photo.AttachID || photo.id || photo.imageId;
    this.logDebug('PHOTO', `Delete photo: ${photoId}`);

    // Confirm deletion
    const alert = await this.alertController.create({
      header: 'Delete Photo',
      message: 'Are you sure you want to delete this photo?',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: async () => {
            try {
              // Remove from API if it has a real ID
              if (photoId && !String(photoId).startsWith('temp_') && !String(photoId).startsWith('uploading_')) {
                await this.dataAdapter.deleteAttachmentWithConfig(this.config!, photoId);
                this.logDebug('PHOTO', `Deleted from API: ${photoId}`);
              }

              // Remove from local array
              const photos = this.visualPhotos[key] || [];
              this.visualPhotos[key] = photos.filter(p =>
                (p.AttachID || p.id || p.imageId) !== photoId
              );
              this.photoCountsByKey[key] = this.visualPhotos[key].length;
              this.changeDetectorRef.detectChanges();

              await this.showToast('Photo deleted', 'success');
            } catch (error) {
              this.logDebug('ERROR', `Delete failed: ${error}`);
              await this.showToast('Failed to delete photo', 'danger');
            }
          }
        }
      ]
    });

    await alert.present();
  }

  async openCaptionPopup(photo: any, category: string, itemId: string | number): Promise<void> {
    const photoId = photo.AttachID || photo.id || photo.imageId;
    this.logDebug('CAPTION', `Edit caption for photo: ${photoId}`);

    const alert = await this.alertController.create({
      header: 'Edit Caption',
      inputs: [
        {
          name: 'caption',
          type: 'textarea',
          placeholder: 'Enter caption...',
          value: photo.caption || ''
        }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: async (data) => {
            const newCaption = data.caption?.trim() || '';
            try {
              // Save to API
              if (photoId && !String(photoId).startsWith('temp_')) {
                await this.dataAdapter.updateAttachmentWithConfig(this.config!, photoId, {
                  Annotation: newCaption
                });
              }

              // Update local state
              const key = `${category}_${itemId}`;
              const photos = this.visualPhotos[key] || [];
              const photoIndex = photos.findIndex(p =>
                (p.AttachID || p.id || p.imageId) === photoId
              );
              if (photoIndex >= 0) {
                photos[photoIndex].caption = newCaption;
                photos[photoIndex].Annotation = newCaption;
                this.changeDetectorRef.detectChanges();
              }

              this.logDebug('CAPTION', 'Caption saved');
            } catch (error) {
              this.logDebug('ERROR', `Failed to save caption: ${error}`);
              await this.showToast('Failed to save caption', 'danger');
            }
          }
        }
      ]
    });

    await alert.present();
  }

  /**
   * Ensure a visual record exists for the given item.
   * Creates one if it doesn't exist.
   */
  private async ensureVisualRecordExists(category: string, itemId: string | number): Promise<string | null> {
    const key = `${category}_${itemId}`;

    // Check if we already have a visual ID
    if (this.visualRecordIds[key]) {
      return this.visualRecordIds[key];
    }

    // Find the item to get its details
    const allItems = [
      ...this.organizedData.comments,
      ...this.organizedData.limitations,
      ...this.organizedData.deficiencies
    ];
    const item = allItems.find(i => String(i.templateId) === String(itemId));

    if (!item) {
      this.logDebug('ERROR', `Item not found for templateId: ${itemId}`);
      return null;
    }

    try {
      this.logDebug('VISUAL', `Creating visual record for ${category}_${itemId}`);

      // Create visual record via adapter
      const visualData = {
        ServiceID: parseInt(this.serviceId, 10),
        Category: category,
        Kind: item.type,
        Name: item.name,
        Text: item.text || item.originalText || '',
        Notes: '',
        [this.config!.templateIdFieldName]: item.templateId
      };

      const createdVisual = await this.dataAdapter.createVisualWithConfig(this.config!, visualData);
      const visualId = createdVisual?.[this.config!.idFieldName] || createdVisual?.PK_ID;

      if (visualId) {
        this.visualRecordIds[key] = String(visualId);
        this.selectedItems[key] = true;
        this.logDebug('VISUAL', `Created visual record: ${visualId}`);
        return String(visualId);
      }

      return null;
    } catch (error) {
      this.logDebug('ERROR', `Failed to create visual record: ${error}`);
      return null;
    }
  }

  handleImageError(event: Event, photo: any): void {
    const img = event.target as HTMLImageElement;
    img.src = 'assets/img/photo-placeholder.svg';
    photo.loading = false;
  }

  // ==================== Navigation ====================

  async openVisualDetail(category: string, item: VisualItem): Promise<void> {
    const visualId = this.visualRecordIds[`${category}_${item.templateId}`];

    if (!visualId || !this.config) {
      this.logDebug('NAV', 'Cannot navigate - no visual record');
      return;
    }

    const queryParams: any = { actualServiceId: this.actualServiceId };
    queryParams[this.config.visualIdParamName] = visualId;

    this.router.navigate(['visual', item.templateId], {
      relativeTo: this.route,
      queryParams
    });
  }

  // ==================== Custom Visual ====================

  async addCustomVisual(category: string, type: string): Promise<void> {
    this.logDebug('CUSTOM', `Add custom ${type} for ${category}`);
    // TODO: Implement custom visual modal
    await this.showToast('Custom visual not yet implemented', 'warning');
  }

  // ==================== Debug ====================

  showDebugPanel(): void {
    this.showDebugPopup = true;
  }

  toggleDebugPopup(): void {
    this.showDebugPopup = !this.showDebugPopup;
  }

  private logDebug(type: string, message: string): void {
    if (this.config?.categoryDetailFeatures?.hasDebugPanel) {
      const now = new Date();
      const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
      this.debugLogs.unshift({ time, type, message });

      // Keep only last 100 entries
      if (this.debugLogs.length > 100) {
        this.debugLogs = this.debugLogs.slice(0, 100);
      }
    }
    console.log(`[GenericCategoryDetail] [${type}] ${message}`);
  }

  // ==================== Utilities ====================

  private async showToast(message: string, color: string = 'primary'): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      position: 'bottom',
      color
    });
    await toast.present();
  }

  private async simulateApiCall(): Promise<void> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  getSelectedCount(items: VisualItem[]): number {
    return items.filter(item => {
      const key = `${item.category}_${item.templateId}`;
      return this.selectedItems[key];
    }).length;
  }

  // ==================== TrackBy Functions ====================

  trackByItemId(index: number, item: VisualItem): string {
    return `${item.category}_${item.templateId}`;
  }

  trackByPhotoId(index: number, photo: any): string {
    return photo.id || index.toString();
  }

  trackByOption(index: number, option: string): string {
    return option;
  }
}
