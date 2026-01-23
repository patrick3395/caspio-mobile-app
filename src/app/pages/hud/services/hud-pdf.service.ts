import { Injectable } from '@angular/core';
import { ModalController, AlertController, LoadingController, Platform } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { CaspioService } from '../../../services/caspio.service';
import { HudDataService } from '../hud-data.service';
import { HudStateService } from './hud-state.service';
import { CacheService } from '../../../services/cache.service';
import { FabricService } from '../../../services/fabric.service';
import { RetryNotificationService } from '../../../services/retry-notification.service';
import { LocalImageService } from '../../../services/local-image.service';
import { IndexedDbService } from '../../../services/indexed-db.service';
import { PlatformDetectionService } from '../../../services/platform-detection.service';
import { renderAnnotationsOnPhoto } from '../../../utils/annotation-utils';
import { environment } from '../../../../environments/environment';

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
export class HudPdfService {
  private isPDFGenerating = false;
  private pdfGenerationAttempts = 0;

  constructor(
    private modalController: ModalController,
    private alertController: AlertController,
    private loadingController: LoadingController,
    private platform: Platform,
    private caspioService: CaspioService,
    private hudData: HudDataService,
    private stateService: HudStateService,
    private cache: CacheService,
    private fabricService: FabricService,
    private retryNotification: RetryNotificationService,
    private localImageService: LocalImageService,
    private indexedDb: IndexedDbService,
    private platformDetection: PlatformDetectionService
  ) {}

  /**
   * Check if running on mobile (uses Dexie-first approach)
   */
  private isMobile(): boolean {
    return this.platformDetection.isMobile();
  }

  /**
   * Main PDF generation method
   * Replicates the logic from engineers-foundation-pdf.service.ts
   */
  async generatePDF(projectId: string, serviceId: string): Promise<void> {
    // Prevent multiple simultaneous PDF generation attempts
    if (this.isPDFGenerating) {
      console.log('[HUD PDF Service] PDF generation already in progress');
      return;
    }

    this.isPDFGenerating = true;
    this.pdfGenerationAttempts++;

    let loading: HTMLIonAlertElement | null = null;
    let cancelRequested = false;

    // Helper to update progress (web only)
    const updateProgress = (percent: number, step: string) => {
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
      // WEBAPP: Suppress retry notification toasts during PDF generation
      if (environment.isWeb) {
        this.retryNotification.suppressNotifications();
      }

      // Show loading indicator with cancel button
      // Web: Show progress bar with percentage (injected after present to avoid HTML escaping)
      // Mobile: Show simple loading message
      loading = await this.alertController.create({
        header: 'Loading Report',
        message: environment.isWeb ? '' : 'Initializing...',
        buttons: [
          {
            text: 'Cancel',
            role: 'cancel',
            handler: () => {
              cancelRequested = true;
              this.isPDFGenerating = false;
              // WEBAPP: Resume retry notifications after cancel
              if (environment.isWeb) {
                this.retryNotification.resumeNotifications();
              }
              console.log('[HUD PDF Service] User cancelled PDF generation');
              return true;
            }
          }
        ],
        backdropDismiss: false,
        cssClass: environment.isWeb ? 'progress-loading-alert' : 'template-loading-alert'
      });
      await loading.present();

      // WEBAPP: Inject HTML progress bar after alert is presented to bypass Angular sanitizer
      if (environment.isWeb) {
        const alertEl = document.querySelector('.progress-loading-alert');
        const alertMessage = alertEl?.querySelector('.alert-message');
        if (alertMessage) {
          alertMessage.innerHTML = `
            <div class="progress-container">
              <div class="progress-percentage">0%</div>
              <div class="progress-bar-wrapper">
                <div class="progress-bar-fill" style="width: 0%"></div>
              </div>
              <div class="progress-step">Initializing...</div>
            </div>`;
        }
      }

      console.log('[HUD PDF Service] Starting PDF generation for:', { projectId, serviceId });

      // Check cache first (5-minute cache)
      const cacheKey = this.cache.getApiCacheKey('hud_pdf_data', {
        serviceId: serviceId,
        timestamp: Math.floor(Date.now() / 300000) // 5-minute blocks
      });

      let hudData, projectInfo;
      const cachedData = this.cache.get(cacheKey);

      if (cachedData) {
        console.log('[HUD PDF Service] ⚡ Using cached PDF data - fast path!');
        updateProgress(50, 'Loading from cache...');
        ({ hudData, projectInfo } = cachedData);
      } else {
        console.log('[HUD PDF Service] Loading fresh PDF data...');
        updateProgress(5, 'Loading project data...');
        const startTime = Date.now();

        // Check if user cancelled
        if (cancelRequested) {
          console.log('[HUD PDF Service] Cancelled before data fetch');
          return;
        }

        try {
          // Execute all data fetching in parallel with individual error handling
          updateProgress(10, 'Loading project information...');
          const [projectData, structuralData] = await Promise.all([
            (async () => {
              return this.prepareProjectInfo(projectId, serviceId).catch(err => {
                console.error('[HUD PDF Service] Error in prepareProjectInfo:', err);
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
              return this.prepareHUDData(serviceId).catch(err => {
                console.error('[HUD PDF Service] Error in prepareHUDData:', err);
                return [];
              });
            })()
          ]);

          updateProgress(45, 'Processing data...');
          projectInfo = projectData;
          hudData = structuralData;

          // Cache the prepared data for faster subsequent loads
          this.cache.set(cacheKey, {
            hudData,
            projectInfo
          }, this.cache.CACHE_TIMES.MEDIUM);

          const loadTime = Date.now() - startTime;
          console.log(`[HUD PDF Service] Cached PDF data for reuse (5 min expiry) - loaded in ${loadTime}ms`);
        } catch (dataError) {
          console.error('[HUD PDF Service] Fatal error loading PDF data:', dataError);
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
        console.log('[HUD PDF Service] Cancelled after data fetch');
        return;
      }

      console.log('[HUD PDF Service] Data loaded, now loading PDF preview component...');
      updateProgress(55, 'Loading PDF preview...');

      // Load PDF preview component
      const PdfPreviewComponent = await this.loadPdfPreview();

      console.log('[HUD PDF Service] PDF preview component loaded:', !!PdfPreviewComponent);

      // Load primary photo after component is loaded
      updateProgress(70, 'Processing cover photo...');
      await this.loadPrimaryPhoto(projectInfo);

      console.log('[HUD PDF Service] Primary photo processed:', {
        hasPrimaryPhoto: !!projectInfo.primaryPhoto,
        hasPrimaryPhotoBase64: !!projectInfo.primaryPhotoBase64,
        primaryPhotoType: typeof projectInfo.primaryPhoto,
        primaryPhotoPreview: projectInfo.primaryPhoto?.substring(0, 50)
      });

      // Check if user cancelled
      if (cancelRequested) {
        console.log('[HUD PDF Service] Cancelled after component load');
        return;
      }

      // Check if PdfPreviewComponent is available
      if (!PdfPreviewComponent) {
        console.error('[HUD PDF Service] PdfPreviewComponent not available!');
        throw new Error('PdfPreviewComponent not available');
      }

      updateProgress(85, 'Preparing PDF document...');

      console.log('[HUD PDF Service] Creating PDF modal with data:', {
        projectInfo: !!projectInfo,
        hudData: hudData?.length || 0
      });

      // Create and present the PDF modal
      const modal = await this.modalController.create({
        component: PdfPreviewComponent,
        componentProps: {
          projectData: projectInfo,
          structuralData: hudData, // Reuse structuralData prop for HUD data
          elevationData: [], // HUD doesn't have elevation data
          serviceData: {
            serviceName: 'HUD/Manufactured Home Inspection'
          }
        },
        cssClass: 'fullscreen-modal',
        animated: this.pdfGenerationAttempts > 1,
        mode: 'ios',
        backdropDismiss: false
      });

      // Check if user cancelled
      if (cancelRequested) {
        console.log('[HUD PDF Service] Cancelled before modal present');
        return;
      }

      updateProgress(95, 'Opening PDF...');

      console.log('[HUD PDF Service] Presenting PDF modal...');
      await modal.present();
      console.log('[HUD PDF Service] PDF modal presented successfully');

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
        // WEBAPP: Resume retry notifications after PDF preview is closed
        if (environment.isWeb) {
          this.retryNotification.resumeNotifications();
        }
      });

    } catch (error) {
      console.error('[HUD PDF Service] Error generating PDF:', error);
      this.isPDFGenerating = false;

      // WEBAPP: Resume retry notifications after error
      if (environment.isWeb) {
        this.retryNotification.resumeNotifications();
      }

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
    console.log('[HUD PDF Service] Preparing project info...');

    // Fetch project and service data
    const [projectData, serviceData] = await Promise.all([
      firstValueFrom(this.caspioService.getProject(projectId)),
      firstValueFrom(this.caspioService.getServiceById(serviceId))
    ]);

    console.log('[HUD PDF Service] ✓ Project info loaded');

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
   * Prepare HUD data for PDF
   * Gathers all HUD visuals organized by category with photos
   */
  private async prepareHUDData(serviceId: string): Promise<any[]> {
    console.log('[HUD PDF Service] Preparing HUD data...');

    const result = [];

    // Get all HUD visuals for this service
    // CRITICAL: Bypass cache to ensure we get the latest data for PDF
    const allVisuals = await this.hudData.getVisualsByService(serviceId, true);
    
    console.log('[HUD PDF Service] ========== HUD DATA DEBUG ==========');
    console.log('[HUD PDF Service] ServiceID:', serviceId);
    console.log('[HUD PDF Service] Total visuals fetched:', allVisuals?.length || 0);
    if (allVisuals && allVisuals.length > 0) {
      console.log('[HUD PDF Service] Sample visual:', JSON.stringify(allVisuals[0], null, 2));
      // Log all category names for debugging
      const uniqueCategories = [...new Set(allVisuals.map((v: any) => v.Category))];
      console.log('[HUD PDF Service] Unique categories in data:', uniqueCategories);
    } else {
      console.warn('[HUD PDF Service] ⚠️ NO HUD RECORDS FOUND! This is why PDF is empty.');
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
        console.log('[HUD PDF Service] Skipping hidden visual:', visual.Name);
        continue;
      }
      
      console.log('[HUD PDF Service] Visual:', visual.Name, 'Category:', category, 'Kind:', kind);

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
        console.warn('[HUD PDF Service] Unknown Kind value:', kind, 'for visual:', visual.Name);
        organizedData[category].comments.push(visual);
      }
    }
    
    console.log('[HUD PDF Service] Found categories:', categoryOrder);

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
          const hudId = comment.HUDID || comment.PK_ID;

          let displayText = comment.Text || comment.VisualText || '';
          let answers = comment.Answers || '';

          photoFetches.push(this.getHUDPhotos(hudId, fabric));
          photoMappings.push({
            type: 'comments',
            item: {
              name: comment.Name || comment.VisualName || '',
              text: displayText,
              answers: answers,
              visualId: hudId
            },
            index: photoFetches.length - 1
          });
        }
      }

      // Process limitations
      if (categoryData.limitations) {
        for (const limitation of categoryData.limitations) {
          const hudId = limitation.HUDID || limitation.PK_ID;

          let displayText = limitation.Text || limitation.VisualText || '';
          let answers = limitation.Answers || '';

          photoFetches.push(this.getHUDPhotos(hudId, fabric));
          photoMappings.push({
            type: 'limitations',
            item: {
              name: limitation.Name || limitation.VisualName || '',
              text: displayText,
              answers: answers,
              visualId: hudId
            },
            index: photoFetches.length - 1
          });
        }
      }

      // Process deficiencies
      if (categoryData.deficiencies) {
        for (const deficiency of categoryData.deficiencies) {
          const hudId = deficiency.HUDID || deficiency.PK_ID;

          let displayText = deficiency.Text || deficiency.VisualText || '';
          let answers = deficiency.Answers || '';

          photoFetches.push(this.getHUDPhotos(hudId, fabric));
          photoMappings.push({
            type: 'deficiencies',
            item: {
              name: deficiency.Name || deficiency.VisualName || '',
              text: displayText,
              answers: answers,
              visualId: hudId
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

    console.log(`[HUD PDF Service] ✓ HUD data loaded: ${result.length} categories with ${totalItems} total items`);
    console.log(`[HUD PDF Service]   - Comments: ${totalComments}`);
    console.log(`[HUD PDF Service]   - Limitations: ${totalLimitations}`);
    console.log(`[HUD PDF Service]   - Deficiencies: ${totalDeficiencies}`);

    return result;
  }

  /**
   * Get photos for a HUD item - DEXIE-FIRST approach for mobile
   * Checks local storage first before falling back to API
   *
   * HUD-015: Updated to read from Dexie hudFields and LocalImages tables on mobile
   */
  private async getHUDPhotos(hudId: string, fabric: any): Promise<any[]> {
    try {
      // Use PDF-optimized method that includes pending caption/annotation changes
      const attachments = await this.hudData.getVisualAttachmentsForPdf(hudId);
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
          // Already have a usable local URL - convert blob to base64 for PDF
          console.log('[HUD PDF Service] Using existing local URL for attachment:', attachId);
          if (existingUrl.startsWith('blob:')) {
            // Convert blob URL to base64 for PDF embedding
            const base64 = await this.blobToBase64FromUrl(existingUrl);
            if (base64) {
              finalUrl = base64;
              conversionSuccess = true;
            }
          } else {
            finalUrl = existingUrl;
            conversionSuccess = true;
          }
        } else if (this.isMobile() && attachId) {
          // MOBILE: Try to get from IndexedDB cached photos first
          try {
            // First try cached annotated image (if has annotations)
            if (drawings) {
              const cachedAnnotated = await this.indexedDb.getCachedAnnotatedImage(String(attachId));
              if (cachedAnnotated) {
                console.log('[HUD PDF Service] Using cached ANNOTATED image for:', attachId);
                finalUrl = cachedAnnotated;
                conversionSuccess = true;
              }
            }

            // If no annotated, try regular cached photo
            if (!finalUrl) {
              const cachedPhoto = await this.indexedDb.getCachedPhoto(String(attachId));
              if (cachedPhoto) {
                console.log('[HUD PDF Service] Using cached photo from IndexedDB for:', attachId);
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
                  console.log('[HUD PDF Service] Using LocalImage display URL for:', attachment.imageId);
                  // Convert blob URL to base64 for PDF
                  if (displayUrl.startsWith('blob:')) {
                    const base64 = await this.blobToBase64FromUrl(displayUrl);
                    if (base64) {
                      finalUrl = base64;
                      conversionSuccess = true;
                    }
                  } else {
                    finalUrl = displayUrl;
                    conversionSuccess = true;
                  }
                }
              }
            }
          } catch (cacheError) {
            console.warn('[HUD PDF Service] Cache lookup failed:', cacheError);
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
                console.log('[HUD PDF Service] Loading from S3 for:', serverPath);
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
                console.log('[HUD PDF Service] Falling back to API for:', serverPath);
                const base64Data = await firstValueFrom(this.caspioService.getImageFromFilesAPI(serverPath));
                if (base64Data && base64Data.startsWith('data:')) {
                  finalUrl = base64Data;
                  conversionSuccess = true;

                  // Cache for future use (mobile only)
                  if (this.isMobile() && attachId && attachment.serviceId) {
                    try {
                      await this.indexedDb.cachePhoto(String(attachId), attachment.serviceId, base64Data);
                    } catch (cacheErr) {
                      console.warn('[HUD PDF Service] Failed to cache HUD photo:', cacheErr);
                    }
                  }
                }
              }
            } catch (error) {
              console.error(`[HUD PDF Service] Failed to convert HUD photo from API:`, error);
            }
          }
        }

        // Render annotations if we have a valid URL and drawings data
        if (finalUrl && drawings) {
          try {
            console.log('[HUD PDF Service] Rendering annotations for HUD attachment:', attachId);
            const annotatedUrl = await renderAnnotationsOnPhoto(finalUrl, drawings, { quality: 0.9, format: 'jpeg', fabric });
            if (annotatedUrl && annotatedUrl !== finalUrl) {
              finalUrl = annotatedUrl;
              console.log('[HUD PDF Service] ✓ Annotations rendered successfully for:', attachId);
            }
          } catch (renderError) {
            console.error('[HUD PDF Service] Error rendering HUD photo annotation:', renderError);
            // Continue with unannotated image
          }
        }

        // Only add photo if we have a valid URL
        if (finalUrl) {
          photos.push({
            url: finalUrl,
            caption: caption,
            conversionSuccess: conversionSuccess
          });
        } else if (attachment.Photo || attachment.PhotoPath || attachment.Attachment) {
          // Mark as failed if there was supposed to be a photo
          console.warn('[HUD PDF Service] No photo data available for attachment:', attachId);
          photos.push({
            url: '',
            caption: caption,
            conversionSuccess: false
          });
        }
      }

      return photos;
    } catch (error) {
      console.error(`[HUD PDF Service] Error getting HUD photos:`, error);
      return [];
    }
  }

  /**
   * Convert a blob to base64 data URL
   */
  private async blobToBase64(blob: Blob): Promise<string | null> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Convert a blob URL to base64 data URL
   */
  private async blobToBase64FromUrl(blobUrl: string): Promise<string | null> {
    try {
      const response = await fetch(blobUrl);
      const blob = await response.blob();
      return this.blobToBase64(blob);
    } catch (error) {
      console.error('[HUD PDF Service] Error converting blob URL to base64:', error);
      return null;
    }
  }

  /**
   * Load primary photo for project
   */
  private async loadPrimaryPhoto(projectInfo: any): Promise<void> {
    console.log('[HUD PDF Service] loadPrimaryPhoto called with:', {
      hasPrimaryPhoto: !!projectInfo?.primaryPhoto,
      primaryPhotoType: typeof projectInfo?.primaryPhoto,
      primaryPhotoStart: projectInfo?.primaryPhoto?.substring(0, 50)
    });

    if (projectInfo?.primaryPhoto && typeof projectInfo.primaryPhoto === 'string') {
      let convertedPhotoData: string | null = null;

      if (projectInfo.primaryPhoto.startsWith('/')) {
        // Caspio file path - convert to base64
        console.log('[HUD PDF Service] Converting Caspio file path to base64:', projectInfo.primaryPhoto);
        try {
          const imageData = await firstValueFrom(this.caspioService.getImageFromFilesAPI(projectInfo.primaryPhoto));
          if (imageData && typeof imageData === 'string' && imageData.startsWith('data:')) {
            convertedPhotoData = imageData;
            console.log('[HUD PDF Service] ✓ Primary photo converted successfully, size:', Math.round(imageData.length / 1024), 'KB');
          } else {
            console.error('[HUD PDF Service] ✗ Primary photo conversion failed - invalid data');
          }
        } catch (error) {
          console.error('[HUD PDF Service] ✗ Error converting primary photo:', error);
        }
      } else if (projectInfo.primaryPhoto.startsWith('data:')) {
        console.log('[HUD PDF Service] Primary photo already base64');
        convertedPhotoData = projectInfo.primaryPhoto;
      } else if (projectInfo.primaryPhoto.startsWith('blob:')) {
        console.log('[HUD PDF Service] Converting blob URL to base64');
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
          console.log('[HUD PDF Service] ✓ Blob converted to base64');
        } catch (error) {
          console.error('[HUD PDF Service] ✗ Error converting blob URL:', error);
        }
      } else {
        console.log('[HUD PDF Service] Primary photo has unknown format:', projectInfo.primaryPhoto.substring(0, 50));
      }

      // Set both fields so PDF component can use either one
      if (convertedPhotoData) {
        projectInfo.primaryPhotoBase64 = convertedPhotoData;
        projectInfo.primaryPhoto = convertedPhotoData;
        console.log('[HUD PDF Service] ✓ Primary photo fields set on projectInfo');
      } else {
        console.warn('[HUD PDF Service] ✗ No converted photo data - photo will not appear in PDF');
      }
    } else {
      console.log('[HUD PDF Service] No primary photo to load');
    }
  }

  /**
   * Load PDF preview component dynamically
   */
  private async loadPdfPreview(): Promise<any> {
    try {
      console.log('[HUD PDF Service] Loading PDF preview component module...');
      const module = await import('../../../components/pdf-preview/pdf-preview.component');
      console.log('[HUD PDF Service] PDF preview component module loaded:', !!module.PdfPreviewComponent);
      return module.PdfPreviewComponent;
    } catch (error) {
      console.error('[HUD PDF Service] Error loading PDF preview component:', error);
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
