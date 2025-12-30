const odbc = require('odbc');

async function test() {
    const connectionString = "DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;";
    try {
        const conn = await odbc.connect(connectionString);

        // 1. Check columns in ART that might be Subfamily
        console.log("--- ART Columns matching 'FAM' ---");
        const cols = await conn.query(`
      SELECT COLUMN_NAME, TYPE_NAME, COLUMN_SIZE 
      FROM QSYS2.SYSCOLUMNS 
      WHERE TABLE_NAME = 'ART' AND TABLE_SCHEMA = 'DSEDAC' 
      AND COLUMN_NAME LIKE '%FAM%'
    `);
        console.log(cols);

        // 2. Check sample data from ART for those columns
        console.log("\n--- Sample Data from ART ---");
        const sample = await conn.query(`
      SELECT CODIGOARTICULO, CODIGOFAMILIA, CODIGOSUBFAMILIA, DESCRIPCIONARTICULO 
      FROM DSEDAC.ART 
      FETCH FIRST 10 ROWS ONLY
    `);
        console.log(sample);

        // 3. Check if SFM table exists and has data (double check)
        console.log("\n--- SFM Table Check ---");
        try {
            const sfmCount = await conn.query(`SELECT COUNT(*) as CNT FROM DSEDAC.SFM`);
            console.log("SFM Count:", sfmCount[0].CNT);

            const sfmSample = await conn.query(`SELECT * FROM DSEDAC.SFM FETCH FIRST 5 ROWS ONLY`);
            console.log("SFM Sample:", sfmSample);
        } catch (e) {
            console.log("Error querying SFM:", e.message);
        }

        await conn.close();
    } catch (err) {
        console.error('Error:', err);
    }
}

test();
