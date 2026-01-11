/**
 * TESTS: SERVICIO DE COBROS
 * Tests Jest para endpoints críticos de cobros
 */

// Mock del módulo ODBC antes de importar el servicio
jest.mock('../config/database', () => ({
    odbcPool: {
        query: jest.fn(),
        initialize: jest.fn(),
        isHealthy: jest.fn().mockReturnValue(true)
    },
    initDatabase: jest.fn(),
    closeDatabase: jest.fn()
}));

import { cobrosService } from '../services/cobros.service';
import { odbcPool } from '../config/database';

describe('CobrosService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('obtenerCobrosPendientes', () => {
        it('debe retornar lista vacía cuando no hay cobros', async () => {
            (odbcPool.query as jest.Mock).mockResolvedValue([]);

            const resultado = await cobrosService.obtenerCobrosPendientes('9900');

            expect(resultado).toEqual([]);
            expect(odbcPool.query).toHaveBeenCalledTimes(1);
        });

        it('debe retornar cobros pendientes formateados correctamente', async () => {
            const mockData = [
                {
                    SUBEMPRESAALBARAN: '01',
                    EJERCICIOALBARAN: 2026,
                    SERIEALBARAN: 'A',
                    TERMINALALBARAN: 1,
                    NUMEROALBARAN: 12345,
                    NUMEROFACTURA: 100,
                    SERIEFACTURA: 'F',
                    ANODOCUMENTO: 2026,
                    MESDOCUMENTO: 1,
                    DIADOCUMENTO: 10,
                    IMPORTETOTAL: 150.50,
                    IMPORTE_PENDIENTE: 150.50,
                    CODIGOTIPOALBARAN: 'VNT'
                }
            ];

            (odbcPool.query as jest.Mock).mockResolvedValue(mockData);

            const resultado = await cobrosService.obtenerCobrosPendientes('9900');

            expect(resultado).toHaveLength(1);
            expect(resultado[0]).toMatchObject({
                referencia: 'F-100',
                importe: 150.50,
                importePendiente: 150.50
            });
        });

        it('debe sanitizar código de cliente correctamente', async () => {
            (odbcPool.query as jest.Mock).mockResolvedValue([]);

            await cobrosService.obtenerCobrosPendientes('  9900  ');

            expect(odbcPool.query).toHaveBeenCalledWith(
                expect.any(String),
                ['9900']
            );
        });
    });

    describe('registrarCobro', () => {
        it('debe registrar cobro correctamente', async () => {
            (odbcPool.query as jest.Mock).mockResolvedValue([]);

            const resultado = await cobrosService.registrarCobro({
                codigoCliente: '9900',
                referencia: 'F-100',
                importe: 150.50,
                formaPago: 'EFECTIVO',
                observaciones: 'Test cobro'
            });

            expect(resultado.success).toBe(true);
            expect(odbcPool.query).toHaveBeenCalled();
        });

        it('debe manejar error cuando tabla COBROS no existe', async () => {
            (odbcPool.query as jest.Mock).mockRejectedValue(new Error('Table not found'));

            const resultado = await cobrosService.registrarCobro({
                codigoCliente: '9900',
                referencia: 'F-100',
                importe: 150.50,
                formaPago: 'EFECTIVO'
            });

            // El servicio captura el error y retorna success
            expect(resultado.success).toBe(true);
        });
    });

    describe('obtenerResumenCobros', () => {
        it('debe calcular resumen correctamente', async () => {
            const mockData = [
                { NUMEROFACTURA: 0, IMPORTE_PENDIENTE: 100, MESDOCUMENTO: 1, ANODOCUMENTO: 2026 },
                { NUMEROFACTURA: 100, SERIEFACTURA: 'F', IMPORTE_PENDIENTE: 200, MESDOCUMENTO: 12, ANODOCUMENTO: 2025 }
            ];

            (odbcPool.query as jest.Mock).mockResolvedValue(mockData);

            const resumen = await cobrosService.obtenerResumenCobros('9900');

            expect(resumen.totalPendiente).toBeGreaterThan(0);
            expect(resumen).toHaveProperty('albaranes');
            expect(resumen).toHaveProperty('facturas');
        });
    });

    describe('crearPresupuesto', () => {
        it('debe crear presupuesto correctamente', async () => {
            (odbcPool.query as jest.Mock).mockResolvedValue([]);

            const resultado = await cobrosService.crearPresupuesto({
                codigoCliente: '9900',
                tipo: 'presupuesto',
                lineas: [
                    {
                        secuencia: 1,
                        codigoArticulo: 'ART001',
                        descripcion: 'Producto Test',
                        cantidad: 10,
                        unidad: 'unidades',
                        precioUnitario: 5.00,
                        descuento: 0,
                        importeTotal: 50.00
                    }
                ],
                formaPago: 'CONTADO',
                observaciones: 'Presupuesto de prueba'
            });

            expect(resultado.success).toBe(true);
            expect(resultado.presupuesto).toBeDefined();
            expect(resultado.presupuesto?.importeTotal).toBe(50);
        });
    });
});

describe('Edge Cases', () => {
    it('debe manejar cliente con caracteres especiales', async () => {
        (odbcPool.query as jest.Mock).mockResolvedValue([]);

        const resultado = await cobrosService.obtenerCobrosPendientes("9900'--");

        expect(resultado).toEqual([]);
        // Verificar que se sanitizó correctamente
        expect(odbcPool.query).toHaveBeenCalledWith(
            expect.any(String),
            ['9900']
        );
    });

    it('debe manejar importe null', async () => {
        const mockData = [{
            NUMEROFACTURA: 0,
            IMPORTE_PENDIENTE: null,
            IMPORTETOTAL: 100,
            MESDOCUMENTO: 1,
            ANODOCUMENTO: 2026,
            DIADOCUMENTO: 1,
            NUMEROALBARAN: 1
        }];

        (odbcPool.query as jest.Mock).mockResolvedValue(mockData);

        const resultado = await cobrosService.obtenerCobrosPendientes('9900');

        expect(resultado[0].importePendiente).toBe(0);
    });
});
