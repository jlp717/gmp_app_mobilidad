'use strict';

const { createRepartoConfirmationDb2Repository } = require('../repositories/reparto-confirmation-db2-repository');
const { validateConfirmationTableMapping } = require('./reparto-runtime');
const { createRepartoCobrosDb2Port } = require('../repositories/reparto-cobros-db2-port');
const { createRepartoReceiptDb2Repository } = require('../repositories/reparto-receipt-db2-repository');
const { createRepartoEvidenceDb2Repository } = require('../repositories/reparto-evidence-db2-repository');
const { createRepartoPlannedDeliveryDb2Port } = require('../repositories/reparto-planned-delivery-db2-port');
const { createRepartoCatalogService } = require('../services/reparto-catalog-service');
const { createRepartoConfirmationRuntime } = require('../services/reparto-confirmation-factory');
const { createRepartoReceiptService } = require('../services/reparto-receipt-service');
const { createRepartoReceiptPdfService } = require('../services/reparto-receipt-pdf-service');
const {
  createDeliveryEvidenceService,
  unavailableDeliveryEvidenceService,
} = require('../services/delivery-evidence-service');

const APP_SCHEMA = 'JAVIER';
const ISOLATED_TEST_TABLE_SET = 'isolated_test';
const CONFIRMATION_TABLE_SETS = Object.freeze(new Set(['isolated_test', 'production']));
const STATIC_REPARTO_CATALOG = Object.freeze({
  statuses: Object.freeze(['ENTREGADO', 'PARCIAL', 'NO_ENTREGADO', 'RECHAZADO']),
  differenceReasons: Object.freeze(['PRODUCTO_FALTANTE', 'PRODUCTO_DANADO', 'RECHAZO_CLIENTE', 'CLIENTE_AUSENTE', 'DIRECCION_INCORRECTA', 'ACCESO_IMPOSIBLE', 'OTRO']),
  incidentTypes: Object.freeze(['CLIENTE_AUSENTE', 'DIRECCION_INCORRECTA', 'ACCESO_IMPOSIBLE', 'VEHICULO', 'PRODUCTO_DANADO', 'RECHAZO_CLIENTE', 'OTRO']),
  paymentMethods: Object.freeze(['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'CHEQUE', 'BIZUM']),
});

function canEnableCanonicalConfirmation(runtime) {
  return Boolean(runtime
    && runtime.valid
    && runtime.writesEnabled
    && ['test', 'staging', 'production'].includes(runtime.environment)
    && runtime.schemas?.app === APP_SCHEMA
    && CONFIRMATION_TABLE_SETS.has(runtime.tableSet)
    && validateConfirmationTableMapping(runtime).valid
    && Number.isInteger(runtime.evidencePendingTtlHours)
    && runtime.evidencePendingTtlHours >= 1
    && runtime.evidencePendingTtlHours <= 168
    && runtime.confirmationCapabilityApproved
    && (runtime.environment !== 'production'
      || (runtime.productionWritesEnabled && runtime.productionConfirmationApproved)));
}

function staticCatalogPort() {
  return Object.freeze({ async load() { return STATIC_REPARTO_CATALOG; } });
}

function disabledRuntime() {
  return Object.freeze({
    ...createRepartoConfirmationRuntime(),
    evidenceService: unavailableDeliveryEvidenceService(),
  });
}

function unavailableCobrosPort() {
  const unavailable = async () => {
    const error = new Error('Finance DB2 capability is unavailable');
    error.code = 'REPARTO_COBROS_CAPABILITY_UNAVAILABLE';
    error.statusCode = 503;
    throw error;
  };
  return Object.freeze({
    assertCapabilities: unavailable,
    forConnection: () => Object.freeze({ insertCobro: unavailable }),
  });
}

/** A request acquires exactly one pooled DB2 connection, lazily. */
function createDb2ConnectionFactory({ acquireConfiguredConnection }) {
  if (typeof acquireConfiguredConnection !== 'function') throw new TypeError('acquireConfiguredConnection is required');
  return async function connectionFactory() { return acquireConfiguredConnection(); };
}

function createCanonicalConfirmationBootstrap({ runtime, db, logger = console } = {}) {
  const capabilitySatisfied = canEnableCanonicalConfirmation(runtime);
  const diagnostic = Object.freeze({
    enabled: capabilitySatisfied,
    capabilityApproved: Boolean(runtime?.confirmationCapabilityApproved),
    writesEnabled: Boolean(runtime?.writesEnabled),
    environment: runtime?.environment || 'invalid',
    tableSet: runtime?.tableSet || 'invalid',
    tablesConfigured: Boolean(runtime?.tables?.confirmation),
    evidencePendingTtlHours: runtime?.evidencePendingTtlHours ?? null,
    appSchema: runtime?.schemas?.app || 'unset',
    productionConfirmationApproved: Boolean(runtime?.productionConfirmationApproved),
  });
  if (!capabilitySatisfied) {
    return Object.freeze({ enabled: false, diagnostic, runtime: disabledRuntime() });
  }
  if (!db || typeof db.acquireConfiguredConnection !== 'function') {
    logger.warn?.('[REPARTO_CONFIRMATION_RUNTIME] DB2 bootstrap dependency unavailable');
    return Object.freeze({
      enabled: false,
      diagnostic: Object.freeze({ ...diagnostic, enabled: false }),
      runtime: disabledRuntime(),
    });
  }
  const connectionFactory = createDb2ConnectionFactory(db);
  const plannedDeliveryPort = createRepartoPlannedDeliveryDb2Port({ schema: 'DSEDAC' });
  // Confirmation remains independent from finance. A payment request still
  // fails closed unless the existing finance capability has been authorized.
  // Cobros write against the versioned tableSet mapping (isolated_test or production).
  const cobrosEnabled = Boolean(
    runtime.financeCapabilityApproved
    && CONFIRMATION_TABLE_SETS.has(runtime.tableSet),
  );
  const cobrosPort = cobrosEnabled
    ? createRepartoCobrosDb2Port({ runtime, logger })
    : unavailableCobrosPort();
  const evidenceRepository = createRepartoEvidenceDb2Repository({
    schema: APP_SCHEMA,
    connectionFactory,
    tables: runtime.tables.confirmation,
    pendingTtlHours: runtime.evidencePendingTtlHours,
    plannedDeliveryPort,
    logger,
  });
  const repository = createRepartoConfirmationDb2Repository({
    schema: APP_SCHEMA,
    connectionFactory,
    plannedDeliveryPort,
    tables: runtime.tables.confirmation,
    evidenceOwnershipPort: evidenceRepository,
    cobrosPort,
    requireCobrosCapability: cobrosEnabled,
    logger,
  });
  const catalogService = createRepartoCatalogService({ catalog: staticCatalogPort() });
  const confirmationRuntime = createRepartoConfirmationRuntime({ repository, catalogService });
  // Read-only receipt construction shares the canonical runtime allowlist and
  // lazy connection factory, but is not part of the confirmation write unit.
  const receiptRepository = createRepartoReceiptDb2Repository({ connectionFactory, runtime });
  return Object.freeze({
    enabled: true,
    diagnostic,
    runtime: Object.freeze({
      ...confirmationRuntime,
      evidenceService: createDeliveryEvidenceService({ repository: evidenceRepository }),
      receiptService: createRepartoReceiptService({ repository: receiptRepository }),
      receiptPdfService: createRepartoReceiptPdfService(),
    }),
  });
}

module.exports = { CONFIRMATION_TABLE_SETS, ISOLATED_TEST_TABLE_SET, STATIC_REPARTO_CATALOG, APP_SCHEMA, canEnableCanonicalConfirmation, createCanonicalConfirmationBootstrap, createDb2ConnectionFactory };
