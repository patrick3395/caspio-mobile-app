import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, AlertController } from '@ionic/angular';

@Component({
  selector: 'app-photo-annotator',
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
          <button (click)="undo()" [disabled]="!canUndo" class="action-btn undo" title="Undo Last">
            <ion-icon name="arrow-undo-outline"></ion-icon>
            <span class="btn-label">Back</span>
          </button>
          <button (click)="clearAnnotations()" class="action-btn clear" title="Clear All">
            <ion-icon name="trash-outline"></ion-icon>
            <span class="btn-label">Clear</span>
          </button>
        </div>
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
    </ion-content>
    
    <ion-footer>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="dismiss()" color="medium">
            Cancel
          </ion-button>
        </ion-buttons>
        <ion-buttons slot="start">
          <ion-button (click)="addCaption()" color="medium">
            Add Caption
          </ion-button>
        </ion-buttons>
        <ion-buttons slot="end">
          <ion-button (click)="saveAnnotatedImage()" color="primary">
            <ion-icon name="checkmark" slot="start"></ion-icon>
            Save & Upload
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-footer>
  `,
  styles: [`
    .annotation-toolbar {
      background: linear-gradient(135deg, #ffffff 0%, #f5f7fa 100%);
      padding: 12px 16px;
      border-bottom: 1px solid rgba(0,0,0,0.08);
      display: flex;
      gap: 12px;
      align-items: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.05);
      position: relative;
      z-index: 100;
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
      background: #f5f5f5;
      border-color: #F15A27;
    }
    
    .dropdown-toggle.active {
      background: #FFF5F2;
      border-color: #F15A27;
      color: #F15A27;
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
      gap: 8px;
      margin-left: auto;
    }
    
    .action-btn {
      padding: 8px 12px;
      min-width: 60px;
      height: 40px;
      border: none;
      background: rgba(255,255,255,0.8);
      border-radius: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    
    .action-btn .btn-label {
      font-size: 12px;
      font-weight: 600;
      color: #5f6c7b;
    }
    
    .action-btn ion-icon {
      font-size: 18px;
      color: #5f6c7b;
    }
    
    .action-btn.undo:hover:not(:disabled) {
      background: rgba(241, 90, 39, 0.1);
      box-shadow: 0 4px 12px rgba(241, 90, 39, 0.2);
    }
    
    .action-btn.undo:hover:not(:disabled) .btn-label,
    .action-btn.undo:hover:not(:disabled) ion-icon {
      color: #F15A27;
    }
    
    .action-btn.clear:hover {
      background: rgba(239, 71, 111, 0.1);
      box-shadow: 0 4px 12px rgba(239, 71, 111, 0.2);
    }
    
    .action-btn.clear:hover .btn-label,
    .action-btn.clear:hover ion-icon {
      color: #EF476F;
    }
    
    .action-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }
    
    .action-btn:disabled .btn-label {
      color: #a0a9b8;
    }
    
    .canvas-container {
      position: relative;
      width: 100%;
      height: calc(100% - 80px);
      overflow: auto;
      background: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    
    canvas {
      position: absolute;
      max-width: calc(100% - 40px);
      max-height: calc(100% - 40px);
      cursor: crosshair;
      border-radius: 8px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
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
    
    ion-footer ion-toolbar {
      --background: linear-gradient(135deg, #ffffff 0%, #f5f7fa 100%);
      box-shadow: 0 -2px 10px rgba(0,0,0,0.05);
    }
    
    ion-footer ion-button {
      --border-radius: 8px;
      font-weight: 600;
      letter-spacing: 0.5px;
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
  private currentPath: any[] = [];
  private tempCanvas!: HTMLCanvasElement;
  private tempCtx!: CanvasRenderingContext2D;
  
  currentTool: 'pen' | 'arrow' | 'rectangle' | 'circle' | 'text' = 'pen';
  currentColor = '#FF0000';
  strokeWidth = 3;
  colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#000000', '#FFFFFF', '#F15A27', '#FFA500', '#800080', '#808080'];
  
  showTextInput = false;
  textPosition = { x: 0, y: 0 };
  currentText = '';
  photoCaption = '';
  
  canUndo = false;
  
  // Dropdown states
  showToolsDropdown = false;
  showColorDropdown = false;
  showSizeDropdown = false;
  
  constructor(
    private modalController: ModalController,
    private alertController: AlertController
  ) {}
  
  ngOnInit() {
    setTimeout(() => this.initializeCanvas(), 100);
  }
  
  async initializeCanvas() {
    if (!this.imageCanvas || !this.annotationCanvas) return;
    
    const imageCanvas = this.imageCanvas.nativeElement;
    const annotationCanvas = this.annotationCanvas.nativeElement;
    
    this.imageCtx = imageCanvas.getContext('2d')!;
    this.annotationCtx = annotationCanvas.getContext('2d')!;
    
    // Create temp canvas for preview
    this.tempCanvas = document.createElement('canvas');
    this.tempCtx = this.tempCanvas.getContext('2d')!;
    
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
      
      // Draw the image
      this.imageCtx.drawImage(img, 0, 0, width, height);
      
      // Load existing annotations if any
      if (this.existingAnnotations && this.existingAnnotations.length > 0) {
        this.annotationObjects = [...this.existingAnnotations];
        this.redrawAllAnnotations();
        this.canUndo = true;
      }
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
    const annotation = {
      type,
      data,
      color: this.currentColor,
      strokeWidth: this.strokeWidth,
      timestamp: Date.now()
    };
    this.annotationObjects.push(annotation);
    this.canUndo = true;
    console.log('📝 Annotation saved:', type, 'Total annotations:', this.annotationObjects.length);
  }
  
  redrawAllAnnotations() {
    const canvas = this.annotationCanvas.nativeElement;
    this.annotationCtx.clearRect(0, 0, canvas.width, canvas.height);
    
    console.log('🔄 Redrawing all annotations. Count:', this.annotationObjects.length);
    
    for (const annotation of this.annotationObjects) {
      this.annotationCtx.strokeStyle = annotation.color;
      this.annotationCtx.lineWidth = annotation.strokeWidth;
      this.annotationCtx.lineCap = 'round';
      this.annotationCtx.fillStyle = annotation.color;
      
      switch (annotation.type) {
        case 'pen':
          if (annotation.data.length > 0) {
            this.annotationCtx.beginPath();
            this.annotationCtx.moveTo(annotation.data[0].x, annotation.data[0].y);
            for (let i = 1; i < annotation.data.length; i++) {
              this.annotationCtx.lineTo(annotation.data[i].x, annotation.data[i].y);
            }
            this.annotationCtx.stroke();
            this.annotationCtx.closePath();
          }
          break;
        case 'arrow':
          this.drawArrow(annotation.data.startX, annotation.data.startY, annotation.data.endX, annotation.data.endY);
          break;
        case 'rectangle':
          this.annotationCtx.strokeRect(
            annotation.data.x,
            annotation.data.y,
            annotation.data.width,
            annotation.data.height
          );
          break;
        case 'circle':
          this.annotationCtx.beginPath();
          this.annotationCtx.arc(
            annotation.data.centerX,
            annotation.data.centerY,
            annotation.data.radius,
            0,
            2 * Math.PI
          );
          this.annotationCtx.stroke();
          this.annotationCtx.closePath();
          break;
        case 'text':
          this.annotationCtx.font = `${annotation.strokeWidth * 5}px Arial`;
          this.annotationCtx.fillText(annotation.data.text, annotation.data.x, annotation.data.y);
          break;
      }
    }
  }
  
  startDrawing(event: MouseEvent) {
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
    
    this.annotationCtx.strokeStyle = this.currentColor;
    this.annotationCtx.lineWidth = this.strokeWidth;
    this.annotationCtx.lineCap = 'round';
    
    if (this.currentTool === 'pen') {
      this.annotationCtx.beginPath();
      this.annotationCtx.moveTo(this.startX, this.startY);
      this.currentPath = [{ x: this.startX, y: this.startY }];
    }
  }
  
  draw(event: MouseEvent) {
    if (!this.isDrawing) return;
    
    const currentX = event.offsetX;
    const currentY = event.offsetY;
    
    if (this.currentTool === 'pen') {
      // For pen tool, draw directly
      this.annotationCtx.lineTo(currentX, currentY);
      this.annotationCtx.stroke();
      this.currentPath.push({ x: currentX, y: currentY });
    } else if (this.currentTool !== 'text') {
      // For shapes, use a preview approach
      const canvas = this.annotationCanvas.nativeElement;
      
      // Clear canvas
      this.annotationCtx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Redraw all saved annotations
      this.redrawAllAnnotations();
      
      // Set styles for preview
      this.annotationCtx.strokeStyle = this.currentColor;
      this.annotationCtx.lineWidth = this.strokeWidth;
      this.annotationCtx.lineCap = 'round';
      
      // Draw preview of current shape
      if (this.currentTool === 'arrow') {
        this.drawArrow(this.startX, this.startY, currentX, currentY);
      } else if (this.currentTool === 'rectangle') {
        this.annotationCtx.strokeRect(this.startX, this.startY, currentX - this.startX, currentY - this.startY);
      } else if (this.currentTool === 'circle') {
        const radius = Math.sqrt(Math.pow(currentX - this.startX, 2) + Math.pow(currentY - this.startY, 2));
        this.annotationCtx.beginPath();
        this.annotationCtx.arc(this.startX, this.startY, radius, 0, 2 * Math.PI);
        this.annotationCtx.stroke();
      }
    }
  }
  
  stopDrawing(event: MouseEvent) {
    if (!this.isDrawing) return;
    
    this.isDrawing = false;
    const endX = event.offsetX;
    const endY = event.offsetY;
    
    console.log('🛑 Stop drawing:', this.currentTool);
    
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
    
    // Redraw to ensure everything is clean
    this.redrawAllAnnotations();
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
    const ctx = this.annotationCtx;
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
    console.log('⬅️ Undo called. Current annotations:', this.annotationObjects.length);
    if (this.annotationObjects.length > 0) {
      // Remove the last annotation
      const removed = this.annotationObjects.pop();
      console.log('❌ Removed annotation:', removed?.type);
      // Redraw all remaining annotations
      this.redrawAllAnnotations();
      this.canUndo = this.annotationObjects.length > 0;
    }
  }
  
  clearAnnotations() {
    const canvas = this.annotationCanvas.nativeElement;
    this.annotationCtx.clearRect(0, 0, canvas.width, canvas.height);
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
        this.dismiss(blob);
      }
    }, 'image/jpeg', 0.9);
  }
  
  dismiss(data?: any) {
    this.modalController.dismiss(data);
  }
}