const { query, initDb } = require('../config/db');

async function explorePayments() {
    await initDb();

    console.log('=== 1. FOP PAYMENT TYPES ===');
    try {
        const fop = await query(`
            SELECT CODIGOFORMAPAGO, TRIM(DESCRIPCIONFORMAPAGO) as DESC, CONTADOSN, PRIMERPAGO
            FROM DSEDAC.FOP
        `);
        console.log('Payment types from FOP:');
        fop.forEach(f => {
            const tipo = f.CONTADOSN === 'S' ? 'CONTADO' :
                f.PRIMERPAGO <= 7 ? `RAPIDO(${f.PRIMERPAGO}d)` : `CREDITO(${f.PRIMERPAGO}d)`;
            console.log(`  ${f.CODIGOFORMAPAGO} = ${f.DESC} → ${tipo}`);
        });
    } catch (e) {
        console.log('FOP error:', e.message);
    }

    console.log('\n=== 2. SAMPLE CPC DATA (Delivery Headers) ===');
    try {
        const cpc = await query(`
            SELECT TRIM(CODIGOFORMAPAGO) as FP, IMPORTETOTAL, TRIM(CODIGOCLIENTEALBARAN) as CLI
            FROM DSEDAC.CPC
            WHERE ANODOCUMENTO = 2026 AND MESDOCUMENTO = 1
            FETCH FIRST 10 ROWS ONLY
        `);
        console.log('CPC samples:');
        console.log(JSON.stringify(cpc, null, 2));
    } catch (e) {
        console.log('CPC error:', e.message);
    }

    console.log('\n=== 3. DISTINCT PAYMENT CODES IN CPC ===');
    try {
        const distinct = await query(`
            SELECT TRIM(CODIGOFORMAPAGO) as FP, COUNT(*) as CNT
            FROM DSEDAC.CPC
            WHERE ANODOCUMENTO = 2026
            GROUP BY TRIM(CODIGOFORMAPAGO)
            ORDER BY CNT DESC
        `);
        console.log('Payment codes used:');
        console.log(JSON.stringify(distinct, null, 2));
    } catch (e) {
        console.log('Error:', e.message);
    }

    console.log('\n=== 4. CHECK CLIENT PAYMENT IN CLI ===');
    try {
        const cli = await query(`
            SELECT TRIM(CODIGOCLIENTE) as CLI, TRIM(FORMAPAGO) as FP, DIASPAGO
            FROM DSEDAC.CLI
            WHERE ANOBAJA = 0
            FETCH FIRST 10 ROWS ONLY
        `);
        console.log('CLI payment data:');
        console.log(JSON.stringify(cli, null, 2));
    } catch (e) {
        console.log('Error:', e.message);
    }

    console.log('\n=== 5. LOOK FOR PENDING PAYMENTS/DEBT DATA ===');
    // Check if there's a receivables or pending payment table
    const tables = ['VEN', 'VTO', 'COB', 'REC', 'PEN', 'EFC', 'VCA'];
    for (const t of tables) {
        try {
            const sample = await query(`SELECT * FROM DSEDAC.${t} FETCH FIRST 1 ROWS ONLY`);
            console.log(`\n✅ Table DSEDAC.${t} exists:`);
            console.log(Object.keys(sample[0] || {}).join(', '));
        } catch (e) {
            // Table doesn't exist
        }
    }

    console.log('\n=== 6. CHECK JAVIER SCHEMA FOR PAYMENT TRACKING ===');
    try {
        const jTables = await query(`
            SELECT TABNAME FROM SYSIBM.SYSTABLES 
            WHERE CREATOR = 'JAVIER' 
              AND TYPE = 'T'
        `);
        console.log('JAVIER tables:');
        jTables.forEach(t => console.log('  ' + t.TABNAME));
    } catch (e) {
        console.log('Error listing JAVIER tables:', e.message);
    }

    process.exit();
}

explorePayments();
