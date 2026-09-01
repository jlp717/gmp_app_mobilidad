/**
 * Cold-cache degrade: si el primer refresh de la cache FI falla, las rutas
 * responden 200 con listas vacias (no 500). Archivo separado porque la cache
 * de modulo de filters.js vive 5 min y hay que recargar el modulo limpio.
 */
'use strict';

jest.mock('../config/db', () => {
    const query = jest.fn().mockRejectedValue(new Error('db down'));
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

const buildApp = () => {
    const app = express();
    app.use('/filters', require('../routes/filters'));
    return app;
};

describe('filters cold-cache degrade', () => {
    test('GET /fi1 returns empty filters on first-load DB failure', async () => {
        const res = await request(buildApp()).get('/filters/fi1');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, filters: [], total: 0 });
    });

    test('GET /all returns empty groups and null cacheAge on first-load failure', async () => {
        const res = await request(buildApp()).get('/filters/all');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            fi1: [], fi2: [], fi3: [], fi4: [], fi5: [],
            cacheAge: null,
        });
    });
});
