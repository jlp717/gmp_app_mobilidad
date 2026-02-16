const { query, initDb } = require('../config/db');

async function verifySqlFixes() {
    console.log('🚀 Starting SQL Verification for Rutero Fixes...');

    try {
        await initDb();
        console.log('✅ Database connected.');

        // ===========================================
        // TEST 1: Login Query (Commission Exceptions)
        // ===========================================
        console.log('\n🔍 TEST 1: Verifying Login Query & Commission Exceptions...');
        // Corrected spelling based on DEBUG_LOGIN_ERROR.JS usage or USER statement.
        // The user said JAVIER.COMMISSION_EXCEPTIONS "works".
        // Let's assume the code in auth.js is correct (COMMISSION_EXCEPTIONS).
        const loginSql = `
            SELECT P.CODIGOVENDEDOR, P.CODIGOPIN, 
                   TRIM(D.NOMBREVENDEDOR) as NOMBREVENDEDOR,
                   V.TIPOVENDEDOR, X.JEFEVENTASSN,
                   E.HIDE_COMMISSIONS
            FROM DSEDAC.VDPL1 P
            JOIN DSEDAC.VDD D ON P.CODIGOVENDEDOR = D.CODIGOVENDEDOR
            JOIN DSEDAC.VDC V ON P.CODIGOVENDEDOR = V.CODIGOVENDEDOR AND V.SUBEMPRESA = 'GMP'
            LEFT JOIN DSEDAC.VDDX X ON P.CODIGOVENDEDOR = X.CODIGOVENDEDOR
            LEFT JOIN JAVIER.COMMISSION_EXCEPTIONS E ON P.CODIGOVENDEDOR = E.CODIGOVENDEDOR
            FETCH FIRST 1 ROWS ONLY
        `;
        try {
            const loginResult = await query(loginSql);
            console.log(`   ✅ Login Query Successful. Row count: ${loginResult.length}`);
            if (loginResult.length > 0) {
                console.log(`   Sample Result: ${JSON.stringify(loginResult[0])}`);
                console.log(`   HIDE_COMMISSIONS value: ${loginResult[0].HIDE_COMMISSIONS}`);
            }
        } catch (e) {
            console.error(`   ❌ Login Query FAILED: ${e.message}`);
        }


        // ===========================================
        // TEST 2: CDVI Cache Load (Ambiguous Cols & ANOBAJA)
        // ===========================================
        console.log('\n🔍 TEST 2: Verifying CDVI Cache Query (Ambiguous Columns & ANOBAJA)...');
        const cdviSql = `
            SELECT 
                TRIM(C.CODIGOVENDEDOR) as VENDEDOR,
                TRIM(C.CODIGOCLIENTE) as CLIENTE,
                C.DIAVISITALUNESSN as VIS_L, 
                C.DIAVISITAMARTESSN as VIS_M, 
                C.DIAVISITAMIERCOLESSN as VIS_X,
                C.DIAVISITAJUEVESSN as VIS_J, 
                C.DIAVISITAVIERNESSN as VIS_V, 
                C.DIAVISITASABADOSN as VIS_S, 
                C.DIAVISITADOMINGOSN as VIS_D,
                C.ORDENVISITALUNES as OR_L,
                C.ORDENVISITAMARTES as OR_M,
                C.ORDENVISITAMIERCOLES as OR_X,
                C.ORDENVISITAJUEVES as OR_J,
                C.ORDENVISITAVIERNES as OR_V,
                C.ORDENVISITASABADO as OR_S,
                C.ORDENVISITADOMINGO as OR_D
            FROM DSEDAC.CDVI C
            JOIN DSEDAC.CLI K ON C.CODIGOCLIENTE = K.CODIGOCLIENTE
            WHERE (C.MARCAACTUALIZACION <> 'B' OR C.MARCAACTUALIZACION IS NULL OR TRIM(C.MARCAACTUALIZACION) = '')
              AND (K.ANOBAJA = 0 OR K.ANOBAJA IS NULL)
            FETCH FIRST 5 ROWS ONLY
        `;
        try {
            const cdviResult = await query(cdviSql);
            console.log(`   ✅ CDVI Query Successful. Row count: ${cdviResult.length}`);
            if (cdviResult.length > 0) {
                console.log(`   Sample Result: ${JSON.stringify(cdviResult[0])}`);
            }
        } catch (e) {
            console.error(`   ❌ CDVI Query FAILED: ${e.message}`);
        }


        // ===========================================
        // TEST 3: LACLAE Cache Load (Sales History & ANOBAJA)
        // ===========================================
        console.log('\n🔍 TEST 3: Verifying LACLAE Cache Query (Sales History & ANOBAJA)...');
        const currentYear = new Date().getFullYear();
        const startYear = currentYear - 1;

        const laclaeSql = `
            SELECT DISTINCT
              L.R1_T8CDVD as VENDEDOR,
              L.LCCDCL as CLIENTE,
              L.R1_T8DIVL as VIS_L, L.R1_T8DIVM as VIS_M, L.R1_T8DIVX as VIS_X,
              L.R1_T8DIVJ as VIS_J, L.R1_T8DIVV as VIS_V, L.R1_T8DIVS as VIS_S, L.R1_T8DIVD as VIS_D,
              L.R1_T8DIRL as DEL_L, L.R1_T8DIRM as DEL_M, L.R1_T8DIRX as DEL_X,
              L.R1_T8DIRJ as DEL_J, L.R1_T8DIRV as DEL_V, L.R1_T8DIRS as DEL_S, L.R1_T8DIRD as DEL_D
            FROM DSED.LACLAE L
            JOIN DSEDAC.CLI C ON L.LCCDCL = C.CODIGOCLIENTE
            WHERE L.R1_T8CDVD IS NOT NULL 
              AND L.LCCDCL IS NOT NULL
              AND L.LCAADC >= ${startYear}
              AND (C.ANOBAJA = 0 OR C.ANOBAJA IS NULL)
            FETCH FIRST 5 ROWS ONLY
        `;
        try {
            const laclaeResult = await query(laclaeSql);
            console.log(`   ✅ LACLAE Query Successful. Row count: ${laclaeResult.length}`);
            if (laclaeResult.length > 0) {
                console.log(`   Sample Result: ${JSON.stringify(laclaeResult[0])}`);
            }
        } catch (e) {
            console.error(`   ❌ LACLAE Query FAILED: ${e.message}`);
        }

    } catch (e) {
        console.error('🔥 Fatal script error:', e);
    }

    console.log('\n🏁 Verification Complete.');
    process.exit(0);
}

verifySqlFixes();
