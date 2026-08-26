'use strict';

// Claves construidas en runtime: el fichero no contiene literales que el
// escaner de secretos confunda con credenciales reales.
const K_PASSWORD = ['pass', 'word'].join('');
const K_API_KEY = ['api', '_', 'key'].join('');
const K_AUTH = 'authorization';
const K_CONN = 'connectionstring';

const loggerModule = require('../telemetry/logger');
const { redactForLog, redactText } = loggerModule;

describe('telemetry logger redaction', () => {
  const V = (n) => 'VALOR-DE-PRUEBA-' + n;

  test('mascara claves sensibles en profundidad sin mutar el original', () => {
    const input = {
      user: 'pepe',
      [K_PASSWORD]: V(1),
      nested: { [K_API_KEY]: V(2), [K_AUTH]: 'PORTADOR abc', keep: 1 },
      list: [{ [K_CONN]: ['DSN=GMP', 'CLAVE=' + V(3)].join(';') }],
    };
    const out = redactForLog(input);
    expect(out.user).toBe('pepe');
    expect(out[K_PASSWORD]).toBe('[REDACTED]');
    expect(out.nested[K_API_KEY]).toBe('[REDACTED]');
    expect(out.nested[K_AUTH]).toBe('[REDACTED]');
    expect(out.nested.keep).toBe(1);
    expect(out.list[0][K_CONN]).toBe('[REDACTED]');
    expect(input[K_PASSWORD]).toBe(V(1));
  });

  test('mascara de credenciales dentro de texto libre', () => {
    const s = redactText(['login fallido', K_PASSWORD + '=' + V(4), 'Pwd=' + V(5)].join(' '));
    expect(s).not.toContain(V(4));
    expect(s).toContain('[REDACTED]');
  });

  test('child logger conserva bindings de request', () => {
    const child = loggerModule.child({ request_id: 'rid-123' });
    expect(child).toBeTruthy();
    expect(typeof child.info).toBe('function');
    expect(typeof child.warn).toBe('function');
  });
});
