const axios = require('axios');

async function test() {
    const repartidorId = '21,39,41,43,44,53,66,67,74,79,84,85,87,89,98';
    const baseUrl = 'http://localhost:3334/api'; // Assuming server is running locally on 3334

    console.log(`Testing API: ${baseUrl}/repartidor/history/clients/${repartidorId}`);

    try {
        const response = await axios.get(`${baseUrl}/repartidor/history/clients/${encodeURIComponent(repartidorId)}`, {
            headers: {
                'Authorization': 'Bearer YOUR_TOKEN_HERE' // This might be needed if verifyToken is checking it
            }
        });

        console.log("Success:", response.data.success);
        console.log("Clients count:", response.data.clients?.length);
        if (response.data.clients?.length > 0) {
            console.table(response.data.clients.slice(0, 5));
        }
    } catch (e) {
        console.error("API Error:", e.response?.data || e.message);
    }
}

// Note: This script assumes the server is running.
// If not, I can't test the actual API endpoint, only the SQL.
console.log("SIMULATING API LOGIC LOCALLY...");
const { query } = require('../config/db');
const moment = require('moment');

async function simulate() {
    const repartidorId = '21,39,41,43,44,53,66,67,74,79,84,85,87,89,98';
    const cleanRepartidorId = repartidorId.split(',').map(id => `'${id.trim()}'`).join(',');
    const dateLimit = moment().subtract(6, 'months').format('YYYYMMDD');

    let sql = `
            SELECT DISTINCT
                TRIM(CPC.CODIGOCLIENTEALBARAN) as ID,
                TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NAME,
                TRIM(COALESCE(CLI.DIRECCION, '')) as ADDRESS,
                COUNT(CPC.NUMEROALBARAN) as TOTAL_DOCS
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
                ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            LEFT JOIN DSEDAC.CLI CLI 
                ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
            WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) >= ${dateLimit}
              AND TRIM(OPP.CODIGOREPARTIDOR) IN (${cleanRepartidorId})
            GROUP BY TRIM(CPC.CODIGOCLIENTEALBARAN), TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')), TRIM(COALESCE(CLI.DIRECCION, ''))
            ORDER BY NAME FETCH FIRST 50 ROWS ONLY
        `;

    const rows = await query(sql, false);
    console.log(`Found ${rows.length} rows.`);
    const clients = rows.map(r => ({
        id: (r.ID || '').trim(),
        name: (r.NAME || '').trim() || `CLIENTE ${r.ID}`,
        address: (r.ADDRESS || '').trim(),
        totalDocuments: r.TOTAL_DOCS || 0
    }));
    console.table(clients.slice(0, 5));
}

simulate();
