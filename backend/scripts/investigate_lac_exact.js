/**
 * Investigar estructura exacta de LAC para vincular correctamente
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║              ESTRUCTURA EXACTA DE LAC                          ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        // 1. Todas las columnas de LAC
        console.log('1. COLUMNAS DE LAC:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const lacCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LAC'
            ORDER BY ORDINAL_POSITION
        `);
        
        lacCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 2. Sample de LAC con ORDENPREPARACION no vacío
        console.log('\n\n2. SAMPLE DE LAC CON ORDENPREPARACION:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const lacSample = await conn.query(`
            SELECT * FROM DSEDAC.LAC
            WHERE ORDENPREPARACION IS NOT NULL
              AND ORDENPREPARACION > 0
            FETCH FIRST 1 ROWS ONLY
        `);
        
        if (lacSample.length > 0) {
            Object.entries(lacSample[0]).forEach(([k, v]) => {
                if (v !== null && (typeof v !== 'string' || v.trim() !== '')) {
                    console.log(`   ${k}: ${v}`);
                }
            });
        }

        // 3. Buscar columnas que vinculen LAC con CAC
        console.log('\n\n3. COLUMNAS LAC QUE VINCULAN CON CAC:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const lacVinculoCols = lacCols.filter(c => 
            c.COLUMN_NAME.includes('DOCUMENTO') || 
            c.COLUMN_NAME.includes('EJERCICIO') ||
            c.COLUMN_NAME.includes('NUM') ||
            c.COLUMN_NAME.includes('SERIE')
        );
        
        lacVinculoCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 4. Si LAC usa SUBEMPRESA, SERIE, TERMINAL, NUMERO para vincular
        console.log('\n\n4. VERIFICAR VINCULO USANDO CAMPOS DE ALBARAN:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        // Buscar columnas en LAC que empiecen con SUBEMPRESA, SERIE, etc
        const lacAlbCols = lacCols.filter(c => 
            c.COLUMN_NAME.includes('SUBEMPRESA') ||
            c.COLUMN_NAME.includes('SERIE') ||
            c.COLUMN_NAME.includes('TERMINAL') ||
            c.COLUMN_NAME.includes('NUMERO')
        );
        
        console.log('   Columnas de albarán en LAC:');
        lacAlbCols.forEach(c => console.log(`       ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 5. Columnas de albarán en CAC
        console.log('\n\n5. COLUMNAS DE ALBARAN EN CAC:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const cacAlbCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'CAC'
              AND (COLUMN_NAME LIKE '%ALBARAN%' 
                   OR COLUMN_NAME IN ('SUBEMPRESA', 'EJERCICIO', 'CODIGOSERIE', 'TERMINAL', 'NUMDOCUMENTO'))
            ORDER BY COLUMN_NAME
        `);
        
        cacAlbCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 6. Sample LAC para orden 1732 (del repartidor 79)
        console.log('\n\n6. BUSCAR LAC CON ORDENPREPARACION = 1732:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const lac1732 = await conn.query(`
            SELECT 
                SUBEMPRESA, EJERCICIOFACTURA, SERIEFACTURA, TERMINALFACTURA, NUMEROFACTURA,
                ORDENPREPARACION, TRIM(CODIGOCLIENTE) as CLIENTE,
                TRIM(CODIGOARTICULO) as ARTICULO
            FROM DSEDAC.LAC
            WHERE ORDENPREPARACION = 1732
            FETCH FIRST 5 ROWS ONLY
        `);
        
        if (lac1732.length > 0) {
            console.log('   ¡ENCONTRADO!');
            lac1732.forEach((r, i) => {
                console.log(`   [${i+1}] Factura: ${r.EJERCICIOFACTURA}-${r.SERIEFACTURA}-${r.TERMINALFACTURA}-${r.NUMEROFACTURA}`);
                console.log(`       Cliente: ${r.CLIENTE}, Artículo: ${r.ARTICULO}`);
            });
        } else {
            console.log('   No encontrado con esa orden');
        }

        // 7. Si no funciona, ver todos los valores de ORDENPREPARACION
        console.log('\n\n7. VERIFICAR SI HAY DATOS RECIENTES CON ORDENPREPARACION:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const lacOrdStats = await conn.query(`
            SELECT 
                MAX(ORDENPREPARACION) as MAX_ORDEN,
                COUNT(*) as TOTAL_CON_ORDEN
            FROM DSEDAC.LAC
            WHERE ORDENPREPARACION IS NOT NULL
              AND ORDENPREPARACION > 0
        `);
        
        console.log(`   Máximo ORDENPREPARACION en LAC: ${lacOrdStats[0]?.MAX_ORDEN || 'N/A'}`);
        console.log(`   Total líneas con ORDENPREPARACION: ${lacOrdStats[0]?.TOTAL_CON_ORDEN || 0}`);

        // 8. Ver rango de órdenes en OPP 2026
        console.log('\n\n8. RANGO DE ORDENPREPARACION EN OPP 2026:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const oppOrdRange = await conn.query(`
            SELECT 
                MIN(NUMEROORDENPREPARACION) as MIN_ORD,
                MAX(NUMEROORDENPREPARACION) as MAX_ORD
            FROM DSEDAC.OPP
            WHERE EJERCICIOORDENPREPARACION = 2026
        `);
        
        console.log(`   Rango en OPP 2026: ${oppOrdRange[0]?.MIN_ORD} - ${oppOrdRange[0]?.MAX_ORD}`);

        console.log('\n════════════════════════════════════════════════════════════════\n');
        
    } finally {
        await conn.close();
    }
}

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
