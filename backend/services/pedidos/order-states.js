// order-states.js — split de order-lifecycle.js: estados, auth-vendor, actor/terminal y objetivo-confirm.
// Codigo movido verbatim; consts DB2 importadas de ./_shared (single-source).
// canonicalOrderStatus se re-exporta desde ./_shared (dedup: era identica en ambos).
const { queryWithParams } = require('../../config/db');
const { db2Schema, db2QualifiedTable } = require('../../utils/db2-identifiers');
const { getDb2WriteSchema, getDb2WriteSchemaRequested, getDb2WriteSchemaDiagnostic, isDsedacWriteApproved, isDsedacAppBuffersAllowed } = require('../../utils/db2-schemas');
const { trimString, truncate, integerValue, ORDER_TRANSITIONS, OrderStateError, canonicalOrderStatus, DEFAULT_PEDIDOS_ERP_TERMINAL, PEDIDOS_CAB_TABLE, SELECT_ORDER_VENDOR_FOR_AUTH_SQL } = require('./_shared');

function publicOrderStatus(status) {
    const normalized = canonicalOrderStatus(status);
    if (normalized === 'CONFIRMADO') return 'CONFIRMADO';
    return 'BORRADOR';
}

function storedOrderStatus(status) {
    return canonicalOrderStatus(status);
}

function isOrderTransitionAllowed(fromStatus, toStatus) {
    const rawFrom = trimString(fromStatus).toUpperCase();
    const rawTo = trimString(toStatus).toUpperCase();
    if (['ENVIADO', 'ENTREGADO', 'FACTURADO', 'ANULADO'].includes(rawFrom)) return false;
    if (rawTo !== 'BORRADOR' && rawTo !== 'CONFIRMADO') return false;
    const from = canonicalOrderStatus(fromStatus);
    const to = canonicalOrderStatus(toStatus);
    return ORDER_TRANSITIONS[from]?.has(to) === true;
}

async function getOrderVendorForAuth(orderId) {
    const id = parseInt(orderId);
    if (isNaN(id)) throw new Error('Invalid orderId');
    const rows = await queryWithParams(
        SELECT_ORDER_VENDOR_FOR_AUTH_SQL,
        [id],
        false
    );
    if (!rows || rows.length === 0) return null;
    return {
        id: rows[0].ID || id,
        vendedorCode: trimString(rows[0].CODIGOVENDEDOR),
        clientCode: trimString(rows[0].CODIGOCLIENTE),
    };
}

async function getOrderStatusForUpdate(orderId) {
    const rows = await queryWithParams(
        `SELECT TRIM(ESTADO) AS ESTADO FROM ${PEDIDOS_CAB_TABLE} WHERE ID = ?`,
        [orderId],
    );
    if (!rows || rows.length === 0) {
        throw new OrderStateError('ORDER_NOT_FOUND', 'Pedido no encontrado', 404);
    }
    return canonicalOrderStatus(rows[0].ESTADO);
}

async function assertOrderEditable(orderId) {
    const status = await getOrderStatusForUpdate(orderId);
    if (status !== 'BORRADOR') {
        throw new OrderStateError(
            'ORDER_NOT_EDITABLE',
            `Solo se pueden editar lineas en estado BORRADOR (estado actual: ${status})`,
            409,
        );
    }
    return status;
}

function pedidosSchemaName(raw) {
    return db2Schema(raw || 'JAVIER', 'PEDIDOS_CONFIRMATION_SCHEMA');
}

function primaryPedidoCode(value) {
    return trimString(value).split(',')[0].trim();
}

function normalizePedidoActorCode(value, fallback = '') {
    const primary = primaryPedidoCode(value) || primaryPedidoCode(fallback);
    if (!primary) return '';
    if (/^\d+$/.test(primary)) return primary.padStart(2, '0').slice(-2);
    return truncate(primary, 2);
}

function resolvePedidoActorCodes(header = {}, userId) {
    const vendedor = normalizePedidoActorCode(header.CODIGOVENDEDOR);
    const vendedorCobro = normalizePedidoActorCode(header.CODIGOVENDEDORCOBRO, vendedor);
    const promotor = normalizePedidoActorCode(header.CODIGOPROMOTORPREVENTA || header.CODIGOPROMOTOR, vendedor);
    const comercial = normalizePedidoActorCode(header.CODIGOCOMERCIAL, vendedor);
    const vendedorUsuario = normalizePedidoActorCode(userId || header.CODIGOVENDEDORUSUARIO, vendedor);
    const codigoUsuario = primaryPedidoCode(userId || header.CODIGOUSUARIO) || vendedorUsuario || 'APP';
    return {
        vendedor,
        vendedorCobro,
        promotor,
        comercial,
        vendedorUsuario,
        codigoUsuario: truncate(codigoUsuario, 10),
    };
}

function resolvePedidoTerminal(vendedorCode, userId) {
    const actor = resolvePedidoActorCodes({ CODIGOVENDEDOR: vendedorCode }, userId);
    const vendedor = actor.vendedor;
    if (/^\d{1,3}$/.test(vendedor)) {
        const terminal = parseInt(vendedor, 10);
        if (terminal > 0 && terminal <= 999) return terminal;
    }

    const fallback = parseInt(process.env.PEDIDOS_SYSTEM_TERMINAL || '', 10);
    if (Number.isFinite(fallback) && fallback > 0 && fallback <= 999) return fallback;
    return DEFAULT_PEDIDOS_ERP_TERMINAL;
}

function formatPedidoNumeroAcisa(serie, terminal, numeroPedido) {
    const serieLabel = trimString(serie) || 'M';
    const terminalLabel = String(integerValue(terminal) || 0).padStart(3, '0');
    const numeroLabel = String(integerValue(numeroPedido) || 0).padStart(6, '0');
    return `${serieLabel}-${terminalLabel}-${numeroLabel}`;
}

function isAuthorizedForceConfirm(options = {}) {
    if (options.forceConfirm !== true) return false;
    const role = String(options.userRole || '').trim().toUpperCase();
    const reason = trimString(options.forceConfirmReason || options.auditReason);
    return options.adminOverride === true
        && ['ADMIN', 'JEFE_VENTAS'].includes(role)
        && reason.length >= 8;
}

function getPedidosConfirmationTarget() {
    const requestedSchema = getDb2WriteSchemaRequested();
    const schema = getDb2WriteSchema();
    const storageApproved = isDsedacWriteApproved();
    const exportEnabled = String(process.env.PEDIDOS_EXPORT_TO_SYSTEM || 'false').trim().toLowerCase() === 'true';
    const exportApproved = String(process.env.PEDIDOS_DSEDAC_EXPORT_APPROVED || 'false').trim().toLowerCase() === 'true';
    // Export to ${comercialErpTable('CPC')} is independent of local write schema (JAVIER.PEDIDOS_*).
    const shouldExportToSystem = storageApproved && exportEnabled && exportApproved;
    const exportSchema = 'DSEDAC';
    const subempresa = trimString(process.env.PEDIDOS_SYSTEM_SUBEMPRESA || 'GMP').substring(0, 3) || 'GMP';
    const serie = trimString(process.env.PEDIDOS_SYSTEM_SERIE || 'P').substring(0, 1) || 'P';
    const terminal = resolvePedidoTerminal();
    return {
        schema,
        requestedSchema,
        storageApproved,
        appBuffersAllowed: isDsedacAppBuffersAllowed(),
        writeSchemaDiagnostic: getDb2WriteSchemaDiagnostic(),
        exportSchema,
        mode: shouldExportToSystem ? 'SYSTEM' : 'LOCAL',
        shouldExportToSystem,
        exportRequested: exportEnabled,
        exportApproved,
        subempresa,
        serie,
        terminal,
        codigoOperacion: trimString(process.env.PEDIDOS_SYSTEM_CODIGO_OPERACION || 'V').substring(0, 1) || 'V',
        situacionPedido: trimString(process.env.PEDIDOS_SYSTEM_SITUACION_PEDIDO || 'A').substring(0, 1) || 'A',
        codigoTipoPedido: trimString(process.env.PEDIDOS_SYSTEM_CODIGO_TIPO_PEDIDO || '').substring(0, 3),
        codigoUsuario: trimString(process.env.PEDIDOS_SYSTEM_CODIGO_USUARIO || 'APP').substring(0, 10) || 'APP',
        tables: {
            cab: db2QualifiedTable(exportSchema, 'CPC'),
            lin: db2QualifiedTable(exportSchema, 'LPC'),
            obs: db2QualifiedTable(exportSchema, 'OCPC'),
        },
    };
}

module.exports = {
    canonicalOrderStatus,
    publicOrderStatus,
    storedOrderStatus,
    isOrderTransitionAllowed,
    getOrderVendorForAuth,
    getOrderStatusForUpdate,
    assertOrderEditable,
    pedidosSchemaName,
    primaryPedidoCode,
    normalizePedidoActorCode,
    resolvePedidoActorCodes,
    resolvePedidoTerminal,
    formatPedidoNumeroAcisa,
    isAuthorizedForceConfirm,
    getPedidosConfirmationTarget,
};
