const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query, queryWithParams } = require('../config/db');
const {
  buildVendedorFilter,
  buildVendedorFilterLACLAE,
  formatCurrency,
  MIN_YEAR,
  LACLAE_SALES_FILTER
} = require('../utils/common');


// =============================================================================
// CLIENTS LIST
// =============================================================================
const getClientsHandler = async (req, res) => {
  try {
    const { vendedorCodes, search, limit = 1000, offset = 0 } = req.query;
    const vendedorFilter = buildVendedorFilterLACLAE(vendedorCodes);

    let searchFilter = '';
    if (search) {
      const safeSearch = search.replace(/'/g, "''").trim().toUpperCase();
      searchFilter = `AND(UPPER(C.NOMBRECLIENTE) LIKE '%${safeSearch}%' 
                      OR UPPER(C.NOMBREALTERNATIVO) LIKE '%${safeSearch}%'
                      OR C.CODIGOCLIENTE LIKE '%${safeSearch}%'
                      OR UPPER(C.POBLACION) LIKE '%${safeSearch}%'
                      OR C.NIF LIKE '%${safeSearch}%')`;
    }

    // Using DSED.LACLAE with LCIMVT for sales WITHOUT VAT (matches 15,220,182.87€ for 2025)
    const clients = await query(`
      SELECT
        C.CODIGOCLIENTE as code, 
        MAX(COALESCE(NULLIF(TRIM(C.NOMBREALTERNATIVO), ''), TRIM(C.NOMBRECLIENTE))) as name, 
        MAX(C.NIF) as nif,
        MAX(C.DIRECCION) as address, MAX(C.POBLACION) as city, MAX(C.PROVINCIA) as province,
        MAX(C.CODIGOPOSTAL) as postalCode, MAX(C.TELEFONO1) as phone, MAX(C.TELEFONO2) as phone2,
        MAX(C.CODIGORUTA) as route, MAX(C.PERSONACONTACTO) as contactPerson,
        COALESCE(MAX(S.TOTAL_PURCHASES), 0) as totalPurchases,
        COALESCE(MAX(S.NUM_ORDERS), 0) as numOrders,
        COALESCE(MAX(S.LAST_PURCHASE_DATE), 0) as lastDateInt,
        COALESCE(MAX(S.TOTAL_MARGIN), 0) as totalMargin,
        MAX(C.ANOBAJA) as yearInactive,
        MAX(TRIM(V.NOMBREVENDEDOR)) as vendorName
      FROM DSEDAC.CLI C
      LEFT JOIN(
        SELECT LCCDCL as CODIGOCLIENTEALBARAN,
        MAX(LCCDVD) as LAST_VENDOR,
        SUM(LCIMVT) as TOTAL_PURCHASES,
        SUM(LCIMVT - LCIMCT) as TOTAL_MARGIN,
        COUNT(DISTINCT LCAADC || '-' || LCMMDC || '-' || LCDDDC) as NUM_ORDERS,
        MAX(LCAADC * 10000 + LCMMDC * 100 + LCDDDC) as LAST_PURCHASE_DATE
        FROM DSED.LACLAE 
        WHERE LCAADC >= ${MIN_YEAR}
          AND TPDC = 'LAC'
          AND LCTPVT IN ('CC', 'VC')
          AND LCCLLN IN ('AB', 'VT')
          AND LCSRAB NOT IN ('N', 'Z')
          ${vendedorFilter.replace(/L\./g, '')}
        GROUP BY LCCDCL
      ) S ON C.CODIGOCLIENTE = S.CODIGOCLIENTEALBARAN
      LEFT JOIN DSEDAC.VDD V ON S.LAST_VENDOR = V.CODIGOVENDEDOR
      WHERE C.ANOBAJA = 0
        AND S.LAST_VENDOR IS NOT NULL -- CRITICAL: Only show clients with sales for this vendor
        ${searchFilter}
      GROUP BY C.CODIGOCLIENTE
      ORDER BY COALESCE(MAX(S.TOTAL_PURCHASES), 0) DESC
      OFFSET ${parseInt(offset)} ROWS
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
    `);


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
      clients: clients.map(c => ({
        code: c.CODE?.trim(),
        name: c.NAME?.trim() || 'Sin nombre',
        nif: c.NIF?.trim(),
        address: c.ADDRESS?.trim(),
        city: c.CITY?.trim(),
        province: c.PROVINCE?.trim(),
        postalCode: c.POSTALCODE?.trim(),
        phone: c.PHONE?.trim(),
        phone2: c.PHONE2?.trim(),
        route: c.ROUTE?.trim(),
        contactPerson: c.CONTACTPERSON?.trim(),
        totalPurchases: formatCurrency(c.TOTALPURCHASES),
        totalMargin: formatCurrency(c.TOTALMARGIN),
        numOrders: parseInt(c.NUMORDERS) || 0,
        lastPurchase: formatDateFromInt(c.LASTDATEINT),
        vendorName: c.VENDORNAME?.trim()
      })),
      hasMore: clients.length === parseInt(limit)
    });

  } catch (error) {
    logger.error(`Clients error: ${error.message} `);
    res.status(500).json({ error: 'Error obteniendo clientes', details: error.message });
  }
};

router.get('/', getClientsHandler);
router.get('/list', getClientsHandler);

// =============================================================================
// CLIENT DETAIL
// =============================================================================
router.get('/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const { vendedorCodes } = req.query;
    const vendedorFilter = buildVendedorFilter(vendedorCodes);
    const clientCode = code.trim();

    // Basic client info - using parameterized query
    const clientInfo = await queryWithParams(`
      SELECT C.CODIGOCLIENTE as code, C.NOMBRECLIENTE as name, C.NIF as nif,
  C.DIRECCION as address, C.POBLACION as city, C.PROVINCIA as province,
  C.CODIGOPOSTAL as postalCode, C.TELEFONO1 as phone, C.TELEFONO2 as phone2,
  C.CODIGORUTA as route, C.PERSONACONTACTO as contactPerson,
  C.OBSERVACIONES1 as notes, C.ANOALTA as yearCreated
      FROM DSEDAC.CLI C
      WHERE C.CODIGOCLIENTE = ?
      FETCH FIRST 1 ROWS ONLY
  `, [clientCode]);

    if (clientInfo.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // Sales summary - parameterized query
    const salesSummary = await queryWithParams(`
      SELECT 
        SUM(IMPORTEVENTA) as totalSales,
        SUM(IMPORTEMARGENREAL) as totalMargin,
        SUM(CANTIDADENVASES) as totalBoxes,
        COUNT(*) as totalLines,
        COUNT(DISTINCT ANODOCUMENTO || '-' || MESDOCUMENTO || '-' || DIADOCUMENTO) as numOrders
      FROM DSEDAC.LINDTO
      WHERE CODIGOCLIENTEALBARAN = ? 
        AND ANODOCUMENTO >= ${MIN_YEAR} 
        AND TIPOVENTA IN ('CC', 'VC')
        AND TIPOLINEA IN ('AB', 'VT') -- Assuming TIPOLINEA exists in LINDTO
        AND SERIEALBARAN NOT IN ('N', 'Z')
        ${vendedorFilter}
    `, [clientCode]);

    // Monthly sales trend (last 12 months) - parameterized
    const monthlyTrend = await queryWithParams(`
      SELECT ANODOCUMENTO as year, MESDOCUMENTO as month,
        SUM(IMPORTEVENTA) as sales, SUM(IMPORTEMARGENREAL) as margin
      FROM DSEDAC.LINDTO
      WHERE CODIGOCLIENTEALBARAN = ? 
        AND ANODOCUMENTO >= ${MIN_YEAR} 
        AND TIPOVENTA IN ('CC', 'VC')
        AND TIPOLINEA IN ('AB', 'VT')
        AND SERIEALBARAN NOT IN ('N', 'Z')
        ${vendedorFilter}
      GROUP BY ANODOCUMENTO, MESDOCUMENTO
      ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC
      FETCH FIRST 12 ROWS ONLY
  `, [clientCode]);

    // Top products for this client - parameterized
    const topProducts = await queryWithParams(`
      SELECT L.CODIGOARTICULO as code,
  COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.DESCRIPCION)) as name,
  SUM(L.IMPORTEVENTA) as totalSales,
  SUM(L.CANTIDADENVASES) as totalBoxes,
  COUNT(*) as timesOrdered
      FROM DSEDAC.LINDTO L
      LEFT JOIN DSEDAC.ART A ON TRIM(L.CODIGOARTICULO) = TRIM(A.CODIGOARTICULO)
      WHERE L.CODIGOCLIENTEALBARAN = ? AND L.ANODOCUMENTO >= ${MIN_YEAR} ${vendedorFilter}
      GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, L.DESCRIPCION
      ORDER BY totalSales DESC
      FETCH FIRST 10 ROWS ONLY
  `, [clientCode]);

    // Payment status from CVC - Fixed missing safeCode variable by using parameterization
    const paymentStatus = await queryWithParams(`
      SELECT
        SUM(CASE WHEN SITUACION = 'C' THEN IMPORTEVENCIMIENTO ELSE 0 END) as paid,
        SUM(CASE WHEN SITUACION = 'P' THEN IMPORTEPENDIENTE ELSE 0 END) as pending,
        COUNT(CASE WHEN SITUACION = 'P' THEN 1 END) as pendingCount
      FROM DSEDAC.CVC
      WHERE CODIGOCLIENTEALBARAN = ? AND ANOEMISION >= ${MIN_YEAR}
`, [clientCode]);

    const c = clientInfo[0];
    const s = salesSummary[0] || {};
    const p = paymentStatus[0] || {};

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
        route: c.ROUTE?.trim(),
        contactPerson: c.CONTACTPERSON?.trim(),
        notes: c.NOTES?.trim(),
        yearCreated: c.YEARCREATED,
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
    logger.error(`Client detail error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo detalle de cliente', details: error.message });
  }
});

// =============================================================================
// CLIENT SALES HISTORY
// =============================================================================
router.get('/:code/sales-history', async (req, res) => {
  try {
    const { code } = req.params;
    const { vendedorCodes, limit = 50, offset = 0 } = req.query;
    const vendedorFilter = buildVendedorFilter(vendedorCodes);
    const clientCode = code.trim();

    // Parameterized query for safety
    const sales = await queryWithParams(`
      SELECT ANODOCUMENTO as year, MESDOCUMENTO as month, DIADOCUMENTO as day,
  CODIGOARTICULO as productCode,
  COALESCE(DESCRIPCION, 'Sin descripción') as productName,
  CANTIDADENVASES as boxes, CANTIDADUNIDADES as units,
  IMPORTEVENTA as amount, IMPORTEMARGENREAL as margin,
  CODIGOVENDEDOR as vendedor
      FROM DSEDAC.LINDTO
      WHERE CODIGOCLIENTEALBARAN = ? AND ANODOCUMENTO >= ${MIN_YEAR} 
        AND TIPOVENTA IN ('CC', 'VC')
        AND TIPOLINEA IN ('AB', 'VT')
        AND SERIEALBARAN NOT IN ('N', 'Z')
        ${vendedorFilter}
      ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
      OFFSET ${parseInt(offset)} ROWS
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
    `, [clientCode]);

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
    res.status(500).json({ error: 'Error obteniendo historial', details: error.message });
  }
});


// =============================================================================
// CLIENT COMPARISON
// =============================================================================
router.get('/compare', async (req, res) => {
  try {
    const { codes, vendedorCodes } = req.query;
    if (!codes) {
      return res.status(400).json({ error: 'Se requieren códigos de cliente (codes=CLI1,CLI2)' });
    }

    // Sanitize input for IN clause
    const clientCodes = codes.split(',')
      .map(c => `'${c.trim().replace(/'/g, "''")}'`)
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
    res.status(500).json({ error: 'Error comparando clientes', details: error.message });
  }
});

module.exports = router;
