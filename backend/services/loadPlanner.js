/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LOAD PLANNER SERVICE — 3D Bin Packing para camiones
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Simula la carga de un camión con cajas de pedidos, calculando la posición
 * (x,y,z) de cada bulto usando un algoritmo de shelf-packing por capas.
 *
 * @module services/loadPlanner
 */

const { query } = require('../config/db');
const logger = require('../middleware/logger');

// ─────────────────────────────────────────────────────────────────────────────
// DIMENSION ESTIMATION — estimates box size from weight when no real dims
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_WEIGHT_PER_BOX = 8.0; // kg

/**
 * Estima dimensiones de caja basándose en el peso.
 * Productos más pesados → cajas más grandes (proporcional).
 */
function estimateBoxDimensions(pesoUnidad, unidadesCaja) {
    const pesoCaja = (pesoUnidad || 0) * Math.max(unidadesCaja || 1, 1);
    if (pesoCaja <= 2) return { largo: 30, ancho: 20, alto: 12 };
    if (pesoCaja <= 5) return { largo: 35, ancho: 25, alto: 15 };
    if (pesoCaja <= 10) return { largo: 40, ancho: 30, alto: 18 };
    if (pesoCaja <= 20) return { largo: 50, ancho: 35, alto: 22 };
    if (pesoCaja <= 35) return { largo: 55, ancho: 40, alto: 25 };
    return { largo: 60, ancho: 40, alto: 30 };
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA ACCESS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recupera la configuración del camión (dimensiones interiores + capacidad)
 * Combina datos de DSEDAC.VEH con JAVIER.ALMACEN_CAMIONES_CONFIG
 * Si CARGAMAXIMA=0, estima desde CONTENEDORVOLUMEN
 */
async function getTruckConfig(vehicleCode) {
    const rows = await query(`
    SELECT
      TRIM(V.CODIGOVEHICULO) AS CODE,
      TRIM(V.DESCRIPCIONVEHICULO) AS DESCRIPCION,
      TRIM(V.MATRICULA) AS MATRICULA,
      V.CARGAMAXIMA,
      V.TARA,
      V.VOLUMEN AS VOLUMEN_VEH,
      V.CONTENEDORVOLUMEN,
      COALESCE(C.LARGO_INTERIOR_CM, 0) AS LARGO_CM,
      COALESCE(C.ANCHO_INTERIOR_CM, 0) AS ANCHO_CM,
      COALESCE(C.ALTO_INTERIOR_CM, 0) AS ALTO_CM,
      COALESCE(C.TOLERANCIA_EXCESO, 5.00) AS TOLERANCIA
    FROM DSEDAC.VEH V
    LEFT JOIN JAVIER.ALMACEN_CAMIONES_CONFIG C
      ON TRIM(V.CODIGOVEHICULO) = C.CODIGOVEHICULO
    WHERE TRIM(V.CODIGOVEHICULO) = '${vehicleCode.replace(/'/g, "''")}'
  `);

    if (!rows.length) return null;

    const r = rows[0];
    const rawContVol = parseFloat(r.CONTENEDORVOLUMEN) || 0;

    // CONTENEDORVOLUMEN en DB2 a veces es m³ reales, a veces litros/1000, a veces 0.
    // Un camión de reparto real tiene entre 10-40 m³ de carga.
    // Si el valor es < 3 m³, es irreal → usar default de camión estándar (20 m³).
    const contVolM3 = rawContVol >= 3 ? rawContVol : 20;

    // Estimate payload: CARGAMAXIMA is 0 for most trucks in this DB
    // Use CONTENEDORVOLUMEN * 300 kg/m³ as reasonable estimate (mixed goods density)
    const maxPayload = parseFloat(r.CARGAMAXIMA) > 0
        ? parseFloat(r.CARGAMAXIMA)
        : Math.round(contVolM3 * 300);

    // Interior dimensions: if ALMACEN_CAMIONES_CONFIG has custom values use them,
    // otherwise estimate from CONTENEDORVOLUMEN
    let lengthCm = parseFloat(r.LARGO_CM);
    let widthCm = parseFloat(r.ANCHO_CM);
    let heightCm = parseFloat(r.ALTO_CM);

    if (lengthCm === 0 || widthCm === 0 || heightCm === 0) {
        // Estimate dimensions from volume with typical truck ratios L:W:H ≈ 2.5:1:0.8
        const w3 = (contVolM3 * 1e6) / (2.5 * 0.8);
        widthCm = Math.round(Math.cbrt(w3));
        lengthCm = Math.round(widthCm * 2.5);
        heightCm = Math.round(widthCm * 0.8);
    }

    // Determine vehicle type from description
    const desc = (r.DESCRIPCION || '').toUpperCase();
    const vehicleType = desc.includes('FURGONETA') || desc.includes('FURGO')
        ? 'VAN' : 'TRUCK';

    return {
        code: r.CODE,
        description: (r.DESCRIPCION || '').trim(),
        matricula: (r.MATRICULA || '').trim(),
        vehicleType,
        maxPayloadKg: maxPayload,
        tara: parseFloat(r.TARA) || 0,
        containerVolumeM3: contVolM3,
        interior: { lengthCm, widthCm, heightCm },
        tolerancePct: parseFloat(r.TOLERANCIA),
        volumeM3: (lengthCm * widthCm * heightCm) / 1e6,
    };
}

/**
 * Recupera dimensiones de los artículos, con fallback a estimaciones
 */
async function getArticleDimensions(articleCodes) {
    if (!articleCodes.length) return {};

    const codeList = articleCodes.map(c => `'${c.replace(/'/g, "''")}'`).join(',');

    const rows = await query(`
    SELECT
      TRIM(A.CODIGOARTICULO) AS CODE,
      TRIM(A.DESCRIPCIONARTICULO) AS NOMBRE,
      COALESCE(A.PESO, 0) AS PESO,
      COALESCE(A.UNIDADESCAJA, 1) AS UDS_CAJA,
      D.LARGO_CM, D.ANCHO_CM, D.ALTO_CM, D.PESO_CAJA_KG
    FROM DSEDAC.ART A
    LEFT JOIN JAVIER.ALMACEN_ART_DIMENSIONES D
      ON TRIM(A.CODIGOARTICULO) = D.CODIGOARTICULO
    WHERE TRIM(A.CODIGOARTICULO) IN (${codeList})
  `);

    const result = {};
    for (const r of rows) {
        const hasDimensions = r.LARGO_CM != null && r.ANCHO_CM != null && r.ALTO_CM != null;
        const pesoUd = parseFloat(r.PESO) || 0;
        const udsCaja = parseInt(r.UDS_CAJA) || 1;
        const weight = parseFloat(r.PESO_CAJA_KG) || pesoUd || DEFAULT_WEIGHT_PER_BOX;

        // Use real dimensions if available, otherwise estimate from weight
        const estimated = estimateBoxDimensions(pesoUd, udsCaja);

        result[r.CODE] = {
            code: r.CODE,
            name: (r.NOMBRE || '').trim(),
            largoCm: hasDimensions ? parseFloat(r.LARGO_CM) : estimated.largo,
            anchoCm: hasDimensions ? parseFloat(r.ANCHO_CM) : estimated.ancho,
            altoCm: hasDimensions ? parseFloat(r.ALTO_CM) : estimated.alto,
            weightKg: weight,
            unitsPerBox: udsCaja,
            estimated: !hasDimensions,
        };
    }

    // Fallback for articles not found in ART table
    const defaultDims = estimateBoxDimensions(DEFAULT_WEIGHT_PER_BOX, 1);
    for (const code of articleCodes) {
        if (!result[code]) {
            result[code] = {
                code,
                name: 'Desconocido',
                largoCm: defaultDims.largo,
                anchoCm: defaultDims.ancho,
                altoCm: defaultDims.alto,
                weightKg: DEFAULT_WEIGHT_PER_BOX,
                unitsPerBox: 1,
                estimated: true,
            };
        }
    }

    return result;
}

/**
 * Recupera las órdenes OPP para un vehículo y fecha
 */
async function getOrdersForVehicle(vehicleCode, year, month, day) {
    const rows = await query(`
    SELECT
      OPP.EJERCICIOORDENPREPARACION AS EJERCICIO,
      OPP.NUMEROORDENPREPARACION AS NUM_ORDEN,
      TRIM(OPP.CODIGOREPARTIDOR) AS REPARTIDOR,
      TRIM(OPP.CODIGOVEHICULO) AS VEHICULO,
      OPP.DIAREPARTO, OPP.MESREPARTO, OPP.ANOREPARTO,
      TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE,
      TRIM(LAC.CODIGOARTICULO) AS ARTICULO,
      LAC.CANTIDADUNIDADES AS CANTIDAD,
      LAC.CANTIDADENVASES AS CAJAS
    FROM DSEDAC.OPP OPP
    INNER JOIN DSEDAC.CPC CPC
      ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
      AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
    INNER JOIN DSEDAC.LAC LAC
      ON CPC.NUMEROALBARAN = LAC.NUMEROALBARAN
      AND CPC.EJERCICIOALBARAN = LAC.EJERCICIOALBARAN
      AND TRIM(CPC.SERIEALBARAN) = TRIM(LAC.SERIEALBARAN)
    WHERE TRIM(OPP.CODIGOVEHICULO) = '${vehicleCode.replace(/'/g, "''")}'
      AND OPP.ANOREPARTO = ${parseInt(year)}
      AND OPP.MESREPARTO = ${parseInt(month)}
      AND OPP.DIAREPARTO = ${parseInt(day)}
    ORDER BY OPP.NUMEROORDENPREPARACION
  `);

    return rows.map(r => ({
        id: r.EJERCICIO + '-' + r.NUM_ORDEN,
        orderYear: r.EJERCICIO,
        orderNumber: r.NUM_ORDEN,
        driverCode: r.REPARTIDOR,
        clientCode: (r.CLIENTE || '').trim(),
        articleCode: (r.ARTICULO || '').trim(),
        units: parseFloat(r.CANTIDAD) || 0,
        boxes: parseFloat(r.CAJAS) || 0,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3D BIN PACKING — Shelf/Layer packing (robust, no fragmentation issues)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Algoritmo de Bin Packing 3D por capas (shelf packing).
 * Llena el camión capa por capa, fila por fila, de abajo a arriba.
 * Mucho más robusto que LAFF para cajas de tamaño similar.
 *
 * @param {Array} boxes - [{id, w, d, h, weight, label, ...}]
 * @param {Object} interior - {lengthCm, widthCm, heightCm}
 * @param {number} tolerancePct - % exceso permitido
 * @returns {Object} - {placed, overflow, metrics}
 */
function binPack3D(boxes, interior, tolerancePct = 5) {
    const cW = interior.widthCm;
    const cD = interior.lengthCm;
    const cH = interior.heightCm;

    // Sort boxes: largest volume first
    const sorted = [...boxes].sort((a, b) => (b.w * b.d * b.h) - (a.w * a.d * a.h));

    const placed = [];
    const overflow = [];

    // Current position cursors
    let curX = 0;      // across width
    let curY = 0;      // along length (depth)
    let curZ = 0;      // height (layer)
    let rowMaxH = 0;   // tallest box in current row
    let layerMaxD = 0; // deepest box in current layer

    for (const box of sorted) {
        // Try best rotation: prefer laying flat (smallest h) for stable stacking
        const rots = [
            { w: box.w, d: box.d, h: box.h },
            { w: box.w, d: box.h, h: box.d },
            { w: box.d, d: box.w, h: box.h },
            { w: box.d, d: box.h, h: box.w },
            { w: box.h, d: box.w, h: box.d },
            { w: box.h, d: box.d, h: box.w },
        ];

        // Pick rotation with smallest height that fits
        const validRots = rots
            .filter(r => r.w <= cW && r.d <= cD && r.h <= cH)
            .sort((a, b) => a.h - b.h);

        if (!validRots.length) {
            overflow.push({ ...box });
            continue;
        }

        let placedThis = false;

        for (const rot of validRots) {
            // Try current position
            if (curX + rot.w <= cW && curY + rot.d <= cD && curZ + rot.h <= cH) {
                placed.push({
                    id: box.id, label: box.label,
                    orderNumber: box.orderNumber, clientCode: box.clientCode,
                    articleCode: box.articleCode, weight: box.weight,
                    x: curX, y: curY, z: curZ,
                    w: rot.w, d: rot.d, h: rot.h,
                });
                rowMaxH = Math.max(rowMaxH, rot.h);
                layerMaxD = Math.max(layerMaxD, rot.d);
                curX += rot.w;
                placedThis = true;
                break;
            }

            // Next row in same layer
            if (curY + layerMaxD + rot.d <= cD && rot.w <= cW && curZ + rot.h <= cH) {
                curX = 0;
                curY += layerMaxD;
                layerMaxD = 0;
                rowMaxH = 0;

                if (curX + rot.w <= cW && curY + rot.d <= cD && curZ + rot.h <= cH) {
                    placed.push({
                        id: box.id, label: box.label,
                        orderNumber: box.orderNumber, clientCode: box.clientCode,
                        articleCode: box.articleCode, weight: box.weight,
                        x: curX, y: curY, z: curZ,
                        w: rot.w, d: rot.d, h: rot.h,
                    });
                    rowMaxH = Math.max(rowMaxH, rot.h);
                    layerMaxD = Math.max(layerMaxD, rot.d);
                    curX += rot.w;
                    placedThis = true;
                    break;
                }
            }

            // Next layer (go up)
            if (curZ + rowMaxH + rot.h <= cH && rot.w <= cW && rot.d <= cD) {
                curX = 0;
                curY = 0;
                curZ += rowMaxH || rot.h;
                rowMaxH = 0;
                layerMaxD = 0;

                if (curX + rot.w <= cW && curY + rot.d <= cD && curZ + rot.h <= cH) {
                    placed.push({
                        id: box.id, label: box.label,
                        orderNumber: box.orderNumber, clientCode: box.clientCode,
                        articleCode: box.articleCode, weight: box.weight,
                        x: curX, y: curY, z: curZ,
                        w: rot.w, d: rot.d, h: rot.h,
                    });
                    rowMaxH = Math.max(rowMaxH, rot.h);
                    layerMaxD = Math.max(layerMaxD, rot.d);
                    curX += rot.w;
                    placedThis = true;
                    break;
                }
            }
        }

        if (!placedThis) {
            overflow.push({
                id: box.id, label: box.label,
                orderNumber: box.orderNumber, clientCode: box.clientCode,
                articleCode: box.articleCode, weight: box.weight,
                w: box.w, d: box.d, h: box.h,
            });
        }
    }

    // Metrics
    const containerVolume = cW * cD * cH;
    const usedVolume = placed.reduce((sum, b) => sum + (b.w * b.d * b.h), 0);
    const totalWeight = placed.reduce((sum, b) => sum + b.weight, 0);
    const overflowVolume = overflow.reduce((sum, b) => sum + (b.w * b.d * b.h), 0);
    const overflowWeight = overflow.reduce((sum, b) => sum + b.weight, 0);
    const totalDemandVolume = usedVolume + overflowVolume;
    const totalDemandWeight = totalWeight + overflowWeight;

    return {
        placed,
        overflow,
        metrics: {
            totalBoxes: boxes.length,
            placedCount: placed.length,
            overflowCount: overflow.length,
            containerVolumeCm3: containerVolume,
            usedVolumeCm3: usedVolume,
            volumeOccupancyPct: containerVolume > 0
                ? Math.round((usedVolume / containerVolume) * 10000) / 100 : 0,
            totalWeightKg: Math.round(totalWeight * 100) / 100,
            overflowWeightKg: Math.round(overflowWeight * 100) / 100,
            // Total demand (placed + overflow) vs capacity
            totalDemandVolumeCm3: totalDemandVolume,
            totalDemandWeightKg: Math.round(totalDemandWeight * 100) / 100,
            demandVsCapacityPct: containerVolume > 0
                ? Math.round((totalDemandVolume / containerVolume) * 10000) / 100 : 0,
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Planifica la carga de un camión para una fecha dada.
 */
async function planLoad(vehicleCode, year, month, day, customTolerance) {
    // 1. Get truck config
    const truck = await getTruckConfig(vehicleCode);
    if (!truck) {
        throw new Error(`Vehículo '${vehicleCode}' no encontrado en DSEDAC.VEH`);
    }

    // 2. Get orders
    const orders = await getOrdersForVehicle(vehicleCode, year, month, day);
    if (!orders.length) {
        return {
            truck,
            boxes: [],
            placed: [],
            overflow: [],
            metrics: {
                totalBoxes: 0, placedCount: 0, overflowCount: 0,
                containerVolumeCm3: truck.interior.lengthCm * truck.interior.widthCm * truck.interior.heightCm,
                usedVolumeCm3: 0, volumeOccupancyPct: 0,
                totalWeightKg: 0, overflowWeightKg: 0,
                maxPayloadKg: truck.maxPayloadKg, weightOccupancyPct: 0,
                status: 'SEGURO',
            },
        };
    }

    // 3. Get article dimensions
    const articleCodes = [...new Set(orders.map(o => o.articleCode).filter(Boolean))];
    const dimensions = await getArticleDimensions(articleCodes);

    // 4. Build box list from orders
    // CANTIDADENVASES = physical boxes/cases, CANTIDADUNIDADES = individual items
    // Each ENVASE is one 3D box. If envases=0, treat the line as 1 box.
    const boxes = [];
    let boxId = 0;
    for (const order of orders) {
        const fallbackDims = estimateBoxDimensions(order.weightPerUnit || DEFAULT_WEIGHT_PER_BOX, 1);
        const dim = dimensions[order.articleCode] || {
            largoCm: fallbackDims.largo,
            anchoCm: fallbackDims.ancho,
            altoCm: fallbackDims.alto,
            weightKg: DEFAULT_WEIGHT_PER_BOX,
            unitsPerBox: 1,
            name: 'Desconocido',
        };

        // Physical boxes: use CANTIDADENVASES if > 0, otherwise 1 per line
        const numBoxes = order.boxes > 0 ? Math.round(order.boxes) : 1;

        // Total weight for this line (units * weight per unit)
        const lineWeight = order.units > 0
            ? order.units * (dim.weightKg || DEFAULT_WEIGHT_PER_BOX)
            : numBoxes * (dim.weightKg || DEFAULT_WEIGHT_PER_BOX);
        const weightPerBox = lineWeight / numBoxes;

        for (let i = 0; i < numBoxes; i++) {
            boxes.push({
                id: boxId++,
                w: dim.largoCm,
                d: dim.anchoCm,
                h: dim.altoCm,
                weight: weightPerBox > 0 ? weightPerBox : DEFAULT_WEIGHT_PER_BOX,
                label: dim.name,
                orderNumber: order.orderNumber,
                clientCode: order.clientCode,
                articleCode: order.articleCode,
            });
        }
    }

    logger.info(`Load plan ${vehicleCode}: ${orders.length} order lines → ${boxes.length} physical boxes`);

    // 5. Run bin packing
    const tolerance = customTolerance ?? truck.tolerancePct;
    const result = binPack3D(boxes, truck.interior, tolerance);

    // 6. Add weight capacity
    const weightCapacity = truck.maxPayloadKg;
    result.metrics.maxPayloadKg = weightCapacity;
    result.metrics.weightOccupancyPct = weightCapacity > 0
        ? Math.round((result.metrics.totalWeightKg / weightCapacity) * 10000) / 100
        : 0;

    // Status
    const volPct = result.metrics.volumeOccupancyPct;
    const wPct = result.metrics.weightOccupancyPct;
    if (result.overflow.length > 0) {
        result.metrics.status = 'EXCESO';
    } else if (volPct >= 90 || wPct >= 90) {
        result.metrics.status = 'OPTIMO';
    } else {
        result.metrics.status = 'SEGURO';
    }

    return {
        truck,
        date: { year, month, day },
        tolerancePct: tolerance,
        ...result,
    };
}

/**
 * Planifica la carga con una lista explícita de pedidos (simulaciones "what-if")
 */
async function planLoadManual(vehicleCode, items, customTolerance) {
    const truck = await getTruckConfig(vehicleCode);
    if (!truck) {
        throw new Error(`Vehículo '${vehicleCode}' no encontrado`);
    }

    const articleCodes = [...new Set(items.map(i => i.articleCode).filter(Boolean))];
    const dimensions = await getArticleDimensions(articleCodes);

    const boxes = [];
    let boxId = 0;
    for (const item of items) {
        const fallbackDims = estimateBoxDimensions(item.weightKg || DEFAULT_WEIGHT_PER_BOX, 1);
        const dim = dimensions[item.articleCode] || {
            largoCm: item.largoCm || fallbackDims.largo,
            anchoCm: item.anchoCm || fallbackDims.ancho,
            altoCm: item.altoCm || fallbackDims.alto,
            weightKg: item.weightKg || DEFAULT_WEIGHT_PER_BOX,
            name: item.label || 'Manual',
        };

        const qty = Math.max(1, Math.round(item.quantity || 1));
        for (let i = 0; i < qty; i++) {
            boxes.push({
                id: boxId++,
                w: dim.largoCm, d: dim.anchoCm, h: dim.altoCm,
                weight: dim.weightKg,
                label: dim.name,
                orderNumber: item.orderNumber || 0,
                clientCode: item.clientCode || '',
                articleCode: item.articleCode || '',
            });
        }
    }

    const tolerance = customTolerance ?? truck.tolerancePct;
    const result = binPack3D(boxes, truck.interior, tolerance);

    result.metrics.maxPayloadKg = truck.maxPayloadKg;
    result.metrics.weightOccupancyPct = truck.maxPayloadKg > 0
        ? Math.round((result.metrics.totalWeightKg / truck.maxPayloadKg) * 10000) / 100
        : 0;

    const volPct = result.metrics.volumeOccupancyPct;
    const wPct = result.metrics.weightOccupancyPct;
    result.metrics.status = result.overflow.length > 0 ? 'EXCESO'
        : (volPct >= 90 || wPct >= 90) ? 'OPTIMO' : 'SEGURO';

    return { truck, tolerancePct: tolerance, ...result };
}

module.exports = {
    planLoad,
    planLoadManual,
    getTruckConfig,
    getArticleDimensions,
    getOrdersForVehicle,
    binPack3D,
};
