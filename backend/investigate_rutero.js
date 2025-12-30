/**
 * Investigate rutero data - why are visit/delivery same? Do routes change by month?
 * Run with: node investigate_rutero.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function investigate() {
    console.log('='.repeat(80));
    console.log('INVESTIGANDO DATOS DE RUTERO - DOMINGO (33)');
    console.log('='.repeat(80));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // 1. Check if LACLAE has month/period info
        console.log('\n1. 📅 ESTRUCTURA DE LACLAE - ¿Hay campo de mes/periodo?');
        console.log('-'.repeat(70));

        try {
            const cols = await conn.query(`
        SELECT COLNAME 
        FROM SYSCAT.COLUMNS 
        WHERE TABSCHEMA = 'DSED' AND TABNAME = 'LACLAE'
        ORDER BY COLNAME
      `);
            console.log('  Columnas:', cols.map(c => c.COLNAME).join(', '));
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 2. Check what the current rutero shows for DOMINGO
        console.log('\n\n2. 📊 CONTEO POR DÍA EN LACLAE PARA DOMINGO (33):');
        console.log('-'.repeat(70));

        try {
            // Count visit days
            const visitCounts = await conn.query(`
        SELECT 
          SUM(CASE WHEN R1_T8DIVL = 'S' THEN 1 ELSE 0 END) as LUNES,
          SUM(CASE WHEN R1_T8DIVM = 'S' THEN 1 ELSE 0 END) as MARTES,
          SUM(CASE WHEN R1_T8DIVX = 'S' THEN 1 ELSE 0 END) as MIERCOLES,
          SUM(CASE WHEN R1_T8DIVJ = 'S' THEN 1 ELSE 0 END) as JUEVES,
          SUM(CASE WHEN R1_T8DIVV = 'S' THEN 1 ELSE 0 END) as VIERNES,
          COUNT(DISTINCT LCCDCL) as TOTAL_CLIENTES
        FROM DSED.LACLAE
        WHERE R1_T8CDVD = '33'
      `);
            console.log('  VISITA:');
            console.log(`    L: ${visitCounts[0]?.LUNES}, M: ${visitCounts[0]?.MARTES}, X: ${visitCounts[0]?.MIERCOLES}, J: ${visitCounts[0]?.JUEVES}, V: ${visitCounts[0]?.VIERNES}`);
            console.log(`    Total clientes únicos: ${visitCounts[0]?.TOTAL_CLIENTES}`);

            // Count delivery days
            const deliveryCounts = await conn.query(`
        SELECT 
          SUM(CASE WHEN R1_T8DIRL = 'S' THEN 1 ELSE 0 END) as LUNES,
          SUM(CASE WHEN R1_T8DIRM = 'S' THEN 1 ELSE 0 END) as MARTES,
          SUM(CASE WHEN R1_T8DIRX = 'S' THEN 1 ELSE 0 END) as MIERCOLES,
          SUM(CASE WHEN R1_T8DIRJ = 'S' THEN 1 ELSE 0 END) as JUEVES,
          SUM(CASE WHEN R1_T8DIRV = 'S' THEN 1 ELSE 0 END) as VIERNES
        FROM DSED.LACLAE
        WHERE R1_T8CDVD = '33'
      `);
            console.log('  REPARTO:');
            console.log(`    L: ${deliveryCounts[0]?.LUNES}, M: ${deliveryCounts[0]?.MARTES}, X: ${deliveryCounts[0]?.MIERCOLES}, J: ${deliveryCounts[0]?.JUEVES}, V: ${deliveryCounts[0]?.VIERNES}`);
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 3. Check if there's a RUTAS table with month info
        console.log('\n\n3. 🗓️ BUSCANDO TABLAS DE RUTAS CON INFORMACIÓN MENSUAL:');
        console.log('-'.repeat(70));

        try {
            const tables = await conn.query(`
        SELECT TABNAME, TABSCHEMA
        FROM SYSCAT.TABLES 
        WHERE (TABNAME LIKE '%RUT%' OR TABNAME LIKE '%RUTA%' OR TABNAME LIKE '%VISIT%')
          AND TABSCHEMA IN ('DSED', 'DSEDAC')
      `);
            console.log('  Tablas encontradas:');
            tables.forEach(t => console.log(`    ${t.TABSCHEMA}.${t.TABNAME}`));
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 4. Check actual sales data by month for DOMINGO
        console.log('\n\n4. 📈 VENTAS REALES DE DOMINGO POR MES (2024):');
        console.log('-'.repeat(70));

        try {
            const salesByMonth = await conn.query(`
        SELECT 
          MESDOCUMENTO as MES,
          COUNT(DISTINCT CODIGOCLIENTEALBARAN) as CLIENTES,
          COUNT(*) as OPERACIONES,
          SUM(IMPORTEVENTA) as VENTAS
        FROM DSEDAC.LAC
        WHERE CODIGOVENDEDOR = '33' AND ANODOCUMENTO = 2024
        GROUP BY MESDOCUMENTO
        ORDER BY MES
      `);
            console.log('  Mes | Clientes | Operaciones | Ventas');
            console.log('  ' + '-'.repeat(50));
            salesByMonth.forEach(m => {
                console.log(`   ${String(m.MES).padStart(2, '0')} |   ${String(m.CLIENTES).padStart(5)}  |    ${String(m.OPERACIONES).padStart(6)}  | ${parseFloat(m.VENTAS).toLocaleString('es-ES')}€`);
            });
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 5. Check if clients visited in month 6 vs month 12 differ
        console.log('\n\n5. 🔄 ¿CAMBIAN LOS CLIENTES ENTRE JUNIO Y DICIEMBRE?');
        console.log('-'.repeat(70));

        try {
            const june = await conn.query(`
        SELECT DISTINCT CODIGOCLIENTEALBARAN FROM DSEDAC.LAC
        WHERE CODIGOVENDEDOR = '33' AND ANODOCUMENTO = 2024 AND MESDOCUMENTO = 6
      `);
            const dec = await conn.query(`
        SELECT DISTINCT CODIGOCLIENTEALBARAN FROM DSEDAC.LAC
        WHERE CODIGOVENDEDOR = '33' AND ANODOCUMENTO = 2024 AND MESDOCUMENTO = 12
      `);

            const juneClients = new Set(june.map(c => c.CODIGOCLIENTEALBARAN?.trim()));
            const decClients = new Set(dec.map(c => c.CODIGOCLIENTEALBARAN?.trim()));

            const onlyJune = [...juneClients].filter(c => !decClients.has(c));
            const onlyDec = [...decClients].filter(c => !juneClients.has(c));
            const both = [...juneClients].filter(c => decClients.has(c));

            console.log(`  Clientes en Junio: ${juneClients.size}`);
            console.log(`  Clientes en Diciembre: ${decClients.size}`);
            console.log(`  Clientes en AMBOS meses: ${both.length}`);
            console.log(`  Solo en Junio: ${onlyJune.length}`);
            console.log(`  Solo en Diciembre: ${onlyDec.length}`);

            if (onlyJune.length > 0) {
                console.log('\n  Ejemplos solo en Junio:', onlyJune.slice(0, 5).join(', '));
            }
            if (onlyDec.length > 0) {
                console.log('  Ejemplos solo en Diciembre:', onlyDec.slice(0, 5).join(', '));
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        // 6. Check if LACLAE has duplicates
        console.log('\n\n6. 🔍 ¿HAY DUPLICADOS EN LACLAE PARA DOMINGO?');
        console.log('-'.repeat(70));

        try {
            const dups = await conn.query(`
        SELECT LCCDCL, COUNT(*) as REPETICIONES
        FROM DSED.LACLAE
        WHERE R1_T8CDVD = '33'
        GROUP BY LCCDCL
        HAVING COUNT(*) > 1
        ORDER BY REPETICIONES DESC
        FETCH FIRST 10 ROWS ONLY
      `);

            if (dups.length > 0) {
                console.log('  ¡SÍ HAY DUPLICADOS! Top 10:');
                dups.forEach(d => console.log(`    ${d.LCCDCL?.trim()}: ${d.REPETICIONES} veces`));
            } else {
                console.log('  No hay duplicados');
            }
        } catch (e) {
            console.log('  Error:', e.message);
        }

        console.log('\n' + '='.repeat(80));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

investigate().catch(console.error);
