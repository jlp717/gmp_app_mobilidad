'use strict';

const { getAppliedAppProfile } = require('../config/app-profile');
const { CommercialPricePolicyError } = require('../services/commercial-price-policy');

const TABLES = Object.freeze({
  isolated_test: Object.freeze({ policy: 'JAVIER.TEST_POLITICA_PRECIO_ART', audit: 'JAVIER.TEST_POLITICA_PRECIO_ART_AUDIT' }),
  production: Object.freeze({ policy: 'JAVIER.POLITICA_PRECIO_ART', audit: 'JAVIER.POLITICA_PRECIO_ART_AUDIT' }),
});
const POLICY_COLUMNS = Object.freeze([
  'CODIGOARTICULO', 'DESCRIPCIONARTICULO', 'UNIDAD_ERP', 'UNIDADES_CAJA', 'ANO_BAJA', 'ACTIVO_SN',
  'TARIFA_CANDIDATA_CODIGO', 'PRECIO_CANDIDATO', 'TARIFA_VARIANTES', 'TARIFA_ESTADO', 'UNIDAD_ESTADO',
  'POLITICA_ESTADO', 'COSTE_FABRICACION', 'MARGEN_OBJETIVO_PCT', 'PRECIO_MINIMO', 'SOURCE_FINGERPRINT',
  'SOURCE_SNAPSHOT_AT', 'CREATED_AT', 'UPDATED_AT', 'UNIDAD_POLITICA', 'MINIMO_ORIGEN',
  'POLITICA_REVISION', 'POLITICA_UPDATED_BY', 'POLITICA_UPDATED_AT',
]);
const AUDIT_COLUMNS = Object.freeze([
  'ID', 'CODIGOARTICULO', 'ACTION', 'REVISION_PREVIA', 'POLITICA_REVISION',
  'UNIDAD_PREVIA', 'UNIDAD_NUEVA', 'COSTE_PREVIO', 'COSTE_NUEVO', 'MARGEN_PREVIO', 'MARGEN_NUEVO',
  'MINIMO_PREVIO', 'MINIMO_NUEVO', 'ORIGEN_PREVIO', 'ORIGEN_NUEVO',
  'UNIDAD_ESTADO_PREVIO', 'UNIDAD_ESTADO_NUEVO', 'POLITICA_ESTADO_PREVIO', 'POLITICA_ESTADO_NUEVO',
  'SOURCE_PREVIO', 'SOURCE_NUEVO', 'ACTOR_CODE', 'ACTOR_ROLE', 'REASON', 'REQUEST_KEY', 'PAYLOAD_HASH', 'CREATED_AT',
]);
const REQUIRED_CHECKS = Object.freeze([
  "(COSTE_FABRICACION IS NULL AND MARGEN_OBJETIVO_PCT IS NULL) OR (COSTE_FABRICACION IS NOT NULL AND MARGEN_OBJETIVO_PCT IS NOT NULL AND COSTE_FABRICACION >= 0 AND MARGEN_OBJETIVO_PCT >= 0 AND MARGEN_OBJETIVO_PCT < 100)",
  "MINIMO_ORIGEN IN ('ERP_BASE','MANUAL')",
  'PRECIO_MINIMO IS NULL OR PRECIO_MINIMO >= 0',
  "UNIDAD_POLITICA IS NULL OR UNIDAD_POLITICA IN ('CAJAS','KILO','UNIDADES')",
  'POLITICA_REVISION >= 0',
]);
function error(code, message, status = 503) { return new CommercialPricePolicyError(code, message, status); }
function unavailable() { return error('COMMERCIAL_PRICE_POLICY_UNAVAILABLE', 'La política de precios no está disponible en el entorno activo.'); }
function conflict(code = 'COMMERCIAL_PRICE_POLICY_CONFLICT') { return error(code, 'La política ha cambiado o la solicitud ya pertenece a otra operación. Actualiza y vuelve a revisar.', 409); }
function text(value) { return String(value ?? '').trim(); }
function rows(result) { return Array.isArray(result) ? result : result?.rows || []; }
function normalizeCheck(value) { return text(value).toUpperCase().replace(/[\s()\"]/g, ''); }
function rowValue(row, key) { return row?.[key] ?? row?.[key.toLowerCase()]; }
function mapPolicy(row) {
  return {
    articleCode: text(rowValue(row, 'CODIGOARTICULO')), description: text(rowValue(row, 'DESCRIPCIONARTICULO')),
    // Preserve ART's raw value, including blanks. Policy confirmation is a separate column.
    erpUnit: String(rowValue(row, 'UNIDAD_ERP') ?? ''), packUnits: rowValue(row, 'UNIDADES_CAJA'),
    inactiveYear: Number(rowValue(row, 'ANO_BAJA')), active: text(rowValue(row, 'ACTIVO_SN')) === 'S',
    tariffCode: rowValue(row, 'TARIFA_CANDIDATA_CODIGO'), tariffPrice: rowValue(row, 'PRECIO_CANDIDATO'),
    tariffVariants: Number(rowValue(row, 'TARIFA_VARIANTES')), tariffState: text(rowValue(row, 'TARIFA_ESTADO')),
    unitState: text(rowValue(row, 'UNIDAD_ESTADO')), policyState: text(rowValue(row, 'POLITICA_ESTADO')),
    manufacturingCost: rowValue(row, 'COSTE_FABRICACION') ?? null, targetMarginPct: rowValue(row, 'MARGEN_OBJETIVO_PCT') ?? null,
    minimumPrice: rowValue(row, 'PRECIO_MINIMO') ?? null, policyUnit: text(rowValue(row, 'UNIDAD_POLITICA')) || null,
    minimumOrigin: text(rowValue(row, 'MINIMO_ORIGEN')), revision: Number(rowValue(row, 'POLITICA_REVISION')),
    sourceFingerprint: text(rowValue(row, 'SOURCE_FINGERPRINT')), sourceSnapshotAt: rowValue(row, 'SOURCE_SNAPSHOT_AT'),
    updatedBy: text(rowValue(row, 'POLITICA_UPDATED_BY')) || null, updatedAt: rowValue(row, 'POLITICA_UPDATED_AT') ?? null,
  };
}
function resolveTables(profile, write) {
  const production = profile?.profile === 'production';
  const expectedSet = production ? 'production' : 'isolated_test';
  if (profile?.verified !== true || !['test', 'demo', 'production'].includes(profile.profile)
      || profile.readSchema !== 'DSEDAC' || profile.writeSchema !== 'JAVIER' || profile.tableSet !== expectedSet
      || (!production && profile.erpExportEnabled !== false)) throw unavailable();
  if (write && (production ? profile.productionWritesEnabled !== true || profile.writesEnabled !== true : profile.writesEnabled !== true || profile.productionWritesEnabled !== false)) {
    throw error('COMMERCIAL_PRICE_POLICY_WRITES_DISABLED', 'La edición de precios está desactivada en este entorno.');
  }
  return TABLES[expectedSet];
}

function createCommercialPricePolicyRepository({
  profileProvider = getAppliedAppProfile,
  acquireConnection = async () => require('../config/db').acquireConfiguredConnection(),
} = {}) {
  async function execute(connection, sql, params = []) { return rows(await connection.query(sql, params)); }
  async function assertCatalog(connection, tables, write = false) {
    const names = [tables.policy.split('.')[1], tables.audit.split('.')[1]];
    const tableRows = await execute(connection, 'SELECT TABLE_NAME, SYSTEM_TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?, ?)', ['JAVIER', ...names]);
    if (names.some((name) => !tableRows.some((row) => text(rowValue(row, 'TABLE_NAME')) === name))) throw unavailable();
    const columns = await execute(connection, 'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?, ?)', ['JAVIER', ...names]);
    const expectedColumns = [POLICY_COLUMNS, AUDIT_COLUMNS];
    if (names.some((name, index) => expectedColumns[index].some((column) => !columns.some((row) => text(rowValue(row, 'TABLE_NAME')) === name && text(rowValue(row, 'COLUMN_NAME')) === column)))) throw unavailable();
    for (const [name, precision] of [['COSTE_FABRICACION', 11], ['PRECIO_MINIMO', 11], ['MARGEN_OBJETIVO_PCT', 7]]) {
      const column = columns.find((row) => text(rowValue(row, 'TABLE_NAME')) === names[0] && text(rowValue(row, 'COLUMN_NAME')) === name);
      if (text(rowValue(column, 'DATA_TYPE')) !== 'DECIMAL' || Number(rowValue(column, 'NUMERIC_PRECISION')) !== precision || Number(rowValue(column, 'NUMERIC_SCALE')) !== 4) throw unavailable();
    }
    if (!write) return;
    const keys = await execute(connection,
      'SELECT C.TABLE_NAME, C.CONSTRAINT_NAME, C.CONSTRAINT_TYPE, C.ENABLED, K.COLUMN_NAME, K.ORDINAL_POSITION FROM QSYS2.SYSCST C JOIN QSYS2.SYSKEYCST K ON K.CONSTRAINT_SCHEMA = C.CONSTRAINT_SCHEMA AND K.CONSTRAINT_NAME = C.CONSTRAINT_NAME WHERE C.TABLE_SCHEMA = ? AND C.TABLE_NAME IN (?, ?)', ['JAVIER', ...names]);
    const keyGroups = new Map();
    for (const row of keys) {
      if (!['Y', 'YES'].includes(text(rowValue(row, 'ENABLED')))) continue;
      const id = `${text(rowValue(row, 'TABLE_NAME'))}:${text(rowValue(row, 'CONSTRAINT_NAME'))}`;
      if (!keyGroups.has(id)) keyGroups.set(id, { table: text(rowValue(row, 'TABLE_NAME')), type: text(rowValue(row, 'CONSTRAINT_TYPE')), columns: [] });
      keyGroups.get(id).columns.push({ name: text(rowValue(row, 'COLUMN_NAME')), position: Number(rowValue(row, 'ORDINAL_POSITION')) });
    }
    const hasKey = (table, column, types) => [...keyGroups.values()].some((key) => key.table === table && types.includes(key.type) && key.columns.length === 1 && key.columns[0].name === column && key.columns[0].position === 1);
    if (!hasKey(names[0], 'CODIGOARTICULO', ['PRIMARY KEY']) || !hasKey(names[1], 'REQUEST_KEY', ['UNIQUE', 'PRIMARY KEY'])) throw unavailable();
    const checks = await execute(connection,
      "SELECT C.TABLE_NAME, C.ENABLED, H.CHECK_CLAUSE FROM QSYS2.SYSCST C JOIN QSYS2.SYSCHKCST H ON H.CONSTRAINT_SCHEMA = C.CONSTRAINT_SCHEMA AND H.CONSTRAINT_NAME = C.CONSTRAINT_NAME WHERE C.TABLE_SCHEMA = ? AND C.TABLE_NAME IN (?, ?) AND C.CONSTRAINT_TYPE = 'CHECK'", ['JAVIER', ...names]);
    const actual = checks.filter((row) => text(rowValue(row, 'TABLE_NAME')) === names[0] && ['Y', 'YES'].includes(text(rowValue(row, 'ENABLED')))).map((row) => normalizeCheck(rowValue(row, 'CHECK_CLAUSE')));
    if (REQUIRED_CHECKS.some((check) => !actual.includes(normalizeCheck(check)))) throw unavailable();
    const physicalNames = names.map((name) => text(rowValue(tableRows.find((row) => text(rowValue(row, 'TABLE_NAME')) === name), 'SYSTEM_TABLE_NAME')));
    if (physicalNames.some((name) => !name)) throw unavailable();
    const journals = await execute(connection,
      "SELECT OBJNAME, JOURNALED, JOURNAL_LIBRARY, JOURNAL_NAME, JOURNAL_IMAGES FROM TABLE(QSYS2.OBJECT_STATISTICS(?, '*FILE')) X WHERE OBJNAME IN (?, ?)", ['JAVIER', ...physicalNames]);
    if (physicalNames.some((name) => !journals.some((row) => text(rowValue(row, 'OBJNAME')) === name && text(rowValue(row, 'JOURNALED')) === 'YES' && text(rowValue(row, 'JOURNAL_LIBRARY')) === 'JAVIER' && text(rowValue(row, 'JOURNAL_NAME')) === 'QSQJRN' && text(rowValue(row, 'JOURNAL_IMAGES')) === '*BOTH'))) throw unavailable();
  }
  async function withConnection(write, work) {
    const tables = resolveTables(profileProvider(), write);
    let connection;
    try {
      connection = await acquireConnection();
      if (!connection || typeof connection.query !== 'function' || typeof connection.close !== 'function'
          || (write && ['beginTransaction', 'commit', 'rollback'].some((method) => typeof connection[method] !== 'function'))) throw unavailable();
      await assertCatalog(connection, tables, write);
      return await work(connection, tables);
    } catch (cause) {
      if (cause instanceof CommercialPricePolicyError) throw cause;
      throw unavailable();
    } finally {
      if (connection?.close) await connection.close().catch(() => {});
    }
  }
  function filter(input) {
    const clauses = [], params = [];
    if (input.q) {
      const escaped = `%${input.q.replace(/[!%_]/g, '!$&')}%`;
      clauses.push("(UPPER(CODIGOARTICULO) LIKE UPPER(?) ESCAPE '!' OR UPPER(DESCRIPCIONARTICULO) LIKE UPPER(?) ESCAPE '!')");
      params.push(escaped, escaped);
    }
    if (input.unitState) { clauses.push('UNIDAD_ESTADO = ?'); params.push(input.unitState); }
    return { where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
  }
  async function findRequest(connection, tables, input) {
    const found = await execute(connection, `SELECT CODIGOARTICULO, POLITICA_REVISION, ACTOR_CODE, ACTOR_ROLE, PAYLOAD_HASH FROM ${tables.audit} WHERE REQUEST_KEY = ?`, [input.requestKey]);
    if (!found.length) return null;
    const row = found[0];
    if (text(rowValue(row, 'CODIGOARTICULO')) !== input.articleCode || text(rowValue(row, 'ACTOR_CODE')) !== input.actor.code || text(rowValue(row, 'ACTOR_ROLE')) !== input.actor.role || text(rowValue(row, 'PAYLOAD_HASH')) !== input.payloadHash) throw conflict('COMMERCIAL_PRICE_POLICY_IDEMPOTENCY_CONFLICT');
    return Object.freeze({ articleCode: input.articleCode, revision: Number(rowValue(row, 'POLITICA_REVISION')), replayed: true });
  }
  return Object.freeze({
    async list(input) {
      return withConnection(false, async (connection, tables) => {
        const { where, params } = filter(input);
        const count = await execute(connection, `SELECT COUNT(*) AS TOTAL FROM ${tables.policy}${where}`, params);
        const found = await execute(connection, `SELECT ${POLICY_COLUMNS.join(', ')} FROM ${tables.policy}${where} ORDER BY CODIGOARTICULO OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`, [...params, input.offset, input.pageSize]);
        return { total: Number(rowValue(count[0], 'TOTAL') || 0), items: found.map(mapPolicy) };
      });
    },
    async audit(articleCode, input) {
      return withConnection(false, async (connection, tables) => {
        const count = await execute(connection, `SELECT COUNT(*) AS TOTAL FROM ${tables.audit} WHERE CODIGOARTICULO = ?`, [articleCode]);
        // Request nonce and payload fingerprints are internal: never return them to another manager.
        const visible = AUDIT_COLUMNS.filter((name) => !['REQUEST_KEY', 'PAYLOAD_HASH'].includes(name));
        const items = await execute(connection, `SELECT ${visible.join(', ')} FROM ${tables.audit} WHERE CODIGOARTICULO = ? ORDER BY ID DESC OFFSET ? ROWS FETCH NEXT ? ROWS ONLY`, [articleCode, input.offset, input.pageSize]);
        return { total: Number(rowValue(count[0], 'TOTAL') || 0), items };
      });
    },
    async update(input, deriveChanges) {
      return withConnection(true, async (connection, tables) => {
        let begun = false;
        try {
          await connection.beginTransaction();
          begun = true;
          let replay = await findRequest(connection, tables, input);
          if (replay) { await connection.commit(); begun = false; return replay; }
          const locked = await execute(connection, `SELECT ${POLICY_COLUMNS.join(', ')} FROM ${tables.policy} WHERE CODIGOARTICULO = ? FOR UPDATE WITH RS USE AND KEEP UPDATE LOCKS`, [input.articleCode]);
          if (!locked.length) throw error('COMMERCIAL_PRICE_POLICY_NOT_FOUND', 'No se ha encontrado el artículo.', 404);
          // Recheck after the row lock: an overlapping identical request may have just committed.
          replay = await findRequest(connection, tables, input);
          if (replay) { await connection.commit(); begun = false; return replay; }
          const current = mapPolicy(locked[0]);
          if (current.revision !== input.expectedRevision) throw conflict();
          const changes = deriveChanges(current);
          const revision = current.revision + 1;
          await execute(connection, `UPDATE ${tables.policy} SET UNIDAD_POLITICA = ?, COSTE_FABRICACION = ?, MARGEN_OBJETIVO_PCT = ?, PRECIO_MINIMO = ?, MINIMO_ORIGEN = ?, UNIDAD_ESTADO = ?, POLITICA_ESTADO = ?, POLITICA_REVISION = ?, POLITICA_UPDATED_BY = ?, POLITICA_UPDATED_AT = CURRENT TIMESTAMP, UPDATED_AT = CURRENT TIMESTAMP WHERE CODIGOARTICULO = ? AND POLITICA_REVISION = ?`,
            [changes.policyUnit, changes.manufacturingCost, changes.targetMarginPct, changes.minimumPrice, changes.minimumOrigin, 'VERIFICADA', changes.policyState, revision, input.actor.code, input.articleCode, current.revision]);
          const columns = AUDIT_COLUMNS.filter((name) => !['ID', 'CREATED_AT'].includes(name));
          const values = [input.articleCode, 'UPDATE', current.revision, revision,
            current.policyUnit, changes.policyUnit, current.manufacturingCost, changes.manufacturingCost,
            current.targetMarginPct, changes.targetMarginPct, current.minimumPrice, changes.minimumPrice,
            current.minimumOrigin, changes.minimumOrigin, current.unitState, 'VERIFICADA', current.policyState, changes.policyState,
            current.sourceFingerprint, current.sourceFingerprint, input.actor.code, input.actor.role, input.reason, input.requestKey, input.payloadHash];
          await execute(connection, `INSERT INTO ${tables.audit} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, values);
          await connection.commit();
          begun = false;
          return Object.freeze({ articleCode: input.articleCode, revision, replayed: false });
        } catch (cause) {
          if (begun) {
            try { await connection.rollback(); }
            catch (_) { throw unavailable(); }
          }
          const states = [cause, ...(cause?.odbcErrors || [])].map((item) => String(item?.state || item?.sqlstate || item?.code || ''));
          if (states.some((state) => ['23505', '40001', '57033'].includes(state))) throw conflict();
          throw cause;
        }
      });
    },
    // A bulk read supports order validation without one query per line. Caller-owned transactions retain row locks.
    async readMany(connection, articleCodes, { lock = false } = {}) {
      const tables = resolveTables(profileProvider(), lock);
      if (!Array.isArray(articleCodes) || articleCodes.length > 250 || articleCodes.some((code) => typeof code !== 'string' || !/^[A-Za-z0-9._-]{1,10}$/.test(code))) throw error('COMMERCIAL_PRICE_POLICY_INVALID', 'Artículos inválidos.', 422);
      const codes = [...new Set(articleCodes)].sort();
      if (!codes.length) return [];
      await assertCatalog(connection, tables, lock);
      return (await execute(connection, `SELECT ${POLICY_COLUMNS.join(', ')} FROM ${tables.policy} WHERE CODIGOARTICULO IN (${codes.map(() => '?').join(', ')}) ORDER BY CODIGOARTICULO${lock ? ' FOR UPDATE WITH RS USE AND KEEP UPDATE LOCKS' : ''}`, codes)).map(mapPolicy);
    },
  });
}

module.exports = { createCommercialPricePolicyRepository, TABLES, POLICY_COLUMNS, AUDIT_COLUMNS, REQUIRED_CHECKS, _private: { mapPolicy, resolveTables, normalizeCheck } };
