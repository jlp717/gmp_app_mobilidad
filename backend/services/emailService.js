const nodemailer = require('nodemailer');
const logger = require('../middleware/logger');

// SMTP Configuration
const SMTP_CONFIG = {
    host: 'mail.mari-pepa.com',
    port: 587,
    secure: false,
    auth: {
        user: 'noreply@mari-pepa.com',
        pass: '6pVyRf3xptxiN3i'
    },
    tls: {
        rejectUnauthorized: false
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

// Mapeo de nombres de días bonitos
const DAY_NAMES = {
    'lunes': 'Lunes',
    'martes': 'Martes',
    'miercoles': 'Miércoles',
    'jueves': 'Jueves',
    'viernes': 'Viernes',
    'sabado': 'Sábado',
    'domingo': 'Domingo'
};

// Colores para cada día
const DAY_COLORS = {
    'lunes': '#3498db',
    'martes': '#9b59b6',
    'miercoles': '#27ae60',
    'jueves': '#e67e22',
    'viernes': '#e74c3c',
    'sabado': '#1abc9c',
    'domingo': '#95a5a6'
};

function formatDayName(day) {
    return DAY_NAMES[day?.toLowerCase()] || day;
}

function getDayColor(day) {
    return DAY_COLORS[day?.toLowerCase()] || '#3498db';
}

/**
 * Genera el HTML base del email con estilos profesionales
 */
function generateEmailTemplate(content, headerTitle, headerSubtitle) {
    return `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7fa;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f7fa; padding: 20px 0;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); overflow: hidden;">
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px 40px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">
                                📋 ${headerTitle}
                            </h1>
                            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px;">
                                ${headerSubtitle}
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Content -->
                    <tr>
                        <td style="padding: 30px 40px;">
                            ${content}
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f8f9fa; padding: 20px 40px; text-align: center; border-top: 1px solid #e9ecef;">
                            <p style="color: #6c757d; font-size: 12px; margin: 0;">
                                📧 Este es un correo automático del Sistema de Gestión de Rutas
                            </p>
                            <p style="color: #adb5bd; font-size: 11px; margin: 5px 0 0 0;">
                                Generado por GMP App Movilidad • Mari Pepa
                            </p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

/**
 * Genera una tarjeta de información
 */
function infoCard(icon, label, value, color = '#495057') {
    return `
    <div style="display: inline-block; width: 45%; vertical-align: top; margin-bottom: 15px;">
        <div style="background-color: #f8f9fa; border-radius: 8px; padding: 15px; border-left: 4px solid ${color};">
            <p style="margin: 0; color: #6c757d; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
                ${icon} ${label}
            </p>
            <p style="margin: 5px 0 0 0; color: #212529; font-size: 16px; font-weight: 600;">
                ${value}
            </p>
        </div>
    </div>`;
}

/**
 * Genera la tabla de clientes afectados
 */
function clientsTable(clients, isReorder = false) {
    if (!clients || clients.length === 0) return '';
    
    let rows = '';
    clients.forEach((c, idx) => {
        const bgColor = idx % 2 === 0 ? '#ffffff' : '#f8f9fa';
        const position = c.posicion !== undefined ? c.posicion : (c.position !== undefined ? c.position : idx);
        
        if (isReorder) {
            // Para reordenamiento: mostrar posición
            rows += `
            <tr style="background-color: ${bgColor};">
                <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; text-align: center; font-weight: 600; color: #667eea;">
                    #${position + 1}
                </td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef;">
                    <strong style="color: #212529;">${c.nombre || c.name || 'Cliente'}</strong>
                    <br><span style="color: #6c757d; font-size: 12px;">Código: ${c.codigo || c.code}</span>
                </td>
            </tr>`;
        } else {
            // Para movimiento de día
            const fromDay = formatDayName(c.fromDay);
            const toDay = formatDayName(c.toDay);
            const toDayColor = getDayColor(c.toDay);
            
            rows += `
            <tr style="background-color: ${bgColor};">
                <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef;">
                    <strong style="color: #212529;">${c.name || c.nombre || 'Cliente'}</strong>
                    <br><span style="color: #6c757d; font-size: 12px;">Código: ${c.code || c.codigo}</span>
                </td>
                <td style="padding: 12px 15px; border-bottom: 1px solid #e9ecef; text-align: center;">
                    <span style="color: #6c757d;">${fromDay}</span>
                    <span style="margin: 0 8px; color: #667eea;">➜</span>
                    <span style="background-color: ${toDayColor}; color: white; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">
                        ${toDay}
                    </span>
                </td>
            </tr>`;
        }
    });
    
    const headerCols = isReorder 
        ? `<th style="padding: 12px 15px; text-align: left; background-color: #667eea; color: white; font-weight: 600;">Posición</th>
           <th style="padding: 12px 15px; text-align: left; background-color: #667eea; color: white; font-weight: 600;">Cliente</th>`
        : `<th style="padding: 12px 15px; text-align: left; background-color: #667eea; color: white; font-weight: 600;">Cliente</th>
           <th style="padding: 12px 15px; text-align: center; background-color: #667eea; color: white; font-weight: 600;">Cambio de Día</th>`;
    
    return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-radius: 8px; overflow: hidden; border: 1px solid #e9ecef; margin-top: 20px;">
        <thead>
            <tr>${headerCols}</tr>
        </thead>
        <tbody>
            ${rows}
        </tbody>
    </table>`;
}

/**
 * Sends an audit email for Rutero changes
 */
async function sendAuditEmail(vendorName, changeType, details) {
    if (!transporter) initEmailService();

    const now = new Date();
    const dateStr = now.toLocaleDateString('es-ES', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        timeZone: 'Europe/Madrid'
    });
    const timeStr = now.toLocaleTimeString('es-ES', { 
        hour: '2-digit', 
        minute: '2-digit',
        timeZone: 'Europe/Madrid'
    });
    
    // Determinar el tipo de cambio y construir contenido
    let content = '';
    let headerTitle = 'Cambios en Rutero';
    let headerSubtitle = `Comercial ${vendorName}`;
    let subjectLine = '';
    
    // Info cards de fecha y comercial
    content += `
    <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
            <td width="48%" style="vertical-align: top;">
                ${infoCard('👤', 'Comercial', `Código ${vendorName}`, '#667eea')}
            </td>
            <td width="4%"></td>
            <td width="48%" style="vertical-align: top;">
                ${infoCard('📅', 'Fecha y Hora', `${dateStr}<br>${timeStr}`, '#764ba2')}
            </td>
        </tr>
    </table>`;
    
    // Detectar tipo de operación
    if (details.clientesAfectados && details.clientesAfectados.length > 0) {
        // REORDENAMIENTO de clientes en un día
        const dayName = formatDayName(details.diaObjetivo);
        const dayColor = getDayColor(details.diaObjetivo);
        
        headerTitle = 'Reordenamiento de Ruta';
        subjectLine = `Reordenamiento de Ruta - ${dayName}`;
        
        content += `
        <div style="margin-top: 25px; padding: 20px; background: linear-gradient(135deg, ${dayColor}15, ${dayColor}05); border-radius: 10px; border-left: 4px solid ${dayColor};">
            <h3 style="margin: 0 0 5px 0; color: #212529; font-size: 18px;">
                📍 Día modificado: <span style="color: ${dayColor};">${dayName}</span>
            </h3>
            <p style="margin: 0; color: #6c757d; font-size: 14px;">
                Se ha actualizado el orden de visita de <strong>${details.totalClientes || details.clientesAfectados.length} clientes</strong>
            </p>
        </div>`;
        
        content += `
        <div style="margin-top: 25px;">
            <h3 style="margin: 0 0 10px 0; color: #212529; font-size: 16px;">
                📋 Nuevo orden de visita:
            </h3>
            <p style="margin: 0 0 10px 0; color: #6c757d; font-size: 13px;">
                Los clientes se visitarán en el siguiente orden (de arriba a abajo):
            </p>
            ${clientsTable(details.clientesAfectados, true)}
        </div>`;
        
    } else if (details.movedClients && details.movedClients.length > 0) {
        // MOVIMIENTO de clientes a otro día
        headerTitle = 'Cambio de Día de Visita';
        subjectLine = `Cambio de Día - ${details.movedClients.length} cliente(s)`;
        
        const destinations = [...new Set(details.movedClients.map(c => c.toDay))];
        const destStr = destinations.map(d => formatDayName(d)).join(', ');
        
        content += `
        <div style="margin-top: 25px; padding: 20px; background: linear-gradient(135deg, #27ae6015, #27ae6005); border-radius: 10px; border-left: 4px solid #27ae60;">
            <h3 style="margin: 0 0 5px 0; color: #212529; font-size: 18px;">
                🔄 Clientes movidos de día
            </h3>
            <p style="margin: 0; color: #6c757d; font-size: 14px;">
                Se han movido <strong>${details.movedClients.length} cliente(s)</strong> a: <strong>${destStr}</strong>
            </p>
        </div>`;
        
        content += `
        <div style="margin-top: 25px;">
            <h3 style="margin: 0 0 10px 0; color: #212529; font-size: 16px;">
                📋 Detalle de cambios:
            </h3>
            ${clientsTable(details.movedClients, false)}
        </div>`;
        
    } else {
        // Genérico / Otro tipo de cambio
        headerTitle = changeType || 'Modificación de Rutero';
        subjectLine = changeType || 'Modificación';
        
        content += `
        <div style="margin-top: 25px; padding: 20px; background-color: #f8f9fa; border-radius: 10px;">
            <h3 style="margin: 0 0 10px 0; color: #212529; font-size: 16px;">
                📋 Detalles del cambio:
            </h3>
            <pre style="margin: 0; font-size: 12px; color: #495057; white-space: pre-wrap; word-break: break-word;">
${JSON.stringify(details, null, 2)}
            </pre>
        </div>`;
    }
    
    // Nota al pie
    content += `
    <div style="margin-top: 30px; padding: 15px; background-color: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107;">
        <p style="margin: 0; color: #856404; font-size: 13px;">
            <strong>💡 ¿Qué significa esto?</strong><br>
            Este correo es un registro automático de los cambios realizados en las rutas comerciales. 
            No es necesario responder. Si tiene alguna duda, contacte con el equipo de sistemas.
        </p>
    </div>`;

    const htmlBody = generateEmailTemplate(content, headerTitle, headerSubtitle);

    const mailOptions = {
        from: `"Sistema de Rutas GMP" <${SMTP_CONFIG.auth.user}>`,
        to: 'noreply@mari-pepa.com',
        subject: `🗺️ Rutero - Comercial ${vendorName} - ${subjectLine} (${timeStr})`,
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
