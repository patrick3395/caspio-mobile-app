import type { StyleDictionary, CustomTableLayout } from 'pdfmake/interfaces';

export const COLORS = {
  primary: '#F15A27',
  primaryLight: '#FEF0EB',
  charcoal: '#2d3436',
  darkGray: '#495057',
  mediumGray: '#888888',
  lightGray: '#e9ecef',
  borderGray: '#dee2e6',
  backgroundGray: '#f8f9fa',
  white: '#ffffff',
  black: '#000000',
  commentHeader: '#F15A27',
  limitationHeader: '#FFC107',
  deficiencyHeader: '#DC3545',
  labelBg: '#f1f3f5',
};

export const PDF_STYLES: StyleDictionary = {
  title: { fontSize: 22, bold: true, color: COLORS.charcoal, alignment: 'center' },
  subtitle: { fontSize: 11, color: COLORS.darkGray, alignment: 'center' },
  sectionHeader: { fontSize: 15, bold: true, color: COLORS.charcoal, margin: [0, 10, 0, 6] },
  subSectionHeader: { fontSize: 13, bold: true, color: COLORS.white, margin: [4, 0, 0, 0] },
  label: { fontSize: 9.5, bold: true, color: COLORS.charcoal },
  value: { fontSize: 9.5, color: COLORS.darkGray },
  itemName: { fontSize: 11, bold: true, color: COLORS.charcoal },
  bodyText: { fontSize: 10, color: COLORS.darkGray, lineHeight: 1.4 },
  caption: { fontSize: 8, color: COLORS.black, alignment: 'center' },
  pageHeader: { fontSize: 9, color: COLORS.mediumGray },
  pageFooter: { fontSize: 8, color: COLORS.mediumGray },
  answers: { fontSize: 10, color: COLORS.black },
};

/** Clean table with no outer borders, subtle inner dividers, zebra striping */
export const LAYOUT_INFO_TABLE: CustomTableLayout = {
  hLineWidth: (i: number, node: any) => {
    if (i === 0) return 0;
    if (i === node.table.body.length) return 0;
    return 0.5;
  },
  vLineWidth: () => 0,
  hLineColor: () => COLORS.borderGray,
  fillColor: (rowIndex: number) => (rowIndex > 0 && rowIndex % 2 === 0) ? COLORS.backgroundGray : null,
  paddingLeft: () => 10,
  paddingRight: () => 10,
  paddingTop: () => 7,
  paddingBottom: () => 7,
};

/** Completely borderless layout with compact padding */
export const LAYOUT_NO_BORDERS: CustomTableLayout = {
  hLineWidth: () => 0,
  vLineWidth: () => 0,
  paddingLeft: () => 0,
  paddingRight: () => 0,
  paddingTop: () => 0,
  paddingBottom: () => 0,
};

/** Header-row table: colored header, clean body rows */
export const LAYOUT_SUMMARY_TABLE: CustomTableLayout = {
  hLineWidth: (i: number, node: any) => {
    if (i === 0) return 0;
    if (i === 1) return 1.5;   // thick line under header
    if (i === node.table.body.length) return 1;
    return 0.5;
  },
  vLineWidth: () => 0,
  hLineColor: (i: number) => i === 1 ? COLORS.primary : COLORS.borderGray,
  fillColor: (rowIndex: number, _node: any, columnIndex: number) => {
    if (rowIndex === 0) return '#4a4f52';
    return (rowIndex % 2 === 0) ? COLORS.backgroundGray : null;
  },
  paddingLeft: () => 10,
  paddingRight: () => 10,
  paddingTop: () => 8,
  paddingBottom: () => 8,
};

// Keep legacy export for template-pdf.service.ts createPdf() 2nd arg (even though it doesn't work in 0.3.3)
export const TABLE_LAYOUTS: Record<string, CustomTableLayout> = {
  infoTable: LAYOUT_INFO_TABLE,
  noBorders: LAYOUT_NO_BORDERS,
  summaryTable: LAYOUT_SUMMARY_TABLE,
};
