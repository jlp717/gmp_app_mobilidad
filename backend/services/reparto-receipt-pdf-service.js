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
  } catch (_) {
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
  const lines = receipt.lineas.map((line) => {
    if (line.precioUnitario == null) throw unavailable('REPARTO_RECEIPT_VALUATION_UNAVAILABLE', 'La valoracion del recibo no esta disponible');
    const delivered = Number(line.cantidadEntregada);
    const price = Number(line.precioUnitario);
    if (!Number.isFinite(delivered) || !Number.isFinite(price)) {
      throw unavailable('REPARTO_RECEIPT_VALUATION_UNAVAILABLE', 'La valoracion del recibo no esta disponible');
    }
    return Object.freeze([
      `${printable(line.lineaId)} ${printable(line.codigoArticulo)} ${printable(line.descripcion)}`,
      `pedida ${decimal(line.cantidadPedida)} | entregada ${decimal(line.cantidadEntregada)} | rechazada ${decimal(line.cantidadRechazada)} | pendiente ${decimal(line.cantidadPendiente)}`,
      `precio ${decimal(line.precioUnitario)} | motivo ${printable(line.motivoDiferencia) || '-'}`,
      `observaciones ${printable(line.observaciones) || '-'}`,
    ].join('\n'));
  });
  if (zeroPrepaid) lines.push('Sin lineas ERP (prepago 0 EUR)');
  const amount = zeroPrepaid ? 0 : receipt.lineas.reduce(
    (sum, line) => sum + (Number(line.cantidadEntregada) * Number(line.precioUnitario)), 0,
  );
  if (!Number.isFinite(amount)) throw unavailable('REPARTO_RECEIPT_VALUATION_UNAVAILABLE', 'La valoracion del recibo no esta disponible');
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
  if (receipt.cobro) footer.push(`Cobro: ${decimal(receipt.cobro.importeCobrado)} ${printable(receipt.cobro.formaPago)} | fecha ${paymentDate(receipt.cobro)}`);
  else footer.push('Cobro: no registrado');
  return Object.freeze({ header, lines: Object.freeze(lines), footer: Object.freeze(footer), total: amount });
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
    const document = new PDFDocument({ size: 'A4', margin: 42, compress: false });
    const chunks = [];
    const result = new Promise((resolve, reject) => {
      document.on('data', (chunk) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
    });
    const pageWidth = () => document.page.width
      - document.page.margins.left - document.page.margins.right;
    const pageBottom = () => document.page.height - document.page.margins.bottom;
    const pageLeft = () => document.page.margins.left;
    const drawHeader = ({ continuation = false } = {}) => {
      document
        .font('Helvetica-Bold')
        .fontSize(15)
        .fillColor('#12355B')
        .text(
          continuation
            ? 'COMPROBANTE DE REPARTO - CONTINUACION'
            : presentation.header[0],
          { width: pageWidth() },
        );
      document
        .moveDown(0.15)
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#25364A')
        .text(presentation.header.slice(1).join('\n'), {
          width: pageWidth(),
          lineGap: 1,
        });
      document
        .moveDown(0.35)
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#12355B')
        .text('LINEAS CONFIRMADAS', { width: pageWidth() });
      document.moveDown(0.2).fillColor('#111827');
    };
    const addPageWithHeader = () => {
      document.addPage();
      drawHeader({ continuation: true });
    };
    const ensureSpace = (height) => {
      if (document.y + height > pageBottom()) addPageWithHeader();
    };

    drawHeader();
    document.font('Helvetica').fontSize(8);
    const footerDetails = presentation.footer.slice(1).join('\n');
    const footerTextHeight = document.heightOfString(footerDetails, {
      width: pageWidth(), lineGap: 1,
    });
    // Footer, recipient, and signature are one acknowledgement block. Reserve
    // it while writing rows so they remain together on the final page.
    const finalBlockHeight = footerTextHeight + (signatureImage ? 122 : 34) + 30;

    for (const line of presentation.lines) {
      throwIfAborted(signal);
      const lineHeight = document.heightOfString(line, {
        width: pageWidth(), lineGap: 1,
      }) + 8;
      ensureSpace(lineHeight + finalBlockHeight);
      document.font('Helvetica').fontSize(8).fillColor('#111827').text(line, {
        width: pageWidth(), lineGap: 1,
      });
      document.moveDown(0.25);
    }

    ensureSpace(finalBlockHeight);
    document.moveDown(0.25).font('Helvetica-Bold').fontSize(10).fillColor('#12355B')
      .text(presentation.footer[0], { width: pageWidth() });
    document.moveDown(0.25).font('Helvetica').fontSize(8).fillColor('#111827')
      .text(footerDetails, { width: pageWidth(), lineGap: 1 });
    if (signatureImage) {
      try {
        document.moveDown(0.4).font('Helvetica-Bold').fontSize(8)
          .text('Firma registrada', { width: pageWidth() });
        const signatureTop = document.y + 3;
        document.image(signatureImage, pageLeft(), signatureTop, { fit: [220, 86] });
        document.y = signatureTop + 90;
      } catch (_) {
        throw unavailable('REPARTO_RECEIPT_SIGNATURE_UNAVAILABLE', 'La firma del recibo no se puede representar');
      }
    } else {
      document.moveDown(0.35).font('Helvetica').fontSize(8)
        .text('Firma: no requerida para este estado', { width: pageWidth() });
    }
    document
      .moveDown(0.3)
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#64748B')
      .text('GMP · comprobante generado desde la confirmacion registrada', {
        width: pageWidth(), align: 'right',
      });
    throwIfAborted(signal);
    document.end();
    const pdf = await result;
    throwIfAborted(signal);
    return Object.freeze({ pdf, fileName: buildFileName(receipt.confirmationId) });
  }
  return Object.freeze({ render });
}

module.exports = { buildFileName, buildReceiptPresentation, createRepartoReceiptPdfService };
