const odbc = require('odbc');
const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
};

const log = (color, msg) => console.log(`${color}${msg}${colors.reset}`);

async function runDiagnostics() {
    log(colors.cyan, '\n==========================================');
    log(colors.cyan, '       GMP SERVER DIAGNOSTICS TOOL        ');
    log(colors.cyan, '==========================================\n');

    // 1. Check Node Environment & Files
    log(colors.yellow, '1. CHECKING FILE INTEGRITY...');

    // Check auth.js for the missing variable
    try {
        const authPath = path.join(__dirname, '../routes/auth.js');
        if (fs.existsSync(authPath)) {
            const content = fs.readFileSync(authPath, 'utf8');
            if (content.includes('const authenticateToken = require')) {
                log(colors.green, '✅ auth.js contains "authenticateToken" declaration.');
            } else {
                log(colors.red, '❌ auth.js is MISSING "authenticateToken" declaration!');
            }
        } else {
            log(colors.red, '❌ routes/auth.js file NOT FOUND!');
        }
    } catch (e) {
        log(colors.red, `❌ Error reading files: ${e.message}`);
    }

    // 2. Check Database Connection
    log(colors.yellow, '\n2. CHECKING DATABASE CONNECTION...');

    // Load ENV override if needed (simple approximation)
    const DB_UID = process.env.ODBC_UID || 'JAVIER'; // Default per db.js
    const DB_PWD = process.env.ODBC_PWD || 'JAVIER';
    const DB_DSN = process.env.ODBC_DSN || 'GMP';

    const connectionString = `DSN=${DB_DSN};UID=${DB_UID};PWD=${DB_PWD};NAM=1;`;
    log(colors.magenta, `Connecting with: DSN=${DB_DSN}; UID=${DB_UID} (PWD hidden)`);

    try {
        const connection = await odbc.connect(connectionString);
        log(colors.green, '✅ ODBC Connection ESTABLISHED successfully.');

        // 3. Test Queries
        log(colors.yellow, '\n3. TESTING QUERIES...');

        // Test 1: Simple Select
        try {
            const result = await connection.query('SELECT 1 as val FROM SYSIBM.SYSDUMMY1');
            log(colors.green, `✅ Basic SELECT passed: ${JSON.stringify(result)}`);
        } catch (err) {
            log(colors.red, `❌ Basic SELECT failed: ${err.message}`);
            log(colors.red, `   ODBC Error Code: ${err.odbcErrors && err.odbcErrors[0] ? err.odbcErrors[0].code : 'Unknown'}`);
            log(colors.red, `   ODBC State: ${err.odbcErrors && err.odbcErrors[0] ? err.odbcErrors[0].state : 'Unknown'}`);
        }

        // Test 2: Table Existence (VDC)
        try {
            const result = await connection.query("SELECT count(*) as count FROM DSEDAC.VDC WHERE SUBEMPRESA = 'GMP'");
            log(colors.green, `✅ Table DSEDAC.VDC access passed. Row count: ${result[0].COUNT}`);
        } catch (err) {
            log(colors.red, `❌ Table DSEDAC.VDC access failed: ${err.message}`);
        }

        // Test 3: Table Existence (VDDX) - Suspected issue
        try {
            const result = await connection.query("SELECT count(*) as count FROM DSEDAC.VDDX FETCH FIRST 1 ROWS ONLY");
            log(colors.green, `✅ Table DSEDAC.VDDX access passed (Optional for Login).`);
        } catch (err) {
            log(colors.yellow, `⚠️ Table DSEDAC.VDDX access failed (Might not exist, this is OK if login handles it): ${err.message}`);
        }

        await connection.close();

    } catch (error) {
        log(colors.red, '❌ CRITICAL: Could not connect to Database!');
        log(colors.red, `   Error: ${error.message}`);
        if (error.odbcErrors) {
            error.odbcErrors.forEach(err => {
                log(colors.red, `   [ODBC] Code: ${err.code}, State: ${err.state}, Msg: ${err.message}`);
            });
        }
    }

    log(colors.cyan, '\n==========================================');
    log(colors.cyan, '           DIAGNOSTICS COMPLETE           ');
    log(colors.cyan, '==========================================\n');
}

runDiagnostics();
