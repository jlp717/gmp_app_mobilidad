/**
 * SERVICIO DE EMAIL - NODEMAILER
 * Adaptado de granja_mari_pepa para GMP Movilidad
 */

const nodemailer = require('nodemailer');
const logger = require('../../config/logger');

// Configuración SMTP (misma infraestructura que granja_mari_pepa)
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
    socketTimeout: 20000,
    tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
    }
};

const FROM_EMAIL = process.env.SMTP_FROM || 'noreply@mari-pepa.com';

let transporter = null;

function initializeTransporter() {
    if (!transporter) {
        transporter = nodemailer.createTransport(SMTP_CONFIG);
        logger.info('✅ Email service initialized', { host: SMTP_CONFIG.host, port: SMTP_CONFIG.port });
    }
    return transporter;
}

/**
 * Enviar nota de entrega por email
 * @param {string} to - Email destino
 * @param {Buffer} pdfBuffer - PDF de la nota de entrega
 * @param {Object} deliveryInfo - Información de la entrega
 */
async function sendDeliveryReceipt(to, pdfBuffer, deliveryInfo) {
    try {
        const transporter = initializeTransporter();

        const { albaranNum, clientName, total, fecha } = deliveryInfo;

        const mailOptions = {
            from: `"Granja Mari Pepa - Entregas" <${FROM_EMAIL}>`,
            to: to,
            subject: `Nota de Entrega - Albarán ${albaranNum}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #2c5530 0%, #4a7c59 100%); padding: 20px; border-radius: 10px 10px 0 0;">
                        <h1 style="color: white; margin: 0; text-align: center;">📦 Nota de Entrega</h1>
                    </div>
                    <div style="background: #f8f9fa; padding: 25px; border-radius: 0 0 10px 10px;">
                        <p style="font-size: 16px; color: #333;">
                            Estimado/a <strong>${clientName}</strong>,
                        </p>
                        <p style="font-size: 14px; color: #666;">
                            Adjunto encontrará el comprobante de entrega del albarán <strong>${albaranNum}</strong>
                            con fecha <strong>${fecha}</strong>.
                        </p>
                        
                        <div style="background: #e8f5e9; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
                            <p style="font-size: 24px; color: #2c5530; font-weight: bold; margin: 0;">
                                Total: ${total} €
                            </p>
                        </div>
                        
                        <p style="font-size: 12px; color: #999; margin-top: 30px;">
                            Este email se ha generado automáticamente tras la entrega.<br>
                            <strong>Granja Mari Pepa</strong> | 📞 639 77 86 56
                        </p>
                    </div>
                </div>
            `,
            attachments: [{
                filename: `Nota_Entrega_${albaranNum}.pdf`,
                content: pdfBuffer,
                contentType: 'application/pdf'
            }]
        };

        const info = await transporter.sendMail(mailOptions);
        logger.info('✅ Email de entrega enviado', { to, albaranNum, messageId: info.messageId });

        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error('❌ Error enviando email de entrega', { error: error.message, to });
        throw error;
    }
}

/**
 * Verificar conexión SMTP
 */
async function verifyConnection() {
    try {
        const transporter = initializeTransporter();
        await transporter.verify();
        logger.info('✅ Conexión SMTP verificada');
        return { success: true };
    } catch (error) {
        logger.error('❌ Error SMTP', { error: error.message });
        return { success: false, message: error.message };
    }
}

module.exports = {
    sendDeliveryReceipt,
    verifyConnection
};
