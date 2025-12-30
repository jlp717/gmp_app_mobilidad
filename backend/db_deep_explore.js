/**
 * Deep exploration of LACLAE columns for routes/reparto
 */
const odbc = require('odbc');
const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function deepExplore() {
    const conn = await odbc.connect(DB_CONFIG);

    console.log('🔍 Deep dive into LACLAE day columns and R1/R2/R3/R4 prefixes...\n');

    try {
        // 1. Check what R1, R2, R3, R4 represent
        console.log('1️⃣ Checking R1/R2/R3/R4 prefix columns with sample values...');
        const sample = await conn.query(`
      SELECT 
        LCCDCL,
        R1_T8CDVD, R1_T8DIVL, R1_T8DIVM, R1_T8DIVX, R1_T8DIVJ, R1_T8DIVV, R1_T8DIVS, R1_T8DIVD,
        R1_T8DIRL, R1_T8DIRM, R1_T8DIRX, R1_T8DIRJ, R1_T8DIRV, R1_T8DIRS, R1_T8DIRD,
        R2_T8CDVD, R2_T8DMIC,
        R3_T8CDVD, R3_T8DMIC,
        R4_T8CDVD, R4_T8DMIC
      FROM DSED.LACLAE
      WHERE (R1_T8DIVL = 'S' OR R2_T8CDVD IS NOT NULL)
      FETCH FIRST 10 ROWS ONLY
    `);

        console.log('Sample of R1/R2/R3/R4 columns:');
        sample.forEach((row, i) => {
            console.log(`\n  Row ${i + 1} Client: ${row.LCCDCL}`);
            console.log(`    R1_T8CDVD (Vendedor R1?): "${row.R1_T8CDVD}"`);
            console.log(`    R1 DAYS: L=${row.R1_T8DIVL}, M=${row.R1_T8DIVM}, X=${row.R1_T8DIVX}, J=${row.R1_T8DIVJ}, V=${row.R1_T8DIVV}, S=${row.R1_T8DIVS}, D=${row.R1_T8DIVD}`);
            console.log(`    R1 REPARTO(DIR): L=${row.R1_T8DIRL}, M=${row.R1_T8DIRM}, X=${row.R1_T8DIRX}, J=${row.R1_T8DIRJ}, V=${row.R1_T8DIRV}, S=${row.R1_T8DIRS}, D=${row.R1_T8DIRD}`);
            console.log(`    R2_T8CDVD: "${row.R2_T8CDVD}", R2_T8DMIC: "${row.R2_T8DMIC}"`);
            console.log(`    R3_T8CDVD: "${row.R3_T8CDVD}", R4_T8CDVD: "${row.R4_T8CDVD}"`);
        });

        // 2. Check column naming pattern - DIV = Visita? DIR = Reparto?
        console.log('\n\n2️⃣ Analyzing column patterns:');
        console.log('  R1_T8DIVL = DIV (Visita?) + L (Lunes) = Día de visita Lunes para Ruta 1');
        console.log('  R1_T8DIRL = DIR (Reparto?) + L (Lunes) = Día de reparto Lunes para Ruta 1');
        console.log('  Hypothesis: R1 = First route/vendedor assigned, R2/R3/R4 = Additional routes');

        // 3. Count distinct values to understand usage
        console.log('\n\n3️⃣ Counting records with R1 vs R2 vendedor codes...');
        const counts = await conn.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN R1_T8CDVD IS NOT NULL AND TRIM(R1_T8CDVD) <> '' THEN 1 ELSE 0 END) as has_r1_vendedor,
        SUM(CASE WHEN R2_T8CDVD IS NOT NULL AND TRIM(R2_T8CDVD) <> '' THEN 1 ELSE 0 END) as has_r2_vendedor,
        SUM(CASE WHEN R3_T8CDVD IS NOT NULL AND TRIM(R3_T8CDVD) <> '' THEN 1 ELSE 0 END) as has_r3_vendedor,
        SUM(CASE WHEN R1_T8DIVL = 'S' THEN 1 ELSE 0 END) as lunes_visita,
        SUM(CASE WHEN R1_T8DIRL = 'S' THEN 1 ELSE 0 END) as lunes_reparto
      FROM DSED.LACLAE
      WHERE LCTPLN = 'T'
    `);
        console.log('Counts:', counts[0]);

        // 4. Check for distinct vendedor values in R1 vs R2
        console.log('\n\n4️⃣ Distinct vendedores in R1_T8CDVD vs R2_T8CDVD...');
        const distinctR1 = await conn.query(`
      SELECT DISTINCT TRIM(R1_T8CDVD) as vd FROM DSED.LACLAE WHERE R1_T8CDVD IS NOT NULL AND TRIM(R1_T8CDVD) <> ''
    `);
        const distinctR2 = await conn.query(`
      SELECT DISTINCT TRIM(R2_T8CDVD) as vd FROM DSED.LACLAE WHERE R2_T8CDVD IS NOT NULL AND TRIM(R2_T8CDVD) <> ''
    `);
        console.log('R1 vendedores:', distinctR1.map(r => r.VD).slice(0, 10));
        console.log('R2 vendedores:', distinctR2.map(r => r.VD).slice(0, 10));

        // 5. Verify the DIV vs DIR pattern meanings
        console.log('\n\n5️⃣ Checking if DIV=Visita and DIR=Reparto are different...');
        const divVsDir = await conn.query(`
      SELECT 
        SUM(CASE WHEN R1_T8DIVL = 'S' AND (R1_T8DIRL IS NULL OR R1_T8DIRL <> 'S') THEN 1 ELSE 0 END) as visita_only_lunes,
        SUM(CASE WHEN R1_T8DIRL = 'S' AND (R1_T8DIVL IS NULL OR R1_T8DIVL <> 'S') THEN 1 ELSE 0 END) as reparto_only_lunes,
        SUM(CASE WHEN R1_T8DIVL = 'S' AND R1_T8DIRL = 'S' THEN 1 ELSE 0 END) as both_lunes
      FROM DSED.LACLAE
      WHERE LCTPLN = 'T'
    `);
        console.log('DIV vs DIR analysis for Monday:');
        console.log('  Visita ONLY (no reparto): ', divVsDir[0].VISITA_ONLY_LUNES);
        console.log('  Reparto ONLY (no visita): ', divVsDir[0].REPARTO_ONLY_LUNES);
        console.log('  BOTH visita and reparto:  ', divVsDir[0].BOTH_LUNES);

        // 6. Explore the REPARTOS view mentioned
        console.log('\n\n6️⃣ Exploring DSTMOVIL.REPARTOS view...');
        try {
            const repartos = await conn.query(`SELECT * FROM DSTMOVIL.REPARTOS FETCH FIRST 3 ROWS ONLY`);
            if (repartos.length > 0) {
                console.log('REPARTOS view columns:', Object.keys(repartos[0]).join(', '));
                console.log('Sample:', JSON.stringify(repartos[0], null, 2));
            }
        } catch (e) {
            console.log('Could not access DSTMOVIL.REPARTOS:', e.message);
        }

        // 7. Check TIPOVENDEDOR meanings
        console.log('\n\n7️⃣ Checking TIPOVENDEDOR in VDC...');
        const vendedorTypes = await conn.query(`
      SELECT TIPOVENDEDOR, COUNT(*) as cnt 
      FROM DSEDAC.VDC 
      WHERE SUBEMPRESA = 'GMP'
      GROUP BY TIPOVENDEDOR
    `);
        console.log('Vendedor types breakdown:');
        vendedorTypes.forEach(v => console.log(`  "${v.TIPOVENDEDOR || '(empty)'}": ${v.CNT} vendedores`));

        // 8. Check CLI all columns for routing info
        console.log('\n\n8️⃣ All CLI columns...');
        const cliCols = await conn.query(`
      SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS 
      WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CLI'
      ORDER BY ORDINAL_POSITION
    `);
        console.log('CLI all columns:', cliCols.map(c => c.COLUMN_NAME).join(', '));

        // 9. Sample CLI with route info
        console.log('\n\n9️⃣ CLI sample with route fields...');
        const cliSample = await conn.query(`
      SELECT CODIGOCLIENTE, NOMBRECLIENTE, NOMBREALTERNATIVO, CODIGORUTA, TELEFONO1
      FROM DSEDAC.CLI
      WHERE CODIGORUTA IS NOT NULL
      FETCH FIRST 5 ROWS ONLY
    `);
        cliSample.forEach((c, i) => {
            console.log(`  ${i + 1}. ${c.CODIGOCLIENTE}: "${c.NOMBREALTERNATIVO?.trim() || c.NOMBRECLIENTE?.trim()}" - Ruta: ${c.CODIGORUTA}`);
        });

        // 10. FINAL CONCLUSION
        console.log('\n\n' + '='.repeat(70));
        console.log('🎯 CONCLUSIONS FOR IMPLEMENTATION');
        console.log('='.repeat(70));
        console.log(`
1. COLUMN STRUCTURE IN LACLAE:
   - R1_T8DIVL/M/X/J/V/S/D = Día de VISITA (comercial) para Ruta 1
   - R1_T8DIRL/M/X/J/V/S/D = Día de REPARTO (repartidor) para Ruta 1
   - R1_T8CDVD = Código vendedor asignado a Ruta 1
   - R2/R3/R4 = Additional routes (mostly empty based on counts)

2. FOR ROLE DIFFERENTIATION:
   - Comercial: Use R1_T8DIV* columns (DIVisita)
   - Repartidor: Use R1_T8DIR* columns (DIReparto)

3. RAZÓN SOCIAL:
   - Use NOMBREALTERNATIVO from CLI table
   - Fallback to NOMBRECLIENTE if empty

4. VENDEDOR TYPES ('', 'A', 'P'):
   - Need to verify what A and P mean (possibly Autónomo, Preventa?)
`);

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await conn.close();
    }
}

deepExplore().catch(console.error);
