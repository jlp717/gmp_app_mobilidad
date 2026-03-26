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
    let where = 'WHERE A.ANOBAJA = 0';

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
            COALESCE(T2.PRECIOTARIFA, 0) AS precioMinimo
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
        ${where}
        ORDER BY A.DESCRIPCIONARTICULO
        OFFSET ? ROWS FETCH FIRST ? ROWS ONLY`;

    params.push(offset, limit);

    const cacheKey = `pedidos:products:${search || ''}:${family || ''}:${marca || ''}:${offset}:${limit}`;

    try {
        const rows = await cachedQuery(
            (sql) => queryWithParams(sql, params),
            sql,
            cacheKey,
            TTL.SHORT // 5 min
        );
        return rows.map(r => ({
            code: (r.CODE || '').trim(),
            name: (r.NAME || '').trim(),
            brand: (r.BRAND || '').trim(),
            family: (r.FAMILY || '').trim(),
            ean: (r.EAN || '').trim(),
            unitsPerBox: parseFloat(r.UNITSPERBOX) || 1,
            unitsFraction: parseFloat(r.UNITSFRACTION) || 0,
            unitsRetractil: parseFloat(r.UNITSRETRACTIL) || 0,
            unitMeasure: (r.UNITMEASURE || '').trim(),
            weight: parseFloat(r.WEIGHT) || 0,
            stockEnvases: parseFloat(r.STOCKENVASES) || 0,
            stockUnidades: parseFloat(r.STOCKUNIDADES) || 0,
            precioTarifa1: parseFloat(r.PRECIOTARIFA1) || 0,
            precioMinimo: parseFloat(r.PRECIOMINIMO) || 0,
        }));
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
        const [baseRows, tariffRows, stockRows] = await Promise.all([
            queryWithParams(baseSql, [trimCode]),
            queryWithParams(tariffSql, [trimCode]),
            queryWithParams(stockSql, [trimCode]),
        ]);

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
        product.tariffs = (tariffRows || []).map(t => ({
            code: t.CODIGOTARIFA,
            description: (t.TARIFADESC || '').trim(),
            price: parseFloat(t.PRECIOTARIFA) || 0,
        }));
        product.stock = (stockRows || []).map(s => ({
            almacen: s.CODIGOALMACEN,
            almacenDesc: (s.ALMACENDESC || '').trim(),
            envases: parseFloat(s.ENVASES) || 0,
            unidades: parseFloat(s.UNIDADES) || 0,
        }));

        // Client-specific price from most recent sale
        if (clientCode) {
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
            product.precioCliente = priceRows && priceRows.length > 0
                ? parseFloat(priceRows[0].PRECIOCLIENTE) || 0
                : null;
        }

        return product;
    } catch (error) {
        logger.error(`[PEDIDOS] getProductDetail error: ${error.message}`);
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
    // Try update first (atomic increment)
    const upd = await queryWithParams(
        `UPDATE JAVIER.PEDIDOS_SEQ SET ULTIMO_NUMERO = ULTIMO_NUMERO + 1 WHERE EJERCICIO = ?`,
        [ejercicio], false
    );

    // If no row existed, insert initial value
    if (!upd || upd.count === 0) {
        try {
            await queryWithParams(
                `INSERT INTO JAVIER.PEDIDOS_SEQ (EJERCICIO, ULTIMO_NUMERO) VALUES (?, 1)`,
                [ejercicio], false
            );
        } catch (e) {
            // Concurrent insert race — retry the update
            await queryWithParams(
                `UPDATE JAVIER.PEDIDOS_SEQ SET ULTIMO_NUMERO = ULTIMO_NUMERO + 1 WHERE EJERCICIO = ?`,
                [ejercicio], false
            );
        }
    }

    const rows = await queryWithParams(
        `SELECT ULTIMO_NUMERO FROM JAVIER.PEDIDOS_SEQ WHERE EJERCICIO = ?`,
        [ejercicio], false
    );
    return rows[0]?.ULTIMO_NUMERO || 1;
}

// ============================================================================
// CREATE ORDER
// ============================================================================

async function createOrder({ clientCode, clientName, vendedorCode, tipoventa = 'CC', almacen = 1, tarifa = 1, formaPago = '02', observaciones = '', lines = [] }) {
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

    // Insert header
    const cabSql = `
        INSERT INTO JAVIER.PEDIDOS_CAB (
            EJERCICIO, NUMEROPEDIDO, DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO, HORADOCUMENTO,
            CODIGOCLIENTE, NOMBRECLIENTE, CODIGOVENDEDOR, CODIGOFORMAPAGO,
            CODIGOTARIFA, CODIGOALMACEN, TIPOVENTA, OBSERVACIONES
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const cabParams = [
        ejercicio, numeroPedido, dia, mes, ano, hora,
        clientCode.trim(), (clientName || '').substring(0, 60), (vendedorCode || '').split(',')[0].trim().substring(0, 2),
        formaPago, tarifa, almacen, tipoventa, (observaciones || '').substring(0, 200)
    ];

    await queryWithParams(cabSql, cabParams, false);

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
        const importeVenta = parseFloat(ln.importeVenta) || (parseFloat(ln.cantidad || 0) * parseFloat(ln.precio || 0));
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
            parseFloat(ln.cantidadEnvases) || 0, parseFloat(ln.cantidad || ln.cantidadUnidades) || 0,
            ln.unidadMedida || 'CAJAS', parseFloat(ln.unidadesCaja) || 1,
            parseFloat(ln.precio || ln.precioVenta) || 0, parseFloat(ln.precioCosto) || 0,
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

async function getOrders({ vendedorCodes, status, year, month, dateFrom, dateTo, limit = 50, offset = 0 }) {
    if (!vendedorCodes) throw new Error('vendedorCodes is required');

    const isAll = vendedorCodes.trim().toUpperCase() === 'ALL';

    let sql = `
        SELECT ID, EJERCICIO, NUMEROPEDIDO, SERIEPEDIDO,
            DIADOCUMENTO, MESDOCUMENTO, ANODOCUMENTO,
            TRIM(CODIGOCLIENTE) AS CODIGOCLIENTE,
            TRIM(NOMBRECLIENTE) AS NOMBRECLIENTE,
            TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR,
            TRIM(TIPOVENTA) AS TIPOVENTA,
            TRIM(ESTADO) AS ESTADO,
            IMPORTETOTAL, IMPORTEBASE, IMPORTECOSTO, IMPORTEMARGEN,
            TRIM(OBSERVACIONES) AS OBSERVACIONES,
            CREATED_AT, UPDATED_AT
        FROM JAVIER.PEDIDOS_CAB
        WHERE 1=1`;

    if (!isAll) {
        const vendorList = vendedorCodes.split(',').map(v => `'${sanitize(v.trim())}'`).join(',');
        sql += ` AND TRIM(CODIGOVENDEDOR) IN (${vendorList})`;
    }

    if (status) {
        sql += ` AND TRIM(ESTADO) = '${sanitize(status)}'`;
    }

    // Date filters
    let dateFilterApplied = false;
    if (dateFrom && dateTo) {
        const fromInt = parseInt(String(dateFrom).replace(/-/g, ''));
        const toInt = parseInt(String(dateTo).replace(/-/g, ''));
        if (!isNaN(fromInt) && !isNaN(toInt)) {
            sql += ` AND (ANODOCUMENTO * 10000 + MESDOCUMENTO * 100 + DIADOCUMENTO) BETWEEN ${fromInt} AND ${toInt}`;
            dateFilterApplied = true;
        }
    }

    if (!dateFilterApplied) {
        const currentYear = year || new Date().getFullYear();
        sql += ` AND EJERCICIO = ${parseInt(currentYear)}`;
        if (month) {
            sql += ` AND MESDOCUMENTO = ${parseInt(month)}`;
        }
    }

    sql += ` ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC, NUMEROPEDIDO DESC`;
    sql += ` OFFSET ${parseInt(offset)} ROWS FETCH FIRST ${parseInt(limit)} ROWS ONLY`;

    try {
        const rows = await query(sql);
        const orders = rows.map(r => ({
            id: r.ID,
            ejercicio: r.EJERCICIO,
            numeroPedido: r.NUMEROPEDIDO,
            serie: r.SERIEPEDIDO,
            fecha: `${String(r.DIADOCUMENTO).padStart(2, '0')}/${String(r.MESDOCUMENTO).padStart(2, '0')}/${r.ANODOCUMENTO}`,
            clienteCode: r.CODIGOCLIENTE,
            clienteName: r.NOMBRECLIENTE || `Cliente ${r.CODIGOCLIENTE}`,
            vendedorCode: r.CODIGOVENDEDOR,
            tipoventa: r.TIPOVENTA,
            estado: r.ESTADO,
            total: parseFloat(r.IMPORTETOTAL) || 0,
            base: parseFloat(r.IMPORTEBASE) || 0,
            costo: parseFloat(r.IMPORTECOSTO) || 0,
            margen: parseFloat(r.IMPORTEMARGEN) || 0,
            observaciones: r.OBSERVACIONES,
            createdAt: r.CREATED_AT,
            updatedAt: r.UPDATED_AT,
        }));
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

    const cantidad = parseFloat(lineData.cantidad || lineData.cantidadUnidades) || 0;
    const precio = parseFloat(lineData.precio || lineData.precioVenta) || 0;
    const precioCosto = parseFloat(lineData.precioCosto) || 0;
    const importeVenta = cantidad * precio;
    const importeCosto = cantidad * precioCosto;
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
        parseFloat(lineData.cantidadEnvases) || 0, cantidad,
        lineData.unidadMedida || 'CAJAS', parseFloat(lineData.unidadesCaja) || 1,
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

async function updateOrderLine(lineId, { cantidad, precio, unidadMedida, precioCosto }) {
    const id = parseInt(lineId);
    if (isNaN(id)) throw new Error('Invalid lineId');

    // Fetch current line to get pedidoId and defaults
    const currentRows = await queryWithParams(
        `SELECT PEDIDO_ID, CANTIDADUNIDADES, PRECIOVENTA, PRECIOCOSTO, UNIDADMEDIDA FROM JAVIER.PEDIDOS_LIN WHERE ID = ?`,
        [id]
    );
    if (!currentRows || currentRows.length === 0) throw new Error('Line not found');

    const current = currentRows[0];
    const pedidoId = current.PEDIDO_ID;

    const newCantidad = cantidad != null ? parseFloat(cantidad) : parseFloat(current.CANTIDADUNIDADES) || 0;
    const newPrecio = precio != null ? parseFloat(precio) : parseFloat(current.PRECIOVENTA) || 0;
    const newCosto = precioCosto != null ? parseFloat(precioCosto) : parseFloat(current.PRECIOCOSTO) || 0;
    const newUM = unidadMedida || current.UNIDADMEDIDA;

    const importeVenta = newCantidad * newPrecio;
    const importeCosto = newCantidad * newCosto;
    const importeMargen = importeVenta - importeCosto;
    const pctMargen = importeVenta > 0 ? ((importeMargen / importeVenta) * 100) : 0;

    await queryWithParams(
        `UPDATE JAVIER.PEDIDOS_LIN SET
            CANTIDADUNIDADES = ?, PRECIOVENTA = ?, PRECIOCOSTO = ?, UNIDADMEDIDA = ?,
            IMPORTEVENTA = ?, IMPORTECOSTO = ?, IMPORTEMARGEN = ?, PORCENTAJEMARGEN = ?
        WHERE ID = ?`,
        [newCantidad, newPrecio, newCosto, newUM, importeVenta, importeCosto, importeMargen,
            Math.round(pctMargen * 100) / 100, id],
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
    const id = parseInt(pedidoId);
    await queryWithParams(
        `UPDATE JAVIER.PEDIDOS_CAB SET
            IMPORTEBASE = (SELECT COALESCE(SUM(IMPORTEVENTA), 0) FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID = ?),
            IMPORTECOSTO = (SELECT COALESCE(SUM(IMPORTECOSTO), 0) FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID = ?),
            IMPORTEMARGEN = (SELECT COALESCE(SUM(IMPORTEMARGEN), 0) FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID = ?),
            IMPORTETOTAL = (SELECT COALESCE(SUM(IMPORTEVENTA), 0) FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID = ?),
            UPDATED_AT = CURRENT_TIMESTAMP
        WHERE ID = ?`,
        [id, id, id, id, id], false
    );
}

// ============================================================================
// CONFIRM / CANCEL
// ============================================================================

async function confirmOrder(orderId, saleType) {
    const id = parseInt(orderId);
    if (isNaN(id)) throw new Error('Invalid orderId');

    // Validate stock for all lines
    const lines = await queryWithParams(
        `SELECT CODIGOARTICULO, CANTIDADENVASES, CANTIDADUNIDADES, DESCRIPCION
         FROM JAVIER.PEDIDOS_LIN WHERE PEDIDO_ID = ?`, [id]);

    const stockWarnings = [];
    for (const line of lines) {
        const code = (line.CODIGOARTICULO || '').trim();
        if (!code) continue;
        try {
            const stock = await getStock(code);
            const reqEnvases = parseFloat(line.CANTIDADENVASES) || 0;
            const reqUnidades = parseFloat(line.CANTIDADUNIDADES) || 0;
            if (reqEnvases > 0 && reqEnvases > stock.envases) {
                stockWarnings.push({
                    product: code,
                    description: (line.DESCRIPCION || '').trim(),
                    requested: reqEnvases,
                    available: stock.envases,
                    unit: 'envases'
                });
            }
            if (reqUnidades > 0 && reqUnidades > stock.unidades) {
                stockWarnings.push({
                    product: code,
                    description: (line.DESCRIPCION || '').trim(),
                    requested: reqUnidades,
                    available: stock.unidades,
                    unit: 'unidades'
                });
            }
        } catch (e) {
            logger.warn(`[PEDIDOS] Stock check failed for ${code}: ${e.message}`);
        }
    }

    // Proceed with confirmation
    const params = [id];
    let sql = `UPDATE JAVIER.PEDIDOS_CAB SET ESTADO = 'CONFIRMADO', UPDATED_AT = CURRENT_TIMESTAMP`;
    if (saleType) {
        sql += `, TIPOVENTA = ?`;
        params.unshift(saleType.trim());
    }
    sql += ` WHERE ID = ?`;

    await queryWithParams(sql, params, false);

    // ── Stock reservation: insert rows for each line ──
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
        logger.warn(`[PEDIDOS] Stock reservation error (non-fatal): ${resErr.message}`);
    }

    const order = await getOrderDetail(id);

    return { ...order, stockWarnings };
}

async function cancelOrder(orderId) {
    const id = parseInt(orderId);
    if (isNaN(id)) throw new Error('Invalid orderId');

    await queryWithParams(
        `UPDATE JAVIER.PEDIDOS_CAB SET ESTADO = 'ANULADO', UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = ?`,
        [id], false
    );
    // Release stock reservations
    try {
        await queryWithParams(`DELETE FROM JAVIER.PEDIDOS_STOCK_RESERVE WHERE PEDIDO_ID = ?`, [id], false);
        logger.info(`[PEDIDOS] Stock reservations released for cancelled order #${id}`);
    } catch (e) {
        logger.warn(`[PEDIDOS] Stock reservation release error: ${e.message}`);
    }
    return getOrderDetail(id);
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
        const now = new Date();
        const today = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate(); // YYYYMMDD

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
                   'Precio Especial' AS PROMODESC
            FROM DSEDAC.CPESL1 P
            JOIN DSEDAC.ART A ON P.CODIGOARTICULO = A.CODIGOARTICULO
            LEFT JOIN DSEDAC.ARA T ON P.CODIGOARTICULO = T.CODIGOARTICULO AND T.CODIGOTARIFA = 1
            LEFT JOIN (
                SELECT CODIGOARTICULO,
                    SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                    SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
                FROM DSEDAC.ARO
                WHERE CODIGOALMACEN = 1
                GROUP BY CODIGOARTICULO
            ) S ON P.CODIGOARTICULO = S.CODIGOARTICULO
            LEFT JOIN (
                SELECT SR.CODIGOARTICULO,
                    SUM(SR.CANTIDADENVASES) AS RES_ENV,
                    SUM(SR.CANTIDADUNIDADES) AS RES_UNI
                FROM JAVIER.PEDIDOS_STOCK_RESERVE SR
                JOIN JAVIER.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID AND C.ESTADO = 'CONFIRMADO'
                GROUP BY SR.CODIGOARTICULO
            ) RES ON P.CODIGOARTICULO = RES.CODIGOARTICULO
            WHERE P.C9INFC <= ? AND P.C9FIFC >= ?`;

        if (clientCode) {
            sqlCpes += ` AND TRIM(P.CODIGOCLIENTE) = ?`;
            paramsCpes.push(clientCode.trim());
        }

        const paramsPmr = [today, today];
        let sqlPmr = `
            SELECT 'GIFT' AS PROMOTYPE,
                   TRIM(PL.CODIGOARTICULO) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   0 AS PROMOPRICE,
                   COALESCE(T.PRECIOTARIFA, 0) AS REGULARPRICE,
                   COALESCE(S.ENVASES_DISP, 0) - COALESCE(RES.RES_ENV, 0) AS STOCKENVASES,
                   COALESCE(S.UNIDADES_DISP, 0) - COALESCE(RES.RES_UNI, 0) AS STOCKUNIDADES,
                   H.P1INFC AS DATEFROM, H.P1FNFC AS DATETO,
                   TRIM(H.NOMBREPROMOCIONREGALO) AS PROMODESC
            FROM DSEDAC.PMRL1 H
            JOIN DSEDAC.PMPL1 PL ON TRIM(H.CODIGOPROMOCIONREGALO) = TRIM(PL.CODIGOPROMOCION)
            JOIN DSEDAC.ART A ON PL.CODIGOARTICULO = A.CODIGOARTICULO
            LEFT JOIN DSEDAC.ARA T ON A.CODIGOARTICULO = T.CODIGOARTICULO AND T.CODIGOTARIFA = 1
            LEFT JOIN (
                SELECT CODIGOARTICULO,
                    SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                    SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
                FROM DSEDAC.ARO
                WHERE CODIGOALMACEN = 1
                GROUP BY CODIGOARTICULO
            ) S ON PL.CODIGOARTICULO = S.CODIGOARTICULO
            LEFT JOIN (
                SELECT SR.CODIGOARTICULO,
                    SUM(SR.CANTIDADENVASES) AS RES_ENV,
                    SUM(SR.CANTIDADUNIDADES) AS RES_UNI
                FROM JAVIER.PEDIDOS_STOCK_RESERVE SR
                JOIN JAVIER.PEDIDOS_CAB C ON SR.PEDIDO_ID = C.ID AND C.ESTADO = 'CONFIRMADO'
                GROUP BY SR.CODIGOARTICULO
            ) RES ON PL.CODIGOARTICULO = RES.CODIGOARTICULO
            WHERE H.P1INFC <= ? AND H.P1FNFC >= ?`;

        if (clientCode) {
            sqlPmr += ` AND TRIM(H.CODIGOCLIENTE) = ?`;
            paramsPmr.push(clientCode.trim());
        }

        // Run in parallel
        const [cpesRows, pmrRows] = await Promise.all([
            queryWithParams(sqlCpes, paramsCpes).catch(e => { logger.warn(`[PEDIDOS] CPESL1 query err: ${e.message}`); return []; }),
            queryWithParams(sqlPmr, paramsPmr).catch(e => { logger.warn(`[PEDIDOS] PMRL1 query err: ${e.message}`); return []; })
        ]);

        const formatRow = (r) => {
            const regPrice = parseFloat(r.REGULARPRICE) || 0;
            const promPrice = parseFloat(r.PROMOPRICE) || 0;
            const stockEnvases = parseFloat(r.STOCKENVASES) || 0;
            const stockUnidades = parseFloat(r.STOCKUNIDADES) || 0;
            let discount = 0;
            if (regPrice > 0 && promPrice > 0 && r.PROMOTYPE === 'PRICE') {
                discount = ((regPrice - promPrice) / regPrice) * 100;
            }

            // Convert YYYYMMDD to DD/MM/YYYY parts
            const dFrom = (r.DATEFROM || 0).toString();
            const dTo = (r.DATETO || 0).toString();
            const parseDate = (dStr) => {
                if (dStr.length === 8) return { y: dStr.substring(0,4), m: dStr.substring(4,6), d: dStr.substring(6,8) };
                return { y: 0, m: 0, d: 0 };
            };
            const pFrom = parseDate(dFrom);
            const pTo = parseDate(dTo);
            const dateFrom = pFrom.y ? `${pFrom.d}/${pFrom.m}/${pFrom.y}` : '';
            const dateTo = pTo.y ? `${pTo.d}/${pTo.m}/${pTo.y}` : '';

            return {
                promoType: r.PROMOTYPE,
                code: r.CODE || '',
                name: r.NAME || '',
                promoDesc: r.PROMODESC || '',
                promoPrice: promPrice,
                regularPrice: regPrice,
                stockEnvases,
                stockUnidades,
                discountPct: discount,
                dateFrom,
                dateTo,
                dayFrom: pFrom.d, monthFrom: pFrom.m, yearFrom: pFrom.y,
                dayTo: pTo.d, monthTo: pTo.m, yearTo: pTo.y
            };
        };

        const allPromos = [...cpesRows, ...pmrRows].map(formatRow);
        return allPromos;

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
    const sql = `SELECT CODIGOTARIFA, CODIGOTARIFAVENTADIRECTA,
        PORCENTAJEDESCUENTO1, PORCENTAJEDESCUENTO2, PORCENTAJEDESCUENTO3
        FROM DSEDAC.CLI WHERE CODIGOCLIENTE = ?`;
    const rows = await queryWithParams(sql, [clientCode]);
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
               COUNT(DISTINCT L2.CODIGOCLIENTEALBARAN || CAST(L2.ANODOCUMENTO AS CHAR(4)) || CAST(L2.NUMERODOCUMENTO AS CHAR(6))) AS cooccurrences
        FROM DSEDAC.LINDTO L1
        JOIN DSEDAC.LINDTO L2
            ON L2.CODIGOCLIENTEALBARAN = L1.CODIGOCLIENTEALBARAN
            AND L2.ANODOCUMENTO = L1.ANODOCUMENTO
            AND L2.NUMERODOCUMENTO = L1.NUMERODOCUMENTO
            AND TRIM(L2.CODIGOARTICULO) NOT IN (${codeList})
        JOIN DSEDAC.ART A ON TRIM(A.CODIGOARTICULO) = TRIM(L2.CODIGOARTICULO)
        WHERE TRIM(L1.CODIGOARTICULO) IN (${codeList})
          AND L1.ANODOCUMENTO >= YEAR(CURRENT_DATE) - 1
          AND L1.TIPOVENTA IN ('CC','VC')
          AND L1.CLASELINEA IN ('AB','VT')
          AND L2.CLASELINEA IN ('AB','VT')
          AND A.ANOBAJA = 0
        GROUP BY L2.CODIGOARTICULO, A.DESCRIPCION
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
            source: 'complementary',
        }));
    } catch (error) {
        logger.error(`[PEDIDOS] getComplementaryProducts error: ${error.message}`);
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
};
