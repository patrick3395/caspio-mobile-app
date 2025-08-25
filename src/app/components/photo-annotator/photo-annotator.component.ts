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
      <ion-toolbar color="primary">
        <ion-title>Annotate Photo</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">
            <ion-icon name="close"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    
    <ion-content>
      <div class="annotation-toolbar">
        <div class="tool-group">
          <button [class.active]="currentTool === 'pen'" (click)="selectTool('pen')" class="tool-btn">
            <ion-icon name="pencil"></ion-icon>
            <span>Draw</span>
          </button>
          <button [class.active]="currentTool === 'arrow'" (click)="selectTool('arrow')" class="tool-btn">
            <ion-icon name="arrow-forward"></ion-icon>
            <span>Arrow</span>
          </button>
          <button [class.active]="currentTool === 'rectangle'" (click)="selectTool('rectangle')" class="tool-btn">
            <ion-icon name="square-outline"></ion-icon>
            <span>Box</span>
          </button>
          <button [class.active]="currentTool === 'circle'" (click)="selectTool('circle')" class="tool-btn">
            <ion-icon name="ellipse-outline"></ion-icon>
            <span>Circle</span>
          </button>
          <button [class.active]="currentTool === 'text'" (click)="selectTool('text')" class="tool-btn">
            <ion-icon name="text"></ion-icon>
            <span>Text</span>
          </button>
        </div>
        
        <div class="tool-group">
          <div class="color-picker">
            <label>Color:</label>
            <button *ngFor="let color of colors" 
                    [style.background]="color" 
                    [class.active]="currentColor === color"
                    (click)="selectColor(color)" 
                    class="color-btn"></button>
          </div>
          
          <div class="stroke-picker">
            <label>Size:</label>
            <input type="range" min="2" max="20" [(ngModel)]="strokeWidth" class="stroke-slider">
            <span>{{strokeWidth}}px</span>
          </div>
        </div>
        
        <div class="tool-group">
          <button (click)="undo()" [disabled]="!canUndo" class="action-btn">
            <ion-icon name="arrow-undo"></ion-icon>
            <span>Undo</span>
          </button>
          <button (click)="clearAnnotations()" class="action-btn">
            <ion-icon name="trash"></ion-icon>
            <span>Clear</span>
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
      background: #f8f8f8;
      padding: 10px;
      border-bottom: 1px solid #ddd;
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
      align-items: center;
    }
    
    .tool-group {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    
    .tool-btn, .action-btn {
      background: white;
      border: 2px solid #ddd;
      border-radius: 8px;
      padding: 8px 12px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      transition: all 0.3s;
    }
    
    .tool-btn.active, .tool-btn:hover, .action-btn:hover:not(:disabled) {
      border-color: var(--ion-color-primary);
      background: var(--ion-color-primary-tint);
    }
    
    .tool-btn ion-icon, .action-btn ion-icon {
      font-size: 20px;
    }
    
    .tool-btn span, .action-btn span {
      font-size: 10px;
    }
    
    .action-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .color-picker {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .color-picker label {
      font-size: 14px;
      font-weight: 600;
    }
    
    .color-btn {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 2px solid #fff;
      box-shadow: 0 0 0 1px #ddd;
      cursor: pointer;
      transition: all 0.3s;
    }
    
    .color-btn.active {
      box-shadow: 0 0 0 2px var(--ion-color-primary);
      transform: scale(1.2);
    }
    
    .stroke-picker {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .stroke-picker label {
      font-size: 14px;
      font-weight: 600;
    }
    
    .stroke-slider {
      width: 100px;
    }
    
    .stroke-picker span {
      font-size: 12px;
      min-width: 40px;
    }
    
    .canvas-container {
      position: relative;
      width: 100%;
      height: calc(100% - 80px);
      overflow: auto;
      background: #333;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    canvas {
      position: absolute;
      max-width: 100%;
      max-height: 100%;
      cursor: crosshair;
    }
    
    #imageCanvas {
      z-index: 1;
    }
    
    #annotationCanvas {
      z-index: 2;
    }
    
    .text-input-overlay {
      position: absolute;
      z-index: 3;
    }
    
    .text-input-overlay input {
      padding: 4px 8px;
      border: 2px solid var(--ion-color-primary);
      border-radius: 4px;
      background: white;
      font-size: 16px;
      min-width: 150px;
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
      this.annotationCtx.lineTo(currentX, currentY);
      this.annotationCtx.stroke();
    }
  }
  
  stopDrawing(event: MouseEvent) {
    if (!this.isDrawing) return;
    
    const endX = event.offsetX;
    const endY = event.offsetY;
    
    if (this.currentTool === 'arrow') {
      this.drawArrow(this.startX, this.startY, endX, endY);
    } else if (this.currentTool === 'rectangle') {
      this.drawRectangle(this.startX, this.startY, endX - this.startX, endY - this.startY);
    } else if (this.currentTool === 'circle') {
      const radius = Math.sqrt(Math.pow(endX - this.startX, 2) + Math.pow(endY - this.startY, 2));
      this.drawCircle(this.startX, this.startY, radius);
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