'use strict';

const {
  dedupeCobroRows,
  dedupeVencimientos,
} = require('../services/repartidor-finance-service');

describe('reparto cobros dedupe', () => {
  test('the same cobro id is listed once', () => {
    const rows = dedupeCobroRows([
      { ID: 7, IMPORTEVENCIMIENTO: 20.7, CODIGOCLIENTEALBARAN: 'C1' },
      { ID: 7, IMPORTEVENCIMIENTO: 20.7, CODIGOCLIENTEALBARAN: 'C1' },
      { ID: 8, IMPORTEVENCIMIENTO: 4, CODIGOCLIENTEALBARAN: 'C2' },
    ]);
    expect(rows.map((row) => row.ID)).toEqual([7, 8]);
  });

  test('the same vencimiento document is listed once', () => {
    const item = {
      codigoCliente: 'C1',
      keys: {
        tipoDocumento: 'CAC',
        origenDocumento: 'B',
        subempresaDocumento: '01',
        ejercicioDocumento: 2026,
        serieDocumento: 'P',
        terminalDocumento: 15,
        numeroDocumento: 2296,
        xdeDocumento: 1,
        dexDocumento: 1,
      },
    };
    expect(dedupeVencimientos([item, { ...item }, {
      ...item,
      codigoCliente: 'C2',
    }])).toHaveLength(2);
  });
});
