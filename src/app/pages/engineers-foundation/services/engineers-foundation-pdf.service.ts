import { Injectable } from '@angular/core';
import { ModalController, AlertController, LoadingController, Platform } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { CaspioService } from '../../../services/caspio.service';
import { EngineersFoundationDataService } from '../engineers-foundation-data.service';
import { EngineersFoundationStateService } from './engineers-foundation-state.service';
import { CacheService } from '../../../services/cache.service';
import { FabricService } from '../../../services/fabric.service';
import { IndexedDbService } from '../../../services/indexed-db.service';
import { LocalImageService } from '../../../services/local-image.service';
import { renderAnnotationsOnPhoto } from '../../../utils/annotation-utils';
import { environment } from '../../../../environments/environment';

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
    private fabricService: FabricService,
    private indexedDb: IndexedDbService,
    private localImageService: LocalImageService
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
    let currentProgress = 0;

    // Helper to update progress (web only)
    const updateProgress = (percent: number, step: string) => {
      currentProgress = percent;
      if (loading && environment.isWeb) {
        const percentEl = document.querySelector('.progress-percentage');
        const barEl = document.querySelector('.progress-bar-fill') as HTMLElement;
        const stepEl = document.querySelector('.progress-step');
        if (percentEl) percentEl.textContent = `${percent}%`;
        if (barEl) barEl.style.width = `${percent}%`;
        if (stepEl) stepEl.textContent = step;
      } else if (loading) {
        loading.message = step;
      }
    };

    try {
      // Show loading indicator with cancel button
      // Web: Show progress bar with percentage
      // Mobile: Show simple loading message
      const alertMessage = environment.isWeb
        ? `<div class="progress-container">
            <div class="progress-percentage">0%</div>
            <div class="progress-bar-wrapper">
              <div class="progress-bar-fill" style="width: 0%"></div>
            </div>
            <div class="progress-step">Initializing...</div>
          </div>`
        : 'Initializing...';

      loading = await this.alertController.create({
        header: 'Loading Report',
        message: alertMessage,
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
        cssClass: environment.isWeb ? 'progress-loading-alert' : 'template-loading-alert'
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
        updateProgress(50, 'Loading from cache...');
        ({ structuralSystemsData, elevationPlotData, projectInfo } = cachedData);
      } else {
        console.log('[PDF Service] Loading fresh PDF data...');
        updateProgress(5, 'Loading project data...');
        const startTime = Date.now();

        // Check if user cancelled
        if (cancelRequested) {
          console.log('[PDF Service] Cancelled before data fetch');
          return;
        }

        try {
          // Execute all data fetching in parallel with individual error handling
          updateProgress(10, 'Loading project information...');
          const [projectData, structuralData, elevationData] = await Promise.all([
            (async () => {
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
              return this.prepareStructuralSystemsData(serviceId).catch(err => {
                console.error('[PDF Service] Error in prepareStructuralSystemsData:', err);
                return [];
              });
            })(),
            (async () => {
              return this.prepareElevationPlotData(serviceId).catch(err => {
                console.error('[PDF Service] Error in prepareElevationPlotData:', err);
                return [];
              });
            })()
          ]);

          updateProgress(40, 'Processing data...');
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
      updateProgress(55, 'Loading PDF preview...');

      // Load PDF preview component
      const PdfPreviewComponent = await this.loadPdfPreview();

      console.log('[PDF Service] PDF preview component loaded:', !!PdfPreviewComponent);

      // Load primary photo after component is loaded
      updateProgress(70, 'Processing cover photo...');
      await this.loadPrimaryPhoto(projectInfo);

      console.log('[PDF Service] Primary photo processed:', {
        hasPrimaryPhoto: !!projectInfo.primaryPhoto,
        hasPrimaryPhotoBase64: !!projectInfo.primaryPhotoBase64,
        primaryPhotoType: typeof projectInfo.primaryPhoto,
        primaryPhotoPreview: projectInfo.primaryPhoto?.substring(0, 50)
      });

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

      updateProgress(85, 'Preparing PDF document...');

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

      updateProgress(95, 'Opening PDF...');

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
    // CRITICAL: Use 'Kind' field not 'Type' field from database
    for (const visual of allVisuals || []) {
      const category = visual.Category || 'Other';
      const kind = visual.Kind || visual.Type || 'Comment'; // Use Kind field (fallback to Type or Comment)
      
      console.log('[PDF Service] Visual:', visual.Name, 'Category:', category, 'Kind:', kind);

      if (organizedData[category]) {
        if (kind === 'Comment') {
          organizedData[category].comments.push(visual);
        } else if (kind === 'Limitation') {
          organizedData[category].limitations.push(visual);
        } else if (kind === 'Deficiency') {
          organizedData[category].deficiencies.push(visual);
        } else {
          // Default to comments if kind is unknown
          console.warn('[PDF Service] Unknown Kind value:', kind, 'for visual:', visual.Name);
          organizedData[category].comments.push(visual);
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
    
    const totalComments = result.reduce((sum, cat) => sum + cat.comments.length, 0);
    const totalLimitations = result.reduce((sum, cat) => sum + cat.limitations.length, 0);
    const totalDeficiencies = result.reduce((sum, cat) => sum + cat.deficiencies.length, 0);

    console.log(`[PDF Service] ✓ Structural systems loaded: ${result.length} categories with ${totalItems} total items`);
    console.log(`[PDF Service]   - Comments: ${totalComments}`);
    console.log(`[PDF Service]   - Limitations: ${totalLimitations}`);
    console.log(`[PDF Service]   - Deficiencies: ${totalDeficiencies}`);

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

            if (photoPath) {
              try {
                // DEXIE-FIRST: Use cache key based on room ID and photo type
                const cacheKey = `fdf_${roomId}_${photoType.key}`;
                let base64Data: string | null = null;

                // Check if photoPath is already a data URL (local image)
                if (photoPath.startsWith('data:') || photoPath.startsWith('blob:')) {
                  console.log(`[PDF Service] FDF ${photoType.key} already has local URL`);
                  base64Data = photoPath;
                } else if (this.caspioService.isS3Key(photoPath)) {
                  // S3 key - fetch from S3
                  console.log(`[PDF Service] Loading FDF ${photoType.key} from S3:`, photoPath);
                  try {
                    const s3Url = await this.caspioService.getS3FileUrl(photoPath);
                    if (s3Url) {
                      const response = await fetch(s3Url);
                      if (response.ok) {
                        const blob = await response.blob();
                        base64Data = await this.blobToBase64(blob);
                      }
                    }
                  } catch (s3Error) {
                    console.error(`[PDF Service] Failed to load FDF ${photoType.key} from S3:`, s3Error);
                  }
                } else if (photoPath.startsWith('/')) {
                  // DEXIE-FIRST: Try cache then API
                  base64Data = await this.getImageDexieFirst(photoPath, cacheKey, serviceId);
                }

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
                const attachId = attachment.AttachID || attachment.attachId || attachment.imageId || '';
                // Also check Attachment field which contains S3 key for webapp uploads
                const photoPath = attachment.Photo || attachment.PhotoPath || attachment.Attachment || '';
                const drawingsData = attachment.Drawings || attachment.drawings || null;
                const caption = attachment.Caption || attachment.caption || '';

                let finalUrl: string | null = null;

                // DEXIE-FIRST: Check if attachment already has a local/cached URL
                const existingUrl = attachment.displayUrl || attachment.url || attachment.Attachment || photoPath;

                if (existingUrl && (existingUrl.startsWith('data:') || existingUrl.startsWith('blob:'))) {
                  // Already have a usable local URL
                  console.log('[PDF Service] Using existing local URL for point attachment:', attachId);
                  finalUrl = existingUrl;
                } else if (!environment.isWeb && attachId) {
                  // MOBILE: Try to get from IndexedDB cached photos first
                  try {
                    // Try cached annotated image first (if has annotations)
                    if (drawingsData) {
                      const cachedAnnotated = await this.indexedDb.getCachedAnnotatedImage(String(attachId));
                      if (cachedAnnotated) {
                        console.log('[PDF Service] Using cached ANNOTATED image for point:', attachId);
                        finalUrl = cachedAnnotated;
                      }
                    }

                    // If no annotated, try regular cached photo
                    if (!finalUrl) {
                      const cachedPhoto = await this.indexedDb.getCachedPhoto(String(attachId));
                      if (cachedPhoto) {
                        console.log('[PDF Service] Using cached photo for point:', attachId);
                        finalUrl = cachedPhoto;
                      }
                    }

                    // Try LocalImage service for local-first images
                    if (!finalUrl && attachment.imageId) {
                      const localImage = await this.localImageService.getImage(attachment.imageId);
                      if (localImage) {
                        const displayUrl = await this.localImageService.getDisplayUrl(localImage);
                        if (displayUrl && !displayUrl.includes('placeholder')) {
                          console.log('[PDF Service] Using LocalImage display URL for point:', attachment.imageId);
                          finalUrl = displayUrl;
                        }
                      }
                    }
                  } catch (cacheError) {
                    console.warn('[PDF Service] Cache lookup failed for point attachment:', cacheError);
                  }
                }

                // FALLBACK: Load from API (for server paths or S3 keys)
                if (!finalUrl && photoPath) {
                  if (this.caspioService.isS3Key(photoPath)) {
                    // S3 key - fetch from S3
                    console.log('[PDF Service] Loading point photo from S3:', photoPath);
                    try {
                      const s3Url = await this.caspioService.getS3FileUrl(photoPath);
                      if (s3Url) {
                        const response = await fetch(s3Url);
                        if (response.ok) {
                          const blob = await response.blob();
                          finalUrl = await this.blobToBase64(blob);
                        }
                      }
                    } catch (s3Error) {
                      console.error('[PDF Service] Failed to load point photo from S3:', s3Error);
                    }
                  } else if (photoPath.startsWith('/')) {
                    // Caspio file path
                    finalUrl = await this.getImageDexieFirst(photoPath, String(attachId), serviceId);
                  }
                }

                if (finalUrl && finalUrl.startsWith('data:')) {
                  // Render annotations if drawings exist and not already annotated
                  if (drawingsData && !finalUrl.includes('annotated')) {
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
                    caption: caption,
                    conversionSuccess: true
                  });
                } else if (photoPath) {
                  console.warn('[PDF Service] No photo data available for point attachment:', attachId);
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
   * Get photos for a visual item - DEXIE-FIRST approach for mobile
   * Checks local storage first before falling back to API
   */
  private async getVisualPhotos(visualId: string): Promise<any[]> {
    try {
      const attachments = await this.foundationData.getVisualAttachments(visualId);
      const photos = [];

      for (const attachment of (attachments || [])) {
        const attachId = attachment.AttachID || attachment.attachId || attachment.imageId || '';
        const caption = attachment.Annotation || attachment.Caption || attachment.caption || '';
        const drawings = attachment.Drawings || attachment.drawings || '';

        let finalUrl = '';
        let conversionSuccess = false;

        // DEXIE-FIRST: Check if attachment already has a local/cached URL
        // Also check Attachment field which contains S3 key for webapp uploads
        const existingUrl = attachment.displayUrl || attachment.url || attachment.Photo || attachment.Attachment || '';

        if (existingUrl && (existingUrl.startsWith('data:') || existingUrl.startsWith('blob:'))) {
          // Already have a usable local URL
          console.log('[PDF Service] Using existing local URL for attachment:', attachId);
          finalUrl = existingUrl;
          conversionSuccess = true;
        } else if (!environment.isWeb && attachId) {
          // MOBILE: Try to get from IndexedDB cached photos first
          try {
            // First try cached annotated image (if has annotations)
            if (drawings) {
              const cachedAnnotated = await this.indexedDb.getCachedAnnotatedImage(String(attachId));
              if (cachedAnnotated) {
                console.log('[PDF Service] Using cached ANNOTATED image for:', attachId);
                finalUrl = cachedAnnotated;
                conversionSuccess = true;
              }
            }

            // If no annotated, try regular cached photo
            if (!finalUrl) {
              const cachedPhoto = await this.indexedDb.getCachedPhoto(String(attachId));
              if (cachedPhoto) {
                console.log('[PDF Service] Using cached photo from IndexedDB for:', attachId);
                finalUrl = cachedPhoto;
                conversionSuccess = true;
              }
            }

            // Try LocalImage service for local-first images
            if (!finalUrl && attachment.imageId) {
              const localImage = await this.localImageService.getImage(attachment.imageId);
              if (localImage) {
                const displayUrl = await this.localImageService.getDisplayUrl(localImage);
                if (displayUrl && !displayUrl.includes('placeholder')) {
                  console.log('[PDF Service] Using LocalImage display URL for:', attachment.imageId);
                  finalUrl = displayUrl;
                  conversionSuccess = true;
                }
              }
            }
          } catch (cacheError) {
            console.warn('[PDF Service] Cache lookup failed:', cacheError);
          }
        }

        // FALLBACK: If no local data, try API (for server paths or S3 keys)
        if (!finalUrl) {
          // Check both Photo/PhotoPath (Caspio file paths) and Attachment (S3 keys)
          const serverPath = attachment.Photo || attachment.PhotoPath || attachment.Attachment || '';

          if (serverPath) {
            try {
              // Check if this is an S3 key (starts with 'uploads/')
              if (this.caspioService.isS3Key(serverPath)) {
                console.log('[PDF Service] Loading from S3 for:', serverPath);
                const s3Url = await this.caspioService.getS3FileUrl(serverPath);
                if (s3Url) {
                  // Fetch the image and convert to base64 for PDF embedding
                  const response = await fetch(s3Url);
                  if (response.ok) {
                    const blob = await response.blob();
                    const base64Data = await this.blobToBase64(blob);
                    if (base64Data) {
                      finalUrl = base64Data;
                      conversionSuccess = true;
                    }
                  }
                }
              } else if (serverPath.startsWith('/')) {
                // Caspio file path - use Files API
                console.log('[PDF Service] Falling back to API for:', serverPath);
                const base64Data = await firstValueFrom(this.caspioService.getImageFromFilesAPI(serverPath));
                if (base64Data && base64Data.startsWith('data:')) {
                  finalUrl = base64Data;
                  conversionSuccess = true;

                  // Cache for future use (mobile only)
                  if (!environment.isWeb && attachId && attachment.serviceId) {
                    try {
                      await this.indexedDb.cachePhoto(String(attachId), attachment.serviceId, base64Data);
                    } catch (cacheErr) {
                      console.warn('[PDF Service] Failed to cache visual photo:', cacheErr);
                    }
                  }
                }
              }
            } catch (error) {
              console.error(`[PDF Service] Failed to convert visual photo from API:`, error);
            }
          }
        }

        // Only add photo if we have a valid URL
        if (finalUrl) {
          photos.push({
            url: finalUrl,
            caption: caption,
            conversionSuccess: conversionSuccess
          });
        } else if (attachment.Photo || attachment.PhotoPath) {
          // Mark as failed if there was supposed to be a photo
          console.warn('[PDF Service] No photo data available for attachment:', attachId);
          photos.push({
            url: '',
            caption: caption,
            conversionSuccess: false
          });
        }
      }

      return photos;
    } catch (error) {
      console.error(`[PDF Service] Error getting visual photos:`, error);
      return [];
    }
  }

  /**
   * Load primary photo for project - DEXIE-FIRST approach for mobile
   */
  private async loadPrimaryPhoto(projectInfo: any): Promise<void> {
    console.log('[PDF Service] loadPrimaryPhoto called with:', {
      hasPrimaryPhoto: !!projectInfo?.primaryPhoto,
      primaryPhotoType: typeof projectInfo?.primaryPhoto,
      primaryPhotoStart: projectInfo?.primaryPhoto?.substring(0, 50)
    });

    if (projectInfo?.primaryPhoto && typeof projectInfo.primaryPhoto === 'string') {
      let convertedPhotoData: string | null = null;
      const projectId = projectInfo.projectId;

      if (projectInfo.primaryPhoto.startsWith('data:')) {
        // Already base64 - use directly
        console.log('[PDF Service] Primary photo already base64');
        convertedPhotoData = projectInfo.primaryPhoto;
      } else if (projectInfo.primaryPhoto.startsWith('blob:')) {
        // Blob URL - convert to base64
        console.log('[PDF Service] Converting blob URL to base64');
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
          console.log('[PDF Service] ✓ Blob converted to base64');
        } catch (error) {
          console.error('[PDF Service] ✗ Error converting blob URL:', error);
        }
      } else if (projectInfo.primaryPhoto.startsWith('/')) {
        // Caspio file path - DEXIE-FIRST approach
        const cacheKey = `primary_photo_${projectId}`;

        // MOBILE: Try IndexedDB cache first
        if (!environment.isWeb && projectId) {
          try {
            const cachedPhoto = await this.indexedDb.getCachedPhoto(cacheKey);
            if (cachedPhoto) {
              console.log('[PDF Service] ✓ Using cached primary photo from IndexedDB');
              convertedPhotoData = cachedPhoto;
            }
          } catch (cacheError) {
            console.warn('[PDF Service] Cache lookup failed for primary photo:', cacheError);
          }
        }

        // FALLBACK: Load from API
        if (!convertedPhotoData) {
          console.log('[PDF Service] Converting Caspio file path to base64:', projectInfo.primaryPhoto);
          try {
            const imageData = await firstValueFrom(this.caspioService.getImageFromFilesAPI(projectInfo.primaryPhoto));
            if (imageData && typeof imageData === 'string' && imageData.startsWith('data:')) {
              convertedPhotoData = imageData;
              console.log('[PDF Service] ✓ Primary photo converted successfully, size:', Math.round(imageData.length / 1024), 'KB');

              // Cache for future use (mobile only)
              if (!environment.isWeb && projectId && projectInfo.serviceId) {
                try {
                  await this.indexedDb.cachePhoto(cacheKey, projectInfo.serviceId, imageData);
                  console.log('[PDF Service] ✓ Primary photo cached for offline use');
                } catch (cacheErr) {
                  console.warn('[PDF Service] Failed to cache primary photo:', cacheErr);
                }
              }
            } else {
              console.error('[PDF Service] ✗ Primary photo conversion failed - invalid data');
            }
          } catch (error) {
            console.error('[PDF Service] ✗ Error converting primary photo:', error);
          }
        }
      } else {
        console.log('[PDF Service] Primary photo has unknown format:', projectInfo.primaryPhoto.substring(0, 50));
      }

      // Set both fields so PDF component can use either one
      if (convertedPhotoData) {
        projectInfo.primaryPhotoBase64 = convertedPhotoData;
        projectInfo.primaryPhoto = convertedPhotoData;
        console.log('[PDF Service] ✓ Primary photo fields set on projectInfo');
      } else {
        console.warn('[PDF Service] ✗ No converted photo data - photo will not appear in PDF');
      }
    } else {
      console.log('[PDF Service] No primary photo to load');
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

  /**
   * DEXIE-FIRST helper: Get image data from local cache or API
   * Checks IndexedDB cache first, then falls back to API
   * @param serverPath - The Caspio file path (e.g., /files/...)
   * @param cacheKey - Key for caching (AttachID or unique identifier)
   * @param serviceId - Optional service ID for caching
   * @returns Base64 data URL or null
   */
  private async getImageDexieFirst(serverPath: string, cacheKey?: string, serviceId?: string): Promise<string | null> {
    if (!serverPath) return null;

    // MOBILE: Try IndexedDB cache first
    if (!environment.isWeb && cacheKey) {
      try {
        // Try cached photo
        const cachedPhoto = await this.indexedDb.getCachedPhoto(cacheKey);
        if (cachedPhoto) {
          console.log('[PDF Service] Using cached photo from IndexedDB for key:', cacheKey);
          return cachedPhoto;
        }

        // Try cached annotated image
        const cachedAnnotated = await this.indexedDb.getCachedAnnotatedImage(cacheKey);
        if (cachedAnnotated) {
          console.log('[PDF Service] Using cached annotated image for key:', cacheKey);
          return cachedAnnotated;
        }
      } catch (cacheError) {
        console.warn('[PDF Service] Cache lookup failed for:', cacheKey, cacheError);
      }
    }

    // FALLBACK: Load from API (for server paths)
    if (serverPath.startsWith('/')) {
      try {
        console.log('[PDF Service] Loading from API:', serverPath);
        const base64Data = await firstValueFrom(this.caspioService.getImageFromFilesAPI(serverPath));
        if (base64Data && base64Data.startsWith('data:')) {
          // Cache for future use (mobile only)
          if (!environment.isWeb && cacheKey && serviceId) {
            try {
              await this.indexedDb.cachePhoto(cacheKey, serviceId, base64Data);
              console.log('[PDF Service] Cached photo for future use:', cacheKey);
            } catch (cacheErr) {
              console.warn('[PDF Service] Failed to cache photo:', cacheErr);
            }
          }
          return base64Data;
        }
      } catch (error) {
        console.error('[PDF Service] Failed to load image from API:', serverPath, error);
      }
    }

    return null;
  }

  /**
   * Convert a Blob to a base64 data URL
   */
  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve(reader.result as string);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

