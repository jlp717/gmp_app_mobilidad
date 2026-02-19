/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LOAD PLANNER SERVICE — Algoritmo 3D Bin Packing "Largest Area Fit First"
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Simula la carga de un camión con cajas de pedidos, calculando la posición
 * óptima (x,y,z) de cada bulto para minimizar el espacio vacío.
 * 
 * HEURÍSTICA: 
 *  1. Ordena bultos de mayor a menor volumen
 *  2. Para cada bulto, busca el "espacio libre" con mayor área de base
 *  3. Intenta todas las rotaciones (6 orientaciones) y elige la que mejor ajusta
 *  4. Al colocar un bulto, el espacio libre se subdivide en hasta 3 nuevos espacios
 * 
 * @module services/loadPlanner
 */

const { query } = require('../config/db');
const logger = require('../middleware/logger');

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT DIMENSIONS — used when article hasn't been measured yet
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_BOX = { largo: 40, ancho: 30, alto: 25 }; // cm
const DEFAULT_WEIGHT_PER_BOX = 5.0; // kg

// ─────────────────────────────────────────────────────────────────────────────
// DATA ACCESS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recupera la configuración del camión (dimensiones interiores + tolerancia)
 * Combina datos de DSEDAC.VEH con JAVIER.ALMACEN_CAMIONES_CONFIG
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
      COALESCE(C.LARGO_INTERIOR_CM, 600) AS LARGO_CM,
      COALESCE(C.ANCHO_INTERIOR_CM, 240) AS ANCHO_CM,
      COALESCE(C.ALTO_INTERIOR_CM, 220) AS ALTO_CM,
      COALESCE(C.TOLERANCIA_EXCESO, 5.00) AS TOLERANCIA
    FROM DSEDAC.VEH V
    LEFT JOIN JAVIER.ALMACEN_CAMIONES_CONFIG C 
      ON TRIM(V.CODIGOVEHICULO) = C.CODIGOVEHICULO
    WHERE TRIM(V.CODIGOVEHICULO) = '${vehicleCode.replace(/'/g, "''")}'
  `);

    if (!rows.length) return null;

    const r = rows[0];
    return {
        code: r.CODE,
        description: (r.DESCRIPCION || '').trim(),
        matricula: (r.MATRICULA || '').trim(),
        maxPayloadKg: parseFloat(r.CARGAMAXIMA) || 3000,
        tara: parseFloat(r.TARA) || 0,
        container: {
            lengthCm: parseFloat(r.LARGO_CM),
            widthCm: parseFloat(r.ANCHO_CM),
            heightCm: parseFloat(r.ALTO_CM),
        },
        tolerancePct: parseFloat(r.TOLERANCIA),
        volumeM3: (parseFloat(r.LARGO_CM) * parseFloat(r.ANCHO_CM) * parseFloat(r.ALTO_CM)) / 1e6,
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
        const weight = parseFloat(r.PESO_CAJA_KG) || parseFloat(r.PESO) || DEFAULT_WEIGHT_PER_BOX;

        result[r.CODE] = {
            code: r.CODE,
            name: (r.NOMBRE || '').trim(),
            largoCm: hasDimensions ? parseFloat(r.LARGO_CM) : DEFAULT_BOX.largo,
            anchoCm: hasDimensions ? parseFloat(r.ANCHO_CM) : DEFAULT_BOX.ancho,
            altoCm: hasDimensions ? parseFloat(r.ALTO_CM) : DEFAULT_BOX.alto,
            weightKg: weight,
            unitsPerBox: parseInt(r.UDS_CAJA) || 1,
            estimated: !hasDimensions,
        };
    }

    // Fill missing codes with defaults
    for (const code of articleCodes) {
        if (!result[code]) {
            result[code] = {
                code,
                name: 'Artículo desconocido',
                largoCm: DEFAULT_BOX.largo,
                anchoCm: DEFAULT_BOX.ancho,
                altoCm: DEFAULT_BOX.alto,
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
      TRIM(OPP.CODIGOCLIENTE) AS CLIENTE,
      TRIM(LAC.CODIGOARTICULO) AS ARTICULO,
      LAC.CANTIDADUNIDADES AS CANTIDAD,
      LAC.CANTIDADUNIDADESPEDIDAS AS UNIDADES
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
        quantity: parseFloat(r.CANTIDAD) || parseFloat(r.UNIDADES) || 1,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// 3D BIN PACKING — "Largest Area Fit First" (LAFF) Heuristic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Representa un espacio libre dentro del contenedor
 * @typedef {Object} FreeSpace
 * @property {number} x - Coordenada X (largo)
 * @property {number} y - Coordenada Y (ancho) 
 * @property {number} z - Coordenada Z (alto/vertical)
 * @property {number} w - Ancho del espacio
 * @property {number} d - Profundidad del espacio
 * @property {number} h - Altura del espacio
 */

/**
 * Genera las 6 rotaciones posibles de una caja (largo, ancho, alto)
 */
function getRotations(l, w, h) {
    return [
        { w: l, d: w, h: h },
        { w: l, d: h, h: w },
        { w: w, d: l, h: h },
        { w: w, d: h, h: l },
        { w: h, d: l, h: w },
        { w: h, d: w, h: l },
    ];
}

/**
 * Algoritmo principal de Bin Packing 3D
 * 
 * @param {Array} boxes - Lista de cajas [{id, w, d, h, weight, label, orderNumber, clientCode}]
 * @param {Object} container - {lengthCm, widthCm, heightCm}
 * @param {number} tolerancePct - % exceso permitido (ej: 5)
 * @returns {Object} - {placed: [...], overflow: [...], metrics: {...}}
 */
function binPack3D(boxes, container, tolerancePct = 5) {
    const maxW = container.widthCm * (1 + tolerancePct / 100);
    const maxD = container.lengthCm * (1 + tolerancePct / 100);
    const maxH = container.heightCm;

    // Sort: largest volume first (greedy heuristic)
    const sorted = [...boxes].sort((a, b) => (b.w * b.d * b.h) - (a.w * a.d * a.h));

    // Free spaces: start with the entire container
    let freeSpaces = [{
        x: 0, y: 0, z: 0,
        w: container.widthCm,
        d: container.lengthCm,
        h: container.heightCm,
    }];

    const placed = [];
    const overflow = [];

    for (const box of sorted) {
        let bestFit = null;
        let bestSpaceIdx = -1;
        let bestRotation = null;
        let bestScore = -1;

        // Try to fit in each free space
        for (let si = 0; si < freeSpaces.length; si++) {
            const space = freeSpaces[si];
            const rotations = getRotations(box.w, box.d, box.h);

            for (const rot of rotations) {
                if (rot.w <= space.w && rot.d <= space.d && rot.h <= space.h) {
                    // Score: prefer bottom-left placement, then largest base area usage
                    const fitScore = (rot.w * rot.d) / (space.w * space.d) * 1000
                        - space.z * 10  // prefer lower Z
                        - space.x       // prefer leftmost
                        - space.y;      // prefer front

                    if (fitScore > bestScore) {
                        bestScore = fitScore;
                        bestFit = space;
                        bestSpaceIdx = si;
                        bestRotation = rot;
                    }
                }
            }
        }

        if (bestFit && bestRotation) {
            // Place the box
            placed.push({
                id: box.id,
                label: box.label,
                orderNumber: box.orderNumber,
                clientCode: box.clientCode,
                articleCode: box.articleCode,
                weight: box.weight,
                // Position (bottom-left-front corner)
                x: bestFit.x,
                y: bestFit.y,
                z: bestFit.z,
                // Dimensions as placed
                w: bestRotation.w,
                d: bestRotation.d,
                h: bestRotation.h,
            });

            // Remove the used space and subdivide into up to 3 new free spaces
            freeSpaces.splice(bestSpaceIdx, 1);

            const bx = bestFit.x, by = bestFit.y, bz = bestFit.z;
            const sw = bestFit.w, sd = bestFit.d, sh = bestFit.h;
            const rw = bestRotation.w, rd = bestRotation.d, rh = bestRotation.h;

            // Space to the right of the box
            if (sw - rw > 1) {
                freeSpaces.push({
                    x: bx + rw, y: by, z: bz,
                    w: sw - rw, d: sd, h: sh,
                });
            }
            // Space behind the box
            if (sd - rd > 1) {
                freeSpaces.push({
                    x: bx, y: by + rd, z: bz,
                    w: rw, d: sd - rd, h: sh,
                });
            }
            // Space above the box
            if (sh - rh > 1) {
                freeSpaces.push({
                    x: bx, y: by, z: bz + rh,
                    w: rw, d: rd, h: sh - rh,
                });
            }

            // Merge adjacent free spaces (optimization pass)
            freeSpaces = mergeFreeSpaces(freeSpaces);
        } else {
            // Box doesn't fit → overflow
            overflow.push({
                id: box.id,
                label: box.label,
                orderNumber: box.orderNumber,
                clientCode: box.clientCode,
                articleCode: box.articleCode,
                weight: box.weight,
                w: box.w, d: box.d, h: box.h,
            });
        }
    }

    // Calculate metrics
    const containerVolume = container.widthCm * container.lengthCm * container.heightCm;
    const usedVolume = placed.reduce((sum, b) => sum + (b.w * b.d * b.h), 0);
    const totalWeight = placed.reduce((sum, b) => sum + b.weight, 0);
    const overflowWeight = overflow.reduce((sum, b) => sum + b.weight, 0);

    return {
        placed,
        overflow,
        metrics: {
            totalBoxes: boxes.length,
            placedCount: placed.length,
            overflowCount: overflow.length,
            containerVolumeCm3: containerVolume,
            usedVolumeCm3: usedVolume,
            volumeOccupancyPct: Math.round((usedVolume / containerVolume) * 10000) / 100,
            totalWeightKg: Math.round(totalWeight * 100) / 100,
            overflowWeightKg: Math.round(overflowWeight * 100) / 100,
            freeSpacesRemaining: freeSpaces.length,
        },
    };
}

/**
 * Merges adjacent free spaces that can be combined
 * This prevents excessive fragmentation of the available space
 */
function mergeFreeSpaces(spaces) {
    if (spaces.length <= 1) return spaces;

    let merged = true;
    while (merged) {
        merged = false;
        for (let i = 0; i < spaces.length; i++) {
            for (let j = i + 1; j < spaces.length; j++) {
                const a = spaces[i], b = spaces[j];

                // Can merge if they share a face and align perfectly
                // Merge along X axis
                if (a.y === b.y && a.z === b.z && a.d === b.d && a.h === b.h && a.x + a.w === b.x) {
                    spaces[i] = { ...a, w: a.w + b.w };
                    spaces.splice(j, 1);
                    merged = true;
                    break;
                }
                // Merge along Y axis
                if (a.x === b.x && a.z === b.z && a.w === b.w && a.h === b.h && a.y + a.d === b.y) {
                    spaces[i] = { ...a, d: a.d + b.d };
                    spaces.splice(j, 1);
                    merged = true;
                    break;
                }
                // Merge along Z axis
                if (a.x === b.x && a.y === b.y && a.w === b.w && a.d === b.d && a.z + a.h === b.z) {
                    spaces[i] = { ...a, h: a.h + b.h };
                    spaces.splice(j, 1);
                    merged = true;
                    break;
                }
            }
            if (merged) break;
        }
    }
    return spaces;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Planifica la carga de un camión para una fecha dada.
 * Lee los pedidos de OPP, recupera dimensiones de artículos, y ejecuta bin packing 3D.
 * 
 * @param {string} vehicleCode - Código del vehículo (DSEDAC.VEH.CODIGOVEHICULO)
 * @param {number} year - Año de reparto
 * @param {number} month - Mes de reparto
 * @param {number} day - Día de reparto
 * @param {number} [customTolerance] - Override de tolerancia (%)
 * @returns {Promise<Object>} Resultado del plan de carga con posiciones 3D
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
                containerVolumeCm3: truck.container.lengthCm * truck.container.widthCm * truck.container.heightCm,
                usedVolumeCm3: 0, volumeOccupancyPct: 0,
                totalWeightKg: 0, overflowWeightKg: 0,
            },
        };
    }

    // 3. Get unique article codes and their dimensions
    const articleCodes = [...new Set(orders.map(o => o.articleCode).filter(Boolean))];
    const dimensions = await getArticleDimensions(articleCodes);

    // 4. Build box list from orders (each unit = 1 box)
    const boxes = [];
    let boxId = 0;
    for (const order of orders) {
        const dim = dimensions[order.articleCode] || {
            largoCm: DEFAULT_BOX.largo,
            anchoCm: DEFAULT_BOX.ancho,
            altoCm: DEFAULT_BOX.alto,
            weightKg: DEFAULT_WEIGHT_PER_BOX,
            name: 'Desconocido',
        };

        const qty = Math.max(1, Math.round(order.quantity));
        for (let i = 0; i < qty; i++) {
            boxes.push({
                id: boxId++,
                w: dim.largoCm,
                d: dim.anchoCm,
                h: dim.altoCm,
                weight: dim.weightKg,
                label: dim.name,
                orderNumber: order.orderNumber,
                clientCode: order.clientCode,
                articleCode: order.articleCode,
            });
        }
    }

    // 5. Run bin packing
    const tolerance = customTolerance ?? truck.tolerancePct;
    const result = binPack3D(boxes, truck.container, tolerance);

    // 6. Add weight capacity check
    const weightCapacity = truck.maxPayloadKg;
    result.metrics.maxPayloadKg = weightCapacity;
    result.metrics.weightOccupancyPct = weightCapacity > 0
        ? Math.round((result.metrics.totalWeightKg / weightCapacity) * 10000) / 100
        : 0;

    // Status based on occupancy
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
 * Planifica la carga con una lista explícita de pedidos (sin consultar OPP)
 * Useful for "what-if" simulations from the frontend
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
        const dim = dimensions[item.articleCode] || {
            largoCm: item.largoCm || DEFAULT_BOX.largo,
            anchoCm: item.anchoCm || DEFAULT_BOX.ancho,
            altoCm: item.altoCm || DEFAULT_BOX.alto,
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
    const result = binPack3D(boxes, truck.container, tolerance);

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
