'use strict';

const fs = require('fs');
const path = require('path');

const manifest = require('../scripts/reparto-isolated-ddl-manifest');
const runner = require('../scripts/reparto-isolated-ddl-runner');

const sqlDirectory = path.join(__dirname, '..', 'scripts', 'sql');

function sourceFor(entry) {
  return fs.readFileSync(path.join(sqlDirectory, entry.file), 'utf8');
}

function exactInventory(entry) {
  return [
    ...entry.objects.tables.map((name) => ({ OBJECT_KIND: 'TABLE', OBJECT_NAME: name })),
    ...entry.objects.sequences.map((name) => ({ OBJECT_KIND: 'SEQUENCE', OBJECT_NAME: name })),
  ];
}

function poolHarness(query) {
  const connection = { query: jest.fn(query), close: jest.fn().mockResolvedValue(undefined) };
  const pool = { connect: jest.fn().mockResolvedValue(connection), close: jest.fn().mockResolvedValue(undefined) };
  const odbc = { pool: jest.fn().mockResolvedValue(pool) };
  return { connection, pool, odbc };
}

function executionArgs(id) {
  return [
    `--migration=${id}`,
    '--environment=isolated_test',
    '--confirm=JAVIER_TEST_DDL',
    '--execute',
  ];
}

function testEnv() {
  return { ODBC_UID: 'isolated_user', ODBC_PWD: 'isolated_password' };
}

function declarativeRows(catalog) {
  const columns = catalog.columns.map((column) => ({
    TABLE_NAME: column.table,
    COLUMN_NAME: column.name,
    ORDINAL_POSITION: column.ordinal,
    DATA_TYPE: column.type,
    LENGTH: column.length,
    NUMERIC_PRECISION: column.precision,
    NUMERIC_SCALE: column.scale,
    IS_NULLABLE: column.nullable ? 'Y' : 'N',
    COLUMN_DEFAULT: column.defaultValue,
    IS_IDENTITY: column.identity ? 'YES' : 'NO',
  }));
  const constraints = catalog.constraints.flatMap((constraint) => {
    const keys = constraint.keys.length > 0 ? constraint.keys : [null];
    return keys.map((key, index) => ({
      TABLE_NAME: constraint.table,
      CONSTRAINT_NAME: constraint.name,
      CONSTRAINT_TYPE: constraint.type,
      CONSTRAINT_TEXT: constraint.check,
      INDEX_NAME: ['PRIMARY KEY', 'UNIQUE'].includes(constraint.type) ? `SYS_${constraint.name}` : null,
      COLUMN_NAME: key,
      ORDINAL_POSITION: key ? index + 1 : null,
    }));
  });
  const references = catalog.constraints
    .filter((constraint) => constraint.type === 'FOREIGN KEY')
    .flatMap((constraint) => constraint.referencedKeys.map((key, index) => ({
      CONSTRAINT_NAME: constraint.name,
      REFERENCED_TABLE_NAME: constraint.referencedTable,
      REFERENCED_COLUMN_NAME: key,
      ORDINAL_POSITION: index + 1,
    })));
  const physicalIndexes = [
    ...catalog.indexes,
    ...catalog.constraints
      .filter((constraint) => ['PRIMARY KEY', 'UNIQUE'].includes(constraint.type))
      .map((constraint) => ({
        name: `SYS_${constraint.name}`,
        table: constraint.table,
        unique: true,
        keys: constraint.keys.map((key) => `${key}:A`),
      })),
  ];
  const indexes = physicalIndexes.flatMap((index) => index.keys.map((key, ordinal) => {
    const [column, ordering] = key.split(':');
    return {
      TABLE_NAME: index.table,
      INDEX_NAME: index.name,
      IS_UNIQUE: index.unique ? 'U' : 'D',
      COLUMN_NAME: column,
      ORDINAL_POSITION: ordinal + 1,
      ORDERING: ordering,
    };
  }));
  return { columns, constraints, references, indexes };
}

function repositoryCatalogRows(contract) {
  const columns = [];
  const constraints = [];
  const indexes = [];
  for (const [table, key] of Object.entries(manifest.repositoryCatalog.tableKeys)) {
    Object.entries(contract.REQUIRED_COLUMN_MANIFEST[key]).forEach(([name, column], index) => {
      columns.push({
        TABLE_NAME: table,
        COLUMN_NAME: name,
        ORDINAL_POSITION: index + 1,
        DATA_TYPE: column.dataType,
        LENGTH: column.length,
        NUMERIC_PRECISION: column.numericPrecision,
        NUMERIC_SCALE: column.numericScale,
        IS_NULLABLE: column.isNullable,
        HAS_DEFAULT: column.hasDefault,
        COLUMN_DEFAULT: column.defaultValue,
        IS_IDENTITY: column.isIdentity,
        IDENTITY_GENERATION: column.identityGeneration,
        IDENTITY_START: column.identityStart,
        IDENTITY_INCREMENT: column.identityIncrement,
      });
    });
    contract.REQUIRED_CONSTRAINT_SIGNATURES[key].forEach((signature) => {
      const separator = signature.indexOf(':');
      const type = signature.slice(0, separator);
      const detail = signature.slice(separator + 1);
      constraints.push({
        TABLE_NAME: table,
        CONSTRAINT_TYPE: type,
        CHECK_CONDITION: type === 'CHECK' ? detail : '',
        KEY_COLUMNS: type === 'CHECK' ? '' : detail,
      });
    });
    contract.REQUIRED_INDEX_SIGNATURES[key].forEach((signature, index) => {
      const unique = signature[0];
      const keys = signature.slice(2).split(',');
      keys.forEach((keySignature, ordinal) => {
        const split = keySignature.lastIndexOf(':');
        indexes.push({
          TABLE_NAME: table,
          INDEX_NAME: `CATALOG_${key}_${index}`,
          IS_UNIQUE: unique,
          COLUMN_NAME: keySignature.slice(0, split),
          ORDINAL_POSITION: ordinal + 1,
          ORDERING: keySignature.slice(split + 1),
        });
      });
    });
  }
  return {
    columns,
    constraints,
    indexes,
    sequence: [{ ...contract.REQUIRED_SEQUENCE_METADATA }],
  };
}

describe('reparto isolated DDL pinned contract', () => {
  test('pins frozen paths, hashes, counts and object allowlists', () => {
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(manifest).toMatchObject({ dsn: 'GMP', schema: 'JAVIER' });
    expect(manifest.migrations['033']).toMatchObject({
      sha256: '75F229BE53F545E3F404E422010734566FA5B84BF1C110C89F2BD4A11D95F6CD',
      statementCount: 10,
    });
    expect(manifest.migrations['034']).toMatchObject({
      sha256: '11EB5954A87D66D96FCB3E2C859D182E1BAB24617D6E58E184FD91FE4E52CEA8',
      statementCount: 20,
    });
    expect(manifest.verifier).toMatchObject({
      sha256: 'AB5CFF817C7E0E9D88A421885170B693C08DC032BC76CFEA5DC608C9911A8520',
      statementCount: 9,
    });
    for (const entry of [...Object.values(manifest.migrations), manifest.verifier]) {
      expect(runner.sha256(sourceFor(entry))).toBe(entry.sha256);
      expect(runner.splitSql(sourceFor(entry))).toHaveLength(entry.statementCount);
    }
  });

  test('lexer respects strings, comments and DB2 terminator directives', () => {
    const sql = [
      "SELECT ';' AS VALUE FROM QSYS2.SYSDUMMY1; -- ignored ;",
      '--#SET TERMINATOR @',
      "BEGIN SET V = 'a@b;'; SET V = 'it''s safe'; END@",
      '--#SET TERMINATOR ;',
      '/* ; @ */ SELECT 2 FROM QSYS2.SYSDUMMY1;',
    ].join('\n');
    const statements = runner.splitSql(sql);
    expect(statements).toHaveLength(3);
    expect(statements[1]).toContain("'a@b;'");
    expect(statements[1]).toContain("'it''s safe'");
  });

  test.each([
    ['unclosed quote', "SELECT 'x;"],
    ['unclosed comment', 'SELECT 1 /* x'],
    ['unterminated statement', 'SELECT 1'],
  ])('lexer blocks %s', (_label, sql) => {
    expect(() => runner.splitSql(sql)).toThrow(runner.RunnerError);
  });

  test('validates the frozen DDL and read-only verifier', () => {
    expect(runner.validateDdlSource(
      sourceFor(manifest.migrations['033']),
      manifest.migrations['033'],
    )).toHaveLength(10);
    expect(runner.validateDdlSource(
      sourceFor(manifest.migrations['034']),
      manifest.migrations['034'],
    )).toHaveLength(20);
    expect(runner.validateVerifierSource(sourceFor(manifest.verifier))).toHaveLength(9);
  });

  test.each([
    "CREATE TABLE JAVIER.TEST_SAFE (ID INT); INSERT INTO JAVIER.TEST_SAFE VALUES (1);",
    "CREATE TABLE JAVIER.TEST_SAFE (ID INT); COMMIT;",
    "CREATE TABLE JAVIER.TEST_SAFE (ID INT); SELECT 1 FROM DSEDAC.CLI;",
  ])('blocks forbidden direct SQL: %s', (source) => {
    const entry = {
      statementCount: runner.splitSql(source).length,
      catalogMode: 'declarative_source',
      objects: { tables: ['TEST_SAFE'], indexes: [], sequences: [] },
    };
    expect(() => runner.validateDdlSource(source, entry)).toThrow('FORBIDDEN_SQL');
  });

  test.each([
    "BEGIN EXECUTE IMMEDIATE 'INSERT INTO JAVIER.TEST_SAFE VALUES (1)'; END@",
    "BEGIN EXECUTE IMMEDIATE 'CREATE TABLE DSEDAC.TEST_SAFE (ID INT)'; END@",
    'BEGIN EXECUTE IMMEDIATE V_SQL; END@',
    "BEGIN EXECUTE IMMEDIATE 'CREATE TABLE JAVIER.TEST_SAFE (ID INT)' || V_SQL; END@",
    "BEGIN EXECUTE IMMEDIATE CONCAT('CREATE TABLE JAVIER.TEST_SAFE (ID INT)'); END@",
    "BEGIN EXECUTE IMMEDIATE X'435245415445'; END@",
    "BEGIN EXECUTE IMMEDIATE 'CREATE TABLE JAVIER.TEST_SAFE (ID INT)' 'EXTRA'; END@",
    "BEGIN EXECUTE IMMEDIATE ('CREATE TABLE JAVIER.TEST_SAFE (ID INT)'); END@",
  ])('scans or rejects dynamic SQL: %s', (body) => {
    const source = `--#SET TERMINATOR @\n${body}\n--#SET TERMINATOR ;`;
    const entry = {
      statementCount: 1,
      catalogMode: 'sql_verifier_035',
      objects: { tables: ['TEST_SAFE'], indexes: [], sequences: [] },
    };
    expect(() => runner.validateDdlSource(source, entry)).toThrow(runner.RunnerError);
  });

  test.each([
    'CREATE TABLE TEST_SAFE (ID INT);',
    'CREATE TABLE JAVIER.TEST_SAFE (ID INT); SELECT 1 FROM CLI;',
    'CREATE TABLE JAVIER.TEST_SAFE (ID INT); SELECT 1 FROM JAVIER.CLI;',
    'ALTER TABLE TEST_SAFE ADD CONSTRAINT PK PRIMARY KEY (ID);',
    'CREATE UNIQUE INDEX JAVIER.IX_SAFE ON TEST_SAFE (ID);',
    'CREATE TABLE JAVIER.TEST_SAFE (ID INT REFERENCES OTHER_TABLE (ID));',
  ])('rejects unqualified or non-allowlisted relations: %s', (source) => {
    const entry = {
      statementCount: runner.splitSql(source).length,
      catalogMode: 'declarative_source',
      objects: { tables: ['TEST_SAFE'], indexes: ['IX_SAFE'], sequences: [] },
    };
    expect(() => runner.validateDdlSource(source, entry)).toThrow(runner.RunnerError);
  });

  test('accepts a single literal EXECUTE IMMEDIATE payload', () => {
    const source = [
      '--#SET TERMINATOR @',
      "BEGIN EXECUTE IMMEDIATE 'CREATE TABLE JAVIER.TEST_SAFE (ID INT)'; END@",
      '--#SET TERMINATOR ;',
    ].join('\n');
    const entry = {
      statementCount: 1,
      catalogMode: 'sql_verifier_035',
      objects: { tables: ['TEST_SAFE'], indexes: [], sequences: [] },
    };
    expect(runner.validateDdlSource(source, entry)).toHaveLength(1);
    expect(runner.dynamicSqlPayloads(runner.splitSql(source)[0])).toEqual([
      'CREATE TABLE JAVIER.TEST_SAFE (ID INT)',
    ]);
  });

  test.each([
    'UPDATE JAVIER.TEST_X SET X=1;',
    'CALL QSYS2.SOMETHING();',
    'CREATE TABLE JAVIER.TEST_X (ID INT);',
  ])('verifier rejects non-read-only SQL: %s', (source) => {
    expect(() => runner.validateVerifierSource(source)).toThrow(runner.RunnerError);
  });

  test('derives the full declarative 033 catalog from the pinned source', () => {
    const statements = runner.validateDdlSource(
      sourceFor(manifest.migrations['033']),
      manifest.migrations['033'],
    );
    const catalog = runner.deriveDeclarativeCatalog(statements);
    expect(catalog.tables).toHaveLength(4);
    expect(catalog.columns).toHaveLength(60);
    expect(catalog.constraints.map((item) => item.name).sort()).toEqual(
      [...manifest.migrations['033'].objects.constraints].sort(),
    );
    expect(catalog.indexes.map((item) => item.name).sort()).toEqual(
      [...manifest.migrations['033'].objects.indexes].sort(),
    );
    expect(catalog.constraints.find((item) => item.name === 'FK_TEST_REP_CONFIRM_SIGNATURE')).toMatchObject({
      referencedTable: 'TEST_REPARTO_EVIDENCIAS',
      referencedKeys: ['EVIDENCE_ID'],
    });
  });
});

describe('reparto isolated DDL arguments and dry-run', () => {
  test.each([
    [[]],
    [['--migration=032']],
    [['--migration', '033']],
    [['--migration=033', '--migration=034']],
    [['--migration=033', '--unknown=yes']],
    [['--migration=033', '--environment=production']],
    [['--migration=033', '--confirm=wrong']],
  ])('rejects invalid arguments: %j', (argv) => {
    expect(() => runner.parseArgs(argv)).toThrow(runner.RunnerError);
  });

  test('execution requires every exact guard', () => {
    expect(() => runner.parseArgs(['--migration=033', '--execute'])).toThrow('EXECUTION_GUARD_INCOMPLETE');
    expect(runner.parseArgs(executionArgs('033'))).toEqual({
      migration: '033',
      environment: 'isolated_test',
      confirm: 'JAVIER_TEST_DDL',
      execute: true,
    });
  });

  test.each(['033', '034', '035'])('default %s dry-run never opens ODBC', async (id) => {
    const odbc = { pool: jest.fn() };
    const logger = jest.fn();
    const result = await runner.executeSelection({ argv: [`--migration=${id}`], odbc, logger });
    expect(result).toMatchObject({ status: 'DRY_RUN', migration: id });
    expect(odbc.pool).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith(expect.objectContaining({ status: 'DRY_RUN' }));
  });

  test('connection string pins GMP/JAVIER and braces secrets', () => {
    const value = runner.connectionString({ ODBC_UID: 'user;name', ODBC_PWD: 'p}ass;word' });
    expect(value).toContain('DSN=GMP');
    expect(value).toContain('DBQ=JAVIER');
    expect(value).toContain('UID={user;name}');
    expect(value).toContain('PWD={p}}ass;word}');
    expect(() => runner.connectionString({ ODBC_UID: 'user\nnext', ODBC_PWD: 'x' })).toThrow('INVALID_ODBC_UID');
  });

  test('rejects a symlinked SQL file before reading it', () => {
    const fakeFs = {
      realpathSync: Object.assign((value) => value, { native: (value) => value }),
      lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => true }),
      readFileSync: jest.fn(),
    };
    expect(() => runner.loadPinnedSql(manifest.verifier, fakeFs)).toThrow('SQL_PATH_NOT_REGULAR_FILE');
    expect(fakeFs.readFileSync).not.toHaveBeenCalled();
  });
});

describe('reparto isolated DDL execution orchestration', () => {
  test('034 exact preflight returns ALREADY_VERIFIED without DDL', async () => {
    const entry = manifest.migrations['034'];
    const contract = runner.loadPinnedRepositoryCatalog();
    const catalogRows = repositoryCatalogRows(contract);
    let calls = 0;
    const harness = poolHarness(async (sql) => {
      calls += 1;
      if (calls === 1) return exactInventory(entry);
      if (sql.includes('FROM QSYS2.SYSCOLUMNS2')) return catalogRows.columns;
      if (sql.includes('FROM QSYS2.SYSCST')) return catalogRows.constraints;
      if (sql.includes('FROM QSYS2.SYSINDEXES I JOIN')) return catalogRows.indexes;
      if (sql.includes('FROM QSYS2.SYSSEQUENCES WHERE')) return catalogRows.sequence;
      return [];
    });
    const result = await runner.executeSelection({
      argv: executionArgs('034'), odbc: harness.odbc, env: testEnv(), logger: jest.fn(),
    });
    expect(result.status).toBe('ALREADY_VERIFIED');
    expect(harness.connection.query).toHaveBeenCalledTimes(14); // inventory + 9 SQL verifier + 4 exported-manifest checks
    expect(harness.connection.close).toHaveBeenCalledTimes(1);
    expect(harness.pool.close).toHaveBeenCalledTimes(1);
  });

  test('034 absent executes in order, fail-fast, then verifies exact postflight', async () => {
    const entry = manifest.migrations['034'];
    const contract = runner.loadPinnedRepositoryCatalog();
    const catalogRows = repositoryCatalogRows(contract);
    let calls = 0;
    const harness = poolHarness(async (sql) => {
      calls += 1;
      if (calls === 1) return [];
      if (calls === 22) return exactInventory(entry);
      if (sql.includes('FROM QSYS2.SYSCOLUMNS2')) return catalogRows.columns;
      if (sql.includes('FROM QSYS2.SYSCST')) return catalogRows.constraints;
      if (sql.includes('FROM QSYS2.SYSINDEXES I JOIN')) return catalogRows.indexes;
      if (sql.includes('FROM QSYS2.SYSSEQUENCES WHERE')) return catalogRows.sequence;
      return [];
    });
    const logger = jest.fn();
    const result = await runner.executeSelection({
      argv: executionArgs('034'), odbc: harness.odbc, env: testEnv(), logger,
    });
    expect(result.status).toBe('EXECUTED_AND_VERIFIED');
    expect(harness.connection.query).toHaveBeenCalledTimes(35); // preflight + 20 DDL + postflight + both exact verifiers
    const executed = logger.mock.calls.map(([event]) => event).filter((event) => event.status === 'EXECUTED');
    expect(executed.map((event) => event.label)).toEqual(entry.labels);
    expect(executed.map((event) => event.ordinal)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(harness.connection.close).toHaveBeenCalledTimes(1);
    expect(harness.pool.close).toHaveBeenCalledTimes(1);
  });

  test('partial or extra inventory blocks before any DDL', async () => {
    const entry = manifest.migrations['034'];
    const harness = poolHarness(async () => exactInventory(entry).slice(0, 1));
    await expect(runner.executeSelection({
      argv: executionArgs('034'), odbc: harness.odbc, env: testEnv(), logger: jest.fn(),
    })).rejects.toMatchObject({ code: 'CATALOG_DRIFT' });
    expect(harness.connection.query).toHaveBeenCalledTimes(1);
    expect(harness.connection.close).toHaveBeenCalledTimes(1);
    expect(harness.pool.close).toHaveBeenCalledTimes(1);
  });

  test('DDL error is never retried or skipped and reports partial unknown state only', async () => {
    let calls = 0;
    const dbError = Object.assign(new Error('secret SQL and data must never be logged'), {
      odbcErrors: [{ state: '58004', code: -901 }],
    });
    const harness = poolHarness(async () => {
      calls += 1;
      if (calls === 1) return [];
      throw dbError;
    });
    const logger = jest.fn();
    await expect(runner.executeSelection({
      argv: executionArgs('034'), odbc: harness.odbc, env: testEnv(), logger,
    })).rejects.toMatchObject({ code: 'PARTIAL_UNKNOWN_STATE' });
    expect(harness.connection.query).toHaveBeenCalledTimes(2);
    const event = logger.mock.calls.at(-1)[0];
    expect(event).toEqual(expect.objectContaining({
      ordinal: 1,
      sqlState: '58004',
      native: '-901',
      status: 'PARTIAL_UNKNOWN_STATE',
    }));
    expect(Object.keys(event).sort()).toEqual(['elapsedMs', 'label', 'native', 'ordinal', 'sqlState', 'status']);
    expect(JSON.stringify(event)).not.toContain('secret');
    expect(harness.connection.close).toHaveBeenCalledTimes(1);
    expect(harness.pool.close).toHaveBeenCalledTimes(1);
  });

  test('035 fails closed on any STOP token and still closes connection and pool', async () => {
    let calls = 0;
    const harness = poolHarness(async () => {
      calls += 1;
      if (calls === 4) return [{ OBJECT_NAME: 'redacted', STATUS: 'STOP_COLUMN_METADATA_DIFFERENT' }];
      return [];
    });
    const logger = jest.fn();
    await expect(runner.executeSelection({
      argv: executionArgs('035'), odbc: harness.odbc, env: testEnv(), logger,
    })).rejects.toMatchObject({ code: 'CATALOG_DRIFT' });
    expect(harness.connection.query).toHaveBeenCalledTimes(4);
    expect(logger.mock.calls.at(-1)[0]).toMatchObject({
      ordinal: 4,
      status: 'STOP_COLUMN_METADATA_DIFFERENT',
    });
    expect(harness.connection.close).toHaveBeenCalledTimes(1);
    expect(harness.pool.close).toHaveBeenCalledTimes(1);
  });

  test('033 exact catalog returns ALREADY_VERIFIED using full source-derived metadata', async () => {
    const entry = manifest.migrations['033'];
    const statements = runner.validateDdlSource(sourceFor(entry), entry);
    const catalog = runner.deriveDeclarativeCatalog(statements);
    const rows = declarativeRows(catalog);
    const harness = poolHarness(async (sql) => {
      if (sql.startsWith("SELECT 'TABLE'")) return exactInventory(entry);
      if (sql.includes('FROM QSYS2.SYSCOLUMNS2')) return rows.columns;
      if (sql.includes('FROM QSYS2.SYSREFCST')) return rows.references;
      if (sql.includes('FROM QSYS2.SYSCST')) return rows.constraints;
      if (sql.includes('FROM QSYS2.SYSINDEXES')) return rows.indexes;
      throw new Error('unexpected mocked query');
    });
    const result = await runner.executeSelection({
      argv: executionArgs('033'), odbc: harness.odbc, env: testEnv(), logger: jest.fn(),
    });
    expect(result.status).toBe('ALREADY_VERIFIED');
    expect(harness.connection.query).toHaveBeenCalledTimes(5);
    expect(harness.connection.close).toHaveBeenCalledTimes(1);
    expect(harness.pool.close).toHaveBeenCalledTimes(1);
  });

  test('033 metadata drift blocks and does not execute DDL', async () => {
    const entry = manifest.migrations['033'];
    const statements = runner.validateDdlSource(sourceFor(entry), entry);
    const catalog = runner.deriveDeclarativeCatalog(statements);
    const rows = declarativeRows(catalog);
    rows.columns[0] = { ...rows.columns[0], DATA_TYPE: 'SMALLINT' };
    const harness = poolHarness(async (sql) => {
      if (sql.startsWith("SELECT 'TABLE'")) return exactInventory(entry);
      if (sql.includes('FROM QSYS2.SYSCOLUMNS2')) return rows.columns;
      if (sql.includes('FROM QSYS2.SYSREFCST')) return rows.references;
      if (sql.includes('FROM QSYS2.SYSCST')) return rows.constraints;
      if (sql.includes('FROM QSYS2.SYSINDEXES')) return rows.indexes;
      return [];
    });
    await expect(runner.executeSelection({
      argv: executionArgs('033'), odbc: harness.odbc, env: testEnv(), logger: jest.fn(),
    })).rejects.toMatchObject({ code: 'CATALOG_DRIFT' });
    expect(harness.connection.query).toHaveBeenCalledTimes(5);
  });

  test('pool and connection close even when verifier query throws', async () => {
    const harness = poolHarness(async () => {
      throw Object.assign(new Error('sensitive'), { odbcErrors: [{ state: '08001', code: -30082 }] });
    });
    const logger = jest.fn();
    await expect(runner.executeSelection({
      argv: executionArgs('035'), odbc: harness.odbc, env: testEnv(), logger,
    })).rejects.toMatchObject({ code: 'VERIFIER_QUERY_FAILED' });
    expect(logger.mock.calls[0][0]).toEqual(expect.objectContaining({
      status: 'FAILED', sqlState: '08001', native: '-30082',
    }));
    expect(JSON.stringify(logger.mock.calls)).not.toContain('sensitive');
    expect(harness.connection.close).toHaveBeenCalledTimes(1);
    expect(harness.pool.close).toHaveBeenCalledTimes(1);
  });
});
