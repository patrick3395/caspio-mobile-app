import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { EngineersFoundationStateService } from '../services/engineers-foundation-state.service';

interface RoomCard {
  name: string;
  route: string;
  pointCount?: number;
}

@Component({
  selector: 'app-elevation-plot-hub',
  templateUrl: './elevation-plot-hub.page.html',
  styleUrls: ['./elevation-plot-hub.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class ElevationPlotHubPage implements OnInit {
  projectId: string = '';
  serviceId: string = '';
  rooms: RoomCard[] = [];

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

    // TODO: Load rooms from state service
    this.loadRooms();
  }

  goBack() {
    this.router.navigate(['..'], { relativeTo: this.route });
  }

  navigateToBaseStation() {
    this.router.navigate(['base-station'], { relativeTo: this.route });
  }

  navigateToRoom(room: RoomCard) {
    this.router.navigate(['room', room.name], { relativeTo: this.route });
  }

  private loadRooms() {
    // Placeholder - will be populated from state service
    this.rooms = [];
  }
}
