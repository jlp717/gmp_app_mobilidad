require('dotenv').config();
const { initDb, query } = require('../config/db');

async function checkCLIColumns() {
    try {
        await initDb();
        console.log('\n=== Columnas de DSEDAC.CLI ===\n');
        
        // DB2 for i usa QSYS2.SYSCOLUMNS
        const result = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH 
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_NAME = 'CLI' AND TABLE_SCHEMA = 'DSEDAC' 
            ORDER BY ORDINAL_POSITION
        `);
        
        result.forEach(col => {
            console.log(`${(col.COLUMN_NAME || '').padEnd(30)} ${(col.DATA_TYPE || '').padEnd(15)} ${col.LENGTH || ''}`);
        });
        
        // Buscar columnas con TELEFONO o EMAIL
        console.log('\n=== Columnas con TELEFONO o EMAIL ===\n');
        const phoneEmail = result.filter(c => 
            (c.COLUMN_NAME || '').includes('TELEFONO') || 
            (c.COLUMN_NAME || '').includes('PHONE') || 
            (c.COLUMN_NAME || '').includes('EMAIL') ||
            (c.COLUMN_NAME || '').includes('MAIL')
        );
        phoneEmail.forEach(col => {
            console.log(`${(col.COLUMN_NAME || '').padEnd(30)} ${(col.DATA_TYPE || '').padEnd(15)} ${col.LENGTH || ''}`);
        });
        
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

checkCLIColumns();
