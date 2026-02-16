const { query } = require('../config/db');
const logger = require('../middleware/logger');

async function debugTotals() {
    try {
        console.log('--- DEBUG RUTERO TOTALS START ---');

        // 1. Get deliveries for today (or a specific date if provided arg)
        const dateArg = process.argv[2];
        const targetDate = dateArg ? new Date(dateArg) : new Date();
        const dia = targetDate.getDate();
        const mes = targetDate.getMonth() + 1;
        const ano = targetDate.getFullYear();

        console.log(`Checking for date: ${dia}/${mes}/${ano}`);

        // 2. Load Payment Conditions
        let paymentConditions = {};
        const pcRows = await query(`
            SELECT CODIGO, DESCRIPCION, TIPO, DIAS_PAGO, DEBE_COBRAR, PUEDE_COBRAR, COLOR
            FROM JAVIER.PAYMENT_CONDITIONS
            WHERE ACTIVO = 'S'
        `, false);

        pcRows.forEach(pc => {
            const code = (pc.CODIGO || '').trim();
            paymentConditions[code] = {
                desc: (pc.DESCRIPCION || '').trim(),
                mustCollect: pc.DEBE_COBRAR === 'S',
                canCollect: pc.PUEDE_COBRAR === 'S'
            };
        });
        console.log(`Loaded ${Object.keys(paymentConditions).length} payment conditions.`);

        // 3. Query Deliveries (Mocking the query in routes/entregas.js)
        const sql = `
            SELECT 
              CPC.NUMEROALBARAN,
              CPC.IMPORTEBRUTO,
              TRIM(CPC.CODIGOFORMAPAGO) as FORMA_PAGO,
              TRIM(OPP.CODIGOREPARTIDOR) as REPARTIDOR
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC 
              ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            WHERE OPP.DIAREPARTO = ${dia}
              AND OPP.MESREPARTO = ${mes}
              AND OPP.ANOREPARTO = ${ano}
        `;

        const rows = await query(sql, false);
        console.log(`Found ${rows.length} deliveries.`);

        if (rows.length === 0) {
            console.log('No deliveries found for today. Totals will be 0.');
            return;
        }

        let totalBruto = 0;
        let totalACobrar = 0;
        let totalOpcional = 0;

        rows.forEach(row => {
            const fp = (row.FORMA_PAGO || '').toUpperCase().trim();
            let info = paymentConditions[fp] || paymentConditions[parseInt(fp).toString()];

            // Manual fallback logic from route
            let esCTR = info?.mustCollect || false;
            let puedeCobrarse = info?.canCollect || false;

            if (!info) {
                if (fp === 'CTR' || fp.includes('CONTADO') || fp.includes('METALICO')) {
                    esCTR = true;
                    puedeCobrarse = true;
                }
            }

            const importe = parseFloat(row.IMPORTEBRUTO) || 0;
            totalBruto += importe;

            if (esCTR) {
                totalACobrar += importe;
            }
            if (puedeCobrarse && !esCTR) {
                totalOpcional += importe;
            }

            console.log(`Alb ${row.NUMEROALBARAN}: FP='${fp}', Importe=${importe}, esCTR=${esCTR}, Puede=${puedeCobrarse}`);
        });

        console.log('--- SUMMARY ---');
        console.log(`Total Bruto: ${totalBruto.toFixed(2)}`);
        console.log(`Total A Cobrar: ${totalACobrar.toFixed(2)}`);
        console.log(`Total Opcional: ${totalOpcional.toFixed(2)}`);

    } catch (e) {
        console.error('Error:', e);
    }
}

debugTotals();
