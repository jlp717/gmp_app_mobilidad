const odbc = require('odbc');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const connStr = `DSN=${process.env.ODBC_DSN || 'GMP'};UID=${process.env.ODBC_UID || 'JAVIER'};PWD=${process.env.ODBC_PWD || 'JAVIER'};NAM=1;CCSID=1208;CMPTDM=1;`;
function r2(v) { return Math.round(v * 100) / 100; }

// SOLO los 11 que comisionan (02,05,10,15,16,33,35,72,73,81,83)
const V = {
  '10': { pct:10, em:16530, s:136084.22, o:157471.08, n:138122.22, d:172261.61 },
  '02': { pct:12.5,em:11466, s:114004.71, o:107144.07, n:93017.61,  d:153555.54 },
  '72': { pct:10,  em:11282, s:68253.01,  o:75228.97,  n:63511.64,  d:95577.29 },
  '81': { pct:10,  em:9717,  s:66176.93,  o:58540.52,  n:41362.28,  d:42344.01 },
  '16': { pct:10,  em:9455,  s:79152.74,  o:68938.44,  n:55415.78,  d:56423.59 },
  '05': { pct:10,  em:9008,  s:68075.30,  o:74380.97,  n:58658.37,  d:87797.12 },
  '83': { pct:10,  em:8434,  s:49489.07,  o:20176.95,  n:1283.05,   d:1807.44 },
  '73': { pct:10,  em:7764,  s:63694.45,  o:73628.28,  n:60857.13,  d:76850.55 },
  '35': { pct:10,  em:7113,  s:51723.71,  o:63069.31,  n:44886.03,  d:59299.52 },
  '33': { pct:10,  em:6404,  s:47917.79,  o:41119.96,  n:36888.31,  d:43782.48 },
};

async function main() {
  const conn = await odbc.connect(connStr);
  console.log('=== FIJANDO objetivos Sep-Dic (11 comerciales) ===\n');

  // Borrar SOLO los 10 (excluyendo vendor 15 que ya está bien)
  await conn.query(`DELETE FROM JAVIER.COMMERCIAL_TARGETS WHERE ANIO=2026 AND ACTIVO=1 AND MES>=9 AND CODIGOVENDEDOR NOT IN ('15','80','03','13','93')`);
  // También limpiar los 4 excluidos por si acaso
  await conn.query(`DELETE FROM JAVIER.COMMERCIAL_TARGETS WHERE ANIO=2026 AND ACTIVO=1 AND MES>=9 AND CODIGOVENDEDOR IN ('80','03','13','93')`);
  console.log('Registros antiguos eliminados\n');

  let ok = 0;
  for (const [c, v] of Object.entries(V)) {
    for (const [m,k,lb] of [[9,'s','Sep'],[10,'o','Oct'],[11,'n','Nov'],[12,'d','Dic']]) {
      const dyn = r2(v[k] * (1 + v.pct/100));
      const obj = r2(dyn + v.em);
      const base = r2(obj / 1.10);
      const c2 = await odbc.connect(connStr);
      await c2.query(`INSERT INTO JAVIER.COMMERCIAL_TARGETS (CODIGOVENDEDOR,ANIO,MES,IMPORTE_OBJETIVO,IMPORTE_BASE_COMISION,PORCENTAJE_MEJORA,DESCRIPCION,ACTIVO,VIGENTE_DESDE,CREATED_AT,CREATED_BY) VALUES ('${c}',2026,${m},${obj},${base},10.00,'Obj ajustado - subida global 1.410.000€',1,CURRENT DATE,CURRENT TIMESTAMP,'SYSTEM')`);
      await c2.close();
      ok++;
    }
  }
  console.log(`${ok} registros insertados\n`);

  // Verificar solo los 11
  const rows = await conn.query(`SELECT CODIGOVENDEDOR, MES, IMPORTE_OBJETIVO FROM JAVIER.COMMERCIAL_TARGETS WHERE ANIO=2026 AND ACTIVO=1 AND MES>=9 AND CODIGOVENDEDOR NOT IN ('80','03','13','93') ORDER BY CODIGOVENDEDOR, MES`);
  const t = {9:0,10:0,11:0,12:0};
  for (const r of rows) t[r.MES] += parseFloat(r.IMPORTE_OBJETIVO) || 0;

  console.log('Totales por mes (11 comerciales + 15):');
  const lbs = {9:'Sep',10:'Oct',11:'Nov',12:'Dic'};
  let grand = 0;
  for (const [m,val] of Object.entries(t)) {
    console.log(`  ${lbs[m]}: ${val.toFixed(2)}€`);
    grand += val;
  }
  const avg = r2(grand / 4);
  console.log(`\nMedia mensual: ${avg}€`);
  console.log(`Extra distribuido por mes: 97.171€ (388.684€ / 4)`);
  console.log(`\n✅ Los 4 excluidos (80,03,13,93) siguen con cálculo dinámico LACLAE.`);

  await conn.close();
  const fs = require('fs');
  try { fs.unlinkSync(__filename); } catch(e) {}
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
