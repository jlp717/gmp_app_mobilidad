'use strict';

/**
 * Detect qty variance on reparto confirm, enqueue outbox, send HTML email,
 * and build the daily digest at 07:00 Europe/Madrid (previous day).
 */

const { queryWithParams } = require('../config/db');
const { resolveRepartoRuntime } = require('../config/reparto-runtime');
const logger = require('../middleware/logger');
const { sendHtmlEmail, sendEmailWithPdf } = require('./emailPdfService');
const { buildVariancePdfBuffer } = require('./reparto-variance-pdf-service');
const { buildCobroPdfBuffer, buildCobroPdfFileName } = require('./reparto-cobro-pdf-service');
const {
  resolveDeliveryVarianceRecipients,
  resolveLiquidacionRecipients,
  normalizeVendorCode,
} = require('./staff-email-directory-service');
const {
  resolveRepartoEmailDelivery,
  buildRepartoMessageId,
  redactDeliverySummary,
} = require('./reparto-email-delivery-policy');

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

/**
 * Resolve client identity for canonical rutero confirmations. The command only
 * carries client fields for cobro flows; plain delivery confirmations need the
 * authoritative ERP document lookup so variance PDFs are complete.
 */
async function resolveDocumentClient(documentId, { query = queryWithParams } = {}) {
  const identity = parseDocumentIdentity(documentId);
  if (!identity) return { codigo: '', nombre: '' };

  const params = [identity.ejercicio, identity.serie, identity.terminal, identity.numero];
  let sql = `
    SELECT TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE,
           TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''),
                         NULLIF(TRIM(CLI.NOMBRECLIENTE), ''),
                         TRIM(CPC.CODIGOCLIENTEALBARAN))) AS NOMBRE_CLIENTE
      FROM DSEDAC.CPC CPC
      LEFT JOIN DSEDAC.CLI CLI
        ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
     WHERE CPC.EJERCICIOALBARAN = ?
       AND TRIM(CPC.SERIEALBARAN) = ?
       AND CPC.TERMINALALBARAN = ?
       AND CPC.NUMEROALBARAN = ?
  `;
  if (identity.cliente) {
    sql += ' AND TRIM(CPC.CODIGOCLIENTEALBARAN) = ?';
    params.push(identity.cliente);
  }
  sql += ' FETCH FIRST 1 ROW ONLY';

  try {
    const rows = await query(sql, params);
    const row = rows?.[0] || {};
    return {
      codigo: normalizeText(row.CLIENTE || row.cliente),
      nombre: normalizeText(row.NOMBRE_CLIENTE || row.nombre_cliente),
    };
  } catch (error) {
    logger.warn(`[variance] client lookup failed for ${documentId}: ${error.message}`);
    return { codigo: '', nombre: '' };
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

  if (!pdfBuffer) {
    return {
      sent: 0,
      results: recipients.map((to) => ({ to, success: false, error: 'pdf unavailable' })),
    };
  }
  const results = [];
  for (const to of recipients) {
    try {
      const result = await sendEmail({
        to,
        subject,
        messageId: buildRepartoMessageId({
          kind: 'variance',
          identity: `${payload.confirmationId || ''}|${payload.documentId || ''}`,
          recipient: to,
        }),
        htmlBody,
        textBody,
        ...(pdfBuffer ? {
          pdfBuffer,
          pdfFilename: `Diferencia_entrega_${String(payload.documentId || 'albaran').replace(/\s+/g, '_')}.pdf`,
        } : {}),
      });
      results.push({ to, success: true, result });
    } catch (error) {
      logger.error(`[variance] email failed recipient=${results.length + 1}/${recipients.length}: ${String(error?.code || error?.message || 'smtp failure').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')}`);
      results.push({ success: false, error: 'smtp failure' });
    }
  }
  return { sent: results.filter((r) => r.success).length, results };
}

function cobroDocumentLabel(cobro = {}) {
  const direct = normalizeText(cobro.documento || cobro.entregaId);
  if (direct) return direct;
  return [
    cobro.tipoDocumento,
    cobro.ejercicioDocumento,
    cobro.serieDocumento,
    cobro.terminalDocumento,
    cobro.numeroDocumento,
  ].map(normalizeText).filter(Boolean).join('-') || 'documento';
}

function buildCobroEmailHtml(payload) {
  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;">
    <div style="background:#003d7a;padding:18px 22px;border-radius:12px 12px 0 0;">
      <h1 style="margin:0;color:#fff;font-size:20px;">Cobro registrado por repartidor</h1>
    </div>
    <div style="background:#f8f9fa;padding:20px 22px;border-radius:0 0 12px 12px;color:#333;">
      <p><strong>Documento:</strong> ${escapeHtml(payload.documento)}</p>
      <p><strong>Cliente:</strong> ${escapeHtml(payload.codigoCliente)} ${escapeHtml(payload.nombreCliente)}</p>
      <p><strong>Repartidor:</strong> ${escapeHtml(payload.repartidorId)}</p>
      <p><strong>Importe:</strong> ${escapeHtml(payload.importe)} EUR</p>
      <p><strong>Forma de pago:</strong> ${escapeHtml(payload.formaPago)}</p>
      <p><strong>Origen:</strong> ${escapeHtml(payload.origen)}</p>
      <p style="margin-top:16px;font-size:11px;color:#888;">Aviso automatico - no responder a este correo.</p>
    </div>
  </div>`;
}

/**
 * After a newly created cobro: notify the driver and liquidacion recipients.
 * Replays and every directory/policy/SMTP failure are non-blocking.
 */
async function notifyAfterCobro({
  cobro,
  result,
} = {}, {
  query = queryWithParams,
  env = process.env,
  sendEmail = sendEmailWithPdf,
  resolveRecipients = resolveLiquidacionRecipients,
  resolveClient = resolveDocumentClient,
} = {}) {
  if (!result?.created || !cobro) {
    return { skipped: true, reason: 'not_created' };
  }

  try {
    const repartidorId = normalizeText(cobro.codigoRepartidor || cobro.repartidorId);
    const identity = normalizeText(
      result.id || result.cobroId || cobro.idempotencyToken,
    );
    if (!repartidorId || !identity) {
      return { skipped: true, reason: 'invalid_identity' };
    }

    const resolution = await resolveRecipients({ repartidorId }, { query, env });
    if ((resolution?.missingRequired || []).length > 0) {
      logger.warn('[cobro-notify] delivery deferred: unresolved required DB recipient');
      return { skipped: true, reason: 'unresolved_recipients' };
    }

    let delivery;
    try {
      delivery = resolveRepartoEmailDelivery({
        recipients: resolution?.emails || [],
        env,
        mode: 'automatic',
      });
    } catch (error) {
      logger.warn(`[cobro-notify] delivery policy rejected message: ${error.code || 'POLICY_REJECTED'}`);
      return { skipped: true, reason: 'policy_rejected' };
    }

    const amount = Number(cobro.importeCobrado);
    const documento = cobroDocumentLabel(cobro);
    // The canonical rutero payment schema carries no client identity, so the
    // receipt PDF and the notification email used to ship an empty Cliente
    // row. Enrich from the authoritative ERP document (CPC + CLI) — same
    // pattern as notifyAfterConfirm. The vencimientos flow already sends
    // both fields and skips the lookup entirely.
    let codigoCliente = normalizeText(cobro.codigoCliente);
    let nombreCliente = normalizeText(cobro.nombreCliente);
    if (!codigoCliente || !nombreCliente) {
      try {
        const resolvedClient = await resolveClient(documento, { query });
        codigoCliente = codigoCliente || normalizeText(resolvedClient?.codigo || resolvedClient?.code);
        nombreCliente = nombreCliente || normalizeText(resolvedClient?.nombre || resolvedClient?.name);
      } catch (error) {
        // A failed enrichment must never block the durable cobro alert.
        logger.warn(`[cobro-notify] client resolve error: ${error.message}`);
      }
    }
    const payload = {
      cobroId: identity,
      documento,
      codigoCliente,
      nombreCliente,
      repartidorId,
      importe: Number.isFinite(amount) ? amount.toFixed(2) : '0.00',
      pendiente: Number.isFinite(Number(cobro.importePendiente))
        ? Number(cobro.importePendiente).toFixed(2)
        : '0.00',
      formaPago: normalizeText(cobro.formaPago),
      origen: normalizeText(cobro.pantallaOrigen) || 'RUTERO',
      registradoAt: new Date().toISOString(),
      notas: normalizeText(cobro.notas),
    };
    const subject = `Cobro ${payload.documento} - ${payload.importe} EUR`;
    const htmlBody = buildCobroEmailHtml(payload);
    const textBody = [
      'ID de cobro: ' + payload.cobroId,
      'Documento: ' + payload.documento,
      ('Cliente: ' + payload.codigoCliente + ' ' + payload.nombreCliente).trim(),
      'Repartidor: ' + payload.repartidorId,
      'Importe: ' + payload.importe + ' EUR',
      'Pendiente tras el cobro: ' + payload.pendiente + ' EUR',
      'Forma de pago: ' + payload.formaPago,
      'Origen: ' + payload.origen,
    ].join('\n');

    const pdfBuffer = await buildCobroPdfBuffer(payload);
    const pdfFilename = buildCobroPdfFileName(payload);
    const results = [];
    for (const to of delivery.effectiveRecipients) {
      try {
        await sendEmail({
          to,
          subject,
          htmlBody,
          textBody,
          pdfBuffer,
          pdfFilename,
          messageId: buildRepartoMessageId({
            kind: 'cobro',
            identity,
            recipient: to,
            env,
          }),
        });
        results.push({ to, success: true });
      } catch (error) {
        logger.error('[cobro-notify] email failed', {
          code: normalizeText(error?.code) || 'SMTP_FAILURE',
        });
        results.push({ success: false });
      }
    }

    return {
      skipped: false,
      ...redactDeliverySummary(results),
    };
  } catch (error) {
    logger.warn('[cobro-notify] notification failed', {
      code: normalizeText(error?.code) || 'NOTIFICATION_FAILURE',
    });
    return { skipped: true, reason: 'notification_failed' };
  }
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
  resolveClient = resolveDocumentClient,
} = {}) {
  if (!result?.created || !command?.delivery) {
    return { skipped: true, reason: 'not_created' };
  }

  const lineas = detectVarianceLines(command.delivery.lineas);
  const deliveryStatus = normalizeText(result.deliveryStatus || command.delivery.status).toUpperCase();
  const isExceptionStatus = ['PARCIAL', 'RECHAZADO', 'NO_ENTREGADO'].includes(deliveryStatus);
  // Exception states are operationally material even for a prepaid 0€ document.
  if (lineas.length === 0 && !isExceptionStatus) {
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

  let clienteCodigo = normalizeText(command.cobro?.codigoCliente);
  let clienteNombre = normalizeText(command.cobro?.nombreCliente);
  if (!clienteCodigo || !clienteNombre) {
    try {
      const resolvedClient = await resolveClient(documentId, { query });
      clienteCodigo = clienteCodigo || normalizeText(resolvedClient?.codigo || resolvedClient?.code);
      clienteNombre = clienteNombre || normalizeText(resolvedClient?.nombre || resolvedClient?.name);
    } catch (error) {
      logger.warn(`[variance] client resolve error: ${error.message}`);
    }
  }
  // An incident notification must remain deliverable even when the ERP document
  // cannot resolve its client row (for example NO_ENTREGADO without lines).
  // Keep the missing identity explicit instead of dropping the durable alert.
  if (!clienteCodigo && !clienteNombre) clienteCodigo = 'NO DISPONIBLE';

  const payload = {
    confirmationId: String(result.confirmationId),
    documentId,
    documentoTipo: 'ALBARAN',
    fecha,
    clienteCodigo,
    clienteNombre,
    repartidorId,
    comercialCode,
    deliveryStatus: normalizeText(result.deliveryStatus || command.delivery.status),
    confirmedAt: normalizeText(result.confirmedAt),
    observaciones: normalizeText(command.delivery.observaciones),
    lineas,
  };

  let outboxId = null;
  try {
    const tables = notificationTables(env);
    const existing = await query(
      `SELECT ID, STATUS
         FROM ${tables.varianceOutbox}
        WHERE CONFIRMATION_ID = ?
        ORDER BY ID
        FETCH FIRST 1 ROW ONLY`,
      [Number(result.confirmationId)],
    );
    if (existing?.length) {
      return {
        skipped: true,
        reason: 'already_enqueued',
        confirmationId: String(result.confirmationId),
      };
    }
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
    // Never send before durable TEST/production app-state enqueue. Confirmation
    // remains successful; a transient DB failure is observable and cannot create
    // an untracked duplicate email.
    return {
      skipped: true,
      reason: 'outbox_unavailable',
      confirmationId: String(result.confirmationId),
    };
  }

  const { emails, details, missingRequired = [] } = await resolveRecipients({ repartidorId, comercialCode }, { query, env });
  const repartidorDetail = details.find((d) => d.label === 'repartidor');
  const comercialDetail = details.find((d) => d.label === 'comercial');
  payload.repartidorNombre = repartidorDetail?.nombre || '';
  payload.comercialNombre = comercialDetail?.nombre || '';

  let delivery;
  if ((missingRequired || []).length > 0 || details.some((detail) => !detail.email)) {
    logger.warn('[variance] delivery deferred: unresolved required DB recipient');
    delivery = { effectiveRecipients: [] };
  } else try {
    delivery = resolveRepartoEmailDelivery({ recipients: emails, env, mode: 'automatic' });
  } catch (error) {
    logger.warn(`[variance] delivery policy rejected message: ${error.code || error.message}`);
    delivery = { effectiveRecipients: [] };
  }
  const sendResult = await sendVarianceEmail(payload, delivery.effectiveRecipients, { sendEmail });
  payload.delivery = redactDeliverySummary(sendResult.results);

  if (outboxId != null) {
    try {
      const tables = notificationTables(env);
      const ok = payload.delivery.allSucceeded;
      if (ok) {
        await query(
          `UPDATE ${tables.varianceOutbox}
              SET STATUS = 'SENT', SENT_AT = CURRENT TIMESTAMP, ERROR = NULL, PAYLOAD_JSON = ?
            WHERE CONFIRMATION_ID = ? AND STATUS = 'PENDING'`,
          [JSON.stringify(payload), outboxId],
        );
      } else {
        await query(
          `UPDATE ${tables.varianceOutbox}
              SET STATUS = 'FAILED', ERROR = ?, PAYLOAD_JSON = ?
            WHERE CONFIRMATION_ID = ? AND STATUS = 'PENDING'`,
          ['No recipients or incomplete send', JSON.stringify(payload), outboxId],
        );
      }
    } catch (error) {
      logger.warn(`[variance] outbox status update failed: ${error.message}`);
    }
  }

  return { skipped: false, lineCount: lineas.length, ...sendResult, outboxId };
}

function previousMadridIsoDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const previous = new Date(Date.UTC(year, month - 1, day) - 24 * 60 * 60 * 1000);
  const y = previous.getUTCFullYear();
  const m = String(previous.getUTCMonth() + 1).padStart(2, '0');
  const d = String(previous.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Daily digest: previous Europe/Madrid day, plus any earlier digest still awaiting
 * a fully successful delivery.
 */
async function sendDailyVarianceDigest({
  query = queryWithParams,
  env = process.env,
  sendEmail = sendHtmlEmail,
  resolveRecipients = resolveDeliveryVarianceRecipients,
  digestDate = previousMadridIsoDate(),
} = {}) {
  const tables = notificationTables(env);
  const sql = `
    SELECT ID, CONFIRMATION_ID, DOCUMENT_ID, REPARTIDOR_ID, COMERCIAL_CODE,
           PAYLOAD_JSON, STATUS, CREATED_AT, SENT_AT
      FROM ${tables.varianceOutbox}
     WHERE DIGEST_INCLUDED = 'N'
       AND (
         DATE(CREATED_AT) = ?
         OR (SENT_AT IS NOT NULL AND DATE(SENT_AT) = ?)
         OR STATUS IN ('PENDING', 'FAILED')
       )
       AND STATUS IN ('PENDING', 'SENT', 'FAILED')
     ORDER BY CREATED_AT
  `;
  let rows = [];
  try {
    rows = await query(sql, [digestDate, digestDate]);
  } catch (error) {
    logger.error(`[variance] digest query failed: ${error.message}`);
    throw error;
  }

  if (!rows.length) {
    logger.info(`[variance] digest: nothing to send for ${digestDate}`);
    return { sent: 0, items: 0, digestDate };
  }

  const items = rows.map((row) => ({
    id: rowValue(row, 'ID'),
    documentId: normalizeText(rowValue(row, 'DOCUMENT_ID')),
    repartidorId: normalizeText(rowValue(row, 'REPARTIDOR_ID')),
    comercialCode: normalizeVendorCode(rowValue(row, 'COMERCIAL_CODE')),
    createdAt: normalizeText(rowValue(row, 'CREATED_AT')),
    payload: safeJson(rowValue(row, 'PAYLOAD_JSON')),
  }));

  const emails = new Set();
  const missingRequired = new Set();
  let recipientResolutionFailed = false;
  function addResolution(resolution) {
    for (const email of resolution?.emails || []) emails.add(String(email).toLowerCase());
    for (const label of resolution?.missingRequired || []) missingRequired.add(String(label));
  }
  try {
    const roleRecipients = await resolveRecipients({}, { query, env });
    addResolution(roleRecipients);
    const driverCodes = [...new Set(items.map((item) => normalizeVendorCode(item.repartidorId)).filter(Boolean))];
    const comercialCodes = [...new Set(items.map((item) => normalizeVendorCode(item.comercialCode)).filter(Boolean))];
    // The directory has no batch recipient API. Resolve each unique vendor once,
    // never once per outbox row, retaining its cache and ERP fallback behavior.
    for (const code of driverCodes) {
      const extra = await resolveRecipients({ repartidorId: code }, { query, env });
      addResolution(extra);
    }
    for (const code of comercialCodes) {
      const extra = await resolveRecipients({ comercialCode: code }, { query, env });
      addResolution(extra);
    }
  } catch (error) {
    logger.error(`[variance] digest recipient resolution failed: ${error.message}`);
    recipientResolutionFailed = true;
  }

  const subject = `Resumen diario diferencias entrega ${digestDate} (${items.length})`;
  const htmlBody = buildDigestEmailHtml(items);
  const textBody = items.map((item) => (
    `${item.documentId} rep=${item.repartidorId} com=${item.comercialCode || ''} lines=${(item.payload.lineas || []).length}`
  )).join('\n');

  let delivery;
  const recipientFailureCount = missingRequired.size + (recipientResolutionFailed ? 1 : 0);
  if (recipientFailureCount > 0) {
    logger.warn(`[variance] digest delivery deferred: unresolved required DB recipients=${missingRequired.size}`);
    delivery = { effectiveRecipients: [] };
  } else try {
    delivery = resolveRepartoEmailDelivery({ recipients: [...emails], env, mode: 'automatic' });
  } catch (error) {
    logger.warn(`[variance] digest delivery policy rejected message: ${error.code || error.message}`);
    delivery = { effectiveRecipients: [] };
  }
  const results = [];
  const digestIdentity = `${digestDate}|${items.map((item) => item.id).filter((id) => id != null).sort().join(',')}`;
  for (const to of delivery.effectiveRecipients || []) {
    try {
      const result = await sendEmail({
        to, subject, htmlBody, textBody,
        messageId: buildRepartoMessageId({ kind: 'variance-digest', identity: digestIdentity, recipient: to, env }),
      });
      results.push({ to, success: true, result });
    } catch (error) {
      logger.error(`[variance] digest email failed recipient=${results.length + 1}/${delivery.effectiveRecipients.length}: ${String(error?.code || error?.message || 'smtp failure').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')}`);
      results.push({ to, success: false });
    }
  }
  const deliverySummary = redactDeliverySummary(results);

  const ids = items.map((item) => item.id).filter((id) => id != null);
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(', ');
    try {
      if (deliverySummary.allSucceeded) {
        await query(
          `UPDATE ${tables.varianceOutbox} SET DIGEST_INCLUDED = 'S', ERROR = NULL WHERE ID IN (${placeholders})`,
          ids,
        );
      } else {
        const error = recipientFailureCount > 0
          ? `Digest pending: unresolved recipients (${recipientFailureCount})`
          : `Digest pending: ${deliverySummary.sent}/${deliverySummary.attempted} delivered`;
        await query(
          `UPDATE ${tables.varianceOutbox} SET ERROR = ? WHERE ID IN (${placeholders})`,
          [error, ...ids],
        );
      }
    } catch (error) {
      logger.error(`[variance] digest mark failed: ${error.message}`);
    }
  }

  logger.info(`[variance] digest sent=${deliverySummary.sent} items=${items.length} date=${digestDate}`);
  return {
    sent: deliverySummary.sent,
    items: items.length,
    digestDate,
    delivery: deliverySummary,
    unresolvedRecipients: recipientFailureCount,
  };
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
  previousMadridIsoDate,
  resolveDocumentComercialCode,
  resolveDocumentClient,
  notifyAfterCobro,
  notifyAfterConfirm,
  sendDailyVarianceDigest,
  enqueueVarianceOutbox,
  sendVarianceEmail,
};
