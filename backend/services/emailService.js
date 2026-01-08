const nodemailer = require('nodemailer');
const logger = require('../middleware/logger');

// SMTP Configuration (Provided by user)
const SMTP_CONFIG = {
    host: 'mail.mari-pepa.com',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: 'noreply@mari-pepa.com',
        pass: '6pVyRf3xptxiN3i'
    },
    tls: {
        rejectUnauthorized: false // Often needed for self-signed or internal servers
    }
};

let transporter = null;

function initEmailService() {
    try {
        transporter = nodemailer.createTransport(SMTP_CONFIG);
        logger.info(`📧 Email service initialized for ${SMTP_CONFIG.auth.user}`);
    } catch (e) {
        logger.error(`❌ Email service verification failed: ${e.message}`);
    }
}

/**
 * Sends an audit email for Rutero changes
 * @param {string} vendorName - Name of the commercial agent
 * @param {string} changeType - 'Reorder' or 'Day Change'
 * @param {Object} details - Detailed breakdown of changes
 */
async function sendAuditEmail(vendorName, changeType, details) {
    if (!transporter) initEmailService();

    const timestamp = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });

    // Construct HTML Body
    let htmlBody = `
        <h2>Auditoría de Cambios en Rutero</h2>
        <p><strong>Comercial:</strong> ${vendorName}</p>
        <p><strong>Tipo de Cambio:</strong> ${changeType}</p>
        <p><strong>Fecha/Hora:</strong> ${timestamp}</p>
        <hr/>
        <h3>Detalles:</h3>
        <pre>${JSON.stringify(details, null, 2)}</pre>
    `;

    // Improve HTML formatting based on details structure
    if (details.movedClients && details.movedClients.length > 0) {
        htmlBody += `<h4>Clientes Movidos de Día:</h4><ul>`;
        details.movedClients.forEach(c => {
            htmlBody += `<li><strong>${c.name} (${c.code})</strong>: ${c.fromDay} ➡️ ${c.toDay}</li>`;
        });
        htmlBody += `</ul>`;
    }

    if (details.reorderedDays && details.reorderedDays.length > 0) {
        htmlBody += `<h4>Días Reordenados:</h4><ul>`;
        details.reorderedDays.forEach(d => {
            htmlBody += `<li><strong>${d.day}</strong>: ${d.clientCount} clientes reordenados.</li>`;
        });
        htmlBody += `</ul>`;
    }

    const mailOptions = {
        from: `"Sistema Rutero" <${SMTP_CONFIG.auth.user}>`,
        to: 'noreply@mari-pepa.com', // As requested, send TO this address (audit log)
        subject: `[AUDIT] Cambio Rutero - ${vendorName} - ${timestamp}`,
        html: htmlBody
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        logger.info(`📧 Audit email sent: ${info.messageId}`);
        return true;
    } catch (error) {
        logger.error(`❌ Error sending audit email: ${error.message}`);
        return false;
    }
}

module.exports = {
    sendAuditEmail
};
