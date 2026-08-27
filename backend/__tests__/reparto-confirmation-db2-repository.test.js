'use strict';

const fs = require('fs');
const path = require('path');
const {
  DB2_WRITE_BATCH_SIZE,
  QUALIFIED_TABLES,
  REQUIRED_COLUMNS,
  RepartoRepositoryUnavailableError,
  createRepartoConfirmationDb2Repository,
  TABLES,
} = require('../repositories/reparto-confirmation-db2-repository');
const { TABLE_MAPPINGS } = require('../config/reparto-runtime');

function mappedTableNames(tables = QUALIFIED_TABLES) {
  return Object.fromEntries(
    Object.entries(tables).map(([key, identifier]) => [key, identifier.split('.')[1]]),
  );
}

function catalogRows(tables = QUALIFIED_TABLES) {
  return Object.values(mappedTableNames(tables)).map((TABLE_NAME) => ({ TABLE_NAME }));
}

function columnRows({
  tables = QUALIFIED_TABLES,
  receiverNameLength = 100,
  receiverNameDataType = 'VARCHAR',
} = {}) {
  return Object.entries(mappedTableNames(tables)).flatMap(([key, TABLE_NAME]) =>
    REQUIRED_COLUMNS[TABLES[key]].map((COLUMN_NAME) => ({
      TABLE_NAME,
      COLUMN_NAME,
      ...(key === 'confirmations' && COLUMN_NAME === 'RECEPTOR_NOMBRE'
        ? { DATA_TYPE: receiverNameDataType, LENGTH: receiverNameLength }
        : {}),
    })));
}

function duplicateKeyError() {
  const error = new Error('duplicate key');
  error.state = '23505';
  return error;
}

function fakeConnection({
  missingTable, missingColumn, replay, rawReplay, replayAfterFirstLookup = false, prior, catalogError, uniqueFailures = 0, queryOnly = false,
  transactionMethods = true, commitError, rollbackError, closeError, failWriteAt, cobrosCapabilityError,
  receiverNameLength = 100, receiverNameDataType = 'VARCHAR',
  tables = QUALIFIED_TABLES,
} = {}) {
  const calls = [];
  let closed = false;
  let transactionActive = false;
  let attemptedWrites = 0;
  let stagedWrites = [];
  let persistedWrites = [];
  let idempotencyLookups = 0;
  let stagedEvidenceStatus = null;
  let persistedEvidenceStatus = 'PENDIENTE';

  function writeTarget(sql) {
    return Object.values(TABLES).find((table) => sql.includes(`.${table}`))
      || (sql.includes('.TEST_REPARTIDOR_COBROS') ? 'TEST_REPARTIDOR_COBROS' : 'UNKNOWN');
  }

  async function dispatch(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('QSYS2.SYSTABLES')) {
      if (catalogError) throw Object.assign(new Error('catalog failed'), { code: catalogError });
      return catalogRows(tables).filter((row) => row.TABLE_NAME !== missingTable);
    }
    if (sql.includes('QSYS2.SYSCOLUMNS')) {
      return columnRows({ tables, receiverNameLength, receiverNameDataType })
        .filter((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}` !== missingColumn);
    }
    if (sql.includes('WHERE IDEMPOTENCY_KEY = ?')) {
      idempotencyLookups += 1;
      const hasReplay = replay !== undefined || rawReplay !== undefined;
      return hasReplay && (!replayAfterFirstLookup || idempotencyLookups > 1)
        ? [{ PAYLOAD_FINGERPRINT: 'a'.repeat(64), RESULT_JSON: rawReplay !== undefined ? rawReplay : JSON.stringify(replay) }]
        : [];
    }
    if (sql.includes('WHERE DOCUMENT_ID = ?')) return prior ? [{ ID: 10 }] : [];
    if (sql.startsWith('INSERT INTO JAVIER.TEST_REPARTO_CONFIRMACIONES') && uniqueFailures > 0) {
      uniqueFailures -= 1;
      throw duplicateKeyError();
    }
    if (sql.includes('IDENTITY_VAL_LOCAL')) return [{ ID: 88 }];
    if (/^(INSERT|UPDATE) /.test(sql)) {
      attemptedWrites += 1;
      const target = writeTarget(sql);
      if (transactionActive) stagedWrites.push(target);
      else persistedWrites.push(target);
      if (target === TABLES.evidences && sql.startsWith('UPDATE')) {
        if (transactionActive) stagedEvidenceStatus = 'ENLAZADA';
        else persistedEvidenceStatus = 'ENLAZADA';
      }
      if (failWriteAt === attemptedWrites) throw new Error('simulated batch write failure');
    }
    return [];
  }
  const connection = queryOnly ? { query: dispatch } : { execute: dispatch };
  if (transactionMethods) {
    connection.beginTransaction = async () => {
      calls.push({ sql: 'BEGIN_TRANSACTION', params: [] });
      transactionActive = true;
      stagedWrites = [];
      stagedEvidenceStatus = null;
    };
    connection.commit = async () => {
      calls.push({ sql: 'COMMIT_TRANSACTION', params: [] });
      if (commitError) throw commitError;
      persistedWrites.push(...stagedWrites);
      if (stagedEvidenceStatus) persistedEvidenceStatus = stagedEvidenceStatus;
      stagedWrites = [];
      stagedEvidenceStatus = null;
      transactionActive = false;
    };
    connection.rollback = async () => {
      calls.push({ sql: 'ROLLBACK_TRANSACTION', params: [] });
      if (rollbackError) throw rollbackError;
      stagedWrites = [];
      stagedEvidenceStatus = null;
      transactionActive = false;
    };
  }
  connection.close = async () => {
    closed = true;
    if (closeError) throw closeError;
  };
  return {
    connection,
    calls,
    isClosed: () => closed,
    persistedWrites: () => persistedWrites.length,
    persistedTargets: () => [...persistedWrites],
    evidenceStatus: () => persistedEvidenceStatus,
    cobrosCapabilityError,
  };
}

function repository(factory, tables = QUALIFIED_TABLES) {
  const plannedBound = { getPlannedDelivery: jest.fn(async () => ({ documentId: 'doc-1' })) };
  const evidenceBound = {
    assertOwnership: jest.fn(async () => undefined),
    markLinked: jest.fn(async (ids) => {
      const run = factory.connection.query || factory.connection.execute;
      return run.call(factory.connection,
        "UPDATE JAVIER.TEST_REPARTO_EVIDENCIAS SET STATUS = 'ENLAZADA' WHERE EVIDENCE_ID IN (?)",
        ids);
    }),
  };
  const plannedDeliveryPort = {
    getPlannedDelivery: jest.fn(),
    forConnection: jest.fn(() => plannedBound),
  };
  const evidenceOwnershipPort = {
    assertOwnership: jest.fn(),
    forConnection: jest.fn(() => evidenceBound),
  };
  const cobrosBound = {
    insertCobro: jest.fn(async (payment) => {
      const run = factory.connection.query || factory.connection.execute;
      await run.call(factory.connection,
        'INSERT INTO JAVIER.TEST_REPARTIDOR_COBROS (IDEMPOTENCY_TOKEN) VALUES (?)',
        [payment.idempotencyToken]);
      return 91;
    }),
  };
  const cobrosPort = {
    assertCapabilities: jest.fn(async () => {
      if (factory.cobrosCapabilityError) throw factory.cobrosCapabilityError;
    }),
    forConnection: jest.fn(() => cobrosBound),
  };
  factory.ports = {
    plannedDeliveryPort, evidenceOwnershipPort, cobrosPort, plannedBound, evidenceBound, cobrosBound,
  };
  factory.logger = { error: jest.fn(), warn: jest.fn() };
  return createRepartoConfirmationDb2Repository({
    tables,
    connectionFactory: async () => factory.connection,
    plannedDeliveryPort,
    evidenceOwnershipPort,
    cobrosPort,
    logger: factory.logger,
  });
}

function lines(count) {
  return Array.from({ length: count }, (_, index) => ({
    lineaId: `L${index + 1}`,
    codigoArticulo: `A${index + 1}`,
    descripcion: 'Articulo',
    cantidadPedida: 2,
    cantidadEntregada: 1,
    cantidadRechazada: 0,
    cantidadPendiente: 1,
    motivoDiferencia: 'PRODUCTO_FALTANTE',
    observaciones: null,
    precioUnitario: 3.25,
  }));
}

function evidenceIds(count) {
  return Array.from({ length: count }, (_, index) => `evidence-${index + 1}`);
}

function confirmationRecord() {
  return {
    idempotencyKey: 'idem-12345678', fingerprint: 'a'.repeat(64), documentId: 'doc-1',
    repartidorId: '17', actorUserId: '17', cliente: { codigo: 'C1', nombre: 'Cliente' },
    pedido: { ejercicio: 2026, numero: 7 },
    albaran: {
      tipo: 'FRA', origen: 'C', subempresa: 'FIN', ejercicio: 2027, serie: 'Z', terminal: 23, numero: 7654321, xde: 37, dex: 73,
    },
    status: 'PARCIAL', occurredAt: '2026-08-03T08:00:00.000Z', confirmedAt: '2026-08-03T08:01:00.000Z',
    receiver: { nombre: 'Ana', apellidos: 'Prueba', dni: '12345678Z' }, firmaEvidenceId: 'sig-1',
    incidencia: { tipo: 'PRODUCTO_DANADO', motivo: 'Envase roto', observaciones: 'Foto adjunta' },
    observaciones: 'Parcial', latitud: 40.4, longitud: -3.7,
  };
}

describe('DB2 reparto confirmation repository', () => {
  test('checks QSYS2 before beginning once, then commits and closes', async () => {
    const factory = fakeConnection();
    const repo = repository(factory);

    const result = await repo.withTransaction(async (tx) => {
      expect(await tx.getByIdempotencyKey('safe-key')).toBeNull();
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(factory.calls.map((call) => call.sql)).toEqual(expect.arrayContaining([
      expect.stringContaining('QSYS2.SYSTABLES'),
      expect.stringContaining('QSYS2.SYSCOLUMNS'),
      'BEGIN_TRANSACTION',
      'COMMIT_TRANSACTION',
    ]));
    expect(factory.calls.findIndex((call) => call.sql === 'BEGIN_TRANSACTION')).toBeGreaterThan(
      factory.calls.findIndex((call) => call.sql.includes('QSYS2.SYSCOLUMNS')),
    );
    expect(factory.calls.find((call) => call.sql.includes('QSYS2.SYSCOLUMNS')).sql)
      .toContain('DATA_TYPE, LENGTH');
    expect(factory.calls.filter((call) => call.sql === 'BEGIN_TRANSACTION')).toHaveLength(1);
    expect(factory.isClosed()).toBe(true);
  });

  test('returns the committed confirmation when connection close fails', async () => {
    const factory = fakeConnection({
      closeError: Object.assign(new Error('socket already closed'), { code: '08003' }),
    });

    await expect(repository(factory).withTransaction(async (tx) => {
      await tx.insertConfirmation(confirmationRecord());
      return 'committed';
    })).resolves.toBe('committed');

    expect(factory.calls.map((call) => call.sql)).toContain('COMMIT_TRANSACTION');
    expect(factory.persistedWrites()).toBe(1);
    expect(factory.isClosed()).toBe(true);
    expect(factory.logger.warn).toHaveBeenCalledWith(
      'reparto confirmation connection close failed',
      { code: '08003' },
    );
  });

  test('keeps the primary write error when rollback and close also fail', async () => {
    const factory = fakeConnection({
      failWriteAt: 1,
      rollbackError: Object.assign(new Error('rollback transport failed'), { code: 'HYT00' }),
      closeError: Object.assign(new Error('close transport failed'), { code: '08003' }),
    });

    await expect(repository(factory).withTransaction((tx) =>
      tx.insertConfirmation(confirmationRecord())))
      .rejects.toMatchObject({
        code: 'REPARTO_DB2_PERSISTENCE_FAILED',
        statusCode: 503,
      });

    expect(factory.calls.map((call) => call.sql)).toEqual(expect.arrayContaining([
      'BEGIN_TRANSACTION', 'ROLLBACK_TRANSACTION',
    ]));
    expect(factory.calls.map((call) => call.sql)).not.toContain('COMMIT_TRANSACTION');
    expect(factory.isClosed()).toBe(true);
    expect(factory.logger.error).toHaveBeenCalledWith(
      'reparto confirmation rollback failed',
      { code: 'HYT00' },
    );
  });

  test('fails closed before any transaction when a table or column is absent', async () => {
    const missingTable = fakeConnection({ missingTable: 'TEST_REPARTO_LINEAS' });
    await expect(repository(missingTable).withTransaction(async () => 'never')).rejects.toBeInstanceOf(RepartoRepositoryUnavailableError);
    expect(missingTable.calls.some((call) => call.sql === 'BEGIN_TRANSACTION')).toBe(false);
    expect(missingTable.isClosed()).toBe(true);

    const missingColumn = fakeConnection({ missingColumn: 'TEST_REPARTO_CONFIRMACIONES.STATUS' });
    await expect(repository(missingColumn).withTransaction(async () => 'never')).rejects.toMatchObject({ statusCode: 503 });
    expect(missingColumn.calls.some((call) => call.sql === 'BEGIN_TRANSACTION')).toBe(false);

    for (const column of ['DOCUMENTO_XDE', 'DOCUMENTO_DEX']) {
      const missingFinancialIdentity = fakeConnection({
        missingColumn: `TEST_REPARTO_CONFIRMACIONES.${column}`,
      });
      await expect(repository(missingFinancialIdentity).withTransaction(async () => 'never'))
        .rejects.toMatchObject({ statusCode: 503 });
      expect(missingFinancialIdentity.calls.some((call) => call.sql === 'BEGIN_TRANSACTION')).toBe(false);
    }
  });

  test.each([80, 81])('fails closed before BEGIN and DML when RECEPTOR_NOMBRE only has %i characters', async (receiverNameLength) => {
    const factory = fakeConnection({ receiverNameLength });

    await expect(repository(factory).withTransaction(async () => 'never')).rejects.toMatchObject({
      code: 'REPARTO_TEST_SCHEMA_UNAVAILABLE',
      statusCode: 503,
    });
    expect(factory.calls.some((call) => call.sql === 'BEGIN_TRANSACTION')).toBe(false);
    expect(factory.persistedWrites()).toBe(0);
  });

  test('allows the catalog capability check when RECEPTOR_NOMBRE is VARCHAR(100)', async () => {
    const factory = fakeConnection({ receiverNameLength: 100 });

    await expect(repository(factory).withTransaction(async () => 'ok')).resolves.toBe('ok');
    expect(factory.calls.some((call) => call.sql === 'BEGIN_TRANSACTION')).toBe(true);
    expect(factory.persistedWrites()).toBe(0);
  });

  test.each([
    ['CHAR', false],
    ['CHARACTER VARYING', true],
  ])('requires a VARCHAR-compatible receiver name type: %s', async (receiverNameDataType, isCompatible) => {
    const factory = fakeConnection({ receiverNameDataType });
    const operation = repository(factory).withTransaction(async () => 'ok');

    if (isCompatible) {
      await expect(operation).resolves.toBe('ok');
      expect(factory.calls.some((call) => call.sql === 'BEGIN_TRANSACTION')).toBe(true);
    } else {
      await expect(operation).rejects.toMatchObject({
        code: 'REPARTO_TEST_SCHEMA_UNAVAILABLE',
        statusCode: 503,
      });
      expect(factory.calls.some((call) => call.sql === 'BEGIN_TRANSACTION')).toBe(false);
      expect(factory.persistedWrites()).toBe(0);
    }
  });

  describe.each([
    ['isolated_test', TABLE_MAPPINGS.isolated_test.confirmation],
    ['production', TABLE_MAPPINGS.production.confirmation],
  ])('%s receiver-name catalog capability', (_tableSet, tables) => {
    const confirmationTable = mappedTableNames(tables).confirmations;

    test('accepts VARCHAR(100) on the exact mapped confirmation table', async () => {
      const factory = fakeConnection({ tables, receiverNameLength: 100, receiverNameDataType: 'VARCHAR' });

      await expect(repository(factory, tables).withTransaction(async () => 'ok')).resolves.toBe('ok');

      const catalogCall = factory.calls.find((call) => call.sql.includes('QSYS2.SYSCOLUMNS'));
      expect(catalogCall.params).toContain(confirmationTable);
      expect(factory.calls.some((call) => call.sql === 'BEGIN_TRANSACTION')).toBe(true);
      expect(factory.persistedWrites()).toBe(0);
    });

    test.each([
      ['VARCHAR', 99],
      ['CHAR', 100],
    ])('rejects incompatible %s(%i) before BEGIN or DML', async (receiverNameDataType, receiverNameLength) => {
      const factory = fakeConnection({ tables, receiverNameLength, receiverNameDataType });

      await expect(repository(factory, tables).withTransaction(async () => 'never')).rejects.toMatchObject({
        code: 'REPARTO_TEST_SCHEMA_UNAVAILABLE',
        statusCode: 503,
        details: {
          table: confirmationTable,
          column: 'RECEPTOR_NOMBRE',
          minimumLength: 100,
        },
      });
      expect(factory.calls.some((call) => call.sql === 'BEGIN_TRANSACTION')).toBe(false);
      expect(factory.persistedWrites()).toBe(0);
    });
  });

  test('fails closed before BEGIN when the finance cobros capability is absent', async () => {
    const factory = fakeConnection({
      cobrosCapabilityError: Object.assign(new Error('missing unique token capability'), {
        code: 'REPARTO_COBROS_CAPABILITY_UNAVAILABLE', statusCode: 503,
      }),
    });
    await expect(repository(factory).withTransaction(async () => 'never')).rejects.toMatchObject({ statusCode: 503 });
    expect(factory.calls.filter((call) => call.sql === 'BEGIN_TRANSACTION')).toHaveLength(0);
  });

  test('locks idempotency and document checks, returns stored replay without interpolating attacker input', async () => {
    const factory = fakeConnection({ replay: { confirmationId: '88', created: true } });
    const repo = repository(factory);
    const attackerKey = "x' OR 1=1 --";
    const replay = await repo.withTransaction((tx) => tx.getByIdempotencyKey(attackerKey));
    const lookup = factory.calls.find((call) => call.sql.includes('WHERE IDEMPOTENCY_KEY = ?'));

    expect(replay).toEqual({ fingerprint: 'a'.repeat(64), result: { confirmationId: '88', created: true } });
    expect(lookup.sql).toContain('FOR UPDATE WITH RS');
    expect(lookup.sql).not.toContain(attackerKey);
    expect(lookup.params).toEqual([attackerKey]);
  });


  test.each([null, '{invalid-json'])(
    'fails typed 503 without writes when RESULT_JSON is unavailable: %p',
    async (rawReplay) => {
      const factory = fakeConnection({ rawReplay });
      const repo = repository(factory);

      await expect(repo.withTransaction((tx) => tx.getByIdempotencyKey('safe-key')))
        .rejects.toMatchObject({
          code: 'REPARTO_CONFIRMATION_REPLAY_UNAVAILABLE', statusCode: 503,
        });
      expect(factory.persistedWrites()).toBe(0);
    },
  );
  test('rolls back staged confirmation writes after an application error', async () => {
    const factory = fakeConnection();
    const repo = repository(factory);

    await expect(repo.withTransaction(async (tx) => {
      await tx.insertConfirmation(confirmationRecord());
      throw new Error('write failed');
    })).rejects.toMatchObject({ code: 'REPARTO_DB2_PERSISTENCE_FAILED', statusCode: 503 });
    expect(factory.calls.map((call) => call.sql)).toContain('ROLLBACK_TRANSACTION');
    expect(factory.calls.map((call) => call.sql)).not.toContain('COMMIT_TRANSACTION');
    expect(factory.persistedWrites()).toBe(0);
    expect(factory.isClosed()).toBe(true);
  });

  test('rolls back and persists nothing when the driver commit fails', async () => {
    const factory = fakeConnection({ commitError: new Error('commit failed') });
    const repo = repository(factory);

    await expect(repo.withTransaction((tx) => tx.insertConfirmation(confirmationRecord())))
      .rejects.toMatchObject({ code: 'REPARTO_DB2_PERSISTENCE_FAILED', statusCode: 503 });
    expect(factory.calls.map((call) => call.sql)).toEqual(expect.arrayContaining([
      'BEGIN_TRANSACTION', 'COMMIT_TRANSACTION', 'ROLLBACK_TRANSACTION',
    ]));
    expect(factory.persistedWrites()).toBe(0);
  });

  test('fails closed before catalog or writes when explicit transaction methods are absent', async () => {
    const factory = fakeConnection({ transactionMethods: false });
    let callbackCalled = false;

    await expect(repository(factory).withTransaction(async () => {
      callbackCalled = true;
    })).rejects.toMatchObject({ code: 'REPARTO_TEST_SCHEMA_UNAVAILABLE', statusCode: 503 });
    expect(callbackCalled).toBe(false);
    expect(factory.calls).toEqual([]);
    expect(factory.persistedWrites()).toBe(0);
    expect(factory.isClosed()).toBe(true);
  });

  test('wraps catalog errors as a sanitized fail-closed 503', async () => {
    const factory = fakeConnection({ catalogError: 'HYT00' });

    await expect(repository(factory).withTransaction(async () => 'never')).rejects.toMatchObject({
      code: 'REPARTO_TEST_SCHEMA_UNAVAILABLE', statusCode: 503,
    });
    expect(factory.calls.some((call) => call.sql.startsWith('SET TRANSACTION'))).toBe(false);
    expect(factory.isClosed()).toBe(true);
  });

  test('binds planned delivery and evidence ownership to the transaction connection', async () => {
    const factory = fakeConnection();
    const repo = repository(factory);

    await repo.withTransaction(async (tx) => {
      await tx.getPlannedDelivery('doc-1', '17');
      await tx.assertEvidenceOwnership(
        [{ evidenceId: 'sig-1', expectedKind: 'FIRMA' }],
        { documentId: 'doc-1', repartidorId: '17' },
      );
    });

    expect(factory.ports.plannedDeliveryPort.forConnection).toHaveBeenCalledWith(factory.connection);
    expect(factory.ports.evidenceOwnershipPort.forConnection).toHaveBeenCalledWith(factory.connection);
    expect(factory.ports.cobrosPort.forConnection).toHaveBeenCalledWith(factory.connection);
    expect(factory.ports.plannedBound.getPlannedDelivery).toHaveBeenCalledWith('doc-1', '17', undefined);
    expect(factory.ports.evidenceBound.assertOwnership).toHaveBeenCalledWith(
      [{ evidenceId: 'sig-1', expectedKind: 'FIRMA' }],
      { documentId: 'doc-1', repartidorId: '17' },
    );
  });

  test.each([0, 1, DB2_WRITE_BATCH_SIZE, 250])(
    'writes %i lines in bounded set-based batches',
    async (count) => {
      const factory = fakeConnection();
      const repo = repository(factory);

      await repo.withTransaction((tx) => tx.insertLines(88, lines(count)));

      const inserts = factory.calls.filter((call) =>
        call.sql.startsWith('INSERT INTO JAVIER.TEST_REPARTO_LINEAS'));
      expect(inserts).toHaveLength(Math.ceil(count / DB2_WRITE_BATCH_SIZE));
      for (const insert of inserts) {
        expect(insert.params.length).toBeLessThanOrEqual(DB2_WRITE_BATCH_SIZE * 11);
        expect(insert.params.length % 11).toBe(0);
      }
    },
  );

  test.each([0, 1, DB2_WRITE_BATCH_SIZE, 250])(
    'links %i evidences in bounded set-based batches',
    async (count) => {
      const factory = fakeConnection();
      const repo = repository(factory);

      await repo.withTransaction((tx) => tx.linkEvidence(88, evidenceIds(count)));

      const inserts = factory.calls.filter((call) =>
        call.sql.startsWith('INSERT INTO JAVIER.TEST_REPARTO_CONFIRM_EVIDENCIAS'));
      expect(inserts).toHaveLength(Math.ceil(count / DB2_WRITE_BATCH_SIZE));
      for (const insert of inserts) {
        expect(insert.params.length).toBeLessThanOrEqual(DB2_WRITE_BATCH_SIZE * 2);
        expect(insert.params.length % 2).toBe(0);
      }
      expect(factory.ports.evidenceBound.markLinked.mock.calls.map(([ids]) => ids.length))
        .toEqual(inserts.map((insert) => insert.params.length / 2));
    },
  );

  test.each([
    ['lines', 2, (tx) => tx.insertLines(88, lines(250))],
    ['evidence links', 3, (tx) => tx.linkEvidence(88, evidenceIds(250))],
  ])('rolls back every batch when an intermediate %s batch fails', async (_name, failWriteAt, write) => {
    const factory = fakeConnection({ failWriteAt });
    const repo = repository(factory);

    await expect(repo.withTransaction(write)).rejects.toMatchObject({
      code: 'REPARTO_DB2_PERSISTENCE_FAILED', statusCode: 503,
    });
    expect(factory.calls.map((call) => call.sql)).toContain('ROLLBACK_TRANSACTION');
    expect(factory.persistedWrites()).toBe(0);
  });

  test('rolls back confirmation, lines, evidence consumption and cobro while keeping prior BLOB staged', async () => {
    const factory = fakeConnection();
    const repo = repository(factory);
    const previouslyStagedBlobIds = new Set(['sig-1', 'photo-1']);

    await expect(repo.withTransaction(async (tx) => {
      const confirmationId = await tx.insertConfirmation(confirmationRecord());
      await tx.insertLines(confirmationId, lines(1));
      await tx.linkEvidence(confirmationId, [...previouslyStagedBlobIds]);
      await tx.insertCobro({
        confirmationId,
        idempotencyToken: 'idem-12345678',
        entregaId: 'doc-1',
        codigoCliente: 'C1',
        codigoRepartidor: '17',
        importeCobrado: 10,
        importePendiente: 5,
        formaPago: 'EFECTIVO',
        operador: '17',
      });
      throw new Error('post-payment failure');
    })).rejects.toMatchObject({ code: 'REPARTO_DB2_PERSISTENCE_FAILED', statusCode: 503 });

    expect(factory.persistedTargets()).toEqual([]);
    expect(factory.evidenceStatus()).toBe('PENDIENTE');
    expect([...previouslyStagedBlobIds]).toEqual(['sig-1', 'photo-1']);
    expect(factory.ports.evidenceOwnershipPort.forConnection).toHaveBeenCalledWith(factory.connection);
    expect(factory.ports.cobrosPort.forConnection).toHaveBeenCalledWith(factory.connection);
    expect(factory.ports.cobrosBound.insertCobro).toHaveBeenCalledTimes(1);
    expect(factory.calls.filter((call) => call.sql === 'BEGIN_TRANSACTION')).toHaveLength(1);
    expect(factory.calls.map((call) => call.sql)).toContain('ROLLBACK_TRANSACTION');
  });

  test('serializes confirmation timestamps and incidence metadata', async () => {
    const factory = fakeConnection();
    const repo = repository(factory);

    await repo.withTransaction((tx) => tx.insertConfirmation(confirmationRecord()));

    const insert = factory.calls.find((call) =>
      call.sql.startsWith('INSERT INTO JAVIER.TEST_REPARTO_CONFIRMACIONES'));
    expect(insert.sql).toContain('DOCUMENTO_XDE, DOCUMENTO_DEX');
    expect(insert.params.slice(9, 18)).toEqual([
      'FRA', 'C', 'FIN', 2027, 'Z', 23, 7654321, 37, 73,
    ]);
    expect(insert.params[19]).toBe('2026-08-03 08:00:00.000');
    expect(insert.params[20]).toBe('2026-08-03 08:01:00.000');
    expect(insert.params.slice(25, 28)).toEqual([
      'PRODUCTO_DANADO', 'Envase roto', 'Foto adjunta',
    ]);
  });

  test('retries the complete callback once after a unique-key race', async () => {
    const factory = fakeConnection({ uniqueFailures: 1 });
    const repo = repository(factory);
    let attempts = 0;

    const result = await repo.withTransaction(async (tx) => {
      attempts += 1;
      await tx.insertConfirmation(confirmationRecord());
      return 'committed';
    });

    expect(result).toBe('committed');
    expect(attempts).toBe(2);
    expect(factory.calls.filter((call) => call.sql === 'ROLLBACK_TRANSACTION')).toHaveLength(1);
    expect(factory.calls.filter((call) => call.sql === 'COMMIT_TRANSACTION')).toHaveLength(1);
    expect(factory.calls.filter((call) => call.sql === 'BEGIN_TRANSACTION')).toHaveLength(2);

  });
  test('rolls back a DB2 cobro duplicate, re-reads the committed token and returns its exact replay', async () => {
    const expectedReplay = Object.freeze({ confirmationId: '88', cobroId: '91', created: false });
    const factory = fakeConnection({ replay: expectedReplay, replayAfterFirstLookup: true });
    const repo = repository(factory);
    const duplicate = Object.assign(new Error('duplicate idempotency token'), {
      code: 'REPARTO_COBRO_IDEMPOTENCY_RACE',
      statusCode: 409,
      cause: Object.assign(new Error('SQL0803'), { code: 'SQL0803' }),
    });
    factory.ports.cobrosBound.insertCobro.mockRejectedValueOnce(duplicate);
    let callbacks = 0;

    const result = await repo.withTransaction(async (tx) => {
      callbacks += 1;
      const stored = await tx.getByIdempotencyKey('idem-12345678');
      if (stored) return stored.result;
      await tx.insertCobro({ idempotencyToken: 'idem-12345678' });
      return { created: true };
    });

    expect(result).toEqual(expectedReplay);
    expect(callbacks).toBe(2);
    expect(factory.ports.cobrosBound.insertCobro).toHaveBeenCalledTimes(1);
    expect(factory.calls.filter((call) => call.sql === 'ROLLBACK_TRANSACTION')).toHaveLength(1);
    expect(factory.calls.filter((call) => call.sql === 'BEGIN_TRANSACTION')).toHaveLength(2);
    expect(factory.calls.filter((call) => call.sql === 'COMMIT_TRANSACTION')).toHaveLength(1);
  });

  test('does not retry a unique-key race more than once', async () => {
    const factory = fakeConnection({ uniqueFailures: 2 });
    const repo = repository(factory);
    let attempts = 0;

    await expect(repo.withTransaction(async (tx) => {
      attempts += 1;
      await tx.insertConfirmation(confirmationRecord());
    })).rejects.toMatchObject({
      code: 'REPARTO_CONCURRENT_CONFIRMATION_CONFLICT', statusCode: 409,
    });
    expect(attempts).toBe(2);
    expect(factory.calls.filter((call) => call.sql === 'ROLLBACK_TRANSACTION')).toHaveLength(2);
    expect(factory.calls.map((call) => call.sql)).not.toContain('COMMIT_TRANSACTION');
  });

  test('keeps the confirmation DDL aligned with the fail-closed capability gate', () => {
    const ddl = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'sql', '033_reparto_confirmation_test_tables.sql'),
      'utf8',
    );
    const executableDdl = ddl.replace(/^--.*$/gm, '');
    expect(ddl).toContain('NOT EXECUTED');
    expect(executableDdl).not.toContain('DSEDAC.');
    let confirmationBlock;
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      const start = ddl.indexOf(`CREATE TABLE JAVIER.${table} (`);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = ddl.indexOf('\n);', start);
      expect(end).toBeGreaterThan(start);
      const block = ddl.slice(start, end);
      if (table === TABLES.confirmations) confirmationBlock = block;
      for (const column of columns) {
        expect(block).toMatch(new RegExp(`\\n\\s+${column}\\b`));
      }
    }
    expect(ddl).toContain('CK_TEST_REP_LINEAS_TOTAL');
    expect(ddl).toContain('CK_TEST_REP_LINEAS_MOTIVO');
    expect(ddl).toContain('FK_TEST_REP_CONFIRM_EVIDENCE_ITEM');
    expect(ddl).toContain('FK_TEST_REP_CONFIRM_SIGNATURE');
    expect(REQUIRED_COLUMNS[TABLES.confirmations]).toEqual(expect.arrayContaining([
      'DOCUMENTO_XDE', 'DOCUMENTO_DEX',
    ]));
    expect(confirmationBlock).toMatch(/\n\s+DOCUMENTO_XDE\b/);
    expect(confirmationBlock).toMatch(/\n\s+DOCUMENTO_DEX\b/);
    expect(ddl).not.toContain('CREATE TABLE JAVIER.TEST_REPARTO_COBROS');
  });

  test('supports the query-only connection interface', async () => {
    const factory = fakeConnection({ queryOnly: true });
    await expect(repository(factory).withTransaction(async () => 'ok')).resolves.toBe('ok');
    expect(factory.isClosed()).toBe(true);
  });

  test('rejects a non-test schema before a connection is opened', () => {
    expect(() => createRepartoConfirmationDb2Repository({
      schema: "DSEDAC; DROP TABLE DSEDAC.CPC",
      tables: QUALIFIED_TABLES,
      connectionFactory: jest.fn(),
      plannedDeliveryPort: { getPlannedDelivery: jest.fn() },
      evidenceOwnershipPort: { assertOwnership: jest.fn() },
    })).toThrow(RepartoRepositoryUnavailableError);
  });
});
