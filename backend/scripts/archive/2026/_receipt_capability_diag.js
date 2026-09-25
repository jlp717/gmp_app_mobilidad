// ARCHIVE one-off [2026/anio-mtime]: header-no-leido;_scratch-diag | _-scratch gitignored; diagnostico puntual capability recibos | NO EJECUTAR (GMP-SCRIPTS-FINAL-ARCHIVE-20260925).
'use strict';

/**
 * Read-only: list TEST cobros columns vs receipt REQUIRED, plus confirmation 16 keys.
 * No tokens. No DML.
 */
const path = require('path');
const { loadEnv } = require('../config/load-env');
loadEnv(path.join(__dirname, '..'));
const odbc = require('odbc');
const db2ConnectionString = require('./db2-connection');
const { REQUIRED } = require('../repositories/reparto-receipt-db2-repository');

function col(row, name) {
  return row?.[name] ?? row?.[name.toLowerCase()] ?? row?.[name.toUpperCase()];
}

function jsonSafe(value) {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = jsonSafe(item);
    return out;
  }
  return value;
}

(async () => {
  const conn = await odbc.connect({ connectionString: db2ConnectionString() });
  try {
    const cobrosCols = await conn.query(
      "SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='TEST_REPARTIDOR_COBROS'",
    );
    const have = new Set(cobrosCols.map((row) => String(col(row, 'COLUMN_NAME') || '').trim().toUpperCase()));
    const missingCobros = REQUIRED.cobros.filter((name) => !have.has(name));

    const evidMeta = await conn.query(
      "SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA='JAVIER' AND TABLE_NAME='TEST_REPARTO_EVIDENCIAS'",
    );
    const evidAll = new Set(evidMeta.map((row) => String(col(row, 'COLUMN_NAME') || '').trim().toUpperCase()));
    const { REQUIRED_EVIDENCE_COLUMNS } = require('../repositories/reparto-evidence-db2-repository');
    const missingEvidenceStore = REQUIRED_EVIDENCE_COLUMNS.filter((name) => !evidAll.has(name));

    const hexProbe = await conn.query(
      "SELECT HEX(CONTENT_BLOB) AS CONTENT_HEX FROM JAVIER.TEST_REPARTO_EVIDENCIAS WHERE EVIDENCE_ID = 'ev_491e54198637666ac21c51cbd41185c567cb749418a9958083b610c3e4958ee7'",
    );
    const hex = hexProbe[0] ? String(col(hexProbe[0], 'CONTENT_HEX') || '') : '';
    let substrOk = false;
    try {
      const sub = await conn.query(
        "SELECT HEX(SUBSTR(CONTENT_BLOB, 1, 32)) AS CONTENT_HEX FROM JAVIER.TEST_REPARTO_EVIDENCIAS WHERE EVIDENCE_ID = 'ev_491e54198637666ac21c51cbd41185c567cb749418a9958083b610c3e4958ee7'",
      );
      const sh = sub[0] ? String(col(sub[0], 'CONTENT_HEX') || '') : '';
      substrOk = sh.length === 64;
    } catch (_error) {
      substrOk = false;
    }

    const confirm = await conn.query(
      'SELECT ID, REPARTIDOR_ID, DOCUMENTO_TIPO, DOCUMENTO_ORIGEN, DOCUMENTO_SUBEMPRESA, DOCUMENTO_EJERCICIO, DOCUMENTO_SERIE, DOCUMENTO_TERMINAL, DOCUMENTO_NUMERO, DOCUMENTO_XDE, DOCUMENTO_DEX, FIRMA_EVIDENCE_ID, RECEPTOR_NOMBRE, RECEPTOR_DNI FROM JAVIER.TEST_REPARTO_CONFIRMACIONES WHERE ID = 16',
    );
    const lines = await conn.query(
      'SELECT COUNT(*) AS N, MIN(PRECIO_UNITARIO) AS MINP, MAX(PRECIO_UNITARIO) AS MAXP FROM JAVIER.TEST_REPARTO_LINEAS WHERE CONFIRMACION_ID = 16',
    );
    const links = await conn.query(
      'SELECT COUNT(*) AS N FROM JAVIER.TEST_REPARTO_CONFIRM_EVIDENCIAS WHERE CONFIRMACION_ID = 16',
    );

    const c = confirm[0] || null;
    console.log(JSON.stringify(jsonSafe({
      ok: true,
      cobrosColumnCount: have.size,
      missingCobros,
      missingEvidenceStore,
      blobShape: {
        hexLen: hex.length,
        hexEven: hex.length % 2 === 0,
        decodedLen: hex.length ? Buffer.from(hex, 'hex').length : 0,
        pngSig: hex.slice(0, 16).toUpperCase() === '89504E470D0A1A0A',
        substrOk,
      },
      confirm16: c ? {
        id: col(c, 'ID'),
        owner: String(col(c, 'REPARTIDOR_ID') || '').trim(),
        tipo: col(c, 'DOCUMENTO_TIPO'),
        origen: col(c, 'DOCUMENTO_ORIGEN'),
        subempresa: col(c, 'DOCUMENTO_SUBEMPRESA'),
        ejercicio: col(c, 'DOCUMENTO_EJERCICIO'),
        serie: col(c, 'DOCUMENTO_SERIE'),
        terminal: col(c, 'DOCUMENTO_TERMINAL'),
        numero: col(c, 'DOCUMENTO_NUMERO'),
        xde: col(c, 'DOCUMENTO_XDE'),
        dex: col(c, 'DOCUMENTO_DEX'),
        hasFirma: Boolean(col(c, 'FIRMA_EVIDENCE_ID')),
        receptorNombre: Boolean(String(col(c, 'RECEPTOR_NOMBRE') || '').trim()),
        receptorDni: Boolean(String(col(c, 'RECEPTOR_DNI') || '').trim()),
      } : null,
      lines: lines[0] || null,
      evidenceLinks: links[0] || null,
    })));
  } finally {
    await conn.close();
  }
})().catch((error) => {
  console.log(JSON.stringify({
    ok: false,
    code: error.code || null,
    message: String(error.message || error).slice(0, 180),
  }));
  process.exit(1);
});
