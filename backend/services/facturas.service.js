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

function boundedIntFromEnv(name, defaultValue, minValue, maxValue) {
    const parsed = parseInt(process.env[name], 10);
    if (!Number.isFinite(parsed)) return defaultValue;
    return Math.min(maxValue, Math.max(minValue, parsed));
}

const BATCH_SIZE = 15;
const FACTURA_CACHE_VERSION = 'v4';
const FACTURAS_LIST_BATCH_CONCURRENCY = boundedIntFromEnv('FACTURAS_LIST_BATCH_CONCURRENCY', 2, 1, 2);
const FACTURAS_SUMMARY_BATCH_CONCURRENCY = boundedIntFromEnv('FACTURAS_SUMMARY_BATCH_CONCURRENCY', 1, 1, 2);
const IN_FLIGHT_LIMIT = 200;
const TAX_SLOTS = [1, 2, 3, 4, 5];
const DEFAULT_LIST_LIMIT = 250;
const MAX_LIST_LIMIT = 500;
const MAX_LIST_OFFSET = 5000;
const facturasListInFlight = new Map();
const facturasSummaryInFlight = new Map();
const facturaDetailInFlight = new Map();
const albaranDetailInFlight = new Map();
// v2: header now carries CODIGOVENDEDOR for BOLA scope checks (routes/facturas.js)
const DOCUMENT_DETAIL_CACHE_VERSION = 'v2';

async function withInFlight(map, key, loader) {
    const existing = map.get(key);
    if (existing) return existing;

    const promise = (async () => loader())();
    map.set(key, promise);

    while (map.size > IN_FLIGHT_LIMIT) {
        const oldestKey = map.keys().next().value;
        if (oldestKey === undefined || oldestKey === key) break;
        map.delete(oldestKey);
    }

    try {
        return await promise;
    } finally {
        if (map.get(key) === promise) map.delete(key);
    }
}

function clampPositiveInt(value, defaultValue, maxValue) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed === 0) return defaultValue;
    return Math.min(maxValue, Math.max(1, parsed));
}

function clampOffset(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.min(MAX_LIST_OFFSET, parsed);
}

function sortInvoiceRowsDesc(a, b) {
    const aDate = (parseInt(a.ANO, 10) || 0) * 10000 + (parseInt(a.MES, 10) || 0) * 100 + (parseInt(a.DIA, 10) || 0);
    const bDate = (parseInt(b.ANO, 10) || 0) * 10000 + (parseInt(b.MES, 10) || 0) * 100 + (parseInt(b.DIA, 10) || 0);
    if (bDate !== aDate) return bDate - aDate;
    return (parseInt(b.NUMERO, 10) || 0) - (parseInt(a.NUMERO, 10) || 0);
}

function normalizeDocumentType(value) {
    const term = String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();

    if (!term || term === 'ALL' || term === 'TODOS' || term === 'TODO') return 'all';
    if (['FACTURA', 'FACTURAS', 'F'].includes(term)) return 'factura';
    if (['ALBARAN', 'ALBARANES', 'ALB', 'A'].includes(term)) return 'albaran';
    return 'all';
}

function normalizeSearchValue(value) {
    return String(value || '')
        .trim()
        .replace(/[%_]/g, '')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .slice(0, 80)
        .toUpperCase();
}

function resolveOwnershipYear({ year, dateFromInt, dateFilterApplied }) {
    if (dateFilterApplied && dateFromInt) {
        return Math.floor(dateFromInt / 10000);
    }
    const parsed = parseInt(year, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return new Date().getFullYear();
}

function appendCfcVendorScopeFilter(sql, queryParams, vendorBatch, ownershipYear) {
    if (!vendorBatch.length) return sql;
    const placeholders = vendorBatch.map(() => '?').join(',');
    sql += ` AND (
      TRIM(CFC.CODIGOVENDEDOR) IN (${placeholders})
      OR (
        (CFC.CODIGOVENDEDOR IS NULL OR TRIM(CFC.CODIGOVENDEDOR) = '')
        AND TRIM(CFC.CODIGOCLIENTE) IN (
          SELECT DISTINCT TRIM(OWN.CODIGOCLIENTE)
          FROM DSEDAC.CFC OWN
          WHERE TRIM(OWN.CODIGOVENDEDOR) IN (${placeholders})
            AND OWN.NUMEROFACTURA > 0
            AND OWN.NUMEROFACTURA < 900000
            AND OWN.EJERCICIOFACTURA = ?
        )
      )
    )`;
    queryParams.push(...vendorBatch, ...vendorBatch, ownershipYear);
    return sql;
}

function buildClientSearchFilter(value, clientColumn) {
    const term = normalizeSearchValue(value);
    if (!term) return { clause: '', params: [] };

    const prefix = `${term}%`;
    if (/^\d+$/.test(term)) {
        return {
            clause: `AND (TRIM(${clientColumn}) LIKE ? OR UPPER(COALESCE(CLI.NIF, '')) LIKE ?)`,
            params: [prefix, prefix],
        };
    }

    const textPattern = term.length < 3 ? prefix : `%${term}%`;
    return {
        clause: `AND (UPPER(COALESCE(CLI.NOMBRECLIENTE, '')) LIKE ?
                  OR UPPER(COALESCE(CLI.NOMBREALTERNATIVO, '')) LIKE ?
                  OR UPPER(COALESCE(CLI.POBLACION, '')) LIKE ?
                  OR UPPER(COALESCE(CLI.NIF, '')) LIKE ?
                  OR TRIM(${clientColumn}) LIKE ?)`,
        params: [textPattern, textPattern, textPattern, prefix, prefix],
    };
}

function buildDocSearchFilter(value, numberColumn, serieColumn, clientColumn) {
    const term = normalizeSearchValue(value);
    if (!term) return { clause: '', params: [] };

    const prefix = `${term}%`;
    if (/^\d+$/.test(term)) {
        return {
            clause: `AND (${numberColumn} = ? OR TRIM(${clientColumn}) LIKE ? OR UPPER(TRIM(${serieColumn})) LIKE ?)`,
            params: [Number.parseInt(term, 10), prefix, prefix],
        };
    }

    return {
        clause: `AND (UPPER(TRIM(${serieColumn})) LIKE ? OR TRIM(${clientColumn}) LIKE ?)`,
        params: [prefix, prefix],
    };
}

function buildSearchFilter(value, numberColumn, serieColumn, clientColumn) {
    const term = normalizeSearchValue(value);
    if (!term) return { clause: '', params: [] };

    const prefix = `${term}%`;
    if (/^\d+$/.test(term)) {
        return {
            clause: `AND (${numberColumn} = ? OR TRIM(${clientColumn}) LIKE ? OR UPPER(COALESCE(CLI.NIF, '')) LIKE ?)`,
            params: [Number.parseInt(term, 10), prefix, prefix],
        };
    }

    const textPattern = term.length < 3 ? prefix : `%${term}%`;
    return {
        clause: `AND (UPPER(COALESCE(CLI.NOMBRECLIENTE, '')) LIKE ?
                  OR UPPER(COALESCE(CLI.NOMBREALTERNATIVO, '')) LIKE ?
                  OR UPPER(COALESCE(CLI.POBLACION, '')) LIKE ?
                  OR UPPER(TRIM(${serieColumn})) LIKE ?
                  OR TRIM(${clientColumn}) LIKE ?)`,
        params: [textPattern, textPattern, textPattern, prefix, prefix],
    };
}

function buildInvoiceClientSearchFilter(value) {
    return buildClientSearchFilter(value, 'CFC.CODIGOCLIENTE');
}

function buildInvoiceDocSearchFilter(value) {
    return buildDocSearchFilter(value, 'CFC.NUMEROFACTURA', 'CFC.SERIEFACTURA', 'CFC.CODIGOCLIENTE');
}

function buildInvoiceSearchFilter(value) {
    return buildSearchFilter(value, 'CFC.NUMEROFACTURA', 'CFC.SERIEFACTURA', 'CFC.CODIGOCLIENTE');
}

function buildAlbaranClientSearchFilter(value) {
    return buildClientSearchFilter(value, 'CAC.CODIGOCLIENTEALBARAN');
}

function buildAlbaranDocSearchFilter(value) {
    return buildDocSearchFilter(value, 'CAC.NUMEROALBARAN', 'CAC.SERIEALBARAN', 'CAC.CODIGOCLIENTEALBARAN');
}

function buildAlbaranSearchFilter(value) {
    return buildSearchFilter(value, 'CAC.NUMEROALBARAN', 'CAC.SERIEALBARAN', 'CAC.CODIGOCLIENTEALBARAN');
}

async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await mapper(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}

function buildTaxBases(header) {
    return TAX_SLOTS.map(slot => ({
        base: parseFloat(header[`IMPORTEBASEIMPONIBLE${slot}`]) || 0,
        pct: parseFloat(header[`PORCENTAJEIVA${slot}`]) || 0,
        iva: parseFloat(header[`IMPORTEIVA${slot}`]) || 0
    })).filter(b => b.base !== 0 || b.iva !== 0);
}

function normalizeSerieForLookup(value) {
    const serie = String(value || '')
        .trim()
        .replace(/[^A-Z0-9]/gi, '')
        .toUpperCase()
        .slice(0, 3);
    return serie;
}

function parseDocumentNumber(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 900000) {
        return null;
    }
    return parsed;
}

function buildDocumentDetailCacheKey(type, serie, numero, ejercicio, terminal = null) {
    const cleanSerie = normalizeSerieForLookup(serie);
    const cleanNumero = parseDocumentNumber(numero);
    const cleanEjercicio = parseInt(ejercicio, 10);
    const cleanTerminal = terminal === null || terminal === undefined || terminal === ''
        ? null
        : parseInt(terminal, 10);
    if (!cleanSerie || !cleanNumero || !Number.isFinite(cleanEjercicio) || cleanEjercicio <= 0
        || (terminal !== null && terminal !== undefined && terminal !== ''
            && (!Number.isFinite(cleanTerminal) || cleanTerminal < 0))) {
        return null;
    }
    const terminalKey = cleanTerminal === null ? 'ALL' : String(cleanTerminal);
    return 'facturas:document:' + DOCUMENT_DETAIL_CACHE_VERSION + ':' + type + ':' + cleanEjercicio + ':' + cleanSerie + ':' + terminalKey + ':' + cleanNumero;
}

function buildIvaBreakdown(header) {
    const breakdown = {};
    for (const slot of TAX_SLOTS) {
        breakdown[`BI${slot}`] = parseFloat(header[`IMPORTEBASEIMPONIBLE${slot}`]) || 0;
        breakdown[`IVA${slot}_PCT`] = parseFloat(header[`PORCENTAJEIVA${slot}`]) || 0;
        breakdown[`IVA${slot}_IMP`] = parseFloat(header[`IMPORTEIVA${slot}`]) || 0;
    }
    breakdown.IMPORTETOTAL = parseFloat(header.IMPORTETOTAL) || 0;
    return breakdown;
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

        return withInFlight(facturasListInFlight, cacheKey, async () => {
            const secondCache = await redisCache.get('route', cacheKey);
            if (secondCache !== null) return secondCache;

            const result = await facturasBreaker.execute(
                () => this.getFacturasRaw(params),
                async () => {
                    const stale = await redisCache.get('route', cacheKey);
                    if (stale !== null) return stale;
                    throw new Error('Facturas DB no disponible dentro del timeout seguro');
                }
            );

            if (result) {
                await redisCache.set('route', cacheKey, result, TTL.SHORT);
                return result;
            }

            throw new Error('Facturas DB no devolvio datos');
        });
    }
    
    async _getFacturasRawLegacy(params) {
        const { vendedorCodes, year, month, search, clientId, clientSearch, docSearch, dateFrom, dateTo } = params;
        const documentType = normalizeDocumentType(params.documentType || params.tipoDocumento);
        const rowsLimit = clampPositiveInt(params.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
        const rowsOffset = clampOffset(params.offset);

        if (!vendedorCodes) {
            throw new Error('vendedorCodes is required');
        }

        const isAll = vendedorCodes.trim().toUpperCase() === 'ALL';
        const vendors = isAll ? [] : vendedorCodes.split(',').map(v => v.trim()).filter(v => v && v !== 'UNK' && /^[A-Z0-9]+$/.test(v));

        const currentYear = year || new Date().getFullYear();
        const dateFilterApplied = dateFrom && dateTo;
        const dateFromInt = dateFilterApplied ? parseInt(dateFrom.replace(/-/g, '')) : null;
        const dateToInt = dateFilterApplied ? parseInt(dateTo.replace(/-/g, '')) : null;
        const ownershipYear = resolveOwnershipYear({ year: currentYear, dateFromInt, dateFilterApplied });

        function buildSqlForVendors(vendorBatch, offsetValue = rowsOffset, limitValue = rowsLimit) {
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
                sql = appendCfcVendorScopeFilter(sql, queryParams, vendorBatch, ownershipYear);
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

            const clientFilter = buildInvoiceClientSearchFilter(clientSearch);
            sql += ` ${clientFilter.clause}`;
            queryParams.push(...clientFilter.params);

            const docFilter = buildInvoiceDocSearchFilter(docSearch);
            sql += ` ${docFilter.clause}`;
            queryParams.push(...docFilter.params);

            const genericFilter = buildInvoiceSearchFilter(search);
            sql += ` ${genericFilter.clause}`;
            queryParams.push(...genericFilter.params);

            sql += ` ORDER BY CFC.ANODOCUMENTO DESC, CFC.MESDOCUMENTO DESC, CFC.DIADOCUMENTO DESC, CFC.NUMEROFACTURA DESC
                     OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`;
            queryParams.push(offsetValue, limitValue);
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
                const batchLimit = rowsOffset + rowsLimit;
                const batchResults = await mapWithConcurrency(
                    batches,
                    2,
                    async (batch) => {
                        const { sql, queryParams } = buildSqlForVendors(batch, 0, batchLimit);
                        return queryWithParams(sql, queryParams);
                    }
                );
                rows = batchResults.flat().sort(sortInvoiceRowsDesc).slice(rowsOffset, rowsOffset + rowsLimit);
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

    async getFacturasRaw(params) {
        const { vendedorCodes, year, month, search, clientId, clientSearch, docSearch, dateFrom, dateTo } = params;
        const rowsLimit = clampPositiveInt(params.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
        const rowsOffset = clampOffset(params.offset);
        const documentType = normalizeDocumentType(params.documentType || params.tipoDocumento);
        const includeFacturas = documentType !== 'albaran';
        const includeAlbaranes = documentType !== 'factura';

        if (!vendedorCodes) {
            throw new Error('vendedorCodes is required');
        }

        const isAll = vendedorCodes.trim().toUpperCase() === 'ALL';
        const vendors = isAll ? [] : vendedorCodes.split(',').map(v => v.trim()).filter(v => v && v !== 'UNK' && /^[A-Z0-9]+$/.test(v));

        const currentYear = year || new Date().getFullYear();
        const dateFilterApplied = dateFrom && dateTo;
        const dateFromInt = dateFilterApplied ? parseInt(dateFrom.replace(/-/g, '')) : null;
        const dateToInt = dateFilterApplied ? parseInt(dateTo.replace(/-/g, '')) : null;
        const ownershipYear = resolveOwnershipYear({ year: currentYear, dateFromInt, dateFilterApplied });

        function applyCommonFilters(sql, queryParams, {
            vendorBatch,
            vendorColumn,
            dateExpr,
            yearColumn,
            monthColumn,
            clientColumn,
            clientFilterBuilder,
            docFilterBuilder,
            genericFilterBuilder,
            includeOwnedEmptyVendor = false,
        }) {
            if (vendorBatch.length > 0) {
                if (includeOwnedEmptyVendor) {
                    sql = appendCfcVendorScopeFilter(sql, queryParams, vendorBatch, ownershipYear);
                } else {
                    const placeholders = vendorBatch.map(() => '?').join(',');
                    sql += ` AND TRIM(${vendorColumn}) IN (${placeholders})`;
                    queryParams.push(...vendorBatch);
                }
            }

            if (dateFilterApplied && dateFromInt && dateToInt) {
                sql += ` AND ${dateExpr} BETWEEN ? AND ?`;
                queryParams.push(dateFromInt, dateToInt);
            } else {
                sql += ` AND ${yearColumn} = ?`;
                queryParams.push(currentYear);
                if (month) {
                    sql += ` AND ${monthColumn} = ?`;
                    queryParams.push(month);
                }
            }

            if (clientId) {
                sql += ` AND TRIM(${clientColumn}) = ?`;
                queryParams.push(clientId.trim());
            }

            const clientFilter = clientFilterBuilder(clientSearch);
            sql += ` ${clientFilter.clause}`;
            queryParams.push(...clientFilter.params);

            const docFilter = docFilterBuilder(docSearch);
            sql += ` ${docFilter.clause}`;
            queryParams.push(...docFilter.params);

            const genericFilter = genericFilterBuilder(search);
            sql += ` ${genericFilter.clause}`;
            queryParams.push(...genericFilter.params);

            return sql;
        }

        function buildInvoiceSqlForVendors(vendorBatch, offsetValue, limitValue) {
            const queryParams = [];
            let sql = `
      SELECT
        'factura' as DOCUMENT_TYPE,
        TRIM(CFC.SERIEFACTURA) as SERIE,
        CFC.NUMEROFACTURA as NUMERO,
        CFC.EJERCICIOFACTURA as EJERCICIO,
        CAST(NULL AS INTEGER) as TERMINAL,
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
            sql = applyCommonFilters(sql, queryParams, {
                vendorBatch,
                vendorColumn: 'CFC.CODIGOVENDEDOR',
                dateExpr: '(CFC.ANODOCUMENTO * 10000 + CFC.MESDOCUMENTO * 100 + CFC.DIADOCUMENTO)',
                yearColumn: 'CFC.EJERCICIOFACTURA',
                monthColumn: 'CFC.MESDOCUMENTO',
                clientColumn: 'CFC.CODIGOCLIENTE',
                clientFilterBuilder: buildInvoiceClientSearchFilter,
                docFilterBuilder: buildInvoiceDocSearchFilter,
                genericFilterBuilder: buildInvoiceSearchFilter,
                includeOwnedEmptyVendor: true,
            });
            sql += ` ORDER BY CFC.ANODOCUMENTO DESC, CFC.MESDOCUMENTO DESC, CFC.DIADOCUMENTO DESC, CFC.NUMEROFACTURA DESC
                     OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`;
            queryParams.push(offsetValue, limitValue);
            return { sql, queryParams };
        }

        function buildAlbaranSqlForVendors(vendorBatch, offsetValue, limitValue) {
            const queryParams = [];
            let sql = `
      SELECT
        'albaran' as DOCUMENT_TYPE,
        TRIM(CAC.SERIEALBARAN) as SERIE,
        CAC.NUMEROALBARAN as NUMERO,
        CAC.EJERCICIOALBARAN as EJERCICIO,
        CAC.TERMINALALBARAN as TERMINAL,
        CAC.ANODOCUMENTO as ANO,
        CAC.MESDOCUMENTO as MES,
        CAC.DIADOCUMENTO as DIA,
        TRIM(CAC.CODIGOCLIENTEALBARAN) as CODIGO_CLIENTE,
        TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE_CLIENTE,
        TRIM(CLI.NOMBREALTERNATIVO) as NOMBRE_COMERCIAL,
        TRIM(CLI.NOMBRECLIENTE) as NOMBRE_FISCAL,
        CAC.IMPORTETOTAL as TOTAL,
        COALESCE(CAC.IMPORTEBRUTO, 0) as BASE,
        COALESCE(CAC.IMPORTEIVA1, 0) + COALESCE(CAC.IMPORTEIVA2, 0) + COALESCE(CAC.IMPORTEIVA3, 0) + COALESCE(CAC.IMPORTEIVA4, 0) + COALESCE(CAC.IMPORTEIVA5, 0) as IVA
      FROM DSEDAC.CAC CAC
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
      WHERE CAC.NUMEROALBARAN > 0 AND CAC.NUMEROALBARAN < 900000
        AND NOT (CAC.NUMEROFACTURA > 0 AND CAC.NUMEROFACTURA < 900000)
    `;
            sql = applyCommonFilters(sql, queryParams, {
                vendorBatch,
                vendorColumn: 'CAC.CODIGOVENDEDOR',
                dateExpr: '(CAC.ANODOCUMENTO * 10000 + CAC.MESDOCUMENTO * 100 + CAC.DIADOCUMENTO)',
                yearColumn: 'CAC.EJERCICIOALBARAN',
                monthColumn: 'CAC.MESDOCUMENTO',
                clientColumn: 'CAC.CODIGOCLIENTEALBARAN',
                clientFilterBuilder: buildAlbaranClientSearchFilter,
                docFilterBuilder: buildAlbaranDocSearchFilter,
                genericFilterBuilder: buildAlbaranSearchFilter,
            });
            sql += ` ORDER BY CAC.ANODOCUMENTO DESC, CAC.MESDOCUMENTO DESC, CAC.DIADOCUMENTO DESC, CAC.NUMEROALBARAN DESC
                     OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`;
            queryParams.push(offsetValue, limitValue);
            return { sql, queryParams };
        }

        async function queryDocumentsForVendors(vendorBatch, offsetValue, limitValue) {
            const queries = [];
            if (includeFacturas) {
                const { sql, queryParams } = buildInvoiceSqlForVendors(vendorBatch, offsetValue, limitValue);
                queries.push(() => queryWithParams(sql, queryParams));
            }
            if (includeAlbaranes) {
                const { sql, queryParams } = buildAlbaranSqlForVendors(vendorBatch, offsetValue, limitValue);
                queries.push(() => queryWithParams(sql, queryParams));
            }
            // Invoices and delivery notes are independent lookups — run them
            // concurrently instead of paying both latencies serially per batch.
            const results = await Promise.all(queries.map(runQuery => runQuery()));
            return results.flat();
        }

        try {
            const mergePagination = documentType === 'all' || (!isAll && vendors.length > BATCH_SIZE);
            const perQueryOffset = mergePagination ? 0 : rowsOffset;
            const perQueryLimit = mergePagination ? rowsOffset + rowsLimit : rowsLimit;

            let rows;
            if (isAll || vendors.length === 0) {
                rows = await queryDocumentsForVendors([], perQueryOffset, perQueryLimit);
            } else if (vendors.length <= BATCH_SIZE) {
                rows = await queryDocumentsForVendors(vendors, perQueryOffset, perQueryLimit);
            } else {
                const batches = [];
                for (let i = 0; i < vendors.length; i += BATCH_SIZE) {
                    batches.push(vendors.slice(i, i + BATCH_SIZE));
                }
                const batchResults = await mapWithConcurrency(
                    batches,
                    FACTURAS_LIST_BATCH_CONCURRENCY,
                    (batch) => queryDocumentsForVendors(batch, 0, rowsOffset + rowsLimit)
                );
                rows = batchResults.flat();
            }

            rows = rows.sort(sortInvoiceRowsDesc);
            if (mergePagination) {
                rows = rows.slice(rowsOffset, rowsOffset + rowsLimit);
            }

            const documentMap = new Map();
            for (const row of rows) {
                const sanitize = (v) => {
                    const n = parseFloat(v) || 0;
                    if (Object.is(n, -0)) return 0;
                    if (Math.abs(n) >= 900000) return 0;
                    return n;
                };
                const rowType = String(row.DOCUMENT_TYPE || row.document_type || 'factura').trim().toLowerCase() === 'albaran'
                    ? 'albaran'
                    : 'factura';
                const terminal = row.TERMINAL === null || row.TERMINAL === undefined ? null : parseInt(row.TERMINAL, 10);
                const key = rowType === 'albaran'
                    ? `ALB-${row.EJERCICIO}-${row.SERIE}-${terminal || 0}-${row.NUMERO}`
                    : `${row.SERIE}-${row.NUMERO}-${row.EJERCICIO}`;

                if (!documentMap.has(key)) {
                    documentMap.set(key, {
                        id: key,
                        documentType: rowType,
                        tipoDocumento: rowType,
                        serie: row.SERIE,
                        numero: row.NUMERO,
                        ejercicio: row.EJERCICIO,
                        terminal,
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
                    const existing = documentMap.get(key);
                    existing.total += sanitize(row.TOTAL);
                    existing.base += sanitize(row.BASE);
                    existing.iva += sanitize(row.IVA);
                }
            }

            return Array.from(documentMap.values());
        } catch (error) {
            if (error.message.includes('CWB0111') || error.message.includes('22001') || error.message.includes('parameter')) {
                logger.warn(`[facturas] Query failed (expected with many vendors), returning empty: ${error.message.substring(0, 80)}`);
            } else {
                logger.error(`Error fetching facturas: ${error.message}`);
            }
            return [];
        }
    }

    async _getAvailableYearsLegacy(vendedorCodes) {
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

    async getAvailableYears(vendedorCodes) {
        if (!vendedorCodes) {
            throw new Error('vendedorCodes is required');
        }

        const invoiceYearsSql = `
      SELECT DISTINCT EJERCICIOFACTURA as YEAR
      FROM DSEDAC.CFC
      WHERE NUMEROFACTURA > 0 AND NUMEROFACTURA < 900000
        AND @VENDOR_IN@
    `;
        const albaranYearsSql = `
      SELECT DISTINCT CAC.EJERCICIOALBARAN as YEAR
      FROM DSEDAC.CAC CAC
      WHERE CAC.NUMEROALBARAN > 0 AND CAC.NUMEROALBARAN < 900000
        AND @VENDOR_IN@
        AND NOT (CAC.NUMEROFACTURA > 0 AND CAC.NUMEROFACTURA < 900000)
    `;

        try {
            const isAll = vendedorCodes.trim().toUpperCase() === 'ALL';
            let rows;
            if (isAll) {
                const [invoiceRows, albaranRows] = await Promise.all([
                    query(invoiceYearsSql.replace('AND @VENDOR_IN@', '')),
                    query(albaranYearsSql.replace('AND @VENDOR_IN@', '')),
                ]);
                rows = [...invoiceRows, ...albaranRows];
            } else {
                const vendors = vendedorCodes.split(',').map(v => v.trim()).filter(v => v && v !== 'UNK' && /^[A-Z0-9]+$/.test(v));
                const [invoiceRows, albaranRows] = await Promise.all([
                    batchedVendorQuery(invoiceYearsSql, 'CODIGOVENDEDOR', vendors, queryWithParams),
                    batchedVendorQuery(albaranYearsSql, 'CAC.CODIGOVENDEDOR', vendors, queryWithParams),
                ]);
                rows = [...invoiceRows, ...albaranRows];
            }

            return [...new Set(rows.map(r => r.YEAR).filter(Boolean))].sort((a, b) => b - a);
        } catch (error) {
            if (error.message.includes('CWB0111') || error.message.includes('22001') || error.message.includes('parameter')) {
                logger.warn(`[facturas] Years query failed (expected with many vendors), returning empty: ${error.message.substring(0, 80)}`);
            } else {
                logger.error(`Error fetching available years: ${error.message}`);
            }
            return [];
        }
    }

    async getSummary(params) {
        const { vendedorCodes, year, month, search, clientId, clientSearch, docSearch, dateFrom, dateTo } = params;
        const documentType = normalizeDocumentType(params.documentType || params.tipoDocumento);

        if (!vendedorCodes) {
            throw new Error('vendedorCodes is required');
        }

        const cacheKey = `facturas:summary:${FACTURA_CACHE_VERSION}:${vendedorCodes || 'ALL'}:${year || ''}:${month || ''}:${dateFrom || ''}:${dateTo || ''}:${documentType}:${normalizeSearchValue(search)}:${normalizeSearchValue(clientId)}:${normalizeSearchValue(clientSearch)}:${normalizeSearchValue(docSearch)}`;
        const cached = await redisCache.get('route', cacheKey);
        if (cached !== null) return cached;

        return withInFlight(facturasSummaryInFlight, cacheKey, async () => {
            const secondCache = await redisCache.get('route', cacheKey);
            if (secondCache !== null) return secondCache;

            const result = await this._getSummaryInternal(params);
            await redisCache.set('route', cacheKey, result, TTL.MEDIUM);
            return result;
        });
    }

    async _getSummaryInternalLegacy(params) {
        const { vendedorCodes, year, month, search, clientId, clientSearch, docSearch, dateFrom, dateTo } = params;

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
        const ownershipYear = resolveOwnershipYear({ year: currentYear, dateFromInt, dateFilterApplied });

        async function runSummaryBatch(batchVendors) {
            let sql = `
      SELECT
        COUNT(DISTINCT TRIM(CFC.SERIEFACTURA) || '-' || CFC.NUMEROFACTURA) as NUM_FACTURAS,
        SUM(CFC.IMPORTETOTAL) as TOTAL,
        SUM(CFC.IMPORTEBASEIMPONIBLE) as BASE,
        SUM(CFC.IMPORTEIVA) as IVA
      FROM DSEDAC.CFC CFC
      LEFT JOIN DSEDAC.CLI CLI ON CLI.CODIGOCLIENTE = CFC.CODIGOCLIENTE
      WHERE CFC.NUMEROFACTURA > 0 AND CFC.NUMEROFACTURA < 900000
    `;
            const queryParams = [];

            if (batchVendors.length > 0) {
                sql = appendCfcVendorScopeFilter(sql, queryParams, batchVendors, ownershipYear);
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

            const clientFilter = buildInvoiceClientSearchFilter(clientSearch);
            sql += ` ${clientFilter.clause}`;
            queryParams.push(...clientFilter.params);

            const docFilter = buildInvoiceDocSearchFilter(docSearch);
            sql += ` ${docFilter.clause}`;
            queryParams.push(...docFilter.params);

            const genericFilter = buildInvoiceSearchFilter(search);
            sql += ` ${genericFilter.clause}`;
            queryParams.push(...genericFilter.params);

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

    async _getSummaryInternal(params) {
        const { vendedorCodes, year, month, search, clientId, clientSearch, docSearch, dateFrom, dateTo } = params;
        const documentType = normalizeDocumentType(params.documentType || params.tipoDocumento);
        const includeFacturas = documentType !== 'albaran';
        const includeAlbaranes = documentType !== 'factura';

        if (!vendedorCodes) {
            throw new Error('vendedorCodes is required');
        }

        const isAll = vendedorCodes.trim().toUpperCase() === 'ALL';
        const vendors = isAll ? [] : vendedorCodes.split(',').map(v => v.trim()).filter(v => v && v !== 'UNK' && /^[A-Z0-9]+$/.test(v));

        const dateFilterApplied = dateFrom && dateTo;
        const dateFromInt = dateFilterApplied ? parseInt(dateFrom.replace(/-/g, '')) : null;
        const dateToInt = dateFilterApplied ? parseInt(dateTo.replace(/-/g, '')) : null;
        const currentYear = year || new Date().getFullYear();
        const ownershipYear = resolveOwnershipYear({ year: currentYear, dateFromInt, dateFilterApplied });

        function applySummaryFilters(sql, queryParams, {
            batchVendors,
            vendorColumn,
            dateExpr,
            yearColumn,
            monthColumn,
            clientColumn,
            clientFilterBuilder,
            docFilterBuilder,
            genericFilterBuilder,
            includeOwnedEmptyVendor = false,
        }) {
            if (batchVendors.length > 0) {
                if (includeOwnedEmptyVendor) {
                    sql = appendCfcVendorScopeFilter(sql, queryParams, batchVendors, ownershipYear);
                } else {
                    const placeholders = batchVendors.map(() => '?').join(',');
                    sql += ` AND TRIM(${vendorColumn}) IN (${placeholders})`;
                    queryParams.push(...batchVendors);
                }
            }

            if (dateFilterApplied && dateFromInt && dateToInt) {
                sql += ` AND ${dateExpr} BETWEEN ? AND ?`;
                queryParams.push(dateFromInt, dateToInt);
            } else {
                sql += ` AND ${yearColumn} = ?`;
                queryParams.push(currentYear);
                if (month) {
                    sql += ` AND ${monthColumn} = ?`;
                    queryParams.push(month);
                }
            }

            if (clientId) {
                sql += ` AND TRIM(${clientColumn}) = ?`;
                queryParams.push(clientId.trim());
            }

            const clientFilter = clientFilterBuilder(clientSearch);
            sql += ` ${clientFilter.clause}`;
            queryParams.push(...clientFilter.params);

            const docFilter = docFilterBuilder(docSearch);
            sql += ` ${docFilter.clause}`;
            queryParams.push(...docFilter.params);

            const genericFilter = genericFilterBuilder(search);
            sql += ` ${genericFilter.clause}`;
            queryParams.push(...genericFilter.params);

            return sql;
        }

        async function runInvoiceSummaryBatch(batchVendors) {
            const queryParams = [];
            let sql = `
      SELECT
        'factura' as DOCUMENT_TYPE,
        COUNT(DISTINCT TRIM(CFC.SERIEFACTURA) || '-' || CFC.NUMEROFACTURA || '-' || CFC.EJERCICIOFACTURA) as NUM_DOCUMENTOS,
        SUM(CFC.IMPORTETOTAL) as TOTAL,
        SUM(CFC.IMPORTEBASEIMPONIBLE) as BASE,
        SUM(CFC.IMPORTEIVA) as IVA
      FROM DSEDAC.CFC CFC
      LEFT JOIN DSEDAC.CLI CLI ON CLI.CODIGOCLIENTE = CFC.CODIGOCLIENTE
      WHERE CFC.NUMEROFACTURA > 0 AND CFC.NUMEROFACTURA < 900000
    `;
            sql = applySummaryFilters(sql, queryParams, {
                batchVendors,
                vendorColumn: 'CFC.CODIGOVENDEDOR',
                dateExpr: '(CFC.ANODOCUMENTO * 10000 + CFC.MESDOCUMENTO * 100 + CFC.DIADOCUMENTO)',
                yearColumn: 'CFC.EJERCICIOFACTURA',
                monthColumn: 'CFC.MESDOCUMENTO',
                clientColumn: 'CFC.CODIGOCLIENTE',
                clientFilterBuilder: buildInvoiceClientSearchFilter,
                docFilterBuilder: buildInvoiceDocSearchFilter,
                genericFilterBuilder: buildInvoiceSearchFilter,
                includeOwnedEmptyVendor: true,
            });
            return queryWithParams(sql, queryParams);
        }

        async function runAlbaranSummaryBatch(batchVendors) {
            const queryParams = [];
            let sql = `
      SELECT
        'albaran' as DOCUMENT_TYPE,
        COUNT(DISTINCT CAC.EJERCICIOALBARAN || '-' || TRIM(CAC.SERIEALBARAN) || '-' || CAC.TERMINALALBARAN || '-' || CAC.NUMEROALBARAN) as NUM_DOCUMENTOS,
        SUM(CAC.IMPORTETOTAL) as TOTAL,
        SUM(COALESCE(CAC.IMPORTEBRUTO, 0)) as BASE,
        SUM(COALESCE(CAC.IMPORTEIVA1, 0) + COALESCE(CAC.IMPORTEIVA2, 0) + COALESCE(CAC.IMPORTEIVA3, 0) + COALESCE(CAC.IMPORTEIVA4, 0) + COALESCE(CAC.IMPORTEIVA5, 0)) as IVA
      FROM DSEDAC.CAC CAC
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
      WHERE CAC.NUMEROALBARAN > 0 AND CAC.NUMEROALBARAN < 900000
        AND NOT (CAC.NUMEROFACTURA > 0 AND CAC.NUMEROFACTURA < 900000)
    `;
            sql = applySummaryFilters(sql, queryParams, {
                batchVendors,
                vendorColumn: 'CAC.CODIGOVENDEDOR',
                dateExpr: '(CAC.ANODOCUMENTO * 10000 + CAC.MESDOCUMENTO * 100 + CAC.DIADOCUMENTO)',
                yearColumn: 'CAC.EJERCICIOALBARAN',
                monthColumn: 'CAC.MESDOCUMENTO',
                clientColumn: 'CAC.CODIGOCLIENTEALBARAN',
                clientFilterBuilder: buildAlbaranClientSearchFilter,
                docFilterBuilder: buildAlbaranDocSearchFilter,
                genericFilterBuilder: buildAlbaranSearchFilter,
            });
            return queryWithParams(sql, queryParams);
        }

        async function runSummaryBatch(batchVendors) {
            const queries = [];
            if (includeFacturas) queries.push(() => runInvoiceSummaryBatch(batchVendors));
            if (includeAlbaranes) queries.push(() => runAlbaranSummaryBatch(batchVendors));
            // Independent summary lookups — run concurrently.
            const results = await Promise.all(queries.map(runQuery => runQuery()));
            return results.flat();
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
                const batchResults = await mapWithConcurrency(
                    batches,
                    FACTURAS_SUMMARY_BATCH_CONCURRENCY,
                    runSummaryBatch
                );
                rows = batchResults.flat();
            }

            const stats = rows.reduce((acc, r) => {
                const count = parseInt(r.NUM_DOCUMENTOS, 10) || 0;
                const rowType = String(r.DOCUMENT_TYPE || r.document_type || '').trim().toLowerCase();
                if (rowType === 'albaran') {
                    acc.NUM_ALBARANES += count;
                } else {
                    acc.NUM_FACTURAS += count;
                }
                acc.TOTAL += parseFloat(r.TOTAL) || 0;
                acc.BASE += parseFloat(r.BASE) || 0;
                acc.IVA += parseFloat(r.IVA) || 0;
                return acc;
            }, { NUM_FACTURAS: 0, NUM_ALBARANES: 0, TOTAL: 0, BASE: 0, IVA: 0 });

            const totalDocumentos = stats.NUM_FACTURAS + stats.NUM_ALBARANES;
            return {
                totalFacturas: totalDocumentos,
                totalDocumentos,
                totalFacturasEmitidas: stats.NUM_FACTURAS,
                totalAlbaranes: stats.NUM_ALBARANES,
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
            return {
                totalFacturas: 0,
                totalDocumentos: 0,
                totalFacturasEmitidas: 0,
                totalAlbaranes: 0,
                totalImporte: 0,
                totalBase: 0,
                totalIva: 0
            };
        }
    }

    async getFacturaDetail(serie, numero, ejercicio) {
        const cacheKey = buildDocumentDetailCacheKey('factura', serie, numero, ejercicio);
        if (!cacheKey) return this._getFacturaDetailUncached(serie, numero, ejercicio);
        const cached = await redisCache.get('document', cacheKey);
        if (cached !== null) return cached;
        return withInFlight(facturaDetailInFlight, cacheKey, async () => {
            const secondCache = await redisCache.get('document', cacheKey);
            if (secondCache !== null) return secondCache;
            const result = await this._getFacturaDetailUncached(serie, numero, ejercicio);
            await redisCache.set('document', cacheKey, result, TTL.REALTIME);
            return result;
        });
    }

    async _getFacturaDetailUncached(serie, numero, ejercicio) {
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
        TRIM(CFC.CODIGOVENDEDOR) as CODIGOVENDEDORFACTURA,
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
                    vendedor: String(header.CODIGOVENDEDORFACTURA || '').trim(),
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
            if (error.message === 'Factura no encontrada') {
                logger.warn(`Factura detail not found for ${serie}-${numero}-${ejercicio}`);
            } else {
                logger.error(`Error fetching factura detail: ${error.message}`);
            }
            throw error;
        }
    }

    /**
     * BOLA scope support: for CFC invoices whose CODIGOVENDEDOR is empty, the
     * list endpoint grants visibility when the client has at least one CFC
     * invoice owned by one of the scoped vendors (appendCfcVendorScopeFilter).
     * This check mirrors that exact rule for the detail endpoints.
     * SQL is fully parameterized; caller codes are never interpolated.
     */
    async isFacturaClientOwnedByVendors(clienteId, vendorCodes, ejercicio) {
        if (!clienteId || !Array.isArray(vendorCodes) || vendorCodes.length === 0) {
            return false;
        }

        const placeholders = vendorCodes.map(() => '?').join(',');
        const ownershipSql = `
      SELECT 1 AS OK
      FROM DSEDAC.CFC OWN
      WHERE TRIM(OWN.CODIGOCLIENTE) = ?
        AND TRIM(OWN.CODIGOVENDEDOR) IN (${placeholders})
        AND OWN.NUMEROFACTURA > 0
        AND OWN.NUMEROFACTURA < 900000
        AND OWN.EJERCICIOFACTURA = ?
      FETCH FIRST 1 ROWS ONLY
    `;

        try {
            const rows = await queryWithParams(ownershipSql, [clienteId, ...vendorCodes, ejercicio]);
            return Array.isArray(rows) && rows.length > 0;
        } catch (error) {
            logger.error(`Error checking factura client ownership: ${error.message}`);
            return false;
        }
    }

    async getAlbaranDetailForPdf(serie, numero, ejercicio, terminal = null) {
        const cacheKey = buildDocumentDetailCacheKey('albaran', serie, numero, ejercicio, terminal);
        if (!cacheKey) return this._getAlbaranDetailForPdfUncached(serie, numero, ejercicio, terminal);
        const cached = await redisCache.get('document', cacheKey);
        if (cached !== null) return cached;
        return withInFlight(albaranDetailInFlight, cacheKey, async () => {
            const secondCache = await redisCache.get('document', cacheKey);
            if (secondCache !== null) return secondCache;
            const result = await this._getAlbaranDetailForPdfUncached(serie, numero, ejercicio, terminal);
            await redisCache.set('document', cacheKey, result, TTL.REALTIME);
            return result;
        });
    }

    async _getAlbaranDetailForPdfUncached(serie, numero, ejercicio, terminal = null) {
        const cleanSerie = normalizeSerieForLookup(serie);
        const cleanNumero = parseDocumentNumber(numero);
        const cleanEjercicio = parseInt(ejercicio, 10);
        const cleanTerminal = terminal === null || terminal === undefined || terminal === ''
            ? null
            : parseInt(terminal, 10);

        if (!cleanSerie || !cleanNumero || !Number.isFinite(cleanEjercicio) || cleanEjercicio <= 0) {
            throw new Error('Albaran no encontrado');
        }

        if (cleanTerminal !== null && (!Number.isFinite(cleanTerminal) || cleanTerminal < 0)) {
            throw new Error('Albaran no encontrado');
        }

        const terminalClause = cleanTerminal === null ? '' : 'AND CAC.TERMINALALBARAN = ?';
        const headerParams = [cleanNumero, cleanSerie, cleanEjercicio];
        if (cleanTerminal !== null) headerParams.push(cleanTerminal);

        const headerSql = `
      SELECT
        CAC.EJERCICIOALBARAN,
        TRIM(CAC.SERIEALBARAN) as SERIEALBARAN,
        CAC.NUMEROALBARAN,
        CAC.TERMINALALBARAN,
        CAC.NUMEROFACTURA,
        TRIM(CAC.SERIEFACTURA) as SERIEFACTURA,
        CAC.EJERCICIOFACTURA,
        CAC.DIADOCUMENTO as DIAFACTURA,
        CAC.MESDOCUMENTO as MESFACTURA,
        CAC.ANODOCUMENTO as ANOFACTURA,
        TRIM(CAC.CODIGOCLIENTEALBARAN) as CODIGOCLIENTEFACTURA,
        TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRECLIENTEFACTURA,
        TRIM(CLI.NOMBREALTERNATIVO) as NOMBRECOMERCIALFACTURA,
        TRIM(CLI.NOMBRECLIENTE) as NOMBREFISCALFACTURA,
        TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCIONCLIENTEFACTURA,
        TRIM(COALESCE(CLI.POBLACION, '')) as POBLACIONCLIENTEFACTURA,
        TRIM(COALESCE(CLI.PROVINCIA, '')) as PROVINCIACLIENTEFACTURA,
        TRIM(COALESCE(CLI.CODIGOPOSTAL, '')) as CPCLIENTEFACTURA,
        TRIM(COALESCE(CLI.NIF, '')) as CIFCLIENTEFACTURA,
        TRIM(CAC.CODIGOVENDEDOR) as CODIGOVENDEDORALBARAN,
        CAC.IMPORTETOTAL,
        COALESCE(CAC.IMPORTEBRUTO, 0) as IMPORTEBRUTO,
        CAC.IMPORTEBASEIMPONIBLE1,
        CAC.PORCENTAJEIVA1,
        CAC.IMPORTEIVA1,
        CAC.IMPORTEBASEIMPONIBLE2,
        CAC.PORCENTAJEIVA2,
        CAC.IMPORTEIVA2,
        CAC.IMPORTEBASEIMPONIBLE3,
        CAC.PORCENTAJEIVA3,
        CAC.IMPORTEIVA3,
        CAC.IMPORTEBASEIMPONIBLE4,
        CAC.PORCENTAJEIVA4,
        CAC.IMPORTEIVA4,
        CAC.IMPORTEBASEIMPONIBLE5,
        CAC.PORCENTAJEIVA5,
        CAC.IMPORTEIVA5
      FROM DSEDAC.CAC CAC
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CAC.CODIGOCLIENTEALBARAN)
      WHERE CAC.NUMEROALBARAN = ?
        AND TRIM(CAC.SERIEALBARAN) = ?
        AND CAC.EJERCICIOALBARAN = ?
        ${terminalClause}
        AND CAC.NUMEROALBARAN > 0 AND CAC.NUMEROALBARAN < 900000

      ORDER BY CAC.ANODOCUMENTO DESC, CAC.MESDOCUMENTO DESC, CAC.DIADOCUMENTO DESC, CAC.TERMINALALBARAN DESC
      FETCH FIRST 2 ROWS ONLY
    `;

        try {
            const headers = await queryWithParams(headerSql, headerParams);
            if (!headers || headers.length === 0) {
                throw new Error('Albaran no encontrado');
            }

            if (headers.length > 1) {
                logger.warn(`[facturas] Multiple albaran headers for ${cleanSerie}-${cleanNumero}-${cleanEjercicio}; using most recent terminal ${headers[0].TERMINALALBARAN}`);
            }

            const header = headers[0];
            const actualEjercicio = parseInt(header.EJERCICIOALBARAN, 10);
            const actualSerie = (header.SERIEALBARAN || cleanSerie).toString().trim();
            const actualTerminal = parseInt(header.TERMINALALBARAN, 10) || 0;
            const actualNumero = parseInt(header.NUMEROALBARAN, 10);

            const linesSql = `
        SELECT
          LAC.CODIGOARTICULO,
          LAC.DESCRIPCION as DESCRIPCIONARTICULO,
          '' as LOTEARTICULO,
          LAC.CANTIDADUNIDADES as CANTIDADARTICULO,
          LAC.CANTIDADENVASES as CAJASARTICULO,
          LAC.IMPORTEVENTA as IMPORTENETOARTICULO,
          TRIM(LAC.CODIGOIVA) as CODIGOIVA,
          0 as PORCENTAJERECARGOARTICULO,
          LAC.PORCENTAJEDESCUENTO as PORCENTAJEDESCUENTOARTICULO,
          LAC.PRECIOVENTA as PRECIOARTICULO
        FROM DSEDAC.LAC LAC
        WHERE LAC.EJERCICIOALBARAN = ?
          AND TRIM(LAC.SERIEALBARAN) = ?
          AND LAC.TERMINALALBARAN = ?
          AND LAC.NUMEROALBARAN = ?
        ORDER BY LAC.SECUENCIA
      `;

            const lines = await queryWithParams(linesSql, [actualEjercicio, actualSerie, actualTerminal, actualNumero]);
            const fecha = `${String(header.DIAFACTURA).padStart(2, '0')}/${String(header.MESFACTURA).padStart(2, '0')}/${header.ANOFACTURA}`;
            const bases = buildTaxBases(header);
            const total = parseFloat(header.IMPORTETOTAL) || 0;

            return {
                documentType: 'albaran',
                header: {
                    ...header,
                    SERIEALBARAN: actualSerie,
                    NUMEROALBARAN: actualNumero,
                    EJERCICIOALBARAN: actualEjercicio,
                    TERMINALALBARAN: actualTerminal,
                    NUMEROFACTURA: parseInt(header.NUMEROFACTURA, 10) || 0,
                    SERIEFACTURA: header.SERIEFACTURA || '',
                    EJERCICIOFACTURA: parseInt(header.EJERCICIOFACTURA, 10) || 0,
                    IVA_BREAKDOWN: buildIvaBreakdown(header),
                    serie: actualSerie,
                    numero: actualNumero,
                    ejercicio: actualEjercicio,
                    terminal: actualTerminal,
                    fecha,
                    clienteId: header.CODIGOCLIENTEFACTURA,
                    clienteNombre: header.NOMBRECLIENTEFACTURA,
                    nombreComercial: header.NOMBRECOMERCIALFACTURA || header.NOMBRECLIENTEFACTURA,
                    nombreFiscal: header.NOMBREFISCALFACTURA || header.NOMBRECLIENTEFACTURA,
                    clienteDireccion: header.DIRECCIONCLIENTEFACTURA,
                    clientePoblacion: header.POBLACIONCLIENTEFACTURA,
                    clienteNif: header.CIFCLIENTEFACTURA,
                    vendedor: String(header.CODIGOVENDEDORALBARAN || '').trim(),
                    total,
                    base: parseFloat(header.IMPORTEBRUTO) || bases.reduce((sum, b) => sum + b.base, 0),
                    iva: TAX_SLOTS.reduce((sum, slot) => sum + (parseFloat(header[`IMPORTEIVA${slot}`]) || 0), 0),
                    bases
                },
                lines: (lines || []).map(line => ({
                    ...line,
                    CODIGOARTICULO: line.CODIGOARTICULO && line.CODIGOARTICULO.trim ? line.CODIGOARTICULO.trim() : '',
                    DESCRIPCIONARTICULO: line.DESCRIPCIONARTICULO && line.DESCRIPCIONARTICULO.trim ? line.DESCRIPCIONARTICULO.trim() : '',
                    CODIGOIVA: line.CODIGOIVA && line.CODIGOIVA.trim ? line.CODIGOIVA.trim() : '',
                    CANTIDADARTICULO: parseFloat(line.CANTIDADARTICULO) || 0,
                    CAJASARTICULO: parseFloat(line.CAJASARTICULO) || 0,
                    IMPORTENETOARTICULO: parseFloat(line.IMPORTENETOARTICULO) || 0,
                    PORCENTAJEDESCUENTOARTICULO: parseFloat(line.PORCENTAJEDESCUENTOARTICULO) || 0,
                    PRECIOARTICULO: parseFloat(line.PRECIOARTICULO) || 0
                }))
            };
        } catch (error) {
            if (error.message === 'Albaran no encontrado') {
                logger.warn(`Albaran detail not found for ${cleanSerie}-${cleanNumero}-${cleanEjercicio}`);
            } else {
                logger.error(`Error fetching albaran detail: ${error.message}`);
            }
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
