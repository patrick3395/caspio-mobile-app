import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController, LoadingController, NavController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { DteValidationService, IncompleteField } from '../services/dte-validation.service';
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
  selector: 'app-dte-main',
  templateUrl: './dte-main.page.html',
  styleUrls: ['./dte-main.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class DteMainPage implements OnInit {
  cards: NavigationCard[] = [
    {
      title: 'Project Details',
      icon: 'document-text-outline',
      route: 'project-details',
      description: '',
      completed: false
    },
    {
      title: 'Damaged Truss Evaluation',
      icon: 'construct-outline',
      route: 'categories',
      description: '',
      completed: false
    }
  ];

  projectId: string = '';
  serviceId: string = '';
  loading: boolean = true;
  canFinalize: boolean = false;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private alertController: AlertController,
    private validationService: DteValidationService,
    private caspioService: CaspioService,
    private cache: CacheService,
    private loadingController: LoadingController,
    private navController: NavController
  ) {}

  async ngOnInit() {
    // Get IDs from parent route (container level)
    // Route structure: dte/:projectId/:serviceId -> (main hub is here)
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
      this.canFinalize = validationResult.isComplete;
      console.log('[DTE Main] Can finalize:', this.canFinalize);
    } catch (error) {
      console.error('[DTE Main] Error checking finalize status:', error);
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
    console.log('[DTE Main] Starting finalization validation...');
    
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
        // Show popup with missing fields organized by page/section
        const message = this.formatIncompleteFieldsMessage(validationResult.incompleteFields);
        
        const alert = await this.alertController.create({
          header: 'Incomplete Required Fields',
          message: message,
          cssClass: 'custom-document-alert',
          buttons: ['OK']
        });
        await alert.present();
        console.log('[DTE Main] Alert shown with missing fields');
      } else {
        // All fields complete - show confirmation dialog
        console.log('[DTE Main] All fields complete, showing confirmation');
        const alert = await this.alertController.create({
          header: 'Report Complete',
          message: 'All required fields have been completed. Ready to finalize?',
          cssClass: 'custom-document-alert',
          buttons: [
            { text: 'Cancel', role: 'cancel' },
            { 
              text: 'Finalize', 
              handler: () => this.markReportAsFinalized() 
            }
          ]
        });
        await alert.present();
      }
    } catch (error) {
      await loading.dismiss();
      console.error('[DTE Main] Validation error:', error);
      const alert = await this.alertController.create({
        header: 'Validation Error',
        message: 'An error occurred while validating the report. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  private formatIncompleteFieldsMessage(fields: IncompleteField[]): string {
    let message = 'Please complete the following required fields:\n\n';
    
    fields.forEach(field => {
      message += `${field.label}\n`;
    });
    
    return message;
  }

  async markReportAsFinalized() {
    const loading = await this.loadingController.create({
      message: 'Finalizing report...'
    });
    await loading.present();

    try {
      // Update the Services table
      const currentDateTime = new Date().toISOString();
      const updateData = {
        StatusDateTime: currentDateTime,
        Status: 'Finalized'
      };

      console.log('[DTE Main] Updating service status:', updateData);
      await this.caspioService.updateService(this.serviceId, updateData).toPromise();

      // Clear caches
      console.log('[DTE Main] Clearing caches for project:', this.projectId);
      this.cache.clearProjectRelatedCaches(this.projectId);
      this.cache.clearByPattern('projects_active');
      this.cache.clearByPattern('projects_all');

      await loading.dismiss();

      // Show success message
      const alert = await this.alertController.create({
        header: 'Report Finalized',
        message: 'Your report has been successfully finalized.',
        buttons: [{
          text: 'OK',
          handler: () => {
            // Navigate back to project detail
            console.log('[DTE Main] Navigating to project detail');
            this.navController.navigateBack(['/project', this.projectId]);
          }
        }]
      });
      await alert.present();
    } catch (error) {
      await loading.dismiss();
      console.error('[DTE Main] Error finalizing report:', error);
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'Failed to finalize report. Please try again.',
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  canFinalize(): boolean {
    // Always return true so button is enabled - validation happens in finalizeReport()
    return true;
  }
}

