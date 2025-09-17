import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { OfflineService } from '../../services/offline.service';

@Component({
  selector: 'app-sync-toggle',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './sync-toggle.component.html',
  styleUrls: ['./sync-toggle.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SyncToggleComponent {
  readonly manualOffline$ = this.offlineService.getManualOfflineStatus();

  constructor(private readonly offlineService: OfflineService) {}

  toggle(): void {
    this.offlineService.setManualOffline(!this.offlineService.isManualOffline());
  }
}
