/**
 * NEXUS AI — Chatbot Tools (Parameterized Queries)
 * 
 * All queries use parameterized statements to prevent SQL injection.
 * New modules: commissionTools, objectivesTools, invoiceTools
 * 
 * SECURITY: Never use string concatenation for SQL values.
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
            SELECT CODIGOARTICULO, DESCRIPCIONARTICULO, PRECIOVENTA, COSTEPROMEDIO
            FROM DSEDAC.ART
            WHERE TRIM(CODIGOARTICULO) = ?
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
            cost: parseFloat(tariff[0]?.COSTEPROMEDIO) || 0,
            lastSoldPrice: parseFloat(lastSale[0]?.PRECIOVENTAUNITARIO) || 0,
            lastSoldTo: lastSale[0]?.CLIENTE
        };
    },

    async calculateBreakeven(conn, productCode) {
        const art = await safeQuery(conn, `
            SELECT COSTEPROMEDIO, PRECIOVENTA
            FROM DSEDAC.ART WHERE TRIM(CODIGOARTICULO) = ?
            FETCH FIRST 1 ROWS ONLY
        `, [productCode]);

        if (!art[0]) return { error: 'Producto no encontrado' };

        const cost = parseFloat(art[0].COSTEPROMEDIO) || 0;
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
            SELECT COSTEPROMEDIO, PRECIOVENTA FROM DSEDAC.ART 
            WHERE TRIM(CODIGOARTICULO) = ? FETCH FIRST 1 ROWS ONLY
        `, [productCode]);

        if (!art[0]) return { error: 'Producto no encontrado' };

        const cost = parseFloat(art[0].COSTEPROMEDIO) || 0;
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

    async getMarginGlobal(conn, userCode, isJefeVentas, month, year) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;

        let sql, params;
        if (isJefeVentas) {
            sql = `
                SELECT 
                    SUM(IMPORTEVENTA) as VENTAS,
                    SUM(IMPORTECOSTE) as COSTE,
                    COUNT(DISTINCT CODIGOCLIENTEALBARAN) as CLIENTES,
                    COUNT(*) as OPERACIONES
                FROM DSEDAC.LAC
                WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ?
            `;
            params = [currentYear, currentMonth];
        } else {
            sql = `
                SELECT 
                    SUM(IMPORTEVENTA) as VENTAS,
                    SUM(IMPORTECOSTE) as COSTE,
                    COUNT(DISTINCT CODIGOCLIENTEALBARAN) as CLIENTES,
                    COUNT(*) as OPERACIONES
                FROM DSEDAC.LAC
                WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ?
                  AND TRIM(CODIGOVENDEDOR) = ?
            `;
            params = [currentYear, currentMonth, userCode];
        }

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

    async getMarginByClient(conn, clientCode, userCode, isJefeVentas) {
        const currentYear = new Date().getFullYear();

        let sql, params;
        if (isJefeVentas) {
            sql = `
                SELECT SUM(IMPORTEVENTA) as VENTAS, SUM(IMPORTECOSTE) as COSTE, COUNT(*) as OPERACIONES
                FROM DSEDAC.LAC
                WHERE TRIM(CODIGOCLIENTEALBARAN) = ? AND ANODOCUMENTO = ?
            `;
            params = [clientCode, currentYear];
        } else {
            sql = `
                SELECT SUM(IMPORTEVENTA) as VENTAS, SUM(IMPORTECOSTE) as COSTE, COUNT(*) as OPERACIONES
                FROM DSEDAC.LAC
                WHERE TRIM(CODIGOCLIENTEALBARAN) = ? AND ANODOCUMENTO = ?
                  AND TRIM(CODIGOVENDEDOR) = ?
            `;
            params = [clientCode, currentYear, userCode];
        }

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
    async getCommissions(conn, userCode, isJefeVentas, month, year) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;

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

            // Get active clients count
            const clientRows = await safeQuery(conn, `
                SELECT COUNT(DISTINCT TRIM(CODIGOCLIENTEALBARAN)) as CLIENTES
                FROM DSEDAC.LAC
                WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ?
                  AND TRIM(CODIGOVENDEDOR) = ?
            `, [currentYear, currentMonth, userCode]);

            const opsRows = await safeQuery(conn, `
                SELECT COUNT(*) as OPS
                FROM DSEDAC.LAC
                WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ?
                  AND TRIM(CODIGOVENDEDOR) = ?
            `, [currentYear, currentMonth, userCode]);

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
              AND TRIM(CODIGOVENDEDOR) = ?
        `, [currentYear, currentMonth, userCode]);

        const ventas = parseFloat(salesRows[0]?.VENTAS) || 0;
        const targetPercent = 10; // Default commission rate
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

    async getCommissionDetails(conn, userCode, isJefeVentas, clientCode, month, year) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;

        let sql, params;
        if (clientCode) {
            sql = `
                SELECT TRIM(CODIGOCLIENTEALBARAN) as CLIENTE, SUM(IMPORTEVENTA) as VENTAS
                FROM DSEDAC.LAC
                WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ?
                  AND TRIM(CODIGOVENDEDOR) = ?
                  AND TRIM(CODIGOCLIENTEALBARAN) = ?
                GROUP BY CODIGOCLIENTEALBARAN
                ORDER BY VENTAS DESC
            `;
            params = [currentYear, currentMonth, userCode, clientCode];
        } else {
            sql = `
                SELECT TRIM(CODIGOCLIENTEALBARAN) as CLIENTE, SUM(IMPORTEVENTA) as VENTAS
                FROM DSEDAC.LAC
                WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ?
                  AND TRIM(CODIGOVENDEDOR) = ?
                GROUP BY CODIGOCLIENTEALBARAN
                ORDER BY VENTAS DESC
                FETCH FIRST 50 ROWS ONLY
            `;
            params = [currentYear, currentMonth, userCode];
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
    }
};

// ============================================================================
// OBJECTIVES TOOLS
// ============================================================================

const objectivesTools = {
    async getObjectives(conn, userCode, isJefeVentas, month, year) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;

        // Get target from OBJ_CONFIG
        const configRows = await safeQuery(conn, `
            SELECT TARGET_PERCENTAGE
            FROM JAVIER.OBJ_CONFIG
            WHERE TRIM(CODIGOVENDEDOR) = ? AND CODIGOCLIENTE = '*'
            FETCH FIRST 1 ROWS ONLY
        `, [userCode]);

        const targetPercent = configRows.length > 0 ? parseFloat(configRows[0].TARGET_PERCENTAGE) || 10 : 10;

        // Get actual sales for the month
        const salesRows = await safeQuery(conn, `
            SELECT SUM(IMPORTEVENTA) as VENTAS
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ?
              AND TRIM(CODIGOVENDEDOR) = ?
        `, [currentYear, currentMonth, userCode]);

        const achieved = parseFloat(salesRows[0]?.VENTAS) || 0;
        // Target = previous year same month sales * (1 + targetPercent/100)
        const prevSalesRows = await safeQuery(conn, `
            SELECT SUM(IMPORTEVENTA) as VENTAS
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = ? AND MESDOCUMENTO = ?
              AND TRIM(CODIGOVENDEDOR) = ?
        `, [currentYear - 1, currentMonth, userCode]);

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

    async getObjectivesByFamily(conn, userCode, isJefeVentas, familyCode, month, year) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;

        let sql, params;
        if (familyCode) {
            sql = `
                SELECT TRIM(A.FAMILIA) as FAMILIA, SUM(L.IMPORTEVENTA) as VENTAS
                FROM DSEDAC.LAC L
                LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
                WHERE L.ANODOCUMENTO = ? AND L.MESDOCUMENTO = ?
                  AND TRIM(L.CODIGOVENDEDOR) = ?
                  AND TRIM(A.FAMILIA) = ?
                GROUP BY A.FAMILIA
            `;
            params = [currentYear, currentMonth, userCode, familyCode];
        } else {
            sql = `
                SELECT TRIM(A.FAMILIA) as FAMILIA, SUM(L.IMPORTEVENTA) as VENTAS
                FROM DSEDAC.LAC L
                LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
                WHERE L.ANODOCUMENTO = ? AND L.MESDOCUMENTO = ?
                  AND TRIM(L.CODIGOVENDEDOR) = ?
                GROUP BY A.FAMILIA
                ORDER BY VENTAS DESC
            `;
            params = [currentYear, currentMonth, userCode];
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

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    dbDiscoveryTools,
    pricingTools,
    riskTools,
    commercialTools,
    logisticsTools,
    commissionTools,
    objectivesTools,
    invoiceTools
};
