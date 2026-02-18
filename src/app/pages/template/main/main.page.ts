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
import { TemplateValidationService } from '../../../services/template/template-validation.service';
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
  statusOptions: any[] = [];
  isRehydrating: boolean = false;
  isReadyToFinalize: boolean = false;

  private pendingNavigation: DisplayCard | null = null;
  private isFinalizationInProgress = false;

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
    @Inject(TEMPLATE_DATA_PROVIDER) private dataProvider: ITemplateDataProvider,
    private validationService: TemplateValidationService
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

      // Load counts if applicable
      if (this.config?.features.hasCountIndicators) {
        this.loadCounts();
      }

      // Check if report is ready to finalize
      this.checkFinalizationReadiness();
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
    if (this.serviceId && this.config && !environment.isWeb) {
      await this.checkAndPerformRehydration();
    }

    // Re-check finalization readiness when returning to this page
    this.checkFinalizationReadiness();
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
        // Block card navigation while pre-caching images for offline access.
        this.isRehydrating = true;

        const result = await this.templateRehydration.rehydrateServiceForTemplate(
          this.config,
          this.serviceId
        );

        if (!result.success) {
          console.error(`[GenericMain] Rehydration failed: ${result.error}`);
        }
      }
    } catch (err: any) {
      console.error(`[GenericMain] Rehydration check failed:`, err);
    } finally {
      this.isRehydrating = false;
      if (this.pendingNavigation) {
        const card = this.pendingNavigation;
        this.pendingNavigation = null;
        this.performNavigation(card);
      }
    }
  }

  /**
   * Silently check if the report passes all validation (no loading spinner).
   * Updates isReadyToFinalize which controls button styling.
   */
  private async checkFinalizationReadiness() {
    if (!this.config || !this.projectId || !this.serviceId) return;

    try {
      const result = await this.validationService.validateAllRequiredFields(
        this.config,
        this.projectId,
        this.serviceId
      );
      this.isReadyToFinalize = result.isComplete;
    } catch {
      this.isReadyToFinalize = false;
    }
    this.changeDetectorRef.detectChanges();
  }

  private async loadCounts() {
    if (!this.config || !this.serviceId) return;
    this.changeDetectorRef.detectChanges();
  }

  trackByCardRoute(index: number, card: DisplayCard): string {
    return card.route;
  }

  navigateTo(card: DisplayCard) {
    if (!this.config) return;

    if (this.isRehydrating) {
      this.pendingNavigation = card;
      return;
    }

    this.performNavigation(card);
  }

  private performNavigation(card: DisplayCard) {
    if (!this.config) return;

    const routeSegments = card.route.split('/');

    if (this.projectId && this.serviceId) {
      this.router.navigate(['/' + this.config.routePrefix, this.projectId, this.serviceId, ...routeSegments]);
    } else {
      this.router.navigate(routeSegments, { relativeTo: this.route.parent });
    }
  }

  async finalizeReport() {
    if (!this.config) return;

    // Show loading while validating
    const loading = await this.loadingController.create({
      message: 'Validating report...'
    });
    await loading.present();

    try {
      const validationResult = await this.validationService.validateAllRequiredFields(
        this.config,
        this.projectId,
        this.serviceId
      );

      await loading.dismiss();

      if (validationResult.incompleteFields.length > 0) {
        // Show popup with missing fields
        const fieldsList = validationResult.incompleteFields
          .map(field => field.label)
          .join('\n\n');

        const alert = await this.alertController.create({
          header: 'Incomplete Required Fields',
          message: `Please complete the following required fields:\n\n${fieldsList}`,
          cssClass: 'custom-document-alert incomplete-fields-alert',
          buttons: ['OK']
        });
        await alert.present();
      } else {
        // All fields complete - show confirmation
        const alert = await this.alertController.create({
          header: 'Report Complete',
          message: 'All required fields have been completed. Are you sure you want to finalize?',
          cssClass: 'custom-document-alert',
          buttons: [
            {
              text: 'Finalize',
              handler: () => this.markReportAsFinalized()
            },
            { text: 'Cancel', role: 'cancel' }
          ]
        });
        await alert.present();
      }
    } catch (error) {
      await loading.dismiss();
      console.error('[GenericMain] Validation error:', error);
      const alert = await this.alertController.create({
        header: 'Validation Error',
        message: 'An error occurred while validating the report. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  async markReportAsFinalized() {
    if (this.isFinalizationInProgress) return;
    this.isFinalizationInProgress = true;

    const loading = await this.loadingController.create({
      message: 'Finalizing report...',
      backdropDismiss: false
    });
    await loading.present();

    try {
      const currentDateTime = new Date().toISOString();
      const statusAdminValue = this.getStatusAdminByClient('Finalized');

      const updateData: any = {
        StatusDateTime: currentDateTime,
        Status: statusAdminValue
      };

      await this.dataProvider.updateService(this.serviceId, updateData);
      await loading.dismiss();

      const successAlert = await this.alertController.create({
        header: 'Success',
        message: 'Report has been finalized.',
        cssClass: 'custom-document-alert',
        buttons: [{
          text: 'OK',
          handler: () => {
            this.router.navigate(['/project', this.projectId]);
          }
        }]
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
