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
function estimateBoxDimensions(pesoUnidad, unidadesCaja, articleName) {
    const pesoCaja = (pesoUnidad || 0) * Math.max(unidadesCaja || 1, 1);
    const name = (articleName || '').toUpperCase();

    // Family-based estimation from article name patterns
    if (name.includes('LATA') || name.includes('BOTE') || name.includes('CONSERVA')) {
        return pesoCaja <= 5 ? { largo: 32, ancho: 24, alto: 12 } : { largo: 40, ancho: 32, alto: 16 };
    }
    if (name.includes('BOTELLA') || name.includes('VINO') || name.includes('CERVEZA') || name.includes('CAVA')) {
        return pesoCaja <= 8 ? { largo: 30, ancho: 20, alto: 30 } : { largo: 40, ancho: 30, alto: 35 };
    }
    if (name.includes('ACEITE') || name.includes('GARRAFA') || name.includes('VINAGRE')) {
        return { largo: 38, ancho: 28, alto: 30 };
    }
    if (name.includes('AGUA') || name.includes('PACK') || name.includes('REFRESCO') || name.includes('ZUMO')) {
        return pesoCaja <= 10 ? { largo: 35, ancho: 25, alto: 22 } : { largo: 40, ancho: 30, alto: 25 };
    }
    if (name.includes('HARINA') || name.includes('AZUCAR') || name.includes('SAL ') || name.includes('ARROZ')) {
        return pesoCaja <= 10 ? { largo: 35, ancho: 25, alto: 18 } : { largo: 45, ancho: 30, alto: 22 };
    }

    // 12-tier weight-based estimation
    if (pesoCaja <= 1)  return { largo: 25, ancho: 18, alto: 10 };
    if (pesoCaja <= 2)  return { largo: 30, ancho: 20, alto: 12 };
    if (pesoCaja <= 4)  return { largo: 32, ancho: 22, alto: 14 };
    if (pesoCaja <= 6)  return { largo: 35, ancho: 25, alto: 15 };
    if (pesoCaja <= 8)  return { largo: 38, ancho: 28, alto: 16 };
    if (pesoCaja <= 12) return { largo: 40, ancho: 30, alto: 18 };
    if (pesoCaja <= 16) return { largo: 45, ancho: 32, alto: 20 };
    if (pesoCaja <= 22) return { largo: 50, ancho: 35, alto: 22 };
    if (pesoCaja <= 30) return { largo: 55, ancho: 38, alto: 25 };
    if (pesoCaja <= 40) return { largo: 58, ancho: 40, alto: 28 };
    if (pesoCaja <= 60) return { largo: 60, ancho: 40, alto: 30 };
    return { largo: 65, ancho: 45, alto: 35 };
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
      COALESCE(V.NUMEROCONTENEDORES, 0) AS NUM_PALETS,
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
    const contVolM3 = rawContVol;

    // Determinar payload 
    let maxPayload = parseFloat(r.CARGAMAXIMA) || 0;

    let lengthCm = parseFloat(r.LARGO_CM) || 0;
    let widthCm = parseFloat(r.ANCHO_CM) || 0;
    let heightCm = parseFloat(r.ALTO_CM) || 0;

    const numPalets = parseInt(r.NUM_PALETS, 10) || 0;

    // GOD MODE: Algoritmo Palet-Europeo. El AS400 no almacena Largo/Ancho/Alto.
    // Si la BD de configuración manual está en 0 y tenemos el número de palets, creamos la estructura.
    if ((lengthCm === 0 || widthCm === 0 || heightCm === 0) && numPalets > 0) {
        // En 240cm de ancho caben exactamente 2 pales europeos por el lado de 120cm
        // Por tanto, la profundidad ocupa filas de 80cm cada una.
        const filas = Math.ceil(numPalets / 2);
        lengthCm = filas * 80;
        widthCm = 240;
        heightCm = 220; // Altura estándar util

        // Cada palé asume 500kg de peso estandar
        if (maxPayload === 0) {
            maxPayload = numPalets * 500;
        }
    }

    // Derive from container volume if available
    if ((lengthCm === 0 || widthCm === 0 || heightCm === 0) && contVolM3 > 0) {
        // Standard truck proportions: L:W:H ≈ 2.5:1:0.92
        const wM = Math.cbrt(contVolM3 / (2.5 * 0.92));
        widthCm = Math.max(160, Math.min(260, Math.round(wM * 100)));
        lengthCm = Math.max(200, Math.min(1400, Math.round(wM * 2.5 * 100)));
        heightCm = Math.max(150, Math.min(280, Math.round(wM * 0.92 * 100)));
    }

    // Derive from payload weight ranges
    if ((lengthCm === 0 || widthCm === 0 || heightCm === 0) && maxPayload > 0) {
        if (maxPayload <= 1500) {
            lengthCm = 280; widthCm = 170; heightCm = 160; // Small van
        } else if (maxPayload <= 3500) {
            lengthCm = 380; widthCm = 200; heightCm = 190; // Large van
        } else if (maxPayload <= 8000) {
            lengthCm = 600; widthCm = 240; heightCm = 220; // Medium truck
        } else {
            lengthCm = 800; widthCm = 245; heightCm = 240; // Heavy truck
        }
    }

    // Derive from vehicle description keywords
    if (lengthCm === 0 || widthCm === 0 || heightCm === 0) {
        const desc = (r.DESCRIPCION || '').toUpperCase();
        if (desc.includes('KANGOO') || desc.includes('BERLINGO') || desc.includes('PARTNER')) {
            lengthCm = 260; widthCm = 155; heightCm = 130;
        } else if (desc.includes('FURGONETA') || desc.includes('FURGO')) {
            lengthCm = 300; widthCm = 170; heightCm = 170;
        } else if (desc.includes('SPRINTER') || desc.includes('CRAFTER') || desc.includes('MASTER') || desc.includes('DAILY')) {
            lengthCm = 430; widthCm = 200; heightCm = 200;
        } else {
            lengthCm = 600; widthCm = 240; heightCm = 220; // Generic truck
        }
    }

    if (maxPayload === 0) {
        maxPayload = 6000;
    }
    const finalVolM3 = (lengthCm * widthCm * heightCm) / 1e6;

    // Determine vehicle type from description
    const desc = (r.DESCRIPCION || '').toUpperCase();
    const vehicleType = desc.includes('FURGONETA') || desc.includes('FURGO') || lengthCm < 400
        ? 'VAN' : 'TRUCK';

    return {
        code: r.CODE,
        description: (r.DESCRIPCION || '').trim(),
        matricula: (r.MATRICULA || '').trim(),
        vehicleType,
        maxPayloadKg: maxPayload,
        tara: parseFloat(r.TARA) || 0,
        containerVolumeM3: contVolM3 > 0 ? contVolM3 : finalVolM3,
        interior: { lengthCm, widthCm, heightCm },
        tolerancePct: parseFloat(r.TOLERANCIA) || 5,
        volumeM3: finalVolM3,
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
        const estimated = estimateBoxDimensions(pesoUd, udsCaja, r.NOMBRE);

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
    }))
    .filter(o => {
        // Skip zero-quantity lines
        if (o.units === 0 && o.boxes === 0) return false;
        // Skip known non-physical article codes
        const code = o.articleCode;
        if (code.length <= 2) return false;
        if (['0000', '0006', '0022', '0043', 'D001', 'K'].includes(code)) return false;
        return true;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3D BIN PACKING — Shelf/Layer packing (robust, no fragmentation issues)
// ─────────────────────────────────────────────────────────────────────────────

function binPack3D(boxes, interior, tolerancePct = 5) {
    const cW = interior.widthCm;
    const cD = interior.lengthCm;
    const cH = interior.heightCm;

    // Sort: heaviest first (stability), then largest volume
    const sorted = [...boxes].sort((a, b) => {
        const wDiff = b.weight - a.weight;
        if (Math.abs(wDiff) > 1) return wDiff;
        return (b.w * b.d * b.h) - (a.w * a.d * a.h);
    });

    const placed = [];
    const overflow = [];

    // Free space list: start with entire container
    let freeSpaces = [{ x: 0, y: 0, z: 0, w: cW, d: cD, h: cH }];

    function generateRotations(box) {
        const dims = [
            { w: box.w, d: box.d, h: box.h },
            { w: box.w, d: box.h, h: box.d },
            { w: box.d, d: box.w, h: box.h },
            { w: box.d, d: box.h, h: box.w },
            { w: box.h, d: box.w, h: box.d },
            { w: box.h, d: box.d, h: box.w },
        ];
        return dims.filter(r => r.w <= cW && r.d <= cD && r.h <= cH)
                    .sort((a, b) => a.h - b.h); // prefer flat (lowest h)
    }

    function splitFreeSpace(space, boxRot) {
        const newSpaces = [];
        // Right remainder
        const rw = space.w - boxRot.w;
        if (rw > 2) {
            newSpaces.push({ x: space.x + boxRot.w, y: space.y, z: space.z, w: rw, d: space.d, h: space.h });
        }
        // Back remainder
        const bd = space.d - boxRot.d;
        if (bd > 2) {
            newSpaces.push({ x: space.x, y: space.y + boxRot.d, z: space.z, w: boxRot.w, d: bd, h: space.h });
        }
        // Top remainder
        const th = space.h - boxRot.h;
        if (th > 2) {
            newSpaces.push({ x: space.x, y: space.y, z: space.z + boxRot.h, w: boxRot.w, d: boxRot.d, h: th });
        }
        return newSpaces;
    }

    for (const box of sorted) {
        const rots = generateRotations(box);
        if (!rots.length) { overflow.push({ ...box }); continue; }

        let bestFit = null;
        let bestSpace = -1;
        let bestRot = null;
        let bestScore = Infinity;

        for (let si = 0; si < freeSpaces.length; si++) {
            const space = freeSpaces[si];
            for (const rot of rots) {
                if (rot.w <= space.w && rot.d <= space.d && rot.h <= space.h) {
                    // Score: prefer lowest Z (gravity), then tightest fit
                    const score = space.z * 10000 +
                        (space.w - rot.w) * 3 + (space.d - rot.d) * 2 + (space.h - rot.h);
                    if (score < bestScore) {
                        bestScore = score;
                        bestFit = space;
                        bestSpace = si;
                        bestRot = rot;
                    }
                }
            }
        }

        if (bestFit && bestRot) {
            placed.push({
                id: box.id, label: box.label,
                orderNumber: box.orderNumber, clientCode: box.clientCode,
                articleCode: box.articleCode, weight: box.weight,
                x: bestFit.x, y: bestFit.y, z: bestFit.z,
                w: bestRot.w, d: bestRot.d, h: bestRot.h,
            });

            // Split free space
            const newSpaces = splitFreeSpace(bestFit, bestRot);
            freeSpaces.splice(bestSpace, 1, ...newSpaces);

            // Periodically clean up tiny free spaces
            if (placed.length % 25 === 0) {
                freeSpaces = freeSpaces.filter(s => s.w * s.d * s.h > 1000); // > 10cm^3
            }
        } else {
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
        const dim0 = dimensions[order.articleCode];
        const fallbackDims = estimateBoxDimensions(order.weightPerUnit || DEFAULT_WEIGHT_PER_BOX, 1, dim0 ? dim0.name : '');
        const dim = dim0 || {
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
        const fallbackDims = estimateBoxDimensions(item.weightKg || DEFAULT_WEIGHT_PER_BOX, 1, item.label || '');
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
