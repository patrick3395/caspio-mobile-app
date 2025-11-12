import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { EngineersFoundationStateService } from '../services/engineers-foundation-state.service';

@Component({
  selector: 'app-base-station',
  templateUrl: './base-station.page.html',
  styleUrls: ['./base-station.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class BaseStationPage implements OnInit {
  projectId: string = '';
  serviceId: string = '';

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
  }

  goBack() {
    this.router.navigate(['..'], { relativeTo: this.route });
  }
}
