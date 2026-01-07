const { initDb, query } = require('../config/db');

async function run() {
    try {
        console.log('🔌 Connecting to DB...');
        await initDb();

        // 1. Verify Families
        console.log('\n--- 1. Testing /families Query ---');
        const families = await query(`
            SELECT TRIM(CODIGOFAMILIA) as CODE, TRIM(DESCRIPCIONFAMILIA) as NAME 
            FROM DSEDAC.FAM 
            FETCH FIRST 5 ROWS ONLY
        `);
        console.log(`✅ Families found: ${families.length}`);
        if (families.length > 0) console.log('Sample:', families[0]);

        const testFamilyCode = families[0]?.CODE || '700';

        // 2. Verify Family->Product Lookup (Filter Logic)
        console.log(`\n--- 2. Testing Product Lookup for Family ${testFamilyCode} ---`);
        const famProducts = await query(`
            SELECT TRIM(CODIGOARTICULO) as CODE 
            FROM DSEDAC.ART 
            WHERE CODIGOFAMILIA IN ('${testFamilyCode}')
            FETCH FIRST 10 ROWS ONLY
        `);
        console.log(`✅ Products in Family: ${famProducts.length}`);

        // 3. Verify Matrix Aggregate (Multi-Year + Family Grouping)
        console.log('\n--- 3. Testing Matrix Aggregate (Multi-Year: 2024, 2025) ---');
        // Mimic the SQL construction for groupBy=vendor,family
        const hierarchy = ['vendor', 'family'];
        const selectClauses = ['L.ANODOCUMENTO as YEAR', 'L.MESDOCUMENTO as MONTH'];
        const groupClauses = ['L.ANODOCUMENTO', 'L.MESDOCUMENTO'];

        // Vendor
        selectClauses.push(`TRIM(L.CODIGOVENDEDOR) as ID_1`);
        groupClauses.push('L.CODIGOVENDEDOR');

        // Family (via Product ID)
        selectClauses.push(`TRIM(L.CODIGOARTICULO) as ID_2`);
        groupClauses.push('L.CODIGOARTICULO');

        selectClauses.push('SUM(L.IMPORTEVENTA) as SALES');

        const sql = `
            SELECT ${selectClauses.join(', ')}
            FROM DSEDAC.LAC L
            WHERE L.ANODOCUMENTO IN (2024, 2025)
              AND L.LCTPVT <> 'SC'
              AND L.LCSRAB NOT IN ('K', 'N', 'O', 'G')
            GROUP BY ${groupClauses.join(', ')}
            FETCH FIRST 100 ROWS ONLY
        `;

        const rows = await query(sql);
        console.log(`✅ Matrix Rows: ${rows.length}`);
        if (rows.length > 0) {
            console.log('Sample Row:', rows[0]);

            // 4. Verify Name Lookup for Family (Step 2 of Logic)
            console.log('\n--- 4. Testing Family Name Lookup (Step 2 Logic) ---');
            const sampleProductId = rows[0].ID_2; // This is a product code
            console.log(`Looking up Family for Product: ${sampleProductId}`);

            const productQuery = `
                    SELECT 
                        TRIM(A.CODIGOARTICULO) as CODE, 
                        TRIM(A.DESCRIPCIONARTICULO) as NAME,
                        TRIM(A.CODIGOFAMILIA) as FAM_CODE,
                        COALESCE(TRIM(F.DESCRIPCIONFAMILIA), TRIM(A.CODIGOFAMILIA)) as FAM_NAME
                    FROM DSEDAC.ART A 
                    LEFT JOIN DSEDAC.FAM F ON A.CODIGOFAMILIA = F.CODIGOFAMILIA 
                    WHERE A.CODIGOARTICULO IN ('${sampleProductId}')
            `;
            const prodInfo = await query(productQuery);
            console.log('Product/Family Info:', prodInfo[0]);
            if (prodInfo[0] && prodInfo[0].FAM_CODE) {
                console.log('✅ Family association confirmed!');
            } else {
                console.warn('⚠️ No family info found for product.');
            }
        }

        console.log('\n🎉 Verification Complete!');
        process.exit(0);

    } catch (e) {
        console.error('❌ Error:', e);
        process.exit(1);
    }
}

run();
