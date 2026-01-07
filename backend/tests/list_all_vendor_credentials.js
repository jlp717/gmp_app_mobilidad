const { initDb, query } = require('../config/db');
require('dotenv').config();

async function run() {
    await initDb();

    console.log('\n🔍 Generating FULL VENDOR CREDENTIAL LIST...');
    console.log('Querying real data from DSEDAC.VDC (Vendors) and DSEDAC.VDPL1 (PINs)...\n');

    // Query to get Code, Name (from VDC) and PIN (from VDPL1)
    // We also look for a matching APP USER name if possible, just for completeness, but Vendor Name is primary.
    // The user asked for "Alternative Code with Name", which usually means the Vendor Name.

    const sql = `
        SELECT 
            V.CODIGOVENDEDOR as CODE, 
            TRIM(D.NOMBREVENDEDOR) as NAME,
            P.CODIGOPIN as PIN
        FROM DSEDAC.VDC V
        JOIN DSEDAC.VDD D ON V.CODIGOVENDEDOR = D.CODIGOVENDEDOR
        JOIN DSEDAC.VDPL1 P ON V.CODIGOVENDEDOR = P.CODIGOVENDEDOR
        WHERE V.SUBEMPRESA = 'GMP'
        ORDER BY V.CODIGOVENDEDOR
    `;

    try {
        const rows = await query(sql);

        console.log(`Found ${rows.length} vendors with credentials.`);
        console.log('');
        console.log('| CÓDIGO | CONTRASEÑA (PIN) | NOMBRE VENDEDOR / USUARIO |');
        console.log('| :----- | :--------------- | :------------------------ |');

        rows.forEach(r => {
            const code = r.CODE.trim();
            const pin = r.PIN ? r.PIN.toString().trim() : 'SIN PIN';
            const name = r.NAME ? r.NAME.trim() : 'DESCONOCIDO';

            // Format as Markdown table row for easier copy-paste to user
            console.log(`| **${code}** | **${pin}** | ${name} |`);
        });

        console.log('');

    } catch (e) {
        console.error("Error generating list", e);
    }
    process.exit(0);
}

run();
