'use strict';

const {
  formatErpDocumentLabel,
  formatErpDocumentLabelFromHeader,
} = require('../utils/erp-document-label');

describe('erp document label', () => {
  test('keeps the terminal segment (P-15-2296, not P-2296)', () => {
    expect(formatErpDocumentLabel({ serie: 'P', terminal: 15, numero: 2296 })).toBe('P-15-2296');
  });

  test('reads header aliases including TERMINALALBARAN', () => {
    expect(formatErpDocumentLabelFromHeader({
      serie: 'P',
      TERMINALALBARAN: 15,
      numero: 2296,
    })).toBe('P-15-2296');
  });

  test('does not invent a terminal when missing', () => {
    expect(formatErpDocumentLabel({ serie: 'A', numero: 12 })).toBe('A-12');
  });
});
