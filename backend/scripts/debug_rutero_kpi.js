/**
 * Debug script to validate Rutero KPI calculations
 * Runs against the live database to verify data flow
 */

require('dotenv').config();
const { initDb, query } = require('../config/db');

const TEST_REPARTIDOR_ID = '79';
const TEST_DATE = new Date(); // Today

async function debugRuteroKpi() {
    try {
        await initDb();

        const dia = TEST_DATE.getDate();
        const mes = TEST_DATE.getMonth() + 1;
        const ano = TEST_DATE.getFullYear();

        console.log(`\n${'='.repeat(60)}`);
        console.log(`RUTERO KPI DEBUG - Repartidor ${TEST_REPARTIDOR_ID}`);
        console.log(`Fecha: ${dia}/${mes}/${ano}`);
        console.log(`${'='.repeat(60)}\n`);

        // 1. Check raw OPP records for today
        console.log('1. Registros OPP del día:\n');
        const oppRows = await query(`
            SELECT 
                OPP.NUMEROORDENPREPARACION,
                OPP.DIAREPARTO, OPP.MESREPARTO, OPP.ANOREPARTO,
                TRIM(OPP.CODIGOREPARTIDOR) as REPARTIDOR
            FROM DSEDAC.OPP OPP
            WHERE TRIM(OPP.CODIGOREPARTIDOR) = '${TEST_REPARTIDOR_ID}'
              AND OPP.DIAREPARTO = ${dia}
              AND OPP.MESREPARTO = ${mes}
              AND OPP.ANOREPARTO = ${ano}
        `, false);
        console.log(`   Encontrados: ${oppRows.length} registros`);
        if (oppRows.length > 0) {
            oppRows.slice(0, 5).forEach(r => console.log(`   - OPP ${r.NUMEROORDENPREPARACION}`));
            if (oppRows.length > 5) console.log(`   ... y ${oppRows.length - 5} más`);
        }

        // 2. Check CPC linked records
        console.log('\n2. Albaranes vinculados (OPP → CPC → CAC):\n');
        const albaranesRows = await query(`
            SELECT 
                CAC.NUMEROALBARAN,
                CAC.NUMEROFACTURA,
                TRIM(CPC.CODIGOCLIENTEALBARAN) as CLIENTE,
                CPC.IMPORTEBRUTO,
                TRIM(CPC.CODIGOFORMAPAGO) as FORMA_PAGO
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            INNER JOIN DSEDAC.CAC CAC 
                ON CAC.EJERCICIOALBARAN = CPC.EJERCICIOALBARAN
                AND CAC.SERIEALBARAN = CPC.SERIEALBARAN
                AND CAC.TERMINALALBARAN = CPC.TERMINALALBARAN
                AND CAC.NUMEROALBARAN = CPC.NUMEROALBARAN
            WHERE TRIM(OPP.CODIGOREPARTIDOR) = '${TEST_REPARTIDOR_ID}'
              AND OPP.DIAREPARTO = ${dia}
              AND OPP.MESREPARTO = ${mes}
              AND OPP.ANOREPARTO = ${ano}
            ORDER BY CAC.NUMEROALBARAN
        `, false);
        console.log(`   Encontrados: ${albaranesRows.length} albaranes`);

        // 3. Calculate expected totals
        let totalBruto = 0;
        let totalACobrar = 0; // esCTR
        let totalOpcional = 0; // puedeCobrarse && !esCTR

        // Load payment conditions
        let paymentConditions = {};
        try {
            const pcRows = await query(`
                SELECT CODIGO, TIPO, DEBE_COBRAR, PUEDE_COBRAR
                FROM JAVIER.PAYMENT_CONDITIONS WHERE ACTIVO = 'S'
            `, false);
            pcRows.forEach(pc => {
                paymentConditions[(pc.CODIGO || '').trim()] = {
                    mustCollect: pc.DEBE_COBRAR === 'S',
                    canCollect: pc.PUEDE_COBRAR === 'S'
                };
            });
        } catch (e) {
            console.log('   (No se pudieron cargar PAYMENT_CONDITIONS)');
        }

        console.log('\n3. Desglose de albaranes:\n');
        albaranesRows.forEach(row => {
            const fp = (row.FORMA_PAGO || '').toUpperCase().trim();
            const importe = parseFloat(row.IMPORTEBRUTO) || 0;
            const pc = paymentConditions[fp] || { mustCollect: false, canCollect: false };

            totalBruto += importe;
            if (pc.mustCollect) {
                totalACobrar += importe;
            } else if (pc.canCollect) {
                totalOpcional += importe;
            }

            const status = pc.mustCollect ? '🔴 CTR' : (pc.canCollect ? '🟡 OPC' : '🟢 CRE');
            console.log(`   ALB ${row.NUMEROALBARAN} | ${row.CLIENTE} | ${importe.toFixed(2)}€ | ${fp} ${status}`);
        });

        console.log(`\n${'='.repeat(60)}`);
        console.log('RESUMEN ESPERADO:');
        console.log(`${'='.repeat(60)}`);
        console.log(`   Total Albaranes: ${albaranesRows.length}`);
        console.log(`   Total Bruto:     ${totalBruto.toFixed(2)}€`);
        console.log(`   Total A Cobrar:  ${totalACobrar.toFixed(2)}€  (CTR obligatorio)`);
        console.log(`   Total Opcional:  ${totalOpcional.toFixed(2)}€  (puede cobrarse)`);
        console.log(`${'='.repeat(60)}\n`);

        // 4. Test week endpoint calculation
        console.log('4. Verificando cálculo semanal:\n');
        const dayOfWeek = TEST_DATE.getDay() || 7;
        const startOfWeek = new Date(TEST_DATE);
        startOfWeek.setDate(TEST_DATE.getDate() - dayOfWeek + 1);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);

        const startCalc = startOfWeek.getFullYear() * 10000 + (startOfWeek.getMonth() + 1) * 100 + startOfWeek.getDate();
        const endCalc = endOfWeek.getFullYear() * 10000 + (endOfWeek.getMonth() + 1) * 100 + endOfWeek.getDate();

        console.log(`   Semana: ${startOfWeek.toISOString().split('T')[0]} a ${endOfWeek.toISOString().split('T')[0]}`);
        console.log(`   Cálculo: BETWEEN ${startCalc} AND ${endCalc}`);

        const weekRows = await query(`
            SELECT 
                OPP.DIAREPARTO as DIA,
                OPP.MESREPARTO as MES,
                OPP.ANOREPARTO as ANO,
                COUNT(*) as TOTAL_CLIENTES
            FROM DSEDAC.OPP OPP
            INNER JOIN DSEDAC.CPC CPC ON CPC.NUMEROORDENPREPARACION = OPP.NUMEROORDENPREPARACION
            WHERE (OPP.ANOREPARTO * 10000 + OPP.MESREPARTO * 100 + OPP.DIAREPARTO) 
                BETWEEN ${startCalc} AND ${endCalc}
              AND TRIM(OPP.CODIGOREPARTIDOR) = '${TEST_REPARTIDOR_ID}'
            GROUP BY OPP.ANOREPARTO, OPP.MESREPARTO, OPP.DIAREPARTO
        `, false);

        console.log('\n   Clientes por día de la semana:');
        const dayNames = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];
        weekRows.forEach(r => {
            const d = new Date(r.ANO, r.MES - 1, r.DIA);
            console.log(`   ${dayNames[d.getDay()]} ${r.DIA}/${r.MES}: ${r.TOTAL_CLIENTES} clientes`);
        });

        console.log('\n✅ Debug completado\n');
        process.exit(0);
    } catch (err) {
        console.error('\n❌ Error:', err);
        process.exit(1);
    }
}

debugRuteroKpi();
