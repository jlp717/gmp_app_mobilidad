/**
 * Debug CPC join and week calculation
 */
const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function debug() {
    console.log('='.repeat(60));
    console.log('DEBUGGING CPC JOIN AND WEEK CALCULATION');
    console.log('='.repeat(60));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. Check CPC columns - what's the client key column?
        console.log('\n1. CPC TABLE COLUMNS:');
        console.log('-'.repeat(50));

        const cpcCols = await conn.query(`
      SELECT COLUMN_NAME, DATA_TYPE
      FROM QSYS2.SYSCOLUMNS 
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CPC'
      ORDER BY ORDINAL_POSITION
    `);
        cpcCols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));

        // 2. Sample CPC data
        console.log('\n\n2. SAMPLE CPC DATA:');
        console.log('-'.repeat(50));

        const sample = await conn.query(`
      SELECT * FROM DSEDAC.CPC
      WHERE LATITUD IS NOT NULL AND LATITUD <> 0
      FETCH FIRST 3 ROWS ONLY
    `);
        if (sample.length > 0) {
            console.log('  Columns with values:');
            for (const [k, v] of Object.entries(sample[0])) {
                const val = String(v || '').trim();
                if (val && val !== '0') console.log(`    ${k}: ${val}`);
            }
        }

        // 3. Test current date week calculation
        console.log('\n\n3. WEEK CALCULATION TEST:');
        console.log('-'.repeat(50));

        const now = new Date();
        console.log('  Current date:', now.toISOString());

        // ISO week calculation
        const getWeekOfYear = (date) => {
            const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
            const dayNum = d.getUTCDay() || 7;
            d.setUTCDate(d.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
            return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
        };

        console.log('  Week of year:', getWeekOfYear(now));
        console.log('  Target week (N-1):', Math.max(1, getWeekOfYear(now) - 1));

        // 4. Check client 4300008433 in CPC
        console.log('\n\n4. CLIENT 4300008433 GPS DATA:');
        console.log('-'.repeat(50));

        const clientGps = await conn.query(`
      SELECT * FROM DSEDAC.CPC
      WHERE CODIGOCLIENTEALBARAN = '4300008433'
         OR CODIGOCLIENTEFACTURA = '4300008433'
    `);
        if (clientGps.length > 0) {
            console.log('  Found in CPC:');
            for (const [k, v] of Object.entries(clientGps[0])) {
                const val = String(v || '').trim();
                if (val && val !== '0' && val !== 'N') console.log(`    ${k}: ${val}`);
            }
        } else {
            console.log('  NOT found in CPC');
        }

        // 5. Try DSEMOVIL.CLIENTES for GPS
        console.log('\n\n5. CHECK DSEMOVIL.CLIENTES FOR CLIENT:');
        console.log('-'.repeat(50));

        try {
            const dsmClient = await conn.query(`
        SELECT CODIGO, NOMBRE, LATITUD, LONGITUD
        FROM DSEMOVIL.CLIENTES
        WHERE CODIGO = '4300008433'
      `);
            if (dsmClient.length > 0) {
                console.log('  Found:', dsmClient[0]);
            } else {
                console.log('  NOT found');
            }
        } catch (e) { console.log('  Error:', e.message); }

        console.log('\n' + '='.repeat(60));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

debug().catch(console.error);
