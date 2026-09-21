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

function commercialCobroReferenceCandidates(input = {}) {
  const serie = String(input.serieDocumento ?? input.serie ?? '').trim();
  const numero = String(input.numeroDocumento ?? input.numero ?? '').trim();
  const terminal = input.terminalDocumento ?? input.terminal;
  const labeled = formatErpDocumentLabel({ serie, terminal, numero });
  const legacy = serie && numero ? `${serie}-${numero}` : '';
  const full = [
    'CVC',
    input.tipoDocumento,
    input.origenDocumento,
    input.subempresaDocumento ?? input.subempresa,
    input.ejercicioDocumento,
    serie,
    terminal,
    numero,
    input.xdeDocumento ?? input.xde ?? 0,
    input.dexDocumento ?? input.dex ?? 0,
  ].map((part) => String(part ?? '').trim()).join(':');
  const hasFull = Boolean(
    input.tipoDocumento
    && (input.subempresaDocumento || input.subempresa)
    && input.ejercicioDocumento
    && serie
    && numero,
  );
  return [...new Set([
    hasFull ? full : '',
    labeled,
    legacy,
    legacy ? `CVC:${legacy}` : '',
    labeled && labeled !== legacy ? `CVC:${labeled}` : '',
  ].filter(Boolean))];
}

module.exports = {
  formatErpDocumentLabel,
  formatErpDocumentLabelFromHeader,
  commercialCobroReferenceCandidates,
};
