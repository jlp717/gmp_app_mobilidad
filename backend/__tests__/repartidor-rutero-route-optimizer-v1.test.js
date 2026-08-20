'use strict';

const { optimizeRoutePackage } = require('../services/repartidor-rutero-route-optimizer');

describe('time_window_route_v1', () => {
  test('windows_first protects an earlier deadline over a closer later stop', () => {
    const packed = optimizeRoutePackage(
      [{ documentId: 'close', cliente: 'CLOSE' }, { documentId: 'early', cliente: 'EARLY' }],
      '2026-08-20',
      new Map([['EARLY', { horaRepartoDesde: 700, horaRepartoHasta: 735 }], ['CLOSE', { horaRepartoDesde: 1000 }]]),
      { geoByCliente: new Map([['EARLY', { lat: 0.3, lng: 0 }], ['CLOSE', { lat: 0.005, lng: 0 }]]), origin: { lat: 0, lng: 0 }, departureMinute: 420, avgKmh: 60, strategy: 'windows_first' },
    );
    expect(packed.orden.map((row) => row.cliente)).toEqual(['EARLY', 'CLOSE']);
    expect(packed.orden[0].late).toBe(false);
  });

  test('records waits and late end-window conflicts', () => {
    const geo = new Map([['OPEN', { lat: 0.005, lng: 0 }], ['LATE', { lat: 0.3, lng: 0 }]]);
    const wait = optimizeRoutePackage([{ documentId: 'wait', cliente: 'OPEN' }], '2026-08-20', new Map([['OPEN', { horaRepartoDesde: 900 }]]), { geoByCliente: geo, origin: { lat: 0, lng: 0 }, departureMinute: 420, avgKmh: 60 }).orden[0];
    const late = optimizeRoutePackage([{ documentId: 'late', cliente: 'LATE' }], '2026-08-20', new Map([['LATE', { horaRepartoHasta: 705 }]]), { geoByCliente: geo, origin: { lat: 0, lng: 0 }, departureMinute: 420, avgKmh: 60 }).orden[0];
    expect(wait.waitMinutes).toBeGreaterThan(0);
    expect(late).toMatchObject({ late: true, conflict: true });
  });

  test('all strategies are deterministic and missing origin/GPS remains explicit', () => {
    const stops = [{ documentId: 'b', cliente: 'B' }, { documentId: 'a', cliente: 'A' }];
    const windows = new Map([['A', { horaRepartoDesde: 800 }], ['B', { horaRepartoDesde: 800 }]]);
    for (const strategy of ['windows_first', 'balanced', 'distance_first']) {
      const first = optimizeRoutePackage(stops, '2026-08-20', windows, { strategy });
      const second = optimizeRoutePackage(stops, '2026-08-20', windows, { strategy });
      expect(first.orden.map((row) => row.documentId)).toEqual(second.orden.map((row) => row.documentId));
      expect(first.orden.every((row) => row.etaMinute === null && /Sin punto de salida/.test(row.reason))).toBe(true);
    }
  });
});
