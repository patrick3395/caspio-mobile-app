import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface HudPhotoUploadResult {
  imageId: string;
  hudId: number;
  attachId: number;
  s3Url: string;
}

/**
 * Stub service for HUD S3 photo uploads.
 * This is a placeholder for future HUD-specific photo upload functionality.
 */
@Injectable({
  providedIn: 'root'
})
export class HudS3UploadService {
  uploadComplete$ = new Subject<HudPhotoUploadResult>();

  constructor() {}
}
