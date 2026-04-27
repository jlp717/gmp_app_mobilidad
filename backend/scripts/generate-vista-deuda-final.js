#!/usr/bin/env node
const odbc = require('odbc');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const CONN = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;CCSID=1208;';

const OMITIR = ['ID', 'MARCAACTUALIZACION'];

async function getColumns(conn, table) {
  const r = await conn.query(`
    SELECT COLUMN_NAME, COLUMN_TEXT, DATA_TYPE, LENGTH, NUMERIC_SCALE, ORDINAL_POSITION
    FROM QSYS2.SYSCOLUMNS
    WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${table}'
    ORDER BY ORDINAL_POSITION
  `);
  return r.filter(c => !OMITIR.includes(c.COLUMN_NAME));
}

(async () => {
  const pool = await odbc.pool(CONN);
  const conn = await pool.connect();

  const [cvcCols, cliCols, clcCols, clixCols, crutCols, vddCols] = await Promise.all([
    getColumns(conn, 'CVC'),
    getColumns(conn, 'CLI'),
    getColumns(conn, 'CLC'),
    getColumns(conn, 'CLIX'),
    getColumns(conn, 'CRUT'),
    getColumns(conn, 'VDD'),
  ]);

  const used = new Set();
  const lines = [];

  lines.push('-- ============================================================================');
  lines.push('-- VISTA DE DEUDA COMPLETA — Esquema JAVIER');
  lines.push('-- Ancla: DSEDAC.CVC (1 fila por registro de deuda/vencimiento)');
  lines.push('-- JOINs: DSEDAC.CLI, CLC, CLIX, CRUT, VDD');
  lines.push('-- Tablas FISICAS (PF) — archivos logicos (CLIL1,CLCL1,VDDL1) no sirven en vistas SQL');
  lines.push('-- Columnas duplicadas: prefijo de tabla origen (CLI_, CLC_, CLIX_, RUT_, VDD_)');
  lines.push('-- CRUT filtrado por SECUENCIA = 1');
  lines.push('-- ID y MARCAACTUALIZACION omitidos');
  lines.push(`-- Generado: ${new Date().toISOString()}`);
  lines.push('-- ============================================================================');
  lines.push('');
  lines.push('CREATE VIEW JAVIER.VISTA_DEUDA_COMPLETA AS');
  lines.push('SELECT');

  function addCol(alias, col, forcePrefix = false) {
    const name = col.COLUMN_NAME;
    const needsPrefix = forcePrefix || used.has(name);
    if (needsPrefix) {
      lines.push(`  ${alias}.${name} AS ${alias}_${name},`);
      used.add(`${alias}_${name}`);
    } else {
      lines.push(`  ${alias}.${name},`);
      used.add(name);
    }
  }

  // 1. CVC — ancla
  lines.push('');
  lines.push('  -- ═══ DSEDAC.CVC (ANCLA: Deuda / Vencimientos) ═══');
  for (const col of cvcCols) {
    lines.push(`  CVC.${col.COLUMN_NAME},`);
    used.add(col.COLUMN_NAME);
  }

  // 2. CLI — cliente maestro
  lines.push('');
  lines.push('  -- ═══ DSEDAC.CLI (Cliente maestro) ═══');
  for (const col of cliCols) {
    addCol('CLI', col);
  }

  // 3. CLC — condiciones de crédito
  lines.push('');
  lines.push('  -- ═══ DSEDAC.CLC (Condiciones de crédito) ═══');
  for (const col of clcCols) {
    addCol('CLC', col);
  }

  // 4. CLIX — extensión
  lines.push('');
  lines.push('  -- ═══ DSEDAC.CLIX (Extensión cliente) ═══');
  for (const col of clixCols) {
    addCol('CLIX', col);
  }

  // 5. CRUT — datos ruta
  lines.push('');
  lines.push('  -- ═══ DSEDAC.CRUT (Datos ruta, SECUENCIA=1) ═══');
  for (const col of crutCols) {
    addCol('CRUT', col);
  }

  // 6. VDD — vendedor
  lines.push('');
  lines.push('  -- ═══ DSEDAC.VDD (Vendedor, via CVC.CODIGOVENDEDOR) ═══');
  for (const col of vddCols) {
    addCol('VDD', col);
  }

  // Quitar última coma
  const lastIdx = lines.length - 1;
  lines[lastIdx] = lines[lastIdx].replace(/,$/, '');

  // FROM + JOINs
  lines.push('FROM DSEDAC.CVC CVC');
  lines.push('LEFT JOIN DSEDAC.CLI CLI');
  lines.push('  ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
  lines.push('LEFT JOIN DSEDAC.CLC CLC');
  lines.push('  ON TRIM(CLC.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
  lines.push('LEFT JOIN DSEDAC.CLIX CLIX');
  lines.push('  ON TRIM(CLIX.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
  lines.push('LEFT JOIN DSEDAC.CRUT CRUT');
  lines.push('  ON TRIM(CRUT.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)');
  lines.push('  AND CRUT.SECUENCIA = 1');
  lines.push('LEFT JOIN DSEDAC.VDD VDD');
  lines.push('  ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(CVC.CODIGOVENDEDOR);');

  const sql = lines.join('\n');

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
  console.log(`   Tablas PF: CVC, CLI, CLC, CLIX, CRUT, VDD`);

  // Verificar colisiones resueltas
  const collisionCols = ['CUENTABANCO', 'CODIGOPAIS', 'IBAN01', 'IBAN02', 'IBAN03', 'IBAN04', 'IBAN05', 'IBAN06',
    'DIRECCIONBANCO', 'CODIGOPOSTALBANCO', 'SECUENCIACODIGOPOSTALBANCO', 'POBLACIONBANCO', 'PROVINCIABANCO',
    'CODIGOCLIENTE', 'CODIGOCLIENTEFACTURA', 'CODIGORUTA', 'CODIGOIVA', 'CODIGOVENDEDOR',
    'OBSERVACIONES', 'CLAVE1', 'CLAVE2'];
  console.log('\n📋 Colisiones verificadas en SQL:');
  for (const cc of collisionCols) {
    const regex = new RegExp(`AS \\w+_${cc}`, 'g');
    const matches = sql.match(regex);
    if (matches) {
      console.log(`   ${cc} → ${matches.join(', ')}`);
    }
  }

  await conn.close();
  await pool.close();
})();
