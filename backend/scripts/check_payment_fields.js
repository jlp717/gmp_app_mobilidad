const { query, initDb } = require('../config/db');

async function checkPaymentFields() {
    await initDb();

    // Check CLI columns related to payment
    console.log('=== CLI Payment Columns ===');
    try {
        const cols = await query(`
            SELECT COLUMN_NAME 
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CLI'
            AND (
                COLUMN_NAME LIKE '%PAGO%' 
                OR COLUMN_NAME LIKE '%FORMA%' 
                OR COLUMN_NAME LIKE '%CRED%' 
                OR COLUMN_NAME LIKE '%COBR%'
                OR COLUMN_NAME LIKE '%TIPO%'
                OR COLUMN_NAME LIKE '%CONTADO%'
            )
        `, false);
        console.log('Payment-related columns:', cols.map(c => c.COLUMN_NAME).join(', '));
    } catch (e) {
        console.log('Error:', e.message);
    }

    // Sample data for client 40336
    console.log('\n=== Client 40336 Payment Data ===');
    try {
        const client = await query(`
            SELECT CODIGOCLIENTE, NOMBRECLIENTE, CODIGOFORMAPAGO, DIASVENCIMIENTO, TIPOPAGO
            FROM DSEDAC.CLI
            WHERE CODIGOCLIENTE LIKE '%40336%'
            FETCH FIRST 5 ROWS ONLY
        `, false);
        console.log(JSON.stringify(client, null, 2));
    } catch (e) {
        console.log('Error:', e.message);
    }

    // Check FOP table (Formas de Pago) with different approach
    console.log('\n=== Checking for Payment Terms Tables ===');
    try {
        const tables = await query(`
            SELECT TABLE_NAME
            FROM QSYS2.SYSTABLES
            WHERE TABLE_SCHEMA = 'DSEDAC'
            AND (TABLE_NAME LIKE '%FOP%' OR TABLE_NAME LIKE '%PAGO%' OR TABLE_NAME LIKE '%FORMA%')
        `, false);
        console.log('Payment tables:', tables.map(t => t.TABLE_NAME).join(', '));
    } catch (e) {
        console.log('Error:', e.message);
    }

    // Check sample albaranes for client 40336 to verify totals
    console.log('\n=== Albaran #5 Line Items vs Total ===');
    try {
        const header = await query(`
            SELECT NUMEROALBARAN, SERIEALBARAN, TERMINALALBARAN, IMPORTETOTAL, CODIGOCLIENTEFACTURA
            FROM DSEDAC.CAC
            WHERE NUMEROALBARAN = 5 AND EJERCICIOALBARAN = 2026 AND SERIEALBARAN = 'S'
            FETCH FIRST 5 ROWS ONLY
        `, false);
        console.log('Headers:', JSON.stringify(header, null, 2));

        for (const h of header.slice(0, 3)) {
            const lines = await query(`
                SELECT SUM(IMPORTEVENTA) as TOTAL_LINEAS
                FROM DSEDAC.LAC
                WHERE NUMEROALBARAN = ${h.NUMEROALBARAN} 
                AND SERIEALBARAN = '${h.SERIEALBARAN}'
                AND TERMINALALBARAN = ${h.TERMINALALBARAN}
                AND EJERCICIOALBARAN = 2026
            `, false);
            console.log(`Terminal ${h.TERMINALALBARAN}: Header=${h.IMPORTETOTAL}, Lines=${lines[0]?.TOTAL_LINEAS}`);
        }
    } catch (e) {
        console.log('Error:', e.message);
    }

    process.exit();
}

checkPaymentFields();
