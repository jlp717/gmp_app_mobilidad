/**
 * Verificar campos de OPP
 */

const odbc = require('odbc');

async function main() {
    let connection;
    try {
        connection = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;TRANSLATE=1');
        console.log('Conectado a DB2\n');

        // Ver estructura de OPP
        const sqlCols = `
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM SYSIBM.COLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPP'
            ORDER BY ORDINAL_POSITION
        `;
        
        const cols = await connection.query(sqlCols);
        console.log('Columnas de OPP:');
        cols.forEach(c => {
            console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`);
        });

        // Ver una muestra de OPP para repartidor 79
        console.log('\n\nMuestra de OPP para repartidor 79:');
        const sqlSample = `
            SELECT *
            FROM DSEDAC.OPP
            WHERE TRIM(CODIGOREPARTIDOR) = '79'
              AND ANOREPARTO = 2026
            FETCH FIRST 2 ROWS ONLY
        `;
        
        const sample = await connection.query(sqlSample);
        sample.forEach((row, i) => {
            console.log(`\n[${i+1}]:`);
            Object.keys(row).forEach(k => {
                if (row[k] !== null && row[k] !== 0 && row[k] !== '') {
                    console.log(`   ${k}: ${row[k]}`);
                }
            });
        });

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (connection) await connection.close();
    }
}

main();
