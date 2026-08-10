'use strict';

const {
  RepartoPersistenceError,
  createRepartoConfirmationService,
} = require('./reparto-confirmation-service');
const { RepartoCatalogError } = require('./reparto-catalog-service');

function unavailableConfirmationService() {
  return Object.freeze({
    async confirm() {
      throw new RepartoPersistenceError(
        'La persistencia canónica de reparto no está habilitada en este entorno',
        { code: 'REPARTO_CONFIRMATION_RUNTIME_UNAVAILABLE', statusCode: 503 },
      );
    },
  });
}

function unavailableCatalogService() {
  return Object.freeze({
    async validateConfirmation() {
      throw new RepartoCatalogError(
        'El catálogo canónico de reparto no está habilitado en este entorno',
        { code: 'REPARTO_CATALOG_UNAVAILABLE', statusCode: 503 },
      );
    },
  });
}

function assertPort(port, method, name) {
  if (!port || typeof port[method] !== 'function') {
    throw new TypeError(`${name}.${method} is required`);
  }
}

/**
 * Runtime starts fail-closed. A deploy can inject a DB2 repository only after
 * its isolated TEST_REPARTO capability gate has been approved and proven.
 */
function createRepartoConfirmationRuntime({ repository, confirmationService, catalogService, now } = {}) {
  const resolvedConfirmation = confirmationService || (
    repository ? createRepartoConfirmationService({ repository, now }) : unavailableConfirmationService()
  );
  const resolvedCatalog = catalogService || unavailableCatalogService();
  assertPort(resolvedConfirmation, 'confirm', 'confirmationService');
  assertPort(resolvedCatalog, 'validateConfirmation', 'catalogService');
  return Object.freeze({ confirmationService: resolvedConfirmation, catalogService: resolvedCatalog });
}

module.exports = {
  createRepartoConfirmationRuntime,
  unavailableCatalogService,
  unavailableConfirmationService,
};
