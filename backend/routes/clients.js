const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { verifyToken } = require('../middleware/auth');
const { query, queryWithParams } = require('../config/db');
const {
  buildVendedorFilter,
  buildVendedorFilterLACLAE,
  formatCurrency,
  MIN_YEAR,
  LACLAE_SALES_FILTER,
  sanitizeForSQL,
  sanitizeCodeList,
  handleRouteError,
  getCurrentDate,
  buildClientListVendorSqlFilter,
  buildLaclaeBoundedClientCodesSql,
  buildClientVendorParamFilter,
} = require('../utils/common');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');
const { getClientDays } = require('../services/laclae');


function normalizeVendorCode(value) { return String(value || '').trim(); }
function clientCodesMatch(left, right) {
  const a = normalizeVendorCode(left);
  const b = normalizeVendorCode(right);
  return a === b || (a.replace(/^0+/, '') && a.replace(/^0+/, '') === b.replace(/^0+/, ''));
}
function isClientsManager(user) {
  const role = String(user?.role || '').trim().toUpperCase();
  return user?.isJefeVentas === true || role === 'JEFE_VENTAS' || role === 'ADMIN';
}
function clientsVisibleVendorCodes(user) {
  const values = user?.vendorCodes || user?.vendedorCodes;
  return Array.isArray(values) ? values.map(normalizeVendorCode).filter(Boolean) : [];
}
function vendorCodeArrayForClientScope(vendedorCodes) {
  if (!vendedorCodes || vendedorCodes === 'ALL') return [];
  return String(vendedorCodes)
    .split(',')
    .map(normalizeVendorCode)
    .filter(code => /^[a-zA-Z0-9]+$/.test(code));
}
function resolveClientsVendedorCodes(req, requested) {
  const user = req.user || {};
  const userCode = normalizeVendorCode(user.code || user.id || user.codigoVendedor || user.vendedorCode);
  const raw = normalizeVendorCode(requested);
  const requestedAll = !raw || raw.toUpperCase() === 'ALL' || (userCode && clientCodesMatch(raw, userCode));
  if (!isClientsManager(user)) {
    if (!userCode) return { ok: false, status: 403, body: { success: false, code: 'FORBIDDEN_VENDOR', error: 'Usuario sin vendedor asignado' } };
    return { ok: true, vendedorCodes: userCode };
  }
  const visible = clientsVisibleVendorCodes(user);
  if (requestedAll) return { ok: true, vendedorCodes: visible.length ? visible.join(',') : 'ALL' };
  const codes = raw.split(',').map(normalizeVendorCode).filter(Boolean);
  if (visible.length && codes.some(code => !visible.some(v => clientCodesMatch(v, code)))) {
    return { ok: false, status: 403, body: { success: false, code: 'FORBIDDEN_VENDOR', error: 'Vendedor fuera de alcance' } };
  }
  return { ok: true, vendedorCodes: codes.join(',') };
}

function boundedInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeClientSearch(value) {
  return String(value || '')
    .trim()
    .replace(/[%_]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 80)
    .toUpperCase();
}

function buildClientSearchFilter(safeSearch, alias = 'C') {
  if (!safeSearch) return { clause: '', params: [] };

  const prefix = `${safeSearch}%`;
  if (/^\d+$/.test(safeSearch)) {
    return {
      clause: `AND(TRIM(${alias}.CODIGOCLIENTE) LIKE ?
                  OR UPPER(COALESCE(${alias}.NIF, '')) LIKE ?
                  OR TRIM(COALESCE(${alias}.TELEFONO1, '')) LIKE ?
                  OR TRIM(COALESCE(${alias}.TELEFONO2, '')) LIKE ?)`,
      params: [prefix, prefix, prefix, prefix],
    };
  }

  const textPattern = safeSearch.length < 3 ? prefix : `%${safeSearch}%`;
  return {
    clause: `AND(UPPER(COALESCE(${alias}.NOMBRECLIENTE, '')) LIKE ?
                OR UPPER(COALESCE(${alias}.NOMBREALTERNATIVO, '')) LIKE ?
                OR UPPER(COALESCE(${alias}.POBLACION, '')) LIKE ?
                OR UPPER(COALESCE(${alias}.NIF, '')) LIKE ?
                OR UPPER(COALESCE(${alias}.CODIGORUTA, '')) LIKE ?
                OR TRIM(${alias}.CODIGOCLIENTE) LIKE ?)`,
    params: [textPattern, textPattern, textPattern, prefix, prefix, prefix],
  };
}

function normalizeClientCodes(value, max = 20) {
  return String(value || '')
    .split(',')
    .map(code => code.trim().replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean)
    .slice(0, max);
}

function buildChunkedClientCodeFilter(column, codes) {
  const cleanCodes = (Array.isArray(codes) ? codes : [])
    .map(code => String(code || '').trim().replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);
  if (!cleanCodes.length) return { clause: '', count: 0, chunks: 0 };

  const CHUNK_SIZE = 1000;
  const chunks = [];
  for (let i = 0; i < cleanCodes.length; i += CHUNK_SIZE) {
    const chunk = cleanCodes.slice(i, i + CHUNK_SIZE).map(code => `'${code}'`).join(',');
    chunks.push(`${column} IN (${chunk})`);
  }
  return { clause: `AND (${chunks.join(' OR ')})`, count: cleanCodes.length, chunks: chunks.length };
}

function buildVendedorParamFilter(vendedorCodes, columnExpr) {
  const codes = vendorCodeArrayForClientScope(vendedorCodes);
  if (!codes.length) return { clause: '', params: [] };

  const hasUnknown = codes.some(code => code.toUpperCase() === 'UNK');
  const vendorCodes = codes.filter(code => code.toUpperCase() !== 'UNK');
  const clauses = [];
  const params = [];

  if (vendorCodes.length > 0) {
    clauses.push(`TRIM(${columnExpr}) IN (${vendorCodes.map(() => '?').join(',')})`);
    params.push(...vendorCodes);
  }
  if (hasUnknown) {
    clauses.push(`(${columnExpr} IS NULL OR TRIM(${columnExpr}) = '')`);
  }

  return clauses.length ? { clause: `AND (${clauses.join(' OR ')})`, params } : { clause: '', params: [] };
}

function isForceRefreshRequest(req) {
  return req?.query?.forceRefresh != null ||
    req?.query?.refresh != null ||
    req?.query?._ts != null;
}

// =============================================================================
// CLIENTS LIST (OPTIMIZED v2 - 2026-02-02)
// =============================================================================
const getClientsHandler = async (req, res) => {
  const startTime = Date.now();
  try {
    let { vendedorCodes, search, limit = 100, offset = 0 } = req.query;
    const scoped = resolveClientsVendedorCodes(req, vendedorCodes);
    if (!scoped.ok) return res.status(scoped.status).json(scoped.body);
    vendedorCodes = scoped.vendedorCodes;
    const vendedorFilter = buildVendedorFilterLACLAE(vendedorCodes);
    const safeLimit = boundedInt(limit, 1, 200, 100);
    const safeOffset = boundedInt(offset, 0, 100000, 0);
    const safeSearch = normalizeClientSearch(search);
    const isSearchQuery = safeSearch.length > 0;
    const searchClause = buildClientSearchFilter(safeSearch, 'C');
    const queryParams = searchClause.params;

    // OPTIMIZATION v3: Pre-compute allowed client codes from in-memory cache
    // This eliminates expensive NOT EXISTS and subquery route filters
    let clientCodesFilter = '';
    if (vendedorCodes && !safeSearch) {
      const { getClientCodesFromCache } = require('../services/laclae');
      const cachedClientCodes = getClientCodesFromCache(vendedorCodes);

      if (cachedClientCodes && cachedClientCodes.length > 0) {
        const built = buildChunkedClientCodeFilter('C.CODIGOCLIENTE', cachedClientCodes);
        clientCodesFilter = built.clause;
        logger.info(`[CLIENTS] Using cached client codes: ${built.count} clients (${built.chunks} chunks) for vendor ${vendedorCodes}`);
      }
    }

    const vendorScopedCliFilter = clientCodesFilter
        ? ''
        : buildClientListVendorSqlFilter(vendedorCodes, 'C');
    const laclaeBoundedFilter = clientCodesFilter
        ? clientCodesFilter.replace(/C\.CODIGOCLIENTE/g, 'LCCDCL')
        : buildLaclaeBoundedClientCodesSql(vendedorCodes);

    // Generate Cache Key (v5 = optimized with pre-filtered client codes)
    const cacheKey = `clients:list:v8:${vendedorCodes || 'ALL'}:${safeSearch || 'none'}:${safeLimit}:${safeOffset}`;
    // OPTIMIZATION: Longer TTL for ALL vendors (JEFE_VENTAS default)
    const isAllVendors = !vendedorCodes || vendedorCodes === 'ALL';
    const cacheTTL = isSearchQuery ? TTL.MEDIUM : (isAllVendors ? TTL.LONG : TTL.MEDIUM);

    // Execute with Cache (LONG TTL for browsing, MEDIUM for search)
    logger.info(`[CLIENTS] Starting query for vendor ${vendedorCodes || 'all'}, search: ${search || 'none'}`);
    const queryStart = Date.now();

    // v6: single LACLAE CTE (one pass for stats + last vendor) — cert target p95 < 3s
    const laclaeScopeFilter = laclaeBoundedFilter || vendedorFilter.replace(/L\./g, '');
    const clientQuery = (sql, params = []) => queryWithParams(sql, params, false);
    const clients = await cachedQuery(clientQuery, `
      WITH LACLAE_SCOPED AS (
        SELECT LCCDCL, LCIMVT, LCIMCT, LCAADC, LCMMDC, LCDDDC, LCCDVD
          FROM DSED.LACLAE
         WHERE LCAADC >= ${MIN_YEAR}
           AND TPDC = 'LAC'
           AND LCTPVT IN ('CC', 'VC')
           AND LCCLLN IN ('AB', 'VT')
           AND LCSRAB NOT IN ('N', 'Z')
           ${laclaeScopeFilter}
      ),
      LACLAE_AGG AS (
        SELECT
          LCCDCL AS CLIENT_CODE,
          SUM(LCIMVT) AS TOTAL_PURCHASES,
          SUM(LCIMVT - LCIMCT) AS TOTAL_MARGIN,
          COUNT(DISTINCT LCAADC || LCMMDC || LCDDDC) AS NUM_ORDERS,
          MAX(LCAADC * 10000 + LCMMDC * 100 + LCDDDC) AS LAST_PURCHASE_DATE
        FROM LACLAE_SCOPED
        GROUP BY LCCDCL
      ),
      LACLAE_LAST AS (
        SELECT CLIENT_CODE, LAST_VENDOR FROM (
          SELECT
            LCCDCL AS CLIENT_CODE,
            LCCDVD AS LAST_VENDOR,
            ROW_NUMBER() OVER (
              PARTITION BY LCCDCL
              ORDER BY LCAADC DESC, LCMMDC DESC, LCDDDC DESC
            ) AS RN
          FROM LACLAE_SCOPED
        ) X
        WHERE RN = 1
      )
      SELECT
        C.CODIGOCLIENTE as code,
        COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE)) as name,
        C.NIF as nif,
        C.DIRECCION as address, C.POBLACION as city, C.PROVINCIA as province,
        C.CODIGOPOSTAL as postalCode, C.TELEFONO1 as phone, C.TELEFONO2 as phone2,
        C.CODIGORUTA as route, C.PERSONACONTACTO as contactPerson,
        COALESCE(S.TOTAL_PURCHASES, 0) as totalPurchases,
        COALESCE(S.NUM_ORDERS, 0) as numOrders,
        COALESCE(S.LAST_PURCHASE_DATE, 0) as lastDateInt,
        COALESCE(S.TOTAL_MARGIN, 0) as totalMargin,
        C.ANOBAJA as yearInactive,
        TRIM(V.NOMBREVENDEDOR) as vendorName,
        LV.LAST_VENDOR as vendorCode
      FROM DSEDAC.CLI C
      LEFT JOIN LACLAE_AGG S ON C.CODIGOCLIENTE = S.CLIENT_CODE
      LEFT JOIN LACLAE_LAST LV ON LV.CLIENT_CODE = C.CODIGOCLIENTE
      LEFT JOIN DSEDAC.VDD V ON LV.LAST_VENDOR = V.CODIGOVENDEDOR
      WHERE C.ANOBAJA = 0
        ${clientCodesFilter || vendorScopedCliFilter}
        ${searchClause.clause}
      ORDER BY COALESCE(S.TOTAL_PURCHASES, 0) DESC
      OFFSET ${safeOffset} ROWS
      FETCH FIRST ${safeLimit} ROWS ONLY
    `, {
      cacheKey,
      ttl: cacheTTL,
      queryType: 'clients-list',
      params: { vendedorCodes: vendedorCodes || 'ALL', search: safeSearch || null, limit: safeLimit, offset: safeOffset },
      skipCache: isForceRefreshRequest(req),
    }, queryParams);

    const queryDuration = Date.now() - queryStart;
    logger.info(`[CLIENTS] Query completed: ${clients.length} rows in ${queryDuration}ms`);


    const formatDateFromInt = (dateInt) => {
      if (!dateInt || dateInt === 0) return null;
      const s = dateInt.toString();
      // 20251230 -> 30/12/2025
      if (s.length === 8) {
        return `${s.substring(6, 8)}/${s.substring(4, 6)}/${s.substring(0, 4)}`;
      }
      return null;
    };

    res.json({
      clients: clients.map(c => {
        const phones = [];
        if (c.PHONE?.trim()) phones.push({ type: 'Teléfono 1', number: c.PHONE.trim() });
        if (c.PHONE2?.trim()) phones.push({ type: 'Teléfono 2', number: c.PHONE2.trim() });

        // ENHANCED: Get visit days from Cache (Source of Truth: CDVI + LACLAE)
        // This fixes empty days for clients without sales
        let visitDays = [];
        let visitDaysShort = '';
        let deliveryDays = [];
        let deliveryDaysShort = '';
        let assignedVendor = c.VENDORCODE?.trim();

        const cachedDays = getClientDays(assignedVendor, c.CODE?.trim());

        if (cachedDays) {
          // Cache hit - use robust data
          visitDays = cachedDays.visitDays;
          visitDaysShort = cachedDays.visitDaysShort;
          deliveryDays = cachedDays.deliveryDays;
          deliveryDaysShort = cachedDays.deliveryDaysShort;

          // If we found the client in a vendor's cache but had no vendor in SQL (no sales), update it
          if (!assignedVendor && cachedDays.foundVendor) {
            assignedVendor = cachedDays.foundVendor;
          }
        } else {
          // Fallback to SQL columns (Legacy)
          if (c.VISL === 'S') { visitDays.push('lunes'); visitDaysShort += 'L'; }
          if (c.VISM === 'S') { visitDays.push('martes'); visitDaysShort += 'M'; }
          if (c.VISX === 'S') { visitDays.push('miercoles'); visitDaysShort += 'X'; }
          if (c.VISJ === 'S') { visitDays.push('jueves'); visitDaysShort += 'J'; }
          if (c.VISV === 'S') { visitDays.push('viernes'); visitDaysShort += 'V'; }
          if (c.VISS === 'S') { visitDays.push('sabado'); visitDaysShort += 'S'; }

          if (c.DELL === 'S') { deliveryDays.push('lunes'); deliveryDaysShort += 'L'; }
          if (c.DELM === 'S') { deliveryDays.push('martes'); deliveryDaysShort += 'M'; }
          if (c.DELX === 'S') { deliveryDays.push('miercoles'); deliveryDaysShort += 'X'; }
          if (c.DELJ === 'S') { deliveryDays.push('jueves'); deliveryDaysShort += 'J'; }
          if (c.DELV === 'S') { deliveryDays.push('viernes'); deliveryDaysShort += 'V'; }
          if (c.DELS === 'S') { deliveryDays.push('sabado'); deliveryDaysShort += 'S'; }
        }

        return {
          code: c.CODE?.trim(),
          name: c.NAME?.trim() || 'Sin nombre',
          nif: c.NIF?.trim(),
          address: c.ADDRESS?.trim(),
          city: c.CITY?.trim(),
          province: c.PROVINCE?.trim(),
          postalCode: c.POSTALCODE?.trim(),
          phone: c.PHONE?.trim(),
          phone2: c.PHONE2?.trim(),
          phones: phones,
          route: c.ROUTE?.trim(),
          contactPerson: c.CONTACTPERSON?.trim(),
          totalPurchases: formatCurrency(c.TOTALPURCHASES),
          totalMargin: formatCurrency(c.TOTALMARGIN),
          numOrders: parseInt(c.NUMORDERS) || 0,
          lastPurchase: formatDateFromInt(c.LASTDATEINT),
          vendorName: c.VENDORNAME?.trim(), // SQL might be null, but UI might fetch name if code exists
          vendorCode: assignedVendor,

          // Visit & Delivery Days
          visitDays: visitDays,
          visitDaysShort: visitDaysShort,
          deliveryDays: deliveryDays,
          deliveryDaysShort: deliveryDaysShort
        };
      }),
      hasMore: clients.length === safeLimit
    });

    const totalDuration = Date.now() - startTime;
    logger.info(`[CLIENTS] Total response time: ${totalDuration}ms for ${clients.length} clients`);

  } catch (error) {
    handleRouteError(error, res, 'Error obteniendo clientes', 500);
  }
};

router.get('/', verifyToken, getClientsHandler);
router.get('/list', verifyToken, getClientsHandler);

// =============================================================================
// CLIENT NOTES
// =============================================================================
router.put('/notes', verifyToken, async (req, res) => {
  try {
    const { clientCode, notes } = req.body;
    if (!clientCode) return res.status(400).json({ error: 'Client code required' });

    // Ensure table exists (basic check)
    try {
      await query(`SELECT 1 FROM JAVIER.CLIENT_NOTES FETCH FIRST 1 ROWS ONLY`, false);
    } catch (e) {
      // If fails, try create
      try {
        await query(`
                    CREATE TABLE JAVIER.CLIENT_NOTES (
                        CLIENT_CODE VARCHAR(20) NOT NULL PRIMARY KEY,
                        OBSERVACIONES VARCHAR(32000),
                        MODIFIED_BY VARCHAR(100),
                        MODIFIED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `, false);
      } catch (createErr) {
        logger.warn('Failed to create CLIENT_NOTES table (might exist): ' + createErr.message);
      }
    }

    const safeNotes = notes ? notes : '';
    const safeClientCode = sanitizeForSQL(clientCode);
    const existing = await queryWithParams(`SELECT CLIENT_CODE FROM JAVIER.CLIENT_NOTES WHERE CLIENT_CODE = ?`, [safeClientCode], false);

    if (existing.length > 0) {
      await queryWithParams(`
                UPDATE JAVIER.CLIENT_NOTES 
                SET OBSERVACIONES = ?, 
                    MODIFIED_BY = 'JAVIER', 
                    MODIFIED_AT = CURRENT_TIMESTAMP 
                WHERE CLIENT_CODE = ?
            `, [safeNotes, safeClientCode], false);
    } else {
      await queryWithParams(`
                INSERT INTO JAVIER.CLIENT_NOTES (CLIENT_CODE, OBSERVACIONES, MODIFIED_BY, MODIFIED_AT)
                VALUES (?, ?, 'JAVIER', CURRENT_TIMESTAMP)
            `, [safeClientCode, safeNotes], false);
    }

    res.json({ success: true });
  } catch (error) {
    handleRouteError(error, res, 'Error guardando notas', 500);
  }
});

// =============================================================================
// CLIENT COMPARISON
// =============================================================================
router.get('/compare', verifyToken, async (req, res) => {
  try {
    const { codes } = req.query;
    let { vendedorCodes } = req.query;
    const scoped = resolveClientsVendedorCodes(req, vendedorCodes);
    if (!scoped.ok) return res.status(scoped.status).json(scoped.body);
    vendedorCodes = scoped.vendedorCodes;
    if (!codes) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_CLIENT_COMPARE_PARAMS',
        error: 'Se requieren códigos de cliente (codes=CLI1,CLI2)',
      });
    }

    const clientCodes = normalizeClientCodes(codes, 10);
    if (!clientCodes.length) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_CLIENT_COMPARE_PARAMS',
        error: 'Se requieren codigos de cliente validos',
      });
    }
    const clientPlaceholders = clientCodes.map(() => '?').join(',');

    const now = getCurrentDate();
    const year = now.getFullYear();
    const vendedorFilter = buildVendedorParamFilter(vendedorCodes, 'L.CODIGOVENDEDOR');

    // Get comparison data for each client
    const comparison = await queryWithParams(`
      SELECT
        L.CODIGOCLIENTEALBARAN as code,
        MIN(C.NOMBRECLIENTE) as name,
        MIN(C.POBLACION) as city,
        SUM(L.IMPORTEVENTA) as totalSales,
        SUM(L.IMPORTEMARGENREAL) as totalMargin,
        SUM(L.CANTIDADENVASES) as totalBoxes,
        COUNT(DISTINCT L.ANODOCUMENTO || '-' || L.MESDOCUMENTO) as activeMonths,
        COUNT(DISTINCT L.CODIGOARTICULO) as uniqueProducts,
        AVG(L.IMPORTEVENTA) as avgOrderValue,
        MIN(L.ANODOCUMENTO * 100 + L.MESDOCUMENTO) as firstPurchase,
        MAX(L.ANODOCUMENTO * 100 + L.MESDOCUMENTO) as lastPurchase
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.CLI C ON L.CODIGOCLIENTEALBARAN = C.CODIGOCLIENTE
      WHERE L.CODIGOCLIENTEALBARAN IN(${clientPlaceholders})
        AND L.ANODOCUMENTO >= ?
        AND L.TIPOVENTA IN ('CC', 'VC')
        AND L.TIPOLINEA IN ('AB', 'VT') -- Added Golden Logic
        AND L.SERIEALBARAN NOT IN ('N', 'Z')
        ${vendedorFilter.clause}
      GROUP BY L.CODIGOCLIENTEALBARAN
    `, [...clientCodes, MIN_YEAR, ...vendedorFilter.params], false);

    // Get monthly breakdown for each client
    const monthlyBreakdown = await queryWithParams(`
      SELECT
        L.CODIGOCLIENTEALBARAN as code,
        L.ANODOCUMENTO as year,
        L.MESDOCUMENTO as month,
        SUM(L.IMPORTEVENTA) as sales
      FROM DSEDAC.LINDTO L
      WHERE L.CODIGOCLIENTEALBARAN IN(${clientPlaceholders})
        AND L.ANODOCUMENTO >= ?
        AND L.TIPOVENTA IN ('CC', 'VC')
        AND L.TIPOLINEA IN ('AB', 'VT')
        AND L.SERIEALBARAN NOT IN ('N', 'Z')
        ${vendedorFilter.clause}
      GROUP BY L.CODIGOCLIENTEALBARAN, L.ANODOCUMENTO, L.MESDOCUMENTO
      ORDER BY L.ANODOCUMENTO, L.MESDOCUMENTO
    `, [...clientCodes, year - 1, ...vendedorFilter.params], false);

    const clientsData = comparison.map(c => ({
      code: c.CODE?.trim(),
      name: c.NAME?.trim() || 'Sin nombre',
      city: c.CITY?.trim(),
      totalSales: formatCurrency(c.TOTALSALES),
      totalMargin: formatCurrency(c.TOTALMARGIN),
      marginPercent: c.TOTALSALES > 0 ? Math.round((c.TOTALMARGIN / c.TOTALSALES) * 1000) / 10 : 0,
      totalBoxes: parseInt(c.TOTALBOXES) || 0,
      activeMonths: parseInt(c.ACTIVEMONTHS) || 0,
      uniqueProducts: parseInt(c.UNIQUEPRODUCTS) || 0,
      avgOrderValue: formatCurrency(c.AVGORDERVALUE),
      monthly: monthlyBreakdown
        .filter(m => m.CODE?.trim() === c.CODE?.trim())
        .map(m => ({
          period: `${m.YEAR}-${String(m.MONTH).padStart(2, '0')}`,
          sales: formatCurrency(m.SALES)
        }))
    }));

    res.json({ clients: clientsData });

  } catch (error) {
    logger.error(`Client compare error: ${error.message} `);
    handleRouteError(error, res, 'Error comparando clientes', 500);
  }
});

// =============================================================================
// CLIENT DETAIL
// =============================================================================
router.get('/:code', verifyToken, async (req, res) => {
  try {
    const { code } = req.params;
    let { vendedorCodes } = req.query;
    const scoped = resolveClientsVendedorCodes(req, vendedorCodes);
    if (!scoped.ok) return res.status(scoped.status).json(scoped.body);
    vendedorCodes = scoped.vendedorCodes;
    const vendedorFilter = buildVendedorFilter(vendedorCodes);
    const clientCode = code.trim();
    const safeClientCode = clientCode.replace(/[^a-zA-Z0-9]/g, '');

    const scopeFilter = buildClientVendorParamFilter(vendorCodeArrayForClientScope(vendedorCodes), 'C');
    if (scopeFilter.clause) {
      const scopeRows = await queryWithParams(`
        SELECT 1 AS OK
        FROM DSEDAC.CLI C
        WHERE C.CODIGOCLIENTE = ?
          ${scopeFilter.clause}
        FETCH FIRST 1 ROWS ONLY
      `, [safeClientCode, ...scopeFilter.params], false);

      if (scopeRows.length === 0) {
        return res.status(403).json({
          success: false,
          code: 'FORBIDDEN_CLIENT',
          error: 'Cliente fuera de alcance del vendedor',
        });
      }
    }

    // Basic client info. Scope is verified before reading PII/business fields for COMERCIAL.
    // Include all phone fields for WhatsApp feature.
    const clientInfo = await queryWithParams(`
      SELECT C.CODIGOCLIENTE as code, C.NOMBRECLIENTE as name, C.NIF as nif,
  C.DIRECCION as address, C.POBLACION as city, C.PROVINCIA as province,
  C.CODIGOPOSTAL as postalCode, C.TELEFONO1 as phone, C.TELEFONO2 as phone2,
  CAST(NULL AS VARCHAR(254)) as email,
  C.CODIGORUTA as route, C.PERSONACONTACTO as contactPerson,
  C.OBSERVACIONES1 as notes, C.ANOALTA as yearCreated
      FROM DSEDAC.CLI C
      WHERE C.CODIGOCLIENTE = ?
      FETCH FIRST 1 ROWS ONLY
  `, [safeClientCode], false);

    if (clientInfo.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // OPTIMIZED: Execute ALL detail queries in PARALLEL for 6x speedup
    const queryResults = await Promise.all([
      // Query 1: Editable observations
      (async () => {
        try {
          const notesResult = await queryWithParams(`
            SELECT OBSERVACIONES, MODIFIED_BY, MODIFIED_AT
            FROM JAVIER.CLIENT_NOTES
            WHERE CLIENT_CODE = ?
            FETCH FIRST 1 ROWS ONLY
          `, [clientCode], false);
          return notesResult[0] || null;
        } catch (e) { return null; }
      })(),
      // Query 2: Sales summary
      query(`
        SELECT 
          SUM(IMPORTEVENTA) as totalSales,
          SUM(IMPORTEMARGENREAL) as totalMargin,
          SUM(CANTIDADENVASES) as totalBoxes,
          COUNT(*) as totalLines,
          COUNT(DISTINCT ANODOCUMENTO || '-' || MESDOCUMENTO || '-' || DIADOCUMENTO) as numOrders
        FROM DSEDAC.LINDTO
        WHERE CODIGOCLIENTEALBARAN = '${safeClientCode}' 
          AND ANODOCUMENTO >= ${MIN_YEAR} 
          AND TIPOVENTA IN ('CC', 'VC')
          AND TIPOLINEA IN ('AB', 'VT')
          AND SERIEALBARAN NOT IN ('N', 'Z')
          ${vendedorFilter}
      `),
      // Query 3: Monthly trend
      query(`
        SELECT ANODOCUMENTO as year, MESDOCUMENTO as month,
          SUM(IMPORTEVENTA) as sales, SUM(IMPORTEMARGENREAL) as margin
        FROM DSEDAC.LINDTO
        WHERE CODIGOCLIENTEALBARAN = '${safeClientCode}' 
          AND ANODOCUMENTO >= ${MIN_YEAR} 
          AND TIPOVENTA IN ('CC', 'VC')
          AND TIPOLINEA IN ('AB', 'VT')
          AND SERIEALBARAN NOT IN ('N', 'Z')
          ${vendedorFilter}
        GROUP BY ANODOCUMENTO, MESDOCUMENTO
        ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC
        FETCH FIRST 12 ROWS ONLY
      `),
      // Query 4: Top products
      query(`
        SELECT L.CODIGOARTICULO as code,
  COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.DESCRIPCION)) as name,
  SUM(L.IMPORTEVENTA) as totalSales,
  SUM(L.CANTIDADENVASES) as totalBoxes,
  COUNT(*) as timesOrdered
        FROM DSEDAC.LINDTO L
        LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
        WHERE L.CODIGOCLIENTEALBARAN = '${safeClientCode}' AND L.ANODOCUMENTO >= ${MIN_YEAR} ${vendedorFilter}
        GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, L.DESCRIPCION
        ORDER BY totalSales DESC
        FETCH FIRST 10 ROWS ONLY
      `),
      // Query 5: Payment status (CVC)
      query(`
        SELECT
          SUM(CASE WHEN CVC.SITUACION = 'C' THEN CVC.IMPORTEVENCIMIENTO ELSE 0 END) as paid,
          SUM(CASE WHEN CVC.SITUACION = 'P' THEN CVC.IMPORTEPENDIENTE ELSE 0 END) as pending,
          COUNT(CASE WHEN CVC.SITUACION = 'P' THEN 1 END) as pendingCount
        FROM DSEDAC.CVC CVC
        WHERE CVC.CODIGOCLIENTEALBARAN = '${safeClientCode}' AND CVC.ANOEMISION >= ${MIN_YEAR}
      `),
      // Query 6: CAC cross-validation (invoice totals)
      query(`
        SELECT
          SUM(CAC.IMPORTETOTAL) as totalInvoiced
        FROM DSEDAC.CAC CAC
        WHERE TRIM(CAC.CODIGOCLIENTEFACTURA) = '${safeClientCode}'
          AND CAC.EJERCICIOFACTURA >= ${MIN_YEAR}
          AND CAC.NUMEROFACTURA > 0
      `),
    ]);

    // Transform raw results into structured format
    const editableNotes = queryResults[0];
    const salesSummary = queryResults[1]?.[0] || {};
    const monthlyTrend = queryResults[2] || [];
    const topProducts = queryResults[3] || [];
    const paymentStatusResult = queryResults[4]?.[0] || {};
    const cacValidationResult = queryResults[5]?.[0] || {};

    const pendingCVC = parseFloat(paymentStatusResult.PENDING) || 0;
    const totalCAC = parseFloat(cacValidationResult.TOTALINVOICED) || 0;
    if (Math.abs(pendingCVC - totalCAC) > 100) {
      logger.warn(`[CLIENT ${safeClientCode}] CVC/CAC discrepancy: CVC pending=${pendingCVC.toFixed(2)}, CAC total=${totalCAC.toFixed(2)}, diff=${(pendingCVC - totalCAC).toFixed(2)}`);
    }

    const c = clientInfo[0];
    const s = salesSummary;
    const p = paymentStatusResult;

    // Build phone list for WhatsApp feature
    const phones = [];
    if (c.PHONE?.trim()) phones.push({ type: 'Teléfono 1', number: c.PHONE.trim() });
    if (c.PHONE2?.trim()) phones.push({ type: 'Teléfono 2', number: c.PHONE2.trim() });

    // Get visit/delivery days from LACLAE cache
    const vendorCode = vendedorCodes ? vendedorCodes.split(',')[0]?.trim() : null;
    const clientDays = getClientDays(vendorCode, clientCode);

    logger.info(`[CLIENT ${clientCode}] phones: ${JSON.stringify(phones)}, editableNotes: ${JSON.stringify(editableNotes)}, days: ${JSON.stringify(clientDays)}`);

    res.json({
      client: {
        code: c.CODE?.trim(),
        name: c.NAME?.trim(),
        nif: c.NIF?.trim(),
        address: c.ADDRESS?.trim(),
        city: c.CITY?.trim(),
        province: c.PROVINCE?.trim(),
        postalCode: c.POSTALCODE?.trim(),
        phone: c.PHONE?.trim(),
        phone2: c.PHONE2?.trim(),
        email: c.EMAIL?.trim(),
        phones: phones, // Array for WhatsApp selector
        route: c.ROUTE?.trim(),
        routeDescription: c.ROUTE?.trim() ? `Ruta ${c.ROUTE.trim()}` : null, // Will be enhanced if table exists
        contactPerson: c.CONTACTPERSON?.trim(),
        notes: c.NOTES?.trim(), // Original read-only notes from CLI
        editableNotes: editableNotes, // Editable notes from our table
        yearCreated: c.YEARCREATED,
        // NEW: Visit and Delivery days
        visitDays: clientDays?.visitDays || [],
        visitDaysShort: clientDays?.visitDaysShort || '',
        deliveryDays: clientDays?.deliveryDays || [],
        deliveryDaysShort: clientDays?.deliveryDaysShort || '',
        salesStats: {
          totalSales: formatCurrency(s.TOTALSALES),
          totalMargin: formatCurrency(s.TOTALMARGIN),
          totalBoxes: parseInt(s.TOTALBOXES) || 0,
          totalLines: parseInt(s.TOTALLINES) || 0,
          numOrders: parseInt(s.NUMORDERS) || 0
        },
        paymentStats: {
          paid: formatCurrency(p.PAID),
          pending: formatCurrency(p.PENDING),
          pendingCount: parseInt(p.PENDINGCOUNT) || 0
        }
      },
      monthlyTrend: monthlyTrend.map(m => ({
        year: m.YEAR,
        month: m.MONTH,
        sales: formatCurrency(m.SALES),
        margin: formatCurrency(m.MARGIN)
      })),
      topProducts: topProducts.map(p => ({
        code: p.CODE?.trim(),
        name: p.NAME?.trim(),
        totalSales: formatCurrency(p.TOTALSALES),
        totalBoxes: parseInt(p.TOTALBOXES) || 0,
        timesOrdered: parseInt(p.TIMESORDERED) || 0
      }))
    });

  } catch (error) {
    handleRouteError(error, res, 'Error obteniendo detalle de cliente', 500);
  }
});

// =============================================================================
// CLIENT EDITABLE NOTES (GET/PUT)
// =============================================================================
router.get('/:code/notes', verifyToken, async (req, res) => {
  try {
    const clientCode = req.params.code.trim();

    // First ensure table exists
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS JAVIER.CLIENT_NOTES (
          CLIENT_CODE VARCHAR(20) NOT NULL PRIMARY KEY,
          OBSERVACIONES VARCHAR(500),
          MODIFIED_BY VARCHAR(50),
          MODIFIED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `, false);
    } catch (e) {
      // Table may already exist
    }

    const result = await queryWithParams(`
      SELECT OBSERVACIONES, MODIFIED_BY, MODIFIED_AT
      FROM JAVIER.CLIENT_NOTES
      WHERE CLIENT_CODE = ?
    `, [clientCode], false);

    if (result[0]) {
      res.json({
        notes: result[0].OBSERVACIONES,
        modifiedBy: result[0].MODIFIED_BY,
        modifiedAt: result[0].MODIFIED_AT
      });
    } else {
      res.json({ notes: null, modifiedBy: null, modifiedAt: null });
    }
  } catch (error) {
    logger.error(`Get notes error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo notas' });
  }
});

router.put('/:code/notes', verifyToken, async (req, res) => {
  try {
    const clientCode = req.params.code.trim();
    const { notes, vendorCode, vendorName } = req.body;

    if (notes === undefined) {
      return res.status(400).json({ error: 'Campo notes requerido' });
    }

    const safeNotes = notes.substring(0, 500);
    const safeVendor = (vendorName || vendorCode || 'UNKNOWN').substring(0, 50);

    // Ensure table exists
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS JAVIER.CLIENT_NOTES (
          CLIENT_CODE VARCHAR(20) NOT NULL PRIMARY KEY,
          OBSERVACIONES VARCHAR(500),
          MODIFIED_BY VARCHAR(50),
          MODIFIED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `, false);
    } catch (e) {
      // Table may already exist
    }

    // UPSERT: Update if exists, insert if not (MERGE statement for DB2)
    const safeClientCode = sanitizeForSQL(clientCode);
    await queryWithParams(`
      MERGE INTO JAVIER.CLIENT_NOTES AS target
      USING (VALUES (?)) AS source(CLIENT_CODE)
      ON target.CLIENT_CODE = source.CLIENT_CODE
      WHEN MATCHED THEN
        UPDATE SET OBSERVACIONES = ?, MODIFIED_BY = ?, MODIFIED_AT = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (CLIENT_CODE, OBSERVACIONES, MODIFIED_BY, MODIFIED_AT)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `, [safeClientCode, safeNotes, safeVendor, safeClientCode, safeNotes, safeVendor]);

    logger.info(`[NOTES] Client ${clientCode} notes updated by ${safeVendor}`);
    res.json({ success: true, message: 'Notas guardadas correctamente' });
  } catch (error) {
    logger.error(`Save notes error: ${error.message}`);
    handleRouteError(error, res, 'Error guardando notas', 500);
  }
});

// =============================================================================
// CLIENT SALES HISTORY - PRODUCTS BY FAMILY
// =============================================================================
router.get('/:code/sales-history/family', verifyToken, async (req, res) => {
  try {
    const { code } = req.params;
    let { vendedorCodes, limit = 100, family1, family2, family3, groupLevel } = req.query;
    const scoped = resolveClientsVendedorCodes(req, vendedorCodes);
    if (!scoped.ok) return res.status(scoped.status).json(scoped.body);
    vendedorCodes = scoped.vendedorCodes;
    const clientCode = code.trim();
    const safeClientCode = clientCode.replace(/[^a-zA-Z0-9]/g, '');
    if (!safeClientCode) {
      return res.status(400).json({ success: false, code: 'INVALID_CLIENT_CODE', error: 'Codigo de cliente invalido' });
    }
    const safeFamily1 = family1?.replace(/[^a-zA-Z0-9]/g, '') || '';
    const safeFamily2 = family2 ? family2.replace(/[^a-zA-Z0-9]/g, '') : null;
    const safeFamily3 = family3 ? family3.replace(/[^a-zA-Z0-9]/g, '') : null;
    const parsedLevel = Number.parseInt(groupLevel, 10);
    const level = [1, 2, 3, 13].includes(parsedLevel) ? parsedLevel : 1;
    const safeLimit = boundedInt(limit, 1, 300, 100);
    const vendedorFilter = buildVendedorParamFilter(vendedorCodes, 'L.CODIGOVENDEDOR');

    const whereParts = [
      'L.CODIGOCLIENTEALBARAN = ?',
      'L.ANODOCUMENTO >= ?',
      "L.TIPOVENTA IN ('CC', 'VC')",
      "L.TIPOLINEA IN ('AB', 'VT')",
      "L.SERIEALBARAN NOT IN ('N', 'Z')",
    ];
    const params = [safeClientCode, MIN_YEAR, ...vendedorFilter.params];
    if (vendedorFilter.clause) whereParts.push(vendedorFilter.clause.replace(/^AND\s+/i, ''));

    if (level === 1 || level === 13) {
      whereParts.push('TRIM(A.CODIGOFAMILIA) = ?');
      params.push(safeFamily1);
    }
    if ((level >= 2 || level === 13) && safeFamily2) {
      whereParts.push("COALESCE(NULLIF(TRIM(A.CODIGOSUBFAMILIA), ''), 'General') = ?");
      params.push(safeFamily2);
    }
    if ((level >= 3 || level === 13) && safeFamily3) {
      whereParts.push("COALESCE(NULLIF(TRIM(A.CODIGOPREFAMILIA), ''), 'General') = ?");
      params.push(safeFamily3);
    }

    const products = await queryWithParams(`
      SELECT L.ANODOCUMENTO as year, L.MESDOCUMENTO as month, L.DIADOCUMENTO as day,
        L.CODIGOARTICULO as productCode,
        COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.DESCRIPCION), 'Sin descripción') as productName,
        SUM(L.CANTIDADENVASES) as boxes, SUM(L.CANTIDADUNIDADES) as units,
        SUM(L.IMPORTEVENTA) as amount, SUM(L.IMPORTEMARGENREAL) as margin,
        L.CODIGOVENDEDOR as vendedor
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
      WHERE ${whereParts.join(' AND ')}
      GROUP BY L.ANODOCUMENTO, L.MESDOCUMENTO, L.DIADOCUMENTO, L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, L.DESCRIPCION, L.CODIGOVENDEDOR
      ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC
      FETCH FIRST ${safeLimit} ROWS ONLY
    `, params, false);

    res.json({
      products: products.map(p => ({
        date: `${p.YEAR}-${String(p.MONTH).padStart(2, '0')}-${String(p.DAY).padStart(2, '0')}`,
        productCode: p.PRODUCTCODE?.trim(),
        productName: p.PRODUCTNAME?.trim(),
        boxes: parseInt(p.BOXES) || 0,
        units: parseInt(p.UNITS) || 0,
        amount: formatCurrency(p.AMOUNT),
        margin: formatCurrency(p.MARGIN),
        vendedor: p.VENDEDOR?.trim()
      }))
    });

  } catch (error) {
    logger.error(`Products by family error: ${error.message}`);
    handleRouteError(error, res, 'Error obteniendo productos por familia', 500);
  }
});

// =============================================================================
// CLIENT SALES HISTORY
// =============================================================================
router.get('/:code/sales-history', verifyToken, async (req, res) => {
  try {
    const { code } = req.params;
    let { vendedorCodes, limit = 50, offset = 0, groupByFamily = '0' } = req.query;
    const scoped = resolveClientsVendedorCodes(req, vendedorCodes);
    if (!scoped.ok) return res.status(scoped.status).json(scoped.body);
    vendedorCodes = scoped.vendedorCodes;
    const clientCode = code.trim();
    const safeClientCode = clientCode.replace(/[^a-zA-Z0-9]/g, '');
    if (!safeClientCode) {
      return res.status(400).json({ success: false, code: 'INVALID_CLIENT_CODE', error: 'Codigo de cliente invalido' });
    }
    const parsedFamilyLevel = Number.parseInt(groupByFamily, 10) || 0;
    const familyLevel = [0, 1, 2, 3, 13].includes(parsedFamilyLevel) ? parsedFamilyLevel : 0;
    const safeLimit = boundedInt(limit, 1, 300, 50);
    const safeOffset = boundedInt(offset, 0, 100000, 0);
    const vendedorFilter = buildVendedorParamFilter(vendedorCodes, 'CODIGOVENDEDOR');

    let sales;
    let hasMore = false;

    if (familyLevel === 0) {
      // No grouping - return individual products
      sales = await queryWithParams(`
        SELECT ANODOCUMENTO as year, MESDOCUMENTO as month, DIADOCUMENTO as day,
    CODIGOARTICULO as productCode,
    COALESCE(DESCRIPCION, 'Sin descripción') as productName,
    CANTIDADENVASES as boxes, CANTIDADUNIDADES as units,
    IMPORTEVENTA as amount, IMPORTEMARGENREAL as margin,
    CODIGOVENDEDOR as vendedor
        FROM DSEDAC.LINDTO
        WHERE CODIGOCLIENTEALBARAN = ? AND ANODOCUMENTO >= ?
          AND TIPOVENTA IN ('CC', 'VC')
          AND TIPOLINEA IN ('AB', 'VT')
          AND SERIEALBARAN NOT IN ('N', 'Z')
          ${vendedorFilter.clause}
        ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
        OFFSET ${safeOffset} ROWS
        FETCH FIRST ${safeLimit} ROWS ONLY
      `, [safeClientCode, MIN_YEAR, ...vendedorFilter.params], false);
      hasMore = sales.length === safeLimit;

      res.json({
        history: sales.map(s => ({
          date: `${s.YEAR}-${String(s.MONTH).padStart(2, '0')}-${String(s.DAY).padStart(2, '0')}`,
          productCode: s.PRODUCTCODE?.trim(),
          productName: s.PRODUCTNAME?.trim(),
          boxes: parseInt(s.BOXES) || 0,
          units: parseInt(s.UNITS) || 0,
          amount: formatCurrency(s.AMOUNT),
          margin: formatCurrency(s.MARGIN),
          vendedor: s.VENDEDOR?.trim()
        })),
        hasMore,
        grouped: false
      });
    } else {
      // Group by family level(s)
      const familySelects = [];
      const familyGroupBy = [];

      if (familyLevel === 1 || familyLevel === 13) {
        familySelects.push('TRIM(A.CODIGOFAMILIA) as family1');
        familyGroupBy.push('A.CODIGOFAMILIA');
      }
      if (familyLevel >= 2 && (familyLevel !== 13)) {
        familySelects.push("COALESCE(NULLIF(TRIM(A.CODIGOSUBFAMILIA), ''), 'General') as family2");
        familyGroupBy.push('A.CODIGOSUBFAMILIA');
      }
      if (familyLevel >= 3 && (familyLevel !== 13)) {
        familySelects.push("COALESCE(NULLIF(TRIM(A.CODIGOPREFAMILIA), ''), 'General') as family3");
        familyGroupBy.push('A.CODIGOPREFAMILIA');
      }
      if (familyLevel === 13) {
        familySelects.push("COALESCE(NULLIF(TRIM(A.CODIGOPREFAMILIA), ''), 'General') as family3");
        familyGroupBy.push('A.CODIGOPREFAMILIA');
      }

      const groupByClause = familyGroupBy.join(', ');

      const groupedVendorFilter = buildVendedorParamFilter(vendedorCodes, 'L.CODIGOVENDEDOR');
      sales = await queryWithParams(`
        SELECT ${familySelects.join(', ')},
          SUM(CANTIDADENVASES) as boxes,
          SUM(CANTIDADUNIDADES) as units,
          SUM(IMPORTEVENTA) as amount,
          SUM(IMPORTEMARGENREAL) as margin,
          COUNT(DISTINCT CODIGOARTICULO) as productCount
        FROM DSEDAC.LINDTO L
        LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
        WHERE L.CODIGOCLIENTEALBARAN = ? AND L.ANODOCUMENTO >= ?
          AND L.TIPOVENTA IN ('CC', 'VC')
          AND L.TIPOLINEA IN ('AB', 'VT')
          AND L.SERIEALBARAN NOT IN ('N', 'Z')
          ${groupedVendorFilter.clause}
        GROUP BY ${groupByClause}
        ORDER BY amount DESC
        FETCH FIRST ${safeLimit} ROWS ONLY
      `, [safeClientCode, MIN_YEAR, ...groupedVendorFilter.params], false);

      res.json({
        history: sales.map(s => {
          const item = {
            family1: s.FAMILY1?.trim() || 'Sin familia',
            boxes: parseInt(s.BOXES) || 0,
            units: parseInt(s.UNITS) || 0,
            amount: formatCurrency(s.AMOUNT),
            margin: formatCurrency(s.MARGIN),
            productCount: parseInt(s.PRODUCTCOUNT) || 0
          };
          if (familyLevel >= 2 && familyLevel !== 13) item.family2 = s.FAMILY2 || 'General';
          if (familyLevel >= 3 && familyLevel !== 13) item.family3 = s.FAMILY3 || 'General';
          if (familyLevel === 13) item.family3 = s.FAMILY3 || 'General';
          return item;
        }),
        hasMore: false,
        grouped: true,
        groupLevel: familyLevel
      });
    }

  } catch (error) {
    logger.error(`Client history error: ${error.message}`);
    handleRouteError(error, res, 'Error obteniendo historial', 500);
  }
});



module.exports = router;
