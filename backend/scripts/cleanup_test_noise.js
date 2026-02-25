#!/usr/bin/env node
const { getPool } = require('../config/db');
const { reloadRuteroConfig } = require('../services/laclae');

async function main() {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  LIMPIEZA DE TEST - 25/02/2026 (10:00 - 10:25 y posteriores)`);
    console.log(`  Vendedores afectados: 33 y 98`);
    console.log(`${'='.repeat(60)}\n`);

    const { initDb } = require('../config/db');
    await initDb();

    let conn;
    try {
        const dbPool = getPool();
        conn = await dbPool.connect();

        console.log('=== BORRANDO... ===\n');

        // Borrar RUTERO_CONFIG para vendedores 33 y 98 (reseteo a rutas naturales)
        // Ya que la tabla no tiene timestamp y los tests sobreescribieron todo
        await conn.query(`
            DELETE FROM JAVIER.RUTERO_CONFIG
            WHERE TRIM(VENDEDOR) IN ('33', '98')
        `);
        console.log(`  ✅ RUTERO_CONFIG: Borradas todas las configuraciones de los vendedores 33 y 98 (vuelven a natural).`);

        // Borrar RUTERO_LOG entre las 10:00 y las 12:30 de hoy
        // En DB2 la fecha se puede manejar con literales o TIMESTAMP
        await conn.query(`
            DELETE FROM JAVIER.RUTERO_LOG
            WHERE DATE(FECHA_HORA) = CURRENT DATE
              AND HOUR(FECHA_HORA) BETWEEN 10 AND 11
        `);
        console.log(`  ✅ RUTERO_LOG: Borrados los registros de auditoría de los tests generados esta mañana.`);

        console.log('\n  Recargando cache de RUTERO_CONFIG en memoria...');
        try {
            await reloadRuteroConfig();
            console.log('  ✅ Cache recargada en este proceso.\n');
        } catch (e) {
            console.log(`  ⚠️ No se pudo recargar cache localmente: ${e.message}`);
        }

        console.log(`\n🎉 LIMPIEZA FINALIZADA!`);
        console.log(`No olvides reiniciar la API principal si necesitas que la memoria limpie completamente:`);
        console.log(`pm2 restart gmp-api\n`);

    } catch (e) {
        console.error(`\n❌ ERROR: ${e.message}\n${e.stack}\n`);
    } finally {
        if (conn) {
            try { await conn.close(); } catch (e) { }
        }
        setTimeout(() => process.exit(0), 1000);
    }
}

main();
