import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { CaspioService } from '../../../services/caspio.service';
import { HudDataService } from '../hud-data.service';

interface NavigationCard {
  title: string;
  icon: string;
  route: string;
  description: string;
  completed: boolean;
}

@Component({
  selector: 'app-hud-main',
  templateUrl: './hud-main.page.html',
  styleUrls: ['./hud-main.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class HudMainPage implements OnInit {
  cards: NavigationCard[] = [
    {
      title: 'Project Details',
      icon: 'document-text-outline',
      route: 'project-details',
      description: 'Property information, people, and environmental conditions',
      completed: false
    },
    {
      title: 'Visual Assessment',
      icon: 'construct-outline',
      route: 'categories',
      description: 'HUD/Manufactured home inspection items by category',
      completed: false
    }
  ];

  projectId: string = '';
  serviceId: string = '';
  categories: { name: string; deficiencyCount: number }[] = [];
  loading: boolean = true;
  showCategories: boolean = false;

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private caspioService: CaspioService,
    private changeDetectorRef: ChangeDetectorRef,
    private hudData: HudDataService
  ) {}

  async ngOnInit() {
    // Get IDs from parent route (container level)
    // Route structure: hud/:projectId/:serviceId -> (main hub is here)
    this.route.parent?.params.subscribe(params => {
      console.log('Route params from parent:', params);
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];

      console.log('ProjectId:', this.projectId, 'ServiceId:', this.serviceId);

      if (this.projectId && this.serviceId) {
        this.loadData();
      } else {
        console.error('Missing projectId or serviceId');
        this.loading = false;
      }
    });
  }

  private async loadData() {
    this.loading = true;

    try {
      // Load categories from HUD templates
      await this.loadCategories();

      this.loading = false;
    } catch (error) {
      console.error('Error in loadData:', error);
      this.loading = false;
    }
  }

  private async loadCategories() {
    try {
      // Get all HUD templates
      const allTemplates = await this.caspioService.getServicesHUDTemplates().toPromise();
      const hudTemplates = allTemplates || [];

      console.log('Loaded HUD templates:', hudTemplates.length);

      // Extract unique categories in order
      const categoriesSet = new Set<string>();
      const categoriesOrder: string[] = [];

      hudTemplates.forEach((template: any) => {
        if (template.Category && !categoriesSet.has(template.Category)) {
          categoriesSet.add(template.Category);
          categoriesOrder.push(template.Category);
          console.log('Found category:', template.Category);
        }
      });

      console.log('Total unique categories:', categoriesOrder.length);
      console.log('Categories:', categoriesOrder);

      // Get deficiency counts for each category from saved visuals
      const deficiencyCounts = await this.getDeficiencyCountsByCategory();

      this.categories = categoriesOrder.map(cat => ({
        name: cat,
        deficiencyCount: deficiencyCounts[cat] || 0
      }));

      console.log('Categories with deficiency counts:', this.categories);

    } catch (error) {
      console.error('Error loading categories:', error);
    }
  }

  private async getDeficiencyCountsByCategory(): Promise<{ [category: string]: number }> {
    try {
      // Load all existing HUD visuals for this service
      const visuals = await this.hudData.getVisualsByService(this.serviceId);
      
      console.log('[Deficiency Count] Found', visuals.length, 'total visuals');

      // Count deficiencies by category
      const counts: { [category: string]: number } = {};

      visuals.forEach((visual: any) => {
        const kind = visual.Kind || '';
        const category = visual.Category || '';

        // Only count items marked as "Deficiency"
        if (kind === 'Deficiency' && category) {
          counts[category] = (counts[category] || 0) + 1;
        }
      });

      console.log('[Deficiency Count] Counts by category:', counts);

      return counts;
    } catch (error) {
      console.error('Error counting deficiencies:', error);
      return {};
    }
  }

  navigateTo(card: NavigationCard) {
    if (card.route === 'categories') {
      this.showCategories = true;
    } else {
      this.router.navigate([card.route], { relativeTo: this.route.parent });
    }
  }

  navigateToCategory(categoryName: string) {
    this.router.navigate(['category', categoryName], { relativeTo: this.route });
  }

  goBackToCards() {
    this.showCategories = false;
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

  getCategoryIcon(categoryName: string): string {
    const iconMap: { [key: string]: string } = {
      'Site': 'globe-outline',
      'Foundation': 'business-outline',
      'Exterior': 'home-outline',
      'Roof': 'umbrella-outline',
      'Structure': 'construct-outline',
      'Plumbing': 'water-outline',
      'Electrical': 'flash-outline',
      'Heating/Cooling': 'thermometer-outline',
      'Interior': 'grid-outline',
      'Appliances': 'apps-outline',
      'Other': 'ellipsis-horizontal-circle-outline'
    };

    return iconMap[categoryName] || 'document-text-outline';
  }
}

