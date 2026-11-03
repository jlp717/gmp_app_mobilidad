'use strict';

const {
  APP_BUFFER_REQUIREMENTS,
  inspectAppBufferCapability,
  requireAppBufferCapability,
} = require('../utils/db2-app-buffer-capability');

function env(profile, overrides = {}) {
  return {
    APP_ENV: profile,
    REPARTO_TABLE_SET: profile === 'production' ? 'production' : 'isolated_test',
    DB2_WRITE_SCHEMA: 'JAVIER',
    ...overrides,
  };
}

function metadataFor(tables) {
  const tableRows = tables.map((table) => {
    const [TABLE_SCHEMA, TABLE_NAME] = table.split('.');
    return { TABLE_SCHEMA, TABLE_NAME };
  });
  const columnRows = [];
  const indexRows = [];
  const constraintRows = [];
  const checkRows = [];
  for (const table of tables) {
    const [, TABLE_NAME] = table.split('.');
    const logical = TABLE_NAME.replace(/^TEST_/, '');
    for (const spec of APP_BUFFER_REQUIREMENTS[logical].columns) {
      columnRows.push({
        TABLE_SCHEMA: 'JAVIER',
        TABLE_NAME,
        COLUMN_NAME: spec.name,
        DATA_TYPE: spec.type,
        LENGTH: spec.length,
        NUMERIC_PRECISION: spec.precision,
        NUMERIC_SCALE: spec.scale,
        IS_NULLABLE: spec.nullable,
      });
    }
    APP_BUFFER_REQUIREMENTS[logical].primaryKey.forEach((COLUMN_NAME, index) => {
      constraintRows.push({
        TABLE_SCHEMA: 'JAVIER', TABLE_NAME, CONSTRAINT_NAME: 'PK',
        CONSTRAINT_TYPE: 'PRIMARY KEY', ENABLED: 'YES',
        COLUMN_NAME, ORDINAL_POSITION: index + 1,
      });
    });
    APP_BUFFER_REQUIREMENTS[logical].uniqueKeys.forEach((columns, keyIndex) => {
      columns.forEach((COLUMN_NAME, index) => constraintRows.push({
        TABLE_SCHEMA: 'JAVIER', TABLE_NAME, CONSTRAINT_NAME: `UQ_${keyIndex}`,
        CONSTRAINT_TYPE: 'UNIQUE', ENABLED: 'YES', COLUMN_NAME, ORDINAL_POSITION: index + 1,
      }));
    });
    APP_BUFFER_REQUIREMENTS[logical].indexes.forEach((columns, keyIndex) => {
      columns.forEach((COLUMN_NAME, index) => indexRows.push({
        TABLE_SCHEMA: 'JAVIER', TABLE_NAME, INDEX_NAME: `IX_${keyIndex}`,
        IS_UNIQUE: 'D', COLUMN_NAME, ORDINAL_POSITION: index + 1,
      }));
    });
    APP_BUFFER_REQUIREMENTS[logical].checks.forEach((CHECK_CLAUSE, keyIndex) => {
      checkRows.push({
        TABLE_SCHEMA: 'JAVIER',
        TABLE_NAME,
        CONSTRAINT_NAME: `CK_${keyIndex}`,
        CHECK_CLAUSE,
      });
    });
  }
  return [tableRows, columnRows, indexRows, constraintRows, checkRows];
}

describe('app buffer capability', () => {
  test.each(['test', 'demo'])('%s uses the closed TEST mapping without a runtime catalog query', async (profile) => {
    const catalogQuery = jest.fn();
    const result = await inspectAppBufferCapability({
      family: 'commercialFinance', env: env(profile), catalogQuery,
    });

    expect(result).toMatchObject({ available: true, profile });
    expect(result.tables).toEqual([
      'JAVIER.TEST_LIQUIDACION_COMERCIAL',
      'JAVIER.TEST_DEVOLUCIONES_COMERCIAL',
    ]);
    expect(catalogQuery).not.toHaveBeenCalled();
  });

  test('rejects a contradictory profile before any catalog query', async () => {
    const catalogQuery = jest.fn();
    await expect(inspectAppBufferCapability({
      family: 'audit',
      env: env('production', { REPARTO_TABLE_SET: 'isolated_test' }),
      catalogQuery,
    })).rejects.toMatchObject({ code: 'APP_BUFFER_PROFILE_INVALID' });
    expect(catalogQuery).not.toHaveBeenCalled();
  });

  test('production never falls back to TEST and fails closed when physical objects are absent', async () => {
    const catalogQuery = jest.fn().mockResolvedValue([]);
    await expect(requireAppBufferCapability({
      family: 'audit', env: env('production'), catalogQuery,
    })).rejects.toMatchObject({
      code: 'APP_BUFFER_CAPABILITY_UNAVAILABLE',
      details: { missingTables: ['JAVIER.PEDIDO_STATE_EVENTS'] },
    });
    expect(catalogQuery).toHaveBeenCalledTimes(5);
    expect(catalogQuery.mock.calls.flatMap(([, params]) => params)).not.toContain('TEST_PEDIDO_STATE_EVENTS');
  });

  test('forced metadata accepts the exact TEST columns and keys', async () => {
    const tables = ['JAVIER.TEST_PEDIDO_STATE_EVENTS'];
    const responses = metadataFor(tables);
    const catalogQuery = jest.fn().mockImplementation(() => Promise.resolve(responses.shift()));
    const result = await inspectAppBufferCapability({
      family: 'audit', env: env('test'), catalogQuery, forceMetadata: true,
    });

    expect(result).toMatchObject({ available: true, missingTables: [], missingColumns: [], missingKeys: [] });
    expect(catalogQuery).toHaveBeenCalledTimes(5);
  });

  test.each([
    ['UNIQUE', (row) => { row.CONSTRAINT_TYPE = 'UNIQUE'; }],
    ['disabled', (row) => { row.ENABLED = 'NO'; }],
  ])('a %s ID constraint cannot satisfy the required enabled PRIMARY KEY', async (_label, mutate) => {
    const tables = ['JAVIER.TEST_PEDIDO_STATE_EVENTS'];
    const responses = metadataFor(tables);
    mutate(responses[3].find((row) => row.CONSTRAINT_NAME === 'PK'));
    const catalogQuery = jest.fn().mockImplementation(() => Promise.resolve(responses.shift()));

    const result = await inspectAppBufferCapability({
      family: 'audit', env: env('test'), catalogQuery, forceMetadata: true,
    });

    expect(result.available).toBe(false);
    expect(result.missingKeys).toContain('TEST_PEDIDO_STATE_EVENTS:PRIMARY KEY(ID)');
  });

  test('a missing required column or key is reported without business fallback', async () => {
    const tables = ['JAVIER.TEST_LIQUIDACION_COMERCIAL', 'JAVIER.TEST_DEVOLUCIONES_COMERCIAL'];
    const [tableRows, columnRows, indexRows, constraintRows, checkRows] = metadataFor(tables);
    const responses = [
      tableRows,
      columnRows.filter((row) => row.COLUMN_NAME !== 'UPDATED_AT'),
      indexRows,
      constraintRows.filter((row) => row.COLUMN_NAME !== 'IDEMPOTENCY_TOKEN'),
      checkRows,
    ];
    const catalogQuery = jest.fn().mockImplementation(() => Promise.resolve(responses.shift()));
    const result = await inspectAppBufferCapability({
      family: 'commercialFinance', env: env('test'), catalogQuery, forceMetadata: true,
    });

    expect(result.available).toBe(false);
    expect(result.missingColumns).toContain('TEST_LIQUIDACION_COMERCIAL.UPDATED_AT');
    expect(result.missingKeys).toEqual(expect.arrayContaining([
      expect.stringContaining('IDEMPOTENCY_TOKEN'),
    ]));
  });

  test.each([
    ['type', (rows) => { rows.find((row) => row.COLUMN_NAME === 'IMPORTE').DATA_TYPE = 'INTEGER'; }],
    ['nullability', (rows) => { rows.find((row) => row.COLUMN_NAME === 'IMPORTE').IS_NULLABLE = 'Y'; }],
    ['scale', (rows) => { rows.find((row) => row.COLUMN_NAME === 'UNIDADES').NUMERIC_SCALE = 2; }],
  ])('rejects an incompatible required column %s', async (_label, mutateColumns) => {
    const tables = ['JAVIER.TEST_DEVOLUCIONES_COMERCIAL'];
    const responses = metadataFor(tables);
    mutateColumns(responses[1]);
    const catalogQuery = jest.fn().mockImplementation(() => Promise.resolve(responses.shift()));

    const result = await inspectAppBufferCapability({
      family: 'commercialFinance',
      env: env('test'),
      catalogQuery,
      forceMetadata: true,
    });

    expect(result.available).toBe(false);
    expect(result.incompatibleColumns).toEqual(expect.arrayContaining([
      expect.stringMatching(/^TEST_DEVOLUCIONES_COMERCIAL\./),
    ]));
  });

  test.each([
    ['missing', (rows) => { rows.pop(); }],
    ['weakened', (rows) => { rows[0].CHECK_CLAUSE += ' OR 1 = 1'; }],
  ])('rejects a %s state audit CHECK clause', async (_label, mutateChecks) => {
    const tables = ['JAVIER.TEST_PEDIDO_STATE_EVENTS'];
    const responses = metadataFor(tables);
    mutateChecks(responses[4]);
    const catalogQuery = jest.fn().mockImplementation(() => Promise.resolve(responses.shift()));

    const result = await inspectAppBufferCapability({
      family: 'audit', env: env('test'), catalogQuery, forceMetadata: true,
    });

    expect(result.available).toBe(false);
    expect(result.missingChecks).not.toHaveLength(0);
  });

  test('catalog failures are sanitized without reflecting the driver error', async () => {
    const catalogQuery = jest.fn().mockRejectedValue(new Error('secret connection details'));

    await expect(inspectAppBufferCapability({
      family: 'audit', env: env('production'), catalogQuery,
    })).rejects.toMatchObject({
      code: 'APP_BUFFER_CATALOG_UNAVAILABLE',
      message: 'No se pudo verificar el catalogo DB2 de las tablas de aplicacion.',
    });
  });
});
