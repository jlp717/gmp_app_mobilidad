/**
 * Check SEC table and PREFAM for LCSRAB / section filtering
 * Run with: node check_sec_prefam.js
 */

const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function check() {
    console.log('='.repeat(70));
    console.log('CHECKING SEC AND PREFAM FOR SECTION FILTERING');
    console.log('='.repeat(70));

    let conn;
    try {
        conn = await odbc.connect(DB_CONFIG);

        // Check SEC table
        console.log('\n1. SEC TABLE:');
        console.log('-'.repeat(60));
        try {
            const sec = await conn.query(`
        SELECT * FROM DSEDAC.SEC
        FETCH FIRST 10 ROWS ONLY
      `);
            if (sec.length > 0) {
                console.log('  Columns:', Object.keys(sec[0]).join(', '));
                sec.forEach(s => {
                    const vals = Object.values(s).map(v => String(v || '').trim().substring(0, 15)).join(' | ');
                    console.log('  ', vals);
                });
            }
        } catch (e) { console.log('  Error or not found:', e.message); }

        // Check LCS table (might be LCSRAB)
        console.log('\n\n2. LCS TABLE:');
        console.log('-'.repeat(60));
        try {
            const lcs = await conn.query(`
        SELECT * FROM DSEDAC.LCS
        FETCH FIRST 10 ROWS ONLY
      `);
            if (lcs.length > 0) {
                console.log('  Columns:', Object.keys(lcs[0]).join(', '));
            }
        } catch (e) { console.log('  Error or not found:', e.message); }

        // Check ART.CODIGOPREFAMILIA values
        console.log('\n\n3. ART.CODIGOPREFAMILIA values:');
        console.log('-'.repeat(60));
        try {
            const prefam = await conn.query(`
        SELECT A.CODIGOPREFAMILIA, COUNT(*) as CNT, SUM(L.IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC L
        JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
        WHERE L.ANODOCUMENTO = 2024
        GROUP BY A.CODIGOPREFAMILIA
        ORDER BY TOTAL DESC
      `);
            console.log('  PREFAM | Count    | Total Sales');
            console.log('  ' + '-'.repeat(50));
            prefam.forEach(r => {
                const pf = (r.CODIGOPREFAMILIA || 'NULL').toString().trim().padEnd(7);
                const cnt = String(r.CNT).padEnd(10);
                const total = parseFloat(r.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 });
                console.log(`  ${pf} | ${cnt} | ${total}€`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        // Filter excluding K, N, O, G from PREFAMILIA
        console.log('\n\n4. TOTAL WITHOUT PREFAMILIA K,N,O,G:');
        console.log('-'.repeat(60));
        try {
            const total = await conn.query(`
        SELECT SUM(L.IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC L
        JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
        WHERE L.ANODOCUMENTO = 2024
          AND L.TIPOVENTA = 'CC'
          AND A.CODIGOPREFAMILIA NOT IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  Sin PREFAMILIA K,N,O,G: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Check what K, N, O, G contribute
        try {
            const excluded = await conn.query(`
        SELECT SUM(L.IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC L
        JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
        WHERE L.ANODOCUMENTO = 2024
          AND A.CODIGOPREFAMILIA IN ('K', 'N', 'O', 'G')
      `);
            console.log(`  Solo PREFAMILIA K,N,O,G: ${parseFloat(excluded[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
        } catch (e) { console.log('  Error:', e.message); }

        // Check CODIGOFAMILIA values for patterns
        console.log('\n\n5. ART.CODIGOFAMILIA starting with K,N,O,G:');
        console.log('-'.repeat(60));
        try {
            const famKNOG = await conn.query(`
        SELECT A.CODIGOFAMILIA, COUNT(*) as CNT, SUM(L.IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC L
        JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
        WHERE L.ANODOCUMENTO = 2024
          AND (A.CODIGOFAMILIA LIKE 'K%' OR A.CODIGOFAMILIA LIKE 'N%' 
               OR A.CODIGOFAMILIA LIKE 'O%' OR A.CODIGOFAMILIA LIKE 'G%')
        GROUP BY A.CODIGOFAMILIA
        ORDER BY TOTAL DESC
        FETCH FIRST 20 ROWS ONLY
      `);
            console.log('  FAMILIA | Count    | Total Sales');
            console.log('  ' + '-'.repeat(50));
            famKNOG.forEach(r => {
                const fam = (r.CODIGOFAMILIA || 'NULL').toString().trim().padEnd(8);
                const cnt = String(r.CNT).padEnd(10);
                const total = parseFloat(r.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 });
                console.log(`  ${fam} | ${cnt} | ${total}€`);
            });
        } catch (e) { console.log('  Error:', e.message); }

        // Total excluding families starting with K,N,O,G
        console.log('\n\n6. TOTAL WITHOUT FAMILIA starting K,N,O,G:');
        try {
            const total = await conn.query(`
        SELECT SUM(L.IMPORTEVENTA) as TOTAL
        FROM DSEDAC.LAC L
        JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
        WHERE L.ANODOCUMENTO = 2024
          AND L.TIPOVENTA = 'CC'
          AND A.CODIGOFAMILIA NOT LIKE 'K%' 
          AND A.CODIGOFAMILIA NOT LIKE 'N%'
          AND A.CODIGOFAMILIA NOT LIKE 'O%'
          AND A.CODIGOFAMILIA NOT LIKE 'G%'
      `);
            console.log(`  Sin FAMILIA K%,N%,O%,G%: ${parseFloat(total[0]?.TOTAL || 0).toLocaleString('es-ES', { minimumFractionDigits: 2 })}€`);
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
