/**
 * TEST: Verificación de datos reales del Comercial 33
 * READ-ONLY - No modifica datos
 */
const { getPool, initDb } = require('../config/db');

async function main() {
    console.log('=== TEST: COMERCIAL 33 (READ-ONLY) ===\n');
    await initDb();
    const conn = await getPool().connect();
    let passed = 0, failed = 0;

    try {
        // Test 1: CDVI has clients for vendor 33
        console.log('1. CDVI tiene clientes para vendedor 33...');
        const cdvi = await conn.query(`
            SELECT COUNT(*) as CNT FROM DSEDAC.CDVI C
            JOIN DSEDAC.CLI K ON C.CODIGOCLIENTE = K.CODIGOCLIENTE
            WHERE TRIM(C.CODIGOVENDEDOR) = '33'
              AND (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
              AND (K.ANOBAJA = 0 OR K.ANOBAJA IS NULL)
        `);
        if (cdvi[0].CNT > 100) {
            console.log(`   OK - ${cdvi[0].CNT} clientes activos en CDVI`);
            passed++;
        } else {
            console.log(`   WARN - Solo ${cdvi[0].CNT} clientes (esperados >100)`);
            failed++;
        }

        // Test 2: RUTERO_CONFIG has entries
        console.log('2. RUTERO_CONFIG tiene configuración personalizada...');
        const config = await conn.query(`
            SELECT COUNT(*) as TOTAL,
                   SUM(CASE WHEN ORDEN >= 0 THEN 1 ELSE 0 END) as POSITIVOS,
                   SUM(CASE WHEN ORDEN = -1 THEN 1 ELSE 0 END) as BLOQUEADOS
            FROM JAVIER.RUTERO_CONFIG WHERE TRIM(VENDEDOR) = '33'
        `);
        if (config[0].TOTAL > 0) {
            console.log(`   OK - ${config[0].TOTAL} entries (${config[0].POSITIVOS} positivos, ${config[0].BLOQUEADOS} bloqueados)`);
            passed++;
        } else {
            console.log('   FAIL - Sin configuración personalizada');
            failed++;
        }

        // Test 3: No duplicate client-day combinations
        console.log('3. Sin duplicados cliente-día...');
        const dups = await conn.query(`
            SELECT TRIM(DIA) as DIA, TRIM(CLIENTE) as CLI, COUNT(*) as CNT
            FROM JAVIER.RUTERO_CONFIG
            WHERE TRIM(VENDEDOR) = '33'
            GROUP BY DIA, CLIENTE
            HAVING COUNT(*) > 1
        `);
        if (dups.length === 0) {
            console.log('   OK - Sin duplicados');
            passed++;
        } else {
            console.log(`   FAIL - ${dups.length} duplicados encontrados`);
            console.table(dups);
            failed++;
        }

        // Test 4: All days have valid names
        console.log('4. Todos los días tienen nombres válidos...');
        const validDays = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
        const days = await conn.query(`
            SELECT DISTINCT TRIM(DIA) as DIA FROM JAVIER.RUTERO_CONFIG WHERE TRIM(VENDEDOR) = '33'
        `);
        const invalidDays = days.filter(d => !validDays.includes(d.DIA));
        if (invalidDays.length === 0) {
            console.log(`   OK - ${days.length} días válidos: ${days.map(d => d.DIA).join(', ')}`);
            passed++;
        } else {
            console.log(`   FAIL - Días inválidos: ${invalidDays.map(d => d.DIA).join(', ')}`);
            failed++;
        }

        // Test 5: ORDEN values are sane (no negative except -1)
        console.log('5. Valores ORDEN son coherentes...');
        const badOrden = await conn.query(`
            SELECT TRIM(DIA) as DIA, TRIM(CLIENTE) as CLI, ORDEN
            FROM JAVIER.RUTERO_CONFIG
            WHERE TRIM(VENDEDOR) = '33' AND ORDEN < -1
        `);
        if (badOrden.length === 0) {
            console.log('   OK - Todos los ORDEN son >= -1');
            passed++;
        } else {
            console.log(`   FAIL - ${badOrden.length} entradas con ORDEN < -1`);
            console.table(badOrden);
            failed++;
        }

        // Test 6: RUTERO_LOG has recent entries
        console.log('6. RUTERO_LOG tiene historial reciente...');
        const logs = await conn.query(`
            SELECT COUNT(*) as CNT FROM JAVIER.RUTERO_LOG
            WHERE TRIM(VENDEDOR) = '33' AND FECHA_HORA > CURRENT_TIMESTAMP - 7 DAYS
        `);
        console.log(`   INFO - ${logs[0].CNT} entradas en últimos 7 días`);
        passed++; // informational

        // Test 7: No orphaned blocks (blocked client that has positive entry on same day)
        console.log('7. Sin bloqueos huérfanos (block + positive en mismo día)...');
        const orphanBlocks = await conn.query(`
            SELECT a.DIA, TRIM(a.CLIENTE) as CLI, a.ORDEN as BLOCK_ORD, b.ORDEN as POS_ORD
            FROM JAVIER.RUTERO_CONFIG a
            JOIN JAVIER.RUTERO_CONFIG b ON a.VENDEDOR = b.VENDEDOR AND a.DIA = b.DIA AND a.CLIENTE = b.CLIENTE
            WHERE TRIM(a.VENDEDOR) = '33' AND a.ORDEN = -1 AND b.ORDEN >= 0
        `);
        if (orphanBlocks.length === 0) {
            console.log('   OK - Sin conflictos block/positive en mismo día');
            passed++;
        } else {
            console.log(`   FAIL - ${orphanBlocks.length} conflictos encontrados`);
            console.table(orphanBlocks);
            failed++;
        }

    } catch (e) { console.error(e); failed++; }
    finally { await conn.close(); }

    console.log(`\n=== RESULTADO: ${passed}/${passed + failed} tests passed ===`);
    if (failed > 0) console.log('FAIL');
    else console.log('ALL PASSED');
    process.exit(failed > 0 ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
