const { query, initDb } = require('../config/db');

async function inspectLog() {
    try {
        await initDb();

        console.log('🔍 Buscando cambios de rutero para Vendedor 33...');

        // Check if table exists first (just in case)
        try {
            const count = await query("SELECT COUNT(*) as count FROM JAVIER.RUTERO_LOG WHERE VENDEDOR = '33'");
            console.log(`📊 Total registros encontrados: ${count[0].COUNT}`);
        } catch (e) {
            console.error('❌ Error accediendo a JAVIER.RUTERO_LOG:', e.message);
            process.exit(1);
        }

        // Get details
        const logs = await query(`
            SELECT ID, FECHA_HORA, TIPO_CAMBIO, DIA_ORIGEN, DIA_DESTINO, CLIENTE, NOMBRE_CLIENTE, POSICION_ANTERIOR, POSICION_NUEVA, DETALLES 
            FROM JAVIER.RUTERO_LOG 
            WHERE VENDEDOR = '33' 
            ORDER BY FECHA_HORA DESC 
            FETCH FIRST 20 ROWS ONLY
        `);

        if (logs.length === 0) {
            console.log('⚠️ No se encontraron cambios recientes.');
        } else {
            console.log('📝 Últimos 20 cambios:');
            logs.forEach(log => {
                console.log(`[${log.FECHA_HORA}] ${log.TIPO_CAMBIO} - Cliente: ${log.NOMBRE_CLIENTE} (${log.CLIENTE})`);
                console.log(`   Días: ${log.DIA_ORIGEN} -> ${log.DIA_DESTINO}`);
                console.log(`   Posición: ${log.POSICION_ANTERIOR} -> ${log.POSICION_NUEVA}`);
                console.log(`   Detalles: ${log.DETALLES}`);
                console.log('---');
            });
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

inspectLog();
