/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WAREHOUSE ROUTES — API para Almacén / Expediciones / Load Planner 3D
 * ═══════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query, queryWithParams, getPool } = require('../config/db');
const { cachedQuery } = require('../services/query-optimizer');
const { TTL } = require('../services/redis-cache');
const { sanitizeForSQL } = require('../utils/common');
const loadPlanner = require('../services/loadPlanner');

// ═════════════════════════════════════════════════════════════════════════════
// AUTO-CREATE JAVIER.* WAREHOUSE TABLES (safe, idempotent)
// ═════════════════════════════════════════════════════════════════════════════

/** Returns true if an error indicates a missing table (DB2 SQL0204 / ODBC 42S02) */
function isTableNotFound(err) {
    const msg = (err.message || '').toLowerCase();
    const codes = (err.odbcErrors || []).map(e => e.code);
    const states = (err.odbcErrors || []).map(e => e.state);
    return codes.includes(-204) || states.includes('42S02') || msg.includes('sql0204');
}

/**
 * Try to create a table. Silently ignore if it already exists (SQL0601).
 * Uses DIRECT pool connections to avoid the query() retry/pool-recreation logic.
 * IMPORTANT: Gets a FRESH connection for DDL because DB2 for i leaves
 * the connection in a dirty state after a failed SQL statement.
 */
async function safeCreateTable(name, ddl) {
    const pool = getPool();
    if (!pool) { logger.warn(`⚠️ Cannot verify ${name}: no DB pool`); return; }
    let conn;
    try {
        conn = await pool.connect();
        await conn.query(`SELECT 1 FROM ${name} FETCH FIRST 1 ROWS ONLY`);
        // Table exists — nothing to do
    } catch (probeErr) {
        // Close dirty connection first
        if (conn) try { await conn.close(); } catch (_) { }
        conn = null;

        if (!isTableNotFound(probeErr)) return; // some other error, skip

        // Get FRESH connection for DDL
        try {
            conn = await pool.connect();
            await conn.query(ddl);
            logger.info(`✅ Created table ${name}`);
        } catch (createErr) {
            if ((createErr.message || '').includes('SQL0601')) {
                // already exists (race condition) — fine
            } else {
                const odbcDetail = (createErr.odbcErrors || []).map(e => `[${e.code}/${e.state}] ${e.message}`).join('; ');
                logger.warn(`⚠️ Could not create ${name}: ${odbcDetail || createErr.message}`);
            }
        }
    } finally {
        if (conn) try { await conn.close(); } catch (_) { }
    }
}

// ─── Table initialization (called once from server.js startServer) ───────────
let _tablesInitialized = false;

async function initWarehouseTables() {
    if (_tablesInitialized) return;
    _tablesInitialized = true;

    logger.info('🔧 Warehouse: verifying tables…');

    const tables = [
        {
            name: 'JAVIER.ALMACEN_CAMIONES_CONFIG', ddl: `
            CREATE TABLE JAVIER.ALMACEN_CAMIONES_CONFIG (
                CODIGOVEHICULO VARCHAR(10) NOT NULL PRIMARY KEY,
                LARGO_INTERIOR_CM DECIMAL(8,2),
                ANCHO_INTERIOR_CM DECIMAL(8,2),
                ALTO_INTERIOR_CM  DECIMAL(8,2),
                TOLERANCIA_EXCESO DECIMAL(5,2) DEFAULT 5,
                NOTAS             VARCHAR(250) DEFAULT '',
                UPDATED_AT        TIMESTAMP DEFAULT CURRENT TIMESTAMP,
                UPDATED_BY        VARCHAR(20) DEFAULT 'SYSTEM'
            )` },
        {
            name: 'JAVIER.ALMACEN_ART_DIMENSIONES', ddl: `
            CREATE TABLE JAVIER.ALMACEN_ART_DIMENSIONES (
                CODIGOARTICULO VARCHAR(20) NOT NULL PRIMARY KEY,
                LARGO_CM       DECIMAL(8,2),
                ANCHO_CM       DECIMAL(8,2),
                ALTO_CM        DECIMAL(8,2),
                PESO_CAJA_KG   DECIMAL(8,2),
                NOTAS          VARCHAR(200) DEFAULT '',
                UPDATED_AT     TIMESTAMP DEFAULT CURRENT TIMESTAMP,
                UPDATED_BY     VARCHAR(20) DEFAULT 'SYSTEM'
            )` },
        {
            name: 'JAVIER.ALMACEN_PERSONAL', ddl: `
            CREATE TABLE JAVIER.ALMACEN_PERSONAL (
                ID              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                NOMBRE          VARCHAR(100) NOT NULL,
                CODIGO_VENDEDOR VARCHAR(20) DEFAULT '',
                ROL             VARCHAR(30) DEFAULT 'PREPARADOR',
                ACTIVO          CHAR(1) DEFAULT 'S',
                TELEFONO        VARCHAR(20) DEFAULT '',
                EMAIL           VARCHAR(100) DEFAULT '',
                CREATED_AT      TIMESTAMP DEFAULT CURRENT TIMESTAMP,
                UPDATED_AT      TIMESTAMP DEFAULT CURRENT TIMESTAMP
            )` },
        {
            name: 'JAVIER.ALMACEN_CARGA_HISTORICO', ddl: `
            CREATE TABLE JAVIER.ALMACEN_CARGA_HISTORICO (
                ID                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                CODIGOVEHICULO      VARCHAR(10) NOT NULL,
                FECHA_PLANIFICACION DATE,
                PESO_TOTAL_KG       DECIMAL(10,2),
                VOLUMEN_TOTAL_CM3   DECIMAL(14,2),
                PCT_VOLUMEN         DECIMAL(5,2),
                PCT_PESO            DECIMAL(5,2),
                NUM_ORDENES         INTEGER,
                NUM_BULTOS          INTEGER,
                ESTADO              VARCHAR(20),
                CREATED_BY          VARCHAR(20) DEFAULT 'SYSTEM',
                CREATED_AT          TIMESTAMP DEFAULT CURRENT TIMESTAMP
            )` },
        {
            name: 'JAVIER.ALMACEN_CARGA_MANUAL', ddl: `
            CREATE TABLE JAVIER.ALMACEN_CARGA_MANUAL (
                ID             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                CODIGOVEHICULO VARCHAR(10)    NOT NULL,
                FECHA_CARGA    DATE           NOT NULL,
                VENDEDOR       VARCHAR(10)    DEFAULT '',
                LAYOUT_JSON    CLOB(1M)       DEFAULT '',
                METRICS_JSON   VARCHAR(4000)  DEFAULT '{}',
                CREATED_AT     TIMESTAMP      DEFAULT CURRENT TIMESTAMP,
                UPDATED_AT     TIMESTAMP      DEFAULT CURRENT TIMESTAMP
            )` },
        {
            name: 'JAVIER.ALMACEN_CONFIG_GLOBAL', ddl: `
            CREATE TABLE JAVIER.ALMACEN_CONFIG_GLOBAL (
                CLAVE         VARCHAR(50) NOT NULL PRIMARY KEY,
                VALOR         VARCHAR(200) NOT NULL DEFAULT '',
                DESCRIPCION   VARCHAR(200) DEFAULT '',
                UPDATED_AT    TIMESTAMP DEFAULT CURRENT TIMESTAMP,
                UPDATED_BY    VARCHAR(20) DEFAULT 'SYSTEM'
            )` },
    ];

    for (const t of tables) {
        await safeCreateTable(t.name, t.ddl);
    }

    // ── Safe ALTER TABLE for new columns ──
    const alterCols = [
        { table: 'JAVIER.ALMACEN_ART_DIMENSIONES', col: 'FRAGIL', ddl: `ALTER TABLE JAVIER.ALMACEN_ART_DIMENSIONES ADD COLUMN FRAGIL CHAR(1) DEFAULT 'N'` },
        { table: 'JAVIER.ALMACEN_ART_DIMENSIONES', col: 'APILABLE', ddl: `ALTER TABLE JAVIER.ALMACEN_ART_DIMENSIONES ADD COLUMN APILABLE CHAR(1) DEFAULT 'S'` },
        { table: 'JAVIER.ALMACEN_ART_DIMENSIONES', col: 'TEMPERATURA', ddl: `ALTER TABLE JAVIER.ALMACEN_ART_DIMENSIONES ADD COLUMN TEMPERATURA VARCHAR(10) DEFAULT 'AMBIENTE'` },
        { table: 'JAVIER.ALMACEN_ART_DIMENSIONES', col: 'MAX_APILADO', ddl: `ALTER TABLE JAVIER.ALMACEN_ART_DIMENSIONES ADD COLUMN MAX_APILADO INTEGER DEFAULT 3` },
        { table: 'JAVIER.ALMACEN_CARGA_HISTORICO', col: 'IMPORTE_TOTAL', ddl: `ALTER TABLE JAVIER.ALMACEN_CARGA_HISTORICO ADD COLUMN IMPORTE_TOTAL DECIMAL(12,2) DEFAULT 0` },
        { table: 'JAVIER.ALMACEN_CARGA_HISTORICO', col: 'MARGEN_TOTAL', ddl: `ALTER TABLE JAVIER.ALMACEN_CARGA_HISTORICO ADD COLUMN MARGEN_TOTAL DECIMAL(12,2) DEFAULT 0` },
        { table: 'JAVIER.ALMACEN_CARGA_HISTORICO', col: 'DETALLES_JSON', ddl: `ALTER TABLE JAVIER.ALMACEN_CARGA_HISTORICO ADD COLUMN DETALLES_JSON CLOB(1M) DEFAULT '{}'` },
    ];
    for (const ac of alterCols) {
        const pool = getPool();
        if (!pool) continue;
        let conn;
        try {
            conn = await pool.connect();
            await conn.query(`SELECT ${ac.col} FROM ${ac.table} FETCH FIRST 1 ROWS ONLY`);
        } catch (probeErr) {
            if (conn) try { await conn.close(); } catch (_) { }
            conn = null;
            try {
                conn = await pool.connect();
                await conn.query(ac.ddl);
                logger.info(`✅ Added column ${ac.col} to ${ac.table}`);
            } catch (alterErr) {
                if (!(alterErr.message || '').includes('SQL0601') && !(alterErr.message || '').includes('already exists')) {
                    logger.warn(`⚠️ Could not add ${ac.col} to ${ac.table}: ${alterErr.message}`);
                }
            }
        } finally {
            if (conn) try { await conn.close(); } catch (_) { }
        }
    }

    logger.info('✅ Warehouse: table check complete');
}

// ─── Vehicle photo mapping ──────────────────────────────────────────────────
// URLs verified via Wikipedia REST API (en.wikipedia.org/api/rest_v1/page/summary)
// These are REAL Wikimedia Commons files confirmed to exist.
// Using 640px thumbnails for good quality without excessive bandwidth.
const VEHICLE_PHOTOS = {
    // ── IVECO (dominant brand in this fleet) ──
    // Daily: furgon/camion pequeno (codes 16, 19, 20)
    'IVECO DAILY':      'https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/2014_Iveco_Daily_35_S13_MWB_2.3.jpg/640px-2014_Iveco_Daily_35_S13_MWB_2.3.jpg',
    // Eurocargo / 100E18: camion medio (codes 02, 12, 22, 28, 29, 53, 77, 78, 86, 87, 89, 90)
    'IVECO 100E18':     'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Iveco_Eurocargo_2015.jpg/640px-Iveco_Eurocargo_2015.jpg',
    'IVECO EUROCARGO':  'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Iveco_Eurocargo_2015.jpg/640px-Iveco_Eurocargo_2015.jpg',
    // Generic IVECO → Eurocargo (most fleet vehicles are medium trucks)
    'IVECO':            'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Iveco_Eurocargo_2015.jpg/640px-Iveco_Eurocargo_2015.jpg',

    // ── MERCEDES ──
    // 20T / Atego: camion grande (code 05)
    'MERCEDES 20':      'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Mercedes_Benz_Atego_1624_2012_%2815054808361%29.jpg/640px-Mercedes_Benz_Atego_1624_2012_%2815054808361%29.jpg',
    'MERCEDES ATEGO':   'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Mercedes_Benz_Atego_1624_2012_%2815054808361%29.jpg/640px-Mercedes_Benz_Atego_1624_2012_%2815054808361%29.jpg',
    // Sprinter: furgon/heladero pequeno (codes 11, 15, 23)
    'MERCEDES SPRINTER':'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/2019_Mercedes-Benz_Sprinter_314_CDi_2.1.jpg/640px-2019_Mercedes-Benz_Sprinter_314_CDi_2.1.jpg',
    'MERCEDES-CHICO':   'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/2019_Mercedes-Benz_Sprinter_314_CDi_2.1.jpg/640px-2019_Mercedes-Benz_Sprinter_314_CDi_2.1.jpg',
    'MERCEDES PETIT':   'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/2019_Mercedes-Benz_Sprinter_314_CDi_2.1.jpg/640px-2019_Mercedes-Benz_Sprinter_314_CDi_2.1.jpg',
    // Generic MERCEDES → Atego (most fleet Mercedes are medium trucks)
    'MERCEDES':         'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Mercedes_Benz_Atego_1624_2012_%2815054808361%29.jpg/640px-Mercedes_Benz_Atego_1624_2012_%2815054808361%29.jpg',

    // ── MITSUBISHI FUSO / CANTER (codes 04, 21) ──
    'FUSO CANTER':      'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Fuso_Canter_3C13%2C_8th_Generation.jpg/640px-Fuso_Canter_3C13%2C_8th_Generation.jpg',
    'MITSUBISHI FUSO':  'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Fuso_Canter_3C13%2C_8th_Generation.jpg/640px-Fuso_Canter_3C13%2C_8th_Generation.jpg',
    'CANTER':           'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Fuso_Canter_3C13%2C_8th_Generation.jpg/640px-Fuso_Canter_3C13%2C_8th_Generation.jpg',
    'FUSO':             'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Fuso_Canter_3C13%2C_8th_Generation.jpg/640px-Fuso_Canter_3C13%2C_8th_Generation.jpg',
    'MITSUBISHI':       'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Fuso_Canter_3C13%2C_8th_Generation.jpg/640px-Fuso_Canter_3C13%2C_8th_Generation.jpg',

    // ── NISSAN (codes 10, 14) — Cabstar/NT400 ──
    'NISSAN':           'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Nissan_Cabstar_waste_collector_-_Strasbourg.JPG/640px-Nissan_Cabstar_waste_collector_-_Strasbourg.JPG',

    // ── RENAULT (code 18) — Midlum (white delivery truck) ──
    'RENAULT':          'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Renault_Midlum_livraison_blanc_-_Strasbourg.JPG/640px-Renault_Midlum_livraison_blanc_-_Strasbourg.JPG',

    // ── PEUGEOT BOXER (code 25) — same platform as Fiat Ducato ──
    'PEUGEOT BOXER':    'https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/2024_Fiat_Ducato_DSC_7199.jpg/640px-2024_Fiat_Ducato_DSC_7199.jpg',
    'PEUGEOT':          'https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/2024_Fiat_Ducato_DSC_7199.jpg/640px-2024_Fiat_Ducato_DSC_7199.jpg',

    // ── FORD TRANSIT / DFM (codes 17, 24) — alquiler ──
    'FORD TRANSIT':     'https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/2016_Ford_Transit_350_2.2.jpg/640px-2016_Ford_Transit_350_2.2.jpg',
    'FORD':             'https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/2016_Ford_Transit_350_2.2.jpg/640px-2016_Ford_Transit_350_2.2.jpg',
    'DFM':              'https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/2016_Ford_Transit_350_2.2.jpg/640px-2016_Ford_Transit_350_2.2.jpg',

    // ── Other brands (not in current fleet but kept for future) ──
    'VOLKSWAGEN':       'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Iveco_Eurocargo_2015.jpg/640px-Iveco_Eurocargo_2015.jpg',
    'MAN':              'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Iveco_Eurocargo_2015.jpg/640px-Iveco_Eurocargo_2015.jpg',
    'SCANIA':           'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Iveco_Eurocargo_2015.jpg/640px-Iveco_Eurocargo_2015.jpg',
    'DAF':              'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Iveco_Eurocargo_2015.jpg/640px-Iveco_Eurocargo_2015.jpg',
    'VOLVO':            'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Iveco_Eurocargo_2015.jpg/640px-Iveco_Eurocargo_2015.jpg',
    'FIAT DUCATO':      'https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/2024_Fiat_Ducato_DSC_7199.jpg/640px-2024_Fiat_Ducato_DSC_7199.jpg',
    'CITROEN':          'https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/2024_Fiat_Ducato_DSC_7199.jpg/640px-2024_Fiat_Ducato_DSC_7199.jpg',
};

/** Match vehicle description to best photo URL */
function getVehiclePhotoUrl(description) {
    if (!description) return null;
    const desc = description.toUpperCase().trim();
    // Try longest keys first for most specific match
    const sortedKeys = Object.keys(VEHICLE_PHOTOS).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
        if (desc.includes(key)) return VEHICLE_PHOTOS[key];
    }
    return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// DASHBOARD — Vista general del día
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /warehouse/dashboard?year=2026&month=2&day=19
 * Devuelve resumen de camiones/rutas del día con KPIs
 */
router.get('/dashboard', async (req, res) => {
    try {
        const now = new Date();
        const year = parseInt(req.query.year) || now.getFullYear();
        const month = parseInt(req.query.month) || (now.getMonth() + 1);
        const day = parseInt(req.query.day) || now.getDate();

        // Trucks with orders for the given date
        const trucks = await query(`
      SELECT 
        TRIM(OPP.CODIGOVEHICULO) AS VEHICULO,
        TRIM(V.DESCRIPCIONVEHICULO) AS DESCRIPCION,
        TRIM(V.MATRICULA) AS MATRICULA,
        TRIM(OPP.CODIGOREPARTIDOR) AS REPARTIDOR,
        TRIM(VDD.NOMBREVENDEDOR) AS NOMBRE_REPARTIDOR,
        COUNT(DISTINCT OPP.NUMEROORDENPREPARACION) AS NUM_ORDENES,
        COUNT(*) AS NUM_LINEAS,
        V.CARGAMAXIMA,
        V.CONTENEDORVOLUMEN,
        COALESCE(V.NUMEROCONTENEDORES, 0) AS NUM_PALETS,
        COALESCE(C.TOLERANCIA_EXCESO, 5) AS TOLERANCIA
      FROM DSEDAC.OPP OPP
      LEFT JOIN DSEDAC.VEH V ON TRIM(V.CODIGOVEHICULO) = TRIM(OPP.CODIGOVEHICULO)
      LEFT JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(OPP.CODIGOREPARTIDOR)
      LEFT JOIN JAVIER.ALMACEN_CAMIONES_CONFIG C ON TRIM(OPP.CODIGOVEHICULO) = C.CODIGOVEHICULO
      WHERE OPP.ANOREPARTO = ${year}
        AND OPP.MESREPARTO = ${month}
        AND OPP.DIAREPARTO = ${day}
        AND TRIM(OPP.CODIGOVEHICULO) <> ''
      GROUP BY TRIM(OPP.CODIGOVEHICULO), TRIM(V.DESCRIPCIONVEHICULO),
               TRIM(V.MATRICULA), TRIM(OPP.CODIGOREPARTIDOR),
               TRIM(VDD.NOMBREVENDEDOR), V.CARGAMAXIMA, V.CONTENEDORVOLUMEN,
               COALESCE(V.NUMEROCONTENEDORES, 0),
               COALESCE(C.TOLERANCIA_EXCESO, 5)
      ORDER BY TRIM(OPP.CODIGOVEHICULO)
    `);

        res.json({
            date: { year, month, day },
            totalTrucks: trucks.length,
            trucks: trucks.map(t => {
                let payload = parseFloat(t.CARGAMAXIMA) || 0;
                const numPalets = parseInt(t.NUM_PALETS, 10) || 0;

                // GOD MODE: Si CARGAMAXIMA=0 y hay palets, derivar peso
                if (payload === 0 && numPalets > 0) {
                    payload = numPalets * 500;
                } else if (payload === 0) {
                    payload = 6000;
                }

                return {
                    vehicleCode: (t.VEHICULO || '').trim(),
                    description: (t.DESCRIPCION || '').trim(),
                    matricula: (t.MATRICULA || '').trim(),
                    driverCode: (t.REPARTIDOR || '').trim(),
                    driverName: (t.NOMBRE_REPARTIDOR || '').trim(),
                    orderCount: parseInt(t.NUM_ORDENES) || 0,
                    lineCount: parseInt(t.NUM_LINEAS) || 0,
                    maxPayloadKg: payload,
                    containerVolume: parseFloat(t.CONTENEDORVOLUMEN) || 0,
                    tolerancePct: parseFloat(t.TOLERANCIA) || 5,
                };
            }),
        });
    } catch (error) {
        if (isTableNotFound(error)) {
            return res.json({ date: { year, month, day }, totalTrucks: 0, trucks: [] });
        }
        logger.error(`Warehouse dashboard error: ${error.message}`);
        res.status(500).json({ error: 'Error cargando dashboard almacén', details: error.message });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
// LOAD PLANNER 3D
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST /warehouse/load-plan
 * Body: { vehicleCode, year, month, day, tolerance? }
 * Ejecuta el algoritmo 3D bin packing y devuelve posiciones de cajas
 */
router.post('/load-plan', async (req, res) => {
    try {
        const { vehicleCode, year, month, day, tolerance } = req.body;
        logger.info(`[LOAD-PLAN] Request received: vehicle=${vehicleCode}, date=${year}-${month}-${day}`);

        if (!vehicleCode) {
            return res.status(400).json({ error: 'vehicleCode es obligatorio' });
        }

        const now = new Date();
        const y = parseInt(year) || now.getFullYear();
        const m = parseInt(month) || (now.getMonth() + 1);
        const d = parseInt(day) || now.getDate();

        const result = await loadPlanner.planLoad(vehicleCode, y, m, d, tolerance);

        // Save to history with detailed breakdown
        try {
            const clientBreakdown = {};
            for (const box of (result.placed || [])) {
                const cc = box.clientCode || 'DESCONOCIDO';
                if (!clientBreakdown[cc]) {
                    clientBreakdown[cc] = { clientCode: cc, clientName: box.clientName || cc, boxes: 0, weightKg: 0, importeEur: 0, margenEur: 0, articles: {} };
                }
                clientBreakdown[cc].boxes++;
                clientBreakdown[cc].weightKg += (box.weight || 0);
                clientBreakdown[cc].importeEur += (box.importeEur || 0);
                clientBreakdown[cc].margenEur += (box.margenEur || 0);
                const artKey = box.articleCode || 'UNK';
                if (!clientBreakdown[cc].articles[artKey]) {
                    clientBreakdown[cc].articles[artKey] = { code: artKey, name: box.label || artKey, boxes: 0, weightKg: 0, importeEur: 0, largoCm: box.w || 0, anchoCm: box.d || 0, altoCm: box.h || 0 };
                }
                clientBreakdown[cc].articles[artKey].boxes++;
                clientBreakdown[cc].articles[artKey].weightKg += (box.weight || 0);
                clientBreakdown[cc].articles[artKey].importeEur += (box.importeEur || 0);
            }
            const detalles = {
                clients: Object.values(clientBreakdown).map(c => ({
                    ...c, articles: Object.values(c.articles),
                    weightKg: Math.round(c.weightKg * 100) / 100,
                    importeEur: Math.round(c.importeEur * 100) / 100,
                    margenEur: Math.round(c.margenEur * 100) / 100,
                })),
                overflowCount: (result.overflow || []).length,
            };
            let detallesStr = JSON.stringify(detalles);
            // Safety: if JSON too large for ODBC buffer, compact by removing article names
            if (detallesStr.length > 500000) {
                for (const cl of (detalles.clients || [])) {
                    for (const art of (cl.articles || [])) {
                        delete art.name; // save space
                    }
                    delete cl.clientName;
                }
                detallesStr = JSON.stringify(detalles);
                logger.info(`[LOAD-PLAN] Compacted detalles JSON from large to ${detallesStr.length} bytes`);
            }

            await queryWithParams(`
        INSERT INTO JAVIER.ALMACEN_CARGA_HISTORICO
          (CODIGOVEHICULO, FECHA_PLANIFICACION, PESO_TOTAL_KG, VOLUMEN_TOTAL_CM3,
           PCT_VOLUMEN, PCT_PESO, NUM_ORDENES, NUM_BULTOS, ESTADO, CREATED_BY,
           IMPORTE_TOTAL, MARGEN_TOTAL, DETALLES_JSON)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
                sanitizeForSQL(vehicleCode),
                `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
                result.metrics.totalWeightKg,
                result.metrics.usedVolumeCm3,
                result.metrics.volumeOccupancyPct,
                result.metrics.weightOccupancyPct || 0,
                result.metrics.placedCount,
                result.metrics.totalBoxes,
                sanitizeForSQL(result.metrics.status),
                sanitizeForSQL(req.user?.code || 'SYSTEM'),
                result.metrics.totalImporteEur || 0,
                result.metrics.totalMargenEur || 0,
                detallesStr
            ]);
        } catch (histErr) {
            logger.warn(`Error guardando histórico carga: ${histErr.message}`);
        }

        res.json(result);
    } catch (error) {
        const odbcDetail = (error.odbcErrors || []).map(e => `[${e.code}/${e.state}] ${e.message}`).join('; ');
        logger.error(`Load plan error: ${odbcDetail || error.message}`);
        logger.error(`Load plan stack: ${error.stack}`);
        res.status(500).json({ error: 'Error planificando carga', details: odbcDetail || error.message });
    }
});

/**
 * POST /warehouse/load-plan/optimize
 * Body: { vehicleCode, year, month, day }
 * Optimiza la carga para máximo beneficio (greedy knapsack)
 */
router.post('/load-plan/optimize', async (req, res) => {
    try {
        const { vehicleCode, year, month, day } = req.body;
        if (!vehicleCode) {
            return res.status(400).json({ error: 'vehicleCode es obligatorio' });
        }
        const now = new Date();
        const y = parseInt(year) || now.getFullYear();
        const m = parseInt(month) || (now.getMonth() + 1);
        const d = parseInt(day) || now.getDate();

        const result = await loadPlanner.optimizeForProfit(vehicleCode, y, m, d);
        res.json(result);
    } catch (error) {
        logger.error(`Optimize load error: ${error.message}`);
        res.status(500).json({ error: 'Error optimizando carga', details: error.message });
    }
});

/**
 * POST /warehouse/load-plan/smart-optimize
 * Body: { vehicleCode, year, month, day, mustDeliverOrders?: number[] }
 * Optimización inteligente: must-deliver + máximo margen EUR
 */
router.post('/load-plan/smart-optimize', async (req, res) => {
    try {
        const { vehicleCode, year, month, day, mustDeliverOrders } = req.body;
        if (!vehicleCode) {
            return res.status(400).json({ error: 'vehicleCode es obligatorio' });
        }
        const now = new Date();
        const y = parseInt(year) || now.getFullYear();
        const m = parseInt(month) || (now.getMonth() + 1);
        const d = parseInt(day) || now.getDate();

        const result = await loadPlanner.smartOptimize(vehicleCode, y, m, d, mustDeliverOrders || []);
        res.json(result);
    } catch (error) {
        logger.error(`Smart optimize error: ${error.message}`);
        res.status(500).json({ error: 'Error en optimización inteligente', details: error.message });
    }
});

/**
 * POST /warehouse/load-plan/axle-balance
 * Body: { placed: [...], interior: { lengthCm, widthCm, heightCm } }
 * Calcula equilibrio de ejes a partir de cajas colocadas
 */
router.post('/load-plan/axle-balance', async (req, res) => {
    try {
        const { placed, interior } = req.body;
        if (!placed || !interior) {
            return res.status(400).json({ error: 'placed e interior son obligatorios' });
        }
        const result = loadPlanner.calculateAxleBalance(placed, interior);
        res.json(result);
    } catch (error) {
        logger.error(`Axle balance error: ${error.message}`);
        res.status(500).json({ error: 'Error calculando equilibrio de ejes', details: error.message });
    }
});

/**
 * POST /warehouse/load-plan-manual
 * Body: { vehicleCode, items: [{articleCode, quantity, ...}], tolerance? }
 * Para simulaciones "what-if" desde el frontend
 */
router.post('/load-plan-manual', async (req, res) => {
    try {
        const { vehicleCode, items, tolerance } = req.body;
        if (!vehicleCode || !items?.length) {
            return res.status(400).json({ error: 'vehicleCode e items son obligatorios' });
        }
        const result = await loadPlanner.planLoadManual(vehicleCode, items, tolerance);
        res.json(result);
    } catch (error) {
        logger.error(`Manual load plan error: ${error.message}`);
        res.status(500).json({ error: 'Error en simulación de carga', details: error.message });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
// VEHÍCULOS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /warehouse/vehicles
 * Lista todos los vehículos con sus capacidades y configuración
 */
router.get('/vehicles', async (req, res) => {
    try {
        const vehicles = await cachedQuery(query, `
      SELECT
        TRIM(V.CODIGOVEHICULO) AS CODE,
        TRIM(V.DESCRIPCIONVEHICULO) AS DESCRIPCION,
        TRIM(V.MATRICULA) AS MATRICULA,
        V.CARGAMAXIMA, V.TARA, V.VOLUMEN, V.CONTENEDORVOLUMEN,
        COALESCE(V.NUMEROCONTENEDORES, 0) AS NUM_PALETS,
        C.LARGO_INTERIOR_CM, C.ANCHO_INTERIOR_CM, C.ALTO_INTERIOR_CM,
        C.TOLERANCIA_EXCESO
      FROM DSEDAC.VEH V
      LEFT JOIN JAVIER.ALMACEN_CAMIONES_CONFIG C
        ON TRIM(V.CODIGOVEHICULO) = C.CODIGOVEHICULO
      ORDER BY V.CODIGOVEHICULO
    `, 'warehouse:vehicles', TTL.LONG);

        res.json({
            vehicles: vehicles.map(v => {
                const l = parseFloat(v.LARGO_INTERIOR_CM) || 0;
                const w = parseFloat(v.ANCHO_INTERIOR_CM) || 0;
                const h = parseFloat(v.ALTO_INTERIOR_CM) || 0;
                let payload = parseFloat(v.CARGAMAXIMA) || 0;
                let vol = parseFloat(v.CONTENEDORVOLUMEN) || 0;
                const numPalets = parseInt(v.NUM_PALETS, 10) || 0;

                let finalL = l;
                let finalW = w;
                let finalH = h;

                // God Mode Math: Si todo es 0 pero hay palets, derivar en vivo
                if ((finalL === 0 || finalW === 0 || finalH === 0) && numPalets > 0) {
                    const filas = Math.ceil(numPalets / 2);
                    finalL = filas * 80;
                    finalW = 240;
                    finalH = 220;
                    if (payload === 0) payload = numPalets * 500;
                } else if (finalL === 0 || finalW === 0 || finalH === 0) {
                    finalL = 600;
                    finalW = 240;
                    finalH = 220;
                }

                if (payload === 0) payload = 6000;
                if (vol === 0 || vol < 2) vol = (finalL * finalW * finalH) / 1000000;

                return {
                    code: v.CODE,
                    description: (v.DESCRIPCION || '').trim(),
                    matricula: (v.MATRICULA || '').trim(),
                    maxPayloadKg: payload,
                    tara: parseFloat(v.TARA) || 0,
                    volumeM3: parseFloat(v.VOLUMEN) || 0,
                    containerVolumeM3: vol,
                    interior: {
                        lengthCm: finalL,
                        widthCm: finalW,
                        heightCm: finalH,
                    },
                    tolerancePct: parseFloat(v.TOLERANCIA_EXCESO) || 5,
                    imageUrl: getVehiclePhotoUrl((v.DESCRIPCION || '').trim())
                        ? `/api/warehouse/vehicle-photo/${(v.CODE || '').trim()}`
                        : null,
                };
            }),
        });
    } catch (error) {
        logger.error(`Vehicles error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo vehículos', details: error.message });
    }
});

/**
 * GET /warehouse/truck-config/:vehicleCode
 */
router.get('/truck-config/:vehicleCode', async (req, res) => {
    try {
        const config = await loadPlanner.getTruckConfig(req.params.vehicleCode);
        if (!config) return res.status(404).json({ error: 'Vehículo no encontrado' });
        res.json(config);
    } catch (error) {
        logger.error(`Truck config error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo config camión', details: error.message });
    }
});

/**
 * PUT /warehouse/truck-config/:vehicleCode
 * Body: { largoInteriorCm, anchoInteriorCm, altoInteriorCm, toleranciaExceso, notas }
 */
router.put('/truck-config/:vehicleCode', async (req, res) => {
    try {
        const code = sanitizeForSQL(req.params.vehicleCode);
        const { largoInteriorCm, anchoInteriorCm, altoInteriorCm, toleranciaExceso, notas } = req.body;

        // Upsert
        try {
            await queryWithParams(`
        UPDATE JAVIER.ALMACEN_CAMIONES_CONFIG SET
          LARGO_INTERIOR_CM = ?,
          ANCHO_INTERIOR_CM = ?,
          ALTO_INTERIOR_CM = ?,
          TOLERANCIA_EXCESO = ?,
          NOTAS = ?,
          UPDATED_AT = CURRENT_TIMESTAMP,
          UPDATED_BY = ?
        WHERE CODIGOVEHICULO = ?
      `, [
                parseFloat(largoInteriorCm) || null,
                parseFloat(anchoInteriorCm) || null,
                parseFloat(altoInteriorCm) || null,
                parseFloat(toleranciaExceso) || 5,
                (notas || '').substring(0, 250),
                sanitizeForSQL(req.user?.code || 'SYSTEM'),
                code
            ]);
        } catch (updateErr) {
            // Try insert if update didn't match
            await queryWithParams(`
        INSERT INTO JAVIER.ALMACEN_CAMIONES_CONFIG
          (CODIGOVEHICULO, LARGO_INTERIOR_CM, ANCHO_INTERIOR_CM, ALTO_INTERIOR_CM, TOLERANCIA_EXCESO, NOTAS, UPDATED_BY)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
                code,
                parseFloat(largoInteriorCm) || null,
                parseFloat(anchoInteriorCm) || null,
                parseFloat(altoInteriorCm) || null,
                parseFloat(toleranciaExceso) || 5,
                (notas || '').substring(0, 250),
                sanitizeForSQL(req.user?.code || 'SYSTEM')
            ]);
        }

        const updated = await loadPlanner.getTruckConfig(req.params.vehicleCode);
        res.json(updated);
    } catch (error) {
        logger.error(`Update truck config error: ${error.message}`);
        res.status(500).json({ error: 'Error actualizando config', details: error.message });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
// PERSONAL DE ALMACÉN
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /warehouse/personnel
 */
router.get('/personnel', async (req, res) => {
    try {
        // Get custom personnel from ALMACEN_PERSONAL
        const customRows = await cachedQuery(query, `
      SELECT ID, NOMBRE, CODIGO_VENDEDOR, ROL, ACTIVO, TELEFONO, EMAIL, CREATED_AT
      FROM JAVIER.ALMACEN_PERSONAL
      WHERE ACTIVO = 'S'
      ORDER BY NOMBRE
    `, 'warehouse:personnel:custom', TTL.MEDIUM);

        // Only warehouse-specific personnel (no repartidores/comerciales from VDD)
        const personnel = customRows.map(r => ({
            id: r.ID,
            name: (r.NOMBRE || '').trim(),
            vendorCode: (r.CODIGO_VENDEDOR || '').trim(),
            role: (r.ROL || 'PREPARADOR').trim(),
            active: true,
            phone: (r.TELEFONO || '').trim(),
            email: (r.EMAIL || '').trim(),
            source: 'custom',
        }));

        personnel.sort((a, b) => a.name.localeCompare(b.name));

        res.json({ personnel });
    } catch (error) {
        if (isTableNotFound(error)) {
            // ALMACEN_PERSONAL doesn't exist yet — return only VDD drivers
            return res.json({ personnel: [] });
        }
        logger.error(`Personnel error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo personal', details: error.message });
    }
});

/**
 * POST /warehouse/personnel
 * Body: { nombre, codigoVendedor?, rol?, telefono?, email? }
 */
router.post('/personnel', async (req, res) => {
    try {
        const { nombre, codigoVendedor, rol, telefono, email } = req.body;
        if (!nombre) return res.status(400).json({ error: 'nombre es obligatorio' });

        await queryWithParams(`
      INSERT INTO JAVIER.ALMACEN_PERSONAL (NOMBRE, CODIGO_VENDEDOR, ROL, TELEFONO, EMAIL)
      VALUES (?, ?, ?, ?, ?)
    `, [
            sanitizeForSQL(nombre).substring(0, 100),
            sanitizeForSQL(codigoVendedor || '').substring(0, 20),
            sanitizeForSQL(rol || 'PREPARADOR').substring(0, 30),
            sanitizeForSQL(telefono || '').substring(0, 20),
            sanitizeForSQL(email || '').substring(0, 100)
        ]);

        res.json({ success: true, message: 'Operario añadido' });
    } catch (error) {
        logger.error(`Add personnel error: ${error.message}`);
        res.status(500).json({ error: 'Error añadiendo operario', details: error.message });
    }
});

/**
 * PUT /warehouse/personnel/:id
 */
router.put('/personnel/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { nombre, codigoVendedor, rol, telefono, email, activo } = req.body;

        const sets = [];
        const params = [];
        if (nombre) { sets.push('NOMBRE = ?'); params.push(sanitizeForSQL(nombre).substring(0, 100)); }
        if (codigoVendedor !== undefined) { sets.push('CODIGO_VENDEDOR = ?'); params.push(sanitizeForSQL(codigoVendedor)); }
        if (rol) { sets.push('ROL = ?'); params.push(sanitizeForSQL(rol)); }
        if (telefono !== undefined) { sets.push('TELEFONO = ?'); params.push(sanitizeForSQL(telefono)); }
        if (email !== undefined) { sets.push('EMAIL = ?'); params.push(sanitizeForSQL(email)); }
        if (activo !== undefined) { sets.push('ACTIVO = ?'); params.push(activo ? 'S' : 'N'); }
        sets.push('UPDATED_AT = CURRENT_TIMESTAMP');
        params.push(id);

        await queryWithParams(`UPDATE JAVIER.ALMACEN_PERSONAL SET ${sets.join(', ')} WHERE ID = ?`, params);
        res.json({ success: true });
    } catch (error) {
        logger.error(`Update personnel error: ${error.message}`);
        res.status(500).json({ error: 'Error actualizando operario', details: error.message });
    }
});

/**
 * POST /warehouse/personnel/:id/delete — Soft delete (ACTIVO = 'N')
 */
router.post('/personnel/:id/delete', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await query(`UPDATE JAVIER.ALMACEN_PERSONAL SET ACTIVO = 'N', UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = ${id}`);
        res.json({ success: true });
    } catch (error) {
        logger.error(`Delete personnel error: ${error.message}`);
        res.status(500).json({ error: 'Error eliminando operario', details: error.message });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
// ARTÍCULOS — Lista con búsqueda
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /warehouse/articles?search=&onlyWithDimensions=true&limit=50
 */
router.get('/articles', async (req, res) => {
    try {
        const { search, onlyWithDimensions, limit = 500 } = req.query;
        let where = "TRIM(A.CODIGOARTICULO) <> '' AND (A.ANOBAJA = 0 OR A.ANOBAJA IS NULL)";

        const garbageKeywords = [
            'PRUEBA', 'TEST', 'DESCUENTO', 'ESTIMADO', 'CT CT', 'CTR ', 'URGENTE',
            'REPARTIR', 'ENVIAR', 'ULTIMA HORA', 'GASTOS ESTABLECIMIENTO', 'COLABORACION GASTOS',
            'MODELO TARIFA', 'TARIFAS PACK', 'REVISTA', 'AVERIADO', 'PANAMAR',
            'ANULACION', 'RECOGER PAGARE', 'PEDIR C.I.F', 'DEJAR MERCANCIA',
            'SERVIR EN', 'SERVIR,', 'KIOSCO', 'CAFETERIA', 'TERRAZA DE',
            'ENTREGAR MERCANCIA', 'AGENDA RESTAURACION', 'INCOBRABLE',
            'ALMACENADOR DE', 'P E D I R'
        ];
        for (const kw of garbageKeywords) {
            where += ` AND UPPER(A.DESCRIPCIONARTICULO) NOT LIKE '%${kw}%'`;
        }
        where += " AND NOT (LENGTH(TRIM(A.CODIGOARTICULO)) = 1)";
        where += " AND TRIM(A.CODIGOARTICULO) NOT IN ('0000','0006','0022','0043','0045','0046','0047','0051','0053','0054','0056','0058','0061','0070','0071','D001','K')";

        if (search) {
            const s = sanitizeForSQL(search.trim().toUpperCase());
            where += ` AND (UPPER(TRIM(A.CODIGOARTICULO)) LIKE '%${s}%' OR UPPER(A.DESCRIPCIONARTICULO) LIKE '%${s}%')`;
        }
        if (onlyWithDimensions === 'true') {
            where += ' AND D.CODIGOARTICULO IS NOT NULL';
        }

        let orderBy = 'A.CODIGOARTICULO';
        // Fetch recent order article codes separately (fast, avoids heavy JOIN)
        let recentArticleCodes = new Set();
        if (!search) {
            try {
                const now = new Date();
                const y = now.getFullYear();
                const m = now.getMonth() + 1;
                const d = now.getDate();
                const recentRows = await query(`
                    SELECT DISTINCT TRIM(LAC2.CODIGOARTICULO) AS ART_CODE
                    FROM DSEDAC.OPP OPP2
                    INNER JOIN DSEDAC.CPC CPC2
                        ON OPP2.NUMEROORDENPREPARACION = CPC2.NUMEROORDENPREPARACION
                        AND OPP2.EJERCICIOORDENPREPARACION = CPC2.EJERCICIOORDENPREPARACION
                    INNER JOIN DSEDAC.LAC LAC2
                        ON CPC2.NUMEROALBARAN = LAC2.NUMEROALBARAN
                        AND CPC2.EJERCICIOALBARAN = LAC2.EJERCICIOALBARAN
                        AND TRIM(CPC2.SERIEALBARAN) = TRIM(LAC2.SERIEALBARAN)
                    WHERE OPP2.ANOREPARTO = ${y} AND OPP2.MESREPARTO = ${m} AND OPP2.DIAREPARTO BETWEEN ${Math.max(1, d - 7)} AND ${d}
                    FETCH FIRST 2000 ROWS ONLY
                `);
                recentArticleCodes = new Set(recentRows.map(r => (r.ART_CODE || '').trim()));
            } catch (e) {
                logger.warn(`Recent articles query failed (non-blocking): ${e.message}`);
            }
            orderBy = 'CASE WHEN D.CODIGOARTICULO IS NOT NULL THEN 0 ELSE 1 END, A.CODIGOARTICULO';
        }

        const rows = await query(`
            SELECT TRIM(A.CODIGOARTICULO) AS CODE, TRIM(A.DESCRIPCIONARTICULO) AS NOMBRE,
                   COALESCE(A.PESO, 0) AS PESO, COALESCE(A.UNIDADESCAJA, 1) AS UNIDADESCAJA,
                   D.LARGO_CM, D.ANCHO_CM, D.ALTO_CM, D.PESO_CAJA_KG, D.NOTAS
            FROM DSEDAC.ART A
            LEFT JOIN JAVIER.ALMACEN_ART_DIMENSIONES D ON TRIM(A.CODIGOARTICULO) = D.CODIGOARTICULO
            WHERE ${where}
            ORDER BY ${orderBy}
            FETCH FIRST ${parseInt(limit)} ROWS ONLY
        `);

        const estimateFn = require('../services/loadPlanner').estimateBoxDimensions;

        res.json({
            articles: rows.map(r => {
                const hasReal = r.LARGO_CM != null;
                let estLargo = null, estAncho = null, estAlto = null;
                if (!hasReal && estimateFn) {
                    try {
                        const est = estimateFn(
                            parseFloat(r.PESO) || 0,
                            parseInt(r.UNIDADESCAJA) || 1,
                            (r.NOMBRE || '')
                        );
                        estLargo = est.largo;
                        estAncho = est.ancho;
                        estAlto = est.alto;
                    } catch(e) { /* ignore */ }
                }
                return {
                    code: (r.CODE || '').trim(),
                    name: (r.NOMBRE || '').trim(),
                    weight: parseFloat(r.PESO) || 0,
                    unitsPerBox: parseInt(r.UNIDADESCAJA) || 1,
                    hasRealDimensions: hasReal,
                    largoCm: parseFloat(r.LARGO_CM) || null,
                    anchoCm: parseFloat(r.ANCHO_CM) || null,
                    altoCm: parseFloat(r.ALTO_CM) || null,
                    estLargoCm: estLargo,
                    estAnchoCm: estAncho,
                    estAltoCm: estAlto,
                    pesoOverrideKg: parseFloat(r.PESO_CAJA_KG) || null,
                    notas: (r.NOTAS || '').trim(),
                    inRecentOrders: recentArticleCodes.has((r.CODE || '').trim()),
                };
            }),
        });
    } catch (error) {
        logger.error(`Articles list error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo artículos', details: error.message });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
// DIMENSIONES DE ARTÍCULOS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /warehouse/article-dimensions/:code
 */
router.get('/article-dimensions/:code', async (req, res) => {
    try {
        const code = sanitizeForSQL(req.params.code.trim());
        const rows = await queryWithParams(`
      SELECT 
        TRIM(A.CODIGOARTICULO) AS CODE,
        TRIM(A.DESCRIPCIONARTICULO) AS NOMBRE,
        A.PESO, A.UNIDADESCAJA,
        D.LARGO_CM, D.ANCHO_CM, D.ALTO_CM, D.PESO_CAJA_KG, D.NOTAS
      FROM DSEDAC.ART A
      LEFT JOIN JAVIER.ALMACEN_ART_DIMENSIONES D ON TRIM(A.CODIGOARTICULO) = D.CODIGOARTICULO
      WHERE TRIM(A.CODIGOARTICULO) = ?
    `, [code]);

        if (!rows.length) return res.status(404).json({ error: 'Artículo no encontrado' });

        const r = rows[0];
        res.json({
            code: r.CODE,
            name: (r.NOMBRE || '').trim(),
            weight: parseFloat(r.PESO) || 0,
            unitsPerBox: parseInt(r.UNIDADESCAJA) || 1,
            dimensions: {
                largoCm: parseFloat(r.LARGO_CM) || 30,
                anchoCm: parseFloat(r.ANCHO_CM) || 20,
                altoCm: parseFloat(r.ALTO_CM) || 15,
                hasRealDimensions: r.LARGO_CM != null,
            },
            pesoOverrideKg: parseFloat(r.PESO_CAJA_KG) || null,
            notes: (r.NOTAS || '').trim(),
        });
    } catch (error) {
        logger.error(`Article dims error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo dimensiones', details: error.message });
    }
});

/**
 * PUT /warehouse/article-dimensions/:code
 * Body: { largoCm, anchoCm, altoCm, pesoCajaKg?, notas? }
 */
router.put('/article-dimensions/:code', async (req, res) => {
    try {
        const code = sanitizeForSQL(req.params.code.trim());
        const { largoCm, anchoCm, altoCm, pesoCajaKg, notas } = req.body;

        // Upsert via DELETE + INSERT (DB2 i5/OS compatible)
        try {
            await queryWithParams(`DELETE FROM JAVIER.ALMACEN_ART_DIMENSIONES WHERE CODIGOARTICULO = ?`, [code]);
        } catch (e) { /* might not exist */ }

        await queryWithParams(`
      INSERT INTO JAVIER.ALMACEN_ART_DIMENSIONES
        (CODIGOARTICULO, LARGO_CM, ANCHO_CM, ALTO_CM, PESO_CAJA_KG, NOTAS, UPDATED_AT, UPDATED_BY)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    `, [
            code,
            parseFloat(largoCm) || 30,
            parseFloat(anchoCm) || 20,
            parseFloat(altoCm) || 15,
            pesoCajaKg ? parseFloat(pesoCajaKg) : null,
            (notas || '').substring(0, 200),
            sanitizeForSQL(req.user?.code || 'SYSTEM')
        ]);

        res.json({ success: true, message: 'Dimensiones actualizadas' });
    } catch (error) {
        logger.error(`Update article dims error: ${error.message}`);
        res.status(500).json({ error: 'Error actualizando dimensiones', details: error.message });
    }
});

/**
 * POST /warehouse/article-dimensions/:code/delete
 * Elimina dimensiones reales de un artículo (vuelve a estimado)
 */
router.post('/article-dimensions/:code/delete', async (req, res) => {
    try {
        const code = sanitizeForSQL(req.params.code.trim());
        await queryWithParams(`DELETE FROM JAVIER.ALMACEN_ART_DIMENSIONES WHERE CODIGOARTICULO = ?`, [code]);
        res.json({ success: true, message: 'Dimensiones eliminadas, vuelve a estimado' });
    } catch (error) {
        logger.error(`Delete article dims error: ${error.message}`);
        res.status(500).json({ error: 'Error eliminando dimensiones', details: error.message });
    }
});

/**
 * POST /warehouse/articles/reset-all-dimensions
 * Elimina TODAS las dimensiones reales guardadas (vuelve todo a estimado)
 * Útil cuando se confirmaron dimensiones por error en masa
 */
router.post('/articles/reset-all-dimensions', async (req, res) => {
    try {
        const countResult = await query(`SELECT COUNT(*) AS CNT FROM JAVIER.ALMACEN_ART_DIMENSIONES`);
        const total = parseInt(countResult[0]?.CNT) || 0;
        await query(`DELETE FROM JAVIER.ALMACEN_ART_DIMENSIONES`);
        logger.info(`✅ Reset ALL article dimensions: ${total} rows deleted`);
        res.json({ success: true, deleted: total, message: `${total} dimensiones reales eliminadas` });
    } catch (error) {
        logger.error(`Reset all dims error: ${error.message}`);
        res.status(500).json({ error: 'Error reseteando dimensiones', details: error.message });
    }
});

/**
 * GET /warehouse/vehicle-photo/:code
 * Proxy endpoint for vehicle photos — avoids Wikipedia User-Agent blocks in Flutter
 * Streams the image directly from Wikimedia Commons
 */
router.get('/vehicle-photo/:code', async (req, res) => {
    try {
        const code = req.params.code.trim();
        // Get vehicle description from DB
        const rows = await cachedQuery(query, `
            SELECT TRIM(V.DESCRIPCIONVEHICULO) AS DESC
            FROM DSEDAC.VEH V
            WHERE TRIM(V.CODIGOVEHICULO) = '${sanitizeForSQL(code)}'
            FETCH FIRST 1 ROWS ONLY
        `, `warehouse:veh-desc:${code}`, TTL.LONG);

        const desc = (rows[0]?.DESC || '').trim();
        const photoUrl = getVehiclePhotoUrl(desc);

        if (!photoUrl) {
            return res.status(404).json({ error: 'No photo found for vehicle' });
        }

        // Fetch from Wikimedia with proper User-Agent
        const https = require('https');
        const url = new URL(photoUrl);
        const proxyReq = https.get({
            hostname: url.hostname,
            path: url.pathname,
            headers: {
                'User-Agent': 'GMP-App/1.0 (gmp-logistics; contact@gmp.es) Node.js',
                'Accept': 'image/*',
            },
        }, (proxyRes) => {
            if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
                // Follow redirect
                const redirectUrl = new URL(proxyRes.headers.location);
                https.get({
                    hostname: redirectUrl.hostname,
                    path: redirectUrl.pathname + (redirectUrl.search || ''),
                    headers: {
                        'User-Agent': 'GMP-App/1.0 (gmp-logistics; contact@gmp.es) Node.js',
                        'Accept': 'image/*',
                    },
                }, (finalRes) => {
                    res.set('Content-Type', finalRes.headers['content-type'] || 'image/jpeg');
                    res.set('Cache-Control', 'public, max-age=86400');
                    finalRes.pipe(res);
                }).on('error', (e) => {
                    res.status(502).json({ error: 'Image fetch failed', details: e.message });
                });
                return;
            }
            res.set('Content-Type', proxyRes.headers['content-type'] || 'image/jpeg');
            res.set('Cache-Control', 'public, max-age=86400');
            proxyRes.pipe(res);
        });
        proxyReq.on('error', (e) => {
            res.status(502).json({ error: 'Image fetch failed', details: e.message });
        });
        proxyReq.setTimeout(10000, () => {
            proxyReq.destroy();
            res.status(504).json({ error: 'Image fetch timeout' });
        });
    } catch (error) {
        logger.error(`Vehicle photo proxy error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo foto', details: error.message });
    }
});

/**
 * POST /warehouse/personnel/cleanup-test
 * Remove test personnel entries (like test_operario_script)
 */
router.post('/personnel/cleanup-test', async (req, res) => {
    try {
        const result = await query(`
            UPDATE JAVIER.ALMACEN_PERSONAL
            SET ACTIVO = 'N', UPDATED_AT = CURRENT_TIMESTAMP
            WHERE UPPER(NOMBRE) LIKE '%TEST%' OR UPPER(NOMBRE) LIKE '%SCRIPT%' OR UPPER(NOMBRE) LIKE '%PRUEBA%'
        `);
        logger.info('✅ Cleaned up test personnel entries');
        res.json({ success: true, message: 'Entradas de test desactivadas' });
    } catch (error) {
        logger.error(`Cleanup test personnel error: ${error.message}`);
        res.status(500).json({ error: 'Error limpiando personal test', details: error.message });
    }
});

/**
 * POST /warehouse/articles/bulk-estimate
 * Auto-estimate and save dimensions for articles without real dimensions
 */
router.post('/articles/bulk-estimate', async (req, res) => {
    try {
        const estimateFn = require('../services/loadPlanner').estimateBoxDimensions;
        const rows = await query(`
            SELECT TRIM(A.CODIGOARTICULO) AS CODE, TRIM(A.DESCRIPCIONARTICULO) AS NOMBRE,
                   COALESCE(A.PESO, 0) AS PESO, COALESCE(A.UNIDADESCAJA, 1) AS UNIDADESCAJA
            FROM DSEDAC.ART A
            LEFT JOIN JAVIER.ALMACEN_ART_DIMENSIONES D ON TRIM(A.CODIGOARTICULO) = D.CODIGOARTICULO
            WHERE D.CODIGOARTICULO IS NULL
              AND TRIM(A.CODIGOARTICULO) <> ''
              AND (A.ANOBAJA = 0 OR A.ANOBAJA IS NULL)
              AND COALESCE(A.PESO, 0) > 0
            FETCH FIRST 500 ROWS ONLY
        `);
        let saved = 0;
        for (const r of rows) {
            try {
                const est = estimateFn(parseFloat(r.PESO) || 0, parseInt(r.UNIDADESCAJA) || 1, (r.NOMBRE || ''));
                const code = sanitizeForSQL((r.CODE || '').trim());
                const pesoCaja = (parseFloat(r.PESO) || 0) * Math.max(parseInt(r.UNIDADESCAJA) || 1, 1);
                try { await queryWithParams(`DELETE FROM JAVIER.ALMACEN_ART_DIMENSIONES WHERE CODIGOARTICULO = ?`, [code]); } catch(e) {}
                await queryWithParams(`
                    INSERT INTO JAVIER.ALMACEN_ART_DIMENSIONES
                        (CODIGOARTICULO, LARGO_CM, ANCHO_CM, ALTO_CM, PESO_CAJA_KG, NOTAS, UPDATED_BY)
                    VALUES (?, ?, ?, ?, ?, 'Auto-estimado por familia/peso', 'SYSTEM')
                `, [code, est.largo, est.ancho, est.alto, parseFloat(pesoCaja.toFixed(2))]);
                saved++;
            } catch(e) { /* skip individual errors */ }
        }
        res.json({ success: true, estimated: saved, total: rows.length });
    } catch (error) {
        logger.error(`Bulk estimate error: ${error.message}`);
        res.status(500).json({ error: 'Error en estimacion masiva', details: error.message });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
// ÓRDENES POR CAMIÓN
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /warehouse/truck/:vehicleCode/orders?year=&month=&day=
 */
router.get('/truck/:vehicleCode/orders', async (req, res) => {
    try {
        const code = sanitizeForSQL(req.params.vehicleCode);
        const now = new Date();
        const year = parseInt(req.query.year) || now.getFullYear();
        const month = parseInt(req.query.month) || (now.getMonth() + 1);
        const day = parseInt(req.query.day) || now.getDate();

        const rows = await query(`
      SELECT
        OPP.EJERCICIOORDENPREPARACION AS EJERCICIO,
        OPP.NUMEROORDENPREPARACION AS NUM_ORDEN,
        TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE,
        TRIM(CLI.NOMBRECLIENTE) AS NOMBRE_CLIENTE,
        TRIM(LAC.CODIGOARTICULO) AS ARTICULO,
        TRIM(A.DESCRIPCIONARTICULO) AS NOMBRE_ARTICULO,
        LAC.CANTIDADUNIDADES AS CANTIDAD,
        LAC.CANTIDADENVASES AS CAJAS,
        COALESCE(A.PESO, 0) AS PESO_UD,
        D.LARGO_CM, D.ANCHO_CM, D.ALTO_CM
      FROM DSEDAC.OPP OPP
      INNER JOIN DSEDAC.CPC CPC 
        ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION 
        AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
      INNER JOIN DSEDAC.LAC LAC 
        ON CPC.NUMEROALBARAN = LAC.NUMEROALBARAN 
        AND CPC.EJERCICIOALBARAN = LAC.EJERCICIOALBARAN 
        AND TRIM(CPC.SERIEALBARAN) = TRIM(LAC.SERIEALBARAN)
      LEFT JOIN DSEDAC.ART A ON TRIM(LAC.CODIGOARTICULO) = TRIM(A.CODIGOARTICULO)
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CPC.CODIGOCLIENTEALBARAN) = TRIM(CLI.CODIGOCLIENTE)
      LEFT JOIN JAVIER.ALMACEN_ART_DIMENSIONES D ON TRIM(LAC.CODIGOARTICULO) = D.CODIGOARTICULO
      WHERE TRIM(OPP.CODIGOVEHICULO) = '${code}'
        AND OPP.ANOREPARTO = ${year}
        AND OPP.MESREPARTO = ${month}
        AND OPP.DIAREPARTO = ${day}
      ORDER BY OPP.NUMEROORDENPREPARACION, TRIM(CPC.CODIGOCLIENTEALBARAN)
    `);

        res.json({
            vehicleCode: code,
            date: { year, month, day },
            totalLines: rows.length,
            orders: rows.map(r => ({
                id: r.EJERCICIO + '-' + r.NUM_ORDEN,
                orderYear: r.EJERCICIO,
                orderNumber: r.NUM_ORDEN,
                clientCode: (r.CLIENTE || '').trim(),
                clientName: (r.NOMBRE_CLIENTE || '').trim(),
                articleCode: (r.ARTICULO || '').trim(),
                articleName: (r.NOMBRE_ARTICULO || '').trim(),
                units: parseFloat(r.CANTIDAD) || 0,
                boxes: parseFloat(r.CAJAS) || 0,
                weightPerUnit: parseFloat(r.PESO_UD) || 0,
                hasDimensions: r.LARGO_CM != null,
                dimensions: {
                    largoCm: parseFloat(r.LARGO_CM) || 30,
                    anchoCm: parseFloat(r.ANCHO_CM) || 20,
                    altoCm: parseFloat(r.ALTO_CM) || 15,
                },
            })),
        });
    } catch (error) {
        const odbcDetail = (error.odbcErrors || []).map(e => `[${e.code}/${e.state}] ${e.message}`).join('; ');
        logger.error(`Truck orders error: ${odbcDetail || error.message}`);
        res.status(500).json({ error: 'Error obteniendo órdenes', details: odbcDetail || error.message });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
// HISTORIAL DE CARGAS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /warehouse/load-history?vehicleCode=&limit=20
 */
router.get('/load-history', async (req, res) => {
    try {
        const { vehicleCode, dateFrom, dateTo, limit = 50 } = req.query;
        let where = '1=1';
        if (vehicleCode) {
            where += ` AND H.CODIGOVEHICULO = '${sanitizeForSQL(vehicleCode)}'`;
        }
        if (dateFrom) {
            where += ` AND H.FECHA_PLANIFICACION >= '${sanitizeForSQL(dateFrom)}'`;
        }
        if (dateTo) {
            where += ` AND H.FECHA_PLANIFICACION <= '${sanitizeForSQL(dateTo)}'`;
        }
        const rows = await query(`
            SELECT H.ID, H.CODIGOVEHICULO, H.FECHA_PLANIFICACION,
                   H.PESO_TOTAL_KG, H.VOLUMEN_TOTAL_CM3, H.PCT_VOLUMEN, H.PCT_PESO,
                   H.NUM_ORDENES, H.NUM_BULTOS, H.ESTADO, H.CREATED_BY, H.CREATED_AT,
                   COALESCE(H.IMPORTE_TOTAL, 0) AS IMPORTE_TOTAL,
                   COALESCE(H.MARGEN_TOTAL, 0) AS MARGEN_TOTAL,
                   H.DETALLES_JSON,
                   TRIM(V.DESCRIPCIONVEHICULO) AS DESC_VEHICULO,
                   TRIM(V.MATRICULA) AS MATRICULA
            FROM JAVIER.ALMACEN_CARGA_HISTORICO H
            LEFT JOIN DSEDAC.VEH V ON TRIM(H.CODIGOVEHICULO) = TRIM(V.CODIGOVEHICULO)
            WHERE ${where}
            ORDER BY H.CREATED_AT DESC
            FETCH FIRST ${parseInt(limit)} ROWS ONLY
        `);
        res.json({
            history: rows.map(r => {
                let detalles = null;
                try {
                    const raw = r.DETALLES_JSON;
                    if (raw && raw !== '{}' && String(raw).trim().length > 2) {
                        detalles = JSON.parse(raw);
                    }
                } catch(e) { /* ignore */ }
                return {
                    id: r.ID,
                    vehicleCode: (r.CODIGOVEHICULO || '').trim(),
                    vehicleDesc: (r.DESC_VEHICULO || '').trim(),
                    matricula: (r.MATRICULA || '').trim(),
                    date: r.FECHA_PLANIFICACION,
                    weightKg: parseFloat(r.PESO_TOTAL_KG) || 0,
                    volumeCm3: parseFloat(r.VOLUMEN_TOTAL_CM3) || 0,
                    volumePct: parseFloat(r.PCT_VOLUMEN) || 0,
                    weightPct: parseFloat(r.PCT_PESO) || 0,
                    orderCount: r.NUM_ORDENES,
                    boxCount: r.NUM_BULTOS,
                    status: (r.ESTADO || '').trim(),
                    importeTotal: parseFloat(r.IMPORTE_TOTAL) || 0,
                    margenTotal: parseFloat(r.MARGEN_TOTAL) || 0,
                    detalles,
                    createdBy: (r.CREATED_BY || '').trim(),
                    createdAt: r.CREATED_AT,
                };
            }),
        });
    } catch (error) {
        if (isTableNotFound(error)) {
            return res.json({ history: [] });
        }
        // Fallback without new columns
        try {
            const { vehicleCode, limit = 50 } = req.query;
            let where = '1=1';
            if (vehicleCode) where = `CODIGOVEHICULO = '${sanitizeForSQL(vehicleCode)}'`;
            const rows = await query(`
                SELECT ID, CODIGOVEHICULO, FECHA_PLANIFICACION,
                       PESO_TOTAL_KG, VOLUMEN_TOTAL_CM3, PCT_VOLUMEN, PCT_PESO,
                       NUM_ORDENES, NUM_BULTOS, ESTADO, CREATED_BY, CREATED_AT
                FROM JAVIER.ALMACEN_CARGA_HISTORICO
                WHERE ${where}
                ORDER BY CREATED_AT DESC
                FETCH FIRST ${parseInt(limit)} ROWS ONLY
            `);
            return res.json({
                history: rows.map(r => ({
                    id: r.ID, vehicleCode: (r.CODIGOVEHICULO || '').trim(),
                    date: r.FECHA_PLANIFICACION,
                    weightKg: parseFloat(r.PESO_TOTAL_KG) || 0,
                    volumeCm3: parseFloat(r.VOLUMEN_TOTAL_CM3) || 0,
                    volumePct: parseFloat(r.PCT_VOLUMEN) || 0,
                    weightPct: parseFloat(r.PCT_PESO) || 0,
                    orderCount: r.NUM_ORDENES, boxCount: r.NUM_BULTOS,
                    status: (r.ESTADO || '').trim(),
                    importeTotal: 0, margenTotal: 0, detalles: null,
                    createdBy: (r.CREATED_BY || '').trim(), createdAt: r.CREATED_AT,
                })),
            });
        } catch (err2) {
            logger.error(`Load history fallback error: ${err2.message}`);
            res.status(500).json({ error: 'Error obteniendo historial', details: err2.message });
        }
    }
});

// =============================================================================
// MANUAL LAYOUT — Persistencia de layouts manuales del load planner
// =============================================================================

/**
 * GET /warehouse/manual-layout/:vehicleCode/:date
 * Recupera el layout manual guardado para un camion y fecha
 */
router.get('/manual-layout/:vehicleCode/:date', async (req, res) => {
    try {
        const code = sanitizeForSQL(req.params.vehicleCode.trim());
        const date = sanitizeForSQL(req.params.date.trim());

        const rows = await queryWithParams(`
            SELECT ID, CODIGOVEHICULO, FECHA_CARGA, VENDEDOR,
                   LAYOUT_JSON, METRICS_JSON, CREATED_AT, UPDATED_AT
            FROM JAVIER.ALMACEN_CARGA_MANUAL
            WHERE CODIGOVEHICULO = ?
              AND FECHA_CARGA = ?
        `, [code, date]);

        if (!rows.length) {
            return res.json({ found: false, layout: null });
        }

        const r = rows[0];
        let layoutData = {};
        let metricsData = {};
        try { layoutData = JSON.parse(r.LAYOUT_JSON || '{}'); } catch (e) { /* ignore */ }
        try { metricsData = JSON.parse(r.METRICS_JSON || '{}'); } catch (e) { /* ignore */ }

        res.json({
            found: true,
            layout: {
                id: r.ID,
                vehicleCode: (r.CODIGOVEHICULO || '').trim(),
                date: r.FECHA_CARGA,
                vendor: (r.VENDEDOR || '').trim(),
                boxes: layoutData.boxes || [],
                excludedOrders: layoutData.excludedOrders || [],
                metrics: metricsData,
                createdAt: r.CREATED_AT,
                updatedAt: r.UPDATED_AT,
            },
        });
    } catch (error) {
        // Any error = no saved layout. Never block the frontend 3D scene.
        logger.warn(`Get manual layout error (returning found:false): ${error.message}`);
        return res.json({ found: false, layout: null });
    }
});

/**
 * POST /warehouse/manual-layout
 * Guardar o actualizar layout manual (upsert por vehicleCode + date)
 * Body: { vehicleCode, date, vendor?, layoutJson, metricsJson? }
 */
router.post('/manual-layout', async (req, res) => {
    try {
        const { vehicleCode, date, vendor, layoutJson, metricsJson } = req.body;

        if (!vehicleCode || !date || !layoutJson) {
            return res.status(400).json({ error: 'vehicleCode, date y layoutJson son obligatorios' });
        }

        const code = sanitizeForSQL(vehicleCode.trim());
        const d = sanitizeForSQL(date.trim());
        const v = sanitizeForSQL((vendor || '').trim());
        const layout = typeof layoutJson === 'string' ? layoutJson : JSON.stringify(layoutJson);
        const metrics = typeof metricsJson === 'string' ? metricsJson : JSON.stringify(metricsJson || {});

        // Try update first
        const existing = await queryWithParams(`
            SELECT ID FROM JAVIER.ALMACEN_CARGA_MANUAL
            WHERE CODIGOVEHICULO = ? AND FECHA_CARGA = ?
        `, [code, d]);

        if (existing.length > 0) {
            await queryWithParams(`
                UPDATE JAVIER.ALMACEN_CARGA_MANUAL SET
                    LAYOUT_JSON = ?,
                    METRICS_JSON = ?,
                    VENDEDOR = ?,
                    UPDATED_AT = CURRENT_TIMESTAMP
                WHERE CODIGOVEHICULO = ? AND FECHA_CARGA = ?
            `, [layout, metrics, v, code, d]);
            res.json({ success: true, action: 'updated', id: existing[0].ID });
        } else {
            await queryWithParams(`
                INSERT INTO JAVIER.ALMACEN_CARGA_MANUAL
                    (CODIGOVEHICULO, FECHA_CARGA, VENDEDOR, LAYOUT_JSON, METRICS_JSON)
                VALUES (?, ?, ?, ?, ?)
            `, [code, d, v, layout, metrics]);
            res.json({ success: true, action: 'created' });
        }
    } catch (error) {
        if (isTableNotFound(error)) {
            return res.status(503).json({ error: 'Tabla ALMACEN_CARGA_MANUAL no disponible. Reinicia el servidor para crearla.' });
        }
        logger.error(`Save manual layout error: ${error.message}`);
        res.status(500).json({ error: 'Error guardando layout manual', details: error.message });
    }
});

/**
 * DELETE /warehouse/manual-layout/:id
 * Eliminar layout manual
 */
router.post('/manual-layout/:id/delete', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: 'ID invalido' });

        await query(`DELETE FROM JAVIER.ALMACEN_CARGA_MANUAL WHERE ID = ${id}`);
        res.json({ success: true });
    } catch (error) {
        if (isTableNotFound(error)) {
            return res.json({ success: true }); // nothing to delete
        }
        logger.error(`Delete manual layout error: ${error.message}`);
        res.status(500).json({ error: 'Error eliminando layout', details: error.message });
    }
});

// ═════════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN GLOBAL DEL ALMACÉN
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /warehouse/config
 * Devuelve toda la configuración global del almacén
 */
router.get('/config', async (req, res) => {
    try {
        const rows = await query('SELECT CLAVE, VALOR, DESCRIPCION FROM JAVIER.ALMACEN_CONFIG_GLOBAL ORDER BY CLAVE');
        const config = {};
        for (const r of rows) {
            config[(r.CLAVE || '').trim()] = {
                value: (r.VALOR || '').trim(),
                description: (r.DESCRIPCION || '').trim(),
            };
        }
        res.json({ config });
    } catch (error) {
        if (isTableNotFound(error)) {
            return res.json({ config: {} });
        }
        logger.error(`Config get error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo configuración', details: error.message });
    }
});

/**
 * PUT /warehouse/config
 * Body: { updates: { CLAVE: VALOR, ... } }
 * Actualiza configuración global (upsert por clave)
 */
router.put('/config', async (req, res) => {
    try {
        const { updates } = req.body;
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'updates es obligatorio (objeto clave:valor)' });
        }
        const user = sanitizeForSQL(req.user?.code || 'SYSTEM');
        for (const [key, value] of Object.entries(updates)) {
            const k = sanitizeForSQL(key).substring(0, 50);
            const v = sanitizeForSQL(String(value)).substring(0, 200);
            try {
                const upd = await queryWithParams(
                    `UPDATE JAVIER.ALMACEN_CONFIG_GLOBAL SET VALOR = ?, UPDATED_AT = CURRENT_TIMESTAMP, UPDATED_BY = ? WHERE CLAVE = ?`,
                    [v, user, k]
                );
                // Si no actualizó filas, insertar
                if (!upd || (Array.isArray(upd) && upd.length === 0)) {
                    await queryWithParams(
                        `INSERT INTO JAVIER.ALMACEN_CONFIG_GLOBAL (CLAVE, VALOR, UPDATED_BY) VALUES (?, ?, ?)`,
                        [k, v, user]
                    );
                }
            } catch (upsertErr) {
                // El UPDATE puede fallar si no existe → intentar INSERT
                try {
                    await queryWithParams(
                        `INSERT INTO JAVIER.ALMACEN_CONFIG_GLOBAL (CLAVE, VALOR, UPDATED_BY) VALUES (?, ?, ?)`,
                        [k, v, user]
                    );
                } catch (insErr) {
                    if (!(insErr.message || '').includes('SQL0803')) {
                        logger.warn(`Config upsert failed for ${k}: ${insErr.message}`);
                    }
                }
            }
        }
        res.json({ success: true });
    } catch (error) {
        logger.error(`Config update error: ${error.message}`);
        res.status(500).json({ error: 'Error actualizando configuración', details: error.message });
    }
});

/**
 * POST /warehouse/config/seed
 * Inserta valores por defecto si no existen (idempotente)
 */
router.post('/config/seed', async (req, res) => {
    try {
        const defaults = [
            { key: 'MAX_ALTURA_APILADO_CM', value: '150', desc: 'Altura máxima de apilado en cm' },
            { key: 'MARGEN_LATERAL_CM', value: '2', desc: 'Margen mínimo entre cajas y pared lateral' },
            { key: 'EQUILIBRIO_EJES', value: 'S', desc: 'Activar verificación de equilibrio de ejes' },
            { key: 'PCT_MAX_EJE_TRASERO', value: '60', desc: 'Peso máximo eje trasero (porcentaje)' },
            { key: 'HUECO_ENTRE_CAJAS_CM', value: '1', desc: 'Separación mínima entre cajas' },
            { key: 'PRIORIDAD_OPTIMIZAR', value: 'MARGEN', desc: 'Criterio auto-organizar: MARGEN, PESO o VOLUMEN' },
            { key: 'MUST_DELIVER_SIEMPRE', value: 'S', desc: 'Respetar siempre pedidos must-deliver' },
            { key: 'TOLERANCIA_GLOBAL_PCT', value: '5', desc: 'Tolerancia exceso global (porcentaje)' },
            { key: 'RESERVA_RETORNOS_PCT', value: '10', desc: 'Espacio reservado para retornos (porcentaje)' },
        ];
        let inserted = 0;
        for (const d of defaults) {
            try {
                await query(
                    `INSERT INTO JAVIER.ALMACEN_CONFIG_GLOBAL (CLAVE, VALOR, DESCRIPCION, UPDATED_BY) VALUES ('${d.key}', '${d.value}', '${d.desc}', 'SYSTEM')`
                );
                inserted++;
            } catch (e) {
                // Ya existe — ignorar (SQL0803 duplicate key)
            }
        }
        res.json({ success: true, inserted, total: defaults.length });
    } catch (error) {
        if (isTableNotFound(error)) {
            return res.status(503).json({ error: 'Tabla ALMACEN_CONFIG_GLOBAL no disponible. Reinicia el servidor.' });
        }
        logger.error(`Config seed error: ${error.message}`);
        res.status(500).json({ error: 'Error sembrando configuración', details: error.message });
    }
});

/**
 * POST /warehouse/save-load
 * Body: { vehicleCode, year, month, day, metrics, placed, overflow }
 * Guarda explícitamente la carga actual al histórico
 */
router.post('/save-load', async (req, res) => {
    try {
        const { vehicleCode, year, month, day, metrics, placed, overflow } = req.body;
        if (!vehicleCode || !metrics) {
            return res.status(400).json({ error: 'vehicleCode y metrics son obligatorios' });
        }

        const y = parseInt(year) || new Date().getFullYear();
        const m = parseInt(month) || (new Date().getMonth() + 1);
        const d = parseInt(day) || new Date().getDate();

        // Build client breakdown from placed boxes
        const clientBreakdown = {};
        for (const box of (placed || [])) {
            const cc = box.clientCode || 'DESCONOCIDO';
            if (!clientBreakdown[cc]) {
                clientBreakdown[cc] = { clientCode: cc, clientName: box.clientName || cc, boxes: 0, weightKg: 0, importeEur: 0, margenEur: 0, articles: {} };
            }
            clientBreakdown[cc].boxes++;
            clientBreakdown[cc].weightKg += (box.weight || 0);
            clientBreakdown[cc].importeEur += (box.importeEur || 0);
            clientBreakdown[cc].margenEur += (box.margenEur || 0);
            const artKey = box.articleCode || 'UNK';
            if (!clientBreakdown[cc].articles[artKey]) {
                clientBreakdown[cc].articles[artKey] = { code: artKey, name: box.label || artKey, boxes: 0, weightKg: 0, importeEur: 0, largoCm: box.largoCm || box.w || 0, anchoCm: box.anchoCm || box.d || 0, altoCm: box.altoCm || box.h || 0 };
            }
            clientBreakdown[cc].articles[artKey].boxes++;
            clientBreakdown[cc].articles[artKey].weightKg += (box.weight || 0);
            clientBreakdown[cc].articles[artKey].importeEur += (box.importeEur || 0);
        }
        const detalles = {
            clients: Object.values(clientBreakdown).map(c => ({
                ...c, articles: Object.values(c.articles),
                weightKg: Math.round(c.weightKg * 100) / 100,
                importeEur: Math.round(c.importeEur * 100) / 100,
                margenEur: Math.round(c.margenEur * 100) / 100,
            })),
            overflowCount: (overflow || []).length,
            savedManually: true,
        };
        let detallesManualStr = JSON.stringify(detalles);
        // Safety: compact if too large for ODBC buffer
        if (detallesManualStr.length > 500000) {
            for (const cl of (detalles.clients || [])) {
                for (const art of (cl.articles || [])) { delete art.name; }
                delete cl.clientName;
            }
            detallesManualStr = JSON.stringify(detalles);
        }

        await queryWithParams(`
            INSERT INTO JAVIER.ALMACEN_CARGA_HISTORICO
              (CODIGOVEHICULO, FECHA_PLANIFICACION, PESO_TOTAL_KG, VOLUMEN_TOTAL_CM3,
               PCT_VOLUMEN, PCT_PESO, NUM_ORDENES, NUM_BULTOS, ESTADO, CREATED_BY,
               IMPORTE_TOTAL, MARGEN_TOTAL, DETALLES_JSON)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            sanitizeForSQL(vehicleCode),
            `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
            metrics.totalWeightKg || 0,
            metrics.usedVolumeCm3 || 0,
            metrics.volumeOccupancyPct || 0,
            metrics.weightOccupancyPct || 0,
            metrics.placedCount || 0,
            metrics.totalBoxes || 0,
            sanitizeForSQL(metrics.status || 'GUARDADO'),
            sanitizeForSQL(req.user?.code || 'SYSTEM'),
            metrics.totalImporteEur || 0,
            metrics.totalMargenEur || 0,
            detallesManualStr
        ]);

        logger.info(`[SAVE-LOAD] Carga guardada manualmente: ${vehicleCode} ${y}-${m}-${d}`);
        res.json({ success: true, message: 'Carga guardada correctamente' });
    } catch (error) {
        if (isTableNotFound(error)) {
            return res.status(503).json({ error: 'Tabla de histórico no disponible. Reinicia el servidor.' });
        }
        logger.error(`Save load error: ${error.message}`);
        res.status(500).json({ error: 'Error guardando carga', details: error.message });
    }
});

module.exports = router;
module.exports.initWarehouseTables = initWarehouseTables;
