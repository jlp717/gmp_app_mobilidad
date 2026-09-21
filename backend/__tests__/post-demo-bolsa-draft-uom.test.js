'use strict';

const {
  resolveEffectiveSalePrice,
  getLineQuantity,
  validateOrderWithBolsa,
} = require('../services/bolsa-comercial.service');
const { queryWithParams } = require('../config/db');

jest.mock('../config/db', () => ({
  queryWithParams: jest.fn(),
  getPool: jest.fn(),
  initDb: jest.fn(),
}));

jest.mock('../middleware/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const bolsaRow = {
  ID: 1,
  CODIGOVENDEDOR: '05  ',
  EJERCICIO: 2026,
  MES: 9,
  LIMITE_PCT: 3,
  LIMITE_IMPORTE: 0,
  SALDO_DISPONIBLE: 300,
  CONSUMIDO: 0,
  ACUMULADO: 0,
};

/** Pedido al precio = tarifa: sin dto no mueve bolsa; con dto global sí consume. */
const tariffLine = {
  ID: 78,
  codigoArticulo: '1412',
  precioTarifaCliente: 10,
  precioTarifa: 10,
  precioMinimo: 8,
  precioVenta: 10,
  cantidadEnvases: 2,
  cantidadUnidades: 2,
  unidadMedida: 'CAJAS',
};

describe('bolsa discount + UOM quantity', () => {
  beforeEach(() => {
    queryWithParams.mockReset();
  });

  test('resolveEffectiveSalePrice applies line and global discounts', () => {
    expect(resolveEffectiveSalePrice({
      precioVenta: 10,
      descuentoLinea: 10,
    }, 0)).toBe(9);
    expect(resolveEffectiveSalePrice({
      PRECIOVENTA: 10,
      DESCUENTO_LINEA: 20,
    }, 10)).toBe(7.2);
  });

  test('getLineQuantity uses unidades for kg/uds and cajas for CAJAS', () => {
    expect(getLineQuantity({
      unidadMedida: 'KILOGRAMOS',
      cantidadUnidades: 5.5,
      cantidadEnvases: 1,
    })).toBe(5.5);
    expect(getLineQuantity({
      UNIDADMEDIDA: 'UNIDADES',
      CANTIDADUNIDADES: 12,
      CANTIDADENVASES: 2,
    })).toBe(12);
    expect(getLineQuantity({
      unidadMedida: 'CAJAS',
      cantidadEnvases: 3,
      cantidadUnidades: 30,
      unidadesCaja: 10,
    })).toBe(3);
  });

  test('validateOrderWithBolsa: apply then remove global discount recalculates consumo', async () => {
    queryWithParams.mockResolvedValue([bolsaRow]);

    const without = await validateOrderWithBolsa('05', [tariffLine], {
      globalDiscountPct: 0,
    });
    expect(without.valid).toBe(true);
    expect(without.consumo).toBe(0);
    expect(without.acumulacion).toBe(0);
    expect(without.lineMovements).toHaveLength(0);

    queryWithParams.mockResolvedValue([bolsaRow]);
    const withDto = await validateOrderWithBolsa('05', [tariffLine], {
      globalDiscountPct: 10,
    });
    // effective = 10 * 0.9 = 9 → consumo (10-9)*2 = 2
    expect(withDto.valid).toBe(true);
    expect(withDto.consumo).toBe(2);
    expect(withDto.acumulacion).toBe(0);
    expect(withDto.lineMovements).toHaveLength(1);
    expect(withDto.lineMovements[0].tipo).toBe('CONSUMO');
    expect(withDto.lineMovements[0].importe).toBe(2);

    queryWithParams.mockResolvedValue([bolsaRow]);
    const removed = await validateOrderWithBolsa('05', [tariffLine], {
      globalDiscountPct: 0,
      descuentoGlobal: 0,
    });
    expect(removed.valid).toBe(true);
    expect(removed.consumo).toBe(0);
    expect(removed.acumulacion).toBe(0);
    expect(removed.lineMovements).toHaveLength(0);
  });

  test('validateOrderWithBolsa: line discount alone consumes bolsa vs tarifa', async () => {
    queryWithParams.mockResolvedValue([bolsaRow]);
    const result = await validateOrderWithBolsa('05', [{
      ...tariffLine,
      descuentoLinea: 10,
    }], { globalDiscountPct: 0 });
    expect(result.valid).toBe(true);
    expect(result.consumo).toBe(2);
    expect(result.lineMovements[0].tipo).toBe('CONSUMO');
  });
});

describe('purgeExpiredDraftReservations export', () => {
  test('pedidos service exports purge helper', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../services/pedidos/index.js'),
      'utf8',
    );
    expect(source).toMatch(/async function purgeExpiredDraftReservations/);
    expect(source).toMatch(/purgeExpiredDraftReservations,/);
    expect(source).toMatch(/DRAFT_STOCK_RESERVATION_HOURS = 24/);
  });
});

describe('comercial liquidacion isolated LQD', () => {
  test('getLqdForVendorDay prefers TEST_LQD in isolated_test', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../services/comercial-devoluciones-service.js'),
      'utf8',
    );
    expect(source).toMatch(/comercialErpSnapshotTable\('LQD'\)/);
    expect(source).toMatch(/isIsolatedCommercialTest\(\)/);
  });
});

describe('comercial cobro PDF notify wiring', () => {
  test('cobros registrar wires notifyCommercialCobro', () => {
    const route = require('fs').readFileSync(
      require('path').join(__dirname, '../routes/cobros.js'),
      'utf8',
    );
    expect(route).toMatch(/notifyCommercialCobro/);
    expect(route).toMatch(/comercial-cobro-notify-service/);
  });
});
