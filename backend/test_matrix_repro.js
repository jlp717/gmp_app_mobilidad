
const odbc = require('odbc');

// Using the exact DSN string from server.js
const CONNECTION_STRING = "DSN=GMP;UID=JAVIER;PWD=JAVIER;NAM=1;";

async function runTest() {
    let connection;
    try {
        console.log("Connecting...");
        connection = await odbc.connect(CONNECTION_STRING);
        console.log("Connected.");

        // Test parameters
        const clientCode = '000015';
        const yearsFilter = '2023,2024';
        const monthStart = 1;
        const monthEnd = 12;

        const querySql = `
      SELECT 
        L.CODIGOARTICULO as PRODUCT_CODE,
        COALESCE(NULLIF(TRIM(A.DESCRIPCIONARTICULO), ''), TRIM(L.DESCRIPCION)) as PRODUCT_NAME,
        COALESCE(A.CODIGOFAMILIA, 'SIN_FAM') as FAMILY_CODE,
        COALESCE(A.CODIGOSUBFAMILIA, 'SIN_SUBFAM') as SUBFAMILY_CODE,
        L.ANODOCUMENTO as YEAR,
        L.MESDOCUMENTO as MONTH,
        SUM(L.IMPORTEVENTA) as SALES,
        SUM(L.IMPORTECOSTO) as COST,
        SUM(L.CANTIDADUNIDADES) as UNITS
      FROM DSEDAC.LAC L
      LEFT JOIN DSEDAC.ART A ON L.CODIGOARTICULO = A.CODIGOARTICULO
      WHERE L.CODIGOCLIENTEALBARAN = '${clientCode}'
        AND L.ANODOCUMENTO IN(${yearsFilter})
        AND L.MESDOCUMENTO BETWEEN ${monthStart} AND ${monthEnd}
      GROUP BY L.CODIGOARTICULO, A.DESCRIPCIONARTICULO, L.DESCRIPCION, A.CODIGOFAMILIA, A.CODIGOSUBFAMILIA, L.ANODOCUMENTO, L.MESDOCUMENTO
      ORDER BY SALES DESC
      FETCH FIRST 10 ROWS ONLY
    `;

        console.log("Executing query...");
        const result = await connection.query(querySql);
        console.log("Query success!");
        console.log("First row:", result[0]);

    } catch (error) {
        console.error("Query Failed!");
        // Simplified error logging to match server log output style + details
        console.error(error.message);
        if (error.odbcErrors) {
            console.error("ODBC Errors:", error.odbcErrors);
        }
    } finally {
        if (connection) {
            await connection.close();
            console.log("Connection closed.");
        }
    }
}

runTest();
