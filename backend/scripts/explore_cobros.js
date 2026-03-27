const { query } = require('../config/db');

async function run() {
    try {
        console.log('--- JAVIER PEDIDOS_CAB Columns ---');
        const cab = await query('SELECT * FROM JAVIER.PEDIDOS_CAB FETCH FIRST 1 ROWS ONLY');
        if (cab.length > 0) {
            console.log(Object.keys(cab[0]).join(', '));
        }
        
        console.log('\n--- DSEDAC FORMAS DE PAGO (FPA) ---');
        const fpa = await query('SELECT CODIGOFORMAPAGO, DESCRIPCIONFORMAPAGO FROM DSEDAC.FPA FETCH FIRST 10 ROWS ONLY');
        console.table(fpa);
        
        console.log('\n--- DSEDAC COBROS/PAGOS ---');
        // Let's try to query some typical table names
        const tablesToTry = ['COB', 'PAG', 'COBROS', 'PAGOS', 'LNP', 'REC', 'CAR', 'LIQ'];
        for (const t of tablesToTry) {
            try {
                const res = await query(`SELECT * FROM DSEDAC.${t} FETCH FIRST 1 ROWS ONLY`);
                console.log(`Table DSEDAC.${t} exists! Columns:`, Object.keys(res[0] || {}).join(', '));
            } catch (e) {
                // Ignore, table doesn't exist
            }
        }
        
        // Also check JAVIER schema
        for (const t of ['COBROS', 'PAGOS', 'LIQUIDACIONES', 'RECIBOS']) {
            try {
                const res = await query(`SELECT * FROM JAVIER.${t} FETCH FIRST 1 ROWS ONLY`);
                console.log(`Table JAVIER.${t} exists! Columns:`, Object.keys(res[0] || {}).join(', '));
            } catch (e) {
                // Ignore
            }
        }

        // Lastly, looking for "Contado" or "Especial" in some invoice/orders related table
        try {
            const cobroRef = await query(`SELECT * FROM DSEDAC.FPA WHERE DESCRIPCIONFORMAPAGO LIKE '%CONTADO%' OR DESCRIPCIONFORMAPAGO LIKE '%NORMAL%' OR DESCRIPCIONFORMAPAGO LIKE '%ESPECIAL%'`);
            console.table(cobroRef);
        } catch (e) {}

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
