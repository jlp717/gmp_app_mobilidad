/**
 * REPAIR SCRIPT: Remove orphan blocking entries from RUTERO_CONFIG
 * 
 * An "orphan block" is a client with ORDEN = -1 (blocked from a natural day)
 * that has NO corresponding positive override (ORDEN >= 0) for ANY other day.
 * These were inadvertently created by the Smart Merge bug in POST /rutero/config.
 * 
 * This script:
 * 1. Identifies all orphan blocks
 * 2. Verifies each is NATURAL on the blocked day (CDVI S flag)
 * 3. Removes the blocking entries so clients reappear in their natural route
 * 4. Logs all changes to JAVIER.RUTERO_LOG for audit trail
 * 
 * SAFE TO RUN: Only removes entries that are provably orphaned.
 * RUN WITH --dry-run first to preview changes.
 * 
 * Usage:
 *   node scripts/repair_orphan_blocks.js --dry-run   (preview only)
 *   node scripts/repair_orphan_blocks.js              (apply changes)
 */
const { getPool, initDb } = require('../config/db');

const DRY_RUN = process.argv.includes('--dry-run');

async function repair() {
    let conn;
    try {
        await initDb();
        const pool = getPool();
        conn = await pool.connect();

        console.log(`\n========================================`);
        console.log(`  REPAIR: Orphan Blocks in RUTERO_CONFIG`);
        console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN (preview only)' : '⚡ LIVE (will modify DB)'}`);
        console.log(`  Date: ${new Date().toISOString()}`);
        console.log(`========================================\n`);

        // 1. Get ALL blocking entries
        const blocks = await conn.query(`
            SELECT TRIM(R.VENDEDOR) as VENDEDOR, TRIM(R.DIA) as DIA, TRIM(R.CLIENTE) as CLIENTE
            FROM JAVIER.RUTERO_CONFIG R
            WHERE R.ORDEN = -1
        `);
        console.log(`Total blocking entries (ORDEN=-1): ${blocks.length}`);

        // 2. Get ALL positive entries keyed by VENDEDOR|CLIENTE
        const positives = await conn.query(`
            SELECT TRIM(R.VENDEDOR) as VENDEDOR, TRIM(R.CLIENTE) as CLIENTE
            FROM JAVIER.RUTERO_CONFIG R
            WHERE R.ORDEN >= 0
        `);
        const positiveSet = new Set(positives.map(p => `${p.VENDEDOR}|${p.CLIENTE}`));
        console.log(`Total positive entries (ORDEN>=0): ${positives.length}`);

        // 3. Identify orphan blocks
        const orphans = blocks.filter(b => !positiveSet.has(`${b.VENDEDOR}|${b.CLIENTE}`));
        console.log(`Orphan blocks found: ${orphans.length}\n`);

        if (orphans.length === 0) {
            console.log('✅ No orphan blocks to repair.');
            return;
        }

        // 4. Verify each orphan is NATURAL on the blocked day
        const dayColMap = {
            'lunes': 'DIAVISITALUNESSN',
            'martes': 'DIAVISITAMARTESSN',
            'miercoles': 'DIAVISITAMIERCOLESSN',
            'jueves': 'DIAVISITAJUEVESSN',
            'viernes': 'DIAVISITAVIERNESSN',
            'sabado': 'DIAVISITASABADOSN'
        };

        let repaired = 0;
        let skipped = 0;

        // Group orphans by vendor for batch processing
        const byVendor = {};
        orphans.forEach(o => {
            if (!byVendor[o.VENDEDOR]) byVendor[o.VENDEDOR] = [];
            byVendor[o.VENDEDOR].push(o);
        });

        for (const [vendor, vendorOrphans] of Object.entries(byVendor)) {
            console.log(`\n--- VENDEDOR ${vendor}: ${vendorOrphans.length} orphan blocks ---`);

            // Get client names
            const codes = vendorOrphans.map(o => `'${o.CLIENTE}'`).join(',');
            const names = await conn.query(`
                SELECT TRIM(CODIGOCLIENTE) as CODE, 
                       TRIM(COALESCE(NULLIF(TRIM(NOMBREALTERNATIVO), ''), NOMBRECLIENTE)) as NAME
                FROM DSEDAC.CLI
                WHERE CODIGOCLIENTE IN (${codes})
            `);
            const nameMap = {};
            names.forEach(n => nameMap[n.CODE] = n.NAME);

            for (const orphan of vendorOrphans) {
                const dayCol = dayColMap[orphan.DIA];
                if (!dayCol) {
                    console.log(`  ⚪ SKIP: Unknown day '${orphan.DIA}' for ${orphan.CLIENTE}`);
                    skipped++;
                    continue;
                }

                // Verify natural flag
                const cdvi = await conn.query(`
                    SELECT ${dayCol} as FLAG
                    FROM DSEDAC.CDVI
                    WHERE TRIM(CODIGOVENDEDOR) = '${orphan.VENDEDOR}' AND TRIM(CODIGOCLIENTE) = '${orphan.CLIENTE}'
                    FETCH FIRST 1 ROWS ONLY
                `);

                const isNatural = cdvi.length > 0 && String(cdvi[0].FLAG).trim() === 'S';
                const clientName = nameMap[orphan.CLIENTE] || 'UNKNOWN';

                if (isNatural) {
                    // This is a natural client that was incorrectly blocked - REPAIR
                    console.log(`  🔧 REPAIR: ${orphan.CLIENTE} (${clientName}) - natural ${orphan.DIA}, removing block`);

                    if (!DRY_RUN) {
                        // Delete the orphan block
                        await conn.query(`
                            DELETE FROM JAVIER.RUTERO_CONFIG
                            WHERE TRIM(VENDEDOR) = '${orphan.VENDEDOR}'
                              AND TRIM(DIA) = '${orphan.DIA}'
                              AND TRIM(CLIENTE) = '${orphan.CLIENTE}'
                              AND ORDEN = -1
                        `);

                        // Log the repair
                        try {
                            await conn.query(`
                                INSERT INTO JAVIER.RUTERO_LOG 
                                (VENDEDOR, TIPO_CAMBIO, DIA_ORIGEN, DIA_DESTINO, CLIENTE, NOMBRE_CLIENTE, POSICION_ANTERIOR, POSICION_NUEVA, DETALLES)
                                VALUES ('${orphan.VENDEDOR}', 'REPAIR_ORPHAN_BLOCK', '${orphan.DIA}', '${orphan.DIA}', '${orphan.CLIENTE}', 
                                        '${clientName.replace(/'/g, "''")}', -1, NULL, 
                                        'Removed orphan block: client is natural on ${orphan.DIA} but had no positive override for any day. Bug: Smart Merge in POST /rutero/config.')
                            `);
                        } catch (logErr) {
                            console.log(`    ⚠️ Log insert failed: ${logErr.message}`);
                        }
                    }
                    repaired++;
                } else {
                    // Not natural on this day - block might be intentional (from a move), keep it
                    console.log(`  ⚪ KEEP: ${orphan.CLIENTE} (${clientName}) - NOT natural on ${orphan.DIA}, block may be valid`);
                    skipped++;
                }
            }
        }

        console.log(`\n========================================`);
        console.log(`  SUMMARY`);
        console.log(`========================================`);
        console.log(`  Total orphan blocks: ${orphans.length}`);
        console.log(`  Repaired (natural+blocked removed): ${repaired}`);
        console.log(`  Skipped (non-natural or unknown day): ${skipped}`);
        console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN - NO CHANGES MADE' : '⚡ CHANGES APPLIED'}`);

        if (DRY_RUN && repaired > 0) {
            console.log(`\n  ➡️  Run without --dry-run to apply: node scripts/repair_orphan_blocks.js`);
        }

    } catch (e) {
        console.error('Error:', e);
    } finally {
        if (conn) await conn.close();
        process.exit(0);
    }
}

repair();
