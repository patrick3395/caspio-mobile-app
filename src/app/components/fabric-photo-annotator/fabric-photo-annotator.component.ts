import { Component, Input, ViewChild, ElementRef, OnInit, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import * as fabric from 'fabric';

@Component({
  selector: 'app-fabric-photo-annotator',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  template: `
    <ion-header>
      <ion-toolbar style="--background: #F15A27;">
        <ion-title style="color: white; font-weight: 600;">Annotate Photo</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()" style="color: white;">
            <ion-icon name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    
    <ion-content>
      <div class="annotation-toolbar">
        <ion-segment [(ngModel)]="currentTool" (ionChange)="selectTool($event)">
          <ion-segment-button value="select">
            <ion-icon name="hand-left-outline"></ion-icon>
            <ion-label>Select</ion-label>
          </ion-segment-button>
          <ion-segment-button value="pen">
            <ion-icon name="brush-outline"></ion-icon>
            <ion-label>Draw</ion-label>
          </ion-segment-button>
          <ion-segment-button value="arrow">
            <ion-icon name="arrow-forward-outline"></ion-icon>
            <ion-label>Arrow</ion-label>
          </ion-segment-button>
          <ion-segment-button value="rectangle">
            <ion-icon name="square-outline"></ion-icon>
            <ion-label>Rectangle</ion-label>
          </ion-segment-button>
          <ion-segment-button value="circle">
            <ion-icon name="ellipse-outline"></ion-icon>
            <ion-label>Circle</ion-label>
          </ion-segment-button>
          <ion-segment-button value="text">
            <ion-icon name="text-outline"></ion-icon>
            <ion-label>Text</ion-label>
          </ion-segment-button>
        </ion-segment>

        <div class="annotation-controls">
          <ion-button fill="clear" (click)="changeColor()">
            <ion-icon name="color-palette-outline"></ion-icon>
            <div class="color-preview" [style.background]="currentColor"></div>
          </ion-button>
          
          <ion-button fill="clear" (click)="undo()">
            <ion-icon name="arrow-undo-outline"></ion-icon>
          </ion-button>
          
          <ion-button fill="clear" (click)="clearAll()">
            <ion-icon name="trash-outline"></ion-icon>
          </ion-button>
          
          <ion-button fill="clear" (click)="deleteSelected()">
            <ion-icon name="close-circle-outline"></ion-icon>
          </ion-button>
        </div>
      </div>
      
      <div class="canvas-container" #canvasContainer>
        <canvas #fabricCanvas></canvas>
        
        <!-- Debug Info -->
        <div class="debug-info">
          <span class="version-badge">v1.4.229 FABRIC</span>
          <span class="annotation-count">Annotations: {{ getAnnotationCount() }}</span>
        </div>
      </div>
      
      <ion-fab vertical="bottom" horizontal="end" slot="fixed">
        <ion-fab-button (click)="save()" color="success">
          <ion-icon name="checkmark"></ion-icon>
        </ion-fab-button>
      </ion-fab>
    </ion-content>
  `,
  styles: [`
    .annotation-toolbar {
      padding: 10px;
      background: #f5f5f5;
      border-bottom: 1px solid #ddd;
    }
    
    .annotation-controls {
      display: flex;
      gap: 10px;
      margin-top: 10px;
      align-items: center;
    }
    
    .color-preview {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid #333;
      margin-left: 5px;
    }
    
    .canvas-container {
      position: relative;
      width: 100%;
      height: calc(100% - 120px);
      display: flex;
      justify-content: center;
      align-items: center;
      background: #e0e0e0;
      overflow: auto;
    }
    
    canvas {
      border: 1px solid #ccc;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    
    .debug-info {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 1000;
      display: flex;
      gap: 10px;
    }
    
    .version-badge {
      background: #ff0000;
      color: white;
      padding: 5px 10px;
      border-radius: 4px;
      font-weight: bold;
      font-size: 12px;
    }
    
    .annotation-count {
      background: #00aa00;
      color: white;
      padding: 5px 10px;
      border-radius: 4px;
      font-weight: bold;
      font-size: 12px;
    }
    
    ion-segment {
      --background: white;
    }
    
    ion-segment-button {
      --indicator-color: #F15A27;
      --color-checked: #F15A27;
    }
  `]
})
export class FabricPhotoAnnotatorComponent implements OnInit, AfterViewInit {
  @ViewChild('fabricCanvas', { static: false }) canvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvasContainer', { static: false }) canvasContainer!: ElementRef<HTMLDivElement>;
  
  @Input() imageUrl?: string;
  @Input() imageFile?: File;
  @Input() existingAnnotations?: any[] = [];
  
  private canvas!: fabric.Canvas;
  currentTool = 'select';
  currentColor = '#FF0000';
  private strokeWidth = 3;
  private isDrawing = false;
  private colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#000000', '#FFFFFF'];
  private colorIndex = 0;
  
  constructor(
    private modalController: ModalController
  ) {}
  
  ngOnInit() {
    console.log('🎨 [v1.4.229 FABRIC] Initializing Fabric.js photo annotator');
  }
  
  ngAfterViewInit() {
    setTimeout(() => this.initializeFabricCanvas(), 100);
  }
  
  async initializeFabricCanvas() {
    if (!this.canvasElement) {
      console.error('Canvas element not found');
      return;
    }
    
    // Initialize Fabric.js canvas
    this.canvas = new fabric.Canvas(this.canvasElement.nativeElement, {
      isDrawingMode: false,
      selection: true
    });
    
    // Load the image
    if (this.imageUrl || this.imageFile) {
      const imageUrl = this.imageUrl || await this.fileToDataUrl(this.imageFile!);
      
      fabric.Image.fromURL(imageUrl).then((img: fabric.Image) => {
        // Set canvas size to image size (scaled to fit container)
        const containerWidth = this.canvasContainer.nativeElement.clientWidth * 0.9;
        const containerHeight = this.canvasContainer.nativeElement.clientHeight * 0.9;
        
        let scale = 1;
        if (img.width! > containerWidth || img.height! > containerHeight) {
          scale = Math.min(containerWidth / img.width!, containerHeight / img.height!);
        }
        
        this.canvas.setWidth(img.width! * scale);
        this.canvas.setHeight(img.height! * scale);
        
        img.scale(scale);
        img.selectable = false;
        img.evented = false;
        
        // Add image as background
        this.canvas.backgroundImage = img;
        this.canvas.renderAll();
        
        // Load existing annotations if any
        if (this.existingAnnotations && this.existingAnnotations.length > 0) {
          this.loadExistingAnnotations();
        }
        
        console.log('✅ [v1.4.228 FABRIC] Canvas initialized with image');
      });
    }
    
    // Set up drawing brush
    if (this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.width = this.strokeWidth;
      this.canvas.freeDrawingBrush.color = this.currentColor;
    }
    
    // Add event listeners for custom tools
    this.setupEventListeners();
  }
  
  private async fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.readAsDataURL(file);
    });
  }
  
  private setupEventListeners() {
    let isDrawingArrow = false;
    let startX = 0, startY = 0;
    let tempLine: fabric.Line | null = null;
    let tempArrowHead1: fabric.Line | null = null;
    let tempArrowHead2: fabric.Line | null = null;
    
    this.canvas.on('mouse:down', (options: fabric.TEvent) => {
      if (this.currentTool === 'arrow') {
        isDrawingArrow = true;
        const pointer = this.canvas.getPointer(options.e);
        startX = pointer.x;
        startY = pointer.y;
      } else if (this.currentTool === 'rectangle') {
        const pointer = this.canvas.getPointer(options.e);
        const rect = new fabric.Rect({
          left: pointer.x,
          top: pointer.y,
          width: 0,
          height: 0,
          fill: 'transparent',
          stroke: this.currentColor,
          strokeWidth: this.strokeWidth
        });
        this.canvas.add(rect);
        this.isDrawing = true;
      } else if (this.currentTool === 'circle') {
        const pointer = this.canvas.getPointer(options.e);
        const circle = new fabric.Circle({
          left: pointer.x,
          top: pointer.y,
          radius: 1,
          fill: 'transparent',
          stroke: this.currentColor,
          strokeWidth: this.strokeWidth
        });
        this.canvas.add(circle);
        this.isDrawing = true;
      } else if (this.currentTool === 'text') {
        const pointer = this.canvas.getPointer(options.e);
        const text = new fabric.IText('Text', {
          left: pointer.x,
          top: pointer.y,
          fontSize: 20,
          fill: this.currentColor
        });
        this.canvas.add(text);
        this.canvas.setActiveObject(text);
        text.enterEditing();
        text.selectAll();
      }
    });
    
    this.canvas.on('mouse:move', (options: fabric.TEvent) => {
      if (isDrawingArrow) {
        const pointer = this.canvas.getPointer(options.e);
        
        // Remove temporary arrow if exists
        if (tempLine) {
          this.canvas.remove(tempLine);
          if (tempArrowHead1) this.canvas.remove(tempArrowHead1);
          if (tempArrowHead2) this.canvas.remove(tempArrowHead2);
        }
        
        // Draw temporary arrow
        tempLine = new fabric.Line([startX, startY, pointer.x, pointer.y], {
          stroke: this.currentColor,
          strokeWidth: this.strokeWidth,
          selectable: false,
          evented: false
        });
        
        // Calculate arrow head
        const angle = Math.atan2(pointer.y - startY, pointer.x - startX);
        const headLength = 15;
        
        tempArrowHead1 = new fabric.Line([
          pointer.x,
          pointer.y,
          pointer.x - headLength * Math.cos(angle - Math.PI / 6),
          pointer.y - headLength * Math.sin(angle - Math.PI / 6)
        ], {
          stroke: this.currentColor,
          strokeWidth: this.strokeWidth,
          selectable: false,
          evented: false
        });
        
        tempArrowHead2 = new fabric.Line([
          pointer.x,
          pointer.y,
          pointer.x - headLength * Math.cos(angle + Math.PI / 6),
          pointer.y - headLength * Math.sin(angle + Math.PI / 6)
        ], {
          stroke: this.currentColor,
          strokeWidth: this.strokeWidth,
          selectable: false,
          evented: false
        });
        
        this.canvas.add(tempLine, tempArrowHead1, tempArrowHead2);
        this.canvas.renderAll();
      } else if (this.isDrawing && this.currentTool === 'rectangle') {
        const pointer = this.canvas.getPointer(options.e);
        const rect = this.canvas.getObjects().slice(-1)[0] as fabric.Rect;
        if (rect) {
          rect.set({
            width: Math.abs(pointer.x - rect.left!),
            height: Math.abs(pointer.y - rect.top!)
          });
          this.canvas.renderAll();
        }
      } else if (this.isDrawing && this.currentTool === 'circle') {
        const pointer = this.canvas.getPointer(options.e);
        const circle = this.canvas.getObjects().slice(-1)[0] as fabric.Circle;
        if (circle) {
          const radius = Math.sqrt(
            Math.pow(pointer.x - circle.left!, 2) + 
            Math.pow(pointer.y - circle.top!, 2)
          );
          circle.set({ radius });
          this.canvas.renderAll();
        }
      }
    });
    
    this.canvas.on('mouse:up', (options: fabric.TEvent) => {
      if (isDrawingArrow) {
        isDrawingArrow = false;
        
        // Remove temporary arrow
        if (tempLine) {
          this.canvas.remove(tempLine);
          if (tempArrowHead1) this.canvas.remove(tempArrowHead1);
          if (tempArrowHead2) this.canvas.remove(tempArrowHead2);
        }
        
        // Create final arrow group
        const pointer = this.canvas.getPointer(options.e);
        const arrow = this.createArrow(startX, startY, pointer.x, pointer.y);
        this.canvas.add(arrow);
        
        tempLine = null;
        tempArrowHead1 = null;
        tempArrowHead2 = null;
      }
      this.isDrawing = false;
      
      console.log(`📊 [v1.4.229 FABRIC] Total annotations: ${this.getAnnotationCount()}`);
    });
  }
  
  private createArrow(x1: number, y1: number, x2: number, y2: number): fabric.Group {
    const line = new fabric.Line([x1, y1, x2, y2], {
      stroke: this.currentColor,
      strokeWidth: this.strokeWidth
    });
    
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLength = 15;
    
    const arrowHead1 = new fabric.Line([
      x2,
      y2,
      x2 - headLength * Math.cos(angle - Math.PI / 6),
      y2 - headLength * Math.sin(angle - Math.PI / 6)
    ], {
      stroke: this.currentColor,
      strokeWidth: this.strokeWidth
    });
    
    const arrowHead2 = new fabric.Line([
      x2,
      y2,
      x2 - headLength * Math.cos(angle + Math.PI / 6),
      y2 - headLength * Math.sin(angle + Math.PI / 6)
    ], {
      stroke: this.currentColor,
      strokeWidth: this.strokeWidth
    });
    
    return new fabric.Group([line, arrowHead1, arrowHead2]);
  }
  
  selectTool(event: any) {
    const tool = event.detail.value;
    this.currentTool = tool;
    
    // Update canvas mode based on tool
    if (tool === 'pen') {
      this.canvas.isDrawingMode = true;
      this.canvas.selection = false;
      if (this.canvas.freeDrawingBrush) {
        this.canvas.freeDrawingBrush.color = this.currentColor;
        this.canvas.freeDrawingBrush.width = this.strokeWidth;
      }
    } else if (tool === 'select') {
      this.canvas.isDrawingMode = false;
      this.canvas.selection = true;
    } else {
      this.canvas.isDrawingMode = false;
      this.canvas.selection = false;
    }
    
    console.log(`🔧 [v1.4.229 FABRIC] Tool selected: ${tool}`);
  }
  
  changeColor() {
    this.colorIndex = (this.colorIndex + 1) % this.colors.length;
    this.currentColor = this.colors[this.colorIndex];
    if (this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.color = this.currentColor;
    }
    console.log(`🎨 [v1.4.229 FABRIC] Color changed to: ${this.currentColor}`);
  }
  
  undo() {
    const objects = this.canvas.getObjects();
    if (objects.length > 0) {
      // Don't remove the background image
      const lastObject = objects[objects.length - 1];
      if (!(lastObject instanceof fabric.Image)) {
        this.canvas.remove(lastObject);
        console.log(`↩️ [v1.4.229 FABRIC] Undo - removed last annotation`);
      }
    }
  }
  
  clearAll() {
    // Remove all objects except the background image
    const objects = this.canvas.getObjects();
    objects.forEach((obj: fabric.Object) => {
      if (!(obj instanceof fabric.Image)) {
        this.canvas.remove(obj);
      }
    });
    console.log(`🗑️ [v1.4.229 FABRIC] Cleared all annotations`);
  }
  
  deleteSelected() {
    const activeObject = this.canvas.getActiveObject();
    if (activeObject && !(activeObject instanceof fabric.Image)) {
      this.canvas.remove(activeObject);
      console.log(`❌ [v1.4.229 FABRIC] Deleted selected object`);
    }
  }
  
  getAnnotationCount(): number {
    // Count all objects except the background image
    const objects = this.canvas?.getObjects() || [];
    return objects.filter((obj: fabric.Object) => !(obj instanceof fabric.Image)).length;
  }
  
  private loadExistingAnnotations() {
    // This would load existing annotations from the input
    // Format would need to be adapted based on your data structure
    console.log(`📥 [v1.4.229 FABRIC] Loading ${this.existingAnnotations?.length} existing annotations`);
  }
  
  async save() {
    // Export the canvas as image
    const dataUrl = this.canvas.toDataURL({
      format: 'jpeg',
      quality: 0.9,
      multiplier: 1
    });
    
    // Convert to blob
    const blob = await this.dataUrlToBlob(dataUrl);
    
    // Also export the annotation data for future editing
    const annotationData = this.canvas.toJSON();
    
    console.log(`💾 [v1.4.229 FABRIC] Saving with ${this.getAnnotationCount()} annotations`);
    
    this.modalController.dismiss({
      annotatedBlob: blob,  // Use same property name as old annotator for compatibility
      blob,  // Keep for backward compatibility
      dataUrl,
      annotationData,
      annotationsData: annotationData,  // Also provide with 's' for compatibility
      annotationCount: this.getAnnotationCount()
    });
  }
  
  private async dataUrlToBlob(dataUrl: string): Promise<Blob> {
    const response = await fetch(dataUrl);
    return await response.blob();
  }
  
  dismiss() {
    this.modalController.dismiss();
  }
}