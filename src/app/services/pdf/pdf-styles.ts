import type { StyleDictionary, CustomTableLayout } from 'pdfmake/interfaces';

export const COLORS = {
  primary: '#F15A27',
  charcoal: '#333333',
  darkGray: '#495057',
  mediumGray: '#888888',
  lightGray: '#dee2e6',
  backgroundGray: '#f8f9fa',
  white: '#ffffff',
  black: '#000000',
  commentHeader: '#F15A27',
  limitationHeader: '#FFC107',
  deficiencyHeader: '#DC3545',
};

export const PDF_STYLES: StyleDictionary = {
  title: { fontSize: 24, bold: true, color: COLORS.charcoal, alignment: 'center' },
  subtitle: { fontSize: 12, color: COLORS.charcoal, alignment: 'center' },
  sectionHeader: { fontSize: 16, bold: true, color: COLORS.charcoal, margin: [0, 10, 0, 6] },
  subSectionHeader: { fontSize: 13, bold: true, color: COLORS.white, margin: [4, 0, 0, 0] },
  label: { fontSize: 10, bold: true, color: COLORS.charcoal },
  value: { fontSize: 10, color: COLORS.darkGray },
  itemName: { fontSize: 11, bold: true, color: COLORS.charcoal },
  bodyText: { fontSize: 10, color: COLORS.darkGray, lineHeight: 1.3 },
  caption: { fontSize: 8, italics: true, color: COLORS.mediumGray, alignment: 'center' },
  pageHeader: { fontSize: 10, color: COLORS.mediumGray },
  pageFooter: { fontSize: 9, color: COLORS.mediumGray },
  answers: { fontSize: 10, color: COLORS.black },
};

export const TABLE_LAYOUTS: Record<string, CustomTableLayout> = {
  infoTable: {
    hLineWidth: (_i: number, _node: any) => 0.5,
    vLineWidth: () => 0,
    hLineColor: () => COLORS.lightGray,
    paddingLeft: () => 8,
    paddingRight: () => 8,
    paddingTop: () => 5,
    paddingBottom: () => 5,
  },
  noBorders: {
    hLineWidth: () => 0,
    vLineWidth: () => 0,
    paddingLeft: () => 4,
    paddingRight: () => 4,
    paddingTop: () => 2,
    paddingBottom: () => 2,
  },
};
