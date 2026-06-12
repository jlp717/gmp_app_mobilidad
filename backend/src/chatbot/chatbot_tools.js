/**
 * NEXUS AI — Chatbot Tools (Production-Grade, All App Tabs)
 * 
 * Covers ALL data domains visible in the GMP app:
 * - Database Discovery (clients, products)
 * - Pricing & Profitability
 * - Financial Health & Risk
 * - Commercial Intelligence
 * - Logistics & Stock
 * - Commissions
 * - Objectives
 * - Invoices & Albaranes
 * - Pedidos (Orders)
 * - Cobros (Collections)
 * - Bolsa Comercial
 * - Evolution (trends)
 * - Analytics (top clients/products, YoY)
 * - Repartidor (collections, deliveries)
 * - Warehouse (dashboard, vehicles)
 * - Daily Summary
 * 
 * SECURITY: All queries use parameterized statements. Zero SQL injection risk.
 */

const logger = require('../../middleware/logger');

// ── Safe Query Helper (Parameterized) ────────────────────────────────────────

async function safeQuery(conn, sql, params = []) {
    try {
        if (params.length > 0) {
            return await conn.query(sql, params);
        }
        return await conn.query(sql);
    } catch (error) {
        logger.error(`[CHATBOT-DB] Query error: ${error.message} | SQL: ${sql.substring(0, 120)}`);
        return [];
    }
}

// ── Vendor Code Normalization ────────────────────────────────────────────────

function normalizeVendorCode(code) {
    if (!code) return '';
    const raw = String(code).trim();
    const unpadded = raw.replace(/^0+/, '') || raw;
    const padded = /^\d{1,2}$/.test(unpadded) ? unpadded.padStart(2, '0') : unpadded;
    return { raw, unpadded, padded };
}

function buildCodeVariants(code) {
    const { raw, unpadded, padded } = normalizeVendorCode(code);
    return [...new Set([raw, unpadded, padded])];
}

// ── Vendor Filter Builder (Role-Based Access) ────────────────────────────────

/**
 * Builds a SQL vendor filter clause with parameterized values.
 * 
 * Rules:
 * - vendorScope = ['ALL'] → no filter (jefe ventas)
 * - vendorScope = ['80', '03', '13', ...] → IN clause (comercial 80 special case)
 * - vendorScope = ['05'] → single vendor filter
 * 
 * Returns: { sql: string, params: array }
 * 
 * @param {string} [columnName='CODIGOVENDEDOR'] - The column name to filter on
 */
function _buildVendorFilter(vendorScope, userCode, columnName = 'CODIGOVENDEDOR') {
    if (!vendorScope || vendorScope.includes('ALL')) {
        return { sql: '', params: [] };
    }

    const col = `TRIM(${columnName})`;

    if (vendorScope.length === 1) {
        return { sql: `AND ${col} = ?`, params: [vendorScope[0]] };
    }

    const placeholders = vendorScope.map(() => '?').join(',');
    return { sql: `AND ${col} IN (${placeholders})`, params: [...vendorScope] };
}

// ============================================================================
// DATABASE DISCOVERY TOOLS
// ============================================================================

const dbDiscoveryTools = {
    async searchClients(conn, query) {
        const searchTerm = `%${query}%`;
        const rows = await safeQuery(conn, `
            SELECT TRIM(CODIGOCLIENTE) as CODIGO, TRIM(NOMBRECLIENTE) as NOMBRE,
                   TRIM(POBLACION) as POBLACION, TRIM(PROVINCIA) as PROVINCIA
            FROM DSEDAC.CLI
            WHERE TRIM(NOMBRECLIENTE) LIKE ? OR TRIM(CODIGOCLIENTE) LIKE ?
            ORDER BY NOMBRECLIENTE
            FETCH FIRST 20 ROWS ONLY
        `, [searchTerm, searchTerm]);
        return rows.map(r => ({
            CODIGO: r.CODIGO,
            NOMBRE: r.NOMBRE,
            POBLACION: r.POBLACION
        }));
    },

    async searchProducts(conn, query) {
        const searchTerm = `%${query}%`;
        const rows = await safeQuery(conn, `
            SELECT TRIM(CODIGOARTICULO) as CODIGO, TRIM(DESCRIPCIONARTICULO) as NOMBRE,
                   TRIM(FAMILIA) as FAMILIA
            FROM DSEDAC.ART
            WHERE TRIM(DESCRIPCIONARTICULO) LIKE ? OR TRIM(CODIGOARTICULO) LIKE ?
            ORDER BY DESCRIPCIONARTICULO
            FETCH FIRST 20 ROWS ONLY
        `, [searchTerm, searchTerm]);
        return rows.map(r => ({
            CODIGO: r.CODIGO,
            NOMBRE: r.NOMBRE,
            FAMILIA: r.FAMILIA
        }));
    },

    async lookupClient(conn, clientCode) {
        const rows = await safeQuery(conn, `
            SELECT TRIM(CODIGOCLIENTE) as CODIGO, TRIM(NOMBRECLIENTE) as NOMBRE,
                   TRIM(DIRECCION) as DIRECCION, TRIM(POBLACION) as POBLACION,
                   TRIM(PROVINCIA) as PROVINCIA, TRIM(TARIFA) as TARIFA,
                   TRIM(CODIGOVENDEDOR) as VENDEDOR
            FROM DSEDAC.CLI
            WHERE TRIM(CODIGOCLIENTE) = ?
            FETCH FIRST 1 ROWS ONLY
        `, [clientCode]);
        if (rows.length === 0) return null;
        const r = rows[0];
        return {
            CODIGO: r.CODIGO, NOMBRE: r.NOMBRE, DIRECCION: r.DIRECCION,
            POBLACION: r.POBLACION, PROVINCIA: r.PROVINCIA,
            TARIFA: r.TARIFA, VENDEDOR: r.VENDEDOR
        };
    },

    async lookupProduct(conn, productCode) {
        const rows = await safeQuery(conn, `
            SELECT TRIM(CODIGOARTICULO) as CODIGO, TRIM(DESCRIPCIONARTICULO) as NOMBRE,
                   TRIM(FAMILIA) as FAMILIA, PRECIOVENTA as PRECIO
            FROM DSEDAC.ART
            WHERE TRIM(CODIGOARTICULO) = ?
            FETCH FIRST 1 ROWS ONLY
        `, [productCode]);
        if (rows.length === 0) return null;
        const r = rows[0];
        return {
            CODIGO: r.CODIGO, NOMBRE: r.NOMBRE, FAMILIA: r.FAMILIA,
            PRECIO: parseFloat(r.PRECIO) || 0
        };
    }
};

// ============================================================================
// PRICING & PROFITABILITY TOOLS
// ============================================================================

const pricingTools = {
    async getProductPrice(conn, productCode) {
        const tariff = await safeQuery(conn, `
            SELECT A.CODIGOARTICULO, A.DESCRIPCIONARTICULO, A.PRECIOVENTA,
                   COALESCE((
                       SELECT L.PRECIOCOSTO FROM DSEDAC.LAC L
                       WHERE TRIM(L.CODIGOARTICULO) = TRIM(A.CODIGOARTICULO)
                         AND L.PRECIOCOSTO > 0
                       ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC
                       FETCH FIRST 1 ROW ONLY
                   ), 0) AS PRECIOCOSTO
            FROM DSEDAC.ART A
            WHERE TRIM(A.CODIGOARTICULO) = ?
            FETCH FIRST 1 ROWS ONLY
        `, [productCode]);

        const lastSale = await safeQuery(conn, `
            SELECT PRECIOVENTAUNITARIO, TRIM(CODIGOCLIENTEALBARAN) as CLIENTE,
                   ANODOCUMENTO, MESDOCUMENTO
            FROM DSEDAC.LAC
            WHERE TRIM(CODIGOARTICULO) = ?
            ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
            FETCH FIRST 1 ROWS ONLY
        `, [productCode]);

        return {
            product: tariff[0] || {},
            tariffPrice: parseFloat(tariff[0]?.PRECIOVENTA) || 0,
            cost: parseFloat(tariff[0]?.PRECIOCOSTO) || 0,
            lastSoldPrice: parseFloat(lastSale[0]?.PRECIOVENTAUNITARIO) || 0,
            lastSoldTo: lastSale[0]?.CLIENTE
        };
    },

    async calculateBreakeven(conn, productCode) {
        const art = await safeQuery(conn, `
            SELECT A.PRECIOVENTA,
                   COALESCE((
                       SELECT L.PRECIOCOSTO FROM DSEDAC.LAC L
                       WHERE TRIM(L.CODIGOARTICULO) = TRIM(A.CODIGOARTICULO)
                         AND L.PRECIOCOSTO > 0
                       ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC
                       FETCH FIRST 1 ROW ONLY
                   ), 0) AS PRECIOCOSTO
            FROM DSEDAC.ART A
            WHERE TRIM(A.CODIGOARTICULO) = ?
            FETCH FIRST 1 ROWS ONLY
        `, [productCode]);

        if (!art[0]) return { error: 'Producto no encontrado' };

        const cost = parseFloat(art[0].PRECIOCOSTO) || 0;
        const tariff = parseFloat(art[0].PRECIOVENTA) || 0;
        const minMargin = 0.05;
        const floorPrice = cost * (1 + minMargin);

        return {
            productCode,
            cost,
            tariffPrice: tariff,
            floorPrice: Math.round(floorPrice * 100) / 100,
            minMarginPercent: minMargin * 100,
            currentMarginPercent: tariff > 0 ? ((tariff - cost) / tariff) * 100 : 0
        };
    },

    async simulateDiscount(conn, productCode, discountPercent) {
        const art = await safeQuery(conn, `
            SELECT A.PRECIOVENTA,
                   COALESCE((
                       SELECT L.PRECIOCOSTO FROM DSEDAC.LAC L
                       WHERE TRIM(L.CODIGOARTICULO) = TRIM(A.CODIGOARTICULO)
                         AND L.PRECIOCOSTO > 0
                       ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC
                       FETCH FIRST 1 ROW ONLY
                   ), 0) AS PRECIOCOSTO
            FROM DSEDAC.ART A
            WHERE TRIM(A.CODIGOARTICULO) = ?
            FETCH FIRST 1 ROWS ONLY
        `, [productCode]);

        if (!art[0]) return { error: 'Producto no encontrado' };

        const cost = parseFloat(art[0].PRECIOCOSTO) || 0;
        const tariff = parseFloat(art[0].PRECIOVENTA) || 0;
        const discount = parseFloat(discountPercent) / 100;
        const newPrice = tariff * (1 - discount);
        const oldMargin = tariff - cost;
        const newMargin = newPrice - cost;

        return {
            productCode,
            originalPrice: tariff,
            discountPercent,
            newPrice: Math.round(newPrice * 100) / 100,
            originalMargin: Math.round(oldMargin * 100) / 100,
            newMargin: Math.round(newMargin * 100) / 100,
            marginLoss: Math.round((oldMargin - newMargin) * 100) / 100,
            extraVolumeNeededMultiplier: newMargin !== 0 ? Math.round((oldMargin / newMargin) * 100) / 100 : 0,
            profitable: newMargin > 0
        };
    }
};

// ============================================================================
// FINANCIAL HEALTH & RISK TOOLS
// ============================================================================

const riskTools = {
    async getClientDebt(conn, clientCode) {
        const debt = await safeQuery(conn, `
            SELECT 
                SUM(CASE WHEN IMPORTEPENDIENTE > 0 THEN IMPORTEPENDIENTE ELSE 0 END) as TOTAL_DEBT,
                SUM(CASE WHEN FECHAVENCIMIENTO < CURRENT DATE THEN IMPORTEPENDIENTE ELSE 0 END) as OVERDUE,
                COUNT(*) as NUM_INVOICES
            FROM DSEDAC.CVC
            WHERE TRIM(CODIGOCLIENTEALBARAN) = ? AND IMPORTEPENDIENTE > 0
        `, [clientCode]);

        const aging = await safeQuery(conn, `
            SELECT 
                SUM(CASE WHEN DAYS(CURRENT DATE) - DAYS(FECHAVENCIMIENTO) BETWEEN 1 AND 30 THEN IMPORTEPENDIENTE ELSE 0 END) as DAYS_30,
                SUM(CASE WHEN DAYS(CURRENT DATE) - DAYS(FECHAVENCIMIENTO) BETWEEN 31 AND 60 THEN IMPORTEPENDIENTE ELSE 0 END) as DAYS_60,
                SUM(CASE WHEN DAYS(CURRENT DATE) - DAYS(FECHAVENCIMIENTO) BETWEEN 61 AND 90 THEN IMPORTEPENDIENTE ELSE 0 END) as DAYS_90,
                SUM(CASE WHEN DAYS(CURRENT DATE) - DAYS(FECHAVENCIMIENTO) > 90 THEN IMPORTEPENDIENTE ELSE 0 END) as DAYS_OVER_90
            FROM DSEDAC.CVC
            WHERE TRIM(CODIGOCLIENTEALBARAN) = ? AND IMPORTEPENDIENTE > 0
        `, [clientCode]);

        const d = debt[0] || {};
        const a = aging[0] || {};

        return {
            clientCode,
            totalDebt: parseFloat(d.TOTAL_DEBT) || 0,
            overdueDebt: parseFloat(d.OVERDUE) || 0,
            numInvoices: parseInt(d.NUM_INVOICES) || 0,
            aging: {
                days_1_30: parseFloat(a.DAYS_30) || 0,
                days_31_60: parseFloat(a.DAYS_60) || 0,
                days_61_90: parseFloat(a.DAYS_90) || 0,
                days_over_90: parseFloat(a.DAYS_OVER_90) || 0
            },
            riskLevel: (parseFloat(d.OVERDUE) || 0) > 5000 ? 'ALTO' : (parseFloat(d.OVERDUE) || 0) > 1000 ? 'MEDIO' : 'BAJO'
        };
    },

    async getClientCreditLimit(conn, clientCode) {
        const client = await safeQuery(conn, `
            SELECT LIMITECREDITO, RIESGOACUMULADO
            FROM DSEDAC.CLI WHERE TRIM(CODIGOCLIENTE) = ?
            FETCH FIRST 1 ROWS ONLY
        `, [clientCode]);

        const c = client[0] || {};
        const limit = parseFloat(c.LIMITECREDITO) || 0;
        const used = parseFloat(c.RIESGOACUMULADO) || 0;

        return {
            clientCode,
            creditLimit: limit,
            usedCredit: used,
            availableCredit: limit - used,
            utilizationPercent: limit > 0 ? (used / limit) * 100 : 0
        };
    },

    async checkClientBlocked(conn, clientCode) {
        const client = await safeQuery(conn, `
            SELECT CLIENTEBLOQUEADO, MOTIVOBLOQUEO
            FROM DSEDAC.CLI WHERE TRIM(CODIGOCLIENTE) = ?
            FETCH FIRST 1 ROWS ONLY
        `, [clientCode]);

        const c = client[0] || {};
        return {
            clientCode,
            isBlocked: c.CLIENTEBLOQUEADO === 'S',
            blockReason: c.MOTIVOBLOQUEO?.trim() || 'Sin razon especificada'
        };
    },

    async calculateRiskScore(conn, clientCode) {
        const debt = await this.getClientDebt(conn, clientCode);
        const credit = await this.getClientCreditLimit(conn, clientCode);
        const blocked = await this.checkClientBlocked(conn, clientCode);

        let score = 100;
        const alerts = [];

        if (blocked.isBlocked) { score -= 50; alerts.push('Cliente BLOQUEADO'); }
        if (debt.overdueDebt > 5000) { score -= 30; alerts.push('Deuda vencida > 5000€'); }
        else if (debt.overdueDebt > 1000) { score -= 15; alerts.push('Deuda vencida > 1000€'); }
        if (credit.utilizationPercent > 90) { score -= 20; alerts.push('Credito utilizado > 90%'); }
        if (debt.aging.days_over_90 > 0) { score -= 25; alerts.push('Deuda > 90 dias'); }

        return {
            clientCode,
            riskScore: Math.max(0, score),
            riskLevel: score >= 70 ? 'BAJO' : score >= 40 ? 'MEDIO' : 'ALTO',
            alerts,
            recommendation: score < 40 ? 'NO vender sin cobrar primero' :
                score < 70 ? 'Pedir pago parcial antes de servir' :
                    'Cliente en buen estado'
        };
    }
};

// ============================================================================
// COMMERCIAL INTELLIGENCE TOOLS
// ============================================================================

const commercialTools = {
    async detectChurn(conn, clientCode, months = 6) {
        const oldProducts = await safeQuery(conn, `
            SELECT DISTINCT L.CODIGOARTICULO, A.DESCRIPCIONARTICULO
            FROM DSEDAC.LAC L
            LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
            WHERE TRIM(L.CODIGOCLIENTEALBARAN) = ?
              AND L.ANODOCUMENTO = YEAR(CURRENT DATE) - 1
              AND L.CODIGOARTICULO NOT IN (
                SELECT DISTINCT CODIGOARTICULO FROM DSEDAC.LAC
                WHERE TRIM(CODIGOCLIENTEALBARAN) = ?
                  AND (ANODOCUMENTO = YEAR(CURRENT DATE) 
                    OR (ANODOCUMENTO = YEAR(CURRENT DATE) - 1 AND MESDOCUMENTO > MONTH(CURRENT DATE) - ?))
              )
            FETCH FIRST 20 ROWS ONLY
        `, [clientCode, clientCode, months]);

        return {
            clientCode,
            churnedProducts: oldProducts.map(p => ({
                code: p.CODIGOARTICULO?.trim(),
                description: p.DESCRIPCIONARTICULO?.trim()
            })),
            count: oldProducts.length,
            actionSuggestion: oldProducts.length > 0 ?
                'Ofrece estos productos con descuento para recuperar la venta' :
                'No hay churn detectado'
        };
    },

    async compareClientYoY(conn, clientCode) {
        const currentYear = new Date().getFullYear();
        const years = [currentYear, currentYear - 1, currentYear - 2];
        const results = {};

        for (const year of years) {
            const data = await safeQuery(conn, `
                SELECT SUM(IMPORTEVENTA) as SALES, SUM(CANTIDADENVASES) as BOXES
                FROM DSEDAC.LAC
                WHERE TRIM(CODIGOCLIENTEALBARAN) = ? AND ANODOCUMENTO = ?
            `, [clientCode, year]);
            results[year] = { sales: parseFloat(data[0]?.SALES) || 0, boxes: parseFloat(data[0]?.BOXES) || 0 };
        }

        return { clientCode, yearlyData: results };
    },

    async getClientPurchaseHistory(conn, clientCode, limit = 20) {
        const history = await safeQuery(conn, `
            SELECT ANODOCUMENTO, MESDOCUMENTO, DIADOCUMENTO, 
                   TRIM(CODIGOARTICULO) as CODIGOARTICULO, DESCRIPCIONARTICULO,
                   CANTIDADENVASES, IMPORTEVENTA, PRECIOVENTAUNITARIO
            FROM DSEDAC.LAC
            WHERE TRIM(CODIGOCLIENTEALBARAN) = ?
            ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
            FETCH FIRST ? ROWS ONLY
        `, [clientCode, limit]);

        return {
            clientCode,
            purchases: history.map(h => ({
                date: `${h.ANODOCUMENTO}-${String(h.MESDOCUMENTO).padStart(2, '0')}-${String(h.DIADOCUMENTO).padStart(2, '0')}`,
                product: h.CODIGOARTICULO,
                description: h.DESCRIPCIONARTICULO?.trim(),
                quantity: h.CANTIDADENVASES,
                amount: parseFloat(h.IMPORTEVENTA) || 0,
                unitPrice: parseFloat(h.PRECIOVENTAUNITARIO) || 0
            }))
        };
    },

    async getMarginGlobal(conn, userCode, isJefeVentas, month, year, vendorScope) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;
        const vendorFilter = _buildVendorFilter(vendorScope, userCode);

        const sql = `
            SELECT 
                SUM(IMPORTEVENTA) as VENTAS,
                SUM(IMPORTECOSTE) as COSTE,
                COUNT(DISTINCT CODIGOCLIENTEALBARAN) as CLIENTES,
                COUNT(*) as OPERACIONES
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ?
              ${vendorFilter.sql}
        `;
        const params = [currentYear, currentMonth, ...vendorFilter.params];

        const result = await safeQuery(conn, sql, params);
        const ventas = parseFloat(result[0]?.VENTAS) || 0;
        const coste = parseFloat(result[0]?.COSTE) || 0;
        const clientes = parseInt(result[0]?.CLIENTES) || 0;
        const operations = parseInt(result[0]?.OPERACIONES) || 0;
        const marginPct = ventas > 0 ? ((ventas - coste) / ventas * 100) : 0;

        return {
            month: currentMonth,
            year: currentYear,
            sales: ventas,
            cost: coste,
            profit: ventas - coste,
            marginPercent: Math.round(marginPct * 10) / 10,
            clients: clientes,
            operations: operations
        };
    },

    async getMarginByClient(conn, clientCode, userCode, isJefeVentas, vendorScope) {
        const currentYear = new Date().getFullYear();
        const vendorFilter = _buildVendorFilter(vendorScope, userCode);

        const sql = `
            SELECT SUM(IMPORTEVENTA) as VENTAS, SUM(IMPORTECOSTE) as COSTE, COUNT(*) as OPERACIONES
            FROM DSEDAC.LAC
            WHERE TRIM(CODIGOCLIENTEALBARAN) = ? AND ANODOCUMENTO = ?
              ${vendorFilter.sql}
        `;
        const params = [clientCode, currentYear, ...vendorFilter.params];

        const result = await safeQuery(conn, sql, params);
        const ventas = parseFloat(result[0]?.VENTAS) || 0;
        const coste = parseFloat(result[0]?.COSTE) || 0;
        const ops = parseInt(result[0]?.OPERACIONES) || 0;
        const marginPct = ventas > 0 ? ((ventas - coste) / ventas * 100) : 0;

        return {
            clientCode,
            sales: ventas,
            cost: coste,
            profit: ventas - coste,
            marginPercent: Math.round(marginPct * 10) / 10,
            operations: ops
        };
    }
};

// ============================================================================
// LOGISTICS TOOLS
// ============================================================================

const logisticsTools = {
    async getStockByWarehouse(conn, productCode) {
        const stock = await safeQuery(conn, `
            SELECT TRIM(CODIGOALMACEN) as CODIGOALMACEN, EXISTENCIAS
            FROM DSEDAC.ARTALM
            WHERE TRIM(CODIGOARTICULO) = ?
        `, [productCode]);

        return {
            productCode,
            warehouses: stock.map(s => ({
                warehouse: s.CODIGOALMACEN,
                stock: parseInt(s.EXISTENCIAS) || 0
            })),
            totalStock: stock.reduce((sum, s) => sum + (parseInt(s.EXISTENCIAS) || 0), 0)
        };
    }
};

// ============================================================================
// COMMISSION TOOLS
// ============================================================================

const commissionTools = {
    async getCommissions(conn, userCode, isJefeVentas, month, year, vendorScope) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;

        // Build vendor filter based on scope
        const vendorFilter = _buildVendorFilter(vendorScope, userCode);

        // Try snapshot table first (2026 data)
        const snapshotRows = await safeQuery(conn, `
            SELECT VENTAS_REAL, OBJETIVO_MES, COMISION_GENERADA
            FROM JAVIER.COMMISSION_SNAPSHOT_2026_0102
            WHERE ANIO = ? AND MES = ? AND TRIM(VENDEDOR_CODIGO) = ?
        `, [currentYear, currentMonth, userCode]);

        if (snapshotRows.length > 0) {
            const r = snapshotRows[0];
            const sales = parseFloat(r.VENTAS_REAL) || 0;
            const commission = parseFloat(r.COMISION_GENERADA) || 0;
            const commissionPercent = sales > 0 ? (commission / sales * 100) : 0;

            const clientRows = await safeQuery(conn, `
                SELECT COUNT(DISTINCT TRIM(CODIGOCLIENTEALBARAN)) as CLIENTES
                FROM DSEDAC.LAC
                WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ?
                  ${vendorFilter.sql}
            `, [currentYear, currentMonth, ...vendorFilter.params]);

            const opsRows = await safeQuery(conn, `
                SELECT COUNT(*) as OPS
                FROM DSEDAC.LAC
                WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ?
                  ${vendorFilter.sql}
            `, [currentYear, currentMonth, ...vendorFilter.params]);

            return {
                month: currentMonth,
                year: currentYear,
                sales: sales,
                commission: commission,
                commissionPercent: Math.round(commissionPercent * 100) / 100,
                activeClients: parseInt(clientRows[0]?.CLIENTES) || 0,
                operations: parseInt(opsRows[0]?.OPS) || 0
            };
        }

        // Fallback: calculate from LAC table
        const salesRows = await safeQuery(conn, `
            SELECT SUM(IMPORTEVENTA) as VENTAS, COUNT(DISTINCT CODIGOCLIENTEALBARAN) as CLIENTES, COUNT(*) as OPS
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ?
              ${vendorFilter.sql}
        `, [currentYear, currentMonth, ...vendorFilter.params]);

        const ventas = parseFloat(salesRows[0]?.VENTAS) || 0;
        const targetPercent = 10;
        const commission = ventas * (targetPercent / 100);

        return {
            month: currentMonth,
            year: currentYear,
            sales: ventas,
            commission: Math.round(commission * 100) / 100,
            commissionPercent: targetPercent,
            activeClients: parseInt(salesRows[0]?.CLIENTES) || 0,
            operations: parseInt(salesRows[0]?.OPS) || 0
        };
    },

    async getCommissionDetails(conn, userCode, isJefeVentas, clientCode, month, year, vendorScope) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;
        const vendorFilter = _buildVendorFilter(vendorScope, userCode);

        let sql, params;
        if (clientCode) {
            sql = `
                SELECT TRIM(CODIGOCLIENTEALBARAN) as CLIENTE, SUM(IMPORTEVENTA) as VENTAS
                FROM DSEDAC.LAC
                WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ?
                  ${vendorFilter.sql}
                  AND TRIM(CODIGOCLIENTEALBARAN) = ?
                GROUP BY CODIGOCLIENTEALBARAN
                ORDER BY VENTAS DESC
            `;
            params = [currentYear, currentMonth, ...vendorFilter.params, clientCode];
        } else {
            sql = `
                SELECT TRIM(CODIGOCLIENTEALBARAN) as CLIENTE, SUM(IMPORTEVENTA) as VENTAS
                FROM DSEDAC.LAC
                WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ?
                  ${vendorFilter.sql}
                GROUP BY CODIGOCLIENTEALBARAN
                ORDER BY VENTAS DESC
                FETCH FIRST 50 ROWS ONLY
            `;
            params = [currentYear, currentMonth, ...vendorFilter.params];
        }

        const rows = await safeQuery(conn, sql, params);
        const details = rows.map(r => ({
            clientCode: r.CLIENTE,
            sales: parseFloat(r.VENTAS) || 0,
            commission: Math.round((parseFloat(r.VENTAS) || 0) * 0.10 * 100) / 100
        }));

        const totalSales = details.reduce((sum, d) => sum + d.sales, 0);
        const totalCommission = totalSales * 0.10;

        return {
            month: currentMonth,
            year: currentYear,
            totalSales,
            totalCommission: Math.round(totalCommission * 100) / 100,
            details
        };
    },

    async getCommissionConfig(conn) {
        const configRows = await safeQuery(conn, `
            SELECT IPC_PCT, TIER1_MAX, TIER1_PCT, TIER2_MAX, TIER2_PCT,
                   TIER3_MAX, TIER3_PCT, TIER4_PCT
            FROM JAVIER.COMM_CONFIG
            WHERE YEAR = YEAR(CURRENT DATE)
            FETCH FIRST 1 ROWS ONLY
        `);

        if (configRows.length === 0) {
            return {
                ipc: 3.0,
                tiers: [
                    { min: 100.01, max: 103.00, pct: 1.0 },
                    { min: 103.01, max: 106.00, pct: 1.3 },
                    { min: 106.01, max: 110.00, pct: 1.6 },
                    { min: 110.01, max: 999.99, pct: 2.0 }
                ]
            };
        }

        const c = configRows[0];
        return {
            ipc: parseFloat(c.IPC_PCT) || 3.0,
            tiers: [
                { min: 100.01, max: parseFloat(c.TIER1_MAX) || 103.00, pct: parseFloat(c.TIER1_PCT) || 1.0 },
                { min: (parseFloat(c.TIER1_MAX) || 103.00) + 0.01, max: parseFloat(c.TIER2_MAX) || 106.00, pct: parseFloat(c.TIER2_PCT) || 1.3 },
                { min: (parseFloat(c.TIER2_MAX) || 106.00) + 0.01, max: parseFloat(c.TIER3_MAX) || 110.00, pct: parseFloat(c.TIER3_PCT) || 1.6 },
                { min: (parseFloat(c.TIER3_MAX) || 110.00) + 0.01, max: 999.99, pct: parseFloat(c.TIER4_PCT) || 2.0 }
            ]
        };
    }
};

// ============================================================================
// OBJECTIVES TOOLS
// ============================================================================

const objectivesTools = {
    async getObjectives(conn, userCode, isJefeVentas, month, year, vendorScope) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;
        const vendorFilter = _buildVendorFilter(vendorScope, userCode);

        const configRows = await safeQuery(conn, `
            SELECT TARGET_PERCENTAGE
            FROM JAVIER.OBJ_CONFIG
            WHERE TRIM(CODIGOVENDEDOR) = ? AND CODIGOCLIENTE = '*'
            FETCH FIRST 1 ROWS ONLY
        `, [userCode]);

        const targetPercent = configRows.length > 0 ? parseFloat(configRows[0].TARGET_PERCENTAGE) || 10 : 10;

        const salesRows = await safeQuery(conn, `
            SELECT SUM(IMPORTEVENTA) as VENTAS
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ?
              ${vendorFilter.sql}
        `, [currentYear, currentMonth, ...vendorFilter.params]);

        const achieved = parseFloat(salesRows[0]?.VENTAS) || 0;
        const prevSalesRows = await safeQuery(conn, `
            SELECT SUM(IMPORTEVENTA) as VENTAS
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ?
              ${vendorFilter.sql}
        `, [currentYear - 1, currentMonth, ...vendorFilter.params]);

        const prevSales = parseFloat(prevSalesRows[0]?.VENTAS) || 0;
        const target = prevSales > 0 ? prevSales * (1 + targetPercent / 100) : achieved * 1.1;
        const achievementPct = target > 0 ? Math.round((achieved / target) * 1000) / 10 : 0;

        return {
            month: currentMonth,
            year: currentYear,
            target: Math.round(target * 100) / 100,
            achieved: achieved,
            achievementPercent: achievementPct,
            remaining: Math.round((target - achieved) * 100) / 100
        };
    },

    async getObjectivesByFamily(conn, userCode, isJefeVentas, familyCode, month, year, vendorScope) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;
        const vendorFilter = _buildVendorFilter(vendorScope, userCode);

        let sql, params;
        if (familyCode) {
            sql = `
                SELECT TRIM(A.FAMILIA) as FAMILIA, SUM(L.IMPORTEVENTA) as VENTAS
                FROM DSEDAC.LAC L
                LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
                WHERE L.ANODOCUMENTO = ? AND L.MESDOCUMENTO = ?
                  ${vendorFilter.sql}
                  AND TRIM(A.FAMILIA) = ?
                GROUP BY A.FAMILIA
            `;
            params = [currentYear, currentMonth, ...vendorFilter.params, familyCode];
        } else {
            sql = `
                SELECT TRIM(A.FAMILIA) as FAMILIA, SUM(L.IMPORTEVENTA) as VENTAS
                FROM DSEDAC.LAC L
                LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
                WHERE L.ANODOCUMENTO = ? AND L.MESDOCUMENTO = ?
                  ${vendorFilter.sql}
                GROUP BY A.FAMILIA
                ORDER BY VENTAS DESC
            `;
            params = [currentYear, currentMonth, ...vendorFilter.params];
        }

        const rows = await safeQuery(conn, sql, params);
        const families = rows.map(r => ({
            family: r.FAMILIA || 'Sin familia',
            achieved: parseFloat(r.VENTAS) || 0,
            target: Math.round((parseFloat(r.VENTAS) || 0) * 1.1 * 100) / 100,
            achievementPercent: 0
        }));

        families.forEach(f => {
            if (f.target > 0) {
                f.achievementPercent = Math.round((f.achieved / f.target) * 1000) / 10;
            }
        });

        return { month: currentMonth, year: currentYear, families };
    }
};

// ============================================================================
// INVOICE & ALBARAN TOOLS
// ============================================================================

const invoiceTools = {
    async getInvoiceDetails(conn, invoiceNumber) {
        const rows = await safeQuery(conn, `
            SELECT TRIM(NUMERODOCUMENTO) as NUMERO, TRIM(CODIGOCLIENTEALBARAN) as CLIENTE,
                   IMPORTETOTAL as IMPORTE, ESTADO, FECHAEMISION
            FROM DSEDAC.CVC
            WHERE TRIM(NUMERODOCUMENTO) = ?
            FETCH FIRST 1 ROWS ONLY
        `, [invoiceNumber]);

        if (rows.length === 0) {
            return { error: `Factura ${invoiceNumber} no encontrada` };
        }

        const r = rows[0];
        const albaranCount = await safeQuery(conn, `
            SELECT COUNT(*) as CNT
            FROM DSEDAC.CVC
            WHERE TRIM(NUMERODOCUMENTO) = ?
        `, [invoiceNumber]);

        return {
            invoiceNumber: r.NUMERO,
            clientCode: r.CLIENTE,
            amount: parseFloat(r.IMPORTE) || 0,
            status: r.ESTADO?.trim() || 'Desconocido',
            date: r.FECHAEMISION ? String(r.FECHAEMISION) : null,
            albaranCount: parseInt(albaranCount[0]?.CNT) || 0
        };
    },

    async getAlbaranesByInvoice(conn, invoiceNumber) {
        const rows = await safeQuery(conn, `
            SELECT TRIM(NUMEROALBARAN) as NUMERO, IMPORTEPENDIENTE as IMPORTE,
                   FECHAEMISION as FECHA
            FROM DSEDAC.CVC
            WHERE TRIM(NUMERODOCUMENTO) = ?
            ORDER BY FECHAEMISION DESC
        `, [invoiceNumber]);

        return {
            invoiceNumber,
            albaranes: rows.map(r => ({
                number: r.NUMERO,
                amount: parseFloat(r.IMPORTE) || 0,
                date: r.FECHA ? String(r.FECHA) : null
            }))
        };
    },

    async getClientInvoices(conn, clientCode) {
        const rows = await safeQuery(conn, `
            SELECT TRIM(NUMERODOCUMENTO) as NUMERO, IMPORTEPENDIENTE as IMPORTE,
                   FECHAVENCIMIENTO as VENCIMIENTO, ESTADO
            FROM DSEDAC.CVC
            WHERE TRIM(CODIGOCLIENTEALBARAN) = ? AND IMPORTEPENDIENTE > 0
            ORDER BY FECHAVENCIMIENTO ASC
            FETCH FIRST 50 ROWS ONLY
        `, [clientCode]);

        const totalAmount = rows.reduce((sum, r) => sum + (parseFloat(r.IMPORTE) || 0), 0);

        return {
            clientCode,
            invoices: rows.map(r => ({
                number: r.NUMERO,
                amount: parseFloat(r.IMPORTE) || 0,
                dueDate: r.VENCIMIENTO ? String(r.VENCIMIENTO) : null,
                status: r.ESTADO?.trim() || 'Pendiente'
            })),
            totalAmount: Math.round(totalAmount * 100) / 100
        };
    }
};

// ============================================================================
// PEDIDOS (ORDERS) TOOLS
// ============================================================================

const pedidosTools = {
    async getDailyOrders(conn, userCode, isJefeVentas, year, month, day, vendorScope) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;
        const currentDay = day || new Date().getDate();
        const vendorFilter = _buildVendorFilter(vendorScope, userCode);

        const sql = `
            SELECT COUNT(DISTINCT OPP.NUMEROORDENPREPARACION) as TOTAL_ORDERS,
                   COUNT(*) as TOTAL_LINES,
                   COUNT(DISTINCT OPP.CODIGOCLIENTE) as TOTAL_CLIENTS
            FROM DSEDAC.OPP OPP
            WHERE OPP.ANOREPARTO = ? AND OPP.MESREPARTO = ? AND OPP.DIAREPARTO = ?
              ${vendorFilter.sql}
        `;
        const params = [currentYear, currentMonth, currentDay, ...vendorFilter.params];

        const result = await safeQuery(conn, sql, params);
        const r = result[0] || {};

        // Get total amount from LAC
        const amountSql = `
            SELECT SUM(IMPORTEVENTA) as TOTAL_AMOUNT
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ? AND DIADOCUMENTO = ?
              ${vendorFilter.sql}
        `;
        const amountParams = [currentYear, currentMonth, currentDay, ...vendorFilter.params];

        const amountResult = await safeQuery(conn, amountSql, amountParams);
        const totalAmount = parseFloat(amountResult[0]?.TOTAL_AMOUNT) || 0;

        return {
            year: currentYear,
            month: currentMonth,
            day: currentDay,
            totalOrders: parseInt(r.TOTAL_ORDERS) || 0,
            totalLines: parseInt(r.TOTAL_LINES) || 0,
            totalClients: parseInt(r.TOTAL_CLIENTS) || 0,
            totalAmount: totalAmount,
            orders: []
        };
    },

    async getClientOrders(conn, clientCode, userCode, isJefeVentas, limit = 10, vendorScope) {
        const vendorFilter = _buildVendorFilter(vendorScope, userCode);

        const sql = `
            SELECT ANODOCUMENTO, MESDOCUMENTO, DIADOCUMENTO,
                   TRIM(NUMEROORDENPREPARACION) as ORDER_NUM,
                   IMPORTEVENTA as AMOUNT, ESTADO
            FROM DSEDAC.OPP
            WHERE TRIM(CODIGOCLIENTE) = ?
              ${vendorFilter.sql}
            ORDER BY ANOREPARTO DESC, MESREPARTO DESC, DIAREPARTO DESC
            FETCH FIRST ? ROWS ONLY
        `;
        const params = [clientCode, ...vendorFilter.params, limit];

        const rows = await safeQuery(conn, sql, params);
        return {
            clientCode,
            orders: rows.map(r => ({
                orderNumber: r.ORDER_NUM,
                date: `${r.ANODOCUMENTO}-${String(r.MESDOCUMENTO).padStart(2, '0')}-${String(r.DIADOCUMENTO).padStart(2, '0')}`,
                amount: parseFloat(r.AMOUNT) || 0,
                status: r.ESTADO?.trim() || 'Confirmado'
            }))
        };
    }
};

// ============================================================================
// COBROS (COLLECTIONS) TOOLS
// ============================================================================

const cobrosTools = {
    async getPendingCobros(conn, clientCode) {
        const rows = await safeQuery(conn, `
            SELECT
                TRIM(C.SERIEDOCUMENTO) AS SERIE_DOCUMENTO,
                C.NUMERODOCUMENTO AS NUMERO_DOCUMENTO,
                C.IMPORTEVENCIMIENTO AS IMPORTE_TOTAL,
                C.IMPORTECANCELADO AS IMPORTE_COBRADO,
                C.IMPORTEPENDIENTE AS IMPORTE_PENDIENTE,
                C.DIAVENCIMIENTO AS DIA_VENCIMIENTO,
                C.MESVENCIMIENTO AS MES_VENCIMIENTO,
                C.ANOVENCIMIENTO AS ANO_VENCIMIENTO,
                TRIM(C.TIPODOCUMENTO) AS TIPO_DOCUMENTO
            FROM DSEDAC.CVC C
            WHERE TRIM(C.CODIGOCLIENTEALBARAN) = ?
              AND C.IMPORTEPENDIENTE > 0.01
              AND (C.ANULADOSN IS NULL OR C.ANULADOSN <> 'S')
            ORDER BY C.ANOVENCIMIENTO ASC, C.MESVENCIMIENTO ASC, C.DIAVENCIMIENTO ASC
            FETCH FIRST 100 ROWS ONLY
        `, [clientCode]);

        const totalPending = rows.reduce((sum, r) => sum + (parseFloat(r.IMPORTE_PENDIENTE) || 0), 0);
        const format2 = (n) => String(n).padStart(2, '0');
        const dueDate = (r) => {
            const y = parseInt(r.ANO_VENCIMIENTO, 10);
            const m = parseInt(r.MES_VENCIMIENTO, 10);
            const d = parseInt(r.DIA_VENCIMIENTO, 10);
            if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || y <= 0 || m <= 0 || d <= 0) return null;
            return `${y}-${format2(m)}-${format2(d)}`;
        };

        return {
            clientCode,
            totalPending: Math.round(totalPending * 100) / 100,
            documentCount: rows.length,
            documents: rows.map(r => ({
                number: `${r.SERIE_DOCUMENTO}/${r.NUMERO_DOCUMENTO}`,
                type: r.TIPO_DOCUMENTO,
                total: parseFloat(r.IMPORTE_TOTAL) || 0,
                collected: parseFloat(r.IMPORTE_COBRADO) || 0,
                pending: parseFloat(r.IMPORTE_PENDIENTE) || 0,
                dueDate: dueDate(r)
            }))
        };
    },

    async getCobrosSummary(conn, userCode, isJefeVentas, month, year, vendorScope) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;
        const vendorFilter = _buildVendorFilter(vendorScope, userCode);

        const sql = `
            SELECT 
                SUM(CPC.IMPORTETOTAL) as TOTAL_COLLECTABLE,
                SUM(CASE WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0 THEN CPC.IMPORTETOTAL ELSE CPC.IMPORTETOTAL - COALESCE(CVC.IMPORTEPENDIENTE, 0) END) as TOTAL_COLLECTED
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            LEFT JOIN DSEDAC.CVC CVC ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
                AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
            WHERE OPP.MESREPARTO = ? AND OPP.ANOREPARTO = ?
              ${vendorFilter.sql.replace('CODIGOVENDEDOR', 'OPP.CODIGOVENDEDOR')}
        `;
        const params = [currentMonth, currentYear, ...vendorFilter.params];

        const result = await safeQuery(conn, sql, params);
        const r = result[0] || {};
        const collectable = parseFloat(r.TOTAL_COLLECTABLE) || 0;
        const collected = parseFloat(r.TOTAL_COLLECTED) || 0;
        const pending = collectable - collected;
        const collectionPercent = collectable > 0 ? Math.round((collected / collectable) * 1000) / 10 : 0;

        return {
            month: currentMonth,
            year: currentYear,
            totalCollectable: Math.round(collectable * 100) / 100,
            totalCollected: Math.round(collected * 100) / 100,
            totalPending: Math.round(pending * 100) / 100,
            collectionPercent
        };
    }
};

// ============================================================================
// BOLSA COMERCIAL TOOLS
// ============================================================================

const bolsaTools = {
    async getBolsaStatus(conn, userCode, month, year) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;

        const rows = await safeQuery(conn, `
            SELECT LIMITE_PCT, LIMITE_IMPORTE, SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO
            FROM JAVIER.BOLSA_COMERCIAL
            WHERE TRIM(CODIGOVENDEDOR) = ? AND EJERCICIO = ? AND MES = ?
        `, [userCode, currentYear, currentMonth]);

        if (rows.length === 0) {
            return {
                month: currentMonth,
                year: currentYear,
                limitePct: 3.0,
                limiteImporte: 0,
                saldoDisponible: 0,
                consumido: 0,
                acumulado: 0
            };
        }

        const r = rows[0];
        return {
            month: currentMonth,
            year: currentYear,
            limitePct: parseFloat(r.LIMITE_PCT) || 3.0,
            limiteImporte: parseFloat(r.LIMITE_IMPORTE) || 0,
            saldoDisponible: parseFloat(r.SALDO_DISPONIBLE) || 0,
            consumido: parseFloat(r.CONSUMIDO) || 0,
            acumulado: parseFloat(r.ACUMULADO) || 0
        };
    },

    async getBolsaMovements(conn, userCode, month, year, limit = 20) {
        const bolsa = await this.getBolsaStatus(conn, userCode, month, year);

        // Need bolsa ID for movements
        const bolsaRows = await safeQuery(conn, `
            SELECT ID FROM JAVIER.BOLSA_COMERCIAL
            WHERE TRIM(CODIGOVENDEDOR) = ? AND EJERCICIO = ? AND MES = ?
        `, [userCode, bolsa.year, bolsa.month]);

        if (bolsaRows.length === 0) {
            return { month: bolsa.month, year: bolsa.year, movements: [] };
        }

        const bolsaId = bolsaRows[0].ID;
        const rows = await safeQuery(conn, `
            SELECT TIPO, IMPORTE, SALDO_ANTERIOR, SALDO_POSTERIOR,
                   DESCRIPCION, CODIGO_ARTICULO, CREATED_AT
            FROM JAVIER.MOVIMIENTOS_BOLSA
            WHERE BOLSA_ID = ?
            ORDER BY CREATED_AT DESC
            FETCH FIRST ? ROWS ONLY
        `, [bolsaId, limit]);

        return {
            month: bolsa.month,
            year: bolsa.year,
            movements: rows.map(r => ({
                tipo: (r.TIPO || '').trim(),
                importe: parseFloat(r.IMPORTE) || 0,
                saldoAnterior: parseFloat(r.SALDO_ANTERIOR) || 0,
                saldoPosterior: parseFloat(r.SALDO_POSTERIOR) || 0,
                descripcion: (r.DESCRIPCION || '').trim(),
                codigoArticulo: (r.CODIGO_ARTICULO || '').trim(),
                fecha: r.CREATED_AT
            }))
        };
    },

    async getBolsaHistory(conn, userCode, months = 12) {
        const code = String(userCode || '').trim();
        const n = Math.min(Math.max(parseInt(months) || 12, 1), 36);

        const now = new Date();
        const cutoff = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
        const cutoffYear = cutoff.getFullYear();
        const cutoffMonth = cutoff.getMonth() + 1;

        const rows = await safeQuery(conn, `
            SELECT EJERCICIO, MES, SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO,
                   LIMITE_PCT, LIMITE_IMPORTE
            FROM JAVIER.BOLSA_COMERCIAL
            WHERE TRIM(CODIGOVENDEDOR) = ?
              AND (EJERCICIO > ? OR (EJERCICIO = ? AND MES >= ?))
            ORDER BY EJERCICIO ASC, MES ASC
        `, [code, cutoffYear, cutoffYear, cutoffMonth]);

        const byKey = new Map();
        for (const r of rows || []) {
            const y = parseInt(r.EJERCICIO);
            const m = parseInt(r.MES);
            byKey.set(`${y}-${String(m).padStart(2, '0')}`, {
                ejercicio: y,
                mes: m,
                saldoDisponible: parseFloat(r.SALDO_DISPONIBLE) || 0,
                consumido: parseFloat(r.CONSUMIDO) || 0,
                acumulado: parseFloat(r.ACUMULADO) || 0,
                limitePct: parseFloat(r.LIMITE_PCT) || 0,
                limiteImporte: parseFloat(r.LIMITE_IMPORTE) || 0,
            });
        }

        const points = [];
        for (let i = 0; i < n; i++) {
            const d = new Date(cutoff.getFullYear(), cutoff.getMonth() + i, 1);
            const y = d.getFullYear();
            const m = d.getMonth() + 1;
            const key = `${y}-${String(m).padStart(2, '0')}`;
            if (byKey.has(key)) {
                points.push(byKey.get(key));
            } else {
                points.push({
                    ejercicio: y, mes: m,
                    saldoDisponible: 0, consumido: 0, acumulado: 0,
                    limitePct: 0, limiteImporte: 0,
                });
            }
        }

        let totalAcumulado = 0, totalConsumido = 0;
        for (const p of points) {
            totalAcumulado += p.acumulado;
            totalConsumido += p.consumido;
        }

        return {
            vendedor: code,
            months: n,
            points,
            totals: {
                acumulado: totalAcumulado,
                consumido: totalConsumido,
                saldoNeto: totalAcumulado - totalConsumido,
            },
        };
    }
};

// ============================================================================
// EVOLUTION TOOLS
// ============================================================================

const evolutionTools = {
    async getSalesEvolution(conn, userCode, isJefeVentas, months = 24, vendorScope) {
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;
        const startPeriod = new Date(currentYear, currentMonth - months, 1);
        const startYear = startPeriod.getFullYear();
        const startMonth = startPeriod.getMonth() + 1;

        const vendorFilter = _buildVendorFilter(vendorScope, userCode, 'L.LCCDVD');
        const params = [startYear, startYear, startMonth, ...vendorFilter.params];

        const rows = await safeQuery(conn, `
            SELECT
                L.LCAADC AS ANO,
                L.LCMMDC AS MES,
                COUNT(DISTINCT L.LCCDCL) AS NUM_CLIENTES,
                COUNT(*) AS NUM_LINEAS,
                SUM(L.LCIMVT) AS TOTAL_VENTAS,
                SUM(L.LCIMCT) AS TOTAL_COSTO,
                SUM(L.LCIMVT - L.LCIMCT) AS TOTAL_MARGEN
            FROM DSED.LACLAE L
            WHERE (L.LCAADC > ? OR (L.LCAADC = ? AND L.LCMMDC >= ?))
              AND L.TPDC = 'LAC'
              AND L.LCTPVT IN ('CC', 'VC')
              AND L.LCCLLN IN ('AB', 'VT')
              AND L.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
              ${vendorFilter.sql}
            GROUP BY L.LCAADC, L.LCMMDC
            ORDER BY L.LCAADC, L.LCMMDC
        `, params);

        const monthlyData = (rows || []).map(r => {
            const ventas = parseFloat(r.TOTAL_VENTAS) || 0;
            const costo = parseFloat(r.TOTAL_COSTO) || 0;
            const margen = parseFloat(r.TOTAL_MARGEN) || 0;
            return {
                year: parseInt(r.ANO),
                month: parseInt(r.MES),
                period: `${r.ANO}-${String(r.MES).padStart(2, '0')}`,
                numClientes: parseInt(r.NUM_CLIENTES) || 0,
                numLineas: parseInt(r.NUM_LINEAS) || 0,
                totalVentas: ventas,
                totalCosto: costo,
                totalMargen: margen,
                margenPct: ventas > 0 ? Math.round((margen / ventas) * 10000) / 100 : 0,
            };
        });

        const thisYear = monthlyData.filter(d => d.year === currentYear);
        const lastYear = monthlyData.filter(d => d.year === currentYear - 1);
        const ytdVentas = thisYear.filter(d => d.month <= currentMonth).reduce((s, d) => s + d.totalVentas, 0);
        const ytdVentasPrev = lastYear.filter(d => d.month <= currentMonth).reduce((s, d) => s + d.totalVentas, 0);

        return {
            monthly: monthlyData,
            summary: {
                ytdVentas,
                ytdVentasPrev,
                yoyChange: ytdVentasPrev > 0 ? Math.round(((ytdVentas - ytdVentasPrev) / ytdVentasPrev) * 10000) / 100 : 0,
            }
        };
    },

    async getProductEvolution(conn, userCode, isJefeVentas, limit = 20, vendorScope) {
        const currentYear = new Date().getFullYear();
        const prevYear = currentYear - 1;

        const vendorFilter = _buildVendorFilter(vendorScope, userCode, 'L.LCCDVD');
        const params = [currentYear, prevYear, ...vendorFilter.params, limit];

        const rows = await safeQuery(conn, `
            SELECT
                TRIM(L.LCCDRF) AS CODE,
                TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                TRIM(A.CODIGOFAMILIA) AS FAMILY,
                SUM(CASE WHEN L.LCAADC = ? THEN L.LCIMVT ELSE 0 END) AS VENTAS_ACTUAL,
                SUM(CASE WHEN L.LCAADC = ? THEN L.LCIMVT ELSE 0 END) AS VENTAS_ANTERIOR,
                SUM(L.LCIMVT) AS VENTAS_TOTAL
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.ART A ON TRIM(L.LCCDRF) = TRIM(A.CODIGOARTICULO)
            WHERE L.LCAADC IN (?, ?)
              AND L.LCIMVT > 0
              ${vendorFilter.sql}
            GROUP BY TRIM(L.LCCDRF), TRIM(A.DESCRIPCIONARTICULO), TRIM(A.CODIGOFAMILIA)
            ORDER BY VENTAS_TOTAL DESC
            FETCH FIRST ? ROWS ONLY
        `, params);

        return {
            products: (rows || []).map(r => {
                const actual = parseFloat(r.VENTAS_ACTUAL) || 0;
                const anterior = parseFloat(r.VENTAS_ANTERIOR) || 0;
                return {
                    code: (r.CODE || '').trim(),
                    name: (r.NAME || '').trim(),
                    family: (r.FAMILY || '').trim(),
                    ventasActual: actual,
                    ventasAnterior: anterior,
                    yoyChange: anterior > 0 ? Math.round(((actual - anterior) / anterior) * 10000) / 100 : (actual > 0 ? 100 : 0),
                    trend: actual > anterior ? 'UP' : actual < anterior ? 'DOWN' : 'FLAT',
                };
            })
        };
    },

    async getClientEvolution(conn, userCode, isJefeVentas, limit = 20, vendorScope) {
        const currentYear = new Date().getFullYear();
        const prevYear = currentYear - 1;

        const vendorFilter = _buildVendorFilter(vendorScope, userCode, 'L.LCCDVD');
        const params = [currentYear, prevYear, ...vendorFilter.params, limit];

        const rows = await safeQuery(conn, `
            SELECT
                TRIM(L.LCCDCL) AS CODIGO_CLIENTE,
                MAX(TRIM(C.NOMBRECLIENTE)) AS NOMBRE,
                SUM(CASE WHEN L.LCAADC = ? THEN L.LCIMVT ELSE 0 END) AS VENTAS_ACTUAL,
                SUM(CASE WHEN L.LCAADC = ? THEN L.LCIMVT ELSE 0 END) AS VENTAS_ANTERIOR,
                COUNT(DISTINCT CASE WHEN L.LCAADC = ? THEN L.LCCDRF END) AS PRODUCTOS_ACTUAL
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.CLI C ON TRIM(L.LCCDCL) = TRIM(C.CODIGOCLIENTE)
            WHERE L.LCAADC IN (?, ?)
              AND L.LCIMVT > 0
              ${vendorFilter.sql}
            GROUP BY TRIM(L.LCCDCL)
            ORDER BY VENTAS_ACTUAL DESC
            FETCH FIRST ? ROWS ONLY
        `, params);

        return {
            clients: (rows || []).map(r => {
                const actual = parseFloat(r.VENTAS_ACTUAL) || 0;
                const anterior = parseFloat(r.VENTAS_ANTERIOR) || 0;
                return {
                    codigoCliente: (r.CODIGO_CLIENTE || '').trim(),
                    nombre: (r.NOMBRE || '').trim(),
                    ventasActual: actual,
                    ventasAnterior: anterior,
                    productosActual: parseInt(r.PRODUCTOS_ACTUAL) || 0,
                    yoyChange: anterior > 0 ? Math.round(((actual - anterior) / anterior) * 10000) / 100 : (actual > 0 ? 100 : 0),
                    trend: actual > anterior ? 'UP' : actual < anterior ? 'DOWN' : 'FLAT',
                };
            })
        };
    }
};

// ============================================================================
// ANALYTICS TOOLS
// ============================================================================

const analyticsTools = {
    async getTopClients(conn, userCode, isJefeVentas, month, year, limit = 10, vendorScope) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;

        const vendorFilter = _buildVendorFilter(vendorScope, userCode, 'L.LCCDVD');
        const params = [currentYear, currentMonth, ...vendorFilter.params, limit];

        const rows = await safeQuery(conn, `
            SELECT
                TRIM(L.LCCDCL) AS CLIENT_CODE,
                TRIM(MAX(C.NOMBRECLIENTE)) AS CLIENT_NAME,
                SUM(L.LCIMVT) AS TOTAL_SALES,
                COUNT(DISTINCT L.LCCDRF) AS NUM_PRODUCTS
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.CLI C ON TRIM(L.LCCDCL) = TRIM(C.CODIGOCLIENTE)
            WHERE L.LCAADC = ? AND L.LCMMDC = ?
              AND L.LCIMVT > 0
              ${vendorFilter.sql}
            GROUP BY TRIM(L.LCCDCL)
            ORDER BY TOTAL_SALES DESC
            FETCH FIRST ? ROWS ONLY
        `, params);

        return {
            month: currentMonth,
            year: currentYear,
            clients: rows.map(r => ({
                clientCode: (r.CLIENT_CODE || '').trim(),
                name: (r.CLIENT_NAME || '').trim(),
                sales: parseFloat(r.TOTAL_SALES) || 0,
                numProducts: parseInt(r.NUM_PRODUCTS) || 0
            }))
        };
    },

    async getTopProducts(conn, userCode, isJefeVentas, month, year, limit = 10, vendorScope) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;

        const vendorFilter = _buildVendorFilter(vendorScope, userCode, 'L.LCCDVD');
        const params = [currentYear, currentMonth, ...vendorFilter.params, limit];

        const rows = await safeQuery(conn, `
            SELECT
                TRIM(L.LCCDRF) AS PRODUCT_CODE,
                TRIM(MAX(A.DESCRIPCIONARTICULO)) AS PRODUCT_NAME,
                SUM(L.LCIMVT) AS TOTAL_SALES,
                SUM(L.LCQTVR) AS TOTAL_QUANTITY
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.ART A ON TRIM(L.LCCDRF) = TRIM(A.CODIGOARTICULO)
            WHERE L.LCAADC = ? AND L.LCMMDC = ?
              AND L.LCIMVT > 0
              ${vendorFilter.sql}
            GROUP BY TRIM(L.LCCDRF)
            ORDER BY TOTAL_SALES DESC
            FETCH FIRST ? ROWS ONLY
        `, params);

        return {
            month: currentMonth,
            year: currentYear,
            products: rows.map(r => ({
                productCode: (r.PRODUCT_CODE || '').trim(),
                name: (r.PRODUCT_NAME || '').trim(),
                sales: parseFloat(r.TOTAL_SALES) || 0,
                quantity: parseFloat(r.TOTAL_QUANTITY) || 0
            }))
        };
    },

    async getYoYComparison(conn, userCode, isJefeVentas, year, month, vendorScope) {
        const currentYear = year || new Date().getFullYear();
        const lastYear = currentYear - 1;

        const vendorFilter = _buildVendorFilter(vendorScope, userCode, 'L.LCCDVD');
        const monthFilter = month ? `AND L.LCMMDC = ?` : '';

        const getData = async (yr) => {
            const params = [yr, ...vendorFilter.params];
            if (month) params.push(month);

            const rows = await safeQuery(conn, `
                SELECT 
                    SUM(L.LCIMVT) as SALES,
                    SUM(L.LCIMVT - L.LCIMCT) as MARGIN,
                    COUNT(DISTINCT L.LCCDCL) as CLIENTS
                FROM DSED.LACLAE L
                WHERE L.LCAADC = ?
                  AND L.LCIMVT > 0
                  ${monthFilter}
                  ${vendorFilter.sql}
            `, params);

            const r = rows[0] || {};
            return {
                year: yr,
                sales: parseFloat(r.SALES) || 0,
                margin: parseFloat(r.MARGIN) || 0,
                clients: parseInt(r.CLIENTS) || 0
            };
        };

        const [current, previous] = await Promise.all([getData(currentYear), getData(lastYear)]);

        const salesGrowth = previous.sales > 0 ? Math.round(((current.sales - previous.sales) / previous.sales) * 1000) / 10 : 0;
        const marginGrowth = previous.margin > 0 ? Math.round(((current.margin - previous.margin) / previous.margin) * 1000) / 10 : 0;

        const formatCurrency = (val) => val.toLocaleString('es-ES') + '€';

        return {
            currentYear: { year: currentYear, sales: formatCurrency(current.sales), margin: formatCurrency(current.margin), clients: current.clients },
            lastYear: { year: lastYear, sales: formatCurrency(previous.sales), margin: formatCurrency(previous.margin), clients: previous.clients },
            growth: { salesPercent: salesGrowth, marginPercent: marginGrowth }
        };
    }
};

// ============================================================================
// REPARTIDOR TOOLS
// ============================================================================

const repartidorTools = {
    async getRepartidorCollections(conn, userCode, month, year) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;

        // Get collections summary for repartidor
        const rows = await safeQuery(conn, `
            SELECT 
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
                TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, '')) as NOMBRE_CLIENTE,
                SUM(CPC.IMPORTETOTAL) as TOTAL_COBRABLE,
                SUM(CASE 
                    WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0 
                    THEN CPC.IMPORTETOTAL 
                    ELSE CPC.IMPORTETOTAL - COALESCE(CVC.IMPORTEPENDIENTE, 0)
                END) as TOTAL_COBRADO,
                COUNT(*) as NUM_DOCUMENTOS
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            LEFT JOIN DSEDAC.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            LEFT JOIN DSEDAC.CVC CVC 
                ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
                AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
                AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
                AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
            WHERE OPP.MESREPARTO = ?
              AND OPP.ANOREPARTO = ?
              AND TRIM(OPP.CODIGOREPARTIDOR) = ?
            GROUP BY TRIM(CPC.CODIGOCLIENTEALBARAN), TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), CLI.NOMBRECLIENTE, ''))
            ORDER BY TOTAL_COBRABLE DESC
            FETCH FIRST 100 ROWS ONLY
        `, [currentMonth, currentYear, userCode]);

        const clients = rows.map(row => {
            const collectable = parseFloat(row.TOTAL_COBRABLE) || 0;
            const collected = parseFloat(row.TOTAL_COBRADO) || 0;
            const percentage = collectable > 0 ? Math.round((collected / collectable) * 1000) / 10 : 0;
            return {
                clientCode: (row.CLIENTE || '').trim(),
                clientName: (row.NOMBRE_CLIENTE || '').trim(),
                collectable: Math.round(collectable * 100) / 100,
                collected: Math.round(collected * 100) / 100,
                percentage,
                numDocuments: parseInt(row.NUM_DOCUMENTOS) || 0
            };
        });

        const totalCollectable = clients.reduce((s, c) => s + c.collectable, 0);
        const totalCollected = clients.reduce((s, c) => s + c.collected, 0);
        const overallPercentage = totalCollectable > 0 ? Math.round((totalCollected / totalCollectable) * 1000) / 10 : 0;
        const thresholdMet = overallPercentage >= 30;

        // Commission calc (30% threshold, tiers)
        let totalCommission = 0;
        if (thresholdMet && overallPercentage > 100) {
            const excess = totalCollected - totalCollectable;
            const tiers = [
                { min: 100.01, max: 103.00, pct: 1.0 },
                { min: 103.01, max: 106.00, pct: 1.3 },
                { min: 106.01, max: 110.00, pct: 1.6 },
                { min: 110.01, max: 999.99, pct: 2.0 }
            ];
            for (const t of tiers) {
                if (overallPercentage >= t.min && overallPercentage <= t.max) {
                    totalCommission = excess * (t.pct / 100);
                    break;
                }
            }
        }

        return {
            month: currentMonth,
            year: currentYear,
            clients,
            summary: {
                totalCollectable: Math.round(totalCollectable * 100) / 100,
                totalCollected: Math.round(totalCollected * 100) / 100,
                totalCommission: Math.round(totalCommission * 100) / 100,
                overallPercentage,
                thresholdMet,
                clientCount: clients.length
            }
        };
    },

    async getRepartidorCommissions(conn, userCode, month, year) {
        const collections = await this.getRepartidorCollections(conn, userCode, month, year);
        return {
            month: collections.month,
            year: collections.year,
            collected: collections.summary.totalCollected,
            collectable: collections.summary.totalCollectable,
            percentage: collections.summary.overallPercentage,
            thresholdMet: collections.summary.thresholdMet,
            commission: collections.summary.totalCommission
        };
    },

    async getRepartidorDeliveries(conn, userCode, year, month, day) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;
        const currentDay = day || new Date().getDate();

        const rows = await safeQuery(conn, `
            SELECT 
                COUNT(DISTINCT OPP.NUMEROORDENPREPARACION) as TOTAL_DELIVERIES,
                COUNT(*) as TOTAL_LINES
            FROM DSEDAC.OPP OPP
            WHERE OPP.ANOREPARTO = ? AND OPP.MESREPARTO = ? AND OPP.DIAREPARTO = ?
              AND TRIM(OPP.CODIGOREPARTIDOR) = ?
        `, [currentYear, currentMonth, currentDay, userCode]);

        const r = rows[0] || {};
        return {
            year: currentYear,
            month: currentMonth,
            day: currentDay,
            totalDeliveries: parseInt(r.TOTAL_DELIVERIES) || 0,
            totalLines: parseInt(r.TOTAL_LINES) || 0,
            completed: parseInt(r.TOTAL_DELIVERIES) || 0,
            pending: 0,
            deliveries: []
        };
    }
};

// ============================================================================
// WAREHOUSE TOOLS
// ============================================================================

const warehouseTools = {
    async getWarehouseDashboard(conn, year, month, day) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;
        const currentDay = day || new Date().getDate();

        const trucks = await safeQuery(conn, `
            SELECT 
                TRIM(OPP.CODIGOVEHICULO) AS VEHICULO,
                TRIM(V.DESCRIPCIONVEHICULO) AS DESCRIPCION,
                TRIM(V.MATRICULA) AS MATRICULA,
                TRIM(OPP.CODIGOREPARTIDOR) AS REPARTIDOR,
                TRIM(VDD.NOMBREVENDEDOR) AS NOMBRE_REPARTIDOR,
                COUNT(DISTINCT OPP.NUMEROORDENPREPARACION) AS NUM_ORDENES,
                COUNT(*) AS NUM_LINEAS
            FROM DSEDAC.OPP OPP
            LEFT JOIN DSEDAC.VEH V ON TRIM(V.CODIGOVEHICULO) = TRIM(OPP.CODIGOVEHICULO)
            LEFT JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(OPP.CODIGOREPARTIDOR)
            WHERE OPP.ANOREPARTO = ?
                AND OPP.MESREPARTO = ?
                AND OPP.DIAREPARTO = ?
                AND TRIM(OPP.CODIGOVEHICULO) <> ''
            GROUP BY TRIM(OPP.CODIGOVEHICULO), TRIM(V.DESCRIPCIONVEHICULO),
                     TRIM(V.MATRICULA), TRIM(OPP.CODIGOREPARTIDOR),
                     TRIM(VDD.NOMBREVENDEDOR)
            ORDER BY TRIM(OPP.CODIGOVEHICULO)
        `, [currentYear, currentMonth, currentDay]);

        return {
            date: { year: currentYear, month: currentMonth, day: currentDay },
            totalTrucks: trucks.length,
            trucks: trucks.map(t => ({
                vehicleCode: (t.VEHICULO || '').trim(),
                description: (t.DESCRIPCION || '').trim(),
                matricula: (t.MATRICULA || '').trim(),
                driverCode: (t.REPARTIDOR || '').trim(),
                driverName: (t.NOMBRE_REPARTIDOR || '').trim(),
                orderCount: parseInt(t.NUM_ORDENES) || 0,
                lineCount: parseInt(t.NUM_LINEAS) || 0,
                maxPayloadKg: 0,
                containerVolume: 0,
                tolerancePct: 5,
            }))
        };
    },

    async getVehicles(conn) {
        const vehicles = await safeQuery(conn, `
            SELECT
                TRIM(V.CODIGOVEHICULO) AS CODE,
                TRIM(V.DESCRIPCIONVEHICULO) AS DESCRIPCION,
                TRIM(V.MATRICULA) AS MATRICULA,
                V.CARGAMAXIMA, V.TARA, V.VOLUMEN, V.CONTENEDORVOLUMEN,
                COALESCE(V.NUMEROCONTENEDORES, 0) AS NUM_PALETS
            FROM DSEDAC.VEH V
            ORDER BY V.CODIGOVEHICULO
        `);

        return {
            vehicles: vehicles.map(v => {
                const numPalets = parseInt(v.NUM_PALETS) || 0;
                let payload = parseFloat(v.CARGAMAXIMA) || 0;
                if (payload === 0 && numPalets > 0) payload = numPalets * 500;
                if (payload === 0) payload = 6000;

                return {
                    code: (v.CODE || '').trim(),
                    description: (v.DESCRIPCION || '').trim(),
                    matricula: (v.MATRICULA || '').trim(),
                    maxPayloadKg: payload,
                    tara: parseFloat(v.TARA) || 0,
                    volumeM3: parseFloat(v.VOLUMEN) || 0,
                    containerVolumeM3: parseFloat(v.CONTENEDORVOLUMEN) || 0,
                    numPalets
                };
            })
        };
    }
};

// ============================================================================
// DAILY SUMMARY TOOLS
// ============================================================================

const summaryTools = {
    async getDailySummary(conn, userCode, isJefeVentas, year, month, day, vendorScope) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;
        const currentDay = day || new Date().getDate();

        // Get orders summary
        const orderVendorFilter = _buildVendorFilter(vendorScope, userCode, 'OPP.CODIGOVENDEDOR');
        const orderSql = `
            SELECT COUNT(DISTINCT OPP.NUMEROORDENPREPARACION) as TOTAL_ORDERS,
                   COUNT(DISTINCT OPP.CODIGOCLIENTE) as TOTAL_CLIENTS,
                   COUNT(*) as TOTAL_LINES
            FROM DSEDAC.OPP OPP
            WHERE OPP.ANOREPARTO = ? AND OPP.MESREPARTO = ? AND OPP.DIAREPARTO = ?
              ${orderVendorFilter.sql}
        `;
        const orderParams = [currentYear, currentMonth, currentDay, ...orderVendorFilter.params];

        const orderResult = await safeQuery(conn, orderSql, orderParams);
        const o = orderResult[0] || {};

        // Get total sales
        const salesVendorFilter = _buildVendorFilter(vendorScope, userCode);
        const salesSql = `
            SELECT SUM(IMPORTEVENTA) as TOTAL_SALES
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ? AND DIADOCUMENTO = ?
              ${salesVendorFilter.sql}
        `;
        const salesParams = [currentYear, currentMonth, currentDay, ...salesVendorFilter.params];

        const salesResult = await safeQuery(conn, salesSql, salesParams);
        const totalSales = parseFloat(salesResult[0]?.TOTAL_SALES) || 0;

        return {
            year: currentYear,
            month: currentMonth,
            day: currentDay,
            totalSales,
            totalOrders: parseInt(o.TOTAL_ORDERS) || 0,
            totalClients: parseInt(o.TOTAL_CLIENTS) || 0,
            totalOperations: parseInt(o.TOTAL_LINES) || 0,
            topClients: [],
            topProducts: []
        };
    }
};

// ============================================================================
// CROSS-QUERY TOOLS (Producto + Cliente + Periodo combinados)
// ============================================================================

const crossQueryTools = {
    async getPriceSoldToClient(conn, productCode, clientCode, limit = 5) {
        const rows = await safeQuery(conn, `
            SELECT PRECIOVENTAUNITARIO, IMPORTEVENTA, CANTIDADENVASES,
                   ANODOCUMENTO, MESDOCUMENTO, DIADOCUMENTO,
                   TRIM(NUMEROORDENPREPARACION) as ORDEN
            FROM DSEDAC.LAC
            WHERE TRIM(CODIGOARTICULO) = ? AND TRIM(CODIGOCLIENTEALBARAN) = ?
            ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
            FETCH FIRST ? ROWS ONLY
        `, [productCode, clientCode, limit]);

        if (rows.length === 0) return { error: 'Sin ventas de este producto a este cliente' };

        return {
            productCode,
            clientCode,
            sales: rows.map(r => ({
                price: parseFloat(r.PRECIOVENTAUNITARIO) || 0,
                amount: parseFloat(r.IMPORTEVENTA) || 0,
                quantity: parseFloat(r.CANTIDADENVASES) || 0,
                date: `${r.ANODOCUMENTO}-${String(r.MESDOCUMENTO).padStart(2, '0')}-${String(r.DIADOCUMENTO).padStart(2, '0')}`,
                orderNumber: r.ORDEN
            }))
        };
    },

    async getProductSalesByClient(conn, productCode, clientCode, month, year) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;

        const rows = await safeQuery(conn, `
            SELECT SUM(IMPORTEVENTA) as TOTAL, SUM(CANTIDADENVASES) as UNIDADES,
                   AVG(PRECIOVENTAUNITARIO) as PRECIO_MEDIO, COUNT(*) as LINEAS
            FROM DSEDAC.LAC
            WHERE TRIM(CODIGOARTICULO) = ? AND TRIM(CODIGOCLIENTEALBARAN) = ?
              AND ANODOCUMENTO = ? AND MESDOCUMENTO = ?
        `, [productCode, clientCode, currentYear, currentMonth]);

        const r = rows[0] || {};
        return {
            productCode,
            clientCode,
            month: currentMonth,
            year: currentYear,
            totalSales: parseFloat(r.TOTAL) || 0,
            totalUnits: parseFloat(r.UNIDADES) || 0,
            avgPrice: Math.round((parseFloat(r.PRECIO_MEDIO) || 0) * 100) / 100,
            numLines: parseInt(r.LINEAS) || 0
        };
    },

    async getClientProductsBought(conn, clientCode, limit = 20) {
        const rows = await safeQuery(conn, `
            SELECT TRIM(L.CODIGOARTICULO) as CODIGO, TRIM(A.DESCRIPCIONARTICULO) as NOMBRE,
                   TRIM(A.FAMILIA) as FAMILIA,
                   SUM(L.IMPORTEVENTA) as TOTAL, SUM(L.CANTIDADENVASES) as UNIDADES,
                   AVG(L.PRECIOVENTAUNITARIO) as PRECIO_MEDIO
            FROM DSEDAC.LAC L
            LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
            WHERE TRIM(L.CODIGOCLIENTEALBARAN) = ?
            GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, A.FAMILIA
            ORDER BY TOTAL DESC
            FETCH FIRST ? ROWS ONLY
        `, [clientCode, limit]);

        return {
            clientCode,
            products: rows.map(r => ({
                code: r.CODIGO,
                name: r.NOMBRE || 'Sin nombre',
                family: r.FAMILIA || 'Sin familia',
                totalSales: parseFloat(r.TOTAL) || 0,
                totalUnits: parseFloat(r.UNIDADES) || 0,
                avgPrice: Math.round((parseFloat(r.PRECIO_MEDIO) || 0) * 100) / 100
            }))
        };
    },

    async getClientMonthlySales(conn, clientCode, months = 12) {
        const now = new Date();
        const startYear = now.getFullYear();
        const startMonth = now.getMonth() + 1 - months;

        let adjYear = startYear, adjMonth = startMonth;
        if (adjMonth <= 0) { adjYear -= 1; adjMonth += 12; }

        const rows = await safeQuery(conn, `
            SELECT ANODOCUMENTO, MESDOCUMENTO,
                   SUM(IMPORTEVENTA) as TOTAL, SUM(CANTIDADENVASES) as UNIDADES,
                   COUNT(*) as LINEAS
            FROM DSEDAC.LAC
            WHERE TRIM(CODIGOCLIENTEALBARAN) = ?
              AND (ANODOCUMENTO > ? OR (ANODOCUMENTO = ? AND MESDOCUMENTO >= ?))
            GROUP BY ANODOCUMENTO, MESDOCUMENTO
            ORDER BY ANODOCUMENTO, MESDOCUMENTO
        `, [clientCode, adjYear - 1, adjYear, adjMonth]);

        return {
            clientCode,
            monthly: rows.map(r => ({
                period: `${r.ANODOCUMENTO}-${String(r.MESDOCUMENTO).padStart(2, '0')}`,
                totalSales: parseFloat(r.TOTAL) || 0,
                totalUnits: parseFloat(r.UNIDADES) || 0,
                numLines: parseInt(r.LINEAS) || 0
            }))
        };
    },

    async getVendorMonthlySummary(conn, userCode, isJefeVentas, months = 6, vendorScope) {
        const now = new Date();
        const vendorFilter = _buildVendorFilter(vendorScope, userCode);

        const months_data = [];
        for (let i = 0; i < months; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const y = d.getFullYear();
            const m = d.getMonth() + 1;

            const rows = await safeQuery(conn, `
                SELECT SUM(IMPORTEVENTA) as VENTAS, COUNT(DISTINCT CODIGOCLIENTEALBARAN) as CLIENTES,
                       COUNT(*) as OPERACIONES
                FROM DSEDAC.LAC
                WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ?
                  ${vendorFilter.sql}
            `, [y, m, ...vendorFilter.params]);

            const r = rows[0] || {};
            months_data.push({
                period: `${y}-${String(m).padStart(2, '0')}`,
                sales: parseFloat(r.VENTAS) || 0,
                clients: parseInt(r.CLIENTES) || 0,
                operations: parseInt(r.OPERACIONES) || 0
            });
        }

        return { months: months_data };
    },

    async getTopProductsByClient(conn, clientCode, month, year, limit = 10) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;

        const rows = await safeQuery(conn, `
            SELECT TRIM(L.CODIGOARTICULO) as CODIGO, TRIM(A.DESCRIPCIONARTICULO) as NOMBRE,
                   TRIM(A.FAMILIA) as FAMILIA,
                   SUM(L.IMPORTEVENTA) as TOTAL, SUM(L.CANTIDADENVASES) as UNIDADES,
                   AVG(L.PRECIOVENTAUNITARIO) as PRECIO_MEDIO
            FROM DSEDAC.LAC L
            LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
            WHERE TRIM(L.CODIGOCLIENTEALBARAN) = ?
              AND L.ANODOCUMENTO = ? AND L.MESDOCUMENTO = ?
            GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, A.FAMILIA
            ORDER BY TOTAL DESC
            FETCH FIRST ? ROWS ONLY
        `, [clientCode, currentYear, currentMonth, limit]);

        return {
            clientCode,
            month: currentMonth,
            year: currentYear,
            products: rows.map(r => ({
                code: r.CODIGO,
                name: r.NOMBRE || 'Sin nombre',
                family: r.FAMILIA || 'Sin familia',
                totalSales: parseFloat(r.TOTAL) || 0,
                totalUnits: parseFloat(r.UNIDADES) || 0,
                avgPrice: Math.round((parseFloat(r.PRECIO_MEDIO) || 0) * 100) / 100
            }))
        };
    },

    async searchProductByName(conn, query) {
        const searchTerm = `%${query}%`;
        const rows = await safeQuery(conn, `
            SELECT TRIM(CODIGOARTICULO) as CODIGO, TRIM(DESCRIPCIONARTICULO) as NOMBRE,
                   TRIM(FAMILIA) as FAMILIA, PRECIOVENTA as PRECIO
            FROM DSEDAC.ART
            WHERE TRIM(DESCRIPCIONARTICULO) LIKE ?
            ORDER BY DESCRIPCIONARTICULO
            FETCH FIRST 10 ROWS ONLY
        `, [searchTerm]);

        return rows.map(r => ({
            code: r.CODIGO,
            name: r.NOMBRE,
            family: r.FAMILIA,
            price: parseFloat(r.PRECIO) || 0
        }));
    },

    async searchClientByName(conn, query) {
        const searchTerm = `%${query}%`;
        const rows = await safeQuery(conn, `
            SELECT TRIM(CODIGOCLIENTE) as CODIGO, TRIM(NOMBRECLIENTE) as NOMBRE,
                   TRIM(POBLACION) as POBLACION, TRIM(PROVINCIA) as PROVINCIA,
                   TRIM(CODIGOVENDEDOR) as VENDEDOR
            FROM DSEDAC.CLI
            WHERE TRIM(NOMBRECLIENTE) LIKE ?
            ORDER BY NOMBRECLIENTE
            FETCH FIRST 10 ROWS ONLY
        `, [searchTerm]);

        return rows.map(r => ({
            code: r.CODIGO,
            name: r.NOMBRE,
            location: `${r.POBLACION} (${r.PROVINCIA})`,
            vendor: r.VENDEDOR
        }));
    }
};

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    dbDiscoveryTools,
    pricingTools,
    riskTools,
    commercialTools,
    logisticsTools,
    commissionTools,
    objectivesTools,
    invoiceTools,
    pedidosTools,
    cobrosTools,
    bolsaTools,
    evolutionTools,
    analyticsTools,
    repartidorTools,
    warehouseTools,
    summaryTools,
    crossQueryTools
};
