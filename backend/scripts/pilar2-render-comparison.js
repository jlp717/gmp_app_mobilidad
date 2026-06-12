'use strict';

/**
 * PILAR 2: render column-by-column comparison tables (Markdown, Spanish)
 * from tmp/db-exploration/pilar2-catalog-2026-06-11.json.
 * Format per table:
 * Columna | Tipo PROD | Null PROD | Default PROD | Tipo JAVIER | Null JAVIER | Default JAVIER | ¿Idéntico? | Acción
 */

const fs = require('fs');
const path = require('path');

const INPUT = path.resolve(__dirname, '..', 'tmp', 'db-exploration', 'pilar2-catalog-2026-06-11.json');
const OUTPUT = path.resolve(__dirname, '..', 'tmp', 'db-exploration', 'pilar2-comparison-2026-06-11.md');

const report = JSON.parse(fs.readFileSync(INPUT, 'utf8'));

function trim(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function typeSig(col) {
  const type = trim(col.DATA_TYPE);
  const precision = Number(col.NUMERIC_PRECISION || 0);
  const scale = Number(col.NUMERIC_SCALE || 0);
  const charLen = Number(col.CHARACTER_MAXIMUM_LENGTH || 0);
  if (['DECIMAL', 'NUMERIC'].includes(type)) return `${type}(${precision},${scale})`;
  if (['CHAR', 'VARCHAR', 'GRAPHIC', 'VARGRAPHIC', 'CLOB'].includes(type)) return `${type}(${charLen})`;
  return type;
}

function ccsid(col) {
  const value = col.CCSID;
  return value === null || value === undefined ? '-' : String(value);
}

function defaultOf(col) {
  const has = trim(col.HAS_DEFAULT);
  const def = trim(col.COLUMN_DEFAULT);
  if (has === 'N' && !def) return 'sin default';
  return def || (has ? `(HAS_DEFAULT=${has})` : 'sin default');
}

function nullable(col) {
  return trim(col.IS_NULLABLE) === 'Y' ? 'SI' : 'NO';
}

function isIdentical(prodCol, javCol) {
  return typeSig(prodCol) === typeSig(javCol)
    && ccsid(prodCol) === ccsid(javCol)
    && nullable(prodCol) === nullable(javCol)
    && normalizedDefault(prodCol) === normalizedDefault(javCol);
}

function normalizedDefault(col) {
  return defaultOf(col).replace(/\s+/g, ' ').toUpperCase();
}

const lines = [];

for (const pair of report.pairs) {
  const jav = pair.javier;
  const prod = pair.prod;
  lines.push(`### JAVIER.${jav.table} vs DSEDAC.${prod.table}`, '');
  if (!jav.exists || !prod.exists) {
    lines.push(`- EXISTE JAVIER: ${jav.exists} / EXISTE DSEDAC: ${prod.exists} -> BLOQUEO`, '');
    continue;
  }
  lines.push(`Columnas: DSEDAC.${prod.table}=${prod.columns.length}, JAVIER.${jav.table}=${jav.columns.length}`, '');
  lines.push('| Columna | Tipo PROD | CCSID PROD | Null PROD | Default PROD | Tipo JAVIER | CCSID JAVIER | Null JAVIER | Default JAVIER | ¿Idéntico? | Acción |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');

  const javByName = new Map(jav.columns.map(c => [trim(c.COLUMN_NAME), c]));
  const prodNames = new Set(prod.columns.map(c => trim(c.COLUMN_NAME)));
  let identicalCount = 0;
  const mismatches = [];

  for (const prodCol of prod.columns) {
    const name = trim(prodCol.COLUMN_NAME);
    const javCol = javByName.get(name);
    if (!javCol) {
      lines.push(`| ${name} | ${typeSig(prodCol)} | ${ccsid(prodCol)} | ${nullable(prodCol)} | ${defaultOf(prodCol)} | (no existe) | - | - | - | No | ADITIVA: ADD COLUMN |`);
      mismatches.push({ name, kind: 'MISSING_IN_JAVIER', prodCol });
      continue;
    }
    const same = isIdentical(prodCol, javCol);
    if (same) {
      identicalCount++;
      lines.push(`| ${name} | ${typeSig(prodCol)} | ${ccsid(prodCol)} | ${nullable(prodCol)} | ${defaultOf(prodCol)} | ${typeSig(javCol)} | ${ccsid(javCol)} | ${nullable(javCol)} | ${defaultOf(javCol)} | Sí | - |`);
    } else {
      const reasons = [];
      if (typeSig(prodCol) !== typeSig(javCol)) reasons.push('tipo');
      if (ccsid(prodCol) !== ccsid(javCol)) reasons.push('ccsid');
      if (nullable(prodCol) !== nullable(javCol)) reasons.push('nullable');
      if (normalizedDefault(prodCol) !== normalizedDefault(javCol)) reasons.push('default');
      lines.push(`| ${name} | ${typeSig(prodCol)} | ${ccsid(prodCol)} | ${nullable(prodCol)} | ${defaultOf(prodCol)} | ${typeSig(javCol)} | ${ccsid(javCol)} | ${nullable(javCol)} | ${defaultOf(javCol)} | No (${reasons.join(',')}) | VER ANALISIS |`);
      mismatches.push({ name, kind: reasons.join(','), prodCol, javCol });
    }
  }

  const appOnlyCols = jav.columns.filter(c => !prodNames.has(trim(c.COLUMN_NAME)));
  lines.push('');
  lines.push(`Resumen: ${identicalCount} idénticas, ${mismatches.length} desajustes, ${appOnlyCols.length} columnas solo-app en JAVIER.`);
  if (appOnlyCols.length) {
    lines.push('', `Columnas solo-app en JAVIER.${jav.table} (no existen en DSEDAC.${prod.table}, no bloquean):`);
    lines.push(appOnlyCols.map(c => `\`${trim(c.COLUMN_NAME)}\` ${typeSig(c)}${trim(c.IS_IDENTITY) === 'YES' ? ' IDENTITY' : ''}`).join(', '));
  }
  lines.push('');

  for (const side of [{ label: `DSEDAC.${prod.table}`, meta: prod }, { label: `JAVIER.${jav.table}`, meta: jav }]) {
    const cst = side.meta.constraints.map(c => `${trim(c.CONSTRAINT_TYPE)} ${trim(c.CONSTRAINT_NAME)} (${(c.COLUMNS || []).join(', ')})`).join('; ') || 'ninguna';
    const idx = side.meta.indexes.map(i => `${trim(i.INDEX_NAME)}${trim(i.IS_UNIQUE) !== 'D' && trim(i.IS_UNIQUE) ? ` [${trim(i.IS_UNIQUE)}]` : ''} (${(i.COLUMNS || []).join(', ')})`).join('; ') || 'ninguno';
    const trg = side.meta.triggers.map(t => `${trim(t.TRIGGER_NAME)} ${trim(t.ACTION_TIMING)} ${trim(t.EVENT_MANIPULATION)}`).join('; ') || 'ninguno';
    lines.push(`- ${side.label}: constraints: ${cst}`);
    lines.push(`- ${side.label}: índices: ${idx}`);
    lines.push(`- ${side.label}: triggers: ${trg}`);
  }
  lines.push('');
}

lines.push('## Tablas solo-app JAVIER (sin equivalente ERP por diseño)', '');
for (const table of report.appOnly) {
  if (!table.exists) {
    lines.push(`### JAVIER.${table.table}: NO EXISTE -> BLOQUEO`, '');
    continue;
  }
  lines.push(`### JAVIER.${table.table} (${table.columns.length} columnas)`, '');
  lines.push('| Columna | Tipo | CCSID | Null | Default | Identity |');
  lines.push('|---|---|---|---|---|---|');
  for (const col of table.columns) {
    lines.push(`| ${trim(col.COLUMN_NAME)} | ${typeSig(col)} | ${ccsid(col)} | ${nullable(col)} | ${defaultOf(col)} | ${trim(col.IS_IDENTITY) === 'YES' ? 'SI' : '-'} |`);
  }
  const cst = table.constraints.map(c => `${trim(c.CONSTRAINT_TYPE)} ${trim(c.CONSTRAINT_NAME)} (${(c.COLUMNS || []).join(', ')})`).join('; ') || 'ninguna';
  const idx = table.indexes.map(i => `${trim(i.INDEX_NAME)} (${(i.COLUMNS || []).join(', ')})`).join('; ') || 'ninguno';
  const trg = table.triggers.map(t => `${trim(t.TRIGGER_NAME)} ${trim(t.ACTION_TIMING)} ${trim(t.EVENT_MANIPULATION)}`).join('; ') || 'ninguno';
  lines.push('', `- Constraints: ${cst}`, `- Índices: ${idx}`, `- Triggers: ${trg}`, '');
}

lines.push('## Secuencias en JAVIER', '');
lines.push(report.sequences.length
  ? report.sequences.map(s => `- ${trim(s.SEQUENCE_NAME)} (${trim(s.DATA_TYPE)})`).join('\n')
  : '- ninguna (PEDIDOS_SEQ es tabla contador, no secuencia nativa)');
lines.push('', '## Vistas en JAVIER', '');
lines.push(report.views.length
  ? report.views.map(v => `- ${trim(v.TABLE_NAME)} (insertable: ${trim(v.IS_INSERTABLE_INTO)})`).join('\n')
  : '- ninguna');

fs.writeFileSync(OUTPUT, lines.join('\n') + '\n', 'utf8');
console.log(`[render] wrote ${OUTPUT}`);
