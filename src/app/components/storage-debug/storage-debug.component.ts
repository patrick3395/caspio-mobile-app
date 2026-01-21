import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController } from '@ionic/angular';
import { BackgroundSyncService } from '../../services/background-sync.service';
import { ServiceMetadataService } from '../../services/service-metadata.service';
import { EngineersFoundationDataService } from '../../pages/engineers-foundation/engineers-foundation-data.service';
import { db } from '../../services/caspio-db';

interface StorageSnapshot {
  timestamp: number;
  localImages: number;
  localBlobs: number;
  totalBlobBytes: number;
  cachedPhotos: number;
  services: ServiceSnapshot[];
}

interface ServiceSnapshot {
  serviceId: string;
  purgeState: string;
  imageCount: number;
  blobBytes: number;
  lastTouchedAt: number;
  isPurgeSafe: boolean;
}

@Component({
  selector: 'app-storage-debug',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <ion-card>
      <ion-card-header>
        <ion-card-title>Storage Debug Panel</ion-card-title>
        <ion-card-subtitle>Test purge workflow</ion-card-subtitle>
      </ion-card-header>

      <ion-card-content>
        <!-- Current Storage Stats -->
        <div class="stats-section">
          <h3>Current Storage</h3>
          <ion-list *ngIf="currentSnapshot">
            <ion-item>
              <ion-label>Local Images</ion-label>
              <ion-badge slot="end">{{ currentSnapshot.localImages }}</ion-badge>
            </ion-item>
            <ion-item>
              <ion-label>Local Blobs</ion-label>
              <ion-badge slot="end">{{ currentSnapshot.localBlobs }}</ion-badge>
            </ion-item>
            <ion-item>
              <ion-label>Total Blob Size</ion-label>
              <ion-badge slot="end" color="primary">{{ formatBytes(currentSnapshot.totalBlobBytes) }}</ion-badge>
            </ion-item>
            <ion-item>
              <ion-label>Cached Photos</ion-label>
              <ion-badge slot="end">{{ currentSnapshot.cachedPhotos }}</ion-badge>
            </ion-item>
          </ion-list>
        </div>

        <!-- Services List -->
        <div class="services-section" *ngIf="currentSnapshot?.services?.length">
          <h3>Services ({{ currentSnapshot!.services!.length }})</h3>
          <ion-list>
            <ion-item *ngFor="let svc of currentSnapshot!.services!" [class.purged]="svc.purgeState === 'PURGED'">
              <ion-label>
                <h2>{{ svc.serviceId | slice:0:8 }}...</h2>
                <p>{{ svc.imageCount }} images | {{ formatBytes(svc.blobBytes) }}</p>
                <p>State: <strong>{{ svc.purgeState }}</strong> | Safe: {{ svc.isPurgeSafe ? 'Yes' : 'No' }}</p>
                <p class="timestamp">Last touched: {{ formatTime(svc.lastTouchedAt) }}</p>
              </ion-label>
              <ion-button slot="end" size="small" (click)="makeServiceOld(svc.serviceId)">
                Age 4d
              </ion-button>
            </ion-item>
          </ion-list>
        </div>

        <!-- Before/After Comparison -->
        <div class="comparison-section" *ngIf="beforeSnapshot && afterSnapshot">
          <h3>Before/After Comparison</h3>
          <ion-grid>
            <ion-row>
              <ion-col><strong>Metric</strong></ion-col>
              <ion-col><strong>Before</strong></ion-col>
              <ion-col><strong>After</strong></ion-col>
              <ion-col><strong>Diff</strong></ion-col>
            </ion-row>
            <ion-row>
              <ion-col>Images</ion-col>
              <ion-col>{{ beforeSnapshot.localImages }}</ion-col>
              <ion-col>{{ afterSnapshot.localImages }}</ion-col>
              <ion-col [class.positive]="afterSnapshot.localImages < beforeSnapshot.localImages">
                {{ afterSnapshot.localImages - beforeSnapshot.localImages }}
              </ion-col>
            </ion-row>
            <ion-row>
              <ion-col>Blobs</ion-col>
              <ion-col>{{ beforeSnapshot.localBlobs }}</ion-col>
              <ion-col>{{ afterSnapshot.localBlobs }}</ion-col>
              <ion-col [class.positive]="afterSnapshot.localBlobs < beforeSnapshot.localBlobs">
                {{ afterSnapshot.localBlobs - beforeSnapshot.localBlobs }}
              </ion-col>
            </ion-row>
            <ion-row>
              <ion-col>Size</ion-col>
              <ion-col>{{ formatBytes(beforeSnapshot.totalBlobBytes) }}</ion-col>
              <ion-col>{{ formatBytes(afterSnapshot.totalBlobBytes) }}</ion-col>
              <ion-col [class.positive]="afterSnapshot.totalBlobBytes < beforeSnapshot.totalBlobBytes">
                {{ formatBytes(afterSnapshot.totalBlobBytes - beforeSnapshot.totalBlobBytes) }}
              </ion-col>
            </ion-row>
          </ion-grid>
        </div>

        <!-- Test Log -->
        <div class="log-section" *ngIf="testLog.length">
          <h3>Test Log</h3>
          <div class="log-container">
            <p *ngFor="let entry of testLog" [class]="entry.type">
              {{ entry.time }} - {{ entry.message }}
            </p>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="actions">
          <ion-button expand="block" (click)="refreshSnapshot()" [disabled]="isRunning">
            <ion-icon name="refresh" slot="start"></ion-icon>
            Refresh Stats
          </ion-button>

          <ion-button expand="block" color="warning" (click)="runFullPurgeTest()" [disabled]="isRunning">
            <ion-icon name="flash" slot="start"></ion-icon>
            {{ isRunning ? 'Running...' : 'Run Full Purge Test' }}
          </ion-button>

          <ion-button expand="block" color="tertiary" (click)="testRehydration()" [disabled]="isRunning || !hasPurgedService">
            <ion-icon name="cloud-download" slot="start"></ion-icon>
            Test Rehydration
          </ion-button>

          <ion-button expand="block" color="danger" (click)="clearTestLog()">
            <ion-icon name="trash" slot="start"></ion-icon>
            Clear Log
          </ion-button>
        </div>
      </ion-card-content>
    </ion-card>
  `,
  styles: [`
    ion-card {
      margin: 8px;
    }

    .stats-section, .services-section, .comparison-section, .log-section {
      margin-bottom: 16px;
    }

    h3 {
      font-size: 14px;
      font-weight: bold;
      margin: 12px 0 8px 0;
      color: var(--ion-color-medium);
    }

    .services-section ion-item.purged {
      --background: rgba(var(--ion-color-warning-rgb), 0.1);
    }

    .timestamp {
      font-size: 11px;
      color: var(--ion-color-medium);
    }

    .comparison-section ion-grid {
      font-size: 12px;
    }

    .comparison-section ion-row {
      border-bottom: 1px solid var(--ion-color-light);
    }

    .positive {
      color: var(--ion-color-success);
      font-weight: bold;
    }

    .log-container {
      max-height: 200px;
      overflow-y: auto;
      background: var(--ion-color-light);
      padding: 8px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 11px;
    }

    .log-container p {
      margin: 2px 0;
    }

    .log-container p.info { color: var(--ion-color-primary); }
    .log-container p.success { color: var(--ion-color-success); }
    .log-container p.warning { color: var(--ion-color-warning); }
    .log-container p.error { color: var(--ion-color-danger); }

    .actions {
      margin-top: 16px;
    }

    .actions ion-button {
      margin-bottom: 8px;
    }
  `]
})
export class StorageDebugComponent implements OnInit {
  currentSnapshot: StorageSnapshot | null = null;
  beforeSnapshot: StorageSnapshot | null = null;
  afterSnapshot: StorageSnapshot | null = null;
  testLog: { time: string; message: string; type: string }[] = [];
  isRunning = false;

  get hasPurgedService(): boolean {
    return this.currentSnapshot?.services?.some(s => s.purgeState === 'PURGED') ?? false;
  }

  constructor(
    private backgroundSync: BackgroundSyncService,
    private serviceMetadata: ServiceMetadataService,
    private dataService: EngineersFoundationDataService,
    private alertCtrl: AlertController
  ) {}

  ngOnInit() {
    this.refreshSnapshot();
  }

  async refreshSnapshot() {
    this.log('Capturing storage snapshot...', 'info');
    this.currentSnapshot = await this.captureSnapshot();
    this.log(`Snapshot complete: ${this.currentSnapshot.localImages} images, ${this.formatBytes(this.currentSnapshot.totalBlobBytes)}`, 'success');
  }

  async captureSnapshot(): Promise<StorageSnapshot> {
    const localImages = await db.localImages.count();
    const localBlobs = await db.localBlobs.toArray();
    const cachedPhotos = await db.cachedPhotos.count();

    let totalBlobBytes = 0;
    for (const blob of localBlobs) {
      totalBlobBytes += blob.sizeBytes || 0;
    }

    // Get all services
    const allMetadata = await this.serviceMetadata.getAllServices();
    const services: ServiceSnapshot[] = [];

    for (const meta of allMetadata) {
      const images = await db.localImages.where('serviceId').equals(meta.serviceId).toArray();
      let blobBytes = 0;
      for (const img of images) {
        if (img.localBlobId) {
          const blob = await db.localBlobs.get(img.localBlobId);
          if (blob) blobBytes += blob.sizeBytes || 0;
        }
      }

      const { safe } = await this.serviceMetadata.isPurgeSafe(meta.serviceId);

      services.push({
        serviceId: meta.serviceId,
        purgeState: meta.purgeState,
        imageCount: images.length,
        blobBytes,
        lastTouchedAt: meta.lastTouchedAt,
        isPurgeSafe: safe
      });
    }

    return {
      timestamp: Date.now(),
      localImages,
      localBlobs: localBlobs.length,
      totalBlobBytes,
      cachedPhotos,
      services
    };
  }

  async makeServiceOld(serviceId: string) {
    const fourDaysAgo = Date.now() - (4 * 24 * 60 * 60 * 1000);
    await db.serviceMetadata.update(serviceId, { lastTouchedAt: fourDaysAgo });
    this.log(`Set ${serviceId.slice(0, 8)}... lastTouchedAt to 4 days ago`, 'warning');
    await this.refreshSnapshot();
  }

  async runFullPurgeTest() {
    const alert = await this.alertCtrl.create({
      header: 'Run Full Purge Test?',
      message: 'This will:\n1. Capture before snapshot\n2. Run soft purge on verified images\n3. Run hard purge on old services\n4. Capture after snapshot\n\nMake sure you have aged at least one service first!',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Run Test', handler: () => this.executeFullPurgeTest() }
      ]
    });
    await alert.present();
  }

  async executeFullPurgeTest() {
    this.isRunning = true;
    this.testLog = [];
    this.beforeSnapshot = null;
    this.afterSnapshot = null;

    try {
      // Step 1: Capture before
      this.log('=== STARTING PURGE TEST ===', 'info');
      this.log('Step 1: Capturing BEFORE snapshot...', 'info');
      this.beforeSnapshot = await this.captureSnapshot();
      this.log(`BEFORE: ${this.beforeSnapshot.localImages} images, ${this.formatBytes(this.beforeSnapshot.totalBlobBytes)}`, 'info');

      // Step 2: Run soft purge
      this.log('Step 2: Running soft purge on verified images...', 'info');
      const softPurgeResult = await (this.backgroundSync as any).softPurgeAllVerified();
      this.log(`Soft purge complete: ${softPurgeResult?.purged || 0} images processed`, 'success');

      // Step 3: Run hard purge (with 5-minute threshold for testing)
      this.log('Step 3: Running hard purge on inactive services...', 'info');

      // Use a very short threshold for testing (services aged with "Age 4d" button will be caught)
      const PURGE_AFTER_MS = 3 * 24 * 60 * 60 * 1000; // Still 3 days - user should age services first
      const cutoff = Date.now() - PURGE_AFTER_MS;
      const inactiveServices = await this.serviceMetadata.getInactiveServices(cutoff);
      this.log(`Found ${inactiveServices.length} inactive services`, 'info');

      for (const service of inactiveServices) {
        const { safe, reasons } = await this.serviceMetadata.isPurgeSafe(service.serviceId);
        if (safe) {
          this.log(`Hard purging service: ${service.serviceId.slice(0, 8)}...`, 'warning');
          await (this.backgroundSync as any).purgeServiceData(service.serviceId);
          await this.serviceMetadata.setPurgeState(service.serviceId, 'PURGED');
          this.log(`Service purged successfully`, 'success');
        } else {
          this.log(`Skipping unsafe service: ${reasons.join(', ')}`, 'warning');
        }
      }

      // Step 4: Capture after
      this.log('Step 4: Capturing AFTER snapshot...', 'info');
      this.afterSnapshot = await this.captureSnapshot();
      this.log(`AFTER: ${this.afterSnapshot.localImages} images, ${this.formatBytes(this.afterSnapshot.totalBlobBytes)}`, 'info');

      // Summary
      const freedBytes = this.beforeSnapshot.totalBlobBytes - this.afterSnapshot.totalBlobBytes;
      const freedImages = this.beforeSnapshot.localImages - this.afterSnapshot.localImages;
      this.log('=== TEST COMPLETE ===', 'success');
      this.log(`Freed: ${this.formatBytes(freedBytes)} | Removed: ${freedImages} images`, 'success');

      this.currentSnapshot = this.afterSnapshot;

    } catch (err) {
      this.log(`ERROR: ${err}`, 'error');
      console.error('Purge test failed:', err);
    } finally {
      this.isRunning = false;
    }
  }

  async testRehydration() {
    const purgedService = this.currentSnapshot?.services?.find(s => s.purgeState === 'PURGED');
    if (!purgedService) {
      this.log('No purged service found to rehydrate', 'warning');
      return;
    }

    const alert = await this.alertCtrl.create({
      header: 'Test Rehydration?',
      message: `Rehydrate service ${purgedService.serviceId.slice(0, 8)}...?\n\nThis will fetch data from the server.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Rehydrate', handler: () => this.executeRehydration(purgedService.serviceId) }
      ]
    });
    await alert.present();
  }

  async executeRehydration(serviceId: string) {
    this.isRunning = true;
    this.log(`=== STARTING REHYDRATION ===`, 'info');
    this.log(`Service: ${serviceId.slice(0, 8)}...`, 'info');

    try {
      const result = await this.dataService.rehydrateService(serviceId);

      if (result.success) {
        this.log(`Rehydration SUCCESS`, 'success');
        this.log(`Restored: ${result.restored.visuals} visuals, ${result.restored.efeRooms} EFE rooms`, 'success');
        this.log(`Attachments: ${result.restored.visualAttachments} visual, ${result.restored.efeAttachments} EFE`, 'success');
      } else {
        this.log(`Rehydration FAILED: ${result.error}`, 'error');
      }

      await this.refreshSnapshot();

    } catch (err) {
      this.log(`ERROR: ${err}`, 'error');
    } finally {
      this.isRunning = false;
    }
  }

  clearTestLog() {
    this.testLog = [];
    this.beforeSnapshot = null;
    this.afterSnapshot = null;
  }

  log(message: string, type: 'info' | 'success' | 'warning' | 'error') {
    const time = new Date().toLocaleTimeString();
    this.testLog.push({ time, message, type });
    console.log(`[StorageDebug] ${message}`);
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    const value = bytes / Math.pow(k, i);
    return `${value.toFixed(1)} ${sizes[i]}`;
  }

  formatTime(timestamp: number): string {
    if (!timestamp) return 'Never';
    const diff = Date.now() - timestamp;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return 'Just now';
  }
}
