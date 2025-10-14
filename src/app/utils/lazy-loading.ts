/**
 * Lazy Loading Utility for Images
 * Provides enhanced lazy loading with intersection observer and fallbacks
 */

export class LazyLoadingManager {
  private observer: IntersectionObserver | null = null;
  private loadedImages = new Set<string>();

  constructor() {
    this.init();
  }

  private init(): void {
    // Check if IntersectionObserver is supported
    if ('IntersectionObserver' in window) {
      this.initIntersectionObserver();
    } else {
      // Fallback for older browsers
      this.loadAllImages();
    }

    // Handle images that are already in the DOM
    this.processExistingImages();
  }

  private initIntersectionObserver(): void {
    const options = {
      root: null,
      rootMargin: '50px', // Start loading 50px before image comes into view
      threshold: 0.1
    };

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          this.loadImage(entry.target as HTMLImageElement);
          this.observer?.unobserve(entry.target);
        }
      });
    }, options);
  }

  private processExistingImages(): void {
    const images = document.querySelectorAll('img[loading="lazy"]');
    images.forEach(img => {
      if (this.observer) {
        this.observer.observe(img);
      } else {
        this.loadImage(img as HTMLImageElement);
      }
    });
  }

  private loadImage(img: HTMLImageElement): void {
    const src = img.dataset.src || img.src;
    
    if (!src || this.loadedImages.has(src)) {
      return;
    }

    this.loadedImages.add(src);

    // Create a new image to test if it loads successfully
    const testImg = new Image();
    
    testImg.onload = () => {
      img.src = src;
      img.classList.add('loaded');
      img.removeAttribute('data-src');
    };

    testImg.onerror = () => {
      console.warn(`Failed to load image: ${src}`);
      img.classList.add('error');
    };

    testImg.src = src;
  }

  private loadAllImages(): void {
    const images = document.querySelectorAll('img[loading="lazy"]');
    images.forEach(img => this.loadImage(img as HTMLImageElement));
  }

  public observeImage(img: HTMLImageElement): void {
    if (this.observer) {
      this.observer.observe(img);
    } else {
      this.loadImage(img);
    }
  }

  public disconnect(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
  }
}

// Global instance
export const lazyLoadingManager = new LazyLoadingManager();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    lazyLoadingManager.init();
  });
} else {
  lazyLoadingManager.init();
}
