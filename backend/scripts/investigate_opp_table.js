/**
 * Script para entender la tabla OPP y cómo relacionarla con entregas
 */

const odbc = require('odbc');
require('dotenv').config();

const DB_CONFIG = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;`;

async function investigateOPP() {
    const conn = await odbc.connect(DB_CONFIG);
    
    try {
        console.log('╔════════════════════════════════════════════════════════════════╗');
        console.log('║     ESTRUCTURA DE TABLA OPP (Operaciones de Pedido/Reparto)    ║');
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        // 1. Todas las columnas de OPP
        console.log('1. TODAS LAS COLUMNAS DE OPP:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const oppCols = await conn.query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH
            FROM QSYS2.SYSCOLUMNS
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'OPP'
            ORDER BY COLUMN_NAME
        `);
        oppCols.forEach(c => console.log(`   ${c.COLUMN_NAME}: ${c.DATA_TYPE}(${c.LENGTH})`));

        // 2. Sample de OPP para repartidor 79
        console.log('\n\n2. SAMPLE DE OPP PARA REPARTIDOR 79:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const oppSample = await conn.query(`
            SELECT * FROM DSEDAC.OPP
            WHERE TRIM(CODIGOREPARTIDOR) = '79'
            ORDER BY ANOOPERACION DESC, MESOPERACION DESC, DIAOPERACION DESC
            FETCH FIRST 3 ROWS ONLY
        `);
        
        if (oppSample.length > 0) {
            oppSample.forEach((row, i) => {
                console.log(`   --- Registro ${i + 1} ---`);
                Object.entries(row).forEach(([k, v]) => {
                    if (v !== null && String(v).trim() !== '') {
                        console.log(`   ${k}: ${v}`);
                    }
                });
                console.log('');
            });
        }

        // 3. Registros del repartidor 79 en 2026
        console.log('\n3. REGISTROS DE REPARTIDOR 79 EN 2026:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const opp79_2026 = await conn.query(`
            SELECT COUNT(*) as TOTAL,
                   COUNT(DISTINCT CODIGOCLIENTE) as CLIENTES,
                   MIN(DIAOPERACION) as DIA_MIN,
                   MAX(DIAOPERACION) as DIA_MAX
            FROM DSEDAC.OPP
            WHERE TRIM(CODIGOREPARTIDOR) = '79'
              AND ANOOPERACION = 2026
        `);
        console.log(`   Total registros 2026: ${opp79_2026[0]?.TOTAL || 0}`);
        console.log(`   Clientes distintos: ${opp79_2026[0]?.CLIENTES || 0}`);
        console.log(`   Rango de días: ${opp79_2026[0]?.DIA_MIN} - ${opp79_2026[0]?.DIA_MAX}`);

        // 4. Registros HOY para repartidor 79
        const today = new Date();
        console.log(`\n\n4. REGISTROS HOY (${today.getDate()}/${today.getMonth()+1}/${today.getFullYear()}) PARA REPARTIDOR 79:`);
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const oppHoy = await conn.query(`
            SELECT COUNT(*) as TOTAL, SUM(IMPORTETOTAL) / 100.0 as IMPORTE
            FROM DSEDAC.OPP
            WHERE TRIM(CODIGOREPARTIDOR) = '79'
              AND ANOOPERACION = ${today.getFullYear()}
              AND MESOPERACION = ${today.getMonth() + 1}
              AND DIAOPERACION = ${today.getDate()}
        `);
        console.log(`   Registros hoy: ${oppHoy[0]?.TOTAL || 0}`);
        console.log(`   Importe: ${oppHoy[0]?.IMPORTE || 0}€`);

        // 5. Top repartidores HOY
        console.log('\n\n5. TOP REPARTIDORES CON ENTREGAS HOY:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const topHoy = await conn.query(`
            SELECT 
                TRIM(OPP.CODIGOREPARTIDOR) as REP,
                TRIM(VDD.NOMBREVENDEDOR) as NOMBRE,
                COUNT(*) as ENTREGAS,
                SUM(OPP.IMPORTETOTAL) / 100.0 as IMPORTE
            FROM DSEDAC.OPP OPP
            LEFT JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(OPP.CODIGOREPARTIDOR)
            WHERE OPP.ANOOPERACION = ${today.getFullYear()}
              AND OPP.MESOPERACION = ${today.getMonth() + 1}
              AND OPP.DIAOPERACION = ${today.getDate()}
              AND OPP.CODIGOREPARTIDOR IS NOT NULL
              AND TRIM(OPP.CODIGOREPARTIDOR) <> ''
            GROUP BY TRIM(OPP.CODIGOREPARTIDOR), TRIM(VDD.NOMBREVENDEDOR)
            ORDER BY ENTREGAS DESC
            FETCH FIRST 15 ROWS ONLY
        `);
        
        console.log('   COD  │ NOMBRE                          │ ENTREGAS │ IMPORTE');
        console.log('   ─────┼─────────────────────────────────┼──────────┼──────────');
        topHoy.forEach(r => {
            const cod = (r.REP || '').padEnd(4);
            const nom = (r.NOMBRE || 'Sin nombre').substring(0, 30).padEnd(30);
            const ent = String(r.ENTREGAS).padStart(8);
            const imp = (r.IMPORTE || 0).toFixed(2).padStart(10);
            console.log(`   ${cod} │ ${nom} │ ${ent} │ ${imp}€`);
        });

        // 6. Top repartidores ESTE MES
        console.log('\n\n6. TOP REPARTIDORES ESTE MES:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const topMes = await conn.query(`
            SELECT 
                TRIM(OPP.CODIGOREPARTIDOR) as REP,
                TRIM(VDD.NOMBREVENDEDOR) as NOMBRE,
                COUNT(*) as ENTREGAS,
                COUNT(DISTINCT OPP.DIAOPERACION) as DIAS,
                SUM(OPP.IMPORTETOTAL) / 100.0 as IMPORTE
            FROM DSEDAC.OPP OPP
            LEFT JOIN DSEDAC.VDD VDD ON TRIM(VDD.CODIGOVENDEDOR) = TRIM(OPP.CODIGOREPARTIDOR)
            WHERE OPP.ANOOPERACION = ${today.getFullYear()}
              AND OPP.MESOPERACION = ${today.getMonth() + 1}
              AND OPP.CODIGOREPARTIDOR IS NOT NULL
              AND TRIM(OPP.CODIGOREPARTIDOR) <> ''
            GROUP BY TRIM(OPP.CODIGOREPARTIDOR), TRIM(VDD.NOMBREVENDEDOR)
            ORDER BY ENTREGAS DESC
            FETCH FIRST 20 ROWS ONLY
        `);
        
        console.log('   COD  │ NOMBRE                          │ ENTREGAS │ DÍAS │ IMPORTE');
        console.log('   ─────┼─────────────────────────────────┼──────────┼──────┼──────────');
        topMes.forEach(r => {
            const cod = (r.REP || '').padEnd(4);
            const nom = (r.NOMBRE || 'Sin nombre').substring(0, 30).padEnd(30);
            const ent = String(r.ENTREGAS).padStart(8);
            const dias = String(r.DIAS).padStart(4);
            const imp = (r.IMPORTE || 0).toFixed(2).padStart(10);
            console.log(`   ${cod} │ ${nom} │ ${ent} │ ${dias} │ ${imp}€`);
        });

        // 7. Verificar credenciales de repartidores con entregas
        console.log('\n\n7. CREDENCIALES DE REPARTIDORES CON ENTREGAS:');
        console.log('═══════════════════════════════════════════════════════════════\n');
        
        const repsWithData = topMes.slice(0, 10).map(r => `'${r.REP}'`).join(',');
        if (repsWithData) {
            const pins = await conn.query(`
                SELECT TRIM(P.CODIGOVENDEDOR) as CODIGO, P.CODIGOPIN as PIN
                FROM DSEDAC.VDPL1 P
                WHERE TRIM(P.CODIGOVENDEDOR) IN (${repsWithData})
            `);
            
            console.log('   USUARIO │ PIN');
            console.log('   ────────┼──────');
            pins.forEach(p => {
                console.log(`   ${(p.CODIGO || '').padEnd(7)} │ ${p.PIN || '(sin PIN)'}`);
            });
        }

        console.log('\n════════════════════════════════════════════════════════════════');
        console.log('                    RECOMENDACIÓN PARA TESTING');
        console.log('════════════════════════════════════════════════════════════════\n');
        
        if (topMes.length > 0) {
            const rec = topMes[0];
            console.log(`   🎯 REPARTIDOR RECOMENDADO: ${rec.REP}`);
            console.log(`      Nombre: ${rec.NOMBRE}`);
            console.log(`      Entregas este mes: ${rec.ENTREGAS}`);
            console.log(`      Días activo: ${rec.DIAS}`);
        }
        
        console.log('\n   ⚠️  IMPORTANTE: Las queries del backend deben usar');
        console.log('       la tabla OPP con CODIGOREPARTIDOR, NO CAC con CODIGOVENDEDOR');
        
        console.log('\n════════════════════════════════════════════════════════════════\n');
        
    } finally {
        await conn.close();
    }
}

investigateOPP().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
