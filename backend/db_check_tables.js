const fs = require('fs');
const { query } = require('./config/db');

async function checkRealTables() {
    let out = '';
    const tryQuery = async (title, sql) => {
        out += `\n--- ${title} ---\n`;
        try {
            const res = await query(sql);
            out += JSON.stringify(res, null, 2);
        } catch (err) {
            out += `ERROR: ${err.message}`;
        }
    };

    try {
        await tryQuery('GIOVA.V_DIM_VEHICULO', `SELECT * FROM GIOVA.V_DIM_VEHICULO FETCH FIRST 5 ROWS ONLY`);
        await tryQuery('JAVIER.V_DIM_VEHICULO', `SELECT * FROM JAVIER.V_DIM_VEHICULO FETCH FIRST 5 ROWS ONLY`);
        await tryQuery('DSEMOVIL.STOCKVEHIC', `SELECT * FROM DSEMOVIL.STOCKVEHIC FETCH FIRST 5 ROWS ONLY`);
        await tryQuery('DIEGO.CAMIONES', `SELECT * FROM DIEGO.CAMIONES FETCH FIRST 5 ROWS ONLY`);
        await tryQuery('TESTMOVIL.STOCKVEHIC', `SELECT * FROM TESTMOVIL.STOCKVEHIC FETCH FIRST 5 ROWS ONLY`);
        await tryQuery('DSTMOVIL.TRANSPORTI', `SELECT * FROM DSTMOVIL.TRANSPORTI FETCH FIRST 5 ROWS ONLY`);

        // Let's also check if there is ANY table with actual dimension columns (LARGO/ANCHO/ALTO) that isn't the one we created
        // Look at columns from previous search
        // We didn't see LARGO or ANCHO or ALTO in the first block, only CARGAMAXIMA and VOLUMEN.
        // Let's explicitly search for LARGO
        const colQuery = await query(`
        SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME 
        FROM QSYS2.SYSCOLUMNS 
        WHERE COLUMN_NAME LIKE '%LARGO%' OR COLUMN_NAME LIKE '%ANCHO%' OR COLUMN_NAME LIKE '%ALTO%'
          AND TABLE_SCHEMA NOT IN ('QSYS', 'QSYS2', 'SYSIBM')
        FETCH FIRST 20 ROWS ONLY
    `);
        out += `\n--- COLUMNS WITH LARGO/ANCHO/ALTO ---\n` + JSON.stringify(colQuery, null, 2);

        fs.writeFileSync('tables_explore.txt', out);
        console.log('Results written to tables_explore.txt');
        process.exit(0);
    } catch (err) {
        console.error('DB ERROR:', err);
        process.exit(1);
    }
}

setTimeout(checkRealTables, 1500);
