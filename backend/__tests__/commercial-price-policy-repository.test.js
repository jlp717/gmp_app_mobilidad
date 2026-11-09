'use strict';

const { createCommercialPricePolicyRepository } = require('../repositories/commercial-price-policy.repository');
const { createCommercialPricePolicyService } = require('../services/commercial-price-policy');
const fs = require('fs');
const path = require('path');

const PROFILE = { profile: 'test', verified: true, readSchema: 'DSEDAC', writeSchema: 'JAVIER', tableSet: 'isolated_test', writesEnabled: true, productionWritesEnabled: false, erpExportEnabled: false };
const ACTOR = { code: '80', role: 'JEFE_VENTAS' };
const KEY = 'adf45c52-0c3a-47e1-a814-02ae4d4fb825';
const BODY = { confirmed: true, expectedRevision: 0, reason: 'Coste revisado', policyUnit: 'UNIDADES', manufacturingCost: '0.8', targetMarginPct: '20', minimumPrice: null, minimumOrigin: 'ERP_BASE' };
const POLICY_COLUMNS = 'CODIGOARTICULO DESCRIPCIONARTICULO UNIDAD_ERP UNIDADES_CAJA ANO_BAJA ACTIVO_SN TARIFA_CANDIDATA_CODIGO PRECIO_CANDIDATO TARIFA_VARIANTES TARIFA_ESTADO UNIDAD_ESTADO POLITICA_ESTADO COSTE_FABRICACION MARGEN_OBJETIVO_PCT PRECIO_MINIMO SOURCE_FINGERPRINT SOURCE_SNAPSHOT_AT CREATED_AT UPDATED_AT UNIDAD_POLITICA MINIMO_ORIGEN POLITICA_REVISION POLITICA_UPDATED_BY POLITICA_UPDATED_AT'.split(' ');
const AUDIT_COLUMNS = 'ID CODIGOARTICULO ACTION REVISION_PREVIA POLITICA_REVISION UNIDAD_PREVIA UNIDAD_NUEVA COSTE_PREVIO COSTE_NUEVO MARGEN_PREVIO MARGEN_NUEVO MINIMO_PREVIO MINIMO_NUEVO ORIGEN_PREVIO ORIGEN_NUEVO UNIDAD_ESTADO_PREVIO UNIDAD_ESTADO_NUEVO POLITICA_ESTADO_PREVIO POLITICA_ESTADO_NUEVO SOURCE_PREVIO SOURCE_NUEVO ACTOR_CODE ACTOR_ROLE REASON REQUEST_KEY PAYLOAD_HASH CREATED_AT'.split(' ');
const CHECKS = [
  '(COSTE_FABRICACION IS NULL AND MARGEN_OBJETIVO_PCT IS NULL) OR (COSTE_FABRICACION IS NOT NULL AND MARGEN_OBJETIVO_PCT IS NOT NULL AND COSTE_FABRICACION >= 0 AND MARGEN_OBJETIVO_PCT >= 0 AND MARGEN_OBJETIVO_PCT < 100)',
  "MINIMO_ORIGEN IN ('ERP_BASE','MANUAL')", 'PRECIO_MINIMO IS NULL OR PRECIO_MINIMO >= 0',
  "UNIDAD_POLITICA IS NULL OR UNIDAD_POLITICA IN ('CAJAS','KILO','UNIDADES')", 'POLITICA_REVISION >= 0',
  "(MINIMO_ORIGEN = 'ERP_BASE' AND PRECIO_MINIMO IS NULL) OR (MINIMO_ORIGEN = 'MANUAL' AND PRECIO_MINIMO IS NOT NULL AND PRECIO_MINIMO >= 0)",
];
const AUDIT_CHECKS = ["ACTION IN ('CREATE','UPDATE','UOM_CONFLICT','REFRESH')", 'REVISION_PREVIA >= 0 AND POLITICA_REVISION >= REVISION_PREVIA', "ACTOR_ROLE IN ('ADMIN','JEFE_VENTAS','SYSTEM_REFRESH')"];
function catalogColumns(policyName, auditName) {
  const column = (TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH, IS_NULLABLE, NUMERIC_PRECISION = null, NUMERIC_SCALE = null, defaults = {}) => ({ TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH, IS_NULLABLE, NUMERIC_PRECISION, NUMERIC_SCALE, HAS_DEFAULT: 'N', COLUMN_DEFAULT: null, IS_IDENTITY: 'NO', IDENTITY_GENERATION: null, ...defaults });
  const policy = (name, type, length, nullable, precision, scale, defaults) => column(policyName, name, type, length, nullable, precision, scale, defaults);
  const audit = (name, type, length, nullable, precision, scale, defaults) => column(auditName, name, type, length, nullable, precision, scale, defaults);
  const timestampDefault = { HAS_DEFAULT: 'Y', COLUMN_DEFAULT: 'CURRENT TIMESTAMP' };
  return [
    policy('CODIGOARTICULO', 'CHAR', 10, 'N'), policy('DESCRIPCIONARTICULO', 'CHAR', 40, 'N'), policy('UNIDAD_ERP', 'CHAR', 10, 'N'),
    policy('UNIDADES_CAJA', 'DECIMAL', 10, 'N', 10, 5), policy('ANO_BAJA', 'DECIMAL', 4, 'N', 4, 0), policy('ACTIVO_SN', 'CHAR', 1, 'N'),
    policy('TARIFA_CANDIDATA_CODIGO', 'DECIMAL', 2, 'Y', 2, 0), policy('PRECIO_CANDIDATO', 'DECIMAL', 9, 'Y', 9, 4), policy('TARIFA_VARIANTES', 'INTEGER', 4, 'N', 9, 0),
    policy('TARIFA_ESTADO', 'VARCHAR', 24, 'N'), policy('UNIDAD_ESTADO', 'VARCHAR', 24, 'N'), policy('POLITICA_ESTADO', 'VARCHAR', 32, 'N'),
    policy('COSTE_FABRICACION', 'DECIMAL', 11, 'Y', 11, 4), policy('MARGEN_OBJETIVO_PCT', 'DECIMAL', 7, 'Y', 7, 4), policy('PRECIO_MINIMO', 'DECIMAL', 11, 'Y', 11, 4), policy('SOURCE_FINGERPRINT', 'CHAR', 64, 'N'),
    ...['SOURCE_SNAPSHOT_AT', 'CREATED_AT', 'UPDATED_AT'].map((name) => policy(name, 'TIMESTMP', 10, 'N', null, null, timestampDefault)),
    policy('UNIDAD_POLITICA', 'VARCHAR', 12, 'Y'), policy('MINIMO_ORIGEN', 'VARCHAR', 12, 'N', null, null, { HAS_DEFAULT: 'Y', COLUMN_DEFAULT: "'ERP_BASE'" }),
    policy('POLITICA_REVISION', 'INTEGER', 4, 'N', 9, 0, { HAS_DEFAULT: 'Y', COLUMN_DEFAULT: '0' }), policy('POLITICA_UPDATED_BY', 'VARCHAR', 40, 'Y'), policy('POLITICA_UPDATED_AT', 'TIMESTMP', 10, 'Y'),
    audit('ID', 'INTEGER', 4, 'N', 9, 0, { IS_IDENTITY: 'YES', IDENTITY_GENERATION: 'ALWAYS' }), audit('CODIGOARTICULO', 'CHAR', 10, 'N'), audit('ACTION', 'VARCHAR', 24, 'N'),
    audit('REVISION_PREVIA', 'INTEGER', 4, 'N', 9, 0), audit('POLITICA_REVISION', 'INTEGER', 4, 'N', 9, 0),
    ...['UNIDAD_PREVIA', 'UNIDAD_NUEVA'].map((name) => audit(name, 'VARCHAR', 12, 'Y')),
    ...['COSTE_PREVIO', 'COSTE_NUEVO', 'MINIMO_PREVIO', 'MINIMO_NUEVO'].map((name) => audit(name, 'DECIMAL', 11, 'Y', 11, 4)),
    ...['MARGEN_PREVIO', 'MARGEN_NUEVO'].map((name) => audit(name, 'DECIMAL', 7, 'Y', 7, 4)),
    ...['ORIGEN_PREVIO', 'ORIGEN_NUEVO'].map((name) => audit(name, 'VARCHAR', 12, 'N')),
    ...['UNIDAD_ESTADO_PREVIO', 'UNIDAD_ESTADO_NUEVO'].map((name) => audit(name, 'VARCHAR', 24, 'N')),
    ...['POLITICA_ESTADO_PREVIO', 'POLITICA_ESTADO_NUEVO'].map((name) => audit(name, 'VARCHAR', 32, 'N')),
    ...['SOURCE_PREVIO', 'SOURCE_NUEVO'].map((name) => audit(name, 'CHAR', 64, 'N')),
    audit('ACTOR_CODE', 'VARCHAR', 40, 'N'), audit('ACTOR_ROLE', 'VARCHAR', 24, 'N'), audit('REASON', 'VARCHAR', 250, 'N'), audit('REQUEST_KEY', 'VARCHAR', 96, 'N'), audit('PAYLOAD_HASH', 'CHAR', 64, 'N'),
    audit('CREATED_AT', 'TIMESTMP', 10, 'N', null, null, timestampDefault),
  ];
}

// Transactional memory port simulates committed state, row-lock waiting and rollback.
// SQL is still produced by the real repository; no native DB2 mutations occur.
function fixture(options = {}) {
  const profile = options.profile || PROFILE;
  const policyName = profile.profile === 'production' ? 'POLITICA_PRECIO_ART' : 'TEST_POLITICA_PRECIO_ART';
  const auditName = `${policyName}_AUDIT`;
  const state = { row: {
    CODIGOARTICULO: '1001      ', DESCRIPCIONARTICULO: 'Artículo ejemplo', UNIDAD_ERP: '          ', UNIDADES_CAJA: '9', ANO_BAJA: 0, ACTIVO_SN: 'S',
    TARIFA_CANDIDATA_CODIGO: 2, PRECIO_CANDIDATO: '6.9000', TARIFA_VARIANTES: 1, TARIFA_ESTADO: 'PRESENTE', UNIDAD_ESTADO: 'NO_VERIFICADA', POLITICA_ESTADO: 'UOM_NO_VERIFICADA',
    COSTE_FABRICACION: null, MARGEN_OBJETIVO_PCT: null, PRECIO_MINIMO: null, SOURCE_FINGERPRINT: 'a'.repeat(64), SOURCE_SNAPSHOT_AT: '2026-11-05',
    UNIDAD_POLITICA: null, MINIMO_ORIGEN: 'ERP_BASE', POLITICA_REVISION: 0,
  }, audit: [] };
  const calls = [], connections = [];
  let lock = Promise.resolve();
  const acquireConnection = jest.fn(async () => {
    let staged = null, pendingAudit = null, unlock = null;
    const connection = {
      beginTransaction: jest.fn(async () => {}),
      commit: jest.fn(async () => { if (staged) state.row = staged; if (pendingAudit) state.audit.push(pendingAudit); unlock?.(); unlock = null; }),
      rollback: jest.fn(async () => { staged = null; pendingAudit = null; unlock?.(); unlock = null; }),
      close: jest.fn(async () => {}),
      query: jest.fn(async (sql, params = []) => {
        calls.push({ sql, params });
        if ((sql.match(/\?/g) || []).length !== params.length) throw new Error('placeholder mismatch');
        if (sql.includes('QSYS2.SYSTABLES')) return options.missingTable ? [] : [{ TABLE_NAME: policyName, SYSTEM_TABLE_NAME: 'PPA' }, { TABLE_NAME: auditName, SYSTEM_TABLE_NAME: 'PPAAUD' }];
        if (sql.includes('QSYS2.SYSCOLUMNS')) return catalogColumns(policyName, auditName).filter((row) => row.COLUMN_NAME !== options.missingColumn).map((row) => ({ ...row,
          ...options.badScale && row.TABLE_NAME === policyName && row.COLUMN_NAME === 'PRECIO_MINIMO' ? { NUMERIC_SCALE: 2 } : {},
          ...options.columnChange && row.TABLE_NAME === (options.columnChange.audit ? auditName : policyName) && row.COLUMN_NAME === options.columnChange.name ? options.columnChange.values : {},
          ...options.auditNamesOnly && row.TABLE_NAME === auditName ? { DATA_TYPE: undefined, LENGTH: undefined, IS_NULLABLE: undefined } : {},
        }));
        if (sql.includes('QSYS2.SYSKEYCST')) return [{ TABLE_NAME: policyName, CONSTRAINT_NAME: 'PK', CONSTRAINT_TYPE: 'PRIMARY KEY', ENABLED: 'Y', COLUMN_NAME: 'CODIGOARTICULO', ORDINAL_POSITION: 1 },
          ...options.missingAuditPrimary ? [] : [{ TABLE_NAME: auditName, CONSTRAINT_NAME: 'AUDPK', CONSTRAINT_TYPE: 'PRIMARY KEY', ENABLED: 'Y', COLUMN_NAME: 'ID', ORDINAL_POSITION: 1 }],
          ...options.missingUnique ? [] : [{ TABLE_NAME: auditName, CONSTRAINT_NAME: 'UK', CONSTRAINT_TYPE: 'UNIQUE', ENABLED: 'Y', COLUMN_NAME: 'REQUEST_KEY', ORDINAL_POSITION: 1 }]];
        if (sql.includes('QSYS2.SYSCHKCST')) return [
          ...CHECKS.filter((_clause, index) => !options.missingOriginCheck || index !== CHECKS.length - 1).map((CHECK_CLAUSE, index) => ({ TABLE_NAME: policyName, ENABLED: 'Y', CHECK_CLAUSE: options.unsafePair && index === 0 ? CHECK_CLAUSE.replace(/ IS NOT NULL/g, ' IS NULL') : CHECK_CLAUSE })),
          ...AUDIT_CHECKS.filter((_clause, index) => options.missingAuditCheck !== index).map((CHECK_CLAUSE) => ({ TABLE_NAME: auditName, ENABLED: 'Y', CHECK_CLAUSE })),
        ];
        if (sql.includes('QSYS2.OBJECT_STATISTICS')) return ['PPA', 'PPAAUD'].map((OBJNAME) => ({ OBJNAME, JOURNALED: options.noJournal ? 'NO' : 'YES', JOURNAL_LIBRARY: 'JAVIER', JOURNAL_NAME: 'QSQJRN', JOURNAL_IMAGES: '*BOTH' }));
        if (sql.includes('WHERE REQUEST_KEY = ?')) return state.audit.filter((row) => row.REQUEST_KEY === params[0]);
        if (sql.startsWith('SELECT COUNT')) return [{ TOTAL: sql.includes(auditName) ? state.audit.length : 1 }];
        if (sql.startsWith('SELECT') && sql.includes(auditName)) {
          const selected = sql.slice(7, sql.indexOf(' FROM')).split(', ').map((name) => name.trim());
          return state.audit.map((row) => Object.fromEntries(selected.map((column) => [column, row[column]])));
        }
        if (sql.startsWith('SELECT') && sql.includes(policyName)) {
          if (sql.includes('FOR UPDATE')) {
            const previous = lock;
            lock = new Promise((resolve) => { unlock = resolve; });
            await previous;
          }
          return [{ ...state.row }];
        }
        if (sql.startsWith('UPDATE')) {
          staged = { ...state.row, UNIDAD_POLITICA: params[0], COSTE_FABRICACION: params[1], MARGEN_OBJETIVO_PCT: params[2], PRECIO_MINIMO: params[3], MINIMO_ORIGEN: params[4], UNIDAD_ESTADO: params[5], POLITICA_ESTADO: params[6], POLITICA_REVISION: params[7], POLITICA_UPDATED_BY: params[8] };
          return [];
        }
        if (sql.startsWith('INSERT')) {
          if (options.raceKeyAtInsert) {
            state.audit.push({ CODIGOARTICULO: '1002', REQUEST_KEY: KEY, ACTOR_CODE: '81', ACTOR_ROLE: 'ADMIN', PAYLOAD_HASH: 'b'.repeat(64), POLITICA_REVISION: 1 });
            throw options.raceKeyAtInsert;
          }
          if (options.auditFailure) throw new Error('simulated audit failure');
          const columns = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(', ');
          pendingAudit = Object.fromEntries(columns.map((column, index) => [column, params[index]]));
          return [];
        }
        throw new Error('Unexpected SQL');
      }),
    };
    connections.push(connection);
    return connection;
  });
  const repository = createCommercialPricePolicyRepository({ profileProvider: () => profile, acquireConnection });
  return { state, calls, connections, acquireConnection, repository, service: createCommercialPricePolicyService({ repository }) };
}

describe('owned policy persistence transaction contract', () => {
  test('locks one policy, preserves raw ERP unit and saves complete audit before commit', async () => {
    const f = fixture();
    expect(await f.service.updatePricePolicy('1001', BODY, KEY, ACTOR)).toEqual({ articleCode: '1001', revision: 1, replayed: false });
    expect(f.state.row).toMatchObject({ UNIDAD_ERP: '          ', UNIDAD_POLITICA: 'UNIDADES', COSTE_FABRICACION: '0.8000', MARGEN_OBJETIVO_PCT: '20.0000', POLITICA_REVISION: 1 });
    expect(f.state.audit).toHaveLength(1);
    expect(f.state.audit[0]).toMatchObject({ COSTE_PREVIO: null, COSTE_NUEVO: '0.8000', REVISION_PREVIA: 0, POLITICA_REVISION: 1, ACTOR_CODE: '80', ACTOR_ROLE: 'JEFE_VENTAS', REASON: BODY.reason, UNIDAD_PREVIA: null, UNIDAD_NUEVA: 'UNIDADES' });
    const lockIndex = f.calls.findIndex(({ sql }) => sql.includes('KEEP UPDATE LOCKS'));
    expect(lockIndex).toBeGreaterThan(-1);
    expect(f.calls.findIndex(({ sql }) => sql.startsWith('UPDATE'))).toBeGreaterThan(lockIndex);
    expect(f.connections[0].commit).toHaveBeenCalledTimes(1);
    expect(f.connections[0].close).toHaveBeenCalledTimes(1);
    expect(f.calls.filter(({ sql }) => /^(UPDATE|INSERT)/.test(sql)).every(({ sql }) => sql.includes('JAVIER.TEST_'))).toBe(true);
  });
  test('same payload/actor/key replays original ACK before stale revision check with no duplicate audit', async () => {
    const f = fixture();
    await f.service.updatePricePolicy('1001', BODY, KEY, ACTOR);
    await expect(f.service.updatePricePolicy('1001', BODY, KEY, ACTOR)).resolves.toEqual({ articleCode: '1001', revision: 1, replayed: true });
    expect(f.state.audit).toHaveLength(1);
    expect(f.calls.filter(({ sql }) => sql.startsWith('UPDATE'))).toHaveLength(1);
  });
  test.each([{ actor: { code: '81', role: 'JEFE_VENTAS' } }, { actor: { code: '80', role: 'ADMIN' } }, { body: { ...BODY, reason: 'Different request' } }])('foreign actor or different payload cannot reuse a key, case %#', async (change) => {
    const f = fixture();
    await f.service.updatePricePolicy('1001', BODY, KEY, ACTOR);
    await expect(f.service.updatePricePolicy('1001', change.body || BODY, KEY, change.actor || ACTOR)).rejects.toMatchObject({ code: 'COMMERCIAL_PRICE_POLICY_IDEMPOTENCY_CONFLICT', status: 409, details: {} });
    expect(f.state.audit).toHaveLength(1);
  });
  test('a different stale edit is rejected without a second mutation', async () => {
    const f = fixture();
    await f.service.updatePricePolicy('1001', BODY, KEY, ACTOR);
    await expect(f.service.updatePricePolicy('1001', BODY, 'bdf45c52-0c3a-47e1-a814-02ae4d4fb825', ACTOR)).rejects.toMatchObject({ status: 409 });
    expect(f.state.row.POLITICA_REVISION).toBe(1);
    expect(f.state.audit).toHaveLength(1);
    expect(f.connections[1].rollback).toHaveBeenCalledTimes(1);
  });
  test('two concurrent identical requests serialize on the row and share one ACK', async () => {
    const f = fixture();
    const results = await Promise.all([f.service.updatePricePolicy('1001', BODY, KEY, ACTOR), f.service.updatePricePolicy('1001', BODY, KEY, ACTOR)]);
    expect(results.map((ack) => ack.replayed).sort()).toEqual([false, true]);
    expect(f.state.audit).toHaveLength(1);
    expect(f.state.row.POLITICA_REVISION).toBe(1);
  });
  test('audit failure rolls back the policy mutation and never commits', async () => {
    const f = fixture({ auditFailure: true });
    const before = { ...f.state.row };
    await expect(f.service.updatePricePolicy('1001', BODY, KEY, ACTOR)).rejects.toMatchObject({ status: 503 });
    expect(f.state.row).toEqual(before);
    expect(f.state.audit).toHaveLength(0);
    expect(f.connections[0].rollback).toHaveBeenCalledTimes(1);
    expect(f.connections[0].commit).not.toHaveBeenCalled();
  });
  test.each([
    { state: 'HY000', code: -803 }, { state: 'HY000', code: 'SQL0803' },
    { state: 'HY000', sqlstate: '23505', code: 'generic' },
    { state: 'HY000', odbcErrors: [{ state: 'HY000', code: '-803' }] },
    { state: 'HY000', cause: { odbcErrors: [{ state: 'HY000', nativeCode: 'SQL0803' }] } },
  ])('cross-article nonce race returns 409 for every structured unique diagnostic, case %#', async (diagnostic) => {
    const f = fixture({ raceKeyAtInsert: Object.assign(new Error('native details must remain private'), diagnostic) });
    const before = { ...f.state.row };
    await expect(f.service.updatePricePolicy('1001', BODY, KEY, ACTOR)).rejects.toMatchObject({ status: 409, details: {} });
    expect(f.state.row).toEqual(before);
    expect(f.state.audit).toHaveLength(1);
    expect(f.state.audit[0].CODIGOARTICULO).toBe('1002');
    expect(f.connections[0].rollback).toHaveBeenCalledTimes(1);
    expect(f.connections[0].commit).not.toHaveBeenCalled();
  });
  test.each([{ missingTable: true }, { missingColumn: 'UNIDAD_POLITICA' }, { badScale: true }, { missingUnique: true }, { unsafePair: true }, { noJournal: true }, { missingOriginCheck: true }])('incompatible native metadata blocks before transaction and all DML, case %#', async (options) => {
    const f = fixture(options);
    await expect(f.service.updatePricePolicy('1001', BODY, KEY, ACTOR)).rejects.toMatchObject({ status: 503 });
    expect(f.connections[0].beginTransaction).not.toHaveBeenCalled();
    expect(f.calls.some(({ sql }) => /^(UPDATE|INSERT)/.test(sql))).toBe(false);
  });
  test.each([{ verified: false }, { tableSet: 'production' }, { writesEnabled: false }])('unverified or disallowed profile opens no write connection, case %#', async (change) => {
    const f = fixture({ profile: { ...PROFILE, ...change } });
    await expect(f.service.updatePricePolicy('1001', BODY, KEY, ACTOR)).rejects.toMatchObject({ status: 503 });
    expect(f.acquireConnection).not.toHaveBeenCalled();
  });
  test.each([
    { auditNamesOnly: true }, { missingAuditPrimary: true },
    { missingAuditCheck: 0 }, { missingAuditCheck: 1 }, { missingAuditCheck: 2 },
    { columnChange: { audit: true, name: 'REQUEST_KEY', values: { LENGTH: 20 } } },
    { columnChange: { audit: true, name: 'COSTE_NUEVO', values: { NUMERIC_SCALE: 2 } } },
    { columnChange: { audit: true, name: 'ACTOR_ROLE', values: { IS_NULLABLE: 'Y' } } },
    { columnChange: { audit: true, name: 'ID', values: { IS_IDENTITY: 'NO' } } },
    { columnChange: { audit: true, name: 'ID', values: { IDENTITY_GENERATION: 'BY DEFAULT' } } },
    { columnChange: { audit: true, name: 'CREATED_AT', values: { HAS_DEFAULT: 'N', COLUMN_DEFAULT: null } } },
    { columnChange: { audit: false, name: 'POLITICA_REVISION', values: { DATA_TYPE: 'VARCHAR' } } },
    { columnChange: { audit: false, name: 'UNIDAD_ERP', values: { LENGTH: 4 } } },
    { columnChange: { audit: false, name: 'MINIMO_ORIGEN', values: { IS_NULLABLE: 'Y' } } },
  ])('incompatible full physical contract rejects before transaction, case %#', async (options) => {
    const f = fixture(options);
    await expect(f.service.updatePricePolicy('1001', BODY, KEY, ACTOR)).rejects.toMatchObject({ status: 503 });
    expect(f.connections[0].beginTransaction).not.toHaveBeenCalled();
    expect(f.calls.some(({ sql }) => /^(UPDATE|INSERT)/.test(sql))).toBe(false);
  });
  test('production read-only uses its own mapping and blocks edits; approved profile supports the complete contract in a fake port', async () => {
    const prod = { ...PROFILE, profile: 'production', tableSet: 'production', productionWritesEnabled: false, writesEnabled: false };
    const readonly = fixture({ profile: prod });
    await readonly.service.listPricePolicies({}, ACTOR);
    expect(readonly.calls.some(({ sql }) => sql.includes('FROM JAVIER.POLITICA_PRECIO_ART'))).toBe(true);
    await expect(readonly.service.updatePricePolicy('1001', BODY, KEY, ACTOR)).rejects.toMatchObject({ status: 503 });
    expect(readonly.calls.some(({ sql }) => /^(UPDATE|INSERT)/.test(sql))).toBe(false);
    const approved = fixture({ profile: { ...prod, writesEnabled: true, productionWritesEnabled: true } });
    await expect(approved.service.updatePricePolicy('1001', BODY, KEY, ACTOR)).resolves.toMatchObject({ revision: 1 });
    expect(approved.calls.filter(({ sql }) => /^(UPDATE|INSERT)/.test(sql)).every(({ sql }) => sql.includes('JAVIER.POLITICA_PRECIO_ART') && !sql.includes('TEST_'))).toBe(true);
    await expect(fixture({ profile: prod, missingTable: true }).service.listPricePolicies({}, ACTOR)).rejects.toMatchObject({ status: 503 });
  });
  test('search values, pagination and article are always bound; list and bulk read have constant query counts', async () => {
    const f = fixture();
    await f.service.listPricePolicies({ q: "x' OR 1=1 --", page: '3', pageSize: '20' }, ACTOR);
    const business = f.calls.filter(({ sql }) => !sql.includes('QSYS2.'));
    expect(business).toHaveLength(2);
    expect(business.every(({ sql }) => !sql.includes("x' OR"))).toBe(true);
    expect(business[1].params.slice(-2)).toEqual([40, 20]);
    const conn = await f.acquireConnection();
    f.calls.length = 0;
    await f.repository.readMany(conn, Array.from({ length: 250 }, (_, i) => String(1000 + i)));
    expect(f.calls.filter(({ sql }) => !sql.includes('QSYS2.'))).toHaveLength(1);
  });
  test('audit reads omit internal nonce/hash', async () => {
    const f = fixture();
    await f.service.updatePricePolicy('1001', BODY, KEY, ACTOR);
    const audit = await f.service.getPricePolicyAudit('1001', {}, ACTOR);
    expect(audit.items).toHaveLength(1);
    expect(audit.items[0]).not.toHaveProperty('REQUEST_KEY');
    expect(audit.items[0]).not.toHaveProperty('PAYLOAD_HASH');
  });
  test('reviewed DDL uses explicit nullable-pair checks and does not reset data or mutate ERP', () => {
    const ddl = fs.readFileSync(path.join(__dirname, '../migrations/052_test_commercial_price_policy_audit.sql'), 'utf8');
    expect(ddl).toMatch(/COSTE_FABRICACION IS NOT NULL AND MARGEN_OBJETIVO_PCT IS NOT NULL/);
    expect(ddl).toMatch(/COSTE_FABRICACION >= 0/);
    expect(ddl).not.toMatch(/(?:UPDATE|DELETE FROM|INSERT INTO)\s+JAVIER\./i);
    expect(ddl).not.toMatch(/(?:ALTER TABLE|CREATE TABLE|UPDATE|DELETE FROM)\s+DSED(?:AC)?\./i);
  });
});
