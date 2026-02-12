/**
 * Quick check: LACLAE column mapping for article code
 */
const odbc = require('odbc');

async function main() {
    const pool = await odbc.pool('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');

    // Check key columns to find article code
    const rows = await pool.query(`
        SELECT
            TRIM(LCCDCL) as CLIENTE,
            TRIM(LCCDFA) as CDFA,
            TRIM(LCCDCD) as CDCD,
            TRIM(LCCDPR) as CDPR,
            TRIM(LCDESC) as DESCRIPCION,
            LCIMVT as VENTA
        FROM DSED.LACLAE
        WHERE LCAADC = 2026 AND LCMMDC = 2
        FETCH FIRST 5 ROWS ONLY
    `);

    console.log('LACLAE sample rows:');
    rows.forEach(r => console.log(JSON.stringify(r)));

    // Check if LAC has LCIMVT (net sales without IVA)
    try {
        const lacRows = await pool.query(`
            SELECT
                TRIM(CODIGOARTICULO) as ARTICULO,
                IMPORTEVENTA as VENTA_IVA,
                LCIMVT as VENTA_NETA,
                IMPORTECOSTO as COSTO
            FROM DSEDAC.LAC
            WHERE ANODOCUMENTO = 2026 AND MESDOCUMENTO = 2
            FETCH FIRST 3 ROWS ONLY
        `);
        console.log('\nLAC has LCIMVT column:');
        lacRows.forEach(r => console.log(JSON.stringify(r)));
    } catch (e) {
        console.log('\nLAC does NOT have LCIMVT:', e.message);

        // Try alternative: IMPORTEBASE
        try {
            const lac2 = await pool.query(`
                SELECT
                    TRIM(CODIGOARTICULO) as ARTICULO,
                    IMPORTEVENTA as VENTA_IVA,
                    IMPORTECOSTO as COSTO
                FROM DSEDAC.LAC
                WHERE ANODOCUMENTO = 2026 AND MESDOCUMENTO = 2
                FETCH FIRST 3 ROWS ONLY
            `);
            console.log('\nLAC with IMPORTEVENTA and IMPORTECOSTO:');
            lac2.forEach(r => console.log(JSON.stringify(r)));
        } catch (e2) {
            console.log('LAC basic query error:', e2.message);
        }
    }

    await pool.close();
}

main().catch(e => console.error(e.message));
