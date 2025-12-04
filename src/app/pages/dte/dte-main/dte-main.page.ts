import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';

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

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private alertController: AlertController
  ) {}

  async ngOnInit() {
    // Get IDs from parent route (container level)
    // Route structure: dte/:projectId/:serviceId -> (main hub is here)
    this.route.parent?.params.subscribe(params => {
      console.log('Route params from parent:', params);
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];

      console.log('ProjectId:', this.projectId, 'ServiceId:', this.serviceId);

      if (!this.projectId || !this.serviceId) {
        console.error('Missing projectId or serviceId');
      }
      
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
    console.log('[DTE Main] Finalize button clicked');
    
    // Check which sections are incomplete
    const incompleteSections = this.cards
      .filter(card => !card.completed)
      .map(card => card.title);

    console.log('[DTE Main] Incomplete sections:', incompleteSections);

    if (incompleteSections.length > 0) {
      // Show alert with incomplete sections
      const alert = await this.alertController.create({
        header: 'Incomplete Sections',
        message: `The following sections need to be completed before finalizing:\n\n${incompleteSections.map(section => `• ${section}`).join('\n')}\n\nPlease complete all sections and try again.`,
        cssClass: 'custom-document-alert',
        buttons: ['OK']
      });
      await alert.present();
      console.log('[DTE Main] Alert shown with incomplete sections');
    } else {
      // All sections complete - navigate to actual finalization
      console.log('[DTE Main] All sections complete, proceeding to finalize');
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

