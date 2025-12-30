const odbc = require('odbc');

async function test() {
    const connectionString = "DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;";
    try {
        const conn = await odbc.connect(connectionString);

        // 1. Check raw columns from ART by selecting 1 row
        console.log("--- ART Sample Row (Keys) ---");
        const sample = await conn.query(`SELECT * FROM DSEDAC.ART FETCH FIRST 1 ROWS ONLY`);
        if (sample.length > 0) {
            console.log("ART Keys:", Object.keys(sample[0]).filter(k => k.includes('FAM') || k.includes('SUB')));
        }

        // 2. Check SFM table directly
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
