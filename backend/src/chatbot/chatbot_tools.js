/**
 * Asistente GMP — Chatbot Tools (Production-Grade, All App Tabs)
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
const { extractPdfContent: runPdfExtraction } = require('./pdf_extractor');
const {
    buildClientVendorParamFilter,
    getVendorColumnExpr,
} = require('../../utils/common');

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
 * @param {string} [columnName='LCCDVD'] - The column name to filter on
 */
function _buildVendorFilter(vendorScope, userCode, columnName = 'LCCDVD') {
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

function formatDbDate(year, month, day) {
    if (!year || !month || !day) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildLaclaeVendorParamFilter(vendorCodes, alias = 'L') {
    if (!Array.isArray(vendorCodes) || vendorCodes.length === 0) {
        return { clause: '', params: [] };
    }
    const safeCodes = vendorCodes
        .map((code) => String(code || '').trim())
        .filter((code) => /^[a-zA-Z0-9]{1,10}$/.test(code));
    if (safeCodes.length === 0) {
        return { clause: '', params: [] };
    }
    const vendorColumn = getVendorColumnExpr(alias);
    return {
        clause: `AND TRIM(${vendorColumn}) IN (${safeCodes.map(() => '?').join(',')})`,
        params: safeCodes,
    };
}

function resolveVendorCodesForScope(vendorScope, userCode, isJefeVentas) {
    if (isJefeVentas || !vendorScope || vendorScope.includes('ALL')) {
        return [];
    }
    const codes = vendorScope.length ? vendorScope : [userCode];
    return codes
        .map((code) => String(code || '').trim())
        .filter((code) => /^[a-zA-Z0-9]{1,10}$/.test(code));
}

// ============================================================================
// DATABASE DISCOVERY TOOLS
// ============================================================================

const DISCOVERY_STOP_WORDS = new Set([
    'a', 'al', 'algo', 'articulo', 'articulos', 'busca', 'buscar', 'codigo',
    'con', 'dame', 'de', 'del', 'dime', 'el', 'en', 'la', 'las', 'le',
    'los', 'me', 'para', 'por', 'producto', 'productos', 'que', 'quiero',
    'referencia', 'sobre', 'un', 'una',
]);

function normalizeDiscoveryText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildProductSearchVariants(query) {
    const normalized = normalizeDiscoveryText(query);
    if (!normalized) return [];

    const tokens = normalized
        .split(' ')
        .filter((token) => token.length >= 2 && !DISCOVERY_STOP_WORDS.has(token));
    if (tokens.length === 0) return [];

    const compact = tokens.join(' ');
    const variants = [compact];

    const singularTokens = tokens.map((token) =>
        token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token
    );
    variants.push(singularTokens.join(' '));

    for (const token of tokens) {
        variants.push(token);
        if (token.length > 4 && token.endsWith('s')) variants.push(token.slice(0, -1));
        if (token.length >= 5) variants.push(token.slice(0, 3));
    }

    return [...new Set(variants.filter((variant) => variant.length >= 3))].slice(0, 6);
}

function buildClientSearchVariants(query) {
    const normalized = normalizeDiscoveryText(query);
    if (!normalized) return [];
    const tokens = normalized
        .split(' ')
        .filter((token) => token.length >= 2 && !DISCOVERY_STOP_WORDS.has(token));
    if (tokens.length === 0) return [];
    const variants = [tokens.join(' ')];
    for (const token of tokens) {
        variants.push(token);
        if (token.length >= 5) variants.push(token.slice(0, 4));
    }
    return [...new Set(variants.filter((variant) => variant.length >= 3))].slice(0, 6);
}

function scoreClientCandidate(query, client) {
    const normalizedQuery = normalizeDiscoveryText(query);
    const normalizedName = normalizeDiscoveryText(client.NOMBRE || client.name || '');
    const normalizedCode = normalizeDiscoveryText(client.CODIGO || client.code || '');
    const normalizedTown = normalizeDiscoveryText(client.POBLACION || client.town || '');
    const tokens = normalizedQuery
        .split(' ')
        .filter((token) => token.length >= 2 && !DISCOVERY_STOP_WORDS.has(token));
    let score = 0;
    if (normalizedCode === normalizedQuery) score += 120;
    if (normalizedName === normalizedQuery) score += 100;
    if (normalizedName.includes(normalizedQuery)) score += 60;
    if (normalizedCode.includes(normalizedQuery)) score += 45;
    for (const token of tokens) {
        if (normalizedName.includes(token)) score += 18;
        if (normalizedTown.includes(token)) score += 6;
        if (normalizedCode.includes(token)) score += 12;
    }
    return score;
}

async function searchClientsFlexibleRows(conn, query, limit = 20) {
    const variants = buildClientSearchVariants(query);
    if (variants.length === 0) return [];

    const rowLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 30);
    const clauses = variants
        .map(() => '(UPPER(TRIM(NOMBRECLIENTE)) LIKE ? OR UPPER(TRIM(CODIGOCLIENTE)) LIKE ? OR UPPER(TRIM(POBLACION)) LIKE ?)')
        .join(' OR ');
    const params = variants.flatMap((variant) => {
        const term = `%${variant.toUpperCase()}%`;
        return [term, term, term];
    });

    const rows = await safeQuery(conn, `
            SELECT TRIM(CODIGOCLIENTE) as CODIGO, TRIM(NOMBRECLIENTE) as NOMBRE,
                   TRIM(POBLACION) as POBLACION, TRIM(PROVINCIA) as PROVINCIA
            FROM DSEDAC.CLI
            WHERE ${clauses}
            ORDER BY NOMBRECLIENTE
            FETCH FIRST ${rowLimit} ROWS ONLY
        `, params);

    const seen = new Set();
    return rows
        .map((r) => ({
            CODIGO: r.CODIGO,
            NOMBRE: r.NOMBRE,
            POBLACION: r.POBLACION,
            PROVINCIA: r.PROVINCIA,
            score: scoreClientCandidate(query, r),
        }))
        .filter((client) => {
            const code = String(client.CODIGO || '').trim();
            if (!code || seen.has(code)) return false;
            seen.add(code);
            return true;
        })
        .sort((a, b) => b.score - a.score || String(a.NOMBRE).localeCompare(String(b.NOMBRE)))
        .slice(0, rowLimit);
}

function scoreProductCandidate(query, product) {
    const normalizedQuery = normalizeDiscoveryText(query);
    const normalizedName = normalizeDiscoveryText(product.NOMBRE || product.name || '');
    const normalizedCode = normalizeDiscoveryText(product.CODIGO || product.code || '');
    const tokens = normalizedQuery
        .split(' ')
        .filter((token) => token.length >= 2 && !DISCOVERY_STOP_WORDS.has(token));

    let score = 0;
    if (normalizedCode === normalizedQuery) score += 120;
    if (normalizedName === normalizedQuery) score += 100;
    if (normalizedName.includes(normalizedQuery)) score += 60;
    if (normalizedCode.includes(normalizedQuery)) score += 45;
    for (const token of tokens) {
        if (normalizedName.includes(token)) score += 18;
        if (normalizedCode.includes(token)) score += 12;
        if (token.length > 4 && normalizedName.includes(token.slice(0, -1))) score += 8;
    }
    return score;
}

async function searchProductsFlexibleRows(conn, query, limit = 20) {
    const variants = buildProductSearchVariants(query);
    if (variants.length === 0) return [];

    const rowLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 30);
    const clauses = variants
        .map(() => '(UPPER(TRIM(DESCRIPCIONARTICULO)) LIKE ? OR UPPER(TRIM(CODIGOARTICULO)) LIKE ?)')
        .join(' OR ');
    const params = variants.flatMap((variant) => {
        const term = `%${variant.toUpperCase()}%`;
        return [term, term];
    });

    const rows = await safeQuery(conn, `
            SELECT TRIM(CODIGOARTICULO) as CODIGO, TRIM(DESCRIPCIONARTICULO) as NOMBRE,
                   TRIM(CODIGOFAMILIA) as FAMILIA
            FROM DSEDAC.ART
            WHERE ${clauses}
            ORDER BY DESCRIPCIONARTICULO
            FETCH FIRST ${rowLimit} ROWS ONLY
        `, params);

    const seen = new Set();
    return rows
        .map((r) => ({
            CODIGO: r.CODIGO,
            NOMBRE: r.NOMBRE,
            FAMILIA: r.FAMILIA,
            score: scoreProductCandidate(query, r),
        }))
        .filter((product) => {
            const code = String(product.CODIGO || '').trim();
            if (!code || seen.has(code)) return false;
            seen.add(code);
            return true;
        })
        .sort((a, b) => b.score - a.score || String(a.NOMBRE).localeCompare(String(b.NOMBRE)))
        .slice(0, rowLimit);
}

const dbDiscoveryTools = {
    async searchClients(conn, query) {
        return searchClientsFlexibleRows(conn, query, 20);
    },

    async searchClientsFlexible(conn, query, limit = 20) {
        return searchClientsFlexibleRows(conn, query, limit);
    },

    async searchProducts(conn, query) {
        return searchProductsFlexibleRows(conn, query, 20);
    },

    async searchProductsFlexible(conn, query, limit = 20) {
        return searchProductsFlexibleRows(conn, query, limit);
    },

    async lookupClient(conn, clientCode) {
        const rows = await safeQuery(conn, `
            SELECT TRIM(C.CODIGOCLIENTE) as CODIGO, TRIM(C.NOMBRECLIENTE) as NOMBRE,
                   TRIM(C.DIRECCION) as DIRECCION, TRIM(C.POBLACION) as POBLACION,
                   TRIM(C.PROVINCIA) as PROVINCIA,
                   TRIM(P.VENDEDORCOMERCIAL) as VENDEDOR
            FROM DSEDAC.CLI C
            LEFT JOIN DSEDAC.CLP P ON C.CODIGOCLIENTE = P.CODIGOCLIENTE
            WHERE TRIM(C.CODIGOCLIENTE) = ?
            FETCH FIRST 1 ROWS ONLY
        `, [clientCode]);
        if (rows.length === 0) return null;
        const r = rows[0];
        return {
            CODIGO: r.CODIGO, NOMBRE: r.NOMBRE, DIRECCION: r.DIRECCION,
            POBLACION: r.POBLACION, PROVINCIA: r.PROVINCIA,
            VENDEDOR: r.VENDEDOR
        };
    },

    async lookupProduct(conn, productCode) {
        const rows = await safeQuery(conn, `
            SELECT TRIM(CODIGOARTICULO) as CODIGO, TRIM(DESCRIPCIONARTICULO) as NOMBRE,
                   TRIM(CODIGOFAMILIA) as FAMILIA, 0 as PRECIO
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
            SELECT A.CODIGOARTICULO, A.DESCRIPCIONARTICULO, COALESCE((SELECT L.PRECIOVENTA FROM DSEDAC.LAC L WHERE TRIM(L.CODIGOARTICULO) = TRIM(A.CODIGOARTICULO) AND L.PRECIOVENTA > 0 ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC FETCH FIRST 1 ROW ONLY), 0) AS PRECIOVENTA,
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
            SELECT PRECIOVENTA, TRIM(CODIGOCLIENTEALBARAN) as CLIENTE,
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
            lastSoldPrice: parseFloat(lastSale[0]?.PRECIOVENTA) || 0,
            lastSoldTo: lastSale[0]?.CLIENTE
        };
    },

    async calculateBreakeven(conn, productCode) {
        const art = await safeQuery(conn, `
            SELECT COALESCE((SELECT L.PRECIOVENTA FROM DSEDAC.LAC L WHERE TRIM(L.CODIGOARTICULO) = TRIM(A.CODIGOARTICULO) AND L.PRECIOVENTA > 0 ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC FETCH FIRST 1 ROW ONLY), 0) AS PRECIOVENTA,
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
            SELECT COALESCE((SELECT L.PRECIOVENTA FROM DSEDAC.LAC L WHERE TRIM(L.CODIGOARTICULO) = TRIM(A.CODIGOARTICULO) AND L.PRECIOVENTA > 0 ORDER BY L.ANODOCUMENTO DESC, L.MESDOCUMENTO DESC, L.DIADOCUMENTO DESC FETCH FIRST 1 ROW ONLY), 0) AS PRECIOVENTA,
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
            SELECT RIESGOACUMULADO
            FROM DSEDAC.CLI WHERE TRIM(CODIGOCLIENTE) = ?
            FETCH FIRST 1 ROWS ONLY
        `, [clientCode]);

        const c = client[0] || {};
        const limit = 0;
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
                   CANTIDADENVASES, IMPORTEVENTA, PRECIOVENTA
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
                unitPrice: parseFloat(h.PRECIOVENTA) || 0
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
                SELECT TRIM(A.CODIGOFAMILIA) as FAMILIA, SUM(L.IMPORTEVENTA) as VENTAS
                FROM DSEDAC.LAC L
                LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
                WHERE L.ANODOCUMENTO = ? AND L.MESDOCUMENTO = ?
                  ${vendorFilter.sql}
                  AND TRIM(A.CODIGOFAMILIA) = ?
                GROUP BY A.CODIGOFAMILIA
            `;
            params = [currentYear, currentMonth, ...vendorFilter.params, familyCode];
        } else {
            sql = `
                SELECT TRIM(A.CODIGOFAMILIA) as FAMILIA, SUM(L.IMPORTEVENTA) as VENTAS
                FROM DSEDAC.LAC L
                LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
                WHERE L.ANODOCUMENTO = ? AND L.MESDOCUMENTO = ?
                  ${vendorFilter.sql}
                GROUP BY A.CODIGOFAMILIA
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
// INVOICE & ALBARAN TOOLS (CFC/CAC/LAC — same model as facturas.service)
// ============================================================================

function parseInvoiceRef(invoiceNumber) {
    const raw = String(invoiceNumber || '').trim();
    if (!raw) return null;

    const structured = raw.match(/^([A-Za-z0-9]{1,3})[\/\-\s]+(\d{1,8})[\/\-\s]+(\d{4})$/);
    if (structured) {
        return {
            serie: structured[1].toUpperCase(),
            numero: parseInt(structured[2], 10),
            ejercicio: parseInt(structured[3], 10),
        };
    }

    const digitsOnly = raw.replace(/[^\d]/g, '');
    if (!digitsOnly) return null;
    return {
        serie: null,
        numero: parseInt(digitsOnly, 10),
        ejercicio: new Date().getFullYear(),
    };
}

async function fetchCfcInvoiceHeader(conn, ref) {
    if (!ref || !Number.isFinite(ref.numero) || !Number.isFinite(ref.ejercicio)) {
        return null;
    }
    if (ref.numero >= 900000 || ref.numero <= 0) {
        return null;
    }

    const params = [ref.numero, ref.ejercicio];
    let sql = `
        SELECT TRIM(CFC.SERIEFACTURA) AS SERIE,
               CFC.NUMEROFACTURA AS NUMERO,
               CFC.EJERCICIOFACTURA AS EJERCICIO,
               TRIM(CFC.CODIGOCLIENTE) AS CLIENTE,
               CFC.IMPORTETOTAL AS IMPORTE,
               CFC.DIADOCUMENTO AS DIA,
               CFC.MESDOCUMENTO AS MES,
               CFC.ANODOCUMENTO AS ANO
        FROM DSEDAC.CFC CFC
        WHERE CFC.NUMEROFACTURA = ?
          AND CFC.EJERCICIOFACTURA = ?
          AND CFC.NUMEROFACTURA > 0
          AND CFC.NUMEROFACTURA < 900000
    `;
    if (ref.serie) {
        sql += ' AND TRIM(CFC.SERIEFACTURA) = ?';
        params.push(ref.serie);
    }
    sql += ' FETCH FIRST 1 ROW ONLY';

    const rows = await safeQuery(conn, sql, params);
    return rows[0] || null;
}

function parseAlbaranRef(albaranNumber) {
    const raw = String(albaranNumber || '').trim();
    if (!raw) return null;

    const structured = raw.match(/^(\d{4})[\/\-\s]+([A-Za-z0-9]{1,3})[\/\-\s]+(\d{1,2})[\/\-\s]+(\d{1,8})$/);
    if (structured) {
        return {
            ejercicio: parseInt(structured[1], 10),
            serie: structured[2].toUpperCase(),
            terminal: parseInt(structured[3], 10),
            numero: parseInt(structured[4], 10),
        };
    }

    const digitsOnly = raw.replace(/[^\d]/g, '');
    if (!digitsOnly) return null;
    return {
        ejercicio: new Date().getFullYear(),
        serie: null,
        terminal: null,
        numero: parseInt(digitsOnly, 10),
    };
}

async function fetchAlbaranHeader(conn, ref) {
    if (!ref || !Number.isFinite(ref.numero) || ref.numero <= 0) {
        return null;
    }

    const params = [ref.numero];
    let sql = `
        SELECT CAC.EJERCICIOALBARAN AS EJERCICIO,
               TRIM(CAC.SERIEALBARAN) AS SERIE,
               CAC.TERMINALALBARAN AS TERMINAL,
               CAC.NUMEROALBARAN AS NUMERO,
               TRIM(CAC.CODIGOCLIENTEALBARAN) AS CLIENTE,
               COALESCE(CAC.IMPORTETOTAL, 0) AS IMPORTE,
               CAC.ANODOCUMENTO AS ANO,
               CAC.MESDOCUMENTO AS MES,
               CAC.DIADOCUMENTO AS DIA
        FROM DSEDAC.CAC CAC
        WHERE CAC.NUMEROALBARAN = ?
    `;
    if (Number.isFinite(ref.ejercicio)) {
        sql += ' AND CAC.EJERCICIOALBARAN = ?';
        params.push(ref.ejercicio);
    }
    if (ref.serie) {
        sql += ' AND TRIM(CAC.SERIEALBARAN) = ?';
        params.push(ref.serie);
    }
    if (Number.isFinite(ref.terminal)) {
        sql += ' AND CAC.TERMINALALBARAN = ?';
        params.push(ref.terminal);
    }
    sql += ' ORDER BY CAC.ANODOCUMENTO DESC, CAC.MESDOCUMENTO DESC, CAC.DIADOCUMENTO DESC FETCH FIRST 1 ROW ONLY';

    const rows = await safeQuery(conn, sql, params);
    return rows[0] || null;
}

const invoiceTools = {
    async resolveInvoiceClientCode(conn, invoiceNumber) {
        const ref = parseInvoiceRef(invoiceNumber);
        if (ref) {
            const header = await fetchCfcInvoiceHeader(conn, ref);
            if (header?.CLIENTE) {
                return String(header.CLIENTE).trim();
            }
        }

        const rows = await safeQuery(conn, `
            SELECT TRIM(CODIGOCLIENTEALBARAN) AS CLIENTE
            FROM DSEDAC.CVC
            WHERE TRIM(CHAR(NUMERODOCUMENTO)) = ?
            FETCH FIRST 1 ROW ONLY
        `, [String(invoiceNumber || '').trim()]);

        if (rows.length > 0 && rows[0].CLIENTE) {
            return String(rows[0].CLIENTE).trim();
        }
        return null;
    },

    async getInvoiceDetails(conn, invoiceNumber, userCode, isJefeVentas, vendorScope) {
        const ref = parseInvoiceRef(invoiceNumber);
        if (!ref) {
            return { error: `Referencia de factura invalida: ${invoiceNumber}` };
        }

        const header = await fetchCfcInvoiceHeader(conn, ref);
        if (!header) {
            return { error: `Factura ${invoiceNumber} no encontrada o sin permiso` };
        }

        const serie = String(header.SERIE || ref.serie || '').trim();
        const numero = header.NUMERO;
        const ejercicio = header.EJERCICIO;
        const clientCode = String(header.CLIENTE || '').trim();

        const lines = await safeQuery(conn, `
            SELECT TRIM(LAC.CODIGOARTICULO) AS CODIGO,
                   TRIM(LAC.DESCRIPCION) AS DESCRIPCION,
                   LAC.CANTIDADUNIDADES AS CANTIDAD,
                   LAC.PRECIOVENTA AS PRECIO,
                   LAC.IMPORTEVENTA AS IMPORTE,
                   LAC.NUMEROALBARAN AS ALBARAN,
                   LAC.ANODOCUMENTO, LAC.MESDOCUMENTO, LAC.DIADOCUMENTO
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.LAC LAC
              ON LAC.SUBEMPRESAALBARAN = CAC.SUBEMPRESAALBARAN
             AND LAC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
             AND LAC.SERIEALBARAN = CAC.SERIEALBARAN
             AND LAC.TERMINALALBARAN = CAC.TERMINALALBARAN
             AND LAC.NUMEROALBARAN = CAC.NUMEROALBARAN
            WHERE CAC.NUMEROFACTURA = ?
              AND TRIM(CAC.SERIEFACTURA) = ?
              AND CAC.EJERCICIOFACTURA = ?
            ORDER BY LAC.SECUENCIA
            FETCH FIRST 50 ROWS ONLY
        `, [numero, serie, ejercicio]);

        const pendingRows = await safeQuery(conn, `
            SELECT COALESCE(SUM(C.IMPORTEPENDIENTE), 0) AS PENDIENTE
            FROM DSEDAC.CVC C
            WHERE TRIM(C.CODIGOCLIENTEALBARAN) = ?
              AND TRIM(CHAR(C.NUMERODOCUMENTO)) = ?
              AND (C.ANULADOSN IS NULL OR C.ANULADOSN <> 'S')
        `, [clientCode, String(numero)]);

        return {
            invoiceNumber: `${serie}/${numero}/${ejercicio}`,
            serie,
            numero,
            ejercicio,
            clientCode,
            amount: parseFloat(header.IMPORTE) || 0,
            pendingAmount: parseFloat(pendingRows[0]?.PENDIENTE) || 0,
            status: 'Facturada',
            issueDate: formatDbDate(header.ANO, header.MES, header.DIA),
            dueDate: null,
            pdfPath: `/api/facturas/${serie}/${numero}/${ejercicio}/pdf`,
            lineCount: lines.length,
            lines: lines.map((line) => ({
                productCode: line.CODIGO,
                description: line.DESCRIPCION?.trim(),
                quantity: parseFloat(line.CANTIDAD) || 0,
                unitPrice: parseFloat(line.PRECIO) || 0,
                amount: parseFloat(line.IMPORTE) || 0,
                albaranNumber: line.ALBARAN,
                date: `${line.DIADOCUMENTO || ''}/${line.MESDOCUMENTO || ''}/${line.ANODOCUMENTO || ''}`.replace(/^\/+|\/+$/g, '') || null,
            })),
        };
    },

    async getAlbaranesByInvoice(conn, invoiceNumber, userCode, isJefeVentas, vendorScope) {
        const ref = parseInvoiceRef(invoiceNumber);
        if (!ref) {
            return { error: `Referencia de factura invalida: ${invoiceNumber}` };
        }

        const header = await fetchCfcInvoiceHeader(conn, ref);
        if (!header) {
            return { error: `Factura ${invoiceNumber} no encontrada o sin permiso` };
        }

        const serie = String(header.SERIE || ref.serie || '').trim();
        const clientCode = String(header.CLIENTE || '').trim();
        const rows = await safeQuery(conn, `
            SELECT CAC.NUMEROALBARAN AS NUMERO,
                   SUM(COALESCE(LAC.IMPORTEVENTA, 0)) AS IMPORTE,
                   MAX(LAC.ANODOCUMENTO) AS ANO,
                   MAX(LAC.MESDOCUMENTO) AS MES,
                   MAX(LAC.DIADOCUMENTO) AS DIA
            FROM DSEDAC.CAC CAC
            LEFT JOIN DSEDAC.LAC LAC
              ON LAC.SUBEMPRESAALBARAN = CAC.SUBEMPRESAALBARAN
             AND LAC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
             AND LAC.SERIEALBARAN = CAC.SERIEALBARAN
             AND LAC.TERMINALALBARAN = CAC.TERMINALALBARAN
             AND LAC.NUMEROALBARAN = CAC.NUMEROALBARAN
            WHERE CAC.NUMEROFACTURA = ?
              AND TRIM(CAC.SERIEFACTURA) = ?
              AND CAC.EJERCICIOFACTURA = ?
            GROUP BY CAC.NUMEROALBARAN
            ORDER BY ANO DESC, MES DESC, DIA DESC
            FETCH FIRST 20 ROWS ONLY
        `, [header.NUMERO, serie, header.EJERCICIO]);

        return {
            invoiceNumber: `${serie}/${header.NUMERO}/${header.EJERCICIO}`,
            clientCode,
            albaranes: rows.map((r) => ({
                number: r.NUMERO,
                clientCode,
                amount: parseFloat(r.IMPORTE) || 0,
                date: `${r.DIA || ''}/${r.MES || ''}/${r.ANO || ''}`.replace(/^\/+|\/+$/g, '') || null,
            })),
        };
    },

    async getClientInvoices(conn, clientCode) {
        const rows = await safeQuery(conn, `
            SELECT TRIM(NUMERODOCUMENTO) as NUMERO, IMPORTEPENDIENTE as IMPORTE,
                   ANOVENCIMIENTO, MESVENCIMIENTO, DIAVENCIMIENTO, SITUACION
            FROM DSEDAC.CVC
            WHERE TRIM(CODIGOCLIENTEALBARAN) = ? AND IMPORTEPENDIENTE > 0
            ORDER BY ANOVENCIMIENTO ASC, MESVENCIMIENTO ASC, DIAVENCIMIENTO ASC
            FETCH FIRST 50 ROWS ONLY
        `, [clientCode]);

        const totalAmount = rows.reduce((sum, r) => sum + (parseFloat(r.IMPORTE) || 0), 0);

        return {
            clientCode,
            invoices: rows.map(r => ({
                number: r.NUMERO,
                amount: parseFloat(r.IMPORTE) || 0,
                dueDate: `${r.DIAVENCIMIENTO || ''}/${r.MESVENCIMIENTO || ''}/${r.ANOVENCIMIENTO || ''}`.replace(/^\/+|\/+$/g, '') || null,
                status: r.SITUACION?.trim() || 'Pendiente'
            })),
            totalAmount: Math.round(totalAmount * 100) / 100
        };
    },

    async getInvoicePdfInfo(conn, invoiceNumber) {
        const ref = parseInvoiceRef(invoiceNumber);
        if (!ref) {
            return { error: `Referencia de factura invalida: ${invoiceNumber}` };
        }

        const header = await fetchCfcInvoiceHeader(conn, ref);
        if (!header) {
            return { error: `Factura ${invoiceNumber} no encontrada o sin permiso` };
        }

        const serie = String(header.SERIE || ref.serie || '').trim();
        const numero = header.NUMERO;
        const ejercicio = header.EJERCICIO;

        return {
            invoiceNumber: `${serie}/${numero}/${ejercicio}`,
            serie,
            numero,
            ejercicio,
            clientCode: String(header.CLIENTE || '').trim(),
            amount: parseFloat(header.IMPORTE) || 0,
            issueDate: formatDbDate(header.ANO, header.MES, header.DIA),
            pdfPath: `/api/facturas/${serie}/${numero}/${ejercicio}/pdf`,
            appHint: 'En la app: Facturas > selecciona la factura > icono PDF.',
        };
    },

    async resolveAlbaranClientCode(conn, albaranNumber) {
        const ref = parseAlbaranRef(albaranNumber);
        if (!ref) return null;
        const header = await fetchAlbaranHeader(conn, ref);
        if (!header?.CLIENTE) return null;
        return String(header.CLIENTE).trim();
    },

    async getAlbaranPdfInfo(conn, albaranNumber) {
        const ref = parseAlbaranRef(albaranNumber);
        if (!ref) {
            return { error: `Referencia de albaran invalida: ${albaranNumber}` };
        }

        const header = await fetchAlbaranHeader(conn, ref);
        if (!header) {
            return { error: `Albaran ${albaranNumber} no encontrado` };
        }

        const ejercicio = header.EJERCICIO;
        const serie = String(header.SERIE || ref.serie || '').trim();
        const terminal = header.TERMINAL ?? ref.terminal ?? 0;
        const numero = header.NUMERO;

        return {
            albaranNumber: `${ejercicio}/${serie}/${terminal}/${numero}`,
            ejercicio,
            serie,
            terminal,
            numero,
            clientCode: String(header.CLIENTE || '').trim(),
            amount: parseFloat(header.IMPORTE) || 0,
            issueDate: formatDbDate(header.ANO, header.MES, header.DIA),
            pdfPath: `/api/repartidor/document/albaran/${ejercicio}/${serie}/${terminal}/${numero}/pdf`,
            appHint: 'En la app: abre el albaran en Repartidor o Facturas y pulsa Ver PDF.',
        };
    },

    async getRecentInvoices(conn, userCode, isJefeVentas, vendorScope, limit = 10) {
        const vendorFilter = _buildVendorFilter(vendorScope, userCode, 'CFC.CODIGOVENDEDOR');
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;
        const currentDay = new Date().getDate();

        const rows = await safeQuery(conn, `
            SELECT TRIM(CFC.SERIEFACTURA) AS SERIE,
                   CFC.NUMEROFACTURA AS NUMERO,
                   CFC.EJERCICIOFACTURA AS EJERCICIO,
                   TRIM(CFC.CODIGOCLIENTE) AS CLIENTE,
                   CFC.IMPORTETOTAL AS IMPORTE,
                   CFC.DIADOCUMENTO AS DIA,
                   CFC.MESDOCUMENTO AS MES,
                   CFC.ANODOCUMENTO AS ANO
            FROM DSEDAC.CFC CFC
            WHERE CFC.ANODOCUMENTO = ?
              AND CFC.MESDOCUMENTO = ?
              AND CFC.DIADOCUMENTO = ?
              AND CFC.NUMEROFACTURA > 0
              AND CFC.NUMEROFACTURA < 900000
              ${vendorFilter.sql.replace(/LCCDVD/g, 'CFC.CODIGOVENDEDOR')}
            ORDER BY CFC.IMPORTETOTAL DESC
            FETCH FIRST ? ROWS ONLY
        `, [currentYear, currentMonth, currentDay, ...vendorFilter.params, limit]);

        const totalAmount = rows.reduce((sum, row) => sum + (parseFloat(row.IMPORTE) || 0), 0);

        return {
            date: formatDbDate(currentYear, currentMonth, currentDay),
            count: rows.length,
            totalAmount: Math.round(totalAmount * 100) / 100,
            invoices: rows.map((row) => ({
                invoiceNumber: `${String(row.SERIE || '').trim()}/${row.NUMERO}/${row.EJERCICIO}`,
                serie: String(row.SERIE || '').trim(),
                numero: row.NUMERO,
                ejercicio: row.EJERCICIO,
                clientCode: String(row.CLIENTE || '').trim(),
                amount: parseFloat(row.IMPORTE) || 0,
                issueDate: formatDbDate(row.ANO, row.MES, row.DIA),
                pdfPath: `/api/facturas/${String(row.SERIE || '').trim()}/${row.NUMERO}/${row.EJERCICIO}/pdf`,
            })),
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
            SELECT COUNT(*) AS TOTAL_ORDERS,
                   COUNT(DISTINCT CPC.CODIGOCLIENTEALBARAN) AS TOTAL_CLIENTS,
                   COALESCE(SUM(CPC.IMPORTETOTAL), 0) AS TOTAL_AMOUNT
            FROM DSEDAC.CPC CPC
            WHERE CPC.ANODOCUMENTO = ?
              AND CPC.MESDOCUMENTO = ?
              AND CPC.DIADOCUMENTO = ?
              ${vendorFilter.sql.replace(/LCCDVD/g, 'CPC.CODIGOVENDEDOR')}
        `;
        const params = [currentYear, currentMonth, currentDay, ...vendorFilter.params];

        const result = await safeQuery(conn, sql, params);
        const r = result[0] || {};

        return {
            year: currentYear,
            month: currentMonth,
            day: currentDay,
            totalOrders: parseInt(r.TOTAL_ORDERS) || 0,
            totalClients: parseInt(r.TOTAL_CLIENTS) || 0,
            totalAmount: parseFloat(r.TOTAL_AMOUNT) || 0,
            orders: [],
        };
    },

    async getClientOrders(conn, clientCode, userCode, isJefeVentas, limit = 10, vendorScope) {
        const vendorFilter = _buildVendorFilter(vendorScope, userCode, 'CPC.CODIGOVENDEDOR');

        const sql = `
            SELECT CPC.ANODOCUMENTO, CPC.MESDOCUMENTO, CPC.DIADOCUMENTO,
                   TRIM(CPC.NUMEROPEDIDO) AS ORDER_NUM,
                   CPC.NUMEROALBARAN,
                   CPC.IMPORTETOTAL AS AMOUNT,
                   TRIM(CPC.SITUACIONALBARAN) AS ESTADO
            FROM DSEDAC.CPC CPC
            WHERE TRIM(CPC.CODIGOCLIENTEALBARAN) = ?
              ${vendorFilter.sql}
            ORDER BY CPC.ANODOCUMENTO DESC, CPC.MESDOCUMENTO DESC, CPC.DIADOCUMENTO DESC
            FETCH FIRST ? ROWS ONLY
        `;
        const params = [clientCode, ...vendorFilter.params, limit];

        const rows = await safeQuery(conn, sql, params);
        return {
            clientCode,
            orders: rows.map((r) => ({
                orderNumber: r.ORDER_NUM,
                albaranNumber: r.NUMEROALBARAN,
                date: formatDbDate(r.ANODOCUMENTO, r.MESDOCUMENTO, r.DIADOCUMENTO),
                amount: parseFloat(r.AMOUNT) || 0,
                status: r.ESTADO?.trim() || 'Confirmado',
            })),
        };
    },

    async resolveOrderClientCode(conn, orderNumber) {
        const normalized = String(orderNumber || '').trim();
        const digits = normalized.replace(/[^\d]/g, '');
        const rows = await safeQuery(conn, `
            SELECT TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE
            FROM DSEDAC.CPC CPC
            WHERE (TRIM(CHAR(CPC.NUMEROPEDIDO)) = ? OR TRIM(CHAR(CPC.NUMEROPEDIDO)) = ?)
            FETCH FIRST 1 ROW ONLY
        `, [normalized, digits]);
        if (rows.length > 0 && rows[0].CLIENTE) {
            return String(rows[0].CLIENTE).trim();
        }
        return null;
    },

    async getOrderDetails(conn, orderNumber, userCode, isJefeVentas, vendorScope) {
        const vendorFilter = _buildVendorFilter(vendorScope, userCode, 'CPC.CODIGOVENDEDOR');
        const normalized = String(orderNumber || '').trim();
        const digits = normalized.replace(/[^\d]/g, '');

        const headerRows = await safeQuery(conn, `
            SELECT CPC.ANODOCUMENTO, CPC.MESDOCUMENTO, CPC.DIADOCUMENTO,
                   TRIM(CPC.NUMEROPEDIDO) AS PEDIDO,
                   TRIM(CPC.CODIGOCLIENTEALBARAN) AS CLIENTE,
                   CPC.IMPORTETOTAL,
                   TRIM(CPC.SITUACIONALBARAN) AS ESTADO,
                   CPC.NUMEROALBARAN,
                   CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN,
                   CPC.SERIEALBARAN, CPC.TERMINALALBARAN
            FROM DSEDAC.CPC CPC
            WHERE (TRIM(CHAR(CPC.NUMEROPEDIDO)) = ? OR TRIM(CHAR(CPC.NUMEROPEDIDO)) = ?)
              ${vendorFilter.sql}
            FETCH FIRST 1 ROW ONLY
        `, [normalized, digits, ...vendorFilter.params]);

        if (headerRows.length === 0) {
            return { error: `Pedido ${orderNumber} no encontrado` };
        }

        const h = headerRows[0];
        const lines = await safeQuery(conn, `
            SELECT TRIM(LAC.CODIGOARTICULO) AS CODIGO,
                   TRIM(LAC.DESCRIPCION) AS DESCRIPCION,
                   LAC.CANTIDADENVASES,
                   LAC.PRECIOVENTA,
                   LAC.IMPORTEVENTA
            FROM DSEDAC.LAC LAC
            WHERE LAC.SUBEMPRESAALBARAN = ?
              AND LAC.EJERCICIOALBARAN = ?
              AND LAC.SERIEALBARAN = ?
              AND LAC.TERMINALALBARAN = ?
              AND LAC.NUMEROALBARAN = ?
            ORDER BY LAC.SECUENCIA
        `, [
            h.SUBEMPRESAALBARAN,
            h.EJERCICIOALBARAN,
            h.SERIEALBARAN,
            h.TERMINALALBARAN,
            h.NUMEROALBARAN,
        ]);

        return {
            orderNumber: h.PEDIDO,
            clientCode: h.CLIENTE?.trim() || null,
            date: formatDbDate(h.ANODOCUMENTO, h.MESDOCUMENTO, h.DIADOCUMENTO),
            amount: parseFloat(h.IMPORTETOTAL) || 0,
            status: h.ESTADO?.trim() || 'Confirmado',
            albaranNumber: h.NUMEROALBARAN,
            lineCount: lines.length,
            lines: lines.map((line) => ({
                productCode: line.CODIGO,
                description: line.DESCRIPCION,
                quantity: parseFloat(line.CANTIDADENVASES) || 0,
                unitPrice: parseFloat(line.PRECIOVENTA) || 0,
                amount: parseFloat(line.IMPORTEVENTA) || 0,
            })),
        };
    },
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
            SELECT PRECIOVENTA, IMPORTEVENTA, CANTIDADENVASES,
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
                price: parseFloat(r.PRECIOVENTA) || 0,
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
                   AVG(PRECIOVENTA) as PRECIO_MEDIO, COUNT(*) as LINEAS
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
                   TRIM(A.CODIGOFAMILIA) as FAMILIA,
                   SUM(L.IMPORTEVENTA) as TOTAL, SUM(L.CANTIDADENVASES) as UNIDADES,
                   AVG(L.PRECIOVENTA) as PRECIO_MEDIO
            FROM DSEDAC.LAC L
            LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
            WHERE TRIM(L.CODIGOCLIENTEALBARAN) = ?
            GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, A.CODIGOFAMILIA
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

    async getClientEvaluation(conn, clientCode, userCode, isJefeVentas, vendorScope) {
        const normalizedClient = String(clientCode || '').trim();
        if (!normalizedClient) {
            return { error: 'clientCode requerido' };
        }

        const vendorCodes = resolveVendorCodesForScope(vendorScope, userCode, isJefeVentas);
        const clientVendorFilter = buildClientVendorParamFilter(
            vendorCodes.length ? vendorCodes : null,
            'CLI'
        );

        const clientCheck = await safeQuery(conn, `
            SELECT 1 AS OK
            FROM DSEDAC.CLI CLI
            WHERE TRIM(CLI.CODIGOCLIENTE) = ?
              ${clientVendorFilter.clause}
            FETCH FIRST 1 ROWS ONLY
        `, [normalizedClient, ...clientVendorFilter.params]);

        if (clientCheck.length === 0) {
            return {
                error: 'Cliente no encontrado o sin permiso',
                clientCode: normalizedClient,
            };
        }

        const currentYear = new Date().getFullYear();
        const startYear = currentYear - 2;
        const laclaeVendorFilter = buildLaclaeVendorParamFilter(vendorCodes, 'L');
        const saleTypes = ['CC', 'VC'];
        const saleLines = ['AB', 'VT'];

        const monthlyRows = await safeQuery(conn, `
            SELECT L.LCAADC AS YEAR, L.LCMMDC AS MONTH,
                   SUM(L.LCIMVT) AS SALES, SUM(L.LCCTUD) AS UNITS
            FROM DSED.LACLAE L
            WHERE TRIM(L.LCCDCL) = ? AND L.LCAADC >= ?
              AND L.LCTPVT IN (?, ?) AND L.LCCLLN IN (?, ?)
              ${laclaeVendorFilter.clause}
            GROUP BY L.LCAADC, L.LCMMDC
            ORDER BY L.LCAADC ASC, L.LCMMDC ASC
        `, [
            normalizedClient,
            startYear,
            saleTypes[0],
            saleTypes[1],
            saleLines[0],
            saleLines[1],
            ...laclaeVendorFilter.params,
        ]);

        const topProductsRows = await safeQuery(conn, `
            SELECT TRIM(L.LCCDRF) AS CODE, TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   SUM(L.LCIMVT) AS TOTAL_SALES, SUM(L.LCCTUD) AS TOTAL_UNITS
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO
            WHERE TRIM(L.LCCDCL) = ? AND L.LCAADC >= ?
              AND L.LCTPVT IN (?, ?) AND L.LCCLLN IN (?, ?)
              ${laclaeVendorFilter.clause}
            GROUP BY TRIM(L.LCCDRF), TRIM(A.DESCRIPCIONARTICULO)
            ORDER BY TOTAL_SALES DESC
            FETCH FIRST 20 ROWS ONLY
        `, [
            normalizedClient,
            currentYear - 1,
            saleTypes[0],
            saleTypes[1],
            saleLines[0],
            saleLines[1],
            ...laclaeVendorFilter.params,
        ]);

        const returnsRows = await safeQuery(conn, `
            SELECT L.LCAADC AS YEAR, L.LCMMDC AS MONTH,
                   TRIM(L.LCCDRF) AS PRODUCT_CODE, TRIM(A.DESCRIPCIONARTICULO) AS PRODUCT_NAME,
                   SUM(L.LCCTUD) AS UNITS, SUM(L.LCIMVT) AS AMOUNT
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.ART A ON L.LCCDRF = A.CODIGOARTICULO
            WHERE TRIM(L.LCCDCL) = ? AND L.LCAADC >= ?
              AND (L.LCSRAB = 'D' OR L.LCTPVT = 'DV')
              ${laclaeVendorFilter.clause}
            GROUP BY L.LCAADC, L.LCMMDC, TRIM(L.LCCDRF), TRIM(A.DESCRIPCIONARTICULO)
            ORDER BY YEAR DESC, MONTH DESC, AMOUNT DESC
            FETCH FIRST 50 ROWS ONLY
        `, [normalizedClient, startYear, ...laclaeVendorFilter.params]);

        return {
            clientCode: normalizedClient,
            years: [startYear, startYear + 1, currentYear],
            monthlySales: monthlyRows.map((row) => ({
                year: row.YEAR,
                month: row.MONTH,
                sales: parseFloat(row.SALES) || 0,
                units: parseFloat(row.UNITS) || 0,
            })),
            topProducts: topProductsRows.map((row) => ({
                code: row.CODE,
                name: row.NAME,
                totalSales: parseFloat(row.TOTAL_SALES) || 0,
                totalUnits: parseFloat(row.TOTAL_UNITS) || 0,
            })),
            returns: returnsRows.map((row) => ({
                year: row.YEAR,
                month: row.MONTH,
                productCode: row.PRODUCT_CODE,
                productName: row.PRODUCT_NAME,
                units: parseFloat(row.UNITS) || 0,
                amount: parseFloat(row.AMOUNT) || 0,
            })),
            source: 'DSED.LACLAE',
            appSection: 'Pedidos > Evolución',
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
        const vendorFilter = _buildVendorFilter(vendorScope, userCode, 'CODIGOVENDEDOR');
        const startDate = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
        const startYear = startDate.getFullYear();
        const startMonth = startDate.getMonth() + 1;

        const rows = await safeQuery(conn, `
            SELECT ANODOCUMENTO, MESDOCUMENTO,
                   SUM(IMPORTEVENTA) as VENTAS,
                   COUNT(DISTINCT CODIGOCLIENTEALBARAN) as CLIENTES,
                   COUNT(*) as OPERACIONES
            FROM DSEDAC.LAC
            WHERE (ANODOCUMENTO > ? OR (ANODOCUMENTO = ? AND MESDOCUMENTO >= ?))
              ${vendorFilter.sql}
            GROUP BY ANODOCUMENTO, MESDOCUMENTO
            ORDER BY ANODOCUMENTO DESC, MESDOCUMENTO DESC
        `, [startYear, startYear, startMonth, ...vendorFilter.params]);

        const byPeriod = new Map(
            rows.map((row) => [
                `${row.ANODOCUMENTO}-${String(row.MESDOCUMENTO).padStart(2, '0')}`,
                {
                    period: `${row.ANODOCUMENTO}-${String(row.MESDOCUMENTO).padStart(2, '0')}`,
                    sales: parseFloat(row.VENTAS) || 0,
                    clients: parseInt(row.CLIENTES, 10) || 0,
                    operations: parseInt(row.OPERACIONES, 10) || 0,
                },
            ])
        );

        const months_data = [];
        for (let i = 0; i < months; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            months_data.push(byPeriod.get(period) || {
                period,
                sales: 0,
                clients: 0,
                operations: 0,
            });
        }

        return { months: months_data };
    },

    async getTopProductsByClient(conn, clientCode, month, year, limit = 10) {
        const currentYear = year || new Date().getFullYear();
        const currentMonth = month || new Date().getMonth() + 1;

        const rows = await safeQuery(conn, `
            SELECT TRIM(L.CODIGOARTICULO) as CODIGO, TRIM(A.DESCRIPCIONARTICULO) as NOMBRE,
                   TRIM(A.CODIGOFAMILIA) as FAMILIA,
                   SUM(L.IMPORTEVENTA) as TOTAL, SUM(L.CANTIDADENVASES) as UNIDADES,
                   AVG(L.PRECIOVENTA) as PRECIO_MEDIO
            FROM DSEDAC.LAC L
            LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
            WHERE TRIM(L.CODIGOCLIENTEALBARAN) = ?
              AND L.ANODOCUMENTO = ? AND L.MESDOCUMENTO = ?
            GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, A.CODIGOFAMILIA
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
                   TRIM(CODIGOFAMILIA) as FAMILIA, 0 as PRECIO
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
            SELECT TRIM(C.CODIGOCLIENTE) as CODIGO, TRIM(C.NOMBRECLIENTE) as NOMBRE,
                   TRIM(C.POBLACION) as POBLACION, TRIM(C.PROVINCIA) as PROVINCIA,
                   TRIM(P.VENDEDORCOMERCIAL) as VENDEDOR
            FROM DSEDAC.CLI C
            LEFT JOIN DSEDAC.CLP P ON C.CODIGOCLIENTE = P.CODIGOCLIENTE
            WHERE TRIM(C.NOMBRECLIENTE) LIKE ?
            ORDER BY C.NOMBRECLIENTE
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

// ============================================================================
// GENERIC ANALYTICS TOOLS (flexible queries — LACLAE + LAC)
// ============================================================================

function parseFlexibleDate(dateStr) {
    if (!dateStr) return null;
    const raw = String(dateStr).trim();
    const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) {
        return { year: parseInt(iso[1], 10), month: parseInt(iso[2], 10), day: parseInt(iso[3], 10) };
    }
    const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmy) {
        return { year: parseInt(dmy[3], 10), month: parseInt(dmy[2], 10), day: parseInt(dmy[1], 10) };
    }
    const ym = raw.match(/^(\d{4})-(\d{1,2})$/);
    if (ym) {
        return { year: parseInt(ym[1], 10), month: parseInt(ym[2], 10), day: 1 };
    }
    return null;
}

function buildLaclaePeriodFilter(dateFrom, dateTo, alias = 'L') {
    const from = parseFlexibleDate(dateFrom);
    const to = parseFlexibleDate(dateTo);
    if (!from && !to) return { clause: '', params: [] };

    const params = [];
    let clause = '';
    if (from) {
        clause += ` AND (${alias}.LCAADC > ? OR (${alias}.LCAADC = ? AND ${alias}.LCMMDC >= ?))`;
        params.push(from.year, from.year, from.month);
    }
    if (to) {
        clause += ` AND (${alias}.LCAADC < ? OR (${alias}.LCAADC = ? AND ${alias}.LCMMDC <= ?))`;
        params.push(to.year, to.year, to.month);
    }
    return { clause, params };
}

function shiftPeriod(dateFrom, dateTo, mode) {
    const from = parseFlexibleDate(dateFrom);
    const to = parseFlexibleDate(dateTo);
    if (!from || !to) return null;

    if (mode === 'prior_year') {
        return {
            dateFrom: `${from.year - 1}-${String(from.month).padStart(2, '0')}-01`,
            dateTo: `${to.year - 1}-${String(to.month).padStart(2, '0')}-28`,
        };
    }

    const monthSpan = (to.year - from.year) * 12 + (to.month - from.month) + 1;
    const priorEnd = new Date(from.year, from.month - 2, 1);
    const priorStart = new Date(priorEnd.getFullYear(), priorEnd.getMonth() - (monthSpan - 1), 1);
    return {
        dateFrom: `${priorStart.getFullYear()}-${String(priorStart.getMonth() + 1).padStart(2, '0')}-01`,
        dateTo: `${priorEnd.getFullYear()}-${String(priorEnd.getMonth() + 1).padStart(2, '0')}-28`,
    };
}

function mapGroupRow(groupBy, row) {
    if (groupBy === 'quarter') {
        return {
            period: `${row.YEAR}-T${row.QUARTER}`,
            year: parseInt(row.YEAR, 10),
            quarter: parseInt(row.QUARTER, 10),
            sales: parseFloat(row.SALES) || 0,
            cost: parseFloat(row.COST) || 0,
            units: parseFloat(row.UNITS) || 0,
            lines: parseInt(row.LINES, 10) || 0,
        };
    }
    if (groupBy === 'year') {
        return {
            period: String(row.YEAR),
            year: parseInt(row.YEAR, 10),
            sales: parseFloat(row.SALES) || 0,
            cost: parseFloat(row.COST) || 0,
            units: parseFloat(row.UNITS) || 0,
            lines: parseInt(row.LINES, 10) || 0,
        };
    }
    if (groupBy === 'family') {
        return {
            period: row.FAMILY || 'Sin familia',
            family: row.FAMILY || 'Sin familia',
            sales: parseFloat(row.SALES) || 0,
            cost: parseFloat(row.COST) || 0,
            units: parseFloat(row.UNITS) || 0,
            lines: parseInt(row.LINES, 10) || 0,
        };
    }
    if (groupBy === 'product') {
        return {
            period: row.CODE,
            productCode: row.CODE,
            productName: row.NAME,
            sales: parseFloat(row.SALES) || 0,
            cost: parseFloat(row.COST) || 0,
            units: parseFloat(row.UNITS) || 0,
            lines: parseInt(row.LINES, 10) || 0,
        };
    }
    return {
        period: `${row.YEAR}-${String(row.MONTH).padStart(2, '0')}`,
        year: parseInt(row.YEAR, 10),
        month: parseInt(row.MONTH, 10),
        sales: parseFloat(row.SALES) || 0,
        cost: parseFloat(row.COST) || 0,
        units: parseFloat(row.UNITS) || 0,
        lines: parseInt(row.LINES, 10) || 0,
    };
}

async function queryClientLaclaeAggregate(conn, {
    clientCode,
    dateFrom,
    dateTo,
    groupBy = 'month',
    familyCode,
    productCode,
    userCode,
    isJefeVentas,
    vendorScope,
}) {
    const vendorFilter = _buildVendorFilter(vendorScope, userCode, 'L.LCCDVD');
    const periodFilter = buildLaclaePeriodFilter(dateFrom, dateTo, 'L');
    const params = [clientCode, ...periodFilter.params, ...vendorFilter.params];

    let selectGroup = 'L.LCAADC AS YEAR, L.LCMMDC AS MONTH';
    let groupClause = 'L.LCAADC, L.LCMMDC';
    let orderClause = 'YEAR DESC, MONTH DESC';

    if (groupBy === 'quarter') {
        selectGroup = `L.LCAADC AS YEAR,
            CASE WHEN L.LCMMDC BETWEEN 1 AND 3 THEN 1 WHEN L.LCMMDC BETWEEN 4 AND 6 THEN 2
                 WHEN L.LCMMDC BETWEEN 7 AND 9 THEN 3 ELSE 4 END AS QUARTER`;
        groupClause = `L.LCAADC,
            CASE WHEN L.LCMMDC BETWEEN 1 AND 3 THEN 1 WHEN L.LCMMDC BETWEEN 4 AND 6 THEN 2
                 WHEN L.LCMMDC BETWEEN 7 AND 9 THEN 3 ELSE 4 END`;
        orderClause = 'YEAR DESC, QUARTER DESC';
    } else if (groupBy === 'year') {
        selectGroup = 'L.LCAADC AS YEAR';
        groupClause = 'L.LCAADC';
        orderClause = 'YEAR DESC';
    } else if (groupBy === 'family') {
        selectGroup = 'TRIM(A.CODIGOFAMILIA) AS FAMILY';
        groupClause = 'TRIM(A.CODIGOFAMILIA)';
        orderClause = 'SALES DESC';
    } else if (groupBy === 'product') {
        selectGroup = 'TRIM(L.LCCDRF) AS CODE, TRIM(MAX(A.DESCRIPCIONARTICULO)) AS NAME';
        groupClause = 'TRIM(L.LCCDRF), TRIM(A.DESCRIPCIONARTICULO)';
        orderClause = 'SALES DESC';
    }

    let extraFilter = '';
    if (familyCode) {
        extraFilter += ' AND TRIM(A.CODIGOFAMILIA) = ?';
        params.push(String(familyCode).trim());
    }
    if (productCode) {
        extraFilter += ' AND TRIM(L.LCCDRF) = ?';
        params.push(String(productCode).trim());
    }

    const sql = `
        SELECT ${selectGroup},
               SUM(L.LCIMVT) AS SALES,
               SUM(L.LCIMCT) AS COST,
               SUM(L.LCCTUD) AS UNITS,
               COUNT(*) AS LINES
        FROM DSED.LACLAE L
        LEFT JOIN DSEDAC.ART A ON TRIM(L.LCCDRF) = TRIM(A.CODIGOARTICULO)
        WHERE TRIM(L.LCCDCL) = ?
          AND L.LCIMVT > 0
          AND L.TPDC = 'LAC'
          AND L.LCTPVT IN ('CC', 'VC')
          AND L.LCCLLN IN ('AB', 'VT')
          ${periodFilter.clause}
          ${vendorFilter.sql}
          ${extraFilter}
        GROUP BY ${groupClause}
        ORDER BY ${orderClause}
        FETCH FIRST 50 ROWS ONLY
    `;

    const rows = await safeQuery(conn, sql, params);
    const groups = (rows || []).map((row) => mapGroupRow(groupBy, row));
    const totals = groups.reduce((acc, g) => ({
        sales: acc.sales + g.sales,
        cost: acc.cost + (g.cost || 0),
        units: acc.units + (g.units || 0),
        lines: acc.lines + (g.lines || 0),
    }), { sales: 0, cost: 0, units: 0, lines: 0 });

    return { groups, totals };
}

const genericAnalyticsTools = {
    async queryClientSales(conn, clientCode, dateFrom, dateTo, groupBy, compareWith, userCode, isJefeVentas, vendorScope) {
        if (!clientCode) return { error: 'clientCode requerido' };
        const current = await queryClientLaclaeAggregate(conn, {
            clientCode, dateFrom, dateTo, groupBy, userCode, isJefeVentas, vendorScope,
        });

        let comparison = null;
        if (compareWith && dateFrom && dateTo) {
            const shifted = shiftPeriod(dateFrom, dateTo, compareWith);
            if (shifted) {
                const prior = await queryClientLaclaeAggregate(conn, {
                    clientCode,
                    dateFrom: shifted.dateFrom,
                    dateTo: shifted.dateTo,
                    groupBy,
                    userCode,
                    isJefeVentas,
                    vendorScope,
                });
                const salesDelta = current.totals.sales - prior.totals.sales;
                const pct = prior.totals.sales > 0
                    ? Math.round((salesDelta / prior.totals.sales) * 1000) / 10
                    : null;
                comparison = {
                    mode: compareWith,
                    period: shifted,
                    totals: prior.totals,
                    salesDelta,
                    salesDeltaPercent: pct,
                };
            }
        }

        return {
            clientCode,
            dateFrom: dateFrom || null,
            dateTo: dateTo || null,
            groupBy: groupBy || 'month',
            groups: current.groups,
            totals: current.totals,
            comparison,
            source: 'DSED.LACLAE',
        };
    },

    async queryClientProfit(conn, clientCode, dateFrom, dateTo, groupBy, userCode, isJefeVentas, vendorScope) {
        const result = await this.queryClientSales(
            conn, clientCode, dateFrom, dateTo, groupBy || 'month', null, userCode, isJefeVentas, vendorScope
        );
        if (result.error) return result;

        const profit = result.totals.sales - result.totals.cost;
        const marginPct = result.totals.sales > 0
            ? Math.round(((profit / result.totals.sales) * 100) * 10) / 10
            : 0;

        return {
            ...result,
            profit,
            marginPercent: marginPct,
            groups: result.groups.map((g) => {
                const p = g.sales - (g.cost || 0);
                return {
                    ...g,
                    profit: p,
                    marginPercent: g.sales > 0 ? Math.round((p / g.sales) * 1000) / 10 : 0,
                };
            }),
        };
    },

    async queryClientPurchases(conn, clientCode, dateFrom, dateTo, familyCode, productCode, limit, userCode, isJefeVentas, vendorScope) {
        if (!clientCode) return { error: 'clientCode requerido' };
        const periodFilter = buildLaclaePeriodFilter(dateFrom, dateTo, 'L');
        const vendorFilter = _buildVendorFilter(vendorScope, userCode, 'L.LCCDVD');
        const params = [clientCode, ...periodFilter.params, ...vendorFilter.params];
        let extra = '';
        if (familyCode) {
            extra += ' AND TRIM(A.CODIGOFAMILIA) = ?';
            params.push(String(familyCode).trim());
        }
        if (productCode) {
            extra += ' AND TRIM(L.LCCDRF) = ?';
            params.push(String(productCode).trim());
        }
        params.push(Math.min(parseInt(limit, 10) || 30, 50));

        const rows = await safeQuery(conn, `
            SELECT TRIM(L.LCCDRF) AS CODE,
                   TRIM(A.DESCRIPCIONARTICULO) AS NAME,
                   TRIM(A.CODIGOFAMILIA) AS FAMILY,
                   L.LCAADC AS YEAR, L.LCMMDC AS MONTH,
                   SUM(L.LCIMVT) AS SALES,
                   SUM(L.LCCTUD) AS UNITS,
                   COUNT(*) AS LINES
            FROM DSED.LACLAE L
            LEFT JOIN DSEDAC.ART A ON TRIM(L.LCCDRF) = TRIM(A.CODIGOARTICULO)
            WHERE TRIM(L.LCCDCL) = ?
              AND L.LCIMVT > 0
              ${periodFilter.clause}
              ${vendorFilter.sql}
              ${extra}
            GROUP BY TRIM(L.LCCDRF), TRIM(A.DESCRIPCIONARTICULO), TRIM(A.CODIGOFAMILIA), L.LCAADC, L.LCMMDC
            ORDER BY SALES DESC
            FETCH FIRST ? ROWS ONLY
        `, params);

        const purchases = (rows || []).map((r) => ({
            productCode: r.CODE,
            productName: r.NAME,
            family: r.FAMILY,
            period: `${r.YEAR}-${String(r.MONTH).padStart(2, '0')}`,
            sales: parseFloat(r.SALES) || 0,
            units: parseFloat(r.UNITS) || 0,
            lines: parseInt(r.LINES, 10) || 0,
        }));

        const totalSales = purchases.reduce((s, p) => s + p.sales, 0);
        return {
            clientCode,
            dateFrom: dateFrom || null,
            dateTo: dateTo || null,
            familyCode: familyCode || null,
            productCode: productCode || null,
            purchaseCount: purchases.length,
            totalSales,
            purchases,
            source: 'DSED.LACLAE',
        };
    },

    async comparePeriods(conn, dateFrom, dateTo, compareWith, groupBy, clientCode, userCode, isJefeVentas, vendorScope) {
        if (!dateFrom || !dateTo) return { error: 'dateFrom y dateTo requeridos' };
        const mode = compareWith || 'prior_year';
        const shifted = shiftPeriod(dateFrom, dateTo, mode);
        if (!shifted) return { error: 'Rango de fechas invalido' };

        const baseArgs = {
            dateFrom, dateTo, groupBy: groupBy || 'month', userCode, isJefeVentas, vendorScope,
        };
        const priorArgs = {
            dateFrom: shifted.dateFrom,
            dateTo: shifted.dateTo,
            groupBy: groupBy || 'month',
            userCode,
            isJefeVentas,
            vendorScope,
        };

        let current;
        let prior;
        if (clientCode) {
            current = await queryClientLaclaeAggregate(conn, { clientCode, ...baseArgs });
            prior = await queryClientLaclaeAggregate(conn, { clientCode, ...priorArgs });
        } else {
            const vendorFilter = _buildVendorFilter(vendorScope, userCode, 'L.LCCDVD');
            const buildVendorSql = (period) => {
                const pf = buildLaclaePeriodFilter(period.dateFrom, period.dateTo, 'L');
                return safeQuery(conn, `
                    SELECT SUM(L.LCIMVT) AS SALES, SUM(L.LCIMCT) AS COST,
                           COUNT(DISTINCT L.LCCDCL) AS CLIENTS
                    FROM DSED.LACLAE L
                    WHERE L.LCIMVT > 0 ${pf.clause} ${vendorFilter.sql}
                `, [...pf.params, ...vendorFilter.params]);
            };
            const [curRows, priRows] = await Promise.all([
                buildVendorSql({ dateFrom, dateTo }),
                buildVendorSql({ dateFrom: shifted.dateFrom, dateTo: shifted.dateTo }),
            ]);
            current = { totals: {
                sales: parseFloat(curRows[0]?.SALES) || 0,
                cost: parseFloat(curRows[0]?.COST) || 0,
                clients: parseInt(curRows[0]?.CLIENTS, 10) || 0,
            } };
            prior = { totals: {
                sales: parseFloat(priRows[0]?.SALES) || 0,
                cost: parseFloat(priRows[0]?.COST) || 0,
                clients: parseInt(priRows[0]?.CLIENTS, 10) || 0,
            } };
        }

        const salesDelta = current.totals.sales - prior.totals.sales;
        const pct = prior.totals.sales > 0
            ? Math.round((salesDelta / prior.totals.sales) * 1000) / 10
            : null;

        return {
            clientCode: clientCode || null,
            currentPeriod: { dateFrom, dateTo, totals: current.totals, groups: current.groups || [] },
            priorPeriod: { ...shifted, totals: prior.totals, groups: prior.groups || [] },
            compareWith: mode,
            salesDelta,
            salesDeltaPercent: pct,
            profitDelta: (current.totals.sales - current.totals.cost) - (prior.totals.sales - prior.totals.cost),
        };
    },

    async queryClientProfile(conn, clientCode, userCode, isJefeVentas, vendorScope) {
        if (!clientCode) return { error: 'clientCode requerido' };
        const [profile, debt, margin, products] = await Promise.all([
            dbDiscoveryTools.lookupClient(conn, clientCode),
            riskTools.getClientDebt(conn, clientCode),
            commercialTools.getMarginByClient(conn, clientCode, userCode, isJefeVentas, vendorScope),
            crossQueryTools.getClientProductsBought(conn, clientCode, 5),
        ]);

        if (!profile) return { error: 'Cliente no encontrado' };

        return {
            clientCode,
            profile,
            debt: {
                total: debt.totalDebt,
                overdue: debt.overdueDebt,
                riskLevel: debt.riskLevel,
            },
            marginYtd: {
                sales: margin.sales,
                profit: margin.profit,
                marginPercent: margin.marginPercent,
            },
            topProducts: products.products || [],
        };
    },

    async extractPdfContent(conn, documentType, reference) {
        if (!reference) return { error: 'reference requerida' };

        let albaranLines;
        if (String(documentType || '').toLowerCase() === 'albaran') {
            const ref = parseAlbaranRef(reference);
            if (ref) {
                const header = await fetchAlbaranHeader(conn, ref);
                if (header) {
                    const lineRows = await safeQuery(conn, `
                        SELECT TRIM(LAC.CODIGOARTICULO) AS CODIGO,
                               TRIM(LAC.DESCRIPCION) AS DESCRIPCION,
                               LAC.CANTIDADUNIDADES AS CANTIDAD,
                               LAC.PRECIOVENTA AS PRECIO,
                               LAC.IMPORTEVENTA AS IMPORTE
                        FROM DSEDAC.CAC CAC
                        LEFT JOIN DSEDAC.LAC LAC
                          ON LAC.SUBEMPRESAALBARAN = CAC.SUBEMPRESAALBARAN
                         AND LAC.EJERCICIOALBARAN = CAC.EJERCICIOALBARAN
                         AND LAC.SERIEALBARAN = CAC.SERIEALBARAN
                         AND LAC.TERMINALALBARAN = CAC.TERMINALALBARAN
                         AND LAC.NUMEROALBARAN = CAC.NUMEROALBARAN
                        WHERE CAC.EJERCICIOALBARAN = ?
                          AND TRIM(CAC.SERIEALBARAN) = ?
                          AND CAC.TERMINALALBARAN = ?
                          AND CAC.NUMEROALBARAN = ?
                        ORDER BY LAC.SECUENCIA
                        FETCH FIRST 40 ROWS ONLY
                    `, [header.EJERCICIO, String(header.SERIE || ref.serie || '').trim(), header.TERMINAL ?? ref.terminal ?? 0, header.NUMERO]);
                    albaranLines = (lineRows || []).map((line) => ({
                        productCode: line.CODIGO,
                        description: line.DESCRIPCION?.trim(),
                        quantity: parseFloat(line.CANTIDAD) || 0,
                        unitPrice: parseFloat(line.PRECIO) || 0,
                        amount: parseFloat(line.IMPORTE) || 0,
                    }));
                }
            }
        }

        return runPdfExtraction(conn, invoiceTools, { documentType, reference, albaranLines });
    },
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
    crossQueryTools,
    genericAnalyticsTools,
};
