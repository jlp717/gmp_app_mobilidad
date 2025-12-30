/**
 * CHATBOT TOOLS - AI Sales Assistant Functions
 * Comprehensive tools for sales reps to query DB in real-time
 */

const odbc = require('odbc');

// Database query helper
async function safeQuery(conn, sql) {
    try {
        return await conn.query(sql);
    } catch (error) {
        console.error(`Query error: ${error.message}`);
        return [];
    }
}

// ============================================================================
// DATABASE DISCOVERY TOOLS
// ============================================================================

const dbDiscoveryTools = {
    async listAllTables(conn) {
        const result = await safeQuery(conn, `
      SELECT TABLE_NAME FROM SYSIBM.TABLES 
      WHERE TABLE_SCHEMA = 'DSEDAC' 
      ORDER BY TABLE_NAME
    `);
        return result.map(r => r.TABLE_NAME?.trim());
    },

    async describeTable(conn, tableName) {
        const cols = await safeQuery(conn, `
      SELECT COLUMN_NAME, DATA_TYPE, LENGTH, SCALE
      FROM SYSIBM.COLUMNS
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${tableName}'
      ORDER BY ORDINAL_POSITION
    `);
        return cols.map(c => ({
            name: c.COLUMN_NAME?.trim(),
            type: c.DATA_TYPE?.trim(),
            length: c.LENGTH
        }));
    },

    async sampleTableData(conn, tableName, limit = 5) {
        return await safeQuery(conn, `SELECT * FROM DSEDAC.${tableName} FETCH FIRST ${limit} ROWS ONLY`);
    }
};

// ============================================================================
// PRICING & PROFITABILITY TOOLS
// ============================================================================

const pricingTools = {
    async getProductPrice(conn, productCode) {
        // Get tariff price
        const tariff = await safeQuery(conn, `
      SELECT CODIGOARTICULO, DESCRIPCIONARTICULO, PRECIOVENTA, COSTEPROMEDIO
      FROM DSEDAC.ART
      WHERE CODIGOARTICULO = '${productCode}'
      FETCH FIRST 1 ROWS ONLY
    `);

        // Get last sold price
        const lastSale = await safeQuery(conn, `
      SELECT PRECIOVENTAUNITARIO, CODIGOCLIENTEALBARAN, ANODOCUMENTO, MESDOCUMENTO
      FROM DSEDAC.LAC
      WHERE CODIGOARTICULO = '${productCode}'
      ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
      FETCH FIRST 1 ROWS ONLY
    `);

        return {
            product: tariff[0] || {},
            tariffPrice: tariff[0]?.PRECIOVENTA || 0,
            cost: tariff[0]?.COSTEPROMEDIO || 0,
            lastSoldPrice: lastSale[0]?.PRECIOVENTAUNITARIO || 0,
            lastSoldTo: lastSale[0]?.CODIGOCLIENTEALBARAN?.trim()
        };
    },

    async calculateBreakeven(conn, productCode) {
        const art = await safeQuery(conn, `
      SELECT CODIGOARTICULO, COSTEPROMEDIO, PRECIOVENTA
      FROM DSEDAC.ART WHERE CODIGOARTICULO = '${productCode}'
      FETCH FIRST 1 ROWS ONLY
    `);

        if (!art[0]) return { error: 'Producto no encontrado' };

        const cost = parseFloat(art[0].COSTEPROMEDIO) || 0;
        const tariff = parseFloat(art[0].PRECIOVENTA) || 0;
        const minMargin = 0.05; // 5% minimum margin
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
      WHERE CODIGOARTICULO = '${productCode}' FETCH FIRST 1 ROWS ONLY
    `);

        if (!art[0]) return { error: 'Producto no encontrado' };

        const cost = parseFloat(art[0].COSTEPROMEDIO) || 0;
        const tariff = parseFloat(art[0].PRECIOVENTA) || 0;
        const discount = parseFloat(discountPercent) / 100;
        const newPrice = tariff * (1 - discount);
        const oldMargin = tariff - cost;
        const newMargin = newPrice - cost;
        const marginLoss = oldMargin - newMargin;
        const extraVolumeNeeded = oldMargin / newMargin;

        return {
            productCode,
            originalPrice: tariff,
            discountPercent,
            newPrice: Math.round(newPrice * 100) / 100,
            originalMargin: Math.round(oldMargin * 100) / 100,
            newMargin: Math.round(newMargin * 100) / 100,
            marginLoss: Math.round(marginLoss * 100) / 100,
            extraVolumeNeededMultiplier: Math.round(extraVolumeNeeded * 100) / 100,
            profitable: newMargin > 0
        };
    },

    async compareYearlyPrices(conn, productCode, year1, year2) {
        const getData = async (year) => {
            const result = await safeQuery(conn, `
        SELECT AVG(PRECIOVENTAUNITARIO) as AVG_PRICE, SUM(IMPORTEVENTA) as TOTAL_SALES
        FROM DSEDAC.LAC
        WHERE CODIGOARTICULO = '${productCode}' AND ANODOCUMENTO = ${year}
      `);
            return result[0] || {};
        };

        const data1 = await getData(year1);
        const data2 = await getData(year2);

        return {
            productCode,
            [year1]: { avgPrice: data1.AVG_PRICE || 0, totalSales: data1.TOTAL_SALES || 0 },
            [year2]: { avgPrice: data2.AVG_PRICE || 0, totalSales: data2.TOTAL_SALES || 0 },
            priceChange: ((data2.AVG_PRICE - data1.AVG_PRICE) / (data1.AVG_PRICE || 1)) * 100
        };
    }
};

// ============================================================================
// FINANCIAL HEALTH & RISK TOOLS
// ============================================================================

const riskTools = {
    async getClientDebt(conn, clientCode) {
        // Get all pending invoices from CVC
        const debt = await safeQuery(conn, `
      SELECT 
        SUM(CASE WHEN IMPORTEPENDIENTE > 0 THEN IMPORTEPENDIENTE ELSE 0 END) as TOTAL_DEBT,
        SUM(CASE WHEN FECHAVENCIMIENTO < CURRENT DATE THEN IMPORTEPENDIENTE ELSE 0 END) as OVERDUE,
        COUNT(*) as NUM_INVOICES
      FROM DSEDAC.CVC
      WHERE CODIGOCLIENTEALBARAN = '${clientCode}' AND IMPORTEPENDIENTE > 0
    `);

        // Aging breakdown
        const aging = await safeQuery(conn, `
      SELECT 
        SUM(CASE WHEN DAYS(CURRENT DATE) - DAYS(FECHAVENCIMIENTO) BETWEEN 1 AND 30 THEN IMPORTEPENDIENTE ELSE 0 END) as DAYS_30,
        SUM(CASE WHEN DAYS(CURRENT DATE) - DAYS(FECHAVENCIMIENTO) BETWEEN 31 AND 60 THEN IMPORTEPENDIENTE ELSE 0 END) as DAYS_60,
        SUM(CASE WHEN DAYS(CURRENT DATE) - DAYS(FECHAVENCIMIENTO) BETWEEN 61 AND 90 THEN IMPORTEPENDIENTE ELSE 0 END) as DAYS_90,
        SUM(CASE WHEN DAYS(CURRENT DATE) - DAYS(FECHAVENCIMIENTO) > 90 THEN IMPORTEPENDIENTE ELSE 0 END) as DAYS_OVER_90
      FROM DSEDAC.CVC
      WHERE CODIGOCLIENTEALBARAN = '${clientCode}' AND IMPORTEPENDIENTE > 0
    `);

        const d = debt[0] || {};
        const a = aging[0] || {};

        return {
            clientCode,
            totalDebt: d.TOTAL_DEBT || 0,
            overdueDebt: d.OVERDUE || 0,
            numInvoices: d.NUM_INVOICES || 0,
            aging: {
                days_1_30: a.DAYS_30 || 0,
                days_31_60: a.DAYS_60 || 0,
                days_61_90: a.DAYS_90 || 0,
                days_over_90: a.DAYS_OVER_90 || 0
            },
            riskLevel: (d.OVERDUE || 0) > 5000 ? 'ALTO' : (d.OVERDUE || 0) > 1000 ? 'MEDIO' : 'BAJO'
        };
    },

    async getClientCreditLimit(conn, clientCode) {
        const client = await safeQuery(conn, `
      SELECT LIMITECREDITO, RIESGOACUMULADO
      FROM DSEDAC.CLI WHERE CODIGOCLIENTE = '${clientCode}'
      FETCH FIRST 1 ROWS ONLY
    `);

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
      FROM DSEDAC.CLI WHERE CODIGOCLIENTE = '${clientCode}'
      FETCH FIRST 1 ROWS ONLY
    `);

        const c = client[0] || {};
        return {
            clientCode,
            isBlocked: c.CLIENTEBLOQUEADO === 'S',
            blockReason: c.MOTIVOBLOQUEO?.trim() || 'Sin razón especificada'
        };
    },

    async calculateRiskScore(conn, clientCode) {
        const debt = await this.getClientDebt(conn, clientCode);
        const credit = await this.getClientCreditLimit(conn, clientCode);
        const blocked = await this.checkClientBlocked(conn, clientCode);

        let score = 100;
        let alerts = [];

        if (blocked.isBlocked) { score -= 50; alerts.push('⛔ Cliente BLOQUEADO'); }
        if (debt.overdueDebt > 5000) { score -= 30; alerts.push('🔴 Deuda vencida > 5000€'); }
        else if (debt.overdueDebt > 1000) { score -= 15; alerts.push('🟡 Deuda vencida > 1000€'); }
        if (credit.utilizationPercent > 90) { score -= 20; alerts.push('⚠️ Crédito utilizado > 90%'); }
        if (debt.aging.days_over_90 > 0) { score -= 25; alerts.push('🚨 Deuda > 90 días'); }

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
        // Products bought before but not recently
        const oldProducts = await safeQuery(conn, `
      SELECT DISTINCT L.CODIGOARTICULO, A.DESCRIPCIONARTICULO
      FROM DSEDAC.LAC L
      LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
      WHERE L.CODIGOCLIENTEALBARAN = '${clientCode}'
        AND L.ANODOCUMENTO = YEAR(CURRENT DATE) - 1
        AND L.CODIGOARTICULO NOT IN (
          SELECT DISTINCT CODIGOARTICULO FROM DSEDAC.LAC
          WHERE CODIGOCLIENTEALBARAN = '${clientCode}'
            AND (ANODOCUMENTO = YEAR(CURRENT DATE) 
              OR (ANODOCUMENTO = YEAR(CURRENT DATE) - 1 AND MESDOCUMENTO > MONTH(CURRENT DATE) - ${months}))
        )
      FETCH FIRST 20 ROWS ONLY
    `);

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

    async suggestCrossSell(conn, clientCode) {
        // Find products that similar clients buy but this one doesn't
        const suggestions = await safeQuery(conn, `
      SELECT L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, COUNT(*) as POPULARITY
      FROM DSEDAC.LAC L
      LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
      WHERE L.CODIGOVENDEDOR = (
        SELECT CODIGOVENDEDOR FROM DSEDAC.LAC 
        WHERE CODIGOCLIENTEALBARAN = '${clientCode}' 
        FETCH FIRST 1 ROWS ONLY
      )
      AND L.CODIGOARTICULO NOT IN (
        SELECT DISTINCT CODIGOARTICULO FROM DSEDAC.LAC
        WHERE CODIGOCLIENTEALBARAN = '${clientCode}'
      )
      AND L.ANODOCUMENTO >= YEAR(CURRENT DATE) - 1
      GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO
      ORDER BY POPULARITY DESC
      FETCH FIRST 10 ROWS ONLY
    `);

        return {
            clientCode,
            suggestions: suggestions.map(s => ({
                code: s.CODIGOARTICULO?.trim(),
                description: s.DESCRIPCIONARTICULO?.trim(),
                popularity: s.POPULARITY
            }))
        };
    },

    async getSeasonalTrends(conn, clientCode, quarter) {
        const currentYear = new Date().getFullYear();
        const lastYear = currentYear - 1;
        const startMonth = (quarter - 1) * 3 + 1;
        const endMonth = quarter * 3;

        const getData = async (year) => {
            const result = await safeQuery(conn, `
        SELECT SUM(IMPORTEVENTA) as SALES, COUNT(DISTINCT CODIGOARTICULO) as PRODUCTS
        FROM DSEDAC.LAC
        WHERE CODIGOCLIENTEALBARAN = '${clientCode}'
          AND ANODOCUMENTO = ${year}
          AND MESDOCUMENTO BETWEEN ${startMonth} AND ${endMonth}
      `);
            return result[0] || {};
        };

        const current = await getData(currentYear);
        const last = await getData(lastYear);

        return {
            clientCode,
            quarter: `Q${quarter}`,
            currentYear: { year: currentYear, sales: current.SALES || 0, products: current.PRODUCTS || 0 },
            lastYear: { year: lastYear, sales: last.SALES || 0, products: last.PRODUCTS || 0 },
            growth: last.SALES > 0 ? ((current.SALES - last.SALES) / last.SALES) * 100 : 0
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
        WHERE CODIGOCLIENTEALBARAN = '${clientCode}' AND ANODOCUMENTO = ${year}
      `);
            results[year] = { sales: data[0]?.SALES || 0, boxes: data[0]?.BOXES || 0 };
        }

        return { clientCode, yearlyData: results };
    },

    async getClientPurchaseHistory(conn, clientCode, limit = 20) {
        const history = await safeQuery(conn, `
      SELECT ANODOCUMENTO, MESDOCUMENTO, DIADOCUMENTO, 
             CODIGOARTICULO, DESCRIPCIONARTICULO,
             CANTIDADENVASES, IMPORTEVENTA, PRECIOVENTAUNITARIO
      FROM DSEDAC.LAC
      WHERE CODIGOCLIENTEALBARAN = '${clientCode}'
      ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC, DIADOCUMENTO DESC
      FETCH FIRST ${limit} ROWS ONLY
    `);

        return {
            clientCode,
            purchases: history.map(h => ({
                date: `${h.ANODOCUMENTO}-${String(h.MESDOCUMENTO).padStart(2, '0')}-${String(h.DIADOCUMENTO).padStart(2, '0')}`,
                product: h.CODIGOARTICULO?.trim(),
                description: h.DESCRIPCIONARTICULO?.trim(),
                quantity: h.CANTIDADENVASES,
                amount: h.IMPORTEVENTA,
                unitPrice: h.PRECIOVENTAUNITARIO
            }))
        };
    }
};

// ============================================================================
// LOGISTICS TOOLS
// ============================================================================

const logisticsTools = {
    async getStockByWarehouse(conn, productCode) {
        const stock = await safeQuery(conn, `
      SELECT CODIGOALMACEN, EXISTENCIAS
      FROM DSEDAC.ARTALM
      WHERE CODIGOARTICULO = '${productCode}'
    `);

        return {
            productCode,
            warehouses: stock.map(s => ({
                warehouse: s.CODIGOALMACEN?.trim(),
                stock: s.EXISTENCIAS || 0
            })),
            totalStock: stock.reduce((sum, s) => sum + (s.EXISTENCIAS || 0), 0)
        };
    },

    async getOrderStatus(conn, orderNumber) {
        const order = await safeQuery(conn, `
      SELECT NUMERODOCUMENTO, FECHAEMISION, ESTADOPEDIDO, CODIGOCLIENTE
      FROM DSEDAC.CABPEDIDO
      WHERE NUMERODOCUMENTO = '${orderNumber}'
      FETCH FIRST 1 ROWS ONLY
    `);

        return order[0] ? {
            orderNumber,
            date: order[0].FECHAEMISION,
            status: order[0].ESTADOPEDIDO?.trim(),
            clientCode: order[0].CODIGOCLIENTE?.trim()
        } : { error: 'Pedido no encontrado' };
    },

    async getDeliveryHistory(conn, clientCode, months = 12) {
        const deliveries = await safeQuery(conn, `
      SELECT COUNT(*) as TOTAL, 
             SUM(CASE WHEN FECHAENTREGA <= FECHAPREVISTA THEN 1 ELSE 0 END) as ON_TIME
      FROM DSEDAC.ENTREGAS
      WHERE CODIGOCLIENTE = '${clientCode}'
        AND FECHAENTREGA >= CURRENT DATE - ${months} MONTHS
    `);

        const d = deliveries[0] || {};
        return {
            clientCode,
            totalDeliveries: d.TOTAL || 0,
            onTimeDeliveries: d.ON_TIME || 0,
            onTimePercent: d.TOTAL > 0 ? (d.ON_TIME / d.TOTAL) * 100 : 0
        };
    }
};

module.exports = {
    dbDiscoveryTools,
    pricingTools,
    riskTools,
    commercialTools,
    logisticsTools
};
