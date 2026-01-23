import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController, LoadingController, NavController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { HudValidationService, IncompleteField } from '../services/hud-validation.service';
import { CaspioService } from '../../../services/caspio.service';
import { CacheService } from '../../../services/cache.service';
import { LocalImageService } from '../../../services/local-image.service';
import { BackgroundSyncService } from '../../../services/background-sync.service';
import { HudFieldRepoService } from '../services/hud-field-repo.service';
import { environment } from '../../../../environments/environment';

interface NavigationCard {
  title: string;
  icon: string;
  route: string;
  description: string;
  completed: boolean;
  badges?: CardBadge[];
}

interface CardBadge {
  label: string;
  count: number;
  color: 'success' | 'warning' | 'danger' | 'primary';
  icon?: string;
}

@Component({
  selector: 'app-hud-main',
  templateUrl: './hud-main.page.html',
  styleUrls: ['./hud-main.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class HudMainPage implements OnInit {
  cards: NavigationCard[] = [
    {
      title: 'Project Details',
      icon: 'document-text-outline',
      route: 'project-details',
      description: 'Property information, people, and environmental conditions',
      completed: false,
      badges: []
    },
    {
      title: 'HUD / Manufactured Home',
      icon: 'construct-outline',
      route: 'categories',
      description: 'Inspection findings, comments, and photo documentation',
      completed: false,
      badges: []
    }
  ];

  projectId: string = '';
  serviceId: string = '';
  loading: boolean = true;
  canFinalize: boolean = false;
  isWeb: boolean = environment.isWeb;
  statusOptions: any[] = [];
  isReportFinalized: boolean = false;
  hasChangesAfterFinalization: boolean = false;

  private readonly SYNC_TIMEOUT_MS = 45000; // 45 seconds per sync step

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private alertController: AlertController,
    private validationService: HudValidationService,
    private caspioService: CaspioService,
    private cache: CacheService,
    private loadingController: LoadingController,
    private navController: NavController,
    private localImageService: LocalImageService,
    private backgroundSync: BackgroundSyncService,
    private hudFieldRepo: HudFieldRepoService
  ) {}

  async ngOnInit() {
    // Load status options from Status table
    await this.loadStatusOptions();
    
    // Get IDs from parent route (container level)
    // Route structure: hud/:projectId/:serviceId -> (main hub is here)
    this.route.parent?.params.subscribe(async params => {
      console.log('Route params from parent:', params);
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];

      console.log('ProjectId:', this.projectId, 'ServiceId:', this.serviceId);

      if (!this.projectId || !this.serviceId) {
        console.error('Missing projectId or serviceId');
      } else {
        await this.checkCanFinalize();
      }
      
      this.loading = false;
    });
  }

  async loadStatusOptions() {
    try {
      const statusData: any = await this.caspioService.get('/tables/LPS_Status/records').toPromise();
      this.statusOptions = statusData?.Result || [];
      console.log('[HUD Main] Loaded status options:', this.statusOptions.length);
    } catch (error) {
      console.error('[HUD Main] Error loading status options:', error);
    }
  }

  getStatusAdminByClient(statusClient: string): string {
    const statusRecord = this.statusOptions.find(s => s.Status_Client === statusClient);
    if (statusRecord && statusRecord.Status_Admin) {
      console.log(`[HUD Main] Status mapping: "${statusClient}" -> "${statusRecord.Status_Admin}"`);
      return statusRecord.Status_Admin;
    }
    console.warn(`[HUD Main] Status_Admin not found for "${statusClient}", using fallback`);
    return statusClient;
  }

  async ionViewWillEnter() {
    // Refresh finalization status when returning to this page
    if (this.projectId && this.serviceId) {
      await this.checkCanFinalize();
    }
  }

  private async checkCanFinalize() {
    if (!this.projectId || !this.serviceId) {
      this.canFinalize = false;
      return;
    }

    try {
      const validationResult = await this.validationService.validateAllRequiredFields(
        this.projectId,
        this.serviceId
      );
      
      // If report is finalized, only enable if changes have been made
      if (this.isReportFinalized) {
        this.canFinalize = this.hasChangesAfterFinalization && validationResult.isComplete;
        console.log('[HUD Main] Report finalized. Has changes:', this.hasChangesAfterFinalization, 'Can update:', this.canFinalize);
      } else {
        // For initial finalization, enable if all fields complete
        this.canFinalize = validationResult.isComplete;
        console.log('[HUD Main] Can finalize:', this.canFinalize);
      }
    } catch (error) {
      console.error('[HUD Main] Error checking finalize status:', error);
      this.canFinalize = false;
    }
  }

  navigateTo(card: NavigationCard) {
    if (card.route === 'categories') {
      // Navigate directly to Mobile/Manufactured Homes category
      this.router.navigate(['category', 'Mobile/Manufactured Homes'], { relativeTo: this.route });
    } else {
      this.router.navigate([card.route], { relativeTo: this.route.parent });
    }
  }

  async finalizeReport() {
    console.log('[HUD Main] Starting finalization validation...');
    console.log('[HUD Main] Is finalized:', this.isReportFinalized, 'Has changes:', this.hasChangesAfterFinalization);
    
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
    
    // Show loading
    const loading = await this.loadingController.create({
      message: 'Validating report...'
    });
    await loading.present();

    try {
      // Validate all required fields across all pages
      const validationResult = await this.validationService.validateAllRequiredFields(
        this.projectId,
        this.serviceId
      );

      await loading.dismiss();

      if (validationResult.incompleteFields.length > 0) {
        // Show popup with missing fields - each on its own line
        const fieldsList = validationResult.incompleteFields
          .map(field => field.label)
          .join('\n\n');
        
        const message = `Please complete the following required fields:\n\n${fieldsList}`;
        
        const alert = await this.alertController.create({
          header: 'Incomplete Required Fields',
          message: message,
          cssClass: 'custom-document-alert incomplete-fields-alert',
          buttons: ['OK']
        });
        await alert.present();
        console.log('[HUD Main] Alert shown with', validationResult.incompleteFields.length, 'missing fields');
      } else {
        // All fields complete - show confirmation dialog
        const isUpdate = this.isReportFinalized;
        const buttonText = isUpdate ? 'Update' : 'Finalize';
        const headerText = isUpdate ? 'Report Ready to Update' : 'Report Complete';
        const messageText = isUpdate
          ? 'All required fields have been completed. Your report is ready to be updated.'
          : 'All required fields have been completed. Ready to finalize?';
        
        console.log('[HUD Main] All fields complete, showing confirmation');
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
    } catch (error) {
      await loading.dismiss();
      console.error('[HUD Main] Validation error:', error);
      const alert = await this.alertController.create({
        header: 'Validation Error',
        message: 'An error occurred while validating the report. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }


  async markReportAsFinalized() {
    const isUpdate = this.isReportFinalized;

    const loading = await this.loadingController.create({
      message: isUpdate ? 'Updating report...' : 'Finalizing report...'
    });
    await loading.present();

    try {
      // ==========================================
      // STEP 1: Sync ALL pending images (with timeout)
      // ==========================================
      console.log('[HUD Main] Checking for unsynced images...');
      const imageStatus = await this.localImageService.getServiceImageSyncStatus(this.serviceId);

      if (imageStatus.pending > 0) {
        console.log(`[HUD Main] Found ${imageStatus.pending} unsynced images, forcing sync...`);
        loading.message = `Syncing ${imageStatus.pending} image(s)...`;

        // Trigger background sync to process pending uploads
        this.backgroundSync.triggerSync();

        // Force sync with timeout
        const syncOutcome = await this.withTimeout(
          this.localImageService.forceSyncServiceImages(
            this.serviceId,
            (current, total, status) => {
              loading.message = status;
            }
          ),
          this.SYNC_TIMEOUT_MS,
          'Image sync'
        );

        // Handle timeout or failure
        if (syncOutcome.timedOut || !syncOutcome.result.success) {
          const failedCount = syncOutcome.timedOut ? imageStatus.pending : syncOutcome.result.failedCount;
          const reason = syncOutcome.timedOut ? 'Sync timed out' : 'Some images failed';

          await loading.dismiss();

          const alert = await this.alertController.create({
            header: 'Image Sync Warning',
            message: `${reason}. ${failedCount} image(s) may not be synced. Do you want to proceed with finalization anyway?`,
            cssClass: 'custom-document-alert',
            buttons: [
              { text: 'Cancel', role: 'cancel' },
              {
                text: 'Proceed Anyway',
                handler: () => this.completeFinalization(isUpdate)
              }
            ]
          });
          await alert.present();
          return;
        }
      }

      // ==========================================
      // STEP 2: Sync ALL pending requests/captions (with timeout)
      // ==========================================
      console.log('[HUD Main] Syncing pending requests and captions...');
      loading.message = 'Syncing data...';

      const dataSyncOutcome = await this.withTimeout(
        this.backgroundSync.forceSyncAllPendingForService(
          this.serviceId,
          (status, current, total) => {
            loading.message = status;
          }
        ),
        this.SYNC_TIMEOUT_MS,
        'Data sync'
      );

      console.log('[HUD Main] Data sync result:', dataSyncOutcome);

      // Handle timeout or failure
      if (dataSyncOutcome.timedOut || !dataSyncOutcome.result.success) {
        const failedTotal = dataSyncOutcome.timedOut ? '?' :
          (dataSyncOutcome.result.requestsFailed + dataSyncOutcome.result.captionsFailed);
        const reason = dataSyncOutcome.timedOut ? 'Sync timed out' : 'Some items failed';

        await loading.dismiss();

        const alert = await this.alertController.create({
          header: 'Sync Warning',
          message: `${reason}. ${failedTotal} item(s) may not be synced. Do you want to proceed with finalization anyway?`,
          cssClass: 'custom-document-alert',
          buttons: [
            { text: 'Cancel', role: 'cancel' },
            {
              text: 'Proceed Anyway',
              handler: () => this.completeFinalization(isUpdate)
            }
          ]
        });
        await alert.present();
        return;
      }

      // ==========================================
      // STEP 3: Update image pointers
      // ==========================================
      console.log('[HUD Main] Updating image pointers to remote URLs...');
      loading.message = 'Updating image references...';
      await this.localImageService.updateImagePointersToRemote(this.serviceId);

      await loading.dismiss();

      // ==========================================
      // STEP 4: Complete finalization
      // ==========================================
      await this.completeFinalization(isUpdate);

    } catch (error) {
      await loading.dismiss();
      console.error('[HUD Main] Error finalizing report:', error);
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to finalize report. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  private async completeFinalization(isUpdate: boolean) {
    const loading = await this.loadingController.create({
      message: isUpdate ? 'Updating report status...' : 'Finalizing report status...'
    });
    await loading.present();

    try {
      // Update the Services table
      const currentDateTime = new Date().toISOString();

      // Get appropriate StatusAdmin value from Status table
      const statusClientValue = isUpdate ? 'Updated' : 'Finalized';
      const statusAdminValue = this.getStatusAdminByClient(statusClientValue);

      const updateData = {
        StatusDateTime: currentDateTime,
        Status: statusAdminValue  // Use StatusAdmin value from Status table
      };

      console.log('[HUD Main] Updating service status:', updateData);
      const response = await this.caspioService.updateService(this.serviceId, updateData).toPromise();
      console.log('[HUD Main] Update response:', response);

      // Clear caches
      console.log('[HUD Main] Clearing caches for project:', this.projectId);
      this.cache.clearProjectRelatedCaches(this.projectId);
      this.cache.clearByPattern('projects_active');
      this.cache.clearByPattern('projects_all');

      // Clean up local blob data after successful finalization
      // This frees device storage while preserving metadata (captions, annotations, remoteUrl)
      console.log('[HUD Main] Cleaning up local blob data...');
      loading.message = 'Freeing device storage...';
      const cleanupResult = await this.localImageService.cleanupBlobDataAfterFinalization(this.serviceId);
      console.log('[HUD Main] Blob cleanup complete:', cleanupResult);

      // Mark all Dexie records as clean (removes dirty flags)
      try {
        await this.hudFieldRepo.markAllCleanForService(this.serviceId);
        console.log('[HUD Main] Marked all Dexie records as clean');
      } catch (err) {
        console.warn('[HUD Main] Failed to mark records clean (non-fatal):', err);
      }

      // Reset change tracking
      this.hasChangesAfterFinalization = false;
      this.isReportFinalized = true;

      await loading.dismiss();

      // Show success message
      const successMessage = isUpdate ? 'Your report has been successfully updated.' : 'Your report has been successfully finalized.';
      const alert = await this.alertController.create({
        header: isUpdate ? 'Report Updated' : 'Report Finalized',
        message: successMessage,
        buttons: [{
          text: 'OK',
          handler: () => {
            // Navigate back to project detail
            console.log('[HUD Main] Navigating to project detail');
            this.navController.navigateBack(['/project', this.projectId]);
          }
        }]
      });
      await alert.present();
    } catch (error) {
      await loading.dismiss();
      console.error('[HUD Main] Error completing finalization:', error);
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to update report status. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  /**
   * Helper to run a promise with timeout
   * Returns { success: false, timedOut: true } on timeout
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<{ result: T; timedOut: false } | { result: null; timedOut: true }> {
    return Promise.race([
      promise.then(result => ({ result, timedOut: false as const })),
      new Promise<{ result: null; timedOut: true }>((resolve) => {
        setTimeout(() => {
          console.warn(`[HUD Main] ${operationName} timed out after ${timeoutMs}ms`);
          resolve({ result: null, timedOut: true });
        }, timeoutMs);
      })
    ]);
  }

}

