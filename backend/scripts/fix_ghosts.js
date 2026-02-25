const { query, getPool } = require('../config/db');
const { getClientsForDay } = require('../services/laclae');
const logger = require('../middleware/logger');

const DAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

async function fixGhostClients() {
    console.log("🔍 Scanning for vendors with customized routes to retroactively apply ORDEN = -1 to missing clients...");
    let pool;
    let totalFixed = 0;

    try {
        pool = getPool();

        // Find all days that have been customized by any vendor
        const customizedDays = await query(`
            SELECT DISTINCT VENDEDOR, TRIM(DIA) as DIA
            FROM JAVIER.RUTERO_CONFIG
            WHERE ORDEN >= 0
        `, false);

        console.log(`✅ Found ${customizedDays.length} uniquely customized vendor-day pairs.`);

        for (const { VENDEDOR, DIA } of customizedDays) {
            const dayLower = DIA.toLowerCase();

            // 1. Get the clients they EXPLICTLY SAVED (ORDEN >= 0)
            const savedRes = await query(`
                SELECT TRIM(CLIENTE) as CLIENTE
                FROM JAVIER.RUTERO_CONFIG
                WHERE VENDEDOR = '${VENDEDOR}' AND DIA = '${dayLower}' AND ORDEN >= 0
            `, false);
            const savedClients = new Set(savedRes.map(r => r.CLIENTE));

            // 2. Get the clients that ALREADY have ORDEN = -1
            const blockedRes = await query(`
                SELECT TRIM(CLIENTE) as CLIENTE
                FROM JAVIER.RUTERO_CONFIG
                WHERE VENDEDOR = '${VENDEDOR}' AND DIA = '${dayLower}' AND ORDEN = -1
            `, false);
            const blockedClients = new Set(blockedRes.map(r => r.CLIENTE));

            // 3. Get the original NATURAL clients for this vendor and day
            // We use the AS400 direct query to avoid cache issues
            const naturalRes = await query(`
                SELECT DISTINCT TRIM(L.LCCDCL) as CLIENTE
                FROM DSED.LACLAE L
                JOIN DSEDAC.CLI C ON L.LCCDCL = C.CODIGOCLIENTE
                WHERE L.R1_T8CDVD = '${VENDEDOR}' 
                  AND L.LCAADC = 2026
                  AND (C.ANOBAJA = 0 OR C.ANOBAJA IS NULL)
                  AND L.R1_T8DIV${dayLower === 'miercoles' ? 'X' : dayLower.charAt(0).toUpperCase()} = 'S'
            `, false);

            let missingClients = 0;

            // If the natural client is NOT in the saved customized list, AND NOT already blocked, it's a ghost!
            for (const nat of naturalRes) {
                const client = nat.CLIENTE;
                if (!savedClients.has(client) && !blockedClients.has(client)) {
                    // It's a ghost! Insert ORDEN = -1
                    await query(`
                        INSERT INTO JAVIER.RUTERO_CONFIG (VENDEDOR, DIA, CLIENTE, ORDEN)
                        VALUES ('${VENDEDOR}', '${dayLower}', '${client}', -1)
                    `);
                    missingClients++;
                    totalFixed++;
                }
            }

            if (missingClients > 0) {
                console.log(`✅ Fixed ${missingClients} ghost clients for Vendedor ${VENDEDOR} on ${dayLower}`);
            }
        }

        console.log(`\n🎉 Retroactive cleanup complete! Inserted ${totalFixed} ORDEN = -1 records.`);

    } catch (e) {
        console.error("❌ DB Query Error:", e);
    } finally {
        if (pool) await pool.close();
        process.exit(0);
    }
}

fixGhostClients();
