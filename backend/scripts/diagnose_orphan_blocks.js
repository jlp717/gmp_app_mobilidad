/**
 * DIAGNOSTIC: Find "orphan blocks" in RUTERO_CONFIG
 * These are clients with ORDEN = -1 (blocked) but NO positive override for any other day.
 * These clients effectively "disappear" from the personalized rutero.
 * 
 * Root cause hypothesis: The Smart Merge in POST /rutero/config creates blocks
 * for natural clients that weren't in the save payload, even though the user
 * never intentionally removed them.
 */
const { query, initDb } = require('../config/db');

async function diagnose() {
    try {
        await initDb();
        console.log('=== DIAGNOSTIC: Orphan Blocks in RUTERO_CONFIG ===\n');

        // 1. Find ALL blocking entries (ORDEN = -1)
        const blocks = await query(`
            SELECT TRIM(R.VENDEDOR) as VENDEDOR, TRIM(R.DIA) as DIA, TRIM(R.CLIENTE) as CLIENTE, R.ORDEN
            FROM JAVIER.RUTERO_CONFIG R
            WHERE R.ORDEN = -1
            ORDER BY R.VENDEDOR, R.DIA, R.CLIENTE
        `);
        console.log(`Total blocking entries (ORDEN=-1): ${blocks.length}\n`);

        // 2. Find all POSITIVE entries
        const positives = await query(`
            SELECT TRIM(R.VENDEDOR) as VENDEDOR, TRIM(R.CLIENTE) as CLIENTE, TRIM(R.DIA) as DIA, R.ORDEN
            FROM JAVIER.RUTERO_CONFIG R
            WHERE R.ORDEN >= 0
            ORDER BY R.VENDEDOR, R.CLIENTE
        `);

        // Build a map: vendedor -> cliente -> [positive days]
        const positiveMap = {};
        positives.forEach(p => {
            const key = `${p.VENDEDOR}|${p.CLIENTE}`;
            if (!positiveMap[key]) positiveMap[key] = [];
            positiveMap[key].push({ day: p.DIA, order: p.ORDEN });
        });

        // 3. Find orphan blocks: blocked clients with NO positive override for ANY day
        const orphans = [];
        blocks.forEach(b => {
            const key = `${b.VENDEDOR}|${b.CLIENTE}`;
            if (!positiveMap[key] || positiveMap[key].length === 0) {
                orphans.push(b);
            }
        });

        console.log(`Orphan blocks (blocked but NO positive day): ${orphans.length}\n`);

        // 4. Group orphans by vendedor
        const byVendor = {};
        orphans.forEach(o => {
            if (!byVendor[o.VENDEDOR]) byVendor[o.VENDEDOR] = [];
            byVendor[o.VENDEDOR].push(o);
        });

        for (const [vendor, clients] of Object.entries(byVendor)) {
            console.log(`\n--- VENDEDOR ${vendor}: ${clients.length} orphan blocks ---`);

            // Get client names
            const codes = clients.map(c => `'${c.CLIENTE}'`).join(',');
            const names = await query(`
                SELECT TRIM(CODIGOCLIENTE) as CODE, TRIM(COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO), ''), NOMBRECLIENTE)) as NAME
                FROM DSEDAC.CLI
                WHERE CODIGOCLIENTE IN (${codes})
            `);
            const nameMap = {};
            names.forEach(n => nameMap[n.CODE] = n.NAME);

            // Check if these clients are natural on the blocked day (CDVI)
            for (const c of clients) {
                const dayCol = {
                    'lunes': 'DIAVISITALUNESSN',
                    'martes': 'DIAVISITAMARTESSN',
                    'miercoles': 'DIAVISITAMIERCOLESSN',
                    'jueves': 'DIAVISITAJUEVESSN',
                    'viernes': 'DIAVISITAVIERNESSN',
                    'sabado': 'DIAVISITASABADOSN'
                }[c.DIA];

                let isNatural = false;
                if (dayCol) {
                    const cdvi = await query(`
                        SELECT ${dayCol} as FLAG
                        FROM DSEDAC.CDVI
                        WHERE TRIM(CODIGOVENDEDOR) = '${c.VENDEDOR}' AND TRIM(CODIGOCLIENTE) = '${c.CLIENTE}'
                        FETCH FIRST 1 ROWS ONLY
                    `);
                    isNatural = cdvi.length > 0 && String(cdvi[0].FLAG).trim() === 'S';
                }

                const name = nameMap[c.CLIENTE] || 'UNKNOWN';
                const marker = isNatural ? '🔴 NATURAL+BLOCKED' : '⚪ non-natural blocked';
                console.log(`  ${marker} | ${c.CLIENTE} | ${name} | blocked on: ${c.DIA}`);
            }
        }

        // 5. Specific check for vendor 33, client *10332
        console.log('\n\n=== SPECIFIC CHECK: Vendor 33, Client ending in 10332 ===');
        const specific = await query(`
            SELECT TRIM(R.VENDEDOR) as VENDEDOR, TRIM(R.DIA) as DIA, TRIM(R.CLIENTE) as CLIENTE, R.ORDEN
            FROM JAVIER.RUTERO_CONFIG R
            WHERE TRIM(R.VENDEDOR) = '33' AND TRIM(R.CLIENTE) LIKE '%10332'
        `);
        if (specific.length > 0) {
            console.log('RUTERO_CONFIG entries:');
            specific.forEach(s => console.log(`  Vendedor: ${s.VENDEDOR}, Día: ${s.DIA}, Cliente: ${s.CLIENTE}, Orden: ${s.ORDEN}`));
        } else {
            console.log('  No entries in RUTERO_CONFIG for this client');
        }

        // Check CDVI
        const cdviCheck = await query(`
            SELECT TRIM(CODIGOVENDEDOR) as VEND, TRIM(CODIGOCLIENTE) as CLI,
                   DIAVISITALUNESSN as L, DIAVISITAMARTESSN as M, DIAVISITAMIERCOLESSN as X,
                   DIAVISITAJUEVESSN as J, DIAVISITAVIERNESSN as V, DIAVISITASABADOSN as S
            FROM DSEDAC.CDVI
            WHERE TRIM(CODIGOVENDEDOR) = '33' AND TRIM(CODIGOCLIENTE) LIKE '%10332'
        `);
        if (cdviCheck.length > 0) {
            console.log('CDVI (natural route):');
            cdviCheck.forEach(c => {
                const days = [];
                if (String(c.L).trim() === 'S') days.push('lunes');
                if (String(c.M).trim() === 'S') days.push('martes');
                if (String(c.X).trim() === 'S') days.push('miercoles');
                if (String(c.J).trim() === 'S') days.push('jueves');
                if (String(c.V).trim() === 'S') days.push('viernes');
                if (String(c.S).trim() === 'S') days.push('sabado');
                console.log(`  ${c.CLI}: Natural days = [${days.join(', ')}]`);
            });
        } else {
            console.log('  Client not found in CDVI for vendor 33');
        }

        // 6. Summary
        console.log('\n=== SUMMARY ===');
        console.log(`Total blocks: ${blocks.length}`);
        console.log(`Orphan blocks (blocked without any positive day): ${orphans.length}`);
        const naturalOrphans = orphans.filter(o => {
            // We'd need the CDVI check per client, simplify for summary
            return true;
        });
        console.log(`These clients are effectively INVISIBLE in personalized rutero.`);
        console.log(`Root cause: Smart Merge in POST /rutero/config blocks natural clients`);
        console.log(`that were not included in the save payload.`);

        process.exit(0);
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
}

diagnose();
