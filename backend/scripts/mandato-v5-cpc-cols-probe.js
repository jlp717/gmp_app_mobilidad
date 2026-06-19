'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const odbc = require('odbc');

const CPC_COLS = [
  'SUBEMPRESAPEDIDO', 'EJERCICIOPEDIDO', 'SERIEPEDIDO', 'TERMINALPEDIDO', 'NUMEROPEDIDO',
  'DIADOCUMENTO', 'MESDOCUMENTO', 'ANODOCUMENTO', 'HORADOCUMENTO',
  'CODIGOCLIENTEALBARAN', 'CODIGOCLIENTEFACTURA', 'CODIGOCLIENTECADENA',
  'CODIGOVENDEDOR', 'CODIGOVENDEDORCOBRO', 'CODIGOPROMOTORPREVENTA', 'CODIGOCOMERCIAL',
  'CODIGORUTA',
  'CODIGOFORMAPAGO', 'CODIGOTARIFA', 'CODIGOALMACEN', 'RECARGOSN',
  'IMPORTEBASEIMPONIBLEBRUTA1', 'IMPORTEBASEIMPONIBLE1', 'IMPORTEBRUTO',
  'IMPORTETOTAL', 'IMPORTECOSTO', 'IMPORTEMARGEN',
  'SITUACIONPEDIDO', 'CODIGOOPERACION', 'OBSERVACION1', 'OBSERVACION2',
  'DIACREACION', 'MESCREACION', 'ANOCREACION', 'HORACREACION',
  'CODIGOVENDEDORUSUARIO', 'CODIGOUSUARIO', 'CODIGOTIPOPEDIDO',
  'DIASERVICIO', 'MESSERVICIO', 'ANOSERVICIO',
];

const LPC_COLS = [
  'SUBEMPRESAPEDIDO', 'EJERCICIOPEDIDO', 'SERIEPEDIDO', 'TERMINALPEDIDO', 'NUMEROPEDIDO',
  'SECUENCIAPEDIDO', 'DIADOCUMENTO', 'MESDOCUMENTO', 'ANODOCUMENTO', 'HORADOCUMENTO',
  'CODIGOCLIENTEALBARAN', 'CODIGOCLIENTEFACTURA', 'CODIGOCLIENTECADENA',
  'CODIGOVENDEDOR', 'CODIGOVENDEDORCOBRO', 'CODIGOPROMOTORPREVENTA', 'CODIGOCOMERCIAL',
  'CODIGORUTA', 'CODIGOFORMAPAGO', 'CODIGOTARIFA', 'CODIGOALMACEN', 'RECARGOSN',
  'TIPOLINEA', 'TIPOVENTA', 'CLASELINEA', 'CODIGOARTICULO', 'DESCRIPCION',
  'CANTIDADENVASES', 'CANTIDADUNIDADES', 'PRECIOVENTA', 'IMPORTEVENTA',
  'PRECIOCOSTO', 'IMPORTECOSTO', 'CAJASUNIDADES', 'PRECIOTARIFACLIENTE',
  'PRECIOTARIFA01', 'CODIGOESTADO',
];

(async () => {
  const pwd = process.env.ODBC_PWD || process.env.ODBC_PASSWORD;
  const conn = await odbc.connect(`DSN=GMP;UID=JAVIER;PWD=${pwd};NAM=1;CCSID=1208;CMPTDM=1;CPTOUT=120;COMMTIMEOUT=180;DBQ=GMP`);

  for (const [table, expected] of [['CPC', CPC_COLS], ['LPC', LPC_COLS]]) {
    const rows = await conn.query(
      `SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`,
      [table],
    );
    const actual = new Set(rows.map((r) => String(r.COLUMN_NAME).trim()));
    const missing = expected.filter((c) => !actual.has(c));
    const extra = [...actual].filter((c) => !expected.includes(c)).slice(0, 20);
    console.log(`\n=== DSEDAC.${table} ===`);
    console.log('actual:', actual.size, 'expected:', expected.length);
    console.log('missing:', missing);
    if (missing.length) {
      for (const col of missing) {
        const like = await conn.query(
          `SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA='DSEDAC' AND TABLE_NAME=? AND COLUMN_NAME LIKE ?`,
          [table, `%${col.slice(0, 8)}%`],
        );
        console.log(`  alt for ${col}:`, like.map((r) => r.COLUMN_NAME));
      }
    }
    console.log('sample extra:', extra);
  }

  // Test minimal CPC insert in transaction
  await conn.query('BEGIN WORK');
  try {
    const rows = await conn.query(
      `SELECT COALESCE(MAX(NUMEROPEDIDO),0)+1 AS N FROM DSEDAC.CPC WHERE TRIM(SUBEMPRESAPEDIDO)=? AND EJERCICIOPEDIDO=? AND TRIM(SERIEPEDIDO)=? AND TERMINALPEDIDO=?`,
      ['GMP', 2026, 'P', 93],
    );
    const numero = rows[0].N;
    const sql = `INSERT INTO DSEDAC.CPC (${CPC_COLS.join(',')}) VALUES (${CPC_COLS.map(() => '?').join(',')})`;
    const params = [
      'GMP', 2026, 'P', 93, numero,
      18, 6, 2026, 120000,
      '4300000354', '4300000354', '',
      '93', '93', '93', '93',
      '    ',
      '02', 1, 1, 'N',
      1, 1, 1, 1, 0.5, 0.5,
      'A', 'V', ' ', ' ',
      18, 6, 2026, 120000,
      '93', 'APP', '   ',
      20, 6, 2026,
    ];
    await conn.query(sql, params);
    console.log('\nFull CPC insert OK, numero=', numero);
    await conn.query('ROLLBACK');
  } catch (e) {
    console.log('\nFull CPC insert FAIL:', e.message, JSON.stringify(e.odbcErrors));
    try { await conn.query('ROLLBACK'); } catch (_) {}
  }

  await conn.close();
})().catch((e) => { console.error(e); process.exit(1); });
