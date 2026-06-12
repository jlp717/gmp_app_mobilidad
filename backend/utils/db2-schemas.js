'use strict';

/**
 * Central DB2 read/write schema resolution.
 *
 * - ERP reads (CLI, CVC, ART, deuda, etc.) always use DB2_READ_SCHEMA (default DSEDAC).
 * - App writes (pedidos, cobros, bolsa) use DB2_WRITE_SCHEMA (default JAVIER).
 * - DSEDAC writes require PEDIDOS_DSEDAC_STORAGE_APPROVED=true (safety gate).
 *
 * Legacy env vars PEDIDOS_CONFIRMATION_SCHEMA / PEDIDOS_ERP_SCHEMA are fallbacks
 * when DB2_WRITE_SCHEMA is unset.
 */

const { db2Schema, db2QualifiedTable } = require('./db2-identifiers');

const ERP_NUMERIC_10_2_MAX = 99999999.99;

/** B3 — accepted semantic mismatch (JAVIER.COBROS.ID UUID vs DSEDAC.CRC.ID integer). */
const ACCEPTED_SEMANTIC_TYPE_MISMATCHES = Object.freeze([
  {
    test: 'JAVIER.COBROS',
    production: 'DSEDAC.CRC',
    column: 'ID',
    category: 'SEMANTIC_OVERRIDE',
    reason:
      'JAVIER.COBROS.ID is the app UUID/idempotency token; DSEDAC.CRC.ID is the ERP integer identifier. Export uses CRC.IDMARCALIQUIDACION (truncated to 30 chars).',
  },
]);

function normalizeBool(value) {
  return String(value || 'false').trim().toLowerCase() === 'true';
}

function getDb2ReadSchema() {
  return db2Schema(
    process.env.DB2_READ_SCHEMA || process.env.ERP_READ_SCHEMA || 'DSEDAC',
    'DB2_READ_SCHEMA',
  );
}

function getDb2WriteSchemaRequested() {
  const raw =
    process.env.DB2_WRITE_SCHEMA ||
    process.env.PEDIDOS_CONFIRMATION_SCHEMA ||
    process.env.PEDIDOS_ERP_SCHEMA ||
    'JAVIER';
  return db2Schema(raw, 'DB2_WRITE_SCHEMA');
}

function isDsedacWriteApproved() {
  return normalizeBool(process.env.PEDIDOS_DSEDAC_STORAGE_APPROVED);
}

/**
 * Effective schema for INSERT/UPDATE/DELETE on app tables (PEDIDOS_*, COBROS, BOLSA_*).
 * Falls back to JAVIER when DSEDAC is requested without explicit approval.
 */
function getDb2WriteSchema() {
  const requested = getDb2WriteSchemaRequested();
  if (requested === 'DSEDAC' && !isDsedacWriteApproved()) {
    return 'JAVIER';
  }
  return requested;
}

function db2WriteTable(table) {
  return db2QualifiedTable(getDb2WriteSchema(), table);
}

function db2ErpTable(table) {
  return db2QualifiedTable(getDb2ReadSchema(), table);
}

/** B2 guard — CPC/LPC money columns are NUMERIC(10,2) in DSEDAC. */
function assertMoneyFitsErpNumeric10_2(value, fieldName, context) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`[DB2] ${fieldName} invalido${context ? ` (${context})` : ''}`);
  }
  if (Math.abs(num) > ERP_NUMERIC_10_2_MAX) {
    throw new Error(
      `[DB2] ${fieldName} fuera de rango ERP NUMERIC(10,2)${context ? ` (${context})` : ''}: ${num}`,
    );
  }
}

function assertMoneyFitsWriteSchema(value, fieldName, context) {
  if (getDb2WriteSchema() === 'DSEDAC') {
    assertMoneyFitsErpNumeric10_2(value, fieldName, context);
  }
}

module.exports = {
  ACCEPTED_SEMANTIC_TYPE_MISMATCHES,
  ERP_NUMERIC_10_2_MAX,
  getDb2ReadSchema,
  getDb2WriteSchema,
  getDb2WriteSchemaRequested,
  isDsedacWriteApproved,
  db2WriteTable,
  db2ErpTable,
  assertMoneyFitsErpNumeric10_2,
  assertMoneyFitsWriteSchema,
};
