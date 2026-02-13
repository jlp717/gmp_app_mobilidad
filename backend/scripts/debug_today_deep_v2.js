require('dotenv').config({ path: '../.env' });
const { query } = require('../config/db');

async function checkTodayDeep() {
    try {
        const y = 2026;
        const m = 2;
        const d = 13;

        console.log(`ANALISIS: ${y}-${m}-${d}`);

        const sql = `
            SELECT 
                count(*) as TOTAL,
                sum(case when CONFORMADOSN = 'S' then 1 else 0 end) as SI_CONFIRMADOS,
                sum(case when CONFORMADOSN = 'N' OR CONFORMADOSN IS NULL then 1 else 0 end) as NO_CONFIRMADOS,
                min(HORALLEGADA) as HORA_MIN,
                max(HORALLEGADA) as HORA_MAX
            FROM DSEDAC.CPC
            WHERE ANODOCUMENTO = ${y} AND MESDOCUMENTO = ${m} AND DIADOCUMENTO = ${d}
        `;

        const rows = await query(sql);
        console.log('RESUMEN:', rows);

        const listSql = `
            SELECT NUMEROALBARAN, HORALLEGADA, CONFORMADOSN
            FROM DSEDAC.CPC
            WHERE ANODOCUMENTO = ${y} AND MESDOCUMENTO = ${m} AND DIADOCUMENTO = ${d}
            AND HORALLEGADA > 0
            ORDER BY HORALLEGADA ASC
            FETCH FIRST 10 ROWS ONLY
        `;

        const list = await query(listSql);
        console.log('EJEMPLOS (HORALLEGADA HHMMSS):');
        list.forEach(r => {
            console.log(`Alb: ${r.NUMEROALBARAN} | Hora: ${r.HORALLEGADA} | Conf: ${r.CONFORMADOSN}`);
        });

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkTodayDeep();
