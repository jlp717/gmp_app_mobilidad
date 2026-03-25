/**
 * DB2 Schema Discovery for PEDIDOS Module
 * Finds stock, tariff/price, order, unit conversion, and promotion tables in DSEDAC
 */

const odbc = require('odbc');
const fs = require('fs');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function discover() {
    let conn;
    const output = [];
    const log = (msg) => { console.log(msg); output.push(msg); };

    try {
        conn = await odbc.connect(DB_CONFIG);
        log('Connected to DB2\n');

        // Categories to search
        const searches = [
            {
                name: 'STOCK / INVENTORY',
                patterns: ['STO%', 'STK%', 'ALM%', 'EXI%', 'INV%']
            },
            {
                name: 'TARIFF / PRICES',
                patterns: ['TAR%', 'PRE%', 'PVP%', 'TPC%', 'TPV%']
            },
            {
                name: 'ORDERS / PEDIDOS',
                patterns: ['PED%', 'CPE%', 'LPE%', 'CPD%', 'LPD%', 'OPE%', 'OPP%']
            },
            {
                name: 'UNIT CONVERSION / MEASURES',
                patterns: ['UNI%', 'UMD%', 'CON%', 'MED%']
            },
            {
                name: 'CLIENT PRICING / CONDITIONS',
                patterns: ['CPC%', 'CVC%', 'DPC%', 'DCC%']
            },
            {
                name: 'PROMOTIONS / OFFERS',
                patterns: ['PRO%', 'CAM%', 'OFE%', 'REG%']
            },
            {
                name: 'SALES LINES / DETAIL',
                patterns: ['LIN%', 'LAC%', 'DET%', 'LIQ%']
            }
        ];

        for (const search of searches) {
            log('='.repeat(70));
            log(`  ${search.name}`);
            log('='.repeat(70));

            const likeClauses = search.patterns.map(p => `TABLE_NAME LIKE '${p}'`).join(' OR ');
            const sql = `
                SELECT TABLE_NAME, TABLE_TEXT, TABLE_TYPE
                FROM QSYS2.SYSTABLES
                WHERE TABLE_SCHEMA = 'DSEDAC'
                  AND (${likeClauses})
                ORDER BY TABLE_NAME
            `;

            let tables;
            try {
                tables = await conn.query(sql);
            } catch (e) {
                // Fallback: try SYSIBM
                const fallbackSql = `
                    SELECT NAME AS TABLE_NAME, '' AS TABLE_TEXT, TYPE AS TABLE_TYPE
                    FROM SYSIBM.SYSTABLES
                    WHERE DBNAME = 'DSEDAC'
                      AND (${likeClauses.replace(/TABLE_NAME/g, 'NAME')})
                    ORDER BY NAME
                `;
                try {
                    tables = await conn.query(fallbackSql);
                } catch (e2) {
                    log(`  ERROR querying tables: ${e.message}`);
                    log(`  Fallback also failed: ${e2.message}\n`);
                    continue;
                }
            }

            if (!tables || tables.length === 0) {
                log('  (no tables found)\n');
                continue;
            }

            log(`  Found ${tables.length} table(s):\n`);

            for (const t of tables) {
                const tName = (t.TABLE_NAME || t.Name || '').trim();
                const tText = (t.TABLE_TEXT || '').trim();
                log(`  --- ${tName} ${tText ? '(' + tText + ')' : ''} ---`);

                // Get columns
                try {
                    const colSql = `
                        SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE
                        FROM QSYS2.SYSCOLUMNS
                        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = '${tName}'
                        ORDER BY ORDINAL_POSITION
                    `;
                    let cols;
                    try {
                        cols = await conn.query(colSql);
                    } catch (e) {
                        const fallbackCol = `
                            SELECT NAME AS COLUMN_NAME, COLTYPE AS DATA_TYPE, LENGTH, SCALE AS NUMERIC_SCALE, NULLS AS IS_NULLABLE
                            FROM SYSIBM.SYSCOLUMNS
                            WHERE TBNAME = '${tName}' AND DBNAME = 'DSEDAC'
                            ORDER BY COLNO
                        `;
                        cols = await conn.query(fallbackCol);
                    }

                    if (cols && cols.length > 0) {
                        log(`  Columns (${cols.length}):`);
                        for (const c of cols) {
                            const name = (c.COLUMN_NAME || c.Name || '').trim();
                            const type = (c.DATA_TYPE || '').trim();
                            const len = c.LENGTH || '';
                            const scale = c.NUMERIC_SCALE || '';
                            const nullable = (c.IS_NULLABLE || '').trim();
                            log(`    ${name.padEnd(30)} ${type}(${len}${scale ? ',' + scale : ''}) ${nullable === 'Y' ? 'NULL' : 'NOT NULL'}`);
                        }
                    }
                } catch (e) {
                    log(`  (columns error: ${e.message})`);
                }

                // Get sample rows
                try {
                    const sampleSql = `SELECT * FROM DSEDAC.${tName} FETCH FIRST 3 ROWS ONLY`;
                    const rows = await conn.query(sampleSql);
                    if (rows && rows.length > 0) {
                        log(`  Sample data (${rows.length} rows):`);
                        for (const row of rows) {
                            const cleaned = {};
                            for (const [k, v] of Object.entries(row)) {
                                if (v !== null && v !== undefined) {
                                    cleaned[k] = typeof v === 'string' ? v.trim() : v;
                                }
                            }
                            log(`    ${JSON.stringify(cleaned)}`);
                        }
                    } else {
                        log('  (empty table)');
                    }
                } catch (e) {
                    log(`  (sample error: ${e.message})`);
                }
                log('');
            }
        }

        // Also explore ART table columns (already known, but check for price/stock related fields)
        log('='.repeat(70));
        log('  ART TABLE - Full column listing');
        log('='.repeat(70));
        try {
            const artCols = await conn.query(`
                SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'ART'
                ORDER BY ORDINAL_POSITION
            `);
            for (const c of artCols) {
                log(`  ${(c.COLUMN_NAME || '').trim().padEnd(35)} ${(c.DATA_TYPE || '').trim()}(${c.LENGTH}${c.NUMERIC_SCALE ? ',' + c.NUMERIC_SCALE : ''})`);
            }
        } catch (e) {
            log(`  ART columns error: ${e.message}`);
        }

        // Check LINDTO columns (sales lines - useful for recommendations)
        log('\n' + '='.repeat(70));
        log('  LINDTO TABLE - Full column listing');
        log('='.repeat(70));
        try {
            const lindtoCols = await conn.query(`
                SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE
                FROM QSYS2.SYSCOLUMNS
                WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LINDTO'
                ORDER BY ORDINAL_POSITION
            `);
            for (const c of lindtoCols) {
                log(`  ${(c.COLUMN_NAME || '').trim().padEnd(35)} ${(c.DATA_TYPE || '').trim()}(${c.LENGTH}${c.NUMERIC_SCALE ? ',' + c.NUMERIC_SCALE : ''})`);
            }
        } catch (e) {
            log(`  LINDTO columns error: ${e.message}`);
        }

    } catch (e) {
        log(`FATAL: ${e.message}`);
    } finally {
        if (conn) await conn.close();
    }

    // Write output
    const outPath = require('path').join(__dirname, 'discover_pedidos_output.txt');
    fs.writeFileSync(outPath, output.join('\n'), 'utf8');
    console.log(`\nOutput written to: ${outPath}`);
}

discover().catch(console.error);
