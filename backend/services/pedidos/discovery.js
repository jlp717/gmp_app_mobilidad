// discovery.js — split verbatim de services/pedidos/index.js (lote 2026-09-28): recomendaciones, balance/cliente y clonacion.
// Contenido movido tal cual, sin cambios de logica. index.js actua como fachada.
const { queryWithParams } = require('../../config/db');
const { comercialErpTable } = require('../../utils/comercial-erp-tables');
const logger = require('../../middleware/logger');
const { cachedQuery } = require('../query-optimizer');
const { TTL } = require('../redis-cache');
const { truncate } = require('./_shared');
// ============================================================================
// RECOMMENDATIONS
// ============================================================================

async function getRecommendations(clientCode, vendedorCode) {
    if (!clientCode) throw new Error('clientCode is required');

    const trimClient = truncate(clientCode, 10);
    const trimVendor = truncate((vendedorCode || '').split(',')[0], 2);

    // Strategy 1: Client purchase history (last 12 months)
    // FIX 2026-05-15: ampliamos las metricas devueltas porque la UI mostraba
    // "0 cajas" para muchos productos:
    //  - Antes solo se devolvia SUM(CANTIDADUNIDADES). Para muchos productos
    //    LINDTO guarda la cantidad en CANTIDADENVASES, no en CANTIDADUNIDADES,
    //    y por eso salia 0.
    //  - Ahora devolvemos AMBOS campos sumados (envases + unidades) y ademas
    //    el promedio por compra y el importe total, para que la UI pueda
    //    mostrar "X cajas" o "X unidades" segun la metrica que tenga datos.
    const historySql = `
        SELECT TRIM(L.CODIGOARTICULO) AS code,
            TRIM(L.DESCRIPCION) AS name,
            COUNT(*) AS frequency,
            COALESCE(SUM(L.CANTIDADUNIDADES), 0) AS totalUnits,
            COALESCE(SUM(L.CANTIDADENVASES), 0) AS totalEnvases,
            COALESCE(SUM(L.IMPORTEVENTA), 0) AS totalAmount,
            COALESCE(AVG(L.CANTIDADENVASES), 0) AS avgEnvases,
            MAX(L.ANODOCUMENTO * 10000 + L.MESDOCUMENTO * 100 + L.DIADOCUMENTO) AS lastPurchase
        FROM ${comercialErpTable('LINDTO')} L
        WHERE TRIM(L.CODIGOCLIENTEALBARAN) = CAST(? AS VARCHAR(10))
          AND L.ANODOCUMENTO >= YEAR(CURRENT_DATE) - 1
          AND L.TIPOVENTA IN ('CC', 'VC')
          AND L.CLASELINEA IN ('AB', 'VT')
          AND L.SERIEALBARAN NOT IN ('N', 'Z')
        GROUP BY L.CODIGOARTICULO, L.DESCRIPCION
        ORDER BY frequency DESC
        FETCH FIRST 20 ROWS ONLY`;

    let history = [];
    try {
        const historyRows = await queryWithParams(historySql, [trimClient]);
        history = (historyRows || []).map(r => {
            const totalUnits = parseFloat(r.TOTALUNITS) || 0;
            const totalEnvases = parseFloat(r.TOTALENVASES) || 0;
            const totalAmount = parseFloat(r.TOTALAMOUNT) || 0;
            const avgEnvases = parseFloat(r.AVGENVASES) || 0;
            // "suggestedUnits" = la metrica que tiene datos (preferimos envases)
            // para que la UI muestre algo sensato y NO "0 cajas".
            const suggestedUnits = avgEnvases > 0
                ? avgEnvases
                : (totalEnvases > 0 ? totalEnvases : totalUnits);
            return {
                code: (r.CODE || '').trim(),
                name: (r.NAME || '').trim(),
                frequency: parseInt(r.FREQUENCY) || 0,
                totalUnits,
                totalEnvases,
                totalAmount,
                avgEnvases,
                suggestedUnits,
                lastPurchase: r.LASTPURCHASE,
                source: 'history',
            };
        });
    } catch (error) {
        logger.error(`[PEDIDOS] getRecommendations history error: ${error.message}`);
    }

    // Strategy 2: Similar clients (only if vendor is provided)
    let similar = [];
    if (trimVendor) {
        // Handle multi-vendor codes (comma-separated); use first code only
        // CODIGOVENDEDOR is CHAR(2), can't hold the full comma string
        const similarSql = `
            SELECT TRIM(L.CODIGOARTICULO) AS code,
                TRIM(L.DESCRIPCION) AS name,
                COUNT(DISTINCT L.CODIGOCLIENTEALBARAN) AS clientCount
            FROM ${comercialErpTable('LINDTO')} L
            WHERE TRIM(L.CODIGOVENDEDOR) = CAST(? AS VARCHAR(2))
              AND L.ANODOCUMENTO = YEAR(CURRENT_DATE)
              AND L.TIPOVENTA IN ('CC', 'VC')
              AND L.CLASELINEA IN ('AB', 'VT')
              AND L.SERIEALBARAN NOT IN ('N', 'Z')
              AND NOT EXISTS (
                  SELECT 1 FROM ${comercialErpTable('LINDTO')} L2
                  WHERE L2.CODIGOARTICULO = L.CODIGOARTICULO
                    AND TRIM(L2.CODIGOCLIENTEALBARAN) = CAST(? AS VARCHAR(10))
                    AND (L2.ANODOCUMENTO * 12 + L2.MESDOCUMENTO)
                        >= (YEAR(CURRENT_DATE) * 12 + MONTH(CURRENT_DATE) - 3)
              )
            GROUP BY L.CODIGOARTICULO, L.DESCRIPCION
            HAVING COUNT(DISTINCT L.CODIGOCLIENTEALBARAN) >= 3
            ORDER BY clientCount DESC
            FETCH FIRST 10 ROWS ONLY`;
        try {
            const similarRows = await queryWithParams(similarSql, [trimVendor, trimClient]);
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

    // Exclude already selected products from fallback recommendations.
    const allCodes = [
        ...history.map(h => h.code),
        ...similar.map(s => s.code),
    ]
        .map((code) => truncate(code, 10))
        .filter(Boolean);

    if (allCodes.length > 0) {
        try {
            const placeholders = allCodes.map(() => 'CAST(? AS VARCHAR(10))').join(',');
            const enrichSql = `
                SELECT
                    TRIM(A.CODIGOARTICULO) AS CODE,
                    TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                    TRIM(A.CODIGOFAMILIA) AS FAMILY,
                    TRIM(A.CODIGOMARCA) AS BRAND,
                    A.UNIDADESCAJA AS UNITSPERBOX,
                    A.UNIDADESFRACCION AS UNITSFRACTION,
                    TRIM(A.UNIDADMEDIDA) AS UNITMEASURE,
                    COALESCE(S.ENVASES_DISP, 0) AS STOCKENVASES,
                    COALESCE(S.UNIDADES_DISP, 0) AS STOCKUNIDADES,
                    COALESCE(T1.PRECIOTARIFA, 0) AS PRECIOTARIFA1,
                    COALESCE(T2.PRECIOTARIFA, 0) AS PRECIOMINIMO,
                    COALESCE(TC.PRECIOTARIFA, 0) AS PRECIOCLIENTE
                FROM ${comercialErpTable('ART')} A
                LEFT JOIN (
                    SELECT CODIGOARTICULO,
                        SUM(ENVASESDISPONIBLES) AS ENVASES_DISP,
                        SUM(UNIDADESDISPONIBLES) AS UNIDADES_DISP
                    FROM ${comercialErpTable('ARO')} WHERE CODIGOALMACEN = 1
                    GROUP BY CODIGOARTICULO
                ) S ON A.CODIGOARTICULO = S.CODIGOARTICULO
                LEFT JOIN ${comercialErpTable('ARA')} T1 ON A.CODIGOARTICULO = T1.CODIGOARTICULO AND T1.CODIGOTARIFA = 1
                LEFT JOIN ${comercialErpTable('ARA')} T2 ON A.CODIGOARTICULO = T2.CODIGOARTICULO AND T2.CODIGOTARIFA = 2
                LEFT JOIN ${comercialErpTable('ARA')} TC ON A.CODIGOARTICULO = TC.CODIGOARTICULO
                    AND TC.CODIGOTARIFA = (
                        SELECT CLC.CODIGOTARIFA FROM ${comercialErpTable('CLC')} CLC
                        WHERE TRIM(CLC.CODIGOCLIENTE) = CAST(? AS VARCHAR(10))
                        FETCH FIRST 1 ROW ONLY
                    )
                WHERE TRIM(A.CODIGOARTICULO) IN (${placeholders})
                  AND A.ANOBAJA = 0`;
            const enrichParams = [trimClient, ...allCodes];
            const enrichRows = await queryWithParams(enrichSql, enrichParams);
            const enrichMap = {};
            for (const r of enrichRows) {
                const code = (r.CODE || '').trim();
                enrichMap[code] = {
                    name: (r.NAME || '').trim(),
                    family: (r.FAMILY || '').trim(),
                    brand: (r.BRAND || '').trim(),
                    unitsPerBox: parseFloat(r.UNITSPERBOX) || 0,
                    unitsFraction: parseFloat(r.UNITSFRACTION) || 0,
                    unitMeasure: (r.UNITMEASURE || '').trim(),
                    stockEnvases: parseFloat(r.STOCKENVASES) || 0,
                    stockUnidades: parseFloat(r.STOCKUNIDADES) || 0,
                    precioTarifa1: parseFloat(r.PRECIOTARIFA1) || 0,
                    precioMinimo: parseFloat(r.PRECIOMINIMO) || 0,
                    precioCliente: parseFloat(r.PRECIOCLIENTE) || 0,
                };
            }
            history = history.map(h => ({ ...h, ...(enrichMap[h.code] || {}) }));
            similar = similar.map(s => ({ ...s, ...(enrichMap[s.code] || {}) }));
        } catch (enrichErr) {
            logger.warn(`[PEDIDOS] getRecommendations enrichment error: ${enrichErr.message}`);
        }
    }

    return { clientHistory: history, similarClients: similar };
}

async function getClientBalance(clientCode) {
    const code = clientCode.trim();
    const cacheKey = `pedidos:balance:${code}`;
    const year = new Date().getFullYear();

    // FIX 2026-05-15:
    //   - "Cobrado" antes usaba L.LCTPVT='CO' en LACLAE, pero esa marca no
    //     existe (LACLAE tiene VT/AB para ventas/abonos, no cobros). Resultado:
    //     siempre 0.
    //   - "Cobrado" REAL del cliente esta en ${comercialErpTable('CVC')}.IMPORTECANCELADO,
    //     sumando los vencimientos con ANOCOBRO = ano actual.
    //   - "Facturado" se mantiene desde LACLAE (ventas y abonos).
    const sqlFacturado = `
        SELECT COALESCE(SUM(
            CASE WHEN L.LCTPVT IN ('CC','VC')
                  AND L.LCCLLN IN ('AB','VT')
                  AND L.LCSRAB NOT IN ('N','Z','G','D')
                THEN L.LCIMVT ELSE 0 END
        ), 0) AS TOTAL_FACTURADO
        FROM ${comercialErpTable('LACLAE')} L
        WHERE L.LCCDCL = ?
          AND L.LCAADC = ?
    `;

    // FIX 2026-05-15 (segunda iteracion): la query anterior filtraba por
    // CVC.ANOCOBRO = ano actual, pero ANOCOBRO solo se rellena cuando el ERP
    // procesa el cobro (puede haber retraso o estar a 0). El resultado era
    // que TODOS los clientes mostraban "Cobrado: 0,00 â‚¬".
    //
    // Mejor criterio: sumar IMPORTECANCELADO de los vencimientos del cliente
    // emitidos en el ano actual, sin filtrar por ANOCOBRO. Esto refleja
    // cuanto del facturado este ano YA se ha cobrado, que es lo que el
    // usuario espera ver.
    const sqlCobrado = `
        SELECT COALESCE(SUM(CVC.IMPORTECANCELADO), 0) AS TOTAL_COBRADO
        FROM ${comercialErpTable('CVC')} CVC
        WHERE TRIM(CVC.CODIGOCLIENTEALBARAN) = ?
          AND CVC.ANOEMISION = ?
          AND CVC.IMPORTECANCELADO > 0
          AND (CVC.ANULADOSN IS NULL OR CVC.ANULADOSN <> 'S')
    `;

    try {
        const [facturadoRows, cobradoRows] = await Promise.all([
            cachedQuery(
                (s) => queryWithParams(s, [code, year]),
                sqlFacturado, `${cacheKey}:facturado`, TTL.SHORT
            ),
            cachedQuery(
                (s) => queryWithParams(s, [code, year]),
                sqlCobrado, `${cacheKey}:cobrado`, TTL.SHORT
            ),
        ]);
        const facturado = parseFloat(facturadoRows?.[0]?.TOTAL_FACTURADO) || 0;
        const cobrado = parseFloat(cobradoRows?.[0]?.TOTAL_COBRADO) || 0;
        return {
            facturadoAnual: facturado,
            cobradoAnual: cobrado,
            saldoPendiente: Math.max(0, facturado - cobrado),
            year,
        };
    } catch (error) {
        logger.error(`[PEDIDOS] getClientBalance error: ${error.message}`);
        return { facturadoAnual: 0, cobradoAnual: 0, saldoPendiente: 0, year };
    }
}

// =============================================================================
// CLONE ORDER
// =============================================================================

async function cloneOrder(orderId) {
    const { getOrderDetail } = require('./index'); // puente split: def vive en index
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
module.exports = {
    getRecommendations,
    getClientBalance,
    cloneOrder,
};
