'use strict';

const fs = require('fs');
const script = require('../scripts/certify-reparto-confirm-local');

describe('local Reparto confirmation certifier static contract', () => {
  test('is hard-pinned to local test endpoint and private actor file', () => {
    expect(script.HOST).toBe('127.0.0.1');
    expect(script.PORT).toBe(3336);
    expect(script.BASE).toBe('/api');
    expect(script.ACTORS_FILE).toMatch(/gmp-cert-actors\.json$/);
  });

  test('requires a complete route identity and maps only actual product lines', () => {
    expect(script.identityOf({ id: 'x', numero: 1, ejercicio: 2026, serie: 'A', terminal: 1, codigoCliente: 'C' })).toEqual(expect.objectContaining({ itemId: 'x' }));
    expect(script.identityOf({ id: 'x', numero: 1 })).toBeNull();
    expect(script.detailLines({ albaran: { lineas: [
      { lineaId: 2, codigoArticulo: 'A1', cantidad: 2 },
    ] } })).toEqual([expect.objectContaining({ codigoArticulo: 'A1', cantidadEntregada: 2 })]);
    expect(script.detailLines({ albaran: { lineas: [
      { lineaId: 1, codigoArticulo: '000', cantidad: 3 },
      { lineaId: 2, codigoArticulo: 'A1', cantidad: 2 },
    ] } })).toBeNull();
    expect(script.detailLines({ albaran: { lineas: [
      { lineaId: 1, codigoArticulo: 'A1', cantidad: 0 },
    ] } })).toBeNull();
    expect(script.detailLines({ albaran: { lineas: [
      { codigoArticulo: 'A1', cantidad: 2 },
    ] } })).toBeNull();
    expect(script.amountOf({ albaran: { importeTotal: '0.00' } }, {})).toBe(0);
    expect(script.amountOf({ albaran: { importe: '42.75' } }, {})).toBe(42.75);
  });

  test('accepts canonical root/data response shapes without exposing token contents', () => {
    const claims = { claimsVersion: 4, role: 'REPARTIDOR', repartidorCodes: ['7'] };
    const token = `${Buffer.from(JSON.stringify(claims)).toString('base64')}.signature`;
    expect(script.userOf({ user: { code: '07' } })).toEqual({ code: '07' });
    expect(script.userOf({ data: { user: { code: '07' } } })).toEqual({ code: '07' });
    expect(script.arrayOf([{ code: '07' }], ['repartidores'])).toEqual([{ code: '07' }]);
    expect(script.arrayOf({ data: [{ code: '07' }] }, ['repartidores'])).toEqual([{ code: '07' }]);
    expect(script.arrayOf({ data: { repartidores: [{ code: '07' }] } }, ['repartidores'])).toEqual([{ code: '07' }]);
    expect(script.decodedClaimsOf(token)).toEqual(claims);
    expect(script.signedRepartidorCodes(script.decodedClaimsOf(token))).toEqual(['07']);
    expect(script.outsideFleetCode(['07', 'ZZ'])).not.toBeNull();
  });

  test('reads week {days} before/after and counts exactly one completed overlay', () => {
    const before = { days: [{ date: '2026-08-18', clients: 25, completed: 0, status: 'bad' }] };
    const after = { data: { days: [{ date: '2026-08-18', clients: 25, completed: 1, status: 'bad' }] } };
    expect(script.weekDaysOf(before)).toHaveLength(1);
    expect(script.weekDaysOf(after)).toHaveLength(1);
    expect(script.weekCompletedCount(after)).toBe(script.weekCompletedCount(before) + 1);
  });

  test('source never logs credentials, token values, request or response bodies', () => {
    const source = fs.readFileSync(require.resolve('../scripts/certify-reparto-confirm-local'), 'utf8');
    expect(source).not.toMatch(/console\.log/);
    expect(source).not.toMatch(/raw\.slice|process\.stdout\.write\((?:raw|body|token|credentials)/);
    expect(source).not.toMatch(/JSON\.stringify\((?:actors|credentials|token)/);
    expect(source).toMatch(/const payload = body === undefined \? null : JSON\.stringify\(body\)/);
    expect(source).toMatch(/legacy\.status === 410/);
    expect(source).toMatch(/token: repartidor\.token, body: \{\}/);
    expect(source).toMatch(/changedReplay\.status === 409/);
    expect(source).toMatch(/jefe\.bola_outside_fleet/);
    expect(source).toMatch(/receipt\?repartidorId=/);
    expect(source).toMatch(/receipt\/email/);
    expect(source).toMatch(/REPARTO_EMAIL_TEST_SINK/);
  });
});
