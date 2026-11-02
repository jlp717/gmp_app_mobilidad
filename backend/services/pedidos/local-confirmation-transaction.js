'use strict';

const { getPool, initDb } = require('../../config/db');
const logger = require('../../middleware/logger');
const {
  PEDIDOS_CAB_TABLE,
  PEDIDOS_STOCK_RESERVE_TABLE,
} = require('./_shared');

const STOCK_RESERVATION_LOCK_SQL =
  `LOCK TABLE ${PEDIDOS_STOCK_RESERVE_TABLE} IN EXCLUSIVE MODE`;
const ORDERS_HEADER_LOCK_SQL =
  `LOCK TABLE ${PEDIDOS_CAB_TABLE} IN EXCLUSIVE MODE`;

function transactionUnavailableError() {
  const error = new Error(
    'No hay una conexión transaccional disponible para confirmar el pedido.',
  );
  error.code = 'LOCAL_CONFIRMATION_TRANSACTION_UNAVAILABLE';
  error.status = 503;
  return error;
}

/**
 * Serializa confirmaciones locales que compiten por stock y conserva en una
 * única transacción la cabecera, reservas y movimientos de bolsa.
 *
 * Se usan los métodos transaccionales de node-odbc. beginTransaction desactiva
 * autocommit en la conexión; commit/rollback cierran la unidad de trabajo.
 */
async function withLockedPedidosTransaction(callback, { lockOrderHeaders = false } = {}) {
  if (typeof callback !== 'function') {
    throw new TypeError('callback transaccional requerido');
  }

  let pool = getPool();
  if (!pool && typeof initDb === 'function') {
    await initDb();
    pool = getPool();
  }
  if (!pool || typeof pool.connect !== 'function') {
    throw transactionUnavailableError();
  }

  const conn = await pool.connect();
  const requiredMethods = ['query', 'beginTransaction', 'commit', 'rollback'];
  if (!conn || requiredMethods.some((method) => typeof conn[method] !== 'function')) {
    if (conn && typeof conn.close === 'function') {
      await conn.close().catch(() => undefined);
    }
    throw transactionUnavailableError();
  }

  try {
    await conn.beginTransaction();
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    // La reserva es el recurso compartido entre pedidos. El bloqueo se toma
    // antes de releer ARO-reservas para que dos dispositivos no validen el
    // mismo remanente simultáneamente.
    await conn.query(STOCK_RESERVATION_LOCK_SQL);
    if (lockOrderHeaders) {
      await conn.query(ORDERS_HEADER_LOCK_SQL);
    }
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try {
      await conn.rollback();
    } catch (rollbackError) {
      logger.error(
        `[PEDIDOS] Rollback confirmación local falló: ${rollbackError.message}`,
      );
    }
    throw error;
  } finally {
    if (typeof conn.close === 'function') {
      try {
        await conn.close();
      } catch {
        // El resultado de COMMIT/ROLLBACK prevalece sobre un fallo al cerrar.
      }
    }
  }
}

async function withLocalConfirmationTransaction(callback) {
  return withLockedPedidosTransaction(callback);
}

/**
 * La purga toma los locks en el mismo orden que la confirmación y bloquea la
 * cabecera antes de releer el candidato. De este modo nunca borra los hijos de
 * un pedido que pasó a CONFIRMANDO/CONFIRMADO tras el SELECT inicial.
 */
async function withDraftPurgeTransaction(callback) {
  return withLockedPedidosTransaction(callback, { lockOrderHeaders: true });
}

module.exports = {
  ORDERS_HEADER_LOCK_SQL,
  STOCK_RESERVATION_LOCK_SQL,
  withDraftPurgeTransaction,
  withLocalConfirmationTransaction,
};

