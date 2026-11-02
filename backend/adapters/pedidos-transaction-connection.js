'use strict';

const odbc = require('odbc');
const { getPool, initDb } = require('../config/db');

function transactionConnectionUnavailableError() {
  const error = new Error(
    'No hay una conexion dedicada disponible para la transaccion de pedidos.',
  );
  error.code = 'LOCAL_CONFIRMATION_TRANSACTION_UNAVAILABLE';
  error.status = 503;
  return error;
}

function dedicatedConnectionConfig(pool) {
  const source = pool && pool.connectionConfig;
  if (!source || typeof source.connectionString !== 'string' || !source.connectionString.trim()) {
    throw transactionConnectionUnavailableError();
  }

  const config = { connectionString: source.connectionString };
  for (const key of ['connectionTimeout', 'loginTimeout', 'fetchArray']) {
    if (source[key] !== undefined) config[key] = source[key];
  }
  return config;
}

/**
 * Abre una conexion fisica fuera del pool para transacciones con LOCK TABLE.
 * El caller debe cerrarla con `connection.close()` tras commit o rollback.
 */
async function openDedicatedPedidosTransactionConnection() {
  let pool = getPool();
  if (!pool && typeof initDb === 'function') {
    await initDb();
    pool = getPool();
  }
  const config = dedicatedConnectionConfig(pool);
  return odbc.connect(config);
}

module.exports = {
  dedicatedConnectionConfig,
  openDedicatedPedidosTransactionConnection,
  transactionConnectionUnavailableError,
};
