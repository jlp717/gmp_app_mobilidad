require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');

async function debug() {
    try {
        console.log('--- START DEBUG ---');

        // 1. Check Vendedores
        console.log('Querying DSEDAC.VENDEDORES...');
        const vSql = `SELECT CODIGOVENDEDOR, NOMBREVENDEDOR FROM DSEDAC.VENDEDORES ORDER BY CODIGOVENDEDOR`;
        const vendors = await query(vSql).catch(e => { console.log('Error VENDEDORES:', e.message); return []; });
        console.log(`VENDEDORES found: ${vendors.length}`);

        // 2. Check Repartidores
        console.log('Querying DSEDAC.REP...');
        const repSql = `SELECT CODIGOREPARTIDOR, NOMBREREPARTIDOR FROM DSEDAC.REP ORDER BY CODIGOREPARTIDOR`;
        const reps = await query(repSql).catch(e => { console.log('Error REP:', e.message); return []; });
        console.log(`REP found: ${reps.length}`);

        // 3. Check Today
        const today = new Date();
        const y = today.getFullYear();
        const m = today.getMonth() + 1;
        const d = today.getDate(); // Should be 13
        console.log(`Checking Today: ${y}-${m}-${d}`);

        const cpcSql = `
            SELECT COUNT(*) as TOTAL,
                   SUM(CASE WHEN CONFORMADOSN = 'S' THEN 1 ELSE 0 END) as CONFIRMED_LEGACY,
                   SUM(CASE WHEN DIALLEGADA > 0 THEN 1 ELSE 0 END) as PLANNED
            FROM DSEDAC.CPC
            WHERE ANODOCUMENTO = ${y} AND MESDOCUMENTO = ${m} AND DIADOCUMENTO = ${d}
        `;
        const cpc = await query(cpcSql);
        console.log('CPC Today:', cpc);

        // Print table for user
        console.log('\n=== TABLA DE VENDEDORES DISPONIBLES ===');
        console.log('CODIGO | NOMBRE');
        console.log('-------|-------------------');
        let list = vendors.length > 0 ? vendors : reps;
        list.forEach(r => {
            // Adapt columns
            const code = r.CODIGOVENDEDOR || r.CODIGOREPARTIDOR;
            const name = r.NOMBREVENDEDOR || r.NOMBREREPARTIDOR;
            console.log(`${String(code).padEnd(6)} | ${name}`);
        });
        console.log('=======================================\n');

        process.exit(0);
    } catch (e) {
        console.error('FATAL:', e);
        process.exit(1);
    }
}
debug();
