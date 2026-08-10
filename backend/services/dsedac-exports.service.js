'use strict';

/**
 * DSEDAC ERP export facade (fail-closed).
 *
 * Deployable `services/` must not embed DSEDAC DML SQL literals (G2 cert rule).
 * Real INSERT builders live in `backend/optional/dsedac-exports.impl.js` and load
 * only when every export approval flag is true.
 */

const logger = require('../middleware/logger');
const {
  getDb2WriteSchema,
  getDb2WriteSchemaRequested,
  getDb2WriteSchemaDiagnostic,
  isDsedacWriteApproved,
  isDsedacAppBuffersAllowed,
} = require('../utils/db2-schemas');

const CLV_CONCEPT_MAP = [
  { javierField: 'IMPORTEEFECTIVO', codigo: 'EF', descripcion: 'EFECTIVO' },
  { javierField: 'IMPORTECHEQUES', codigo: 'CH', descripcion: 'CHEQUES' },
  { javierField: 'IMPORTETARJETA', codigo: 'TJ', descripcion: 'TARJETA' },
  { javierField: 'IMPORTEPOSTDATADOS', codigo: 'PD', descripcion: 'POSTDATADOS' },
  { javierField: 'IMPORTEINGRESOENBANCO', codigo: 'IB', descripcion: 'INGRESO BANCO' },
  { javierField: 'IMPORTEGASTOS', codigo: 'GT', descripcion: 'GASTOS' },
];

function exportGate() {
  const effectiveSchema = getDb2WriteSchema();
  const requestedSchema = getDb2WriteSchemaRequested();
  const storageApproved = isDsedacWriteApproved();
  const exportEnabled = String(process.env.PEDIDOS_EXPORT_TO_SYSTEM || 'false').trim().toLowerCase() === 'true';
  const exportApproved = String(process.env.PEDIDOS_DSEDAC_EXPORT_APPROVED || 'false').trim().toLowerCase() === 'true';
  return {
    enabled: storageApproved && exportEnabled && exportApproved,
    effectiveSchema,
    requestedSchema,
    exportSchema: 'DSEDAC',
    storageApproved,
    appBuffersAllowed: isDsedacAppBuffersAllowed(),
    writeSchemaDiagnostic: getDb2WriteSchemaDiagnostic(),
    exportEnabled,
    exportApproved,
  };
}

function isEnabled() {
  return exportGate().enabled;
}

function logSkip(tag, reason) {
  logger.info(`[DSEDAC-EXPORT] ${tag}: skip (${reason})`);
}

function loadImplOrNull() {
  if (!isEnabled()) return null;
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require('../optional/dsedac-exports.impl');
}

async function exportCobroToSystem(cobroRow) {
  const impl = loadImplOrNull();
  if (!impl) {
    logSkip('exportCobroToSystem', 'export disabled or approval missing');
    return { exported: false, reason: 'disabled' };
  }
  return impl.exportCobroToSystem(cobroRow);
}

async function exportLiquidacionToSystem(liquidacionRow) {
  const impl = loadImplOrNull();
  if (!impl) {
    logSkip('exportLiquidacionToSystem', 'export disabled or approval flags missing');
    return { exported: false, reason: 'disabled' };
  }
  return impl.exportLiquidacionToSystem(liquidacionRow);
}

async function exportEntregaToSystem(entregaHeader, entregaLineas = []) {
  const impl = loadImplOrNull();
  if (!impl) {
    logSkip('exportEntregaToSystem', 'export disabled or approval flags missing');
    return { exported: false, reason: 'disabled' };
  }
  return impl.exportEntregaToSystem(entregaHeader, entregaLineas);
}

module.exports = {
  isEnabled,
  exportGate,
  exportCobroToSystem,
  exportLiquidacionToSystem,
  exportEntregaToSystem,
  CLV_CONCEPT_MAP,
};
