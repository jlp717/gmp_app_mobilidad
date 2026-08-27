'use strict';

const PDFDocument = require('pdfkit');
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
  const ivaBreakdown = Array.isArray(receipt.ivaBreakdown)
    ? receipt.ivaBreakdown.filter((item) => Number.isFinite(Number(item?.base))
      && Number.isFinite(Number(item?.pct)) && Number.isFinite(Number(item?.iva)))
      .map((item) => Object.freeze({
        base: Number(item.base), pct: Number(item.pct), iva: Number(item.iva),
      }))
    : [];
  const neto = Number.isFinite(Number(receipt.importeNeto))
    ? Number(receipt.importeNeto)
    : amount;
  const iva = Number.isFinite(Number(receipt.importeIva))
    ? Number(receipt.importeIva)
    : ivaBreakdown.reduce((sum, item) => sum + item.iva, 0);
  const totalConIva = ivaBreakdown.length || receipt.importeIva != null
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
    const document = new PDFDocument({ size: 'A4', margin: 36, compress: false });
    const chunks = [];
    const result = new Promise((resolve, reject) => {
      document.on('data', (chunk) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
    });
    const pageWidth = () => document.page.width
      - document.page.margins.left - document.page.margins.right;
    const pageBottom = () => document.page.height - document.page.margins.bottom;
    const left = () => document.page.margins.left;
    const blue = '#12355B';
    const paleBlue = '#EAF2F8';
    const ink = '#1F2937';
    const muted = '#64748B';
    let pageNumber = 1;
    document.on('pageAdded', () => { pageNumber += 1; });

    const drawCompanyHeader = () => {
      const x = left();
      const width = pageWidth();
      const y = document.y;
      document.save().fillColor(blue).roundedRect(x, y, width, 66, 8).fill();
      document.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(15)
        .text('GRANJA MARI PEPA S.L.', x + 16, y + 12, { width: width - 32 });
      document.font('Helvetica').fontSize(8)
        .text('Pol. Ind. Saprelorca - Parcela D3 · 30817 Lorca (Murcia)', x + 16, y + 31, { width: width - 32 });
      document.text('CIF: B04008710 · Tel: 968 47 08 80', x + 16, y + 44, { width: width - 32 });
      document.restore();
      document.y = y + 78;
    };

    const drawDocumentMeta = () => {
      const x = left();
      const width = pageWidth();
      document.fillColor(blue).font('Helvetica-Bold').fontSize(18)
        .text(`${presentation.documentType}: ${presentation.documentNumber}`, x, document.y, { width: width * 0.58 });
      document.fillColor(muted).font('Helvetica').fontSize(9)
        .text(`Fecha de entrega: ${presentation.dateLabel}`, x + width * 0.58, document.y + 5, {
          width: width * 0.42, align: 'right',
        });
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
        { x, width: 30, label: 'Ptda.' },
        { x: x + 30, width: 78, label: 'Artículo' },
        { x: x + 108, width: width - 108 - 112 - 70 - 72, label: 'Descripción' },
        { x: x + width - 246, width: 64, label: 'Entreg.' },
        { x: x + width - 182, width: 70, label: 'P. unit.' },
        { x: x + width - 112, width: 112, label: 'Importe neto' },
      ];
    };
    const drawTableHeader = () => {
      const cols = columns();
      const y = document.y;
      document.save().fillColor(blue).roundedRect(left(), y, pageWidth(), 24, 4).fill();
      document.restore();
      document.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
      for (const col of cols) document.text(col.label, col.x + 5, y + 8, { width: col.width - 10, align: col.label === 'Descripción' || col.label === 'Artículo' ? 'left' : 'right' });
      document.y = y + 31;
      return cols;
    };
    const drawContinuationHeader = () => {
      document.fillColor(blue).font('Helvetica-Bold').fontSize(11)
        .text(`${presentation.documentType}: ${presentation.documentNumber} · continuación`, { width: pageWidth() });
      document.moveDown(0.45);
      drawTableHeader();
    };
    const addContinuationPage = () => {
      document.addPage();
      document.y = document.page.margins.top;
      drawContinuationHeader();
    };
    const ensureSpace = (height, reserved = 0) => {
      if (document.y + height + reserved > pageBottom()) addContinuationPage();
    };
    const drawRows = () => {
      const cols = columns();
      for (const [index, line] of presentation.rows.entries()) {
        throwIfAborted(signal);
        document.font('Helvetica').fontSize(8);
        const detailLines = [
          `Pedida: ${decimal(line.ordered)} · Pendiente: ${decimal(line.pending)}`,
          `Rechazada: ${decimal(line.rejected)}`,
          line.reason !== '-' ? `Motivo: ${line.reason}` : null,
          line.observations !== '-' ? `Observaciones: ${line.observations}` : null,
        ].filter((value) => value != null);
        const desc = [line.description, ...detailLines].join('\n');
        const descHeight = document.heightOfString(desc, { width: cols[2].width - 10, lineGap: 1 });
        const rowHeight = Math.max(30, descHeight + 12);
        ensureSpace(rowHeight, 280);
        const y = document.y;
        if (index % 2 === 0) {
          document.save().fillColor('#F8FAFC').rect(left(), y - 3, pageWidth(), rowHeight).fill().restore();
        }
        document.fillColor(ink).font('Helvetica').fontSize(8)
          .text(String(line.index), cols[0].x + 5, y + 5, { width: cols[0].width - 10, align: 'right' })
          .text(line.article || '-', cols[1].x + 5, y + 5, { width: cols[1].width - 10 })
          .text(desc, cols[2].x + 5, y + 5, { width: cols[2].width - 10, lineGap: 1 })
          .text(decimal(line.delivered), cols[3].x + 5, y + 5, { width: cols[3].width - 10, align: 'right' })
          .text(`${decimal(line.price)} €`, cols[4].x + 5, y + 5, { width: cols[4].width - 10, align: 'right' })
          .text(`${decimal(line.amount)} €`, cols[5].x + 5, y + 5, { width: cols[5].width - 10, align: 'right' });
        document.save().strokeColor('#CBD5E1').lineWidth(0.5)
          .moveTo(left(), y + rowHeight - 3).lineTo(left() + pageWidth(), y + rowHeight - 3).stroke().restore();
        document.y = y + rowHeight;
      }
    };
    const drawTotalsAndAcknowledgement = () => {
      ensureSpace(330);
      const x = left();
      const width = pageWidth();
      document.moveDown(0.25);
      const totalsHeight = 78;
      document.save().fillColor('#F8FAFC').roundedRect(x, document.y, width, totalsHeight, 6).fill().restore();
      const y = document.y + 9;
      document.fillColor(muted).font('Helvetica').fontSize(8)
        .text('Bultos / unidades entregadas', x + 14, y, { width: width * 0.55 });
      document.fillColor(ink).font('Helvetica-Bold').fontSize(8)
        .text(`${presentation.rows.reduce((sum, line) => sum + line.delivered, 0).toFixed(2)}`, x + width * 0.55, y, { width: width * 0.4, align: 'right' });
      document.fillColor(muted).font('Helvetica').fontSize(8)
        .text('Importe neto entregado', x + 14, y + 17, { width: width * 0.55 });
      document.fillColor(ink).font('Helvetica-Bold').fontSize(8)
        .text(`${decimal(presentation.neto)} €`, x + width * 0.55, y + 17, { width: width * 0.4, align: 'right' });
      if (presentation.ivaBreakdown.length) {
        document.fillColor(muted).font('Helvetica').fontSize(8)
          .text(`IVA (${presentation.ivaBreakdown.map((item) => `${item.pct}%`).join(', ')})`, x + 14, y + 34, { width: width * 0.55 });
        document.fillColor(ink).font('Helvetica-Bold').fontSize(8)
          .text(`${decimal(presentation.iva)} €`, x + width * 0.55, y + 34, { width: width * 0.4, align: 'right' });
      }
      const totalY = y + (presentation.ivaBreakdown.length ? 51 : 34);
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
        .text(`Receptor: ${printable(receipt.receptor?.nombre)} ${printable(receipt.receptor?.apellidos)} · DNI: ${printable(receipt.receptor?.dni)}`, { width });
      if (receipt.incidencia?.codigo || receipt.incidencia?.descripcion) {
        document.fillColor('#9A3412').font('Helvetica-Bold').fontSize(7.5)
          .text(`Incidencia: ${printable(receipt.incidencia?.codigo)} ${printable(receipt.incidencia?.descripcion)}`, { width });
      }
      if (receipt.incidencia?.observaciones) {
        document.fillColor(muted).font('Helvetica').fontSize(7.5)
          .text(`Observaciones incidencia: ${printable(receipt.incidencia?.observaciones)}`, { width });
      }
      if (receipt.observaciones) {
        document.fillColor(muted).font('Helvetica').fontSize(7.5)
          .text(`Observaciones: ${printable(receipt.observaciones)}`, { width });
      }
      document.moveDown(0.25);
      document.fillColor(muted).font('Helvetica').fontSize(6.5)
        .text('La posesión de este documento NO implica el pago de la misma. No se admiten devoluciones una vez aceptada la recepción.', { width, lineGap: 1 });
      document.moveDown(0.18);
      const footerY = document.y;
      document.fillColor('#94A3B8').font('Helvetica').fontSize(6.5)
        .text(`GMP · nota de entrega generada desde la confirmación registrada · página ${pageNumber}`, x, footerY, { width, align: 'right' });
    };

    document.y = document.page.margins.top;
    drawCompanyHeader();
    drawDocumentMeta();
    drawTableHeader();
    drawRows();
    drawTotalsAndAcknowledgement();
    throwIfAborted(signal);
    document.end();
    const pdf = await result;
    throwIfAborted(signal);
    return Object.freeze({ pdf, fileName: buildFileName(receipt.confirmationId) });
  }
  return Object.freeze({ render });
}
module.exports = { buildFileName, buildReceiptPresentation, createRepartoReceiptPdfService };
