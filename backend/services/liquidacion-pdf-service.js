'use strict';

const PDFDocument = require('pdfkit');

const NAVY = '#003d7a';
const NAVY_DEEP = '#00264d';
const GREEN = '#00a878';
const GREEN_DARK = '#067a58';
const AMBER = '#f0b429';
const RED = '#c2410c';
const SLATE = '#334155';
const MUTED = '#64748b';
const LINE = '#c5d4e8';
const CARD_BG = '#eef6ff';
const CARD_GREEN = '#e7f8f1';
const CARD_AMBER = '#fff6e0';
const WHITE = '#ffffff';

function toNumber(raw) {
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function roundMoney(raw) {
  return Math.round((toNumber(raw) + Number.EPSILON) * 100) / 100;
}

function pad(raw, size) {
  return String(raw ?? '').trim().padStart(size, '0');
}

function formatEuro(raw) {
  const amount = roundMoney(raw);
  const formatted = new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${formatted} €`;
}

function formatGmpLiquidacionDisplay({
  year,
  vendorCode,
  serie = 'A',
  numero,
} = {}) {
  const y = Number(year);
  const safeYear = Number.isInteger(y) && y >= 2000 ? y : new Date().getFullYear();
  const serieLetter = String(serie || 'A').trim().toUpperCase().slice(0, 1) || 'A';
  const digits = String(vendorCode || '').replace(/\D/g, '');
  const vendor = digits ? digits.slice(-3) : '000';
  const n = Number(numero);
  const safeNumero = Number.isFinite(n) ? Math.trunc(Math.abs(n)) : 0;
  return `GMP ${safeYear} ${serieLetter} ${pad(vendor, 3)} ${pad(safeNumero, 6)}`;
}

function cashToDeposit({
  totalEfectivo = 0,
  totalCheques = 0,
  totalPostdatados = 0,
  saldoActual = 0,
  gastos = 0,
  ajustes = 0,
} = {}) {
  return roundMoney(
    toNumber(totalEfectivo)
      + toNumber(totalCheques)
      + toNumber(totalPostdatados)
      + toNumber(saldoActual)
      - toNumber(gastos)
      + toNumber(ajustes),
  );
}

function paymentTypeLabel(raw) {
  const value = String(raw || '').trim().toUpperCase();
  if (['EFECTIVO', 'EF', 'F0', 'E', 'CONTADO', 'CT'].includes(value)) return 'EFECTIVO';
  if (['TARJETA', 'TJ', 'TPV', 'T0'].includes(value)) return 'TARJETA';
  if (['TRANSFERENCIA', 'TR'].includes(value)) return 'TRANSFERENCIA';
  if (['BIZUM', 'BI'].includes(value)) return 'BIZUM';
  if (['CHEQUE', 'CH', 'TALON', 'TALON BANCARIO'].includes(value)) return 'CHEQUE';
  if (['POSTDATADO', 'PD', 'POSTDATADOS'].includes(value)) return 'POSTDATADO';
  return value || '—';
}

function paperDocumentLabel(cobro) {
  const explicit = String(cobro?.documento || '').trim();
  const tipo = String(cobro?.tipoDocumento || cobro?.tipoCobro || '').trim().toUpperCase();
  const letter = tipo.startsWith('F') ? 'F'
    : tipo.startsWith('P') ? 'P'
      : tipo.startsWith('E') || tipo === 'CAC' || tipo === 'ALB' ? 'E'
        : '';
  const terminal = Number(cobro?.terminalDocumento ?? cobro?.terminal);
  const numero = Number(cobro?.numeroDocumento ?? cobro?.numero);
  if (letter && Number.isFinite(numero) && numero > 0) {
    const term = Number.isFinite(terminal) ? terminal : 0;
    return `${letter} ${pad(term, 3)} ${pad(numero, 6)}`;
  }
  return explicit || '—';
}

function normalizeTotals(input = {}) {
  const totalEfectivo = roundMoney(input.totalEfectivo);
  const totalCheques = roundMoney(input.totalCheques);
  const totalTarjeta = roundMoney(input.totalTarjeta);
  const totalPostdatados = roundMoney(input.totalPostdatados);
  const saldoActual = roundMoney(input.saldoActual ?? input.saldoAnterior);
  const gastos = roundMoney(input.gastos);
  const ajustes = roundMoney(input.ajustes);
  const totalCobrosDia = roundMoney(
    input.totalCobrosDia
      ?? (totalEfectivo + totalCheques + totalTarjeta + totalPostdatados),
  );
  const totalAIngresar = roundMoney(
    input.totalAIngresar
      ?? cashToDeposit({
        totalEfectivo, totalCheques, totalPostdatados, saldoActual, gastos, ajustes,
      }),
  );
  const ingresoBanco = roundMoney(input.ingresoBanco);
  const diff = roundMoney(input.diff ?? (totalAIngresar - ingresoBanco));
  return {
    totalEfectivo,
    totalCheques,
    totalTarjeta,
    totalPostdatados,
    totalCobrosDia,
    saldoActual,
    gastos,
    ajustes,
    totalAIngresar,
    ingresoBanco,
    diff,
  };
}

function drawCard(doc, { x, y, width, height, fill, border, label, value, valueColor }) {
  doc.roundedRect(x, y, width, height, 8).fillAndStroke(fill, border);
  doc.fillColor(MUTED).font('Helvetica').fontSize(8)
    .text(label, x + 10, y + 9, { width: width * 0.52 });
  doc.fillColor(valueColor || NAVY).font('Helvetica-Bold').fontSize(10)
    .text(value, x + width * 0.48, y + 8, { width: width * 0.48 - 12, align: 'right' });
  doc.font('Helvetica');
}

function buildLiquidacionPdfBuffer({
  title,
  displayNumber,
  companyName = 'Granja Mari Pepa',
  repartidorId,
  repartidorName,
  usuarioLabel,
  dateLabel,
  generatedAt,
  totals,
  cobros = [],
} = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 72;
    const gmpNumber = displayNumber
      || String(title || '').replace(/^Liquidaci[oó]n Diaria\s*-?\s*/i, '').trim();
    const heading = gmpNumber
      ? `Liquidación Diaria - ${gmpNumber}`
      : (title || 'Liquidación Diaria');
    const summary = normalizeTotals(totals);
    const vendedor = [repartidorId, repartidorName].filter(Boolean).join(' ').trim();
    const usuario = usuarioLabel || vendedor;
    const generated = generatedAt || new Date().toISOString().replace('T', ' ').slice(0, 19);

    doc.rect(0, 0, pageWidth, 92).fill(NAVY);
    doc.rect(0, 88, pageWidth, 6).fill(GREEN);
    doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(18)
      .text(heading, 36, 22, { width: contentWidth });
    doc.font('Helvetica').fontSize(11).fillColor('#d7ecff')
      .text(companyName, 36, 48, { width: contentWidth });
    doc.fontSize(9).fillColor('#9ec5ea')
      .text(generated, 36, 66, { width: contentWidth });

    let y = 112;
    doc.roundedRect(36, y, contentWidth, 58, 8).fillAndStroke(CARD_BG, LINE);
    doc.fillColor(MUTED).fontSize(8).text('VENDEDOR', 48, y + 10);
    doc.fillColor(NAVY_DEEP).font('Helvetica-Bold').fontSize(12)
      .text(vendedor || '—', 48, y + 24, { width: contentWidth / 2 - 24 });
    doc.font('Helvetica').fillColor(MUTED).fontSize(8)
      .text('USUARIO', 36 + contentWidth / 2, y + 10);
    doc.fillColor(NAVY_DEEP).font('Helvetica-Bold').fontSize(12)
      .text(usuario || '—', 36 + contentWidth / 2, y + 24, { width: contentWidth / 2 - 24 });
    doc.font('Helvetica').fillColor(MUTED).fontSize(8).text('FECHA LIQUIDACIÓN', 48, y + 42);
    doc.fillColor(SLATE).fontSize(10).text(dateLabel || '—', 160, y + 40);
    y += 74;

    const columns = [
      { key: 'fecha', label: 'Fecha', width: 78 },
      { key: 'codigoCliente', label: 'Cliente', width: 72 },
      { key: 'nombreCliente', label: 'Nombre', width: 148 },
      { key: 'tipoCobro', label: 'Tipo cobro', width: 70 },
      { key: 'documento', label: 'Documento', width: 90 },
      { key: 'importe', label: 'Importe', width: 65, align: 'right' },
    ];

    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12)
      .text('Cobros de la liquidación', 36, y);
    y += 18;
    doc.rect(36, y, contentWidth, 22).fill(NAVY);
    let x = 40;
    doc.fillColor(WHITE).fontSize(8);
    for (const col of columns) {
      doc.text(col.label, x, y + 6, { width: col.width, align: col.align || 'left' });
      x += col.width;
    }
    y += 22;

    const rows = Array.isArray(cobros) ? cobros : [];
    if (!rows.length) {
      doc.rect(36, y, contentWidth, 28).fill('#f8fafc');
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text('Sin cobros en el periodo.', 48, y + 9, { width: contentWidth - 24 });
      y += 36;
    } else {
      rows.forEach((cobro, index) => {
        if (y > doc.page.height - 160) {
          doc.addPage();
          y = 48;
          doc.rect(36, y, contentWidth, 22).fill(NAVY);
          let hx = 40;
          doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(8);
          for (const col of columns) {
            doc.text(col.label, hx, y + 6, { width: col.width, align: col.align || 'left' });
            hx += col.width;
          }
          y += 22;
        }
        const bg = index % 2 === 0 ? WHITE : '#f4f8fd';
        doc.rect(36, y, contentWidth, 18).fill(bg);
        const cells = {
          fecha: cobro.fecha || '—',
          codigoCliente: cobro.codigoCliente || '—',
          nombreCliente: cobro.nombreCliente || '—',
          tipoCobro: paymentTypeLabel(cobro.tipoCobro),
          documento: paperDocumentLabel(cobro),
          importe: formatEuro(cobro.importe),
        };
        let cx = 40;
        doc.font('Helvetica').fontSize(7.5).fillColor(SLATE);
        for (const col of columns) {
          doc.text(String(cells[col.key]), cx, y + 4, {
            width: col.width,
            align: col.align || 'left',
            ellipsis: true,
          });
          cx += col.width;
        }
        y += 18;
      });
      doc.rect(36, y, contentWidth, 22).fill(GREEN_DARK);
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(9)
        .text('Total cobros', 48, y + 6, { width: 200 });
      doc.text(formatEuro(summary.totalCobrosDia), pageWidth - 36 - 90, y + 6, {
        width: 80,
        align: 'right',
      });
      y += 36;
    }

    if (y > doc.page.height - 210) {
      doc.addPage();
      y = 48;
    }

    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12)
      .text('Resumen tesorería', 36, y);
    y += 20;
    const colWidth = (contentWidth - 12) / 2;
    const leftItems = [
      { label: 'Total efectivo', value: summary.totalEfectivo, fill: CARD_GREEN, color: GREEN_DARK },
      { label: 'Total cheques', value: summary.totalCheques, fill: CARD_BG, color: NAVY },
      { label: 'Total tarjeta', value: summary.totalTarjeta, fill: CARD_BG, color: NAVY },
      { label: 'Total postdatados', value: summary.totalPostdatados, fill: CARD_BG, color: NAVY },
      { label: 'Total cobros día', value: summary.totalCobrosDia, fill: CARD_GREEN, color: GREEN_DARK },
    ];
    const rightItems = [
      { label: 'Saldo actual', value: summary.saldoActual, fill: CARD_AMBER, color: summary.saldoActual < 0 ? RED : NAVY },
      { label: 'Gastos', value: summary.gastos, fill: CARD_BG, color: NAVY },
      { label: 'Total a ingresar', value: summary.totalAIngresar, fill: CARD_GREEN, color: GREEN_DARK },
      { label: 'Ingreso en banco', value: summary.ingresoBanco, fill: CARD_BG, color: NAVY },
      { label: 'Diferencia', value: summary.diff, fill: summary.diff === 0 ? CARD_GREEN : CARD_AMBER, color: summary.diff === 0 ? GREEN_DARK : RED },
    ];

    const rowHeight = 28;
    leftItems.forEach((item, index) => {
      const ly = y + index * (rowHeight + 6);
      drawCard(doc, {
        x: 36,
        y: ly,
        width: colWidth,
        height: rowHeight,
        fill: item.fill,
        border: LINE,
        label: item.label,
        value: formatEuro(item.value),
        valueColor: item.color,
      });
      const right = rightItems[index];
      if (right) {
        drawCard(doc, {
          x: 36 + colWidth + 12,
          y: ly,
          width: colWidth,
          height: rowHeight,
          fill: right.fill,
          border: LINE,
          label: right.label,
          value: formatEuro(right.value),
          valueColor: right.color,
        });
      }
    });

    y += leftItems.length * (rowHeight + 6) + 12;
    doc.roundedRect(36, y, contentWidth, 36, 8).fillAndStroke('#fff8e6', AMBER);
    doc.fillColor(NAVY_DEEP).font('Helvetica').fontSize(8)
      .text(
        'Total a ingresar = efectivo + cheques + postdatados + saldo actual − gastos + ajustes. '
        + 'La tarjeta no se ingresa en efectivo: ya está cobrada en TPV.',
        48,
        y + 10,
        { width: contentWidth - 24 },
      );

    doc.end();
  });
}

module.exports = {
  formatEuro,
  formatGmpLiquidacionDisplay,
  cashToDeposit,
  paymentTypeLabel,
  paperDocumentLabel,
  buildLiquidacionPdfBuffer,
};
