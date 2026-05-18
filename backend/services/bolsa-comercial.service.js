'use strict';

/**
 * BOLSA COMERCIAL SERVICE
 * =======================
 * Manages the "commercial bag" - a per-vendor monthly budget that
 * tracks accumulated margin and allows flexible pricing within limits.
 *
 * INTENTIONAL: las tablas BOLSA_* viven SIEMPRE en JAVIER, incluso en
 * produccion (cuando PEDIDOS_CONFIRMATION_SCHEMA=DSEDAC). Es una decision
 * de negocio: la bolsa es control interno y NO se replica al ERP.
 * NO sustituir SCHEMA por una variable de entorno.
 *
 * Tables: JAVIER.BOLSA_COMERCIAL, JAVIER.MOVIMIENTOS_BOLSA
 * ERP reads: DSEDAC.ARA (tariffs for margin calc)
 */

const { queryWithParams } = require('../config/db');
const logger = require('../middleware/logger');

const SCHEMA = 'JAVIER'; // Hardcoded por diseno - ver comentario superior.

// ── Get or create monthly bolsa ─────────────────────────────────────

async function getOrCreateBolsa(vendedorCode, year, month) {
    const code = String(vendedorCode || '').trim();
    const y = parseInt(year);
    const m = parseInt(month);

    let rows = await queryWithParams(
        `SELECT * FROM ${SCHEMA}.BOLSA_COMERCIAL
         WHERE TRIM(CODIGOVENDEDOR) = ? AND EJERCICIO = ? AND MES = ?`,
        [code, y, m]
    );

    if (!rows || rows.length === 0) {
        // FIX race condition: dos GET simultaneos pueden llegar aqui antes de
        // que ninguno haya insertado. Capturamos el error de UNIQUE/duplicate
        // y volvemos a hacer SELECT (la otra request ya inserto).
        try {
            await queryWithParams(
                `INSERT INTO ${SCHEMA}.BOLSA_COMERCIAL
                 (CODIGOVENDEDOR, EJERCICIO, MES, LIMITE_PCT, SALDO_DISPONIBLE)
                 VALUES (?, ?, ?, 3.00, 0)`,
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
        rows = await queryWithParams(
            `SELECT * FROM ${SCHEMA}.BOLSA_COMERCIAL
             WHERE TRIM(CODIGOVENDEDOR) = ? AND EJERCICIO = ? AND MES = ?`,
            [code, y, m]
        );
        if (!rows || rows.length === 0) {
            // Falback ultra-defensivo: devolver defaults sin ID
            return {
                id: null, vendedor: code, ejercicio: y, mes: m,
                limitePct: 3.0, limiteImporte: 0, saldoDisponible: 0,
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

// ── Accumulate margin into bolsa ────────────────────────────────────

async function acumularBolsa(vendedorCode, pedidoId, importeAcumulado, descripcion) {
    const now = new Date();
    const bolsa = await getOrCreateBolsa(vendedorCode, now.getFullYear(), now.getMonth() + 1);
    const saldoAnterior = bolsa.saldoDisponible;
    const nuevoSaldo = saldoAnterior + importeAcumulado;

    await queryWithParams(
        `UPDATE ${SCHEMA}.BOLSA_COMERCIAL
         SET SALDO_DISPONIBLE = ?, ACUMULADO = ACUMULADO + ?, UPDATED_AT = CURRENT TIMESTAMP
         WHERE ID = ?`,
        [nuevoSaldo, importeAcumulado, bolsa.id]
    );

    await queryWithParams(
        `INSERT INTO ${SCHEMA}.MOVIMIENTOS_BOLSA
         (BOLSA_ID, PEDIDO_ID, TIPO, IMPORTE, SALDO_ANTERIOR, SALDO_POSTERIOR, DESCRIPCION)
         VALUES (?, ?, 'ACUMULACION', ?, ?, ?, ?)`,
        [bolsa.id, pedidoId, importeAcumulado, saldoAnterior, nuevoSaldo, descripcion || '']
    );

    logger.info(`[BOLSA] Acumulado ${importeAcumulado}€ para ${vendedorCode}. Saldo: ${nuevoSaldo}€`);
    return nuevoSaldo;
}

// ── Consume from bolsa (when selling below minimum) ─────────────────

async function consumirBolsa(vendedorCode, pedidoId, importeConsumo, codigoArticulo) {
    const now = new Date();
    const bolsa = await getOrCreateBolsa(vendedorCode, now.getFullYear(), now.getMonth() + 1);
    const saldoDisponible = bolsa.saldoDisponible;

    if (importeConsumo > saldoDisponible) {
        return { allowed: false, deficit: importeConsumo - saldoDisponible, saldo: saldoDisponible };
    }

    const nuevoSaldo = saldoDisponible - importeConsumo;

    await queryWithParams(
        `UPDATE ${SCHEMA}.BOLSA_COMERCIAL
         SET SALDO_DISPONIBLE = ?, CONSUMIDO = CONSUMIDO + ?, UPDATED_AT = CURRENT TIMESTAMP
         WHERE ID = ?`,
        [nuevoSaldo, importeConsumo, bolsa.id]
    );

    await queryWithParams(
        `INSERT INTO ${SCHEMA}.MOVIMIENTOS_BOLSA
         (BOLSA_ID, PEDIDO_ID, TIPO, IMPORTE, SALDO_ANTERIOR, SALDO_POSTERIOR, CODIGO_ARTICULO)
         VALUES (?, ?, 'CONSUMO', ?, ?, ?, ?)`,
        [bolsa.id, pedidoId, importeConsumo, saldoDisponible, nuevoSaldo, codigoArticulo || '']
    );

    logger.info(`[BOLSA] Consumido ${importeConsumo}€ para ${vendedorCode}. Saldo: ${nuevoSaldo}€`);
    return { allowed: true, saldo: nuevoSaldo };
}

// ── Validate order lines against bolsa ──────────────────────────────

async function validateOrderWithBolsa(vendedorCode, lines) {
    const now = new Date();
    const bolsa = await getOrCreateBolsa(vendedorCode, now.getFullYear(), now.getMonth() + 1);
    const saldoDisponible = bolsa.saldoDisponible;

    let totalDeficit = 0;
    const warnings = [];

    for (const line of lines) {
        const precioMinimo = parseFloat(line.precioMinimo || line.PRECIOMINIMO || 0);
        const precioVenta = parseFloat(line.precioVenta || line.PRECIOVENTA || 0);
        if (precioMinimo > 0 && precioVenta < precioMinimo) {
            const qty = parseFloat(line.cantidadEnvases || line.CANTIDADENVASES || 0)
                      + parseFloat(line.cantidadUnidades || line.CANTIDADUNIDADES || 0);
            const diff = (precioMinimo - precioVenta) * qty;
            totalDeficit += diff;
            warnings.push({
                code: (line.codigoArticulo || line.CODIGOARTICULO || '').trim(),
                deficit: diff,
            });
        }
    }

    if (totalDeficit > 0 && totalDeficit > saldoDisponible) {
        return {
            valid: false,
            reason: 'BOLSA_INSUFICIENTE',
            deficit: totalDeficit - saldoDisponible,
            saldo: saldoDisponible,
            warnings,
        };
    }

    return {
        valid: true,
        consumo: totalDeficit,
        saldo: saldoDisponible - totalDeficit,
    };
}

// ── Get movements log ───────────────────────────────────────────────

async function getMovimientos(vendedorCode, year, month, limit = 50) {
    const bolsa = await getOrCreateBolsa(vendedorCode, year, month);
    const rows = await queryWithParams(
        `SELECT * FROM ${SCHEMA}.MOVIMIENTOS_BOLSA
         WHERE BOLSA_ID = ?
         ORDER BY CREATED_AT DESC
         FETCH FIRST ? ROWS ONLY`,
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
    }));
}

// ── Get historical monthly summary (last N months) ─────────────────

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
           FROM ${SCHEMA}.BOLSA_COMERCIAL
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

// ── Update configuration (JEFE_VENTAS only) ─────────────────────────

async function updateBolsaConfig(vendedorCode, year, month, { limitePct, limiteImporte }) {
    const bolsa = await getOrCreateBolsa(vendedorCode, year, month);
    const updates = [];
    const params = [];

    if (limitePct !== undefined) {
        updates.push('LIMITE_PCT = ?');
        params.push(parseFloat(limitePct));
    }
    if (limiteImporte !== undefined) {
        updates.push('LIMITE_IMPORTE = ?');
        params.push(parseFloat(limiteImporte));
    }

    if (updates.length === 0) return bolsa;

    updates.push('UPDATED_AT = CURRENT TIMESTAMP');
    params.push(bolsa.id);

    await queryWithParams(
        `UPDATE ${SCHEMA}.BOLSA_COMERCIAL SET ${updates.join(', ')} WHERE ID = ?`,
        params
    );

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
