'use strict';

const PDFDocument = require('pdfkit');
const { drawCompanyHeader } = require('./company-header');
const { RepartoPersistenceError } = require('./reparto-confirmation-service');
const { assertDecodablePng } = require('../utils/png-image-validator');

function unavailable(code, message) {
  return new RepartoPersistenceError(message, { code, statusCode: 503 });
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new RepartoPersistenceError('La generacion del recibo fue cancelada', {
      code: 'REPARTO_RECEIPT_TIMEOUT', statusCode: 504,
    });
  }
}

function printable(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
}

function decimal(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw unavailable('REPARTO_RECEIPT_VALUATION_UNAVAILABLE', 'La valoracion del recibo no esta disponible');
  return number.toFixed(2);
}

function optionalNumber(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildFileName(confirmationId) {
  return `RECIBO_REPARTO_${String(confirmationId)}.pdf`;
}

function paymentDate(payment) {
  if (!payment?.fecha) return null;
  const { dia, mes, ano } = payment.fecha;
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
}


function decodeSignatureImage(signature) {
  if (!signature?.contentBase64) return null;
  const mimeType = String(signature.mimeType || '').toLowerCase();
  if (!['image/png', 'image/jpeg'].includes(mimeType)
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature.contentBase64)
      || signature.contentBase64.length > 5_600_000) {
    throw unavailable('REPARTO_RECEIPT_SIGNATURE_UNAVAILABLE', 'La firma del recibo no se puede representar');
  }
  const image = Buffer.from(signature.contentBase64, 'base64');
  if (!image.length || image.toString('base64') !== signature.contentBase64) {
    throw unavailable('REPARTO_RECEIPT_SIGNATURE_UNAVAILABLE', 'La firma del recibo no se puede representar');
  }
  try {
    if (mimeType === 'image/png') {
      assertDecodablePng(image);
    } else if (image.length < 4
        || image[0] !== 0xff || image[1] !== 0xd8
        || image[image.length - 2] !== 0xff || image[image.length - 1] !== 0xd9) {
      throw new Error('invalid JPEG');
    }
  } catch {
    throw unavailable('REPARTO_RECEIPT_SIGNATURE_UNAVAILABLE', 'La firma del recibo no se puede representar');
  }
  return image;
}

function isExplicitZeroPrepaid(receipt) {
  return receipt?.prepaidZeroWithoutLines === true
    && receipt?.status === 'ENTREGADO'
    && receipt?.cobro == null
    && receipt?.importeTotal === 0;
}
/**
 * Builds the complete, deterministic text model before touching PDFKit. This
 * makes the legally relevant presentation testable without parsing PDF xrefs.
 */
function buildReceiptPresentation(receipt) {
  if (!receipt || !Array.isArray(receipt.lineas)) {
    throw unavailable('REPARTO_RECEIPT_LINES_UNAVAILABLE', 'El recibo no contiene lineas confirmadas');
  }
  const zeroPrepaid = receipt.lineas.length === 0 && isExplicitZeroPrepaid(receipt);
  if (receipt.lineas.length === 0 && !zeroPrepaid) {
    throw unavailable('REPARTO_RECEIPT_LINES_UNAVAILABLE', 'El recibo no contiene lineas confirmadas');
  }
  const rows = receipt.lineas.map((line, index) => {
    if (line.precioUnitario == null) {
      throw unavailable('REPARTO_RECEIPT_VALUATION_UNAVAILABLE', 'La valoracion del recibo no esta disponible');
    }
    const delivered = Number(line.cantidadEntregada);
    const price = Number(line.precioUnitario);
    if (!Number.isFinite(delivered) || !Number.isFinite(price)) {
      throw unavailable('REPARTO_RECEIPT_VALUATION_UNAVAILABLE', 'La valoracion del recibo no esta disponible');
    }
    return Object.freeze({
      index: index + 1,
      lineId: printable(line.lineaId),
      article: printable(line.codigoArticulo),
      description: printable(line.descripcion) || '-',
      ordered: Number(line.cantidadPedida),
      delivered,
      rejected: Number(line.cantidadRechazada),
      pending: Number(line.cantidadPendiente),
      difference: delivered - Number(line.cantidadPedida),
      packages: optionalNumber(line.bultos),
      price,
      amount: delivered * price,
      reason: printable(line.motivoDiferencia) || '-',
      observations: printable(line.observaciones) || '-',
    });
  });
  if (zeroPrepaid) rows.push(Object.freeze({
    index: 1, lineId: '', article: '', description: 'Sin lineas ERP (prepago 0 EUR)',
    ordered: 0, delivered: 0, rejected: 0, pending: 0, price: 0, amount: 0,
    reason: '-', observations: '-',
  }));
  const amount = rows.reduce((sum, line) => sum + line.amount, 0);
  if (!Number.isFinite(amount)) {
    throw unavailable('REPARTO_RECEIPT_VALUATION_UNAVAILABLE', 'La valoracion del recibo no esta disponible');
  }
  const fiscalRows = Array.isArray(receipt.ivaBreakdown)
    ? receipt.ivaBreakdown.filter((item) => Number.isFinite(Number(item?.base))
      && Number.isFinite(Number(item?.pct)) && Number.isFinite(Number(item?.iva)))
      .map((item) => ({
        base: Number(item.base), pct: Number(item.pct), iva: Number(item.iva),
      }))
    : [];
  const ivaBreakdown = [...fiscalRows.reduce((grouped, item) => {
    const current = grouped.get(item.pct) || { base: 0, pct: item.pct, iva: 0 };
    current.base += item.base;
    current.iva += item.iva;
    grouped.set(item.pct, current);
    return grouped;
  }, new Map()).values()]
    .sort((left, right) => left.pct - right.pct)
    .map((item) => Object.freeze(item));
  const explicitNeto = optionalNumber(receipt.importeNeto);
  const explicitIva = optionalNumber(receipt.importeIva);
  const fiscalAvailable = ivaBreakdown.length > 0 || explicitIva != null;
  const neto = explicitNeto != null
    ? explicitNeto
    : (ivaBreakdown.length ? ivaBreakdown.reduce((sum, item) => sum + item.base, 0) : amount);
  const iva = explicitIva != null
    ? explicitIva
    : ivaBreakdown.reduce((sum, item) => sum + item.iva, 0);
  const totalConIva = fiscalAvailable
    ? neto + iva
    : amount;
  const documentNumber = receipt.documento?.numero ?? receipt.documentId;
  const documentType = String(receipt.documento?.tipo || '').toUpperCase().includes('FAC')
    ? 'FACTURA'
    : 'ALBARÁN';
  const dateSource = receipt.confirmedAt || receipt.occurredAt;
  const dateLabel = dateSource ? new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(dateSource)) : '-';
  const header = Object.freeze([
    'COMPROBANTE DE REPARTO',
    `Confirmacion: ${printable(receipt.confirmationId)}`,
    `Documento: ${printable(receipt.documentId)}`,
    `Cliente: ${printable(receipt.cliente?.codigo)} ${printable(receipt.cliente?.nombre)}`,
    `Pedido: ${printable(receipt.pedido?.ejercicio)}-${printable(receipt.pedido?.numero)}`,
    `Fecha/hora: ${printable(receipt.confirmedAt || receipt.occurredAt)}`,
    `Estado: ${printable(receipt.status)}`,
  ]);
  const footer = [
    `Total entregado valorado: ${decimal(amount)}`,
    `Receptor: ${printable(receipt.receptor?.nombre)} ${printable(receipt.receptor?.apellidos)}`,
    `DNI: ${printable(receipt.receptor?.dni)}`,
    `Incidencia: ${printable(receipt.incidencia?.codigo)} ${printable(receipt.incidencia?.descripcion)}`,
    `Observaciones incidencia: ${printable(receipt.incidencia?.observaciones) || '-'}`,
    `Observaciones: ${printable(receipt.observaciones)}`,
  ];
  if (receipt.cobro) {
    footer.push(`Cobro: ${decimal(receipt.cobro.importeCobrado)} ${printable(receipt.cobro.formaPago)} | fecha ${paymentDate(receipt.cobro)}`);
  } else {
    footer.push('Cobro: no registrado');
  }
  return Object.freeze({
    title: 'NOTA DE ENTREGA',
    confirmationReference: printable(receipt.confirmationId),
    documentReference: printable(receipt.documentId || documentNumber),
    header,
    rows: Object.freeze(rows),
    // Keep the old textual projection for callers/tests while exposing the
    // structured values required by the printable layout.
    lines: Object.freeze(zeroPrepaid
      ? ['Sin lineas ERP (prepago 0 EUR)']
      : rows.map((line) => [
        `${line.lineId} ${line.article} ${line.description}`.trim(),
        `pedida ${decimal(line.ordered)} | entregada ${decimal(line.delivered)} | rechazada ${decimal(line.rejected)} | pendiente ${decimal(line.pending)}`,
        `precio ${decimal(line.price)} | motivo ${line.reason}`,
        `observaciones ${line.observations}`,
      ].join('\n'))),
    footer: Object.freeze(footer),
    documentType,
    documentNumber: printable(documentNumber),
    dateLabel,
    clientCode: printable(receipt.cliente?.codigo),
    clientName: printable(receipt.cliente?.nombre),
    clientAddress: printable(receipt.cliente?.direccion),
    clientTown: printable(receipt.cliente?.poblacion),
    status: printable(receipt.status),
    neto,
    iva,
    ivaBreakdown: Object.freeze(ivaBreakdown),
    fiscalAvailable,
    totalConIva,
    total: amount,
  });
}
/**
 * Renders exclusively from the already-authorized persisted snapshot. It does
 * not query DB2, invoke network services, or infer a missing price as zero.
 */
function createRepartoReceiptPdfService() {
  async function render({ receipt, signature, signal } = {}) {
    throwIfAborted(signal);
    const presentation = buildReceiptPresentation(receipt);
    if (receipt.firmaEvidenceId && (!signature || !signature.contentBase64)) {
      throw unavailable('REPARTO_RECEIPT_SIGNATURE_UNAVAILABLE', 'La firma del recibo no esta disponible');
    }
    const signatureImage = decodeSignatureImage(signature);
    const document = new PDFDocument({ size: 'A4', margin: 36, compress: false, bufferPages: true });
    const chunks = [];
    const result = new Promise((resolve, reject) => {
      document.on('data', (chunk) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
    });
    const pageWidth = () => document.page.width
      - document.page.margins.left - document.page.margins.right;
    const pageBottom = () => document.page.height - document.page.margins.bottom - 28;
    const left = () => document.page.margins.left;
    const blue = '#12355B';
    const paleBlue = '#EAF2F8';
    const ink = '#1F2937';
    const muted = '#64748B';
    const drawDocumentMeta = () => {
      const x = left();
      const width = pageWidth();
      document.fillColor(blue).font('Helvetica-Bold').fontSize(18)
        .text(presentation.title, x, document.y, { width, align: 'center' });
      const metaY = document.y + 4;
      document.fillColor(ink).font('Helvetica-Bold').fontSize(9)
        .text(`Confirmación ${presentation.confirmationReference}`, x, metaY, { width: width * 0.34 })
        .text(`Documento ${presentation.documentReference || '-'}`, x + width * 0.34, metaY, { width: width * 0.32, align: 'center' });
      document.fillColor(muted).font('Helvetica').fontSize(8)
        .text(`Fecha ${presentation.dateLabel}`, x + width * 0.66, metaY, { width: width * 0.34, align: 'right' });
      document.y = metaY + 16;
      document.moveDown(0.55);
      document.save().fillColor(paleBlue).roundedRect(x, document.y, width, 58, 6).fill();
      document.restore();
      const y = document.y + 10;
      document.fillColor(blue).font('Helvetica-Bold').fontSize(9)
        .text('CLIENTE', x + 12, y, { width: 70 });
      document.fillColor(ink).font('Helvetica-Bold').fontSize(10)
        .text(`${presentation.clientCode}${presentation.clientName ? ` · ${presentation.clientName}` : ''}`, x + 82, y, { width: width - 94 });
      const address = [presentation.clientAddress, presentation.clientTown].filter(Boolean).join(' · ');
      if (address) {
        document.fillColor(muted).font('Helvetica').fontSize(8)
          .text(address, x + 82, y + 19, { width: width - 94 });
      }
      document.fillColor(muted).font('Helvetica').fontSize(8)
        .text(`Estado: ${presentation.status || '-'}`, x + 82, y + (address ? 34 : 19), { width: width - 94 });
      document.y += 70;
      document.fillColor(blue).font('Helvetica').fontSize(7)
        .text(`Referencia de confirmación: ${presentation.header[1].replace('Confirmacion: ', '')}`, x, document.y, { width });
      document.moveDown(0.65);
    };

    const columns = () => {
      const x = left();
      const width = pageWidth();
      return [
        { x, width: 211, label: 'Producto' },
        { x: x + 211, width: 54, label: 'Pedida' },
        { x: x + 265, width: 60, label: 'Entregada' },
        { x: x + 325, width: 65, label: 'Diferencia' },
        { x: x + 390, width: 55, label: 'Bultos' },
        { x: x + 445, width: width - 445, label: 'Importe' },
      ];
    };
    const drawTableHeader = () => {
      const cols = columns();
      const y = document.y;
      document.save().fillColor(blue).roundedRect(left(), y, pageWidth(), 24, 4).fill();
      document.restore();
      document.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
      for (const col of cols) document.text(col.label, col.x + 5, y + 8, { width: col.width - 10, align: col.label === 'Producto' ? 'left' : 'right' });
      document.y = y + 31;
      return cols;
    };
    const drawContinuationHeader = () => {
      document.fillColor(blue).font('Helvetica-Bold').fontSize(14)
        .text(presentation.title, { width: pageWidth(), align: 'center' });
      document.fillColor(muted).font('Helvetica').fontSize(8)
        .text(`Confirmación ${presentation.confirmationReference} · Documento ${presentation.documentReference || '-'} · continuación`, { width: pageWidth(), align: 'center' });
      document.moveDown(0.45);
      drawTableHeader();
    };
    const addContinuationPage = () => {
      document.addPage();
      document.y = drawCompanyHeader(document);
      drawContinuationHeader();
    };
    const ensureSpace = (height, reserved = 0) => {
      if (document.y + height + reserved > pageBottom()) addContinuationPage();
    };
    const textChunk = (value, width, maxHeight) => {
      const source = String(value || '');
      const options = { width, lineGap: 1 };
      if (document.heightOfString(source, options) <= maxHeight) return [source, ''];
      let low = 1;
      let high = source.length;
      let best = 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (document.heightOfString(source.slice(0, middle), options) <= maxHeight) {
          best = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      const whitespace = source.lastIndexOf(' ', best);
      const cut = whitespace > Math.floor(best * 0.65) ? whitespace : best;
      return [source.slice(0, cut).trimEnd(), source.slice(cut).trimStart()];
    };
    const drawRows = () => {
      const cols = columns();
      for (const [index, line] of presentation.rows.entries()) {
        throwIfAborted(signal);
        const details = [
          `${line.article ? `${line.article} · ` : ''}${line.description}`,
          `Pedida: ${decimal(line.ordered)} · Pendiente: ${decimal(line.pending)} · Rechazada: ${decimal(line.rejected)}`,
          line.reason !== '-' ? `Motivo: ${line.reason}` : null,
          line.observations !== '-' ? `Observaciones: ${line.observations}` : null,
        ].filter(Boolean).join('\n');
        let remaining = details;
        let firstSegment = true;
        while (remaining) {
          document.font('Helvetica').fontSize(7.5);
          if (pageBottom() - document.y < 30) addContinuationPage();
          const available = pageBottom() - document.y;
          const [chunk, rest] = textChunk(remaining, cols[0].width - 10, Math.max(12, available - 10));
          const rowHeight = Math.max(28, document.heightOfString(chunk, { width: cols[0].width - 10, lineGap: 1 }) + 10);
          const y = document.y;
          if (index % 2 === 0) document.save().fillColor('#F8FAFC').rect(left(), y, pageWidth(), rowHeight).fill().restore();
          document.fillColor(ink).font('Helvetica').fontSize(7.5)
            .text(chunk, cols[0].x + 5, y + 5, { width: cols[0].width - 10, lineGap: 1 });
          if (firstSegment) {
            document.text(decimal(line.ordered), cols[1].x + 5, y + 5, { width: cols[1].width - 10, align: 'right' })
              .text(decimal(line.delivered), cols[2].x + 5, y + 5, { width: cols[2].width - 10, align: 'right' })
              .text(decimal(line.difference), cols[3].x + 5, y + 5, { width: cols[3].width - 10, align: 'right' })
              .text(line.packages == null ? '-' : decimal(line.packages), cols[4].x + 5, y + 5, { width: cols[4].width - 10, align: 'right' })
              .text(`${decimal(line.amount)} €`, cols[5].x + 5, y + 5, { width: cols[5].width - 10, align: 'right' });
          }
          document.save().strokeColor('#CBD5E1').lineWidth(0.5)
            .moveTo(left(), y + rowHeight).lineTo(left() + pageWidth(), y + rowHeight).stroke().restore();
          document.y = y + rowHeight;
          remaining = rest;
          firstSegment = false;
          if (remaining) addContinuationPage();
        }
      }
    };
    const drawTotalsAndAcknowledgement = () => {
      const x = left();
      const width = pageWidth();
      const taxLineCount = Math.max(1, presentation.ivaBreakdown.length);
      const totalsHeight = 57 + (taxLineCount * 16);
      ensureSpace(totalsHeight + 48);
      document.moveDown(0.25);
      document.save().fillColor('#F8FAFC').roundedRect(x, document.y, width, totalsHeight, 6).fill().restore();
      const y = document.y + 9;
      document.fillColor(muted).font('Helvetica').fontSize(8)
        .text('Importe neto entregado', x + 14, y, { width: width * 0.55 });
      document.fillColor(ink).font('Helvetica-Bold').fontSize(8)
        .text(`${decimal(presentation.neto)} €`, x + width * 0.55, y, { width: width * 0.4, align: 'right' });
      if (presentation.ivaBreakdown.length) {
        presentation.ivaBreakdown.forEach((item, index) => {
          const taxY = y + 17 + (index * 16);
          document.fillColor(muted).font('Helvetica').fontSize(8)
            .text(`Base IVA ${decimal(item.pct)} % · ${decimal(item.base)} €`, x + 14, taxY, { width: width * 0.7 });
          document.fillColor(ink).font('Helvetica-Bold').fontSize(8)
            .text(`${decimal(item.iva)} €`, x + width * 0.7, taxY, { width: width * 0.25, align: 'right' });
        });
      } else {
        document.fillColor(muted).font('Helvetica').fontSize(8)
          .text('IVA no disponible en el snapshot persistido', x + 14, y + 17, { width: width * 0.7 });
        document.fillColor(ink).font('Helvetica-Bold').fontSize(8)
          .text('-', x + width * 0.7, y + 17, { width: width * 0.25, align: 'right' });
      }
      const totalY = y + 22 + (taxLineCount * 16);
      document.save().strokeColor('#94A3B8').lineWidth(0.7).moveTo(x + 14, totalY - 5).lineTo(x + width - 14, totalY - 5).stroke().restore();
      document.fillColor(blue).font('Helvetica-Bold').fontSize(11)
        .text('TOTAL ENTREGA', x + 14, totalY, { width: width * 0.55 });
      document.text(`${decimal(presentation.totalConIva)} €`, x + width * 0.55, totalY, { width: width * 0.4, align: 'right' });
      document.y += totalsHeight + 7;
      document.x = x;

      document.fillColor(ink).font('Helvetica-Bold').fontSize(8).text('COBRO Y RECEPCIÓN', { width });
      document.moveDown(0.12);
      document.fillColor(muted).font('Helvetica').fontSize(7.5)
        .text(receipt.cobro
          ? `Cobrado: ${decimal(receipt.cobro.importeCobrado)} € · Forma de pago: ${printable(receipt.cobro.formaPago)} · Fecha: ${paymentDate(receipt.cobro)}`
          : 'Cobro: no registrado en esta entrega', { width });
      document.moveDown(0.22);
      const finalTexts = [
        receipt.incidencia?.codigo || receipt.incidencia?.descripcion
          ? { color: '#9A3412', text: `Incidencia: ${printable(receipt.incidencia?.codigo)} ${printable(receipt.incidencia?.descripcion)}` }
          : null,
        receipt.incidencia?.observaciones
          ? { color: muted, text: `Observaciones incidencia: ${printable(receipt.incidencia.observaciones)}` }
          : null,
        receipt.observaciones
          ? { color: muted, text: `Observaciones: ${printable(receipt.observaciones)}` }
          : null,
      ].filter(Boolean);
      for (const item of finalTexts) {
        let remaining = item.text;
        while (remaining) {
          document.font('Helvetica').fontSize(7.5);
          if (pageBottom() - document.y < 18) addContinuationPage();
          const [chunk, rest] = textChunk(remaining, width, Math.max(10, pageBottom() - document.y - 4));
          document.fillColor(item.color).text(chunk, { width, lineGap: 1 });
          remaining = rest;
          if (remaining) addContinuationPage();
        }
      }
      const receptorText = `Receptor: ${printable(receipt.receptor?.nombre)} ${printable(receipt.receptor?.apellidos)} · DNI: ${printable(receipt.receptor?.dni)}`;
      document.font('Helvetica').fontSize(7.5);
      const signatureHeight = (signatureImage ? 64 : 44)
        + document.heightOfString(receptorText, { width }) + 24;
      ensureSpace(signatureHeight);
      document.fillColor(ink).font('Helvetica-Bold').fontSize(8)
        .text('Firma del cliente', { width });
      document.moveDown(0.08);
      if (signatureImage) {
        try {
          const signatureTop = document.y;
          document.image(signatureImage, x, signatureTop, { fit: [220, 60] });
          document.y = signatureTop + 64;
        } catch {
          throw unavailable('REPARTO_RECEIPT_SIGNATURE_UNAVAILABLE', 'La firma del recibo no se puede representar');
        }
      } else {
        document.strokeColor('#94A3B8').lineWidth(0.5).moveTo(x, document.y + 38).lineTo(x + 220, document.y + 38).stroke();
        document.y += 44;
      }
      document.fillColor(muted).font('Helvetica').fontSize(7.5)
        .text(receptorText, { width });
      document.moveDown(0.25);
      const legalText = 'La posesión de este documento NO implica el pago de la misma. No se admiten devoluciones una vez aceptada la recepción.';
      document.font('Helvetica').fontSize(6.5);
      ensureSpace(document.heightOfString(legalText, { width, lineGap: 1 }) + 4);
      document.fillColor(muted).font('Helvetica').fontSize(6.5)
        .text(legalText, { width, lineGap: 1 });
      document.moveDown(0.18);
    };

    document.y = drawCompanyHeader(document);
    drawDocumentMeta();
    drawTableHeader();
    drawRows();
    drawTotalsAndAcknowledgement();
    throwIfAborted(signal);
    const pageRange = document.bufferedPageRange();
    for (let index = 0; index < pageRange.count; index += 1) {
      document.switchToPage(pageRange.start + index);
      const footerY = document.page.height - document.page.margins.bottom - 12;
      document.save().strokeColor('#CBD5E1').lineWidth(0.5)
        .moveTo(left(), footerY - 5).lineTo(left() + pageWidth(), footerY - 5).stroke().restore();
      document.fillColor('#64748B').font('Helvetica').fontSize(6.5)
        .text(`GMP · nota de entrega desde la confirmación registrada · Página ${index + 1} de ${pageRange.count}`,
          left(), footerY, { width: pageWidth(), align: 'right', lineBreak: false });
    }
    document.end();
    const pdf = await result;
    throwIfAborted(signal);
    return Object.freeze({ pdf, fileName: buildFileName(receipt.confirmationId) });
  }
  return Object.freeze({ render });
}
module.exports = { buildFileName, buildReceiptPresentation, createRepartoReceiptPdfService };
