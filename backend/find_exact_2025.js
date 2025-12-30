/**
 * Find exact filter for 15.05M in 2025
 * Run with: node find_exact_2025.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function check() {
    console.log('='.repeat(70));
    console.log('FINDING EXACT FILTER FOR 15,052,760€ IN 2025');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // Test various combinations
        const filters = [
            { name: 'CC+VC', where: "TIPOVENTA IN ('CC', 'VC')" },
            { name: 'CC only', where: "TIPOVENTA = 'CC'" },
            { name: 'CC + SERIE P only', where: "TIPOVENTA = 'CC' AND SERIEALBARAN = 'P'" },
            { name: 'CC + SERIE P,I,J,L', where: "TIPOVENTA = 'CC' AND SERIEALBARAN IN ('P', 'I', 'J', 'L')" },
            { name: 'CC + SERIE P,I,J,L,E', where: "TIPOVENTA = 'CC' AND SERIEALBARAN IN ('P', 'I', 'J', 'L', 'E')" },
            { name: 'CC + SERIE P,I,J,L,E,S', where: "TIPOVENTA = 'CC' AND SERIEALBARAN IN ('P', 'I', 'J', 'L', 'E', 'S')" },
            { name: 'CC + Sin A,B,C,D,G,H,K,M,N,Q', where: "TIPOVENTA = 'CC' AND SERIEALBARAN NOT IN ('A', 'B', 'C', 'D', 'G', 'H', 'K', 'M', 'N', 'Q')" },
            { name: 'CC + Sin A,B,C,D,H,K,M,N,O,Q', where: "TIPOVENTA = 'CC' AND SERIEALBARAN NOT IN ('A', 'B', 'C', 'D', 'H', 'K', 'M', 'N', 'O', 'Q')" },
            { name: 'CC + P,I,J,L,S', where: "TIPOVENTA = 'CC' AND SERIEALBARAN IN ('P', 'I', 'J', 'L', 'S')" },
            { name: 'CC + P,L,E,S (sin I,J)', where: "TIPOVENTA = 'CC' AND SERIEALBARAN IN ('P', 'L', 'E', 'S')" },
            { name: 'CC + P,I,L (sin J)', where: "TIPOVENTA = 'CC' AND SERIEALBARAN IN ('P', 'I', 'L')" },
            { name: 'CC + P,L', where: "TIPOVENTA = 'CC' AND SERIEALBARAN IN ('P', 'L')" },
        ];

        console.log('\n  FILTER                                    | TOTAL           | DIFF');
        console.log('  ' + '-'.repeat(75));

        for (const f of filters) {
            try {
                const result = await conn.query(`
          SELECT SUM(IMPORTEVENTA) as TOTAL
          FROM DSEDAC.LAC 
          WHERE ANODOCUMENTO = 2025 AND ${f.where}
        `);
                const total = parseFloat(result[0]?.TOTAL || 0);
                const formatted = total.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const diff = (total - 15052760).toLocaleString('es-ES', { minimumFractionDigits: 0 });
                console.log(`  ${f.name.padEnd(42)} | ${formatted.padStart(15)} | ${diff}`);
            } catch (e) {
                console.log(`  ${f.name.padEnd(42)} | ERROR`);
            }
        }

        // Check individual series contributions (CC only)
        console.log('\n\n  INDIVIDUAL SERIES (CC only):');
        console.log('  ' + '-'.repeat(50));

        try {
            const series = await conn.query(`
        SELECT SERIEALBARAN, SUM(IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC 
        WHERE ANODOCUMENTO = 2025 AND TIPOVENTA = 'CC'
        GROUP BY SERIEALBARAN
        ORDER BY TOTAL DESC
      `);
            series.forEach(r => {
                console.log(`  ${(r.SERIEALBARAN || 'NULL').toString().trim().padEnd(3)}: ${parseFloat(r.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        console.log('\n  TARGET: 15,052,760.60€');
        console.log('\n' + '='.repeat(70));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

check().catch(console.error);
