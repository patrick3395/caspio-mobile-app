import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { CaspioService } from '../../../services/caspio.service';

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
  cards: NavigationCard[] = [];

  projectId: string = '';
  serviceId: string = '';
  loading: boolean = true;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private caspioService: CaspioService,
    private alertController: AlertController
  ) {}

  async ngOnInit() {
    // Get IDs from parent route (container level)
    // Route structure: lbw/:projectId/:serviceId -> (main hub is here)
    this.route.parent?.params.subscribe(async params => {
      console.log('[LBW Main] Route params from parent:', params);
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];

      console.log('[LBW Main] ProjectId:', this.projectId, 'ServiceId:', this.serviceId);

      if (!this.projectId || !this.serviceId) {
        console.error('[LBW Main] Missing projectId or serviceId');
        this.loading = false;
        return;
      }
      
      // Create main navigation cards
      this.cards = [
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
      
      this.loading = false;
    });
  }

  navigateTo(card: NavigationCard) {
    if (card.route === 'categories') {
      // Navigate to categories list page
      this.router.navigate(['categories'], { relativeTo: this.route });
    } else {
      this.router.navigate([card.route], { relativeTo: this.route.parent });
    }
  }

  private checkCompletionStatus() {
    // TODO: Implement logic to check if each section is complete
  }

  async finalizeReport() {
    console.log('[LBW Main] Finalize button clicked');
    
    // Check which sections are incomplete
    const incompleteSections = this.cards
      .filter(card => !card.completed)
      .map(card => card.title);

    console.log('[LBW Main] Incomplete sections:', incompleteSections);

    if (incompleteSections.length > 0) {
      // Show alert with incomplete sections
      const alert = await this.alertController.create({
        header: 'Incomplete Sections',
        message: `The following sections need to be completed before finalizing:\n\n${incompleteSections.map(section => `• ${section}`).join('\n')}\n\nPlease complete all sections and try again.`,
        cssClass: 'custom-document-alert',
        buttons: ['OK']
      });
      await alert.present();
      console.log('[LBW Main] Alert shown with incomplete sections');
    } else {
      // All sections complete - navigate to actual finalization
      console.log('[LBW Main] All sections complete, proceeding to finalize');
      // TODO: Navigate to the actual report page for finalization
      // For now, show success message
      const alert = await this.alertController.create({
        header: 'Ready to Finalize',
        message: 'All sections are complete. Report finalization feature is under construction.',
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

