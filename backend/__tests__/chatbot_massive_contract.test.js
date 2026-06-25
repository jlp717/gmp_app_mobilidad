'use strict';

jest.mock('../src/chatbot/chatbot_authorization', () => {
  const normalizeCode = (value) => String(value || '').trim().toUpperCase();
  const supervisorRoles = new Set(['JEFE_VENTAS', 'JEFE', 'GERENTE', 'ADMIN']);
  const clientOwners = new Map([
    ['32258', '80'],
    ['12345', '80'],
    ['99999', '81'],
  ]);

  return {
    isSupervisor: jest.fn((userContext = {}) =>
      Boolean(userContext?.isJefeVentas) ||
      supervisorRoles.has(normalizeCode(userContext?.role))
    ),
    authorizeResolvedClient: jest.fn(async (conn, userContext, clientCode) => {
      const normalizedClient = normalizeCode(clientCode);
      const owner = {
        clientCode: normalizedClient,
        vendorCode: clientOwners.get(normalizedClient) || null,
        verified: clientOwners.has(normalizedClient),
      };
      const isSupervisor =
        Boolean(userContext?.isJefeVentas) ||
        supervisorRoles.has(normalizeCode(userContext?.role));

      if (isSupervisor) {
        return {
          owner,
          authorization: { allowed: true, code: 'ALLOWED_SUPERVISOR' },
        };
      }

      if (!owner.verified) {
        return {
          owner,
          authorization: { allowed: false, code: 'CLIENT_SCOPE_UNVERIFIED' },
        };
      }

      const scope = Array.isArray(userContext?.vendorScope)
        ? userContext.vendorScope.map((code) => String(code).replace(/^0+/, '') || String(code))
        : [];
      const ownerCode = String(owner.vendorCode).replace(/^0+/, '') || owner.vendorCode;
      const allowed = scope.includes(ownerCode) || String(userContext?.userCode || '').replace(/^0+/, '') === ownerCode;

      return {
        owner,
        authorization: {
          allowed,
          code: allowed ? 'ALLOWED_OWNER' : 'FORBIDDEN_CLIENT_SCOPE',
        },
      };
    }),
    buildAuthorizationSafeResponse: jest.fn((code) =>
      code === 'CLIENT_SCOPE_UNVERIFIED'
        ? 'No puedo verificar que ese cliente pertenezca a tu ambito autorizado. No se consultaran datos.'
        : 'No tengo acceso a esa informacion. Solo puedes consultar tus propios datos o los de tus clientes asignados.'
    ),
  };
});

jest.mock('../src/chatbot/chatbot_tools', () => {
  const normalize = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const productFor = (query) => {
    const text = normalize(query);
    if (text.includes('calamar')) {
      return { CODIGO: 'CAL1', NOMBRE: 'Anillas de calamar', FAMILIA: 'CONG' };
    }
    if (text.includes('miga') || text.includes('migass') || text.includes('stock')) {
      return { CODIGO: 'MIGAS1', NOMBRE: 'Migas de bacalao', FAMILIA: 'CONG' };
    }
    if (/\b120\b/.test(text)) {
      return { CODIGO: '120', NOMBRE: 'Producto 120', FAMILIA: 'GEN' };
    }
    return null;
  };

  const invoiceClient = (invoiceNumber) =>
    String(invoiceNumber || '').toUpperCase().includes('AJENO') ? '99999' : '32258';

  return {
    dbDiscoveryTools: {
      searchClients: jest.fn(async (conn, query) => {
        const text = normalize(query);
        if (text.includes('central') || text.includes('hotel') || text.includes('32258')) {
          return [{ CODIGO: '32258', NOMBRE: 'CENTRAL HOTELES', POBLACION: 'MADRID' }];
        }
        if (text.includes('ajeno') || text.includes('99999')) {
          return [{ CODIGO: '99999', NOMBRE: 'CLIENTE AJENO', POBLACION: 'VALENCIA' }];
        }
        return [];
      }),
      searchClientsFlexible: jest.fn(async (conn, query) => {
        const text = normalize(query);
        if (text.includes('central') || text.includes('hotel') || text.includes('32258')) {
          return [{ CODIGO: '32258', NOMBRE: 'CENTRAL HOTELES', POBLACION: 'MADRID' }];
        }
        if (text.includes('ajeno') || text.includes('99999')) {
          return [{ CODIGO: '99999', NOMBRE: 'CLIENTE AJENO', POBLACION: 'VALENCIA' }];
        }
        return [];
      }),
      searchProducts: jest.fn(async (conn, query, limit = 10) => {
        const product = productFor(query);
        return product ? [product].slice(0, limit) : [];
      }),
      searchProductsFlexible: jest.fn(async (conn, query, limit = 10) => {
        const product = productFor(query);
        return product ? [product].slice(0, limit) : [];
      }),
    },
    pricingTools: {
      getProductPrice: jest.fn(async (conn, productCode) => ({
        product: {
          CODIGOARTICULO: productCode,
          DESCRIPCIONARTICULO:
            productCode === '120' ? 'Producto 120' : productCode === 'CAL1' ? 'Anillas de calamar' : 'Migas de bacalao',
        },
        tariffPrice: productCode === '120' ? 12 : 8.5,
        cost: productCode === '120' ? 7 : 5,
        lastSoldPrice: productCode === '120' ? 11.5 : 8.2,
      })),
      calculateBreakeven: jest.fn(async (conn, productCode) => ({
        productCode,
        cost: 5,
        tariffPrice: 8.5,
        floorPrice: 5.25,
        minMarginPercent: 5,
        currentMarginPercent: 41,
      })),
      simulateDiscount: jest.fn(async (conn, productCode, discountPercent) => ({
        productCode,
        originalPrice: 8.5,
        discountPercent,
        newPrice: 7.22,
        originalMargin: 3.5,
        newMargin: 2.22,
        marginLoss: 1.28,
        extraVolumeNeededMultiplier: 1.58,
        profitable: true,
      })),
    },
    riskTools: {
      getClientDebt: jest.fn(async (conn, clientCode) => ({
        clientCode,
        totalDebt: clientCode === '99999' ? 9999 : 1250,
        overdueDebt: clientCode === '99999' ? 800 : 300,
        numInvoices: 2,
        aging: {
          days_1_30: 300,
          days_31_60: 0,
          days_61_90: 0,
          days_over_90: clientCode === '99999' ? 500 : 0,
        },
        riskLevel: clientCode === '99999' ? 'MEDIO' : 'BAJO',
      })),
      checkClientBlocked: jest.fn(async () => ({
        isBlocked: false,
        blockReason: null,
      })),
      calculateRiskScore: jest.fn(async () => ({
        riskScore: 18,
        riskLevel: 'BAJO',
        alerts: [],
        recommendation: 'Operativa permitida.',
      })),
      getClientCreditLimit: jest.fn(async () => ({
        creditLimit: 5000,
        usedCredit: 1200,
        availableCredit: 3800,
        utilizationPercent: 24,
      })),
    },
    commercialTools: {
      getMarginGlobal: jest.fn(async () => ({
        month: 6,
        year: 2026,
        sales: 50000,
        cost: 37500,
        profit: 12500,
        marginPercent: 25,
        clients: 18,
        operations: 90,
      })),
      getMarginByClient: jest.fn(async (conn, clientCode) => ({
        clientCode,
        sales: 4200,
        cost: 3150,
        profit: 1050,
        marginPercent: 25,
        operations: 12,
      })),
      detectChurn: jest.fn(async () => ({
        lostProducts: [],
      })),
      compareClientYoY: jest.fn(async () => ({
        currentYear: { year: 2026, sales: 4200, margin: 25 },
        lastYear: { year: 2025, sales: 3900, margin: 23 },
        growth: { salesPercent: 7.7 },
      })),
    },
    logisticsTools: {
      getStockByWarehouse: jest.fn(async (conn, productCode) => ({
        productCode,
        warehouses: [
          { warehouse: '01', stock: 24 },
          { warehouse: '02', stock: 8 },
        ],
        totalStock: 32,
      })),
    },
    commissionTools: {
      getCommissions: jest.fn(async (conn, userCode, isJefeVentas, month, year) => {
        const currentMonth = month || 6;
        const currentYear = year || 2026;
        return {
          month: currentMonth,
          year: currentYear,
          sales: currentMonth * 1000,
          commission: currentMonth * 100,
          commissionPercent: 10,
          activeClients: currentMonth + 2,
          operations: currentMonth * 3,
        };
      }),
      getCommissionDetails: jest.fn(async () => ({
        month: 6,
        year: 2026,
        details: [{ clientCode: '32258', sales: 1000, commission: 100 }],
      })),
      getCommissionConfig: jest.fn(async () => ({
        ipc: 3,
        tiers: [{ min: 100.01, max: 103, pct: 1 }],
      })),
    },
    objectivesTools: {
      getObjectives: jest.fn(async (conn, userCode, isJefeVentas, month, year) => {
        const currentMonth = month || 6;
        const currentYear = year || 2026;
        return {
          month: currentMonth,
          year: currentYear,
          target: currentMonth * 1000,
          achieved: currentMonth * 800,
          remaining: currentMonth * 200,
          achievementPercent: 80,
        };
      }),
      getObjectivesByFamily: jest.fn(async () => ({
        month: 6,
        year: 2026,
        families: [
          { family: 'CONG', achieved: 1000, target: 1200, achievementPercent: 83.3 },
        ],
      })),
    },
    invoiceTools: {
      resolveInvoiceClientCode: jest.fn(async (conn, invoiceNumber) => invoiceClient(invoiceNumber)),
      getInvoiceDetails: jest.fn(async (conn, invoiceNumber) => ({
        invoiceNumber,
        serie: 'INV',
        numero: '1',
        ejercicio: 2026,
        clientCode: invoiceClient(invoiceNumber),
        amount: 250.75,
        pendingAmount: 120.25,
        status: 'Pendiente',
        issueDate: '2026-06-20',
        dueDate: '2026-07-20',
        pdfPath: `/api/facturas/${invoiceNumber}/pdf`,
        lineCount: 1,
        lines: [
          {
            productCode: 'MIGAS1',
            description: 'Migas de bacalao',
            quantity: 10,
            unitPrice: 8.5,
            amount: 85,
            albaranNumber: 'A-1',
          },
        ],
      })),
      getClientInvoices: jest.fn(async (conn, clientCode) => ({
        clientCode,
        invoices: [
          { number: 'INV-1', amount: 250.75, dueDate: '2026-07-20', status: 'Pendiente' },
        ],
        totalAmount: 250.75,
      })),
      getAlbaranesByInvoice: jest.fn(async (conn, invoiceNumber) => ({
        invoiceNumber,
        clientCode: invoiceClient(invoiceNumber),
        albaranes: [
          { number: 'A-1', clientCode: invoiceClient(invoiceNumber), amount: 85, date: '2026-06-20' },
        ],
      })),
    },
    pedidosTools: {
      getDailyOrders: jest.fn(async () => ({
        year: 2026,
        month: 6,
        day: 25,
        totalOrders: 9,
        totalClients: 6,
        totalAmount: 1800,
        orders: [],
      })),
      getClientOrders: jest.fn(async (conn, clientCode) => ({
        clientCode,
        orders: [
          { orderNumber: 'PED-1', date: '2026-06-25', amount: 340, status: 'Confirmado' },
        ],
      })),
      resolveOrderClientCode: jest.fn(async (conn, orderNumber) =>
        ['PED-2', '2'].includes(String(orderNumber || '').toUpperCase()) ? '99999' : '32258'
      ),
      getOrderDetails: jest.fn(async (conn, orderNumber) => ({
        orderNumber,
        clientCode: ['PED-2', '2'].includes(String(orderNumber || '').toUpperCase()) ? '99999' : '32258',
        date: '2026-06-25',
        amount: 340,
        status: 'Confirmado',
        lineCount: 1,
        lines: [
          { productCode: 'MIGAS1', description: 'Migas de bacalao', quantity: 4, unitPrice: 8.5, amount: 34 },
        ],
      })),
    },
    cobrosTools: {
      getPendingCobros: jest.fn(async (conn, clientCode) => ({
        clientCode,
        totalPending: 250.75,
        documentCount: 1,
        documents: [
          { number: 'INV-1', type: 'FAC', total: 250.75, collected: 0, pending: 250.75, dueDate: '2026-07-20' },
        ],
      })),
      getCobrosSummary: jest.fn(async () => ({
        month: 6,
        year: 2026,
        totalCollectable: 5000,
        totalCollected: 3900,
        totalPending: 1100,
        collectionPercent: 78,
      })),
    },
    bolsaTools: {
      getBolsaStatus: jest.fn(async () => ({
        month: 6,
        year: 2026,
        limitePct: 3,
        limiteImporte: 600,
        saldoDisponible: 420,
        consumido: 180,
        acumulado: 600,
      })),
      getBolsaMovements: jest.fn(async () => ({
        month: 6,
        year: 2026,
        movements: [
          {
            fecha: '2026-06-20',
            tipo: 'USO',
            importe: 50,
            saldoAnterior: 470,
            saldoPosterior: 420,
            descripcion: 'Descuento controlado',
          },
        ],
      })),
      getBolsaHistory: jest.fn(async () => ({
        points: [
          { mes: 5, ejercicio: 2026, acumulado: 550, consumido: 120, saldoDisponible: 430 },
          { mes: 6, ejercicio: 2026, acumulado: 600, consumido: 180, saldoDisponible: 420 },
        ],
        totals: { acumulado: 1150, consumido: 300, saldoNeto: 850 },
      })),
    },
    evolutionTools: {
      getSalesEvolution: jest.fn(async () => ({
        monthly: [
          { period: '2026-05', totalVentas: 9000, totalCosto: 6500, totalMargen: 2500, margenPct: 27.8 },
          { period: '2026-06', totalVentas: 10000, totalCosto: 7200, totalMargen: 2800, margenPct: 28 },
        ],
        summary: { ytdVentas: 52000, yoyChange: 6.5 },
      })),
    },
    analyticsTools: {
      getTopClients: jest.fn(async () => ({
        month: 6,
        year: 2026,
        clients: [{ clientCode: '32258', name: 'CENTRAL HOTELES', sales: 4200, numProducts: 3 }],
      })),
      getTopProducts: jest.fn(async () => ({
        month: 6,
        year: 2026,
        products: [{ productCode: 'MIGAS1', name: 'Migas de bacalao', sales: 1800, quantity: 50 }],
      })),
      getYoYComparison: jest.fn(async () => ({
        currentYear: { year: 2026, sales: 52000 },
        lastYear: { year: 2025, sales: 48000 },
        growth: { salesPercent: 8.3 },
      })),
    },
    repartidorTools: {
      getRepartidorDeliveries: jest.fn(async () => ({
        year: 2026,
        month: 6,
        day: 25,
        totalDeliveries: 8,
        totalLines: 42,
        completed: 6,
        pending: 2,
        deliveries: [],
      })),
      getRepartidorCollections: jest.fn(async () => ({
        month: 6,
        year: 2026,
        summary: {
          totalCollected: 1200,
          totalCollectable: 1500,
          overallPercentage: 80,
        },
        clients: [
          { clientCode: '32258', clientName: 'CENTRAL HOTELES', collected: 800, collectable: 1000, percentage: 80, numDocuments: 2 },
        ],
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
    warehouseTools: {
      getVehicles: jest.fn(async () => ({
        vehicles: [
          { code: 'CAM-1', description: 'Camion reparto', matricula: '1234-GMP', maxPayloadKg: 1200, numPalets: 8 },
        ],
      })),
      getWarehouseDashboard: jest.fn(async () => ({
        date: { day: 25, month: 6, year: 2026 },
        totalTrucks: 1,
        trucks: [
          { vehicleCode: 'CAM-1', matricula: '1234-GMP', driverCode: '80', driverName: 'Repartidor 80', orderCount: 9, lineCount: 42 },
        ],
      })),
    },
    summaryTools: {
      getDailySummary: jest.fn(async () => ({
        day: 25,
        month: 6,
        year: 2026,
        totalSales: 12000,
        totalOrders: 14,
        totalClients: 9,
        totalOperations: 61,
        topClients: [{ name: 'CENTRAL HOTELES', sales: 4200 }],
      })),
    },
    crossQueryTools: {
      getPriceSoldToClient: jest.fn(async (conn, productCode, clientCode) => ({
        productCode,
        clientCode,
        sales: [
          { date: '2026-06-20', price: 9.5, quantity: 4, amount: 38, orderNumber: 'PED-1' },
        ],
      })),
      getTopProductsByClient: jest.fn(async (conn, clientCode) => ({
        clientCode,
        month: 6,
        year: 2026,
        products: [
          { code: 'MIGAS1', name: 'Migas de bacalao', family: 'CONG', totalSales: 1200, totalUnits: 40, avgPrice: 8.5 },
        ],
      })),
      getClientMonthlySales: jest.fn(async () => ({
        monthly: [
          { period: '2026-05', totalSales: 1800, totalUnits: 50 },
          { period: '2026-06', totalSales: 2400, totalUnits: 70 },
        ],
      })),
      getClientProductsBought: jest.fn(async () => ({
        products: [
          { code: 'MIGAS1', name: 'Migas de bacalao', totalSales: 1200, totalUnits: 40 },
        ],
      })),
    },
    genericAnalyticsTools: {
      queryClientPurchases: jest.fn(async (conn, clientCode, dateFrom, dateTo, familyCode, productCode) => ({
        clientCode,
        productCode,
        totalSales: 420,
        purchaseCount: 2,
        purchases: [
          { productCode, productName: productCode === 'CAL1' ? 'Anillas de calamar' : 'Migas de bacalao', family: 'CONG', period: '2026-05', sales: 180, units: 12, lines: 1 },
          { productCode, productName: productCode === 'CAL1' ? 'Anillas de calamar' : 'Migas de bacalao', family: 'CONG', period: '2026-06', sales: 240, units: 16, lines: 2 },
        ],
      })),
      extractPdfContent: jest.fn(async (conn, documentType, reference) => ({
        documentType,
        reference,
        invoiceNumber: reference,
        serie: 'INV',
        numero: '1',
        ejercicio: 2026,
        clientCode: invoiceClient(reference),
        amount: 250.75,
        issueDate: '2026-06-20',
        extractionMethod: 'mock-pdf',
        pdfPath: `/api/facturas/${reference}/pdf`,
        hint: 'mock',
        pdfText: 'Factura de prueba con linea de migas de bacalao.',
        structured: {
          lineCount: 1,
          lines: [
            { productCode: 'MIGAS1', description: 'Migas de bacalao', quantity: 10, unitPrice: 8.5, amount: 85 },
          ],
        },
      })),
    },
  };
});

const { handleChatMessage } = require('../src/chatbot/chatbot_handler');
const { authorizeResolvedClient } = require('../src/chatbot/chatbot_authorization');
const {
  analyticsTools,
  bolsaTools,
  cobrosTools,
  commissionTools,
  crossQueryTools,
  dbDiscoveryTools,
  genericAnalyticsTools,
  invoiceTools,
  logisticsTools,
  objectivesTools,
  pedidosTools,
  pricingTools,
  repartidorTools,
  riskTools,
  summaryTools,
  warehouseTools,
} = require('../src/chatbot/chatbot_tools');

const conn = { query: jest.fn(async () => []) };

const supervisorContext = {
  userCode: '80',
  role: 'JEFE_VENTAS',
  isJefeVentas: true,
  vendorScope: ['ALL'],
  richResponses: true,
};

const commercialContext = {
  userCode: '80',
  role: 'COMERCIAL',
  isJefeVentas: false,
  vendorScope: ['80'],
  richResponses: true,
};

const repartidorContext = {
  userCode: '80',
  role: 'REPARTIDOR',
  isJefeVentas: false,
  vendorScope: ['80'],
  richResponses: true,
};

function responseText(response) {
  return typeof response === 'string' ? response : response?.text;
}

function allDataToolMocks() {
  return [
    analyticsTools.getTopClients,
    analyticsTools.getTopProducts,
    analyticsTools.getYoYComparison,
    bolsaTools.getBolsaHistory,
    bolsaTools.getBolsaMovements,
    bolsaTools.getBolsaStatus,
    cobrosTools.getCobrosSummary,
    cobrosTools.getPendingCobros,
    commissionTools.getCommissionConfig,
    commissionTools.getCommissionDetails,
    commissionTools.getCommissions,
    crossQueryTools.getClientMonthlySales,
    crossQueryTools.getClientProductsBought,
    crossQueryTools.getPriceSoldToClient,
    crossQueryTools.getTopProductsByClient,
    genericAnalyticsTools.extractPdfContent,
    genericAnalyticsTools.queryClientPurchases,
    invoiceTools.getAlbaranesByInvoice,
    invoiceTools.getClientInvoices,
    invoiceTools.getInvoiceDetails,
    invoiceTools.resolveInvoiceClientCode,
    logisticsTools.getStockByWarehouse,
    objectivesTools.getObjectives,
    objectivesTools.getObjectivesByFamily,
    pedidosTools.getClientOrders,
    pedidosTools.getDailyOrders,
    pedidosTools.getOrderDetails,
    pedidosTools.resolveOrderClientCode,
    pricingTools.calculateBreakeven,
    pricingTools.getProductPrice,
    pricingTools.simulateDiscount,
    repartidorTools.getRepartidorCollections,
    repartidorTools.getRepartidorCommissions,
    repartidorTools.getRepartidorDeliveries,
    riskTools.calculateRiskScore,
    riskTools.checkClientBlocked,
    riskTools.getClientCreditLimit,
    riskTools.getClientDebt,
    summaryTools.getDailySummary,
    warehouseTools.getVehicles,
    warehouseTools.getWarehouseDashboard,
  ];
}

function snapshotCalls(mocks) {
  return new Map(mocks.map((mock) => [mock, mock.mock.calls.length]));
}

function expectMocksAdvanced(before, expectedMocks, message, text) {
  for (const mock of expectedMocks) {
    if (mock.mock.calls.length <= before.get(mock)) {
      throw new Error(`Expected mocked tool to be called for query: "${message}". Response: ${text}`);
    }
  }
}

const MASSIVE_CASES = [
  {
    message: 'mi comision acumulada de enero a marzo 2026',
    expectedTools: [commissionTools.getCommissions],
  },
  {
    message: 'comisiones mias de enero y febrero',
    expectedTools: [commissionTools.getCommissions],
  },
  {
    message: 'comi acum ultimos 3 meses',
    expectedTools: [commissionTools.getCommissions],
  },
  {
    message: 'cuanto gano en comisiones marzo',
    expectedTools: [commissionTools.getCommissions],
  },
  {
    message: 'objetivo acumulado de enero a marzo 2026',
    expectedTools: [objectivesTools.getObjectives],
  },
  {
    message: 'obj acum ene mar 2026',
    expectedTools: [objectivesTools.getObjectives],
  },
  {
    message: 'cuanto me falta para el objetivo',
    expectedTools: [objectivesTools.getObjectives],
  },
  {
    message: 'objetivo por familia',
    expectedTools: [objectivesTools.getObjectivesByFamily],
  },
  {
    message: 'dime el producto de migas',
    expectedTools: [dbDiscoveryTools.searchProductsFlexible],
  },
  {
    message: 'precio producto migas',
    expectedTools: [dbDiscoveryTools.searchProductsFlexible, pricingTools.getProductPrice],
  },
  {
    message: 'precio del producto 120',
    expectedTools: [pricingTools.getProductPrice],
  },
  {
    message: 'stock producto migas',
    expectedTools: [dbDiscoveryTools.searchProductsFlexible, logisticsTools.getStockByWarehouse],
  },
  {
    message: 'stok migass',
    expectedTools: [dbDiscoveryTools.searchProductsFlexible, logisticsTools.getStockByWarehouse],
  },
  {
    message: 'a cuanto le vendi a este cliente el calamar',
    currentClientCode: '32258',
    expectedTools: [dbDiscoveryTools.searchProductsFlexible, crossQueryTools.getPriceSoldToClient],
  },
  {
    message: 'cuanto le vendi a este cliente de calamar',
    currentClientCode: '32258',
    expectedTools: [dbDiscoveryTools.searchProductsFlexible, genericAnalyticsTools.queryClientPurchases],
  },
  {
    message: 'deuda central hoteles',
    expectedTools: [dbDiscoveryTools.searchClientsFlexible, riskTools.getClientDebt],
  },
  {
    message: 'buscar cliente central hoteles',
    expectedTools: [dbDiscoveryTools.searchClientsFlexible],
  },
  {
    message: 'riesgo cliente 32258',
    expectedTools: [riskTools.calculateRiskScore],
  },
  {
    message: 'credito cliente 32258',
    expectedTools: [riskTools.getClientCreditLimit],
  },
  {
    message: 'historial cliente 32258',
    expectedTools: [crossQueryTools.getClientProductsBought],
  },
  {
    message: 'facturas del cliente 32258',
    expectedTools: [invoiceTools.getClientInvoices],
  },
  {
    message: 'factura INV-1',
    expectedTools: [invoiceTools.resolveInvoiceClientCode, invoiceTools.getInvoiceDetails],
  },
  {
    message: 'lee la factura INV-1 pdf',
    expectedTools: [invoiceTools.resolveInvoiceClientCode, genericAnalyticsTools.extractPdfContent],
  },
  {
    message: 'albaranes',
    context: {
      ...supervisorContext,
      conversationHistory: ['factura INV-1'],
    },
    expectedTools: [invoiceTools.resolveInvoiceClientCode, invoiceTools.getAlbaranesByInvoice],
  },
  {
    message: 'mi ruta hoy',
    context: repartidorContext,
    expectedTools: [repartidorTools.getRepartidorDeliveries],
  },
  {
    message: 'recaud repartidor',
    context: repartidorContext,
    expectedTools: [repartidorTools.getRepartidorCollections],
  },
  {
    message: 'comision repartidor',
    context: repartidorContext,
    expectedTools: [repartidorTools.getRepartidorCommissions],
  },
  {
    message: 'pedidos',
    plainOnly: true,
    expectedTools: [pedidosTools.getDailyOrders],
  },
  {
    message: 'pedido PED-1',
    currentClientCode: '32258',
    expectedTools: [pedidosTools.resolveOrderClientCode, pedidosTools.getOrderDetails],
  },
  {
    message: 'pedido cliente 32258',
    expectedTools: [pedidosTools.getClientOrders],
  },
  {
    message: 'recaudacion cliente actual',
    currentClientCode: '32258',
    expectedTools: [cobrosTools.getPendingCobros],
  },
  {
    message: 'top clientes del mes',
    expectedTools: [analyticsTools.getTopClients],
  },
  {
    message: 'saldo bolsa',
    expectedTools: [bolsaTools.getBolsaStatus],
  },
  {
    message: 'movimientos bolsa',
    expectedTools: [bolsaTools.getBolsaMovements],
  },
  {
    message: 'ultimos 6 meses bolsa',
    expectedTools: [bolsaTools.getBolsaHistory],
  },
  {
    message: 'resumen Glacius hoy',
    expectedTools: [summaryTools.getDailySummary],
  },
  {
    message: 'carga almacen hoy',
    expectedTools: [warehouseTools.getWarehouseDashboard],
  },
  {
    message: 'vehiculos almacen',
    expectedTools: [warehouseTools.getVehicles],
  },
];

const OUT_OF_SCOPE_MESSAGES = [
  'esto no se entiende nada',
  'facutra pfd de algo sin numero',
  'quiero que me digas una receta de arroz',
  'borra todos los clientes',
  'dame la contrasena del servidor',
  'manda whatsapp al cliente',
  'abre una transferencia bancaria',
  'cambia el precio de todos los articulos',
];

const PREFIXES = [
  '',
  'dime ',
  'consulta ',
  'quiero saber ',
  'puedes mirar ',
  'necesito ',
  'comprueba ',
  'mira ',
];

const SUFFIXES = [
  '',
  ' por favor',
  ' ahora',
  ' en lenguaje normal',
  ' en la app',
  ' para mi sesion',
  ' sin rodeos',
  ' cuando puedas',
];

function buildMassiveQueries() {
  const generated = [];
  for (const baseCase of MASSIVE_CASES) {
    const prefixes = baseCase.plainOnly ? [''] : PREFIXES;
    const suffixes = baseCase.plainOnly ? [''] : SUFFIXES;
    for (const prefix of prefixes) {
      for (const suffix of suffixes) {
        generated.push({
          ...baseCase,
          message: `${prefix}${baseCase.message}${suffix}`.replace(/\s+/g, ' ').trim(),
        });
      }
    }
  }
  return generated;
}

describe('chatbot massive deterministic contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('handles thousands of natural queries without throwing and calls the expected tools', async () => {
    const generatedQueries = buildMassiveQueries();
    expect(generatedQueries.length).toBeGreaterThanOrEqual(2000);

    for (const queryCase of generatedQueries) {
      const before = snapshotCalls(queryCase.expectedTools);
      const response = await handleChatMessage(
        conn,
        queryCase.message,
        queryCase.context?.vendorScope || supervisorContext.vendorScope,
        queryCase.currentClientCode || null,
        queryCase.context || supervisorContext
      );

      const text = responseText(response);
      expect(typeof text).toBe('string');
      expect(text.trim().length).toBeGreaterThan(0);
      expectMocksAdvanced(before, queryCase.expectedTools, queryCase.message, text);
    }

    expect(conn.query).not.toHaveBeenCalled();
  });

  test('blocks out-of-scope and malformed questions safely without data tool calls', async () => {
    for (const message of OUT_OF_SCOPE_MESSAGES) {
      const before = snapshotCalls(allDataToolMocks());
      const response = await handleChatMessage(
        conn,
        message,
        supervisorContext.vendorScope,
        null,
        supervisorContext
      );

      const text = responseText(response);
      expect(typeof text).toBe('string');
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).toMatch(/No tengo suficiente precision|Necesito|Solo consultas|No he detectado|No he encontrado ningun cliente|No he encontrado productos/i);

      for (const mock of allDataToolMocks()) {
        expect(mock.mock.calls.length).toBe(before.get(mock));
      }
    }

    expect(conn.query).not.toHaveBeenCalled();
  });
});

describe('chatbot massive contract RBAC', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('denies COMERCIAL access to another seller client before querying client data', async () => {
    const debtResponse = await handleChatMessage(
      conn,
      'deuda cliente 99999',
      ['80'],
      null,
      commercialContext
    );

    expect(responseText(debtResponse)).toMatch(/No tengo acceso/i);
    expect(riskTools.getClientDebt).not.toHaveBeenCalled();

    const invoiceResponse = await handleChatMessage(
      conn,
      'facturas del cliente 99999',
      ['80'],
      null,
      commercialContext
    );

    expect(responseText(invoiceResponse)).toMatch(/No tengo acceso/i);
    expect(invoiceTools.getClientInvoices).not.toHaveBeenCalled();

    const orderResponse = await handleChatMessage(
      conn,
      'pedido PED-2',
      ['80'],
      '99999',
      commercialContext
    );

    expect(responseText(orderResponse)).toMatch(/No tengo acceso/i);
    expect(pedidosTools.getOrderDetails).not.toHaveBeenCalled();
    expect(conn.query).not.toHaveBeenCalled();
  });

  test('allows JEFE_VENTAS and ADMIN supervisor roles to query another seller client', async () => {
    const jefeResponse = await handleChatMessage(
      conn,
      'deuda cliente 99999',
      ['ALL'],
      null,
      {
        userCode: '01',
        role: 'JEFE_VENTAS',
        isJefeVentas: true,
        vendorScope: ['ALL'],
        richResponses: true,
      }
    );

    expect(responseText(jefeResponse)).toMatch(/Deuda cliente 99999/i);
    expect(riskTools.getClientDebt).toHaveBeenCalledWith(conn, '99999');

    const adminResponse = await handleChatMessage(
      conn,
      'deuda cliente 99999',
      ['ALL'],
      null,
      {
        userCode: '99',
        role: 'ADMIN',
        isJefeVentas: false,
        vendorScope: ['ALL'],
        richResponses: true,
      }
    );

    expect(responseText(adminResponse)).toMatch(/Deuda cliente 99999/i);
    expect(riskTools.getClientDebt).toHaveBeenCalledWith(conn, '99999');
    expect(authorizeResolvedClient).toHaveBeenCalledWith(
      conn,
      expect.objectContaining({
        role: 'ADMIN',
        isJefeVentas: true,
        vendorScope: ['ALL'],
      }),
      '99999'
    );
    expect(conn.query).not.toHaveBeenCalled();
  });
});
