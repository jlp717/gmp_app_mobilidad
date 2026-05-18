#!/usr/bin/env node
/**
 * generate-vista-deuda-completa.js
 * 
 * Genera CREATE VIEW para JAVIER.VISTA_DEUDA_COMPLETA
 * Ancla: DSEDAC.CVC (deuda/vencimientos)
 * LEFT JOIN: CLIL1, CLCL1, CLIX, CRUT, VDDL1
 */

const fs = require('fs');
const path = require('path');

const discoveryPath = path.resolve(__dirname, 'results', 'dsedac-column-discovery.json');
const vistaDiscoveryPath = path.resolve(__dirname, 'results', 'vista-unificada-discovery.json');

const cvcDiscovery = JSON.parse(fs.readFileSync(discoveryPath, 'utf8'));
const vistaDiscovery = JSON.parse(fs.readFileSync(vistaDiscoveryPath, 'utf8'));

const TABLA_ANCLA = 'CVC';
const ANCLA_ALIAS = 'CVC';

const OMITIR = ['ID', 'MARCAACTUALIZACION'];

// Función helper
function getColumns(tableName, discoveryData, omit = OMITIR) {
  let data = discoveryData.results?.[tableName] || discoveryData[tableName];
  if (!data || data.error) return [];
  // data puede ser {columns: [...]} o directamente un array de columnas
  const cols = Array.isArray(data) ? data : (data.columns || []);
  return cols.filter(c => !omit.includes(c.COLUMN_NAME));
}

// Columnas de CVC
const cvcCols = getColumns('CVC', cvcDiscovery);
// Columnas de las tablas cliente
const cliCols = getColumns('CLIL1', vistaDiscovery);
const clcl1Cols = getColumns('CLCL1', vistaDiscovery);
const clixCols = getColumns('CLIX', vistaDiscovery);
const crutCols = getColumns('CRUT', vistaDiscovery);
const vddl1Cols = getColumns('VDDL1', vistaDiscovery);

// Tracking de columnas ya usadas
const used = new Set();

// Generar SQL
const lines = [];

lines.push('-- ============================================================================');
lines.push('-- VISTA DE DEUDA COMPLETA — Esquema JAVIER');
lines.push('-- Ancla: DSEDAC.CVC (deuda/vencimientos = 1 fila por registro de deuda)');
lines.push('-- LEFT JOIN: DSEDAC.CLIL1, CLCL1, CLIX, CRUT, VDDL1');
lines.push('-- Columnas duplicadas: prefijo de tabla origen');
lines.push('-- CRUT filtrado por SECUENCIA = 1');
lines.push('-- ID y MARCAACTUALIZACION omitidos (técnicos)');
lines.push(`-- Generado: ${new Date().toISOString()}`);
lines.push('-- ============================================================================');
lines.push('');
lines.push('CREATE VIEW JAVIER.VISTA_DEUDA_COMPLETA AS');
lines.push('SELECT');

// 1. CVC (ancla) — todas las columnas sin prefijo
lines.push('');
lines.push('  -- ═══ DSEDAC.CVC (ANCLA: Deuda / Vencimientos) ═══');
for (const col of cvcCols) {
  const name = col.COLUMN_NAME;
  lines.push(`  ${ANCLA_ALIAS}.${name},`);
  used.add(name);
}

// 2. CLIL1 (cliente maestro)
lines.push('');
lines.push('  -- ═══ DSEDAC.CLIL1 (Cliente maestro) ═══');
for (const col of cliCols) {
  const name = col.COLUMN_NAME;
  if (used.has(name)) {
    lines.push(`  CLIL1.${name} AS CLI_${name},`);
    used.add(`CLI_${name}`);
  } else {
    lines.push(`  CLIL1.${name},`);
    used.add(name);
  }
}

// 3. CLCL1 (condiciones crédito)
lines.push('');
lines.push('  -- ═══ DSEDAC.CLCL1 (Condiciones de crédito) ═══');
for (const col of clcl1Cols) {
  const name = col.COLUMN_NAME;
  if (used.has(name)) {
    lines.push(`  CLCL1.${name} AS CLCL1_${name},`);
    used.add(`CLCL1_${name}`);
  } else {
    lines.push(`  CLCL1.${name},`);
    used.add(name);
  }
}

// 4. CLIX (extensión)
lines.push('');
lines.push('  -- ═══ DSEDAC.CLIX (Extensión cliente) ═══');
for (const col of clixCols) {
  const name = col.COLUMN_NAME;
  if (used.has(name)) {
    lines.push(`  CLIX.${name} AS CLIX_${name},`);
    used.add(`CLIX_${name}`);
  } else {
    lines.push(`  CLIX.${name},`);
    used.add(name);
  }
}

// 5. CRUT (ruta, SECUENCIA=1)
lines.push('');
lines.push('  -- ═══ DSEDAC.CRUT (Datos ruta, SECUENCIA=1) ═══');
for (const col of crutCols) {
  const name = col.COLUMN_NAME;
  if (used.has(name)) {
    lines.push(`  CRUT.${name} AS RUT_${name},`);
    used.add(`RUT_${name}`);
  } else {
    lines.push(`  CRUT.${name},`);
    used.add(name);
  }
}

// 6. VDDL1 (vendedor — directo desde CVC.CODIGOVENDEDOR)
lines.push('');
lines.push('  -- ═══ DSEDAC.VDDL1 (Vendedor, vía CVC.CODIGOVENDEDOR) ═══');
for (const col of vddl1Cols) {
  const name = col.COLUMN_NAME;
  if (used.has(name)) {
    lines.push(`  VDDL1.${name} AS VDD_${name},`);
    used.add(`VDD_${name}`);
  } else {
    lines.push(`  VDDL1.${name},`);
    used.add(name);
  }
}

// Quitar última coma
const lastIdx = lines.length - 1;
lines[lastIdx] = lines[lastIdx].replace(/,$/, '');

// FROM y JOINS
lines.push(`FROM DSEDAC.${TABLA_ANCLA} ${ANCLA_ALIAS}`);
lines.push('');
lines.push('-- Cliente maestro: CODIGOCLIENTEALBARAN = CODIGOCLIENTE');
lines.push('LEFT JOIN DSEDAC.CLIL1 CLIL1');
lines.push('  ON TRIM(CLIL1.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
lines.push('');
lines.push('-- Condiciones de crédito');
lines.push('LEFT JOIN DSEDAC.CLCL1 CLCL1');
lines.push('  ON TRIM(CLCL1.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
lines.push('');
lines.push('-- Extensión cliente');
lines.push('LEFT JOIN DSEDAC.CLIX CLIX');
lines.push('  ON TRIM(CLIX.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
lines.push('');
lines.push('-- Datos ruta (secuencia principal)');
lines.push('LEFT JOIN DSEDAC.CRUT CRUT');
lines.push('  ON TRIM(CRUT.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
lines.push('  AND CRUT.SECUENCIA = 1');
lines.push('');
lines.push('-- Vendedor (directo desde CVC.CODIGOVENDEDOR, no vía CRUT)');
lines.push('LEFT JOIN DSEDAC.VDDL1 VDDL1');
lines.push('  ON TRIM(VDDL1.CODIGOVENDEDOR) = TRIM(CVC.CODIGOVENDEDOR);');

const sql = lines.join('\n');

// Guardar
const sqlPath = path.resolve(__dirname, 'sql', 'vista_deuda_completa.sql');
const mdPath = path.resolve(__dirname, '..', '..', 'VISTA_DEUDA_COMPLETA.md');

fs.mkdirSync(path.dirname(sqlPath), { recursive: true });
fs.writeFileSync(sqlPath, sql);
fs.writeFileSync(mdPath, '```sql\n' + sql + '\n```\n');

const totalCols = (sql.match(/,/g) || []).length;
console.log(`✅ Vista generada:`);
console.log(`   SQL:  ${sqlPath}`);
console.log(`   MD:   ${mdPath}`);
console.log(`   Columnas totales: ~${totalCols}`);
console.log(`   Ancla: CVC (1 fila por registro de deuda)`);
console.log(`   JOINs: CVC → CLIL1 → CLCL1 → CLIX → CRUT → VDDL1`);
