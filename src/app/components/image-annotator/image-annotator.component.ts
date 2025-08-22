import { Component, Input, OnInit, ViewChild, ElementRef, Output, EventEmitter } from '@angular/core';
import { ModalController, AlertController } from '@ionic/angular';

// Annotation interfaces
interface Annotation {
  id: string;
  type: 'arrow' | 'rectangle' | 'circle' | 'text' | 'freehand';
  color: string;
  strokeWidth: number;
  selected?: boolean;
  // Type-specific properties
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  points?: { x: number; y: number }[];
  text?: string;
  fontSize?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  radius?: number;
}

interface AnnotationData {
  imageId: string;
  version: string;
  timestamp: number;
  annotations: Annotation[];
}

@Component({
  selector: 'app-image-annotator',
  templateUrl: './image-annotator.component.html',
  styleUrls: ['./image-annotator.component.scss'],
  standalone: false
})
export class ImageAnnotatorComponent implements OnInit {
  @ViewChild('imageCanvas', { static: false }) imageCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('annotationSvg', { static: false }) svgElement!: ElementRef<SVGElement>;
  @ViewChild('imageElement', { static: false }) imageElement!: ElementRef<HTMLImageElement>;
  
  @Input() imageUrl: string = '';
  @Input() attachId: string = '';
  @Input() existingAnnotations?: AnnotationData;
  @Output() onSave = new EventEmitter<AnnotationData>();
  
  // Tool states
  currentTool: 'select' | 'arrow' | 'rectangle' | 'circle' | 'text' | 'freehand' = 'select';
  currentColor: string = '#FF0000';
  strokeWidth: number = 3;
  fontSize: number = 20;
  
  // Annotations
  annotations: Annotation[] = [];
  selectedAnnotation: Annotation | null = null;
  
  // Drawing state
  isDrawing: boolean = false;
  startPoint: { x: number; y: number } | null = null;
  currentPath: { x: number; y: number }[] = [];
  
  // Image dimensions
  imageWidth: number = 0;
  imageHeight: number = 0;
  scale: number = 1;
  
  constructor(
    private modalController: ModalController,
    private alertController: AlertController
  ) {}
  
  ngOnInit() {
    // Load existing annotations if provided
    if (this.existingAnnotations) {
      this.annotations = [...this.existingAnnotations.annotations];
      console.log('Loaded existing annotations:', this.annotations.length);
    }
  }
  
  onImageLoad() {
    const img = this.imageElement.nativeElement;
    this.imageWidth = img.naturalWidth;
    this.imageHeight = img.naturalHeight;
    
    // Calculate scale for responsive display
    const container = img.parentElement;
    if (container) {
      const maxWidth = container.clientWidth;
      const maxHeight = container.clientHeight;
      const scaleX = maxWidth / this.imageWidth;
      const scaleY = maxHeight / this.imageHeight;
      this.scale = Math.min(scaleX, scaleY, 1);
    }
    
    this.renderAnnotations();
  }
  
  // Tool selection
  selectTool(tool: typeof this.currentTool) {
    this.currentTool = tool;
    this.clearSelection();
  }
  
  // Mouse/Touch events
  onPointerDown(event: MouseEvent | TouchEvent) {
    const point = this.getRelativePoint(event);
    
    if (this.currentTool === 'select') {
      this.handleSelection(point);
    } else if (this.currentTool === 'text') {
      this.addTextAnnotation(point);
    } else {
      this.startDrawing(point);
    }
  }
  
  onPointerMove(event: MouseEvent | TouchEvent) {
    if (!this.isDrawing) return;
    
    const point = this.getRelativePoint(event);
    
    if (this.currentTool === 'freehand') {
      this.currentPath.push(point);
      this.renderTempAnnotation();
    } else if (this.startPoint) {
      this.renderTempAnnotation(point);
    }
  }
  
  onPointerUp(event: MouseEvent | TouchEvent) {
    if (!this.isDrawing) return;
    
    const point = this.getRelativePoint(event);
    this.finishDrawing(point);
  }
  
  private getRelativePoint(event: MouseEvent | TouchEvent): { x: number; y: number } {
    const rect = this.svgElement.nativeElement.getBoundingClientRect();
    const clientX = event instanceof MouseEvent ? event.clientX : event.touches[0].clientX;
    const clientY = event instanceof MouseEvent ? event.clientY : event.touches[0].clientY;
    
    return {
      x: (clientX - rect.left) / this.scale,
      y: (clientY - rect.top) / this.scale
    };
  }
  
  private startDrawing(point: { x: number; y: number }) {
    this.isDrawing = true;
    this.startPoint = point;
    
    if (this.currentTool === 'freehand') {
      this.currentPath = [point];
    }
  }
  
  private finishDrawing(endPoint: { x: number; y: number }) {
    if (!this.startPoint) return;
    
    const annotation: Annotation = {
      id: `ann_${Date.now()}`,
      type: this.currentTool as any,
      color: this.currentColor,
      strokeWidth: this.strokeWidth,
      startX: this.startPoint.x,
      startY: this.startPoint.y,
      endX: endPoint.x,
      endY: endPoint.y
    };
    
    // Adjust for different shapes
    switch (this.currentTool) {
      case 'rectangle':
        annotation.x = Math.min(this.startPoint.x, endPoint.x);
        annotation.y = Math.min(this.startPoint.y, endPoint.y);
        annotation.width = Math.abs(endPoint.x - this.startPoint.x);
        annotation.height = Math.abs(endPoint.y - this.startPoint.y);
        break;
        
      case 'circle':
        const radius = Math.sqrt(
          Math.pow(endPoint.x - this.startPoint.x, 2) + 
          Math.pow(endPoint.y - this.startPoint.y, 2)
        );
        annotation.radius = radius;
        annotation.x = this.startPoint.x;
        annotation.y = this.startPoint.y;
        break;
        
      case 'freehand':
        annotation.points = [...this.currentPath];
        break;
    }
    
    this.annotations.push(annotation);
    this.renderAnnotations();
    
    // Reset drawing state
    this.isDrawing = false;
    this.startPoint = null;
    this.currentPath = [];
    this.clearTempAnnotation();
  }
  
  private async addTextAnnotation(point: { x: number; y: number }) {
    const alert = await this.alertController.create({
      header: 'Add Text',
      inputs: [{
        name: 'text',
        type: 'text',
        placeholder: 'Enter text'
      }],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Add',
          handler: (data) => {
            if (data.text) {
              const annotation: Annotation = {
                id: `ann_${Date.now()}`,
                type: 'text',
                color: this.currentColor,
                strokeWidth: this.strokeWidth,
                x: point.x,
                y: point.y,
                text: data.text,
                fontSize: this.fontSize
              };
              this.annotations.push(annotation);
              this.renderAnnotations();
            }
          }
        }
      ]
    });
    
    await alert.present();
  }
  
  private handleSelection(point: { x: number; y: number }) {
    // Find annotation at point
    this.selectedAnnotation = null;
    
    // Check annotations in reverse order (top to bottom)
    for (let i = this.annotations.length - 1; i >= 0; i--) {
      const ann = this.annotations[i];
      if (this.isPointInAnnotation(point, ann)) {
        this.selectedAnnotation = ann;
        ann.selected = true;
        break;
      } else {
        ann.selected = false;
      }
    }
    
    this.renderAnnotations();
  }
  
  private isPointInAnnotation(point: { x: number; y: number }, ann: Annotation): boolean {
    const tolerance = 10; // pixels
    
    switch (ann.type) {
      case 'rectangle':
        return point.x >= (ann.x! - tolerance) && 
               point.x <= (ann.x! + ann.width! + tolerance) &&
               point.y >= (ann.y! - tolerance) && 
               point.y <= (ann.y! + ann.height! + tolerance);
               
      case 'circle':
        const dist = Math.sqrt(
          Math.pow(point.x - ann.x!, 2) + 
          Math.pow(point.y - ann.y!, 2)
        );
        return dist <= (ann.radius! + tolerance);
        
      case 'arrow':
        // Simplified: check if near the line
        return this.isPointNearLine(point, 
          { x: ann.startX!, y: ann.startY! },
          { x: ann.endX!, y: ann.endY! },
          tolerance
        );
        
      case 'text':
        // Approximate text bounds
        const textWidth = (ann.text?.length || 0) * (ann.fontSize! * 0.6);
        const textHeight = ann.fontSize!;
        return point.x >= (ann.x! - tolerance) && 
               point.x <= (ann.x! + textWidth + tolerance) &&
               point.y >= (ann.y! - textHeight - tolerance) && 
               point.y <= (ann.y! + tolerance);
               
      default:
        return false;
    }
  }
  
  private isPointNearLine(point: { x: number; y: number }, 
                          start: { x: number; y: number }, 
                          end: { x: number; y: number }, 
                          tolerance: number): boolean {
    const A = point.x - start.x;
    const B = point.y - start.y;
    const C = end.x - start.x;
    const D = end.y - start.y;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    
    if (lenSq !== 0) param = dot / lenSq;
    
    let xx, yy;
    
    if (param < 0) {
      xx = start.x;
      yy = start.y;
    } else if (param > 1) {
      xx = end.x;
      yy = end.y;
    } else {
      xx = start.x + param * C;
      yy = start.y + param * D;
    }
    
    const dx = point.x - xx;
    const dy = point.y - yy;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    return distance <= tolerance;
  }
  
  deleteSelected() {
    if (this.selectedAnnotation) {
      const index = this.annotations.findIndex(a => a.id === this.selectedAnnotation!.id);
      if (index >= 0) {
        this.annotations.splice(index, 1);
        this.selectedAnnotation = null;
        this.renderAnnotations();
      }
    }
  }
  
  clearSelection() {
    this.annotations.forEach(a => a.selected = false);
    this.selectedAnnotation = null;
    this.renderAnnotations();
  }
  
  clearAll() {
    this.annotations = [];
    this.selectedAnnotation = null;
    this.renderAnnotations();
  }
  
  undo() {
    if (this.annotations.length > 0) {
      this.annotations.pop();
      this.renderAnnotations();
    }
  }
  
  // Rendering methods
  private renderAnnotations() {
    const svg = this.svgElement?.nativeElement;
    if (!svg) return;
    
    // Clear existing annotations
    while (svg.firstChild) {
      svg.removeChild(svg.firstChild);
    }
    
    // Render each annotation
    this.annotations.forEach(ann => {
      const element = this.createSvgElement(ann);
      if (element) {
        svg.appendChild(element);
      }
    });
  }
  
  private createSvgElement(ann: Annotation): SVGElement | null {
    const ns = 'http://www.w3.org/2000/svg';
    let element: SVGElement | null = null;
    
    switch (ann.type) {
      case 'arrow':
        const group = document.createElementNS(ns, 'g');
        
        // Line
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', ann.startX!.toString());
        line.setAttribute('y1', ann.startY!.toString());
        line.setAttribute('x2', ann.endX!.toString());
        line.setAttribute('y2', ann.endY!.toString());
        line.setAttribute('stroke', ann.color);
        line.setAttribute('stroke-width', ann.strokeWidth.toString());
        group.appendChild(line);
        
        // Arrowhead
        const angle = Math.atan2(ann.endY! - ann.startY!, ann.endX! - ann.startX!);
        const arrowLength = 15;
        const arrowAngle = Math.PI / 6;
        
        const arrow1 = document.createElementNS(ns, 'line');
        arrow1.setAttribute('x1', ann.endX!.toString());
        arrow1.setAttribute('y1', ann.endY!.toString());
        arrow1.setAttribute('x2', (ann.endX! - arrowLength * Math.cos(angle - arrowAngle)).toString());
        arrow1.setAttribute('y2', (ann.endY! - arrowLength * Math.sin(angle - arrowAngle)).toString());
        arrow1.setAttribute('stroke', ann.color);
        arrow1.setAttribute('stroke-width', ann.strokeWidth.toString());
        group.appendChild(arrow1);
        
        const arrow2 = document.createElementNS(ns, 'line');
        arrow2.setAttribute('x1', ann.endX!.toString());
        arrow2.setAttribute('y1', ann.endY!.toString());
        arrow2.setAttribute('x2', (ann.endX! - arrowLength * Math.cos(angle + arrowAngle)).toString());
        arrow2.setAttribute('y2', (ann.endY! - arrowLength * Math.sin(angle + arrowAngle)).toString());
        arrow2.setAttribute('stroke', ann.color);
        arrow2.setAttribute('stroke-width', ann.strokeWidth.toString());
        group.appendChild(arrow2);
        
        element = group;
        break;
        
      case 'rectangle':
        element = document.createElementNS(ns, 'rect');
        element.setAttribute('x', ann.x!.toString());
        element.setAttribute('y', ann.y!.toString());
        element.setAttribute('width', ann.width!.toString());
        element.setAttribute('height', ann.height!.toString());
        element.setAttribute('stroke', ann.color);
        element.setAttribute('stroke-width', ann.strokeWidth.toString());
        element.setAttribute('fill', 'none');
        break;
        
      case 'circle':
        element = document.createElementNS(ns, 'circle');
        element.setAttribute('cx', ann.x!.toString());
        element.setAttribute('cy', ann.y!.toString());
        element.setAttribute('r', ann.radius!.toString());
        element.setAttribute('stroke', ann.color);
        element.setAttribute('stroke-width', ann.strokeWidth.toString());
        element.setAttribute('fill', 'none');
        break;
        
      case 'text':
        element = document.createElementNS(ns, 'text');
        element.setAttribute('x', ann.x!.toString());
        element.setAttribute('y', ann.y!.toString());
        element.setAttribute('fill', ann.color);
        element.setAttribute('font-size', ann.fontSize!.toString());
        element.setAttribute('font-family', 'Arial, sans-serif');
        element.textContent = ann.text || '';
        break;
        
      case 'freehand':
        if (ann.points && ann.points.length > 0) {
          element = document.createElementNS(ns, 'polyline');
          const points = ann.points.map(p => `${p.x},${p.y}`).join(' ');
          element.setAttribute('points', points);
          element.setAttribute('stroke', ann.color);
          element.setAttribute('stroke-width', ann.strokeWidth.toString());
          element.setAttribute('fill', 'none');
          element.setAttribute('stroke-linecap', 'round');
          element.setAttribute('stroke-linejoin', 'round');
        }
        break;
    }
    
    if (element && ann.selected) {
      element.setAttribute('opacity', '0.7');
      element.setAttribute('stroke-dasharray', '5,5');
    }
    
    return element;
  }
  
  private renderTempAnnotation(endPoint?: { x: number; y: number }) {
    // Render temporary annotation while drawing
    const svg = this.svgElement?.nativeElement;
    if (!svg) return;
    
    // Remove previous temp annotation
    this.clearTempAnnotation();
    
    if (!this.startPoint) return;
    
    const tempAnn: Annotation = {
      id: 'temp',
      type: this.currentTool as any,
      color: this.currentColor,
      strokeWidth: this.strokeWidth,
      startX: this.startPoint.x,
      startY: this.startPoint.y,
      endX: endPoint?.x || this.startPoint.x,
      endY: endPoint?.y || this.startPoint.y
    };
    
    // Adjust for shapes
    if (this.currentTool === 'rectangle' && endPoint) {
      tempAnn.x = Math.min(this.startPoint.x, endPoint.x);
      tempAnn.y = Math.min(this.startPoint.y, endPoint.y);
      tempAnn.width = Math.abs(endPoint.x - this.startPoint.x);
      tempAnn.height = Math.abs(endPoint.y - this.startPoint.y);
    } else if (this.currentTool === 'circle' && endPoint) {
      tempAnn.radius = Math.sqrt(
        Math.pow(endPoint.x - this.startPoint.x, 2) + 
        Math.pow(endPoint.y - this.startPoint.y, 2)
      );
      tempAnn.x = this.startPoint.x;
      tempAnn.y = this.startPoint.y;
    } else if (this.currentTool === 'freehand') {
      tempAnn.points = [...this.currentPath];
    }
    
    const element = this.createSvgElement(tempAnn);
    if (element) {
      element.setAttribute('id', 'temp-annotation');
      element.setAttribute('opacity', '0.5');
      svg.appendChild(element);
    }
  }
  
  private clearTempAnnotation() {
    const temp = this.svgElement?.nativeElement.querySelector('#temp-annotation');
    if (temp) {
      temp.remove();
    }
  }
  
  // Save annotations
  async save() {
    const annotationData: AnnotationData = {
      imageId: this.attachId,
      version: '1.0',
      timestamp: Date.now(),
      annotations: this.annotations.map(a => {
        const { selected, ...ann } = a;
        return ann;
      })
    };
    
    console.log('Saving annotation data:', annotationData);
    this.onSave.emit(annotationData);
    await this.modalController.dismiss(annotationData);
  }
  
  async exportAsImage(): Promise<Blob> {
    // Create canvas and draw image + annotations
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    
    canvas.width = this.imageWidth;
    canvas.height = this.imageHeight;
    
    // Draw image
    const img = this.imageElement.nativeElement;
    ctx.drawImage(img, 0, 0);
    
    // Convert SVG to image and draw on canvas
    const svgData = new XMLSerializer().serializeToString(this.svgElement.nativeElement);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    
    return new Promise((resolve) => {
      const svgImg = new Image();
      svgImg.onload = () => {
        ctx.drawImage(svgImg, 0, 0);
        URL.revokeObjectURL(url);
        
        canvas.toBlob((blob) => {
          resolve(blob!);
        }, 'image/jpeg', 0.95);
      };
      svgImg.src = url;
    });
  }
  
  dismiss() {
    this.modalController.dismiss();
  }
}