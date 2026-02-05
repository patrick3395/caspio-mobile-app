import { Component, OnInit, OnDestroy, ElementRef, ViewChild, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { environment } from '../../../environments/environment';
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { Agentation } from 'agentation';

@Component({
  selector: 'app-agentation',
  standalone: true,
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `<div #agentationContainer *ngIf="isWeb"></div>`,
  styles: [`
    :host {
      display: contents;
    }
  `]
})
export class AgentationComponent implements OnInit, OnDestroy {
  @ViewChild('agentationContainer', { static: false }) containerRef!: ElementRef<HTMLDivElement>;

  isWeb = environment.isWeb;
  private root: ReactDOM.Root | null = null;

  ngOnInit(): void {
    if (!this.isWeb) {
      return;
    }

    // Use setTimeout to ensure the view is initialized
    setTimeout(() => this.renderReactComponent(), 0);
  }

  private renderReactComponent(): void {
    if (!this.containerRef?.nativeElement) {
      return;
    }

    try {
      this.root = ReactDOM.createRoot(this.containerRef.nativeElement);
      this.root.render(React.createElement(Agentation));
    } catch (err) {
      console.warn('[Agentation] Failed to initialize:', err);
    }
  }

  ngOnDestroy(): void {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
}
