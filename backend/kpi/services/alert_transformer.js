// alert_transformer.js: Transforma alertas verbosas en formato compacto
// Summary: max 2 lineas, action-oriented
// Detail: colapsable, max 4 lineas
// Sin la palabra "año", fechas DD/MM, formato "3.983,17 €"
'use strict';

/**
 * Formatea numero en formato ES con simbolo €.
 * 3983.17 → "3.983,17 €"  |  -2864 → "−2.864,00 €"
 */
function fmtMoney(n) {
    if (n === null || n === undefined) return '0 €';
    const abs = Math.abs(n);
    const parts = abs.toFixed(2).split('.');
    const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const sign = n < 0 ? '−' : '';
    return `${sign}${intPart},${parts[1]} €`;
}

/**
 * Formatea numero corto para summary (sin decimales si entero, con k si > 1000).
 * 1132.56 → "1.132 €"  |  38533.02 → "38.533 €"
 */
function fmtMoneyShort(n) {
    if (n === null || n === undefined) return '0 €';
    const abs = Math.abs(n);
    const intPart = Math.round(abs).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const sign = n < 0 ? '−' : '';
    return `${sign}${intPart} €`;
}

/**
 * DD/MM desde una fecha string (quita el año/año).
 * "2026-03-05" → "05/03"  |  "05/03/2026" → "05/03"  |  "20-03-2025" → "20/03"
 */
function fmtDateShort(dateStr) {
    if (!dateStr || !dateStr.trim()) return null;
    const s = dateStr.trim();
    // ISO: YYYY-MM-DD
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}`;
    // ES invertido: DD-MM-YYYY
    const esDash = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
    if (esDash) return `${esDash[1]}/${esDash[2]}`;
    // ES: DD/MM/YYYY
    const es = s.match(/^(\d{2})\/(\d{2})\/\d{2,4}/);
    if (es) return `${es[1]}/${es[2]}`;
    // DD/MM already
    if (/^\d{2}\/\d{2}$/.test(s)) return s;
    return s.substring(0, 5);
}

/**
 * Transforma una alerta completa en formato compacto.
 * Retorna campos adicionales: title, summary, detail, actions, meta, ui_hint
 * El campo message original se mantiene por retrocompatibilidad.
 *
 * @param {object} alert - alerta con { alertType/type, severity, message, rawData }
 * @returns {object} campos compactos { title, summary, detail, actions, meta, ui_hint }
 */
function transformAlert(alert) {
    const raw = typeof alert.rawData === 'string' ? safeParse(alert.rawData) : (alert.rawData || {});
    const type = alert.alertType || alert.type || '';

    switch (type) {
        case 'DESVIACION_VENTAS':
            return transformDesviacionVentas(alert, raw);
        case 'CUOTA_SIN_COMPRA':
            return transformCuotaSinCompra(alert, raw);
        case 'DESVIACION_REFERENCIACION':
            return transformDesviacionRef(alert, raw);
        case 'PROMOCION':
            return transformPromocion(alert, raw);
        case 'ALTA_CLIENTE':
            return transformAltaCliente(alert, raw);
        case 'AVISO':
            return transformAviso(alert, raw);
        case 'MEDIOS_CLIENTE':
            return transformMedios(alert, raw);
        default:
            return {
                title: type,
                summary: (alert.message || '').substring(0, 120),
                detail: '',
                actions: [],
                meta: {},
                ui_hint: { color: '#888888', icon: 'info' },
            };
    }
}

function safeParse(val) {
    if (!val) return {};
    if (typeof val === 'object') return val;
    try { return JSON.parse(val); } catch (_) { return {}; }
}

// ─── DESVIACION VENTAS ────────────────────────────────────────
function transformDesviacionVentas(alert, raw) {
    const desv = raw.desviacionEur || 0;
    const pct = raw.desviacionPct != null ? Math.round(Math.abs(raw.desviacionPct)) : null;
    const positivo = desv >= 0;
    const pctStr = pct != null ? ` (${positivo ? '+' : '−'}${pct} %)` : '';

    const detailParts = [];
    if (raw.vtaActual != null) detailParts.push(`Comprado: ${fmtMoney(raw.vtaActual)}`);
    if (raw.cuotaAnual != null) detailParts.push(`Obj.: ${fmtMoney(raw.cuotaAnual)}`);
    if (raw.ultCompra) detailParts.push(`Ult. compra: ${fmtDateShort(raw.ultCompra)}`);

    let detail = detailParts.join(' · ');
    if (!positivo) {
        detail += '\nQue hacer: Revisar surtido y ofrecer productos que no esta comprando';
    }

    return {
        title: positivo ? 'Ventas OK' : 'Ventas < objetivo',
        severity: alert.severity,
        summary: positivo
            ? `+${fmtMoney(desv)} sobre objetivo${pctStr}`
            : `${fmtMoney(desv)} vs objetivo${pctStr} → revisar surtido`,
        detail,
        actions: positivo ? [] : ['Revisar surtido', 'Ofrecer helados'],
        meta: {
            lastPurchase: fmtDateShort(raw.ultCompra),
            amount: raw.vtaActual,
            target: raw.cuotaAnual,
            pctDeviation: raw.desviacionPct != null ? -Math.abs(raw.desviacionPct) : null,
        },
        ui_hint: {
            color: positivo ? '#44DD88' : '#FF4444',
            icon: positivo ? 'trending_up' : 'trending_down',
        },
    };
}

// ─── CUOTA SIN COMPRA ────────────────────────────────────────
function transformCuotaSinCompra(alert, raw) {
    const canal = (raw.canal || 'Helados').trim();
    const canalLabel = canal.toUpperCase() === 'HELADO' ? 'Helados'
        : canal.toUpperCase() === 'FROZEN FOOD' ? 'Congelados'
            : canal.charAt(0).toUpperCase() + canal.slice(1).toLowerCase();

    const detailParts = [`Canal: ${canalLabel}`];
    if (raw.difCum != null && raw.difCum > 0) {
        detailParts.push(`Pendiente acum.: ${fmtMoney(raw.difCum)}`);
    } else if (raw.cuotaCum != null) {
        detailParts.push(`Pendiente acum.: ${fmtMoney(raw.cuotaCum)}`);
    }
    if (raw.cuotaMes != null && raw.cuotaMes > 0) {
        detailParts.push(`Obj. mes: ${fmtMoney(raw.cuotaMes)}`);
    }

    return {
        title: `Sin compras ${canalLabel}`,
        severity: alert.severity,
        summary: `Cuota ${fmtMoneyShort(raw.cuotaAnual)} sin pedidos → contactar`,
        detail: detailParts.join(' · ') + `\nQue hacer: Conseguir primer pedido de ${canalLabel}`,
        actions: ['Contactar cliente', 'Conseguir primer pedido'],
        meta: {
            lastPurchase: null,
            amount: 0,
            target: raw.cuotaAnual,
            channel: raw.canal,
        },
        ui_hint: { color: '#FF8800', icon: 'remove_shopping_cart' },
    };
}

// ─── DESVIACION REFERENCIACION ───────────────────────────────
function transformDesviacionRef(alert, raw) {
    const faltantes = raw.desviacion != null ? Math.abs(raw.desviacion) : 0;
    const actuales = raw.refActual || 0;
    const esperados = raw.refAnterior || raw.refTotAnterior || (actuales + faltantes);
    const refs = (raw.refs || []).slice(0, 3);

    const refList = refs.map((r, i) => `${i + 1}. ${r.trim()}`).join(' · ');
    const moreStr = faltantes > refs.length ? ` (+${faltantes - refs.length} mas)` : '';

    return {
        title: `Faltan ${faltantes} producto${faltantes !== 1 ? 's' : ''}`,
        severity: alert.severity,
        summary: `Compra ${actuales}/${esperados} refs. esperadas → llevar muestras`,
        detail: (refList ? refList + moreStr : '') +
            '\nQue hacer: Llevar muestras o argumentario en proxima visita',
        actions: ['Llevar muestras', 'Ofrecer argumentario'],
        meta: { count: faltantes },
        ui_hint: { color: '#FF6B9D', icon: 'inventory_2' },
    };
}

// ─── PROMOCION ───────────────────────────────────────────────
function transformPromocion(alert, raw) {
    const promoText = (raw.promocion || '').trim();
    return {
        title: 'Promo disponible',
        severity: 'info',
        summary: promoText.length > 80
            ? promoText.substring(0, 77) + '...' + ' → ofrecer'
            : (promoText || 'Promocion Nestle') + ' → ofrecer en visita',
        detail: promoText + '\nQue hacer: Ofrecer esta promocion al cliente',
        actions: ['Ofrecer promocion'],
        meta: {},
        ui_hint: { color: '#44DD88', icon: 'local_offer' },
    };
}

// ─── ALTA CLIENTE ────────────────────────────────────────────
function transformAltaCliente(alert, raw) {
    const desv = raw.desviacionEur || 0;
    const pct = raw.pctCumplido;
    const positivo = desv >= 0;
    const pctStr = pct != null ? ` (${pct} %)` : '';

    const detailParts = [];
    if (raw.fechaAlta) detailParts.push(`Alta: ${fmtDateShort(raw.fechaAlta)}`);
    if (raw.vtaActual != null) detailParts.push(`Comprado: ${fmtMoney(raw.vtaActual)}`);
    if (raw.cuotaAnual != null) detailParts.push(`Obj.: ${fmtMoney(raw.cuotaAnual)}`);

    return {
        title: positivo ? 'Nuevo cliente OK' : 'Seguimiento nuevo',
        severity: alert.severity,
        summary: positivo
            ? `+${fmtMoney(desv)} vs obj.${pctStr}`
            : `${fmtMoney(desv)} vs obj.${pctStr} → visita frecuente`,
        detail: detailParts.join(' · ') +
            (positivo ? '' : '\nQue hacer: Programar visitas regulares para fidelizar'),
        actions: positivo ? [] : ['Programar visita', 'Asegurar pedidos'],
        meta: {
            lastPurchase: fmtDateShort(raw.ultCompra),
            amount: raw.vtaActual,
            target: raw.cuotaAnual,
        },
        ui_hint: { color: '#4488FF', icon: 'person_add' },
    };
}

// ─── AVISO ───────────────────────────────────────────────────
function transformAviso(alert, raw) {
    const aviso = (raw.aviso || '').trim();
    return {
        title: 'Aviso operativo',
        severity: 'info',
        summary: aviso.length > 100 ? aviso.substring(0, 97) + '...' : aviso,
        detail: 'Que hacer: Revisar incidencia en proxima visita',
        actions: ['Revisar en visita'],
        meta: {},
        ui_hint: { color: '#AA66FF', icon: 'campaign' },
    };
}

// ─── MEDIOS CLIENTE ──────────────────────────────────────────
function transformMedios(alert, raw) {
    const total = Math.round(raw.totalMedios || 0);
    const parts = [];
    if (raw.armarios > 0) parts.push(`${raw.armarios} armario${raw.armarios > 1 ? 's' : ''}`);
    if (raw.conservadoras > 0) parts.push(`${raw.conservadoras} conserv.`);
    if (raw.vitrinas > 0) parts.push(`${raw.vitrinas} vitrina${raw.vitrinas > 1 ? 's' : ''}`);
    if (raw.otros > 0) parts.push(`${raw.otros} otro${raw.otros > 1 ? 's' : ''}`);

    const detailParts = [];
    if (raw.ultCompra) detailParts.push(`Ult. compra: ${fmtDateShort(raw.ultCompra)}`);
    if (raw.agrupacion) detailParts.push(`Segmento: ${raw.agrupacion.trim()}`);
    if (raw.tipoEstab) detailParts.push(raw.tipoEstab.trim());

    return {
        title: `${total} equipo${total > 1 ? 's' : ''} de frio`,
        severity: 'info',
        summary: (parts.join(' + ') || `${total} equipo${total > 1 ? 's' : ''}`) + ' → verificar estado',
        detail: (detailParts.length > 0 ? detailParts.join(' · ') + '\n' : '') +
            'Que hacer: Verificar buen estado y ubicacion del equipamiento',
        actions: ['Verificar equipamiento'],
        meta: { count: total, lastPurchase: fmtDateShort(raw.ultCompra) },
        ui_hint: { color: '#44DDDD', icon: 'kitchen' },
    };
}

module.exports = { transformAlert, fmtMoney, fmtMoneyShort, fmtDateShort };
