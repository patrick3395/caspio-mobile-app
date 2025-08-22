import { Component, Input, OnInit, ViewChild, ElementRef, EventEmitter, Output } from '@angular/core';
import { ModalController, LoadingController, ToastController } from '@ionic/angular';

interface ImageData {
  url: string;
  title: string;
  filename: string;
  attachId?: string;  // Add attachment ID for updating
}

interface Annotation {
  type: 'pen' | 'arrow' | 'rectangle' | 'circle' | 'text';
  color: string;
  lineWidth: number;
  points?: { x: number; y: number }[];
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  text?: string;
}

@Component({
  selector: 'app-image-viewer',
  templateUrl: './image-viewer.component.html',
  styleUrls: ['./image-viewer.component.scss'],
  standalone: false
})
export class ImageViewerComponent implements OnInit {
  @ViewChild('annotationCanvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('mainImage', { static: false }) imageRef!: ElementRef<HTMLImageElement>;
  @ViewChild('imageWrapper', { static: false }) wrapperRef!: ElementRef<HTMLDivElement>;
  
  // Legacy single image inputs (for backward compatibility)
  @Input() base64Data: string = '';
  @Input() title: string = '';
  @Input() filename: string = '';
  
  // New multiple images input
  @Input() images: ImageData[] = [];
  @Input() initialIndex: number = 0;
  
  // Callback for saving annotated image
  @Input() onSaveAnnotation?: (attachId: string, blob: Blob, filename: string) => Promise<boolean>;
  
  currentIndex: number = 0;
  isFullscreen: boolean = false;
  imageLoading: boolean = true;
  imageError: boolean = false;
  private allImages: ImageData[] = [];
  
  // Annotation properties
  isAnnotating: boolean = false;
  annotationTool: 'pen' | 'arrow' | 'rectangle' | 'circle' | 'text' = 'pen';
  annotationColor: string = '#F15A27'; // Noble orange for annotations
  lineWidth: number = 3;
  
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private isDrawing: boolean = false;
  private annotations: Annotation[] = [];
  private currentAnnotation: Annotation | null = null;
  private startX: number = 0;
  private startY: number = 0;

  constructor(
    private modalController: ModalController,
    private loadingController: LoadingController,
    private toastController: ToastController
  ) {}

  ngOnInit() {
    // If images array is provided, use it
    if (this.images && this.images.length > 0) {
      this.allImages = this.images;
      this.currentIndex = this.initialIndex || 0;
      console.log('🖼️ ImageViewer initialized with multiple images:', this.allImages.length);
    } 
    // Otherwise, fall back to single image mode (backward compatibility)
    else if (this.base64Data) {
      const mimeType = this.getMimeTypeFromFilename(this.filename);
      let imageUrl = this.base64Data;
      
      if (!this.base64Data.includes('base64,')) {
        imageUrl = `data:${mimeType};base64,${this.base64Data}`;
      }
      
      this.allImages = [{
        url: imageUrl,
        title: this.title || 'Document',
        filename: this.filename || 'document.jpg'
      }];
      this.currentIndex = 0;
      console.log('🖼️ ImageViewer initialized in single image mode');
    } else {
      console.error('❌ No image data provided to ImageViewer');
    }
  }

  onImageLoad() {
    this.imageLoading = false;
    this.imageError = false;
    
    if (this.isAnnotating && this.canvasRef) {
      setTimeout(() => this.setupCanvas(), 100);
    }
  }
  
  onImageError() {
    this.imageLoading = false;
    this.imageError = true;
    console.error('Failed to load image:', this.getCurrentImageUrl());
  }
  
  retryImageLoad() {
    this.imageLoading = true;
    this.imageError = false;
    // Force reload by resetting the current index
    const temp = this.currentIndex;
    this.currentIndex = -1;
    setTimeout(() => {
      this.currentIndex = temp;
    }, 10);
  }

  private setupCanvas() {
    if (!this.canvasRef || !this.imageRef || !this.wrapperRef) return;
    
    this.canvas = this.canvasRef.nativeElement;
    const image = this.imageRef.nativeElement;
    const wrapper = this.wrapperRef.nativeElement;
    
    // Wait for image to be fully rendered
    if (image.naturalWidth === 0 || image.naturalHeight === 0) {
      setTimeout(() => this.setupCanvas(), 100);
      return;
    }
    
    // Set canvas size to match displayed image size
    const rect = image.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    
    // Position canvas exactly over the image
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    
    // Redraw existing annotations
    this.redrawAnnotations();
  }

  toggleAnnotation() {
    this.isAnnotating = !this.isAnnotating;
    
    if (this.isAnnotating) {
      setTimeout(() => {
        this.setupCanvas();
      }, 100);
    }
  }

  selectTool(tool: 'pen' | 'arrow' | 'rectangle' | 'circle' | 'text') {
    this.annotationTool = tool;
  }

  private getMousePos(e: MouseEvent | Touch): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  startDrawing(e: MouseEvent) {
    if (!this.isAnnotating) return;
    
    this.isDrawing = true;
    const pos = this.getMousePos(e);
    this.startX = pos.x;
    this.startY = pos.y;
    
    if (this.annotationTool === 'text') {
      const text = prompt('Enter text:');
      if (text) {
        this.drawText(pos.x, pos.y, text);
        this.annotations.push({
          type: 'text',
          color: this.annotationColor,
          lineWidth: this.lineWidth,
          startX: pos.x,
          startY: pos.y,
          text: text
        });
      }
      this.isDrawing = false;
      return;
    }
    
    this.currentAnnotation = {
      type: this.annotationTool,
      color: this.annotationColor,
      lineWidth: this.lineWidth,
      points: this.annotationTool === 'pen' ? [pos] : [],
      startX: pos.x,
      startY: pos.y
    };
    
    if (this.annotationTool === 'pen') {
      this.ctx.beginPath();
      this.ctx.moveTo(pos.x, pos.y);
      this.ctx.strokeStyle = this.annotationColor;
      this.ctx.lineWidth = this.lineWidth;
    }
  }

  draw(e: MouseEvent) {
    if (!this.isDrawing || !this.currentAnnotation) return;
    
    const pos = this.getMousePos(e);
    
    if (this.annotationTool === 'pen') {
      this.ctx.lineTo(pos.x, pos.y);
      this.ctx.stroke();
      this.currentAnnotation.points!.push(pos);
    } else {
      // Clear and redraw for shapes
      this.redrawAnnotations();
      this.drawShape(this.startX, this.startY, pos.x, pos.y);
    }
  }

  stopDrawing(e: MouseEvent) {
    if (!this.isDrawing || !this.currentAnnotation) return;
    
    const pos = this.getMousePos(e);
    
    if (this.annotationTool !== 'pen' && this.annotationTool !== 'text') {
      this.currentAnnotation.endX = pos.x;
      this.currentAnnotation.endY = pos.y;
    }
    
    if (this.currentAnnotation && this.annotationTool !== 'text') {
      this.annotations.push(this.currentAnnotation);
    }
    
    this.isDrawing = false;
    this.currentAnnotation = null;
  }

  // Touch event handlers
  handleTouchStart(e: TouchEvent) {
    e.preventDefault();
    const touch = e.touches[0];
    this.startDrawing(touch as any);
  }

  handleTouchMove(e: TouchEvent) {
    e.preventDefault();
    const touch = e.touches[0];
    this.draw(touch as any);
  }

  handleTouchEnd(e: TouchEvent) {
    e.preventDefault();
    const touch = e.changedTouches[0];
    this.stopDrawing(touch as any);
  }

  private drawShape(startX: number, startY: number, endX: number, endY: number) {
    this.ctx.strokeStyle = this.annotationColor;
    this.ctx.lineWidth = this.lineWidth;
    
    switch (this.annotationTool) {
      case 'arrow':
        this.drawArrow(startX, startY, endX, endY);
        break;
      case 'rectangle':
        this.ctx.strokeRect(startX, startY, endX - startX, endY - startY);
        break;
      case 'circle':
        const radius = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
        this.ctx.beginPath();
        this.ctx.arc(startX, startY, radius, 0, 2 * Math.PI);
        this.ctx.stroke();
        break;
    }
  }

  private drawArrow(fromX: number, fromY: number, toX: number, toY: number) {
    const headlen = 15;
    const angle = Math.atan2(toY - fromY, toX - fromX);
    
    // Draw line
    this.ctx.beginPath();
    this.ctx.moveTo(fromX, fromY);
    this.ctx.lineTo(toX, toY);
    this.ctx.stroke();
    
    // Draw arrowhead
    this.ctx.beginPath();
    this.ctx.moveTo(toX, toY);
    this.ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
    this.ctx.moveTo(toX, toY);
    this.ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
    this.ctx.stroke();
  }

  private drawText(x: number, y: number, text: string) {
    this.ctx.fillStyle = this.annotationColor;
    this.ctx.font = `${this.lineWidth * 5}px Arial`;
    this.ctx.fillText(text, x, y);
  }

  private redrawAnnotations() {
    if (!this.ctx || !this.canvas) return;
    
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    for (const annotation of this.annotations) {
      this.ctx.strokeStyle = annotation.color;
      this.ctx.lineWidth = annotation.lineWidth;
      this.ctx.fillStyle = annotation.color;
      
      switch (annotation.type) {
        case 'pen':
          if (annotation.points && annotation.points.length > 0) {
            this.ctx.beginPath();
            this.ctx.moveTo(annotation.points[0].x, annotation.points[0].y);
            for (const point of annotation.points) {
              this.ctx.lineTo(point.x, point.y);
            }
            this.ctx.stroke();
          }
          break;
        case 'arrow':
          if (annotation.startX !== undefined && annotation.startY !== undefined && 
              annotation.endX !== undefined && annotation.endY !== undefined) {
            this.drawArrow(annotation.startX, annotation.startY, annotation.endX, annotation.endY);
          }
          break;
        case 'rectangle':
          if (annotation.startX !== undefined && annotation.startY !== undefined && 
              annotation.endX !== undefined && annotation.endY !== undefined) {
            this.ctx.strokeRect(annotation.startX, annotation.startY, 
                               annotation.endX - annotation.startX, 
                               annotation.endY - annotation.startY);
          }
          break;
        case 'circle':
          if (annotation.startX !== undefined && annotation.startY !== undefined && 
              annotation.endX !== undefined && annotation.endY !== undefined) {
            const radius = Math.sqrt(Math.pow(annotation.endX - annotation.startX, 2) + 
                                   Math.pow(annotation.endY - annotation.startY, 2));
            this.ctx.beginPath();
            this.ctx.arc(annotation.startX, annotation.startY, radius, 0, 2 * Math.PI);
            this.ctx.stroke();
          }
          break;
        case 'text':
          if (annotation.text && annotation.startX !== undefined && annotation.startY !== undefined) {
            this.ctx.font = `${annotation.lineWidth * 5}px Arial`;
            this.ctx.fillText(annotation.text, annotation.startX, annotation.startY);
          }
          break;
      }
    }
  }

  undoAnnotation() {
    if (this.annotations.length > 0) {
      this.annotations.pop();
      this.redrawAnnotations();
    }
  }

  clearAnnotations() {
    this.annotations = [];
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  canUndo(): boolean {
    return this.annotations.length > 0;
  }

  async saveAnnotatedImage() {
    if (!this.canvas || !this.imageRef) return;
    
    const loading = await this.loadingController.create({
      message: 'Saving annotated image...'
    });
    await loading.present();
    
    try {
      // Create a temporary canvas to merge image and annotations
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d')!;
      const img = this.imageRef.nativeElement;
      
      // Use original image dimensions for quality
      tempCanvas.width = img.naturalWidth;
      tempCanvas.height = img.naturalHeight;
      
      // Draw the original image at full size
      tempCtx.drawImage(img, 0, 0, tempCanvas.width, tempCanvas.height);
      
      // Scale and draw the annotations
      const scaleX = img.naturalWidth / this.canvas.width;
      const scaleY = img.naturalHeight / this.canvas.height;
      
      tempCtx.save();
      tempCtx.scale(scaleX, scaleY);
      tempCtx.drawImage(this.canvas, 0, 0);
      tempCtx.restore();
      
      // Convert to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        tempCanvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create image blob'));
          }
        }, 'image/jpeg', 0.95); // Use JPEG with high quality
      });
      
      // Get current image attachment ID
      const currentImage = this.allImages[this.currentIndex];
      
      console.log('🎨 DEBUG: Saving annotated image');
      console.log('  - Current index:', this.currentIndex);
      console.log('  - Current image:', currentImage);
      console.log('  - Has attachId:', !!currentImage.attachId);
      console.log('  - AttachId value:', currentImage.attachId);
      console.log('  - Has callback:', !!this.onSaveAnnotation);
      console.log('  - Blob size:', blob.size);
      
      if (currentImage.attachId && this.onSaveAnnotation) {
        console.log('📤 Calling onSaveAnnotation callback...');
        // Upload to Caspio to replace the original
        const success = await this.onSaveAnnotation(
          currentImage.attachId,
          blob,
          currentImage.filename || 'annotated.jpg'
        );
        
        console.log('  - Save result:', success);
        
        if (success) {
          // Update the current image URL with the annotated version
          const newUrl = URL.createObjectURL(blob);
          currentImage.url = newUrl;
          
          // Clear annotations and exit annotation mode
          this.clearAnnotations();
          this.isAnnotating = false;
          
          await this.showToast('Annotated image saved successfully!', 'success');
        } else {
          await this.showToast('Failed to save annotated image', 'danger');
        }
      } else {
        // Fallback: Download locally if no Caspio integration
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `annotated_${this.getCurrentFilename()}`;
        link.click();
        URL.revokeObjectURL(url);
        
        this.clearAnnotations();
        this.isAnnotating = false;
        
        await this.showToast('Image downloaded locally', 'success');
      }
    } catch (error) {
      console.error('Error saving annotated image:', error);
      await this.showToast('Error saving image', 'danger');
    } finally {
      await loading.dismiss();
    }
  }
  
  private async showToast(message: string, color: string) {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'bottom',
      color
    });
    await toast.present();
  }

  private getMimeTypeFromFilename(filename: string): string {
    const ext = filename?.split('.').pop()?.toLowerCase();
    const mimeTypes: {[key: string]: string} = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'pdf': 'application/pdf'
    };
    return mimeTypes[ext || ''] || 'image/jpeg';
  }

  // Navigation methods
  previousImage() {
    if (this.hasPrevious()) {
      this.imageLoading = true;
      this.currentIndex--;
      this.clearAnnotations();
    }
  }

  nextImage() {
    if (this.hasNext()) {
      this.imageLoading = true;
      this.currentIndex++;
      this.clearAnnotations();
    }
  }

  selectImage(index: number) {
    if (index >= 0 && index < this.allImages.length) {
      this.imageLoading = true;
      this.currentIndex = index;
      this.clearAnnotations();
    }
  }

  hasPrevious(): boolean {
    return this.currentIndex > 0;
  }

  hasNext(): boolean {
    return this.currentIndex < this.allImages.length - 1;
  }

  hasMultipleImages(): boolean {
    return this.allImages.length > 1;
  }

  // Get current image data
  getCurrentImageUrl(): string {
    return this.allImages[this.currentIndex]?.url || '';
  }

  getCurrentTitle(): string {
    return this.allImages[this.currentIndex]?.title || 'Document';
  }

  getCurrentFilename(): string {
    return this.allImages[this.currentIndex]?.filename || 'document';
  }

  getAllImages(): ImageData[] {
    return this.allImages;
  }

  // Actions
  dismiss() {
    this.modalController.dismiss();
  }

  downloadImage() {
    const current = this.allImages[this.currentIndex];
    if (current) {
      const link = document.createElement('a');
      link.href = current.url;
      link.download = current.filename;
      link.click();
    }
  }

  toggleFullscreen() {
    this.isFullscreen = !this.isFullscreen;
    
    // Add or remove fullscreen class to wrapper
    const wrapper = document.querySelector('.image-viewer-wrapper');
    if (wrapper) {
      if (this.isFullscreen) {
        wrapper.classList.add('fullscreen');
      } else {
        wrapper.classList.remove('fullscreen');
      }
    }
  }
}