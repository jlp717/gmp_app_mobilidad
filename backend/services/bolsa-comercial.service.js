'use strict';

/**
 * BOLSA COMERCIAL SERVICE
 * =======================
 * Manages the "commercial bag" - a per-vendor monthly budget that
 * tracks accumulated margin and allows flexible pricing within limits.
 *
 * Write schema: DB2_WRITE_SCHEMA (default JAVIER). ERP reads: DSEDAC.ARA.
 */

const { queryWithParams, getPool, initDb } = require('../config/db');
const logger = require('../middleware/logger');

const MAX_IDEMPOTENCY_LOOKUP_BATCH = 10;

const BOLSA_SELECT_BY_VENDOR_MONTH_SQL = [
    'SELECT ID, CODIGOVENDEDOR, EJERCICIO, MES, LIMITE_PCT, LIMITE_IMPORTE,',
    'SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO',
    'FROM JAVIER.BOLSA_COMERCIAL',
    'WHERE TRIM(CODIGOVENDEDOR) = ? AND EJERCICIO = ? AND MES = ?',
    'FETCH FIRST 1 ROW ONLY',
].join(' ');

const BOLSA_INSERT_DEFAULT_SQL = [
    'INSERT INTO JAVIER.BOLSA_COMERCIAL',
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
    'FROM JAVIER.MOVIMIENTOS_BOLSA M',
    'INNER JOIN JAVIER.BOLSA_COMERCIAL B ON B.ID = M.BOLSA_ID',
    'LEFT JOIN JAVIER.PEDIDOS_CAB C ON C.ID = M.PEDIDO_ID',
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
    'FROM JAVIER.MOVIMIENTOS_BOLSA M',
    'INNER JOIN JAVIER.BOLSA_COMERCIAL B ON B.ID = M.BOLSA_ID',
    'LEFT JOIN JAVIER.PEDIDOS_CAB C ON C.ID = M.PEDIDO_ID',
].join(' ');

const IDEMPOTENCY_KEYS_SELECT_SQL = Object.freeze({
    1: 'SELECT IDEMPOTENCY_KEY FROM JAVIER.MOVIMIENTOS_BOLSA WHERE IDEMPOTENCY_KEY IN (?)',
    2: 'SELECT IDEMPOTENCY_KEY FROM JAVIER.MOVIMIENTOS_BOLSA WHERE IDEMPOTENCY_KEY IN (?, ?)',
    3: 'SELECT IDEMPOTENCY_KEY FROM JAVIER.MOVIMIENTOS_BOLSA WHERE IDEMPOTENCY_KEY IN (?, ?, ?)',
    4: 'SELECT IDEMPOTENCY_KEY FROM JAVIER.MOVIMIENTOS_BOLSA WHERE IDEMPOTENCY_KEY IN (?, ?, ?, ?)',
    5: 'SELECT IDEMPOTENCY_KEY FROM JAVIER.MOVIMIENTOS_BOLSA WHERE IDEMPOTENCY_KEY IN (?, ?, ?, ?, ?)',
    6: 'SELECT IDEMPOTENCY_KEY FROM JAVIER.MOVIMIENTOS_BOLSA WHERE IDEMPOTENCY_KEY IN (?, ?, ?, ?, ?, ?)',
    7: 'SELECT IDEMPOTENCY_KEY FROM JAVIER.MOVIMIENTOS_BOLSA WHERE IDEMPOTENCY_KEY IN (?, ?, ?, ?, ?, ?, ?)',
    8: 'SELECT IDEMPOTENCY_KEY FROM JAVIER.MOVIMIENTOS_BOLSA WHERE IDEMPOTENCY_KEY IN (?, ?, ?, ?, ?, ?, ?, ?)',
    9: 'SELECT IDEMPOTENCY_KEY FROM JAVIER.MOVIMIENTOS_BOLSA WHERE IDEMPOTENCY_KEY IN (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    10: 'SELECT IDEMPOTENCY_KEY FROM JAVIER.MOVIMIENTOS_BOLSA WHERE IDEMPOTENCY_KEY IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
});

const LOCK_BOLSA_COMERCIAL_SQL = 'LOCK TABLE JAVIER.BOLSA_COMERCIAL IN EXCLUSIVE MODE';
const LOCK_MOVIMIENTOS_BOLSA_SQL = 'LOCK TABLE JAVIER.MOVIMIENTOS_BOLSA IN EXCLUSIVE MODE';
const BOLSA_UPDATE_ACCUMULATE_SQL = 'UPDATE JAVIER.BOLSA_COMERCIAL SET SALDO_DISPONIBLE = ?, ACUMULADO = ACUMULADO + ?, UPDATED_AT = CURRENT TIMESTAMP WHERE ID = ?';
const BOLSA_UPDATE_CONSUME_SQL = 'UPDATE JAVIER.BOLSA_COMERCIAL SET SALDO_DISPONIBLE = ?, CONSUMIDO = CONSUMIDO + ?, UPDATED_AT = CURRENT TIMESTAMP WHERE ID = ?';
const MOVIMIENTOS_INSERT_PREFIX = 'INSERT INTO JAVIER.MOVIMIENTOS_BOLSA (BOLSA_ID, CREATED_AT, CODIGOVENDEDOR, PEDIDO_ID, LINEA_ID, TIPO, IMPORTE, SALDO_ANTERIOR, SALDO_POSTERIOR, CODIGO_ARTICULO, DESCRIPCION, PRECIO_MINIMO_CONGELADO, PRECIO_VENTA, CANTIDAD, UNIDAD_MEDIDA, IDEMPOTENCY_KEY) VALUES ';
const MOVIMIENTOS_INSERT_ROW = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
const BOLSA_HISTORIAL_MENSUAL_SQL = [
    'SELECT EJERCICIO, MES, SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO, LIMITE_PCT, LIMITE_IMPORTE',
    'FROM JAVIER.BOLSA_COMERCIAL',
    'WHERE TRIM(CODIGOVENDEDOR) = ?',
    'AND (EJERCICIO > ? OR (EJERCICIO = ? AND MES >= ?))',
    'ORDER BY EJERCICIO ASC, MES ASC',
].join(' ');
const BOLSA_GROUPED_STATUS_BASE_SQL = [
    'SELECT ID, CODIGOVENDEDOR, EJERCICIO, MES, LIMITE_PCT, LIMITE_IMPORTE,',
    'SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO',
    'FROM JAVIER.BOLSA_COMERCIAL',
    'WHERE EJERCICIO = ? AND MES = ?',
].join(' ');
const BOLSA_UPDATE_CONFIG_BOTH_SQL = 'UPDATE JAVIER.BOLSA_COMERCIAL SET LIMITE_PCT = ?, LIMITE_IMPORTE = ?, UPDATED_AT = CURRENT TIMESTAMP WHERE ID = ?';
const BOLSA_UPDATE_CONFIG_PCT_SQL = 'UPDATE JAVIER.BOLSA_COMERCIAL SET LIMITE_PCT = ?, UPDATED_AT = CURRENT TIMESTAMP WHERE ID = ?';
const BOLSA_UPDATE_CONFIG_AMOUNT_SQL = 'UPDATE JAVIER.BOLSA_COMERCIAL SET LIMITE_IMPORTE = ?, UPDATED_AT = CURRENT TIMESTAMP WHERE ID = ?';

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

async function withBolsaTransaction(callback) {
    if (typeof getPool === 'function') {
        let pool = getPool();
        if (!pool && typeof initDb === 'function') {
            await initDb();
            pool = getPool();
        }
        if (pool && typeof pool.connect === 'function') {
            const conn = await pool.connect();
            try {
                // IBM i ODBC rejects BEGIN WORK (-104); mirror pedidos export transaction pattern.
                await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
                await conn.query(LOCK_BOLSA_COMERCIAL_SQL);
                await conn.query(LOCK_MOVIMIENTOS_BOLSA_SQL);
                const result = await callback((sql, params) => runQuery(conn.query.bind(conn), sql, params));
                await conn.query('COMMIT');
                return result;
            } catch (error) {
                try {
                    await conn.query('ROLLBACK');
                } catch (rollbackErr) {
                    logger.error(`[BOLSA] Rollback failed: ${rollbackErr.message}`);
                }
                throw error;
            } finally {
                if (conn && typeof conn.close === 'function') {
                    await conn.close();
                }
            }
        }
    }

    return callback(queryWithParams);
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
            const odbc0 = insertErr.odbcErrors && insertErr.odbcErrors[0];
            const msg = String(insertErr.message || '') + ' ' + String(odbc0?.message || '');
            // SQLSTATE 23505 = duplicate key (UNIQUE constraint violation)
            // SQLCODE -803 = duplicate key on IBM i
            if (!/23505|duplicate|803|UQ_BOLSA/i.test(msg)) {
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
            // Falback ultra-defensivo: devolver defaults sin ID
            return {
                id: null, vendedor: code, ejercicio: y, mes: m,
                limitePct: 3.0, limiteImporte: 0, saldoDisponible: 300.00,
                consumido: 0, acumulado: 0,
            };
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

async function acumularBolsa(vendedorCode, pedidoId, importeAcumulado, descripcion) {
    const now = new Date();
    const movements = normalizeBolsaMovements(descripcion, 'ACUMULACION', importeAcumulado, descripcion, pedidoId);
    return withBolsaTransaction(async (queryFn) => {
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
    });
}

// -- Consume from bolsa (when selling below minimum) ------------------

async function consumirBolsa(vendedorCode, pedidoId, importeConsumo, codigoArticulo) {
    const now = new Date();
    const movements = normalizeBolsaMovements(codigoArticulo, 'CONSUMO', importeConsumo, codigoArticulo, pedidoId);
    return withBolsaTransaction(async (queryFn) => {
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
    });
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
            idempotencyKey: buildBolsaMovementIdempotencyKey(pedidoId, movement.lineId ?? null, tipo) || movement.idempotencyKey || null,
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

async function validateOrderWithBolsa(vendedorCode, lines) {
    const now = new Date();
    const bolsa = await getOrCreateBolsa(vendedorCode, now.getFullYear(), now.getMonth() + 1);
    const saldoDisponible = toMoney(bolsa.saldoDisponible);

    let totalConsumo = 0;
    let totalAcumulacion = 0;
    const warnings = [];
    const lineMovements = [];

    for (const line of lines || []) {
        const referenceTariff = resolveBolsaReferencePrice(line);
        const configuredMin = resolveConfiguredMinFloor(line);
        const precioVenta = Number.parseFloat(line.precioVenta ?? line.PRECIOVENTA) || 0;
        const qty = getLineQuantity(line);
        if (referenceTariff <= 0 || qty <= 0) continue;

        const belowClientTariff = referenceTariff > 0 && precioVenta + 0.0001 < referenceTariff;
        if (configuredMin > 0 && precioVenta + 0.0001 < configuredMin && !belowClientTariff) {
            return {
                valid: false,
                reason: 'PRECIO_DEBAJO_MINIMO',
                code: line.CODIGOARTICULO || line.codigoArticulo,
                precioVenta,
                precioMinimo: configuredMin,
                precioTarifa: referenceTariff,
                message: `Precio ${precioVenta} por debajo del minimo configurado ${configuredMin}`,
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
            const movement = buildBolsaLineMovement(line, 'CONSUMO', diff, referenceTariff);
            lineMovements.push(movement);
            warnings.push({ code: movement.codigoArticulo, deficit: diff });
        } else if (precioVenta > referenceTariff + 0.0001) {
            const diff = toMoney((precioVenta - referenceTariff) * qty);
            totalAcumulacion = toMoney(totalAcumulacion + diff);
            lineMovements.push(buildBolsaLineMovement(line, 'ACUMULACION', diff, referenceTariff));
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
        'FROM DSEDAC.CPC P',
        'INNER JOIN DSEDAC.CAC F',
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
    return {
        id: r.ID,
        tipo: (r.TIPO || '').trim(),
        importe: parseFloat(r.IMPORTE) || 0,
        saldoAnterior: parseFloat(r.SALDO_ANTERIOR) || 0,
        saldoPosterior: parseFloat(r.SALDO_POSTERIOR) || 0,
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

async function getHistorialMensual(vendedorCode, months = 12) {
    const code = String(vendedorCode || '').trim();
    const n = Math.min(Math.max(parseInt(months) || 12, 1), 36);

    // Calcular rango: hoy hacia atras N meses (incluido el actual)
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
    const cutoffYear = cutoff.getFullYear();
    const cutoffMonth = cutoff.getMonth() + 1;

    // Filas existentes en BOLSA_COMERCIAL para ese rango
    const rows = await queryWithParams(
        BOLSA_HISTORIAL_MENSUAL_SQL,
        [code, cutoffYear, cutoffYear, cutoffMonth]
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
    const vendedores = (rows || []).map(mapBolsaStatusRow);
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
    validateOrderWithBolsa,
    resolveBolsaReferencePrice,
    resolveConfiguredMinFloor,
    toDb2Timestamp,
    getMovimientos,
    getHistorialMensual,
    getGroupedStatus,
    updateBolsaConfig,
};
