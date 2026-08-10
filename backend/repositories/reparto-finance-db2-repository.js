'use strict';

/**
 * DB2 access for repartidor finance (G2-B1).
 * Owns ALL SQL used by repartidor-finance-service.
 * No DSEDAC mutation — commercialCobros is read-only guard.
 */

const { queryWithParams, getPool, initDb } = require('../config/db');
const { resolveRepartoRuntime, validateFinanceTableMapping } = require('../config/reparto-runtime');

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
  return info.cobrosAligned ? `${prefix}IMPORTEPENDIENTE` : `${prefix}IMPORTE_PENDIENTE`;
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
    RIGHT('0000' || TRIM(CHAR(${yearExpression})), 4) || '-' ||
    RIGHT('00' || TRIM(CHAR(${monthExpression})), 2) || '-' ||
    RIGHT('00' || TRIM(CHAR(${dayExpression})), 2)
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
  } = bindings;
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
      await conn.query(`LOCK TABLE ${erpAppSchema}.DELIVERY_STATUS IN EXCLUSIVE MODE`);
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
      return run(`
    SELECT OPS.*
    FROM ${tables.liquidationOps} OPS
    WHERE OPS.IDEMPOTENCY_TOKEN = ?
    FETCH FIRST 1 ROW ONLY
  `, [idempotencyToken]);
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
      const dateCol = cobrosDateFilterColumn(info);
      const repFilter = inClause(`TRIM(${cobrosCodeColumn(info)})`, ids);
      const amountCol = cobrosAmountColumn(info);
      const paymentCol = cobrosPaymentColumn(info);
      const notLiquidated = cobrosNotLiquidatedCondition(info);
      return run(`
    SELECT
      COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('EFECTIVO', 'EF', 'F0', 'E', 'CONTADO', 'CT') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_EFECTIVO,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('CHEQUE', 'CH', 'TALON', 'TALON BANCARIO') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_CHEQUES,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('TARJETA', 'TJ', 'TPV', 'TRANSFERENCIA', 'TR', 'T0', 'BIZUM', 'BI') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_TARJETA,
      COALESCE(SUM(CASE WHEN UPPER(TRIM(${paymentCol})) IN ('POSTDATADO', 'PD', 'POSTDATADOS') THEN ${amountCol} ELSE 0 END), 0) AS TOTAL_POSTDATADOS,
      COALESCE(SUM(${amountCol}), 0) AS TOTAL_COBROS_DIA,
      COUNT(*) AS COBROS_COUNT
    FROM ${tables.cobros}
    WHERE ${repFilter.sql}
      AND ${dateCol} = ?
      AND ${notLiquidated}
  `, [...repFilter.params, dateYmd]);
    },

    async selectBalanceSum({ info, ids }) {
      const balanceFilter = inClause(`TRIM(${info.balanceCodeColumn})`, ids);
      return run(`
    SELECT COALESCE(SUM(SALDO_PENDIENTE), 0) AS SALDO_PENDIENTE
    FROM ${tables.balances}
    WHERE ${balanceFilter.sql}
  `, balanceFilter.params);
    },

    async selectDailyCobros({ info, ids, dateYmd }) {
      const aliasedDateCol = cobrosDateFilterColumn(info, 'RC');
      const selectCols = cobrosDateSelectColumns(info);
      const orderBy = cobrosDateOrderBy(info);
      const repFilterRc = inClause(`TRIM(${cobrosCodeColumn(info, 'RC')})`, ids);
      const notLiquidatedRc = cobrosNotLiquidatedCondition(info, 'RC');
      return run(`
    SELECT
      RC.ID,
      RC.IDEMPOTENCY_TOKEN,
      ${selectCols},
      ${info.cobrosAligned ? 'RC.CODIGOCLIENTEALBARAN' : 'RC.CODIGO_CLIENTE AS CODIGOCLIENTEALBARAN'},
      TRIM(COALESCE(NULLIF(TRIM(CLI.NOMBREALTERNATIVO), ''), TRIM(CLI.NOMBRECLIENTE))) AS NOMBRE_CLIENTE,
      ${info.cobrosAligned ? 'RC.CODIGOFORMAPAGO' : 'RC.FORMA_PAGO AS CODIGOFORMAPAGO'},
      ${info.cobrosAligned ? 'RC.TIPODOCUMENTO' : 'RC.TIPO_DOCUMENTO AS TIPODOCUMENTO'},
      ${info.cobrosAligned ? 'RC.ORIGENDOCUMENTO' : "COALESCE(RC.ORIGEN_DOCUMENTO, 'B') AS ORIGENDOCUMENTO"},
      ${info.cobrosAligned ? 'RC.SERIEDOCUMENTO' : "COALESCE(RC.SERIE_DOCUMENTO, '') AS SERIEDOCUMENTO"},
      ${info.cobrosAligned ? 'RC.TERMINALDOCUMENTO' : 'COALESCE(RC.TERMINAL_DOCUMENTO, 0) AS TERMINALDOCUMENTO'},
      ${info.cobrosAligned ? 'RC.NUMERODOCUMENTO' : 'RC.NUMERO_DOCUMENTO AS NUMERODOCUMENTO'},
      ${info.cobrosAligned ? 'RC.EJERCICIODOCUMENTO' : 'RC.EJERCICIO_DOCUMENTO AS EJERCICIODOCUMENTO'},
      ${info.cobrosAligned ? 'RC.XDEDOCUMENTO' : 'COALESCE(RC.XDE_DOCUMENTO, 1) AS XDEDOCUMENTO'},
      ${cobrosAmountColumn(info, 'RC')} AS IMPORTEVENCIMIENTO,
      ${cobrosPendingColumn(info, 'RC')} AS IMPORTEPENDIENTE
    FROM ${tables.cobros} RC
    LEFT JOIN ${erpDataSchema}.CLI CLI ON TRIM(CLI.CODIGOCLIENTE) = TRIM(${info.cobrosAligned ? 'RC.CODIGOCLIENTEALBARAN' : 'RC.CODIGO_CLIENTE'})
    WHERE ${repFilterRc.sql}
      AND ${aliasedDateCol} = ?
      AND ${notLiquidatedRc}
    ORDER BY ${orderBy}, RC.ID
  `, [...repFilterRc.params, dateYmd]);
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
      ids, fromYmd, toYmd, clientCode, estado, todayYmd, offset, pageLimit,
    }) {
      const repFilter = inClause('TRIM(OPP.CODIGOREPARTIDOR)', ids);
      const dueYmd = vencimientosDueYmdExpression();
      const params = [...repFilter.params, fromYmd, toYmd];
      let clientFilter = '';
      if (clientCode) {
        clientFilter = ' AND TRIM(CVC.CODIGOCLIENTEALBARAN) = ?';
        params.push(clientCode.trim());
      }
      let stateFilter = '';
      if (estado === 'vencido' || estado === 'pendiente') {
        stateFilter = estado === 'vencido'
          ? ' AND BASE.DUE_YMD < ?'
          : ' AND BASE.DUE_YMD >= ?';
        params.push(todayYmd);
      }
      params.push(offset, offset + pageLimit);

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
          CAST(CVC.IMPORTEPENDIENTE - COALESCE(APP_COBROS.IMPORTE_COBRADO_APP, 0) AS DECIMAL(15,2)) AS IMPORTEPENDIENTE,
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
        LEFT JOIN ${erpDataSchema}.CLI CLI
          ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
        LEFT JOIN ${erpDataSchema}.CLCL1 CLCL1
          ON TRIM(CLCL1.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
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
          AND COALESCE(APP_COBROS.DEXDOCUMENTO, 1) = COALESCE(CVC.DEXDOCUMENTO, 1)
        WHERE ${repFilter.sql}
          AND ${dueYmd} BETWEEN ? AND ?
          AND COALESCE(CVC.ANULADOSN, '') <> 'S'
          AND CVC.TIPODOCUMENTO IN ('CAC', 'COC', 'DEV')
          ${clientFilter}
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
      await conn.query('BEGIN WORK');
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
      FROM ${erpAppSchema}.DELIVERY_STATUS
      WHERE IDEMPOTENCY_TOKEN = ?
      FETCH FIRST 1 ROW ONLY
    `, [idempotencyToken]);
    },

    async selectDeliveryStatus(conn, { statusCol, repCol, lookupCol, lookupVal }) {
      return runOn(conn, `
        SELECT ${statusCol}, UPDATED_AT, ${repCol}
        FROM ${erpAppSchema}.DELIVERY_STATUS
        WHERE ${lookupCol} = ?
        FETCH FIRST 1 ROW ONLY
      `, [lookupVal]);
    },

    async deleteDeliveryStatus(conn, { lookupCol, lookupVal }) {
      await runOn(conn, `
        DELETE FROM ${erpAppSchema}.DELIVERY_STATUS
        WHERE ${lookupCol} = ?
      `, [lookupVal]);
    },

    async insertDeliveryStatusNew(conn, {
      status, lat, lon, repartidorId, idempotencyToken,
    }) {
      await runOn(conn, `
          INSERT INTO ${erpAppSchema}.DELIVERY_STATUS (
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
          INSERT INTO ${erpAppSchema}.DELIVERY_STATUS (
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
        add('OBSERVACIONES', input.notas || null);
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
        add('NOTAS', input.notas || null);
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
    FROM ${commissionConfigSchema}.REPARTIDOR_COMMISSION_TIERS
    WHERE ACTIVE_SN = 'S'
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
      const repFilter = inClause('TRIM(OPP.CODIGOREPARTIDOR)', ids);
      return run(`
    SELECT COALESCE(SUM(CPC.IMPORTETOTAL), 0) AS TOTAL_REPARTIDO
    FROM ${erpDataSchema}.OPP OPP
    INNER JOIN ${erpDataSchema}.CPC CPC
      ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
      AND CPC.EJERCICIOORDENPREPARACION = OPP.EJERCICIOORDENPREPARACION
    WHERE ${repFilter.sql}
      AND (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) BETWEEN ? AND ?
  `, [...repFilter.params, fromYmd, toYmd]);
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
      UPDATE ${commissionConfigSchema}.REPARTIDOR_COMMISSION_TIERS
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
        INSERT INTO ${commissionConfigSchema}.REPARTIDOR_COMMISSION_TIERS (
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
      LEFT JOIN ${erpDataSchema}.CLI CLI
        ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CVC.CODIGOCLIENTEALBARAN)
      WHERE TRIM(CVC.TIPODOCUMENTO) = ?
        AND CVC.EJERCICIODOCUMENTO = ?
        AND TRIM(CVC.SERIEDOCUMENTO) = ?
        AND CVC.TERMINALDOCUMENTO = ?
        AND CVC.NUMERODOCUMENTO = ?
        AND COALESCE(CVC.XDEDOCUMENTO, 1) = ?
        AND (TRIM(CVC.CODIGOVENDEDOR) = ? OR TRIM(CVC.CODIGOVENDEDORCOBRO) = ?)
      FETCH FIRST 1 ROW ONLY
    `, [...params, repartidorId, repartidorId]);
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
};
