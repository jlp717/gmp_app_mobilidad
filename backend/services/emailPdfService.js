/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * EMAIL PDF SERVICE - Envío de PDFs por email server-side
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Servicio reutilizable para enviar emails con PDFs adjuntos
 * usando Nodemailer. Comparte infraestructura SMTP con emailService.
 *
 * Usado por:
 *   - Facturas de Clientes
 *   - Histórico de Repartidores
 *   - Rutero de Repartidores
 */

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const logger = require('../middleware/logger');
const { smtpLogger, isSmtpDebugEnabled } = require('./smtpLogger');

function redactEmailForLog(value) {
    const email = String(value || '').trim();
    const at = email.indexOf('@');
    if (at <= 0 || at === email.length - 1) return '[redacted-email]';
    return `${email.slice(0, 1)}***${email.slice(at)}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIGURACIÓN SMTP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Primary SMTP config — prefer SMTP_PDF_* vars (explicit PDF config), fall back to SMTP_*
const _smtpHost = process.env.SMTP_PDF_HOST || process.env.SMTP_HOST || 'mail.mari-pepa.com';
const _smtpPort = parseInt(process.env.SMTP_PDF_PORT || process.env.SMTP_PORT) || 587;
const _smtpSecure = (process.env.SMTP_PDF_SECURE || process.env.SMTP_SECURE) === 'true' || _smtpPort === 465;
const _smtpUser = process.env.SMTP_PDF_USER || process.env.SMTP_USER || 'noreply@mari-pepa.com';
const _smtpPass = process.env.SMTP_PDF_PASS || process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '';
const _allowInsecureSmtpTls = process.env.NODE_ENV === 'test'
    && String(process.env.SMTP_PDF_ALLOW_INSECURE_TLS || '').trim().toLowerCase() === 'true';

const SMTP_CONFIG = {
    host: _smtpHost,
    port: _smtpPort,
    secure: _smtpSecure,
    auth: {
        user: _smtpUser,
        pass: _smtpPass
    },
    connectionTimeout: parseInt(process.env.SMTP_PDF_CONNECTION_TIMEOUT) || 30000,
    greetingTimeout: parseInt(process.env.SMTP_PDF_GREETING_TIMEOUT) || 25000,
    socketTimeout: parseInt(process.env.SMTP_PDF_SOCKET_TIMEOUT) || 45000,
    tls: {
        rejectUnauthorized: !_allowInsecureSmtpTls
    },
    logger: smtpLogger,
    debug: isSmtpDebugEnabled()
};

// Fallback ports to try when primary fails (in order)
const SMTP_FALLBACK_PORTS = [587, 2525];

// Maximum number of retry attempts
const MAX_RETRIES = SMTP_FALLBACK_PORTS.length + 1; // Primary + fallbacks

function buildFallbackConfig(port) {
    return { ...SMTP_CONFIG, port, secure: port === 465, pool: false };
}

const FROM_EMAIL = process.env.SMTP_FROM || 'noreply@mari-pepa.com';
const FROM_NAME = process.env.SMTP_FROM_NAME || 'Granja Mari Pepa';
const REPLY_TO = process.env.SMTP_REPLY_TO || 'pedidos@mari-pepa.com';
const COMPANY_WEB = 'https://www.mari-pepa.com';
const COMPANY_PHONE_MOBILE = '639 77 86 55';
const COMPANY_PHONE_LAND = '968 46 75 14';
const COMPANY_ADDRESS =
  'Pol. Ind. Saprelorca-Parcela D-3, Avda. Francisco Gimeno Sola, 3, 30817 Lorca (Murcia)';
const COMPANY_RGSEAA = '40.01715/MU';
const LOGO_CID = 'mari-pepa-logo@mari-pepa.com';

let transporter = null;
let transporterHealthy = false;
let cachedLogoAttachment = undefined;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveBrandLogoPath() {
  const fromEnv = String(process.env.SMTP_BRAND_LOGO_PATH || '').trim();
  const candidates = [
    fromEnv,
    path.join(__dirname, '../assets/branding/email_header.png'),
    path.join(__dirname, '../../assets/branding/ticket_header.png'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore path probe errors
    }
  }
  return null;
}

function getBrandLogoAttachment() {
  if (cachedLogoAttachment !== undefined) return cachedLogoAttachment;
  const logoPath = resolveBrandLogoPath();
  if (!logoPath) {
    cachedLogoAttachment = null;
    return null;
  }
  try {
    cachedLogoAttachment = {
      filename: 'mari-pepa-header.png',
      path: logoPath,
      cid: LOGO_CID,
      contentType: 'image/png',
      contentDisposition: 'inline',
    };
    return cachedLogoAttachment;
  } catch (error) {
    logger.warn(`Email brand logo unavailable: ${error.message}`);
    cachedLogoAttachment = null;
    return null;
  }
}

function buildCorporateMailHeaders() {
  return {
    'List-Unsubscribe': `<mailto:${REPLY_TO}?subject=baja>, <${COMPANY_WEB}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'X-Auto-Response-Suppress': 'OOF, AutoReply',
    'X-Mailer': 'GMP Mobilidad',
    Organization: FROM_NAME,
  };
}

function corporateFooterHtml() {
  return `
    <hr style="border: none; border-top: 1px solid #dde3ea; margin: 28px 0 16px 0;">
    <p style="font-size: 12px; color: #4a5568; line-height: 1.55; margin: 0 0 8px 0;">
      <strong style="color: #1a2b3c;">${escapeHtml(FROM_NAME)}</strong><br>
      Mari Pepa Food &amp; Frozen — Congelados y refrigerados para hostelería<br>
      ${escapeHtml(COMPANY_ADDRESS)}
    </p>
    <p style="font-size: 12px; color: #4a5568; line-height: 1.55; margin: 0 0 8px 0;">
      Pedidos: <a href="mailto:${escapeHtml(REPLY_TO)}" style="color: #0b5cab; text-decoration: none;">${escapeHtml(REPLY_TO)}</a>
      &nbsp;|&nbsp; Móvil/WhatsApp: ${escapeHtml(COMPANY_PHONE_MOBILE)}
      &nbsp;|&nbsp; Fijo: ${escapeHtml(COMPANY_PHONE_LAND)}<br>
      <a href="${COMPANY_WEB}" style="color: #0b5cab; text-decoration: none;">www.mari-pepa.com</a>
      &nbsp;|&nbsp; RGSEAA: ${escapeHtml(COMPANY_RGSEAA)}
    </p>
    <p style="font-size: 11px; color: #8896a6; line-height: 1.45; margin: 12px 0 0 0;">
      Este mensaje es un envío corporativo de ${escapeHtml(FROM_NAME)}.
      Si no esperaba este correo, puede ignorarlo o escribir a ${escapeHtml(REPLY_TO)}.
    </p>
  `;
}

function corporateShellHtml({ title, accentFrom, accentTo, bodyHtml }) {
  const logo = getBrandLogoAttachment();
  const headerInner = logo
    ? `<img src="cid:${LOGO_CID}" alt="${escapeHtml(FROM_NAME)}" width="560" style="max-width:100%; height:auto; display:block; margin:0 auto 12px auto; border:0;">`
    : `<p style="color: rgba(255,255,255,0.92); margin: 0 0 4px 0; font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase;">Mari Pepa Food &amp; Frozen</p>`;
  return `
    <div style="margin:0; padding:0; background:#eef2f6;">
      <div style="font-family: 'Segoe UI', Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px 12px;">
        <div style="background: linear-gradient(135deg, ${accentFrom} 0%, ${accentTo} 100%); padding: 20px 20px 16px 20px; border-radius: 12px 12px 0 0; text-align: center;">
          ${headerInner}
          <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 700; line-height: 1.3;">${title}</h1>
        </div>
        <div style="background: #ffffff; padding: 28px 24px; border-radius: 0 0 12px 12px; border: 1px solid #e3e8ef; border-top: none;">
          ${bodyHtml}
          ${corporateFooterHtml()}
        </div>
      </div>
    </div>
  `;
}

function htmlUsesBrandLogo(html) {
  return typeof html === 'string' && html.includes('cid:' + LOGO_CID);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INICIALIZACIÓN Y HEALTH CHECK
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Invalidar transporter actual (forzar reconexión en próximo envío)
 */
function invalidateTransporter() {
    if (transporter) {
        try {
            transporter.close();
        } catch (e) {
            // Ignorar errores al cerrar
        }
    }
    transporter = null;
    transporterHealthy = false;
    logger.debug('Transporter invalidado, se recreará en próximo envío');
}

function getTransporter() {
    if (!transporter) {
        transporter = nodemailer.createTransport(SMTP_CONFIG);
        logger.info(`EmailPdfService: Transporter SMTP inicializado`, {
            host: SMTP_CONFIG.host,
            port: SMTP_CONFIG.port
        });
    }
    return transporter;
}

/**
 * Verificar estado de conexión SMTP
 */
async function verifySmtpConnection() {
    if (transporterHealthy && transporter) {
        return true;
    }

    try {
        const transport = getTransporter();
        await transport.verify();
        transporterHealthy = true;
        logger.debug('SMTP connection verified');
        return true;
    } catch (error) {
        transporterHealthy = false;
        logger.warn(`SMTP verification failed: ${error.message}`);
        return false;
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CACHÉ DE PDFs EN MEMORIA (TTL = 5 minutos, MAX 50 items)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const pdfCache = new Map();
const PDF_CACHE_TTL = 5 * 60 * 1000; // 5 minutos
const PDF_CACHE_MAX_ITEMS = 50; // Límite máximo para evitar memory leak

/**
 * Almacenar PDF en caché temporal
 * @param {string} key - Clave única (e.g. "factura_FAV_123_2026")
 * @param {Buffer} buffer - El PDF generado
 */
function cachePdf(key, buffer) {
    // Si el caché está lleno, eliminar el 20% más antiguo (LRU)
    if (pdfCache.size >= PDF_CACHE_MAX_ITEMS) {
        const toDelete = [...pdfCache.keys()].slice(0, Math.ceil(PDF_CACHE_MAX_ITEMS * 0.2));
        toDelete.forEach(k => pdfCache.delete(k));
        logger.debug(`PDF cache lleno, eliminados ${toDelete.length} items antiguos`);
    }

    pdfCache.set(key, {
        buffer,
        timestamp: Date.now()
    });

    // Limpiar entradas expiradas cada vez que se añade una nueva
    for (const [k, v] of pdfCache.entries()) {
        if (Date.now() - v.timestamp > PDF_CACHE_TTL) {
            pdfCache.delete(k);
        }
    }

    logger.debug(`PDF cached: ${key} (${(buffer.length / 1024).toFixed(1)} KB, ${pdfCache.size} items)`);
}

/**
 * Obtener PDF de caché
 * @param {string} key - Clave única
 * @returns {Buffer|null}
 */
function getCachedPdf(key) {
    const entry = pdfCache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > PDF_CACHE_TTL) {
        pdfCache.delete(key);
        return null;
    }

    logger.info(`PDF cache HIT: ${key}`);
    return entry.buffer;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENVÍO DE EMAIL CON PDF
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Enviar email con PDF adjunto
 * @param {Object} params
 * @param {string} params.to - Email destinatario
 * @param {string} params.subject - Asunto del email
 * @param {string} [params.htmlBody] - Cuerpo HTML del email
 * @param {string} [params.textBody] - Cuerpo texto plano
 * @param {Buffer} params.pdfBuffer - Buffer del PDF a adjuntar
 * @param {string} params.pdfFilename - Nombre del archivo PDF
 * @returns {Promise<{success: boolean, messageId: string}>}
 */
async function sendEmailWithPdf({ to, subject, htmlBody, textBody, pdfBuffer, pdfFilename, messageId }) {
    // Validación de inputs
    if (!to || typeof to !== 'string') {
        throw new Error('Destinatario (to) es requerido');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
        throw new Error('Email destinatario inválido');
    }

    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
        throw new Error('PDF buffer es requerido');
    }

    if (!pdfFilename) {
        throw new Error('Nombre del archivo PDF es requerido');
    }

    // Ports to try: [primaryPort, ...fallbackPorts]
    const portsToTry = [SMTP_CONFIG.port, ...SMTP_FALLBACK_PORTS.filter(p => p !== SMTP_CONFIG.port)];
    let lastError;
    let lastAttempt = 0; // Captured for use outside loop

    for (let attempt = 0; attempt < portsToTry.length; attempt++) {
        lastAttempt = attempt;
        const currentPort = portsToTry[attempt];
        try {
            const transport = attempt === 0
                ? getTransporter()
                : nodemailer.createTransport(buildFallbackConfig(currentPort));

            const defaultHtml = corporateShellHtml({
                title: 'Documento adjunto',
                accentFrom: '#003d7a',
                accentTo: '#1a5490',
                bodyHtml: `
                  <p style="font-size: 15px; color: #1a2b3c; line-height: 1.6; margin: 0 0 12px 0;">
                    Estimado/a cliente,
                  </p>
                  <p style="font-size: 14px; color: #3d4f63; line-height: 1.6; margin: 0 0 16px 0;">
                    Adjunto encontrará el documento <strong>${escapeHtml(pdfFilename)}</strong>
                    enviado desde la aplicación corporativa de ${escapeHtml(FROM_NAME)}.
                  </p>
                  <div style="background: #eef6fc; padding: 14px 16px; border-radius: 8px; border-left: 4px solid #1a5490;">
                    <p style="font-size: 13px; color: #0b5cab; font-weight: 600; margin: 0;">
                      ${escapeHtml(pdfFilename)} (${(pdfBuffer.length / 1024).toFixed(0)} KB)
                    </p>
                  </div>
                `,
            });

            const effectiveHtml = htmlBody || defaultHtml;
            const logoAttachment = htmlUsesBrandLogo(effectiveHtml)
                ? getBrandLogoAttachment()
                : null;
            const mailOptions = {
                from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
                replyTo: REPLY_TO,
                to: to,
                subject: subject || `Documento - ${FROM_NAME}`,
                html: effectiveHtml,
                text: textBody || [
                    `${FROM_NAME}`,
                    '',
                    `Adjunto: ${pdfFilename}`,
                    '',
                    `Pedidos: ${REPLY_TO}`,
                    `Tel: ${COMPANY_PHONE_MOBILE} / ${COMPANY_PHONE_LAND}`,
                    COMPANY_WEB,
                    `RGSEAA: ${COMPANY_RGSEAA}`,
                ].join('\n'),
                headers: buildCorporateMailHeaders(),
                attachments: [
                    ...(logoAttachment ? [logoAttachment] : []),
                    {
                        filename: pdfFilename,
                        content: pdfBuffer,
                        contentType: 'application/pdf'
                    }
                ]
            };
            if (messageId !== undefined) {
                if (typeof messageId !== 'string' || /[\r\n]/.test(messageId) || !/^<[^<>\s]+@[^<>\s]+>$/.test(messageId)) {
                    throw new Error('Message-ID inválido');
                }
                mailOptions.messageId = messageId;
            }

            // Log solo en intento 1, reintentos como debug
            if (attempt === 0) {
                logger.info(`Enviando email a ${redactEmailForLog(to)}...`, { subject, pdfFilename });
            } else {
                logger.debug(`Reintento email a ${redactEmailForLog(to)} (intento ${attempt + 1}/${MAX_RETRIES})...`);
            }

            const info = await transport.sendMail(mailOptions);

            logger.info('✅ Email enviado correctamente', {
                to: redactEmailForLog(to),
                subject,
                pdfSize: `${(pdfBuffer.length / 1024).toFixed(1)} KB`,
                messageId: info.messageId
            });

            return { success: true, messageId: info.messageId };
        } catch (error) {
            lastError = error;

            // Clasificar tipo de error para decidir acción
            const isTimeout = ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(error.code);
            const isConnection = ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'CONNECTION', 'TIMEOUT'].includes(error.code);
            const isAuth = error.code === 'EAUTH';

            if (isTimeout || isConnection) {
                // Timeout o conexión caída → intentar siguiente puerto
                invalidateTransporter();
                if (attempt + 1 < portsToTry.length) {
                    logger.warn(`⚠️ Puerto ${currentPort} SMTP con error (${error.code}), reintentando con puerto ${portsToTry[attempt + 1]}...`);
                } else {
                    logger.warn(`⚠️ Error conexión en todos los puertos (intento ${attempt + 1}/${portsToTry.length}): ${error.code}`, { to: redactEmailForLog(to) });
                }
            } else if (isAuth) {
                // Error autenticación → NO reintentar, es irrecuperable
                logger.error('❌ Error autenticación SMTP (credenciales inválidas)', {
                    user: redactEmailForLog(SMTP_CONFIG.auth.user)
                });
                throw new Error('Error de autenticación SMTP. Verifica las credenciales del servidor de correo.');
            } else {
                logger.warn(`⚠️ Error email (intento ${attempt + 1}/${MAX_RETRIES}): ${error.code} - ${error.message}`, { to: redactEmailForLog(to) });
            }

            // Reintentar con siguiente puerto si no es error de auth
            if (!isAuth && attempt + 1 < portsToTry.length) {
                const delay = (attempt + 1) * 1000;
                logger.debug(`Esperando ${delay}ms antes de reintentar en puerto ${portsToTry[attempt + 1]}...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                break; // auth error o sin más puertos
            }
        }
    }

    // Todos los reintentos fallaron
    const errorCode = lastError?.code || 'UNKNOWN';
    const isTimeoutError = ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'CONNECTION', 'TIMEOUT'].includes(errorCode);
    const triedPorts = portsToTry.slice(0, lastAttempt).join(', ');

    let userFriendlyMessage = lastError?.message || 'Error desconocido enviando email';
    if (isTimeoutError) {
        userFriendlyMessage = `Timeout conectando al servidor de correo (${SMTP_CONFIG.host}, puertos ${triedPorts}). Verifica que el servidor SMTP está accesible desde el VPS.`;
    }

    logger.error(`❌ Email fallido tras ${MAX_RETRIES} intentos`, {
        to: redactEmailForLog(to),
        pdfFilename,
        errorCode,
        message: userFriendlyMessage
    });

    throw new Error(userFriendlyMessage);
}

/**
 * HTML email without PDF attachment (variance alerts / digests).
 * Shares SMTP transporter + port fallback with sendEmailWithPdf.
 */
async function sendHtmlEmail({ to, subject, htmlBody, textBody, messageId }) {
    if (!to || typeof to !== 'string') {
        throw new Error('Destinatario (to) es requerido');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
        throw new Error('Email destinatario inválido');
    }

    if (!htmlBody && !textBody) {
        throw new Error('htmlBody o textBody es requerido');
    }

    const portsToTry = [SMTP_CONFIG.port, ...SMTP_FALLBACK_PORTS.filter((p) => p !== SMTP_CONFIG.port)];
    let lastError;
    let lastAttempt = 0;

    for (let attempt = 0; attempt < portsToTry.length; attempt++) {
        lastAttempt = attempt;
        const currentPort = portsToTry[attempt];
        try {
            const transport = attempt === 0
                ? getTransporter()
                : nodemailer.createTransport(buildFallbackConfig(currentPort));

            const logoAttachment = htmlUsesBrandLogo(htmlBody) ? getBrandLogoAttachment() : null;
            const mailOptions = {
                from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
                replyTo: REPLY_TO,
                to,
                subject: subject || `Aviso - ${FROM_NAME}`,
                html: htmlBody || undefined,
                text: textBody || 'Aviso GMP',
                headers: buildCorporateMailHeaders(),
                attachments: logoAttachment ? [logoAttachment] : [],
            };
            if (messageId !== undefined) {
                if (typeof messageId !== 'string' || /[\r\n]/.test(messageId) || !/^<[^<>\s]+@[^<>\s]+>$/.test(messageId)) {
                    throw new Error('Message-ID inválido');
                }
                mailOptions.messageId = messageId;
            }

            if (attempt === 0) {
                logger.info(`Enviando email HTML a ${redactEmailForLog(to)}...`, { subject });
            } else {
                logger.debug(`Reintento email HTML a ${redactEmailForLog(to)} (intento ${attempt + 1}/${MAX_RETRIES})...`);
            }

            const info = await transport.sendMail(mailOptions);
            logger.info('✅ Email HTML enviado correctamente', { to: redactEmailForLog(to), subject, messageId: info.messageId });
            return { success: true, messageId: info.messageId };
        } catch (error) {
            lastError = error;
            const isTimeout = ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(error.code);
            const isConnection = ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'CONNECTION', 'TIMEOUT'].includes(error.code);
            const isAuth = error.code === 'EAUTH';

            if (isTimeout || isConnection) {
                invalidateTransporter();
            } else if (isAuth) {
                throw new Error('Error de autenticación SMTP. Verifica las credenciales del servidor de correo.');
            }

            if (!isAuth && attempt + 1 < portsToTry.length) {
                await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
            } else {
                break;
            }
        }
    }

    const errorCode = lastError?.code || 'UNKNOWN';
    const isTimeoutError = ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'CONNECTION', 'TIMEOUT'].includes(errorCode);
    const triedPorts = portsToTry.slice(0, Math.max(1, lastAttempt + 1)).join(', ');
    let userFriendlyMessage = lastError?.message || 'Error desconocido enviando email';
    if (isTimeoutError) {
        userFriendlyMessage = `Timeout conectando al servidor de correo (${SMTP_CONFIG.host}, puertos ${triedPorts}).`;
    }
    logger.error(`❌ Email HTML fallido tras ${MAX_RETRIES} intentos`, { to: redactEmailForLog(to), errorCode, message: userFriendlyMessage });
    throw new Error(userFriendlyMessage);
}

/**
 * Generar HTML personalizado para facturas
 */
function generateInvoiceEmailHtml({ serie, numero, fecha, total, clienteNombre, customBody }) {
    const safeSerie = escapeHtml(serie);
    const safeNumero = escapeHtml(numero);
    const safeCliente = escapeHtml(clienteNombre || 'cliente');
    const safeFecha = escapeHtml(fecha || '');
    const title = `Factura ${safeSerie}-${safeNumero}`;

    let bodyHtml;
    if (customBody) {
        bodyHtml = `
          <p style="font-size: 14px; color: #3d4f63; line-height: 1.8; white-space: pre-line; margin: 0;">
            ${escapeHtml(customBody)}
          </p>
        `;
    } else {
        bodyHtml = `
          <p style="font-size: 15px; color: #1a2b3c; margin: 0 0 12px 0;">
            Estimado/a <strong>${safeCliente}</strong>,
          </p>
          <p style="font-size: 14px; color: #3d4f63; line-height: 1.6; margin: 0 0 12px 0;">
            Adjunto le remitimos la factura <strong>${safeSerie}-${safeNumero}</strong>
            emitida por ${escapeHtml(FROM_NAME)}.
          </p>
          ${safeFecha ? `<p style="font-size: 13px; color: #5a6b7d; margin: 0 0 12px 0;">Fecha: <strong>${safeFecha}</strong></p>` : ''}
          ${total ? `
          <div style="background: #e8f5e9; padding: 16px; border-radius: 8px; margin: 16px 0; text-align: center; border: 1px solid #c8e6c9;">
            <p style="font-size: 22px; color: #2c5530; font-weight: bold; margin: 0;">
              Total: ${escapeHtml(typeof total === 'number' ? total.toFixed(2) : total)} €
            </p>
          </div>` : ''}
          <p style="font-size: 14px; color: #3d4f63; margin: 0;">Gracias por su confianza.</p>
        `;
    }

    return corporateShellHtml({
        title,
        accentFrom: '#003d7a',
        accentTo: '#1a5490',
        bodyHtml,
    });
}

/**
 * Generar HTML personalizado para albaranes/notas de entrega
 */
function generateDeliveryEmailHtml({ numero, serie, fecha, total, clienteNombre, customBody }) {
    const safeSerie = escapeHtml(serie);
    const safeNumero = escapeHtml(numero);
    const safeCliente = escapeHtml(clienteNombre || 'cliente');
    const safeFecha = escapeHtml(fecha || '');
    const title = `Albarán ${safeSerie}-${safeNumero}`;

    let bodyHtml;
    if (customBody) {
        bodyHtml = `
          <p style="font-size: 14px; color: #3d4f63; line-height: 1.8; white-space: pre-line; margin: 0;">
            ${escapeHtml(customBody)}
          </p>
        `;
    } else {
        bodyHtml = `
          <p style="font-size: 15px; color: #1a2b3c; margin: 0 0 12px 0;">
            Estimado/a <strong>${safeCliente}</strong>,
          </p>
          <p style="font-size: 14px; color: #3d4f63; line-height: 1.6; margin: 0 0 12px 0;">
            Adjunto le remitimos el albarán <strong>${safeSerie}-${safeNumero}</strong>${safeFecha ? ` con fecha <strong>${safeFecha}</strong>` : ''}
            desde ${escapeHtml(FROM_NAME)}.
          </p>
          ${total ? `
          <div style="background: #e8f5e9; padding: 16px; border-radius: 8px; margin: 16px 0; text-align: center; border: 1px solid #c8e6c9;">
            <p style="font-size: 22px; color: #2c5530; font-weight: bold; margin: 0;">
              Total: ${escapeHtml(typeof total === 'number' ? total.toFixed(2) : total)} €
            </p>
          </div>` : ''}
        `;
    }

    return corporateShellHtml({
        title,
        accentFrom: '#2c5530',
        accentTo: '#4a7c59',
        bodyHtml,
    });
}

module.exports = {
    sendEmailWithPdf,
    sendHtmlEmail,
    generateInvoiceEmailHtml,
    generateDeliveryEmailHtml,
    cachePdf,
    getCachedPdf,
    verifySmtpConnection,
    invalidateTransporter,
    // Test/ops helpers
    escapeHtml,
    resolveBrandLogoPath,
    REPLY_TO,
    FROM_EMAIL,
    FROM_NAME,
};
