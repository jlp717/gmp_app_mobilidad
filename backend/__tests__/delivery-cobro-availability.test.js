'use strict';

const {
  buildCvcAvailabilityQuery,
  documentKey,
  mapCvcAvailabilityRows,
  normalizeDocument,
} = require('../services/delivery-cobro-availability');

describe('delivery cobro availability', () => {
  const first = {
    SUBEMPRESAALBARAN: '01', EJERCICIOALBARAN: 2026, SERIEALBARAN: 'A',
    TERMINALALBARAN: 1, NUMEROALBARAN: 42, CLIENTE: 'C1',
  };
  const second = {
    SUBEMPRESAALBARAN: '01', EJERCICIOALBARAN: 2026, SERIEALBARAN: 'A',
    TERMINALALBARAN: 1, NUMEROALBARAN: 43, CLIENTE: 'C2',
  };

  test('builds one parameterized batch for complete document identities', () => {
    const plan = buildCvcAvailabilityQuery([first, first, second]);
    expect(plan.documents).toHaveLength(2);
    expect(plan.params).toEqual(['01', 2026, 'A', 1, 42, 'C1', '01', 2026, 'A', 1, 43, 'C2']);
    expect(plan.sql).toContain('FROM DSEDAC.CVC CVC');
    expect(plan.sql).toContain('CVC.IMPORTEPENDIENTE > 0');
    expect(plan.sql).toContain('COALESCE(TRIM(CVC.ANULADOSN), \'\') <> \'S\'');
    expect(plan.sql).not.toContain('INSERT');
  });

  test('returns available only for one positive active CVC row', () => {
    const plan = buildCvcAvailabilityQuery([first, second]);
    const availability = mapCvcAvailabilityRows([
      { SUBEMPRESA: '01', EJERCICIO: 2026, SERIE: 'A', TERMINAL: 1, NUMERO: 42, CLIENTE: 'C1', CVC_ROW_COUNT: 1, IMPORTEPENDIENTE: 12.345 },
      { SUBEMPRESA: '01', EJERCICIO: 2026, SERIE: 'A', TERMINAL: 1, NUMERO: 43, CLIENTE: 'C2', CVC_ROW_COUNT: 2, IMPORTEPENDIENTE: 50 },
    ], plan.documents);
    expect(availability.get(documentKey(first))).toEqual({ state: 'AVAILABLE', importeDisponibleCobro: 12.35 });
    expect(availability.get(documentKey(second))).toEqual({ state: 'AMBIGUOUS', importeDisponibleCobro: 0 });
  });

  test('fails closed for missing or incomplete identity', () => {
    expect(normalizeDocument({ ...first, CLIENTE: '' })).toBeNull();
    expect(buildCvcAvailabilityQuery([{ ...first, CLIENTE: '' }])).toBeNull();
    const plan = buildCvcAvailabilityQuery([first]);
    const availability = mapCvcAvailabilityRows([], plan.documents);
    expect(availability.get(documentKey(first))).toEqual({ state: 'MISSING', importeDisponibleCobro: 0 });
  });
});
