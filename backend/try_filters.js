/**
 * Try filter combinations to reach target 15.05M
 * Run with: node try_filters.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function check() {
    console.log('='.repeat(70));
    console.log('TRYING FILTER COMBINATIONS TO REACH TARGET 15,052,760€');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        const filters = [
            { name: 'TIPOVENTA=CC', where: "TIPOVENTA = 'CC'" },
            { name: 'CC + SERIEDOCUMENTO P,H,I', where: "TIPOVENTA = 'CC' AND SERIEDOCUMENTO IN ('P', 'H', 'I')" },
            { name: 'CC + SERIEDOCUMENTO P,H,E', where: "TIPOVENTA = 'CC' AND SERIEDOCUMENTO IN ('P', 'H', 'E')" },
            { name: 'CC + SERIEDOCUMENTO P,I,E', where: "TIPOVENTA = 'CC' AND SERIEDOCUMENTO IN ('P', 'I', 'E')" },
            { name: 'CC + SERIEDOCUMENTO P,H,I,E (sin B)', where: "TIPOVENTA = 'CC' AND SERIEDOCUMENTO IN ('P', 'H', 'I', 'E')" },
            { name: 'CC + Sin empty SERIEDOCUMENTO', where: "TIPOVENTA = 'CC' AND SERIEDOCUMENTO <> '' AND SERIEDOCUMENTO IS NOT NULL" },
            { name: 'CC + Sin SERIEALBARAN A,B,C,N,O', where: "TIPOVENTA = 'CC' AND SERIEALBARAN NOT IN ('A', 'B', 'C', 'N', 'O')" },
            { name: 'CC + SERIEALBARAN P,I,J,L,E,H,S,Q', where: "TIPOVENTA = 'CC' AND SERIEALBARAN IN ('P', 'I', 'J', 'L', 'E', 'H', 'S', 'Q')" },
            { name: 'CC + SERIEALBARAN P,I,J,L', where: "TIPOVENTA = 'CC' AND SERIEALBARAN IN ('P', 'I', 'J', 'L')" },
            { name: 'CC + Sin SERIEALBARAN A,N', where: "TIPOVENTA = 'CC' AND SERIEALBARAN NOT IN ('A', 'N')" },
            { name: 'CC + Sin SERIEALBARAN A,B,C,M,N,O', where: "TIPOVENTA = 'CC' AND SERIEALBARAN NOT IN ('A', 'B', 'C', 'M', 'N', 'O')" },
        ];

        console.log('\n  FILTER                                           | TOTAL');
        console.log('  ' + '-'.repeat(65));

        for (const f of filters) {
            try {
                const result = await conn.query(`
          SELECT SUM(IMPORTEVENTA) as TOTAL
          FROM DSEDAC.LAC 
          WHERE ANODOCUMENTO = 2024 AND ${f.where}
        `);
                const total = parseFloat(result[0]?.TOTAL || 0);
                const formatted = total.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const diff = (total - 15052760).toLocaleString('es-ES', { minimumFractionDigits: 0 });
                console.log(`  ${f.name.padEnd(48)} | ${formatted.padStart(15)}€ (diff: ${diff})`);
            } catch (e) {
                console.log(`  ${f.name.padEnd(48)} | ERROR: ${e.message.substring(0, 30)}`);
            }
        }

        // Check CLASELINEA combinations
        console.log('\n\n  CLASELINEA FILTERS:');
        console.log('  ' + '-'.repeat(65));

        const clFilters = [
            { name: 'CC + Solo CLASELINEA=VT', where: "TIPOVENTA = 'CC' AND CLASELINEA = 'VT'" },
            { name: 'CC + Sin CLASELINEA RG,NS,AB', where: "TIPOVENTA = 'CC' AND CLASELINEA NOT IN ('RG', 'NS', 'AB')" },
            { name: 'CC + Sin TIPOLINEA T', where: "TIPOVENTA = 'CC' AND TIPOLINEA = 'R'" },
        ];

        for (const f of clFilters) {
            try {
                const result = await conn.query(`
          SELECT SUM(IMPORTEVENTA) as TOTAL
          FROM DSEDAC.LAC 
          WHERE ANODOCUMENTO = 2024 AND ${f.where}
        `);
                const total = parseFloat(result[0]?.TOTAL || 0);
                const formatted = total.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const diff = (total - 15052760).toLocaleString('es-ES', { minimumFractionDigits: 0 });
                console.log(`  ${f.name.padEnd(48)} | ${formatted.padStart(15)}€ (diff: ${diff})`);
            } catch (e) {
                console.log(`  ${f.name.padEnd(48)} | ERROR`);
            }
        }

        // Check if VT + some SERIEDOCUMENTO filter works
        console.log('\n\n  COMBINED CLASELINEA + SERIEDOCUMENTO:');
        console.log('  ' + '-'.repeat(65));

        const combFilters = [
            { name: 'CC + VT + SERIEDOC P,H,I', where: "TIPOVENTA = 'CC' AND CLASELINEA = 'VT' AND SERIEDOCUMENTO IN ('P', 'H', 'I')" },
            { name: 'CC + VT + SERIEDOC P,H,I,E', where: "TIPOVENTA = 'CC' AND CLASELINEA = 'VT' AND SERIEDOCUMENTO IN ('P', 'H', 'I', 'E')" },
            { name: 'CC + VT + Sin empty SERIEDOC', where: "TIPOVENTA = 'CC' AND CLASELINEA = 'VT' AND SERIEDOCUMENTO <> '' AND SERIEDOCUMENTO IS NOT NULL" },
            { name: 'VT + SERIEDOC P,H,I (sin filtro TIPOVENTA)', where: "CLASELINEA = 'VT' AND SERIEDOCUMENTO IN ('P', 'H', 'I')" },
        ];

        for (const f of combFilters) {
            try {
                const result = await conn.query(`
          SELECT SUM(IMPORTEVENTA) as TOTAL
          FROM DSEDAC.LAC 
          WHERE ANODOCUMENTO = 2024 AND ${f.where}
        `);
                const total = parseFloat(result[0]?.TOTAL || 0);
                const formatted = total.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const diff = (total - 15052760).toLocaleString('es-ES', { minimumFractionDigits: 0 });
                console.log(`  ${f.name.padEnd(48)} | ${formatted.padStart(15)}€ (diff: ${diff})`);
            } catch (e) {
                console.log(`  ${f.name.padEnd(48)} | ERROR`);
            }
        }

        console.log('\n  TARGET: 15,052,760€');
        console.log('\n' + '='.repeat(70));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

check().catch(console.error);
