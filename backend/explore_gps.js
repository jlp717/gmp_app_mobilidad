/**
 * COMPREHENSIVE DATABASE EXPLORATION SCRIPT
 * Searches all schemas, tables, and views for GPS/coordinate/address related columns
 */
const odbc = require('odbc');
const fs = require('fs');

const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

// Keywords to search for in column names (case insensitive)
const GPS_KEYWORDS = [
    'LAT', 'LON', 'LATITUD', 'LONGITUD', 'LATITUDE', 'LONGITUDE',
    'GPS', 'COORD', 'COORDENADA', 'POSICION', 'POSITION',
    'UBICACION', 'LOCATION', 'GEO', 'GEOLOC'
];

const ADDRESS_KEYWORDS = [
    'DIREC', 'ADDRESS', 'CALLE', 'STREET', 'CIUDAD', 'CITY',
    'PROVINCIA', 'POBLACION', 'LOCALIDAD', 'POSTAL', 'CP', 'ZIP',
    'DOMICILIO', 'PAIS', 'COUNTRY', 'REGION'
];

// Priority schemas to search first
const PRIORITY_SCHEMAS = [
    'DSEDAC', 'DSEF', 'DSEDAZ', 'DSEDUT', 'DSEMOVIL', 'DSTF',
    'DSTM02', 'DSTM09', 'DSTD02', 'WTAD01', 'WTAD02', 'JAVIER'
];

async function run() {
    const conn = await odbc.connect(CONNECTION_STRING);
    const results = {
        gpsColumns: [],
        addressColumns: [],
        clientTables: [],
        allSchemas: []
    };

    try {
        console.log('='.repeat(60));
        console.log('🔍 COMPREHENSIVE DATABASE EXPLORATION FOR GPS/COORDINATES');
        console.log('='.repeat(60));
        console.log('Started at:', new Date().toISOString());
        console.log('');

        // 1. List all schemas
        console.log('📁 STEP 1: Listing all schemas...');
        const schemas = await conn.query(`
      SELECT DISTINCT TABLE_SCHEMA 
      FROM QSYS2.SYSTABLES 
      WHERE TABLE_TYPE IN ('T', 'V')
      ORDER BY TABLE_SCHEMA
      FETCH FIRST 100 ROWS ONLY
    `);
        results.allSchemas = schemas.map(s => s.TABLE_SCHEMA);
        console.log(`   Found ${results.allSchemas.length} schemas:`, results.allSchemas.join(', '));
        console.log('');

        // 2. Search for GPS-related columns in priority schemas
        console.log('📍 STEP 2: Searching for GPS/COORDINATE columns...');
        for (const schema of PRIORITY_SCHEMAS) {
            if (!results.allSchemas.includes(schema)) continue;

            const gpsQuery = `
        SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = '${schema}'
        AND (${GPS_KEYWORDS.map(k => `UPPER(COLUMN_NAME) LIKE '%${k}%'`).join(' OR ')})
        FETCH FIRST 50 ROWS ONLY
      `;

            try {
                const gpsCols = await conn.query(gpsQuery);
                if (gpsCols.length > 0) {
                    console.log(`   ✅ ${schema}: Found ${gpsCols.length} potential GPS columns`);
                    gpsCols.forEach(c => {
                        console.log(`      - ${c.TABLE_NAME}.${c.COLUMN_NAME} (${c.DATA_TYPE})`);
                        results.gpsColumns.push(c);
                    });
                }
            } catch (e) {
                console.log(`   ⚠️ ${schema}: Query failed - ${e.message.slice(0, 50)}`);
            }
        }
        console.log('');

        // 3. Search for ADDRESS-related columns
        console.log('🏠 STEP 3: Searching for ADDRESS columns...');
        for (const schema of PRIORITY_SCHEMAS) {
            if (!results.allSchemas.includes(schema)) continue;

            const addrQuery = `
        SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = '${schema}'
        AND (${ADDRESS_KEYWORDS.map(k => `UPPER(COLUMN_NAME) LIKE '%${k}%'`).join(' OR ')})
        FETCH FIRST 30 ROWS ONLY
      `;

            try {
                const addrCols = await conn.query(addrQuery);
                if (addrCols.length > 0) {
                    console.log(`   📫 ${schema}: Found ${addrCols.length} address columns`);
                    addrCols.forEach(c => {
                        console.log(`      - ${c.TABLE_NAME}.${c.COLUMN_NAME} (${c.DATA_TYPE})`);
                        results.addressColumns.push(c);
                    });
                }
            } catch (e) {
                console.log(`   ⚠️ ${schema}: Query failed - ${e.message.slice(0, 50)}`);
            }
        }
        console.log('');

        // 4. Find client tables and sample their structure
        console.log('👥 STEP 4: Finding CLIENT tables and their columns...');
        const clientQuery = `
      SELECT TABLE_SCHEMA, TABLE_NAME 
      FROM QSYS2.SYSTABLES 
      WHERE TABLE_TYPE = 'T' 
      AND (UPPER(TABLE_NAME) LIKE '%CLI%' 
           OR UPPER(TABLE_NAME) LIKE '%CUSTOMER%' 
           OR UPPER(TABLE_NAME) LIKE '%CLIENT%')
      AND TABLE_SCHEMA IN (${PRIORITY_SCHEMAS.map(s => `'${s}'`).join(',')})
      FETCH FIRST 20 ROWS ONLY
    `;

        const clientTables = await conn.query(clientQuery);
        console.log(`   Found ${clientTables.length} client tables`);

        // Get full column list for top 3 client tables
        for (const t of clientTables.slice(0, 3)) {
            console.log(`\n   📋 ${t.TABLE_SCHEMA}.${t.TABLE_NAME} - ALL COLUMNS:`);
            try {
                const allCols = await conn.query(`
          SELECT COLUMN_NAME, DATA_TYPE, LENGTH
          FROM QSYS2.SYSCOLUMNS 
          WHERE TABLE_SCHEMA = '${t.TABLE_SCHEMA}' 
          AND TABLE_NAME = '${t.TABLE_NAME}'
          ORDER BY ORDINAL_POSITION
          FETCH FIRST 80 ROWS ONLY
        `);

                console.log(`      (${allCols.length} columns):`);
                console.log(`      ${allCols.map(c => c.COLUMN_NAME).join(', ')}`);
                results.clientTables.push({
                    schema: t.TABLE_SCHEMA,
                    table: t.TABLE_NAME,
                    columns: allCols.map(c => c.COLUMN_NAME)
                });
            } catch (e) {
                console.log(`      Error: ${e.message.slice(0, 50)}`);
            }
        }
        console.log('');

        // 5. Summary
        console.log('='.repeat(60));
        console.log('📊 SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total GPS-related columns found: ${results.gpsColumns.length}`);
        console.log(`Total Address columns found: ${results.addressColumns.length}`);
        console.log(`Client tables explored: ${results.clientTables.length}`);

        if (results.gpsColumns.length > 0) {
            console.log('\n🌍 GPS COLUMNS (MOST LIKELY CANDIDATES):');
            results.gpsColumns.forEach(c => {
                console.log(`   ${c.TABLE_SCHEMA}.${c.TABLE_NAME}.${c.COLUMN_NAME}`);
            });
        }

        if (results.addressColumns.length > 0) {
            console.log('\n📬 ADDRESS COLUMNS:');
            const unique = [...new Set(results.addressColumns.map(c => `${c.TABLE_SCHEMA}.${c.TABLE_NAME}`))];
            unique.forEach(t => console.log(`   ${t}`));
        }

        // Save results to file
        fs.writeFileSync('db_exploration_results.json', JSON.stringify(results, null, 2));
        console.log('\n💾 Results saved to db_exploration_results.json');

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await conn.close();
        console.log('\n✅ Exploration complete at:', new Date().toISOString());
    }
}

run();
