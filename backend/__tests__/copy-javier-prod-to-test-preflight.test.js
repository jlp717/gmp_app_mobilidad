'use strict';

const {
  compareTableMetadata,
  createLikeSql,
  normalizeOperationalContracts,
  operationalContractSignature,
  buildOperationalContractPlan,
  shouldAuditOperationalContracts,
  assertLqdCobrosSeedCoverage,
  lqdCobrosSplitCte,
  lqdCobrosInsertSql,
  shouldSeedLegacyDeliveryOverlay,
  clearTestRows,
  confirmationBundlePlan,
  normalizeCatalogYesNo,
  normalizeCatalogBoolean,
  runtimeWriteCoverageGaps,
  assertRuntimeWriteCoverage,
  buildReconciliationPlan,
  safeTypeWidening,
  reconcileMappingPairs,
  validateCopyRunId,
  backupTableName,
  backupShapeHash,
  ensureBackupManifestTable,
  commitBackupManifestWrite,
  backupTestTable,
  backupMappedDestinations,
  affectedSchemaPairs,
  runTableStep,
  runAfterCopyPreflight,
} = require('../scripts/copy-javier-prod-to-test');

function column(overrides = {}) {
  return {
    name: 'ID',
    dataType: 'INTEGER',
    length: '4',
    numericPrecision: '10',
    numericScale: '0',
    isNullable: 'NO',
    identity: false,
    ...overrides,
  };
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function durableManifestRecord(destination, columns, overrides = {}) {
  const runId = 'COPY_20260818_A';
  return {
    runId,
    source: destination.replace(/^JAVIER\.TEST_/, 'JAVIER.'),
    destination,
    backup: backupTableName(destination, runId),
    rowCount: 3,
    shapeHash: backupShapeHash(columns),
    contentHash: HASH_A,
    status: 'READY',
    ...overrides,
  };
}

function memoryManifestStore(initialRecord = null) {
  let record = initialRecord;
  return {
    ensure: jest.fn().mockResolvedValue({ operations: [] }),
    read: jest.fn(async () => record),
    create: jest.fn(async (planned) => {
      record = { ...planned, status: 'PLANNED' };
      return record;
    }),
    markReady: jest.fn(async (current) => {
      record = { ...current, status: 'READY' };
      return record;
    }),
  };
}
describe('canonical delivery-status seed mode', () => {
  test('does not seed the historical backup unless explicitly requested', () => {
    expect(shouldSeedLegacyDeliveryOverlay([])).toBe(false);
    expect(shouldSeedLegacyDeliveryOverlay(['--days=30'])).toBe(false);
    expect(shouldSeedLegacyDeliveryOverlay(['--legacy-bkp-delivery-overlay'])).toBe(true);
  });
});

describe('DB2 IBM i TEST row clearing', () => {
  test('emits transactional DELETE and never TRUNCATE', async () => {
    const executeFn = jest.fn().mockResolvedValue({ rowCount: 0 });
    await clearTestRows('JAVIER.TEST_REPARTO_CONFIRMACIONES', { executeFn });
    expect(executeFn).toHaveBeenCalledTimes(1);
    const sql = executeFn.mock.calls[0][0];
    expect(sql).toBe('DELETE FROM JAVIER.TEST_REPARTO_CONFIRMACIONES');
    expect(sql).not.toMatch(/TRUNCATE/i);
  });

  test('orders confirmation deletes child-to-parent and copies parent dependencies first', () => {
    const pairs = [
      ['confirmations', 'CONFIRMACIONES'],
      ['lines', 'LINEAS'],
      ['evidences', 'EVIDENCIAS'],
      ['confirmationEvidences', 'CONFIRM_EVIDENCIAS'],
    ].map(([key, table]) => ({
      group: 'confirmation', key,
      src: `JAVIER.REPARTO_${table}`,
      dst: `JAVIER.TEST_REPARTO_${table}`,
    }));
    const plan = confirmationBundlePlan(pairs);
    expect(plan.clear.map(({ key }) => key)).toEqual([
      'confirmationEvidences', 'lines', 'confirmations', 'evidences',
    ]);
    expect(plan.copy.map(({ key }) => key)).toEqual([
      'evidences', 'confirmations', 'lines', 'confirmationEvidences',
    ]);
  });
});

describe('DB2 catalog normalization', () => {
  test.each([
    ['Y', 'YES'], ['YES', 'YES'], [1, 'YES'], [true, 'YES'],
    ['N', 'NO'], ['NO', 'NO'], [0, 'NO'], [false, 'NO'],
  ])('normalizes %p to %s', (input, expected) => {
    expect(normalizeCatalogYesNo(input, 'IS_NULLABLE')).toBe(expected);
  });

  test('normalizes catalog booleans through the same strict contract', () => {
    expect(normalizeCatalogBoolean('Y', 'HAS_DEFAULT')).toBe(true);
    expect(normalizeCatalogBoolean('I', 'HAS_DEFAULT')).toBe(true);
    expect(normalizeCatalogBoolean('NO', 'IDENTITY')).toBe(false);
  });

  test.each([null, undefined, '', 'MAYBE', 2])('fails closed for unsupported value %p', (input) => {
    expect(() => normalizeCatalogYesNo(input, 'IS_NULLABLE'))
      .toThrow('Unsupported DB2 catalog IS_NULLABLE');
  });
});

describe('DB2 catalog identity marker scope', () => {
  test('does not accept I for IDENTITY', () => expect(() => normalizeCatalogBoolean('I', 'IDENTITY')).toThrow('Unsupported DB2 catalog IDENTITY'));
});

describe('copy-javier-prod-to-test fail-closed metadata preflight', () => {
  test('reports and blocks an identity mismatch even when the data shape matches', () => {
    const result = compareTableMetadata(
      [column({ identity: false })],
      [column({ identity: true })],
    );
    expect(result).toEqual({
      ok: false,
      missing: [],
      extra: [],
      deltas: [],
      identityDeltas: ['ID'],
      defaultDeltas: [],
    });
  });

  test('blocks missing columns, extra columns, and every required shape delta', () => {
    const source = [column({ name: 'SOURCE_ONLY' }), column({ name: 'SHARED' })];
    const destination = [
      column({ name: 'DESTINATION_ONLY' }),
      column({ name: 'SHARED', dataType: 'VARCHAR', length: '50', isNullable: 'YES' }),
    ];
    const result = compareTableMetadata(source, destination);

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['SOURCE_ONLY']);
    expect(result.extra).toEqual(['DESTINATION_ONLY']);
    expect(result.deltas).toEqual([expect.objectContaining({ name: 'SHARED' })]);
    expect(result.identityDeltas).toEqual([]);
  });

  test('does not reach mutation until every mapped pair passes preflight', async () => {
    const mutate = jest.fn();
    const pairs = [
      { src: 'JAVIER.PROD_A', dst: 'JAVIER.TEST_A' },
      { src: 'JAVIER.PROD_B', dst: 'JAVIER.TEST_B' },
    ];
    const goodColumns = [column({ name: 'ID' })];
    const dependencies = {
      tableExistsFn: jest.fn().mockResolvedValue(true),
      columnsOfFn: jest.fn(async (table) => (
        table.endsWith('TEST_B') ? [column({ name: 'ID', length: '8' })] : goodColumns
      )),
    };
      operationalContractsOfFn: jest.fn().mockResolvedValue([]),

    await expect(runAfterCopyPreflight(pairs, mutate, dependencies))
      .rejects.toThrow('COPY PREFLIGHT BLOCK JAVIER.PROD_B -> JAVIER.TEST_B');

    expect(mutate).not.toHaveBeenCalled();
  });
});

describe('TEST-only schema reconciliation', () => {
  const pair = {
    group: 'finance', key: 'cobros', objectType: 'TABLE',
    src: 'JAVIER.REPARTIDOR_COBROS', dst: 'JAVIER.TEST_REPARTIDOR_COBROS',
  };

  test('accepts NUMERIC and DECIMAL aliases only without precision or scale narrowing', () => {
    const numeric4 = column({
      dataType: 'NUMERIC', length: '4', numericPrecision: '4', numericScale: '0',
    });
    const decimal4 = column({
      dataType: 'DECIMAL', length: '4', numericPrecision: '4', numericScale: '0',
    });
    expect(safeTypeWidening(numeric4, decimal4)).toBe(true);
    expect(safeTypeWidening(
      column({ dataType: 'NUMERIC', numericPrecision: '8', numericScale: '2' }),
      column({ dataType: 'DECIMAL', numericPrecision: '6', numericScale: '2' }),
    )).toBe(true);
    expect(safeTypeWidening(
      column({ dataType: 'NUMERIC', numericPrecision: '4', numericScale: '0' }),
      column({ dataType: 'DECIMAL', numericPrecision: '6', numericScale: '0' }),
    )).toBe(false);
    expect(safeTypeWidening(
      column({ dataType: 'NUMERIC', numericPrecision: '8', numericScale: '3' }),
      column({ dataType: 'DECIMAL', numericPrecision: '8', numericScale: '2' }),
    )).toBe(false);
  });

  test('creates a missing TEST table from its JAVIER production peer', () => {
    expect(buildReconciliationPlan(pair, [column()], [], {
      sourceExists: true,
      destinationExists: false,
    })).toEqual([{ kind: 'CREATE_LIKE', sql: createLikeSql(pair) }]);
  });

  test('adds nullable columns and widens compatible varchar without destructive changes', () => {
    const source = [
      column({ name: 'ID' }),
      column({ name: 'NOTE', dataType: 'VARCHAR', length: '100', numericPrecision: '', numericScale: '', isNullable: 'YES' }),
      column({ name: 'NEW_FIELD', dataType: 'VARCHAR', length: '20', numericPrecision: '', numericScale: '', isNullable: 'YES' }),
    ];
    const destination = [
      column({ name: 'ID' }),
      column({ name: 'NOTE', dataType: 'VARCHAR', length: '30', numericPrecision: '', numericScale: '', isNullable: 'NO' }),
    ];
    expect(buildReconciliationPlan(pair, source, destination, { destinationRowCount: 4 }))
      .toEqual([
        expect.objectContaining({ kind: 'ADD_COLUMN', column: 'NEW_FIELD' }),
        expect.objectContaining({ kind: 'WIDEN_COLUMN', column: 'NOTE' }),
        expect.objectContaining({ kind: 'DROP_NOT_NULL', column: 'NOTE' }),
      ]);
  });

  test.each([
    {
      label: 'extra TEST column',
      source: [column()],
      destination: [column(), column({ name: 'EXTRA' })],
    },
    {
      label: 'type narrowing',
      source: [column({ dataType: 'VARCHAR', length: '10', numericPrecision: '', numericScale: '' })],
      destination: [column({ dataType: 'VARCHAR', length: '20', numericPrecision: '', numericScale: '' })],
    },
  ])('rejects $label', ({ source, destination }) => {
    expect(() => buildReconciliationPlan(pair, source, destination, { destinationRowCount: 1 }))
      .toThrow('SCHEMA RECONCILE BLOCK');
  });

  test('plans an explicit backed TEST-only rebuild for extra columns when authorized', () => {
    const plan = buildReconciliationPlan(
      pair,
      [column()],
      [column(), column({ name: 'LEGACY_ONLY' })],
      { destinationRowCount: 2, allowTestTableRebuild: true },
    );
    expect(plan).toEqual([
      { kind: 'DROP_TEST_TABLE', sql: `DROP TABLE ${pair.dst}` },
      {
        kind: 'CREATE_LIKE',
        sql: createLikeSql(pair),
      },
    ]);
    expect(plan.map(({ sql }) => sql).join(' ')).not.toContain('DSEDAC');
  });

  test('uses backed rebuild for exact type aliases or NULL-bearing constraints when authorized', () => {
    const source = [column({
      name: 'AMOUNT', dataType: 'NUMERIC', numericPrecision: '10', numericScale: '2', isNullable: 'NO',
    })];
    const destination = [column({
      name: 'AMOUNT', dataType: 'DECIMAL', numericPrecision: '10', numericScale: '2', isNullable: 'YES',
    })];
    expect(buildReconciliationPlan(pair, source, destination, {
      destinationRowCount: 3,
      destinationNullCounts: { AMOUNT: 1 },
      allowTestRowClear: true,
      allowTestTableRebuild: true,
    })).toEqual([
      expect.objectContaining({ kind: 'DROP_TEST_TABLE' }),
      expect.objectContaining({ kind: 'CREATE_LIKE' }),
    ]);
  });

  test('rebuilds TEST with INCLUDING IDENTITY for an identity mismatch', () => {
    expect(buildReconciliationPlan(
      pair,
      [column({ identity: true })],
      [column({ identity: false })],
      { destinationRowCount: 1, allowTestTableRebuild: true },
    )).toEqual([
      expect.objectContaining({ kind: 'DROP_TEST_TABLE' }),
      expect.objectContaining({ kind: 'CREATE_LIKE', sql: expect.stringContaining('INCLUDING IDENTITY') }),
    ]);
  });

  test('rejects a missing NOT NULL column on a non-empty TEST table', () => {
    expect(() => buildReconciliationPlan(
      pair,
      [column(), column({ name: 'REQUIRED' })],
      [column()],
      { destinationRowCount: 1 },
    )).toThrow('NOT NULL add on non-empty TEST table');
  });

  test('adds a defaulted NOT NULL column to non-empty TEST with WITH DEFAULT', () => {
    const plan = buildReconciliationPlan(
      pair,
      [column(), column({ name: 'DEFAULTED_REQUIRED', hasDefault: true })],
      [column()],
      { destinationRowCount: 3 },
    );
    expect(plan).toEqual([expect.objectContaining({
      sql: expect.stringContaining('DEFAULTED_REQUIRED INTEGER NOT NULL WITH DEFAULT'),
    })]);
  });

  test('sets NOT NULL directly when the TEST column contains no NULLs', () => {
    const source = [column({ name: 'TIPODOCUMENTO', isNullable: 'NO' })];
    const destination = [column({ name: 'TIPODOCUMENTO', isNullable: 'YES' })];
    expect(buildReconciliationPlan(pair, source, destination, {
      destinationRowCount: 5,
      destinationNullCounts: { TIPODOCUMENTO: 0 },
    })).toEqual([expect.objectContaining({
      kind: 'SET_NOT_NULL', column: 'TIPODOCUMENTO', nullCount: 0,
    })]);
  });

  test('blocks nullable-to-NOT-NULL with data until TEST row clearing is explicit', () => {
    const source = [column({ name: 'TIPODOCUMENTO', isNullable: 'NO' })];
    const destination = [column({ name: 'TIPODOCUMENTO', isNullable: 'YES' })];
    expect(() => buildReconciliationPlan(pair, source, destination, {
      destinationRowCount: 5,
      destinationNullCounts: { TIPODOCUMENTO: 2 },
      allowTestRowClear: false,
    })).toThrow('2 NULL rows require --allow-test-row-clear');
  });

  test('plans one backed TEST clear before multiple SET NOT NULL operations', () => {
    const source = [
      column({ name: 'TIPODOCUMENTO', isNullable: 'NO' }),
      column({ name: 'ORIGENDOCUMENTO', isNullable: 'NO' }),
    ];
    const destination = [
      column({ name: 'TIPODOCUMENTO', isNullable: 'YES' }),
      column({ name: 'ORIGENDOCUMENTO', isNullable: 'YES' }),
    ];
    const plan = buildReconciliationPlan(pair, source, destination, {
      destinationRowCount: 5,
      destinationNullCounts: { TIPODOCUMENTO: 2, ORIGENDOCUMENTO: 1 },
      allowTestRowClear: true,
    });
    expect(plan.map((operation) => operation.kind)).toEqual([
      'CLEAR_TEST_ROWS', 'SET_NOT_NULL', 'SET_NOT_NULL',
    ]);
    expect(plan[0]).toEqual(expect.objectContaining({
      rowCount: 5,
      sql: `DELETE FROM ${pair.dst}`,
    }));
  });

  test('dry-run obtains exact NULL counts before planning reconciliation', async () => {
    const source = [column({ name: 'TIPODOCUMENTO', isNullable: 'NO', hasDefault: true })];
    const destination = [column({ name: 'TIPODOCUMENTO', isNullable: 'YES', hasDefault: true })];
    const countNullsFn = jest.fn().mockResolvedValue(3);
    const report = await reconcileMappingPairs([pair], {
      tableExistsFn: jest.fn().mockResolvedValue(true),
      columnsOfFn: jest.fn(async (table) => (table === pair.src ? source : destination)),
      countOfFn: jest.fn().mockResolvedValue(5),
      operationalContractsOfFn: jest.fn().mockResolvedValue([]),
      countNullsFn,
      executeFn: jest.fn(),
      apply: false,
    });
    expect(countNullsFn).toHaveBeenCalledWith(pair.dst, 'TIPODOCUMENTO');
    expect(report[0].operations[0].kind).toBe('DROP_TEST_TABLE');
  });

  test('dry-run reconciliation returns operations without executing DDL', async () => {
    const executeFn = jest.fn();
    const report = await reconcileMappingPairs([pair], {
      tableExistsFn: jest.fn(async (table) => table === pair.src),
      columnsOfFn: jest.fn(async () => [column({ identity: true })]),
      countOfFn: jest.fn().mockResolvedValue(0),
      operationalContractsOfFn: jest.fn().mockResolvedValue([]),
      executeFn,
      apply: false,
    });
    expect(report[0].operations).toHaveLength(1);
    expect(executeFn).not.toHaveBeenCalled();
  });
});

describe('runtime INSERT compatibility gate', () => {
  const pair = {
    group: 'finance', key: 'balances', objectType: 'TABLE',
    src: 'JAVIER.REPARTIDOR_FINANCIAL_BALANCES',
    dst: 'JAVIER.TEST_REPARTIDOR_FINANCIAL_BALANCES',
  };
  const operations = [{ kind: 'ADD_COLUMN' }];

  test('accepts mandatory columns covered by the audited runtime INSERT', () => {
    expect(runtimeWriteCoverageGaps(pair, [
      column({ name: 'CODIGO_REPARTIDOR', hasDefault: false }),
      column({ name: 'SALDO_PENDIENTE', dataType: 'DECIMAL', length: '15', numericPrecision: '15', numericScale: '2', hasDefault: false }),
    ], operations)).toEqual([]);
  });

  test('blocks a new mandatory no-default column omitted by runtime INSERT', () => {
    expect(() => assertRuntimeWriteCoverage(pair, [
      column({ name: 'CODIGO_REPARTIDOR', hasDefault: false }),
      column({ name: 'SALDO_PENDIENTE', hasDefault: false }),
      column({ name: 'REQUIRED_NEW', hasDefault: false }),
    ], operations)).toThrow('RUNTIME WRITE COVERAGE BLOCK');
  });

  test('does not block nullable, defaulted, or identity columns', () => {
    expect(runtimeWriteCoverageGaps(pair, [
      column({ name: 'OPTIONAL', isNullable: 'YES', hasDefault: false }),
      column({ name: 'DEFAULTED', hasDefault: true }),
      column({ name: 'IDENTITY_ID', identity: true, hasDefault: false }),
    ], operations)).toEqual([]);
  });
});

describe('operational identity and key contracts', () => {
  const pair = {
    group: 'finance', key: 'cobros', objectType: 'TABLE',
    src: 'JAVIER.REPARTIDOR_COBROS', dst: 'JAVIER.TEST_REPARTIDOR_COBROS',
  };

  test('CREATE LIKE explicitly preserves IBM i identity attributes', () => {
    expect(createLikeSql(pair)).toContain('INCLUDING IDENTITY');
  });

  test('recreates PK, CHECK, unique and lookup indexes by signature on TEST only', () => {
    const contracts = normalizeOperationalContracts([
      { KIND: 'PRIMARY_KEY', OBJECT_NAME: 'PK_PROD', COLUMN_NAME: 'ID', ORDINAL_POSITION: 1, ORDERING: 'A' },
      { KIND: 'CHECK', OBJECT_NAME: 'CK_PROD', CHECK_CLAUSE: "STATUS IN ('PENDING','SENT')" },
      { KIND: 'UNIQUE_INDEX', OBJECT_NAME: 'UX_PROD', COLUMN_NAME: 'IDEMPOTENCY_TOKEN', ORDINAL_POSITION: 1, ORDERING: 'A' },
      { KIND: 'INDEX', OBJECT_NAME: 'IX_PROD', COLUMN_NAME: 'CODIGOVENDEDOR', ORDINAL_POSITION: 1, ORDERING: 'D' },
    ]);
    const plan = buildOperationalContractPlan(pair, contracts, []);
    expect(plan.map(({ kind }) => kind)).toEqual([
      'ADD_PRIMARY_KEY', 'ADD_CHECK', 'ADD_INDEX', 'ADD_INDEX',
    ]);
    expect(plan.map(({ sql }) => sql).join(' ')).toContain('CREATE UNIQUE INDEX JAVIER.');
    expect(plan.find(({ kind }) => kind === 'ADD_PRIMARY_KEY').sql)
      .toMatch(/^ALTER TABLE JAVIER\.TEST_REPARTIDOR_COBROS ADD CONSTRAINT JAVIER\.PKT_/);
    expect(plan.find(({ kind }) => kind === 'ADD_CHECK').sql)
      .toMatch(/^ALTER TABLE JAVIER\.TEST_REPARTIDOR_COBROS ADD CONSTRAINT JAVIER\.CKT_/);
    expect(plan.filter(({ kind }) => kind.startsWith('ADD_'))
      .every(({ sql }) => !sql.includes('ADD CONSTRAINT PKT_') && !sql.includes('ADD CONSTRAINT CKT_'))).toBe(true);
    expect(plan.map(({ sql }) => sql).join(' ')).toContain('CODIGOVENDEDOR DESC');
    expect(plan.every(({ sql }) => sql.includes(pair.dst))).toBe(true);
    expect(plan.map(({ sql }) => sql).join(' ')).not.toMatch(/ALTER TABLE JAVIER\.REPARTIDOR_COBROS/);
  });

  test('normalizes equivalent CHECK whitespace into one signature', () => {
    const [left] = normalizeOperationalContracts([
      { KIND: 'CHECK', OBJECT_NAME: 'A', CHECK_CLAUSE: "STATUS IN ('PENDING', 'SENT')" },
    ]);
    const [right] = normalizeOperationalContracts([
      { KIND: 'CHECK', OBJECT_NAME: 'B', CHECK_CLAUSE: "  STATUS   IN ('PENDING', 'SENT')  " },
    ]);
    expect(operationalContractSignature(left)).toBe(operationalContractSignature(right));
  });

  test('audits every mapped TABLE, not only the former hand-picked subset', () => {
    expect(shouldAuditOperationalContracts({
      group: 'finance', key: 'audit', objectType: 'TABLE',
      src: 'JAVIER.REPARTIDOR_COBROS_AUDIT', dst: 'JAVIER.TEST_REPARTIDOR_COBROS_AUDIT',
    })).toBe(true);
    expect(shouldAuditOperationalContracts({ objectType: 'SEQUENCE' })).toBe(false);
    expect(shouldAuditOperationalContracts({})).toBe(false);
  });

  test('reconciliation adds missing production contracts for any mapped TEST table', async () => {
    const auditPair = {
      group: 'finance', key: 'audit', objectType: 'TABLE',
      src: 'JAVIER.REPARTIDOR_COBROS_AUDIT', dst: 'JAVIER.TEST_REPARTIDOR_COBROS_AUDIT',
    };
    const sourceContracts = normalizeOperationalContracts([
      { KIND: 'INDEX', OBJECT_NAME: 'IX_PROD_EVENT', COLUMN_NAME: 'EVENT_TYPE', ORDINAL_POSITION: 1, ORDERING: 'A' },
      { KIND: 'INDEX', OBJECT_NAME: 'IX_PROD_REP', COLUMN_NAME: 'CODIGO_REPARTIDOR', ORDINAL_POSITION: 1, ORDERING: 'A' },
    ]);
    const executeFn = jest.fn();
    const report = await reconcileMappingPairs([auditPair], {
      tableExistsFn: jest.fn().mockResolvedValue(true),
      columnsOfFn: jest.fn().mockResolvedValue([column({ identity: true })]),
      countOfFn: jest.fn().mockResolvedValue(0),
      countNullsFn: jest.fn().mockResolvedValue(0),
      operationalContractsOfFn: jest.fn(async (table) => (table === auditPair.src ? sourceContracts : [])),
      executeFn,
      apply: false,
    });
    expect(report[0].operations).toHaveLength(2);
    expect(report[0].operations.every(({ kind, sql }) => kind === 'ADD_INDEX'
      && sql.includes(auditPair.dst) && !sql.includes('DSEDAC'))).toBe(true);
    expect(executeFn).not.toHaveBeenCalled();
  });

  test('preflight accepts TEST-only stronger contracts while requiring the production subset', async () => {
    const { preflightMappingPairs } = require('../scripts/copy-javier-prod-to-test');
    const auditPair = {
      group: 'finance', key: 'audit', objectType: 'TABLE',
      src: 'JAVIER.REPARTIDOR_COBROS_AUDIT', dst: 'JAVIER.TEST_REPARTIDOR_COBROS_AUDIT',
    };
    const production = normalizeOperationalContracts([
      { KIND: 'CHECK', OBJECT_NAME: 'CK_PROD', CHECK_CLAUSE: "EVENT_TYPE <> ''" },
    ]);
    const extraTestOnly = normalizeOperationalContracts([
      { KIND: 'CHECK', OBJECT_NAME: 'CK_PROD', CHECK_CLAUSE: "EVENT_TYPE <> ''" },
      { KIND: 'CHECK', OBJECT_NAME: 'CK_TEST', CHECK_CLAUSE: "OPERADOR <> ''" },
    ]);
    await expect(preflightMappingPairs([auditPair], {
      tableExistsFn: jest.fn().mockResolvedValue(true),
      columnsOfFn: jest.fn().mockResolvedValue([column()]),
      operationalContractsOfFn: jest.fn(async (table) => (table === auditPair.src ? production : extraTestOnly)),
    })).resolves.toBeUndefined();
  });
});
  test('catalog-derived resume continues after DROP, CREATE, or constraint n', () => {
    const pair = {
      group: 'finance', key: 'cobros', objectType: 'TABLE',
      src: 'JAVIER.REPARTIDOR_COBROS', dst: 'JAVIER.TEST_REPARTIDOR_COBROS',
    };
    const afterDrop = buildReconciliationPlan(
      pair, [column({ identity: true })], [],
      { sourceExists: true, destinationExists: false },
    );
    expect(afterDrop).toEqual([expect.objectContaining({
      kind: 'CREATE_LIKE', sql: expect.stringContaining('INCLUDING IDENTITY'),
    })]);

    const desired = normalizeOperationalContracts([
      { KIND: 'PRIMARY_KEY', OBJECT_NAME: 'PK', COLUMN_NAME: 'ID', ORDINAL_POSITION: 1, ORDERING: 'A' },
      { KIND: 'CHECK', OBJECT_NAME: 'CK', CHECK_CLAUSE: "STATUS IN ('PENDING','SENT')" },
      { KIND: 'UNIQUE_INDEX', OBJECT_NAME: 'UX', COLUMN_NAME: 'IDEMPOTENCY_TOKEN', ORDINAL_POSITION: 1, ORDERING: 'A' },
    ]);
    expect(buildOperationalContractPlan(pair, desired, [])).toHaveLength(3);
    const afterConstraintN = buildOperationalContractPlan(pair, desired, desired.slice(0, 2));
    expect(afterConstraintN).toEqual([expect.objectContaining({
      signature: operationalContractSignature(desired[2]),
    })]);
  });


describe('ERP LQD cobros seed contract', () => {
  test('blocks before DELETE semantics when TEST ID lost identity', () => {
    expect(() => assertLqdCobrosSeedCoverage([
      column({ name: 'ID', identity: false, hasDefault: false }),
    ])).toThrow('destination ID must be identity before DELETE');
  });

  test('blocks future mandatory columns not mapped by the seed', () => {
    expect(() => assertLqdCobrosSeedCoverage([
      column({ name: 'ID', identity: true, hasDefault: true }),
      column({ name: 'UNMAPPED_REQUIRED', identity: false, hasDefault: false }),
    ])).toThrow('mandatory columns missing=[UNMAPPED_REQUIRED]');
  });

  test('uses one atomic explicit INSERT with a unique runtime token and no manual ID', () => {
    const sql = lqdCobrosInsertSql('JAVIER.TEST_REPARTIDOR_COBROS');
    expect((sql.match(/INSERT INTO/gi) || [])).toHaveLength(1);
    const splitCte = lqdCobrosSplitCte();
    expect(splitCte).toMatch(/SPLIT\s*\(CODIGOVENDEDOR, DIALIQUIDACION, MESLIQUIDACION, ANOLIQUIDACION,\s*NUMEROLIQUIDACION, FORMA, IMPORTE\) AS \(/);
    expect(`${splitCte} SELECT FORMA, IMPORTE FROM SPLIT`)
      .toContain('SELECT FORMA, IMPORTE FROM SPLIT');
    expect(splitCte).not.toContain('SPLIT AS (');
    expect(sql).toContain('IDEMPOTENCY_TOKEN');
    expect(sql).toContain('LIQUIDACION_TOKEN');
    expect(sql).toContain("'EF' AS FORMA");
    expect(sql).toContain("'PD'");
    expect(sql).not.toMatch(/INSERT INTO JAVIER\.TEST_REPARTIDOR_COBROS \(ID,/);
    expect(sql).not.toMatch(/TRUNCATE/i);
  });
});

describe('resumable backups and table transactions', () => {
  const destination = 'JAVIER.TEST_REPARTIDOR_COBROS';

  test('requires a bounded explicit run id for apply/resume', () => {
    expect(validateCopyRunId('COPY_20260818_A')).toBe('COPY_20260818_A');
    expect(() => validateCopyRunId('')).toThrow('--copy-run-id is required');
    expect(() => validateCopyRunId('bad-value')).toThrow('--copy-run-id is required');
    expect(backupTableName(destination, 'COPY_20260818_A'))
      .toBe('JAVIER.TEST_COPY_BKP_COPY_20260818_A_REPARTIDOR_COBROS');
  });

  test('backs up non-empty TEST data after persisting and verifying its manifest', async () => {
    const backup = backupTableName(destination, 'COPY_20260818_A');
    let created = false;
    const executeFn = jest.fn(async () => { created = true; });
    const columns = [column(), column({ name: 'IMPORTE' })];
    const manifestStore = memoryManifestStore();
    const result = await backupTestTable(destination, 'COPY_20260818_A', {
      tableExistsFn: jest.fn(async (table) => table === destination || (table === backup && created)),
      columnsOfFn: jest.fn().mockResolvedValue(columns),
      countOfFn: jest.fn().mockResolvedValue(3),
      contentHashOfFn: jest.fn().mockResolvedValue(HASH_A),
      executeFn,
      manifestStore,
      apply: true,
    });
    expect(result.backup).toBe(backup);
    expect(result.contentHash).toBe(HASH_A);
    expect(manifestStore.create.mock.invocationCallOrder[0])
      .toBeLessThan(executeFn.mock.invocationCallOrder[0]);
    expect(manifestStore.markReady).toHaveBeenCalledTimes(1);
    expect(executeFn).toHaveBeenCalledWith(expect.stringContaining(
      `SELECT ID, IMPORTE FROM ${destination}`,
    ));
  });
    const events = [];
  test('commits each manifest mutation on a dedicated connection before returning', async () => {
    const connection = {
      beginTransaction: jest.fn(async () => { events.push('begin'); }),
      query: jest.fn(async () => { events.push('write'); }),
      commit: jest.fn(async () => { events.push('commit'); }),
      rollback: jest.fn(async () => { events.push('rollback'); }),
      close: jest.fn(async () => { events.push('close'); }),
    };
    await commitBackupManifestWrite(
      'INSERT INTO JAVIER.TEST_COPY_BACKUP_MANIFEST (RUN_ID) VALUES (?)',
      ['COPY_20260818_R2'],
      { getPoolFn: () => ({ connect: jest.fn().mockResolvedValue(connection) }) },
    );
    expect(events).toEqual(['begin', 'write', 'commit', 'close']);
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  test('rolls back and blocks when a dedicated manifest write fails', async () => {
    const events = [];
    const connection = {
      beginTransaction: jest.fn(async () => { events.push('begin'); }),
      query: jest.fn(async () => { events.push('write'); throw new Error('manifest write failed'); }),
      commit: jest.fn(async () => { events.push('commit'); }),
      rollback: jest.fn(async () => { events.push('rollback'); }),
      close: jest.fn(async () => { events.push('close'); }),
    };
    await expect(commitBackupManifestWrite(
      'UPDATE JAVIER.TEST_COPY_BACKUP_MANIFEST SET STATUS = ? WHERE RUN_ID = ?',
      ['READY', 'COPY_20260818_R2'],
      { getPoolFn: () => ({ connect: jest.fn().mockResolvedValue(connection) }) },
    )).rejects.toThrow('manifest write failed');
    expect(events).toEqual(['begin', 'write', 'rollback', 'close']);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  test('persists an empty READY manifest before allowing schema DDL', async () => {
    const columns = [column()];
    const manifestStore = memoryManifestStore();
    const executeFn = jest.fn();
    const result = await backupTestTable(destination, 'COPY_20260818_A', {
      tableExistsFn: jest.fn(async (table) => table === destination),
      columnsOfFn: jest.fn().mockResolvedValue(columns),
      countOfFn: jest.fn().mockResolvedValue(0),
      contentHashOfFn: jest.fn().mockResolvedValue(HASH_A),
      executeFn,
      manifestStore,
      apply: true,
    });
    expect(result).toEqual(expect.objectContaining({
      skipped: 'empty', rowCount: 0, manifestReady: true,
    }));
    expect(manifestStore.create).toHaveBeenCalledTimes(1);
    expect(manifestStore.markReady).toHaveBeenCalledTimes(1);
    expect(executeFn).not.toHaveBeenCalled();
  });

  test('resume accepts a manifest-authenticated backup and rejects a partial one', async () => {
    const columns = [column()];
    const record = durableManifestRecord(destination, columns);
    const tableExistsFn = jest.fn().mockResolvedValue(true);
    const good = await backupTestTable(destination, 'COPY_20260818_A', {
      tableExistsFn,
      countOfFn: jest.fn().mockResolvedValue(3),
      columnsOfFn: jest.fn().mockResolvedValue(columns),
      contentHashOfFn: jest.fn().mockResolvedValue(HASH_A),
      manifestStore: memoryManifestStore(record),
      apply: true,
    });
    expect(good.resumed).toBe(true);

    let calls = 0;
    await expect(backupTestTable(destination, 'COPY_20260818_A', {
      tableExistsFn,
      countOfFn: jest.fn(async () => (++calls === 1 ? 3 : 2)),
      columnsOfFn: jest.fn().mockResolvedValue(columns),
      contentHashOfFn: jest.fn().mockResolvedValue(HASH_A),
      manifestStore: memoryManifestStore(record),
      apply: true,
    })).rejects.toThrow('count/schema/content mismatch');
  });

  test('fails closed when backup row count is unavailable', async () => {
    await expect(backupTestTable(destination, 'COPY_20260818_A', {
      tableExistsFn: jest.fn().mockResolvedValue(true),
      countOfFn: jest.fn().mockResolvedValue(-1),
      columnsOfFn: jest.fn(),
      apply: true,
    })).rejects.toThrow('row count unavailable');
  });

  test('blocks a stale same-count backup against the durable content hash', async () => {
    const columns = [column()];
    const record = durableManifestRecord(destination, columns);
    await expect(backupTestTable(destination, 'COPY_20260818_A', {
      tableExistsFn: jest.fn().mockResolvedValue(true),
      countOfFn: jest.fn().mockResolvedValue(3),
      columnsOfFn: jest.fn().mockResolvedValue(columns),
      contentHashOfFn: jest.fn().mockResolvedValue(HASH_B),
      manifestStore: memoryManifestStore(record),
      apply: true,
    })).rejects.toThrow('count/schema/content mismatch');
  });

  test('missing and empty resume both hash the backup and reject tampering', async () => {
    const backup = backupTableName(destination, 'COPY_20260818_A');
    const columns = [column()];
    const record = durableManifestRecord(destination, columns);
    const afterDropHash = jest.fn().mockResolvedValue(HASH_A);
    const afterDrop = await backupTestTable(destination, 'COPY_20260818_A', {
      tableExistsFn: jest.fn(async (table) => table === backup),
      countOfFn: jest.fn().mockResolvedValue(3),
      columnsOfFn: jest.fn().mockResolvedValue(columns),
      contentHashOfFn: afterDropHash,
      manifestStore: memoryManifestStore(record),
      apply: true,
    });
    expect(afterDrop).toEqual(expect.objectContaining({
      resumed: true, destinationMissing: true, backupCount: 3,
    }));
    expect(afterDropHash).toHaveBeenCalledWith(backup, columns);

    let countCalls = 0;
    const afterCreateHash = jest.fn().mockResolvedValue(HASH_A);
    const afterCreate = await backupTestTable(destination, 'COPY_20260818_A', {
      tableExistsFn: jest.fn().mockResolvedValue(true),
      countOfFn: jest.fn(async () => (++countCalls === 1 ? 0 : 3)),
      columnsOfFn: jest.fn().mockResolvedValue(columns),
      contentHashOfFn: afterCreateHash,
      manifestStore: memoryManifestStore(record),
      apply: true,
    });
    expect(afterCreate).toEqual(expect.objectContaining({
      resumed: true, destinationRecreatedEmpty: true, backupCount: 3,
    }));
    expect(afterCreateHash).toHaveBeenCalledWith(backup, columns);

    for (const destinationExists of [false, true]) {
      let counts = 0;
      await expect(backupTestTable(destination, 'COPY_20260818_A', {
        tableExistsFn: jest.fn(async (table) => table === backup || destinationExists),
        countOfFn: jest.fn(async () => (destinationExists && ++counts === 1 ? 0 : 3)),
        columnsOfFn: jest.fn().mockResolvedValue(columns),
        contentHashOfFn: jest.fn().mockResolvedValue(HASH_B),
        manifestStore: memoryManifestStore(record),
        apply: true,
      })).rejects.toThrow('count/schema/content mismatch');
    }
  });

  test('schema-only counts manifest DDL and backs up exactly the three affected pairs', async () => {
    const affectedRows = [
      { pair: { src: 'JAVIER.REPARTIDOR_COBROS', dst: 'JAVIER.TEST_REPARTIDOR_COBROS' }, operations: Array(8).fill({ kind: 'X' }) },
      { pair: { src: 'JAVIER.REPARTIDOR_LIQUIDACION_EMAILS', dst: 'JAVIER.TEST_REPARTIDOR_LIQUIDACION_EMAILS' }, operations: Array(6).fill({ kind: 'X' }) },
      { pair: { src: 'JAVIER.DELIVERY_STATUS', dst: 'JAVIER.TEST_DELIVERY_STATUS' }, operations: Array(10).fill({ kind: 'X' }) },
      { pair: { src: 'JAVIER.REPARTIDOR_FIRMAS', dst: 'JAVIER.TEST_REPARTIDOR_FIRMAS' }, operations: [] },
      { pair: { src: 'JAVIER.REPARTO_CONFIRMACIONES', dst: 'JAVIER.TEST_REPARTO_CONFIRMACIONES' }, operations: [] },
    ];
    const affected = affectedSchemaPairs(affectedRows);
    const manifestPlan = await ensureBackupManifestTable({
      tableExistsFn: jest.fn().mockResolvedValue(false),
      executeFn: jest.fn(),
      apply: false,
    });
    expect(affectedRows.reduce((sum, row) => sum + row.operations.length, 0)).toBe(24);
    expect(24 + manifestPlan.operations.length).toBe(25);
    expect(affected.map(({ dst }) => dst)).toEqual([
      'JAVIER.TEST_REPARTIDOR_COBROS',
      'JAVIER.TEST_REPARTIDOR_LIQUIDACION_EMAILS',
      'JAVIER.TEST_DELIVERY_STATUS',
    ]);

    const tableExistsFn = jest.fn(async (table) => !table.includes('TEST_COPY_BKP_'));
    await backupMappedDestinations(affected, 'COPY_20260818_A', {
      tableExistsFn,
      countOfFn: jest.fn().mockResolvedValue(1),
      columnsOfFn: jest.fn().mockResolvedValue([column()]),
      contentHashOfFn: jest.fn().mockResolvedValue(HASH_A),
      apply: false,
    });
    expect(tableExistsFn).not.toHaveBeenCalledWith('JAVIER.TEST_REPARTIDOR_FIRMAS');
    expect(tableExistsFn).not.toHaveBeenCalledWith('JAVIER.TEST_REPARTO_CONFIRMACIONES');
  });

  test('commits a successful table step and rolls back a failed one', async () => {
    const connection = {
      beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), close: jest.fn(),
    };
    const getPoolFn = () => ({ connect: jest.fn().mockResolvedValue(connection) });
    await runTableStep('copy', destination, jest.fn(), { getPoolFn, apply: true });
    expect(connection.commit).toHaveBeenCalledTimes(1);

    connection.commit.mockClear();
    await expect(runTableStep('copy', destination, async () => { throw new Error('boom'); }, {
      getPoolFn,
      apply: true,
    })).rejects.toThrow('boom');
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });
});
