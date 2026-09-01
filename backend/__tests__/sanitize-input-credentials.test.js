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

    it('leaves non-string scalars alone', () => {
        const out = run({ password: 12345, count: 7, flag: true });
        expect(out).toEqual({ password: 12345, count: 7, flag: true });
    });
});
