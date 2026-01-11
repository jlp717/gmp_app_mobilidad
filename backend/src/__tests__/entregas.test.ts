/**
 * TESTS: SERVICIO DE ENTREGAS
 * Tests Jest para funcionalidades del repartidor
 */

// Mock del módulo ODBC y fs
jest.mock('../config/database', () => ({
    odbcPool: {
        query: jest.fn(),
        initialize: jest.fn(),
        isHealthy: jest.fn().mockReturnValue(true)
    },
    initDatabase: jest.fn(),
    closeDatabase: jest.fn()
}));

jest.mock('fs', () => ({
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    renameSync: jest.fn(),
    readFileSync: jest.fn().mockReturnValue('[]')
}));

import { entregasService } from '../services/entregas.service';
import { odbcPool } from '../config/database';
import fs from 'fs';

describe('EntregasService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('obtenerAlbaranesPendientes', () => {
        it('debe retornar lista de albaranes pendientes', async () => {
            const mockAlbaranes = [
                {
                    SUBEMPRESAALBARAN: '01',
                    EJERCICIOALBARAN: 2026,
                    SERIEALBARAN: 'A',
                    NUMEROALBARAN: 1001,
                    CODIGO_CLIENTE: '9900',
                    NOMBRE_CLIENTE: 'Cliente Test',
                    DIRECCION: 'Calle Test 123',
                    ANODOCUMENTO: 2026,
                    MESDOCUMENTO: 1,
                    DIADOCUMENTO: 11,
                    IMPORTETOTAL: 250.00,
                    CODIGOFORMAPAGO: 'CTR'
                }
            ];

            (odbcPool.query as jest.Mock).mockResolvedValue(mockAlbaranes);

            const resultado = await entregasService.obtenerAlbaranesPendientes('REP01');

            expect(resultado).toHaveLength(1);
            expect(resultado[0]).toMatchObject({
                numeroAlbaran: 1001,
                codigoCliente: '9900',
                esCTR: true
            });
        });

        it('debe retornar lista vacía cuando no hay albaranes', async () => {
            (odbcPool.query as jest.Mock).mockResolvedValue([]);

            const resultado = await entregasService.obtenerAlbaranesPendientes('REP01');

            expect(resultado).toEqual([]);
        });
    });

    describe('actualizarEstadoEntrega', () => {
        it('debe registrar entrega correctamente', async () => {
            (odbcPool.query as jest.Mock).mockResolvedValue([]);

            const resultado = await entregasService.actualizarEstadoEntrega({
                itemId: 'ALB-1001-1',
                status: 'ENTREGADO',
                repartidorId: 'REP01',
                cantidadEntregada: 10,
                observaciones: 'Entrega completa'
            });

            expect(resultado.success).toBe(true);
            expect(resultado.registroId).toBeDefined();
        });

        it('debe guardar en log local si BD no disponible', async () => {
            (odbcPool.query as jest.Mock).mockRejectedValue(new Error('Table not found'));

            const resultado = await entregasService.actualizarEstadoEntrega({
                itemId: 'ALB-1001-1',
                status: 'ENTREGADO',
                repartidorId: 'REP01'
            });

            expect(resultado.success).toBe(true);
            expect(fs.writeFileSync).toHaveBeenCalled();
        });

        it('debe manejar entregas parciales', async () => {
            (odbcPool.query as jest.Mock).mockResolvedValue([]);

            const resultado = await entregasService.actualizarEstadoEntrega({
                itemId: 'ALB-1001-1',
                status: 'PARCIAL',
                repartidorId: 'REP01',
                cantidadEntregada: 5
            });

            expect(resultado.success).toBe(true);
        });
    });

    describe('guardarFirma', () => {
        it('debe guardar firma base64 correctamente', async () => {
            (odbcPool.query as jest.Mock).mockResolvedValue([]);

            const base64Firma = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

            const path = await entregasService.guardarFirma('REG123', base64Firma);

            expect(path).toContain('signatures');
            expect(path).toContain('firma_REG123');
            expect(fs.writeFileSync).toHaveBeenCalled();
        });

        it('debe eliminar header data:image del base64', async () => {
            const base64SinHeader = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

            await entregasService.guardarFirma('REG123', base64SinHeader);

            expect(fs.writeFileSync).toHaveBeenCalled();
        });
    });

    describe('obtenerAlbaran', () => {
        it('debe retornar albarán con items', async () => {
            const mockAlbaran = [{
                SUBEMPRESAALBARAN: '01',
                EJERCICIOALBARAN: 2026,
                SERIEALBARAN: 'A',
                NUMEROALBARAN: 1001,
                CODIGO_CLIENTE: '9900',
                NOMBRE_CLIENTE: 'Cliente Test',
                DIRECCION: 'Calle Test',
                ANODOCUMENTO: 2026,
                MESDOCUMENTO: 1,
                DIADOCUMENTO: 11,
                IMPORTETOTAL: 100,
                CODIGOFORMAPAGO: 'EFECTIVO'
            }];

            const mockLineas = [
                { SECUENCIA: 1, CODIGOARTICULO: 'ART001', DESCRIPCIONARTICULO: 'Producto 1', CANTIDADENVASES: 5, IMPORTEVENTA: 50 },
                { SECUENCIA: 2, CODIGOARTICULO: 'ART002', DESCRIPCIONARTICULO: 'Producto 2', CANTIDADENVASES: 5, IMPORTEVENTA: 50 }
            ];

            (odbcPool.query as jest.Mock)
                .mockResolvedValueOnce(mockAlbaran)
                .mockResolvedValueOnce(mockLineas);

            const albaran = await entregasService.obtenerAlbaran(1001, 2026);

            expect(albaran).not.toBeNull();
            expect(albaran?.items).toHaveLength(2);
            expect(albaran?.esCTR).toBe(false);
        });

        it('debe retornar null si albarán no existe', async () => {
            (odbcPool.query as jest.Mock).mockResolvedValue([]);

            const albaran = await entregasService.obtenerAlbaran(99999, 2026);

            expect(albaran).toBeNull();
        });
    });
});

describe('Detección de CTR', () => {
    it('debe detectar CTR por código CTR', async () => {
        const mockAlbaran = [{
            NUMEROALBARAN: 1001,
            CODIGOFORMAPAGO: 'CTR',
            ANODOCUMENTO: 2026,
            MESDOCUMENTO: 1,
            DIADOCUMENTO: 11,
            IMPORTETOTAL: 100
        }];

        (odbcPool.query as jest.Mock).mockResolvedValue(mockAlbaran);

        const resultado = await entregasService.obtenerAlbaranesPendientes('REP01');

        expect(resultado[0].esCTR).toBe(true);
    });

    it('debe detectar CTR por código REEMBOLSO', async () => {
        const mockAlbaran = [{
            NUMEROALBARAN: 1001,
            CODIGOFORMAPAGO: 'CONTRAREEMBOLSO',
            ANODOCUMENTO: 2026,
            MESDOCUMENTO: 1,
            DIADOCUMENTO: 11,
            IMPORTETOTAL: 100
        }];

        (odbcPool.query as jest.Mock).mockResolvedValue(mockAlbaran);

        const resultado = await entregasService.obtenerAlbaranesPendientes('REP01');

        expect(resultado[0].esCTR).toBe(true);
    });

    it('debe marcar como no CTR para otros códigos', async () => {
        const mockAlbaran = [{
            NUMEROALBARAN: 1001,
            CODIGOFORMAPAGO: 'TRANSFERENCIA',
            ANODOCUMENTO: 2026,
            MESDOCUMENTO: 1,
            DIADOCUMENTO: 11,
            IMPORTETOTAL: 100
        }];

        (odbcPool.query as jest.Mock).mockResolvedValue(mockAlbaran);

        const resultado = await entregasService.obtenerAlbaranesPendientes('REP01');

        expect(resultado[0].esCTR).toBe(false);
    });
});
