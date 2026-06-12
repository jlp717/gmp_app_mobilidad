'use strict';

/**
 * Pre-demo smoke — Pedidos / Cobros / Bolsa (read-only DB checks).
 *
 * Usage (from backend/):
 *   node scripts/demo-smoke-pedidos-cobros-bolsa.js
 *
 * Env: ODBC_DSN (default GMP), ODBC_UID, ODBC_PWD|ODBC_PASSWORD
 * Optional: DEMO_VENDOR=02 DEMO_CLIENT=4300001091 DEMO_PENDING_LIMIT=50
 *
 * No test data is written. Exit 0 = all PASS, 1 = any FAIL.
 */

const odbc = require('odbc');
const { buildClientVendorParamFilter, buildLaclaeBoundedClientCodesSql } = require('../utils/common');

const DEMO_VENDOR = process.env.DEMO_VENDOR || '02';
const DEMO_CLIENT = process.env.DEMO_CLIENT || '4300001091';
const CLIENT_LIST_LIMIT_MS = 5000;
const PENDING_LIMIT = parseInt(process.env.DEMO_PENDING_LIMIT || '50', 10);

function requireEnv(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

function requireDb2Secret() {
  const value = process.env.ODBC_PWD ?? process.env.ODBC_PASSWORD;
  if (!value) throw new Error('Missing ODBC_PWD or ODBC_PASSWORD');
  return value;
}

function connectionString() {
  const dsn = requireEnv('ODBC_DSN', 'GMP');
  const uid = requireEnv('ODBC_UID', process.env.DB2_USER || 'JAVIER');
  const pwd = requireDb2Secret();
  return [
    `DSN=${dsn}`, `UID=${uid}`, `PWD=${pwd}`,
    'NAM=1', 'CCSID=1208', 'CMPTDM=1', 'CPTOUT=120', 'COMMTIMEOUT=180', `DBQ=${dsn}`,
  ].join(';');
}

const checks = [];

function record(name, pass, ms, detail = '') {
  checks.push({ name, pass: pass ? 'PASS' : 'FAIL', ms, detail });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name} (${ms}ms)${detail ? ` — ${detail}` : ''}`);
}

async function timed(conn, sql, params) {
  const start = Date.now();
  const rows = params && params.length ? await conn.query(sql, params) : await conn.query(sql);
  return { rows, ms: Date.now() - start };
}

function clientsListSql(vendorCode) {
  const MIN_YEAR = new Date().getFullYear() - 2;
  const laclaeBoundedFilter = buildLaclaeBoundedClientCodesSql(vendorCode);
  const vendorScopedCliFilter = `AND EXISTS (
    SELECT 1 FROM DSEDAC.CLP CLP
    WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(C.CODIGOCLIENTE)
      AND TRIM(CLP.VENDEDORCOMERCIAL) = '${vendorCode}'
  )`;
  return `
    SELECT C.CODIGOCLIENTE as code
    FROM DSEDAC.CLI C
    LEFT JOIN (
      SELECT CLIENT_CODE, LAST_VENDOR FROM (
        SELECT LCCDCL AS CLIENT_CODE, LCCDVD AS LAST_VENDOR,
          ROW_NUMBER() OVER (PARTITION BY LCCDCL ORDER BY LCAADC DESC, LCMMDC DESC, LCDDDC DESC) AS RN
        FROM DSED.LACLAE
        WHERE LCAADC >= ${MIN_YEAR} AND TPDC = 'LAC'
          AND LCTPVT IN ('CC', 'VC') AND LCCLLN IN ('AB', 'VT') AND LCSRAB NOT IN ('N', 'Z')
          ${laclaeBoundedFilter}
      ) X WHERE RN = 1
    ) LV ON LV.CLIENT_CODE = C.CODIGOCLIENTE
    WHERE C.ANOBAJA = 0 ${vendorScopedCliFilter}
    ORDER BY C.CODIGOCLIENTE
    FETCH FIRST 25 ROWS ONLY`;
}

async function main() {
  console.log(`[smoke] Pre-demo checks vendor=${DEMO_VENDOR} client=${DEMO_CLIENT}`);
  let conn;
  try {
    conn = await odbc.connect(connectionString());
    record('db_connect', true, 0, 'ODBC connected');
  } catch (err) {
    record('db_connect', false, 0, err.message);
    printSummary();
    process.exit(1);
  }

  try {
    // 1. Client list — must complete < 5s, no LATERAL
    const clientSql = clientsListSql(DEMO_VENDOR);
    if (/\bLATERAL\b/i.test(clientSql)) {
      record('clients_list_query_shape', false, 0, 'SQL still contains LATERAL');
    } else {
      const { rows, ms } = await timed(conn, clientSql);
      record('clients_list_query', ms < CLIENT_LIST_LIMIT_MS, ms, `${rows.length} rows`);
    }

    // 2. Products auth scope — CLP/CLI/LACLAE for demo client
    const { clause, params } = buildClientVendorParamFilter([DEMO_VENDOR], 'CLI');
    const scopeSql = `SELECT 1 AS OK FROM DSEDAC.CLI CLI WHERE TRIM(CLI.CODIGOCLIENTE) = ? AND (${clause}) FETCH FIRST 1 ROW ONLY`;
    const scopeParams = [DEMO_CLIENT, ...params];
    const scope = await timed(conn, scopeSql, scopeParams);
    const allowed = scope.rows.length > 0;
    record('products_client_vendor_scope', allowed, scope.ms,
      allowed ? 'client in vendor scope' : 'client NOT in vendor scope — products would 403');

    // 3. Recommendations history query (truncated client code)
    const trimClient = DEMO_CLIENT.substring(0, 10);
    const recSql = `
      SELECT TRIM(L.CODIGOARTICULO) AS code
      FROM DSEDAC.LINDTO L
      WHERE TRIM(L.CODIGOCLIENTEALBARAN) = CAST(? AS VARCHAR(10))
        AND L.ANODOCUMENTO >= YEAR(CURRENT_DATE) - 1
      FETCH FIRST 5 ROWS ONLY`;
    const rec = await timed(conn, recSql, [trimClient]);
    record('recommendations_history_query', true, rec.ms, `${rec.rows.length} rows`);

    // 4. pending-summary vendor 02 — CVC semi-join, no empty client noise in scoped query
    const pendingSql = `
      SELECT TRIM(CVC.CODIGOCLIENTEALBARAN) AS CLIENTE,
             COALESCE(SUM(CVC.IMPORTEPENDIENTE), 0) AS TOTAL_PENDIENTE
      FROM DSEDAC.CVC CVC
      WHERE CVC.IMPORTEPENDIENTE <> 0
        AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
        AND EXISTS (
          SELECT 1 FROM DSEDAC.CLP CLP
          WHERE TRIM(CLP.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
            AND TRIM(CLP.VENDEDORCOMERCIAL) = ?
        )
      GROUP BY TRIM(CVC.CODIGOCLIENTEALBARAN)
      ORDER BY TOTAL_PENDIENTE DESC
      FETCH FIRST ${PENDING_LIMIT} ROWS ONLY`;
    const pending = await timed(conn, pendingSql, [DEMO_VENDOR]);
    record('cobros_pending_summary_vendor', true, pending.ms, `${pending.rows.length} clients`);

    // 5. REPARTIDOR_COBROS GROUP BY raw columns (prepare-safe)
    const repSql = `
      SELECT SERIEDOCUMENTO, NUMERODOCUMENTO, COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL
      FROM JAVIER.REPARTIDOR_COBROS
      WHERE TRIM(CODIGOCLIENTEALBARAN) = ?
      GROUP BY SERIEDOCUMENTO, NUMERODOCUMENTO
      FETCH FIRST 5 ROWS ONLY`;
    const rep = await timed(conn, repSql, [trimClient]);
    record('repartidor_cobros_group_by', true, rep.ms, `${rep.rows.length} doc groups`);

    // 6. Bolsa status read
    const now = new Date();
    const bolsaSql = `
      SELECT ID, TRIM(CODIGOVENDEDOR) AS V, SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO
      FROM JAVIER.BOLSA_COMERCIAL
      WHERE TRIM(CODIGOVENDEDOR) = ? AND EJERCICIO = ? AND MES = ?
      FETCH FIRST 1 ROW ONLY`;
    const bolsa = await timed(conn, bolsaSql, [DEMO_VENDOR, now.getFullYear(), now.getMonth() + 1]);
    record('bolsa_status_read', true, bolsa.ms,
      bolsa.rows.length ? `saldo=${bolsa.rows[0].SALDO_DISPONIBLE}` : 'no row (defaults on first access)');

    // 7. Client balance sources (read-only)
    const year = now.getFullYear();
    const factSql = `SELECT COALESCE(SUM(LCIMVT), 0) AS T FROM DSED.LACLAE L
      WHERE L.LCCDCL = ? AND L.LCAADC = ? AND L.LCTPVT IN ('CC','VC') AND L.LCCLLN IN ('AB','VT')
      FETCH FIRST 1 ROW ONLY`;
    const cobSql = `SELECT COALESCE(SUM(CVC.IMPORTECANCELADO), 0) AS T FROM DSEDAC.CVC CVC
      WHERE TRIM(CVC.CODIGOCLIENTEALBARAN) = ? AND CVC.ANOEMISION = ? AND CVC.IMPORTECANCELADO > 0
      FETCH FIRST 1 ROW ONLY`;
    const [fact, cob] = await Promise.all([
      timed(conn, factSql, [trimClient, year]),
      timed(conn, cobSql, [trimClient, year]),
    ]);
    record('client_balance_laclae_cvc', true, fact.ms + cob.ms,
      `facturado=${fact.rows[0]?.T ?? 0} cobrado=${cob.rows[0]?.T ?? 0}`);
  } catch (err) {
    record('unexpected_error', false, 0, err.message);
  } finally {
    if (conn) await conn.close();
  }

  printSummary();
  process.exit(checks.some((c) => c.pass === 'FAIL') ? 1 : 0);
}

function printSummary() {
  const passed = checks.filter((c) => c.pass === 'PASS').length;
  const failed = checks.filter((c) => c.pass === 'FAIL').length;
  console.log(`\n[smoke] ${passed} PASS / ${failed} FAIL (${checks.length} checks)`);
}

main().catch((err) => {
  console.error('[smoke] fatal:', err.message);
  process.exit(1);
});
