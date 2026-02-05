import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController, LoadingController, NavController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { CaspioService } from '../../../services/caspio.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { IndexedDbService } from '../../../services/indexed-db.service';
import { LbwValidationService, IncompleteField } from '../services/lbw-validation.service';
import { CacheService } from '../../../services/cache.service';
import { LocalImageService } from '../../../services/local-image.service';
import { BackgroundSyncService } from '../../../services/background-sync.service';
import { environment } from '../../../../environments/environment';

interface NavigationCard {
  title: string;
  icon: string;
  route: string;
  description: string;
  completed: boolean;
  category?: string;
}

@Component({
  selector: 'app-lbw-main',
  templateUrl: './lbw-main.page.html',
  styleUrls: ['./lbw-main.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class LbwMainPage implements OnInit {
  // DEXIE-FIRST: Initialize cards immediately for instant display
  cards: NavigationCard[] = [
    {
      title: 'Project Details',
      icon: 'document-text-outline',
      route: 'project-details',
      description: '',
      completed: false
    },
    {
      title: 'Load Bearing Wall',
      icon: 'construct-outline',
      route: 'categories',
      description: '',
      completed: false
    }
  ];

  projectId: string = '';
  serviceId: string = '';
  loading: boolean = false;
  canFinalize: boolean = false;
  statusOptions: any[] = [];
  isReportFinalized: boolean = false;
  hasChangesAfterFinalization: boolean = false;
  private initialLoadComplete: boolean = false;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private caspioService: CaspioService,
    private offlineTemplate: OfflineTemplateService,
    private indexedDb: IndexedDbService,
    private alertController: AlertController,
    private validationService: LbwValidationService,
    private cache: CacheService,
    private loadingController: LoadingController,
    private navController: NavController,
    private localImageService: LocalImageService,
    private backgroundSync: BackgroundSyncService
  ) {}

  async ngOnInit() {
    // Get IDs from parent route (container level)
    // Route structure: lbw/:projectId/:serviceId -> (main hub is here)
    this.route.parent?.params.subscribe(async params => {
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];


      if (!this.projectId || !this.serviceId) {
        console.error('[LBW Main] Missing projectId or serviceId');
        return;
      }

      // Load status options and check finalization in background (non-blocking)
      this.loadStatusOptions();
      this.checkIfFinalized();
      this.checkCanFinalize();

      this.initialLoadComplete = true;
    });
  }

  async ionViewWillEnter() {
    // DEXIE-FIRST: Non-blocking refresh when returning to this page
    if (this.projectId && this.serviceId) {
      // Mark that changes may have been made
      if (this.isReportFinalized) {
        this.hasChangesAfterFinalization = true;
      }
      // Non-blocking - don't await
      this.checkCanFinalize();
    }
  }

  private async checkIfFinalized() {
    if (!this.serviceId) return;

    try {
      // DEXIE-FIRST: Try to get service from cache first
      const cachedService = await this.indexedDb.getCachedServiceRecord(this.serviceId);
      if (cachedService) {
        const status = cachedService.Status || '';
        this.isReportFinalized = status === 'Finalized' ||
                                  status === 'Report Finalized' ||
                                  status === 'Updated' ||
                                  status === 'Under Review';
        return;
      }

      // Fallback to API if not in cache (WEBAPP mode or cache miss)
      if (environment.isWeb) {
        const serviceData = await this.caspioService.getServiceById(this.serviceId).toPromise();
        const status = serviceData?.Status || '';

        this.isReportFinalized = status === 'Finalized' ||
                                  status === 'Report Finalized' ||
                                  status === 'Updated' ||
                                  status === 'Under Review';

      }
    } catch (error) {
      console.error('[LBW Main] Error checking finalized status:', error);
    }
  }

  async loadStatusOptions() {
    try {
      // DEXIE-FIRST: Try to get status options from cache first
      const cachedStatus = await this.indexedDb.getCachedGlobalData('status');
      if (cachedStatus && cachedStatus.length > 0) {
        this.statusOptions = cachedStatus;
        return;
      }

      // Fallback to API if not in cache
      const statusData: any = await this.caspioService.get('/tables/LPS_Status/records').toPromise();
      this.statusOptions = statusData?.Result || [];
    } catch (error) {
      console.error('[LBW Main] Error loading status options:', error);
    }
  }

  getStatusAdminByClient(statusClient: string): string {
    const statusRecord = this.statusOptions.find(s => s.Status_Client === statusClient);
    if (statusRecord && statusRecord.Status_Admin) {
      return statusRecord.Status_Admin;
    }
    console.warn(`[LBW Main] Status_Admin not found for "${statusClient}", using fallback`);
    return statusClient;
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
      } else {
        // For initial finalization, enable if all fields complete
        this.canFinalize = validationResult.isComplete;
      }
    } catch (error) {
      console.error('[LBW Main] Error checking finalize status:', error);
      this.canFinalize = false;
    }
  }

  navigateTo(card: NavigationCard) {
    if (card.route === 'categories') {
      // Navigate to categories list page
      this.router.navigate(['categories'], { relativeTo: this.route });
    } else {
      this.router.navigate([card.route], { relativeTo: this.route.parent });
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
      } else {
        // All fields complete - show confirmation dialog
        const isUpdate = this.isReportFinalized;
        const buttonText = isUpdate ? 'Update' : 'Finalize';
        const headerText = isUpdate ? 'Report Ready to Update' : 'Report Complete';
        const messageText = isUpdate
          ? 'All required fields have been completed. Your report is ready to be updated.'
          : 'All required fields have been completed. Ready to finalize?';
        
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
      console.error('[LBW Main] Validation error:', error);
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
      // Step 1: Check for unsynced images and force sync them
      const imageStatus = await this.localImageService.getServiceImageSyncStatus(this.serviceId);

      if (imageStatus.pending > 0) {
        loading.message = `Syncing ${imageStatus.pending} image(s)...`;

        // Trigger background sync to process pending uploads
        this.backgroundSync.triggerSync();

        // Force sync and wait for completion
        const syncResult = await this.localImageService.forceSyncServiceImages(
          this.serviceId,
          (current, total, status) => {
            loading.message = status;
          }
        );

        if (!syncResult.success) {
          await loading.dismiss();

          // Show warning about failed images but allow proceeding
          const failedCount = syncResult.failedCount;
          const alert = await this.alertController.create({
            header: 'Image Sync Warning',
            message: `${failedCount} image(s) could not be synced. These images may not be available remotely. Do you want to proceed with finalization anyway?`,
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

      // Step 2: Update image pointers to remote URLs
      loading.message = 'Updating image references...';
      await this.localImageService.updateImagePointersToRemote(this.serviceId);

      await loading.dismiss();

      // Step 3: Complete the finalization
      await this.completeFinalization(isUpdate);

    } catch (error) {
      await loading.dismiss();
      console.error('[LBW Main] Error finalizing report:', error);
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

      const response = await this.caspioService.updateService(this.serviceId, updateData).toPromise();

      // Clear caches
      this.cache.clearProjectRelatedCaches(this.projectId);
      this.cache.clearByPattern('projects_active');
      this.cache.clearByPattern('projects_all');

      // Clean up local blob data after successful finalization
      // This frees device storage while preserving metadata (captions, annotations, remoteUrl)
      loading.message = 'Freeing device storage...';
      const cleanupResult = await this.localImageService.cleanupBlobDataAfterFinalization(this.serviceId);

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
            this.navController.navigateBack(['/project', this.projectId]);
          }
        }]
      });
      await alert.present();
    } catch (error) {
      await loading.dismiss();
      console.error('[LBW Main] Error completing finalization:', error);
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to update report status. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

}

