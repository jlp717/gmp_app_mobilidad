/**
 * CHATBOT ENDPOINT HANDLER - Professional Sales Assistant
 * Processes natural language queries and routes to appropriate tools
 * Clean professional responses without emojis
 */

const { dbDiscoveryTools, pricingTools, riskTools, commercialTools, logisticsTools } = require('./chatbot_tools');

// Intent detection patterns
const intentPatterns = {
    // Debt & Risk
    deuda: /deuda|debe|adeuda|pendiente|vencid|pagar|cobr/i,
    bloqueo: /bloqueado|bloqueo|bloqu/i,
    riesgo: /riesgo|score|evaluación|evaluar/i,
    credito: /crédito|límite|limite|disponible/i,

    // Pricing
    precio: /precio|cost|tarifa|cuánto|cuanto|vender|vendo|cobro/i,
    minimo: /mínimo|minimo|suelo|floor|breakeven|break-even/i,
    descuento: /descuento|rebaja|baja|bajar|negociar|simul/i,
    promocion: /promo|ofertas?|campañ|descuento/i,

    // Margin
    margen: /margen|margenes|rentabilid|beneficio|ganancia/i,
    margenGlobal: /margen\s*(global|total|general)/i,

    // Sales comparison
    comparar: /comparar|compar|año|años|vs|versus|histórico|evolución/i,

    // Commercial Intelligence
    churn: /dejó|dejo|compra|compraba|perdid|churn|abandonó/i,
    cross: /recomendar|sugerir|vender más|upsell|cross.?sell|similar/i,
    historial: /historial|compró|compro|pedidos|ventas|histor/i,
    tendencia: /tendencia|trimestre|quarter|estacional|temporada/i,

    // Logistics
    stock: /stock|existencias|inventario|almacén|almacen|disponib/i,
    pedido: /pedido|orden|tracking|estado|entrega|eta/i,

    // General
    saludo: /hola|buenos|buenas|hey|qué tal/i,
    ayuda: /ayuda|help|cómo|como|qué puedo|que puedo/i
};

// Extract codes and values from message
function extractCodes(message) {
    const clientMatch = message.match(/cliente?\s*[:#]?\s*(\d{4,10})/i) ||
        message.match(/(\d{5,10})/);
    const productMatch = message.match(/producto?\s*[:#]?\s*([A-Z0-9\-]+)/i) ||
        message.match(/artículo?\s*[:#]?\s*([A-Z0-9\-]+)/i);
    const percentMatch = message.match(/(\d+)\s*%?/);
    const monthMatch = message.match(/(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i);

    const monthMap = {
        enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
        julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
    };

    return {
        clientCode: clientMatch ? clientMatch[1] : null,
        productCode: productMatch ? productMatch[1] : null,
        percent: percentMatch ? parseFloat(percentMatch[1]) : null,
        month: monthMatch ? monthMap[monthMatch[1].toLowerCase()] : null
    };
}

// Main message handler
async function handleChatMessage(conn, message, vendedorCodes, providedClientCode) {
    const msg = message.toLowerCase();
    const codes = extractCodes(message);
    const clientCode = codes.clientCode || providedClientCode;
    const productCode = codes.productCode;

    // GREETING
    if (intentPatterns.saludo.test(msg)) {
        return `**Asistente NEXUS Activo**

Puedo ayudarte con:
- **Márgenes**: "Mi margen global" o "Margen cliente 12345"
- **Precios**: "Precio producto ABC" o "Precio mínimo"
- **Deudas**: "Deuda del cliente 12345"
- **Promociones**: "Promociones disponibles"
- **Stock**: "Stock producto XYZ"
- **Análisis**: "Comparar ventas 2024 vs 2023"

¿En qué puedo asistirte?`;
    }

    // HELP
    if (intentPatterns.ayuda.test(msg)) {
        return `**Comandos Disponibles**

**Finanzas**
- "Deuda cliente 12345"
- "Margen global [mes]"
- "Margen cliente 12345"

**Pricing**
- "Precio producto ABC"
- "Precio mínimo producto ABC"
- "Simula 15% descuento producto ABC"

**Comercial**
- "¿Qué dejó de comprar el 12345?"
- "Comparar ventas 2024 vs 2023"
- "Historial cliente 12345"

**Operaciones**
- "Stock producto ABC"
- "¿Está bloqueado el 12345?"

**Nota**: Incluye siempre el código de cliente o producto.`;
    }

    // MARGIN GLOBAL query
    if (intentPatterns.margenGlobal.test(msg) || (intentPatterns.margen.test(msg) && !clientCode)) {
        const currentYear = new Date().getFullYear();
        const currentMonth = codes.month || new Date().getMonth() + 1;

        try {
            // Calculate margin for vendedor(s)
            const vendedorFilter = vendedorCodes && vendedorCodes.length > 0
                ? `AND CODIGOVENDEDOR IN (${vendedorCodes.map(c => `'${c}'`).join(',')})`
                : '';

            const result = await conn.query(`
                SELECT 
                    SUM(IMPORTEVENTA) as VENTAS,
                    SUM(IMPORTECOSTE) as COSTE,
                    COUNT(DISTINCT CODIGOCLIENTEALBARAN) as CLIENTES,
                    COUNT(*) as OPERACIONES
                FROM DSEDAC.LAC
                WHERE ANODOCUMENTO = ${currentYear} AND MESDOCUMENTO = ${currentMonth}
                ${vendedorFilter}
            `);

            const ventas = parseFloat(result[0]?.VENTAS) || 0;
            const coste = parseFloat(result[0]?.COSTE) || 0;
            const clientes = parseInt(result[0]?.CLIENTES) || 0;
            const margenPct = ventas > 0 ? ((ventas - coste) / ventas * 100) : 0;
            const beneficio = ventas - coste;

            const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

            return `**Margen Global - ${monthNames[currentMonth - 1]} ${currentYear}**

**Ventas**: ${ventas.toLocaleString('es-ES')}€
**Coste**: ${coste.toLocaleString('es-ES')}€
**Beneficio**: ${beneficio.toLocaleString('es-ES')}€

**Margen**: ${margenPct.toFixed(1)}%
**Clientes activos**: ${clientes}

${margenPct < 15 ? '**Atención**: Margen por debajo del objetivo (15%).' : margenPct > 25 ? '**Excelente**: Margen por encima del objetivo.' : '**Normal**: Margen dentro del rango esperado.'}`;
        } catch (e) {
            return `Error calculando margen global: ${e.message}`;
        }
    }

    // MARGIN BY CLIENT
    if (intentPatterns.margen.test(msg) && clientCode) {
        try {
            const currentYear = new Date().getFullYear();

            const result = await conn.query(`
                SELECT 
                    SUM(IMPORTEVENTA) as VENTAS,
                    SUM(IMPORTECOSTE) as COSTE,
                    COUNT(*) as OPERACIONES
                FROM DSEDAC.LAC
                WHERE CODIGOCLIENTEALBARAN = '${clientCode}' AND ANODOCUMENTO = ${currentYear}
            `);

            const ventas = parseFloat(result[0]?.VENTAS) || 0;
            const coste = parseFloat(result[0]?.COSTE) || 0;
            const ops = parseInt(result[0]?.OPERACIONES) || 0;
            const margenPct = ventas > 0 ? ((ventas - coste) / ventas * 100) : 0;
            const beneficio = ventas - coste;

            return `**Margen Cliente ${clientCode} - ${currentYear}**

**Ventas totales**: ${ventas.toLocaleString('es-ES')}€
**Coste productos**: ${coste.toLocaleString('es-ES')}€
**Beneficio bruto**: ${beneficio.toLocaleString('es-ES')}€

**Margen**: ${margenPct.toFixed(1)}%
**Operaciones**: ${ops}

${margenPct < 10 ? '**Alerta**: Cliente con margen bajo. Revisa precios.' : ''}`;
        } catch (e) {
            return `Error calculando margen: ${e.message}`;
        }
    }

    // DEBT query
    if (intentPatterns.deuda.test(msg)) {
        if (!clientCode) {
            return 'Necesito el código de cliente. Ejemplo: "Deuda del cliente 12345"';
        }
        const debt = await riskTools.getClientDebt(conn, clientCode);

        const status = debt.riskLevel === 'ALTO' ? 'ALTO RIESGO' : debt.riskLevel === 'MEDIO' ? 'RIESGO MEDIO' : 'BAJO RIESGO';
        return `**Deuda Cliente ${clientCode}** [${status}]

**Total pendiente**: ${debt.totalDebt.toLocaleString('es-ES')}€
**Vencido**: ${debt.overdueDebt.toLocaleString('es-ES')}€
**Facturas abiertas**: ${debt.numInvoices}

**Antigüedad**:
- 1-30 días: ${debt.aging.days_1_30.toLocaleString('es-ES')}€
- 31-60 días: ${debt.aging.days_31_60.toLocaleString('es-ES')}€
- 61-90 días: ${debt.aging.days_61_90.toLocaleString('es-ES')}€
- Más de 90 días: ${debt.aging.days_over_90.toLocaleString('es-ES')}€

${debt.overdueDebt > 1000 ? '**Recomendación**: No ampliar crédito sin cobrar primero.' : 'Estado de pago correcto.'}`;
    }

    // BLOCKED query
    if (intentPatterns.bloqueo.test(msg)) {
        if (!clientCode) {
            return 'Necesito el código de cliente. Ejemplo: "¿Está bloqueado el 12345?"';
        }
        const blocked = await riskTools.checkClientBlocked(conn, clientCode);

        if (blocked.isBlocked) {
            return `**Cliente ${clientCode} - BLOQUEADO**

**Motivo**: ${blocked.blockReason}

**Acción requerida**: Contacta administración para desbloquear o solicita pago anticipado.`;
        }
        return `**Cliente ${clientCode}** no está bloqueado. Operaciones permitidas.`;
    }

    // RISK SCORE query
    if (intentPatterns.riesgo.test(msg)) {
        if (!clientCode) {
            return 'Necesito el código de cliente. Ejemplo: "Riesgo del cliente 12345"';
        }
        const risk = await riskTools.calculateRiskScore(conn, clientCode);

        return `**Evaluación de Riesgo - Cliente ${clientCode}**

**Score**: ${risk.riskScore}/100
**Clasificación**: ${risk.riskLevel}

**Indicadores**:
${risk.alerts.length > 0 ? risk.alerts.map(a => `- ${a}`).join('\n') : '- Sin alertas activas'}

**Recomendación**: ${risk.recommendation}`;
    }

    // CREDIT query
    if (intentPatterns.credito.test(msg)) {
        if (!clientCode) {
            return 'Necesito el código de cliente. Ejemplo: "Crédito del cliente 12345"';
        }
        const credit = await riskTools.getClientCreditLimit(conn, clientCode);

        return `**Crédito Cliente ${clientCode}**

**Límite**: ${credit.creditLimit.toLocaleString('es-ES')}€
**Utilizado**: ${credit.usedCredit.toLocaleString('es-ES')}€
**Disponible**: ${credit.availableCredit.toLocaleString('es-ES')}€
**Uso**: ${Math.round(credit.utilizationPercent)}%`;
    }

    // PRICE query
    if (intentPatterns.precio.test(msg) && !intentPatterns.descuento.test(msg) && !intentPatterns.minimo.test(msg)) {
        if (!productCode) {
            return 'Necesito el código de producto. Ejemplo: "Precio del producto ABC123"';
        }
        const price = await pricingTools.getProductPrice(conn, productCode);

        if (!price.product.CODIGOARTICULO) {
            return `Producto ${productCode} no encontrado.`;
        }

        const margen = price.tariffPrice > 0 ? Math.round(((price.tariffPrice - price.cost) / price.tariffPrice) * 100) : 0;

        return `**Producto ${productCode}**

**Descripción**: ${price.product.DESCRIPCIONARTICULO?.trim() || 'Sin descripción'}
**Tarifa**: ${price.tariffPrice.toLocaleString('es-ES')}€
**Coste**: ${price.cost.toLocaleString('es-ES')}€
**Último precio vendido**: ${price.lastSoldPrice.toLocaleString('es-ES')}€
**Margen tarifa**: ${margen}%`;
    }

    // MINIMUM PRICE
    if (intentPatterns.minimo.test(msg)) {
        if (!productCode) {
            return 'Necesito el código de producto. Ejemplo: "Precio mínimo del producto ABC123"';
        }
        const breakeven = await pricingTools.calculateBreakeven(conn, productCode);

        if (breakeven.error) return breakeven.error;

        return `**Precio Mínimo - Producto ${productCode}**

**Coste**: ${breakeven.cost.toLocaleString('es-ES')}€
**Tarifa oficial**: ${breakeven.tariffPrice.toLocaleString('es-ES')}€
**Precio suelo**: ${breakeven.floorPrice.toLocaleString('es-ES')}€

**Margen mínimo requerido**: ${breakeven.minMarginPercent}%
**Margen actual**: ${Math.round(breakeven.currentMarginPercent)}%

**Límite**: No vender por debajo de ${breakeven.floorPrice.toLocaleString('es-ES')}€`;
    }

    // DISCOUNT SIMULATION
    if (intentPatterns.descuento.test(msg)) {
        if (!productCode) {
            return 'Necesito el código de producto. Ejemplo: "Simula 10% descuento en producto ABC123"';
        }
        const discountPercent = codes.percent || 10;
        const sim = await pricingTools.simulateDiscount(conn, productCode, discountPercent);

        if (sim.error) return sim.error;

        return `**Simulación Descuento ${discountPercent}% - Producto ${productCode}**

**Precio original**: ${sim.originalPrice.toLocaleString('es-ES')}€
**Precio con descuento**: ${sim.newPrice.toLocaleString('es-ES')}€

**Margen original**: ${sim.originalMargin.toLocaleString('es-ES')}€
**Nuevo margen**: ${sim.newMargin.toLocaleString('es-ES')}€
**Impacto por unidad**: ${sim.marginLoss.toLocaleString('es-ES')}€

**Resultado**: ${sim.profitable ? 'RENTABLE - Mantiene margen positivo' : 'NO RENTABLE - Genera pérdidas'}
${sim.profitable ? `Para compensar, necesitas vender ${sim.extraVolumeNeededMultiplier}x más volumen.` : ''}`;
    }

    // CHURN DETECTION
    if (intentPatterns.churn.test(msg)) {
        if (!clientCode) {
            return 'Necesito el código de cliente. Ejemplo: "¿Qué dejó de comprar el 12345?"';
        }
        const churn = await commercialTools.detectChurn(conn, clientCode);

        if (churn.count === 0) {
            return `**Cliente ${clientCode}** - Sin productos abandonados detectados.`;
        }

        const productList = churn.churnedProducts.slice(0, 5)
            .map(p => `- ${p.code}: ${p.description || 'Sin desc.'}`).join('\n');

        return `**Productos Abandonados - Cliente ${clientCode}**

Detectados **${churn.count} productos** sin compra reciente:

${productList}
${churn.count > 5 ? `\n...y ${churn.count - 5} más` : ''}

**Acción sugerida**: ${churn.actionSuggestion}`;
    }

    // STOCK query
    if (intentPatterns.stock.test(msg)) {
        if (!productCode) {
            return 'Necesito el código de producto. Ejemplo: "Stock del producto ABC123"';
        }
        const stock = await logisticsTools.getStockByWarehouse(conn, productCode);

        if (stock.warehouses.length === 0) {
            return `Sin información de stock para producto ${productCode}.`;
        }

        const list = stock.warehouses
            .map(w => `- Almacén ${w.warehouse}: ${w.stock} uds`).join('\n');

        const status = stock.totalStock > 10 ? 'DISPONIBLE' : stock.totalStock > 0 ? 'STOCK BAJO' : 'SIN STOCK';

        return `**Stock Producto ${productCode}** [${status}]

**Total disponible**: ${stock.totalStock} unidades

${list}

${stock.totalStock === 0 ? '**Atención**: Sin stock - Consulta ETAs antes de comprometer.' : ''}`;
    }

    // COMPARE YoY
    if (intentPatterns.comparar.test(msg)) {
        if (!clientCode && !productCode) {
            return 'Necesito un código de cliente o producto para comparar.';
        }

        if (clientCode) {
            const comp = await commercialTools.compareClientYoY(conn, clientCode);
            const years = Object.keys(comp.yearlyData).sort((a, b) => b - a);
            const list = years.map(y =>
                `- **${y}**: ${(comp.yearlyData[y].sales || 0).toLocaleString('es-ES')}€`
            ).join('\n');

            let growth = '';
            if (years.length >= 2 && comp.yearlyData[years[1]].sales > 0) {
                const pct = Math.round(((comp.yearlyData[years[0]].sales - comp.yearlyData[years[1]].sales) / comp.yearlyData[years[1]].sales) * 100);
                growth = `\n**Variación ${years[1]} → ${years[0]}**: ${pct > 0 ? '+' : ''}${pct}%`;
            }

            return `**Comparativa Anual - Cliente ${clientCode}**

${list}
${growth}`;
        }

        if (productCode) {
            const year = new Date().getFullYear();
            const comp = await pricingTools.compareYearlyPrices(conn, productCode, year - 1, year);

            return `**Comparativa Precios - Producto ${productCode}**

- **${year - 1}**: Precio medio ${(comp[year - 1].avgPrice || 0).toLocaleString('es-ES')}€ | Ventas ${(comp[year - 1].totalSales || 0).toLocaleString('es-ES')}€
- **${year}**: Precio medio ${(comp[year].avgPrice || 0).toLocaleString('es-ES')}€ | Ventas ${(comp[year].totalSales || 0).toLocaleString('es-ES')}€

**Cambio precio**: ${Math.round(comp.priceChange || 0)}%`;
        }
    }

    // DEFAULT - not understood
    return `No he podido interpretar tu consulta.

**Ejemplos de consultas**:
- "Margen global" o "Margen cliente 12345"
- "Deuda del cliente 12345"
- "Precio del producto ABC"
- "Stock del producto XYZ"
- "Comparar ventas 2024 vs 2023"

Escribe "ayuda" para ver todos los comandos.`;
}

module.exports = { handleChatMessage };
