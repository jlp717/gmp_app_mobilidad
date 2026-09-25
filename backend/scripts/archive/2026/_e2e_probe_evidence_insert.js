// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-e2e-write | _-scratch gitignored; e2e puntual insert evidencia test | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const crypto = require('crypto');
const { initDb, closePool, query } = require('../config/db');

function dumpErr(label, error) {
  const odbc = (error.odbcErrors || []).map((e) => ({
    state: e.state, code: e.code, message: String(e.message || '').slice(0, 240),
  }));
  console.log(JSON.stringify({
    label,
    name: error.name,
    message: String(error.message || '').slice(0, 300),
    odbc,
  }));
}

async function main() {
  const pool = await initDb();
  const conn = await pool.connect();

  const cols = await query(`
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, LENGTH, IS_NULLABLE
      FROM QSYS2.SYSCOLUMNS
     WHERE TABLE_SCHEMA = 'JAVIER'
       AND TABLE_NAME IN (
         'TEST_REPARTO_EVIDENCIAS',
         'TEST_REPARTO_CONFIRMACIONES',
         'TEST_REPARTO_LINEAS',
         'TEST_REPARTO_CONFIRM_EVIDENCIAS'
       )
     ORDER BY TABLE_NAME, ORDINAL_POSITION
  `);
  console.log('COLUMNS', JSON.stringify(cols.map((r) => ({
    t: r.TABLE_NAME, c: r.COLUMN_NAME, d: r.DATA_TYPE, l: r.LENGTH, n: r.IS_NULLABLE,
  })), (_, v) => (typeof v === 'bigint' ? String(v) : v)));

  try {
    const idx = await query(`
      SELECT I.TABLE_NAME, I.INDEX_NAME, I.IS_UNIQUE, K.COLUMN_NAME, K.ORDINAL_POSITION
        FROM QSYS2.SYSINDEXES I
        INNER JOIN QSYS2.SYSKEYS K
          ON K.INDEX_SCHEMA = I.INDEX_SCHEMA AND K.INDEX_NAME = I.INDEX_NAME
       WHERE I.TABLE_SCHEMA = 'JAVIER'
         AND I.TABLE_NAME IN (
           'TEST_REPARTO_EVIDENCIAS',
           'TEST_REPARTO_CONFIRMACIONES',
           'TEST_REPARTIDOR_COBROS'
         )
       ORDER BY I.TABLE_NAME, I.INDEX_NAME, K.ORDINAL_POSITION
    `);
    console.log('INDEXES', JSON.stringify(idx, (_, v) => (typeof v === 'bigint' ? String(v) : v)));
  } catch (error) {
    dumpErr('indexes', error);
  }
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const sha = crypto.createHash('sha256').update(png).digest('hex');
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const iso = expires.toISOString().replace('T', ' ').replace('Z', '');
  const ibm = `${expires.getFullYear()}-${String(expires.getMonth() + 1).padStart(2, '0')}-${String(expires.getDate()).padStart(2, '0')}-${String(expires.getHours()).padStart(2, '0')}.${String(expires.getMinutes()).padStart(2, '0')}.${String(expires.getSeconds()).padStart(2, '0')}.000000`;

  const attempts = [
    {
      label: 'date+buffer',
      sql: `INSERT INTO JAVIER.TEST_REPARTO_EVIDENCIAS (EVIDENCE_ID, DOCUMENT_ID, REPARTIDOR_ID, EVIDENCE_KIND, STORAGE_REFERENCE, MIME_TYPE, CONTENT_SHA256, CONTENT_BYTES, CONTENT_BLOB, STATUS, CREATED_AT, EXPIRES_AT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', CURRENT TIMESTAMP, ?)`,
      params: [`ev_probe_date_${Date.now()}`, 'probe-doc', '08', 'FIRMA', 'DB2_BLOB:probe', 'image/png', sha, png.length, png, expires],
    },
    {
      label: 'iso+buffer',
      sql: `INSERT INTO JAVIER.TEST_REPARTO_EVIDENCIAS (EVIDENCE_ID, DOCUMENT_ID, REPARTIDOR_ID, EVIDENCE_KIND, STORAGE_REFERENCE, MIME_TYPE, CONTENT_SHA256, CONTENT_BYTES, CONTENT_BLOB, STATUS, CREATED_AT, EXPIRES_AT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', CURRENT TIMESTAMP, ?)`,
      params: [`ev_probe_iso_${Date.now()}`, 'probe-doc', '08', 'FIRMA', 'DB2_BLOB:probe', 'image/png', sha, png.length, png, iso],
    },
    {
      label: 'ibm+buffer',
      sql: `INSERT INTO JAVIER.TEST_REPARTO_EVIDENCIAS (EVIDENCE_ID, DOCUMENT_ID, REPARTIDOR_ID, EVIDENCE_KIND, STORAGE_REFERENCE, MIME_TYPE, CONTENT_SHA256, CONTENT_BYTES, CONTENT_BLOB, STATUS, CREATED_AT, EXPIRES_AT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', CURRENT TIMESTAMP, ?)`,
      params: [`ev_probe_ibm_${Date.now()}`, 'probe-doc', '08', 'FIRMA', 'DB2_BLOB:probe', 'image/png', sha, png.length, png, ibm],
    },
    {
      label: 'cast-blob+ibm',
      sql: `INSERT INTO JAVIER.TEST_REPARTO_EVIDENCIAS (EVIDENCE_ID, DOCUMENT_ID, REPARTIDOR_ID, EVIDENCE_KIND, STORAGE_REFERENCE, MIME_TYPE, CONTENT_SHA256, CONTENT_BYTES, CONTENT_BLOB, STATUS, CREATED_AT, EXPIRES_AT) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS BLOB), 'PENDIENTE', CURRENT TIMESTAMP, ?)`,
      params: [`ev_probe_cast_${Date.now()}`, 'probe-doc', '08', 'FIRMA', 'DB2_BLOB:probe', 'image/png', sha, png.length, png, ibm],
    },
    {
      label: 'select-for-update',
      sql: `SELECT DOCUMENT_ID FROM JAVIER.TEST_REPARTO_EVIDENCIAS WHERE EVIDENCE_ID = ? FOR UPDATE WITH RS`,
      params: ['missing-id-probe'],
    },
  ];

  for (const attempt of attempts) {
    try {
      await conn.beginTransaction();
      const result = await conn.query(attempt.sql, attempt.params);
      await conn.rollback();
      console.log(JSON.stringify({ label: attempt.label, ok: true, rows: Array.isArray(result) ? result.length : null }));
    } catch (error) {
      try { await conn.rollback(); } catch (_) { /* ignore */ }
      dumpErr(attempt.label, error);
    }
  }

  try { await conn.close(); } catch (_) { /* ignore */ }
  await closePool();
}

main().catch(async (e) => {
  dumpErr('fatal', e);
  try { await closePool(); } catch (_) { /* ignore */ }
  process.exit(1);
});
