import { Component, OnInit, OnDestroy, ChangeDetectorRef, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController, LoadingController, NavController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { TemplateConfigService } from '../../../services/template/template-config.service';
import { TemplateConfig, NavigationCard } from '../../../services/template/template-config.interface';
import { TemplateRehydrationService } from '../../../services/template/template-rehydration.service';
import { TEMPLATE_DATA_PROVIDER } from '../../../services/template/template-data-provider.factory';
import { ITemplateDataProvider } from '../../../services/template/template-data-provider.interface';
import { environment } from '../../../../environments/environment';

interface DisplayCard extends NavigationCard {
  completed: boolean;
  commentCount?: number;
  limitationCount?: number;
  deficiencyCount?: number;
}

@Component({
  selector: 'app-generic-main',
  templateUrl: './main.page.html',
  styleUrls: ['./main.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class GenericMainPage implements OnInit, OnDestroy {
  config: TemplateConfig | null = null;
  private configSubscription?: Subscription;

  cards: DisplayCard[] = [];
  projectId: string = '';
  serviceId: string = '';
  canFinalize: boolean = false;
  statusOptions: any[] = [];
  isReportFinalized: boolean = false;
  hasChangesAfterFinalization: boolean = false;
  isRehydrating: boolean = false;  // True when restoring data from server after storage clear

  private isFinalizationInProgress = false;
  private readonly SYNC_TIMEOUT_MS = 45000;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private navController: NavController,
    private offlineTemplate: OfflineTemplateService,
    private templateConfigService: TemplateConfigService,
    private templateRehydration: TemplateRehydrationService,
    private changeDetectorRef: ChangeDetectorRef,
    @Inject(TEMPLATE_DATA_PROVIDER) private dataProvider: ITemplateDataProvider
  ) {}

  async ngOnInit() {
    // Subscribe to template config changes
    this.configSubscription = this.templateConfigService.activeConfig$.subscribe(config => {
      this.config = config;

      // Initialize cards from config
      this.cards = config.navigationCards.map(card => ({
        ...card,
        completed: false,
        commentCount: 0,
        limitationCount: 0,
        deficiencyCount: 0
      }));

      this.changeDetectorRef.detectChanges();
    });

    // Load status options from Status table (non-blocking)
    this.loadStatusOptions();

    // Get IDs from parent route snapshot immediately (for offline reliability)
    const parentParams = this.route.parent?.snapshot?.params;
    if (parentParams) {
      this.projectId = parentParams['projectId'] || '';
      this.serviceId = parentParams['serviceId'] || '';
    }

    // Also subscribe to param changes (for dynamic updates)
    this.route.parent?.params.subscribe(async params => {
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];

      // Check if report is already finalized (non-blocking)
      this.checkIfFinalized();

      // Check if report can be finalized (non-blocking)
      this.checkCanFinalize();

      // Load counts if applicable
      if (this.config?.features.hasCountIndicators) {
        this.loadCounts();
      }
    });
  }

  ngOnDestroy() {
    if (this.configSubscription) {
      this.configSubscription.unsubscribe();
    }
  }

  async loadStatusOptions() {
    try {
      // OFFLINE-FIRST: Use OfflineTemplateService which reads from IndexedDB
      this.statusOptions = await this.offlineTemplate.getStatusOptions();
    } catch (error) {
      console.error('[GenericMain] Error loading status options:', error);
    }
  }

  getStatusAdminByClient(statusClient: string): string {
    const statusRecord = this.statusOptions.find(s => s.Status_Client === statusClient);
    if (statusRecord && statusRecord.Status_Admin) {
      return statusRecord.Status_Admin;
    }
    return statusClient;
  }

  async ionViewWillEnter() {
    // Check if service needs rehydration (after storage clear)
    // This restores data from the server when local storage was cleared
    if (this.serviceId && this.config && !environment.isWeb) {
      await this.checkAndPerformRehydration();
    }

    // Refresh finalization status when returning to this page
    if (this.projectId && this.serviceId) {
      // Mark that changes may have been made
      if (this.isReportFinalized) {
        this.hasChangesAfterFinalization = true;
      }
      // Non-blocking - fail silently offline
      this.checkCanFinalize();

      // Refresh counts if applicable
      if (this.config?.features.hasCountIndicators) {
        this.loadCounts();
      }
    }
  }

  /**
   * Check if this service needs rehydration and perform it if necessary
   * Rehydration restores data from the server after local storage was cleared
   */
  private async checkAndPerformRehydration(): Promise<void> {
    if (!this.config || environment.isWeb) {
      return;  // Only needed on mobile
    }

    try {
      const needsRehydration = await this.templateRehydration.needsRehydration(this.serviceId);

      if (needsRehydration) {
        this.isRehydrating = true;
        this.changeDetectorRef.detectChanges();

        const result = await this.templateRehydration.rehydrateServiceForTemplate(
          this.config,
          this.serviceId
        );

        this.isRehydrating = false;
        this.changeDetectorRef.detectChanges();

        if (result.success) {
        } else {
          console.error(`[GenericMain] Rehydration failed: ${result.error}`);
        }
      }
    } catch (err: any) {
      console.error(`[GenericMain] Rehydration check failed:`, err);
      this.isRehydrating = false;
      this.changeDetectorRef.detectChanges();
    }
  }

  private async checkIfFinalized() {
    if (!this.serviceId) return;

    try {
      // Use unified dataProvider - handles webapp/mobile differences internally
      const serviceData = await this.dataProvider.getService(this.serviceId);
      const status = serviceData?.Status || '';

      this.isReportFinalized = status === 'Finalized' ||
                                status === 'Report Finalized' ||
                                status === 'Updated' ||
                                status === 'Under Review';

    } catch (error) {
      console.error('[GenericMain] Error checking finalized status:', error);
    }
  }

  private async checkCanFinalize() {
    if (!this.projectId || !this.serviceId) {
      this.canFinalize = false;
      return;
    }

    try {
      // For now, enable finalize if report is not finalized or has changes
      // This can be extended with template-specific validation services
      if (this.isReportFinalized) {
        this.canFinalize = this.hasChangesAfterFinalization;
      } else {
        // Basic check - can be enhanced with validation services
        this.canFinalize = true;
      }
    } catch (error) {
      console.error('[GenericMain] Error checking finalize status:', error);
      this.canFinalize = false;
    }
  }

  private async loadCounts() {
    // Load counts for templates that support count indicators (e.g., HUD)
    // This can be extended based on template type
    if (!this.config || !this.serviceId) return;

    // Counts loading logic would go here
    // For now, counts remain at 0 until template-specific logic is added
    this.changeDetectorRef.detectChanges();
  }

  trackByCardRoute(index: number, card: DisplayCard): string {
    return card.route;
  }

  navigateTo(card: DisplayCard) {
    if (!this.config) return;


    // Split route into segments if it contains '/' (e.g., 'category/hud' -> ['category', 'hud'])
    const routeSegments = card.route.split('/');

    // Use absolute navigation to ensure it works even if parent route isn't ready
    if (this.projectId && this.serviceId) {
      this.router.navigate(['/' + this.config.routePrefix, this.projectId, this.serviceId, ...routeSegments]);
    } else {
      // Fallback to relative navigation
      this.router.navigate(routeSegments, { relativeTo: this.route.parent });
    }
  }

  async finalizeReport() {

    // If report is finalized but no changes made, show message
    if (this.isReportFinalized && !this.hasChangesAfterFinalization) {
      const alert = await this.alertController.create({
        header: 'No Changes to Update',
        message: 'There are no changes to update. Make changes to the report to enable the Update button.',
        cssClass: 'custom-document-alert',
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    // Show confirmation dialog
    const isUpdate = this.isReportFinalized;
    const buttonText = isUpdate ? 'Update' : 'Finalize';
    const headerText = isUpdate ? 'Update Report?' : 'Finalize Report?';
    const messageText = isUpdate
      ? 'Are you sure you want to update this report?'
      : 'Are you sure you want to finalize this report?';

    const alert = await this.alertController.create({
      header: headerText,
      message: messageText,
      cssClass: 'custom-document-alert',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: buttonText,
          handler: () => this.markReportAsFinalized()
        }
      ]
    });
    await alert.present();
  }

  async markReportAsFinalized() {
    // Prevent double-click
    if (this.isFinalizationInProgress) {
      return;
    }
    this.isFinalizationInProgress = true;

    const isUpdate = this.isReportFinalized;

    const loading = await this.loadingController.create({
      message: isUpdate ? 'Updating report...' : 'Finalizing report...',
      backdropDismiss: false
    });
    await loading.present();

    try {
      // Update the Services table status
      const currentDateTime = new Date().toISOString();
      const statusClientValue = isUpdate ? 'Updated' : 'Finalized';
      const statusAdminValue = this.getStatusAdminByClient(statusClientValue);

      const updateData = {
        StatusDateTime: currentDateTime,
        Status: statusClientValue,
        Status_Admin: statusAdminValue
      };

      // Use unified dataProvider - handles webapp/mobile differences internally
      await this.dataProvider.updateService(this.serviceId, updateData);

      await loading.dismiss();

      // Update local state
      this.isReportFinalized = true;
      this.hasChangesAfterFinalization = false;
      this.canFinalize = false;

      // Show success message
      const successAlert = await this.alertController.create({
        header: 'Success',
        message: isUpdate ? 'Report has been updated.' : 'Report has been finalized.',
        cssClass: 'custom-document-alert',
        buttons: ['OK']
      });
      await successAlert.present();

    } catch (error) {
      await loading.dismiss();
      console.error('[GenericMain] Finalization error:', error);

      const errorAlert = await this.alertController.create({
        header: 'Error',
        message: 'An error occurred while finalizing the report. Please try again.',
        cssClass: 'custom-document-alert',
        buttons: ['OK']
      });
      await errorAlert.present();
    } finally {
      this.isFinalizationInProgress = false;
    }
  }
}
