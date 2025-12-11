import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController, LoadingController, NavController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { EngineersFoundationStateService } from '../services/engineers-foundation-state.service';
import { EngineersFoundationValidationService, IncompleteField } from '../services/engineers-foundation-validation.service';
import { CaspioService } from '../../../services/caspio.service';
import { CacheService } from '../../../services/cache.service';

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
    private navController: NavController
  ) {}

  async ngOnInit() {
    // Load status options from Status table
    await this.loadStatusOptions();
    
    // Get IDs from parent route
    this.route.parent?.params.subscribe(async params => {
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];
      
      // Check if report is already finalized
      await this.checkIfFinalized();
      
      // Check if report can be finalized (for button styling)
      await this.checkCanFinalize();
    });
  }

  async loadStatusOptions() {
    try {
      const statusData: any = await this.caspioService.get('/tables/LPS_Status/records').toPromise();
      this.statusOptions = statusData?.Result || [];
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
      await this.checkCanFinalize();
    }
  }

  private async checkIfFinalized() {
    if (!this.serviceId) return;
    
    try {
      const serviceData = await this.caspioService.getServiceById(this.serviceId).toPromise();
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
    this.router.navigate([card.route], { relativeTo: this.route.parent });
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


  async markReportAsFinalized() {
    const isUpdate = this.isReportFinalized;
    
    const loading = await this.loadingController.create({
      message: isUpdate ? 'Updating report...' : 'Finalizing report...'
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

      console.log('[EngFoundation Main] Updating service status:', updateData);
      const response = await this.caspioService.updateService(this.serviceId, updateData).toPromise();
      console.log('[EngFoundation Main] Update response:', response);

      // Clear caches
      console.log('[EngFoundation Main] Clearing caches for project:', this.projectId);
      this.cache.clearProjectRelatedCaches(this.projectId);
      this.cache.clearByPattern('projects_active');
      this.cache.clearByPattern('projects_all');

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
            console.log('[EngFoundation Main] Navigating to project detail');
            this.navController.navigateBack(['/project', this.projectId]);
          }
        }]
      });
      await alert.present();
    } catch (error) {
      await loading.dismiss();
      console.error('[EngFoundation Main] Error finalizing report:', error);
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to finalize report. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

}
