'use strict';

/**
 * BOLSA COMERCIAL SERVICE
 * =======================
 * Manages the "commercial bag" - a per-vendor monthly budget that
 * tracks accumulated margin and allows flexible pricing within limits.
 *
 * Write schema: DB2_WRITE_SCHEMA (default JAVIER). ERP reads: DSEDAC.ARA.
 */

const { queryWithParams } = require('../config/db');
const {
    openDedicatedPedidosTransactionConnection,
} = require('../adapters/pedidos-transaction-connection');
const logger = require('../middleware/logger');
const { comercialErpTable } = require('../utils/comercial-erp-tables');
const { db2AppTable } = require('../utils/db2-schemas');
const BOLSA_TABLE = db2AppTable('BOLSA_COMERCIAL');
const MOVIMIENTOS_TABLE = db2AppTable('MOVIMIENTOS_BOLSA');
const PEDIDOS_CAB_TABLE = db2AppTable('PEDIDOS_CAB');

const MAX_IDEMPOTENCY_LOOKUP_BATCH = 10;

const BOLSA_SELECT_BY_VENDOR_MONTH_SQL = [
    'SELECT ID, CODIGOVENDEDOR, EJERCICIO, MES, LIMITE_PCT, LIMITE_IMPORTE,',
    'SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO',
    `FROM ${BOLSA_TABLE}`,
    'WHERE TRIM(CODIGOVENDEDOR) = ? AND EJERCICIO = ? AND MES = ?',
    'FETCH FIRST 1 ROW ONLY',
].join(' ');

const BOLSA_INSERT_DEFAULT_SQL = [
    `INSERT INTO ${BOLSA_TABLE}`,
    '(CODIGOVENDEDOR, EJERCICIO, MES, LIMITE_PCT, LIMITE_IMPORTE,',
    'SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO, CREATED_AT, UPDATED_AT)',
    'VALUES (?, ?, ?, 3.0, 0, 300.00, 0, 0, CURRENT TIMESTAMP, CURRENT TIMESTAMP)',
].join(' ');

const MOVIMIENTOS_SELECT_BY_BOLSA_SQL = [
    'SELECT M.ID, M.TIPO, M.IMPORTE, M.SALDO_ANTERIOR, M.SALDO_POSTERIOR,',
    'M.CODIGO_ARTICULO, M.DESCRIPCION, M.PEDIDO_ID, M.CREATED_AT, M.LINEA_ID,',
    'M.PRECIO_MINIMO_CONGELADO, M.PRECIO_VENTA, M.CANTIDAD, M.UNIDAD_MEDIDA, M.IDEMPOTENCY_KEY,',
    'TRIM(COALESCE(M.CODIGOVENDEDOR, B.CODIGOVENDEDOR)) AS CODIGOVENDEDOR,',
    'B.EJERCICIO AS BOLSA_EJERCICIO, B.MES AS BOLSA_MES,',
    'TRIM(C.CODIGOCLIENTE) AS CODIGOCLIENTE, TRIM(C.NOMBRECLIENTE) AS NOMBRECLIENTE,',
    'C.EJERCICIO AS PEDIDO_EJERCICIO, TRIM(C.SERIEPEDIDO) AS SERIEPEDIDO, C.TERMINAL, C.NUMEROPEDIDO,',
    'TRIM(C.SYSTEM_SERIEPEDIDO) AS SYSTEM_SERIEPEDIDO, C.SYSTEM_TERMINALPEDIDO, C.SYSTEM_NUMEROPEDIDO, C.SYSTEM_EJERCICIOPEDIDO,',
    'TRIM(C.TARGET_SCHEMA) AS TARGET_SCHEMA, TRIM(C.SYNC_STATUS) AS SYNC_STATUS',
    `FROM ${MOVIMIENTOS_TABLE} M`,
    `INNER JOIN ${BOLSA_TABLE} B ON B.ID = M.BOLSA_ID`,
    `LEFT JOIN ${PEDIDOS_CAB_TABLE} C ON C.ID = M.PEDIDO_ID`,
    'WHERE M.BOLSA_ID = ?',
    'ORDER BY M.CREATED_AT DESC, M.ID DESC',
    'FETCH FIRST ? ROWS ONLY',
].join(' ');

const MOVIMIENTOS_SELECT_BASE_SQL = [
    'SELECT M.ID, M.TIPO, M.IMPORTE, M.SALDO_ANTERIOR, M.SALDO_POSTERIOR,',
    'M.CODIGO_ARTICULO, M.DESCRIPCION, M.PEDIDO_ID, M.CREATED_AT, M.LINEA_ID,',
    'M.PRECIO_MINIMO_CONGELADO, M.PRECIO_VENTA, M.CANTIDAD, M.UNIDAD_MEDIDA, M.IDEMPOTENCY_KEY,',
    'TRIM(COALESCE(M.CODIGOVENDEDOR, B.CODIGOVENDEDOR)) AS CODIGOVENDEDOR,',
    'B.EJERCICIO AS BOLSA_EJERCICIO, B.MES AS BOLSA_MES,',
    'TRIM(C.CODIGOCLIENTE) AS CODIGOCLIENTE, TRIM(C.NOMBRECLIENTE) AS NOMBRECLIENTE,',
    'C.EJERCICIO AS PEDIDO_EJERCICIO, TRIM(C.SERIEPEDIDO) AS SERIEPEDIDO, C.TERMINAL, C.NUMEROPEDIDO,',
    'TRIM(C.SYSTEM_SERIEPEDIDO) AS SYSTEM_SERIEPEDIDO, C.SYSTEM_TERMINALPEDIDO, C.SYSTEM_NUMEROPEDIDO, C.SYSTEM_EJERCICIOPEDIDO,',
    'TRIM(C.TARGET_SCHEMA) AS TARGET_SCHEMA, TRIM(C.SYNC_STATUS) AS SYNC_STATUS',
    `FROM ${MOVIMIENTOS_TABLE} M`,
    `INNER JOIN ${BOLSA_TABLE} B ON B.ID = M.BOLSA_ID`,
    `LEFT JOIN ${PEDIDOS_CAB_TABLE} C ON C.ID = M.PEDIDO_ID`,
].join(' ');

const IDEMPOTENCY_KEYS_SELECT_SQL = Object.freeze(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [
    i + 1, `SELECT IDEMPOTENCY_KEY FROM ${MOVIMIENTOS_TABLE} WHERE IDEMPOTENCY_KEY IN (${Array(i + 1).fill('?').join(', ')})`,
])));

const LOCK_BOLSA_COMERCIAL_SQL = `LOCK TABLE ${BOLSA_TABLE} IN EXCLUSIVE MODE`;
const LOCK_MOVIMIENTOS_BOLSA_SQL = `LOCK TABLE ${MOVIMIENTOS_TABLE} IN EXCLUSIVE MODE`;
const BOLSA_UPDATE_ACCUMULATE_SQL = `UPDATE ${BOLSA_TABLE} SET SALDO_DISPONIBLE = ?, ACUMULADO = ACUMULADO + ?, UPDATED_AT = CURRENT TIMESTAMP WHERE ID = ?`;
const BOLSA_UPDATE_CONSUME_SQL = `UPDATE ${BOLSA_TABLE} SET SALDO_DISPONIBLE = ?, CONSUMIDO = CONSUMIDO + ?, UPDATED_AT = CURRENT TIMESTAMP WHERE ID = ?`;
const MOVIMIENTOS_INSERT_PREFIX = `INSERT INTO ${MOVIMIENTOS_TABLE} (BOLSA_ID, CREATED_AT, CODIGOVENDEDOR, PEDIDO_ID, LINEA_ID, TIPO, IMPORTE, SALDO_ANTERIOR, SALDO_POSTERIOR, CODIGO_ARTICULO, DESCRIPCION, PRECIO_MINIMO_CONGELADO, PRECIO_VENTA, CANTIDAD, UNIDAD_MEDIDA, IDEMPOTENCY_KEY) VALUES `;
const MOVIMIENTOS_INSERT_ROW = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
const BOLSA_HISTORIAL_MENSUAL_SQL = [
    'SELECT EJERCICIO, MES, SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO, LIMITE_PCT, LIMITE_IMPORTE',
    `FROM ${BOLSA_TABLE}`,
    'WHERE TRIM(CODIGOVENDEDOR) = ?',
    'AND (EJERCICIO > ? OR (EJERCICIO = ? AND MES >= ?))',
    'AND (EJERCICIO < ? OR (EJERCICIO = ? AND MES <= ?))',
    'ORDER BY EJERCICIO ASC, MES ASC',
].join(' ');
const BOLSA_GROUPED_STATUS_BASE_SQL = [
    'SELECT ID, CODIGOVENDEDOR, EJERCICIO, MES, LIMITE_PCT, LIMITE_IMPORTE,',
    'SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO',
    `FROM ${BOLSA_TABLE}`,
    'WHERE EJERCICIO = ? AND MES = ?',
].join(' ');
const BOLSA_UPDATE_CONFIG_BOTH_SQL = `UPDATE ${BOLSA_TABLE} SET LIMITE_PCT = ?, LIMITE_IMPORTE = ?, UPDATED_AT = CURRENT TIMESTAMP WHERE ID = ?`;
const BOLSA_UPDATE_CONFIG_PCT_SQL = `UPDATE ${BOLSA_TABLE} SET LIMITE_PCT = ?, UPDATED_AT = CURRENT TIMESTAMP WHERE ID = ?`;
const BOLSA_UPDATE_CONFIG_AMOUNT_SQL = `UPDATE ${BOLSA_TABLE} SET LIMITE_IMPORTE = ?, UPDATED_AT = CURRENT TIMESTAMP WHERE ID = ?`;

function selectBolsaByVendorMonthSql() {
    return BOLSA_SELECT_BY_VENDOR_MONTH_SQL;
}

function selectMovimientosByBolsaSql() {
    return MOVIMIENTOS_SELECT_BY_BOLSA_SQL;
}

function getIdempotencyKeysSql(count) {
    if (!Number.isInteger(count) || count < 1 || count > MAX_IDEMPOTENCY_LOOKUP_BATCH) {
        throw new Error('Invalid idempotency key batch size');
    }
    return IDEMPOTENCY_KEYS_SELECT_SQL[count];
}

// -- Get or create monthly bolsa ---------------------------------------

async function runQuery(queryFn, sql, params) {
    if (params === undefined) return queryFn(sql);
    return queryFn(sql, params);
}

function bolsaTransactionUnavailable(cause) {
    const error = new Error('No hay una conexion fisica disponible para la transaccion de bolsa.');
    error.code = 'BOLSA_TRANSACTION_UNAVAILABLE';
    error.status = 503;
    error.cause = cause;
    return error;
}

async function withBolsaTransaction(callback, { lockLedger = true } = {}) {
    let conn;
    let active = false;
    try {
        conn = await openDedicatedPedidosTransactionConnection();
        const valid = conn
            && typeof conn.query === 'function'
            && typeof conn.beginTransaction === 'function'
            && typeof conn.commit === 'function'
            && typeof conn.rollback === 'function'
            && typeof conn.close === 'function';
        if (!valid) throw bolsaTransactionUnavailable();
        await conn.beginTransaction();
        active = true;
        const queryFn = (sql, params) => runQuery(conn.query.bind(conn), sql, params);
        if (lockLedger) await lockBolsaLedger(queryFn);
        const result = await callback(queryFn);
        await conn.commit();
        active = false;
        return result;
    } catch (error) {
        if (active) {
            try {
                await conn.rollback();
            } catch (rollbackErr) {
                logger.error(`[BOLSA] Rollback failed: ${rollbackErr.message}`);
            }
        }
        if (!conn || error?.code === 'LOCAL_CONFIRMATION_TRANSACTION_UNAVAILABLE') {
            throw bolsaTransactionUnavailable(error);
        }
        throw error;
    } finally {
        if (conn && typeof conn.close === 'function') {
            try {
                await conn.close();
            } catch (closeError) {
                logger.warn(`[BOLSA] Physical connection close failed: ${closeError.code || 'UNKNOWN'}`);
            }
        }
    }
}

async function lockBolsaLedger(queryFn) {
    if (typeof queryFn !== 'function') {
        throw new TypeError('queryFn transaccional requerido para bloquear bolsa');
    }
    await runQuery(queryFn, LOCK_BOLSA_COMERCIAL_SQL);
    await runQuery(queryFn, LOCK_MOVIMIENTOS_BOLSA_SQL);
}

function isDuplicateBolsaKeyError(error) {
    const candidates = [error, error?.cause, ...(Array.isArray(error?.odbcErrors) ? error.odbcErrors : [])];
    return candidates.some((item) => {
        const state = String(item?.state || item?.sqlState || item?.sqlstate || '').trim().toUpperCase();
        const code = String(item?.code ?? item?.nativeError ?? item?.nativeCode ?? '').trim().toUpperCase();
        const message = String(item?.message || '');
        return state === '23505'
            || ['-803', '803', 'SQL0803'].includes(code)
            || /23505|duplicate|SQL0803|UQ_(?:TEST_)?BOLSA/i.test(message);
    });
}

async function getOrCreateBolsaWith(queryFn, vendedorCode, year, month) {
    const code = String(vendedorCode || '').trim();
    const y = parseInt(year);
    const m = parseInt(month);

    let rows = await runQuery(
        queryFn,
        selectBolsaByVendorMonthSql(),
        [code, y, m]
    );

    if (!rows || rows.length === 0) {
        // FIX race condition: dos GET simultaneos pueden llegar aqui antes de
        // que ninguno haya insertado. Capturamos el error de UNIQUE/duplicate
        // y volvemos a hacer SELECT (la otra request ya inserto).
        try {
            await runQuery(
                queryFn,
                BOLSA_INSERT_DEFAULT_SQL,
                [code, y, m]
            );
        } catch (insertErr) {
            if (!isDuplicateBolsaKeyError(insertErr)) {
                throw insertErr; // error real, propagar
            }
            logger.info(`[BOLSA] Race condition detectado para ${code}/${y}-${m}, releyendo`);
        }
        // Releemos siempre (sea por nuestro INSERT o por el de otra request)
        rows = await runQuery(
            queryFn,
            selectBolsaByVendorMonthSql(),
            [code, y, m]
        );
        if (!rows || rows.length === 0) {
            const error = new Error('No se pudo leer la bolsa mensual tras crearla.');
            error.code = 'BOLSA_MONTHLY_ROW_UNAVAILABLE';
            error.status = 503;
            throw error;
        }
    }

    const bolsa = rows[0];
    return {
        id: bolsa.ID,
        vendedor: (bolsa.CODIGOVENDEDOR || '').trim(),
        ejercicio: parseInt(bolsa.EJERCICIO),
        mes: parseInt(bolsa.MES),
        limitePct: parseFloat(bolsa.LIMITE_PCT) || 3.0,
        limiteImporte: parseFloat(bolsa.LIMITE_IMPORTE) || 0,
        saldoDisponible: parseFloat(bolsa.SALDO_DISPONIBLE) || 0,
        consumido: parseFloat(bolsa.CONSUMIDO) || 0,
        acumulado: parseFloat(bolsa.ACUMULADO) || 0,
    };
}

async function getOrCreateBolsa(vendedorCode, year, month) {
    return getOrCreateBolsaWith(queryWithParams, vendedorCode, year, month);
}

function defaultBolsaStatus(vendedorCode, year, month) {
    return {
        id: null,
        vendedor: String(vendedorCode || '').trim(),
        ejercicio: parseInt(year),
        mes: parseInt(month),
        limitePct: 3.0,
        limiteImporte: 0,
        saldoDisponible: 300.00,
        consumido: 0,
        acumulado: 0,
    };
}

async function getBolsaStatus(vendedorCode, year, month) {
    const code = String(vendedorCode || '').trim();
    const y = parseInt(year);
    const m = parseInt(month);

    const rows = await queryWithParams(
        selectBolsaByVendorMonthSql(),
        [code, y, m]
    );

    if (!rows || rows.length === 0) {
        return defaultBolsaStatus(code, y, m);
    }

    const bolsa = rows[0];
    return {
        id: bolsa.ID,
        vendedor: (bolsa.CODIGOVENDEDOR || '').trim(),
        ejercicio: parseInt(bolsa.EJERCICIO),
        mes: parseInt(bolsa.MES),
        limitePct: parseFloat(bolsa.LIMITE_PCT) || 3.0,
        limiteImporte: parseFloat(bolsa.LIMITE_IMPORTE) || 0,
        saldoDisponible: parseFloat(bolsa.SALDO_DISPONIBLE) || 0,
        consumido: parseFloat(bolsa.CONSUMIDO) || 0,
        acumulado: parseFloat(bolsa.ACUMULADO) || 0,
    };
}

// -- Accumulate margin into bolsa -------------------------------------

async function acumularBolsaWith(queryFn, vendedorCode, pedidoId, importeAcumulado, descripcion, now = new Date()) {
    const movements = normalizeBolsaMovements(descripcion, 'ACUMULACION', importeAcumulado, descripcion, pedidoId);
    const bolsa = await getOrCreateBolsaWith(queryFn, vendedorCode, now.getFullYear(), now.getMonth() + 1);
    const saldoAnterior = bolsa.saldoDisponible;
    const pendingMovements = await filterPendingBolsaMovements(movements, queryFn);
    const pendingImporte = sumMovementImporte(pendingMovements);
    if (pendingImporte <= 0) {
        return saldoAnterior;
    }
    const nuevoSaldo = saldoAnterior + pendingImporte;

    await runQuery(
        queryFn,
        BOLSA_UPDATE_ACCUMULATE_SQL,
        [nuevoSaldo, pendingImporte, bolsa.id]
    );

    await insertBolsaMovements('ACUMULACION', pendingMovements, bolsa.id, vendedorCode, pedidoId, saldoAnterior, nuevoSaldo, queryFn);

    logger.info(`[BOLSA] Acumulado ${importeAcumulado}EUR para ${vendedorCode}. Saldo: ${nuevoSaldo}EUR`);
    return nuevoSaldo;
}

async function acumularBolsa(vendedorCode, pedidoId, importeAcumulado, descripcion) {
    return withBolsaTransaction(
        (queryFn) => acumularBolsaWith(queryFn, vendedorCode, pedidoId, importeAcumulado, descripcion),
    );
}

// -- Consume from bolsa (when selling below minimum) ------------------

async function consumirBolsaWith(queryFn, vendedorCode, pedidoId, importeConsumo, codigoArticulo, now = new Date()) {
    const movements = normalizeBolsaMovements(codigoArticulo, 'CONSUMO', importeConsumo, codigoArticulo, pedidoId);
    const bolsa = await getOrCreateBolsaWith(queryFn, vendedorCode, now.getFullYear(), now.getMonth() + 1);
    const saldoDisponible = bolsa.saldoDisponible;
    const pendingMovements = await filterPendingBolsaMovements(movements, queryFn);
    const pendingImporte = sumMovementImporte(pendingMovements);

    if (pendingImporte <= 0) {
        return { allowed: true, saldo: saldoDisponible, duplicate: true };
    }

    if (pendingImporte > saldoDisponible) {
        return { allowed: false, deficit: pendingImporte - saldoDisponible, saldo: saldoDisponible };
    }

    const nuevoSaldo = saldoDisponible - pendingImporte;

    await runQuery(
        queryFn,
        BOLSA_UPDATE_CONSUME_SQL,
        [nuevoSaldo, pendingImporte, bolsa.id]
    );

    await insertBolsaMovements('CONSUMO', pendingMovements, bolsa.id, vendedorCode, pedidoId, saldoDisponible, nuevoSaldo, queryFn);

    logger.info(`[BOLSA] Consumido ${importeConsumo}EUR para ${vendedorCode}. Saldo: ${nuevoSaldo}EUR`);
    return { allowed: true, saldo: nuevoSaldo };
}

async function consumirBolsa(vendedorCode, pedidoId, importeConsumo, codigoArticulo) {
    return withBolsaTransaction(
        (queryFn) => consumirBolsaWith(queryFn, vendedorCode, pedidoId, importeConsumo, codigoArticulo),
    );
}

/**
 * Aplica todo el impacto de un pedido usando la conexión/transaction que el
 * llamante ya abrió. No hace COMMIT ni ROLLBACK: así pedido, stock y bolsa son
 * una sola unidad atómica.
 */
async function applyOrderMovementsWith(queryFn, {
    vendedorCode,
    pedidoId,
    consumoAmount = 0,
    acumulacionAmount = 0,
    consumoMovements,
    acumulacionMovements,
} = {}) {
    if (typeof queryFn !== 'function') {
        throw new TypeError('queryFn transaccional requerido para movimientos de bolsa');
    }

    await lockBolsaLedger(queryFn);
    const now = new Date();
    let consumoResult = null;
    let saldoAcumulado = null;
    let registration = null;

    if (Number(consumoAmount) > 0) {
        consumoResult = await consumirBolsaWith(
            queryFn,
            vendedorCode,
            pedidoId,
            Number(consumoAmount),
            Array.isArray(consumoMovements) && consumoMovements.length > 0
                ? consumoMovements
                : undefined,
            now,
        );
        if (consumoResult && consumoResult.allowed === false) {
            return { allowed: false, ...consumoResult };
        }
    }

    if (Number(acumulacionAmount) > 0) {
        saldoAcumulado = await acumularBolsaWith(
            queryFn,
            vendedorCode,
            pedidoId,
            Number(acumulacionAmount),
            Array.isArray(acumulacionMovements) && acumulacionMovements.length > 0
                ? acumulacionMovements
                : undefined,
            now,
        );
    }

    if (!(Number(consumoAmount) > 0) && !(Number(acumulacionAmount) > 0)) {
        const bolsa = await getOrCreateBolsaWith(
            queryFn,
            vendedorCode,
            now.getFullYear(),
            now.getMonth() + 1,
        );
        const movement = normalizeBolsaMovements([
            {
                importe: 0,
                descripcion: 'Pedido confirmado sin impacto economico en bolsa',
                idempotencyKey: `pedido-${pedidoId}-bag-registration`,
            },
        ], 'REGISTRO', 0, '', pedidoId);
        const pending = await filterPendingBolsaMovements(movement, queryFn);
        if (pending.length > 0) {
            await insertBolsaMovements(
                'REGISTRO',
                pending,
                bolsa.id,
                vendedorCode,
                pedidoId,
                bolsa.saldoDisponible,
                bolsa.saldoDisponible,
                queryFn,
            );
            registration = { created: true, idempotencyKey: pending[0].idempotencyKey };
        } else {
            registration = { created: false, idempotencyKey: movement[0].idempotencyKey };
        }
    }

    return {
        allowed: true,
        consumo: consumoResult,
        saldoAcumulado,
        registration,
    };
}

function applyOrderMovements(options) {
    return withBolsaTransaction(
        (queryFn) => applyOrderMovementsWith(queryFn, options),
        { lockLedger: false },
    );
}

async function reverseOrderMovementsWith(queryFn, {
    pedidoId,
    vendedorCode,
} = {}) {
    if (typeof queryFn !== 'function') {
        throw new TypeError('queryFn transaccional requerido para reversar bolsa');
    }
    await lockBolsaLedger(queryFn);
    const rows = await runQuery(
        queryFn,
        `SELECT M.ID, M.BOLSA_ID, M.LINEA_ID, M.TIPO, M.IMPORTE,
                M.CODIGO_ARTICULO, M.DESCRIPCION, M.PRECIO_MINIMO_CONGELADO,
                M.PRECIO_VENTA, M.CANTIDAD, M.UNIDAD_MEDIDA, M.IDEMPOTENCY_KEY,
                B.SALDO_DISPONIBLE, B.CONSUMIDO, B.ACUMULADO,
                B.EJERCICIO, B.MES
           FROM ${MOVIMIENTOS_TABLE} M
           JOIN ${BOLSA_TABLE} B ON B.ID = M.BOLSA_ID
          WHERE M.PEDIDO_ID = ?
            AND M.TIPO IN ('CONSUMO', 'ACUMULACION', 'REGISTRO')
          ORDER BY M.ID ASC`,
        [pedidoId],
    );
    const candidates = (rows || []).map((row) => ({
        row,
        idempotencyKey: `pedido-${pedidoId}-movement-${Number(row.ID)}-reverse`,
    }));
    const pendingCandidates = await filterPendingBolsaMovements(candidates, queryFn);
    const aggregateByBolsa = new Map();
    const reversed = [];
    for (const candidate of pendingCandidates) {
        const { row } = candidate;
        const originalId = Number(row.ID);
        const originalType = String(row.TIPO || '').trim().toUpperCase();
        const amount = toMoney(row.IMPORTE);
        const reverseType = originalType === 'CONSUMO'
            ? 'REVERSO_CONSUMO'
            : (originalType === 'ACUMULACION' ? 'REVERSO_ACUMULACION' : 'REVERSO_REGISTRO');
        const key = candidate.idempotencyKey;
        const bolsaId = Number(row.BOLSA_ID);
        if (!Number.isSafeInteger(bolsaId) || bolsaId <= 0) {
            throw new Error(`Bolsa original ${row.BOLSA_ID} no disponible para reverso`);
        }
        if (originalType === 'REGISTRO' && amount !== 0) {
            throw new Error(`Registro neutral inconsistente en movimiento ${originalId}`);
        }
        if (!aggregateByBolsa.has(bolsaId)) {
            aggregateByBolsa.set(bolsaId, {
                SALDO_DISPONIBLE: row.SALDO_DISPONIBLE,
                CONSUMIDO: row.CONSUMIDO,
                ACUMULADO: row.ACUMULADO,
            });
        }
        const bolsa = aggregateByBolsa.get(bolsaId);
        const saldoAnterior = toMoney(bolsa.SALDO_DISPONIBLE);
        const saldoPosterior = originalType === 'CONSUMO'
            ? toMoney(saldoAnterior + amount)
            : toMoney(saldoAnterior - amount);
        if (originalType === 'CONSUMO') {
            const consumed = toMoney(bolsa.CONSUMIDO);
            if (consumed + 0.001 < amount) {
                throw new Error(`Consumo agregado inconsistente en bolsa ${row.BOLSA_ID}`);
            }
            await runQuery(
                queryFn,
                `UPDATE ${BOLSA_TABLE}
                    SET SALDO_DISPONIBLE = ?, CONSUMIDO = CONSUMIDO - ?, UPDATED_AT = CURRENT TIMESTAMP
                  WHERE ID = ?`,
                [saldoPosterior, amount, bolsaId],
            );
            bolsa.CONSUMIDO = toMoney(consumed - amount);
        } else if (originalType === 'ACUMULACION') {
            const accumulated = toMoney(bolsa.ACUMULADO);
            if (accumulated + 0.001 < amount) {
                throw new Error(`Acumulado inconsistente en bolsa ${row.BOLSA_ID}`);
            }
            await runQuery(
                queryFn,
                `UPDATE ${BOLSA_TABLE}
                    SET SALDO_DISPONIBLE = ?, ACUMULADO = ACUMULADO - ?, UPDATED_AT = CURRENT TIMESTAMP
                  WHERE ID = ?`,
                [saldoPosterior, amount, bolsaId],
            );
            bolsa.ACUMULADO = toMoney(accumulated - amount);
        }
        bolsa.SALDO_DISPONIBLE = saldoPosterior;
        await runQuery(
            queryFn,
            MOVIMIENTOS_INSERT_PREFIX + MOVIMIENTOS_INSERT_ROW,
            [
                bolsaId,
                toDb2Timestamp(new Date()),
                String(vendedorCode || '').trim(),
                pedidoId,
                row.LINEA_ID,
                reverseType,
                amount,
                saldoAnterior,
                saldoPosterior,
                String(row.CODIGO_ARTICULO || '').trim(),
                `Reverso de movimiento ${originalId}: ${String(row.DESCRIPCION || '').trim()}`.slice(0, 255),
                row.PRECIO_MINIMO_CONGELADO,
                row.PRECIO_VENTA,
                row.CANTIDAD,
                String(row.UNIDAD_MEDIDA || '').trim(),
                key,
            ],
        );
        reversed.push({
            originalMovementId: originalId,
            originalBolsaId: bolsaId,
            ejercicio: Number(row.EJERCICIO),
            mes: Number(row.MES),
            type: reverseType,
            amount,
            saldoAnterior,
            saldoPosterior,
            idempotencyKey: key,
        });
    }
    return { reversed, count: reversed.length };
}

// -- Validate order lines against bolsa -------------------------------

function toDb2Timestamp(value) {
    const date = value instanceof Date ? value : new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return toDb2Timestamp(new Date());
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function toMoney(value) {
    const n = Number.parseFloat(value) || 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

function getLineQuantity(line) {
    const unidadMedida = String(line.unidadMedida ?? line.UNIDADMEDIDA ?? 'CAJAS').trim().toUpperCase();
    const cantidadEnvases = Number.parseFloat(line.cantidadEnvases ?? line.CANTIDADENVASES) || 0;
    const cantidadUnidades = Number.parseFloat(line.cantidadUnidades ?? line.CANTIDADUNIDADES) || 0;
    const unidadesCaja = Number.parseFloat(line.unidadesCaja ?? line.UNIDADESCAJA) || 1;

    if (unidadMedida === 'KILOGRAMOS' || unidadMedida === 'LITROS') {
        return cantidadUnidades;
    }
    if (unidadMedida === 'CAJAS' || unidadMedida === '') {
        if (cantidadEnvases > 0 && cantidadUnidades > 0) {
            const expectedEquivalentUnits = cantidadEnvases * unidadesCaja;
            const unitsAreBoxEquivalence = Math.abs(cantidadUnidades - expectedEquivalentUnits) < 0.0001
                || cantidadUnidades >= expectedEquivalentUnits;
            return unitsAreBoxEquivalence
                ? cantidadEnvases
                : cantidadEnvases + (cantidadUnidades / unidadesCaja);
        }
        return cantidadEnvases;
    }
    return cantidadUnidades;
}

/** Precio unitario efectivo tras dto de línea (y opcional global). */
function resolveEffectiveSalePrice(line, globalDiscountPct = 0) {
    const precioVenta = Number.parseFloat(line.precioVenta ?? line.PRECIOVENTA) || 0;
    const lineDiscount = Number.parseFloat(
        line.descuentoLinea
        ?? line.DESCUENTO_LINEA
        ?? line.lineDiscountPct
        ?? line.PORCENTAJEDESCUENTO
        ?? line.porcentajeDescuento
    ) || 0;
    let effective = precioVenta;
    if (lineDiscount > 0 && lineDiscount <= 100) {
        effective = precioVenta * (1 - (lineDiscount / 100));
    }
    const globalPct = Number.parseFloat(globalDiscountPct) || 0;
    if (globalPct > 0 && globalPct <= 100) {
        effective *= (1 - (globalPct / 100));
    }
    return toMoney(effective);
}

function buildBolsaMovementIdempotencyKey(pedidoId, lineId, tipo) {
    const pedido = String(pedidoId ?? '').trim();
    if (!pedido) return null;
    const line = String(lineId ?? 'na').trim() || 'na';
    const suffix = tipo === 'CONSUMO' ? 'under-min' : (tipo === 'ACUMULACION' ? 'over-min' : String(tipo || '').toLowerCase());
    return 'pedido-' + pedido + '-line-' + line + '-' + suffix;
}

function normalizeBolsaMovements(input, tipo, totalImporte, legacyValue, pedidoId) {
    let source;
    if (Array.isArray(input)) source = input;
    else if (input && typeof input === 'object') source = [input];
    else source = [{}];
    if (source.length === 0) source = [{}];
    const movements = source.map(function (movement) {
        const amount = movement.importe === undefined || movement.importe === null ? (source.length === 1 ? totalImporte : 0) : movement.importe;
        return {
            importe: toMoney(amount),
            timestamp: toDb2Timestamp(movement.timestamp || new Date()),
            lineId: movement.lineId ?? null,
            codigoArticulo: String(movement.codigoArticulo || (typeof legacyValue === 'string' && tipo === 'CONSUMO' ? legacyValue : '')).trim(),
            descripcion: String(movement.descripcion || (typeof legacyValue === 'string' && tipo === 'ACUMULACION' ? legacyValue : '')).trim(),
            precioMinimoCongelado: movement.precioMinimoCongelado ?? null,
            precioVenta: movement.precioVenta ?? null,
            cantidad: movement.cantidad ?? null,
            unidadMedida: String(movement.unidadMedida || '').trim(),
            idempotencyKey: movement.idempotencyKey
                || buildBolsaMovementIdempotencyKey(pedidoId, movement.lineId ?? null, tipo)
                || null,
        };
    });
    const movementTotal = toMoney(movements.reduce(function (sum, movement) { return sum + movement.importe; }, 0));
    if (Math.abs(movementTotal - toMoney(totalImporte)) > 0.01) throw new Error('Importe de movimientos ' + tipo + ' no cuadra con total de bolsa');
    return movements;
}

async function filterPendingBolsaMovements(movements, queryFn = queryWithParams) {
    const keys = [...new Set((movements || []).map(m => m && m.idempotencyKey).filter(Boolean))];
    if (keys.length === 0) return movements || [];
    const rows = [];
    for (let index = 0; index < keys.length; index += MAX_IDEMPOTENCY_LOOKUP_BATCH) {
        const batch = keys.slice(index, index + MAX_IDEMPOTENCY_LOOKUP_BATCH);
        const batchRows = await runQuery(
            queryFn,
            getIdempotencyKeysSql(batch.length),
            batch
        );
        rows.push(...(batchRows || []));
    }
    const applied = new Set((rows || []).map(r => String(r.IDEMPOTENCY_KEY || '').trim()).filter(Boolean));
    return (movements || []).filter(m => !m.idempotencyKey || !applied.has(m.idempotencyKey));
}

function sumMovementImporte(movements) {
    return toMoney((movements || []).reduce(function (sum, movement) { return sum + (Number.parseFloat(movement.importe) || 0); }, 0));
}

function insertBolsaMovements(tipo, movements, bolsaId, vendedorCode, pedidoId, saldoInicial, saldoFinal, queryFn = queryWithParams) {
    const sql = MOVIMIENTOS_INSERT_PREFIX + movements.map(function () { return MOVIMIENTOS_INSERT_ROW; }).join(', ');
    let runningSaldo = toMoney(saldoInicial);
    const params = [];
    for (const movement of movements) {
        const saldoAnterior = runningSaldo;
        runningSaldo = tipo === 'CONSUMO' ? toMoney(runningSaldo - movement.importe) : toMoney(runningSaldo + movement.importe);
        params.push(bolsaId, toDb2Timestamp(movement.timestamp), String(vendedorCode || '').trim(), pedidoId, movement.lineId, tipo, movement.importe, saldoAnterior, runningSaldo, movement.codigoArticulo, movement.descripcion, movement.precioMinimoCongelado, movement.precioVenta, movement.cantidad, movement.unidadMedida, movement.idempotencyKey);
    }
    if (Math.abs(runningSaldo - toMoney(saldoFinal)) > 0.01) throw new Error('Saldo posterior de movimientos ' + tipo + ' no cuadra con bolsa');
    return runQuery(queryFn, sql, params);
}

function resolveBolsaReferencePrice(line) {
    const clientTariff = Number.parseFloat(line.precioTarifaCliente ?? line.PRECIOTARIFACLIENTE) || 0;
    const catalogTariff = Number.parseFloat(line.precioTarifa ?? line.PRECIOTARIFA) || 0;
    const legacyMin = Number.parseFloat(line.precioMinimo ?? line.PRECIOMINIMO) || 0;
    if (clientTariff > 0) return clientTariff;
    if (catalogTariff > 0) return catalogTariff;
    return legacyMin;
}

function resolveConfiguredMinFloor(line) {
    return Number.parseFloat(line.precioMinimo ?? line.PRECIOMINIMO) || 0;
}

function isTruthyFlag(value) {
    if (value === true || value === 1) return true;
    const normalized = String(value ?? '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'si', 's'].includes(normalized);
}

function isAuthorizedMinFloorException(line) {
    const source = String(line.precioClienteSource ?? line.PRECIOCLIENTESOURCE ?? '').trim().toUpperCase();
    const promotionCode = String(line.promotionCode ?? line.PROMOTIONCODE ?? line.promoCode ?? line.PROMOCODIGO ?? '').trim();
    const tipoLinea = String(line.tipoLinea ?? line.TIPOLINEA ?? '').trim().toUpperCase();
    const claseLinea = String(line.claseLinea ?? line.CLASELINEA ?? '').trim().toUpperCase();

    if (isTruthyFlag(line.permiteBajoMinimo ?? line.PERMITEBAJOMINIMO)) return true;
    if (isTruthyFlag(line.precioEspecialCliente ?? line.PRECIOESPECIALCLIENTE)) return true;
    if (source.includes(comercialErpTable('PES')) || source.includes('DSEDAC.PES') || source.includes('DSEDAC.PPU')) return true;
    if (source.includes('DSEDAC.PMR') || source.includes('DSEDAC.PRD')) return true;
    if (source.includes('PROMO')) return true;
    if (promotionCode) return true;
    return tipoLinea === 'G' || claseLinea === 'SC';
}

function buildBolsaLineMovement(line, tipo, importe, referenceTariff) {
    const ref = referenceTariff ?? resolveBolsaReferencePrice(line);
    return {
        tipo,
        importe: toMoney(importe),
        codigoArticulo: String(line.codigoArticulo ?? line.CODIGOARTICULO ?? '').trim(),
        lineId: line.lineId ?? line.ID ?? null,
        precioMinimoCongelado: ref,
        precioVenta: Number.parseFloat(line.precioVenta ?? line.PRECIOVENTA) || 0,
        cantidad: getLineQuantity(line),
        unidadMedida: String(line.unidadMedida ?? line.UNIDADMEDIDA ?? '').trim(),
        idempotencyKey: line.idempotencyKey,
        timestamp: line.timestamp,
    };
}

async function validateOrderWithBolsa(vendedorCode, lines, options = {}) {
    const now = new Date();
    const queryFn = typeof options.queryFn === 'function' ? options.queryFn : queryWithParams;
    const bolsa = await getOrCreateBolsaWith(
        queryFn,
        vendedorCode,
        now.getFullYear(),
        now.getMonth() + 1,
    );
    const saldoDisponible = toMoney(bolsa.saldoDisponible);
    const globalDiscountPct = Number.parseFloat(
        options.globalDiscountPct ?? options.descuentoGlobal ?? 0
    ) || 0;

    let totalConsumo = 0;
    let totalAcumulacion = 0;
    const warnings = [];
    const lineMovements = [];

    for (const line of lines || []) {
        const referenceTariff = resolveBolsaReferencePrice(line);
        const configuredMin = resolveConfiguredMinFloor(line);
        const listPrice = Number.parseFloat(line.precioVenta ?? line.PRECIOVENTA) || 0;
        const precioVenta = resolveEffectiveSalePrice(line, globalDiscountPct);
        const qty = getLineQuantity(line);
        if (referenceTariff <= 0 || qty <= 0) continue;

        const belowClientTariff = referenceTariff > 0 && precioVenta + 0.0001 < referenceTariff;
        if (configuredMin > 0 && listPrice + 0.0001 < configuredMin && !belowClientTariff && !isAuthorizedMinFloorException(line)) {
            return {
                valid: false,
                reason: 'PRECIO_DEBAJO_MINIMO',
                code: line.CODIGOARTICULO || line.codigoArticulo,
                precioVenta: listPrice,
                precioMinimo: configuredMin,
                precioTarifa: referenceTariff,
                message: `Precio ${listPrice} por debajo del minimo configurado ${configuredMin}`,
                consumo: totalConsumo,
                acumulacion: totalAcumulacion,
                saldo: saldoDisponible,
                warnings,
                lineMovements,
            };
        }

        if (precioVenta + 0.0001 < referenceTariff) {
            const diff = toMoney((referenceTariff - precioVenta) * qty);
            totalConsumo = toMoney(totalConsumo + diff);
            const movement = buildBolsaLineMovement(
                { ...line, precioVenta, PRECIOVENTA: precioVenta },
                'CONSUMO',
                diff,
                referenceTariff,
            );
            lineMovements.push(movement);
            warnings.push({ code: movement.codigoArticulo, deficit: diff });
        } else if (precioVenta > referenceTariff + 0.0001) {
            const diff = toMoney((precioVenta - referenceTariff) * qty);
            totalAcumulacion = toMoney(totalAcumulacion + diff);
            lineMovements.push(buildBolsaLineMovement(
                { ...line, precioVenta, PRECIOVENTA: precioVenta },
                'ACUMULACION',
                diff,
                referenceTariff,
            ));
        }
    }

    if (totalConsumo > 0 && totalConsumo > saldoDisponible) {
        return {
            valid: false,
            reason: 'BOLSA_INSUFICIENTE',
            deficit: toMoney(totalConsumo - saldoDisponible),
            saldo: saldoDisponible,
            consumo: totalConsumo,
            acumulacion: totalAcumulacion,
            warnings,
            lineMovements,
        };
    }

    return {
        valid: true,
        consumo: totalConsumo,
        acumulacion: totalAcumulacion,
        saldo: toMoney(saldoDisponible - totalConsumo),
        warnings,
        lineMovements,
    };
}

// -- Get movements log ------------------------------------------------

function nullableNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function nullableTrim(value) {
    if (value === undefined || value === null) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
}

function nullableInt(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function toIsoTimestamp(value) {
    if (value === undefined || value === null || value === '') return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(value);
}

function normalizeLikeText(value, maxLength = 80) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim().toUpperCase().replace(/[%_]/g, ' ');
    return text ? text.slice(0, maxLength) : null;
}

function normalizeTipoFilter(value) {
    const text = normalizeLikeText(value, 20);
    if (!text) return null;
    return ['ACUMULACION', 'CONSUMO', 'AJUSTE'].includes(text) ? text : null;
}

function toDb2TimestampOrNull(value, endOfDay = false) {
    if (value === undefined || value === null || value === '') return null;
    const raw = String(value).trim();
    const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
        return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]} ${endOfDay ? '23:59:59.999' : '00:00:00.000'}`;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    if (endOfDay) parsed.setHours(23, 59, 59, 999);
    return toDb2Timestamp(parsed);
}

function parseDocumentReference(value) {
    const text = normalizeLikeText(value, 40);
    if (!text) return null;
    const match = text.match(/^([A-Z])[-\s]*(\d{1,3})[-\s]*(\d{1,6})$/);
    if (!match) return null;
    return {
        serie: match[1],
        terminal: parseInt(match[2], 10),
        numero: parseInt(match[3], 10),
    };
}

function documentNumberCandidates(value) {
    const text = normalizeLikeText(value, 40);
    if (!text) return [];
    const out = [];
    const groups = text.match(/\d+/g) || [];
    for (const group of groups) {
        const parsed = parseInt(group, 10);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 999999 && !out.includes(parsed)) {
            out.push(parsed);
        }
    }
    return out.slice(0, 4);
}

function appendInvoiceDocumentExists(whereParts, params, docLike, numbers) {
    const invoiceParts = [
        'CAST(F.NUMEROFACTURA AS CHAR(20)) LIKE ?',
        'UPPER(TRIM(F.SERIEFACTURA)) LIKE ?',
    ];
    params.push(docLike, docLike);
    for (const n of numbers) {
        invoiceParts.push('F.NUMEROFACTURA = ?');
        params.push(n);
    }
    whereParts.push([
        'EXISTS (SELECT 1',
        `FROM ${comercialErpTable('CPC')} P`,
        `INNER JOIN ${comercialErpTable('CAC')} F`,
        'ON F.EJERCICIOALBARAN = P.EJERCICIOALBARAN',
        'AND TRIM(F.SERIEALBARAN) = TRIM(P.SERIEALBARAN)',
        'AND F.TERMINALALBARAN = P.TERMINALALBARAN',
        'AND F.NUMEROALBARAN = P.NUMEROALBARAN',
        'WHERE C.SYSTEM_NUMEROPEDIDO > 0',
        'AND TRIM(P.SUBEMPRESAPEDIDO) = TRIM(C.SYSTEM_SUBEMPRESAPEDIDO)',
        'AND P.EJERCICIOPEDIDO = C.SYSTEM_EJERCICIOPEDIDO',
        'AND TRIM(P.SERIEPEDIDO) = TRIM(C.SYSTEM_SERIEPEDIDO)',
        'AND P.TERMINALPEDIDO = C.SYSTEM_TERMINALPEDIDO',
        'AND P.NUMEROPEDIDO = C.SYSTEM_NUMEROPEDIDO',
        `AND (${invoiceParts.join(' OR ')}))`,
    ].join(' '));
}

function normalizeMovementFilters(filters = {}) {
    return {
        tipo: normalizeTipoFilter(filters.tipo),
        dateFrom: toDb2TimestampOrNull(filters.dateFrom || filters.fechaDesde, false),
        dateTo: toDb2TimestampOrNull(filters.dateTo || filters.fechaHasta, true),
        documentText: normalizeLikeText(filters.document || filters.documento || filters.pedido || filters.numeroPedido || filters.numeroFactura, 40),
        clientText: normalizeLikeText(filters.client || filters.cliente || filters.codigoCliente, 80),
    };
}

function appendMovementFilters(where, params, filters) {
    if (filters.tipo) {
        where.push('TRIM(M.TIPO) = ?');
        params.push(filters.tipo);
    }
    if (filters.dateFrom) {
        where.push('M.CREATED_AT >= ?');
        params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
        where.push('M.CREATED_AT <= ?');
        params.push(filters.dateTo);
    }
    if (filters.clientText) {
        const like = `%${filters.clientText}%`;
        where.push('(UPPER(TRIM(C.CODIGOCLIENTE)) LIKE ? OR UPPER(TRIM(C.NOMBRECLIENTE)) LIKE ?)');
        params.push(like, like);
    }
    if (filters.documentText) {
        const like = `%${filters.documentText}%`;
        const numbers = documentNumberCandidates(filters.documentText);
        const ref = parseDocumentReference(filters.documentText);
        const parts = [
            'CAST(M.PEDIDO_ID AS CHAR(20)) LIKE ?',
            'CAST(C.NUMEROPEDIDO AS CHAR(20)) LIKE ?',
            'CAST(C.SYSTEM_NUMEROPEDIDO AS CHAR(20)) LIKE ?',
            'UPPER(TRIM(C.SERIEPEDIDO)) LIKE ?',
            'UPPER(TRIM(C.SYSTEM_SERIEPEDIDO)) LIKE ?',
        ];
        params.push(like, like, like, like, like);
        for (const n of numbers) {
            parts.push('M.PEDIDO_ID = ?');
            parts.push('C.NUMEROPEDIDO = ?');
            parts.push('C.SYSTEM_NUMEROPEDIDO = ?');
            params.push(n, n, n);
        }
        if (ref) {
            parts.push('(UPPER(TRIM(C.SERIEPEDIDO)) = ? AND C.TERMINAL = ? AND C.NUMEROPEDIDO = ?)');
            parts.push('(UPPER(TRIM(C.SYSTEM_SERIEPEDIDO)) = ? AND C.SYSTEM_TERMINALPEDIDO = ? AND C.SYSTEM_NUMEROPEDIDO = ?)');
            params.push(ref.serie, ref.terminal, ref.numero, ref.serie, ref.terminal, ref.numero);
        }
        appendInvoiceDocumentExists(parts, params, like, numbers);
        where.push(`(${parts.join(' OR ')})`);
    }
}

function buildMovimientosQuery(vendedorCode, year, month, limit, filters) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const where = ['TRIM(B.CODIGOVENDEDOR) = ?'];
    const params = [String(vendedorCode || '').trim()];
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const hasDateWindow = Boolean(filters.dateFrom || filters.dateTo);
    if (!hasDateWindow && Number.isFinite(y) && Number.isFinite(m)) {
        where.push('B.EJERCICIO = ?');
        where.push('B.MES = ?');
        params.push(y, m);
    }
    appendMovementFilters(where, params, filters);
    params.push(safeLimit);
    return {
        sql: [
            MOVIMIENTOS_SELECT_BASE_SQL,
            `WHERE ${where.join(' AND ')}`,
            'ORDER BY M.CREATED_AT DESC, M.ID DESC',
            'FETCH FIRST ? ROWS ONLY',
        ].join(' '),
        params,
    };
}

function formatPedidoReference(serie, terminal, numero) {
    const n = nullableInt(numero);
    if (!n || n <= 0) return null;
    const serieText = String(serie || 'P').trim() || 'P';
    const t = nullableInt(terminal) || 0;
    return `${serieText}-${String(t).padStart(3, '0')}-${String(n).padStart(6, '0')}`;
}

function mapMovimientoRow(r) {
    const localPedidoReferencia = formatPedidoReference(r.SERIEPEDIDO, r.TERMINAL, r.NUMEROPEDIDO);
    const systemPedidoReferencia = formatPedidoReference(r.SYSTEM_SERIEPEDIDO || r.SERIEPEDIDO, r.SYSTEM_TERMINALPEDIDO, r.SYSTEM_NUMEROPEDIDO);
    const importe = parseFloat(r.IMPORTE) || 0;
    const saldoAnterior = parseFloat(r.SALDO_ANTERIOR) || 0;
    const saldoPosterior = parseFloat(r.SALDO_POSTERIOR) || 0;
    // REQ-15: descuadre visible, nunca silencioso. Tolerancia ±0,01.
    if (Math.abs((saldoPosterior - saldoAnterior) - (String(r.TIPO || '').trim() === 'CONSUMO' ? -importe : importe)) > 0.01) {
        try {
            logger.warn(
                `[BOLSA_SALDO_MISMATCH] id=${r.ID} idempotencyKey=${(r.IDEMPOTENCY_KEY || '').trim() || 'n/a'} ` +
                `anterior=${saldoAnterior} posterior=${saldoPosterior} importe=${importe} tipo=${(r.TIPO || '').trim()}`,
            );
        } catch (_) { /* never break read path */ }
    }
    return {
        id: r.ID,
        tipo: (r.TIPO || '').trim(),
        importe,
        saldoAnterior,
        saldoPosterior,
        codigoArticulo: (r.CODIGO_ARTICULO || '').trim(),
        descripcion: (r.DESCRIPCION || '').trim(),
        pedidoId: nullableInt(r.PEDIDO_ID),
        fecha: toIsoTimestamp(r.CREATED_AT),
        lineId: nullableInt(r.LINEA_ID),
        precioMinimoCongelado: nullableNumber(r.PRECIO_MINIMO_CONGELADO),
        precioVenta: nullableNumber(r.PRECIO_VENTA),
        cantidad: nullableNumber(r.CANTIDAD),
        unidadMedida: nullableTrim(r.UNIDAD_MEDIDA),
        idempotencyKey: nullableTrim(r.IDEMPOTENCY_KEY),
        vendedor: nullableTrim(r.CODIGOVENDEDOR),
        bolsaEjercicio: nullableInt(r.BOLSA_EJERCICIO),
        bolsaMes: nullableInt(r.BOLSA_MES),
        clienteCodigo: nullableTrim(r.CODIGOCLIENTE),
        clienteNombre: nullableTrim(r.NOMBRECLIENTE),
        pedidoEjercicio: nullableInt(r.PEDIDO_EJERCICIO),
        pedidoNumero: nullableInt(r.NUMEROPEDIDO),
        pedidoReferencia: systemPedidoReferencia || localPedidoReferencia,
        localPedidoReferencia,
        systemPedidoReferencia,
        targetSchema: nullableTrim(r.TARGET_SCHEMA),
        syncStatus: nullableTrim(r.SYNC_STATUS),
    };
}

async function getMovimientos(vendedorCode, year, month, limit = 50, filters = {}) {
    const normalizedFilters = normalizeMovementFilters(filters);
    const query = buildMovimientosQuery(vendedorCode, year, month, limit, normalizedFilters);
    const rows = await queryWithParams(query.sql, query.params);

    return (rows || []).map(mapMovimientoRow);
}

// -- Get historical monthly summary (last N months) -------------------

async function getHistorialMensual(vendedorCode, months = 12, anchorYear, anchorMonth) {
    const code = String(vendedorCode || '').trim();
    const n = Math.min(Math.max(parseInt(months) || 12, 1), 36);

    const now = new Date();
    const parsedYear = parseInt(anchorYear, 10);
    const parsedMonth = parseInt(anchorMonth, 10);
    const endYear = Number.isFinite(parsedYear) ? parsedYear : now.getFullYear();
    const endMonth = Number.isFinite(parsedMonth) ? parsedMonth : now.getMonth() + 1;
    const boundedMonth = Math.min(Math.max(endMonth, 1), 12);

    // Calcular rango: mes ancla hacia atras N meses (incluido el mes ancla)
    const cutoff = new Date(endYear, boundedMonth - n, 1);
    const cutoffYear = cutoff.getFullYear();
    const cutoffMonth = cutoff.getMonth() + 1;

    // Filas existentes en BOLSA_COMERCIAL para ese rango
    const rows = await queryWithParams(
        BOLSA_HISTORIAL_MENSUAL_SQL,
        [code, cutoffYear, cutoffYear, cutoffMonth, endYear, endYear, boundedMonth]
    );

    // Map por "YYYY-MM" para combinar luego
    const byKey = new Map();
    for (const r of rows || []) {
        const y = parseInt(r.EJERCICIO);
        const m = parseInt(r.MES);
        byKey.set(`${y}-${String(m).padStart(2,'0')}`, {
            ejercicio: y,
            mes: m,
            saldoDisponible: parseFloat(r.SALDO_DISPONIBLE) || 0,
            consumido: parseFloat(r.CONSUMIDO) || 0,
            acumulado: parseFloat(r.ACUMULADO) || 0,
            limitePct: parseFloat(r.LIMITE_PCT) || 0,
            limiteImporte: parseFloat(r.LIMITE_IMPORTE) || 0,
        });
    }

    // Generar los N puntos en orden cronologico, con ceros para meses sin datos
    const points = [];
    for (let i = 0; i < n; i++) {
        const d = new Date(cutoff.getFullYear(), cutoff.getMonth() + i, 1);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const key = `${y}-${String(m).padStart(2,'0')}`;
        if (byKey.has(key)) {
            points.push(byKey.get(key));
        } else {
            points.push({
                ejercicio: y, mes: m,
                saldoDisponible: 0, consumido: 0, acumulado: 0,
                limitePct: 0, limiteImporte: 0,
            });
        }
    }

    // Agregados totales
    let totalAcumulado = 0, totalConsumido = 0;
    for (const p of points) {
        totalAcumulado += p.acumulado;
        totalConsumido += p.consumido;
    }

    return {
        vendedor: code,
        months: n,
        points,
        totals: {
            acumulado: totalAcumulado,
            consumido: totalConsumido,
            saldoNeto: totalAcumulado - totalConsumido,
        },
    };
}

function mapBolsaStatusRow(row) {
    return {
        id: row.ID,
        vendedor: (row.CODIGOVENDEDOR || '').trim(),
        ejercicio: parseInt(row.EJERCICIO),
        mes: parseInt(row.MES),
        limitePct: parseFloat(row.LIMITE_PCT) || 3.0,
        limiteImporte: parseFloat(row.LIMITE_IMPORTE) || 0,
        saldoDisponible: parseFloat(row.SALDO_DISPONIBLE) || 0,
        consumido: parseFloat(row.CONSUMIDO) || 0,
        acumulado: parseFloat(row.ACUMULADO) || 0,
    };
}

function normalizeVendorCodeList(vendedorCodes) {
    if (!Array.isArray(vendedorCodes)) return [];
    return [...new Set(vendedorCodes
        .map(code => String(code || '').trim())
        .filter(code => code && code.toUpperCase() !== 'ALL'))].slice(0, 100);
}

async function getGroupedStatus(vendedorCodes, year, month) {
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const codes = normalizeVendorCodeList(vendedorCodes);
    const params = [y, m];
    let sql = BOLSA_GROUPED_STATUS_BASE_SQL;
    if (codes.length > 0) {
        sql += ` AND TRIM(CODIGOVENDEDOR) IN (${codes.map(() => '?').join(', ')})`;
        params.push(...codes);
    }
    sql += ' ORDER BY TRIM(CODIGOVENDEDOR) ASC';

    const rows = await queryWithParams(sql, params);
    const existing = (rows || []).map(mapBolsaStatusRow);
    const byCode = new Map(existing.map((row) => [row.vendedor, row]));
    const vendedores = codes.length > 0
        ? codes.map((code) => byCode.get(code) || defaultBolsaStatus(code, y, m))
        : existing;
    const totals = vendedores.reduce((acc, item) => {
        acc.saldoDisponible += item.saldoDisponible;
        acc.consumido += item.consumido;
        acc.acumulado += item.acumulado;
        return acc;
    }, { saldoDisponible: 0, consumido: 0, acumulado: 0 });
    totals.saldoDisponible = toMoney(totals.saldoDisponible);
    totals.consumido = toMoney(totals.consumido);
    totals.acumulado = toMoney(totals.acumulado);
    totals.vendedores = vendedores.length;

    return {
        ejercicio: y,
        mes: m,
        vendedores,
        totals,
    };
}

// -- Update configuration (JEFE_VENTAS only) --------------------------

async function updateBolsaConfig(vendedorCode, year, month, { limitePct, limiteImporte }) {
    const bolsa = await getOrCreateBolsa(vendedorCode, year, month);
    const hasLimitePct = limitePct !== undefined;
    const hasLimiteImporte = limiteImporte !== undefined;

    if (!hasLimitePct && !hasLimiteImporte) return bolsa;

    if (hasLimitePct && hasLimiteImporte) {
        await queryWithParams(
            BOLSA_UPDATE_CONFIG_BOTH_SQL,
            [parseFloat(limitePct), parseFloat(limiteImporte), bolsa.id]
        );
    } else if (hasLimitePct) {
        await queryWithParams(
            BOLSA_UPDATE_CONFIG_PCT_SQL,
            [parseFloat(limitePct), bolsa.id]
        );
    } else {
        await queryWithParams(
            BOLSA_UPDATE_CONFIG_AMOUNT_SQL,
            [parseFloat(limiteImporte), bolsa.id]
        );
    }

    return getOrCreateBolsa(vendedorCode, year, month);
}

module.exports = {
    getOrCreateBolsa,
    getBolsaStatus,
    acumularBolsa,
    consumirBolsa,
    applyOrderMovements,
    applyOrderMovementsWith,
    reverseOrderMovementsWith,
    validateOrderWithBolsa,
    resolveBolsaReferencePrice,
    resolveConfiguredMinFloor,
    resolveEffectiveSalePrice,
    getLineQuantity,
    isAuthorizedMinFloorException,
    toDb2Timestamp,
    getMovimientos,
    getHistorialMensual,
    getGroupedStatus,
    updateBolsaConfig,
};
