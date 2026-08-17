'use strict';

/**
 * Detect qty variance on reparto confirm, enqueue outbox, send HTML email,
 * and build the daily digest at 18:00 Europe/Madrid.
 */

const { queryWithParams } = require('../config/db');
const { resolveRepartoRuntime } = require('../config/reparto-runtime');
const logger = require('../middleware/logger');
const { sendHtmlEmail, sendEmailWithPdf } = require('./emailPdfService');
const { buildVariancePdfBuffer } = require('./reparto-variance-pdf-service');
const {
  resolveDeliveryVarianceRecipients,
  normalizeVendorCode,
} = require('./staff-email-directory-service');

function notificationTables(env = process.env) {
  const runtime = resolveRepartoRuntime(env);
  const tables = runtime?.tables?.notifications;
  if (!runtime.valid || !tables?.varianceOutbox) {
    throw new Error('Variance outbox table unavailable in reparto runtime');
  }
  return tables;
}

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function toQty(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function qtyDiffers(left, right) {
  return Math.abs(toQty(left) - toQty(right)) > 0.0001;
}

/**
 * Lines where delivered != ordered, or pending/rejected > 0 (delivered diff).
 * Pure — safe for unit tests without DB.
 */
function detectVarianceLines(lineas = []) {
  if (!Array.isArray(lineas)) return [];
  const out = [];
  for (const line of lineas) {
    if (!line || typeof line !== 'object') continue;
    const cantidadPedida = toQty(line.cantidadPedida);
    const cantidadEntregada = toQty(line.cantidadEntregada);
    const cantidadRechazada = toQty(line.cantidadRechazada);
    const cantidadPendiente = toQty(line.cantidadPendiente);
    const hasPendingOrRejected = cantidadRechazada > 0 || cantidadPendiente > 0;
    const deliveredDiff = qtyDiffers(cantidadEntregada, cantidadPedida);
    if (!deliveredDiff && !hasPendingOrRejected) continue;
    out.push({
      lineaId: normalizeText(line.lineaId),
      codigoArticulo: normalizeText(line.codigoArticulo),
      descripcion: normalizeText(line.descripcion || line.observaciones),
      cantidadPedida,
      cantidadEntregada,
      cantidadRechazada,
      cantidadPendiente,
      diff: Math.round((cantidadEntregada - cantidadPedida + Number.EPSILON) * 1000) / 1000,
      motivoDiferencia: normalizeText(line.motivoDiferencia) || null,
    });
  }
  return out;
}

function escapeHtml(value) {
  return normalizeText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatQty(value) {
  const num = toQty(value);
  return Number.isInteger(num) ? String(num) : num.toFixed(3).replace(/\.?0+$/, '');
}

function buildVarianceEmailHtml(payload) {
  const rows = (payload.lineas || []).map((line, index) => {
    const bg = index % 2 === 0 ? '#ffffff' : '#f3f8fc';
    const diffColor = line.diff < 0 ? '#b91c1c' : line.diff > 0 ? '#166534' : '#111827';
    return `
      <tr style="background:${bg};">
        <td style="padding:8px 10px;border-bottom:1px solid #dce3ea;font-size:12px;">${escapeHtml(line.codigoArticulo)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #dce3ea;font-size:12px;">${escapeHtml(line.descripcion || line.lineaId)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #dce3ea;font-size:12px;text-align:right;">${formatQty(line.cantidadPedida)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #dce3ea;font-size:12px;text-align:right;">${formatQty(line.cantidadEntregada)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #dce3ea;font-size:12px;text-align:right;color:${diffColor};font-weight:600;">${formatQty(line.diff)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #dce3ea;font-size:11px;">${escapeHtml(line.motivoDiferencia || '')}</td>
      </tr>`;
  }).join('');

  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:720px;margin:0 auto;">
    <div style="background:linear-gradient(135deg,#003d7a 0%,#1a5490 100%);padding:20px 24px;border-radius:12px 12px 0 0;">
      <h1 style="margin:0;color:#fff;font-size:20px;">Diferencia de cantidades en entrega</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Granja Mari Pepa — Reparto</p>
    </div>
    <div style="background:#f8f9fa;padding:20px 24px;border-radius:0 0 12px 12px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;font-size:13px;color:#333;">
        <tr><td style="padding:4px 0;"><strong>Documento</strong></td><td>${escapeHtml(payload.documentoTipo || 'ALBARAN')} ${escapeHtml(payload.documentId)}</td></tr>
        <tr><td style="padding:4px 0;"><strong>Fecha</strong></td><td>${escapeHtml(payload.fecha || '')}</td></tr>
        <tr><td style="padding:4px 0;"><strong>Cliente</strong></td><td>${escapeHtml(payload.clienteCodigo)} — ${escapeHtml(payload.clienteNombre)}</td></tr>
        <tr><td style="padding:4px 0;"><strong>Repartidor</strong></td><td>${escapeHtml(payload.repartidorNombre || '')} (${escapeHtml(payload.repartidorId)})</td></tr>
        <tr><td style="padding:4px 0;"><strong>Comercial</strong></td><td>${escapeHtml(payload.comercialNombre || '')} (${escapeHtml(payload.comercialCode || '—')})</td></tr>
        <tr><td style="padding:4px 0;"><strong>Estado</strong></td><td>${escapeHtml(payload.deliveryStatus || '')}</td></tr>
      </table>
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;border:1px solid #dce3ea;">
        <thead>
          <tr style="background:#003d7a;color:#fff;">
            <th style="padding:8px 10px;text-align:left;font-size:11px;">ARTÍCULO</th>
            <th style="padding:8px 10px;text-align:left;font-size:11px;">DESCRIPCIÓN</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px;">PEDIDA</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px;">ENTREGADA</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px;">DIFF</th>
            <th style="padding:8px 10px;text-align:left;font-size:11px;">MOTIVO</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:#888;">Aviso automático — no responder a este correo.</p>
    </div>
  </div>`;
}

function buildDigestEmailHtml(items) {
  const blocks = (items || []).map((item, index) => {
    const payload = typeof item.payload === 'string' ? safeJson(item.payload) : item.payload;
    return `
      <div style="margin-bottom:18px;padding:12px;border:1px solid #dce3ea;border-radius:8px;background:${index % 2 ? '#f3f8fc' : '#fff'};">
        <div style="font-size:13px;font-weight:600;color:#003d7a;">
          ${escapeHtml(payload.documentId || item.documentId)} — ${escapeHtml(payload.clienteNombre || '')}
        </div>
        <div style="font-size:12px;color:#555;margin:4px 0 8px;">
          Repartidor ${escapeHtml(payload.repartidorId || item.repartidorId)}
          · Comercial ${escapeHtml(payload.comercialCode || item.comercialCode || '—')}
          · ${escapeHtml(payload.fecha || item.createdAt || '')}
        </div>
        <ul style="margin:0;padding-left:18px;font-size:12px;color:#333;">
          ${(payload.lineas || []).map((line) => `
            <li>${escapeHtml(line.codigoArticulo)}: pedida ${formatQty(line.cantidadPedida)} / entregada ${formatQty(line.cantidadEntregada)} (diff ${formatQty(line.diff)})</li>
          `).join('')}
        </ul>
      </div>`;
  }).join('');

  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:720px;margin:0 auto;">
    <div style="background:linear-gradient(135deg,#003d7a 0%,#1a5490 100%);padding:20px 24px;border-radius:12px 12px 0 0;">
      <h1 style="margin:0;color:#fff;font-size:20px;">Resumen diario de diferencias de entrega</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">${(items || []).length} aviso(s)</p>
    </div>
    <div style="background:#f8f9fa;padding:20px 24px;border-radius:0 0 12px 12px;">
      ${blocks || '<p style="color:#666;">Sin diferencias pendientes de digestar.</p>'}
    </div>
  </div>`;
}

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function parseDocumentIdentity(documentId) {
  const parts = normalizeText(documentId).split('-');
  if (parts.length < 4) return null;
  const [yearRaw, serie, terminalRaw, numberRaw, ...clientParts] = parts;
  const ejercicio = Number(yearRaw);
  const terminal = Number(terminalRaw);
  const numero = Number(numberRaw);
  if (!Number.isInteger(ejercicio) || !Number.isInteger(terminal) || !Number.isInteger(numero)) {
    return null;
  }
  return {
    ejercicio,
    serie: normalizeText(serie),
    terminal,
    numero,
    cliente: clientParts.length ? clientParts.join('-') : null,
  };
}

/**
 * Resolve document comercial from DSEDAC.CPC (CODIGOCOMERCIAL / CODIGOVENDEDOR).
 */
async function resolveDocumentComercialCode(documentId, { query = queryWithParams } = {}) {
  const identity = parseDocumentIdentity(documentId);
  if (!identity) return '';

  const params = [identity.ejercicio, identity.serie, identity.terminal, identity.numero];
  let sql = `
    SELECT TRIM(COALESCE(NULLIF(TRIM(CODIGOCOMERCIAL), ''), NULLIF(TRIM(CODIGOVENDEDOR), ''))) AS COMERCIAL
      FROM DSEDAC.CPC
     WHERE EJERCICIOALBARAN = ?
       AND TRIM(SERIEALBARAN) = ?
       AND TERMINALALBARAN = ?
       AND NUMEROALBARAN = ?
  `;
  if (identity.cliente) {
    sql += ' AND TRIM(CODIGOCLIENTEALBARAN) = ?';
    params.push(identity.cliente);
  }
  sql += ' FETCH FIRST 1 ROW ONLY';

  try {
    const rows = await query(sql, params);
    return normalizeVendorCode(rows?.[0]?.COMERCIAL || rows?.[0]?.comercial);
  } catch (error) {
    logger.warn(`[variance] comercial lookup failed for ${documentId}: ${error.message}`);
    return '';
  }
}

async function enqueueVarianceOutbox(row, { query = queryWithParams, env = process.env } = {}) {
  const tables = notificationTables(env);
  const sql = `
    INSERT INTO ${tables.varianceOutbox}
      (CONFIRMATION_ID, DOCUMENT_ID, REPARTIDOR_ID, COMERCIAL_CODE, PAYLOAD_JSON, STATUS, DIGEST_INCLUDED)
    VALUES (?, ?, ?, ?, ?, 'PENDING', 'N')
  `;
  const result = await query(sql, [
    Number(row.confirmationId),
    normalizeText(row.documentId),
    normalizeText(row.repartidorId),
    normalizeVendorCode(row.comercialCode) || null,
    JSON.stringify(row.payload),
  ]);
  return result;
}

async function markOutboxStatus(id, { status, error = null, query = queryWithParams, env = process.env } = {}) {
  const tables = notificationTables(env);
  if (status === 'SENT') {
    await query(
      `UPDATE ${tables.varianceOutbox}
          SET STATUS = ?, SENT_AT = CURRENT TIMESTAMP, ERROR = NULL
        WHERE ID = ?`,
      [status, id],
    );
    return;
  }
  await query(
    `UPDATE ${tables.varianceOutbox}
        SET STATUS = ?, ERROR = ?
      WHERE ID = ?`,
    [status, normalizeText(error).slice(0, 500) || null, id],
  );
}

async function sendVarianceEmail(payload, recipients, { sendEmail = sendEmailWithPdf } = {}) {
  if (!recipients.length) {
    logger.warn('[variance] no recipients — email skipped');
    return { sent: 0, results: [] };
  }
  const subject = `Diferencia entrega ${payload.documentId} — ${payload.clienteNombre || payload.clienteCodigo || ''}`;
  const htmlBody = buildVarianceEmailHtml(payload);
  const textBody = [
    `Documento: ${payload.documentId}`,
    `Cliente: ${payload.clienteCodigo} ${payload.clienteNombre || ''}`,
    `Repartidor: ${payload.repartidorId}`,
    `Comercial: ${payload.comercialCode || ''}`,
    ...payload.lineas.map((line) => (
      `${line.codigoArticulo}: pedida ${line.cantidadPedida} / entregada ${line.cantidadEntregada} (diff ${line.diff})`
    )),
  ].join('\n');
  let pdfBuffer = payload.pdfBuffer;
  if (!pdfBuffer) {
    try {
      pdfBuffer = await buildVariancePdfBuffer(payload);
    } catch (error) {
      logger.warn(`[variance] pdf build failed: ${error.message}`);
    }
  }

  const results = [];
  for (const to of recipients) {
    try {
      const result = await sendEmail({
        to,
        subject,
        htmlBody,
        textBody,
        ...(pdfBuffer ? {
          pdfBuffer,
          pdfFilename: `Diferencia_entrega_${String(payload.documentId || 'albaran').replace(/\s+/g, '_')}.pdf`,
        } : {}),
      });
      results.push({ to, success: true, result });
    } catch (error) {
      logger.error(`[variance] email failed to ${to}: ${error.message}`);
      results.push({ to, success: false, error: error.message });
    }
  }
  return { sent: results.filter((r) => r.success).length, results };
}

/**
 * After successful confirm: detect variance, enqueue, send immediate email.
 * Never throws to caller — failures are logged.
 */
async function notifyAfterConfirm({
  command,
  result,
} = {}, {
  query = queryWithParams,
  env = process.env,
  sendEmail = sendEmailWithPdf,
  resolveRecipients = resolveDeliveryVarianceRecipients,
  resolveComercial = resolveDocumentComercialCode,
} = {}) {
  if (!result?.created || !command?.delivery) {
    return { skipped: true, reason: 'not_created' };
  }

  const lineas = detectVarianceLines(command.delivery.lineas);
  if (lineas.length === 0) {
    return { skipped: true, reason: 'no_variance' };
  }

  const documentId = normalizeText(command.delivery.itemId);
  const repartidorId = normalizeText(
    command.delivery.repartidorId || command.actor?.repartidorId,
  );
  let comercialCode = '';
  try {
    comercialCode = await resolveComercial(documentId, { query });
  } catch (error) {
    logger.warn(`[variance] comercial resolve error: ${error.message}`);
  }

  const fecha = normalizeText(command.delivery.occurredAt).slice(0, 10)
    || new Date().toISOString().slice(0, 10);

  const payload = {
    confirmationId: String(result.confirmationId),
    documentId,
    documentoTipo: 'ALBARAN',
    fecha,
    clienteCodigo: normalizeText(command.cobro?.codigoCliente) || '',
    clienteNombre: normalizeText(command.cobro?.nombreCliente) || '',
    repartidorId,
    comercialCode,
    deliveryStatus: normalizeText(result.deliveryStatus || command.delivery.status),
    lineas,
  };

  let outboxId = null;
  try {
    await enqueueVarianceOutbox({
      confirmationId: result.confirmationId,
      documentId,
      repartidorId,
      comercialCode,
      payload,
    }, { query, env });
    outboxId = Number(result.confirmationId);
  } catch (error) {
    logger.error(`[variance] outbox enqueue failed: ${error.message}`);
  }

  const { emails, details } = await resolveRecipients({ repartidorId, comercialCode }, { query, env });
  const repartidorDetail = details.find((d) => d.label === 'repartidor');
  const comercialDetail = details.find((d) => d.label === 'comercial');
  payload.repartidorNombre = repartidorDetail?.nombre || '';
  payload.comercialNombre = comercialDetail?.nombre || '';

  const sendResult = await sendVarianceEmail(payload, emails, { sendEmail });

  if (outboxId != null) {
    try {
      const tables = notificationTables(env);
      const ok = sendResult.sent > 0;
      if (ok) {
        await query(
          `UPDATE ${tables.varianceOutbox}
              SET STATUS = 'SENT', SENT_AT = CURRENT TIMESTAMP, ERROR = NULL
            WHERE CONFIRMATION_ID = ? AND STATUS = 'PENDING'`,
          [outboxId],
        );
      } else {
        await query(
          `UPDATE ${tables.varianceOutbox}
              SET STATUS = 'FAILED', ERROR = ?
            WHERE CONFIRMATION_ID = ? AND STATUS = 'PENDING'`,
          ['No recipients or all sends failed', outboxId],
        );
      }
    } catch (error) {
      logger.warn(`[variance] outbox status update failed: ${error.message}`);
    }
  } else if (sendResult.sent > 0) {
    // Enqueue failed but email went out — try insert as SENT for digest tracking
    try {
      const tables = notificationTables(env);
      await query(
        `INSERT INTO ${tables.varianceOutbox}
          (CONFIRMATION_ID, DOCUMENT_ID, REPARTIDOR_ID, COMERCIAL_CODE, PAYLOAD_JSON, STATUS, SENT_AT, DIGEST_INCLUDED)
         VALUES (?, ?, ?, ?, ?, 'SENT', CURRENT TIMESTAMP, 'N')`,
        [
          Number(result.confirmationId),
          documentId,
          repartidorId,
          comercialCode || null,
          JSON.stringify(payload),
        ],
      );
    } catch (error) {
      logger.warn(`[variance] post-send outbox insert failed: ${error.message}`);
    }
  }

  return { skipped: false, lineCount: lineas.length, ...sendResult, outboxId };
}

/**
 * Daily digest: PENDING + SENT-today not yet digested.
 */
async function sendDailyVarianceDigest({
  query = queryWithParams,
  env = process.env,
  sendEmail = sendHtmlEmail,
  resolveRecipients = resolveDeliveryVarianceRecipients,
} = {}) {
  const tables = notificationTables(env);
  const sql = `
    SELECT ID, CONFIRMATION_ID, DOCUMENT_ID, REPARTIDOR_ID, COMERCIAL_CODE,
           PAYLOAD_JSON, STATUS, CREATED_AT, SENT_AT
      FROM ${tables.varianceOutbox}
     WHERE DIGEST_INCLUDED = 'N'
       AND (
         STATUS = 'PENDING'
         OR (STATUS = 'SENT' AND DATE(CREATED_AT) = CURRENT DATE)
         OR (STATUS = 'SENT' AND SENT_AT IS NOT NULL AND DATE(SENT_AT) = CURRENT DATE)
       )
     ORDER BY CREATED_AT
  `;
  let rows = [];
  try {
    rows = await query(sql, []);
  } catch (error) {
    logger.error(`[variance] digest query failed: ${error.message}`);
    throw error;
  }

  if (!rows.length) {
    logger.info('[variance] digest: nothing to send');
    return { sent: 0, items: 0 };
  }

  const items = rows.map((row) => ({
    id: rowValue(row, 'ID'),
    documentId: normalizeText(rowValue(row, 'DOCUMENT_ID')),
    repartidorId: normalizeText(rowValue(row, 'REPARTIDOR_ID')),
    comercialCode: normalizeVendorCode(rowValue(row, 'COMERCIAL_CODE')),
    createdAt: normalizeText(rowValue(row, 'CREATED_AT')),
    payload: safeJson(rowValue(row, 'PAYLOAD_JSON')),
  }));

  const { emails } = await resolveRecipients({
    repartidorId: null,
    comercialCode: null,
  }, { query, env });

  // Digest goes to role recipients only (OFICINA/CARLOS/LACAL) — resolveRole path
  // already included when comercial/repartidor null; ensure roles still resolved.
  const subject = `Resumen diario diferencias entrega (${items.length})`;
  const htmlBody = buildDigestEmailHtml(items);
  const textBody = items.map((item) => (
    `${item.documentId} rep=${item.repartidorId} com=${item.comercialCode || ''} lines=${(item.payload.lineas || []).length}`
  )).join('\n');

  let sent = 0;
  for (const to of emails) {
    try {
      await sendEmail({ to, subject, htmlBody, textBody });
      sent += 1;
    } catch (error) {
      logger.error(`[variance] digest email failed to ${to}: ${error.message}`);
    }
  }

  const ids = items.map((item) => item.id).filter((id) => id != null);
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(', ');
    try {
      await query(
        `UPDATE ${tables.varianceOutbox}
            SET DIGEST_INCLUDED = 'S'
          WHERE ID IN (${placeholders})`,
        ids,
      );
    } catch (error) {
      logger.error(`[variance] digest mark failed: ${error.message}`);
    }
  }

  logger.info(`[variance] digest sent=${sent} items=${items.length}`);
  return { sent, items: items.length };
}

function rowValue(row, key) {
  if (!row) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  const lower = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(row, lower)) return row[lower];
  const upper = key.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(row, upper)) return row[upper];
  return undefined;
}

module.exports = {
  detectVarianceLines,
  buildVarianceEmailHtml,
  buildDigestEmailHtml,
  resolveDocumentComercialCode,
  notifyAfterConfirm,
  sendDailyVarianceDigest,
  enqueueVarianceOutbox,
  sendVarianceEmail,
};
