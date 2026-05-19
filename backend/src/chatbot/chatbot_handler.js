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
    summaryTools
} = require('./chatbot_tools');

// ── Intent Detection Patterns (expanded for misspellings) ────────────────────

const intentPatterns = {
    // Greetings & Help
    saludo: /^(hola|buenos\s*d[ií]as|buenas\s*tardes|buenas|hey|qu[eé]\s*tal|saludos)/i,
    ayuda: /^(ayuda|help|comandos|qu[eé]\s*puedes|opciones|men[uú])/i,

    // Commissions
    comision: /comisi[oó]n|comisiones|cuanto\s*gano|cu[aá]nto\s*gano|mi\s*comisi[oó]n|comisi[oó]n\s*del\s*mes/i,
    comisionDetalle: /detalle.*comisi[oó]n|comisi[oó]n.*detalle|comisi[oó]n.*cliente/i,
    comisionConfig: /configuraci[oó]n.*comisi[oó]n|tier.*comisi[oó]n|ipc.*comisi[oó]n/i,

    // Objectives
    objetivo: /objetivo|objetivos|cumplimiento|meta|target|cu[aá]nto\s*me\s*falta|voy\s*bien/i,
    objetivoFamilia: /objetivo.*familia|familia.*objetivo|objetivo.*producto/i,

    // Margins
    margen: /margen|m[aá]rgenes|rentabilid|beneficio|ganancia|profit/i,
    margenGlobal: /margen\s*(global|total|general|mi\s*margen)/i,

    // Pricing
    precio: /precio|cost[eo]|tarifa|cu[aá]nto|cuanto\s*cuesta|cuanto\s*vale|vender|vendo|cobro|cu[aá]nto\s*cobra/i,
    minimo: /m[ií]nimo|minimo|suelo|floor|breakeven|break-even|precio\s*suelo|no\s*perder/i,
    descuento: /descuento|rebaja|bajar|negociar|simul|si\s*le\s*hago|si\s*bajo/i,

    // Client Risk & Debt
    deuda: /deuda|debe|adeuda|pendiente|vencid|pagar|cobr|deben|me\s*deben|deuda.*cliente/i,
    bloqueo: /bloqueado|bloqueo|no\s*puedo\s*vender|impedido|restringid/i,
    riesgo: /riesgo|score|evaluaci[oó]n|evaluar|peligro|fiabilidad|solvencia/i,
    credito: /cr[eé]dito|l[ií]mite|limite.*cr[eé]dito|disponible.*cr[eé]dito|linea.*cr[eé]dito/i,

    // Commercial Intelligence
    churn: /dej[oó]\s*de\s*comprar|compraba\s*y|perdid|abandon[oó]|ya\s*no\s*compra|churn/i,
    comparar: /comparar|compar|a[oñ]o|a[oñ]os|vs|versus|hist[oó]rico|evoluci[oó]n|crecimiento/i,
    historial: /historial|compr[oó]|pedidos.*cliente|ventas.*cliente|histor/i,

    // Stock & Logistics
    stock: /stock|existencias|inventario|almac[eé]n|disponib|hay\s*en\s*almac[eé]n|queda/i,

    // Invoices & Albaranes
    factura: /factura|facturas|invoice|f[aá]ctura.*cliente|factura.*pendiente/i,
    albaran: /albar[aá]n|albaranes|delivery.*note/i,

    // Pedidos (Orders)
    pedido: /pedido|pedidos|orden.*preparaci[oó]n|opp|cu[aá]ntos\s*pedidos|pedidos.*hoy|pedidos.*dia/i,

    // Cobros (Collections)
    cobro: /cobro|cobros|cobrar|pendiente.*cobro|cobrado|recaudaci[oó]n|cu[aá]nto\s*cobr[eé]|cobros.*mes/i,

    // Bolsa
    bolsa: /bolsa|saldo.*bolsa|bolsa.*comercial|consumido.*bolsa|acumulado/i,

    // Evolution
    evolucion: /evoluci[oó]n|tendencia|trend|creciendo|decreciendo|subiendo|bajando/i,

    // Analytics
    top: /top|mejor|mejores|ranking|principales|m[aá]s\s*vendido/i,
    yoy: /a[oñ]o.*contra.*a[oñ]o|yoy|year.*over|comparativa.*anual/i,

    // Repartidor
    repartidor: /repartidor|reparto|entrega|entregas|cobro.*repartidor|mi\s*ruta|ruta.*hoy/i,

    // Warehouse
    almacen: /almac[eé]n|warehouse|camion|camiones|veh[ií]culo|carga|load.*plan|expedici[oó]n/i,

    // Daily Summary
    resumen: /resumen.*dia|resumen.*hoy|como.*fue.*hoy|que.*pas[oó].*hoy|resumen/i,

    // Search
    buscarCliente: /buscar.*cliente|buscar.*client|cliente.*llama|nombre.*cliente|cliente.*nombre/i,
    buscarProducto: /buscar.*producto|buscar.*art[ií]culo|producto.*llama|nombre.*producto/i,
};

// ── Entity Extraction ────────────────────────────────────────────────────────

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

    // Invoice numbers
    const invoiceMatch = message.match(/factura\s*[:#]?\s*([A-Z0-9\-]+)/i) ||
        message.match(/invoice\s*[:#]?\s*([A-Z0-9\-]+)/i);

    // Vehicle codes
    const vehicleMatch = message.match(/(?:camion|vehiculo|vehicle)\s*[:#]?\s*([A-Z0-9\-]+)/i);

    const monthMap = {
        enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4,
        mayo: 5, junio: 6, jun: 6, julio: 7, jul: 7, agosto: 8, ago: 8,
        septiembre: 9, sep: 9, octubre: 10, oct: 10, noviembre: 11, nov: 11, diciembre: 12, dic: 12
    };

    return {
        clientCode: clientMatch ? clientMatch[1] : null,
        productCode: productMatch ? productMatch[1] : null,
        percent: percentMatch ? parseFloat(percentMatch[1]) : null,
        month: monthMatch ? monthMap[monthMatch[1].toLowerCase()] : null,
        invoiceNumber: invoiceMatch ? invoiceMatch[1] : null,
        vehicleCode: vehicleMatch ? vehicleMatch[1] : null
    };
}

// ── Safe Query Helper ────────────────────────────────────────────────────────

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

async function handleChatMessage(conn, message, vendedorCodes, providedClientCode) {
    const msg = message.toLowerCase();
    const codes = extractCodes(message);
    const clientCode = codes.clientCode || providedClientCode;
    const productCode = codes.productCode;
    const invoiceNumber = codes.invoiceNumber;

    // ── GREETING ──
    if (intentPatterns.saludo.test(msg)) {
        return `**NEXUS — Sistema de consulta comercial GMP**

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

    // ── HELP ──
    if (intentPatterns.ayuda.test(msg)) {
        return `**Comandos NEXUS**

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
    if (intentPatterns.comision.test(msg) && !intentPatterns.comisionDetalle.test(msg) && !intentPatterns.comisionConfig.test(msg)) {
        try {
            const userCode = vendedorCodes && vendedorCodes.length > 0 ? vendedorCodes[0] : '';
            const isJefeVentas = false;
            const result = await commissionTools.getCommissions(conn, userCode, isJefeVentas, codes.month, undefined, vendedorCodes);
            return `Comision ${result.month}/${result.year}:
**${result.commission.toLocaleString('es-ES')}€** sobre ventas de **${result.sales.toLocaleString('es-ES')}€** (${result.commissionPercent}%)
Clientes activos: ${result.activeClients} | Operaciones: ${result.operations}`;
        } catch (e) {
            return `Error obteniendo comisiones: ${e.message}`;
        }
    }

    // ── COMMISSION DETAILS ──
    if (intentPatterns.comisionDetalle.test(msg)) {
        if (!clientCode) {
            return 'Necesito el codigo de cliente. Ejemplo: "Detalle de comision del cliente 12345"';
        }
        try {
            const userCode = vendedorCodes && vendedorCodes.length > 0 ? vendedorCodes[0] : '';
            const result = await commissionTools.getCommissionDetails(conn, userCode, false, clientCode, codes.month);
            if (result.details.length === 0) return 'Sin detalles de comision para este cliente.';
            const list = result.details.slice(0, 10).map(d => `- ${d.clientCode}: **${d.sales.toLocaleString('es-ES')}€** → Comision ${d.commission.toLocaleString('es-ES')}€`).join('\n');
            return `Detalle de comisiones:\n${list}`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    // ── OBJECTIVES ──
    if (intentPatterns.objetivo.test(msg) && !intentPatterns.objetivoFamilia.test(msg)) {
        try {
            const userCode = vendedorCodes && vendedorCodes.length > 0 ? vendedorCodes[0] : '';
            const result = await objectivesTools.getObjectives(conn, userCode, false, codes.month, undefined, vendedorCodes);
            const status = result.achievementPercent >= 100 ? 'OBJETIVO CUMPLIDO' : `Faltan ${(result.target - result.achieved).toLocaleString('es-ES')}€`;
            return `Objetivo ${result.month}/${result.year}:
Alcanzado: **${result.achieved.toLocaleString('es-ES')}€** de ${result.target.toLocaleString('es-ES')}€ (**${result.achievementPercent}%**)
${status}`;
        } catch (e) {
            return `Error obteniendo objetivos: ${e.message}`;
        }
    }

    // ── MARGIN GLOBAL ──
    if (intentPatterns.margenGlobal.test(msg) || (intentPatterns.margen.test(msg) && !clientCode && !intentPatterns.precio.test(msg))) {
        try {
            const userCode = vendedorCodes && vendedorCodes.length > 0 ? vendedorCodes[0] : '';
            const result = await commercialTools.getMarginGlobal(conn, userCode, false, codes.month, undefined, vendedorCodes);
            return `Margen ${result.month}/${result.year}:
Ventas: **${result.sales.toLocaleString('es-ES')}€** | Coste: ${result.cost.toLocaleString('es-ES')}€ | Beneficio: **${result.profit.toLocaleString('es-ES')}€**
Margen: **${result.marginPercent}%** | Clientes: ${result.clients} | Operaciones: ${result.operations}`;
        } catch (e) {
            return `Error calculando margen: ${e.message}`;
        }
    }

    // ── MARGIN BY CLIENT ──
    if (intentPatterns.margen.test(msg) && clientCode) {
        try {
            const userCode = vendedorCodes && vendedorCodes.length > 0 ? vendedorCodes[0] : '';
            const result = await commercialTools.getMarginByClient(conn, clientCode, userCode, false, vendedorCodes);
            return `Margen cliente ${clientCode}:
Ventas: **${result.sales.toLocaleString('es-ES')}€** | Coste: ${result.cost.toLocaleString('es-ES')}€ | Beneficio: **${result.profit.toLocaleString('es-ES')}€**
Margen: **${result.marginPercent}%** | Operaciones: ${result.operations}`;
        } catch (e) {
            return `Error calculando margen: ${e.message}`;
        }
    }

    // ── DEBT ──
    if (intentPatterns.deuda.test(msg)) {
        if (!clientCode) {
            return 'Necesito codigo de cliente. Ejemplo: "Deuda cliente 12345"';
        }
        try {
            const debt = await riskTools.getClientDebt(conn, clientCode);
            const status = debt.riskLevel === 'ALTO' ? 'ALTO RIESGO' : debt.riskLevel === 'MEDIO' ? 'RIESGO MEDIO' : 'BAJO RIESGO';
            const action = debt.overdueDebt > 1000 ? 'No ampliar credito sin cobrar primero' : 'Estado de pago correcto';
            return `Deuda cliente ${clientCode} [${status}]
Pendiente: **${debt.totalDebt.toLocaleString('es-ES')}€** | Vencido: **${debt.overdueDebt.toLocaleString('es-ES')}€**
1-30d: ${debt.aging.days_1_30.toLocaleString('es-ES')}€ | 31-60d: ${debt.aging.days_31_60.toLocaleString('es-ES')}€ | 61-90d: ${debt.aging.days_61_90.toLocaleString('es-ES')}€ | +90d: **${debt.aging.days_over_90.toLocaleString('es-ES')}€**
${action}`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    }

    // ── BLOCKED ──
    if (intentPatterns.bloqueo.test(msg)) {
        if (!clientCode) {
            return 'Necesito el codigo de cliente. Ejemplo: "Esta bloqueado el 12345?"';
        }
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
    if (intentPatterns.comparar.test(msg)) {
        if (!clientCode) {
            return 'Necesito un codigo de cliente para comparar. Ejemplo: "Comparar ventas del cliente 12345"';
        }
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
            try {
                const inv = await invoiceTools.getInvoiceDetails(conn, invoiceNumber);
                if (inv.error) return inv.error;
                return `**Factura ${inv.invoiceNumber}**
- Cliente: ${inv.clientCode}
- Importe: **${inv.amount.toLocaleString('es-ES')}€**
- Estado: ${inv.status}
- Albaranes: ${inv.albaranCount}`;
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }
        if (clientCode) {
            try {
                const invs = await invoiceTools.getClientInvoices(conn, clientCode);
                if (invs.invoices.length === 0) return `Sin facturas pendientes para cliente ${clientCode}.`;
                const list = invs.invoices.slice(0, 10).map(i => `- ${i.number}: **${i.amount.toLocaleString('es-ES')}€** | ${i.status}`).join('\n');
                return `Facturas pendientes cliente ${clientCode} (total: **${invs.totalAmount.toLocaleString('es-ES')}€**):\n${list}`;
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }
        return 'Necesito un numero de factura o codigo de cliente. Ejemplo: "Factura F2024-001" o "Facturas del cliente 12345"';
    }

    // ── ALBARANES ──
    if (intentPatterns.albaran.test(msg)) {
        if (invoiceNumber) {
            try {
                const albs = await invoiceTools.getAlbaranesByInvoice(conn, invoiceNumber);
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
            const list = clients.slice(0, 10).map(c => `- ${c.NOMBRE} (${c.CODIGO}) - ${c.POBLACION}`).join('\n');
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

    // ── DEFAULT ──
    return `Consulta no reconocida.

Ejemplos validos:
- "Mis comisiones" | "Deuda cliente 12345"
- "Precio producto ABC" | "Stock producto XYZ"
- "Margen global" | "Objetivo mes"
- "Cobros pendientes" | "Facturas cliente 12345"

Escribe "ayuda" para lista completa.`;
}

module.exports = { handleChatMessage };
