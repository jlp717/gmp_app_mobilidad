/**
 * Script para explorar las tablas FI1-FI5 y entender su estructura jerárquica
 */
const { query, initDb } = require('../config/db');

async function exploreFITables() {
    // Inicializar conexión a la base de datos
    await initDb();
    console.log('✅ Base de datos conectada\n');
    console.log('='.repeat(80));
    console.log('EXPLORANDO TABLAS FI1-FI5 PARA JERARQUÍA DE ARTÍCULOS');
    console.log('='.repeat(80));

    // 1. Explorar estructura de cada tabla
    const tables = ['FI1', 'FI2', 'FI3', 'FI4', 'FI5'];
    
    for (const table of tables) {
        console.log(`\n${'='.repeat(40)}`);
        console.log(`TABLA: DSEDAC.${table}`);
        console.log('='.repeat(40));
        
        try {
            // Obtener columnas de la tabla
            const columns = await query(`
                SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE
                FROM QSYS2.SYSCOLUMNS 
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${table}'
                ORDER BY ORDINAL_POSITION
            `);
            
            console.log('\n📋 COLUMNAS:');
            columns.forEach(col => {
                console.log(`   - ${col.COLUMN_NAME} (${col.DATA_TYPE}, len=${col.LENGTH})`);
            });
            
            // Obtener muestra de datos
            const sample = await query(`SELECT * FROM DSEDAC.${table} FETCH FIRST 10 ROWS ONLY`);
            console.log(`\n📊 MUESTRA DE DATOS (${sample.length} filas):`);
            if (sample.length > 0) {
                console.log('   Columnas:', Object.keys(sample[0]).join(', '));
                sample.forEach((row, i) => {
                    console.log(`   [${i+1}]`, JSON.stringify(row));
                });
            }
            
            // Contar registros totales
            const countResult = await query(`SELECT COUNT(*) as TOTAL FROM DSEDAC.${table}`);
            console.log(`\n📈 TOTAL REGISTROS: ${countResult[0]?.TOTAL || 0}`);
            
        } catch (err) {
            console.log(`❌ Error explorando ${table}:`, err.message);
        }
    }
    
    // 2. Explorar cómo se relacionan los artículos con FI
    console.log('\n\n' + '='.repeat(80));
    console.log('EXPLORANDO RELACIÓN ARTÍCULOS - CLASIFICACIÓN FI');
    console.log('='.repeat(80));
    
    try {
        // Ver estructura de tabla de artículos principal
        const artColumns = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'ART'
            AND (COLUMN_NAME LIKE '%FI%' OR COLUMN_NAME LIKE '%FAM%' OR COLUMN_NAME LIKE '%COD%' OR COLUMN_NAME LIKE '%TIPO%')
            ORDER BY ORDINAL_POSITION
        `);
        
        console.log('\n📋 COLUMNAS RELEVANTES EN DSEDAC.ART:');
        artColumns.forEach(col => {
            console.log(`   - ${col.COLUMN_NAME} (${col.DATA_TYPE}, len=${col.LENGTH})`);
        });
        
        // Muestra de artículos con campos FI
        const artSample = await query(`
            SELECT CODIGOARTICULO, FI1, FI2, FI3, FI4, FI5, DESCRIPCION
            FROM DSEDAC.ART 
            WHERE FI1 IS NOT NULL AND TRIM(FI1) <> ''
            FETCH FIRST 15 ROWS ONLY
        `);
        
        console.log('\n📊 MUESTRA ARTÍCULOS CON CLASIFICACIÓN FI:');
        artSample.forEach((art, i) => {
            console.log(`   [${i+1}] ${art.CODIGOARTICULO}: FI1=${art.FI1}, FI2=${art.FI2}, FI3=${art.FI3}, FI4=${art.FI4}, FI5=${art.FI5}`);
            console.log(`       Desc: ${art.DESCRIPCION?.substring(0, 50)}...`);
        });
        
    } catch (err) {
        console.log('❌ Error explorando ART:', err.message);
    }
    
    // 3. Explorar LACLAE para ver si tiene campos FI
    console.log('\n\n' + '='.repeat(80));
    console.log('EXPLORANDO LACLAE Y SU RELACIÓN CON FI');
    console.log('='.repeat(80));
    
    try {
        const laclaeColumns = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LACLAE'
            ORDER BY ORDINAL_POSITION
            FETCH FIRST 30 ROWS ONLY
        `);
        
        console.log('\n📋 COLUMNAS EN LACLAE (primeras 30):');
        laclaeColumns.forEach(col => {
            console.log(`   - ${col.COLUMN_NAME} (${col.DATA_TYPE}, len=${col.LENGTH})`);
        });
        
    } catch (err) {
        console.log('❌ Error explorando LACLAE:', err.message);
    }
    
    // 4. Ver valores únicos en cada nivel FI de los artículos
    console.log('\n\n' + '='.repeat(80));
    console.log('VALORES ÚNICOS DE FI EN ARTÍCULOS');
    console.log('='.repeat(80));
    
    for (let i = 1; i <= 5; i++) {
        try {
            const uniqueValues = await query(`
                SELECT DISTINCT TRIM(FI${i}) as FI_VALUE, COUNT(*) as CNT
                FROM DSEDAC.ART 
                WHERE FI${i} IS NOT NULL AND TRIM(FI${i}) <> ''
                GROUP BY TRIM(FI${i})
                ORDER BY CNT DESC
                FETCH FIRST 20 ROWS ONLY
            `);
            
            console.log(`\n📊 FI${i} - Valores únicos (top 20):`);
            uniqueValues.forEach(v => {
                console.log(`   - "${v.FI_VALUE}" (${v.CNT} artículos)`);
            });
            
        } catch (err) {
            console.log(`❌ Error con FI${i}:`, err.message);
        }
    }
    
    // 5. Verificar jerarquía: cómo FI2 depende de FI1, etc.
    console.log('\n\n' + '='.repeat(80));
    console.log('VERIFICANDO JERARQUÍA FI1 → FI2 → FI3...');
    console.log('='.repeat(80));
    
    try {
        // Ver estructura de FI2 para entender dependencia de FI1
        const fi2Structure = await query(`
            SELECT * FROM DSEDAC.FI2 FETCH FIRST 5 ROWS ONLY
        `);
        
        if (fi2Structure.length > 0) {
            console.log('\n🔗 Estructura FI2 (para ver campo padre):');
            console.log('   Columnas:', Object.keys(fi2Structure[0]).join(', '));
            fi2Structure.forEach((row, i) => {
                console.log(`   [${i+1}]`, JSON.stringify(row));
            });
        }
        
        // Ver combinaciones FI1-FI2 en artículos
        const combos = await query(`
            SELECT TRIM(FI1) as FI1, TRIM(FI2) as FI2, COUNT(*) as CNT
            FROM DSEDAC.ART 
            WHERE FI1 IS NOT NULL AND TRIM(FI1) <> ''
            GROUP BY TRIM(FI1), TRIM(FI2)
            ORDER BY FI1, FI2
            FETCH FIRST 30 ROWS ONLY
        `);
        
        console.log('\n🔗 Combinaciones FI1 → FI2 en artículos:');
        combos.forEach(c => {
            console.log(`   FI1="${c.FI1}" → FI2="${c.FI2}" (${c.CNT} arts)`);
        });
        
    } catch (err) {
        console.log('❌ Error verificando jerarquía:', err.message);
    }

    console.log('\n\n✅ Exploración completada');
    process.exit(0);
}

exploreFITables().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
});
