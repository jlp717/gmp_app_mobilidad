const odbc = require('odbc');

async function checkClient() {
    const connectionString = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

    try {
        const conn = await odbc.connect(connectionString);
        console.log('Connected to DB');

        // Check specific client columns
        const query = `
      SELECT CODIGO, NOMBRE, NOMBREALTERNATIVO, DIRECCION, LATITUD, LONGITUD 
      FROM DSEDAC.CLI 
      WHERE CODIGO = '4300000000'
    `;

        console.log('Running query:', query);
        const result = await conn.query(query);

        console.log('Result:', JSON.stringify(result, null, 2));

        await conn.close();
    } catch (error) {
        console.error('Error:', error);
    }
}

checkClient();
