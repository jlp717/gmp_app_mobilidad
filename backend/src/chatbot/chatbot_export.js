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

function moneyNumber(value) {
    if (typeof value === 'number') return value;
    const raw = String(value ?? '')
        .replace(/[^\d,.-]+/g, '')
        .replace(/\./g, '')
        .replace(',', '.');
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
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

function safeFileName(value) {
    return String(value || 'documento')
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\s+/g, '-')
        .slice(0, 80);
}

function buildInvoicePdfDocument(result) {
    if (!result) return null;
    const invoiceNumber = result.invoiceNumber || [
        result.serie,
        result.numero,
        result.ejercicio,
    ].filter((part) => part !== undefined && part !== null && String(part).trim() !== '').join('/');
    let url = result.pdfPath;
    if (!url && result.serie && result.numero && result.ejercicio) {
        url = `/api/facturas/${result.serie}/${result.numero}/${result.ejercicio}/pdf`;
    }
    if (!url) return null;
    return {
        title: `Factura ${invoiceNumber}`,
        url,
        type: 'pdf',
        fileName: `factura-${safeFileName(invoiceNumber)}.pdf`,
        clientCode: result.clientCode,
    };
}

function mergeMetadata(parts) {
    const merged = {
        exportable: null,
        kpis: [],
        suggestedFollowUps: [],
        deepLink: null,
        chartData: null,
        documents: [],
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
        if (part.documents?.length) merged.documents.push(...part.documents);
    }

    merged.kpis = merged.kpis.slice(0, 6);
    merged.suggestedFollowUps = [...new Set(merged.suggestedFollowUps)].slice(0, 5);
    const seenDocs = new Set();
    merged.documents = merged.documents.filter((doc) => {
        const key = doc?.url || doc?.path || doc?.title;
        if (!key || seenDocs.has(key)) return false;
        seenDocs.add(key);
        return true;
    }).slice(0, 5);
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

        case 'get_commissions_range':
            if (!result.months?.length) return null;
            return {
                exportable: {
                    headers: ['Mes', 'Ventas', 'Comision', '% medio', 'Operaciones'],
                    rows: result.months.map((row) => [
                        row.label || `${row.month}/${row.year}`,
                        `${euro(row.sales)} EUR`,
                        `${euro(row.commission)} EUR`,
                        `${row.commissionPercent ?? ''}%`,
                        String(row.operations ?? ''),
                    ]),
                    filename: 'comisiones-acumuladas.csv',
                },
                kpis: [
                    { label: 'Comision total', value: `${euro(result.totalCommission)} EUR`, trend: 'neutral' },
                    { label: 'Ventas', value: `${euro(result.totalSales)} EUR`, trend: 'neutral' },
                    { label: '% medio', value: `${result.averageCommissionPercent}%`, trend: 'neutral' },
                ],
                chartData: result.months.map((row) => ({
                    label: row.label || `${row.month}/${row.year}`,
                    value: Number(row.commission) || 0,
                })),
                suggestedFollowUps: [
                    'Objetivo acumulado mismo periodo',
                    'Desglose comision por cliente',
                    'Exportar CSV',
                ],
                deepLink: { tab: 'Comisiones' },
            };

        case 'get_commission_config':
            return {
                exportable: {
                    headers: ['Tramo minimo', 'Tramo maximo', 'Porcentaje'],
                    rows: (result.tiers || []).map((tier) => [
                        `${tier.min}%`,
                        `${tier.max}%`,
                        `${tier.pct}%`,
                    ]),
                    filename: 'configuracion-comisiones.csv',
                },
                kpis: [
                    { label: 'IPC/base', value: `${result.ipc}%`, trend: 'neutral' },
                    { label: 'Tramos', value: String((result.tiers || []).length), trend: 'neutral' },
                ],
                suggestedFollowUps: ['Mi comision del mes', 'Comision acumulada ultimos 3 meses'],
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

        case 'get_objectives_range':
            if (!result.months?.length) return null;
            return {
                exportable: {
                    headers: ['Mes', 'Objetivo', 'Alcanzado', 'Pendiente', 'Cumplimiento %'],
                    rows: result.months.map((row) => [
                        row.label || `${row.month}/${row.year}`,
                        `${euro(row.target)} EUR`,
                        `${euro(row.achieved)} EUR`,
                        `${euro(row.remaining)} EUR`,
                        `${row.achievementPercent}%`,
                    ]),
                    filename: 'objetivos-acumulados.csv',
                },
                kpis: [
                    { label: 'Cumplimiento', value: `${result.achievementPercent}%`, trend: result.achievementPercent >= 100 ? 'up' : 'down' },
                    { label: 'Alcanzado', value: `${euro(result.totalAchieved)} EUR`, trend: 'neutral' },
                    { label: 'Objetivo', value: `${euro(result.totalTarget)} EUR`, trend: 'neutral' },
                ],
                chartData: result.months.map((row) => ({
                    label: row.label || `${row.month}/${row.year}`,
                    value: Number(row.achieved) || 0,
                })),
                suggestedFollowUps: [
                    'Comision acumulada mismo periodo',
                    'Objetivos por familia',
                    'Top clientes del periodo',
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

        case 'get_invoice_details': {
            if (!result.invoiceNumber) return null;
            const document = buildInvoicePdfDocument(result);
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
                documents: document ? [document] : [],
                deepLink: { tab: 'Facturas', clientCode: result.clientCode },
            };
        }

        case 'extract_pdf_content': {
            const document = buildInvoicePdfDocument(result);
            return {
                exportable: result.structured?.lines?.length ? {
                    headers: ['Producto', 'Descripcion', 'Cantidad', 'Precio', 'Importe'],
                    rows: result.structured.lines.map((line) => [
                        line.productCode || '',
                        line.description || '',
                        String(line.quantity ?? ''),
                        `${euro(line.unitPrice)}€`,
                        `${euro(line.amount)}€`,
                    ]),
                    filename: `${safeFileName(result.documentType)}-${safeFileName(result.reference)}.csv`,
                } : null,
                kpis: [
                    { label: 'Importe', value: `${euro(result.amount)}€`, trend: 'neutral' },
                    { label: 'Lineas', value: String(result.structured?.lineCount ?? result.structured?.lines?.length ?? 0), trend: 'neutral' },
                    { label: 'PDF', value: result.extractionMethod || 'DB2', trend: 'neutral' },
                ],
                suggestedFollowUps: [
                    'Deuda del cliente',
                    'Albaranes de esta factura',
                    'Exportar CSV',
                ],
                documents: document ? [document] : [],
                deepLink: { tab: 'Facturas', clientCode: result.clientCode },
            };
        }

        case 'get_client_invoices':
            if (!result.invoices?.length) return null;
            return {
                exportable: {
                    headers: ['Factura', 'Importe', 'Vencimiento', 'Estado'],
                    rows: result.invoices.map((inv) => [
                        inv.number,
                        `${euro(inv.amount)}€`,
                        inv.dueDate || '',
                        inv.status || '',
                    ]),
                    filename: `facturas-cliente-${safeFileName(result.clientCode)}.csv`,
                },
                kpis: [
                    { label: 'Pendiente', value: `${euro(result.totalAmount)}€`, trend: result.totalAmount > 0 ? 'down' : 'up' },
                    { label: 'Facturas', value: String(result.invoices.length), trend: 'neutral' },
                ],
                suggestedFollowUps: [
                    'Deuda del cliente',
                    'Leer una factura concreta',
                    'Cobros pendientes del cliente',
                ],
                deepLink: { tab: 'Facturas', clientCode: result.clientCode },
            };

        case 'get_cobros_summary':
            return {
                exportable: {
                    headers: ['Concepto', 'Valor'],
                    rows: [
                        ['A cobrar', `${euro(result.totalCollectable)}€`],
                        ['Cobrado', `${euro(result.totalCollected)}€`],
                        ['Pendiente', `${euro(result.totalPending)}€`],
                        ['% cobro', `${result.collectionPercent}%`],
                    ],
                    filename: `cobros-${result.month}-${result.year}.csv`,
                },
                kpis: [
                    { label: 'Cobrado', value: `${euro(result.totalCollected)}€`, trend: 'up' },
                    { label: 'Pendiente', value: `${euro(result.totalPending)}€`, trend: result.totalPending > 0 ? 'down' : 'up' },
                    { label: '% cobro', value: `${result.collectionPercent}%`, trend: result.collectionPercent >= 80 ? 'up' : 'down' },
                ],
                suggestedFollowUps: [
                    'Clientes con deuda vencida',
                    'Facturas pendientes',
                    'Resumen del dia',
                ],
                deepLink: { tab: 'Cobros' },
            };

        case 'get_daily_orders':
            return {
                exportable: {
                    headers: ['Concepto', 'Valor'],
                    rows: [
                        ['Pedidos', String(result.totalOrders ?? 0)],
                        ['Clientes', String(result.totalClients ?? 0)],
                        ['Importe', `${euro(result.totalAmount)}€`],
                    ],
                    filename: `pedidos-${result.day}-${result.month}-${result.year}.csv`,
                },
                kpis: [
                    { label: 'Pedidos', value: String(result.totalOrders ?? 0), trend: 'neutral' },
                    { label: 'Clientes', value: String(result.totalClients ?? 0), trend: 'neutral' },
                    { label: 'Importe', value: `${euro(result.totalAmount)}€`, trend: 'neutral' },
                ],
                suggestedFollowUps: [
                    'Resumen comercial del dia',
                    'Pedidos de un cliente',
                    'Stock producto',
                ],
                deepLink: { tab: 'Pedidos' },
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

        case 'get_top_products':
            if (!result.products?.length) return null;
            return {
                exportable: {
                    headers: ['#', 'Producto', 'Ventas', 'Unidades'],
                    rows: result.products.map((p, i) => [
                        String(i + 1),
                        p.name || p.productCode,
                        `${euro(p.sales)} EUR`,
                        String(p.quantity ?? ''),
                    ]),
                    filename: 'top-productos.csv',
                },
                kpis: [
                    { label: 'Top producto', value: `${euro(result.products[0]?.sales)} EUR`, trend: 'up' },
                    { label: 'Productos', value: String(result.products.length), trend: 'neutral' },
                ],
                chartData: result.products.slice(0, 8).map((p) => ({
                    label: p.name || p.productCode,
                    value: Number(p.sales) || 0,
                })),
                suggestedFollowUps: ['Buscar producto', 'Stock producto', 'Top clientes'],
                deepLink: { tab: 'Clientes' },
            };

        case 'get_top_products_by_client':
            if (!result.products?.length) return null;
            return {
                exportable: {
                    headers: ['#', 'Producto', 'Familia', 'Ventas', 'Unidades', 'Precio medio'],
                    rows: result.products.map((p, i) => [
                        String(i + 1),
                        p.name || p.code,
                        p.family || '',
                        `${euro(p.totalSales)} EUR`,
                        String(p.totalUnits ?? ''),
                        `${euro(p.avgPrice)} EUR`,
                    ]),
                    filename: `top-productos-cliente-${safeFileName(result.clientCode)}.csv`,
                },
                kpis: [
                    { label: 'Top producto', value: `${euro(result.products[0]?.totalSales)} EUR`, trend: 'up' },
                    { label: 'Productos', value: String(result.products.length), trend: 'neutral' },
                ],
                chartData: result.products.slice(0, 8).map((p) => ({
                    label: p.name || p.code,
                    value: Number(p.totalSales) || 0,
                })),
                suggestedFollowUps: ['Ventas mensuales del cliente', 'Deuda del cliente', 'Facturas del cliente'],
                deepLink: { tab: 'Clientes', clientCode: result.clientCode },
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
                        [String(result.currentYear?.year), `${euro(moneyNumber(result.currentYear?.sales))} EUR`, String(result.currentYear?.margin || '')],
                        [String(result.lastYear?.year), `${euro(moneyNumber(result.lastYear?.sales))} EUR`, String(result.lastYear?.margin || '')],
                        ['Crecimiento', pct(result.growth?.salesPercent), ''],
                    ],
                    filename: 'comparativa-yoy.csv',
                },
                kpis: [
                    { label: 'Crecimiento', value: pct(result.growth?.salesPercent), delta: pct(result.growth?.salesPercent), trend: trendFromDelta(result.growth?.salesPercent) },
                ],
                chartData: [
                    { label: String(result.lastYear?.year), value: moneyNumber(result.lastYear?.sales) },
                    { label: String(result.currentYear?.year), value: moneyNumber(result.currentYear?.sales) },
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

        case 'get_price_sold_to_client':
            if (!result.sales?.length) return null;
            return {
                exportable: {
                    headers: ['Fecha', 'Precio', 'Cantidad', 'Importe', 'Pedido'],
                    rows: result.sales.map((sale) => [
                        sale.date || '',
                        `${euro(sale.price)} EUR`,
                        String(sale.quantity ?? ''),
                        `${euro(sale.amount)} EUR`,
                        sale.orderNumber || '',
                    ]),
                    filename: `precio-cliente-${safeFileName(result.clientCode)}-${safeFileName(result.productCode)}.csv`,
                },
                kpis: [
                    { label: 'Ultimo precio', value: `${euro(result.sales[0]?.price)} EUR`, trend: 'neutral' },
                    { label: 'Ventas encontradas', value: String(result.sales.length), trend: 'neutral' },
                ],
                suggestedFollowUps: ['Stock producto', 'Margen cliente', 'Compras del cliente'],
                deepLink: { tab: 'Clientes', clientCode: result.clientCode },
            };

        case 'get_order_details':
            return {
                exportable: {
                    headers: ['Producto', 'Descripcion', 'Cantidad', 'Precio', 'Importe'],
                    rows: (result.lines || []).map((line) => [
                        line.productCode || '',
                        line.description || '',
                        String(line.quantity ?? ''),
                        `${euro(line.unitPrice)} EUR`,
                        `${euro(line.amount)} EUR`,
                    ]),
                    filename: `pedido-${safeFileName(result.orderNumber)}.csv`,
                },
                kpis: [
                    { label: 'Importe', value: `${euro(result.amount)} EUR`, trend: 'neutral' },
                    { label: 'Lineas', value: String(result.lineCount ?? (result.lines || []).length), trend: 'neutral' },
                    { label: 'Estado', value: result.status || 'N/A', trend: 'neutral' },
                ],
                suggestedFollowUps: ['Facturas del cliente', 'Deuda del cliente', 'Top productos del cliente'],
                deepLink: { tab: 'Pedidos', clientCode: result.clientCode },
            };

        case 'get_bolsa_status':
            return {
                exportable: {
                    headers: ['Concepto', 'Valor'],
                    rows: [
                        ['Saldo disponible', `${euro(result.saldoDisponible)} EUR`],
                        ['Consumido', `${euro(result.consumido)} EUR`],
                        ['Acumulado', `${euro(result.acumulado)} EUR`],
                        ['Limite %', `${result.limitePct ?? ''}%`],
                    ],
                    filename: `bolsa-${result.month}-${result.year}.csv`,
                },
                kpis: [
                    { label: 'Disponible', value: `${euro(result.saldoDisponible)} EUR`, trend: result.saldoDisponible >= 0 ? 'up' : 'down' },
                    { label: 'Consumido', value: `${euro(result.consumido)} EUR`, trend: 'neutral' },
                    { label: 'Acumulado', value: `${euro(result.acumulado)} EUR`, trend: 'neutral' },
                ],
                suggestedFollowUps: ['Movimientos bolsa', 'Historial bolsa 6 meses'],
                deepLink: { tab: 'Bolsa' },
            };

        case 'get_bolsa_movements':
            return {
                exportable: {
                    headers: ['Fecha', 'Tipo', 'Importe', 'Saldo anterior', 'Saldo posterior', 'Descripcion'],
                    rows: (result.movements || []).map((m) => [
                        String(m.fecha || ''),
                        m.tipo || '',
                        `${euro(m.importe)} EUR`,
                        `${euro(m.saldoAnterior)} EUR`,
                        `${euro(m.saldoPosterior)} EUR`,
                        m.descripcion || m.codigoArticulo || '',
                    ]),
                    filename: `movimientos-bolsa-${result.month}-${result.year}.csv`,
                },
                kpis: [
                    { label: 'Movimientos', value: String((result.movements || []).length), trend: 'neutral' },
                ],
                suggestedFollowUps: ['Saldo bolsa', 'Historial bolsa'],
                deepLink: { tab: 'Bolsa' },
            };

        case 'get_bolsa_history':
            return {
                exportable: {
                    headers: ['Mes', 'Acumulado', 'Consumido', 'Disponible'],
                    rows: (result.points || []).map((p) => [
                        `${p.mes}/${p.ejercicio}`,
                        `${euro(p.acumulado)} EUR`,
                        `${euro(p.consumido)} EUR`,
                        `${euro(p.saldoDisponible)} EUR`,
                    ]),
                    filename: 'historial-bolsa.csv',
                },
                kpis: [
                    { label: 'Acumulado', value: `${euro(result.totals?.acumulado)} EUR`, trend: 'neutral' },
                    { label: 'Consumido', value: `${euro(result.totals?.consumido)} EUR`, trend: 'neutral' },
                    { label: 'Saldo neto', value: `${euro(result.totals?.saldoNeto)} EUR`, trend: result.totals?.saldoNeto >= 0 ? 'up' : 'down' },
                ],
                chartData: (result.points || []).map((p) => ({
                    label: `${p.mes}/${p.ejercicio}`,
                    value: Number(p.acumulado) || 0,
                })),
                suggestedFollowUps: ['Movimientos bolsa', 'Saldo bolsa'],
                deepLink: { tab: 'Bolsa' },
            };

        case 'get_repartidor_deliveries':
            return {
                exportable: {
                    headers: ['Concepto', 'Valor'],
                    rows: [
                        ['Entregas', String(result.totalDeliveries ?? 0)],
                        ['Lineas', String(result.totalLines ?? 0)],
                        ['Completadas', String(result.completed ?? 0)],
                        ['Pendientes', String(result.pending ?? 0)],
                    ],
                    filename: `ruta-${result.day}-${result.month}-${result.year}.csv`,
                },
                kpis: [
                    { label: 'Entregas', value: String(result.totalDeliveries ?? 0), trend: 'neutral' },
                    { label: 'Lineas', value: String(result.totalLines ?? 0), trend: 'neutral' },
                ],
                suggestedFollowUps: ['Cobros repartidor', 'Comision repartidor'],
                deepLink: { tab: 'Ruta' },
            };

        case 'get_repartidor_collections':
            return {
                exportable: {
                    headers: ['Cliente', 'A cobrar', 'Cobrado', '%', 'Documentos'],
                    rows: (result.clients || []).map((c) => [
                        c.clientName || c.clientCode,
                        `${euro(c.collectable)} EUR`,
                        `${euro(c.collected)} EUR`,
                        `${c.percentage}%`,
                        String(c.numDocuments ?? ''),
                    ]),
                    filename: `cobros-repartidor-${result.month}-${result.year}.csv`,
                },
                kpis: [
                    { label: 'Cobrado', value: `${euro(result.summary?.totalCollected)} EUR`, trend: 'up' },
                    { label: 'Avance', value: `${result.summary?.overallPercentage ?? 0}%`, trend: (result.summary?.overallPercentage ?? 0) >= 80 ? 'up' : 'down' },
                ],
                suggestedFollowUps: ['Comision repartidor', 'Ruta hoy'],
                deepLink: { tab: 'Rutero' },
            };

        case 'get_repartidor_commissions':
            return {
                exportable: {
                    headers: ['Concepto', 'Valor'],
                    rows: [
                        ['Cobrado', `${euro(result.collected)} EUR`],
                        ['A cobrar', `${euro(result.collectable)} EUR`],
                        ['Porcentaje', `${result.percentage}%`],
                        ['Comision', `${euro(result.commission)} EUR`],
                        ['Umbral cumplido', result.thresholdMet ? 'SI' : 'NO'],
                    ],
                    filename: `comision-repartidor-${result.month}-${result.year}.csv`,
                },
                kpis: [
                    { label: 'Comision', value: `${euro(result.commission)} EUR`, trend: result.thresholdMet ? 'up' : 'down' },
                    { label: 'Avance', value: `${result.percentage}%`, trend: result.thresholdMet ? 'up' : 'down' },
                ],
                suggestedFollowUps: ['Cobros repartidor', 'Ruta hoy'],
                deepLink: { tab: 'Comisiones' },
            };

        case 'get_warehouse_dashboard':
            return {
                exportable: {
                    headers: ['Vehiculo', 'Matricula', 'Repartidor', 'Ordenes', 'Lineas'],
                    rows: (result.trucks || []).map((truck) => [
                        truck.vehicleCode,
                        truck.matricula || '',
                        truck.driverName || truck.driverCode || '',
                        String(truck.orderCount ?? 0),
                        String(truck.lineCount ?? 0),
                    ]),
                    filename: 'almacen-carga.csv',
                },
                kpis: [
                    { label: 'Camiones', value: String(result.totalTrucks ?? 0), trend: 'neutral' },
                ],
                suggestedFollowUps: ['Vehiculos almacen', 'Ruta hoy'],
                deepLink: { tab: 'Expediciones' },
            };

        case 'get_vehicles':
            return {
                exportable: {
                    headers: ['Codigo', 'Descripcion', 'Matricula', 'Carga kg', 'Palets'],
                    rows: (result.vehicles || []).map((vehicle) => [
                        vehicle.code,
                        vehicle.description || '',
                        vehicle.matricula || '',
                        String(vehicle.maxPayloadKg ?? ''),
                        String(vehicle.numPalets ?? ''),
                    ]),
                    filename: 'vehiculos.csv',
                },
                kpis: [
                    { label: 'Vehiculos', value: String((result.vehicles || []).length), trend: 'neutral' },
                ],
                suggestedFollowUps: ['Carga almacen hoy'],
                deepLink: { tab: 'Vehiculos' },
            };

        case 'get_sales_evolution':
            if (!result.monthly?.length) return null;
            return {
                exportable: {
                    headers: ['Periodo', 'Ventas', 'Coste', 'Margen', '% margen'],
                    rows: result.monthly.map((row) => [
                        row.period,
                        `${euro(row.totalVentas)} EUR`,
                        `${euro(row.totalCosto)} EUR`,
                        `${euro(row.totalMargen)} EUR`,
                        `${row.margenPct}%`,
                    ]),
                    filename: 'evolucion-ventas.csv',
                },
                kpis: [
                    { label: 'YTD ventas', value: `${euro(result.summary?.ytdVentas)} EUR`, trend: 'neutral' },
                    { label: 'YoY', value: pct(result.summary?.yoyChange), trend: trendFromDelta(result.summary?.yoyChange) },
                ],
                chartData: result.monthly.slice(-12).map((row) => ({
                    label: row.period,
                    value: Number(row.totalVentas) || 0,
                })),
                suggestedFollowUps: ['Top clientes', 'Top productos', 'Comparativa anual'],
                deepLink: { tab: 'Objetivos' },
            };

        default:
            return null;
    }
}

module.exports = {
    buildToolMetadata,
    mergeMetadata,
};
