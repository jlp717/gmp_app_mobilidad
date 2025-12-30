/**
 * Explore database for pricing and promotions tables
 * Run with: node explore_pricing.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function explore() {
    console.log('='.repeat(80));
    console.log('EXPLORANDO TABLAS DE PRECIOS Y PROMOCIONES');
    console.log('='.repeat(80));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. Search for price-related tables
        console.log('\n1. 💰 TABLAS RELACIONADAS CON PRECIOS:');
        console.log('-'.repeat(70));

        try {
            const priceTables = await conn.query(`
        SELECT TABNAME, TABSCHEMA
        FROM SYSCAT.TABLES 
        WHERE TABSCHEMA IN ('DSED', 'DSEDAC', 'JAVIER')
          AND (TABNAME LIKE '%PREC%' OR TABNAME LIKE '%TARI%' OR TABNAME LIKE '%PRICE%' 
               OR TABNAME LIKE '%COST%' OR TABNAME LIKE '%PVP%')
      `);
            priceTables.forEach(t => console.log(`  ${t.TABSCHEMA}.${t.TABNAME}`));
        } catch (e) { console.log('  Error:', e.message); }

        // 2. Check LAC for price fields
        console.log('\n2. 📊 CAMPOS DE PRECIO EN LAC:');
        console.log('-'.repeat(70));

        try {
            const lacCols = await conn.query(`
        SELECT COLNAME FROM SYSCAT.COLUMNS 
        WHERE TABSCHEMA = 'DSEDAC' AND TABNAME = 'LAC'
          AND (COLNAME LIKE '%PREC%' OR COLNAME LIKE '%COST%' OR COLNAME LIKE '%MARG%' 
               OR COLNAME LIKE '%DESC%' OR COLNAME LIKE '%PVP%')
      `);
            console.log('  Columnas:', lacCols.map(c => c.COLNAME).join(', '));
        } catch (e) { console.log('  Error:', e.message); }

        // 3. Sample price data from LAC
        console.log('\n3. 💵 MUESTRA DE DATOS DE PRECIO EN LAC:');
        console.log('-'.repeat(70));

        try {
            const priceData = await conn.query(`
        SELECT 
          CODIGOARTICULO as PRODUCTO,
          DESCRIPCIONARTICULO as NOMBRE,
          AVG(PRECIOVENTAARTICULO) as PRECIO_MEDIO,
          MAX(PRECIOVENTAARTICULO) as PRECIO_MAX,
          MIN(PRECIOVENTAARTICULO) as PRECIO_MIN,
          AVG(PORCENTAJEDESCUENTO) as DESC_MEDIO,
          AVG(MARGEN) as MARGEN_MEDIO
        FROM DSEDAC.LAC
        WHERE ANODOCUMENTO = 2024 AND CODIGOVENDEDOR = '33'
        GROUP BY CODIGOARTICULO, DESCRIPCIONARTICULO
        ORDER BY COUNT(*) DESC
        FETCH FIRST 10 ROWS ONLY
      `);
            console.log('  Producto | Precio Min | Precio Max | Desc% | Margen%');
            console.log('  ' + '-'.repeat(60));
            priceData.forEach(p => {
                console.log(`  ${(p.PRODUCTO || '').trim().substring(0, 12).padEnd(12)} | ${parseFloat(p.PRECIO_MIN || 0).toFixed(2)}€ | ${parseFloat(p.PRECIO_MAX || 0).toFixed(2)}€ | ${parseFloat(p.DESC_MEDIO || 0).toFixed(1)}% | ${parseFloat(p.MARGEN_MEDIO || 0).toFixed(1)}%`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        // 4. Check for promotion tables
        console.log('\n4. 🏷️ TABLAS DE PROMOCIONES:');
        console.log('-'.repeat(70));

        try {
            const promoTables = await conn.query(`
        SELECT TABNAME, TABSCHEMA
        FROM SYSCAT.TABLES 
        WHERE TABSCHEMA IN ('DSED', 'DSEDAC', 'JAVIER')
          AND (TABNAME LIKE '%PROM%' OR TABNAME LIKE '%OFER%' OR TABNAME LIKE '%CAMP%')
      `);
            if (promoTables.length > 0) {
                promoTables.forEach(t => console.log(`  ${t.TABSCHEMA}.${t.TABNAME}`));
            } else {
                console.log('  No se encontraron tablas de promociones');
            }
        } catch (e) { console.log('  Error:', e.message); }

        // 5. Family/category for products
        console.log('\n5. 📂 FAMILIAS DE PRODUCTOS:');
        console.log('-'.repeat(70));

        try {
            const families = await conn.query(`
        SELECT DISTINCT CODIGOFAMILIA, DESCRIPCIONFAMILIA
        FROM DSEDAC.FAM
        FETCH FIRST 15 ROWS ONLY
      `);
            families.forEach(f => console.log(`  ${(f.CODIGOFAMILIA || '').trim()} - ${(f.DESCRIPCIONFAMILIA || '').trim()}`));
        } catch (e) { console.log('  Error:', e.message); }

        // 6. Check margin calculation in LAC
        console.log('\n6. 📈 ANÁLISIS DE MÁRGENES PARA DOMINGO (2024):');
        console.log('-'.repeat(70));

        try {
            const margins = await conn.query(`
        SELECT 
          MESDOCUMENTO as MES,
          SUM(IMPORTEVENTA) as VENTAS,
          SUM(IMPORTECOSTE) as COSTE,
          AVG(MARGEN) as MARGEN_AVG
        FROM DSEDAC.LAC
        WHERE CODIGOVENDEDOR = '33' AND ANODOCUMENTO = 2024
        GROUP BY MESDOCUMENTO
        ORDER BY MES
      `);
            console.log('  Mes | Ventas      | Coste       | Margen%');
            console.log('  ' + '-'.repeat(50));
            margins.forEach(m => {
                const ventas = parseFloat(m.VENTAS) || 0;
                const coste = parseFloat(m.COSTE) || 0;
                const margenCalc = ventas > 0 ? ((ventas - coste) / ventas * 100) : 0;
                console.log(`   ${String(m.MES).padStart(2, '0')} | ${ventas.toLocaleString('es-ES').padStart(10)}€ | ${coste.toLocaleString('es-ES').padStart(10)}€ | ${margenCalc.toFixed(1)}%`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        console.log('\n' + '='.repeat(80));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

explore().catch(console.error);
