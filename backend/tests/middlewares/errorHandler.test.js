'use strict';

const request = require('supertest');
const express = require('express');
const { errorHandler } = require('../../src/middlewares/errorHandler');

jest.mock('../../middleware/logger', () => ({
    info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

function buildApp(style) {
    const app = express();
    app.get('/boom', (req, res, next) => {
        res.locals.errorStyle = style;
        if (style === 'finanzas') res.locals.errorAction = 'TEST';
        next(new Error('SECRETO-interno con SQL SELECT *'));
    });
    app.use(errorHandler);
    return app;
}

describe('middlewares/errorHandler', () => {
    test('estilo legacy: 500 con shape createErrorResponse y sin stack', async () => {
        const res = await request(buildApp('legacy')).get('/boom');
        expect(res.status).toBe(500);
        expect(res.body.error).toBeDefined();
        expect(res.body.code).toBe('INTERNAL_ERROR');
        expect(JSON.stringify(res.body)).not.toMatch(/SECRETO-interno/);
        expect(JSON.stringify(res.body)).not.toMatch(/at /);
    });

    test('estilo finanzas inesperado: INTERNAL_SERVER_ERROR generico', async () => {
        const res = await request(buildApp('finanzas')).get('/boom');
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ success: false, code: 'INTERNAL_SERVER_ERROR', error: 'Error interno del servidor' });
        expect(JSON.stringify(res.body)).not.toMatch(/SECRETO-interno/);
    });

    test('codes DB degradan a 503 en estilo legacy', async () => {
        const app = express();
        app.get('/db', (req, res, next) => { next(Object.assign(new Error('circuit'), { code: 'DB_CIRCUIT_OPEN' })); });
        app.use(errorHandler);
        const res = await request(app).get('/db');
        expect(res.status).toBe(503);
        // Paridad con handleRouteError legacy: el mensaje pasa por
        // sanitizeErrorMessage; solo afirmamos que no filtra stack.
        expect(typeof res.body.error).toBe('string');
        expect(res.body.error).not.toMatch(/at /);
        expect(res.body.code).toBe('DB_CIRCUIT_OPEN');
    });

    test('AppError tipado (finanzas) respeta statusCode y mensaje <500', async () => {
        const { AppError } = require('../../src/errors/AppError');
        const app = express();
        app.get('/nf', (req, res, next) => {
            res.locals.errorStyle = 'finanzas';
            next(new AppError('Documento no pertenece al repartidor', { statusCode: 404, code: 'DOC_NOT_FOUND' }));
        });
        app.use(errorHandler);
        const res = await request(app).get('/nf');
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ success: false, code: 'DOC_NOT_FOUND', error: 'Documento no pertenece al repartidor' });
    });

    test('REPARTO_SCHEMA_UNAVAILABLE => 503 con texto canonico', async () => {
        const app = express();
        app.get('/schema', (req, res, next) => {
            res.locals.errorStyle = 'finanzas';
            next(Object.assign(new Error('x'), { code: 'REPARTO_SCHEMA_UNAVAILABLE' }));
        });
        app.use(errorHandler);
        const res = await request(app).get('/schema');
        expect(res.status).toBe(503);
        expect(res.body.error).toBe('El origen de datos de reparto no esta disponible. Reintenta mas tarde.');
        expect(res.body.code).toBe('REPARTO_SCHEMA_UNAVAILABLE');
    });

    test('ZodError => 400 con details path/message', async () => {
        const { z } = require('zod');
        const app = express();
        app.get('/bad', (req, res, next) => {
            res.locals.errorStyle = 'finanzas';
            const parsed = z.object({ repartidorId: z.string().regex(/^\d+$/) }).safeParse({ repartidorId: 'ALL!!' });
            if (!parsed.success) return next(parsed.error);
            next();
        });
        app.use(errorHandler);
        const res = await request(app).get('/bad');
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBe('Invalid request');
        expect(Array.isArray(res.body.details)).toBe(true);
        expect(res.body.details[0]).toHaveProperty('path');
        expect(res.body.details[0]).toHaveProperty('message');
    });

    test('headersSent: no dupla respuesta ni lanza', async () => {
        const app = express();
        app.get('/sent', (req, res, next) => {
            res.status(200).json({ ok: true });
            next(new Error('tarde'));
        });
        app.use(errorHandler);
        const res = await request(app).get('/sent');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
    });

    test('jerarquia AppError expone statusCode correctos', () => {
        const { ValidationError, NotFoundError, DatabaseError, ConflictError } = require('../../src/errors/AppError');
        expect(new ValidationError().statusCode).toBe(400);
        expect(new NotFoundError().statusCode).toBe(404);
        expect(new DatabaseError().statusCode).toBe(503);
        expect(new ConflictError().statusCode).toBe(409);
        expect(new ConflictError('dup', { code: 'IDEMPOTENCY_CONFLICT' }).code).toBe('IDEMPOTENCY_CONFLICT');
    });

    test('estilo legacy: AppError 4xx expone mensaje y 5xx permanece opaco', async () => {
        const { ValidationError, AppError } = require('../../src/errors/AppError');
        const app = express();
        app.get('/bad', (_req, _res, next) => next(new ValidationError('limit invalido')));
        app.get('/boom', (_req, _res, next) => next(new AppError('SQL SELECT * FROM SECRET', { statusCode: 500, code: 'INTERNAL_ERROR' })));
        app.use(errorHandler);

        const bad = await request(app).get('/bad');
        expect(bad.status).toBe(400);
        expect(bad.body.error).toBe('limit invalido');
        expect(bad.body.code).toBe('VALIDATION_ERROR');

        const boom = await request(app).get('/boom');
        expect(boom.status).toBe(500);
        expect(JSON.stringify(boom.body)).not.toMatch(/SECRET|SELECT \*/);
        expect(boom.body.error).toBe('Error interno del servidor');
    });
});
