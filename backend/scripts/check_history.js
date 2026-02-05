require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { query } = require('../config/db');
const moment = require('moment');

async function main() {
    console.log(`\n⏳ VERIFICACIÓN HISTÓRICO\n`);

    // 1. Get an active Repartidor ID (Last 30 days)
    const sqlRep = `
        SELECT TRIM(CODIGOREPARTIDOR) as ID, COUNT(*) as CNT
        FROM DSEDAC.OPP
        WHERE ANOREPARTO = ${new Date().getFullYear()}
        GROUP BY TRIM(CODIGOREPARTIDOR)
        ORDER BY CNT DESC
        FETCH FIRST 1 ROW ONLY
    `;
    const reps = await query(sqlRep, false);
    if (!reps || reps.length === 0) {
        console.error('No found active repartidor');
        process.exit(1);
    }
    const repartidorId = reps[0].ID;
    console.log(`👤 Repartidor seleccionado: ${repartidorId} (${reps[0].CNT} entregas)`);

    // 2. Check Clients endpoint logic
    console.log(`\n1️⃣ Testing /history/clients/${repartidorId}...`);
    const dateLimit = moment().subtract(6, 'months').format('YYYYMMDD');
    const sqlClients = `
        SELECT DISTINCT
            TRIM(CPC.CODIGOCLIENTEALBARAN) as ID,
            TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, '')) as NAME,
            COUNT(CPC.NUMEROALBARAN) as TOTAL_DOCS
        FROM DSEDAC.OPP OPP
        INNER JOIN DSEDAC.CPC CPC 
            ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
        LEFT JOIN DSEDAC.CLI CLI 
            ON TRIM(CLI.CODIGOCLIENTE) = TRIM(CPC.CODIGOCLIENTEALBARAN)
        WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) >= ${dateLimit}
          AND TRIM(OPP.CODIGOREPARTIDOR) = '${repartidorId}'
        GROUP BY TRIM(CPC.CODIGOCLIENTEALBARAN), TRIM(COALESCE(CLI.NOMBREALTERNATIVO, CLI.NOMBRECLIENTE, ''))
        ORDER BY NAME FETCH FIRST 5 ROWS ONLY
    `;
    const clients = await query(sqlClients, false);
    console.log(`   Found ${clients.length} clients.`);
    if (clients.length > 0) {
        clients.forEach(c => console.log(`   - [${c.ID}] ${c.NAME} (${c.TOTAL_DOCS} docs)`));

        // 3. Test Documents endpoint logic for first client
        const clientId = clients[0].ID;
        console.log(`\n2️⃣ Testing /history/documents/${clientId}...`);
        const sqlDocs = `
            SELECT 
                CPC.ANODOCUMENTO || '-' || RIGHT('0' || CPC.MESDOCUMENTO, 2) || '-' || RIGHT('0' || CPC.DIADOCUMENTO, 2) as FECHA,
                CPC.NUMEROALBARAN,
                CAC.NUMEROFACTURA,
                CPC.IMPORTETOTAL as AMOUNT
            FROM DSEDAC.CPC CPC
            INNER JOIN DSEDAC.OPP OPP ON OPP.NUMEROORDENPREPARACION = CPC.NUMEROORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN AND CAC.SERIEALBARAN = CPC.SERIEALBARAN AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
            WHERE TRIM(CPC.CODIGOCLIENTEALBARAN) = '${clientId}'
              AND TRIM(OPP.CODIGOREPARTIDOR) = '${repartidorId}'
            ORDER BY FECHA DESC FETCH FIRST 5 ROWS ONLY
        `;
        const docs = await query(sqlDocs, false);
        console.log(`   Found ${docs.length} docs.`);
        docs.forEach(d => console.log(`   - ${d.FECHA} Alb:${d.NUMEROALBARAN} Fac:${d.NUMEROFACTURA} (${d.AMOUNT}€)`));
    }

    // 4. Test Objectives logic
    console.log(`\n3️⃣ Testing /history/objectives/${repartidorId}...`);
    const currentYear = new Date().getFullYear();
    const sqlObj = `
        SELECT 
            OPP.MESREPARTO as MONTH,
            SUM(CPC.IMPORTETOTAL) as TOTAL_COBRABLE
        FROM DSEDAC.OPP OPP
        INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
        WHERE OPP.ANOREPARTO = ${currentYear}
          AND TRIM(OPP.CODIGOREPARTIDOR) = '${repartidorId}'
        GROUP BY OPP.MESREPARTO
        ORDER BY MONTH DESC
    `;
    const objs = await query(sqlObj, false);
    objs.forEach(o => console.log(`   Month ${o.MONTH}: ${o.TOTAL_COBRABLE}€`));

    console.log('\n✅ Verification Done');
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
