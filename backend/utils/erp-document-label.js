'use strict';

/**
 * Visible ERP document id: serie-terminal-numero (e.g. P-15-2296).
 * Never drop the terminal segment.
 */
function formatErpDocumentLabel({ serie, terminal, numero } = {}) {
  const seriePart = String(serie ?? '').trim();
  const numeroPart = String(numero ?? '').trim();
  if (!seriePart || !numeroPart) return '';
  if (terminal === null || terminal === undefined || terminal === '') {
    return `${seriePart}-${numeroPart}`;
  }
  const terminalNumber = Number(terminal);
  if (!Number.isFinite(terminalNumber)) {
    const terminalPart = String(terminal).trim();
    return terminalPart ? `${seriePart}-${terminalPart}-${numeroPart}` : `${seriePart}-${numeroPart}`;
  }
  return `${seriePart}-${terminalNumber}-${numeroPart}`;
}

function formatErpDocumentLabelFromHeader(header = {}) {
  return formatErpDocumentLabel({
    serie: header.serie ?? header.SERIE ?? header.serieAlbaran ?? header.SERIEALBARAN
      ?? header.serieFactura ?? header.SERIEFACTURA,
    terminal: header.terminal ?? header.TERMINAL ?? header.terminalAlbaran ?? header.TERMINALALBARAN
      ?? header.terminalFactura ?? header.TERMINALFACTURA,
    numero: header.numero ?? header.NUMERO ?? header.numeroAlbaran ?? header.NUMEROALBARAN
      ?? header.numeroFactura ?? header.NUMEROFACTURA,
  });
}

module.exports = {
  formatErpDocumentLabel,
  formatErpDocumentLabelFromHeader,
};
