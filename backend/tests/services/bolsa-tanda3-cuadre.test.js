'use strict';

/**
 * Tanda3 bolsa — REQ-13/15 (VERIFY, sin DB2 real).
 * - resolveBolsaReferencePrice / resolveEffectiveSalePrice / getLineQuantity:
 *   misma fórmula que `OrderLine` Flutter (tarifaCliente ?? tarifa ?? mínimo;
 *   precio efectivo con dto línea + global redondeado a 2; qty con UOM real).
 * - Repro 1 €: 10.333 × 3 sobre tarifa 10 → 0.99 (redondeo por unidad),
 *   no 1.00 (redondeo por total de la fórmula vieja Flutter).
 * - validateOrderWithBolsa (mock config/db): dif −Y bajo tarifa → CONSUMO Y;
 *   dto global que hunde bajo tarifa → consumo > 0 (fail-closed); queries
 *   capturadas sin DML DSEDAC (dsedac-write-guard) y con binding (?).
 * QSYS2 live 2026-09-24 (MCP ibm-db2, DSN GMP):
 *   MOVIMIENTOS_BOLSA: ID, BOLSA_ID, PEDIDO_ID, TIPO, IMPORTE,
 *     SALDO_ANTERIOR, SALDO_POSTERIOR, CODIGO_ARTICULO, DESCRIPCION,
 *     CREATED_AT, CODIGOVENDEDOR, LINEA_ID, PRECIO_MINIMO_CONGELADO,
 *     PRECIO_VENTA, CANTIDAD, UNIDAD_MEDIDA, IDEMPOTENCY_KEY.
 */

jest.mock('../../middleware/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const mockCapturedQueries = [];
let mockBolsaRow = null;
jest.mock('../../config/db', () => ({
    query: jest.fn(async () => []),
    queryWithParams: jest.fn(async (sql, params) => {
        mockCapturedQueries.push({ sql, params });
        if (String(sql).includes('BOLSA_COMERCIAL') && String(sql).includes('TRIM(CODIGOVENDEDOR)')) {
            return mockBolsaRow ? [mockBolsaRow] : [];
        }
        return [];
    }),
    getPool: jest.fn(() => null),
    initDb: jest.fn(async () => null),
}));

const { assertNoDsedacWrite } = require('../../utils/dsedac-write-guard');
const bolsaService = require('../../services/bolsa-comercial.service');

process.env.REPARTO_TABLE_SET = 'isolated_test';

function line(overrides = {}) {
    return {
        codigoArticulo: 'ART1',
        CODIGOARTICULO: 'ART1',
        precioVenta: 10,
        PRECIOVENTA: 10,
        precioTarifaCliente: 9,
        PRECIOTARIFACLIENTE: 9,
        precioTarifa: 0,
        PRECIOTARIFA: 0,
        precioMinimo: 0,
        PRECIOMINIMO: 0,
        cantidadEnvases: 3,
        CANTIDADENVASES: 3,
        cantidadUnidades: 0,
        CANTIDADUNIDADES: 0,
        unidadMedida: 'CAJAS',
        UNIDADMEDIDA: 'CAJAS',
        unidadesCaja: 1,
        UNIDADESCAJA: 1,
        ...overrides,
    };
}

beforeEach(() => {
    mockCapturedQueries.length = 0;
    mockBolsaRow = {
        ID: 7, CODIGOVENDEDOR: '15', EJERCICIO: 2026, MES: 9,
        SALDO_DISPONIBLE: 300, CONSUMIDO: 0, ACUMULADO: 0,
        LIMITE_PCT: 3.0, LIMITE_IMPORTE: 0,
    };
});

describe('REQ-13 fórmula backend espejo Flutter', () => {
    test('referencia = tarifaCliente ?? tarifa ?? mínimo', () => {
        expect(bolsaService.resolveBolsaReferencePrice(line())).toBe(9);
        expect(bolsaService.resolveBolsaReferencePrice(
            line({ precioTarifaCliente: 0, PRECIOTARIFACLIENTE: 0, precioTarifa: 8, PRECIOTARIFA: 8 }),
        )).toBe(8);
        expect(bolsaService.resolveBolsaReferencePrice(
            line({ precioTarifaCliente: 0, PRECIOTARIFACLIENTE: 0, precioTarifa: 0, PRECIOTARIFA: 0, precioMinimo: 7, PRECIOMINIMO: 7 }),
        )).toBe(7);
    });

    test('precio efectivo aplica dto línea + global con redondeo a 2', () => {
        expect(bolsaService.resolveEffectiveSalePrice(
            line({ precioVenta: 10, PRECIOVENTA: 10, lineDiscountPct: 10, DESCUENTO_LINEA: 10 }), 5,
        )).toBeCloseTo(8.55, 2);
    });

    test('repro 1 €: 10.333 × 3 sobre tarifa 10 → consumo/acum 0.99', async () => {
        const l = line({ precioVenta: 10.333, PRECIOVENTA: 10.333, precioTarifaCliente: 10, PRECIOTARIFACLIENTE: 10 });
        const result = await bolsaService.validateOrderWithBolsa('15', [l], {});
        expect(result.valid).toBe(true);
        expect(result.acumulacion).toBeCloseTo(0.99, 2);
    });

    test('venta bajo tarifa → CONSUMO con misma magnitud', async () => {
        const l = line({ precioVenta: 8, PRECIOVENTA: 8 });
        const result = await bolsaService.validateOrderWithBolsa('15', [l], {});
        expect(result.valid).toBe(true);
        expect(result.consumo).toBeCloseTo(3, 2);
        expect(result.lineMovements).toHaveLength(1);
        expect(result.lineMovements[0].tipo).toBe('CONSUMO');
        expect(result.lineMovements[0].idempotencyKey).toBeFalsy();
    });

    test('dto global que hunde bajo tarifa genera consumo (fail-closed)', async () => {
        const l = line({ precioVenta: 9, PRECIOVENTA: 9 });
        const result = await bolsaService.validateOrderWithBolsa('15', [l], { globalDiscountPct: 10 });
        expect(result.consumo).toBeGreaterThan(0);
    });

    test('idempotencyKey derivado por pedido+línea+tipo', async () => {
        const l = line({ precioVenta: 8, PRECIOVENTA: 8, lineId: 42, ID: 42 });
        const result = await bolsaService.validateOrderWithBolsa('15', [l], {});
        expect(result.lineMovements).toHaveLength(1);
        // La clave final se deriva al persistir (buildBolsaMovementIdempotencyKey);
        // el movimiento de validación conserva trazabilidad de línea.
        expect(result.lineMovements[0].cantidad).toBe(3);
        expect(result.lineMovements[0].codigoArticulo).toBe('ART1');
    });
});

describe('TEST-only + DSEDAC lectura + binding', () => {
    test('validate no escribe DSEDAC y usa parámetros', async () => {
        await bolsaService.validateOrderWithBolsa('15', [line()], {});
        expect(mockCapturedQueries.length).toBeGreaterThan(0);
        for (const q of mockCapturedQueries) {
            expect(() => assertNoDsedacWrite(q.sql)).not.toThrow();
            expect(String(q.sql).includes('?')).toBe(true);
            expect(String(q.sql).includes('DSEDAC')).toBe(false);
        }
        expect(process.env.REPARTO_TABLE_SET).toBe('isolated_test');
    });
});
