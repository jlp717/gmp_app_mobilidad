'use strict';

/**
 * SQL identifier whitelist (auditoria Tier-1).
 *
 * Los valores NO se pueden bindear con `?` cuando son identificadores
 * (tablas, columnas, fragmentos SELECT/GROUP BY fijos). Todo SQL que
 * interpole identificadores debe pasar por `assertIdentifier()` primero.
 * Rechaza con ValidationError (400) cualquier nombre fuera de la lista.
 */

class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.code = 'INVALID_SQL_IDENTIFIER';
    if (details !== undefined) this.details = details;
  }
}

// Tablas cualificadas interpoladas en objectives.js (fallback FI/FAM via
// comercialErpTable, que puede resolver a DSEDAC.* o JAVIER.TEST_*) y en
// warehouse.js (tablas JAVIER.ALMACEN_* internas de safeCreateTable/alterCols).
const ALLOWED_SQL_TABLES = Object.freeze([
  'DSEDAC.FAM',
  'DSEDAC.FI1',
  'DSEDAC.FI2',
  'DSEDAC.FI3',
  'DSEDAC.FI4',
  'DSEDAC.FI5',
  'JAVIER.TEST_FAM',
  'JAVIER.TEST_FI1',
  'JAVIER.TEST_FI2',
  'JAVIER.TEST_FI3',
  'JAVIER.TEST_FI4',
  'JAVIER.TEST_FI5',
  'JAVIER.ALMACEN_CAMIONES_CONFIG',
  'JAVIER.ALMACEN_ART_DIMENSIONES',
  'JAVIER.ALMACEN_PERSONAL',
  'JAVIER.ALMACEN_CARGA_HISTORICO',
  'JAVIER.ALMACEN_CARGA_MANUAL',
  'JAVIER.ALMACEN_CONFIG_GLOBAL',
]);

// Columnas interpoladas en warehouse.js (alterCols: `SELECT ${col} FROM ...`
// con col de lista interna fija).
const ALLOWED_SQL_COLUMNS = Object.freeze([
  'FRAGIL',
  'APILABLE',
  'TEMPERATURA',
  'MAX_APILADO',
  'IMPORTE_TOTAL',
  'MARGEN_TOTAL',
  'DETALLES_JSON',
]);

// Fragmentos SELECT/GROUP BY fijos interpolados en clients.js
// (familySelects / familyGroupBy derivan de familyLevel ya clampado,
// pero el fragmento SQL final pasa por whitelist explicita).
const ALLOWED_SQL_FRAGMENTS = Object.freeze([
  'TRIM(A.CODIGOFAMILIA) as family1',
  "COALESCE(NULLIF(TRIM(A.CODIGOSUBFAMILIA), ''), 'General') as family2",
  "COALESCE(NULLIF(TRIM(A.CODIGOPREFAMILIA), ''), 'General') as family3",
  'A.CODIGOFAMILIA',
  'A.CODIGOSUBFAMILIA',
  'A.CODIGOPREFAMILIA',
]);

// Niveles de jerarquia del groupBy de dashboard.js (matrix-data).
// El SELECT/GROUP BY se construye solo con estos tokens.
const ALLOWED_MATRIX_LEVELS = Object.freeze([
  'vendor',
  'client',
  'product',
  'productcode',
  'productdesc',
  'family',
  'family1',
  'family2',
  'family3',
  'family4',
  'family5',
  'subfamily',
]);

const ALLOWED_SQL_IDENTIFIERS = Object.freeze([
  ...ALLOWED_SQL_TABLES,
  ...ALLOWED_SQL_COLUMNS,
  ...ALLOWED_SQL_FRAGMENTS,
  ...ALLOWED_MATRIX_LEVELS,
]);

const ALLOWED_SQL_IDENTIFIERS_SET = new Set(
  ALLOWED_SQL_IDENTIFIERS.map((entry) => entry.toUpperCase()),
);

/**
 * Valida un identificador contra la whitelist explicita.
 * @param {*} name identificador a validar
 * @param {string} [label] etiqueta para el mensaje de error
 * @returns {string} el identificador original (sin normalizar) si esta permitido
 * @throws {ValidationError} si no esta en la whitelist
 */
function assertIdentifier(name, label = 'SQL identifier') {
  const raw = String(name == null ? '' : name).trim();
  if (!raw || !ALLOWED_SQL_IDENTIFIERS_SET.has(raw.toUpperCase())) {
    throw new ValidationError(`${label} no permitido`);
  }
  return String(name).trim();
}

module.exports = {
  ValidationError,
  ALLOWED_SQL_TABLES,
  ALLOWED_SQL_COLUMNS,
  ALLOWED_SQL_FRAGMENTS,
  ALLOWED_MATRIX_LEVELS,
  ALLOWED_SQL_IDENTIFIERS,
  assertIdentifier,
};
