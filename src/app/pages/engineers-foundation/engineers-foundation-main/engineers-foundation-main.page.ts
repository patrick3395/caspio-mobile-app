import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController, LoadingController, NavController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { EngineersFoundationStateService } from '../services/engineers-foundation-state.service';
import { EngineersFoundationValidationService, IncompleteField } from '../services/engineers-foundation-validation.service';
import { CaspioService } from '../../../services/caspio.service';
import { CacheService } from '../../../services/cache.service';
import { OfflineTemplateService } from '../../../services/offline-template.service';
import { LocalImageService } from '../../../services/local-image.service';
import { BackgroundSyncService } from '../../../services/background-sync.service';
import { IndexedDbService } from '../../../services/indexed-db.service';
import { EfeFieldRepoService } from '../../../services/efe-field-repo.service';
import { VisualFieldRepoService } from '../../../services/visual-field-repo.service';

interface NavigationCard {
  title: string;
  icon: string;
  route: string;
  description: string;
  completed: boolean;
}

@Component({
  selector: 'app-engineers-foundation-main',
  templateUrl: './engineers-foundation-main.page.html',
  styleUrls: ['./engineers-foundation-main.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class EngineersFoundationMainPage implements OnInit {
  cards: NavigationCard[] = [
    {
      title: 'Project Details',
      icon: 'document-text-outline',
      route: 'project-details',
      description: 'Property information, people, and environmental conditions',
      completed: false
    },
    {
      title: 'Structural Systems',
      icon: 'construct-outline',
      route: 'structural',
      description: 'Visual assessment of foundations, grading, roof, and more',
      completed: false
    },
    {
      title: 'Elevation Plot',
      icon: 'analytics-outline',
      route: 'elevation',
      description: 'Floor elevation measurements and photos',
      completed: false
    }
  ];

  projectId: string = '';
  serviceId: string = '';
  canFinalize: boolean = false;
  statusOptions: any[] = [];
  isReportFinalized: boolean = false;
  hasChangesAfterFinalization: boolean = false;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private stateService: EngineersFoundationStateService,
    private alertController: AlertController,
    private validationService: EngineersFoundationValidationService,
    private caspioService: CaspioService,
    private cache: CacheService,
    private loadingController: LoadingController,
    private navController: NavController,
    private offlineTemplate: OfflineTemplateService,
    private localImageService: LocalImageService,
    private backgroundSync: BackgroundSyncService,
    private indexedDb: IndexedDbService,
    private efeFieldRepo: EfeFieldRepoService,
    private visualFieldRepo: VisualFieldRepoService
  ) {}

  async ngOnInit() {
    // Load status options from Status table (non-blocking)
    this.loadStatusOptions();

    // Get IDs from parent route snapshot immediately (for offline reliability)
    const parentParams = this.route.parent?.snapshot?.params;
    if (parentParams) {
      this.projectId = parentParams['projectId'] || '';
      this.serviceId = parentParams['serviceId'] || '';
      console.log('[EngFoundation Main] Got params from snapshot:', this.projectId, this.serviceId);
    }

    // Also subscribe to param changes (for dynamic updates)
    this.route.parent?.params.subscribe(async params => {
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];

      // Check if report is already finalized (non-blocking - fail silently offline)
      this.checkIfFinalized();

      // Check if report can be finalized (non-blocking - fail silently offline)
      this.checkCanFinalize();
    });
  }

  async loadStatusOptions() {
    try {
      // OFFLINE-FIRST: Use OfflineTemplateService which reads from IndexedDB
      this.statusOptions = await this.offlineTemplate.getStatusOptions();
      console.log('[EngFoundation Main] Loaded status options:', this.statusOptions.length);
    } catch (error) {
      console.error('[EngFoundation Main] Error loading status options:', error);
    }
  }

  getStatusAdminByClient(statusClient: string): string {
    const statusRecord = this.statusOptions.find(s => s.Status_Client === statusClient);
    if (statusRecord && statusRecord.Status_Admin) {
      console.log(`[EngFoundation Main] Status mapping: "${statusClient}" -> "${statusRecord.Status_Admin}"`);
      return statusRecord.Status_Admin;
    }
    console.warn(`[EngFoundation Main] Status_Admin not found for "${statusClient}", using fallback`);
    return statusClient;
  }

  async ionViewWillEnter() {
    // Refresh finalization status when returning to this page
    if (this.projectId && this.serviceId) {
      // Mark that changes may have been made
      if (this.isReportFinalized) {
        this.hasChangesAfterFinalization = true;
        console.log('[EngFoundation Main] Marked changes after finalization');
      }
      // Non-blocking - fail silently offline
      this.checkCanFinalize();
    }
  }

  private async checkIfFinalized() {
    if (!this.serviceId) return;
    
    try {
      // OFFLINE-FIRST: Try IndexedDB first
      const serviceData = await this.offlineTemplate.getService(this.serviceId);
      const status = serviceData?.Status || '';
      
      // Check if status indicates report is finalized
      this.isReportFinalized = status === 'Finalized' || 
                                status === 'Report Finalized' || 
                                status === 'Updated' || 
                                status === 'Under Review';
      
      console.log('[EngFoundation Main] Report finalized status:', this.isReportFinalized, 'Status:', status);
    } catch (error) {
      console.error('[EngFoundation Main] Error checking finalized status:', error);
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
        console.log('[EngFoundation Main] Report finalized. Has changes:', this.hasChangesAfterFinalization, 'Can update:', this.canFinalize);
      } else {
        // For initial finalization, enable if all fields complete
        this.canFinalize = validationResult.isComplete;
        console.log('[EngFoundation Main] Can finalize:', this.canFinalize);
      }
    } catch (error) {
      console.error('[EngFoundation Main] Error checking finalize status:', error);
      this.canFinalize = false;
    }
  }

  navigateTo(card: NavigationCard) {
    console.log('[EngFoundation Main] Navigating to:', card.route, 'projectId:', this.projectId, 'serviceId:', this.serviceId);

    // Use absolute navigation to ensure it works even if parent route isn't ready
    if (this.projectId && this.serviceId) {
      this.router.navigate(['/engineers-foundation', this.projectId, this.serviceId, card.route]);
    } else {
      // Fallback to relative navigation
      this.router.navigate([card.route], { relativeTo: this.route.parent });
    }
  }

  async finalizeReport() {
    console.log('[EngFoundation Main] Starting finalization validation...');
    console.log('[EngFoundation Main] Is finalized:', this.isReportFinalized, 'Has changes:', this.hasChangesAfterFinalization);
    
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
        console.log('[EngFoundation Main] Alert shown with', validationResult.incompleteFields.length, 'missing fields');
      } else {
        // All fields complete - show confirmation dialog
        const isUpdate = this.isReportFinalized;
        const buttonText = isUpdate ? 'Update' : 'Finalize';
        const headerText = isUpdate ? 'Report Ready to Update' : 'Report Complete';
        const messageText = isUpdate
          ? 'All required fields have been completed. Your report is ready to be updated.'
          : 'All required fields have been completed. Ready to finalize?';
        
        console.log('[EngFoundation Main] All fields complete, showing confirmation');
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
      console.error('[EngFoundation Main] Validation error:', error);
      const alert = await this.alertController.create({
        header: 'Validation Error',
        message: 'An error occurred while validating the report. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }


  // Guard against double-click on finalize button
  private isFinalizationInProgress = false;
  private finalizationCancelled = false;

  // Timeout constants for sync operations (in milliseconds)
  private readonly SYNC_TIMEOUT_MS = 45000; // 45 seconds per sync step

  /**
   * Helper to run a promise with timeout
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T | 'timeout'> {
    return Promise.race([
      promise,
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => {
          console.log(`[EngFoundation Main] ${operationName} timed out after ${timeoutMs/1000}s`);
          resolve('timeout');
        }, timeoutMs);
      })
    ]);
  }

  async markReportAsFinalized() {
    // Prevent double-click
    if (this.isFinalizationInProgress) {
      console.log('[EngFoundation Main] Finalization already in progress, ignoring');
      return;
    }
    this.isFinalizationInProgress = true;
    this.finalizationCancelled = false;

    const isUpdate = this.isReportFinalized;

    // Create cancellable loading dialog
    const loading = await this.loadingController.create({
      message: isUpdate ? 'Updating report...' : 'Finalizing report...',
      backdropDismiss: false,
      buttons: [{
        text: 'Cancel',
        role: 'cancel',
        handler: () => {
          console.log('[EngFoundation Main] Finalization cancelled by user');
          this.finalizationCancelled = true;
          this.isFinalizationInProgress = false;
        }
      }]
    });
    await loading.present();

    try {
      // ==========================================
      // STEP 1: Sync ALL pending images (with timeout)
      // ==========================================
      console.log('[EngFoundation Main] Checking for unsynced images...');
      const imageStatus = await this.localImageService.getServiceImageSyncStatus(this.serviceId);

      if (this.finalizationCancelled) return;

      if (imageStatus.pending > 0) {
        console.log(`[EngFoundation Main] Found ${imageStatus.pending} unsynced images, forcing sync...`);
        loading.message = `Syncing ${imageStatus.pending} image(s)... (tap Cancel to skip)`;

        // Trigger background sync to process pending uploads
        this.backgroundSync.triggerSync();

        // Force sync with timeout
        const syncResult = await this.withTimeout(
          this.localImageService.forceSyncServiceImages(
            this.serviceId,
            (current, total, status) => {
              if (!this.finalizationCancelled) {
                loading.message = `${status} (tap Cancel to skip)`;
              }
            }
          ),
          this.SYNC_TIMEOUT_MS,
          'Image sync'
        );

        if (this.finalizationCancelled) return;

        // Handle timeout or failure
        if (syncResult === 'timeout' || (syncResult !== 'timeout' && !syncResult.success)) {
          const failedCount = syncResult === 'timeout' ? imageStatus.pending : syncResult.failedCount;
          const reason = syncResult === 'timeout' ? 'Sync timed out' : 'Some images failed';

          await loading.dismiss();
          this.isFinalizationInProgress = false;

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

      if (this.finalizationCancelled) return;

      // ==========================================
      // STEP 2: Sync ALL pending requests/captions (with timeout)
      // ==========================================
      console.log('[EngFoundation Main] Syncing pending requests and captions...');
      loading.message = 'Syncing data... (tap Cancel to skip)';

      const dataSyncResult = await this.withTimeout(
        this.backgroundSync.forceSyncAllPendingForService(
          this.serviceId,
          (status, current, total) => {
            if (!this.finalizationCancelled) {
              loading.message = `${status} (tap Cancel to skip)`;
            }
          }
        ),
        this.SYNC_TIMEOUT_MS,
        'Data sync'
      );

      if (this.finalizationCancelled) return;

      console.log('[EngFoundation Main] Data sync result:', dataSyncResult);

      // Handle timeout or failure
      if (dataSyncResult === 'timeout' || (dataSyncResult !== 'timeout' && !dataSyncResult.success)) {
        const failedTotal = dataSyncResult === 'timeout' ? '?' :
          (dataSyncResult.requestsFailed + dataSyncResult.captionsFailed);
        const reason = dataSyncResult === 'timeout' ? 'Sync timed out' : 'Some items failed';

        await loading.dismiss();
        this.isFinalizationInProgress = false;

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

      if (this.finalizationCancelled) return;

      // ==========================================
      // STEP 3: Update image pointers
      // ==========================================
      console.log('[EngFoundation Main] Updating image pointers to remote URLs...');
      loading.message = 'Updating image references...';
      await this.localImageService.updateImagePointersToRemote(this.serviceId);

      await loading.dismiss();

      if (this.finalizationCancelled) return;

      // ==========================================
      // STEP 4: Complete finalization
      // ==========================================
      await this.completeFinalization(isUpdate);

    } catch (error) {
      await loading.dismiss();
      this.isFinalizationInProgress = false;
      console.error('[EngFoundation Main] Error finalizing report:', error);
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
      message: isUpdate ? 'Updating report status...' : 'Finalizing report status...',
      backdropDismiss: false
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
        Status: statusAdminValue
      };

      console.log('[EngFoundation Main] Updating service status:', updateData);

      // Try to update with timeout - if it fails, we still complete locally
      let statusUpdateSuccess = false;
      try {
        const statusUpdatePromise = this.caspioService.updateService(this.serviceId, updateData).toPromise();
        const result = await this.withTimeout(statusUpdatePromise, 15000, 'Status update');

        if (result !== 'timeout') {
          statusUpdateSuccess = true;
          console.log('[EngFoundation Main] Update response:', result);
        } else {
          console.warn('[EngFoundation Main] Status update timed out - will sync later');
        }
      } catch (statusErr) {
        console.warn('[EngFoundation Main] Status update failed - will sync later:', statusErr);
      }

      // ==========================================
      // CLEANUP STEP 1: Clear any remaining pending items
      // ==========================================
      console.log('[EngFoundation Main] Clearing any remaining pending items...');
      loading.message = 'Cleaning up...';

      try {
        const clearedItems = await this.indexedDb.clearPendingForService(this.serviceId);
        console.log('[EngFoundation Main] Cleared pending items:', clearedItems);
      } catch (err) {
        console.warn('[EngFoundation Main] Error clearing pending items:', err);
      }

      // ==========================================
      // CLEANUP STEP 2: Mark Dexie records as clean
      // ==========================================
      try {
        await this.efeFieldRepo.markAllCleanForService(this.serviceId);
        await this.visualFieldRepo.markAllCleanForService(this.serviceId);
        console.log('[EngFoundation Main] Marked all Dexie records as clean');
      } catch (err) {
        console.warn('[EngFoundation Main] Error marking records clean:', err);
      }

      // ==========================================
      // CLEANUP STEP 3: Clear API caches
      // ==========================================
      console.log('[EngFoundation Main] Clearing caches for project:', this.projectId);
      this.cache.clearProjectRelatedCaches(this.projectId);
      this.cache.clearByPattern('projects_active');
      this.cache.clearByPattern('projects_all');

      // ==========================================
      // CLEANUP STEP 4: Prune local blobs
      // ==========================================
      console.log('[EngFoundation Main] Cleaning up local blob data...');
      loading.message = 'Freeing device storage...';
      const cleanupResult = await this.localImageService.cleanupBlobDataAfterFinalization(this.serviceId);
      console.log('[EngFoundation Main] Blob cleanup complete:', cleanupResult);

      // Reset change tracking
      this.hasChangesAfterFinalization = false;
      this.isReportFinalized = true;
      this.isFinalizationInProgress = false;

      await loading.dismiss();

      // Show success message (with note if status update failed)
      let successMessage = isUpdate
        ? 'Your report has been successfully updated.'
        : 'Your report has been successfully finalized.';

      if (!statusUpdateSuccess) {
        successMessage += '\n\nNote: Status update will sync when you have better connectivity.';
      }

      const alert = await this.alertController.create({
        header: isUpdate ? 'Report Updated' : 'Report Finalized',
        message: successMessage,
        buttons: [{
          text: 'OK',
          handler: () => {
            // Navigate back to project detail
            console.log('[EngFoundation Main] Navigating to project detail');
            this.navController.navigateBack(['/project', this.projectId]);
          }
        }]
      });
      await alert.present();
    } catch (error) {
      await loading.dismiss();
      this.isFinalizationInProgress = false;
      console.error('[EngFoundation Main] Error completing finalization:', error);
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to update report status. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

}
