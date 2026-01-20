/**
 * Lazy Image Directive
 * Uses IntersectionObserver to load images only when they enter the viewport.
 * Shows a placeholder until the image is loaded, preventing layout shift.
 *
 * Web-only: This directive only activates on web platform (environment.isWeb).
 * On mobile, images load normally without lazy loading.
 */

import {
  Directive,
  ElementRef,
  Input,
  OnInit,
  OnDestroy,
  Renderer2,
  NgZone
} from '@angular/core';
import { environment } from '../../environments/environment';

@Directive({
  selector: '[appLazyImage]',
  standalone: true
})
export class LazyImageDirective implements OnInit, OnDestroy {
  @Input('appLazyImage') lazySrc: string = '';
  @Input() lazyPlaceholder: string = 'assets/img/photo-placeholder.png';
  @Input() lazyWidth: string = '';
  @Input() lazyHeight: string = '';

  private observer: IntersectionObserver | null = null;
  private hasLoaded = false;

  constructor(
    private el: ElementRef<HTMLImageElement>,
    private renderer: Renderer2,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    // Only apply lazy loading on web platform
    if (!environment.isWeb) {
      // Mobile: Load image directly without lazy loading
      this.loadImageDirectly();
      return;
    }

    this.setupPlaceholder();
    this.setupIntersectionObserver();
  }

  ngOnDestroy(): void {
    this.disconnectObserver();
  }

  private setupPlaceholder(): void {
    const img = this.el.nativeElement;

    // Set placeholder as initial source
    this.renderer.setAttribute(img, 'src', this.lazyPlaceholder);

    // Add loading class for styling
    this.renderer.addClass(img, 'lazy-image');
    this.renderer.addClass(img, 'lazy-loading');

    // Set explicit dimensions to prevent layout shift
    if (this.lazyWidth) {
      this.renderer.setStyle(img, 'width', this.lazyWidth);
    }
    if (this.lazyHeight) {
      this.renderer.setStyle(img, 'height', this.lazyHeight);
    }
  }

  private setupIntersectionObserver(): void {
    // Check for IntersectionObserver support
    if (!('IntersectionObserver' in window)) {
      // Fallback for older browsers - load immediately
      this.loadImage();
      return;
    }

    this.ngZone.runOutsideAngular(() => {
      this.observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting && !this.hasLoaded) {
              this.ngZone.run(() => {
                this.loadImage();
              });
            }
          });
        },
        {
          root: null, // Use viewport as root
          rootMargin: '50px', // Start loading 50px before entering viewport
          threshold: 0.01 // Trigger when even 1% is visible
        }
      );

      this.observer.observe(this.el.nativeElement);
    });
  }

  private loadImage(): void {
    if (this.hasLoaded) {
      return;
    }

    this.hasLoaded = true;
    this.disconnectObserver();

    const img = this.el.nativeElement;
    const srcToLoad = this.lazySrc || img.getAttribute('data-src') || '';

    if (!srcToLoad) {
      return;
    }

    // Create a test image to preload
    const testImage = new Image();

    testImage.onload = () => {
      // Image loaded successfully - update src
      this.renderer.setAttribute(img, 'src', srcToLoad);
      this.renderer.removeClass(img, 'lazy-loading');
      this.renderer.addClass(img, 'lazy-loaded');
    };

    testImage.onerror = () => {
      // Image failed to load - keep placeholder or show error state
      this.renderer.removeClass(img, 'lazy-loading');
      this.renderer.addClass(img, 'lazy-error');
      console.warn(`[LazyImage] Failed to load image: ${srcToLoad}`);
    };

    testImage.src = srcToLoad;
  }

  private loadImageDirectly(): void {
    // For mobile: just set the src directly
    const img = this.el.nativeElement;
    const srcToLoad = this.lazySrc || img.getAttribute('data-src') || '';

    if (srcToLoad) {
      this.renderer.setAttribute(img, 'src', srcToLoad);
    }
  }

  private disconnectObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}
