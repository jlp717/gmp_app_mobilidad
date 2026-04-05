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

const nodemailer = require('nodemailer');
const logger = require('../middleware/logger');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIGURACIÓN SMTP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SMTP_CONFIG = {
    host: process.env.SMTP_HOST || 'mail.mari-pepa.com',
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1' || parseInt(process.env.SMTP_PORT) === 465,
    auth: {
        user: process.env.SMTP_USER || 'noreply@mari-pepa.com',
        pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '6pVyRf3xptxiN3i'
    },
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
    tls: {
        rejectUnauthorized: false
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100
};

const FROM_EMAIL = process.env.SMTP_FROM || 'noreply@mari-pepa.com';
const FROM_NAME = 'Granja Mari Pepa';

let transporter = null;
let transporterHealthy = false;

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
async function sendEmailWithPdf({ to, subject, htmlBody, textBody, pdfBuffer, pdfFilename }) {
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

    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const transport = getTransporter();

            const defaultHtml = `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #003d7a 0%, #1a5490 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 22px;">Documento Adjunto</h1>
                        <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0 0; font-size: 14px;">Granja Mari Pepa</p>
                    </div>
                    <div style="background: #f8f9fa; padding: 28px; border-radius: 0 0 12px 12px;">
                        <p style="font-size: 15px; color: #333; line-height: 1.6;">
                            Estimado/a cliente,
                        </p>
                        <p style="font-size: 14px; color: #555; line-height: 1.6;">
                            Adjunto encontrará el documento <strong>${pdfFilename}</strong>.
                        </p>
                        <div style="background: #e3f2fd; padding: 16px; border-radius: 8px; margin: 20px 0; text-align: center; border-left: 4px solid #1a5490;">
                            <p style="font-size: 13px; color: #1a5490; font-weight: 600; margin: 0;">
                                ${pdfFilename} (${(pdfBuffer.length / 1024).toFixed(0)} KB)
                            </p>
                        </div>
                        <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
                        <p style="font-size: 11px; color: #999; margin: 0;">
                            Este email ha sido enviado desde la aplicación de gestión de Granja Mari Pepa.<br>
                            Teléfono: 639 77 86 56 | www.mari-pepa.com
                        </p>
                    </div>
                </div>
            `;

            const mailOptions = {
                from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
                to: to,
                subject: subject || `Documento - ${FROM_NAME}`,
                html: htmlBody || defaultHtml,
                text: textBody || `Adjunto: ${pdfFilename}`,
                attachments: [{
                    filename: pdfFilename,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }]
            };

            // Log solo en intento 1, reintentos como debug
            if (attempt === 1) {
                logger.info(`Enviando email a ${to}...`, { subject, pdfFilename });
            } else {
                logger.debug(`Reintento email a ${to} (intento ${attempt}/${maxRetries})...`);
            }

            const info = await transport.sendMail(mailOptions);

            logger.info('✅ Email enviado correctamente', {
                to,
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
                // Timeout o conexión caída → invalidar y forzar reconexión
                invalidateTransporter();
                logger.warn(`⚠️ Error conexión (intento ${attempt}/${maxRetries}): ${error.code} - ${error.message}`, { to });
            } else if (isAuth) {
                // Error autenticación → NO reintentar, es irrecuperable
                logger.error('❌ Error autenticación SMTP (credenciales inválidas)', {
                    user: SMTP_CONFIG.auth.user
                });
                throw new Error('Error de autenticación SMTP. Verifica las credenciales del servidor de correo.');
            } else {
                logger.warn(`⚠️ Error email (intento ${attempt}/${maxRetries}): ${error.code} - ${error.message}`, { to });
            }

            // Reintentar solo para errores de red/timeout (no auth)
            if (attempt < maxRetries && !isAuth) {
                const delay = Math.pow(2, attempt) * 1000;
                logger.debug(`Esperando ${delay}ms antes de reintentar...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else if (isAuth) {
                break; // No retry para auth errors
            }
        }
    }

    // Todos los reintentos fallaron
    const errorCode = lastError?.code || 'UNKNOWN';
    const isTimeoutError = ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'CONNECTION', 'TIMEOUT'].includes(errorCode);

    let userFriendlyMessage = lastError?.message || 'Error desconocido enviando email';
    if (isTimeoutError) {
        userFriendlyMessage = `Timeout conectando al servidor de correo (${SMTP_CONFIG.host}:${SMTP_CONFIG.port}). Verifica que el servidor SMTP está accesible.`;
    }

    logger.error(`❌ Email fallido tras ${maxRetries} intentos`, {
        to,
        pdfFilename,
        errorCode,
        message: userFriendlyMessage
    });

    throw new Error(userFriendlyMessage);
}

/**
 * Generar HTML personalizado para facturas
 */
function generateInvoiceEmailHtml({ serie, numero, fecha, total, clienteNombre, customBody }) {
    if (customBody) {
        return `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #003d7a 0%, #1a5490 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 22px;">Factura ${serie}-${numero}</h1>
                    <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0 0; font-size: 14px;">Granja Mari Pepa</p>
                </div>
                <div style="background: #f8f9fa; padding: 28px; border-radius: 0 0 12px 12px;">
                    <p style="font-size: 14px; color: #555; line-height: 1.8; white-space: pre-line;">${customBody}</p>
                    <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
                    <p style="font-size: 11px; color: #999; margin: 0;">
                        Granja Mari Pepa | Teléfono: 639 77 86 56 | www.mari-pepa.com
                    </p>
                </div>
            </div>
        `;
    }

    return `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #003d7a 0%, #1a5490 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 22px;">Factura ${serie}-${numero}</h1>
                <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0 0; font-size: 14px;">Granja Mari Pepa</p>
            </div>
            <div style="background: #f8f9fa; padding: 28px; border-radius: 0 0 12px 12px;">
                <p style="font-size: 15px; color: #333;">
                    Estimado/a <strong>${clienteNombre || 'cliente'}</strong>,
                </p>
                <p style="font-size: 14px; color: #555; line-height: 1.6;">
                    Adjunto le remitimos la factura <strong>${serie}-${numero}</strong>.
                </p>
                ${fecha ? `<p style="font-size: 13px; color: #777;">Fecha: <strong>${fecha}</strong></p>` : ''}
                ${total ? `
                <div style="background: #e8f5e9; padding: 16px; border-radius: 8px; margin: 20px 0; text-align: center; border: 1px solid #c8e6c9;">
                    <p style="font-size: 22px; color: #2c5530; font-weight: bold; margin: 0;">
                        Total: ${typeof total === 'number' ? total.toFixed(2) : total} €
                    </p>
                </div>` : ''}
                <p style="font-size: 14px; color: #555;">
                    Gracias por su confianza.
                </p>
                <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
                <p style="font-size: 11px; color: #999; margin: 0;">
                    <strong>Granja Mari Pepa</strong> | Teléfono: 639 77 86 56 | www.mari-pepa.com
                </p>
            </div>
        </div>
    `;
}

/**
 * Generar HTML personalizado para albaranes/notas de entrega
 */
function generateDeliveryEmailHtml({ numero, serie, fecha, total, clienteNombre, customBody }) {
    if (customBody) {
        return `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #2c5530 0%, #4a7c59 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 22px;">Albarán ${serie}-${numero}</h1>
                    <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0 0; font-size: 14px;">Granja Mari Pepa</p>
                </div>
                <div style="background: #f8f9fa; padding: 28px; border-radius: 0 0 12px 12px;">
                    <p style="font-size: 14px; color: #555; line-height: 1.8; white-space: pre-line;">${customBody}</p>
                    <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
                    <p style="font-size: 11px; color: #999; margin: 0;">
                        Granja Mari Pepa | Teléfono: 639 77 86 56 | www.mari-pepa.com
                    </p>
                </div>
            </div>
        `;
    }

    return `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #2c5530 0%, #4a7c59 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 22px;">Albarán ${serie}-${numero}</h1>
                <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0 0; font-size: 14px;">Granja Mari Pepa</p>
            </div>
            <div style="background: #f8f9fa; padding: 28px; border-radius: 0 0 12px 12px;">
                <p style="font-size: 15px; color: #333;">
                    Estimado/a <strong>${clienteNombre || 'cliente'}</strong>,
                </p>
                <p style="font-size: 14px; color: #555; line-height: 1.6;">
                    Adjunto le remitimos el albarán <strong>${serie}-${numero}</strong>${fecha ? ` con fecha <strong>${fecha}</strong>` : ''}.
                </p>
                ${total ? `
                <div style="background: #e8f5e9; padding: 16px; border-radius: 8px; margin: 20px 0; text-align: center; border: 1px solid #c8e6c9;">
                    <p style="font-size: 22px; color: #2c5530; font-weight: bold; margin: 0;">
                        Total: ${typeof total === 'number' ? total.toFixed(2) : total} €
                    </p>
                </div>` : ''}
                <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
                <p style="font-size: 11px; color: #999; margin: 0;">
                    <strong>Granja Mari Pepa</strong> | Teléfono: 639 77 86 56 | www.mari-pepa.com
                </p>
            </div>
        </div>
    `;
}

module.exports = {
    sendEmailWithPdf,
    generateInvoiceEmailHtml,
    generateDeliveryEmailHtml,
    cachePdf,
    getCachedPdf,
    verifySmtpConnection,
    invalidateTransporter
};
