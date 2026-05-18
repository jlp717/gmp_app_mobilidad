const odbc = require('odbc');
const CONN = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;CCSID=1208;';

(async () => {
  const pool = await odbc.pool(CONN);
  const conn = await pool.connect();
  console.log('Conectado OK');

  const sql = `CREATE OR REPLACE VIEW JAVIER.VISTA_DEUDA_BASE AS
SELECT
  CVC.TIPODOCUMENTO,
  CVC.ORIGENDOCUMENTO,
  CVC.SUBEMPRESADOCUMENTO,
  CVC.EJERCICIODOCUMENTO,
  CVC.SERIEDOCUMENTO,
  CVC.TERMINALDOCUMENTO,
  CVC.NUMERODOCUMENTO,
  CVC.XDEDOCUMENTO,
  CVC.DEXDOCUMENTO,
  CVC.SITUACION,
  CVC.CODIGOCLIENTEALBARAN,
  CVC.CODIGOCLIENTEFACTURA,
  CVC.CODIGOVENDEDOR,
  CVC.CODIGOFORMAPAGO,
  CVC.DIAVENCIMIENTO,
  CVC.MESVENCIMIENTO,
  CVC.ANOVENCIMIENTO,
  CVC.DIAEMISION,
  CVC.MESEMISION,
  CVC.ANOEMISION,
  CVC.IMPORTEVENCIMIENTO,
  CVC.IMPORTECANCELADO,
  CVC.IMPORTEPENDIENTE,
  CVC.OBSERVACIONES,
  CVC.ANULADOSN,
  CVC.CODIGOVENDEDORPOSEEDOR,
  CPC.SUBEMPRESAPEDIDO,
  CPC.EJERCICIOPEDIDO,
  CPC.SERIEPEDIDO,
  CPC.TERMINALPEDIDO,
  CPC.NUMEROPEDIDO,
  CPC.SUBEMPRESAALBARAN,
  CPC.EJERCICIOALBARAN,
  CPC.SERIEALBARAN,
  CPC.TERMINALALBARAN,
  CPC.NUMEROALBARAN,
  CPC.IMPORTETOTAL,
  CPC.SITUACIONALBARAN,
  CPC.DIADOCUMENTO,
  CPC.MESDOCUMENTO,
  CPC.ANODOCUMENTO
FROM DSEDAC.CVC CVC
LEFT JOIN DSEDAC.CPC CPC
  ON CVC.SUBEMPRESADOCUMENTO = CPC.SUBEMPRESAALBARAN
  AND CVC.EJERCICIODOCUMENTO = CPC.EJERCICIOALBARAN
  AND CVC.SERIEDOCUMENTO = CPC.SERIEALBARAN
  AND CVC.TERMINALDOCUMENTO = CPC.TERMINALALBARAN
  AND CVC.NUMERODOCUMENTO = CPC.NUMEROALBARAN
WHERE CVC.IMPORTEPENDIENTE <> 0
  AND CVC.ANULADOSN <> 'S'
  AND (CVC.ANOEMISION * 10000 + CVC.MESEMISION * 100 + CVC.DIAEMISION) >= 20030101`;

  try {
    await conn.query('DROP VIEW JAVIER.VISTA_DEUDA_BASE');
    console.log('Vista antigua eliminada');
  } catch(e) {}

  try {
    const stmt = await conn.createStatement();
    await stmt.prepare(sql);
    await stmt.execute();
    await stmt.close();
    console.log('VISTA_DEUDA_BASE creada con SUBEMPRESAPEDIDO y CPC');
  } catch(e) {
    console.log('Error prepare: ' + e.message.substring(0,120));
    try {
      await conn.query(sql);
      console.log('Creada via query()');
    } catch(e2) {
      console.log('Error query: ' + e2.message.substring(0,120));
    }
  }

  try {
    const r = await conn.query("SELECT COUNT(1) AS C FROM JAVIER.VISTA_DEUDA_BASE");
    console.log('Filas: ' + r[0].C);
    const c = await conn.query("SELECT COLUMN_NAME FROM QSYS2.SYSCOLUMNS WHERE TABLE_SCHEMA = 'JAVIER' AND TABLE_NAME = 'VISTA_DEUDA_BASE' AND COLUMN_NAME = 'SUBEMPRESAPEDIDO'");
    console.log(c.length > 0 ? 'SUBEMPRESAPEDIDO presente OK' : 'SUBEMPRESAPEDIDO NO encontrado');
  } catch(e) {
    console.log('Verify error: ' + e.message.substring(0,100));
    console.log('Probablemente la vista necesita la tabla CPC con datos');
  }

  await conn.close();
  await pool.close();
})().catch(e => console.log('FATAL: ' + e.message));
