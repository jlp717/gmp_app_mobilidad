// explore_discounts.js - Find all tables related to client discounts/special pricing
const odbc = require('odbc');

const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function main() {
    console.log('Connecting to database...');
    const conn = await odbc.connect(CONNECTION_STRING);

    try {
        // ============================================
        // 1. List ALL tables in DSEDAC schema
        // ============================================
        console.log('\n=== ALL TABLES IN DSEDAC ===');
        const allTables = await conn.query(`
      SELECT TABLE_NAME 
      FROM SYSIBM.TABLES 
      WHERE TABLE_SCHEMA = 'DSEDAC'
      ORDER BY TABLE_NAME
    `);
        console.log(`Total tables in DSEDAC: ${allTables.length}`);
        console.log('Tables:', allTables.map(t => t.TABLE_NAME).join(', '));

        // ============================================
        // 2. Search for DISCOUNT-related tables
        // ============================================
        console.log('\n=== TABLES WITH "DESC" OR "PREC" OR "TARIF" ===');
        const discountTables = await conn.query(`
      SELECT TABLE_NAME 
      FROM SYSIBM.TABLES 
      WHERE TABLE_SCHEMA = 'DSEDAC'
        AND (UPPER(TABLE_NAME) LIKE '%DESC%' 
          OR UPPER(TABLE_NAME) LIKE '%PREC%'
          OR UPPER(TABLE_NAME) LIKE '%TARIF%'
          OR UPPER(TABLE_NAME) LIKE '%PRECIO%'
          OR UPPER(TABLE_NAME) LIKE '%BONIF%'
          OR UPPER(TABLE_NAME) LIKE '%RAPPEL%'
          OR UPPER(TABLE_NAME) LIKE '%OFERT%'
          OR UPPER(TABLE_NAME) LIKE '%PROMO%')
    `);
        console.log('Discount/Price tables:', discountTables.map(t => t.TABLE_NAME).join(', ') || 'None found');

        // ============================================
        // 3. Search for CLIENT-PRODUCT relationship tables  
        // ============================================
        console.log('\n=== TABLES WITH "CLI" + "ART" OR "CLIENTE" + "ARTICULO" ===');
        const cliArtTables = await conn.query(`
      SELECT TABLE_NAME 
      FROM SYSIBM.TABLES 
      WHERE TABLE_SCHEMA = 'DSEDAC'
        AND (UPPER(TABLE_NAME) LIKE '%CLIAR%' 
          OR UPPER(TABLE_NAME) LIKE '%ARCL%'
          OR UPPER(TABLE_NAME) LIKE '%CLIART%'
          OR UPPER(TABLE_NAME) LIKE '%ARTCLI%'
          OR UPPER(TABLE_NAME) LIKE '%TARCL%'
          OR UPPER(TABLE_NAME) LIKE '%TARIF%')
    `);
        console.log('Client-Product tables:', cliArtTables.map(t => t.TABLE_NAME).join(', ') || 'None found');

        // ============================================
        // 4. Look at LAC table for discount columns
        // ============================================
        console.log('\n=== LAC TABLE DISCOUNT/PRICE COLUMNS ===');
        const lacDiscountCols = await conn.query(`
      SELECT COLUMN_NAME 
      FROM SYSIBM.COLUMNS 
      WHERE TABLE_NAME = 'LAC' 
        AND TABLE_SCHEMA = 'DSEDAC'
        AND (UPPER(COLUMN_NAME) LIKE '%DESC%'
          OR UPPER(COLUMN_NAME) LIKE '%PREC%'
          OR UPPER(COLUMN_NAME) LIKE '%TARIF%'
          OR UPPER(COLUMN_NAME) LIKE '%BONIF%'
          OR UPPER(COLUMN_NAME) LIKE '%IMPORT%')
    `);
        console.log('LAC discount columns:', lacDiscountCols.map(r => r.COLUMN_NAME).join(', '));

        // ============================================
        // 5. Sample LAC with discount columns
        // ============================================
        console.log('\n=== LAC SAMPLE WITH DISCOUNT DATA ===');
        const lacSample = await conn.query(`
      SELECT 
        CODIGOCLIENTEALBARAN, CODIGOARTICULO,
        IMPORTEPRECIOTARIFA, IMPORTEPRECIONETO,
        IMPORTEDESCUENTO1, IMPORTEDESCUENTO2, IMPORTEDESCUENTO3,
        IMPORTEDESCUENTOUNIDAD, IMPORTEDESCUENTOPROMOCION,
        IMPORTEVENTA, IMPORTECOSTO
      FROM DSEDAC.LAC 
      WHERE IMPORTEDESCUENTO1 <> 0 OR IMPORTEDESCUENTOUNIDAD <> 0
      FETCH FIRST 5 ROWS ONLY
    `);
        console.log('Rows with discounts:');
        lacSample.forEach((r, i) => {
            console.log(`${i + 1}. Client: ${r.CODIGOCLIENTEALBARAN?.trim()}, Art: ${r.CODIGOARTICULO?.trim()}`);
            console.log(`   Tarifa: ${r.IMPORTEPRECIOTARIFA}, Neto: ${r.IMPORTEPRECIONETO}`);
            console.log(`   Desc1: ${r.IMPORTEDESCUENTO1}, Desc2: ${r.IMPORTEDESCUENTO2}, Desc3: ${r.IMPORTEDESCUENTO3}`);
            console.log(`   DescUnit: ${r.IMPORTEDESCUENTOUNIDAD}, DescPromo: ${r.IMPORTEDESCUENTOPROMOCION}`);
        });

        // ============================================
        // 6. Search CLI table for discount columns
        // ============================================
        console.log('\n=== CLI TABLE TARIFF/DISCOUNT COLUMNS ===');
        const cliTariffCols = await conn.query(`
      SELECT COLUMN_NAME 
      FROM SYSIBM.COLUMNS 
      WHERE TABLE_NAME = 'CLI' 
        AND TABLE_SCHEMA = 'DSEDAC'
        AND (UPPER(COLUMN_NAME) LIKE '%TARIF%'
          OR UPPER(COLUMN_NAME) LIKE '%DESC%'
          OR UPPER(COLUMN_NAME) LIKE '%PREC%'
          OR UPPER(COLUMN_NAME) LIKE '%BONIF%'
          OR UPPER(COLUMN_NAME) LIKE '%RAPPEL%')
    `);
        console.log('CLI tariff/discount columns:', cliTariffCols.map(r => r.COLUMN_NAME).join(', '));

        // ============================================
        // 7. Explore DSEMOVIL schema for pricing
        // ============================================
        console.log('\n=== DSEMOVIL TABLES (pricing?) ===');
        const movilTables = await conn.query(`
      SELECT TABLE_NAME 
      FROM SYSIBM.TABLES 
      WHERE TABLE_SCHEMA = 'DSEMOVIL'
      ORDER BY TABLE_NAME
    `);
        console.log('DSEMOVIL tables:', movilTables.map(t => t.TABLE_NAME).join(', '));

        // ============================================
        // 8. Look for TAR* tables (tarifas)
        // ============================================
        console.log('\n=== TAR* TABLES (tarifas/pricing) ===');
        const tarTables = await conn.query(`
      SELECT TABLE_NAME 
      FROM SYSIBM.TABLES 
      WHERE TABLE_SCHEMA = 'DSEDAC'
        AND UPPER(TABLE_NAME) LIKE 'TAR%'
    `);
        console.log('TAR tables:', tarTables.map(t => t.TABLE_NAME).join(', ') || 'None');

        for (const t of tarTables.slice(0, 3)) {
            console.log(`\n  --- ${t.TABLE_NAME} columns ---`);
            const cols = await conn.query(`
        SELECT COLUMN_NAME FROM SYSIBM.COLUMNS 
        WHERE TABLE_NAME = '${t.TABLE_NAME}' AND TABLE_SCHEMA = 'DSEDAC'
        ORDER BY ORDINAL_POSITION
      `);
            console.log('  ', cols.map(c => c.COLUMN_NAME).join(', '));

            const sample = await conn.query(`SELECT * FROM DSEDAC.${t.TABLE_NAME} FETCH FIRST 2 ROWS ONLY`);
            if (sample.length > 0) {
                console.log('  Sample:', JSON.stringify(sample[0]));
            }
        }

        // ============================================
        // 9. Look for PRE* or PVP* tables
        // ============================================
        console.log('\n=== PRE* or PVP* TABLES ===');
        const preTables = await conn.query(`
      SELECT TABLE_NAME 
      FROM SYSIBM.TABLES 
      WHERE TABLE_SCHEMA = 'DSEDAC'
        AND (UPPER(TABLE_NAME) LIKE 'PRE%' OR UPPER(TABLE_NAME) LIKE 'PVP%')
    `);
        console.log('PRE/PVP tables:', preTables.map(t => t.TABLE_NAME).join(', ') || 'None');

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await conn.close();
        console.log('\nDone.');
    }
}

main();
