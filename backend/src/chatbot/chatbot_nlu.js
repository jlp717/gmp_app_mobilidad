'use strict';

const COMMON_TYPO_MAP = new Map([
    ['facutra', 'factura'], ['fatura', 'factura'], ['factu', 'factura'],
    ['fra', 'factura'], ['fras', 'facturas'], ['alb', 'albaran'],
    ['alvaran', 'albaran'], ['albaranes', 'albaranes'],
    ['clinte', 'cliente'], ['clte', 'cliente'], ['cte', 'cliente'],
    ['cli', 'cliente'], ['deudad', 'deuda'], ['deuada', 'deuda'],
    ['cobor', 'cobro'], ['cobros', 'cobros'], ['pend', 'pendiente'],
    ['pte', 'pendiente'], ['ptes', 'pendientes'], ['comicion', 'comision'],
    ['comsion', 'comision'], ['comi', 'comision'], ['obj', 'objetivo'],
    ['obje', 'objetivo'], ['obejtivo', 'objetivo'], ['rutra', 'ruta'],
    ['rutero', 'ruta'], ['repart', 'repartidor'], ['glasius', 'glacius'],
    ['glac', 'glacius'], ['alm', 'almacen'], ['almacen', 'almacen'],
    ['stok', 'stock'], ['stcok', 'stock'], ['prec', 'precio'],
    ['pvp', 'precio'], ['margen', 'margen'], ['margn', 'margen'],
    ['migass', 'migas'], ['miga', 'migas'],
]);

const STOP_WORDS = new Set([
    'a', 'al', 'algo', 'con', 'contra', 'cual', 'cuales', 'cuando',
    'cuanto', 'cuantos', 'dame', 'de', 'del', 'dentro', 'di', 'dime',
    'el', 'en', 'entre', 'esa', 'ese', 'esta', 'este', 'estos', 'hacer',
    'la', 'las', 'le', 'lo', 'los', 'me', 'mi', 'mis', 'para', 'por',
    'que', 'quiero', 'saber', 'segun', 'sobre', 'su', 'sus', 'tengo',
    'un', 'una', 'ver', 'y',
]);

const DOMAIN_CATALOG = [
    {
        id: 'clientes',
        tab: 'Clientes',
        label: 'Clientes',
        keywords: ['cliente', 'clientes', 'deuda', 'riesgo', 'credito', 'bloqueo', 'ventas', 'compras', 'historial', 'moroso', 'impagado', 'central', 'hotel'],
        intents: ['client_search', 'debt', 'risk', 'credit', 'client_sales', 'client_products', 'client_profile'],
        examples: ['Evalua el cliente Central Hoteles', 'Deuda del cliente 32258', 'Que ha comprado este cliente'],
    },
    {
        id: 'productos',
        tab: 'Pedidos',
        label: 'Productos',
        keywords: ['producto', 'productos', 'articulo', 'referencia', 'precio', 'stock', 'migas', 'pollo', 'tarifa', 'pvp', 'coste', 'minimo', 'descuento'],
        intents: ['product_search', 'price', 'stock', 'discount', 'minimum_price'],
        examples: ['Dime el producto de migas', 'Precio producto migas', 'Stock producto pollo'],
    },
    {
        id: 'facturas',
        tab: 'Facturas',
        label: 'Facturas y PDF',
        keywords: ['factura', 'facturas', 'pdf', 'vencimiento', 'importe', 'lineas', 'albaran', 'albaranes', 'cfc', 'cac'],
        intents: ['invoice_search', 'invoice_detail', 'pdf_read', 'delivery_notes'],
        examples: ['Lee la factura F/100/2026', 'Facturas del cliente Central Hoteles', 'Que vencimiento tiene esta factura'],
    },
    {
        id: 'pedidos',
        tab: 'Pedidos',
        label: 'Pedidos',
        keywords: ['pedido', 'pedidos', 'orden', 'preparacion', 'estado', 'servir', 'entrega'],
        intents: ['order_status', 'client_orders', 'daily_orders'],
        examples: ['Pedidos de hoy', 'Pedidos del cliente 32258', 'Estado del pedido 12345'],
    },
    {
        id: 'cobros',
        tab: 'Cobros',
        label: 'Cobros',
        keywords: ['cobro', 'cobros', 'cobrar', 'pendiente', 'vencido', 'recaudado', 'impagado'],
        intents: ['collections_summary', 'client_pending_collections'],
        examples: ['Cobros pendientes', 'Que me debe este cliente', 'Cobros del mes'],
    },
    {
        id: 'comisiones',
        tab: 'Comisiones',
        label: 'Comisiones',
        keywords: ['comision', 'comisiones', 'devengo', 'liquidacion', 'sueldo', 'gano', 'ipc'],
        intents: ['commission_summary', 'commission_range', 'commission_rules'],
        examples: ['Comision acumulada enero a marzo', 'Mis comisiones del mes', 'Como se calcula mi comision'],
    },
    {
        id: 'objetivos',
        tab: 'Objetivos',
        label: 'Objetivos',
        keywords: ['objetivo', 'objetivos', 'meta', 'cumplimiento', 'avance', 'falta', 'familia', 'target'],
        intents: ['objective_summary', 'objective_range', 'objective_family'],
        examples: ['Objetivo acumulado ultimos 3 meses', 'Cuanto me falta para el objetivo', 'Objetivo por familia'],
    },
    {
        id: 'ruta',
        tab: 'Ruta',
        label: 'Ruta y repartidor',
        keywords: ['ruta', 'repartidor', 'reparto', 'entrega', 'entregas', 'liquidacion', 'camion'],
        intents: ['route_today', 'driver_collections', 'driver_commission'],
        examples: ['Mi ruta hoy', 'Cobros del repartidor', 'Comision de reparto'],
    },
    {
        id: 'glacius',
        tab: 'Glacius',
        label: 'Glacius',
        keywords: ['glacius', 'panel', 'kpi', 'resumen', 'hoy', 'alerta', 'ventas', 'operaciones'],
        intents: ['daily_summary', 'kpi_summary', 'alerts'],
        examples: ['Resumen Glacius hoy', 'Top clientes del mes', 'Como va el dia'],
    },
    {
        id: 'bolsa',
        tab: 'Bolsa',
        label: 'Bolsa',
        keywords: ['bolsa', 'saldo', 'consumido', 'acumulado', 'movimientos'],
        intents: ['bag_status', 'bag_movements', 'bag_history'],
        examples: ['Saldo bolsa', 'Movimientos bolsa', 'Historial bolsa 6 meses'],
    },
];

function normalizeText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s/.-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function correctToken(token) {
    if (COMMON_TYPO_MAP.has(token)) return COMMON_TYPO_MAP.get(token);
    if (token.length < 5) return token;
    for (const [wrong, right] of COMMON_TYPO_MAP.entries()) {
        if (Math.abs(wrong.length - token.length) > 1) continue;
        if (levenshteinDistance(wrong, token) <= 1) return right;
    }
    return token;
}

function levenshteinDistance(a, b) {
    const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
    }
    return dp[a.length][b.length];
}

function tokenize(value) {
    return normalizeText(value)
        .split(' ')
        .map(correctToken)
        .filter(Boolean);
}

function inferDateHint(normalized) {
    if (/hoy|dia/.test(normalized)) return 'today';
    if (/ayer/.test(normalized)) return 'yesterday';
    if (/semana/.test(normalized)) return 'week';
    if (/mes|mensual|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|jun|jul|ago|sep|oct|nov|dic/.test(normalized)) return 'month';
    if (/trimestre|q[1-4]|t[1-4]/.test(normalized)) return 'quarter';
    if (/ano|anual|202\d|201\d/.test(normalized)) return 'year';
    return null;
}

function extractEntityHint(original, normalized, type) {
    const keywordGroups = {
        product: ['producto', 'productos', 'articulo', 'articulos', 'referencia', 'stock', 'precio'],
        client: ['cliente', 'clientes', 'deuda', 'riesgo', 'facturas', 'pedidos', 'cobros'],
    };
    const stop = new Set([...STOP_WORDS, ...keywordGroups.product, ...keywordGroups.client]);
    const tokens = normalizeText(original || normalized)
        .split(' ')
        .map(correctToken)
        .filter((token) => token.length >= 3 && !stop.has(token) && !/^\d{4,10}$/.test(token));
    if (tokens.length === 0) return null;

    const anchor = keywordGroups[type].find((keyword) => normalized.includes(keyword));
    if (!anchor) return tokens.join(' ');
    return tokens.join(' ');
}

function scoreDomains(tokens, normalized) {
    return DOMAIN_CATALOG.map((domain) => {
        let score = 0;
        for (const keyword of domain.keywords) {
            if (tokens.includes(keyword)) score += 3;
            if (normalized.includes(keyword)) score += 1;
        }
        for (const intent of domain.intents) {
            const intentToken = intent.split('_')[0];
            if (tokens.includes(intentToken)) score += 2;
        }
        return { ...domain, score };
    })
        .filter((domain) => domain.score > 0)
        .sort((a, b) => b.score - a.score);
}

function inferIntents(tokens, normalized) {
    const intents = new Set();
    const has = (...words) => words.some((word) => tokens.includes(word) || normalized.includes(word));
    if (has('precio', 'tarifa', 'pvp', 'cuesta', 'vale')) intents.add('price');
    if (has('stock', 'existencias', 'inventario', 'queda')) intents.add('stock');
    if (has('factura', 'facturas')) intents.add('invoice_search');
    if (has('pdf', 'leer', 'lineas')) intents.add('pdf_read');
    if (has('deuda', 'debe', 'vencido', 'impagado')) intents.add('debt');
    if (has('riesgo', 'bloqueo', 'credito')) intents.add('risk');
    if (has('comision', 'devengo', 'liquidacion')) intents.add('commission_summary');
    if (has('objetivo', 'meta', 'cumplimiento', 'falta')) intents.add('objective_summary');
    if (has('ruta', 'repartidor', 'entrega')) intents.add('route_today');
    if (has('bolsa', 'saldo')) intents.add('bag_status');
    if (has('glacius', 'resumen', 'kpi')) intents.add('daily_summary');
    if (has('pedido', 'pedidos')) intents.add('order_status');
    if (has('cliente', 'clientes')) intents.add('client_search');
    if (has('producto', 'productos', 'articulo', 'referencia')) intents.add('product_search');
    if (/top|ranking|mejor|mejores/.test(normalized)) intents.add('ranking');
    if (/acumulado|ultimos|desde|hasta|entre|trimestre/.test(normalized)) intents.add('range');
    return [...intents];
}

function analyzeCommercialQuery(message) {
    const normalizedRaw = normalizeText(message);
    const tokens = tokenize(message);
    const normalized = tokens.join(' ');
    const domains = scoreDomains(tokens, normalized);
    const intents = inferIntents(tokens, normalized);
    const topDomain = domains[0] || null;
    const productName = extractEntityHint(message, normalized, 'product');
    const clientName = extractEntityHint(message, normalized, 'client');

    return {
        original: String(message || ''),
        normalizedRaw,
        normalized,
        tokens,
        domains: domains.slice(0, 4),
        topDomain: topDomain ? {
            id: topDomain.id,
            tab: topDomain.tab,
            label: topDomain.label,
            score: topDomain.score,
        } : null,
        intents,
        confidence: topDomain ? Math.min(0.95, topDomain.score / 10) : 0,
        dateHint: inferDateHint(normalized),
        entityHints: {
            productName,
            clientName,
        },
        needsClarification: !topDomain || topDomain.score < 3,
    };
}

function buildCapabilityText() {
    const lines = DOMAIN_CATALOG.map((domain) =>
        `- **${domain.label}**: ${domain.examples.join(' | ')}`
    ).join('\n');
    return `**Cobertura profesional del Copiloto GMP**\n\n${lines}\n\nPuedes escribir de forma incompleta: "migas", "central hoteles deuda", "obj acum ene mar", "factura pdf F/100/2026".`;
}

function buildClarifyingResponse(analysis, discoveries = {}) {
    const candidates = [];
    if (discoveries.products?.length) {
        candidates.push('He encontrado productos posibles; dime si quieres precio, stock o ventas.');
    }
    if (discoveries.clients?.length) {
        candidates.push('He encontrado clientes posibles; dime si quieres deuda, facturas, pedidos o evaluacion.');
    }
    const domains = analysis.domains.length
        ? analysis.domains.map((domain) => domain.label).join(', ')
        : 'clientes, productos, facturas, comisiones, objetivos o ruta';
    const examples = (analysis.domains[0]?.examples || DOMAIN_CATALOG.flatMap((d) => d.examples).slice(0, 4))
        .slice(0, 4)
        .map((example) => `- ${example}`)
        .join('\n');
    return `No tengo suficiente precision para ejecutar una consulta segura.\n\nCreo que puede ir sobre: **${domains}**.\n${candidates.length ? `\n${candidates.join('\n')}\n` : ''}\nPrueba asi:\n${examples}`;
}

function buildFollowUps(analysis) {
    const domain = DOMAIN_CATALOG.find((item) => item.id === analysis.topDomain?.id);
    const examples = domain ? domain.examples : DOMAIN_CATALOG.flatMap((item) => item.examples);
    return [...examples.slice(0, 4), 'Que puedes hacer por pestanas'];
}

module.exports = {
    DOMAIN_CATALOG,
    analyzeCommercialQuery,
    buildCapabilityText,
    buildClarifyingResponse,
    buildFollowUps,
    normalizeText,
};
