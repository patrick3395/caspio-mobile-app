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
      
      // Load categories from LBW templates
      await this.loadCategories();
      
      this.loading = false;
    });
  }

  async loadCategories() {
    try {
      console.log('[LBW Main] Loading categories from LPS_Services_LBW_Templates...');
      const templates = await this.caspioService.getServicesLBWTemplates().toPromise();
      
      // Extract unique categories
      const categorySet = new Set<string>();
      (templates || []).forEach((template: any) => {
        if (template.Category) {
          categorySet.add(template.Category);
        }
      });

      const categories = Array.from(categorySet).sort();
      console.log('[LBW Main] Found categories:', categories);

      // Create cards - Project Details first, then categories
      this.cards = [
        {
          title: 'Project Details',
          icon: 'document-text-outline',
          route: 'project-details',
          description: '',
          completed: false
        }
      ];

      // Add a card for each category
      categories.forEach(category => {
        this.cards.push({
          title: category,
          icon: 'construct-outline',
          route: 'category',
          description: '',
          completed: false,
          category: category
        });
      });

      console.log('[LBW Main] Created navigation cards:', this.cards);
    } catch (error) {
      console.error('[LBW Main] Error loading categories:', error);
    }
  }

  navigateTo(card: NavigationCard) {
    if (card.route === 'category' && card.category) {
      // Navigate to specific category
      this.router.navigate(['category', card.category], { relativeTo: this.route });
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

