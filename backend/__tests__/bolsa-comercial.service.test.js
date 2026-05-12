/**
 * Unit Tests - Bolsa Comercial Service
 * =====================================
 */
'use strict';

jest.mock('../config/db', () => ({
    queryWithParams: jest.fn()
}));

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
}));

const SCHEMA = 'JAVIER';

describe('BolsaComercial Service', () => {
    let bolsaService;
    let mockQuery;

    beforeEach(() => {
        jest.resetModules();
        mockQuery = require('../config/db').queryWithParams;
        bolsaService = require('../services/bolsa-comercial.service');
    });

    describe('getOrCreateBolsa', () => {
        test('should return existing bolsa when found', async () => {
            mockQuery.mockResolvedValueOnce([{
                ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 100,
                CONSUMIDO: 0, ACUMULADO: 50
            }]);

            const result = await bolsaService.getOrCreateBolsa('10', 2026, 5);

            expect(result.id).toBe(1);
            expect(result.vendedor).toBe('10');
            expect(result.saldoDisponible).toBe(100);
            expect(mockQuery).toHaveBeenCalledTimes(1);
        });

        test('should create new bolsa when not found', async () => {
            mockQuery
                .mockResolvedValueOnce([]) // SELECT returns empty
                .mockResolvedValueOnce([]) // INSERT
                .mockResolvedValueOnce([{  // SELECT after insert
                    ID: 2, CODIGOVENDEDOR: '15  ', EJERCICIO: 2026, MES: 6,
                    LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 0,
                    CONSUMIDO: 0, ACUMULADO: 0
                }]);

            const result = await bolsaService.getOrCreateBolsa('15', 2026, 6);

            expect(result.vendedor).toBe('15');
            expect(result.limitePct).toBe(3);
        });
    });

    describe('acumularBolsa', () => {
        test('should accumulate margin and create movement', async () => {
            mockQuery
                .mockResolvedValueOnce([{
                    ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                    LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 100,
                    CONSUMIDO: 0, ACUMULADO: 0
                }])
                .mockResolvedValueOnce([]) // UPDATE
                .mockResolvedValueOnce([]); // INSERT movement

            const result = await bolsaService.acumularBolsa('10', 42, 50, 'Test margin');

            expect(result).toBeCloseTo(150);
        });
    });

    describe('consumirBolsa', () => {
        test('should deny consumption when insufficient balance', async () => {
            mockQuery.mockResolvedValueOnce([{
                ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                LIMITE_PCT: 3, SALDO_DISPONIBLE: 10,
                CONSUMIDO: 0, ACUMULADO: 0
            }]);

            const result = await bolsaService.consumirBolsa('10', 42, 50, 'ART01');

            expect(result.allowed).toBe(false);
            expect(result.deficit).toBeCloseTo(40);
        });

        test('should allow consumption when sufficient balance', async () => {
            mockQuery
                .mockResolvedValueOnce([{
                    ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                    LIMITE_PCT: 3, SALDO_DISPONIBLE: 100,
                    CONSUMIDO: 0, ACUMULADO: 0
                }])
                .mockResolvedValueOnce([]) // UPDATE
                .mockResolvedValueOnce([]); // INSERT movement

            const result = await bolsaService.consumirBolsa('10', 42, 30, 'ART01');

            expect(result.allowed).toBe(true);
            expect(result.saldo).toBeCloseTo(70);
        });
    });

    describe('validateOrderWithBolsa', () => {
        test('should validate when all lines are within budget', async () => {
            mockQuery.mockResolvedValueOnce([{
                ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 100,
                CONSUMIDO: 0, ACUMULADO: 0
            }]);

            const result = await bolsaService.validateOrderWithBolsa('10', [
                { precioMinimo: 10, precioVenta: 12, cantidadEnvases: 1 }
            ]);

            expect(result.valid).toBe(true);
        });

        test('should reject when deficit exceeds balance', async () => {
            mockQuery.mockResolvedValueOnce([{
                ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                LIMITE_PCT: 3, SALDO_DISPONIBLE: 10,
                CONSUMIDO: 0, ACUMULADO: 0
            }]);

            const result = await bolsaService.validateOrderWithBolsa('10', [
                { precioMinimo: 100, precioVenta: 50, cantidadEnvases: 1 }
            ]);

            expect(result.valid).toBe(false);
            expect(result.reason).toBe('BOLSA_INSUFICIENTE');
        });
    });

    describe('getMovimientos', () => {
        test('should return mapped movements', async () => {
            mockQuery
                .mockResolvedValueOnce([{
                    ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                    LIMITE_PCT: 3, SALDO_DISPONIBLE: 100,
                    CONSUMIDO: 0, ACUMULADO: 0
                }])
                .mockResolvedValueOnce([
                    { ID: 1, TIPO: 'ACUMULACION  ', IMPORTE: 50, SALDO_ANTERIOR: 100, SALDO_POSTERIOR: 150,
                      CODIGO_ARTICULO: '', DESCRIPCION: 'test', PEDIDO_ID: 42, CREATED_AT: new Date() }
                ]);

            const movs = await bolsaService.getMovimientos('10', 2026, 5);

            expect(movs).toHaveLength(1);
            expect(movs[0].tipo).toBe('ACUMULACION');
            expect(movs[0].importe).toBe(50);
        });
    });

    describe('updateBolsaConfig', () => {
        test('should update only provided fields', async () => {
            mockQuery
                .mockResolvedValueOnce([{
                    ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                    LIMITE_PCT: 3, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 100,
                    CONSUMIDO: 0, ACUMULADO: 0
                }])
                .mockResolvedValueOnce([]) // UPDATE
                .mockResolvedValueOnce([{
                    ID: 1, CODIGOVENDEDOR: '10  ', EJERCICIO: 2026, MES: 5,
                    LIMITE_PCT: 5, LIMITE_IMPORTE: 0, SALDO_DISPONIBLE: 100,
                    CONSUMIDO: 0, ACUMULADO: 0
                }]);

            const result = await bolsaService.updateBolsaConfig('10', 2026, 5, { limitePct: 5 });

            expect(result.limitePct).toBe(5);
        });
    });
});
