// explore_discounts_v2.js - Deep dive into LAC discount columns and PRE tables
const odbc = require('odbc');

const CONNECTION_STRING = 'DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;';

async function main() {
    console.log('Connecting to database...');
    const conn = await odbc.connect(CONNECTION_STRING);

    try {
        // ============================================
        // 1. LAC sample with all discount columns
        // ============================================
        console.log('\n=== LAC DISCOUNT COLUMNS SAMPLE ===');
        const lacSample = await conn.query(`
      SELECT 
        CODIGOCLIENTEALBARAN as CLI,
        CODIGOARTICULO as ART,
        CODIGOTARIFA as TARIFA,
        PRECIOVENTA,
        PRECIOTARIFA01,
        PRECIOTARIFACLIENTE,
        PORCENTAJEDESCUENTO,
        PORCENTAJEDESCUENTO02,
        IMPORTEDESCUENTOUNIDAD,
        IMPORTEVENTA,
        CANTIDADUNIDADES
      FROM DSEDAC.LAC 
      WHERE ANODOCUMENTO = 2025 
        AND (PORCENTAJEDESCUENTO <> 0 OR PRECIOTARIFACLIENTE <> 0 OR IMPORTEDESCUENTOUNIDAD <> 0)
      FETCH FIRST 10 ROWS ONLY
    `);
        console.log(`Rows with discounts (${lacSample.length}):`);
        lacSample.forEach((r, i) => {
            console.log(`${i + 1}. CLI:${r.CLI?.trim()} ART:${r.ART?.trim()}`);
            console.log(`   Tarifa: ${r.TARIFA}, PrecioVenta: ${r.PRECIOVENTA}, TarifaCli: ${r.PRECIOTARIFACLIENTE}`);
            console.log(`   %Desc: ${r.PORCENTAJEDESCUENTO}, %Desc2: ${r.PORCENTAJEDESCUENTO02}, DescUnit: ${r.IMPORTEDESCUENTOUNIDAD}`);
            console.log(`   ImporteVenta: ${r.IMPORTEVENTA}, Uds: ${r.CANTIDADUNIDADES}`);
        });

        // ============================================
        // 2. Check PRE table structure
        // ============================================
        console.log('\n=== PRE TABLE STRUCTURE ===');
        const preCols = await conn.query(`
      SELECT COLUMN_NAME 
      FROM SYSIBM.COLUMNS 
      WHERE TABLE_NAME = 'PRE' AND TABLE_SCHEMA = 'DSEDAC'
      ORDER BY ORDINAL_POSITION
    `);
        console.log('PRE columns:', preCols.map(c => c.COLUMN_NAME).join(', '));

        console.log('\n=== PRE TABLE SAMPLE ===');
        const preSample = await conn.query(`SELECT * FROM DSEDAC.PRE FETCH FIRST 5 ROWS ONLY`);
        if (preSample.length > 0) {
            console.log('Sample rows:');
            preSample.forEach((r, i) => console.log(`${i + 1}.`, JSON.stringify(r)));
        }

        // ============================================
        // 3. Check LPRE table (lineas de precios?)
        // ============================================
        console.log('\n=== LPRE TABLE STRUCTURE ===');
        const lpreCols = await conn.query(`
      SELECT COLUMN_NAME 
      FROM SYSIBM.COLUMNS 
      WHERE TABLE_NAME = 'LPRE' AND TABLE_SCHEMA = 'DSEDAC'
      ORDER BY ORDINAL_POSITION
    `);
        console.log('LPRE columns:', lpreCols.map(c => c.COLUMN_NAME).join(', '));

        if (lpreCols.length > 0) {
            console.log('\n=== LPRE TABLE SAMPLE ===');
            const lpreSample = await conn.query(`SELECT * FROM DSEDAC.LPRE FETCH FIRST 5 ROWS ONLY`);
            if (lpreSample.length > 0) {
                lpreSample.forEach((r, i) => console.log(`${i + 1}.`, JSON.stringify(r)));
            }
        }

        // ============================================
        // 4. Check CLI table for TARIFA column
        // ============================================
        console.log('\n=== CLI TARIFF COLUMNS ===');
        const cliTarifCols = await conn.query(`
      SELECT COLUMN_NAME 
      FROM SYSIBM.COLUMNS 
      WHERE TABLE_NAME = 'CLI' AND TABLE_SCHEMA = 'DSEDAC'
        AND UPPER(COLUMN_NAME) LIKE '%TARIF%'
    `);
        console.log('CLI tariff columns:', cliTarifCols.map(c => c.COLUMN_NAME).join(', '));

        // Sample clients with tariff
        console.log('\n=== CLI SAMPLE WITH TARIFF ===');
        const cliSample = await conn.query(`
      SELECT CODIGOCLIENTE, NOMBRECLIENTE, CODIGOTARIFADEFECTO
      FROM DSEDAC.CLI
      WHERE CODIGOTARIFADEFECTO IS NOT NULL AND CODIGOTARIFADEFECTO <> ''
      FETCH FIRST 5 ROWS ONLY
    `);
        cliSample.forEach((r, i) => {
            console.log(`${i + 1}. ${r.CODIGOCLIENTE?.trim()}: ${r.NOMBRECLIENTE?.trim()} → Tarifa: ${r.CODIGOTARIFADEFECTO}`);
        });

        // ============================================
        // 5. Check TAR table (tarifas maestro)
        // ============================================
        console.log('\n=== TAR TABLE (Tarifas Maestro) ===');
        const tarCols = await conn.query(`
      SELECT COLUMN_NAME 
      FROM SYSIBM.COLUMNS 
      WHERE TABLE_NAME = 'TAR' AND TABLE_SCHEMA = 'DSEDAC'
      ORDER BY ORDINAL_POSITION
    `);
        console.log('TAR columns:', tarCols.map(c => c.COLUMN_NAME).join(', ') || 'Table not found');

        // ============================================
        // 6. Check TPA table (Tarifas Precios Articulos?)
        // ============================================
        console.log('\n=== TPA TABLE ===');
        const tpaCols = await conn.query(`
      SELECT COLUMN_NAME 
      FROM SYSIBM.COLUMNS 
      WHERE TABLE_NAME = 'TPA' AND TABLE_SCHEMA = 'DSEDAC'
      ORDER BY ORDINAL_POSITION
    `);
        console.log('TPA columns:', tpaCols.map(c => c.COLUMN_NAME).join(', '));

        if (tpaCols.length > 0) {
            const tpaSample = await conn.query(`SELECT * FROM DSEDAC.TPA FETCH FIRST 3 ROWS ONLY`);
            console.log('TPA sample:');
            tpaSample.forEach((r, i) => console.log(`${i + 1}.`, JSON.stringify(r)));
        }

        // ============================================
        // 7. Check LPC table (Lineas Precios Cliente?)
        // ============================================
        console.log('\n=== LPC TABLE (Client Pricing Lines?) ===');
        const lpcCols = await conn.query(`
      SELECT COLUMN_NAME 
      FROM SYSIBM.COLUMNS 
      WHERE TABLE_NAME = 'LPC' AND TABLE_SCHEMA = 'DSEDAC'
      ORDER BY ORDINAL_POSITION
    `);
        console.log('LPC columns:', lpcCols.map(c => c.COLUMN_NAME).join(', '));

        if (lpcCols.length > 0) {
            console.log('\n=== LPC TABLE SAMPLE ===');
            const lpcSample = await conn.query(`SELECT * FROM DSEDAC.LPC FETCH FIRST 5 ROWS ONLY`);
            if (lpcSample.length > 0) {
                lpcSample.forEach((r, i) => console.log(`${i + 1}.`, JSON.stringify(r)));
            }
        }

        // ============================================
        // 8. Summary: For a specific client + product combo
        // ============================================
        console.log('\n=== CHECK SPECIFIC CLIENT+PRODUCT PRICING ===');
        // Get a client that has LAC entries
        const testClient = await conn.query(`
      SELECT DISTINCT CODIGOCLIENTEALBARAN 
      FROM DSEDAC.LAC 
      WHERE ANODOCUMENTO = 2025 AND PORCENTAJEDESCUENTO <> 0
      FETCH FIRST 1 ROWS ONLY
    `);
        if (testClient.length > 0) {
            const clientCode = testClient[0].CODIGOCLIENTEALBARAN.trim();
            console.log(`\nChecking client: ${clientCode}`);

            // Get their LAC entries with discount info
            const clientLac = await conn.query(`
        SELECT 
          CODIGOARTICULO,
          CODIGOTARIFA,
          PRECIOTARIFA01,
          PRECIOTARIFACLIENTE,
          PRECIOVENTA,
          PORCENTAJEDESCUENTO,
          IMPORTEDESCUENTOUNIDAD
        FROM DSEDAC.LAC 
        WHERE CODIGOCLIENTEALBARAN = '${clientCode}' AND ANODOCUMENTO = 2025
        FETCH FIRST 10 ROWS ONLY
      `);
            console.log(`Client ${clientCode} LAC entries:`);
            clientLac.forEach((r, i) => {
                const hasDiscount = r.PORCENTAJEDESCUENTO !== 0 || r.PRECIOTARIFACLIENTE !== r.PRECIOTARIFA01 || r.IMPORTEDESCUENTOUNIDAD !== 0;
                console.log(`${i + 1}. Art:${r.CODIGOARTICULO?.trim()} Tarifa:${r.CODIGOTARIFA} PVP:${r.PRECIOVENTA} TarCli:${r.PRECIOTARIFACLIENTE} Tar01:${r.PRECIOTARIFA01} %Desc:${r.PORCENTAJEDESCUENTO} → DISCOUNT: ${hasDiscount ? 'YES' : 'NO'}`);
            });
        }

    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await conn.close();
        console.log('\nDone.');
    }
}

main();
