/**
 * Verify OPP -> CPC -> CPL join
 */
const { query } = require('../config/db');

async function main() {
  console.log('Testing OPP -> CPC -> CPL join...');

  // Get an unrelated OPP first
  const opps = await query(`SELECT * FROM DSEDAC.OPP FETCH FIRST 1 ROWS ONLY`);
  if (opps.length === 0) {
    console.log('No OPPs found');
    process.exit(0);
  }
  const opp = opps[0];
  console.log('OPP:', opp.NUMEROORDENPREPARACION, opp.EJERCICIOORDENPREPARACION);

  // Try to find CPCs for this OPP
  const cpcs = await query(`
    SELECT * 
    FROM DSEDAC.CPC 
    WHERE NUMEROORDENPREPARACION = ${opp.NUMEROORDENPREPARACION}
      AND EJERCICIOORDENPREPARACION = ${opp.EJERCICIOORDENPREPARACION}
  `);
  console.log(`Found ${cpcs.length} CPCs for this OPP`);

  if (cpcs.length > 0) {
    const cpc = cpcs[0];
    console.log('CPC:', cpc.NUMEROPEDIDO, cpc.SERIEPEDIDO, cpc.EJERCICIOPEDIDO);

    // Try to find CPLs for this CPC
    // Join usually by EMPRESA, SUBEMPRESA..., EJERCICIO, SERIE, NUMERO?
    // Let's guess the keys based on column names
    const cpls = await query(`
      SELECT * 
      FROM DSEDAC.CPL 
      WHERE NUMEROPEDIDO = ${cpc.NUMEROPEDIDO}
        AND SERIEPEDIDO = '${cpc.SERIEPEDIDO}'
        AND EJERCICIOPEDIDO = ${cpc.EJERCICIOPEDIDO}
      FETCH FIRST 5 ROWS ONLY
    `);
    console.log(`Found ${cpls.length} CPLs for this CPC`);
    if (cpls.length > 0) {
      console.log('CPL Sample:', cpls[0].CODIGOARTICULO, cpls[0].DESCRIPCIONARTICULO, cpls[0].UNIDADES);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
