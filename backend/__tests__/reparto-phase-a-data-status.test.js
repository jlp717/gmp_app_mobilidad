'use strict';

const fs = require('fs');
const path = require('path');

describe('phase A reparto data/status contracts', () => {
  const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

  test('collections are bounded to five drivers and report partial batches', () => {
    const source = read('repositories/repartidor-route-db2-repository.js');
    expect(source).toContain('const COLLECTION_DRIVER_BATCH_SIZE = 5;')
    expect(source).toContain('for (const batch of batches)');
  });

  test('isolated test history does not promote ERP delivery state', () => {
    expect(read('repositories/repartidor-route-db2-repository.js')).toContain("ESTADO_ENTREGA: 'PENDIENTE'");
  });

  test('detail discrepancy retains raw line sum but compares CPC gross to net plus IVA', () => {
    const source = read('routes/entregas.js');
    expect(source).toContain('lineSum: lineSumRounded,');
    expect(source).toContain('resolveDeliveryAmount({');
  });

  test('list and detail cap CVC pending to the document (never raw CVC as cobro)', () => {
    const source = read('routes/entregas.js');
    expect(source).toContain('resolveDocumentCollectable({');
    expect(source).not.toMatch(
      /const importeDisponibleCobro = cvcAvailability\.state === 'AVAILABLE'/,
    );
    expect(source).not.toMatch(
      /importeDisponibleCobro:\s*detailCvcAvailability\.importeDisponibleCobro/,
    );
    expect(source).toContain('documentAmount: importeAlbaran');
    expect(source).toContain('documentAmount: resolvedAmount.amount');
  });
});
