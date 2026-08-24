'use strict';

const PDFDocument = require('pdfkit');

const NAVY = '#003d7a';
const NAVY_DEEP = '#00264d';
const GREEN = '#067a58';
const SLATE = '#334155';
const MUTED = '#64748b';
const LINE = '#c5d4e8';
const CARD = '#eef6ff';
const CARD_GREEN = '#e7f8f1';
const WHITE = '#ffffff';

function text(value, fallback = '—') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number(value));
}

function safeFilePart(value) {
  return text(value, 'cobro')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 100) || 'cobro';
}

function buildCobroPdfFileName(payload = {}) {
  return 'RECIBO_COBRO_' + safeFilePart(payload.documento || payload.cobroId) + '.pdf';
}

function buildCobroPdfBuffer(payload = {}) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 42, compress: false });
    const chunks = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    const pageWidth = document.page.width;
    const contentWidth = pageWidth - document.page.margins.left - document.page.margins.right;
    const left = document.page.margins.left;

    document.rect(0, 0, pageWidth, 96).fill(NAVY);
    document.rect(0, 92, pageWidth, 4).fill(GREEN);
    document.fillColor(WHITE).font('Helvetica-Bold').fontSize(19)
      .text('JUSTIFICANTE DE COBRO', left, 24, { width: contentWidth });
    document.font('Helvetica').fontSize(10).fillColor('#d7ecff')
      .text('Granja Mari Pepa · GMP Mobilidad', left, 53, { width: contentWidth });
    document.fontSize(8).fillColor('#9ec5ea')
      .text('Documento generado desde el cobro registrado en reparto', left, 70, { width: contentWidth });

    let y = 122;
    document.roundedRect(left, y, contentWidth, 82, 8).fillAndStroke(CARD, LINE);
    document.fillColor(MUTED).font('Helvetica').fontSize(8).text('ID DE COBRO', left + 12, y + 12);
    document.fillColor(NAVY_DEEP).font('Helvetica-Bold').fontSize(11)
      .text(text(payload.cobroId), left + 105, y + 10, { width: contentWidth - 120 });
    document.fillColor(MUTED).font('Helvetica').fontSize(8).text('FECHA DE REGISTRO', left + 12, y + 34);
    document.fillColor(SLATE).fontSize(10)
      .text(text(payload.registradoAt), left + 105, y + 32, { width: contentWidth - 120 });
    document.fillColor(MUTED).fontSize(8).text('ORIGEN', left + 12, y + 56);
    document.fillColor(SLATE).fontSize(10)
      .text(text(payload.origen), left + 105, y + 54, { width: contentWidth - 120 });
    y += 104;

    document.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text('Datos del documento', left, y);
    y += 20;
    const rows = [
      ['Documento', payload.documento],
      ['Cliente', text(payload.codigoCliente) + ' · ' + text(payload.nombreCliente)],
      ['Repartidor', payload.repartidorId],
      ['Forma de pago', payload.formaPago],
    ];
    document.roundedRect(left, y, contentWidth, rows.length * 25 + 14, 6).fillAndStroke('#f8fafc', LINE);
    rows.forEach(([label, value], index) => {
      const rowY = y + 8 + index * 25;
      document.fillColor(MUTED).font('Helvetica').fontSize(8).text(label.toUpperCase(), left + 12, rowY + 2, { width: 100 });
      document.fillColor(SLATE).fontSize(10).text(text(value), left + 115, rowY, { width: contentWidth - 130, ellipsis: true });
    });
    y += rows.length * 25 + 38;

    document.fillColor(NAVY).font('Helvetica-Bold').fontSize(12).text('Importes', left, y);
    y += 20;
    document.roundedRect(left, y, contentWidth, 74, 8).fillAndStroke(CARD_GREEN, '#b7e3d0');
    document.fillColor(MUTED).font('Helvetica').fontSize(9).text('IMPORTE COBRADO', left + 14, y + 15);
    document.fillColor(GREEN).font('Helvetica-Bold').fontSize(19)
      .text(money(payload.importe) + ' €', left + 14, y + 32, { width: contentWidth - 28, align: 'right' });
    y += 92;
    document.roundedRect(left, y, contentWidth, 48, 6).fillAndStroke('#f8fafc', LINE);
    document.fillColor(MUTED).font('Helvetica').fontSize(9).text('PENDIENTE DESPUÉS DEL COBRO', left + 14, y + 17);
    document.fillColor(SLATE).font('Helvetica-Bold').fontSize(12)
      .text(money(payload.pendiente) + ' €', left + 14, y + 15, { width: contentWidth - 28, align: 'right' });
    y += 72;

    if (text(payload.notas, '') !== '') {
      document.fillColor(NAVY).font('Helvetica-Bold').fontSize(11).text('Observaciones', left, y);
      y += 16;
      document.fillColor(SLATE).font('Helvetica').fontSize(9)
        .text(text(payload.notas), left, y, { width: contentWidth });
      y += document.heightOfString(text(payload.notas), { width: contentWidth }) + 18;
    }

    document.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text('Este documento acredita el registro del cobro en el sistema de reparto.', left, Math.min(y, 730), {
        width: contentWidth,
        align: 'center',
      });
    document.end();
  });
}

module.exports = { buildCobroPdfBuffer, buildCobroPdfFileName };
