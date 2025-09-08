import { Component, Input, ViewChild, ElementRef, OnInit, AfterViewInit, OnDestroy } from '@angular/core';
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
      <ion-toolbar style="--background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
        <ion-buttons slot="start">
          <ion-button (click)="dismiss()" style="color: white;">
            <ion-icon name="arrow-back-outline" style="font-size: 24px;"></ion-icon>
          </ion-button>
        </ion-buttons>
        <ion-title style="color: white; font-weight: 500; text-align: center;">Photo Editor</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="save()" style="color: white;">
            <ion-icon name="checkmark-outline" style="font-size: 28px; font-weight: bold;"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    
    <ion-content>
      <div class="annotation-tools-container">
        <div class="main-tools">
          <button class="tool-btn color-btn" (click)="changeColor()">
            <ion-icon name="color-palette-outline"></ion-icon>
            <div class="color-indicator" [style.background]="currentColor"></div>
          </button>
          <button class="tool-btn" [class.active]="currentTool === 'arrow'" (click)="setTool('arrow')">
            <ion-icon name="arrow-forward-outline"></ion-icon>
          </button>
          <button class="tool-btn" [class.active]="currentTool === 'rectangle'" (click)="setTool('rectangle')">
            <ion-icon name="square-outline"></ion-icon>
          </button>
          <button class="tool-btn" [class.active]="currentTool === 'text'" (click)="setTool('text')">
            <ion-icon name="text-outline"></ion-icon>
          </button>
        </div>
        
        <div class="bottom-tools">
          <button class="tool-btn" (click)="undo()">
            <ion-icon name="arrow-back-outline"></ion-icon>
          </button>
          <button class="tool-btn" (click)="clearAll()">
            <ion-icon name="trash-outline"></ion-icon>
          </button>
        </div>
      </div>
      
      <div class="canvas-container" #canvasContainer>
        <canvas #fabricCanvas></canvas>
        
        <!-- Debug Info -->
        <div class="debug-info">
          <span class="version-badge">v1.4.234</span>
        </div>
      </div>
      
    </ion-content>
  `,
  styles: [`
    .annotation-tools-container {
      padding: 16px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    
    .main-tools {
      display: flex;
      justify-content: center;
      gap: 12px;
      margin-bottom: 12px;
    }
    
    .bottom-tools {
      display: flex;
      justify-content: center;
      gap: 20px;
    }
    
    .tool-btn {
      background: rgba(255,255,255,0.2);
      border: 2px solid rgba(255,255,255,0.4);
      border-radius: 12px;
      width: 50px;
      height: 50px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      cursor: pointer;
      transition: all 0.3s;
      position: relative;
    }
    
    .tool-btn:hover {
      background: rgba(255,255,255,0.35);
      transform: scale(1.05);
    }
    
    .tool-btn.active {
      background: rgba(255,255,255,0.5);
      border-color: white;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    
    .tool-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .tool-btn ion-icon {
      font-size: 24px;
    }
    
    .color-btn {
      position: relative;
    }
    
    .color-indicator {
      position: absolute;
      bottom: 2px;
      right: 2px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 2px solid white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    
    .canvas-container {
      position: relative;
      width: 100%;
      height: calc(100% - 150px);
      display: flex;
      justify-content: center;
      align-items: center;
      background: #f5f5f5;
      overflow: auto;
    }
    
    canvas {
      border: 2px solid #ddd;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      background: white;
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
  `]
})
export class FabricPhotoAnnotatorComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('fabricCanvas', { static: false }) canvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvasContainer', { static: false }) canvasContainer!: ElementRef<HTMLDivElement>;
  
  @Input() imageUrl?: string;
  @Input() imageFile?: File;
  @Input() existingAnnotations?: any[] = [];
  
  private canvas!: fabric.Canvas;
  currentTool = 'arrow';
  currentColor = '#FF0000';
  private strokeWidth = 3;
  private isDrawing = false;
  private colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#000000', '#FFFFFF'];
  private colorIndex = 0;
  
  constructor(
    private modalController: ModalController
  ) {}
  
  ngOnInit() {
    console.log('🎨 [v1.4.234 FABRIC] Initializing Fabric.js photo annotator');
    console.log('📥 [v1.4.234 FABRIC] Existing annotations:', this.existingAnnotations);
  }
  
  ngAfterViewInit() {
    setTimeout(() => this.initializeFabricCanvas(), 100);
    
    // Add keyboard listener for delete key
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
  }
  
  ngOnDestroy() {
    // Clean up keyboard listener
    document.removeEventListener('keydown', this.handleKeyDown.bind(this));
  }
  
  private handleKeyDown(event: KeyboardEvent) {
    // Delete selected object when Delete or Backspace is pressed
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.canvas) {
      const activeObject = this.canvas.getActiveObject();
      if (activeObject && !(activeObject instanceof fabric.Image)) {
        this.canvas.remove(activeObject);
        this.canvas.discardActiveObject();
        this.canvas.renderAll();
        console.log('🗑️ Deleted selected annotation');
      }
    }
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
        if (this.existingAnnotations) {
          // Check if it's an array with length or an object with properties
          const hasAnnotations = Array.isArray(this.existingAnnotations) 
            ? this.existingAnnotations.length > 0
            : Object.keys(this.existingAnnotations).length > 0;
            
          if (hasAnnotations) {
            console.log('📋 [v1.4.234 FABRIC] Found existing annotations to load:`, this.existingAnnotations);
            setTimeout(() => this.loadExistingAnnotations(), 100); // Small delay to ensure canvas is ready
          }
        }
        
        console.log('✅ [v1.4.234 FABRIC] Canvas initialized with image');
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
      
      console.log(`📊 [v1.4.233 FABRIC] Total annotations: ${this.getAnnotationCount()}`);
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
  
  setTool(tool: string) {
    this.currentTool = tool;
    
    // Always disable drawing mode and selection for our simplified tools
    this.canvas.isDrawingMode = false;
    this.canvas.selection = false;
    
    console.log(`🔧 [v1.4.233 FABRIC] Tool selected: ${tool}`);
  }
  
  selectTool(event: any) {
    const tool = event.detail.value;
    this.setTool(tool);
  }
  
  changeColor() {
    this.colorIndex = (this.colorIndex + 1) % this.colors.length;
    this.currentColor = this.colors[this.colorIndex];
    if (this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.color = this.currentColor;
    }
    console.log(`🎨 [v1.4.233 FABRIC] Color changed to: ${this.currentColor}`);
  }
  
  undo() {
    const objects = this.canvas.getObjects();
    if (objects.length > 0) {
      // Don't remove the background image
      const lastObject = objects[objects.length - 1];
      if (!(lastObject instanceof fabric.Image)) {
        this.canvas.remove(lastObject);
        console.log(`↩️ [v1.4.233 FABRIC] Undo - removed last annotation`);
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
    this.canvas.renderAll();
    console.log(`🗑️ [v1.4.233 FABRIC] Cleared all annotations`);
  }
  
  // Removed deleteSelected() method as we no longer have a select tool
  
  
  getAnnotationCount(): number {
    // Count all objects except the background image
    const objects = this.canvas?.getObjects() || [];
    return objects.filter((obj: fabric.Object) => !(obj instanceof fabric.Image)).length;
  }
  
  private async loadExistingAnnotations() {
    console.log(`📥 [v1.4.233 FABRIC] Loading existing annotations...`);
    console.log('[v1.4.233] Raw annotation data:', this.existingAnnotations);
    console.log('[v1.4.233] Type of annotation data:', typeof this.existingAnnotations);
    
    if (!this.existingAnnotations || !this.canvas) {
      console.log('No annotations to load or canvas not ready');
      return;
    }
    
    try {
      let dataToLoad = this.existingAnnotations;
      
      // If it's a string, parse it first
      if (typeof dataToLoad === 'string') {
        try {
          dataToLoad = JSON.parse(dataToLoad);
          console.log('📄 Parsed annotation string to object');
        } catch (e) {
          console.error('Failed to parse annotation string:', e);
          return;
        }
      }
      
      // Check if it's a Fabric.js JSON object with 'objects' property
      if (dataToLoad && typeof dataToLoad === 'object' && 'objects' in dataToLoad) {
        const fabricData = dataToLoad as any;
        
        // Load the annotations (but filter out any images to avoid duplicates)
        const annotationObjects = fabricData.objects?.filter((obj: any) => 
          obj.type !== 'image' && obj.type !== 'Image'
        ) || [];
        
        console.log(`🔍 Found ${annotationObjects.length} annotation objects to load`);
        
        // Add each annotation object to the canvas
        for (const objData of annotationObjects) {
          try {
            let obj: fabric.Object | null = null;
            
            // Ensure the object will be selectable
            const objectOptions = {
              ...objData,
              selectable: true,
              evented: true,
              hasControls: true,
              hasBorders: true
            };
            
            switch(objData.type) {
              case 'path':
                obj = new fabric.Path(objData.path, objectOptions);
                break;
              case 'line':
                const points = objData.points || [objData.x1 || 0, objData.y1 || 0, objData.x2 || 100, objData.y2 || 100];
                obj = new fabric.Line(points, objectOptions);
                break;
              case 'rect':
                obj = new fabric.Rect(objectOptions);
                break;
              case 'circle':
                obj = new fabric.Circle(objectOptions);
                break;
              case 'text':
                obj = new fabric.Text(objData.text || '', objectOptions);
                break;
              case 'polyline':
                obj = new fabric.Polyline(objData.points || [], objectOptions);
                break;
              case 'group':
                // Handle grouped objects (like arrows which are line + polylines)
                const groupObjects: fabric.Object[] = [];
                for (const childData of (objData.objects || [])) {
                  let childObj: fabric.Object | null = null;
                  const childOptions = { ...childData, selectable: true, evented: true };
                  
                  if (childData.type === 'line') {
                    childObj = new fabric.Line(childData.points || [0, 0, 100, 100], childOptions);
                  } else if (childData.type === 'polyline') {
                    childObj = new fabric.Polyline(childData.points || [], childOptions);
                  } else if (childData.type === 'path') {
                    childObj = new fabric.Path(childData.path, childOptions);
                  }
                  
                  if (childObj) {
                    groupObjects.push(childObj);
                  }
                }
                if (groupObjects.length > 0) {
                  obj = new fabric.Group(groupObjects, objectOptions);
                }
                break;
              default:
                console.warn('Unknown object type:', objData.type);
            }
            
            if (obj) {
              // Make sure the object is selectable and can be deleted
              obj.selectable = true;
              obj.evented = true;
              obj.hasControls = true;
              obj.hasBorders = true;
              
              this.canvas.add(obj);
              console.log(`➕ Added ${objData.type} object to canvas`);
            }
          } catch (e) {
            console.error('Error creating object:', e, objData);
          }
        }
        
        this.canvas.renderAll();
        
        // Keep default arrow tool
        this.currentTool = 'arrow';
        
        console.log(`✅ [v1.4.233 FABRIC] Successfully loaded ${annotationObjects.length} annotations`);
        console.log('[v1.4.233] Canvas now has', this.canvas.getObjects().length, 'total objects');
      } else {
        console.log('⚠️ No valid Fabric.js data found in annotations');
      }
    } catch (error) {
      console.error('❌ Error loading existing annotations:', error);
    }
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
    
    console.log(`💾 [v1.4.233 FABRIC] Saving with ${this.getAnnotationCount()} annotations`);
    console.log('📤 [v1.4.233 FABRIC] Annotation data being saved:', annotationData);
    
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