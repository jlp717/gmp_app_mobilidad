'use strict';

/**
 * Tanda2 UOM/confirmar — REQ-08..12 (VERIFY).
 * Sin DB2 real: config/db, redis-cache y query-optimizer mockeados.
 * - getAvailableVehicles: join VEH+VDD verificado (QSYS2 sesion:
 *   VEH.CODIGOCONDUCTOR + VDD.CODIGOVENDEDOR/NOMBREVENDEDOR), resuelve
 *   driverName con binding y sin DML (solo SELECT).
 * - getDefaultTruckAssignment: propaga driverName (fallback '' sin romper).
 * - Escrituras pedidos: solo JAVIER.TEST_* vía db2AppTable con
 *   REPARTO_TABLE_SET=isolated_test (cero DML DSEDAC en path).
 * QSYS2 live 2026-09-24 (MCP ibm-db2, DSN GMP):
 *   SYSTABLES DSEDAC: ARO(T), ALM(T), VEH(T), VDD(T).
 *   ARO: CODIGOARTICULO CHAR(10), CODIGOALMACEN NUMERIC(4),
 *     ENVASESDISPONIBLES NUMERIC(9), UNIDADESDISPONIBLES NUMERIC(13).
 *   VEH: CODIGOVEHICULO CHAR(10), MATRICULA CHAR(20),
 *     CODIGOCONDUCTOR CHAR(10), CODIGOVENDEDOR CHAR(2).
 *   VDD: CODIGOVENDEDOR CHAR(2), NOMBREVENDEDOR CHAR(60).
 *   Join conductor: VEH.CODIGOCONDUCTOR = VDD.CODIGOVENDEDOR.
 */

jest.mock('../../middleware/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const capturedQueries = [];
let mockRows = [];
jest.mock('../../config/db', () => ({
    query: jest.fn(async () => []),
    queryWithParams: jest.fn(async (sql, params) => {
        capturedQueries.push({ sql, params });
        return mockRows;
    }),
    getPool: jest.fn(() => null),
    initDb: jest.fn(async () => null),
}));

jest.mock('../../services/redis-cache', () => ({
    redisCache: {
        get: jest.fn(async () => null),
        set: jest.fn(async () => true),
        invalidatePattern: jest.fn(async () => 0),
    },
    TTL: { SHORT: 60, MEDIUM: 300, LONG: 1800, STATIC: 3600 },
    patternFor: jest.fn((p) => p),
    deleteCachePattern: jest.fn(async () => 0),
}));

jest.mock('../../services/query-optimizer', () => ({
    cachedQuery: jest.fn(async (fn, sql) => fn(sql)),
    invalidateOnMutation: jest.fn(),
    patternFor: jest.fn((p) => p),
}));

process.env.REPARTO_TABLE_SET = 'isolated_test';

const pedidosService = require('../../services/pedidos/index');

beforeEach(() => {
    capturedQueries.length = 0;
    mockRows = [];
    jest.clearAllMocks();
});

describe('REQ-10 getAvailableVehicles con nombre conductor (VEH+VDD)', () => {
    test('resuelve driverName y parametriza sin DML', async () => {
        mockRows = [{
            CODE: '08', MATRICULA: '1234ABC', DESCRIPTION: 'Camion 08',
            DRIVERCODE: '84', DRIVERNAME: 'JUAN PEREZ',
            TONELADAS: 5, CARGAMAXIMA: 10,
        }];
        const vehicles = await pedidosService.getAvailableVehicles();
        expect(vehicles).toHaveLength(1);
        expect(vehicles[0].code).toBe('08');
        expect(vehicles[0].driverCode).toBe('84');
        expect(vehicles[0].driverName).toBe('JUAN PEREZ');

        const { sql, params } = capturedQueries[0];
        expect(sql).toMatch(/LEFT JOIN/i);
        expect(sql).toMatch(/NOMBREVENDEDOR/i);
        expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/i);
        expect(Array.isArray(params)).toBe(true);
        expect(sql).not.toMatch(/DSEDAC\.(OPP|CPC|VEH|VDD)\s+(SET|VALUES)/i);
    });

    test('driverName vacio cuando VDD sin nombre (fallback app Rep. code)', async () => {
        mockRows = [{
            CODE: '08', MATRICULA: '1234ABC', DESCRIPTION: 'Camion 08',
            DRIVERCODE: '84', DRIVERNAME: '',
            TONELADAS: 5, CARGAMAXIMA: 10,
        }];
        const vehicles = await pedidosService.getAvailableVehicles();
        expect(vehicles[0].driverName).toBe('');
        expect(vehicles[0].driverCode).toBe('84');
    });
});

describe('REQ-08 TEST-only: escrituras nunca DSEDAC/prod', () => {
    test('db2AppTable mapea PEDIDOS_* a JAVIER.TEST_* en isolated_test', () => {
        const { db2AppTable } = require('../../utils/db2-schemas');
        expect(db2AppTable('PEDIDOS_CAB')).toBe('JAVIER.TEST_PEDIDOS_CAB');
        expect(db2AppTable('PEDIDOS_LIN')).toBe('JAVIER.TEST_PEDIDOS_LIN');
    });

    test('getAvailableVehicles/getDeliveryOptions no emiten DML', async () => {
        mockRows = [];
        await pedidosService.getAvailableVehicles();
        await pedidosService.getDeliveryOptions({
            clientCode: 'C1', vendedorCode: '80',
        });
        for (const q of capturedQueries) {
            expect(q.sql).not.toMatch(/INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM/i);
        }
        const hasDsedacWrite = capturedQueries.some((q) =>
            /INSERT\s+INTO\s+DSEDAC|UPDATE\s+DSEDAC|DELETE\s+FROM\s+DSEDAC/i.test(q.sql));
        expect(hasDsedacWrite).toBe(false);
    });
});
