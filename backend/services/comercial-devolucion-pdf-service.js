'use strict';

const PDFDocument = require('pdfkit');
const { drawCompanyHeader } = require('./company-header');

const NAVY = '#003d7a';
const RED = '#c2410c';
const SLATE = '#334155';
const MUTED = '#64748b';

function money(value) {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

function formatEuro(raw) {
  const amount = money(raw);
  const formatted = new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${formatted} EUR`;
}

function formatDiasFactura(dias) {
  const parsed = Number.parseInt(dias, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return `${parsed} D F.Factura`;
}

function devolucionPdfFileName(doc = {}) {
  const explicit = String(doc.documento || '').trim();
  const date = String(doc.date || doc.fecha || 'sin-fecha').trim();
  if (explicit) return `DEVOLUCION_${explicit}_${date}.pdf`;
  const serie = String(doc.serie || 'D').trim() || 'D';
  const numero = String(doc.numero == null ? '' : doc.numero).trim() || '0';
  return `DEVOLUCION_${serie}-${numero}_${date}.pdf`;
}

function buildReturnPdfPath({ vendedor, fecha, serie, numero } = {}) {
  const vendor = String(vendedor || '').trim();
  const date = String(fecha || '').trim();
  const serieCode = String(serie || '').trim();
  const numeroCode = String(numero == null ? '' : numero).trim();
  if (!vendor || !date || !serieCode || !numeroCode) return null;
  const query = new URLSearchParams({
    vendedor: vendor,
    fecha: date,
    serie: serieCode,
    numero: numeroCode,
  });
  return `/comercial-liquidacion/devoluciones/pdf?${query.toString()}`;
}

function buildDevolucionPdfPresentation(input = {}) {
  const diasLabel = formatDiasFactura(input.formaPagoDias);
  const importe = money(input.amount ?? input.importe);
  return {
    title: 'Documento de Devolucion',
    cliente: String(input.cliente || '').trim() || '—',
    factura: String(input.factura || input.documentoOrigen || '').trim() || '—',
    albaran: String(input.albaran || input.albaranOrigen || '').trim() || '—',
    documento: String(input.documento || '').trim() || '—',
    formaPago: String(input.formaPago || 'PG').trim() || 'PG',
    fecha: String(input.date || input.fecha || '').trim() || '—',
    vencimiento: String(input.vencimiento || '').trim() || '—',
    importeAbs: Math.abs(importe),
    importeLabel: formatEuro(Math.abs(importe)),
    signo: '(-)',
    diasLabel,
    impactoLqd: String(input.impactoLqd || 'YA_COBRADOS').trim() || 'YA_COBRADOS',
    impactoLabel: 'LIQ.Vd ya cobrados',
    pendienteTecnico: input.pendienteTecnicoMovimiento !== false,
    vendedor: String(input.vendedor || '').trim() || '—',
  };
}

function buildDevolucionPdfBuffer(input = {}) {
  const view = buildDevolucionPdfPresentation(input);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawCompanyHeader(doc, { title: view.title });
    doc.moveDown(0.6);
    doc.fillColor(NAVY).fontSize(16).text(view.title);
    doc.moveDown(0.4);
    doc.fillColor(SLATE).fontSize(11);
    doc.text(`Cliente: ${view.cliente}`);
    doc.text(`Factura PG: ${view.factura}`);
    doc.text(`Albaran: ${view.albaran}`);
    doc.text(`Documento: ${view.documento}`);
    doc.text(`Vendedor: ${view.vendedor}`);
    doc.text(`Fecha: ${view.fecha}`);
    doc.text(`Vencimiento: ${view.vencimiento}`);
    doc.text(`Forma de pago: ${view.formaPago}`);
    if (view.diasLabel) doc.text(`F.Pago Pte: ${view.diasLabel}`);
    doc.fillColor(RED).text(`Importe ${view.signo}: ${view.importeLabel}`);
    doc.fillColor(SLATE).text(`Impacto: ${view.impactoLabel}`);
    if (view.pendienteTecnico) doc.fillColor(MUTED).text('Pde. Tech. Mov.');
    doc.end();
  });
}

module.exports = {
  formatDiasFactura,
  devolucionPdfFileName,
  buildReturnPdfPath,
  buildDevolucionPdfPresentation,
  buildDevolucionPdfBuffer,
};
