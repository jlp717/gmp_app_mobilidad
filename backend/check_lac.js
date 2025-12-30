const odbc = require('odbc');
const winston = require('winston');

// Logger configuration
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()],
});

// ODBC Connection String
const connectionString = "DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;";

async function checkLacColumns() {
    let connection;
    try {
        logger.info("Connecting to DB2...");
        connection = await odbc.connect(connectionString);
        logger.info("Connected!");

        // Get columns for DSEDAC.LAC
        logger.info("Fetching columns for DSEDAC.LAC...");
        const columns = await connection.columns(null, 'DSEDAC', 'LAC', null);

        logger.info(`Found ${columns.length} columns.`);

        // Log all column names
        const colNames = columns.map(c => c.COLUMN_NAME).sort();
        console.log("Columns:", colNames.join(', '));

        // Check specific columns we are interested in
        const checkCols = ['IMPORTECOSTO', 'IMPORTEMARGENREAL', 'DIADOCUMENTO', 'TRAZABILIDADALBARAN', 'REFERENCIA', 'PRECIOVENTA'];
        console.log("\nSpecific checks:");
        checkCols.forEach(col => {
            const exists = colNames.includes(col);
            console.log(`- ${col}: ${exists ? '✅ YES' : '❌ NO'}`);
        });

    } catch (error) {
        logger.error("Error:", error);
    } finally {
        if (connection) {
            await connection.close();
        }
    }
}

checkLacColumns();
