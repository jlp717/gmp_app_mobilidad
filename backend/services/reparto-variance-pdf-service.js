'use strict';

const PDFDocument = require('pdfkit');

const NAVY = '#003d7a';
const GREEN = '#00a878';
const RED = '#b91c1c';
const SLATE = '#334155';
const MUTED = '#64748b';
const LINE = '#c5d4e8';

function toQty(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function formatQty(value) {
  const num = toQty(value);
  return Number.isInteger(num) ? String(num) : num.toFixed(3).replace(/\.?0+$/, '');
}

function text(value) {
  return String(value || '').trim() || '—';
}

function roundedQty(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
}

function requiredText(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`El PDF de diferencias requiere ${field}`);
  return normalized;
}

function requiredQty(value, field) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new TypeError(`Cantidad de diferencia inválida: ${field}`);
  }
  return roundedQty(amount);
}

function buildVariancePdfModel(payload = {}) {
  const documentId = requiredText(payload.documentId, 'documento');
  const confirmedAt = requiredText(payload.confirmedAt || payload.fecha, 'fecha/hora de confirmación');
  const repartidorId = requiredText(payload.repartidorId, 'repartidor');
  const clienteCodigo = String(payload.clienteCodigo ?? '').trim();
  const clienteNombre = String(payload.clienteNombre ?? '').trim();
  if (!clienteCodigo && !clienteNombre) throw new TypeError('El PDF de diferencias requiere cliente');
  if (!Array.isArray(payload.lineas)) throw new TypeError('El PDF de diferencias requiere líneas');
  const lineas = payload.lineas.map((line, index) => {
    if (!line || typeof line !== 'object') throw new TypeError(`Línea de diferencia inválida: ${index + 1}`);
    const cantidadPedida = requiredQty(line.cantidadPedida, `línea ${index + 1} pedida`);
    const cantidadEntregada = requiredQty(line.cantidadEntregada, `línea ${index + 1} entregada`);
    const cantidadRechazada = requiredQty(line.cantidadRechazada, `línea ${index + 1} rechazada`);
    const cantidadPendiente = requiredQty(line.cantidadPendiente, `línea ${index + 1} pendiente`);
    const diff = roundedQty(Number(line.diff));
    const calculatedDiff = roundedQty(cantidadEntregada - cantidadPedida);
    if (!Number.isFinite(diff) || Math.abs(diff - calculatedDiff) > 0.0001) throw new TypeError(`Diferencia de línea incoherente: ${index + 1}`);
    return { codigoArticulo: text(line.codigoArticulo), descripcion: text(line.descripcion || line.lineaId), cantidadPedida, cantidadEntregada, cantidadRechazada, cantidadPendiente, diff, motivoDiferencia: text(line.motivoDiferencia) };
  });
  const totals = lineas.reduce((acc, line) => ({ pedida: roundedQty(acc.pedida + line.cantidadPedida), entregada: roundedQty(acc.entregada + line.cantidadEntregada), rechazada: roundedQty(acc.rechazada + line.cantidadRechazada), pendiente: roundedQty(acc.pendiente + line.cantidadPendiente), diff: roundedQty(acc.diff + line.diff) }), { pedida: 0, entregada: 0, rechazada: 0, pendiente: 0, diff: 0 });
  return { ...payload, documentId, confirmedAt, fecha: String(payload.fecha || confirmedAt).trim(), repartidorId, clienteCodigo, clienteNombre, lineas, totals };
}

function buildVariancePdfBuffer(payload = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    let model;
    try {
      model = buildVariancePdfModel(payload);
    } catch (error) {
      doc.destroy();
      reject(error);
      return;
    }
    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 72;
    const lineas = model.lineas;
    const shortage = lineas.filter((line) => toQty(line.diff) < 0).length;
    const surplus = lineas.filter((line) => toQty(line.diff) > 0).length;
    const totals = model.totals;

    doc.rect(0, 0, pageWidth, 88).fill(NAVY);
    doc.rect(0, 84, pageWidth, 6).fill(GREEN);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18)
      .text('Aviso de diferencia de entrega', 36, 22, { width: contentWidth });
    doc.font('Helvetica').fontSize(11).fillColor('#d7ecff')
      .text('Granja Mari Pepa — Control de reparto', 36, 48, { width: contentWidth });
    doc.fontSize(9).fillColor('#9ec5ea')
      .text(text(model.confirmedAt), 36, 66, { width: contentWidth });

    let y = 110;
    const meta = [
      ['Documento', `${text(model.documentoTipo || 'ALBARAN')} ${text(model.documentId)}`],
      ['Cliente', `${text(model.clienteCodigo)} — ${text(model.clienteNombre)}`],
      ['Repartidor', `${text(model.repartidorNombre)} (${text(model.repartidorId)})`],
      ['Comercial', `${text(model.comercialNombre)} (${text(model.comercialCode)})`],
      ['Estado', text(model.deliveryStatus)],
    ];
    doc.roundedRect(36, y, contentWidth, 108, 8).fillAndStroke('#eef6ff', LINE);
    meta.forEach((row, index) => {
      const rowY = y + 10 + index * 15;
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(row[0], 48, rowY, { width: 90 });
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
        .text(row[1], 140, rowY, { width: contentWidth - 120 });
    });
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('Observaciones', 48, y + 85, { width: 90 });
    doc.fillColor(NAVY).font('Helvetica').fontSize(9)
      .text(text(model.observaciones), 140, y + 85, { width: contentWidth - 120, ellipsis: true });
    y += 124;

    doc.roundedRect(36, y, contentWidth, 36, 8).fillAndStroke('#fff1f2', '#fecdd3');
    doc.fillColor(RED).font('Helvetica-Bold').fontSize(10)
      .text(
        `La entrega no coincide con lo pedido: ${lineas.length} línea(s) con diferencia`
        + `${shortage ? ` · ${shortage} con menos` : ''}`
        + `${surplus ? ` · ${surplus} con más` : ''}.`,
        48,
        y + 11,
        { width: contentWidth - 24 },
      );
    y += 52;

    const columns = [
      { key: 'codigoArticulo', label: 'Artículo', width: 60 },
      { key: 'descripcion', label: 'Descripción', width: 115 },
      { key: 'cantidadPedida', label: 'Pedida', width: 45, align: 'right' },
      { key: 'cantidadEntregada', label: 'Entregada', width: 55, align: 'right' },
      { key: 'cantidadRechazada', label: 'Rech.', width: 40, align: 'right' },
      { key: 'cantidadPendiente', label: 'Pend.', width: 40, align: 'right' },
      { key: 'diff', label: 'Diff', width: 40, align: 'right' },
      { key: 'motivoDiferencia', label: 'Motivo', width: 128 },
    ];
    doc.rect(36, y, contentWidth, 22).fill(NAVY);
    let x = 42;
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
    for (const col of columns) {
      doc.text(col.label, x, y + 6, { width: col.width, align: col.align || 'left' });
      x += col.width;
    }
    y += 22;

    if (!lineas.length) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text('Sin líneas con diferencia.', 48, y + 10);
    } else {
      lineas.forEach((line, index) => {
        if (y > doc.page.height - 80) {
          doc.addPage();
          y = 48;
        }
        const bg = index % 2 === 0 ? '#ffffff' : '#f8fafc';
        doc.rect(36, y, contentWidth, 20).fill(bg);
        const diff = toQty(line.diff);
        const cells = {
          codigoArticulo: text(line.codigoArticulo),
          descripcion: text(line.descripcion || line.lineaId),
          cantidadPedida: formatQty(line.cantidadPedida),
          cantidadEntregada: formatQty(line.cantidadEntregada),
          cantidadRechazada: formatQty(line.cantidadRechazada),
          cantidadPendiente: formatQty(line.cantidadPendiente),
          diff: formatQty(diff),
          motivoDiferencia: text(line.motivoDiferencia),
        };
        let cx = 42;
        for (const col of columns) {
          const color = col.key === 'diff'
            ? (diff < 0 ? RED : diff > 0 ? GREEN : SLATE)
            : SLATE;
          doc.fillColor(color).font(col.key === 'diff' ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
            .text(String(cells[col.key]), cx, y + 5, {
              width: col.width,
              align: col.align || 'left',
              ellipsis: true,
            });
          cx += col.width;
        }
        y += 20;
      });
    }

    y += 8;
    doc.roundedRect(36, y, contentWidth, 30, 6).fillAndStroke('#eef6ff', LINE);
    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8)
      .text(`Totales  Pedida ${formatQty(totals.pedida)} · Entregada ${formatQty(totals.entregada)} · Rechazada ${formatQty(totals.rechazada)} · Pendiente ${formatQty(totals.pendiente)} · Diferencia ${formatQty(totals.diff)}`, 48, y + 10, { width: contentWidth - 24 });
    y += 46;
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text(
        'Documento automático de control. Revisar albarán, cantidades y motivo antes de regularizar.',
        36,
        y,
        { width: contentWidth },
      );

    doc.end();
  });
}

module.exports = {
  buildVariancePdfModel,
  buildVariancePdfBuffer,
};
