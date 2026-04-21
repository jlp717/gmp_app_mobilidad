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
  handleRouteError
} = require('../utils/common');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');
const { getClientDays } = require('../services/laclae');


// =============================================================================
// CLIENTS LIST (OPTIMIZED v2 - 2026-02-02)
// =============================================================================
const getClientsHandler = async (req, res) => {
  const startTime = Date.now();
  try {
    const { vendedorCodes, search, limit = 1000, offset = 0 } = req.query;
    const vendedorFilter = buildVendedorFilterLACLAE(vendedorCodes);
    const isSearchQuery = !!search;

    let safeSearch = '';
    let searchFilter = '';
    if (search) {
      safeSearch = sanitizeForSQL(search.trim()).toUpperCase();
      searchFilter = `AND(UPPER(C.NOMBRECLIENTE) LIKE '%${safeSearch}%'
                      OR UPPER(C.NOMBREALTERNATIVO) LIKE '%${safeSearch}%'
                      OR C.CODIGOCLIENTE LIKE '%${safeSearch}%'
                      OR UPPER(C.POBLACION) LIKE '%${safeSearch}%'
                      OR C.NIF LIKE '%${safeSearch}%')`;
    }

    // OPTIMIZATION v3: Pre-compute allowed client codes from in-memory cache
    // This eliminates expensive NOT EXISTS and subquery route filters
    let clientCodesFilter = '';
    if (vendedorCodes && !search) {
      const { getClientCodesFromCache } = require('../services/laclae');
      const cachedClientCodes = getClientCodesFromCache(vendedorCodes);

      if (cachedClientCodes && cachedClientCodes.length > 0) {
        // Use chunked IN clauses to handle unlimited client codes
        // DB2 IN clause has a practical limit, so we chunk into groups of 1000
        const CHUNK_SIZE = 1000;
        const chunks = [];
        for (let i = 0; i < cachedClientCodes.length; i += CHUNK_SIZE) {
          const chunk = cachedClientCodes.slice(i, i + CHUNK_SIZE).map(c => `'${c}'`).join(',');
          chunks.push(`C.CODIGOCLIENTE IN (${chunk})`);
        }
        clientCodesFilter = `AND (${chunks.join(' OR ')})`;
        logger.info(`[CLIENTS] Using cached client codes: ${cachedClientCodes.length} clients (${chunks.length} chunks) for vendor ${vendedorCodes}`);
      }
    }

    // Generate Cache Key (v5 = optimized with pre-filtered client codes)
    const cacheKey = `clients:list:v5:${vendedorCodes || 'ALL'}:${safeSearch || 'none'}:${limit}:${offset}`;
    // OPTIMIZATION: Longer TTL for ALL vendors (JEFE_VENTAS default)
    const isAllVendors = !vendedorCodes || vendedorCodes === 'ALL';
    const cacheTTL = isSearchQuery ? TTL.MEDIUM : (isAllVendors ? TTL.LONG : TTL.MEDIUM);

    // Execute with Cache (LONG TTL for browsing, MEDIUM for search)
    logger.info(`[CLIENTS] Starting query for vendor ${vendedorCodes || 'all'}, search: ${search || 'none'}`);
    const queryStart = Date.now();

    // SIMPLIFIED QUERY v3: Single LACLAE scan with pre-filtered client codes
    const clients = await cachedQuery(query, `
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
      LEFT JOIN (
        SELECT
          LCCDCL as CLIENT_CODE,
          SUM(LCIMVT) as TOTAL_PURCHASES,
          SUM(LCIMVT - LCIMCT) as TOTAL_MARGIN,
          COUNT(DISTINCT LCAADC || LCMMDC || LCDDDC) as NUM_ORDERS,
          MAX(LCAADC * 10000 + LCMMDC * 100 + LCDDDC) as LAST_PURCHASE_DATE
        FROM DSED.LACLAE
        WHERE LCAADC >= ${MIN_YEAR}
          AND TPDC = 'LAC'
          AND LCTPVT IN ('CC', 'VC')
          AND LCCLLN IN ('AB', 'VT')
          AND LCSRAB NOT IN ('N', 'Z')
          ${clientCodesFilter ? clientCodesFilter.replace(/C\.CODIGOCLIENTE/g, 'LCCDCL') : vendedorFilter.replace(/L\./g, '')}
        GROUP BY LCCDCL
      ) S ON C.CODIGOCLIENTE = S.CLIENT_CODE
      -- Get vendor from most recent transaction (DB2 compatible)
      -- When cache is active, use C.CODIGOCLIENTE (always resolves, even without matching sales)
      -- When no cache (fallback), use S.CLIENT_CODE (only resolves for clients with vendor-filtered sales)
      LEFT JOIN LATERAL (
        SELECT LCCDVD as LAST_VENDOR
        FROM DSED.LACLAE
        WHERE LCCDCL = ${clientCodesFilter ? 'C.CODIGOCLIENTE' : 'S.CLIENT_CODE'}
          AND LCAADC >= ${MIN_YEAR}
          AND TPDC = 'LAC'
          AND LCTPVT IN ('CC', 'VC')
          AND LCCLLN IN ('AB', 'VT')
          AND LCSRAB NOT IN ('N', 'Z')
        ORDER BY LCAADC DESC, LCMMDC DESC, LCDDDC DESC
        FETCH FIRST 1 ROWS ONLY
      ) LV ON 1=1
      LEFT JOIN DSEDAC.VDD V ON LV.LAST_VENDOR = V.CODIGOVENDEDOR
      WHERE C.ANOBAJA = 0
        ${clientCodesFilter || (!vendedorCodes || vendedorCodes === 'ALL' || vendedorCodes.trim() === '' ? '' : `AND LV.LAST_VENDOR IS NOT NULL`)}
        ${searchFilter}
      ORDER BY COALESCE(S.TOTAL_PURCHASES, 0) DESC
      OFFSET ${parseInt(offset)} ROWS
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
    `, cacheKey, cacheTTL);

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
      hasMore: clients.length === parseInt(limit)
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
// CLIENT DETAIL
// =============================================================================
router.get('/:code', verifyToken, async (req, res) => {
  try {
    const { code } = req.params;
    const { vendedorCodes } = req.query;
    const vendedorFilter = buildVendedorFilter(vendedorCodes);
    const clientCode = code.trim();
    const safeClientCode = clientCode.replace(/[^a-zA-Z0-9]/g, '');

    // Basic client info
    // Include all phone fields for WhatsApp feature
    const clientInfo = await query(`
      SELECT C.CODIGOCLIENTE as code, C.NOMBRECLIENTE as name, C.NIF as nif,
  C.DIRECCION as address, C.POBLACION as city, C.PROVINCIA as province,
  C.CODIGOPOSTAL as postalCode, C.TELEFONO1 as phone, C.TELEFONO2 as phone2,
  C.EMAIL as email,
  C.CODIGORUTA as route, C.PERSONACONTACTO as contactPerson,
  C.OBSERVACIONES1 as notes, C.ANOALTA as yearCreated
      FROM DSEDAC.CLI C
      WHERE C.CODIGOCLIENTE = '${safeClientCode}'
      FETCH FIRST 1 ROWS ONLY
  `);

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
      // Query 5: Payment status
      query(`
        SELECT
          SUM(CASE WHEN CVC.SITUACION = 'C' THEN CVC.IMPORTEVENCIMIENTO ELSE 0 END) as paid,
          SUM(CASE WHEN CVC.SITUACION = 'P' THEN CVC.IMPORTEPENDIENTE ELSE 0 END) as pending,
          COUNT(CASE WHEN CVC.SITUACION = 'P' THEN 1 END) as pendingCount
        FROM DSEDAC.CVC CVC
        WHERE CVC.CODIGOCLIENTEALBARAN = '${safeClientCode}' AND CVC.ANOEMISION >= ${MIN_YEAR}
      `),
    ]);

    // Transform raw results into structured format
    const editableNotes = queryResults[0];
    const salesSummary = queryResults[1]?.[0] || {};
    const monthlyTrend = queryResults[2] || [];
    const topProducts = queryResults[3] || [];
    const paymentStatusResult = queryResults[4]?.[0] || {};

    // Payment status from CVC with CAC cross-validation
    // CVC tracks payment/vencimiento records; CAC has the actual invoice totals.
    // We query both and log discrepancies for auditing.
    const paymentStatus = await query(`
      SELECT
        SUM(CASE WHEN CVC.SITUACION = 'C' THEN CVC.IMPORTEVENCIMIENTO ELSE 0 END) as paid,
        SUM(CASE WHEN CVC.SITUACION = 'P' THEN CVC.IMPORTEPENDIENTE ELSE 0 END) as pending,
        COUNT(CASE WHEN CVC.SITUACION = 'P' THEN 1 END) as pendingCount
      FROM DSEDAC.CVC CVC
      WHERE CVC.CODIGOCLIENTEALBARAN = '${safeClientCode}' AND CVC.ANOEMISION >= ${MIN_YEAR}
`);

    // CAC cross-validation: sum invoice totals for comparison
    const cacValidation = await query(`
      SELECT
        SUM(CAC.IMPORTETOTAL) as totalInvoiced
      FROM DSEDAC.CAC CAC
      WHERE TRIM(CAC.CODIGOCLIENTEFACTURA) = '${safeClientCode}'
        AND CAC.EJERCICIOFACTURA >= ${MIN_YEAR}
        AND CAC.NUMEROFACTURA > 0
    `);

    const pendingCVC = parseFloat(paymentStatus[0]?.PENDING) || 0;
    const totalCAC = parseFloat(cacValidation[0]?.TOTALINVOICED) || 0;
    if (Math.abs(pendingCVC - totalCAC) > 100) {
      logger.warn(`[CLIENT ${safeClientCode}] CVC/CAC discrepancy: CVC pending=${pendingCVC.toFixed(2)}, CAC total=${totalCAC.toFixed(2)}, diff=${(pendingCVC - totalCAC).toFixed(2)}`);
    }

    const c = clientInfo[0];
    const s = salesSummary;
    const p = paymentStatus[0] || {};

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
// CLIENT SALES HISTORY
// =============================================================================
router.get('/:code/sales-history', verifyToken, async (req, res) => {
  try {
    const { code } = req.params;
    const { vendedorCodes, limit = 50, offset = 0 } = req.query;
    const vendedorFilter = buildVendedorFilter(vendedorCodes);
    const clientCode = code.trim();
    const safeClientCode = clientCode.replace(/[^a-zA-Z0-9]/g, '');

    // Safe query for sales history
    const sales = await query(`
      SELECT ANODOCUMENTO as year, MESDOCUMENTO as month, DIADOCUMENTO as day,
  CODIGOARTICULO as productCode,
  COALESCE(DESCRIPCION, 'Sin descripción') as productName,
  CANTIDADENVASES as boxes, CANTIDADUNIDADES as units,
  IMPORTEVENTA as amount, IMPORTEMARGENREAL as margin,
  CODIGOVENDEDOR as vendedor
      FROM DSEDAC.LINDTO
      WHERE CODIGOCLIENTEALBARAN = '${safeClientCode}' AND ANODOCUMENTO >= ${MIN_YEAR} 
        AND TIPOVENTA IN ('CC', 'VC')
        AND TIPOLINEA IN ('AB', 'VT')
        AND SERIEALBARAN NOT IN ('N', 'Z')
        ${vendedorFilter}
      ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
      OFFSET ${parseInt(offset)} ROWS
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
    `);

    res.json({
      history: sales.map(s => ({
        date: `${s.YEAR} -${String(s.MONTH).padStart(2, '0')} -${String(s.DAY).padStart(2, '0')} `,
        productCode: s.PRODUCTCODE?.trim(),
        productName: s.PRODUCTNAME?.trim(),
        boxes: parseInt(s.BOXES) || 0,
        units: parseInt(s.UNITS) || 0,
        amount: formatCurrency(s.AMOUNT),
        margin: formatCurrency(s.MARGIN),
        vendedor: s.VENDEDOR?.trim()
      })),
      hasMore: sales.length === parseInt(limit)
    });

  } catch (error) {
    logger.error(`Client history error: ${error.message} `);
    handleRouteError(error, res, 'Error obteniendo historial', 500);
  }
});


// =============================================================================
// CLIENT COMPARISON
// =============================================================================
router.get('/compare', verifyToken, async (req, res) => {
  try {
    const { codes, vendedorCodes } = req.query;
    if (!codes) {
      return res.status(400).json({ error: 'Se requieren códigos de cliente (codes=CLI1,CLI2)' });
    }

    // Sanitize input for IN clause
    const clientCodes = codes.split(',')
      .map(c => `'${sanitizeForSQL(c.trim())}'`)
      .join(',');

    const now = getCurrentDate();
    const year = now.getFullYear();
    const vendedorFilter = buildVendedorFilter(vendedorCodes, 'L');

    // Get comparison data for each client
    const comparison = await query(`
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
      WHERE L.CODIGOCLIENTEALBARAN IN(${clientCodes})
        AND L.ANODOCUMENTO >= ${MIN_YEAR} 
        AND L.TIPOVENTA IN ('CC', 'VC')
        AND L.TIPOLINEA IN ('AB', 'VT') -- Added Golden Logic
        AND L.SERIEALBARAN NOT IN ('N', 'Z')
        ${vendedorFilter}
      GROUP BY L.CODIGOCLIENTEALBARAN
    `);

    // Get monthly breakdown for each client
    const monthlyBreakdown = await query(`
      SELECT
        CODIGOCLIENTEALBARAN as code,
        ANODOCUMENTO as year,
        MESDOCUMENTO as month,
        SUM(IMPORTEVENTA) as sales
      FROM DSEDAC.LINDTO
      WHERE CODIGOCLIENTEALBARAN IN(${clientCodes})
        AND ANODOCUMENTO >= ${year - 1} 
        AND TIPOVENTA IN ('CC', 'VC')
        AND TIPOLINEA IN ('AB', 'VT')
        AND SERIEALBARAN NOT IN ('N', 'Z')
        ${vendedorFilter}
      GROUP BY CODIGOCLIENTEALBARAN, ANODOCUMENTO, MESDOCUMENTO
      ORDER BY ANODOCUMENTO, MESDOCUMENTO
    `);

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

module.exports = router;
