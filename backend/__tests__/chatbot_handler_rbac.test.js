'use strict';

jest.mock('../src/chatbot/chatbot_authorization', () => {
  const actual = jest.requireActual('../src/chatbot/chatbot_authorization');
  return {
    ...actual,
    authorizeResolvedClient: jest.fn(),
    buildAuthorizationSafeResponse: jest.fn((code) =>
      code === 'CLIENT_SCOPE_UNVERIFIED'
        ? 'No puedo verificar que ese cliente pertenezca a tu ambito autorizado.'
        : 'No tengo acceso a esa informacion.'
    ),
  };
});

jest.mock('../src/chatbot/chatbot_tools', () => {
  const actual = jest.requireActual('../src/chatbot/chatbot_tools');
  return {
    ...actual,
    riskTools: {
      ...actual.riskTools,
      getClientDebt: jest.fn(async () => ({
        totalDebt: 9999,
        overdueDebt: 120,
        riskLevel: 'BAJO',
        aging: {
          days_1_30: 120,
          days_31_60: 0,
          days_61_90: 0,
          days_over_90: 0,
        },
      })),
    },
    invoiceTools: {
      ...actual.invoiceTools,
      resolveInvoiceClientCode: jest.fn(async () => 'CLI-AJENO'),
      getInvoiceDetails: jest.fn(async () => ({ invoiceNumber: 'INV-1' })),
      getAlbaranesByInvoice: jest.fn(async () => ({
        albaranes: [
          { number: 'A/100/2026', amount: 125.5 },
        ],
      })),
      getClientInvoices: jest.fn(async (conn, clientCode) => ({
        clientCode,
        invoices: [
          { number: 'F/100/2026', amount: 250.75, status: 'Pendiente' },
        ],
        totalAmount: 250.75,
      })),
    },
    dbDiscoveryTools: {
      ...actual.dbDiscoveryTools,
      searchClients: jest.fn(async () => [
        { CODIGO: '32258', NOMBRE: 'EL CENTRAL HOTELES', POBLACION: 'Madrid' },
      ]),
      searchClientsFlexible: jest.fn(async () => [
        { CODIGO: '32258', NOMBRE: 'EL CENTRAL HOTELES', POBLACION: 'Madrid' },
      ]),
    },
  };
});

const { handleChatMessage } = require('../src/chatbot/chatbot_handler');
const { authorizeResolvedClient } = require('../src/chatbot/chatbot_authorization');
const { dbDiscoveryTools, riskTools, invoiceTools } = require('../src/chatbot/chatbot_tools');

describe('chatbot fallback handler RBAC', () => {
  const conn = { query: jest.fn(async () => []) };
  const baseContext = {
    userCode: '80',
    role: 'COMERCIAL',
    isJefeVentas: false,
    vendorScope: ['80'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('denies client-scoped deuda before riskTools query', async () => {
    authorizeResolvedClient.mockResolvedValue({
      owner: { clientCode: '12345678', vendorCode: '81', verified: true },
      authorization: { allowed: false, code: 'FORBIDDEN_CLIENT_SCOPE' },
    });

    const response = await handleChatMessage(
      conn,
      'deuda cliente 12345678',
      ['80'],
      null,
      baseContext
    );

    expect(response).toMatch(/No tengo acceso/i);
    expect(riskTools.getClientDebt).not.toHaveBeenCalled();
  });

  test('denies invoice lookup for client outside vendor scope', async () => {
    authorizeResolvedClient.mockResolvedValue({
      owner: { clientCode: 'CLI-AJENO', vendorCode: '81', verified: true },
      authorization: { allowed: false, code: 'FORBIDDEN_CLIENT_SCOPE' },
    });

    const response = await handleChatMessage(
      conn,
      'factura INV-1',
      ['80'],
      null,
      baseContext
    );

    expect(response).toMatch(/No tengo acceso/i);
    expect(invoiceTools.getInvoiceDetails).not.toHaveBeenCalled();
  });

  test('returns navigation help without DB access', async () => {
    const response = await handleChatMessage(
      conn,
      'donde esta la seccion de facturas',
      ['80'],
      null,
      baseContext
    );

    expect(response).toMatch(/Facturas/i);
    expect(response).toMatch(/Evoluci[oó]n/i);
    expect(authorizeResolvedClient).not.toHaveBeenCalled();
    expect(conn.query).not.toHaveBeenCalled();
  });

  test('resolves natural client name for supervisor invoice list', async () => {
    authorizeResolvedClient.mockResolvedValue({
      owner: { clientCode: '32258', vendorCode: null, verified: false },
      authorization: { allowed: true, code: 'ALLOWED_SUPERVISOR' },
    });

    const response = await handleChatMessage(
      conn,
      'dime las facturas de central hoteles',
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

    expect(dbDiscoveryTools.searchClientsFlexible).toHaveBeenCalledWith(
      conn,
      'central hoteles',
      12
    );
    expect(invoiceTools.getClientInvoices).toHaveBeenCalledWith(conn, '32258');
    expect(response.text).toMatch(/Facturas pendientes cliente 32258/);
    expect(response.metadata.deepLink.tab).toBe('Facturas');
    expect(response.metadata.exportable.rows).toHaveLength(1);
  });

  test('routes albaranes de factura before invoice detail', async () => {
    authorizeResolvedClient.mockResolvedValue({
      owner: { clientCode: 'CLI-AJENO', vendorCode: '81', verified: true },
      authorization: { allowed: true, code: 'ALLOWED_SUPERVISOR' },
    });

    const response = await handleChatMessage(
      conn,
      'albaranes de la factura F/100/2026',
      ['ALL'],
      null,
      {
        userCode: '01',
        role: 'ADMIN',
        isJefeVentas: true,
        vendorScope: ['ALL'],
        richResponses: true,
      }
    );

    expect(invoiceTools.resolveInvoiceClientCode).toHaveBeenCalledWith(
      conn,
      'F/100/2026'
    );
    expect(invoiceTools.getAlbaranesByInvoice).toHaveBeenCalledWith(
      conn,
      'F/100/2026',
      '01',
      true,
      ['ALL']
    );
    expect(invoiceTools.getInvoiceDetails).not.toHaveBeenCalled();
    expect(response.text).toMatch(/Albaranes de factura F\/100\/2026/);
  });
});
