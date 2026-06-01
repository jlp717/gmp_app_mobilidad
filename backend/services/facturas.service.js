/**
 * FACTURAS SERVICE (CommonJS)
 * ===========================
 * Service for invoice operations for commercial profile
 * Ported from src/services/facturas.service.ts
 * 
 * SECURITY: All queries use parameterized queries (queryWithParams) to prevent SQL injection
 */

const { query, queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');
const { CircuitBreaker } = require('./circuit-breaker');
const { redisCache, TTL } = require('./redis-cache');

const facturasBreaker = new CircuitBreaker({
    name: 'facturas-db',
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 15000
});

const BATCH_SIZE = 15;
const FACTURA_CACHE_VERSION = 'v2';
const TAX_SLOTS = [1, 2, 3, 4, 5];

function buildTaxBases(header) {
    return TAX_SLOTS.map(slot => ({
        base: parseFloat(header[`IMPORTEBASEIMPONIBLE${slot}`]) || 0,
        pct: parseFloat(header[`PORCENTAJEIVA${slot}`]) || 0,
        iva: parseFloat(header[`IMPORTEIVA${slot}`]) || 0
    })).filter(b => b.base !== 0 || b.iva !== 0);
}

async function batchedVendorQuery(baseSql, vendorColumn, vendors, queryFn) {
    if (!vendors || vendors.length === 0) {
        return [];
    }

    const batches = [];
    for (let i = 0; i < vendors.length; i += BATCH_SIZE) {
        batches.push(vendors.slice(i, i + BATCH_SIZE));
    }

    const results = [];
    for (const batch of batches) {
        const placeholders = batch.map(() => '?').join(',');
        const sql = baseSql.replace('@VENDOR_IN@', `TRIM(${vendorColumn}) IN (${placeholders})`);
        const rows = await queryFn(sql, batch);
        results.push(...rows);
    }
    return results;
}

class FacturasService {

    async getFacturas(params) {
        const cacheKey = `facturas:list:${FACTURA_CACHE_VERSION}:${JSON.stringify(params)}`;
        
        // Try Redis cache first (30s TTL for list — data changes slightly during day)
        const cached = await redisCache.get('route', cacheKey);
        if (cached !== null) return cached;

        try {
            const result = await facturasBreaker.execute(
                () => this.getFacturasRaw(params),
                () => ({ facturas: [], error: 'Service temporarily unavailable' })
            );
            await redisCache.set('route', cacheKey, result, TTL.SHORT);
            return result;
        } catch (e) {
            const result = await this.getFacturasRaw(params);
            await redisCache.set('route', cacheKey, result, TTL.SHORT);
            return result;
        }
    }
    
    async getFacturasRaw(params) {
        const { vendedorCodes, year, month, search, clientId, clientSearch, docSearch, dateFrom, dateTo } = params;

        if (!vendedorCodes) {
            throw new Error('vendedorCodes is required');
        }

        const isAll = vendedorCodes.trim().toUpperCase() === 'ALL';
        const vendors = isAll ? [] : vendedorCodes.split(',').map(v => v.trim()).filter(v => v && v !== 'UNK' && /^[A-Z0-9]+$/.test(v));

        const currentYear = year || new Date().getFullYear();
        const dateFilterApplied = dateFrom && dateTo;
        const dateFromInt = dateFilterApplied ? parseInt(dateFrom.replace(/-/g, '')) : null;
        const dateToInt = dateFilterApplied ? parseInt(dateTo.replace(/-/g, '')) : null;

        function buildSqlForVendors(vendorBatch) {
            let sql = `
      SELECT
        TRIM(CFC.SERIEFACTURA) as SERIE,
        CFC.NUMEROFACTURA as NUMERO,
        CFC.EJERCICIOFACTURA as EJERCICIO,
        CFC.ANODOCUMENTO as ANO,
        CFC.MESDOCUMENTO as MES,
        CFC.DIADOCUMENTO as DIA,
        TRIM(CFC.CODIGOCLIENTE) as CODIGO_CLIENTE,
        TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE_CLIENTE,
        TRIM(CLI.NOMBREALTERNATIVO) as NOMBRE_COMERCIAL,
        TRIM(CLI.NOMBRECLIENTE) as NOMBRE_FISCAL,
        CFC.IMPORTETOTAL as TOTAL,
        CFC.IMPORTEBASEIMPONIBLE as BASE,
        CFC.IMPORTEIVA as IVA
      FROM DSEDAC.CFC CFC
      LEFT JOIN DSEDAC.CLI CLI ON CLI.CODIGOCLIENTE = CFC.CODIGOCLIENTE
      WHERE CFC.NUMEROFACTURA > 0 AND CFC.NUMEROFACTURA < 900000
    `;
            const queryParams = [];

            if (vendorBatch.length > 0) {
                const placeholders = vendorBatch.map(() => '?').join(',');
                sql += ` AND TRIM(CFC.CODIGOVENDEDOR) IN (${placeholders})`;
                queryParams.push(...vendorBatch);
            }

            if (dateFilterApplied && dateFromInt && dateToInt) {
                sql += ` AND (CFC.ANODOCUMENTO * 10000 + CFC.MESDOCUMENTO * 100 + CFC.DIADOCUMENTO) BETWEEN ? AND ?`;
                queryParams.push(dateFromInt, dateToInt);
            } else {
                sql += ` AND CFC.EJERCICIOFACTURA = ?`;
                queryParams.push(currentYear);
                if (month) {
                    sql += ` AND CFC.MESDOCUMENTO = ?`;
                    queryParams.push(month);
                }
            }

            if (clientId) {
                sql += ` AND TRIM(CFC.CODIGOCLIENTE) = ?`;
                queryParams.push(clientId.trim());
            }

            if (clientSearch) {
                const safeClientSearch = `%${clientSearch.toUpperCase()}%`;
                sql += ` AND (UPPER(CLI.NOMBRECLIENTE) LIKE ? OR UPPER(CLI.NOMBREALTERNATIVO) LIKE ?)`;
                queryParams.push(safeClientSearch, safeClientSearch);
            }

            if (docSearch) {
                const safeDocSearch = `%${docSearch.toUpperCase()}%`;
                const searchNum = parseFloat(docSearch);
                const isNum = !isNaN(searchNum);
                if (isNum) {
                    sql += ` AND (TRIM(CFC.SERIEFACTURA) LIKE ? OR TRIM(CFC.CODIGOCLIENTE) LIKE ? OR CFC.NUMEROFACTURA = ?)`;
                    queryParams.push(safeDocSearch, safeDocSearch, searchNum);
                } else {
                    sql += ` AND (TRIM(CFC.SERIEFACTURA) LIKE ? OR TRIM(CFC.CODIGOCLIENTE) LIKE ?)`;
                    queryParams.push(safeDocSearch, safeDocSearch);
                }
            }

            if (search) {
                const safeSearch = `%${search.toUpperCase()}%`;
                const searchNum = parseFloat(search);
                const isNum = !isNaN(searchNum);
                if (isNum) {
                    sql += ` AND (UPPER(CLI.NOMBRECLIENTE) LIKE ? OR UPPER(CLI.NOMBREALTERNATIVO) LIKE ? OR CFC.NUMEROFACTURA = ? OR TRIM(CFC.CODIGOCLIENTE) LIKE ?)`;
                    queryParams.push(safeSearch, safeSearch, searchNum, safeSearch);
                } else {
                    sql += ` AND (UPPER(CLI.NOMBRECLIENTE) LIKE ? OR UPPER(CLI.NOMBREALTERNATIVO) LIKE ? OR TRIM(CFC.CODIGOCLIENTE) LIKE ?)`;
                    queryParams.push(safeSearch, safeSearch, safeSearch);
                }
            }

            sql += ` ORDER BY CFC.ANODOCUMENTO DESC, CFC.MESDOCUMENTO DESC, CFC.DIADOCUMENTO DESC, CFC.NUMEROFACTURA DESC`;
            return { sql, queryParams };
        }

        try {
            let rows;
            if (isAll || vendors.length === 0) {
                const { sql, queryParams } = buildSqlForVendors([]);
                rows = await queryWithParams(sql, queryParams);
            } else if (vendors.length <= BATCH_SIZE) {
                const { sql, queryParams } = buildSqlForVendors(vendors);
                rows = await queryWithParams(sql, queryParams);
            } else {
                const batches = [];
                for (let i = 0; i < vendors.length; i += BATCH_SIZE) {
                    batches.push(vendors.slice(i, i + BATCH_SIZE));
                }
                const batchResults = await Promise.all(
                    batches.map(batch => {
                        const { sql, queryParams } = buildSqlForVendors(batch);
                        return queryWithParams(sql, queryParams);
                    })
                );
                rows = batchResults.flat();
            }

            const invoiceMap = new Map();
            for (const row of rows) {
                const key = `${row.SERIE}-${row.NUMERO}-${row.EJERCICIO}`;
                const sanitize = (v) => {
                    const n = parseFloat(v) || 0;
                    if (Object.is(n, -0)) return 0;
                    if (Math.abs(n) >= 900000) return 0;
                    return n;
                };

                if (!invoiceMap.has(key)) {
                    invoiceMap.set(key, {
                        id: key,
                        serie: row.SERIE,
                        numero: row.NUMERO,
                        ejercicio: row.EJERCICIO,
                        fecha: `${String(row.DIA).padStart(2, '0')}/${String(row.MES).padStart(2, '0')}/${row.ANO}`,
                        clienteId: row.CODIGO_CLIENTE,
                        clienteNombre: row.NOMBRE_CLIENTE || `Cliente ${row.CODIGO_CLIENTE}`,
                        nombreComercial: row.NOMBRE_COMERCIAL || row.NOMBRE_CLIENTE || `Cliente ${row.CODIGO_CLIENTE}`,
                        nombreFiscal: row.NOMBRE_FISCAL || `Cliente ${row.CODIGO_CLIENTE}`,
                        total: sanitize(row.TOTAL),
                        base: sanitize(row.BASE),
                        iva: sanitize(row.IVA)
                    });
                } else {
                    // Same invoice, different albarán → accumulate amounts
                    const existing = invoiceMap.get(key);
                    existing.total += sanitize(row.TOTAL);
                    existing.base += sanitize(row.BASE);
                    existing.iva += sanitize(row.IVA);
                }
            }

            return Array.from(invoiceMap.values());
        } catch (error) {
            if (error.message.includes('CWB0111') || error.message.includes('22001') || error.message.includes('parameter')) {
                logger.warn(`[facturas] Query failed (expected with many vendors), returning empty: ${error.message.substring(0, 80)}`);
            } else {
                logger.error(`Error fetching facturas: ${error.message}`);
            }
            return [];
        }
    }

    async getAvailableYears(vendedorCodes) {
        if (!vendedorCodes) {
            throw new Error('vendedorCodes is required');
        }

        const isAll = vendedorCodes.trim().toUpperCase() === 'ALL';
        
        if (isAll) {
            const sql = `
      SELECT DISTINCT EJERCICIOFACTURA as YEAR
      FROM DSEDAC.CFC
      WHERE NUMEROFACTURA > 0 AND NUMEROFACTURA < 900000
      ORDER BY YEAR DESC
    `;
            try {
                const rows = await query(sql);
                return rows.map(r => r.YEAR);
            } catch (error) {
                logger.error(`Error fetching available years: ${error.message}`);
                throw error;
            }
        }

        const vendors = vendedorCodes.split(',').map(v => v.trim()).filter(v => v && v !== 'UNK' && /^[A-Z0-9]+$/.test(v));

        const baseSql = `
      SELECT DISTINCT EJERCICIOFACTURA as YEAR
      FROM DSEDAC.CFC
      WHERE NUMEROFACTURA > 0 AND NUMEROFACTURA < 900000
        AND @VENDOR_IN@
      ORDER BY YEAR DESC
    `;

        try {
            const rows = await batchedVendorQuery(baseSql, 'CODIGOVENDEDOR', vendors, queryWithParams);
            const years = [...new Set(rows.map(r => r.YEAR))].sort((a, b) => b - a);
            return years;
        } catch (error) {
            if (error.message.includes('CWB0111') || error.message.includes('22001') || error.message.includes('parameter')) {
                logger.warn(`[facturas] Vendor batch query failed (expected with many vendors), returning empty: ${error.message.substring(0, 80)}`);
            } else {
                logger.error(`Error fetching available years: ${error.message}`);
            }
            return [];
        }
    }

    async getSummary(params) {
        const { vendedorCodes, year, month, dateFrom, dateTo } = params;

        if (!vendedorCodes) {
            throw new Error('vendedorCodes is required');
        }

        const cacheKey = `facturas:summary:${FACTURA_CACHE_VERSION}:${vendedorCodes || 'ALL'}:${year || ''}:${month || ''}:${dateFrom || ''}:${dateTo || ''}`;
        const cached = await redisCache.get('route', cacheKey);
        if (cached !== null) return cached;

        const result = await this._getSummaryInternal(params);
        await redisCache.set('route', cacheKey, result, TTL.MEDIUM);
        return result;
    }

    async _getSummaryInternal(params) {
        const { vendedorCodes, year, month, dateFrom, dateTo } = params;

        if (!vendedorCodes) {
            throw new Error('vendedorCodes is required');
        }

        const isAll = vendedorCodes.trim().toUpperCase() === 'ALL';
        const vendors = isAll ? [] : vendedorCodes.split(',').map(v => v.trim()).filter(v => v && v !== 'UNK' && /^[A-Z0-9]+$/.test(v));

        const dateFilterApplied = dateFrom && dateTo;
        const dateFromInt = dateFilterApplied ? parseInt(dateFrom.replace(/-/g, '')) : null;
        const dateToInt = dateFilterApplied ? parseInt(dateTo.replace(/-/g, '')) : null;
        const useYearFilter = !dateFilterApplied && (year || month);
        const currentYear = year || new Date().getFullYear();

        async function runSummaryBatch(batchVendors) {
            let sql = `
      SELECT
        COUNT(DISTINCT TRIM(CFC.SERIEFACTURA) || '-' || CFC.NUMEROFACTURA) as NUM_FACTURAS,
        SUM(CFC.IMPORTETOTAL) as TOTAL,
        SUM(CFC.IMPORTEBASEIMPONIBLE) as BASE,
        SUM(CFC.IMPORTEIVA) as IVA
      FROM DSEDAC.CFC CFC
      WHERE CFC.NUMEROFACTURA > 0 AND CFC.NUMEROFACTURA < 900000
    `;
            const queryParams = [];

            if (batchVendors.length > 0) {
                const placeholders = batchVendors.map(() => '?').join(',');
                sql += ` AND TRIM(CFC.CODIGOVENDEDOR) IN (${placeholders})`;
                queryParams.push(...batchVendors);
            }

            if (dateFilterApplied && dateFromInt && dateToInt) {
                sql += ` AND (CFC.ANODOCUMENTO * 10000 + CFC.MESDOCUMENTO * 100 + CFC.DIADOCUMENTO) BETWEEN ? AND ?`;
                queryParams.push(dateFromInt, dateToInt);
            } else {
                sql += ` AND CFC.EJERCICIOFACTURA = ?`;
                queryParams.push(currentYear);
                if (month) {
                    sql += ` AND CFC.MESDOCUMENTO = ?`;
                    queryParams.push(month);
                }
            }

            return queryWithParams(sql, queryParams);
        }

        try {
            let rows;
            if (isAll || vendors.length === 0) {
                rows = await runSummaryBatch([]);
            } else {
                const batches = [];
                for (let i = 0; i < vendors.length; i += BATCH_SIZE) {
                    batches.push(vendors.slice(i, i + BATCH_SIZE));
                }
                const batchResults = await Promise.all(batches.map(runSummaryBatch));
                rows = batchResults.flat();
            }

            const stats = rows.reduce((acc, r) => ({
                NUM_FACTURAS: (acc.NUM_FACTURAS || 0) + (parseInt(r.NUM_FACTURAS) || 0),
                TOTAL: (acc.TOTAL || 0) + (parseFloat(r.TOTAL) || 0),
                BASE: (acc.BASE || 0) + (parseFloat(r.BASE) || 0),
                IVA: (acc.IVA || 0) + (parseFloat(r.IVA) || 0)
            }), { NUM_FACTURAS: 0, TOTAL: 0, BASE: 0, IVA: 0 });

            return {
                totalFacturas: stats.NUM_FACTURAS,
                totalImporte: stats.TOTAL,
                totalBase: stats.BASE,
                totalIva: stats.IVA
            };
        } catch (error) {
            if (error.message.includes('CWB0111') || error.message.includes('22001') || error.message.includes('parameter')) {
                logger.warn(`[facturas] Summary query failed (expected with many vendors), returning zeros: ${error.message.substring(0, 80)}`);
            } else {
                logger.error(`Error fetching summary: ${error.message}`);
            }
            return { totalFacturas: 0, totalImporte: 0, totalBase: 0, totalIva: 0 };
        }
    }

    async getFacturaDetail(serie, numero, ejercicio) {
        // AUDIT FIX: Block sentinel invoice numbers
        if (numero >= 900000 || numero <= 0) {
            throw new Error('Factura no encontrada');
        }

        // Use CFC as the fiscal invoice header. CAC is per-albaran and its
        // rounded totals can drift from the printed invoice header.
        const headerSql = `
      SELECT
        CFC.NUMEROFACTURA,
        CFC.SERIEFACTURA,
        CFC.EJERCICIOFACTURA,
        CFC.DIADOCUMENTO as DIAFACTURA,
        CFC.MESDOCUMENTO as MESFACTURA,
        CFC.ANODOCUMENTO as ANOFACTURA,
        TRIM(CFC.CODIGOCLIENTE) as CODIGOCLIENTE,
        TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRECLIENTEFACTURA,
        TRIM(CLI.NOMBREALTERNATIVO) as NOMBRECOMERCIALFACTURA,
        TRIM(CLI.NOMBRECLIENTE) as NOMBREFISCALFACTURA,
        TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCIONCLIENTEFACTURA,
        TRIM(COALESCE(CLI.POBLACION, '')) as POBLACIONCLIENTEFACTURA,
        TRIM(COALESCE(CLI.NIF, '')) as CIFCLIENTEFACTURA,
        CFC.IMPORTETOTAL as TOTALFACTURA,
        CFC.IMPORTEBASEIMPONIBLE1,
        CFC.PORCENTAJEIVA1,
        CFC.IMPORTEIVA1,
        CFC.IMPORTEBASEIMPONIBLE2,
        CFC.PORCENTAJEIVA2,
        CFC.IMPORTEIVA2,
        CFC.IMPORTEBASEIMPONIBLE3,
        CFC.PORCENTAJEIVA3,
        CFC.IMPORTEIVA3,
        CFC.IMPORTEBASEIMPONIBLE4,
        CFC.PORCENTAJEIVA4,
        CFC.IMPORTEIVA4,
        CFC.IMPORTEBASEIMPONIBLE5,
        CFC.PORCENTAJEIVA5,
        CFC.IMPORTEIVA5
      FROM DSEDAC.CFC CFC
      LEFT JOIN DSEDAC.CLI CLI ON CLI.CODIGOCLIENTE = CFC.CODIGOCLIENTE
      WHERE TRIM(CFC.SERIEFACTURA) = ?
        AND CFC.NUMEROFACTURA = ?
        AND CFC.EJERCICIOFACTURA = ?
      FETCH FIRST 1 ROWS ONLY
    `;

        try {
            const headers = await queryWithParams(headerSql, [serie, numero, ejercicio]);

            if (!headers || headers.length === 0) {
                throw new Error('Factura no encontrada'); // This string must match the check in routes
            }

            const header = headers[0];

            const linesSql = `
        SELECT 
          LAC.CODIGOARTICULO,
          LAC.DESCRIPCION as DESCRIPCIONARTICULO,
          LAC.CANTIDADUNIDADES as CANTIDAD,
          LAC.PRECIOVENTA as PRECIO,
          LAC.IMPORTEVENTA as IMPORTE,
          LAC.PORCENTAJEDESCUENTO as DESCUENTO,
          LAC.NUMEROALBARAN,
          LAC.SERIEALBARAN,
          LAC.TERMINALALBARAN,
          LAC.EJERCICIOALBARAN,
          LAC.CODIGOIVA,
          COALESCE(LAC.CANTIDADENVASES, 0) as CAJAS,
          LAC.IMPORTEVENTA as IMPORTENETO,
          LAC.DIADOCUMENTO,
          LAC.MESDOCUMENTO,
          LAC.ANODOCUMENTO
        FROM DSEDAC.LAC LAC
        INNER JOIN DSEDAC.CAC CAC 
          ON LAC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
          AND LAC.SERIEALBARAN = CAC.SERIEALBARAN
          AND LAC.TERMINALALBARAN = CAC.TERMINALALBARAN
          AND LAC.NUMEROALBARAN = CAC.NUMEROALBARAN
        WHERE TRIM(CAC.SERIEFACTURA) = ?
          AND CAC.NUMEROFACTURA = ?
          AND CAC.EJERCICIOFACTURA = ?
        ORDER BY LAC.NUMEROALBARAN, LAC.SECUENCIA
      `;

            const lines = await queryWithParams(linesSql, [serie, numero, ejercicio]);

            const bases = buildTaxBases(header);

            return {
                header: {
                    serie: header.SERIEFACTURA && header.SERIEFACTURA.trim ? header.SERIEFACTURA.trim() : serie,
                    numero: header.NUMEROFACTURA,
                    ejercicio: header.EJERCICIOFACTURA,
                    fecha: `${String(header.DIAFACTURA).padStart(2, '0')}/${String(header.MESFACTURA).padStart(2, '0')}/${header.ANOFACTURA}`,
                    clienteId: header.CODIGOCLIENTE,
                    clienteNombre: header.NOMBRECLIENTEFACTURA,
                    nombreComercial: header.NOMBRECOMERCIALFACTURA || header.NOMBRECLIENTEFACTURA,
                    nombreFiscal: header.NOMBREFISCALFACTURA || header.NOMBRECLIENTEFACTURA,
                    clienteDireccion: header.DIRECCIONCLIENTEFACTURA,
                    clientePoblacion: header.POBLACIONCLIENTEFACTURA,
                    clienteNif: header.CIFCLIENTEFACTURA,
                    total: parseFloat(header.TOTALFACTURA) || 0,
                    bases
                },
                lines: lines.map(l => ({
                    codigo: l.CODIGOARTICULO && l.CODIGOARTICULO.trim ? l.CODIGOARTICULO.trim() : '',
                    descripcion: l.DESCRIPCIONARTICULO && l.DESCRIPCIONARTICULO.trim ? l.DESCRIPCIONARTICULO.trim() : '',
                    cantidad: parseFloat(l.CANTIDAD) || 0,
                    precio: parseFloat(l.PRECIO) || 0,
                    importe: parseFloat(l.IMPORTE) || 0,
                    descuento: parseFloat(l.DESCUENTO) || 0,
                    albaranNum: l.NUMEROALBARAN,
                    albaranSerie: l.SERIEALBARAN ? l.SERIEALBARAN.trim() : '',
                    albaranTerminal: l.TERMINALALBARAN,
                    albaranEjercicio: l.EJERCICIOALBARAN,
                    albaranFecha: l.DIADOCUMENTO && l.MESDOCUMENTO && l.ANODOCUMENTO
                        ? `${String(l.DIADOCUMENTO).padStart(2, '0')}.${String(l.MESDOCUMENTO).padStart(2, '0')}.${l.ANODOCUMENTO}`
                        : '',
                    codigoIva: l.CODIGOIVA ? l.CODIGOIVA.trim() : '',
                    cajas: l.CAJAS || 0,
                    importeNeto: parseFloat(l.IMPORTENETO) || 0
                }))
            };
        } catch (error) {
            logger.error(`Error fetching factura detail: ${error.message}`);
            throw error;
        }
    }

    generateWhatsAppMessage(serie, numero, fecha, total, clienteNombre) {
        return `Granja Mari Pepa\n\n` +
            `Factura: ${serie}-${numero}\n` +
            `Fecha: ${fecha}\n` +
            `Total: ${total.toFixed(2)} EUR\n\n` +
            `Cliente: ${clienteNombre}\n\n` +
            `Gracias por su confianza.`;
    }
}

module.exports = new FacturasService();
module.exports.facturasBreaker = facturasBreaker;
