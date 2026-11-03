'use strict';

const fs = require('fs');
const path = require('path');
const {
  TARGET, EXPECTED_SOURCE_ROWS, EXPECTED_ACTIVE_ROWS, EXPECTED_SOURCE_FINGERPRINT, EXPECTED_CHECKS,
  EXPECTED_CHECK_CLAUSES, TARGET_COLUMNS, SOURCE_SQL, INSERT_SQL, NATIVE_MISMATCH_SQL,
  INITIAL_POLICY_MISMATCH_SQL, TARGET_COUNT_SQL,
  canonicalSourceRows, snapshotFingerprint, parseArgs, assertSeedProfile, verifyTarget,
  seedPolicySnapshot, safeCliError, main,
} = require('../scripts/tools/seed-test-politica-precio-art');

const TEST_ENV = Object.freeze({
  APP_ENV: 'test', REPARTO_TABLE_SET: 'isolated_test', DB2_READ_SCHEMA: 'DSEDAC',
  DB2_WRITE_SCHEMA: 'JAVIER', REPARTO_WRITES_ENABLED: 'true',
  PEDIDOS_EXPORT_TO_SYSTEM: 'false',
});

function sourceRows() {
  return Array.from({ length: EXPECTED_SOURCE_ROWS }, (_, index) => {
    const active = index < EXPECTED_ACTIVE_ROWS;
    const mode = index % 4;
    const candidate = mode < 2;
    return {
      CODIGOARTICULO: String(index + 1),
      DESCRIPCIONARTICULO: index === 0 ? 'CUÑA NATIVA' : `Artículo ${index + 1}`,
      UNIDAD_ERP: index === 0 ? 'CUÑA' : (index % 2 ? 'CAJA' : 'UNIDAD'),
      UNIDADES_CAJA: '12.00000',
      ANO_BAJA: active ? '0' : '2021',
      ACTIVO_SN: active ? 'S' : 'N',
      TARIFA_CANDIDATA_CODIGO: candidate ? (mode === 0 ? '2' : '1') : null,
      PRECIO_CANDIDATO: candidate ? '29.2800' : null,
      TARIFA_VARIANTES: mode === 2 ? 0 : (mode === 3 ? 2 : 1),
      TARIFA_ESTADO: ['PRESENTE', 'ALTERNATIVA', 'AUSENTE', 'CONFLICTIVA'][mode],
    };
  });
}

const TEST_SOURCE_FINGERPRINT = snapshotFingerprint(canonicalSourceRows(sourceRows()));
const TEST_SEED_OPTIONS = Object.freeze({ expectedSourceFingerprint: TEST_SOURCE_FINGERPRINT });

function columnRows() {
  return TARGET_COLUMNS.map(([name, type, size, scale, nullable]) => ({
    COLUMN_NAME: name,
    DATA_TYPE: type === 'TIMESTAMP' ? 'TIMESTMP' : type,
    LENGTH: ['CHAR', 'VARCHAR'].includes(type) ? size
      : (type === 'TIMESTAMP' ? 10 : (type === 'INTEGER' ? 4 : 0)),
    NUMERIC_PRECISION: ['DECIMAL', 'INTEGER'].includes(type) ? size : null,
    NUMERIC_SCALE: scale,
    IS_NULLABLE: nullable,
  }));
}

function metadataResult(sql) {
  if (/QSYS2\.SYSTABLES/i.test(sql)) return [{ SYSTEM_TABLE_NAME: 'TEST_00420' }];
  if (/QSYS2\.SYSCOLUMNS/i.test(sql)) return columnRows();
  if (/QSYS2\.SYSKEYCST/i.test(sql)) return [{
    CONSTRAINT_TYPE: 'PRIMARY KEY', ENABLED: 'YES',
    COLUMN_NAME: 'CODIGOARTICULO', ORDINAL_POSITION: 1,
  }];
  if (/QSYS2\.SYSCHKCST/i.test(sql)) return EXPECTED_CHECKS.map((name) => ({
    CONSTRAINT_NAME: name, ENABLED: 'YES', CHECK_CLAUSE: EXPECTED_CHECK_CLAUSES[name],
  }));
  if (/OBJECT_STATISTICS/i.test(sql)) return [{
    JOURNALED: 'YES', JOURNAL_LIBRARY: 'JAVIER', JOURNAL_NAME: 'QSQJRN', JOURNAL_IMAGES: '*BOTH',
  }];
  return undefined;
}

function mockConnection({ before = 0, after = 6235, mismatches = 0,
  initialPolicyMismatches = 0, insertError = null, rollbackError = null, closeError = null } = {}) {
  const rows = sourceRows();
  let countReads = 0;
  const connection = {
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: rollbackError
      ? jest.fn().mockRejectedValue(rollbackError)
      : jest.fn().mockResolvedValue(undefined),
    close: closeError
      ? jest.fn().mockRejectedValue(closeError)
      : jest.fn().mockResolvedValue(undefined),
    query: jest.fn((sql, params = []) => {
      const metadata = metadataResult(sql);
      if (metadata !== undefined) return Promise.resolve(metadata);
      if (/^SET TRANSACTION/i.test(sql) || /^LOCK TABLE/i.test(sql)) return Promise.resolve([]);
      if (sql === SOURCE_SQL) return Promise.resolve(rows);
      if (sql === TARGET_COUNT_SQL) {
        const value = countReads++ === 0 ? before : after;
        return Promise.resolve([{ N: value }]);
      }
      if (sql === INSERT_SQL) {
        return insertError ? Promise.reject(insertError) : Promise.resolve([]);
      }
      if (sql === NATIVE_MISMATCH_SQL) return Promise.resolve([{ N: mismatches }]);
      if (sql === INITIAL_POLICY_MISMATCH_SQL) return Promise.resolve([{ N: initialPolicyMismatches }]);
      return Promise.reject(new Error(`Unexpected SQL: ${sql}; binds=${params.length}`));
    }),
  };
  return { connection, rows };
}

describe('sealed TEST product pricing-policy snapshot', () => {
  test('migration is additive, fixed to TEST, and protects unverified policy fields', () => {
    const sql = fs.readFileSync(
      path.resolve(__dirname, '../migrations/050_javier_test_politica_precio_art.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE JAVIER\.TEST_POLITICA_PRECIO_ART/i);
    expect(sql).toMatch(/SET CURRENT SCHEMA JAVIER;\s*CREATE TABLE JAVIER\.TEST_POLITICA_PRECIO_ART/i);
    expect(sql).toMatch(/PRIMARY KEY \(CODIGOARTICULO\)/i);
    expect(sql).toMatch(/TARIFA_ESTADO IN \('AUSENTE', 'PRESENTE', 'ALTERNATIVA', 'CONFLICTIVA'\)/i);
    expect(sql).toMatch(/CK_TEST_PPA_TARIFA_CANDIDATE/i);
    expect(sql).toMatch(/CK_TEST_PPA_UNPROVEN/i);
    expect(sql).not.toMatch(/CREATE TABLE DSEDAC|INSERT INTO DSEDAC|UPDATE DSEDAC|DELETE FROM DSEDAC/i);
    expect(sql).not.toMatch(/IDENTITY|DROP TABLE|TRUNCATE/i);
  });

  test('classifies 6235 unique ART rows and retains original candidate tariff codes', () => {
    const normalized = canonicalSourceRows(sourceRows());
    expect(normalized).toHaveLength(6235);
    expect(normalized.filter((row) => row.activeFlag === 'S')).toHaveLength(2937);
    expect(normalized[0]).toMatchObject({ tariffState: 'PRESENTE', candidateTariffCode: '2' });
    expect(normalized[1]).toMatchObject({ tariffState: 'ALTERNATIVA', candidateTariffCode: '1' });
    expect(normalized[2]).toMatchObject({ tariffState: 'AUSENTE', candidateTariffCode: null });
    expect(normalized[3]).toMatchObject({ tariffState: 'CONFLICTIVA', candidatePrice: null });
    expect(normalized.every((row) => row.unitState === 'NO_VERIFICADA'
      && row.manufacturingCost === null && row.targetMarginPct === null)).toBe(true);
    expect(SOURCE_SQL).toMatch(/WHERE TRIM\(A\.CODIGOARTICULO\) <> ''/);
  });

  test('fingerprint includes native description and UOM evidence', () => {
    const first = canonicalSourceRows(sourceRows());
    const secondRows = sourceRows();
    secondRows[0].DESCRIPCIONARTICULO = 'CUÑA CAMBIADA';
    const second = canonicalSourceRows(secondRows);
    expect(snapshotFingerprint(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshotFingerprint(second)).not.toBe(snapshotFingerprint(first));
    expect(EXPECTED_SOURCE_FINGERPRINT).toBe('64f2a6c72049ea4d232c8e7b1862c7f48770f116d3ad7a3468dffa897843993b');
  });

  test('rejects duplicate or changed source cardinality', () => {
    const duplicate = sourceRows();
    duplicate[1].CODIGOARTICULO = duplicate[0].CODIGOARTICULO;
    expect(() => canonicalSourceRows(duplicate)).toThrow(expect.objectContaining({ code: 'POLICY_SOURCE_ROW_INVALID' }));
    expect(() => canonicalSourceRows(sourceRows().slice(1))).toThrow(expect.objectContaining({ code: 'POLICY_SOURCE_COUNT_MISMATCH' }));
  });

  test.each([
    { ...TEST_ENV, APP_ENV: 'production', REPARTO_TABLE_SET: 'production' },
    { ...TEST_ENV, DB2_READ_SCHEMA: 'JAVIER' },
    { ...TEST_ENV, DB2_WRITE_SCHEMA: 'DSEDAC' },
    { ...TEST_ENV, REPARTO_WRITES_ENABLED: 'false' },
    { ...TEST_ENV, PEDIDOS_EXPORT_TO_SYSTEM: 'true' },
  ])('rejects unsafe or contradictory profiles %#', (env) => {
    expect(() => assertSeedProfile(env)).toThrow(expect.objectContaining({ code: 'POLICY_SEED_PROFILE_INVALID' }));
  });

  test('accepts coherent TEST and DEMO isolated profiles', () => {
    expect(assertSeedProfile(TEST_ENV).profile).toBe('test');
    expect(assertSeedProfile({ ...TEST_ENV, APP_ENV: 'demo' }).profile).toBe('demo');
  });

  test('parses only an exact empty or --apply argument list', () => {
    expect(parseArgs(['node', 'seed'])).toEqual({ apply: false });
    expect(parseArgs(['node', 'seed', '--apply'])).toEqual({ apply: true });
    for (const argv of [
      ['node', 'seed', '--apply', '--apply'], ['node', 'seed', '--dry-run'],
      ['node', 'seed', '--apply=true'], ['node', 'seed', ' --apply'],
    ]) expect(() => parseArgs(argv)).toThrow(expect.objectContaining({ code: 'POLICY_SEED_ARGS_INVALID' }));
  });

  test('verifies exact columns, enabled PK/checks, and journal with catalog binds', async () => {
    const { connection } = mockConnection();
    await expect(verifyTarget(connection)).resolves.toBe(true);
    expect(columnRows().find((row) => row.COLUMN_NAME === 'TARIFA_VARIANTES')).toMatchObject({
      DATA_TYPE: 'INTEGER', LENGTH: 4, NUMERIC_PRECISION: 9, NUMERIC_SCALE: 0,
    });
    expect(connection.query).toHaveBeenCalledWith(expect.stringMatching(/QSYS2\.SYSTABLES/), ['JAVIER', 'TEST_POLITICA_PRECIO_ART']);
    expect(connection.query).toHaveBeenCalledWith(expect.stringMatching(/QSYS2\.SYSCHKCST/), ['JAVIER', 'TEST_POLITICA_PRECIO_ART']);
    expect(connection.query).toHaveBeenCalledWith(expect.stringMatching(/OBJECT_STATISTICS/), ['TEST_00420']);
  });

  test('rejects the previous non-native INTEGER precision while preserving strict schema checks', async () => {
    const { connection } = mockConnection();
    const original = connection.query;
    connection.query = jest.fn((sql, params) => {
      if (/QSYS2\.SYSCOLUMNS/i.test(sql)) {
        return Promise.resolve(columnRows().map((row) => (
          row.COLUMN_NAME === 'TARIFA_VARIANTES' ? { ...row, NUMERIC_PRECISION: 10 } : row
        )));
      }
      return original(sql, params);
    });
    await expect(verifyTarget(connection)).rejects.toMatchObject({
      code: 'POLICY_TARGET_SCHEMA_MISMATCH',
    });
  });

  test('refuses a missing enabled check before beginning a transaction', async () => {
    const { connection } = mockConnection();
    const original = connection.query;
    connection.query = jest.fn((sql, params) => {
      if (/QSYS2\.SYSCHKCST/i.test(sql)) return Promise.resolve(metadataResult(sql).slice(1));
      return original(sql, params);
    });
    await expect(seedPolicySnapshot(connection, TEST_ENV, TEST_SEED_OPTIONS)).rejects.toMatchObject({ code: 'POLICY_TARGET_CHECK_MISMATCH' });
    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });

  test('refuses a CHECK with the right name but a weakened semantic body', async () => {
    const { connection } = mockConnection();
    const original = connection.query;
    connection.query = jest.fn((sql, params) => {
      if (/QSYS2\.SYSCHKCST/i.test(sql)) {
        const rows = metadataResult(sql).map((row) => ({ ...row }));
        rows[0].CHECK_CLAUSE = `${rows[0].CHECK_CLAUSE} OR 1=1`;
        return Promise.resolve(rows);
      }
      return original(sql, params);
    });
    await expect(seedPolicySnapshot(connection, TEST_ENV, TEST_SEED_OPTIONS)).rejects.toMatchObject({ code: 'POLICY_TARGET_CHECK_MISMATCH' });
    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });

  test('initial load uses one server-side INSERT SELECT and validates native equality', async () => {
    const { connection, rows } = mockConnection({ before: 0, after: 6235, mismatches: 0 });
    const expectedFingerprint = snapshotFingerprint(canonicalSourceRows(rows));
    await expect(seedPolicySnapshot(connection, TEST_ENV, TEST_SEED_OPTIONS)).resolves.toEqual({
      source: 6235, inserted: 6235, updated: 0, unchanged: 0, fingerprint: expectedFingerprint,
    });
    expect(connection.query).toHaveBeenCalledWith(INSERT_SQL, [expectedFingerprint]);
    expect(connection.query).toHaveBeenCalledWith(NATIVE_MISMATCH_SQL, [expectedFingerprint]);
    expect(connection.query).toHaveBeenCalledWith(INITIAL_POLICY_MISMATCH_SQL, []);
    expect(INSERT_SQL).toMatch(/FROM DSEDAC\.ART/);
    expect(INSERT_SQL).toMatch(/FROM DSEDAC\.ARA/);
    expect(INSERT_SQL).toMatch(
      /CAST\(NULL AS DECIMAL\(11,4\)\),CAST\(NULL AS DECIMAL\(7,4\)\),CAST\(NULL AS DECIMAL\(11,4\)\)/,
    );
    expect(INSERT_SQL).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+DSEDAC/i);
    expect(connection.commit).toHaveBeenCalledTimes(1);
  });

  test('native INSERT keeps every unverified policy value null with explicit DB2 types', () => {
    const normalized = canonicalSourceRows(sourceRows());
    expect(normalized.every((row) => row.manufacturingCost === null
      && row.targetMarginPct === null && row.minimumPrice === null)).toBe(true);
    expect(INSERT_SQL.match(/CAST\(NULL AS DECIMAL\(/g)).toHaveLength(3);
  });

  test('identical replay performs no DML and preserves legitimate policy enrichment', async () => {
    const { connection } = mockConnection({ before: 6235, after: 6235, mismatches: 0 });
    await expect(seedPolicySnapshot(connection, TEST_ENV, TEST_SEED_OPTIONS)).resolves.toMatchObject({
      inserted: 0, updated: 0, unchanged: 6235,
    });
    const sql = connection.query.mock.calls.map(([statement]) => statement);
    expect(sql).not.toContain(INSERT_SQL);
    expect(sql).toContain(NATIVE_MISMATCH_SQL);
    expect(sql).not.toContain(INITIAL_POLICY_MISMATCH_SQL);
    expect(NATIVE_MISMATCH_SQL).not.toMatch(/COSTE_FABRICACION|MARGEN_OBJETIVO_PCT|PRECIO_MINIMO/);
  });

  test('matching count alone cannot hide changed source or protected policy fields', async () => {
    const { connection } = mockConnection({ before: 6235, after: 6235, mismatches: 1 });
    await expect(seedPolicySnapshot(connection, TEST_ENV, TEST_SEED_OPTIONS)).rejects.toMatchObject({ code: 'POLICY_SNAPSHOT_DRIFT' });
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    const sql = connection.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).not.toMatch(/UPDATE JAVIER\.TEST_POLITICA|DELETE FROM JAVIER\.TEST_POLITICA/i);
    expect(NATIVE_MISMATCH_SQL).toMatch(/DESCRIPCIONARTICULO/);
  });

  test('initial load rolls back if policy fields are not pristine after insert', async () => {
    const { connection } = mockConnection({
      before: 0, after: 6235, mismatches: 0, initialPolicyMismatches: 1,
    });
    await expect(seedPolicySnapshot(connection, TEST_ENV, TEST_SEED_OPTIONS)).rejects.toMatchObject({ code: 'POLICY_SNAPSHOT_DRIFT' });
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
  });

  test('rollback failure never masks the original insertion error', async () => {
    const original = Object.assign(new Error('initial insert failed'), { code: 'INITIAL_INSERT_FAILED' });
    const rollback = Object.assign(new Error('rollback secret'), { code: 'ROLLBACK_FAILED' });
    const { connection } = mockConnection({ before: 0, insertError: original, rollbackError: rollback });
    await expect(seedPolicySnapshot(connection, TEST_ENV, TEST_SEED_OPTIONS)).rejects.toBe(original);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  test('dry run never connects and diagnostics never expose external error data', async () => {
    const output = [];
    const connect = jest.fn();
    await main({ env: { ...TEST_ENV }, argv: ['node', 'seed'], loadEnvironment: jest.fn(),
      applyProfile: jest.fn(), openConnection: connect, stdout: (line) => output.push(JSON.parse(line)) });
    expect(connect).not.toHaveBeenCalled();
    expect(output[0]).toMatchObject({ dryRun: true, target: TARGET, mutationEnabled: false });
    const safe = safeCliError({ code: 'bad;PWD=secret', message: 'DSN=GMP;PWD=secret' });
    expect(safe).toEqual({ error: 'POLICY_SEED_FAILED' });
    expect(JSON.stringify(safe)).not.toMatch(/pwd=|dsn=|secret|gmp/i);
  });

  test('does not print success if physical close fails', async () => {
    const closeError = Object.assign(new Error('physical close failed'), { code: 'CLOSE_FAILED' });
    const { connection } = mockConnection({ before: 6235, after: 6235, mismatches: 0, closeError });
    const stdout = jest.fn();
    await expect(main({ env: { ...TEST_ENV }, argv: ['node', 'seed', '--apply'],
      loadEnvironment: jest.fn(), applyProfile: jest.fn(),
      openConnection: jest.fn().mockResolvedValue(connection), stdout,
      seedOptions: TEST_SEED_OPTIONS })).rejects.toBe(closeError);
    expect(stdout).not.toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.close).toHaveBeenCalledTimes(1);
  });
});
