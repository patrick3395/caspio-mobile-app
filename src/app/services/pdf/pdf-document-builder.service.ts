import { Injectable } from '@angular/core';
import type { TDocumentDefinitions, Content, ContentColumns, ContentStack, ContentTable } from 'pdfmake/interfaces';
import { COLORS, PDF_STYLES, LAYOUT_INFO_TABLE, LAYOUT_NO_BORDERS, LAYOUT_SUMMARY_TABLE } from './pdf-styles';

@Injectable({ providedIn: 'root' })
export class PdfDocumentBuilderService {

  async buildDocument(
    projectData: any,
    structuralData: any[],
    elevationData: any[],
    serviceData: any
  ): Promise<TDocumentDefinitions> {
    const content: Content[] = [];

    // Cover page
    content.push(this.buildCoverPage(projectData, serviceData));

    // Deficiency summary
    content.push({ text: '', pageBreak: 'before' });
    content.push(this.buildDeficiencySummary(structuralData));

    // Project information
    content.push({ text: '', pageBreak: 'before' });
    content.push(this.buildProjectInfo(projectData));

    // Service details
    content.push({ text: '', pageBreak: 'before' });
    content.push(this.buildServiceDetails(projectData, serviceData));

    // Structural sections
    if (structuralData && structuralData.length > 0) {
      content.push({ text: '', pageBreak: 'before' });
      content.push(this.buildMajorSectionHeader('Visual Condition Assessment'));
      for (const category of structuralData) {
        content.push({ text: '', pageBreak: 'before' });
        content.push(this.buildStructuralSection(category));
      }
    }

    // Elevation data - each room as its own section
    if (elevationData && elevationData.length > 0) {
      content.push({ text: '', pageBreak: 'before' });
      content.push(this.buildMajorSectionHeader('Elevation Plot'));
      for (let i = 0; i < elevationData.length; i++) {
        content.push({ text: '', pageBreak: 'before' });
        content.push(this.buildElevationRoom(elevationData[i]));
      }
    }

    return {
      pageSize: 'LETTER',
      pageOrientation: 'portrait',
      pageMargins: [40, 60, 40, 50],
      header: (currentPage: number) => {
        if (currentPage === 1) return null;
        return {
          margin: [40, 20, 40, 0],
          columns: [
            { text: projectData?.address || 'Property Report', style: 'pageHeader', width: '*' },
            { text: this.formatDate(projectData?.inspectionDate), style: 'pageHeader', alignment: 'right', width: 'auto' }
          ]
        } as ContentColumns;
      },
      footer: (currentPage: number, pageCount: number) => ({
        margin: [40, 10, 40, 0],
        columns: [
          { text: projectData?.companyName || '', style: 'pageFooter', width: '*' },
          { text: `Page ${currentPage} of ${pageCount}`, style: 'pageFooter', alignment: 'right', width: 'auto' }
        ]
      } as ContentColumns),
      content,
      styles: PDF_STYLES,
      defaultStyle: { font: 'Roboto', fontSize: 10, color: COLORS.charcoal },
      images: {} as Record<string, string>,
    };
  }

  // ─── Cover Page ──────────────────────────────────────────────────

  private buildCoverPage(projectData: any, serviceData: any): Content {
    const serviceName = serviceData?.serviceName || 'EFE - Engineer\'s Foundation Evaluation';
    const companyName = projectData?.companyName || '';
    const address = projectData?.address || 'Property Address';
    const cityStateZip = `${projectData?.city || ''}, ${projectData?.state || ''} ${projectData?.zip || ''}`;
    const clientName = projectData?.clientName || 'Client';
    const agentName = projectData?.agentName || 'N/A';
    const reportDate = this.formatDate(projectData?.inspectionDate);

    const stack: Content[] = [];

    // Company logo (top-right)
    const companyLogo = projectData?.companyLogoBase64;
    if (companyLogo && this.isPdfSafeImage(companyLogo)) {
      stack.push({
        image: companyLogo,
        width: 40,
        alignment: 'right',
        margin: [0, 0, 0, 8]
      });
    }

    // Orange accent line
    stack.push({
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 532, y2: 0, lineWidth: 3, lineColor: COLORS.primary }],
      margin: [0, 0, 0, 20]
    });

    // Title
    stack.push({
      text: [
        { text: 'Site Assessment for:\n', italics: true, bold: false, fontSize: 16 },
        { text: serviceName, bold: true, fontSize: 22 }
      ],
      alignment: 'center',
      color: COLORS.charcoal,
      margin: [0, 10, 0, 6]
    });
    stack.push({ text: `Prepared by ${companyName}`, style: 'subtitle', margin: [0, 0, 0, 24] });

    // Primary photo
    const primaryPhoto = projectData?.primaryPhotoBase64 || projectData?.primaryPhoto;
    if (primaryPhoto && this.isPdfSafeImage(primaryPhoto)) {
      stack.push({
        image: primaryPhoto,
        width: 315,
        alignment: 'center',
        margin: [0, 0, 0, 24]
      });
    }

    // Address card
    stack.push({
      table: {
        widths: ['*'],
        body: [[{
          stack: [
            { text: address, fontSize: 14, bold: true, alignment: 'center', color: COLORS.charcoal, margin: [0, 16, 0, 4] },
            { text: cityStateZip, fontSize: 10, alignment: 'center', color: COLORS.darkGray, margin: [0, 0, 0, 12] },
            { canvas: [{ type: 'line', x1: 80, y1: 0, x2: 320, y2: 0, lineWidth: 0.5, lineColor: COLORS.borderGray }], margin: [0, 0, 0, 12] },
            {
              columns: [
                { text: 'Client', fontSize: 8, color: COLORS.mediumGray, alignment: 'center', width: '*' },
                { text: 'Agent', fontSize: 8, color: COLORS.mediumGray, alignment: 'center', width: '*' },
                { text: 'Date', fontSize: 8, color: COLORS.mediumGray, alignment: 'center', width: '*' },
              ],
              margin: [0, 0, 0, 2]
            } as ContentColumns,
            {
              columns: [
                { text: clientName, fontSize: 10, bold: true, alignment: 'center', color: COLORS.charcoal, width: '*' },
                { text: agentName, fontSize: 10, bold: true, alignment: 'center', color: COLORS.charcoal, width: '*' },
                { text: reportDate, fontSize: 10, bold: true, alignment: 'center', color: COLORS.charcoal, width: '*' },
              ],
              margin: [0, 0, 0, 16]
            } as ContentColumns,
          ],
          fillColor: COLORS.backgroundGray
        }]]
      },
      layout: LAYOUT_NO_BORDERS,
      margin: [30, 0, 30, 0]
    } as ContentTable);

    return { stack } as ContentStack;
  }

  // ─── Deficiency Summary ──────────────────────────────────────────

  private buildDeficiencySummary(structuralData: any[]): Content {
    const stack: Content[] = [];

    stack.push(this.buildPageTitle('DEFICIENCY SUMMARY'));

    if (!structuralData || structuralData.length === 0) {
      stack.push({ text: 'No structural data available.', style: 'bodyText', margin: [0, 10, 0, 0] });
      return { stack } as ContentStack;
    }

    const tableBody: any[][] = [
      [
        { text: 'Category', bold: true, fontSize: 10, color: COLORS.white },
        { text: 'Deficiencies Found', bold: true, fontSize: 10, alignment: 'center', color: COLORS.white }
      ]
    ];

    let total = 0;
    for (const category of structuralData) {
      const count = category.deficiencies?.length || 0;
      total += count;
      if (count === 0) continue; // Skip categories with no deficiencies
      tableBody.push([
        { text: category.name, fontSize: 9.5, color: COLORS.darkGray },
        {
          text: `${count}`,
          fontSize: 9.5,
          alignment: 'center',
          bold: true,
          color: COLORS.deficiencyHeader
        }
      ]);
    }

    // Total row
    tableBody.push([
      { text: 'TOTAL', bold: true, fontSize: 10, color: COLORS.charcoal, fillColor: COLORS.labelBg },
      {
        text: `${total}`,
        bold: true,
        fontSize: 10,
        alignment: 'center',
        color: total > 0 ? COLORS.deficiencyHeader : COLORS.charcoal,
        fillColor: COLORS.labelBg
      }
    ]);

    stack.push({
      table: { headerRows: 1, widths: ['*', 150], body: tableBody },
      layout: LAYOUT_SUMMARY_TABLE,
      margin: [0, 10, 0, 0]
    } as ContentTable);

    return { stack } as ContentStack;
  }

  // ─── Project Info ────────────────────────────────────────────────

  private buildProjectInfo(projectData: any): Content {
    const stack: Content[] = [];
    stack.push(this.buildPageTitle('PROJECT INFORMATION'));

    const rows: [string, string][] = [
      ['Project ID', projectData?.projectId || 'N/A'],
      ['Property Address', projectData?.fullAddress || 'N/A'],
      ['Client Name', projectData?.clientName || 'N/A'],
      ['Agent Name', projectData?.agentName || 'N/A'],
      ['Inspector Name', projectData?.inspectorName || 'N/A'],
      ['Year Built', String(projectData?.yearBuilt || 'N/A')],
      ['Square Feet', String(projectData?.squareFeet || 'N/A')],
      ['Type of Building', projectData?.typeOfBuilding || 'Single Family'],
      ['Building Style', projectData?.style || 'N/A'],
    ];

    stack.push(this.buildKeyValueTable(rows));
    return { stack } as ContentStack;
  }

  // ─── Service Details ─────────────────────────────────────────────

  private buildServiceDetails(projectData: any, serviceData: any): Content {
    const stack: Content[] = [];
    stack.push(this.buildPageTitle('SERVICE & INSPECTION DETAILS'));

    const rows: [string, string][] = [
      ['Date of Inspection', this.formatDate(projectData?.inspectionDate)],
      ['Weather Conditions', projectData?.weatherConditions || 'N/A'],
      ['Outdoor Temperature', projectData?.outdoorTemperature || 'N/A'],
      ['In Attendance', projectData?.inAttendance || 'N/A'],
      ['Occupancy/Furnishings', projectData?.occupancyFurnishings || 'N/A'],
    ];

    if (projectData?.firstFoundationType) {
      rows.push(['Primary Foundation Type', projectData.firstFoundationType]);
    }
    if (projectData?.secondFoundationType) {
      const rooms = projectData.secondFoundationRooms ? ` (${projectData.secondFoundationRooms})` : '';
      rows.push(['Secondary Foundation Type', `${projectData.secondFoundationType}${rooms}`]);
    }
    if (projectData?.thirdFoundationType) {
      const rooms = projectData.thirdFoundationRooms ? ` (${projectData.thirdFoundationRooms})` : '';
      rows.push(['Additional Foundation Type', `${projectData.thirdFoundationType}${rooms}`]);
    }

    if (projectData?.ownerOccupantInterview) {
      rows.push(['Owner/Occupant Interview', projectData.ownerOccupantInterview]);
    }

    stack.push(this.buildKeyValueTable(rows));

    // Service notes
    const notes = serviceData?.Notes || projectData?.serviceData?.Notes;
    if (notes) {
      stack.push({
        table: {
          widths: ['*'],
          body: [[{
            stack: [
              { text: 'Service Notes', bold: true, fontSize: 11, color: COLORS.charcoal, margin: [0, 0, 0, 6] },
              { text: notes, style: 'bodyText' }
            ],
            margin: [12, 10, 12, 10],
            fillColor: COLORS.backgroundGray
          }]]
        },
        layout: LAYOUT_NO_BORDERS,
        margin: [0, 16, 0, 0]
      } as ContentTable);
    }

    return { stack } as ContentStack;
  }

  // ─── Structural Section ──────────────────────────────────────────

  private buildStructuralSection(category: any): Content {
    const stack: Content[] = [];

    stack.push(this.buildPageTitle(category.name.toUpperCase()));

    // Comments
    if (category.comments && category.comments.length > 0) {
      stack.push(this.buildSubSectionBanner('COMMENTS', '#4a4f52', true));
      for (const item of category.comments) {
        stack.push(this.buildVisualItem(item, '#27ae60'));
      }
    }

    // Limitations
    if (category.limitations && category.limitations.length > 0) {
      stack.push(this.buildSubSectionBanner('LIMITATIONS', '#4a4f52', true));
      for (const item of category.limitations) {
        stack.push(this.buildVisualItem(item, COLORS.limitationHeader));
      }
    }

    // Deficiencies
    if (category.deficiencies && category.deficiencies.length > 0) {
      stack.push(this.buildSubSectionBanner('DEFICIENCIES', '#4a4f52', true));
      for (const item of category.deficiencies) {
        stack.push(this.buildVisualItem(item, COLORS.deficiencyHeader));
      }
    }

    return { stack } as ContentStack;
  }

  // ─── Visual Item ─────────────────────────────────────────────────

  private buildVisualItem(item: any, accentColor: string = COLORS.primary): Content {
    const itemStack: Content[] = [];

    // Item name with left accent bar
    itemStack.push({
      table: {
        widths: [3, '*'],
        body: [[
          { text: '', fillColor: accentColor },
          { text: item.name || '', style: 'itemName', fillColor: COLORS.labelBg, margin: [8, 5, 6, 5] }
        ]]
      },
      layout: LAYOUT_NO_BORDERS,
      margin: [0, 8, 0, 4]
    } as ContentTable);

    // Text
    if (item.text) {
      itemStack.push({ text: item.text, style: 'bodyText', margin: [12, 0, 0, 4] });
    }

    // Answers
    if (item.answers) {
      itemStack.push({ text: item.answers, style: 'answers', margin: [12, 0, 0, 4] });
    }

    // Photos
    if (item.photos && item.photos.length > 0) {
      const photoGrid = this.buildPhotoGrid(item.photos);
      if (photoGrid) {
        itemStack.push(photoGrid);
      }
    }

    // Subtle separator
    itemStack.push({
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 532, y2: 0, lineWidth: 0.3, lineColor: COLORS.lightGray }],
      margin: [0, 8, 0, 4]
    });

    return {
      stack: itemStack,
      unbreakable: this.isSmallEnoughToBeUnbreakable(item)
    } as ContentStack;
  }

  // ─── Photo Grid ──────────────────────────────────────────────────

  private buildPhotoGrid(photos: any[]): Content | null {
    const validPhotos = photos.filter(p => {
      const url = p?.displayUrl || p?.url || '';
      return this.isPdfSafeImage(url);
    });

    if (validPhotos.length === 0) {
      if (photos.length > 0) {
        return {
          text: `[${photos.length} photo(s) - images not available in PDF]`,
          italics: true,
          fontSize: 9,
          color: COLORS.mediumGray,
          margin: [12, 4, 0, 4]
        };
      }
      return null;
    }

    const photosPerRow = validPhotos.length <= 2 ? 2 : 3;
    const photoWidth = photosPerRow === 2 ? 218 : 143;
    const rows: Content[][] = [];
    let currentRow: Content[] = [];

    for (let i = 0; i < validPhotos.length; i++) {
      const photo = validPhotos[i];
      const url = photo.displayUrl || photo.url || '';
      const caption = photo.caption || '';

      const photoBlock: ContentStack = {
        stack: [
          { image: url, width: photoWidth, margin: [0, 0, 0, 2] },
          ...(caption ? [{ text: caption.length > 60 ? caption.substring(0, 57) + '...' : caption, style: 'caption' }] : [])
        ]
      };

      currentRow.push(photoBlock);

      if (currentRow.length === photosPerRow || i === validPhotos.length - 1) {
        while (currentRow.length < photosPerRow) {
          currentRow.push({ text: '', width: photoWidth } as any);
        }
        rows.push(currentRow);
        currentRow = [];
      }
    }

    const gridStack: Content[] = [];
    for (const row of rows) {
      gridStack.push({
        columns: row,
        columnGap: 8,
        margin: [12, 4, 0, 4]
      } as ContentColumns);
    }

    return { stack: gridStack } as ContentStack;
  }

  // ─── Elevation Room ─────────────────────────────────────────────

  private buildElevationRoom(room: any): Content {
    const stack: Content[] = [];

    // Room name as section title (like structural categories)
    stack.push(this.buildPageTitle(room.name?.toUpperCase() || 'ROOM'));

    // Location sub-section (only if applicable)
    if (room.location && room.location.trim()) {
      stack.push(this.buildSubSectionBanner('LOCATION', '#4a4f52', true));
      stack.push({
        text: room.location,
        style: 'bodyText',
        margin: [12, 4, 0, 8]
      });
    }

    // Flooring Difference Factor sub-section (only if not None/empty)
    const hasFdf = room.fdf && room.fdf.trim() && room.fdf !== 'None';
    if (hasFdf) {
      stack.push(this.buildSubSectionBanner('FLOORING DIFFERENCE FACTOR', '#4a4f52', true));
      stack.push({
        text: room.fdf,
        style: 'bodyText',
        margin: [12, 4, 0, 4]
      });

      // FDF Photos with titles
      const fdfPhotoLabels: { key: string; label: string }[] = [
        { key: 'top', label: 'FDF Top' },
        { key: 'bottom', label: 'FDF Bottom' },
        { key: 'threshold', label: 'FDF Threshold' }
      ];
      const fdfColumns: Content[] = [];

      for (const { key, label } of fdfPhotoLabels) {
        const url = room.fdfPhotos?.[`${key}Url`];
        if (url && this.isPdfSafeImage(url)) {
          fdfColumns.push({
            stack: [
              { text: label, bold: true, fontSize: 10, color: COLORS.charcoal, margin: [0, 0, 0, 4] },
              { image: url, width: 143, margin: [0, 0, 0, 2] }
            ],
            width: 143
          } as any);
        }
      }

      if (fdfColumns.length > 0) {
        // Pad to 3 columns
        while (fdfColumns.length < 3) {
          fdfColumns.push({ text: '', width: 143 } as any);
        }
        stack.push({
          columns: fdfColumns,
          columnGap: 8,
          margin: [12, 4, 0, 4]
        } as ContentColumns);
      }
    }

    // Measurements sub-section
    if (room.points && room.points.length > 0) {
      stack.push(this.buildSubSectionBanner('MEASUREMENTS', '#4a4f52', true));

      for (const point of room.points) {
        const pointStack: Content[] = [];

        // Point name with accent bar
        pointStack.push({
          table: {
            widths: [3, '*'],
            body: [[
              { text: '', fillColor: COLORS.primary },
              { text: point.name || 'Point', style: 'itemName', fillColor: COLORS.labelBg, margin: [8, 5, 6, 5] }
            ]]
          },
          layout: LAYOUT_NO_BORDERS,
          margin: [0, 8, 0, 4]
        } as ContentTable);

        // Measurement value (only if present)
        if (point.value) {
          pointStack.push({ text: `${point.value}"`, style: 'bodyText', margin: [12, 0, 0, 4] });
        }

        // Photos with "Location" / "Measurement" titles
        const photos = (point.photos || []).filter((p: any) => {
          const url = p?.displayUrl || p?.url || '';
          return this.isPdfSafeImage(url);
        });

        if (photos.length > 0) {
          const photoLabels = ['Location', 'Measurement'];
          const columns: Content[] = [];

          for (let j = 0; j < photos.length; j++) {
            const photo = photos[j];
            const url = photo.displayUrl || photo.url || '';
            const label = j < photoLabels.length ? photoLabels[j] : `Photo ${j + 1}`;

            columns.push({
              stack: [
                { text: label, bold: true, fontSize: 10, color: COLORS.charcoal, margin: [0, 0, 0, 4] },
                { image: url, width: 143, margin: [0, 0, 0, 2] }
              ],
              width: 143
            } as any);
          }

          // Pad to 3 columns
          while (columns.length < 3) {
            columns.push({ text: '', width: 143 } as any);
          }

          pointStack.push({
            columns,
            columnGap: 8,
            margin: [12, 4, 0, 4]
          } as ContentColumns);
        }

        // Subtle separator
        pointStack.push({
          canvas: [{ type: 'line', x1: 0, y1: 0, x2: 532, y2: 0, lineWidth: 0.3, lineColor: COLORS.lightGray }],
          margin: [0, 8, 0, 4]
        });

        stack.push({ stack: pointStack } as ContentStack);
      }
    }

    // Notes (if any)
    if (room.notes && room.notes.trim()) {
      stack.push({
        table: {
          widths: ['*'],
          body: [[{
            stack: [
              { text: 'Notes', bold: true, fontSize: 11, color: COLORS.charcoal, margin: [0, 0, 0, 6] },
              { text: room.notes, style: 'bodyText' }
            ],
            margin: [12, 10, 12, 10],
            fillColor: COLORS.backgroundGray
          }]]
        },
        layout: LAYOUT_NO_BORDERS,
        margin: [0, 12, 0, 0]
      } as ContentTable);
    }

    return { stack } as ContentStack;
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private buildMajorSectionHeader(title: string): Content {
    return {
      text: title,
      fontSize: 26,
      bold: true,
      color: COLORS.charcoal,
      alignment: 'center',
      margin: [0, 200, 0, 0]
    };
  }

  private buildPageTitle(title: string): Content {
    return {
      stack: [
        { text: title, style: 'sectionHeader' },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 532, y2: 0, lineWidth: 2, lineColor: COLORS.primary }], margin: [0, 0, 0, 14] }
      ]
    } as ContentStack;
  }

  private buildSubSectionBanner(text: string, bgColor: string, whiteText: boolean): Content {
    return {
      table: {
        widths: ['*'],
        body: [[{
          text,
          bold: true,
          fontSize: 11,
          color: whiteText ? COLORS.white : COLORS.charcoal,
          fillColor: bgColor,
          margin: [10, 6, 10, 6]
        }]]
      },
      layout: LAYOUT_NO_BORDERS,
      margin: [0, 12, 0, 6]
    } as ContentTable;
  }

  private buildKeyValueTable(rows: [string, string][]): Content {
    const body = rows.map(([label, value]) => [
      { text: label, style: 'label', fillColor: COLORS.labelBg },
      { text: value, style: 'value' }
    ]);

    return {
      table: { widths: [150, '*'], body },
      layout: LAYOUT_INFO_TABLE,
      margin: [0, 8, 0, 0]
    } as ContentTable;
  }

  private isSmallEnoughToBeUnbreakable(item: any): boolean {
    const photoCount = item.photos?.filter((p: any) => {
      const url = p?.displayUrl || p?.url || '';
      return this.isPdfSafeImage(url);
    })?.length || 0;
    const textLength = (item.text?.length || 0) + (item.answers?.length || 0);
    return photoCount <= 2 && textLength < 500;
  }

  /** pdfmake only supports JPEG and PNG — verify actual binary magic bytes */
  private isPdfSafeImage(url: unknown): boolean {
    if (typeof url !== 'string') return false;
    const commaIdx = url.indexOf(',');
    if (commaIdx === -1 || !url.startsWith('data:')) return false;
    try {
      const raw = atob(url.substring(commaIdx + 1, commaIdx + 9));
      if (raw.length < 2) return false;
      const b0 = raw.charCodeAt(0);
      const b1 = raw.charCodeAt(1);
      // JPEG: FF D8
      if (b0 === 0xFF && b1 === 0xD8) return true;
      // PNG: 89 50 4E 47
      if (b0 === 0x89 && b1 === 0x50 && raw.length >= 4 &&
          raw.charCodeAt(2) === 0x4E && raw.charCodeAt(3) === 0x47) return true;
    } catch { /* invalid base64 */ }
    return false;
  }

  private formatDate(dateString?: string): string {
    if (!dateString) {
      return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }
    try {
      return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      return dateString;
    }
  }
}
