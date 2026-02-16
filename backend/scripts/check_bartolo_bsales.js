const { query } = require('../config/db');

async function main() {
    console.log('--- CHECKING B-SALES FOR BARTOLO (02) ---');
    const rows = await query(`
        SELECT EJERCICIO, MES, IMPORTE 
        FROM JAVIER.VENTAS_B
        WHERE CODIGOVENDEDOR = '02' OR CODIGOVENDEDOR = '2'
        ORDER BY EJERCICIO, MES
    `, false);

    if (rows.length === 0) {
        console.log('No B-sales found for Bartolo.');
    } else {
        console.table(rows);
    }
    process.exit();
}

main();
