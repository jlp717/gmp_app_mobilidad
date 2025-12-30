/**
 * Script para investigar qué datos realmente existen para rutero y objetivos
 */

const odbc = require('odbc');

async function main() {
    console.log('Investigando datos disponibles...\n');

    try {
        const conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');
        console.log('Conexión exitosa!\n');

        // 1. Verificar ventas por mes/año
        console.log('=== VENTAS POR MES EN 2025 (DSEDAC.LINDTO) ===');
        try {
            const ventas = await conn.query(`
        SELECT ANODOCUMENTO as anio, MESDOCUMENTO as mes, 
               COUNT(*) as lineas, SUM(IMPORTEVENTA) as total
        FROM DSEDAC.LINDTO
        WHERE ANODOCUMENTO = 2025
        GROUP BY ANODOCUMENTO, MESDOCUMENTO
        ORDER BY MESDOCUMENTO
      `);
            ventas.forEach(v => {
                console.log(`${v.ANIO}/${v.MES}: ${v.LINEAS} líneas, ${v.TOTAL?.toFixed(2)}€`);
            });
        } catch (e) {
            console.log('Error:', e.message);
        }

        // 2. Verificar ventas 2024 para comparación
        console.log('\n=== VENTAS 2024 PARA COMPARACIÓN ===');
        try {
            const ventas24 = await conn.query(`
        SELECT MESDOCUMENTO as mes, COUNT(*) as lineas, SUM(IMPORTEVENTA) as total
        FROM DSEDAC.LINDTO
        WHERE ANODOCUMENTO = 2024
        GROUP BY MESDOCUMENTO
        ORDER BY MESDOCUMENTO
      `);
            ventas24.forEach(v => {
                console.log(`2024/${v.MES}: ${v.LINEAS} líneas, ${v.TOTAL?.toFixed(2)}€`);
            });
        } catch (e) {
            console.log('Error:', e.message);
        }

        // 3. Verificar clientes activos en CLI
        console.log('\n=== CLIENTES EN DSEDAC.CLI ===');
        try {
            const cli = await conn.query(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN ANOBAJA IS NULL THEN 1 ELSE 0 END) as activos,
               SUM(CASE WHEN CODIGORUTA IS NOT NULL AND CODIGORUTA <> '' THEN 1 ELSE 0 END) as conRuta
        FROM DSEDAC.CLI
      `);
            console.log(`Total: ${cli[0]?.TOTAL}, Activos: ${cli[0]?.ACTIVOS}, Con ruta: ${cli[0]?.CONRUTA}`);
        } catch (e) {
            console.log('Error:', e.message);
        }

        // 4. Verificar LACLAE - qué tipo de registros hay por día
        console.log('\n=== DSED.LACLAE - Registros por día (LCTPLN="T") ===');
        try {
            const laclae = await conn.query(`
        SELECT 
          SUM(CASE WHEN R1_T8DIVL = 'S' THEN 1 ELSE 0 END) as lunes,
          SUM(CASE WHEN R1_T8DIVM = 'S' THEN 1 ELSE 0 END) as martes,
          SUM(CASE WHEN R1_T8DIVX = 'S' THEN 1 ELSE 0 END) as miercoles,
          SUM(CASE WHEN R1_T8DIVJ = 'S' THEN 1 ELSE 0 END) as jueves,
          SUM(CASE WHEN R1_T8DIVV = 'S' THEN 1 ELSE 0 END) as viernes,
          SUM(CASE WHEN R1_T8DIVS = 'S' THEN 1 ELSE 0 END) as sabado,
          SUM(CASE WHEN R1_T8DIVD = 'S' THEN 1 ELSE 0 END) as domingo,
          COUNT(*) as total
        FROM DSED.LACLAE
        WHERE LCTPLN = 'T'
      `);
            const r = laclae[0] || {};
            console.log(`Lunes: ${r.LUNES}, Martes: ${r.MARTES}, Miércoles: ${r.MIERCOLES}`);
            console.log(`Jueves: ${r.JUEVES}, Viernes: ${r.VIERNES}, Sábado: ${r.SABADO}, Domingo: ${r.DOMINGO}`);
            console.log(`Total registros: ${r.TOTAL}`);
        } catch (e) {
            console.log('Error:', e.message);
        }

        // 5. Ver clientes únicos por día en LACLAE
        console.log('\n=== LACLAE - Clientes ÚNICOS por día ===');
        try {
            const uniqueByDay = await conn.query(`
        SELECT 
          COUNT(DISTINCT CASE WHEN R1_T8DIVL = 'S' THEN LCCDCL END) as lunes,
          COUNT(DISTINCT CASE WHEN R1_T8DIVM = 'S' THEN LCCDCL END) as martes,
          COUNT(DISTINCT CASE WHEN R1_T8DIVX = 'S' THEN LCCDCL END) as miercoles,
          COUNT(DISTINCT CASE WHEN R1_T8DIVJ = 'S' THEN LCCDCL END) as jueves,
          COUNT(DISTINCT CASE WHEN R1_T8DIVV = 'S' THEN LCCDCL END) as viernes,
          COUNT(DISTINCT CASE WHEN R1_T8DIVS = 'S' THEN LCCDCL END) as sabado,
          COUNT(DISTINCT CASE WHEN R1_T8DIVD = 'S' THEN LCCDCL END) as domingo
        FROM DSED.LACLAE
        WHERE LCTPLN = 'T'
      `);
            const r = uniqueByDay[0] || {};
            console.log(`Lunes: ${r.LUNES}, Martes: ${r.MARTES}, Miércoles: ${r.MIERCOLES}`);
            console.log(`Jueves: ${r.JUEVES}, Viernes: ${r.VIERNES}, Sábado: ${r.SABADO}, Domingo: ${r.DOMINGO}`);
        } catch (e) {
            console.log('Error:', e.message);
        }

        // 6. Ver ejemplo de cliente con datos de día
        console.log('\n=== Ejemplo: Cliente con día asignado ===');
        try {
            const ejemplo = await conn.query(`
        SELECT DISTINCT LCCDCL, R1_T8DIVL, R1_T8DIVM, R1_T8DIVD
        FROM DSED.LACLAE
        WHERE LCTPLN = 'T' AND R1_T8DIVL = 'S'
        FETCH FIRST 3 ROWS ONLY
      `);
            ejemplo.forEach(e => {
                console.log(`Cliente: ${e.LCCDCL}, L: ${e.R1_T8DIVL}, M: ${e.R1_T8DIVM}, D: ${e.R1_T8DIVD}`);
            });
        } catch (e) {
            console.log('Error:', e.message);
        }

        await conn.close();
        console.log('\n✅ Investigación completada');

    } catch (e) {
        console.error('Error de conexión:', e.message);
    }
}

main();
