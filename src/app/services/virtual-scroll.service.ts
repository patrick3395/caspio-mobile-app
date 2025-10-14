/**
 * Virtual Scrolling Service for Large Lists
 * Provides smooth scrolling performance for large datasets
 */

import { Injectable, ElementRef } from '@angular/core';

export interface VirtualScrollItem {
  id: string | number;
  height: number;
  data: any;
}

export interface VirtualScrollConfig {
  itemHeight: number;
  containerHeight: number;
  bufferSize: number;
  threshold: number;
}

@Injectable({
  providedIn: 'root'
})
export class VirtualScrollService {
  private observers = new Map<string, IntersectionObserver>();
  private scrollContainers = new Map<string, ElementRef>();

  /**
   * Initialize virtual scrolling for a container
   */
  initializeVirtualScroll(
    containerId: string,
    container: ElementRef,
    config: VirtualScrollConfig
  ): VirtualScrollState {
    this.scrollContainers.set(containerId, container);
    
    const state: VirtualScrollState = {
      containerId,
      config,
      items: [],
      visibleItems: [],
      scrollTop: 0,
      startIndex: 0,
      endIndex: 0,
      totalHeight: 0,
      isInitialized: false
    };

    this.setupScrollListener(containerId, state);
    return state;
  }

  /**
   * Update items in virtual scroll
   */
  updateItems(state: VirtualScrollState, items: VirtualScrollItem[]): void {
    state.items = items;
    state.totalHeight = items.reduce((sum, item) => sum + item.height, 0);
    this.calculateVisibleItems(state);
  }

  /**
   * Handle scroll event
   */
  onScroll(state: VirtualScrollState, scrollTop: number): void {
    state.scrollTop = scrollTop;
    this.calculateVisibleItems(state);
  }

  /**
   * Calculate which items should be visible
   */
  private calculateVisibleItems(state: VirtualScrollState): void {
    const { config, items, scrollTop } = state;
    const { itemHeight, containerHeight, bufferSize } = config;

    // Calculate visible range
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - bufferSize);
    const endIndex = Math.min(
      items.length - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + bufferSize
    );

    state.startIndex = startIndex;
    state.endIndex = endIndex;

    // Get visible items
    state.visibleItems = items.slice(startIndex, endIndex + 1).map((item, index) => ({
      ...item,
      virtualIndex: startIndex + index,
      offsetTop: (startIndex + index) * itemHeight
    }));

    state.isInitialized = true;
  }

  /**
   * Setup scroll listener
   */
  private setupScrollListener(containerId: string, state: VirtualScrollState): void {
    const container = this.scrollContainers.get(containerId);
    if (!container) return;

    const element = container.nativeElement;
    
    element.addEventListener('scroll', (event: Event) => {
      const target = event.target as HTMLElement;
      this.onScroll(state, target.scrollTop);
    }, { passive: true });
  }

  /**
   * Get scroll position for a specific item
   */
  scrollToItem(state: VirtualScrollState, itemId: string | number): void {
    const itemIndex = state.items.findIndex(item => item.id === itemId);
    if (itemIndex === -1) return;

    const container = this.scrollContainers.get(state.containerId);
    if (!container) return;

    const scrollTop = itemIndex * state.config.itemHeight;
    container.nativeElement.scrollTop = scrollTop;
  }

  /**
   * Cleanup virtual scroll
   */
  cleanup(containerId: string): void {
    const observer = this.observers.get(containerId);
    if (observer) {
      observer.disconnect();
      this.observers.delete(containerId);
    }
    
    this.scrollContainers.delete(containerId);
  }
}

export interface VirtualScrollState {
  containerId: string;
  config: VirtualScrollConfig;
  items: VirtualScrollItem[];
  visibleItems: VirtualScrollItem[];
  scrollTop: number;
  startIndex: number;
  endIndex: number;
  totalHeight: number;
  isInitialized: boolean;
}

/**
 * Virtual Scroll Directive
 * Easy-to-use directive for virtual scrolling
 */
import { Directive, Input, OnInit, OnDestroy, ElementRef, Renderer2 } from '@angular/core';

@Directive({
  selector: '[appVirtualScroll]'
})
export class VirtualScrollDirective implements OnInit, OnDestroy {
  @Input() items: VirtualScrollItem[] = [];
  @Input() itemHeight: number = 50;
  @Input() bufferSize: number = 5;
  
  private state: VirtualScrollState | null = null;
  private container: HTMLElement;

  constructor(
    private elementRef: ElementRef,
    private renderer: Renderer2,
    private virtualScrollService: VirtualScrollService
  ) {
    this.container = this.elementRef.nativeElement;
  }

  ngOnInit(): void {
    const config: VirtualScrollConfig = {
      itemHeight: this.itemHeight,
      containerHeight: this.container.clientHeight,
      bufferSize: this.bufferSize,
      threshold: 0.1
    };

    this.state = this.virtualScrollService.initializeVirtualScroll(
      `container-${Date.now()}`,
      this.elementRef,
      config
    );

    this.updateItems();
    this.setupContainer();
  }

  ngOnDestroy(): void {
    if (this.state) {
      this.virtualScrollService.cleanup(this.state.containerId);
    }
  }

  private updateItems(): void {
    if (this.state) {
      this.virtualScrollService.updateItems(this.state, this.items);
      this.renderItems();
    }
  }

  private setupContainer(): void {
    this.renderer.setStyle(this.container, 'overflow-y', 'auto');
    this.renderer.setStyle(this.container, 'position', 'relative');
  }

  private renderItems(): void {
    if (!this.state) return;

    // Clear existing content
    this.container.innerHTML = '';

    // Create spacer for items before visible range
    if (this.state.startIndex > 0) {
      const spacer = this.renderer.createElement('div');
      this.renderer.setStyle(spacer, 'height', `${this.state.startIndex * this.itemHeight}px`);
      this.renderer.appendChild(this.container, spacer);
    }

    // Render visible items
    this.state.visibleItems.forEach(item => {
      const itemElement = this.renderer.createElement('div');
      this.renderer.setStyle(itemElement, 'height', `${item.height}px`);
      this.renderer.setStyle(itemElement, 'position', 'absolute');
      this.renderer.setStyle(itemElement, 'top', `${item.offsetTop}px`);
      this.renderer.setStyle(itemElement, 'width', '100%');
      
      // Add item content
      this.renderer.setProperty(itemElement, 'innerHTML', this.getItemContent(item));
      this.renderer.appendChild(this.container, spacer);
    });

    // Create spacer for items after visible range
    const remainingItems = this.state.items.length - this.state.endIndex - 1;
    if (remainingItems > 0) {
      const spacer = this.renderer.createElement('div');
      this.renderer.setStyle(spacer, 'height', `${remainingItems * this.itemHeight}px`);
      this.renderer.appendChild(this.container, spacer);
    }
  }

  private getItemContent(item: VirtualScrollItem): string {
    // This should be customized based on your item structure
    return `<div class="virtual-item">${JSON.stringify(item.data)}</div>`;
  }
}
