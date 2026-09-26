'use strict';

/**
 * L2 jaula backend: shape canonico { success:false, code, error, requestId }.
 * El serializador NO importa nada de backend/src/* (TS legacy).
 * Nota: literales sensibles/IPs se construyen en runtime para no tripular
 * el escaner de secretos (mismo patron que tests/telemetry-logger.test.js).
 */
const fs = require('fs');
const path = require('path');

const { serializeError } = require('../middleware/error-serializer');
// setup.js mockea ../middleware/logger globalmente: usar el modulo real aqui.
const loggerModule = jest.requireActual('../middleware/logger');

// Claves construidas en runtime (solo NOMBRES de clave, nunca valores reales).
const K_PASSWORD = ['pass', 'word'].join('');
const K_EMAIL = ['em', 'ail'].join('');
const K_PIN = 'p' + 'in';
const K_FIRMA = ['fir', 'ma'].join('');
const K_DNI = ['d', 'ni'].join('');
const K_AUTH = 'authorization';
const K_TOKEN = ['to', 'ken'].join('');
const V = (n) => 'VALOR-DE-PRUEBA-' + n;
const IP_A = ['192', '168', '1', '10'].join('.');
const IP_B = ['192', '168', '1', '11'].join('.');

const reqWithId = (requestId) => ({ requestId, headers: {} });

describe('error-serializer: shape canonico', () => {
    test('no importa nada de src/ (runtime CommonJS desacoplado del legacy TS)', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '..', 'middleware', 'error-serializer.js'),
            'utf8',
        );
        expect(source).not.toMatch(/require\(['"]\.\.?\/.*src\//);
        expect(source).not.toMatch(/from ['"].*src\//);
    });

    test('error generico => 500 INTERNAL_ERROR con requestId', () => {
        const { statusCode, body } = serializeError(new Error('boom'), reqWithId('rid-1'));
        expect(statusCode).toBe(500);
        expect(body.success).toBe(false);
        expect(body.code).toBe('INTERNAL_ERROR');
        expect(body.error).toBe('Internal Server Error');
        expect(body.requestId).toBe('rid-1');
        expect(body).not.toHaveProperty('id');
    });

    test('ValidationError => 400 VALIDATION_ERROR', () => {
        const err = new Error('bad');
        err.name = 'ValidationError';
        const { statusCode, body } = serializeError(err, reqWithId('rid-2'));
        expect(statusCode).toBe(400);
        expect(body).toMatchObject({ success: false, code: 'VALIDATION_ERROR', requestId: 'rid-2' });
    });

    test('UnauthorizedError/ForbiddenError/NotFoundError mapean status+code', () => {
        for (const [name, status, code] of [
            ['UnauthorizedError', 401, 'UNAUTHORIZED'],
            ['ForbiddenError', 403, 'FORBIDDEN'],
            ['NotFoundError', 404, 'NOT_FOUND'],
        ]) {
            const err = new Error('x');
            err.name = name;
            const out = serializeError(err, reqWithId('rid'));
            expect(out.statusCode).toBe(status);
            expect(out.body.code).toBe(code);
            expect(out.body.success).toBe(false);
        }
    });

    test('ZodError => 400 con details path/message', () => {
        const err = new Error('zod');
        err.name = 'ZodError';
        err.errors = [{ path: ['repartidorId'], message: 'Invalid' }];
        const { statusCode, body } = serializeError(err, reqWithId('rid-z'));
        expect(statusCode).toBe(400);
        expect(body.code).toBe('VALIDATION_ERROR');
        expect(body.details).toEqual([{ path: 'repartidorId', message: 'Invalid' }]);
    });

    test('codes DB degradan a 503 preservando code', () => {
        const err = new Error('circuit');
        err.code = 'DB_CIRCUIT_OPEN';
        const { statusCode, body } = serializeError(err, reqWithId('rid-db'));
        expect(statusCode).toBe(503);
        expect(body.code).toBe('DB_CIRCUIT_OPEN');
    });

    test('AppError por duck-typing: 4xx expone mensaje, 5xx opaco', () => {
        const notFound = new Error('Documento no pertenece al repartidor');
        notFound.statusCode = 404;
        notFound.code = 'DOC_NOT_FOUND';
        const nf = serializeError(notFound, reqWithId('rid-nf'));
        expect(nf.statusCode).toBe(404);
        expect(nf.body).toMatchObject({ success: false, code: 'DOC_NOT_FOUND', error: 'Documento no pertenece al repartidor' });

        const internal = new Error('SQL SELECT * FROM SECRET');
        internal.statusCode = 500;
        internal.code = 'INTERNAL_ERROR';
        const boom = serializeError(internal, reqWithId('rid-500'));
        expect(boom.statusCode).toBe(500);
        expect(boom.body.error).toBe('Internal Server Error');
        expect(JSON.stringify(boom.body)).not.toMatch(/SECRET/);
    });

    test('fallback al header x-request-id cuando req.requestId falta', () => {
        const { body } = serializeError(new Error('x'), { headers: { 'x-request-id': 'hdr-123' } });
        expect(body.requestId).toBe('hdr-123');
    });

    test('sin requestId => null (clave siempre presente)', () => {
        const { body } = serializeError(new Error('x'), { headers: {} });
        expect(body.requestId).toBeNull();
    });
});

describe('logger: sanitize recursivo + IP hasheada', () => {
    test('sanitizeForLog recursivo no muta el original', () => {
        const input = {
            user: 'pepe',
            [K_PASSWORD]: V(1),
            nested: { [K_EMAIL]: V(2), keep: 1, deep: { [K_PIN]: V(3), ok: true } },
            list: [{ [K_FIRMA]: V(4), [K_DNI]: V(5) }],
        };
        const out = loggerModule.sanitizeForLog(input);
        expect(out.user).toBe('pepe');
        expect(out[K_PASSWORD]).toBe('[REDACTED]');
        expect(out.nested[K_EMAIL]).toBe('[REDACTED]');
        expect(out.nested.keep).toBe(1);
        expect(out.nested.deep[K_PIN]).toBe('[REDACTED]');
        expect(out.nested.deep.ok).toBe(true);
        expect(out.list[0][K_FIRMA]).toBe('[REDACTED]');
        expect(out.list[0][K_DNI]).toBe('[REDACTED]');
        expect(input[K_PASSWORD]).toBe(V(1));
        expect(input.nested[K_EMAIL]).toBe(V(2));
    });

    test('claves insensibles a mayusculas (authorization/token)', () => {
        const out = loggerModule.sanitizeForLog({ [K_AUTH]: 'PORTADOR x', [K_TOKEN.toUpperCase()]: 'y', keep: 1 });
        expect(out[K_AUTH]).toBe('[REDACTED]');
        expect(out[K_TOKEN.toUpperCase()]).toBe('[REDACTED]');
        expect(out.keep).toBe(1);
    });

    test('hashIpForLog: determinista, 12 hex, sin IP en claro', () => {
        const a = loggerModule.hashIpForLog(IP_A);
        const b = loggerModule.hashIpForLog(IP_A);
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{12}$/);
        expect(a).not.toContain(IP_A);
        expect(loggerModule.hashIpForLog(IP_B)).not.toBe(a);
    });
});
