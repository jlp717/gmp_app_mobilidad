#!/usr/bin/env node
/**
 * generate-vista-unificada-sql.js
 * 
 * Genera el CREATE VIEW SQL para JAVIER.VISTA_CLIENTES_UNIFICADA
 * combinando las 5 tablas: VDDL1, CLCL1, CLIX, CRUT, CLIL1
 * 
 * Lógica de deduplicación de columnas:
 *   - Columnas presentes en CLIL1 (tabla base) → sin prefijo
 *   - Columnas repetidas en otras tablas → prefijo de la tabla
 *   - Columnas ID y MARCAACTUALIZACION → se omiten
 *   - CRUT filtrado por SECUENCIA = 1
 */

const fs = require('fs');
const path = require('path');

const discoveryPath = path.resolve(__dirname, 'results', 'vista-unificada-discovery.json');
const discovery = JSON.parse(fs.readFileSync(discoveryPath, 'utf8'));

const TABLA_BASE = 'CLIL1';
const TABLAS_JOIN = [
  { table: 'CLCL1', joinOn: 'CODIGOCLIENTE' },
  { table: 'CLIX', joinOn: 'CODIGOCLIENTE' },
  { table: 'CRUT', joinOn: 'CODIGOCLIENTE', extraFilter: 'CRUT.SECUENCIA = 1' },
  { table: 'VDDL1', joinOn: 'CODIGOVENDEDOR', joinVia: 'CRUT', joinViaCol: 'CODIGOVENDEDOR' },
];

// Columnas técnicas a omitir
const OMITIR = ['ID', 'MARCAACTUALIZACION'];

// Obtener columnas de una tabla
function getColumns(tableName) {
  const data = discovery.results[tableName];
  if (!data || data.error) return [];
  return (data.columns || []).map(c => c.COLUMN_NAME);
}

// Columnas de la tabla base (sin omitir)
const baseColumns = getColumns(TABLA_BASE).filter(c => !OMITIR.includes(c));

// Mapa para tracking: qué columnas ya se usaron
const usedColumns = new Set(baseColumns);

// SQL builder
let sql = `-- ============================================================================\n`;
sql += `-- VISTA UNIFICADA DE CLIENTES - Esquema JAVIER\n`;
sql += `-- Combina: DSEDAC.CLIL1 (base) + CLCL1 + CLIX + CRUT + VDDL1\n`;
sql += `-- Columnas duplicadas se prefijan con el alias de la tabla de origen\n`;
sql += `-- CRUT filtrado por SECUENCIA = 1 (ruta principal)\n`;
sql += `-- Columnas ID y MARCAACTUALIZACION omitidas por ser técnicas\n`;
sql += `-- Generado: ${new Date().toISOString()}\n`;
sql += `-- ============================================================================\n\n`;

sql += `CREATE OR REPLACE VIEW JAVIER.VISTA_CLIENTES_UNIFICADA AS\n`;
sql += `SELECT\n`;

// 1. Columnas de CLIL1 (base) - sin prefijo
const baseAlias = TABLA_BASE;
const baseColDefs = discovery.results[TABLA_BASE].columns.filter(c => !OMITIR.includes(c.COLUMN_NAME));

for (let i = 0; i < baseColDefs.length; i++) {
  const col = baseColDefs[i];
  const isLast = false; // placeholder
  sql += `  ${baseAlias}.${col.COLUMN_NAME}`;
  sql += `, -- ${(col.COLUMN_TEXT || '').trim()}`;
  sql += `\n`;
}

sql += `\n  -- ═══ DSEDAC.CLCL1 (Condiciones de crédito) ═══\n`;

// 2. Columnas de CLCL1
const clcl1Cols = discovery.results['CLCL1'].columns.filter(c => !OMITIR.includes(c.COLUMN_NAME));
for (const col of clcl1Cols) {
  if (usedColumns.has(col.COLUMN_NAME)) {
    sql += `  CLCL1.${col.COLUMN_NAME} AS CLCL1_${col.COLUMN_NAME}`;
  } else {
    sql += `  CLCL1.${col.COLUMN_NAME}`;
    usedColumns.add(col.COLUMN_NAME);
  }
  sql += `, -- ${(col.COLUMN_TEXT || '').trim()}`;
  sql += `\n`;
}

sql += `\n  -- ═══ DSEDAC.CLIX (Extensión de clientes) ═══\n`;

// 3. Columnas de CLIX
const clixCols = discovery.results['CLIX'].columns.filter(c => !OMITIR.includes(c.COLUMN_NAME));
for (const col of clixCols) {
  if (usedColumns.has(col.COLUMN_NAME)) {
    sql += `  CLIX.${col.COLUMN_NAME} AS CLIX_${col.COLUMN_NAME}`;
  } else {
    sql += `  CLIX.${col.COLUMN_NAME}`;
    usedColumns.add(col.COLUMN_NAME);
  }
  sql += `, -- ${(col.COLUMN_TEXT || '').trim()}`;
  sql += `\n`;
}

sql += `\n  -- ═══ DSEDAC.CRUT (Datos de ruta, SECUENCIA=1) ═══\n`;

// 4. Columnas de CRUT
const crutCols = discovery.results['CRUT'].columns.filter(c => !OMITIR.includes(c.COLUMN_NAME));
for (const col of crutCols) {
  // CODIGOVENDEDOR se maneja especial: presente en CRUT y VDDL1
  if (col.COLUMN_NAME === 'CODIGOVENDEDOR') {
    sql += `  CRUT.CODIGOVENDEDOR AS RUT_CODIGOVENDEDOR, -- Vendedor asignado en ruta\n`;
    usedColumns.add('RUT_CODIGOVENDEDOR');
    continue;
  }
  if (usedColumns.has(col.COLUMN_NAME)) {
    sql += `  CRUT.${col.COLUMN_NAME} AS RUT_${col.COLUMN_NAME}`;
  } else {
    sql += `  CRUT.${col.COLUMN_NAME}`;
    usedColumns.add(col.COLUMN_NAME);
  }
  sql += `, -- ${(col.COLUMN_TEXT || '').trim()}`;
  sql += `\n`;
}

sql += `\n  -- ═══ DSEDAC.VDDL1 (Vendedores, vía CRUT.CODIGOVENDEDOR) ═══\n`;

// 5. Columnas de VDDL1
const vddl1Cols = discovery.results['VDDL1'].columns.filter(c => !OMITIR.includes(c.COLUMN_NAME));
for (const col of vddl1Cols) {
  // CODIGOVENDEDOR de VDDL1 es igual al de CRUT (por el JOIN), no lo duplicamos
  if (col.COLUMN_NAME === 'CODIGOVENDEDOR') {
    continue; // Ya está como RUT_CODIGOVENDEDOR
  }
  if (usedColumns.has(col.COLUMN_NAME)) {
    sql += `  VDDL1.${col.COLUMN_NAME} AS VDD_${col.COLUMN_NAME}`;
  } else {
    sql += `  VDDL1.${col.COLUMN_NAME}`;
    usedColumns.add(col.COLUMN_NAME);
  }
  sql += `, -- ${(col.COLUMN_TEXT || '').trim()}`;
  sql += `\n`;
}

// Quitar última coma (antes del FROM)
// Find the last comma that appears before a FROM clause preceded only by whitespace/comments
const lines = sql.split('\n');
for (let i = lines.length - 1; i >= 0; i--) {
  const line = lines[i];
  if (line.trim().startsWith('--') || line.trim() === '') continue;
  if (line.trim().endsWith(',')) {
    lines[i] = line.trim().replace(/,\s*$/, '');
    break;
  }
  if (line.trim().startsWith('FROM')) break;
}
sql = lines.join('\n') + '\n';

// FROM y JOINS
sql += `FROM DSEDAC.${TABLA_BASE} ${TABLA_BASE}\n`;

// CLCL1
sql += `LEFT JOIN DSEDAC.CLCL1 CLCL1\n`;
sql += `  ON TRIM(CLCL1.CODIGOCLIENTE) = TRIM(${TABLA_BASE}.CODIGOCLIENTE)\n`;

// CLIX
sql += `LEFT JOIN DSEDAC.CLIX CLIX\n`;
sql += `  ON TRIM(CLIX.CODIGOCLIENTE) = TRIM(${TABLA_BASE}.CODIGOCLIENTE)\n`;

// CRUT
sql += `LEFT JOIN DSEDAC.CRUT CRUT\n`;
sql += `  ON TRIM(CRUT.CODIGOCLIENTE) = TRIM(${TABLA_BASE}.CODIGOCLIENTE)\n`;
sql += `  AND CRUT.SECUENCIA = 1\n`;

// VDDL1 (vía CRUT)
sql += `LEFT JOIN DSEDAC.VDDL1 VDDL1\n`;
sql += `  ON TRIM(VDDL1.CODIGOVENDEDOR) = TRIM(CRUT.CODIGOVENDEDOR);\n`;

// Guardar
const outputPath = path.resolve(__dirname, 'sql', 'vista_clientes_unificada.sql');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, sql);

// Contar columnas totales
const totalCols = (sql.match(/, --/g) || []).length + 1;
console.log(`✅ Vista generada: ${outputPath}`);
console.log(`   Tablas: ${['CLIL1', 'CLCL1', 'CLIX', 'CRUT', 'VDDL1'].join(', ')}`);
console.log(`   JOIN: CLIL1 → CLCL1(CODIGOCLIENTE) → CLIX(CODIGOCLIENTE) → CRUT(CODIGOCLIENTE, SECUENCIA=1) → VDDL1(CODIGOVENDEDOR)`);
console.log(`   Columnas totales: ~${totalCols}`);
console.log(`   Colisiones resueltas con prefijos: CLCL1_, CLIX_, RUT_, VDD_`);

// También guardar el análisis de mapeo
const mappingReport = {
  vista: 'JAVIER.VISTA_CLIENTES_UNIFICADA',
  tablas: {
    CLIL1: { alias: 'CLIL1', columnas: baseColumns.length, rol: 'BASE (cliente maestro)' },
    CLCL1: { alias: 'CLCL1', columnas: clcl1Cols.length, join: 'CODIGOCLIENTE', rol: 'Condiciones crédito' },
    CLIX: { alias: 'CLIX', columnas: clixCols.length, join: 'CODIGOCLIENTE', rol: 'Extensión cliente' },
    CRUT: { alias: 'CRUT', columnas: crutCols.length, join: 'CODIGOCLIENTE', filtro: 'SECUENCIA = 1', rol: 'Datos ruta' },
    VDDL1: { alias: 'VDDL1', columnas: vddl1Cols.length, join: 'CODIGOVENDEDOR (vía CRUT)', rol: 'Vendedor' },
  },
  colisiones_resueltas: [],
  columnas_omitidas: OMITIR,
  sql_file: outputPath,
};

fs.writeFileSync(
  path.resolve(__dirname, 'results', 'vista-unificada-mapping.json'),
  JSON.stringify(mappingReport, null, 2)
);

console.log(`\n📋 Mapping report: backend/scripts/results/vista-unificada-mapping.json`);
