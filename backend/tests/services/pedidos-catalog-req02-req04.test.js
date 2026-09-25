'use strict';

/**
 * Tanda1 pedidos comerciales — REQ-02.3 / REQ-04 (VERIFY gaps).
 * Sin DB2 real: config/db, redis-cache y query-optimizer mockeados.
 * - normalizeSearchTerm: jamon casa JAMÓN; 1273 parcial intacto.
 * - sanitizeForSQL: preserva tildes (incl. ü) y no deja pasar inyección;
 *   el % del LIKE lo añade el servicio, no el usuario.
 * - getProducts onlyStock: WHERE EXISTS real sobre ARO
 *   (ENVASESDISPONIBLES/UNIDADESDISPONIBLES) con binding, paginación
 *   RN preservada. Sin flag: sin filtro stock.
 */

jest.mock('../../middleware/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const capturedQueries = [];
jest.mock('../../config/db', () => ({
    query: jest.fn(async () => []),
    queryWithParams: jest.fn(async (sql, params) => {
        capturedQueries.push({ sql, params });
        return [];
    }),
    getPool: jest.fn(() => null),
    initDb: jest.fn(async () => null),
}));

jest.mock('../../services/redis-cache', () => ({
    redisCache: {
        get: jest.fn(async () => null),
        set: jest.fn(async () => true),
    },
    TTL: { SHORT: 60, MEDIUM: 300, LONG: 1800, STATIC: 3600 },
}));

jest.mock('../../services/query-optimizer', () => ({
    cachedQuery: jest.fn(async (fn, sql) => fn(sql)),
    invalidateOnMutation: jest.fn(),
    patternFor: jest.fn((p) => p),
}));

const { sanitizeForSQL } = require('../../utils/common');
const pedidosService = require('../../services/pedidos/index');
const { normalizeSearchTerm, getProducts } = pedidosService;

beforeEach(() => {
    capturedQueries.length = 0;
    jest.clearAllMocks();
});

describe('REQ-02.3 normalizeSearchTerm (sin DB2)', () => {
    test('jamon normaliza igual que JAMÓN (LIKE casa ambos)', () => {
        const termUser = `%${normalizeSearchTerm('jamon').toUpperCase()}%`;
        const termDb = `%${normalizeSearchTerm('JAMÓN').toUpperCase()}%`;
        expect(termUser).toBe('%JAMON%');
        expect(termDb).toBe('%JAMON%');
    });

    test('código parcial 1273 viaja intacto al LIKE', () => {
        expect(normalizeSearchTerm('1273')).toBe('1273');
        expect(`%${normalizeSearchTerm('1273').toUpperCase()}%`).toBe('%1273%');
    });
});

describe('REQ-02 riesgo sanitizeForSQL (sin DB2)', () => {
    test('preserva tildes y ü para el LIKE parcial', () => {
        expect(sanitizeForSQL('jamón')).toBe('jamón');
        expect(sanitizeForSQL('JAMÓN')).toBe('JAMÓN');
        expect(sanitizeForSQL('pingüino')).toBe('pingüino');
        expect(sanitizeForSQL('1273')).toBe('1273');
    });

    test('no deja pasar metacaracteres SQL (el valor viaja por binding)', () => {
        const evil = sanitizeForSQL("x'; DROP TABLE ART; --");
        expect(evil).not.toMatch(/['";]/);
        expect(evil).not.toBe("x'; DROP TABLE ART; --");
    });

    test('el % del LIKE lo añade el servicio, no el usuario', () => {
        // El usuario no puede inyectar comodines: se tiran en sanitize...
        expect(sanitizeForSQL('%jamon%')).toBe('jamon');
        // ...y el servicio los añade controlados alrededor del término.
        const like = `%${normalizeSearchTerm(sanitizeForSQL('%jamon%')).toUpperCase()}%`;
        expect(like).toBe('%JAMON%');
    });
});

describe('REQ-04 onlyStock server-side (mock DB2)', () => {
    test('onlyStock=true mete WHERE EXISTS con binding y mantiene paginación', async () => {
        const products = await getProducts({
            clientCode: 'C1',
            onlyStock: true,
            limit: 50,
            offset: 0,
        });
        expect(products).toEqual([]);
        expect(capturedQueries.length).toBeGreaterThan(0);
        const { sql, params } = capturedQueries[0];
        // WHERE stock>0 real sobre columnas ARO verificadas en código.
        expect(sql).toMatch(/EXISTS/i);
        expect(sql).toContain('ENVASESDISPONIBLES');
        expect(sql).toContain('UNIDADESDISPONIBLES');
        // Paginación por RN intacta (páginas llenas => hasMore válido).
        expect(sql).toMatch(/RN > \?/);
        expect(sql).toMatch(/RN <= \?/);
        // Binding parametrizado: almacén como parámetro en el EXISTS nuevo
        // (el STOCK CTE preexistente conserva su literal post-paginación).
        expect(params).toContain(1);
        expect(sql).toContain('AND EXISTS (SELECT 1 FROM');
        expect(sql).toContain('S.CODIGOALMACEN = ?');
    });

    test('sin onlyStock no hay filtro de stock', async () => {
        await getProducts({ clientCode: 'C1', limit: 50, offset: 0 });
        expect(capturedQueries.length).toBeGreaterThan(0);
        const { sql } = capturedQueries[0];
        expect(sql).not.toMatch(/ENVASESDISPONIBLES > 0/);
    });

    test('search jamon + onlyStock combinan binding title y stock', async () => {
        await getProducts({ clientCode: 'C1', search: 'jamon', onlyStock: true, limit: 50, offset: 0 });
        const { sql, params } = capturedQueries[0];
        expect(sql).toMatch(/EXISTS/i);
        expect(params).toContain('%JAMON%');
        expect(params).toContain(1);
    });
});
