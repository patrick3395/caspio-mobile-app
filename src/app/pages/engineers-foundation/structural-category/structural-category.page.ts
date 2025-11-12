import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { EngineersFoundationStateService } from '../services/engineers-foundation-state.service';

@Component({
  selector: 'app-structural-category',
  templateUrl: './structural-category.page.html',
  styleUrls: ['./structural-category.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class StructuralCategoryPage implements OnInit {
  projectId: string = '';
  serviceId: string = '';
  categoryName: string = '';

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private stateService: EngineersFoundationStateService
  ) {}

  ngOnInit() {
    // Get IDs from parent route
    this.route.parent?.parent?.params.subscribe(params => {
      this.projectId = params['projectId'];
      this.serviceId = params['serviceId'];
    });

    // Get category from route params
    this.route.params.subscribe(params => {
      this.categoryName = params['category'];
    });
  }

  goBack() {
    this.router.navigate(['..'], { relativeTo: this.route });
  }
}
