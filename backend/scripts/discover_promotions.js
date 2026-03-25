/**
 * Discover promotion/offer tables in DSEDAC schema
 * Searches for: PRO%, OFE%, CAM%, DES%, BON%, RAP%, PRE%DES%, PRE%PRO%
 */
'use strict';
const { query, queryWithParams } = require('../config/db');

async function run() {
    console.log('=== DISCOVERING PROMOTION TABLES IN DSEDAC ===\n');

    // 1. Find tables matching promotion patterns
    const patterns = ['PRO%', 'OFE%', 'CAM%', 'DES%', 'BON%', 'RAP%', 'PRE%'];

    for (const pattern of patterns) {
        const sql = `
            SELECT TABLE_NAME, TABLE_TYPE
            FROM QSYS2.SYSTABLES
            WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME LIKE '${pattern}'
            ORDER BY TABLE_NAME
        `;
        const rows = await query(sql);
        if (rows.length > 0) {
            console.log(`\n--- Pattern: ${pattern} ---`);
            for (const r of rows) {
                console.log(`  ${r.TABLE_NAME} (${r.TABLE_TYPE})`);
            }
        }
    }

    // 2. For each found table, get columns + 3 sample rows
    const allPromoTables = await query(`
        SELECT TABLE_NAME
        FROM QSYS2.SYSTABLES
        WHERE TABLE_SCHEMA = 'DSEDAC'
          AND (TABLE_NAME LIKE 'PRO%' OR TABLE_NAME LIKE 'OFE%' OR TABLE_NAME LIKE 'CAM%'
               OR TABLE_NAME LIKE 'DES%' OR TABLE_NAME LIKE 'BON%' OR TABLE_NAME LIKE 'RAP%')
        ORDER BY TABLE_NAME
    `);

    console.log(`\n\n=== FOUND ${allPromoTables.length} TABLES ===\n`);

    for (const table of allPromoTables) {
        const name = table.TABLE_NAME.trim();
        console.log(`\n\n========== ${name} ==========`);

        // Columns
        try {
            const cols = await query(`
                SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, COLUMN_TEXT
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${name}'
                ORDER BY ORDINAL_POSITION
            `);
            console.log(`Columns (${cols.length}):`);
            for (const c of cols) {
                const text = c.COLUMN_TEXT ? ` -- ${c.COLUMN_TEXT.trim()}` : '';
                console.log(`  ${(c.COLUMN_NAME || '').trim().padEnd(25)} ${(c.DATA_TYPE || '').trim().padEnd(10)} (${c.LENGTH}${c.NUMERIC_SCALE ? ',' + c.NUMERIC_SCALE : ''})${text}`);
            }
        } catch (e) {
            console.log(`  Error getting columns: ${e.message}`);
        }

        // Sample rows
        try {
            const samples = await query(`SELECT * FROM DSEDAC.${name} FETCH FIRST 3 ROWS ONLY`);
            if (samples.length > 0) {
                console.log(`\nSample rows (${samples.length}):`);
                for (const row of samples) {
                    const cleaned = {};
                    for (const [k, v] of Object.entries(row)) {
                        if (v !== null && v !== undefined && String(v).trim() !== '') {
                            cleaned[k.trim()] = typeof v === 'string' ? v.trim() : v;
                        }
                    }
                    console.log(`  ${JSON.stringify(cleaned)}`);
                }
            } else {
                console.log('  (empty table)');
            }
        } catch (e) {
            console.log(`  Error getting samples: ${e.message}`);
        }
    }

    // 3. Also check LACLAE for discount columns
    console.log('\n\n=== LACLAE DISCOUNT COLUMNS ===');
    const lacDiscount = await query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH, COLUMN_TEXT
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSED' AND TABLE_NAME = 'LACLAE'
          AND (COLUMN_NAME LIKE '%DES%' OR COLUMN_NAME LIKE '%PRO%' OR COLUMN_NAME LIKE '%DTO%'
               OR COLUMN_NAME LIKE '%BON%' OR COLUMN_NAME LIKE '%OFE%' OR COLUMN_NAME LIKE '%RAP%')
        ORDER BY ORDINAL_POSITION
    `);
    for (const c of lacDiscount) {
        const text = c.COLUMN_TEXT ? ` -- ${c.COLUMN_TEXT.trim()}` : '';
        console.log(`  ${(c.COLUMN_NAME || '').trim().padEnd(25)} ${(c.DATA_TYPE || '').trim().padEnd(10)} (${c.LENGTH})${text}`);
    }

    // 4. Check ARA (tariff) for promo-related columns
    console.log('\n\n=== ARA PROMO-RELATED COLUMNS ===');
    const araPromo = await query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH, COLUMN_TEXT
        FROM QSYS2.SYSCOLUMNS
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'ARA'
          AND (COLUMN_NAME LIKE '%PRO%' OR COLUMN_NAME LIKE '%OFE%' OR COLUMN_NAME LIKE '%DES%'
               OR COLUMN_NAME LIKE '%BON%' OR COLUMN_NAME LIKE '%RAP%')
        ORDER BY ORDINAL_POSITION
    `);
    for (const c of araPromo) {
        const text = c.COLUMN_TEXT ? ` -- ${c.COLUMN_TEXT.trim()}` : '';
        console.log(`  ${(c.COLUMN_NAME || '').trim().padEnd(25)} ${(c.DATA_TYPE || '').trim().padEnd(10)} (${c.LENGTH})${text}`);
    }

    console.log('\n\nDone.');
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
