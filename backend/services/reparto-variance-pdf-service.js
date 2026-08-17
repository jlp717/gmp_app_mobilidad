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

function buildVariancePdfBuffer(payload = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 72;
    const lineas = Array.isArray(payload.lineas) ? payload.lineas : [];
    const shortage = lineas.filter((line) => toQty(line.diff) < 0).length;
    const surplus = lineas.filter((line) => toQty(line.diff) > 0).length;

    doc.rect(0, 0, pageWidth, 88).fill(NAVY);
    doc.rect(0, 84, pageWidth, 6).fill(GREEN);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18)
      .text('Aviso de diferencia de entrega', 36, 22, { width: contentWidth });
    doc.font('Helvetica').fontSize(11).fillColor('#d7ecff')
      .text('Granja Mari Pepa — Control de reparto', 36, 48, { width: contentWidth });
    doc.fontSize(9).fillColor('#9ec5ea')
      .text(text(payload.fecha), 36, 66, { width: contentWidth });

    let y = 110;
    const meta = [
      ['Documento', `${text(payload.documentoTipo || 'ALBARAN')} ${text(payload.documentId)}`],
      ['Cliente', `${text(payload.clienteCodigo)} — ${text(payload.clienteNombre)}`],
      ['Repartidor', `${text(payload.repartidorNombre)} (${text(payload.repartidorId)})`],
      ['Comercial', `${text(payload.comercialNombre)} (${text(payload.comercialCode)})`],
      ['Estado', text(payload.deliveryStatus)],
    ];
    doc.roundedRect(36, y, contentWidth, 92, 8).fillAndStroke('#eef6ff', LINE);
    meta.forEach((row, index) => {
      const rowY = y + 10 + index * 15;
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(row[0], 48, rowY, { width: 90 });
      doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(9)
        .text(row[1], 140, rowY, { width: contentWidth - 120 });
    });
    y += 108;

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
      { key: 'codigoArticulo', label: 'Artículo', width: 70 },
      { key: 'descripcion', label: 'Descripción', width: 160 },
      { key: 'cantidadPedida', label: 'Pedida', width: 55, align: 'right' },
      { key: 'cantidadEntregada', label: 'Entregada', width: 62, align: 'right' },
      { key: 'diff', label: 'Diff', width: 50, align: 'right' },
      { key: 'motivoDiferencia', label: 'Motivo', width: 126 },
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

    y += 18;
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
  buildVariancePdfBuffer,
};
