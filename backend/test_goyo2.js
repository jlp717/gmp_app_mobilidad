/**
 * Test script for GOYO and matrix-data - Simpler queries
 * Run with: node test_goyo2.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function test() {
    console.log('='.repeat(70));
    console.log('TESTING GOYO AND MATRIX DATA (SIMPLIFIED)');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);
        console.log('✓ Connected to database\n');

        // 1. Find all users in CUSTOMER_USERS
        console.log('1. USERS IN CUSTOMER_USERS...');
        console.log('-'.repeat(50));
        try {
            const result1 = await conn.query(`
        SELECT CODIGOUSUARIO, NOMBREUSUARIO FROM JAVIER.CUSTOMER_USERS
        FETCH FIRST 10 ROWS ONLY
      `);
            console.log('Users:');
            result1.forEach(r => {
                console.log(`  ${r.CODIGOUSUARIO?.trim()} | ${r.NOMBREUSUARIO?.trim()}`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 2. All vendedores with JEFEVENTASSN
        console.log('\n2. ALL VDC VENDEDORES...');
        console.log('-'.repeat(50));
        try {
            const result2 = await conn.query(`
        SELECT CODIGOVENDEDOR, TIPOVENDEDOR FROM DSEDAC.VDC
        WHERE SUBEMPRESA = 'GMP'
        FETCH FIRST 10 ROWS ONLY
      `);
            console.log('Vendedores:');
            result2.forEach(r => {
                console.log(`  ${r.CODIGOVENDEDOR?.trim()} | Type: ${r.TIPOVENDEDOR?.trim()}`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 3. Check VDDX table
        console.log('\n3. CHECKING VDDX TABLE...');
        console.log('-'.repeat(50));
        try {
            const result3 = await conn.query(`
        SELECT CODIGOVENDEDOR, NOMBREVENDEDOR, JEFEVENTASSN 
        FROM DSEDAC.VDDX
        FETCH FIRST 10 ROWS ONLY
      `);
            console.log('VDDX:');
            result3.forEach(r => {
                console.log(`  ${r.CODIGOVENDEDOR?.trim()} | ${r.NOMBREVENDEDOR?.trim()} | JefeVentas: ${r.JEFEVENTASSN?.trim()}`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 4. Simple matrix query using LAC instead of CVC
        console.log('\n4. MATRIX QUERY USING LAC (VENDORS)...');
        console.log('-'.repeat(50));
        try {
            const result4 = await conn.query(`
        SELECT 
          L.CODIGOVENDEDOR as CODE,
          L.ANODOCUMENTO as YEAR,
          L.MESDOCUMENTO as MONTH,
          SUM(L.IMPORTEVENTA) as SALES
        FROM DSEDAC.LAC L
        WHERE L.ANODOCUMENTO = 2024 AND L.CODIGOVENDEDOR IS NOT NULL
        GROUP BY L.CODIGOVENDEDOR, L.ANODOCUMENTO, L.MESDOCUMENTO
        ORDER BY SALES DESC
        FETCH FIRST 5 ROWS ONLY
      `);
            console.log('Matrix vendor data from LAC:');
            result4.forEach(r => {
                console.log(`  Vendor: ${r.CODE?.trim()} | ${r.YEAR}-${r.MONTH} | ${parseFloat(r.SALES).toFixed(2)}€`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 5. Check who is GOYO in VDC
        console.log('\n5. SEARCHING FOR GOYO IN VDC...');
        console.log('-'.repeat(50));
        try {
            const result5 = await conn.query(`
        SELECT V.CODIGOVENDEDOR, X.NOMBREVENDEDOR, X.JEFEVENTASSN
        FROM DSEDAC.VDC V
        LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
        WHERE V.SUBEMPRESA = 'GMP' 
          AND (UPPER(V.CODIGOVENDEDOR) LIKE '%GOYO%' 
               OR UPPER(X.NOMBREVENDEDOR) LIKE '%GOYO%')
      `);
            if (result5.length > 0) {
                console.log('GOYO found:');
                result5.forEach(r => {
                    console.log(`  ${r.CODIGOVENDEDOR?.trim()} | ${r.NOMBREVENDEDOR?.trim()} | JefeVentas: ${r.JEFEVENTASSN}`);
                });
            } else {
                console.log('  GOYO not found, checking all vendedores with names...');
                const result5b = await conn.query(`
          SELECT V.CODIGOVENDEDOR, X.NOMBREVENDEDOR, X.JEFEVENTASSN
          FROM DSEDAC.VDC V
          LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
          WHERE V.SUBEMPRESA = 'GMP' AND X.NOMBREVENDEDOR IS NOT NULL
          FETCH FIRST 20 ROWS ONLY
        `);
                console.log('  All vendedores with names:');
                result5b.forEach(r => {
                    console.log(`    ${r.CODIGOVENDEDOR?.trim()} | ${r.NOMBREVENDEDOR?.trim()} | JefeVentas: ${r.JEFEVENTASSN?.trim()}`);
                });
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        console.log('\n' + '='.repeat(70));
        console.log('TEST COMPLETE');
        console.log('='.repeat(70));

    } catch (error) {
        console.error('Connection error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

test().catch(console.error);
