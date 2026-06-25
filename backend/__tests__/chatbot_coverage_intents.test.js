'use strict';

jest.mock('../src/chatbot/chatbot_tools', () => {
  const actual = jest.requireActual('../src/chatbot/chatbot_tools');
  return {
    ...actual,
    dbDiscoveryTools: {
      ...actual.dbDiscoveryTools,
      searchClientsFlexible: jest.fn(async (conn, query) => {
        if (String(query).toLowerCase().includes('central')) {
          return [
            { CODIGO: '32258', NOMBRE: 'CENTRAL HOTELES', POBLACION: 'MADRID' },
          ];
        }
        return [];
      }),
      searchProductsFlexible: jest.fn(async (conn, query) => {
        const normalized = String(query).toLowerCase();
        if (normalized.includes('migas')) {
          return [
            { CODIGO: 'MIGAS1', NOMBRE: 'Migas de bacalao', FAMILIA: 'CONG' },
          ];
        }
        if (normalized.includes('calamar')) {
          return [
            { CODIGO: 'CAL1', NOMBRE: 'Anillas de calamar', FAMILIA: 'CONG' },
          ];
        }
        return [];
      }),
    },
    pricingTools: {
      ...actual.pricingTools,
      getProductPrice: jest.fn(async (conn, productCode) => ({
        product: {
          CODIGOARTICULO: productCode,
          DESCRIPCIONARTICULO:
            productCode === '120' ? 'Producto 120' : 'Migas de bacalao',
        },
        tariffPrice: 8.5,
        cost: 5,
        lastSoldPrice: 8.2,
      })),
    },
    logisticsTools: {
      ...actual.logisticsTools,
      getStockByWarehouse: jest.fn(async () => ({
        totalStock: 24,
        warehouses: [
          { warehouse: '01', stock: 12 },
          { warehouse: '02', stock: 12 },
        ],
      })),
    },
    riskTools: {
      ...actual.riskTools,
      getClientDebt: jest.fn(async (conn, clientCode) => ({
        clientCode,
        totalDebt: 1250,
        overdueDebt: 300,
        numInvoices: 2,
        aging: {
          days_1_30: 300,
          days_31_60: 0,
          days_61_90: 0,
          days_over_90: 0,
        },
        riskLevel: 'BAJO',
      })),
    },
    commissionTools: {
      ...actual.commissionTools,
      getCommissions: jest.fn(async (conn, userCode, isJefeVentas, month, year) => ({
        month,
        year,
        sales: month * 1000,
        commission: month * 100,
        commissionPercent: 10,
        activeClients: month,
        operations: month * 2,
      })),
      getCommissionConfig: jest.fn(async () => ({
        ipc: 3,
        tiers: [{ min: 100.01, max: 103, pct: 1 }],
      })),
    },
    objectivesTools: {
      ...actual.objectivesTools,
      getObjectives: jest.fn(async (conn, userCode, isJefeVentas, month, year) => ({
        month,
        year,
        target: month * 1000,
        achieved: month * 800,
        remaining: month * 200,
        achievementPercent: 80,
      })),
      getObjectivesByFamily: jest.fn(async () => ({
        month: 3,
        year: 2026,
        families: [
          { family: 'AVES', achieved: 1000, target: 1200, achievementPercent: 83.3 },
        ],
      })),
    },
    pedidosTools: {
      ...actual.pedidosTools,
      getDailyOrders: jest.fn(async () => ({
        day: 24,
        month: 6,
        year: 2026,
        totalOrders: 18,
        totalClients: 11,
        totalAmount: 2450,
      })),
    },
    cobrosTools: {
      ...actual.cobrosTools,
      getCobrosSummary: jest.fn(async () => ({
        month: 6,
        year: 2026,
        totalCollectable: 5000,
        totalCollected: 3500,
        totalPending: 1500,
        collectionPercent: 70,
      })),
    },
    crossQueryTools: {
      ...actual.crossQueryTools,
      getPriceSoldToClient: jest.fn(async () => ({
        productCode: 'CAL1',
        clientCode: '32258',
        sales: [
          {
            date: '2026-02-10',
            price: 9.5,
            quantity: 4,
            amount: 38,
            orderNumber: 'P1',
          },
        ],
      })),
    },
    genericAnalyticsTools: {
      ...actual.genericAnalyticsTools,
      queryClientPurchases: jest.fn(async () => ({
        clientCode: '32258',
        productCode: 'CAL1',
        totalSales: 420,
        purchaseCount: 2,
        purchases: [
          {
            productCode: 'CAL1',
            productName: 'Anillas de calamar',
            family: 'CONG',
            period: '2026-01',
            sales: 180,
            units: 12,
            lines: 1,
          },
          {
            productCode: 'CAL1',
            productName: 'Anillas de calamar',
            family: 'CONG',
            period: '2026-02',
            sales: 240,
            units: 16,
            lines: 2,
          },
        ],
      })),
    },
    repartidorTools: {
      ...actual.repartidorTools,
      getRepartidorDeliveries: jest.fn(async () => ({
        year: 2026,
        month: 6,
        day: 24,
        totalDeliveries: 8,
        totalLines: 42,
        completed: 6,
        pending: 2,
        deliveries: [],
      })),
      getRepartidorCommissions: jest.fn(async () => ({
        month: 6,
        year: 2026,
        collected: 1200,
        collectable: 1500,
        percentage: 80,
        thresholdMet: true,
        commission: 24,
      })),
    },
  };
});

const { handleChatMessage } = require('../src/chatbot/chatbot_handler');
const {
  dbDiscoveryTools,
  commissionTools,
  cobrosTools,
  objectivesTools,
  pedidosTools,
  pricingTools,
  riskTools,
  logisticsTools,
  crossQueryTools,
  genericAnalyticsTools,
  repartidorTools,
} = require('../src/chatbot/chatbot_tools');

describe('chatbot coverage intents', () => {
  const conn = { query: jest.fn(async () => []) };
  const context = {
    userCode: '80',
    role: 'JEFE_VENTAS',
    isJefeVentas: true,
    vendorScope: ['ALL'],
    richResponses: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('answers accumulated commission over recent months', async () => {
    const response = await handleChatMessage(
      conn,
      'mi comision generada en ultimos 3 meses',
      ['ALL'],
      null,
      context
    );

    expect(commissionTools.getCommissions).toHaveBeenCalledTimes(3);
    expect(response.text).toMatch(/Comision acumulada/i);
    expect(response.metadata.deepLink.tab).toBe('Comisiones');
    expect(response.metadata.chartData).toHaveLength(3);
    expect(response.metadata.exportable.filename).toBe('comisiones-acumuladas.csv');
  });

  test('answers natural two-month commission ranges', async () => {
    const response = await handleChatMessage(
      conn,
      'comisiones mias de enero y febrero',
      ['ALL'],
      null,
      context
    );

    const calls = commissionTools.getCommissions.mock.calls.map((call) => ({
      month: call[3],
      year: call[4],
    }));
    expect(calls).toEqual([
      { month: 1, year: 2026 },
      { month: 2, year: 2026 },
    ]);
    expect(response.text).toMatch(/Comision acumulada/i);
    expect(response.metadata.deepLink.tab).toBe('Comisiones');
  });

  test('treats ADMIN role as supervisor even if client omits isJefeVentas', async () => {
    const response = await handleChatMessage(
      conn,
      'comision enero',
      ['ALL'],
      null,
      {
        userCode: '01',
        role: 'ADMIN',
        isJefeVentas: false,
        vendorScope: ['ALL'],
        richResponses: true,
      }
    );

    expect(commissionTools.getCommissions).toHaveBeenCalledWith(
      conn,
      '01',
      true,
      1,
      undefined,
      ['ALL']
    );
    expect(response.text).toMatch(/Comision/i);
  });

  test('answers accumulated objectives over explicit month range', async () => {
    const response = await handleChatMessage(
      conn,
      'objetivo acumulado de enero a marzo 2026',
      ['ALL'],
      null,
      context
    );

    const calls = objectivesTools.getObjectives.mock.calls.map((call) => ({
      month: call[3],
      year: call[4],
    }));
    expect(calls).toEqual([
      { month: 1, year: 2026 },
      { month: 2, year: 2026 },
      { month: 3, year: 2026 },
    ]);
    expect(response.text).toMatch(/Objetivo acumulado/i);
    expect(response.metadata.deepLink.tab).toBe('Objetivos');
    expect(response.metadata.kpis.some((kpi) => kpi.label === 'Cumplimiento')).toBe(true);
  });

  test('normalizes rough commercial abbreviations before routing', async () => {
    const response = await handleChatMessage(
      conn,
      'obj acum ene mar 2026',
      ['ALL'],
      null,
      context
    );

    expect(objectivesTools.getObjectives).toHaveBeenCalledTimes(3);
    expect(response.text).toMatch(/Objetivo acumulado/i);
    expect(response.metadata.deepLink.tab).toBe('Objetivos');
  });

  test('finds products from incomplete natural language', async () => {
    const response = await handleChatMessage(
      conn,
      'dime el producto de migas',
      ['ALL'],
      null,
      context
    );

    expect(dbDiscoveryTools.searchProductsFlexible).toHaveBeenCalledWith(
      conn,
      'migas',
      10
    );
    expect(response.text).toMatch(/Productos encontrados/i);
    expect(response.text).toMatch(/Migas de bacalao/);
    expect(response.metadata.exportable.filename).toBe('productos-busqueda.csv');
    expect(response.metadata.deepLink.tab).toBe('Pedidos');
  });

  test('resolves product names before price lookups', async () => {
    const response = await handleChatMessage(
      conn,
      'precio producto migas',
      ['ALL'],
      null,
      context
    );

    expect(dbDiscoveryTools.searchProductsFlexible).toHaveBeenCalledWith(
      conn,
      'migas',
      10
    );
    expect(pricingTools.getProductPrice).toHaveBeenCalledWith(conn, 'MIGAS1');
    expect(response).toMatch(/Producto MIGAS1/);
    expect(response).toMatch(/Migas de bacalao/);
  });

  test('answers short numeric product codes without requiring ten digits', async () => {
    const response = await handleChatMessage(
      conn,
      'precio del producto 120',
      ['ALL'],
      null,
      context
    );

    expect(dbDiscoveryTools.searchProductsFlexible).not.toHaveBeenCalled();
    expect(pricingTools.getProductPrice).toHaveBeenCalledWith(conn, '120');
    expect(response).toMatch(/Producto 120/);
  });

  test('routes stock wording with cuanto queda to stock, not price', async () => {
    const response = await handleChatMessage(
      conn,
      'cuanto queda producto migas',
      ['ALL'],
      null,
      context
    );

    expect(logisticsTools.getStockByWarehouse).toHaveBeenCalledWith(
      conn,
      'MIGAS1'
    );
    expect(pricingTools.getProductPrice).not.toHaveBeenCalled();
    expect(response).toMatch(/Stock MIGAS1/);
  });

  test('routes cuantos pedidos hoy to daily orders, not price', async () => {
    const response = await handleChatMessage(
      conn,
      'cuantos pedidos hoy',
      ['ALL'],
      null,
      context
    );

    expect(pedidosTools.getDailyOrders).toHaveBeenCalled();
    expect(pricingTools.getProductPrice).not.toHaveBeenCalled();
    expect(response.text).toMatch(/Pedidos/);
  });

  test('routes cuanto cobre este mes to cobros summary, not price', async () => {
    const response = await handleChatMessage(
      conn,
      'cuanto cobre este mes',
      ['ALL'],
      null,
      context
    );

    expect(cobrosTools.getCobrosSummary).toHaveBeenCalled();
    expect(pricingTools.getProductPrice).not.toHaveBeenCalled();
    expect(response.text).toMatch(/Resumen cobros/);
  });

  test('uses current client context for product sales questions', async () => {
    const response = await handleChatMessage(
      conn,
      'cuanto le vendi a este cliente de calamar',
      ['ALL'],
      '32258',
      context
    );

    expect(dbDiscoveryTools.searchProductsFlexible).toHaveBeenCalledWith(
      conn,
      'calamar',
      10
    );
    expect(genericAnalyticsTools.queryClientPurchases).toHaveBeenCalledWith(
      conn,
      '32258',
      null,
      null,
      null,
      'CAL1',
      20,
      '80',
      true,
      ['ALL']
    );
    expect(response.text).toMatch(/Ventas producto CAL1/i);
    expect(response.text).toMatch(/420/);
    expect(response.metadata.deepLink.tab).toBe('Clientes');
  });

  test('distinguishes sale amount from price sold to a client', async () => {
    const response = await handleChatMessage(
      conn,
      'a cuanto le vendi a este cliente el calamar',
      ['ALL'],
      '32258',
      context
    );

    expect(crossQueryTools.getPriceSoldToClient).toHaveBeenCalledWith(
      conn,
      'CAL1',
      '32258',
      5
    );
    expect(genericAnalyticsTools.queryClientPurchases).not.toHaveBeenCalled();
    expect(response.text).toMatch(/Precio vendido al cliente 32258/i);
  });

  test('asks for the client when a current-client question has no context', async () => {
    const response = await handleChatMessage(
      conn,
      'cuanto le vendi a este cliente de calamar',
      ['ALL'],
      null,
      context
    );

    expect(genericAnalyticsTools.queryClientPurchases).not.toHaveBeenCalled();
    expect(crossQueryTools.getPriceSoldToClient).not.toHaveBeenCalled();
    expect(response.text).toMatch(/a que cliente/i);
    expect(response.metadata.suggestedFollowUps).toContain(
      'Evalua el cliente Central Hoteles'
    );
  });

  test('uses product search as a safe fallback for one-word queries', async () => {
    const response = await handleChatMessage(
      conn,
      'migas',
      ['ALL'],
      null,
      context
    );

    expect(dbDiscoveryTools.searchProductsFlexible).toHaveBeenCalledWith(
      conn,
      'migas',
      5
    );
    expect(response.text).toMatch(/No he detectado una accion concreta/i);
    expect(response.text).toMatch(/Migas de bacalao/);
  });

  test('resolves client names before debt lookups', async () => {
    const response = await handleChatMessage(
      conn,
      'deuda central hoteles',
      ['ALL'],
      null,
      context
    );

    expect(dbDiscoveryTools.searchClientsFlexible).toHaveBeenCalledWith(
      conn,
      'central hoteles',
      12
    );
    expect(riskTools.getClientDebt).toHaveBeenCalledWith(conn, '32258');
    expect(response.text).toMatch(/Deuda cliente 32258/i);
  });

  test('explains coverage across visible app tabs', async () => {
    const response = await handleChatMessage(
      conn,
      'que puedes hacer por pestanas',
      ['ALL'],
      null,
      context
    );

    expect(response.text).toMatch(/Clientes/i);
    expect(response.text).toMatch(/Facturas/i);
    expect(response.text).toMatch(/Glacius/i);
    expect(response.text).toMatch(/PDF/i);
    expect(response.metadata.deepLink.tab).toBe('Chat IA');
    expect(response.metadata.suggestedFollowUps.length).toBeGreaterThan(0);
  });

  test('routes rutero questions to repartidor deliveries', async () => {
    const response = await handleChatMessage(
      conn,
      'mi ruta hoy',
      ['80'],
      null,
      { ...context, userCode: '80', vendorScope: ['80'], isJefeVentas: false, role: 'REPARTIDOR' }
    );

    expect(repartidorTools.getRepartidorDeliveries).toHaveBeenCalled();
    expect(response.text).toMatch(/Ruta repartidor/i);
    expect(response.metadata.deepLink.tab).toBe('Ruta');
  });

  test('returns guided fallback with follow-up actions', async () => {
    const response = await handleChatMessage(
      conn,
      'esto no se entiende nada',
      ['ALL'],
      null,
      context
    );

    expect(response.text).toMatch(/No tengo suficiente precision/i);
    expect(response.text).toMatch(/Dime el producto de migas/i);
    expect(response.metadata.deepLink.tab).toBe('Chat IA');
    expect(response.metadata.suggestedFollowUps).toContain('Que puedes hacer por pestanas');
  });
});
