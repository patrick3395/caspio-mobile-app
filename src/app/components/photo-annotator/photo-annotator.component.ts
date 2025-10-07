import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, AlertController } from '@ionic/angular';

@Component({
  selector: 'app-photo-annotator',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  template: `
    <ion-content>
      <div class="annotation-toolbar">
        <!-- Back Button -->
        <button (click)="dismiss()" class="nav-btn back-btn" title="Back">
          <ion-icon name="arrow-back"></ion-icon>
        </button>
        
        <!-- Tools Dropdown -->
        <div class="dropdown-wrapper">
          <button class="dropdown-toggle" (click)="toggleDropdown('tools')" [class.active]="showToolsDropdown">
            <ion-icon [name]="getToolIcon(currentTool)"></ion-icon>
            <span>{{getToolName(currentTool)}}</span>
            <ion-icon name="chevron-down-outline" class="chevron"></ion-icon>
          </button>
          <div class="dropdown-menu" *ngIf="showToolsDropdown">
            <button (click)="selectTool('pen')" class="dropdown-item" [class.selected]="currentTool === 'pen'">
              <ion-icon name="brush-outline"></ion-icon>
              <span>Pen</span>
            </button>
            <button (click)="selectTool('arrow')" class="dropdown-item" [class.selected]="currentTool === 'arrow'">
              <ion-icon name="arrow-forward-outline"></ion-icon>
              <span>Arrow</span>
            </button>
            <button (click)="selectTool('rectangle')" class="dropdown-item" [class.selected]="currentTool === 'rectangle'">
              <ion-icon name="square-outline"></ion-icon>
              <span>Rectangle</span>
            </button>
            <button (click)="selectTool('circle')" class="dropdown-item" [class.selected]="currentTool === 'circle'">
              <ion-icon name="ellipse-outline"></ion-icon>
              <span>Circle</span>
            </button>
            <button (click)="selectTool('text')" class="dropdown-item" [class.selected]="currentTool === 'text'">
              <ion-icon name="text-outline"></ion-icon>
              <span>Text</span>
            </button>
          </div>
        </div>
        
        <!-- Color Dropdown -->
        <div class="dropdown-wrapper">
          <button class="dropdown-toggle" (click)="toggleDropdown('color')" [class.active]="showColorDropdown">
            <span class="color-preview" [style.background]="currentColor"></span>
            <span>Color</span>
            <ion-icon name="chevron-down-outline" class="chevron"></ion-icon>
          </button>
          <div class="dropdown-menu color-menu" *ngIf="showColorDropdown">
            <div class="color-grid">
              <button *ngFor="let color of colors" 
                      [style.background]="color" 
                      [class.selected]="currentColor === color"
                      (click)="selectColor(color)" 
                      class="color-option"
                      [style.border-color]="color === '#FFFFFF' ? '#ddd' : color"></button>
            </div>
          </div>
        </div>
        
        <!-- Size Dropdown -->
        <div class="dropdown-wrapper">
          <button class="dropdown-toggle" (click)="toggleDropdown('size')" [class.active]="showSizeDropdown">
            <ion-icon name="resize-outline"></ion-icon>
            <span>Size: {{strokeWidth}}</span>
            <ion-icon name="chevron-down-outline" class="chevron"></ion-icon>
          </button>
          <div class="dropdown-menu size-menu" *ngIf="showSizeDropdown">
            <div class="size-control">
              <input type="range" min="2" max="20" [(ngModel)]="strokeWidth" class="size-slider">
              <div class="size-preview">
                <div class="preview-line" [style.height.px]="strokeWidth" [style.background]="currentColor"></div>
                <span class="size-value">{{strokeWidth}}px</span>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Action Buttons -->
        <div class="toolbar-actions">
          <button (click)="toggleDeleteMode()" [class.active]="deleteMode" class="action-btn delete" title="Delete Mode">
            <ion-icon name="close-circle-outline"></ion-icon>
          </button>
          <button (click)="undo()" [disabled]="!canUndo" class="action-btn undo" title="Undo Last">
            <ion-icon name="arrow-undo-outline"></ion-icon>
          </button>
          <button (click)="clearAnnotations()" class="action-btn clear" title="Clear All">
            <ion-icon name="brush-outline"></ion-icon>
          </button>
        </div>
        
        <!-- Save Button -->
        <button (click)="saveAnnotatedImage()" class="nav-btn save-btn" title="Save">
          <ion-icon name="checkmark"></ion-icon>
        </button>
      </div>
      
      <div class="canvas-container" #canvasContainer>
        <canvas #imageCanvas></canvas>
        <canvas #annotationCanvas 
                (mousedown)="startDrawing($event)"
                (mousemove)="draw($event)"
                (mouseup)="stopDrawing($event)"
                (mouseleave)="stopDrawing($event)"
                (touchstart)="handleTouch($event)"
                (touchmove)="handleTouch($event)"
                (touchend)="handleTouch($event)"></canvas>
        
        <!-- Text input overlay -->
        <div *ngIf="showTextInput" class="text-input-overlay" [style.left.px]="textPosition.x" [style.top.px]="textPosition.y">
          <input #textInput type="text" [(ngModel)]="currentText" (keyup.enter)="addText()" (blur)="cancelText()" placeholder="Enter text...">
        </div>
      </div>
      
      <!-- Caption Input Below Canvas -->
      <div class="caption-container">
        <input 
          type="text" 
          [(ngModel)]="caption" 
          placeholder="Add Caption..." 
          class="caption-input"
          maxlength="255">
      </div>
    </ion-content>
  `,
  styles: [`
    ion-content {
      --padding-top: 0;
      --padding-bottom: 0;
    }
    
    .annotation-toolbar {
      background: #f0f0f0;
      padding: 8px 12px;
      border-bottom: 1px solid rgba(0,0,0,0.08);
      display: flex;
      gap: 8px;
      align-items: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.05);
      position: relative;
      z-index: 100;
    }
    
    .nav-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 42px;
      height: 42px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      transition: all 0.2s ease;
      padding: 0;
    }
    
    .back-btn {
      background: rgba(0, 0, 0, 0.05);
      color: #333;
    }
    
    .back-btn:hover {
      background: rgba(0, 0, 0, 0.1);
      transform: translateX(-2px);
    }
    
    .back-btn ion-icon {
      font-size: 24px;
      color: #333;
    }
    
    .save-btn {
      background: #F15A27;
      color: white;
      margin-left: auto;
    }
    
    .save-btn:hover {
      background: #d94e1f;
      transform: scale(1.05);
    }
    
    .save-btn ion-icon {
      font-size: 26px;
      color: white;
    }
    
    .dropdown-wrapper {
      position: relative;
    }
    
    .dropdown-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: #333;
      transition: all 0.2s ease;
      min-width: 100px;
    }
    
    .dropdown-toggle:hover {
      background: #e0e0e0;
      border-color: #999;
    }

    .dropdown-toggle.active {
      background: #e0e0e0;
      border-color: #999;
      color: #333;
    }
    
    .dropdown-toggle ion-icon {
      font-size: 18px;
    }
    
    .dropdown-toggle .chevron {
      font-size: 14px;
      margin-left: auto;
      transition: transform 0.2s ease;
    }
    
    .dropdown-toggle.active .chevron {
      transform: rotate(180deg);
    }
    
    .color-preview {
      width: 20px;
      height: 20px;
      border-radius: 4px;
      border: 1px solid #ddd;
      display: inline-block;
    }
    
    .dropdown-menu {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      padding: 8px;
      min-width: 150px;
      z-index: 1000;
      animation: slideDown 0.2s ease;
    }
    
    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .dropdown-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      background: transparent;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      width: 100%;
      text-align: left;
      font-size: 14px;
      color: #333;
      transition: all 0.2s ease;
    }
    
    .dropdown-item:hover {
      background: #f5f5f5;
    }
    
    .dropdown-item.selected {
      background: #FFF5F2;
      color: #F15A27;
    }
    
    .dropdown-item ion-icon {
      font-size: 18px;
    }
    
    .color-menu {
      min-width: 200px;
    }
    
    .color-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      padding: 4px;
    }
    
    .color-option {
      width: 36px;
      height: 36px;
      border-radius: 6px;
      border: 2px solid transparent;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    
    .color-option:hover {
      transform: scale(1.1);
    }
    
    .color-option.selected {
      border-color: #F15A27;
      box-shadow: 0 0 0 2px rgba(241, 90, 39, 0.2);
    }
    
    .size-menu {
      min-width: 250px;
    }
    
    .size-control {
      padding: 8px;
    }
    
    .size-slider {
      width: 100%;
      height: 4px;
      -webkit-appearance: none;
      appearance: none;
      background: #e3e8ee;
      border-radius: 2px;
      outline: none;
      margin: 10px 0;
    }
    
    .size-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 20px;
      height: 20px;
      background: #F15A27;
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(241, 90, 39, 0.3);
    }
    
    .size-preview {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 10px;
    }
    
    .preview-line {
      width: 100px;
      border-radius: 10px;
      transition: all 0.2s ease;
    }
    
    .size-value {
      font-size: 14px;
      font-weight: 600;
      color: #5f6c7b;
    }
    
    .toolbar-actions {
      display: flex;
      gap: 6px;
    }
    
    .action-btn {
      padding: 0;
      width: 40px;
      height: 40px;
      border: none;
      background: rgba(255,255,255,0.8);
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    
    .action-btn ion-icon {
      font-size: 20px;
      color: #5f6c7b;
    }
    
    .action-btn.undo:hover:not(:disabled) {
      background: rgba(0, 0, 0, 0.1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    .action-btn.undo:hover:not(:disabled) ion-icon {
      color: #000000;
    }

    .action-btn.clear:hover {
      background: rgba(0, 0, 0, 0.1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }

    .action-btn.clear:hover ion-icon {
      color: #000000;
    }
    
    .action-btn.delete:hover:not(.active) {
      background: rgba(255, 59, 48, 0.1);
      box-shadow: 0 4px 12px rgba(255, 59, 48, 0.2);
    }
    
    .action-btn.delete:hover:not(.active) ion-icon {
      color: #FF3B30;
    }
    
    .action-btn.delete.active {
      background: rgba(255, 59, 48, 0.2);
      border: 2px solid #FF3B30;
    }
    
    .action-btn.delete.active ion-icon {
      color: #FF3B30;
    }
    
    .action-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
    
    .canvas-container {
      position: relative;
      width: 100%;
      height: calc(100vh - 58px - 70px);
      overflow: auto;
      background: #2d2d2d;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 10px;
    }
    
    canvas {
      position: absolute;
      max-width: calc(100% - 20px);
      max-height: calc(100% - 20px);
      cursor: crosshair;
      border-radius: 4px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
    
    .caption-container {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: white;
      padding: 12px 16px;
      border-top: 1px solid #e0e0e0;
      box-shadow: 0 -2px 10px rgba(0,0,0,0.05);
      z-index: 100;
    }
    
    .caption-input {
      width: 100%;
      padding: 12px 16px;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
      transition: all 0.2s ease;
    }
    
    .caption-input:focus {
      border-color: #F15A27;
      box-shadow: 0 0 0 3px rgba(241, 90, 39, 0.1);
    }
    
    #imageCanvas {
      z-index: 1;
    }
    
    #annotationCanvas {
      z-index: 2;
      cursor: crosshair;
    }
    
    #annotationCanvas[data-tool="pen"] {
      cursor: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="%23667eea"/></svg>') 10 10, crosshair;
    }
    
    #annotationCanvas.delete-mode {
      cursor: pointer;
    }
    
    .annotation-highlight {
      position: absolute;
      border: 2px dashed #FF9800;
      background: rgba(255, 152, 0, 0.1);
      pointer-events: none;
      z-index: 3;
      border-radius: 4px;
    }
    
    .text-input-overlay {
      position: absolute;
      z-index: 3;
    }
    
    .text-input-overlay input {
      padding: 8px 12px;
      border: none;
      border-radius: 6px;
      background: white;
      font-size: 16px;
      min-width: 200px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      outline: none;
    }
    
    .text-input-overlay input:focus {
      box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
    }
  `]
})
export class PhotoAnnotatorComponent implements OnInit {
  @Input() imageFile: File | null = null;
  @Input() imageUrl: string = '';
  @Input() existingAnnotations: any[] = [];
  @Output() annotatedImage = new EventEmitter<Blob>();
  @Output() annotationsData = new EventEmitter<any[]>();
  
  @ViewChild('imageCanvas') imageCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('annotationCanvas') annotationCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvasContainer') canvasContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('textInput') textInput!: ElementRef<HTMLInputElement>;
  
  private imageCtx!: CanvasRenderingContext2D;
  private annotationCtx!: CanvasRenderingContext2D;
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private annotationObjects: any[] = [];
  private canvasInitialized = false;
  private currentPath: any[] = [];
  private tempCanvas!: HTMLCanvasElement;
  private tempCtx!: CanvasRenderingContext2D;
  private permanentCanvas!: HTMLCanvasElement;
  private permanentCtx!: CanvasRenderingContext2D;
  
  currentTool: 'pen' | 'arrow' | 'rectangle' | 'circle' | 'text' = 'pen';
  currentColor = '#FF0000';
  strokeWidth = 3;
  colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#000000', '#FFFFFF', '#F15A27', '#FFA500', '#800080', '#808080'];
  
  showTextInput = false;
  textPosition = { x: 0, y: 0 };
  currentText = '';
  photoCaption = '';
  
  canUndo = false;
  deleteMode = false;
  hoveredAnnotation: any = null;
  
  // Dropdown states
  showToolsDropdown = false;
  showColorDropdown = false;
  showSizeDropdown = false;
  
  constructor(
    private modalController: ModalController,
    private alertController: AlertController
  ) {}
  
  async ngOnInit() {
    // Show debug alert with version
    const debugAlert = await this.alertController.create({
      header: 'Annotation Debug v1.4.221',
      message: `FIXED: Multi-annotation support. All drawings will persist.`,
      buttons: ['OK']
    });
    await debugAlert.present();
    setTimeout(() => debugAlert.dismiss(), 2000);
    
    setTimeout(() => this.initializeCanvas(), 100);
  }
  
  async initializeCanvas() {
    
    // Prevent re-initialization that would lose annotations
    if (this.canvasInitialized && this.annotationObjects.length > 0) {
      return;
    }
    
    if (!this.imageCanvas || !this.annotationCanvas) {
      console.error('❌ Canvas elements not found!');
      return;
    }
    
    const imageCanvas = this.imageCanvas.nativeElement;
    const annotationCanvas = this.annotationCanvas.nativeElement;
    
    this.imageCtx = imageCanvas.getContext('2d')!;
    this.annotationCtx = annotationCanvas.getContext('2d')!;
    
    // Create temp canvas for preview (shows current drawing)
    this.tempCanvas = document.createElement('canvas');
    this.tempCtx = this.tempCanvas.getContext('2d')!;
    
    // Create permanent canvas for saved annotations
    this.permanentCanvas = document.createElement('canvas');
    this.permanentCtx = this.permanentCanvas.getContext('2d')!;
    
    // Load the image
    const img = new Image();
    
    if (this.imageFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(this.imageFile);
    } else if (this.imageUrl) {
      img.src = this.imageUrl;
    }
    
    img.onload = () => {
      // Set canvas dimensions to image dimensions
      const maxWidth = this.canvasContainer.nativeElement.clientWidth * 0.9;
      const maxHeight = this.canvasContainer.nativeElement.clientHeight * 0.9;
      
      let width = img.width;
      let height = img.height;
      
      // Scale down if needed
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width *= ratio;
        height *= ratio;
      }
      
      imageCanvas.width = width;
      imageCanvas.height = height;
      annotationCanvas.width = width;
      annotationCanvas.height = height;
      this.tempCanvas.width = width;
      this.tempCanvas.height = height;
      this.permanentCanvas.width = width;
      this.permanentCanvas.height = height;
      
      // Draw the image
      this.imageCtx.drawImage(img, 0, 0, width, height);
      
      // Load existing annotations if any - but ONLY on first load
      // CRITICAL FIX: Don't overwrite annotationObjects if we already have annotations
      if (this.existingAnnotations && this.existingAnnotations.length > 0 && this.annotationObjects.length === 0) {
        this.annotationObjects = [...this.existingAnnotations];
        
        // DEBUG: Show immediate visual feedback
        this.showDebugMessage(`[v1.4.221] Loading ${this.existingAnnotations.length} annotations...`);
        
        // Ensure canvases are ready before drawing
        setTimeout(() => {
          this.redrawAllAnnotationsFixed();
          this.canUndo = true;
          
          // DEBUG: Verify annotations are visible
          this.verifyAnnotationsVisible();
        }, 200);
      } else if (this.annotationObjects.length > 0) {
        setTimeout(() => {
          this.redrawAllAnnotationsFixed();
        }, 200);
      } else {
        this.showDebugMessage('[v1.4.221] Ready to annotate');
      }
      
      // Mark canvas as initialized
      this.canvasInitialized = true;
    };
  }
  
  selectTool(tool: typeof this.currentTool) {
    this.currentTool = tool;
    this.showTextInput = false;
    this.showToolsDropdown = false;
  }
  
  selectColor(color: string) {
    this.currentColor = color;
    this.showColorDropdown = false;
  }
  
  toggleDropdown(dropdown: 'tools' | 'color' | 'size') {
    // Close all dropdowns first
    const prevToolsState = this.showToolsDropdown;
    const prevColorState = this.showColorDropdown;
    const prevSizeState = this.showSizeDropdown;
    
    this.showToolsDropdown = false;
    this.showColorDropdown = false;
    this.showSizeDropdown = false;
    
    // Toggle the selected dropdown
    switch(dropdown) {
      case 'tools':
        this.showToolsDropdown = !prevToolsState;
        break;
      case 'color':
        this.showColorDropdown = !prevColorState;
        break;
      case 'size':
        this.showSizeDropdown = !prevSizeState;
        break;
    }
  }
  
  getToolIcon(tool: string): string {
    const icons: any = {
      'pen': 'brush-outline',
      'arrow': 'arrow-forward-outline',
      'rectangle': 'square-outline',
      'circle': 'ellipse-outline',
      'text': 'text-outline'
    };
    return icons[tool] || 'brush-outline';
  }
  
  getToolName(tool: string): string {
    return tool.charAt(0).toUpperCase() + tool.slice(1);
  }
  
  saveAnnotation(type: string, data: any) {
    
    if (!this.annotationObjects) {
      console.error('❌ [v1.4.221] CRITICAL ERROR: annotationObjects is undefined!');
      this.annotationObjects = [];
    }
    
    const annotation = {
      id: Date.now() + Math.random(), // Unique ID for each annotation
      type,
      data,
      color: this.currentColor,
      strokeWidth: this.strokeWidth,
      timestamp: Date.now()
    };
    
    // Add to array
    this.annotationObjects.push(annotation);
    
    // CRITICAL FIX: Clear temp canvas after saving
    this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
    
    // CRITICAL FIX: Redraw ALL annotations to permanent canvas
    // This ensures nothing gets lost
    this.redrawAllAnnotationsFixed();
    
    this.canUndo = true;
    
    // Show debug message with more detail
    this.showDebugMessage(`[v1.4.221] Saved ${type} | Total: ${this.annotationObjects.length} | Array: ${this.annotationObjects.map(a => a.type).join(', ')}`);
  }
  
  toggleDeleteMode() {
    this.deleteMode = !this.deleteMode;
    if (this.deleteMode) {
      // Exit drawing mode when entering delete mode
      this.isDrawing = false;
      this.showTextInput = false;
      // Close all dropdowns
      this.showToolsDropdown = false;
      this.showColorDropdown = false;
      this.showSizeDropdown = false;
    }
  }
  
  getAnnotationBounds(annotation: any): {x: number, y: number, width: number, height: number} | null {
    switch (annotation.type) {
      case 'pen':
        if (annotation.data.length > 0) {
          let minX = annotation.data[0].x;
          let maxX = annotation.data[0].x;
          let minY = annotation.data[0].y;
          let maxY = annotation.data[0].y;
          for (const point of annotation.data) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
          }
          return {
            x: minX - 10,
            y: minY - 10,
            width: maxX - minX + 20,
            height: maxY - minY + 20
          };
        }
        break;
      case 'arrow':
        return {
          x: Math.min(annotation.data.startX, annotation.data.endX) - 10,
          y: Math.min(annotation.data.startY, annotation.data.endY) - 10,
          width: Math.abs(annotation.data.endX - annotation.data.startX) + 20,
          height: Math.abs(annotation.data.endY - annotation.data.startY) + 20
        };
      case 'rectangle':
        return {
          x: annotation.data.x - 10,
          y: annotation.data.y - 10,
          width: annotation.data.width + 20,
          height: annotation.data.height + 20
        };
      case 'circle':
        return {
          x: annotation.data.centerX - annotation.data.radius - 10,
          y: annotation.data.centerY - annotation.data.radius - 10,
          width: annotation.data.radius * 2 + 20,
          height: annotation.data.radius * 2 + 20
        };
      case 'text':
        // Approximate text bounds
        const textWidth = annotation.data.text.length * 10;
        const textHeight = annotation.strokeWidth * 5;
        return {
          x: annotation.data.x - 10,
          y: annotation.data.y - textHeight - 10,
          width: textWidth + 20,
          height: textHeight + 20
        };
    }
    return null;
  }
  
  findAnnotationAtPoint(x: number, y: number): any {
    // Check annotations in reverse order (top to bottom)
    for (let i = this.annotationObjects.length - 1; i >= 0; i--) {
      const annotation = this.annotationObjects[i];
      const bounds = this.getAnnotationBounds(annotation);
      if (bounds && 
          x >= bounds.x && x <= bounds.x + bounds.width &&
          y >= bounds.y && y <= bounds.y + bounds.height) {
        return annotation;
      }
    }
    return null;
  }
  
  deleteAnnotation(annotation: any) {
    const index = this.annotationObjects.findIndex(a => a.id === annotation.id);
    if (index > -1) {
      this.annotationObjects.splice(index, 1);
      this.redrawAllAnnotations();
      this.canUndo = this.annotationObjects.length > 0;
    }
  }
  
  redrawAllAnnotations() {
    // OLD METHOD - keeping for compatibility but redirecting to fixed version
    this.redrawAllAnnotationsFixed();
  }
  
  redrawAllAnnotationsFixed() {
    
    if (!this.permanentCanvas || !this.permanentCtx) {
      console.error('❌ [v1.4.221] Permanent canvas not initialized!');
      return;
    }
    
    // Clear ONLY the permanent canvas
    this.permanentCtx.clearRect(0, 0, this.permanentCanvas.width, this.permanentCanvas.height);
    
    // Draw ALL annotations to permanent canvas
    for (let i = 0; i < this.annotationObjects.length; i++) {
      const annotation = this.annotationObjects[i];
      
      // Save state before each annotation
      this.permanentCtx.save();
      
      // Draw the annotation to permanent canvas
      this.drawAnnotationToContext(annotation, this.permanentCtx);
      
      // Restore state after each annotation
      this.permanentCtx.restore();
    }
    
    // CRITICAL: Update display canvas to show permanent canvas content
    this.updateDisplayCanvasFixed();
    
    // Verify permanent canvas has content
    const imageData = this.permanentCtx.getImageData(0, 0, this.permanentCanvas.width, this.permanentCanvas.height);
    const hasContent = imageData.data.some((v, i) => i % 4 !== 3 && v !== 0);
  }
  
  drawAnnotationToContext(annotation: any, ctx: CanvasRenderingContext2D) {
    ctx.strokeStyle = annotation.color;
    ctx.lineWidth = annotation.strokeWidth;
    ctx.lineCap = 'round';
    ctx.fillStyle = annotation.color;
    
    switch (annotation.type) {
      case 'pen':
        if (annotation.data.length > 0) {
          ctx.beginPath();
          ctx.moveTo(annotation.data[0].x, annotation.data[0].y);
          for (let i = 1; i < annotation.data.length; i++) {
            ctx.lineTo(annotation.data[i].x, annotation.data[i].y);
          }
          ctx.stroke();
          ctx.closePath();
        }
        break;
      case 'arrow':
        this.drawArrowToContext(ctx, annotation.data.startX, annotation.data.startY, annotation.data.endX, annotation.data.endY);
        break;
      case 'rectangle':
        ctx.strokeRect(
          annotation.data.x,
          annotation.data.y,
          annotation.data.width,
          annotation.data.height
        );
        break;
      case 'circle':
        ctx.beginPath();
        ctx.arc(
          annotation.data.centerX,
          annotation.data.centerY,
          annotation.data.radius,
          0,
          2 * Math.PI
        );
        ctx.stroke();
        ctx.closePath();
        break;
      case 'text':
        ctx.font = `${annotation.strokeWidth * 5}px Arial`;
        ctx.fillText(annotation.data.text, annotation.data.x, annotation.data.y);
        break;
    }
  }
  
  updateDisplayCanvas() {
    // OLD METHOD - redirect to fixed version
    this.updateDisplayCanvasFixed();
  }
  
  updateDisplayCanvasFixed() {
    const canvas = this.annotationCanvas.nativeElement;
    
    // Save current state
    this.annotationCtx.save();
    
    // Clear display canvas
    this.annotationCtx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw permanent annotations from permanent canvas
    this.annotationCtx.drawImage(this.permanentCanvas, 0, 0);
    
    // Restore state
    this.annotationCtx.restore();
    
    // Always draw debug overlays
    this.drawDebugOverlays();
  }
  
  startDrawing(event: MouseEvent) {
    
    // Handle delete mode
    if (this.deleteMode) {
      const annotation = this.findAnnotationAtPoint(event.offsetX, event.offsetY);
      if (annotation) {
        this.deleteAnnotation(annotation);
      }
      return;
    }
    
    if (this.currentTool === 'text') {
      this.showTextInput = true;
      this.textPosition = {
        x: event.offsetX,
        y: event.offsetY
      };
      setTimeout(() => this.textInput?.nativeElement.focus(), 100);
      return;
    }
    
    // No need to save state here anymore
    
    this.isDrawing = true;
    this.startX = event.offsetX;
    this.startY = event.offsetY;
    
    // Clear temp canvas for new drawing
    this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
    
    // Set styles on temp canvas
    this.tempCtx.strokeStyle = this.currentColor;
    this.tempCtx.lineWidth = this.strokeWidth;
    this.tempCtx.lineCap = 'round';
    
    if (this.currentTool === 'pen') {
      this.tempCtx.beginPath();
      this.tempCtx.moveTo(this.startX, this.startY);
      this.currentPath = [{ x: this.startX, y: this.startY }];
    }
  }
  
  draw(event: MouseEvent) {
    // Handle delete mode hover
    if (this.deleteMode && !this.isDrawing) {
      const annotation = this.findAnnotationAtPoint(event.offsetX, event.offsetY);
      if (annotation !== this.hoveredAnnotation) {
        this.hoveredAnnotation = annotation;
        this.redrawAllAnnotations();
        
        // Draw highlight for hovered annotation
        if (annotation) {
          const bounds = this.getAnnotationBounds(annotation);
          if (bounds) {
            this.annotationCtx.strokeStyle = '#FF9800';
            this.annotationCtx.lineWidth = 2;
            this.annotationCtx.setLineDash([5, 5]);
            this.annotationCtx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
            this.annotationCtx.setLineDash([]);
          }
        }
      }
      return;
    }
    
    if (!this.isDrawing) return;
    
    const currentX = event.offsetX;
    const currentY = event.offsetY;
    
    if (this.currentTool === 'pen') {
      // For pen tool, continue drawing on temp canvas
      this.tempCtx.lineTo(currentX, currentY);
      this.tempCtx.stroke();
      this.currentPath.push({ x: currentX, y: currentY });
      
      // Display = permanent + temp (current drawing)
      this.displayCurrentDrawing();
    } else if (this.currentTool !== 'text') {
      // For shapes, draw preview on temp canvas
      
      // Clear temp canvas for redrawing the preview
      this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
      
      // Set styles for preview
      this.tempCtx.strokeStyle = this.currentColor;
      this.tempCtx.lineWidth = this.strokeWidth;
      this.tempCtx.lineCap = 'round';
      
      // Draw preview of current shape on temp canvas
      if (this.currentTool === 'arrow') {
        this.drawArrowToContext(this.tempCtx, this.startX, this.startY, currentX, currentY);
      } else if (this.currentTool === 'rectangle') {
        this.tempCtx.strokeRect(this.startX, this.startY, currentX - this.startX, currentY - this.startY);
      } else if (this.currentTool === 'circle') {
        const radius = Math.sqrt(Math.pow(currentX - this.startX, 2) + Math.pow(currentY - this.startY, 2));
        this.tempCtx.beginPath();
        this.tempCtx.arc(this.startX, this.startY, radius, 0, 2 * Math.PI);
        this.tempCtx.stroke();
      }
      
      // Display = permanent + temp (current preview)
      this.displayCurrentDrawing();
    }
  }
  
  // FIXED method to properly display permanent + temp canvases
  displayCurrentDrawing() {
    const canvas = this.annotationCanvas.nativeElement;
    
    // Save state
    this.annotationCtx.save();
    
    // Clear display canvas
    this.annotationCtx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw permanent annotations first (all saved annotations)
    this.annotationCtx.drawImage(this.permanentCanvas, 0, 0);
    
    // Draw current temp drawing on top (what user is currently drawing)
    this.annotationCtx.drawImage(this.tempCanvas, 0, 0);
    
    // Restore state
    this.annotationCtx.restore();
    
    // Always draw debug overlays
    this.drawDebugOverlays();
  }
  
  stopDrawing(event: MouseEvent) {
    if (!this.isDrawing) return;
    
    this.isDrawing = false;
    const endX = event.offsetX;
    const endY = event.offsetY;
    
    // Clear temp canvas
    this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
    
    // Save annotation as object
    if (this.currentTool === 'pen' && this.currentPath.length > 0) {
      this.saveAnnotation('pen', [...this.currentPath]);
      this.currentPath = [];
    } else if (this.currentTool === 'arrow') {
      // Only save if we actually drew something (not just a click)
      const distance = Math.sqrt(Math.pow(endX - this.startX, 2) + Math.pow(endY - this.startY, 2));
      if (distance > 5) {
        this.saveAnnotation('arrow', {
          startX: this.startX,
          startY: this.startY,
          endX: endX,
          endY: endY
        });
      }
    } else if (this.currentTool === 'rectangle') {
      // Only save if we actually drew something
      const width = Math.abs(endX - this.startX);
      const height = Math.abs(endY - this.startY);
      if (width > 5 || height > 5) {
        this.saveAnnotation('rectangle', {
          x: Math.min(this.startX, endX),
          y: Math.min(this.startY, endY),
          width: width,
          height: height
        });
      }
    } else if (this.currentTool === 'circle') {
      const radius = Math.sqrt(Math.pow(endX - this.startX, 2) + Math.pow(endY - this.startY, 2));
      if (radius > 5) {
        this.saveAnnotation('circle', {
          centerX: this.startX,
          centerY: this.startY,
          radius: radius
        });
      }
    }
    
    // FIXED: Ensure display shows all annotations after drawing completes
    this.redrawAllAnnotationsFixed();
  }
  
  handleTouch(event: TouchEvent) {
    event.preventDefault();
    const touch = event.touches[0];
    if (!touch) return;
    
    const rect = this.annotationCanvas.nativeElement.getBoundingClientRect();
    const offsetX = touch.clientX - rect.left;
    const offsetY = touch.clientY - rect.top;
    
    const mouseEvent = new MouseEvent(event.type.replace('touch', 'mouse'), {
      clientX: touch.clientX,
      clientY: touch.clientY,
      bubbles: true
    });
    
    Object.defineProperty(mouseEvent, 'offsetX', { value: offsetX });
    Object.defineProperty(mouseEvent, 'offsetY', { value: offsetY });
    
    if (event.type === 'touchstart') {
      this.startDrawing(mouseEvent);
    } else if (event.type === 'touchmove') {
      this.draw(mouseEvent);
    } else if (event.type === 'touchend') {
      this.stopDrawing(mouseEvent);
    }
  }
  
  drawArrow(fromX: number, fromY: number, toX: number, toY: number) {
    this.drawArrowToContext(this.annotationCtx, fromX, fromY, toX, toY);
  }
  
  drawArrowToContext(ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number) {
    const headLength = 15;
    const angle = Math.atan2(toY - fromY, toX - fromX);
    
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    
    // Draw arrowhead
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLength * Math.cos(angle - Math.PI / 6), toY - headLength * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLength * Math.cos(angle + Math.PI / 6), toY - headLength * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }
  
  drawRectangle(x: number, y: number, width: number, height: number) {
    this.annotationCtx.strokeRect(x, y, width, height);
  }
  
  drawCircle(x: number, y: number, radius: number) {
    this.annotationCtx.beginPath();
    this.annotationCtx.arc(x, y, radius, 0, 2 * Math.PI);
    this.annotationCtx.stroke();
  }
  
  addText() {
    if (!this.currentText.trim()) {
      this.cancelText();
      return;
    }
    
    this.saveAnnotation('text', {
      text: this.currentText,
      x: this.textPosition.x,
      y: this.textPosition.y
    });
    
    // Redraw all including new text
    this.redrawAllAnnotations();
    
    this.showTextInput = false;
    this.currentText = '';
  }
  
  cancelText() {
    this.showTextInput = false;
    this.currentText = '';
  }
  
  undo() {
    if (this.annotationObjects.length > 0) {
      // Remove the last annotation
      const removed = this.annotationObjects.pop();
      // Redraw all remaining annotations
      this.redrawAllAnnotations();
      this.canUndo = this.annotationObjects.length > 0;
    }
  }
  
  clearAnnotations() {
    // Clear all canvases
    const canvas = this.annotationCanvas.nativeElement;
    this.annotationCtx.clearRect(0, 0, canvas.width, canvas.height);
    this.permanentCtx.clearRect(0, 0, this.permanentCanvas.width, this.permanentCanvas.height);
    this.tempCtx.clearRect(0, 0, this.tempCanvas.width, this.tempCanvas.height);
    this.annotationObjects = [];
    this.canUndo = false;
  }

  async addCaption() {
    const alert = await this.alertController.create({
      header: 'Add Caption',
      inputs: [
        {
          name: 'caption',
          type: 'text',
          placeholder: 'Enter caption...',
          value: this.photoCaption || '',
          attributes: {
            maxlength: 255
          }
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Save',
          handler: (data) => {
            if (data.caption !== undefined) {
              this.photoCaption = data.caption;
              // The caption will be included when saving the image
            }
          }
        }
      ]
    });

    await alert.present();
  }
  
  
  async saveAnnotatedImage() {
    // Create a combined canvas
    const combinedCanvas = document.createElement('canvas');
    const imageCanvas = this.imageCanvas.nativeElement;
    const annotationCanvas = this.annotationCanvas.nativeElement;
    
    combinedCanvas.width = imageCanvas.width;
    combinedCanvas.height = imageCanvas.height;
    
    const ctx = combinedCanvas.getContext('2d')!;
    
    // Draw the original image
    ctx.drawImage(imageCanvas, 0, 0);
    
    // Draw the annotations on top
    ctx.drawImage(annotationCanvas, 0, 0);
    
    // Convert to blob
    combinedCanvas.toBlob((blob) => {
      if (blob) {
        this.annotatedImage.emit(blob);
        this.annotationsData.emit(this.annotationObjects);
        // Pass both blob and annotations data
        this.dismiss({
          annotatedBlob: blob,
          annotationsData: this.annotationObjects,
          caption: this.photoCaption
        });
      }
    }, 'image/jpeg', 0.9);
  }
  
  dismiss(data?: any) {
    this.modalController.dismiss(data);
  }
  
  // DEBUG METHODS FOR v1.4.221
  private showDebugMessage(message: string) {
    
    // Also update the debug overlays to show current state
    if (this.annotationCanvas?.nativeElement) {
      this.drawDebugOverlays();
    }
  }
  
  private drawDebugOverlays() {
    if (!this.annotationCanvas?.nativeElement || !this.annotationCtx) {
      console.error('❌ [v1.4.221] Cannot draw debug overlays - canvas not ready');
      return;
    }
    
    const canvas = this.annotationCanvas.nativeElement;
    
    // Debug: Check if annotationObjects exists
    const annotationCount = this.annotationObjects ? this.annotationObjects.length : 0;
    
    // Debug overlays removed - clean production UI
  }
  
  private verifyAnnotationsVisible() {
    const canvas = this.annotationCanvas?.nativeElement;
    if (!canvas) {
      console.error('❌ No annotation canvas found!');
      return;
    }
    
    // Check if anything is drawn on the canvas
    const imageData = this.annotationCtx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let hasContent = false;
    
    // Check if there are any non-transparent pixels
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) { // Alpha channel
        hasContent = true;
        break;
      }
    }
    
    if (!hasContent && this.annotationObjects.length > 0) {
      console.error('⚠️ Annotations exist but canvas is empty! Attempting re-draw...');
      // Try a simpler direct draw approach
      this.forceRedrawAnnotations();
    }
  }
  
  private forceRedrawAnnotations() {
    
    const canvas = this.annotationCanvas?.nativeElement;
    if (!canvas || !this.annotationCtx) return;
    
    // Clear and draw directly to display canvas
    this.annotationCtx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw debug grid
    this.annotationCtx.strokeStyle = 'rgba(0, 255, 0, 0.2)';
    this.annotationCtx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 50) {
      this.annotationCtx.beginPath();
      this.annotationCtx.moveTo(x, 0);
      this.annotationCtx.lineTo(x, canvas.height);
      this.annotationCtx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 50) {
      this.annotationCtx.beginPath();
      this.annotationCtx.moveTo(0, y);
      this.annotationCtx.lineTo(canvas.width, y);
      this.annotationCtx.stroke();
    }
    
    // Draw annotations directly
    for (const annotation of this.annotationObjects) {
      this.drawAnnotationToContext(annotation, this.annotationCtx);
    }
    
    // Add debug text
    this.annotationCtx.fillStyle = '#FF0000';
    this.annotationCtx.font = 'bold 20px Arial';
    this.annotationCtx.fillText(`[v1.4.213] Force Draw: ${this.annotationObjects.length} annotations`, 10, 40);
  }
}