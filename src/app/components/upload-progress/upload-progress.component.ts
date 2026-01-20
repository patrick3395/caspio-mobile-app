import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { FastImageUploadService, UploadProgress } from '../../services/fast-image-upload.service';
import { BackgroundPhotoUploadService, UploadQueueStatus } from '../../services/background-photo-upload.service';
import { environment } from '../../../environments/environment';

/**
 * Upload Progress Component (Web Only)
 *
 * Displays a floating progress indicator for file uploads.
 * Shows progress bar and percentage for each active upload.
 *
 * G2-LOADING-003: Add progress indicators for long operations
 */
@Component({
  selector: 'app-upload-progress',
  templateUrl: './upload-progress.component.html',
  styleUrls: ['./upload-progress.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UploadProgressComponent implements OnInit, OnDestroy {
  isWeb = environment.isWeb;
  activeUploads: UploadProgress[] = [];
  queueStatus: UploadQueueStatus | null = null;

  private fastUploadSubscription?: Subscription;
  private backgroundUploadSubscription?: Subscription;

  constructor(
    private fastImageUpload: FastImageUploadService,
    private backgroundUpload: BackgroundPhotoUploadService,
    private changeDetectorRef: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

  ngOnInit() {
    // Only initialize on web
    if (!this.isWeb) return;

    // Subscribe to fast image upload progress
    this.fastUploadSubscription = this.fastImageUpload.uploadProgress.subscribe(
      progress => {
        this.ngZone.run(() => {
          this.updateUploadProgress(progress);
          this.changeDetectorRef.markForCheck();
        });
      }
    );

    // Subscribe to background upload queue status
    this.backgroundUploadSubscription = this.backgroundUpload.getQueueStatus().subscribe(
      status => {
        this.ngZone.run(() => {
          this.queueStatus = status.totalTasks > 0 ? status : null;
          this.changeDetectorRef.markForCheck();
        });
      }
    );
  }

  ngOnDestroy() {
    this.fastUploadSubscription?.unsubscribe();
    this.backgroundUploadSubscription?.unsubscribe();
  }

  private updateUploadProgress(progress: UploadProgress) {
    const index = this.activeUploads.findIndex(u => u.uploadId === progress.uploadId);

    if (index >= 0) {
      if (progress.stage === 'complete' || progress.stage === 'error') {
        // Remove completed/error uploads after a delay
        setTimeout(() => {
          this.activeUploads = this.activeUploads.filter(u => u.uploadId !== progress.uploadId);
          this.changeDetectorRef.markForCheck();
        }, 2000);
      }
      this.activeUploads[index] = progress;
    } else if (progress.stage !== 'complete' && progress.stage !== 'error') {
      this.activeUploads.push(progress);
    }
  }

  getStageLabel(stage: string): string {
    switch (stage) {
      case 'compressing': return 'Compressing...';
      case 'uploading': return 'Uploading...';
      case 'complete': return 'Complete';
      case 'error': return 'Failed';
      default: return 'Processing...';
    }
  }

  getQueuePercentage(): number {
    if (!this.queueStatus || this.queueStatus.totalTasks === 0) return 0;
    return Math.round((this.queueStatus.completedTasks / this.queueStatus.totalTasks) * 100);
  }

  get hasActiveUploads(): boolean {
    return this.activeUploads.length > 0 || (this.queueStatus?.totalTasks ?? 0) > 0;
  }

  trackByUploadId(index: number, upload: UploadProgress): string {
    return upload.uploadId;
  }
}
