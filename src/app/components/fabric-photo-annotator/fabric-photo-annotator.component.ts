import { Component, Input, ViewChild, ElementRef, OnInit, AfterViewInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController, AlertController } from '@ionic/angular';
import { compressAnnotationData, decompressAnnotationData } from '../../utils/annotation-utils';
import { FabricService } from '../../services/fabric.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-fabric-photo-annotator',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  template: `
    <ion-content>
      <!-- Top toolbar with annotation tools and navigation -->
      <div class="top-toolbar">
        <button class="nav-btn back-btn" (click)="dismiss()" title="Back">
          <ion-icon name="arrow-back"></ion-icon>
        </button>

        <div class="tool-buttons-center">
          <button class="tool-btn color-btn" (click)="changeColor()" title="Change Color">
            <ion-icon name="color-palette-outline"></ion-icon>
            <div class="color-indicator" [style.background]="currentColor"></div>
          </button>
          <button class="tool-btn" [class.active]="currentTool === 'arrow'" (click)="setTool('arrow')" title="Draw Arrow">
            <ion-icon name="arrow-forward-outline"></ion-icon>
          </button>
          <button class="tool-btn" [class.active]="currentTool === 'rectangle'" (click)="setTool('rectangle')" title="Draw Rectangle">
            <ion-icon name="square-outline"></ion-icon>
          </button>
          <button class="tool-btn" [class.active]="currentTool === 'text'" (click)="setTool('text')" title="Add Text">
            <ion-icon name="text-outline"></ion-icon>
          </button>
          <button class="tool-btn" (click)="undo()" title="Undo">
            <ion-icon name="arrow-undo-outline"></ion-icon>
          </button>
          <button class="tool-btn delete-btn" (click)="deleteSelected()" title="Delete Selected">
            <ion-icon name="trash-outline"></ion-icon>
          </button>
          <button class="tool-btn" [class.active]="currentTool === 'select'" (click)="setTool('select')" title="Select/Move">
            <ion-icon name="hand-left-outline"></ion-icon>
          </button>
        </div>

        <button class="nav-btn save-btn" (click)="save()" title="Save">
          <ion-icon name="checkmark"></ion-icon>
        </button>
      </div>
      
      <div class="canvas-container" #canvasContainer>
        <canvas #fabricCanvas></canvas>
      </div>

      <!-- Caption button at bottom -->
      <div class="caption-container" #captionContainer>
        <button class="caption-button" (click)="openCaptionPopup()">
          <ion-icon name="text-outline"></ion-icon>
          <span>{{ photoCaption || 'Add Caption' }}</span>
        </button>
      </div>

    </ion-content>
  `,
  styles: [`
    ion-content {
      --padding-top: 0;
      --padding-bottom: 0;
    }
    
    .top-toolbar {
      position: absolute;
      top: var(--ion-safe-area-top, 0); // Respect safe area for mobile devices
      left: 0;
      right: 0;
      padding: 12px 10px; // Increased padding for better touch targets
      background: #f0f0f0;
      box-shadow: 0 2px 10px rgba(0,0,0,0.15);
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 6px;
      z-index: 100;
      min-height: 58px; // Ensure consistent height
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
      position: absolute;
      left: 10px;
      background: #666;

      // Mobile-specific sizing
      @media (max-width: 768px) {
        width: 48px;
        height: 48px;
        left: 8px;
      }
    }

    .back-btn:hover {
      background: #555;
      transform: scale(1.05);
    }

    .back-btn ion-icon {
      font-size: 26px;
      color: white;

      @media (max-width: 768px) {
        font-size: 28px; // Larger on mobile
      }
    }

    .save-btn {
      position: absolute;
      right: 10px;
      background: #F15A27;

      // Mobile-specific sizing
      @media (max-width: 768px) {
        width: 48px;
        height: 48px;
        right: 8px;
      }
    }

    .save-btn:hover {
      background: #d94e1f;
      transform: scale(1.05);
    }

    .save-btn ion-icon {
      font-size: 26px;
      color: white;

      @media (max-width: 768px) {
        font-size: 28px; // Larger on mobile
      }
    }

    .tool-buttons-center {
      display: flex;
      align-items: center;
      gap: 6px;
      justify-content: center;
      flex: 1;
      margin: 0 60px; /* Leave space on both left and right for back and save buttons */

      // Mobile-specific adjustments
      @media (max-width: 768px) {
        gap: 4px; // Tighter spacing on mobile
        margin: 0 65px; // More space on both sides for bigger buttons
        flex-wrap: wrap; // Allow wrapping if needed
      }
    }
    
    .tool-btn {
      background: rgba(255,255,255,0.95);
      border: 2px solid #e0e0e0;
      border-radius: 10px;
      width: 42px;
      height: 42px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #666;
      cursor: pointer;
      transition: all 0.2s;
      position: relative;
      padding: 0;
      
      // Mobile-specific sizing for better touch targets
      @media (max-width: 768px) {
        width: 48px;
        height: 48px;
        margin: 2px; // Add margin for easier tapping
      }
    }
    
    .caption-container {
      position: absolute;
      bottom: 15px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 100;
      width: auto;
      min-width: 250px;
      max-width: 80%;

      // Mobile: fixed width centering to prevent any movement
      @media (max-width: 768px) {
        bottom: 20px;
        left: 5%;
        right: 5%;
        width: 90%;
        min-width: unset;
        max-width: unset;
        transform: none;
      }
    }

    .caption-button {
      width: 100%;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.95);
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      color: #333;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.2);
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;

      // Desktop only: transitions and transforms
      @media (hover: hover) and (pointer: fine) {
        transition: all 0.2s ease;

        &:hover {
          background: white;
          border-color: #F15A27;
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(0,0,0,0.25);
        }

        &:active {
          transform: translateY(0);
        }
      }

      ion-icon {
        font-size: 20px;
        color: #F15A27;
        pointer-events: none;
      }

      span {
        flex: 1;
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        pointer-events: none;
      }

      // Mobile: completely static, no transitions or transforms
      @media (max-width: 768px) {
        padding: 14px 18px;
        font-size: 15px;
        transition: none;
        transform: none;
      }
    }

    .tool-btn:hover {
      background: white;
      transform: scale(1.05);
      box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      border-color: #999;
    }

    .tool-btn.active {
      background: #e0e0e0;
      border-color: #666;
      border-width: 3px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      color: #333;
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
      border: 2px solid #999;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    }
    
    // Delete button now uses default .tool-btn styling to match other buttons
    // No special styling needed - it will inherit the light borders and icons
    .delete-btn {
      // Inherits all styling from .tool-btn
    }
    
    .canvas-container {
      position: absolute;
      top: calc(58px + var(--ion-safe-area-top, 0px)); // Account for safe area + header height
      bottom: 80px; // Leave more space for caption on mobile
      left: 0;
      right: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      background: #2d2d2d;
      overflow: auto;
      padding: 10px;
      
      // Mobile-specific adjustments for better canvas positioning
      @media (max-width: 768px) {
        top: calc(70px + var(--ion-safe-area-top, 0px)); // More space on mobile
        bottom: 90px; // More bottom space for caption
        padding: 8px; // Less padding for more canvas space
      }
    }
    
    canvas {
      max-width: 100% !important;
      max-height: 100% !important;
      width: auto !important;
      height: auto !important;
      border: none;
      border-radius: 4px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
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
  @ViewChild('captionContainer', { static: false }) captionContainer!: ElementRef<HTMLDivElement>;
  
  @Input() imageUrl?: string;
  @Input() imageFile?: File;
  @Input() existingAnnotations?: any[] = [];
  @Input() isReEdit?: boolean = false;
  @Input() photoData?: any;
  @Input() existingCaption?: string;

  private canvas!: any;
  currentTool = 'arrow';
  currentColor = '#FF0000';
  private strokeWidth = 3;
  private isDrawing = false;
  private colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#000000', '#FFFFFF'];
  private colorIndex = 0;
  photoCaption = '';
  private isCaptionPopupOpen = false;

  private async getFabric(): Promise<any> {
    return await this.fabricService.getFabric();
  }

  constructor(
    private modalController: ModalController,
    private alertController: AlertController,
    private fabricService: FabricService,
    private cdr: ChangeDetectorRef
  ) {}
  
  ngOnInit() {

    // Load existing caption - prioritize existingCaption input, then photoData fields
    if (this.existingCaption) {
      this.photoCaption = this.existingCaption;
    } else if (this.photoData?.Annotation) {
      this.photoCaption = this.photoData.Annotation;
    } else if (this.photoData?.annotation) {
      this.photoCaption = this.photoData.annotation;
    } else if (this.photoData?.caption) {
      this.photoCaption = this.photoData.caption;
    }
  }
  
  async ngAfterViewInit() {
    await this.fabricService.ensureFabricLoaded();
    setTimeout(() => this.initializeFabricCanvas(), 100);
    
    // Add keyboard listener for delete key
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
  }
  
  ngOnDestroy() {
    // Clean up keyboard listener
    document.removeEventListener('keydown', this.handleKeyDown.bind(this));
  }
  
  private async handleKeyDown(event: KeyboardEvent) {
    // Delete selected object when Delete or Backspace is pressed
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.canvas) {
      const activeObject = this.canvas.getActiveObject();
      const fabric = await this.getFabric();
      if (activeObject && !(activeObject instanceof fabric.Image)) {
        this.canvas.remove(activeObject);
        this.canvas.discardActiveObject();
        this.canvas.renderAll();
      }
    }
  }
  
  async initializeFabricCanvas() {

    const fabric = await this.fabricService.getFabric();
    if (!this.canvasElement) {
      console.error('[FabricAnnotator] Canvas element not found');
      return;
    }
    
    // Initialize Fabric.js canvas
    this.canvas = new fabric.Canvas(this.canvasElement.nativeElement, {
      isDrawingMode: false,
      selection: true
    });
    
    // Load the image
    if (this.imageUrl || this.imageFile) {
      let imageUrl = this.imageUrl || await this.fileToDataUrl(this.imageFile!);

      // Convert blob URLs to data URLs for more reliable loading in Fabric.js
      // Blob URLs can become stale after page navigation, but data URLs are self-contained
      if (imageUrl.startsWith('blob:')) {
        try {
          imageUrl = await this.blobUrlToDataUrl(imageUrl);
        } catch (conversionError) {
          console.error('[FabricAnnotator] Failed to convert blob URL to data URL:', conversionError);
          // Continue with blob URL as fallback
        }
      }
      
      // CRITICAL FIX: Convert S3 URLs to data URLs to avoid CORS issues
      // S3 presigned URLs don't have proper CORS headers for cross-origin canvas access
      // WEBAPP MODE: Uses API Gateway proxy to fetch S3 images (enables saving annotations)
      // MOBILE MODE: Uses direct XHR fetch
      if (imageUrl.startsWith('https://') && imageUrl.includes('.s3.') && imageUrl.includes('amazonaws.com')) {
        try {
          imageUrl = await this.fetchRemoteImageAsDataUrl(imageUrl);
        } catch (conversionError) {
          console.error('[FabricAnnotator] ❌ Failed to convert S3 URL to data URL:', conversionError);
          // Continue with original URL as fallback (may fail due to CORS or be view-only)
        }
      }

      // Only use crossOrigin for remote URLs, not for data URLs or blob URLs (offline photos)
      // Data URLs and blob URLs are same-origin by default and crossOrigin can cause them to fail silently
      // S3 images should have been converted to data URLs above - if conversion failed, load without crossOrigin (view-only fallback)
      const isLocalUrl = imageUrl.startsWith('data:') || imageUrl.startsWith('blob:');
      const isS3Fallback = imageUrl.includes('.s3.') && imageUrl.includes('amazonaws.com');
      const loadOptions = (isLocalUrl || isS3Fallback) ? {} : { crossOrigin: 'anonymous' };

      fabric.Image.fromURL(imageUrl, loadOptions).then((img: any) => {

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

        // Update caption container width to match canvas
        this.updateCaptionWidth(img.width! * scale);

        // Load existing annotations if any
        if (this.existingAnnotations) {
          // Check if it's an array with length or an object with properties
          const hasAnnotations = Array.isArray(this.existingAnnotations)
            ? this.existingAnnotations.length > 0
            : Object.keys(this.existingAnnotations).length > 0;

          if (hasAnnotations) {
            setTimeout(() => this.loadExistingAnnotations(), 100); // Small delay to ensure canvas is ready
          }
        }
      }).catch((error: any) => {
        console.error('[FabricAnnotator] FAILED to load image:', error);
        console.error('[FabricAnnotator] Image URL was:', imageUrl.substring(0, 100));
      });
    } else {
      console.error('[FabricAnnotator] NO IMAGE URL OR FILE PROVIDED');
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

  /**
   * Convert a blob URL to a data URL
   * Blob URLs can be unreliable in Fabric.js, especially after page navigation
   * Data URLs are more universally supported
   */
  private async blobUrlToDataUrl(blobUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = function() {
        const reader = new FileReader();
        reader.onloadend = function() {
          resolve(reader.result as string);
        };
        reader.onerror = reject;
        reader.readAsDataURL(xhr.response);
      };
      xhr.onerror = reject;
      xhr.open('GET', blobUrl);
      xhr.responseType = 'blob';
      xhr.send();
    });
  }

  /**
   * Fetch a remote image URL and convert to data URL
   * This is necessary for S3 presigned URLs which don't have CORS headers
   * By fetching the image data directly, we avoid CORS issues when drawing on canvas
   *
   * WEBAPP MODE: Uses API Gateway proxy to avoid CORS issues with S3
   */
  private async fetchRemoteImageAsDataUrl(imageUrl: string): Promise<string> {
    // WEBAPP MODE: For S3 images, get a fresh signed URL and fetch directly
    if (environment.isWeb && imageUrl.includes('.s3.') && imageUrl.includes('amazonaws.com')) {
      try {
        // Extract S3 key from the URL
        const urlObj = new URL(imageUrl);
        const s3Key = urlObj.pathname.substring(1); // Remove leading '/'

        if (s3Key) {
          // Get a fresh signed URL using the existing /api/s3/url endpoint
          const urlEndpoint = `${environment.apiGatewayUrl}/api/s3/url?s3Key=${encodeURIComponent(s3Key)}`;

          const urlResponse = await fetch(urlEndpoint);
          if (!urlResponse.ok) {
            throw new Error(`Failed to get signed URL: ${urlResponse.status}`);
          }

          const urlResult = await urlResponse.json();
          const signedUrl = urlResult.url;

          if (signedUrl) {
            // Fetch the image using the fresh signed URL
            const imageResponse = await fetch(signedUrl);
            if (!imageResponse.ok) {
              throw new Error(`Image fetch failed: ${imageResponse.status}`);
            }

            const blob = await imageResponse.blob();
            return new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = () => reject(new Error('Failed to read blob as data URL'));
              reader.readAsDataURL(blob);
            });
          }
        }
      } catch (proxyError) {
        console.warn('[FabricAnnotator] WEBAPP: S3 fetch failed, trying direct fetch:', proxyError);
        // Fall through to regular XHR fetch
      }
    }

    // MOBILE MODE (or webapp fallback): Direct XHR fetch
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = function() {
        if (xhr.status === 200) {
          const reader = new FileReader();
          reader.onloadend = function() {
            resolve(reader.result as string);
          };
          reader.onerror = () => reject(new Error('Failed to read blob as data URL'));
          reader.readAsDataURL(xhr.response);
        } else {
          reject(new Error(`HTTP error ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error fetching image'));
      xhr.ontimeout = () => reject(new Error('Timeout fetching image'));
      xhr.open('GET', imageUrl);
      xhr.responseType = 'blob';
      xhr.timeout = 30000; // 30 second timeout
      xhr.send();
    });
  }
  
  private setupEventListeners() {
    let isDrawingArrow = false;
    let startX = 0, startY = 0;
    let tempLine: any = null;
    let tempArrowHead1: any = null;
    let tempArrowHead2: any = null;
    
    this.canvas.on('mouse:down', async (options: any) => {
      // CRITICAL: Skip all drawing logic if in selection mode
      if (this.currentTool === 'select') {
        return;  // Let Fabric.js handle selection and movement
      }
      
      if (this.currentTool === 'arrow') {
        isDrawingArrow = true;
        const pointer = this.canvas.getPointer(options.e);
        startX = pointer.x;
        startY = pointer.y;
      } else if (this.currentTool === 'rectangle') {
        const pointer = this.canvas.getPointer(options.e);
        startX = pointer.x;
        startY = pointer.y;
        const fabric = await this.getFabric();
        const rect = new fabric.Rect({
          left: pointer.x,
          top: pointer.y,
          width: 0,
          height: 0,
          fill: 'transparent',
          stroke: this.currentColor,
          strokeWidth: this.strokeWidth,
          selectable: false,
          evented: false
        });
        this.canvas.add(rect);
        this.isDrawing = true;
      } else if (this.currentTool === 'circle') {
        const pointer = this.canvas.getPointer(options.e);
        const fabric = await this.getFabric();
        const circle = new fabric.Circle({
          left: pointer.x,
          top: pointer.y,
          radius: 1,
          fill: 'transparent',
          stroke: this.currentColor,
          strokeWidth: this.strokeWidth,
          selectable: false,
          evented: false
        });
        this.canvas.add(circle);
        this.isDrawing = true;
      } else if (this.currentTool === 'text') {
        const pointer = this.canvas.getPointer(options.e);
        
        // Use a prompt to get text input on mobile
        const userText = prompt('Enter text:', '');
        
        if (userText !== null && userText !== '') {
          const fabric = await this.getFabric();
          const text = new fabric.IText(userText, {
            left: pointer.x,
            top: pointer.y,
            fontSize: 20,
            fill: this.currentColor,
            fontFamily: 'Arial',
            editable: true
          });
          this.canvas.add(text);
          this.canvas.setActiveObject(text);
          this.canvas.renderAll();
        }
        
        // Switch to select mode after adding text so user can't add multiple texts
        await this.setTool('select');
      }
    });
    
    this.canvas.on('mouse:move', async (options: any) => {
      // Skip all drawing logic if in selection mode
      if (this.currentTool === 'select') {
        return;  // Let Fabric.js handle object movement
      }
      
      if (isDrawingArrow) {
        const pointer = this.canvas.getPointer(options.e);
        const fabric = await this.getFabric();
        
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
        const rect = this.canvas.getObjects().slice(-1)[0] as any;
        if (rect) {
          // Calculate proper left/top/width/height for any drag direction
          const left = Math.min(startX, pointer.x);
          const top = Math.min(startY, pointer.y);
          const width = Math.abs(pointer.x - startX);
          const height = Math.abs(pointer.y - startY);
          rect.set({ left, top, width, height });
          this.canvas.renderAll();
        }
      } else if (this.isDrawing && this.currentTool === 'circle') {
        const pointer = this.canvas.getPointer(options.e);
        const circle = this.canvas.getObjects().slice(-1)[0] as any;
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
    
    this.canvas.on('mouse:up', async (options: any) => {
      // Skip all drawing logic if in selection mode
      if (this.currentTool === 'select') {
        return;  // Let Fabric.js handle selection completion
      }
      
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
        const arrow = await this.createArrow(startX, startY, pointer.x, pointer.y);
        this.canvas.add(arrow);
        
        tempLine = null;
        tempArrowHead1 = null;
        tempArrowHead2 = null;
      }
      this.isDrawing = false;
    });
    
    // Add double-click handler for editing text
    this.canvas.on('mouse:dblclick', async (options: any) => {
      const target = this.canvas.getActiveObject();
      if (target && target.type === 'i-text') {
        const textObj = target as any;
        const currentText = textObj.text || '';
        const newText = prompt('Edit text:', currentText);
        
        if (newText !== null) {
          textObj.set('text', newText);
          this.canvas.renderAll();
        }
      }
    });
    
    // Also handle selection:created event for text objects - show edit prompt
    this.canvas.on('selection:created', (options: any) => {
      if (options.target && options.target.type === 'i-text' && this.currentTool === 'select') {
        const textObj = options.target as any;
        // Add a small delay to allow the selection to complete
        setTimeout(() => {
          const currentText = textObj.text || '';
          const newText = prompt('Edit text:', currentText);
          
          if (newText !== null) {
            textObj.set('text', newText);
            this.canvas.renderAll();
          }
        }, 200);
      }
    });
  }
  
  private async createArrow(x1: number, y1: number, x2: number, y2: number): Promise<any> {
    const fabric = await this.getFabric();
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

    return new fabric.Group([line, arrowHead1, arrowHead2], {
      selectable: false,
      evented: false
    });
  }
  
  async setTool(tool: string) {
    this.currentTool = tool;
    
    // Enable or disable selection based on tool
    if (tool === 'select') {
      // Enable selection mode for editing existing annotations
      this.canvas.isDrawingMode = false;
      this.canvas.selection = true;
      
      const fabric = await this.getFabric();
      // Make all objects selectable
      this.canvas.getObjects().forEach((obj: any) => {
        if (!(obj instanceof fabric.Image)) {  // Don't make background image selectable
          obj.set({
            selectable: true,
            evented: true,
            hasControls: true,
            hasBorders: true
          });
        }
      });
      this.canvas.renderAll();
    } else {
      // Disable selection for drawing tools
      this.canvas.isDrawingMode = false;
      this.canvas.selection = false;

      // Deselect any active object
      this.canvas.discardActiveObject();

      // Make all objects non-selectable so they don't interfere with drawing
      const fabric = await this.getFabric();
      this.canvas.getObjects().forEach((obj: any) => {
        if (!(obj instanceof fabric.Image)) {
          obj.set({
            selectable: false,
            evented: false
          });
        }
      });
      this.canvas.renderAll();
    }
  }
  
  async selectTool(event: any) {
    const tool = event.detail.value;
    await this.setTool(tool);
  }
  
  changeColor() {
    this.colorIndex = (this.colorIndex + 1) % this.colors.length;
    this.currentColor = this.colors[this.colorIndex];
    if (this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.color = this.currentColor;
    }
  }
  
  async undo() {
    const objects = this.canvas.getObjects();
    if (objects.length > 0) {
      // Don't remove the background image
      const lastObject = objects[objects.length - 1];
      const fabric = await this.getFabric();
      if (!(lastObject instanceof fabric.Image)) {
        this.canvas.remove(lastObject);
      }
    }
  }
  
  async clearAll() {
    // Remove all objects except the background image
    const fabric = await this.getFabric();
    const objects = this.canvas.getObjects();
    objects.forEach((obj: any) => {
      if (!(obj instanceof fabric.Image)) {
        this.canvas.remove(obj);
      }
    });
    this.canvas.renderAll();
  }
  
  async deleteSelected() {
    const activeObject = this.canvas.getActiveObject();
    const fabric = await this.getFabric();
    if (activeObject && !(activeObject instanceof fabric.Image)) {
      this.canvas.remove(activeObject);
      this.canvas.discardActiveObject();
      this.canvas.renderAll();
    } else {
    }
  }
  
  
  async getAnnotationCount(): Promise<number> {
    // Count all objects except the background image
    const objects = this.canvas?.getObjects() || [];
    const fabric = await this.getFabric();
    return objects.filter((obj: any) => !(obj instanceof fabric.Image)).length;
  }
  
  private async loadExistingAnnotations() {

    if (!this.existingAnnotations || !this.canvas) {
      return;
    }

    try {
      const payload = decompressAnnotationData(this.existingAnnotations as any);

      if (!payload || !Array.isArray(payload.objects) || payload.objects.length === 0) {
        return;
      }

      const annotationObjects = payload.objects.filter((obj: any) =>
        obj.type !== 'image' && obj.type !== 'Image'
      );

      if (annotationObjects.length === 0) {
        return;
      }

      const bgImage = this.canvas.backgroundImage as any;
      const bgImageSrc = bgImage ? bgImage.getSrc() : null;

      const payloadToLoad = {
        version: payload.version,
        objects: annotationObjects
      };

      this.canvas.loadFromJSON(payloadToLoad, async () => {
        if (bgImageSrc) {
          const fabric = await this.getFabric();
          // Only use crossOrigin for remote URLs, not for data URLs or blob URLs (offline photos)
          const isLocalBgUrl = bgImageSrc.startsWith('data:') || bgImageSrc.startsWith('blob:');
          const restoreOptions = isLocalBgUrl ? {} : { crossOrigin: 'anonymous' };
          fabric.Image.fromURL(bgImageSrc, restoreOptions).then((img: any) => {
            const containerWidth = this.canvasContainer.nativeElement.clientWidth * 0.9;
            const containerHeight = this.canvasContainer.nativeElement.clientHeight * 0.9;

            let scale = 1;
            if (img.width! > containerWidth || img.height! > containerHeight) {
              scale = Math.min(containerWidth / img.width!, containerHeight / img.height!);
            }

            img.scale(scale);
            img.selectable = false;
            img.evented = false;
            this.canvas.backgroundImage = img;
            this.canvas.renderAll();
          }).catch((error: any) => console.error('[Annotations] Failed to restore background image', error));
        }

        setTimeout(async () => {
          const fabric = await this.getFabric();
          this.canvas.getObjects().forEach((obj: any) => {
            if (!(obj instanceof fabric.Image)) {
              obj.set({
                selectable: true,
                evented: true,
                hasControls: true,
                hasBorders: true,
                lockMovementX: false,
                lockMovementY: false,
                lockRotation: false,
                lockScalingX: false,
                lockScalingY: false
              });
            }
          });

          this.currentTool = 'select';
          this.canvas.selection = true;
          this.canvas.renderAll();
        }, 500);
      });

      this.currentTool = 'select';
      await this.setTool('select');
    } catch (error) {
      console.error('âŒ [Annotations] Error loading existing annotations:', error);
    }
  }
  async openCaptionPopup() {
    // Prevent multiple simultaneous popups
    if (this.isCaptionPopupOpen) {
      return;
    }

    this.isCaptionPopupOpen = true;

    try {
      // Escape HTML to prevent injection and errors
      const escapeHtml = (text: string) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      };

      // Create a temporary caption value to work with
      const tempCaption = escapeHtml(this.photoCaption || '');

      // Define preset location buttons - 3 columns layout
      const presetButtons = [
        ['Front', '1st', 'Laundry'],
        ['Left', '2nd', 'Kitchen'],
        ['Right', '3rd', 'Living'],
        ['Back', '4th', 'Dining'],
        ['Top', '5th', 'Bedroom'],
        ['Bottom', 'Floor', 'Bathroom'],
        ['Middle', 'Unit', 'Closet'],
        ['Primary', 'Attic', 'Entry'],
        ['Supply', 'Porch', 'Office'],
        ['Return', 'Deck', 'Garage'],
        ['Staircase', 'Roof', 'Indoor'],
        ['Hall', 'Ceiling', 'Outdoor']
      ];

      // Build custom HTML for the alert with preset buttons
      let buttonsHtml = '<div class="preset-buttons-container">';
      presetButtons.forEach(row => {
        buttonsHtml += '<div class="preset-row">';
        row.forEach(label => {
          buttonsHtml += `<button type="button" class="preset-btn" data-text="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
        });
        buttonsHtml += '</div>';
      });
      buttonsHtml += '</div>';

      const alert = await this.alertController.create({
        header: 'Photo Caption',
        cssClass: 'caption-popup-alert',
        message: ' ', // Empty space to prevent Ionic from hiding the message area
        buttons: [
          {
            text: 'Save',
            handler: () => {
              try {
                const input = document.getElementById('captionInput') as HTMLInputElement;
                this.photoCaption = input?.value || '';
                this.isCaptionPopupOpen = false;
                // Trigger change detection to update the UI immediately
                this.cdr.detectChanges();
                return true;
              } catch (error) {
                console.error('Error saving caption:', error);
                this.photoCaption = this.photoCaption || ''; // Keep existing value on error
                this.isCaptionPopupOpen = false;
                return true; // Don't show error to user, just close
              }
            }
          },
          {
            text: 'Cancel',
            role: 'cancel',
            handler: () => {
              this.isCaptionPopupOpen = false;
              return true;
            }
          }
        ]
      });

      await alert.present();

      // Inject HTML content immediately after presentation
      setTimeout(() => {
        try {
          const alertElement = document.querySelector('.caption-popup-alert .alert-message');
          if (!alertElement) {
            this.isCaptionPopupOpen = false;
            return;
          }

          // Build the full HTML content with inline styles for mobile app compatibility
          // Using fixed positioning (top: 5px) instead of transform for native mobile compatibility
          const htmlContent = `
            <div class="caption-popup-content">
              <div class="caption-input-container" style="position: relative; margin-bottom: 16px;">
                <input type="text" id="captionInput" class="caption-text-input"
                       placeholder="Enter caption..."
                       value="${tempCaption}"
                       maxlength="255"
                       style="width: 100%; padding: 14px 54px 14px 14px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; color: #333; background: white; box-sizing: border-box; height: 52px;" />
                <button type="button" id="undoCaptionBtn" class="undo-caption-btn" title="Undo Last Word"
                        style="position: absolute; right: 5px; top: 5px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; width: 42px; height: 42px; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; z-index: 10;">
                  <ion-icon name="backspace-outline" style="font-size: 20px; color: #666;"></ion-icon>
                </button>
              </div>
              ${buttonsHtml}
            </div>
          `;
          alertElement.innerHTML = htmlContent;

          const captionInput = document.getElementById('captionInput') as HTMLInputElement;
          const undoBtn = document.getElementById('undoCaptionBtn') as HTMLButtonElement;

          // Use event delegation for better performance
          const container = document.querySelector('.caption-popup-alert .preset-buttons-container');
          if (container && captionInput) {
            container.addEventListener('click', (e) => {
              try {
                const target = e.target as HTMLElement;
                const btn = target.closest('.preset-btn') as HTMLElement;
                if (btn) {
                  e.preventDefault();
                  e.stopPropagation();
                  const text = btn.getAttribute('data-text');
                  if (text && captionInput) {
                    // Add text + space to current caption
                    captionInput.value = (captionInput.value || '') + text + ' ';
                    // CRITICAL: Remove focus from button immediately to prevent orange highlight on mobile
                    (btn as HTMLButtonElement).blur();
                  }
                }
              } catch (error) {
                console.error('Error handling preset button click:', error);
              }
            }, { passive: false });
          }

          // Add click handler for undo button
          if (undoBtn && captionInput) {
            undoBtn.addEventListener('click', (e) => {
              try {
                e.preventDefault();
                e.stopPropagation();
                const currentValue = captionInput.value || '';
                if (currentValue.trim() === '') {
                  return;
                }
                // Trim trailing spaces and split by spaces
                const words = currentValue.trim().split(' ');
                // Remove the last word
                if (words.length > 0) {
                  words.pop();
                }
                // Join back and update input
                captionInput.value = words.join(' ');
                // Add trailing space if there are still words
                if (captionInput.value.length > 0) {
                  captionInput.value += ' ';
                }
              } catch (error) {
                console.error('Error handling undo button click:', error);
              }
            });
          }

          // CRITICAL: Add Enter key handler to prevent form submission and provide smooth save
          if (captionInput) {
            captionInput.addEventListener('keydown', (e: KeyboardEvent) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                // Find and click the Save button to trigger the save handler
                const saveBtn = document.querySelector('.caption-popup-alert button.alert-button:not([data-role="cancel"])') as HTMLButtonElement;
                if (saveBtn) {
                  saveBtn.click();
                }
              }
            });
          }
        } catch (error) {
          console.error('Error injecting caption popup content:', error);
          this.isCaptionPopupOpen = false;
        }
      }, 0);

      // Reset flag when alert is dismissed
      alert.onDidDismiss().then(() => {
        this.isCaptionPopupOpen = false;
      });

    } catch (error) {
      console.error('Error opening caption popup:', error);
      this.isCaptionPopupOpen = false;
    }
  }

  undoCaptionWord() {
    if (!this.photoCaption || this.photoCaption.trim() === '') {
      return;
    }

    // Trim trailing spaces and split by spaces
    const words = this.photoCaption.trim().split(' ');

    // Remove the last word
    if (words.length > 0) {
      words.pop();
    }

    // Join back and update caption
    this.photoCaption = words.join(' ');

    // Add trailing space if there are still words
    if (this.photoCaption.length > 0) {
      this.photoCaption += ' ';
    }
  }

  async save() {
    // DEBUG: Check what objects are on the canvas before export
    const canvasObjects = this.canvas.getObjects();

    let dataUrl: string | null = null;
    let blob: Blob | null = null;
    let canvasTainted = false;

    try {
      dataUrl = this.canvas.toDataURL({
        format: 'jpeg',
        quality: 0.9,
        multiplier: 1
      });
      blob = await this.dataUrlToBlob(dataUrl!);
    } catch (e) {
      // WEBAPP MODE: Canvas is tainted (loaded without crossOrigin), can't export image
      // But we can still save the annotation data (Drawings JSON)
      if (environment.isWeb) {
        console.warn('[Fabric Save] WEBAPP: Canvas tainted - saving annotation data only (no image export)');
        canvasTainted = true;
        // Continue to save annotation data below
      } else {
        throw e;
      }
    }

    const annotationData = this.canvas.toJSON();

    // CRITICAL: Include canvas dimensions in annotation data for proper scaling during PDF rendering
    // This allows the PDF renderer to calculate the correct scale factor
    annotationData.width = this.canvas.width;
    annotationData.height = this.canvas.height;


    const annotationJson = JSON.stringify(annotationData);
    const hasAnnotationObjects = Array.isArray(annotationData.objects) && annotationData.objects.length > 0;

    const compressedAnnotationData = hasAnnotationObjects
      ? compressAnnotationData(annotationJson) || annotationJson
      : '';

    let originalBlob = null;
    if (!this.isReEdit && this.imageFile) {
      originalBlob = this.imageFile;
    }

    // WEBAPP: If canvas was tainted, we can't export the image but we CAN save annotation data
    // The parent page will save the Drawings JSON to the server
    this.modalController.dismiss({
      annotatedBlob: blob,  // Will be null if canvas was tainted
      blob,
      dataUrl,
      annotationData,
      annotationsData: annotationData,
      annotationJson,
      compressedAnnotationData,
      annotationCount: await this.getAnnotationCount(),
      originalBlob,
      caption: this.photoCaption,
      canvasTainted  // Let parent know if we couldn't export the image
    });
  }
  private async dataUrlToBlob(dataUrl: string): Promise<Blob> {
    const response = await fetch(dataUrl);
    return await response.blob();
  }
  
  dismiss() {
    this.modalController.dismiss();
  }
  
  /**
   * Update caption container width to match the canvas/image width
   */
  private updateCaptionWidth(canvasWidth: number) {
    // Use ViewChild to access caption container
    setTimeout(() => {
      if (this.captionContainer?.nativeElement) {
        // Set the width to match the canvas width with padding for better visual alignment
        const targetWidth = Math.max(Math.min(canvasWidth, window.innerWidth * 0.85), 250);
        this.captionContainer.nativeElement.style.width = `${targetWidth}px`;
        this.captionContainer.nativeElement.style.maxWidth = `${targetWidth}px`;
        this.captionContainer.nativeElement.style.minWidth = `${targetWidth}px`;
      }
    }, 200);
  }
}
