/**
 * INVESTIGACIÓN FINAL: Cómo vincular OPP con documentos reales
 * OPP tiene 15,180 registros para repartidor 79
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function run() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║    VINCULAR OPP (Orden Preparación) CON DOCUMENTOS             ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        // 1. Columnas de OPP
        console.log('1. TODAS LAS COLUMNAS DE OPP:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const oppCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPP'
            ORDER BY ORDINAL_POSITION
        `);
        
        oppCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 2. Sample de OPP del repartidor 79 más reciente (2026)
        console.log('\n\n2. SAMPLE OPP REPARTIDOR 79 EN 2026:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const opp79 = await conn.query(`
            SELECT * FROM DSEDAC.OPP
            WHERE TRIM(CODIGOREPARTIDOR) = '79'
              AND ANOREPARTO = 2026
            ORDER BY MESREPARTO DESC, DIAREPARTO DESC
            FETCH FIRST 2 ROWS ONLY
        `);
        
        if (opp79.length > 0) {
            opp79.forEach((row, i) => {
                console.log(`   --- Registro ${i+1} ---`);
                Object.entries(row).forEach(([k, v]) => {
                    if (v !== null && (typeof v !== 'string' || v.trim() !== '')) {
                        console.log(`       ${k}: ${v}`);
                    }
                });
                console.log('');
            });
        } else {
            console.log('   No hay registros de 2026');
        }

        // 3. Ver si hay una tabla de líneas OPL o similar
        console.log('\n\n3. BUSCAR TABLAS RELACIONADAS CON OP* (Orden Preparación):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const opTables = await conn.query(`
            SELECT TABLE_NAME, COUNT(*) as NUM_COLS
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME LIKE 'OP%'
            GROUP BY TABLE_NAME
            ORDER BY TABLE_NAME
        `);
        
        opTables.forEach(t => console.log(`   ${t.TABLE_NAME}: ${t.NUM_COLS} columnas`));

        // 4. Ver estructura de OPPL1 (si existe)
        console.log('\n\n4. ESTRUCTURA DE OPPL1:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const oppl1Cols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPPL1'
            ORDER BY ORDINAL_POSITION
        `);
        
        if (oppl1Cols.length > 0) {
            oppl1Cols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));
        } else {
            console.log('   OPPL1 no existe');
        }

        // 5. Verificar OPL
        console.log('\n\n5. ESTRUCTURA DE OPL (SI EXISTE):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const oplCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPL'
            ORDER BY ORDINAL_POSITION
        `);
        
        if (oplCols.length > 0) {
            oplCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));
            
            // Sample de OPL
            console.log('\n   SAMPLE OPL:');
            const oplSample = await conn.query(`
                SELECT * FROM DSEDAC.OPL
                FETCH FIRST 1 ROWS ONLY
            `);
            
            if (oplSample.length > 0) {
                Object.entries(oplSample[0]).forEach(([k, v]) => {
                    if (v !== null && (typeof v !== 'string' || v.trim() !== '')) {
                        console.log(`       ${k}: ${v}`);
                    }
                });
            }
        } else {
            console.log('   OPL no existe');
        }

        // 6. Buscar en CAC si hay campo de orden de preparación
        console.log('\n\n6. CAMPOS EN CAC RELACIONADOS CON ORDEN PREPARACIÓN:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const cacOrdCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'CAC'
              AND (COLUMN_NAME LIKE '%ORDEN%' OR COLUMN_NAME LIKE '%PREP%')
            ORDER BY COLUMN_NAME
        `);
        
        cacOrdCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 7. El campo clave podría estar en LAC (líneas de albarán)
        console.log('\n\n7. CAMPOS EN LAC RELACIONADOS CON ORDEN:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const lacOrdCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME = 'LAC'
              AND (COLUMN_NAME LIKE '%ORDEN%' OR COLUMN_NAME LIKE '%PREP%' OR COLUMN_NAME LIKE '%OPP%')
            ORDER BY COLUMN_NAME
        `);
        
        if (lacOrdCols.length > 0) {
            lacOrdCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));
        } else {
            console.log('   No hay columnas de orden en LAC');
        }

        // 8. Verificar tabla ALB (albarán) si existe
        console.log('\n\n8. BUSCAR TABLA DE ALBARANES:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const albTables = await conn.query(`
            SELECT DISTINCT TABLE_NAME
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' 
              AND TABLE_NAME LIKE '%ALB%'
        `);
        
        albTables.forEach(t => console.log(`   ${t.TABLE_NAME}`));

        // 9. Cuentas por repartidor en 2026 en OPP
        console.log('\n\n9. REPARTIDORES CON MÁS ENTREGAS EN ENERO 2026 (OPP):');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const topEnero = await conn.query(`
            SELECT 
                TRIM(OPP.CODIGOREPARTIDOR) as REP,
                TRIM(VDD.NOMBREVENDEDOR) as NOMBRE,
                COUNT(*) as ENTREGAS
            FROM DSEDAC.OPP OPP
            LEFT JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(OPP.CODIGOREPARTIDOR)
            WHERE OPP.ANOREPARTO = 2026
              AND OPP.MESREPARTO = 1
              AND OPP.CODIGOREPARTIDOR IS NOT NULL
              AND TRIM(OPP.CODIGOREPARTIDOR) <> ''
            GROUP BY TRIM(OPP.CODIGOREPARTIDOR), TRIM(VDD.NOMBREVENDEDOR)
            ORDER BY ENTREGAS DESC
            FETCH FIRST 10 ROWS ONLY
        `);
        
        console.log('   REP │ NOMBRE                          │ ENTREGAS');
        console.log('   ────┼─────────────────────────────────┼──────────');
        topEnero.forEach(r => {
            const rep = (r.REP || '').padEnd(3);
            const nom = (r.NOMBRE || '').substring(0, 30).padEnd(30);
            console.log(`   ${rep} │ ${nom} │ ${r.ENTREGAS}`);
        });

        // 10. Verificar si 79 tiene entregas en enero 2026
        console.log('\n\n10. ENTREGAS DEL REPARTIDOR 79 EN ENERO 2026:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const r79Enero = await conn.query(`
            SELECT 
                COUNT(*) as TOTAL,
                COUNT(DISTINCT DIAREPARTO) as DIAS_ACTIVO
            FROM DSEDAC.OPP
            WHERE TRIM(CODIGOREPARTIDOR) = '79'
              AND ANOREPARTO = 2026
              AND MESREPARTO = 1
        `);
        
        console.log(`   Total órdenes: ${r79Enero[0].TOTAL}`);
        console.log(`   Días activo: ${r79Enero[0].DIAS_ACTIVO}`);

        // Sample de sus entregas
        console.log('\n   Últimas entregas:');
        const r79Sample = await conn.query(`
            SELECT 
                ID, EJERCICIOORDENPREPARACION, NUMEROORDENPREPARACION,
                DIAREPARTO, MESREPARTO, ANOREPARTO,
                TRIM(CODIGOVEHICULO) as VEHICULO
            FROM DSEDAC.OPP
            WHERE TRIM(CODIGOREPARTIDOR) = '79'
              AND ANOREPARTO = 2026
            ORDER BY MESREPARTO DESC, DIAREPARTO DESC
            FETCH FIRST 5 ROWS ONLY
        `);
        
        r79Sample.forEach((r, i) => {
            console.log(`   [${i+1}] Orden ${r.EJERCICIOORDENPREPARACION}-${r.NUMEROORDENPREPARACION}, Reparto: ${r.DIAREPARTO}/${r.MESREPARTO}/${r.ANOREPARTO}, Veh: ${r.VEHICULO}`);
        });

        console.log('\n═══════════════════════════════════════════════════════════════');
        console.log('                      CONCLUSIÓN');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        console.log('   OPP contiene órdenes de preparación asignadas a repartidores.');
        console.log('   El repartidor 79 tiene entregas recientes en 2026.');
        console.log('   Necesitamos encontrar cómo vincular OPP → documentos CAC.');
        console.log('\n   Siguiente paso: Investigar OPL para ver la relación con documentos.');
        
        console.log('\n═══════════════════════════════════════════════════════════════\n');
        
    } finally {
        await conn.close();
    }
}

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
