import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { EngineersFoundationStateService } from '../services/engineers-foundation-state.service';

@Component({
  selector: 'app-room-elevation',
  templateUrl: './room-elevation.page.html',
  styleUrls: ['./room-elevation.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule]
})
export class RoomElevationPage implements OnInit {
  projectId: string = '';
  serviceId: string = '';
  roomName: string = '';

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

    // Get room name from route params
    this.route.params.subscribe(params => {
      this.roomName = params['roomName'];
    });
  }

  goBack() {
    this.router.navigate(['..', '..'], { relativeTo: this.route });
  }
}
