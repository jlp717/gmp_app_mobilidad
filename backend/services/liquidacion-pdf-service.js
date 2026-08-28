'use strict';

const PDFDocument = require('pdfkit');
const { drawCompanyHeader } = require('./company-header');

const NAVY = '#003d7a';
const NAVY_DEEP = '#00264d';
const GREEN_DARK = '#067a58';
const AMBER = '#f0b429';
const RED = '#c2410c';
const SLATE = '#334155';
const MUTED = '#64748b';
const LINE = '#c5d4e8';
const CARD_BG = '#eef6ff';
const CARD_GREEN = '#e7f8f1';
const CARD_AMBER = '#fff6e0';
const CARD_MUTED = '#f1f5f9';
const WHITE = '#ffffff';

const CASH_METHOD_RE = /^(EFECTIVO|EF|F0|E|CONTADO|CT)$/i;
const CHEQUE_METHOD_RE = /^(CHEQUE|CH|TALON|TALON BANCARIO)$/i;
const CARD_METHOD_RE = /^(TARJETA|TJ|TPV|TRANSFERENCIA|TR|T0|BIZUM|BI)$/i;
const POSTDATED_METHOD_RE = /^(POSTDATADO|PD|POSTDATADOS)$/i;

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

function isCashPaymentMethod(raw) {
  return CASH_METHOD_RE.test(String(raw || '').trim());
}

function isChequePaymentMethod(raw) {
  return CHEQUE_METHOD_RE.test(String(raw || '').trim());
}

function isCardPaymentMethod(raw) {
  return CARD_METHOD_RE.test(String(raw || '').trim());
}

function isPostdatedPaymentMethod(raw) {
  return POSTDATED_METHOD_RE.test(String(raw || '').trim());
}

/**
 * Cash treasury deposit target.
 * Cheques / cartera / tarjeta never enter bank cash deposit.
 *
 * totalAIngresar = efectivo + saldoActual − gastos + ajustes
 * Identity: totalEfectivo = totalAIngresar − saldoActual  (when gastos=ajustes=0)
 */
function cashToDeposit({
  totalEfectivo = 0,
  saldoActual = 0,
  gastos = 0,
  ajustes = 0,
} = {}) {
  return roundMoney(
    toNumber(totalEfectivo)
      + toNumber(saldoActual)
      - toNumber(gastos)
      + toNumber(ajustes),
  );
}

/**
 * Carry-forward debt written to REPARTIDOR_FINANCIAL_BALANCES.SALDO_PENDIENTE.
 * Only cash affects treasury debt; tarjeta/cheques/postdatados stay out.
 */
function computeClosingBalance({
  openingBalance = 0,
  cashPayments = 0,
  expenses = 0,
  adjustments = 0,
  bankDeposits = 0,
} = {}) {
  return roundMoney(
    toNumber(openingBalance)
      + toNumber(cashPayments)
      - toNumber(expenses)
      + toNumber(adjustments)
      - toNumber(bankDeposits),
  );
}

function sumCashPayments(payments = []) {
  return roundMoney(
    (Array.isArray(payments) ? payments : []).reduce((sum, payment) => {
      if (!isCashPaymentMethod(payment?.paymentMethod)) return sum;
      return sum + toNumber(payment?.amount);
    }, 0),
  );
}

function paymentTypeLabel(raw) {
  const value = String(raw || '').trim().toUpperCase();
  if (CASH_METHOD_RE.test(value)) return 'EFECTIVO';
  if (CARD_METHOD_RE.test(value)) return 'TARJETA';
  if (['TRANSFERENCIA', 'TR'].includes(value)) return 'TRANSFERENCIA';
  if (['BIZUM', 'BI'].includes(value)) return 'BIZUM';
  if (CHEQUE_METHOD_RE.test(value)) return 'CHEQUE';
  if (POSTDATED_METHOD_RE.test(value)) return 'POSTDATADO';
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
        totalEfectivo, saldoActual, gastos, ajustes,
      }),
  );
  const ingresoBanco = roundMoney(input.ingresoBanco);
  const diff = roundMoney(input.diff ?? (totalAIngresar - ingresoBanco));
  const saldoResultante = roundMoney(
    input.saldoResultante ?? computeClosingBalance({
      openingBalance: saldoActual,
      cashPayments: totalEfectivo,
      expenses: gastos,
      adjustments: ajustes,
      bankDeposits: ingresoBanco,
    }),
  );
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
    saldoResultante,
  };
}

function drawCard(doc, {
  x, y, width, height, fill, border, label, value, valueColor,
}) {
  doc.roundedRect(x, y, width, height, 8).fillAndStroke(fill, border);
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
    .text(label, x + 10, y + 9, { width: width * 0.55 });
  doc.fillColor(valueColor || NAVY).font('Helvetica-Bold').fontSize(10)
    .text(value, x + width * 0.48, y + 8, {
      width: width * 0.48 - 12,
      align: 'right',
    });
  doc.font('Helvetica');
}

function buildLiquidacionPdfBuffer({
  title,
  displayNumber,
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

    let y = drawCompanyHeader(doc);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(18)
      .text(heading, 36, y, { width: contentWidth });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text(generated, 36, doc.y + 6, { width: contentWidth });
    y = doc.y + 16;
    doc.roundedRect(36, y, contentWidth, 72, 8).fillAndStroke(CARD_BG, LINE);
    doc.fillColor(MUTED).fontSize(8).text('FECHA', 48, y + 10);
    doc.fillColor(SLATE).fontSize(10).text(dateLabel || generated, 100, y + 8, { width: contentWidth - 120 });
    doc.fillColor(MUTED).fontSize(8).text('VENDEDOR', 48, y + 28);
    doc.fillColor(NAVY_DEEP).font('Helvetica-Bold').fontSize(11)
      .text(vendedor || '—', 120, y + 26, { width: contentWidth - 140 });
    doc.font('Helvetica').fillColor(MUTED).fontSize(8).text('USUARIO', 48, y + 46);
    doc.fillColor(NAVY_DEEP).font('Helvetica-Bold').fontSize(11)
      .text(usuario || '—', 120, y + 44, { width: contentWidth - 140 });
    y += 88;

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
        if (y > doc.page.height - 220) {
          doc.addPage();
          y = drawCompanyHeader(doc);
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
        .text('TOTAL:', pageWidth - 36 - 130, y + 6, { width: 40, align: 'right' });
      doc.text(formatEuro(summary.totalCobrosDia), pageWidth - 36 - 90, y + 6, {
        width: 80,
        align: 'right',
      });
      y += 36;
    }

    if (y > doc.page.height - 280) {
      doc.addPage();
      y = drawCompanyHeader(doc);
    }

    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(12)
      .text('Resumen tesorería', 36, y);
    y += 18;
    const colWidth = (contentWidth - 12) / 2;
    const leftItems = [
      {
        label: 'Total Efectivo', value: summary.totalEfectivo,
        fill: CARD_GREEN, color: GREEN_DARK,
      },
      {
        label: 'Total Cheques', value: summary.totalCheques,
        fill: CARD_BG, color: NAVY,
      },
      {
        label: 'Total Tarjeta', value: summary.totalTarjeta,
        fill: CARD_BG, color: NAVY,
      },
      {
        label: 'Total Postdatados', value: summary.totalPostdatados,
        fill: CARD_BG, color: NAVY,
      },
      {
        label: 'Total Cobros Día', value: summary.totalCobrosDia,
        fill: CARD_GREEN, color: GREEN_DARK,
      },
    ];
    const rightItems = [
      {
        label: 'Saldo actual', value: summary.saldoActual,
        fill: CARD_AMBER, color: summary.saldoActual < 0 ? RED : NAVY,
      },
      {
        label: 'Gastos', value: summary.gastos,
        fill: CARD_BG, color: NAVY,
      },
      {
        label: 'Total a ingresar', value: summary.totalAIngresar,
        fill: CARD_GREEN, color: GREEN_DARK,
      },
      {
        label: 'Ingreso en Banco', value: summary.ingresoBanco,
        fill: CARD_BG, color: NAVY,
      },
    ];

    const rowHeight = 34;
    const rowCount = Math.max(leftItems.length, rightItems.length);
    for (let index = 0; index < rowCount; index += 1) {
      const ly = y + index * (rowHeight + 6);
      const left = leftItems[index];
      if (left) {
        drawCard(doc, {
          x: 36, y: ly, width: colWidth, height: rowHeight,
          fill: left.fill, border: LINE, label: left.label,
          value: formatEuro(left.value), valueColor: left.color,
        });
      }
      const right = rightItems[index];
      if (right) {
        drawCard(doc, {
          x: 36 + colWidth + 12, y: ly, width: colWidth, height: rowHeight,
          fill: right.fill, border: LINE, label: right.label,
          value: formatEuro(right.value), valueColor: right.color,
        });
      }
    }

    doc.end();
  });
}

module.exports = {
  formatEuro,
  formatGmpLiquidacionDisplay,
  cashToDeposit,
  computeClosingBalance,
  sumCashPayments,
  isCashPaymentMethod,
  isChequePaymentMethod,
  isCardPaymentMethod,
  isPostdatedPaymentMethod,
  paymentTypeLabel,
  paperDocumentLabel,
  buildLiquidacionPdfBuffer,
  CASH_METHOD_RE,
  CHEQUE_METHOD_RE,
  CARD_METHOD_RE,
  POSTDATED_METHOD_RE,
};
