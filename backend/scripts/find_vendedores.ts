import odbc from 'odbc';

async function main() {
  const conn = await odbc.connect('DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;');
  
  // Ver todos los vendedores con sus PINs
  console.log('=== VENDEDORES CON PINs ===');
  const vendedores = await conn.query(`
    SELECT 
      VDD.CODIGOVENDEDOR,
      TRIM(VDD.NOMBREVENDEDOR) as NOMBRE,
      VDP.CODIGOPIN as PIN,
      TRIM(VDD.NIF) as NIF
    FROM DSEDAC.VDD VDD
    LEFT JOIN DSEDAC.VDP VDP ON VDD.CODIGOVENDEDOR = VDP.CODIGOVENDEDOR
    ORDER BY VDD.CODIGOVENDEDOR
    FETCH FIRST 50 ROWS ONLY
  `);
  
  console.log('\nCódigo | Nombre                              | PIN  | NIF');
  console.log('-------|-------------------------------------|------|------------');
  for (const v of vendedores as any[]) {
    const codigo = v.CODIGOVENDEDOR.padEnd(6);
    const nombre = (v.NOMBRE || '').substring(0, 35).padEnd(35);
    const pin = (v.PIN || 'N/A').padEnd(4);
    const nif = v.NIF || '';
    console.log(`${codigo} | ${nombre} | ${pin} | ${nif}`);
  }

  // Buscar específicamente BARTOLO
  console.log('\n\n=== BARTOLO ===');
  const bartolo = await conn.query(`
    SELECT 
      VDD.CODIGOVENDEDOR,
      TRIM(VDD.NOMBREVENDEDOR) as NOMBRE,
      VDP.CODIGOPIN as PIN,
      TRIM(VDD.NIF) as NIF,
      TRIM(VDD.TELEFONO1) as TELEFONO
    FROM DSEDAC.VDD VDD
    LEFT JOIN DSEDAC.VDP VDP ON VDD.CODIGOVENDEDOR = VDP.CODIGOVENDEDOR
    WHERE UPPER(VDD.NOMBREVENDEDOR) LIKE '%BARTOLO%'
  `);
  console.log(JSON.stringify(bartolo, null, 2));

  await conn.close();
}

main().catch(console.error);
