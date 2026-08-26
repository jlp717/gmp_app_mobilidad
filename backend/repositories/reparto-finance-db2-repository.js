'use strict';

/**
 * DB2 access for repartidor finance (G2-B1).
 * Owns ALL SQL used by repartidor-finance-service.
 * No DSEDAC mutation — commercialCobros is read-only guard.
 */

const { queryWithParams, getPool, initDb } = require('../config/db');
const logger = require('../middleware/logger');
const {
  resolveRepartoRuntime,
  validateFinanceTableMapping,
} = require('../config/reparto-runtime');

class FinanceRepoSchemaError extends Error {
  constructor(message = 'El catálogo DB2 de reparto no está disponible') {
    super(message);
    this.name = 'FinanceSchemaUnavailableError';
    this.code = 'REPARTO_SCHEMA_UNAVAILABLE';
    this.statusCode = 503;
  }
}

function resolveFinanceBindings(env = process.env) {
  const runtime = resolveRepartoRuntime(env);
  const mapping = validateFinanceTableMapping(runtime);
  if (!runtime.valid || !mapping.valid) {
    throw new FinanceRepoSchemaError(
      'La configuracion de reparto no permite consultar ni liquidar finanzas',
    );
  }
  const commissionConfigSchema = String(
    env.REPARTIDOR_COMMISSION_CONFIG_SCHEMA || runtime.schemas.app,
  ).trim().toUpperCase();
  if (commissionConfigSchema !== runtime.schemas.app) {
    throw new FinanceRepoSchemaError(
      'El esquema de comisiones debe coincidir con el esquema de aplicacion de reparto',
    );
  }
  return Object.freeze({
    runtime,
    tables: Object.freeze({ ...runtime.tables.finance }),
    deliveryStatusTable: runtime.tables?.notifications?.deliveryStatus
      || (runtime.schemas.app + '.DELIVERY_STATUS'),
    erpDataSchema: runtime.schemas.read,
    erpAppSchema: runtime.schemas.app,
    commissionConfigSchema,
  });
}

function roundMoney(raw) {
  const num = Number(raw);
  const safe = Number.isFinite(num) ? num : 0;
  return Math.round((safe + Number.EPSILON) * 100) / 100;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeTipoDocumento(raw) {
  const value = normalizeText(raw).toUpperCase();
  if (!value) return 'CAC';
  return value.slice(0, 3);
}

function inClause(column, values) {
  if (values.length === 1) {
    return { sql: `${column} = ?`, params: values };
  }
  return {
    sql: `${column} IN (${values.map(() => '?').join(', ')})`,
    params: values,
  };
}

function cobrosDateFilterColumn(info, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  if (info.cobrosHasCollectionDate) {
    return `${prefix}ANOCOBRO * 10000 + ${prefix}MESCOBRO * 100 + ${prefix}DIACOBRO`;
  }
  if (info.cobrosHasFechaCobro) {
    return `YEAR(${prefix}FECHA_COBRO) * 10000 + MONTH(${prefix}FECHA_COBRO) * 100 + DAY(${prefix}FECHA_COBRO)`;
  }
  return `${prefix}ANOVENCIMIENTO * 10000 + ${prefix}MESVENCIMIENTO * 100 + ${prefix}DIAVENCIMIENTO`;
}

function cobrosDateSelectColumns(info) {
  if (info.cobrosHasCollectionDate) return 'RC.DIACOBRO, RC.MESCOBRO, RC.ANOCOBRO';
  if (info.cobrosHasFechaCobro) {
    return 'DAY(RC.FECHA_COBRO) AS DIACOBRO, MONTH(RC.FECHA_COBRO) AS MESCOBRO, YEAR(RC.FECHA_COBRO) AS ANOCOBRO';
  }
  return 'RC.DIAVENCIMIENTO, RC.MESVENCIMIENTO, RC.ANOVENCIMIENTO';
}

function cobrosDateOrderBy(info, alias = 'RC') {
  const prefix = alias ? `${alias}.` : '';
  if (info.cobrosHasCollectionDate) return `${prefix}ANOCOBRO, ${prefix}MESCOBRO, ${prefix}DIACOBRO`;
  if (info.cobrosHasFechaCobro) return `${prefix}FECHA_COBRO`;
  return `${prefix}ANOVENCIMIENTO, ${prefix}MESVENCIMIENTO, ${prefix}DIAVENCIMIENTO`;
}

function financeReadOverlay(writeTables) {
  // App state is single-source in every table set. isolated_test resolves to
  // TEST_* through reparto-runtime; production resolves to its production map.
  return { write: writeTables, sources: [writeTables], overlay: false, production: null };
}

function skipIsolatedTestFinanceSeed(env = process.env) {
  return Boolean(env.JEST_WORKER_ID);
}

const TESTMOVIL_WRITE_TABLES = Object.freeze(new Set([
  'TESTMOVIL.LIQUIDIARI',
  'TESTMOVIL.VENDEDORES',
  'TESTMOVIL.LIQDIACUE',
  'TESTMOVIL.COBROCABEC',
]));

function assertIsolatedTestWriteTable(table, env = process.env) {
  const identifier = String(table || '').trim().toUpperCase();
  const tableSet = String(env.REPARTO_TABLE_SET || '').trim().toLowerCase();
  if (tableSet === 'testmovil') {
    if (identifier.startsWith('JAVIER.') || identifier.startsWith('DSEDAC.')) {
      throw new FinanceRepoSchemaError(
        `G4 write path blocks JAVIER/DSEDAC: ${identifier || '(empty)'}`,
      );
    }
    if (!TESTMOVIL_WRITE_TABLES.has(identifier)) {
      throw new FinanceRepoSchemaError(
        `Refusing non-TESTMOVIL finance write target: ${identifier || '(empty)'}`,
      );
    }
    return;
  }
  if (!identifier.startsWith('JAVIER.TEST_')) {
    throw new FinanceRepoSchemaError(
      `Refusing non-TEST finance write target: ${identifier || '(empty)'}`,
    );
  }
}

function liquidacionErpRelation(erpDataSchema) {
  const schema = String(erpDataSchema || '').trim().toUpperCase() || 'DSEDAC';
  return `${schema}.LQD`;
}

function cobroKeyExcludeSql(prodAlias, testTable, info) {
  if (info.cobrosHasDocumentColumns === false) return '';
  const aligned = info.cobrosAligned !== false;
  const pClient = aligned ? `${prodAlias}.CODIGOCLIENTEALBARAN` : `${prodAlias}.CODIGO_CLIENTE`;
  const tClient = aligned ? 'OVRL.CODIGOCLIENTEALBARAN' : 'OVRL.CODIGO_CLIENTE';
  const pTipo = aligned ? `${prodAlias}.TIPODOCUMENTO` : `${prodAlias}.TIPO_DOCUMENTO`;
  const tTipo = aligned ? 'OVRL.TIPODOCUMENTO' : 'OVRL.TIPO_DOCUMENTO';
  const pSerie = aligned ? `${prodAlias}.SERIEDOCUMENTO` : `${prodAlias}.SERIE_DOCUMENTO`;
  const tSerie = aligned ? 'OVRL.SERIEDOCUMENTO' : 'OVRL.SERIE_DOCUMENTO';
  const pTerm = aligned ? `${prodAlias}.TERMINALDOCUMENTO` : `${prodAlias}.TERMINAL_DOCUMENTO`;
  const tTerm = aligned ? 'OVRL.TERMINALDOCUMENTO' : 'OVRL.TERMINAL_DOCUMENTO';
  const pNum = aligned ? `${prodAlias}.NUMERODOCUMENTO` : `${prodAlias}.NUMERO_DOCUMENTO`;
  const tNum = aligned ? 'OVRL.NUMERODOCUMENTO' : 'OVRL.NUMERO_DOCUMENTO';
  const pCode = cobrosCodeColumn(info, prodAlias);
  const tCode = cobrosCodeColumn(info, 'OVRL');
  return `AND NOT EXISTS (
    SELECT 1 FROM ${testTable} OVRL
     WHERE TRIM(${tCode}) = TRIM(${pCode})
       AND TRIM(${tClient}) = TRIM(${pClient})
       AND TRIM(${tTipo}) = TRIM(${pTipo})
       AND TRIM(${tSerie}) = TRIM(${pSerie})
       AND ${tTerm} = ${pTerm}
       AND ${tNum} = ${pNum}
  )`;
}

function cobrosNotLiquidatedCondition(info, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  if (info.cobrosHasLiquidado) {
    return `COALESCE(${prefix}LIQUIDADO_SN, 'N') <> 'S'`;
  }
  if (info.cobrosHasNumeroLiquidacion) {
    return `COALESCE(${prefix}NUMEROLIQUIDACION, 0) = 0`;
  }
  return '1 = 1';
}

function cobrosCodeColumn(info, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return info.cobrosAligned ? `${prefix}CODIGOVENDEDOR` : `${prefix}CODIGO_REPARTIDOR`;
}

function cobrosAmountColumn(info, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return info.cobrosAligned ? `${prefix}IMPORTEVENCIMIENTO` : `${prefix}IMPORTE_COBRADO`;
}

function cobrosPendingColumn(info, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  if (typeof info.has === 'function') {
    if (info.has('REPARTIDOR_COBROS', 'IMPORTEPENDIENTE')) return `${prefix}IMPORTEPENDIENTE`;
    if (info.has('REPARTIDOR_COBROS', 'IMPORTE_PENDIENTE')) return `${prefix}IMPORTE_PENDIENTE`;
    return 'CAST(0 AS DECIMAL(15,2))';
  }
  if (info.cobrosAligned && info.cobrosHasDocumentColumns !== false) {
    return `${prefix}IMPORTEPENDIENTE`;
  }
  if (info.cobrosLegacy) return `${prefix}IMPORTE_PENDIENTE`;
  return 'CAST(0 AS DECIMAL(15,2))';
}

function cobrosPaymentColumn(info, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return info.cobrosAligned ? `${prefix}CODIGOFORMAPAGO` : `${prefix}FORMA_PAGO`;
}

function liquidacionCodeColumn(info, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  if (info.has('REPARTIDOR_LIQUIDACION_OPS', 'CODIGOVENDEDOR')) {
    return `${prefix}CODIGOVENDEDOR`;
  }
  if (info.has('REPARTIDOR_LIQUIDACION_OPS', 'CODIGO_REPARTIDOR')) {
    return `${prefix}CODIGO_REPARTIDOR`;
  }
  throw new FinanceRepoSchemaError(
    'El ledger de liquidaciones no contiene un codigo de repartidor compatible',
  );
}

function liquidacionCollectedExpression(info, alias = '') {
  const prefix = alias ? `${alias}.` : '';
  if (info.has('REPARTIDOR_LIQUIDACION_OPS', 'TOTAL_COBROS_DIA')) {
    return `COALESCE(${prefix}TOTAL_COBROS_DIA, 0)`;
  }
  const components = [
    'IMPORTEEFECTIVO',
    'IMPORTECHEQUES',
    'IMPORTETARJETA',
    'IMPORTEPOSTDATADOS',
  ].filter((column) => info.has('REPARTIDOR_LIQUIDACION_OPS', column));
  if (components.length === 0) {
    throw new FinanceRepoSchemaError(
      'El ledger de liquidaciones no contiene importes cobrados compatibles',
    );
  }
  return components.map((column) => `COALESCE(${prefix}${column}, 0)`).join(' + ');
}

function cobroReplaySelect(info) {
  const candidates = [
    'ID',
    'CODIGOVENDEDOR',
    'CODIGO_REPARTIDOR',
    'CODIGOCLIENTEALBARAN',
    'CODIGO_CLIENTE',
    'TIPODOCUMENTO',
    'TIPO_DOCUMENTO',
    'ORIGENDOCUMENTO',
    'ORIGEN_DOCUMENTO',
    'SUBEMPRESADOCUMENTO',
    'SUBEMPRESA_DOCUMENTO',
    'EJERCICIODOCUMENTO',
    'EJERCICIO_DOCUMENTO',
    'SERIEDOCUMENTO',
    'SERIE_DOCUMENTO',
    'TERMINALDOCUMENTO',
    'TERMINAL_DOCUMENTO',
    'NUMERODOCUMENTO',
    'NUMERO_DOCUMENTO',
    'XDEDOCUMENTO',
    'XDE_DOCUMENTO',
    'DEXDOCUMENTO',
    'DEX_DOCUMENTO',
    'CODIGOFORMAPAGO',
    'FORMA_PAGO',
    'PANTALLA_ORIGEN',
    'IMPORTEVENCIMIENTO',
    'IMPORTE_COBRADO',
    'IMPORTEPENDIENTE',
    'IMPORTE_PENDIENTE',
    'LIQUIDADO_SN',
    'NUMEROLIQUIDACION',
    'CREATED_AT',
  ];
  const columns = candidates.filter((column) => info.has('REPARTIDOR_COBROS', column));
  return columns.length > 0 ? columns.join(', ') : 'ID, IDEMPOTENCY_TOKEN';
}

function storagePaymentCode(raw, info) {
  const value = normalizeText(raw).toUpperCase();
  if (!info.cobrosAligned) return value;
  if (['EFECTIVO', 'CONTADO', 'EF', 'F0'].includes(value)) return 'EF';
  if (['TARJETA', 'TPV', 'TJ'].includes(value)) return 'TJ';
  if (['TRANSFERENCIA', 'TRANSFER', 'TR', 'T0'].includes(value)) return 'TR';
  if (['BIZUM', 'BI'].includes(value)) return 'BI';
  if (['CHEQUE', 'TALON', 'TALON BANCARIO', 'CH'].includes(value)) return 'CH';
  if (['POSTDATADO', 'POSTDATADOS', 'PD'].includes(value)) return 'PD';
  return value.slice(0, 2);
}

function cobroDocumentCriteria(info, input) {
  const tipoDocumento = normalizeTipoDocumento(input.tipoDocumento);
  const commonParams = [
    input.codigoRepartidor,
    input.codigoCliente,
    tipoDocumento,
    input.origenDocumento || 'B',
    input.subempresaDocumento || 'GMP',
    input.ejercicioDocumento,
    input.serieDocumento,
    input.terminalDocumento,
    input.numeroDocumento,
    input.xdeDocumento || 1,
    input.dexDocumento || 1,
  ];

  if (info.cobrosAligned) {
    return {
      sql: `TRIM(CODIGOVENDEDOR) = ?
        AND TRIM(CODIGOCLIENTEALBARAN) = ?
        AND TRIM(TIPODOCUMENTO) = ?
        AND TRIM(ORIGENDOCUMENTO) = ?
        AND TRIM(SUBEMPRESADOCUMENTO) = ?
        AND EJERCICIODOCUMENTO = ?
        AND TRIM(SERIEDOCUMENTO) = ?
        AND TERMINALDOCUMENTO = ?
        AND NUMERODOCUMENTO = ?
        AND COALESCE(XDEDOCUMENTO, 1) = ?
        AND COALESCE(DEXDOCUMENTO, 1) = ?`,
      params: commonParams,
    };
  }

  return {
    sql: `TRIM(CODIGO_REPARTIDOR) = ?
      AND TRIM(CODIGO_CLIENTE) = ?
      AND TRIM(TIPO_DOCUMENTO) = ?
      AND TRIM(ORIGEN_DOCUMENTO) = ?
      AND TRIM(SUBEMPRESA_DOCUMENTO) = ?
      AND EJERCICIO_DOCUMENTO = ?
      AND TRIM(SERIE_DOCUMENTO) = ?
      AND TERMINAL_DOCUMENTO = ?
      AND NUMERO_DOCUMENTO = ?
      AND COALESCE(XDE_DOCUMENTO, 1) = ?
      AND COALESCE(DEX_DOCUMENTO, 1) = ?`,
    params: commonParams,
  };
}

function db2DateFromParts(yearExpression, monthExpression, dayExpression) {
  return `DATE(
    DIGITS(DECIMAL(${yearExpression}, 4, 0)) || '-' ||
    DIGITS(DECIMAL(${monthExpression}, 2, 0)) || '-' ||
    DIGITS(DECIMAL(${dayExpression}, 2, 0))
  )`;
}

function vencimientosDueYmdExpression() {
  const useAlbaran = "UPPER(TRIM(COALESCE(CLCL1.DIASLIMITECREDITOCONFECHAALB, ''))) = 'S'";
  const baseYear = `CASE WHEN ${useAlbaran} THEN CPC.ANODOCUMENTO ELSE CVC.ANOEMISION END`;
  const baseMonth = `CASE WHEN ${useAlbaran} THEN CPC.MESDOCUMENTO ELSE CVC.MESEMISION END`;
  const baseDay = `CASE WHEN ${useAlbaran} THEN CPC.DIADOCUMENTO ELSE CVC.DIAEMISION END`;
  const baseDate = db2DateFromParts(baseYear, baseMonth, baseDay);
  const calculatedDate = `(${baseDate} + INTEGER(CLCL1.DIASLIMITECREDITO) DAYS)`;
  const rawDueYmd = '(CVC.ANOVENCIMIENTO * 10000 + CVC.MESVENCIMIENTO * 100 + CVC.DIAVENCIMIENTO)';
  return `(CASE
    WHEN CLCL1.DIASLIMITECREDITO IS NOT NULL
      AND (${baseYear}) > 0 AND (${baseMonth}) > 0 AND (${baseDay}) > 0
    THEN YEAR(${calculatedDate}) * 10000 + MONTH(${calculatedDate}) * 100 + DAY(${calculatedDate})
    ELSE ${rawDueYmd}
  END)`;
}

function createRepartoFinanceDb2Repository(options = {}) {
  const bindings = options.bindings || resolveFinanceBindings(options.env || process.env);
  const {
    tables,
    erpDataSchema,
    erpAppSchema,
    commissionConfigSchema,
    deliveryStatusTable,
  } = bindings;
  const deliveryStatus = deliveryStatusTable
    || (erpAppSchema + '.DELIVERY_STATUS');
  const qwp = options.queryWithParams || queryWithParams;
  const poolFn = options.getPool || getPool;
  const initFn = options.initDb || initDb;

  async function run(sql, params = []) {
    return qwp(sql, params, false, false);
  }

  async function runOn(conn, sql, params = []) {
    if (conn) return conn.query(sql, params);
    return run(sql, params);
  }

  return {
    bindings,
    tables,
    erpDataSchema,
    erpAppSchema,
    commissionConfigSchema,
    FinanceRepoSchemaError,
    helpers: Object.freeze({
      inClause,
      cobrosDateFilterColumn,
      cobrosDateSelectColumns,
      cobrosDateOrderBy,
      cobrosNotLiquidatedCondition,
      cobrosCodeColumn,
      cobrosAmountColumn,
      cobrosPendingColumn,
      cobrosPaymentColumn,
      liquidacionCodeColumn,
      liquidacionCollectedExpression,
      cobroReplaySelect,
      cobroDocumentCriteria,
      vencimientosDueYmdExpression,
      storagePaymentCode,
      normalizeTipoDocumento,
    }),

    async selectSysColumns(catalogTargets) {
      return run(`
      SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME
      FROM QSYS2.SYSCOLUMNS
      WHERE ${catalogTargets.map(() => '(TABLE_SCHEMA = ? AND TABLE_NAME = ?)').join(' OR ')}
    `, catalogTargets.flatMap(({ schema, table }) => [schema, table]));
    },

    async lockCobrosTable(conn) {
      await conn.query(`LOCK TABLE ${tables.cobros} IN EXCLUSIVE MODE`);
    },

    async lockDeliveryStatusTable(conn) {
      await conn.query(`LOCK TABLE ${deliveryStatus} IN EXCLUSIVE MODE`);
    },

    async sumAppCollectedForDocument(conn, info, input) {
      const criteria = cobroDocumentCriteria(info, input);
      const amountColumn = cobrosAmountColumn(info);
      return runOn(conn, `
    SELECT COALESCE(SUM(${amountColumn}), 0) AS APP_COLLECTED
    FROM ${tables.cobros}
    WHERE ${criteria.sql}
  `, criteria.params);
    },

    async selectCommercialCobroMatch(conn, { codigoCliente, composedRef, likeRef }) {
      return runOn(conn, `
      SELECT ID
        FROM ${tables.commercialCobros}
       WHERE TRIM(CODIGO_CLIENTE) = ?
         AND (TRIM(REFERENCIA) = ? OR REFERENCIA LIKE ?)
       FETCH FIRST 1 ROW ONLY
    `, [String(codigoCliente || '').trim(), composedRef, likeRef]);
    },

    async selectLiquidacionByToken(idempotencyToken) {
      const token = String(idempotencyToken || '').trim();
      if (String(tables.liquidationOps || '').toUpperCase() === 'JAVIER.LQD') {
        return run(`
    SELECT LQD.*
    FROM JAVIER.LQD LQD
    WHERE TRIM(LQD.IDMARCALIQUIDACION) = ?
    FETCH FIRST 1 ROW ONLY
  `, [token.slice(0, 30)]);
      }
      return run(`
    SELECT OPS.*
    FROM ${tables.liquidationOps} OPS
    WHERE OPS.IDEMPOTENCY_TOKEN = ?
    FETCH FIRST 1 ROW ONLY
  `, [token]);
    },

    async selectDailyTotalsLegacy({ repartidorId, dateYmd, dateCol }) {
      return run(`
    SELECT
      COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('EFECTIVO', 'EF', 'F0', 'E', 'CONTADO') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_EFECTIVO,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('CHEQUE', 'TALON', 'TALON BANCARIO') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_CHEQUES,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('TARJETA', 'TJ', 'TPV', 'TRANSFERENCIA', 'TR', 'T0', 'BIZUM', 'BI') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_TARJETA,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(CODIGOFORMAPAGO)) IN ('POSTDATADO', 'POSTDATADOS') THEN IMPORTEVENCIMIENTO ELSE 0 END), 0) AS TOTAL_POSTDATADOS,
      COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL_COBROS_DIA,
      COUNT(*) AS COBROS_COUNT
    FROM ${tables.cobros}
    WHERE TRIM(CODIGOVENDEDOR) = ?
      AND ${dateCol} = ?
      AND COALESCE(LIQUIDADO_SN, 'N') <> 'S'
  `, [repartidorId, dateYmd]);
    },

    async selectBalanceByVendedor(repartidorId) {
      return run(`
    SELECT SALDO_PENDIENTE
    FROM ${tables.balances}
    WHERE TRIM(CODIGOVENDEDOR) = ?
    FETCH FIRST 1 ROW ONLY
  `, [repartidorId]);
    },

    async selectDailyCobrosLegacy({ repartidorId, dateYmd, dateCol, selectCols, orderBy }) {
      return run(`
    SELECT
      RC.ID,
      ${selectCols},
      RC.CODIGOCLIENTEALBARAN,
      TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), TRIM(CLI.NOMBRECLIENTE))) AS NOMBRE_CLIENTE,
      RC.CODIGOFORMAPAGO,
      RC.TIPODOCUMENTO,
      RC.ORIGENDOCUMENTO,
      RC.SERIEDOCUMENTO,
      RC.TERMINALDOCUMENTO,
      RC.NUMERODOCUMENTO,
      RC.EJERCICIODOCUMENTO,
      RC.XDEDOCUMENTO,
      RC.IMPORTEVENCIMIENTO,
      RC.IMPORTEPENDIENTE
    FROM ${tables.cobros} RC
    LEFT JOIN ${erpDataSchema}.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(RC.CODIGOCLIENTEALBARAN)
    WHERE TRIM(RC.CODIGOVENDEDOR) = ?
      AND ${dateCol} = ?
      AND COALESCE(RC.LIQUIDADO_SN, 'N') <> 'S'
    ORDER BY ${orderBy}, RC.ID
  `, [repartidorId, dateYmd]);
    },

    async selectDailyTotals({ info, ids, dateYmd }) {
      const overlay = financeReadOverlay(tables, bindings.runtime);
      const dateCol = cobrosDateFilterColumn(info);
      const amountCol = cobrosAmountColumn(info);
      const paymentCol = cobrosPaymentColumn(info);
      const notLiquidated = cobrosNotLiquidatedCondition(info);
      const branchSql = (fromTable, alias, excludeSql = '') => {
        const repFilter = inClause(`TRIM(${cobrosCodeColumn(info)})`, ids);
        return {
          sql: `SELECT
      COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('EFECTIVO', 'EF', 'F0', 'E', 'CONTADO', 'CT') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_EFECTIVO,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('CHEQUE', 'CH', 'TALON', 'TALON BANCARIO') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_CHEQUES,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('TARJETA', 'TJ', 'TPV', 'TRANSFERENCIA', 'TR', 'T0', 'BIZUM', 'BI') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_TARJETA,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('POSTDATADO', 'PD', 'POSTDATADOS') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_POSTDATADOS,
      COALESCE(SUM(${amountCol}), 0) AS TOTAL_COBROS_DIA,
      COUNT(*) AS COBROS_COUNT
    FROM ${fromTable} ${alias}
    WHERE ${repFilter.sql}
      AND ${dateCol} = ?
      AND ${notLiquidated}
      ${excludeSql}`,
          params: [...repFilter.params, dateYmd],
        };
      };
      if (!overlay.overlay) {
        const single = branchSql(tables.cobros, '');
        return run(single.sql, single.params);
      }
      const prod = branchSql(
        overlay.production.cobros,
        'P',
        cobroKeyExcludeSql('P', tables.cobros, info),
      );
      const test = branchSql(tables.cobros, 'T');
      return run(`
    SELECT
      COALESCE(SUM(TOTAL_EFECTIVO), 0) AS TOTAL_EFECTIVO,
      COALESCE(SUM(TOTAL_CHEQUES), 0) AS TOTAL_CHEQUES,
      COALESCE(SUM(TOTAL_TARJETA), 0) AS TOTAL_TARJETA,
      COALESCE(SUM(TOTAL_POSTDATADOS), 0) AS TOTAL_POSTDATADOS,
      COALESCE(SUM(TOTAL_COBROS_DIA), 0) AS TOTAL_COBROS_DIA,
      COALESCE(SUM(COBROS_COUNT), 0) AS COBROS_COUNT
    FROM (
      ${prod.sql}
      UNION ALL
      ${test.sql}
    ) DAILY_COBROS_OVERLAY
  `, [...prod.params, ...test.params]);
    },

    async selectBalanceSum({ info, ids }) {
      const overlay = financeReadOverlay(tables, bindings.runtime);
      const balanceFilter = inClause(`TRIM(${info.balanceCodeColumn})`, ids);
      if (!overlay.overlay) {
        return run(`
    SELECT COALESCE(SUM(SALDO_PENDIENTE), 0) AS SALDO_PENDIENTE
    FROM ${tables.balances}
    WHERE ${balanceFilter.sql}
  `, balanceFilter.params);
      }
      const testFilter = inClause(`TRIM(T.${info.balanceCodeColumn})`, ids);
      const prodFilter = inClause(`TRIM(P.${info.balanceCodeColumn})`, ids);
      return run(`
    SELECT COALESCE((SELECT SUM(T.SALDO_PENDIENTE)
                       FROM ${tables.balances} T
                      WHERE ${testFilter.sql}), 0)
         + COALESCE((SELECT SUM(P.SALDO_PENDIENTE)
                       FROM ${overlay.production.balances} P
                      WHERE ${prodFilter.sql}
                        AND NOT EXISTS (
                          SELECT 1
                            FROM ${tables.balances} T2
                           WHERE TRIM(T2.${info.balanceCodeColumn}) = TRIM(P.${info.balanceCodeColumn})
                        )), 0) AS SALDO_PENDIENTE
      FROM SYSIBM.SYSDUMMY1
  `, [...testFilter.params, ...prodFilter.params]);
    },

    /**
     * Ensures TEST balance rows exist by reading the latest ERP LQD saldo per vendor.
     * Read-only against DSEDAC; writes only to isolated test balances table.
     */
    async selectLastLqdSaldo(repartidorId) {
      const rows = await run(`
        SELECT LQD.IMPORTESALDOACTUAL AS SALDO
          FROM DSEDAC.LQD LQD
         WHERE TRIM(LQD.CODIGOVENDEDOR) = ?
         ORDER BY LQD.ANOLIQUIDACION DESC, LQD.MESLIQUIDACION DESC,
                  LQD.DIALIQUIDACION DESC, LQD.HORALIQUIDACION DESC,
                  LQD.NUMEROLIQUIDACION DESC
         FETCH FIRST 1 ROW ONLY
      `, [String(repartidorId || '').trim()]);
      return rows;
    },

    async ensureVendorBalancesFromErpLqd(ids = []) {
      if (!Array.isArray(ids) || ids.length === 0) {
        return Object.freeze({ upserted: 0, skipped: true, reason: 'empty_scope' });
      }
      if (String(process.env.REPARTO_TABLE_SET || '').toLowerCase() === 'testmovil') {
        return Object.freeze({ upserted: 0, skipped: true, reason: 'g4_uses_vendedores' });
      }
      assertIsolatedTestWriteTable(tables.balances);
      const vendorFilter = inClause('TRIM(LQD.CODIGOVENDEDOR)', ids);
      await run(`
        INSERT INTO ${tables.balances} (CODIGO_REPARTIDOR, SALDO_PENDIENTE)
        SELECT TRIM(X.CODIGOVENDEDOR),
               (COALESCE(X.IMPORTETOTALAINGRESAR, 0) - COALESCE(X.IMPORTEINGRESOENBANCO, 0))
          FROM (
            SELECT LQD.CODIGOVENDEDOR, LQD.IMPORTESALDOACTUAL,
                   LQD.IMPORTETOTALAINGRESAR, LQD.IMPORTEINGRESOENBANCO,
                   ROW_NUMBER() OVER (
                     PARTITION BY TRIM(LQD.CODIGOVENDEDOR)
                     ORDER BY LQD.ANOLIQUIDACION DESC, LQD.MESLIQUIDACION DESC,
                              LQD.DIALIQUIDACION DESC, LQD.HORALIQUIDACION DESC,
                              LQD.NUMEROLIQUIDACION DESC
                   ) AS RN
              FROM ${liquidacionErpRelation(erpDataSchema)} LQD
             WHERE ${vendorFilter.sql}
          ) X
         WHERE X.RN = 1
           AND NOT EXISTS (
             SELECT 1 FROM ${tables.balances} DST
              WHERE TRIM(DST.CODIGO_REPARTIDOR) = TRIM(X.CODIGOVENDEDOR)
           )
      `, vendorFilter.params);
      return Object.freeze({ upserted: 1, skipped: false });
    },

    async selectDailyStructuredSums({ ids, dateYmd }) {
      const overlay = financeReadOverlay(tables, bindings.runtime);
      const year = Math.trunc(dateYmd / 10000);
      const month = Math.trunc((dateYmd % 10000) / 100);
      const day = dateYmd % 100;
      const vendor = inClause('CODIGO_REPARTIDOR', ids);
      const baseParams = [...vendor.params, day, month, year];
      const sumSql = (writeTable, productionTable) => {
        if (!overlay.overlay || !productionTable) {
          return {
            sql: `SELECT COALESCE(SUM(IMPORTE), 0) AS TOTAL
             FROM ${writeTable}
            WHERE ${vendor.sql}
              AND DIA = ?
              AND MES = ?
              AND ANO = ?`,
            params: baseParams,
          };
        }
        // TEST wins once it has rows (seeded copy + later inserts).
        // Empty TEST falls back to production. Never ADD after a copy.
        return {
          sql: `SELECT COALESCE(
              CASE WHEN (
                SELECT COUNT(*) FROM ${writeTable}
                 WHERE ${vendor.sql} AND DIA = ? AND MES = ? AND ANO = ?
              ) > 0
              THEN (
                SELECT COALESCE(SUM(IMPORTE), 0) FROM ${writeTable}
                 WHERE ${vendor.sql} AND DIA = ? AND MES = ? AND ANO = ?
              )
              ELSE NULL END,
              (SELECT COALESCE(SUM(IMPORTE), 0) FROM ${productionTable}
                WHERE ${vendor.sql} AND DIA = ? AND MES = ? AND ANO = ?),
              0
            ) AS TOTAL
            FROM SYSIBM.SYSDUMMY1`,
          params: [...baseParams, ...baseParams, ...baseParams],
        };
      };
      const gastosQuery = sumSql(tables.expenses, overlay.production?.expenses);
      const ingresosQuery = sumSql(tables.bankDeposits, overlay.production?.bankDeposits);
      const ajustesQuery = sumSql(tables.adjustments, overlay.production?.adjustments);
      const [gastoRows, ingresoRows, ajusteRows] = await Promise.all([
        run(gastosQuery.sql, gastosQuery.params),
        run(ingresosQuery.sql, ingresosQuery.params),
        run(ajustesQuery.sql, ajustesQuery.params),
      ]);
      const first = (rows) => (Array.isArray(rows) && rows.length ? rows[0] : {});
      const money = (row) => roundMoney(row?.TOTAL ?? row?.total ?? 0);
      return Object.freeze({
        gastos: money(first(gastoRows)),
        ingresoBanco: money(first(ingresoRows)),
        ajustes: money(first(ajusteRows)),
      });
    },

    async selectClosedLiquidacion({ info, ids, dateYmd }) {
      const year = Math.trunc(dateYmd / 10000);
      const month = Math.trunc((dateYmd % 10000) / 100);
      const day = dateYmd % 100;
      const ownerFilter = inClause(`TRIM(${liquidacionCodeColumn(info, 'OPS')})`, ids);
      const statusFilter = info.has('REPARTIDOR_LIQUIDACION_OPS', 'STATUS')
        ? "AND OPS.STATUS = 'CLOSED'"
        : '';
      return run(`
    SELECT OPS.*
      FROM ${tables.liquidationOps} OPS
     WHERE ${ownerFilter.sql}
       AND OPS.DIALIQUIDACION = ?
       AND OPS.MESLIQUIDACION = ?
       AND OPS.ANOLIQUIDACION = ?
       ${statusFilter}
     ORDER BY OPS.ID DESC
     FETCH FIRST 1 ROW ONLY
  `, [...ownerFilter.params, day, month, year]);
    },

    async seedIsolatedTestFinanceFromProduction({ info, ids, dateYmd, force = false } = {}) {
      // Population belongs exclusively to copy-javier-prod-to-test.js and an
      // explicit operator --apply. Runtime reads, including GET handlers, must
      // never copy production app state into TEST tables.
      if (bindings.runtime?.tableSet === 'isolated_test') {
        return Object.freeze({ skipped: true, reason: 'explicit_copy_script_required' });
      }
      const overlay = financeReadOverlay(tables, bindings.runtime);
      if (!overlay.overlay || !overlay.production) {
        return Object.freeze({ skipped: true, reason: 'no_overlay' });
      }
      if (!force && skipIsolatedTestFinanceSeed()) {
        return Object.freeze({ skipped: true, reason: 'test' });
      }
      if (!Array.isArray(ids) || ids.length === 0 || !Number.isInteger(dateYmd)) {
        return Object.freeze({ skipped: true, reason: 'invalid_scope' });
      }

      assertIsolatedTestWriteTable(tables.cobros);
      assertIsolatedTestWriteTable(tables.balances);
      assertIsolatedTestWriteTable(tables.expenses);
      assertIsolatedTestWriteTable(tables.adjustments);
      assertIsolatedTestWriteTable(tables.bankDeposits);

      const year = Math.trunc(dateYmd / 10000);
      const month = Math.trunc((dateYmd % 10000) / 100);
      const day = dateYmd % 100;
      const copied = {
        cobros: 0, balances: 0, expenses: 0, adjustments: 0, bankDeposits: 0,
      };

      try {
        const dateCol = cobrosDateFilterColumn(info, 'SRC');
        const notLiquidated = cobrosNotLiquidatedCondition(info, 'SRC');
        const vendorFilter = inClause(`TRIM(${cobrosCodeColumn(info, 'SRC')})`, ids);
        const excludeCopied = cobroKeyExcludeSql('SRC', tables.cobros, info);
        if (info.cobrosAligned && info.cobrosHasDocumentColumns !== false) {
          const cobroColumns = [
            'CODIGOCLIENTEALBARAN', 'CODIGOCLIENTEFACTURA', 'CODIGOVENDEDOR', 'CODIGOVENDEDORCOBRO',
            'TIPODOCUMENTO', 'ORIGENDOCUMENTO', 'SUBEMPRESADOCUMENTO', 'EJERCICIODOCUMENTO',
            'SERIEDOCUMENTO', 'TERMINALDOCUMENTO', 'NUMERODOCUMENTO', 'XDEDOCUMENTO', 'DEXDOCUMENTO',
            'IMPORTEVENCIMIENTO', 'IMPORTEPENDIENTE', 'CODIGOFORMAPAGO',
            'DIACOBRO', 'MESCOBRO', 'ANOCOBRO', 'IDEMPOTENCY_TOKEN', 'PANTALLA_ORIGEN', 'OPERADOR',
            'OBSERVACIONES',
          ].filter((column) => !info.has || info.has('REPARTIDOR_COBROS', column));
          if (info.has && info.has('REPARTIDOR_COBROS', 'LIQUIDADO_SN')) {
            cobroColumns.push('LIQUIDADO_SN');
          }
          if (info.has && info.has('REPARTIDOR_COBROS', 'NUMEROLIQUIDACION')) {
            cobroColumns.push('NUMEROLIQUIDACION');
          }
          const cobroSelect = cobroColumns.map((column) => {
            if (column === 'IDEMPOTENCY_TOKEN') {
              return `'SEED-' CONCAT TRIM(VARCHAR(SRC.ID))`;
            }
            if (column === 'PANTALLA_ORIGEN') return `'SEED_COPY'`;
            if (column === 'OPERADOR') return `'SYSTEM'`;
            return `SRC.${column}`;
          });
          if (cobroColumns.length > 0) {
            await run(`
              INSERT INTO ${tables.cobros} (${cobroColumns.join(', ')})
              SELECT ${cobroSelect.join(', ')}
                FROM ${overlay.production.cobros} SRC
               WHERE ${vendorFilter.sql}
                 AND ${dateCol} = ?
                 AND ${notLiquidated}
                 ${excludeCopied}
            `, [...vendorFilter.params, dateYmd]);
            copied.cobros = 1;
          }
        }

        const lqdVendor = inClause('TRIM(LQD.CODIGOVENDEDOR)', ids);
        const lqdDateParams = [...lqdVendor.params, year, month, day];
        const lqdSplits = [
          ['EF', 'IMPORTEEFECTIVO'],
          ['CH', 'IMPORTECHEQUES'],
          ['TJ', 'IMPORTETARJETA'],
          ['PD', 'IMPORTEPOSTDATADOS'],
        ];
        for (const [forma, column] of lqdSplits) {
          const token = `'SEED-LQD-${forma}-' CONCAT TRIM(LQD.CODIGOVENDEDOR) CONCAT '-' CONCAT TRIM(VARCHAR(${dateYmd}))`;
          await run(`
            INSERT INTO ${tables.cobros} (
              CODIGOVENDEDOR, CODIGOVENDEDORCOBRO, DIACOBRO, MESCOBRO, ANOCOBRO,
              IMPORTEVENCIMIENTO, IMPORTEPENDIENTE, CODIGOFORMAPAGO,
              IDEMPOTENCY_TOKEN, PANTALLA_ORIGEN, OPERADOR, OBSERVACIONES, LIQUIDADO_SN
            )
            SELECT TRIM(LQD.CODIGOVENDEDOR), TRIM(LQD.CODIGOVENDEDOR),
                   LQD.DIALIQUIDACION, LQD.MESLIQUIDACION, LQD.ANOLIQUIDACION,
                   LQD.${column}, CAST(0 AS DECIMAL(15,2)), '${forma}',
                   ${token}, 'SEED_LQD', 'SYSTEM', 'ERP DSEDAC.LQD', 'N'
              FROM ${liquidacionErpRelation(erpDataSchema)} LQD
             WHERE ${lqdVendor.sql}
               AND LQD.ANOLIQUIDACION = ?
               AND LQD.MESLIQUIDACION = ?
               AND LQD.DIALIQUIDACION = ?
               AND LQD.${column} > 0
               AND NOT EXISTS (
                 SELECT 1 FROM ${tables.cobros} DST
                  WHERE DST.IDEMPOTENCY_TOKEN = ${token}
               )
          `, lqdDateParams);
        }
        copied.cobros = 1;

        const lqdStructVendor = inClause('TRIM(LQD.CODIGOVENDEDOR)', ids);
        await run(`
          INSERT INTO ${tables.expenses} (
            IDEMPOTENCY_TOKEN, CODIGO_REPARTIDOR, DIA, MES, ANO, IMPORTE,
            CATEGORIA, OBSERVACION, STATUS, ACTOR_ID, ACTOR_ROLE
          )
          SELECT 'SEED-LQD-GAS-' CONCAT TRIM(LQD.CODIGOVENDEDOR) CONCAT '-' CONCAT TRIM(VARCHAR(${dateYmd})),
                 TRIM(LQD.CODIGOVENDEDOR), LQD.DIALIQUIDACION, LQD.MESLIQUIDACION, LQD.ANOLIQUIDACION,
                 LQD.IMPORTEGASTOS, 'ERP', 'ERP DSEDAC.LQD', 'PENDING', 'SEED', 'SYSTEM'
            FROM ${liquidacionErpRelation(erpDataSchema)} LQD
           WHERE ${lqdStructVendor.sql}
             AND LQD.ANOLIQUIDACION = ? AND LQD.MESLIQUIDACION = ? AND LQD.DIALIQUIDACION = ?
             AND LQD.IMPORTEGASTOS > 0
             AND NOT EXISTS (
               SELECT 1 FROM ${tables.expenses} DST
                WHERE DST.IDEMPOTENCY_TOKEN = 'SEED-LQD-GAS-' CONCAT TRIM(LQD.CODIGOVENDEDOR) CONCAT '-' CONCAT TRIM(VARCHAR(${dateYmd}))
             )
        `, [...lqdStructVendor.params, year, month, day]);
        await run(`
          INSERT INTO ${tables.bankDeposits} (
            IDEMPOTENCY_TOKEN, CODIGO_REPARTIDOR, DIA, MES, ANO, IMPORTE,
            REFERENCIA, OBSERVACION, STATUS, ACTOR_ID, ACTOR_ROLE
          )
          SELECT 'SEED-LQD-ING-' CONCAT TRIM(LQD.CODIGOVENDEDOR) CONCAT '-' CONCAT TRIM(VARCHAR(${dateYmd})),
                 TRIM(LQD.CODIGOVENDEDOR), LQD.DIALIQUIDACION, LQD.MESLIQUIDACION, LQD.ANOLIQUIDACION,
                 LQD.IMPORTEINGRESOENBANCO, 'ERP-LQD', 'ERP DSEDAC.LQD', 'PENDING', 'SEED', 'SYSTEM'
            FROM ${liquidacionErpRelation(erpDataSchema)} LQD
           WHERE ${lqdStructVendor.sql}
             AND LQD.ANOLIQUIDACION = ? AND LQD.MESLIQUIDACION = ? AND LQD.DIALIQUIDACION = ?
             AND LQD.IMPORTEINGRESOENBANCO > 0
             AND NOT EXISTS (
               SELECT 1 FROM ${tables.bankDeposits} DST
                WHERE DST.IDEMPOTENCY_TOKEN = 'SEED-LQD-ING-' CONCAT TRIM(LQD.CODIGOVENDEDOR) CONCAT '-' CONCAT TRIM(VARCHAR(${dateYmd}))
             )
        `, [...lqdStructVendor.params, year, month, day]);
        await run(`
          INSERT INTO ${tables.balances} (CODIGO_REPARTIDOR, SALDO_PENDIENTE)
          SELECT TRIM(LQD.CODIGOVENDEDOR),
                 (COALESCE(LQD.IMPORTETOTALAINGRESAR, 0) - COALESCE(LQD.IMPORTEINGRESOENBANCO, 0))
            FROM ${liquidacionErpRelation(erpDataSchema)} LQD
           WHERE ${lqdStructVendor.sql}
             AND LQD.ANOLIQUIDACION = ? AND LQD.MESLIQUIDACION = ? AND LQD.DIALIQUIDACION = ?
             AND NOT EXISTS (
               SELECT 1 FROM ${tables.balances} DST
                WHERE TRIM(DST.CODIGO_REPARTIDOR) = TRIM(LQD.CODIGOVENDEDOR)
             )
        `, [...lqdStructVendor.params, year, month, day]);

        const balanceFilter = inClause(`TRIM(${info.balanceCodeColumn || 'CODIGO_REPARTIDOR'})`, ids);
        const prodBalanceCode = info.balanceCodeColumn || 'CODIGO_REPARTIDOR';
        await run(`
          INSERT INTO ${tables.balances} (CODIGO_REPARTIDOR, SALDO_PENDIENTE)
          SELECT TRIM(SRC.${prodBalanceCode}), SRC.SALDO_PENDIENTE
            FROM ${overlay.production.balances} SRC
           WHERE ${balanceFilter.sql.replace(prodBalanceCode, `SRC.${prodBalanceCode}`)}
             AND NOT EXISTS (
               SELECT 1 FROM ${tables.balances} DST
                WHERE TRIM(DST.CODIGO_REPARTIDOR) = TRIM(SRC.${prodBalanceCode})
             )
        `, balanceFilter.params);
        copied.balances = 1;

        const structuredVendor = inClause('SRC.CODIGO_REPARTIDOR', ids);
        const copyStructured = async (dest, source, detailColumn) => {
          assertIsolatedTestWriteTable(dest);
          await run(`
            INSERT INTO ${dest} (
              IDEMPOTENCY_TOKEN, CODIGO_REPARTIDOR, DIA, MES, ANO, IMPORTE,
              ${detailColumn}, OBSERVACION, STATUS, ACTOR_ID, ACTOR_ROLE
            )
            SELECT 'SEED-' CONCAT TRIM(VARCHAR(SRC.ID)), SRC.CODIGO_REPARTIDOR, SRC.DIA, SRC.MES, SRC.ANO,
                   SRC.IMPORTE, SRC.${detailColumn}, SRC.OBSERVACION, SRC.STATUS, 'SEED', 'SYSTEM'
              FROM ${source} SRC
             WHERE ${structuredVendor.sql}
               AND SRC.DIA = ? AND SRC.MES = ? AND SRC.ANO = ?
               AND COALESCE(SRC.STATUS, 'PENDING') = 'PENDING'
               AND NOT EXISTS (
                 SELECT 1 FROM ${dest} DST
                  WHERE DST.IDEMPOTENCY_TOKEN = 'SEED-' CONCAT TRIM(VARCHAR(SRC.ID))
               )
               AND NOT EXISTS (
                 SELECT 1 FROM ${dest} DST
                  WHERE TRIM(DST.CODIGO_REPARTIDOR) = TRIM(SRC.CODIGO_REPARTIDOR)
                    AND DST.DIA = SRC.DIA AND DST.MES = SRC.MES AND DST.ANO = SRC.ANO
                    AND DST.IMPORTE = SRC.IMPORTE
                    AND COALESCE(DST.${detailColumn}, '') = COALESCE(SRC.${detailColumn}, '')
               )
          `, [...structuredVendor.params, day, month, year]);
        };
        await copyStructured(tables.expenses, overlay.production.expenses, 'CATEGORIA');
        copied.expenses = 1;
        await copyStructured(tables.adjustments, overlay.production.adjustments, 'MOTIVO');
        copied.adjustments = 1;
        await copyStructured(tables.bankDeposits, overlay.production.bankDeposits, 'REFERENCIA');
        copied.bankDeposits = 1;
        return Object.freeze({ skipped: false, copied });
      } catch (error) {
        logger.warn(`[FINANCE_SEED] isolated_test copy skipped: ${String(error?.message || error).slice(0, 180)}`);
        return Object.freeze({ skipped: true, reason: 'error', copied });
      }
    },

    async selectDailyCobros({ info, ids, dateYmd }) {
      const overlay = financeReadOverlay(tables, bindings.runtime);
      const aliasedDateCol = cobrosDateFilterColumn(info, 'RC');
      const selectCols = cobrosDateSelectColumns(info);
      const orderBy = cobrosDateOrderBy(info);
      const notLiquidatedRc = cobrosNotLiquidatedCondition(info, 'RC');
      const hasDocs = info.cobrosHasDocumentColumns !== false;
      const idToken = info.cobrosHasIdempotencyToken === false
        ? 'CAST(NULL AS VARCHAR(64)) AS IDEMPOTENCY_TOKEN'
        : 'RC.IDEMPOTENCY_TOKEN';
      const clientCol = hasDocs
        ? (info.cobrosAligned ? 'RC.CODIGOCLIENTEALBARAN' : 'RC.CODIGO_CLIENTE AS CODIGOCLIENTEALBARAN')
        : "CAST(NULL AS VARCHAR(20)) AS CODIGOCLIENTEALBARAN";
      const clientJoinCol = hasDocs
        ? (info.cobrosAligned ? 'RC.CODIGOCLIENTEALBARAN' : 'RC.CODIGO_CLIENTE')
        : null;
      const cliJoin = clientJoinCol
        ? `LEFT JOIN ${erpDataSchema}.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(${clientJoinCol})`
        : '';
      const clientName = clientJoinCol
        ? "TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), TRIM(CLI.NOMBRECLIENTE))) AS NOMBRE_CLIENTE"
        : "CAST(NULL AS VARCHAR(80)) AS NOMBRE_CLIENTE";
      const selectList = `
      RC.ID,
      ${idToken},
      ${selectCols},
      ${clientCol},
      ${clientName},
      ${info.cobrosAligned ? 'RC.CODIGOFORMAPAGO' : 'RC.FORMA_PAGO AS CODIGOFORMAPAGO'},
      ${hasDocs ? (info.cobrosAligned ? 'RC.TIPODOCUMENTO' : 'RC.TIPO_DOCUMENTO AS TIPODOCUMENTO') : "CAST(NULL AS VARCHAR(10)) AS TIPODOCUMENTO"},
      ${hasDocs ? (info.cobrosAligned ? 'RC.ORIGENDOCUMENTO' : "COALESCE(RC.ORIGEN_DOCUMENTO, 'B') AS ORIGENDOCUMENTO") : "CAST('B' AS VARCHAR(10)) AS ORIGENDOCUMENTO"},
      ${hasDocs ? (info.cobrosAligned ? 'RC.SERIEDOCUMENTO' : "COALESCE(RC.SERIE_DOCUMENTO, '') AS SERIEDOCUMENTO") : "CAST('' AS VARCHAR(10)) AS SERIEDOCUMENTO"},
      ${hasDocs ? (info.cobrosAligned ? 'RC.TERMINALDOCUMENTO' : 'COALESCE(RC.TERMINAL_DOCUMENTO, 0) AS TERMINALDOCUMENTO') : 'CAST(0 AS INTEGER) AS TERMINALDOCUMENTO'},
      ${hasDocs ? (info.cobrosAligned ? 'RC.NUMERODOCUMENTO' : 'RC.NUMERO_DOCUMENTO AS NUMERODOCUMENTO') : 'CAST(0 AS INTEGER) AS NUMERODOCUMENTO'},
      ${hasDocs ? (info.cobrosAligned ? 'RC.EJERCICIODOCUMENTO' : 'RC.EJERCICIO_DOCUMENTO AS EJERCICIODOCUMENTO') : 'CAST(0 AS INTEGER) AS EJERCICIODOCUMENTO'},
      ${hasDocs ? (info.cobrosAligned ? 'RC.XDEDOCUMENTO' : 'COALESCE(RC.XDE_DOCUMENTO, 1) AS XDEDOCUMENTO') : 'CAST(1 AS INTEGER) AS XDEDOCUMENTO'},
      ${cobrosAmountColumn(info, 'RC')} AS IMPORTEVENCIMIENTO,
      ${cobrosPendingColumn(info, 'RC')} AS IMPORTEPENDIENTE`;
      const branch = (fromTable, excludeSql = '') => {
        const repFilterRc = inClause(`TRIM(${cobrosCodeColumn(info, 'RC')})`, ids);
        return {
          sql: `SELECT ${selectList}
    FROM ${fromTable} RC
    ${cliJoin}
    WHERE ${repFilterRc.sql}
      AND ${aliasedDateCol} = ?
      AND ${notLiquidatedRc}
      ${excludeSql}`,
          params: [...repFilterRc.params, dateYmd],
        };
      };
      if (!overlay.overlay) {
        const single = branch(tables.cobros);
        return run(`${single.sql}
    ORDER BY ${orderBy}, RC.ID`, single.params);
      }
      const prod = branch(
        overlay.production.cobros,
        cobroKeyExcludeSql('RC', tables.cobros, info),
      );
      const test = branch(tables.cobros);
      return run(`
    SELECT * FROM (
      ${prod.sql}
      UNION ALL
      ${test.sql}
    ) DAILY_COBROS_ROWS
    ORDER BY ID
  `, [...prod.params, ...test.params]);
    },

    async selectMonthlyCobrosTotals({ info, ids, firstDay, firstDayNextMonth }) {
      const cobrosCodeFilter = inClause(`TRIM(${cobrosCodeColumn(info, 'RC')})`, ids);
      const cobrosDateColumn = cobrosDateFilterColumn(info, 'RC');
      const collectedAmountColumn = cobrosAmountColumn(info, 'RC');
      return run(`
    SELECT
      COALESCE(SUM(${collectedAmountColumn}), 0) AS TOTAL_COBRADO,
      COUNT(*) AS COBROS_COUNT
    FROM ${tables.cobros} RC
    WHERE ${cobrosCodeFilter.sql}
      AND ${cobrosDateColumn} >= ?
      AND ${cobrosDateColumn} < ?
  `, [...cobrosCodeFilter.params, firstDay, firstDayNextMonth]);
    },

    async selectMonthlyLiquidaciones({ info, ids, year, month }) {
      const liquidacionCodeFilter = inClause(
        `TRIM(${liquidacionCodeColumn(info, 'OPS')})`,
        ids,
      );
      const liquidatedAmountExpression = liquidacionCollectedExpression(info, 'OPS');
      return run(`
    SELECT OPS.*, ${liquidatedAmountExpression} AS TOTAL_LIQUIDADO_COBROS
    FROM ${tables.liquidationOps} OPS
    WHERE ${liquidacionCodeFilter.sql}
      AND OPS.ANOLIQUIDACION = ?
      AND OPS.MESLIQUIDACION = ?
    ORDER BY OPS.ANOLIQUIDACION, OPS.MESLIQUIDACION,
      OPS.DIALIQUIDACION, OPS.IDEMPOTENCY_TOKEN
  `, [...liquidacionCodeFilter.params, year, month]);
    },

    async selectVencimientosPage({
      info, ids, fromYmd, toYmd, clientCode, search, estado, todayYmd, offset, pageLimit,
    }) {
      const repFilter = inClause('TRIM(OPP.CODIGOREPARTIDOR)', ids);
      const dueYmd = vencimientosDueYmdExpression();
      const params = [...repFilter.params, fromYmd, toYmd];
      const hasAppDocs = info?.cobrosHasDocumentColumns !== false;
      let clientFilter = '';
      if (clientCode) {
        clientFilter = ' AND TRIM(CVC.CODIGOCLIENTEALBARAN) = ?';
        params.push(clientCode.trim());
      }
      let searchFilter = '';
      if (search && search.trim()) {
        const term = `%${search.trim()}%`;
        searchFilter = ' AND ('
          + 'UPPER(TRIM(CVC.CODIGOCLIENTEALBARAN)) LIKE UPPER(?)'
          + ' OR UPPER(TRIM(CLI.NOMBRECLIENTE)) LIKE UPPER(?)'
          + ' OR UPPER(TRIM(CLI.NOMBREALTERNATIVO)) LIKE UPPER(?)'
          + ' OR UPPER(TRIM(CVC.TIPODOCUMENTO)) LIKE UPPER(?)'
          + ' OR UPPER(TRIM(CVC.SERIEDOCUMENTO)) LIKE UPPER(?)'
          + ' OR TRIM(CAST(CVC.NUMERODOCUMENTO AS VARCHAR(20))) LIKE ?'
          + ')';
        params.push(term, term, term, term, term, term);
      }
      let stateFilter = '';
      if (estado === 'vencido' || estado === 'pendiente') {
        stateFilter = estado === 'vencido'
          ? ' AND BASE.DUE_YMD < ?'
          : ' AND BASE.DUE_YMD >= ?';
        params.push(todayYmd);
      }
      params.push(offset, offset + pageLimit);

      const pendingExpr = hasAppDocs
        ? 'CAST(CVC.IMPORTEPENDIENTE - COALESCE(APP_COBROS.IMPORTE_COBRADO_APP, 0) AS DECIMAL(15,2)) AS IMPORTEPENDIENTE'
        : 'CAST(CVC.IMPORTEPENDIENTE AS DECIMAL(15,2)) AS IMPORTEPENDIENTE';
      const appCobrosJoin = hasAppDocs ? `
        LEFT JOIN (
          SELECT
            TRIM(CODIGOVENDEDOR) AS CODIGOVENDEDOR,
            TRIM(CODIGOCLIENTEALBARAN) AS CODIGOCLIENTEALBARAN,
            TRIM(TIPODOCUMENTO) AS TIPODOCUMENTO,
            TRIM(ORIGENDOCUMENTO) AS ORIGENDOCUMENTO,
            TRIM(SUBEMPRESADOCUMENTO) AS SUBEMPRESADOCUMENTO,
            EJERCICIODOCUMENTO,
            TRIM(SERIEDOCUMENTO) AS SERIEDOCUMENTO,
            TERMINALDOCUMENTO,
            NUMERODOCUMENTO,
            XDEDOCUMENTO,
            DEXDOCUMENTO,
            SUM(COALESCE(IMPORTEVENCIMIENTO, 0)) AS IMPORTE_COBRADO_APP
          FROM ${tables.cobros}
          GROUP BY TRIM(CODIGOVENDEDOR), TRIM(CODIGOCLIENTEALBARAN),
            TRIM(TIPODOCUMENTO), TRIM(ORIGENDOCUMENTO),
            TRIM(SUBEMPRESADOCUMENTO), EJERCICIODOCUMENTO,
            TRIM(SERIEDOCUMENTO), TERMINALDOCUMENTO,
            NUMERODOCUMENTO, XDEDOCUMENTO, DEXDOCUMENTO
        ) APP_COBROS
          ON APP_COBROS.CODIGOVENDEDOR = TRIM(OPP.CODIGOREPARTIDOR)
          AND APP_COBROS.CODIGOCLIENTEALBARAN = TRIM(CVC.CODIGOCLIENTEALBARAN)
          AND APP_COBROS.TIPODOCUMENTO = TRIM(CVC.TIPODOCUMENTO)
          AND APP_COBROS.ORIGENDOCUMENTO = TRIM(CVC.ORIGENDOCUMENTO)
          AND APP_COBROS.SUBEMPRESADOCUMENTO = TRIM(CVC.SUBEMPRESADOCUMENTO)
          AND APP_COBROS.EJERCICIODOCUMENTO = CVC.EJERCICIODOCUMENTO
          AND APP_COBROS.SERIEDOCUMENTO = TRIM(CVC.SERIEDOCUMENTO)
          AND APP_COBROS.TERMINALDOCUMENTO = CVC.TERMINALDOCUMENTO
          AND APP_COBROS.NUMERODOCUMENTO = CVC.NUMERODOCUMENTO
          AND COALESCE(APP_COBROS.XDEDOCUMENTO, 1) = COALESCE(CVC.XDEDOCUMENTO, 1)
          AND COALESCE(APP_COBROS.DEXDOCUMENTO, 1) = COALESCE(CVC.DEXDOCUMENTO, 1)` : '';

      return run(`
    SELECT *
    FROM (
      SELECT
        BASE.*,
        COUNT(*) OVER() AS TOTAL_COUNT,
        ROW_NUMBER() OVER (
          ORDER BY BASE.DUE_YMD,
            BASE.EJERCICIODOCUMENTO, BASE.TIPODOCUMENTO,
            BASE.ORIGENDOCUMENTO, BASE.SUBEMPRESADOCUMENTO,
            BASE.SERIEDOCUMENTO, BASE.TERMINALDOCUMENTO,
            BASE.NUMERODOCUMENTO, BASE.XDEDOCUMENTO,
            BASE.DEXDOCUMENTO, BASE.CODIGOCLIENTEALBARAN
        ) AS RN
      FROM (
        SELECT
          CVC.TIPODOCUMENTO,
          CVC.ORIGENDOCUMENTO,
          CVC.SUBEMPRESADOCUMENTO,
          CVC.EJERCICIODOCUMENTO,
          CVC.SERIEDOCUMENTO,
          CVC.TERMINALDOCUMENTO,
          CVC.NUMERODOCUMENTO,
          CVC.XDEDOCUMENTO,
          CVC.DEXDOCUMENTO,
          CVC.CODIGOCLIENTEALBARAN,
          TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBRECLIENTE), ''), CVC.CODIGOCLIENTEALBARAN)) AS NOMBRE_CLIENTE,
          TRIM(COALESCE(CLI.NOMBREALTERNATIVO, '')) AS NOMBREALTERNATIVO,
          TRIM(COALESCE(CLI.POBLACION, '')) AS POBLACION,
          CVC.DIAVENCIMIENTO,
          CVC.MESVENCIMIENTO,
          CVC.ANOVENCIMIENTO,
          CVC.DIAEMISION AS FACTURA_BASE_DIA,
          CVC.MESEMISION AS FACTURA_BASE_MES,
          CVC.ANOEMISION AS FACTURA_BASE_ANO,
          CPC.DIADOCUMENTO AS ALBARAN_BASE_DIA,
          CPC.MESDOCUMENTO AS ALBARAN_BASE_MES,
          CPC.ANODOCUMENTO AS ALBARAN_BASE_ANO,
          CLCL1.DIASLIMITECREDITO,
          CLCL1.DIASLIMITECREDITOCONFECHAALB,
          CVC.IMPORTEVENCIMIENTO,
          ${pendingExpr},
          ${dueYmd} AS DUE_YMD
        FROM ${erpDataSchema}.CVC CVC
        INNER JOIN ${erpDataSchema}.CPC CPC
          ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
          AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
          AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
          AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN
          AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
        INNER JOIN ${erpDataSchema}.OPP OPP
          ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
          AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
          AND OPP.SUBEMPRESA = CPC.SUBEMPRESAPEDIDO
        LEFT JOIN ${erpDataSchema}.CLI CLI
          ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
        LEFT JOIN ${erpDataSchema}.CLCL1 CLCL1
          ON TRIM(CLCL1.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
        ${appCobrosJoin}
        WHERE ${repFilter.sql}
          AND ${dueYmd} BETWEEN ? AND ?
          AND COALESCE(CVC.ANULADOSN, '') <> 'S'
          AND CVC.TIPODOCUMENTO IN ('CAC', 'COC', 'DEV')
          ${clientFilter}
          ${searchFilter}
      ) BASE
      WHERE BASE.IMPORTEPENDIENTE <> 0
        ${stateFilter}
    ) PAGED
    WHERE PAGED.RN > ? AND PAGED.RN <= ?
    ORDER BY PAGED.RN
  `, params);
    },

    async connect() {
      let pool = poolFn();
      if (!pool) {
        await initFn();
        pool = poolFn();
      }
      return pool.connect();
    },

    async beginWork(conn) {
      // IBM i ODBC rejects BEGIN WORK with SQLSTATE 42000 / SQL0104.
      // Setting the isolation level starts the explicit unit of work while
      // keeping COMMIT/ROLLBACK available for the caller's atomic operation.
      await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    },

    async commit(conn) {
      await conn.query('COMMIT');
    },

    async rollback(conn) {
      await conn.query('ROLLBACK');
    },

    async withTransaction(callback) {
      const conn = await this.connect();
      try {
        await this.beginWork(conn);
        const result = await callback(conn);
        await this.commit(conn);
        return result;
      } catch (error) {
        try {
          await this.rollback(conn);
        } catch (_) {
          // ignore rollback errors; caller logs
        }
        throw error;
      } finally {
        try {
          await conn.close();
        } catch (_) {
          // ignore close errors
        }
      }
    },

    async validateCobroDocument(input, conn = null) {
      const sql = `
    SELECT CVC.IMPORTEPENDIENTE AS ERP_IMPORTEPENDIENTE
    FROM ${erpDataSchema}.CVC CVC
    INNER JOIN ${erpDataSchema}.CPC CPC
      ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
      AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
      AND TRIM(CVC.SERIEDOCUMENTO) = TRIM(CPC.SERIEALBARAN)
      AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN
      AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
    INNER JOIN ${erpDataSchema}.OPP OPP
      ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
      AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
    WHERE TRIM(CVC.TIPODOCUMENTO) = ?
      AND TRIM(CVC.ORIGENDOCUMENTO) = ?
      AND TRIM(CVC.SUBEMPRESADOCUMENTO) = ?
      AND CVC.EJERCICIODOCUMENTO = ?
      AND TRIM(CVC.SERIEDOCUMENTO) = ?
      AND CVC.TERMINALDOCUMENTO = ?
      AND CVC.NUMERODOCUMENTO = ?
      AND COALESCE(CVC.XDEDOCUMENTO, 1) = ?
      AND COALESCE(CVC.DEXDOCUMENTO, 1) = ?
      AND TRIM(CVC.CODIGOCLIENTEALBARAN) = ?
      AND TRIM(OPP.CODIGOREPARTIDOR) = ?
    FETCH FIRST 1 ROW ONLY
  `;
      const params = [
        normalizeTipoDocumento(input.tipoDocumento),
        input.origenDocumento || 'B',
        input.subempresaDocumento || 'GMP',
        input.ejercicioDocumento,
        input.serieDocumento,
        input.terminalDocumento,
        input.numeroDocumento,
        input.xdeDocumento || 1,
        input.dexDocumento || 1,
        input.codigoCliente,
        input.codigoRepartidor,
      ];
      return runOn(conn, sql, params);
    },

    async selectCobroByToken(info, idempotencyToken, conn = null) {
      return runOn(conn, `
      SELECT ${cobroReplaySelect(info)}
      FROM ${tables.cobros}
      WHERE IDEMPOTENCY_TOKEN = ?
      FETCH FIRST 1 ROW ONLY
    `, [idempotencyToken]);
    },

    async selectDeliveryStatusByToken(idempotencyToken) {
      return run(`
      SELECT CONFORMADOSN
      FROM ${deliveryStatus}
      WHERE IDEMPOTENCY_TOKEN = ?
      FETCH FIRST 1 ROW ONLY
    `, [idempotencyToken]);
    },

    async selectDeliveryStatus(conn, { statusCol, repCol, lookupCol, lookupVal }) {
      return runOn(conn, `
        SELECT ${statusCol}, UPDATED_AT, ${repCol}
        FROM ${deliveryStatus}
        WHERE ${lookupCol} = ?
        FETCH FIRST 1 ROW ONLY
      `, [lookupVal]);
    },

    async deleteDeliveryStatus(conn, { lookupCol, lookupVal }) {
      await runOn(conn, `
        DELETE FROM ${deliveryStatus}
        WHERE ${lookupCol} = ?
      `, [lookupVal]);
    },

    async insertDeliveryStatusNew(conn, {
      status, lat, lon, repartidorId, idempotencyToken,
    }) {
      await runOn(conn, `
          INSERT INTO ${deliveryStatus} (
            STATUS,
            LATITUD,
            LONGITUD,
            OPERADOR,
            PANTALLA_ORIGEN,
            IDEMPOTENCY_TOKEN,
            UPDATED_AT
          ) VALUES (?, ?, ?, ?, 'COBROS', ?, CURRENT TIMESTAMP)
        `, [
        status,
        lat,
        lon,
        repartidorId,
        idempotencyToken,
      ]);
    },

    async insertDeliveryStatusLegacy(conn, {
      itemId, status, observaciones, firma, lat, lon, repartidorId,
    }) {
      await runOn(conn, `
          INSERT INTO ${deliveryStatus} (
            ID,
            CONFORMADOSN,
            OBSERVACIONES,
            FIRMA_PATH,
            LATITUD,
            LONGITUD,
            REPARTIDOR_ID,
            UPDATED_AT
          ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT TIMESTAMP)
        `, [
        itemId,
        status,
        observaciones || '',
        firma || '',
        lat,
        lon,
        repartidorId,
      ]);
    },

    async insertCobroRow(conn, info, input) {
      const now = new Date();
      const columns = [];
      const params = [];
      const add = (column, value) => {
        if (!info.has('REPARTIDOR_COBROS', column)) return;
        columns.push(column);
        params.push(value);
      };

      if (info.cobrosAligned) {
        add('CODIGOCLIENTEALBARAN', input.codigoCliente);
        add('CODIGOCLIENTEFACTURA', input.codigoCliente);
        add('CODIGOVENDEDOR', input.codigoRepartidor);
        add('CODIGOVENDEDORCOBRO', input.codigoRepartidor);
        add('TIPODOCUMENTO', normalizeTipoDocumento(input.tipoDocumento));
        add('ORIGENDOCUMENTO', input.origenDocumento || 'B');
        add('SUBEMPRESADOCUMENTO', input.subempresaDocumento || 'GMP');
        add('EJERCICIODOCUMENTO', input.ejercicioDocumento);
        add('SERIEDOCUMENTO', input.serieDocumento);
        add('TERMINALDOCUMENTO', input.terminalDocumento);
        add('NUMERODOCUMENTO', input.numeroDocumento);
        add('XDEDOCUMENTO', input.xdeDocumento || 1);
        add('DEXDOCUMENTO', input.dexDocumento || 1);
        add('IMPORTEVENCIMIENTO', roundMoney(input.importeCobrado));
        add('IMPORTEPENDIENTE', roundMoney(input.importePendiente));
        add('CODIGOFORMAPAGO', storagePaymentCode(input.formaPago, info));
        add('DIACOBRO', now.getDate());
        add('MESCOBRO', now.getMonth() + 1);
        add('ANOCOBRO', now.getFullYear());
        add('IDEMPOTENCY_TOKEN', input.idempotencyToken);
        add('PANTALLA_ORIGEN', input.pantallaOrigen || 'RUTERO');
        add('OPERADOR', input.operador || 'unknown');
        add('OBSERVACIONES', input.notas || '');
      } else {
        add('CODIGO_CLIENTE', input.codigoCliente);
        add('NOMBRE_CLIENTE', input.nombreCliente || '');
        add('CODIGO_REPARTIDOR', input.codigoRepartidor);
        add('TIPO_DOCUMENTO', normalizeTipoDocumento(input.tipoDocumento));
        add('ORIGEN_DOCUMENTO', input.origenDocumento || 'B');
        add('SUBEMPRESA_DOCUMENTO', input.subempresaDocumento || 'GMP');
        add('EJERCICIO_DOCUMENTO', input.ejercicioDocumento);
        add('SERIE_DOCUMENTO', input.serieDocumento);
        add('TERMINAL_DOCUMENTO', input.terminalDocumento);
        add('NUMERO_DOCUMENTO', input.numeroDocumento);
        add('XDE_DOCUMENTO', input.xdeDocumento || 1);
        add('DEX_DOCUMENTO', input.dexDocumento || 1);
        add('IMPORTE_COBRADO', roundMoney(input.importeCobrado));
        add('IMPORTE_PENDIENTE', roundMoney(input.importePendiente));
        add('FORMA_PAGO', storagePaymentCode(input.formaPago, info));
        add('IDEMPOTENCY_TOKEN', input.idempotencyToken);
        add('PANTALLA_ORIGEN', input.pantallaOrigen || 'RUTERO');
        add('OPERADOR', input.operador || 'unknown');
        add('NOTAS', input.notas || '');
      }

      await runOn(conn, `
      INSERT INTO ${tables.cobros} (
        ${columns.join(',\n        ')}
      ) VALUES (${columns.map(() => '?').join(', ')})
    `, params);
    },

    async selectCommissionTiers() {
      return run(`
    SELECT ID, THRESHOLD_PCT, COMMISSION_PCT, SORT_ORDER, ACTIVE_SN
    FROM ${tables.commissionTiers}
    WHERE ACTIVE_SN = 'S' AND THRESHOLD_PCT >= 30
    ORDER BY SORT_ORDER, THRESHOLD_PCT
  `, []);
    },

    async selectDeliveredAmountLegacy({ repartidorId, fromYmd, toYmd }) {
      return run(`
    SELECT COALESCE(SUM(CPC.IMPORTETOTAL), 0) AS TOTAL_REPARTIDO
    FROM ${erpDataSchema}.OPP OPP
    INNER JOIN ${erpDataSchema}.CPC CPC
      ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
      AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
    WHERE TRIM(OPP.CODIGOREPARTIDOR) = ?
      AND (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) BETWEEN ? AND ?
  `, [repartidorId, fromYmd, toYmd]);
    },

    async selectCollectedAmountLegacy({ repartidorId, fromYmd, toYmdInclusive, dateCol }) {
      return run(`
    SELECT COALESCE(SUM(IMPORTEVENCIMIENTO), 0) AS TOTAL_COBRADO
    FROM ${tables.cobros}
    WHERE TRIM(CODIGOVENDEDOR) = ?
      AND ${dateCol} >= ?
      AND ${dateCol} <= ?
  `, [repartidorId, fromYmd, toYmdInclusive]);
    },

    async selectDeliveredAmount({ ids, fromYmd, toYmd }) {
      const repFilter = ids.length === 1
        ? inClause('TRIM(OPP.CODIGOREPARTIDOR)', ids)
        : {
          sql: '(' + ids.map(() => 'TRIM(OPP.CODIGOREPARTIDOR) = ?').join(' OR ') + ')',
          params: ids,
        };
      return run(`
    SELECT COALESCE(SUM(CPC.IMPORTETOTAL), 0) AS TOTAL_REPARTIDO
    FROM ${erpDataSchema}.OPP OPP
    INNER JOIN ${erpDataSchema}.CPC CPC
      ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
      AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
      AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
    WHERE ${repFilter.sql}
      AND (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) BETWEEN ? AND ?
  `, [...repFilter.params, fromYmd, toYmd]);
    },

    async selectDailyErpDebt({ ids, dateYmd }) {
      const repFilter = inClause('TRIM(OPP.CODIGOREPARTIDOR)', ids);
      return run(`
    WITH DELIVERY_DOCUMENTS AS (
      SELECT
        CPC.SUBEMPRESAALBARAN,
        CPC.EJERCICIOALBARAN,
        CPC.SERIEALBARAN,
        CPC.TERMINALALBARAN,
        CPC.NUMEROALBARAN,
        ROW_NUMBER() OVER (
          PARTITION BY CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN,
            TRIM(CPC.SERIEALBARAN), CPC.TERMINALALBARAN, CPC.NUMEROALBARAN
          ORDER BY OPP.EJERCICIOORDENPREPARACION DESC,
            OPP.NUMEROORDENPREPARACION DESC, OPP.SUBEMPRESA
        ) AS ALBARAN_RANK
      FROM ${erpDataSchema}.OPP OPP
      INNER JOIN ${erpDataSchema}.CPC CPC
        ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
        AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
        AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
      WHERE ${repFilter.sql}
        AND (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) = ?
    )
    SELECT COALESCE(SUM(COALESCE(CVC.IMPORTEPENDIENTE, 0)), 0) AS DEUDA_PENDIENTE
    FROM DELIVERY_DOCUMENTS DOC
    LEFT JOIN ${erpDataSchema}.CVC CVC
      ON CVC.SUBEMPRESADOCUMENTO = DOC.SUBEMPRESAALBARAN
      AND CVC.EJERCICIODOCUMENTO = DOC.EJERCICIOALBARAN
      AND CVC.SERIEDOCUMENTO = DOC.SERIEALBARAN
      AND CVC.TERMINALDOCUMENTO = DOC.TERMINALALBARAN
      AND CVC.NUMERODOCUMENTO = DOC.NUMEROALBARAN
    WHERE DOC.ALBARAN_RANK = 1
  `, [...repFilter.params, dateYmd]);
    },

    async selectCollectedFromErp({ ids, fromYmd, toYmd }) {
      const repFilter = inClause('TRIM(OPP.CODIGOREPARTIDOR)', ids);
      return run(`
    SELECT COALESCE(SUM(CASE
      WHEN COALESCE(CVC.IMPORTEPENDIENTE, 0) = 0
      THEN CPC.IMPORTETOTAL
      ELSE CPC.IMPORTETOTAL - COALESCE(CVC.IMPORTEPENDIENTE, 0)
    END), 0) AS TOTAL_COBRADO
    FROM ${erpDataSchema}.OPP OPP
    INNER JOIN ${erpDataSchema}.CPC CPC
      ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
      AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
      AND CPC.SUBEMPRESAPEDIDO = OPP.SUBEMPRESA
    LEFT JOIN ${erpDataSchema}.CVC CVC
      ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
      AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
      AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
      AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN
      AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
    WHERE ${repFilter.sql}
      AND (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) BETWEEN ? AND ?
  `, [...repFilter.params, fromYmd, toYmd]);
    },

    async deactivateCommissionTiers(conn, updatedBy) {
      await runOn(conn, `
      UPDATE ${tables.commissionTiers}
      SET ACTIVE_SN = 'N',
          UPDATED_BY = ?,
          UPDATED_AT = CURRENT_TIMESTAMP
      WHERE ACTIVE_SN = 'S'
    `, [updatedBy || 'unknown']);
    },

    async insertCommissionTier(conn, { tiers, updatedBy }) {
      for (let index = 0; index < tiers.length; index++) {
        const tier = tiers[index];
        await runOn(conn, `
        INSERT INTO ${tables.commissionTiers} (
          THRESHOLD_PCT,
          COMMISSION_PCT,
          SORT_ORDER,
          ACTIVE_SN,
          CREATED_BY
        ) VALUES (?, ?, ?, 'S', ?)
      `, [
          roundMoney(tier.thresholdPct),
          roundMoney(tier.commissionPct),
          index + 1,
          updatedBy || 'unknown',
        ]);
      }
    },

    async selectDetalleVencimiento({ params, repartidorId }) {
      return run(`
      SELECT
        TRIM(CVC.TIPODOCUMENTO) AS TIPODOCUMENTO,
        TRIM(CVC.ORIGENDOCUMENTO) AS ORIGENDOCUMENTO,
        TRIM(CVC.SUBEMPRESADOCUMENTO) AS SUBEMPRESADOCUMENTO,
        CVC.EJERCICIODOCUMENTO,
        TRIM(CVC.SERIEDOCUMENTO) AS SERIEDOCUMENTO,
        CVC.TERMINALDOCUMENTO,
        CVC.NUMERODOCUMENTO,
        CVC.XDEDOCUMENTO,
        CVC.DEXDOCUMENTO,
        TRIM(CVC.CODIGOCLIENTEALBARAN) AS CODIGOCLIENTE,
        TRIM(COALESCE(CLI.NOMBRECLIENTE, '')) AS NOMBRE_CLIENTE,
        TRIM(COALESCE(CLI.NOMBREALTERNATIVO, '')) AS NOMBRE_ALTERNATIVO,
        TRIM(COALESCE(CLI.POBLACION, '')) AS POBLACION,
        TRIM(COALESCE(CVC.CODIGOFORMAPAGO, '')) AS CODIGOFORMAPAGO,
        CVC.DIAEMISION, CVC.MESEMISION, CVC.ANOEMISION,
        CVC.DIAVENCIMIENTO, CVC.MESVENCIMIENTO, CVC.ANOVENCIMIENTO,
        CAST(CVC.IMPORTEVENCIMIENTO AS DECIMAL(15,2)) AS IMPORTEVENCIMIENTO,
        CAST(CVC.IMPORTECANCELADO AS DECIMAL(15,2)) AS IMPORTECANCELADO,
        CAST(CVC.IMPORTEPENDIENTE AS DECIMAL(15,2)) AS IMPORTEPENDIENTE,
        TRIM(COALESCE(CVC.CODIGOVENDEDOR, '')) AS CODIGOVENDEDOR,
        TRIM(COALESCE(CVC.CODIGOVENDEDORCOBRO, '')) AS CODIGOVENDEDORCOBRO,
        TRIM(COALESCE(CVC.ANULADOSN, '')) AS ANULADOSN
      FROM ${erpDataSchema}.CVC CVC
      INNER JOIN ${erpDataSchema}.CPC CPC
        ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
        AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
        AND TRIM(CVC.SERIEDOCUMENTO) = TRIM(CPC.SERIEALBARAN)
        AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN
        AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
      INNER JOIN ${erpDataSchema}.OPP OPP
        ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
        AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
        AND OPP.SUBEMPRESA = CPC.SUBEMPRESAPEDIDO
      LEFT JOIN ${erpDataSchema}.CLI CLI
        ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
      WHERE TRIM(CVC.TIPODOCUMENTO) = ?
        AND CVC.EJERCICIODOCUMENTO = ?
        AND TRIM(CVC.SERIEDOCUMENTO) = ?
        AND CVC.TERMINALDOCUMENTO = ?
        AND CVC.NUMERODOCUMENTO = ?
        AND COALESCE(CVC.XDEDOCUMENTO, 1) = ?
        AND TRIM(OPP.CODIGOREPARTIDOR) = ?
      FETCH FIRST 1 ROW ONLY
    `, [...params, repartidorId]);
    },

    async selectSaldoFromBalances(repartidorId) {
      return run(
        `SELECT COALESCE(SALDO_PENDIENTE, 0) AS SALDO
       FROM ${tables.balances}
        WHERE TRIM(CODIGO_REPARTIDOR) = ?
        FETCH FIRST 1 ROW ONLY`,
        [repartidorId],
      );
    },

    async selectSaldoFromPendingCobros({ info, repartidorId }) {
      const codeColumn = cobrosCodeColumn(info);
      const pendingColumn = info.cobrosAligned
        ? 'IMPORTEPENDIENTE'
        : info.has('REPARTIDOR_COBROS', 'IMPORTE_PENDIENTE')
          ? 'IMPORTE_PENDIENTE'
          : cobrosAmountColumn(info);
      const notLiquidated = cobrosNotLiquidatedCondition(info);
      return run(
        `SELECT COALESCE(SUM(${pendingColumn}), 0) AS SALDO
       FROM ${tables.cobros}
       WHERE TRIM(${codeColumn}) = ?
         AND ${notLiquidated}`,
        [repartidorId],
      );
    },

    async selectEvolution({ info, ids }) {
      const codeColumn = cobrosCodeColumn(info);
      const amountColumn = cobrosAmountColumn(info);
      const codeFilter = inClause(`TRIM(${codeColumn})`, ids);
      const yearExpr = info.cobrosHasCollectionDate
        ? 'ANOCOBRO'
        : info.cobrosHasFechaCobro
          ? 'YEAR(FECHA_COBRO)'
          : 'ANOVENCIMIENTO';
      const monthExpr = info.cobrosHasCollectionDate
        ? 'MESCOBRO'
        : info.cobrosHasFechaCobro
          ? 'MONTH(FECHA_COBRO)'
          : 'MESVENCIMIENTO';
      return run(
        `SELECT ${yearExpr} AS ANO,
            ${monthExpr} AS MES,
            COALESCE(SUM(${amountColumn}), 0) AS TOTAL,
            COUNT(*) AS NUM_COBROS
     FROM ${tables.cobros}
     WHERE ${codeFilter.sql}
       AND ${yearExpr} BETWEEN 2000 AND 2100
       AND ${monthExpr} BETWEEN 1 AND 12
     GROUP BY ${yearExpr}, ${monthExpr}
     ORDER BY ${yearExpr} DESC, ${monthExpr} DESC
     FETCH FIRST 6 ROWS ONLY`,
        codeFilter.params,
      );
    },

    async selectTopProducts({ ids, safeLimit }) {
      const repFilter = inClause('TRIM(OPP.CODIGOREPARTIDOR)', ids);
      return run(
        `SELECT TRIM(LAC.CODIGOARTICULO) AS CODIGO,
            TRIM(COALESCE(NULLIF(TRIM(ART.DESCRIPCIONARTICULO), ''), NULLIF(TRIM(LAC.DESCRIPCION), ''), LAC.CODIGOARTICULO)) AS NOMBRE,
            COALESCE(SUM(LAC.CANTIDADENVASES), 0) AS UNIDADES,
            COALESCE(SUM(LAC.IMPORTEVENTA), 0) AS IMPORTE
     FROM ${erpDataSchema}.CPC CPC
     INNER JOIN ${erpDataSchema}.LAC LAC
       ON LAC.SUBEMPRESAALBARAN = CPC.SUBEMPRESAALBARAN
      AND LAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
      AND LAC.SERIEALBARAN = CPC.SERIEALBARAN
      AND LAC.TERMINALALBARAN = CPC.TERMINALALBARAN
      AND LAC.NUMEROALBARAN = CPC.NUMEROALBARAN
     LEFT JOIN ${erpDataSchema}.ART ART
       ON TRIM(ART.CODIGOARTICULO) = TRIM(LAC.CODIGOARTICULO)
     INNER JOIN ${erpDataSchema}.OPP OPP
       ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
      AND OPP.EJERCICIOORDENPREPARACION = CPC.EJERCICIOORDENPREPARACION
     WHERE ${repFilter.sql}
       AND CPC.ANODOCUMENTO >= YEAR(CURRENT DATE) - 1
       AND TRIM(LAC.CODIGOARTICULO) <> ''
     GROUP BY TRIM(LAC.CODIGOARTICULO),
              TRIM(COALESCE(NULLIF(TRIM(ART.DESCRIPCIONARTICULO), ''), NULLIF(TRIM(LAC.DESCRIPCION), ''), LAC.CODIGOARTICULO))
     ORDER BY IMPORTE DESC, CODIGO
     FETCH FIRST ${safeLimit} ROWS ONLY`,
        repFilter.params,
      );
    },
  };
}

let _defaultRepo = null;

function getRepartoFinanceDb2Repository() {
  if (!_defaultRepo) {
    _defaultRepo = createRepartoFinanceDb2Repository();
  }
  return _defaultRepo;
}

function resetRepartoFinanceDb2RepositoryForTests() {
  _defaultRepo = null;
}

module.exports = {
  createRepartoFinanceDb2Repository,
  getRepartoFinanceDb2Repository,
  resetRepartoFinanceDb2RepositoryForTests,
  resolveFinanceBindings,
  FinanceRepoSchemaError,
  skipIsolatedTestFinanceSeed,
  assertIsolatedTestWriteTable,
};
