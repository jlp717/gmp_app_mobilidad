/**
 * Script para entender la relación entre artículos y filtros FI1-FI5
 */
const { query, initDb } = require('../config/db');

async function exploreFIRelation() {
    await initDb();
    console.log('✅ Base de datos conectada\n');

    console.log('='.repeat(80));
    console.log('BUSCANDO CÓMO SE RELACIONAN ARTÍCULOS CON FILTROS FI');
    console.log('='.repeat(80));

    // 1. Buscar tablas que contengan relaciones con FI
    console.log('\n📋 Buscando tablas con columnas FI:');
    try {
        const fiTables = await query(`
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' 
            AND (COLUMN_NAME LIKE '%FI1%' OR COLUMN_NAME LIKE '%FI2%' OR COLUMN_NAME LIKE 'FI%' OR COLUMN_NAME LIKE '%FILTRO%')
            ORDER BY TABLE_NAME, COLUMN_NAME
            FETCH FIRST 50 ROWS ONLY
        `);
        
        fiTables.forEach(t => {
            console.log(`   ${t.TABLE_NAME}.${t.COLUMN_NAME} (${t.DATA_TYPE}, len=${t.LENGTH})`);
        });
    } catch (err) {
        console.log('❌ Error:', err.message);
    }

    // 2. Buscar tablas que relacionen artículos con filtros
    console.log('\n📋 Buscando tablas de relación artículo-filtro:');
    try {
        const relTables = await query(`
            SELECT TABLE_NAME
            FROM QSYS2.SYSTABLES 
            WHERE TABLE_SCHEMA = 'DSEDAC' 
            AND (TABLE_NAME LIKE '%FIL%' OR TABLE_NAME LIKE '%FI%ART%' OR TABLE_NAME LIKE '%ART%FI%' OR TABLE_NAME LIKE '%RELA%')
            ORDER BY TABLE_NAME
            FETCH FIRST 20 ROWS ONLY
        `);
        
        for (const t of relTables) {
            console.log(`\n   📁 Tabla: ${t.TABLE_NAME}`);
            const cols = await query(`
                SELECT COLUMN_NAME, DATA_TYPE, LENGTH
                FROM QSYS2.SYSCOLUMNS 
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${t.TABLE_NAME}'
                ORDER BY ORDINAL_POSITION
            `);
            cols.forEach(c => console.log(`      - ${c.COLUMN_NAME} (${c.DATA_TYPE}, len=${c.LENGTH})`));
        }
    } catch (err) {
        console.log('❌ Error:', err.message);
    }

    // 3. Analizar patrón de códigos en FI1-FI5
    console.log('\n' + '='.repeat(80));
    console.log('ANALIZANDO PATRÓN DE CÓDIGOS EN FI1-FI5');
    console.log('='.repeat(80));
    
    // Obtener todos los códigos FI1
    const fi1Codes = await query(`SELECT TRIM(CODIGOFILTRO) as COD, TRIM(DESCRIPCIONFILTRO) as DESC FROM DSEDAC.FI1 ORDER BY CODIGOFILTRO`);
    console.log('\n📊 TODOS LOS CÓDIGOS FI1 (NIVEL 1):');
    fi1Codes.forEach(f => console.log(`   ${f.COD}: ${f.DESC}`));

    // Ver FI2 y analizar si el prefijo corresponde a FI1
    console.log('\n📊 ANÁLISIS DE FI2 - verificando si prefijo = FI1:');
    const fi2Sample = await query(`SELECT TRIM(CODIGOFILTRO) as COD, TRIM(DESCRIPCIONFILTRO) as DESC FROM DSEDAC.FI2 ORDER BY CODIGOFILTRO FETCH FIRST 30 ROWS ONLY`);
    fi2Sample.forEach(f => {
        const prefix4 = f.COD.substring(0, 4);
        const matchingFi1 = fi1Codes.find(fi1 => fi1.COD.trim() === prefix4);
        console.log(`   FI2: ${f.COD} (${f.DESC}) → Prefijo(4): ${prefix4} → FI1 match: ${matchingFi1 ? matchingFi1.DESC : 'NO'}`);
    });

    // 4. Buscar tabla ARTFIL o similar
    console.log('\n' + '='.repeat(80));
    console.log('BUSCANDO TABLA DE ARTÍCULOS CON FILTROS (ARTFIL, etc.)');
    console.log('='.repeat(80));
    
    try {
        const artFilTables = await query(`
            SELECT TABLE_NAME
            FROM QSYS2.SYSTABLES 
            WHERE TABLE_SCHEMA = 'DSEDAC' 
            AND (TABLE_NAME LIKE '%ARTFIL%' OR TABLE_NAME LIKE '%ARFI%' OR TABLE_NAME LIKE '%ARTFI%')
            ORDER BY TABLE_NAME
        `);
        
        if (artFilTables.length > 0) {
            for (const t of artFilTables) {
                console.log(`\n📁 Encontrada tabla: ${t.TABLE_NAME}`);
                const cols = await query(`
                    SELECT COLUMN_NAME, DATA_TYPE, LENGTH
                    FROM QSYS2.SYSCOLUMNS 
                    WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${t.TABLE_NAME}'
                    ORDER BY ORDINAL_POSITION
                `);
                cols.forEach(c => console.log(`   - ${c.COLUMN_NAME} (${c.DATA_TYPE}, len=${c.LENGTH})`));
                
                // Muestra de datos
                const sample = await query(`SELECT * FROM DSEDAC.${t.TABLE_NAME} FETCH FIRST 10 ROWS ONLY`);
                console.log(`\n   Muestra de datos (${sample.length} filas):`);
                sample.forEach((row, i) => console.log(`   [${i+1}]`, JSON.stringify(row)));
            }
        } else {
            console.log('No se encontraron tablas ARTFIL específicas');
        }
    } catch (err) {
        console.log('❌ Error:', err.message);
    }

    // 5. Buscar en JAVIER schema también
    console.log('\n' + '='.repeat(80));
    console.log('BUSCANDO EN SCHEMA JAVIER');
    console.log('='.repeat(80));
    
    try {
        const javierFI = await query(`
            SELECT TABLE_NAME
            FROM QSYS2.SYSTABLES 
            WHERE TABLE_SCHEMA = 'JAVIER' 
            AND TABLE_NAME LIKE '%FI%'
            ORDER BY TABLE_NAME
        `);
        
        javierFI.forEach(t => console.log(`   ${t.TABLE_NAME}`));
    } catch (err) {
        console.log('❌ Error:', err.message);
    }

    // 6. Explorar la vista o tabla ARTFIL que debe existir
    console.log('\n' + '='.repeat(80));
    console.log('BUSCANDO TABLA/VISTA CON ARTÍCULOS Y FILTROS ASIGNADOS');
    console.log('='.repeat(80));
    
    try {
        // Buscar tablas que tengan columnas para articulo Y filtro
        const artFilterTables = await query(`
            SELECT DISTINCT c1.TABLE_NAME
            FROM QSYS2.SYSCOLUMNS c1
            INNER JOIN QSYS2.SYSCOLUMNS c2 ON c1.TABLE_NAME = c2.TABLE_NAME AND c1.TABLE_SCHEMA = c2.TABLE_SCHEMA
            WHERE c1.TABLE_SCHEMA = 'DSEDAC'
            AND c1.COLUMN_NAME LIKE '%ART%'
            AND c2.COLUMN_NAME LIKE '%FIL%'
            FETCH FIRST 10 ROWS ONLY
        `);
        
        for (const t of artFilterTables) {
            console.log(`\n📁 ${t.TABLE_NAME}:`);
            const cols = await query(`
                SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS 
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${t.TABLE_NAME}'
            `);
            console.log('   Columnas:', cols.map(c => c.COLUMN_NAME).join(', '));
            
            const sample = await query(`SELECT * FROM DSEDAC.${t.TABLE_NAME} FETCH FIRST 5 ROWS ONLY`);
            sample.forEach((row, i) => console.log(`   [${i+1}]`, JSON.stringify(row)));
        }
    } catch (err) {
        console.log('❌ Error:', err.message);
    }

    // 7. Verificar estructura ART completa
    console.log('\n' + '='.repeat(80));
    console.log('TODAS LAS COLUMNAS DE DSEDAC.ART');
    console.log('='.repeat(80));
    
    try {
        const artCols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'ART'
            ORDER BY ORDINAL_POSITION
        `);
        
        artCols.forEach(c => console.log(`   ${c.COLUMN_NAME} (${c.DATA_TYPE}, len=${c.LENGTH})`));
        
        // Muestra de artículo con todos sus campos
        console.log('\n   Muestra de un artículo:');
        const artSample = await query(`SELECT * FROM DSEDAC.ART FETCH FIRST 1 ROWS ONLY`);
        if (artSample.length > 0) {
            Object.entries(artSample[0]).forEach(([k, v]) => {
                if (v && String(v).trim()) console.log(`   ${k}: "${v}"`);
            });
        }
    } catch (err) {
        console.log('❌ Error:', err.message);
    }

    console.log('\n\n✅ Exploración completada');
    process.exit(0);
}

exploreFIRelation().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
});
