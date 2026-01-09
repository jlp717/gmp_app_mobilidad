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

// ═══════════════════════════════════════════════════════════════════════════
// SISTEMA DE ACUMULACIÓN - Solo envía cuando se llama explícitamente
// ═══════════════════════════════════════════════════════════════════════════
const pendingChanges = new Map(); // vendedor -> { changes: [] }

/**
 * Acumula un cambio para enviar después (NO envía inmediatamente)
 */
function queueAuditEmail(vendorName, changeType, details) {
    if (!pendingChanges.has(vendorName)) {
        pendingChanges.set(vendorName, { changes: [] });
    }
    
    const vendorQueue = pendingChanges.get(vendorName);
    vendorQueue.changes.push({ type: changeType, details, timestamp: new Date() });
    
    logger.info(`📧 Queued change for vendor ${vendorName} (${vendorQueue.changes.length} pending, waiting for explicit flush)`);
}

/**
 * Envía todos los cambios acumulados para un vendedor (llamar al pulsar GUARDAR)
 */
async function flushVendorEmails(vendorName) {
    const vendorQueue = pendingChanges.get(vendorName);
    if (!vendorQueue || vendorQueue.changes.length === 0) {
        logger.info(`📧 No pending changes for vendor ${vendorName}`);
        return;
    }
    
    const changes = [...vendorQueue.changes];
    vendorQueue.changes = [];
    
    logger.info(`📧 Flushing ${changes.length} changes for vendor ${vendorName}`);
    
    // Consolidar todos los cambios en un solo email
    await sendConsolidatedEmail(vendorName, changes);
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
 * Envía email consolidado con todos los cambios
 */
async function sendConsolidatedEmail(vendorName, changes) {
    if (!transporter) initEmailService();
    
    const now = new Date();
    const timestamp = now.toLocaleString('es-ES', { 
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid'
    });
    
    // Separar cambios por tipo
    const reorderChanges = changes.filter(c => c.details.clientesAfectados);
    const moveChanges = changes.filter(c => c.details.movedClients);
    
    // Consolidar datos
    let allReorderedClients = [];
    let allMovedClients = [];
    let affectedDays = new Set();
    
    reorderChanges.forEach(c => {
        if (c.details.diaObjetivo) affectedDays.add(c.details.diaObjetivo);
        if (c.details.clientesAfectados) {
            const changedOnly = c.details.clientesAfectados.filter(cl => cl.hayCambio);
            allReorderedClients.push(...changedOnly);
        }
    });
    
    moveChanges.forEach(c => {
        if (c.details.movedClients) {
            allMovedClients.push(...c.details.movedClients);
            c.details.movedClients.forEach(m => {
                if (m.fromDay) affectedDays.add(m.fromDay);
                if (m.toDay) affectedDays.add(m.toDay);
            });
        }
    });
    
    const daysArray = [...affectedDays].map(d => formatDayName(d));
    const totalChanges = allReorderedClients.length + allMovedClients.length;
    
    // Construir contenido
    let content = '';
    
    // Banner de resumen
    content += `
    <div style="background:linear-gradient(135deg, #1E3A5F 0%, #2D5A87 100%);border-radius:8px;padding:20px 24px;margin-bottom:24px;">
        <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
                <td>
                    <h2 style="margin:0;color:#FFFFFF;font-size:24px;font-weight:700;">
                        ${totalChanges} ${totalChanges === 1 ? 'Cambio' : 'Cambios'} Realizados
                    </h2>
                    <p style="margin:8px 0 0;color:#93C5FD;font-size:14px;">
                        Comercial #${vendorName} • ${daysArray.join(', ')}
                    </p>
                </td>
                <td align="right" style="vertical-align:middle;">
                    <div style="background:rgba(255,255,255,0.15);border-radius:50%;width:56px;height:56px;text-align:center;line-height:56px;">
                        <span style="font-size:24px;">📊</span>
                    </div>
                </td>
            </tr>
        </table>
    </div>`;
    
    // Resumen rápido
    const summaryItems = [];
    if (allMovedClients.length > 0) {
        summaryItems.push({ label: 'Clientes cambiados de día', value: allMovedClients.length, icon: '🔀' });
    }
    if (allReorderedClients.length > 0) {
        summaryItems.push({ label: 'Posiciones reordenadas', value: allReorderedClients.length, icon: '↕️' });
    }
    
    if (summaryItems.length > 0) {
        content += `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>`;
        summaryItems.forEach((item, idx) => {
            const borderRight = idx < summaryItems.length - 1 ? 'border-right:1px solid #E2E8F0;' : '';
            content += `
                <td style="text-align:center;padding:16px;${borderRight}">
                    <div style="font-size:28px;margin-bottom:8px;">${item.icon}</div>
                    <div style="font-size:28px;font-weight:700;color:#1E293B;">${item.value}</div>
                    <div style="font-size:12px;color:#64748B;margin-top:4px;">${item.label}</div>
                </td>`;
        });
        content += `</tr></table>`;
    }
    
    // Sección: Clientes movidos de día
    if (allMovedClients.length > 0) {
        content += `
        <div style="background:#ECFDF5;border:1px solid #10B981;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
            <h3 style="margin:0 0 12px;color:#065F46;font-size:14px;font-weight:600;">
                🔀 Cambios de Día de Visita
            </h3>
            <p style="margin:0 0 16px;color:#047857;font-size:12px;">
                Estos clientes ahora serán visitados en un día diferente al anterior.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:6px;overflow:hidden;">
                <thead>
                    <tr style="background:#065F46;">
                        <th style="padding:10px 12px;text-align:left;color:#FFFFFF;font-size:11px;">CLIENTE</th>
                        <th style="padding:10px 12px;text-align:center;color:#FFFFFF;font-size:11px;">CAMBIO</th>
                        <th style="padding:10px 12px;text-align:right;color:#FFFFFF;font-size:11px;">CÓDIGO</th>
                    </tr>
                </thead>
                <tbody>`;
        
        allMovedClients.forEach((c, idx) => {
            const bgColor = idx % 2 === 0 ? '#FFFFFF' : '#F0FDF4';
            const fromDay = c.fromDay ? formatDayName(c.fromDay) : '(nuevo)';
            const toDay = formatDayName(c.toDay);
            const isNew = !c.fromDay;
            content += `
                <tr style="background:${bgColor};">
                    <td style="padding:10px 12px;border-bottom:1px solid #D1FAE5;">
                        <span style="color:#1E293B;font-size:13px;font-weight:500;">${c.name || c.clientName || 'Cliente'}</span>
                    </td>
                    <td style="padding:10px 12px;border-bottom:1px solid #D1FAE5;text-align:center;">
                        <span style="color:${isNew ? '#10B981' : '#64748B'};font-size:12px;${isNew ? 'font-style:italic;' : ''}">${fromDay}</span>
                        <span style="color:#10B981;font-weight:700;margin:0 6px;">→</span>
                        <span style="background:#10B981;color:#FFFFFF;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${toDay}</span>
                    </td>
                    <td style="padding:10px 12px;border-bottom:1px solid #D1FAE5;text-align:right;">
                        <span style="color:#64748B;font-size:12px;font-family:monospace;">${c.code || c.client || ''}</span>
                    </td>
                </tr>`;
        });
        
        content += `</tbody></table>
        </div>`;
    }
    
    // Sección: Reordenamiento de posiciones
    if (allReorderedClients.length > 0) {
        // Ordenar por magnitud del cambio
        allReorderedClients.sort((a, b) => {
            const diffA = Math.abs((a.posicionAnterior || 0) - (a.posicion || 0));
            const diffB = Math.abs((b.posicionAnterior || 0) - (b.posicion || 0));
            return diffB - diffA;
        });
        
        content += `
        <div style="background:#EFF6FF;border:1px solid #3B82F6;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
            <h3 style="margin:0 0 12px;color:#1E40AF;font-size:14px;font-weight:600;">
                ↕️ Cambios de Posición en la Ruta
            </h3>
            <p style="margin:0 0 16px;color:#1D4ED8;font-size:12px;">
                Estos clientes han cambiado su orden de visita dentro del mismo día. El número indica la posición en la ruta (1 = primera visita del día).
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:6px;overflow:hidden;">
                <thead>
                    <tr style="background:#1E40AF;">
                        <th style="padding:10px 12px;text-align:center;color:#FFFFFF;font-size:11px;width:60px;">ANTES</th>
                        <th style="padding:10px 12px;text-align:center;color:#FFFFFF;font-size:11px;width:30px;"></th>
                        <th style="padding:10px 12px;text-align:center;color:#FFFFFF;font-size:11px;width:60px;">AHORA</th>
                        <th style="padding:10px 12px;text-align:center;color:#FFFFFF;font-size:11px;width:60px;">CAMBIO</th>
                        <th style="padding:10px 12px;text-align:left;color:#FFFFFF;font-size:11px;">CLIENTE</th>
                    </tr>
                </thead>
                <tbody>`;
        
        const showMax = 20;
        const toShow = allReorderedClients.slice(0, showMax);
        
        toShow.forEach((c, idx) => {
            const bgColor = idx % 2 === 0 ? '#FFFFFF' : '#EFF6FF';
            const oldPos = (c.posicionAnterior || 0) + 1;
            const newPos = (c.posicion || 0) + 1;
            const diff = oldPos - newPos;
            
            let changeIndicator, changeColor;
            if (diff > 0) {
                changeIndicator = `▲ +${diff}`;
                changeColor = '#059669';
            } else if (diff < 0) {
                changeIndicator = `▼ ${diff}`;
                changeColor = '#DC2626';
            } else {
                changeIndicator = '—';
                changeColor = '#94A3B8';
            }
            
            content += `
                <tr style="background:${bgColor};">
                    <td style="padding:10px 12px;border-bottom:1px solid #DBEAFE;text-align:center;">
                        <span style="color:#64748B;font-size:12px;">#${oldPos}</span>
                    </td>
                    <td style="padding:10px 12px;border-bottom:1px solid #DBEAFE;text-align:center;">
                        <span style="color:#94A3B8;">→</span>
                    </td>
                    <td style="padding:10px 12px;border-bottom:1px solid #DBEAFE;text-align:center;">
                        <span style="background:#1E40AF;color:#FFFFFF;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;">#${newPos}</span>
                    </td>
                    <td style="padding:10px 12px;border-bottom:1px solid #DBEAFE;text-align:center;">
                        <span style="color:${changeColor};font-size:12px;font-weight:600;">${changeIndicator}</span>
                    </td>
                    <td style="padding:10px 12px;border-bottom:1px solid #DBEAFE;">
                        <span style="color:#1E293B;font-size:13px;font-weight:500;">${c.nombre || c.name || 'Cliente'}</span>
                        <span style="color:#64748B;font-size:11px;margin-left:8px;">${c.codigo || c.code || ''}</span>
                    </td>
                </tr>`;
        });
        
        if (allReorderedClients.length > showMax) {
            content += `
                <tr style="background:#F8FAFC;">
                    <td colspan="5" style="padding:12px;text-align:center;color:#64748B;font-size:12px;">
                        ... y ${allReorderedClients.length - showMax} cambios más
                    </td>
                </tr>`;
        }
        
        content += `</tbody></table>
        </div>`;
    }
    
    // Nota explicativa
    content += `
    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:16px;margin-top:8px;">
        <p style="margin:0;color:#475569;font-size:12px;line-height:1.6;">
            <strong style="color:#1E293B;">¿Qué significan estos cambios?</strong><br><br>
            ${allMovedClients.length > 0 ? '• <strong>Cambio de día:</strong> El cliente será visitado en un día diferente de la semana.<br>' : ''}
            ${allReorderedClients.length > 0 ? '• <strong>Cambio de posición:</strong> El orden de visita ha cambiado. Un número menor significa que será visitado antes en la jornada.<br>' : ''}
            • Los cambios se aplican inmediatamente a la ruta del comercial.
        </p>
    </div>`;

    const htmlBody = generateProfessionalTemplate(content, 'Resumen de Cambios en Ruta', timestamp);
    
    // Construir asunto descriptivo
    let subjectParts = [];
    if (allMovedClients.length > 0) subjectParts.push(`${allMovedClients.length} cambio(s) de día`);
    if (allReorderedClients.length > 0) subjectParts.push(`${allReorderedClients.length} reorden(es)`);
    const subjectLine = subjectParts.join(' + ') || 'Modificación';

    const mailOptions = {
        from: `"GMP Rutas" <${SMTP_CONFIG.auth.user}>`,
        to: 'noreply@mari-pepa.com',
        subject: `Comercial ${vendorName} — ${subjectLine}`,
        html: htmlBody
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        logger.info(`📧 Consolidated email sent: ${info.messageId} (${changes.length} changes)`);
        return true;
    } catch (error) {
        logger.error(`❌ Error sending consolidated email: ${error.message}`);
        return false;
    }
}

/**
 * Acumula cambio para enviar después (NO envía inmediatamente)
 * Usar sendAuditEmailNow para enviar y flushear todo
 */
async function sendAuditEmail(vendorName, changeType, details) {
    // Solo acumular, no enviar
    queueAuditEmail(vendorName, changeType, details);
}

/**
 * Acumula el cambio actual Y envía todos los pendientes inmediatamente
 * Llamar esto cuando el usuario pulsa "GUARDAR CAMBIOS"
 */
async function sendAuditEmailNow(vendorName, changeType, details) {
    // Acumular este cambio
    queueAuditEmail(vendorName, changeType, details);
    // Enviar todo lo acumulado
    await flushVendorEmails(vendorName);
}

module.exports = { sendAuditEmail, sendAuditEmailNow, flushVendorEmails };
