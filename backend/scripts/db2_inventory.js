const odbc = require('odbc');

const DB_CONFIG = `DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;CCSID=1208;CMPTDM=1;CPOOLMAX=5;CPOOLMIN=1;CPTOUT=60;COMMTIMEOUT=90;DBQ=GMP;`;

async function query(sql) {
  let pool = null;
  let conn = null;
  try {
    pool = await odbc.pool(DB_CONFIG);
    conn = await pool.connect();
    const r = await conn.query(sql);
    return r;
  } finally {
    if (conn) try { await conn.close(); } catch(e) {}
    if (pool) try { await pool.close(); } catch(e) {}
  }
}

async function main() {
  const step = process.argv[2] || '1';

  if (step === '1') {
    console.log('=== STEP 1: Candidate tables (PED*, CAB*, LIN*, EST*, ALB*, COB*, RUT*, VEN*) ===');
    const tables = await query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE 
      FROM QSYS2.SYSTABLES 
      WHERE TABLE_SCHEMA IN ('DSEDAC','DSED','JAVIER')
        AND (UPPER(TABLE_NAME) LIKE '%PED%'
          OR UPPER(TABLE_NAME) LIKE '%CAB%'
          OR UPPER(TABLE_NAME) LIKE '%LIN%'
          OR UPPER(TABLE_NAME) LIKE '%EST%'
          OR UPPER(TABLE_NAME) LIKE '%ALB%'
          OR UPPER(TABLE_NAME) LIKE '%COB%'
          OR UPPER(TABLE_NAME) LIKE '%REC%'
          OR UPPER(TABLE_NAME) LIKE '%PAG%'
          OR UPPER(TABLE_NAME) LIKE '%RUT%'
          OR UPPER(TABLE_NAME) LIKE '%FAC%'
          OR UPPER(TABLE_NAME) LIKE '%CLI%'
          OR UPPER(TABLE_NAME) LIKE '%VEN%')
      ORDER BY TABLE_SCHEMA, TABLE_NAME
    `);
    console.log(JSON.stringify(tables, null, 2));
  }

  if (step === '2') {
    console.log('=== STEP 2A: ALL tables in DSEDAC ===');
    const dsedac = await query(`SELECT TABLE_NAME, TABLE_TYPE FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = 'DSEDAC' ORDER BY TABLE_NAME`);
    console.log(JSON.stringify(dsedac, null, 2));

    console.log('\n=== STEP 2B: ALL tables in DSED ===');
    const dsed = await query(`SELECT TABLE_NAME, TABLE_TYPE FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = 'DSED' ORDER BY TABLE_NAME`);
    console.log(JSON.stringify(dsed, null, 2));

    console.log('\n=== STEP 2C: ALL tables in JAVIER ===');
    const javier = await query(`SELECT TABLE_NAME, TABLE_TYPE FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = 'JAVIER' ORDER BY TABLE_NAME`);
    console.log(JSON.stringify(javier, null, 2));
  }

  if (step === '3') {
    console.log('=== STEP 3: Column details for key tables ===');
    // First get the candidate table list
    for (const schema of ['DSEDAC', 'DSED', 'JAVIER']) {
      console.log(`\n--- Schema: ${schema} ---`);
      const tables = await query(`
        SELECT TABLE_NAME FROM QSYS2.SYSTABLES 
        WHERE TABLE_SCHEMA = '${schema}'
          AND (UPPER(TABLE_NAME) LIKE '%PED%'
            OR UPPER(TABLE_NAME) LIKE '%CAB%'
            OR UPPER(TABLE_NAME) LIKE '%LIN%'
            OR UPPER(TABLE_NAME) LIKE '%ALB%'
            OR UPPER(TABLE_NAME) LIKE '%COB%'
            OR UPPER(TABLE_NAME) LIKE '%RUT%'
            OR UPPER(TABLE_NAME) LIKE '%EST%'
            OR UPPER(TABLE_NAME) LIKE '%FAC%'
            OR UPPER(TABLE_NAME) LIKE '%VEN%')
        ORDER BY TABLE_NAME
      `);
      
      for (const t of tables.slice(0, 15)) {
        try {
          const cols = await query(`
            SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE, IS_NULLABLE, COLUMN_TEXT
            FROM QSYS2.SYSCOLUMNS 
            WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${t.TABLE_NAME}'
            ORDER BY ORDINAL_POSITION
          `);
          console.log(`\n  ${schema}.${t.TABLE_NAME} (${cols.length} cols):`);
          for (const c of cols) {
            const scale = c.NUMERIC_SCALE ? ',' + c.NUMERIC_SCALE : '';
            const text = c.COLUMN_TEXT ? ' -- ' + c.COLUMN_TEXT.trim() : '';
            console.log(`    ${c.COLUMN_NAME.padEnd(22)} ${String(c.DATA_TYPE).padEnd(12)}(${c.LENGTH}${scale}) ${c.IS_NULLABLE}${text}`);
          }
        } catch (e) {
          console.log(`  ${schema}.${t.TABLE_NAME}: ERROR (${e.message?.substring(0,60)})`);
        }
      }
    }
  }

  if (step === '4') {
    console.log('=== STEP 4: DISTINCT status/estado values from key tables ===');
    // Discover which ESTADO/STATUS columns exist first
    const statusCols = await query(`
      SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH, COLUMN_TEXT
      FROM QSYS2.SYSCOLUMNS 
      WHERE TABLE_SCHEMA IN ('DSEDAC','DSED','JAVIER')
        AND (UPPER(COLUMN_NAME) LIKE '%ESTADO%' 
          OR UPPER(COLUMN_NAME) LIKE '%STATUS%'
          OR UPPER(COLUMN_NAME) LIKE '%STSPED%'
          OR UPPER(COLUMN_NAME) LIKE '%SITPED%')
      ORDER BY TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME
      FETCH FIRST 30 ROWS ONLY
    `);
    console.log('Status/Estado columns found:');
    console.log(JSON.stringify(statusCols, null, 2));
    
    // Now query DISTINCT values for the most relevant ones
    const distQueries = [];
    for (const col of statusCols) {
      distQueries.push(`SELECT '${col.TABLE_SCHEMA}' AS SCHEMA, '${col.TABLE_NAME}' AS TBL, '${col.COLUMN_NAME}' AS COL, ${col.COLUMN_NAME} AS VAL, COUNT(*) AS CNT FROM ${col.TABLE_SCHEMA}.${col.TABLE_NAME} GROUP BY ${col.COLUMN_NAME} ORDER BY CNT DESC FETCH FIRST 15 ROWS ONLY`);
    }
    
    // Execute in batches of 3
    for (let i = 0; i < Math.min(distQueries.length, 12); i += 3) {
      const batch = distQueries.slice(i, i + 3);
      for (const sql of batch) {
        try {
          const r = await query(sql);
          console.log(`\n${sql.match(/FROM\s+(\S+)/i)?.[1]}.${sql.match(/AS COL,\s*(\w+)\s+AS VAL/i)?.[1] || '?'}:`);
          console.log(JSON.stringify(r, null, 2));
        } catch (e) {
          console.log(`  SKIP: ${e.message?.substring(0,80)}`);
        }
      }
    }
  }

  if (step === '5') {
    console.log('=== STEP 5: DSED schema exploration ===');
    const dsedTables = await query(`SELECT TABLE_NAME, TABLE_TYPE FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = 'DSED' ORDER BY TABLE_NAME`);
    console.log('DSED tables:');
    console.log(JSON.stringify(dsedTables, null, 2));
    
    // Count rows in DSED tables
    for (const t of dsedTables.slice(0, 10)) {
      try {
        const cnt = await query(`SELECT COUNT(*) AS CNT FROM DSED.${t.TABLE_NAME}`);
        console.log(`  DSED.${t.TABLE_NAME}: ${cnt[0].CNT} rows`);
      } catch (e) {
        console.log(`  DSED.${t.TABLE_NAME}: ERROR (${e.message?.substring(0,60)})`);
      }
    }
  }

  if (step === '6') {
    console.log('=== STEP 6: Views ===');
    for (const schema of ['DSEDAC', 'DSED', 'JAVIER']) {
      const views = await query(`SELECT TABLE_NAME FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = '${schema}' AND TABLE_TYPE = 'VIEW' ORDER BY TABLE_NAME`);
      console.log(`\n${schema} views: ${views.map(v=>v.TABLE_NAME).join(', ') || 'none'}`);
    }
  }

  if (step === '7') {
    console.log('=== STEP 7: Structural overlap DSEDAC ∩ JAVIER ===');
    const overlap1 = await query(`
      SELECT A.TABLE_NAME AS TBL FROM QSYS2.SYSTABLES A
      INNER JOIN QSYS2.SYSTABLES B ON A.TABLE_NAME = B.TABLE_NAME
      WHERE A.TABLE_SCHEMA = 'DSEDAC' AND B.TABLE_SCHEMA = 'JAVIER'
      ORDER BY A.TABLE_NAME
    `);
    console.log('DSEDAC ∩ JAVIER:', overlap1.map(r=>r.TBL).join(', '));
    
    const overlap2 = await query(`
      SELECT A.TABLE_NAME AS TBL FROM QSYS2.SYSTABLES A
      INNER JOIN QSYS2.SYSTABLES B ON A.TABLE_NAME = B.TABLE_NAME
      WHERE A.TABLE_SCHEMA = 'DSED' AND B.TABLE_SCHEMA = 'DSEDAC'
      ORDER BY A.TABLE_NAME
    `);
    console.log('DSED ∩ DSEDAC:', overlap2.map(r=>r.TBL).join(', '));

    // Column-level diff for overlapping tables
    for (const row of overlap1.slice(0, 8)) {
      const tbl = row.TBL || row.TABLE_NAME;
      const colsA = await query(`SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME='${tbl}' ORDER BY COLUMN_NAME`);
      const colsB = await query(`SELECT COLUMN_NAME, DATA_TYPE, LENGTH, NUMERIC_SCALE FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='${tbl}' ORDER BY COLUMN_NAME`);
      const setA = new Set(colsA.map(c => `${c.COLUMN_NAME}:${c.DATA_TYPE}:${c.LENGTH}`));
      const setB = new Set(colsB.map(c => `${c.COLUMN_NAME}:${c.DATA_TYPE}:${c.LENGTH}`));
      
      console.log(`\n  ${tbl}:`);
      const onlyA = [...setA].filter(x => !setB.has(x));
      const onlyB = [...setB].filter(x => !setA.has(x));
      const both = [...setA].filter(x => setB.has(x));
      console.log(`    Common: ${both.length} cols | Only DSEDAC: ${onlyA.length} | Only JAVIER: ${onlyB.length}`);
      if (onlyA.length) console.log(`    Only DSEDAC: ${onlyA.join(', ')}`);
      if (onlyB.length) console.log(`    Only JAVIER: ${onlyB.join(', ')}`);
    }
  }

  if (step === '8') {
    // Also check CLI, ART, CVC, LINDTO schemas mentioned in AGENTS.md
    console.log('=== STEP 8: Additional business schemas (CLI, ART, CVC, VDC, RUT, LINDTO) ===');
    for (const schema of ['CLI', 'ART', 'CVC', 'VDC', 'RUT', 'LINDTO']) {
      const tables = await query(`SELECT TABLE_NAME, TABLE_TYPE FROM QSYS2.SYSTABLES WHERE TABLE_SCHEMA = '${schema}' ORDER BY TABLE_NAME FETCH FIRST 20 ROWS ONLY`);
      if (tables.length > 0) {
        console.log(`\n${schema} (${tables.length} shown): ${tables.map(t => t.TABLE_NAME).join(', ')}`);
        
        // Describe first 3 tables briefly
        for (const t of tables.slice(0, 3)) {
          const cnt = await query(`SELECT COUNT(*) AS CNT FROM ${schema}.${t.TABLE_NAME}`);
          console.log(`  ${schema}.${t.TABLE_NAME}: ${cnt[0].CNT} rows (${t.TABLE_TYPE})`);
        }
      } else {
        console.log(`${schema}: no tables found or schema empty`);
      }
    }
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });