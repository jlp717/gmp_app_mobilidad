const { getPool, initDb } = require('../config/db');

async function main() {
    console.log("=== 4. CHECK PERSISTENCIA GUARDADOS ===");
    await initDb();
    const conn = await getPool().connect();
    try {
        console.log("Check if latest logs match current state in config");
        const logs = await conn.query(`SELECT * FROM JAVIER.RUTERO_LOG WHERE TRIM(VENDEDOR) = '33' ORDER BY FECHA_HORA DESC FETCH FIRST 10 ROWS ONLY`);

        for (let log of logs) {
            console.log(`\nLog ID ${log.ID}: Cambio ${log.TIPO_CAMBIO}, CLI: ${log.CLIENTE}, DESTINO: ${log.DIA_DESTINO}, NUEVA_POS: ${log.POSICION_NUEVA}`);
            if (log.TIPO_CAMBIO !== 'BORRADO_MASIVO') {
                const config = await conn.query(`SELECT TRIM(DIA) as DIA, ORDEN FROM JAVIER.RUTERO_CONFIG WHERE TRIM(VENDEDOR) = '33' AND TRIM(CLIENTE) = '${log.CLIENTE.trim()}'`);
                if (config.length > 0) {
                    let matched = false;
                    for (let c of config) {
                        if (c.DIA.trim() === log.DIA_DESTINO?.trim() && Number(c.ORDEN) === Number(log.POSICION_NUEVA)) {
                            matched = true;
                        }
                    }
                    if (!matched) {
                        console.log(`> ❌ DESFASE DETECTADO PARA CLIENTE ${log.CLIENTE}. BD tiene:`, config);
                    } else {
                        console.log(`> ✅ COINCIDE MÁS O MENOS PARA CLIENTE ${log.CLIENTE}`);
                    }
                } else {
                    console.log(`> ❌ No encontrado en RUTERO_CONFIG`);
                }
            }
        }
    } catch (e) { console.error(e); } finally { await conn.close(); process.exit(0); }
}
main();
