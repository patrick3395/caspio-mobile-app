import { Component, Input, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-annotation-modal',
  templateUrl: './annotation-modal.component.html',
  styleUrls: ['./annotation-modal.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, FormsModule]
})
export class AnnotationModalComponent implements OnInit, OnDestroy, AfterViewInit {
  @Input() imageUrl: string = '';
  @Input() photoName: string = '';

  @ViewChild('canvas', { static: false }) canvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('imageElement', { static: false }) imageElement!: ElementRef<HTMLImageElement>;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private isDrawing = false;
  private startX = 0;
  private startY = 0;

  selectedTool: 'arrow' | 'circle' | 'rectangle' | 'pen' | 'text' = 'arrow';
  selectedColor = '#FF0000';
  lineWidth = 3;

  // Store all annotations
  private annotations: any[] = [];
  private currentAnnotation: any = null;

  // Text annotation
  isAddingText = false;
  textInput = '';
  textPosition = { x: 0, y: 0 };

  // Keyboard navigation support (web only) - G2-FORMS-003
  private isWeb = environment.isWeb;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private modalController: ModalController) {}

  ngOnInit() {
    // Initialize keyboard navigation (web only) - G2-FORMS-003
    if (this.isWeb) {
      this.keydownHandler = (event: KeyboardEvent) => {
        // Escape key closes modal
        if (event.key === 'Escape') {
          event.preventDefault();
          this.cancel();
        }
      };
      document.addEventListener('keydown', this.keydownHandler);
    }
  }

  ngOnDestroy() {
    // Clean up keyboard handler
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }

  ngAfterViewInit() {
    this.setupCanvas();
  }

  setupCanvas() {
    this.canvas = this.canvasElement.nativeElement;
    this.ctx = this.canvas.getContext('2d')!;
    
    // Wait for image to load
    const img = this.imageElement.nativeElement;
    img.onload = () => {
      // Set canvas size to match image
      this.canvas.width = img.naturalWidth;
      this.canvas.height = img.naturalHeight;
      
      // Draw image on canvas
      this.drawImage();
      
      // Setup touch/mouse events
      this.setupEventListeners();
    };
  }

  drawImage() {
    const img = this.imageElement.nativeElement;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(img, 0, 0);
    
    // Redraw all annotations
    this.redrawAnnotations();
  }

  setupEventListeners() {
    // Mouse events
    this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
    this.canvas.addEventListener('mousemove', (e) => this.draw(e));
    this.canvas.addEventListener('mouseup', () => this.stopDrawing());
    
    // Touch events for mobile
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      const mouseEvent = new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      this.startDrawing(mouseEvent);
    });
    
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      const rect = this.canvas.getBoundingClientRect();
      const mouseEvent = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY
      });
      this.draw(mouseEvent);
    });
    
    this.canvas.addEventListener('touchend', () => this.stopDrawing());
  }

  startDrawing(e: MouseEvent) {
    if (this.selectedTool === 'text') {
      const rect = this.canvas.getBoundingClientRect();
      this.textPosition = {
        x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
        y: (e.clientY - rect.top) * (this.canvas.height / rect.height)
      };
      this.isAddingText = true;
      return;
    }
    
    this.isDrawing = true;
    const rect = this.canvas.getBoundingClientRect();
    this.startX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
    this.startY = (e.clientY - rect.top) * (this.canvas.height / rect.height);
    
    if (this.selectedTool === 'pen') {
      this.currentAnnotation = {
        type: 'pen',
        points: [{ x: this.startX, y: this.startY }],
        color: this.selectedColor,
        width: this.lineWidth
      };
    }
  }

  draw(e: MouseEvent) {
    if (!this.isDrawing) return;
    
    const rect = this.canvas.getBoundingClientRect();
    const currentX = (e.clientX - rect.left) * (this.canvas.width / rect.width);
    const currentY = (e.clientY - rect.top) * (this.canvas.height / rect.height);
    
    // Clear and redraw everything
    this.drawImage();
    
    this.ctx.strokeStyle = this.selectedColor;
    this.ctx.lineWidth = this.lineWidth;
    this.ctx.lineCap = 'round';
    
    switch (this.selectedTool) {
      case 'arrow':
        this.drawArrow(this.startX, this.startY, currentX, currentY);
        break;
      case 'circle':
        this.drawCircle(this.startX, this.startY, currentX, currentY);
        break;
      case 'rectangle':
        this.drawRectangle(this.startX, this.startY, currentX, currentY);
        break;
      case 'pen':
        if (this.currentAnnotation) {
          this.currentAnnotation.points.push({ x: currentX, y: currentY });
          this.drawPenStroke(this.currentAnnotation.points);
        }
        break;
    }
  }

  stopDrawing() {
    if (!this.isDrawing) return;
    
    this.isDrawing = false;
    
    // Save the annotation
    if (this.currentAnnotation) {
      this.annotations.push(this.currentAnnotation);
      this.currentAnnotation = null;
    } else if (this.selectedTool !== 'text') {
      // Save non-pen annotations
      const rect = this.canvas.getBoundingClientRect();
      const endX = this.startX; // Will be updated in draw()
      const endY = this.startY;
      
      this.annotations.push({
        type: this.selectedTool,
        startX: this.startX,
        startY: this.startY,
        endX: endX,
        endY: endY,
        color: this.selectedColor,
        width: this.lineWidth
      });
    }
  }

  drawArrow(fromX: number, fromY: number, toX: number, toY: number) {
    const headLength = 15;
    const angle = Math.atan2(toY - fromY, toX - fromX);
    
    this.ctx.beginPath();
    this.ctx.moveTo(fromX, fromY);
    this.ctx.lineTo(toX, toY);
    this.ctx.stroke();
    
    // Draw arrowhead
    this.ctx.beginPath();
    this.ctx.moveTo(toX, toY);
    this.ctx.lineTo(
      toX - headLength * Math.cos(angle - Math.PI / 6),
      toY - headLength * Math.sin(angle - Math.PI / 6)
    );
    this.ctx.moveTo(toX, toY);
    this.ctx.lineTo(
      toX - headLength * Math.cos(angle + Math.PI / 6),
      toY - headLength * Math.sin(angle + Math.PI / 6)
    );
    this.ctx.stroke();
  }

  drawCircle(startX: number, startY: number, endX: number, endY: number) {
    const radius = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
    this.ctx.beginPath();
    this.ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
    this.ctx.stroke();
  }

  drawRectangle(startX: number, startY: number, endX: number, endY: number) {
    this.ctx.beginPath();
    this.ctx.rect(startX, startY, endX - startX, endY - startY);
    this.ctx.stroke();
  }

  drawPenStroke(points: { x: number, y: number }[]) {
    if (points.length < 2) return;
    
    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    
    this.ctx.stroke();
  }

  addText() {
    if (!this.textInput.trim()) return;
    
    this.annotations.push({
      type: 'text',
      text: this.textInput,
      x: this.textPosition.x,
      y: this.textPosition.y,
      color: this.selectedColor,
      fontSize: 20
    });
    
    this.drawImage();
    this.isAddingText = false;
    this.textInput = '';
  }

  redrawAnnotations() {
    for (const annotation of this.annotations) {
      this.ctx.strokeStyle = annotation.color || this.selectedColor;
      this.ctx.lineWidth = annotation.width || this.lineWidth;
      this.ctx.fillStyle = annotation.color || this.selectedColor;
      
      switch (annotation.type) {
        case 'arrow':
          this.drawArrow(annotation.startX, annotation.startY, annotation.endX, annotation.endY);
          break;
        case 'circle':
          this.drawCircle(annotation.startX, annotation.startY, annotation.endX, annotation.endY);
          break;
        case 'rectangle':
          this.drawRectangle(annotation.startX, annotation.startY, annotation.endX, annotation.endY);
          break;
        case 'pen':
          this.drawPenStroke(annotation.points);
          break;
        case 'text':
          this.ctx.font = `${annotation.fontSize || 20}px Arial`;
          this.ctx.fillText(annotation.text, annotation.x, annotation.y);
          break;
      }
    }
  }

  undo() {
    if (this.annotations.length > 0) {
      this.annotations.pop();
      this.drawImage();
    }
  }

  clear() {
    this.annotations = [];
    this.drawImage();
  }

  async save() {
    // Convert canvas to blob
    const blob = await new Promise<Blob>((resolve) => {
      this.canvas.toBlob((blob) => {
        resolve(blob!);
      }, 'image/jpeg', 0.9);
    });
    
    // Convert blob to base64
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    
    reader.onloadend = () => {
      const base64data = reader.result as string;
      
      // Return the annotated image
      this.modalController.dismiss({
        annotatedImage: base64data,
        annotations: this.annotations
      });
    };
  }

  cancel() {
    this.modalController.dismiss();
  }

  selectTool(tool: 'arrow' | 'circle' | 'rectangle' | 'pen' | 'text') {
    this.selectedTool = tool;
    this.isAddingText = false;
  }
}