import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';

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
        <div class="toolbar-section tools">
          <div class="section-label">Tools</div>
          <div class="tool-group">
            <button [class.active]="currentTool === 'pen'" (click)="selectTool('pen')" class="tool-btn">
              <ion-icon name="brush-outline"></ion-icon>
            </button>
            <button [class.active]="currentTool === 'arrow'" (click)="selectTool('arrow')" class="tool-btn">
              <ion-icon name="arrow-forward-outline"></ion-icon>
            </button>
            <button [class.active]="currentTool === 'rectangle'" (click)="selectTool('rectangle')" class="tool-btn">
              <ion-icon name="square-outline"></ion-icon>
            </button>
            <button [class.active]="currentTool === 'circle'" (click)="selectTool('circle')" class="tool-btn">
              <ion-icon name="ellipse-outline"></ion-icon>
            </button>
            <button [class.active]="currentTool === 'text'" (click)="selectTool('text')" class="tool-btn">
              <ion-icon name="text-outline"></ion-icon>
            </button>
          </div>
        </div>
        
        <div class="toolbar-section colors">
          <div class="section-label">Color</div>
          <div class="color-group">
            <button *ngFor="let color of colors" 
                    [style.background]="color" 
                    [class.active]="currentColor === color"
                    (click)="selectColor(color)" 
                    class="color-btn"
                    [style.border-color]="color === '#FFFFFF' ? '#ddd' : color"></button>
          </div>
        </div>
        
        <div class="toolbar-section stroke">
          <div class="section-label">Size</div>
          <div class="stroke-group">
            <input type="range" min="2" max="20" [(ngModel)]="strokeWidth" class="stroke-slider">
            <span class="stroke-value">{{strokeWidth}}</span>
          </div>
        </div>
        
        <div class="toolbar-section actions">
          <button (click)="undo()" [disabled]="!canUndo" class="action-btn undo">
            <ion-icon name="arrow-undo-outline"></ion-icon>
          </button>
          <button (click)="clearAnnotations()" class="action-btn clear">
            <ion-icon name="trash-outline"></ion-icon>
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
      gap: 24px;
      align-items: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.05);
    }
    
    .toolbar-section {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .section-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: #8492a6;
      letter-spacing: 0.5px;
    }
    
    .tool-group {
      display: flex;
      gap: 4px;
      background: rgba(255,255,255,0.8);
      padding: 4px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    
    .tool-btn {
      width: 40px;
      height: 40px;
      border: none;
      background: transparent;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      position: relative;
    }
    
    .tool-btn ion-icon {
      font-size: 22px;
      color: #5f6c7b;
    }
    
    .tool-btn:hover {
      background: rgba(241, 90, 39, 0.1);
    }
    
    .tool-btn.active {
      background: #F15A27;
      box-shadow: 0 4px 12px rgba(241, 90, 39, 0.3);
    }
    
    .tool-btn.active ion-icon {
      color: white;
    }
    
    .color-group {
      display: flex;
      gap: 6px;
      padding: 4px;
      background: rgba(255,255,255,0.8);
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    
    .color-btn {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      border: 2px solid transparent;
      cursor: pointer;
      transition: all 0.2s ease;
      position: relative;
    }
    
    .color-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    
    .color-btn.active {
      border-color: #F15A27 !important;
      transform: scale(1.15);
      box-shadow: 0 4px 12px rgba(241, 90, 39, 0.3);
    }
    
    .color-btn.active::after {
      content: '✓';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: white;
      font-size: 14px;
      font-weight: bold;
      text-shadow: 0 1px 2px rgba(0,0,0,0.3);
    }
    
    .stroke-group {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      background: rgba(255,255,255,0.8);
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    
    .stroke-slider {
      width: 120px;
      height: 4px;
      -webkit-appearance: none;
      appearance: none;
      background: #e3e8ee;
      border-radius: 2px;
      outline: none;
    }
    
    .stroke-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 20px;
      height: 20px;
      background: #F15A27;
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(241, 90, 39, 0.3);
    }
    
    .stroke-value {
      font-size: 12px;
      font-weight: 600;
      color: #F15A27;
      min-width: 30px;
      text-align: center;
    }
    
    .action-btn {
      width: 40px;
      height: 40px;
      border: none;
      background: rgba(255,255,255,0.8);
      border-radius: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    
    .action-btn ion-icon {
      font-size: 22px;
      color: #5f6c7b;
    }
    
    .action-btn.undo:hover:not(:disabled) {
      background: rgba(241, 90, 39, 0.1);
      box-shadow: 0 4px 12px rgba(241, 90, 39, 0.2);
    }
    
    .action-btn.clear:hover {
      background: rgba(239, 71, 111, 0.1);
      box-shadow: 0 4px 12px rgba(239, 71, 111, 0.2);
    }
    
    .action-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
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
  @Output() annotatedImage = new EventEmitter<Blob>();
  
  @ViewChild('imageCanvas') imageCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('annotationCanvas') annotationCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvasContainer') canvasContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('textInput') textInput!: ElementRef<HTMLInputElement>;
  
  private imageCtx!: CanvasRenderingContext2D;
  private annotationCtx!: CanvasRenderingContext2D;
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private annotations: any[] = [];
  private currentPath: any[] = [];
  private tempCanvas!: HTMLCanvasElement;
  private tempCtx!: CanvasRenderingContext2D;
  
  currentTool: 'pen' | 'arrow' | 'rectangle' | 'circle' | 'text' = 'pen';
  currentColor = '#FF0000';
  strokeWidth = 3;
  colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#000000', '#FFFFFF'];
  
  showTextInput = false;
  textPosition = { x: 0, y: 0 };
  currentText = '';
  
  canUndo = false;
  
  constructor(private modalController: ModalController) {}
  
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
    };
  }
  
  selectTool(tool: typeof this.currentTool) {
    this.currentTool = tool;
    this.showTextInput = false;
  }
  
  selectColor(color: string) {
    this.currentColor = color;
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
    
    this.isDrawing = true;
    this.startX = event.offsetX;
    this.startY = event.offsetY;
    
    this.annotationCtx.strokeStyle = this.currentColor;
    this.annotationCtx.lineWidth = this.strokeWidth;
    this.annotationCtx.lineCap = 'round';
    
    if (this.currentTool === 'pen') {
      this.annotationCtx.beginPath();
      this.annotationCtx.moveTo(this.startX, this.startY);
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
      if (this.annotations.length > 0) {
        this.annotationCtx.putImageData(this.annotations[this.annotations.length - 1], 0, 0);
      }
      
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
    
    const endX = event.offsetX;
    const endY = event.offsetY;
    
    // Shapes are already drawn in the draw method, just need to save
    // Only need to redraw for pen tool completion
    if (this.currentTool === 'pen') {
      this.currentPath = [];
    }
    
    this.isDrawing = false;
    this.saveAnnotation();
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
    
    const ctx = this.annotationCtx;
    ctx.font = `${this.strokeWidth * 5}px Arial`;
    ctx.fillStyle = this.currentColor;
    ctx.fillText(this.currentText, this.textPosition.x, this.textPosition.y);
    
    this.showTextInput = false;
    this.currentText = '';
    this.saveAnnotation();
  }
  
  cancelText() {
    this.showTextInput = false;
    this.currentText = '';
  }
  
  saveAnnotation() {
    const canvas = this.annotationCanvas.nativeElement;
    const imageData = this.annotationCtx.getImageData(0, 0, canvas.width, canvas.height);
    this.annotations.push(imageData);
    this.canUndo = true;
  }
  
  undo() {
    if (this.annotations.length > 0) {
      this.annotations.pop();
      this.redrawAnnotations();
    }
    this.canUndo = this.annotations.length > 0;
  }
  
  clearAnnotations() {
    const canvas = this.annotationCanvas.nativeElement;
    this.annotationCtx.clearRect(0, 0, canvas.width, canvas.height);
    this.annotations = [];
    this.canUndo = false;
  }
  
  redrawAnnotations() {
    const canvas = this.annotationCanvas.nativeElement;
    this.annotationCtx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (this.annotations.length > 0) {
      this.annotationCtx.putImageData(this.annotations[this.annotations.length - 1], 0, 0);
    }
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
        this.dismiss(blob);
      }
    }, 'image/jpeg', 0.9);
  }
  
  dismiss(data?: any) {
    this.modalController.dismiss(data);
  }
}