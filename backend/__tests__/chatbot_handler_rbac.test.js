'use strict';

jest.mock('../src/chatbot/chatbot_authorization', () => ({
  authorizeResolvedClient: jest.fn(),
  buildAuthorizationSafeResponse: jest.fn((code) =>
    code === 'CLIENT_SCOPE_UNVERIFIED'
      ? 'No puedo verificar que ese cliente pertenezca a tu ambito autorizado.'
      : 'No tengo acceso a esa informacion.'
  ),
}));

jest.mock('../src/chatbot/chatbot_tools', () => {
  const actual = jest.requireActual('../src/chatbot/chatbot_tools');
  return {
    ...actual,
    riskTools: {
      ...actual.riskTools,
      getClientDebt: jest.fn(async () => ({ totalDebt: 9999 })),
    },
    invoiceTools: {
      ...actual.invoiceTools,
      resolveInvoiceClientCode: jest.fn(async () => 'CLI-AJENO'),
      getInvoiceDetails: jest.fn(async () => ({ invoiceNumber: 'INV-1' })),
    },
  };
});

const { handleChatMessage } = require('../src/chatbot/chatbot_handler');
const { authorizeResolvedClient } = require('../src/chatbot/chatbot_authorization');
const { riskTools, invoiceTools } = require('../src/chatbot/chatbot_tools');

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
});
