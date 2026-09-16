'use strict';

/**
 * Copy commercial ERP catalogs into JAVIER.TEST_* (isolated_test HIT).
 * NEVER writes DSEDAC / DSED.LACLAE. Uses CREATE TABLE LIKE without IDENTITY.
 *
 * Isomorphic app buffers (PEDIDOS_CAB/LIN, COBROS) remain in copy-javier-prod-to-test.js.
 *
 *   node backend/scripts/copy-comercial-erp-to-test.js
 *   node backend/scripts/copy-comercial-erp-to-test.js --apply
 *   node backend/scripts/copy-comercial-erp-to-test.js --apply --replace
 *   node backend/scripts/copy-comercial-erp-to-test.js --apply --server-full --replace --only=CVC,CAC,CPC,LPC,LACLAE,ARA,LAC,CLI
 *
 * --server-full: INSERT SELECT in DB2 (no row fetch to the client). Ignore 80k cap.
 * LPC join uses pedido keys (LPC has no EJERCICIOALBARAN — SQL0205).
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

if (!process.env.DB_QUERY_TIMEOUT_MS) {
  process.env.DB_QUERY_TIMEOUT_MS = '3600000';
}

const { initDb, closePool, query, queryWithParams } = require('../config/db');
const { comercialErpWriteForbiddenSql } = require('../utils/comercial-erp-tables');

const APPLY = process.argv.includes('--apply');
const REPLACE = process.argv.includes('--replace');
const TRY_FULL = process.argv.includes('--full');
const SERVER_FULL = process.argv.includes('--server-full') || TRY_FULL;
const APPEND = process.argv.includes('--append');
const HIT_VENDORS = ['80', '35', '98', '02', '03', '81', '97', '72', '73', '83'];
const CORE_VENDORS = ['80', '35', '98'];
const LARGE_FULL_MAX = 80000;
const SCOPED_FETCH = 25000;
const onlyArg = process.argv.find((a) => a.startsWith('--only=') || a.startsWith('--tables='));
const ONLY_KEYS = onlyArg
  ? new Set(onlyArg.split('=')[1].split(',').map((token) => token.trim().toUpperCase()).filter(Boolean))
  : null;
const columnCache = new Map();

function jobSelected(job) {
  if (!ONLY_KEYS || ONLY_KEYS.size === 0) return true;
  const destName = String(job.dest || '').split('.')[1] || '';
  const logical = destName.replace(/^TEST_/, '');
  const sourceName = String(job.source || '').split('.')[1] || '';
  return ONLY_KEYS.has(destName)
    || ONLY_KEYS.has(logical)
    || ONLY_KEYS.has(sourceName)
    || ONLY_KEYS.has(job.dest)
    || ONLY_KEYS.has(job.source);
}

function safeIdent(name) {
  const ident = String(name || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*$/.test(ident)) {
    throw new Error(`Refusing unsafe SQL identifier: ${name}`);
  }
  return ident;
}

function intersectColumnNames(srcCols, dstCols) {
  const dest = new Set((dstCols || []).map((col) => safeIdent(col)));
  return (srcCols || [])
    .map((col) => safeIdent(col))
    .filter((col) => dest.has(col));
}

function buildInsertSelectSql(dest, source, columns, whereSql = '') {
  assertJavierTest(dest);
  const cols = (columns || []).map((col) => safeIdent(col));
  if (!cols.length) {
    throw new Error(`No intersecting columns for ${dest} <- ${source}`);
  }
  const list = cols.join(', ');
  const where = whereSql ? ` ${whereSql}` : '';
  return `INSERT INTO ${dest} (${list}) SELECT ${list} FROM ${source}${where}`;
}

function n(row, key) {
  const wanted = String(key).toUpperCase();
  for (const [k, v] of Object.entries(row || {})) {
    if (String(k).toUpperCase() === wanted) return v;
  }
  return undefined;
}

function trim(value) {
  return String(value == null ? '' : value).trim();
}

function refuseErpWrite(sql) {
  if (comercialErpWriteForbiddenSql(sql)) {
    throw new Error(`Refusing ERP write SQL: ${String(sql).slice(0, 160)}`);
  }
}

function assertJavierTest(table) {
  const t = String(table || '').toUpperCase();
  if (!t.startsWith('JAVIER.TEST_')) {
    throw new Error(`Refusing non-TEST write target: ${table}`);
  }
}

function odbcDetail(error) {
  const odbc = Array.isArray(error?.odbcErrors) ? error.odbcErrors : [];
  const first = odbc[0] || {};
  return {
    message: String(error?.message || error).slice(0, 220),
    state: first.state || error?.state || null,
    native: String(first.message || '').slice(0, 220) || null,
  };
}

async function safe(sql, params = []) {
  try {
    refuseErpWrite(sql);
    return { ok: true, rows: params.length ? await queryWithParams(sql, params) : await query(sql) };
  } catch (error) {
    return { ok: false, error: odbcDetail(error), rows: [] };
  }
}

async function execWrite(sql) {
  refuseErpWrite(sql);
  if (!APPLY) return { ok: true, dry: true };
  try {
    await query(sql);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: odbcDetail(error) };
  }
}

async function tableInfo(schema, table) {
  const exists = await safe(
    `SELECT TABLE_TYPE FROM QSYS2.SYSTABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      FETCH FIRST 1 ROW ONLY`,
    [schema, table],
  );
  if (!exists.ok) return { schema, table, error: exists.error };
  if (!(exists.rows || []).length) return { schema, table, exists: false, count: 0 };
  const count = await safe(`SELECT COUNT(*) AS N FROM ${schema}.${table}`);
  const cols = await safe(
    `SELECT TRIM(COLUMN_NAME) AS COLUMN_NAME, IDENTITY
       FROM QSYS2.SYSCOLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  const names = (cols.rows || []).map((row) => trim(n(row, 'COLUMN_NAME'))).filter(Boolean);
  return {
    schema,
    table,
    exists: true,
    count: count.ok ? Number(n(count.rows[0], 'N') || 0) : null,
    countError: count.ok ? null : count.error,
    identityCols: (cols.rows || [])
      .filter((row) => String(n(row, 'IDENTITY') || '').toUpperCase() === 'YES')
      .map((row) => trim(n(row, 'COLUMN_NAME'))),
    columnNames: names,
    colCount: names.length,
  };
}

async function cachedColumnNames(schema, table) {
  const key = `${schema}.${table}`;
  if (columnCache.has(key)) return columnCache.get(key);
  const info = await tableInfo(schema, table);
  const names = info.columnNames || [];
  columnCache.set(key, names);
  return names;
}

async function listedFullInsertSql(dest, source, whereSql = '') {
  const [srcSchema, srcTable] = source.split('.');
  const destName = dest.split('.')[1];
  const srcCols = await cachedColumnNames(srcSchema, srcTable);
  const dstCols = await cachedColumnNames('JAVIER', destName);
  const cols = intersectColumnNames(srcCols, dstCols.length ? dstCols : srcCols);
  return buildInsertSelectSql(dest, source, cols, whereSql);
}

async function findTable(name) {
  const result = await safe(
    `SELECT TRIM(TABLE_SCHEMA) AS SCHEMA, TRIM(TABLE_NAME) AS NAME
       FROM QSYS2.SYSTABLES
      WHERE TABLE_NAME = ?
        AND TABLE_SCHEMA IN ('DSEDAC', 'DSED', 'JAVIER', 'CLI')
      ORDER BY TABLE_SCHEMA
      FETCH FIRST 8 ROWS ONLY`,
    [name],
  );
  return result.ok
    ? (result.rows || []).map((row) => ({ schema: trim(n(row, 'SCHEMA')), name: trim(n(row, 'NAME')) }))
    : [{ error: result.error }];
}

async function ensureLike(source, dest) {
  assertJavierTest(dest);
  const destName = dest.split('.')[1];
  const existed = await tableInfo('JAVIER', destName);
  const action = { dest, source, existed: existed.exists === true, before: existed.count };
  if (!existed.exists) {
    const ddl = `CREATE TABLE ${dest} LIKE ${source}`;
    refuseErpWrite(ddl);
    action.create = APPLY ? 'CREATE' : 'DRY-CREATE';
    action.createResult = await execWrite(ddl);
  }
  return action;
}

async function replaceIfNeeded(dest, { force = REPLACE, minRows = 1 } = {}) {
  assertJavierTest(dest);
  const destName = dest.split('.')[1];
  const info = await tableInfo('JAVIER', destName);
  const count = typeof info.count === 'number' ? info.count : 0;
  if (count > 0 && (force || count < minRows)) {
    const del = `DELETE FROM ${dest}`;
    refuseErpWrite(del);
    return { dest, deleted: APPLY ? 'DELETE' : 'DRY-DELETE', result: await execWrite(del), before: count };
  }
  return { dest, skipped: count > 0 ? 'has rows' : 'empty', before: count };
}

async function copyInsert(dest, insertSql, note, { full = false, originCount = null } = {}) {
  assertJavierTest(dest);
  refuseErpWrite(insertSql);
  const destName = dest.split('.')[1];
  const before = await tableInfo('JAVIER', destName);
  const current = typeof before.count === 'number' ? before.count : 0;
  const action = { dest, note, before: current };
  const complete = originCount != null && originCount > 0 && current >= originCount;
  if (complete) {
    action.skippedInsert = 'TEST count already matches origin';
    action.after = current;
    return action;
  }
  if (current > 0 && full && !REPLACE && !SERVER_FULL) {
    action.skippedInsert = 'complete catalog already copied';
    action.after = current;
    return action;
  }
  if (current > 0 && !REPLACE && !APPEND && !SERVER_FULL) {
    action.skippedInsert = 'already has rows';
    action.after = current;
    return action;
  }
  action.insert = APPLY ? 'INSERT' : 'DRY-INSERT';
  action.insertResult = await execWrite(insertSql);
  const after = await tableInfo('JAVIER', destName);
  action.after = after.count;
  return action;
}

async function copyByYearChunks(job, originCount) {
  const yearCol = job.chunkYearColumn;
  if (!yearCol) return null;
  const destName = job.dest.split('.')[1];
  const chunks = [];
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let year = thisYear - 12; year <= thisYear; year += 1) years.push(year);
  years.push('OLDER');
  for (const year of years) {
    const whereSql = year === 'OLDER'
      ? `WHERE ${safeIdent(yearCol)} < ${thisYear - 12} OR ${safeIdent(yearCol)} > ${thisYear}`
      : `WHERE ${safeIdent(yearCol)} = ${Number(year)}`;
    const sql = await listedFullInsertSql(job.dest, job.source, whereSql);
    refuseErpWrite(sql);
    const before = await tableInfo('JAVIER', destName);
    const result = APPLY ? await execWrite(sql) : { ok: true, dry: true };
    const after = await tableInfo('JAVIER', destName);
    chunks.push({
      year,
      before: before.count,
      after: after.count,
      ok: result.ok === true,
      error: result.ok ? null : result.error,
      sql: sql.slice(0, 180),
    });
    if (result.ok === false) {
      return {
        dest: job.dest,
        note: `${job.note} (chunk fallback)`,
        originCount,
        chunks,
        blocked: 'DB2 rejected a year chunk',
        after: after.count,
      };
    }
    if (originCount != null && after.count >= originCount) break;
  }
  const finalInfo = await tableInfo('JAVIER', destName);
  return {
    dest: job.dest,
    note: `${job.note} (chunk fallback)`,
    originCount,
    chunks,
    after: finalInfo.count,
  };
}

const vendorListSql = HIT_VENDORS.map((code) => `'${code}'`).join(', ');
const coreVendorSql = CORE_VENDORS.map((code) => `'${code}'`).join(', ');

const hitClientSql = `
  SELECT TRIM(CLP.CODIGOCLIENTE) FROM DSEDAC.CLP CLP
   WHERE TRIM(CLP.VENDEDORCOMERCIAL) IN (${coreVendorSql})
  UNION
  SELECT TRIM(P.CODIGOCLIENTE) FROM DSEDAC.PMR P
   WHERE TRIM(COALESCE(P.CODIGOCLIENTE, '')) <> ''
  UNION
  SELECT TRIM(C.CODIGOCLIENTE) FROM DSEDAC.PMRC C
   WHERE TRIM(COALESCE(C.CODIGOCLIENTE, '')) <> ''
`;

function commercialCopyJobs(lacSchema) {
  return [
    {
      source: 'DSEDAC.FPG',
      dest: 'JAVIER.TEST_FPG',
      note: 'catalogo FP entero',
      minRows: 1,
      insertSql: 'INSERT INTO JAVIER.TEST_FPG SELECT * FROM DSEDAC.FPG',
      full: true,
    },
    {
      source: 'DSEDAC.VDDX',
      dest: 'JAVIER.TEST_VDDX',
      note: 'minimo cobro vendedor entero',
      minRows: 1,
      insertSql: 'INSERT INTO JAVIER.TEST_VDDX SELECT * FROM DSEDAC.VDDX',
      full: true,
    },
    {
      source: 'DSEDAC.CLX',
      dest: 'JAVIER.TEST_CLX',
      note: 'cobro riguroso + clientes HIT',
      minRows: 1,
      insertSql: `INSERT INTO JAVIER.TEST_CLX
        SELECT * FROM DSEDAC.CLX
         WHERE COBRORIGUROSOSN = 'S'
            OR TRIM(CODIGOCLIENTE) IN (
                 SELECT TRIM(CODIGOCLIENTE) FROM DSEDAC.CLP
                  WHERE TRIM(VENDEDORCOMERCIAL) IN (${vendorListSql})
                  FETCH FIRST 800 ROWS ONLY
               )
         FETCH FIRST 8000 ROWS ONLY`,
      appendSql: `INSERT INTO JAVIER.TEST_CLX
        SELECT S.* FROM DSEDAC.CLX S
         WHERE (
              COBRORIGUROSOSN = 'S'
              OR TRIM(CODIGOCLIENTE) IN (${hitClientSql})
            )
           AND NOT EXISTS (
                 SELECT 1 FROM JAVIER.TEST_CLX T
                  WHERE TRIM(T.CODIGOCLIENTE) = TRIM(S.CODIGOCLIENTE)
               )
         FETCH FIRST 4000 ROWS ONLY`,
      fullSql: 'INSERT INTO JAVIER.TEST_CLX SELECT * FROM DSEDAC.CLX',
    },
    {
      source: 'DSEDAC.LQD',
      dest: 'JAVIER.TEST_LQD',
      note: 'liquidacion vendors HIT',
      minRows: 1,
      insertSql: `INSERT INTO JAVIER.TEST_LQD
        SELECT * FROM DSEDAC.LQD
         WHERE TRIM(CODIGOVENDEDOR) IN (${vendorListSql})
         FETCH FIRST ${SCOPED_FETCH} ROWS ONLY`,
      fullSql: 'INSERT INTO JAVIER.TEST_LQD SELECT * FROM DSEDAC.LQD',
    },
    {
      source: 'DSEDAC.PMR',
      dest: 'JAVIER.TEST_PMR',
      note: 'ofertas PMR',
      minRows: 0,
      optional: true,
      insertSql: 'INSERT INTO JAVIER.TEST_PMR SELECT * FROM DSEDAC.PMR',
      full: true,
    },
    {
      source: 'DSEDAC.PMRC',
      dest: 'JAVIER.TEST_PMRC',
      note: 'asignacion PMRC',
      minRows: 0,
      optional: true,
      insertSql: 'INSERT INTO JAVIER.TEST_PMRC SELECT * FROM DSEDAC.PMRC FETCH FIRST 8000 ROWS ONLY',
    },
    {
      source: 'DSEDAC.CLI',
      dest: 'JAVIER.TEST_CLI',
      note: 'clientes HIT 80/35/98 + PMR (catalogo, no dump si >80k)',
      minRows: 1,
      insertSql: `INSERT INTO JAVIER.TEST_CLI
        SELECT * FROM DSEDAC.CLI
         WHERE TRIM(CODIGOCLIENTE) IN (${hitClientSql})
         FETCH FIRST ${SCOPED_FETCH} ROWS ONLY`,
      appendSql: `INSERT INTO JAVIER.TEST_CLI
        SELECT S.* FROM DSEDAC.CLI S
         WHERE TRIM(S.CODIGOCLIENTE) IN (${hitClientSql})
           AND NOT EXISTS (
                 SELECT 1 FROM JAVIER.TEST_CLI T
                  WHERE TRIM(T.CODIGOCLIENTE) = TRIM(S.CODIGOCLIENTE)
               )
         FETCH FIRST ${SCOPED_FETCH} ROWS ONLY`,
      fullSql: 'INSERT INTO JAVIER.TEST_CLI SELECT * FROM DSEDAC.CLI',
    },
    {
      source: 'DSEDAC.CLC',
      dest: 'JAVIER.TEST_CLC',
      note: 'tarifa cliente HIT',
      minRows: 0,
      optional: true,
      insertSql: `INSERT INTO JAVIER.TEST_CLC
        SELECT * FROM DSEDAC.CLC
         WHERE TRIM(CODIGOCLIENTE) IN (${hitClientSql})
         FETCH FIRST ${SCOPED_FETCH} ROWS ONLY`,
      appendSql: `INSERT INTO JAVIER.TEST_CLC
        SELECT S.* FROM DSEDAC.CLC S
         WHERE TRIM(S.CODIGOCLIENTE) IN (${hitClientSql})
           AND NOT EXISTS (
                 SELECT 1 FROM JAVIER.TEST_CLC T
                  WHERE TRIM(T.CODIGOCLIENTE) = TRIM(S.CODIGOCLIENTE)
               )
         FETCH FIRST ${SCOPED_FETCH} ROWS ONLY`,
      fullSql: 'INSERT INTO JAVIER.TEST_CLC SELECT * FROM DSEDAC.CLC',
    },
    {
      source: 'DSEDAC.ART',
      dest: 'JAVIER.TEST_ART',
      note: 'catalogo articulos (full si <=80k; si no PMR/vendors)',
      minRows: 1,
      insertSql: 'INSERT INTO JAVIER.TEST_ART SELECT * FROM DSEDAC.ART FETCH FIRST 40000 ROWS ONLY',
      appendSql: `INSERT INTO JAVIER.TEST_ART
        SELECT S.* FROM DSEDAC.ART S
         WHERE NOT EXISTS (
                 SELECT 1 FROM JAVIER.TEST_ART T
                  WHERE TRIM(T.CODIGOARTICULO) = TRIM(S.CODIGOARTICULO)
               )
         FETCH FIRST 40000 ROWS ONLY`,
      fullSql: 'INSERT INTO JAVIER.TEST_ART SELECT * FROM DSEDAC.ART',
    },
    {
      source: 'DSEDAC.ARA',
      dest: 'JAVIER.TEST_ARA',
      note: 'tarifas 1/2 + clientes HIT',
      minRows: 1,
      insertSql: `INSERT INTO JAVIER.TEST_ARA
        SELECT * FROM DSEDAC.ARA
         WHERE CODIGOTARIFA IN (1, 2)
            OR CODIGOARTICULO IN (SELECT CODIGOARTICULO FROM JAVIER.TEST_ART)
         FETCH FIRST 80000 ROWS ONLY`,
      appendSql: `INSERT INTO JAVIER.TEST_ARA
        SELECT S.* FROM DSEDAC.ARA S
         WHERE (S.CODIGOTARIFA IN (1, 2) OR S.CODIGOARTICULO IN (SELECT CODIGOARTICULO FROM JAVIER.TEST_ART))
           AND NOT EXISTS (
                 SELECT 1 FROM JAVIER.TEST_ARA T
                  WHERE TRIM(T.CODIGOARTICULO) = TRIM(S.CODIGOARTICULO)
                    AND T.CODIGOTARIFA = S.CODIGOTARIFA
               )
         FETCH FIRST 40000 ROWS ONLY`,
      fullSql: 'INSERT INTO JAVIER.TEST_ARA SELECT * FROM DSEDAC.ARA',
    },
    {
      source: 'DSEDAC.LPC',
      dest: 'JAVIER.TEST_LPC',
      note: 'lineas pedido (LPC no tiene EJERCICIOALBARAN; join por pedido)',
      minRows: 0,
      optional: true,
      chunkYearColumn: 'ANODOCUMENTO',
      insertSql: 'INSERT INTO JAVIER.TEST_LPC SELECT * FROM DSEDAC.LPC FETCH FIRST 40000 ROWS ONLY',
      appendSql: `INSERT INTO JAVIER.TEST_LPC
        SELECT LPC.* FROM DSEDAC.LPC LPC
         WHERE EXISTS (
                 SELECT 1 FROM JAVIER.TEST_CPC CPC
                  WHERE LPC.EJERCICIOPEDIDO = CPC.EJERCICIOPEDIDO
                    AND TRIM(LPC.SERIEPEDIDO) = TRIM(CPC.SERIEPEDIDO)
                    AND LPC.TERMINALPEDIDO = CPC.TERMINALPEDIDO
                    AND LPC.NUMEROPEDIDO = CPC.NUMEROPEDIDO
               )
           AND NOT EXISTS (
                 SELECT 1 FROM JAVIER.TEST_LPC T
                  WHERE T.EJERCICIOPEDIDO = LPC.EJERCICIOPEDIDO
                    AND TRIM(T.SERIEPEDIDO) = TRIM(LPC.SERIEPEDIDO)
                    AND T.TERMINALPEDIDO = LPC.TERMINALPEDIDO
                    AND T.NUMEROPEDIDO = LPC.NUMEROPEDIDO
                    AND T.SECUENCIAPEDIDO = LPC.SECUENCIAPEDIDO
               )
         FETCH FIRST 20000 ROWS ONLY`,
      fullSql: 'INSERT INTO JAVIER.TEST_LPC SELECT * FROM DSEDAC.LPC',
    },
    {
      source: 'DSEDAC.CVC',
      dest: 'JAVIER.TEST_CVC',
      note: 'deuda CVC (full INSERT SELECT en 230)',
      minRows: 40,
      chunkYearColumn: 'ANODOCUMENTO',
      fullSql: 'INSERT INTO JAVIER.TEST_CVC SELECT * FROM DSEDAC.CVC',
      insertSql: `INSERT INTO JAVIER.TEST_CVC
        SELECT CVC.* FROM DSEDAC.CVC CVC
         WHERE TRIM(CVC.CODIGOVENDEDOR) IN (${vendorListSql})
            OR TRIM(CVC.CODIGOCLIENTEALBARAN) IN (${hitClientSql})
            OR (
                 TRIM(CVC.CODIGOVENDEDOR) IN (${coreVendorSql})
                 AND TRIM(CVC.CODIGOFORMAPAGO) IN (
                       SELECT FPG.CODIGOFORMAPAGO FROM DSEDAC.FPG FPG WHERE FPG.PAGARESN = 'S'
                     )
               )
         FETCH FIRST ${SCOPED_FETCH} ROWS ONLY`,
      appendSql: `INSERT INTO JAVIER.TEST_CVC
        SELECT CVC.* FROM DSEDAC.CVC CVC
         WHERE (
              TRIM(CVC.CODIGOVENDEDOR) IN (${coreVendorSql})
              OR TRIM(CVC.CODIGOCLIENTEALBARAN) IN (${hitClientSql})
            )
           AND NOT EXISTS (
                 SELECT 1 FROM JAVIER.TEST_CVC T
                  WHERE T.EJERCICIODOCUMENTO = CVC.EJERCICIODOCUMENTO
                    AND TRIM(T.SERIEDOCUMENTO) = TRIM(CVC.SERIEDOCUMENTO)
                    AND T.TERMINALDOCUMENTO = CVC.TERMINALDOCUMENTO
                    AND T.NUMERODOCUMENTO = CVC.NUMERODOCUMENTO
                    AND TRIM(T.TIPODOCUMENTO) = TRIM(CVC.TIPODOCUMENTO)
               )
         FETCH FIRST ${SCOPED_FETCH} ROWS ONLY`,
    },
    {
      source: 'DSEDAC.CAC',
      dest: 'JAVIER.TEST_CAC',
      note: 'albaran-factura CAC (full INSERT SELECT en 230)',
      minRows: 20,
      chunkYearColumn: 'ANODOCUMENTO',
      fullSql: 'INSERT INTO JAVIER.TEST_CAC SELECT * FROM DSEDAC.CAC',
      insertSql: `INSERT INTO JAVIER.TEST_CAC
        SELECT CAC.* FROM DSEDAC.CAC CAC
         WHERE TRIM(CAC.CODIGOVENDEDOR) IN (${vendorListSql})
            OR EXISTS (
                 SELECT 1 FROM JAVIER.TEST_CVC CVC
                  WHERE CAC.EJERCICIOFACTURA = CVC.EJERCICIODOCUMENTO
                    AND TRIM(CAC.SERIEFACTURA) = TRIM(CVC.SERIEDOCUMENTO)
                    AND CAC.TERMINALFACTURA = CVC.TERMINALDOCUMENTO
                    AND CAC.NUMEROFACTURA = CVC.NUMERODOCUMENTO
               )
         FETCH FIRST ${SCOPED_FETCH} ROWS ONLY`,
      appendSql: `INSERT INTO JAVIER.TEST_CAC
        SELECT CAC.* FROM DSEDAC.CAC CAC
         WHERE (
              TRIM(CAC.CODIGOVENDEDOR) IN (${coreVendorSql})
              OR EXISTS (
                 SELECT 1 FROM JAVIER.TEST_CVC CVC
                  WHERE CAC.EJERCICIOFACTURA = CVC.EJERCICIODOCUMENTO
                    AND TRIM(CAC.SERIEFACTURA) = TRIM(CVC.SERIEDOCUMENTO)
                    AND CAC.TERMINALFACTURA = CVC.TERMINALDOCUMENTO
                    AND CAC.NUMEROFACTURA = CVC.NUMERODOCUMENTO
               )
            )
           AND NOT EXISTS (
                 SELECT 1 FROM JAVIER.TEST_CAC T
                  WHERE T.EJERCICIOFACTURA = CAC.EJERCICIOFACTURA
                    AND TRIM(T.SERIEFACTURA) = TRIM(CAC.SERIEFACTURA)
                    AND T.TERMINALFACTURA = CAC.TERMINALFACTURA
                    AND T.NUMEROFACTURA = CAC.NUMEROFACTURA
               )
         FETCH FIRST ${SCOPED_FETCH} ROWS ONLY`,
    },
    {
      source: 'DSEDAC.CPC',
      dest: 'JAVIER.TEST_CPC',
      note: 'albaranes CPC (full INSERT SELECT en 230)',
      minRows: 20,
      chunkYearColumn: 'ANODOCUMENTO',
      fullSql: 'INSERT INTO JAVIER.TEST_CPC SELECT * FROM DSEDAC.CPC',
      insertSql: `INSERT INTO JAVIER.TEST_CPC
        SELECT CPC.* FROM DSEDAC.CPC CPC
         WHERE EXISTS (
                 SELECT 1 FROM JAVIER.TEST_CAC CAC
                  WHERE CPC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
                    AND TRIM(CPC.SERIEALBARAN) = TRIM(CAC.SERIEALBARAN)
                    AND CPC.TERMINALALBARAN = CAC.TERMINALALBARAN
                    AND CPC.NUMEROALBARAN = CAC.NUMEROALBARAN
               )
            OR TRIM(CPC.CODIGOVENDEDOR) IN (${vendorListSql})
         FETCH FIRST ${SCOPED_FETCH} ROWS ONLY`,
      appendSql: `INSERT INTO JAVIER.TEST_CPC
        SELECT CPC.* FROM DSEDAC.CPC CPC
         WHERE (
              TRIM(CPC.CODIGOVENDEDOR) IN (${coreVendorSql})
              OR EXISTS (
                 SELECT 1 FROM JAVIER.TEST_CAC CAC
                  WHERE CPC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
                    AND TRIM(CPC.SERIEALBARAN) = TRIM(CAC.SERIEALBARAN)
                    AND CPC.TERMINALALBARAN = CAC.TERMINALALBARAN
                    AND CPC.NUMEROALBARAN = CAC.NUMEROALBARAN
               )
            )
           AND NOT EXISTS (
                 SELECT 1 FROM JAVIER.TEST_CPC T
                  WHERE T.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                    AND TRIM(T.SERIEALBARAN) = TRIM(CPC.SERIEALBARAN)
                    AND T.TERMINALALBARAN = CPC.TERMINALALBARAN
                    AND T.NUMEROALBARAN = CPC.NUMEROALBARAN
               )
         FETCH FIRST ${SCOPED_FETCH} ROWS ONLY`,
    },
    {
      source: 'DSEDAC.CFC',
      dest: 'JAVIER.TEST_CFC',
      note: 'cabecera factura CFC (CREATE LIKE + INSERT SELECT; 0 writes ERP)',
      minRows: 1,
      chunkYearColumn: 'EJERCICIOFACTURA',
      fullSql: 'INSERT INTO JAVIER.TEST_CFC SELECT * FROM DSEDAC.CFC',
      insertSql: `INSERT INTO JAVIER.TEST_CFC
        SELECT CFC.* FROM DSEDAC.CFC CFC
         WHERE TRIM(CFC.CODIGOVENDEDOR) IN (${vendorListSql})
            OR TRIM(CFC.CODIGOCLIENTE) IN (${hitClientSql})
            OR EXISTS (
                 SELECT 1 FROM JAVIER.TEST_CAC CAC
                  WHERE CFC.EJERCICIOFACTURA = CAC.EJERCICIOFACTURA
                    AND TRIM(CFC.SERIEFACTURA) = TRIM(CAC.SERIEFACTURA)
                    AND CFC.TERMINALFACTURA = CAC.TERMINALFACTURA
                    AND CFC.NUMEROFACTURA = CAC.NUMEROFACTURA
               )
         FETCH FIRST ${SCOPED_FETCH} ROWS ONLY`,
      appendSql: `INSERT INTO JAVIER.TEST_CFC
        SELECT CFC.* FROM DSEDAC.CFC CFC
         WHERE (
              TRIM(CFC.CODIGOVENDEDOR) IN (${coreVendorSql})
              OR TRIM(CFC.CODIGOCLIENTE) IN (${hitClientSql})
            )
           AND NOT EXISTS (
                 SELECT 1 FROM JAVIER.TEST_CFC T
                  WHERE T.EJERCICIOFACTURA = CFC.EJERCICIOFACTURA
                    AND TRIM(T.SERIEFACTURA) = TRIM(CFC.SERIEFACTURA)
                    AND T.TERMINALFACTURA = CFC.TERMINALFACTURA
                    AND T.NUMEROFACTURA = CFC.NUMEROFACTURA
               )
         FETCH FIRST ${SCOPED_FETCH} ROWS ONLY`,
    },
    {
      source: 'DSEDAC.OPP',
      dest: 'JAVIER.TEST_OPP',
      note: 'ordenes OPP (CREATE LIKE si QSYS2 existe; BLOCKER si LIKE falla)',
      minRows: 0,
      optional: true,
      chunkYearColumn: 'ANOREPARTO',
      fullSql: 'INSERT INTO JAVIER.TEST_OPP SELECT * FROM DSEDAC.OPP',
      insertSql: `INSERT INTO JAVIER.TEST_OPP
        SELECT OPP.* FROM DSEDAC.OPP OPP
         WHERE TRIM(OPP.CODIGOVENDEDOR) IN (${vendorListSql})
            OR EXISTS (
                 SELECT 1 FROM JAVIER.TEST_CPC CPC
                  WHERE CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                    AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
               )
         FETCH FIRST ${SCOPED_FETCH} ROWS ONLY`,
      appendSql: `INSERT INTO JAVIER.TEST_OPP
        SELECT OPP.* FROM DSEDAC.OPP OPP
         WHERE (
              TRIM(OPP.CODIGOVENDEDOR) IN (${coreVendorSql})
              OR EXISTS (
                   SELECT 1 FROM JAVIER.TEST_CPC CPC
                    WHERE CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                      AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
                 )
            )
           AND NOT EXISTS (
                 SELECT 1 FROM JAVIER.TEST_OPP T
                  WHERE T.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
                    AND T.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
               )
         FETCH FIRST ${SCOPED_FETCH} ROWS ONLY`,
    },
    {
      source: `${lacSchema}.LACLAE`,
      dest: 'JAVIER.TEST_LACLAE',
      note: 'historico LACLAE (full INSERT SELECT en 230)',
      minRows: 1,
      chunkYearColumn: 'LCAADC',
      fullSql: 'INSERT INTO JAVIER.TEST_LACLAE SELECT * FROM DSED.LACLAE',
      insertSql: `INSERT INTO JAVIER.TEST_LACLAE
        SELECT * FROM ${lacSchema}.LACLAE
         WHERE (
              (LCSRAB = 'D' AND TRIM(LCCDVD) IN (${vendorListSql}))
              OR (
                   LCAADC >= 2024
                   AND (TRIM(LCCDVD) IN (${coreVendorSql}) OR TRIM(R1_T8CDVD) IN (${coreVendorSql}))
                 )
            )
         FETCH FIRST 40000 ROWS ONLY`,
      appendSql: `INSERT INTO JAVIER.TEST_LACLAE
        SELECT S.* FROM ${lacSchema}.LACLAE S
         WHERE (
              (S.LCSRAB = 'D' AND TRIM(S.LCCDVD) IN (${vendorListSql}))
              OR (
                   S.LCAADC >= 2024
                   AND (TRIM(S.LCCDVD) IN (${coreVendorSql}) OR TRIM(S.R1_T8CDVD) IN (${coreVendorSql}))
                 )
            )
           AND NOT EXISTS (
                 SELECT 1 FROM JAVIER.TEST_LACLAE T
                  WHERE T.LCSRAB = S.LCSRAB
                    AND T.LCNRAB = S.LCNRAB
                    AND TRIM(T.LCCDRF) = TRIM(S.LCCDRF)
                    AND TRIM(T.LCCDCL) = TRIM(S.LCCDCL)
                    AND T.LCAADC = S.LCAADC
                    AND T.LCMMDC = S.LCMMDC
                    AND T.LCDDDC = S.LCDDDC
                    AND T.LCTPVT = S.LCTPVT
               )
         FETCH FIRST 30000 ROWS ONLY`,
    },
    {
      source: 'DSEDAC.LAC',
      dest: 'JAVIER.TEST_LAC',
      note: 'lineas albaran LAC (full INSERT SELECT en 230)',
      minRows: 0,
      optional: true,
      chunkYearColumn: 'ANODOCUMENTO',
      insertSql: 'INSERT INTO JAVIER.TEST_LAC SELECT * FROM DSEDAC.LAC FETCH FIRST 40000 ROWS ONLY',
      fullSql: 'INSERT INTO JAVIER.TEST_LAC SELECT * FROM DSEDAC.LAC',
    },
    {
      source: 'JAVIER.COBROS',
      dest: 'JAVIER.TEST_COBROS',
      note: 'buffer cobros app',
      minRows: 0,
      optional: true,
      insertSql: 'INSERT INTO JAVIER.TEST_COBROS SELECT * FROM JAVIER.COBROS FETCH FIRST 50 ROWS ONLY',
    },
    {
      source: 'JAVIER.PEDIDOS_CAB',
      dest: 'JAVIER.TEST_PEDIDOS_CAB',
      note: 'buffer pedidos cab',
      minRows: 0,
      optional: true,
      insertSql: 'INSERT INTO JAVIER.TEST_PEDIDOS_CAB SELECT * FROM JAVIER.PEDIDOS_CAB FETCH FIRST 50 ROWS ONLY',
    },
    {
      source: 'JAVIER.PEDIDOS_LIN',
      dest: 'JAVIER.TEST_PEDIDOS_LIN',
      note: 'buffer pedidos lin',
      minRows: 0,
      optional: true,
      insertSql: 'INSERT INTO JAVIER.TEST_PEDIDOS_LIN SELECT * FROM JAVIER.PEDIDOS_LIN FETCH FIRST 80 ROWS ONLY',
    },
  ];
}

const INDEXES = [
  'CREATE INDEX JAVIER.IX_TEST_CVC_CLIENTE ON JAVIER.TEST_CVC (CODIGOCLIENTEALBARAN)',
  'CREATE INDEX JAVIER.IX_TEST_CVC_TIPO ON JAVIER.TEST_CVC (TIPODOCUMENTO)',
  'CREATE INDEX JAVIER.IX_TEST_CAC_FAC ON JAVIER.TEST_CAC (EJERCICIOFACTURA, SERIEFACTURA, TERMINALFACTURA, NUMEROFACTURA)',
  'CREATE INDEX JAVIER.IX_TEST_CAC_VD ON JAVIER.TEST_CAC (CODIGOVENDEDOR)',
  'CREATE INDEX JAVIER.IX_TEST_CFC_FAC ON JAVIER.TEST_CFC (EJERCICIOFACTURA, SERIEFACTURA, TERMINALFACTURA, NUMEROFACTURA)',
  'CREATE INDEX JAVIER.IX_TEST_CFC_VD ON JAVIER.TEST_CFC (CODIGOVENDEDOR)',
  'CREATE INDEX JAVIER.IX_TEST_OPP_REP ON JAVIER.TEST_OPP (CODIGOREPARTIDOR, ANOREPARTO, MESREPARTO, DIAREPARTO)',
  'CREATE INDEX JAVIER.IX_TEST_LQD_VD ON JAVIER.TEST_LQD (CODIGOVENDEDOR, ANOLIQUIDACION, MESLIQUIDACION, DIALIQUIDACION)',
  'CREATE INDEX JAVIER.IX_TEST_CLX_CLI ON JAVIER.TEST_CLX (CODIGOCLIENTE)',
  'CREATE INDEX JAVIER.IX_TEST_CLI_COD ON JAVIER.TEST_CLI (CODIGOCLIENTE)',
  'CREATE INDEX JAVIER.IX_TEST_ART_COD ON JAVIER.TEST_ART (CODIGOARTICULO)',
  'CREATE INDEX JAVIER.IX_TEST_ARA_ART ON JAVIER.TEST_ARA (CODIGOARTICULO, CODIGOTARIFA)',
  'CREATE INDEX JAVIER.IX_TEST_LACLAE_VD ON JAVIER.TEST_LACLAE (LCCDVD, LCAADC, LCMMDC)',
  'CREATE INDEX JAVIER.IX_TEST_LACLAE_R1 ON JAVIER.TEST_LACLAE (R1_T8CDVD, LCAADC, LCMMDC)',
  'CREATE INDEX JAVIER.IX_TEST_LACLAE_CLI ON JAVIER.TEST_LACLAE (LCCDCL, LCAADC)',
  'CREATE INDEX JAVIER.IX_TEST_LAC_VD ON JAVIER.TEST_LAC (CODIGOVENDEDOR, ANODOCUMENTO, MESDOCUMENTO)',
  'CREATE INDEX JAVIER.IX_TEST_LPC_PED ON JAVIER.TEST_LPC (EJERCICIOPEDIDO, SERIEPEDIDO, TERMINALPEDIDO, NUMEROPEDIDO)',
];

async function main() {
  const report = {
    mode: APPLY ? 'APPLY' : 'DRY-RUN',
    replace: REPLACE,
    tryFull: TRY_FULL,
    serverFull: SERVER_FULL,
    only: ONLY_KEYS ? [...ONLY_KEYS] : null,
    append: APPEND,
    writes: 'JAVIER.TEST_* only',
    dsedacWrite: false,
    qsys2: { find: {}, origin: {}, test: {} },
    copies: [],
    indexes: [],
    counts: [],
  };
  console.log(JSON.stringify({ mode: report.mode, writes: report.writes, dsedacWrite: false }));
  await initDb();
  try {
    const names = [
      'FPG', 'CVC', 'CAC', 'CPC', 'CFC', 'OPP', 'LQD', 'CLX', 'VDDX', 'LACLAE', 'LAC', 'PMR', 'PMRC', 'LPC', 'ARA', 'ART', 'CLI', 'CLC',
      'COBROS', 'PEDIDOS_CAB', 'PEDIDOS_LIN',
      'TEST_FPG', 'TEST_CVC', 'TEST_CAC', 'TEST_CPC', 'TEST_CFC', 'TEST_OPP', 'TEST_LQD', 'TEST_CLX', 'TEST_VDDX',
      'TEST_LACLAE', 'TEST_LAC', 'TEST_PMR', 'TEST_CLI', 'TEST_CLC', 'TEST_ART', 'TEST_ARA', 'TEST_LPC',
      'TEST_COBROS', 'TEST_PEDIDOS_CAB', 'TEST_PEDIDOS_LIN',
      'TEST_LIQUIDACION_COMERCIAL', 'TEST_DEVOLUCIONES_COMERCIAL',
    ];
    for (const name of names) {
      report.qsys2.find[name] = await findTable(name);
    }
    const lacHit = (report.qsys2.find.LACLAE || []).find((hit) => hit.schema === 'DSED')
      || (report.qsys2.find.LACLAE || [])[0]
      || { schema: 'DSED' };
    const lacSchema = lacHit.schema || 'DSED';

    const originSpecs = [
      ['DSEDAC', 'FPG'], ['DSEDAC', 'CVC'], ['DSEDAC', 'CAC'], ['DSEDAC', 'CPC'],
      ['DSEDAC', 'CFC'], ['DSEDAC', 'OPP'],
      ['DSEDAC', 'LQD'], ['DSEDAC', 'CLX'], ['DSEDAC', 'VDDX'], [lacSchema, 'LACLAE'],
      ['DSEDAC', 'PMR'], ['DSEDAC', 'PMRC'], ['DSEDAC', 'LPC'], ['DSEDAC', 'ARA'],
      ['DSEDAC', 'ART'], ['DSEDAC', 'CLI'], ['DSEDAC', 'CLC'], ['DSEDAC', 'LAC'],
    ];
    for (const [schema, table] of originSpecs) {
      const info = await tableInfo(schema, table);
      report.qsys2.origin[`${schema}.${table}`] = {
        exists: info.exists === true,
        count: info.count,
        countError: info.countError,
        identityCols: info.identityCols,
      };
    }

    const jobs = commercialCopyJobs(lacSchema).filter(jobSelected);
    for (const job of jobs) {
      const [srcSchema, srcTable] = job.source.split('.');
      const origin = await tableInfo(srcSchema, srcTable);
      if (!origin.exists) {
        report.copies.push({ dest: job.dest, skipped: 'origin missing', source: job.source });
        continue;
      }
      if ((origin.identityCols || []).length > 0 && job.source.startsWith('JAVIER.')) {
        const destInfo = await tableInfo('JAVIER', job.dest.split('.')[1]);
        report.copies.push({
          dest: job.dest,
          skipped: 'identity GENERATED ALWAYS; leave empty for app inserts',
          identityCols: origin.identityCols,
          destCount: destInfo.count,
        });
        continue;
      }
      const created = await ensureLike(job.source, job.dest);
      if (created.createResult && created.createResult.ok === false) {
        report.copies.push({ ...created, note: job.note });
        continue;
      }
      columnCache.delete(job.dest);
      const destNow = await tableInfo('JAVIER', job.dest.split('.')[1]);
      const destCount = typeof destNow.count === 'number' ? destNow.count : 0;
      const originCount = typeof origin.count === 'number' ? origin.count : null;
      const incomplete = originCount != null && destCount > 0 && destCount < originCount;
      if (REPLACE || (SERVER_FULL && incomplete)) {
        await replaceIfNeeded(job.dest, { force: true });
        columnCache.delete(job.dest);
      }
      if (APPEND && !job.appendSql && !REPLACE && !SERVER_FULL) {
        const destName = job.dest.split('.')[1];
        const existing = await tableInfo('JAVIER', destName);
        if ((existing.count || 0) > 0) {
          report.copies.push({
            dest: job.dest,
            skippedInsert: 'APPEND without appendSql; keep existing rows',
            after: existing.count,
            originCount: origin.count,
          });
          continue;
        }
      }
      let insertSql = job.insertSql;
      if (APPEND && job.appendSql && !SERVER_FULL) {
        insertSql = job.appendSql;
      } else if (SERVER_FULL && (job.fullSql || job.full)) {
        try {
          insertSql = await listedFullInsertSql(job.dest, job.source);
        } catch (error) {
          insertSql = job.fullSql || job.insertSql;
          report.copies.push({ dest: job.dest, columnIntersectError: String(error.message || error).slice(0, 180) });
        }
      } else if (
        job.fullSql
        && typeof origin.count === 'number'
        && origin.count <= LARGE_FULL_MAX
        && !job.full
      ) {
        insertSql = job.fullSql;
      }
      if (!SERVER_FULL && TRY_FULL && (job.full || job.fullSql) && !(APPEND && job.appendSql)) {
        if (originCount != null && originCount > LARGE_FULL_MAX && !job.full) {
          report.copies.push({ dest: job.dest, scoped: true, reason: `origin ${originCount} > ${LARGE_FULL_MAX}` });
        } else {
          insertSql = job.fullSql || job.insertSql;
        }
      }
      console.log(JSON.stringify({
        progress: job.dest,
        originCount,
        destBefore: destCount,
        serverFull: SERVER_FULL,
      }));
      const copied = await copyInsert(job.dest, insertSql, job.note, {
        full: job.full === true || SERVER_FULL,
        originCount,
      });
      copied.originCount = origin.count;
      copied.scoped = !SERVER_FULL && (insertSql !== (job.fullSql || job.insertSql) || !job.full);
      if (copied.insertResult && copied.insertResult.ok === false && SERVER_FULL) {
        copied.fullFailed = copied.insertResult.error;
        copied.sql = insertSql.slice(0, 240);
        const chunked = await copyByYearChunks(job, originCount);
        if (chunked) {
          copied.chunkFallback = chunked;
          copied.after = chunked.after;
        }
      } else if (copied.insertResult && copied.insertResult.ok === false && job.fullSql && insertSql === job.fullSql) {
        copied.fullFailed = copied.insertResult.error;
        copied.retryScoped = await copyInsert(job.dest, job.insertSql, `${job.note} (scoped retry)`);
      }
      report.copies.push(copied);
    }

    for (const ddl of INDEXES) {
      refuseErpWrite(ddl);
      const result = await execWrite(ddl);
      report.indexes.push({
        sql: ddl,
        ok: result.ok || /SQL0601|already exists/i.test(String(result.error?.message || '')),
        error: result.ok ? null : result.error,
      });
    }

    const testNames = [
      'TEST_FPG', 'TEST_VDDX', 'TEST_CLX', 'TEST_LQD', 'TEST_CVC', 'TEST_CAC', 'TEST_CPC', 'TEST_CFC', 'TEST_OPP',
      'TEST_LACLAE', 'TEST_LAC', 'TEST_PMR', 'TEST_PMRC', 'TEST_LPC', 'TEST_CLI', 'TEST_CLC', 'TEST_ART',
      'TEST_ARA', 'TEST_COBROS', 'TEST_PEDIDOS_CAB',
      'TEST_PEDIDOS_LIN', 'TEST_LIQUIDACION_COMERCIAL', 'TEST_DEVOLUCIONES_COMERCIAL',
    ];
    for (const name of testNames) {
      const info = await tableInfo('JAVIER', name);
      report.qsys2.test[name] = { exists: info.exists === true, count: info.count, error: info.error };
    }

    const originByLogical = {
      TEST_FPG: report.qsys2.origin['DSEDAC.FPG'],
      TEST_VDDX: report.qsys2.origin['DSEDAC.VDDX'],
      TEST_CLX: report.qsys2.origin['DSEDAC.CLX'],
      TEST_LQD: report.qsys2.origin['DSEDAC.LQD'],
      TEST_CVC: report.qsys2.origin['DSEDAC.CVC'],
      TEST_CAC: report.qsys2.origin['DSEDAC.CAC'],
      TEST_CPC: report.qsys2.origin['DSEDAC.CPC'],
      TEST_CFC: report.qsys2.origin['DSEDAC.CFC'],
      TEST_OPP: report.qsys2.origin['DSEDAC.OPP'],
      TEST_LACLAE: report.qsys2.origin[`${lacSchema}.LACLAE`],
      TEST_LAC: report.qsys2.origin['DSEDAC.LAC'],
      TEST_PMR: report.qsys2.origin['DSEDAC.PMR'],
      TEST_CLI: report.qsys2.origin['DSEDAC.CLI'],
      TEST_ART: report.qsys2.origin['DSEDAC.ART'],
      TEST_ARA: report.qsys2.origin['DSEDAC.ARA'],
      TEST_LPC: report.qsys2.origin['DSEDAC.LPC'],
      TEST_CLC: report.qsys2.origin['DSEDAC.CLC'],
    };
    for (const [testName, origin] of Object.entries(originByLogical)) {
      report.counts.push({
        test: `JAVIER.${testName}`,
        testCount: report.qsys2.test[testName]?.count ?? null,
        originCount: origin?.count ?? null,
        originExists: origin?.exists === true,
      });
    }

    report.readPlan = {
      writes: {
        pedidos: 'JAVIER.TEST_PEDIDOS_CAB/LIN',
        cobros: 'JAVIER.TEST_COBROS',
        liquidacion: 'JAVIER.TEST_LIQUIDACION_COMERCIAL',
        devoluciones: 'JAVIER.TEST_DEVOLUCIONES_COMERCIAL',
      },
      isolatedReads: {
        deudaFpAlbaran: 'JAVIER.TEST_CVC/FPG/CAC/CPC if copied, else DSEDAC SELECT',
        facturaCabecera: 'JAVIER.TEST_CFC',
        ruteroOpp: 'JAVIER.TEST_OPP if CREATE LIKE ok; BLOCKER if OPP cannot LIKE',
        lqdClxVddx: 'JAVIER.TEST_LQD/CLX/VDDX',
        laclaeDevoluciones: 'JAVIER.TEST_LACLAE',
        laclaeHistoricoAll: 'JAVIER.TEST_LACLAE (PIN VDPL1 sigue DSEDAC.VDPL1 SELECT)',
        productosPrecios: 'JAVIER.TEST_ART/ARA/CLC; PIN/VDPL1 DSEDAC SELECT',
        cliCatalog: 'JAVIER.TEST_CLI; auth PIN sigue DSEDAC.VDPL1 SELECT',
        lacLines: 'JAVIER.TEST_LAC if copied',
      },
      dsedacWrite: false,
    };

    const oppCopy = report.copies.find((copy) => copy.dest === 'JAVIER.TEST_OPP');
    const oppOrigin = report.qsys2.origin['DSEDAC.OPP'];
    const oppTest = report.qsys2.test.TEST_OPP;
    if (!oppOrigin || oppOrigin.exists !== true) {
      report.blockerOpp = {
        code: 'BLOCKER',
        causa: 'QSYS2 no encuentra DSEDAC.OPP',
        requiere: 'Confirmar nombre/esquema OPP en 230 antes de LIKE',
      };
    } else if (oppCopy && oppCopy.createResult && oppCopy.createResult.ok === false) {
      report.blockerOpp = {
        code: 'BLOCKER',
        causa: `CREATE TABLE JAVIER.TEST_OPP LIKE DSEDAC.OPP fallo: ${JSON.stringify(oppCopy.createResult.error || oppCopy.createResult).slice(0, 220)}`,
        requiere: 'Revisar identity/view/autorizacion LIKE de OPP; no copiar writes ERP',
      };
    } else if (oppTest && oppTest.exists !== true) {
      report.blockerOpp = {
        code: 'BLOCKER',
        causa: 'TEST_OPP no existe tras COPY',
        requiere: 'CREATE TABLE JAVIER.TEST_OPP LIKE DSEDAC.OPP en schema JAVIER',
      };
    }

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('FATAL', error.message);
    process.exit(1);
  });
}

module.exports = {
  refuseErpWrite,
  assertJavierTest,
  commercialCopyJobs,
  HIT_VENDORS,
  CORE_VENDORS,
  intersectColumnNames,
  buildInsertSelectSql,
  jobSelected,
};
