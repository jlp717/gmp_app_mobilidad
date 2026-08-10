'use strict';

const { createRepartidorLiquidacionDb2Repository } = require('../repositories/repartidor-liquidacion-db2-repository');
const { createRepartidorLiquidacionService } = require('../services/repartidor-liquidacion-service');
const { validateFinanceTableMapping } = require('./reparto-runtime');

function canEnableCanonicalLiquidacion(runtime) {
  return Boolean(runtime?.valid && runtime.writesEnabled && runtime.financeCapabilityApproved
    && validateFinanceTableMapping(runtime).valid);
}

function unavailableService({ code = 'LIQUIDACION_CAPABILITY_UNAVAILABLE', message = 'La liquidacion canonica DB2 no esta habilitada' } = {}) {
  const unavailable = async () => { const error = new Error(message); error.code = code; error.statusCode = 503; throw error; };
  return Object.freeze({
    closeDay: unavailable, createExpense: unavailable, createAdjustment: unavailable,
    createBankDeposit: unavailable, getDayEntries: unavailable,
  });
}

function createRepartidorLiquidacionBootstrap({ runtime, db, logger = console } = {}) {
  const configured = canEnableCanonicalLiquidacion(runtime);
  if (!configured || !db || typeof db.initDb !== 'function' || typeof db.getPool !== 'function') {
    if (configured) logger.warn?.('[REPARTIDOR_LIQUIDACION_RUNTIME] DB2 bootstrap dependency unavailable');
    return Object.freeze({
      enabled: false,
      diagnostic: Object.freeze({
        enabled: false, configured, catalogVerified: false,
        environment: runtime?.environment || 'invalid', tableSet: runtime?.tableSet || 'invalid',
        financeCapabilityApproved: Boolean(runtime?.financeCapabilityApproved),
        writesEnabled: Boolean(runtime?.writesEnabled),
      }),
      service: unavailableService(),
    });
  }
  const connectionFactory = async () => { const initialized = await db.initDb(); const pool = initialized || db.getPool(); if (!pool?.connect) { const error = new Error('DB2 pooled connection is unavailable'); error.code = 'LIQUIDACION_CAPABILITY_UNAVAILABLE'; error.statusCode = 503; throw error; } return pool.connect(); };
  const repository = createRepartidorLiquidacionDb2Repository({ runtime, connectionFactory });
  const diagnostic = Object.freeze({
    configured: true,
    get enabled() { return repository.catalogVerified; },
    get catalogVerified() { return repository.catalogVerified; },
    environment: runtime.environment, tableSet: runtime.tableSet,
    financeCapabilityApproved: true, writesEnabled: true,
  });
  return Object.freeze({
    configured: true,
    get enabled() { return repository.catalogVerified; },
    diagnostic,
    service: createRepartidorLiquidacionService({ repository }), repository,
  });
}

module.exports = { canEnableCanonicalLiquidacion, createRepartidorLiquidacionBootstrap, unavailableService };
