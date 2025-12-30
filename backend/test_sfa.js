
const odbc = require('odbc');
require('dotenv').config();

async function testSFA() {
    let connection;
    try {
        const connectionString = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';
        connection = await odbc.connect(connectionString);

        console.log("Connected. Testing families query...");
        const fam = await connection.query("SELECT * FROM DSEDAC.FAM FETCH FIRST 1 ROWS ONLY");
        console.log("FAM columns:", fam.columns.map(c => c.name));
        console.log("Testing DSEDAC.SFC query...");
        try {
            const sfa = await connection.query("SELECT * FROM DSEDAC.SFC FETCH FIRST 1 ROWS ONLY");
            console.log("SFC columns:", sfa.columns.map(c => c.name));
        } catch (e) {
            console.error("SFC Query failed:", e.message);
        }

        console.log("Listing ALL DSEDAC tables...");
        try {
            const tables = await connection.query("SELECT TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = 'DSEDAC'");
            console.log("Tables found:", tables.map(r => r.TABLE_NAME).filter(n => n.includes('SF') || n.includes('SUB') || n.includes('FAM')));
        } catch (e) {
            console.error("Meta query failed:", e.message);
        }
    } catch (error) {
        console.error("Connection error:", error);
    } finally {
        if (connection) await connection.close();
    }
}

testSFA();
