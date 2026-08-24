'use strict';

const mockBuildPdf = jest.fn();
const mockRepository = {
  bindings: { runtime: { valid: true } },
  helpers: {
    cobrosDateFilterColumn: jest.fn(),
    cobrosDateSelectColumns: jest.fn(),
    cobrosDateOrderBy: jest.fn(),
  },
  tables: {},
  selectLiquidacionByToken: jest.fn(),
};

jest.mock('../repositories/reparto-finance-db2-repository', () => ({
  getRepartoFinanceDb2Repository: () => mockRepository,
}));
jest.mock('../middleware/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../services/liquidacion-pdf-service', () => ({
  buildLiquidacionPdfBuffer: (...args) => mockBuildPdf(...args),
  formatGmpLiquidacionDisplay: () => 'GMP 2026 A 094 000701',
  cashToDeposit: jest.fn(),
}));

const { buildClosedLiquidacionPdf } = require('../services/repartidor-finance-service');

function closedRow(snapshot, createdAt = '2026-08-19 07:10:24.000000') {
  return {
    ID: '701', IDEMPOTENCY_TOKEN: 'liquidacion-pdf-token-0001', CODIGOVENDEDOR: '94', STATUS: 'CLOSED',
    ANOLIQUIDACION: 2026, SERIELIQUIDACION: 'A', NUMEROLIQUIDACION: 701, CREATED_AT: createdAt,
    REPLAY_IDENTITY_JSON: JSON.stringify({ repartidorId: '94', date: '2026-08-19' }),
    SNAPSHOT_JSON: JSON.stringify(snapshot),
  };
}

function closedSnapshot(payment = {}) {
  return {
    repartidorId: '94', date: '2026-08-19', openingBalance: 0,
    breakdown: { payments: 20, expenses: 0, adjustments: 0, bankDeposits: 0 },
    payments: [{ id: 'COB-1', amount: 20, paymentMethod: 'EF', collectedAt: '2026-08-19T07:10:00Z', ...payment }],
  };
}

describe('closed liquidation PDF snapshot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildPdf.mockResolvedValue(Buffer.from('%PDF-test'));
  });

  test('uses the immutable payment metadata and persisted creation timestamp', async () => {
    mockRepository.selectLiquidacionByToken.mockResolvedValue([closedRow(closedSnapshot({
      codigoCliente: '4300040696', nombreCliente: 'LINARES ROMAN CARLOS ANDRES',
      tipoDocumento: 'FAC', documento: 'F 000 006290',
    }))]);

    await buildClosedLiquidacionPdf({ idempotencyToken: 'liquidacion-pdf-token-0001', repartidorId: '94' });

    expect(mockBuildPdf).toHaveBeenCalledWith(expect.objectContaining({
      generatedAt: '2026-08-19 07:10:24.000000',
      cobros: [expect.objectContaining({
        codigoCliente: '4300040696', nombreCliente: 'LINARES ROMAN CARLOS ANDRES',
        tipoDocumento: 'FAC', documento: 'F 000 006290',
      })],
    }));
  });

  test('fails closed when persisted payment metadata has an invalid shape', async () => {
    mockRepository.selectLiquidacionByToken.mockResolvedValue([closedRow(closedSnapshot({ codigoCliente: { unsafe: true } }))]);

    await expect(buildClosedLiquidacionPdf({ idempotencyToken: 'liquidacion-pdf-token-0001', repartidorId: '94' }))
      .rejects.toMatchObject({ code: 'LIQUIDACION_PDF_UNAVAILABLE', statusCode: 503 });
  });

  test('replays JAVIER.LQD shadow row without OPS JSON or STATUS', async () => {
    mockRepository.selectLiquidacionByToken.mockResolvedValue([{
      ID: 1, CODIGOVENDEDOR: '56', IDMARCALIQUIDACION: 'G4DG43SMOKE01',
      ANOLIQUIDACION: 2026, MESLIQUIDACION: 8, DIALIQUIDACION: 23,
      SERIELIQUIDACION: 'A', NUMEROLIQUIDACION: 1,
      IMPORTESALDOACTUAL: 26.12, IMPORTEEFECTIVO: 0, IMPORTECHEQUES: 0,
      IMPORTETARJETA: 0, IMPORTEPOSTDATADOS: 0, IMPORTEGASTOS: 0,
      IMPORTEINGRESOENBANCO: 0,
    }]);
    const result = await buildClosedLiquidacionPdf({
      idempotencyToken: 'G4DG43SMOKE01', repartidorId: '56',
    });
    expect(result.status).toBe('CLOSED');
    expect(result.date).toBe('2026-08-23');
    expect(mockBuildPdf).toHaveBeenCalled();
  });

  test('owner mismatch does not enumerate the token', async () => {
    mockRepository.selectLiquidacionByToken.mockResolvedValue([{
      ID: 1, CODIGOVENDEDOR: '56', IDMARCALIQUIDACION: 'G4DG43SMOKE01',
      ANOLIQUIDACION: 2026, MESLIQUIDACION: 8, DIALIQUIDACION: 23,
      IMPORTESALDOACTUAL: 0,
    }]);
    await expect(buildClosedLiquidacionPdf({
      idempotencyToken: 'G4DG43SMOKE01', repartidorId: '99',
    })).rejects.toMatchObject({
      message: 'No existe la liquidacion solicitada',
      code: 'LIQUIDACION_NOT_FOUND',
      statusCode: 404,
    });
    expect(mockBuildPdf).not.toHaveBeenCalled();
  });
});
