/**
 * Progressive Image Loading Component
 * Provides smooth image loading with placeholders and blur effects
 */

import { Component, Input, OnInit, OnDestroy, ElementRef, ViewChild, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThumbnailService } from '../services/thumbnail.service';

export interface ProgressiveImageData {
  src: string;
  thumbnail?: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
}

@Component({
  selector: 'app-progressive-image',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="progressive-image-container" [style.width.px]="width" [style.height.px]="height">
      <!-- Placeholder/Skeleton -->
      <div 
        *ngIf="!imageLoaded && !imageError" 
        class="image-placeholder"
        [class.loading]="isLoading"
      >
        <div class="placeholder-content">
          <ion-icon name="image-outline" class="placeholder-icon"></ion-icon>
          <div class="placeholder-text">Loading...</div>
        </div>
      </div>

      <!-- Thumbnail (blurred) -->
      <img 
        *ngIf="thumbnailUrl && !imageLoaded && !imageError"
        [src]="thumbnailUrl"
        [alt]="alt"
        class="image-thumbnail"
        [class.loaded]="thumbnailLoaded"
        (load)="onThumbnailLoad()"
        (error)="onThumbnailError()"
      />

      <!-- Full Image -->
      <img 
        *ngIf="imageLoaded"
        [src]="src"
        [alt]="alt"
        [title]="title"
        class="image-full"
        [class.loaded]="imageLoaded"
        (load)="onImageLoad()"
        (error)="onImageError()"
      />

      <!-- Error State -->
      <div 
        *ngIf="imageError" 
        class="image-error"
      >
        <div class="error-content">
          <ion-icon name="alert-circle-outline" class="error-icon"></ion-icon>
          <div class="error-text">Failed to load image</div>
          <ion-button 
            size="small" 
            fill="clear" 
            (click)="retryLoad()"
            class="retry-button"
          >
            Retry
          </ion-button>
        </div>
      </div>

      <!-- Loading Progress -->
      <div 
        *ngIf="isLoading && showProgress" 
        class="loading-progress"
      >
        <div class="progress-bar" [style.width.%]="loadingProgress"></div>
      </div>
    </div>
  `,
  styles: [`
    .progressive-image-container {
      position: relative;
      overflow: hidden;
      background-color: #f5f5f5;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .image-placeholder {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }

    .image-placeholder.loading {
      animation: shimmer 1.5s infinite;
    }

    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }

    .placeholder-content {
      text-align: center;
      color: #999;
    }

    .placeholder-icon {
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }

    .placeholder-text {
      font-size: 0.875rem;
    }

    .image-thumbnail {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      filter: blur(10px);
      transform: scale(1.1);
      opacity: 0;
      transition: opacity 0.3s ease-in-out;
    }

    .image-thumbnail.loaded {
      opacity: 1;
    }

    .image-full {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0;
      transition: opacity 0.5s ease-in-out;
    }

    .image-full.loaded {
      opacity: 1;
    }

    .image-error {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: #f8f9fa;
      border: 2px dashed #dee2e6;
    }

    .error-content {
      text-align: center;
      color: #6c757d;
    }

    .error-icon {
      font-size: 2rem;
      margin-bottom: 0.5rem;
      color: #dc3545;
    }

    .error-text {
      font-size: 0.875rem;
      margin-bottom: 1rem;
    }

    .retry-button {
      --color: #007bff;
      font-size: 0.75rem;
    }

    .loading-progress {
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 3px;
      background-color: rgba(0, 0, 0, 0.1);
    }

    .progress-bar {
      height: 100%;
      background: linear-gradient(90deg, #007bff, #0056b3);
      transition: width 0.3s ease;
    }

    /* Dark theme support */
    .dark-theme .progressive-image-container {
      background-color: #2d2d2d;
    }

    .dark-theme .image-placeholder {
      background: linear-gradient(90deg, #3a3a3a 25%, #2d2d2d 50%, #3a3a3a 75%);
    }

    .dark-theme .placeholder-content {
      color: #ccc;
    }

    .dark-theme .image-error {
      background-color: #1a1a1a;
      border-color: #444;
    }

    .dark-theme .error-content {
      color: #ccc;
    }
  `]
})
export class ProgressiveImageComponent implements OnInit, OnDestroy {
  @Input() src: string = '';
  @Input() thumbnail?: string;
  @Input() alt: string = '';
  @Input() title: string = '';
  @Input() width?: number;
  @Input() height?: number;
  @Input() showProgress: boolean = true;
  @Input() autoGenerateThumbnail: boolean = true;

  imageLoaded: boolean = false;
  imageError: boolean = false;
  thumbnailLoaded: boolean = false;
  thumbnailError: boolean = false;
  isLoading: boolean = true;
  loadingProgress: number = 0;
  thumbnailUrl: string = '';

  private loadStartTime: number = 0;
  private progressInterval?: number;

  constructor(
    private thumbnailService: ThumbnailService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadStartTime = Date.now();
    this.startLoading();
  }

  ngOnDestroy(): void {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }
  }

  private async startLoading(): Promise<void> {
    try {
      // Generate thumbnail if not provided and auto-generate is enabled
      if (!this.thumbnail && this.autoGenerateThumbnail) {
        await this.generateThumbnail();
      } else if (this.thumbnail) {
        this.thumbnailUrl = this.thumbnail;
      }

      // Start progress simulation
      this.simulateProgress();

      // Load full image
      await this.loadFullImage();
    } catch (error) {
      console.error('Error loading progressive image:', error);
      this.onImageError();
    }
  }

  private async generateThumbnail(): Promise<void> {
    try {
      const result = await this.thumbnailService.generateThumbnail(this.src, {
        width: 200,
        height: 200,
        quality: 0.7
      });
      this.thumbnailUrl = result.thumbnail;
      this.cdr.detectChanges();
    } catch (error) {
      console.warn('Failed to generate thumbnail:', error);
    }
  }

  private async loadFullImage(): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.onImageLoad();
        resolve();
      };
      img.onerror = () => {
        this.onImageError();
        reject(new Error('Failed to load image'));
      };
      img.src = this.src;
    });
  }

  private simulateProgress(): void {
    this.progressInterval = window.setInterval(() => {
      const elapsed = Date.now() - this.loadStartTime;
      const progress = Math.min(90, (elapsed / 2000) * 100); // Max 90% until loaded
      this.loadingProgress = progress;
      this.cdr.detectChanges();
    }, 100);
  }

  onThumbnailLoad(): void {
    this.thumbnailLoaded = true;
    this.cdr.detectChanges();
  }

  onThumbnailError(): void {
    this.thumbnailError = true;
    this.cdr.detectChanges();
  }

  onImageLoad(): void {
    this.imageLoaded = true;
    this.imageError = false;
    this.isLoading = false;
    this.loadingProgress = 100;
    
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }
    
    this.cdr.detectChanges();
  }

  onImageError(): void {
    this.imageError = true;
    this.imageLoaded = false;
    this.isLoading = false;
    
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }
    
    this.cdr.detectChanges();
  }

  retryLoad(): void {
    this.imageError = false;
    this.imageLoaded = false;
    this.isLoading = true;
    this.loadingProgress = 0;
    this.loadStartTime = Date.now();
    
    this.startLoading();
  }
}
