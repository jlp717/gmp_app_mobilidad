/**
 * Contract: sanitizeInput preserva credenciales intactas y sigue limpiando
 * campos no sensibles. Las credenciales viajan SIEMPRE parametrizadas, por lo
 * que sanitizarlas solo consigue romper logins validos o debilitar la clave.
 */
const request = require('supertest');
const { describe, it, expect } = require('@jest/globals');

describe('sanitizeInput credential passthrough (contract)', () => {
    const sanitizeInput = require('../middleware/security').sanitizeInput;

    const run = (body) => {
        const req = { body, query: {} };
        sanitizeInput(req, {}, () => {});
        return req.body;
    };

    it('keeps passwords with special characters untouched', () => {
        const out = run({ username: 'javier', password: 'p@ss"\'w\\rd;DROP' });
        expect(out.password).toBe('p@ss"\'w\\rd;DROP');
        expect(out.username).toBe('javier');
    });

    it('keeps new/current password fields untouched', () => {
        const out = run({ current_password: 'a;b', newPassword: 'c"d' });
        expect(out.current_password).toBe('a;b');
        expect(out.newPassword).toBe('c"d');
    });

    it('still strips quotes from non-sensitive fields', () => {
        const out = run({ note: "<script>alert('x')</script>" });
        expect(out.note).not.toMatch(/[<>'"\\;]/);
    });

    it('still sanitizes nested objects while skipping sensitive keys', () => {
        const out = run({ profile: { pin: '12;34', comment: "o'brien" } });
        expect(out.profile.pin).toBe('12;34');
        expect(out.profile.comment).toBe('obrien');
    });

    it('keeps ISO confirmation timestamps, emails and image data URIs', () => {
        const { buildConfirmationCommand } = require('../services/reparto-confirmation-contract');
        const occurredAt = '2026-10-05T13:11:31.123456Z';
        const signature = `data:image/png;base64,${'a'.repeat(64)}==`;
        const out = run({
            delivery: {
                itemId: '2026-A-1-42-C1',
                status: 'ENTREGADO',
                occurredAt,
                repartidorId: '98',
                receiver: { nombre: 'Ana', apellidos: 'Lopez', dni: '12345678Z' },
                lineas: [{
                    lineaId: '1',
                    codigoArticulo: 'ABC',
                    cantidadPedida: 1,
                    cantidadEntregada: 1,
                    cantidadRechazada: 0,
                    cantidadPendiente: 0,
                    motivoDiferencia: null,
                }],
                firma: `ev_${'a'.repeat(64)}`,
                evidencias: [],
                forceUpdate: false,
            },
            notifications: {
                sendClientEmail: true,
                sendWhatsApp: false,
                clientEmail: 'bar@cliente.test',
            },
            image: signature,
            comment: "o'brien <script>",
        });

        expect(out.delivery.occurredAt).toBe(occurredAt);
        expect(out.notifications.clientEmail).toBe('bar@cliente.test');
        expect(out.image).toBe(signature);
        expect(out.comment).not.toMatch(/[<>']/);

        const command = buildConfirmationCommand({
            user: { id: '98', code: '98', role: 'REPARTIDOR', repartidorCodes: ['98'] },
            headers: { 'idempotency-key': 'rep-testkey01' },
            body: {
                delivery: out.delivery,
                notifications: out.notifications,
            },
        });
        expect(command.delivery.occurredAt).toBe(occurredAt);
        expect(command.notifications.clientEmail).toBe('bar@cliente.test');
    });

    it('still strips a colon from ordinary text', () => {
        const out = run({ note: 'hora 13:11' });
        expect(out.note).toBe('hora 1311');
    });

    it('leaves non-string scalars alone', () => {
        const out = run({ password: 12345, count: 7, flag: true });
        expect(out).toEqual({ password: 12345, count: 7, flag: true });
    });

    it('keeps commas in query lists and still strips quotes', () => {
        const req = { body: {}, query: { years: '2026,2025,2024', vendedorCodes: "72,73'; DROP", name: "o'brien" } };
        sanitizeInput(req, {}, () => {});
        expect(req.query.years).toBe('2026,2025,2024');
        expect(req.query.vendedorCodes).toBe('72,73 DROP');
        expect(req.query.name).toBe('obrien');
    });
});
