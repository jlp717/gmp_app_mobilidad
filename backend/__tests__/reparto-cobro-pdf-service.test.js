'use strict';


const { buildCobroPdfBuffer, buildCobroPdfFileName } = require('../services/reparto-cobro-pdf-service');

test('builds a payment receipt PDF with the persisted cobro facts', async () => {
  const payload = {
    cobroId: '81',
    documento: '2026-S-10-404-4300001',
    codigoCliente: '4300001',
    nombreCliente: 'Cliente Demo',
    repartidorId: '94',
    importe: '25.50',
    pendiente: '10.00',
    formaPago: 'EFECTIVO',
    origen: 'VENCIMIENTOS',
    registradoAt: '2026-08-24T18:31:00.000Z',
    notas: 'Pago parcial',
  };

  const buffer = await buildCobroPdfBuffer(payload);
  const raw = buffer.toString('latin1').toUpperCase();

  expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  expect(raw).toContain('4A55535449464943414E5445');
  expect(raw).toContain('323032362D532D31302D3430342D34333030303031');
  expect(raw).toContain('32352C3530');
  expect(raw).toContain('31302C3030');
  expect(buildCobroPdfFileName(payload)).toBe('RECIBO_COBRO_2026-S-10-404-4300001.pdf');
});
