/**
 * Lazy Loading Service for Heavy Components
 * Dynamically loads components only when needed
 */

import { Injectable, Type } from '@angular/core';
import { Observable, from, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface LazyComponentConfig {
  component: () => Promise<any>;
  fallback?: Type<any>;
  preload?: boolean;
  priority?: 'high' | 'medium' | 'low';
}

@Injectable({
  providedIn: 'root'
})
export class LazyLoadingService {
  private componentCache = new Map<string, any>();
  private loadingPromises = new Map<string, Promise<any>>();
  private preloadedComponents = new Set<string>();

  /**
   * Load a component lazily
   */
  loadComponent<T>(name: string, config: LazyComponentConfig): Observable<T> {
    // Check if already cached
    if (this.componentCache.has(name)) {
      console.log(`🚀 Component cache hit: ${name}`);
      return of(this.componentCache.get(name));
    }

    // Check if already loading
    if (this.loadingPromises.has(name)) {
      console.log(`🔄 Component already loading: ${name}`);
      return from(this.loadingPromises.get(name)!);
    }

    // Start loading
    console.log(`📦 Loading component: ${name}`);
    const loadPromise = this.loadComponentInternal(name, config);
    this.loadingPromises.set(name, loadPromise);

    return from(loadPromise).pipe(
      map(component => {
        this.componentCache.set(name, component);
        this.loadingPromises.delete(name);
        return component;
      }),
      catchError(error => {
        console.error(`❌ Failed to load component ${name}:`, error);
        this.loadingPromises.delete(name);
        
        if (config.fallback) {
          console.log(`🔄 Using fallback component for ${name}`);
          return of(config.fallback);
        }
        
        throw error;
      })
    );
  }

  /**
   * Preload components for better performance
   */
  async preloadComponents(components: { [name: string]: LazyComponentConfig }): Promise<void> {
    const preloadPromises = Object.entries(components)
      .filter(([name, config]) => config.preload !== false)
      .map(([name, config]) => this.preloadComponent(name, config));

    await Promise.all(preloadPromises);
    console.log('✅ Component preloading complete');
  }

  /**
   * Preload a single component
   */
  private async preloadComponent(name: string, config: LazyComponentConfig): Promise<void> {
    if (this.preloadedComponents.has(name) || this.componentCache.has(name)) {
      return;
    }

    try {
      console.log(`🔄 Preloading component: ${name}`);
      const component = await this.loadComponentInternal(name, config);
      this.componentCache.set(name, component);
      this.preloadedComponents.add(name);
    } catch (error) {
      console.warn(`⚠️ Failed to preload component ${name}:`, error);
    }
  }

  /**
   * Internal component loading logic
   */
  private async loadComponentInternal(name: string, config: LazyComponentConfig): Promise<any> {
    const startTime = performance.now();
    
    try {
      const module = await config.component();
      const component = module.default || module[Object.keys(module)[0]];
      
      const loadTime = performance.now() - startTime;
      console.log(`✅ Component ${name} loaded in ${loadTime.toFixed(2)}ms`);
      
      return component;
    } catch (error) {
      const loadTime = performance.now() - startTime;
      console.error(`❌ Component ${name} failed to load after ${loadTime.toFixed(2)}ms:`, error);
      throw error;
    }
  }

  /**
   * Get cached component
   */
  getCachedComponent<T>(name: string): T | null {
    return this.componentCache.get(name) || null;
  }

  /**
   * Check if component is cached
   */
  isComponentCached(name: string): boolean {
    return this.componentCache.has(name);
  }

  /**
   * Check if component is loading
   */
  isComponentLoading(name: string): boolean {
    return this.loadingPromises.has(name);
  }

  /**
   * Clear component cache
   */
  clearCache(): void {
    this.componentCache.clear();
    this.loadingPromises.clear();
    this.preloadedComponents.clear();
    console.log('🧹 Component cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { cached: number; loading: number; preloaded: number } {
    return {
      cached: this.componentCache.size,
      loading: this.loadingPromises.size,
      preloaded: this.preloadedComponents.size
    };
  }
}

/**
 * Lazy Component Decorator
 * Easy-to-use decorator for lazy loading
 */
export function LazyComponent(config: LazyComponentConfig) {
  return function <T extends Type<any>>(target: T): T {
    // Store the lazy config on the component
    (target as any).__lazyConfig = config;
    return target;
  };
}

/**
 * Predefined lazy component configurations
 */
export const LAZY_COMPONENTS = {
  PDF_PREVIEW: {
    component: () => import('../components/pdf-preview/pdf-preview.component'),
    preload: true,
    priority: 'high' as const
  },
  DOCUMENT_VIEWER: {
    component: () => import('../components/document-viewer/document-viewer.component'),
    preload: true,
    priority: 'high' as const
  },
  PHOTO_ANNOTATOR: {
    component: () => import('../components/photo-annotator/photo-annotator.component'),
    preload: false,
    priority: 'medium' as const
  },
  FABRIC_PHOTO_ANNOTATOR: {
    component: () => import('../components/fabric-photo-annotator/fabric-photo-annotator.component'),
    preload: false,
    priority: 'medium' as const
  },
  PROGRESSIVE_IMAGE: {
    component: () => import('../components/progressive-image/progressive-image.component'),
    preload: true,
    priority: 'high' as const
  }
};

/**
 * Lazy Loading Directive
 * Automatically loads components when they come into view
 */
import { Directive, Input, OnInit, OnDestroy, ElementRef, Renderer2 } from '@angular/core';

@Directive({
  selector: '[appLazyComponent]'
})
export class LazyComponentDirective implements OnInit, OnDestroy {
  @Input() componentName: string = '';
  @Input() componentConfig: LazyComponentConfig | null = null;

  private observer?: IntersectionObserver;
  private loaded = false;

  constructor(
    private elementRef: ElementRef,
    private renderer: Renderer2,
    private lazyLoadingService: LazyLoadingService
  ) {}

  ngOnInit(): void {
    if (!this.componentName || !this.componentConfig) {
      console.warn('LazyComponentDirective: componentName and componentConfig are required');
      return;
    }

    this.setupIntersectionObserver();
  }

  ngOnDestroy(): void {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  private setupIntersectionObserver(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && !this.loaded) {
            this.loadComponent();
          }
        });
      },
      {
        rootMargin: '50px',
        threshold: 0.1
      }
    );

    this.observer.observe(this.elementRef.nativeElement);
  }

  private async loadComponent(): Promise<void> {
    if (this.loaded || !this.componentConfig) return;

    this.loaded = true;
    
    try {
      const component = await this.lazyLoadingService.loadComponent(
        this.componentName,
        this.componentConfig
      ).toPromise();

      // Render the component
      this.renderComponent(component);
    } catch (error) {
      console.error(`Failed to load lazy component ${this.componentName}:`, error);
    }
  }

  /**
   * Escape HTML characters to prevent XSS (web only)
   */
  private escapeHtml(text: string): string {
    if (!environment.isWeb) return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private renderComponent(component: any): void {
    // This would need to be customized based on your component structure
    const element = this.elementRef.nativeElement;
    // Escape componentName to prevent XSS (web only)
    const escapedName = this.escapeHtml(this.componentName);
    element.innerHTML = `<div>Component loaded: ${escapedName}</div>`;
  }
}
