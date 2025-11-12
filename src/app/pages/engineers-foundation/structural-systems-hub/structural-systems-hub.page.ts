import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { EngineersFoundationStateService } from '../services/engineers-foundation-state.service';

interface CategoryCard {
  title: string;
  icon: string;
  route: string;
  description: string;
}

@Component({
  selector: 'app-structural-systems-hub',
  templateUrl: './structural-systems-hub.page.html',
  styleUrls: ['./structural-systems-hub.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class StructuralSystemsHubPage implements OnInit {
  projectId: string = '';
  serviceId: string = '';

  categories: CategoryCard[] = [
    {
      title: 'Foundations',
      icon: 'layers-outline',
      route: 'foundations',
      description: 'Foundation type, condition, and observations'
    },
    {
      title: 'Grading and Drainage',
      icon: 'water-outline',
      route: 'grading',
      description: 'Site drainage and water management'
    },
    {
      title: 'Roof',
      icon: 'home-outline',
      route: 'roof',
      description: 'Roof condition and structural integrity'
    }
    // TODO: Add remaining categories
  ];

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private stateService: EngineersFoundationStateService
  ) {}

  ngOnInit() {
    // Get IDs from parent route
    this.route.parent?.params.subscribe(params => {
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];
    });
  }

  goBack() {
    this.router.navigate(['..'], { relativeTo: this.route });
  }

  navigateToCategory(category: CategoryCard) {
    this.router.navigate([category.route], { relativeTo: this.route });
  }
}
