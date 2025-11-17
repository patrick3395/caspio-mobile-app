import { Injectable } from '@angular/core';
import { ModalController, AlertController, LoadingController, Platform } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { CaspioService } from '../../../services/caspio.service';
import { EngineersFoundationDataService } from '../engineers-foundation-data.service';
import { EngineersFoundationStateService } from './engineers-foundation-state.service';
import { CacheService } from '../../../services/cache.service';
import { FabricService } from '../../../services/fabric.service';
import { renderAnnotationsOnPhoto } from '../../../utils/annotation-utils';

/**
 * PDF Generation Service for Engineers Foundation
 * 
 * This service handles all PDF generation logic for the refactored Engineers Foundation module.
 * It replicates the PDF preparation methods from the original monolithic component.
 * 
 * Key methods:
 * - generatePDF(): Main entry point for PDF generation
 * - prepareProjectInfo(): Gathers project and service data
 * - prepareStructuralSystemsData(): Gathers structural systems visual data
 * - prepareElevationPlotData(): Gathers elevation plot data with photos
 */
@Injectable({
  providedIn: 'root'
})
export class EngineersFoundationPdfService {
  private isPDFGenerating = false;
  private pdfGenerationAttempts = 0;

  constructor(
    private modalController: ModalController,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private platform: Platform,
    private caspioService: CaspioService,
    private foundationData: EngineersFoundationDataService,
    private stateService: EngineersFoundationStateService,
    private cache: CacheService,
    private fabricService: FabricService
  ) {}

  /**
   * Main PDF generation method
   * Replicates the logic from the original engineers-foundation.page.ts generatePDF method
   */
  async generatePDF(projectId: string, serviceId: string): Promise<void> {
    // Prevent multiple simultaneous PDF generation attempts
    if (this.isPDFGenerating) {
      console.log('[PDF Service] PDF generation already in progress');
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
              console.log('[PDF Service] User cancelled PDF generation');
              return true;
            }
          }
        ],
        backdropDismiss: false,
        cssClass: 'template-loading-alert'
      });
      await loading.present();

      console.log('[PDF Service] Starting PDF generation for:', { projectId, serviceId });

      // Check cache first (5-minute cache)
      const cacheKey = this.cache.getApiCacheKey('pdf_data', {
        serviceId: serviceId,
        timestamp: Math.floor(Date.now() / 300000) // 5-minute blocks
      });

      let structuralSystemsData, elevationPlotData, projectInfo;
      const cachedData = this.cache.get(cacheKey);

      if (cachedData) {
        console.log('[PDF Service] ⚡ Using cached PDF data - fast path!');
        if (loading) {
          loading.message = 'Loading from cache...';
        }
        ({ structuralSystemsData, elevationPlotData, projectInfo } = cachedData);
      } else {
        console.log('[PDF Service] Loading fresh PDF data...');
        if (loading) {
          loading.message = 'Loading project data...';
        }
        const startTime = Date.now();

        // Check if user cancelled
        if (cancelRequested) {
          console.log('[PDF Service] Cancelled before data fetch');
          return;
        }

        try {
          // Execute all data fetching in parallel with individual error handling
          const [projectData, structuralData, elevationData] = await Promise.all([
            (async () => {
              if (loading) loading.message = 'Loading project information...';
              return this.prepareProjectInfo(projectId, serviceId).catch(err => {
                console.error('[PDF Service] Error in prepareProjectInfo:', err);
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
              if (loading) loading.message = 'Loading structural systems...';
              return this.prepareStructuralSystemsData(serviceId).catch(err => {
                console.error('[PDF Service] Error in prepareStructuralSystemsData:', err);
                return [];
              });
            })(),
            (async () => {
              if (loading) loading.message = 'Loading elevation plots...';
              return this.prepareElevationPlotData(serviceId).catch(err => {
                console.error('[PDF Service] Error in prepareElevationPlotData:', err);
                return [];
              });
            })()
          ]);

          projectInfo = projectData;
          structuralSystemsData = structuralData;
          elevationPlotData = elevationData;

          // Cache the prepared data for faster subsequent loads
          this.cache.set(cacheKey, {
            structuralSystemsData,
            elevationPlotData,
            projectInfo
          }, this.cache.CACHE_TIMES.MEDIUM);
          
          const loadTime = Date.now() - startTime;
          console.log(`[PDF Service] Cached PDF data for reuse (5 min expiry) - loaded in ${loadTime}ms`);
        } catch (dataError) {
          console.error('[PDF Service] Fatal error loading PDF data:', dataError);
          // Use fallback empty data to prevent errors
          projectInfo = {
            projectId: projectId,
            serviceId: serviceId,
            address: '',
            clientName: '',
            projectData: null,
            serviceData: null
          };
          structuralSystemsData = [];
          elevationPlotData = [];
        }
      }

      // Check if user cancelled
      if (cancelRequested) {
        console.log('[PDF Service] Cancelled after data fetch');
        return;
      }

      console.log('[PDF Service] Data loaded, now loading PDF preview component...');
      if (loading) {
        loading.message = 'Loading PDF preview...';
      }

      // Load PDF preview component and primary photo in parallel
      const [PdfPreviewComponent] = await Promise.all([
        this.loadPdfPreview(),
        // Load primary photo (cover photo) in parallel
        (async () => {
          if (loading) loading.message = 'Processing cover photo...';
          return this.loadPrimaryPhoto(projectInfo);
        })()
      ]);

      console.log('[PDF Service] PDF preview component loaded:', !!PdfPreviewComponent);

      // Check if user cancelled
      if (cancelRequested) {
        console.log('[PDF Service] Cancelled after component load');
        return;
      }

      // Check if PdfPreviewComponent is available
      if (!PdfPreviewComponent) {
        console.error('[PDF Service] PdfPreviewComponent not available!');
        throw new Error('PdfPreviewComponent not available');
      }

      if (loading) {
        loading.message = 'Preparing PDF document...';
      }

      console.log('[PDF Service] Creating PDF modal with data:', {
        projectInfo: !!projectInfo,
        structuralData: structuralSystemsData?.length || 0,
        elevationData: elevationPlotData?.length || 0
      });

      // Create and present the PDF modal
      const modal = await this.modalController.create({
        component: PdfPreviewComponent,
        componentProps: {
          projectData: projectInfo,
          structuralData: structuralSystemsData,
          elevationData: elevationPlotData,
          serviceData: {
            serviceName: 'EFE - Engineer\'s Foundation Evaluation'
          }
        },
        cssClass: 'fullscreen-modal',
        animated: this.pdfGenerationAttempts > 1,
        mode: 'ios',
        backdropDismiss: false
      });

      // Check if user cancelled
      if (cancelRequested) {
        console.log('[PDF Service] Cancelled before modal present');
        return;
      }

      if (loading) {
        loading.message = 'Opening PDF...';
      }

      console.log('[PDF Service] Presenting PDF modal...');
      await modal.present();
      console.log('[PDF Service] PDF modal presented successfully');

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
      console.error('[PDF Service] Error generating PDF:', error);
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
   * Replicates prepareProjectInfo from original engineers-foundation.page.ts
   */
  private async prepareProjectInfo(projectId: string, serviceId: string): Promise<any> {
    console.log('[PDF Service] Preparing project info...');

    // Fetch project and service data
    const [projectData, serviceData] = await Promise.all([
      firstValueFrom(this.caspioService.getProject(projectId)),
      firstValueFrom(this.caspioService.getServiceById(serviceId))
    ]);

    console.log('[PDF Service] ✓ Project info loaded');

    // Get primary photo
    let primaryPhoto = (projectData as any)?.PrimaryPhoto || null;

    // Handle "Other" values from state service
    const stateData = this.stateService.getProjectData();

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

      // Foundation Details
      firstFoundationType: (serviceData as any)?.FirstFoundationType || '',
      secondFoundationType: (serviceData as any)?.SecondFoundationType || '',
      secondFoundationRooms: (serviceData as any)?.SecondFoundationRooms || '',
      thirdFoundationType: (serviceData as any)?.ThirdFoundationType || '',
      thirdFoundationRooms: (serviceData as any)?.ThirdFoundationRooms || '',

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
   * Prepare structural systems data for PDF
   * Replicates prepareStructuralSystemsData from original engineers-foundation.page.ts
   */
  private async prepareStructuralSystemsData(serviceId: string): Promise<any[]> {
    console.log('[PDF Service] Preparing structural systems data...');

    const result = [];

    // Get all visual categories
    const visualCategories = [
      'Foundations',
      'Grading and Drainage',
      'General Conditions',
      'Roof Structure',
      'Floor Framing',
      'Wall Framing',
      'Attic',
      'Crawlspace',
      'Crawlspaces',
      'Walls (Interior and Exterior)',
      'Ceilings and Floors',
      'Doors (Interior and Exterior)',
      'Windows',
      'Basements',
      'Other'
    ];

    // Get all visuals for this service
    const allVisuals = await this.foundationData.getVisualsByService(serviceId);

    // Organize visuals by category
    const organizedData: any = {};
    for (const category of visualCategories) {
      organizedData[category] = {
        comments: [],
        limitations: [],
        deficiencies: []
      };
    }

    // Group visuals by category and type
    for (const visual of allVisuals || []) {
      const category = visual.Category || 'Other';
      const type = visual.Type?.toLowerCase() || 'comments';

      if (organizedData[category]) {
        if (type === 'comment' || type === 'comments') {
          organizedData[category].comments.push(visual);
        } else if (type === 'limitation' || type === 'limitations') {
          organizedData[category].limitations.push(visual);
        } else if (type === 'deficiency' || type === 'deficiencies') {
          organizedData[category].deficiencies.push(visual);
        }
      }
    }

    // Process each category
    for (const category of visualCategories) {
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
          const visualId = comment.VisualID || comment.PK_ID;

          // Prepare the text to display
          let displayText = comment.Text || comment.VisualText || '';
          let answers = comment.Answer || '';

          photoFetches.push(this.getVisualPhotos(visualId));
          photoMappings.push({
            type: 'comments',
            item: {
              name: comment.Name || comment.VisualName || '',
              text: displayText,
              answers: answers,
              visualId: visualId
            },
            index: photoFetches.length - 1
          });
        }
      }

      // Process limitations
      if (categoryData.limitations) {
        for (const limitation of categoryData.limitations) {
          const visualId = limitation.VisualID || limitation.PK_ID;

          let displayText = limitation.Text || limitation.VisualText || '';
          let answers = limitation.Answer || '';

          photoFetches.push(this.getVisualPhotos(visualId));
          photoMappings.push({
            type: 'limitations',
            item: {
              name: limitation.Name || limitation.VisualName || '',
              text: displayText,
              answers: answers,
              visualId: visualId
            },
            index: photoFetches.length - 1
          });
        }
      }

      // Process deficiencies
      if (categoryData.deficiencies) {
        for (const deficiency of categoryData.deficiencies) {
          const visualId = deficiency.VisualID || deficiency.PK_ID;

          let displayText = deficiency.Text || deficiency.VisualText || '';
          let answers = deficiency.Answer || '';

          photoFetches.push(this.getVisualPhotos(visualId));
          photoMappings.push({
            type: 'deficiencies',
            item: {
              name: deficiency.Name || deficiency.VisualName || '',
              text: displayText,
              answers: answers,
              visualId: visualId
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

    console.log(`[PDF Service] ✓ Structural systems loaded: ${result.length} categories with ${totalItems} total items`);

    return result;
  }

  /**
   * Prepare elevation plot data for PDF
   * Replicates prepareElevationPlotData from original engineers-foundation.page.ts
   */
  private async prepareElevationPlotData(serviceId: string): Promise<any[]> {
    console.log('[PDF Service] Preparing elevation plot data...');

    const result: any[] = [];

    // Load Fabric.js for annotation rendering
    const fabric = await this.fabricService.getFabric();

    // Get all EFE rooms for this service
    const allRooms = await this.foundationData.getEFEByService(serviceId);

    if (!allRooms || allRooms.length === 0) {
      console.log('[PDF Service] No elevation rooms found');
      return result;
    }

    // Process each room
    for (const roomRecord of allRooms) {
      const roomName = roomRecord.RoomName || 'Unknown Room';
      const roomId = roomRecord.EFEID || roomRecord.PK_ID;

      const roomResult: any = {
        name: roomName,
        fdf: roomRecord.FDF || '',
        fdfPhotos: {},
        notes: roomRecord.Notes || '',
        points: [],
        photos: []
      };

      // Fetch FDF photos from Services_EFE table and convert to base64
      if (roomId) {
        try {
          // Process each FDF photo type with annotation fields
          const fdfPhotoTypes = [
            { field: 'FDFPhotoTop', key: 'top', annotationField: 'FDFTopAnnotation', drawingsField: 'FDFTopDrawings' },
            { field: 'FDFPhotoBottom', key: 'bottom', annotationField: 'FDFBottomAnnotation', drawingsField: 'FDFBottomDrawings' },
            { field: 'FDFPhotoThreshold', key: 'threshold', annotationField: 'FDFThresholdAnnotation', drawingsField: 'FDFThresholdDrawings' }
          ];

          const fdfPhotosData: any = {};

          for (const photoType of fdfPhotoTypes) {
            const photoPath = roomRecord[photoType.field];

            if (photoPath && photoPath.startsWith('/')) {
              try {
                const base64Data = await firstValueFrom(this.caspioService.getImageFromFilesAPI(photoPath));
                if (base64Data && base64Data.startsWith('data:')) {
                  let finalUrl = base64Data;

                  // Load caption and drawings
                  const caption = roomRecord[photoType.annotationField] || '';
                  const drawingsData = roomRecord[photoType.drawingsField] || null;

                  // Render annotations if drawings data exists
                  if (drawingsData) {
                    try {
                      const annotatedUrl = await renderAnnotationsOnPhoto(finalUrl, drawingsData, { quality: 0.9, format: 'jpeg', fabric });
                      if (annotatedUrl && annotatedUrl !== finalUrl) {
                        finalUrl = annotatedUrl;
                      }
                    } catch (renderError) {
                      console.error(`[PDF Service] Error rendering annotations for ${photoType.key}:`, renderError);
                    }
                  }

                  fdfPhotosData[photoType.key] = true;
                  fdfPhotosData[`${photoType.key}Url`] = finalUrl;
                  fdfPhotosData[`${photoType.key}Caption`] = caption;
                  fdfPhotosData[`${photoType.key}Drawings`] = drawingsData;
                }
              } catch (error) {
                console.error(`[PDF Service] Failed to convert FDF ${photoType.key} photo:`, error);
              }
            }
          }

          roomResult.fdfPhotos = fdfPhotosData;
        } catch (error) {
          console.error(`[PDF Service] Error fetching FDF photos for room ${roomName}:`, error);
        }

        // Get all points for this room
        try {
          const dbPoints = await this.foundationData.getEFEPoints(roomId);

          for (const dbPoint of (dbPoints || [])) {
            const pointId = dbPoint.PointID || dbPoint.PK_ID;
            const pointName = dbPoint.PointName;
            const pointValue = dbPoint.Measurement || '';

            const pointData: any = {
              name: pointName,
              value: pointValue,
              pointId: pointId,
              photos: []
            };

            // Fetch attachments for this point
            if (pointId) {
              const attachments = await this.foundationData.getEFEAttachments(pointId);

              for (const attachment of (attachments || [])) {
                let photoUrl = attachment.Photo || '';

                // Convert Caspio file paths to base64
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
                          console.error(`[PDF Service] Error rendering point photo annotation:`, renderError);
                        }
                      }

                      pointData.photos.push({
                        url: finalUrl,
                        caption: attachment.Caption || '',
                        conversionSuccess: true
                      });
                    }
                  } catch (error) {
                    console.error(`[PDF Service] Failed to convert point photo:`, error);
                  }
                }
              }
            }

            roomResult.points.push(pointData);
          }
        } catch (error) {
          console.error(`[PDF Service] Error loading points for room ${roomName}:`, error);
        }
      }

      result.push(roomResult);
    }

    console.log(`[PDF Service] ✓ Elevation plots loaded: ${result.length} rooms`);

    return result;
  }

  /**
   * Get photos for a visual item
   */
  private async getVisualPhotos(visualId: string): Promise<any[]> {
    try {
      const attachments = await this.foundationData.getVisualAttachments(visualId);
      const photos = [];

      for (const attachment of (attachments || [])) {
        let photoUrl = attachment.Photo || attachment.PhotoPath || '';

        if (photoUrl && photoUrl.startsWith('/')) {
          try {
            const base64Data = await firstValueFrom(this.caspioService.getImageFromFilesAPI(photoUrl));
            if (base64Data && base64Data.startsWith('data:')) {
              photos.push({
                url: base64Data,
                caption: attachment.Caption || '',
                conversionSuccess: true
              });
            }
          } catch (error) {
            console.error(`[PDF Service] Failed to convert visual photo:`, error);
            photos.push({
              url: '',
              caption: attachment.Caption || '',
              conversionSuccess: false
            });
          }
        }
      }

      return photos;
    } catch (error) {
      console.error(`[PDF Service] Error getting visual photos:`, error);
      return [];
    }
  }

  /**
   * Load primary photo for project
   */
  private async loadPrimaryPhoto(projectInfo: any): Promise<void> {
    if (projectInfo?.primaryPhoto && typeof projectInfo.primaryPhoto === 'string') {
      let convertedPhotoData: string | null = null;

      if (projectInfo.primaryPhoto.startsWith('/')) {
        // Caspio file path - convert to base64
        try {
          const imageData = await firstValueFrom(this.caspioService.getImageFromFilesAPI(projectInfo.primaryPhoto));
          if (imageData && typeof imageData === 'string' && imageData.startsWith('data:')) {
            convertedPhotoData = imageData;
          }
        } catch (error) {
          console.error('[PDF Service] Error converting primary photo:', error);
        }
      } else if (projectInfo.primaryPhoto.startsWith('data:')) {
        convertedPhotoData = projectInfo.primaryPhoto;
      } else if (projectInfo.primaryPhoto.startsWith('blob:')) {
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
        } catch (error) {
          console.error('[PDF Service] Error converting blob URL:', error);
        }
      }

      // Set both fields so PDF component can use either one
      if (convertedPhotoData) {
        projectInfo.primaryPhotoBase64 = convertedPhotoData;
        projectInfo.primaryPhoto = convertedPhotoData;
      }
    }
  }

  /**
   * Load PDF preview component dynamically
   */
  private async loadPdfPreview(): Promise<any> {
    try {
      console.log('[PDF Service] Loading PDF preview component module...');
      const module = await import('../../../components/pdf-preview/pdf-preview.component');
      console.log('[PDF Service] PDF preview component module loaded:', !!module.PdfPreviewComponent);
      return module.PdfPreviewComponent;
    } catch (error) {
      console.error('[PDF Service] Error loading PDF preview component:', error);
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
}

