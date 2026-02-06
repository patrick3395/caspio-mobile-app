import { Injectable } from '@angular/core';
import type { TDocumentDefinitions, Content, ContentColumns, ContentStack, ContentTable } from 'pdfmake/interfaces';
import { COLORS, PDF_STYLES } from './pdf-styles';
import { getLogoBase64 } from './pdf-logo';

@Injectable({ providedIn: 'root' })
export class PdfDocumentBuilderService {

  async buildDocument(
    projectData: any,
    structuralData: any[],
    elevationData: any[],
    serviceData: any
  ): Promise<TDocumentDefinitions> {
    const logo = await getLogoBase64();

    const content: Content[] = [];

    // Cover page
    content.push(this.buildCoverPage(projectData, serviceData, logo));

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
      for (const category of structuralData) {
        content.push({ text: '', pageBreak: 'before' });
        content.push(this.buildStructuralSection(category));
      }
    }

    // Elevation data
    if (elevationData && elevationData.length > 0) {
      content.push({ text: '', pageBreak: 'before' });
      content.push(this.buildElevationSection(elevationData));
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
          { text: 'Noble Property Inspections LLC', style: 'pageFooter', width: '*' },
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

  private buildCoverPage(projectData: any, serviceData: any, logo: string | null): Content {
    const serviceName = serviceData?.serviceName || 'EFE - Engineer\'s Foundation Evaluation';
    const companyName = projectData?.companyName || 'Noble Property Inspections';
    const address = projectData?.address || 'Property Address';
    const cityStateZip = `${projectData?.city || ''}, ${projectData?.state || ''} ${projectData?.zip || ''}`;
    const clientName = projectData?.clientName || 'Client';
    const agentName = projectData?.agentName || 'N/A';
    const reportDate = this.formatDate(projectData?.inspectionDate);

    const stack: Content[] = [];

    // Logo
    if (logo) {
      stack.push({ image: logo, width: 150, alignment: 'center', margin: [0, 0, 0, 10] });
    }

    // Title
    stack.push({ text: serviceName, style: 'title', margin: [0, 10, 0, 6] });
    stack.push({ text: `Prepared by ${companyName}`, style: 'subtitle', margin: [0, 0, 0, 20] });

    // Primary photo
    const primaryPhoto = projectData?.primaryPhotoBase64 || projectData?.primaryPhoto;
    if (primaryPhoto && typeof primaryPhoto === 'string' && primaryPhoto.startsWith('data:')) {
      stack.push({
        image: primaryPhoto,
        width: 420,
        alignment: 'center',
        margin: [0, 0, 0, 20]
      });
    }

    // Address box
    stack.push({
      table: {
        widths: ['*'],
        body: [[{
          stack: [
            { text: address, fontSize: 14, bold: true, alignment: 'center', margin: [0, 10, 0, 4] },
            { text: cityStateZip, fontSize: 11, alignment: 'center', margin: [0, 0, 0, 8] },
            { text: `Client: ${clientName}`, fontSize: 11, alignment: 'center', margin: [0, 0, 0, 3] },
            { text: `Agent: ${agentName}`, fontSize: 11, alignment: 'center', margin: [0, 0, 0, 3] },
            { text: `Date: ${reportDate}`, fontSize: 11, alignment: 'center', margin: [0, 0, 0, 10] },
          ]
        }]]
      },
      layout: {
        hLineWidth: () => 0.6,
        vLineWidth: () => 0.6,
        hLineColor: () => '#dcdcdc',
        vLineColor: () => '#dcdcdc',
      },
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
        { text: 'Category', bold: true, fontSize: 11 },
        { text: 'Deficiencies Found', bold: true, fontSize: 11, alignment: 'center' }
      ]
    ];

    let total = 0;
    for (const category of structuralData) {
      const count = category.deficiencies?.length || 0;
      total += count;
      tableBody.push([
        { text: category.name, fontSize: 10 },
        { text: `${count} ${count !== 1 ? 'Defects' : 'Defect'}`, fontSize: 10, alignment: 'center' }
      ]);
    }

    tableBody.push([
      { text: 'TOTAL', bold: true, fontSize: 12 },
      { text: `${total} Total ${total !== 1 ? 'Defects' : 'Defect'}`, bold: true, fontSize: 12, alignment: 'center' }
    ]);

    stack.push({
      table: { headerRows: 1, widths: ['*', 150], body: tableBody },
      layout: 'infoTable',
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
      stack.push({ text: 'Service Notes:', bold: true, fontSize: 12, margin: [0, 15, 0, 4] });
      stack.push({ text: notes, style: 'bodyText' });
    }

    return { stack } as ContentStack;
  }

  // ─── Structural Section ──────────────────────────────────────────

  private buildStructuralSection(category: any): Content {
    const stack: Content[] = [];

    stack.push(this.buildPageTitle(category.name.toUpperCase()));

    // Comments
    if (category.comments && category.comments.length > 0) {
      stack.push(this.buildSubSectionBanner('COMMENTS', COLORS.commentHeader, true));
      for (const item of category.comments) {
        stack.push(this.buildVisualItem(item));
      }
    }

    // Limitations
    if (category.limitations && category.limitations.length > 0) {
      stack.push(this.buildSubSectionBanner('LIMITATIONS', COLORS.limitationHeader, false));
      for (const item of category.limitations) {
        stack.push(this.buildVisualItem(item));
      }
    }

    // Deficiencies
    if (category.deficiencies && category.deficiencies.length > 0) {
      stack.push(this.buildSubSectionBanner('DEFICIENCIES', COLORS.deficiencyHeader, true));
      for (const item of category.deficiencies) {
        stack.push(this.buildVisualItem(item));
      }
    }

    return { stack } as ContentStack;
  }

  // ─── Visual Item ─────────────────────────────────────────────────

  private buildVisualItem(item: any): Content {
    const itemStack: Content[] = [];

    // Item name with background
    itemStack.push({
      table: {
        widths: ['*'],
        body: [[{ text: item.name || '', style: 'itemName', fillColor: COLORS.backgroundGray, margin: [4, 3, 4, 3] }]]
      },
      layout: 'noBorders',
      margin: [0, 6, 0, 2]
    } as ContentTable);

    // Text
    if (item.text) {
      itemStack.push({ text: item.text, style: 'bodyText', margin: [8, 0, 0, 4] });
    }

    // Answers
    if (item.answers) {
      itemStack.push({ text: item.answers, style: 'answers', margin: [8, 0, 0, 4] });
    }

    // Photos
    if (item.photos && item.photos.length > 0) {
      const photoGrid = this.buildPhotoGrid(item.photos);
      if (photoGrid) {
        itemStack.push(photoGrid);
      }
    }

    // Separator line
    itemStack.push({
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 452, y2: 0, lineWidth: 0.3, lineColor: COLORS.lightGray }],
      margin: [0, 4, 0, 4]
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
      return typeof url === 'string' && url.startsWith('data:');
    });

    if (validPhotos.length === 0) {
      // Show placeholder text for photos that couldn't load
      if (photos.length > 0) {
        return {
          text: `[${photos.length} photo(s) - images not available in PDF]`,
          italics: true,
          fontSize: 9,
          color: COLORS.mediumGray,
          margin: [8, 4, 0, 4]
        };
      }
      return null;
    }

    const photosPerRow = validPhotos.length <= 2 ? 2 : 3;
    const photoWidth = photosPerRow === 2 ? 220 : 145;
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
        // Pad with empty cells if row is incomplete
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
        margin: [8, 4, 0, 4]
      } as ContentColumns);
    }

    return { stack: gridStack } as ContentStack;
  }

  // ─── Elevation Section ───────────────────────────────────────────

  private buildElevationSection(elevationData: any[]): Content {
    const stack: Content[] = [];

    stack.push(this.buildPageTitle('ELEVATION PLOT DATA'));
    stack.push({ text: 'Foundation elevation measurements and observations', style: 'bodyText', margin: [0, 0, 0, 10] });
    stack.push(this.buildSubSectionBanner('ELEVATION MEASUREMENTS', COLORS.commentHeader, true));

    for (const room of elevationData) {
      const roomItem = {
        name: room.name,
        text: this.buildRoomDescriptionText(room),
        photos: this.getAllRoomPhotos(room)
      };
      stack.push(this.buildVisualItem(roomItem));
    }

    return { stack } as ContentStack;
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  private buildPageTitle(title: string): Content {
    return {
      stack: [
        { text: title, style: 'sectionHeader' },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 452, y2: 0, lineWidth: 2, lineColor: COLORS.primary }], margin: [0, 0, 0, 10] }
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
          fontSize: 13,
          color: whiteText ? COLORS.white : COLORS.charcoal,
          fillColor: bgColor,
          margin: [6, 4, 6, 4]
        }]]
      },
      layout: 'noBorders',
      margin: [0, 10, 0, 6]
    } as ContentTable;
  }

  private buildKeyValueTable(rows: [string, string][]): Content {
    const body = rows.map(([label, value]) => [
      { text: label, style: 'label' },
      { text: value, style: 'value' }
    ]);

    return {
      table: { widths: [140, '*'], body },
      layout: 'infoTable',
      margin: [0, 10, 0, 0]
    } as ContentTable;
  }

  private buildRoomDescriptionText(room: any): string {
    let text = '';

    if (room.fdf && room.fdf !== 'None') {
      text += `Floor Differential Factor: ${room.fdf}\n`;
    }

    if (room.points && room.points.length > 0) {
      text += `Measurements taken at ${room.points.length} points:\n`;
      for (const point of room.points) {
        const value = point.value ? `${point.value}"` : 'Pending';
        text += `  \u2022 ${point.name}: ${value}`;
        if (point.photos && point.photos.length > 0) {
          text += ` (${point.photos.length} photo${point.photos.length > 1 ? 's' : ''})`;
        }
        text += '\n';
      }
    }

    if (room.notes && room.notes.trim()) {
      text += `\nNotes: ${room.notes}`;
    }

    return text.trim();
  }

  private getAllRoomPhotos(room: any): any[] {
    const allPhotos: any[] = [];

    if (room.points) {
      for (const point of room.points) {
        if (point.photos && point.photos.length > 0) {
          for (const photo of point.photos) {
            allPhotos.push({
              ...photo,
              caption: photo.caption || `${point.name} - ${point.value ? point.value + '"' : 'N/A'}`
            });
          }
        }
      }
    }

    if (room.photos) {
      for (const photo of room.photos) {
        allPhotos.push({
          ...photo,
          caption: photo.caption || `${room.name} - Room Photo`
        });
      }
    }

    // FDF photos
    if (room.fdfPhotos) {
      for (const key of ['top', 'bottom', 'threshold']) {
        const url = room.fdfPhotos[`${key}Url`];
        if (url && typeof url === 'string' && url.startsWith('data:')) {
          allPhotos.push({
            url,
            caption: room.fdfPhotos[`${key}Caption`] || `FDF ${key}`
          });
        }
      }
    }

    return allPhotos;
  }

  private isSmallEnoughToBeUnbreakable(item: any): boolean {
    const photoCount = item.photos?.filter((p: any) => {
      const url = p?.displayUrl || p?.url || '';
      return typeof url === 'string' && url.startsWith('data:');
    })?.length || 0;
    // Only mark unbreakable if text is short and has <= 2 photos
    const textLength = (item.text?.length || 0) + (item.answers?.length || 0);
    return photoCount <= 2 && textLength < 500;
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
