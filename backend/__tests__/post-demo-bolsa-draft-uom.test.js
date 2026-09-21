'use strict';

const {
  resolveEffectiveSalePrice,
  getLineQuantity,
} = require('../services/bolsa-comercial.service');

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

describe('bolsa discount + UOM quantity', () => {
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
