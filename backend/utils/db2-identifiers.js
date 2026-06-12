/**
 * DB2 identifier guards.
 *
 * Values cannot be parameter-bound in DB2 when they are identifiers
 * (schema, table, column names). Any SQL that interpolates identifiers must
 * pass through this whitelist/shape guard first.
 */

const ALLOWED_APP_SCHEMAS = new Set(['JAVIER', 'DSEDAC']);
const DB2_IDENTIFIER_RE = /^[A-Z][A-Z0-9_#$@]{0,127}$/;

function db2Identifier(value, label = 'DB2 identifier', allowedValues) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!DB2_IDENTIFIER_RE.test(normalized)) {
    throw new Error(`${label} invalido: ${normalized || '(vacio)'}`);
  }
  if (allowedValues && !allowedValues.has(normalized)) {
    throw new Error(`${label} no permitido: ${normalized}`);
  }
  return normalized;
}

function db2Schema(value, label = 'DB2 schema') {
  return db2Identifier(value, label, ALLOWED_APP_SCHEMAS);
}

function db2QualifiedTable(schema, table) {
  return `${db2Schema(schema)}.${db2Identifier(table, 'DB2 table')}`;
}

function db2QualifiedTableName(value) {
  const parts = String(value || '').trim().toUpperCase().split('.');
  if (parts.length !== 2) {
    throw new Error(`DB2 qualified table invalida: ${value || '(vacia)'}`);
  }
  return db2QualifiedTable(parts[0], parts[1]);
}

function db2ColumnList(columns) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('Lista de columnas DB2 vacia');
  }
  return columns.map((column) => db2Identifier(column, 'DB2 column')).join(', ');
}

function db2Placeholders(columns) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('Lista de columnas DB2 vacia para placeholders');
  }
  return columns.map(() => '?').join(', ');
}

function db2InsertSql(qualifiedTable, columns) {
  return `INSERT INTO ${db2QualifiedTableName(qualifiedTable)} (${db2ColumnList(columns)}) VALUES (${db2Placeholders(columns)})`;
}

module.exports = {
  db2Identifier,
  db2Schema,
  db2QualifiedTable,
  db2QualifiedTableName,
  db2ColumnList,
  db2Placeholders,
  db2InsertSql,
};
