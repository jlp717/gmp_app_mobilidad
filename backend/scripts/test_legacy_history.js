require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');
const axios = require('axios');

async function testLegacyHistory() {
    try {
        console.log('Testing History Endpoint for Legacy Signatures...');
        // We need a client that has signatures in CACFIRMAS.
        // Let's first find one.
        const headerSql = `
            SELECT FIRST 1 CODIGOCLIENTEALBARAN 
            FROM DSEDAC.CPC CPC
            JOIN DSEDAC.CACFIRMAS CF ON 
                CF.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND
                CF.SERIEALBARAN = CPC.SERIEALBARAN AND
                CF.TERMINALALBARAN = CPC.TERMINALALBARAN AND
                CF.NUMEROALBARAN = CPC.NUMEROALBARAN
        `;
        const headers = await query(headerSql, false);
        if (headers.length === 0) {
            console.log('No legacy signatures found to test.');
            return;
        }
        const clientId = headers[0].CODIGOCLIENTEALBARAN.trim();
        console.log('Found client with legacy signature:', clientId);

        // Call the endpoint (simulation)
        // Since we can't easily curl localhost from here if auth is needed, 
        // we will simulate the SQL query logic instead to verify mapping.

        const testSql = `
            SELECT 
                CPC.NUMEROALBARAN,
                COALESCE(LS.FIRMANOMBRE, '') as LEGACY_FIRMA_NOMBRE
            FROM DSEDAC.CPC CPC
            LEFT JOIN DSEDAC.CACFIRMAS LS ON
                LS.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND
                LS.SERIEALBARAN = CPC.SERIEALBARAN AND
                LS.TERMINALALBARAN = CPC.TERMINALALBARAN AND
                LS.NUMEROALBARAN = CPC.NUMEROALBARAN
            WHERE CPC.CODIGOCLIENTEALBARAN = '${clientId}'
            AND LS.FIRMANOMBRE IS NOT NULL
            FETCH FIRST 5 ROWS ONLY
        `;
        const rows = await query(testSql, false);
        console.log('Legacy Signature Data:', JSON.stringify(rows, null, 2));

    } catch (e) {
        console.error(e);
    }
}

testLegacyHistory();
