/**
 * Script para encontrar la columna correcta para repartidor ID 79
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function findRepartidor79() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('====== BUSCANDO REPARTIDOR ID 79 ======\n');
        
        // 1. Verificar todas las columnas relacionadas con vendedor/conductor/repartidor
        const columnas = [
            'CODIGOVENDEDOR',
            'CODIGOVENDEDORCOBRO',
            'CODIGOVENDEDORUSUARIO',
            'CODIGOCONDUCTOR',
            'CODIGOVENDEDORREPARTORUTERO',
            'CODIGOVENDEDORCONDUCTOR'
        ];
        
        for (const col of columnas) {
            try {
                const result = await conn.query(`
                    SELECT COUNT(*) as TOTAL
                    FROM DSEDAC.CAC
                    WHERE TRIM(${col}) = '79'
                      AND ANODOCUMENTO >= 2025
                `);
                console.log(`${col} = '79': ${result[0]?.TOTAL || 0} registros (2025+)`);
            } catch (e) {
                console.log(`${col}: ERROR - ${e.message.substring(0, 60)}`);
            }
        }
        
        // 2. Verificar si 79 podría tener ceros adelante (ej: '079' o '0079')
        console.log('\n=== Verificando formatos alternativos del ID 79 ===');
        const formatos = ['79', '079', '0079', ' 79'];
        for (const fmt of formatos) {
            try {
                const result = await conn.query(`
                    SELECT COUNT(*) as TOTAL
                    FROM DSEDAC.CAC
                    WHERE TRIM(CODIGOVENDEDORCONDUCTOR) = '${fmt}'
                      AND ANODOCUMENTO >= 2025
                `);
                console.log(`CODIGOVENDEDORCONDUCTOR = '${fmt}': ${result[0]?.TOTAL || 0} registros`);
            } catch (e) {
                console.log(`Formato '${fmt}': ERROR`);
            }
        }
        
        // 3. Ver qué valores hay realmente en CODIGOVENDEDORCONDUCTOR
        console.log('\n=== Valores distintos en CODIGOVENDEDORCONDUCTOR (2026) ===');
        const valores = await conn.query(`
            SELECT DISTINCT TRIM(CODIGOVENDEDORCONDUCTOR) as COD, COUNT(*) as CNT
            FROM DSEDAC.CAC
            WHERE ANODOCUMENTO = 2026
            GROUP BY TRIM(CODIGOVENDEDORCONDUCTOR)
            ORDER BY CNT DESC
            FETCH FIRST 20 ROWS ONLY
        `);
        valores.forEach(v => console.log(`  '${v.COD}': ${v.CNT} docs`));
        
        // 4. Verificar CODIGOVENDEDORREPARTORUTERO para el 79
        console.log('\n=== Verificando CODIGOVENDEDORREPARTORUTERO ===');
        try {
            const repartidorResult = await conn.query(`
                SELECT COUNT(*) as TOTAL
                FROM DSEDAC.CAC
                WHERE TRIM(CODIGOVENDEDORREPARTORUTERO) = '79'
                  AND ANODOCUMENTO >= 2025
            `);
            console.log(`CODIGOVENDEDORREPARTORUTERO = '79': ${repartidorResult[0]?.TOTAL || 0} registros`);
            
            // Ver valores distintos
            const valoresRep = await conn.query(`
                SELECT DISTINCT TRIM(CODIGOVENDEDORREPARTORUTERO) as COD, COUNT(*) as CNT
                FROM DSEDAC.CAC
                WHERE ANODOCUMENTO = 2026
                GROUP BY TRIM(CODIGOVENDEDORREPARTORUTERO)
                ORDER BY CNT DESC
                FETCH FIRST 20 ROWS ONLY
            `);
            console.log('\nValores en CODIGOVENDEDORREPARTORUTERO (2026):');
            valoresRep.forEach(v => console.log(`  '${v.COD}': ${v.CNT} docs`));
        } catch (e) {
            console.log(`ERROR: ${e.message}`);
        }
        
        // 5. Verificar si hay tabla de VEN (Vendedores) con ID 79
        console.log('\n=== Verificando tabla VEN (Vendedores) ===');
        try {
            const vendedor79 = await conn.query(`
                SELECT CODIGOVENDEDOR, NOMBREFISCAL, NOMBRECOMERCIAL
                FROM DSEDAC.VEN
                WHERE TRIM(CODIGOVENDEDOR) = '79'
            `);
            if (vendedor79.length > 0) {
                console.log('Vendedor 79 encontrado:', vendedor79[0]);
            } else {
                console.log('Vendedor 79 NO encontrado en VEN. Listando vendedores:');
                const vendedores = await conn.query(`
                    SELECT TRIM(CODIGOVENDEDOR) as COD, TRIM(NOMBREFISCAL) as NOMBRE
                    FROM DSEDAC.VEN
                    WHERE CODIGOVENDEDOR IS NOT NULL
                    ORDER BY CODIGOVENDEDOR
                    FETCH FIRST 30 ROWS ONLY
                `);
                vendedores.forEach(v => console.log(`  '${v.COD}': ${v.NOMBRE}`));
            }
        } catch (e) {
            console.log(`ERROR accediendo a VEN: ${e.message}`);
        }
        
        console.log('\n====== FIN BÚSQUEDA ======');
        
    } finally {
        await conn.close();
    }
}

findRepartidor79().catch(err => {
    console.error('Error fatal:', err.message);
    process.exit(1);
});
