// email_notification.js: Envío de resumen KPI por email tras cada ETL exitoso
'use strict';

const nodemailer = require('nodemailer');
const logger = require('../../middleware/logger');

const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || 'mail.mari-pepa.com',
  port: parseInt(process.env.SMTP_PORT || '465', 10),
  secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1' || parseInt(process.env.SMTP_PORT || '465') === 465,
  auth: {
    user: process.env.SMTP_USER || 'noreply@mari-pepa.com',
    pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '6pVyRf3xptxiN3i',
  },
  connectionTimeout: 10000,
  greetingTimeout: 8000,
  socketTimeout: 15000,
  tls: { rejectUnauthorized: false, minVersion: 'TLSv1.2' },
};

const FROM_EMAIL = process.env.SMTP_FROM || 'noreply@mari-pepa.com';
const FROM_NAME = 'GMP - KPI Glacius';

let transporter = null;
let transporterHealthy = false;

function invalidateTransporter() {
  if (transporter) {
    try { transporter.close(); } catch (e) { /* ignore */ }
  }
  transporter = null;
  transporterHealthy = false;
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport(SMTP_CONFIG);
  }
  return transporter;
}

/**
 * Envía el resumen KPI tras un ETL exitoso.
 * @param {string[]} recipients - Lista de emails destino
 * @param {object} etlResult - Resultado del ETL {loadId, totalAlerts, fileResults}
 * @param {object} summary - Resumen por tipo/severidad desde DB
 */
async function sendKpiDigest(recipients, etlResult, summary) {
  if (!recipients || recipients.length === 0) {
    logger.info('[kpi:email] Sin destinatarios configurados, omitiendo email');
    return;
  }

  if (!SMTP_CONFIG.auth.pass) {
    logger.warn('[kpi:email] SMTP_PASS no configurado, omitiendo email');
    return;
  }

  const html = buildDigestHtml(etlResult, summary);
  const subject = `KPI Glacius ${etlResult.loadId} — ${etlResult.totalAlerts} alertas (${formatDate()})`;

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const info = await getTransporter().sendMail({
        from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
        to: recipients.join(', '),
        subject,
        html,
      });
      logger.info(`[kpi:email] ✅ Resumen enviado: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      const isTimeout = ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(err.code);
      const isConnection = ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'TIMEOUT'].includes(err.code);

      if (isTimeout || isConnection) {
        invalidateTransporter();
        logger.warn(`[kpi:email] ⚠️ Error conexión (intento ${attempt}/${maxRetries}): ${err.code}`);
      } else {
        logger.error(`[kpi:email] ❌ Error enviando resumen: ${err.message}`);
        return { success: false, error: err.message };
      }

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  logger.error('[kpi:email] ❌ Fallido tras 3 intentos');
  return { success: false, error: 'Timeout SMTP tras múltiples intentos' };
}

function formatDate() {
  return new Date().toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Europe/Madrid',
  });
}

function fmtNum(n) {
  if (n === null || n === undefined) return '0';
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function buildDigestHtml(etlResult, summary) {
  const { loadId, totalAlerts, fileResults } = etlResult;

  // Agrupar summary por tipo
  const byType = {};
  let totalCritical = 0, totalWarning = 0, totalInfo = 0;
  for (const row of (summary || [])) {
    const type = row.ALERT_TYPE || row.alertType;
    const sev = row.SEVERITY || row.severity;
    const cnt = parseInt(row.CNT || row.count || 0);
    if (!byType[type]) byType[type] = { critical: 0, warning: 0, info: 0, total: 0 };
    byType[type][sev] = cnt;
    byType[type].total += cnt;
    if (sev === 'critical') totalCritical += cnt;
    if (sev === 'warning') totalWarning += cnt;
    if (sev === 'info') totalInfo += cnt;
  }

  const typeLabels = {
    DESVIACION_VENTAS: 'Desviacion Ventas',
    CUOTA_SIN_COMPRA: 'Cuota Sin Compra',
    DESVIACION_REFERENCIACION: 'Referenciacion',
    PROMOCION: 'Promociones',
    ALTA_CLIENTE: 'Clientes Nuevos',
    AVISO: 'Avisos',
    MEDIOS_CLIENTE: 'Equipamiento',
  };

  const typeRows = Object.entries(byType).map(([type, counts]) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;font-weight:600">${typeLabels[type] || type}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;text-align:center;color:#d32f2f;font-weight:bold">${counts.critical || '-'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;text-align:center;color:#f57c00;font-weight:bold">${counts.warning || '-'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;text-align:center;color:#1976d2">${counts.info || '-'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;text-align:center;font-weight:bold">${fmtNum(counts.total)}</td>
    </tr>
  `).join('');

  const fileRows = (fileResults || []).map(f => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px">${f.name}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;font-size:13px">${fmtNum(f.rowsParsed)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;font-size:13px">${fmtNum(f.alertsGenerated)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;font-size:13px;color:${f.parseErrors?.length > 0 ? '#d32f2f' : '#4caf50'}">${f.parseErrors?.length || 0}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f5f5f5;padding:20px;margin:0">
<div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.1)">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1a237e,#283593);color:#fff;padding:24px 32px">
    <h1 style="margin:0;font-size:22px">Resumen KPI Glacius/Nestle</h1>
    <p style="margin:6px 0 0;opacity:0.85;font-size:14px">Carga ${loadId} — ${formatDate()}</p>
  </div>

  <!-- Summary cards -->
  <div style="display:flex;padding:20px 24px;gap:12px">
    <div style="flex:1;background:#ffebee;border-radius:8px;padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:#d32f2f">${fmtNum(totalCritical)}</div>
      <div style="font-size:12px;color:#b71c1c;text-transform:uppercase;letter-spacing:1px">Criticas</div>
    </div>
    <div style="flex:1;background:#fff3e0;border-radius:8px;padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:#f57c00">${fmtNum(totalWarning)}</div>
      <div style="font-size:12px;color:#e65100;text-transform:uppercase;letter-spacing:1px">Warning</div>
    </div>
    <div style="flex:1;background:#e3f2fd;border-radius:8px;padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:#1976d2">${fmtNum(totalInfo)}</div>
      <div style="font-size:12px;color:#0d47a1;text-transform:uppercase;letter-spacing:1px">Info</div>
    </div>
    <div style="flex:1;background:#e8eaf6;border-radius:8px;padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:bold;color:#283593">${fmtNum(totalAlerts)}</div>
      <div style="font-size:12px;color:#1a237e;text-transform:uppercase;letter-spacing:1px">Total</div>
    </div>
  </div>

  <!-- By type table -->
  <div style="padding:0 24px 20px">
    <h2 style="font-size:16px;color:#333;margin:0 0 12px">Desglose por tipo de alerta</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead>
        <tr style="background:#f5f5f5">
          <th style="padding:10px 12px;text-align:left">Tipo</th>
          <th style="padding:10px 12px;text-align:center;color:#d32f2f">Critica</th>
          <th style="padding:10px 12px;text-align:center;color:#f57c00">Warning</th>
          <th style="padding:10px 12px;text-align:center;color:#1976d2">Info</th>
          <th style="padding:10px 12px;text-align:center">Total</th>
        </tr>
      </thead>
      <tbody>
        ${typeRows}
      </tbody>
    </table>
  </div>

  <!-- Files processed -->
  <div style="padding:0 24px 20px">
    <h2 style="font-size:16px;color:#333;margin:0 0 12px">Archivos procesados</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f5f5f5">
          <th style="padding:8px 10px;text-align:left">Archivo</th>
          <th style="padding:8px 10px;text-align:center">Filas</th>
          <th style="padding:8px 10px;text-align:center">Alertas</th>
          <th style="padding:8px 10px;text-align:center">Errores</th>
        </tr>
      </thead>
      <tbody>
        ${fileRows}
      </tbody>
    </table>
  </div>

  <!-- Footer -->
  <div style="background:#f5f5f5;padding:16px 24px;text-align:center;font-size:12px;color:#666">
    Generado automaticamente por GMP App Mobilidad — ETL Glacius
  </div>

</div>
</body>
</html>`;
}

/**
 * Obtiene los destinatarios configurados para notificaciones KPI.
 * Formato env: KPI_EMAIL_RECIPIENTS=email1@x.com,email2@x.com
 */
function getConfiguredRecipients() {
  const raw = process.env.KPI_EMAIL_RECIPIENTS || '';
  return raw.split(',').map(e => e.trim()).filter(e => e.length > 0 && e.includes('@'));
}

module.exports = { sendKpiDigest, getConfiguredRecipients };
