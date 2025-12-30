/**
 * Check if visit days differ from delivery days for DOMINGO's clients
 * Run with: node check_visit_vs_delivery.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function check() {
    console.log('='.repeat(70));
    console.log('CHECKING VISIT vs DELIVERY DAYS FOR DOMINGO (Vendedor 33)');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // Check if LACLAE has different visit vs delivery flags
        console.log('\n1. Sample clients with VISIT and DELIVERY flags from LACLAE:');
        console.log('-'.repeat(60));

        const sample = await conn.query(`
      SELECT 
        LCCDCL as CLIENT,
        R1_T8DIVL as VIS_L, R1_T8DIVM as VIS_M, R1_T8DIVX as VIS_X, 
        R1_T8DIVJ as VIS_J, R1_T8DIVV as VIS_V, R1_T8DIVS as VIS_S, R1_T8DIVD as VIS_D,
        R1_T8DIRL as DEL_L, R1_T8DIRM as DEL_M, R1_T8DIRX as DEL_X,
        R1_T8DIRJ as DEL_J, R1_T8DIRV as DEL_V, R1_T8DIRS as DEL_S, R1_T8DIRD as DEL_D
      FROM DSED.LACLAE
      WHERE R1_T8CDVD = '33'
      FETCH FIRST 10 ROWS ONLY
    `);

        if (sample.length === 0) {
            console.log('  No data found for vendedor 33 in LACLAE');
        } else {
            sample.forEach(r => {
                const visita = `${r.VIS_L || '-'}${r.VIS_M || '-'}${r.VIS_X || '-'}${r.VIS_J || '-'}${r.VIS_V || '-'}${r.VIS_S || '-'}${r.VIS_D || '-'}`;
                const reparto = `${r.DEL_L || '-'}${r.DEL_M || '-'}${r.DEL_X || '-'}${r.DEL_J || '-'}${r.DEL_V || '-'}${r.DEL_S || '-'}${r.DEL_D || '-'}`;
                const diff = visita !== reparto ? '⚠️ DIFFERENT!' : '✓ Same';
                console.log(`  Client ${r.CLIENT?.trim()}: Visit=${visita} | Delivery=${reparto} ${diff}`);
            });
        }

        // Count clients where visit != delivery for at least one day
        console.log('\n2. Clients with DIFFERENT visit vs delivery days:');
        console.log('-'.repeat(60));

        const different = await conn.query(`
      SELECT 
        LCCDCL as CLIENT,
        R1_T8DIVL as VIS_L, R1_T8DIVM as VIS_M, R1_T8DIVX as VIS_X, 
        R1_T8DIVJ as VIS_J, R1_T8DIVV as VIS_V, R1_T8DIVS as VIS_S, R1_T8DIVD as VIS_D,
        R1_T8DIRL as DEL_L, R1_T8DIRM as DEL_M, R1_T8DIRX as DEL_X,
        R1_T8DIRJ as DEL_J, R1_T8DIRV as DEL_V, R1_T8DIRS as DEL_S, R1_T8DIRD as DEL_D
      FROM DSED.LACLAE
      WHERE R1_T8CDVD = '33'
        AND (
          (R1_T8DIVL <> R1_T8DIRL) OR
          (R1_T8DIVM <> R1_T8DIRM) OR
          (R1_T8DIVX <> R1_T8DIRX) OR
          (R1_T8DIVJ <> R1_T8DIRJ) OR
          (R1_T8DIVV <> R1_T8DIRV) OR
          (R1_T8DIVS <> R1_T8DIRS) OR
          (R1_T8DIVD <> R1_T8DIRD)
        )
      FETCH FIRST 20 ROWS ONLY
    `);

        if (different.length === 0) {
            console.log('  ✅ NO clients found with different visit/delivery days');
            console.log('  All clients of DOMINGO have the SAME visit and delivery schedule');
        } else {
            console.log(`  Found ${different.length} clients with different schedules:`);
            different.forEach(r => {
                const visita = `L:${r.VIS_L} M:${r.VIS_M} X:${r.VIS_X} J:${r.VIS_J} V:${r.VIS_V}`;
                const reparto = `L:${r.DEL_L} M:${r.DEL_M} X:${r.DEL_X} J:${r.DEL_J} V:${r.DEL_V}`;
                console.log(`  Client ${r.CLIENT?.trim()}:`);
                console.log(`    Visita:  ${visita}`);
                console.log(`    Reparto: ${reparto}`);
            });
        }

        // Check overall statistics for all vendedores
        console.log('\n3. Statistics: How many clients have different visit vs delivery overall?');
        console.log('-'.repeat(60));

        const stats = await conn.query(`
      SELECT 
        COUNT(*) as TOTAL,
        SUM(CASE WHEN R1_T8DIVL <> R1_T8DIRL OR R1_T8DIVM <> R1_T8DIRM OR R1_T8DIVX <> R1_T8DIRX 
                  OR R1_T8DIVJ <> R1_T8DIRJ OR R1_T8DIVV <> R1_T8DIRV OR R1_T8DIVS <> R1_T8DIRS
                  OR R1_T8DIVD <> R1_T8DIRD THEN 1 ELSE 0 END) as DIFFERENT
      FROM DSED.LACLAE
      FETCH FIRST 1 ROWS ONLY
    `);

        const total = parseInt(stats[0]?.TOTAL) || 0;
        const diff = parseInt(stats[0]?.DIFFERENT) || 0;
        const pct = total > 0 ? ((diff / total) * 100).toFixed(2) : 0;
        console.log(`  Total clients in LACLAE: ${total}`);
        console.log(`  Clients with different visit/delivery: ${diff} (${pct}%)`);

        console.log('\n' + '='.repeat(70));
        console.log('ANALYSIS COMPLETE');
        console.log('='.repeat(70));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

check().catch(console.error);
