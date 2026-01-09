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

const formatDayName = (day) => DAY_NAMES[day?.toLowerCase()] || day;

/**
 * Genera el template HTML profesional y limpio
 */
function generateProfessionalTemplate(content, headerTitle, timestamp) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#F1F5F9;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 0;">
        <tr><td align="center">
            <table width="640" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:8px;border:1px solid #E2E8F0;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                
                <!-- Header profesional -->
                <tr><td style="background:#1E293B;padding:24px 32px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                            <td>
                                <h1 style="color:#FFFFFF;margin:0;font-size:18px;font-weight:600;letter-spacing:-0.3px;">
                                    ${headerTitle}
                                </h1>
                                <p style="color:#94A3B8;margin:6px 0 0;font-size:13px;">
                                    ${timestamp}
                                </p>
                            </td>
                            <td align="right" style="vertical-align:middle;">
                                <span style="color:#64748B;font-size:12px;">GMP App</span>
                            </td>
                        </tr>
                    </table>
                </td></tr>
                
                <!-- Contenido -->
                <tr><td style="padding:28px 32px;">
                    ${content}
                </td></tr>
                
                <!-- Footer -->
                <tr><td style="background:#F8FAFC;padding:16px 32px;border-top:1px solid #E2E8F0;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                            <td><span style="color:#64748B;font-size:11px;">Notificación automática de gestión de rutas</span></td>
                            <td align="right"><span style="color:#94A3B8;font-size:11px;">Mari Pepa</span></td>
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
 * Caja de resumen ejecutivo
 */
function executiveSummaryBox(items) {
    let rows = '';
    items.forEach(item => {
        rows += `
        <tr>
            <td style="padding:8px 16px;border-bottom:1px solid #F1F5F9;">
                <span style="color:#64748B;font-size:12px;">${item.label}</span>
            </td>
            <td style="padding:8px 16px;border-bottom:1px solid #F1F5F9;text-align:right;">
                <span style="color:#1E293B;font-size:13px;font-weight:600;">${item.value}</span>
            </td>
        </tr>`;
    });
    
    return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;margin-bottom:24px;">
        <tbody>${rows}</tbody>
    </table>`;
}

/**
 * Sección con título
 */
function sectionTitle(icon, title, subtitle = null) {
    return `
    <div style="margin:24px 0 12px 0;border-bottom:2px solid #E2E8F0;padding-bottom:8px;">
        <h2 style="margin:0;color:#1E293B;font-size:14px;font-weight:600;">
            ${icon} ${title}
        </h2>
        ${subtitle ? `<p style="margin:4px 0 0;color:#64748B;font-size:12px;">${subtitle}</p>` : ''}
    </div>`;
}

/**
 * Indicador de cambio de posición
 */
function positionChangeIndicator(oldPos, newPos) {
    const diff = oldPos - newPos; // positivo = subió, negativo = bajó
    if (diff > 0) {
        return `<span style="color:#059669;font-size:11px;font-weight:600;">▲ +${diff}</span>`;
    } else if (diff < 0) {
        return `<span style="color:#DC2626;font-size:11px;font-weight:600;">▼ ${diff}</span>`;
    }
    return `<span style="color:#94A3B8;font-size:11px;">—</span>`;
}

/**
 * Tabla de cambios de posición (reordenamiento interno)
 */
function changesTable(changes, maxShow = 15) {
    if (!changes || changes.length === 0) {
        return `<p style="color:#64748B;font-size:13px;margin:12px 0;">No se detectaron cambios de posición.</p>`;
    }
    
    const showChanges = changes.slice(0, maxShow);
    const remaining = changes.length - maxShow;
    
    let rows = '';
    showChanges.forEach((c, idx) => {
        const bgColor = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
        const oldPos = c.posicionAnterior + 1;
        const newPos = c.posicion + 1;
        
        rows += `
        <tr style="background:${bgColor};">
            <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;text-align:center;width:70px;">
                <span style="color:#64748B;font-size:12px;">#${oldPos}</span>
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;text-align:center;width:30px;">
                <span style="color:#94A3B8;">→</span>
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;text-align:center;width:70px;">
                <span style="background:#1E293B;color:#FFFFFF;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;">#${newPos}</span>
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;width:50px;text-align:center;">
                ${positionChangeIndicator(oldPos, newPos)}
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;">
                <span style="color:#1E293B;font-size:13px;font-weight:500;">${c.nombre || c.name}</span>
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;text-align:right;">
                <span style="color:#64748B;font-size:12px;font-family:monospace;">${c.codigo || c.code}</span>
            </td>
        </tr>`;
    });
    
    if (remaining > 0) {
        rows += `
        <tr style="background:#F8FAFC;">
            <td colspan="6" style="padding:12px;text-align:center;color:#64748B;font-size:12px;">
                ... y ${remaining} cambio(s) adicional(es)
            </td>
        </tr>`;
    }
    
    return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
        <thead>
            <tr style="background:#1E293B;">
                <th style="padding:10px 12px;text-align:center;color:#FFFFFF;font-size:11px;font-weight:600;">ANTES</th>
                <th style="padding:10px 12px;text-align:center;color:#94A3B8;font-size:11px;"></th>
                <th style="padding:10px 12px;text-align:center;color:#FFFFFF;font-size:11px;font-weight:600;">AHORA</th>
                <th style="padding:10px 12px;text-align:center;color:#FFFFFF;font-size:11px;font-weight:600;">CAMBIO</th>
                <th style="padding:10px 12px;text-align:left;color:#FFFFFF;font-size:11px;font-weight:600;">CLIENTE</th>
                <th style="padding:10px 12px;text-align:right;color:#FFFFFF;font-size:11px;font-weight:600;">CÓDIGO</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
}

/**
 * Tabla de clientes trasladados entre días
 */
function transfersTable(clients, direction = 'in', maxShow = 10) {
    if (!clients || clients.length === 0) return '';
    
    const showClients = clients.slice(0, maxShow);
    const remaining = clients.length - maxShow;
    
    let rows = '';
    showClients.forEach((c, idx) => {
        const bgColor = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
        const dayFrom = formatDayName(c.fromDay);
        const dayTo = formatDayName(c.toDay);
        const pos = c.newPosition !== undefined ? Math.floor(c.newPosition / 10) + 1 : '—';
        
        if (direction === 'in') {
            // Clientes que ENTRAN a este día
            rows += `
            <tr style="background:${bgColor};">
                <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;width:100px;">
                    <span style="color:#64748B;font-size:12px;">${dayFrom}</span>
                </td>
                <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;text-align:center;width:60px;">
                    <span style="background:#059669;color:#FFFFFF;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600;">#${pos}</span>
                </td>
                <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;">
                    <span style="color:#1E293B;font-size:13px;font-weight:500;">${c.name || c.nombre}</span>
                </td>
                <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;text-align:right;">
                    <span style="color:#64748B;font-size:12px;font-family:monospace;">${c.code || c.codigo}</span>
                </td>
            </tr>`;
        } else {
            // Clientes que SALEN de este día
            rows += `
            <tr style="background:${bgColor};">
                <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;width:100px;">
                    <span style="background:#DC2626;color:#FFFFFF;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600;">${dayTo}</span>
                </td>
                <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;">
                    <span style="color:#1E293B;font-size:13px;font-weight:500;">${c.name || c.nombre}</span>
                </td>
                <td style="padding:10px 12px;border-bottom:1px solid #E2E8F0;text-align:right;">
                    <span style="color:#64748B;font-size:12px;font-family:monospace;">${c.code || c.codigo}</span>
                </td>
            </tr>`;
        }
    });
    
    if (remaining > 0) {
        const cols = direction === 'in' ? 4 : 3;
        rows += `
        <tr style="background:#F8FAFC;">
            <td colspan="${cols}" style="padding:12px;text-align:center;color:#64748B;font-size:12px;">
                ... y ${remaining} cliente(s) más
            </td>
        </tr>`;
    }
    
    const headers = direction === 'in' 
        ? `<th style="padding:10px 12px;text-align:left;color:#FFFFFF;font-size:11px;font-weight:600;">ORIGEN</th>
           <th style="padding:10px 12px;text-align:center;color:#FFFFFF;font-size:11px;font-weight:600;">POS.</th>
           <th style="padding:10px 12px;text-align:left;color:#FFFFFF;font-size:11px;font-weight:600;">CLIENTE</th>
           <th style="padding:10px 12px;text-align:right;color:#FFFFFF;font-size:11px;font-weight:600;">CÓDIGO</th>`
        : `<th style="padding:10px 12px;text-align:left;color:#FFFFFF;font-size:11px;font-weight:600;">DESTINO</th>
           <th style="padding:10px 12px;text-align:left;color:#FFFFFF;font-size:11px;font-weight:600;">CLIENTE</th>
           <th style="padding:10px 12px;text-align:right;color:#FFFFFF;font-size:11px;font-weight:600;">CÓDIGO</th>`;
    
    return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:6px;overflow:hidden;">
        <thead>
            <tr style="background:#1E293B;">${headers}</tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
}

/**
 * Envía email de auditoría de cambios en Rutero
 */
async function sendAuditEmail(vendorName, changeType, details) {
    if (!transporter) initEmailService();

    const now = new Date();
    const timestamp = now.toLocaleString('es-ES', { 
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
    });
    
    let content = '';
    let headerTitle = 'Modificación de Ruta';
    let subjectLine = 'Modificación';
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CASO 1: REORDENAMIENTO (clientes cambian de posición en el mismo día)
    // ═══════════════════════════════════════════════════════════════════════════
    if (details.clientesAfectados && details.clientesAfectados.length > 0) {
        const dayName = formatDayName(details.diaObjetivo);
        const totalClientes = details.totalClientes || details.clientesAfectados.length;
        
        // Filtrar solo los que realmente cambiaron de posición
        const changedClients = details.clientesAfectados.filter(c => 
            c.posicionAnterior !== undefined && c.posicionAnterior !== c.posicion
        );
        const unchangedCount = totalClientes - changedClients.length;
        
        // Ordenar por magnitud de cambio (los más significativos primero)
        changedClients.sort((a, b) => {
            const diffA = Math.abs((a.posicionAnterior || 0) - (a.posicion || 0));
            const diffB = Math.abs((b.posicionAnterior || 0) - (b.posicion || 0));
            return diffB - diffA;
        });
        
        headerTitle = `Ruta Actualizada — ${dayName}`;
        subjectLine = changedClients.length > 0 
            ? `${dayName}: ${changedClients.length} cambios de posición`
            : `${dayName}: Ruta reordenada`;
        
        // Resumen ejecutivo
        content += executiveSummaryBox([
            { label: 'Comercial', value: `#${vendorName}` },
            { label: 'Día afectado', value: dayName },
            { label: 'Total clientes en ruta', value: totalClientes },
            { label: 'Posiciones modificadas', value: changedClients.length },
            { label: 'Sin cambios', value: unchangedCount }
        ]);
        
        // Tabla de cambios
        if (changedClients.length > 0) {
            content += sectionTitle('📋', 'Detalle de Cambios de Posición', 
                'Ordenados por magnitud del cambio (más significativos primero)');
            content += changesTable(changedClients, 15);
        } else {
            // Si no hay cambios detectables, mostrar la lista como referencia
            content += sectionTitle('📋', 'Ruta Actual', 
                'No se detectaron cambios de posición respecto al estado anterior');
            content += `<p style="color:#64748B;font-size:13px;background:#F8FAFC;padding:16px;border-radius:6px;margin:12px 0;">
                La ruta contiene ${totalClientes} clientes. El orden se ha confirmado sin modificaciones.
            </p>`;
        }
        
        // Nota sobre clientes sin cambios
        if (unchangedCount > 0 && changedClients.length > 0) {
            content += `
            <p style="color:#64748B;font-size:12px;margin-top:16px;padding:12px;background:#F8FAFC;border-radius:6px;">
                ℹ️ Los ${unchangedCount} clientes restantes mantienen su posición original.
            </p>`;
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CASO 2: MOVIMIENTO ENTRE DÍAS (clientes cambian de un día a otro)
    // ═══════════════════════════════════════════════════════════════════════════
    else if (details.movedClients && details.movedClients.length > 0) {
        const count = details.movedClients.length;
        
        // Agrupar por día destino
        const byDestination = {};
        details.movedClients.forEach(c => {
            const dest = c.toDay || 'desconocido';
            if (!byDestination[dest]) byDestination[dest] = [];
            byDestination[dest].push(c);
        });
        
        const destinations = Object.keys(byDestination).map(d => formatDayName(d));
        const destSummary = destinations.join(', ');
        
        headerTitle = `Cambio de Día de Visita`;
        subjectLine = `${count} cliente(s) → ${destSummary}`;
        
        // Resumen ejecutivo
        const summaryItems = [
            { label: 'Comercial', value: `#${vendorName}` },
            { label: 'Clientes trasladados', value: count }
        ];
        
        // Añadir resumen por destino
        Object.entries(byDestination).forEach(([day, clients]) => {
            summaryItems.push({ 
                label: `→ ${formatDayName(day)}`, 
                value: `${clients.length} cliente(s)` 
            });
        });
        
        content += executiveSummaryBox(summaryItems);
        
        // Tablas por destino
        Object.entries(byDestination).forEach(([day, clients]) => {
            content += sectionTitle('📅', `Trasladados a ${formatDayName(day)}`, 
                `${clients.length} cliente(s)`);
            content += transfersTable(clients, 'out', 10);
        });
        
        // Explicación
        content += `
        <div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:6px;padding:14px;margin-top:20px;">
            <p style="margin:0;color:#92400E;font-size:12px;line-height:1.5;">
                <strong>⚠️ Importante:</strong> Estos clientes ya no serán visitados en su día anterior. 
                El comercial los visitará en el nuevo día asignado.
            </p>
        </div>`;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CASO 3: OTRO TIPO DE CAMBIO (genérico)
    // ═══════════════════════════════════════════════════════════════════════════
    else {
        headerTitle = changeType || 'Modificación de Rutero';
        subjectLine = changeType || 'Modificación';
        
        content += executiveSummaryBox([
            { label: 'Comercial', value: `#${vendorName}` },
            { label: 'Tipo de cambio', value: changeType || 'General' }
        ]);
        
        content += `
        <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:16px;margin-top:12px;">
            <pre style="margin:0;color:#475569;font-size:11px;white-space:pre-wrap;word-break:break-word;font-family:monospace;">
${JSON.stringify(details, null, 2)}
            </pre>
        </div>`;
    }

    const htmlBody = generateProfessionalTemplate(content, headerTitle, timestamp);

    const mailOptions = {
        from: `"GMP Rutas" <${SMTP_CONFIG.auth.user}>`,
        to: 'noreply@mari-pepa.com',
        subject: `Comercial ${vendorName} — ${subjectLine}`,
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
