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
import { PhotoHandlerService } from '../../../services/photo-handler.service';
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
        await this.resolveActualServiceId();
      } else {
        this.actualServiceId = this.serviceId;
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
    for (const visual of visuals) {
      const templateId: string | number = visual[config.templateIdFieldName] || visual.TemplateID;
      const visualId: string | number = visual[config.idFieldName] || visual.PK_ID;
      const category: string = visual.Category || this.categoryName;

      if (templateId) {
        const key = `${category}_${templateId}`;
        this.visualRecordIds[key] = String(visualId);
        this.selectedItems[key] = visual.Notes !== 'HIDDEN';
      }
    }
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
    for (const key of Object.keys(this.visualRecordIds)) {
      const visualId = this.visualRecordIds[key];
      if (visualId && !visualId.startsWith('temp_')) {
        try {
          const attachments = await this.dataAdapter.getAttachmentsWithConfig(this.config!, visualId);
          this.photoCountsByKey[key] = attachments.length;
        } catch (error) {
          this.photoCountsByKey[key] = 0;
        }
      }
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

    if (!visualId || !this.config) return;

    this.loadingPhotosByKey[key] = true;
    this.changeDetectorRef.detectChanges();

    try {
      const attachments = await this.dataAdapter.getAttachmentsWithConfig(this.config, visualId);
      this.visualPhotos[key] = attachments.map(a => ({
        id: a.AttachID || a.PK_ID,
        url: a.S3ImageUrl || a.ImageUrl,
        displayUrl: a.S3ImageUrl || a.ImageUrl,
        thumbnailUrl: a.S3ThumbnailUrl || a.S3ImageUrl,
        caption: a.Caption || '',
        name: a.Name || '',
        hasAnnotations: !!a.Drawings,
        uploading: false,
        loading: false
      }));
      this.photoCountsByKey[key] = this.visualPhotos[key].length;
    } catch (error) {
      this.logDebug('ERROR', `Failed to load photos for ${key}: ${error}`);
      this.visualPhotos[key] = [];
    } finally {
      this.loadingPhotosByKey[key] = false;
      this.changeDetectorRef.detectChanges();
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
    // TODO: Implement using PhotoHandlerService
    await this.showToast('Camera capture not yet implemented', 'warning');
  }

  async addPhotoFromGallery(category: string, itemId: string | number): Promise<void> {
    this.logDebug('PHOTO', `Gallery select for ${category}_${itemId}`);
    // TODO: Implement using PhotoHandlerService
    await this.showToast('Gallery select not yet implemented', 'warning');
  }

  async viewPhoto(photo: any, category: string, itemId: string | number, event?: Event): Promise<void> {
    this.logDebug('PHOTO', `View photo: ${photo.id}`);
    // TODO: Implement photo viewer/annotator
  }

  async deletePhoto(photo: any, category: string, itemId: string | number): Promise<void> {
    const key = `${category}_${itemId}`;
    this.logDebug('PHOTO', `Delete photo: ${photo.id}`);

    // Remove from local array
    const photos = this.visualPhotos[key] || [];
    this.visualPhotos[key] = photos.filter(p => p.id !== photo.id);
    this.photoCountsByKey[key] = this.visualPhotos[key].length;

    // TODO: Implement actual deletion via adapter
    this.changeDetectorRef.detectChanges();
  }

  async openCaptionPopup(photo: any, category: string, itemId: string | number): Promise<void> {
    this.logDebug('CAPTION', `Edit caption for photo: ${photo.id}`);
    // TODO: Implement caption popup
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
