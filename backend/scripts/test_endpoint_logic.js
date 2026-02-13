require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');
const fs = require('fs');

async function testEndpointLogic() {
    try {
        // 1. Find a valid ID
        const headerSql = `
            SELECT CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN, CPC.TERMINALALBARAN, CPC.NUMEROALBARAN
            FROM DSEDAC.CPC CPC
            JOIN DSEDAC.CACFIRMAS CF ON 
                CF.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND
                CF.SERIEALBARAN = CPC.SERIEALBARAN AND
                CF.TERMINALALBARAN = CPC.TERMINALALBARAN AND
                CF.NUMEROALBARAN = CPC.NUMEROALBARAN
            WHERE CPC.NUMEROALBARAN > 0
              AND LENGTH(CF.FIRMABASE64) > 100
            FETCH FIRST 1 ROWS ONLY
        `;
        const headers = await query(headerSql, false);
        if (headers.length === 0) return console.log('No legacy data to test');

        const h = headers[0];
        const id = `${h.EJERCICIOALBARAN}-${h.SERIEALBARAN.trim()}-${h.TERMINALALBARAN}-${h.NUMEROALBARAN}`;
        console.log('Testing ID:', id);

        // 2. Simulate Endpoint Logic
        const sql = `
            SELECT FIRMABASE64
            FROM DSEDAC.CACFIRMAS
            WHERE EJERCICIOALBARAN = ${h.EJERCICIOALBARAN}
              AND SERIEALBARAN = '${h.SERIEALBARAN}'
              AND TERMINALALBARAN = ${h.TERMINALALBARAN}
              AND NUMEROALBARAN = ${h.NUMEROALBARAN}
        `;
        const rows = await query(sql, false);
        const base64Len = rows[0].FIRMABASE64.length;
        console.log('Got Base64 length:', base64Len);

        if (base64Len > 100) {
            console.log('SUCCESS: Data looks like an image');
        } else {
            console.log('WARNING: Data too short');
        }

    } catch (e) {
        console.error(e);
    }
}

testEndpointLogic();
