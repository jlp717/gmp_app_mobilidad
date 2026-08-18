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
  if (!configured || !db || typeof db.acquireConfiguredConnection !== 'function') {
    if (configured) logger.warn?.('[REPARTIDOR_LIQUIDACION_RUNTIME] DB2 bootstrap dependency unavailable');
    const service = unavailableService();
    return Object.freeze({
      configured,
      enabled: false,
      diagnostic: Object.freeze({
        enabled: false, configured, catalogVerified: false,
        environment: runtime?.environment || 'invalid', tableSet: runtime?.tableSet || 'invalid',
        financeCapabilityApproved: Boolean(runtime?.financeCapabilityApproved),
        writesEnabled: Boolean(runtime?.writesEnabled),
      }),
      service,
      verifyCatalogReadOnly: service.closeDay,
    });
  }
  const connectionFactory = async () => db.acquireConfiguredConnection();
  const repository = createRepartidorLiquidacionDb2Repository({ runtime, connectionFactory });
  let catalogChecked = false;
  let catalogErrorCode = null;

  async function verifyCatalogReadOnly() {
    catalogChecked = true;
    try {
      const result = await repository.verifyCatalogReadOnly({ requiresOutbox: true });
      catalogErrorCode = null;
      return result;
    } catch (error) {
      catalogErrorCode = String(error?.code || 'LIQUIDACION_CAPABILITY_UNAVAILABLE');
      throw error;
    }
  }

  const diagnostic = Object.freeze({
    configured: true,
    get enabled() { return repository.catalogVerified; },
    get catalogVerified() { return repository.catalogVerified; },
    get catalogChecked() { return catalogChecked; },
    get errorCode() { return catalogErrorCode; },
    environment: runtime.environment, tableSet: runtime.tableSet,
    financeCapabilityApproved: true, writesEnabled: true,
  });
  return Object.freeze({
    configured: true,
    get enabled() { return repository.catalogVerified; },
    diagnostic,
    service: createRepartidorLiquidacionService({ repository }), repository,
    verifyCatalogReadOnly,
  });
}

module.exports = { canEnableCanonicalLiquidacion, createRepartidorLiquidacionBootstrap, unavailableService };
