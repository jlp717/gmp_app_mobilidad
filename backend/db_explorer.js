/**
 * Database Explorer Script
 * Comprehensive exploration of DB2 schemas, tables, views, and columns
 * Run with: node db_explorer.js
 */

const odbc = require('odbc');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function explore() {
    console.log('🔍 Starting comprehensive database exploration...\n');

    const conn = await odbc.connect(DB_CONFIG);
    const results = {
        schemas: [],
        tables: {},
        views: {},
        sampleData: {},
        ruteroColumns: {},
        clientColumns: {},
        salesColumns: {}
    };

    try {
        // 1. Get all schemas
        console.log('📂 STEP 1: Getting all schemas...');
        try {
            const schemas = await conn.query(`
        SELECT DISTINCT TABLE_SCHEMA 
        FROM QSYS2.SYSTABLES 
        WHERE TABLE_SCHEMA LIKE 'DSED%' OR TABLE_SCHEMA = 'DSED'
        ORDER BY TABLE_SCHEMA
      `);
            results.schemas = schemas.map(s => s.TABLE_SCHEMA?.trim());
            console.log('   Schemas found:', results.schemas);
        } catch (e) {
            console.log('   Schema query failed, trying alternative...');
            // Fallback: use SYSIBM.SCHEMATA
            try {
                const schemas = await conn.query(`SELECT SCHEMANAME FROM SYSIBM.SCHEMATA WHERE SCHEMANAME LIKE 'DSED%'`);
                results.schemas = schemas.map(s => s.SCHEMANAME?.trim());
                console.log('   Schemas found:', results.schemas);
            } catch (e2) {
                results.schemas = ['DSED', 'DSEDAC'];
                console.log('   Using known schemas:', results.schemas);
            }
        }

        // 2. Get tables in each schema
        console.log('\n📋 STEP 2: Getting tables for each schema...');
        for (const schema of ['DSED', 'DSEDAC']) {
            try {
                const tables = await conn.query(`
          SELECT TABLE_NAME, TABLE_TYPE 
          FROM QSYS2.SYSTABLES 
          WHERE TABLE_SCHEMA = '${schema}'
          ORDER BY TABLE_NAME
        `);
                results.tables[schema] = tables.map(t => ({
                    name: t.TABLE_NAME?.trim(),
                    type: t.TABLE_TYPE?.trim()
                }));
                console.log(`   ${schema}: ${results.tables[schema].length} tables found`);
            } catch (e) {
                console.log(`   Alternative query for ${schema}...`);
                try {
                    const tables = await conn.query(`
            SELECT NAME, TYPE FROM SYSIBM.SYSTABLES WHERE CREATOR = '${schema}'
          `);
                    results.tables[schema] = tables.map(t => ({ name: t.NAME?.trim(), type: t.TYPE?.trim() }));
                    console.log(`   ${schema}: ${results.tables[schema].length} tables`);
                } catch (e2) {
                    console.log(`   Could not list tables for ${schema}`);
                }
            }
        }

        // 3. Explore LACLAE table completely (rutero related)
        console.log('\n🚗 STEP 3: Exploring LACLAE (Rutero) table columns...');
        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NULLABLE
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSED' AND TABLE_NAME = 'LACLAE'
        ORDER BY ORDINAL_POSITION
      `);
            results.ruteroColumns.LACLAE = cols.map(c => ({
                name: c.COLUMN_NAME?.trim(),
                type: c.DATA_TYPE?.trim(),
                length: c.LENGTH
            }));
            console.log(`   Found ${cols.length} columns in DSED.LACLAE`);
            console.log('   All columns:', results.ruteroColumns.LACLAE.map(c => c.name).join(', '));

            // Check for reparto/delivery related columns
            const repartoColumns = results.ruteroColumns.LACLAE.filter(c =>
                c.name.includes('R2') || c.name.includes('REP') || c.name.includes('ENTREGA') || c.name.includes('DELIVERY')
            );
            console.log('   Possible REPARTO columns:', repartoColumns.length > 0 ? repartoColumns.map(c => c.name) : 'NONE FOUND');
        } catch (e) {
            console.log('   LACLAE column query failed:', e.message);
            // Try alternative
            try {
                const cols = await conn.query(`
          SELECT NAME, COLTYPE, LENGTH FROM SYSIBM.SYSCOLUMNS 
          WHERE TBNAME = 'LACLAE' AND TBCREATOR = 'DSED'
        `);
                results.ruteroColumns.LACLAE = cols.map(c => ({ name: c.NAME?.trim(), type: c.COLTYPE?.trim() }));
                console.log(`   Found ${cols.length} columns via alternative`);
            } catch (e2) {
                console.log('   Alternative also failed');
            }
        }

        // 4. Sample data from LACLAE
        console.log('\n📊 STEP 4: Sample data from LACLAE...');
        try {
            const sample = await conn.query(`SELECT * FROM DSED.LACLAE FETCH FIRST 5 ROWS ONLY`);
            if (sample.length > 0) {
                console.log('   Sample row keys:', Object.keys(sample[0]).join(', '));
                results.sampleData.LACLAE = sample;
                console.log('   First row sample values (first 20 fields):');
                const keys = Object.keys(sample[0]).slice(0, 20);
                keys.forEach(k => console.log(`     ${k}: ${sample[0][k]}`));
            }
        } catch (e) {
            console.log('   Sample query failed:', e.message);
        }

        // 5. Explore CLI table for NOMBREALTERNATIVO and other fields
        console.log('\n👤 STEP 5: Exploring CLI (Clientes) table columns...');
        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE, LENGTH
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'CLI'
        ORDER BY ORDINAL_POSITION
      `);
            results.clientColumns.CLI = cols.map(c => ({
                name: c.COLUMN_NAME?.trim(),
                type: c.DATA_TYPE?.trim()
            }));
            console.log(`   Found ${cols.length} columns in DSEDAC.CLI`);

            // Check for razón social related
            const razonSocialCols = results.clientColumns.CLI.filter(c =>
                c.name.includes('ALTERNATIVO') || c.name.includes('RAZON') || c.name.includes('SOCIAL') || c.name.includes('EMPRESA')
            );
            console.log('   Razón Social candidates:', razonSocialCols.map(c => c.name));
        } catch (e) {
            console.log('   CLI column query failed:', e.message);
        }

        // 6. Sample from CLI
        console.log('\n📊 STEP 6: Sample data from CLI with razón social fields...');
        try {
            const sample = await conn.query(`
        SELECT CODIGOCLIENTE, NOMBRECLIENTE, NOMBREALTERNATIVO, NIF, POBLACION
        FROM DSEDAC.CLI 
        WHERE NOMBREALTERNATIVO IS NOT NULL AND TRIM(NOMBREALTERNATIVO) <> ''
        FETCH FIRST 5 ROWS ONLY
      `);
            console.log('   CLI sample with NOMBREALTERNATIVO:');
            sample.forEach((r, i) => {
                console.log(`     ${i + 1}. Code: ${r.CODIGOCLIENTE}, NombreCliente: ${r.NOMBRECLIENTE?.substring(0, 30)}, NombreAlternativo: ${r.NOMBREALTERNATIVO?.substring(0, 30)}`);
            });
            results.sampleData.CLI_razonSocial = sample;
        } catch (e) {
            console.log('   CLI sample failed:', e.message);
        }

        // 7. Look for all tables related to routes/delivery
        console.log('\n🛣️ STEP 7: Searching for route/delivery related tables...');
        const searchTerms = ['RUT', 'REP', 'ENTREGA', 'DELIV', 'ROUT', 'VISIT', 'DIA'];
        for (const schema of ['DSED', 'DSEDAC']) {
            if (results.tables[schema]) {
                const routeTables = results.tables[schema].filter(t =>
                    searchTerms.some(term => t.name.includes(term))
                );
                console.log(`   ${schema} route-related tables:`, routeTables.map(t => t.name));
            }
        }

        // 8. Explore LAC table (sales history)
        console.log('\n💰 STEP 8: Exploring LAC (Sales) table columns...');
        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME, DATA_TYPE
        FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LAC'
        ORDER BY ORDINAL_POSITION
      `);
            results.salesColumns.LAC = cols.map(c => c.COLUMN_NAME?.trim());
            console.log(`   LAC has ${cols.length} columns`);
            console.log('   Key columns:', results.salesColumns.LAC.slice(0, 20).join(', '));
        } catch (e) {
            console.log('   LAC columns query failed:', e.message);
        }

        // 9. Check for any REPARTO or REPARTIDOR specific tables/views
        console.log('\n🚚 STEP 9: Searching specifically for REPARTO/REPARTIDOR structures...');
        try {
            // Try to find views or tables with reparto
            const repartoSearch = await conn.query(`
        SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE
        FROM QSYS2.SYSTABLES
        WHERE (TABLE_NAME LIKE '%REPAR%' OR TABLE_NAME LIKE '%ENTREG%')
        FETCH FIRST 20 ROWS ONLY
      `);
            console.log('   Tables/Views containing REPAR or ENTREG:', repartoSearch.length);
            repartoSearch.forEach(r => console.log(`     ${r.TABLE_SCHEMA}.${r.TABLE_NAME} (${r.TABLE_TYPE})`));
            results.repartoTables = repartoSearch;
        } catch (e) {
            console.log('   Search failed:', e.message);
        }

        // 10. Full column dump from LACLAE to find ALL day-related fields
        console.log('\n📅 STEP 10: Finding ALL day-related columns in LACLAE...');
        if (results.ruteroColumns.LACLAE) {
            const dayColumns = results.ruteroColumns.LACLAE.filter(c =>
                c.name.includes('DIV') || c.name.includes('DIA') || c.name.includes('DAY') ||
                c.name.includes('LUN') || c.name.includes('MAR') || c.name.includes('MIE') ||
                c.name.includes('JUE') || c.name.includes('VIE') || c.name.includes('SAB') ||
                c.name.includes('DOM') || c.name.includes('T8')
            );
            console.log('   Day-related columns found:');
            dayColumns.forEach(c => console.log(`     ${c.name} (${c.type})`));
            results.dayColumns = dayColumns;
        }

        // 11. Check LINDTO for date/sales structure
        console.log('\n📊 STEP 11: Exploring LINDTO columns...');
        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'LINDTO'
        ORDER BY ORDINAL_POSITION
      `);
            results.salesColumns.LINDTO = cols.map(c => c.COLUMN_NAME?.trim());
            console.log(`   LINDTO has ${cols.length} columns`);
        } catch (e) {
            console.log('   LINDTO query failed');
        }

        // 12. Check for VDC (Vendedor) table structure
        console.log('\n👔 STEP 12: Exploring VDC (Vendedor) table...');
        try {
            const cols = await conn.query(`
        SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS 
        WHERE TABLE_SCHEMA = 'DSEDAC' AND TABLE_NAME = 'VDC'
      `);
            console.log('   VDC columns:', cols.map(c => c.COLUMN_NAME?.trim()).join(', '));

            // Sample vendedor types
            const types = await conn.query(`
        SELECT DISTINCT TIPOVENDEDOR FROM DSEDAC.VDC WHERE SUBEMPRESA = 'GMP'
      `);
            console.log('   Vendedor types:', types.map(t => t.TIPOVENDEDOR?.trim()));
        } catch (e) {
            console.log('   VDC query failed:', e.message);
        }

        // 13. Look for route assignment tables
        console.log('\n🗺️ STEP 13: Looking for route assignment tables...');
        try {
            // Check if there's a RUTAS table
            const rutasSample = await conn.query(`SELECT * FROM DSEDAC.RUT FETCH FIRST 3 ROWS ONLY`);
            console.log('   DSEDAC.RUT exists, columns:', Object.keys(rutasSample[0] || {}).join(', '));
            results.sampleData.RUT = rutasSample;
        } catch (e) {
            console.log('   DSEDAC.RUT not found or empty');
        }

        // Final summary
        console.log('\n' + '='.repeat(70));
        console.log('📋 EXPLORATION SUMMARY');
        console.log('='.repeat(70));
        console.log(`Schemas explored: ${results.schemas.join(', ')}`);
        console.log(`LACLAE columns count: ${results.ruteroColumns.LACLAE?.length || 0}`);
        console.log(`CLI columns count: ${results.clientColumns.CLI?.length || 0}`);
        console.log(`Day-related columns: ${results.dayColumns?.length || 0}`);

        // Write results to JSON file
        const fs = require('fs');
        fs.writeFileSync('db_exploration_results.json', JSON.stringify(results, null, 2));
        console.log('\n✅ Full results saved to db_exploration_results.json');

    } catch (error) {
        console.error('❌ Exploration error:', error.message);
    } finally {
        await conn.close();
    }
}

explore().catch(console.error);
