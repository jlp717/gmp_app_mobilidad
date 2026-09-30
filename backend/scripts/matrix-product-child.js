'use strict';

// Proceso aparte: el pool del API devuelve SQLSTATE 22003 en la evolución
// del cliente y este mismo SQL responde en un node nuevo.
const { queryWithParams } = require('../middleware/db-timing');

function readStdin() {
    return new Promise((resolve, reject) => {
        const chunks = [];
        process.stdin.on('data', (chunk) => chunks.push(chunk));
        process.stdin.on('error', reject);
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

readStdin()
    .then(async (raw) => {
        const { sql, params } = JSON.parse(raw);
        let rows;
        try {
            rows = await queryWithParams(sql, params, false, false);
        } catch (error) {
            const state = (error?.odbcErrors || []).map((entry) => entry.state).find(Boolean) || '';
            const years = params.slice(1, -2);
            const marks = years.map(() => '?').join(',');
            const minimal = `
                SELECT TRIM(S.LCCDRF) AS PRODUCT_CODE,
                       COALESCE(MAX(TRIM(S.LCDESC)), '') AS PRODUCT_NAME,
                       CAST('SIN_FAM' AS VARCHAR(20)) AS FAMILY_CODE,
                       CAST('General' AS VARCHAR(20)) AS SUBFAMILY_CODE,
                       CAST('UDS' AS VARCHAR(5)) AS UNIT_TYPE,
                       S.LCAADC AS YEAR, S.LCMMDC AS MONTH,
                       SUM(S.LCIMVT) AS SALES, SUM(S.LCIMCT) AS COST, SUM(S.LCCTUD) AS UNITS,
                       CAST(0 AS INTEGER) AS HAS_SPECIAL_PRICE,
                       CAST(0 AS INTEGER) AS HAS_DISCOUNT,
                       CAST(NULL AS DECIMAL(15,2)) AS AVG_DISCOUNT_PCT,
                       CAST(NULL AS DECIMAL(15,2)) AS AVG_DISCOUNT_EUR,
                       CAST(NULL AS DECIMAL(15,2)) AS AVG_CLIENT_TARIFF,
                       CAST(NULL AS DECIMAL(15,2)) AS AVG_BASE_TARIFF,
                       CAST('' AS VARCHAR(12)) AS FI1_CODE,
                       CAST('' AS VARCHAR(12)) AS FI2_CODE,
                       CAST('' AS VARCHAR(12)) AS FI3_CODE,
                       CAST('' AS VARCHAR(12)) AS FI4_CODE,
                       CAST('' AS VARCHAR(20)) AS FI5_CODE
                  FROM DSED.LACLAE S
                 WHERE S.LCCDCL = CAST(? AS CHAR(10))
                   AND S.LCAADC IN (${marks})
                   AND S.LCMMDC BETWEEN ? AND ?
                   AND S.TPDC = 'LAC' AND S.LCTPVT IN ('CC', 'VC')
                   AND S.LCCLLN IN ('AB', 'VT') AND S.LCSRAB NOT IN ('N', 'Z', 'G', 'D')
                 GROUP BY S.LCCDRF, S.LCAADC, S.LCMMDC
                 ORDER BY SALES DESC
                 FETCH FIRST 1000 ROWS ONLY`;
            try {
                rows = await queryWithParams(minimal, params, false, false);
            } catch (retryError) {
                const retryState = (retryError?.odbcErrors || []).map((entry) => entry.state).find(Boolean) || '';
                process.stderr.write(`${state}/${retryState} ${retryError.message || error.message}`);
                process.exit(1);
            }
        }
        process.stdout.write(JSON.stringify(rows || []), () => process.exit(0));
    })
    .catch((error) => {
        process.stderr.write(String(error.message || error).slice(0, 200));
        process.exit(1);
    });
