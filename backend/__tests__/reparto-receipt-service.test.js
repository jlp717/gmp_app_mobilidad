'use strict';
const { createRepartoReceiptService } = require('../services/reparto-receipt-service');
function stored(overrides = {}) { const confirmation = { ID: 7, IDEMPOTENCY_KEY: 'k1', DOCUMENT_ID: 'ALB-1', REPARTIDOR_ID: 'R1', CLIENTE_CODIGO: 'C1', CLIENTE_NOMBRE: 'Cliente', DOCUMENTO_TIPO: 'CAC', DOCUMENTO_ORIGEN: 'O', DOCUMENTO_SUBEMPRESA: 'S', DOCUMENTO_EJERCICIO: 2026, DOCUMENTO_SERIE: 'A', DOCUMENTO_TERMINAL: 1, DOCUMENTO_NUMERO: 2, DOCUMENTO_XDE: 3, DOCUMENTO_DEX: 4, PEDIDO_EJERCICIO: 2026, PEDIDO_NUMERO: 10, OCCURRED_AT: '2026-08-09T09:00:00Z', LATITUD: 40.1, LONGITUD: -3.7, STATUS: 'ENTREGADO', CONFIRMED_AT: '2026-08-09T10:00:00Z', RECEPTOR_NOMBRE: 'Ana', FIRMA_EVIDENCE_ID: 'sig-1' }; return { confirmation, lines: [{ LINEA_ID: '1', CANTIDAD_PEDIDA: 3, CANTIDAD_ENTREGADA: 2, CANTIDAD_RECHAZADA: 1, CANTIDAD_PENDIENTE: 0, PRECIO_UNITARIO: 4.5 }], evidences: [{ EVIDENCE_ID: 'sig-1', EVIDENCE_KIND: 'FIRMA', MIME_TYPE: 'image/png', STORAGE_REFERENCE: 'must-not-leak' }], payments: [{ ID: 9, IDEMPOTENCY_TOKEN: 'k1', CODIGOCLIENTEALBARAN: 'C1', CODIGOVENDEDOR: 'R1', TIPODOCUMENTO: 'CAC', ORIGENDOCUMENTO: 'O', SUBEMPRESADOCUMENTO: 'S', EJERCICIODOCUMENTO: 2026, SERIEDOCUMENTO: 'A', TERMINALDOCUMENTO: 1, NUMERODOCUMENTO: 2, XDEDOCUMENTO: 3, DEXDOCUMENTO: 4, IMPORTEVENCIMIENTO: 9, CODIGOFORMAPAGO: 'EF', DIACOBRO: 9, MESCOBRO: 8, ANOCOBRO: 2026 }], ...overrides }; }
function service(data) { return createRepartoReceiptService({ repository: { getReceipt: jest.fn().mockResolvedValue(data) } }); }
test('JEFE selected owner remains repository-scoped without allowAnyOwner', async () => {
  const getReceipt = jest.fn().mockResolvedValue(stored());
  const receiptService = createRepartoReceiptService({ repository: { getReceipt } });
  await receiptService.getReceipt({
    confirmationId: '7', actor: { role: 'JEFE_VENTAS', repartidorId: 'R1' },
  });
  expect(getReceipt).toHaveBeenCalledWith(expect.objectContaining({ ownerRepartidorId: 'R1', allowAnyOwner: false }));
});
test('passes a mandatory owner scope to the repository before snapshot details are returned', async () => { const getReceipt = jest.fn().mockResolvedValue(stored()); const receiptService = createRepartoReceiptService({ repository: { getReceipt } }); await receiptService.getReceipt({ confirmationId: '7', actor: { repartidorId: 'R1' } }); expect(getReceipt).toHaveBeenCalledWith(expect.objectContaining({ confirmationId: '7', ownerRepartidorId: 'R1', allowAnyOwner: false })); });
test('returns validated snapshot and never leaks storage references', async () => { const result = await service(stored()).getReceipt({ confirmationId: '7', actor: { repartidorId: 'R1' } }); expect(result.lineas[0]).toMatchObject({ cantidadPedida: 3, cantidadEntregada: 2, cantidadRechazada: 1, cantidadPendiente: 0 }); expect(result.evidencias[0]).not.toHaveProperty('storageReference'); expect(result.cobro.id).toBe('9'); expect(result.documento).toMatchObject({ xde: 3, dex: 4 }); expect(result.pedido.numero).toBe(10); });

test('marks the canonical DB2 snapshot as fiscally unavailable instead of inventing IVA or bultos', async () => {
  const result = await service(stored()).getReceipt({
    confirmationId: '7', actor: { repartidorId: 'R1' },
  });
  expect(result).toMatchObject({
    importeNeto: 9,
    importeIva: null,
    ivaBreakdown: [],
  });
  expect(result.lineas[0]).not.toHaveProperty('bultos');
});
test('ADMIN selected owner remains repository-scoped without allowAnyOwner', async () => {
  const getReceipt = jest.fn().mockResolvedValue(stored());
  const receiptService = createRepartoReceiptService({ repository: { getReceipt } });
  await receiptService.getReceipt({
    confirmationId: '7', actor: { role: 'ADMIN', repartidorId: 'R1' },
  });
  expect(getReceipt).toHaveBeenCalledWith(expect.objectContaining({ ownerRepartidorId: 'R1', allowAnyOwner: false }));
});
test('rejects foreign owner, signature mismatch and ambiguous payment', async () => { await expect(service(stored()).getReceipt({ confirmationId: '7', actor: { repartidorId: 'R2' } })).rejects.toMatchObject({ statusCode: 403 }); await expect(service(stored({ evidences: [] })).getReceipt({ confirmationId: '7', actor: { repartidorId: 'R1' } })).rejects.toMatchObject({ code: 'REPARTO_RECEIPT_SIGNATURE_UNAVAILABLE' }); await expect(service(stored({ payments: [{ ID: 1 }, { ID: 2 }] })).getReceipt({ confirmationId: '7', actor: { repartidorId: 'R1' } })).rejects.toMatchObject({ statusCode: 409 }); });
test('rejects invalid quantities, valuation and payment ownership', async () => { for (const lines of [[{ CANTIDAD_PEDIDA: NaN, CANTIDAD_ENTREGADA: 0, CANTIDAD_RECHAZADA: 0, CANTIDAD_PENDIENTE: 0, PRECIO_UNITARIO: 1 }], [{ CANTIDAD_PEDIDA: 2, CANTIDAD_ENTREGADA: 1, CANTIDAD_RECHAZADA: 0, CANTIDAD_PENDIENTE: 0, PRECIO_UNITARIO: 1 }], [{ CANTIDAD_PEDIDA: null, CANTIDAD_ENTREGADA: 1, CANTIDAD_RECHAZADA: 0, CANTIDAD_PENDIENTE: 0, PRECIO_UNITARIO: 1 }], [{ CANTIDAD_PEDIDA: 1, CANTIDAD_ENTREGADA: 1, CANTIDAD_RECHAZADA: 0, CANTIDAD_PENDIENTE: 0, PRECIO_UNITARIO: -1 }]]) await expect(service(stored({ lines })).getReceipt({ confirmationId: '7', actor: { repartidorId: 'R1' } })).rejects.toMatchObject({ statusCode: 503 }); let invalid = stored(); invalid.payments[0].CODIGOVENDEDOR = 'R2'; await expect(service(invalid).getReceipt({ confirmationId: '7', actor: { repartidorId: 'R1' } })).rejects.toMatchObject({ code: 'REPARTO_RECEIPT_PAYMENT_UNAVAILABLE' }); invalid = stored(); invalid.payments[0].IMPORTEVENCIMIENTO = 0; await expect(service(invalid).getReceipt({ confirmationId: '7', actor: { repartidorId: 'R1' } })).rejects.toMatchObject({ code: 'REPARTO_RECEIPT_PAYMENT_UNAVAILABLE' }); invalid = stored(); invalid.payments[0].DEXDOCUMENTO = 9; await expect(service(invalid).getReceipt({ confirmationId: '7', actor: { repartidorId: 'R1' } })).rejects.toMatchObject({ code: 'REPARTO_RECEIPT_PAYMENT_UNAVAILABLE' }); });

test('supports an unpaid persisted confirmation without inventing a payment', async () => {
  const result = await service(stored({ payments: [] })).getReceipt({
    confirmationId: '7', actor: { repartidorId: 'R1' },
  });
  expect(result.cobro).toBeNull();
});

test('accepts only the exact persisted 0 EUR prepaid proof without lines or payment', async () => {
  const proof = JSON.stringify({
    receiptProof: {
      plannedImporteTotal: 0, plannedLineCount: 0, actualLineCount: 0,
      prepaidZeroWithoutLines: true,
    },
  });
  const zeroConfirmation = { ...stored().confirmation, RESULT_JSON: proof };
  await expect(service(stored({
    confirmation: zeroConfirmation, lines: [], payments: [],
  })).getReceipt({ confirmationId: '7', actor: { repartidorId: 'R1' } })).resolves.toMatchObject({
    prepaidZeroWithoutLines: true, importeTotal: 0, cobro: null, lineas: [],
  });
  await expect(service(stored({
    lines: [], payments: [],
  })).getReceipt({ confirmationId: '7', actor: { repartidorId: 'R1' } })).rejects.toMatchObject({
    code: 'REPARTO_RECEIPT_LINES_UNAVAILABLE', statusCode: 503,
  });
  await expect(service(stored({
    confirmation: { ...zeroConfirmation, STATUS: 'PARCIAL' }, lines: [], payments: [],
  })).getReceipt({ confirmationId: '7', actor: { repartidorId: 'R1' } })).rejects.toMatchObject({
    code: 'REPARTO_RECEIPT_LINES_UNAVAILABLE', statusCode: 503,
  });
});

test.each([
  [31, 4, 2026],
  [29, 2, 2025],
])('rejects impossible payment calendar date %s/%s/%s', async (day, month, year) => {
  const invalid = stored();
  Object.assign(invalid.payments[0], { DIACOBRO: day, MESCOBRO: month, ANOCOBRO: year });
  await expect(service(invalid).getReceipt({
    confirmationId: '7', actor: { repartidorId: 'R1' },
  })).rejects.toMatchObject({ code: 'REPARTO_RECEIPT_PAYMENT_UNAVAILABLE' });
});

test('accepts a leap-day payment date', async () => {
  const leap = stored();
  Object.assign(leap.payments[0], { DIACOBRO: 29, MESCOBRO: 2, ANOCOBRO: 2024 });
  await expect(service(leap).getReceipt({
    confirmationId: '7', actor: { repartidorId: 'R1' },
  })).resolves.toMatchObject({ cobro: { fecha: { dia: 29, mes: 2, ano: 2024 } } });
});


