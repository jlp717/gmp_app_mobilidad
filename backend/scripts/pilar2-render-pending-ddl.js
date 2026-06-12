'use strict';

/**
 * PILAR 2: render the exact PENDING (NOT applied) DDL plan for the non-additive
 * nullability/default mismatches between JAVIER write-tables and DSEDAC.
 * Reads tmp/db-exploration/pilar2-catalog-2026-06-11.json. Output: markdown to stdout.
 * THIS SCRIPT EXECUTES NOTHING — documentation only.
 */

const fs = require('fs');
const path = require('path');

const INPUT = path.resolve(__dirname, '..', 'tmp', 'db-exploration', 'pilar2-catalog-2026-06-11.json');
const report = JSON.parse(fs.readFileSync(INPUT, 'utf8'));

const trim = v => (v === null || v === undefined ? '' : String(v).trim());

function typeSig(col) {
  const type = trim(col.DATA_TYPE);
  const precision = Number(col.NUMERIC_PRECISION || 0);
  const scale = Number(col.NUMERIC_SCALE || 0);
  const charLen = Number(col.CHARACTER_MAXIMUM_LENGTH || 0);
  if (['DECIMAL', 'NUMERIC'].includes(type)) return `${type}(${precision},${scale})`;
  if (['CHAR', 'VARCHAR', 'GRAPHIC', 'VARGRAPHIC', 'CLOB'].includes(type)) return `${type}(${charLen})`;
  return type;
}

function defaultLiteral(col) {
  const def = trim(col.COLUMN_DEFAULT);
  if (def) return def;
  const type = trim(col.DATA_TYPE);
  if (['CHAR', 'VARCHAR', 'GRAPHIC', 'VARGRAPHIC'].includes(type)) return "' '";
  if (type === 'TIMESTMP' || type === 'TIMESTAMP') return 'CURRENT_TIMESTAMP';
  if (type === 'DATE') return 'CURRENT_DATE';
  return '0';
}

for (const pair of report.pairs) {
  const jav = pair.javier;
  const prod = pair.prod;
  const javByName = new Map(jav.columns.map(c => [trim(c.COLUMN_NAME), c]));
  const statements = [];

  for (const prodCol of prod.columns) {
    const name = trim(prodCol.COLUMN_NAME);
    const javCol = javByName.get(name);
    if (!javCol) continue;
    const prodNotNull = trim(prodCol.IS_NULLABLE) === 'N';
    const javNullable = trim(javCol.IS_NULLABLE) === 'Y';
    if (prodNotNull && javNullable) {
      const def = defaultLiteral(prodCol);
      statements.push(`UPDATE JAVIER.${jav.table} SET ${name} = ${def} WHERE ${name} IS NULL;`);
      statements.push(`ALTER TABLE JAVIER.${jav.table} ALTER COLUMN ${name} SET DEFAULT ${def};`);
      statements.push(`ALTER TABLE JAVIER.${jav.table} ALTER COLUMN ${name} SET NOT NULL;`);
    }
  }

  if (statements.length) {
    console.log(`-- ============================================================`);
    console.log(`-- JAVIER.${jav.table} (referencia DSEDAC.${prod.table}): ${statements.length / 3} columnas NOT NULL pendientes`);
    console.log(`-- ============================================================`);
    for (const statement of statements) console.log(statement);
    console.log('');
  }
}
