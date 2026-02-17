/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 📧 EMAIL PDF SERVICE - Envío de PDFs por email server-side
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
    host: process.env.SMTP_HOST || '_dc-mx.bef93564e202.mari-pepa.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.SMTP_USER || 'noreply@mari-pepa.com',
        pass: process.env.SMTP_PASSWORD || '6pVyRf3xptxiN3i'
    },
    connectionTimeout: 20000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
    }
};

const FROM_EMAIL = process.env.SMTP_FROM || 'noreply@mari-pepa.com';
const FROM_NAME = 'Granja Mari Pepa';

let transporter = null;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INICIALIZACIÓN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getTransporter() {
    if (!transporter) {
        transporter = nodemailer.createTransport(SMTP_CONFIG);
        logger.info('📧 EmailPdfService: Transporter SMTP inicializado', {
            host: SMTP_CONFIG.host,
            port: SMTP_CONFIG.port
        });
    }
    return transporter;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CACHÉ DE PDFs EN MEMORIA (TTL = 5 minutos)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const pdfCache = new Map();
const PDF_CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Almacenar PDF en caché temporal
 * @param {string} key - Clave única (e.g. "factura_FAV_123_2026")
 * @param {Buffer} buffer - El PDF generado
 */
function cachePdf(key, buffer) {
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

    logger.info(`📧 PDF cached: ${key} (${(buffer.length / 1024).toFixed(1)} KB, ${pdfCache.size} items in cache)`);
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

    logger.info(`📧 PDF cache HIT: ${key}`);
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

    try {
        const transport = getTransporter();

        const defaultHtml = `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #003d7a 0%, #1a5490 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 22px;">📄 Documento Adjunto</h1>
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
                            📎 ${pdfFilename} (${(pdfBuffer.length / 1024).toFixed(0)} KB)
                        </p>
                    </div>
                    <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
                    <p style="font-size: 11px; color: #999; margin: 0;">
                        Este email ha sido enviado desde la aplicación de gestión de Granja Mari Pepa.<br>
                        📞 639 77 86 56 | 🌐 www.mari-pepa.com
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

        const info = await transport.sendMail(mailOptions);

        logger.info('📧 Email con PDF enviado correctamente', {
            to,
            subject,
            pdfFilename,
            pdfSize: `${(pdfBuffer.length / 1024).toFixed(1)} KB`,
            messageId: info.messageId
        });

        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error('📧 Error enviando email con PDF', {
            to,
            pdfFilename,
            error: error.message,
            code: error.code
        });
        throw error;
    }
}

/**
 * Generar HTML personalizado para facturas
 */
function generateInvoiceEmailHtml({ serie, numero, fecha, total, clienteNombre, customBody }) {
    if (customBody) {
        return `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #003d7a 0%, #1a5490 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 22px;">📄 Factura ${serie}-${numero}</h1>
                    <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0 0; font-size: 14px;">Granja Mari Pepa</p>
                </div>
                <div style="background: #f8f9fa; padding: 28px; border-radius: 0 0 12px 12px;">
                    <p style="font-size: 14px; color: #555; line-height: 1.8; white-space: pre-line;">${customBody}</p>
                    <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
                    <p style="font-size: 11px; color: #999; margin: 0;">
                        Granja Mari Pepa | 📞 639 77 86 56 | 🌐 www.mari-pepa.com
                    </p>
                </div>
            </div>
        `;
    }

    return `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #003d7a 0%, #1a5490 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 22px;">📄 Factura ${serie}-${numero}</h1>
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
                <div style="background: #e8f5e9; padding: 16px; border-radius: 8px; margin: 20px 0; text-align: center;">
                    <p style="font-size: 22px; color: #2c5530; font-weight: bold; margin: 0;">
                        Total: ${typeof total === 'number' ? total.toFixed(2) : total} €
                    </p>
                </div>` : ''}
                <p style="font-size: 14px; color: #555;">
                    Gracias por su confianza.
                </p>
                <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
                <p style="font-size: 11px; color: #999; margin: 0;">
                    <strong>Granja Mari Pepa</strong> | 📞 639 77 86 56 | 🌐 www.mari-pepa.com
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
                    <h1 style="color: white; margin: 0; font-size: 22px;">📦 Albarán ${serie}-${numero}</h1>
                    <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0 0; font-size: 14px;">Granja Mari Pepa</p>
                </div>
                <div style="background: #f8f9fa; padding: 28px; border-radius: 0 0 12px 12px;">
                    <p style="font-size: 14px; color: #555; line-height: 1.8; white-space: pre-line;">${customBody}</p>
                    <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
                    <p style="font-size: 11px; color: #999; margin: 0;">
                        Granja Mari Pepa | 📞 639 77 86 56 | 🌐 www.mari-pepa.com
                    </p>
                </div>
            </div>
        `;
    }

    return `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #2c5530 0%, #4a7c59 100%); padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 22px;">📦 Albarán ${serie}-${numero}</h1>
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
                <div style="background: #e8f5e9; padding: 16px; border-radius: 8px; margin: 20px 0; text-align: center;">
                    <p style="font-size: 22px; color: #2c5530; font-weight: bold; margin: 0;">
                        Total: ${typeof total === 'number' ? total.toFixed(2) : total} €
                    </p>
                </div>` : ''}
                <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
                <p style="font-size: 11px; color: #999; margin: 0;">
                    <strong>Granja Mari Pepa</strong> | 📞 639 77 86 56 | 🌐 www.mari-pepa.com
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
    getCachedPdf
};
