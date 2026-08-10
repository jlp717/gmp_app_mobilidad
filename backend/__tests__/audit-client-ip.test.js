'use strict';

jest.mock('../middleware/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { getClientIP } = require('../middleware/audit');

describe('audit client peer identity', () => {
    test('ignores forged forwarding headers and records the connected peer', () => {
        expect(getClientIP({
            headers: { 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1' },
            ip: '127.0.0.1',
            socket: { remoteAddress: '203.0.113.10' },
        })).toBe('203.0.113.10');
    });

    test('preserves a real local peer and normalizes IPv4-mapped peers', () => {
        expect(getClientIP({ headers: {}, socket: { remoteAddress: '127.0.0.1' } })).toBe('127.0.0.1');
        expect(getClientIP({ headers: {}, socket: { remoteAddress: '::ffff:192.0.2.44' } })).toBe('192.0.2.44');
    });
});
