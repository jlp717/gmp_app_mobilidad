'use strict';

const {
  parseRouteDate,
  normalizeOrdenPayload,
  applySavedOrder,
  parseCrutHour,
  parseOpenTimeFromObs,
  preferredStartMinute,
  isClosedOnDate,
  optimizeStops,
} = require('../services/repartidor-rutero-orden-service');

describe('repartidor rutero orden service', () => {
  test('parseRouteDate accepts YYYY-MM-DD only', () => {
    expect(parseRouteDate('2026-08-11')).toBe('2026-08-11');
    expect(parseRouteDate('2026-08-11T12:00:00.000Z')).toBe('2026-08-11');
    expect(parseRouteDate('11/08/2026')).toBeNull();
    expect(parseRouteDate('')).toBeNull();
  });

  test('normalizeOrdenPayload rejects empty and duplicates', () => {
    expect(normalizeOrdenPayload([])).toEqual({ error: 'ORDEN_EMPTY' });
    expect(normalizeOrdenPayload(null)).toEqual({ error: 'ORDEN_INVALID' });
    expect(normalizeOrdenPayload([
      { documentId: 'A', posicion: 0 },
      { documentId: 'A', posicion: 1 },
    ])).toEqual({ error: 'ORDEN_DUPLICATE' });
    const ok = normalizeOrdenPayload([
      { documentId: 'doc-2', cliente: '4301', posicion: 5 },
      { documentId: 'doc-1', cliente: '4302', posicion: 1 },
    ]);
    expect(ok.error).toBeUndefined();
    expect(ok.value.map((r) => r.documentId)).toEqual(['doc-1', 'doc-2']);
    expect(ok.value.map((r) => r.posicion)).toEqual([0, 1]);
  });

  test('applySavedOrder puts known docs first then remainder', () => {
    const items = [
      { id: 'z', importe: 1 },
      { id: 'a', importe: 2 },
      { id: 'b', importe: 3 },
    ];
    const ordered = applySavedOrder(items, [
      { documentId: 'b', posicion: 0 },
      { documentId: 'a', posicion: 1 },
    ]);
    expect(ordered.map((i) => i.id)).toEqual(['b', 'a', 'z']);
  });

  test('parseCrutHour handles HHMMSS and HHMM', () => {
    expect(parseCrutHour(90000)).toBe(9 * 60);
    expect(parseCrutHour(815)).toBe(8 * 60 + 15);
    expect(parseCrutHour(81500)).toBe(8 * 60 + 15);
    expect(parseCrutHour(0)).toBeNull();
    expect(parseCrutHour(null)).toBeNull();
  });

  test('parseOpenTimeFromObs extracts ABRE patterns', () => {
    expect(parseOpenTimeFromObs('ABRE A LAS 11')).toBe(11 * 60);
    expect(parseOpenTimeFromObs('ABRE 8:15')).toBe(8 * 60 + 15);
    expect(parseOpenTimeFromObs('sin horario')).toBeNull();
  });

  test('optimizeStops sorts early to late with closed-day penalty and keeps all', () => {
    const windows = new Map([
      ['A', { horaRepartoDesde: 110000, DIACIERREMIERCOLESSN: 'N' }],
      ['B', { horaRepartoDesde: 80000, DIACIERREMIERCOLESSN: 'N' }],
      ['C', { observacionesReparto: 'ABRE A LAS 9', DIACIERREMIERCOLESSN: 'S' }],
    ]);
    // 2026-08-12 is Wednesday
    const result = optimizeStops([
      { documentId: '1', cliente: 'A' },
      { documentId: '2', cliente: 'B' },
      { documentId: '3', cliente: 'C' },
    ], '2026-08-12', windows);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.cliente)).toEqual(['B', 'A', 'C']);
    expect(result[2].closedDay).toBe(true);
    expect(preferredStartMinute(windows.get('B'))).toBe(8 * 60);
    expect(isClosedOnDate(windows.get('C'), '2026-08-12')).toBe(true);
  });
});
