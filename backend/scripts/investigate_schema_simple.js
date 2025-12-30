const odbc = require('odbc');

async function main() {
    console.log('Obteniendo columnas de LAC y CAC (simple query)...');
    try {
        const conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');

        // Solo fetching 1 row es lo mas rapido para ver columnas
        try {
            const lac = await conn.query('SELECT * FROM DSEDAC.LAC FETCH FIRST 1 ROWS ONLY');
            if (lac.length > 0) {
                console.log('COLUMNAS LAC:', Object.keys(lac[0]).join(', '));
            }
        } catch (e) { console.log('Error LAC:', e.message); }

        try {
            const cac = await conn.query('SELECT * FROM DSEDAC.CAC FETCH FIRST 1 ROWS ONLY');
            if (cac.length > 0) {
                console.log('COLUMNAS CAC:', Object.keys(cac[0]).join(', '));
            }
        } catch (e) { console.log('Error CAC:', e.message); }

        await conn.close();
    } catch (e) {
        console.error(e);
    }
}
main();
