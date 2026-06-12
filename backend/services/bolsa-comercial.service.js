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
const { getDb2WriteSchema } = require('../utils/db2-schemas');

const MAX_IDEMPOTENCY_LOOKUP_BATCH = 10;

function writeSchema() {
    return getDb2WriteSchema();
}

function bolsaTable() {
    return `${writeSchema()}.BOLSA_COMERCIAL`;
}

function movimientosTable() {
    return `${writeSchema()}.MOVIMIENTOS_BOLSA`;
}

function selectBolsaByVendorMonthSql() {
    return `SELECT ID, CODIGOVENDEDOR, EJERCICIO, MES, LIMITE_PCT, LIMITE_IMPORTE, SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO FROM ${bolsaTable()} WHERE TRIM(CODIGOVENDEDOR) = ? AND EJERCICIO = ? AND MES = ?`;
}

function selectMovimientosByBolsaSql() {
    return `SELECT ID, TIPO, IMPORTE, SALDO_ANTERIOR, SALDO_POSTERIOR, CODIGO_ARTICULO, DESCRIPCION, PEDIDO_ID, CREATED_AT, LINEA_ID, PRECIO_MINIMO_CONGELADO, PRECIO_VENTA, CANTIDAD, UNIDAD_MEDIDA, IDEMPOTENCY_KEY FROM ${movimientosTable()} WHERE BOLSA_ID = ? ORDER BY CREATED_AT DESC FETCH FIRST ? ROWS ONLY`;
}

function getIdempotencyKeysSql(count) {
    if (!Number.isInteger(count) || count < 1 || count > MAX_IDEMPOTENCY_LOOKUP_BATCH) {
        throw new Error('Invalid idempotency key batch size');
    }
    const placeholders = Array(count).fill('?').join(', ');
    return `SELECT IDEMPOTENCY_KEY FROM ${movimientosTable()} WHERE IDEMPOTENCY_KEY IN (${placeholders})`;
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
                await conn.query('BEGIN WORK');
                await conn.query(`LOCK TABLE ${bolsaTable()} IN EXCLUSIVE MODE`);
                await conn.query(`LOCK TABLE ${movimientosTable()} IN EXCLUSIVE MODE`);
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
                `INSERT INTO ${bolsaTable()} ` +
                '(CODIGOVENDEDOR, EJERCICIO, MES, LIMITE_PCT, SALDO_DISPONIBLE) ' +
                'VALUES (?, ?, ?, 3.00, 300.00)',
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
            `UPDATE ${bolsaTable()} ` +
            'SET SALDO_DISPONIBLE = ?, ACUMULADO = ACUMULADO + ?, UPDATED_AT = CURRENT TIMESTAMP ' +
            'WHERE ID = ?',
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
            `UPDATE ${bolsaTable()} ` +
            'SET SALDO_DISPONIBLE = ?, CONSUMIDO = CONSUMIDO + ?, UPDATED_AT = CURRENT TIMESTAMP ' +
            'WHERE ID = ?',
            [nuevoSaldo, pendingImporte, bolsa.id]
        );

        await insertBolsaMovements('CONSUMO', pendingMovements, bolsa.id, vendedorCode, pedidoId, saldoDisponible, nuevoSaldo, queryFn);

        logger.info(`[BOLSA] Consumido ${importeConsumo}EUR para ${vendedorCode}. Saldo: ${nuevoSaldo}EUR`);
        return { allowed: true, saldo: nuevoSaldo };
    });
}

// -- Validate order lines against bolsa -------------------------------

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
            timestamp: movement.timestamp || new Date().toISOString(),
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
    const rowSql = "(?, ?, ?, ?, ?, '" + tipo + "', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    const sql = `INSERT INTO ${movimientosTable()} ` +
        '(BOLSA_ID, CREATED_AT, CODIGOVENDEDOR, PEDIDO_ID, LINEA_ID, TIPO, IMPORTE, ' +
        'SALDO_ANTERIOR, SALDO_POSTERIOR, CODIGO_ARTICULO, DESCRIPCION, ' +
        'PRECIO_MINIMO_CONGELADO, PRECIO_VENTA, CANTIDAD, UNIDAD_MEDIDA, IDEMPOTENCY_KEY) ' +
        'VALUES ' + movements.map(function () { return rowSql; }).join(', ');
    let runningSaldo = toMoney(saldoInicial);
    const params = [];
    for (const movement of movements) {
        const saldoAnterior = runningSaldo;
        runningSaldo = tipo === 'CONSUMO' ? toMoney(runningSaldo - movement.importe) : toMoney(runningSaldo + movement.importe);
        params.push(bolsaId, movement.timestamp, String(vendedorCode || '').trim(), pedidoId, movement.lineId, movement.importe, saldoAnterior, runningSaldo, movement.codigoArticulo, movement.descripcion, movement.precioMinimoCongelado, movement.precioVenta, movement.cantidad, movement.unidadMedida, movement.idempotencyKey);
    }
    if (Math.abs(runningSaldo - toMoney(saldoFinal)) > 0.01) throw new Error('Saldo posterior de movimientos ' + tipo + ' no cuadra con bolsa');
    return runQuery(queryFn, sql, params);
}

function buildBolsaLineMovement(line, tipo, importe) {
    return {
        tipo,
        importe: toMoney(importe),
        codigoArticulo: String(line.codigoArticulo ?? line.CODIGOARTICULO ?? '').trim(),
        lineId: line.lineId ?? line.ID ?? null,
        precioMinimoCongelado: Number.parseFloat(line.precioMinimo ?? line.PRECIOMINIMO) || 0,
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
        const precioMinimo = Number.parseFloat(line.precioMinimo ?? line.PRECIOMINIMO) || 0;
        const precioVenta = Number.parseFloat(line.precioVenta ?? line.PRECIOVENTA) || 0;
        const qty = getLineQuantity(line);
        if (precioMinimo <= 0 || qty <= 0) continue;
        if (precioVenta < precioMinimo) {
            const diff = toMoney((precioMinimo - precioVenta) * qty);
            totalConsumo = toMoney(totalConsumo + diff);
            const movement = buildBolsaLineMovement(line, 'CONSUMO', diff);
            lineMovements.push(movement);
            warnings.push({ code: movement.codigoArticulo, deficit: diff });
        } else if (precioVenta > precioMinimo) {
            const diff = toMoney((precioVenta - precioMinimo) * qty);
            totalAcumulacion = toMoney(totalAcumulacion + diff);
            lineMovements.push(buildBolsaLineMovement(line, 'ACUMULACION', diff));
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

async function getMovimientos(vendedorCode, year, month, limit = 50) {
    const bolsa = await getOrCreateBolsa(vendedorCode, year, month);
    const rows = await queryWithParams(
        selectMovimientosByBolsaSql(),
        [bolsa.id, limit]
    );

    return (rows || []).map(r => ({
        id: r.ID,
        tipo: (r.TIPO || '').trim(),
        importe: parseFloat(r.IMPORTE) || 0,
        saldoAnterior: parseFloat(r.SALDO_ANTERIOR) || 0,
        saldoPosterior: parseFloat(r.SALDO_POSTERIOR) || 0,
        codigoArticulo: (r.CODIGO_ARTICULO || '').trim(),
        descripcion: (r.DESCRIPCION || '').trim(),
        pedidoId: r.PEDIDO_ID,
        fecha: r.CREATED_AT,
        lineId: r.LINEA_ID ?? null,
        precioMinimoCongelado: nullableNumber(r.PRECIO_MINIMO_CONGELADO),
        precioVenta: nullableNumber(r.PRECIO_VENTA),
        cantidad: nullableNumber(r.CANTIDAD),
        unidadMedida: nullableTrim(r.UNIDAD_MEDIDA),
        idempotencyKey: nullableTrim(r.IDEMPOTENCY_KEY),
    }));
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
        `SELECT EJERCICIO, MES, SALDO_DISPONIBLE, CONSUMIDO, ACUMULADO,
                LIMITE_PCT, LIMITE_IMPORTE
           FROM ${bolsaTable()}
          WHERE TRIM(CODIGOVENDEDOR) = ?
            AND ( EJERCICIO > ?
                  OR (EJERCICIO = ? AND MES >= ?) )
          ORDER BY EJERCICIO ASC, MES ASC`,
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

// -- Update configuration (JEFE_VENTAS only) --------------------------

async function updateBolsaConfig(vendedorCode, year, month, { limitePct, limiteImporte }) {
    const bolsa = await getOrCreateBolsa(vendedorCode, year, month);
    const hasLimitePct = limitePct !== undefined;
    const hasLimiteImporte = limiteImporte !== undefined;

    if (!hasLimitePct && !hasLimiteImporte) return bolsa;

    if (hasLimitePct && hasLimiteImporte) {
        await queryWithParams(
            `UPDATE ${bolsaTable()} ` +
            'SET LIMITE_PCT = ?, LIMITE_IMPORTE = ?, UPDATED_AT = CURRENT TIMESTAMP WHERE ID = ?',
            [parseFloat(limitePct), parseFloat(limiteImporte), bolsa.id]
        );
    } else if (hasLimitePct) {
        await queryWithParams(
            `UPDATE ${bolsaTable()} SET LIMITE_PCT = ?, UPDATED_AT = CURRENT TIMESTAMP WHERE ID = ?`,
            [parseFloat(limitePct), bolsa.id]
        );
    } else {
        await queryWithParams(
            `UPDATE ${bolsaTable()} SET LIMITE_IMPORTE = ?, UPDATED_AT = CURRENT TIMESTAMP WHERE ID = ?`,
            [parseFloat(limiteImporte), bolsa.id]
        );
    }

    return getOrCreateBolsa(vendedorCode, year, month);
}

module.exports = {
    getOrCreateBolsa,
    acumularBolsa,
    consumirBolsa,
    validateOrderWithBolsa,
    getMovimientos,
    getHistorialMensual,
    updateBolsaConfig,
};
