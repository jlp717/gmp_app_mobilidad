/**
 * CONTRACT tests: routes/filters.js — 8 rutas, 5 consultas SQL.
 * Verifica: forma de respuesta (contrato con la app Flutter), y que TODA
 * query con input de usuario va parametrizada (binding ?) — nunca interpolada.
 */
'use strict';

jest.mock('../config/db', () => {
    const query = jest.fn();
    const queryWithParams = jest.fn();
    return { query, queryWithParams };
});

jest.mock('../middleware/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const { query, queryWithParams } = require('../config/db');

const buildApp = () => {
    const app = express();
    app.use(express.json());
    app.use('/filters', require('../routes/filters'));
    return app;
};

// Fixture estándar para la carga de caché FI1-FI5 (orden de llamadas del refresh).
const FI_FIXTURES = [
    [{ CODIGOFILTRO: 'MAR   ', DESCRIPCIONFILTRO: 'MARISCOS', ORDEN: 1 }],
    [{ CODIGOFILTRO: 'LANGO ', DESCRIPCIONFILTRO: 'LANGOSTINO', ORDEN: 1 }],
    [{ CODIGOFILTRO: 'F3X   ', DESCRIPCIONFILTRO: 'F3', ORDEN: 1 }],
    [{ CODIGOFILTRO: 'SGLUT', DESCRIPCIONFILTRO: 'SIN GLUTEN', ORDEN: 1 }],
    [{ CODIGOFILTRO: 'CONG  ', DESCRIPCIONFILTRO: 'CONGELADO', ORDEN: 1 }],
];

describe('filters routes contract', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Las 5 cargas FI iniciales usan query() sin input de usuario (SQL estático).
        query.mockReset();
        queryWithParams.mockReset();
    });

    describe('GET /filters/fi1', () => {
        it('returns the cached FI1 list in the app contract shape', async () => {
            query.mockImplementationOnce(() => Promise.resolve(FI_FIXTURES[0]))
                .mockImplementationOnce(() => Promise.resolve(FI_FIXTURES[1]))
                .mockImplementationOnce(() => Promise.resolve(FI_FIXTURES[2]))
                .mockImplementationOnce(() => Promise.resolve(FI_FIXTURES[3]))
                .mockImplementationOnce(() => Promise.resolve(FI_FIXTURES[4]));

            const res = await request(buildApp()).get('/filters/fi1');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.total).toBe(1);
            expect(res.body.filters[0]).toMatchObject({ code: 'MAR', name: 'MARISCOS', orden: 1 });
        });

        it('serves warm cache without hitting the DB again', async () => {
            const callsBefore = query.mock.calls.length;
            const res = await request(buildApp()).get('/filters/fi1');
            expect(res.status).toBe(200);
            expect(query.mock.calls.length).toBe(callsBefore);
            expect(res.body.filters[0]).toMatchObject({ code: 'MAR', name: 'MARISCOS' });
        });
    });

    describe('GET /filters/fi2', () => {
        it('binds fi1Code as a parameter instead of interpolating it', async () => {
            queryWithParams.mockResolvedValue([{ FILTRO02: 'LANGO' }]);

            const res = await request(buildApp())
                .get('/filters/fi2')
                .query({ fi1Code: "MAR' OR '1'='1" });

            expect(res.status).toBe(200);
            const [sql, params] = queryWithParams.mock.calls[0];
            expect(sql).not.toContain("MAR' OR");
            expect(params).toEqual(["MAR' OR '1'='1".padEnd(10)]);
        });

        it('returns the full FI2 catalog without parent code', async () => {
            query.mockResolvedValueOnce(FI_FIXTURES[0])
                .mockResolvedValueOnce(FI_FIXTURES[1])
                .mockResolvedValueOnce(FI_FIXTURES[2])
                .mockResolvedValueOnce(FI_FIXTURES[3])
                .mockResolvedValueOnce(FI_FIXTURES[4]);

            const res = await request(buildApp()).get('/filters/fi2');
            expect(res.status).toBe(200);
            expect(res.body.parentFilter).toBeNull();
        });
    });

    describe('GET /filters/fi3 and /filters/fi4', () => {
        it.each([
            ['/filters/fi3', { fi1Code: "A'; DROP TABLE X--", fi2Code: null }],
            ['/filters/fi4', { fi1Code: null, fi2Code: "B' OR '1'='1", fi3Code: null }],
        ])('%s binds parent codes', async (path, qp) => {
            queryWithParams.mockResolvedValue([]);
            const res = await request(buildApp()).get(path).query(qp);
            expect(res.status).toBe(200);
            for (const call of queryWithParams.mock.calls) {
                expect(call[0]).not.toContain("' OR");
                expect(call[0]).not.toContain('DROP TABLE');
            }
        });
    });

    describe('GET /filters/all', () => {
        it('returns the five FI groups with cacheAge', async () => {
            query.mockResolvedValueOnce(FI_FIXTURES[0])
                .mockResolvedValueOnce(FI_FIXTURES[1])
                .mockResolvedValueOnce(FI_FIXTURES[2])
                .mockResolvedValueOnce(FI_FIXTURES[3])
                .mockResolvedValueOnce(FI_FIXTURES[4]);

            const res = await request(buildApp()).get('/filters/all');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body).toHaveProperty('fi1');
            expect(res.body).toHaveProperty('fi2');
            expect(res.body).toHaveProperty('fi3');
            expect(res.body).toHaveProperty('fi4');
            expect(res.body).toHaveProperty('fi5');
            expect(res.body.cacheAge).not.toBeNull();
        });
    });

    describe('GET /filters/articles', () => {
        it('binds every fiX filter and search term — never interpolates', async () => {
            queryWithParams.mockImplementation((sql) =>
                Promise.resolve(sql.includes('COUNT') ? [{ total: 0 }] : []));

            const attack = "' OR '1'='1";
            const res = await request(buildApp())
                .get('/filters/articles')
                .query({ fi1: attack, search: "'; DROP TABLE ART;--", limit: '50' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const [countSql] = queryWithParams.mock.calls[0];
            const [listSql] = queryWithParams.mock.calls[1];
            for (const sql of [countSql, listSql]) {
                expect(sql).not.toContain("' OR");
                expect(sql).not.toContain('DROP TABLE');
                expect(sql).not.toContain('--');
            }
            const listParams = queryWithParams.mock.calls[1][1];
            expect(listParams).toContain(attack);
            expect(listParams).toContain("%'; DROP TABLE ART;--%");
        });

        it('clamps limit to a safe range and passes pagination as parameters', async () => {
            queryWithParams.mockImplementation(() => Promise.resolve([{ total: 0 }]));

            await request(buildApp()).get('/filters/articles')
                .query({ limit: '99999', offset: '-5' });

            const listCall = queryWithParams.mock.calls[1];
            expect(listCall[0]).toContain('OFFSET ? ROWS');
            expect(listCall[0]).toContain('FETCH NEXT ? ROWS ONLY');
            // offset negativo clamped a 0, limit capped a 500
            expect(listCall[1].slice(-2)).toEqual([0, 500]);
        });
    });

    describe('GET /filters/cascade', () => {
        it('binds fi codes in all sub-queries and keeps the response shape', async () => {
            queryWithParams.mockImplementation((sql) =>
                Promise.resolve(sql.includes('COUNT') ? [{ total: 3 }] : [{ code: 'L', name: 'L', count: 2 }]));

            const res = await request(buildApp())
                .get('/filters/cascade')
                .query({ fi1: "X' OR '1'='1" });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('fi2Options');
            expect(res.body).toHaveProperty('fi3Options');
            expect(res.body).toHaveProperty('fi4Options');
            expect(res.body.articleCount).toBe(3);

            for (const call of queryWithParams.mock.calls) {
                expect(call[0]).not.toContain("' OR");
            }
        });

        it('returns zeroed structure without filters', async () => {
            queryWithParams.mockResolvedValue([{ total: 0 }]);
            const res = await request(buildApp()).get('/filters/cascade');
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ success: true, fi2Options: [], fi3Options: [], fi4Options: [], articleCount: 0 });
        });
    });
});
