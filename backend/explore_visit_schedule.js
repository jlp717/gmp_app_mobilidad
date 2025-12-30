/**
 * Database Exploration Script - Find Visit Schedule Tables
 * Run with: node explore_visit_schedule.js
 */

const odbc = require('odbc');

const DB_CONFIG = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function explore() {
  console.log('='.repeat(70));
  console.log('EXPLORING DATABASE FOR VISIT SCHEDULE');
  console.log('='.repeat(70));

  let conn;
  try {
    conn = await odbc.connect(DB_CONFIG);
    console.log('✓ Connected to database\n');

    // 1. Find tables with visit-day related columns
    console.log('1. SEARCHING FOR VISIT-DAY COLUMNS...');
    console.log('-'.repeat(50));
    try {
      const result1 = await conn.query(`
        SELECT TABSCHEMA, TABNAME, COLNAME, TYPENAME
        FROM SYSCAT.COLUMNS
        WHERE (
          UPPER(COLNAME) LIKE '%T8DIV%'
          OR UPPER(COLNAME) LIKE '%DIVL%'
          OR UPPER(COLNAME) LIKE '%DIVM%'
          OR UPPER(COLNAME) LIKE '%DIVX%'
          OR UPPER(COLNAME) LIKE '%DIVJ%'
          OR UPPER(COLNAME) LIKE '%DIVV%'
          OR UPPER(COLNAME) LIKE '%DIVS%'
          OR UPPER(COLNAME) LIKE '%DIVD%'
        )
        AND TABSCHEMA NOT LIKE 'SYS%'
        FETCH FIRST 30 ROWS ONLY
      `);
      if (result1.length > 0) {
        console.log('Found visit-day columns:');
        result1.forEach(r => console.log(`  ${r.TABSCHEMA}.${r.TABNAME} -> ${r.COLNAME} (${r.TYPENAME})`));
      } else {
        console.log('  No T8DIV* columns found');
      }
    } catch (e) {
      console.log('  Error:', e.message);
    }

    // 2. Check if LACLAE exists
    console.log('\n2. CHECKING FOR LACLAE TABLE...');
    console.log('-'.repeat(50));
    try {
      const result2 = await conn.query(`
        SELECT TABSCHEMA, TABNAME, CARD as ROW_COUNT
        FROM SYSCAT.TABLES
        WHERE UPPER(TABNAME) LIKE '%LACLAE%'
        FETCH FIRST 10 ROWS ONLY
      `);
      if (result2.length > 0) {
        console.log('Found LACLAE tables:');
        result2.forEach(r => console.log(`  ${r.TABSCHEMA}.${r.TABNAME} - ${r.ROW_COUNT} rows`));
      } else {
        console.log('  LACLAE table not found');
      }
    } catch (e) {
      console.log('  Error:', e.message);
    }

    // 3. Find route/ruta tables
    console.log('\n3. SEARCHING FOR ROUTE/RUTA TABLES...');
    console.log('-'.repeat(50));
    try {
      const result3 = await conn.query(`
        SELECT TABSCHEMA, TABNAME, CARD as ROW_COUNT
        FROM SYSCAT.TABLES
        WHERE (
          UPPER(TABNAME) LIKE '%RUT%'
          OR UPPER(TABNAME) LIKE '%ROUT%'
          OR UPPER(TABNAME) LIKE '%VISIT%'
        )
        AND TABSCHEMA NOT LIKE 'SYS%'
        FETCH FIRST 20 ROWS ONLY
      `);
      if (result3.length > 0) {
        console.log('Found route/ruta tables:');
        result3.forEach(r => console.log(`  ${r.TABSCHEMA}.${r.TABNAME} - ${r.ROW_COUNT} rows`));
      } else {
        console.log('  No route tables found');
      }
    } catch (e) {
      console.log('  Error:', e.message);
    }

    // 4. Check CLI table for visit day fields
    console.log('\n4. CHECKING CLI TABLE FOR VISIT FIELDS...');
    console.log('-'.repeat(50));
    try {
      const result4 = await conn.query(`
        SELECT COLNAME, TYPENAME
        FROM SYSCAT.COLUMNS
        WHERE TABSCHEMA = 'DSEDAC' AND TABNAME = 'CLI'
          AND (
            UPPER(COLNAME) LIKE '%DIA%'
            OR UPPER(COLNAME) LIKE '%VISIT%'
            OR UPPER(COLNAME) LIKE '%DIV%'
            OR UPPER(COLNAME) LIKE '%LUN%'
            OR UPPER(COLNAME) LIKE '%MAR%'
            OR UPPER(COLNAME) LIKE '%MIER%'
            OR UPPER(COLNAME) LIKE '%JUE%'
            OR UPPER(COLNAME) LIKE '%VIER%'
            OR UPPER(COLNAME) LIKE '%RUTA%'
            OR UPPER(COLNAME) LIKE '%ROUT%'
          )
        ORDER BY COLNAME
        FETCH FIRST 30 ROWS ONLY
      `);
      if (result4.length > 0) {
        console.log('CLI visit-related columns:');
        result4.forEach(r => console.log(`  ${r.COLNAME} (${r.TYPENAME})`));
      } else {
        console.log('  No visit columns in CLI');
      }
    } catch (e) {
      console.log('  Error:', e.message);
    }

    // 5. List all tables in DSED schema
    console.log('\n5. TABLES IN DSED SCHEMA...');
    console.log('-'.repeat(50));
    try {
      const result5 = await conn.query(`
        SELECT TABNAME, CARD as ROW_COUNT
        FROM SYSCAT.TABLES
        WHERE TABSCHEMA = 'DSED' AND TYPE = 'T'
        ORDER BY TABNAME
        FETCH FIRST 50 ROWS ONLY
      `);
      if (result5.length > 0) {
        console.log('DSED tables:');
        result5.forEach(r => console.log(`  ${r.TABNAME} - ${r.ROW_COUNT} rows`));
      } else {
        console.log('  No tables in DSED schema');
      }
    } catch (e) {
      console.log('  Error:', e.message);
    }

    // 6. Count unique clients for current month
    console.log('\n6. CLIENT COUNT FOR CURRENT MONTH (Dec 2024)...');
    console.log('-'.repeat(50));
    try {
      const result6 = await conn.query(`
        SELECT COUNT(DISTINCT CODIGOCLIENTEALBARAN) as UNIQUE_CLIENTS
        FROM DSEDAC.LAC
        WHERE ANODOCUMENTO = 2024 AND MESDOCUMENTO = 12
      `);
      if (result6.length > 0) {
        console.log(`  Unique clients in Dec 2024: ${result6[0].UNIQUE_CLIENTS}`);
      }
    } catch (e) {
      console.log('  Error:', e.message);
    }

    // 7. Find all columns with 'DIA' in name across all tables
    console.log('\n7. ALL COLUMNS WITH DIA IN NAME...');
    console.log('-'.repeat(50));
    try {
      const result7 = await conn.query(`
        SELECT TABSCHEMA, TABNAME, COLNAME, TYPENAME
        FROM SYSCAT.COLUMNS
        WHERE UPPER(COLNAME) LIKE '%DIA%'
          AND TABSCHEMA IN ('DSEDAC', 'DSED', 'DSEMOVIL')
        ORDER BY TABSCHEMA, TABNAME
        FETCH FIRST 30 ROWS ONLY
      `);
      if (result7.length > 0) {
        console.log('Columns with DIA:');
        result7.forEach(r => console.log(`  ${r.TABSCHEMA}.${r.TABNAME}.${r.COLNAME} (${r.TYPENAME})`));
      } else {
        console.log('  No columns found');
      }
    } catch (e) {
      console.log('  Error:', e.message);
    }

    // 8. Sample CLI data to see all columns
    console.log('\n8. SAMPLE CLI ROW (first 3 rows, columns list)...');
    console.log('-'.repeat(50));
    try {
      const result8 = await conn.query(`
        SELECT *
        FROM DSEDAC.CLI
        FETCH FIRST 1 ROWS ONLY
      `);
      if (result8.length > 0) {
        const cols = Object.keys(result8[0]);
        console.log(`  CLI has ${cols.length} columns:`);
        // Show columns in groups of 5
        for (let i = 0; i < cols.length; i += 5) {
          console.log('    ' + cols.slice(i, i + 5).join(', '));
        }
      }
    } catch (e) {
      console.log('  Error:', e.message);
    }

    console.log('\n' + '='.repeat(70));
    console.log('EXPLORATION COMPLETE');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('Connection error:', error.message);
  } finally {
    if (conn) {
      await conn.close();
    }
  }
}

explore().catch(console.error);
