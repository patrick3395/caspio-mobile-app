import { Component, Input, ContentChild, TemplateRef, ChangeDetectionStrategy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { environment } from '../../../environments/environment';

/**
 * Virtual Scroll Component - Web-only virtual scrolling for long lists (100+ items)
 *
 * Uses Angular CDK virtual scrolling on web for smooth scrolling and constant memory usage.
 * Falls back to normal rendering on mobile (native platforms handle this natively).
 *
 * Usage:
 * ```html
 * <app-virtual-scroll
 *   [items]="projectsList"
 *   [itemSize]="100"
 *   [minBuffer]="400"
 *   [maxBuffer]="800"
 *   [trackByFn]="trackByProjectId">
 *   <ng-template let-item let-index="index">
 *     <!-- Your item template here -->
 *     <div class="project-item">{{ item.name }}</div>
 *   </ng-template>
 * </app-virtual-scroll>
 * ```
 *
 * Performance characteristics:
 * - Lists with 100+ items scroll smoothly
 * - Memory usage stays constant regardless of list size
 * - Search/filter works with virtual scrolling
 */
@Component({
  selector: 'app-virtual-scroll',
  standalone: true,
  imports: [CommonModule, ScrollingModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- WEBAPP: Use CDK virtual scrolling for optimal performance with large lists -->
    @if (isWeb && items.length >= virtualScrollThreshold) {
      <cdk-virtual-scroll-viewport
        [itemSize]="itemSize"
        [minBufferPx]="minBuffer"
        [maxBufferPx]="maxBuffer"
        class="virtual-scroll-viewport">
        <ng-container *cdkVirtualFor="let item of items; trackBy: trackByFn; let i = index">
          <ng-container *ngTemplateOutlet="itemTemplate; context: { $implicit: item, index: i }"></ng-container>
        </ng-container>
      </cdk-virtual-scroll-viewport>
    } @else {
      <!-- Mobile or small lists: Use standard ngFor (native platforms handle scrolling efficiently) -->
      <div class="standard-scroll-container">
        <ng-container *ngFor="let item of items; trackBy: trackByFn; let i = index">
          <ng-container *ngTemplateOutlet="itemTemplate; context: { $implicit: item, index: i }"></ng-container>
        </ng-container>
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }

    .virtual-scroll-viewport {
      height: 100%;
      width: 100%;
    }

    .standard-scroll-container {
      height: 100%;
      width: 100%;
    }
  `]
})
export class VirtualScrollComponent<T> implements OnChanges {
  /** The items to display in the virtual scroll */
  @Input() items: T[] = [];

  /** Height of each item in pixels (for virtual scroll calculation) */
  @Input() itemSize = 100;

  /** Minimum buffer in pixels to render beyond the viewport */
  @Input() minBuffer = 400;

  /** Maximum buffer in pixels to render beyond the viewport */
  @Input() maxBuffer = 800;

  /** Minimum number of items to enable virtual scrolling (default: 100) */
  @Input() virtualScrollThreshold = 100;

  /** TrackBy function for better performance */
  @Input() trackByFn: (index: number, item: T) => any = (index: number) => index;

  /** Template for rendering each item */
  @ContentChild(TemplateRef) itemTemplate!: TemplateRef<any>;

  /** Whether we're running on web platform */
  readonly isWeb = environment.isWeb;

  ngOnChanges(changes: SimpleChanges): void {
    // Log when virtual scrolling is activated for debugging
    if (changes['items'] && this.isWeb && this.items.length >= this.virtualScrollThreshold) {
    }
  }
}
