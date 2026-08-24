'use strict';

const {
  createRepartoConfirmationService,
  confirmationFingerprint,
} = require('../services/reparto-confirmation-service');

function plannedDelivery(overrides = {}) {
  return {
    documentId: '2026-S-10-404-4300009479',
    repartidorId: '94',
    cliente: { codigo: '4300009479', nombre: 'CLIENTE REAL' },
    pedido: { ejercicio: 2026, numero: 7001 },
    document: {
      subempresa: 'GMP',
      ejercicio: 2026,
      serie: 'S',
      terminal: 10,
      numero: 404,
    },
    financialDocumentState: 'AVAILABLE',
    financialDocument: {
      tipo: 'FRA',
      origen: 'C',
      subempresa: 'GMP',
      ejercicio: 2026,
      serie: 'S',
      terminal: 10,
      numero: 404,
      xde: 3,
      dex: 7,
    },
    importePendiente: 100,
    importeTotal: 100,
    lineas: [
      {
        lineaId: '1',
        codigoArticulo: 'ART-1',
        descripcion: 'ARTICULO REAL 1',
        cantidadPedida: 4,
        precioUnitario: 20,
      },
      {
        lineaId: '2',
        codigoArticulo: 'ART-2',
        descripcion: 'ARTICULO REAL 2',
        cantidadPedida: 2,
        precioUnitario: 10,
      },
    ],
    ...overrides,
  };
}

function command(overrides = {}) {
  const delivery = {
    itemId: '2026-S-10-404-4300009479',
    status: 'ENTREGADO',
    occurredAt: '2026-08-03T11:30:00.000Z',
    repartidorId: '94',
    receiver: { nombre: 'Ana', apellidos: 'Lopez Ruiz', dni: '12345678Z' },
    firma: 'signature-404',
    evidencias: ['photo-404'],
    observaciones: 'Entrega comprobada',
    lineas: [
      {
        lineaId: '1', codigoArticulo: 'ART-1', cantidadPedida: 4,
        cantidadEntregada: 4, cantidadRechazada: 0, cantidadPendiente: 0,
        motivoDiferencia: null,
      },
      {
        lineaId: '2', codigoArticulo: 'ART-2', cantidadPedida: 2,
        cantidadEntregada: 2, cantidadRechazada: 0, cantidadPendiente: 0,
        motivoDiferencia: null,
      },
    ],
    ...(overrides.delivery || {}),
  };
  return {
    idempotencyKey: 'delivery-2026-S-10-404-service',
    actor: { userId: 'V94', repartidorId: '94', role: 'REPARTIDOR' },
    delivery,
    ...(overrides.cobro === undefined ? {} : { cobro: overrides.cobro }),
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) =>
      !['delivery', 'cobro'].includes(key)
    )),
  };
}

function payment(overrides = {}) {
  return {
    entregaId: '2026-S-10-404-4300009479',
    importeCobrado: 84.5,
    formaPago: 'EFECTIVO',
    ...overrides,
  };
}
function persistedResult(overrides = {}) {
  return {
    confirmationId: '1',
    deliveryStatus: 'ENTREGADO',
    cobroId: null,
    confirmedAt: '2026-08-03T12:00:00.000Z',
    created: true,
    idempotent: false,
    ...overrides,
  };
}

function createFakeRepository({ planned = plannedDelivery(), seededReplay } = {}) {
  let state = {
    planned,
    confirmations: new Map(),
    idempotency: new Map(seededReplay ? [[seededReplay.idempotencyKey, {
      fingerprint: seededReplay.fingerprint,
      result: structuredClone(seededReplay.result),
    }]] : []),
    lines: new Map(),
    evidenceLinks: new Map(),
    cobros: [],
    events: [],
    nextConfirmationId: 1,
    nextCobroId: 91,
  };
  let transactionTail = Promise.resolve();
  let failCobro = false;
  const evidence = new Map([
    ['signature-404', { documentId: planned.documentId, repartidorId: '94', kind: 'FIRMA' }],
    ['photo-404', { documentId: planned.documentId, repartidorId: '94', kind: 'FOTO' }],
    ['foreign-photo', { documentId: 'OTHER', repartidorId: '95', kind: 'FOTO' }],
  ]);

  function txFor(draft) {
    return {
      async getByIdempotencyKey(key) {
        return draft.idempotency.get(key) || null;
      },
      async getByDocumentId(documentId) {
        return draft.confirmations.get(documentId) || null;
      },
      async getPlannedDelivery(documentId) {
        return draft.planned.documentId === documentId ? draft.planned : null;
      },
      async assertEvidenceOwnership(requirements, owner) {
        for (const { evidenceId, expectedKind } of requirements) {
          const row = evidence.get(evidenceId);
          if (!row || row.documentId !== owner.documentId || row.repartidorId !== owner.repartidorId) {
            const error = new Error('Evidence ownership failed');
            error.code = 'EVIDENCE_OWNERSHIP_REQUIRED';
            error.statusCode = 403;
            throw error;
          }
          if (row.kind !== expectedKind) {
            const error = new Error('Evidence kind failed');
            error.code = 'EVIDENCE_KIND_MISMATCH';
            error.statusCode = 422;
            throw error;
          }
        }
      },
      async insertConfirmation(record) {
        const id = draft.nextConfirmationId++;
        draft.events.push('confirmation');
        draft.confirmations.set(record.documentId, { id, ...structuredClone(record) });
        return id;
      },
      async insertLines(confirmationId, lines) {
        draft.events.push('lines');
        draft.lines.set(String(confirmationId), structuredClone(lines));
      },
      async linkEvidence(confirmationId, ids) {
        draft.events.push('evidence');
        draft.evidenceLinks.set(String(confirmationId), [...ids]);
      },
      async insertCobro(row) {
        draft.events.push('cobro');
        if (failCobro) throw new Error('simulated cobro persistence failure');
        const id = draft.nextCobroId++;
        draft.cobros.push({ id, ...structuredClone(row) });
        return Object.freeze({ id, created: true });
      },
      async insertIdempotencyRecord(row) {
        draft.events.push('idempotency');
        draft.idempotency.set(row.idempotencyKey, structuredClone(row));
      },
    };
  }

  return {
    async withTransaction(work) {
      let release;
      const currentGate = new Promise((resolve) => { release = resolve; });
      const previous = transactionTail;
      transactionTail = previous.then(() => currentGate);
      await previous;
      const draft = structuredClone(state);
      try {
        const result = await work(txFor(draft));
        state = draft;
        return result;
      } finally {
        release();
      }
    },
    snapshot() {
      return structuredClone(state);
    },
    setFailCobro(value) {
      failCobro = value;
    },
  };
}

describe('transactional reparto confirmation service', () => {
  const fixedNow = () => new Date('2026-08-03T12:00:00.000Z');

  test('persists an unpaid delivery with server-planned and actual structured quantities', async () => {
    const repository = createFakeRepository();
    const service = createRepartoConfirmationService({ repository, now: fixedNow });

    const result = await service.confirm(command());
    const snapshot = repository.snapshot();
    const persisted = snapshot.confirmations.get('2026-S-10-404-4300009479');

    expect(result).toMatchObject({
      created: true,
      idempotent: false,
      deliveryStatus: 'ENTREGADO',
      cobroId: null,
      confirmedAt: '2026-08-03T12:00:00.000Z',
    });
    expect(persisted).toMatchObject({
      cliente: { codigo: '4300009479', nombre: 'CLIENTE REAL' },
      receiver: { nombre: 'Ana', apellidos: 'Lopez Ruiz', dni: '12345678Z' },
      firmaEvidenceId: 'signature-404',
    });
    expect(snapshot.lines.get('1')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        descripcion: 'ARTICULO REAL 1',
        cantidadPedida: 4,
        cantidadEntregada: 4,
      }),
    ]));
    expect(snapshot.cobros).toHaveLength(0);
    expect(snapshot.events).toEqual(['confirmation', 'lines', 'evidence', 'idempotency']);
  });

  test('rejects an unpaid confirmation when the planned delivery requires collection', async () => {
    const repository = createFakeRepository({ planned: plannedDelivery({ cobroObligatorio: true }) });
    const service = createRepartoConfirmationService({ repository, now: fixedNow });

    await expect(service.confirm(command())).rejects.toMatchObject({
      code: 'PAYMENT_REQUIRED',
      statusCode: 422,
    });
    expect(repository.snapshot().confirmations.size).toBe(0);
    expect(repository.snapshot().cobros).toHaveLength(0);
  });

  test('confirms a prepaid zero-importe delivery with no planned lines', async () => {
    const repository = createFakeRepository({
      planned: plannedDelivery({
        importeTotal: 0,
        importePendiente: 0,
        lineas: [],
        financialDocumentState: 'MISSING',
        financialDocument: null,
      }),
    });
    const service = createRepartoConfirmationService({ repository, now: fixedNow });

    const result = await service.confirm(command({ delivery: { lineas: [] } }));
    expect(result).toMatchObject({ created: true, deliveryStatus: 'ENTREGADO' });
    expect(result).not.toHaveProperty('receiptProof');
    expect(repository.snapshot().idempotency.get(command().idempotencyKey).result.receiptProof).toEqual({
      plannedImporteTotal: 0, plannedLineCount: 0, actualLineCount: 0,
      prepaidZeroWithoutLines: true,
    });
    expect(repository.snapshot().lines.get('1')).toEqual([]);
  });


  test('uses only basic planned identity with null XDE/DEX when an unpaid delivery has no financial document', async () => {
    const source = plannedDelivery();
    const basicDocument = {
      ...source.document,
      tipo: 'CAC',
      origen: 'B',
    };
    const repository = createFakeRepository({
      planned: plannedDelivery({
        document: basicDocument,
        financialDocumentState: 'MISSING',
        financialDocument: null,
      }),
    });
    const service = createRepartoConfirmationService({ repository, now: fixedNow });

    await service.confirm(command());

    expect(repository.snapshot().confirmations.get(source.documentId).albaran).toEqual({
      ...basicDocument,
      xde: null,
      dex: null,
    });
  });
  test('persists the exact planned financial identity for payment and receipt snapshot', async () => {
    const source = plannedDelivery();
    const financialDocument = {
      ...source.financialDocument,
      tipo: 'FRA',
      origen: 'C',
      subempresa: 'FIN',
      ejercicio: 2027,
      serie: 'Z',
      terminal: 23,
      numero: 7654321,
      xde: 37,
      dex: 73,
    };
    const repository = createFakeRepository({
      planned: plannedDelivery({
        document: {
          ...source.document,
          tipo: 'CAC', origen: 'B', subempresa: 'BASIC', xde: 999, dex: 999,
        },
        financialDocument,
      }),
    });
    const service = createRepartoConfirmationService({ repository, now: fixedNow });

    const result = await service.confirm(command({ cobro: payment() }));
    const snapshot = repository.snapshot();
    const persisted = snapshot.confirmations.get('2026-S-10-404-4300009479');

    expect(result.cobroId).toBe('91');
    expect(snapshot.cobros).toHaveLength(1);
    expect(snapshot.cobros[0]).toMatchObject({
      codigoCliente: '4300009479',
      nombreCliente: 'CLIENTE REAL',
      importeCobrado: 84.5,
      importePendiente: 15.5,
      codigoRepartidor: '94',
      tipoDocumento: 'FRA',
      origenDocumento: 'C',
      subempresaDocumento: 'FIN',
      ejercicioDocumento: 2027,
      serieDocumento: 'Z',
      terminalDocumento: 23,
      numeroDocumento: 7654321,
      xdeDocumento: 37,
      dexDocumento: 73,
    });
    expect(persisted.albaran).toEqual(financialDocument);
    expect(snapshot.events).toEqual([
      'confirmation', 'lines', 'evidence', 'cobro', 'idempotency',
    ]);
  });

  test.each([
    ['null result', null],
    ['empty object', {}],
    ['invalid confirmation id', persistedResult({ confirmationId: '0', cobroId: '91' })],
    ['invalid cobro id', persistedResult({ cobroId: '[object Object]' })],
    ['invalid delivery status', persistedResult({ deliveryStatus: 'UNKNOWN', cobroId: '91' })],
    ['invalid confirmation timestamp', persistedResult({ confirmedAt: '03/08/2026', cobroId: '91' })],
  ])('fails 503 without writes when persisted replay has %s', async (_case, storedResult) => {
    const input = command({ cobro: payment() });
    const repository = createFakeRepository({
      seededReplay: {
        idempotencyKey: input.idempotencyKey,
        fingerprint: confirmationFingerprint(input),
        result: storedResult,
      },
    });
    const service = createRepartoConfirmationService({ repository, now: fixedNow });

    await expect(service.confirm(input)).rejects.toMatchObject({
      code: 'REPARTO_CONFIRMATION_REPLAY_UNAVAILABLE',
      statusCode: 503,
    });
    const snapshot = repository.snapshot();
    expect(snapshot.events).toEqual([]);
    expect(snapshot.confirmations.size).toBe(0);
    expect(snapshot.cobros).toHaveLength(0);
  });

  test.each([
    ['missing', (() => {
      const result = persistedResult({ cobroId: '91' });
      delete result.cobroId;
      return result;
    })()],
    ['null', persistedResult({ cobroId: null })],
  ])('fails 503 without writes when paid replay cobroId is %s', async (_case, storedResult) => {
    const input = command({ cobro: payment() });
    const repository = createFakeRepository({
      seededReplay: {
        idempotencyKey: input.idempotencyKey,
        fingerprint: confirmationFingerprint(input),
        result: storedResult,
      },
    });
    const service = createRepartoConfirmationService({ repository, now: fixedNow });

    await expect(service.confirm(input)).rejects.toMatchObject({
      code: 'REPARTO_CONFIRMATION_REPLAY_UNAVAILABLE',
      statusCode: 503,
    });
    const snapshot = repository.snapshot();
    expect(snapshot.events).toEqual([]);
    expect(snapshot.confirmations.size).toBe(0);
    expect(snapshot.cobros).toHaveLength(0);
  });

  test('accepts a paid replay with a positive safe cobroId', async () => {
    const input = command({ cobro: payment() });
    const storedResult = persistedResult({ cobroId: 91 });
    const repository = createFakeRepository({
      seededReplay: {
        idempotencyKey: input.idempotencyKey,
        fingerprint: confirmationFingerprint(input),
        result: storedResult,
      },
    });
    const service = createRepartoConfirmationService({ repository, now: fixedNow });

    await expect(service.confirm(input)).resolves.toEqual({
      confirmationId: '1',
      deliveryStatus: 'ENTREGADO',
      cobroId: '91',
      confirmedAt: '2026-08-03T12:00:00.000Z',
      created: false,
      idempotent: true,
    });
    const snapshot = repository.snapshot();
    expect(snapshot.events).toEqual([]);
    expect(snapshot.confirmations.size).toBe(0);
    expect(snapshot.cobros).toHaveLength(0);
  });

  test('fails 503 without writes when an unpaid replay contains a cobroId', async () => {
    const input = command();
    const repository = createFakeRepository({
      seededReplay: {
        idempotencyKey: input.idempotencyKey,
        fingerprint: confirmationFingerprint(input),
        result: persistedResult({ cobroId: '91' }),
      },
    });
    const service = createRepartoConfirmationService({ repository, now: fixedNow });

    await expect(service.confirm(input)).rejects.toMatchObject({
      code: 'REPARTO_CONFIRMATION_REPLAY_UNAVAILABLE',
      statusCode: 503,
    });
    const snapshot = repository.snapshot();
    expect(snapshot.events).toEqual([]);
    expect(snapshot.confirmations.size).toBe(0);
    expect(snapshot.cobros).toHaveLength(0);
  });

  test('returns an exact replay without duplicate delivery, lines, evidence or payment', async () => {
    const repository = createFakeRepository();
    const service = createRepartoConfirmationService({ repository, now: fixedNow });
    const input = command({ cobro: payment() });

    const first = await service.confirm(input);
    const replay = await service.confirm(structuredClone(input));
    const snapshot = repository.snapshot();

    expect(first.created).toBe(true);
    expect(replay).toEqual({ ...first, created: false, idempotent: true });
    expect(snapshot.confirmations.size).toBe(1);
    expect(snapshot.cobros).toHaveLength(1);
    expect(snapshot.events.filter((event) => event === 'confirmation')).toHaveLength(1);
  });

  test('rejects the same key with changed quantities using a stable fingerprint', async () => {
    const repository = createFakeRepository();
    const service = createRepartoConfirmationService({ repository, now: fixedNow });
    await service.confirm(command());

    const changed = command({
      delivery: {
        status: 'PARCIAL',
        lineas: [
          {
            lineaId: '1', codigoArticulo: 'ART-1', cantidadPedida: 4,
            cantidadEntregada: 3, cantidadRechazada: 0, cantidadPendiente: 1,
            motivoDiferencia: 'PRODUCTO_FALTANTE',
          },
          {
            lineaId: '2', codigoArticulo: 'ART-2', cantidadPedida: 2,
            cantidadEntregada: 2, cantidadRechazada: 0, cantidadPendiente: 0,
            motivoDiferencia: null,
          },
        ],
      },
    });

    await expect(service.confirm(changed)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      statusCode: 409,
    });
    expect(repository.snapshot().confirmations.size).toBe(1);
  });

  test('rejects another key for an already confirmed document', async () => {
    const repository = createFakeRepository();
    const service = createRepartoConfirmationService({ repository, now: fixedNow });
    await service.confirm(command());

    await expect(service.confirm(command({
      idempotencyKey: 'delivery-2026-S-10-404-other-key',
    }))).rejects.toMatchObject({ code: 'DELIVERY_ALREADY_CONFIRMED' });
  });

  test('rolls back every delivery write when payment persistence fails and permits safe retry', async () => {
    const repository = createFakeRepository();
    const service = createRepartoConfirmationService({ repository, now: fixedNow });
    const input = command({ cobro: payment() });
    repository.setFailCobro(true);

    await expect(service.confirm(input)).rejects.toThrow('simulated cobro persistence failure');
    expect(repository.snapshot().confirmations.size).toBe(0);
    expect(repository.snapshot().cobros).toEqual([]);
    expect(repository.snapshot().events).toEqual([]);

    repository.setFailCobro(false);
    await expect(service.confirm(input)).resolves.toMatchObject({ created: true, cobroId: '91' });
    expect(repository.snapshot().confirmations.size).toBe(1);
  });

  test('rejects forged planned quantities before any write', async () => {
    const repository = createFakeRepository();
    const service = createRepartoConfirmationService({ repository, now: fixedNow });
    const input = command({
      delivery: {
        lineas: [
          {
            lineaId: '1', codigoArticulo: 'ART-1', cantidadPedida: 99,
            cantidadEntregada: 99, cantidadRechazada: 0, cantidadPendiente: 0,
            motivoDiferencia: null,
          },
          command().delivery.lineas[1],
        ],
      },
    });

    await expect(service.confirm(input)).rejects.toMatchObject({
      code: 'PLANNED_QUANTITY_MISMATCH',
      statusCode: 422,
    });
    expect(repository.snapshot().events).toEqual([]);
  });

  test('rejects evidence owned by another delivery/repartidor before writes', async () => {
    const repository = createFakeRepository();
    const service = createRepartoConfirmationService({ repository, now: fixedNow });

    await expect(service.confirm(command({
      delivery: { evidencias: ['foreign-photo'] },
    }))).rejects.toMatchObject({
      code: 'EVIDENCE_OWNERSHIP_REQUIRED',
      statusCode: 403,
    });
    expect(repository.snapshot().events).toEqual([]);
  });

  test('rejects signature/photo cross-kind reuse before writes', async () => {
    const repository = createFakeRepository();
    const service = createRepartoConfirmationService({ repository, now: fixedNow });

    await expect(service.confirm(command({
      delivery: { firma: 'photo-404', evidencias: ['signature-404'] },
    }))).rejects.toMatchObject({ code: 'EVIDENCE_KIND_MISMATCH', statusCode: 422 });
    expect(repository.snapshot().events).toEqual([]);
  });

  test('limits partial payment to the value of quantities actually delivered', async () => {
    const repository = createFakeRepository();
    const service = createRepartoConfirmationService({ repository, now: fixedNow });
    const partial = command({
      delivery: {
        status: 'PARCIAL',
        lineas: [
          {
            lineaId: '1', codigoArticulo: 'ART-1', cantidadPedida: 4,
            cantidadEntregada: 1, cantidadRechazada: 0, cantidadPendiente: 3,
            motivoDiferencia: 'PRODUCTO_FALTANTE',
          },
          {
            lineaId: '2', codigoArticulo: 'ART-2', cantidadPedida: 2,
            cantidadEntregada: 0, cantidadRechazada: 0, cantidadPendiente: 2,
            motivoDiferencia: 'PRODUCTO_FALTANTE',
          },
        ],
      },
      cobro: payment({ importeCobrado: 25 }),
    });

    await expect(service.confirm(partial)).rejects.toMatchObject({
      code: 'INVALID_PAYMENT_AMOUNT',
      details: { maxCollectable: 20 },
    });
    expect(repository.snapshot().events).toEqual([]);
  });

  test.each(['MISSING', 'AMBIGUOUS'])(
    'rejects payment before writes when the financial document is %s',
    async (financialDocumentState) => {
      const repository = createFakeRepository({
        planned: plannedDelivery({ financialDocumentState, financialDocument: null }),
      });
      const service = createRepartoConfirmationService({ repository, now: fixedNow });

      await expect(service.confirm(command({ cobro: payment() }))).rejects.toMatchObject({
        code: 'PAYMENT_DOCUMENT_UNAVAILABLE', statusCode: 409,
      });
      expect(repository.snapshot().events).toEqual([]);
    },
  );

  test('rejects quantity or weight with an ERP price still pending before writes', async () => {
    const repository = createFakeRepository({
      planned: plannedDelivery({
        pricingState: 'PENDING_PRICE',
        amountSource: 'ERP_PRICE_PENDING',
        importePendiente: 0,
        importeTotal: 0,
        lineas: [{
          lineaId: '1', codigoArticulo: 'ART-1', cantidadPedida: 4, precioUnitario: 0,
        }],
      }),
    });
    const service = createRepartoConfirmationService({ repository, now: fixedNow });

    await expect(service.confirm(command({ delivery: { lineas: [command().delivery.lineas[0]] } }))).rejects.toMatchObject({
      code: 'DELIVERY_PRICING_PENDING', statusCode: 409,
      details: { amountSource: 'ERP_PRICE_PENDING', pricingState: 'PENDING_PRICE' },
    });
    expect(repository.snapshot().events).toEqual([]);
  });


  test('rejects a paid confirmation when the planned financial identity is incomplete', async () => {
    const source = plannedDelivery();
    const repository = createFakeRepository({
      planned: plannedDelivery({
        financialDocument: {
          ...source.financialDocument,
          dex: undefined,
        },
      }),
    });
    const service = createRepartoConfirmationService({ repository, now: fixedNow });

    await expect(service.confirm(command({ cobro: payment() }))).rejects.toMatchObject({
      code: 'PAYMENT_DOCUMENT_UNAVAILABLE',
      statusCode: 409,
    });
    expect(repository.snapshot().events).toEqual([]);
  });
  test('serializes concurrent exact submissions into one create and one replay', async () => {
    const repository = createFakeRepository();
    const service = createRepartoConfirmationService({ repository, now: fixedNow });
    const input = command({ cobro: payment() });

    const results = await Promise.all([
      service.confirm(structuredClone(input)),
      service.confirm(structuredClone(input)),
    ]);

    expect(results.map((item) => item.created).sort()).toEqual([false, true]);
    expect(repository.snapshot().confirmations.size).toBe(1);
    expect(repository.snapshot().cobros).toHaveLength(1);
  });

  test('fingerprint is deterministic across object key order but not material changes', () => {
    const input = command({ cobro: payment() });
    const reordered = {
      cobro: { ...input.cobro },
      delivery: { ...input.delivery },
      actor: { ...input.actor },
      idempotencyKey: input.idempotencyKey,
    };
    const changed = structuredClone(input);
    changed.cobro.importeCobrado = 80;

    expect(confirmationFingerprint(input)).toBe(confirmationFingerprint(reordered));
    expect(confirmationFingerprint(input)).not.toBe(confirmationFingerprint(changed));
  });
});
