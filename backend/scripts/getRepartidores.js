const { query, initDb } = require('../config/db');

async function getRepartidores() {
    try {
        await initDb();
        console.log('🔍 Buscando repartidores (Vendedores con vehículo asignado)...');

        // Query to find vendors who have entries in the VEH table (Vehicles)
        // We join with VDD/VDPL1 to get names
        const sql = `
      SELECT DISTINCT 
        V.CODIGOVENDEDOR, 
        TRIM(D.NOMBREVENDEDOR) as NOMBRE
      FROM DSEDAC.VEH V
      JOIN DSEDAC.VDD D ON V.CODIGOVENDEDOR = D.CODIGOVENDEDOR
      ORDER BY V.CODIGOVENDEDOR
    `;

        const results = await query(sql);

        console.log(`✅ Se encontraron ${results.length} repartidores:`);
        console.table(results);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

getRepartidores();
