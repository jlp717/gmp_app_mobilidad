/**
 * FACTURAS SERVICE (CommonJS)
 * ===========================
 * Service for invoice operations for commercial profile
 * Ported from src/services/facturas.service.ts
 */

const { query } = require('../config/db');
const logger = require('../middleware/logger');

class FacturasService {

    async getFacturas(params) {
        const { vendedorCodes, year, month, search, clientId, clientSearch, docSearch, dateFrom, dateTo } = params;

        if (!vendedorCodes) {
            throw new Error('vendedorCodes is required');
        }

        const isAll = vendedorCodes.trim().toUpperCase() === 'ALL';
        const vendorList = isAll ? null : vendedorCodes.split(',').map(v => `'${v.trim()}'`).join(',');

        let sql = `
      SELECT
        TRIM(CAC.SERIEFACTURA) as SERIE,
        CAC.NUMEROFACTURA as NUMERO,
        CAC.EJERCICIOFACTURA as EJERCICIO,
        CAC.ANOFACTURA as ANO,
        CAC.MESFACTURA as MES,
        CAC.DIAFACTURA as DIA,
        TRIM(CAC.CODIGOCLIENTEFACTURA) as CODIGO_CLIENTE,
        TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NOMBRE_CLIENTE,
        CAC.IMPORTETOTAL as TOTAL,
        CAC.IMPORTEBASEIMPONIBLE1 + CAC.IMPORTEBASEIMPONIBLE2 + CAC.IMPORTEBASEIMPONIBLE3 as BASE,
        CAC.IMPORTEIVA1 + CAC.IMPORTEIVA2 + CAC.IMPORTEIVA3 as IVA
      FROM DSEDAC.CAC CAC
      LEFT JOIN DSEDAC.CLI CLI ON CLI.CODIGOCLIENTE = CAC.CODIGOCLIENTEFACTURA
      WHERE CAC.NUMEROFACTURA > 0
    `;

        if (!isAll) {
            sql += ` AND TRIM(CAC.CODIGOVENDEDOR) IN (${vendorList})`;
        }

        // Date Filtering Logic
        let dateFilterApplied = false;

        if (dateFrom && dateTo) {
            // dateFrom/To expected as 'YYYY-MM-DD'
            const fromInt = parseInt(dateFrom.replace(/-/g, ''));
            const toInt = parseInt(dateTo.replace(/-/g, ''));
            if (!isNaN(fromInt) && !isNaN(toInt)) {
                sql += ` AND (CAC.ANOFACTURA * 10000 + CAC.MESFACTURA * 100 + CAC.DIAFACTURA) BETWEEN ${fromInt} AND ${toInt}`;
                dateFilterApplied = true;
            }
        }

        if (!dateFilterApplied) {
            const currentYear = year || new Date().getFullYear();
            sql += ` AND CAC.EJERCICIOFACTURA = ${currentYear}`;

            if (month) {
                sql += ` AND CAC.MESFACTURA = ${month}`;
            }
        }

        if (clientId) {
            sql += ` AND TRIM(CAC.CODIGOCLIENTEFACTURA) = '${clientId.trim()}'`;
        }

        // Specific Client Search
        if (clientSearch) {
            const safeClientSearch = clientSearch.toUpperCase().replace(/'/g, "''");
            sql += ` AND (UPPER(CLI.NOMBRECLIENTE) LIKE '%${safeClientSearch}%' OR UPPER(CLI.NOMBREALTERNATIVO) LIKE '%${safeClientSearch}%')`;
        }

        // Specific Doc Search (Factura/Client Code)
        if (docSearch) {
            const safeDocSearch = docSearch.toUpperCase().replace(/'/g, "''");
            const searchNum = parseFloat(docSearch);
            const isNum = !isNaN(searchNum);
            sql += ` AND (
                TRIM(CAC.SERIEFACTURA) LIKE '%${safeDocSearch}%' OR 
                TRIM(CAC.CODIGOCLIENTEFACTURA) LIKE '%${safeDocSearch}%'
                ${isNum ? `OR CAC.NUMEROFACTURA = ${searchNum}` : ''}
            )`;
        }

        // Legacy Global Search (if provided)
        if (search) {
            const safeSearch = search.toUpperCase().replace(/'/g, "''");
            const searchNum = parseFloat(search);
            const isNum = !isNaN(searchNum);
            sql += ` AND (
        UPPER(CLI.NOMBRECLIENTE) LIKE '%${safeSearch}%' OR
        UPPER(CLI.NOMBREALTERNATIVO) LIKE '%${safeSearch}%' OR
        ${isNum ? `CAC.NUMEROFACTURA = ${searchNum} OR` : ''} 
        TRIM(CAC.CODIGOCLIENTEFACTURA) LIKE '%${safeSearch}%'
      )`;
        }

        sql += ` ORDER BY CAC.ANOFACTURA DESC, CAC.MESFACTURA DESC, CAC.DIAFACTURA DESC, CAC.NUMEROFACTURA DESC`;

        try {
            const rows = await query(sql);

            // FIX: Aggregate CAC records by invoice key (SERIE-NUMERO-EJERCICIO).
            // A single invoice can span multiple albaranes (delivery notes),
            // each stored as a separate CAC row. We must SUM their totals.
            // Example: Invoice F-750 for client 4300040696 has 5 albaranes
            // totaling 581.34€, but previously only showed 218.65€ (first albarán).
            const invoiceMap = new Map();
            for (const row of rows) {
                const key = `${row.SERIE}-${row.NUMERO}-${row.EJERCICIO}`;
                if (!invoiceMap.has(key)) {
                    invoiceMap.set(key, {
                        id: key,
                        serie: row.SERIE,
                        numero: row.NUMERO,
                        ejercicio: row.EJERCICIO,
                        fecha: `${String(row.DIA).padStart(2, '0')}/${String(row.MES).padStart(2, '0')}/${row.ANO}`,
                        clienteId: row.CODIGO_CLIENTE,
                        clienteNombre: row.NOMBRE_CLIENTE || `Cliente ${row.CODIGO_CLIENTE}`,
                        total: parseFloat(row.TOTAL) || 0,
                        base: parseFloat(row.BASE) || 0,
                        iva: parseFloat(row.IVA) || 0
                    });
                } else {
                    // Same invoice, different albarán → accumulate amounts
                    const existing = invoiceMap.get(key);
                    existing.total += parseFloat(row.TOTAL) || 0;
                    existing.base += parseFloat(row.BASE) || 0;
                    existing.iva += parseFloat(row.IVA) || 0;
                }
            }

            return Array.from(invoiceMap.values());
        } catch (error) {
            logger.error(`Error fetching facturas: ${error.message}`);
            throw error;
        }
    }

    async getAvailableYears(vendedorCodes) {
        if (!vendedorCodes) {
            throw new Error('vendedorCodes is required');
        }

        const isAll = vendedorCodes.trim().toUpperCase() === 'ALL';
        const vendorList = isAll ? null : vendedorCodes.split(',').map(v => `'${v.trim()}'`).join(',');

        let sql = `
      SELECT DISTINCT EJERCICIOFACTURA as YEAR
      FROM DSEDAC.CAC
      WHERE NUMEROFACTURA > 0
    `;
        if (!isAll) {
            sql += ` AND TRIM(CODIGOVENDEDOR) IN (${vendorList})`;
        }
        sql += ` ORDER BY YEAR DESC`;

        try {
            const rows = await query(sql);
            return rows.map(r => r.YEAR);
        } catch (error) {
            logger.error(`Error fetching available years: ${error.message}`);
            throw error;
        }
    }

    async getSummary(params) {
        const { vendedorCodes, year, month, dateFrom, dateTo } = params;

        if (!vendedorCodes) {
            throw new Error('vendedorCodes is required');
        }

        const isAll = vendedorCodes.trim().toUpperCase() === 'ALL';
        const vendorList = isAll ? null : vendedorCodes.split(',').map(v => `'${v.trim()}'`).join(',');

        let sql = `
      SELECT
        COUNT(DISTINCT TRIM(SERIEFACTURA) || '-' || NUMEROFACTURA) as NUM_FACTURAS,
        SUM(IMPORTETOTAL) as TOTAL,
        SUM(IMPORTEBASEIMPONIBLE1 + IMPORTEBASEIMPONIBLE2 + IMPORTEBASEIMPONIBLE3) as BASE,
        SUM(IMPORTEIVA1 + IMPORTEIVA2 + IMPORTEIVA3) as IVA
      FROM DSEDAC.CAC
      WHERE NUMEROFACTURA > 0
    `;

        if (!isAll) {
            sql += ` AND TRIM(CODIGOVENDEDOR) IN (${vendorList})`;
        }

        // FIX #2: Support dateFrom/dateTo in summary (was missing - caused wrong totals)
        let dateFilterApplied = false;
        if (dateFrom && dateTo) {
            const fromInt = parseInt(dateFrom.replace(/-/g, ''));
            const toInt = parseInt(dateTo.replace(/-/g, ''));
            if (!isNaN(fromInt) && !isNaN(toInt)) {
                sql += ` AND (ANOFACTURA * 10000 + MESFACTURA * 100 + DIAFACTURA) BETWEEN ${fromInt} AND ${toInt}`;
                dateFilterApplied = true;
            }
        }

        if (!dateFilterApplied) {
            const currentYear = year || new Date().getFullYear();
            sql += ` AND EJERCICIOFACTURA = ${currentYear}`;

            if (month) {
                sql += ` AND MESFACTURA = ${month}`;
            }
        }

        try {
            const rows = await query(sql);
            const stats = rows[0] || {};

            return {
                totalFacturas: parseInt(stats.NUM_FACTURAS) || 0,
                totalImporte: parseFloat(stats.TOTAL) || 0,
                totalBase: parseFloat(stats.BASE) || 0,
                totalIva: parseFloat(stats.IVA) || 0
            };
        } catch (error) {
            logger.error(`Error fetching summary: ${error.message}`);
            throw error;
        }
    }

    async getFacturaDetail(serie, numero, ejercicio) {
        // FIX: Aggregate across all albaranes for same invoice.
        // A single invoice can span multiple albaranes (e.g., F-750 has 5 albaranes = 581.34€).
        // Previously used FETCH FIRST 1 ROWS ONLY which only got the first albarán (218.65€).
        const headerSql = `
      SELECT
        MIN(CAC.NUMEROFACTURA) as NUMEROFACTURA,
        MIN(CAC.SERIEFACTURA) as SERIEFACTURA,
        MIN(CAC.EJERCICIOFACTURA) as EJERCICIOFACTURA,
        MIN(CAC.DIAFACTURA) as DIAFACTURA,
        MIN(CAC.MESFACTURA) as MESFACTURA,
        MIN(CAC.ANOFACTURA) as ANOFACTURA,
        MIN(TRIM(CAC.CODIGOCLIENTEFACTURA)) as CODIGOCLIENTE,
        MIN(TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, ''))) as NOMBRECLIENTEFACTURA,
        MIN(TRIM(COALESCE(CLI.DIRECCION, ''))) as DIRECCIONCLIENTEFACTURA,
        MIN(TRIM(COALESCE(CLI.POBLACION, ''))) as POBLACIONCLIENTEFACTURA,
        MIN(TRIM(COALESCE(CLI.NIF, ''))) as CIFCLIENTEFACTURA,
        SUM(CAC.IMPORTETOTAL) as TOTALFACTURA,
        SUM(CAC.IMPORTEBASEIMPONIBLE1) as IMPORTEBASEIMPONIBLE1,
        MIN(CAC.PORCENTAJEIVA1) as PORCENTAJEIVA1,
        SUM(CAC.IMPORTEIVA1) as IMPORTEIVA1,
        SUM(CAC.IMPORTEBASEIMPONIBLE2) as IMPORTEBASEIMPONIBLE2,
        MIN(CAC.PORCENTAJEIVA2) as PORCENTAJEIVA2,
        SUM(CAC.IMPORTEIVA2) as IMPORTEIVA2,
        SUM(CAC.IMPORTEBASEIMPONIBLE3) as IMPORTEBASEIMPONIBLE3,
        MIN(CAC.PORCENTAJEIVA3) as PORCENTAJEIVA3,
        SUM(CAC.IMPORTEIVA3) as IMPORTEIVA3
      FROM DSEDAC.CAC CAC
      LEFT JOIN DSEDAC.CLI CLI ON CLI.CODIGOCLIENTE = CAC.CODIGOCLIENTEFACTURA
      WHERE TRIM(CAC.SERIEFACTURA) = '${serie}'
        AND CAC.NUMEROFACTURA = ${numero}
        AND CAC.EJERCICIOFACTURA = ${ejercicio}
      GROUP BY CAC.NUMEROFACTURA, CAC.EJERCICIOFACTURA
    `;

        try {
            const headers = await query(headerSql);

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
          LAC.PORCENTAJEDESCUENTO as DESCUENTO
        FROM DSEDAC.LAC LAC
        INNER JOIN DSEDAC.CAC CAC 
          ON LAC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
          AND LAC.SERIEALBARAN = CAC.SERIEALBARAN
          AND LAC.TERMINALALBARAN = CAC.TERMINALALBARAN
          AND LAC.NUMEROALBARAN = CAC.NUMEROALBARAN
        WHERE TRIM(CAC.SERIEFACTURA) = '${serie}'
          AND CAC.NUMEROFACTURA = ${numero}
          AND CAC.EJERCICIOFACTURA = ${ejercicio}
        ORDER BY LAC.SECUENCIA
      `;

            const lines = await query(linesSql);

            const bases = [
                { base: parseFloat(header.IMPORTEBASEIMPONIBLE1) || 0, pct: header.PORCENTAJEIVA1 || 0, iva: parseFloat(header.IMPORTEIVA1) || 0 },
                { base: parseFloat(header.IMPORTEBASEIMPONIBLE2) || 0, pct: header.PORCENTAJEIVA2 || 0, iva: parseFloat(header.IMPORTEIVA2) || 0 },
                { base: parseFloat(header.IMPORTEBASEIMPONIBLE3) || 0, pct: header.PORCENTAJEIVA3 || 0, iva: parseFloat(header.IMPORTEIVA3) || 0 }
            ].filter(b => b.base > 0);

            return {
                header: {
                    serie: header.SERIEFACTURA && header.SERIEFACTURA.trim ? header.SERIEFACTURA.trim() : serie,
                    numero: header.NUMEROFACTURA,
                    ejercicio: header.EJERCICIOFACTURA,
                    fecha: `${String(header.DIAFACTURA).padStart(2, '0')}/${String(header.MESFACTURA).padStart(2, '0')}/${header.ANOFACTURA}`,
                    clienteId: header.CODIGOCLIENTE,
                    clienteNombre: header.NOMBRECLIENTEFACTURA,
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
                    descuento: parseFloat(l.DESCUENTO) || 0
                }))
            };
        } catch (error) {
            logger.error(`Error fetching factura detail: ${error.message}`);
            throw error;
        }
    }

    generateWhatsAppMessage(serie, numero, fecha, total, clienteNombre) {
        return `🧺 *Granja Mari Pepa*\n\n` +
            `📄 Factura: *${serie}-${numero}*\n` +
            `📅 Fecha: ${fecha}\n` +
            `💰 Total: *${total.toFixed(2)} €*\n\n` +
            `Cliente: ${clienteNombre}\n\n` +
            `_Gracias por su confianza_ 🐔`;
    }
}

module.exports = new FacturasService();
