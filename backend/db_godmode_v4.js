const fs = require('fs');
const { query } = require('./config/db');

async function godModeExplore() {
    let out = '';
    const tryQ = async (title, sql) => {
        out += `\n\n========== ${title} ==========\n`;
        try {
            const res = await query(sql);
            out += JSON.stringify(res, null, 2);
            console.log(`✅ ${title}: ${res.length} rows`);
        } catch (err) {
            out += `ERROR: ${err.message}`;
            console.log(`❌ ${title}: ${err.message}`);
        }
    };

    try {
        // 1. ALL vehicles with REAL data from DSEDAC.VEH
        await tryQ('TODOS LOS VEHICULOS DSEDAC.VEH (ALL columns)',
            `SELECT * FROM DSEDAC.VEH ORDER BY CODIGOVEHICULO FETCH FIRST 50 ROWS ONLY`);

        // 2. Count total articles in DSEDAC.ART  
        await tryQ('TOTAL ARTICULOS EN DSEDAC.ART',
            `SELECT COUNT(*) AS TOTAL FROM DSEDAC.ART WHERE TRIM(CODIGOARTICULO) <> ''`);

        // 3. Count articles after removing ANOBAJA  
        await tryQ('ARTICULOS ACTIVOS (sin ANOBAJA)',
            `SELECT COUNT(*) AS TOTAL FROM DSEDAC.ART WHERE TRIM(CODIGOARTICULO) <> '' AND (ANOBAJA = 0 OR ANOBAJA IS NULL)`);

        // 4. Sample of GARBAGE articles still showing
        await tryQ('MUESTRA DE ARTICULOS BASURA (los que se cuelan)',
            `SELECT TRIM(CODIGOARTICULO) AS CODE, TRIM(DESCRIPCIONARTICULO) AS NOMBRE, PESO 
       FROM DSEDAC.ART 
       WHERE (ANOBAJA = 0 OR ANOBAJA IS NULL)
       AND (
         UPPER(DESCRIPCIONARTICULO) LIKE '%URGENTE%' OR
         UPPER(DESCRIPCIONARTICULO) LIKE '%CT CT%' OR
         UPPER(DESCRIPCIONARTICULO) LIKE '%MODELO TARIFA%' OR
         UPPER(DESCRIPCIONARTICULO) LIKE '%TARIFAS PACK%' OR
         UPPER(DESCRIPCIONARTICULO) LIKE '%REVISTA%' OR
         UPPER(DESCRIPCIONARTICULO) LIKE '%AVERIADO%' OR
         UPPER(DESCRIPCIONARTICULO) LIKE '%PANAMAR%' OR
         UPPER(DESCRIPCIONARTICULO) LIKE '%GASTOS%' OR
         UPPER(DESCRIPCIONARTICULO) LIKE '%ENVIAR%' OR
         UPPER(DESCRIPCIONARTICULO) LIKE '%REPARTIR%' OR
         UPPER(DESCRIPCIONARTICULO) LIKE '%ESTIMADO%' OR
         UPPER(DESCRIPCIONARTICULO) LIKE '%ULTIMA HORA%' OR
         UPPER(DESCRIPCIONARTICULO) LIKE '%.........%' OR
         PESO = 0
       )
       FETCH FIRST 30 ROWS ONLY`);

        // 5. Real GOOD articles with weight > 0
        await tryQ('ARTICULOS BUENOS (peso > 0, sin basura)',
            `SELECT COUNT(*) AS TOTAL FROM DSEDAC.ART 
       WHERE TRIM(CODIGOARTICULO) <> '' 
       AND (ANOBAJA = 0 OR ANOBAJA IS NULL)
       AND PESO > 0
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%PRUEBA%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%TEST%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%DESCUENTO%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%URGENTE%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%CT CT%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%ESTIMADO%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%REPARTIR%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%ENVIAR%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%ULTIMA HORA%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%GASTOS%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%MODELO TARIFA%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%TARIFAS PACK%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%REVISTA%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%AVERIADO%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%PANAMAR%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%.........%'`);

        // 6. Sample of GOOD articles
        await tryQ('MUESTRA 20 ARTICULOS BUENOS REALES',
            `SELECT TRIM(CODIGOARTICULO) AS CODE, TRIM(DESCRIPCIONARTICULO) AS NOMBRE, PESO, UNIDADESCAJA
       FROM DSEDAC.ART 
       WHERE TRIM(CODIGOARTICULO) <> '' 
       AND (ANOBAJA = 0 OR ANOBAJA IS NULL)
       AND PESO > 0
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%PRUEBA%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%TEST%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%CT CT%'
       AND UPPER(DESCRIPCIONARTICULO) NOT LIKE '%.........%'
       ORDER BY CODIGOARTICULO
       FETCH FIRST 20 ROWS ONLY`);

        // 7. Check article dimensions table
        await tryQ('JAVIER.ALMACEN_ART_DIMENSIONES (muestra)',
            `SELECT * FROM JAVIER.ALMACEN_ART_DIMENSIONES FETCH FIRST 10 ROWS ONLY`);

        // 8. Check expedition/orders tables
        await tryQ('TABLAS CON EXPEDICION/PEDIDO/ORDEN',
            `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TEXT FROM QSYS2.SYSTABLES 
       WHERE (TABLE_NAME LIKE '%EXPED%' OR TABLE_NAME LIKE '%PEDID%' OR TABLE_NAME LIKE '%ORDEN%' OR TABLE_NAME LIKE '%ALBAR%')
       AND TABLE_SCHEMA IN ('DSEDAC', 'DSED', 'JAVIER', 'DIEGO', 'DSTF', 'DSTM02', 'GIOVA')
       ORDER BY TABLE_SCHEMA, TABLE_NAME`);

        // 9. Check what data the expedition center uses
        await tryQ('EXPEDICIONES DEL DIA (DSEDAC.EVE muestra)',
            `SELECT * FROM DSEDAC.EVE FETCH FIRST 3 ROWS ONLY`);

        // 10. All VEH columns
        await tryQ('COLUMNAS DE DSEDAC.VEH',
            `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TEXT FROM QSYS2.SYSCOLUMNS 
       WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'VEH' ORDER BY ORDINAL_POSITION`);

        fs.writeFileSync('godmode_v4_out.txt', out);
        console.log('\n✅ Results written to godmode_v4_out.txt');
        process.exit(0);
    } catch (err) {
        console.error('FATAL:', err);
        process.exit(1);
    }
}

setTimeout(godModeExplore, 1500);
