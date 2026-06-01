/**
 * FACTURAS SERVICE
 * =================
 * Service for invoice operations for commercial profile
 * Ported from granja_mari_pepa web app
 *
 * SECURITY: All queries use parameterized placeholders (?) instead of
 * string concatenation. Input validation is done via validators.ts.
 */

import { odbcPool } from '../config/database';
import { logger } from '../utils/logger';
import { parseVendorCodes, sanitizeCode, sanitizeSearch, buildInClause, buildSearchClause } from '../utils/validators';
import { toFloat, toStr, formatDateDMY, clampLimit, clampOffset, currentPage, totalPages } from '../utils/db-helpers';
import { queryCache, TTL } from '../utils/query-cache';

const TAX_SLOTS = [1, 2, 3, 4, 5] as const;

function buildTaxBases(header: Record<string, unknown>): Array<{ base: number; pct: number; iva: number }> {
    return TAX_SLOTS.map(slot => ({
        base: toFloat(header[`IMPORTEBASEIMPONIBLE${slot}`]),
        pct: toFloat(header[`PORCENTAJEIVA${slot}`]),
        iva: toFloat(header[`IMPORTEIVA${slot}`])
    })).filter(base => base.base !== 0 || base.iva !== 0);
}

interface FacturaListItem {
    id: string;
    serie: string;
    numero: number;
    ejercicio: number;
    fecha: string;
    clienteId: string;
    clienteNombre: string;
    total: number;
    base: number;
    iva: number;
}

interface FacturaDetail {
    header: {
        serie: string;
        numero: number;
        ejercicio: number;
        fecha: string;
        clienteId: string;
        clienteNombre: string;
        clienteDireccion: string;
        clientePoblacion: string;
        clienteNif: string;
        total: number;
        bases: Array<{ base: number; pct: number; iva: number }>;
    };
    lines: Array<{
        codigo: string;
        descripcion: string;
        cantidad: number;
        precio: number;
        importe: number;
        descuento: number;
    }>;
}

interface FacturaSummary {
    totalFacturas: number;
    totalImporte: number;
    totalBase: number;
    totalIva: number;
}

interface GetFacturasParams {
    vendedorCodes: string;
    year?: number;
    month?: number;
    search?: string;
    clientId?: string;
    limit?: number;
    offset?: number;
}

interface PaginatedFacturas {
    facturas: FacturaListItem[];
    total: number;
    paginacion: {
        pagina: number;
        limite: number;
        totalPaginas: number;
    };
}

interface GetSummaryParams {
    vendedorCodes: string;
    year?: number;
    month?: number;
}

class FacturasService {

    async getFacturas(params: GetFacturasParams): Promise<PaginatedFacturas> {
        const limit = clampLimit(params.limit, 50, 500);
        const offset = clampOffset(params.offset);
        const cacheKey = `gmp:facturas:${params.vendedorCodes}:${params.year || ''}:${params.month || ''}:${params.search || ''}:${params.clientId || ''}:${limit}:${offset}`;
        return queryCache.getOrSet(cacheKey, () => this._fetchFacturas({ ...params, limit, offset }), TTL.SHORT);
    }

    private async _fetchFacturas(params: GetFacturasParams): Promise<PaginatedFacturas> {
        const { vendedorCodes, year, month, search, clientId } = params;
        const limit = params.limit!;
        const offset = params.offset!;

        const vendorCodes = parseVendorCodes(vendedorCodes);
        const currentYear = year || new Date().getFullYear();

        // Build parameterized query
        const conditions: string[] = [
            'CFC.EJERCICIOFACTURA = ?',
            'CFC.NUMEROFACTURA > 0',
            'CFC.NUMEROFACTURA < 900000',
        ];
        const queryParams: unknown[] = [currentYear];

        // Vendor IN clause (parameterized)
        const vendorIn = buildInClause('TRIM(CFC.CODIGOVENDEDOR)', vendorCodes);
        conditions.push(vendorIn.clause);
        queryParams.push(...vendorIn.params);

        if (month) {
            conditions.push('CFC.MESDOCUMENTO = ?');
            queryParams.push(month);
        }

        if (clientId) {
            conditions.push('TRIM(CFC.CODIGOCLIENTE) = ?');
            queryParams.push(sanitizeCode(clientId));
        }

        if (search) {
            const searchClause = buildSearchClause(
                ['UPPER(CLI.NOMBRECLIENTE)', 'UPPER(CLI.NOMBREALTERNATIVO)', 'CAST(CFC.NUMEROFACTURA AS CHAR(20))', 'TRIM(CFC.CODIGOCLIENTE)'],
                search
            );
            if (searchClause.clause) {
                conditions.push(searchClause.clause);
                queryParams.push(...searchClause.params);
            }
        }

        const whereClause = conditions.join(' AND ');

        const dataSql = `
      SELECT
        TRIM(CFC.SERIEFACTURA) as SERIE,
        CFC.NUMEROFACTURA as NUMERO,
        CFC.EJERCICIOFACTURA as EJERCICIO,
        CFC.ANODOCUMENTO as ANO,
        CFC.MESDOCUMENTO as MES,
        CFC.DIADOCUMENTO as DIA,
        TRIM(CFC.CODIGOCLIENTE) as CODIGO_CLIENTE,
        TRIM(COALESCE(CLI.NOMBRECLIENTE, CLI.NOMBREALTERNATIVO, '')) as NOMBRE_CLIENTE,
        CFC.IMPORTETOTAL as TOTAL,
        CFC.IMPORTEBASEIMPONIBLE as BASE,
        CFC.IMPORTEIVA as IVA
      FROM DSEDAC.CFC CFC
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CFC.CODIGOCLIENTE)
      WHERE ${whereClause}
      ORDER BY CFC.ANODOCUMENTO DESC, CFC.MESDOCUMENTO DESC, CFC.DIADOCUMENTO DESC, CFC.NUMEROFACTURA DESC
      OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
    `;

        const countSql = `
      SELECT COUNT(DISTINCT TRIM(CFC.SERIEFACTURA) || '-' || CFC.NUMEROFACTURA) as TOTAL
      FROM DSEDAC.CFC CFC
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CFC.CODIGOCLIENTE)
      WHERE ${whereClause}
    `;

        try {
            const [rows, countResult]: [any[], any[]] = await Promise.all([
                odbcPool.query(dataSql, [...queryParams, offset, limit]),
                odbcPool.query(countSql, queryParams),
            ]);

            const total = Number(countResult[0]?.TOTAL) || 0;

            const invoiceMap = new Map<string, FacturaListItem>();
            for (const row of rows) {
                const key = `${row.SERIE}-${row.NUMERO}-${row.EJERCICIO}`;
                if (!invoiceMap.has(key)) {
                    invoiceMap.set(key, {
                        id: key,
                        serie: row.SERIE,
                        numero: row.NUMERO,
                        ejercicio: row.EJERCICIO,
                        fecha: formatDateDMY(row.DIA, row.MES, row.ANO),
                        clienteId: row.CODIGO_CLIENTE,
                        clienteNombre: row.NOMBRE_CLIENTE || `Cliente ${row.CODIGO_CLIENTE}`,
                        total: toFloat(row.TOTAL),
                        base: toFloat(row.BASE),
                        iva: toFloat(row.IVA)
                    });
                }
            }

            const facturas = Array.from(invoiceMap.values());
            return {
                facturas,
                total,
                paginacion: {
                    pagina: currentPage(offset, limit),
                    limite: limit,
                    totalPaginas: totalPages(total, limit),
                },
            };
        } catch (error) {
            logger.error('Error fetching facturas:', error);
            throw error;
        }
    }

    async getAvailableYears(vendedorCodes: string): Promise<number[]> {
        return queryCache.getOrSet(
            `gmp:facturas:years:${vendedorCodes}`,
            () => this._fetchAvailableYears(vendedorCodes),
            TTL.LONG
        );
    }

    private async _fetchAvailableYears(vendedorCodes: string): Promise<number[]> {
        const vendorCodes = parseVendorCodes(vendedorCodes);
        const vendorIn = buildInClause('TRIM(CODIGOVENDEDOR)', vendorCodes);

        const sql = `
      SELECT DISTINCT EJERCICIOFACTURA as YEAR
      FROM DSEDAC.CFC
      WHERE NUMEROFACTURA > 0
        AND NUMEROFACTURA < 900000
        AND ${vendorIn.clause}
      ORDER BY YEAR DESC
    `;

        try {
            const rows: any[] = await odbcPool.query(sql, vendorIn.params);
            return rows.map(r => r.YEAR);
        } catch (error) {
            logger.error('Error fetching available years:', error);
            throw error;
        }
    }

    async getSummary(params: GetSummaryParams): Promise<FacturaSummary> {
        const cacheKey = `gmp:facturas:summary:${params.vendedorCodes}:${params.year || ''}:${params.month || ''}`;
        return queryCache.getOrSet(cacheKey, () => this._fetchSummary(params), TTL.SHORT);
    }

    private async _fetchSummary(params: GetSummaryParams): Promise<FacturaSummary> {
        const { vendedorCodes, year, month } = params;

        const vendorCodes = parseVendorCodes(vendedorCodes);
        const currentYear = year || new Date().getFullYear();

        const conditions: string[] = [
            'EJERCICIOFACTURA = ?',
            'NUMEROFACTURA > 0',
            'NUMEROFACTURA < 900000',
        ];
        const queryParams: unknown[] = [currentYear];

        const vendorIn = buildInClause('TRIM(CODIGOVENDEDOR)', vendorCodes);
        conditions.push(vendorIn.clause);
        queryParams.push(...vendorIn.params);

        if (month) {
            conditions.push('MESDOCUMENTO = ?');
            queryParams.push(month);
        }

        const sql = `
      SELECT
        COUNT(DISTINCT TRIM(SERIEFACTURA) || '-' || NUMEROFACTURA) as NUM_FACTURAS,
        SUM(IMPORTETOTAL) as TOTAL,
        SUM(IMPORTEBASEIMPONIBLE) as BASE,
        SUM(IMPORTEIVA) as IVA
      FROM DSEDAC.CFC
      WHERE ${conditions.join(' AND ')}
    `;

        try {
            const rows: any[] = await odbcPool.query(sql, queryParams);
            const stats: any = rows[0] || {};

            return {
                totalFacturas: toFloat(stats.NUM_FACTURAS),
                totalImporte: toFloat(stats.TOTAL),
                totalBase: toFloat(stats.BASE),
                totalIva: toFloat(stats.IVA)
            };
        } catch (error) {
            logger.error('Error fetching summary:', error);
            throw error;
        }
    }

    async getFacturaDetail(serie: string, numero: number, ejercicio: number): Promise<FacturaDetail> {
        return queryCache.getOrSet(
            `gmp:facturas:detail:${serie}:${numero}:${ejercicio}`,
            () => this._fetchFacturaDetail(serie, numero, ejercicio),
            TTL.MEDIUM
        );
    }

    private async _fetchFacturaDetail(serie: string, numero: number, ejercicio: number): Promise<FacturaDetail> {
        const headerSql = `
      SELECT
        CFC.NUMEROFACTURA, CFC.SERIEFACTURA, CFC.EJERCICIOFACTURA,
        CFC.DIADOCUMENTO as DIAFACTURA, CFC.MESDOCUMENTO as MESFACTURA, CFC.ANODOCUMENTO as ANOFACTURA,
        TRIM(CFC.CODIGOCLIENTE) as CODIGOCLIENTE,
        TRIM(COALESCE(CLI.NOMBRECLIENTE, '')) as NOMBRECLIENTEFACTURA,
        TRIM(COALESCE(CLI.DIRECCION, '')) as DIRECCIONCLIENTEFACTURA,
        TRIM(COALESCE(CLI.POBLACION, '')) as POBLACIONCLIENTEFACTURA,
        TRIM(COALESCE(CLI.NIF, '')) as CIFCLIENTEFACTURA,
        CFC.IMPORTETOTAL as TOTALFACTURA,
        CFC.IMPORTEBASEIMPONIBLE1, CFC.PORCENTAJEIVA1, CFC.IMPORTEIVA1,
        CFC.IMPORTEBASEIMPONIBLE2, CFC.PORCENTAJEIVA2, CFC.IMPORTEIVA2,
        CFC.IMPORTEBASEIMPONIBLE3, CFC.PORCENTAJEIVA3, CFC.IMPORTEIVA3,
        CFC.IMPORTEBASEIMPONIBLE4, CFC.PORCENTAJEIVA4, CFC.IMPORTEIVA4,
        CFC.IMPORTEBASEIMPONIBLE5, CFC.PORCENTAJEIVA5, CFC.IMPORTEIVA5
      FROM DSEDAC.CFC CFC
      LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CFC.CODIGOCLIENTE)
      WHERE TRIM(CFC.SERIEFACTURA) = ?
        AND CFC.NUMEROFACTURA = ?
        AND CFC.EJERCICIOFACTURA = ?
      FETCH FIRST 1 ROWS ONLY
    `;

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
        WHERE TRIM(CAC.SERIEFACTURA) = ?
          AND CAC.NUMEROFACTURA = ?
          AND CAC.EJERCICIOFACTURA = ?
        ORDER BY LAC.SECUENCIA
      `;

        try {
            // Ejecutar header + lines en paralelo
            const queryParams = [serie, numero, ejercicio];
            const [headers, lines]: [any[], any[]] = await Promise.all([
                odbcPool.query(headerSql, queryParams),
                odbcPool.query(linesSql, queryParams),
            ]);

            if (!headers || headers.length === 0) {
                throw new Error('Factura no encontrada');
            }

            const header: any = headers[0];

            const bases = buildTaxBases(header);

            return {
                header: {
                    serie: toStr(header.SERIEFACTURA) || serie,
                    numero: header.NUMEROFACTURA,
                    ejercicio: header.EJERCICIOFACTURA,
                    fecha: formatDateDMY(header.DIAFACTURA, header.MESFACTURA, header.ANOFACTURA),
                    clienteId: header.CODIGOCLIENTE,
                    clienteNombre: header.NOMBRECLIENTEFACTURA,
                    clienteDireccion: header.DIRECCIONCLIENTEFACTURA,
                    clientePoblacion: header.POBLACIONCLIENTEFACTURA,
                    clienteNif: header.CIFCLIENTEFACTURA,
                    total: toFloat(header.TOTALFACTURA),
                    bases
                },
                lines: lines.map(l => ({
                    codigo: toStr(l.CODIGOARTICULO),
                    descripcion: toStr(l.DESCRIPCIONARTICULO),
                    cantidad: toFloat(l.CANTIDAD),
                    precio: toFloat(l.PRECIO),
                    importe: toFloat(l.IMPORTE),
                    descuento: toFloat(l.DESCUENTO)
                }))
            };
        } catch (error) {
            logger.error('Error fetching factura detail:', error);
            throw error;
        }
    }

    generateWhatsAppMessage(serie: string, numero: number, fecha: string, total: number, clienteNombre: string): string {
        return `🧺 *Granja Mari Pepa*\n\n` +
            `📄 Factura: *${serie}-${numero}*\n` +
            `📅 Fecha: ${fecha}\n` +
            `💰 Total: *${total.toFixed(2)} €*\n\n` +
            `Cliente: ${clienteNombre}\n\n` +
            `_Gracias por su confianza_ 🐔`;
    }
}

export const facturasService = new FacturasService();
