'use strict';

const { buildToolMetadata, mergeMetadata } = require('../src/chatbot/chatbot_export');

describe('chatbot export metadata', () => {
  test('buildToolMetadata for get_commissions includes exportable and kpis', () => {
    const meta = buildToolMetadata('get_commissions', {
      month: 3,
      year: 2026,
      sales: 12470,
      commission: 1247,
      commissionPercent: 10,
      activeClients: 42,
      operations: 128,
    });

    expect(meta).not.toBeNull();
    expect(meta.exportable.headers).toContain('Concepto');
    expect(meta.exportable.filename).toMatch(/comisiones/);
    expect(meta.kpis.length).toBeGreaterThanOrEqual(2);
    expect(meta.deepLink.tab).toBe('Comisiones');
  });

  test('buildToolMetadata for get_commissions_range includes chart data', () => {
    const meta = buildToolMetadata('get_commissions_range', {
      totalSales: 3000,
      totalCommission: 300,
      averageCommissionPercent: 10,
      months: [
        { label: 'enero 2026', sales: 1000, commission: 100, commissionPercent: 10, operations: 4 },
        { label: 'febrero 2026', sales: 2000, commission: 200, commissionPercent: 10, operations: 6 },
      ],
    });

    expect(meta.exportable.filename).toBe('comisiones-acumuladas.csv');
    expect(meta.chartData).toHaveLength(2);
    expect(meta.deepLink.tab).toBe('Comisiones');
  });

  test('buildToolMetadata for get_objectives_range includes objective KPIs', () => {
    const meta = buildToolMetadata('get_objectives_range', {
      totalTarget: 5000,
      totalAchieved: 4500,
      achievementPercent: 90,
      months: [
        { label: 'enero 2026', target: 2000, achieved: 1800, remaining: 200, achievementPercent: 90 },
        { label: 'febrero 2026', target: 3000, achieved: 2700, remaining: 300, achievementPercent: 90 },
      ],
    });

    expect(meta.kpis.some((k) => k.label === 'Cumplimiento')).toBe(true);
    expect(meta.chartData).toHaveLength(2);
    expect(meta.deepLink.tab).toBe('Objetivos');
  });

  test('buildToolMetadata for query_client_sales includes chart data', () => {
    const meta = buildToolMetadata('query_client_sales', {
      clientCode: 'C001',
      totals: { sales: 5000 },
      groups: [
        { period: '2026-01', sales: 2000 },
        { period: '2026-02', sales: 3000 },
      ],
      comparison: { salesDeltaPercent: 15, mode: 'prior_year' },
    });

    expect(meta.exportable.rows.length).toBeGreaterThan(0);
    expect(meta.chartData).toHaveLength(2);
    expect(meta.kpis.some((k) => k.label === 'Variacion')).toBe(true);
  });

  test('mergeMetadata deduplicates follow-ups', () => {
    const merged = mergeMetadata([
      { suggestedFollowUps: ['Exportar CSV', 'Ver en app'] },
      { suggestedFollowUps: ['Exportar CSV', 'Comparar periodos'] },
    ]);

    expect(merged.suggestedFollowUps).toEqual([
      'Exportar CSV',
      'Ver en app',
      'Comparar periodos',
    ]);
  });

  test('buildToolMetadata returns null on error result', () => {
    expect(buildToolMetadata('query_client_sales', { error: 'denied' })).toBeNull();
  });

  test('buildToolMetadata for query_client_purchases includes exportable', () => {
    const meta = buildToolMetadata('query_client_purchases', {
      clientCode: 'C001',
      totalSales: 3200,
      purchaseCount: 2,
      purchases: [
        {
          productCode: 'P1',
          productName: 'Pollo',
          family: 'AVES',
          period: '2026-01',
          sales: 2000,
          units: 40,
        },
        {
          productCode: 'P2',
          productName: 'Huevos',
          family: 'AVES',
          period: '2026-02',
          sales: 1200,
          units: 20,
        },
      ],
    });

    expect(meta.exportable.rows).toHaveLength(2);
    expect(meta.kpis.some((k) => k.label === 'Total compras')).toBe(true);
    expect(meta.deepLink.tab).toBe('Clientes');
  });

  test('buildToolMetadata for get_invoice_details includes lines export', () => {
    const meta = buildToolMetadata('get_invoice_details', {
      invoiceNumber: 'F/100/2026',
      clientCode: 'C001',
      amount: 1500,
      pendingAmount: 200,
      serie: 'F',
      numero: 100,
      ejercicio: 2026,
      pdfPath: '/api/facturas/F/100/2026/pdf',
      lineCount: 1,
      lines: [
        {
          productCode: 'P1',
          description: 'Producto test',
          quantity: 10,
          amount: 1500,
        },
      ],
    });

    expect(meta.exportable.filename).toMatch(/factura/);
    expect(meta.deepLink.tab).toBe('Facturas');
    expect(meta.kpis.some((k) => k.label === 'Importe')).toBe(true);
    expect(meta.documents).toEqual([
      expect.objectContaining({
        title: 'Factura F/100/2026',
        url: '/api/facturas/F/100/2026/pdf',
        type: 'pdf',
      }),
    ]);
  });

  test('mergeMetadata deduplicates documents', () => {
    const merged = mergeMetadata([
      { documents: [{ title: 'Factura 1', url: '/api/f1.pdf' }] },
      { documents: [{ title: 'Factura 1 dup', url: '/api/f1.pdf' }] },
      { documents: [{ title: 'Factura 2', url: '/api/f2.pdf' }] },
    ]);

    expect(merged.documents.map((doc) => doc.url)).toEqual([
      '/api/f1.pdf',
      '/api/f2.pdf',
    ]);
  });

  test('buildToolMetadata for compare_sales_yoy includes chart data', () => {
    const meta = buildToolMetadata('compare_sales_yoy', {
      clientCode: 'C001',
      yearlyData: {
        2026: { sales: 12000, boxes: 100 },
        2025: { sales: 10000, boxes: 90 },
      },
    });

    expect(meta.chartData.length).toBeGreaterThanOrEqual(2);
    expect(meta.exportable.rows.length).toBe(2);
    expect(meta.kpis.some((k) => k.label === 'Crecimiento')).toBe(true);
  });

  test('buildToolMetadata for get_daily_summary deep links to Glacius', () => {
    const meta = buildToolMetadata('get_daily_summary', {
      day: 19,
      month: 6,
      year: 2026,
      totalSales: 5000,
      totalOrders: 12,
      totalClients: 8,
    });

    expect(meta.deepLink.tab).toBe('Glacius');
  });

  test('buildToolMetadata for get_yoy_comparison parses formatted money', () => {
    const meta = buildToolMetadata('get_yoy_comparison', {
      currentYear: { year: 2026, sales: '12.500€', margin: '2.500€', clients: 8 },
      lastYear: { year: 2025, sales: '10.000€', margin: '2.000€', clients: 7 },
      growth: { salesPercent: 25, marginPercent: 20 },
    });

    expect(meta.chartData).toEqual([
      { label: '2025', value: 10000 },
      { label: '2026', value: 12500 },
    ]);
  });
});
