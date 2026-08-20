'use strict';

const {
  optimizeRoutePackage,
  annotateRouteTimeline,
} = require('../services/repartidor-rutero-route-optimizer');

describe('repartidor-rutero-route-optimizer', () => {
  test('window buckets use nearest-neighbor within same preferred window', () => {
    const windows = new Map([
      ['NEAR', { horaRepartoDesde: 800 }],
      ['MID', { horaRepartoDesde: 800 }],
      ['FAR', { horaRepartoDesde: 900 }],
    ]);
    const geo = new Map([
      ['NEAR', { lat: 36.835, lng: -2.465 }],
      ['MID', { lat: 36.85, lng: -2.48 }],
      ['FAR', { lat: 36.95, lng: -2.55 }],
    ]);
    const packed = optimizeRoutePackage(
      [
        { documentId: '1', cliente: 'FAR' },
        { documentId: '2', cliente: 'MID' },
        { documentId: '3', cliente: 'NEAR' },
      ],
      '2026-08-20',
      windows,
      { geoByCliente: geo, origin: { lat: 36.834, lng: -2.463 }, departureMinute: 420, strategy: 'distance_first' },
    );

    expect(packed.algorithm).toBe('time_window_route_v1');
    expect(packed.orden.map((s) => s.cliente)).toEqual(['NEAR', 'MID', 'FAR']);
    expect(packed.orden[0].etaLabel).toMatch(/^07:/);
    expect(packed.explanation.summary).toMatch(/ventana/i);
  });

  test('annotateRouteTimeline accepts lat/lng without geo object', () => {
    const annotated = annotateRouteTimeline(
      [
        { cliente: 'A', lat: 36.84, lng: -2.46, preferredMinute: 480 },
        { cliente: 'B', lat: 36.90, lng: -2.50, preferredMinute: 540 },
      ],
      { departureMinute: 7 * 60, origin: { lat: 36.834, lng: -2.463 } },
    );
    expect(annotated).toHaveLength(2);
    expect(annotated[0].hasGps).toBe(true);
    expect(annotated[1].hasGps).toBe(true);
    expect(annotated[0].etaLabel).toBeTruthy();
  });
});
