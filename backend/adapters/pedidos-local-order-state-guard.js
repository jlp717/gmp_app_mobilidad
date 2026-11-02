'use strict';

const { db2AppTable } = require('../utils/db2-schemas');

const TABLES = Object.freeze({
  stock: db2AppTable('PEDIDOS_STOCK_RESERVE'),
  headers: db2AppTable('PEDIDOS_CAB'),
  confirmations: db2AppTable('REPARTO_CONFIRMACIONES'),
  evidences: db2AppTable('REPARTO_EVIDENCIAS'),
  confirmationEvidences: db2AppTable('REPARTO_CONFIRM_EVIDENCIAS'),
  repartidorCobros: db2AppTable('REPARTIDOR_COBROS'),
  commercialCobros: db2AppTable('COBROS'),
});

function localDocumentIdentity(documentId) {
  const match = /^PED-(\d+)-([A-Za-z0-9]+)$/.exec(String(documentId || '').trim());
  if (!match) return null;
  return { pedidoId: Number.parseInt(match[1], 10), clientCode: match[2] };
}

function affectedCount(result) {
  if (typeof result === 'number') return result;
  if (result && typeof result.count === 'number') return result.count;
  return null;
}

async function lockLocalOrderCoordinator(queryFn, documentId, {
  requireActive = true,
  acquireLocks = true,
} = {}) {
  if (typeof queryFn !== 'function') throw new TypeError('queryFn requerido');
  const identity = localDocumentIdentity(documentId);
  if (!identity) return { local: false, documentId: String(documentId || '').trim() };
  if (acquireLocks) {
    await queryFn(`LOCK TABLE ${TABLES.stock} IN EXCLUSIVE MODE`);
    await queryFn(`LOCK TABLE ${TABLES.headers} IN EXCLUSIVE MODE`);
  }
  const rows = await queryFn(
    `SELECT ID, TRIM(ESTADO) AS ESTADO,
            TRIM(COALESCE(NULLIF(CODIGOCLIENTE, ''), CODIGOCLIENTEALBARAN)) AS CODIGOCLIENTE,
            TRIM(SERIEPEDIDO) AS SERIEPEDIDO, NUMEROPEDIDO
       FROM ${TABLES.headers}
      WHERE ID = ?`,
    [identity.pedidoId],
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    const error = new Error('El pedido local asociado a la entrega no esta disponible.');
    error.code = 'LOCAL_ORDER_COORDINATOR_UNAVAILABLE';
    error.status = 409;
    throw error;
  }
  const rowClient = String(rows[0].CODIGOCLIENTE || '').trim();
  if (rowClient !== identity.clientCode) {
    const error = new Error('La identidad del pedido local no coincide con el documento.');
    error.code = 'LOCAL_ORDER_DOCUMENT_MISMATCH';
    error.status = 409;
    throw error;
  }
  const state = String(rows[0].ESTADO || '').trim().toUpperCase();
  if (requireActive && state !== 'CONFIRMADO') {
    const error = new Error(`El pedido local no admite entrega en estado ${state || 'DESCONOCIDO'}.`);
    error.code = state === 'CANCELADO' ? 'LOCAL_ORDER_CANCELLED' : 'LOCAL_ORDER_NOT_CONFIRMED';
    error.status = 409;
    throw error;
  }
  const seriePedido = String(rows[0].SERIEPEDIDO || '').trim();
  const numeroPedido = Number.parseInt(rows[0].NUMEROPEDIDO, 10);
  if (!seriePedido || !Number.isSafeInteger(numeroPedido) || numeroPedido <= 0) {
    const error = new Error('La referencia estable del pedido local no esta disponible.');
    error.code = 'LOCAL_ORDER_REFERENCE_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
  const legacyPaymentReference = `${seriePedido}-${numeroPedido}`;
  return {
    local: true,
    ...identity,
    state,
    seriePedido,
    numeroPedido,
    legacyPaymentReference,
    stablePaymentReference: `PEDIDO:${identity.pedidoId}:${legacyPaymentReference}`,
  };
}

async function lockLocalCancellationGuards(queryFn, documentId, { alreadyCoordinated = false } = {}) {
  const identity = localDocumentIdentity(documentId);
  const coordinated = identity
    ? await lockLocalOrderCoordinator(queryFn, documentId, {
      requireActive: false,
      acquireLocks: !alreadyCoordinated,
    })
    : { local: false, documentId: String(documentId || '').trim() };
  if (!coordinated.local) return coordinated;
  await queryFn(`LOCK TABLE ${TABLES.confirmations} IN EXCLUSIVE MODE`);
  await queryFn(`LOCK TABLE ${TABLES.evidences} IN EXCLUSIVE MODE`);
  await queryFn(`LOCK TABLE ${TABLES.confirmationEvidences} IN EXCLUSIVE MODE`);
  await queryFn(`LOCK TABLE ${TABLES.repartidorCobros} IN EXCLUSIVE MODE`);
  await queryFn(`LOCK TABLE ${TABLES.commercialCobros} IN EXCLUSIVE MODE`);
  const confirmations = await queryFn(
    `SELECT ID FROM ${TABLES.confirmations} WHERE DOCUMENT_ID = ? FETCH FIRST 1 ROW ONLY`,
    [documentId],
  );
  const evidences = await queryFn(
    `SELECT ID FROM ${TABLES.evidences} WHERE DOCUMENT_ID = ? FETCH FIRST 1 ROW ONLY`,
    [documentId],
  );
  const repartoCobros = await queryFn(
    `SELECT ID FROM ${TABLES.repartidorCobros}
      WHERE UPPER(TRIM(COALESCE(PANTALLA_ORIGEN, ''))) = 'RUTERO'
        AND LOCATE(?, UPPER(TRIM(COALESCE(OBSERVACIONES, '')))) > 0
      FETCH FIRST 1 ROW ONLY`,
    [String(documentId).toUpperCase()],
  );
  const commercialCobros = await queryFn(
    `SELECT ID FROM ${TABLES.commercialCobros}
      WHERE TRIM(CODIGO_CLIENTE) = ?
        AND TRIM(REFERENCIA) IN (?, ?, ?)
      FETCH FIRST 1 ROW ONLY`,
    [
      coordinated.clientCode,
      coordinated.stablePaymentReference,
      coordinated.legacyPaymentReference,
      documentId,
    ],
  );
  const blockers = [];
  if (confirmations?.length) blockers.push('DELIVERY_CONFIRMATION');
  if (evidences?.length) blockers.push('DELIVERY_EVIDENCE');
  if (repartoCobros?.length) blockers.push('DRIVER_COLLECTION');
  if (commercialCobros?.length) blockers.push('COMMERCIAL_COLLECTION');
  if (blockers.length) {
    const error = new Error('El pedido ya tiene entrega, evidencia o cobro y no se puede cancelar.');
    error.code = 'ORDER_CANCELLATION_HAS_DOWNSTREAM_ACTIVITY';
    error.status = 409;
    error.blockers = blockers;
    throw error;
  }
  return coordinated;
}

module.exports = {
  TABLES,
  affectedCount,
  localDocumentIdentity,
  lockLocalCancellationGuards,
  lockLocalOrderCoordinator,
};
