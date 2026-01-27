const { query, initDb } = require('../config/db');

async function simulateLoad() {
    try {
        await initDb();
        console.log('🔍 Simulating CDVI Load with new filter...');

        const rows = await query(`
             SELECT 
                TRIM(CODIGOVENDEDOR) as VENDEDOR,
                TRIM(CODIGOCLIENTE) as CLIENTE
             FROM DSEDAC.CDVI
             WHERE (MARCAACTUALIZACION <> 'B' OR MARCAACTUALIZACION IS NULL OR TRIM(MARCAACTUALIZACION) = '')
             AND CODIGOVENDEDOR = '15'
        `);

        console.log(`✅ Loaded ${rows.length} route configs for Vendor 15.`);

        const missing = ['4300009046', '4300010203'];
        const found = rows.filter(r => missing.includes(r.CLIENTE));

        console.log(`Found missing clients: ${found.length} / ${missing.length}`);
        found.forEach(f => console.log(`- Found: ${f.CLIENTE}`));

        if (found.length < missing.length) {
            const missingFromFound = missing.filter(m => !found.find(f => f.CLIENTE === m));
            console.log('Still missing:', missingFromFound);
        }

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
simulateLoad();
