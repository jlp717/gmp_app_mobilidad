/**
 * CHATBOT ENDPOINT HANDLER — Regex Fallback (Production-Grade)
 * 
 * Fallback system when LLM is unavailable. Uses parameterized queries ONLY.
 * Covers all app tabs: commissions, objectives, margins, pricing, risk,
 * stock, invoices, pedidos, cobros, bolsa, evolution, analytics, repartidor.
 * 
 * SECURITY: Zero string concatenation in SQL queries.
 */

const logger = require('../../middleware/logger');
const {
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
    genericAnalyticsTools
} = require('./chatbot_tools');
const {
    authorizeResolvedClient,
    buildAuthorizationSafeResponse,
} = require('./chatbot_authorization');
const {
    buildToolMetadata,
    mergeMetadata,
} = require('./chatbot_export');

// ── Intent Detection Patterns (expanded for misspellings, synonyms, natural language) ──

const intentPatterns = {
    // Greetings & Help
    saludo: /^(hola|buenos\s*d[ií]as|buenas\s*tardes|buenas\s*noches|buenas|hey|qu[eé]\s*tal|saludos|ola|wenas|buen dia|buenas tardes)/i,
    ayuda: /^(ayuda|help|comandos|qu[eé]\s*puedes|opciones|men[uú]|que sabes hacer|como funciona|instrucciones)/i,

    // Commissions (with misspellings: comision, comision, comi, cuanto gano, mi sueldo)
    comision: /comisi[oó]n|comisiones|cuanto\s*gano|cu[aá]nto\s*gano|mi\s*comisi[oó]n|comisi[oó]n\s*del\s*mes|comi|mi\s*sueldo|liquidaci[oó]n|devengo/i,
    comisionDetalle: /detalle.*comisi[oó]n|comisi[oó]n.*detalle|comisi[oó]n.*cliente|desglose.*comisi[oó]n/i,
    comisionConfig: /configuraci[oó]n.*comisi[oó]n|tier.*comisi[oó]n|ipc.*comisi[oó]n|como\s*se\s*calcula.*comisi[oó]n/i,

    // Objectives (objetivo, meta, target, cuanto me falta)
    objetivo: /objetivo|objetivos|cumplimiento|meta|target|cu[aá]nto\s*me\s*falta|voy\s*bien|cuanto\s*me\s*falta|progreso|avance|percentaje/i,
    objetivoFamilia: /objetivo.*familia|familia.*objetivo|objetivo.*producto|meta.*familia/i,

    // Margins (margen, rentabilidad, beneficio, ganancia, cuanto gano por cliente)
    margen: /margen|m[aá]rgenes|rentabilid|beneficio|ganancia|profit|cuanto\s*gano\s*con|rentable|porcentaje\s*de\s*margen/i,
    margenGlobal: /margen\s*(global|total|general|mi\s*margen|del\s*mes)/i,

    // Pricing (precio, coste, tarifa, cuanto cuesta, cuanto vale, cuanto cobro)
    precio: /precio|cost[eo]|tarifa|cu[aá]nto|cuanto\s*cuesta|cuanto\s*vale|vender|vendo|cobro|cu[aá]nto\s*cobra|a\s*cuanto|precio\s*venta|pvp/i,
    minimo: /m[ií]nimo|minimo|suelo|floor|breakeven|break-even|precio\s*suelo|no\s*perder|precio\s*minimo|bajar\s*de/i,
    descuento: /descuento|rebaja|bajar|negociar|simul|si\s*le\s*hago|si\s*bajo|le\s*hago\s*un|aplicar\s*descuento/i,

    // Client Risk & Debt (deuda, debe, pendiente, vencido, me deben)
    deuda: /deuda|debe|adeuda|pendiente|vencid|pagar|cobr|deben|me\s*deben|deuda.*cliente|impagad|moroso/i,
    bloqueo: /bloqueado|bloqueo|no\s*puedo\s*vender|impedido|restringid|bloque|no\s*venta/i,
    riesgo: /riesgo|score|evaluaci[oó]n|evaluar|peligro|fiabilidad|solvencia|riesgo\s*cliente|puntuaci[oó]n/i,
    credito: /cr[eé]dito|l[ií]mite|limite.*cr[eé]dito|disponible.*cr[eé]dito|linea.*cr[eé]dito|credito\s*cliente/i,

    // Commercial Intelligence (churn, comparar, historial)
    churn: /dej[oó]\s*de\s*comprar|compraba\s*y|perdid|abandon[oó]|ya\s*no\s*compra|churn|producto\s*que\s*no|ha\s*dejado/i,
    comparar: /comparar|compar|a[oñ]o|a[oñ]os|vs|versus|hist[oó]rico|evoluci[oó]n|crecimiento|diferencia|anio/i,
    historial: /historial|compr[oó]|pedidos.*cliente|ventas.*cliente|histor|que\s*compr[oó]|compras\s*recientes/i,

    // Stock & Logistics
    stock: /stock|existencias|inventario|almac[eé]n|disponib|hay\s*en\s*almac[eé]n|queda|cuanto\s*queda|stock\s*producto/i,

    // Invoices & Albaranes
    factura: /factura|facturas|invoice|f[aá]ctura.*cliente|factura.*pendiente|recibo/i,
    albaran: /albar[aá]n|albaranes|delivery.*note|albaran/i,

    // Pedidos (Orders)
    pedido: /pedido|pedidos|orden.*preparaci[oó]n|opp|cu[aá]ntos\s*pedidos|pedidos.*hoy|pedidos.*dia|orden.*cliente/i,

    // Cobros (Collections)
    cobro: /cobro|cobros|cobrar|pendiente.*cobro|cobrado|recaudaci[oó]n|cu[aá]nto\s*cobr[eé]|cobros.*mes|recaudado/i,

    // Bolsa
    bolsa: /bolsa|saldo.*bolsa|bolsa.*comercial|consumido.*bolsa|acumulado|bolsa\s*comercial/i,

    // Evolution
    evolucion: /evoluci[oó]n|tendencia|trend|creciendo|decreciendo|subiendo|bajando|como\s*va|evolucion/i,

    // Analytics
    top: /top|mejor|mejores|ranking|principales|m[aá]s\s*vendido|mas\s*vendido|top\s*cliente|top\s*producto/i,
    yoy: /a[oñ]o.*contra.*a[oñ]o|yoy|year.*over|comparativa.*anual|anio.*contra/i,

    // Repartidor
    repartidor: /repartidor|reparto|entrega|entregas|cobro.*repartidor|mi\s*ruta|ruta.*hoy|ruta.*dia/i,

    // Warehouse
    almacen: /almac[eé]n|warehouse|camion|camiones|veh[ií]culo|carga|load.*plan|expedici[oó]n|vehiculos/i,

    // Daily Summary
    resumen: /resumen.*dia|resumen.*hoy|como.*fue.*hoy|que.*pas[oó].*hoy|resumen|balance.*dia/i,
    glacius: /glacius|nestle|kpi|alertas?|frio|congelad/i,

    // Search
    buscarCliente: /buscar.*cliente|buscar.*client|cliente.*llama|nombre.*cliente|cliente.*nombre|como\s*se\s*llama.*cliente|cliente.*cual/i,
    buscarProducto: /buscar.*producto|buscar.*art[ií]culo|producto.*llama|nombre.*producto|articulo.*nombre|producto.*cual/i,

    // Session / permissions
    permisos: /permiso|permisos|rol|jefe\s*de\s*ventas|supervisor|acceso|restricci[oó]n|autorizad/i,
    cobertura: /cobertura|pesta[ñn]as|qu[eé]\s*puedes|que\s*puedes|capacidades|todo\s*lo\s*que|funciones/i,

    // Cross-queries (producto + cliente combinados)
    precioCliente: /precio.*cliente|vend[ií].*cliente|a\s*cuanto.*vend[ií].*cliente|precio\s*le\s*vend[ií]|factur[aé].*cliente/i,
    productosCliente: /productos.*compr[oó]|que.*compr[oó].*cliente|productos.*cliente|compras.*cliente|que\s*compra/i,
    ventasCliente: /ventas.*cliente|cuanto.*compr[oó].*cliente|facturacion.*cliente|gasto.*cliente|cliente.*gasto/i,
};

// ── Entity Extraction ────────────────────────────────────────────────────────

const MONTH_ALIASES = {
    enero: 1, ene: 1,
    febrero: 2, feb: 2,
    marzo: 3, mar: 3,
    abril: 4, abr: 4,
    mayo: 5, may: 5,
    junio: 6, jun: 6,
    julio: 7, jul: 7,
    agosto: 8, ago: 8,
    septiembre: 9, setiembre: 9, sep: 9, set: 9,
    octubre: 10, oct: 10,
    noviembre: 11, nov: 11,
    diciembre: 12, dic: 12,
};

const MONTH_LABELS = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function extractCodes(message) {
    // Client codes: 4-10 digits, possibly preceded by "cliente", "client", "cli"
    const clientMatch = message.match(/client[e]?\s*[:#]?\s*(\d{4,10})/i) ||
        message.match(/(\d{5,10})/);

    // Product codes: alphanumeric, possibly preceded by "producto", "articulo", "prod", "art"
    const productMatch = message.match(/producto?\s*[:#]?\s*([A-Z0-9\-]+)/i) ||
        message.match(/art[ií]culo?\s*[:#]?\s*([A-Z0-9\-]+)/i) ||
        message.match(/(?:prod|art|ref|codigo)\s*[:#]?\s*([A-Z0-9\-]+)/i);

    // Percentages
    const percentMatch = message.match(/(\d+)\s*%/);

    // Month names (Spanish, with misspellings)
    const monthMatch = message.match(/(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)/i);

    // Invoice numbers (\bfactura\b avoids matching plural "facturas" as code "s")
    const invoiceMatch = message.match(/\bfactura\s*[:#]?\s*([A-Z0-9\-]+)/i) ||
        message.match(/\binvoice\s*[:#]?\s*([A-Z0-9\-]+)/i);

    // Vehicle codes
    const vehicleMatch = message.match(/(?:camion|vehiculo|vehicle)\s*[:#]?\s*([A-Z0-9\-]+)/i);

    // Order codes. Require a digit so "pedidos hoy" is not treated as an id.
    const orderMatch = message.match(/\b(?:pedido|orden|opp)\s*[:#]?\s*([A-Z0-9\-]{2,20})\b/i);

    const monthMap = {
        enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4,
        mayo: 5, junio: 6, jun: 6, julio: 7, jul: 7, agosto: 8, ago: 8,
        septiembre: 9, sep: 9, octubre: 10, oct: 10, noviembre: 11, nov: 11, diciembre: 12, dic: 12
    };

    const rawInvoice = invoiceMatch ? invoiceMatch[1] : null;
    const invoiceNumber = rawInvoice && rawInvoice.length >= 2 && /\d/.test(rawInvoice)
        ? rawInvoice
        : null;
    const rawOrder = orderMatch ? orderMatch[1] : null;
    const orderNumber = rawOrder && /\d/.test(rawOrder) ? rawOrder : null;

    return {
        clientCode: clientMatch ? clientMatch[1] : null,
        productCode: productMatch ? productMatch[1] : null,
        percent: percentMatch ? parseFloat(percentMatch[1]) : null,
        month: monthMatch ? monthMap[monthMatch[1].toLowerCase()] : null,
        invoiceNumber,
        vehicleCode: vehicleMatch ? vehicleMatch[1] : null,
        orderNumber
    };
}

function normalizeSearchText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s/-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeNaturalQuery(value) {
    let text = normalizeSearchText(value);
    const replacements = [
        [/\b(fra|fras|factu|fact|fac)\b/g, 'factura'],
        [/\b(cte|clte|cli)\b/g, 'cliente'],
        [/\b(obj|objet|objs)\b/g, 'objetivo'],
        [/\b(comis|comi|com)\b/g, 'comision'],
        [/\b(acum|acumul)\b/g, 'acumulado'],
        [/\b(ult|ultim)\b/g, 'ultimos'],
        [/\b(pte|ptes|pend)\b/g, 'pendiente'],
        [/\b(vtas|vta)\b/g, 'ventas'],
        [/\b(imp)\b/g, 'importe'],
        [/\b(alm)\b/g, 'almacen'],
        [/\b(rep)\b/g, 'repartidor'],
        [/\b(glac|glasius|glasiu)\b/g, 'glacius'],
        [/\b(pdf factura|factura pdf)\b/g, 'leer factura pdf'],
    ];
    for (const [pattern, replacement] of replacements) {
        text = text.replace(pattern, replacement);
    }
    return text.replace(/\s+/g, ' ').trim();
}

function extractHistoryEntities(conversationHistory = []) {
    const result = {};
    const entries = Array.isArray(conversationHistory) ? conversationHistory.slice().reverse() : [];
    for (const entry of entries) {
        const content = typeof entry === 'string' ? entry : entry?.content;
        if (!content) continue;
        const codes = extractCodes(String(content));
        result.clientCode = result.clientCode || codes.clientCode;
        result.productCode = result.productCode || codes.productCode;
        result.invoiceNumber = result.invoiceNumber || codes.invoiceNumber;
        result.orderNumber = result.orderNumber || codes.orderNumber;
        if (result.clientCode && result.productCode && result.invoiceNumber && result.orderNumber) break;
    }
    return result;
}

function extractClientNameQuery(message) {
    const text = String(message || '')
        .replace(/\bfacturas?\b/gi, ' ')
        .replace(/\bdeuda\b/gi, ' ')
        .replace(/\bcobros?\b/gi, ' ')
        .replace(/\bpedidos?\b/gi, ' ')
        .replace(/\bmargen\b/gi, ' ')
        .replace(/\briesgo\b/gi, ' ')
        .replace(/\bhistorial\b/gi, ' ')
        .replace(/\bcliente\b/gi, ' ')
        .replace(/\b(del|de|la|las|el|los|un|una|dime|dame|consulta|consultar|ver|quiero|por|favor|pendientes?|hoy|dia|mes|recientes?|ultimos?)\b/gi, ' ')
        .replace(/\b(pdf|leer|lee|extraer|extrae|documento)\b/gi, ' ')
        .replace(/\d{4,10}/g, ' ')
        .replace(/[,:;#?¿!¡()[\]{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length >= 3 ? text : null;
}

function pickClientCandidate(query, clients) {
    if (!query || !Array.isArray(clients) || clients.length === 0) return null;
    if (clients.length === 1) return clients[0];
    const normalizedQuery = normalizeSearchText(query);
    const tokens = normalizedQuery.split(' ').filter((token) => token.length > 1);
    const scored = clients.map((client) => {
        const name = normalizeSearchText(client.NOMBRE || client.name || '');
        const code = normalizeSearchText(client.CODIGO || client.code || '');
        const exact = name === normalizedQuery || code === normalizedQuery;
        const contains = name.includes(normalizedQuery);
        const tokenMatches = tokens.filter((token) => name.includes(token) || code.includes(token)).length;
        return { client, score: (exact ? 100 : 0) + (contains ? 40 : 0) + tokenMatches };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
    if (scored.length === 0) return null;
    if (scored.length === 1 || scored[0].score > scored[1].score) return scored[0].client;
    return null;
}

function formatClientAmbiguity(query, clients) {
    const list = clients.slice(0, 8).map((client) =>
        `- ${client.NOMBRE || client.name || 'Sin nombre'} (${client.CODIGO || client.code || 'sin codigo'}) ${client.POBLACION || ''}`.trim()
    ).join('\n');
    return `He encontrado varios clientes para "${query}". Dime el codigo o elige uno:\n${list}`;
}

// ── Safe Query Helper ────────────────────────────────────────────────────────

function extractRequestedYear(message, fallbackYear = new Date().getFullYear()) {
    const match = String(message || '').match(/\b(20\d{2}|19\d{2})\b/);
    return match ? parseInt(match[1], 10) : fallbackYear;
}

function monthLabel(period) {
    return `${MONTH_LABELS[period.month - 1] || period.month} ${period.year}`;
}

function addMonths(year, month, delta) {
    const d = new Date(year, month - 1 + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function buildMonthSpan(startYear, startMonth, endYear, endMonth) {
    const span = [];
    let cursor = { year: startYear, month: startMonth };
    let guard = 0;
    while (guard < 12) {
        span.push({ ...cursor, label: monthLabel(cursor) });
        if (cursor.year === endYear && cursor.month === endMonth) break;
        cursor = addMonths(cursor.year, cursor.month, 1);
        guard += 1;
    }
    return span;
}

function parseMonthRange(message, now = new Date()) {
    const normalized = normalizeSearchText(message);
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const requestedYear = extractRequestedYear(message, currentYear);

    const quarterMatch = normalized.match(/\b(?:q|t)([1-4])\b/)
        || normalized.match(/\b(primer|primero|segundo|tercer|tercero|cuarto)\s+trimestre\b/);
    if (quarterMatch) {
        const qText = quarterMatch[1];
        const q = /^\d$/.test(qText)
            ? parseInt(qText, 10)
            : ({ primer: 1, primero: 1, segundo: 2, tercer: 3, tercero: 3, cuarto: 4 }[qText] || 1);
        const start = (q - 1) * 3 + 1;
        return {
            months: buildMonthSpan(requestedYear, start, requestedYear, start + 2),
            isRange: true,
        };
    }

    const recentMatch = normalized.match(/ultim[oa]s?\s+(\d{1,2})\s+meses/)
        || normalized.match(/\b(\d{1,2})\s+meses\b/);
    if (recentMatch) {
        const count = Math.min(Math.max(parseInt(recentMatch[1], 10) || 1, 1), 12);
        const start = addMonths(currentYear, currentMonth, -(count - 1));
        return {
            months: buildMonthSpan(start.year, start.month, currentYear, currentMonth),
            isRange: count > 1,
        };
    }

    const monthRegex = /\b(enero|ene|febrero|feb|marzo|mar|abril|abr|mayo|may|junio|jun|julio|jul|agosto|ago|septiembre|setiembre|sep|set|octubre|oct|noviembre|nov|diciembre|dic)\b/g;
    const found = [];
    let match;
    while ((match = monthRegex.exec(normalized)) !== null) {
        const month = MONTH_ALIASES[match[1]];
        if (month) found.push(month);
    }

    if (found.length >= 2) {
        const startMonth = found[0];
        const endMonth = found[found.length - 1];
        const endYear = endMonth < startMonth ? requestedYear + 1 : requestedYear;
        return {
            months: buildMonthSpan(requestedYear, startMonth, endYear, endMonth),
            isRange: true,
        };
    }

    if (found.length === 1) {
        return {
            months: [{ year: requestedYear, month: found[0], label: monthLabel({ year: requestedYear, month: found[0] }) }],
            isRange: false,
        };
    }

    return null;
}

function isAccumulatedQuery(message) {
    return /acumulad|rango|trimestre|ultim[oa]s?\s+\d+\s+meses|\b\d+\s+meses\b|desde|hasta|entre|a\s+marzo|a\s+abril|a\s+mayo|a\s+junio|a\s+julio|a\s+agosto|a\s+septiembre|a\s+octubre|a\s+noviembre|a\s+diciembre/i.test(message);
}

function extractFamilyCode(message) {
    const match = String(message || '').match(/\bfamilia\s*[:#]?\s*([A-Z0-9_-]{2,12})\b/i);
    return match ? match[1].toUpperCase() : null;
}

function sumNumeric(items, field) {
    return items.reduce((sum, item) => sum + (Number(item[field]) || 0), 0);
}

async function aggregateCommissionsByMonths(conn, userCode, isJefeVentas, vendorScope, months) {
    // Bounded aggregation: max 12 tool calls, avoiding unbounded DB loops.
    const rows = [];
    for (const period of months.slice(0, 12)) {
        const result = await commissionTools.getCommissions(
            conn, userCode, isJefeVentas, period.month, period.year, vendorScope
        );
        rows.push({ ...result, label: period.label });
    }
    const sales = sumNumeric(rows, 'sales');
    const commission = sumNumeric(rows, 'commission');
    return {
        months: rows,
        totalSales: Math.round(sales * 100) / 100,
        totalCommission: Math.round(commission * 100) / 100,
        averageCommissionPercent: sales > 0 ? Math.round((commission / sales) * 10000) / 100 : 0,
        activeClients: Math.max(...rows.map((row) => Number(row.activeClients) || 0), 0),
        operations: rows.reduce((sum, row) => sum + (Number(row.operations) || 0), 0),
    };
}

async function aggregateObjectivesByMonths(conn, userCode, isJefeVentas, vendorScope, months) {
    // Bounded aggregation: max 12 tool calls, using the same objective rules per month.
    const rows = [];
    for (const period of months.slice(0, 12)) {
        const result = await objectivesTools.getObjectives(
            conn, userCode, isJefeVentas, period.month, period.year, vendorScope
        );
        rows.push({ ...result, label: period.label });
    }
    const target = sumNumeric(rows, 'target');
    const achieved = sumNumeric(rows, 'achieved');
    return {
        months: rows,
        totalTarget: Math.round(target * 100) / 100,
        totalAchieved: Math.round(achieved * 100) / 100,
        totalRemaining: Math.round((target - achieved) * 100) / 100,
        achievementPercent: target > 0 ? Math.round((achieved / target) * 1000) / 10 : 0,
    };
}

async function safeQuery(conn, sql, params = []) {
    try {
        if (params.length > 0) {
            return await conn.query(sql, params);
        }
        return await conn.query(sql);
    } catch (error) {
        logger.error(`[CHATBOT-FALLBACK] Query error: ${error.message}`);
        return [];
    }
}

// ── Main Message Handler ─────────────────────────────────────────────────────

async function handleChatMessage(conn, message, vendedorCodes, providedClientCode, context = {}) {
    const msg = normalizeNaturalQuery(message);
    const vendorScope = Array.isArray(context.vendorScope) && context.vendorScope.length
        ? context.vendorScope
        : (Array.isArray(vendedorCodes) ? vendedorCodes : []);
    const userCode = context.userCode || vendorScope[0] || '';
    const isJefeVentas = Boolean(context.isJefeVentas) || context.role === 'JEFE_VENTAS';
    const authContext = { ...context, userCode, isJefeVentas, vendorScope, conn };
    const richResponses = context.richResponses === true;

    function reply(text, toolName, result, extraMetadata = null) {
        if (!richResponses) return text;
        const metadata = mergeMetadata([
            toolName ? buildToolMetadata(toolName, result) : null,
            extraMetadata,
        ]);
        return { text, metadata };
    }

    async function denyIfForbiddenClient(code) {
        if (!code) return null;
        const { authorization } = await authorizeResolvedClient(conn, authContext, code);
        if (authorization.allowed) return null;
        return buildAuthorizationSafeResponse(authorization.code);
    }

    async function denyIfForbiddenInvoice(invoiceNumber) {
        if (!invoiceNumber) return null;
        const ownerClient = await invoiceTools.resolveInvoiceClientCode(conn, invoiceNumber);
        if (!ownerClient) return `Factura ${invoiceNumber} no encontrada.`;
        return denyIfForbiddenClient(ownerClient);
    }
    const codes = extractCodes(message);
    const historyEntities = extractHistoryEntities(context.conversationHistory);
    let clientCode = codes.clientCode || providedClientCode || historyEntities.clientCode;
    const productCode = codes.productCode || historyEntities.productCode;
    const invoiceNumber = codes.invoiceNumber || historyEntities.invoiceNumber;
    const orderNumber = codes.orderNumber || historyEntities.orderNumber;

    async function resolveClientFromNaturalName() {
        if (clientCode || invoiceNumber) return null;
        if (intentPatterns.saludo.test(msg) || intentPatterns.ayuda.test(msg) || intentPatterns.permisos.test(msg) || intentPatterns.cobertura.test(msg)) {
            return null;
        }
        if (/d[oÃ³]nde|abrir|ir a|navega|pantalla|secci[oÃ³]n|pesta[Ã±n]a/.test(msg)) {
            return null;
        }
        const clientIntent = intentPatterns.deuda.test(msg)
            || intentPatterns.factura.test(msg)
            || intentPatterns.cobro.test(msg)
            || intentPatterns.pedido.test(msg)
            || intentPatterns.margen.test(msg)
            || intentPatterns.riesgo.test(msg)
            || intentPatterns.bloqueo.test(msg)
            || intentPatterns.credito.test(msg)
            || intentPatterns.churn.test(msg)
            || intentPatterns.comparar.test(msg)
            || intentPatterns.historial.test(msg)
            || intentPatterns.productosCliente.test(msg)
            || intentPatterns.ventasCliente.test(msg);
        if (!clientIntent) return null;
        const query = extractClientNameQuery(message);
        if (!query) return null;
        const clients = await dbDiscoveryTools.searchClients(conn, query);
        if (!clients.length) {
            return {
                response: reply(`No he encontrado ningun cliente que coincida con "${query}".`, null, null),
            };
        }
        const authorized = [];
        for (const candidate of clients.slice(0, 12)) {
            const code = String(candidate.CODIGO || candidate.code || '').trim();
            if (!code) continue;
            const denied = await denyIfForbiddenClient(code);
            if (!denied) authorized.push(candidate);
            if (authorized.length >= 8) break;
        }
        if (authorized.length === 0) {
            return {
                response: reply('No tengo clientes autorizados que coincidan con esa busqueda.', null, null),
            };
        }
        const candidate = pickClientCandidate(query, authorized);
        if (!candidate) {
            return { response: reply(formatClientAmbiguity(query, authorized), null, null) };
        }
        return { clientCode: String(candidate.CODIGO || candidate.code).trim() };
    }

    const resolvedClient = await resolveClientFromNaturalName();
    if (resolvedClient?.response) return resolvedClient.response;
    if (resolvedClient?.clientCode) clientCode = resolvedClient.clientCode;

    // ── GREETING ──
    if (intentPatterns.saludo.test(msg)) {
        return `**Asistente GMP — Consulta comercial**

Consultas disponibles:
- **Comisiones**: "Mis comisiones", "Comision de marzo"
- **Objetivos**: "Cumplimiento objetivo", "Objetivo por familia"
- **Margenes**: "Margen global", "Margen cliente 12345"
- **Precios**: "Precio producto ABC", "Precio minimo"
- **Deudas**: "Deuda cliente 12345"
- **Cobros**: "Cobros pendientes", "Resumen cobros mes"
- **Bolsa**: "Saldo bolsa", "Movimientos bolsa"
- **Stock**: "Stock producto XYZ"
- **Facturas**: "Facturas cliente 12345"
- **Pedidos**: "Pedidos hoy", "Pedidos cliente"
- **Evolucion**: "Evolucion ventas", "Productos en tendencia"
- **Top**: "Top clientes", "Top productos"
- **Comparativas**: "Ventas 2024 vs 2023"
- **Repartidor**: "Cobros repartidor", "Entregas hoy"
- **Almacen**: "Camiones hoy", "Vehiculos"

Escribe "ayuda" para detalle de comandos.`;
    }

    // ── NAVIGATION ──
    if (/d[oó]nde|abrir|ir a|navega|pantalla|secci[oó]n|pesta[ñn]a/.test(msg)
        && !intentPatterns.cobertura.test(msg)
        && !clientCode && !productCode && !invoiceNumber) {
        return `Secciones en la app GMP:
- **Chat IA**: Asistente GMP
- **Pedidos**: crear y revisar pedidos; pestaña **Evolución** = productos comprados por mes
- **Cobros**: pendientes y cobros
- **Facturas**: facturas y vencimientos
- **Comisiones**: objetivos y comisiones
- **Bolsa**: bolsa comercial
- **Clientes**: ficha y actividad

Solo consultas de la app GMP.`;
    }

    // ── HELP ──
    if (intentPatterns.cobertura.test(msg) && !clientCode && !productCode && !invoiceNumber) {
        return reply(`**Cobertura del asistente GMP**

- **Clientes**: ficha, deuda, riesgo, credito, historial, productos comprados, ventas mensuales y evaluacion comercial.
- **Ruta / Rutero**: entregas del dia, cobros del repartidor, liquidacion y comision de reparto.
- **Comisiones**: comision del mes, acumulados por rango, desglose por cliente y configuracion de tramos.
- **Objetivos**: objetivo mensual, acumulados por meses, cumplimiento y objetivos por familia.
- **Facturas**: pendientes por cliente, detalle de factura, albaranes y lectura del PDF cuando existe documento asociado.
- **Glacius / Panel**: resumen comercial, pedidos, clientes, ventas y senales KPI del dia.
- **Cobros**: pendientes por cliente, vencimientos y resumen mensual.
- **Bolsa**: saldo, movimientos e historial.
- **Pedidos**: pedidos del dia, pedidos por cliente y detalle de pedido.
- **Almacen**: vehiculos, camiones y carga del dia.

Puedes escribir normal: "mi comision acumulada de enero a marzo", "objetivo ultimos 3 meses", "lee la factura F/100/2026" o "top productos del cliente 32258".`, null, null, {
            deepLink: { tab: 'Chat IA' },
            suggestedFollowUps: [
                'Mi comision acumulada ultimos 3 meses',
                'Objetivo acumulado enero a marzo',
                'Facturas de un cliente',
                'Resumen Glacius hoy',
            ],
        });
    }

    if (intentPatterns.ayuda.test(msg)) {
        return `**Comandos Asistente GMP**

**Finanzas**
- "Mis comisiones" | "Comision marzo"
- "Objetivo mes" | "Cumplimiento objetivo"
- "Margen global" | "Margen cliente 12345"

**Precios**
- "Precio producto ABC"
- "Precio minimo producto ABC"
- "Simula 15% descuento producto ABC"

**Clientes**
- "Deuda cliente 12345"
- "Historial cliente 12345"
- "Buscar cliente Garcia"
- "Riesgo cliente 12345"
- "Credito cliente 12345"
- "Bloqueado 12345?"

**Operaciones**
- "Stock producto ABC"
- "Facturas cliente 12345"
- "Pedidos hoy"
- "Cobros pendientes"

**Analisis**
- "Evolucion ventas"
- "Top clientes mes"
- "Comparativa 2024 vs 2023"
- "Productos en tendencia"

**Bolsa**
- "Saldo bolsa" | "Movimientos bolsa"

Incluye codigo de cliente o producto cuando sea posible.`;
    }

    // ── COMMISSIONS ──
    if (intentPatterns.permisos.test(msg) && !clientCode && !invoiceNumber) {
        const scopeText = isJefeVentas
            ? 'acceso supervisor a todos los clientes y vendedores'
            : `cartera autorizada: ${vendorScope.join(', ') || userCode || 'sin vendedor cargado'}`;
        return reply(`Sesion actual:
- Rol: **${context.role || 'SIN_ROL'}**
- Codigo vendedor: **${userCode || 'N/A'}**
- Modo supervisor: **${isJefeVentas ? 'SI' : 'NO'}**
- Ambito: **${scopeText}**

Puedes preguntar en lenguaje natural, por ejemplo: "facturas de Central Hoteles", "deuda del cliente 32258" o "lee la factura F/100/2026".`, null, null);
    }

    if (intentPatterns.repartidor.test(msg) && intentPatterns.comision.test(msg)) {
        try {
            const result = await repartidorTools.getRepartidorCommissions(conn, userCode, codes.month, undefined);
            const text = `**Comision repartidor ${result.month}/${result.year}**
- Cobrado: **${result.collected.toLocaleString('es-ES')} EUR**
- A cobrar: ${result.collectable.toLocaleString('es-ES')} EUR
- Porcentaje: **${result.percentage}%**
- Comision: **${result.commission.toLocaleString('es-ES')} EUR**
- Umbral: ${result.thresholdMet ? 'cumplido' : 'pendiente'}`;
            return reply(text, 'get_repartidor_commissions', result);
        } catch (err) {
            logger.error('[CHATBOT] Repartidor commission error:', err.message);
            return 'Error consultando comision del repartidor.';
        }
    }

    if (intentPatterns.comisionConfig.test(msg)) {
        try {
            const config = await commissionTools.getCommissionConfig(conn);
            const tiers = (config.tiers || []).map((tier) =>
                `- ${tier.min}% a ${tier.max}%: ${tier.pct}%`
            ).join('\n');
            return reply(`**Configuracion de comisiones**
- IPC/base: **${config.ipc}%**
- Tramos:
${tiers || '- Sin tramos configurados'}`, 'get_commission_config', config);
        } catch (e) {
            return `Error obteniendo configuracion de comisiones: ${e.message}`;
        }
    }

    if (intentPatterns.comision.test(msg)
        && !intentPatterns.comisionDetalle.test(msg)
        && (isAccumulatedQuery(msg) || (parseMonthRange(message)?.months?.length || 0) > 1)) {
        try {
            const range = parseMonthRange(message);
            if (!range?.months?.length || range.months.length < 2) {
                return 'Dime el rango de meses. Ejemplo: "comision acumulada de enero a marzo" o "ultimos 3 meses".';
            }
            const result = await aggregateCommissionsByMonths(
                conn, userCode, isJefeVentas, vendorScope, range.months
            );
            const list = result.months.map((row) =>
                `- ${row.label}: ${row.commission.toLocaleString('es-ES')} EUR sobre ${row.sales.toLocaleString('es-ES')} EUR`
            ).join('\n');
            const text = `**Comision acumulada (${result.months[0].label} - ${result.months[result.months.length - 1].label})**
- Comision total: **${result.totalCommission.toLocaleString('es-ES')} EUR**
- Ventas: **${result.totalSales.toLocaleString('es-ES')} EUR**
- Porcentaje medio: **${result.averageCommissionPercent}%**
- Operaciones: **${result.operations}**

${list}`;
            return reply(text, 'get_commissions_range', result);
        } catch (e) {
            return `Error obteniendo comisiones acumuladas: ${e.message}`;
        }
    }

    if (intentPatterns.comision.test(msg) && !intentPatterns.comisionDetalle.test(msg) && !intentPatterns.comisionConfig.test(msg)) {
        try {
            const result = await commissionTools.getCommissions(
                conn, userCode, isJefeVentas, codes.month, undefined, vendorScope
            );
            const text = `Comision ${result.month}/${result.year}:
**${result.commission.toLocaleString('es-ES')}€** sobre ventas de **${result.sales.toLocaleString('es-ES')}€** (${result.commissionPercent}%)
Clientes activos: ${result.activeClients} | Operaciones: ${result.operations}`;
            return reply(text, 'get_commissions', result);
        } catch (e) {
            return `Error obteniendo comisiones: ${e.message}`;
        }
    }

    // ── COMMISSION DETAILS ──
    if (intentPatterns.comisionDetalle.test(msg)) {
        if (!clientCode) {
            return 'Necesito el codigo de cliente. Ejemplo: "Detalle de comision del cliente 12345"';
        }
        const deniedCom = await denyIfForbiddenClient(clientCode);
        if (deniedCom) return deniedCom;
        try {
            const result = await commissionTools.getCommissionDetails(
                conn, userCode, isJefeVentas, clientCode, codes.month, undefined, vendorScope
            );
            if (result.details.length === 0) return 'Sin detalles de comision para este cliente.';
            const list = result.details.slice(0, 10).map(d => `- ${d.clientCode}: **${d.sales.toLocaleString('es-ES')}€** → Comision ${d.commission.toLocaleString('es-ES')}€`).join('\n');
            return reply(`Detalle de comisiones:\n${list}`, 'get_commission_details', result);
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    // ── OBJECTIVES ──
    if (intentPatterns.objetivoFamilia.test(msg)) {
        try {
            const familyCode = extractFamilyCode(message);
            const result = await objectivesTools.getObjectivesByFamily(
                conn, userCode, isJefeVentas, familyCode, codes.month, undefined, vendorScope
            );
            const families = result.families || [];
            if (families.length === 0) return 'Sin objetivos por familia para ese periodo.';
            const list = families.slice(0, 12).map((family) =>
                `- ${family.family}: ${family.achieved.toLocaleString('es-ES')} EUR de ${family.target.toLocaleString('es-ES')} EUR (${family.achievementPercent}%)`
            ).join('\n');
            return reply(`**Objetivos por familia ${result.month}/${result.year}**\n${list}`, 'get_objectives_by_family', result);
        } catch (e) {
            return `Error obteniendo objetivos por familia: ${e.message}`;
        }
    }

    if (intentPatterns.objetivo.test(msg)
        && (isAccumulatedQuery(msg) || (parseMonthRange(message)?.months?.length || 0) > 1)) {
        try {
            const range = parseMonthRange(message);
            if (!range?.months?.length || range.months.length < 2) {
                return 'Dime el rango de meses. Ejemplo: "objetivo acumulado de enero a marzo" o "objetivo ultimos 3 meses".';
            }
            const result = await aggregateObjectivesByMonths(
                conn, userCode, isJefeVentas, vendorScope, range.months
            );
            const list = result.months.map((row) =>
                `- ${row.label}: ${row.achieved.toLocaleString('es-ES')} EUR de ${row.target.toLocaleString('es-ES')} EUR (${row.achievementPercent}%)`
            ).join('\n');
            const text = `**Objetivo acumulado (${result.months[0].label} - ${result.months[result.months.length - 1].label})**
- Alcanzado: **${result.totalAchieved.toLocaleString('es-ES')} EUR**
- Objetivo: **${result.totalTarget.toLocaleString('es-ES')} EUR**
- Cumplimiento: **${result.achievementPercent}%**
- Pendiente: **${result.totalRemaining.toLocaleString('es-ES')} EUR**

${list}`;
            return reply(text, 'get_objectives_range', result);
        } catch (e) {
            return `Error obteniendo objetivos acumulados: ${e.message}`;
        }
    }

    if (intentPatterns.objetivo.test(msg) && !intentPatterns.objetivoFamilia.test(msg)) {
        try {
            const result = await objectivesTools.getObjectives(
                conn, userCode, isJefeVentas, codes.month, undefined, vendorScope
            );
            const status = result.achievementPercent >= 100 ? 'OBJETIVO CUMPLIDO' : `Faltan ${(result.target - result.achieved).toLocaleString('es-ES')}€`;
            const text = `Objetivo ${result.month}/${result.year}:
Alcanzado: **${result.achieved.toLocaleString('es-ES')}€** de ${result.target.toLocaleString('es-ES')}€ (**${result.achievementPercent}%**)
${status}`;
            return reply(text, 'get_objectives', result);
        } catch (e) {
            return `Error obteniendo objetivos: ${e.message}`;
        }
    }

    // ── MARGIN GLOBAL ──
    if (intentPatterns.margenGlobal.test(msg) || (intentPatterns.margen.test(msg) && !clientCode && !intentPatterns.precio.test(msg))) {
        try {
            const result = await commercialTools.getMarginGlobal(
                conn, userCode, isJefeVentas, codes.month, undefined, vendorScope
            );
            const text = `Margen ${result.month}/${result.year}:
Ventas: **${result.sales.toLocaleString('es-ES')}€** | Coste: ${result.cost.toLocaleString('es-ES')}€ | Beneficio: **${result.profit.toLocaleString('es-ES')}€**
Margen: **${result.marginPercent}%** | Clientes: ${result.clients} | Operaciones: ${result.operations}`;
            return reply(text, 'get_margin_global', result);
        } catch (e) {
            return `Error calculando margen: ${e.message}`;
        }
    }

    // ── MARGIN BY CLIENT ──
    if (intentPatterns.margen.test(msg) && clientCode) {
        const deniedMargen = await denyIfForbiddenClient(clientCode);
        if (deniedMargen) return deniedMargen;
        try {
            const result = await commercialTools.getMarginByClient(
                conn, clientCode, userCode, isJefeVentas, vendorScope
            );
            const text = `Margen cliente ${clientCode}:
Ventas: **${result.sales.toLocaleString('es-ES')}€** | Coste: ${result.cost.toLocaleString('es-ES')}€ | Beneficio: **${result.profit.toLocaleString('es-ES')}€**
Margen: **${result.marginPercent}%** | Operaciones: ${result.operations}`;
            return reply(text, 'query_client_profit', {
                ...result,
                clientCode,
                totals: { sales: result.sales },
                groups: [],
            });
        } catch (e) {
            return `Error calculando margen: ${e.message}`;
        }
    }

    // ── DEBT ──
    if (intentPatterns.deuda.test(msg)) {
        if (!clientCode) {
            return 'Necesito codigo de cliente. Ejemplo: "Deuda cliente 12345"';
        }
        const deniedDeuda = await denyIfForbiddenClient(clientCode);
        if (deniedDeuda) return deniedDeuda;
        try {
            const debt = await riskTools.getClientDebt(conn, clientCode);
            const aging = debt.aging || {};
            const totalDebt = Number(debt.totalDebt) || 0;
            const overdueDebt = Number(debt.overdueDebt) || 0;
            const status = debt.riskLevel === 'ALTO' ? 'ALTO RIESGO' : debt.riskLevel === 'MEDIO' ? 'RIESGO MEDIO' : 'BAJO RIESGO';
            const action = overdueDebt > 1000 ? 'No ampliar credito sin cobrar primero' : 'Estado de pago correcto';
            const text = `Deuda cliente ${clientCode} [${status}]
Pendiente: **${totalDebt.toLocaleString('es-ES')}€** | Vencido: **${overdueDebt.toLocaleString('es-ES')}€**
1-30d: ${(aging.days_1_30 || 0).toLocaleString('es-ES')}€ | 31-60d: ${(aging.days_31_60 || 0).toLocaleString('es-ES')}€ | 61-90d: ${(aging.days_61_90 || 0).toLocaleString('es-ES')}€ | +90d: **${(aging.days_over_90 || 0).toLocaleString('es-ES')}€**
${action}`;
            return reply(text, 'get_client_debt', { ...debt, clientCode });
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    // ── BLOCKED ──
    if (intentPatterns.bloqueo.test(msg)) {
        if (!clientCode) {
            return 'Necesito el codigo de cliente. Ejemplo: "Esta bloqueado el 12345?"';
        }
        const deniedBloq = await denyIfForbiddenClient(clientCode);
        if (deniedBloq) return deniedBloq;
        try {
            const blocked = await riskTools.checkClientBlocked(conn, clientCode);
            if (blocked.isBlocked) {
                return `**Cliente ${clientCode} - BLOQUEADO**

**Motivo**: ${blocked.blockReason}

**Accion requerida**: Contacta administracion para desbloquear.`;
            }
            return `**Cliente ${clientCode}** no esta bloqueado. Operaciones permitidas.`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    // ── RISK SCORE ──
    if (intentPatterns.riesgo.test(msg)) {
        if (!clientCode) {
            return 'Necesito el codigo de cliente. Ejemplo: "Riesgo del cliente 12345"';
        }
        const deniedRiesgo = await denyIfForbiddenClient(clientCode);
        if (deniedRiesgo) return deniedRiesgo;
        try {
            const risk = await riskTools.calculateRiskScore(conn, clientCode);
            return `**Evaluacion de Riesgo - Cliente ${clientCode}**

- Score: **${risk.riskScore}/100**
- Clasificacion: ${risk.riskLevel}

**Indicadores**:
${risk.alerts.length > 0 ? risk.alerts.map(a => `- ${a}`).join('\n') : '- Sin alertas activas'}

**Recomendacion**: ${risk.recommendation}`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    // ── CREDIT ──
    if (intentPatterns.credito.test(msg)) {
        if (!clientCode) {
            return 'Necesito el codigo de cliente. Ejemplo: "Credito del cliente 12345"';
        }
        const deniedCred = await denyIfForbiddenClient(clientCode);
        if (deniedCred) return deniedCred;
        try {
            const credit = await riskTools.getClientCreditLimit(conn, clientCode);
            return `**Credito Cliente ${clientCode}**

- Limite: ${credit.creditLimit.toLocaleString('es-ES')}€
- Utilizado: ${credit.usedCredit.toLocaleString('es-ES')}€
- Disponible: **${credit.availableCredit.toLocaleString('es-ES')}€**
- Uso: ${Math.round(credit.utilizationPercent)}%`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    // ── PRICE ──
    if (intentPatterns.precioCliente.test(msg) && clientCode && productCode) {
        const deniedPriceClient = await denyIfForbiddenClient(clientCode);
        if (deniedPriceClient) return deniedPriceClient;
        try {
            const result = await crossQueryTools.getPriceSoldToClient(conn, productCode, clientCode, 5);
            if (result.error) return result.error;
            const list = (result.sales || []).map((sale) =>
                `- ${sale.date}: ${sale.price.toLocaleString('es-ES')} EUR (${sale.quantity} uds, pedido ${sale.orderNumber || 'N/A'})`
            ).join('\n');
            return reply(`**Precio vendido al cliente ${clientCode} - producto ${productCode}**\n${list}`, 'get_price_sold_to_client', result);
        } catch (e) {
            return `Error consultando precio vendido al cliente: ${e.message}`;
        }
    }

    if (intentPatterns.precio.test(msg) && !intentPatterns.descuento.test(msg) && !intentPatterns.minimo.test(msg)) {
        if (!productCode) {
            return 'Necesito codigo de producto. Ejemplo: "Precio producto ABC123"';
        }
        try {
            const price = await pricingTools.getProductPrice(conn, productCode);
            if (!price.product.CODIGOARTICULO) return `Producto ${productCode} no registrado.`;
            const margen = price.tariffPrice > 0 ? Math.round(((price.tariffPrice - price.cost) / price.tariffPrice) * 100) : 0;
            return `Producto ${productCode}: ${price.product.DESCRIPCIONARTICULO?.trim() || 'Sin descripcion'}
Tarifa: **${price.tariffPrice.toLocaleString('es-ES')}€** | Coste: ${price.cost.toLocaleString('es-ES')}€ | Margen: ${margen}%
Ultimo vendido: ${price.lastSoldPrice.toLocaleString('es-ES')}€`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    // ── MINIMUM PRICE ──
    if (intentPatterns.minimo.test(msg)) {
        if (!productCode) {
            return 'Necesito codigo de producto. Ejemplo: "Precio minimo producto ABC123"';
        }
        try {
            const breakeven = await pricingTools.calculateBreakeven(conn, productCode);
            if (breakeven.error) return breakeven.error;
            return `Precio minimo producto ${productCode}:
Coste: ${breakeven.cost.toLocaleString('es-ES')}€ | Tarifa: ${breakeven.tariffPrice.toLocaleString('es-ES')}€
Precio suelo: **${breakeven.floorPrice.toLocaleString('es-ES')}€** (margen minimo ${breakeven.minMarginPercent}%)
Margen actual: ${Math.round(breakeven.currentMarginPercent)}%
No vender por debajo de ${breakeven.floorPrice.toLocaleString('es-ES')}€`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    // ── DISCOUNT SIMULATION ──
    if (intentPatterns.descuento.test(msg)) {
        if (!productCode) {
            return 'Necesito codigo de producto y descuento. Ejemplo: "Simula 10% descuento producto ABC123"';
        }
        try {
            const discountPercent = codes.percent || 10;
            const sim = await pricingTools.simulateDiscount(conn, productCode, discountPercent);
            if (sim.error) return sim.error;
            return `Descuento ${discountPercent}% — Producto ${productCode}:
Precio: ${sim.originalPrice.toLocaleString('es-ES')}€ → **${sim.newPrice.toLocaleString('es-ES')}€**
Margen: ${sim.originalMargin.toLocaleString('es-ES')}€ → **${sim.newMargin.toLocaleString('es-ES')}€**
${sim.profitable ? 'RENTABLE' : 'NO RENTABLE — genera perdidas'}`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    // ── CHURN ──
    if (intentPatterns.churn.test(msg)) {
        if (!clientCode) {
            return 'Necesito el codigo de cliente. Ejemplo: "Que dejo de comprar el 12345?"';
        }
        const deniedChurn = await denyIfForbiddenClient(clientCode);
        if (deniedChurn) return deniedChurn;
        try {
            const churn = await commercialTools.detectChurn(conn, clientCode);
            if (churn.count === 0) return `**Cliente ${clientCode}** - Sin productos abandonados detectados.`;
            const productList = churn.churnedProducts.slice(0, 5).map(p => `- ${p.code}: ${p.description || 'Sin desc.'}`).join('\n');
            return `**Productos Abandonados - Cliente ${clientCode}**

Detectados **${churn.count} productos** sin compra reciente:

${productList}
${churn.count > 5 ? `\n...y ${churn.count - 5} mas` : ''}

**Accion sugerida**: ${churn.actionSuggestion}`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    // ── COMPARE YoY ──
    if ((intentPatterns.yoy.test(msg) || intentPatterns.comparar.test(msg)) && !clientCode) {
        try {
            const result = await analyticsTools.getYoYComparison(
                conn, userCode, isJefeVentas, extractRequestedYear(message), codes.month, vendorScope
            );
            const text = `**Comparativa anual**
- ${result.currentYear.year}: **${result.currentYear.sales}** | Margen: ${result.currentYear.margin} | Clientes: ${result.currentYear.clients}
- ${result.lastYear.year}: **${result.lastYear.sales}** | Margen: ${result.lastYear.margin} | Clientes: ${result.lastYear.clients}
- Crecimiento ventas: **${result.growth.salesPercent}%**
- Crecimiento margen: **${result.growth.marginPercent}%**`;
            return reply(text, 'get_yoy_comparison', result);
        } catch (e) {
            return `Error consultando comparativa anual: ${e.message}`;
        }
    }

    if (intentPatterns.comparar.test(msg)) {
        if (!clientCode) {
            return 'Necesito un codigo de cliente para comparar. Ejemplo: "Comparar ventas del cliente 12345"';
        }
        const deniedCmp = await denyIfForbiddenClient(clientCode);
        if (deniedCmp) return deniedCmp;
        try {
            const comp = await commercialTools.compareClientYoY(conn, clientCode);
            const years = Object.keys(comp.yearlyData).sort((a, b) => b - a);
            const list = years.map(y => `- **${y}**: ${(comp.yearlyData[y].sales || 0).toLocaleString('es-ES')}€`).join('\n');
            let growth = '';
            if (years.length >= 2 && comp.yearlyData[years[1]].sales > 0) {
                const pct = Math.round(((comp.yearlyData[years[0]].sales - comp.yearlyData[years[1]].sales) / comp.yearlyData[years[1]].sales) * 100);
                growth = `\n**Variacion ${years[1]} → ${years[0]}**: ${pct > 0 ? '+' : ''}${pct}%`;
            }
            return `**Comparativa Anual - Cliente ${clientCode}**\n\n${list}${growth}`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    // ── STOCK ──
    if (intentPatterns.almacen.test(msg) && !productCode) {
        try {
            if (/veh[ií]culo|vehiculo|camiones|camion|matricula|flota/i.test(msg)) {
                const result = await warehouseTools.getVehicles(conn);
                const list = (result.vehicles || []).slice(0, 12).map((vehicle) =>
                    `- ${vehicle.code}: ${vehicle.description || 'Sin descripcion'} (${vehicle.matricula || 'sin matricula'})`
                ).join('\n');
                return reply(`**Vehiculos de almacen**\n${list || 'Sin vehiculos registrados.'}`, 'get_vehicles', result);
            }
            const result = await warehouseTools.getWarehouseDashboard(
                conn, extractRequestedYear(message), codes.month, undefined
            );
            const list = (result.trucks || []).slice(0, 12).map((truck) =>
                `- ${truck.vehicleCode}: ${truck.driverName || truck.driverCode || 'sin repartidor'} (${truck.orderCount} ordenes, ${truck.lineCount} lineas)`
            ).join('\n');
            return reply(`**Carga almacen ${result.date.day}/${result.date.month}/${result.date.year}**
- Camiones: **${result.totalTrucks}**

${list || 'Sin camiones planificados.'}`, 'get_warehouse_dashboard', result);
        } catch (e) {
            return `Error consultando almacen: ${e.message}`;
        }
    }

    if (intentPatterns.stock.test(msg)) {
        if (!productCode) {
            return 'Necesito codigo de producto. Ejemplo: "Stock producto ABC123"';
        }
        try {
            const stock = await logisticsTools.getStockByWarehouse(conn, productCode);
            if (stock.warehouses.length === 0) return `Sin stock para producto ${productCode}.`;
            const list = stock.warehouses.map(w => `- Almacen ${w.warehouse}: ${w.stock} uds`).join('\n');
            const status = stock.totalStock > 10 ? 'DISPONIBLE' : stock.totalStock > 0 ? 'STOCK BAJO' : 'SIN STOCK';
            return `Stock ${productCode} [${status}]
Total: **${stock.totalStock}** unidades
${list}`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    // ── INVOICES ──
    if (intentPatterns.factura.test(msg)) {
        if (invoiceNumber) {
            const deniedInv = await denyIfForbiddenInvoice(invoiceNumber);
            if (deniedInv) return deniedInv;
            try {
                if (/\b(pdf|leer|lee|extrae|extraer|documento|archivo)\b/i.test(msg)) {
                    const pdf = await genericAnalyticsTools.extractPdfContent(conn, 'factura', invoiceNumber);
                    if (pdf.error) return pdf.error;
                    const lineList = (pdf.structured?.lines || []).slice(0, 8).map((l) =>
                        `- ${l.description || l.productCode || 'Linea'}: ${l.quantity || 0} x ${l.unitPrice || 0}€ = ${l.amount || 0}€`
                    ).join('\n');
                    const detectedText = pdf.pdfText
                        ? `\n\nTexto detectado del PDF:\n${pdf.pdfText.slice(0, 900)}${pdf.pdfText.length > 900 ? '...' : ''}`
                        : '';
                    const text = `**Lectura de factura ${pdf.reference || invoiceNumber}**
- Cliente: ${pdf.clientCode || 'N/A'}
- Importe: **${(pdf.amount || 0).toLocaleString('es-ES')}€**
- Fecha: ${pdf.issueDate || 'N/A'}
- Fuente: ${pdf.hint || pdf.extractionMethod || 'DB2/PDF'}
- Lineas:
${lineList || '- Sin lineas estructuradas'}${detectedText}`;
                    return reply(text, 'extract_pdf_content', pdf);
                }
                const inv = await invoiceTools.getInvoiceDetails(
                    conn, invoiceNumber, userCode, isJefeVentas, vendorScope
                );
                if (inv.error) return inv.error;
                const lineList = (inv.lines || []).slice(0, 10).map((l) =>
                    `- ${l.description}: ${l.quantity} x ${l.unitPrice}€ = ${l.amount}€ (alb. ${l.albaranNumber || 'N/A'})`
                ).join('\n');
                const text = `**Factura ${inv.invoiceNumber}**
- Cliente: ${inv.clientCode}
- Importe: **${inv.amount.toLocaleString('es-ES')}€** | Pendiente: ${(inv.pendingAmount || 0).toLocaleString('es-ES')}€
- Estado: ${inv.status} | Emisión: ${inv.issueDate || 'N/A'} | Vencimiento: ${inv.dueDate || 'N/A'}
- Líneas (${inv.lineCount || 0}):
${lineList || '- Sin líneas'}`;
                return reply(text, 'get_invoice_details', inv);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }
        if (clientCode) {
            const deniedFc = await denyIfForbiddenClient(clientCode);
            if (deniedFc) return deniedFc;
            try {
                const invs = await invoiceTools.getClientInvoices(conn, clientCode);
                if (!invs.invoices || invs.invoices.length === 0) {
                    return `Sin facturas pendientes para cliente ${clientCode}.`;
                }
                const list = invs.invoices.slice(0, 10).map(i =>
                    `- ${i.number}: **${i.amount.toLocaleString('es-ES')}€** | ${i.status}`
                ).join('\n');
                const text = `Facturas pendientes cliente ${clientCode} (total: **${invs.totalAmount.toLocaleString('es-ES')}€**):\n${list}`;
                return reply(text, 'get_client_invoices', invs);
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }
        return 'Necesito un numero de factura o codigo de cliente. Ejemplo: "Factura F2024-001" o "Facturas del cliente 12345"';
    }

    // ── ALBARANES ──
    if (intentPatterns.albaran.test(msg)) {
        if (invoiceNumber) {
            const deniedAlb = await denyIfForbiddenInvoice(invoiceNumber);
            if (deniedAlb) return deniedAlb;
            try {
                const albs = await invoiceTools.getAlbaranesByInvoice(
                    conn, invoiceNumber, userCode, isJefeVentas, vendorScope
                );
                if (albs.error) return albs.error;
                if (albs.albaranes.length === 0) return `Sin albaranes para factura ${invoiceNumber}.`;
                const list = albs.albaranes.map(a => `- ${a.number}: ${a.amount?.toLocaleString('es-ES')}€`).join('\n');
                return `Albaranes de factura ${invoiceNumber}:\n${list}`;
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }
        return 'Necesito el numero de factura. Ejemplo: "Albaranes de la factura F2024-001"';
    }

    // ── SEARCH CLIENT ──
    if (intentPatterns.buscarCliente.test(msg)) {
        const searchTerm = msg.replace(/buscar\s*(cliente|client)?\s*/i, '').trim();
        if (!searchTerm) return 'Que cliente buscas? Ejemplo: "Buscar cliente Garcia"';
        try {
            const clients = await dbDiscoveryTools.searchClients(conn, searchTerm);
            if (clients.length === 0) return `No se encontraron clientes con "${searchTerm}".`;
            const authorized = [];
            for (const c of clients.slice(0, 15)) {
                const code = c.CODIGO || c.code;
                if (!code) continue;
                const denied = await denyIfForbiddenClient(String(code));
                if (!denied) authorized.push(c);
                if (authorized.length >= 10) break;
            }
            if (authorized.length === 0) {
                return 'No tengo clientes autorizados que coincidan con esa busqueda.';
            }
            const list = authorized.map(c =>
                `- ${c.NOMBRE} (${c.CODIGO}) - ${c.POBLACION || ''}`
            ).join('\n');
            return `Clientes encontrados:\n${list}`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    // ── SEARCH PRODUCT ──
    if (intentPatterns.buscarProducto.test(msg)) {
        const searchTerm = msg.replace(/buscar\s*(producto|articulo)?\s*/i, '').trim();
        if (!searchTerm) return 'Que producto buscas? Ejemplo: "Buscar producto leche"';
        try {
            const products = await dbDiscoveryTools.searchProducts(conn, searchTerm);
            if (products.length === 0) return `No se encontraron productos con "${searchTerm}".`;
            const list = products.slice(0, 10).map(p => `- ${p.NOMBRE} (${p.CODIGO})`).join('\n');
            return `Productos encontrados:\n${list}`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    // ── EVALUACIÓN / EVOLUCIÓN PEDIDOS (productos por mes) ──
    if (intentPatterns.top.test(msg)) {
        try {
            if (clientCode && /producto|articulo|referencia/i.test(msg)) {
                const deniedTopClient = await denyIfForbiddenClient(clientCode);
                if (deniedTopClient) return deniedTopClient;
                const result = await crossQueryTools.getTopProductsByClient(
                    conn, clientCode, codes.month, undefined, 10
                );
                const list = (result.products || []).map((product, index) =>
                    `${index + 1}. ${product.name || product.code}: ${product.totalSales.toLocaleString('es-ES')} EUR (${product.totalUnits || 0} uds)`
                ).join('\n');
                return reply(`**Top productos cliente ${clientCode} ${result.month}/${result.year}**\n${list || 'Sin productos para ese periodo.'}`, 'get_top_products_by_client', result);
            }

            if (/producto|articulo|referencia/i.test(msg)) {
                const result = await analyticsTools.getTopProducts(
                    conn, userCode, isJefeVentas, codes.month, undefined, 10, vendorScope
                );
                const list = (result.products || []).map((product, index) =>
                    `${index + 1}. ${product.name || product.productCode}: ${product.sales.toLocaleString('es-ES')} EUR (${product.quantity || 0} uds)`
                ).join('\n');
                return reply(`**Top productos ${result.month}/${result.year}**\n${list || 'Sin productos para ese periodo.'}`, 'get_top_products', result);
            }

            const result = await analyticsTools.getTopClients(
                conn, userCode, isJefeVentas, codes.month, undefined, 10, vendorScope
            );
            const list = (result.clients || []).map((client, index) =>
                `${index + 1}. ${client.name || client.clientCode}: ${client.sales.toLocaleString('es-ES')} EUR (${client.numProducts || 0} productos)`
            ).join('\n');
            return reply(`**Top clientes ${result.month}/${result.year}**\n${list || 'Sin clientes para ese periodo.'}`, 'get_top_clients', result);
        } catch (err) {
            logger.error('[CHATBOT] Top analytics error:', err.message);
            return 'Error consultando ranking.';
        }
    }

    if ((intentPatterns.productosCliente.test(msg) || intentPatterns.ventasCliente.test(msg)
        || intentPatterns.historial.test(msg)) && clientCode) {
        const deniedEval = await denyIfForbiddenClient(clientCode);
        if (deniedEval) return deniedEval;
        try {
            if (intentPatterns.ventasCliente.test(msg) && !intentPatterns.productosCliente.test(msg)) {
                const sales = await crossQueryTools.getClientMonthlySales(conn, clientCode, 12);
                const monthly = sales?.monthly || [];
                if (monthly.length === 0) {
                    return `Sin ventas mensuales para cliente ${clientCode}.`;
                }
                const list = monthly.map((s) =>
                    `- ${s.period}: ${s.totalSales.toLocaleString('es-ES')}€ (${s.totalUnits || 0} uds)`
                ).join('\n');
                return `**Ventas mensuales cliente ${clientCode}:**\n${list}`;
            }
            const products = await crossQueryTools.getClientProductsBought(conn, clientCode, 15);
            const items = products?.products || [];
            if (items.length === 0) {
                return `Sin productos registrados para cliente ${clientCode}.`;
            }
            const list = items.map((p) =>
                `- ${p.name}: ${p.totalSales.toLocaleString('es-ES')}€ (${p.totalUnits || 0} uds)`
            ).join('\n');
            return `**Productos comprados (evaluación) cliente ${clientCode}:**\n${list}`;
        } catch (err) {
            logger.error('[CHATBOT] Client evaluation error:', err.message);
            return 'Error consultando evaluación del cliente.';
        }
    }

    // ── PEDIDOS ──
    if (intentPatterns.repartidor.test(msg)) {
        try {
            if (intentPatterns.comision.test(msg)) {
                const result = await repartidorTools.getRepartidorCommissions(conn, userCode, codes.month, undefined);
                const text = `**Comision repartidor ${result.month}/${result.year}**
- Cobrado: **${result.collected.toLocaleString('es-ES')} EUR**
- A cobrar: ${result.collectable.toLocaleString('es-ES')} EUR
- Porcentaje: **${result.percentage}%**
- Comision: **${result.commission.toLocaleString('es-ES')} EUR**
- Umbral: ${result.thresholdMet ? 'cumplido' : 'pendiente'}`;
                return reply(text, 'get_repartidor_commissions', result);
            }

            if (/cobro|liquidacion|liquidaci[oó]n|recaud/i.test(msg)) {
                const result = await repartidorTools.getRepartidorCollections(conn, userCode, codes.month, undefined);
                const list = (result.clients || []).slice(0, 10).map((client) =>
                    `- ${client.clientName || client.clientCode}: ${client.collected.toLocaleString('es-ES')} EUR de ${client.collectable.toLocaleString('es-ES')} EUR (${client.percentage}%)`
                ).join('\n');
                const text = `**Cobros repartidor ${result.month}/${result.year}**
- Cobrado: **${result.summary.totalCollected.toLocaleString('es-ES')} EUR**
- A cobrar: ${result.summary.totalCollectable.toLocaleString('es-ES')} EUR
- Avance: **${result.summary.overallPercentage}%**

${list}`;
                return reply(text, 'get_repartidor_collections', result);
            }

            const result = await repartidorTools.getRepartidorDeliveries(
                conn, userCode, extractRequestedYear(message), codes.month, undefined
            );
            const text = `**Ruta repartidor ${result.day}/${result.month}/${result.year}**
- Entregas: **${result.totalDeliveries}**
- Lineas: **${result.totalLines}**
- Completadas: ${result.completed}
- Pendientes: ${result.pending}`;
            return reply(text, 'get_repartidor_deliveries', result);
        } catch (err) {
            logger.error('[CHATBOT] Repartidor error:', err.message);
            return 'Error consultando rutero.';
        }
    }

    if (intentPatterns.pedido.test(msg) && orderNumber) {
        const ownerClient = await pedidosTools.resolveOrderClientCode(conn, orderNumber);
        if (!ownerClient) return `Pedido ${orderNumber} no encontrado.`;
        const deniedOrder = await denyIfForbiddenClient(ownerClient);
        if (deniedOrder) return deniedOrder;
        try {
            const order = await pedidosTools.getOrderDetails(
                conn, orderNumber, userCode, isJefeVentas, vendorScope
            );
            if (order.error) return order.error;
            const lines = (order.lines || []).slice(0, 10).map((line) =>
                `- ${line.description || line.productCode}: ${line.quantity} x ${line.unitPrice} EUR = ${line.amount} EUR`
            ).join('\n');
            const text = `**Pedido ${order.orderNumber}**
- Cliente: ${order.clientCode}
- Fecha: ${order.date || 'N/A'}
- Estado: ${order.status}
- Importe: **${order.amount.toLocaleString('es-ES')} EUR**
- Lineas (${order.lineCount || 0}):
${lines || '- Sin lineas'}`;
            return reply(text, 'get_order_details', order);
        } catch (err) {
            logger.error('[CHATBOT] Order details error:', err.message);
            return 'Error consultando pedido.';
        }
    }

    if (intentPatterns.pedido.test(msg) && clientCode) {
        const deniedPed = await denyIfForbiddenClient(clientCode);
        if (deniedPed) return deniedPed;
        try {
            const orders = await pedidosTools.getClientOrders(
                conn, clientCode, userCode, isJefeVentas, 10, vendorScope
            );
            const list = orders.orders || [];
            if (list.length === 0) return `Sin pedidos para cliente ${clientCode}.`;
            const text = list.slice(0, 10).map((o) =>
                `- Pedido ${o.orderNumber}: ${o.amount.toLocaleString('es-ES')}€ (${o.date || ''})`
            ).join('\n');
            return `**Pedidos cliente ${clientCode}:**\n${text}`;
        } catch (err) {
            logger.error('[CHATBOT] Client orders error:', err.message);
            return 'Error consultando pedidos.';
        }
    }

    // ── COBROS ──
    if (intentPatterns.pedido.test(msg) && !clientCode) {
        try {
            const result = await pedidosTools.getDailyOrders(
                conn, userCode, isJefeVentas, undefined, codes.month, undefined, vendorScope
            );
            const text = `**Pedidos ${result.day}/${result.month}/${result.year}**
- Pedidos: **${result.totalOrders}**
- Clientes: **${result.totalClients}**
- Importe: **${result.totalAmount.toLocaleString('es-ES')}€**`;
            return reply(text, 'get_daily_orders', result);
        } catch (err) {
            logger.error('[CHATBOT] Daily orders error:', err.message);
            return 'Error consultando pedidos del dia.';
        }
    }

    if (intentPatterns.cobro.test(msg) && clientCode) {
        const deniedCob = await denyIfForbiddenClient(clientCode);
        if (deniedCob) return deniedCob;
        try {
            const cobros = await cobrosTools.getPendingCobros(conn, clientCode);
            const docs = cobros?.documents || [];
            if (docs.length === 0) {
                return `Sin cobros pendientes para cliente ${clientCode}.`;
            }
            const list = docs.slice(0, 10).map((c) =>
                `- ${c.number}: ${c.pending.toLocaleString('es-ES')}€ pendiente (vence ${c.dueDate || 'N/A'})`
            ).join('\n');
            return `**Cobros pendientes cliente ${clientCode}** (total ${cobros.totalPending.toLocaleString('es-ES')}€):\n${list}`;
        } catch (err) {
            logger.error('[CHATBOT] Cobros error:', err.message);
            return 'Error consultando cobros.';
        }
    }

    // ── BOLSA ──
    if (intentPatterns.cobro.test(msg) && !clientCode) {
        try {
            const result = await cobrosTools.getCobrosSummary(
                conn, userCode, isJefeVentas, codes.month, undefined, vendorScope
            );
            const text = `**Resumen cobros ${result.month}/${result.year}**
- A cobrar: **${result.totalCollectable.toLocaleString('es-ES')}€**
- Cobrado: **${result.totalCollected.toLocaleString('es-ES')}€**
- Pendiente: **${result.totalPending.toLocaleString('es-ES')}€**
- Avance: **${result.collectionPercent}%**`;
            return reply(text, 'get_cobros_summary', result);
        } catch (err) {
            logger.error('[CHATBOT] Cobros summary error:', err.message);
            return 'Error consultando resumen de cobros.';
        }
    }

    if (intentPatterns.glacius.test(msg)) {
        try {
            const result = await summaryTools.getDailySummary(
                conn, userCode, isJefeVentas, undefined, codes.month, undefined, vendorScope
            );
            const text = `**Glacius / Panel comercial ${result.day}/${result.month}/${result.year}**
- Ventas: **${result.totalSales.toLocaleString('es-ES')} EUR**
- Pedidos: **${result.totalOrders}**
- Clientes: **${result.totalClients}**
- Operaciones: **${result.totalOperations}**

Desde aqui puedo ampliar con top clientes, pedidos, cobros, facturas o evolucion.`;
            return reply(text, 'get_daily_summary', result, {
                suggestedFollowUps: [
                    'Top clientes del mes',
                    'Pedidos hoy',
                    'Cobros pendientes',
                    'Evolucion ventas',
                ],
            });
        } catch (err) {
            logger.error('[CHATBOT] Glacius summary error:', err.message);
            return 'Error consultando Glacius.';
        }
    }

    if (intentPatterns.resumen.test(msg)) {
        try {
            const result = await summaryTools.getDailySummary(
                conn, userCode, isJefeVentas, undefined, codes.month, undefined, vendorScope
            );
            const text = `**Resumen comercial ${result.day}/${result.month}/${result.year}**
- Ventas: **${result.totalSales.toLocaleString('es-ES')}€**
- Pedidos: **${result.totalOrders}**
- Clientes: **${result.totalClients}**
- Operaciones: **${result.totalOperations}**`;
            return reply(text, 'get_daily_summary', result);
        } catch (err) {
            logger.error('[CHATBOT] Daily summary error:', err.message);
            return 'Error consultando resumen comercial.';
        }
    }

    if (intentPatterns.bolsa.test(msg)) {
        try {
            if (/movimientos?|detalle|uso|usos|operaciones/i.test(msg)) {
                const result = await bolsaTools.getBolsaMovements(conn, userCode, codes.month, undefined, 20);
                const list = (result.movements || []).slice(0, 12).map((movement) =>
                    `- ${movement.fecha || 'sin fecha'}: ${movement.tipo} ${movement.importe.toLocaleString('es-ES')} EUR (${movement.descripcion || movement.codigoArticulo || 'sin descripcion'})`
                ).join('\n');
                return reply(`**Movimientos bolsa ${result.month}/${result.year}**\n${list || 'Sin movimientos de bolsa.'}`, 'get_bolsa_movements', result);
            }

            if (/historial|evolucion|evoluci[oó]n|ultim|meses/i.test(msg)) {
                const months = Math.min(Math.max(parseInt((msg.match(/\b(\d{1,2})\s+meses\b/) || [])[1], 10) || 12, 1), 12);
                const result = await bolsaTools.getBolsaHistory(conn, userCode, months);
                const list = (result.points || []).map((point) =>
                    `- ${point.mes}/${point.ejercicio}: acumulado ${point.acumulado.toLocaleString('es-ES')} EUR, consumido ${point.consumido.toLocaleString('es-ES')} EUR`
                ).join('\n');
                return reply(`**Historial bolsa ${months} meses**
- Acumulado: **${result.totals.acumulado.toLocaleString('es-ES')} EUR**
- Consumido: **${result.totals.consumido.toLocaleString('es-ES')} EUR**
- Saldo neto: **${result.totals.saldoNeto.toLocaleString('es-ES')} EUR**

${list}`, 'get_bolsa_history', result);
            }

            const bolsa = await bolsaTools.getBolsaStatus(conn, userCode, codes.month, undefined);
            if (!bolsa) return 'Sin datos de bolsa comercial.';
            const text = `**Bolsa comercial ${bolsa.month}/${bolsa.year}**
Saldo disponible: **${bolsa.saldoDisponible.toLocaleString('es-ES')} EUR** | Consumido: ${bolsa.consumido.toLocaleString('es-ES')} EUR | Acumulado: ${bolsa.acumulado.toLocaleString('es-ES')} EUR`;
            return reply(text, 'get_bolsa_status', bolsa);
        } catch (err) {
            logger.error('[CHATBOT] Bolsa error:', err.message);
            return 'Error consultando bolsa.';
        }
    }

    // ── EVOLUCIÓN GLOBAL ──
    if (intentPatterns.evolucion.test(msg) && !clientCode) {
        try {
            const evo = await evolutionTools.getSalesEvolution(
                conn, userCode, isJefeVentas, 12, vendorScope
            );
            const monthly = evo?.monthly || [];
            if (monthly.length === 0) return 'Sin datos de evolución de ventas.';
            const list = monthly.slice(-12).map((e) =>
                `- ${e.period}: ${e.totalVentas.toLocaleString('es-ES')}€ (margen ${e.margenPct}%)`
            ).join('\n');
            return reply(`**Evolución ventas (12 meses):**\n${list}`, 'get_sales_evolution', evo);
        } catch (err) {
            logger.error('[CHATBOT] Evolution error:', err.message);
            return 'Error consultando evolución.';
        }
    }

    // ── DEFAULT ──
    return reply(`No he podido encajar la consulta con seguridad, pero puedo seguir si me das una pista mas concreta.

Puedes preguntarme de forma natural por:
- Clientes: deuda, facturas, pedidos, riesgo, ventas, productos comprados.
- Rutero/repartidor: ruta de hoy, entregas, cobros y comision de reparto.
- Comisiones: mes, acumulado entre meses, detalle y reglas de calculo.
- Objetivos: objetivo del mes, acumulado, familias y cuanto falta.
- Facturas/PDF: busca una factura, abre el PDF y extrae lineas, importes o vencimientos.
- Glacius/bolsa/almacen: resumen diario, movimientos, camiones, carga y KPIs.

Ejemplos:
- "comision acumulada de enero a marzo"
- "objetivo ultimos 3 meses"
- "facturas del cliente Central Hoteles"
- "lee la factura F/100/2026"
- "mi ruta hoy y cobros pendientes"`, null, null, {
        deepLink: { tab: 'Chat IA' },
        suggestedFollowUps: [
            'Que puedes hacer por pestanas',
            'Comision acumulada ultimos 3 meses',
            'Objetivo acumulado enero a marzo',
            'Resumen Glacius hoy',
            'Mi ruta hoy y cobros del repartidor',
        ],
    });
}

module.exports = { handleChatMessage };
