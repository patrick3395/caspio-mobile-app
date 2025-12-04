import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { EngineersFoundationStateService } from '../services/engineers-foundation-state.service';

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

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private stateService: EngineersFoundationStateService,
    private alertController: AlertController
  ) {}

  ngOnInit() {
    // Get IDs from parent route
    this.route.parent?.params.subscribe(params => {
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];
    });

    // TODO: Check completion status for each section
    this.checkCompletionStatus();
  }

  navigateTo(card: NavigationCard) {
    this.router.navigate([card.route], { relativeTo: this.route.parent });
  }

  private checkCompletionStatus() {
    // TODO: Implement logic to check if each section is complete
    // This will be implemented as we build out the individual pages
  }

  async finalizeReport() {
    console.log('[EngFoundation Main] Finalize button clicked');
    
    // Check which sections are incomplete
    const incompleteSections = this.cards
      .filter(card => !card.completed)
      .map(card => card.title);

    console.log('[EngFoundation Main] Incomplete sections:', incompleteSections);

    if (incompleteSections.length > 0) {
      // Show alert with incomplete sections
      const alert = await this.alertController.create({
        header: 'Incomplete Sections',
        message: `The following sections need to be completed before finalizing:\n\n${incompleteSections.map(section => `• ${section}`).join('\n')}\n\nPlease complete all sections and try again.`,
        cssClass: 'custom-document-alert',
        buttons: ['OK']
      });
      await alert.present();
      console.log('[EngFoundation Main] Alert shown with incomplete sections');
    } else {
      // All sections complete - navigate to actual finalization
      console.log('[EngFoundation Main] All sections complete, proceeding to finalize');
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
