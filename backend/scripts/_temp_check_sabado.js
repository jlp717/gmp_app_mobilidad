const { query, initDb } = require('../config/db');
async function check() {
    await initDb();
    // 1. Find full codes for the partial codes
    const partials = ['10170','7970','9698','10373','10346','10338','9447','10208','10332','10336','5584','1078','10353','10339','3095','10039'];
    const likeConditions = partials.map(p => "TRIM(CODIGOCLIENTE) LIKE '%" + p + "'").join(' OR ');
    const clients = await query("SELECT TRIM(CODIGOCLIENTE) as CODE, TRIM(COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO),''), NOMBRECLIENTE)) as NAME FROM DSEDAC.CLI WHERE " + likeConditions);
    console.log('=== RESOLVED CLIENT CODES ===');
    clients.forEach(c => console.log(c.CODE + ' | ' + c.NAME));

    // 2. Current Saturday route  
    console.log('\n=== CURRENT SATURDAY CONFIG (vendor 33) ===');
    const config = await query("SELECT TRIM(CLIENTE) as CLI, ORDEN FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR='33' AND DIA='sabado' ORDER BY ORDEN");
    for (const r of config) {
        const nm = await query("SELECT TRIM(COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO),''), NOMBRECLIENTE)) as N FROM DSEDAC.CLI WHERE TRIM(CODIGOCLIENTE)='" + r.CLI + "' FETCH FIRST 1 ROWS ONLY");
        console.log('[' + r.ORDEN + '] ' + r.CLI + ' | ' + (nm[0]?.N || '?'));
    }
    process.exit(0);
}
check();
