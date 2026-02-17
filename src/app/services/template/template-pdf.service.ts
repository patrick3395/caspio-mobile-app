import { Injectable } from '@angular/core';
import { ModalController, AlertController } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { CaspioService } from '../caspio.service';
import { TemplateConfigService } from './template-config.service';
import { TemplateConfig, TemplateType } from './template-config.interface';
import { CacheService } from '../cache.service';
import { FabricService } from '../fabric.service';
import { RetryNotificationService } from '../retry-notification.service';
import { HudDataService } from '../../pages/hud/hud-data.service';
import { EngineersFoundationDataService } from '../../pages/engineers-foundation/engineers-foundation-data.service';
import { DteDataService } from '../../pages/dte/dte-data.service';
import { LbwDataService } from '../../pages/lbw/lbw-data.service';
import { PdfDocumentBuilderService } from '../pdf/pdf-document-builder.service';
import { TABLE_LAYOUTS } from '../pdf/pdf-styles';
import { renderAnnotationsOnPhoto } from '../../utils/annotation-utils';
import { environment } from '../../../environments/environment';

type DocumentViewerCtor = typeof import('../../components/document-viewer/document-viewer.component')['DocumentViewerComponent'];

/**
 * Unified PDF Generation Service for all templates (HUD, EFE, DTE, LBW)
 *
 * Uses TemplateConfigService to determine which template is active and
 * dispatches to the correct data service methods based on config.id.
 */
@Injectable({
  providedIn: 'root'
})
export class TemplatePdfService {
  private isPDFGenerating = false;
  private pdfGenerationAttempts = 0;
  private documentViewerComponent: DocumentViewerCtor | null = null;

  /** Map config.id → display name shown in PDF modal */
  private readonly serviceDisplayNames: Record<string, string> = {
    hud: 'HUD / Mobile Manufactured',
    efe: 'EFE - Engineer\'s Foundation Evaluation',
    dte: 'Damaged Truss Evaluation Inspection',
    lbw: 'Load Bearing Wall Inspection'
  };

  constructor(
    private modalController: ModalController,
    private alertController: AlertController,
    private caspioService: CaspioService,
    private templateConfigService: TemplateConfigService,
    private cache: CacheService,
    private fabricService: FabricService,
    private retryNotification: RetryNotificationService,
    private hudData: HudDataService,
    private efeData: EngineersFoundationDataService,
    private dteData: DteDataService,
    private lbwData: LbwDataService,
    private pdfBuilder: PdfDocumentBuilderService
  ) {}

  /**
   * Main PDF generation entry point.
   * Config is resolved from configId if provided, otherwise from the current URL.
   */
  async generatePDF(projectId: string, serviceId: string, configId?: TemplateType): Promise<void> {
    if (this.isPDFGenerating) {
      return;
    }

    this.isPDFGenerating = true;
    this.pdfGenerationAttempts++;

    const config = configId
      ? this.templateConfigService.getConfig(configId)
      : this.templateConfigService.requiredConfig;
    const logTag = `[${config.displayName} PDF]`;

    let loading: HTMLIonAlertElement | null = null;
    let cancelRequested = false;

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
      // Suppress retry notification toasts during PDF generation on web
      if (environment.isWeb) {
        this.retryNotification.suppressNotifications();
      }

      // Resolve the correct ServiceID for child table queries.
      // Only HUD has hasActualServiceId=true, meaning its child records use the
      // resolved ServiceID (from the service record). All other templates create
      // child records using the route PK_ID directly.
      let queryServiceId = serviceId;
      if (config.categoryDetailFeatures?.hasActualServiceId) {
        try {
          const serviceRecord = await firstValueFrom(this.caspioService.getServiceById(serviceId));
          if (serviceRecord?.ServiceID) {
            queryServiceId = String(serviceRecord.ServiceID);
            if (queryServiceId !== serviceId) {
              console.log(`[PDF] Resolved queryServiceId: ${queryServiceId} (route PK_ID: ${serviceId})`);
            }
          }
        } catch (err) {
          console.warn(`[PDF] Could not resolve queryServiceId, using route serviceId: ${serviceId}`);
        }
      }

      // Show loading alert with cancel button
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
              if (environment.isWeb) {
                this.retryNotification.resumeNotifications();
              }
              return true;
            }
          }
        ],
        backdropDismiss: false,
        cssClass: environment.isWeb ? 'progress-loading-alert' : 'template-loading-alert'
      });
      await loading.present();

      // Inject HTML progress bar on web (bypasses Angular sanitizer)
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

      let recordsData: any[], elevationData: any[], projectInfo: any;

      // On web, always fetch fresh data (no cache) so edits are immediately reflected.
      // On mobile, use a short-lived cache to speed up repeated PDF opens.
      const useCache = !environment.isWeb;
      const cacheKey = useCache ? this.cache.getApiCacheKey('pdf_data', {
        serviceId: serviceId,
        templateId: config.id,
        timestamp: Math.floor(Date.now() / 300000)
      }) : '';
      const cachedData = useCache ? this.cache.get(cacheKey) : null;

      if (cachedData) {
        updateProgress(50, 'Loading from cache...');
        ({ recordsData, elevationData, projectInfo } = cachedData);
      } else {
        updateProgress(5, 'Loading project data...');

        if (cancelRequested) return;

        try {
          // Build parallel fetch array
          // prepareProjectInfo uses PK_ID (serviceId) to fetch the service record itself
          // prepareRecordsData/prepareElevationData use actualServiceId for child table queries
          const fetchPromises: Promise<any>[] = [
            this.prepareProjectInfo(projectId, serviceId).catch(err => {
              console.error(`${logTag} Error in prepareProjectInfo:`, err);
              return {
                projectId, serviceId, address: '', clientName: '',
                projectData: null, serviceData: null
              };
            }),
            this.prepareRecordsData(config, queryServiceId).catch(err => {
              console.error(`${logTag} Error in prepareRecordsData:`, err);
              return [];
            })
          ];

          // Only fetch elevation data for templates that support it (EFE)
          if (config.features.hasElevationPlot) {
            fetchPromises.push(
              this.prepareElevationData(queryServiceId).catch(err => {
                console.error(`${logTag} Error in prepareElevationData:`, err);
                return [];
              })
            );
          }

          updateProgress(10, 'Loading project information...');
          const results = await Promise.all(fetchPromises);

          updateProgress(40, 'Processing data...');
          projectInfo = results[0];
          recordsData = results[1];
          elevationData = config.features.hasElevationPlot ? results[2] : [];

          // Cache for faster subsequent loads (mobile only)
          if (useCache) {
            this.cache.set(cacheKey, {
              recordsData, elevationData, projectInfo
            }, this.cache.CACHE_TIMES.MEDIUM);
          }
        } catch (dataError) {
          console.error(`${logTag} Fatal error loading PDF data:`, dataError);
          projectInfo = {
            projectId, serviceId, address: '', clientName: '',
            projectData: null, serviceData: null
          };
          recordsData = [];
          elevationData = [];
        }
      }

      if (cancelRequested) return;

      updateProgress(55, 'Processing cover photo...');
      await Promise.all([
        this.loadPrimaryPhoto(projectInfo),
        this.loadCompanyLogo(projectInfo)
      ]);

      if (cancelRequested) return;

      updateProgress(65, 'Loading PDF library...');
      const pdfMakeModule = await import('pdfmake/build/pdfmake');
      const pdfMake = pdfMakeModule.default || pdfMakeModule;
      const pdfFontsModule: any = await import('pdfmake/build/vfs_fonts');
      const pdfFonts = pdfFontsModule.default || pdfFontsModule;
      (pdfMake as any).vfs = pdfFonts.pdfMake?.vfs || pdfFonts.vfs || pdfFonts;

      if (cancelRequested) return;

      updateProgress(75, 'Building document...');
      const serviceName = this.serviceDisplayNames[config.id] || config.displayName;
      const docDefinition = await this.pdfBuilder.buildDocument(
        projectInfo,
        recordsData,
        elevationData,
        { serviceName }
      );

      if (cancelRequested) return;

      updateProgress(85, 'Generating PDF...');
      const pdfDoc = (pdfMake as any).createPdf(docDefinition, TABLE_LAYOUTS);
      const pdfBlob: Blob = await pdfDoc.getBlob();

      if (cancelRequested) return;

      // Use blob URL on web (avoids expensive base64 conversion), base64 on mobile
      const fileUrl = environment.isWeb
        ? URL.createObjectURL(pdfBlob)
        : await this.blobToBase64(pdfBlob);

      updateProgress(90, 'Loading viewer...');
      const DocumentViewerComponent = await this.loadDocumentViewer();

      const pdfProjectId = projectInfo?.projectId || 'draft';
      const clientName = (projectInfo?.clientName || 'Client').replace(/[^a-z0-9]/gi, '_');
      const date = new Date().toISOString().split('T')[0];
      const fileName = `EFE_Report_${clientName}_${pdfProjectId}_${date}.pdf`;

      updateProgress(95, 'Opening PDF...');
      const modal = await this.modalController.create({
        component: DocumentViewerComponent,
        componentProps: {
          fileUrl,
          fileName,
          fileType: 'pdf'
        },
        cssClass: 'fullscreen-modal',
        animated: this.pdfGenerationAttempts > 1,
        backdropDismiss: false
      });

      if (cancelRequested) return;

      await modal.present();

      setTimeout(async () => {
        try {
          if (loading) await loading.dismiss();
        } catch { /* ignore */ }
      }, 100);

      modal.onDidDismiss().then(() => {
        this.isPDFGenerating = false;
        if (environment.isWeb) {
          this.retryNotification.resumeNotifications();
        }
      });

    } catch (error) {
      console.error(`${logTag} Error generating PDF:`, error);
      this.isPDFGenerating = false;

      if (environment.isWeb) {
        this.retryNotification.resumeNotifications();
      }

      try {
        if (loading) await loading.dismiss();
      } catch { /* ignore */ }

      const errorDetails = error instanceof Error
        ? `Message: ${error.message}\n\nStack: ${error.stack}`
        : `Error: ${JSON.stringify(error)}`;

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

  isGenerating(): boolean {
    return this.isPDFGenerating;
  }

  // ─── Project Info ──────────────────────────────────────────────────

  private async prepareProjectInfo(projectId: string, serviceId: string): Promise<any> {
    const [projectData, serviceData] = await Promise.all([
      firstValueFrom(this.caspioService.getProject(projectId)),
      firstValueFrom(this.caspioService.getServiceById(serviceId))
    ]);

    const p = projectData as any;
    const s = serviceData as any;
    const primaryPhoto = p?.PrimaryPhoto || null;

    // Fetch the project's company name and logo from LPS_Companies
    let companyName = '';
    let companyLogo: string | null = null;
    const projectCompanyId = Number(p?.CompanyID || p?.Company_ID || 0);
    if (projectCompanyId) {
      try {
        const companyResult: any = await firstValueFrom(
          this.caspioService.get<any>(`/tables/LPS_Companies/records?q.where=CompanyID=${projectCompanyId}`)
        );
        if (companyResult?.Result?.[0]) {
          companyName = companyResult.Result[0].CompanyName || companyResult.Result[0].Name || '';
          companyLogo = companyResult.Result[0].Logo || null;
        }
      } catch (e) {
        console.warn('[PDF] Failed to fetch company data:', e);
      }
    }

    return {
      projectId, serviceId, primaryPhoto,
      primaryPhotoBase64: null as string | null,
      companyLogo,
      companyLogoBase64: null as string | null,

      // Address
      address: p?.Address || '',
      city: p?.City || '',
      state: p?.State || '',
      zip: p?.Zip || '',
      fullAddress: `${p?.Address || ''}, ${p?.City || ''}, ${p?.State || ''} ${p?.Zip || ''}`,

      // People
      clientName: p?.ClientName || p?.Owner || '',
      agentName: p?.AgentName || '',
      inspectorName: p?.InspectorName || '',
      inAttendance: s?.InAttendance || '',

      // Property Details
      yearBuilt: p?.YearBuilt || '',
      squareFeet: p?.SquareFeet || '',
      typeOfBuilding: p?.TypeOfBuilding || '',
      style: p?.Style || '',
      occupancyFurnishings: s?.OccupancyFurnishings || '',

      // Environmental
      weatherConditions: s?.WeatherConditions || '',
      outdoorTemperature: s?.OutdoorTemperature || '',

      // HUD-specific
      manufacturer: s?.Manufacturer || '',
      serialNumber: s?.SerialNumber || '',
      hudLabel: s?.HUDLabel || '',

      // Foundation-specific (EFE)
      firstFoundationType: s?.FirstFoundationType || '',
      secondFoundationType: s?.SecondFoundationType || '',
      secondFoundationRooms: s?.SecondFoundationRooms || '',
      thirdFoundationType: s?.ThirdFoundationType || '',
      thirdFoundationRooms: s?.ThirdFoundationRooms || '',

      // Additional
      ownerOccupantInterview: s?.OwnerOccupantInterview || '',

      // Inspection
      inspectionDate: this.formatDate(s?.DateOfInspection || new Date().toISOString()),

      // Company
      inspectorPhone: '936-202-8013',
      inspectorEmail: 'info@noblepropertyinspections.com',
      companyName,

      // Raw data
      projectData, serviceData
    };
  }

  // ─── Records Data (visuals/HUD records) ────────────────────────────

  private async prepareRecordsData(config: TemplateConfig, serviceId: string): Promise<any[]> {
    const result: any[] = [];

    console.log(`[PDF] prepareRecordsData: config.id=${config.id}, serviceId=${serviceId}`);
    const allRecords = await this.getRecords(config, serviceId);
    console.log(`[PDF] getRecords returned ${allRecords?.length ?? 'null'} records`);
    if (allRecords?.[0]) {
      console.log(`[PDF] First record keys:`, Object.keys(allRecords[0]).join(', '));
    }

    if (!allRecords || allRecords.length === 0) {
      return result;
    }

    // Dynamically extract categories from data
    const organizedData: any = {};
    const categoryOrder: string[] = [];

    for (const record of allRecords) {
      const category = record.Category || 'Other';
      const kind = record.Kind || record.Type || 'Comment';

      // Skip hidden records
      if (record.Notes && record.Notes.startsWith('HIDDEN')) {
        continue;
      }

      if (!organizedData[category]) {
        organizedData[category] = { comments: [], limitations: [], deficiencies: [] };
        categoryOrder.push(category);
      }

      if (kind === 'Comment') {
        organizedData[category].comments.push(record);
      } else if (kind === 'Limitation') {
        organizedData[category].limitations.push(record);
      } else if (kind === 'Deficiency') {
        organizedData[category].deficiencies.push(record);
      } else {
        organizedData[category].comments.push(record);
      }
    }

    // Load Fabric.js for annotation rendering
    const fabric = await this.fabricService.getFabric();

    // Process each category
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
      const photoMappings: { type: string; item: any; index: number }[] = [];

      for (const kind of ['comments', 'limitations', 'deficiencies'] as const) {
        for (const record of categoryData[kind]) {
          const recordId = record[config.idFieldName] || record.PK_ID;
          console.log(`[PDF] Record: ${config.idFieldName}=${record[config.idFieldName]}, PK_ID=${record.PK_ID}, using recordId=${recordId}`);

          const displayText = record.Text || record.VisualText || '';
          const rawAnswers = record.Answers || record.Answer || '';
          const answers = rawAnswers.split(',').map((a: string) => a.trim()).filter((a: string) => a && a !== 'Other').join(', ');

          photoFetches.push(this.getPhotos(config, recordId, fabric));
          photoMappings.push({
            type: kind,
            item: {
              name: record.Name || record.VisualName || '',
              text: displayText,
              answers: answers,
              visualId: recordId
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
        categoryResult[mapping.type].push({ ...mapping.item, photos });
      });

      if (categoryResult.comments.length > 0 ||
          categoryResult.limitations.length > 0 ||
          categoryResult.deficiencies.length > 0) {
        result.push(categoryResult);
      }
    }

    return result;
  }

  // ─── Elevation Data (EFE only) ─────────────────────────────────────

  private async prepareElevationData(serviceId: string): Promise<any[]> {
    const result: any[] = [];
    const fabric = await this.fabricService.getFabric();

    const allRooms = await this.efeData.getEFEByService(serviceId);
    if (!allRooms || allRooms.length === 0) {
      return result;
    }

    for (const roomRecord of allRooms) {
      const roomName = roomRecord.RoomName || 'Unknown Room';
      const roomId = roomRecord.EFEID || roomRecord.PK_ID;

      const roomResult: any = {
        name: roomName,
        location: roomRecord.Location || '',
        fdf: roomRecord.FDF || '',
        fdfPhotos: {},
        notes: roomRecord.Notes || '',
        points: [],
        photos: []
      };

      if (roomId) {
        // Process FDF photos
        try {
          const fdfPhotoTypes = [
            { field: 'FDFPhotoTop', attachmentField: 'FDFPhotoTopAttachment', key: 'top', annotationField: 'FDFTopAnnotation', drawingsField: 'FDFTopDrawings' },
            { field: 'FDFPhotoBottom', attachmentField: 'FDFPhotoBottomAttachment', key: 'bottom', annotationField: 'FDFBottomAnnotation', drawingsField: 'FDFBottomDrawings' },
            { field: 'FDFPhotoThreshold', attachmentField: 'FDFPhotoThresholdAttachment', key: 'threshold', annotationField: 'FDFThresholdAnnotation', drawingsField: 'FDFThresholdDrawings' }
          ];

          const fdfPhotosData: any = {};

          for (const photoType of fdfPhotoTypes) {
            const photoPath = roomRecord[photoType.attachmentField] || roomRecord[photoType.field];
            if (!photoPath) continue;

            try {
              let base64Data: string | null = null;

              if (photoPath.startsWith('data:')) {
                base64Data = photoPath;
              } else if (this.caspioService.isS3Key(photoPath)) {
                base64Data = await this.fetchS3ToBase64(photoPath);
              } else if (photoPath.includes('.amazonaws.com/uploads/')) {
                try {
                  const urlObj = new URL(photoPath);
                  const s3Key = urlObj.pathname.substring(1);
                  if (s3Key && this.caspioService.isS3Key(s3Key)) {
                    base64Data = await this.fetchS3ToBase64(s3Key);
                  }
                } catch { /* not a valid URL */ }
              } else if (photoPath.startsWith('/')) {
                const rawData = await firstValueFrom(this.caspioService.getImageFromFilesAPI(photoPath));
                if (rawData && rawData.startsWith('data:')) {
                  base64Data = await this.ensurePdfCompatibleImage(rawData);
                }
              }

              if (base64Data && base64Data.startsWith('data:')) {
                let finalUrl = base64Data;
                const caption = roomRecord[photoType.annotationField] || '';
                const drawingsData = roomRecord[photoType.drawingsField] || null;

                if (drawingsData) {
                  try {
                    const annotatedUrl = await renderAnnotationsOnPhoto(finalUrl, drawingsData, { quality: 0.9, format: 'jpeg', fabric });
                    if (annotatedUrl && annotatedUrl !== finalUrl) {
                      finalUrl = annotatedUrl;
                    }
                  } catch (renderError) {
                    console.error(`[PDF] Error rendering annotations for FDF ${photoType.key}:`, renderError);
                  }
                }

                fdfPhotosData[photoType.key] = true;
                fdfPhotosData[`${photoType.key}Url`] = finalUrl;
                fdfPhotosData[`${photoType.key}Caption`] = caption;
                fdfPhotosData[`${photoType.key}Drawings`] = drawingsData;
              }
            } catch (error) {
              console.error(`[PDF] Failed to convert FDF ${photoType.key} photo:`, error);
            }
          }

          roomResult.fdfPhotos = fdfPhotosData;
        } catch (error) {
          console.error(`[PDF] Error fetching FDF photos for room ${roomName}:`, error);
        }

        // Process points
        try {
          const dbPoints = await this.efeData.getEFEPoints(roomId);

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

            if (pointId) {
              const attachments = await this.efeData.getEFEAttachments(pointId);

              for (const attachment of (attachments || [])) {
                // Check Attachment first — it has the modern S3 key; Photo may be deprecated
                const photoPath = attachment.Attachment || attachment.Photo || attachment.PhotoPath || '';
                const drawingsData = attachment.Drawings || attachment.drawings || null;
                const caption = attachment.Caption || attachment.caption || '';
                let finalUrl: string | null = null;

                // Check for existing data URL (skip blob: URLs — pdfmake can't use them)
                const existingUrl = attachment.displayUrl || attachment.url || '';
                if (existingUrl && existingUrl.startsWith('data:')) {
                  finalUrl = existingUrl;
                }

                if (!finalUrl && photoPath) {
                  if (this.caspioService.isS3Key(photoPath)) {
                    try {
                      finalUrl = await this.fetchS3ToBase64(photoPath);
                    } catch (s3Error) {
                      console.error('[PDF] Failed to load point photo from S3:', s3Error);
                    }
                  } else if (photoPath.includes('.amazonaws.com/uploads/')) {
                    try {
                      const urlObj = new URL(photoPath);
                      const s3Key = urlObj.pathname.substring(1);
                      if (s3Key && this.caspioService.isS3Key(s3Key)) {
                        finalUrl = await this.fetchS3ToBase64(s3Key);
                      }
                    } catch { /* not a valid URL */ }
                  } else if (photoPath.startsWith('/')) {
                    try {
                      const base64 = await firstValueFrom(this.caspioService.getImageFromFilesAPI(photoPath));
                      if (base64 && base64.startsWith('data:')) {
                        finalUrl = await this.ensurePdfCompatibleImage(base64);
                      }
                    } catch (apiError) {
                      console.error('[PDF] Failed to load point photo from API:', apiError);
                    }
                  }
                }

                if (finalUrl && finalUrl.startsWith('data:') && drawingsData) {
                  try {
                    const annotatedUrl = await renderAnnotationsOnPhoto(finalUrl, drawingsData, { quality: 0.9, format: 'jpeg', fabric });
                    if (annotatedUrl && annotatedUrl !== finalUrl) {
                      finalUrl = annotatedUrl;
                    }
                  } catch (renderError) {
                    console.error('[PDF] Error rendering point photo annotation:', renderError);
                  }
                }

                if (finalUrl) {
                  pointData.photos.push({ url: finalUrl, caption, conversionSuccess: true });
                } else if (photoPath) {
                  // Mark as failed
                }
              }
            }

            roomResult.points.push(pointData);
          }
        } catch (error) {
          console.error(`[PDF] Error loading points for room ${roomName}:`, error);
        }
      }

      result.push(roomResult);
    }

    return result;
  }

  // ─── Data Dispatchers ──────────────────────────────────────────────

  private async getRecords(config: TemplateConfig, serviceId: string): Promise<any[]> {
    switch (config.id) {
      case 'hud':
        return this.hudData.getHudByService(serviceId);
      case 'efe':
        return this.efeData.getVisualsByService(serviceId);
      case 'dte':
        return this.dteData.getVisualsByService(serviceId, true);
      case 'lbw':
        return this.lbwData.getVisualsByService(serviceId, true);
      default:
        return [];
    }
  }

  private async getAttachments(config: TemplateConfig, recordId: string): Promise<any[]> {
    switch (config.id) {
      case 'hud':
        return this.hudData.getHudAttachments(recordId);
      case 'efe':
        return this.efeData.getVisualAttachments(recordId);
      case 'dte':
        return this.dteData.getVisualAttachments(recordId);
      case 'lbw':
        return this.lbwData.getVisualAttachments(recordId);
      default:
        return [];
    }
  }

  // ─── Photo Loading ─────────────────────────────────────────────────

  private async getPhotos(config: TemplateConfig, recordId: string, fabric: any): Promise<any[]> {
    try {
      const attachments = await this.getAttachments(config, recordId);
      console.log(`[PDF] getPhotos: config=${config.id}, recordId=${recordId}, attachments=${attachments?.length ?? 'null'}`);
      if (attachments?.[0]) {
        console.log(`[PDF] First attachment keys:`, Object.keys(attachments[0]).join(', '));
      }
      const photos = [];

      for (let idx = 0; idx < (attachments || []).length; idx++) {
        const attachment = attachments[idx];
        const caption = attachment.Annotation || attachment.Caption || attachment.caption || '';
        const drawingsData = attachment.Drawings || attachment.drawings || null;
        let finalUrl: string | null = null;

        // Log all relevant fields for debugging
        const serverPath = attachment.Attachment || attachment.Photo || attachment.PhotoPath || '';
        console.log(`[PDF] Photo ${idx + 1}/${attachments.length}: Attachment="${(attachment.Attachment || '').substring(0, 80)}", Photo="${(attachment.Photo || '').substring(0, 80)}", serverPath="${serverPath.substring(0, 80)}"`);

        // Check for existing data URL first (skip blob: URLs — pdfmake can't use them)
        const existingUrl = attachment.displayUrl || attachment.url || '';
        if (existingUrl && existingUrl.startsWith('data:')) {
          finalUrl = existingUrl;
          console.log(`[PDF] Photo ${idx + 1}: Using existing data URL (${existingUrl.substring(0, 30)}...)`);
        }

        // Try server paths if no local data URL
        if (!finalUrl && serverPath) {
          try {
            if (serverPath.startsWith('data:')) {
              finalUrl = serverPath;
              console.log(`[PDF] Photo ${idx + 1}: serverPath is data URL`);
            } else if (this.caspioService.isS3Key(serverPath)) {
              console.log(`[PDF] Photo ${idx + 1}: Fetching S3 key "${serverPath.substring(0, 60)}"`);
              finalUrl = await this.fetchS3ToBase64(serverPath);
              console.log(`[PDF] Photo ${idx + 1}: S3 fetch result=${finalUrl ? `data URL (${finalUrl.substring(0, 30)}...)` : 'null'}`);
            } else if (serverPath.includes('.amazonaws.com/uploads/')) {
              try {
                const urlObj = new URL(serverPath);
                const s3Key = urlObj.pathname.substring(1);
                console.log(`[PDF] Photo ${idx + 1}: Full S3 URL, extracted key="${s3Key.substring(0, 60)}"`);
                if (s3Key && this.caspioService.isS3Key(s3Key)) {
                  finalUrl = await this.fetchS3ToBase64(s3Key);
                }
              } catch { /* not a valid URL */ }
            } else if (serverPath.startsWith('/')) {
              console.log(`[PDF] Photo ${idx + 1}: Using files API for "${serverPath.substring(0, 60)}"`);
              const base64Data = await firstValueFrom(this.caspioService.getImageFromFilesAPI(serverPath));
              if (base64Data && base64Data.startsWith('data:')) {
                finalUrl = await this.ensurePdfCompatibleImage(base64Data);
              }
            } else {
              console.warn(`[PDF] Photo ${idx + 1}: Unrecognized path format: "${serverPath.substring(0, 80)}"`);
            }
          } catch (error) {
            console.error(`[PDF] Photo ${idx + 1}: Failed to convert:`, error);
          }
        }

        // Render annotations if we have a valid URL and drawings data
        if (finalUrl && finalUrl.startsWith('data:') && drawingsData) {
          try {
            const annotatedUrl = await renderAnnotationsOnPhoto(finalUrl, drawingsData, { quality: 0.9, format: 'jpeg', fabric });
            if (annotatedUrl && annotatedUrl !== finalUrl) {
              finalUrl = annotatedUrl;
            }
          } catch (renderError) {
            console.error('[PDF] Error rendering photo annotation:', renderError);
          }
        }

        console.log(`[PDF] Photo ${idx + 1}: Final result=${finalUrl ? 'SUCCESS' : 'FAILED'}`);
        if (finalUrl) {
          photos.push({ url: finalUrl, caption, conversionSuccess: true });
        } else if (attachment.Photo || attachment.PhotoPath || attachment.Attachment) {
          photos.push({ url: '', caption, conversionSuccess: false });
        }
      }

      return photos;
    } catch (error) {
      console.error('[PDF] Error getting photos:', error);
      return [];
    }
  }

  // ─── Primary Photo ─────────────────────────────────────────────────

  private async loadPrimaryPhoto(projectInfo: any): Promise<void> {
    if (!projectInfo?.primaryPhoto || typeof projectInfo.primaryPhoto !== 'string') {
      return;
    }

    let convertedPhotoData: string | null = null;

    if (projectInfo.primaryPhoto.startsWith('data:')) {
      convertedPhotoData = projectInfo.primaryPhoto;
    } else if (projectInfo.primaryPhoto.startsWith('blob:')) {
      try {
        const response = await fetch(projectInfo.primaryPhoto);
        const blob = await response.blob();
        convertedPhotoData = await this.blobToBase64(blob);
      } catch (error) {
        console.error('[PDF] Error converting blob URL:', error);
      }
    } else if (this.caspioService.isS3Key(projectInfo.primaryPhoto)) {
      try {
        const s3Url = await this.caspioService.getS3FileUrl(projectInfo.primaryPhoto);
        if (s3Url) {
          const response = await fetch(s3Url);
          if (response.ok) {
            const blob = await response.blob();
            convertedPhotoData = await this.blobToBase64(blob);
          }
        }
      } catch (error) {
        console.error('[PDF] Error loading primary photo from S3:', error);
      }
    } else if (projectInfo.primaryPhoto.startsWith('/')) {
      try {
        const imageData = await firstValueFrom(this.caspioService.getImageFromFilesAPI(projectInfo.primaryPhoto));
        if (imageData && typeof imageData === 'string' && imageData.startsWith('data:')) {
          convertedPhotoData = imageData;
        }
      } catch (error) {
        console.error('[PDF] Error converting primary photo:', error);
      }
    }

    if (convertedPhotoData) {
      convertedPhotoData = await this.ensurePdfCompatibleImage(convertedPhotoData);
      projectInfo.primaryPhotoBase64 = convertedPhotoData;
      projectInfo.primaryPhoto = convertedPhotoData;
    }
  }

  // ─── Company Logo ──────────────────────────────────────────────────

  private async loadCompanyLogo(projectInfo: any): Promise<void> {
    if (!projectInfo?.companyLogo || typeof projectInfo.companyLogo !== 'string') {
      return;
    }

    let logoData: string | null = null;
    const logoPath = projectInfo.companyLogo;

    try {
      if (logoPath.startsWith('data:')) {
        logoData = logoPath;
      } else if (this.caspioService.isS3Key(logoPath)) {
        const s3Url = await this.caspioService.getS3FileUrl(logoPath);
        if (s3Url) {
          const response = await fetch(s3Url);
          if (response.ok) {
            const blob = await response.blob();
            logoData = await this.blobToBase64(blob);
          }
        }
      } else if (logoPath.startsWith('/')) {
        const imageData = await firstValueFrom(this.caspioService.getImageFromFilesAPI(logoPath));
        if (imageData && typeof imageData === 'string' && imageData.startsWith('data:')) {
          logoData = imageData;
        }
      }
    } catch (error) {
      console.warn('[PDF] Failed to load company logo:', error);
    }

    if (logoData) {
      logoData = await this.ensurePdfCompatibleImage(logoData);
      projectInfo.companyLogoBase64 = logoData;
    }
  }

  // ─── Utilities ─────────────────────────────────────────────────────

  private async loadDocumentViewer(): Promise<DocumentViewerCtor> {
    if (!this.documentViewerComponent) {
      const module = await import('../../components/document-viewer/document-viewer.component');
      this.documentViewerComponent = module.DocumentViewerComponent;
    }
    return this.documentViewerComponent;
  }

  private formatDate(dateString: string): string {
    if (!dateString) return '';
    try {
      return new Date(dateString).toLocaleDateString();
    } catch {
      return dateString;
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /** Fetch an S3 key, download the image, and return a base64 data URL */
  private async fetchS3ToBase64(s3Key: string): Promise<string | null> {
    const s3Url = await this.caspioService.getS3FileUrl(s3Key);
    if (!s3Url) return null;
    const response = await fetch(s3Url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const dataUrl = await this.blobToBase64(blob);
    // pdfmake only supports JPEG/PNG — convert WebP or other formats via canvas
    return this.ensurePdfCompatibleImage(dataUrl);
  }

  /**
   * pdfmake only supports JPEG and PNG. If the image is WebP (RIFF header)
   * or any other unsupported format, convert it to JPEG via canvas.
   */
  private async ensurePdfCompatibleImage(dataUrl: string): Promise<string> {
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) return dataUrl;
    try {
      const raw = atob(dataUrl.substring(commaIdx + 1, commaIdx + 9));
      if (raw.length < 2) return dataUrl;
      const b0 = raw.charCodeAt(0);
      const b1 = raw.charCodeAt(1);
      // Already JPEG (FF D8) — pass through
      if (b0 === 0xFF && b1 === 0xD8) return dataUrl;
      // Already PNG (89 50 4E 47) — pass through
      if (b0 === 0x89 && b1 === 0x50 && raw.length >= 4 &&
          raw.charCodeAt(2) === 0x4E && raw.charCodeAt(3) === 0x47) return dataUrl;
    } catch { /* decode error — try to convert anyway */ }

    // Not JPEG/PNG — convert via canvas (handles WebP, BMP, GIF, etc.)
    console.log('[PDF] Converting non-JPEG/PNG image to JPEG via canvas');
    return new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
        resolve(jpegDataUrl);
      };
      img.onerror = () => {
        console.warn('[PDF] Canvas conversion failed, returning original');
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  }
}
