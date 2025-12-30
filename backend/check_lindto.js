const odbc = require('odbc');
const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function main() {
    const conn = await odbc.connect(CONNECTION_STRING);
    try {
        // Check columns of LINDTO
        const cols = await conn.query(`
      SELECT COLUMN_NAME 
      FROM SYSIBM.COLUMNS 
      WHERE TABLE_NAME = 'LINDTO' AND TABLE_SCHEMA = 'DSEDAC'
    `);
        const colNames = cols.map(c => c.COLUMN_NAME);
        console.log('LINDTO Columns:', colNames.join(', '));

        const checkCols = ['LCSRAB', 'LCTPVT', 'LCSBAB', 'LCYEAB', 'LCTRAB', 'LCNRAB']; // Same link keys as LAC?
        const found = checkCols.filter(c => colNames.includes(c));
        console.log('Found Link Keys:', found.join(', '));

        if (colNames.includes('LCTPVT')) {
            const sc = await conn.query(`SELECT COUNT(*) as CNT FROM DSEDAC.LINDTO WHERE LCTPVT = 'SC'`);
            console.log('SC count in LINDTO:', sc[0].CNT);
        }

    } catch (e) { console.error(e); } finally { await conn.close(); }
}
main();
