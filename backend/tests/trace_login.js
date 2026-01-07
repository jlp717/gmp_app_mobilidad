const { initDb, query, queryWithParams } = require('../config/db');
require('dotenv').config();

async function run() {
    await initDb();

    // Inputs to test
    const inputs = ['93', 'MARI CARMEN (TLV)', 'MARICARMEN', 'A1'];

    for (const input of inputs) {
        console.log(`\n==============================================`);
        console.log(`🔎 TRACING LOGIN FOR: "${input}"`);
        console.log(`==============================================`);

        try {
            // 1. Sanitize (simulating UPDATED auth.js)
            const safeUser = input.replace(/[^a-zA-Z0-9 .-_]/g, '').trim().toUpperCase();
            console.log(`[Sanitized]: '${safeUser}'`);

            // 2. Main User Query
            console.log(`[Step 2] Querying APPUSUARIOS...`);
            let users = await queryWithParams(`
                SELECT ID, CODIGOUSUARIO, NOMBREUSUARIO, PASSWORD, SUBEMPRESA 
                FROM DSEDAC.APPUSUARIOS
                WHERE UPPER(TRIM(CODIGOUSUARIO)) = ?
                  AND SUBEMPRESA = 'GMP'
                FETCH FIRST 1 ROWS ONLY
            `, [safeUser], false);
            console.log(`   -> Found: ${users.length}`);

            if (users.length === 0) {
                console.log(`[Step 2b] Fallback: Look up Vendor by Code to find AppUser assignment...`);

                // This query was in auth.js lines 98+
                // Check if it crashes
                const vendorLookup = await query(`
                    SELECT X.CORREOELECTRONICO 
                    FROM DSEDAC.VDC V
                    JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
                    WHERE V.SUBEMPRESA = 'GMP' AND TRIM(V.CODIGOVENDEDOR) = '${safeUser}'
                    FETCH FIRST 1 ROWS ONLY
                `, false);
                console.log(`   -> VendorLookup Found: ${vendorLookup.length}`);

                if (vendorLookup.length > 0) {
                    const email = vendorLookup[0].CORREOELECTRONICO;
                    console.log(`   -> Email: ${email}`);
                    const namePattern = (email || '').trim().substring(0, 5);
                    if (namePattern.length >= 3) {
                        const safePattern = namePattern.replace(/'/g, "''");
                        console.log(`   -> Searching AppUser with LIKE '%${safePattern}%'...`);

                        users = await query(`
                             SELECT ID, CODIGOUSUARIO, NOMBREUSUARIO 
                             FROM DSEDAC.APPUSUARIOS 
                             WHERE UPPER(NOMBREUSUARIO) LIKE '%${safePattern}%'
                               AND SUBEMPRESA = 'GMP'
                         `, false);
                        console.log(`   -> Users found by pattern: ${users.length}`);
                    }
                }
            }

            // 3. Direct Vendor Check (Fallback C I added)
            if (users.length === 0) {
                console.log(`[Step 3] Direct Vendor Check...`);
                // Using Parameterized query in auth.js
                // ... AND TRIM(V.CODIGOVENDEDOR) = ?

                const directSql = `
                SELECT V.CODIGOVENDEDOR, V.TIPOVENDEDOR, X.JEFEVENTASSN, P.CODIGOPIN
                FROM DSEDAC.VDC V
                LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
                LEFT JOIN DSEDAC.VDPL1 P ON V.CODIGOVENDEDOR = P.CODIGOVENDEDOR
                WHERE V.SUBEMPRESA = 'GMP' AND TRIM(V.CODIGOVENDEDOR) = '${safeUser}'
                FETCH FIRST 1 ROWS ONLY
                `;
                console.log(`   -> Executing: ${directSql.replace(/\s+/g, ' ').substring(0, 100)}...`);

                const directVendorCheck = await query(directSql, false);
                console.log(`   -> Direct Found: ${directVendorCheck.length}`);
            }

        } catch (e) {
            console.error(`❌ CRASHED: ${e.message}`);
            if (e.odbcErrors) console.error(e.odbcErrors);
        }
    }
    process.exit(0);
}

run();
