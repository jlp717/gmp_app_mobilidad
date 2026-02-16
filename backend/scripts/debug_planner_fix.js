require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');

async function testQueries() {
    console.log("=== TESTING COMMERCIALS QUERY ===");
    try {
        // Attempt 1: Current code (ORDER BY 1)
        const sql1 = `
            SELECT TRIM(CODIGOVENDEDOR) as code, NOMBREVENDEDOR as name
            FROM DSEDAC.VDD 
            WHERE ACTIVO = 'S'
            ORDER BY 1
            FETCH FIRST 5 ROWS ONLY
        `;
        const res1 = await query(sql1, false);
        console.log("✅ ORDER BY 1 (Commercials): Success");
        console.log(res1);
    } catch (e) {
        console.error("❌ ORDER BY 1 (Commercials): Failed", e.message);
    }

    console.log("\n=== TESTING REPARTIDORES QUERY ===");
    try {
        // Attempt 1: Current code (ORDER BY 1)
        const sql2 = `
            SELECT TRIM(CODIGOREPARTIDOR) as code, NOMBREREPARTIDOR as name
            FROM DSEDAC.REP
            ORDER BY 1
            FETCH FIRST 5 ROWS ONLY
        `;
        const res2 = await query(sql2, false);
        console.log("✅ ORDER BY 1 (Repartidores): Success");
        console.log(res2);
    } catch (e) {
        console.error("❌ ORDER BY 1 (Repartidores): Failed", e.message);
    }

    console.log("\n=== TESTING ALTERNATIVES ===");
    try {
        // Attempt 2: ORDER BY Column Name
        const sql3 = `
            SELECT TRIM(CODIGOVENDEDOR) as code, NOMBREVENDEDOR as name
            FROM DSEDAC.VDD 
            WHERE ACTIVO = 'S'
            ORDER BY NOMBREVENDEDOR
            FETCH FIRST 5 ROWS ONLY
        `;
        const res3 = await query(sql3, false);
        console.log("✅ ORDER BY NAME: Success");
        console.log("Keys:", Object.keys(res3[0]));
    } catch (e) {
        console.error("❌ ORDER BY NAME: Failed", e.message);
    }
}

testQueries();
