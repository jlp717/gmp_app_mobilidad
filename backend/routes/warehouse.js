/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WAREHOUSE ROUTES — API para Almacén / Expediciones / Load Planner 3D
 * ═══════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const logger = require('../middleware/logger');
const { query } = require('../config/db');
const loadPlanner = require('../services/loadPlanner');

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
               COALESCE(C.TOLERANCIA_EXCESO, 5)
      ORDER BY TRIM(OPP.CODIGOVEHICULO)
    `);

        res.json({
            date: { year, month, day },
            totalTrucks: trucks.length,
            trucks: trucks.map(t => ({
                vehicleCode: (t.VEHICULO || '').trim(),
                description: (t.DESCRIPCION || '').trim(),
                matricula: (t.MATRICULA || '').trim(),
                driverCode: (t.REPARTIDOR || '').trim(),
                driverName: (t.NOMBRE_REPARTIDOR || '').trim(),
                orderCount: parseInt(t.NUM_ORDENES) || 0,
                lineCount: parseInt(t.NUM_LINEAS) || 0,
                maxPayloadKg: parseFloat(t.CARGAMAXIMA) > 0
                    ? parseFloat(t.CARGAMAXIMA)
                    : Math.round((parseFloat(t.CONTENEDORVOLUMEN) || 1) * 350),
                containerVolume: parseFloat(t.CONTENEDORVOLUMEN) || 0,
                tolerancePct: parseFloat(t.TOLERANCIA) || 5,
            })),
        });
    } catch (error) {
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

        if (!vehicleCode) {
            return res.status(400).json({ error: 'vehicleCode es obligatorio' });
        }

        const now = new Date();
        const y = parseInt(year) || now.getFullYear();
        const m = parseInt(month) || (now.getMonth() + 1);
        const d = parseInt(day) || now.getDate();

        const result = await loadPlanner.planLoad(vehicleCode, y, m, d, tolerance);

        // Save to history
        try {
            await query(`
        INSERT INTO JAVIER.ALMACEN_CARGA_HISTORICO
          (CODIGOVEHICULO, FECHA_PLANIFICACION, PESO_TOTAL_KG, VOLUMEN_TOTAL_CM3,
           PCT_VOLUMEN, PCT_PESO, NUM_ORDENES, NUM_BULTOS, ESTADO, CREATED_BY)
        VALUES (
          '${vehicleCode.replace(/'/g, "''")}',
          '${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}',
          ${result.metrics.totalWeightKg},
          ${result.metrics.usedVolumeCm3},
          ${result.metrics.volumeOccupancyPct},
          ${result.metrics.weightOccupancyPct || 0},
          ${result.metrics.placedCount},
          ${result.metrics.totalBoxes},
          '${result.metrics.status}',
          '${(req.user?.code || 'SYSTEM').replace(/'/g, "''")}'
        )
      `);
        } catch (histErr) {
            logger.warn(`Error guardando histórico carga: ${histErr.message}`);
        }

        res.json(result);
    } catch (error) {
        logger.error(`Load plan error: ${error.message}`);
        res.status(500).json({ error: 'Error planificando carga', details: error.message });
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
        const vehicles = await query(`
      SELECT 
        TRIM(V.CODIGOVEHICULO) AS CODE,
        TRIM(V.DESCRIPCIONVEHICULO) AS DESCRIPCION,
        TRIM(V.MATRICULA) AS MATRICULA,
        V.CARGAMAXIMA, V.TARA, V.VOLUMEN, V.CONTENEDORVOLUMEN,
        TRIM(V.CODIGOTIPOVEHICULO) AS TIPO,
        V.VEHICULOPROPIOSN AS PROPIO,
        TRIM(V.CODIGOREPARTIDOR) AS REPARTIDOR_DEF,
        C.LARGO_INTERIOR_CM, C.ANCHO_INTERIOR_CM, C.ALTO_INTERIOR_CM,
        C.TOLERANCIA_EXCESO
      FROM DSEDAC.VEH V
      LEFT JOIN JAVIER.ALMACEN_CAMIONES_CONFIG C 
        ON TRIM(V.CODIGOVEHICULO) = C.CODIGOVEHICULO
      ORDER BY V.CODIGOVEHICULO
    `);

        res.json({
            vehicles: vehicles.map(v => ({
                code: v.CODE,
                description: (v.DESCRIPCION || '').trim(),
                matricula: (v.MATRICULA || '').trim(),
                maxPayloadKg: parseFloat(v.CARGAMAXIMA) || 0,
                tara: parseFloat(v.TARA) || 0,
                volumeM3: parseFloat(v.VOLUMEN) || 0,
                containerVolumeM3: parseFloat(v.CONTENEDORVOLUMEN) || 0,
                type: (v.TIPO || '').trim(),
                isOwned: v.PROPIO === 'S',
                defaultDriver: (v.REPARTIDOR_DEF || '').trim(),
                interior: {
                    lengthCm: parseFloat(v.LARGO_INTERIOR_CM) || 600,
                    widthCm: parseFloat(v.ANCHO_INTERIOR_CM) || 240,
                    heightCm: parseFloat(v.ALTO_INTERIOR_CM) || 220,
                },
                tolerancePct: parseFloat(v.TOLERANCIA_EXCESO) || 5,
            })),
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
        const code = req.params.vehicleCode.replace(/'/g, "''");
        const { largoInteriorCm, anchoInteriorCm, altoInteriorCm, toleranciaExceso, notas } = req.body;

        // Upsert
        try {
            await query(`
        UPDATE JAVIER.ALMACEN_CAMIONES_CONFIG SET
          LARGO_INTERIOR_CM = ${parseFloat(largoInteriorCm) || 600},
          ANCHO_INTERIOR_CM = ${parseFloat(anchoInteriorCm) || 240},
          ALTO_INTERIOR_CM = ${parseFloat(altoInteriorCm) || 220},
          TOLERANCIA_EXCESO = ${parseFloat(toleranciaExceso) || 5},
          NOTAS = '${(notas || '').replace(/'/g, "''").substring(0, 250)}',
          UPDATED_AT = CURRENT_TIMESTAMP,
          UPDATED_BY = '${(req.user?.code || 'SYSTEM').replace(/'/g, "''")}'
        WHERE CODIGOVEHICULO = '${code}'
      `);
        } catch (updateErr) {
            // Try insert if update didn't match
            await query(`
        INSERT INTO JAVIER.ALMACEN_CAMIONES_CONFIG
          (CODIGOVEHICULO, LARGO_INTERIOR_CM, ANCHO_INTERIOR_CM, ALTO_INTERIOR_CM, TOLERANCIA_EXCESO, NOTAS, UPDATED_BY)
        VALUES ('${code}', ${parseFloat(largoInteriorCm) || 600}, ${parseFloat(anchoInteriorCm) || 240},
                ${parseFloat(altoInteriorCm) || 220}, ${parseFloat(toleranciaExceso) || 5},
                '${(notas || '').replace(/'/g, "''").substring(0, 250)}',
                '${(req.user?.code || 'SYSTEM').replace(/'/g, "''")}')
      `);
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
        const customRows = await query(`
      SELECT ID, NOMBRE, CODIGO_VENDEDOR, ROL, ACTIVO, TELEFONO, EMAIL, CREATED_AT
      FROM JAVIER.ALMACEN_PERSONAL
      WHERE ACTIVO = 'S'
      ORDER BY NOMBRE
    `);

        // Also get all repartidores/vendedores from DSEDAC.VDD
        let vddRows = [];
        try {
            vddRows = await query(`
          SELECT
            TRIM(VDD.CODIGOVENDEDOR) AS CODIGO,
            TRIM(VDD.NOMBREVENDEDOR) AS NOMBRE
          FROM DSEDAC.VDD VDD
          WHERE TRIM(VDD.NOMBREVENDEDOR) <> ''
          ORDER BY VDD.NOMBREVENDEDOR
        `);
            logger.info(`Personnel: got ${vddRows.length} VDD entries`);
        } catch (vddErr) {
            logger.warn(`VDD query failed (will show only custom personnel): ${vddErr.message}`);
        }

        // Merge: custom personnel + VDD entries not already in custom table
        const customCodes = new Set(customRows.map(r => (r.CODIGO_VENDEDOR || '').trim()));

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

        for (const v of vddRows) {
            const code = (v.CODIGO || '').trim();
            if (code && !customCodes.has(code)) {
                personnel.push({
                    id: 'VDD-' + code,
                    name: (v.NOMBRE || '').trim(),
                    vendorCode: code,
                    role: 'REPARTIDOR',
                    active: true,
                    phone: '',
                    email: '',
                    source: 'vdd',
                });
            }
        }

        personnel.sort((a, b) => a.name.localeCompare(b.name));

        res.json({ personnel });
    } catch (error) {
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

        await query(`
      INSERT INTO JAVIER.ALMACEN_PERSONAL (NOMBRE, CODIGO_VENDEDOR, ROL, TELEFONO, EMAIL)
      VALUES (
        '${nombre.replace(/'/g, "''").substring(0, 100)}',
        '${(codigoVendedor || '').replace(/'/g, "''").substring(0, 20)}',
        '${(rol || 'PREPARADOR').replace(/'/g, "''").substring(0, 30)}',
        '${(telefono || '').replace(/'/g, "''").substring(0, 20)}',
        '${(email || '').replace(/'/g, "''").substring(0, 100)}'
      )
    `);

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
        if (nombre) sets.push(`NOMBRE = '${nombre.replace(/'/g, "''").substring(0, 100)}'`);
        if (codigoVendedor !== undefined) sets.push(`CODIGO_VENDEDOR = '${codigoVendedor.replace(/'/g, "''")}'`);
        if (rol) sets.push(`ROL = '${rol.replace(/'/g, "''")}'`);
        if (telefono !== undefined) sets.push(`TELEFONO = '${telefono.replace(/'/g, "''")}'`);
        if (email !== undefined) sets.push(`EMAIL = '${email.replace(/'/g, "''")}'`);
        if (activo !== undefined) sets.push(`ACTIVO = '${activo ? 'S' : 'N'}'`);
        sets.push('UPDATED_AT = CURRENT_TIMESTAMP');

        await query(`UPDATE JAVIER.ALMACEN_PERSONAL SET ${sets.join(', ')} WHERE ID = ${id}`);
        res.json({ success: true });
    } catch (error) {
        logger.error(`Update personnel error: ${error.message}`);
        res.status(500).json({ error: 'Error actualizando operario', details: error.message });
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
        const code = req.params.code.replace(/'/g, "''").trim();
        const rows = await query(`
      SELECT 
        TRIM(A.CODIGOARTICULO) AS CODE,
        TRIM(A.DESCRIPCIONARTICULO) AS NOMBRE,
        A.PESO, A.UNIDADESCAJA,
        D.LARGO_CM, D.ANCHO_CM, D.ALTO_CM, D.PESO_CAJA_KG, D.NOTAS
      FROM DSEDAC.ART A
      LEFT JOIN JAVIER.ALMACEN_ART_DIMENSIONES D ON TRIM(A.CODIGOARTICULO) = D.CODIGOARTICULO
      WHERE TRIM(A.CODIGOARTICULO) = '${code}'
    `);

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
        const code = req.params.code.replace(/'/g, "''").trim();
        const { largoCm, anchoCm, altoCm, pesoCajaKg, notas } = req.body;

        // Upsert via DELETE + INSERT (DB2 i5/OS compatible)
        try {
            await query(`DELETE FROM JAVIER.ALMACEN_ART_DIMENSIONES WHERE CODIGOARTICULO = '${code}'`);
        } catch (e) { /* might not exist */ }

        await query(`
      INSERT INTO JAVIER.ALMACEN_ART_DIMENSIONES
        (CODIGOARTICULO, LARGO_CM, ANCHO_CM, ALTO_CM, PESO_CAJA_KG, NOTAS, UPDATED_AT, UPDATED_BY)
      VALUES (
        '${code}',
        ${parseFloat(largoCm) || 30},
        ${parseFloat(anchoCm) || 20},
        ${parseFloat(altoCm) || 15},
        ${pesoCajaKg ? parseFloat(pesoCajaKg) : 'NULL'},
        '${(notas || '').replace(/'/g, "''").substring(0, 200)}',
        CURRENT_TIMESTAMP,
        '${(req.user?.code || 'SYSTEM').replace(/'/g, "''")}'
      )
    `);

        res.json({ success: true, message: 'Dimensiones actualizadas' });
    } catch (error) {
        logger.error(`Update article dims error: ${error.message}`);
        res.status(500).json({ error: 'Error actualizando dimensiones', details: error.message });
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
        const code = req.params.vehicleCode.replace(/'/g, "''");
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
        logger.error(`Truck orders error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo órdenes', details: error.message });
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
        const { vehicleCode, limit = 20 } = req.query;
        let where = '1=1';
        if (vehicleCode) {
            where = `CODIGOVEHICULO = '${vehicleCode.replace(/'/g, "''")}'`;
        }

        const rows = await query(`
      SELECT ID, CODIGOVEHICULO, FECHA_PLANIFICACION,
             PESO_TOTAL_KG, VOLUMEN_TOTAL_CM3, PCT_VOLUMEN, PCT_PESO,
             NUM_ORDENES, NUM_BULTOS, ESTADO, CREATED_BY, CREATED_AT
      FROM JAVIER.ALMACEN_CARGA_HISTORICO
      WHERE ${where}
      ORDER BY CREATED_AT DESC
      FETCH FIRST ${parseInt(limit)} ROWS ONLY
    `);

        res.json({
            history: rows.map(r => ({
                id: r.ID,
                vehicleCode: (r.CODIGOVEHICULO || '').trim(),
                date: r.FECHA_PLANIFICACION,
                weightKg: parseFloat(r.PESO_TOTAL_KG) || 0,
                volumeCm3: parseFloat(r.VOLUMEN_TOTAL_CM3) || 0,
                volumePct: parseFloat(r.PCT_VOLUMEN) || 0,
                weightPct: parseFloat(r.PCT_PESO) || 0,
                orderCount: r.NUM_ORDENES,
                boxCount: r.NUM_BULTOS,
                status: (r.ESTADO || '').trim(),
                createdBy: (r.CREATED_BY || '').trim(),
                createdAt: r.CREATED_AT,
            })),
        });
    } catch (error) {
        logger.error(`Load history error: ${error.message}`);
        res.status(500).json({ error: 'Error obteniendo historial', details: error.message });
    }
});

module.exports = router;
