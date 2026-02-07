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
        const { vendedorCodes, year, month, search, clientId } = params;

        if (!vendedorCodes) {
            throw new Error('vendedorCodes is required');
        }

        const vendorList = vendedorCodes.split(',').map(v => `'${v.trim()}'`).join(',');
        const currentYear = year || new Date().getFullYear();

        let sql = `
      SELECT 
        TRIM(CAC.SERIEFACTURA) as SERIE,
        CAC.NUMEROFACTURA as NUMERO,
        CAC.EJERCICIOFACTURA as EJERCICIO,
        CAC.ANOFACTURA as ANO,
        CAC.MESFACTURA as MES,
        CAC.DIAFACTURA as DIA,
        TRIM(CAC.CODIGOCLIENTEFACTURA) as CODIGO_CLIENTE,
        TRIM(COALESCE(CLI.NOMBRECLIENTE, CLI.NOMBREALTERNATIVO, '')) as NOMBRE_CLIENTE,
        CAC.IMPORTETOTAL as TOTAL,
        CAC.IMPORTEBASEIMPONIBLE1 + CAC.IMPORTEBASEIMPONIBLE2 + CAC.IMPORTEBASEIMPONIBLE3 as BASE,
        CAC.IMPORTEIVA1 + CAC.IMPORTEIVA2 + CAC.IMPORTEIVA3 as IVA
      FROM DSEDAC.CAC CAC
      LEFT JOIN DSEDAC.CLI CLI ON CLI.CODIGOCLIENTE = CAC.CODIGOCLIENTEFACTURA
      WHERE CAC.EJERCICIOFACTURA = ${currentYear}
        AND CAC.NUMEROFACTURA > 0
        AND TRIM(CAC.CODIGOVENDEDOR) IN (${vendorList})
    `;

        if (month) {
            sql += ` AND CAC.MESFACTURA = ${month}`;
        }

        if (clientId) {
            sql += ` AND TRIM(CAC.CODIGOCLIENTEFACTURA) = '${clientId.trim()}'`;
        }

        if (search) {
            const safeSearch = search.toUpperCase().replace(/'/g, "''");
            sql += ` AND (
        UPPER(CLI.NOMBRECLIENTE) LIKE '%${safeSearch}%' OR
        UPPER(CLI.NOMBREALTERNATIVO) LIKE '%${safeSearch}%' OR
        CAST(CAC.NUMEROFACTURA AS CHAR(20)) LIKE '%${safeSearch}%' OR
        TRIM(CAC.CODIGOCLIENTEFACTURA) LIKE '%${safeSearch}%'
      )`;
        }

        sql += ` ORDER BY CAC.ANOFACTURA DESC, CAC.MESFACTURA DESC, CAC.DIAFACTURA DESC, CAC.NUMEROFACTURA DESC`;

        try {
            const rows = await query(sql);

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

        const vendorList = vendedorCodes.split(',').map(v => `'${v.trim()}'`).join(',');

        const sql = `
      SELECT DISTINCT EJERCICIOFACTURA as YEAR
      FROM DSEDAC.CAC
      WHERE NUMEROFACTURA > 0
        AND TRIM(CODIGOVENDEDOR) IN (${vendorList})
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

    async getSummary(params) {
        const { vendedorCodes, year, month } = params;

        if (!vendedorCodes) {
            throw new Error('vendedorCodes is required');
        }

        const vendorList = vendedorCodes.split(',').map(v => `'${v.trim()}'`).join(',');
        const currentYear = year || new Date().getFullYear();

        let sql = `
      SELECT 
        COUNT(DISTINCT TRIM(SERIEFACTURA) || '-' || NUMEROFACTURA) as NUM_FACTURAS,
        SUM(IMPORTETOTAL) as TOTAL,
        SUM(IMPORTEBASEIMPONIBLE1 + IMPORTEBASEIMPONIBLE2 + IMPORTEBASEIMPONIBLE3) as BASE,
        SUM(IMPORTEIVA1 + IMPORTEIVA2 + IMPORTEIVA3) as IVA
      FROM DSEDAC.CAC
      WHERE EJERCICIOFACTURA = ${currentYear}
        AND NUMEROFACTURA > 0
        AND TRIM(CODIGOVENDEDOR) IN (${vendorList})
    `;

        if (month) {
            sql += ` AND MESFACTURA = ${month}`;
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
        const headerSql = `
      SELECT 
        CAC.NUMEROFACTURA, CAC.SERIEFACTURA, CAC.EJERCICIOFACTURA,
        CAC.DIAFACTURA, CAC.MESFACTURA, CAC.ANOFACTURA,
        TRIM(CAC.CODIGOCLIENTEFACTURA) as CODIGOCLIENTE,
        TRIM(COALESCE(CLI.NOMBRECLIENTE, '')) as NOMBRECLIENTEFACTURA,
        TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCIONCLIENTEFACTURA,
        TRIM(COALESCE(CLI.POBLACION, '')) as POBLACIONCLIENTEFACTURA,
        TRIM(COALESCE(CLI.NIF, '')) as CIFCLIENTEFACTURA,
        CAC.IMPORTETOTAL as TOTALFACTURA,
        CAC.IMPORTEBASEIMPONIBLE1, CAC.PORCENTAJEIVA1, CAC.IMPORTEIVA1,
        CAC.IMPORTEBASEIMPONIBLE2, CAC.PORCENTAJEIVA2, CAC.IMPORTEIVA2,
        CAC.IMPORTEBASEIMPONIBLE3, CAC.PORCENTAJEIVA3, CAC.IMPORTEIVA3
      FROM DSEDAC.CAC CAC
      LEFT JOIN DSEDAC.CLI CLI ON CLI.CODIGOCLIENTE = CAC.CODIGOCLIENTEFACTURA
      WHERE TRIM(CAC.SERIEFACTURA) = '${serie}'
        AND CAC.NUMEROFACTURA = ${numero}
        AND CAC.EJERCICIOFACTURA = ${ejercicio}
      FETCH FIRST 1 ROWS ONLY
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
