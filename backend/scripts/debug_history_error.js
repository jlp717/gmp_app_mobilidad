require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');

async function debugHistory() {
    try {
        const year = 2024;
        const clientCode = '4300039514'; // From user log

        console.log(`Testing history query for client ${clientCode}...`);

        const sql = `
            SELECT 
                CPC.SUBEMPRESAALBARAN, CPC.EJERCICIOALBARAN, CPC.SERIEALBARAN, CPC.NUMEROALBARAN,
                CPC.NUMEROFACTURA, CPC.FECHAFACTURA,
                CPC.ANODOCUMENTO as ANO, CPC.MESDOCUMENTO as MES, CPC.DIADOCUMENTO as DIA,
                CPC.CODIGOCLIENTEALBARAN, CPC.CODIGOCLIENTEFACTURA,
                CPC.IMPORTETOTAL, CPC.IMPORTEPENDIENTE as IMPORTE_PENDIENTE,
                CPC.CONFORMADOSN,
                CPC.SITUACIONALBARAN,
                CPC.HORALLEGADA,
                CPC.HORACREACION,
                DS.STATUS as DELIVERY_STATUS,
                DS.UPDATED_AT as DELIVERY_UPDATED_AT,
                DS.FIRMA_PATH,
                DS.INCIDENCE_TYPE,
                DS.OBSERVATIONS,
                COALESCE(LS.FIRMANOMBRE, '') as LEGACY_FIRMA_NOMBRE,
                LS.DIA as LEGACY_DIA,
                LS.MES as LEGACY_MES,
                LS.ANO as LEGACY_ANO,
                LS.HORA as LEGACY_HORA
            FROM DSEDAC.CPC CPC
            LEFT JOIN JAVIER.DELIVERY_STATUS DS ON 
                DS.ID = TRIM(CAST(CPC.EJERCICIOALBARAN AS VARCHAR(10))) || '-' || TRIM(CPC.SERIEALBARAN) || '-' || TRIM(CAST(CPC.TERMINALALBARAN AS VARCHAR(10))) || '-' || TRIM(CAST(CPC.NUMEROALBARAN AS VARCHAR(10)))
            LEFT JOIN DSEDAC.CACFIRMAS LS ON
                LS.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND
                LS.SERIEALBARAN = CPC.SERIEALBARAN AND
                LS.TERMINALALBARAN = CPC.TERMINALALBARAN AND
                LS.NUMEROALBARAN = CPC.NUMEROALBARAN
            WHERE CPC.EJERCICIOALBARAN = ${year}
              AND CPC.CODIGOCLIENTEALBARAN = '${clientCode}'
            ORDER BY CPC.ANODOCUMENTO DESC, CPC.MESDOCUMENTO DESC, CPC.DIADOCUMENTO DESC
            FETCH FIRST 10 ROWS ONLY
        `;

        const rows = await query(sql, false);
        console.log(`Success! Found ${rows.length} rows.`);
    } catch (e) {
        console.error('SQL Error:', e);
    }
}

debugHistory();
