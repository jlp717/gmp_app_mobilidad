/**
 * Check FAM (families) and article section for LCSRAB filtering
 * Run with: node check_fam_sections.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function check() {
    console.log('='.repeat(70));
    console.log('CHECKING FAM AND ARTICLE SECTIONS FOR FILTERING');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // Check FAM structure
        console.log('\n1. FAM TABLE COLUMNS:');
        console.log('-'.repeat(60));
        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'FAM'
        ORDER BY ORDINAL_POSITION
      `);
            cols.forEach(c => console.log(`  ${c.COLUMN_NAME}: ${c.DATA_TYPE}`));
        } catch (e) { console.log('  Error:', e.message); }

        // Check FAM values with CODIGOSECCION
        console.log('\n\n2. FAM - CODIGOSECCION values:');
        console.log('-'.repeat(60));
        try {
            const fam = await conn.query(`
        SELECT CODIGOSECCION, CODIGOFAMILIA, NOMBREFAMILIA
        FROM DSEDAC.FAM
        ORDER BY CODIGOSECCION, CODIGOFAMILIA
        FETCH FIRST 30 ROWS ONLY
      `);
            console.log('  SECCION | FAMILIA | NOMBRE');
            console.log('  ' + '-'.repeat(50));
            fam.forEach(f => {
                const sec = (f.CODIGOSECCION || '').trim().padEnd(8);
                const fam = (f.CODIGOFAMILIA || '').trim().padEnd(8);
                const nom = (f.NOMBREFAMILIA || '').trim().substring(0, 30);
                console.log(`  ${sec} | ${fam} | ${nom}`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        // Check ART (artículos) table for section
        console.log('\n\n3. ART TABLE - Section column:');
        console.log('-'.repeat(60));
        try {
            const artCols = await conn.query(`
        SELECT COLUMN_NAME 
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'ART'
        AND (COLUMN_NAME LIKE '%SECCION%' OR COLUMN_NAME LIKE '%FAM%' OR COLUMN_NAME LIKE '%RABAT%')
      `);
            console.log('  Section-like columns:', artCols.map(c => c.COLUMN_NAME).join(', '));
        } catch (e) { console.log('  Error:', e.message); }

        // Join LAC with ART to get section and filter
        console.log('\n\n4. LAC JOIN ART - Section filtering:');
        console.log('-'.repeat(60));

        try {
            const artSections = await conn.query(`
        SELECT A.CODIGOSECCION, COUNT(*) as CNT, SUM(L.IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC L
        JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
        WHERE L.ANODOCUMENTO = 2024
        GROUP BY A.CODIGOSECCION
        ORDER BY TOTAL DESC
      `);
            console.log('  SECCION | Count    | Total Sales');
            console.log('  ' + '-'.repeat(50));
            artSections.forEach(r => {
                const sec = (r.CODIGOSECCION || 'NULL').toString().trim().padEnd(8);
                const cnt = String(r.CNT).padEnd(10);
                const total = parseFloat(r.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 });
                console.log(`  ${sec} | ${cnt} | ${total}€`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        // Total excluding K, N, O, G via ART.CODIGOSECCION
        console.log('\n\n5. TOTAL EXCLUDING SECTIONS K, N, O, G via ART:');
        console.log('-'.repeat(60));

        try {
            const total = await conn.query(`
        SELECT SUM(L.IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC L
        JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
        WHERE L.ANODOCUMENTO = 2024
          AND L.TIPOVENTA = 'CC'
          AND A.CODIGOSECCION NOT IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  TIPOVENTA='CC' + Sin ART.SECCION K,N,O,G: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Check K, N, O, G totals
        try {
            const excluded = await conn.query(`
        SELECT SUM(L.IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC L
        JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
        WHERE L.ANODOCUMENTO = 2024
          AND A.CODIGOSECCION IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  Total ONLY sections K,N,O,G: ${parseFloat(excluded[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        console.log('\n  TARGET: 15,052,760€');

        console.log('\n' + '='.repeat(70));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        if (conn) await conn.close();
    }
}

check().catch(console.error);
