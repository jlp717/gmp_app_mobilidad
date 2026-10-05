'use strict';

const { shouldKeepAnteroomPedido } = require('../services/rutero-anteroom-dedupe');

describe('rutero anteroom dedupe', () => {
  const existing = new Set(['2026-P-15-2296-C1']);

  test('keeps a confirmed order that is not already on the route', () => {
    expect(shouldKeepAnteroomPedido({
      CODIGO_REPARTIDOR: '94',
      EJERCICIOALBARAN: 2026,
      SERIEALBARAN: 'P',
      TERMINALALBARAN: 15,
      NUMEROALBARAN: 3001,
      CLIENTE: 'C9',
    }, existing)).toBe(true);
  });

  test('drops a collected order that has no driver assigned', () => {
    expect(shouldKeepAnteroomPedido({
      CODIGO_REPARTIDOR: '',
      COBRO_PROPIO_SN: 'S',
      CLIENTE: 'C9',
    }, existing)).toBe(false);
  });

  test('keeps a collected-in-hand order assigned to a driver', () => {
    expect(shouldKeepAnteroomPedido({
      CODIGO_REPARTIDOR: '94',
      COBRO_PROPIO_SN: 'S',
      EJERCICIOALBARAN: 2026,
      SERIEALBARAN: 'M',
      TERMINALALBARAN: 15,
      NUMEROALBARAN: 8,
      CLIENTE: 'C3',
    }, existing)).toBe(true);
  });

  test('drops the anteroom row when the synced ERP id is already on the route', () => {
    expect(shouldKeepAnteroomPedido({
      CODIGO_REPARTIDOR: '94',
      EJERCICIOALBARAN: 2026,
      SERIEALBARAN: 'P',
      TERMINALALBARAN: 15,
      NUMEROALBARAN: 1,
      CLIENTE: 'C1',
      SYSTEM_EJERCICIO: 2026,
      SYSTEM_SERIE: 'P',
      SYSTEM_TERMINAL: 15,
      SYSTEM_NUMERO: 2296,
    }, existing)).toBe(false);
  });
});
