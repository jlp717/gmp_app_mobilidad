'use strict';

/**
 * Analytics DB2 repository — acceso DB2 de analytics.
 *
 * SQL movido verbatim desde backend/routes/analytics.js (sin cambios de
 * comportamiento). Todo binding parametrizado; FETCH FIRST / OFFSET (nunca LIMIT).
 * Las tablas llegan por `tables` (DI desde la ruta) con fallback a
 * comercialErpTable para uso directo/tests.
 *
 * TODO(DIP): recibir queryWithParams/cachedQuery/tablas siempre por parametros
 * en vez de requires directos (patron actual del repo por tiempo).
 */

const { queryWithParams } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');
const { comercialErpTable } = require('../utils/comercial-erp-tables');
const { LACLAE_SALES_FILTER, MIN_YEAR } = require('../utils/common');

function defaultTables() {
    return {
        LACLAE: comercialErpTable('LACLAE'),
        CLI: comercialErpTable('CLI'),
        LINDTO: comercialErpTable('LINDTO'),
        ART: comercialErpTable('ART'),
        ARTX: comercialErpTable('ARTX'),
        LAC: comercialErpTable('LAC'),
    };
}

function resolveTables(tables) {
    return { ...defaultTables(), ...(tables || {}) };
}

function defaultDeps(deps) {
    return {
        queryWithParams,
        cachedQuery,
        TTL,
        ...(deps || {}),
    };
}

function yoySql(tables, monthFilter, vendorFilterClause) {
    const t = resolveTables(tables);
    return `
          SELECT 
            SUM(L.LCIMVT) as sales, 
            SUM(L.LCIMVT - L.LCIMCT) as margin,
            COUNT(DISTINCT L.LCCDCL) as clients
          FROM ${t.LACLAE} L 
          WHERE L.LCAADC = ? AND ${LACLAE_SALES_FILTER} ${monthFilter} ${vendorFilterClause}
        `;
}

async function fetchYoyYear({ year, monthParams, vendorParams, monthFilter, vendorFilterClause, cacheKeyBase, tables }, deps) {
    const { queryWithParams: qwp, cachedQuery: cq, TTL: ttl } = defaultDeps(deps);
    return cq(qwp, yoySql(tables, monthFilter, vendorFilterClause), {
        cacheKey: `${cacheKeyBase}:${year}`,
        ttl: ttl.LONG,
    }, [year, ...monthParams, ...vendorParams]);
}

function topClientsSql(tables, dateFilter, vendorFilterClause, safeLimit) {
    const t = resolveTables(tables);
    return `
      SELECT
        T.code,
        T.totalSales,
        T.transactions,
        COALESCE(
          NULLIF(TRIM(C.NOMBREALTERNATIVO), ''),
          TRIM(C.NOMBRECLIENTE),
          'Cliente ' || TRIM(T.code)
        ) as name,
        TRIM(C.POBLACION) as city
      FROM (
        SELECT
          L.LCCDCL as code,
          SUM(L.LCIMVT) as totalSales,
          COUNT(*) as transactions
        FROM ${t.LACLAE} L
        WHERE ${LACLAE_SALES_FILTER} ${dateFilter} ${vendorFilterClause}
        GROUP BY L.LCCDCL
        ORDER BY totalSales DESC
        FETCH FIRST ${safeLimit} ROWS ONLY
      ) T
      LEFT JOIN ${t.CLI} C ON C.CODIGOCLIENTE = T.code
      ORDER BY T.totalSales DESC
    `;
}

async function fetchTopClients({ sql, params, cacheKey, ttl }, deps) {
    const { queryWithParams: qwp, cachedQuery: cq } = defaultDeps(deps);
    return cq(qwp, sql, { cacheKey, ttl }, params);
}

function trendsSql(tables, vendorFilterClause) {
    const t = resolveTables(tables);
    return `
      SELECT L.LCAADC as year, L.LCMMDC as month, SUM(L.LCIMVT) as sales
      FROM ${t.LACLAE} L
      WHERE L.LCAADC >= ? AND ${LACLAE_SALES_FILTER} ${vendorFilterClause}
      GROUP BY L.LCAADC, L.LCMMDC
      ORDER BY L.LCAADC DESC, L.LCMMDC DESC
      FETCH FIRST 6 ROWS ONLY
    `;
}

async function fetchTrends({ vendorParams, vendorFilterClause, cacheKey, tables }, deps) {
    const { queryWithParams: qwp, cachedQuery: cq, TTL: ttl } = defaultDeps(deps);
    return cq(qwp, trendsSql(tables, vendorFilterClause), {
        cacheKey,
        ttl: ttl.LONG,
    }, [MIN_YEAR, ...vendorParams]);
}

function topProductsSql(tables, vendorFilterClause, safeLimit) {
    const t = resolveTables(tables);
    return `
      SELECT L.CODIGOARTICULO as code,
  COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.DESCRIPCION), 'Producto ' || TRIM(L.CODIGOARTICULO)) as name,
  A.CODIGOMARCA as brand,
  A.CODIGOFAMILIA as family,
  SUM(L.IMPORTEVENTA) as totalSales,
  SUM(L.IMPORTEMARGENREAL) as totalMargin,
  SUM(L.CANTIDADENVASES) as totalBoxes,
  SUM(L.CANTIDADUNIDADES) as totalUnits,
  COUNT(DISTINCT L.CODIGOCLIENTEALBARAN) as numClients
      FROM ${t.LINDTO} L
      LEFT JOIN ${t.ART} A ON L.CODIGOARTICULO = A.CODIGOARTICULO
      WHERE L.ANODOCUMENTO = ? ${vendorFilterClause}
      GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, L.DESCRIPCION, A.CODIGOMARCA, A.CODIGOFAMILIA
      ORDER BY totalSales DESC
      FETCH FIRST ${safeLimit} ROWS ONLY
    `;
}

async function fetchTopProducts({ year, vendorParams, vendorFilterClause, cacheKey, ttl, safeLimit, tables }, deps) {
    const { queryWithParams: qwp, cachedQuery: cq } = defaultDeps(deps);
    return cq(qwp, topProductsSql(tables, vendorFilterClause, safeLimit), {
        cacheKey,
        ttl,
    }, [year, ...vendorParams]);
}

function marginsMonthlySql(tables, vendorFilterClause) {
    const t = resolveTables(tables);
    return `
      SELECT MESDOCUMENTO as month,
  SUM(IMPORTEVENTA) as sales,
  SUM(IMPORTEMARGENREAL) as margin
      FROM ${t.LINDTO}
      WHERE ANODOCUMENTO = ? ${vendorFilterClause}
      GROUP BY MESDOCUMENTO
      ORDER BY MESDOCUMENTO
  `;
}

function marginsFamilySql(tables, vendorFilterClause) {
    const t = resolveTables(tables);
    return `
      SELECT COALESCE(A.CODIGOFAMILIA, 'SIN FAM') as family,
  SUM(L.IMPORTEVENTA) as sales,
  SUM(L.IMPORTEMARGENREAL) as margin
      FROM ${t.LINDTO} L
      LEFT JOIN ${t.ART} A ON L.CODIGOARTICULO = A.CODIGOARTICULO
      WHERE L.ANODOCUMENTO = ? ${vendorFilterClause}
      GROUP BY A.CODIGOFAMILIA
      ORDER BY sales DESC
      FETCH FIRST 10 ROWS ONLY
    `;
}

async function fetchMargins({ year, vendorParams, vendorAliasedParams, vendorFilterClause, vendorAliasedClause, cacheKey, ttl, tables }, deps) {
    const { queryWithParams: qwp, cachedQuery: cq } = defaultDeps(deps);
    return Promise.all([
        cq(qwp, marginsMonthlySql(tables, vendorFilterClause), {
            cacheKey: `${cacheKey}:monthly`,
            ttl,
        }, [year, ...vendorParams]),
        cq(qwp, marginsFamilySql(tables, vendorAliasedClause), {
            cacheKey: `${cacheKey}:family`,
            ttl,
        }, [year, ...vendorAliasedParams]),
    ]);
}

function salesHistorySql(tables, whereClause, offset, limit) {
    const t = resolveTables(tables);
    return `
      SELECT 
        L.ANODOCUMENTO as year, 
        L.MESDOCUMENTO as month, 
        L.DIADOCUMENTO as day,
        L.CODIGOCLIENTEALBARAN as clientCode,
        L.CODIGOARTICULO as productCode,
        L.DESCRIPCION as productName,
        L.IMPORTEVENTA as total,
        L.PRECIOVENTA as price,
        L.CANTIDADUNIDADES as quantity,
        L.CODIGOLOTE as lote,
        L.REFERENCIADOCUMENTO as ref,
        L.NUMERODOCUMENTO as invoice,
        COALESCE(A.CODIGOFAMILIA, '') as family,
        COALESCE(NULLIF(TRIM(A.CODIGOSUBFAMILIA), ''), 'General') as subfamily,
        COALESCE(TRIM(AX.FILTRO01), '') as fi1,
        COALESCE(TRIM(AX.FILTRO02), '') as fi2,
        COALESCE(TRIM(AX.FILTRO03), '') as fi3,
        COALESCE(TRIM(AX.FILTRO04), '') as fi4,
        COALESCE(TRIM(A.CODIGOSECCIONLARGA), '') as fi5
      FROM ${t.LAC} L
      LEFT JOIN ${t.ART} A ON L.CODIGOARTICULO = A.CODIGOARTICULO
      LEFT JOIN ${t.ARTX} AX ON L.CODIGOARTICULO = AX.CODIGOARTICULO
      ${whereClause}
      ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC
      OFFSET ${parseInt(offset)} ROWS
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
    `;
}

async function fetchSalesHistory({ whereClause, whereParams, offset, limit, cacheKey, ttl, queryType, tables }, deps) {
    const { queryWithParams: qwp, cachedQuery: cq } = defaultDeps(deps);
    return cq(qwp, salesHistorySql(tables, whereClause, offset, limit), {
        cacheKey,
        ttl,
        queryType,
    }, whereParams);
}

function salesSummaryLaclaeFilter() {
    return `L.TPDC = 'LAC' AND L.LCTPVT IN ('CC', 'VC') AND L.LCCLLN IN ('AB', 'VT') AND L.LCSRAB NOT IN ('N', 'Z')`;
}

function salesSummaryStatsSql(tables, vendorFilterClause, clientFilter, searchFilter) {
    const t = resolveTables(tables);
    return `
                SELECT 
                    SUM(L.LCIMVT) as sales,
                    SUM(L.LCIMVT - L.LCIMCT) as margin,
                    SUM(L.LCCTUD) as units,
                    COUNT(DISTINCT TRIM(L.LCCDRF)) as product_count
                FROM ${t.LACLAE} L
                WHERE ${salesSummaryLaclaeFilter()}
                  AND L.LCAADC = ?
                  ${vendorFilterClause}
                  ${clientFilter}
                  ${searchFilter}
            `;
}

function salesSummaryYearBreakdownSql(tables, vendorFilterClause, clientFilter, searchFilter) {
    const t = resolveTables(tables);
    return `
                SELECT 
                    L.LCAADC as year,
                    SUM(L.LCIMVT) as sales,
                    SUM(L.LCIMVT - L.LCIMCT) as margin,
                    SUM(L.LCCTUD) as units
                FROM ${t.LACLAE} L
                WHERE ${salesSummaryLaclaeFilter()}
                  AND L.LCAADC BETWEEN ? AND ?
                  ${vendorFilterClause}
                  ${clientFilter}
                  ${searchFilter}
                GROUP BY L.LCAADC
                ORDER BY L.LCAADC DESC
            `;
}

function salesSummaryMonthlyBreakdownSql(tables, vendorFilterClause, clientFilter, searchFilter) {
    const t = resolveTables(tables);
    return `
                SELECT 
                    L.LCAADC as year,
                    L.LCMMDC as month,
                    SUM(L.LCIMVT) as sales
                FROM ${t.LACLAE} L
                WHERE ${salesSummaryLaclaeFilter()}
                  AND L.LCAADC IN (?, ?)
                  ${vendorFilterClause}
                  ${clientFilter}
                  ${searchFilter}
                GROUP BY L.LCAADC, L.LCMMDC
                ORDER BY L.LCMMDC
            `;
}

async function fetchSalesSummaryStats({ year, vendorParams, extraParams, vendorFilterClause, clientFilter, searchFilter, tables }, deps) {
    const { queryWithParams: qwp } = defaultDeps(deps);
    const result = await qwp(
        salesSummaryStatsSql(tables, vendorFilterClause, clientFilter, searchFilter),
        [year, ...vendorParams, ...extraParams],
    );
    return result[0] || {};
}

async function fetchSalesSummaryYearBreakdown({ startYear, endYear, vendorParams, extraParams, vendorFilterClause, clientFilter, searchFilter, tables }, deps) {
    const { queryWithParams: qwp } = defaultDeps(deps);
    return qwp(
        salesSummaryYearBreakdownSql(tables, vendorFilterClause, clientFilter, searchFilter),
        [startYear, endYear, ...vendorParams, ...extraParams],
    );
}

async function fetchSalesSummaryMonthlyBreakdown({ year, prevYear, vendorParams, extraParams, vendorFilterClause, clientFilter, searchFilter, tables }, deps) {
    const { queryWithParams: qwp } = defaultDeps(deps);
    return qwp(
        salesSummaryMonthlyBreakdownSql(tables, vendorFilterClause, clientFilter, searchFilter),
        [year, prevYear, ...vendorParams, ...extraParams],
    );
}

module.exports = {
    resolveTables,
    yoySql,
    fetchYoyYear,
    topClientsSql,
    fetchTopClients,
    trendsSql,
    fetchTrends,
    topProductsSql,
    fetchTopProducts,
    marginsMonthlySql,
    marginsFamilySql,
    fetchMargins,
    salesHistorySql,
    fetchSalesHistory,
    salesSummaryStatsSql,
    salesSummaryYearBreakdownSql,
    salesSummaryMonthlyBreakdownSql,
    fetchSalesSummaryStats,
    fetchSalesSummaryYearBreakdown,
    fetchSalesSummaryMonthlyBreakdown,
};
