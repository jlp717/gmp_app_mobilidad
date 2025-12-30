const odbc = require('odbc');

async function checkDsemovil() {
    const connectionString = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

    try {
        const conn = await odbc.connect(connectionString);
        console.log('Connected to DB');

        // Check columns in DSEMOVIL.CLIENTES
        // fetch first 1 row to see column names and valid data
        const query = `
      SELECT * 
      FROM DSEMOVIL.CLIENTES 
      FETCH FIRST 1 ROWS ONLY
    `;

        console.log('Running query:', query);
        const result = await conn.query(query);

        if (result.length > 0) {
            console.log('Columns:', Object.keys(result[0]).join(', '));
            console.log('Sample Row:', JSON.stringify(result[0], null, 2));
        } else {
            console.log('No rows found in DSEMOVIL.CLIENTES');
        }

        await conn.close();
    } catch (error) {
        console.error('Error:', error);
    }
}

checkDsemovil();
