// catalog-aux.js — split verbatim de services/pedidos/index.js (lote 2026-09-28): rutero-confirmados, pricing de cliente y alias de compatibilidad.
// Contenido movido tal cual, sin cambios de logica. index.js actua como fachada.
const { queryWithParams } = require('../../config/db');
const { comercialErpTable } = require('../../utils/comercial-erp-tables');
const { PEDIDOS_CAB_TABLE } = require('./_shared');
async function getConfirmedPedidosForRutero({ repartidorIds, day, month, year }) {
    const ids = [...new Set((repartidorIds || [])
        .map((id) => String(id || '').trim())
        .filter(Boolean))];
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    const sql = `
        SELECT
            'GMP' AS SUBEMPRESAALBARAN,
            C.EJERCICIO AS EJERCICIOALBARAN,
            TRIM(COALESCE(NULLIF(TRIM(C.SERIEPEDIDO), ''), 'M')) AS SERIEALBARAN,
            COALESCE(C.TERMINAL, C.TERMINALPEDIDO, 0) AS TERMINALALBARAN,
            C.NUMEROPEDIDO AS NUMEROALBARAN,
            0 AS NUMEROFACTURA,
            CAST('' AS CHAR(1)) AS SERIEFACTURA,
            TRIM(C.CODIGOCLIENTE) AS CLIENTE,
            TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, C.NOMBRECLIENTE, 'CLIENTE')) AS NOMBRE_CLIENTE,
            TRIM(CLI.NOMBREALTERNATIVO) AS NOMBRE_COMERCIAL,
            TRIM(COALESCE(CLI.NOMBRECLIENTE, C.NOMBRECLIENTE, '')) AS NOMBRE_FISCAL,
            TRIM(COALESCE(CLI.DIRECCION, '')) AS DIRECCION,
            TRIM(COALESCE(CLI.POBLACION, '')) AS POBLACION,
            TRIM(COALESCE(CLI.TELEFONO1, '')) AS TELEFONO,
            TRIM(COALESCE(CLI.TELEFONO2, '')) AS TELEFONO2,
            C.IMPORTETOTAL,
            C.IMPORTETOTAL AS CAC_IMPORTETOTAL,
            COALESCE(C.IMPORTEBASE, C.IMPORTETOTAL) AS IMPORTEBRUTO,
            COALESCE(C.IMPORTEBASE, C.IMPORTETOTAL) AS CPC_BASE1,
            0 AS CPC_BASE2,
            0 AS CPC_BASE3,
            0 AS CPC_PCTIVA1,
            0 AS CPC_PCTIVA2,
            0 AS CPC_PCTIVA3,
            COALESCE(C.IMPORTEIVA, 0) AS CPC_IVA1,
            0 AS CPC_IVA2,
            0 AS CPC_IVA3,
            TRIM(C.CODIGOFORMAPAGO) AS FORMA_PAGO,
            C.DIADOCUMENTO, C.MESDOCUMENTO, C.ANODOCUMENTO,
            TRIM(C.RUTA) AS RUTA,
            TRIM(C.CODIGOREPARTIDOR) AS CODIGO_REPARTIDOR,
            CAST(NULL AS INTEGER) AS ROUTE_MOVE_POSITION,
            C.ID AS ORDEN_PREPARACION,
            TRIM(C.CODIGOREPARTIDOR) AS NOMBRE_REPARTIDOR,
            0 AS DIALLEGADA, 0 AS HORALLEGADA,
            'N' AS CONFORMADO,
            CAST(NULL AS VARCHAR(20)) AS DS_STATUS,
            CAST(NULL AS VARCHAR(512)) AS DS_OBS,
            CAST(NULL AS VARCHAR(255)) AS DS_FIRMA,
            'PEDIDO' AS ANTEROOM_DOC_TIPO,
            C.ID AS PEDIDO_ID,
            COALESCE(C.SYSTEM_EJERCICIOPEDIDO, 0) AS SYSTEM_EJERCICIO,
            TRIM(C.SYSTEM_SERIEPEDIDO) AS SYSTEM_SERIE,
            COALESCE(C.SYSTEM_TERMINALPEDIDO, 0) AS SYSTEM_TERMINAL,
            COALESCE(C.SYSTEM_NUMEROPEDIDO, 0) AS SYSTEM_NUMERO
        FROM ${PEDIDOS_CAB_TABLE} C
        LEFT JOIN ${comercialErpTable('CLI')} CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(C.CODIGOCLIENTE)
        WHERE TRIM(C.ESTADO) = 'CONFIRMADO'
          AND TRIM(C.CODIGOREPARTIDOR) IN (${placeholders})
          AND TRIM(C.CODIGOREPARTIDOR) <> ''
          AND C.DIAREPARTO = ?
          AND C.MESREPARTO = ?
          AND C.ANOREPARTO = ?
          AND LOCATE('[COBRO_COMERCIAL]', COALESCE(C.OBSERVACIONES, '')) = 0
          AND NOT EXISTS (
            SELECT 1 FROM JAVIER.RUTERO_CONFIG RC
            WHERE TRIM(RC.CLIENTE) = TRIM(C.CODIGOCLIENTE)
              AND RC.ORDEN < 0
          )
    `;
    return queryWithParams(sql, [...ids, day, month, year], false);
}

async function getConfirmedPedidoDetailForRutero({
    numero, ejercicio, serie, terminal, cliente,
} = {}) {
    const { PEDIDOS_LIN_TABLE } = require('./_shared');
    const number = Number(numero);
    const year = Number(ejercicio);
    const client = String(cliente || '').trim();
    if (!Number.isFinite(number) || number <= 0 || !Number.isFinite(year) || !client) {
        return { headers: [], lines: [] };
    }
    const params = [number, year, client];
    let serieSql = '';
    if (serie !== undefined && serie !== null && String(serie).trim() !== '') {
        serieSql = ' AND TRIM(C.SERIEPEDIDO) = ?';
        params.push(String(serie).trim());
    }
    let terminalSql = '';
    if (terminal !== undefined && terminal !== null && String(terminal).trim() !== '') {
        const term = Number(terminal);
        if (Number.isFinite(term)) {
            terminalSql = ' AND COALESCE(C.TERMINAL, C.TERMINALPEDIDO, 0) = ?';
            params.push(term);
        }
    }
    const headerSql = `
        SELECT
            C.ID AS PEDIDO_ID,
            'GMP' AS SUBEMPRESAALBARAN,
            C.EJERCICIO AS EJERCICIOALBARAN,
            TRIM(COALESCE(NULLIF(TRIM(C.SERIEPEDIDO), ''), 'M')) AS SERIEALBARAN,
            COALESCE(C.TERMINAL, C.TERMINALPEDIDO, 0) AS TERMINALALBARAN,
            C.NUMEROPEDIDO AS NUMEROALBARAN,
            C.IMPORTETOTAL AS IMPORTE,
            C.IMPORTETOTAL AS CAC_IMPORTE,
            COALESCE(C.IMPORTEBASE, C.IMPORTETOTAL) AS IMPORTE_BRUTO,
            COALESCE(C.IMPORTEBASE, C.IMPORTETOTAL) AS CPC_BASE1,
            0 AS CPC_BASE2,
            0 AS CPC_BASE3,
            0 AS CPC_PCTIVA1,
            0 AS CPC_PCTIVA2,
            0 AS CPC_PCTIVA3,
            COALESCE(C.IMPORTEIVA, 0) AS CPC_IVA1,
            0 AS CPC_IVA2,
            0 AS CPC_IVA3,
            C.DIADOCUMENTO, C.MESDOCUMENTO, C.ANODOCUMENTO,
            TRIM(C.CODIGOCLIENTE) AS CLIENTE,
            TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, C.NOMBRECLIENTE, '')) AS CLIENTE_NOM,
            TRIM(COALESCE(CLI.DIRECCION, '')) AS DIR,
            TRIM(COALESCE(CLI.POBLACION, '')) AS POB,
            TRIM(C.CODIGOFORMAPAGO) AS FORMA_PAGO,
            0 AS NUMEROFACTURA,
            CAST('' AS CHAR(1)) AS SERIEFACTURA,
            TRIM(C.CODIGOREPARTIDOR) AS CODIGO_REPARTIDOR
        FROM ${PEDIDOS_CAB_TABLE} C
        LEFT JOIN ${comercialErpTable('CLI')} CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(C.CODIGOCLIENTE)
        WHERE C.NUMEROPEDIDO = ?
          AND C.EJERCICIO = ?
          AND TRIM(C.CODIGOCLIENTE) = ?
          AND TRIM(C.ESTADO) = 'CONFIRMADO'
          AND TRIM(C.CODIGOREPARTIDOR) <> ''
          AND LOCATE('[COBRO_COMERCIAL]', COALESCE(C.OBSERVACIONES, '')) = 0
          ${serieSql}
          ${terminalSql}
    `;
    const headers = await queryWithParams(headerSql, params, false);
    if (!Array.isArray(headers) || headers.length !== 1) {
        return { headers: headers || [], lines: [] };
    }
    const lines = await queryWithParams(`
        SELECT
            SECUENCIA,
            TRIM(CODIGOARTICULO) AS CODIGOARTICULO,
            TRIM(DESCRIPCION) AS DESCRIPCION,
            CANTIDADUNIDADES,
            CANTIDADENVASES,
            PRECIOVENTA,
            IMPORTEVENTA,
            TRIM(UNIDADMEDIDA) AS UNIDADMEDIDA
        FROM ${PEDIDOS_LIN_TABLE}
        WHERE PEDIDO_ID = ?
        ORDER BY SECUENCIA
    `, [headers[0].PEDIDO_ID], false);
    return { headers, lines: lines || [] };
}

async function searchProducts(params) {
    const { getProducts } = require('./index');
    const products = await getProducts(params); return { products, count: products.length };
}
async function getProductStock(code) {
    const { getStock } = require('./index');
    return getStock(code);
}
async function getClientPricing(clientCode) {
    // Get client tariff code + client-specific prices from last purchases
    const sql = `
        SELECT
            COALESCE(CODIGOTARIFA, 1) AS CODIGOTARIFA,
            COALESCE(CODIGOTARIFA, 1) AS CODIGOTARIFAVENTADIRECTA,
            COALESCE(PORCENTAJEDECUENTO1, 0) AS PORCENTAJEDESCUENTO1,
            COALESCE(PORCENTAJEDECUENTO21, 0) AS PORCENTAJEDESCUENTO2,
            COALESCE(PORCENTAJEDECUENTO3, 0) AS PORCENTAJEDESCUENTO3
        FROM ${comercialErpTable('CLC')}
        WHERE TRIM(CODIGOCLIENTE) = ?
        FETCH FIRST 1 ROW ONLY`;
    const rows = await queryWithParams(sql, [String(clientCode || '').trim()]);
    return rows.length > 0 ? rows[0] : null;
}
async function getProductFamilies() {
    const { getFamilies } = require('./index');
    return getFamilies();
}
async function getProductBrands() {
    const { getBrands } = require('./index');
    return getBrands();
}
module.exports = {
    getConfirmedPedidosForRutero,
    getConfirmedPedidoDetailForRutero,
    searchProducts,
    getProductStock,
    getClientPricing,
    getProductFamilies,
    getProductBrands,
};
