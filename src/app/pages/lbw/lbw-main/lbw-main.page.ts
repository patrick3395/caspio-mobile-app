import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
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
    private caspioService: CaspioService
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
    // TODO: Implement report finalization
    console.log('Finalizing report...');
  }

  canFinalize(): boolean {
    // TODO: Check if all required sections are complete
    return this.cards.every(card => card.completed);
  }
}

