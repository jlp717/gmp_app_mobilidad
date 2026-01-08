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

// Mapeo de nombres de días
const DAY_NAMES = {
    'lunes': 'Lunes', 'martes': 'Martes', 'miercoles': 'Miércoles',
    'jueves': 'Jueves', 'viernes': 'Viernes', 'sabado': 'Sábado', 'domingo': 'Domingo'
};

// Colores neon para cada día (estilo futurista)
const DAY_COLORS = {
    'lunes': '#00D9FF', 'martes': '#A855F7', 'miercoles': '#10B981',
    'jueves': '#F59E0B', 'viernes': '#EF4444', 'sabado': '#06B6D4', 'domingo': '#6B7280'
};

const formatDayName = (day) => DAY_NAMES[day?.toLowerCase()] || day;
const getDayColor = (day) => DAY_COLORS[day?.toLowerCase()] || '#00D9FF';

/**
 * Genera el template HTML futurista
 */
function generateFuturisticTemplate(content, headerTitle, actionBadge, timestamp) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#0F172A;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0F172A;padding:16px 0;">
        <tr><td align="center">
            <table width="580" cellpadding="0" cellspacing="0" style="background:linear-gradient(145deg,#1E293B 0%,#0F172A 100%);border-radius:16px;border:1px solid #334155;overflow:hidden;">
                
                <!-- Header compacto -->
                <tr><td style="background:linear-gradient(135deg,#6366F1 0%,#A855F7 50%,#EC4899 100%);padding:20px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                            <td>
                                <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;letter-spacing:-0.5px;">
                                    ${headerTitle}
                                </h1>
                                <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:12px;">
                                    ${timestamp}
                                </p>
                            </td>
                            <td align="right" style="vertical-align:middle;">
                                <span style="background:rgba(255,255,255,0.2);color:#fff;padding:6px 14px;border-radius:20px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">
                                    ${actionBadge}
                                </span>
                            </td>
                        </tr>
                    </table>
                </td></tr>
                
                <!-- Contenido -->
                <tr><td style="padding:20px 24px;">
                    ${content}
                </td></tr>
                
                <!-- Footer minimalista -->
                <tr><td style="background:#1E293B;padding:14px 24px;border-top:1px solid #334155;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                            <td><span style="color:#64748B;font-size:11px;">🤖 Correo automático</span></td>
                            <td align="right"><span style="color:#475569;font-size:10px;">GMP App • Mari Pepa</span></td>
                        </tr>
                    </table>
                </td></tr>
                
            </table>
        </td></tr>
    </table>
</body>
</html>`;
}

/**
 * Card de resumen de cambios
 */
function summaryCard(icon, title, subtitle, accentColor) {
    return `
    <div style="background:linear-gradient(135deg,${accentColor}15 0%,${accentColor}05 100%);border:1px solid ${accentColor}40;border-radius:12px;padding:16px;margin-bottom:16px;">
        <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
                <td width="40" style="vertical-align:top;">
                    <div style="width:36px;height:36px;background:${accentColor}20;border-radius:10px;text-align:center;line-height:36px;font-size:18px;">
                        ${icon}
                    </div>
                </td>
                <td style="padding-left:12px;">
                    <p style="margin:0;color:#F1F5F9;font-size:15px;font-weight:600;">${title}</p>
                    <p style="margin:3px 0 0;color:#94A3B8;font-size:12px;">${subtitle}</p>
                </td>
            </tr>
        </table>
    </div>`;
}

/**
 * Tabla de clientes compacta y futurista
 */
function clientsTableFuturistic(clients, isReorder = false, maxShow = 15) {
    if (!clients || clients.length === 0) return '';
    
    const showClients = clients.slice(0, maxShow);
    const remaining = clients.length - maxShow;
    
    let rows = '';
    showClients.forEach((c, idx) => {
        const pos = c.posicion !== undefined ? c.posicion : (c.position !== undefined ? c.position : idx);
        const bgColor = idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent';
        
        if (isReorder) {
            rows += `
            <tr style="background:${bgColor};">
                <td style="padding:10px 12px;border-bottom:1px solid #334155;width:50px;">
                    <span style="background:linear-gradient(135deg,#6366F1,#A855F7);color:#fff;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:700;">
                        ${pos + 1}
                    </span>
                </td>
                <td style="padding:10px 12px;border-bottom:1px solid #334155;">
                    <span style="color:#F1F5F9;font-size:13px;font-weight:500;">${c.nombre || c.name}</span>
                    <span style="color:#64748B;font-size:11px;margin-left:8px;">#${c.codigo || c.code}</span>
                </td>
            </tr>`;
        } else {
            const fromColor = getDayColor(c.fromDay);
            const toColor = getDayColor(c.toDay);
            rows += `
            <tr style="background:${bgColor};">
                <td style="padding:10px 12px;border-bottom:1px solid #334155;">
                    <span style="color:#F1F5F9;font-size:13px;font-weight:500;">${c.name || c.nombre}</span>
                    <span style="color:#64748B;font-size:11px;margin-left:8px;">#${c.code || c.codigo}</span>
                </td>
                <td style="padding:10px 12px;border-bottom:1px solid #334155;text-align:right;white-space:nowrap;">
                    <span style="color:${fromColor};font-size:12px;">${formatDayName(c.fromDay)}</span>
                    <span style="color:#64748B;margin:0 6px;">→</span>
                    <span style="background:${toColor};color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:600;">${formatDayName(c.toDay)}</span>
                </td>
            </tr>`;
        }
    });
    
    // Mostrar indicador si hay más clientes
    if (remaining > 0) {
        rows += `
        <tr>
            <td colspan="2" style="padding:10px 12px;text-align:center;">
                <span style="color:#64748B;font-size:11px;">... y ${remaining} cliente(s) más</span>
            </td>
        </tr>`;
    }
    
    const headerText = isReorder ? 'Pos.' : 'Cliente';
    const headerText2 = isReorder ? 'Cliente' : 'Cambio de Día';
    
    return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #334155;border-radius:10px;overflow:hidden;margin-top:12px;">
        <thead>
            <tr style="background:linear-gradient(90deg,#1E293B,#334155);">
                <th style="padding:10px 12px;text-align:left;color:#94A3B8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${headerText}</th>
                <th style="padding:10px 12px;text-align:${isReorder ? 'left' : 'right'};color:#94A3B8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${headerText2}</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
}

/**
 * Info chips compactos
 */
function infoChips(items) {
    let chips = '';
    items.forEach(item => {
        chips += `
        <td style="padding-right:16px;">
            <span style="color:#64748B;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;">${item.label}</span>
            <br><span style="color:#F1F5F9;font-size:14px;font-weight:600;">${item.value}</span>
        </td>`;
    });
    return `<table cellpadding="0" cellspacing="0" style="margin-bottom:16px;"><tr>${chips}</tr></table>`;
}

/**
 * Envía email de auditoría de cambios en Rutero
 */
async function sendAuditEmail(vendorName, changeType, details) {
    if (!transporter) initEmailService();

    const now = new Date();
    const timestamp = now.toLocaleString('es-ES', { 
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
    });
    
    let content = '';
    let headerTitle = 'Cambio en Rutero';
    let actionBadge = 'Modificación';
    let subjectLine = 'Modificación';
    
    // Detectar tipo de operación y construir contenido
    if (details.clientesAfectados && details.clientesAfectados.length > 0) {
        // ═══════════════════════════════════════════════════════════════
        // REORDENAMIENTO de clientes en un día
        // ═══════════════════════════════════════════════════════════════
        const dayName = formatDayName(details.diaObjetivo);
        const dayColor = getDayColor(details.diaObjetivo);
        const totalClientes = details.totalClientes || details.clientesAfectados.length;
        
        headerTitle = '📍 Reordenamiento de Ruta';
        actionBadge = dayName.toUpperCase();
        subjectLine = `Reorden ${dayName} (${totalClientes} clientes)`;
        
        // Info chips
        content += infoChips([
            { label: 'Comercial', value: `#${vendorName}` },
            { label: 'Día', value: dayName },
            { label: 'Clientes', value: totalClientes }
        ]);
        
        // Card de resumen explicativo
        content += summaryCard(
            '🔄',
            'Se ha cambiado el orden de visita',
            `El comercial ${vendorName} ahora visitará los ${totalClientes} clientes del ${dayName} en el nuevo orden mostrado abajo.`,
            dayColor
        );
        
        // Explicación clara
        content += `
        <div style="background:#1E293B;border-radius:8px;padding:12px 14px;margin-bottom:12px;">
            <p style="margin:0;color:#94A3B8;font-size:12px;line-height:1.5;">
                <strong style="color:#F1F5F9;">¿Qué significa esto?</strong><br>
                El orden de la tabla indica cómo el comercial visitará a los clientes durante el día. 
                El cliente en la posición <strong style="color:#A855F7;">1</strong> será el primero en ser visitado.
            </p>
        </div>`;
        
        // Tabla de clientes
        content += clientsTableFuturistic(details.clientesAfectados, true, 20);
        
    } else if (details.movedClients && details.movedClients.length > 0) {
        // ═══════════════════════════════════════════════════════════════
        // MOVIMIENTO de clientes a otro día
        // ═══════════════════════════════════════════════════════════════
        const count = details.movedClients.length;
        const destinations = [...new Set(details.movedClients.map(c => c.toDay))];
        const destNames = destinations.map(d => formatDayName(d)).join(', ');
        
        headerTitle = '🔀 Cambio de Día de Visita';
        actionBadge = `${count} CLIENTE${count > 1 ? 'S' : ''}`;
        subjectLine = `Cambio día → ${destNames}`;
        
        // Info chips
        content += infoChips([
            { label: 'Comercial', value: `#${vendorName}` },
            { label: 'Clientes movidos', value: count },
            { label: 'Destino', value: destNames }
        ]);
        
        // Card de resumen
        content += summaryCard(
            '📅',
            `${count} cliente${count > 1 ? 's' : ''} cambió de día`,
            `Se ${count > 1 ? 'han movido' : 'ha movido'} a ${destNames}. El comercial ${vendorName} los visitará en su nuevo día asignado.`,
            '#10B981'
        );
        
        // Explicación clara
        content += `
        <div style="background:#1E293B;border-radius:8px;padding:12px 14px;margin-bottom:12px;">
            <p style="margin:0;color:#94A3B8;font-size:12px;line-height:1.5;">
                <strong style="color:#F1F5F9;">¿Qué significa esto?</strong><br>
                Los clientes listados ya no serán visitados en su día anterior. 
                Ahora el comercial los visitará en el nuevo día indicado con el badge de color.
            </p>
        </div>`;
        
        // Tabla de clientes
        content += clientsTableFuturistic(details.movedClients, false, 15);
        
    } else {
        // ═══════════════════════════════════════════════════════════════
        // Otro tipo de cambio genérico
        // ═══════════════════════════════════════════════════════════════
        headerTitle = changeType || 'Modificación de Rutero';
        actionBadge = 'CAMBIO';
        subjectLine = changeType || 'Modificación';
        
        content += infoChips([
            { label: 'Comercial', value: `#${vendorName}` },
            { label: 'Tipo', value: changeType || 'General' }
        ]);
        
        content += `
        <div style="background:#1E293B;border-radius:8px;padding:14px;margin-top:12px;">
            <pre style="margin:0;color:#94A3B8;font-size:11px;white-space:pre-wrap;word-break:break-word;font-family:monospace;">
${JSON.stringify(details, null, 2)}
            </pre>
        </div>`;
    }

    const htmlBody = generateFuturisticTemplate(content, headerTitle, actionBadge, timestamp);

    const mailOptions = {
        from: `"GMP Rutas" <${SMTP_CONFIG.auth.user}>`,
        to: 'noreply@mari-pepa.com',
        subject: `🗺️ Comercial ${vendorName} • ${subjectLine}`,
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

module.exports = { sendAuditEmail };
