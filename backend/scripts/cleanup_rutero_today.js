#!/usr/bin/env node
/**
 * LIMPIEZA: Borrar todas las entradas de RUTERO_CONFIG y RUTERO_LOG
 * creadas hoy (25/02/2026) para pruebas del comercial 33
 *
 * Ejecutar:
 *   node backend/scripts/cleanup_rutero_today.js
 *
 * Con --dry-run para solo ver qué se borraría:
 *   node backend/scripts/cleanup_rutero_today.js --dry-run
 */

const { getPool, query } = require('../config/db');
const { reloadRuteroConfig } = require('../services/laclae');

const DRY_RUN = process.argv.includes('--dry-run');
const VENDEDOR = process.env.VENDEDOR || '33';

async function main() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  LIMPIEZA RUTERO_CONFIG - Pruebas de hoy`);
    console.log(`  Vendedor: ${VENDEDOR}`);
    console.log(`  Modo: ${DRY_RUN ? 'DRY-RUN (solo muestra, no borra)' : 'EJECUCIÓN REAL'}`);
    console.log(`${'='.repeat(60)}\n`);

    const pool = getPool();
    if (!pool) {
        // Try to initialize
        console.log('Inicializando pool de BD...');
        const { initDb } = require('../config/db');
        await initDb();
    }

    let conn;
    try {
        const dbPool = getPool();
        conn = await dbPool.connect();

        // 1. Ver TODAS las entradas actuales del vendedor en RUTERO_CONFIG
        console.log('--- RUTERO_CONFIG actual para vendedor', VENDEDOR, '---\n');
        const allConfig = await conn.query(`
            SELECT TRIM(VENDEDOR) as VENDEDOR, TRIM(DIA) as DIA, TRIM(CLIENTE) as CLIENTE, ORDEN
            FROM JAVIER.RUTERO_CONFIG
            WHERE TRIM(VENDEDOR) = '${VENDEDOR}'
            ORDER BY DIA, ORDEN
        `);

        if (allConfig.length === 0) {
            console.log('  No hay entradas en RUTERO_CONFIG para este vendedor.\n');
        } else {
            // Agrupar por día
            const byDay = {};
            allConfig.forEach(r => {
                const day = r.DIA?.trim() || 'SIN_DIA';
                if (!byDay[day]) byDay[day] = [];
                byDay[day].push(r);
            });

            Object.entries(byDay).forEach(([day, entries]) => {
                const positives = entries.filter(e => e.ORDEN >= 0);
                const blocks = entries.filter(e => e.ORDEN < 0);
                console.log(`  ${day.toUpperCase()}: ${positives.length} positivos, ${blocks.length} bloqueos`);
                entries.forEach(e => {
                    const type = e.ORDEN < 0 ? '🚫 BLOQUEO' : `📍 Orden ${e.ORDEN}`;
                    console.log(`    ${e.CLIENTE?.trim()} → ${type}`);
                });
            });
            console.log(`\n  TOTAL: ${allConfig.length} entradas\n`);
        }

        // 2. Ver LOG de hoy
        console.log('--- RUTERO_LOG de hoy para vendedor', VENDEDOR, '---\n');
        let logEntries = [];
        try {
            logEntries = await conn.query(`
                SELECT ID, FECHA_HORA, TIPO_CAMBIO, TRIM(DIA_ORIGEN) as DIA_ORIGEN,
                       TRIM(DIA_DESTINO) as DIA_DESTINO, TRIM(CLIENTE) as CLIENTE,
                       TRIM(NOMBRE_CLIENTE) as NOMBRE_CLIENTE, POSICION_ANTERIOR, POSICION_NUEVA,
                       TRIM(DETALLES) as DETALLES
                FROM JAVIER.RUTERO_LOG
                WHERE TRIM(VENDEDOR) = '${VENDEDOR}'
                  AND DATE(FECHA_HORA) = CURRENT DATE
                ORDER BY FECHA_HORA DESC
            `);

            if (logEntries.length === 0) {
                console.log('  No hay entradas en RUTERO_LOG de hoy.\n');
            } else {
                logEntries.forEach(l => {
                    const time = l.FECHA_HORA ? new Date(l.FECHA_HORA).toLocaleTimeString('es-ES') : '??';
                    console.log(`  [${time}] ${l.TIPO_CAMBIO}: ${l.CLIENTE} (${l.NOMBRE_CLIENTE || ''}) ${l.DIA_ORIGEN || ''}→${l.DIA_DESTINO || ''} pos:${l.POSICION_NUEVA}`);
                });
                console.log(`\n  TOTAL LOG HOY: ${logEntries.length} entradas\n`);
            }
        } catch (e) {
            console.log(`  No se pudo leer RUTERO_LOG: ${e.message}\n`);
        }

        // 3. BORRAR
        if (DRY_RUN) {
            console.log('=== DRY-RUN: No se borra nada ===');
            console.log(`  Se borrarían ${allConfig.length} entradas de RUTERO_CONFIG`);
            console.log(`  Se borrarían ${logEntries.length} entradas de RUTERO_LOG de hoy`);
            console.log('\nEjecuta sin --dry-run para borrar de verdad.\n');
        } else {
            console.log('=== BORRANDO... ===\n');

            await conn.beginTransaction();

            // Borrar TODAS las entradas de RUTERO_CONFIG para este vendedor
            // (tanto positivas como bloqueos - volver al estado natural puro)
            const deleteConfig = await conn.query(`
                DELETE FROM JAVIER.RUTERO_CONFIG
                WHERE TRIM(VENDEDOR) = '${VENDEDOR}'
            `);
            console.log(`  RUTERO_CONFIG: Borradas todas las entradas del vendedor ${VENDEDOR}`);

            // Borrar LOG de hoy
            try {
                const deleteLog = await conn.query(`
                    DELETE FROM JAVIER.RUTERO_LOG
                    WHERE TRIM(VENDEDOR) = '${VENDEDOR}'
                      AND DATE(FECHA_HORA) = CURRENT DATE
                `);
                console.log(`  RUTERO_LOG: Borradas entradas de hoy del vendedor ${VENDEDOR}`);
            } catch (e) {
                console.log(`  RUTERO_LOG: No se pudo borrar (${e.message})`);
            }

            await conn.commit();
            console.log('\n  ✅ COMMIT exitoso.\n');

            // 4. Recargar cache
            console.log('  Recargando cache de RUTERO_CONFIG...');
            try {
                await reloadRuteroConfig();
                console.log('  ✅ Cache recargada.\n');
            } catch (e) {
                console.log(`  ⚠️ No se pudo recargar cache: ${e.message}`);
                console.log('  Reinicia el backend con: pm2 restart gmp-api\n');
            }

            // 5. Verificar
            console.log('--- VERIFICACIÓN POST-LIMPIEZA ---\n');
            const remaining = await conn.query(`
                SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_CONFIG
                WHERE TRIM(VENDEDOR) = '${VENDEDOR}'
            `);
            console.log(`  Entradas restantes en RUTERO_CONFIG: ${remaining[0]?.CNT || 0}`);

            if ((remaining[0]?.CNT || 0) === 0) {
                console.log('  ✅ Limpieza completa. El vendedor vuelve a sus días naturales (CDVI).\n');
            } else {
                console.log('  ⚠️ Quedan entradas. Revisa manualmente.\n');
            }
        }

    } catch (e) {
        console.error(`\n❌ ERROR: ${e.message}\n${e.stack}\n`);
        if (conn) {
            try { await conn.rollback(); } catch (re) { }
        }
    } finally {
        if (conn) {
            try { await conn.close(); } catch (e) { }
        }
    }

    // Salir limpiamente
    setTimeout(() => process.exit(0), 1000);
}

main();
