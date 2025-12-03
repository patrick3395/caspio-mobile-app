import { Injectable } from '@angular/core';
import { ModalController, AlertController, LoadingController, Platform } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { CaspioService } from '../../../services/caspio.service';
import { DteDataService } from '../dte-data.service';
import { DteStateService } from './dte-state.service';
import { CacheService } from '../../../services/cache.service';
import { FabricService } from '../../../services/fabric.service';
import { renderAnnotationsOnPhoto } from '../../../utils/annotation-utils';

/**
 * PDF Generation Service for HUD
 * 
 * This service handles all PDF generation logic for the HUD module.
 * Based on the engineers-foundation-pdf.service.ts pattern.
 * 
 * Key methods:
 * - generatePDF(): Main entry point for PDF generation
 * - prepareProjectInfo(): Gathers project and service data
 * - prepareHUDData(): Gathers HUD visual data with photos
 */
@Injectable({
  providedIn: 'root'
})
export class DtePdfService {
  private isPDFGenerating = false;
  private pdfGenerationAttempts = 0;

  constructor(
    private modalController: ModalController,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private platform: Platform,
    private caspioService: CaspioService,
    private hudData: DteDataService,
    private stateService: DteStateService,
    private cache: CacheService,
    private fabricService: FabricService
  ) {}

  /**
   * Main PDF generation method
   * Replicates the logic from engineers-foundation-pdf.service.ts
   */
  async generatePDF(projectId: string, serviceId: string): Promise<void> {
    // Prevent multiple simultaneous PDF generation attempts
    if (this.isPDFGenerating) {
      console.log('[DTE PDF Service] PDF generation already in progress');
      return;
    }

    this.isPDFGenerating = true;
    this.pdfGenerationAttempts++;

    let loading: HTMLIonAlertElement | null = null;
    let cancelRequested = false;

    try {
      // Show loading indicator with cancel button
      loading = await this.alertController.create({
        header: 'Loading Report',
        message: 'Initializing...',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            handler: () => {
              cancelRequested = true;
              this.isPDFGenerating = false;
              console.log('[DTE PDF Service] User cancelled PDF generation');
              return true;
            }
          }
        ],
        backdropDismiss: false,
        cssClass: 'template-loading-alert'
      });
      await loading.present();

      console.log('[DTE PDF Service] Starting PDF generation for:', { projectId, serviceId });

      // Check cache first (5-minute cache)
      const cacheKey = this.cache.getApiCacheKey('hud_pdf_data', {
        serviceId: serviceId,
        timestamp: Math.floor(Date.now() / 300000) // 5-minute blocks
      });

      let hudData, projectInfo;
      const cachedData = this.cache.get(cacheKey);

      if (cachedData) {
        console.log('[DTE PDF Service] ⚡ Using cached PDF data - fast path!');
        if (loading) {
          loading.message = 'Loading from cache...';
        }
        ({ hudData, projectInfo } = cachedData);
      } else {
        console.log('[DTE PDF Service] Loading fresh PDF data...');
        if (loading) {
          loading.message = 'Loading project data...';
        }
        const startTime = Date.now();

        // Check if user cancelled
        if (cancelRequested) {
          console.log('[DTE PDF Service] Cancelled before data fetch');
          return;
        }

        try {
          // Execute all data fetching in parallel with individual error handling
          const [projectData, structuralData] = await Promise.all([
            (async () => {
              if (loading) loading.message = 'Loading project information...';
              return this.prepareProjectInfo(projectId, serviceId).catch(err => {
                console.error('[DTE PDF Service] Error in prepareProjectInfo:', err);
                return {
                  projectId: projectId,
                  serviceId: serviceId,
                  address: '',
                  clientName: '',
                  projectData: null,
                  serviceData: null
                };
              });
            })(),
            (async () => {
              if (loading) loading.message = 'Loading DTE Data...';
              return this.prepareHUDData(serviceId).catch(err => {
                console.error('[DTE PDF Service] Error in prepareHUDData:', err);
                return [];
              });
            })()
          ]);

          projectInfo = projectData;
          hudData = structuralData;

          // Cache the prepared data for faster subsequent loads
          this.cache.set(cacheKey, {
            hudData,
            projectInfo
          }, this.cache.CACHE_TIMES.MEDIUM);
          
          const loadTime = Date.now() - startTime;
          console.log(`[DTE PDF Service] Cached PDF data for reuse (5 min expiry) - loaded in ${loadTime}ms`);
        } catch (dataError) {
          console.error('[DTE PDF Service] Fatal error loading PDF data:', dataError);
          // Use fallback empty data to prevent errors
          projectInfo = {
            projectId: projectId,
            serviceId: serviceId,
            address: '',
            clientName: '',
            projectData: null,
            serviceData: null
          };
          hudData = [];
        }
      }

      // Check if user cancelled
      if (cancelRequested) {
        console.log('[DTE PDF Service] Cancelled after data fetch');
        return;
      }

      console.log('[DTE PDF Service] Data loaded, now loading PDF preview component...');
      if (loading) {
        loading.message = 'Loading PDF preview...';
      }

      // Load PDF preview component
      const PdfPreviewComponent = await this.loadPdfPreview();

      console.log('[DTE PDF Service] PDF preview component loaded:', !!PdfPreviewComponent);

      // Load primary photo after component is loaded
      if (loading) {
        loading.message = 'Processing cover photo...';
      }
      await this.loadPrimaryPhoto(projectInfo);
      
      console.log('[DTE PDF Service] Primary photo processed:', {
        hasPrimaryPhoto: !!projectInfo.primaryPhoto,
        hasPrimaryPhotoBase64: !!projectInfo.primaryPhotoBase64,
        primaryPhotoType: typeof projectInfo.primaryPhoto,
        primaryPhotoPreview: projectInfo.primaryPhoto?.substring(0, 50)
      });

      // Check if user cancelled
      if (cancelRequested) {
        console.log('[DTE PDF Service] Cancelled after component load');
        return;
      }

      // Check if PdfPreviewComponent is available
      if (!PdfPreviewComponent) {
        console.error('[DTE PDF Service] PdfPreviewComponent not available!');
        throw new Error('PdfPreviewComponent not available');
      }

      if (loading) {
        loading.message = 'Preparing PDF document...';
      }

      console.log('[DTE PDF Service] Creating PDF modal with data:', {
        projectInfo: !!projectInfo,
        hudData: hudData?.length || 0
      });

      // Create and present the PDF modal
      const modal = await this.modalController.create({
        component: PdfPreviewComponent,
        componentProps: {
          projectData: projectInfo,
          structuralData: hudData, // Reuse structuralData prop for DTE Data
          elevationData: [], // HUD doesn't have elevation data
          serviceData: {
            serviceName: 'Damaged Truss Evaluation Inspection'
          }
        },
        cssClass: 'fullscreen-modal',
        animated: this.pdfGenerationAttempts > 1,
        mode: 'ios',
        backdropDismiss: false
      });

      // Check if user cancelled
      if (cancelRequested) {
        console.log('[DTE PDF Service] Cancelled before modal present');
        return;
      }

      if (loading) {
        loading.message = 'Opening PDF...';
      }

      console.log('[DTE PDF Service] Presenting PDF modal...');
      await modal.present();
      console.log('[DTE PDF Service] PDF modal presented successfully');

      // Dismiss loading immediately after modal is presented
      setTimeout(async () => {
        try {
          if (loading) {
            await loading.dismiss();
          }
        } catch (dismissError) {
          // Ignore dismiss errors
        }
      }, 100);

      // Wait for modal to be dismissed before resetting flag
      modal.onDidDismiss().then(() => {
        this.isPDFGenerating = false;
      });

    } catch (error) {
      console.error('[DTE PDF Service] Error generating PDF:', error);
      this.isPDFGenerating = false;

      // Dismiss loading if still showing
      try {
        if (loading) {
          await loading.dismiss();
        }
      } catch (dismissError) {
        // Ignore dismiss errors
      }

      // Show error alert
      const errorDetails = error instanceof Error ?
        `Message: ${error.message}\n\nStack: ${error.stack}` :
        `Error: ${JSON.stringify(error)}`;

      const alert = await this.alertController.create({
        header: 'PDF Generation Error',
        message: `
          <div style="font-family: monospace; font-size: 12px;">
            <p style="color: red; font-weight: bold;">Failed to generate PDF</p>
            <textarea
              style="width: 100%; height: 200px; font-size: 10px; margin-top: 10px;"
              readonly>${errorDetails}</textarea>
          </div>
        `,
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  /**
   * Prepare project information for PDF
   */
  private async prepareProjectInfo(projectId: string, serviceId: string): Promise<any> {
    console.log('[DTE PDF Service] Preparing project info...');

    // Fetch project and service data
    const [projectData, serviceData] = await Promise.all([
      firstValueFrom(this.caspioService.getProject(projectId)),
      firstValueFrom(this.caspioService.getServiceById(serviceId))
    ]);

    console.log('[DTE PDF Service] ✓ Project info loaded');

    // Get primary photo
    let primaryPhoto = (projectData as any)?.PrimaryPhoto || null;

    return {
      // Project identifiers
      projectId: projectId,
      serviceId: serviceId,
      primaryPhoto: primaryPhoto,
      primaryPhotoBase64: null as string | null, // Will be populated if preloaded

      // Property address
      address: (projectData as any)?.Address || '',
      city: (projectData as any)?.City || '',
      state: (projectData as any)?.State || '',
      zip: (projectData as any)?.Zip || '',
      fullAddress: `${(projectData as any)?.Address || ''}, ${(projectData as any)?.City || ''}, ${(projectData as any)?.State || ''} ${(projectData as any)?.Zip || ''}`,

      // People & Roles
      clientName: (projectData as any)?.ClientName || (projectData as any)?.Owner || '',
      agentName: (projectData as any)?.AgentName || '',
      inspectorName: (projectData as any)?.InspectorName || '',
      inAttendance: (serviceData as any)?.InAttendance || '',

      // Property Details
      yearBuilt: (projectData as any)?.YearBuilt || '',
      squareFeet: (projectData as any)?.SquareFeet || '',
      typeOfBuilding: (projectData as any)?.TypeOfBuilding || '',
      style: (projectData as any)?.Style || '',
      occupancyFurnishings: (serviceData as any)?.OccupancyFurnishings || '',

      // Environmental Conditions
      weatherConditions: (serviceData as any)?.WeatherConditions || '',
      outdoorTemperature: (serviceData as any)?.OutdoorTemperature || '',

      // HUD-Specific Details
      manufacturer: (serviceData as any)?.Manufacturer || '',
      serialNumber: (serviceData as any)?.SerialNumber || '',
      hudLabel: (serviceData as any)?.HUDLabel || '',

      // Additional Information
      ownerOccupantInterview: (serviceData as any)?.OwnerOccupantInterview || '',

      // Inspection Details
      inspectionDate: this.formatDate((serviceData as any)?.DateOfInspection || new Date().toISOString()),

      // Company information
      inspectorPhone: '936-202-8013',
      inspectorEmail: 'info@noblepropertyinspections.com',
      companyName: 'Noble Property Inspections',

      // All raw data for debugging
      projectData: projectData,
      serviceData: serviceData
    };
  }

  /**
   * Prepare DTE Data for PDF
   * Gathers all HUD visuals organized by category with photos
   */
  private async prepareHUDData(serviceId: string): Promise<any[]> {
    console.log('[DTE PDF Service] Preparing DTE Data...');

    const result = [];

    // Get all HUD visuals for this service
    // CRITICAL: Bypass cache to ensure we get the latest data for PDF
    const allVisuals = await this.hudData.getVisualsByService(serviceId, true);
    
    console.log('[DTE PDF Service] ========== DTE Data DEBUG ==========');
    console.log('[DTE PDF Service] ServiceID:', serviceId);
    console.log('[DTE PDF Service] Total visuals fetched:', allVisuals?.length || 0);
    if (allVisuals && allVisuals.length > 0) {
      console.log('[DTE PDF Service] Sample visual:', JSON.stringify(allVisuals[0], null, 2));
      // Log all category names for debugging
      const uniqueCategories = [...new Set(allVisuals.map((v: any) => v.Category))];
      console.log('[DTE PDF Service] Unique categories in data:', uniqueCategories);
    } else {
      console.warn('[DTE PDF Service] ⚠️ NO HUD RECORDS FOUND! This is why PDF is empty.');
    }

    // CRITICAL: Dynamically extract categories from the actual data
    // Don't use hardcoded categories - they may not match the database
    const organizedData: any = {};
    const categoryOrder: string[] = [];

    // Group visuals by category and type
    // CRITICAL: Use 'Kind' field not 'Type' field from database
    for (const visual of allVisuals || []) {
      const category = visual.Category || 'Other';
      const kind = visual.Kind || visual.Type || 'Comment';
      
      // CRITICAL: Skip hidden visuals
      if (visual.Notes && visual.Notes.startsWith('HIDDEN')) {
        console.log('[DTE PDF Service] Skipping hidden visual:', visual.Name);
        continue;
      }
      
      console.log('[DTE PDF Service] Visual:', visual.Name, 'Category:', category, 'Kind:', kind);

      // Initialize category if not already present
      if (!organizedData[category]) {
        organizedData[category] = {
          comments: [],
          limitations: [],
          deficiencies: []
        };
        categoryOrder.push(category);
      }

      if (kind === 'Comment') {
        organizedData[category].comments.push(visual);
      } else if (kind === 'Limitation') {
        organizedData[category].limitations.push(visual);
      } else if (kind === 'Deficiency') {
        organizedData[category].deficiencies.push(visual);
      } else {
        // Default to comments if kind is unknown
        console.warn('[DTE PDF Service] Unknown Kind value:', kind, 'for visual:', visual.Name);
        organizedData[category].comments.push(visual);
      }
    }
    
    console.log('[DTE PDF Service] Found categories:', categoryOrder);

    // Load Fabric.js for annotation rendering
    const fabric = await this.fabricService.getFabric();

    // Process each category (using dynamically extracted categories)
    for (const category of categoryOrder) {
      const categoryData = organizedData[category];
      if (!categoryData) continue;

      const categoryResult: any = {
        name: category,
        comments: [],
        limitations: [],
        deficiencies: []
      };

      // Collect all photo fetch promises for parallel execution
      const photoFetches: Promise<any>[] = [];
      const photoMappings: { type: string, item: any, index: number }[] = [];

      // Process comments
      if (categoryData.comments) {
        for (const comment of categoryData.comments) {
          const DTEID = comment.DTEID || comment.PK_ID;

          let displayText = comment.Text || comment.VisualText || '';
          let answers = comment.Answers || '';

          photoFetches.push(this.getHUDPhotos(DTEID, fabric));
          photoMappings.push({
            type: 'comments',
            item: {
              name: comment.Name || comment.VisualName || '',
              text: displayText,
              answers: answers,
              visualId: DTEID
            },
            index: photoFetches.length - 1
          });
        }
      }

      // Process limitations
      if (categoryData.limitations) {
        for (const limitation of categoryData.limitations) {
          const DTEID = limitation.DTEID || limitation.PK_ID;

          let displayText = limitation.Text || limitation.VisualText || '';
          let answers = limitation.Answers || '';

          photoFetches.push(this.getHUDPhotos(DTEID, fabric));
          photoMappings.push({
            type: 'limitations',
            item: {
              name: limitation.Name || limitation.VisualName || '',
              text: displayText,
              answers: answers,
              visualId: DTEID
            },
            index: photoFetches.length - 1
          });
        }
      }

      // Process deficiencies
      if (categoryData.deficiencies) {
        for (const deficiency of categoryData.deficiencies) {
          const DTEID = deficiency.DTEID || deficiency.PK_ID;

          let displayText = deficiency.Text || deficiency.VisualText || '';
          let answers = deficiency.Answers || '';

          photoFetches.push(this.getHUDPhotos(DTEID, fabric));
          photoMappings.push({
            type: 'deficiencies',
            item: {
              name: deficiency.Name || deficiency.VisualName || '',
              text: displayText,
              answers: answers,
              visualId: DTEID
            },
            index: photoFetches.length - 1
          });
        }
      }

      // Fetch all photos in parallel
      const allPhotos = await Promise.all(photoFetches);

      // Map photos back to their items
      photoMappings.forEach(mapping => {
        const photos = allPhotos[mapping.index];
        const itemWithPhotos = { ...mapping.item, photos };
        categoryResult[mapping.type].push(itemWithPhotos);
      });

      // Only add category if it has selected items
      if (categoryResult.comments.length > 0 ||
          categoryResult.limitations.length > 0 ||
          categoryResult.deficiencies.length > 0) {
        result.push(categoryResult);
      }
    }

    const totalItems = result.reduce((sum, cat) =>
      sum + cat.comments.length + cat.limitations.length + cat.deficiencies.length, 0);
    
    const totalComments = result.reduce((sum, cat) => sum + cat.comments.length, 0);
    const totalLimitations = result.reduce((sum, cat) => sum + cat.limitations.length, 0);
    const totalDeficiencies = result.reduce((sum, cat) => sum + cat.deficiencies.length, 0);

    console.log(`[DTE PDF Service] ✓ DTE Data loaded: ${result.length} categories with ${totalItems} total items`);
    console.log(`[DTE PDF Service]   - Comments: ${totalComments}`);
    console.log(`[DTE PDF Service]   - Limitations: ${totalLimitations}`);
    console.log(`[DTE PDF Service]   - Deficiencies: ${totalDeficiencies}`);

    return result;
  }

  /**
   * Get photos for a HUD item with annotation rendering
   */
  private async getHUDPhotos(DTEID: string, fabric: any): Promise<any[]> {
    try {
      const attachments = await this.hudData.getVisualAttachments(DTEID);
      const photos = [];

      for (const attachment of (attachments || [])) {
        let photoUrl = attachment.Photo || attachment.PhotoPath || '';

        if (photoUrl && photoUrl.startsWith('/')) {
          try {
            const base64Data = await firstValueFrom(this.caspioService.getImageFromFilesAPI(photoUrl));
            if (base64Data && base64Data.startsWith('data:')) {
              let finalUrl = base64Data;

              // Render annotations if drawings exist
              const drawingsData = attachment.Drawings || null;
              if (drawingsData) {
                try {
                  const annotatedUrl = await renderAnnotationsOnPhoto(finalUrl, drawingsData, { quality: 0.9, format: 'jpeg', fabric });
                  if (annotatedUrl && annotatedUrl !== finalUrl) {
                    finalUrl = annotatedUrl;
                  }
                } catch (renderError) {
                  console.error(`[DTE PDF Service] Error rendering photo annotation:`, renderError);
                }
              }

              photos.push({
                url: finalUrl,
                caption: attachment.Annotation || attachment.Caption || '',
                conversionSuccess: true
              });
            }
          } catch (error) {
            console.error(`[DTE PDF Service] Failed to convert HUD photo:`, error);
            photos.push({
              url: '',
              caption: attachment.Annotation || attachment.Caption || '',
              conversionSuccess: false
            });
          }
        }
      }

      return photos;
    } catch (error) {
      console.error(`[DTE PDF Service] Error getting HUD photos:`, error);
      return [];
    }
  }

  /**
   * Load primary photo for project
   */
  private async loadPrimaryPhoto(projectInfo: any): Promise<void> {
    console.log('[DTE PDF Service] loadPrimaryPhoto called with:', {
      hasPrimaryPhoto: !!projectInfo?.primaryPhoto,
      primaryPhotoType: typeof projectInfo?.primaryPhoto,
      primaryPhotoStart: projectInfo?.primaryPhoto?.substring(0, 50)
    });

    if (projectInfo?.primaryPhoto && typeof projectInfo.primaryPhoto === 'string') {
      let convertedPhotoData: string | null = null;

      if (projectInfo.primaryPhoto.startsWith('/')) {
        // Caspio file path - convert to base64
        console.log('[DTE PDF Service] Converting Caspio file path to base64:', projectInfo.primaryPhoto);
        try {
          const imageData = await firstValueFrom(this.caspioService.getImageFromFilesAPI(projectInfo.primaryPhoto));
          if (imageData && typeof imageData === 'string' && imageData.startsWith('data:')) {
            convertedPhotoData = imageData;
            console.log('[DTE PDF Service] ✓ Primary photo converted successfully, size:', Math.round(imageData.length / 1024), 'KB');
          } else {
            console.error('[DTE PDF Service] ✗ Primary photo conversion failed - invalid data');
          }
        } catch (error) {
          console.error('[DTE PDF Service] ✗ Error converting primary photo:', error);
        }
      } else if (projectInfo.primaryPhoto.startsWith('data:')) {
        console.log('[DTE PDF Service] Primary photo already base64');
        convertedPhotoData = projectInfo.primaryPhoto;
      } else if (projectInfo.primaryPhoto.startsWith('blob:')) {
        console.log('[DTE PDF Service] Converting blob URL to base64');
        try {
          const response = await fetch(projectInfo.primaryPhoto);
          const blob = await response.blob();
          const reader = new FileReader();
          const base64 = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          convertedPhotoData = base64;
          console.log('[DTE PDF Service] ✓ Blob converted to base64');
        } catch (error) {
          console.error('[DTE PDF Service] ✗ Error converting blob URL:', error);
        }
      } else {
        console.log('[DTE PDF Service] Primary photo has unknown format:', projectInfo.primaryPhoto.substring(0, 50));
      }

      // Set both fields so PDF component can use either one
      if (convertedPhotoData) {
        projectInfo.primaryPhotoBase64 = convertedPhotoData;
        projectInfo.primaryPhoto = convertedPhotoData;
        console.log('[DTE PDF Service] ✓ Primary photo fields set on projectInfo');
      } else {
        console.warn('[DTE PDF Service] ✗ No converted photo data - photo will not appear in PDF');
      }
    } else {
      console.log('[DTE PDF Service] No primary photo to load');
    }
  }

  /**
   * Load PDF preview component dynamically
   */
  private async loadPdfPreview(): Promise<any> {
    try {
      console.log('[DTE PDF Service] Loading PDF preview component module...');
      const module = await import('../../../components/pdf-preview/pdf-preview.component');
      console.log('[DTE PDF Service] PDF preview component module loaded:', !!module.PdfPreviewComponent);
      return module.PdfPreviewComponent;
    } catch (error) {
      console.error('[DTE PDF Service] Error loading PDF preview component:', error);
      throw error;
    }
  }

  /**
   * Format date for display
   */
  private formatDate(dateString: string): string {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString();
    } catch {
      return dateString;
    }
  }

  isGenerating(): boolean {
    return this.isPDFGenerating;
  }
}
