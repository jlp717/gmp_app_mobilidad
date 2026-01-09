/**
 * Script para ver la relación completa entre ARTX y FI1-FI4
 */
const { query, initDb } = require('../config/db');

async function exploreFullRelation() {
    await initDb();
    console.log('✅ Base de datos conectada\n');

    console.log('='.repeat(80));
    console.log('RELACIÓN COMPLETA ARTX ↔ FI1-FI4');
    console.log('='.repeat(80));

    // 1. Ver artículos con sus filtros y resolverlos
    console.log('\n📊 ARTÍCULOS CON FILTROS RESUELTOS:');
    try {
        const arts = await query(`
            SELECT 
                a.CODIGOARTICULO,
                a.DESCRIPCIONARTICULO,
                x.FILTRO01 as F1,
                x.FILTRO02 as F2,
                x.FILTRO03 as F3,
                x.FILTRO04 as F4,
                f1.DESCRIPCIONFILTRO as DESC_F1,
                f2.DESCRIPCIONFILTRO as DESC_F2,
                f3.DESCRIPCIONFILTRO as DESC_F3,
                f4.DESCRIPCIONFILTRO as DESC_F4
            FROM DSEDAC.ART a
            INNER JOIN DSEDAC.ARTX x ON a.CODIGOARTICULO = x.CODIGOARTICULO
            LEFT JOIN DSEDAC.FI1 f1 ON TRIM(x.FILTRO01) = TRIM(f1.CODIGOFILTRO)
            LEFT JOIN DSEDAC.FI2 f2 ON TRIM(x.FILTRO02) = TRIM(f2.CODIGOFILTRO)
            LEFT JOIN DSEDAC.FI3 f3 ON TRIM(x.FILTRO03) = TRIM(f3.CODIGOFILTRO)
            LEFT JOIN DSEDAC.FI4 f4 ON TRIM(x.FILTRO04) = TRIM(f4.CODIGOFILTRO)
            WHERE x.FILTRO01 IS NOT NULL AND TRIM(x.FILTRO01) <> ''
            AND a.BLOQUEADOSN <> 'S'
            FETCH FIRST 20 ROWS ONLY
        `);
        
        arts.forEach((art, i) => {
            console.log(`\n[${i+1}] ${art.CODIGOARTICULO?.trim()}: ${art.DESCRIPCIONARTICULO?.trim().substring(0, 40)}`);
            console.log(`    F1: ${art.F1?.trim()} → ${art.DESC_F1?.trim() || '(sin descripción)'}`);
            console.log(`    F2: ${art.F2?.trim()} → ${art.DESC_F2?.trim() || '(sin descripción)'}`);
            console.log(`    F3: ${art.F3?.trim()} → ${art.DESC_F3?.trim() || '(sin descripción)'}`);
            console.log(`    F4: ${art.F4?.trim()} → ${art.DESC_F4?.trim() || '(sin descripción)'}`);
        });
    } catch (err) {
        console.log('❌ Error:', err.message);
    }

    // 2. Ver todos los valores únicos de FILTRO01 (FI1) usados
    console.log('\n\n' + '='.repeat(80));
    console.log('VALORES ÚNICOS DE FILTRO01 (FI1) EN USO');
    console.log('='.repeat(80));
    
    try {
        const f1Values = await query(`
            SELECT TRIM(x.FILTRO01) as COD, f.DESCRIPCIONFILTRO as DESC, COUNT(*) as CNT
            FROM DSEDAC.ARTX x
            LEFT JOIN DSEDAC.FI1 f ON TRIM(x.FILTRO01) = TRIM(f.CODIGOFILTRO)
            WHERE x.FILTRO01 IS NOT NULL AND TRIM(x.FILTRO01) <> ''
            GROUP BY TRIM(x.FILTRO01), f.DESCRIPCIONFILTRO
            ORDER BY CNT DESC
        `);
        
        console.log(`\nTotal valores únicos FI1: ${f1Values.length}`);
        f1Values.forEach(v => {
            console.log(`   ${v.COD}: ${v.DESC?.trim() || '(sin desc)'} → ${v.CNT} artículos`);
        });
    } catch (err) {
        console.log('❌ Error:', err.message);
    }

    // 3. Para un FI1 específico, ver qué FI2 tiene
    console.log('\n\n' + '='.repeat(80));
    console.log('CASCADA: FI1="1010" (PRODUCTOS DEL MAR) → FI2');
    console.log('='.repeat(80));
    
    try {
        const f2ForF1 = await query(`
            SELECT TRIM(x.FILTRO02) as COD, f.DESCRIPCIONFILTRO as DESC, COUNT(*) as CNT
            FROM DSEDAC.ARTX x
            LEFT JOIN DSEDAC.FI2 f ON TRIM(x.FILTRO02) = TRIM(f.CODIGOFILTRO)
            WHERE TRIM(x.FILTRO01) = '1010'
            AND x.FILTRO02 IS NOT NULL AND TRIM(x.FILTRO02) <> ''
            GROUP BY TRIM(x.FILTRO02), f.DESCRIPCIONFILTRO
            ORDER BY CNT DESC
        `);
        
        console.log(`\nFI2 disponibles para FI1=1010: ${f2ForF1.length}`);
        f2ForF1.forEach(v => {
            console.log(`   ${v.COD}: ${v.DESC?.trim() || '(sin desc)'} → ${v.CNT} arts`);
        });
    } catch (err) {
        console.log('❌ Error:', err.message);
    }

    // 4. FI3 para un FI2 específico
    console.log('\n\n' + '='.repeat(80));
    console.log('CASCADA: FI2="101014" (LANGOSTINO) → FI3');
    console.log('='.repeat(80));
    
    try {
        const f3ForF2 = await query(`
            SELECT TRIM(x.FILTRO03) as COD, f.DESCRIPCIONFILTRO as DESC, COUNT(*) as CNT
            FROM DSEDAC.ARTX x
            LEFT JOIN DSEDAC.FI3 f ON TRIM(x.FILTRO03) = TRIM(f.CODIGOFILTRO)
            WHERE TRIM(x.FILTRO02) = '101014'
            AND x.FILTRO03 IS NOT NULL AND TRIM(x.FILTRO03) <> ''
            GROUP BY TRIM(x.FILTRO03), f.DESCRIPCIONFILTRO
            ORDER BY CNT DESC
        `);
        
        console.log(`\nFI3 disponibles para FI2=101014: ${f3ForF2.length}`);
        f3ForF2.forEach(v => {
            console.log(`   ${v.COD}: ${v.DESC?.trim() || '(sin desc)'} → ${v.CNT} arts`);
        });
    } catch (err) {
        console.log('❌ Error:', err.message);
    }

    // 5. Ver FI5 - parece ser categoría general
    console.log('\n\n' + '='.repeat(80));
    console.log('FI5 - CATEGORÍA GENERAL');
    console.log('='.repeat(80));
    
    try {
        const fi5All = await query(`SELECT TRIM(CODIGOFILTRO) as COD, TRIM(DESCRIPCIONFILTRO) as DESC FROM DSEDAC.FI5 ORDER BY ORDEN`);
        console.log('\nTodas las categorías FI5:');
        fi5All.forEach(f => console.log(`   ${f.COD}: ${f.DESC}`));
    } catch (err) {
        console.log('❌ Error:', err.message);
    }

    // 6. Ver estructura de cómo se conecta CODIGOSECCIONLARGA con FI5
    console.log('\n\n' + '='.repeat(80));
    console.log('RELACIÓN CODIGOSECCIONLARGA ↔ FI5');
    console.log('='.repeat(80));
    
    try {
        const secFi5 = await query(`
            SELECT TRIM(a.CODIGOSECCIONLARGA) as SEC, TRIM(f.DESCRIPCIONFILTRO) as DESC, COUNT(*) as CNT
            FROM DSEDAC.ART a
            LEFT JOIN DSEDAC.FI5 f ON TRIM(a.CODIGOSECCIONLARGA) = TRIM(f.CODIGOFILTRO)
            WHERE a.BLOQUEADOSN <> 'S'
            GROUP BY TRIM(a.CODIGOSECCIONLARGA), f.DESCRIPCIONFILTRO
            ORDER BY CNT DESC
            FETCH FIRST 15 ROWS ONLY
        `);
        
        secFi5.forEach(s => {
            console.log(`   SECCION "${s.SEC}" → FI5: "${s.DESC || '(sin match)'}" (${s.CNT} arts)`);
        });
    } catch (err) {
        console.log('❌ Error:', err.message);
    }

    // 7. Contar artículos activos por cada nivel
    console.log('\n\n' + '='.repeat(80));
    console.log('ESTADÍSTICAS DE USO');
    console.log('='.repeat(80));
    
    try {
        const stats = await query(`
            SELECT 
                COUNT(*) as TOTAL,
                SUM(CASE WHEN TRIM(x.FILTRO01) <> '' THEN 1 ELSE 0 END) as CON_F1,
                SUM(CASE WHEN TRIM(x.FILTRO02) <> '' THEN 1 ELSE 0 END) as CON_F2,
                SUM(CASE WHEN TRIM(x.FILTRO03) <> '' THEN 1 ELSE 0 END) as CON_F3,
                SUM(CASE WHEN TRIM(x.FILTRO04) <> '' THEN 1 ELSE 0 END) as CON_F4
            FROM DSEDAC.ART a
            INNER JOIN DSEDAC.ARTX x ON a.CODIGOARTICULO = x.CODIGOARTICULO
            WHERE a.BLOQUEADOSN <> 'S'
        `);
        
        if (stats.length > 0) {
            const s = stats[0];
            console.log(`\n   Total artículos activos: ${s.TOTAL}`);
            console.log(`   Con FILTRO01 (FI1): ${s.CON_F1} (${Math.round(s.CON_F1/s.TOTAL*100)}%)`);
            console.log(`   Con FILTRO02 (FI2): ${s.CON_F2} (${Math.round(s.CON_F2/s.TOTAL*100)}%)`);
            console.log(`   Con FILTRO03 (FI3): ${s.CON_F3} (${Math.round(s.CON_F3/s.TOTAL*100)}%)`);
            console.log(`   Con FILTRO04 (FI4): ${s.CON_F4} (${Math.round(s.CON_F4/s.TOTAL*100)}%)`);
        }
    } catch (err) {
        console.log('❌ Error:', err.message);
    }

    console.log('\n\n✅ Exploración completada');
    process.exit(0);
}

exploreFullRelation().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
});
