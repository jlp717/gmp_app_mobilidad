require('dotenv').config();
const { initDb, query } = require('../config/db');

async function checkRuteroData() {
    try {
        await initDb();
        
        // Ver algunos registros de RUTERO_CONFIG para el vendedor 81
        console.log('\n=== Registros RUTERO_CONFIG vendedor 81 ===\n');
        
        const rows = await query(`
            SELECT VENDEDOR, DIA, CLIENTE, ORDEN 
            FROM JAVIER.RUTERO_CONFIG 
            WHERE VENDEDOR = '81'
            ORDER BY DIA, ORDEN
            FETCH FIRST 30 ROWS ONLY
        `);
        
        rows.forEach(row => {
            console.log(`DIA: "${row.DIA}" | CLIENTE: ${row.CLIENTE} | ORDEN: ${row.ORDEN}`);
        });
        
        // Ver días únicos
        console.log('\n=== Días únicos ===\n');
        const dias = await query(`
            SELECT DISTINCT DIA FROM JAVIER.RUTERO_CONFIG WHERE VENDEDOR = '81'
        `);
        dias.forEach(d => console.log(`"${d.DIA}"`));
        
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkRuteroData();
