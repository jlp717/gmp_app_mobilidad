/**
 * Test script for GOYO (Jefe de Ventas) and matrix-data
 * Run with: node test_goyo.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function test() {
    console.log('='.repeat(70));
    console.log('TESTING GOYO (JEFE DE VENTAS) AND MATRIX DATA');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);
        console.log('✓ Connected to database\n');

        // 1. Find GOYO user
        console.log('1. FINDING GOYO USER...');
        console.log('-'.repeat(50));
        try {
            const result1 = await conn.query(`
        SELECT 
          U.CODIGOUSUARIO,
          U.NOMBREUSUARIO,
          V.CODIGOVENDEDOR,
          V.TIPOVENDEDOR,
          X.JEFEVENTASSN
        FROM JAVIER.CUSTOMER_USERS U
        LEFT JOIN DSEDAC.VDC V ON UPPER(V.CODIGOVENDEDOR) = UPPER(U.CODIGOUSUARIO) AND V.SUBEMPRESA = 'GMP'
        LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
        WHERE UPPER(U.CODIGOUSUARIO) LIKE '%GOYO%'
          OR UPPER(U.NOMBREUSUARIO) LIKE '%GOYO%'
      `);
            console.log('GOYO users found:');
            result1.forEach(r => {
                console.log(`  Code: ${r.CODIGOUSUARIO?.trim()} | Name: ${r.NOMBREUSUARIO?.trim()} | Vendedor: ${r.CODIGOVENDEDOR?.trim()} | Tipo: ${r.TIPOVENDEDOR?.trim()} | JefeVentas: ${r.JEFEVENTASSN?.trim()}`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 2. Check CVC table structure
        console.log('\n2. CHECKING CVC TABLE COLUMNS...');
        console.log('-'.repeat(50));
        try {
            const result2 = await conn.query(`
        SELECT CODIGOVENDEDOR, ANOEMISION, MESEMISION, IMPORTEVENCIMIENTO
        FROM DSEDAC.CVC
        WHERE ANOEMISION = 2024
        FETCH FIRST 3 ROWS ONLY
      `);
            console.log('CVC sample data:');
            result2.forEach(r => {
                console.log(`  Vendedor: ${r.CODIGOVENDEDOR?.trim()} | Year: ${r.ANOEMISION} | Month: ${r.MESEMISION} | Amount: ${parseFloat(r.IMPORTEVENCIMIENTO).toFixed(2)}`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 3. Test a simple matrix query for vendors
        console.log('\n3. TESTING MATRIX QUERY (VENDORS)...');
        console.log('-'.repeat(50));
        try {
            const result3 = await conn.query(`
        SELECT 
          V.CODIGOVENDEDOR as code,
          COALESCE(TRIM(X.NOMBREVENDEDOR), 'Sin nombre') as name,
          CV.ANOEMISION as year,
          CV.MESEMISION as month,
          SUM(CV.IMPORTEVENCIMIENTO) as sales
        FROM DSEDAC.CVC CV
        JOIN DSEDAC.VDC V ON TRIM(V.CODIGOVENDEDOR) = TRIM(CV.CODIGOVENDEDOR)
        LEFT JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
        WHERE CV.ANOEMISION >= 2024 AND V.SUBEMPRESA = 'GMP'
        GROUP BY V.CODIGOVENDEDOR, X.NOMBREVENDEDOR, CV.ANOEMISION, CV.MESEMISION
        ORDER BY year DESC, month DESC
        FETCH FIRST 5 ROWS ONLY
      `);
            console.log('Matrix vendor data:');
            result3.forEach(r => {
                console.log(`  ${r.CODE?.trim()} | ${r.NAME?.trim()?.substring(0, 20)} | ${r.YEAR}-${r.MONTH} | ${parseFloat(r.SALES).toFixed(2)}€`);
            });
        } catch (e) {
            console.log('  SQL Error:', e.message);
        }

        // 4. Test product families
        console.log('\n4. CHECKING PRODUCT FAMILIES...');
        console.log('-'.repeat(50));
        try {
            const result4 = await conn.query(`
        SELECT CODIGOFAMILIA, DESCRIPCIONFAMILIA
        FROM DSEDAC.FAM
        FETCH FIRST 10 ROWS ONLY
      `);
            console.log('Families:');
            result4.forEach(r => {
                console.log(`  ${r.CODIGOFAMILIA?.trim()} | ${r.DESCRIPCIONFAMILIA?.trim()}`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 5. Check all Jefe de Ventas users
        console.log('\n5. ALL JEFE DE VENTAS USERS...');
        console.log('-'.repeat(50));
        try {
            const result5 = await conn.query(`
        SELECT 
          V.CODIGOVENDEDOR,
          X.NOMBREVENDEDOR,
          X.JEFEVENTASSN
        FROM DSEDAC.VDC V
        JOIN DSEDAC.VDDX X ON V.CODIGOVENDEDOR = X.CODIGOVENDEDOR
        WHERE V.SUBEMPRESA = 'GMP' AND X.JEFEVENTASSN = 'S'
      `);
            console.log('Jefe de Ventas:');
            result5.forEach(r => {
                console.log(`  ${r.CODIGOVENDEDOR?.trim()} | ${r.NOMBREVENDEDOR?.trim()} | JefeVentas: ${r.JEFEVENTASSN}`);
            });
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
