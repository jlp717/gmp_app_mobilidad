'use strict';

/**
 * Asistente GMP — Export metadata builders for chatbot tool results.
 * Produces exportable CSV tables, KPI chips, follow-ups and deep links
 * consumed by the Flutter client.
 */

function euro(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0';
    return v.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function pct(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 'N/A';
    return `${v > 0 ? '+' : ''}${v}%`;
}

function trendFromDelta(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v === 0) return 'neutral';
    return v > 0 ? 'up' : 'down';
}

function mergeMetadata(parts) {
    const merged = {
        exportable: null,
        kpis: [],
        suggestedFollowUps: [],
        deepLink: null,
        chartData: null,
    };

    for (const part of parts) {
        if (!part) continue;
        if (part.exportable) merged.exportable = part.exportable;
        if (part.kpis?.length) merged.kpis.push(...part.kpis);
        if (part.suggestedFollowUps?.length) {
            merged.suggestedFollowUps.push(...part.suggestedFollowUps);
        }
        if (part.deepLink) merged.deepLink = part.deepLink;
        if (part.chartData?.length) merged.chartData = part.chartData;
    }

    merged.kpis = merged.kpis.slice(0, 6);
    merged.suggestedFollowUps = [...new Set(merged.suggestedFollowUps)].slice(0, 5);
    return merged;
}

function buildToolMetadata(toolName, result) {
    if (!result || result.error || result.safeResponse) return null;

    switch (toolName) {
        case 'get_commissions':
            return {
                exportable: {
                    headers: ['Concepto', 'Valor'],
                    rows: [
                        ['Ventas', `${euro(result.sales)}€`],
                        ['Comision', `${euro(result.commission)}€`],
                        ['Porcentaje', `${result.commissionPercent}%`],
                        ['Clientes activos', String(result.activeClients ?? '')],
                        ['Operaciones', String(result.operations ?? '')],
                    ],
                    filename: `comisiones-${result.month}-${result.year}.csv`,
                },
                kpis: [
                    { label: 'Comision', value: `${euro(result.commission)}€`, trend: 'neutral' },
                    { label: 'Ventas', value: `${euro(result.sales)}€`, trend: 'neutral' },
                    { label: '% Comision', value: `${result.commissionPercent}%`, trend: 'neutral' },
                ],
                suggestedFollowUps: [
                    'Desglose comision por cliente',
                    'Comparar con mes anterior',
                    'Ver objetivo del mes',
                ],
                deepLink: { tab: 'Comisiones' },
            };

        case 'get_objectives':
            return {
                exportable: {
                    headers: ['Concepto', 'Valor'],
                    rows: [
                        ['Objetivo', `${euro(result.target)}€`],
                        ['Alcanzado', `${euro(result.achieved)}€`],
                        ['Cumplimiento', `${result.achievementPercent}%`],
                    ],
                    filename: `objetivos-${result.month}-${result.year}.csv`,
                },
                kpis: [
                    { label: 'Cumplimiento', value: `${result.achievementPercent}%`, trend: result.achievementPercent >= 100 ? 'up' : 'down' },
                    { label: 'Alcanzado', value: `${euro(result.achieved)}€`, trend: 'neutral' },
                    { label: 'Objetivo', value: `${euro(result.target)}€`, trend: 'neutral' },
                ],
                suggestedFollowUps: [
                    'Objetivos por familia',
                    'Top clientes del mes',
                    'Comparar con ano anterior',
                ],
                deepLink: { tab: 'Objetivos' },
            };

        case 'get_objectives_by_family':
            if (!result.families?.length) return null;
            return {
                exportable: {
                    headers: ['Familia', 'Alcanzado', 'Objetivo', 'Cumplimiento %'],
                    rows: result.families.map((f) => [
                        f.family,
                        `${euro(f.achieved)}€`,
                        `${euro(f.target)}€`,
                        `${f.achievementPercent}%`,
                    ]),
                    filename: 'objetivos-familia.csv',
                },
                suggestedFollowUps: ['Ver objetivo global', 'Exportar CSV'],
            };

        case 'get_recent_invoices':
            if (!result.invoices?.length) return null;
            return {
                exportable: {
                    headers: ['Factura', 'Cliente', 'Importe'],
                    rows: result.invoices.map((inv) => [
                        inv.invoiceNumber,
                        inv.clientCode,
                        `${euro(inv.amount)}€`,
                    ]),
                    filename: `facturas-${result.date || 'hoy'}.csv`,
                },
                kpis: [
                    { label: 'Facturas hoy', value: String(result.count ?? result.invoices.length), trend: 'neutral' },
                    { label: 'Total', value: `${euro(result.totalAmount)}€`, trend: 'neutral' },
                ],
                suggestedFollowUps: [
                    'Detalle de una factura',
                    'Clientes con deuda vencida',
                ],
                deepLink: { tab: 'Facturas' },
            };

        case 'query_client_sales': {
            const groups = result.groups || [];
            return {
                exportable: {
                    headers: ['Periodo', 'Ventas'],
                    rows: [
                        ...groups.map((g) => [g.period, `${euro(g.sales)}€`]),
                        ['TOTAL', `${euro(result.totals?.sales)}€`],
                    ],
                    filename: `ventas-cliente-${result.clientCode || 'cartera'}.csv`,
                },
                kpis: [
                    { label: 'Total ventas', value: `${euro(result.totals?.sales)}€`, trend: 'neutral' },
                    ...(result.comparison ? [{
                        label: 'Variacion',
                        value: pct(result.comparison.salesDeltaPercent),
                        delta: pct(result.comparison.salesDeltaPercent),
                        trend: trendFromDelta(result.comparison.salesDeltaPercent),
                    }] : []),
                ],
                chartData: groups.slice(0, 12).map((g) => ({
                    label: g.period,
                    value: Number(g.sales) || 0,
                })),
                suggestedFollowUps: [
                    'Beneficio y margen del cliente',
                    'Comparar con ano anterior',
                    'Ver evolucion en app',
                ],
                deepLink: { tab: 'Clientes', clientCode: result.clientCode },
            };
        }

        case 'query_client_profit':
            return {
                exportable: {
                    headers: ['Periodo', 'Ventas', 'Beneficio', 'Margen %'],
                    rows: (result.groups || []).map((g) => [
                        g.period,
                        `${euro(g.sales)}€`,
                        `${euro(g.profit)}€`,
                        `${g.marginPercent}%`,
                    ]),
                    filename: `beneficio-cliente-${result.clientCode || 'cartera'}.csv`,
                },
                kpis: [
                    { label: 'Beneficio', value: `${euro(result.profit)}€`, trend: 'neutral' },
                    { label: 'Margen', value: `${result.marginPercent}%`, trend: result.marginPercent >= 15 ? 'up' : 'down' },
                    { label: 'Ventas', value: `${euro(result.totals?.sales)}€`, trend: 'neutral' },
                ],
                suggestedFollowUps: [
                    'Compras por familia',
                    'Deuda del cliente',
                    'Exportar CSV',
                ],
                deepLink: { tab: 'Clientes', clientCode: result.clientCode },
            };

        case 'compare_periods':
            return {
                exportable: {
                    headers: ['Periodo', 'Ventas', 'Beneficio'],
                    rows: [
                        ['Actual', `${euro(result.currentPeriod?.totals?.sales)}€`, `${euro(result.currentPeriod?.totals?.profit)}€`],
                        ['Anterior', `${euro(result.priorPeriod?.totals?.sales)}€`, `${euro(result.priorPeriod?.totals?.profit)}€`],
                        ['Variacion %', pct(result.salesDeltaPercent), `${euro(result.profitDelta)}€`],
                    ],
                    filename: `comparativa-${result.clientCode || 'cartera'}.csv`,
                },
                kpis: [
                    { label: 'Periodo actual', value: `${euro(result.currentPeriod?.totals?.sales)}€`, trend: 'neutral' },
                    { label: 'Variacion', value: pct(result.salesDeltaPercent), delta: pct(result.salesDeltaPercent), trend: trendFromDelta(result.salesDeltaPercent) },
                ],
                chartData: [
                    { label: 'Anterior', value: Number(result.priorPeriod?.totals?.sales) || 0 },
                    { label: 'Actual', value: Number(result.currentPeriod?.totals?.sales) || 0 },
                ],
                suggestedFollowUps: [
                    'Desglose por cliente',
                    'Top productos del periodo',
                    'Exportar CSV',
                ],
                deepLink: { tab: 'Clientes', clientCode: result.clientCode },
            };

        case 'query_client_purchases': {
            const purchases = result.purchases || [];
            if (!purchases.length) return null;
            return {
                exportable: {
                    headers: ['Producto', 'Familia', 'Periodo', 'Ventas', 'Unidades'],
                    rows: purchases.map((p) => [
                        p.productName || p.productCode,
                        p.family || '',
                        p.period || '',
                        `${euro(p.sales)}€`,
                        String(p.units ?? ''),
                    ]),
                    filename: `compras-cliente-${result.clientCode || 'cartera'}.csv`,
                },
                kpis: [
                    { label: 'Total compras', value: `${euro(result.totalSales)}€`, trend: 'neutral' },
                    { label: 'Lineas', value: String(result.purchaseCount ?? purchases.length), trend: 'neutral' },
                ],
                suggestedFollowUps: [
                    'Beneficio del cliente',
                    'Comparar con ano anterior',
                    'Exportar CSV',
                ],
                deepLink: { tab: 'Clientes', clientCode: result.clientCode },
            };
        }

        case 'get_invoice_details':
            if (!result.invoiceNumber) return null;
            return {
                exportable: {
                    headers: ['Producto', 'Descripcion', 'Cantidad', 'Importe'],
                    rows: (result.lines || []).map((line) => [
                        line.productCode || '',
                        line.description || '',
                        String(line.quantity ?? ''),
                        `${euro(line.amount)}€`,
                    ]),
                    filename: `factura-${String(result.invoiceNumber).replace(/\//g, '-')}.csv`,
                },
                kpis: [
                    { label: 'Importe', value: `${euro(result.amount)}€`, trend: 'neutral' },
                    { label: 'Pendiente', value: `${euro(result.pendingAmount)}€`, trend: result.pendingAmount > 0 ? 'down' : 'up' },
                    { label: 'Lineas', value: String(result.lineCount ?? (result.lines || []).length), trend: 'neutral' },
                ],
                suggestedFollowUps: [
                    'Albaranes de esta factura',
                    'Deuda del cliente',
                    'Exportar CSV',
                ],
                deepLink: { tab: 'Facturas', clientCode: result.clientCode },
            };

        case 'compare_sales_yoy': {
            const yearly = result.yearlyData || {};
            const years = Object.keys(yearly).map(Number).sort((a, b) => b - a);
            if (years.length < 2) return null;
            const current = yearly[years[0]]?.sales || 0;
            const prior = yearly[years[1]]?.sales || 0;
            const growthPct = prior > 0 ? Math.round(((current - prior) / prior) * 100) : 0;
            return {
                exportable: {
                    headers: ['Ano', 'Ventas', 'Cajas'],
                    rows: years.map((y) => [
                        String(y),
                        `${euro(yearly[y]?.sales)}€`,
                        String(yearly[y]?.boxes ?? ''),
                    ]),
                    filename: `yoy-cliente-${result.clientCode || 'cartera'}.csv`,
                },
                kpis: [
                    { label: String(years[0]), value: `${euro(current)}€`, trend: 'neutral' },
                    { label: 'Crecimiento', value: pct(growthPct), delta: pct(growthPct), trend: trendFromDelta(growthPct) },
                ],
                chartData: years.slice(0, 4).reverse().map((y) => ({
                    label: String(y),
                    value: Number(yearly[y]?.sales) || 0,
                })),
                suggestedFollowUps: [
                    'Beneficio del cliente',
                    'Top productos del cliente',
                    'Exportar CSV',
                ],
                deepLink: { tab: 'Clientes', clientCode: result.clientCode },
            };
        }

        case 'get_daily_summary':
            return {
                exportable: {
                    headers: ['Concepto', 'Valor'],
                    rows: [
                        ['Ventas', `${euro(result.totalSales)}€`],
                        ['Pedidos', String(result.totalOrders ?? 0)],
                        ['Clientes', String(result.totalClients ?? 0)],
                        ['Operaciones', String(result.totalOperations ?? 0)],
                        ...(result.topClients || []).slice(0, 5).map((c, i) => [`Top ${i + 1} ${c.name}`, `${euro(c.sales)}€`]),
                    ],
                    filename: `resumen-dia-${result.day}-${result.month}-${result.year}.csv`,
                },
                kpis: [
                    { label: 'Ventas hoy', value: `${euro(result.totalSales)}€`, trend: 'neutral' },
                    { label: 'Pedidos', value: String(result.totalOrders ?? 0), trend: 'neutral' },
                    { label: 'Clientes', value: String(result.totalClients ?? 0), trend: 'neutral' },
                ],
                suggestedFollowUps: [
                    'Facturas emitidas hoy',
                    'Top clientes del mes',
                    'Comparar con ayer',
                ],
                deepLink: { tab: 'Glacius' },
            };

        case 'get_top_clients':
            if (!result.clients?.length) return null;
            return {
                exportable: {
                    headers: ['#', 'Cliente', 'Ventas'],
                    rows: result.clients.map((c, i) => [
                        String(i + 1),
                        c.name || c.clientCode,
                        `${euro(c.sales)}€`,
                    ]),
                    filename: 'top-clientes.csv',
                },
                kpis: [
                    { label: 'Top cliente', value: `${euro(result.clients[0]?.sales)}€`, trend: 'up' },
                    { label: 'Clientes', value: String(result.clients.length), trend: 'neutral' },
                ],
                suggestedFollowUps: ['Evaluar un cliente', 'Exportar CSV'],
                deepLink: { tab: 'Clientes' },
            };

        case 'get_commission_details':
            if (!result.details?.length) return null;
            return {
                exportable: {
                    headers: ['Cliente', 'Ventas', 'Comision'],
                    rows: result.details.map((d) => [
                        d.clientCode,
                        `${euro(d.sales)}€`,
                        `${euro(d.commission)}€`,
                    ]),
                    filename: 'detalle-comisiones.csv',
                },
                deepLink: { tab: 'Comisiones' },
            };

        case 'get_yoy_comparison':
            return {
                exportable: {
                    headers: ['Ano', 'Ventas', 'Margen'],
                    rows: [
                        [String(result.currentYear?.year), `${euro(result.currentYear?.sales)}€`, `${result.currentYear?.margin}%`],
                        [String(result.lastYear?.year), `${euro(result.lastYear?.sales)}€`, `${result.lastYear?.margin}%`],
                        ['Crecimiento', pct(result.growth?.salesPercent), ''],
                    ],
                    filename: 'comparativa-yoy.csv',
                },
                kpis: [
                    { label: 'Crecimiento', value: pct(result.growth?.salesPercent), delta: pct(result.growth?.salesPercent), trend: trendFromDelta(result.growth?.salesPercent) },
                ],
                chartData: [
                    { label: String(result.lastYear?.year), value: Number(result.lastYear?.sales) || 0 },
                    { label: String(result.currentYear?.year), value: Number(result.currentYear?.sales) || 0 },
                ],
                suggestedFollowUps: ['Comparar por cliente', 'Ver evolucion mensual'],
                deepLink: { tab: 'Clientes' },
            };

        case 'get_margin_global':
            return {
                kpis: [
                    { label: 'Margen', value: `${result.marginPercent}%`, trend: result.marginPercent >= 15 ? 'up' : 'down' },
                    { label: 'Beneficio', value: `${euro(result.profit)}€`, trend: 'neutral' },
                    { label: 'Ventas', value: `${euro(result.sales)}€`, trend: 'neutral' },
                ],
                suggestedFollowUps: ['Margen por cliente', 'Top productos'],
            };

        case 'get_client_debt':
            return {
                kpis: [
                    { label: 'Deuda total', value: `${euro(result.totalDebt)}€`, trend: 'down' },
                    { label: 'Vencida', value: `${euro(result.overdueDebt)}€`, trend: result.overdueDebt > 0 ? 'down' : 'up' },
                    { label: 'Riesgo', value: result.riskLevel || 'N/A', trend: 'neutral' },
                ],
                suggestedFollowUps: [
                    'Facturas pendientes del cliente',
                    'Evaluar cliente completo',
                ],
                deepLink: { tab: 'Clientes', clientCode: result.clientCode },
            };

        default:
            return null;
    }
}

module.exports = {
    buildToolMetadata,
    mergeMetadata,
};
