/**
 * Script para verificar el schema de las tablas de repartidor
 * Verifica columnas en CAC, CVC, CLI para los endpoints de collections/history
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function verifySchema() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('====== VERIFICANDO SCHEMA PARA REPARTIDOR ======\n');
        
        // 1. Verificar columnas de CAC (Cabecera de Albaranes/Facturas)
        console.log('1. COLUMNAS EN DSEDAC.CAC (relevantes para repartidor):');
        const cacCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CAC'
            AND COLUMN_NAME IN (
                'CODIGOCLIENTEFACTURA', 'TRANSPORTISTA1ALBARAN', 'CODIGOVENDEDORCONDUCTOR',
                'ANODOCUMENTO', 'MESDOCUMENTO', 'DIADOCUMENTO',
                'IMPORTETOTAL', 'CODIGOFORMAPAGO', 'SUBEMPRESAALBARAN',
                'EJERCICIOALBARAN', 'SERIEALBARAN', 'NUMEROALBARAN',
                'SERIEFACTURA', 'NUMEROFACTURA', 'CODIGORUTA'
            )
            ORDER BY COLUMN_NAME
        `);
        cacCols.forEach(c => console.log(`  - ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));
        
        // 2. Verificar columnas de CVC (Control de Cobros/Vencimientos)
        console.log('\n2. COLUMNAS EN DSEDAC.CVC (cobros):');
        const cvcCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CVC'
            AND COLUMN_NAME IN (
                'SUBEMPRESADOCUMENTO', 'EJERCICIODOCUMENTO', 'SERIEDOCUMENTO',
                'NUMERODOCUMENTO', 'IMPORTEPENDIENTE', 'IMPORTECOBRADO'
            )
            ORDER BY COLUMN_NAME
        `);
        cvcCols.forEach(c => console.log(`  - ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));
        
        // 3. Verificar columnas de CLI (Clientes)
        console.log('\n3. COLUMNAS EN DSEDAC.CLI (clientes):');
        const cliCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CLI'
            AND COLUMN_NAME IN (
                'CODIGOCLIENTE', 'NOMBREFISCAL', 'NOMBRECOMERCIAL',
                'DIRECCION1', 'POBLACION', 'TELEFONO'
            )
            ORDER BY COLUMN_NAME
        `);
        cliCols.forEach(c => console.log(`  - ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));
        
        // 4. Verificar si TRANSPORTISTA1ALBARAN existe
        console.log('\n4. VERIFICANDO CAMPO TRANSPORTISTA:');
        const transportista = await conn.query(`
            SELECT COLUMN_NAME
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CAC'
            AND COLUMN_NAME LIKE '%TRANSPORT%'
        `);
        if (transportista.length > 0) {
            console.log('  Columnas de transportista encontradas:');
            transportista.forEach(c => console.log(`    - ${c.COLUMN_NAME}`));
        } else {
            console.log('  ⚠️ NO SE ENCONTRARON COLUMNAS DE TRANSPORTISTA');
            console.log('  Buscando alternativas (VENDEDOR, CONDUCTOR)...');
            const alternativas = await conn.query(`
                SELECT COLUMN_NAME
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CAC'
                AND (COLUMN_NAME LIKE '%VENDEDOR%' OR COLUMN_NAME LIKE '%CONDUCTOR%' OR COLUMN_NAME LIKE '%REPARTIDOR%')
            `);
            alternativas.forEach(c => console.log(`    - ${c.COLUMN_NAME}`));
        }
        
        // 5. Test query de collections/summary simplificada
        console.log('\n5. PROBANDO QUERY DE COLLECTIONS SUMMARY (simplificada):');
        try {
            const testCollections = await conn.query(`
                SELECT 
                    TRIM(CAC.CODIGOCLIENTEFACTURA) as CLIENTE,
                    COUNT(*) as NUM_DOCS
                FROM DSEDAC.CAC CAC
                WHERE CAC.ANODOCUMENTO = 2026
                  AND CAC.MESDOCUMENTO = 1
                GROUP BY TRIM(CAC.CODIGOCLIENTEFACTURA)
                FETCH FIRST 5 ROWS ONLY
            `);
            console.log('  ✅ Query básica funciona, filas:', testCollections.length);
        } catch (e) {
            console.log('  ❌ Error en query básica:', e.message);
        }
        
        // 6. Test query de history/clients simplificada
        console.log('\n6. PROBANDO QUERY DE HISTORY CLIENTS (simplificada):');
        try {
            const testHistory = await conn.query(`
                SELECT DISTINCT
                    TRIM(CAC.CODIGOCLIENTEFACTURA) as CLIENTE
                FROM DSEDAC.CAC CAC
                WHERE CAC.ANODOCUMENTO >= 2025
                FETCH FIRST 5 ROWS ONLY
            `);
            console.log('  ✅ Query básica funciona, filas:', testHistory.length);
        } catch (e) {
            console.log('  ❌ Error en query básica:', e.message);
        }
        
        // 7. Verificar si existe data para repartidor ID 79
        console.log('\n7. VERIFICANDO DATA PARA REPARTIDOR ID 79:');
        
        // Primero con TRANSPORTISTA1ALBARAN
        try {
            const dataTransportista = await conn.query(`
                SELECT COUNT(*) as TOTAL
                FROM DSEDAC.CAC
                WHERE TRIM(TRANSPORTISTA1ALBARAN) = '79'
                  AND ANODOCUMENTO = 2026
            `);
            console.log(`  Con TRANSPORTISTA1ALBARAN='79': ${dataTransportista[0]?.TOTAL || 0} registros`);
        } catch (e) {
            console.log('  ❌ TRANSPORTISTA1ALBARAN no válida:', e.message.substring(0, 80));
        }
        
        // También con CODIGOVENDEDORCONDUCTOR
        try {
            const dataVendedor = await conn.query(`
                SELECT COUNT(*) as TOTAL
                FROM DSEDAC.CAC
                WHERE TRIM(CODIGOVENDEDORCONDUCTOR) = '79'
                  AND ANODOCUMENTO = 2026
            `);
            console.log(`  Con CODIGOVENDEDORCONDUCTOR='79': ${dataVendedor[0]?.TOTAL || 0} registros`);
        } catch (e) {
            console.log('  ❌ CODIGOVENDEDORCONDUCTOR no válida:', e.message.substring(0, 80));
        }
        
        console.log('\n====== FIN VERIFICACIÓN ======');
        
    } finally {
        await conn.close();
    }
}

verifySchema().catch(err => {
    console.error('Error fatal:', err.message);
    process.exit(1);
});
