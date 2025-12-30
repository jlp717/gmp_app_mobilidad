const odbc = require('odbc');

async function checkLac() {
    const connectionString = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

    try {
        const conn = await odbc.connect(connectionString);
        console.log('Connected to DB');

        // Check columns in DSEDAC.LAC
        const query = `
      SELECT * 
      FROM DSEDAC.LAC 
      FETCH FIRST 1 ROWS ONLY
    `;

        console.log('Running query:', query);
        const result = await conn.query(query);

        if (result.length > 0) {
            console.log('Columns:', Object.keys(result[0]).join(', '));
        } else {
            console.log('No rows found in DSEDAC.LAC');
        }

        await conn.close();
    } catch (error) {
        console.error('Error:', error);
    }
}

checkLac();
