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
const { getClientDays } = require('../services/laclae');


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

    // Build route filter: include clients from vendor's routes (even without sales)
    // If vendor has ANY sales in a route, show ALL clients from that route
    let routeFilter = '';
    if (vendedorCodes) {
      const vendorList = vendedorCodes.split(',').map(v => `'${v.trim()}'`).join(',');
      routeFilter = `
        OR C.CODIGORUTA IN (
          SELECT DISTINCT CLI_INNER.CODIGORUTA
          FROM DSED.LACLAE LAC_INNER
          JOIN DSEDAC.CLI CLI_INNER ON LAC_INNER.LCCDCL = CLI_INNER.CODIGOCLIENTE
          WHERE LAC_INNER.LCCDVD IN (${vendorList})
            AND LAC_INNER.TPDC = 'LAC'
            AND LAC_INNER.LCAADC >= ${MIN_YEAR}
            AND CLI_INNER.CODIGORUTA IS NOT NULL
            AND CLI_INNER.CODIGORUTA <> ''
        )
      `;
    }

    // Using DSED.LACLAE with LCIMVT for sales WITHOUT VAT
    // Now includes clients from vendor's routes even if they have no sales yet
    // For clients without sales, we get the predominant vendor of their route
    // Also includes visit/delivery days from LACLAE
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
        COALESCE(MAX(TRIM(V.NOMBREVENDEDOR)), MAX(TRIM(RV.NOMBREVENDEDOR))) as vendorName,
        COALESCE(MAX(S.LAST_VENDOR), MAX(RV.CODIGOVENDEDOR)) as vendorCode,
        MAX(D.VIS_L) as visL, MAX(D.VIS_M) as visM, MAX(D.VIS_X) as visX,
        MAX(D.VIS_J) as visJ, MAX(D.VIS_V) as visV, MAX(D.VIS_S) as visS,
        MAX(D.DEL_L) as delL, MAX(D.DEL_M) as delM, MAX(D.DEL_X) as delX,
        MAX(D.DEL_J) as delJ, MAX(D.DEL_V) as delV, MAX(D.DEL_S) as delS
      FROM DSEDAC.CLI C
      LEFT JOIN(
        SELECT
            Stats.LCCDCL as CODIGOCLIENTEALBARAN,
            LastV.LCCDVD as LAST_VENDOR,
            Stats.TOTAL_PURCHASES,
            Stats.TOTAL_MARGIN,
            Stats.NUM_ORDERS,
            Stats.LAST_PURCHASE_DATE
        FROM (
            SELECT LCCDCL,
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
        ) Stats
        LEFT JOIN (
            SELECT LCCDCL, LCCDVD
            FROM (
                SELECT LCCDCL, LCCDVD,
                    ROW_NUMBER() OVER(PARTITION BY LCCDCL ORDER BY (LCAADC * 10000 + LCMMDC * 100 + LCDDDC) DESC, LCCDVD ASC) as RN
                FROM DSED.LACLAE
                WHERE LCAADC >= ${MIN_YEAR}
                  AND TPDC = 'LAC'
                  AND LCTPVT IN ('CC', 'VC')
                  AND LCCLLN IN ('AB', 'VT')
                  AND LCSRAB NOT IN ('N', 'Z')
                  ${vendedorFilter.replace(/L\./g, '')}
            ) T WHERE RN = 1
        ) LastV ON Stats.LCCDCL = LastV.LCCDCL
      ) S ON C.CODIGOCLIENTE = S.CODIGOCLIENTEALBARAN
      LEFT JOIN DSEDAC.VDD V ON S.LAST_VENDOR = V.CODIGOVENDEDOR
      LEFT JOIN (
        SELECT CODIGORUTA, CODIGOVENDEDOR, NOMBREVENDEDOR
        FROM (
          SELECT
            CLI_R.CODIGORUTA,
            LAC_R.R1_T8CDVD as CODIGOVENDEDOR,
            VDD_R.NOMBREVENDEDOR,
            ROW_NUMBER() OVER(PARTITION BY CLI_R.CODIGORUTA ORDER BY COUNT(*) DESC) as RN
          FROM DSED.LACLAE LAC_R
          JOIN DSEDAC.CLI CLI_R ON LAC_R.LCCDCL = CLI_R.CODIGOCLIENTE
          JOIN DSEDAC.VDD VDD_R ON LAC_R.R1_T8CDVD = VDD_R.CODIGOVENDEDOR
          WHERE LAC_R.LCAADC >= ${MIN_YEAR}
            AND LAC_R.TPDC = 'LAC'
            AND CLI_R.CODIGORUTA IS NOT NULL
          GROUP BY CLI_R.CODIGORUTA, LAC_R.R1_T8CDVD, VDD_R.NOMBREVENDEDOR
        ) WHERE RN = 1
      ) RV ON C.CODIGORUTA = RV.CODIGORUTA AND S.LAST_VENDOR IS NULL
      LEFT JOIN (
        SELECT LCCDCL,
          MAX(R1_T8DIVL) as VIS_L, MAX(R1_T8DIVM) as VIS_M, MAX(R1_T8DIVX) as VIS_X,
          MAX(R1_T8DIVJ) as VIS_J, MAX(R1_T8DIVV) as VIS_V, MAX(R1_T8DIVS) as VIS_S,
          MAX(R1_T8DIRL) as DEL_L, MAX(R1_T8DIRM) as DEL_M, MAX(R1_T8DIRX) as DEL_X,
          MAX(R1_T8DIRJ) as DEL_J, MAX(R1_T8DIRV) as DEL_V, MAX(R1_T8DIRS) as DEL_S
        FROM DSED.LACLAE
        WHERE LCAADC >= ${MIN_YEAR} AND R1_T8CDVD IS NOT NULL
        GROUP BY LCCDCL
      ) D ON C.CODIGOCLIENTE = D.LCCDCL
      WHERE C.ANOBAJA = 0
        AND (S.LAST_VENDOR IS NOT NULL ${routeFilter})
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
      clients: clients.map(c => {
        const phones = [];
        if (c.PHONE?.trim()) phones.push({ type: 'Teléfono 1', number: c.PHONE.trim() });
        if (c.PHONE2?.trim()) phones.push({ type: 'Teléfono 2', number: c.PHONE2.trim() });

        // Build visit days from query results
        const visitDays = [];
        const visitDaysShort = [];
        if (c.VISL === 'S') { visitDays.push('lunes'); visitDaysShort.push('L'); }
        if (c.VISM === 'S') { visitDays.push('martes'); visitDaysShort.push('M'); }
        if (c.VISX === 'S') { visitDays.push('miercoles'); visitDaysShort.push('X'); }
        if (c.VISJ === 'S') { visitDays.push('jueves'); visitDaysShort.push('J'); }
        if (c.VISV === 'S') { visitDays.push('viernes'); visitDaysShort.push('V'); }
        if (c.VISS === 'S') { visitDays.push('sabado'); visitDaysShort.push('S'); }

        // Build delivery days from query results
        const deliveryDays = [];
        const deliveryDaysShort = [];
        if (c.DELL === 'S') { deliveryDays.push('lunes'); deliveryDaysShort.push('L'); }
        if (c.DELM === 'S') { deliveryDays.push('martes'); deliveryDaysShort.push('M'); }
        if (c.DELX === 'S') { deliveryDays.push('miercoles'); deliveryDaysShort.push('X'); }
        if (c.DELJ === 'S') { deliveryDays.push('jueves'); deliveryDaysShort.push('J'); }
        if (c.DELV === 'S') { deliveryDays.push('viernes'); deliveryDaysShort.push('V'); }
        if (c.DELS === 'S') { deliveryDays.push('sabado'); deliveryDaysShort.push('S'); }

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
          vendorName: c.VENDORNAME?.trim(),
          vendorCode: c.VENDORCODE?.trim(),

          // Visit & Delivery Days (from DB query)
          visitDays: visitDays,
          visitDaysShort: visitDaysShort.join(''),
          deliveryDays: deliveryDays,
          deliveryDaysShort: deliveryDaysShort.join('')
        };
      }),
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
// CLIENT NOTES
// =============================================================================
router.put('/notes', async (req, res) => {
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

    const safeNotes = notes ? notes.replace(/'/g, "''") : '';
    const existing = await query(`SELECT CLIENT_CODE FROM JAVIER.CLIENT_NOTES WHERE CLIENT_CODE = '${clientCode}'`, false);

    if (existing.length > 0) {
      await query(`
                UPDATE JAVIER.CLIENT_NOTES 
                SET OBSERVACIONES = '${safeNotes}', 
                    MODIFIED_BY = 'JAVIER', 
                    MODIFIED_AT = CURRENT_TIMESTAMP 
                WHERE CLIENT_CODE = '${clientCode}'
            `, false);
    } else {
      await query(`
                INSERT INTO JAVIER.CLIENT_NOTES (CLIENT_CODE, OBSERVACIONES, MODIFIED_BY, MODIFIED_AT)
                VALUES ('${clientCode}', '${safeNotes}', 'JAVIER', CURRENT_TIMESTAMP)
            `, false);
    }

    res.json({ success: true });
  } catch (error) {
    logger.error(`Error saving notes: ${error.message}`);
    res.status(500).json({ error: 'Error guardando notas', details: error.message });
  }
});

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
    // Include all phone fields for WhatsApp feature
    const clientInfo = await queryWithParams(`
      SELECT C.CODIGOCLIENTE as code, C.NOMBRECLIENTE as name, C.NIF as nif,
  C.DIRECCION as address, C.POBLACION as city, C.PROVINCIA as province,
  C.CODIGOPOSTAL as postalCode, C.TELEFONO1 as phone, C.TELEFONO2 as phone2,
  C.EMAIL as email,
  C.CODIGORUTA as route, C.PERSONACONTACTO as contactPerson,
  C.OBSERVACIONES1 as notes, C.ANOALTA as yearCreated
      FROM DSEDAC.CLI C
      WHERE C.CODIGOCLIENTE = ?
      FETCH FIRST 1 ROWS ONLY
  `, [clientCode]);

    if (clientInfo.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }

    // Get editable observations from our custom table
    let editableNotes = null;
    try {
      const notesResult = await query(`
        SELECT OBSERVACIONES, MODIFIED_BY, MODIFIED_AT
        FROM JAVIER.CLIENT_NOTES
        WHERE CLIENT_CODE = '${clientCode}'
        FETCH FIRST 1 ROWS ONLY
      `, false);
      if (notesResult[0]) {
        editableNotes = {
          text: notesResult[0].OBSERVACIONES,
          modifiedBy: notesResult[0].MODIFIED_BY,
          modifiedAt: notesResult[0].MODIFIED_AT
        };
      }
    } catch (e) {
      // Table may not exist yet, ignore
      logger.debug(`CLIENT_NOTES table not found: ${e.message}`);
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
    logger.error(`Client detail error: ${error.message}`);
    res.status(500).json({ error: 'Error obteniendo detalle de cliente', details: error.message });
  }
});

// =============================================================================
// CLIENT EDITABLE NOTES (GET/PUT)
// =============================================================================
router.get('/:code/notes', async (req, res) => {
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

    const result = await query(`
      SELECT OBSERVACIONES, MODIFIED_BY, MODIFIED_AT
      FROM JAVIER.CLIENT_NOTES
      WHERE CLIENT_CODE = '${clientCode}'
    `, false);

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

router.put('/:code/notes', async (req, res) => {
  try {
    const clientCode = req.params.code.trim();
    const { notes, vendorCode, vendorName } = req.body;

    if (notes === undefined) {
      return res.status(400).json({ error: 'Campo notes requerido' });
    }

    const safeNotes = notes.substring(0, 500).replace(/'/g, "''");
    const safeVendor = (vendorName || vendorCode || 'UNKNOWN').substring(0, 50).replace(/'/g, "''");

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
    await query(`
      MERGE INTO JAVIER.CLIENT_NOTES AS target
      USING (VALUES ('${clientCode}')) AS source(CLIENT_CODE)
      ON target.CLIENT_CODE = source.CLIENT_CODE
      WHEN MATCHED THEN
        UPDATE SET OBSERVACIONES = '${safeNotes}', MODIFIED_BY = '${safeVendor}', MODIFIED_AT = CURRENT_TIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (CLIENT_CODE, OBSERVACIONES, MODIFIED_BY, MODIFIED_AT)
        VALUES ('${clientCode}', '${safeNotes}', '${safeVendor}', CURRENT_TIMESTAMP)
    `, false);

    logger.info(`[NOTES] Client ${clientCode} notes updated by ${safeVendor}`);
    res.json({ success: true, message: 'Notas guardadas correctamente' });
  } catch (error) {
    logger.error(`Save notes error: ${error.message}`);
    res.status(500).json({ error: 'Error guardando notas', details: error.message });
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
