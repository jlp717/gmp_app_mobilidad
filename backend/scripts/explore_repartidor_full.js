/**
 * Script para explorar completamente las tablas relacionadas con repartidor
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function exploreRepartidorTables() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('====== EXPLORANDO TABLAS DE REPARTIDOR ======\n');
        
        // 1. Ver TODAS las columnas de CLI (puede haber NOMBREFISCAL mal escrito)
        console.log('1. TODAS las columnas de DSEDAC.CLI:');
        const cliAllCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CLI'
            ORDER BY COLUMN_NAME
        `);
        cliAllCols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));
        
        // 2. Buscar columnas que contengan "NOMBRE" en CLI
        console.log('\n2. Columnas con "NOMBRE" en CLI:');
        const nombreCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CLI'
            AND COLUMN_NAME LIKE '%NOMBRE%'
        `);
        nombreCols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));
        
        // 3. Buscar si existe una tabla de USUARIOS o EMPLEADOS
        console.log('\n3. Tablas que podrían tener repartidores:');
        const tablas = await conn.query(`
            SELECT TABLE_NAME
            FROM QSYS2.SYSTABLES
            WHERE TABLE_SCHEMA = 'DSEDAC'
            AND (TABLE_NAME LIKE '%USU%' 
                 OR TABLE_NAME LIKE '%EMP%' 
                 OR TABLE_NAME LIKE '%REP%'
                 OR TABLE_NAME LIKE '%VEN%'
                 OR TABLE_NAME LIKE '%CON%')
            ORDER BY TABLE_NAME
            FETCH FIRST 30 ROWS ONLY
        `);
        tablas.forEach(t => console.log(`  - ${t.TABLE_NAME}`));
        
        // 4. Ver qué columna usar para NOMBRE del cliente
        console.log('\n4. Probando obtener nombre de cliente:');
        const testCli = await conn.query(`
            SELECT TRIM(CODIGOCLIENTE) as COD, TRIM(POBLACION) as POB
            FROM DSEDAC.CLI
            FETCH FIRST 3 ROWS ONLY
        `);
        console.log('  Sample CLI:', testCli);
        
        // 5. Verificar todas las columnas de CAC que podrían tener datos
        console.log('\n5. Columnas de CAC con datos no vacíos (sample):');
        const cacSample = await conn.query(`
            SELECT *
            FROM DSEDAC.CAC
            WHERE ANODOCUMENTO = 2026
            FETCH FIRST 1 ROWS ONLY
        `);
        if (cacSample.length > 0) {
            const row = cacSample[0];
            for (const [key, value] of Object.entries(row)) {
                if (value && String(value).trim() !== '' && String(value).trim() !== '0') {
                    console.log(`  ${key}: ${String(value).substring(0, 50)}`);
                }
            }
        }
        
        // 6. Verificar RUTA como posible campo de repartidor
        console.log('\n6. Valores de CODIGORUTA en CAC (2026):');
        const rutas = await conn.query(`
            SELECT DISTINCT TRIM(CODIGORUTA) as RUTA, COUNT(*) as CNT
            FROM DSEDAC.CAC
            WHERE ANODOCUMENTO = 2026
            GROUP BY TRIM(CODIGORUTA)
            ORDER BY CNT DESC
            FETCH FIRST 15 ROWS ONLY
        `);
        rutas.forEach(r => console.log(`  '${r.RUTA}': ${r.CNT} docs`));
        
        // 7. Ver si hay tabla USU para usuarios del sistema
        console.log('\n7. Explorando tabla USU (si existe):');
        try {
            const usuCols = await conn.query(`
                SELECT COLUMN_NAME
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'USU'
            `);
            console.log('  Columnas de USU:', usuCols.map(c => c.COLUMN_NAME).join(', '));
            
            // Buscar usuario 79
            const usu79 = await conn.query(`
                SELECT * FROM DSEDAC.USU
                WHERE TRIM(CODIGOUSUARIO) = '79' OR TRIM(CODIGOEMPLEADO) = '79' OR TRIM(CODIGOVENDEDOR) = '79'
                FETCH FIRST 1 ROWS ONLY
            `);
            if (usu79.length > 0) {
                console.log('  Usuario 79 encontrado:', Object.keys(usu79[0]).filter(k => usu79[0][k] && String(usu79[0][k]).trim()).map(k => `${k}=${usu79[0][k]}`).join(', '));
            }
        } catch (e) {
            console.log('  No accesible o no existe USU');
        }
        
        // 8. Ver todas las columnas de CODIGOCLIENTE en CAC que tengan 79
        console.log('\n8. Buscando cualquier referencia a 79 en CAC:');
        try {
            const any79 = await conn.query(`
                SELECT COUNT(*) as TOTAL
                FROM DSEDAC.CAC
                WHERE TRIM(CODIGOCLIENTEFACTURA) = '79'
                  AND ANODOCUMENTO = 2026
            `);
            console.log(`  CODIGOCLIENTEFACTURA = '79': ${any79[0]?.TOTAL || 0} registros`);
        } catch (e) {
            console.log('  ERROR:', e.message.substring(0, 60));
        }
        
        console.log('\n====== FIN EXPLORACIÓN ======');
        
    } finally {
        await conn.close();
    }
}

exploreRepartidorTables().catch(err => {
    console.error('Error fatal:', err.message);
    process.exit(1);
});
