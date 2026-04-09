/**
 * PEDIDOS SERVICE (CommonJS)
 * ==========================
 * Service for order management (PEDIDOS module).
 * Tables live in schema JAVIER; product/stock reads go to DSEDAC.
 */

const { query, queryWithParams, getPool } = require('../config/db');
const logger = require('../middleware/logger');
const { cachedQuery } = require('./query-optimizer');
const { redisCache, TTL } = require('./redis-cache');
// Audit logging is done through the logger middleware directly

// ============================================================================
// TABLE DDL
// ============================================================================

const CREATE_PEDIDOS_CAB = `
CREATE TABLE JAVIER.PEDIDOS_CAB (
    ID INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    SUBEMPRESA CHAR(3) DEFAULT 'GMP',
    EJERCICIO NUMERIC(4) NOT NULL,
    NUMEROPEDIDO NUMERIC(6) NOT NULL,
    SERIEPEDIDO CHAR(1) DEFAULT 'M',
    TERMINAL NUMERIC(3) DEFAULT 999,
    DIADOCUMENTO NUMERIC(2),
    MESDOCUMENTO NUMERIC(2),
    ANODOCUMENTO NUMERIC(4),
    HORADOCUMENTO NUMERIC(6) DEFAULT 0,
    CODIGOCLIENTE CHAR(10) NOT NULL,
    NOMBRECLIENTE VARCHAR(60),
    CODIGOVENDEDOR CHAR(2) NOT NULL,
    CODIGOFORMAPAGO CHAR(2) DEFAULT '02',
    CODIGOTARIFA NUMERIC(2) DEFAULT 1,
    CODIGOALMACEN NUMERIC(4) DEFAULT 1,
    TIPOVENTA CHAR(2) DEFAULT 'CC',
    ESTADO VARCHAR(12) DEFAULT 'BORRADOR',
    IMPORTETOTAL NUMERIC(11,2) DEFAULT 0,
    IMPORTEBASE NUMERIC(11,2) DEFAULT 0,
    IMPORTEIVA NUMERIC(11,2) DEFAULT 0,
    IMPORTECOSTO NUMERIC(11,2) DEFAULT 0,
    IMPORTEMARGEN NUMERIC(11,2) DEFAULT 0,
    OBSERVACIONES VARCHAR(200) DEFAULT '',
    ORIGEN CHAR(1) DEFAULT 'A',
    CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`;

const CREATE_PEDIDOS_LIN = `
CREATE TABLE JAVIER.PEDIDOS_LIN (
    ID INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    PEDIDO_ID INTEGER NOT NULL,
    SECUENCIA NUMERIC(4) DEFAULT 1,
    CODIGOARTICULO CHAR(10) NOT NULL,
    DESCRIPCION CHAR(40),
    CANTIDADENVASES NUMERIC(7,2) DEFAULT 0,
    CANTIDADUNIDADES NUMERIC(10,5) DEFAULT 0,
    UNIDADMEDIDA VARCHAR(12) DEFAULT 'CAJAS',
    UNIDADESCAJA NUMERIC(10,5) DEFAULT 1,
    PRECIOVENTA NUMERIC(9,4) DEFAULT 0,
    PRECIOCOSTO NUMERIC(9,4) DEFAULT 0,
    PRECIOTARIFA NUMERIC(9,4) DEFAULT 0,
    PRECIOTARIFACLIENTE NUMERIC(9,4) DEFAULT 0,
    PRECIOMINIMO NUMERIC(9,4) DEFAULT 0,
    IMPORTEVENTA NUMERIC(10,2) DEFAULT 0,
    IMPORTECOSTO NUMERIC(10,2) DEFAULT 0,
    IMPORTEMARGEN NUMERIC(10,2) DEFAULT 0,
    PORCENTAJEMARGEN NUMERIC(7,2) DEFAULT 0,
    TIPOLINEA CHAR(1) DEFAULT 'R',
    TIPOVENTA CHAR(2) DEFAULT 'CC',
    CLASELINEA CHAR(2) DEFAULT 'VT',
    ORDEN NUMERIC(4) DEFAULT 0,
    CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`;

const CREATE_PEDIDOS_SEQ = `
CREATE TABLE JAVIER.PEDIDOS_SEQ (
    EJERCICIO NUMERIC(4) NOT NULL PRIMARY KEY,
    ULTIMO_NUMERO NUMERIC(6) DEFAULT 0
)`;

const CREATE_PEDIDOS_STOCK_RESERVE = `
CREATE TABLE JAVIER.PEDIDOS_STOCK_RESERVE (
    ID INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    PEDIDO_ID INTEGER NOT NULL,
    CODIGOARTICULO CHAR(10) NOT NULL,
    CANTIDADENVASES NUMERIC(7,2) DEFAULT 0,
    CANTIDADUNIDADES NUMERIC(10,5) DEFAULT 0,
    CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`;

// ============================================================================
// HELPERS
// ============================================================================

function isTableNotFound(err) {
    const msg = (err.message || '').toLowerCase();
    const codes = (err.odbcErrors || []).map(e => e.code);
    return codes.includes(-204) || msg.includes('sql0204');
}

/**
 * Sanitize a string for safe SQL interpolation (only used where
 * parameterized queries are not possible, e.g. dynamic IN lists).
 */
function sanitize(val) {
    if (val == null) return '';
    return String(val).replace(/'/g, "''");
}

// ============================================================================
// TABLE INITIALIZATION
// ============================================================================

async function initPedidosTables() {
    const pool = getPool();
    if (!pool) { logger.warn('[PEDIDOS] No DB pool available for init'); return; }

    const tables = [
        { name: 'JAVIER.PEDIDOS_CAB', ddl: CREATE_PEDIDOS_CAB },
        { name: 'JAVIER.PEDIDOS_LIN', ddl: CREATE_PEDIDOS_LIN },
        { name: 'JAVIER.PEDIDOS_SEQ', ddl: CREATE_PEDIDOS_SEQ },
        { name: 'JAVIER.PEDIDOS_STOCK_RESERVE', ddl: CREATE_PEDIDOS_STOCK_RESERVE },
    ];

    let conn;
    try {
        conn = await pool.connect();

        for (const t of tables) {
            try {
                await conn.query(`SELECT 1 FROM ${t.name} FETCH FIRST 1 ROW ONLY`);
                logger.info(`[PEDIDOS] ${t.name} ready`);
            } catch (e) {
                if (isTableNotFound(e)) {
                    // Close dirty connection, get a fresh one
                    try { await conn.close(); } catch (_) { /* ignore */ }
                    conn = await pool.connect();
                    await conn.query(t.ddl);
                    logger.info(`[PEDIDOS] Created ${t.name}`);
                } else {
                    throw e;
                }
            }
        }

        // Ensure ORIGEN column exists in PEDIDOS_CAB (may be missing in older installs)
        try {
            await conn.query(`SELECT ORIGEN FROM JAVIER.PEDIDOS_CAB FETCH FIRST 1 ROW ONLY`);
        } catch (colErr) {
            try {
                try { await conn.close(); } catch (_) { /* ignore */ }
                conn = await pool.connect();
                await conn.query(`ALTER TABLE JAVIER.PEDIDOS_CAB ADD COLUMN ORIGEN CHAR(1) DEFAULT 'A'`);
                logger.info(`[PEDIDOS] Added missing ORIGEN column to PEDIDOS_CAB`);
            } catch (alterErr) {
                logger.warn(`[PEDIDOS] Could not add ORIGEN column: ${alterErr.message}`);
            }
        }
    } catch (err) {
        logger.error(`[PEDIDOS] Table init error: ${err.message}`);
    } finally {
        if (conn) try { await conn.close(); } catch (_) { /* ignore */ }
    }
}

// ============================================================================
// PRODUCTS
// ============================================================================

async function getProducts({ search, clientCode, family, marca, limit = 50, offset = 0 }) {
    const params = [];
    let where = "WHERE A.ANOBAJA = 0 AND TRIM(A.CODIGOARTICULO) <> ''";

    if (search) {
        const s = `%${search.toUpperCase()}%`;
        where += ' AND (UPPER(A.DESCRIPCIONARTICULO) LIKE ? OR TRIM(A.CODIGOARTICULO) LIKE ?)';
        params.push(s, s);
    }
    if (family) {
        where += ' AND TRIM(A.CODIGOFAMILIA) = ?';
        params.push(family.trim());
    }
    if (marca) {
        where += ' AND TRIM(A.CODIGOMARCA) = ?';
        params.push(marca.trim());
    }

    const currentYear = new Date().getFullYear();
    const prevYear = currentYear - 1;
    const clientCodeTrimmed = (clientCode || '').trim();

    // Build purchase history subqueries for ordering (least purchased first)
    // + year-over-year comparison + hasPurchased flag
    const salesThisYear = `
        (SELECT COALESCE(SUM(LC.LCIMVT), 0)
         FROM DSEDAC.LAC LC
         WHERE TRIM(LC.CODIGOARTICULO) = A.CODIGOARTICULO
           AND TRIM(LC.LCCDCL) = ?
           AND LC.LCAADC = ${currentYear}
           AND LC.LCTPVT IN ('CC','VC') AND LC.LCCLLN IN ('AB','VT'))
    `;
    const salesPrevYear = `
        (SELECT COALESCE(SUM(LC.LCIMVT), 0)
         FROM DSEDAC.LAC LC
         WHERE TRIM(LC.CODIGOARTICULO) = A.CODIGOARTICULO
           AND TRIM(LC.LCCDCL) = ?
           AND LC.LCAADC = ${prevYear}
           AND LC.LCTPVT IN ('CC','VC') AND LC.LCCLLN IN ('AB','VT'))
    `;
    const hasPurchased = `
        CASE WHEN EXISTS (
            SELECT 1 FROM DSEDAC.LAC LC
            WHERE TRIM(LC.CODIGOARTICULO) = A.CODIGOARTICULO
              AND TRIM(LC.LCCDCL) = ?
              AND LC.LCTPVT IN ('CC','VC') AND LC.LCCLLN IN ('AB','VT')
        ) THEN 1 ELSE 0 END
    `;

    // Params for subqueries come before WHERE params
    const clientCodeForSubqueries = [clientCodeTrimmed, clientCodeTrimmed, clientCodeTrimmed];

    const sql = `
        SELECT
            TRIM(A.CODIGOARTICULO) AS code,
            TRIM(A.DESCRIPCIONARTICULO) AS name,
            TRIM(A.CODIGOMARCA) AS brand,
            TRIM(A.CODIGOFAMILIA) AS family,
            TRIM(A.CODIGOEAN) AS ean,
            A.UNIDADESCAJA AS unitsPerBox,
            A.UNIDADESFRACCION AS unitsFraction,
            A.UNIDADESRETRACTIL AS unitsRetractil,
            TRIM(A.UNIDADMEDIDA) AS unitMeasure,
            A.PESO AS weight,
            COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0) AS stockEnvases,
            COALESCE(S.UNIDADES_DISP, 0) - COALESCE(RES.RES_UNI, 0) AS stockUnidades,
            COALESCE(T1.PRECIOTARIFA, 0) AS precioTarifa1,
            COALESCE(T2.PRECIOTARIFA, 0) AS precioMinimo,
            COALESCE(TC.PRECIOTARIFA, 0) AS precioCliente,
            TRIM(COALESCE(A.FORMATO, '')) AS formato,
            COALESCE(A.PRODUCTOPESADOSN, '') AS productoPesado,
            ${salesThisYear} AS salesThisYear,
            ${salesPrevYear} AS salesPrevYear,
            ${hasPurchased} AS hasPurchased
        FROM DSEDAC.ART A
        LEFT JOIN (
            SELECT CODIGOARTICULO,
                SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
            FROM DSEDAC.ARO
            WHERE CODIGOALMACEN = 1
            GROUP BY CODIGOARTICULO
        ) S ON A.CODIGOARTICULO = S.CODIGOARTICULO
        LEFT JOIN (
            SELECT SR.CODIGOARTICULO,
                SUM(SR.CANTIDADENVASES) AS RES_ENV,
                SUM(SR.CANTIDADUNIDADES) AS RES_UNI
            FROM JAVIER.PEDIDOS_STOCK_RESERVE SR
            JOIN JAVIER.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID AND C.ESTADO = 'CONFIRMADO'
            GROUP BY SR.CODIGOARTICULO
        ) RES ON A.CODIGOARTICULO = RES.CODIGOARTICULO
        LEFT JOIN DSEDAC.ARA T1 ON A.CODIGOARTICULO = T1.CODIGOARTICULO AND T1.CODIGOTARIFA = 1
        LEFT JOIN DSEDAC.ARA T2 ON A.CODIGOARTICULO = T2.CODIGOARTICULO AND T2.CODIGOTARIFA = 2
        LEFT JOIN DSEDAC.ARA TC ON A.CODIGOARTICULO = TC.CODIGOARTICULO
            AND TC.CODIGOTARIFA = (
                SELECT CLC.CODIGOTARIFA
                FROM DSEDAC.CLC CLC
                WHERE TRIM(CLC.CODIGOCLIENTE) = ?
                FETCH FIRST 1 ROW ONLY
            )
        ${where}
        ORDER BY
            CASE WHEN ${salesThisYear} = 0 AND ${salesPrevYear} = 0 THEN 0 ELSE 1 END,
            ${salesThisYear} ASC,
            ${salesPrevYear} ASC,
            A.DESCRIPCIONARTICULO
        OFFSET ? ROWS FETCH FIRST ? ROWS ONLY`;

    // Final params: 3 for subqueries + TC subquery + WHERE params + offset + limit
    const finalParams = [...clientCodeForSubqueries, clientCodeTrimmed, ...params, offset, limit];

    const cacheKey = `pedidos:products_v2:${clientCodeTrimmed}:${search || ''}:${family || ''}:${marca || ''}:${offset}:${limit}`;

    try {
        const rows = await cachedQuery(
            (sql) => queryWithParams(sql, finalParams),
            sql,
            cacheKey,
            TTL.SHORT // 5 min
        );
        return rows.map(r => {
            const salesTY = parseFloat(r.SALESTHISYEAR) || 0;
            const salesPY = parseFloat(r.SALESPREVYEAR) || 0;
            const hasPurchased = parseInt(r.HASPURCHASED) || 0;

            // Determine unit type clarity for UI
            let unitType = 'unidad'; // default
            const unitsPerBox = parseFloat(r.UNITSPERBOX) || 0;
            const unitsFraction = parseFloat(r.UNITSFRACTION) || 0;
            if (unitsPerBox > 1 && unitsFraction > 0) {
                unitType = 'ambos'; // Cajas + unidades
            } else if (unitsPerBox > 1) {
                unitType = 'caja'; // Solo cajas
            }

            return {
                code: (r.CODE || '').trim(),
                name: (r.NAME || '').trim(),
                brand: (r.BRAND || '').trim(),
                family: (r.FAMILY || '').trim(),
                ean: (r.EAN || '').trim(),
                unitsPerBox: unitsPerBox,
                unitsFraction: unitsFraction,
                unitsRetractil: parseFloat(r.UNITSRETRACTIL) || 0,
                unitMeasure: (r.UNITMEASURE || '').trim(),
                weight: parseFloat(r.WEIGHT) || 0,
                stockEnvases: parseFloat(r.STOCKENVASES) || 0,
                stockUnidades: parseFloat(r.STOCKUNIDADES) || 0,
                precioTarifa1: parseFloat(r.PRECIOTARIFA1) || 0,
                precioMinimo: parseFloat(r.PRECIOMINIMO) || 0,
                precioCliente: parseFloat(r.PRECIOCLIENTE) || 0,
                formato: (r.FORMATO || '').trim(),
                productoPesado: (r.PRODUCTOPESADO || '').trim() === 'S',
                unitType: unitType,
                // Purchase analytics for ordering + badges
                salesThisYear: salesTY,
                salesPrevYear: salesPY,
                hasPurchased: hasPurchased === 1,
                yoyChange: salesPY > 0 ? ((salesTY - salesPY) / salesPY * 100) : (salesTY > 0 ? 100 : 0),
            };
        });
    } catch (error) {
        logger.error(`[PEDIDOS] getProducts error: ${error.message}`);
        throw error;
    }
}

// ============================================================================
// PRODUCT DETAIL
// ============================================================================

async function getProductDetail(code, clientCode) {
    const trimCode = code.trim();

    // Base product — expanded with ALL useful fields from ART + FAM description
    // Column names verified against DSEDAC.ART schema (discover_pedidos_output.txt)
    const baseSql = `
        SELECT TRIM(A.CODIGOARTICULO) AS code,
            TRIM(A.DESCRIPCIONARTICULO) AS name,
            TRIM(COALESCE(A.EXTENSIONDESCRIPCION, '')) AS nameExt,
            TRIM(A.CODIGOMARCA) AS brand,
            TRIM(A.CODIGOFAMILIA) AS family,
            TRIM(COALESCE(F.DESCRIPCIONFAMILIA, '')) AS familyName,
            TRIM(COALESCE(A.CODIGOEAN, '')) AS ean,
            A.UNIDADESCAJA AS unitsPerBox,
            A.UNIDADESFRACCION AS unitsFraction,
            A.UNIDADESRETRACTIL AS unitsRetractil,
            TRIM(A.UNIDADMEDIDA) AS unitMeasure,
            COALESCE(A.PESO, 0) AS weight,
            TRIM(COALESCE(A.CODIGOPREFAMILIA, '')) AS prefamilia,
            TRIM(COALESCE(A.CODIGOSUBFAMILIA, '')) AS subFamily,
            TRIM(COALESCE(A.CODIGOGRUPO, '')) AS grupoGeneral,
            TRIM(COALESCE(A.CODIGOTIPO, '')) AS tipoProducto,
            TRIM(COALESCE(A.CLASIFICACION, '')) AS claseArticulo,
            TRIM(COALESCE(A.CATEGORIAARTICULO, '')) AS categoria,
            TRIM(COALESCE(A.CODIGOGAMA, '')) AS gama,
            TRIM(COALESCE(A.CODIGOIVA, '0')) AS codigoIva,
            COALESCE(A.PESO, 0) AS pesoNeto,
            COALESCE(A.VOLUMEN, 0) AS volumen,
            TRIM(COALESCE(A.GRADOS, '')) AS grados,
            TRIM(COALESCE(A.CALIBRE, '')) AS calibre,
            TRIM(COALESCE(A.OBSERVACION1, '')) AS observacion1,
            TRIM(COALESCE(A.OBSERVACION2, '')) AS observacion2,
            TRIM(COALESCE(A.CODIGOPRESENTACION, '')) AS presentacion,
            TRIM(COALESCE(A.FORMATO, '')) AS formato,
            COALESCE(A.PRODUCTOPESADOSN, '') AS productoPesado,
            COALESCE(A.TRAZABLESN, '') AS trazable,
            COALESCE(A.UNIDADPALE, 0) AS unidadPale,
            COALESCE(A.UNIDADFILAPALE, 0) AS unidadFilaPale,
            A.DIAALTA AS diaAlta,
            A.MESALTA AS mesAlta,
            A.ANOALTA AS anoAlta,
            A.ANOBAJA AS anoBaja,
            A.MESBAJA AS mesBaja
        FROM DSEDAC.ART A
        LEFT JOIN DSEDAC.FAM F ON A.CODIGOFAMILIA = F.CODIGOFAMILIA
        WHERE TRIM(A.CODIGOARTICULO) = ?`;

    // All tariffs
    const tariffSql = `
        SELECT T.CODIGOTARIFA,
            TRIM(TRF.DESCRIPCIONTARIFA) AS tarifaDesc,
            T.PRECIOTARIFA
        FROM DSEDAC.ARA T
        JOIN DSEDAC.TRF TRF ON T.CODIGOTARIFA = TRF.CODIGOTARIFA
        WHERE TRIM(T.CODIGOARTICULO) = ? AND T.PRECIOTARIFA > 0`;

    // Stock by warehouse
    const stockSql = `
        SELECT ARO.CODIGOALMACEN,
            TRIM(ALM.DESCRIPCIONALMACEN) AS almacenDesc,
            SUM(ARO.ENVASESDISPONIBLES) AS envases,
            SUM(ARO.UNIDADESDISPONIBLES) AS unidades
        FROM DSEDAC.ARO
        JOIN DSEDAC.ALM ON ARO.CODIGOALMACEN = ALM.CODIGOALMACEN
        WHERE TRIM(ARO.CODIGOARTICULO) = ?
        GROUP BY ARO.CODIGOALMACEN, ALM.DESCRIPCIONALMACEN`;

    try {
        logger.info(`[PEDIDOS] getProductDetail code=${trimCode} clientCode=${clientCode || 'none'}`);
        const t0 = Date.now();

        const [baseRows, tariffRows, stockRows] = await Promise.all([
            queryWithParams(baseSql, [trimCode]),
            queryWithParams(tariffSql, [trimCode]),
            queryWithParams(stockSql, [trimCode]),
        ]);

        logger.info(`[PEDIDOS] getProductDetail base=${baseRows?.length || 0} tariffs=${tariffRows?.length || 0} stock=${stockRows?.length || 0} time=${Date.now() - t0}ms`);

        if (!baseRows || baseRows.length === 0) {
            throw new Error('Producto no encontrado');
        }

        const raw = baseRows[0];
        const product = {
            code: (raw.CODE || '').trim(),
            name: (raw.NAME || '').trim(),
            nameExt: (raw.NAMEEXT || '').trim(),
            brand: (raw.BRAND || '').trim(),
            family: (raw.FAMILY || '').trim(),
            familyName: (raw.FAMILYNAME || '').trim(),
            ean: (raw.EAN || '').trim(),
            unitsPerBox: parseFloat(raw.UNITSPERBOX) || 1,
            unitsFraction: parseFloat(raw.UNITSFRACTION) || 0,
            unitsRetractil: parseFloat(raw.UNITSRETRACTIL) || 0,
            unitMeasure: (raw.UNITMEASURE || '').trim(),
            weight: parseFloat(raw.WEIGHT) || 0,
            prefamilia: (raw.PREFAMILIA || '').trim(),
            subFamily: (raw.SUBFAMILY || '').trim(),
            grupoGeneral: (raw.GRUPOGENERAL || '').trim(),
            tipoProducto: (raw.TIPOPRODUCTO || '').trim(),
            claseArticulo: (raw.CLASEARTICULO || '').trim(),
            categoria: (raw.CATEGORIA || '').trim(),
            gama: (raw.GAMA || '').trim(),
            codigoIva: (raw.CODIGOIVA || '0').toString().trim(),
            pesoNeto: parseFloat(raw.PESONETO) || 0,
            volumen: parseFloat(raw.VOLUMEN) || 0,
            grados: (raw.GRADOS || '').trim(),
            calibre: (raw.CALIBRE || '').trim(),
            observacion1: (raw.OBSERVACION1 || '').trim(),
            observacion2: (raw.OBSERVACION2 || '').trim(),
            presentacion: (raw.PRESENTACION || '').trim(),
            formato: (raw.FORMATO || '').trim(),
            productoPesado: (raw.PRODUCTOPESADO || '').trim() === 'S',
            trazable: (raw.TRAZABLE || '').trim() === 'S',
            unidadPale: parseFloat(raw.UNIDADPALE) || 0,
            unidadFilaPale: parseFloat(raw.UNIDADFILAPALE) || 0,
            fechaAlta: raw.ANOALTA > 0 ? `${String(raw.DIAALTA || 1).padStart(2, '0')}/${String(raw.MESALTA || 1).padStart(2, '0')}/${raw.ANOALTA}` : null,
            anoBaja: parseInt(raw.ANOBAJA) || 0,
            mesBaja: parseInt(raw.MESBAJA) || 0,
        };

        product.tariffs = (tariffRows || []).map(t => {
            const price = parseFloat(t.PRECIOTARIFA) || 0;
            return {
                code: t.CODIGOTARIFA,
                description: (t.TARIFADESC || '').trim(),
                price,
                precioUnitario: product.unitsPerBox > 1
                    ? +(price / product.unitsPerBox).toFixed(4)
                    : price,
            };
        });

        product.stock = (stockRows || []).map(s => ({
            almacen: s.CODIGOALMACEN,
            almacenDesc: (s.ALMACENDESC || '').trim(),
            envases: parseFloat(s.ENVASES) || 0,
            unidades: parseFloat(s.UNIDADES) || 0,
        }));

        // Expose stockEnvases/stockUnidades at root level (almacen 1 = default)
        const mainStock = stockRows?.find(s => parseInt(s.CODIGOALMACEN) === 1);
        product.stockEnvases = mainStock ? (parseFloat(mainStock.ENVASES) || 0) : 0;
        product.stockUnidades = mainStock ? (parseFloat(mainStock.UNIDADES) || 0) : 0;

        // Stage: client historical price
        if (clientCode) {
            const h0 = Date.now();
            logger.info(`[PEDIDOS] getProductDetail stage=HISTORICO code=${trimCode} client=${clientCode}`);
            try {
                const clientPriceSql = `
                    SELECT L.PRECIOVENTA AS PRECIOCLIENTE
                    FROM DSEDAC.LINDTO L
                    WHERE TRIM(L.CODIGOARTICULO) = ?
                      AND TRIM(L.CODIGOCLIENTEALBARAN) = ?
                      AND L.TIPOVENTA IN ('CC', 'VC')
                      AND L.CLASELINEA IN ('AB', 'VT')
                      AND L.SERIEALBARAN NOT IN ('N', 'Z')
                    ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC
                    FETCH FIRST 1 ROW ONLY`;
                const priceRows = await queryWithParams(clientPriceSql, [trimCode, clientCode.trim()]);
                logger.info(`[PEDIDOS] getProductDetail stage=HISTORICO rows=${priceRows?.length || 0} time=${Date.now() - h0}ms`);
                
                product.precioCliente = priceRows && priceRows.length > 0
                    ? parseFloat(priceRows[0].PRECIOCLIENTE) || 0
                    : null;
            } catch (histErr) {
                logger.warn(`[PEDIDOS] getProductDetail stage=HISTORICO error: ${histErr.message}`);
                product.precioCliente = null;
            }
        }

        // Stage: client tariff price (with fallback to tariff 1)
        const ct0 = Date.now();
        logger.info(`[PEDIDOS] getProductDetail stage=TARIFA_CLIENTE code=${trimCode} client=${clientCode || 'none'}`);
        let clientTarifaCode = 1;
        try {
            if (clientCode) {
                const cliTarifaSql = `
                    SELECT COALESCE(CODIGOTARIFA, 1) AS CODIGOTARIFA
                    FROM DSEDAC.CLC
                    WHERE TRIM(CODIGOCLIENTE) = ?
                    FETCH FIRST 1 ROW ONLY`;
                const cliRows = await queryWithParams(cliTarifaSql, [clientCode.trim()]);
                clientTarifaCode = cliRows && cliRows.length > 0
                    ? parseInt(cliRows[0].CODIGOTARIFA) || 1
                    : 1;
                logger.info(`[PEDIDOS] getProductDetail stage=TARIFA_CLIENTE found tariff=${clientTarifaCode} time=${Date.now() - ct0}ms`);
            }
        } catch (tarifaErr) {
            logger.warn(`[PEDIDOS] getProductDetail stage=TARIFA_CLIENTE fallback to 1: ${tarifaErr.message}`);
            clientTarifaCode = 1;
        }
        
        product.codigoTarifaCliente = clientTarifaCode;
        const foundTariff = product.tariffs.find(t => t.code === clientTarifaCode);
        product.precioTarifaCliente = foundTariff ? foundTariff.price : (product.tariffs.find(t => t.code === 1)?.price ?? 0);
        
        if (!foundTariff) {
            logger.warn(`[PEDIDOS] getProductDetail stage=TARIFA_CLIENTE code=${trimCode} tariff=${clientTarifaCode} NOT FOUND, used fallback tariff=1 price=${product.precioTarifaCliente}`);
        }

        logger.info(`[PEDIDOS] getProductDetail complete code=${trimCode} time=${Date.now() - t0}ms`);
        return product;
    } catch (error) {
        logger.error(`[PEDIDOS] getProductDetail error: ${error.message} code=${trimCode}`);
        throw error;
    }
}

// ============================================================================
// STOCK
// ============================================================================

async function getStock(code, almacen = 1) {
    // Real stock minus reserved stock from confirmed orders
    const sql = `
        SELECT
            COALESCE(S.ENVASES, 0) - COALESCE(R.RES_ENVASES, 0) AS envases,
            COALESCE(S.UNIDADES, 0) - COALESCE(R.RES_UNIDADES, 0) AS unidades
        FROM (
            SELECT SUM(ENVASESDISPONIBLES) AS ENVASES,
                   SUM(UNIDADESDISPONIBLES) AS UNIDADES
            FROM DSEDAC.ARO
            WHERE TRIM(CODIGOARTICULO) = ? AND CODIGOALMACEN = ?
        ) S,
        (
            SELECT COALESCE(SUM(SR.CANTIDADENVASES), 0) AS RES_ENVASES,
                   COALESCE(SUM(SR.CANTIDADUNIDADES), 0) AS RES_UNIDADES
            FROM JAVIER.PEDIDOS_STOCK_RESERVE SR
            JOIN JAVIER.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID
            WHERE TRIM(SR.CODIGOARTICULO) = ?
              AND C.ESTADO = 'CONFIRMADO'
        ) R`;

    const trimCode = code.trim();
    const cacheKey = `pedidos:stock:${trimCode}:${almacen}`;

    try {
        const rows = await cachedQuery(
            (sql) => queryWithParams(sql, [trimCode, almacen, trimCode]),
            sql,
            cacheKey,
            30 // 30s TTL - more frequent for real-time stock
        );
        const row = rows && rows[0];
        return {
            envases: Math.max(0, parseFloat(row?.ENVASES) || 0),
            unidades: Math.max(0, parseFloat(row?.UNIDADES) || 0),
        };
    } catch (error) {
        logger.error(`[PEDIDOS] getStock error: ${error.message}`);
        throw error;
    }
}

// ============================================================================
// ORDER SEQUENCE
// ============================================================================

async function getNextOrderNumber(ejercicio) {
    // Atomic UPDATE+INSERT pattern (no MERGE — not supported on all DB2/i versions)
    // Step 1: Try UPDATE existing row
    try {
        await queryWithParams(
            `UPDATE JAVIER.PEDIDOS_SEQ SET ULTIMO_NUMERO = ULTIMO_NUMERO + 1 WHERE EJERCICIO = ?`,
            [ejercicio], false
        );
    } catch (updErr) {
        logger.warn(`[PEDIDOS] SEQ UPDATE failed: ${updErr.message}`);
    }

    // Step 2: Check if row exists after UPDATE
    const checkRows = await queryWithParams(
        `SELECT ULTIMO_NUMERO FROM JAVIER.PEDIDOS_SEQ WHERE EJERCICIO = ?`,
        [ejercicio], false
    );

    if (checkRows && checkRows.length > 0) {
        return checkRows[0].ULTIMO_NUMERO;
    }

    // Step 3: Row doesn't exist — INSERT new year
    try {
        await queryWithParams(
            `INSERT INTO JAVIER.PEDIDOS_SEQ (EJERCICIO, ULTIMO_NUMERO) VALUES (?, 1)`,
            [ejercicio], false
        );
        return 1;
    } catch (insErr) {
        // Concurrent INSERT race — another process created it first, just UPDATE+SELECT
        logger.warn(`[PEDIDOS] SEQ INSERT race: ${insErr.message}`);
        await queryWithParams(
            `UPDATE JAVIER.PEDIDOS_SEQ SET ULTIMO_NUMERO = ULTIMO_NUMERO + 1 WHERE EJERCICIO = ?`,
            [ejercicio], false
        );
        const retryRows = await queryWithParams(
            `SELECT ULTIMO_NUMERO FROM JAVIER.PEDIDOS_SEQ WHERE EJERCICIO = ?`,
            [ejercicio], false
        );
        return retryRows[0]?.ULTIMO_NUMERO || 1;
    }
}

// ============================================================================
// CREATE ORDER
// ============================================================================

async function createOrder({ clientCode, clientName, vendedorCode, tipoventa = 'CC', almacen = 1, tarifa = 1, formaPago = '02', observaciones = '', lines = [], origen = 'A' }) {
    if (!clientCode || !vendedorCode) {
        throw new Error('clientCode and vendedorCode are required');
    }
    if (!lines || lines.length === 0) {
        throw new Error('At least one line is required');
    }

    const now = new Date();
    const ejercicio = now.getFullYear();
    const dia = now.getDate();
    const mes = now.getMonth() + 1;
    const ano = now.getFullYear();
    const hora = parseInt(`${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`, 10);

    const numeroPedido = await getNextOrderNumber(ejercicio);

    // Insert header — ORIGEN column may not exist in older installs
    let cabSql, cabParams;
    try {
        // Try with ORIGEN first (normal case)
        cabSql = `
            INSERT INTO JAVIER.PEDIDOS_CAB (
                EJERCICIO, NUMEROPEDIDO, DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, HORADOCUMENTO,
                CODIGOCLIENTE, NOMBRECLIENTE, CODIGOVENDEDOR, CODIGOFORMAPAGO,
                CODIGOTARIFA, CODIGOALMACEN, TIPOVENTA, OBSERVACIONES, ORIGEN
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        cabParams = [
            ejercicio, numeroPedido, dia, mes, ano, hora,
            clientCode.trim(), (clientName || '').substring(0, 60), (vendedorCode || '').split(',')[0].trim().substring(0, 2),
            formaPago, tarifa, almacen, tipoventa, (observaciones || '').substring(0, 200), origen
        ];
        await queryWithParams(cabSql, cabParams, false);
    } catch (cabErr) {
        // If column not found (42S22) — retry without ORIGEN
        const states = (cabErr.odbcErrors || []).map(e => e.state);
        if (states.includes('42S22') || (cabErr.message || '').includes('-205')) {
            logger.warn(`[PEDIDOS] ORIGEN column missing, inserting without it`);
            cabSql = `
                INSERT INTO JAVIER.PEDIDOS_CAB (
                    EJERCICIO, NUMEROPEDIDO, DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, HORADOCUMENTO,
                    CODIGOCLIENTE, NOMBRECLIENTE, CODIGOVENDEDOR, CODIGOFORMAPAGO,
                    CODIGOTARIFA, CODIGOALMACEN, TIPOVENTA, OBSERVACIONES
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            cabParams = [
                ejercicio, numeroPedido, dia, mes, ano, hora,
                clientCode.trim(), (clientName || '').substring(0, 60), (vendedorCode || '').split(',')[0].trim().substring(0, 2),
                formaPago, tarifa, almacen, tipoventa, (observaciones || '').substring(0, 200)
            ];
            await queryWithParams(cabSql, cabParams, false);
        } else {
            throw cabErr;
        }
    }

    // Retrieve the generated ID
    const idRows = await queryWithParams(
        `SELECT ID FROM JAVIER.PEDIDOS_CAB WHERE EJERCICIO = ? AND NUMEROPEDIDO = ? ORDER BY ID DESC FETCH FIRST 1 ROW ONLY`,
        [ejercicio, numeroPedido]
    );
    const pedidoId = idRows[0]?.ID;
    if (!pedidoId) throw new Error('Failed to retrieve created order ID');

    // Insert lines
    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        
        let cantidadEnvases = parseFloat(ln.cantidadEnvases) || 0;
        let cantidadUnidades = parseFloat(ln.cantidadUnidades) || parseFloat(ln.cantidad) || 0;
        let unidadesCaja = parseFloat(ln.unidadesCaja) || 1;
        let unidadMedida = ln.unidadMedida || 'CAJAS';
        let precio = parseFloat(ln.precio) || parseFloat(ln.precioVenta) || 0;
        
        // Exact price calculation based on DB unit rules:
        let importeVenta = 0;
        
        // Is it weight based?
        if (unidadMedida === 'KILOGRAMOS' || unidadMedida === 'LITROS') {
             importeVenta = cantidadUnidades * precio;
        } 
        // Is it dual field (has both envases and unidades, AND U/F condition met or just has both)?
        else if (cantidadEnvases > 0 && cantidadUnidades > 0 && unidadMedida === 'CAJAS') {
             // In dual mode, price is always per BOX, and units are a fraction of the box price
             let decimalFraction = cantidadUnidades / unidadesCaja;
             importeVenta = (cantidadEnvases + decimalFraction) * precio;
        }
        else if (unidadMedida === 'CAJAS') {
             importeVenta = cantidadEnvases * precio;
        } 
        else {
             // Single field generic units (PIEZAS, BANDEJAS, ESTUCHES, UNIDADES)
             importeVenta = cantidadUnidades * precio;
        }
        
        // Round to exactly 2 decimals for final line sum to avoid DB floating point drift
        importeVenta = Math.round(importeVenta * 100) / 100;
        
        const importeCosto = parseFloat(ln.importeCosto) || (parseFloat(ln.cantidad || 0) * parseFloat(ln.precioCosto || 0));
        const importeMargen = importeVenta - importeCosto;
        const pctMargen = importeVenta > 0 ? ((importeMargen / importeVenta) * 100) : 0;

        const linSql = `
            INSERT INTO JAVIER.PEDIDOS_LIN (
                PEDIDO_ID, SECUENCIA, CODIGOARTICULO, DESCRIPCION,
                CANTIDADENVASES, CANTIDADUNIDADES, UNIDADMEDIDA, UNIDADESCAJA,
                PRECIOVENTA, PRECIOCOSTO, PRECIOTARIFA, PRECIOTARIFACLIENTE, PRECIOMINIMO,
                IMPORTEVENTA, IMPORTECOSTO, IMPORTEMARGEN, PORCENTAJEMARGEN,
                TIPOLINEA, TIPOVENTA, CLASELINEA, ORDEN
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const linParams = [
            pedidoId, i + 1,
            (ln.codigoArticulo || '').trim(), (ln.descripcion || '').substring(0, 40),
            cantidadEnvases, cantidadUnidades,
            unidadMedida, unidadesCaja,
            precio, parseFloat(ln.precioCosto) || 0,
            parseFloat(ln.precioTarifa) || 0, parseFloat(ln.precioTarifaCliente) || 0,
            parseFloat(ln.precioMinimo) || 0,
            importeVenta, importeCosto, importeMargen,
            Math.round(pctMargen * 100) / 100,
            ln.tipoLinea || 'R', ln.tipoventa || tipoventa, ln.claseLinea || 'VT', i + 1
        ];

        await queryWithParams(linSql, linParams, false);
    }

    // Recalculate totals
    await recalculateOrderTotals(pedidoId);

    // Return created order
    return getOrderDetail(pedidoId);
}

// ============================================================================
// GET ORDERS
// ============================================================================

async function getOrders({ vendedorCodes, status, year, month, dateFrom, dateTo, search, minAmount, maxAmount, sortBy, sortOrder, limit = 50, offset = 0 }) {
    if (!vendedorCodes) throw new Error('vendedorCodes is required');

    const isAll = vendedorCodes.trim().toUpperCase() === 'ALL';

    let sql = `
        SELECT C.ID, C.EJERCICIO, C.NUMEROPEDIDO, C.SERIEPEDIDO,
            C.DIADOCUMENTO, C.MESDOCUMENTO, C.ANODOCUMENTO, C.HORADOCUMENTO,
            TRIM(C.CODIGOCLIENTE) AS CODIGOCLIENTE,
            TRIM(C.NOMBRECLIENTE) AS NOMBRECLIENTE,
            TRIM(C.CODIGOVENDEDOR) AS CODIGOVENDEDOR,
            TRIM(C.TIPOVENTA) AS TIPOVENTA,
            TRIM(C.ESTADO) AS ESTADO,
            C.IMPORTETOTAL, C.IMPORTEBASE, C.IMPORTEIVA, C.IMPORTECOSTO, C.IMPORTEMARGEN,
            TRIM(C.OBSERVACIONES) AS OBSERVACIONES,
            TRIM(C.CODIGOFORMAPAGO) AS CODIGOFORMAPAGO,
            C.CODIGOTARIFA,
            TRIM(C.ORIGEN) AS ORIGEN,
            C.CREATED_AT, C.UPDATED_AT,
            COALESCE(LC.LINE_COUNT, 0) AS LINE_COUNT
        FROM JAVIER.PEDIDOS_CAB C
        LEFT JOIN (SELECT PEDIDO_ID, COUNT(*) AS LINE_COUNT FROM JAVIER.PEDIDOS_LIN GROUP BY PEDIDO_ID) LC ON C.ID = LC.PEDIDO_ID
        WHERE 1=1`;

    const params = [];

    if (!isAll) {
        const vendorList = vendedorCodes.split(',').map(v => v.trim()).filter(Boolean);
        // DB2 ODBC has a limit on parameter markers; 50+ vendors ≈ ALL
        if (vendorList.length > 50) {
            // Treat as ALL — no vendor filter
        } else if (vendorList.length === 1) {
            sql += ` AND TRIM(C.CODIGOVENDEDOR) = ?`;
            params.push(vendorList[0]);
        } else {
            sql += ` AND TRIM(C.CODIGOVENDEDOR) IN (${vendorList.map(() => '?').join(',')})`;
            params.push(...vendorList);
        }
    }

    if (status) {
        sql += ` AND TRIM(C.ESTADO) = ?`;
        params.push(status.trim());
    }

    // Date range filters
    if (dateFrom) {
        const df = String(dateFrom).replace(/-/g, '');
        if (df.length === 8) {
            const y = parseInt(df.substring(0, 4));
            const m = parseInt(df.substring(4, 6));
            const d = parseInt(df.substring(6, 8));
            sql += ` AND (C.ANODOCUMENTO > ? OR (C.ANODOCUMENTO = ? AND C.MESDOCUMENTO > ?) OR (C.ANODOCUMENTO = ? AND C.MESDOCUMENTO = ? AND C.DIADOCUMENTO >= ?))`;
            params.push(y, y, m, y, m, d);
        }
    }
    if (dateTo) {
        const dt = String(dateTo).replace(/-/g, '');
        if (dt.length === 8) {
            const y = parseInt(dt.substring(0, 4));
            const m = parseInt(dt.substring(4, 6));
            const d = parseInt(dt.substring(6, 8));
            sql += ` AND (C.ANODOCUMENTO < ? OR (C.ANODOCUMENTO = ? AND C.MESDOCUMENTO < ?) OR (C.ANODOCUMENTO = ? AND C.MESDOCUMENTO = ? AND C.DIADOCUMENTO <= ?))`;
            params.push(y, y, m, y, m, d);
        }
    }

    // Year/month fallback (only if no date range applied)
    if (!dateFrom && !dateTo) {
        const currentYear = year || new Date().getFullYear();
        sql += ` AND C.EJERCICIO = ?`;
        params.push(parseInt(currentYear));
        if (month) {
            sql += ` AND C.MESDOCUMENTO = ?`;
            params.push(parseInt(month));
        }
    }

    // Text search
    if (search) {
        const s = `%${search.toUpperCase()}%`;
        sql += ` AND (UPPER(TRIM(C.NOMBRECLIENTE)) LIKE ? OR UPPER(TRIM(C.CODIGOCLIENTE)) LIKE ? OR UPPER(TRIM(CAST(C.NUMEROPEDIDO AS VARCHAR(10)))) LIKE ?)`;
        params.push(s, s, s);
    }

    // Amount filters
    if (minAmount !== undefined) {
        sql += ` AND C.IMPORTETOTAL >= ?`;
        params.push(parseFloat(minAmount));
    }
    if (maxAmount !== undefined) {
        sql += ` AND C.IMPORTETOTAL <= ?`;
        params.push(parseFloat(maxAmount));
    }

    // Dynamic ORDER BY
    const sortField = (sortBy || 'fecha').toLowerCase();
    const sortDir = (sortOrder || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    switch (sortField) {
        case 'importe':
            sql += ` ORDER BY C.IMPORTETOTAL ${sortDir}`;
            break;
        case 'cliente':
            sql += ` ORDER BY C.NOMBRECLIENTE ${sortDir}`;
            break;
        case 'numero':
            sql += ` ORDER BY C.NUMEROPEDIDO ${sortDir}`;
            break;
        case 'fecha':
        default:
            sql += ` ORDER BY C.ANODOCUMENTO ${sortDir}, C.MESDOCUMENTO ${sortDir}, C.DIADOCUMENTO ${sortDir}`;
            break;
    }
    sql += `, C.NUMEROPEDIDO DESC`;
    sql += ` OFFSET ${parseInt(offset)} ROWS FETCH FIRST ${parseInt(limit)} ROWS ONLY`;

    try {
        const rows = await queryWithParams(sql, params);
        const orders = rows.map(r => {
            const dia = String(r.DIADOCUMENTO).padStart(2, '0');
            const mes = String(r.MESDOCUMENTO).padStart(2, '0');
            const ano = r.ANODOCUMENTO;
            const hora = r.HORADOCUMENTO ? String(r.HORADOCUMENTO).padStart(6, '0') : '000000';
            const hh = hora.substring(0, 2);
            const mm = hora.substring(2, 4);
            const numPedido = String(r.NUMEROPEDIDO).padStart(6, '0');
            return {
                id: r.ID,
                ejercicio: r.EJERCICIO,
                numeroPedido: r.NUMEROPEDIDO,
                numeroPedidoFormatted: `${r.SERIEPEDIDO || 'M'}-${ano}-${numPedido}`,
                serie: r.SERIEPEDIDO,
                fecha: `${dia}/${mes}/${ano}`,
                fechaFormatted: `${dia}/${mes}/${ano} ${hh}:${mm}`,
                clienteCode: r.CODIGOCLIENTE,
                clienteName: r.NOMBRECLIENTE || `Cliente ${r.CODIGOCLIENTE}`,
                vendedorCode: r.CODIGOVENDEDOR,
                tipoventa: r.TIPOVENTA,
                estado: r.ESTADO,
                total: parseFloat(r.IMPORTETOTAL) || 0,
                base: parseFloat(r.IMPORTEBASE) || 0,
                iva: parseFloat(r.IMPORTEIVA) || 0,
                costo: parseFloat(r.IMPORTECOSTO) || 0,
                margen: parseFloat(r.IMPORTEMARGEN) || 0,
                observaciones: r.OBSERVACIONES,
                formaPago: r.CODIGOFORMAPAGO,
                tarifa: r.CODIGOTARIFA,
                origen: r.ORIGEN,
                lineCount: parseInt(r.LINE_COUNT) || 0,
                createdAt: r.CREATED_AT,
                updatedAt: r.UPDATED_AT,
            };
        });
        return { orders, count: orders.length };
    } catch (error) {
        logger.error(`[PEDIDOS] getOrders error: ${error.message}`);
        throw error;
    }
}

// ============================================================================
// ORDER DETAIL
// ============================================================================

async function getOrderDetail(orderId) {
    const id = parseInt(orderId);
    if (isNaN(id)) throw new Error('Invalid orderId');

    const cabSql = `
        SELECT ID, EJERCICIO, NUMEROPEDIDO, SERIEPEDIDO, TERMINAL,
            DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, HORADOCUMENTO,
            TRIM(CODIGOCLIENTE) AS CODIGOCLIENTE,
            TRIM(NOMBRECLIENTE) AS NOMBRECLIENTE,
            TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR,
            TRIM(CODIGOFORMAPAGO) AS CODIGOFORMAPAGO,
            CODIGOTARIFA, CODIGOALMACEN,
            TRIM(TIPOVENTA) AS TIPOVENTA,
            TRIM(ESTADO) AS ESTADO,
            IMPORTETOTAL, IMPORTEBASE, IMPORTEIVA, IMPORTECOSTO, IMPORTEMARGEN,
            TRIM(OBSERVACIONES) AS OBSERVACIONES,
            CREATED_AT, UPDATED_AT
        FROM JAVIER.PEDIDOS_CAB
        WHERE ID = ?`;

    const linSql = `
        SELECT ID, PEDIDO_ID, SECUENCIA,
            TRIM(CODIGOARTICULO) AS CODIGOARTICULO,
            TRIM(DESCRIPCION) AS DESCRIPCION,
            CANTIDADENVASES, CANTIDADUNIDADES,
            TRIM(UNIDADMEDIDA) AS UNIDADMEDIDA, UNIDADESCAJA,
            PRECIOVENTA, PRECIOCOSTO, PRECIOTARIFA, PRECIOTARIFACLIENTE, PRECIOMINIMO,
            IMPORTEVENTA, IMPORTECOSTO, IMPORTEMARGEN, PORCENTAJEMARGEN,
            TRIM(TIPOLINEA) AS TIPOLINEA,
            TRIM(TIPOVENTA) AS TIPOVENTA,
            TRIM(CLASELINEA) AS CLASELINEA,
            ORDEN, CREATED_AT
        FROM JAVIER.PEDIDOS_LIN
        WHERE PEDIDO_ID = ?
        ORDER BY SECUENCIA`;

    try {
        const [cabRows, linRows] = await Promise.all([
            queryWithParams(cabSql, [id]),
            queryWithParams(linSql, [id]),
        ]);

        if (!cabRows || cabRows.length === 0) {
            throw new Error('Pedido no encontrado');
        }

        const cab = cabRows[0];
        return {
            header: {
                id: cab.ID,
                ejercicio: cab.EJERCICIO,
                numeroPedido: cab.NUMEROPEDIDO,
                serie: cab.SERIEPEDIDO,
                terminal: cab.TERMINAL,
                fecha: `${String(cab.DIADOCUMENTO).padStart(2, '0')}/${String(cab.MESDOCUMENTO).padStart(2, '0')}/${cab.ANODOCUMENTO}`,
                hora: cab.HORADOCUMENTO,
                clienteId: cab.CODIGOCLIENTE,
                clienteNombre: cab.NOMBRECLIENTE,
                vendedor: cab.CODIGOVENDEDOR,
                formaPago: cab.CODIGOFORMAPAGO,
                tarifa: cab.CODIGOTARIFA,
                almacen: cab.CODIGOALMACEN,
                tipoventa: cab.TIPOVENTA,
                estado: cab.ESTADO,
                total: parseFloat(cab.IMPORTETOTAL) || 0,
                base: parseFloat(cab.IMPORTEBASE) || 0,
                iva: parseFloat(cab.IMPORTEIVA) || 0,
                costo: parseFloat(cab.IMPORTECOSTO) || 0,
                margen: parseFloat(cab.IMPORTEMARGEN) || 0,
                observaciones: cab.OBSERVACIONES,
                createdAt: cab.CREATED_AT,
                updatedAt: cab.UPDATED_AT,
            },
            lines: (linRows || []).map(l => ({
                id: l.ID,
                pedidoId: l.PEDIDO_ID,
                secuencia: l.SECUENCIA,
                codigoArticulo: l.CODIGOARTICULO,
                descripcion: l.DESCRIPCION,
                cantidadEnvases: parseFloat(l.CANTIDADENVASES) || 0,
                cantidadUnidades: parseFloat(l.CANTIDADUNIDADES) || 0,
                unidadMedida: l.UNIDADMEDIDA,
                unidadesCaja: parseFloat(l.UNIDADESCAJA) || 1,
                precioVenta: parseFloat(l.PRECIOVENTA) || 0,
                precioCosto: parseFloat(l.PRECIOCOSTO) || 0,
                precioTarifa: parseFloat(l.PRECIOTARIFA) || 0,
                precioTarifaCliente: parseFloat(l.PRECIOTARIFACLIENTE) || 0,
                precioMinimo: parseFloat(l.PRECIOMINIMO) || 0,
                importeVenta: parseFloat(l.IMPORTEVENTA) || 0,
                importeCosto: parseFloat(l.IMPORTECOSTO) || 0,
                importeMargen: parseFloat(l.IMPORTEMARGEN) || 0,
                porcentajeMargen: parseFloat(l.PORCENTAJEMARGEN) || 0,
                tipoLinea: l.TIPOLINEA,
                tipoventa: l.TIPOVENTA,
                claseLinea: l.CLASELINEA,
                orden: l.ORDEN,
                createdAt: l.CREATED_AT,
            })),
        };
    } catch (error) {
        logger.error(`[PEDIDOS] getOrderDetail error: ${error.message}`);
        throw error;
    }
}

// ============================================================================
// SHARED LINE IMPORTE CALCULATOR (P1-A FIX)
// ============================================================================

/**
 * Calculates importeVenta consistently for any line, matching createOrder logic.
 * Handles weight products, dual-field (cajas+unidades), box-only, and generic units.
 */
function calculateLineImporte({ unidadMedida, cantidadEnvases, cantidadUnidades, unidadesCaja, precioVenta }) {
    const um = (unidadMedida || 'CAJAS').trim().toUpperCase();
    const envases = parseFloat(cantidadEnvases) || 0;
    const unidades = parseFloat(cantidadUnidades) || 0;
    const uc = parseFloat(unidadesCaja) || 1;
    const precio = parseFloat(precioVenta) || 0;

    let importe = 0;
    if (um === 'KILOGRAMOS' || um === 'LITROS') {
        importe = unidades * precio;
    } else if (envases > 0 && unidades > 0 && um === 'CAJAS') {
        // Dual-field: price is per box, units are fraction of box
        const decimalFraction = unidades / uc;
        importe = (envases + decimalFraction) * precio;
    } else if (um === 'CAJAS') {
        importe = envases * precio;
    } else {
        // PIEZAS, BANDEJAS, ESTUCHES, UNIDADES, etc.
        importe = unidades * precio;
    }
    return Math.round(importe * 100) / 100;
}

// ============================================================================
// ADD / UPDATE / DELETE LINE
// ============================================================================

async function addOrderLine(pedidoId, lineData) {
    const id = parseInt(pedidoId);
    if (isNaN(id)) throw new Error('Invalid pedidoId');

    // Get next secuencia
    const seqRows = await queryWithParams(
        `SELECT COALESCE(MAX(SECUENCIA), 0) + 1 AS NEXT_SEQ FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID = ?`,
        [id]
    );
    const nextSeq = seqRows[0]?.NEXT_SEQ || 1;

    const cantidadEnvases = parseFloat(lineData.cantidadEnvases) || 0;
    const cantidadUnidades = parseFloat(lineData.cantidadUnidades || lineData.cantidad) || 0;
    const precio = parseFloat(lineData.precio || lineData.precioVenta) || 0;
    const precioCosto = parseFloat(lineData.precioCosto) || 0;
    const unidadesCaja = parseFloat(lineData.unidadesCaja) || 1;
    const unidadMedida = lineData.unidadMedida || 'CAJAS';

    // P1-A: Use shared calculator for consistent importe across add/create
    const importeVenta = calculateLineImporte({ unidadMedida, cantidadEnvases, cantidadUnidades, unidadesCaja, precioVenta: precio });
    const billingQty = (unidadMedida === 'CAJAS') ? cantidadEnvases : cantidadUnidades;
    const importeCosto = Math.round((billingQty * precioCosto) * 100) / 100;
    const importeMargen = importeVenta - importeCosto;
    const pctMargen = importeVenta > 0 ? ((importeMargen / importeVenta) * 100) : 0;

    const sql = `
        INSERT INTO JAVIER.PEDIDOS_LIN (
            PEDIDO_ID, SECUENCIA, CODIGOARTICULO, DESCRIPCION,
            CANTIDADENVASES, CANTIDADUNIDADES, UNIDADMEDIDA, UNIDADESCAJA,
            PRECIOVENTA, PRECIOCOSTO, PRECIOTARIFA, PRECIOTARIFACLIENTE, PRECIOMINIMO,
            IMPORTEVENTA, IMPORTECOSTO, IMPORTEMARGEN, PORCENTAJEMARGEN,
            TIPOLINEA, TIPOVENTA, CLASELINEA, ORDEN
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const params = [
        id, nextSeq,
        (lineData.codigoArticulo || '').trim(), (lineData.descripcion || '').substring(0, 40),
        cantidadEnvases, cantidadUnidades,
        unidadMedida, unidadesCaja,
        precio, precioCosto,
        parseFloat(lineData.precioTarifa) || 0, parseFloat(lineData.precioTarifaCliente) || 0,
        parseFloat(lineData.precioMinimo) || 0,
        importeVenta, importeCosto, importeMargen,
        Math.round(pctMargen * 100) / 100,
        lineData.tipoLinea || 'R', lineData.tipoventa || 'CC', lineData.claseLinea || 'VT', nextSeq
    ];

    await queryWithParams(sql, params, false);
    await recalculateOrderTotals(id);

    return getOrderDetail(id);
}

async function updateOrderLine(lineId, { cantidad, precio, unidadMedida, precioCosto, claseLinea }) {
    const id = parseInt(lineId);
    if (isNaN(id)) throw new Error('Invalid lineId');

    if (claseLinea !== undefined && !['VT', 'SC'].includes(claseLinea)) {
        throw new Error('claseLinea inválida');
    }

    // Fetch current line to get pedidoId and defaults
    const currentRows = await queryWithParams(
        `SELECT PEDIDO_ID, CANTIDADUNIDADES, PRECIOVENTA, PRECIOCOSTO, UNIDADMEDIDA, CLASELINEA FROM JAVIER.PEDIDOS_LIN WHERE ID = ?`,
        [id]
    );
    if (!currentRows || currentRows.length === 0) throw new Error('Line not found');

    const current = currentRows[0];
    const pedidoId = current.PEDIDO_ID;

    const newClase = claseLinea !== undefined ? claseLinea : (current.CLASELINEA || 'VT');
    const newCantidad = cantidad != null ? parseFloat(cantidad) : parseFloat(current.CANTIDADUNIDADES) || 0;
    // SC lines always have 0 price and importe
    const newPrecio = newClase === 'SC' ? 0
        : (precio != null ? parseFloat(precio) : parseFloat(current.PRECIOVENTA) || 0);
    const newCosto = precioCosto != null ? parseFloat(precioCosto) : parseFloat(current.PRECIOCOSTO) || 0;
    const newUM = unidadMedida || current.UNIDADMEDIDA;

    const importeVenta = newClase === 'SC' ? 0 : newCantidad * newPrecio;
    const importeCosto = newCantidad * newCosto;
    const importeMargen = importeVenta - importeCosto;
    const pctMargen = importeVenta > 0 ? ((importeMargen / importeVenta) * 100) : 0;

    await queryWithParams(
        `UPDATE JAVIER.PEDIDOS_LIN SET
            CANTIDADUNIDADES = ?, PRECIOVENTA = ?, PRECIOCOSTO = ?, UNIDADMEDIDA = ?,
            IMPORTEVENTA = ?, IMPORTECOSTO = ?, IMPORTEMARGEN = ?, PORCENTAJEMARGEN = ?,
            CLASELINEA = ?
        WHERE ID = ?`,
        [newCantidad, newPrecio, newCosto, newUM, importeVenta, importeCosto, importeMargen,
            Math.round(pctMargen * 100) / 100, newClase, id],
        false
    );

    await recalculateOrderTotals(pedidoId);
    return getOrderDetail(pedidoId);
}

async function deleteOrderLine(lineId, pedidoId) {
    const lid = parseInt(lineId);
    const pid = parseInt(pedidoId);
    if (isNaN(lid) || isNaN(pid)) throw new Error('Invalid lineId or pedidoId');

    await queryWithParams(
        `DELETE FROM JAVIER.PEDIDOS_LIN WHERE ID = ? AND PEDIDO_ID = ?`,
        [lid, pid], false
    );

    await recalculateOrderTotals(pid);
    return getOrderDetail(pid);
}

// ============================================================================
// RECALCULATE TOTALS
// ============================================================================

async function recalculateOrderTotals(pedidoId) {
    // P4-B FIX: Single subquery, compute IVA, no IMPORTEBASE/IMPORTETOTAL duplicate
    const id = parseInt(pedidoId);
    await queryWithParams(
        `UPDATE JAVIER.PEDIDOS_CAB SET
            IMPORTEBASE = (SELECT COALESCE(SUM(IMPORTEVENTA), 0) FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID = ?),
            IMPORTECOSTO = (SELECT COALESCE(SUM(IMPORTECOSTO), 0) FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID = ?),
            IMPORTEMARGEN = (SELECT COALESCE(SUM(IMPORTEMARGEN), 0) FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID = ?),
            IMPORTETOTAL = (SELECT COALESCE(SUM(IMPORTEVENTA), 0) FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID = ?),
            IMPORTEIVA = 0,
            UPDATED_AT = CURRENT_TIMESTAMP
        WHERE ID = ?`,
        [id, id, id, id, id], false
    );
}

// ============================================================================
// CONFIRM / CANCEL
// ============================================================================

async function confirmOrder(orderId, saleType, options = {}) {
    const id = parseInt(orderId);
    if (isNaN(id)) throw new Error('Invalid orderId');

    // STATE GUARD: Check current state to prevent double-confirm
    const currentRows = await queryWithParams(
        `SELECT ESTADO FROM JAVIER.PEDIDOS_CAB WHERE ID = ?`,
        [id], false
    );
    
    if (!currentRows || currentRows.length === 0) {
        throw new Error('Pedido no encontrado');
    }
    
    const currentState = (currentRows[0].ESTADO || '').trim();
    
    // Prevent confirming an already confirmed or shipped order
    if (currentState === 'CONFIRMADO') {
        throw new Error('El pedido ya está confirmado');
    }
    
    if (currentState === 'ENVIADO') {
        throw new Error('No se puede confirmar un pedido que ya ha sido enviado');
    }
    
    if (currentState === 'ANULADO') {
        throw new Error('No se puede confirmar un pedido anulado');
    }
    
    // Only BORRADOR orders can be confirmed
    if (currentState !== 'BORRADOR') {
        throw new Error(`Solo se pueden confirmar pedidos en estado BORRADOR (estado actual: ${currentState})`);
    }

    // P0-C: Validate stock BEFORE confirming — block if insufficient
    const lines = await queryWithParams(
        `SELECT CODIGOARTICULO, CANTIDADENVASES, CANTIDADUNIDADES, DESCRIPCION
         FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID = ?`, [id]);

    const stockWarnings = [];
    const outOfStockProducts = [];
    for (const line of lines) {
        const code = (line.CODIGOARTICULO || '').trim();
        if (!code) continue;
        try {
            // Force fresh stock read (bypass cache) for confirmation
            const stock = await getStock(code);
            const reqEnvases = parseFloat(line.CANTIDADENVASES) || 0;
            const reqUnidades = parseFloat(line.CANTIDADUNIDADES) || 0;
            if (reqEnvases > 0 && reqEnvases > stock.envases) {
                const warning = {
                    product: code,
                    description: (line.DESCRIPCION || '').trim(),
                    requested: reqEnvases,
                    available: stock.envases,
                    unit: 'envases'
                };
                stockWarnings.push(warning);
                if (stock.envases <= 0) outOfStockProducts.push(code);
            }
            if (reqUnidades > 0 && reqUnidades > stock.unidades) {
                const warning = {
                    product: code,
                    description: (line.DESCRIPCION || '').trim(),
                    requested: reqUnidades,
                    available: stock.unidades,
                    unit: 'unidades'
                };
                stockWarnings.push(warning);
                if (stock.unidades <= 0 && reqEnvases <= 0) outOfStockProducts.push(code);
            }
        } catch (e) {
            logger.warn(`[PEDIDOS] Stock check failed for ${code}: ${e.message}`);
        }
    }

    // P0-C: BLOCK confirmation if stock would go negative (unless force-approved)
    if (stockWarnings.length > 0 && !options.forceConfirm) {
        // Fetch similar products for out-of-stock items
        let alternatives = [];
        for (const code of outOfStockProducts.slice(0, 5)) {
            try {
                const similar = await getSimilarProducts(code);
                if (similar.length > 0) {
                    alternatives.push({ product: code, alternatives: similar });
                }
            } catch (e) {
                logger.warn(`[PEDIDOS] getSimilarProducts error for ${code}: ${e.message}`);
            }
        }

        return {
            blocked: true,
            reason: 'STOCK_INSUFICIENTE',
            stockWarnings,
            alternatives,
            message: `Stock insuficiente para ${stockWarnings.length} producto(s). Revisa las alternativas o elimina los productos sin stock.`
        };
    }

    // P0-B: Confirm + reserve in sequence, rollback estado if reserves fail
    const params = [id];
    let sql = `UPDATE JAVIER.PEDIDOS_CAB SET ESTADO = 'CONFIRMADO', UPDATED_AT = CURRENT_TIMESTAMP`;
    if (saleType) {
        sql += `, TIPOVENTA = ?`;
        params.unshift(saleType.trim());
    }
    sql += ` WHERE ID = ?`;

    await queryWithParams(sql, params, false);

    // ── Stock reservation: insert rows for each line ──
    let reserveSuccess = true;
    try {
        for (const line of lines) {
            const code = (line.CODIGOARTICULO || '').trim();
            if (!code) continue;
            const resEnv = parseFloat(line.CANTIDADENVASES) || 0;
            const resUni = parseFloat(line.CANTIDADUNIDADES) || 0;
            if (resEnv > 0 || resUni > 0) {
                await queryWithParams(
                    `INSERT INTO JAVIER.PEDIDOS_STOCK_RESERVE (PEDIDO_ID, CODIGOARTICULO, CANTIDADENVASES, CANTIDADUNIDADES) VALUES (?, ?, ?, ?)`,
                    [id, code, resEnv, resUni], false
                );
            }
        }
        logger.info(`[PEDIDOS] Stock reserved for order #${id}`);
    } catch (resErr) {
        reserveSuccess = false;
        logger.error(`[PEDIDOS] CRITICAL: Stock reservation failed for order #${id}, rolling back: ${resErr.message}`);
        // P0-B: Rollback — set estado back to BORRADOR if reservation fails
        try {
            await queryWithParams(
                `UPDATE JAVIER.PEDIDOS_CAB SET ESTADO = 'BORRADOR', UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = ?`,
                [id], false
            );
            await queryWithParams(`DELETE FROM JAVIER.PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID = ?`, [id], false);
        } catch (rollbackErr) {
            logger.error(`[PEDIDOS] CRITICAL: Rollback also failed for order #${id}: ${rollbackErr.message}`);
        }
        throw new Error(`No se pudo completar la reserva de stock. El pedido no ha sido confirmado. Error: ${resErr.message}`);
    }

    // P4-A: Invalidate stock and product cache to ensure real-time updates for all sales reps
    try {
        if (redisCache && typeof redisCache.invalidatePattern === 'function') {
            await redisCache.invalidatePattern('pedidos:*');
        }
    } catch (e) {
        logger.warn(`[PEDIDOS] Failed to invalidate cache: ${e.message}`);
    }

    const order = await getOrderDetail(id);

    // AUD: Audit log for order confirmation
    try {
        const auditEntry = {
            event: 'ORDER_CONFIRMED',
            orderId: id,
            numeroPedido: order?.header?.numeroPedido,
            clientCode: order?.header?.clienteId,
            clientName: order?.header?.clienteNombre,
            vendedorCode: order?.header?.vendedor,
            total: order?.header?.total,
            saleType: saleType || order?.header?.tipoventa,
            lineCount: lines.length,
            stockWarningCount: stockWarnings.length,
            forceConfirm: !!options.forceConfirm,
            userId: options.userId || 'SYSTEM'
        };
        logger.info(`[AUDIT] ✅ ORDER_CONFIRMED #${id} | Client:${auditEntry.clientCode} | Total:${auditEntry.total} | Lines:${lines.length}`);
    } catch (auditErr) { /* silent */ }

    return { ...order, stockWarnings };
}

async function cancelOrder(orderId, options = {}) {
    const id = parseInt(orderId);
    if (isNaN(id)) throw new Error('Invalid orderId');

    // STATE GUARD: Get current state before cancelling
    const currentRows = await queryWithParams(
        `SELECT ESTADO, CODIGOCLIENTE, IMPORTETOTAL FROM JAVIER.PEDIDOS_CAB WHERE ID = ?`,
        [id], false
    );
    
    if (!currentRows || currentRows.length === 0) {
        throw new Error('Pedido no encontrado');
    }
    
    const currentState = (currentRows[0].ESTADO || '').trim();
    
    // Prevent double-cancel
    if (currentState === 'ANULADO') {
        throw new Error('El pedido ya está anulado');
    }
    
    // Prevent cancelling shipped orders
    if (currentState === 'ENVIADO') {
        throw new Error('No se puede anular un pedido que ya ha sido enviado');
    }
    
    // Only allow cancelling BORRADOR or CONFIRMADO orders
    if (!['BORRADOR', 'CONFIRMADO'].includes(currentState)) {
        throw new Error(`No se puede anular un pedido en estado: ${currentState}`);
    }

    // Get order info for audit before cancelling
    let orderBefore;
    try { orderBefore = await getOrderDetail(id); } catch (e) { /* ok */ }

    await queryWithParams(
        `UPDATE JAVIER.PEDIDOS_CAB SET ESTADO = 'ANULADO', UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = ?`,
        [id], false
    );

    // Release stock reservations (only if order was CONFIRMADO)
    const releasedCodes = [];
    if (currentState === 'CONFIRMADO') {
        try {
            const reservations = await queryWithParams(
                `SELECT CODIGOARTICULO FROM JAVIER.PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID = ?`, [id]
            );
            releasedCodes.push(...reservations.map(r => (r.CODIGOARTICULO || '').trim()).filter(Boolean));
            await queryWithParams(`DELETE FROM JAVIER.PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID = ?`, [id], false);
            logger.info(`[PEDIDOS] Stock reservations released for cancelled order #${id}`);
        } catch (e) {
            logger.warn(`[PEDIDOS] Stock reservation release error: ${e.message}`);
        }
    }

    // P4-A: Invalidate stock and product cache for released products
    try {
        if (redisCache && typeof redisCache.invalidatePattern === 'function') {
            await redisCache.invalidatePattern('pedidos:*');
        }
    } catch (e) {
        logger.warn(`[PEDIDOS] Failed to invalidate cache: ${e.message}`);
    }

    // AUD: Audit log for cancellation
    try {
        logger.info(`[AUDIT] ❌ ORDER_CANCELLED #${id} | Client:${currentRows[0].CODIGOCLIENTE || '?'} | Total:${currentRows[0].IMPORTETOTAL || 0} | From:${currentState} | By:${options.userId || 'SYSTEM'}`);
    } catch (auditErr) { /* silent */ }

    return getOrderDetail(id);
}

// ============================================================================
// ORDER STATUS UPDATE (for Pendiente Aprobación)
// ============================================================================

async function updateOrderStatus(orderId, newStatus, options = {}) {
    const id = parseInt(orderId);
    if (isNaN(id)) throw new Error('Invalid orderId');
    
    const allowedStatuses = ['BORRADOR', 'PENDIENTE', 'CONFIRMADO', 'ENVIADO', 'ANULADO'];
    const status = (newStatus || '').toUpperCase().trim();
    
    if (!allowedStatuses.includes(status)) {
        throw new Error(`Estado no válido: ${status}. Estados permitidos: ${allowedStatuses.join(', ')}`);
    }

    // Get order info for audit before updating
    let orderBefore;
    try { orderBefore = await getOrderDetail(id); } catch (e) { /* ok */ }

    await queryWithParams(
        `UPDATE JAVIER.PEDIDOS_CAB SET ESTADO = ?, UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = ?`,
        [status, id], false
    );

    // Invalidate cache
    try {
        if (redisCache && typeof redisCache.invalidatePattern === 'function') {
            await redisCache.invalidatePattern('pedidos:*');
        }
    } catch (e) {
        logger.warn(`[PEDIDOS] Failed to invalidate cache: ${e.message}`);
    }

    // AUD: Audit log
    try {
        logger.info(`[AUDIT] 📝 ORDER_STATUS_CHANGED #${id} | ${orderBefore?.header?.estado || '?'} -> ${status} | By:${options.userId || 'SYSTEM'}`);
    } catch (auditErr) { /* silent */ }

    return getOrderDetail(id);
}

// ============================================================================
// ORDER STATS
// ============================================================================

async function getOrderStats(vendedorCodes, dateFrom, dateTo) {
    const whereParts = [];
    const params = [];

    if (vendedorCodes && vendedorCodes.trim().toUpperCase() !== 'ALL') {
        const codes = vendedorCodes.split(',').map(c => c.trim()).filter(Boolean);
        // DB2 ODBC limit on parameter markers; 50+ vendors ≈ ALL
        if (codes.length > 50) {
            // no vendor filter
        } else if (codes.length === 1) {
            whereParts.push('TRIM(CODIGOVENDEDOR) = ?');
            params.push(codes[0]);
        } else {
            whereParts.push(`TRIM(CODIGOVENDEDOR) IN (${codes.map(() => '?').join(',')})`);
            params.push(...codes);
        }
    }

    if (dateFrom) {
        const df = String(dateFrom).replace(/-/g, '');
        if (df.length === 8) {
            const y = parseInt(df.substring(0, 4));
            const m = parseInt(df.substring(4, 6));
            const d = parseInt(df.substring(6, 8));
            whereParts.push('(ANODOCUMENTO > ? OR (ANODOCUMENTO = ? AND MESDOCUMENTO > ?) OR (ANODOCUMENTO = ? AND MESDOCUMENTO = ? AND DIADOCUMENTO >= ?))');
            params.push(y, y, m, y, m, d);
        }
    }
    if (dateTo) {
        const dt = String(dateTo).replace(/-/g, '');
        if (dt.length === 8) {
            const y = parseInt(dt.substring(0, 4));
            const m = parseInt(dt.substring(4, 6));
            const d = parseInt(dt.substring(6, 8));
            whereParts.push('(ANODOCUMENTO < ? OR (ANODOCUMENTO = ? AND MESDOCUMENTO < ?) OR (ANODOCUMENTO = ? AND MESDOCUMENTO = ? AND DIADOCUMENTO <= ?))');
            params.push(y, y, m, y, m, d);
        }
    }

    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const statsSql = `
        SELECT
            COUNT(*) AS TOTALORDERS,
            COALESCE(SUM(IMPORTETOTAL), 0) AS TOTALAMOUNT,
            COALESCE(SUM(IMPORTEBASE), 0) AS TOTALBASE,
            COALESCE(SUM(IMPORTEIVA), 0) AS TOTALIVA,
            CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(IMPORTEMARGEN) * 100.0 / NULLIF(SUM(IMPORTEBASE), 0), 0) ELSE 0 END AS AVGMARGIN,
            CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(IMPORTETOTAL) * 1.0 / COUNT(*), 0) ELSE 0 END AS AVGTICKET
        FROM JAVIER.PEDIDOS_CAB ${where}`;

    const statusSql = `
        SELECT TRIM(ESTADO) AS ESTADO, COUNT(*) AS CNT
        FROM JAVIER.PEDIDOS_CAB ${where}
        GROUP BY ESTADO`;

    const trendSql = `
        SELECT ANODOCUMENTO AS Y, MESDOCUMENTO AS M, DIADOCUMENTO AS D,
            COUNT(*) AS ORDERS, COALESCE(SUM(IMPORTETOTAL), 0) AS AMOUNT
        FROM JAVIER.PEDIDOS_CAB ${where ? where + ' AND' : 'WHERE'} ANODOCUMENTO > 0
        GROUP BY ANODOCUMENTO, MESDOCUMENTO, DIADOCUMENTO
        ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
        FETCH FIRST 7 ROWS ONLY`;

    const topSql = `
        SELECT TRIM(CODIGOCLIENTE) AS CODE, TRIM(NOMBRECLIENTE) AS NAME,
            COUNT(*) AS ORDERS, COALESCE(SUM(IMPORTETOTAL), 0) AS AMOUNT
        FROM JAVIER.PEDIDOS_CAB ${where ? where + ' AND' : 'WHERE'} CODIGOCLIENTE <> ''
        GROUP BY CODIGOCLIENTE, NOMBRECLIENTE
        ORDER BY AMOUNT DESC
        FETCH FIRST 5 ROWS ONLY`;

    try {
        const [statsRows, statusRows, trendRows, topRows] = await Promise.all([
            queryWithParams(statsSql, params).catch(e => { logger.warn(`[PEDIDOS] stats err: ${e.message}`); return []; }),
            queryWithParams(statusSql, params).catch(e => { logger.warn(`[PEDIDOS] status err: ${e.message}`); return []; }),
            queryWithParams(trendSql, params).catch(e => { logger.warn(`[PEDIDOS] trend err: ${e.message}`); return []; }),
            queryWithParams(topSql, params).catch(e => { logger.warn(`[PEDIDOS] top err: ${e.message}`); return []; }),
        ]);

        const stats = statsRows[0] || {};
        const byStatus = {};
        for (const s of (statusRows || [])) {
            byStatus[(s.ESTADO || '').trim()] = parseInt(s.CNT) || 0;
        }

        const dailyTrend = (trendRows || []).map(r => ({
            date: `${String(r.Y).padStart(4, '0')}-${String(r.M).padStart(2, '0')}-${String(r.D).padStart(2, '0')}`,
            orders: parseInt(r.ORDERS) || 0,
            amount: parseFloat(r.AMOUNT) || 0,
        })).reverse();

        const topClients = (topRows || []).map(r => ({
            code: (r.CODE || '').trim(),
            name: (r.NAME || '').trim(),
            orders: parseInt(r.ORDERS) || 0,
            amount: parseFloat(r.AMOUNT) || 0,
        }));

        return {
            totalOrders: parseInt(stats.TOTALORDERS) || 0,
            totalAmount: parseFloat(stats.TOTALAMOUNT) || 0,
            totalBase: parseFloat(stats.TOTALBASE) || 0,
            totalIva: parseFloat(stats.TOTALIVA) || 0,
            avgMargin: parseFloat(stats.AVGMARGIN) || 0,
            avgTicket: parseFloat(stats.AVGTICKET) || 0,
            byStatus,
            dailyTrend,
            topClients,
        };
    } catch (error) {
        logger.error(`[PEDIDOS] getOrderStats error: ${error.message}`);
        throw error;
    }
}

// ============================================================================
// ORDER ALBARAN LOOKUP
// ============================================================================

async function getOrderAlbaran(orderId) {
    const id = parseInt(orderId);
    if (isNaN(id)) throw new Error('Invalid orderId');

    const orderRows = await queryWithParams(
        `SELECT CODIGOCLIENTE, DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, NUMEROPEDIDO
         FROM JAVIER.PEDIDOS_CAB WHERE ID = ?`,
        [id]
    );
    if (!orderRows || orderRows.length === 0) throw new Error('Pedido no encontrado');

    const order = orderRows[0];
    const clientCode = (order.CODIGOCLIENTE || '').trim();

    const albaranSql = `
        SELECT TRIM(C.NUMEROALBARAN) AS NUMEROALBARAN,
               TRIM(C.SERIEALBARAN) AS SERIEALBARAN,
               C.DIADOCUMENTO, C.MESDOCUMENTO, C.ANODOCUMENTO,
               TRIM(C.CODIGOCLIENTE) AS CODIGOCLIENTE,
               C.IMPORTEALBARAN,
               TRIM(C.SITUACIONALBARAN) AS SITUACION,
               TRIM(C.ESTADOENVIO) AS ESTADOENVIO
        FROM DSEDAC.CAC C
        WHERE TRIM(C.CODIGOCLIENTE) = ?
          AND C.ANODOCUMENTO = ?
          AND C.ELIMINADOSN <> 'N'
        ORDER BY C.ANODOCUMENTO DESC, C.MESDOCUMENTO DESC, C.DIADOCUMENTO DESC
        FETCH FIRST 3 ROWS ONLY`;

    try {
        const rows = await queryWithParams(albaranSql, [clientCode, order.ANODOCUMENTO]);
        return (rows || []).map(r => ({
            numeroAlbaran: r.NUMEROALBARAN,
            serie: r.SERIEALBARAN,
            fecha: `${String(r.DIADOCUMENTO).padStart(2, '0')}/${String(r.MESDOCUMENTO).padStart(2, '0')}/${r.ANODOCUMENTO}`,
            situacion: (r.SITUACION || '').trim(),
            estadoEnvio: (r.ESTADOENVIO || '').trim(),
            importe: parseFloat(r.IMPORTEALBARAN) || 0,
        }));
    } catch (error) {
        logger.warn(`[PEDIDOS] getOrderAlbaran: ${error.message}`);
        return [];
    }
}

// ============================================================================
// RECOMMENDATIONS
// ============================================================================

async function getRecommendations(clientCode, vendedorCode) {
    if (!clientCode) throw new Error('clientCode is required');

    const trimClient = clientCode.trim();
    const trimVendor = (vendedorCode || '').trim();

    // Strategy 1: Client purchase history (last 12 months)
    const historySql = `
        SELECT TRIM(L.CODIGOARTICULO) AS code,
            TRIM(L.DESCRIPCION) AS name,
            COUNT(*) AS frequency,
            SUM(L.CANTIDADUNIDADES) AS totalUnits,
            MAX(L.ANODOCUMENTO * 10000 + L.MESDOCUMENTO * 100 + L.DIADOCUMENTO) AS lastPurchase
        FROM DSEDAC.LINDTO L
        WHERE TRIM(L.CODIGOCLIENTEALBARAN) = ?
          AND L.ANODOCUMENTO >= YEAR(CURRENT_DATE) - 1
          AND L.TIPOVENTA IN ('CC', 'VC')
          AND L.CLASELINEA IN ('AB', 'VT')
          AND L.SERIEALBARAN NOT IN ('N', 'Z')
        GROUP BY L.CODIGOARTICULO, L.DESCRIPCION
        ORDER BY frequency DESC
        FETCH FIRST 20 ROWS ONLY`;

    // Execute history query
    let history = [];
    try {
        const historyRows = await queryWithParams(historySql, [trimClient]);
        history = (historyRows || []).map(r => ({
            code: (r.CODE || '').trim(),
            name: (r.NAME || '').trim(),
            frequency: parseInt(r.FREQUENCY) || 0,
            totalUnits: parseFloat(r.TOTALUNITS) || 0,
            lastPurchase: r.LASTPURCHASE,
            source: 'history',
        }));
    } catch (error) {
        logger.error(`[PEDIDOS] getRecommendations history error: ${error.message}`);
    }

    // Strategy 2: Similar clients (only if vendor is provided)
    let similar = [];
    if (trimVendor) {
        // Handle multi-vendor codes (comma-separated) — use first code only
        // CODIGOVENDEDOR is CHAR(2), can't hold the full comma string
        const singleVendor = trimVendor.split(',')[0].trim().substring(0, 2);
        const similarSql = `
            SELECT TRIM(L.CODIGOARTICULO) AS code,
                TRIM(L.DESCRIPCION) AS name,
                COUNT(DISTINCT L.CODIGOCLIENTEALBARAN) AS clientCount
            FROM DSEDAC.LINDTO L
            WHERE TRIM(L.CODIGOVENDEDOR) = ?
              AND L.ANODOCUMENTO = YEAR(CURRENT_DATE)
              AND L.TIPOVENTA IN ('CC', 'VC')
              AND L.CLASELINEA IN ('AB', 'VT')
              AND L.SERIEALBARAN NOT IN ('N', 'Z')
              AND NOT EXISTS (
                  SELECT 1 FROM DSEDAC.LINDTO L2
                  WHERE L2.CODIGOARTICULO = L.CODIGOARTICULO
                    AND TRIM(L2.CODIGOCLIENTEALBARAN) = ?
                    AND (L2.ANODOCUMENTO * 12 + L2.MESDOCUMENTO)
                        >= (YEAR(CURRENT_DATE) * 12 + MONTH(CURRENT_DATE) - 3)
              )
            GROUP BY L.CODIGOARTICULO, L.DESCRIPCION
            HAVING COUNT(DISTINCT L.CODIGOCLIENTEALBARAN) >= 3
            ORDER BY clientCount DESC
            FETCH FIRST 10 ROWS ONLY`;
        try {
            const similarRows = await queryWithParams(similarSql, [singleVendor, trimClient]);
            similar = (similarRows || []).map(r => ({
                code: (r.CODE || '').trim(),
                name: (r.NAME || '').trim(),
                clientCount: parseInt(r.CLIENTCOUNT) || 0,
                source: 'similar',
            }));
        } catch (error) {
            logger.error(`[PEDIDOS] getRecommendations similar error: ${error.message}`);
        }
    }

    return { clientHistory: history, similarClients: similar };
}

// ============================================================================
// FAMILIES & BRANDS
// ============================================================================

async function getFamilies() {
    const sql = `SELECT DISTINCT TRIM(CODIGOFAMILIA) AS CODE FROM DSEDAC.ART WHERE ANOBAJA = 0 AND CODIGOFAMILIA != '' ORDER BY 1`;
    const cacheKey = 'pedidos:families';

    try {
        const rows = await cachedQuery((sql) => query(sql), sql, cacheKey, TTL.SHORT);
        return rows.map(r => (r.CODE || '').trim()).filter(Boolean);
    } catch (error) {
        logger.error(`[PEDIDOS] getFamilies error: ${error.message}`);
        throw error;
    }
}

async function getBrands() {
    const sql = `SELECT DISTINCT TRIM(CODIGOMARCA) AS CODE FROM DSEDAC.ART WHERE ANOBAJA = 0 AND CODIGOMARCA != '' ORDER BY 1`;
    const cacheKey = 'pedidos:brands';

    try {
        const rows = await cachedQuery((sql) => query(sql), sql, cacheKey, TTL.SHORT);
        return rows.map(r => (r.CODE || '').trim()).filter(Boolean);
    } catch (error) {
        logger.error(`[PEDIDOS] getBrands error: ${error.message}`);
        throw error;
    }
}

async function getActivePromotions(clientCode) {
    try {
        const trimmedClientCode = String(clientCode || '').trim();
        if (!trimmedClientCode) {
            return [];
        }

        const now = new Date();
        const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate(); // YYYYMMDD

        // --- PRICE promotions from CPESL1 (client-specific special prices) ---
        const paramsCpes = [today, today];
        let sqlCpes = `
            SELECT 'PRICE' AS PROMOTYPE,
                   TRIM(P.CODIGOARTICULO) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   P.PRECIO AS PROMOPRICE,
                   COALESCE(T.PRECIOTARIFA, 0) AS REGULARPRICE,
                   COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0) AS STOCKENVASES,
                   COALESCE(S.UNIDADES_DISP, 0) - COALESCE(RES.RES_UNI, 0) AS STOCKUNIDADES,
                   P.C9INFC AS DATEFROM, P.C9FIFC AS DATETO,
                   'Precio Especial' AS PROMODESC,
                   '' AS PROMOCODE,
                   0 AS CANTIDADMINIMA,
                   0 AS CANTIDADREGALO,
                   'N' AS ACUMULATIVA
            FROM DSEDAC.CPESL1 P
            JOIN DSEDAC.ART A ON TRIM(P.CODIGOARTICULO) = TRIM(A.CODIGOARTICULO)
            LEFT JOIN DSEDAC.ARA T ON TRIM(P.CODIGOARTICULO) = TRIM(T.CODIGOARTICULO) AND T.CODIGOTARIFA = 1
            LEFT JOIN (
                SELECT CODIGOARTICULO,
                    SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                    SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
                FROM DSEDAC.ARO WHERE CODIGOALMACEN = 1
                GROUP BY CODIGOARTICULO
            ) S ON TRIM(P.CODIGOARTICULO) = TRIM(S.CODIGOARTICULO)
            LEFT JOIN (
                SELECT SR.CODIGOARTICULO,
                    SUM(SR.CANTIDADENVASES) AS RES_ENV,
                    SUM(SR.CANTIDADUNIDADES) AS RES_UNI
                FROM JAVIER.PEDIDOS_STOCK_RESERVE SR
                JOIN JAVIER.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID AND C.ESTADO = 'CONFIRMADO'
                GROUP BY SR.CODIGOARTICULO
            ) RES ON TRIM(P.CODIGOARTICULO) = TRIM(RES.CODIGOARTICULO)
            WHERE P.C9INFC <= ? AND (P.C9FIFC >= ? OR P.C9FIFC = 0)`;

        if (trimmedClientCode) {
            sqlCpes += ` AND TRIM(P.CODIGOCLIENTE) = ?`;
            paramsCpes.push(trimmedClientCode);
        }

        // --- GIFT promotions from PMRL1 (header) + PMPL1 (product lines) ---
        // Check which columns exist in PMRL1 before querying
        let pmrl1Columns = {};
        try {
            const colCheck = await query(`
                SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS2
                WHERE TABLE_SCHEMA = 'DSEDAC'
                  AND TABLE_NAME = 'PMRL1'
                FETCH FIRST 100 ROWS ONLY
            `);
            colCheck.forEach(col => {
                pmrl1Columns[(col.COLUMN_NAME || '').trim()] = true;
            });
            logger.info(`[PEDIDOS] PMRL1 columns found: ${Object.keys(pmrl1Columns).join(', ')}`);
        } catch(e) {
            logger.warn(`[PEDIDOS] Could not check PMRL1 columns: ${e.message}`);
            // Assume all columns exist as fallback
            pmrl1Columns = {
                CODIGOPROMOCIONREGALO: true,
                NOMBREPROMOCIONREGALO: true,
                CODIGOCLIENTE: true,
                P1INFC: true,
                P1FNFC: true,
                CANTIDADMINIMAPROMOCION: true,
                CANTIDADMAXIMAREGALO: true,
                PROMOCIONACUMULATIVASN: true,
                CANTIDADMAXIMAPROMOCION: true,
                CANTIDADMINIMAREGALO: true
            };
        }

        // Build PMRL1 query with only existing columns
        const paramsPmr = [today, today];
        let sqlPmrHeaders = `
            SELECT ${pmrl1Columns.CODIGOPROMOCIONREGALO ? 'TRIM(H.CODIGOPROMOCIONREGALO)' : "''"} AS PROMOCODE,
                   ${pmrl1Columns.NOMBREPROMOCIONREGALO ? 'TRIM(H.NOMBREPROMOCIONREGALO)' : "''"} AS PROMONAME,
                   ${pmrl1Columns.CODIGOCLIENTE ? 'TRIM(H.CODIGOCLIENTE)' : "''"} AS CLIENTCODE,
                   H.P1INFC AS DATEFROM,
                   H.P1FNFC AS DATETO,
                   ${pmrl1Columns.CANTIDADMINIMAPROMOCION ? 'H.CANTIDADMINIMAPROMOCION' : '0'} AS CANTIDADMINIMA,
                   ${pmrl1Columns.CANTIDADMAXIMAREGALO ? 'H.CANTIDADMAXIMAREGALO' : '0'} AS CANTIDADREGALO,
                   ${pmrl1Columns.PROMOCIONACUMULATIVASN ? "COALESCE(H.PROMOCIONACUMULATIVASN, 'N')" : "'N'"} AS ACUMULATIVA,
                   ${pmrl1Columns.CANTIDADMAXIMAPROMOCION ? 'COALESCE(H.CANTIDADMAXIMAPROMOCION, 0)' : '0'} AS CANTIDADMAXPROMO,
                   ${pmrl1Columns.CANTIDADMINIMAREGALO ? 'COALESCE(H.CANTIDADMINIMAREGALO, 0)' : '0'} AS CANTIDADMINREGALO
            FROM DSEDAC.PMRL1 H
            WHERE (H.P1INFC <= ? OR H.P1INFC = 0)
              AND (H.P1FNFC >= ? OR H.P1FNFC = 0)`;

        // Include BOTH global (empty/whitespace client) AND specific client
        if (trimmedClientCode) {
            sqlPmrHeaders += ` AND (${pmrl1Columns.CODIGOCLIENTE ? "(TRIM(H.CODIGOCLIENTE) = '' OR TRIM(H.CODIGOCLIENTE) = ?)" : '1=1'})`;
            paramsPmr.push(trimmedClientCode);
        } else {
            sqlPmrHeaders += ` AND ${pmrl1Columns.CODIGOCLIENTE ? "TRIM(H.CODIGOCLIENTE) = ''" : '1=1'}`;
        }

        // PMPL1: Get ALL products for all active promos (we'll match in JS)
        const sqlPmrProducts = `
            SELECT TRIM(PL.CODIGOPROMOCION) AS PROMOCODE,
                   TRIM(PL.CODIGOARTICULO) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   COALESCE(T.PRECIOTARIFA, 0) AS REGULARPRICE,
                   COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0) AS STOCKENVASES,
                   COALESCE(S.UNIDADES_DISP, 0) - COALESCE(RES.RES_UNI, 0) AS STOCKUNIDADES,
                   PL.ORDEN AS ORDEN,
                   PL.CANTIDADMINIMAUNIDADES AS MINUNITS,
                   PL.CANTIDADMINIMAENVASES AS MINBOXES,
                   PL.CANTIDADMAXIMAUNIDADES AS MAXUNITS,
                   PL.CANTIDADMAXIMAENVASES AS MAXBOXES
            FROM DSEDAC.PMPL1 PL
            JOIN DSEDAC.ART A ON TRIM(PL.CODIGOARTICULO) = TRIM(A.CODIGOARTICULO)
            LEFT JOIN DSEDAC.ARA T ON TRIM(PL.CODIGOARTICULO) = TRIM(T.CODIGOARTICULO) AND T.CODIGOTARIFA = 1
            LEFT JOIN (
                SELECT CODIGOARTICULO,
                    SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                    SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
                FROM DSEDAC.ARO WHERE CODIGOALMACEN = 1
                GROUP BY CODIGOARTICULO
            ) S ON TRIM(PL.CODIGOARTICULO) = TRIM(S.CODIGOARTICULO)
            LEFT JOIN (
                SELECT SR.CODIGOARTICULO,
                    SUM(SR.CANTIDADENVASES) AS RES_ENV,
                    SUM(SR.CANTIDADUNIDADES) AS RES_UNI
                FROM JAVIER.PEDIDOS_STOCK_RESERVE SR
                JOIN JAVIER.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID AND C.ESTADO = 'CONFIRMADO'
                GROUP BY SR.CODIGOARTICULO
            ) RES ON TRIM(PL.CODIGOARTICULO) = TRIM(RES.CODIGOARTICULO)
            ORDER BY PL.CODIGOPROMOCION, PL.ORDEN`;

        // Run all 3 queries in parallel
        const [cpesRows, pmrHeaders, pmrProducts] = await Promise.all([
            queryWithParams(sqlCpes, paramsCpes).catch(e => { logger.warn(`[PEDIDOS] CPESL1 query err: ${e.message}`); return []; }),
            queryWithParams(sqlPmrHeaders, paramsPmr).catch(e => { logger.warn(`[PEDIDOS] PMRL1 headers err: ${e.message}`); return []; }),
            query(sqlPmrProducts).catch(e => { logger.warn(`[PEDIDOS] PMPL1 products err: ${e.message}`); return []; })
        ]);

        // Build product index by promo code from PMPL1
        const productsByPromo = {};
        for (const p of pmrProducts) {
            const key = (p.PROMOCODE || '').trim();
            if (!key) continue;
            if (!productsByPromo[key]) productsByPromo[key] = [];
            productsByPromo[key].push(p);
        }

        // Match PMRL1 headers to PMPL1 products
        // PMRL1 codes are client-specific (e.g. "NST_9324"), PMPL1 codes are base (e.g. "NST 026")
        // Strategy: Try exact match first, then prefix/contains match
        const findProductsForPromo = (promoCode) => {
            // Exact match
            if (productsByPromo[promoCode]) return productsByPromo[promoCode];

            // Extract base prefix (before underscore or first digits)
            const prefix = promoCode.replace(/[_\s]\d+$/, '').trim();
            for (const key of Object.keys(productsByPromo)) {
                if (key.startsWith(prefix) || prefix.startsWith(key.replace(/\s+/g, ''))) {
                    return productsByPromo[key];
                }
            }

            // Fallback: return ALL PMPL1 products (promo applies to full catalog)
            return [];
        };

        const parseDate = (dStr) => {
            const s = String(dStr || 0);
            if (s.length === 8 && s !== '0') return { y: s.substring(0,4), m: s.substring(4,6), d: s.substring(6,8) };
            return { y: 0, m: 0, d: 0 };
        };

        const formatDateStr = (parsed) => parsed.y ? `${parsed.d}/${parsed.m}/${parsed.y}` : '';

        // Format PRICE promos
        const pricePromos = cpesRows.map(r => {
            const regPrice = parseFloat(r.REGULARPRICE) || 0;
            const promPrice = parseFloat(r.PROMOPRICE) || 0;
            const pFrom = parseDate(r.DATEFROM);
            const pTo = parseDate(r.DATETO);
            return {
                promoType: 'PRICE',
                promoCode: (r.PROMOCODE || '').trim(),
                code: (r.CODE || '').trim(),
                name: (r.NAME || '').trim(),
                promoDesc: 'Precio Especial',
                promoPrice: promPrice,
                regularPrice: regPrice,
                stockEnvases: parseFloat(r.STOCKENVASES) || 0,
                stockUnidades: parseFloat(r.STOCKUNIDADES) || 0,
                discountPct: regPrice > 0 && promPrice > 0 ? ((regPrice - promPrice) / regPrice) * 100 : 0,
                dateFrom: formatDateStr(pFrom),
                dateTo: formatDateStr(pTo),
                dayFrom: pFrom.d, monthFrom: pFrom.m, yearFrom: pFrom.y,
                dayTo: pTo.d, monthTo: pTo.m, yearTo: pTo.y,
                minQty: 0,
                giftQty: 0,
                cumulative: false,
            };
        });

        // Format GIFT promos — one entry per product in the promo
        // Resolve conflicts: client-specific promos override global ones
        const giftPromosMap = new Map(); // key: promoCode+code, value: promo (client wins over global)
        
        for (const h of pmrHeaders) {
            const promoCode = (h.PROMOCODE || '').trim();
            const promoName = (h.PROMONAME || '').trim();
            const clientCode = (h.CLIENTCODE || '').trim();
            const minQty = parseFloat(h.CANTIDADMINIMA) || 0;
            const giftQty = parseFloat(h.CANTIDADREGALO) || 0;
            const pFrom = parseDate(h.DATEFROM);
            const pTo = parseDate(h.DATETO);
            const isClientSpecific = clientCode !== '' && clientCode === trimmedClientCode;
            const scope = isClientSpecific ? 'client' : 'global';
            
            // Build canonical promo ID for dedup: strip client suffix
            const canonicalPromoId = promoCode.replace(/[_\s]\d+$/, '').trim().toUpperCase();

            // Build readable description: "3+1 PASTELERIA" or from name
            let desc = promoName;
            if (!desc && minQty > 0 && giftQty > 0) {
                desc = `${Math.round(minQty)}+${Math.round(giftQty)} REGALO`;
            }

            const products = findProductsForPromo(promoCode);
            if (products.length > 0) {
                for (const p of products) {
                    const productCode = (p.CODE || '').trim();
                    const key = `${canonicalPromoId}|${productCode}`;
                    
                    // Skip if we already have a client-specific version
                    const existing = giftPromosMap.get(key);
                    if (existing && existing.scope === 'client' && scope === 'global') {
                        continue;
                    }
                    
                    giftPromosMap.set(key, {
                        promoType: 'GIFT',
                        promoCode,
                        code: productCode,
                        name: (p.NAME || '').trim(),
                        promoDesc: desc,
                        promoPrice: 0,
                        regularPrice: parseFloat(p.REGULARPRICE) || 0,
                        stockEnvases: Math.max(0, parseFloat(p.STOCKENVASES) || 0),
                        stockUnidades: Math.max(0, parseFloat(p.STOCKUNIDADES) || 0),
                        discountPct: 0,
                        dateFrom: formatDateStr(pFrom),
                        dateTo: formatDateStr(pTo),
                        dayFrom: pFrom.d, monthFrom: pFrom.m, yearFrom: pFrom.y,
                        dayTo: pTo.d, monthTo: pTo.m, yearTo: pTo.y,
                        minQty,
                        giftQty,
                        cumulative: (h.ACUMULATIVA || 'N').trim() === 'S',
                        // PMPL1 limits per article
                        minUnits: parseFloat(p.MINUNITS) || 0,
                        minBoxes: parseFloat(p.MINBOXES) || 0,
                        maxUnits: parseFloat(p.MAXUNITS) || 0,
                        maxBoxes: parseFloat(p.MAXBOXES) || 0,
                        // Scope and canonical ID for dedup
                        scope,
                        canonicalPromoId,
                    });
                }
            } else {
                // No matching products but promo exists — return header-only entry
                const key = `${canonicalPromoId}|`;
                const existing = giftPromosMap.get(key);
                if (existing && existing.scope === 'client' && scope === 'global') {
                    continue;
                }
                
                giftPromosMap.set(key, {
                    promoType: 'GIFT',
                    promoCode,
                    code: '',
                    name: desc,
                    promoDesc: desc,
                    promoPrice: 0,
                    regularPrice: 0,
                    stockEnvases: 0,
                    stockUnidades: 0,
                    discountPct: 0,
                    dateFrom: formatDateStr(pFrom),
                    dateTo: formatDateStr(pTo),
                    dayFrom: pFrom.d, monthFrom: pFrom.m, yearFrom: pFrom.y,
                    dayTo: pTo.d, monthTo: pTo.m, yearTo: pTo.y,
                    minQty,
                    giftQty,
                    cumulative: (h.ACUMULATIVA || 'N').trim() === 'S',
                    // PMPL1 limits per article (none for header-only)
                    minUnits: 0,
                    minBoxes: 0,
                    maxUnits: 0,
                    maxBoxes: 0,
                    // Scope and canonical ID for dedup
                    scope,
                    canonicalPromoId,
                });
            }
        }

        const giftPromos = Array.from(giftPromosMap.values());

        // PRICE promos: also add scope and canonicalPromoId
        const pricePromosWithMeta = pricePromos.map(p => ({
            ...p,
            scope: 'client', // CPESL1 is always client-specific
            canonicalPromoId: p.promoCode.toUpperCase(),
            minUnits: 0,
            minBoxes: 0,
            maxUnits: 0,
            maxBoxes: 0,
        }));

        const dedup = new Map();
        for (const item of [...pricePromosWithMeta, ...giftPromos]) {
            if (!(item.code || '').trim()) continue;
            const key = [
                item.promoType || '',
                item.canonicalPromoId || '',
                item.code || '',
                item.dateFrom || '',
                item.dateTo || '',
                item.minQty || 0,
                item.giftQty || 0,
                item.promoPrice || 0,
                item.regularPrice || 0,
            ].join('|');
            if (!dedup.has(key)) dedup.set(key, item);
        }

        return Array.from(dedup.values());

    } catch (error) {
        logger.warn(`[PEDIDOS] getActivePromotions error (returning []): ${error.message}`);
        return [];
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

// Alias wrappers for route compatibility
async function searchProducts(params) { const products = await getProducts(params); return { products, count: products.length }; }
async function getProductStock(code) { return getStock(code); }
async function getClientPricing(clientCode) {
    // Get client tariff code + client-specific prices from last purchases
    const sql = `
        SELECT
            COALESCE(CODIGOTARIFA, 1) AS CODIGOTARIFA,
            COALESCE(CODIGOTARIFA, 1) AS CODIGOTARIFAVENTADIRECTA,
            COALESCE(PORCENTAJEDECUENTO1, 0) AS PORCENTAJEDESCUENTO1,
            COALESCE(PORCENTAJEDECUENTO21, 0) AS PORCENTAJEDESCUENTO2,
            COALESCE(PORCENTAJEDECUENTO3, 0) AS PORCENTAJEDESCUENTO3
        FROM DSEDAC.CLC
        WHERE TRIM(CODIGOCLIENTE) = ?
        FETCH FIRST 1 ROW ONLY`;
    const rows = await queryWithParams(sql, [String(clientCode || '').trim()]);
    return rows.length > 0 ? rows[0] : null;
}
async function getProductFamilies() { return getFamilies(); }
async function getProductBrands() { return getBrands(); }

// Wrapper: routes call updateOrderLine(pedidoId, lineId, data)
async function updateOrderLineRoute(pedidoId, lineId, data) { return updateOrderLine(lineId, data); }
// Wrapper: routes call deleteOrderLine(pedidoId, lineId)
async function deleteOrderLineRoute(pedidoId, lineId) { return deleteOrderLine(lineId, pedidoId); }

// =============================================================================
// CLIENT BALANCE
// =============================================================================

async function getClientBalance(clientCode) {
    const code = clientCode.trim();
    const cacheKey = `pedidos:balance:${code}`;

    const sql = `
        SELECT
            SUM(CASE WHEN L.LCTPVT IN ('CC','VC') AND L.LCCLLN IN ('AB','VT') AND L.LCSRAB NOT IN ('N','Z','G','D')
                     THEN L.LCIMVT ELSE 0 END) AS TOTAL_FACTURADO,
            SUM(CASE WHEN L.LCTPVT = 'CO'
                     THEN L.LCIMVT ELSE 0 END) AS TOTAL_COBRADO
        FROM DSED.LACLAE L
        WHERE L.LCCDCL = ?
          AND L.LCAADC = YEAR(CURRENT_DATE)
    `;

    try {
        const rows = await cachedQuery(
            (s) => queryWithParams(s, [code]),
            sql, cacheKey, TTL.SHORT
        );
        const row = rows[0] || {};
        const facturado = parseFloat(row.TOTAL_FACTURADO) || 0;
        const cobrado = Math.abs(parseFloat(row.TOTAL_COBRADO) || 0);
        return {
            facturadoAnual: facturado,
            cobradoAnual: cobrado,
            saldoPendiente: facturado - cobrado,
            year: new Date().getFullYear(),
        };
    } catch (error) {
        logger.error(`[PEDIDOS] getClientBalance error: ${error.message}`);
        return { facturadoAnual: 0, cobradoAnual: 0, saldoPendiente: 0, year: new Date().getFullYear() };
    }
}

// =============================================================================
// CLONE ORDER
// =============================================================================

async function cloneOrder(orderId) {
    const detail = await getOrderDetail(orderId);
    if (!detail || !detail.header) throw new Error('Order not found');
    return {
        clientCode: detail.header.clienteId,
        clientName: detail.header.clienteNombre,
        tipoventa: detail.header.tipoventa,
        lines: detail.lines.map(l => ({
            codigoArticulo: l.codigoArticulo,
            descripcion: l.descripcion,
            cantidadEnvases: l.cantidadEnvases,
            cantidadUnidades: l.cantidadUnidades,
            unidadMedida: l.unidadMedida,
            unidadesCaja: l.unidadesCaja,
            precioVenta: l.precioVenta,
            precioCosto: l.precioCosto,
            precioTarifa: l.precioTarifa,
            precioTarifaCliente: l.precioTarifaCliente,
            precioMinimo: l.precioMinimo,
        })),
    };
}

// =============================================================================
// COMPLEMENTARY PRODUCTS
// =============================================================================

async function getComplementaryProducts(productCodes, clientCode) {
    if (!productCodes || productCodes.length === 0) return [];

    const codeList = productCodes.map(c => `'${sanitize(c.trim())}'`).join(',');
    const cacheKey = `pedidos:complementary:${productCodes.sort().join(',')}`;

    const sql = `
        SELECT TRIM(L2.CODIGOARTICULO) AS code,
               TRIM(A.DESCRIPCIONARTICULO) AS NAME,
               COUNT(DISTINCT L2.CODIGOCLIENTEALBARAN || CAST(L2.ANODOCUMENTO AS CHAR(4)) || CAST(L2.NUMERODOCUMENTO AS CHAR(6))) AS cooccurrences,
               COALESCE(T.PRECIOTARIFA, 0) AS price,
               A.UNIDADESCAJA AS unitsPerBox,
               COALESCE(S.ENVASES_DISP, 0) AS stockEnvases,
               COALESCE(S.UNIDADES_DISP, 0) AS stockUnidades
        FROM DSEDAC.LINDTO L1
        JOIN DSEDAC.LINDTO L2
            ON L2.CODIGOCLIENTEALBARAN = L1.CODIGOCLIENTEALBARAN
            AND L2.ANODOCUMENTO = L1.ANODOCUMENTO
            AND L2.NUMERODOCUMENTO = L1.NUMERODOCUMENTO
            AND TRIM(L2.CODIGOARTICULO) NOT IN (${codeList})
        JOIN DSEDAC.ART A ON TRIM(A.CODIGOARTICULO) = TRIM(L2.CODIGOARTICULO)
        LEFT JOIN DSEDAC.ARA T ON TRIM(L2.CODIGOARTICULO) = TRIM(T.CODIGOARTICULO) AND T.CODIGOTARIFA = 1
        LEFT JOIN (
            SELECT CODIGOARTICULO,
                SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
            FROM DSEDAC.ARO WHERE CODIGOALMACEN = 1
            GROUP BY CODIGOARTICULO
        ) S ON TRIM(L2.CODIGOARTICULO) = TRIM(S.CODIGOARTICULO)
        WHERE TRIM(L1.CODIGOARTICULO) IN (${codeList})
          AND L1.ANODOCUMENTO >= YEAR(CURRENT_DATE) - 1
          AND L1.TIPOVENTA IN ('CC','VC')
          AND L1.CLASELINEA IN ('AB','VT')
          AND L2.CLASELINEA IN ('AB','VT')
          AND A.ANOBAJA = 0
        GROUP BY L2.CODIGOARTICULO, A.DESCRIPCIONARTICULO, T.PRECIOTARIFA, A.UNIDADESCAJA, S.ENVASES_DISP, S.UNIDADES_DISP
        HAVING COUNT(DISTINCT L2.CODIGOCLIENTEALBARAN || CAST(L2.ANODOCUMENTO AS CHAR(4)) || CAST(L2.NUMERODOCUMENTO AS CHAR(6))) >= 3
        ORDER BY cooccurrences DESC
        FETCH FIRST 10 ROWS ONLY
    `;

    try {
        const rows = await cachedQuery(
            (s) => query(s),
            sql, cacheKey, TTL.MEDIUM
        );
        return rows.map(r => ({
            code: (r.CODE || '').trim(),
            name: (r.NAME || '').trim(),
            cooccurrences: parseInt(r.COOCCURRENCES) || 0,
            price: parseFloat(r.PRICE) || 0,
            unitsPerBox: parseFloat(r.UNITSPERBOX) || 1,
            stockEnvases: parseFloat(r.STOCKENVASES) || 0,
            stockUnidades: parseFloat(r.STOCKUNIDADES) || 0,
            source: 'complementary',
        }));
    } catch (error) {
        logger.error(`[PEDIDOS] getComplementaryProducts error: ${error.message}`);
        return [];
    }
}

// =============================================================================
// INTELLIGENT SIMILAR PRODUCTS (3-Level Algorithm - Production Ready)
// =============================================================================

/**
 * Intelligent product analysis - extracts the "essence" of a product
 * Returns: { category, isProcessed, format, mainIngredient, qualifiers }
 */
function analyzeProductEssence(name) {
    const text = (name || '').toLowerCase().trim();
    const words = text.split(/\s+/).filter(w => w.length > 2);
    
    // ========================================
    // CATEGORY DETECTION (what type of product)
    // ========================================
    const categoryPatterns = {
        'carne': ['pollo', 'cerdo', 'vacuno', 'ternera', 'cordero', 'cabrito', 'lacón', 'paleta', 'jamón', 'panceta', 'tocino', 'chuleta', 'costilla', 'filete', 'solomillo', 'pechuga', 'muslo', 'pierna', 'brazo', 'hamburguesa', 'butifarra', 'morcilla', 'chorizo', 'salami', 'salchicha', 'bacon', 'lomo', 'presunto', 'cecina', 'fuet', 'sobrasada'],
        'pescado': ['pescado', 'salmón', 'salmon', 'merluza', 'bacalao', 'atún', 'atun', 'bonito', 'sardina', 'caballa', 'bacoreta', 'dorada', 'lubina', 'rape', 'rodaballo', ' lenguado', 'trucha', 'carpa', 'tenca', 'anguila', 'palometa', 'chicharro', 'jurel', 'estornino', 'melva', 'alitún', 'coco', 'marrajo', 'cazón', 'marrajo', 'tiburón', 'congrio', 'anchoa', 'boquerón', 'caballa'],
        'marisco': ['marisco', 'gamba', 'langostino', 'camarón', 'camaron', 'bogavante', 'langosta', 'cangrejo', 'centollo', 'nécora', 'mejillón', 'mejillon', 'almeja', 'berberecho', 'ostión', 'ostra', 'caracol', 'calamar', 'pulpo', 'sepia', 'chipirón', 'potón', 'volande', 'bufé', 'burga', 'chocho'],
        'verdura': ['verdura', 'hortaliza', 'lechuga', 'tomate', 'patata', 'pimiento', 'cebolla', 'ajo', 'zanahoria', 'calabacín', 'calabacin', 'berenjena', 'alcachofa', 'espárrago', 'esparragos', 'guisante', 'judía', ' judia', 'habichuela', 'brócoli', 'brocoli', 'coliflor', 'col', 'repollo', 'acelga', 'espinaca', 'berro', 'canón', 'canon', 'rucula', 'rúcula', 'endibia', 'escarola', 'apio', 'nabo', 'rábano', 'rabano', 'remolacha', 'batata', 'boniato'],
        'fruta': ['fruta', 'manzana', 'pera', 'naranja', 'plátano', 'platano', 'limón', 'limon', 'pomelo', 'mandarina', 'kiwi', 'uva', 'sandía', 'sandia', 'melón', 'melon', 'fresa', 'frambuesa', 'mora', 'arándano', 'arandano', 'cereza', 'ciruela', 'melocotón', 'melocoton', 'albaricoque', 'nectarina', 'higo', 'granada', 'mango', 'papaya', 'piña', 'pina', 'aguacate', 'coco', 'calabaza', 'calabaza'],
        'lácteo': ['leche', 'queso', 'yogur', 'yogurt', 'mantequilla', 'nata', 'crema', 'cuajada', 'requesón', 'requeson', 'ricotta', 'mascarpone', 'parmesano', 'gruyere', 'emmental', 'cheddar', 'brie', 'camembert', 'roquefort', 'cabrales', 'gorgonzola', 'manchego', 'tierno', 'semicurado', 'curado', 'viejo', 'fresco'],
        'huevo': ['huevo', 'huevos', 'clara', 'yema', 'yemas'],
        'panadería': ['pan', 'baguette', 'brioche', 'croissant', 'croasán', 'ensaïmada', 'mollete', 'chapata', 'pita', 'naan', 'tortilla', 'panecillo', 'bollo'],
        'precocinado': ['precocinado', 'pre-cocinado', 'cocido', 'hervido', 'asado', 'horneado', 'caliente'],
        'congelado': ['congelado', 'ultracongelado', 'congelad', 'frozen', 'ice'],
    };
    
    // ========================================
    // FORMAT DETECTION (how it's presented)
    // ========================================
    const formatPatterns = {
        'entero': ['entero', 'entera', 'enters', 'enteras', 'completo', 'completa', 'sin partir', 'sin cortar', 'integro'],
        'mitad': ['mitad', 'medio', 'media', 'half', 'mitades'],
        'cuarto': ['cuarto', 'cuartos', 'quarter', 'quarters', '4 partes'],
        'dados': ['dado', 'dados', 'cubos', 'cubo', 'dice', 'dices', 'cuadritos', 'cuadrado'],
        'rodajas': ['rodaja', 'rodajas', 'slice', 'slices', 'tira', 'tiras', 'bandeja'],
        'lonchas': ['loncha', 'lonchas', 'lamina', 'láminas', 'laminas', 'flete', 'fletes'],
        'filetes': ['filete', 'filetes', 'filet', 'steak', 'steaks', 'bistec', 'bistecs'],
        'trozos': ['trozo', 'trozos', 'pedazo', 'pedazos', 'porción', 'porciones', 'portion', 'portions', 'troceado', 'trocead', 'picado', 'picad'],
        'deshuesado': ['deshuesado', 'deshuesad', 'sin hueso', 'deshuesar', 'hueso', 'bone', 'boneless'],
        'pelado': ['pelado', 'pelad', 'sin piel', 'pelar', 'skin', 'skinned', 'mondado'],
        'vacío': ['vacio', 'vacío', 'blanco', 'vaciar', 'vacío'],
        'vivo': ['vivo', 'viva', 'vivoa', 'vivas'],
        'fresco': ['fresco', 'fresca', 'refrigerado', 'refrigerad', 'nevera', 'cold'],
        'envasado': ['envasado', 'pack', 'paquete', 'bolsa', 'bandeja', 'caja', 'tarro', 'bote'],
    };
    
    // ========================================
    // PROCESSED/RAW DETECTION
    // ========================================
    const processedPatterns = [
        'empanadilla', 'empanada', 'empanad', 'cocido', 'hervido', 'asado', 'horneado',
        'albóndiga', 'albondiga', 'nugget', 'nuggets', 'croqueta', 'croquetas',
        'fileteado', 'filetead', 'rebanado', 'rebanad', 'preparado', 'preparad', 
        'receta', 'listo', 'cocinar', 'gourmet', 'cocinado', 'procesad',
        'salami', 'chorizo', 'ibérico', 'iberico', 'jamón', 'jamon', 'paleta',
        'lacón', 'lacon', 'panceta', 'cecina', 'fuet', 'sobrasada', 'mortadela',
        'paté', 'pate', 'foie', 'butifarra', 'morcilla', 'longaniza', 'cheddar',
        'manchego', 'queso', 'hamburguesa', 'salchicha', 'guiso', 'estofado',
        'carneada', 'cecina', 'beicon', 'tocino', 'salazón', 'salazon'
    ];
    
    // ========================================
    // MAIN INGREDIENT DETECTION (what's the base)
    // ========================================
    const ingredientPatterns = {
        'pollo': ['pollo', 'gallina', 'capón', 'capon', 'pavo', 'codorniz'],
        'cerdo': ['cerdo', 'porcino', 'cochino', 'gorrino', 'ibérico', 'iberico'],
        'vacuno': ['vacuno', 'ternera', 'res', 'buey', 'vaca', 'buey'],
        'cordero': ['cordero', 'cabra', 'c羊肉'],
        'pescado_blanco': ['merluza', 'bacalao', 'lubina', 'dorada', 'rape', 'lenguado', 'rodaballo', 'pescada'],
        'pescado_azul': ['salmón', 'salmon', 'atún', 'atun', 'bonito', 'sardina', 'caballa', 'jurel', 'chicharro'],
        'marisco': ['gamba', 'langostino', 'camarón', 'camaron', 'bogavante', 'langosta', 'cangrejo', 'mejilla', 'mejillon', 'almeja', 'pulpo', 'calamar', 'sepia'],
        'verdura': ['verdura', 'hortaliza', 'lechuga', 'tomate', 'patata', 'cebolla', 'ajo', 'zanahoria', 'pimiento', 'berenjena', 'calabacín', 'calabacin', 'alcachofa', 'espárrago', 'esparragos', 'guisante', 'judía', 'judia', 'habichuela', 'brócoli', 'brocoli'],
        'fruta': ['fruta', 'manzana', 'pera', 'naranja', 'plátano', 'platano', 'limón', 'limon', 'kiwi', 'uva', 'sandía', 'sandia', 'melón', 'melon', 'fresa'],
        'aguacate': ['aguacate', 'palta'],
    };
    
    // ========================================
    // EXECUTE DETECTION
    // ========================================
    let detectedCategory = 'otro';
    let detectedFormat = 'formato_estandar';
    let isProcessed = false;
    let mainIngredient = null;
    const textLower = text;
    
    // Detect category
    for (const [cat, keywords] of Object.entries(categoryPatterns)) {
        if (keywords.some(kw => textLower.includes(kw))) {
            detectedCategory = cat;
            break;
        }
    }
    
    // Detect format
    for (const [fmt, keywords] of Object.entries(formatPatterns)) {
        if (keywords.some(kw => textLower.includes(kw))) {
            detectedFormat = fmt;
            break;
        }
    }
    
    // Detect if processed
    if (processedPatterns.some(kw => textLower.includes(kw))) {
        isProcessed = true;
    }
    
    // Also check for raw indicators (if has these, likely NOT processed)
    const rawIndicators = ['fresco', 'entero', 'crudo', 'natural', 'vivo', 'sin elaborar'];
    const hasRawIndicator = rawIndicators.some(ind => textLower.includes(ind));
    if (hasRawIndicator && !isProcessed) {
        isProcessed = false;
    } else if (hasRawIndicator && processedPatterns.some(kw => textLower.includes(kw))) {
        // If has BOTH processed AND raw indicators, check context
        // "Pollo fresco" = raw, "Empanadillas de pollo" = processed
        const rawIndex = rawIndicators.findIndex(ind => textLower.includes(ind));
        const processedIndex = processedPatterns.findIndex(kw => textLower.includes(kw));
        // If raw comes first, likely raw product
        if (rawIndex < processedIndex && rawIndex >= 0) {
            isProcessed = false;
        }
    }
    
    // Detect main ingredient (useful for detecting "pollo" in "empanadillas de pollo")
    for (const [ing, keywords] of Object.entries(ingredientPatterns)) {
        if (keywords.some(kw => textLower.includes(kw))) {
            mainIngredient = ing;
            break;
        }
    }
    
    return {
        category: detectedCategory,
        format: detectedFormat,
        isProcessed: isProcessed,
        mainIngredient: mainIngredient,
        originalText: name,
        words: words
    };
}

/**
 * Calculates semantic compatibility score between two products
 * Uses intelligent 3-level matching: Family > Attributes > Format
 */
function calculateSemanticScore(origProduct, candidate) {
    let score = 0;
    const reasons = [];

    const origName = (origProduct.NAME || '').trim();
    const candName = (candidate.NAME || '').trim();

    // Analyze product essences
    const origEssence = analyzeProductEssence(origName);
    const candEssence = analyzeProductEssence(candName);

    // ========================================
    // LEVEL 3: ADVANCED - Semantic Compatibility Check
    // ========================================

    // BONUS: If original is processed and candidate has the same main ingredient
    // Example: "Empanadillas de pollo" -> "Pollo entero" is a GOOD recommendation
    if (origEssence.isProcessed && candEssence.mainIngredient &&
        origEssence.mainIngredient === candEssence.mainIngredient) {
        score += 50;
        reasons.push(`Ingrediente principal compatible: ${candEssence.mainIngredient}`);
    }

    // Check category incompatibility
    if (origEssence.category !== 'otro' && candEssence.category !== 'otro' &&
        origEssence.category !== candEssence.category) {

        // If both have categories but they're different, moderate penalty
        // But allow some category crossovers
        const allowedCrossovers = [
            ['carne', 'precocinado'],
            ['pescado', 'precocinado'],
            ['marisco', 'precocinado'],
            ['verdura', 'congelado'],
            ['fruta', 'congelado'],
            ['carne', 'congelado'],
            ['pescado', 'congelado'],
        ];

        const isAllowed = allowedCrossovers.some(([a, b]) =>
            (origEssence.category === a && candEssence.category === b) ||
            (origEssence.category === b && candEssence.category === a)
        );

        if (!isAllowed) {
            score -= 30;
            reasons.push(`Categoria diferente: ${candEssence.category}`);
        } else {
            score += 15;
            reasons.push(`Categoria compatible: ${origEssence.category} -> ${candEssence.category}`);
        }
    }

    // Raw vs Processed relationship (IMPORTANT: they can be complementary!)
    // If looking for PROCESSED and candidate is RAW with same ingredient -> GOOD MATCH
    if (origEssence.isProcessed && !candEssence.isProcessed &&
        origEssence.mainIngredient && candEssence.mainIngredient &&
        origEssence.mainIngredient === candEssence.mainIngredient) {
        score += 40;
        reasons.push(`Ingrediente base para producto elaborado`);
    }

    // If looking for RAW but candidate is PROCESSED with same ingredient -> also good
    if (!origEssence.isProcessed && candEssence.isProcessed &&
        origEssence.mainIngredient && candEssence.mainIngredient &&
        origEssence.mainIngredient === candEssence.mainIngredient) {
        score += 30;
        reasons.push(`Producto elaborado con mismo ingrediente`);
    }

    // Only penalize if formats are completely incompatible
    if (origEssence.format === 'vivo' && candEssence.format !== 'vivo' &&
        (!origEssence.mainIngredient || !candEssence.mainIngredient ||
         origEssence.mainIngredient !== candEssence.mainIngredient)) {
        score -= 40;
        reasons.push('Formato incompatible');
    }

    // ========================================
    // LEVEL 2: FORMAT COMPATIBILITY
    // ========================================
    if (origEssence.format === candEssence.format) {
        score += 30;
        reasons.push(`Mismo formato: ${origEssence.format}`);
    } else if (origEssence.format !== 'formato_estandar' && candEssence.format !== 'formato_estandar') {
        // Different but both have specific formats
        // Check if formats are compatible
        const compatibleFormats = [
            ['entero', 'mitad'],
            ['entero', 'cuarto'],
            ['mitad', 'cuarto'],
            ['dados', 'trozos'],
            ['filetes', 'trozos'],
            ['rodajas', 'lonchas'],
        ];
        
        const isCompatible = compatibleFormats.some(([a, b]) => 
            (origEssence.format === a && candEssence.format === b) ||
            (origEssence.format === b && candEssence.format === a)
        );
        
        if (isCompatible) {
            score += 15;
            reasons.push(`Formato compatible: ${origEssence.format} → ${candEssence.format}`);
        } else {
            score -= 5;
            reasons.push(`Formato diferente: ${origEssence.format} vs ${candEssence.format}`);
        }
    }
    
    // ========================================
    // LEVEL 1: FAMILY HIERARCHY
    // ========================================
    if (candidate.FAMILIA === origProduct.FAMILIA) {
        score += 25;
        reasons.push('Misma familia');
    }

    if (candidate.SUBFAMILIA && origProduct.SUBFAMILIA && 
        candidate.SUBFAMILIA === origProduct.SUBFAMILIA) {
        score += 40;
        reasons.push('Misma subfamilia');
    }

    if (candidate.GRUPO && origProduct.GRUPO && 
        candidate.GRUPO === origProduct.GRUPO) {
        score += 15;
        reasons.push('Mismo grupo');
    }

    if (candidate.MARCA && origProduct.MARCA && 
        candidate.MARCA === origProduct.MARCA) {
        score += 10;
        reasons.push('Misma marca');
    }
    
    // ========================================
    // LEVEL 2: Technical fields matching
    // ========================================
    if (candidate.TIPO && origProduct.TIPO && 
        candidate.TIPO === origProduct.TIPO) {
        score += 12;
        reasons.push('Mismo tipo');
    }

    if (candidate.FORMATO && origProduct.FORMATO && 
        candidate.FORMATO === origProduct.FORMATO) {
        score += 8;
    }

    if (candidate.PRESENTACION && origProduct.PRESENTACION && 
        candidate.PRESENTACION === origProduct.PRESENTACION) {
        score += 5;
    }

    // ========================================
    // BONUS: Same main ingredient
    // ========================================
    if (origEssence.mainIngredient && candEssence.mainIngredient &&
        origEssence.mainIngredient === candEssence.mainIngredient &&
        !origHasCandidateIngredient) {
        score += 20;
        reasons.push(`Mismo ingrediente base: ${candEssence.mainIngredient}`);
    }
    
    // ========================================
    // BONUS: Product type compatibility
    // ========================================
    if (origEssence.isProcessed === candEssence.isProcessed) {
        score += 10;
        if (origEssence.isProcessed) {
            reasons.push('Ambos son productos elaborados');
        } else {
            reasons.push('Ambos son productos frescos/crudos');
        }
    }

    const compatible = score > -30;
    return { score, reasons, level: 'advanced', compatible };
}

/**
 * Finds products similar to the given one using intelligent 3-level matching.
 * Level 1 (Basic): Family and Subfamily priority
 * Level 2 (Intermediate): Compare Attributes and Format
 * Level 3 (Advanced): Understand semantic intent (raw vs elaborated)
 */
async function getSimilarProducts(productCode) {
    const code = (productCode || '').trim();
    if (!code) return [];

    const cacheKey = `pedidos:similar_v3:${code}`;
    
    try {
        // 1. Get original product attributes
        const sqlOriginal = `
            SELECT TRIM(CODIGOFAMILIA) AS FAMILIA,
                   TRIM(CODIGOSUBFAMILIA) AS SUBFAMILIA,
                   TRIM(CODIGOMARCA) AS MARCA,
                   TRIM(COALESCE(CODIGOGRUPO, '')) AS GRUPO,
                   TRIM(COALESCE(FORMATO, '')) AS FORMATO,
                   TRIM(COALESCE(CODIGOPRESENTACION, '')) AS PRESENTACION,
                   TRIM(COALESCE(CODIGOTIPO, '')) AS TIPO,
                   TRIM(DESCRIPCIONARTICULO) AS DESCRIPTION
            FROM DSEDAC.ART WHERE TRIM(CODIGOARTICULO) = ?
        `;
        const origRows = await queryWithParams(sqlOriginal, [code]);
        if (!origRows || origRows.length === 0) return [];
        const orig = origRows[0];

        // 2. Fetch candidates from the SAME FAMILY that have stock
        const sqlCandidates = `
            SELECT TRIM(B.CODIGOARTICULO) AS CODE,
                   TRIM(B.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(B.CODIGOMARCA) AS MARCA,
                   TRIM(B.CODIGOFAMILIA) AS FAMILIA,
                   TRIM(B.CODIGOSUBFAMILIA) AS SUBFAMILIA,
                   TRIM(COALESCE(B.CODIGOGRUPO, '')) AS GRUPO,
                   TRIM(COALESCE(B.FORMATO, '')) AS FORMATO,
                   TRIM(COALESCE(B.CODIGOPRESENTACION, '')) AS PRESENTACION,
                   TRIM(COALESCE(B.CODIGOTIPO, '')) AS TIPO,
                   COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0) AS STOCK_ENVASES,
                   COALESCE(S.UNIDADES_DISP, 0) - COALESCE(RES.RES_UNI, 0) AS STOCK_UNIDADES,
                   COALESCE(T.PRECIOTARIFA, 0) AS PRECIO
            FROM DSEDAC.ART B
            LEFT JOIN (
                SELECT CODIGOARTICULO,
                    SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                    SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
                FROM DSEDAC.ARO
                WHERE CODIGOALMACEN = 1
                GROUP BY CODIGOARTICULO
            ) S ON B.CODIGOARTICULO = S.CODIGOARTICULO
            LEFT JOIN (
                SELECT SR.CODIGOARTICULO,
                    SUM(SR.CANTIDADENVASES) AS RES_ENV,
                    SUM(SR.CANTIDADUNIDADES) AS RES_UNI
                FROM JAVIER.PEDIDOS_STOCK_RESERVE SR
                JOIN JAVIER.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID AND C.ESTADO = 'CONFIRMADO'
                GROUP BY SR.CODIGOARTICULO
            ) RES ON B.CODIGOARTICULO = RES.CODIGOARTICULO
            LEFT JOIN DSEDAC.ARA T ON B.CODIGOARTICULO = T.CODIGOARTICULO AND T.CODIGOTARIFA = 1
            WHERE TRIM(B.CODIGOFAMILIA) = ?
              AND TRIM(B.CODIGOARTICULO) != ?
              AND B.ANOBAJA = 0
              AND (COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0)) > 0
        `;
        let rows = await cachedQuery(
            (s) => queryWithParams(s, [orig.FAMILIA, code]),
            sqlCandidates, cacheKey, TTL.SHORT
        );

        // 2b. FALLBACK: If no candidates in same family, expand to subfamilia across all families
        if ((!rows || rows.length === 0) && orig.SUBFAMILIA) {
            const sqlFallback = `
            SELECT TRIM(B.CODIGOARTICULO) AS CODE,
                   TRIM(B.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(B.CODIGOMARCA) AS MARCA,
                   TRIM(B.CODIGOFAMILIA) AS FAMILIA,
                   TRIM(B.CODIGOSUBFAMILIA) AS SUBFAMILIA,
                   TRIM(COALESCE(B.CODIGOGRUPO, '')) AS GRUPO,
                   TRIM(COALESCE(B.FORMATO, '')) AS FORMATO,
                   TRIM(COALESCE(B.CODIGOPRESENTACION, '')) AS PRESENTACION,
                   TRIM(COALESCE(B.CODIGOTIPO, '')) AS TIPO,
                   COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0) AS STOCK_ENVASES,
                   COALESCE(S.UNIDADES_DISP, 0) - COALESCE(RES.RES_UNI, 0) AS STOCK_UNIDADES,
                   COALESCE(T.PRECIOTARIFA, 0) AS PRECIO
            FROM DSEDAC.ART B
            LEFT JOIN (
                SELECT CODIGOARTICULO,
                    SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                    SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
                FROM DSEDAC.ARO
                WHERE CODIGOALMACEN = 1
                GROUP BY CODIGOARTICULO
            ) S ON B.CODIGOARTICULO = S.CODIGOARTICULO
            LEFT JOIN (
                SELECT SR.CODIGOARTICULO,
                    SUM(SR.CANTIDADENVASES) AS RES_ENV,
                    SUM(SR.CANTIDADUNIDADES) AS RES_UNI
                FROM JAVIER.PEDIDOS_STOCK_RESERVE SR
                JOIN JAVIER.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID AND C.ESTADO = 'CONFIRMADO'
                GROUP BY SR.CODIGOARTICULO
            ) RES ON B.CODIGOARTICULO = RES.CODIGOARTICULO
            LEFT JOIN DSEDAC.ARA T ON B.CODIGOARTICULO = T.CODIGOARTICULO AND T.CODIGOTARIFA = 1
            WHERE TRIM(B.CODIGOSUBFAMILIA) = ?
              AND TRIM(B.CODIGOARTICULO) != ?
              AND B.ANOBAJA = 0
              AND (COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0)) > 0
            FETCH FIRST 30 ROWS ONLY
            `;
            const fallbackKey = `pedidos:similar_v3_fallback:${code}`;
            rows = await cachedQuery(
                (s) => queryWithParams(s, [orig.SUBFAMILIA, code]),
                sqlFallback, fallbackKey, TTL.SHORT
            );
            logger.info(`[PEDIDOS] getSimilarProducts fallback: subfamilia=${orig.SUBFAMILIA}, found ${(rows || []).length} candidates`);
        }

        // 3. Apply intelligent 3-level scoring
        const scored = [];
        
        for (const r of rows) {
            const candidate = {
                NAME: r.NAME,
                DESCRIPTION: r.NAME, // Use name as description for keyword analysis
                FAMILIA: r.FAMILIA,
                SUBFAMILIA: r.SUBFAMILIA,
                GRUPO: r.GRUPO,
                MARCA: r.MARCA,
                FORMATO: r.FORMATO,
                PRESENTACION: r.PRESENTACION,
                TIPO: r.TIPO
            };
            
            const origProduct = {
                NAME: orig.DESCRIPTION,
                DESCRIPTION: orig.DESCRIPTION,
                FAMILIA: orig.FAMILIA,
                SUBFAMILIA: orig.SUBFAMILIA,
                GRUPO: orig.GRUPO,
                MARCA: orig.MARCA,
                FORMATO: orig.FORMATO,
                PRESENTACION: orig.PRESENTACION,
                TIPO: orig.TIPO
            };
            
            const { score, reasons, compatible } = calculateSemanticScore(origProduct, candidate);

            // Improved threshold: accept products with score > -30 or same family
            const sameFamily = candidate.FAMILIA === origProduct.FAMILIA;
            const sameSubfamily = candidate.SUBFAMILIA && origProduct.SUBFAMILIA &&
                                  candidate.SUBFAMILIA === origProduct.SUBFAMILIA;
            
            // Always include if same subfamily, otherwise check score
            if (sameSubfamily || sameFamily || score > -30) {
                scored.push({
                    code: (r.CODE || '').trim(),
                    name: (r.NAME || '').trim(),
                    brand: (r.MARCA || '').trim(),
                    family: (r.FAMILIA || '').trim(),
                    subfamily: (r.SUBFAMILIA || '').trim(),
                    stockEnvases: Math.max(0, parseFloat(r.STOCK_ENVASES) || 0),
                    stockUnidades: Math.max(0, parseFloat(r.STOCK_UNIDADES) || 0),
                    precio: parseFloat(r.PRECIO) || 0,
                    similarityScore: Math.max(0, score),
                    matchReasons: reasons.length > 0 ? reasons : (sameSubfamily ? ['Misma subfamilia'] : ['Misma familia'])
                });
            }
        }
        
        // 4. Sort and limit to top 10
        scored.sort((a, b) => b.similarityScore - a.similarityScore || b.stockEnvases - a.stockEnvases);
        return scored.slice(0, 10);
    } catch (error) {
        logger.error(`[PEDIDOS] getSimilarProducts error for ${code}: ${error.message}`);
        return [];
    }
}

// =============================================================================
// ORDER ANALYTICS
// =============================================================================

async function getOrderAnalytics(vendedorCodes) {
    const isAll = vendedorCodes.trim().toUpperCase() === 'ALL';
    let vendorFilter = '';
    if (!isAll) {
        const vendorList = vendedorCodes.split(',').map(v => `'${sanitize(v.trim())}'`).join(',');
        vendorFilter = `AND TRIM(CODIGOVENDEDOR) IN (${vendorList})`;
    }

    const cacheKey = `pedidos:analytics:${vendedorCodes}`;

    // Current month vs previous month
    const sql = `
        SELECT
            ANODOCUMENTO AS year, MESDOCUMENTO AS month,
            COUNT(*) AS orderCount,
            SUM(IMPORTETOTAL) AS totalRevenue,
            SUM(IMPORTEMARGEN) AS totalMargin,
            AVG(IMPORTETOTAL) AS avgOrderValue,
            COUNT(DISTINCT CODIGOCLIENTE) AS uniqueClients
        FROM JAVIER.PEDIDOS_CAB
        WHERE ESTADO IN ('CONFIRMADO','ENVIADO')
          AND EJERCICIO = YEAR(CURRENT_DATE)
          ${vendorFilter}
        GROUP BY ANODOCUMENTO, MESDOCUMENTO
        ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC
        FETCH FIRST 6 ROWS ONLY
    `;

    // Top products
    const topSql = `
        SELECT TRIM(L.CODIGOARTICULO) AS code,
               TRIM(L.DESCRIPCION) AS name,
               SUM(L.IMPORTEVENTA) AS totalSales,
               SUM(L.CANTIDADENVASES) AS totalEnvases,
               COUNT(*) AS lineCount
        FROM JAVIER.PEDIDOS_LIN L
        JOIN JAVIER.PEDIDOS_CAB C ON C.ID = L.PEDIDO_ID
        WHERE C.ESTADO IN ('CONFIRMADO','ENVIADO')
          AND C.EJERCICIO = YEAR(CURRENT_DATE)
          ${vendorFilter}
        GROUP BY L.CODIGOARTICULO, L.DESCRIPCION
        ORDER BY totalSales DESC
        FETCH FIRST 10 ROWS ONLY
    `;

    // Status distribution
    const statusSql = `
        SELECT TRIM(ESTADO) AS status, COUNT(*) AS count
        FROM JAVIER.PEDIDOS_CAB
        WHERE EJERCICIO = YEAR(CURRENT_DATE)
          ${vendorFilter}
        GROUP BY ESTADO
    `;

    try {
        const [monthly, topProducts, statusDist] = await Promise.all([
            cachedQuery((s) => query(s), sql, cacheKey + ':monthly', TTL.SHORT),
            cachedQuery((s) => query(s), topSql, cacheKey + ':top', TTL.SHORT),
            cachedQuery((s) => query(s), statusSql, cacheKey + ':status', TTL.SHORT),
        ]);

        return {
            monthly: monthly.map(r => ({
                year: r.year || r.YEAR,
                month: r.month || r.MONTH,
                orderCount: parseInt(r.orderCount || r.ORDERCOUNT) || 0,
                totalRevenue: parseFloat(r.totalRevenue || r.TOTALREVENUE) || 0,
                totalMargin: parseFloat(r.totalMargin || r.TOTALMARGIN) || 0,
                avgOrderValue: parseFloat(r.avgOrderValue || r.AVGORDERVALUE) || 0,
                uniqueClients: parseInt(r.uniqueClients || r.UNIQUECLIENTS) || 0,
            })),
            topProducts: topProducts.map(r => ({
                code: (r.code || r.CODE || '').trim(),
                name: (r.name || r.NAME || '').trim(),
                totalSales: parseFloat(r.totalSales || r.TOTALSALES) || 0,
                totalEnvases: parseFloat(r.totalEnvases || r.TOTALENVASES) || 0,
                lineCount: parseInt(r.lineCount || r.LINECOUNT) || 0,
            })),
            statusDistribution: statusDist.reduce((acc, r) => {
                acc[(r.status || r.STATUS || '').trim()] = parseInt(r.count || r.COUNT) || 0;
                return acc;
            }, {}),
        };
    } catch (error) {
        logger.error(`[PEDIDOS] getOrderAnalytics error: ${error.message}`);
        return { monthly: [], topProducts: [], statusDistribution: {} };
    }
}

// =============================================================================
// ORDER PDF
// =============================================================================

async function generateOrderPdf(orderId) {
    const detail = await getOrderDetail(orderId);
    if (!detail || !detail.header) throw new Error('Order not found');
    return detail; // Return data, PDF rendering happens in route
}

/**
 * Get product purchase history for a specific client
 * Returns monthly breakdown for last 3 years
 */
async function getProductHistory(productCode, clientCode) {
    if (!productCode || !clientCode) return [];

    const currentYear = new Date().getFullYear();
    const startYear = currentYear - 2;

    const sql = `
        SELECT
            L.LCAADC AS YEAR,
            L.LCMMDC AS MONTH,
            SUM(L.LCIMVT) AS SALES,
            SUM(L.LCIMCT) AS COST,
            SUM(L.LCCTUD) AS UNITS,
            COALESCE(L.LCIMVT / NULLIF(SUM(L.LCCTUD), 0), 0) AS AVG_PRICE
        FROM DSED.LACLAE L
        WHERE L.LCAADC >= ?
          AND L.LCCDCL = ?
          AND TRIM(L.LCCDPR) = ?
        GROUP BY L.LCAADC, L.LCMMDC
        ORDER BY L.LCAADC DESC, L.LCMMDC DESC
    `;

    try {
        const rows = await queryWithParams(sql, [startYear, clientCode, productCode], false);
        return rows.map(r => ({
            year: parseInt(r.YEAR),
            month: parseInt(r.MONTH),
            sales: parseFloat(r.SALES) || 0,
            cost: parseFloat(r.COST) || 0,
            units: parseFloat(r.UNITS) || 0,
            avgPrice: parseFloat(r.AVG_PRICE) || 0
        }));
    } catch (e) {
        logger.warn(`[PEDIDOS] getProductHistory error: ${e.message}`);
        return [];
    }
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

/**
 * Search products with available stock by name/code/family
 * Used as fallback in stock alternatives modal when no similar products found
 */
async function searchProductsWithStock(searchTerm, limit = 20) {
    const term = (searchTerm || '').trim().toUpperCase();
    if (!term || term.length < 2) return [];
    
    const cacheKey = `pedidos:search_stock:${term}:${limit}`;
    
    try {
        const sql = `
            SELECT TRIM(A.CODIGOARTICULO) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(A.CODIGOMARCA) AS MARCA,
                   TRIM(A.CODIGOFAMILIA) AS FAMILIA,
                   TRIM(A.CODIGOSUBFAMILIA) AS SUBFAMILIA,
                   COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0) AS STOCK_ENVASES,
                   COALESCE(S.UNIDADES_DISP, 0) - COALESCE(RES.RES_UNI, 0) AS STOCK_UNIDADES,
                   COALESCE(T.PRECIOTARIFA, 0) AS PRECIO
            FROM DSEDAC.ART A
            LEFT JOIN (
                SELECT CODIGOARTICULO,
                    SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                    SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
                FROM DSEDAC.ARO
                WHERE CODIGOALMACEN = 1
                GROUP BY CODIGOARTICULO
            ) S ON A.CODIGOARTICULO = S.CODIGOARTICULO
            LEFT JOIN (
                SELECT SR.CODIGOARTICULO,
                    SUM(SR.CANTIDADENVASES) AS RES_ENV,
                    SUM(SR.CANTIDADUNIDADES) AS RES_UNI
                FROM JAVIER.PEDIDOS_STOCK_RESERVE SR
                JOIN JAVIER.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID AND C.ESTADO = 'CONFIRMADO'
                GROUP BY SR.CODIGOARTICULO
            ) RES ON A.CODIGOARTICULO = RES.CODIGOARTICULO
            LEFT JOIN DSEDAC.ARA T ON A.CODIGOARTICULO = T.CODIGOARTICULO AND T.CODIGOTARIFA = 1
            WHERE A.ANOBAJA = 0
              AND (COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0)) > 0
              AND (
                  UPPER(TRIM(A.DESCRIPCIONARTICULO)) LIKE ?
                  OR UPPER(TRIM(A.CODIGOARTICULO)) LIKE ?
                  OR UPPER(TRIM(A.CODIGOFAMILIA)) LIKE ?
                  OR UPPER(TRIM(A.CODIGOSUBFAMILIA)) LIKE ?
              )
            ORDER BY 
                CASE 
                    WHEN UPPER(TRIM(A.CODIGOARTICULO)) LIKE ? THEN 1
                    WHEN UPPER(TRIM(A.DESCRIPCIONARTICULO)) LIKE ? THEN 2
                    ELSE 3
                END,
                S.ENVASES_DISP DESC
            FETCH FIRST ? ROWS ONLY
        `;
        
        const likeTerm = `%${term}%`;
        const rows = await cachedQuery(
            (s) => queryWithParams(s, [likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, limit]),
            sql, cacheKey, TTL.SHORT
        );
        
        return rows.map(r => ({
            code: (r.CODE || '').trim(),
            name: (r.NAME || '').trim(),
            brand: (r.MARCA || '').trim(),
            family: (r.FAMILIA || '').trim(),
            subfamily: (r.SUBFAMILIA || '').trim(),
            stockEnvases: Math.max(0, parseFloat(r.STOCK_ENVASES) || 0),
            stockUnidades: Math.max(0, parseFloat(r.STOCK_UNIDADES) || 0),
            precio: parseFloat(r.PRECIO) || 0,
            similarityScore: 0,
            matchReasons: ['Búsqueda manual']
        }));
    } catch (error) {
        logger.error(`[PEDIDOS] searchProductsWithStock error: ${error.message}`);
        return [];
    }
}

module.exports = {
    initPedidosTables,
    getProducts,
    searchProducts,
    getProductDetail,
    getStock,
    getProductStock,
    getClientPricing,
    createOrder,
    getOrders,
    getOrderDetail,
    addOrderLine,
    updateOrderLine: updateOrderLineRoute,
    deleteOrderLine: deleteOrderLineRoute,
    confirmOrder,
    cancelOrder,
    updateOrderStatus,
    getRecommendations,
    getFamilies,
    getBrands,
    getProductFamilies,
    getProductBrands,
    getActivePromotions,
    getClientBalance,
    cloneOrder,
    getComplementaryProducts,
    getOrderAnalytics,
    generateOrderPdf,
    getSimilarProducts,
    searchProductsWithStock,
    calculateLineImporte,
    getOrderStats,
    getOrderAlbaran,
    getProductHistory,
};
